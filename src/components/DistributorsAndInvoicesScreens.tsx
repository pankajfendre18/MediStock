import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  FileImage,
  Mail,
  MapPin,
  Phone,
  Plus,
  Printer,
  Search,
  Share2,
  X,
} from 'lucide-react';
import { formatINR, formatShortDate } from '../domain/pharmacyMath';
import type {
  AppScreen,
  Distributor,
  PharmacyState,
  PurchaseInvoice,
} from '../domain/types';
import {
  buildWhatsAppReportMessage,
  downloadBlob,
  formatDateDDMMYYYY,
  generateInvoicePdf,
} from '../utils/reportGenerators';

// =========================================================================
// SCREEN 14: DISTRIBUTOR LIST
// =========================================================================
export function DistributorListScreen({
  state,
  onNavigate,
  onSaveDistributor,
  onOpenWhatsapp,
  onShowToast,
}: {
  state: PharmacyState;
  onNavigate: (screen: AppScreen, entityId?: string) => void;
  onSaveDistributor: (d: Omit<Distributor, 'id' | 'createdAt'> & { id?: string }) => void;
  onOpenWhatsapp?: (title: string, message: string) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [gstin, setGstin] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [outstanding, setOutstanding] = useState('0');
  const [formError, setFormError] = useState<string | null>(null);

  const enriched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.distributors
      .map((dist) => {
        const distInvoices = state.invoices.filter((i) => i.distributorId === dist.id);
        const totalPurchased = distInvoices.reduce((s, i) => s + i.grandTotal, 0);
        return {
          ...dist,
          invoiceCount: distInvoices.length,
          totalPurchased,
        };
      })
      .filter((d) => {
        if (!q) return true;
        return (
          d.name.toLowerCase().includes(q) ||
          d.gstin.toLowerCase().includes(q) ||
          d.contactNumber.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.totalPurchased - a.totalPurchased);
  }, [state.distributors, state.invoices, query]);

  const maxPurchase = Math.max(1, ...enriched.map((e) => e.totalPurchased));

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Distributor name is required.');
      return;
    }
    onSaveDistributor({
      name: name.trim(),
      gstin: gstin.trim().toUpperCase(),
      contactNumber: phone.trim(),
      email: email.trim(),
      address: address.trim(),
      outstandingPayment: Math.max(0, Number(outstanding) || 0),
    });
    setModalOpen(false);
    setName('');
    setGstin('');
    setPhone('');
    setEmail('');
    setAddress('');
    setOutstanding('0');
    setFormError(null);
    onShowToast('success', 'Distributor added to your stockist directory.');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
            Distributors & Stockists
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {state.distributors.length} registered wholesale suppliers · Automatically matched when scanning bills
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onOpenWhatsapp && (
            <button
              type="button"
              onClick={() =>
                onOpenWhatsapp(
                  'Distributor Payment Summary (WhatsApp)',
                  buildWhatsAppReportMessage(state, { reportType: 'distributor_payments' })
                )
              }
              className="inline-flex items-center gap-1.5 h-10 sm:h-11 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold whitespace-nowrap"
            >
              <Share2 className="w-4 h-4" />
              <span>Payment Summary</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-semibold whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Add Distributor</span>
          </button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          aria-label="Search distributors by name, GSTIN, or phone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search distributor name, GSTIN, or phone..."
          className="w-full h-10 pl-10 pr-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111B1E] text-sm text-slate-900 dark:text-white"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {enriched.map((dist) => (
          <button
            key={dist.id}
            type="button"
            onClick={() => onNavigate('distributor_detail', dist.id)}
            className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-teal-600/50 dark:hover:border-teal-500/50 p-5 text-left space-y-4 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-white truncate">
                  {dist.name}
                </h3>
                <p className="font-mono-num text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  GSTIN {dist.gstin || 'Not provided'} · {dist.invoiceCount} bill(s)
                </p>
              </div>
              <Building2 className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0" />
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-slate-500 dark:text-slate-400">Total Purchases</p>
                <p className="font-mono-num text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                  {formatINR(dist.totalPurchased)}
                </p>
              </div>
              <div>
                <p className="text-slate-500 dark:text-slate-400">Outstanding Due</p>
                <p
                  className={`font-mono-num text-sm font-bold mt-0.5 ${
                    dist.outstandingPayment > 0
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {dist.outstandingPayment > 0 ? formatINR(dist.outstandingPayment) : 'Settled'}
                </p>
              </div>
            </div>

            {/* Purchase volume comparison bar */}
            <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-teal-700 dark:bg-teal-500 rounded-full"
                style={{ width: `${Math.max(6, Math.round((dist.totalPurchased / maxPurchase) * 100))}%` }}
              />
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {dist.contactNumber || 'No phone'} · {dist.address}
            </p>
          </button>
        ))}
      </div>

      {/* Add Distributor Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Add Distributor"
        >
          <form
            onSubmit={handleAddSubmit}
            className="w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                Add New Distributor
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close modal"
                className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {formError && (
              <p className="text-xs text-red-700 dark:text-red-400 font-medium">{formError}</p>
            )}
            <div className="grid sm:grid-cols-2 gap-3.5">
              <div className="sm:col-span-2">
                <label htmlFor="dist-name" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Distributor / Stockist Name *
                </label>
                <input
                  id="dist-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label htmlFor="dist-gstin" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  GSTIN
                </label>
                <input
                  id="dist-gstin"
                  type="text"
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value.toUpperCase())}
                  placeholder="27AABCM..."
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label htmlFor="dist-phone" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Contact Number
                </label>
                <input
                  id="dist-phone"
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98..."
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label htmlFor="dist-email" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Email
                </label>
                <input
                  id="dist-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label htmlFor="dist-due" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Opening Outstanding (₹)
                </label>
                <input
                  id="dist-due"
                  type="number"
                  value={outstanding}
                  onChange={(e) => setOutstanding(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-num text-slate-900 dark:text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="dist-addr" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Address
                </label>
                <input
                  id="dist-addr"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold"
              >
                Save Distributor
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// SCREEN 15: DISTRIBUTOR DETAILS
// =========================================================================
export function DistributorDetailScreen({
  distributor,
  state,
  onNavigate,
  onRecordPayment,
  onMarkReturnCredited,
  onOpenWhatsapp,
  onShowToast,
}: {
  distributor: Distributor | undefined;
  state: PharmacyState;
  onNavigate: (screen: AppScreen, entityId?: string) => void;
  onRecordPayment: (distributorId: string, amount: number) => void;
  onMarkReturnCredited: (returnId: string) => void;
  onOpenWhatsapp: (title: string, message: string, phone?: string) => void;
  onShowToast: (type: 'success' | 'error' | 'info', message: string) => void;
}) {
  const [paymentAmount, setPaymentAmount] = useState('');

  if (!distributor) {
    return (
      <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-10 text-center space-y-4">
        <p className="text-sm text-slate-500">Distributor not found.</p>
        <button
          type="button"
          onClick={() => onNavigate('distributors')}
          className="px-4 py-2 rounded-xl bg-teal-700 text-white text-sm font-semibold"
        >
          Back to Distributors
        </button>
      </div>
    );
  }

  const distInvoices = state.invoices.filter((i) => i.distributorId === distributor.id);
  const distReturns = state.purchaseReturns.filter((r) => r.distributorId === distributor.id);
  const totalPurchased = distInvoices.reduce((s, i) => s + i.grandTotal, 0);

  const handlePay = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(paymentAmount);
    if (!(amt > 0)) {
      onShowToast('error', 'Enter a valid payment amount greater than ₹0.');
      return;
    }
    onRecordPayment(distributor.id, amt);
    setPaymentAmount('');
    onShowToast('success', `Recorded payment of ${formatINR(amt)} to ${distributor.name}.`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onNavigate('distributors')}
          className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>All Distributors</span>
        </button>
        <button
          type="button"
          onClick={() =>
            onOpenWhatsapp(
              `Message ${distributor.name}`,
              `Hello ${distributor.name},\nThis is ${state.user.storeName} (GSTIN: ${state.user.storeGstin}). Requesting statement / upcoming medicine order confirmation.`,
              distributor.contactNumber
            )
          }
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
        >
          <Share2 className="w-4 h-4" />
          <span>WhatsApp Distributor</span>
        </button>
      </div>

      <div className="grid lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              {distributor.name}
            </h2>
            <p className="font-mono-num text-xs text-slate-500 dark:text-slate-400 mt-1">
              GSTIN: {distributor.gstin || 'Not provided'}
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-3 text-xs text-slate-600 dark:text-slate-300">
            <p className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-slate-400 shrink-0" />
              <span>{distributor.contactNumber || '—'}</span>
            </p>
            <p className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="truncate">{distributor.email || '—'}</span>
            </p>
            <p className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="truncate">{distributor.address}</span>
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div>
              <p className="text-xs text-slate-500">Total Purchases</p>
              <p className="font-mono-num text-lg font-bold text-slate-900 dark:text-white">
                {formatINR(totalPurchased)}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Invoices Imported</p>
              <p className="font-mono-num text-lg font-bold text-slate-900 dark:text-white">
                {distInvoices.length}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Outstanding Payable</p>
              <p
                className={`font-mono-num text-lg font-bold ${
                  distributor.outstandingPayment > 0
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {formatINR(distributor.outstandingPayment)}
              </p>
            </div>
          </div>
        </div>

        {/* Record Payment Card */}
        <form
          onSubmit={handlePay}
          className="lg:col-span-4 bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-3.5"
        >
          <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
            Record Distributor Payment
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Deduct UPI / NEFT / cheque settlements from outstanding balance.
          </p>
          <div>
            <label htmlFor="pay-amt" className="block text-xs font-medium text-slate-500 mb-1">
              Amount Paid (₹)
            </label>
            <input
              id="pay-amt"
              type="number"
              step="0.01"
              value={paymentAmount}
              onChange={(e) => setPaymentAmount(e.target.value)}
              placeholder={String(distributor.outstandingPayment)}
              className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-num text-slate-900 dark:text-white"
            />
          </div>
          <button
            type="submit"
            className="w-full h-10 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold"
          >
            Record Payment
          </button>
        </form>
      </div>

      {/* Purchase History & Returns */}
      <div className="grid lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              Purchase Invoice History ({distInvoices.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {distInvoices.length === 0 ? (
              <p className="p-5 text-xs text-slate-500">No invoices imported for this distributor yet.</p>
            ) : (
              distInvoices.map((inv) => (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => onNavigate('invoice_detail', inv.id)}
                  className="w-full px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-left"
                >
                  <div>
                    <p className="font-mono-num text-sm font-semibold text-slate-900 dark:text-white">
                      {inv.invoiceNumber}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatShortDate(inv.invoiceDate)} · {inv.items.length} items · {inv.totalUnitsAdded} units
                    </p>
                  </div>
                  <div className="text-right font-mono-num">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      {formatINR(inv.grandTotal)}
                    </p>
                    <p className="text-xs text-slate-500">GST {formatINR(inv.totalGstAmount)}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
              Expiry & Purchase Returns ({distReturns.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {distReturns.length === 0 ? (
              <p className="p-5 text-xs text-slate-500">No purchase returns raised with this distributor.</p>
            ) : (
              distReturns.map((ret) => (
                <div key={ret.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-900 dark:text-white">
                      {ret.medicineName} · Batch {ret.batchNumber}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {ret.returnNumber} · {ret.quantity} units ({ret.reason})
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono-num text-xs font-bold text-slate-900 dark:text-white">
                      {formatINR(ret.creditAmount)}
                    </p>
                    {ret.status === 'pending' ? (
                      <button
                        type="button"
                        onClick={() => {
                          onMarkReturnCredited(ret.id);
                          onShowToast('success', `Credit note settled for ${ret.returnNumber}.`);
                        }}
                        className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 hover:underline"
                      >
                        Mark Credited
                      </button>
                    ) : (
                      <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                        Credited
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// SCREEN 16: PURCHASE INVOICE HISTORY
// =========================================================================
export function InvoiceHistoryScreen({
  state,
  onNavigate,
}: {
  state: PharmacyState;
  onNavigate: (screen: AppScreen, entityId?: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [gstFilter, setGstFilter] = useState<'all' | 'reconciled' | 'pending'>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.invoices.filter((inv) => {
      if (gstFilter === 'reconciled' && !inv.gstReconciled) return false;
      if (gstFilter === 'pending' && inv.gstReconciled) return false;
      if (!q) return true;
      return (
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.distributorName.toLowerCase().includes(q) ||
        inv.distributorGstin.toLowerCase().includes(q)
      );
    });
  }, [state.invoices, query, gstFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
            Purchase Invoice History
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {state.invoices.length} verified tax invoices · Duplicate protection active via GSTIN + Invoice No.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('scanner')}
          className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>Scan New Bill</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label="Search purchase invoices"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search invoice number, distributor, or GSTIN..."
            className="w-full h-10 pl-10 pr-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111B1E] text-sm text-slate-900 dark:text-white"
          />
        </div>

        <div className="max-w-full overflow-x-auto no-scrollbar">
          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 min-w-max">
          {(
            [
              ['all', 'All Bills'],
              ['reconciled', 'GST Reconciled'],
              ['pending', 'Pending GSTR-2B'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setGstFilter(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${
                gstFilter === id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Mobile Invoice Cards */}
        <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800/80">
          {filtered.map((inv) => (
            <button
              key={inv.id}
              type="button"
              onClick={() => onNavigate('invoice_detail', inv.id)}
              className="w-full p-3.5 text-left space-y-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono-num text-sm font-bold text-slate-900 dark:text-white truncate">
                    {inv.invoiceNumber}
                  </p>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                    {inv.distributorName}
                  </p>
                </div>
                <div className="text-right font-mono-num shrink-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">
                    {formatINR(inv.grandTotal)}
                  </p>
                  <p className="text-[11px] text-slate-500">GST {formatINR(inv.totalGstAmount)}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>
                  {formatShortDate(inv.invoiceDate)} · {inv.items.length} items ({inv.totalUnitsAdded} u)
                </span>
                <span
                  className={`font-semibold ${
                    inv.gstReconciled
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {inv.gstReconciled ? 'Reconciled' : 'Pending'}
                </span>
              </div>
            </button>
          ))}
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-900/40">
                <th className="py-3 px-5">Invoice & Date</th>
                <th className="py-3 px-4">Distributor & GSTIN</th>
                <th className="py-3 px-4 text-right">Items / Units</th>
                <th className="py-3 px-4 text-right">GST</th>
                <th className="py-3 px-4 text-right">Grand Total</th>
                <th className="py-3 px-5 text-right">GSTR-2B</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filtered.map((inv) => (
                <tr
                  key={inv.id}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="py-3.5 px-5">
                    <button
                      type="button"
                      onClick={() => onNavigate('invoice_detail', inv.id)}
                      className="text-left group"
                    >
                      <p className="font-mono-num font-semibold text-slate-900 dark:text-white group-hover:text-teal-700 dark:group-hover:text-teal-400">
                        {inv.invoiceNumber}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatShortDate(inv.invoiceDate)}
                        {inv.imageUrls.length > 0 ? ` · ${inv.imageUrls.length} bill photo` : ''}
                      </p>
                    </button>
                  </td>
                  <td className="py-3.5 px-4">
                    <p className="font-medium text-slate-900 dark:text-white">
                      {inv.distributorName}
                    </p>
                    <p className="font-mono-num text-xs text-slate-500">
                      {inv.distributorGstin || '—'}
                    </p>
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono-num text-xs text-slate-700 dark:text-slate-300">
                    {inv.items.length} items · {inv.totalUnitsAdded} units
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono-num text-xs text-slate-700 dark:text-slate-300">
                    {formatINR(inv.totalGstAmount)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono-num font-bold text-slate-900 dark:text-white">
                    {formatINR(inv.grandTotal)}
                  </td>
                  <td className="py-3.5 px-5 text-right text-xs font-semibold">
                    <span
                      className={
                        inv.gstReconciled
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }
                    >
                      {inv.gstReconciled ? 'Reconciled' : 'Pending'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// SCREEN 17: INVOICE DETAILS (PDF PRINT, GST BREAKDOWN, ORIGINAL PHOTO)
// =========================================================================
export function InvoiceDetailScreen({
  invoice,
  state,
  onNavigate,
  onToggleReconciled,
  onOpenWhatsapp,
}: {
  invoice: PurchaseInvoice | undefined;
  state: PharmacyState;
  onNavigate: (screen: AppScreen, entityId?: string) => void;
  onToggleReconciled: (invoiceId: string) => void;
  onOpenWhatsapp: (title: string, message: string) => void;
}) {
  const [showPhoto, setShowPhoto] = useState(false);

  if (!invoice) {
    return (
      <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-10 text-center space-y-4">
        <p className="text-sm text-slate-500">Purchase invoice not found.</p>
        <button
          type="button"
          onClick={() => onNavigate('invoices')}
          className="px-4 py-2 rounded-xl bg-teal-700 text-white text-sm font-semibold"
        >
          Back to Invoices
        </button>
      </div>
    );
  }

  const shareSummary = () => {
    const lines = [
      `🧾 *Purchase Invoice Summary — ${state.user.storeName}*`,
      `Distributor: *${invoice.distributorName}* (${invoice.distributorGstin || 'N/A'})`,
      `Invoice No: *${invoice.invoiceNumber}* | Date: ${formatDateDDMMYYYY(invoice.invoiceDate)}`,
      `Taxable: ${formatINR(invoice.subtotalTaxable)} | GST: ${formatINR(invoice.totalGstAmount)}`,
      `Grand Total: *${formatINR(invoice.grandTotal)}* (${invoice.totalUnitsAdded} units)`,
    ];
    onOpenWhatsapp('Share Purchase Invoice on WhatsApp', lines.join('\n'));
  };

  const handleDownloadPdf = () => {
    const pdf = generateInvoicePdf(state, invoice);
    downloadBlob(pdf.blob, pdf.filename);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <button
          type="button"
          onClick={() => onNavigate('invoices')}
          className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Invoice History</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {invoice.imageUrls.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPhoto((s) => !s)}
              className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200"
            >
              <FileImage className="w-4 h-4" />
              <span>{showPhoto ? 'Hide Bill Photo' : 'View Bill Photo'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onToggleReconciled(invoice.id)}
            className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{invoice.gstReconciled ? 'GST Reconciled' : 'Mark GST Reconciled'}</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
          >
            <Printer className="w-4 h-4" />
            <span>Download PDF</span>
          </button>
          <button
            type="button"
            onClick={shareSummary}
            className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
          >
            <Share2 className="w-4 h-4" />
            <span>WhatsApp</span>
          </button>
        </div>
      </div>

      {showPhoto && invoice.imageUrls.length > 0 && (
        <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 grid sm:grid-cols-2 gap-4 no-print">
          {invoice.imageUrls.map((url, idx) => (
            <img
              key={idx}
              src={url}
              alt={`Original invoice photo ${idx + 1}`}
              referrerPolicy="no-referrer"
              className="w-full max-h-[520px] object-contain rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50"
            />
          ))}
        </div>
      )}

      {/* Printable Tax Invoice Sheet */}
      <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
          <div>
            <p className="text-xs font-semibold text-teal-700 dark:text-teal-400">
              PURCHASE TAX INVOICE RECORD
            </p>
            <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {invoice.distributorName}
            </h2>
            <p className="font-mono-num text-xs text-slate-500 dark:text-slate-400 mt-1">
              Supplier GSTIN: {invoice.distributorGstin || '—'} · Imported by {invoice.importedBy}
            </p>
          </div>
          <div className="text-left sm:text-right font-mono-num">
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {invoice.invoiceNumber}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Date: {formatShortDate(invoice.invoiceDate)}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Buyer: {state.user.storeName} ({state.user.storeGstin})
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-2.5 pr-3">Medicine</th>
                <th className="py-2.5 px-2">Batch / Exp</th>
                <th className="py-2.5 px-2">HSN</th>
                <th className="py-2.5 px-2 text-right">Qty + Free</th>
                <th className="py-2.5 px-2 text-right">Rate / MRP</th>
                <th className="py-2.5 px-2 text-right">GST</th>
                <th className="py-2.5 pl-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono-num">
              {invoice.items.map((item) => (
                <tr key={item.id}>
                  <td className="py-3 pr-3 font-sans">
                    <p className="font-semibold text-slate-900 dark:text-white">
                      {item.medicineName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {item.manufacturer || item.brandName} · {item.packSize}
                    </p>
                  </td>
                  <td className="py-3 px-2 text-xs">
                    <p className="text-slate-900 dark:text-white">{item.batchNumber}</p>
                    <p className="text-slate-500">{item.expiryDate}</p>
                  </td>
                  <td className="py-3 px-2 text-xs text-slate-600 dark:text-slate-300">
                    {item.hsnCode}
                  </td>
                  <td className="py-3 px-2 text-right">
                    {item.quantity}
                    {item.freeQuantity > 0 ? ` + ${item.freeQuantity}F` : ''}
                  </td>
                  <td className="py-3 px-2 text-right">
                    <p>{formatINR(item.purchaseRate)}</p>
                    <p className="text-xs text-slate-500">MRP {formatINR(item.mrp)}</p>
                  </td>
                  <td className="py-3 px-2 text-right">
                    <p>{item.gstPercent}%</p>
                    <p className="text-xs text-slate-500">{formatINR(item.gstAmount)}</p>
                  </td>
                  <td className="py-3 pl-2 text-right font-bold text-slate-900 dark:text-white">
                    {formatINR(item.totalAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* GST Summary Footer */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4 pt-5 border-t border-slate-200 dark:border-slate-800 font-mono-num">
          <div>
            <p className="font-sans text-xs text-slate-500">Taxable Subtotal</p>
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {formatINR(invoice.subtotalTaxable)}
            </p>
          </div>
          <div>
            <p className="font-sans text-xs text-slate-500">CGST</p>
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {formatINR(invoice.cgstAmount)}
            </p>
          </div>
          <div>
            <p className="font-sans text-xs text-slate-500">SGST</p>
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {formatINR(invoice.sgstAmount)}
            </p>
          </div>
          <div>
            <p className="font-sans text-xs text-slate-500">Discount</p>
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {formatINR(invoice.totalDiscount)}
            </p>
          </div>
          <div>
            <p className="font-sans text-xs text-slate-500">Invoice Grand Total</p>
            <p className="text-lg font-extrabold text-teal-700 dark:text-teal-400">
              {formatINR(invoice.grandTotal)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
