import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  CheckCheck,
  Cloud,
  CloudOff,
  Download,
  Info,
  LogOut,
  Moon,
  Printer,
  RefreshCw,
  RotateCcw,
  Share2,
  Shield,
  Smartphone,
  Sun,
  Upload,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildReorderList,
  computeDashboardStats,
  formatINR,
} from '../domain/pharmacyMath';
import type {
  AppScreen,
  NotificationItem,
  PharmacyState,
  UserProfile,
  UserRole,
} from '../domain/types';
import { downloadCSV, downloadJSON } from '../utils/exportUtils';

// =========================================================================
// SCREEN 18: REPORTS & ANALYTICS
// =========================================================================
export function ReportsScreen({
  state,
  onNavigate,
  onOpenWhatsapp,
  onShowToast,
}: {
  state: PharmacyState;
  onNavigate: (screen: AppScreen, entityId?: string) => void;
  onOpenWhatsapp: (title: string, message: string) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string) => void;
}) {
  const [tab, setTab] = useState<'valuation' | 'gst' | 'distributors' | 'returns'>('valuation');
  const stats = useMemo(() => computeDashboardStats(state.medicines), [state.medicines]);
  const reorderList = useMemo(() => buildReorderList(state.medicines), [state.medicines]);

  const gstSummary = useMemo(() => {
    let taxable = 0;
    let cgst = 0;
    let sgst = 0;
    let totalGst = 0;
    let grand = 0;
    const rateMap = new Map<number, { gstPercent: number; taxable: number; gst: number }>();

    for (const inv of state.invoices) {
      taxable += inv.subtotalTaxable;
      cgst += inv.cgstAmount;
      sgst += inv.sgstAmount;
      totalGst += inv.totalGstAmount;
      grand += inv.grandTotal;
      for (const item of inv.items) {
        const entry = rateMap.get(item.gstPercent) || {
          gstPercent: item.gstPercent,
          taxable: 0,
          gst: 0,
        };
        entry.taxable += item.taxableAmount;
        entry.gst += item.gstAmount;
        rateMap.set(item.gstPercent, entry);
      }
    }
    return {
      taxable,
      cgst,
      sgst,
      totalGst,
      grand,
      slabs: Array.from(rateMap.values()).sort((a, b) => a.gstPercent - b.gstPercent),
    };
  }, [state.invoices]);

  const distributorComparison = useMemo(() => {
    return state.distributors
      .map((d) => {
        const invs = state.invoices.filter((i) => i.distributorId === d.id);
        const total = invs.reduce((s, i) => s + i.grandTotal, 0);
        const gst = invs.reduce((s, i) => s + i.totalGstAmount, 0);
        return {
          id: d.id,
          name: d.name,
          shortName: d.name.split(' ').slice(0, 2).join(' '),
          gstin: d.gstin,
          invoices: invs.length,
          total: Math.round(total),
          gst: Math.round(gst),
          outstanding: d.outstandingPayment,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [state.distributors, state.invoices]);

  const handleExportReport = () => {
    if (tab === 'gst') {
      downloadCSV(
        `medistock-gst-summary-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Invoice No', 'Date', 'Distributor', 'GSTIN', 'Taxable (INR)', 'CGST', 'SGST', 'Total GST', 'Grand Total', 'Reconciled'],
        state.invoices.map((i) => [
          i.invoiceNumber,
          i.invoiceDate,
          i.distributorName,
          i.distributorGstin,
          i.subtotalTaxable.toFixed(2),
          i.cgstAmount.toFixed(2),
          i.sgstAmount.toFixed(2),
          i.totalGstAmount.toFixed(2),
          i.grandTotal.toFixed(2),
          i.gstReconciled ? 'Yes' : 'Pending',
        ])
      );
    } else if (tab === 'distributors') {
      downloadCSV(
        `medistock-distributor-purchases-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Distributor', 'GSTIN', 'Invoices', 'Total Purchased (INR)', 'GST Paid (INR)', 'Outstanding (INR)'],
        distributorComparison.map((d) => [
          d.name,
          d.gstin,
          d.invoices,
          d.total,
          d.gst,
          d.outstanding,
        ])
      );
    } else {
      downloadCSV(
        `medistock-inventory-valuation-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Medicine', 'Category', 'Manufacturer', 'Batch', 'Expiry', 'Stock', 'Purchase Rate', 'MRP', 'Purchase Valuation (INR)'],
        state.medicines.flatMap((m) =>
          m.batches.map((b) => [
            m.name,
            m.category,
            m.manufacturer,
            b.batchNumber,
            b.expiryDate,
            b.availableStock,
            b.purchasePrice,
            b.mrp,
            (b.availableStock * b.purchasePrice).toFixed(2),
          ])
        )
      );
    }
    onShowToast('success', 'Report exported to Excel-ready CSV.');
  };

  const handleWhatsappSummary = () => {
    const text = [
      `*MediStock AI Pharmacy Report — ${state.user.storeName}*`,
      `Total Medicines: ${stats.totalMedicines} | Sellable Stock: ${stats.totalSellableStock} units`,
      `Inventory Purchase Value: ${formatINR(stats.totalInventoryPurchaseValue)}`,
      `Inventory MRP Value: ${formatINR(stats.totalInventoryMrpValue)}`,
      `Input GST Credit (ITC): ${formatINR(gstSummary.totalGst)}`,
      `Expired Stock Value: ${formatINR(stats.expiredStockValue)}`,
      `Low / Out-of-Stock Items: ${reorderList.length}`,
    ].join('\n');
    onOpenWhatsapp('Share Analytics Summary on WhatsApp', text);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
            Reports & Analytics
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Valuation, GSTR-2B input tax credit summary, distributor comparison, and expiry exposure
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <button
            type="button"
            onClick={handleExportReport}
            className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>Export Excel</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            <span>Export PDF</span>
          </button>
          <button
            type="button"
            onClick={handleWhatsappSummary}
            className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap"
          >
            <Share2 className="w-4 h-4" />
            <span>WhatsApp</span>
          </button>
        </div>
      </div>

      {/* Report Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 w-fit no-print">
        {(
          [
            ['valuation', 'Inventory Valuation'],
            ['gst', 'GST Summary'],
            ['distributors', 'Distributor Comparison'],
            ['returns', `Purchase Returns (${state.purchaseReturns.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              tab === id
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'valuation' && (
        <div className="space-y-5">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricBlock label="Sellable Purchase Value" value={formatINR(stats.totalInventoryPurchaseValue)} sub="Cost basis (excl. expired)" />
            <MetricBlock label="Sellable Retail MRP Value" value={formatINR(stats.totalInventoryMrpValue)} sub="Gross retail potential" />
            <MetricBlock
              label="Estimated Gross Margin"
              value={formatINR(Math.max(0, stats.totalInventoryMrpValue - stats.totalInventoryPurchaseValue))}
              sub={
                stats.totalInventoryMrpValue > 0
                  ? `${Math.round(((stats.totalInventoryMrpValue - stats.totalInventoryPurchaseValue) / stats.totalInventoryMrpValue) * 100)}% avg margin`
                  : '0%'
              }
            />
            <MetricBlock label="Expired Stock Exposure" value={formatINR(stats.expiredStockValue)} sub={`${stats.expiredBatchCount} blocked batch(es)`} critical={stats.expiredBatchCount > 0} />
          </div>

          <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Operational Quick Reports
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Jump directly into actionable stock lists
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onNavigate('expiry')}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Open Expiry Report ({stats.expiredBatchCount + stats.expiringSoonTotal})
              </button>
              <button
                type="button"
                onClick={() => onNavigate('low_stock')}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Open Low-Stock Reorder ({reorderList.length})
              </button>
              <button
                type="button"
                onClick={() => onNavigate('invoices')}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                All Purchase Invoices ({state.invoices.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'gst' && (
        <div className="space-y-5">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricBlock label="Total Taxable Purchases" value={formatINR(gstSummary.taxable)} sub={`${state.invoices.length} invoices`} />
            <MetricBlock label="Input CGST Credit" value={formatINR(gstSummary.cgst)} sub="Central GST" />
            <MetricBlock label="Input SGST Credit" value={formatINR(gstSummary.sgst)} sub="State GST" />
            <MetricBlock label="Total Input GST (ITC)" value={formatINR(gstSummary.totalGst)} sub={`Total Billed ${formatINR(gstSummary.grand)}`} />
          </div>

          <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                GST Tax Slab Breakdown
              </h3>
            </div>
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500">
                  <th className="py-3 px-5">GST Rate Slab</th>
                  <th className="py-3 px-4 text-right">Taxable Value</th>
                  <th className="py-3 px-4 text-right">CGST</th>
                  <th className="py-3 px-4 text-right">SGST</th>
                  <th className="py-3 px-5 text-right">Total Tax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono-num">
                {gstSummary.slabs.map((slab) => (
                  <tr key={slab.gstPercent}>
                    <td className="py-3 px-5 font-semibold text-slate-900 dark:text-white">
                      {slab.gstPercent}% GST
                    </td>
                    <td className="py-3 px-4 text-right">{formatINR(slab.taxable)}</td>
                    <td className="py-3 px-4 text-right">{formatINR(slab.gst / 2)}</td>
                    <td className="py-3 px-4 text-right">{formatINR(slab.gst / 2)}</td>
                    <td className="py-3 px-5 text-right font-bold text-teal-700 dark:text-teal-400">
                      {formatINR(slab.gst)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'distributors' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Distributor Purchase Comparison (INR)
            </h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distributorComparison} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="shortName" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `₹${Math.round(v / 1000)}k`}
                  />
                  <Tooltip
                    formatter={(value: unknown) => [formatINR(Number(value) || 0), 'Total Purchases']}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                  />
                  <Bar dataKey="total" fill="#0f766e" radius={[6, 6, 0, 0]} barSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500">
                  <th className="py-3 px-5">Distributor</th>
                  <th className="py-3 px-4 text-right">Bills</th>
                  <th className="py-3 px-4 text-right">Total Purchases</th>
                  <th className="py-3 px-4 text-right">GST Paid</th>
                  <th className="py-3 px-5 text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono-num">
                {distributorComparison.map((d) => (
                  <tr key={d.id}>
                    <td className="py-3 px-5 font-sans">
                      <button
                        type="button"
                        onClick={() => onNavigate('distributor_detail', d.id)}
                        className="font-semibold text-slate-900 dark:text-white hover:text-teal-700 dark:hover:text-teal-400"
                      >
                        {d.name}
                      </button>
                      <p className="font-mono-num text-xs text-slate-500">{d.gstin}</p>
                    </td>
                    <td className="py-3 px-4 text-right">{d.invoices}</td>
                    <td className="py-3 px-4 text-right font-bold text-slate-900 dark:text-white">
                      {formatINR(d.total)}
                    </td>
                    <td className="py-3 px-4 text-right">{formatINR(d.gst)}</td>
                    <td className="py-3 px-5 text-right font-semibold text-amber-700 dark:text-amber-400">
                      {formatINR(d.outstanding)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'returns' && (
        <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          {state.purchaseReturns.length === 0 ? (
            <p className="p-8 text-sm text-slate-500 text-center">No purchase returns logged yet.</p>
          ) : (
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500">
                  <th className="py-3 px-5">Return No & Date</th>
                  <th className="py-3 px-4">Medicine & Batch</th>
                  <th className="py-3 px-4">Distributor</th>
                  <th className="py-3 px-4 text-right">Qty</th>
                  <th className="py-3 px-4 text-right">Credit Note</th>
                  <th className="py-3 px-5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {state.purchaseReturns.map((r) => (
                  <tr key={r.id}>
                    <td className="py-3 px-5 font-mono-num text-xs">
                      <p className="font-semibold text-slate-900 dark:text-white">{r.returnNumber}</p>
                      <p className="text-slate-500">{r.date}</p>
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900 dark:text-white">{r.medicineName}</p>
                      <p className="font-mono-num text-xs text-slate-500">
                        Batch {r.batchNumber} · {r.reason}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300">
                      {r.distributorName}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-num">{r.quantity}</td>
                    <td className="py-3 px-4 text-right font-mono-num font-bold text-slate-900 dark:text-white">
                      {formatINR(r.creditAmount)}
                    </td>
                    <td className="py-3 px-5 text-right text-xs font-semibold">
                      <span
                        className={
                          r.status === 'credited'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }
                      >
                        {r.status === 'credited' ? 'Credited' : 'Pending Credit'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function MetricBlock({
  label,
  value,
  sub,
  critical,
}: {
  label: string;
  value: string;
  sub: string;
  critical?: boolean;
}) {
  return (
    <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p
        className={`font-display font-mono-num text-2xl font-bold mt-1 ${
          critical ? 'text-red-700 dark:text-red-400' : 'text-slate-900 dark:text-white'
        }`}
      >
        {value}
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{sub}</p>
    </div>
  );
}

// =========================================================================
// SCREEN 19: NOTIFICATION CENTER
// =========================================================================
export function NotificationsScreen({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onNavigate,
}: {
  notifications: NotificationItem[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: (ids: string[]) => void;
  onNavigate: (screen: AppScreen, entityId?: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'unread' | 'critical'>('all');

  const visible = notifications.filter((n) => {
    if (filter === 'unread') return !n.read;
    if (filter === 'critical') return n.severity === 'critical';
    return true;
  });

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
            Notification Center
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Real-time expiry warnings, low-stock alerts, and pending GSTR-2B reconciliations
          </p>
        </div>
        <button
          type="button"
          onClick={() => onMarkAllRead(notifications.map((n) => n.id))}
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <CheckCheck className="w-4 h-4" />
          <span>Mark All Read</span>
        </button>
      </div>

      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 w-fit">
        {(
          [
            ['all', `All (${notifications.length})`],
            ['unread', `Unread (${notifications.filter((n) => !n.read).length})`],
            ['critical', `Critical (${notifications.filter((n) => n.severity === 'critical').length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
              filter === id
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/80 overflow-hidden">
        {visible.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Bell className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
              No alerts in this view.
            </p>
          </div>
        ) : (
          visible.map((n) => {
            const Icon =
              n.severity === 'critical'
                ? AlertCircle
                : n.severity === 'warning'
                  ? AlertTriangle
                  : Info;
            const tone =
              n.severity === 'critical'
                ? 'text-red-700 dark:text-red-400'
                : n.severity === 'warning'
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-teal-700 dark:text-teal-400';

            return (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  onMarkRead(n.id);
                  onNavigate(n.targetScreen, n.targetId);
                }}
                className={`w-full px-5 py-4 flex items-start gap-3.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${
                  n.read ? 'opacity-70' : ''
                }`}
              >
                <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${tone}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {n.title}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    {n.description}
                  </p>
                </div>
                <span className="text-xs font-semibold text-teal-700 dark:text-teal-400 whitespace-nowrap">
                  Open
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// =========================================================================
// SCREEN 20: SETTINGS & PROFILE (ROLES, DARK MODE, SYNC, BACKUP, AUDIT LOG)
// =========================================================================
export function ProfileSettingsScreen({
  state,
  isDark,
  onToggleDark,
  isOnline,
  isSyncing,
  onSyncNow,
  onUpdateProfile,
  onSwitchRole,
  onRestoreBackup,
  onResetDemo,
  onNavigate,
  onShowToast,
}: {
  state: PharmacyState;
  isDark: boolean;
  onToggleDark: () => void;
  isOnline: boolean;
  isSyncing: boolean;
  onSyncNow: () => Promise<{ ok: boolean; error?: string }>;
  onUpdateProfile: (partial: Partial<UserProfile>) => void;
  onSwitchRole: (role: UserRole) => void;
  onRestoreBackup: (backup: PharmacyState) => void;
  onResetDemo: () => void;
  onNavigate: (screen: AppScreen) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string) => void;
}) {
  const [storeName, setStoreName] = useState(state.user.storeName);
  const [storeGstin, setStoreGstin] = useState(state.user.storeGstin);
  const [dlNumber, setDlNumber] = useState(state.user.drugLicenseNumber);
  const [address, setAddress] = useState(state.user.storeAddress);
  const [phone, setPhone] = useState(state.user.phone);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeName.trim()) {
      onShowToast('error', 'Store name cannot be empty.');
      return;
    }
    onUpdateProfile({
      storeName: storeName.trim(),
      storeGstin: storeGstin.trim().toUpperCase(),
      drugLicenseNumber: dlNumber.trim(),
      storeAddress: address.trim(),
      phone: phone.trim(),
    });
    onShowToast('success', 'Pharmacy profile updated.');
  };

  const handleBackupDownload = () => {
    downloadJSON(
      `medistock-backup-${new Date().toISOString().slice(0, 10)}.json`,
      state
    );
    onShowToast('success', 'Full encrypted-ready JSON backup downloaded.');
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as PharmacyState;
      onRestoreBackup(parsed);
      onShowToast('success', 'Pharmacy inventory restored from backup file.');
    } catch {
      onShowToast('error', 'Could not restore: invalid MediStock AI JSON backup file.');
    }
    e.target.value = '';
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Pharmacist Profile Header */}
      <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {state.user.avatarUrl ? (
            <img
              src={state.user.avatarUrl}
              alt={state.user.name}
              referrerPolicy="no-referrer"
              className="w-16 h-16 rounded-2xl object-cover border border-slate-200 dark:border-slate-700"
            />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-teal-700 text-white flex items-center justify-center font-display text-xl font-bold">
              {state.user.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
              {state.user.name}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {state.user.storeName} · {state.user.role === 'owner' ? 'Pharmacy Owner' : 'Staff Pharmacist'}
            </p>
            <p className="font-mono-num text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              GSTIN {state.user.storeGstin} · DL {state.user.drugLicenseNumber}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('onboarding')}
            className="h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            App Tour
          </button>
          <button
            type="button"
            onClick={() => onNavigate('splash')}
            className="h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            Splash Preview
          </button>
          <button
            type="button"
            onClick={() => onNavigate('auth')}
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl border border-red-200 dark:border-red-900 text-xs font-semibold text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out / Switch</span>
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-5">
        {/* Store Details Form */}
        <form
          onSubmit={handleSaveProfile}
          className="lg:col-span-7 bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4"
        >
          <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
            Pharmacy Store Details
          </h3>
          <div className="grid sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label htmlFor="prof-store" className="block text-xs font-medium text-slate-500 mb-1">
                Medical Store Name
              </label>
              <input
                id="prof-store"
                type="text"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label htmlFor="prof-gstin" className="block text-xs font-medium text-slate-500 mb-1">
                Store GSTIN
              </label>
              <input
                id="prof-gstin"
                type="text"
                value={storeGstin}
                onChange={(e) => setStoreGstin(e.target.value.toUpperCase())}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label htmlFor="prof-dl" className="block text-xs font-medium text-slate-500 mb-1">
                Drug License Number
              </label>
              <input
                id="prof-dl"
                type="text"
                value={dlNumber}
                onChange={(e) => setDlNumber(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label htmlFor="prof-phone" className="block text-xs font-medium text-slate-500 mb-1">
                Phone
              </label>
              <input
                id="prof-phone"
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label htmlFor="prof-addr" className="block text-xs font-medium text-slate-500 mb-1">
                Address
              </label>
              <input
                id="prof-addr"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
              />
            </div>
          </div>
          <button
            type="submit"
            className="h-10 px-5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold"
          >
            Save Store Profile
          </button>
        </form>

        {/* Controls: Multi-User Role, Theme, Offline Sync, Backup & Restore */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Shield className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    Multi-User Role Access
                  </p>
                  <p className="text-xs text-slate-500">
                    Staff role disables destructive deletions & resets
                  </p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80">
              {(['owner', 'staff'] as UserRole[]).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => {
                    onSwitchRole(role);
                    onShowToast(
                      'info',
                      `Switched active role to ${role === 'owner' ? 'Pharmacy Owner' : 'Staff Pharmacist'}.`
                    );
                  }}
                  className={`py-2 rounded-lg text-xs font-semibold ${
                    state.user.role === role
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {role === 'owner' ? 'Owner (Full)' : 'Staff (Restricted)'}
                </button>
              ))}
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  Appearance Theme
                </p>
                <p className="text-xs text-slate-500">
                  {isDark ? 'Dark mode enabled' : 'Light mode enabled'}
                </p>
              </div>
              <button
                type="button"
                onClick={onToggleDark}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
              </button>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {isOnline ? (
                  <Cloud className="w-4 h-4 text-emerald-600" />
                ) : (
                  <CloudOff className="w-4 h-4 text-amber-600" />
                )}
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {isOnline ? 'Online Cloud Sync' : 'Offline Local Cache'}
                  </p>
                  <p className="text-[11px] font-mono-num text-slate-500">
                    Last sync {state.lastSyncedAt.slice(0, 16).replace('T', ' ')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSyncing}
                onClick={async () => {
                  const res = await onSyncNow();
                  onShowToast(
                    res.ok ? 'success' : 'error',
                    res.ok ? 'Inventory synchronized with server.' : res.error || 'Sync failed.'
                  );
                }}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>Sync</span>
              </button>
            </div>
          </div>

          {/* Android App Install & APK Packaging */}
          <AndroidPackagingCard onShowToast={onShowToast} />

          {/* Backup & Restore */}
          <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-3">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              Backup & Data Recovery
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleBackupDownload}
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Download className="w-4 h-4" />
                <span>Download Backup</span>
              </button>
              <input
                ref={restoreInputRef}
                type="file"
                accept="application/json"
                onChange={handleRestoreFile}
                className="hidden"
              />
              <button
                type="button"
                disabled={state.user.role !== 'owner'}
                onClick={() => restoreInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
              >
                <Upload className="w-4 h-4" />
                <span>Restore JSON</span>
              </button>
              {state.user.role === 'owner' && (
                <button
                  type="button"
                  onClick={() => {
                    onResetDemo();
                    onShowToast('info', 'Inventory reset to initial Indian pharmacy demo dataset.');
                  }}
                  className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-red-200 dark:border-red-900 text-xs font-semibold text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Reset Sample Data</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Audit Log Trail */}
      <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            Inventory Audit Trail ({state.auditLogs.length} entries)
          </h3>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800/80 max-h-72 overflow-y-auto">
          {state.auditLogs.slice(0, 20).map((log) => (
            <div key={log.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">
                  {log.action}: {log.entityName}
                </p>
                <p className="text-slate-500 dark:text-slate-400">{log.details}</p>
              </div>
              <div className="text-right font-mono-num text-slate-500">
                <p>
                  {log.actorName} ({log.actorRole})
                </p>
                <p>{log.timestamp.slice(0, 16).replace('T', ' ')}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AndroidPackagingCard({
  onShowToast,
}: {
  onShowToast: (type: 'success' | 'error' | 'info', message: string) => void;
}) {
  const currentHost = typeof window !== 'undefined' ? window.location.host : '';
  const isPrivatePreview =
    currentHost.startsWith('ais-dev-') ||
    currentHost.startsWith('ais-pre-') ||
    currentHost.startsWith('localhost') ||
    currentHost.startsWith('127.0.0.1');

  const [publicUrl, setPublicUrl] = useState(
    isPrivatePreview ? '' : typeof window !== 'undefined' ? window.location.origin : ''
  );

  const normalizeOrigin = (raw: string): { origin: string; host: string } | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
      return { origin: parsed.origin, host: parsed.host };
    } catch {
      return null;
    }
  };

  const handleExportTWA = () => {
    const target = normalizeOrigin(publicUrl);
    if (!target) {
      onShowToast(
        'error',
        'Deploy MediStock AI to a public HTTPS URL (e.g. Cloud Run) and paste it above before exporting twa-manifest.json.'
      );
      return;
    }
    downloadJSON('twa-manifest.json', {
      packageId: 'in.medistock.ai.pharmacy',
      host: target.host,
      name: 'MediStock AI',
      launcherName: 'MediStock AI',
      display: 'standalone',
      themeColor: '#0F766E',
      navigationColor: '#0F766E',
      backgroundColor: '#F8FAFC',
      enableNotifications: true,
      startUrl: '/',
      iconUrl: `${target.origin}/pwa-512x512.png`,
      maskableIconUrl: `${target.origin}/pwa-maskable-512x512.png`,
      minSdkVersion: 26,
      appVersionName: '1.0.0',
      appVersionCode: 1,
      signingKey: { path: './android.keystore', alias: 'medistock' },
    });
    onShowToast('success', `Downloaded twa-manifest.json for ${target.host}.`);
  };

  const handleExportCapacitor = () => {
    const target = normalizeOrigin(publicUrl);
    const config: Record<string, unknown> = {
      appId: 'in.medistock.ai.pharmacy',
      appName: 'MediStock AI',
      webDir: 'dist',
      android: {
        allowMixedContent: false,
        captureInput: true,
      },
    };
    if (target) {
      config.server = {
        url: target.origin,
        cleartext: false,
      };
    }
    downloadJSON('capacitor.config.json', config);
    onShowToast(
      'success',
      target
        ? `Downloaded capacitor.config.json linked to ${target.host}.`
        : 'Downloaded offline-bundled capacitor.config.json (uses local dist/ folder).'
    );
  };

  return (
    <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-3.5">
      <div className="flex items-center gap-2">
        <Smartphone className="w-4 h-4 text-teal-700 dark:text-teal-400" />
        <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
          Install on Android &amp; Build Signed APK
        </h3>
      </div>

      {isPrivatePreview && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
          <p className="font-semibold">Preview URLs require sign-in</p>
          <p className="mt-0.5 text-amber-800 dark:text-amber-300/90">
            External tools like PWABuilder cannot scan private preview links (<span className="font-mono-num">ais-pre-*</span>) because they redirect to Google sign-in. Deploy the app to a public Cloud Run URL first for PWABuilder, or tap <strong>Install App</strong> directly in Android Chrome.
          </p>
        </div>
      )}

      <div>
        <label htmlFor="apk-public-url" className="block text-xs font-medium text-slate-500 mb-1">
          Public Deployed HTTPS URL (for PWABuilder / Bubblewrap TWA)
        </label>
        <input
          id="apk-public-url"
          type="url"
          value={publicUrl}
          onChange={(e) => setPublicUrl(e.target.value)}
          placeholder="https://medistock-ai-xxxx.run.app"
          className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <PWAInstallButton variant="card" />
        <button
          type="button"
          onClick={handleExportTWA}
          className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <Download className="w-4 h-4" />
          <span>Export TWA Manifest</span>
        </button>
        <button
          type="button"
          onClick={handleExportCapacitor}
          className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <Download className="w-4 h-4" />
          <span>Export Capacitor Config</span>
        </button>
      </div>
    </div>
  );
}
