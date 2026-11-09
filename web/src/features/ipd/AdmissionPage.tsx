import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRightLeft, LogOut, NotebookPen, Plus, Printer, Receipt, Wallet } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ageOf, ago, titleCase, useFmt } from '@/lib/format';
import type { Invoice, Patient, Vitals } from '@/lib/types';
import {
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
  Input,
  NativeSelect,
  Skeleton,
  Textarea,
} from '@/components/ui';
import { Field, InfoRow, SectionCard, StatusBadge } from '@/components/common';
import { PaymentDialog } from '../billing/InvoicePage';
import type { Board } from './IpdPage';

interface Admission {
  id: number;
  admissionNo: string;
  status: string;
  admittedAt: string;
  dischargedAt: string | null;
  reason: string | null;
  provisionalDiagnosis: string | null;
  attendantName: string | null;
  attendantPhone: string | null;
  dischargeType: string | null;
  dischargeSummary: string | null;
  stayDays: number;
  patient: Patient;
  doctor: { id: number; name: string; specialization: string | null; departmentName: string | null };
  bed: { id: number; bedNo: string; dailyRate: number | null };
  ward: { id: number; name: string; dailyRate: number; type: string };
  notes: { id: number; type: string; note: string; vitals: Vitals | null; createdByName: string | null; createdAt: string }[];
  invoice: Invoice | null;
}

export default function AdmissionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const f = useFmt();
  const { data: a, isLoading } = useQuery({ queryKey: ['admission', id], queryFn: () => api.get<Admission>(`/ipd/admissions/${id}`) });
  const services = useQuery({ queryKey: ['services', 'all'], queryFn: () => api.get<{ id: number; name: string; price: number }[]>('/masters/services', { all: 1, active: 'true' }) });
  const board = useQuery({ queryKey: ['bed-board'], queryFn: () => api.get<Board>('/ipd/board') });

  const [note, setNote] = useState({ type: 'progress', note: '', pulse: '', bp: '', temp: '', spo2: '' });
  const [charge, setCharge] = useState({ open: false, serviceId: '', description: '', quantity: '1', unitPrice: '' });
  const [transfer, setTransfer] = useState({ open: false, bedId: '' });
  const [discharge, setDischarge] = useState({ open: false, type: 'normal', summary: '' });
  const [pay, setPay] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admission', id] });
    qc.invalidateQueries({ queryKey: ['bed-board'] });
  };
  const addNote = useMutation({
    mutationFn: () => {
      const [sys, dia] = note.bp.split('/').map((x) => Number(x.trim()));
      const vitals = note.pulse || note.bp || note.temp || note.spo2 ? { pulse: note.pulse ? Number(note.pulse) : null, bpSystolic: sys || null, bpDiastolic: dia || null, temperature: note.temp ? Number(note.temp) : null, spo2: note.spo2 ? Number(note.spo2) : null } : undefined;
      return api.post(`/ipd/admissions/${id}/notes`, { type: note.type, note: note.note, vitals });
    },
    onSuccess: () => {
      setNote({ type: note.type, note: '', pulse: '', bp: '', temp: '', spo2: '' });
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const addCharge = useMutation({
    mutationFn: () =>
      api.post(`/ipd/admissions/${id}/charges`, {
        serviceId: charge.serviceId ? Number(charge.serviceId) : undefined,
        description: charge.description || undefined,
        quantity: Number(charge.quantity),
        unitPrice: charge.unitPrice ? Number(charge.unitPrice) : undefined,
      }),
    onSuccess: () => {
      toast.success('Charge added to running bill');
      setCharge({ open: false, serviceId: '', description: '', quantity: '1', unitPrice: '' });
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const doTransfer = useMutation({
    mutationFn: () => api.post(`/ipd/admissions/${id}/transfer`, { bedId: Number(transfer.bedId) }),
    onSuccess: () => {
      toast.success('Bed transferred');
      setTransfer({ open: false, bedId: '' });
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const doDischarge = useMutation({
    mutationFn: () => api.post<{ bedDaysBilled: number; total: number }>(`/ipd/admissions/${id}/discharge`, { dischargeType: discharge.type, dischargeSummary: discharge.summary }),
    onSuccess: (r) => {
      toast.success('Patient discharged', { description: `${r.bedDaysBilled} bed-day(s) billed · Final bill ${f.money(r.total)}` });
      setDischarge({ open: false, type: 'normal', summary: '' });
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (isLoading || !a) return <Skeleton className="h-96 w-full" />;
  const active = a.status === 'admitted';
  const inv = a.invoice;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft /> Back
        </Button>
        <div className="flex flex-wrap gap-2">
          {!active ? (
            <Button variant="outline" asChild>
              <Link to={`/print/discharge/${a.id}`} target="_blank">
                <Printer /> Discharge summary
              </Link>
            </Button>
          ) : null}
          {active && can('ipd.admit') ? (
            <Button variant="outline" onClick={() => setTransfer({ open: true, bedId: '' })}>
              <ArrowRightLeft /> Transfer bed
            </Button>
          ) : null}
          {active && can('ipd.discharge') ? (
            <Button variant="destructive" onClick={() => setDischarge({ ...discharge, open: true })}>
              <LogOut /> Discharge
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="grid gap-4 p-5 md:grid-cols-[1fr_auto]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{a.patient.name}</h1>
            <StatusBadge status={a.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {a.admissionNo} · {a.patient.uhid} · {ageOf(a.patient.dob) ?? '—'} yrs · {titleCase(a.patient.gender)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="default">
              {a.ward.name} · Bed {a.bed.bedNo}
            </Badge>
            <Badge variant="secondary">{a.doctor.name}</Badge>
            <Badge variant="outline">Day {a.stayDays}</Badge>
            {a.patient.allergies?.length ? <Badge variant="danger">Allergies: {a.patient.allergies.join(', ')}</Badge> : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          <span className="text-muted-foreground">Admitted</span>
          <span>{f.dateTime(a.admittedAt)}</span>
          {a.dischargedAt ? (
            <>
              <span className="text-muted-foreground">Discharged</span>
              <span>{f.dateTime(a.dischargedAt)}</span>
            </>
          ) : null}
          <span className="text-muted-foreground">Attendant</span>
          <span>{a.attendantName ? `${a.attendantName} ${a.attendantPhone ?? ''}` : '—'}</span>
        </div>
      </Card>

      <div className="grid gap-5 [&>*]:min-w-0 xl:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-5">
          {active && can('ipd.notes') ? (
            <SectionCard title={<span className="flex items-center gap-2"><NotebookPen className="size-4 text-primary" /> Add note</span>}>
              <div className="grid gap-3 sm:grid-cols-4">
                <NativeSelect value={note.type} onChange={(e) => setNote({ ...note, type: e.target.value })}>
                  <option value="progress">Progress note</option>
                  <option value="nursing">Nursing note</option>
                  <option value="procedure">Procedure</option>
                </NativeSelect>
                <Input placeholder="BP 120/80" value={note.bp} onChange={(e) => setNote({ ...note, bp: e.target.value })} />
                <Input placeholder="Pulse" type="number" value={note.pulse} onChange={(e) => setNote({ ...note, pulse: e.target.value })} />
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Temp °C" type="number" step="0.1" value={note.temp} onChange={(e) => setNote({ ...note, temp: e.target.value })} />
                  <Input placeholder="SpO₂" type="number" value={note.spo2} onChange={(e) => setNote({ ...note, spo2: e.target.value })} />
                </div>
                <Textarea className="sm:col-span-4" rows={2} placeholder="Observations, treatment given, plan…" value={note.note} onChange={(e) => setNote({ ...note, note: e.target.value })} />
              </div>
              <div className="mt-3 flex justify-end">
                <Button size="sm" disabled={note.note.trim().length < 2} loading={addNote.isPending} onClick={() => addNote.mutate()}>
                  Add note
                </Button>
              </div>
            </SectionCard>
          ) : null}

          <SectionCard title="Clinical timeline" bodyClassName="p-0">
            {a.reason || a.provisionalDiagnosis ? (
              <div className="border-b px-4 py-3 text-sm">
                {a.provisionalDiagnosis ? <p><span className="text-muted-foreground">Provisional diagnosis:</span> {a.provisionalDiagnosis}</p> : null}
                {a.reason ? <p><span className="text-muted-foreground">Reason:</span> {a.reason}</p> : null}
              </div>
            ) : null}
            <ol className="relative px-4 py-3">
              {a.notes.map((n) => (
                <li key={n.id} className="relative border-l pb-5 pl-5 last:pb-0">
                  <span className={`absolute -left-[5px] top-1 size-2.5 rounded-full ${n.type === 'nursing' ? 'bg-info' : n.type === 'transfer' ? 'bg-warning' : 'bg-primary'}`} />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">{titleCase(n.type)}</Badge>
                    <span>{f.dateTime(n.createdAt)}</span>
                    <span>· {ago(n.createdAt)}</span>
                    {n.createdByName ? <span>· {n.createdByName}</span> : null}
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm">{n.note}</p>
                  {n.vitals ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[n.vitals.bpSystolic ? `BP ${n.vitals.bpSystolic}/${n.vitals.bpDiastolic}` : null, n.vitals.pulse ? `Pulse ${n.vitals.pulse}` : null, n.vitals.temperature ? `Temp ${n.vitals.temperature}°C` : null, n.vitals.spo2 ? `SpO₂ ${n.vitals.spo2}%` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </SectionCard>
          {!active && a.dischargeSummary ? (
            <SectionCard title={`Discharge summary (${titleCase(a.dischargeType)})`}>
              <p className="whitespace-pre-line text-sm">{a.dischargeSummary}</p>
            </SectionCard>
          ) : null}
        </div>

        {inv ? (
          <SectionCard
            title={<span className="flex items-center gap-2"><Receipt className="size-4 text-primary" /> {active ? 'Running bill' : 'Final bill'}</span>}
            description={inv.invoiceNo}
            actions={active && (can('ipd.admit') || can('billing.create')) ? (
              <Button size="sm" variant="outline" onClick={() => setCharge({ ...charge, open: true })}>
                <Plus /> Charge
              </Button>
            ) : null}
            bodyClassName="p-0"
          >
            <ul className="divide-y text-sm">
              {inv.items.map((it) => (
                <li key={it.id} className="flex justify-between gap-2 px-4 py-2">
                  <span>
                    {it.description}
                    {it.quantity !== 1 ? <span className="text-muted-foreground"> × {it.quantity}</span> : null}
                  </span>
                  <span className="tabular-nums">{f.money(it.amount)}</span>
                </li>
              ))}
              {active ? (
                <li className="px-4 py-2 text-xs text-muted-foreground">
                  Bed charges accrue at {f.money(a.bed.dailyRate ?? a.ward.dailyRate)}/day and are added on transfer/discharge.
                </li>
              ) : null}
            </ul>
            <div className="border-t p-4 text-sm">
              <InfoRow label="Total" value={f.money(inv.total)} />
              <InfoRow label="Paid / deposits" value={<span className="text-success">{f.money(inv.amountPaid)}</span>} />
              <InfoRow label={inv.balance < 0 ? 'Refund due' : 'Balance'} value={<span className={inv.balance > 0 ? 'text-destructive' : ''}>{f.money(Math.abs(inv.balance))}</span>} />
              <div className="mt-3 flex gap-2">
                {can('billing.payment') ? (
                  <Button size="sm" variant="success" className="flex-1" onClick={() => setPay(true)}>
                    <Wallet /> {active ? 'Add deposit' : 'Collect'}
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/billing/invoices/${inv.id}`}>Open</Link>
                </Button>
              </div>
            </div>
          </SectionCard>
        ) : null}
      </div>

      <Dialog open={charge.open} onOpenChange={(o) => setCharge({ ...charge, open: o })}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Add charge</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <Field label="Service">
              <NativeSelect value={charge.serviceId} onChange={(e) => setCharge({ ...charge, serviceId: e.target.value })}>
                <option value="">Custom charge…</option>
                {services.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {f.money(s.price)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {!charge.serviceId ? (
              <>
                <Field label="Description" required>
                  <Input value={charge.description} onChange={(e) => setCharge({ ...charge, description: e.target.value })} />
                </Field>
                <Field label="Rate" required>
                  <Input type="number" value={charge.unitPrice} onChange={(e) => setCharge({ ...charge, unitPrice: e.target.value })} />
                </Field>
              </>
            ) : null}
            <Field label="Quantity">
              <Input type="number" min={1} value={charge.quantity} onChange={(e) => setCharge({ ...charge, quantity: e.target.value })} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCharge({ ...charge, open: false })}>
              Cancel
            </Button>
            <Button disabled={!charge.serviceId && (!charge.description || !charge.unitPrice)} loading={addCharge.isPending} onClick={() => addCharge.mutate()}>
              Add to bill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transfer.open} onOpenChange={(o) => setTransfer({ ...transfer, open: o })}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Transfer bed</DialogTitle>
            <DialogDescription>Completed days on the current bed are billed now; the old bed goes to cleaning.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label="New bed">
              <NativeSelect value={transfer.bedId} onChange={(e) => setTransfer({ ...transfer, bedId: e.target.value })}>
                <option value="">Select…</option>
                {board.data?.wards.map((w) => (
                  <optgroup key={w.id} label={`${w.name} (${f.money(w.dailyRate)}/day)`}>
                    {w.beds
                      .filter((b) => b.status === 'available' || b.status === 'reserved')
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.bedNo}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </NativeSelect>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransfer({ ...transfer, open: false })}>
              Cancel
            </Button>
            <Button disabled={!transfer.bedId} loading={doTransfer.isPending} onClick={() => doTransfer.mutate()}>
              Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discharge.open} onOpenChange={(o) => setDischarge({ ...discharge, open: o })}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Discharge {a.patient.name}</DialogTitle>
            <DialogDescription>Remaining bed-days are billed and the bill is issued for payment.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <Field label="Discharge type">
              <NativeSelect value={discharge.type} onChange={(e) => setDischarge({ ...discharge, type: e.target.value })}>
                <option value="normal">Normal (recovered)</option>
                <option value="lama">LAMA — left against medical advice</option>
                <option value="referred">Referred to higher centre</option>
                <option value="absconded">Absconded</option>
                <option value="death">Death</option>
              </NativeSelect>
            </Field>
            <Field label="Discharge summary" required hint="Course in hospital, treatment given, condition at discharge, medications and follow-up advice">
              <Textarea rows={8} value={discharge.summary} onChange={(e) => setDischarge({ ...discharge, summary: e.target.value })} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDischarge({ ...discharge, open: false })}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={discharge.summary.trim().length < 5} loading={doDischarge.isPending} onClick={() => doDischarge.mutate()}>
              Discharge patient
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {inv ? <PaymentDialog invoice={{ ...inv, balance: Math.max(inv.balance, active ? 5000 : inv.balance) }} open={pay} onOpenChange={(o) => { setPay(o); if (!o) refresh(); }} /> : null}
    </div>
  );
}
