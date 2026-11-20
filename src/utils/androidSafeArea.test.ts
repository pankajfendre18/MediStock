import test from 'node:test';
import assert from 'node:assert/strict';
import { computeWebViewSafeAreaFallback } from './androidSafeArea.ts';

test('applies portrait top & bottom fallback on Android 15 WebView when env inset is 0', () => {
  const insets = computeWebViewSafeAreaFallback({
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; I2401 Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.200 Mobile Safari/537.36',
    hasCapacitor: true,
    isStandalone: false,
    computedEnvTopPx: 0,
    computedEnvBottomPx: 0,
    viewportWidth: 412,
    viewportHeight: 915,
  });

  assert.equal(insets.top, 46);
  assert.equal(insets.bottom, 20);
  assert.equal(insets.left, 0);
  assert.equal(insets.right, 0);
});

test('applies landscape side cutout insets on Android WebView when rotated', () => {
  const insets = computeWebViewSafeAreaFallback({
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; I2401; wv) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
    hasCapacitor: true,
    isStandalone: false,
    computedEnvTopPx: 0,
    computedEnvBottomPx: 0,
    viewportWidth: 915,
    viewportHeight: 412,
  });

  assert.equal(insets.top, 24);
  assert.equal(insets.bottom, 16);
  assert.equal(insets.left, 36);
  assert.equal(insets.right, 36);
});

test('returns zero fallback when native MainActivity insets are active (no double padding)', () => {
  const insets = computeWebViewSafeAreaFallback({
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; I2401; wv) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36 MediStockNativeInsets/1',
    hasCapacitor: true,
    isStandalone: false,
    computedEnvTopPx: 0,
    computedEnvBottomPx: 0,
    viewportWidth: 412,
    viewportHeight: 915,
  });

  assert.deepEqual(insets, { top: 0, bottom: 0, left: 0, right: 0 });
});

test('returns zero fallback on standard Android Chrome browser and desktop browsers', () => {
  const chromeMobile = computeWebViewSafeAreaFallback({
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    hasCapacitor: false,
    isStandalone: false,
    computedEnvTopPx: 0,
    computedEnvBottomPx: 0,
    viewportWidth: 412,
    viewportHeight: 915,
  });

  const desktop = computeWebViewSafeAreaFallback({
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    hasCapacitor: false,
    isStandalone: false,
    computedEnvTopPx: 0,
    computedEnvBottomPx: 0,
    viewportWidth: 1440,
    viewportHeight: 900,
  });

  assert.deepEqual(chromeMobile, { top: 0, bottom: 0, left: 0, right: 0 });
  assert.deepEqual(desktop, { top: 0, bottom: 0, left: 0, right: 0 });
});

test('returns zero fallback when WebView already reports real non-zero env(safe-area-inset-top)', () => {
  const insets = computeWebViewSafeAreaFallback({
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; I2401; wv) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
    hasCapacitor: true,
    isStandalone: false,
    computedEnvTopPx: 44,
    computedEnvBottomPx: 24,
    viewportWidth: 412,
    viewportHeight: 915,
  });

  assert.deepEqual(insets, { top: 0, bottom: 0, left: 0, right: 0 });
});
