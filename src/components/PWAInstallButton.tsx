import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallButton({
  variant = 'sidebar',
}: {
  variant?: 'sidebar' | 'card';
}) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          variant === 'sidebar'
            ? 'w-full flex items-center justify-center gap-2 h-10 px-3.5 rounded-xl border border-teal-700/30 bg-teal-50/70 hover:bg-teal-100/80 dark:bg-teal-950/50 dark:border-teal-700/60 dark:hover:bg-teal-900/50 text-teal-800 dark:text-teal-200 text-xs font-semibold transition-colors whitespace-nowrap'
            : 'inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors whitespace-nowrap'
        }
      >
        {isInstallable ? <Download className="w-4 h-4 shrink-0" /> : <Smartphone className="w-4 h-4 shrink-0" />}
        <span>{isInstallable ? 'Install Android / Desktop App' : 'Install App on Phone'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Install MediStock AI on Phone"
        >
          <div className="w-full max-w-md bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                {isIOS ? 'Install on iPhone / iPad' : 'Install on Android Phone'}
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {isIOS ? (
              <ol className="text-sm text-slate-600 dark:text-slate-300 space-y-2 list-decimal list-inside">
                <li>Tap the <strong>Share</strong> icon in the Safari toolbar.</li>
                <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                <li>Tap <strong>Add</strong> to launch MediStock AI in full-screen standalone mode.</li>
              </ol>
            ) : (
              <ol className="text-sm text-slate-600 dark:text-slate-300 space-y-2 list-decimal list-inside">
                <li>Open MediStock AI&apos;s live URL in <strong>Google Chrome</strong> on Android.</li>
                <li>Tap the <strong>⋮ menu</strong> and select <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</li>
                <li>To package a signed <strong>.apk</strong> file for sideloading or Google Play, open <strong>Profile &amp; Settings → Android APK Export</strong>.</li>
              </ol>
            )}
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full h-10 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
}
