/**
 * NexGen HMS — MySQL schema (Drizzle ORM).
 *
 * Tenancy: every business table carries `tenantId`, and every composite index
 * leads with it so tenant-scoped queries stay index-only as data grows.
 * Column names are camelCase here and snake_case in MySQL (casing: 'snake_case').
 */
import {
  bigint,
  boolean,
  date,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  time,
  timestamp,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

// ---------------------------------------------------------------- helpers
const id = () => bigint({ mode: 'number', unsigned: true }).autoincrement().primaryKey();
const fk = () => bigint({ mode: 'number', unsigned: true });
const money = () => decimal({ precision: 12, scale: 2, mode: 'number' });
const createdAt = () => timestamp({ mode: 'date' }).defaultNow().notNull();
const updatedAt = () => timestamp({ mode: 'date' }).defaultNow().onUpdateNow().notNull();
const dt = () => timestamp({ mode: 'date' });

// ================================================================ PLATFORM
export const plans = mysqlTable('plans', {
  id: id(),
  code: varchar({ length: 40 }).notNull().unique(),
  name: varchar({ length: 100 }).notNull(),
  description: varchar({ length: 500 }),
  priceMonthly: money().notNull().default(0),
  priceYearly: money().notNull().default(0),
  maxUsers: int().notNull().default(10),
  maxBranches: int().notNull().default(1),
  modules: json().$type<string[]>().notNull(),
  isActive: boolean().notNull().default(true),
  sortOrder: int().notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tenants = mysqlTable(
  'tenants',
  {
    id: id(),
    code: varchar({ length: 40 }).notNull().unique(),
    name: varchar({ length: 150 }).notNull(),
    type: mysqlEnum(['clinic', 'polyclinic', 'hospital', 'diagnostic', 'nursing_home']).notNull().default('clinic'),
    email: varchar({ length: 150 }),
    phone: varchar({ length: 30 }),
    address: varchar({ length: 300 }),
    city: varchar({ length: 80 }),
    state: varchar({ length: 80 }),
    country: varchar({ length: 80 }).default('India'),
    planId: fk().notNull().references(() => plans.id),
    status: mysqlEnum(['trial', 'active', 'suspended', 'cancelled']).notNull().default('trial'),
    trialEndsAt: dt(),
    subscriptionEndsAt: dt(),
    settings: json().$type<Record<string, unknown>>().notNull(),
    moduleOverrides: json().$type<{ enable: string[]; disable: string[] }>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('tenants_status_idx').on(t.status)],
);

export const branches = mysqlTable(
  'branches',
  {
    id: id(),
    tenantId: fk().notNull().references(() => tenants.id),
    name: varchar({ length: 120 }).notNull(),
    code: varchar({ length: 20 }).notNull(),
    address: varchar({ length: 300 }),
    phone: varchar({ length: 30 }),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('branches_tenant_code_uq').on(t.tenantId, t.code)],
);

export const roles = mysqlTable(
  'roles',
  {
    id: id(),
    tenantId: fk().notNull().references(() => tenants.id),
    code: varchar({ length: 40 }).notNull(),
    name: varchar({ length: 80 }).notNull(),
    description: varchar({ length: 300 }),
    permissions: json().$type<string[]>().notNull(),
    isSystem: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('roles_tenant_code_uq').on(t.tenantId, t.code)],
);

export const users = mysqlTable(
  'users',
  {
    id: id(),
    /** Null only for platform owners. */
    tenantId: fk().references(() => tenants.id),
    roleId: fk().references(() => roles.id),
    branchId: fk(),
    email: varchar({ length: 150 }).notNull(),
    passwordHash: varchar({ length: 100 }).notNull(),
    fullName: varchar({ length: 120 }).notNull(),
    phone: varchar({ length: 30 }),
    isPlatformAdmin: boolean().notNull().default(false),
    /** Set for patient-portal accounts. */
    patientId: fk(),
    /** Set for clinicians — links the login to the doctor profile. */
    doctorId: fk(),
    status: mysqlEnum(['active', 'inactive']).notNull().default('active'),
    failedLogins: int().notNull().default(0),
    lockedUntil: dt(),
    lastLoginAt: dt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_tenant_email_uq').on(t.tenantId, t.email),
    index('users_email_idx').on(t.email),
  ],
);

export const refreshTokens = mysqlTable(
  'refresh_tokens',
  {
    id: id(),
    userId: fk().notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar({ length: 64 }).notNull().unique(),
    expiresAt: dt().notNull(),
    revokedAt: dt(),
    userAgent: varchar({ length: 300 }),
    ip: varchar({ length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index('refresh_user_idx').on(t.userId)],
);

export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: id(),
    tenantId: fk(),
    userId: fk(),
    userName: varchar({ length: 120 }),
    action: varchar({ length: 40 }).notNull(),
    entity: varchar({ length: 60 }).notNull(),
    entityId: varchar({ length: 40 }),
    summary: varchar({ length: 500 }),
    details: json().$type<Record<string, unknown>>(),
    ip: varchar({ length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('audit_tenant_entity_idx').on(t.tenantId, t.entity, t.entityId),
  ],
);

export const sequences = mysqlTable(
  'sequences',
  {
    tenantId: fk().notNull(),
    name: varchar({ length: 40 }).notNull(),
    value: bigint({ mode: 'number', unsigned: true }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.name] })],
);

export const notifications = mysqlTable(
  'notifications',
  {
    id: id(),
    tenantId: fk().notNull().references(() => tenants.id),
    /** Null = broadcast to everyone holding `permission`. */
    userId: fk(),
    permission: varchar({ length: 60 }),
    title: varchar({ length: 150 }).notNull(),
    body: varchar({ length: 500 }),
    link: varchar({ length: 200 }),
    type: varchar({ length: 40 }).notNull().default('info'),
    readBy: json().$type<number[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('notif_tenant_created_idx').on(t.tenantId, t.createdAt)],
);

export const messageLogs = mysqlTable(
  'message_logs',
  {
    id: id(),
    tenantId: fk().notNull().references(() => tenants.id),
    patientId: fk(),
    channel: mysqlEnum(['sms', 'email', 'whatsapp', 'portal']).notNull(),
    recipient: varchar({ length: 150 }).notNull(),
    subject: varchar({ length: 200 }),
    body: text().notNull(),
    status: mysqlEnum(['sent', 'failed', 'simulated']).notNull().default('simulated'),
    sentBy: fk(),
    createdAt: createdAt(),
  },
  (t) => [index('msg_tenant_created_idx').on(t.tenantId, t.createdAt)],
);

// ================================================================ MASTERS
export const departments = mysqlTable(
  'departments',
  {
    id: id(),
    tenantId: fk().notNull().references(() => tenants.id),
    name: varchar({ length: 100 }).notNull(),
    code: varchar({ length: 20 }),
    description: varchar({ length: 300 }),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('dept_tenant_name_uq').on(t.tenantId, t.name)],
);

export const doctors = mysqlTable(
  'doctors',
  {
    id: id(),
    tenantId: fk().notNull().references(() => tenants.id),
    departmentId: fk().references(() => departments.id),
    branchId: fk(),
    name: varchar({ length: 120 }).notNull(),
    specialization: varchar({ length: 120 }),
    qualification: varchar({ length: 200 }),
    registrationNo: varchar({ length: 60 }),
    experienceYears: int().default(0),
    phone: varchar({ length: 30 }),
    email: varchar({ length: 150 }),
    bio: text(),
    photoUrl: varchar({ length: 500 }),
    consultationFee: money().notNull().default(0),
    followUpFee: money().notNull().default(0),
    followUpDays: int().notNull().default(7),
    slotMinutes: int().notNull().default(15),
    maxPerSlot: int().notNull().default(1),
    telehealthEnabled: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('doctors_tenant_dept_idx').on(t.tenantId, t.departmentId)],
);

export const doctorSchedules = mysqlTable(
  'doctor_schedules',
  {
    id: id(),
    tenantId: fk().notNull(),
    doctorId: fk().notNull().references(() => doctors.id, { onDelete: 'cascade' }),
    /** 0 = Sunday … 6 = Saturday */
    dayOfWeek: tinyint().notNull(),
    startTime: time().notNull(),
    endTime: time().notNull(),
  },
  (t) => [index('sched_doctor_day_idx').on(t.tenantId, t.doctorId, t.dayOfWeek)],
);

export const doctorLeaves = mysqlTable(
  'doctor_leaves',
  {
    id: id(),
    tenantId: fk().notNull(),
    doctorId: fk().notNull().references(() => doctors.id, { onDelete: 'cascade' }),
    dateFrom: date({ mode: 'string' }).notNull(),
    dateTo: date({ mode: 'string' }).notNull(),
    reason: varchar({ length: 200 }),
    createdAt: createdAt(),
  },
  (t) => [index('leave_doctor_idx').on(t.tenantId, t.doctorId, t.dateFrom)],
);

export const services = mysqlTable(
  'services',
  {
    id: id(),
    tenantId: fk().notNull().references(() => tenants.id),
    code: varchar({ length: 30 }),
    name: varchar({ length: 150 }).notNull(),
    category: mysqlEnum(['consultation', 'procedure', 'investigation', 'room', 'nursing', 'package', 'other'])
      .notNull()
      .default('other'),
    price: money().notNull().default(0),
    taxRate: decimal({ precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('services_tenant_idx').on(t.tenantId, t.category)],
);

export const medicines = mysqlTable(
  'medicines',
  {
    id: id(),
    tenantId: fk().notNull().references(() => tenants.id),
    name: varchar({ length: 150 }).notNull(),
    genericName: varchar({ length: 150 }),
    form: varchar({ length: 40 }),
    strength: varchar({ length: 40 }),
    manufacturer: varchar({ length: 120 }),
    category: varchar({ length: 60 }),
    hsnCode: varchar({ length: 20 }),
    unit: varchar({ length: 20 }).notNull().default('unit'),
    reorderLevel: int().notNull().default(10),
    salePrice: money().notNull().default(0),
    taxRate: decimal({ precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('med_tenant_name_idx').on(t.tenantId, t.name)],
);

export interface LabParameter {
  name: string;
  unit?: string;
  refLow?: number | null;
  refHigh?: number | null;
  refText?: string;
}

export const labTests = mysqlTable(
  'lab_tests',
  {
    id: id(),
    tenantId: fk().notNull().references(() => tenants.id),
    code: varchar({ length: 30 }),
    name: varchar({ length: 150 }).notNull(),
    category: varchar({ length: 60 }),
    sampleType: varchar({ length: 60 }),
    price: money().notNull().default(0),
    taxRate: decimal({ precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
    turnaroundHours: int().notNull().default(24),
    parameters: json().$type<LabParameter[]>().notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('labtest_tenant_idx').on(t.tenantId, t.name)],
);

export const wards = mysqlTable(
  'wards',
  {
    id: id(),
    tenantId: fk().notNull().references(() => tenants.id),
    branchId: fk(),
    name: varchar({ length: 100 }).notNull(),
    type: mysqlEnum(['general', 'semi_private', 'private', 'icu', 'nicu', 'emergency', 'maternity']).notNull().default('general'),
    floor: varchar({ length: 20 }),
    dailyRate: money().notNull().default(0),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ward_tenant_idx').on(t.tenantId)],
);

export const beds = mysqlTable(
  'beds',
  {
    id: id(),
    tenantId: fk().notNull(),
    wardId: fk().notNull().references(() => wards.id, { onDelete: 'cascade' }),
    bedNo: varchar({ length: 20 }).notNull(),
    status: mysqlEnum(['available', 'occupied', 'cleaning', 'maintenance', 'reserved']).notNull().default('available'),
    dailyRate: money(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('bed_ward_no_uq').on(t.tenantId, t.wardId, t.bedNo)],
);

// ================================================================ PATIENTS
export const patients = mysqlTable(
  'patients',
  {
    id: id(),
    tenantId: fk().notNull().references(() => tenants.id),
    uhid: varchar({ length: 30 }).notNull(),
    firstName: varchar({ length: 80 }).notNull(),
    lastName: varchar({ length: 80 }),
    gender: mysqlEnum(['male', 'female', 'other']).notNull(),
    dob: date({ mode: 'string' }),
    phone: varchar({ length: 20 }).notNull(),
    email: varchar({ length: 150 }),
    bloodGroup: varchar({ length: 5 }),
    address: varchar({ length: 300 }),
    city: varchar({ length: 80 }),
    state: varchar({ length: 80 }),
    pincode: varchar({ length: 10 }),
    nationalId: varchar({ length: 40 }),
    emergencyName: varchar({ length: 120 }),
    emergencyPhone: varchar({ length: 20 }),
    allergies: json().$type<string[]>().notNull(),
    conditions: json().$type<string[]>().notNull(),
    notes: text(),
    customFields: json().$type<Record<string, unknown>>().notNull(),
    isDeleted: boolean().notNull().default(false),
    createdBy: fk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('patients_tenant_uhid_uq').on(t.tenantId, t.uhid),
    index('patients_tenant_phone_idx').on(t.tenantId, t.phone),
    index('patients_tenant_name_idx').on(t.tenantId, t.firstName, t.lastName),
  ],
);

// ================================================================ APPOINTMENTS
export const APPOINTMENT_STATUSES = ['booked', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show'] as const;

export const appointments = mysqlTable(
  'appointments',
  {
    id: id(),
    tenantId: fk().notNull().references(() => tenants.id),
    branchId: fk(),
    appointmentNo: varchar({ length: 30 }).notNull(),
    patientId: fk().notNull().references(() => patients.id),
    doctorId: fk().notNull().references(() => doctors.id),
    departmentId: fk(),
    date: date({ mode: 'string' }).notNull(),
    startTime: time().notNull(),
    endTime: time().notNull(),
    tokenNo: int().notNull(),
    visitType: mysqlEnum(['new', 'follow_up']).notNull().default('new'),
    mode: mysqlEnum(['in_person', 'video']).notNull().default('in_person'),
    source: mysqlEnum(['walk_in', 'phone', 'desk', 'portal']).notNull().default('desk'),
    status: mysqlEnum(APPOINTMENT_STATUSES).notNull().default('booked'),
    fee: money().notNull().default(0),
    reason: varchar({ length: 300 }),
    notes: varchar({ length: 500 }),
    cancelReason: varchar({ length: 300 }),
    invoiceId: fk(),
    checkedInAt: dt(),
    startedAt: dt(),
    completedAt: dt(),
    createdBy: fk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('appt_tenant_no_uq').on(t.tenantId, t.appointmentNo),
    index('appt_doctor_date_idx').on(t.tenantId, t.doctorId, t.date, t.startTime),
    index('appt_tenant_date_idx').on(t.tenantId, t.date, t.status),
    index('appt_patient_idx').on(t.tenantId, t.patientId),
  ],
);

// ================================================================ OPD / EMR
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
export interface Diagnosis {
  code?: string;
  description: string;
  type?: 'provisional' | 'final';
}

export const encounters = mysqlTable(
  'encounters',
  {
    id: id(),
    tenantId: fk().notNull().references(() => tenants.id),
    patientId: fk().notNull().references(() => patients.id),
    doctorId: fk().notNull().references(() => doctors.id),
    appointmentId: fk(),
    admissionId: fk(),
    type: mysqlEnum(['opd', 'ipd']).notNull().default('opd'),
    status: mysqlEnum(['draft', 'final']).notNull().default('draft'),
    chiefComplaint: text(),
    history: text(),
    examination: text(),
    vitals: json().$type<Vitals>().notNull(),
    diagnoses: json().$type<Diagnosis[]>().notNull(),
    notes: text(),
    advice: text(),
    followUpDate: date({ mode: 'string' }),
    rxStatus: mysqlEnum(['none', 'pending', 'dispensed']).notNull().default('none'),
    finalizedAt: dt(),
    createdBy: fk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('enc_patient_idx').on(t.tenantId, t.patientId, t.createdAt),
    uniqueIndex('enc_appt_uq').on(t.tenantId, t.appointmentId),
    index('enc_rx_idx').on(t.tenantId, t.rxStatus),
  ],
);

export const prescriptionItems = mysqlTable(
  'prescription_items',
  {
    id: id(),
    tenantId: fk().notNull(),
    encounterId: fk().notNull().references(() => encounters.id, { onDelete: 'cascade' }),
    medicineId: fk(),
    medicineName: varchar({ length: 150 }).notNull(),
    dose: varchar({ length: 60 }),
    frequency: varchar({ length: 60 }),
    durationDays: int(),
    route: varchar({ length: 40 }),
    instructions: varchar({ length: 300 }),
    quantity: int().notNull().default(0),
    dispensedQty: int().notNull().default(0),
  },
  (t) => [index('rx_encounter_idx').on(t.tenantId, t.encounterId)],
);

// ================================================================ BILLING
export const invoices = mysqlTable(
  'invoices',
  {
    id: id(),
    tenantId: fk().notNull().references(() => tenants.id),
    branchId: fk(),
    invoiceNo: varchar({ length: 30 }).notNull(),
    patientId: fk().notNull().references(() => patients.id),
    type: mysqlEnum(['opd', 'ipd', 'pharmacy', 'lab', 'general']).notNull().default('general'),
    status: mysqlEnum(['draft', 'unpaid', 'partially_paid', 'paid', 'cancelled', 'refunded']).notNull().default('unpaid'),
    appointmentId: fk(),
    admissionId: fk(),
    labOrderId: fk(),
    encounterId: fk(),
    subtotal: money().notNull().default(0),
    discountTotal: money().notNull().default(0),
    taxTotal: money().notNull().default(0),
    total: money().notNull().default(0),
    amountPaid: money().notNull().default(0),
    balance: money().notNull().default(0),
    notes: varchar({ length: 500 }),
    cancelReason: varchar({ length: 300 }),
    createdBy: fk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('inv_tenant_no_uq').on(t.tenantId, t.invoiceNo),
    index('inv_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('inv_tenant_status_idx').on(t.tenantId, t.status),
    index('inv_patient_idx').on(t.tenantId, t.patientId),
  ],
);

export const invoiceItems = mysqlTable(
  'invoice_items',
  {
    id: id(),
    tenantId: fk().notNull(),
    invoiceId: fk().notNull().references(() => invoices.id, { onDelete: 'cascade' }),
    itemType: mysqlEnum(['consultation', 'service', 'medicine', 'lab_test', 'bed', 'registration', 'other']).notNull(),
    refId: fk(),
    batchId: fk(),
    description: varchar({ length: 200 }).notNull(),
    quantity: decimal({ precision: 10, scale: 2, mode: 'number' }).notNull().default(1),
    unitPrice: money().notNull(),
    discount: money().notNull().default(0),
    taxRate: decimal({ precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
    taxAmount: money().notNull().default(0),
    amount: money().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('invitem_invoice_idx').on(t.tenantId, t.invoiceId)],
);

export const PAYMENT_METHODS = ['cash', 'card', 'upi', 'netbanking', 'cheque', 'insurance', 'wallet'] as const;

export const payments = mysqlTable(
  'payments',
  {
    id: id(),
    tenantId: fk().notNull().references(() => tenants.id),
    invoiceId: fk().notNull().references(() => invoices.id),
    patientId: fk().notNull(),
    receiptNo: varchar({ length: 30 }).notNull(),
    /** Negative for refunds. */
    amount: money().notNull(),
    method: mysqlEnum(PAYMENT_METHODS).notNull(),
    reference: varchar({ length: 100 }),
    isRefund: boolean().notNull().default(false),
    notes: varchar({ length: 300 }),
    receivedBy: fk(),
    paidAt: timestamp({ mode: 'date' }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('pay_tenant_receipt_uq').on(t.tenantId, t.receiptNo),
    index('pay_tenant_paid_idx').on(t.tenantId, t.paidAt),
    index('pay_invoice_idx').on(t.tenantId, t.invoiceId),
  ],
);

// ================================================================ PHARMACY
export const medicineBatches = mysqlTable(
  'medicine_batches',
  {
    id: id(),
    tenantId: fk().notNull(),
    medicineId: fk().notNull().references(() => medicines.id),
    batchNo: varchar({ length: 40 }).notNull(),
    expiryDate: date({ mode: 'string' }).notNull(),
    quantity: int().notNull().default(0),
    purchasePrice: money().notNull().default(0),
    mrp: money().notNull().default(0),
    salePrice: money().notNull().default(0),
    supplier: varchar({ length: 120 }),
    receivedAt: createdAt(),
  },
  (t) => [index('batch_med_expiry_idx').on(t.tenantId, t.medicineId, t.expiryDate)],
);

export const stockMovements = mysqlTable(
  'stock_movements',
  {
    id: id(),
    tenantId: fk().notNull(),
    medicineId: fk().notNull(),
    batchId: fk().notNull(),
    type: mysqlEnum(['purchase', 'sale', 'adjustment', 'return', 'expired']).notNull(),
    /** Signed: positive adds stock, negative removes it. */
    quantity: int().notNull(),
    referenceType: varchar({ length: 30 }),
    referenceId: fk(),
    notes: varchar({ length: 300 }),
    createdBy: fk(),
    createdAt: createdAt(),
  },
  (t) => [index('stockmv_med_idx').on(t.tenantId, t.medicineId, t.createdAt)],
);

// ================================================================ LABORATORY
export interface LabResultValue {
  parameter: string;
  value: string;
  unit?: string;
  refRange?: string;
  flag?: 'H' | 'L' | 'N' | '';
}

export const labOrders = mysqlTable(
  'lab_orders',
  {
    id: id(),
    tenantId: fk().notNull().references(() => tenants.id),
    orderNo: varchar({ length: 30 }).notNull(),
    patientId: fk().notNull().references(() => patients.id),
    doctorId: fk(),
    encounterId: fk(),
    invoiceId: fk(),
    priority: mysqlEnum(['routine', 'urgent', 'stat']).notNull().default('routine'),
    status: mysqlEnum(['ordered', 'sample_collected', 'completed', 'verified', 'cancelled']).notNull().default('ordered'),
    sampleId: varchar({ length: 40 }),
    notes: varchar({ length: 500 }),
    collectedAt: dt(),
    completedAt: dt(),
    verifiedAt: dt(),
    verifiedBy: fk(),
    createdBy: fk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('lab_tenant_no_uq').on(t.tenantId, t.orderNo),
    index('lab_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('lab_patient_idx').on(t.tenantId, t.patientId),
  ],
);

export const labOrderItems = mysqlTable(
  'lab_order_items',
  {
    id: id(),
    tenantId: fk().notNull(),
    labOrderId: fk().notNull().references(() => labOrders.id, { onDelete: 'cascade' }),
    labTestId: fk().notNull(),
    testName: varchar({ length: 150 }).notNull(),
    price: money().notNull().default(0),
    results: json().$type<LabResultValue[]>().notNull(),
    resultNotes: varchar({ length: 500 }),
  },
  (t) => [index('labitem_order_idx').on(t.tenantId, t.labOrderId)],
);

// ================================================================ IPD
export const admissions = mysqlTable(
  'admissions',
  {
    id: id(),
    tenantId: fk().notNull().references(() => tenants.id),
    admissionNo: varchar({ length: 30 }).notNull(),
    patientId: fk().notNull().references(() => patients.id),
    doctorId: fk().notNull().references(() => doctors.id),
    departmentId: fk(),
    bedId: fk().notNull().references(() => beds.id),
    invoiceId: fk(),
    status: mysqlEnum(['admitted', 'discharged', 'cancelled']).notNull().default('admitted'),
    admittedAt: timestamp({ mode: 'date' }).defaultNow().notNull(),
    dischargedAt: dt(),
    reason: varchar({ length: 500 }),
    provisionalDiagnosis: varchar({ length: 500 }),
    attendantName: varchar({ length: 120 }),
    attendantPhone: varchar({ length: 20 }),
    dischargeType: mysqlEnum(['normal', 'lama', 'referred', 'absconded', 'death']),
    dischargeSummary: text(),
    /** Bed-day charges already billed (on transfer) so discharge bills only the remainder. */
    bedChargesBilledUntil: dt(),
    createdBy: fk(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('adm_tenant_no_uq').on(t.tenantId, t.admissionNo),
    index('adm_tenant_status_idx').on(t.tenantId, t.status),
    index('adm_patient_idx').on(t.tenantId, t.patientId),
  ],
);

export const admissionNotes = mysqlTable(
  'admission_notes',
  {
    id: id(),
    tenantId: fk().notNull(),
    admissionId: fk().notNull().references(() => admissions.id, { onDelete: 'cascade' }),
    type: mysqlEnum(['progress', 'nursing', 'transfer', 'procedure']).notNull().default('progress'),
    note: text().notNull(),
    vitals: json().$type<Vitals>(),
    createdBy: fk(),
    createdByName: varchar({ length: 120 }),
    createdAt: createdAt(),
  },
  (t) => [index('admnote_adm_idx').on(t.tenantId, t.admissionId, t.createdAt)],
);
