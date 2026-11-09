import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FlaskConical, Plus } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFmt } from '@/lib/format';
import type { Paged, PatientRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
} from '@/components/ui';
import { DataTable, EmptyState, Field, PageHeader, Pagination, PatientPicker, SearchInput, StatusBadge, useDebounced } from '@/components/common';
import { useDoctors } from '../appointments/BookAppointmentDialog';

interface OrderRow {
  id: number;
  orderNo: string;
  status: string;
  priority: string;
  createdAt: string;
  sampleId: string | null;
  patientId: number;
  patientName: string;
  uhid: string;
  doctorName: string | null;
  invoiceStatus: string | null;
  tests: string;
}
interface Test {
  id: number;
  name: string;
  code: string | null;
  category: string | null;
  price: number;
  sampleType: string | null;
}

function NewLabOrderDialog({ open, onOpenChange, patientId }: { open: boolean; onOpenChange: (o: boolean) => void; patientId?: string | null }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const f = useFmt();
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [doctorId, setDoctorId] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [priority, setPriority] = useState('routine');
  const [filter, setFilter] = useState('');
  const doctors = useDoctors();
  const tests = useQuery({ queryKey: ['lab-tests', 'all'], queryFn: () => api.get<Test[]>('/masters/lab-tests', { all: 1, active: 'true' }), enabled: open });
  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setPriority('routine');
    setFilter('');
    if (patientId) api.get<PatientRow>(`/patients/${patientId}`).then(setPatient).catch(() => setPatient(null));
    else setPatient(null);
  }, [open, patientId]);
  const total = tests.data?.filter((t) => selected.includes(t.id)).reduce((s, t) => s + t.price, 0) ?? 0;
  const m = useMutation({
    mutationFn: () => api.post<{ id: number; orderNo: string }>('/lab/orders', { patientId: patient!.id, doctorId: doctorId ? Number(doctorId) : null, testIds: selected, priority }),
    onSuccess: (r) => {
      toast.success(`Lab order ${r.orderNo} created`);
      qc.invalidateQueries({ queryKey: ['lab-orders'] });
      onOpenChange(false);
      navigate(`/lab/orders/${r.id}`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const list = tests.data?.filter((t) => !filter || `${t.name} ${t.code} ${t.category}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>New lab order</DialogTitle>
          <DialogDescription>An invoice is raised automatically when billing is enabled.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Patient" required>
            <PatientPicker value={patient} onChange={setPatient} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Referring doctor">
              <NativeSelect value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
                <option value="">Self / walk-in</option>
                {doctors.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Priority">
              <NativeSelect value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="stat">STAT</option>
              </NativeSelect>
            </Field>
          </div>
          <Input placeholder="Filter tests…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2 scrollbar-thin">
            {list?.map((t) => (
              <label key={t.id} className={cn('flex cursor-pointer items-center gap-2 rounded-md p-2 text-sm hover:bg-muted/50', selected.includes(t.id) && 'bg-primary/8')}>
                <Checkbox checked={selected.includes(t.id)} onCheckedChange={(c) => setSelected((s) => (c ? [...s, t.id] : s.filter((x) => x !== t.id)))} />
                <span className="flex-1">
                  <span className="block font-medium">{t.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {t.category} · {t.sampleType}
                  </span>
                </span>
                <span className="text-xs tabular-nums">{f.money(t.price)}</span>
              </label>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <span className="mr-auto self-center text-sm text-muted-foreground">
            {selected.length} test(s) · <b className="text-foreground">{f.money(total)}</b>
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!patient || !selected.length} loading={m.isPending} onClick={() => m.mutate()}>
            Place order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUSES = [
  ['', 'All'],
  ['ordered', 'To collect'],
  ['sample_collected', 'In process'],
  ['completed', 'To verify'],
  ['verified', 'Reported'],
  ['cancelled', 'Cancelled'],
];

export default function LabPage() {
  const { can } = useAuth();
  const f = useFmt();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data, isLoading } = useQuery({
    queryKey: ['lab-orders', dq, status, page],
    queryFn: () => api.get<Paged<OrderRow>>('/lab/orders', { q: dq, status, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  return (
    <>
      <PageHeader
        icon={FlaskConical}
        title="Laboratory"
        description="Sample collection, result entry, verification and reports"
        actions={
          can('lab.order') ? (
            <Button onClick={() => setParams({ new: '1' })}>
              <Plus /> New order
            </Button>
          ) : null
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Order no, patient or UHID" className="w-full max-w-xs" />
          <div className="flex flex-wrap gap-1">
            {STATUSES.map(([k, l]) => (
              <button
                key={k}
                onClick={() => { setStatus(k); setPage(1); }}
                className={cn('cursor-pointer rounded-full border px-3 py-1 text-xs transition', status === k ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent')}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <DataTable
          rows={data?.data}
          loading={isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/lab/orders/${r.id}`)}
          empty={<EmptyState icon={FlaskConical} title="No lab orders" />}
          columns={[
            {
              key: 'no',
              header: 'Order',
              cell: (r) => (
                <div>
                  <p className="font-mono text-xs font-medium">{r.orderNo}</p>
                  <p className="text-xs text-muted-foreground">{f.dateTime(r.createdAt)}</p>
                </div>
              ),
            },
            {
              key: 'patient',
              header: 'Patient',
              cell: (r) => (
                <div>
                  <p className="font-medium">{r.patientName}</p>
                  <p className="text-xs text-muted-foreground">{r.uhid}</p>
                </div>
              ),
            },
            { key: 'tests', header: 'Tests', cell: (r) => <span className="line-clamp-2 max-w-xs">{r.tests}</span> },
            { key: 'doctor', header: 'Referred by', cell: (r) => r.doctorName ?? 'Self', className: 'hidden lg:table-cell' },
            { key: 'prio', header: 'Priority', cell: (r) => <StatusBadge status={r.priority} /> },
            { key: 'bill', header: 'Bill', cell: (r) => <StatusBadge status={r.invoiceStatus} />, className: 'hidden md:table-cell' },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        {data ? <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
      </Card>
      <NewLabOrderDialog open={params.get('new') === '1'} patientId={params.get('patient')} onOpenChange={(o) => !o && setParams({})} />
    </>
  );
}
