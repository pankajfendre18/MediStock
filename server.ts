import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { mergePharmacyStates } from './src/domain/syncMerge';
import type { PharmacyState } from './src/domain/types';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = path.resolve(__dirname, '.medistock-store.json');

const app = express();
app.use(express.json({ limit: '30mb' }));

// Allow Capacitor Android WebView & local web origins to sync cleanly with /api/*
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Active SSE real-time sync subscribers (Android + Website clients)
const sseClients = new Set<express.Response>();

function readStoredState(): PharmacyState | null {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as PharmacyState;
    if (parsed && Array.isArray(parsed.medicines) && Array.isArray(parsed.distributors)) {
      return parsed;
    }
    return null;
  } catch (err) {
    console.error('Error reading persisted state:', err);
    return null;
  }
}

function writeStoredStateAtomic(state: PharmacyState): void {
  const tmpFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(state), 'utf-8');
  fs.renameSync(tmpFile, DATA_FILE);
}

function broadcastStateEvent(
  eventName: 'state:init' | 'state:updated',
  payload: {
    state: PharmacyState;
    revision: number;
    updatedAt: string;
    updatedByClientId?: string;
  }
): void {
  const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(frame);
    } catch {
      sseClients.delete(client);
    }
  }
}

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Add your key in Settings > Secrets to enable AI bill extraction.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Health check
app.get('/api/health', (_req, res) => {
  const stored = readStoredState();
  res.json({
    ok: true,
    service: 'MediStock AI',
    revision: stored?.syncRevision ?? 0,
    liveClients: sseClients.size,
  });
});

// Persistent state load for offline-first sync (backward compatible)
app.get('/api/state', (_req, res) => {
  try {
    const stored = readStoredState();
    if (!stored) {
      res.json({ exists: false, data: null, revision: 0, updatedAt: null });
      return;
    }
    res.json({
      exists: true,
      data: stored,
      revision: stored.syncRevision ?? 1,
      updatedAt: stored.lastSyncedAt ?? new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error reading persisted state:', err);
    res.status(500).json({ error: 'Failed to read pharmacy state.' });
  }
});

// Real-time Server-Sent Events stream for instant Android <-> Website sync
app.get('/api/state/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  sseClients.add(res);

  const current = readStoredState();
  if (current) {
    const initPayload = {
      state: current,
      revision: current.syncRevision ?? 1,
      updatedAt: current.lastSyncedAt ?? new Date().toISOString(),
    };
    res.write(`event: state:init\ndata: ${JSON.stringify(initPayload)}\n\n`);
  } else {
    res.write(`event: state:empty\ndata: ${JSON.stringify({ revision: 0 })}\n\n`);
  }

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// Revision-aware state save with conflict merging & live broadcast
app.put('/api/state', (req, res) => {
  try {
    const body = req.body as
      | PharmacyState
      | { state?: PharmacyState; baseRevision?: number; clientId?: string; forceReplace?: boolean };

    const isEnvelope =
      body &&
      typeof body === 'object' &&
      'state' in body &&
      body.state &&
      typeof body.state === 'object';

    const incoming: PharmacyState | undefined = isEnvelope
      ? body.state
      : (body as PharmacyState);
    const baseRevision = isEnvelope && typeof body.baseRevision === 'number' ? body.baseRevision : undefined;
    const clientId = isEnvelope && typeof body.clientId === 'string' ? body.clientId : undefined;
    const forceReplace = isEnvelope && body.forceReplace === true;

    if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.medicines)) {
      res.status(400).json({ error: 'Invalid pharmacy state payload.' });
      return;
    }

    const existing = readStoredState();
    const existingRev = existing?.syncRevision ?? 0;
    const syncedAt = new Date().toISOString();

    let finalState: PharmacyState;
    let merged = false;

    if (
      existing &&
      !forceReplace &&
      baseRevision !== undefined &&
      existingRev > baseRevision
    ) {
      // Concurrent edit detected from another device (e.g. Android & Web offline/simultaneous)
      finalState = mergePharmacyStates(existing, {
        ...incoming,
        lastSyncedAt: syncedAt,
      });
      finalState.syncRevision = Math.max(existingRev, incoming.syncRevision ?? 0) + 1;
      finalState.lastSyncedAt = syncedAt;
      merged = true;
    } else {
      const nextRevision = Math.max(existingRev, incoming.syncRevision ?? 0) + 1;
      finalState = {
        ...incoming,
        syncRevision: nextRevision,
        lastSyncedAt: syncedAt,
        deletedMedicineIds: Array.from(
          new Set([
            ...(!forceReplace && existing?.deletedMedicineIds ? existing.deletedMedicineIds : []),
            ...(incoming.deletedMedicineIds || []),
          ])
        ).slice(-500),
      };
    }

    writeStoredStateAtomic(finalState);

    const revision = finalState.syncRevision ?? 1;
    broadcastStateEvent('state:updated', {
      state: finalState,
      revision,
      updatedAt: syncedAt,
      updatedByClientId: clientId,
    });

    res.json({
      ok: true,
      syncedAt,
      revision,
      merged,
      state: finalState,
    });
  } catch (err) {
    console.error('Error saving pharmacy state:', err);
    res.status(500).json({ error: 'Failed to save pharmacy state.' });
  }
});

// AI Distributor Invoice OCR & Structured Extraction using Gemini API
app.post('/api/invoices/extract', async (req, res) => {
  try {
    const { pages } = req.body as {
      pages?: Array<{ dataUrl?: string; mimeType?: string; base64?: string }>;
    };

    if (!Array.isArray(pages) || pages.length === 0) {
      res.status(400).json({ error: 'At least one invoice image page is required.' });
      return;
    }

    const imageParts = pages
      .map((p) => {
        if (p.base64 && p.mimeType) {
          return {
            inlineData: {
              mimeType: p.mimeType,
              data: p.base64,
            },
          };
        }
        if (p.dataUrl && p.dataUrl.startsWith('data:')) {
          const match = /^data:([^;]+);base64,(.+)$/.exec(p.dataUrl);
          if (match) {
            return {
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            };
          }
        }
        return null;
      })
      .filter((x): x is { inlineData: { mimeType: string; data: string } } => x !== null);

    if (imageParts.length === 0) {
      res.status(400).json({ error: 'Could not decode uploaded invoice image data.' });
      return;
    }

    const ai = createGeminiClient();

    const promptText = `You are a pharmaceutical invoice OCR & GST extraction specialist for Indian medical stores.
Analyze ALL provided invoice page image(s) carefully and extract structured Indian distributor GST tax invoice data.

STRICT ACCURACY & SAFETY RULES:
1. NEVER guess, invent, or hallucinate missing batch numbers, expiry dates, HSN codes, GSTINs, or quantities.
2. If any field is blurry, unreadable, ambiguous, or missing on the invoice, leave it as an empty string "" (or 0 for numbers) and add that exact field key (e.g. "batchNumber", "expiryDate", "purchaseRate", "mrp", "quantity", "gstPercent") into the item's "uncertainFields" array.
3. For expiryDate, normalize printed MM/YYYY or MM/YY into YYYY-MM-DD (using the last day of that month, e.g. 08/2028 -> 2028-08-31). If unreadable or missing, return "" and flag "expiryDate" in uncertainFields.
4. For invoiceDate, convert DD-MM-YYYY or DD/MM/YYYY into YYYY-MM-DD.
5. Extract every distinct medicine line row across all pages. If a medicine appears twice with different expiry dates or quantities, keep both rows and note the discrepancy in "notes" or "uncertainFields".
6. Extract Free Quantity (scheme/bonus units) separately from paid Quantity.
7. Infer standard Indian pharmaceutical genericName, manufacturer, and category ONLY when the printed brand name is well-known (e.g. Dolo 650 -> Paracetamol 650mg, Micro Labs, Analgesics & Antipyretics); otherwise leave genericName as the medicine name and category as "Other".
8. Check whether printed row totals or grand totals have arithmetic discrepancies; mention any reconciliation discrepancy in "notes".`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        distributorName: { type: Type.STRING, description: 'Wholesale distributor / stockist name' },
        distributorGstin: { type: Type.STRING, description: '15-character Indian GSTIN of distributor' },
        distributorPhone: { type: Type.STRING, description: 'Phone number if printed' },
        distributorAddress: { type: Type.STRING, description: 'Address if printed' },
        invoiceNumber: { type: Type.STRING, description: 'Distributor tax invoice number' },
        invoiceDate: { type: Type.STRING, description: 'Invoice date in YYYY-MM-DD format' },
        notes: { type: Type.STRING, description: 'Reconciliation observations or scan warnings' },
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              medicineName: { type: Type.STRING },
              brandName: { type: Type.STRING },
              manufacturer: { type: Type.STRING },
              genericName: { type: Type.STRING },
              composition: { type: Type.STRING },
              category: { type: Type.STRING },
              batchNumber: { type: Type.STRING },
              hsnCode: { type: Type.STRING },
              packSize: { type: Type.STRING },
              quantity: { type: Type.NUMBER },
              freeQuantity: { type: Type.NUMBER },
              purchaseRate: { type: Type.NUMBER },
              mrp: { type: Type.NUMBER },
              discountPercent: { type: Type.NUMBER },
              gstPercent: { type: Type.NUMBER },
              gstAmount: { type: Type.NUMBER },
              totalAmount: { type: Type.NUMBER },
              expiryDate: { type: Type.STRING, description: 'YYYY-MM-DD format or empty if missing' },
              confidence: { type: Type.NUMBER, description: '0 to 1 OCR confidence for this row' },
              uncertainFields: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Field names that need manual pharmacist review',
              },
            },
            required: [
              'medicineName',
              'batchNumber',
              'quantity',
              'freeQuantity',
              'purchaseRate',
              'mrp',
              'gstPercent',
              'expiryDate',
              'uncertainFields',
            ],
          },
        },
      },
      required: ['distributorName', 'distributorGstin', 'invoiceNumber', 'invoiceDate', 'items'],
    };

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [...imageParts, { text: promptText }],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const rawText = (response.text ?? '').trim();
    if (!rawText) {
      res.status(502).json({ error: 'Gemini returned an empty response for this invoice.' });
      return;
    }

    const parsed = JSON.parse(rawText);
    res.json({ ok: true, extracted: parsed });
  } catch (err: unknown) {
    console.error('Gemini invoice extraction error:', err);
    const message =
      err instanceof Error ? err.message : 'Failed to extract invoice data via Gemini API.';
    const status = message.includes('GEMINI_API_KEY') ? 503 : 500;
    res.status(status).json({ error: message });
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const httpServer = http.createServer(app);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.get('/manifest.webmanifest', (_req, res, next) => {
      const manifestPath = path.join(distDir, 'manifest.webmanifest');
      if (fs.existsSync(manifestPath)) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(manifestPath);
        return;
      }
      next();
    });
    app.get('/sw.js', (_req, res, next) => {
      const swPath = path.join(distDir, 'sw.js');
      if (fs.existsSync(swPath)) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Service-Worker-Allowed', '/');
        res.sendFile(swPath);
        return;
      }
      next();
    });
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`MediStock AI server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
