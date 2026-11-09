import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  FlaskConical,
  History,
  Lock,
  Pill,
  Plus,
  Printer,
  Save,
  Stethoscope,
  Trash2,
} from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ageOf, fmtTime, titleCase, useFmt } from '@/lib/format';
import type { Diagnosis, Doctor, Patient, RxItem, Vitals } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Avatar, Badge, Button, Card, Checkbox, Input, Label, NativeSelect, Skeleton, Textarea } from '@/components/ui';
import { ConfirmDialog, EmptyState, Field, SectionCard, StatusBadge } from '@/components/common';

interface Encounter {
  id: number;
  status: 'draft' | 'final';
  patientId: number;
  createdAt: string;
  finalizedAt: string | null;
  chiefComplaint: string | null;
  history: string | null;
  examination: string | null;
  vitals: Vitals;
  diagnoses: Diagnosis[];
  notes: string | null;
  advice: string | null;
  followUpDate: string | null;
  patient: Patient;
  doctor: Doctor & { departmentName: string | null };
  appointment: { id: number; appointmentNo: string; date: string; startTime: string; tokenNo: number; visitType: string; status: string } | null;
  prescriptions: RxItem[];
  labOrders: { id: number; orderNo: string; status: string; priority: string; items: { testName: string }[] }[];
  pastVisits: PastVisit[];
}
interface PastVisit {
  id: number;
  createdAt: string;
  diagnoses: Diagnosis[];
  chiefComplaint: string | null;
  advice: string | null;
  vitals: Vitals;
  doctorName: string;
  prescriptions: RxItem[];
}

const FREQUENCIES: [string, number][] = [
  ['1-0-1', 2],
  ['1-0-0', 1],
  ['0-0-1', 1],
  ['1-1-1', 3],
  ['0-1-0', 1],
  ['1-1-0', 2],
  ['0-1-1', 2],
  ['OD', 1],
  ['BD', 2],
  ['TDS', 3],
  ['QID', 4],
  ['HS', 1],
  ['SOS', 0],
  ['STAT', 0],
];
const perDay = (f?: string | null) => FREQUENCIES.find(([k]) => k === f)?.[1] ?? 0;

const COMMON_DX: [string, string][] = [
  ['J06.9', 'Acute upper respiratory infection'],
  ['I10', 'Essential hypertension'],
  ['E11.9', 'Type 2 diabetes mellitus'],
  ['A09', 'Infectious gastroenteritis'],
  ['M54.5', 'Low back pain'],
  ['R50.9', 'Fever, unspecified'],
  ['K30', 'Functional dyspepsia'],
  ['J45.9', 'Asthma'],
];

const VITAL_FIELDS: { key: keyof Vitals; label: string; unit: string; step?: string }[] = [
  { key: 'bpSystolic', label: 'BP systolic', unit: 'mmHg' },
  { key: 'bpDiastolic', label: 'BP diastolic', unit: 'mmHg' },
  { key: 'pulse', label: 'Pulse', unit: 'bpm' },
  { key: 'temperature', label: 'Temp', unit: '°C', step: '0.1' },
  { key: 'spo2', label: 'SpO₂', unit: '%' },
  { key: 'respiratoryRate', label: 'Resp. rate', unit: '/min' },
  { key: 'weight', label: 'Weight', unit: 'kg', step: '0.1' },
  { key: 'height', label: 'Height', unit: 'cm' },
];

function vitalFlag(k: keyof Vitals, v: number | null | undefined) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  const ranges: Partial<Record<keyof Vitals, [number, number]>> = {
    bpSystolic: [90, 139],
    bpDiastolic: [60, 89],
    pulse: [60, 100],
    temperature: [36.1, 37.5],
    spo2: [95, 100],
    respiratoryRate: [12, 20],
  };
  const r = ranges[k];
  if (!r) return '';
  return v < r[0] || v > r[1] ? 'text-destructive' : 'text-success';
}

export default function ConsultationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const f = useFmt();
  const { data, isLoading } = useQuery({
    queryKey: ['encounter', id],
    queryFn: () => api.get<Encounter>(`/opd/encounters/${id}`),
  });
  const meds = useQuery({ queryKey: ['medicines', 'all'], queryFn: () => api.get<{ id: number; name: string; strength: string | null; form: string | null }[]>('/masters/medicines', { all: 1, active: 'true' }), staleTime: 120_000 });
  const tests = useQuery({ queryKey: ['lab-tests', 'all'], queryFn: () => api.get<{ id: number; name: string; price: number; category: string | null }[]>('/masters/lab-tests', { all: 1, active: 'true' }), staleTime: 120_000, enabled: can('lab.order') });

  const [form, setForm] = useState({
    chiefComplaint: '',
    history: '',
    examination: '',
    notes: '',
    advice: '',
    followUpDate: '',
    vitals: {} as Vitals,
    diagnoses: [] as Diagnosis[],
    prescriptions: [] as RxItem[],
  });
  const [dirty, setDirty] = useState(false);
  const [selectedTests, setSelectedTests] = useState<number[]>([]);
  const [priority, setPriority] = useState<'routine' | 'urgent' | 'stat'>('routine');
  const [confirmFinal, setConfirmFinal] = useState(false);

  useEffect(() => {
    if (!data) return;
    setForm({
      chiefComplaint: data.chiefComplaint ?? '',
      history: data.history ?? '',
      examination: data.examination ?? '',
      notes: data.notes ?? '',
      advice: data.advice ?? '',
      followUpDate: data.followUpDate ?? '',
      vitals: data.vitals ?? {},
      diagnoses: data.diagnoses ?? [],
      prescriptions: data.prescriptions ?? [],
    });
    setDirty(false);
  }, [data]);

  const past = data?.pastVisits ?? [];

  const readOnly = !data || data.status === 'final' || !can('opd.write');
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((s) => ({ ...s, [k]: v }));
    setDirty(true);
  };
  const bmi = useMemo(() => {
    const { weight, height } = form.vitals;
    return weight && height ? Math.round((weight / Math.pow(height / 100, 2)) * 10) / 10 : null;
  }, [form.vitals]);

  const payload = () => ({
    ...form,
    followUpDate: form.followUpDate || null,
    diagnoses: form.diagnoses.filter((d) => d.description.trim()),
    prescriptions: form.prescriptions
      .filter((p) => p.medicineName.trim())
      .map((p) => ({ ...p, durationDays: p.durationDays ?? null, quantity: Number(p.quantity) || 0 })),
  });

  const save = useMutation({
    mutationFn: () => api.put(`/opd/encounters/${id}`, payload()),
    onSuccess: () => {
      setDirty(false);
      toast.success('Draft saved');
      qc.invalidateQueries({ queryKey: ['encounter', id] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const finalize = useMutation({
    mutationFn: async () => {
      await api.put(`/opd/encounters/${id}`, payload());
      await api.post(`/opd/encounters/${id}/finalize`);
    },
    onSuccess: () => {
      toast.success('Consultation finalised', { description: 'Prescription sent to pharmacy. The record is now locked.' });
      setConfirmFinal(false);
      qc.invalidateQueries({ queryKey: ['encounter', id] });
      qc.invalidateQueries({ queryKey: ['queue'] });
    },
    onError: (e) => {
      setConfirmFinal(false);
      toast.error(errMsg(e));
    },
  });
  const orderLab = useMutation({
    mutationFn: () => api.post<{ orderNo: string }>(`/opd/encounters/${id}/lab-orders`, { testIds: selectedTests, priority }),
    onSuccess: (r) => {
      toast.success(`Lab order ${r.orderNo} placed`);
      setSelectedTests([]);
      qc.invalidateQueries({ queryKey: ['encounter', id] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    );
  }

  const p = data.patient;
  const age = ageOf(p.dob);
  const updateRx = (i: number, patch: Partial<RxItem>) => {
    const next = form.prescriptions.map((r, idx) => {
      if (idx !== i) return r;
      const merged = { ...r, ...patch };
      if (('frequency' in patch || 'durationDays' in patch) && !('quantity' in patch)) {
        const q = perDay(merged.frequency) * (merged.durationDays ?? 0);
        if (q > 0) merged.quantity = q;
      }
      return merged;
    });
    set('prescriptions', next);
  };

  return (
    <div className="flex flex-col gap-5 pb-24">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft /> Back
        </Button>
        <div className="flex items-center gap-2">
          <StatusBadge status={data.status} />
          {data.status === 'final' ? (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/print/prescription/${data.id}`} target="_blank">
                <Printer /> Print prescription
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="flex flex-col gap-4 p-4 md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <Avatar name={p.name} className="size-12" />
          <div>
            <Link to={`/patients/${p.id}`} className="text-lg font-semibold hover:text-primary">
              {p.name}
            </Link>
            <p className="text-sm text-muted-foreground">
              {p.uhid} · {age ?? '—'} yrs · {titleCase(p.gender)}
              {p.bloodGroup ? ` · ${p.bloodGroup}` : ''} · {p.phone}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 md:ml-auto">
          {data.appointment ? (
            <Badge variant="secondary">
              Token #{data.appointment.tokenNo} · {fmtTime(data.appointment.startTime)} · {data.appointment.visitType === 'follow_up' ? 'Follow-up' : 'New'}
            </Badge>
          ) : null}
          <Badge variant="outline">
            <Stethoscope /> {data.doctor.name}
          </Badge>
          {p.conditions?.map((c) => (
            <Badge key={c} variant="info">
              {c}
            </Badge>
          ))}
        </div>
      </Card>
      {p.allergies?.length ? (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm">
          <AlertTriangle className="size-4 text-destructive" />
          <span className="font-semibold text-destructive">Allergic to:</span> {p.allergies.join(', ')}
        </div>
      ) : null}
      {data.status === 'final' ? (
        <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
          <Lock className="size-4" /> Finalised {f.dateTime(data.finalizedAt)} — clinical records are read-only.
        </div>
      ) : null}

      <div className="grid gap-5 [&>*]:min-w-0 xl:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-5">
          <SectionCard title={<span className="flex items-center gap-2"><Activity className="size-4 text-primary" /> Vitals</span>} description={bmi ? `BMI ${bmi}` : 'BMI is calculated from weight and height'}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {VITAL_FIELDS.map((v) => (
                <div key={v.key} className="flex flex-col gap-1">
                  <Label className="flex justify-between">
                    {v.label} <span className="font-normal text-muted-foreground">{v.unit}</span>
                  </Label>
                  <Input
                    type="number"
                    step={v.step ?? '1'}
                    disabled={readOnly}
                    className={cn('tabular-nums', vitalFlag(v.key, form.vitals[v.key] as number))}
                    value={form.vitals[v.key] ?? ''}
                    onChange={(e) => set('vitals', { ...form.vitals, [v.key]: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title={<span className="flex items-center gap-2"><ClipboardList className="size-4 text-primary" /> Clinical notes</span>}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Chief complaint" className="md:col-span-2">
                <Textarea rows={2} disabled={readOnly} value={form.chiefComplaint} onChange={(e) => set('chiefComplaint', e.target.value)} placeholder="Presenting complaints with duration" />
              </Field>
              <Field label="History">
                <Textarea rows={3} disabled={readOnly} value={form.history} onChange={(e) => set('history', e.target.value)} placeholder="HPI, past history, family history" />
              </Field>
              <Field label="Examination">
                <Textarea rows={3} disabled={readOnly} value={form.examination} onChange={(e) => set('examination', e.target.value)} placeholder="General & systemic examination" />
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            title="Diagnosis"
            actions={
              !readOnly ? (
                <Button variant="outline" size="sm" onClick={() => set('diagnoses', [...form.diagnoses, { code: '', description: '', type: 'provisional' }])}>
                  <Plus /> Add
                </Button>
              ) : null
            }
          >
            <div className="flex flex-col gap-2">
              {form.diagnoses.map((d, i) => (
                <div key={i} className="grid grid-cols-[90px_1fr_130px_auto] items-center gap-2">
                  <Input placeholder="ICD-10" disabled={readOnly} value={d.code ?? ''} onChange={(e) => set('diagnoses', form.diagnoses.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} />
                  <Input placeholder="Diagnosis" disabled={readOnly} value={d.description} onChange={(e) => set('diagnoses', form.diagnoses.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                  <NativeSelect disabled={readOnly} value={d.type ?? 'provisional'} onChange={(e) => set('diagnoses', form.diagnoses.map((x, j) => (j === i ? { ...x, type: e.target.value as Diagnosis['type'] } : x)))}>
                    <option value="provisional">Provisional</option>
                    <option value="final">Final</option>
                  </NativeSelect>
                  {!readOnly ? (
                    <Button variant="ghost" size="icon-sm" onClick={() => set('diagnoses', form.diagnoses.filter((_, j) => j !== i))} aria-label="Remove diagnosis">
                      <Trash2 />
                    </Button>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
              {!readOnly ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {COMMON_DX.filter(([c]) => !form.diagnoses.some((d) => d.code === c)).map(([code, desc]) => (
                    <button
                      key={code}
                      type="button"
                      className="cursor-pointer rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground transition hover:border-primary hover:text-primary"
                      onClick={() => set('diagnoses', [...form.diagnoses.filter((x) => x.description.trim()), { code, description: desc, type: 'provisional' }])}
                    >
                      + {desc}
                    </button>
                  ))}
                </div>
              ) : form.diagnoses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No diagnosis recorded.</p>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard
            title={<span className="flex items-center gap-2"><Pill className="size-4 text-primary" /> Prescription</span>}
            description="Quantity is auto-calculated from frequency × days"
            actions={
              !readOnly ? (
                <Button variant="outline" size="sm" onClick={() => set('prescriptions', [...form.prescriptions, { medicineName: '', dose: '1 tab', frequency: '1-0-1', durationDays: 5, route: 'Oral', instructions: 'After food', quantity: 10 }])}>
                  <Plus /> Add medicine
                </Button>
              ) : null
            }
            bodyClassName="p-0"
          >
            <datalist id="med-catalogue">
              {meds.data?.map((m) => (
                <option key={m.id} value={m.name}>
                  {[m.form, m.strength].filter(Boolean).join(' ')}
                </option>
              ))}
            </datalist>
            {form.prescriptions.length ? (
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Medicine</th>
                      <th className="px-2 py-2 text-left">Dose</th>
                      <th className="px-2 py-2 text-left">Frequency</th>
                      <th className="px-2 py-2 text-left">Days</th>
                      <th className="px-2 py-2 text-left">Instructions</th>
                      <th className="px-2 py-2 text-left">Qty</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {form.prescriptions.map((r, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          <Input
                            list="med-catalogue"
                            disabled={readOnly}
                            value={r.medicineName}
                            placeholder="Search catalogue or type"
                            onChange={(e) => {
                              const m = meds.data?.find((x) => x.name === e.target.value);
                              updateRx(i, { medicineName: e.target.value, medicineId: m?.id ?? null });
                            }}
                          />
                          {r.medicineId ? <span className="mt-0.5 block text-[10px] text-success">In pharmacy catalogue</span> : r.medicineName ? <span className="mt-0.5 block text-[10px] text-muted-foreground">Free text</span> : null}
                        </td>
                        <td className="px-2 py-2">
                          <Input className="w-24" disabled={readOnly} value={r.dose ?? ''} onChange={(e) => updateRx(i, { dose: e.target.value })} />
                        </td>
                        <td className="px-2 py-2">
                          <NativeSelect className="w-24" disabled={readOnly} value={r.frequency ?? ''} onChange={(e) => updateRx(i, { frequency: e.target.value })}>
                            {FREQUENCIES.map(([k]) => (
                              <option key={k}>{k}</option>
                            ))}
                          </NativeSelect>
                        </td>
                        <td className="px-2 py-2">
                          <Input className="w-16" type="number" min={0} disabled={readOnly} value={r.durationDays ?? ''} onChange={(e) => updateRx(i, { durationDays: e.target.value === '' ? null : Number(e.target.value) })} />
                        </td>
                        <td className="px-2 py-2">
                          <NativeSelect className="w-36" disabled={readOnly} value={r.instructions ?? ''} onChange={(e) => updateRx(i, { instructions: e.target.value })}>
                            {['After food', 'Before food', 'Empty stomach', 'At bedtime', 'With milk', 'As directed', ''].map((x) => (
                              <option key={x} value={x}>
                                {x || '—'}
                              </option>
                            ))}
                          </NativeSelect>
                        </td>
                        <td className="px-2 py-2">
                          <Input className="w-16" type="number" min={0} disabled={readOnly} value={r.quantity} onChange={(e) => updateRx(i, { quantity: Number(e.target.value) })} />
                        </td>
                        <td className="px-2 py-2">
                          {!readOnly ? (
                            <Button variant="ghost" size="icon-sm" onClick={() => set('prescriptions', form.prescriptions.filter((_, j) => j !== i))} aria-label="Remove medicine">
                              <Trash2 />
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={Pill} title="No medicines prescribed" />
            )}
          </SectionCard>

          <SectionCard title="Advice & follow-up">
            <div className="grid gap-4 md:grid-cols-[1fr_200px]">
              <Field label="Advice to patient">
                <Textarea rows={3} disabled={readOnly} value={form.advice} onChange={(e) => set('advice', e.target.value)} placeholder="Diet, activity, warning signs…" />
              </Field>
              <Field label="Follow-up date">
                <Input type="date" disabled={readOnly} value={form.followUpDate} onChange={(e) => set('followUpDate', e.target.value)} />
              </Field>
              <Field label="Private notes (not printed)" className="md:col-span-2">
                <Textarea rows={2} disabled={readOnly} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
              </Field>
            </div>
          </SectionCard>
        </div>

        <div className="flex flex-col gap-5">
          {can('lab.order') ? (
            <SectionCard title={<span className="flex items-center gap-2"><FlaskConical className="size-4 text-primary" /> Investigations</span>}>
              {data.labOrders.length ? (
                <div className="mb-3 flex flex-col gap-2">
                  {data.labOrders.map((o) => (
                    <Link key={o.id} to={`/lab/orders/${o.id}`} className="rounded-lg border p-2.5 text-sm hover:bg-muted/40">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{o.orderNo}</span>
                        <StatusBadge status={o.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{o.items.map((i) => i.testName).join(', ')}</p>
                    </Link>
                  ))}
                </div>
              ) : null}
              {data.status === 'draft' && can('opd.write') ? (
                <>
                  <div className="max-h-48 overflow-y-auto rounded-lg border p-2 scrollbar-thin">
                    {tests.data?.map((t) => (
                      <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/50">
                        <Checkbox checked={selectedTests.includes(t.id)} onCheckedChange={(c) => setSelectedTests((s) => (c ? [...s, t.id] : s.filter((x) => x !== t.id)))} />
                        <span className="flex-1">{t.name}</span>
                        <span className="text-xs text-muted-foreground">{f.money(t.price)}</span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <NativeSelect value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className="w-28">
                      <option value="routine">Routine</option>
                      <option value="urgent">Urgent</option>
                      <option value="stat">STAT</option>
                    </NativeSelect>
                    <Button className="flex-1" disabled={!selectedTests.length} loading={orderLab.isPending} onClick={() => orderLab.mutate()}>
                      Order {selectedTests.length || ''} test{selectedTests.length === 1 ? '' : 's'}
                    </Button>
                  </div>
                </>
              ) : null}
            </SectionCard>
          ) : null}

          <SectionCard title={<span className="flex items-center gap-2"><History className="size-4 text-primary" /> Previous visits</span>} bodyClassName="p-0">
            {past.length ? (
              <ul className="divide-y">
                {past.map((h) => (
                  <li key={h.id} className="px-4 py-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{f.date(h.createdAt)}</span>
                      <span>{h.doctorName}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium">{h.diagnoses.map((d) => d.description).join(', ') || h.chiefComplaint || 'Consultation'}</p>
                    {h.vitals?.bpSystolic ? (
                      <p className="text-xs text-muted-foreground">
                        BP {h.vitals.bpSystolic}/{h.vitals.bpDiastolic} · Pulse {h.vitals.pulse ?? '—'}
                      </p>
                    ) : null}
                    {h.prescriptions.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {h.prescriptions.map((r, i) => (
                          <Badge key={i} variant="secondary">
                            {r.medicineName}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    {!readOnly && h.prescriptions.length ? (
                      <button
                        className="mt-1.5 cursor-pointer text-xs text-primary hover:underline"
                        onClick={() => set('prescriptions', [...form.prescriptions, ...h.prescriptions.map(({ id: _id, dispensedQty: _d, ...r }) => r)])}
                      >
                        Repeat prescription
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={History} title="First visit" description="No earlier consultations on record." />
            )}
          </SectionCard>
        </div>
      </div>

      {!readOnly ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/90 backdrop-blur-xl lg:left-64">
          <div className="mx-auto flex max-w-[1500px] items-center justify-end gap-2 px-4 py-3 sm:px-8">
            <span className="mr-auto text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
            <Button variant="outline" loading={save.isPending} onClick={() => save.mutate()}>
              <Save /> Save draft
            </Button>
            <Button variant="success" onClick={() => setConfirmFinal(true)}>
              <CheckCircle2 /> Finalise & complete
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmFinal}
        onOpenChange={setConfirmFinal}
        title="Finalise this consultation?"
        description="The record will be locked, the appointment marked completed and the prescription sent to the pharmacy."
        confirmLabel="Finalise"
        loading={finalize.isPending}
        onConfirm={() => finalize.mutate()}
      />
    </div>
  );
}
