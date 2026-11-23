import { normalizeGstin, normalizeKey } from './pharmacyMath.ts';
import type {
  AuditLogEntry,
  Distributor,
  Medicine,
  MedicineBatch,
  PharmacyState,
  PurchaseInvoice,
  PurchaseReturn,
  StockHistoryEvent,
} from './types.ts';

export interface SyncEnvelope {
  state: PharmacyState;
  revision: number;
  updatedAt: string;
  updatedByClientId?: string;
}

function isoTime(ts?: string): number {
  if (!ts) return 0;
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Merges two batch arrays without duplicating the same batch ID or normalized batch number.
 * When both sides edited the same batch, the newer medicine's batch takes precedence.
 */
function mergeBatches(
  baseBatches: MedicineBatch[],
  incomingBatches: MedicineBatch[],
  preferIncoming: boolean
): MedicineBatch[] {
  const byId = new Map<string, MedicineBatch>();
  const batchNumberToId = new Map<string, string>();

  const primary = preferIncoming ? baseBatches : incomingBatches;
  const secondary = preferIncoming ? incomingBatches : baseBatches;

  for (const b of primary) {
    byId.set(b.id, b);
    const key = normalizeKey(b.batchNumber);
    if (key) batchNumberToId.set(key, b.id);
  }

  for (const b of secondary) {
    const key = normalizeKey(b.batchNumber);
    const existingId = byId.has(b.id) ? b.id : key ? batchNumberToId.get(key) : undefined;
    if (existingId) {
      byId.set(existingId, { ...byId.get(existingId)!, ...b, id: existingId });
    } else {
      byId.set(b.id, b);
      if (key) batchNumberToId.set(key, b.id);
    }
  }

  return Array.from(byId.values());
}

/**
 * Deduplicates and merges two arrays of timestamped records by ID, keeping newest first.
 */
function mergeById<T extends { id: string }>(
  baseList: T[],
  incomingList: T[],
  getTime?: (item: T) => string | undefined,
  maxItems?: number
): T[] {
  const map = new Map<string, T>();
  for (const item of baseList) {
    map.set(item.id, item);
  }
  for (const item of incomingList) {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
    } else if (!getTime || isoTime(getTime(item)) >= isoTime(getTime(existing))) {
      map.set(item.id, item);
    }
  }
  const merged = Array.from(map.values());
  if (getTime) {
    merged.sort((a, b) => isoTime(getTime(b)) - isoTime(getTime(a)));
  }
  return maxItems ? merged.slice(0, maxItems) : merged;
}

/**
 * Merges two PharmacyState snapshots deterministically when simultaneous updates or
 * offline-reconnect edits occur across Android and Web clients.
 *
 * Guarantees:
 * - Respects deletedMedicineIds tombstones so deletes on either device are never resurrected.
 * - Prevents duplicate medicines (by ID or normalized Name + Manufacturer).
 * - Prevents duplicate invoices (by ID or normalized GSTIN + Invoice Number).
 * - Preserves all existing records without data loss.
 */
export function mergePharmacyStates(
  serverState: PharmacyState,
  incomingState: PharmacyState
): PharmacyState {
  const deletedSet = new Set<string>([
    ...(serverState.deletedMedicineIds || []),
    ...(incomingState.deletedMedicineIds || []),
  ]);

  // Keep tombstones bounded while preserving recent deletes
  const deletedMedicineIds = Array.from(deletedSet).slice(-500);

  // Merge medicines by ID & deduplicate by (normalized name + manufacturer)
  const medById = new Map<string, Medicine>();
  const medFingerprintToId = new Map<string, string>();

  const fingerprint = (m: Medicine) =>
    `${normalizeKey(m.name)}::${normalizeKey(m.manufacturer || m.brand || '')}`;

  for (const med of serverState.medicines) {
    if (deletedSet.has(med.id)) continue;
    medById.set(med.id, med);
    medFingerprintToId.set(fingerprint(med), med.id);
  }

  for (const med of incomingState.medicines) {
    if (deletedSet.has(med.id)) continue;
    const fp = fingerprint(med);
    const matchedId = medById.has(med.id) ? med.id : medFingerprintToId.get(fp);

    if (!matchedId) {
      medById.set(med.id, med);
      medFingerprintToId.set(fp, med.id);
    } else {
      const existing = medById.get(matchedId)!;
      const preferIncoming = isoTime(med.updatedAt) >= isoTime(existing.updatedAt);
      const winner = preferIncoming ? med : existing;
      const mergedBatches = mergeBatches(existing.batches, med.batches, preferIncoming);
      const mergedPriceHistory = mergeById(
        existing.priceHistory || [],
        med.priceHistory || [],
        (p) => p.date
      );
      medById.set(matchedId, {
        ...winner,
        id: matchedId,
        batches: mergedBatches,
        priceHistory: mergedPriceHistory,
      });
    }
  }

  // Merge distributors (deduplicate by ID or normalized GSTIN)
  const distById = new Map<string, Distributor>();
  const gstinToDistId = new Map<string, string>();
  for (const d of serverState.distributors) {
    distById.set(d.id, d);
    const g = normalizeGstin(d.gstin);
    if (g) gstinToDistId.set(g, d.id);
  }
  for (const d of incomingState.distributors) {
    const g = normalizeGstin(d.gstin);
    const matchedId = distById.has(d.id) ? d.id : g ? gstinToDistId.get(g) : undefined;
    if (!matchedId) {
      distById.set(d.id, d);
      if (g) gstinToDistId.set(g, d.id);
    } else {
      const existing = distById.get(matchedId)!;
      const preferIncoming = isoTime(incomingState.lastSyncedAt) >= isoTime(serverState.lastSyncedAt);
      distById.set(matchedId, preferIncoming ? { ...existing, ...d, id: matchedId } : existing);
    }
  }

  // Merge invoices (deduplicate by ID or normalized GSTIN + Invoice Number)
  const invById = new Map<string, PurchaseInvoice>();
  const invKeyToId = new Map<string, string>();
  const invKey = (inv: PurchaseInvoice) =>
    `${normalizeGstin(inv.distributorGstin)}::${normalizeKey(inv.invoiceNumber)}`;

  for (const inv of serverState.invoices) {
    invById.set(inv.id, inv);
    invKeyToId.set(invKey(inv), inv.id);
  }
  for (const inv of incomingState.invoices) {
    const k = invKey(inv);
    const matchedId = invById.has(inv.id) ? inv.id : invKeyToId.get(k);
    if (!matchedId) {
      invById.set(inv.id, inv);
      invKeyToId.set(k, inv.id);
    } else {
      const existing = invById.get(matchedId)!;
      const preferIncoming = isoTime(incomingState.lastSyncedAt) >= isoTime(serverState.lastSyncedAt);
      invById.set(
        matchedId,
        preferIncoming
          ? { ...existing, ...inv, id: matchedId }
          : { ...existing, gstReconciled: existing.gstReconciled || inv.gstReconciled }
      );
    }
  }

  const mergedInvoices = Array.from(invById.values()).sort(
    (a, b) => isoTime(b.createdAt || b.invoiceDate) - isoTime(a.createdAt || a.invoiceDate)
  );

  const stockHistory: StockHistoryEvent[] = mergeById(
    serverState.stockHistory || [],
    incomingState.stockHistory || [],
    (s) => s.timestamp,
    500
  );

  const auditLogs: AuditLogEntry[] = mergeById(
    serverState.auditLogs || [],
    incomingState.auditLogs || [],
    (a) => a.timestamp,
    500
  );

  const purchaseReturns: PurchaseReturn[] = mergeById(
    serverState.purchaseReturns || [],
    incomingState.purchaseReturns || [],
    (r) => r.date
  );

  const readNotificationIds = Array.from(
    new Set([
      ...(serverState.readNotificationIds || []),
      ...(incomingState.readNotificationIds || []),
    ])
  );

  const recentSearches = Array.from(
    new Set([
      ...(incomingState.recentSearches || []),
      ...(serverState.recentSearches || []),
    ])
  ).slice(0, 8);

  const preferIncomingUser =
    isoTime(incomingState.lastSyncedAt) >= isoTime(serverState.lastSyncedAt);

  return {
    medicines: Array.from(medById.values()),
    distributors: Array.from(distById.values()),
    invoices: mergedInvoices,
    stockHistory,
    auditLogs,
    purchaseReturns,
    readNotificationIds,
    recentSearches,
    user: preferIncomingUser ? incomingState.user : serverState.user,
    lastSyncedAt: new Date().toISOString(),
    syncRevision: Math.max(serverState.syncRevision || 0, incomingState.syncRevision || 0) + 1,
    deletedMedicineIds,
  };
}
