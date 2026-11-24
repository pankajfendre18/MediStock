import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  Crop,
  FileImage,
  Loader2,
  Plus,
  RefreshCw,
  RotateCw,
  ScanLine,
  Sliders,
  Trash2,
  Upload,
} from 'lucide-react';
import { SAMPLE_INVOICE_PRESETS } from '../data/seedData';
import {
  calculateInvoiceTotals,
  findExistingBatchMatch,
  findMatchingDistributor,
  formatINR,
  normalizeExpiryToIso,
  recalculateLineItem,
  validateInvoiceDraft,
} from '../domain/pharmacyMath';
import type {
  AppScreen,
  InvoiceDraft,
  InvoiceLineItem,
  MedicineCategory,
  PharmacyState,
} from '../domain/types';

export interface CapturedPage {
  id: string;
  originalUrl: string;
  processedDataUrl: string;
  rotation: 0 | 90 | 180 | 270;
  filter: 'original' | 'enhanced' | 'bw';
  cropPreset: 'full' | 'auto_document' | 'table_focus';
  label: string;
}

interface BillScannerFlowProps {
  screen: 'scanner' | 'preview_crop' | 'ai_processing' | 'invoice_verify';
  state: PharmacyState;
  pages: CapturedPage[];
  setPages: React.Dispatch<React.SetStateAction<CapturedPage[]>>;
  draft: InvoiceDraft | null;
  setDraft: React.Dispatch<React.SetStateAction<InvoiceDraft | null>>;
  onNavigate: (screen: AppScreen, entityId?: string) => void;
  onCommitInvoice: (draft: InvoiceDraft) => {
    invoiceNumber: string;
    mergedBatchCount: number;
    newBatchCount: number;
    invoiceId: string;
  };
  onShowToast: (type: 'success' | 'error' | 'info', message: string) => void;
}

const CATEGORIES: MedicineCategory[] = [
  'Antibiotics',
  'Analgesics & Antipyretics',
  'Cardiac & BP',
  'Diabetes Care',
  'Gastro & Antacids',
  'Respiratory & Allergy',
  'Vitamins & Supplements',
  'Dermatology',
  'Pediatrics',
  'Other',
];

async function imageUrlToDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load invoice image asset.');
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read image data.'));
    reader.readAsDataURL(blob);
  });
}

async function renderProcessedPage(
  sourceUrl: string,
  rotation: 0 | 90 | 180 | 270,
  filter: 'original' | 'enhanced' | 'bw',
  cropPreset: 'full' | 'auto_document' | 'table_focus'
): Promise<string> {
  const dataUrl = await imageUrlToDataUrl(sourceUrl);
  return await new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const crop =
        cropPreset === 'auto_document'
          ? { sx: img.width * 0.06, sy: img.height * 0.05, sw: img.width * 0.88, sh: img.height * 0.9 }
          : cropPreset === 'table_focus'
            ? { sx: img.width * 0.05, sy: img.height * 0.12, sw: img.width * 0.9, sh: img.height * 0.65 }
            : { sx: 0, sy: 0, sw: img.width, sh: img.height };

      const swap = rotation === 90 || rotation === 270;
      const maxDim = 1600;
      const scale = Math.min(1, maxDim / Math.max(crop.sw, crop.sh));
      const outW = Math.round((swap ? crop.sh : crop.sw) * scale);
      const outH = Math.round((swap ? crop.sw : crop.sh) * scale);

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      if (filter === 'enhanced') {
        ctx.filter = 'contrast(1.22) brightness(1.06) saturate(0.9)';
      } else if (filter === 'bw') {
        ctx.filter = 'grayscale(1) contrast(1.48) brightness(1.1)';
      } else {
        ctx.filter = 'none';
      }

      ctx.translate(outW / 2, outH / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      const drawW = Math.round(crop.sw * scale);
      const drawH = Math.round(crop.sh * scale);
      ctx.drawImage(
        img,
        crop.sx,
        crop.sy,
        crop.sw,
        crop.sh,
        -drawW / 2,
        -drawH / 2,
        drawW,
        drawH
      );

      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => reject(new Error('Failed to decode invoice image for enhancement.'));
    img.src = dataUrl;
  });
}

export function BillScannerFlow({
  screen,
  state,
  pages,
  setPages,
  draft,
  setDraft,
  onNavigate,
  onCommitInvoice,
  onShowToast,
}: BillScannerFlowProps) {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [processingStage, setProcessingStage] = useState(0);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [confirmedAccurate, setConfirmedAccurate] = useState(false);
  const [previewPhotoOpen, setPreviewPhotoOpen] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Clean up camera when leaving scanner screen
  useEffect(() => {
    if (screen !== 'scanner' && streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraActive(false);
    }
    return () => {
      if (streamRef.current && screen !== 'scanner') {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [screen]);

  const startCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Live camera access is unavailable in this browser. Upload invoice photos or test a sample GST bill below.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 60);
    } catch {
      setCameraError('Camera permission was denied or no camera was detected. Use Photo Upload or Sample Bills below.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const captureFromCamera = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const nextPage: CapturedPage = {
      id: `pg_${Date.now()}`,
      originalUrl: dataUrl,
      processedDataUrl: dataUrl,
      rotation: 0,
      filter: 'enhanced',
      cropPreset: 'full',
      label: `Camera Page ${pages.length + 1}`,
    };
    setPages((prev) => [...prev, nextPage]);
    onShowToast('info', `Captured Page ${pages.length + 1}. Capture more pages or proceed to Preview.`);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const added: CapturedPage[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Failed to read uploaded file.'));
        reader.readAsDataURL(file);
      });
      const enhanced = await renderProcessedPage(dataUrl, 0, 'enhanced', 'full');
      added.push({
        id: `pg_${Date.now()}_${i}`,
        originalUrl: dataUrl,
        processedDataUrl: enhanced,
        rotation: 0,
        filter: 'enhanced',
        cropPreset: 'full',
        label: file.name,
      });
    }

    if (added.length > 0) {
      setPages((prev) => [...prev, ...added]);
      setActivePageIndex(pages.length);
      stopCamera();
      onNavigate('preview_crop');
    }
    e.target.value = '';
  };

  const handleLoadSampleInvoice = async (preset: (typeof SAMPLE_INVOICE_PRESETS)[number]) => {
    try {
      const dataUrl = await imageUrlToDataUrl(preset.imageUrl);
      const nextPage: CapturedPage = {
        id: `pg_sample_${Date.now()}`,
        originalUrl: preset.imageUrl,
        processedDataUrl: dataUrl,
        rotation: 0,
        filter: 'original',
        cropPreset: 'full',
        label: preset.title,
      };
      setPages([nextPage]);
      setActivePageIndex(0);
      stopCamera();
      onNavigate('preview_crop');
    } catch {
      onShowToast('error', 'Failed to load sample invoice image.');
    }
  };

  const updateCurrentPageTransform = async (
    patch: Partial<Pick<CapturedPage, 'rotation' | 'filter' | 'cropPreset'>>
  ) => {
    const current = pages[activePageIndex];
    if (!current) return;
    setIsEnhancing(true);
    try {
      const nextRotation = patch.rotation ?? current.rotation;
      const nextFilter = patch.filter ?? current.filter;
      const nextCrop = patch.cropPreset ?? current.cropPreset;
      const processed = await renderProcessedPage(
        current.originalUrl,
        nextRotation,
        nextFilter,
        nextCrop
      );
      setPages((prev) =>
        prev.map((p, idx) =>
          idx === activePageIndex
            ? {
                ...p,
                rotation: nextRotation,
                filter: nextFilter,
                cropPreset: nextCrop,
                processedDataUrl: processed,
              }
            : p
        )
      );
    } catch {
      onShowToast('error', 'Image enhancement failed on this page.');
    } finally {
      setIsEnhancing(false);
    }
  };

  const runAiExtraction = async () => {
    if (pages.length === 0) {
      onShowToast('error', 'Capture or upload at least one invoice photo first.');
      return;
    }
    setExtractError(null);
    setProcessingStage(0);
    setConfirmedAccurate(false);
    onNavigate('ai_processing');

    const stageTimer1 = setTimeout(() => setProcessingStage(1), 600);
    const stageTimer2 = setTimeout(() => setProcessingStage(2), 1600);

    try {
      const encodedPages = await Promise.all(
        pages.map(async (p) => ({
          dataUrl: p.processedDataUrl.startsWith('data:')
            ? p.processedDataUrl
            : await imageUrlToDataUrl(p.processedDataUrl),
        }))
      );

      const response = await fetch('/api/invoices/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages: encodedPages }),
      });

      const payload = await response.json();
      clearTimeout(stageTimer1);
      clearTimeout(stageTimer2);

      if (!response.ok || !payload?.ok) {
        throw new Error(
          payload?.error || `Invoice extraction failed (HTTP ${response.status}).`
        );
      }

      setProcessingStage(3);
      const ext = payload.extracted;

      const items: InvoiceLineItem[] = (ext.items || []).map(
        (raw: Record<string, unknown>, idx: number) => {
          const uncertain = Array.isArray(raw.uncertainFields)
            ? (raw.uncertainFields as string[]).filter(Boolean)
            : [];
          const expiryNormalized = normalizeExpiryToIso(String(raw.expiryDate || ''));
          if (!expiryNormalized && !uncertain.includes('expiryDate')) {
            uncertain.push('expiryDate');
          }
          if (!String(raw.batchNumber || '').trim() && !uncertain.includes('batchNumber')) {
            uncertain.push('batchNumber');
          }

          const rawCat = String(raw.category || 'Other');
          const safeCat: MedicineCategory = CATEGORIES.includes(rawCat as MedicineCategory)
            ? (rawCat as MedicineCategory)
            : 'Other';

          return recalculateLineItem({
            id: `ext_${Date.now()}_${idx}`,
            medicineName: String(raw.medicineName || '').trim(),
            brandName: String(raw.brandName || raw.medicineName || '').trim(),
            manufacturer: String(raw.manufacturer || '').trim(),
            genericName: String(raw.genericName || '').trim(),
            composition: String(raw.composition || '').trim(),
            category: safeCat,
            batchNumber: String(raw.batchNumber || '').trim(),
            hsnCode: String(raw.hsnCode || '30049099').trim(),
            packSize: String(raw.packSize || '10T').trim(),
            quantity: Number(raw.quantity) || 0,
            freeQuantity: Number(raw.freeQuantity) || 0,
            purchaseRate: Number(raw.purchaseRate) || 0,
            mrp: Number(raw.mrp) || 0,
            discountPercent: Number(raw.discountPercent) || 0,
            gstPercent: Number(raw.gstPercent) || 12,
            gstAmount: Number(raw.gstAmount) || 0,
            taxableAmount: 0,
            totalAmount: Number(raw.totalAmount) || 0,
            expiryDate: expiryNormalized || String(raw.expiryDate || '').trim(),
            uncertainFields: uncertain,
            verified: uncertain.length === 0,
            confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
          });
        }
      );

      setDraft({
        distributorName: String(ext.distributorName || '').trim(),
        distributorGstin: String(ext.distributorGstin || '').trim().toUpperCase(),
        distributorPhone: String(ext.distributorPhone || '').trim(),
        distributorAddress: String(ext.distributorAddress || '').trim(),
        invoiceNumber: String(ext.invoiceNumber || '').trim(),
        invoiceDate: String(ext.invoiceDate || new Date().toISOString().slice(0, 10)).trim(),
        notes: String(ext.notes || '').trim(),
        imageUrls: pages.map((p) => p.originalUrl),
        items,
      });

      setTimeout(() => {
        onNavigate('invoice_verify');
      }, 350);
    } catch (err) {
      clearTimeout(stageTimer1);
      clearTimeout(stageTimer2);
      setExtractError(
        err instanceof Error ? err.message : 'Unable to process distributor invoice.'
      );
    }
  };

  const openBlankManualVerification = () => {
    setDraft({
      distributorName: '',
      distributorGstin: '',
      invoiceNumber: '',
      invoiceDate: new Date().toISOString().slice(0, 10),
      imageUrls: pages.map((p) => p.originalUrl),
      notes: 'Manual verification entry',
      items: [
        recalculateLineItem({
          id: `man_${Date.now()}`,
          medicineName: '',
          brandName: '',
          manufacturer: '',
          batchNumber: '',
          hsnCode: '30049099',
          packSize: '10T',
          quantity: 10,
          freeQuantity: 0,
          purchaseRate: 0,
          mrp: 0,
          discountPercent: 0,
          gstPercent: 12,
          gstAmount: 0,
          taxableAmount: 0,
          totalAmount: 0,
          expiryDate: '',
          uncertainFields: ['batchNumber', 'expiryDate'],
          verified: false,
        }),
      ],
    });
    setConfirmedAccurate(false);
    onNavigate('invoice_verify');
  };

  // =========================================================================
  // SCREEN 5: CAMERA BILL SCANNER
  // =========================================================================
  if (screen === 'scanner') {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
              AI Distributor Bill Scanner
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Capture single or multi-page Indian GST purchase bills via camera, upload photos, or test with sample distributor invoices.
            </p>
          </div>
          {pages.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('preview_crop')}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold whitespace-nowrap"
            >
              <span>Review {pages.length} Captured Page(s)</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
          {/* Camera & Upload Surface */}
          <div className="min-w-0 w-full lg:col-span-7 bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="relative aspect-[4/3] w-full bg-slate-950 flex items-center justify-center overflow-hidden">
              {cameraActive ? (
                <>
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  {/* Document Boundary Alignment Frame */}
                  <div className="pointer-events-none absolute inset-4 sm:inset-6 border-2 border-emerald-400/80 rounded-xl">
                    <span className="absolute top-2 left-3 text-xs font-medium text-emerald-200 bg-slate-950/60 px-2 py-0.5 rounded">
                      Align GST Invoice Corners
                    </span>
                  </div>
                </>
              ) : (
                <div className="p-5 sm:p-8 text-center space-y-3 sm:space-y-4 w-full max-w-md">
                  <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto rounded-2xl bg-teal-900/60 border border-teal-700/50 text-teal-300 flex items-center justify-center">
                    <ScanLine className="w-7 h-7 sm:w-8 sm:h-8" />
                  </div>
                  <div className="space-y-1.5">
                    <h3 className="font-display text-base sm:text-lg font-bold text-white">
                      Ready to scan purchase invoice
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                      Supports multi-page A4 & half-page distributor bills with printed HSN, Batch, Expiry, Free Qty, and CGST/SGST columns.
                    </p>
                  </div>
                  {cameraError && (
                    <p className="text-xs text-amber-300 bg-amber-950/60 border border-amber-700/50 rounded-xl p-3 break-words">
                      {cameraError}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 border-t border-slate-200 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2.5">
                {!cameraActive ? (
                  <button
                    type="button"
                    onClick={startCamera}
                    className="inline-flex flex-1 sm:flex-initial items-center justify-center gap-2 px-4 sm:px-5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors whitespace-nowrap"
                  >
                    <Camera className="w-4 h-4 shrink-0" />
                    <span>Open Camera</span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={captureFromCamera}
                      className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors whitespace-nowrap"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Capture Page {pages.length + 1}</span>
                    </button>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="h-11 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200"
                    >
                      Stop Camera
                    </button>
                  </>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  capture="environment"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex flex-1 sm:flex-initial items-center justify-center gap-2 px-4 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium text-slate-800 dark:text-slate-100 transition-colors whitespace-nowrap"
                >
                  <Upload className="w-4 h-4 shrink-0" />
                  <span>Upload Bill Photos</span>
                </button>
              </div>

              <button
                type="button"
                onClick={openBlankManualVerification}
                className="self-start sm:self-auto text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap px-1"
              >
                Enter Invoice Manually
              </button>
            </div>
          </div>

          {/* Sample Indian Distributor Invoices for Instant Testing */}
          <div className="min-w-0 w-full lg:col-span-5 space-y-4">
            <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-4 overflow-hidden">
              <div className="min-w-0">
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  Test with Real Sample Distributor Bills
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                  Select a realistic Indian pharmaceutical GST tax invoice to run live Gemini Vision OCR & verification end-to-end.
                </p>
              </div>

              <div className="space-y-3">
                {SAMPLE_INVOICE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleLoadSampleInvoice(preset)}
                    className="w-full min-w-0 max-w-full p-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-teal-600 dark:hover:border-teal-500 bg-slate-50/70 dark:bg-slate-900/50 flex items-center gap-3 text-left transition-colors overflow-hidden"
                  >
                    <img
                      src={preset.imageUrl}
                      alt={preset.title}
                      referrerPolicy="no-referrer"
                      className="w-12 h-16 sm:w-14 sm:h-18 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0 bg-white"
                    />
                    <div className="min-w-0 flex-1 overflow-hidden">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white line-clamp-2 break-words leading-snug">
                        {preset.title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 break-words">
                        {preset.subtitle}
                      </p>
                      <p className="text-xs font-semibold text-teal-700 dark:text-teal-400 mt-1.5 inline-flex items-center gap-1">
                        <span>Scan with Gemini AI</span>
                        <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {pages.length > 0 && (
              <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                    Captured Queue ({pages.length} page{pages.length > 1 ? 's' : ''})
                  </h4>
                  <button
                    type="button"
                    onClick={() => setPages([])}
                    className="text-xs text-red-600 dark:text-red-400 hover:underline"
                  >
                    Clear All
                  </button>
                </div>
                <div className="flex gap-2.5 overflow-x-auto pb-1">
                  {pages.map((p, idx) => (
                    <div key={p.id} className="relative shrink-0 w-20">
                      <img
                        src={p.processedDataUrl}
                        alt={p.label}
                        referrerPolicy="no-referrer"
                        className="w-20 h-24 object-cover rounded-lg border border-slate-200 dark:border-slate-700"
                      />
                      <span className="block text-[11px] text-center text-slate-500 mt-1">
                        Page {idx + 1}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('preview_crop')}
                  className="w-full h-11 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold"
                >
                  Continue to Preview & Enhance
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // SCREEN 6: IMAGE PREVIEW & CROP
  // =========================================================================
  if (screen === 'preview_crop') {
    const activePage = pages[activePageIndex] || pages[0];
    if (!activePage) {
      return (
        <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-10 text-center space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No invoice pages selected yet.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('scanner')}
            className="px-5 py-2.5 rounded-xl bg-teal-700 text-white text-sm font-semibold"
          >
            Go to Bill Scanner
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('scanner')}
              className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Scanner</span>
            </button>
            <div>
              <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
                Preview, Crop & Enhance Bill
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Page {activePageIndex + 1} of {pages.length} · Optimize document clarity before AI OCR extraction
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isEnhancing}
            onClick={runAiExtraction}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-semibold transition-colors whitespace-nowrap"
          >
            <ScanLine className="w-4 h-4" />
            <span>Extract with Gemini AI</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Document Preview Canvas */}
          <div className="min-w-0 w-full lg:col-span-8 bg-slate-900 rounded-2xl border border-slate-800 p-3 sm:p-4 flex items-center justify-center min-h-[300px] sm:min-h-[420px] max-h-[640px] overflow-hidden relative">
            <img
              src={activePage.processedDataUrl}
              alt={`Invoice preview page ${activePageIndex + 1}`}
              referrerPolicy="no-referrer"
              className="max-h-[580px] max-w-full w-auto object-contain rounded-lg shadow-lg"
            />
            {isEnhancing && (
              <div className="absolute inset-0 bg-slate-950/60 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
              </div>
            )}
          </div>

          {/* Controls Panel */}
          <div className="min-w-0 w-full lg:col-span-4 space-y-4">
            <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-5">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-2.5">
                  <Crop className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                  <span>Boundary Detection & Crop</span>
                </h3>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80">
                  {(
                    [
                      ['full', 'Full Frame'],
                      ['auto_document', 'Auto Trim'],
                      ['table_focus', 'Items Area'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => updateCurrentPageTransform({ cropPreset: key })}
                      className={`py-2 px-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                        activePage.cropPreset === key
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-2.5">
                  <Sliders className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                  <span>OCR Image Enhancement</span>
                </h3>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80">
                  {(
                    [
                      ['original', 'Original'],
                      ['enhanced', 'Crisp Scan'],
                      ['bw', 'B&W Doc'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => updateCurrentPageTransform({ filter: key })}
                      className={`py-2 px-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                        activePage.filter === key
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    updateCurrentPageTransform({
                      rotation: ((activePage.rotation + 90) % 360) as 0 | 90 | 180 | 270,
                    })
                  }
                  className="flex-1 h-10 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <RotateCw className="w-4 h-4" />
                  <span>Rotate 90°</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const remaining = pages.filter((_, idx) => idx !== activePageIndex);
                    setPages(remaining);
                    setActivePageIndex(Math.max(0, activePageIndex - 1));
                    if (remaining.length === 0) onNavigate('scanner');
                  }}
                  className="h-10 px-3.5 rounded-xl border border-red-200 dark:border-red-900 text-xs font-semibold text-red-700 dark:text-red-400 inline-flex items-center gap-1.5 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Remove</span>
                </button>
              </div>
            </div>

            {/* Multi-page Strip */}
            <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Invoice Pages ({pages.length})
                </h3>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs font-semibold text-teal-700 dark:text-teal-400 inline-flex items-center gap-1 hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Page</span>
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {pages.map((p, idx) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActivePageIndex(idx)}
                    className={`rounded-lg overflow-hidden border-2 transition-colors ${
                      idx === activePageIndex
                        ? 'border-teal-700 dark:border-teal-400'
                        : 'border-transparent'
                    }`}
                  >
                    <img
                      src={p.processedDataUrl}
                      alt={`Page ${idx + 1}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-16 object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // SCREEN 7: AI INVOICE PROCESSING
  // =========================================================================
  if (screen === 'ai_processing') {
    const stages = [
      'Enhancing invoice pages & detecting table layout',
      'Reading printed text, HSN codes, batch numbers & expiries via Gemini Vision',
      'Calculating GST (CGST/SGST), free scheme quantities & distributor match',
      'Preparing pharmacist verification sheet',
    ];

    return (
      <div className="max-w-xl mx-auto py-8">
        <div className="bg-white dark:bg-[#111B1E] rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 space-y-6">
          {extractError ? (
            <div className="space-y-5">
              <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-400 flex items-center justify-center">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                  AI Bill Extraction Failed
                </h2>
                <p className="text-sm text-red-700 dark:text-red-300 leading-relaxed">
                  {extractError}
                </p>
              </div>
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="button"
                  onClick={runAiExtraction}
                  className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Retry Extraction</span>
                </button>
                <button
                  type="button"
                  onClick={openBlankManualVerification}
                  className="h-11 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200"
                >
                  Enter Bill Manually
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('preview_crop')}
                  className="h-11 px-4 rounded-xl text-sm font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400"
                >
                  Back to Preview
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 flex items-center justify-center shrink-0">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
                <div>
                  <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                    Analyzing Distributor Invoice
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Processing {pages.length} page{pages.length > 1 ? 's' : ''} with strict batch & expiry safety checks
                  </p>
                </div>
              </div>

              <ol className="space-y-3">
                {stages.map((label, idx) => {
                  const done = processingStage > idx;
                  const active = processingStage === idx;
                  return (
                    <li key={label} className="flex items-center gap-3 text-sm">
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                          done
                            ? 'bg-emerald-600 text-white'
                            : active
                              ? 'bg-teal-700 text-white'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                        }`}
                      >
                        {done ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                      </span>
                      <span
                        className={
                          done || active
                            ? 'text-slate-900 dark:text-white font-medium'
                            : 'text-slate-400 dark:text-slate-500'
                        }
                      >
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // SCREEN 8: INVOICE VERIFICATION (MANDATORY HUMAN CONFIRMATION GATE)
  // =========================================================================
  if (!draft) {
    return (
      <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-10 text-center space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          No extracted invoice draft available to verify.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('scanner')}
          className="px-5 py-2.5 rounded-xl bg-teal-700 text-white text-sm font-semibold"
        >
          Scan Distributor Bill
        </button>
      </div>
    );
  }

  const validation = validateInvoiceDraft(draft, state.invoices);
  const totals = calculateInvoiceTotals(draft.items);
  const matchedDistributor = findMatchingDistributor(
    draft.distributorName,
    draft.distributorGstin,
    state.distributors
  );

  const updateItem = (itemId: string, patch: Partial<InvoiceLineItem>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((item) => {
          if (item.id !== itemId) return item;
          const updatedKeys = Object.keys(patch);
          const remainingUncertain = item.uncertainFields.filter(
            (f) => !updatedKeys.includes(f)
          );
          return recalculateLineItem({
            ...item,
            ...patch,
            uncertainFields: patch.uncertainFields ?? remainingUncertain,
            verified:
              patch.verified !== undefined
                ? patch.verified
                : remainingUncertain.length === 0
                  ? true
                  : item.verified,
          });
        }),
      };
    });
  };

  const addBlankRow = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: [
          ...prev.items,
          recalculateLineItem({
            id: `row_${Date.now()}`,
            medicineName: '',
            brandName: '',
            manufacturer: '',
            batchNumber: '',
            hsnCode: '30049099',
            packSize: '10T',
            quantity: 10,
            freeQuantity: 0,
            purchaseRate: 0,
            mrp: 0,
            discountPercent: 0,
            gstPercent: 12,
            gstAmount: 0,
            taxableAmount: 0,
            totalAmount: 0,
            expiryDate: '',
            uncertainFields: [],
            verified: true,
          }),
        ],
      };
    });
  };

  const removeRow = (itemId: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, items: prev.items.filter((i) => i.id !== itemId) };
    });
  };

  const handleConfirmSave = () => {
    if (!validation.isValid) {
      onShowToast('error', validation.blockingErrors[0]);
      return;
    }
    if (!confirmedAccurate) {
      onShowToast('error', 'Please tick the pharmacist verification checkbox before saving.');
      return;
    }
    try {
      const result = onCommitInvoice(draft);
      setPages([]);
      setDraft(null);
      onShowToast(
        'success',
        `Saved Bill ${result.invoiceNumber} (${result.mergedBatchCount} batch merged, ${result.newBatchCount} new batch added).`
      );
      onNavigate('invoice_detail', result.invoiceId);
    } catch (err) {
      onShowToast(
        'error',
        err instanceof Error ? err.message : 'Failed to commit verified invoice.'
      );
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            Verify Extracted Purchase Invoice
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Review every medicine, batch number, expiry date, and GST value. Nothing is saved until you confirm.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {draft.imageUrls.length > 0 && (
            <button
              type="button"
              onClick={() => setPreviewPhotoOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <FileImage className="w-4 h-4" />
              <span>{previewPhotoOpen ? 'Hide Bill Photo' : 'Show Bill Photo'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('scanner')}
            className="h-10 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300"
          >
            Rescan
          </button>
        </div>
      </div>

      {/* Duplicate Invoice or Validation Warnings */}
      {validation.isDuplicate && (
        <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-700 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="text-sm text-red-800 dark:text-red-200">
            <p className="font-bold">Duplicate Invoice Blocked</p>
            <p className="text-xs mt-0.5">
              Invoice <span className="font-mono-num font-semibold">{draft.invoiceNumber}</span> for GSTIN{' '}
              <span className="font-mono-num">{draft.distributorGstin}</span> already exists in your purchase history. Edit the invoice number if this is a distinct credit/supplementary bill.
            </p>
          </div>
        </div>
      )}

      {draft.notes && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/70 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-400" />
          <span>
            <strong>AI Reconciliation Note:</strong> {draft.notes}
          </span>
        </div>
      )}

      <div className={`grid gap-5 ${previewPhotoOpen && draft.imageUrls.length > 0 ? 'xl:grid-cols-12' : ''}`}>
        {/* Original Bill Photo Side Panel */}
        {previewPhotoOpen && draft.imageUrls.length > 0 && (
          <div className="xl:col-span-4 bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Original Scanned Bill ({draft.imageUrls.length} page{draft.imageUrls.length > 1 ? 's' : ''})
            </p>
            <div className="space-y-3 max-h-[680px] overflow-y-auto">
              {draft.imageUrls.map((url, idx) => (
                <img
                  key={idx}
                  src={url}
                  alt={`Scanned distributor invoice page ${idx + 1}`}
                  referrerPolicy="no-referrer"
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 object-contain bg-slate-50"
                />
              ))}
            </div>
          </div>
        )}

        {/* Editable Invoice Metadata & Line Items */}
        <div className={`${previewPhotoOpen && draft.imageUrls.length > 0 ? 'xl:col-span-8' : ''} space-y-5 min-w-0`}>
          {/* Invoice Header Card */}
          <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                Distributor & Tax Invoice Details
              </h3>
              <span
                className={`text-xs font-semibold ${
                  matchedDistributor
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-teal-700 dark:text-teal-400'
                }`}
              >
                {matchedDistributor
                  ? `Matched existing distributor: ${matchedDistributor.name}`
                  : 'New distributor will be created automatically'}
              </span>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div>
                <label htmlFor="ver-dist-name" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Distributor Name *
                </label>
                <input
                  id="ver-dist-name"
                  type="text"
                  value={draft.distributorName}
                  onChange={(e) => setDraft({ ...draft, distributorName: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label htmlFor="ver-dist-gstin" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Distributor GSTIN
                </label>
                <input
                  id="ver-dist-gstin"
                  type="text"
                  value={draft.distributorGstin}
                  onChange={(e) =>
                    setDraft({ ...draft, distributorGstin: e.target.value.toUpperCase() })
                  }
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label htmlFor="ver-inv-no" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Invoice Number *
                </label>
                <input
                  id="ver-inv-no"
                  type="text"
                  value={draft.invoiceNumber}
                  onChange={(e) => setDraft({ ...draft, invoiceNumber: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label htmlFor="ver-inv-date" className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Invoice Date *
                </label>
                <input
                  id="ver-inv-date"
                  type="date"
                  value={draft.invoiceDate}
                  onChange={(e) => setDraft({ ...draft, invoiceDate: e.target.value })}
                  className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Extracted Medicines Editable List */}
          <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">
                  Extracted Medicine Items ({draft.items.length})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Existing medicine + batch pairs automatically merge stock instead of duplicating
                </p>
              </div>
              <button
                type="button"
                onClick={addBlankRow}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Row</span>
              </button>
            </div>

            <div className="divide-y divide-slate-200/80 dark:divide-slate-800">
              {draft.items.map((item, idx) => {
                const errs = validation.itemErrors[item.id] || [];
                const batchMatch = findExistingBatchMatch(
                  item.medicineName,
                  item.batchNumber,
                  state.medicines
                );
                const needsConfirm = item.uncertainFields.length > 0 && !item.verified;

                return (
                  <div
                    key={item.id}
                    className={`p-4 sm:p-5 space-y-3.5 ${
                      errs.length > 0
                        ? 'bg-red-50/40 dark:bg-red-950/15'
                        : needsConfirm
                          ? 'bg-amber-50/40 dark:bg-amber-950/15'
                          : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono-num font-bold text-slate-500 dark:text-slate-400">
                          #{idx + 1}
                        </span>
                        {batchMatch?.batch ? (
                          <span className="font-semibold text-teal-700 dark:text-teal-400">
                            Will merge +{item.quantity + item.freeQuantity} into existing Batch {batchMatch.batch.batchNumber} (current {batchMatch.batch.availableStock})
                          </span>
                        ) : batchMatch?.medicine ? (
                          <span className="font-medium text-slate-600 dark:text-slate-300">
                            New batch under existing {batchMatch.medicine.name}
                          </span>
                        ) : (
                          <span className="font-medium text-emerald-700 dark:text-emerald-400">
                            New medicine record
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {needsConfirm && (
                          <button
                            type="button"
                            onClick={() => updateItem(item.id, { verified: true, uncertainFields: [] })}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Mark Verified</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeRow(item.id)}
                          aria-label={`Remove row ${idx + 1}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {errs.length > 0 && (
                      <p className="text-xs font-medium text-red-700 dark:text-red-400 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{errs.join(' · ')}</span>
                      </p>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
                      <div className="col-span-2">
                        <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                          Medicine Name *
                        </label>
                        <input
                          type="text"
                          value={item.medicineName}
                          onChange={(e) => updateItem(item.id, { medicineName: e.target.value })}
                          className="w-full h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                          Brand
                        </label>
                        <input
                          type="text"
                          value={item.brandName}
                          onChange={(e) => updateItem(item.id, { brandName: e.target.value })}
                          className="w-full h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                          Manufacturer
                        </label>
                        <input
                          type="text"
                          value={item.manufacturer}
                          onChange={(e) => updateItem(item.id, { manufacturer: e.target.value })}
                          className="w-full h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                          Batch No *
                        </label>
                        <input
                          type="text"
                          value={item.batchNumber}
                          onChange={(e) => updateItem(item.id, { batchNumber: e.target.value })}
                          className={`w-full h-9 px-2.5 rounded-lg border bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white ${
                            !item.batchNumber.trim() || item.uncertainFields.includes('batchNumber')
                              ? 'border-amber-500 ring-1 ring-amber-500/40'
                              : 'border-slate-300 dark:border-slate-700'
                          }`}
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                          Expiry (YYYY-MM-DD) *
                        </label>
                        <input
                          type="text"
                          placeholder="2028-08-31 or 08/2028"
                          value={item.expiryDate}
                          onChange={(e) => updateItem(item.id, { expiryDate: e.target.value })}
                          className={`w-full h-9 px-2.5 rounded-lg border bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white ${
                            !item.expiryDate.trim() || item.uncertainFields.includes('expiryDate')
                              ? 'border-amber-500 ring-1 ring-amber-500/40'
                              : 'border-slate-300 dark:border-slate-700'
                          }`}
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                          HSN Code
                        </label>
                        <input
                          type="text"
                          value={item.hsnCode}
                          onChange={(e) => updateItem(item.id, { hsnCode: e.target.value })}
                          className="w-full h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                          Pack Size
                        </label>
                        <input
                          type="text"
                          value={item.packSize}
                          onChange={(e) => updateItem(item.id, { packSize: e.target.value })}
                          className="w-full h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                          Qty *
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={item.quantity}
                          onChange={(e) =>
                            updateItem(item.id, { quantity: Number(e.target.value) || 0 })
                          }
                          className="w-full h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                          Free Qty
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={item.freeQuantity}
                          onChange={(e) =>
                            updateItem(item.id, { freeQuantity: Number(e.target.value) || 0 })
                          }
                          className="w-full h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                          Rate (₹)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          value={item.purchaseRate}
                          onChange={(e) =>
                            updateItem(item.id, { purchaseRate: Number(e.target.value) || 0 })
                          }
                          className="w-full h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                          MRP (₹) *
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          value={item.mrp}
                          onChange={(e) =>
                            updateItem(item.id, { mrp: Number(e.target.value) || 0 })
                          }
                          className="w-full h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                          Disc %
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          min={0}
                          max={100}
                          value={item.discountPercent}
                          onChange={(e) =>
                            updateItem(item.id, { discountPercent: Number(e.target.value) || 0 })
                          }
                          className="w-full h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                          GST %
                        </label>
                        <select
                          value={item.gstPercent}
                          onChange={(e) =>
                            updateItem(item.id, { gstPercent: Number(e.target.value) })
                          }
                          className="w-full h-9 px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono-num text-slate-900 dark:text-white"
                        >
                          {[0, 5, 12, 18, 28].map((g) => (
                            <option key={g} value={g}>
                              {g}%
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-2 sm:col-span-2 lg:col-span-4 flex items-end justify-end gap-4 pb-1 text-xs font-mono-num">
                        <span className="text-slate-500 dark:text-slate-400">
                          GST: {formatINR(item.gstAmount)}
                        </span>
                        <span className="font-bold text-slate-900 dark:text-white">
                          Line Total: {formatINR(item.totalAmount)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Totals & Confirmation Footer */}
          <div className="bg-white dark:bg-[#111B1E] rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Stock Added</p>
                <p className="font-mono-num font-bold text-slate-900 dark:text-white">
                  {totals.totalUnitsAdded} units
                </p>
                <p className="text-[11px] text-slate-500">
                  {totals.paidUnits} paid + {totals.freeUnits} free
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Taxable Value</p>
                <p className="font-mono-num font-bold text-slate-900 dark:text-white">
                  {formatINR(totals.subtotalTaxable)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">CGST + SGST</p>
                <p className="font-mono-num font-bold text-slate-900 dark:text-white">
                  {formatINR(totals.totalGstAmount)}
                </p>
                <p className="text-[11px] text-slate-500 font-mono-num">
                  {formatINR(totals.cgstAmount)} each
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Trade Discount</p>
                <p className="font-mono-num font-bold text-slate-900 dark:text-white">
                  {formatINR(totals.totalDiscount)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Grand Total</p>
                <p className="font-mono-num text-lg font-extrabold text-teal-700 dark:text-teal-400">
                  {formatINR(totals.grandTotal)}
                </p>
              </div>
            </div>

            {validation.warnings.length > 0 && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-200 space-y-1">
                {validation.warnings.map((w, i) => (
                  <p key={i}>• {w}</p>
                ))}
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <label className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmedAccurate}
                  onChange={(e) => setConfirmedAccurate(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-teal-700"
                />
                <span>
                  I have verified all batch numbers, expiry dates, quantities, and GST totals against the physical invoice.
                </span>
              </label>

              <button
                type="button"
                disabled={!validation.isValid || !confirmedAccurate}
                onClick={handleConfirmSave}
                className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:text-slate-500 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirm & Save to Inventory</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
