import type {
  Distributor,
  ExpiryBucket,
  InvoiceDraft,
  InvoiceLineItem,
  Medicine,
  MedicineBatch,
  PharmacyState,
  PurchaseInvoice,
} from './types.ts';

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function normalizeKey(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function normalizeGstin(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Computes line-level Indian GST purchase math including discount & free quantity.
 */
export function calculateLineItemMath(input: {
  quantity: number;
  freeQuantity: number;
  purchaseRate: number;
  discountPercent: number;
  gstPercent: number;
}): {
  grossAmount: number;
  discountAmount: number;
  taxableAmount: number;
  gstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  totalAmount: number;
  totalUnitsAdded: number;
  effectiveUnitCost: number;
} {
  const qty = Math.max(0, Number(input.quantity) || 0);
  const freeQty = Math.max(0, Number(input.freeQuantity) || 0);
  const rate = Math.max(0, Number(input.purchaseRate) || 0);
  const discPct = Math.min(100, Math.max(0, Number(input.discountPercent) || 0));
  const gstPct = Math.max(0, Number(input.gstPercent) || 0);

  const grossAmount = round2(qty * rate);
  const discountAmount = round2(grossAmount * (discPct / 100));
  const taxableAmount = round2(grossAmount - discountAmount);
  const gstAmount = round2(taxableAmount * (gstPct / 100));
  const cgstAmount = round2(gstAmount / 2);
  const sgstAmount = round2(gstAmount - cgstAmount);
  const totalAmount = round2(taxableAmount + gstAmount);
  const totalUnitsAdded = qty + freeQty;
  const effectiveUnitCost =
    totalUnitsAdded > 0 ? round2(totalAmount / totalUnitsAdded) : 0;

  return {
    grossAmount,
    discountAmount,
    taxableAmount,
    gstAmount,
    cgstAmount,
    sgstAmount,
    totalAmount,
    totalUnitsAdded,
    effectiveUnitCost,
  };
}

export function recalculateLineItem(item: InvoiceLineItem): InvoiceLineItem {
  const math = calculateLineItemMath({
    quantity: item.quantity,
    freeQuantity: item.freeQuantity,
    purchaseRate: item.purchaseRate,
    discountPercent: item.discountPercent,
    gstPercent: item.gstPercent,
  });
  return {
    ...item,
    taxableAmount: math.taxableAmount,
    gstAmount: math.gstAmount,
    totalAmount: math.totalAmount,
  };
}

export function calculateInvoiceTotals(items: InvoiceLineItem[]): {
  subtotalTaxable: number;
  totalDiscount: number;
  totalGstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  grandTotal: number;
  totalUnitsAdded: number;
  paidUnits: number;
  freeUnits: number;
} {
  let subtotalTaxable = 0;
  let totalDiscount = 0;
  let totalGstAmount = 0;
  let grandTotal = 0;
  let totalUnitsAdded = 0;
  let paidUnits = 0;
  let freeUnits = 0;

  for (const item of items) {
    const math = calculateLineItemMath({
      quantity: item.quantity,
      freeQuantity: item.freeQuantity,
      purchaseRate: item.purchaseRate,
      discountPercent: item.discountPercent,
      gstPercent: item.gstPercent,
    });
    subtotalTaxable += math.taxableAmount;
    totalDiscount += math.discountAmount;
    totalGstAmount += math.gstAmount;
    grandTotal += math.totalAmount;
    totalUnitsAdded += math.totalUnitsAdded;
    paidUnits += Math.max(0, Number(item.quantity) || 0);
    freeUnits += Math.max(0, Number(item.freeQuantity) || 0);
  }

  const roundedGst = round2(totalGstAmount);
  const cgstAmount = round2(roundedGst / 2);
  const sgstAmount = round2(roundedGst - cgstAmount);

  return {
    subtotalTaxable: round2(subtotalTaxable),
    totalDiscount: round2(totalDiscount),
    totalGstAmount: roundedGst,
    cgstAmount,
    sgstAmount,
    grandTotal: round2(grandTotal),
    totalUnitsAdded,
    paidUnits,
    freeUnits,
  };
}

/**
 * Parses YYYY-MM-DD or MM/YYYY or MM-YY expiry strings strictly without guessing missing values.
 */
export function parseExpiryDate(expiryStr: string): Date | null {
  const trimmed = (expiryStr || '').trim();
  if (!trimmed) return null;

  // YYYY-MM-DD
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (
      d.getUTCFullYear() === year &&
      d.getUTCMonth() === month - 1 &&
      d.getUTCDate() === day
    ) {
      return d;
    }
    return null;
  }

  // MM/YYYY or MM-YYYY
  const mmyyyy = /^(\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (mmyyyy) {
    const month = Number(mmyyyy[1]);
    const year = Number(mmyyyy[2]);
    if (month < 1 || month > 12) return null;
    // Last day of that expiry month
    return new Date(Date.UTC(year, month, 0));
  }

  // MM/YY or MM-YY
  const mmyy = /^(\d{1,2})[/-](\d{2})$/.exec(trimmed);
  if (mmyy) {
    const month = Number(mmyy[1]);
    const year = 2000 + Number(mmyy[2]);
    if (month < 1 || month > 12) return null;
    return new Date(Date.UTC(year, month, 0));
  }

  return null;
}

export function normalizeExpiryToIso(expiryStr: string): string {
  const d = parseExpiryDate(expiryStr);
  if (!d) return '';
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function classifyBatchExpiry(
  expiryDate: string,
  referenceDate: Date = new Date()
): { bucket: ExpiryBucket; daysRemaining: number } {
  const exp = parseExpiryDate(expiryDate);
  if (!exp) {
    return { bucket: 'expired', daysRemaining: -999 };
  }
  const refUtc = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate()
  );
  const diffDays = Math.floor((exp.getTime() - refUtc) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { bucket: 'expired', daysRemaining: diffDays };
  if (diffDays <= 30) return { bucket: 'expiring_30', daysRemaining: diffDays };
  if (diffDays <= 60) return { bucket: 'expiring_60', daysRemaining: diffDays };
  if (diffDays <= 90) return { bucket: 'expiring_90', daysRemaining: diffDays };
  return { bucket: 'safe', daysRemaining: diffDays };
}

/**
 * Safety rule: Expired batches are NEVER treated as sellable stock.
 */
export function getMedicineSellableStock(
  medicine: Medicine,
  referenceDate: Date = new Date()
): number {
  return medicine.batches.reduce((sum, batch) => {
    const { bucket } = classifyBatchExpiry(batch.expiryDate, referenceDate);
    if (bucket === 'expired') return sum;
    return sum + Math.max(0, batch.availableStock);
  }, 0);
}

export function getMedicineExpiredStock(
  medicine: Medicine,
  referenceDate: Date = new Date()
): number {
  return medicine.batches.reduce((sum, batch) => {
    const { bucket } = classifyBatchExpiry(batch.expiryDate, referenceDate);
    if (bucket !== 'expired') return sum;
    return sum + Math.max(0, batch.availableStock);
  }, 0);
}

export function getMedicineNearestExpiry(
  medicine: Medicine,
  referenceDate: Date = new Date()
): { batch: MedicineBatch | null; bucket: ExpiryBucket; daysRemaining: number } {
  const stocked = medicine.batches.filter((b) => b.availableStock > 0);
  const pool = stocked.length > 0 ? stocked : medicine.batches;
  if (pool.length === 0) {
    return { batch: null, bucket: 'safe', daysRemaining: 9999 };
  }
  let nearest = pool[0];
  let nearestMeta = classifyBatchExpiry(nearest.expiryDate, referenceDate);

  for (let i = 1; i < pool.length; i++) {
    const meta = classifyBatchExpiry(pool[i].expiryDate, referenceDate);
    if (meta.daysRemaining < nearestMeta.daysRemaining) {
      nearest = pool[i];
      nearestMeta = meta;
    }
  }
  return { batch: nearest, ...nearestMeta };
}

export interface DashboardMetrics {
  totalMedicines: number;
  totalSellableStock: number;
  totalInventoryPurchaseValue: number;
  totalInventoryMrpValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  expiredBatchCount: number;
  expiredStockValue: number;
  expiring30Count: number;
  expiring60Count: number;
  expiring90Count: number;
  expiringSoonTotal: number;
}

export function computeDashboardStats(
  medicines: Medicine[],
  referenceDate: Date = new Date()
): DashboardMetrics {
  let totalSellableStock = 0;
  let totalInventoryPurchaseValue = 0;
  let totalInventoryMrpValue = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let expiredBatchCount = 0;
  let expiredStockValue = 0;
  let expiring30Count = 0;
  let expiring60Count = 0;
  let expiring90Count = 0;

  for (const med of medicines) {
    const sellable = getMedicineSellableStock(med, referenceDate);
    totalSellableStock += sellable;

    if (sellable === 0) {
      outOfStockCount += 1;
    } else if (sellable < med.minStockLevel) {
      lowStockCount += 1;
    }

    for (const batch of med.batches) {
      const qty = Math.max(0, batch.availableStock);
      if (qty === 0) continue;
      const { bucket } = classifyBatchExpiry(batch.expiryDate, referenceDate);
      if (bucket === 'expired') {
        expiredBatchCount += 1;
        expiredStockValue += qty * batch.purchasePrice;
      } else {
        totalInventoryPurchaseValue += qty * batch.purchasePrice;
        totalInventoryMrpValue += qty * batch.mrp;
        if (bucket === 'expiring_30') expiring30Count += 1;
        else if (bucket === 'expiring_60') expiring60Count += 1;
        else if (bucket === 'expiring_90') expiring90Count += 1;
      }
    }
  }

  return {
    totalMedicines: medicines.length,
    totalSellableStock,
    totalInventoryPurchaseValue: round2(totalInventoryPurchaseValue),
    totalInventoryMrpValue: round2(totalInventoryMrpValue),
    lowStockCount,
    outOfStockCount,
    expiredBatchCount,
    expiredStockValue: round2(expiredStockValue),
    expiring30Count,
    expiring60Count,
    expiring90Count,
    expiringSoonTotal: expiring30Count + expiring60Count + expiring90Count,
  };
}

export function isDuplicateInvoice(
  distributorGstin: string,
  invoiceNumber: string,
  existingInvoices: PurchaseInvoice[]
): PurchaseInvoice | undefined {
  const normGstin = normalizeGstin(distributorGstin);
  const normInv = normalizeKey(invoiceNumber);
  if (!normInv) return undefined;

  return existingInvoices.find((inv) => {
    const invNoMatch = normalizeKey(inv.invoiceNumber) === normInv;
    if (!invNoMatch) return false;
    if (normGstin && normalizeGstin(inv.distributorGstin)) {
      return normalizeGstin(inv.distributorGstin) === normGstin;
    }
    return true;
  });
}

export interface InvoiceValidationResult {
  isValid: boolean;
  isDuplicate: boolean;
  duplicateInvoice?: PurchaseInvoice;
  blockingErrors: string[];
  warnings: string[];
  itemErrors: Record<string, string[]>;
}

export function validateInvoiceDraft(
  draft: InvoiceDraft,
  existingInvoices: PurchaseInvoice[]
): InvoiceValidationResult {
  const blockingErrors: string[] = [];
  const warnings: string[] = [];
  const itemErrors: Record<string, string[]> = {};

  if (!draft.distributorName.trim()) {
    blockingErrors.push('Distributor name is required.');
  }
  if (!draft.invoiceNumber.trim()) {
    blockingErrors.push('Invoice number is required.');
  }
  if (!draft.invoiceDate.trim()) {
    blockingErrors.push('Invoice date is required.');
  }

  const normGstin = normalizeGstin(draft.distributorGstin);
  if (normGstin && normGstin.length !== 15) {
    warnings.push('GSTIN should be 15 alphanumeric characters (Indian GST format).');
  }

  const duplicate = isDuplicateInvoice(
    draft.distributorGstin,
    draft.invoiceNumber,
    existingInvoices
  );
  if (duplicate) {
    blockingErrors.push(
      `Duplicate invoice detected: ${duplicate.invoiceNumber} from ${duplicate.distributorName} was already imported on ${duplicate.invoiceDate}.`
    );
  }

  if (draft.items.length === 0) {
    blockingErrors.push('Invoice must contain at least one medicine line item.');
  }

  draft.items.forEach((item, idx) => {
    const errs: string[] = [];
    const label = `Row ${idx + 1}`;
    if (!item.medicineName.trim()) {
      errs.push('Medicine name is missing');
    }
    if (!item.batchNumber.trim()) {
      errs.push('Batch number is required (never guessed)');
    }
    if (!parseExpiryDate(item.expiryDate)) {
      errs.push('Valid expiry date is required (YYYY-MM-DD or MM/YYYY)');
    }
    if (item.quantity <= 0 && item.freeQuantity <= 0) {
      errs.push('Quantity must be greater than 0');
    }
    if (item.purchaseRate < 0 || item.mrp <= 0) {
      errs.push('MRP must be greater than ₹0 and rate cannot be negative');
    }
    if (item.mrp > 0 && item.purchaseRate > item.mrp) {
      warnings.push(
        `${label} (${item.medicineName || 'Unnamed'}): Purchase rate (₹${item.purchaseRate}) exceeds MRP (₹${item.mrp}).`
      );
    }
    if (item.uncertainFields.length > 0 && !item.verified) {
      errs.push(
        `Uncertain OCR fields require confirmation: ${item.uncertainFields.join(', ')}`
      );
    }
    if (errs.length > 0) {
      itemErrors[item.id] = errs;
      blockingErrors.push(`${label} (${item.medicineName || 'Item'}): ${errs.join('; ')}`);
    }
  });

  return {
    isValid: blockingErrors.length === 0,
    isDuplicate: Boolean(duplicate),
    duplicateInvoice: duplicate,
    blockingErrors,
    warnings,
    itemErrors,
  };
}

export function findMatchingDistributor(
  name: string,
  gstin: string,
  distributors: Distributor[]
): Distributor | undefined {
  const normG = normalizeGstin(gstin);
  if (normG) {
    const byGstin = distributors.find((d) => normalizeGstin(d.gstin) === normG);
    if (byGstin) return byGstin;
  }
  const normName = normalizeKey(name);
  if (!normName) return undefined;
  return distributors.find(
    (d) =>
      normalizeKey(d.name) === normName ||
      normalizeKey(d.name).includes(normName) ||
      normName.includes(normalizeKey(d.name))
  );
}

/**
 * Checks whether a draft line item will merge into an existing medicine+batch or create a new one.
 */
export function findExistingBatchMatch(
  medicineName: string,
  batchNumber: string,
  medicines: Medicine[]
): { medicine: Medicine; batch?: MedicineBatch } | null {
  const normMed = normalizeKey(medicineName);
  const normBatch = normalizeKey(batchNumber);
  if (!normMed) return null;

  const med = medicines.find(
    (m) =>
      normalizeKey(m.name) === normMed ||
      normalizeKey(m.brand) === normMed
  );
  if (!med) return null;

  const batch = normBatch
    ? med.batches.find((b) => normalizeKey(b.batchNumber) === normBatch)
    : undefined;

  return { medicine: med, batch };
}

/**
 * Commits a verified distributor invoice into PharmacyState:
 * - Blocks duplicates
 * - Auto-links or creates Distributor
 * - Merges existing Medicine + Batch stock (including free quantity!) instead of duplicating
 * - Tracks price change history, stock history, and audit log
 */
export function commitVerifiedInvoice(
  state: PharmacyState,
  draft: InvoiceDraft,
  nowIso: string = new Date().toISOString()
): { nextState: PharmacyState; createdInvoice: PurchaseInvoice; mergedBatchCount: number; newBatchCount: number } {
  const validation = validateInvoiceDraft(draft, state.invoices);
  if (!validation.isValid) {
    throw new Error(validation.blockingErrors[0] || 'Invoice validation failed.');
  }

  const normalizedItems = draft.items.map((item) =>
    recalculateLineItem({
      ...item,
      expiryDate: normalizeExpiryToIso(item.expiryDate),
      verified: true,
      uncertainFields: [],
    })
  );

  const totals = calculateInvoiceTotals(normalizedItems);

  // Match or create distributor
  let distributors = [...state.distributors];
  let matchedDist = findMatchingDistributor(
    draft.distributorName,
    draft.distributorGstin,
    distributors
  );

  if (!matchedDist) {
    matchedDist = {
      id: `dist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: draft.distributorName.trim(),
      gstin: normalizeGstin(draft.distributorGstin),
      contactNumber: draft.distributorPhone?.trim() || '',
      email: '',
      address: draft.distributorAddress?.trim() || 'India',
      outstandingPayment: totals.grandTotal,
      createdAt: nowIso,
    };
    distributors = [matchedDist, ...distributors];
  } else {
    distributors = distributors.map((d) =>
      d.id === matchedDist!.id
        ? {
            ...d,
            outstandingPayment: round2(d.outstandingPayment + totals.grandTotal),
            gstin: d.gstin || normalizeGstin(draft.distributorGstin),
          }
        : d
    );
  }

  const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const createdInvoice: PurchaseInvoice = {
    id: invoiceId,
    invoiceNumber: draft.invoiceNumber.trim(),
    invoiceDate: draft.invoiceDate.trim(),
    distributorId: matchedDist.id,
    distributorName: matchedDist.name,
    distributorGstin: matchedDist.gstin || normalizeGstin(draft.distributorGstin),
    items: normalizedItems,
    subtotalTaxable: totals.subtotalTaxable,
    totalDiscount: totals.totalDiscount,
    cgstAmount: totals.cgstAmount,
    sgstAmount: totals.sgstAmount,
    totalGstAmount: totals.totalGstAmount,
    grandTotal: totals.grandTotal,
    totalUnitsAdded: totals.totalUnitsAdded,
    imageUrls: draft.imageUrls,
    gstReconciled: true,
    importedBy: state.user.name,
    createdAt: nowIso,
    notes: draft.notes,
  };

  let medicines = state.medicines.map((m) => ({
    ...m,
    batches: [...m.batches],
    priceHistory: [...m.priceHistory],
  }));
  const newStockHistory = [...state.stockHistory];
  let mergedBatchCount = 0;
  let newBatchCount = 0;

  for (const item of normalizedItems) {
    const unitsToAdd = Math.max(0, item.quantity) + Math.max(0, item.freeQuantity);
    const match = findExistingBatchMatch(item.medicineName, item.batchNumber, medicines);

    if (match) {
      const targetMed = medicines.find((m) => m.id === match.medicine.id)!;
      if (match.batch) {
        // Merge into existing batch!
        mergedBatchCount += 1;
        const prevBatch = match.batch;
        const nextStock = prevBatch.availableStock + unitsToAdd;
        if (
          prevBatch.purchasePrice !== item.purchaseRate ||
          prevBatch.mrp !== item.mrp
        ) {
          targetMed.priceHistory.unshift({
            id: `ph_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            date: draft.invoiceDate,
            batchNumber: prevBatch.batchNumber,
            previousPurchasePrice: prevBatch.purchasePrice,
            newPurchasePrice: item.purchaseRate,
            previousMrp: prevBatch.mrp,
            newMrp: item.mrp,
            distributorName: matchedDist.name,
            invoiceNumber: createdInvoice.invoiceNumber,
          });
        }
        targetMed.batches = targetMed.batches.map((b) =>
          b.id === prevBatch.id
            ? {
                ...b,
                availableStock: nextStock,
                freeQuantityReceived: b.freeQuantityReceived + item.freeQuantity,
                purchasePrice: item.purchaseRate,
                mrp: item.mrp,
                sellingPrice: item.mrp,
                lastInvoiceNumber: createdInvoice.invoiceNumber,
              }
            : b
        );
        targetMed.updatedAt = nowIso;

        newStockHistory.unshift({
          id: `sh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          timestamp: nowIso,
          medicineId: targetMed.id,
          medicineName: targetMed.name,
          batchNumber: prevBatch.batchNumber,
          type: 'purchase',
          quantityDelta: unitsToAdd,
          resultingStock: nextStock,
          reason: `Merged batch via Bill ${createdInvoice.invoiceNumber} (${item.quantity} + ${item.freeQuantity} free)`,
          actorName: state.user.name,
          referenceId: invoiceId,
        });
      } else {
        // Existing medicine, new batch
        newBatchCount += 1;
        const latestExisting = targetMed.batches[0];
        if (
          latestExisting &&
          (latestExisting.purchasePrice !== item.purchaseRate ||
            latestExisting.mrp !== item.mrp)
        ) {
          targetMed.priceHistory.unshift({
            id: `ph_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            date: draft.invoiceDate,
            batchNumber: item.batchNumber.trim(),
            previousPurchasePrice: latestExisting.purchasePrice,
            newPurchasePrice: item.purchaseRate,
            previousMrp: latestExisting.mrp,
            newMrp: item.mrp,
            distributorName: matchedDist.name,
            invoiceNumber: createdInvoice.invoiceNumber,
          });
        }

        const newBatch: MedicineBatch = {
          id: `bat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          batchNumber: item.batchNumber.trim(),
          expiryDate: item.expiryDate,
          mrp: item.mrp,
          purchasePrice: item.purchaseRate,
          sellingPrice: item.mrp,
          availableStock: unitsToAdd,
          freeQuantityReceived: item.freeQuantity,
          gstPercent: item.gstPercent,
          hsnCode: item.hsnCode || targetMed.hsnCode,
          packSize: item.packSize || '10T',
          distributorId: matchedDist.id,
          distributorName: matchedDist.name,
          addedAt: nowIso,
          lastInvoiceNumber: createdInvoice.invoiceNumber,
        };
        targetMed.batches.unshift(newBatch);
        targetMed.updatedAt = nowIso;

        newStockHistory.unshift({
          id: `sh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          timestamp: nowIso,
          medicineId: targetMed.id,
          medicineName: targetMed.name,
          batchNumber: newBatch.batchNumber,
          type: 'purchase',
          quantityDelta: unitsToAdd,
          resultingStock: unitsToAdd,
          reason: `New batch via Bill ${createdInvoice.invoiceNumber} (${item.quantity} + ${item.freeQuantity} free)`,
          actorName: state.user.name,
          referenceId: invoiceId,
        });
      }
    } else {
      // Create brand new medicine record
      newBatchCount += 1;
      const newMedId = `med_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newBatch: MedicineBatch = {
        id: `bat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        batchNumber: item.batchNumber.trim(),
        expiryDate: item.expiryDate,
        mrp: item.mrp,
        purchasePrice: item.purchaseRate,
        sellingPrice: item.mrp,
        availableStock: unitsToAdd,
        freeQuantityReceived: item.freeQuantity,
        gstPercent: item.gstPercent,
        hsnCode: item.hsnCode || '30049099',
        packSize: item.packSize || '10T',
        distributorId: matchedDist.id,
        distributorName: matchedDist.name,
        addedAt: nowIso,
        lastInvoiceNumber: createdInvoice.invoiceNumber,
      };

      const newMedicine: Medicine = {
        id: newMedId,
        name: item.medicineName.trim(),
        genericName: item.genericName?.trim() || item.medicineName.trim(),
        brand: item.brandName?.trim() || item.medicineName.trim(),
        manufacturer: item.manufacturer?.trim() || 'Indian Pharma',
        composition: item.composition?.trim() || item.genericName?.trim() || 'As per label',
        category: item.category || 'Other',
        minStockLevel: 15,
        gstPercent: item.gstPercent,
        hsnCode: item.hsnCode || '30049099',
        barcode: `890${String(Math.floor(1000000000 + Math.random() * 8999999999))}`,
        rackLocation: 'New Stock',
        batches: [newBatch],
        priceHistory: [],
        updatedAt: nowIso,
      };
      medicines = [newMedicine, ...medicines];

      newStockHistory.unshift({
        id: `sh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: nowIso,
        medicineId: newMedId,
        medicineName: newMedicine.name,
        batchNumber: newBatch.batchNumber,
        type: 'purchase',
        quantityDelta: unitsToAdd,
        resultingStock: unitsToAdd,
        reason: `Imported via Bill ${createdInvoice.invoiceNumber} (${item.quantity} + ${item.freeQuantity} free)`,
        actorName: state.user.name,
        referenceId: invoiceId,
      });
    }
  }

  const nextAudit = [
    {
      id: `aud_${Date.now()}`,
      timestamp: nowIso,
      actorName: state.user.name,
      actorRole: state.user.role,
      action: 'Imported Purchase Invoice',
      entityType: 'invoice' as const,
      entityName: createdInvoice.invoiceNumber,
      details: `${matchedDist.name} · ${normalizedItems.length} items · ${totals.totalUnitsAdded} units (${mergedBatchCount} merged, ${newBatchCount} new) · ₹${totals.grandTotal.toFixed(2)}`,
    },
    ...state.auditLogs,
  ];

  return {
    nextState: {
      ...state,
      medicines,
      distributors,
      invoices: [createdInvoice, ...state.invoices],
      stockHistory: newStockHistory,
      auditLogs: nextAudit,
      lastSyncedAt: nowIso,
    },
    createdInvoice,
    mergedBatchCount,
    newBatchCount,
  };
}

export interface ReorderSuggestion {
  medicineId: string;
  medicineName: string;
  brand: string;
  category: string;
  availableSellable: number;
  minStockLevel: number;
  suggestedReorderQty: number;
  lastDistributorName: string;
  lastDistributorId: string;
  estimatedCost: number;
  status: 'out_of_stock' | 'low_stock';
}

export function buildReorderList(
  medicines: Medicine[],
  referenceDate: Date = new Date()
): ReorderSuggestion[] {
  const list: ReorderSuggestion[] = [];

  for (const med of medicines) {
    const available = getMedicineSellableStock(med, referenceDate);
    if (available < med.minStockLevel) {
      const latestBatch = med.batches[0];
      const suggested = Math.max(med.minStockLevel * 2 - available, med.minStockLevel);
      const unitRate = latestBatch?.purchasePrice || 0;
      list.push({
        medicineId: med.id,
        medicineName: med.name,
        brand: med.brand,
        category: med.category,
        availableSellable: available,
        minStockLevel: med.minStockLevel,
        suggestedReorderQty: suggested,
        lastDistributorName: latestBatch?.distributorName || 'Unassigned',
        lastDistributorId: latestBatch?.distributorId || '',
        estimatedCost: round2(suggested * unitRate),
        status: available === 0 ? 'out_of_stock' : 'low_stock',
      });
    }
  }

  return list.sort((a, b) => a.availableSellable - b.availableSellable);
}

export function formatINR(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatShortDate(dateStr: string): string {
  const d = parseExpiryDate(dateStr);
  if (!d) return dateStr || '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatExpiryMonthYear(dateStr: string): string {
  const d = parseExpiryDate(dateStr);
  if (!d) return dateStr || '—';
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${mm}/${yyyy}`;
}
