import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BedDouble, Building, CalendarOff, ClipboardList, Clock, FlaskConical, Pencil, Pill, Plus, Stethoscope, Trash2, Wrench } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { titleCase, useFmt } from '@/lib/format';
import type { Doctor, LabParameter, Paged } from '@/lib/types';
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
  Input,
  NativeSelect,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/components/ui';
import { ConfirmDialog, DataTable, EmptyState, Field, PageHeader, Pagination, SearchInput, useDebounced } from '@/components/common';
import type { Board } from '../ipd/IpdPage';

// ============================================================ generic master CRUD
type FieldDef = {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'select' | 'switch' | 'textarea';
  options?: [string, string][];
  required?: boolean;
  span?: 1 | 2;
  def?: unknown;
};

function MasterTable<T extends { id: number; isActive?: boolean }>({
  endpoint,
  title,
  fields,
  columns,
  queryKey,
}: {
  endpoint: string;
  title: string;
  fields: FieldDef[];
  columns: { key: string; header: string; cell: (r: T) => React.ReactNode; className?: string }[];
  queryKey: string;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const [editing, setEditing] = useState<Partial<T> | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: [queryKey, dq, page],
    queryFn: () => api.get<Paged<T>>(endpoint, { q: dq, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => (editing?.id ? api.put(`${endpoint}/${editing.id}`, body) : api.post(endpoint, body)),
    onSuccess: () => {
      toast.success(`${title} saved`);
      setEditing(null);
      qc.invalidateQueries({ queryKey: [queryKey] });
      qc.invalidateQueries({ queryKey: [queryKey.replace(/-list$/, ''), 'all'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`${endpoint}/${id}`),
    onSuccess: () => {
      toast.success('Deleted');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: [queryKey] });
    },
    onError: (e) => {
      setDeleting(null);
      toast.error(errMsg(e));
    },
  });

  const [form, setForm] = useState<Record<string, unknown>>({});
  useEffect(() => {
    if (editing) setForm(Object.fromEntries(fields.map((f) => [f.key, (editing as Record<string, unknown>)[f.key] ?? f.def ?? (f.type === 'switch' ? true : '')])));
  }, [editing, fields]);
  const submit = () => {
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      const v = form[f.key];
      body[f.key] = f.type === 'number' ? (v === '' || v === null ? undefined : Number(v)) : f.type === 'switch' ? Boolean(v) : v === '' ? null : v;
    }
    save.mutate(body);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={`Search ${title.toLowerCase()}s…`} className="w-full max-w-xs" />
        <Button className="ml-auto" onClick={() => setEditing({} as Partial<T>)}>
          <Plus /> Add {title.toLowerCase()}
        </Button>
      </div>
      <DataTable
        rows={data?.data}
        loading={isLoading}
        rowKey={(r) => r.id}
        empty={<EmptyState title={`No ${title.toLowerCase()}s yet`} />}
        columns={[
          ...columns,
          ...(fields.some((f) => f.key === 'isActive') ? [{ key: 'active', header: 'Status', cell: (r: T) => (r.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Inactive</Badge>) }] : []),
          {
            key: 'act',
            header: '',
            className: 'w-24 text-right',
            cell: (r: T) => (
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="icon-sm" onClick={() => setEditing(r)} aria-label="Edit">
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setDeleting(r)} aria-label="Delete">
                  <Trash2 />
                </Button>
              </div>
            ),
          },
        ]}
      />
      {data ? <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? 'Edit' : 'Add'} {title.toLowerCase()}
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-3 sm:grid-cols-2">
            {fields.map((fd) => (
              <Field key={fd.key} label={fd.label} required={fd.required} className={fd.span === 2 || fd.type === 'textarea' ? 'sm:col-span-2' : ''}>
                {fd.type === 'select' ? (
                  <NativeSelect value={String(form[fd.key] ?? '')} onChange={(e) => setForm({ ...form, [fd.key]: e.target.value })}>
                    {fd.options?.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                ) : fd.type === 'switch' ? (
                  <div className="flex h-9 items-center">
                    <Switch checked={Boolean(form[fd.key])} onCheckedChange={(v) => setForm({ ...form, [fd.key]: v })} />
                  </div>
                ) : fd.type === 'textarea' ? (
                  <Textarea value={String(form[fd.key] ?? '')} onChange={(e) => setForm({ ...form, [fd.key]: e.target.value })} />
                ) : (
                  <Input type={fd.type === 'number' ? 'number' : 'text'} value={String(form[fd.key] ?? '')} onChange={(e) => setForm({ ...form, [fd.key]: e.target.value })} />
                )}
              </Field>
            ))}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button loading={save.isPending} disabled={fields.some((f) => f.required && !String(form[f.key] ?? '').trim())} onClick={submit}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete this ${title.toLowerCase()}?`}
        description="Records already in use cannot be deleted — deactivate them instead."
        destructive
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </Card>
  );
}

// ============================================================ doctors
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type Session = { dayOfWeek: number; startTime: string; endTime: string };

function ScheduleEditor({ doctor, onClose }: { doctor: Doctor | null; onClose: () => void }) {
  const qc = useQueryClient();
  const f = useFmt();
  const [rows, setRows] = useState<Session[]>([]);
  const [leave, setLeave] = useState({ dateFrom: '', dateTo: '', reason: '' });
  const detail = useQuery({
    queryKey: ['doctor', doctor?.id],
    queryFn: () => api.get<Doctor & { schedule: Session[]; leaves: { id: number; dateFrom: string; dateTo: string; reason: string | null }[] }>(`/masters/doctors/${doctor!.id}`),
    enabled: Boolean(doctor),
  });
  useEffect(() => {
    if (detail.data) setRows(detail.data.schedule.map((s) => ({ dayOfWeek: s.dayOfWeek, startTime: s.startTime.slice(0, 5), endTime: s.endTime.slice(0, 5) })));
  }, [detail.data]);
  const save = useMutation({
    mutationFn: () => api.put(`/masters/doctors/${doctor!.id}/schedule`, { schedule: rows }),
    onSuccess: () => {
      toast.success('Schedule saved');
      qc.invalidateQueries({ queryKey: ['doctors'] });
      qc.invalidateQueries({ queryKey: ['doctor', doctor?.id] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const addLeave = useMutation({
    mutationFn: () => api.post<{ affectedAppointments: number }>(`/masters/doctors/${doctor!.id}/leaves`, { ...leave, reason: leave.reason || null }),
    onSuccess: (r) => {
      toast.success('Leave added', { description: r.affectedAppointments ? `${r.affectedAppointments} booked appointment(s) fall in this period — reschedule them.` : undefined });
      setLeave({ dateFrom: '', dateTo: '', reason: '' });
      qc.invalidateQueries({ queryKey: ['doctor', doctor?.id] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const delLeave = useMutation({
    mutationFn: (leaveId: number) => api.del(`/masters/doctors/${doctor!.id}/leaves/${leaveId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doctor', doctor?.id] }),
  });
  return (
    <Dialog open={Boolean(doctor)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Schedule — {doctor?.name}</DialogTitle>
          <DialogDescription>
            OPD sessions per weekday. Slots of {doctor?.slotMinutes} min, {doctor?.maxPerSlot} patient(s) per slot.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            {DAYS.map((d, day) => {
              const daySessions = rows.map((r, i) => ({ r, i })).filter((x) => x.r.dayOfWeek === day);
              return (
                <div key={d} className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
                  <span className="w-10 text-sm font-medium">{d}</span>
                  {daySessions.length === 0 ? <span className="text-xs text-muted-foreground">Off</span> : null}
                  {daySessions.map(({ r, i }) => (
                    <div key={i} className="flex items-center gap-1 rounded-md bg-muted/50 px-1.5 py-1">
                      <Input type="time" className="h-7 w-28" value={r.startTime} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))} />
                      <span className="text-xs">–</span>
                      <Input type="time" className="h-7 w-28" value={r.endTime} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))} />
                      <Button variant="ghost" size="icon-sm" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Remove session">
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setRows((rs) => [...rs, { dayOfWeek: day, startTime: daySessions.length ? '17:00' : '09:00', endTime: daySessions.length ? '20:00' : '13:00' }])}>
                    <Plus /> Session
                  </Button>
                </div>
              );
            })}
            <Button className="w-fit" loading={save.isPending} onClick={() => save.mutate()}>
              <Clock /> Save weekly schedule
            </Button>
          </div>
          <div className="rounded-lg border p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <CalendarOff className="size-4" /> Leave / unavailability
            </p>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.5fr_auto]">
              <Input type="date" value={leave.dateFrom} onChange={(e) => setLeave({ ...leave, dateFrom: e.target.value, dateTo: leave.dateTo || e.target.value })} />
              <Input type="date" value={leave.dateTo} min={leave.dateFrom} onChange={(e) => setLeave({ ...leave, dateTo: e.target.value })} />
              <Input placeholder="Reason" value={leave.reason} onChange={(e) => setLeave({ ...leave, reason: e.target.value })} />
              <Button variant="outline" disabled={!leave.dateFrom || !leave.dateTo} loading={addLeave.isPending} onClick={() => addLeave.mutate()}>
                Add
              </Button>
            </div>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {detail.data?.leaves.map((l) => (
                <li key={l.id} className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1">
                  <span>
                    {f.date(l.dateFrom)} → {f.date(l.dateTo)} {l.reason ? <span className="text-muted-foreground">· {l.reason}</span> : null}
                  </span>
                  <Button variant="ghost" size="icon-sm" onClick={() => delLeave.mutate(l.id)} aria-label="Remove leave">
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function DoctorsTab() {
  const f = useFmt();
  const [schedFor, setSchedFor] = useState<Doctor | null>(null);
  const departments = useQuery({ queryKey: ['departments', 'all'], queryFn: () => api.get<{ id: number; name: string }[]>('/masters/departments', { all: 1 }) });
  return (
    <>
      <MasterTable<Doctor & { departmentName?: string; schedule?: Session[] }>
        endpoint="/masters/doctors"
        title="Doctor"
        queryKey="doctors-list"
        fields={[
          { key: 'name', label: 'Full name', required: true, span: 2 },
          { key: 'departmentId', label: 'Department', type: 'select', options: [['', '—'], ...(departments.data ?? []).map((d) => [String(d.id), d.name] as [string, string])] },
          { key: 'specialization', label: 'Specialisation' },
          { key: 'qualification', label: 'Qualification' },
          { key: 'registrationNo', label: 'Medical reg. no.' },
          { key: 'experienceYears', label: 'Experience (yrs)', type: 'number', def: 0 },
          { key: 'phone', label: 'Phone' },
          { key: 'consultationFee', label: 'Consultation fee', type: 'number', def: 500 },
          { key: 'followUpFee', label: 'Follow-up fee', type: 'number', def: 250 },
          { key: 'followUpDays', label: 'Follow-up window (days)', type: 'number', def: 7 },
          { key: 'slotMinutes', label: 'Slot length (min)', type: 'number', def: 15 },
          { key: 'maxPerSlot', label: 'Patients per slot', type: 'number', def: 1 },
          { key: 'telehealthEnabled', label: 'Video consults', type: 'switch', def: false },
          { key: 'isActive', label: 'Active', type: 'switch' },
          { key: 'bio', label: 'Profile / bio', type: 'textarea' },
        ]}
        columns={[
          {
            key: 'name',
            header: 'Doctor',
            cell: (r) => (
              <div className="flex items-center gap-3">
                <Avatar name={r.name} />
                <div>
                  <p className="font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">{[r.specialization, r.qualification].filter(Boolean).join(' · ')}</p>
                </div>
              </div>
            ),
          },
          { key: 'dept', header: 'Department', cell: (r) => r.departmentName ?? '—', className: 'hidden md:table-cell' },
          { key: 'fee', header: 'Fee', cell: (r) => `${f.money(r.consultationFee)} / ${f.money(r.followUpFee)}`, className: 'hidden lg:table-cell' },
          {
            key: 'sched',
            header: 'OPD days',
            cell: (r) => (
              <button onClick={() => setSchedFor(r)} className="flex cursor-pointer flex-wrap gap-1">
                {r.schedule?.length ? (
                  [...new Set(r.schedule.map((s) => s.dayOfWeek))].sort().map((d) => (
                    <Badge key={d} variant="secondary">
                      {DAYS[d]}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="warning">Set schedule</Badge>
                )}
              </button>
            ),
          },
          {
            key: 'slot',
            header: 'Slots',
            cell: (r) => (
              <Button variant="outline" size="sm" onClick={() => setSchedFor(r)}>
                <Clock /> {r.slotMinutes}m × {r.maxPerSlot}
              </Button>
            ),
            className: 'hidden md:table-cell',
          },
        ]}
      />
      <ScheduleEditor doctor={schedFor} onClose={() => setSchedFor(null)} />
    </>
  );
}

// ============================================================ lab tests
interface LabTest {
  id: number;
  code: string | null;
  name: string;
  category: string | null;
  sampleType: string | null;
  price: number;
  taxRate: number;
  turnaroundHours: number;
  parameters: LabParameter[];
  isActive: boolean;
}

function LabTestsTab() {
  const qc = useQueryClient();
  const f = useFmt();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [editing, setEditing] = useState<Partial<LabTest> | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['lab-tests-list', dq], queryFn: () => api.get<Paged<LabTest>>('/masters/lab-tests', { q: dq, pageSize: 100 }) });
  const save = useMutation({
    mutationFn: (t: Partial<LabTest>) => {
      const body = {
        code: t.code || null,
        name: t.name,
        category: t.category || null,
        sampleType: t.sampleType || null,
        price: Number(t.price ?? 0),
        taxRate: Number(t.taxRate ?? 0),
        turnaroundHours: Number(t.turnaroundHours ?? 24),
        isActive: t.isActive ?? true,
        parameters: (t.parameters ?? [])
          .filter((p) => p.name.trim())
          .map((p) => ({ ...p, refLow: p.refLow === null || p.refLow === undefined || String(p.refLow) === '' ? null : Number(p.refLow), refHigh: p.refHigh === null || p.refHigh === undefined || String(p.refHigh) === '' ? null : Number(p.refHigh) })),
      };
      return t.id ? api.put(`/masters/lab-tests/${t.id}`, body) : api.post('/masters/lab-tests', body);
    },
    onSuccess: () => {
      toast.success('Test saved');
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['lab-tests-list'] });
      qc.invalidateQueries({ queryKey: ['lab-tests', 'all'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const e = editing;
  const setE = (patch: Partial<LabTest>) => setEditing((x) => ({ ...x, ...patch }));
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search tests…" className="w-full max-w-xs" />
        <Button className="ml-auto" onClick={() => setEditing({ name: '', price: 0, taxRate: 0, turnaroundHours: 24, isActive: true, parameters: [{ name: '', unit: '', refLow: null, refHigh: null }] })}>
          <Plus /> Add test
        </Button>
      </div>
      <DataTable
        rows={data?.data}
        loading={isLoading}
        rowKey={(r) => r.id}
        onRowClick={(r) => setEditing(structuredClone(r))}
        columns={[
          { key: 'code', header: 'Code', cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
          { key: 'name', header: 'Test', cell: (r) => <span className="font-medium">{r.name}</span> },
          { key: 'cat', header: 'Category', cell: (r) => r.category ?? '—', className: 'hidden md:table-cell' },
          { key: 'params', header: 'Parameters', cell: (r) => r.parameters.length },
          { key: 'tat', header: 'TAT', cell: (r) => `${r.turnaroundHours}h`, className: 'hidden md:table-cell' },
          { key: 'price', header: 'Price', cell: (r) => f.money(r.price) },
          { key: 'st', header: 'Status', cell: (r) => (r.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Inactive</Badge>) },
        ]}
      />
      <Dialog open={Boolean(e)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>{e?.id ? 'Edit test' : 'New test'}</DialogTitle>
            <DialogDescription>Reference ranges drive automatic High/Low flagging of results.</DialogDescription>
          </DialogHeader>
          {e ? (
            <DialogBody className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Name" required className="sm:col-span-2">
                  <Input value={e.name ?? ''} onChange={(x) => setE({ name: x.target.value })} />
                </Field>
                <Field label="Code">
                  <Input value={e.code ?? ''} onChange={(x) => setE({ code: x.target.value })} />
                </Field>
                <Field label="Category">
                  <Input value={e.category ?? ''} onChange={(x) => setE({ category: x.target.value })} />
                </Field>
                <Field label="Sample type">
                  <Input value={e.sampleType ?? ''} onChange={(x) => setE({ sampleType: x.target.value })} />
                </Field>
                <Field label="Price">
                  <Input type="number" value={e.price ?? 0} onChange={(x) => setE({ price: Number(x.target.value) })} />
                </Field>
                <Field label="Tax %">
                  <Input type="number" value={e.taxRate ?? 0} onChange={(x) => setE({ taxRate: Number(x.target.value) })} />
                </Field>
                <Field label="Turnaround (hrs)">
                  <Input type="number" value={e.turnaroundHours ?? 24} onChange={(x) => setE({ turnaroundHours: Number(x.target.value) })} />
                </Field>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold">Parameters</p>
                  <Button variant="outline" size="sm" onClick={() => setE({ parameters: [...(e.parameters ?? []), { name: '', unit: '', refLow: null, refHigh: null }] })}>
                    <Plus /> Parameter
                  </Button>
                </div>
                <div className="flex flex-col gap-2">
                  {(e.parameters ?? []).map((p, i) => {
                    const upd = (patch: Partial<LabParameter>) => setE({ parameters: e.parameters!.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                    return (
                      <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_1.5fr_auto]">
                        <Input placeholder="Parameter" value={p.name} onChange={(x) => upd({ name: x.target.value })} />
                        <Input placeholder="Unit" value={p.unit ?? ''} onChange={(x) => upd({ unit: x.target.value })} />
                        <Input placeholder="Low" type="number" value={p.refLow ?? ''} onChange={(x) => upd({ refLow: x.target.value === '' ? null : Number(x.target.value) })} />
                        <Input placeholder="High" type="number" value={p.refHigh ?? ''} onChange={(x) => upd({ refHigh: x.target.value === '' ? null : Number(x.target.value) })} />
                        <Input placeholder="or text e.g. Nil" value={p.refText ?? ''} onChange={(x) => upd({ refText: x.target.value })} />
                        <Button variant="ghost" size="icon-sm" onClick={() => setE({ parameters: e.parameters!.filter((_, j) => j !== i) })} aria-label="Remove parameter">
                          <Trash2 />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={e.isActive ?? true} onCheckedChange={(v) => setE({ isActive: v })} /> Active
              </label>
            </DialogBody>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button loading={save.isPending} disabled={!e?.name?.trim() || !(e?.parameters ?? []).some((p) => p.name.trim())} onClick={() => e && save.mutate(e)}>
              Save test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ============================================================ wards
function WardsTab() {
  const qc = useQueryClient();
  const f = useFmt();
  const board = useQuery({ queryKey: ['bed-board'], queryFn: () => api.get<Board>('/ipd/board') });
  const [ward, setWard] = useState<{ id?: number; name: string; type: string; floor: string; dailyRate: string; bedCount: string; bedPrefix: string; isActive: boolean } | null>(null);
  const [bedFor, setBedFor] = useState<{ wardId: number; bedNo: string } | null>(null);
  const saveWard = useMutation({
    mutationFn: () => {
      const body = { name: ward!.name, type: ward!.type, floor: ward!.floor || null, dailyRate: Number(ward!.dailyRate), isActive: ward!.isActive };
      return ward!.id ? api.put(`/masters/wards/${ward!.id}`, body) : api.post('/masters/wards', { ...body, bedCount: Number(ward!.bedCount || 0), bedPrefix: ward!.bedPrefix || 'B' });
    },
    onSuccess: () => {
      toast.success('Ward saved');
      setWard(null);
      qc.invalidateQueries({ queryKey: ['bed-board'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const addBed = useMutation({
    mutationFn: () => api.post(`/masters/wards/${bedFor!.wardId}/beds`, { bedNo: bedFor!.bedNo }),
    onSuccess: () => {
      setBedFor(null);
      qc.invalidateQueries({ queryKey: ['bed-board'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const delBed = useMutation({
    mutationFn: (id: number) => api.del(`/masters/beds/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bed-board'] }),
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <div className="flex flex-col gap-4">
      <Button className="w-fit" onClick={() => setWard({ name: '', type: 'general', floor: '', dailyRate: '1000', bedCount: '10', bedPrefix: 'B', isActive: true })}>
        <Plus /> Add ward
      </Button>
      {board.data?.wards.map((w) => (
        <Card key={w.id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold">{w.name}</p>
              <p className="text-xs text-muted-foreground">
                {titleCase(w.type)} · Floor {w.floor ?? '—'} · {f.money(w.dailyRate)}/day · {w.beds.length} beds
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setBedFor({ wardId: w.id, bedNo: '' })}>
                <Plus /> Bed
              </Button>
              <Button variant="outline" size="sm" onClick={() => setWard({ id: w.id, name: w.name, type: w.type, floor: w.floor ?? '', dailyRate: String(w.dailyRate), bedCount: '', bedPrefix: '', isActive: true })}>
                <Pencil /> Edit
              </Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {w.beds.map((b) => (
              <Badge key={b.id} variant={b.status === 'occupied' ? 'default' : 'secondary'} className="gap-1.5 py-1">
                {b.bedNo}
                {b.status !== 'occupied' ? (
                  <button className="cursor-pointer opacity-60 hover:opacity-100" onClick={() => delBed.mutate(b.id)} aria-label={`Remove bed ${b.bedNo}`}>
                    <Trash2 className="size-3" />
                  </button>
                ) : null}
              </Badge>
            ))}
          </div>
        </Card>
      ))}
      <Dialog open={Boolean(ward)} onOpenChange={(o) => !o && setWard(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{ward?.id ? 'Edit ward' : 'New ward'}</DialogTitle>
          </DialogHeader>
          {ward ? (
            <DialogBody className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" required className="sm:col-span-2">
                <Input value={ward.name} onChange={(e) => setWard({ ...ward, name: e.target.value })} />
              </Field>
              <Field label="Type">
                <NativeSelect value={ward.type} onChange={(e) => setWard({ ...ward, type: e.target.value })}>
                  {['general', 'semi_private', 'private', 'icu', 'nicu', 'emergency', 'maternity'].map((t) => (
                    <option key={t} value={t}>
                      {titleCase(t)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Floor">
                <Input value={ward.floor} onChange={(e) => setWard({ ...ward, floor: e.target.value })} />
              </Field>
              <Field label="Daily bed rate" required>
                <Input type="number" value={ward.dailyRate} onChange={(e) => setWard({ ...ward, dailyRate: e.target.value })} />
              </Field>
              {!ward.id ? (
                <>
                  <Field label="Number of beds">
                    <Input type="number" min={0} value={ward.bedCount} onChange={(e) => setWard({ ...ward, bedCount: e.target.value })} />
                  </Field>
                  <Field label="Bed prefix" hint="Beds are numbered PREFIX-01, PREFIX-02…">
                    <Input value={ward.bedPrefix} onChange={(e) => setWard({ ...ward, bedPrefix: e.target.value })} />
                  </Field>
                </>
              ) : null}
            </DialogBody>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setWard(null)}>
              Cancel
            </Button>
            <Button disabled={!ward?.name} loading={saveWard.isPending} onClick={() => saveWard.mutate()}>
              Save ward
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(bedFor)} onOpenChange={(o) => !o && setBedFor(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Add bed</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Field label="Bed number">
              <Input value={bedFor?.bedNo ?? ''} onChange={(e) => setBedFor((b) => b && { ...b, bedNo: e.target.value })} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button disabled={!bedFor?.bedNo} loading={addBed.isPending} onClick={() => addBed.mutate()}>
              Add bed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================ page
export default function MastersPage() {
  const { can } = useAuth();
  const f = useFmt();
  return (
    <>
      <PageHeader icon={ClipboardList} title="Masters" description="Configure the catalogues your clinic runs on" />
      <Tabs defaultValue="doctors">
        <TabsList>
          <TabsTrigger value="doctors">
            <Stethoscope /> Doctors
          </TabsTrigger>
          <TabsTrigger value="departments">
            <Building /> Departments
          </TabsTrigger>
          <TabsTrigger value="services">
            <Wrench /> Services & charges
          </TabsTrigger>
          {can('pharmacy.manage') ? (
            <TabsTrigger value="medicines">
              <Pill /> Medicines
            </TabsTrigger>
          ) : null}
          {can('lab.manage') ? (
            <TabsTrigger value="lab">
              <FlaskConical /> Lab tests
            </TabsTrigger>
          ) : null}
          {can('ipd.manage') ? (
            <TabsTrigger value="wards">
              <BedDouble /> Wards & beds
            </TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="doctors">
          <DoctorsTab />
        </TabsContent>
        <TabsContent value="departments">
          <MasterTable<{ id: number; name: string; code: string | null; description: string | null; isActive: boolean }>
            endpoint="/masters/departments"
            title="Department"
            queryKey="departments-list"
            fields={[
              { key: 'name', label: 'Name', required: true },
              { key: 'code', label: 'Code' },
              { key: 'description', label: 'Description', type: 'textarea' },
              { key: 'isActive', label: 'Active', type: 'switch' },
            ]}
            columns={[
              { key: 'name', header: 'Department', cell: (r) => <span className="font-medium">{r.name}</span> },
              { key: 'code', header: 'Code', cell: (r) => r.code ?? '—' },
              { key: 'desc', header: 'Description', cell: (r) => <span className="text-muted-foreground">{r.description ?? ''}</span>, className: 'hidden md:table-cell' },
            ]}
          />
        </TabsContent>
        <TabsContent value="services">
          <MasterTable<{ id: number; code: string | null; name: string; category: string; price: number; taxRate: number; isActive: boolean }>
            endpoint="/masters/services"
            title="Service"
            queryKey="services-list"
            fields={[
              { key: 'name', label: 'Name', required: true, span: 2 },
              { key: 'code', label: 'Code' },
              { key: 'category', label: 'Category', type: 'select', def: 'procedure', options: ['consultation', 'procedure', 'investigation', 'room', 'nursing', 'package', 'other'].map((c) => [c, titleCase(c)]) },
              { key: 'price', label: 'Price', type: 'number', required: true },
              { key: 'taxRate', label: 'Tax %', type: 'number', def: 0 },
              { key: 'isActive', label: 'Active', type: 'switch' },
            ]}
            columns={[
              { key: 'name', header: 'Service', cell: (r) => <span className="font-medium">{r.name}</span> },
              { key: 'code', header: 'Code', cell: (r) => r.code ?? '—', className: 'hidden md:table-cell' },
              { key: 'cat', header: 'Category', cell: (r) => titleCase(r.category) },
              { key: 'price', header: 'Price', cell: (r) => f.money(r.price) },
              { key: 'tax', header: 'Tax', cell: (r) => `${r.taxRate}%`, className: 'hidden md:table-cell' },
            ]}
          />
        </TabsContent>
        <TabsContent value="medicines">
          <MasterTable<{ id: number; name: string; genericName: string | null; form: string | null; strength: string | null; manufacturer: string | null; salePrice: number; reorderLevel: number; isActive: boolean }>
            endpoint="/masters/medicines"
            title="Medicine"
            queryKey="medicines-list"
            fields={[
              { key: 'name', label: 'Brand name', required: true },
              { key: 'genericName', label: 'Generic name' },
              { key: 'form', label: 'Form', type: 'select', def: 'Tablet', options: ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Ointment', 'Gel', 'Drops', 'Sachet', 'Inhaler', 'Other'].map((x) => [x, x]) },
              { key: 'strength', label: 'Strength' },
              { key: 'manufacturer', label: 'Manufacturer' },
              { key: 'category', label: 'Category' },
              { key: 'hsnCode', label: 'HSN code' },
              { key: 'unit', label: 'Unit', def: 'tab' },
              { key: 'salePrice', label: 'Sale price', type: 'number', required: true },
              { key: 'taxRate', label: 'GST %', type: 'number', def: 12 },
              { key: 'reorderLevel', label: 'Reorder level', type: 'number', def: 20 },
              { key: 'isActive', label: 'Active', type: 'switch' },
            ]}
            columns={[
              {
                key: 'name',
                header: 'Medicine',
                cell: (r) => (
                  <div>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{[r.genericName, r.form, r.strength].filter(Boolean).join(' · ')}</p>
                  </div>
                ),
              },
              { key: 'mfr', header: 'Manufacturer', cell: (r) => r.manufacturer ?? '—', className: 'hidden md:table-cell' },
              { key: 'price', header: 'Price', cell: (r) => f.money(r.salePrice) },
              { key: 'reorder', header: 'Reorder at', cell: (r) => r.reorderLevel, className: 'hidden md:table-cell' },
            ]}
          />
        </TabsContent>
        <TabsContent value="lab">
          <LabTestsTab />
        </TabsContent>
        <TabsContent value="wards">
          <WardsTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

