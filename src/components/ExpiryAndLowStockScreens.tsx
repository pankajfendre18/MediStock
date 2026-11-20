import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Download,
  Printer,
  RotateCcw,
  Share2,
} from 'lucide-react';
import {
  buildReorderList,
  classifyBatchExpiry,
  formatINR,
  formatShortDate,
} from '../domain/pharmacyMath';
import type { AppScreen, ExpiryBucket, PharmacyState } from '../domain/types';
import {
  buildWhatsAppReportMessage,
  downloadBlob,
  generateExcelReport,
  generatePdfReport,
} from '../utils/reportGenerators';

// =========================================================================
// SCREEN 12: EXPIRY MANAGEMENT
// =========================================================================
export function ExpiryManagementScreen({
  state,
  onNavigate,
  onCreateReturn,
  onOpenWhatsapp,
  onShowToast,
}: {
  state: PharmacyState;
  onNavigate: (screen: AppScreen, entityId?: string) => void;
  onCreateReturn: (input: {
    medicineId: string;
    batchId: string;
    quantity: number;
    reason: 'expired' | 'near_expiry';
  }) => void;
  onOpenWhatsapp: (title: string, message: string) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string) => void;
}) {
  const [bucketFilter, setBucketFilter] = useState<'all' | ExpiryBucket>('all');

  const batchRows = useMemo(() => {
    const rows: Array<{
      medicineId: string;
      medicineName: string;
      batchId: string;
      batchNumber: string;
      expiryDate: string;
      stock: number;
      purchasePrice: number;
      stockValue: number;
      distributorName: string;
      bucket: ExpiryBucket;
      daysRemaining: number;
    }> = [];

    for (const med of state.medicines) {
      for (const b of med.batches) {
        if (b.availableStock <= 0) continue;
        const meta = classifyBatchExpiry(b.expiryDate);
        rows.push({
          medicineId: med.id,
          medicineName: med.name,
          batchId: b.id,
          batchNumber: b.batchNumber,
          expiryDate: b.expiryDate,
          stock: b.availableStock,
          purchasePrice: b.purchasePrice,
          stockValue: b.availableStock * b.purchasePrice,
          distributorName: b.distributorName,
          bucket: meta.bucket,
          daysRemaining: meta.daysRemaining,
        });
      }
    }
    return rows.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }, [state.medicines]);

  const counts = useMemo(() => {
    const c = {
      expired: 0,
      expiring_30: 0,
      expiring_60: 0,
      expiring_90: 0,
      safe: 0,
      expiredValue: 0,
      nearValue: 0,
    };
    for (const r of batchRows) {
      c[r.bucket] += 1;
      if (r.bucket === 'expired') c.expiredValue += r.stockValue;
      else if (r.bucket !== 'safe') c.nearValue += r.stockValue;
    }
    return c;
  }, [batchRows]);

  const visibleRows = useMemo(
    () =>
      bucketFilter === 'all'
        ? batchRows
        : batchRows.filter((r) => r.bucket === bucketFilter),
    [batchRows, bucketFilter]
  );

  const handleExportExcel = async () => {
    const reportType =
      bucketFilter === 'expired'
        ? 'expired'
        : bucketFilter === 'expiring_30' || bucketFilter === 'expiring_60' || bucketFilter === 'expiring_90'
          ? 'near_expiry'
          : 'expiry';
    try {
      const res = await generateExcelReport(state, { reportType });
      downloadBlob(res.blob, res.filename);
      onShowToast('success', `Excel report downloaded: ${res.filename}`);
    } catch {
      onShowToast('error', 'Failed to generate Excel expiry report.');
    }
  };

  const handleExportPdf = () => {
    const reportType =
      bucketFilter === 'expired'
        ? 'expired'
        : bucketFilter === 'expiring_30' || bucketFilter === 'expiring_60' || bucketFilter === 'expiring_90'
          ? 'near_expiry'
          : 'expiry';
    try {
      const res = generatePdfReport(state, { reportType });
      downloadBlob(res.blob, res.filename);
      onShowToast('success', `PDF report downloaded: ${res.filename}`);
    } catch {
      onShowToast('error', 'Failed to generate PDF expiry report.');
    }
  };

  const handleWhatsappShare = () => {
    const reportType =
      bucketFilter === 'expired'
        ? 'expired'
        : bucketFilter === 'expiring_30' || bucketFilter === 'expiring_60' || bucketFilter === 'expiring_90'
          ? 'near_expiry'
          : 'expiry';
    const message = buildWhatsAppReportMessage(state, { reportType });
    onOpenWhatsapp('Share Expiry Report on WhatsApp', message);
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
            Expiry Management
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Expired batches are strictly blocked from sellable stock and ready for distributor credit return.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>Excel (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            <span>PDF Report</span>
          </button>
          <button
            type="button"
            onClick={handleWhatsappShare}
            className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap"
          >
            <Share2 className="w-4 h-4" />
            <span>WhatsApp</span>
          </button>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-red-200 dark:border-red-900/70 p-4">
          <p className="text-xs font-medium text-red-700 dark:text-red-400">Expired Batches (Blocked)</p>
          <p className="font-mono-num text-2xl font-bold text-red-700 dark:text-red-400 mt-1">
            {counts.expired}
          </p>
          <p className="font-mono-num text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Value {formatINR(counts.expiredValue)}
          </p>
        </div>
        <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-amber-200 dark:border-amber-900/70 p-4">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Expiring in 30 Days</p>
          <p className="font-mono-num text-2xl font-bold text-amber-700 dark:text-amber-400 mt-1">
            {counts.expiring_30}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Urgent clearance / return</p>
        </div>
        <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Expiring 31–90 Days</p>
          <p className="font-mono-num text-2xl font-bold text-slate-900 dark:text-white mt-1">
            {counts.expiring_60 + counts.expiring_90}
          </p>
          <p className="font-mono-num text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {counts.expiring_60} in 60d · {counts.expiring_90} in 90d
          </p>
        </div>
        <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Safe Stock (&gt; 90 Days)</p>
          <p className="font-mono-num text-2xl font-bold text-emerald-700 dark:text-emerald-400 mt-1">
            {counts.safe}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Healthy shelf life</p>
        </div>
      </div>

      {/* 5-Bucket Interactive Segmented Filter (horizontally scrollable on small phones) */}
      <div className="max-w-full overflow-x-auto no-scrollbar">
        <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 min-w-max">
        {(
          [
            ['all', `All (${batchRows.length})`],
            ['expired', `Expired (${counts.expired})`],
            ['expiring_30', `≤ 30d (${counts.expiring_30})`],
            ['expiring_60', `31–60d (${counts.expiring_60})`],
            ['expiring_90', `61–90d (${counts.expiring_90})`],
            ['safe', `Safe (${counts.safe})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setBucketFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              bucketFilter === key
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
        </div>
      </div>

      {/* Batch Expiry Cards (Mobile) + Table (Desktop) */}
      <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800/80">
          {visibleRows.map((row) => {
            const isExp = row.bucket === 'expired';
            const isWarn = row.bucket !== 'safe' && !isExp;
            return (
              <div
                key={`${row.medicineId}_${row.batchId}`}
                className={`p-3.5 space-y-2 text-xs ${
                  isExp
                    ? 'bg-red-50/40 dark:bg-red-950/15'
                    : isWarn
                      ? 'bg-amber-50/35 dark:bg-amber-950/10'
                      : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigate('medicine_detail', row.medicineId)}
                    className="text-left min-w-0"
                  >
                    <p className="text-sm font-semibold text-slate-900 dark:text-white break-words">
                      {row.medicineName}
                    </p>
                    <p className="font-mono-num text-slate-500">
                      Batch {row.batchNumber} · {row.distributorName}
                    </p>
                  </button>
                  <div className="text-right font-mono-num shrink-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{row.stock} u</p>
                    <p className="text-slate-500">{formatINR(row.stockValue)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`font-semibold inline-flex items-center gap-1 ${
                      isExp
                        ? 'text-red-700 dark:text-red-400'
                        : isWarn
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {(isExp || isWarn) && <AlertTriangle className="w-3.5 h-3.5" />}
                    {formatShortDate(row.expiryDate)} ·{' '}
                    {isExp
                      ? 'Expired'
                      : isWarn
                        ? `${row.daysRemaining}d left`
                        : 'Safe'}
                  </span>
                  {(isExp || isWarn) && (
                    <button
                      type="button"
                      onClick={() => {
                        onCreateReturn({
                          medicineId: row.medicineId,
                          batchId: row.batchId,
                          quantity: row.stock,
                          reason: isExp ? 'expired' : 'near_expiry',
                        });
                        onShowToast(
                          'success',
                          `Initiated purchase return for ${row.medicineName} (Batch ${row.batchNumber}).`
                        );
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 font-semibold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Return</span>
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
                <th className="py-3 px-5">Medicine & Batch</th>
                <th className="py-3 px-4">Expiry Status</th>
                <th className="py-3 px-4">Distributor</th>
                <th className="py-3 px-4 text-right">Qty</th>
                <th className="py-3 px-4 text-right">Stock Value</th>
                <th className="py-3 px-5 text-right no-print">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {visibleRows.map((row) => {
                const isExp = row.bucket === 'expired';
                const isWarn = row.bucket !== 'safe' && !isExp;
                return (
                  <tr
                    key={`${row.medicineId}_${row.batchId}`}
                    className={
                      isExp
                        ? 'bg-red-50/40 dark:bg-red-950/15'
                        : isWarn
                          ? 'bg-amber-50/35 dark:bg-amber-950/10'
                          : ''
                    }
                  >
                    <td className="py-3.5 px-5">
                      <button
                        type="button"
                        onClick={() => onNavigate('medicine_detail', row.medicineId)}
                        className="text-left hover:underline"
                      >
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {row.medicineName}
                        </p>
                        <p className="text-xs font-mono-num text-slate-500 dark:text-slate-400">
                          Batch {row.batchNumber}
                        </p>
                      </button>
                    </td>
                    <td className="py-3.5 px-4">
                      <p className="font-mono-num text-xs font-medium text-slate-800 dark:text-slate-200">
                        {formatShortDate(row.expiryDate)}
                      </p>
                      <p
                        className={`text-xs font-semibold inline-flex items-center gap-1 ${
                          isExp
                            ? 'text-red-700 dark:text-red-400'
                            : isWarn
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {(isExp || isWarn) && <AlertTriangle className="w-3.5 h-3.5" />}
                        {isExp
                          ? 'Expired — Do Not Sell'
                          : isWarn
                            ? `Expiring in ${row.daysRemaining} days`
                            : `Safe (${row.daysRemaining} days)`}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-600 dark:text-slate-300">
                      {row.distributorName}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono-num font-bold text-slate-900 dark:text-white">
                      {row.stock}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono-num font-semibold text-slate-900 dark:text-white">
                      {formatINR(row.stockValue)}
                    </td>
                    <td className="py-3.5 px-5 text-right no-print">
                      {(isExp || isWarn) && (
                        <button
                          type="button"
                          onClick={() => {
                            onCreateReturn({
                              medicineId: row.medicineId,
                              batchId: row.batchId,
                              quantity: row.stock,
                              reason: isExp ? 'expired' : 'near_expiry',
                            });
                            onShowToast(
                              'success',
                              `Initiated purchase return for ${row.medicineName} (Batch ${row.batchNumber}).`
                            );
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Return to Distributor</span>
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
    </div>
  );
}

// =========================================================================
// SCREEN 13: LOW STOCK & SMART REORDER MANAGEMENT
// =========================================================================
export function LowStockScreen({
  state,
  onUpdateMinStock,
  onNavigate,
  onOpenWhatsapp,
  onShowToast,
}: {
  state: PharmacyState;
  onUpdateMinStock: (medicineId: string, minStock: number) => void;
  onNavigate: (screen: AppScreen, entityId?: string) => void;
  onOpenWhatsapp: (title: string, message: string) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string) => void;
}) {
  const reorderList = useMemo(() => buildReorderList(state.medicines), [state.medicines]);

  const totalEstimatedOrder = useMemo(
    () => reorderList.reduce((sum, item) => sum + item.estimatedCost, 0),
    [reorderList]
  );

  const handleExportExcel = async () => {
    try {
      const res = await generateExcelReport(state, { reportType: 'low_stock' });
      downloadBlob(res.blob, res.filename);
      onShowToast('success', `Low-stock Excel report downloaded: ${res.filename}`);
    } catch {
      onShowToast('error', 'Failed to generate Excel reorder report.');
    }
  };

  const handleExportPdf = () => {
    try {
      const res = generatePdfReport(state, { reportType: 'low_stock' });
      downloadBlob(res.blob, res.filename);
      onShowToast('success', `Low-stock PDF report downloaded: ${res.filename}`);
    } catch {
      onShowToast('error', 'Failed to generate PDF reorder report.');
    }
  };

  const handleShareReorder = () => {
    const message = buildWhatsAppReportMessage(state, { reportType: 'low_stock' });
    onOpenWhatsapp('Share Low Stock Alert on WhatsApp', message);
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
            Low Stock & Smart Reorder List
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            {reorderList.length} medicine(s) below minimum stock threshold · Estimated restock cost{' '}
            <span className="font-mono-num font-semibold text-slate-900 dark:text-white">
              {formatINR(totalEstimatedOrder)}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={reorderList.length === 0}
            className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>Excel (.xlsx)</span>
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={reorderList.length === 0}
            className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            <span>PDF</span>
          </button>
          <button
            type="button"
            onClick={handleShareReorder}
            disabled={reorderList.length === 0}
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
          >
            <Share2 className="w-4 h-4" />
            <span>WhatsApp Order</span>
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {reorderList.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              All medicines are stocked above their minimum levels.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              You can raise minimum stock thresholds inside any medicine record or below.
            </p>
          </div>
        ) : (
          <>
          {/* Mobile Reorder Cards */}
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800/80">
            {reorderList.map((item) => (
              <div key={item.medicineId} className="p-3.5 space-y-2.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigate('medicine_detail', item.medicineId)}
                    className="text-left min-w-0"
                  >
                    <p className="text-sm font-semibold text-slate-900 dark:text-white break-words">
                      {item.medicineName}
                    </p>
                    <p
                      className={`font-semibold ${
                        item.status === 'out_of_stock'
                          ? 'text-red-700 dark:text-red-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {item.status === 'out_of_stock' ? 'Out of Stock' : 'Low Stock'} · {item.lastDistributorName}
                    </p>
                  </button>
                  <div className="text-right font-mono-num shrink-0">
                    <p className="text-sm font-bold text-teal-700 dark:text-teal-400">
                      +{item.suggestedReorderQty} u
                    </p>
                    <p className="text-slate-500">{formatINR(item.estimatedCost)}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono-num text-red-700 dark:text-red-400 font-semibold">
                    Available: {item.availableSellable} u
                  </span>
                  <label className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                    <span>Min:</span>
                    <input
                      type="number"
                      min={1}
                      aria-label={`Minimum stock level for ${item.medicineName}`}
                      value={item.minStockLevel}
                      onChange={(e) =>
                        onUpdateMinStock(item.medicineId, Number(e.target.value) || 0)
                      }
                      className="w-16 h-8 px-2 text-right font-mono-num rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900/40">
                  <th className="py-3 px-5">Medicine</th>
                  <th className="py-3 px-4">Last Purchase Distributor</th>
                  <th className="py-3 px-4 text-right">Available</th>
                  <th className="py-3 px-4 text-right">Min Level</th>
                  <th className="py-3 px-4 text-right">Suggested Reorder</th>
                  <th className="py-3 px-5 text-right">Est. Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {reorderList.map((item) => (
                  <tr key={item.medicineId}>
                    <td className="py-3.5 px-5">
                      <button
                        type="button"
                        onClick={() => onNavigate('medicine_detail', item.medicineId)}
                        className="text-left hover:underline"
                      >
                        <p className="font-semibold text-slate-900 dark:text-white">
                          {item.medicineName}
                        </p>
                        <p
                          className={`text-xs font-semibold ${
                            item.status === 'out_of_stock'
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {item.status === 'out_of_stock' ? 'Out of Stock' : 'Low Stock'} · {item.category}
                        </p>
                      </button>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-600 dark:text-slate-300">
                      {item.lastDistributorName}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono-num font-bold text-red-700 dark:text-red-400">
                      {item.availableSellable}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <input
                        type="number"
                        min={1}
                        aria-label={`Minimum stock level for ${item.medicineName}`}
                        value={item.minStockLevel}
                        onChange={(e) =>
                          onUpdateMinStock(item.medicineId, Number(e.target.value) || 0)
                        }
                        className="w-20 h-9 px-2.5 text-right font-mono-num text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                      />
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono-num font-bold text-teal-700 dark:text-teal-400">
                      +{item.suggestedReorderQty} units
                    </td>
                    <td className="py-3.5 px-5 text-right font-mono-num font-semibold text-slate-900 dark:text-white">
                      {formatINR(item.estimatedCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
