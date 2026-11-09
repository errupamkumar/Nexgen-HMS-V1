import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  BedDouble,
  CalendarDays,
  FlaskConical,
  Globe,
  HeartPulse,
  Mail,
  MapPin,
  MoreHorizontal,
  Pencil,
  Phone,
  Pill,
  Receipt,
  Stethoscope,
  Trash2,
} from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ageOf, fmtTime, titleCase, useFmt } from '@/lib/format';
import type { Diagnosis, Patient, RxItem, Vitals } from '@/lib/types';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { ConfirmDialog, EmptyState, Field, InfoRow, SectionCard, StatusBadge } from '@/components/common';
import { PatientFormDialog } from './PatientForm';
import { BookAppointmentDialog } from '../appointments/BookAppointmentDialog';

interface Timeline {
  appointments: { id: number; appointmentNo: string; date: string; startTime: string; status: string; visitType: string; doctorName: string; tokenNo: number }[];
  encounters: {
    id: number;
    status: string;
    createdAt: string;
    chiefComplaint: string | null;
    diagnoses: Diagnosis[];
    vitals: Vitals;
    advice: string | null;
    followUpDate: string | null;
    doctorName: string;
    prescriptions: RxItem[];
  }[];
  labOrders: { id: number; orderNo: string; status: string; createdAt: string; priority: string; tests: string[] }[];
  invoices: { id: number; invoiceNo: string; type: string; status: string; total: number; balance: number; createdAt: string }[];
  admissions: { id: number; admissionNo: string; status: string; admittedAt: string; dischargedAt: string | null; doctorName: string; bedNo: string; wardName: string }[];
  clinicalAccess: boolean;
}

function PortalAccessDialog({ open, onOpenChange, patient }: { open: boolean; onOpenChange: (o: boolean) => void; patient: Patient }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState(patient.portalAccount?.email ?? patient.email ?? '');
  const [password, setPassword] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/patients/${patient.id}/portal-account`, { email, password }),
    onSuccess: () => {
      toast.success('Portal access saved. Share the credentials with the patient.');
      qc.invalidateQueries({ queryKey: ['patient', String(patient.id)] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Patient portal access</DialogTitle>
          <DialogDescription>Lets {patient.firstName} book online and view prescriptions, lab reports and invoices.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field label="Login email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={patient.portalAccount ? 'New password' : 'Password'} hint="At least 8 characters">
            <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={m.isPending} disabled={!/\S+@\S+\.\S+/.test(email) || password.length < 8} onClick={() => m.mutate()}>
            {patient.portalAccount ? 'Reset access' : 'Create access'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PatientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can, has, session } = useAuth();
  const f = useFmt();
  const [edit, setEdit] = useState(false);
  const [book, setBook] = useState(false);
  const [portal, setPortal] = useState(false);
  const [del, setDel] = useState(false);

  const { data: p, isLoading } = useQuery({ queryKey: ['patient', id], queryFn: () => api.get<Patient>(`/patients/${id}`) });
  const { data: tl } = useQuery({ queryKey: ['patient', id, 'timeline'], queryFn: () => api.get<Timeline>(`/patients/${id}/timeline`) });
  const remove = useMutation({
    mutationFn: () => api.del(`/patients/${id}`),
    onSuccess: () => {
      toast.success('Patient archived');
      qc.invalidateQueries({ queryKey: ['patients'] });
      navigate('/patients');
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (isLoading || !p) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  const age = ageOf(p.dob);
  const customDefs = session?.settings?.patientFields ?? [];
  const lastVitals = tl?.encounters.find((e) => e.vitals && Object.keys(e.vitals).length)?.vitals;

  return (
    <div className="flex flex-col gap-5">
      <Button variant="ghost" size="sm" className="w-fit" onClick={() => navigate(-1)}>
        <ArrowLeft /> Back
      </Button>

      <Card className="overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-primary/80 via-primary/50 to-primary/20" />
        <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="-mt-10 flex items-end gap-4">
            <Avatar name={p.name} className="size-20 border-4 border-card text-xl shadow-md" />
            <div className="pb-1">
              <h1 className="text-xl font-semibold">{p.name}</h1>
              <p className="text-sm text-muted-foreground">
                {p.uhid} · {age !== null ? `${age} yrs` : 'Age —'} · {titleCase(p.gender)}
                {p.bloodGroup ? ` · ${p.bloodGroup}` : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {can('appointments.create') ? (
              <Button onClick={() => setBook(true)}>
                <CalendarDays /> Book visit
              </Button>
            ) : null}
            {can('billing.create') ? (
              <Button variant="outline" asChild>
                <Link to={`/billing?new=1&patient=${p.id}`}>
                  <Receipt /> New bill
                </Link>
              </Button>
            ) : null}
            {can('lab.order') ? (
              <Button variant="outline" asChild>
                <Link to={`/lab?new=1&patient=${p.id}`}>
                  <FlaskConical /> Order lab
                </Link>
              </Button>
            ) : null}
            {can('ipd.admit') ? (
              <Button variant="outline" asChild>
                <Link to={`/ipd?admit=${p.id}`}>
                  <BedDouble /> Admit
                </Link>
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {can('patients.update') ? (
                  <DropdownMenuItem onSelect={() => setEdit(true)}>
                    <Pencil /> Edit details
                  </DropdownMenuItem>
                ) : null}
                {can('patients.update') && has('portal') ? (
                  <DropdownMenuItem onSelect={() => setPortal(true)}>
                    <Globe /> Portal access
                  </DropdownMenuItem>
                ) : null}
                {can('patients.delete') ? (
                  <DropdownMenuItem destructive onSelect={() => setDel(true)}>
                    <Trash2 /> Archive patient
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {p.allergies.length ? (
          <div className="flex flex-wrap items-center gap-2 border-t bg-destructive/5 px-5 py-2.5 text-sm">
            <AlertTriangle className="size-4 text-destructive" />
            <span className="font-medium text-destructive">Allergies:</span>
            {p.allergies.map((a) => (
              <Badge key={a} variant="danger">
                {a}
              </Badge>
            ))}
          </div>
        ) : null}
      </Card>

      <div className="grid gap-5 [&>*]:min-w-0 xl:grid-cols-[340px_1fr]">
        <div className="flex flex-col gap-5">
          <SectionCard title="Contact">
            <div className="flex flex-col gap-2.5 text-sm">
              <p className="flex items-center gap-2">
                <Phone className="size-4 text-muted-foreground" /> {p.phone}
              </p>
              {p.email ? (
                <p className="flex items-center gap-2">
                  <Mail className="size-4 text-muted-foreground" /> {p.email}
                </p>
              ) : null}
              {p.address || p.city ? (
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 text-muted-foreground" />
                  {[p.address, p.city, p.state, p.pincode].filter(Boolean).join(', ')}
                </p>
              ) : null}
            </div>
          </SectionCard>
          <SectionCard title="Details">
            <InfoRow label="Date of birth" value={p.dob ? f.date(p.dob) : null} />
            <InfoRow label="ABHA / National ID" value={p.nationalId} />
            <InfoRow label="Emergency contact" value={p.emergencyName ? `${p.emergencyName} ${p.emergencyPhone ?? ''}` : null} />
            <InfoRow label="Registered" value={f.date(p.createdAt)} />
            <InfoRow label="Portal access" value={p.portalAccount ? <Badge variant="success">Active</Badge> : <span className="text-muted-foreground">Not set up</span>} />
            {customDefs.map((d) => (
              <InfoRow key={d.key} label={d.label} value={p.customFields?.[d.key] as string} />
            ))}
          </SectionCard>
          <SectionCard title="Medical summary">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Chronic conditions</p>
            <div className="mb-4 flex flex-wrap gap-1.5">
              {p.conditions.length ? p.conditions.map((c) => <Badge key={c} variant="info">{c}</Badge>) : <span className="text-sm text-muted-foreground">None recorded</span>}
            </div>
            {lastVitals ? (
              <>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Latest vitals</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    ['BP', lastVitals.bpSystolic ? `${lastVitals.bpSystolic}/${lastVitals.bpDiastolic}` : null],
                    ['Pulse', lastVitals.pulse],
                    ['SpO₂', lastVitals.spo2 ? `${lastVitals.spo2}%` : null],
                    ['Temp', lastVitals.temperature ? `${Number(lastVitals.temperature).toFixed(1)}°` : null],
                    ['Weight', lastVitals.weight ? `${lastVitals.weight} kg` : null],
                    ['BMI', lastVitals.bmi],
                  ].map(([k, v]) => (
                    <div key={k as string} className="rounded-lg bg-muted/50 p-2">
                      <p className="text-[10px] uppercase text-muted-foreground">{k}</p>
                      <p className="text-sm font-semibold">{v ?? '—'}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            {p.notes ? <p className="mt-4 rounded-lg bg-muted/40 p-3 text-sm">{p.notes}</p> : null}
          </SectionCard>
        </div>

        <Tabs defaultValue="visits">
          <TabsList>
            <TabsTrigger value="visits">
              <CalendarDays /> Visits ({tl?.appointments.length ?? 0})
            </TabsTrigger>
            {tl?.clinicalAccess ? (
              <TabsTrigger value="clinical">
                <Stethoscope /> Clinical ({tl.encounters.length})
              </TabsTrigger>
            ) : null}
            {has('lab') ? (
              <TabsTrigger value="lab">
                <FlaskConical /> Lab ({tl?.labOrders.length ?? 0})
              </TabsTrigger>
            ) : null}
            {has('billing') ? (
              <TabsTrigger value="billing">
                <Receipt /> Billing ({tl?.invoices.length ?? 0})
              </TabsTrigger>
            ) : null}
            {has('ipd') ? (
              <TabsTrigger value="ipd">
                <BedDouble /> Admissions ({tl?.admissions.length ?? 0})
              </TabsTrigger>
            ) : null}
          </TabsList>

          <TabsContent value="visits">
            <Card>
              {tl?.appointments.length ? (
                <ul className="divide-y">
                  {tl.appointments.map((a) => (
                    <li key={a.id} className="flex items-center gap-4 px-4 py-3">
                      <div className="w-16 shrink-0 rounded-lg bg-primary/8 py-1.5 text-center">
                        <p className="text-[10px] uppercase text-muted-foreground">{f.date(a.date).split(' ')[1]}</p>
                        <p className="text-lg font-semibold leading-none text-primary">{a.date.slice(8, 10)}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{a.doctorName}</p>
                        <p className="text-xs text-muted-foreground">
                          {a.appointmentNo} · {fmtTime(a.startTime)} · Token #{a.tokenNo} · {titleCase(a.visitType)}
                        </p>
                      </div>
                      <StatusBadge status={a.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={CalendarDays} title="No visits yet" />
              )}
            </Card>
          </TabsContent>

          <TabsContent value="clinical">
            <div className="flex flex-col gap-3">
              {tl?.encounters.length ? (
                tl.encounters.map((e) => (
                  <Card key={e.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{e.diagnoses.map((d) => d.description).join(', ') || e.chiefComplaint || 'Consultation'}</p>
                        <p className="text-xs text-muted-foreground">
                          {e.doctorName} · {f.dateTime(e.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={e.status} />
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/opd/${e.id}`}>Open</Link>
                        </Button>
                      </div>
                    </div>
                    {e.chiefComplaint ? <p className="mt-2 text-sm text-muted-foreground">Complaint: {e.chiefComplaint}</p> : null}
                    {e.prescriptions.length ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {e.prescriptions.map((r, i) => (
                          <Badge key={i} variant="secondary">
                            <Pill /> {r.medicineName} {r.frequency ? `· ${r.frequency}` : ''}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </Card>
                ))
              ) : (
                <Card>
                  <EmptyState icon={HeartPulse} title="No consultations recorded" />
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="lab">
            <Card>
              {tl?.labOrders.length ? (
                <ul className="divide-y">
                  {tl.labOrders.map((l) => (
                    <li key={l.id}>
                      <Link to={`/lab/orders/${l.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                        <FlaskConical className="size-4 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{l.tests.join(', ')}</p>
                          <p className="text-xs text-muted-foreground">
                            {l.orderNo} · {f.dateTime(l.createdAt)}
                          </p>
                        </div>
                        {l.priority !== 'routine' ? <StatusBadge status={l.priority} /> : null}
                        <StatusBadge status={l.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={FlaskConical} title="No lab orders" />
              )}
            </Card>
          </TabsContent>

          <TabsContent value="billing">
            <Card>
              {tl?.invoices.length ? (
                <ul className="divide-y">
                  {tl.invoices.map((i) => (
                    <li key={i.id}>
                      <Link to={`/billing/invoices/${i.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                        <Receipt className="size-4 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            {i.invoiceNo} <span className="text-xs font-normal uppercase text-muted-foreground">· {i.type}</span>
                          </p>
                          <p className="text-xs text-muted-foreground">{f.dateTime(i.createdAt)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">{f.money(i.total)}</p>
                          {i.balance > 0 ? <p className="text-xs text-destructive">Due {f.money(i.balance)}</p> : null}
                        </div>
                        <StatusBadge status={i.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={Receipt} title="No invoices" />
              )}
            </Card>
          </TabsContent>

          <TabsContent value="ipd">
            <Card>
              {tl?.admissions.length ? (
                <ul className="divide-y">
                  {tl.admissions.map((a) => (
                    <li key={a.id}>
                      <Link to={`/ipd/admissions/${a.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                        <BedDouble className="size-4 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            {a.wardName} · Bed {a.bedNo}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {a.admissionNo} · {a.doctorName} · {f.date(a.admittedAt)}
                            {a.dischargedAt ? ` → ${f.date(a.dischargedAt)}` : ''}
                          </p>
                        </div>
                        <StatusBadge status={a.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={BedDouble} title="No admissions" />
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <PatientFormDialog open={edit} onOpenChange={setEdit} patient={p} />
      <BookAppointmentDialog
        open={book}
        onOpenChange={setBook}
        patient={{ id: p.id, name: p.name, uhid: p.uhid, gender: p.gender, dob: p.dob, phone: p.phone, firstName: p.firstName, lastName: p.lastName, email: p.email, bloodGroup: p.bloodGroup, city: p.city, allergies: p.allergies }}
      />
      {has('portal') ? <PortalAccessDialog open={portal} onOpenChange={setPortal} patient={p} /> : null}
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={`Archive ${p.name}?`}
        description="The record is hidden from searches but retained for audit. This cannot be undone from the app."
        destructive
        confirmLabel="Archive"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
