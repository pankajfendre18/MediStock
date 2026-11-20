import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Barcode,
  Bell,
  Building2,
  Camera,
  Check,
  Clock,
  Copy,
  FileText,
  Home,
  Mic,
  MicOff,
  Moon,
  Package,
  ScanLine,
  Search,
  Share2,
  Sun,
  TrendingDown,
  User,
  X,
} from 'lucide-react';
import { getMedicineSellableStock, formatINR } from '../domain/pharmacyMath';
import type { AppScreen, Medicine, PharmacyState, SyncStatus } from '../domain/types';
import { buildWhatsAppUrl } from '../utils/exportUtils';
import { shareGeneratedReport } from '../utils/reportGenerators';
import { PWAInstallButton } from './PWAInstallButton';

interface AppShellProps {
  screen: AppScreen;
  onNavigate: (screen: AppScreen, entityId?: string) => void;
  state: PharmacyState;
  unreadNotifications: number;
  isDark: boolean;
  onToggleDark: () => void;
  isOnline: boolean;
  syncStatus?: SyncStatus;
  pendingChangesCount?: number;
  onSyncNow?: () => void;
  onAddRecentSearch: (term: string) => void;
  whatsappModal: { title: string; message: string; phone?: string } | null;
  onCloseWhatsapp: () => void;
  toast: { type: 'success' | 'error' | 'info'; message: string } | null;
  onDismissToast: () => void;
  children: React.ReactNode;
}

const SCREEN_TITLES: Record<AppScreen, string> = {
  splash: 'MediStock AI',
  onboarding: 'Welcome',
  auth: 'Sign In',
  home: 'Dashboard',
  inventory: 'Medicine Inventory',
  medicine_detail: 'Medicine Details',
  medicine_form: 'Add / Edit Medicine',
  scanner: 'AI Bill Scanner',
  preview_crop: 'Preview & Enhance Bill',
  ai_processing: 'AI Invoice Processing',
  invoice_verify: 'Verify Extracted Invoice',
  expiry: 'Expiry Management',
  low_stock: 'Low Stock & Reorder',
  distributors: 'Distributors',
  distributor_detail: 'Distributor Profile',
  invoices: 'Purchase Invoices',
  invoice_detail: 'Invoice Details',
  reports: 'Reports & Analytics',
  export_center: 'Export & Share',
  notifications: 'Notifications',
  profile: 'Settings & Profile',
};

export function AppShell({
  screen,
  onNavigate,
  state,
  unreadNotifications,
  isDark,
  onToggleDark,
  isOnline,
  syncStatus = isOnline ? 'live' : 'offline',
  pendingChangesCount = 0,
  onSyncNow,
  onAddRecentSearch,
  whatsappModal,
  onCloseWhatsapp,
  toast,
  onDismissToast,
  children,
}: AppShellProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const [copiedWhatsapp, setCopiedWhatsapp] = useState(false);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return state.medicines.slice(0, 6);
    return state.medicines
      .filter((m) => {
        const batchMatch = m.batches.some((b) =>
          b.batchNumber.toLowerCase().includes(q)
        );
        return (
          m.name.toLowerCase().includes(q) ||
          m.genericName.toLowerCase().includes(q) ||
          m.brand.toLowerCase().includes(q) ||
          m.manufacturer.toLowerCase().includes(q) ||
          m.barcode.toLowerCase().includes(q) ||
          batchMatch
        );
      })
      .slice(0, 10);
  }, [searchQuery, state.medicines]);

  const barcodeMatch: Medicine | undefined = useMemo(() => {
    const code = barcodeInput.trim();
    if (!code) return undefined;
    return state.medicines.find(
      (m) =>
        m.barcode === code ||
        m.barcode.endsWith(code) ||
        m.batches.some((b) => b.batchNumber.toLowerCase() === code.toLowerCase())
    );
  }, [barcodeInput, state.medicines]);

  const startVoiceSearch = () => {
    const SpeechRecognitionCtor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance; webkitSpeechRecognition?: new () => SpeechRecognitionInstance })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance })
        .webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setVoiceFeedback('Voice recognition is not available in this browser. Type your medicine query instead.');
      return;
    }

    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = 'en-IN';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      setIsListening(true);
      setVoiceFeedback('Listening for medicine name...');
      recognition.onresult = (event: SpeechRecognitionResultEvent) => {
        const transcript = event.results?.[0]?.[0]?.transcript || '';
        setSearchQuery(transcript);
        if (transcript) onAddRecentSearch(transcript);
        setIsListening(false);
        setVoiceFeedback(null);
      };
      recognition.onerror = () => {
        setIsListening(false);
        setVoiceFeedback('Could not capture voice input. Try typing directly.');
      };
      recognition.onend = () => {
        setIsListening(false);
      };
      recognition.start();
    } catch {
      setIsListening(false);
      setVoiceFeedback('Microphone access unavailable.');
    }
  };

  const navItems: Array<{
    id: AppScreen;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    matchScreens: AppScreen[];
  }> = [
    { id: 'home', label: 'Dashboard', icon: Home, matchScreens: ['home'] },
    {
      id: 'inventory',
      label: 'Inventory',
      icon: Package,
      matchScreens: ['inventory', 'medicine_detail', 'medicine_form'],
    },
    {
      id: 'scanner',
      label: 'Scan Bill',
      icon: ScanLine,
      matchScreens: ['scanner', 'preview_crop', 'ai_processing', 'invoice_verify'],
    },
    { id: 'expiry', label: 'Expiry Watch', icon: Clock, matchScreens: ['expiry'] },
    { id: 'low_stock', label: 'Low Stock', icon: TrendingDown, matchScreens: ['low_stock'] },
    {
      id: 'distributors',
      label: 'Distributors',
      icon: Building2,
      matchScreens: ['distributors', 'distributor_detail'],
    },
    {
      id: 'invoices',
      label: 'Invoices',
      icon: FileText,
      matchScreens: ['invoices', 'invoice_detail'],
    },
    { id: 'reports', label: 'Reports', icon: BarChart3, matchScreens: ['reports'] },
    { id: 'export_center', label: 'Export & Share', icon: Share2, matchScreens: ['export_center'] },
    { id: 'notifications', label: 'Alerts', icon: Bell, matchScreens: ['notifications'] },
    { id: 'profile', label: 'Profile & Settings', icon: User, matchScreens: ['profile'] },
  ];

  const isNavActive = (screens: AppScreen[]) => screens.includes(screen);

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900 dark:bg-[#0B1214] dark:text-slate-100">
      {/* Desktop Sidebar (248px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white dark:bg-[#101A1D] border-r border-slate-200/90 dark:border-slate-800 z-30 no-print">
        <div className="h-16 px-6 flex items-center gap-3 border-b border-slate-200/80 dark:border-slate-800">
          <div className="w-9 h-9 rounded-xl bg-teal-700 text-white flex items-center justify-center shrink-0">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              <rect x="3" y="3" width="18" height="18" rx="4" strokeOpacity="0.45" />
            </svg>
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
            MediStock AI
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Primary Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(item.matchScreens);
            const isScan = item.id === 'scanner';
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-teal-700 text-white'
                    : isScan
                      ? 'bg-teal-50 text-teal-800 hover:bg-teal-100 dark:bg-teal-950/60 dark:text-teal-200 dark:hover:bg-teal-900/60'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className="w-[18px] h-[18px] shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'notifications' && unreadNotifications > 0 && (
                  <span
                    className={`font-mono-num text-xs font-semibold ${
                      active ? 'text-teal-100' : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {unreadNotifications}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200/80 dark:border-slate-800 space-y-2.5">
          <PWAInstallButton variant="sidebar" />
          <button
            type="button"
            onClick={() => onNavigate('profile')}
            className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/70 transition-colors text-left"
          >
            {state.user.avatarUrl ? (
              <img
                src={state.user.avatarUrl}
                alt={state.user.name}
                referrerPolicy="no-referrer"
                className="w-9 h-9 rounded-full object-cover shrink-0 border border-slate-200 dark:border-slate-700"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-teal-700 text-white flex items-center justify-center text-sm font-semibold shrink-0">
                {state.user.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                {state.user.storeName}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {state.user.role === 'owner' ? 'Owner' : 'Staff'} ·{' '}
                {syncStatus === 'live'
                  ? 'Live Sync'
                  : syncStatus === 'syncing'
                    ? 'Syncing...'
                    : syncStatus === 'offline'
                      ? 'Offline Mode'
                      : 'Retry Sync'}
              </p>
            </div>
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
        {/* Top Bar (Edge-to-edge safe area aware for Android) */}
        <header className="sticky top-0 z-20 pt-safe pl-safe pr-safe bg-white/95 dark:bg-[#101A1D]/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 no-print">
          <div className="min-h-14 lg:min-h-16 px-3 sm:px-4 lg:px-8 flex items-center justify-between gap-2 sm:gap-4">
          {/* Left: Page Title / Brand on mobile */}
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => onNavigate('home')}
              className="lg:hidden w-8 h-8 rounded-lg bg-teal-700 text-white flex items-center justify-center shrink-0"
              aria-label="Go to Dashboard"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
            </button>
            <div className="min-w-0">
              <h1 className="font-display text-sm sm:text-base lg:text-lg font-bold text-slate-900 dark:text-white truncate">
                {SCREEN_TITLES[screen]}
              </h1>
              <button
                type="button"
                onClick={() => onSyncNow?.()}
                className="lg:hidden flex items-center gap-1.5 text-[10px] font-medium text-slate-500 dark:text-slate-400"
                title="Real-time sync status"
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    syncStatus === 'live'
                      ? 'bg-emerald-500'
                      : syncStatus === 'syncing'
                        ? 'bg-teal-500 animate-pulse'
                        : syncStatus === 'offline'
                          ? 'bg-amber-500'
                          : 'bg-rose-500'
                  }`}
                />
                <span>
                  {syncStatus === 'live'
                    ? 'Synced Live'
                    : syncStatus === 'syncing'
                      ? 'Syncing...'
                      : syncStatus === 'offline'
                        ? pendingChangesCount > 0
                          ? `Offline (${pendingChangesCount} queued)`
                          : 'Offline'
                        : 'Tap to Retry Sync'}
                </span>
              </button>
            </div>
          </div>

          {/* Center: Global Search Trigger */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search medicines, batches, or barcodes"
            className="hidden sm:flex items-center gap-2.5 flex-1 max-w-md h-10 px-3.5 rounded-xl bg-slate-100/90 hover:bg-slate-200/70 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-sm text-slate-500 dark:text-slate-400 transition-colors text-left"
          >
            <Search className="w-4 h-4 shrink-0" />
            <span className="truncate flex-1">Search medicine, salt, batch or barcode...</span>
            <span className="font-mono-num text-xs text-slate-400 dark:text-slate-500">⌘K</span>
          </button>

          {/* Right: Contextual Utility Controls + 1 Primary CTA */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Open global medicine search"
              className="sm:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Search className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => setBarcodeOpen(true)}
              aria-label="Barcode stock lookup"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Barcode Lookup"
            >
              <Barcode className="w-[19px] h-[19px]" />
            </button>
            <button
              type="button"
              onClick={onToggleDark}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {isDark ? <Sun className="w-[19px] h-[19px]" /> : <Moon className="w-[19px] h-[19px]" />}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('notifications')}
              aria-label={`Notifications (${unreadNotifications} unread)`}
              className="relative min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Bell className="w-[19px] h-[19px]" />
              {unreadNotifications > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white font-mono-num text-[10px] font-bold flex items-center justify-center">
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('scanner')}
              className="hidden sm:inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              <Camera className="w-4 h-4 shrink-0" />
              <span>Scan Bill</span>
            </button>
          </div>
          </div>
        </header>

        {/* Offline Status Notice */}
        {!isOnline && (
          <div
            role="status"
            className="bg-amber-600 text-white text-xs font-medium px-4 py-2 text-center no-print"
          >
            Offline Mode — {pendingChangesCount > 0 ? `${pendingChangesCount} change(s) queued locally` : 'Inventory changes are saved locally'} and will sync automatically when internet returns.
          </div>
        )}

        {/* Main Scrollable Viewport */}
        <main className="flex-1 w-full max-w-7xl mx-auto pl-safe pr-safe pb-nav-safe lg:pb-10">
          <div className="px-3 sm:px-6 lg:px-8 py-4 sm:py-5 lg:py-7">{children}</div>
        </main>
      </div>

      {/* Mobile Fixed 5-Tab Bottom Navigation Bar (Home, Inventory, prominent SCAN, Reports, Profile) */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-[#101A1D]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-safe pl-safe pr-safe no-print"
      >
        <div className="grid grid-cols-5 items-end h-[64px] px-1 pb-1">
          <MobileTabButton
            label="Home"
            icon={Home}
            active={screen === 'home'}
            onClick={() => onNavigate('home')}
          />
          <MobileTabButton
            label="Inventory"
            icon={Package}
            active={['inventory', 'medicine_detail', 'medicine_form', 'expiry', 'low_stock'].includes(screen)}
            onClick={() => onNavigate('inventory')}
          />
          {/* Prominent Center Scan Button */}
          <div className="flex flex-col items-center justify-end pb-1">
            <button
              type="button"
              onClick={() => onNavigate('scanner')}
              aria-label="Scan Distributor Bill"
              className={`-mt-5 w-13 h-13 rounded-2xl flex items-center justify-center shadow-lg transition-transform active:scale-95 ${
                ['scanner', 'preview_crop', 'ai_processing', 'invoice_verify'].includes(screen)
                  ? 'bg-emerald-600 text-white ring-4 ring-emerald-500/20'
                  : 'bg-teal-700 text-white hover:bg-teal-800'
              }`}
            >
              <ScanLine className="w-6 h-6" />
            </button>
            <span className="text-[10px] font-semibold text-teal-700 dark:text-teal-400 mt-0.5 whitespace-nowrap">
              Scan
            </span>
          </div>
          <MobileTabButton
            label="Reports"
            icon={BarChart3}
            active={['reports', 'export_center', 'invoices', 'invoice_detail', 'distributors', 'distributor_detail'].includes(screen)}
            onClick={() => onNavigate('reports')}
          />
          <MobileTabButton
            label="Profile"
            icon={User}
            active={['profile', 'notifications'].includes(screen)}
            onClick={() => onNavigate('profile')}
          />
        </div>
      </nav>

      {/* Global Smart Search Modal (with Voice Search & Recent Searches) */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-start justify-center p-3 sm:p-4 pt-safe sm:pt-20 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Global Medicine Search"
        >
          <div className="w-full max-w-2xl max-h-[88dvh] flex flex-col bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden mt-4 sm:mt-0">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <Search className="w-5 h-5 text-slate-400 shrink-0" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search medicine name, generic salt, brand, batch, or barcode..."
                className="flex-1 bg-transparent text-sm sm:text-base text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={startVoiceSearch}
                aria-label="Voice search medicines"
                className={`min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center transition-colors ${
                  isListening
                    ? 'bg-red-600 text-white'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchOpen(false);
                  setVoiceFeedback(null);
                }}
                aria-label="Close search"
                className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {voiceFeedback && (
              <div className="px-4 py-2 bg-teal-50 dark:bg-teal-950/40 text-xs text-teal-800 dark:text-teal-200 border-b border-teal-100 dark:border-teal-900">
                {voiceFeedback}
              </div>
            )}

            {!searchQuery.trim() && state.recentSearches.length > 0 && (
              <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800/80">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                  Recent Searches
                </p>
                <div className="flex flex-wrap gap-2">
                  {state.recentSearches.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => setSearchQuery(term)}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
              {searchResults.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    No medicines matched "{searchQuery}"
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchOpen(false);
                      onNavigate('medicine_form');
                    }}
                    className="mt-3 px-4 py-2 rounded-xl bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800"
                  >
                    Add New Medicine
                  </button>
                </div>
              ) : (
                searchResults.map((med) => {
                  const sellable = getMedicineSellableStock(med);
                  const latestBatch = med.batches[0];
                  return (
                    <button
                      key={med.id}
                      type="button"
                      onClick={() => {
                        if (searchQuery.trim()) onAddRecentSearch(searchQuery.trim());
                        setSearchOpen(false);
                        onNavigate('medicine_detail', med.id);
                      }}
                      className="w-full px-4 py-3 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors text-left"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {med.name}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          {med.genericName} · {med.manufacturer} · {med.batches.length} batch(es)
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p
                          className={`font-mono-num text-sm font-semibold ${
                            sellable === 0
                              ? 'text-red-600 dark:text-red-400'
                              : sellable < med.minStockLevel
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {sellable} in stock
                        </p>
                        {latestBatch && (
                          <p className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
                            MRP {formatINR(latestBatch.mrp)}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Barcode Stock Lookup Modal */}
      {barcodeOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Barcode Stock Lookup"
        >
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                Barcode Stock Lookup
              </h2>
              <button
                type="button"
                onClick={() => setBarcodeOpen(false)}
                aria-label="Close barcode lookup"
                className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Scan a medicine strip barcode using a USB/Bluetooth scanner or enter the EAN-13 barcode / batch number below.
            </p>
            <div>
              <label htmlFor="barcode-lookup-input" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                Barcode or Batch Number
              </label>
              <input
                id="barcode-lookup-input"
                type="text"
                autoFocus
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder="e.g. 8906000410650 or DL2608A"
                className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono-num text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                Quick test barcodes from your shelf:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {state.medicines.slice(0, 4).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setBarcodeInput(m.barcode)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-mono-num text-slate-700 dark:text-slate-200"
                  >
                    {m.name.split(' ')[0]} · {m.barcode.slice(-6)}
                  </button>
                ))}
              </div>
            </div>

            {barcodeInput.trim() && (
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
                {barcodeMatch ? (
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-slate-900 dark:text-white">
                          {barcodeMatch.name}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {barcodeMatch.genericName} · {barcodeMatch.rackLocation || 'Main Shelf'}
                        </p>
                      </div>
                      <span className="font-mono-num text-sm font-bold text-emerald-700 dark:text-emerald-400">
                        {getMedicineSellableStock(barcodeMatch)} sellable
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setBarcodeOpen(false);
                        onNavigate('medicine_detail', barcodeMatch.id);
                      }}
                      className="w-full h-10 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors"
                    >
                      Open Medicine Details
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    No medicine found for "{barcodeInput}".
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* WhatsApp Share Modal (avoids window.open while supporting direct WhatsApp deep link + clipboard copy) */}
      {whatsappModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Share on WhatsApp"
        >
          <div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <Share2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <h2 className="font-display text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate">
                  {whatsappModal.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={onCloseWhatsapp}
                aria-label="Close WhatsApp share dialog"
                className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <pre className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-sans leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
              {whatsappModal.message}
            </pre>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Review the formatted summary above. Tap Open WhatsApp or Share Sheet to pick a recipient and send.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(whatsappModal.message);
                  setCopiedWhatsapp(true);
                  setTimeout(() => setCopiedWhatsapp(false), 2000);
                }}
                className="inline-flex flex-1 sm:flex-initial items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {copiedWhatsapp ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                <span>{copiedWhatsapp ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void shareGeneratedReport({
                    title: whatsappModal.title,
                    text: whatsappModal.message,
                  });
                }}
                className="inline-flex flex-1 sm:flex-initial items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/50 text-xs sm:text-sm font-medium text-teal-800 dark:text-teal-300 hover:bg-teal-100"
              >
                <Share2 className="w-4 h-4" />
                <span>Share Sheet</span>
              </button>
              <a
                href={buildWhatsAppUrl(whatsappModal.message, whatsappModal.phone)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
              >
                <Share2 className="w-4 h-4" />
                <span>Open WhatsApp</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 lg:bottom-6 right-4 lg:right-6 z-50 max-w-md flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border bg-white dark:bg-[#132024] border-slate-200 dark:border-slate-700"
        >
          <span
            className={`text-sm font-medium ${
              toast.type === 'error'
                ? 'text-red-700 dark:text-red-400'
                : toast.type === 'success'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-slate-800 dark:text-slate-100'
            }`}
          >
            {toast.message}
          </span>
          <button
            type="button"
            onClick={onDismissToast}
            aria-label="Dismiss notification"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function MobileTabButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center min-h-[48px] py-1 transition-colors ${
        active
          ? 'text-teal-700 dark:text-teal-400'
          : 'text-slate-500 dark:text-slate-400'
      }`}
    >
      <Icon className="w-5 h-5" />
      <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">{label}</span>
    </button>
  );
}

interface SpeechRecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
}
