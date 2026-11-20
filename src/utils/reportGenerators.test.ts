import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createInitialSeedState } from '../data/seedData';
import {
  buildWhatsAppReportMessage,
  formatDateDDMMYYYY,
  formatInrPdf,
  generateExcelReport,
  generateInvoicePdf,
  generatePdfReport,
} from './reportGenerators';

test('formatDateDDMMYYYY converts ISO dates consistently', () => {
  assert.equal(formatDateDDMMYYYY('2026-11-19'), '19-11-2026');
  assert.equal(formatDateDDMMYYYY('2028-08-31T10:20:00Z'), '31-08-2028');
  assert.equal(formatDateDDMMYYYY(''), 'N/A');
});

test('formatInrPdf uses clean Indian number grouping without broken glyph', () => {
  assert.equal(formatInrPdf(124500.5), 'Rs. 1,24,500.50');
  assert.equal(formatInrPdf(0), 'Rs. 0.00');
});

test('generateExcelReport creates a valid .xlsx workbook with frozen header, autofilter, and SUM formulas', async () => {
  const state = createInitialSeedState();
  const result = await generateExcelReport(state, { reportType: 'complete_inventory' });

  assert.ok(result.filename.endsWith('.xlsx'));
  assert.ok(result.bytes.length > 1000, 'Excel buffer should be non-empty');
  assert.ok(result.rowCount > 0, 'Should export seed inventory rows');

  // Re-parse with ExcelJS to verify real XLSX integrity
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(result.bytes.buffer as ArrayBuffer);
  const ws = wb.worksheets[0];
  assert.ok(ws, 'Worksheet must exist');
  assert.equal(ws.views[0]?.state, 'frozen');
  assert.ok(ws.autoFilter, 'AutoFilter must be configured on header row');

  // Verify totals row uses a SUM formula
  const totalRowIdx = 4 + result.rowCount + 1;
  const qtyTotalCell = ws.getRow(totalRowIdx).getCell(6).value as { formula?: string };
  assert.ok(qtyTotalCell && typeof qtyTotalCell.formula === 'string' && qtyTotalCell.formula.startsWith('SUM('));
});

test('generateExcelReport supports selected medicines subset and distributor purchases', async () => {
  const state = createInitialSeedState();
  const firstId = state.medicines[0].id;
  const selectedRes = await generateExcelReport(state, {
    reportType: 'selected_medicines',
    selectedMedicineIds: [firstId],
  });
  assert.equal(selectedRes.rowCount, state.medicines[0].batches.length);

  const distRes = await generateExcelReport(state, {
    reportType: 'distributor_purchases',
  });
  assert.equal(distRes.rowCount, state.distributors.length);
});

test('generatePdfReport and generateInvoicePdf produce valid %PDF documents', () => {
  const state = createInitialSeedState();
  const pdf = generatePdfReport(state, { reportType: 'complete_inventory' });
  assert.ok(pdf.filename.endsWith('.pdf'));
  assert.ok(pdf.bytes.length > 1000);

  const headerStr = new TextDecoder('ascii').decode(pdf.bytes.slice(0, 5));
  assert.equal(headerStr, '%PDF-');

  const invPdf = generateInvoicePdf(state, state.invoices[0]);
  const invHeader = new TextDecoder('ascii').decode(invPdf.bytes.slice(0, 5));
  assert.equal(invHeader, '%PDF-');
  assert.ok(invPdf.filename.endsWith('.pdf'));
});

test('buildWhatsAppReportMessage includes ₹ symbol, DD-MM-YYYY date, and clean sections', () => {
  const state = createInitialSeedState();
  const lowMsg = buildWhatsAppReportMessage(state, { reportType: 'low_stock' });
  assert.ok(lowMsg.includes(state.user.storeName));
  assert.ok(/\d{2}-\d{2}-\d{4}/.test(lowMsg));

  const payMsg = buildWhatsAppReportMessage(state, { reportType: 'distributor_payments' });
  assert.ok(payMsg.includes('₹'));
  assert.ok(payMsg.includes('Distributor Payment Summary'));
});
