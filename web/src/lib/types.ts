export interface TenantSettings {
  profile: { tagline: string; logoUrl: string; primaryColor: string; gstin: string; registrationNo: string; website: string };
  locale: { currency: string; currencySymbol: string; timezone: string; dateFormat: string };
  numbering: { uhid: string; appointment: string; invoice: string; receipt: string; lab: string; admission: string; padding: number };
  appointments: { defaultSlotMinutes: number; bookingWindowDays: number; allowOnlineBooking: boolean; allowOverbooking: boolean; allowWalkIn: boolean };
  billing: { taxLabel: string; defaultTaxRate: number; registrationFee: number; autoInvoiceOnBooking: boolean; allowPartialPayment: boolean; invoiceFooter: string };
  clinical: { requireVitals: boolean; prescriptionHeader: string; prescriptionFooter: string };
  pharmacy: { nearExpiryDays: number };
  notifications: { smsEnabled: boolean; emailEnabled: boolean; whatsappEnabled: boolean; bookingConfirmation: boolean };
  patientFields: CustomField[];
}

export interface CustomField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  options?: string[];
  required: boolean;
}

export interface Session {
  user: {
    id: number;
    fullName: string;
    email: string;
    roleCode: string | null;
    roleName: string | null;
    isPlatformAdmin: boolean;
    patientId: number | null;
    doctorId: number | null;
  };
  tenant: {
    id: number;
    code: string;
    name: string;
    type: string;
    status: 'trial' | 'active' | 'suspended' | 'cancelled';
    trialEndsAt: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    planName: string;
    planCode: string;
  } | null;
  permissions: string[];
  modules: string[];
  settings: TenantSettings | null;
}

export interface Paged<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totals?: Record<string, number>;
}

export interface Doctor {
  id: number;
  name: string;
  departmentId: number | null;
  departmentName?: string | null;
  specialization: string | null;
  qualification: string | null;
  registrationNo: string | null;
  experienceYears: number;
  phone: string | null;
  email: string | null;
  bio: string | null;
  photoUrl: string | null;
  consultationFee: number;
  followUpFee: number;
  followUpDays: number;
  slotMinutes: number;
  maxPerSlot: number;
  telehealthEnabled: boolean;
  isActive: boolean;
  schedule?: { dayOfWeek: number; startTime: string; endTime: string }[];
}

export interface Slot {
  start: string;
  end: string;
  booked: number;
  capacity: number;
  available: number;
  past: boolean;
}
export interface SlotDay {
  date: string;
  onLeave: boolean;
  leaveReason?: string | null;
  slots: Slot[];
}

export interface PatientRow {
  id: number;
  uhid: string;
  name: string;
  firstName: string;
  lastName: string | null;
  gender: 'male' | 'female' | 'other';
  dob: string | null;
  phone: string;
  email: string | null;
  bloodGroup: string | null;
  city: string | null;
  allergies: string[];
  lastVisit?: string | null;
}

export interface Patient extends PatientRow {
  address: string | null;
  state: string | null;
  pincode: string | null;
  nationalId: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  conditions: string[];
  notes: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  portalAccount: { id: number; email: string; status: string } | null;
}

export interface AppointmentRow {
  id: number;
  appointmentNo: string;
  date: string;
  startTime: string;
  endTime: string;
  tokenNo: number;
  status: 'booked' | 'checked_in' | 'in_consultation' | 'completed' | 'cancelled' | 'no_show';
  visitType: 'new' | 'follow_up';
  mode: 'in_person' | 'video';
  source: string;
  fee: number;
  reason: string | null;
  patientId: number;
  patientName: string;
  uhid: string;
  patientPhone: string;
  gender: string;
  dob: string | null;
  doctorId: number;
  doctorName: string;
  departmentName: string | null;
  invoiceId: number | null;
  invoiceStatus: string | null;
  invoiceBalance: number | null;
}

export interface Vitals {
  bpSystolic?: number | null;
  bpDiastolic?: number | null;
  pulse?: number | null;
  temperature?: number | null;
  spo2?: number | null;
  respiratoryRate?: number | null;
  weight?: number | null;
  height?: number | null;
  bmi?: number | null;
}

export interface RxItem {
  id?: number;
  medicineId?: number | null;
  medicineName: string;
  dose?: string | null;
  frequency?: string | null;
  durationDays?: number | null;
  route?: string | null;
  instructions?: string | null;
  quantity: number;
  dispensedQty?: number;
}

export interface Diagnosis {
  code?: string;
  description: string;
  type?: 'provisional' | 'final';
}

export interface InvoiceItem {
  id: number;
  itemType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  amount: number;
  batchId: number | null;
}

export interface Payment {
  id: number;
  receiptNo: string;
  amount: number;
  method: string;
  reference: string | null;
  isRefund: boolean;
  notes: string | null;
  paidAt: string;
  receivedByName?: string | null;
}

export interface Invoice {
  id: number;
  invoiceNo: string;
  type: string;
  status: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balance: number;
  notes: string | null;
  cancelReason: string | null;
  createdAt: string;
  admissionId: number | null;
  createdByName: string | null;
  patient: { id: number; name: string; uhid: string; phone: string; gender: string; dob: string | null; address: string | null; city: string | null };
  items: InvoiceItem[];
  payments: Payment[];
}

export interface LabParameter {
  name: string;
  unit?: string;
  refLow?: number | null;
  refHigh?: number | null;
  refText?: string;
}
