import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BedDouble, Plus, Sparkles, User, Wrench } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { titleCase, useFmt } from '@/lib/format';
import type { Paged, PatientRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
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
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Input,
  NativeSelect,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tip,
} from '@/components/ui';
import { DataTable, EmptyState, Field, PageHeader, Pagination, PatientPicker, SearchInput, StatCard, StatusBadge, useDebounced } from '@/components/common';
import { useDoctors } from '../appointments/BookAppointmentDialog';
import { PAYMENT_METHODS } from '../billing/BillingPage';

export interface BedT {
  id: number;
  bedNo: string;
  status: 'available' | 'occupied' | 'cleaning' | 'maintenance' | 'reserved';
  effectiveRate: number;
  admission: { id: number; admissionNo: string; admittedAt: string; patientId: number; patientName: string; uhid: string; gender: string; doctorName: string } | null;
}
export interface WardT {
  id: number;
  name: string;
  type: string;
  floor: string | null;
  dailyRate: number;
  beds: BedT[];
}
export interface Board {
  summary: Record<string, number>;
  occupancy: number;
  wards: WardT[];
}

const WARD_TYPE: Record<string, string> = { icu: 'ICU', nicu: 'NICU', semi_private: 'Semi-private' };
export const wardType = (t: string) => WARD_TYPE[t] ?? titleCase(t);

const BED_STYLE: Record<BedT['status'], string> = {
  available: 'border-success/40 bg-success/8 hover:bg-success/15 text-success',
  occupied: 'border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/30 hover:bg-primary/90 [&_*]:!text-primary-foreground',
  cleaning: 'border-warning/50 bg-warning/10 text-warning',
  maintenance: 'border-border bg-muted text-muted-foreground',
  reserved: 'border-info/40 bg-info/10 text-info',
};

function AdmitDialog({ open, onOpenChange, bed, patientId }: { open: boolean; onOpenChange: (o: boolean) => void; bed?: BedT | null; patientId?: string | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const f = useFmt();
  const { can } = useAuth();
  const doctors = useDoctors();
  const board = useQuery({ queryKey: ['bed-board'], queryFn: () => api.get<Board>('/ipd/board'), enabled: open });
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [form, setForm] = useState({ doctorId: '', bedId: '', reason: '', provisionalDiagnosis: '', attendantName: '', attendantPhone: '' });
  const [deposit, setDeposit] = useState({ on: false, amount: '', method: 'cash' });
  useEffect(() => {
    if (!open) return;
    setForm({ doctorId: '', bedId: bed ? String(bed.id) : '', reason: '', provisionalDiagnosis: '', attendantName: '', attendantPhone: '' });
    setDeposit({ on: false, amount: '', method: 'cash' });
    if (patientId) api.get<PatientRow>(`/patients/${patientId}`).then(setPatient).catch(() => setPatient(null));
    else setPatient(null);
  }, [open, bed, patientId]);
  const m = useMutation({
    mutationFn: () =>
      api.post<{ id: number; admissionNo: string }>('/ipd/admissions', {
        ...form,
        patientId: patient!.id,
        doctorId: Number(form.doctorId),
        bedId: Number(form.bedId),
        deposit: deposit.on && Number(deposit.amount) > 0 ? { amount: Number(deposit.amount), method: deposit.method } : undefined,
      }),
    onSuccess: (r) => {
      toast.success(`Admitted — ${r.admissionNo}`);
      qc.invalidateQueries({ queryKey: ['bed-board'] });
      qc.invalidateQueries({ queryKey: ['admissions'] });
      onOpenChange(false);
      navigate(`/ipd/admissions/${r.id}`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const s = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Admit patient</DialogTitle>
          <DialogDescription>A running IPD bill opens automatically; bed-days are billed at discharge.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Patient" required className="sm:col-span-2">
            <PatientPicker value={patient} onChange={setPatient} />
          </Field>
          <Field label="Admitting doctor" required>
            <NativeSelect value={form.doctorId} onChange={s('doctorId')}>
              <option value="">Select…</option>
              {doctors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Bed" required>
            <NativeSelect value={form.bedId} onChange={s('bedId')}>
              <option value="">Select available bed…</option>
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
          <Field label="Reason for admission" className="sm:col-span-2">
            <Textarea rows={2} value={form.reason} onChange={s('reason')} />
          </Field>
          <Field label="Provisional diagnosis" className="sm:col-span-2">
            <Input value={form.provisionalDiagnosis} onChange={s('provisionalDiagnosis')} />
          </Field>
          <Field label="Attendant name">
            <Input value={form.attendantName} onChange={s('attendantName')} />
          </Field>
          <Field label="Attendant phone">
            <Input value={form.attendantPhone} onChange={s('attendantPhone')} />
          </Field>
          {can('billing.payment') ? (
            <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3 sm:col-span-2">
              <label className="flex h-9 items-center gap-2 text-sm">
                <Switch checked={deposit.on} onCheckedChange={(on) => setDeposit({ ...deposit, on })} /> Collect advance deposit
              </label>
              {deposit.on ? (
                <>
                  <Input type="number" min={0} placeholder="Amount" className="w-32" value={deposit.amount} onChange={(e) => setDeposit({ ...deposit, amount: e.target.value })} />
                  <NativeSelect value={deposit.method} onChange={(e) => setDeposit({ ...deposit, method: e.target.value })} className="w-32">
                    {PAYMENT_METHODS.map((pm) => (
                      <option key={pm} value={pm}>
                        {pm.toUpperCase()}
                      </option>
                    ))}
                  </NativeSelect>
                </>
              ) : null}
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!patient || !form.doctorId || !form.bedId} loading={m.isPending} onClick={() => m.mutate()}>
            Admit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AdmissionRow {
  id: number;
  admissionNo: string;
  status: string;
  admittedAt: string;
  dischargedAt: string | null;
  provisionalDiagnosis: string | null;
  patientId: number;
  patientName: string;
  uhid: string;
  doctorName: string;
  bedNo: string;
  wardName: string;
}

export default function IpdPage() {
  const { can } = useAuth();
  const f = useFmt();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [admitBed, setAdmitBed] = useState<BedT | null>(null);
  const [admitOpen, setAdmitOpen] = useState(false);
  const [status, setStatus] = useState('admitted');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);

  useEffect(() => {
    if (params.get('admit')) setAdmitOpen(true);
  }, [params]);

  const board = useQuery({ queryKey: ['bed-board'], queryFn: () => api.get<Board>('/ipd/board'), refetchInterval: 30_000 });
  const list = useQuery({
    queryKey: ['admissions', status, dq, page],
    queryFn: () => api.get<Paged<AdmissionRow>>('/ipd/admissions', { status, q: dq, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
  const bedStatus = useMutation({
    mutationFn: ({ id, status: st }: { id: number; status: string }) => api.patch(`/masters/beds/${id}`, { status: st }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bed-board'] }),
    onError: (e) => toast.error(errMsg(e)),
  });

  const sm = board.data?.summary;
  return (
    <>
      <PageHeader
        icon={BedDouble}
        title="In-Patient"
        description="Live bed board, admissions and discharges"
        actions={
          can('ipd.admit') ? (
            <Button
              onClick={() => {
                setAdmitBed(null);
                setAdmitOpen(true);
              }}
            >
              <Plus /> Admit patient
            </Button>
          ) : null
        }
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Occupancy" value={`${board.data?.occupancy ?? 0}%`} hint={`${sm?.occupied ?? 0} of ${sm?.total ?? 0} beds`} icon={BedDouble} loading={board.isLoading} />
        <StatCard label="Available" value={sm?.available ?? 0} icon={Sparkles} tone="success" loading={board.isLoading} />
        <StatCard label="Being cleaned" value={sm?.cleaning ?? 0} icon={Sparkles} tone="warning" loading={board.isLoading} />
        <StatCard label="Under maintenance" value={sm?.maintenance ?? 0} icon={Wrench} tone="danger" loading={board.isLoading} />
      </div>
      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board">Bed board</TabsTrigger>
          <TabsTrigger value="list">Admissions</TabsTrigger>
        </TabsList>
        <TabsContent value="board" className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {(['available', 'occupied', 'cleaning', 'reserved', 'maintenance'] as const).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={cn('size-3 rounded border', BED_STYLE[s])} /> {titleCase(s)}
              </span>
            ))}
          </div>
          {board.data?.wards.length === 0 ? (
            <Card>
              <EmptyState icon={BedDouble} title="No wards configured" description="Add wards and beds under Masters → Wards." />
            </Card>
          ) : null}
          {board.data?.wards.map((w) => (
            <Card key={w.id} className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{w.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {wardType(w.type)} · Floor {w.floor ?? '—'} · {f.money(w.dailyRate)}/day
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {w.beds.filter((b) => b.status === 'occupied').length}/{w.beds.length} occupied
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
                {w.beds.map((b) =>
                  b.admission ? (
                    <Tip key={b.id} content={`${b.admission.admissionNo} · ${b.admission.doctorName}`}>
                      <button onClick={() => navigate(`/ipd/admissions/${b.admission!.id}`)} className={cn('flex cursor-pointer flex-col rounded-lg border p-2.5 text-left transition', BED_STYLE[b.status])}>
                        <span className="flex items-center justify-between text-xs font-semibold">
                          {b.bedNo} <User className="size-3.5" />
                        </span>
                        <span className="mt-1 truncate text-xs font-medium text-foreground">{b.admission.patientName}</span>
                        <span className="text-[10px] text-muted-foreground">since {f.date(b.admission.admittedAt)}</span>
                      </button>
                    </Tip>
                  ) : (
                    <DropdownMenu key={b.id}>
                      <DropdownMenuTrigger asChild>
                        <button className={cn('flex cursor-pointer flex-col rounded-lg border p-2.5 text-left transition', BED_STYLE[b.status])}>
                          <span className="text-xs font-semibold">{b.bedNo}</span>
                          <span className="mt-1 text-[11px] capitalize">{b.status}</span>
                          <span className="text-[10px] text-muted-foreground">{f.money(b.effectiveRate)}/day</span>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuLabel>Bed {b.bedNo}</DropdownMenuLabel>
                        {b.status === 'available' && can('ipd.admit') ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              setAdmitBed(b);
                              setAdmitOpen(true);
                            }}
                          >
                            <Plus /> Admit here
                          </DropdownMenuItem>
                        ) : null}
                        {(['available', 'cleaning', 'reserved', 'maintenance'] as const)
                          .filter((s) => s !== b.status)
                          .map((s) => (
                            <DropdownMenuItem key={s} onSelect={() => bedStatus.mutate({ id: b.id, status: s })}>
                              Mark {s}
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ),
                )}
              </div>
            </Card>
          ))}
        </TabsContent>
        <TabsContent value="list">
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Patient, UHID or IP no." className="w-full max-w-xs" />
              <NativeSelect value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40">
                <option value="admitted">Currently admitted</option>
                <option value="discharged">Discharged</option>
                <option value="">All</option>
              </NativeSelect>
            </div>
            <DataTable
              rows={list.data?.data}
              loading={list.isLoading}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/ipd/admissions/${r.id}`)}
              empty={<EmptyState icon={BedDouble} title="No admissions" />}
              columns={[
                { key: 'no', header: 'IP no.', cell: (r) => <span className="font-mono text-xs">{r.admissionNo}</span> },
                {
                  key: 'p',
                  header: 'Patient',
                  cell: (r) => (
                    <div>
                      <p className="font-medium">{r.patientName}</p>
                      <p className="text-xs text-muted-foreground">{r.uhid}</p>
                    </div>
                  ),
                },
                { key: 'bed', header: 'Ward / bed', cell: (r) => `${r.wardName} · ${r.bedNo}` },
                { key: 'doc', header: 'Doctor', cell: (r) => r.doctorName, className: 'hidden md:table-cell' },
                { key: 'adm', header: 'Admitted', cell: (r) => f.date(r.admittedAt) },
                { key: 'dis', header: 'Discharged', cell: (r) => (r.dischargedAt ? f.date(r.dischargedAt) : '—'), className: 'hidden lg:table-cell' },
                { key: 'st', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
            {list.data ? <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} /> : null}
          </Card>
        </TabsContent>
      </Tabs>
      <AdmitDialog
        open={admitOpen}
        bed={admitBed}
        patientId={params.get('admit')}
        onOpenChange={(o) => {
          setAdmitOpen(o);
          if (!o && params.get('admit')) setParams({});
        }}
      />
    </>
  );
}
