import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, X } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Patient } from '@/lib/types';
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, NativeSelect, Separator, Textarea } from '@/components/ui';
import { Field, useDebounced } from '@/components/common';

type FormState = {
  firstName: string;
  lastName: string;
  gender: 'male' | 'female' | 'other' | '';
  dob: string;
  age: string;
  phone: string;
  email: string;
  bloodGroup: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  nationalId: string;
  emergencyName: string;
  emergencyPhone: string;
  allergies: string[];
  conditions: string[];
  notes: string;
  customFields: Record<string, unknown>;
};

const empty: FormState = {
  firstName: '',
  lastName: '',
  gender: '',
  dob: '',
  age: '',
  phone: '',
  email: '',
  bloodGroup: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
  nationalId: '',
  emergencyName: '',
  emergencyPhone: '',
  allergies: [],
  conditions: [],
  notes: '',
  customFields: {},
};

function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setText('');
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-2 py-1.5 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25">
      {value.map((v) => (
        <Badge key={v} variant="secondary" className="gap-1">
          {v}
          <button type="button" className="cursor-pointer" onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <input
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
        value={text}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

export function PatientFormDialog({
  open,
  onOpenChange,
  patient,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  patient?: Patient | null;
  onSaved?: (p: { id: number; uhid?: string }) => void;
}) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const fields = session?.settings?.patientFields ?? [];
  const [f, setF] = useState<FormState>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(
      patient
        ? {
            ...empty,
            ...Object.fromEntries(Object.entries(patient).map(([k, v]) => [k, v ?? ''])),
            gender: patient.gender,
            dob: patient.dob ?? '',
            age: '',
            allergies: patient.allergies ?? [],
            conditions: patient.conditions ?? [],
            customFields: patient.customFields ?? {},
          }
        : empty,
    );
  }, [open, patient]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const dPhone = useDebounced(f.phone.trim(), 400);
  const dupes = useQuery({
    queryKey: ['dupes', dPhone],
    queryFn: () => api.get<{ id: number; uhid: string; name: string }[]>('/patients/duplicates', { phone: dPhone }),
    enabled: open && !patient && dPhone.length >= 7,
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        age: f.dob ? undefined : f.age === '' ? undefined : Number(f.age),
        dob: f.dob || null,
        gender: f.gender || undefined,
      };
      return patient ? api.put<{ ok: true }>(`/patients/${patient.id}`, body).then(() => ({ id: patient.id })) : api.post<{ id: number; uhid: string }>('/patients', body);
    },
    onSuccess: (r) => {
      toast.success(patient ? 'Patient updated' : `Patient registered — ${'uhid' in r ? r.uhid : ''}`);
      qc.invalidateQueries({ queryKey: ['patients'] });
      qc.invalidateQueries({ queryKey: ['patient'] });
      onOpenChange(false);
      onSaved?.(r);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.firstName.trim()) errs.firstName = 'Required';
    if (!f.gender) errs.gender = 'Required';
    if (!/^\+?[0-9 -]{7,20}$/.test(f.phone.trim())) errs.phone = 'Enter a valid phone number';
    for (const cf of fields) {
      const v = f.customFields[cf.key];
      if (cf.required && (v === undefined || v === '')) errs[`cf_${cf.key}`] = 'Required';
    }
    setErrors(errs);
    if (Object.keys(errs).length === 0) save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{patient ? `Edit ${patient.name}` : 'Register new patient'}</DialogTitle>
            <DialogDescription>{patient ? patient.uhid : 'A UHID is generated automatically.'}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-6">
            <Field label="First name" required error={errors.firstName} className="sm:col-span-3">
              <Input autoFocus value={f.firstName} onChange={(e) => set('firstName', e.target.value)} aria-invalid={Boolean(errors.firstName)} />
            </Field>
            <Field label="Last name" className="sm:col-span-3">
              <Input value={f.lastName} onChange={(e) => set('lastName', e.target.value)} />
            </Field>
            <Field label="Gender" required error={errors.gender} className="sm:col-span-2">
              <NativeSelect value={f.gender} onChange={(e) => set('gender', e.target.value as FormState['gender'])} aria-invalid={Boolean(errors.gender)}>
                <option value="">Select…</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </NativeSelect>
            </Field>
            <Field label="Date of birth" className="sm:col-span-2">
              <Input type="date" value={f.dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set('dob', e.target.value)} />
            </Field>
            <Field label="or Age (years)" className="sm:col-span-2">
              <Input type="number" min={0} max={130} value={f.age} disabled={Boolean(f.dob)} onChange={(e) => set('age', e.target.value)} />
            </Field>
            <Field label="Mobile" required error={errors.phone} className="sm:col-span-3">
              <Input value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98xxxxxxxx" aria-invalid={Boolean(errors.phone)} />
            </Field>
            <Field label="Email" className="sm:col-span-3">
              <Input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
            </Field>
            {dupes.data?.length ? (
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs sm:col-span-6">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                <div>
                  <p className="font-medium">Possible duplicate — this number is already registered to:</p>
                  <p className="mt-0.5 text-muted-foreground">{dupes.data.map((d) => `${d.name} (${d.uhid})`).join(', ')}</p>
                </div>
              </div>
            ) : null}
            <Field label="Blood group" className="sm:col-span-2">
              <NativeSelect value={f.bloodGroup} onChange={(e) => set('bloodGroup', e.target.value)}>
                <option value="">Unknown</option>
                {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="ABHA / National ID" className="sm:col-span-4">
              <Input value={f.nationalId} onChange={(e) => set('nationalId', e.target.value)} placeholder="14-digit ABHA number" />
            </Field>
            <Field label="Allergies" hint="Press Enter to add" className="sm:col-span-3">
              <TagInput value={f.allergies} onChange={(v) => set('allergies', v)} placeholder="e.g. Penicillin" />
            </Field>
            <Field label="Chronic conditions" hint="Press Enter to add" className="sm:col-span-3">
              <TagInput value={f.conditions} onChange={(v) => set('conditions', v)} placeholder="e.g. Diabetes" />
            </Field>
            <Separator className="sm:col-span-6" />
            <Field label="Address" className="sm:col-span-6">
              <Input value={f.address} onChange={(e) => set('address', e.target.value)} />
            </Field>
            <Field label="City" className="sm:col-span-2">
              <Input value={f.city} onChange={(e) => set('city', e.target.value)} />
            </Field>
            <Field label="State" className="sm:col-span-2">
              <Input value={f.state} onChange={(e) => set('state', e.target.value)} />
            </Field>
            <Field label="PIN code" className="sm:col-span-2">
              <Input value={f.pincode} onChange={(e) => set('pincode', e.target.value)} />
            </Field>
            <Field label="Emergency contact" className="sm:col-span-3">
              <Input value={f.emergencyName} onChange={(e) => set('emergencyName', e.target.value)} />
            </Field>
            <Field label="Emergency phone" className="sm:col-span-3">
              <Input value={f.emergencyPhone} onChange={(e) => set('emergencyPhone', e.target.value)} />
            </Field>
            {fields.length ? (
              <>
                <Separator className="sm:col-span-6" />
                <p className="text-xs font-semibold text-muted-foreground sm:col-span-6">Additional details</p>
                {fields.map((cf) => (
                  <Field key={cf.key} label={cf.label} required={cf.required} error={errors[`cf_${cf.key}`]} className="sm:col-span-3">
                    {cf.type === 'select' ? (
                      <NativeSelect value={String(f.customFields[cf.key] ?? '')} onChange={(e) => set('customFields', { ...f.customFields, [cf.key]: e.target.value })}>
                        <option value="">Select…</option>
                        {cf.options?.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <Input
                        type={cf.type === 'number' ? 'number' : cf.type === 'date' ? 'date' : 'text'}
                        value={String(f.customFields[cf.key] ?? '')}
                        onChange={(e) => set('customFields', { ...f.customFields, [cf.key]: e.target.value })}
                      />
                    )}
                  </Field>
                ))}
              </>
            ) : null}
            <Field label="Notes" className="sm:col-span-6">
              <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {patient ? 'Save changes' : 'Register patient'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
