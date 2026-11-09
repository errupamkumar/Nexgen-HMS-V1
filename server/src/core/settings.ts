/**
 * Tenant configuration engine.
 *
 * Stored settings are deep-merged over these defaults on every read, so a new
 * setting ships with a safe default and tenants only persist what they change.
 */
import { z } from 'zod';

export const customFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits and _ only'),
  label: z.string().min(1).max(60),
  type: z.enum(['text', 'number', 'date', 'select']),
  options: z.array(z.string().min(1).max(60)).max(50).optional(),
  required: z.boolean().default(false),
});
export type CustomFieldDef = z.infer<typeof customFieldSchema>;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #RRGGBB colour');
const prefix = z.string().min(1).max(10).regex(/^[A-Za-z0-9/-]+$/, 'letters, digits, / and - only');

export const settingsSectionSchemas = {
  profile: z.object({
    tagline: z.string().max(120).default(''),
    logoUrl: z.string().max(500).default(''),
    primaryColor: hex.default('#0d9488'),
    gstin: z.string().max(20).default(''),
    registrationNo: z.string().max(40).default(''),
    website: z.string().max(150).default(''),
  }),
  locale: z.object({
    currency: z.string().length(3).default('INR'),
    currencySymbol: z.string().min(1).max(4).default('₹'),
    timezone: z.string().min(1).max(60).default('Asia/Kolkata'),
    dateFormat: z.enum(['dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd MMM yyyy']).default('dd MMM yyyy'),
  }),
  numbering: z.object({
    uhid: prefix.default('UH'),
    appointment: prefix.default('AP'),
    invoice: prefix.default('INV'),
    receipt: prefix.default('RCT'),
    lab: prefix.default('LAB'),
    admission: prefix.default('IP'),
    padding: z.number().int().min(3).max(10).default(6),
  }),
  appointments: z.object({
    defaultSlotMinutes: z.number().int().min(5).max(120).default(15),
    bookingWindowDays: z.number().int().min(1).max(365).default(30),
    allowOnlineBooking: z.boolean().default(true),
    allowOverbooking: z.boolean().default(false),
    allowWalkIn: z.boolean().default(true),
  }),
  billing: z.object({
    taxLabel: z.string().max(20).default('GST'),
    defaultTaxRate: z.number().min(0).max(100).default(0),
    registrationFee: z.number().min(0).max(100000).default(0),
    autoInvoiceOnBooking: z.boolean().default(true),
    allowPartialPayment: z.boolean().default(true),
    invoiceFooter: z.string().max(500).default('Thank you for choosing us. Get well soon!'),
  }),
  clinical: z.object({
    requireVitals: z.boolean().default(false),
    prescriptionHeader: z.string().max(500).default(''),
    prescriptionFooter: z.string().max(500).default('This is a computer-generated prescription.'),
  }),
  pharmacy: z.object({
    nearExpiryDays: z.number().int().min(7).max(365).default(90),
  }),
  notifications: z.object({
    smsEnabled: z.boolean().default(false),
    emailEnabled: z.boolean().default(false),
    whatsappEnabled: z.boolean().default(false),
    bookingConfirmation: z.boolean().default(true),
  }),
  patientFields: z.array(customFieldSchema).max(30).default([]),
} as const;

export type SettingsSection = keyof typeof settingsSectionSchemas;
export const SETTINGS_SECTIONS = Object.keys(settingsSectionSchemas) as SettingsSection[];

export type TenantSettings = {
  [K in SettingsSection]: z.output<(typeof settingsSectionSchemas)[K]>;
};

export function defaultSettings(): TenantSettings {
  const out = {} as Record<string, unknown>;
  for (const key of SETTINGS_SECTIONS) {
    out[key] = settingsSectionSchemas[key].parse(key === 'patientFields' ? [] : {});
  }
  return out as TenantSettings;
}

/** Merge stored (possibly partial / older) settings over defaults, section by section. */
export function resolveSettings(stored: unknown): TenantSettings {
  const base = defaultSettings();
  const src = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  for (const key of SETTINGS_SECTIONS) {
    const incoming = src[key];
    if (incoming === undefined) continue;
    if (key === 'patientFields') {
      const r = settingsSectionSchemas.patientFields.safeParse(incoming);
      if (r.success) base.patientFields = r.data;
      continue;
    }
    const merged = { ...(base[key] as object), ...(incoming as object) };
    const r = settingsSectionSchemas[key].safeParse(merged);
    if (r.success) (base as Record<string, unknown>)[key] = r.data;
  }
  return base;
}
