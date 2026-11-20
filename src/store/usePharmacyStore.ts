import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createInitialSeedState } from '../data/seedData';
import {
  classifyBatchExpiry,
  commitVerifiedInvoice,
  getMedicineSellableStock,
  round2,
} from '../domain/pharmacyMath';
import { mergePharmacyStates } from '../domain/syncMerge';
import type {
  Distributor,
  InvoiceDraft,
  Medicine,
  MedicineBatch,
  NotificationItem,
  PharmacyState,
  PurchaseReturn,
  StockHistoryEvent,
  SyncStatus,
  UserProfile,
  UserRole,
} from '../domain/types';

const STORAGE_KEY = 'medistock_ai_state_v1';
const PENDING_SYNC_KEY = 'medistock_ai_pending_v1';
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

function loadPendingCount(): number {
  try {
    const raw = localStorage.getItem(PENDING_SYNC_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function savePendingCount(count: number): void {
  try {
    if (count > 0) {
      localStorage.setItem(PENDING_SYNC_KEY, String(count));
    } else {
      localStorage.removeItem(PENDING_SYNC_KEY);
    }
  } catch {
    // ignore storage quota errors
  }
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
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'syncing'
  );
  const [pendingChangesCount, setPendingChangesCount] = useState<number>(() => loadPendingCount());
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);

  const clientIdRef = useRef<string>(
    `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  );
  const stateRef = useRef<PharmacyState>(state);
  const pendingCountRef = useRef<number>(pendingChangesCount);
  const syncInFlightRef = useRef<boolean>(false);
  const queuedPushRef = useRef<{ state: PharmacyState; forceReplace?: boolean } | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    pendingCountRef.current = pendingChangesCount;
    savePendingCount(pendingChangesCount);
  }, [pendingChangesCount]);

  // Sync dark mode class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [isDark]);

  const writeLocalCache = useCallback((next: PharmacyState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage quota fallback
    }
  }, []);

  const pushStateToServer = useCallback(
    async (
      targetState: PharmacyState,
      options?: { forceReplace?: boolean }
    ): Promise<{ ok: boolean; error?: string }> => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSyncStatus('offline');
        setPendingChangesCount((c) => Math.max(1, c));
        return { ok: false, error: 'Offline — changes queued locally.' };
      }

      if (syncInFlightRef.current) {
        queuedPushRef.current = { state: targetState, forceReplace: options?.forceReplace };
        return { ok: true };
      }

      syncInFlightRef.current = true;
      setIsSyncing(true);
      setSyncStatus('syncing');

      try {
        const res = await fetch('/api/state', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: targetState,
            baseRevision: targetState.syncRevision ?? 0,
            clientId: clientIdRef.current,
            forceReplace: options?.forceReplace === true,
          }),
        });

        if (!res.ok) {
          throw new Error(`Sync server responded with HTTP ${res.status}`);
        }

        const data = (await res.json()) as {
          ok?: boolean;
          revision?: number;
          syncedAt?: string;
          merged?: boolean;
          state?: PharmacyState;
        };

        if (data.state && Array.isArray(data.state.medicines)) {
          // Only overwrite React state if no newer queued local write is waiting
          if (!queuedPushRef.current) {
            setState(data.state);
            stateRef.current = data.state;
            writeLocalCache(data.state);
          } else {
            // Carry forward server revision onto queued state so next flush doesn't conflict unnecessarily
            queuedPushRef.current = {
              ...queuedPushRef.current,
              state: {
                ...queuedPushRef.current.state,
                syncRevision: data.revision ?? data.state.syncRevision,
              },
            };
          }
        }

        setLastSyncError(null);
        if (!queuedPushRef.current) {
          setPendingChangesCount(0);
          setSyncStatus('live');
        }
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to reach sync server.';
        setLastSyncError(msg);
        setSyncStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
        setPendingChangesCount((c) => Math.max(1, c));
        return { ok: false, error: msg };
      } finally {
        syncInFlightRef.current = false;
        const queued = queuedPushRef.current;
        if (queued) {
          queuedPushRef.current = null;
          void pushStateToServer(queued.state, { forceReplace: queued.forceReplace });
        } else {
          setIsSyncing(false);
        }
      }
    },
    [writeLocalCache]
  );

  const reconcileIncomingServerState = useCallback(
    (remoteState: PharmacyState, updatedByClientId?: string) => {
      if (updatedByClientId && updatedByClientId === clientIdRef.current) {
        return;
      }
      const localRev = stateRef.current.syncRevision ?? 0;
      const remoteRev = remoteState.syncRevision ?? 0;

      if (pendingCountRef.current > 0) {
        // Device had unsynced offline edits — merge cleanly without losing either side's changes
        const merged = mergePharmacyStates(remoteState, stateRef.current);
        merged.syncRevision = Math.max(localRev, remoteRev);
        setState(merged);
        stateRef.current = merged;
        writeLocalCache(merged);
        void pushStateToServer(merged);
        return;
      }

      if (remoteRev >= localRev || remoteState.lastSyncedAt !== stateRef.current.lastSyncedAt) {
        setState(remoteState);
        stateRef.current = remoteState;
        writeLocalCache(remoteState);
      }
    },
    [pushStateToServer, writeLocalCache]
  );

  // Initial authoritative server pull + bootstrap if server has no state yet
  useEffect(() => {
    let cancelled = false;

    const pullInitialState = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSyncStatus('offline');
        return;
      }
      try {
        const r = await fetch('/api/state', { cache: 'no-store' });
        if (!r.ok || cancelled) return;
        const res = (await r.json()) as {
          exists?: boolean;
          data?: PharmacyState | null;
          revision?: number;
        };
        if (cancelled) return;

        if (res?.exists && res.data && Array.isArray(res.data.medicines)) {
          reconcileIncomingServerState(res.data);
          setSyncStatus('live');
          setLastSyncError(null);
        } else {
          // First-time server bootstrap with local/seed state so Android & Web immediately share one source of truth
          await pushStateToServer(stateRef.current);
        }
      } catch {
        if (!cancelled) {
          setSyncStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
        }
      }
    };

    void pullInitialState();
    return () => {
      cancelled = true;
    };
  }, [pushStateToServer, reconcileIncomingServerState]);

  // Real-time Server-Sent Events (SSE) subscription for instant Android <-> Website updates
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return;
    }

    let es: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;
    let closed = false;

    const connect = () => {
      if (closed) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setSyncStatus('offline');
        return;
      }

      try {
        es = new EventSource('/api/state/stream');
      } catch {
        return;
      }

      es.onopen = () => {
        attempt = 0;
        setLastSyncError(null);
        if (pendingCountRef.current > 0) {
          void pushStateToServer(stateRef.current);
        } else {
          setSyncStatus('live');
        }
      };

      const handleEvent = (ev: MessageEvent) => {
        try {
          const parsed = JSON.parse(ev.data) as {
            state?: PharmacyState;
            updatedByClientId?: string;
          };
          if (parsed?.state && Array.isArray(parsed.state.medicines)) {
            reconcileIncomingServerState(parsed.state, parsed.updatedByClientId);
          }
          setSyncStatus('live');
          setLastSyncError(null);
        } catch {
          // ignore malformed SSE frame
        }
      };

      es.addEventListener('state:init', handleEvent as EventListener);
      es.addEventListener('state:updated', handleEvent as EventListener);

      es.onerror = () => {
        es?.close();
        es = null;
        if (closed) return;
        setSyncStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'syncing');
        const delays = [1000, 2000, 5000, 10000];
        const delay = delays[Math.min(attempt, delays.length - 1)];
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    const handleOnline = () => {
      setIsOnline(true);
      if (pendingCountRef.current > 0) {
        void pushStateToServer(stateRef.current);
      }
      if (!es || es.readyState === EventSource.CLOSED) {
        attempt = 0;
        connect();
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setSyncStatus('offline');
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        // When returning to Android app or browser tab, ensure pending changes flush and latest server state is pulled
        if (pendingCountRef.current > 0) {
          void pushStateToServer(stateRef.current);
        } else {
          fetch('/api/state', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((res) => {
              if (res?.exists && res.data?.medicines) {
                reconcileIncomingServerState(res.data as PharmacyState);
              }
            })
            .catch(() => {
              // ignore background refresh error
            });
        }
        if (!es || es.readyState === EventSource.CLOSED) {
          attempt = 0;
          connect();
        }
      }
    };

    connect();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      es?.close();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [pushStateToServer, reconcileIncomingServerState]);

  // Persist to localStorage & background real-time server sync
  const persistState = useCallback(
    (next: PharmacyState, options?: { forceReplace?: boolean }) => {
      writeLocalCache(next);
      setPendingChangesCount((c) => c + 1);
      void pushStateToServer(next, options);
    },
    [pushStateToServer, writeLocalCache]
  );

  const updateState = useCallback(
    (updater: (prev: PharmacyState) => PharmacyState, options?: { forceReplace?: boolean }) => {
      setState((prev) => {
        const next = updater(prev);
        stateRef.current = next;
        persistState(next, options);
        return next;
      });
    },
    [persistState]
  );

  const syncNow = useCallback(async () => {
    const syncedAt = new Date().toISOString();
    const payload: PharmacyState = { ...stateRef.current, lastSyncedAt: syncedAt };
    const result = await pushStateToServer(payload);
    return result;
  }, [pushStateToServer]);

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
          deletedMedicineIds: (prev.deletedMedicineIds || []).filter((id) => id !== savedId),
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
        const deletedIds = Array.from(
          new Set([...(prev.deletedMedicineIds || []), medicineId])
        ).slice(-500);
        return {
          ...prev,
          medicines: prev.medicines.filter((m) => m.id !== medicineId),
          deletedMedicineIds: deletedIds,
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
      updateState(
        () => ({
          ...backup,
          deletedMedicineIds: [],
          lastSyncedAt: new Date().toISOString(),
        }),
        { forceReplace: true }
      );
    },
    [updateState]
  );

  const resetToDemoData = useCallback(() => {
    const fresh = createInitialSeedState();
    updateState(() => ({ ...fresh, deletedMedicineIds: [] }), { forceReplace: true });
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
    syncStatus,
    pendingChangesCount,
    lastSyncError,
    syncRevision: state.syncRevision ?? 0,
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
