import React, { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  ScanLine,
  ShieldCheck,
  Store,
} from 'lucide-react';
import type { UserProfile, UserRole } from '../domain/types';

export function SplashScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="min-h-dvh pt-safe pb-safe pl-safe pr-safe flex flex-col items-center justify-center px-6 bg-gradient-to-br from-teal-900 via-teal-800 to-emerald-900 text-white">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-xl">
          <svg viewBox="0 0 24 24" className="w-11 h-11 text-white" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            <rect x="3" y="3" width="18" height="18" rx="4" strokeOpacity="0.45" />
          </svg>
        </div>
        <div className="space-y-2">
          <h1 className="font-display text-4xl font-extrabold tracking-tight">
            MediStock AI
          </h1>
          <p className="text-teal-100 text-base leading-relaxed">
            AI Distributor Bill Scanner & GST Pharmacy Inventory System for Indian Medical Stores
          </p>
        </div>
        <div className="pt-4 flex flex-col gap-3">
          <button
            type="button"
            onClick={onContinue}
            className="w-full h-12 rounded-xl bg-white text-teal-900 font-semibold text-sm hover:bg-teal-50 transition-colors inline-flex items-center justify-center gap-2"
          >
            <span>Continue to Pharmacy Workspace</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

const ONBOARDING_STEPS = [
  {
    icon: ScanLine,
    title: 'Scan Indian GST Distributor Bills in Seconds',
    description:
      'Capture single or multi-page wholesale purchase invoices with your camera. Gemini AI extracts every medicine, batch, HSN, free quantity, discount, GST, and expiry date automatically.',
    highlights: [
      'Automatic crop, contrast enhancement & multi-page support',
      'Human-in-the-loop verification screen flags uncertain fields',
      'Duplicate invoice guard via Distributor GSTIN + Invoice Number',
    ],
  },
  {
    icon: ShieldCheck,
    title: 'Zero-Risk Batch & Expiry Protection',
    description:
      'Track multiple batches of the same medicine independently. MediStock AI automatically segregates expired, 30-day, 60-day, and 90-day stock so expired strips are never sold.',
    highlights: [
      'Smart merge updates existing batch stock instead of duplicating',
      'Expired stock automatically excluded from sellable count',
      '1-tap Purchase Return notes for distributor expiry credit',
    ],
  },
  {
    icon: FileSpreadsheet,
    title: 'Smart Reorders, GST Reports & Offline Reliability',
    description:
      'Generate instant low-stock reorder lists, GSTR-2B reconciliation summaries, distributor comparisons, and WhatsApp order messages — even when shop internet drops.',
    highlights: [
      'Offline-first storage with automatic cloud sync',
      'Owner & Staff Pharmacist role-based access control',
      'Export Excel (CSV) & printable PDF reports in one click',
    ],
  },
];

export function OnboardingScreen({
  onFinish,
  onSkip,
}: {
  onFinish: () => void;
  onSkip: () => void;
}) {
  const [step, setStep] = useState(0);
  const current = ONBOARDING_STEPS[step];
  const Icon = current.icon;

  return (
    <div className="min-h-dvh pt-safe pb-safe pl-safe pr-safe flex items-center justify-center px-4 py-10 bg-slate-50 dark:bg-[#0B1214]">
      <div className="w-full max-w-xl bg-white dark:bg-[#111B1E] border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-10 shadow-sm space-y-8">
        <div className="flex items-center justify-between">
          <span className="font-display font-bold text-teal-700 dark:text-teal-400 text-base">
            MediStock AI
          </span>
          <button
            type="button"
            onClick={onSkip}
            className="text-sm font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            Skip Tour
          </button>
        </div>

        <div className="space-y-5">
          <div className="w-14 h-14 rounded-2xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 flex items-center justify-center">
            <Icon className="w-7 h-7" />
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white leading-tight [text-wrap:balance]">
            {current.title}
          </h2>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed">
            {current.description}
          </p>
          <ul className="space-y-2.5 pt-2">
            {current.highlights.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700 dark:text-slate-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2" aria-label={`Step ${step + 1} of 3`}>
            {ONBOARDING_STEPS.map((_, idx) => (
              <button
                key={idx}
                type="button"
                aria-label={`Go to step ${idx + 1}`}
                onClick={() => setStep(idx)}
                className={`h-2 rounded-full transition-all ${
                  idx === step
                    ? 'w-8 bg-teal-700 dark:bg-teal-400'
                    : 'w-2 bg-slate-300 dark:bg-slate-700'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (step < ONBOARDING_STEPS.length - 1 ? setStep((s) => s + 1) : onFinish())}
              className="px-5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors"
            >
              <span>{step < ONBOARDING_STEPS.length - 1 ? 'Next' : 'Get Started'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AuthScreen({
  currentUser,
  onAuthenticated,
  onOpenOnboarding,
}: {
  currentUser: UserProfile;
  onAuthenticated: (profile: Partial<UserProfile>) => void;
  onOpenOnboarding: () => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState(currentUser.email);
  const [password, setPassword] = useState('••••••••••••');
  const [name, setName] = useState(currentUser.name);
  const [storeName, setStoreName] = useState(currentUser.storeName);
  const [gstin, setGstin] = useState(currentUser.storeGstin);
  const [dlNumber, setDlNumber] = useState(currentUser.drugLicenseNumber);
  const [role, setRole] = useState<UserRole>(currentUser.role);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid pharmacy email address.');
      return;
    }
    if (!password.trim() || password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (mode === 'register') {
      if (!name.trim() || !storeName.trim()) {
        setError('Pharmacist name and medical store name are required.');
        return;
      }
      onAuthenticated({
        name: name.trim(),
        email: email.trim(),
        storeName: storeName.trim(),
        storeGstin: gstin.trim().toUpperCase(),
        drugLicenseNumber: dlNumber.trim(),
        role,
      });
    } else {
      onAuthenticated({ email: email.trim(), role });
    }
  };

  return (
    <div className="min-h-dvh pt-safe pb-safe pl-safe pr-safe grid lg:grid-cols-2 bg-slate-50 dark:bg-[#0B1214]">
      {/* Left Brand Panel */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-teal-900 via-teal-800 to-emerald-900 text-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
            <Store className="w-5 h-5" />
          </div>
          <span className="font-display text-xl font-bold">MediStock AI</span>
        </div>

        <div className="space-y-5 max-w-md">
          <h2 className="font-display text-4xl font-bold leading-tight [text-wrap:balance]">
            Zero-effort distributor bill entry for Indian pharmacies.
          </h2>
          <p className="text-teal-100 text-base leading-relaxed">
            Scan printed wholesale GST invoices, verify batches & expiries in seconds, prevent duplicate entries, and keep your shelves stocked offline or online.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenOnboarding}
          className="self-start text-sm font-medium text-teal-100 hover:text-white underline underline-offset-4"
        >
          View 3-step feature tour
        </button>
      </div>

      {/* Right Auth Form */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md bg-white dark:bg-[#111B1E] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              {mode === 'login' ? 'Sign in to MediStock AI' : 'Register Your Medical Store'}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {mode === 'login'
                ? 'Access your pharmacy stock, GST invoices, and expiry alerts.'
                : 'Set up your Indian pharmacy profile with GSTIN & Drug License.'}
            </p>
          </div>

          {/* Mode Toggle */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                mode === 'login'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                mode === 'register'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Register Store
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs font-medium text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label htmlFor="auth-name" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Pharmacist / Owner Full Name
                  </label>
                  <input
                    id="auth-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div>
                  <label htmlFor="auth-store" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Pharmacy / Medical Store Name
                  </label>
                  <input
                    id="auth-store"
                    type="text"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="auth-gstin" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Store GSTIN
                    </label>
                    <input
                      id="auth-gstin"
                      type="text"
                      value={gstin}
                      onChange={(e) => setGstin(e.target.value)}
                      className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                  <div>
                    <label htmlFor="auth-dl" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Drug License No.
                    </label>
                    <input
                      id="auth-dl"
                      type="text"
                      value={dlNumber}
                      onChange={(e) => setDlNumber(e.target.value)}
                      className="w-full h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Email Address
              </label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                Access Role
              </span>
              <div className="grid grid-cols-2 gap-2">
                {(['owner', 'staff'] as UserRole[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    className={`h-10 rounded-xl border text-xs font-semibold transition-colors ${
                      role === r
                        ? 'border-teal-700 bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-200 dark:border-teal-500'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {r === 'owner' ? 'Pharmacy Owner' : 'Staff Pharmacist'}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="w-full h-11 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors"
            >
              {mode === 'login' ? 'Sign In to Store' : 'Create Pharmacy Account'}
            </button>
          </form>

          <div className="pt-2 text-center lg:hidden">
            <button
              type="button"
              onClick={onOpenOnboarding}
              className="text-xs font-medium text-teal-700 dark:text-teal-400 hover:underline"
            >
              View Feature Tour
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
