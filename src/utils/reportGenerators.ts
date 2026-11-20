import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  classifyBatchExpiry,
  formatINR,
  getMedicineNearestExpiry,
  getMedicineSellableStock,
  round2,
} from '../domain/pharmacyMath';
import type {
  Medicine,
  PharmacyState,
  PurchaseInvoice,
  UserProfile,
} from '../domain/types';

export type ExportReportType =
  | 'complete_inventory'
  | 'selected_medicines'
  | 'low_stock'
  | 'expired'
  | 'near_expiry'
  | 'expiry'
  | 'distributor_purchases'
  | 'purchase_history'
  | 'stock_valuation'
  | 'distributor_payments';

export interface ReportGenerationOptions {
  reportType: ExportReportType;
  selectedMedicineIds?: string[];
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;   // YYYY-MM-DD
  distributorId?: string;
}

export interface GeneratedReportResult {
  blob: Blob;
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  rowCount: number;
  title: string;
}

const INR_EXCEL_FORMAT = '"₹"#,##,##0.00';

/**
 * Formats YYYY-MM-DD or ISO timestamps to Indian DD-MM-YYYY format consistently.
 */
export function formatDateDDMMYYYY(input?: string | null): string {
  if (!input) return 'N/A';
  const trimmed = String(input).trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) {
    return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;
  }
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return trimmed;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export function formatDateTimeIndian(date: Date = new Date()): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
}

/**
 * Formats INR cleanly for built-in jsPDF Helvetica (which does not include the Unicode ₹ glyph).
 */
export function formatInrPdf(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const formatted = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
  return `Rs. ${formatted}`;
}

function inDateRange(isoDate: string | undefined, from?: string, to?: string): boolean {
  if (!isoDate) return true;
  const d = isoDate.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function getTargetMedicines(state: PharmacyState, options: ReportGenerationOptions): Medicine[] {
  if (options.reportType === 'selected_medicines' && options.selectedMedicineIds?.length) {
    const idSet = new Set(options.selectedMedicineIds);
    return state.medicines.filter((m) => idSet.has(m.id));
  }
  return state.medicines;
}

function getReportTitle(reportType: ExportReportType): string {
  switch (reportType) {
    case 'complete_inventory':
      return 'Complete Pharmacy Inventory Report';
    case 'selected_medicines':
      return 'Selected Medicines Stock Report';
    case 'low_stock':
      return 'Low Stock & Reorder Alert Report';
    case 'expired':
      return 'Expired Medicine Batches Report';
    case 'near_expiry':
      return 'Near-Expiry Medicines Report (Next 90 Days)';
    case 'expiry':
      return 'Expiry & Near-Expiry Surveillance Report';
    case 'distributor_purchases':
      return 'Distributor-Wise Purchase & Ledger Summary';
    case 'purchase_history':
      return 'GST Purchase Invoice History Report';
    case 'stock_valuation':
      return 'Inventory Stock Valuation Report';
    case 'distributor_payments':
      return 'Distributor Outstanding Payments Report';
  }
}

function sanitizeFileSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

interface FlatInventoryRow {
  medicineName: string;
  genericName: string;
  category: string;
  manufacturer: string;
  batchNumber: string;
  expiryDate: string;
  expiryRaw: string;
  qty: number;
  minLevel: number;
  purchasePrice: number;
  mrp: number;
  gstPercent: number;
  stockValue: number;
  mrpValue: number;
  distributor: string;
  status: 'EXPIRED' | 'EXPIRING SOON' | 'LOW STOCK' | 'OUT OF STOCK' | 'OK';
  daysRemaining: number;
}

function buildFlatInventoryRows(
  state: PharmacyState,
  options: ReportGenerationOptions,
  now: Date = new Date()
): FlatInventoryRow[] {
  const meds = getTargetMedicines(state, options);
  const rows: FlatInventoryRow[] = [];

  for (const med of meds) {
    const sellable = getMedicineSellableStock(med, now);
    if (med.batches.length === 0) {
      rows.push({
        medicineName: med.name,
        genericName: med.genericName || '-',
        category: med.category,
        manufacturer: med.manufacturer || med.brand || '-',
        batchNumber: 'NO BATCH',
        expiryDate: 'N/A',
        expiryRaw: '',
        qty: 0,
        minLevel: med.minStockLevel,
        purchasePrice: 0,
        mrp: 0,
        gstPercent: med.gstPercent,
        stockValue: 0,
        mrpValue: 0,
        distributor: '-',
        status: 'OUT OF STOCK',
        daysRemaining: 9999,
      });
      continue;
    }

    for (const batch of med.batches) {
      const exp = classifyBatchExpiry(batch.expiryDate, now);
      let status: FlatInventoryRow['status'] = 'OK';
      if (exp.bucket === 'expired') {
        status = 'EXPIRED';
      } else if (
        exp.bucket === 'expiring_30' ||
        exp.bucket === 'expiring_60' ||
        exp.bucket === 'expiring_90'
      ) {
        status = 'EXPIRING SOON';
      } else if (sellable === 0 || batch.availableStock === 0) {
        status = 'OUT OF STOCK';
      } else if (sellable < med.minStockLevel) {
        status = 'LOW STOCK';
      }

      if (options.reportType === 'expired' && exp.bucket !== 'expired') continue;
      if (
        options.reportType === 'near_expiry' &&
        exp.bucket !== 'expiring_30' &&
        exp.bucket !== 'expiring_60' &&
        exp.bucket !== 'expiring_90'
      ) {
        continue;
      }
      if (
        options.reportType === 'expiry' &&
        exp.bucket === 'safe'
      ) {
        continue;
      }
      if (options.reportType === 'low_stock' && sellable >= med.minStockLevel) {
        continue;
      }
      if (options.distributorId && batch.distributorId !== options.distributorId) {
        continue;
      }
      if (
        (options.dateFrom || options.dateTo) &&
        !inDateRange(batch.addedAt || med.updatedAt, options.dateFrom, options.dateTo)
      ) {
        // Only apply date range filter when user explicitly specified dates
        if (options.reportType === 'purchase_history' || options.reportType === 'distributor_purchases') {
          continue;
        }
      }

      rows.push({
        medicineName: med.name,
        genericName: med.genericName || '-',
        category: med.category,
        manufacturer: med.manufacturer || med.brand || '-',
        batchNumber: batch.batchNumber,
        expiryDate: formatDateDDMMYYYY(batch.expiryDate),
        expiryRaw: batch.expiryDate,
        qty: batch.availableStock,
        minLevel: med.minStockLevel,
        purchasePrice: round2(batch.purchasePrice),
        mrp: round2(batch.mrp),
        gstPercent: batch.gstPercent,
        stockValue: round2(batch.availableStock * batch.purchasePrice),
        mrpValue: round2(batch.availableStock * batch.mrp),
        distributor: batch.distributorName || '-',
        status,
        daysRemaining: exp.daysRemaining,
      });
    }
  }

  return rows;
}

/**
 * Generates a styled, production-grade Excel (.xlsx) workbook using ExcelJS.
 */
export async function generateExcelReport(
  state: PharmacyState,
  options: ReportGenerationOptions
): Promise<GeneratedReportResult> {
  const now = new Date();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MediStock AI';
  workbook.created = now;
  workbook.modified = now;

  const title = getReportTitle(options.reportType);
  const sheetName = title.replace(/[\\/?*[\]:]/g, '').slice(0, 31);
  const ws = workbook.addWorksheet(sheetName);

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  };

  interface ColumnDef {
    header: string;
    key: string;
    width: number;
    align?: 'left' | 'center' | 'right';
    isCurrency?: boolean;
    isInteger?: boolean;
    isPercent?: boolean;
    sum?: boolean;
  }

  let columns: ColumnDef[] = [];
  let dataRows: Array<Record<string, string | number>> = [];
  let rowStatuses: Array<FlatInventoryRow['status'] | 'OK'> = [];

  if (options.reportType === 'purchase_history') {
    columns = [
      { header: 'Invoice No.', key: 'invoiceNumber', width: 18, align: 'left' },
      { header: 'Invoice Date', key: 'invoiceDate', width: 14, align: 'center' },
      { header: 'Distributor', key: 'distributorName', width: 26, align: 'left' },
      { header: 'GSTIN', key: 'gstin', width: 19, align: 'center' },
      { header: 'Line Items', key: 'lineItems', width: 12, align: 'right', isInteger: true, sum: true },
      { header: 'Units Added', key: 'unitsAdded', width: 13, align: 'right', isInteger: true, sum: true },
      { header: 'Taxable (₹)', key: 'taxable', width: 16, align: 'right', isCurrency: true, sum: true },
      { header: 'CGST (₹)', key: 'cgst', width: 14, align: 'right', isCurrency: true, sum: true },
      { header: 'SGST (₹)', key: 'sgst', width: 14, align: 'right', isCurrency: true, sum: true },
      { header: 'Grand Total (₹)', key: 'grandTotal', width: 18, align: 'right', isCurrency: true, sum: true },
      { header: 'GST Status', key: 'gstStatus', width: 14, align: 'center' },
    ];

    const filteredInvoices = state.invoices.filter(
      (inv) =>
        inDateRange(inv.invoiceDate, options.dateFrom, options.dateTo) &&
        (!options.distributorId || inv.distributorId === options.distributorId)
    );

    dataRows = filteredInvoices.map((inv) => ({
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: formatDateDDMMYYYY(inv.invoiceDate),
      distributorName: inv.distributorName,
      gstin: inv.distributorGstin || '-',
      lineItems: inv.items.length,
      unitsAdded: inv.totalUnitsAdded,
      taxable: round2(inv.subtotalTaxable),
      cgst: round2(inv.cgstAmount),
      sgst: round2(inv.sgstAmount),
      grandTotal: round2(inv.grandTotal),
      gstStatus: inv.gstReconciled ? 'Reconciled' : 'Pending',
    }));
    rowStatuses = filteredInvoices.map((inv) => (inv.gstReconciled ? 'OK' : 'LOW STOCK'));
  } else if (
    options.reportType === 'distributor_purchases' ||
    options.reportType === 'distributor_payments'
  ) {
    columns = [
      { header: 'Distributor Name', key: 'name', width: 28, align: 'left' },
      { header: 'GSTIN', key: 'gstin', width: 19, align: 'center' },
      { header: 'Contact Phone', key: 'phone', width: 16, align: 'center' },
      { header: 'Invoices', key: 'invoiceCount', width: 11, align: 'right', isInteger: true, sum: true },
      { header: 'Units Supplied', key: 'units', width: 14, align: 'right', isInteger: true, sum: true },
      { header: 'Total Purchase (₹)', key: 'totalPurchase', width: 19, align: 'right', isCurrency: true, sum: true },
      { header: 'Total GST (₹)', key: 'totalGst', width: 16, align: 'right', isCurrency: true, sum: true },
      { header: 'Outstanding Due (₹)', key: 'outstanding', width: 20, align: 'right', isCurrency: true, sum: true },
    ];

    const filteredDistributors = state.distributors.filter(
      (d) => !options.distributorId || d.id === options.distributorId
    );

    dataRows = filteredDistributors.map((d) => {
      const distInvoices = state.invoices.filter(
        (inv) =>
          inv.distributorId === d.id &&
          inDateRange(inv.invoiceDate, options.dateFrom, options.dateTo)
      );
      return {
        name: d.name,
        gstin: d.gstin || '-',
        phone: d.contactNumber || '-',
        invoiceCount: distInvoices.length,
        units: distInvoices.reduce((s, inv) => s + inv.totalUnitsAdded, 0),
        totalPurchase: round2(distInvoices.reduce((s, inv) => s + inv.grandTotal, 0)),
        totalGst: round2(distInvoices.reduce((s, inv) => s + inv.totalGstAmount, 0)),
        outstanding: round2(d.outstandingPayment),
      };
    });
    rowStatuses = filteredDistributors.map((d) => (d.outstandingPayment > 0 ? 'LOW STOCK' : 'OK'));
  } else {
    columns = [
      { header: 'Medicine Name', key: 'medicineName', width: 28, align: 'left' },
      { header: 'Generic / Salt', key: 'genericName', width: 24, align: 'left' },
      { header: 'Category', key: 'category', width: 20, align: 'left' },
      { header: 'Batch No.', key: 'batchNumber', width: 15, align: 'center' },
      { header: 'Expiry Date', key: 'expiryDate', width: 14, align: 'center' },
      { header: 'Stock Qty', key: 'qty', width: 12, align: 'right', isInteger: true, sum: true },
      { header: 'Min Level', key: 'minLevel', width: 11, align: 'right', isInteger: true },
      { header: 'Purchase Rate (₹)', key: 'purchasePrice', width: 17, align: 'right', isCurrency: true },
      { header: 'MRP (₹)', key: 'mrp', width: 14, align: 'right', isCurrency: true },
      { header: 'GST %', key: 'gstPercent', width: 10, align: 'right', isPercent: true },
      { header: 'Cost Value (₹)', key: 'stockValue', width: 17, align: 'right', isCurrency: true, sum: true },
      { header: 'MRP Value (₹)', key: 'mrpValue', width: 17, align: 'right', isCurrency: true, sum: true },
      { header: 'Distributor', key: 'distributor', width: 22, align: 'left' },
      { header: 'Status', key: 'status', width: 15, align: 'center' },
    ];

    const flatRows = buildFlatInventoryRows(state, options, now);
    dataRows = flatRows.map((r) => ({
      medicineName: r.medicineName,
      genericName: r.genericName,
      category: r.category,
      batchNumber: r.batchNumber,
      expiryDate: r.expiryDate,
      qty: r.qty,
      minLevel: r.minLevel,
      purchasePrice: r.purchasePrice,
      mrp: r.mrp,
      gstPercent: r.gstPercent,
      stockValue: r.stockValue,
      mrpValue: r.mrpValue,
      distributor: r.distributor,
      status: r.status,
    }));
    rowStatuses = flatRows.map((r) => r.status);
  }

  const colCount = columns.length;
  const lastColLetter = ws.getColumn(colCount).letter;

  // Title banner rows
  ws.mergeCells(`A1:${lastColLetter}1`);
  const titleCell = ws.getCell('A1');
  titleCell.value = `${state.user.storeName} — ${title}`;
  titleCell.font = { name: 'Calibri', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 30;

  ws.mergeCells(`A2:${lastColLetter}2`);
  const subCell = ws.getCell('A2');
  const rangeLabel =
    options.dateFrom || options.dateTo
      ? ` | Date Filter: ${formatDateDDMMYYYY(options.dateFrom)} to ${formatDateDDMMYYYY(options.dateTo)}`
      : '';
  subCell.value = `GSTIN: ${state.user.storeGstin} | DL: ${state.user.drugLicenseNumber} | Generated: ${formatDateTimeIndian(now)}${rangeLabel}`;
  subCell.font = { name: 'Calibri', size: 10, color: { argb: 'FF334155' } };
  subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDFA' } };
  subCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;

  ws.addRow([]); // Spacer row 3
  ws.getRow(3).height = 8;

  // Header row (Row 4)
  const headerRowIdx = 4;
  const headerRow = ws.getRow(headerRowIdx);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF115E59' } };
    cell.alignment = {
      vertical: 'middle',
      horizontal: col.align || 'left',
      wrapText: true,
    };
    cell.border = thinBorder;
    ws.getColumn(i + 1).width = col.width;
  });
  headerRow.height = 26;

  // Data rows
  const firstDataRowIdx = headerRowIdx + 1;
  dataRows.forEach((rowObj, idx) => {
    const excelRow = ws.getRow(firstDataRowIdx + idx);
    const status = rowStatuses[idx] || 'OK';

    let rowBgArgb = idx % 2 === 1 ? 'FFF8FAFC' : 'FFFFFFFF';
    let textColorArgb = 'FF0F172A';
    if (status === 'EXPIRED') {
      rowBgArgb = 'FFFEE2E2';
      textColorArgb = 'FF991B1B';
    } else if (status === 'EXPIRING SOON') {
      rowBgArgb = 'FFFEF3C7';
      textColorArgb = 'FF92400E';
    } else if (status === 'LOW STOCK' || status === 'OUT OF STOCK') {
      rowBgArgb = 'FFFFEDD5';
      textColorArgb = 'FF9A3412';
    }

    columns.forEach((col, colIdx) => {
      const cell = excelRow.getCell(colIdx + 1);
      cell.value = rowObj[col.key] ?? '';
      cell.font = {
        name: 'Calibri',
        size: 10,
        bold: col.key === 'status' && status !== 'OK',
        color: { argb: textColorArgb },
      };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBgArgb } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: col.align || 'left',
        wrapText: true,
      };
      cell.border = thinBorder;

      if (col.isCurrency) {
        cell.numFmt = INR_EXCEL_FORMAT;
      } else if (col.isInteger) {
        cell.numFmt = '#,##0';
      } else if (col.isPercent) {
        cell.numFmt = '0"%"';
      }
    });
    excelRow.height = 22;
  });

  // Totals row with dynamic Excel SUM formulas
  const lastDataRowIdx = firstDataRowIdx + dataRows.length - 1;
  if (dataRows.length > 0) {
    const totalRowIdx = lastDataRowIdx + 1;
    const totalRow = ws.getRow(totalRowIdx);
    columns.forEach((col, colIdx) => {
      const cell = totalRow.getCell(colIdx + 1);
      const colLetter = ws.getColumn(colIdx + 1).letter;
      if (colIdx === 0) {
        cell.value = `TOTAL (${dataRows.length} rows)`;
      } else if (col.sum) {
        cell.value = { formula: `SUM(${colLetter}${firstDataRowIdx}:${colLetter}${lastDataRowIdx})` };
      } else {
        cell.value = '';
      }
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F172A' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFBF1' } };
      cell.alignment = { vertical: 'middle', horizontal: col.align || 'left' };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF0F766E' } },
        bottom: { style: 'double', color: { argb: 'FF0F766E' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
      if (col.isCurrency) cell.numFmt = INR_EXCEL_FORMAT;
      else if (col.isInteger) cell.numFmt = '#,##0';
    });
    totalRow.height = 25;
  }

  // Freeze header row & enable AutoFilter
  ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];
  ws.autoFilter = {
    from: { row: headerRowIdx, column: 1 },
    to: { row: Math.max(headerRowIdx, lastDataRowIdx), column: colCount },
  };

  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };

  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(buffer as ArrayBuffer);
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const blob = new Blob([bytes], { type: mimeType });
  const dateStamp = formatDateDDMMYYYY(now.toISOString());
  const filename = `medistock-${sanitizeFileSlug(options.reportType)}-${dateStamp}.xlsx`;

  return {
    blob,
    bytes,
    filename,
    mimeType,
    rowCount: dataRows.length,
    title,
  };
}

/**
 * Draws the branded MediStock AI header on a jsPDF document.
 */
function drawPdfHeader(
  doc: jsPDF,
  user: UserProfile,
  title: string,
  subtitle: string,
  generatedAt: string
): number {
  const pageWidth = doc.internal.pageSize.getWidth();

  // Top teal header bar
  doc.setFillColor(15, 118, 110);
  doc.rect(0, 0, pageWidth, 28, 'F');

  // Vector medical badge icon
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(12, 6, 15, 15, 3, 3, 'F');
  doc.setFillColor(15, 118, 110);
  doc.rect(18.2, 8.8, 2.6, 9.4, 'F');
  doc.rect(14.8, 12.2, 9.4, 2.6, 'F');

  // Pharmacy & App Title
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(user.storeName || 'MediStock AI Pharmacy', 31, 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(
    `GSTIN: ${user.storeGstin || '-'}  |  DL: ${user.drugLicenseNumber || '-'}  |  Ph: ${user.phone || '-'}`,
    31,
    19
  );
  doc.text(user.storeAddress || '', 31, 24);

  // Right-aligned brand stamp & timestamp
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('MediStock AI', pageWidth - 12, 12, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Generated: ${generatedAt}`, pageWidth - 12, 18, { align: 'right' });

  // Report title band
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.text(title, 12, 37);

  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(subtitle, 12, 42.5);

  return 47;
}

function addPdfFooters(doc: jsPDF, storeName: string): void {
  const totalPages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(12, pageHeight - 13, pageWidth - 12, pageHeight - 13);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `${storeName} · Powered by MediStock AI · Confidential Pharmacy Report`,
      12,
      pageHeight - 8
    );
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - 12, pageHeight - 8, { align: 'right' });
  }
}

/**
 * Generates a real multi-page A4 PDF report using jsPDF + jspdf-autotable.
 */
export function generatePdfReport(
  state: PharmacyState,
  options: ReportGenerationOptions
): GeneratedReportResult {
  const now = new Date();
  const generatedAt = formatDateTimeIndian(now);
  const title = getReportTitle(options.reportType);

  const useLandscape =
    options.reportType === 'complete_inventory' ||
    options.reportType === 'selected_medicines' ||
    options.reportType === 'stock_valuation' ||
    options.reportType === 'purchase_history';

  const doc = new jsPDF({
    orientation: useLandscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  let head: string[][] = [];
  let body: Array<Array<string | number>> = [];
  let foot: string[][] = [];
  let summaryText = '';

  if (options.reportType === 'purchase_history') {
    const filtered = state.invoices.filter(
      (inv) =>
        inDateRange(inv.invoiceDate, options.dateFrom, options.dateTo) &&
        (!options.distributorId || inv.distributorId === options.distributorId)
    );
    const totalTaxable = round2(filtered.reduce((s, i) => s + i.subtotalTaxable, 0));
    const totalGst = round2(filtered.reduce((s, i) => s + i.totalGstAmount, 0));
    const grandTotal = round2(filtered.reduce((s, i) => s + i.grandTotal, 0));
    const totalUnits = filtered.reduce((s, i) => s + i.totalUnitsAdded, 0);

    summaryText = `${filtered.length} GST Invoice(s) · ${totalUnits} Units Added · Total Purchase: ${formatInrPdf(grandTotal)} · Input GST: ${formatInrPdf(totalGst)}`;
    head = [[
      'Invoice No.',
      'Date',
      'Distributor',
      'GSTIN',
      'Items',
      'Units',
      'Taxable',
      'GST',
      'Grand Total',
      'Status',
    ]];
    body = filtered.map((inv) => [
      inv.invoiceNumber,
      formatDateDDMMYYYY(inv.invoiceDate),
      inv.distributorName,
      inv.distributorGstin || '-',
      inv.items.length,
      inv.totalUnitsAdded,
      formatInrPdf(inv.subtotalTaxable),
      formatInrPdf(inv.totalGstAmount),
      formatInrPdf(inv.grandTotal),
      inv.gstReconciled ? 'Reconciled' : 'Pending',
    ]);
    foot = [[
      `TOTAL (${filtered.length})`,
      '',
      '',
      '',
      '',
      String(totalUnits),
      formatInrPdf(totalTaxable),
      formatInrPdf(totalGst),
      formatInrPdf(grandTotal),
      '',
    ]];
  } else if (
    options.reportType === 'distributor_purchases' ||
    options.reportType === 'distributor_payments'
  ) {
    const dists = state.distributors.filter(
      (d) => !options.distributorId || d.id === options.distributorId
    );
    let totalPurchase = 0;
    let totalOutstanding = 0;
    let totalInvCount = 0;

    head = [['Distributor', 'GSTIN', 'Phone', 'Invoices', 'Purchase Value', 'Outstanding Due']];
    body = dists.map((d) => {
      const invs = state.invoices.filter(
        (inv) =>
          inv.distributorId === d.id &&
          inDateRange(inv.invoiceDate, options.dateFrom, options.dateTo)
      );
      const pSum = round2(invs.reduce((s, inv) => s + inv.grandTotal, 0));
      totalPurchase = round2(totalPurchase + pSum);
      totalOutstanding = round2(totalOutstanding + d.outstandingPayment);
      totalInvCount += invs.length;
      return [
        d.name,
        d.gstin || '-',
        d.contactNumber || '-',
        invs.length,
        formatInrPdf(pSum),
        formatInrPdf(d.outstandingPayment),
      ];
    });
    summaryText = `${dists.length} Distributor(s) · ${totalInvCount} Invoice(s) · Total Purchase: ${formatInrPdf(totalPurchase)} · Outstanding Due: ${formatInrPdf(totalOutstanding)}`;
    foot = [[
      `TOTAL (${dists.length})`,
      '',
      '',
      String(totalInvCount),
      formatInrPdf(totalPurchase),
      formatInrPdf(totalOutstanding),
    ]];
  } else {
    const rows = buildFlatInventoryRows(state, options, now);
    const totalQty = rows.reduce((s, r) => s + r.qty, 0);
    const totalCost = round2(rows.reduce((s, r) => s + r.stockValue, 0));
    const totalMrp = round2(rows.reduce((s, r) => s + r.mrpValue, 0));

    summaryText = `${rows.length} Batch Row(s) · Total Qty: ${totalQty} units · Cost Value: ${formatInrPdf(totalCost)} · MRP Value: ${formatInrPdf(totalMrp)}`;

    if (useLandscape) {
      head = [[
        'Medicine Name',
        'Category',
        'Batch',
        'Expiry',
        'Qty',
        'Pur. Rate',
        'MRP',
        'GST%',
        'Cost Value',
        'Distributor',
        'Status',
      ]];
      body = rows.map((r) => [
        `${r.medicineName}\n${r.genericName !== '-' ? r.genericName : ''}`.trim(),
        r.category,
        r.batchNumber,
        r.expiryDate,
        r.qty,
        formatInrPdf(r.purchasePrice),
        formatInrPdf(r.mrp),
        `${r.gstPercent}%`,
        formatInrPdf(r.stockValue),
        r.distributor,
        r.status,
      ]);
      foot = [[
        `TOTAL (${rows.length} rows)`,
        '',
        '',
        '',
        String(totalQty),
        '',
        '',
        '',
        formatInrPdf(totalCost),
        '',
        '',
      ]];
    } else {
      head = [[
        'Medicine & Generic',
        'Batch',
        'Expiry',
        'Qty / Min',
        'MRP',
        'Value',
        'Status',
      ]];
      body = rows.map((r) => [
        `${r.medicineName}\n${r.genericName !== '-' ? r.genericName : ''}`.trim(),
        r.batchNumber,
        r.expiryDate,
        `${r.qty} / ${r.minLevel}`,
        formatInrPdf(r.mrp),
        formatInrPdf(r.stockValue),
        r.status,
      ]);
      foot = [[
        `TOTAL (${rows.length})`,
        '',
        '',
        `${totalQty} units`,
        '',
        formatInrPdf(totalCost),
        '',
      ]];
    }
  }

  const startY = drawPdfHeader(doc, state.user, title, summaryText, generatedAt);

  autoTable(doc, {
    startY,
    head,
    body: body.length > 0 ? body : [['No matching records found for the selected filter criteria.']],
    foot: body.length > 0 ? foot : undefined,
    showHead: 'everyPage',
    showFoot: 'lastPage',
    margin: { left: 12, right: 12, bottom: 18 },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: useLandscape ? 8 : 8.5,
      cellPadding: 2.5,
      overflow: 'linebreak',
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [15, 118, 110],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'left',
    },
    footStyles: {
      fillColor: [204, 251, 241],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const val = String(data.cell.raw ?? '');
        if (val === 'EXPIRED') {
          data.cell.styles.fillColor = [254, 226, 226];
          data.cell.styles.textColor = [153, 27, 27];
          data.cell.styles.fontStyle = 'bold';
        } else if (val === 'EXPIRING SOON') {
          data.cell.styles.fillColor = [254, 243, 199];
          data.cell.styles.textColor = [146, 64, 14];
          data.cell.styles.fontStyle = 'bold';
        } else if (val === 'LOW STOCK' || val === 'OUT OF STOCK') {
          data.cell.styles.fillColor = [255, 237, 213];
          data.cell.styles.textColor = [154, 52, 18];
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });

  addPdfFooters(doc, state.user.storeName || 'MediStock AI');

  const arrayBuffer = doc.output('arraybuffer');
  const bytes = new Uint8Array(arrayBuffer);
  const mimeType = 'application/pdf';
  const blob = new Blob([bytes], { type: mimeType });
  const dateStamp = formatDateDDMMYYYY(now.toISOString());
  const filename = `medistock-${sanitizeFileSlug(options.reportType)}-${dateStamp}.pdf`;

  return {
    blob,
    bytes,
    filename,
    mimeType,
    rowCount: body.length,
    title,
  };
}

/**
 * Generates a dedicated GST Purchase Invoice PDF for a single distributor bill.
 */
export function generateInvoicePdf(
  state: PharmacyState,
  invoice: PurchaseInvoice
): GeneratedReportResult {
  const now = new Date();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const title = `GST Purchase Invoice: ${invoice.invoiceNumber}`;
  const subtitle = `Distributor: ${invoice.distributorName} (GSTIN: ${invoice.distributorGstin || 'N/A'}) · Invoice Date: ${formatDateDDMMYYYY(invoice.invoiceDate)} · Status: ${invoice.gstReconciled ? 'GST Reconciled' : 'Pending Reconciliation'}`;
  const startY = drawPdfHeader(doc, state.user, title, subtitle, formatDateTimeIndian(now));

  autoTable(doc, {
    startY,
    head: [['Medicine', 'Batch', 'Expiry', 'Qty (+Free)', 'Rate', 'MRP', 'GST%', 'Total']],
    body: invoice.items.map((item) => [
      `${item.medicineName}${item.hsnCode ? `\nHSN: ${item.hsnCode}` : ''}`,
      item.batchNumber,
      formatDateDDMMYYYY(item.expiryDate),
      item.freeQuantity > 0 ? `${item.quantity} (+${item.freeQuantity})` : String(item.quantity),
      formatInrPdf(item.purchaseRate),
      formatInrPdf(item.mrp),
      `${item.gstPercent}%`,
      formatInrPdf(item.totalAmount),
    ]),
    foot: [
      ['Subtotal Taxable', '', '', '', '', '', '', formatInrPdf(invoice.subtotalTaxable)],
      ['CGST + SGST Total', '', '', '', '', '', '', formatInrPdf(invoice.totalGstAmount)],
      ['GRAND TOTAL', '', '', `${invoice.totalUnitsAdded} units`, '', '', '', formatInrPdf(invoice.grandTotal)],
    ],
    showHead: 'everyPage',
    margin: { left: 12, right: 12, bottom: 18 },
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 2.5,
      overflow: 'linebreak',
      textColor: [15, 23, 42],
    },
    headStyles: {
      fillColor: [15, 118, 110],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    footStyles: {
      fillColor: [240, 253, 250],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
  });

  addPdfFooters(doc, state.user.storeName || 'MediStock AI');

  const bytes = new Uint8Array(doc.output('arraybuffer'));
  const mimeType = 'application/pdf';
  const blob = new Blob([bytes], { type: mimeType });
  const filename = `invoice-${sanitizeFileSlug(invoice.invoiceNumber)}.pdf`;

  return {
    blob,
    bytes,
    filename,
    mimeType,
    rowCount: invoice.items.length,
    title,
  };
}

/**
 * Formats a clean, concise WhatsApp message for a single medicine card.
 */
export function buildMedicineWhatsAppMessage(med: Medicine, user: UserProfile): string {
  const now = new Date();
  const sellable = getMedicineSellableStock(med, now);
  const nearest = getMedicineNearestExpiry(med, now).batch?.expiryDate;
  const lines = [
    `💊 *${med.name}*`,
    `_${user.storeName} · ${formatDateDDMMYYYY(now.toISOString())}_`,
    `Generic: ${med.genericName || 'N/A'}`,
    `Manufacturer: ${med.manufacturer || med.brand || 'N/A'}`,
    `Sellable Stock: *${sellable} units* (Min: ${med.minStockLevel})`,
    `GST: ${med.gstPercent}% | HSN: ${med.hsnCode || 'N/A'}`,
    nearest ? `Nearest Expiry: ${formatDateDDMMYYYY(nearest)}` : '',
    '',
    `*Active Batches (${med.batches.length}):*`,
    ...med.batches.slice(0, 8).map((b) => {
      const exp = classifyBatchExpiry(b.expiryDate, now);
      const tag = exp.bucket === 'expired' ? ' [EXPIRED]' : exp.bucket === 'expiring_30' ? ' [EXPIRING SOON]' : '';
      return `• Batch ${b.batchNumber} | Exp: ${formatDateDDMMYYYY(b.expiryDate)} | Qty: ${b.availableStock} | MRP: ${formatINR(b.mrp)}${tag}`;
    }),
  ].filter(Boolean);

  return lines.join('\n');
}

/**
 * Generates concise, well-formatted WhatsApp messages with ₹ currency and DD-MM-YYYY dates.
 */
export function buildWhatsAppReportMessage(
  state: PharmacyState,
  options: ReportGenerationOptions
): string {
  const now = new Date();
  const dateStr = formatDateDDMMYYYY(now.toISOString());
  const header = `🏥 *${state.user.storeName}*\n📅 Date: ${dateStr}`;

  if (options.reportType === 'low_stock') {
    const lowMeds = state.medicines
      .map((m) => ({
        med: m,
        sellable: getMedicineSellableStock(m, now),
      }))
      .filter((x) => x.sellable < x.med.minStockLevel);

    const lines = [
      header,
      `⚠️ *Low Stock & Reorder Alert (${lowMeds.length} items)*`,
      '',
      ...lowMeds.slice(0, 20).map(({ med, sellable }, i) => {
        const reorder = Math.max(med.minStockLevel * 2 - sellable, med.minStockLevel);
        return `${i + 1}. *${med.name}* — Stock: ${sellable} (Min: ${med.minStockLevel}) | Reorder: *${reorder} units*`;
      }),
      lowMeds.length > 20 ? `\n_+ ${lowMeds.length - 20} more items in full report._` : '',
      lowMeds.length === 0 ? '✅ All medicines are currently above minimum stock thresholds.' : '',
    ].filter(Boolean);
    return lines.join('\n');
  }

  if (
    options.reportType === 'expired' ||
    options.reportType === 'near_expiry' ||
    options.reportType === 'expiry'
  ) {
    const rows = buildFlatInventoryRows(state, options, now).filter((r) => r.qty > 0);
    const totalLoss = round2(rows.reduce((s, r) => s + r.stockValue, 0));
    const lines = [
      header,
      `⏳ *${getReportTitle(options.reportType)}*`,
      `Batches Flagged: *${rows.length}* | Cost Value: *${formatINR(totalLoss)}*`,
      '',
      ...rows.slice(0, 20).map((r, i) => {
        const icon = r.status === 'EXPIRED' ? '🔴' : '🟡';
        return `${icon} ${i + 1}. *${r.medicineName}* (Batch ${r.batchNumber}) — Exp: ${r.expiryDate} | Qty: ${r.qty} | Val: ${formatINR(r.stockValue)}`;
      }),
      rows.length > 20 ? `\n_+ ${rows.length - 20} more batches in full report._` : '',
      rows.length === 0 ? '✅ No expired or near-expiry batches found.' : '',
    ].filter(Boolean);
    return lines.join('\n');
  }

  if (options.reportType === 'purchase_history') {
    const invs = state.invoices.filter((inv) =>
      inDateRange(inv.invoiceDate, options.dateFrom, options.dateTo)
    );
    const total = round2(invs.reduce((s, i) => s + i.grandTotal, 0));
    const gst = round2(invs.reduce((s, i) => s + i.totalGstAmount, 0));
    const lines = [
      header,
      `🧾 *Purchase Invoice Summary (${invs.length} bills)*`,
      `Total Purchase: *${formatINR(total)}* | Input GST: *${formatINR(gst)}*`,
      '',
      ...invs.slice(0, 15).map(
        (inv, i) =>
          `${i + 1}. *${inv.invoiceNumber}* (${formatDateDDMMYYYY(inv.invoiceDate)}) — ${inv.distributorName} | *${formatINR(inv.grandTotal)}*`
      ),
      invs.length > 15 ? `\n_+ ${invs.length - 15} more invoices._` : '',
    ].filter(Boolean);
    return lines.join('\n');
  }

  if (
    options.reportType === 'distributor_payments' ||
    options.reportType === 'distributor_purchases'
  ) {
    const totalDue = round2(
      state.distributors.reduce((s, d) => s + d.outstandingPayment, 0)
    );
    const lines = [
      header,
      `💰 *Distributor Payment Summary*`,
      `Total Outstanding: *${formatINR(totalDue)}* across ${state.distributors.length} distributors`,
      '',
      ...state.distributors.slice(0, 20).map(
        (d, i) =>
          `${i + 1}. *${d.name}* — Due: *${formatINR(d.outstandingPayment)}*${d.contactNumber ? ` (${d.contactNumber})` : ''}`
      ),
    ];
    return lines.join('\n');
  }

  // Selected medicines or Complete Inventory / Stock Valuation
  const meds = getTargetMedicines(state, options);
  const totalCost = round2(
    meds.reduce(
      (sum, m) =>
        sum +
        m.batches.reduce(
          (bSum, b) =>
            classifyBatchExpiry(b.expiryDate, now).bucket === 'expired'
              ? bSum
              : bSum + b.availableStock * b.purchasePrice,
          0
        ),
      0
    )
  );
  const lines = [
    header,
    `📦 *${getReportTitle(options.reportType)}*`,
    `Medicines: *${meds.length}* | Sellable Stock Value: *${formatINR(totalCost)}*`,
    '',
    ...meds.slice(0, 20).map((m, i) => {
      const qty = getMedicineSellableStock(m, now);
      const topMrp = m.batches[0]?.mrp ?? 0;
      const exp = getMedicineNearestExpiry(m, now).batch?.expiryDate;
      return `${i + 1}. *${m.name}* — Qty: ${qty} | MRP: ${formatINR(topMrp)}${exp ? ` | Exp: ${formatDateDDMMYYYY(exp)}` : ''}`;
    }),
    meds.length > 20 ? `\n_+ ${meds.length - 20} more medicines in full Excel/PDF report._` : '',
  ].filter(Boolean);

  return lines.join('\n');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Attempts native Web Share API (Android Share Sheet / mobile browsers) with a generated file or text.
 * Returns whether the native share sheet was opened (never claims auto-delivery).
 */
export async function shareGeneratedReport(params: {
  blob?: Blob;
  filename?: string;
  mimeType?: string;
  title: string;
  text: string;
}): Promise<{ shared: boolean; reason?: string }> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return { shared: false, reason: 'Native share is not supported on this browser.' };
  }

  try {
    if (params.blob && params.filename) {
      const file = new File([params.blob], params.filename, {
        type: params.mimeType || params.blob.type || 'application/octet-stream',
      });
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: params.title,
          text: params.text,
          files: [file],
        });
        return { shared: true };
      }
    }

    await navigator.share({
      title: params.title,
      text: params.text,
    });
    return { shared: true };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { shared: false, reason: 'Share dismissed.' };
    }
    return { shared: false, reason: err instanceof Error ? err.message : 'Unable to share.' };
  }
}
