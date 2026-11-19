export type UserRole = 'owner' | 'staff';

export type ExpiryBucket =
  | 'expired'
  | 'expiring_30'
  | 'expiring_60'
  | 'expiring_90'
  | 'safe';

export type MedicineCategory =
  | 'Antibiotics'
  | 'Analgesics & Antipyretics'
  | 'Cardiac & BP'
  | 'Diabetes Care'
  | 'Gastro & Antacids'
  | 'Respiratory & Allergy'
  | 'Vitamins & Supplements'
  | 'Dermatology'
  | 'Pediatrics'
  | 'Other';

export interface MedicineBatch {
  id: string;
  batchNumber: string;
  expiryDate: string; // YYYY-MM-DD (last day of expiry month or exact date)
  mrp: number;
  purchasePrice: number;
  sellingPrice: number;
  availableStock: number;
  freeQuantityReceived: number;
  gstPercent: number;
  hsnCode: string;
  packSize: string;
  distributorId: string;
  distributorName: string;
  addedAt: string;
  lastInvoiceNumber?: string;
}

export interface PriceHistoryEntry {
  id: string;
  date: string;
  batchNumber: string;
  previousPurchasePrice: number;
  newPurchasePrice: number;
  previousMrp: number;
  newMrp: number;
  distributorName: string;
  invoiceNumber?: string;
}

export interface Medicine {
  id: string;
  name: string;
  genericName: string;
  brand: string;
  manufacturer: string;
  composition: string;
  category: MedicineCategory;
  minStockLevel: number;
  gstPercent: number;
  hsnCode: string;
  barcode: string;
  rackLocation?: string;
  batches: MedicineBatch[];
  priceHistory: PriceHistoryEntry[];
  updatedAt: string;
}

export interface Distributor {
  id: string;
  name: string;
  gstin: string;
  contactNumber: string;
  email: string;
  address: string;
  outstandingPayment: number;
  createdAt: string;
}

export interface InvoiceLineItem {
  id: string;
  medicineName: string;
  brandName: string;
  manufacturer: string;
  genericName?: string;
  composition?: string;
  category?: MedicineCategory;
  batchNumber: string;
  hsnCode: string;
  packSize: string;
  quantity: number;
  freeQuantity: number;
  purchaseRate: number;
  mrp: number;
  discountPercent: number;
  gstPercent: number;
  gstAmount: number;
  taxableAmount: number;
  totalAmount: number;
  expiryDate: string; // YYYY-MM-DD
  uncertainFields: string[];
  verified: boolean;
  confidence?: number;
}

export interface PurchaseInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  distributorId: string;
  distributorName: string;
  distributorGstin: string;
  items: InvoiceLineItem[];
  subtotalTaxable: number;
  totalDiscount: number;
  cgstAmount: number;
  sgstAmount: number;
  totalGstAmount: number;
  grandTotal: number;
  totalUnitsAdded: number;
  imageUrls: string[];
  gstReconciled: boolean;
  importedBy: string;
  createdAt: string;
  notes?: string;
}

export interface StockHistoryEvent {
  id: string;
  timestamp: string;
  medicineId: string;
  medicineName: string;
  batchNumber: string;
  type: 'purchase' | 'adjustment' | 'dispense' | 'return' | 'manual_add' | 'expired_writeoff';
  quantityDelta: number;
  resultingStock: number;
  reason: string;
  actorName: string;
  referenceId?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  entityType: 'medicine' | 'invoice' | 'distributor' | 'return' | 'settings' | 'auth';
  entityName: string;
  details: string;
}

export interface PurchaseReturn {
  id: string;
  returnNumber: string;
  date: string;
  distributorId: string;
  distributorName: string;
  invoiceNumber?: string;
  medicineId: string;
  medicineName: string;
  batchNumber: string;
  quantity: number;
  creditAmount: number;
  reason: 'expired' | 'near_expiry' | 'damaged' | 'excess_stock' | 'rate_mismatch';
  status: 'pending' | 'credited';
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  storeName: string;
  storeGstin: string;
  drugLicenseNumber: string;
  storeAddress: string;
  avatarUrl?: string;
}

export interface InvoiceDraft {
  distributorName: string;
  distributorGstin: string;
  distributorPhone?: string;
  distributorAddress?: string;
  invoiceNumber: string;
  invoiceDate: string;
  items: InvoiceLineItem[];
  imageUrls: string[];
  notes?: string;
}

export interface NotificationItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  timestamp: string;
  targetScreen: AppScreen;
  targetId?: string;
  read: boolean;
}

export type AppScreen =
  | 'splash'
  | 'onboarding'
  | 'auth'
  | 'home'
  | 'inventory'
  | 'medicine_detail'
  | 'medicine_form'
  | 'scanner'
  | 'preview_crop'
  | 'ai_processing'
  | 'invoice_verify'
  | 'expiry'
  | 'low_stock'
  | 'distributors'
  | 'distributor_detail'
  | 'invoices'
  | 'invoice_detail'
  | 'reports'
  | 'notifications'
  | 'profile';

export interface PharmacyState {
  medicines: Medicine[];
  distributors: Distributor[];
  invoices: PurchaseInvoice[];
  stockHistory: StockHistoryEvent[];
  auditLogs: AuditLogEntry[];
  purchaseReturns: PurchaseReturn[];
  readNotificationIds: string[];
  recentSearches: string[];
  user: UserProfile;
  lastSyncedAt: string;
}
