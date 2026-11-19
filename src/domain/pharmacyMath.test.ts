import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReorderList,
  calculateInvoiceTotals,
  calculateLineItemMath,
  classifyBatchExpiry,
  commitVerifiedInvoice,
  computeDashboardStats,
  getMedicineExpiredStock,
  getMedicineSellableStock,
  normalizeExpiryToIso,
  validateInvoiceDraft,
} from './pharmacyMath';
import type { InvoiceDraft, Medicine, PharmacyState } from './types';

test('calculateLineItemMath computes discount, GST, CGST/SGST, and free quantity stock accurately', () => {
  const math = calculateLineItemMath({
    quantity: 20,
    freeQuantity: 2,
    purchaseRate: 22.5,
    discountPercent: 0,
    gstPercent: 12,
  });

  assert.equal(math.grossAmount, 450);
  assert.equal(math.taxableAmount, 450);
  assert.equal(math.gstAmount, 54);
  assert.equal(math.cgstAmount, 27);
  assert.equal(math.sgstAmount, 27);
  assert.equal(math.totalAmount, 504);
  assert.equal(math.totalUnitsAdded, 22);
  assert.equal(math.effectiveUnitCost, 22.91);
});

test('calculateLineItemMath applies trade discount before GST', () => {
  const math = calculateLineItemMath({
    quantity: 10,
    freeQuantity: 0,
    purchaseRate: 100,
    discountPercent: 10,
    gstPercent: 12,
  });
  assert.equal(math.grossAmount, 1000);
  assert.equal(math.discountAmount, 100);
  assert.equal(math.taxableAmount, 900);
  assert.equal(math.gstAmount, 108);
  assert.equal(math.totalAmount, 1008);
});

test('classifyBatchExpiry categorizes expired, 30, 60, 90, and safe buckets accurately', () => {
  const ref = new Date('2026-11-18T00:00:00Z');
  assert.equal(classifyBatchExpiry('2026-11-10', ref).bucket, 'expired');
  assert.equal(classifyBatchExpiry('2026-12-05', ref).bucket, 'expiring_30');
  assert.equal(classifyBatchExpiry('2027-01-10', ref).bucket, 'expiring_60');
  assert.equal(classifyBatchExpiry('2027-02-05', ref).bucket, 'expiring_90');
  assert.equal(classifyBatchExpiry('2028-08-31', ref).bucket, 'safe');
  assert.equal(normalizeExpiryToIso('08/2028'), '2028-08-31');
});

test('expired batches are NEVER counted as sellable stock', () => {
  const ref = new Date('2026-11-18T00:00:00Z');
  const med: Medicine = {
    id: 'm1',
    name: 'Dolo 650 Tab',
    genericName: 'Paracetamol 650mg',
    brand: 'Dolo',
    manufacturer: 'Micro Labs',
    composition: 'Paracetamol IP 650mg',
    category: 'Analgesics & Antipyretics',
    minStockLevel: 20,
    gstPercent: 12,
    hsnCode: '30049099',
    barcode: '8901111111111',
    batches: [
      {
        id: 'b_exp',
        batchNumber: 'OLD100',
        expiryDate: '2026-10-31',
        mrp: 33.8,
        purchasePrice: 22.5,
        sellingPrice: 33.8,
        availableStock: 40,
        freeQuantityReceived: 0,
        gstPercent: 12,
        hsnCode: '30049099',
        packSize: '15T',
        distributorId: 'd1',
        distributorName: 'Mahaveer Pharma',
        addedAt: '2025-11-01T00:00:00Z',
      },
      {
        id: 'b_ok',
        batchNumber: 'NEW200',
        expiryDate: '2028-06-30',
        mrp: 33.8,
        purchasePrice: 22.5,
        sellingPrice: 33.8,
        availableStock: 15,
        freeQuantityReceived: 0,
        gstPercent: 12,
        hsnCode: '30049099',
        packSize: '15T',
        distributorId: 'd1',
        distributorName: 'Mahaveer Pharma',
        addedAt: '2026-10-01T00:00:00Z',
      },
    ],
    priceHistory: [],
    updatedAt: '2026-11-01T00:00:00Z',
  };

  assert.equal(getMedicineSellableStock(med, ref), 15);
  assert.equal(getMedicineExpiredStock(med, ref), 40);

  const stats = computeDashboardStats([med], ref);
  assert.equal(stats.totalSellableStock, 15);
  assert.equal(stats.expiredBatchCount, 1);
  assert.equal(stats.expiredStockValue, 900);
  assert.equal(stats.lowStockCount, 1);

  const reorders = buildReorderList([med], ref);
  assert.equal(reorders.length, 1);
  assert.equal(reorders[0].availableSellable, 15);
  assert.equal(reorders[0].suggestedReorderQty, 25);
});

test('validateInvoiceDraft blocks missing batch/expiry, uncertain unverified fields, and duplicate invoices', () => {
  const existing = [
    {
      id: 'inv_1',
      invoiceNumber: 'MPD/2026-27/1842',
      invoiceDate: '2026-11-14',
      distributorId: 'd1',
      distributorName: 'Mahaveer Pharma Distributors',
      distributorGstin: '27AABCM4821K1Z5',
      items: [],
      subtotalTaxable: 0,
      totalDiscount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      totalGstAmount: 0,
      grandTotal: 0,
      totalUnitsAdded: 0,
      imageUrls: [],
      gstReconciled: true,
      importedBy: 'Owner',
      createdAt: '2026-11-14T00:00:00Z',
    },
  ];

  const badDraft: InvoiceDraft = {
    distributorName: 'Mahaveer Pharma Distributors',
    distributorGstin: '27AABCM4821K1Z5',
    invoiceNumber: 'MPD/2026-27/1842',
    invoiceDate: '2026-11-14',
    imageUrls: [],
    items: [
      {
        id: 'li1',
        medicineName: 'Dolo 650 Tab',
        brandName: 'Dolo',
        manufacturer: 'Micro Labs',
        batchNumber: '',
        hsnCode: '30049099',
        packSize: '15T',
        quantity: 10,
        freeQuantity: 0,
        purchaseRate: 22.5,
        mrp: 33.8,
        discountPercent: 0,
        gstPercent: 12,
        gstAmount: 27,
        taxableAmount: 225,
        totalAmount: 252,
        expiryDate: '',
        uncertainFields: ['batchNumber'],
        verified: false,
      },
    ],
  };

  const result = validateInvoiceDraft(badDraft, existing);
  assert.equal(result.isValid, false);
  assert.equal(result.isDuplicate, true);
  assert.ok(result.itemErrors['li1'].length >= 2);
});

test('commitVerifiedInvoice merges stock into existing medicine+batch instead of creating duplicate batch', () => {
  const initialState: PharmacyState = {
    medicines: [
      {
        id: 'med_dolo',
        name: 'Dolo 650 Tab',
        genericName: 'Paracetamol 650mg',
        brand: 'Dolo',
        manufacturer: 'Micro Labs',
        composition: 'Paracetamol IP 650mg',
        category: 'Analgesics & Antipyretics',
        minStockLevel: 20,
        gstPercent: 12,
        hsnCode: '30049099',
        barcode: '8901234567890',
        batches: [
          {
            id: 'bat_1',
            batchNumber: 'DL2608A',
            expiryDate: '2028-08-31',
            mrp: 33.8,
            purchasePrice: 22.0,
            sellingPrice: 33.8,
            availableStock: 10,
            freeQuantityReceived: 0,
            gstPercent: 12,
            hsnCode: '30049099',
            packSize: '15T',
            distributorId: 'dist_1',
            distributorName: 'Mahaveer Pharma Distributors',
            addedAt: '2026-10-01T00:00:00Z',
          },
        ],
        priceHistory: [],
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ],
    distributors: [
      {
        id: 'dist_1',
        name: 'Mahaveer Pharma Distributors',
        gstin: '27AABCM4821K1Z5',
        contactNumber: '+91 98220 44110',
        email: 'billing@mahaveerpharma.in',
        address: 'Pune',
        outstandingPayment: 1000,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ],
    invoices: [],
    stockHistory: [],
    auditLogs: [],
    purchaseReturns: [],
    readNotificationIds: [],
    recentSearches: [],
    user: {
      id: 'u1',
      name: 'Dr. Suresh Sharma',
      email: 'suresh@shreeganeshmedicals.in',
      phone: '+91 98231 55001',
      role: 'owner',
      storeName: 'Shree Ganesh Medicals',
      storeGstin: '27AABCS1429B1Z1',
      drugLicenseNumber: 'MH-PN1-20-41892',
      storeAddress: 'FC Road, Pune',
    },
    lastSyncedAt: '2026-11-18T00:00:00Z',
  };

  const draft: InvoiceDraft = {
    distributorName: 'Mahaveer Pharma Distributors',
    distributorGstin: '27AABCM4821K1Z5',
    invoiceNumber: 'MPD/2026-27/1842',
    invoiceDate: '2026-11-14',
    imageUrls: [],
    items: [
      {
        id: 'li1',
        medicineName: 'Dolo 650 Tab',
        brandName: 'Dolo',
        manufacturer: 'Micro Labs',
        batchNumber: 'DL2608A',
        hsnCode: '30049099',
        packSize: '15T',
        quantity: 20,
        freeQuantity: 2,
        purchaseRate: 22.5,
        mrp: 33.8,
        discountPercent: 0,
        gstPercent: 12,
        gstAmount: 54,
        taxableAmount: 450,
        totalAmount: 504,
        expiryDate: '08/2028',
        uncertainFields: [],
        verified: true,
      },
    ],
  };

  const totals = calculateInvoiceTotals(draft.items);
  assert.equal(totals.totalUnitsAdded, 22);
  assert.equal(totals.grandTotal, 504);

  const { nextState, mergedBatchCount, newBatchCount } = commitVerifiedInvoice(
    initialState,
    draft,
    '2026-11-18T10:00:00Z'
  );

  assert.equal(mergedBatchCount, 1);
  assert.equal(newBatchCount, 0);
  const updatedMed = nextState.medicines.find((m) => m.id === 'med_dolo')!;
  assert.equal(updatedMed.batches.length, 1);
  assert.equal(updatedMed.batches[0].availableStock, 32); // 10 existing + 20 qty + 2 free
  assert.equal(updatedMed.batches[0].purchasePrice, 22.5);
  assert.equal(updatedMed.priceHistory.length, 1);
  assert.equal(nextState.invoices.length, 1);
  assert.equal(nextState.distributors[0].outstandingPayment, 1504);
});
