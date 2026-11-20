import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckSquare,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  Loader2,
  MessageSquare,
  Search,
  Share2,
  Square,
  X,
} from 'lucide-react';
import {
  classifyBatchExpiry,
  formatINR,
  getMedicineSellableStock,
} from '../domain/pharmacyMath';
import type { PharmacyState } from '../domain/types';
import { buildWhatsAppUrl } from '../utils/exportUtils';
import {
  buildWhatsAppReportMessage,
  downloadBlob,
  formatDateDDMMYYYY,
  generateExcelReport,
  generatePdfReport,
  shareGeneratedReport,
  type ExportReportType,
  type GeneratedReportResult,
} from '../utils/reportGenerators';

type ExportFormat = 'excel' | 'pdf' | 'whatsapp';

interface ExportShareCenterProps {
  state: PharmacyState;
  initialSelectedMedicineIds?: string[];
  onClearInitialSelection?: () => void;
  onNotify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

const REPORT_OPTIONS: Array<{
  id: ExportReportType;
  label: string;
  desc: string;
  supportsDateRange?: boolean;
  supportsSelection?: boolean;
}> = [
  {
    id: 'complete_inventory',
    label: 'Complete Inventory',
    desc: 'All medicines, batches, expiry dates, MRP, GST & valuation',
    supportsSelection: true,
  },
  {
    id: 'selected_medicines',
    label: 'Selected Medicines',
    desc: 'Export only the specific medicines you choose below',
    supportsSelection: true,
  },
  {
    id: 'low_stock',
    label: 'Low Stock & Reorder',
    desc: 'Items below minimum threshold with reorder levels',
  },
  {
    id: 'expired',
    label: 'Expired Batches',
    desc: 'Blocked expired stock for distributor return & write-off',
  },
  {
    id: 'near_expiry',
    label: 'Near-Expiry (90 Days)',
    desc: 'Batches expiring within 30, 60, or 90 days',
  },
  {
    id: 'expiry',
    label: 'Full Expiry Surveillance',
    desc: 'Combined expired + near-expiry batches with cost risk',
  },
  {
    id: 'purchase_history',
    label: 'Purchase History (GST)',
    desc: 'All distributor bills with taxable value, CGST/SGST & totals',
    supportsDateRange: true,
  },
  {
    id: 'distributor_purchases',
    label: 'Distributor-Wise Purchases',
    desc: 'Supplier-wise invoice totals, units supplied & GST summary',
    supportsDateRange: true,
  },
  {
    id: 'distributor_payments',
    label: 'Distributor Payments Due',
    desc: 'Outstanding supplier balances & contact directory',
  },
  {
    id: 'stock_valuation',
    label: 'Stock Valuation',
    desc: 'Cost value vs MRP valuation across every active batch',
  },
];

export const ExportShareCenter: React.FC<ExportShareCenterProps> = ({
  state,
  initialSelectedMedicineIds = [],
  onClearInitialSelection,
  onNotify,
}) => {
  const [format, setFormat] = useState<ExportFormat>('excel');
  const [reportType, setReportType] = useState<ExportReportType>(
    initialSelectedMedicineIds.length > 0 ? 'selected_medicines' : 'complete_inventory'
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedMedicineIds);
  const [medSearch, setMedSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [generated, setGenerated] = useState<GeneratedReportResult | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Sync incoming selection from Inventory multi-select
  useEffect(() => {
    if (initialSelectedMedicineIds.length > 0) {
      setSelectedIds(initialSelectedMedicineIds);
      setReportType('selected_medicines');
    }
  }, [initialSelectedMedicineIds]);

  // Clean up preview blob URL on unmount or replacement
  useEffect(() => {
    return () => {
      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    };
  }, [pdfPreviewUrl]);

  const activeMeta = useMemo(
    () => REPORT_OPTIONS.find((r) => r.id === reportType) || REPORT_OPTIONS[0],
    [reportType]
  );

  const filteredMedsForPicker = useMemo(() => {
    const q = medSearch.trim().toLowerCase();
    if (!q) return state.medicines;
    return state.medicines.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.genericName.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q)
    );
  }, [state.medicines, medSearch]);

  const toggleMedicine = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setGenerated(null);
  };

  const selectAllMeds = () => {
    setSelectedIds(state.medicines.map((m) => m.id));
    setGenerated(null);
  };

  const clearSelection = () => {
    setSelectedIds([]);
    onClearInitialSelection?.();
    setGenerated(null);
  };

  const options = useMemo(
    () => ({
      reportType,
      selectedMedicineIds: reportType === 'selected_medicines' ? selectedIds : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    [reportType, selectedIds, dateFrom, dateTo]
  );

  const whatsappPreviewText = useMemo(
    () => buildWhatsAppReportMessage(state, options),
    [state, options]
  );

  // Compact live preview rows for Excel / PDF before generating
  const previewRows = useMemo(() => {
    const now = new Date();
    if (reportType === 'purchase_history') {
      return state.invoices
        .filter((inv) => {
          const d = inv.invoiceDate.slice(0, 10);
          if (dateFrom && d < dateFrom) return false;
          if (dateTo && d > dateTo) return false;
          return true;
        })
        .slice(0, 6)
        .map((inv) => ({
          col1: inv.invoiceNumber,
          col2: inv.distributorName,
          col3: formatDateDDMMYYYY(inv.invoiceDate),
          col4: formatINR(inv.grandTotal),
          badge: inv.gstReconciled ? 'Reconciled' : 'Pending',
        }));
    }
    if (reportType === 'distributor_purchases' || reportType === 'distributor_payments') {
      return state.distributors.slice(0, 6).map((d) => ({
        col1: d.name,
        col2: d.gstin || 'No GSTIN',
        col3: d.contactNumber || '-',
        col4: formatINR(d.outstandingPayment),
        badge: d.outstandingPayment > 0 ? 'Due' : 'Settled',
      }));
    }
    const targetMeds =
      reportType === 'selected_medicines'
        ? state.medicines.filter((m) => selectedIds.includes(m.id))
        : state.medicines;

    const list: Array<{ col1: string; col2: string; col3: string; col4: string; badge: string }> = [];
    for (const m of targetMeds) {
      const sellable = getMedicineSellableStock(m, now);
      if (reportType === 'low_stock' && sellable >= m.minStockLevel) continue;
      for (const b of m.batches) {
        const exp = classifyBatchExpiry(b.expiryDate, now);
        if (reportType === 'expired' && exp.bucket !== 'expired') continue;
        if (
          reportType === 'near_expiry' &&
          exp.bucket !== 'expiring_30' &&
          exp.bucket !== 'expiring_60' &&
          exp.bucket !== 'expiring_90'
        ) {
          continue;
        }
        if (reportType === 'expiry' && exp.bucket === 'safe') continue;
        list.push({
          col1: m.name,
          col2: `Batch ${b.batchNumber}`,
          col3: formatDateDDMMYYYY(b.expiryDate),
          col4: `${b.availableStock} u · ${formatINR(b.mrp)}`,
          badge:
            exp.bucket === 'expired'
              ? 'EXPIRED'
              : exp.bucket !== 'safe'
                ? 'EXPIRING'
                : sellable < m.minStockLevel
                  ? 'LOW'
                  : 'OK',
        });
        if (list.length >= 6) break;
      }
      if (list.length >= 6) break;
    }
    return list;
  }, [state, reportType, selectedIds, dateFrom, dateTo]);

  const handleGenerate = async () => {
    if (isGenerating) return;
    if (reportType === 'selected_medicines' && selectedIds.length === 0) {
      onNotify('Select at least one medicine first.', 'error');
      return;
    }

    setIsGenerating(true);
    setProgress(25);
    setGenerated(null);

    try {
      await new Promise((r) => setTimeout(r, 80));
      setProgress(65);
      const result =
        format === 'excel'
          ? await generateExcelReport(state, options)
          : generatePdfReport(state, options);

      setProgress(100);
      setGenerated(result);
      downloadBlob(result.blob, result.filename);
      onNotify(
        `${format === 'excel' ? 'Excel (.xlsx)' : 'PDF (.pdf)'} generated & downloaded: ${result.filename}`,
        'success'
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to generate report.',
        'error'
      );
    } finally {
      window.setTimeout(() => {
        setIsGenerating(false);
        setProgress(0);
      }, 250);
    }
  };

  const handleShareGenerated = async () => {
    if (!generated) return;
    const res = await shareGeneratedReport({
      blob: generated.blob,
      filename: generated.filename,
      mimeType: generated.mimeType,
      title: generated.title,
      text: `${state.user.storeName} — ${generated.title}`,
    });
    if (res.shared) {
      onNotify('Share sheet opened for your report.', 'success');
    } else if (res.reason !== 'Share dismissed.') {
      onNotify(
        res.reason || 'Native file sharing unavailable on this browser — file is already downloaded.',
        'info'
      );
    }
  };

  const handleOpenPdfPreview = () => {
    if (!generated || generated.mimeType !== 'application/pdf') return;
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    const url = URL.createObjectURL(generated.blob);
    setPdfPreviewUrl(url);
  };

  const handleCopyWhatsApp = async () => {
    try {
      await navigator.clipboard.writeText(whatsappPreviewText);
      setCopied(true);
      onNotify('WhatsApp report text copied to clipboard.', 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onNotify('Clipboard copy blocked by browser.', 'error');
    }
  };

  const handleNativeShareText = async () => {
    const res = await shareGeneratedReport({
      title: activeMeta.label,
      text: whatsappPreviewText,
    });
    if (res.shared) {
      onNotify('Share sheet opened.', 'success');
    } else if (res.reason !== 'Share dismissed.') {
      onNotify('Use "Open in WhatsApp" or "Copy Text" to share on this browser.', 'info');
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white sm:text-xl">
              Export & Share Center
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
              Generate styled Excel workbooks, multi-page A4 PDF reports, and clean WhatsApp summaries.
            </p>
          </div>
          <div className="inline-flex w-full rounded-xl border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-800 dark:bg-slate-950 sm:w-auto">
            {(
              [
                { id: 'excel', label: 'Excel .xlsx', icon: FileSpreadsheet },
                { id: 'pdf', label: 'PDF .pdf', icon: FileText },
                { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = format === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setFormat(tab.id);
                    setGenerated(null);
                  }}
                  className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-semibold transition sm:flex-initial sm:px-3 ${
                    active
                      ? 'bg-teal-700 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main 2-column Responsive Workspace */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Left: Configuration */}
        <div className="space-y-4 lg:col-span-7">
          {/* Report Type Grid */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              1. Choose Report Type
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {REPORT_OPTIONS.map((opt) => {
                const selected = reportType === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setReportType(opt.id);
                      setGenerated(null);
                    }}
                    className={`rounded-xl border p-3 text-left transition ${
                      selected
                        ? 'border-teal-600 bg-teal-50/70 ring-1 ring-teal-600 dark:border-teal-500 dark:bg-teal-950/40'
                        : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-white sm:text-sm">
                        {opt.label}
                      </span>
                      {selected && (
                        <Check className="h-4 w-4 shrink-0 text-teal-700 dark:text-teal-400" />
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                      {opt.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional Date Range Filter */}
          {activeMeta.supportsDateRange && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  2. Optional Date Range
                </h3>
                {(dateFrom || dateTo) && (
                  <button
                    type="button"
                    onClick={() => {
                      setDateFrom('');
                      setDateTo('');
                      setGenerated(null);
                    }}
                    className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-400"
                  >
                    Clear Dates
                  </button>
                )}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    From Date
                  </label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => {
                      setDateFrom(e.target.value);
                      setGenerated(null);
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    To Date
                  </label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => {
                      setDateTo(e.target.value);
                      setGenerated(null);
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Selected Medicines Checklist */}
          {reportType === 'selected_medicines' && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  2. Select Medicines ({selectedIds.length} selected)
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllMeds}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={medSearch}
                  onChange={(e) => setMedSearch(e.target.value)}
                  placeholder="Filter medicines by name, salt, category..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div className="mt-2 max-h-60 space-y-1.5 overflow-y-auto pr-1">
                {filteredMedsForPicker.map((med) => {
                  const checked = selectedIds.includes(med.id);
                  const qty = getMedicineSellableStock(med);
                  return (
                    <button
                      key={med.id}
                      type="button"
                      onClick={() => toggleMedicine(med.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition ${
                        checked
                          ? 'border-teal-500 bg-teal-50/60 dark:border-teal-600 dark:bg-teal-950/30'
                          : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        {checked ? (
                          <CheckSquare className="h-4 w-4 shrink-0 text-teal-700 dark:text-teal-400" />
                        ) : (
                          <Square className="h-4 w-4 shrink-0 text-slate-400" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900 dark:text-white">
                            {med.name}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">
                            {med.genericName || med.category}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 font-mono-num font-semibold text-slate-600 dark:text-slate-300">
                        {qty} u
                      </span>
                    </button>
                  );
                })}
                {filteredMedsForPicker.length === 0 && (
                  <p className="py-4 text-center text-xs text-slate-500">
                    No medicines match "{medSearch}".
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Live Preview & Generate / Share Actions */}
        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Live Preview
              </h3>
              <span className="rounded-md bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-800 dark:bg-teal-950/60 dark:text-teal-300">
                {format === 'excel'
                  ? 'Excel .xlsx'
                  : format === 'pdf'
                    ? 'A4 PDF'
                    : 'WhatsApp Message'}
              </span>
            </div>

            {format === 'whatsapp' ? (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Optional WhatsApp Number (with country code, e.g. 919820411290)
                  </label>
                  <input
                    value={whatsappPhone}
                    onChange={(e) => setWhatsappPhone(e.target.value)}
                    placeholder="Leave blank to choose contact in WhatsApp"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50 p-3 font-sans text-xs leading-relaxed text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                  {whatsappPreviewText}
                </pre>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleCopyWhatsApp}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                    {copied ? 'Copied' : 'Copy Text'}
                  </button>
                  <button
                    type="button"
                    onClick={handleNativeShareText}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-300"
                  >
                    <Share2 className="h-4 w-4" />
                    Share Sheet
                  </button>
                  <a
                    href={buildWhatsAppUrl(whatsappPreviewText, whatsappPhone)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open in WhatsApp
                  </a>
                </div>
                <p className="text-[11px] text-slate-500">
                  Opens WhatsApp with the formatted message pre-filled so you can review and tap Send.
                </p>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950">
                  <p className="text-xs font-bold text-slate-900 dark:text-white">
                    {state.user.storeName} · {activeMeta.label}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {format === 'excel'
                      ? 'Includes bold teal headers, ₹ currency formatting, DD-MM-YYYY dates, conditional row highlights, frozen pane, AutoFilter & SUM totals.'
                      : 'Includes MediStock AI header, pharmacy GSTIN/DL, repeated page headers, wrapped names, INR totals & Page X of Y footers.'}
                  </p>
                </div>

                {/* Compact preview rows */}
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                  {previewRows.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500">
                      {reportType === 'selected_medicines' && selectedIds.length === 0
                        ? 'Select medicines on the left to preview rows.'
                        : 'No matching rows for the current filter.'}
                    </div>
                  ) : (
                    previewRows.map((row, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900 dark:text-white">
                            {row.col1}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">
                            {row.col2} · {row.col3}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-mono-num font-semibold text-slate-800 dark:text-slate-200">
                            {row.col4}
                          </p>
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              row.badge === 'EXPIRED'
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                : row.badge === 'EXPIRING' || row.badge === 'Pending' || row.badge === 'Due'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                  : row.badge === 'LOW'
                                    ? 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300'
                                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            }`}
                          >
                            {row.badge}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Progress bar when generating */}
                {isGenerating && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-medium text-teal-700 dark:text-teal-400">
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Building {format === 'excel' ? '.xlsx workbook' : 'A4 PDF document'}...
                      </span>
                      <span className="font-mono-num">{progress}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-teal-600 transition-all duration-200"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={handleGenerate}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-teal-800 disabled:opacity-60"
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {format === 'excel' ? 'Generate & Download Excel (.xlsx)' : 'Generate & Download PDF (.pdf)'}
                </button>

                {/* Post-generation Open / Share / Save options */}
                {generated && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                    <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                      Ready: {generated.filename}
                    </p>
                    <p className="mt-0.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                      {generated.rowCount} row(s) · {(generated.bytes.length / 1024).toFixed(1)} KB
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => downloadBlob(generated.blob, generated.filename)}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-xs hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-100"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Save Again
                      </button>
                      {generated.mimeType === 'application/pdf' && (
                        <button
                          type="button"
                          onClick={handleOpenPdfPreview}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-teal-800 shadow-xs hover:bg-teal-50 dark:bg-slate-900 dark:text-teal-300"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Open PDF
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleShareGenerated}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        Share
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* In-App PDF Viewer Modal (no window.open needed) */}
      {pdfPreviewUrl && generated && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-xs sm:p-6"
          onClick={() => setPdfPreviewUrl(null)}
        >
          <div
            className="flex h-[88dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="min-w-0">
                <h3 className="truncate font-display text-sm font-bold text-slate-900 dark:text-white">
                  {generated.filename}
                </h3>
                <p className="text-[11px] text-slate-500">PDF Document Preview</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadBlob(generated.blob, generated.filename)}
                  className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setPdfPreviewUrl(null)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Close PDF preview"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <iframe
              src={pdfPreviewUrl}
              title={generated.filename}
              className="h-full w-full flex-1 bg-slate-100 dark:bg-slate-950"
            />
          </div>
        </div>
      )}
    </div>
  );
};
