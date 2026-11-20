import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSeedState } from '../data/seedData';
import { mergePharmacyStates } from './syncMerge';
import type { Medicine } from './types';

function makeMedicine(id: string, name: string, updatedAt: string, stock = 20): Medicine {
  return {
    id,
    name,
    genericName: 'Test Salt 500mg',
    brand: name.split(' ')[0],
    manufacturer: 'Cipla Ltd',
    composition: 'Test Salt 500mg',
    category: 'Antibiotics',
    minStockLevel: 10,
    gstPercent: 12,
    hsnCode: '30049099',
    barcode: `890123456${id.slice(-4)}`,
    rackLocation: 'A-1',
    batches: [
      {
        id: `bat_${id}`,
        batchNumber: `B_${id.toUpperCase()}`,
        expiryDate: '2028-06-30',
        mrp: 120,
        purchasePrice: 88,
        sellingPrice: 120,
        availableStock: stock,
        freeQuantityReceived: 0,
        gstPercent: 12,
        hsnCode: '30049099',
        packSize: '10T',
        distributorId: 'dist_1',
        distributorName: 'Mahaveer Pharma',
        addedAt: updatedAt,
      },
    ],
    priceHistory: [],
    updatedAt,
  };
}

test('merges medicines added concurrently on Android and Web without data loss', () => {
  const base = createInitialSeedState();
  const androidState = {
    ...base,
    medicines: [makeMedicine('med_android', 'Augmentin 625', '2026-11-19T10:01:00Z'), ...base.medicines],
  };
  const webState = {
    ...base,
    medicines: [makeMedicine('med_web', 'Azithral 500', '2026-11-19T10:02:00Z'), ...base.medicines],
  };

  const merged = mergePharmacyStates(webState, androidState);
  assert.ok(merged.medicines.some((m) => m.id === 'med_android'));
  assert.ok(merged.medicines.some((m) => m.id === 'med_web'));
  assert.equal(merged.medicines.length, base.medicines.length + 2);
});

test('deduplicates identical medicine added offline on two devices simultaneously', () => {
  const base = createInitialSeedState();
  const medA = makeMedicine('med_a', 'Calpol 650', '2026-11-19T10:00:00Z', 15);
  const medB = makeMedicine('med_b', 'Calpol 650', '2026-11-19T10:05:00Z', 30);

  const serverState = { ...base, medicines: [medA, ...base.medicines] };
  const incomingState = { ...base, medicines: [medB, ...base.medicines] };

  const merged = mergePharmacyStates(serverState, incomingState);
  const matches = merged.medicines.filter((m) => m.name === 'Calpol 650');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].batches.length, 2);
});

test('respects delete tombstones so deleted medicine is not resurrected by stale client', () => {
  const base = createInitialSeedState();
  const targetId = base.medicines[0].id;

  const androidDeleted = {
    ...base,
    medicines: base.medicines.filter((m) => m.id !== targetId),
    deletedMedicineIds: [targetId],
  };

  const merged = mergePharmacyStates(base, androidDeleted);
  assert.equal(merged.medicines.some((m) => m.id === targetId), false);
  assert.ok(merged.deletedMedicineIds?.includes(targetId));

  // Even if stale web client sends old list containing targetId, tombstone keeps it deleted
  const mergedAgain = mergePharmacyStates(merged, base);
  assert.equal(mergedAgain.medicines.some((m) => m.id === targetId), false);
});

test('last-write-wins on concurrent edit of same medicine preserves newer update', () => {
  const base = createInitialSeedState();
  const target = base.medicines[0];

  const older = {
    ...base,
    medicines: base.medicines.map((m) =>
      m.id === target.id ? { ...m, minStockLevel: 15, updatedAt: '2026-11-19T10:00:00Z' } : m
    ),
  };
  const newer = {
    ...base,
    medicines: base.medicines.map((m) =>
      m.id === target.id ? { ...m, minStockLevel: 45, updatedAt: '2026-11-19T10:05:00Z' } : m
    ),
  };

  const merged = mergePharmacyStates(older, newer);
  const result = merged.medicines.find((m) => m.id === target.id);
  assert.equal(result?.minStockLevel, 45);
});
