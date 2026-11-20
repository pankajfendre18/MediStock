export interface SafeAreaProbeInput {
  userAgent: string;
  hasCapacitor: boolean;
  isStandalone: boolean;
  computedEnvTopPx: number;
  computedEnvBottomPx: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Computes conservative CSS fallback safe-area insets ONLY when running inside
 * an Android WebView (e.g. an older Capacitor APK) or standalone Android PWA
 * where Android System WebView falsely reports env(safe-area-inset-top) === 0px
 * under Android 15/16 edge-to-edge enforcement.
 *
 * Returns all zeros when:
 * - Native MainActivity insets are active (UA contains MediStockNativeInsets),
 * - Running on desktop or standard mobile Chrome/Safari browser,
 * - Or the WebView already reports a non-zero env(safe-area-inset-top).
 */
export function computeWebViewSafeAreaFallback(
  input: SafeAreaProbeInput
): SafeAreaInsets {
  const ua = input.userAgent || '';

  // Native Android MainActivity already insets the WebView via WindowInsetsCompat.
  if (/MediStockNativeInsets/i.test(ua)) {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }

  const isAndroid = /Android/i.test(ua);
  if (!isAndroid) {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }

  const isAndroidWebView =
    input.hasCapacitor ||
    /;\s*wv\)/i.test(ua) ||
    /Version\/\d+\.\d+\s+Chrome\//i.test(ua);

  const needsFallback =
    (isAndroidWebView || input.isStandalone) && input.computedEnvTopPx <= 0;

  if (!needsFallback) {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }

  const isLandscape = input.viewportWidth > input.viewportHeight;
  if (isLandscape) {
    return {
      top: 24,
      bottom: input.computedEnvBottomPx <= 0 ? 16 : 0,
      left: 36,
      right: 36,
    };
  }

  // Portrait Android 15/16 phones (including iQOO 15 OriginOS Atomic Island / punch-hole)
  return {
    top: 46,
    bottom: input.computedEnvBottomPx <= 0 ? 20 : 0,
    left: 0,
    right: 0,
  };
}

function measureEnvInsetPx(side: 'top' | 'bottom'): number {
  if (typeof document === 'undefined' || !document.body) return 0;
  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  probe.style.paddingTop = `env(safe-area-inset-${side}, 0px)`;
  document.body.appendChild(probe);
  const value = parseFloat(window.getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return value;
}

export function applyAndroidSafeAreaInsets(): SafeAreaInsets {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }

  const win = window as unknown as {
    Capacitor?: unknown;
    navigator: Navigator;
  };

  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    false;

  const computedEnvTopPx = measureEnvInsetPx('top');
  const computedEnvBottomPx = measureEnvInsetPx('bottom');

  const insets = computeWebViewSafeAreaFallback({
    userAgent: navigator.userAgent || '',
    hasCapacitor: Boolean(win.Capacitor),
    isStandalone,
    computedEnvTopPx,
    computedEnvBottomPx,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  });

  const root = document.documentElement;
  root.style.setProperty('--android-safe-top-fallback', `${insets.top}px`);
  root.style.setProperty('--android-safe-bottom-fallback', `${insets.bottom}px`);
  root.style.setProperty('--android-safe-left-fallback', `${insets.left}px`);
  root.style.setProperty('--android-safe-right-fallback', `${insets.right}px`);

  return insets;
}

export function initAndroidSafeArea(): () => void {
  if (typeof window === 'undefined') return () => {};

  const run = () => {
    applyAndroidSafeAreaInsets();
  };

  if (document.body) {
    run();
  } else {
    window.addEventListener('DOMContentLoaded', run, { once: true });
  }

  window.addEventListener('resize', run, { passive: true });
  window.addEventListener('orientationchange', run, { passive: true });

  return () => {
    window.removeEventListener('resize', run);
    window.removeEventListener('orientationchange', run);
  };
}

export function syncAndroidSystemBarTheme(isDark: boolean): void {
  if (typeof window === 'undefined') return;
  const bridge = (
    window as unknown as {
      MediStockAndroid?: { setDarkMode?: (dark: boolean) => void };
    }
  ).MediStockAndroid;
  try {
    bridge?.setDarkMode?.(isDark);
  } catch {
    // Ignore when running outside native Android bridge
  }
}
