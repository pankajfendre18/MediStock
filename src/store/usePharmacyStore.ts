import { useCallback, useEffect, useMemo, useState } from 'react';
import { createInitialSeedState } from '../data/seedData';
import {
  classifyBatchExpiry,
  commitVerifiedInvoice,
  getMedicineSellableStock,
  round2,
} from '../domain/pharmacyMath';
import type {
  Distributor,
  InvoiceDraft,
  Medicine,
  MedicineBatch,
  NotificationItem,
  PharmacyState,
  PurchaseReturn,
  StockHistoryEvent,
  UserProfile,
  UserRole,
} from '../domain/types';

const STORAGE_KEY = 'medistock_ai_state_v1';
const THEME_KEY = 'medistock_ai_theme_v1';

function loadLocalState(): PharmacyState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PharmacyState;
      if (parsed && Array.isArray(parsed.medicines) && Array.isArray(parsed.distributors)) {
        return parsed;
      }
    }
  } catch {
    // ignore corrupted cache and fall back to seed
  }
  return createInitialSeedState();
}

export function usePharmacyStore() {
  const [state, setState] = useState<PharmacyState>(() => loadLocalState());
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem(THEME_KEY) === 'dark';
    } catch {
      return false;
    }
  });
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Sync dark mode class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [isDark]);

  // Listen to online/offline connectivity
  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Load persisted server state on initial mount if localStorage wasn't populated
  useEffect(() => {
    let cancelled = false;
    const hasLocal = Boolean(localStorage.getItem(STORAGE_KEY));
    if (!hasLocal) {
      fetch('/api/state')
        .then((r) => (r.ok ? r.json() : null))
        .then((res) => {
          if (!cancelled && res?.exists && res?.data?.medicines) {
            setState(res.data as PharmacyState);
          }
        })
        .catch(() => {
          // Offline fallback already loaded
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist to localStorage & background server sync
  const persistState = useCallback((next: PharmacyState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage quota fallback
    }
    if (navigator.onLine) {
      fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      }).catch(() => {
        // Offline queue stays in localStorage
      });
    }
  }, []);

  const updateState = useCallback(
    (updater: (prev: PharmacyState) => PharmacyState) => {
      setState((prev) => {
        const next = updater(prev);
        persistState(next);
        return next;
      });
    },
    [persistState]
  );

  const syncNow = useCallback(async () => {
    setIsSyncing(true);
    try {
      const syncedAt = new Date().toISOString();
      const payload = { ...state, lastSyncedAt: syncedAt };
      const res = await fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Server sync returned an error.');
      updateState((prev) => ({ ...prev, lastSyncedAt: syncedAt }));
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to reach sync server.',
      };
    } finally {
      setIsSyncing(false);
    }
  }, [state, updateState]);

  const commitInvoice = useCallback(
    (draft: InvoiceDraft) => {
      let summary = { invoiceNumber: draft.invoiceNumber, mergedBatchCount: 0, newBatchCount: 0, invoiceId: '' };
      updateState((prev) => {
        const res = commitVerifiedInvoice(prev, draft);
        summary = {
          invoiceNumber: res.createdInvoice.invoiceNumber,
          mergedBatchCount: res.mergedBatchCount,
          newBatchCount: res.newBatchCount,
          invoiceId: res.createdInvoice.id,
        };
        return res.nextState;
      });
      return summary;
    },
    [updateState]
  );

  const saveMedicine = useCallback(
    (
      medInput: Omit<Medicine, 'id' | 'batches' | 'priceHistory' | 'updatedAt'> & { id?: string },
      batchInput?: Omit<MedicineBatch, 'id' | 'addedAt'> & { id?: string }
    ) => {
      const now = new Date().toISOString();
      let savedId = medInput.id || `med_${Date.now()}`;
      updateState((prev) => {
        const existing = medInput.id ? prev.medicines.find((m) => m.id === medInput.id) : undefined;
        let nextMedicines: Medicine[];
        let nextHistory = [...prev.stockHistory];

        if (existing) {
          savedId = existing.id;
          let nextBatches = [...existing.batches];
          if (batchInput) {
            if (batchInput.id) {
              nextBatches = nextBatches.map((b) =>
                b.id === batchInput.id ? { ...b, ...batchInput } : b
              );
            } else {
              const newBat: MedicineBatch = {
                ...batchInput,
                id: `bat_${Date.now()}`,
                addedAt: now,
              };
              nextBatches = [newBat, ...nextBatches];
              nextHistory.unshift({
                id: `sh_${Date.now()}`,
                timestamp: now,
                medicineId: existing.id,
                medicineName: medInput.name,
                batchNumber: newBat.batchNumber,
                type: 'manual_add',
                quantityDelta: newBat.availableStock,
                resultingStock: newBat.availableStock,
                reason: 'Manual batch added',
                actorName: prev.user.name,
              });
            }
          }
          nextMedicines = prev.medicines.map((m) =>
            m.id === existing.id
              ? { ...m, ...medInput, batches: nextBatches, updatedAt: now }
              : m
          );
        } else {
          const initialBatch: MedicineBatch | null = batchInput
            ? {
                ...batchInput,
                id: `bat_${Date.now()}`,
                addedAt: now,
              }
            : null;
          const created: Medicine = {
            ...medInput,
            id: savedId,
            batches: initialBatch ? [initialBatch] : [],
            priceHistory: [],
            updatedAt: now,
          };
          nextMedicines = [created, ...prev.medicines];
          if (initialBatch) {
            nextHistory.unshift({
              id: `sh_${Date.now()}`,
              timestamp: now,
              medicineId: savedId,
              medicineName: created.name,
              batchNumber: initialBatch.batchNumber,
              type: 'manual_add',
              quantityDelta: initialBatch.availableStock,
              resultingStock: initialBatch.availableStock,
              reason: 'Initial manual inventory entry',
              actorName: prev.user.name,
            });
          }
        }

        return {
          ...prev,
          medicines: nextMedicines,
          stockHistory: nextHistory,
          auditLogs: [
            {
              id: `aud_${Date.now()}`,
              timestamp: now,
              actorName: prev.user.name,
              actorRole: prev.user.role,
              action: existing ? 'Updated Medicine' : 'Added Medicine',
              entityType: 'medicine',
              entityName: medInput.name,
              details: batchInput
                ? `Batch ${batchInput.batchNumber} · Qty ${batchInput.availableStock} · MRP ₹${batchInput.mrp}`
                : 'Updated medicine catalog details',
            },
            ...prev.auditLogs,
          ],
        };
      });
      return savedId;
    },
    [updateState]
  );

  const deleteMedicine = useCallback(
    (medicineId: string) => {
      const now = new Date().toISOString();
      updateState((prev) => {
        const target = prev.medicines.find((m) => m.id === medicineId);
        if (!target) return prev;
        return {
          ...prev,
          medicines: prev.medicines.filter((m) => m.id !== medicineId),
          auditLogs: [
            {
              id: `aud_${Date.now()}`,
              timestamp: now,
              actorName: prev.user.name,
              actorRole: prev.user.role,
              action: 'Deleted Medicine',
              entityType: 'medicine',
              entityName: target.name,
              details: `Removed medicine with ${target.batches.length} batch record(s)`,
            },
            ...prev.auditLogs,
          ],
        };
      });
    },
    [updateState]
  );

  const adjustBatchStock = useCallback(
    (
      medicineId: string,
      batchId: string,
      delta: number,
      type: StockHistoryEvent['type'],
      reason: string
    ) => {
      const now = new Date().toISOString();
      updateState((prev) => {
        const med = prev.medicines.find((m) => m.id === medicineId);
        const bat = med?.batches.find((b) => b.id === batchId);
        if (!med || !bat) return prev;

        const nextQty = Math.max(0, bat.availableStock + delta);
        const appliedDelta = nextQty - bat.availableStock;

        const nextMedicines = prev.medicines.map((m) =>
          m.id === medicineId
            ? {
                ...m,
                updatedAt: now,
                batches: m.batches.map((b) =>
                  b.id === batchId ? { ...b, availableStock: nextQty } : b
                ),
              }
            : m
        );

        return {
          ...prev,
          medicines: nextMedicines,
          stockHistory: [
            {
              id: `sh_${Date.now()}`,
              timestamp: now,
              medicineId,
              medicineName: med.name,
              batchNumber: bat.batchNumber,
              type,
              quantityDelta: appliedDelta,
              resultingStock: nextQty,
              reason: reason.trim() || 'Manual stock adjustment',
              actorName: prev.user.name,
            },
            ...prev.stockHistory,
          ],
          auditLogs: [
            {
              id: `aud_${Date.now()}`,
              timestamp: now,
              actorName: prev.user.name,
              actorRole: prev.user.role,
              action: 'Stock Adjustment',
              entityType: 'medicine',
              entityName: med.name,
              details: `Batch ${bat.batchNumber}: ${appliedDelta >= 0 ? '+' : ''}${appliedDelta} units (Now ${nextQty}) · ${reason}`,
            },
            ...prev.auditLogs,
          ],
        };
      });
    },
    [updateState]
  );

  const updateMinStockLevel = useCallback(
    (medicineId: string, minStockLevel: number) => {
      const safeMin = Math.max(0, Math.round(minStockLevel));
      updateState((prev) => ({
        ...prev,
        medicines: prev.medicines.map((m) =>
          m.id === medicineId ? { ...m, minStockLevel: safeMin } : m
        ),
      }));
    },
    [updateState]
  );

  const saveDistributor = useCallback(
    (distInput: Omit<Distributor, 'id' | 'createdAt'> & { id?: string }) => {
      const now = new Date().toISOString();
      updateState((prev) => {
        const exists = distInput.id
          ? prev.distributors.find((d) => d.id === distInput.id)
          : undefined;
        const nextDistributors = exists
          ? prev.distributors.map((d) =>
              d.id === exists.id ? { ...d, ...distInput } : d
            )
          : [
              {
                ...distInput,
                id: `dist_${Date.now()}`,
                createdAt: now,
              },
              ...prev.distributors,
            ];
        return {
          ...prev,
          distributors: nextDistributors,
          auditLogs: [
            {
              id: `aud_${Date.now()}`,
              timestamp: now,
              actorName: prev.user.name,
              actorRole: prev.user.role,
              action: exists ? 'Updated Distributor' : 'Added Distributor',
              entityType: 'distributor',
              entityName: distInput.name,
              details: `GSTIN: ${distInput.gstin || 'N/A'} · Contact: ${distInput.contactNumber || 'N/A'}`,
            },
            ...prev.auditLogs,
          ],
        };
      });
    },
    [updateState]
  );

  const recordDistributorPayment = useCallback(
    (distributorId: string, amount: number) => {
      const paid = Math.max(0, round2(amount));
      if (paid <= 0) return;
      const now = new Date().toISOString();
      updateState((prev) => {
        const dist = prev.distributors.find((d) => d.id === distributorId);
        if (!dist) return prev;
        const remaining = Math.max(0, round2(dist.outstandingPayment - paid));
        return {
          ...prev,
          distributors: prev.distributors.map((d) =>
            d.id === distributorId ? { ...d, outstandingPayment: remaining } : d
          ),
          auditLogs: [
            {
              id: `aud_${Date.now()}`,
              timestamp: now,
              actorName: prev.user.name,
              actorRole: prev.user.role,
              action: 'Recorded Distributor Payment',
              entityType: 'distributor',
              entityName: dist.name,
              details: `Paid ₹${paid.toFixed(2)} · Remaining Outstanding: ₹${remaining.toFixed(2)}`,
            },
            ...prev.auditLogs,
          ],
        };
      });
    },
    [updateState]
  );

  const createPurchaseReturn = useCallback(
    (input: {
      medicineId: string;
      batchId: string;
      quantity: number;
      reason: PurchaseReturn['reason'];
      invoiceNumber?: string;
    }) => {
      const now = new Date().toISOString();
      updateState((prev) => {
        const med = prev.medicines.find((m) => m.id === input.medicineId);
        const bat = med?.batches.find((b) => b.id === input.batchId);
        if (!med || !bat) return prev;
        const returnQty = Math.min(bat.availableStock, Math.max(1, Math.round(input.quantity)));
        const creditAmount = round2(returnQty * bat.purchasePrice);
        const returnNumber = `PR/26-27/${String(prev.purchaseReturns.length + 20).padStart(3, '0')}`;

        const nextMedicines = prev.medicines.map((m) =>
          m.id === med.id
            ? {
                ...m,
                updatedAt: now,
                batches: m.batches.map((b) =>
                  b.id === bat.id
                    ? { ...b, availableStock: Math.max(0, b.availableStock - returnQty) }
                    : b
                ),
              }
            : m
        );

        const nextReturn: PurchaseReturn = {
          id: `pr_${Date.now()}`,
          returnNumber,
          date: now.slice(0, 10),
          distributorId: bat.distributorId,
          distributorName: bat.distributorName,
          invoiceNumber: input.invoiceNumber || bat.lastInvoiceNumber,
          medicineId: med.id,
          medicineName: med.name,
          batchNumber: bat.batchNumber,
          quantity: returnQty,
          creditAmount,
          reason: input.reason,
          status: 'pending',
        };

        return {
          ...prev,
          medicines: nextMedicines,
          purchaseReturns: [nextReturn, ...prev.purchaseReturns],
          stockHistory: [
            {
              id: `sh_${Date.now()}`,
              timestamp: now,
              medicineId: med.id,
              medicineName: med.name,
              batchNumber: bat.batchNumber,
              type: 'return',
              quantityDelta: -returnQty,
              resultingStock: Math.max(0, bat.availableStock - returnQty),
              reason: `Purchase return ${returnNumber} (${input.reason})`,
              actorName: prev.user.name,
            },
            ...prev.stockHistory,
          ],
          auditLogs: [
            {
              id: `aud_${Date.now()}`,
              timestamp: now,
              actorName: prev.user.name,
              actorRole: prev.user.role,
              action: 'Created Purchase Return',
              entityType: 'return',
              entityName: returnNumber,
              details: `${med.name} (Batch ${bat.batchNumber}) · ${returnQty} units · Credit ₹${creditAmount.toFixed(2)}`,
            },
            ...prev.auditLogs,
          ],
        };
      });
    },
    [updateState]
  );

  const markReturnCredited = useCallback(
    (returnId: string) => {
      updateState((prev) => {
        const ret = prev.purchaseReturns.find((r) => r.id === returnId);
        if (!ret || ret.status === 'credited') return prev;
        return {
          ...prev,
          purchaseReturns: prev.purchaseReturns.map((r) =>
            r.id === returnId ? { ...r, status: 'credited' } : r
          ),
          distributors: prev.distributors.map((d) =>
            d.id === ret.distributorId
              ? {
                  ...d,
                  outstandingPayment: Math.max(
                    0,
                    round2(d.outstandingPayment - ret.creditAmount)
                  ),
                }
              : d
          ),
        };
      });
    },
    [updateState]
  );

  const toggleInvoiceReconciled = useCallback(
    (invoiceId: string) => {
      updateState((prev) => ({
        ...prev,
        invoices: prev.invoices.map((inv) =>
          inv.id === invoiceId ? { ...inv, gstReconciled: !inv.gstReconciled } : inv
        ),
      }));
    },
    [updateState]
  );

  const addRecentSearch = useCallback(
    (term: string) => {
      const cleaned = term.trim();
      if (!cleaned) return;
      updateState((prev) => ({
        ...prev,
        recentSearches: [
          cleaned,
          ...prev.recentSearches.filter(
            (s) => s.toLowerCase() !== cleaned.toLowerCase()
          ),
        ].slice(0, 8),
      }));
    },
    [updateState]
  );

  const updateUserProfile = useCallback(
    (partial: Partial<UserProfile>) => {
      updateState((prev) => ({
        ...prev,
        user: { ...prev.user, ...partial },
      }));
    },
    [updateState]
  );

  const switchRole = useCallback(
    (role: UserRole) => {
      const now = new Date().toISOString();
      updateState((prev) => ({
        ...prev,
        user: {
          ...prev.user,
          role,
          name: role === 'owner' ? 'Dr. Suresh Sharma' : 'Anita Deshmukh (Pharmacist)',
        },
        auditLogs: [
          {
            id: `aud_${Date.now()}`,
            timestamp: now,
            actorName: role === 'owner' ? 'Dr. Suresh Sharma' : 'Anita Deshmukh',
            actorRole: role,
            action: 'Switched Active Role',
            entityType: 'auth',
            entityName: role === 'owner' ? 'Pharmacy Owner' : 'Staff Pharmacist',
            details: `Role permissions switched to ${role}`,
          },
          ...prev.auditLogs,
        ],
      }));
    },
    [updateState]
  );

  const markNotificationRead = useCallback(
    (id: string) => {
      updateState((prev) => ({
        ...prev,
        readNotificationIds: prev.readNotificationIds.includes(id)
          ? prev.readNotificationIds
          : [...prev.readNotificationIds, id],
      }));
    },
    [updateState]
  );

  const markAllNotificationsRead = useCallback(
    (allIds: string[]) => {
      updateState((prev) => ({
        ...prev,
        readNotificationIds: Array.from(new Set([...prev.readNotificationIds, ...allIds])),
      }));
    },
    [updateState]
  );

  const restoreFromBackup = useCallback(
    (backup: PharmacyState) => {
      if (!backup || !Array.isArray(backup.medicines) || !Array.isArray(backup.distributors)) {
        throw new Error('Invalid MediStock AI backup file structure.');
      }
      updateState(() => ({
        ...backup,
        lastSyncedAt: new Date().toISOString(),
      }));
    },
    [updateState]
  );

  const resetToDemoData = useCallback(() => {
    const fresh = createInitialSeedState();
    updateState(() => fresh);
  }, [updateState]);

  // Derived live notifications from real inventory state
  const notifications = useMemo<NotificationItem[]>(() => {
    const list: NotificationItem[] = [];
    const now = new Date();

    for (const med of state.medicines) {
      const sellable = getMedicineSellableStock(med, now);
      if (sellable === 0) {
        const id = `notif_oos_${med.id}`;
        list.push({
          id,
          severity: 'critical',
          title: `Out of Stock: ${med.name}`,
          description: `0 sellable units available (min threshold: ${med.minStockLevel}). Reorder required immediately.`,
          timestamp: med.updatedAt,
          targetScreen: 'low_stock',
          targetId: med.id,
          read: state.readNotificationIds.includes(id),
        });
      } else if (sellable < med.minStockLevel) {
        const id = `notif_low_${med.id}`;
        list.push({
          id,
          severity: 'warning',
          title: `Low Stock: ${med.name}`,
          description: `${sellable} sellable units left (below minimum level of ${med.minStockLevel}).`,
          timestamp: med.updatedAt,
          targetScreen: 'low_stock',
          targetId: med.id,
          read: state.readNotificationIds.includes(id),
        });
      }

      for (const batch of med.batches) {
        if (batch.availableStock <= 0) continue;
        const { bucket, daysRemaining } = classifyBatchExpiry(batch.expiryDate, now);
        if (bucket === 'expired') {
          const id = `notif_exp_${batch.id}`;
          list.push({
            id,
            severity: 'critical',
            title: `Expired Batch Blocked: ${med.name}`,
            description: `Batch ${batch.batchNumber} (${batch.availableStock} units) expired on ${batch.expiryDate}. Blocked from sellable stock — initiate distributor return.`,
            timestamp: batch.addedAt,
            targetScreen: 'expiry',
            targetId: med.id,
            read: state.readNotificationIds.includes(id),
          });
        } else if (bucket === 'expiring_30') {
          const id = `notif_exp30_${batch.id}`;
          list.push({
            id,
            severity: 'warning',
            title: `Expiring in ${daysRemaining} days: ${med.name}`,
            description: `Batch ${batch.batchNumber} (${batch.availableStock} units) expires on ${batch.expiryDate}.`,
            timestamp: batch.addedAt,
            targetScreen: 'expiry',
            targetId: med.id,
            read: state.readNotificationIds.includes(id),
          });
        }
      }
    }

    for (const inv of state.invoices) {
      if (!inv.gstReconciled) {
        const id = `notif_gst_${inv.id}`;
        list.push({
          id,
          severity: 'info',
          title: `GST Reconciliation Pending: ${inv.invoiceNumber}`,
          description: `${inv.distributorName} · GST ₹${inv.totalGstAmount.toFixed(2)} awaiting GSTR-2B match.`,
          timestamp: inv.createdAt,
          targetScreen: 'invoice_detail',
          targetId: inv.id,
          read: state.readNotificationIds.includes(id),
        });
      }
    }

    return list;
  }, [state.medicines, state.invoices, state.readNotificationIds]);

  const unreadNotificationCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  return {
    state,
    isDark,
    setIsDark,
    isOnline,
    isSyncing,
    notifications,
    unreadNotificationCount,
    syncNow,
    commitInvoice,
    saveMedicine,
    deleteMedicine,
    adjustBatchStock,
    updateMinStockLevel,
    saveDistributor,
    recordDistributorPayment,
    createPurchaseReturn,
    markReturnCredited,
    toggleInvoiceReconciled,
    addRecentSearch,
    updateUserProfile,
    switchRole,
    markNotificationRead,
    markAllNotificationsRead,
    restoreFromBackup,
    resetToDemoData,
  };
}
