import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Edit3,
  History,
  Plus,
  Search,
  Share2,
  Square,
  Trash2,
} from 'lucide-react';
import {
  classifyBatchExpiry,
  formatExpiryMonthYear,
  formatINR,
  formatShortDate,
  getMedicineExpiredStock,
  getMedicineNearestExpiry,
  getMedicineSellableStock,
  normalizeExpiryToIso,
  parseExpiryDate,
} from '../domain/pharmacyMath';
import type {
  AppScreen,
  Medicine,
  MedicineBatch,
  MedicineCategory,
  PharmacyState,
  StockHistoryEvent,
} from '../domain/types';
import { buildMedicineWhatsAppMessage } from '../utils/reportGenerators';

const CATEGORIES: MedicineCategory[] = [
  'Antibiotics',
  'Analgesics & Antipyretics',
  'Cardiac & BP',
  'Diabetes Care',
  'Gastro & Antacids',
  'Respiratory & Allergy',
  'Vitamins & Supplements',
  'Dermatology',
  'Pediatrics',
  'Other',
];

// =========================================================================
// SCREEN 9: MEDICINE INVENTORY LIST
// =========================================================================
export function InventoryListScreen({
  state,
  onNavigate,
  onExportSelected,
}: {
  state: PharmacyState;
  onNavigate: (screen: AppScreen, entityId?: string) => void;
  onExportSelected?: (medicineIds: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [manufacturerFilter, setManufacturerFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'in_stock' | 'low_stock' | 'out_of_stock' | 'has_expired'
  >('all');
  const [sortBy, setSortBy] = useState<'name' | 'qty' | 'price' | 'expiry'>('name');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const manufacturers = useMemo(
    () =>
      Array.from(new Set(state.medicines.map((m) => m.manufacturer).filter(Boolean))).sort(),
    [state.medicines]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.medicines
      .filter((med) => {
        if (categoryFilter !== 'all' && med.category !== categoryFilter) return false;
        if (manufacturerFilter !== 'all' && med.manufacturer !== manufacturerFilter)
          return false;

        const sellable = getMedicineSellableStock(med);
        const expired = getMedicineExpiredStock(med);

        if (statusFilter === 'in_stock' && sellable < med.minStockLevel) return false;
        if (
          statusFilter === 'low_stock' &&
          !(sellable > 0 && sellable < med.minStockLevel)
        )
          return false;
        if (statusFilter === 'out_of_stock' && sellable !== 0) return false;
        if (statusFilter === 'has_expired' && expired === 0) return false;

        if (!q) return true;
        return (
          med.name.toLowerCase().includes(q) ||
          med.genericName.toLowerCase().includes(q) ||
          med.brand.toLowerCase().includes(q) ||
          med.manufacturer.toLowerCase().includes(q) ||
          med.barcode.toLowerCase().includes(q) ||
          med.batches.some((b) => b.batchNumber.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        if (sortBy === 'qty')
          return getMedicineSellableStock(b) - getMedicineSellableStock(a);
        if (sortBy === 'price')
          return (b.batches[0]?.mrp || 0) - (a.batches[0]?.mrp || 0);
        return (
          getMedicineNearestExpiry(a).daysRemaining -
          getMedicineNearestExpiry(b).daysRemaining
        );
      });
  }, [state.medicines, query, categoryFilter, manufacturerFilter, statusFilter, sortBy]);

  useEffect(() => {
    setPage(1);
  }, [query, categoryFilter, manufacturerFilter, statusFilter, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const allVisibleSelected =
    paginated.length > 0 && paginated.every((m) => selectedIds.includes(m.id));

  const toggleSelectPage = () => {
    if (allVisibleSelected) {
      const pageIdSet = new Set(paginated.map((m) => m.id));
      setSelectedIds((prev) => prev.filter((id) => !pageIdSet.has(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...paginated.map((m) => m.id)])));
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
            Medicine Inventory
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            {filtered.length} of {state.medicines.length} medicines · Expired stock automatically excluded from sellable count
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('export_center')}
            className="inline-flex items-center gap-1.5 h-10 sm:h-11 px-3.5 sm:px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Share2 className="w-4 h-4" />
            <span>Export</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('medicine_form')}
            className="inline-flex items-center gap-2 h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Add Medicine</span>
          </button>
        </div>
      </div>

      {/* Multi-select Export Action Bar */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-teal-200 bg-teal-50/90 px-4 py-3 dark:border-teal-800 dark:bg-teal-950/50">
          <p className="text-xs sm:text-sm font-semibold text-teal-900 dark:text-teal-200">
            {selectedIds.length} medicine{selectedIds.length !== 1 ? 's' : ''} selected
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="rounded-lg border border-teal-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-teal-800 dark:bg-slate-900 dark:text-slate-200"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => onExportSelected?.(selectedIds)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>Export Selected (Excel / PDF / WhatsApp)</span>
            </button>
          </div>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3.5">
        <div className="grid sm:grid-cols-2 lg:grid-cols-12 gap-3">
          <div className="lg:col-span-5 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              aria-label="Filter inventory by name, brand, batch, or barcode"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, generic, brand, batch, or barcode..."
              className="w-full h-10 pl-10 pr-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <div className="lg:col-span-3">
            <select
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200"
            >
              <option value="all">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-2">
            <select
              aria-label="Filter by manufacturer"
              value={manufacturerFilter}
              onChange={(e) => setManufacturerFilter(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200"
            >
              <option value="all">All Manufacturers</option>
              {manufacturers.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-2">
            <div className="relative flex items-center">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
              <select
                aria-label="Sort medicines"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="w-full h-10 pl-8 pr-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-200"
              >
                <option value="name">Sort: Name</option>
                <option value="qty">Sort: Stock Qty</option>
                <option value="price">Sort: MRP</option>
                <option value="expiry">Sort: Expiry</option>
              </select>
            </div>
          </div>
        </div>

        {/* Status Segmented Tabs (horizontally scrollable on narrow Android screens) */}
        <div className="max-w-full overflow-x-auto no-scrollbar">
          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 min-w-max">
          {(
            [
              ['all', 'All Stock'],
              ['in_stock', 'Healthy'],
              ['low_stock', 'Low Stock'],
              ['out_of_stock', 'Out of Stock'],
              ['has_expired', 'Has Expired Batch'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setStatusFilter(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                statusFilter === id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
          </div>
        </div>
      </div>

      {/* Inventory Table / Responsive List */}
      <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No medicines match the selected filters.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setCategoryFilter('all');
                setManufacturerFilter('all');
                setStatusFilter('all');
              }}
              className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <>
            {/* Mobile Responsive Card List (Android 360px - 767px) */}
            <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800/80">
              {paginated.map((med) => {
                const sellable = getMedicineSellableStock(med);
                const expired = getMedicineExpiredStock(med);
                const nearest = getMedicineNearestExpiry(med);
                const latestBatch = med.batches[0];
                const isSelected = selectedIds.includes(med.id);

                return (
                  <div key={med.id} className="p-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <button
                          type="button"
                          onClick={() => toggleSelect(med.id)}
                          aria-label={`Select ${med.name}`}
                          className="mt-0.5 text-slate-400 hover:text-teal-700 shrink-0"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-5 h-5 text-teal-700 dark:text-teal-400" />
                          ) : (
                            <Square className="w-5 h-5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onNavigate('medicine_detail', med.id)}
                          className="text-left min-w-0"
                        >
                          <p className="font-semibold text-sm text-slate-900 dark:text-white leading-snug break-words">
                            {med.name}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {med.genericName} · {med.manufacturer}
                          </p>
                        </button>
                      </div>
                      <div className="text-right font-mono-num shrink-0">
                        <p
                          className={`text-sm font-bold ${
                            sellable === 0
                              ? 'text-red-700 dark:text-red-400'
                              : sellable < med.minStockLevel
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {sellable} u
                        </p>
                        <p className="text-[11px] text-slate-500">Min {med.minStockLevel}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pl-7 text-xs">
                      <div className="text-slate-600 dark:text-slate-300">
                        {nearest.batch ? (
                          <span
                            className={`font-medium ${
                              nearest.bucket === 'expired'
                                ? 'text-red-700 dark:text-red-400'
                                : nearest.bucket !== 'safe'
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : ''
                            }`}
                          >
                            Exp {formatExpiryMonthYear(nearest.batch.expiryDate)}
                            {expired > 0 ? ` · ${expired} exp` : ''}
                          </span>
                        ) : (
                          <span>No batches</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5">
                        {latestBatch && (
                          <span className="font-mono-num font-semibold text-slate-800 dark:text-slate-200">
                            MRP {formatINR(latestBatch.mrp)}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => onNavigate('medicine_detail', med.id)}
                          className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold text-teal-700 dark:text-teal-400"
                        >
                          Details
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Full Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900/40">
                    <th className="py-3 pl-4 pr-2 w-10">
                      <button
                        type="button"
                        onClick={toggleSelectPage}
                        aria-label="Select all medicines on page"
                        className="text-slate-500 hover:text-teal-700"
                      >
                        {allVisibleSelected ? (
                          <CheckSquare className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-4">Medicine & Composition</th>
                    <th className="py-3 px-4">Batches & Nearest Expiry</th>
                    <th className="py-3 px-4 text-right">Purchase / MRP</th>
                    <th className="py-3 px-4 text-right">Sellable Stock</th>
                    <th className="py-3 px-5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                  {paginated.map((med) => {
                    const sellable = getMedicineSellableStock(med);
                    const expired = getMedicineExpiredStock(med);
                    const nearest = getMedicineNearestExpiry(med);
                    const latestBatch = med.batches[0];
                    const isSelected = selectedIds.includes(med.id);

                    return (
                      <tr
                        key={med.id}
                        className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${
                          isSelected ? 'bg-teal-50/40 dark:bg-teal-950/20' : ''
                        }`}
                      >
                        <td className="py-3.5 pl-4 pr-2">
                          <button
                            type="button"
                            onClick={() => toggleSelect(med.id)}
                            aria-label={`Select ${med.name}`}
                            className="text-slate-400 hover:text-teal-700"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        </td>
                        <td className="py-3.5 px-4">
                          <button
                            type="button"
                            onClick={() => onNavigate('medicine_detail', med.id)}
                            className="text-left group"
                          >
                            <p className="font-semibold text-slate-900 dark:text-white group-hover:text-teal-700 dark:group-hover:text-teal-400">
                              {med.name}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              {med.genericName} · {med.manufacturer} · {med.category}
                            </p>
                          </button>
                        </td>
                        <td className="py-3.5 px-4">
                          <p className="font-mono-num text-xs font-medium text-slate-800 dark:text-slate-200">
                            {med.batches.length} batch{med.batches.length !== 1 ? 'es' : ''}
                            {nearest.batch ? ` · ${nearest.batch.batchNumber}` : ''}
                          </p>
                          {nearest.batch && (
                            <p
                              className={`text-xs mt-0.5 font-medium ${
                                nearest.bucket === 'expired'
                                  ? 'text-red-700 dark:text-red-400'
                                  : nearest.bucket !== 'safe'
                                    ? 'text-amber-700 dark:text-amber-400'
                                    : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              Exp {formatExpiryMonthYear(nearest.batch.expiryDate)}
                              {nearest.bucket === 'expired'
                                ? ' · Expired'
                                : nearest.bucket !== 'safe'
                                  ? ` · ${nearest.daysRemaining}d left`
                                  : ''}
                            </p>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num">
                          {latestBatch ? (
                            <>
                              <p className="font-semibold text-slate-900 dark:text-white">
                                {formatINR(latestBatch.mrp)}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                Buy {formatINR(latestBatch.purchasePrice)} · {med.gstPercent}% GST
                              </p>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-num">
                          <p
                            className={`font-bold ${
                              sellable === 0
                                ? 'text-red-700 dark:text-red-400'
                                : sellable < med.minStockLevel
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            {sellable} units
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Min {med.minStockLevel}
                            {expired > 0 ? ` · ${expired} expired` : ''}
                          </p>
                        </td>
                        <td className="py-3.5 px-5 text-right">
                          <button
                            type="button"
                            onClick={() => onNavigate('medicine_detail', med.id)}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800 px-4 py-3 text-xs">
                <span className="text-slate-500 dark:text-slate-400">
                  Page {safePage} of {totalPages} ({filtered.length} items)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-40"
                  >
                    Next
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// SCREEN 10: MEDICINE DETAILS (WITH BATCHES, ADJUSTMENT, PRICE & STOCK HISTORY)
// =========================================================================
export function MedicineDetailScreen({
  medicine,
  state,
  onNavigate,
  onAdjustStock,
  onDeleteMedicine,
  onCreateReturn,
  onOpenWhatsapp,
  onShowToast,
}: {
  medicine: Medicine | undefined;
  state: PharmacyState;
  onNavigate: (screen: AppScreen, entityId?: string) => void;
  onAdjustStock: (
    medicineId: string,
    batchId: string,
    delta: number,
    type: StockHistoryEvent['type'],
    reason: string
  ) => void;
  onDeleteMedicine: (id: string) => void;
  onCreateReturn: (input: {
    medicineId: string;
    batchId: string;
    quantity: number;
    reason: 'expired' | 'near_expiry' | 'damaged' | 'excess_stock' | 'rate_mismatch';
  }) => void;
  onOpenWhatsapp?: (title: string, message: string) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string) => void;
}) {
  const [selectedBatchId, setSelectedBatchId] = useState(medicine?.batches[0]?.id || '');
  const [adjustMode, setAdjustMode] = useState<'dispense' | 'adjustment'>('dispense');
  const [adjustQty, setAdjustQty] = useState('1');
  const [adjustReason, setAdjustReason] = useState('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  if (!medicine) {
    return (
      <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-10 text-center space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">Medicine record not found.</p>
        <button
          type="button"
          onClick={() => onNavigate('inventory')}
          className="px-4 py-2 rounded-xl bg-teal-700 text-white text-sm font-semibold"
        >
          Back to Inventory
        </button>
      </div>
    );
  }

  const sellable = getMedicineSellableStock(medicine);
  const expired = getMedicineExpiredStock(medicine);
  const history = state.stockHistory.filter((h) => h.medicineId === medicine.id);
  const activeBatchId =
    medicine.batches.find((b) => b.id === selectedBatchId)?.id ||
    medicine.batches[0]?.id ||
    '';

  const handleAdjustSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(adjustQty);
    if (!activeBatchId) {
      onShowToast('error', 'Select a batch to adjust.');
      return;
    }
    if (!Number.isFinite(qty) || qty === 0) {
      onShowToast('error', 'Enter a non-zero quantity.');
      return;
    }
    const targetBatch = medicine.batches.find((b) => b.id === activeBatchId);
    if (
      adjustMode === 'dispense' &&
      targetBatch &&
      classifyBatchExpiry(targetBatch.expiryDate).bucket === 'expired'
    ) {
      onShowToast(
        'error',
        'Safety block: Expired batches cannot be dispensed as sellable stock. Initiate a Purchase Return instead.'
      );
      return;
    }

    const delta = adjustMode === 'dispense' ? -Math.abs(qty) : qty;
    onAdjustStock(
      medicine.id,
      activeBatchId,
      delta,
      adjustMode,
      adjustReason.trim() ||
        (adjustMode === 'dispense' ? 'Counter dispensing' : 'Manual stock audit adjustment')
    );
    setAdjustQty('1');
    setAdjustReason('');
    onShowToast('success', 'Stock updated and logged in audit trail.');
  };

  return (
    <div className="space-y-6">
      {/* Top Action Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onNavigate('inventory')}
          className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Inventory</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenWhatsapp && (
            <button
              type="button"
              onClick={() =>
                onOpenWhatsapp(
                  `Share ${medicine.name} on WhatsApp`,
                  buildMedicineWhatsAppMessage(medicine, state.user)
                )
              }
              className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold"
            >
              <Share2 className="w-4 h-4" />
              <span>WhatsApp</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('medicine_form', medicine.id)}
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-semibold"
          >
            <Edit3 className="w-4 h-4" />
            <span>Edit Medicine</span>
          </button>
          {state.user.role === 'owner' && (
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 text-xs sm:text-sm font-semibold hover:bg-red-50 dark:hover:bg-red-950/40"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </button>
          )}
        </div>
      </div>

      {/* Overview Header Card */}
      <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-2">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {medicine.category} · {medicine.manufacturer} · HSN{' '}
            <span className="font-mono-num">{medicine.hsnCode}</span> · GST {medicine.gstPercent}%
          </p>
          <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            {medicine.name}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {medicine.composition} ({medicine.genericName})
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num pt-1">
            Brand: {medicine.brand} · Barcode: {medicine.barcode} · Rack: {medicine.rackLocation || 'Unassigned'}
          </p>
        </div>

        <div className="lg:col-span-4 grid grid-cols-2 gap-3">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">Sellable Stock</p>
            <p
              className={`font-mono-num text-2xl font-bold mt-1 ${
                sellable === 0
                  ? 'text-red-700 dark:text-red-400'
                  : sellable < medicine.minStockLevel
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              {sellable}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">Min level {medicine.minStockLevel}</p>
          </div>
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-800">
            <p className="text-xs text-slate-500 dark:text-slate-400">Blocked Expired</p>
            <p
              className={`font-mono-num text-2xl font-bold mt-1 ${
                expired > 0 ? 'text-red-700 dark:text-red-400' : 'text-slate-900 dark:text-white'
              }`}
            >
              {expired}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {medicine.batches.length} total batch(es)
            </p>
          </div>
        </div>
      </div>

      {/* Batch-Wise Table & Stock Adjustment */}
      <div className="grid lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-8 bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Batch-Wise Stock Ledger
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Each batch is tracked independently with purchase cost, MRP, distributor, and expiry safety state
            </p>
          </div>
          {/* Mobile Batch Cards */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800/80">
            {medicine.batches.map((b) => {
              const exp = classifyBatchExpiry(b.expiryDate);
              return (
                <div key={b.id} className="p-4 space-y-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                        {b.batchNumber} ({b.packSize})
                      </p>
                      <p className="text-slate-500 dark:text-slate-400">
                        {b.distributorName}
                        {b.freeQuantityReceived > 0 ? ` · +${b.freeQuantityReceived} free` : ''}
                      </p>
                    </div>
                    <div className="text-right font-mono-num">
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{b.availableStock} u</p>
                      <p className="text-slate-500">MRP {formatINR(b.mrp)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`font-semibold ${
                        exp.bucket === 'expired'
                          ? 'text-red-700 dark:text-red-400'
                          : exp.bucket !== 'safe'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      Exp {formatShortDate(b.expiryDate)} ·{' '}
                      {exp.bucket === 'expired'
                        ? 'Expired'
                        : exp.bucket === 'safe'
                          ? 'Safe'
                          : `${exp.daysRemaining}d left`}
                    </span>
                    {b.availableStock > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          onCreateReturn({
                            medicineId: medicine.id,
                            batchId: b.id,
                            quantity: b.availableStock,
                            reason: exp.bucket === 'expired' ? 'expired' : 'near_expiry',
                          });
                          onShowToast(
                            'success',
                            `Purchase return created for Batch ${b.batchNumber} (${b.availableStock} units).`
                          );
                        }}
                        className="font-semibold text-teal-700 dark:text-teal-400 underline"
                      >
                        Return Stock
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900/40">
                  <th className="py-3 px-4">Batch & Distributor</th>
                  <th className="py-3 px-4">Expiry Status</th>
                  <th className="py-3 px-4 text-right">Purchase / MRP</th>
                  <th className="py-3 px-4 text-right">Stock</th>
                  <th className="py-3 px-4 text-right">Return</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {medicine.batches.map((b) => {
                  const exp = classifyBatchExpiry(b.expiryDate);
                  return (
                    <tr key={b.id}>
                      <td className="py-3 px-4">
                        <p className="font-mono-num font-semibold text-slate-900 dark:text-white">
                          {b.batchNumber} ({b.packSize})
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {b.distributorName}
                          {b.freeQuantityReceived > 0
                            ? ` · +${b.freeQuantityReceived} free`
                            : ''}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-mono-num text-xs font-medium text-slate-800 dark:text-slate-200">
                          {formatShortDate(b.expiryDate)}
                        </p>
                        <p
                          className={`text-xs font-semibold ${
                            exp.bucket === 'expired'
                              ? 'text-red-700 dark:text-red-400'
                              : exp.bucket !== 'safe'
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {exp.bucket === 'expired'
                            ? 'Expired (Not Sellable)'
                            : exp.bucket === 'safe'
                              ? 'Safe Stock'
                              : `Expiring in ${exp.daysRemaining}d`}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num">
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {formatINR(b.mrp)}
                        </p>
                        <p className="text-xs text-slate-500">
                          Buy {formatINR(b.purchasePrice)}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right font-mono-num font-bold text-slate-900 dark:text-white">
                        {b.availableStock}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {b.availableStock > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              onCreateReturn({
                                medicineId: medicine.id,
                                batchId: b.id,
                                quantity: b.availableStock,
                                reason: exp.bucket === 'expired' ? 'expired' : 'near_expiry',
                              });
                              onShowToast(
                                'success',
                                `Purchase return created for Batch ${b.batchNumber} (${b.availableStock} units).`
                              );
                            }}
                            className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap"
                          >
                            Return Stock
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Stock Adjustment Form */}
        <form
          onSubmit={handleAdjustSubmit}
          className="lg:col-span-4 bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4"
        >
          <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
            Stock Adjustment / Dispense
          </h3>

          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80">
            <button
              type="button"
              onClick={() => setAdjustMode('dispense')}
              className={`py-2 rounded-lg text-xs font-semibold ${
                adjustMode === 'dispense'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Dispense (-)
            </button>
            <button
              type="button"
              onClick={() => setAdjustMode('adjustment')}
              className={`py-2 rounded-lg text-xs font-semibold ${
                adjustMode === 'adjustment'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Audit Adjust (+/-)
            </button>
          </div>

          <div>
            <label htmlFor="adj-batch" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Batch
            </label>
            <select
              id="adj-batch"
              value={activeBatchId}
              onChange={(e) => setSelectedBatchId(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white"
            >
              {medicine.batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNumber} · Qty {b.availableStock} · Exp {formatExpiryMonthYear(b.expiryDate)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="adj-qty" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              {adjustMode === 'dispense' ? 'Units Dispensed' : 'Adjustment Delta (e.g. +5 or -2)'}
            </label>
            <input
              id="adj-qty"
              type="number"
              value={adjustQty}
              onChange={(e) => setAdjustQty(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-num text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label htmlFor="adj-reason" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Reason / Notes
            </label>
            <input
              id="adj-reason"
              type="text"
              placeholder="e.g. Retail sale, damaged strip, shelf recount"
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
            />
          </div>

          <button
            type="submit"
            className="w-full h-11 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors"
          >
            Apply Stock Update
          </button>
        </form>
      </div>

      {/* Stock History & Price Change History */}
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
            <History className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              Stock Movement History
            </h3>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {history.length === 0 ? (
              <p className="p-5 text-xs text-slate-500 dark:text-slate-400">
                No stock adjustments recorded yet.
              </p>
            ) : (
              history.slice(0, 10).map((h) => (
                <div key={h.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 dark:text-white">
                      {h.reason}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Batch {h.batchNumber} · {h.actorName} · {h.timestamp.slice(0, 10)}
                    </p>
                  </div>
                  <div className="text-right font-mono-num shrink-0">
                    <p
                      className={`text-xs font-bold ${
                        h.quantityDelta >= 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-red-700 dark:text-red-400'
                      }`}
                    >
                      {h.quantityDelta >= 0 ? `+${h.quantityDelta}` : h.quantityDelta}
                    </p>
                    <p className="text-[11px] text-slate-500">Bal {h.resultingStock}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              Medicine Price Change History
            </h3>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {medicine.priceHistory.length === 0 ? (
              <p className="p-5 text-xs text-slate-500 dark:text-slate-400">
                No rate or MRP changes detected across purchase invoices yet.
              </p>
            ) : (
              medicine.priceHistory.map((ph) => (
                <div key={ph.id} className="px-5 py-3 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white">
                      {ph.distributorName} · Batch {ph.batchNumber}
                    </p>
                    <p className="text-slate-500 dark:text-slate-400">
                      {ph.date} · Bill {ph.invoiceNumber || 'Manual'}
                    </p>
                  </div>
                  <div className="text-right font-mono-num">
                    <p className="text-slate-800 dark:text-slate-200">
                      Rate {formatINR(ph.previousPurchasePrice)} → {formatINR(ph.newPurchasePrice)}
                    </p>
                    <p className="text-slate-500">
                      MRP {formatINR(ph.previousMrp)} → {formatINR(ph.newMrp)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDeleteOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm delete medicine"
        >
          <div className="w-full max-w-md bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-red-700 dark:text-red-400">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-display text-lg font-bold">Delete {medicine.name}?</h3>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              This removes {medicine.name} and all {medicine.batches.length} batch record(s) from active inventory. This action will be recorded in the audit log.
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteMedicine(medicine.id);
                  setConfirmDeleteOpen(false);
                  onShowToast('info', `Deleted ${medicine.name} from inventory.`);
                  onNavigate('inventory');
                }}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold"
              >
                Delete Medicine
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// SCREEN 11: ADD / EDIT MEDICINE FORM
// =========================================================================
export function MedicineFormScreen({
  editingMedicine,
  state,
  onSave,
  onCancel,
}: {
  editingMedicine?: Medicine;
  state: PharmacyState;
  onSave: (
    med: Omit<Medicine, 'id' | 'batches' | 'priceHistory' | 'updatedAt'> & { id?: string },
    batch?: Omit<MedicineBatch, 'id' | 'addedAt'> & { id?: string }
  ) => void;
  onCancel: () => void;
}) {
  const existingBatch = editingMedicine?.batches[0];
  const [name, setName] = useState(editingMedicine?.name || '');
  const [genericName, setGenericName] = useState(editingMedicine?.genericName || '');
  const [brand, setBrand] = useState(editingMedicine?.brand || '');
  const [manufacturer, setManufacturer] = useState(editingMedicine?.manufacturer || '');
  const [composition, setComposition] = useState(editingMedicine?.composition || '');
  const [category, setCategory] = useState<MedicineCategory>(
    editingMedicine?.category || 'Analgesics & Antipyretics'
  );
  const [minStockLevel, setMinStockLevel] = useState(String(editingMedicine?.minStockLevel ?? 20));
  const [gstPercent, setGstPercent] = useState(String(editingMedicine?.gstPercent ?? 12));
  const [hsnCode, setHsnCode] = useState(editingMedicine?.hsnCode || '30049099');
  const [barcode, setBarcode] = useState(
    editingMedicine?.barcode || `890${Math.floor(1000000000 + Math.random() * 8999999999)}`
  );
  const [rackLocation, setRackLocation] = useState(editingMedicine?.rackLocation || '');

  // Batch fields
  const [includeBatch, setIncludeBatch] = useState(!editingMedicine);
  const [batchNumber, setBatchNumber] = useState(existingBatch?.batchNumber || '');
  const [expiryDate, setExpiryDate] = useState(existingBatch?.expiryDate || '');
  const [packSize, setPackSize] = useState(existingBatch?.packSize || '10T');
  const [availableStock, setAvailableStock] = useState(String(existingBatch?.availableStock ?? ''));
  const [purchasePrice, setPurchasePrice] = useState(String(existingBatch?.purchasePrice ?? ''));
  const [mrp, setMrp] = useState(String(existingBatch?.mrp ?? ''));
  const [sellingPrice, setSellingPrice] = useState(String(existingBatch?.sellingPrice ?? ''));
  const [distributorId, setDistributorId] = useState(
    existingBatch?.distributorId || state.distributors[0]?.id || ''
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const errs: string[] = [];
    if (!name.trim()) errs.push('Medicine name is required.');
    if (!genericName.trim()) errs.push('Generic name is required.');
    if (!manufacturer.trim()) errs.push('Manufacturer is required.');

    if (includeBatch) {
      if (!batchNumber.trim()) errs.push('Batch number is required.');
      if (!parseExpiryDate(expiryDate))
        errs.push('Valid expiry date is required (YYYY-MM-DD or MM/YYYY).');
      if (Number(availableStock) < 0 || availableStock === '')
        errs.push('Available stock quantity is required.');
      if (!(Number(mrp) > 0)) errs.push('MRP must be greater than ₹0.');
      if (Number(purchasePrice) < 0 || purchasePrice === '')
        errs.push('Purchase price is required.');
    }

    if (errs.length > 0) {
      setErrors(errs);
      return;
    }

    setSubmitting(true);
    const dist = state.distributors.find((d) => d.id === distributorId);
    onSave(
      {
        id: editingMedicine?.id,
        name: name.trim(),
        genericName: genericName.trim(),
        brand: brand.trim() || name.trim().split(' ')[0],
        manufacturer: manufacturer.trim(),
        composition: composition.trim() || genericName.trim(),
        category,
        minStockLevel: Math.max(0, Number(minStockLevel) || 0),
        gstPercent: Number(gstPercent) || 12,
        hsnCode: hsnCode.trim() || '30049099',
        barcode: barcode.trim(),
        rackLocation: rackLocation.trim(),
      },
      includeBatch
        ? {
            id: editingMedicine ? undefined : undefined,
            batchNumber: batchNumber.trim().toUpperCase(),
            expiryDate: normalizeExpiryToIso(expiryDate),
            mrp: Number(mrp),
            purchasePrice: Number(purchasePrice),
            sellingPrice: Number(sellingPrice) > 0 ? Number(sellingPrice) : Number(mrp),
            availableStock: Math.max(0, Math.round(Number(availableStock))),
            freeQuantityReceived: 0,
            gstPercent: Number(gstPercent) || 12,
            hsnCode: hsnCode.trim() || '30049099',
            packSize: packSize.trim() || '10T',
            distributorId: dist?.id || '',
            distributorName: dist?.name || 'Direct Purchase',
          }
        : undefined
    );
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            {editingMedicine ? `Edit ${editingMedicine.name}` : 'Add Medicine Manually'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Enter accurate pharmaceutical details, batch number, and expiry date
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="h-10 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200"
        >
          Cancel
        </button>
      </div>

      {errors.length > 0 && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs font-medium text-red-700 dark:text-red-300 space-y-1"
        >
          {errors.map((err) => (
            <p key={err}>• {err}</p>
          ))}
        </div>
      )}

      <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4">
        <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
          Medicine Information
        </h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FormInput id="med-name" label="Medicine Name *" value={name} onChange={setName} placeholder="e.g. Crocin Advance 500" />
          <FormInput id="med-generic" label="Generic Name *" value={genericName} onChange={setGenericName} placeholder="e.g. Paracetamol 500 mg" />
          <FormInput id="med-brand" label="Brand" value={brand} onChange={setBrand} placeholder="e.g. Crocin" />
          <FormInput id="med-mfr" label="Manufacturer *" value={manufacturer} onChange={setManufacturer} placeholder="e.g. Haleon / GSK" />
          <FormInput id="med-comp" label="Composition" value={composition} onChange={setComposition} placeholder="e.g. Paracetamol IP 500mg" />
          <div>
            <label htmlFor="med-cat" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Category
            </label>
            <select
              id="med-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value as MedicineCategory)}
              className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <FormInput id="med-min" label="Minimum Stock Level" type="number" value={minStockLevel} onChange={setMinStockLevel} />
          <FormInput id="med-hsn" label="HSN Code" value={hsnCode} onChange={setHsnCode} mono />
          <div>
            <label htmlFor="med-gst" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              GST %
            </label>
            <select
              id="med-gst"
              value={gstPercent}
              onChange={(e) => setGstPercent(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-num text-slate-900 dark:text-white"
            >
              {[0, 5, 12, 18, 28].map((g) => (
                <option key={g} value={g}>
                  {g}%
                </option>
              ))}
            </select>
          </div>
          <FormInput id="med-barcode" label="Barcode (EAN-13)" value={barcode} onChange={setBarcode} mono />
          <FormInput id="med-rack" label="Shelf / Rack Location" value={rackLocation} onChange={setRackLocation} placeholder="e.g. Rack A-03" />
        </div>
      </div>

      {/* Batch Section */}
      <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            {editingMedicine ? 'Add New Batch (Optional)' : 'Initial Batch & Pricing'}
          </h3>
          {editingMedicine && (
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={includeBatch}
                onChange={(e) => setIncludeBatch(e.target.checked)}
                className="accent-teal-700"
              />
              <span>Add a new batch now</span>
            </label>
          )}
        </div>

        {includeBatch && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <FormInput id="bat-no" label="Batch Number *" value={batchNumber} onChange={setBatchNumber} placeholder="e.g. CR2610A" mono />
            <FormInput id="bat-exp" label="Expiry Date (YYYY-MM-DD) *" type="date" value={expiryDate} onChange={setExpiryDate} mono />
            <FormInput id="bat-pack" label="Pack Size" value={packSize} onChange={setPackSize} placeholder="e.g. 15T" />
            <FormInput id="bat-stock" label="Available Stock *" type="number" value={availableStock} onChange={setAvailableStock} mono />
            <FormInput id="bat-buy" label="Purchase Price (₹) *" type="number" step="0.01" value={purchasePrice} onChange={setPurchasePrice} mono />
            <FormInput id="bat-mrp" label="MRP (₹) *" type="number" step="0.01" value={mrp} onChange={setMrp} mono />
            <FormInput id="bat-sell" label="Selling Price (₹)" type="number" step="0.01" value={sellingPrice} onChange={setSellingPrice} placeholder="Defaults to MRP" mono />
            <div>
              <label htmlFor="bat-dist" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Distributor
              </label>
              <select
                id="bat-dist"
                value={distributorId}
                onChange={(e) => setDistributorId(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
              >
                {state.distributors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="sticky bottom-16 lg:bottom-2 z-10 flex items-center justify-end gap-2.5 rounded-2xl border border-slate-200/90 bg-white/95 p-3 shadow-md backdrop-blur-sm dark:border-slate-800 dark:bg-[#111B1E]/95">
        <button
          type="button"
          onClick={onCancel}
          className="h-11 px-4 sm:px-5 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="h-11 flex-1 sm:flex-initial px-6 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors disabled:opacity-60"
        >
          {submitting
            ? 'Saving...'
            : editingMedicine
              ? 'Save Changes'
              : 'Add to Inventory'}
        </button>
      </div>
    </form>
  );
}

function FormInput({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  step,
  mono,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (val: string) => void;
  type?: string;
  placeholder?: string;
  step?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
        {label}
      </label>
      <input
        id={id}
        type={type}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600 ${
          mono ? 'font-mono-num' : ''
        }`}
      />
    </div>
  );
}
