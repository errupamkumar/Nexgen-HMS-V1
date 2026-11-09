/**
 * Licensable modules, permissions and system roles — the single source of truth
 * for RBAC. The web app reads this through GET /api/meta, so nothing is
 * duplicated client-side.
 */

export const MODULES = [
  { key: 'patients', name: 'Patients', description: 'Registration, UHID, demographics, timeline' },
  { key: 'appointments', name: 'Appointments & Queue', description: 'Scheduling, tokens, check-in, queue' },
  { key: 'opd', name: 'OPD / EMR', description: 'Consultations, vitals, diagnosis, e-prescription' },
  { key: 'billing', name: 'Billing', description: 'Invoices, payments, receipts, refunds' },
  { key: 'pharmacy', name: 'Pharmacy & Inventory', description: 'Batches, FEFO dispensing, stock alerts' },
  { key: 'lab', name: 'Laboratory (LIMS)', description: 'Orders, samples, results, reports' },
  { key: 'ipd', name: 'In-Patient (IPD)', description: 'Bed board, admissions, discharge billing' },
  { key: 'reports', name: 'Reports & Analytics', description: 'Revenue, productivity, exports' },
  { key: 'communication', name: 'Communication', description: 'Patient messaging (SMS/Email/WhatsApp)' },
  { key: 'portal', name: 'Patient Portal', description: 'Self-booking, records and invoices online' },
] as const;

export type ModuleKey = (typeof MODULES)[number]['key'] | 'core';
export const MODULE_KEYS = MODULES.map((m) => m.key) as string[];

interface PermissionDef {
  key: string;
  module: ModuleKey;
  label: string;
}

export const PERMISSIONS: PermissionDef[] = [
  { key: 'dashboard.view', module: 'core', label: 'View dashboard' },
  { key: 'settings.manage', module: 'core', label: 'Manage organisation settings' },
  { key: 'masters.manage', module: 'core', label: 'Manage departments, doctors, services' },
  { key: 'staff.view', module: 'core', label: 'View users' },
  { key: 'staff.manage', module: 'core', label: 'Create and edit users' },
  { key: 'roles.manage', module: 'core', label: 'Manage roles & permissions' },
  { key: 'audit.view', module: 'core', label: 'View audit trail' },

  { key: 'patients.view', module: 'patients', label: 'View patients' },
  { key: 'patients.create', module: 'patients', label: 'Register patients' },
  { key: 'patients.update', module: 'patients', label: 'Edit patients' },
  { key: 'patients.delete', module: 'patients', label: 'Delete patients' },

  { key: 'appointments.view', module: 'appointments', label: 'View appointments & queue' },
  { key: 'appointments.create', module: 'appointments', label: 'Book appointments' },
  { key: 'appointments.update', module: 'appointments', label: 'Check-in / reschedule / update' },
  { key: 'appointments.cancel', module: 'appointments', label: 'Cancel appointments' },

  { key: 'opd.view', module: 'opd', label: 'View clinical records' },
  { key: 'opd.write', module: 'opd', label: 'Record consultations & prescribe' },

  { key: 'billing.view', module: 'billing', label: 'View invoices & payments' },
  { key: 'billing.create', module: 'billing', label: 'Create invoices' },
  { key: 'billing.payment', module: 'billing', label: 'Collect payments' },
  { key: 'billing.refund', module: 'billing', label: 'Issue refunds' },
  { key: 'billing.cancel', module: 'billing', label: 'Cancel invoices' },

  { key: 'pharmacy.view', module: 'pharmacy', label: 'View stock & prescriptions' },
  { key: 'pharmacy.manage', module: 'pharmacy', label: 'Manage medicines & stock-in' },
  { key: 'pharmacy.dispense', module: 'pharmacy', label: 'Dispense medicines' },

  { key: 'lab.view', module: 'lab', label: 'View lab orders & reports' },
  { key: 'lab.manage', module: 'lab', label: 'Manage test catalogue' },
  { key: 'lab.order', module: 'lab', label: 'Order lab tests' },
  { key: 'lab.result', module: 'lab', label: 'Collect samples & enter results' },
  { key: 'lab.verify', module: 'lab', label: 'Verify & release reports' },

  { key: 'ipd.view', module: 'ipd', label: 'View bed board & admissions' },
  { key: 'ipd.admit', module: 'ipd', label: 'Admit & transfer patients' },
  { key: 'ipd.notes', module: 'ipd', label: 'Write progress / nursing notes' },
  { key: 'ipd.discharge', module: 'ipd', label: 'Discharge patients' },
  { key: 'ipd.manage', module: 'ipd', label: 'Manage wards & beds' },

  { key: 'reports.view', module: 'reports', label: 'View reports & analytics' },
  { key: 'communication.send', module: 'communication', label: 'Send patient messages' },
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
const PERMISSION_MODULE = new Map(PERMISSIONS.map((p) => [p.key, p.module]));
export const moduleOfPermission = (perm: string): ModuleKey | undefined => PERMISSION_MODULE.get(perm);

const pick = (...prefixes: string[]) =>
  PERMISSION_KEYS.filter((k) => prefixes.some((p) => (p.endsWith('.') ? k.startsWith(p) : k === p)));

export const SYSTEM_ROLES: { code: string; name: string; description: string; permissions: string[] }[] = [
  {
    code: 'admin',
    name: 'Administrator',
    description: 'Full access to every enabled module and setting',
    permissions: [...PERMISSION_KEYS],
  },
  {
    code: 'doctor',
    name: 'Doctor',
    description: 'Consultations, prescriptions, orders and in-patient care',
    permissions: pick(
      'dashboard.view',
      'patients.view', 'patients.create', 'patients.update',
      'appointments.view', 'appointments.update',
      'opd.',
      'lab.view', 'lab.order', 'lab.verify',
      'ipd.view', 'ipd.admit', 'ipd.notes', 'ipd.discharge',
      'pharmacy.view', 'billing.view', 'reports.view',
    ),
  },
  {
    code: 'receptionist',
    name: 'Receptionist',
    description: 'Front desk — registration, booking, queue and collections',
    permissions: pick(
      'dashboard.view', 'patients.view', 'patients.create', 'patients.update',
      'appointments.', 'billing.view', 'billing.create', 'billing.payment',
      'lab.view', 'lab.order', 'ipd.view', 'ipd.admit', 'communication.send',
    ),
  },
  {
    code: 'nurse',
    name: 'Nurse',
    description: 'Vitals, nursing notes and bed management',
    permissions: pick(
      'dashboard.view', 'patients.view', 'patients.update', 'appointments.view', 'appointments.update',
      'opd.view', 'ipd.view', 'ipd.notes', 'lab.view',
    ),
  },
  {
    code: 'pharmacist',
    name: 'Pharmacist',
    description: 'Dispensing, stock and pharmacy billing',
    permissions: pick('dashboard.view', 'patients.view', 'pharmacy.', 'billing.view', 'billing.create', 'billing.payment'),
  },
  {
    code: 'lab_technician',
    name: 'Lab Technician',
    description: 'Sample collection, result entry and verification',
    permissions: pick('dashboard.view', 'patients.view', 'lab.view', 'lab.order', 'lab.result', 'lab.verify'),
  },
  {
    code: 'accountant',
    name: 'Accountant',
    description: 'Invoices, payments, refunds and financial reports',
    permissions: pick('dashboard.view', 'patients.view', 'billing.', 'reports.view'),
  },
  {
    code: 'patient',
    name: 'Patient (Portal)',
    description: 'Patient portal access to own records only',
    permissions: [],
  },
];
