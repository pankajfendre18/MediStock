import React, { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  ChevronRight,
  Clock,
  FileText,
  Package,
  Plus,
  ScanLine,
} from 'lucide-react';
import {
  Area,
  AreaChart,
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
  classifyBatchExpiry,
  computeDashboardStats,
  formatINR,
  formatShortDate,
} from '../domain/pharmacyMath';
import type { AppScreen, PharmacyState } from '../domain/types';

interface DashboardScreenProps {
  state: PharmacyState;
  onNavigate: (screen: AppScreen, entityId?: string) => void;
}

export function DashboardScreen({ state, onNavigate }: DashboardScreenProps) {
  const stats = useMemo(
    () => computeDashboardStats(state.medicines),
    [state.medicines]
  );

  const reorderItems = useMemo(
    () => buildReorderList(state.medicines).slice(0, 4),
    [state.medicines]
  );

  const urgentExpiryBatches = useMemo(() => {
    const items: Array<{
      medicineId: string;
      medicineName: string;
      batchNumber: string;
      expiryDate: string;
      stock: number;
      bucket: string;
      daysRemaining: number;
    }> = [];
    for (const med of state.medicines) {
      for (const batch of med.batches) {
        if (batch.availableStock <= 0) continue;
        const meta = classifyBatchExpiry(batch.expiryDate);
        if (meta.bucket !== 'safe') {
          items.push({
            medicineId: med.id,
            medicineName: med.name,
            batchNumber: batch.batchNumber,
            expiryDate: batch.expiryDate,
            stock: batch.availableStock,
            bucket: meta.bucket,
            daysRemaining: meta.daysRemaining,
          });
        }
      }
    }
    return items.sort((a, b) => a.daysRemaining - b.daysRemaining).slice(0, 5);
  }, [state.medicines]);

  // Stock value by category chart data
  const categoryStockData = useMemo(() => {
    const map = new Map<string, { category: string; value: number; units: number }>();
    for (const med of state.medicines) {
      const shortCat = med.category.split(' ')[0];
      const entry = map.get(shortCat) || { category: shortCat, value: 0, units: 0 };
      for (const b of med.batches) {
        if (classifyBatchExpiry(b.expiryDate).bucket === 'expired') continue;
        entry.value += b.availableStock * b.purchasePrice;
        entry.units += b.availableStock;
      }
      map.set(shortCat, entry);
    }
    return Array.from(map.values())
      .map((x) => ({ ...x, value: Math.round(x.value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [state.medicines]);

  // Monthly purchase trend combining historical baseline + live imported invoices
  const monthlyTrendData = useMemo(() => {
    const months = [
      { key: '2026-06', label: 'Jun', total: 38400 },
      { key: '2026-07', label: 'Jul', total: 44120 },
      { key: '2026-08', label: 'Aug', total: 31200 },
      { key: '2026-09', label: 'Sep', total: 36500 },
      { key: '2026-10', label: 'Oct', total: 29400 },
      { key: '2026-11', label: 'Nov', total: 14800 },
    ];
    for (const inv of state.invoices) {
      const ym = inv.invoiceDate.slice(0, 7);
      const bucket = months.find((m) => m.key === ym);
      if (bucket) {
        bucket.total = Math.round(bucket.total + inv.grandTotal);
      }
    }
    return months;
  }, [state.invoices]);

  return (
    <div className="space-y-6">
      {/* Primary Focal Anchor: Scan Distributor Bill Banner + Quick Actions */}
      <section className="grid lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-7 rounded-2xl bg-gradient-to-br from-teal-800 via-teal-700 to-emerald-700 text-white p-6 sm:p-7 flex flex-col justify-between gap-6">
          <div className="space-y-2.5 max-w-xl">
            <p className="text-xs font-medium text-teal-100">
              {state.user.storeName} · DL {state.user.drugLicenseNumber.split('/')[0].trim()}
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight [text-wrap:balance]">
              Scan distributor GST bills straight into batch-wise stock
            </h2>
            <p className="text-sm text-teal-50/90 leading-relaxed">
              Capture single or multi-page wholesale bills. MediStock AI extracts medicines, batches, free schemes, GST, and expiry dates for your verification before saving.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('scanner')}
              className="inline-flex items-center gap-2.5 h-12 px-6 rounded-xl bg-white text-teal-900 hover:bg-teal-50 font-semibold text-sm transition-colors shadow-sm whitespace-nowrap shrink-0"
            >
              <Camera className="w-4 h-4 shrink-0" />
              <span>Scan Distributor Bill</span>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('invoices')}
              className="inline-flex items-center gap-2 h-12 px-4 rounded-xl bg-white/15 hover:bg-white/25 text-white font-medium text-sm transition-colors whitespace-nowrap shrink-0"
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span>Recent Invoices ({state.invoices.length})</span>
            </button>
          </div>
        </div>

        {/* 4 Quick Action Buttons Grid */}
        <div className="lg:col-span-5 grid grid-cols-2 gap-3.5">
          <QuickActionTile
            icon={ScanLine}
            title="Scan Bill"
            subtitle="AI OCR & GST verify"
            accent
            onClick={() => onNavigate('scanner')}
          />
          <QuickActionTile
            icon={Plus}
            title="Add Medicine"
            subtitle="Manual batch entry"
            onClick={() => onNavigate('medicine_form')}
          />
          <QuickActionTile
            icon={Package}
            title="View Inventory"
            subtitle={`${stats.totalMedicines} medicines tracked`}
            onClick={() => onNavigate('inventory')}
          />
          <QuickActionTile
            icon={Clock}
            title="Expiry Report"
            subtitle={`${stats.expiredBatchCount} expired · ${stats.expiringSoonTotal} soon`}
            onClick={() => onNavigate('expiry')}
          />
        </div>
      </section>

      {/* 6 Core Pharmacy KPI Metrics Strip */}
      <section aria-label="Inventory Summary Metrics" className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
        <KpiCard
          label="Total Medicines"
          value={String(stats.totalMedicines)}
          detail={`${state.distributors.length} distributors`}
          onClick={() => onNavigate('inventory')}
        />
        <KpiCard
          label="Sellable Stock"
          value={stats.totalSellableStock.toLocaleString('en-IN')}
          detail="Expired excluded"
          onClick={() => onNavigate('inventory')}
        />
        <KpiCard
          label="Purchase Valuation"
          value={formatINR(stats.totalInventoryPurchaseValue)}
          detail={`MRP ${formatINR(stats.totalInventoryMrpValue)}`}
          onClick={() => onNavigate('reports')}
        />
        <KpiCard
          label="Low Stock"
          value={String(stats.lowStockCount)}
          detail="Below min threshold"
          tone={stats.lowStockCount > 0 ? 'warning' : 'normal'}
          onClick={() => onNavigate('low_stock')}
        />
        <KpiCard
          label="Expiring / Expired"
          value={`${stats.expiringSoonTotal} / ${stats.expiredBatchCount}`}
          detail={`Expired ${formatINR(stats.expiredStockValue)}`}
          tone={stats.expiredBatchCount > 0 ? 'critical' : stats.expiringSoonTotal > 0 ? 'warning' : 'normal'}
          onClick={() => onNavigate('expiry')}
        />
        <KpiCard
          label="Out of Stock"
          value={String(stats.outOfStockCount)}
          detail="Immediate reorder"
          tone={stats.outOfStockCount > 0 ? 'critical' : 'normal'}
          onClick={() => onNavigate('low_stock')}
        />
      </section>

      {/* Visual Stock Overview & Monthly Purchase Trend Charts */}
      <section className="grid lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Monthly Purchase Trend
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Distributor GST invoice volume (INR)
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap"
            >
              Full Analytics
            </button>
          </div>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyTrendData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="medistockTealFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0f766e" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#0f766e" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `₹${Math.round(v / 1000)}k`}
                />
                <Tooltip
                  formatter={(value: unknown) => [formatINR(Number(value) || 0), 'Purchases']}
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#0f766e"
                  strokeWidth={2.5}
                  fill="url(#medistockTealFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Stock Value by Category
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sellable inventory at purchase rate
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('inventory')}
              className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap"
            >
              Browse Stock
            </button>
          </div>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryStockData} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `₹${Math.round(v / 1000)}k`}
                />
                <YAxis
                  dataKey="category"
                  type="category"
                  width={84}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value: unknown) => [formatINR(Number(value) || 0), 'Stock Value']}
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="value" fill="#059669" radius={[0, 6, 6, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Bottom Operational Row: Recent Purchase Invoices + Expiry & Reorder Watch */}
      <section className="grid lg:grid-cols-12 gap-5">
        {/* Recent Purchase Invoices */}
        <div className="lg:col-span-7 bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Recent Purchase Invoices
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Verified distributor bills linked to inventory
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('invoices')}
              className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap"
            >
              View All
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {state.invoices.slice(0, 5).map((inv) => (
              <button
                key={inv.id}
                type="button"
                onClick={() => onNavigate('invoice_detail', inv.id)}
                className="w-full px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors text-left"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {inv.distributorName}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    <span className="font-mono-num">{inv.invoiceNumber}</span> · {formatShortDate(inv.invoiceDate)} · {inv.items.length} items ({inv.totalUnitsAdded} units)
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="font-mono-num text-sm font-bold text-slate-900 dark:text-white">
                      {formatINR(inv.grandTotal)}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      GST {formatINR(inv.totalGstAmount)}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Expiry & Low Stock Action Watchlist */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Expiry Watchlist
              </h3>
              <button
                type="button"
                onClick={() => onNavigate('expiry')}
                className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap"
              >
                Manage All
              </button>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {urgentExpiryBatches.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500 dark:text-slate-400">
                  All active batches have more than 90 days of shelf life.
                </p>
              ) : (
                urgentExpiryBatches.map((item) => {
                  const isExp = item.bucket === 'expired';
                  return (
                    <button
                      key={`${item.medicineId}_${item.batchNumber}`}
                      type="button"
                      onClick={() => onNavigate('medicine_detail', item.medicineId)}
                      className="w-full px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {item.medicineName}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-num">
                          Batch {item.batchNumber} · {item.stock} units
                        </p>
                      </div>
                      <span
                        className={`text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1 ${
                          isExp
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {isExp ? 'Expired' : `${item.daysRemaining}d left`}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200/90 dark:border-slate-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Smart Reorder Alerts
              </h3>
              <button
                type="button"
                onClick={() => onNavigate('low_stock')}
                className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap"
              >
                Reorder List
              </button>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {reorderItems.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500 dark:text-slate-400">
                  All medicines are above their minimum stock thresholds.
                </p>
              ) : (
                reorderItems.map((item) => (
                  <button
                    key={item.medicineId}
                    type="button"
                    onClick={() => onNavigate('low_stock')}
                    className="w-full px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {item.medicineName}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {item.lastDistributorName}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className={`font-mono-num text-xs font-bold ${
                          item.availableSellable === 0
                            ? 'text-red-700 dark:text-red-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {item.availableSellable} / {item.minStockLevel} min
                      </p>
                      <p className="text-xs text-teal-700 dark:text-teal-400 font-medium">
                        Order +{item.suggestedReorderQty}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function QuickActionTile({
  icon: Icon,
  title,
  subtitle,
  accent,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl p-4 sm:p-5 border text-left flex flex-col justify-between gap-3 transition-colors ${
        accent
          ? 'bg-teal-50/90 border-teal-200 hover:bg-teal-100/70 dark:bg-teal-950/50 dark:border-teal-800/80 dark:hover:bg-teal-900/50'
          : 'bg-white border-slate-200/90 hover:bg-slate-50 dark:bg-[#111B1E] dark:border-slate-800 dark:hover:bg-slate-800/50'
      }`}
    >
      <div
        className={`w-10 h-10 rounded-xl flex items-center justify-center ${
          accent
            ? 'bg-teal-700 text-white'
            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
        }`}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="font-display text-sm font-bold text-slate-900 dark:text-white">
          {title}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
          {subtitle}
        </p>
      </div>
    </button>
  );
}

function KpiCard({
  label,
  value,
  detail,
  tone = 'normal',
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'normal' | 'warning' | 'critical';
  onClick: () => void;
}) {
  const valueTone =
    tone === 'critical'
      ? 'text-red-700 dark:text-red-400'
      : tone === 'warning'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-slate-900 dark:text-white';

  return (
    <button
      type="button"
      onClick={onClick}
      className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200/90 dark:border-slate-800 p-4 text-left hover:border-teal-600/40 dark:hover:border-teal-500/40 transition-colors"
    >
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
        {label}
      </p>
      <p className={`font-display font-mono-num text-xl sm:text-2xl font-bold mt-1.5 truncate ${valueTone}`}>
        {value}
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
        {detail}
      </p>
    </button>
  );
}
