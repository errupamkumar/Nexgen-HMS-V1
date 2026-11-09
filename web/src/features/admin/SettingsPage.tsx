import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bell,
  Building2,
  CalendarCog,
  Check,
  Crown,
  FileText,
  Globe,
  Hash,
  ListChecks,
  Palette,
  Pill,
  Plus,
  Receipt,
  Settings,
  Trash2,
} from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CustomField, TenantSettings } from '@/lib/types';
import { applyBrand, cn } from '@/lib/utils';
import { Badge, Button, Card, Input, NativeSelect, Skeleton, Switch, Textarea } from '@/components/ui';
import { Field, PageHeader } from '@/components/common';

interface SettingsResponse {
  organization: { name: string; code: string; type: string; email: string | null; phone: string | null; address: string | null; city: string | null; state: string | null; country: string | null; status: string; trialEndsAt: string | null };
  plan: { name: string; code: string; modules: string[]; maxUsers: number };
  enabledModules: string[];
  settings: TenantSettings;
}

const SECTIONS = [
  { id: 'organization', label: 'Organisation', icon: Building2 },
  { id: 'profile', label: 'Branding', icon: Palette },
  { id: 'locale', label: 'Localisation', icon: Globe },
  { id: 'numbering', label: 'Numbering', icon: Hash },
  { id: 'appointments', label: 'Appointments', icon: CalendarCog },
  { id: 'billing', label: 'Billing & tax', icon: Receipt },
  { id: 'clinical', label: 'Clinical', icon: FileText },
  { id: 'pharmacy', label: 'Pharmacy', icon: Pill },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'patientFields', label: 'Patient fields', icon: ListChecks },
  { id: 'subscription', label: 'Subscription', icon: Crown },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const BRAND_PRESETS = ['#0d9488', '#2563eb', '#4f46e5', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#16a34a', '#0891b2', '#334155'];
const MODULE_NAMES: Record<string, string> = {
  patients: 'Patients',
  appointments: 'Appointments & queue',
  opd: 'OPD / EMR',
  billing: 'Billing',
  pharmacy: 'Pharmacy & inventory',
  lab: 'Laboratory',
  ipd: 'In-patient (IPD)',
  reports: 'Reports & analytics',
  communication: 'Communication',
  portal: 'Patient portal',
};

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function SectionShell({ title, description, children, onSave, saving, dirty }: { title: string; description: string; children: ReactNode; onSave?: () => void; saving?: boolean; dirty?: boolean }) {
  return (
    <Card>
      <div className="border-b px-5 py-4">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="p-5">{children}</div>
      {onSave ? (
        <div className="flex items-center justify-end gap-3 border-t bg-muted/30 px-5 py-3">
          {dirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
          <Button loading={saving} disabled={!dirty} onClick={onSave}>
            <Check /> Save changes
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function useSectionSave(section: string) {
  const qc = useQueryClient();
  const { reload } = useAuth();
  return useMutation({
    mutationFn: (body: unknown) => api.put(`/admin/settings/${section}`, body),
    onSuccess: async () => {
      toast.success('Settings saved — applied immediately');
      await qc.invalidateQueries({ queryKey: ['settings'] });
      await reload();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

function SectionForm<T extends object>({ section, initial, title, description, render }: { section: string; initial: T; title: string; description: string; render: (v: T, set: (patch: Partial<T>) => void) => ReactNode }) {
  const [v, setV] = useState<T>(initial);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setV(initial);
    setDirty(false);
  }, [initial]);
  const save = useSectionSave(section);
  return (
    <SectionShell title={title} description={description} dirty={dirty} saving={save.isPending} onSave={() => save.mutate(v, { onSuccess: () => setDirty(false) })}>
      {render(v, (patch) => {
        setV((x) => ({ ...x, ...patch }));
        setDirty(true);
      })}
    </SectionShell>
  );
}

function PatientFieldsEditor({ initial }: { initial: CustomField[] }) {
  const [rows, setRows] = useState<CustomField[]>(initial);
  const [dirty, setDirty] = useState(false);
  useEffect(() => setRows(initial), [initial]);
  const save = useSectionSave('patientFields');
  const upd = (i: number, patch: Partial<CustomField>) => {
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    setDirty(true);
  };
  const keyOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 40);
  return (
    <SectionShell
      title="Custom patient fields"
      description="Extra registration fields for your workflow — insurance scheme, referral source, occupation… They appear on the registration form and patient profile."
      dirty={dirty}
      saving={save.isPending}
      onSave={() => save.mutate(rows.filter((r) => r.label.trim()).map((r) => ({ ...r, key: r.key || keyOf(r.label), options: r.type === 'select' ? r.options : undefined })), { onSuccess: () => setDirty(false) })}
    >
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="grid items-center gap-2 rounded-lg border p-2.5 sm:grid-cols-[1.5fr_1fr_2fr_auto_auto]">
            <Input placeholder="Label" value={r.label} onChange={(e) => upd(i, { label: e.target.value, key: r.key && initial.some((x) => x.key === r.key) ? r.key : keyOf(e.target.value) })} />
            <NativeSelect value={r.type} onChange={(e) => upd(i, { type: e.target.value as CustomField['type'] })}>
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="select">Dropdown</option>
            </NativeSelect>
            {r.type === 'select' ? (
              <Input placeholder="Options, comma separated" value={(r.options ?? []).join(', ')} onChange={(e) => upd(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
            ) : (
              <span className="font-mono text-xs text-muted-foreground">key: {r.key || keyOf(r.label)}</span>
            )}
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={r.required} onCheckedChange={(v) => upd(i, { required: v })} /> Required
            </label>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setRows((x) => x.filter((_, j) => j !== i));
                setDirty(true);
              }}
              aria-label="Remove field"
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          className="w-fit"
          onClick={() => {
            setRows((r) => [...r, { key: '', label: '', type: 'text', required: false }]);
            setDirty(true);
          }}
        >
          <Plus /> Add field
        </Button>
      </div>
    </SectionShell>
  );
}

function OrganizationForm({ org }: { org: SettingsResponse['organization'] }) {
  const qc = useQueryClient();
  const { reload } = useAuth();
  const [v, setV] = useState(org);
  const [dirty, setDirty] = useState(false);
  useEffect(() => setV(org), [org]);
  const save = useMutation({
    mutationFn: () => api.put('/admin/settings/organization', { name: v.name, type: v.type, email: v.email || '', phone: v.phone, address: v.address, city: v.city, state: v.state, country: v.country }),
    onSuccess: async () => {
      toast.success('Organisation updated');
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ['settings'] });
      await reload();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const s = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setV({ ...v, [k]: e.target.value });
    setDirty(true);
  };
  return (
    <SectionShell title="Organisation profile" description="Printed on prescriptions, invoices and reports." dirty={dirty} saving={save.isPending} onSave={() => save.mutate()}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Organisation name" required className="sm:col-span-2">
          <Input value={v.name} onChange={s('name')} />
        </Field>
        <Field label="Organisation code" hint="Used to sign in. Contact support to change.">
          <Input value={v.code} disabled />
        </Field>
        <Field label="Type">
          <NativeSelect value={v.type} onChange={s('type')}>
            {[
              ['clinic', 'Clinic'],
              ['polyclinic', 'Polyclinic'],
              ['hospital', 'Hospital'],
              ['nursing_home', 'Nursing home'],
              ['diagnostic', 'Diagnostic centre'],
            ].map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Email">
          <Input value={v.email ?? ''} onChange={s('email')} />
        </Field>
        <Field label="Phone">
          <Input value={v.phone ?? ''} onChange={s('phone')} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Input value={v.address ?? ''} onChange={s('address')} />
        </Field>
        <Field label="City">
          <Input value={v.city ?? ''} onChange={s('city')} />
        </Field>
        <Field label="State">
          <Input value={v.state ?? ''} onChange={s('state')} />
        </Field>
      </div>
    </SectionShell>
  );
}

export default function SettingsPage() {
  const [active, setActive] = useState<SectionId>('organization');
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsResponse>('/admin/settings') });
  const st = data?.settings;

  return (
    <>
      <PageHeader icon={Settings} title="Settings" description="Tailor NexGen to how your organisation works — every change applies instantly, no redeploy." />
      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        <nav className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible scrollbar-thin">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={cn(
                'flex shrink-0 cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground',
                active === s.id && 'bg-primary/10 text-primary hover:bg-primary/12 hover:text-primary',
              )}
            >
              <s.icon className="size-4" /> {s.label}
            </button>
          ))}
        </nav>
        {isLoading || !data || !st ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <div>
            {active === 'organization' ? <OrganizationForm org={data.organization} /> : null}
            {active === 'profile' ? (
              <SectionForm
                section="profile"
                initial={st.profile}
                title="Branding"
                description="Your colour and logo theme the whole app for every user in your organisation."
                render={(v, set) => (
                  <div className="grid gap-5 md:grid-cols-[1fr_260px]">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Brand colour" className="sm:col-span-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {BRAND_PRESETS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => {
                                set({ primaryColor: c });
                                applyBrand(c);
                              }}
                              className={cn('size-8 cursor-pointer rounded-full ring-offset-2 ring-offset-background transition', v.primaryColor === c && 'ring-2 ring-foreground')}
                              style={{ background: c }}
                              aria-label={`Use colour ${c}`}
                            />
                          ))}
                          <Input
                            type="color"
                            value={v.primaryColor}
                            onChange={(e) => {
                              set({ primaryColor: e.target.value });
                              applyBrand(e.target.value);
                            }}
                            className="h-8 w-14 cursor-pointer p-1"
                          />
                          <span className="font-mono text-xs text-muted-foreground">{v.primaryColor}</span>
                        </div>
                      </Field>
                      <Field label="Tagline" className="sm:col-span-2">
                        <Input value={v.tagline} onChange={(e) => set({ tagline: e.target.value })} placeholder="Caring for you, always" />
                      </Field>
                      <Field label="Logo URL" className="sm:col-span-2" hint="Square image, at least 128 px">
                        <Input value={v.logoUrl} onChange={(e) => set({ logoUrl: e.target.value })} placeholder="https://…" />
                      </Field>
                      <Field label="GSTIN">
                        <Input value={v.gstin} onChange={(e) => set({ gstin: e.target.value })} />
                      </Field>
                      <Field label="Registration / licence no.">
                        <Input value={v.registrationNo} onChange={(e) => set({ registrationNo: e.target.value })} />
                      </Field>
                      <Field label="Website" className="sm:col-span-2">
                        <Input value={v.website} onChange={(e) => set({ website: e.target.value })} />
                      </Field>
                    </div>
                    <div className="rounded-xl border p-4">
                      <p className="mb-3 text-xs font-medium text-muted-foreground">Live preview</p>
                      <div className="flex items-center gap-2.5">
                        {v.logoUrl ? <img src={v.logoUrl} alt="" className="size-10 rounded-xl object-cover" /> : <div className="size-10 rounded-xl bg-primary" />}
                        <div>
                          <p className="text-sm font-semibold">{data.organization.name}</p>
                          <p className="text-xs text-muted-foreground">{v.tagline || 'Your tagline'}</p>
                        </div>
                      </div>
                      <Button className="mt-4 w-full">Primary action</Button>
                      <div className="mt-3 flex gap-2">
                        <Badge>Badge</Badge>
                        <Badge variant="success">Paid</Badge>
                      </div>
                    </div>
                  </div>
                )}
              />
            ) : null}
            {active === 'locale' ? (
              <SectionForm
                section="locale"
                initial={st.locale}
                title="Localisation"
                description="Currency, time zone and date format used across screens and print-outs."
                render={(v, set) => (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Currency code" hint="ISO 4217, e.g. INR, USD, AED">
                      <Input maxLength={3} value={v.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} />
                    </Field>
                    <Field label="Currency symbol">
                      <Input value={v.currencySymbol} onChange={(e) => set({ currencySymbol: e.target.value })} />
                    </Field>
                    <Field label="Time zone" hint="Drives 'today', slot availability and reports">
                      <NativeSelect value={v.timezone} onChange={(e) => set({ timezone: e.target.value })}>
                        {['Asia/Kolkata', 'Asia/Dubai', 'Asia/Dhaka', 'Asia/Kathmandu', 'Asia/Colombo', 'Asia/Singapore', 'Africa/Nairobi', 'Europe/London', 'America/New_York', 'UTC'].map((z) => (
                          <option key={z}>{z}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label="Date format">
                      <NativeSelect value={v.dateFormat} onChange={(e) => set({ dateFormat: e.target.value })}>
                        {['dd MMM yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'].map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                  </div>
                )}
              />
            ) : null}
            {active === 'numbering' ? (
              <SectionForm
                section="numbering"
                initial={st.numbering}
                title="Document numbering"
                description="Prefixes for sequential, gap-free numbers (GST requires sequential invoice numbers). Existing documents keep their numbers."
                render={(v, set) => (
                  <div className="grid gap-4 sm:grid-cols-3">
                    {(
                      [
                        ['uhid', 'Patient UHID'],
                        ['appointment', 'Appointment'],
                        ['invoice', 'Invoice'],
                        ['receipt', 'Receipt'],
                        ['lab', 'Lab order'],
                        ['admission', 'Admission (IP)'],
                      ] as const
                    ).map(([k, l]) => (
                      <Field key={k} label={l} hint={`Next looks like ${v[k]}-${'1'.padStart(v.padding, '0')}`}>
                        <Input value={v[k]} onChange={(e) => set({ [k]: e.target.value.toUpperCase() } as Partial<typeof v>)} />
                      </Field>
                    ))}
                    <Field label="Digits">
                      <Input type="number" min={3} max={10} value={v.padding} onChange={(e) => set({ padding: Number(e.target.value) })} />
                    </Field>
                  </div>
                )}
              />
            ) : null}
            {active === 'appointments' ? (
              <SectionForm
                section="appointments"
                initial={st.appointments}
                title="Appointments"
                description="Booking rules for the desk and the patient portal."
                render={(v, set) => (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Default slot length (minutes)" hint="Doctors can override this individually">
                      <Input type="number" min={5} value={v.defaultSlotMinutes} onChange={(e) => set({ defaultSlotMinutes: Number(e.target.value) })} />
                    </Field>
                    <Field label="Booking window (days ahead)">
                      <Input type="number" min={1} value={v.bookingWindowDays} onChange={(e) => set({ bookingWindowDays: Number(e.target.value) })} />
                    </Field>
                    <Toggle label="Online booking" hint="Patients can book from the portal" checked={v.allowOnlineBooking} onChange={(x) => set({ allowOnlineBooking: x })} />
                    <Toggle label="Walk-in registration" hint="Desk can add same-day walk-ins outside the slot grid" checked={v.allowWalkIn} onChange={(x) => set({ allowWalkIn: x })} />
                    <Toggle label="Allow overbooking" hint="Book beyond a doctor's per-slot capacity" checked={v.allowOverbooking} onChange={(x) => set({ allowOverbooking: x })} />
                  </div>
                )}
              />
            ) : null}
            {active === 'billing' ? (
              <SectionForm
                section="billing"
                initial={st.billing}
                title="Billing & tax"
                description="How charges, taxes and payments behave."
                render={(v, set) => (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Tax label" hint="e.g. GST, VAT">
                      <Input value={v.taxLabel} onChange={(e) => set({ taxLabel: e.target.value })} />
                    </Field>
                    <Field label="Default tax rate (%)">
                      <Input type="number" min={0} max={100} value={v.defaultTaxRate} onChange={(e) => set({ defaultTaxRate: Number(e.target.value) })} />
                    </Field>
                    <Field label="New-patient registration fee" hint="Added to the first visit's invoice; 0 to disable">
                      <Input type="number" min={0} value={v.registrationFee} onChange={(e) => set({ registrationFee: Number(e.target.value) })} />
                    </Field>
                    <div />
                    <Toggle label="Auto-invoice on booking" hint="Raise the consultation bill when an appointment is booked" checked={v.autoInvoiceOnBooking} onChange={(x) => set({ autoInvoiceOnBooking: x })} />
                    <Toggle label="Allow partial payments" checked={v.allowPartialPayment} onChange={(x) => set({ allowPartialPayment: x })} />
                    <Field label="Invoice footer" className="sm:col-span-2">
                      <Textarea value={v.invoiceFooter} onChange={(e) => set({ invoiceFooter: e.target.value })} />
                    </Field>
                  </div>
                )}
              />
            ) : null}
            {active === 'clinical' ? (
              <SectionForm
                section="clinical"
                initial={st.clinical}
                title="Clinical"
                description="Consultation policy and prescription print layout."
                render={(v, set) => (
                  <div className="grid gap-4">
                    <Toggle label="Require vitals before finalising" hint="Enforces at least one of BP, pulse or temperature" checked={v.requireVitals} onChange={(x) => set({ requireVitals: x })} />
                    <Field label="Prescription header line">
                      <Input value={v.prescriptionHeader} onChange={(e) => set({ prescriptionHeader: e.target.value })} placeholder="e.g. NABH accredited · 24×7 emergency" />
                    </Field>
                    <Field label="Prescription footer">
                      <Textarea value={v.prescriptionFooter} onChange={(e) => set({ prescriptionFooter: e.target.value })} />
                    </Field>
                  </div>
                )}
              />
            ) : null}
            {active === 'pharmacy' ? (
              <SectionForm
                section="pharmacy"
                initial={st.pharmacy}
                title="Pharmacy"
                description="Inventory alert thresholds."
                render={(v, set) => (
                  <Field label="Near-expiry warning (days)" hint="Batches expiring within this window are flagged" className="max-w-xs">
                    <Input type="number" min={7} value={v.nearExpiryDays} onChange={(e) => set({ nearExpiryDays: Number(e.target.value) })} />
                  </Field>
                )}
              />
            ) : null}
            {active === 'notifications' ? (
              <SectionForm
                section="notifications"
                initial={st.notifications}
                title="Patient notifications"
                description="Channels used for confirmations and messages. Gateways are simulated until a provider is connected."
                render={(v, set) => (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Toggle label="SMS" checked={v.smsEnabled} onChange={(x) => set({ smsEnabled: x })} />
                    <Toggle label="WhatsApp" checked={v.whatsappEnabled} onChange={(x) => set({ whatsappEnabled: x })} />
                    <Toggle label="Email" checked={v.emailEnabled} onChange={(x) => set({ emailEnabled: x })} />
                    <Toggle label="Booking confirmations" hint="Send on every new appointment" checked={v.bookingConfirmation} onChange={(x) => set({ bookingConfirmation: x })} />
                  </div>
                )}
              />
            ) : null}
            {active === 'patientFields' ? <PatientFieldsEditor initial={st.patientFields} /> : null}
            {active === 'subscription' ? (
              <SectionShell title="Subscription" description="Your plan and the modules it unlocks.">
                <div className="mb-5 flex flex-wrap items-center gap-3">
                  <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Crown className="size-6" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold">{data.plan.name} plan</p>
                    <p className="text-sm text-muted-foreground">
                      Up to {data.plan.maxUsers} users · status <Badge variant={data.organization.status === 'active' ? 'success' : 'info'}>{data.organization.status}</Badge>
                    </p>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(MODULE_NAMES).map(([k, l]) => {
                    const on = data.enabledModules.includes(k);
                    return (
                      <div key={k} className={cn('flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm', !on && 'opacity-60')}>
                        {l}
                        {on ? <Badge variant="success">Enabled</Badge> : <Badge variant="muted">Upgrade</Badge>}
                      </div>
                    );
                  })}
                </div>
              </SectionShell>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}
