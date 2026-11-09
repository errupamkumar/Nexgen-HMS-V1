import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  LogIn,
  MoreHorizontal,
  Receipt,
  RefreshCw,
  Stethoscope,
  UserX,
  Video,
  XCircle,
} from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDaysStr, ageOf, fmtTime, genderShort, todayIn, useFmt } from '@/lib/format';
import type { AppointmentRow, Paged, SlotDay } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  NativeSelect,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { ConfirmDialog, DataTable, EmptyState, Field, PageHeader, Pagination, SearchInput, StatusBadge, useDebounced } from '@/components/common';
import { BookAppointmentDialog, useDoctors } from './BookAppointmentDialog';

interface Queue {
  date: string;
  summary: Record<string, number>;
  items: AppointmentRow[];
}

const LANES: { key: AppointmentRow['status'][]; label: string; tone: string }[] = [
  { key: ['booked'], label: 'Booked', tone: 'bg-info' },
  { key: ['checked_in'], label: 'Waiting', tone: 'bg-warning' },
  { key: ['in_consultation'], label: 'In consultation', tone: 'bg-primary' },
  { key: ['completed'], label: 'Completed', tone: 'bg-success' },
];

function RescheduleDialog({ appt, onClose }: { appt: AppointmentRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const today = todayIn(session?.settings?.locale.timezone ?? 'Asia/Kolkata');
  const [date, setDate] = useState(appt?.date ?? today);
  const [slot, setSlot] = useState('');
  const slots = useQuery({
    queryKey: ['slots', appt?.doctorId, date],
    queryFn: () => api.get<SlotDay>(`/masters/doctors/${appt!.doctorId}/slots`, { date }),
    enabled: Boolean(appt),
  });
  const m = useMutation({
    mutationFn: () => api.post(`/appointments/${appt!.id}/reschedule`, { date, startTime: slot }),
    onSuccess: () => {
      toast.success('Appointment rescheduled');
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open={Boolean(appt)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Reschedule {appt?.appointmentNo}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="New date">
            <Input
              type="date"
              min={today}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSlot('');
              }}
            />
          </Field>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {slots.data?.onLeave ? <p className="col-span-full text-sm text-warning">Doctor is on leave.</p> : null}
            {slots.data?.slots.map((s) => (
              <button
                key={s.start}
                disabled={s.past || s.available <= 0}
                onClick={() => setSlot(s.start)}
                className={cn('cursor-pointer rounded-lg border py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40', slot === s.start && 'border-primary bg-primary text-primary-foreground')}
              >
                {fmtTime(s.start)}
              </button>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!slot} loading={m.isPending} onClick={() => m.mutate()}>
            Reschedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: number; status: string; reason?: string }) =>
      api.post<{ invoiceNote: string | null }>(`/appointments/${id}/status`, { status, reason }),
    onSuccess: (r, v) => {
      toast.success(`Marked ${v.status.replace('_', ' ')}`, { description: r.invoiceNote ?? undefined });
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

function QueueCard({ a, onReschedule, onCancel }: { a: AppointmentRow; onReschedule: (a: AppointmentRow) => void; onCancel: (a: AppointmentRow) => void }) {
  const { can } = useAuth();
  const f = useFmt();
  const navigate = useNavigate();
  const status = useStatus();
  const start = useMutation({
    mutationFn: () => api.post<{ id: number }>('/opd/encounters', { appointmentId: a.id }),
    onSuccess: (r) => navigate(`/opd/${r.id}`),
    onError: (e) => toast.error(errMsg(e)),
  });
  const age = ageOf(a.dob);
  return (
    <Card className="group p-3 transition hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 text-primary">
          <span className="text-[9px] leading-none">TOKEN</span>
          <span className="text-base font-bold leading-tight">{a.tokenNo}</span>
        </div>
        <div className="min-w-0 flex-1">
          <Link to={`/patients/${a.patientId}`} className="block truncate text-sm font-semibold hover:text-primary">
            {a.patientName}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {a.uhid} · {age ?? '—'}
            {genderShort(a.gender)} · {fmtTime(a.startTime)}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{a.doctorName}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {a.status === 'booked' && can('appointments.update') ? (
              <DropdownMenuItem onSelect={() => onReschedule(a)}>
                <CalendarClock /> Reschedule
              </DropdownMenuItem>
            ) : null}
            {a.invoiceId && can('billing.view') ? (
              <DropdownMenuItem onSelect={() => navigate(`/billing/invoices/${a.invoiceId}`)}>
                <Receipt /> View invoice
              </DropdownMenuItem>
            ) : null}
            {['booked', 'checked_in'].includes(a.status) && can('appointments.update') ? (
              <DropdownMenuItem onSelect={() => status.mutate({ id: a.id, status: 'no_show' })}>
                <UserX /> Mark no-show
              </DropdownMenuItem>
            ) : null}
            {['booked', 'checked_in'].includes(a.status) && can('appointments.cancel') ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={() => onCancel(a)}>
                  <XCircle /> Cancel
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {a.visitType === 'follow_up' ? <Badge variant="info">Follow-up</Badge> : <Badge variant="secondary">New</Badge>}
        {a.mode === 'video' ? (
          <Badge variant="default">
            <Video /> Video
          </Badge>
        ) : null}
        {a.invoiceStatus && a.invoiceStatus !== 'paid' && a.invoiceStatus !== 'cancelled' && (a.invoiceBalance ?? 0) > 0 ? (
          <Badge variant="danger">Due {f.money(a.invoiceBalance)}</Badge>
        ) : a.invoiceStatus === 'paid' ? (
          <Badge variant="success">Paid</Badge>
        ) : null}
      </div>
      {a.reason ? <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{a.reason}</p> : null}
      <div className="mt-3 flex gap-2">
        {a.status === 'booked' && can('appointments.update') ? (
          <Button size="sm" variant="outline" className="flex-1" loading={status.isPending} onClick={() => status.mutate({ id: a.id, status: 'checked_in' })}>
            <LogIn /> Check in
          </Button>
        ) : null}
        {['booked', 'checked_in', 'in_consultation'].includes(a.status) && can('opd.write') ? (
          <Button size="sm" className="flex-1" loading={start.isPending} onClick={() => start.mutate()}>
            <Stethoscope /> {a.status === 'in_consultation' ? 'Resume' : 'Consult'}
          </Button>
        ) : null}
        {a.status === 'in_consultation' && !can('opd.write') && can('appointments.update') ? (
          <Button size="sm" variant="outline" className="flex-1" onClick={() => status.mutate({ id: a.id, status: 'completed' })}>
            <CheckCircle2 /> Mark done
          </Button>
        ) : null}
        {a.status === 'checked_in' && !can('opd.write') && can('appointments.update') ? (
          <Button size="sm" variant="outline" className="flex-1" onClick={() => status.mutate({ id: a.id, status: 'in_consultation' })}>
            Send in
          </Button>
        ) : null}
        {a.invoiceId && (a.invoiceBalance ?? 0) > 0 && a.invoiceStatus !== 'cancelled' && can('billing.payment') ? (
          <Button size="sm" variant="ghost" onClick={() => navigate(`/billing/invoices/${a.invoiceId}?pay=1`)}>
            Collect
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

export default function AppointmentsPage() {
  const { session, can } = useAuth();
  const f = useFmt();
  const [params, setParams] = useSearchParams();
  const tz = session?.settings?.locale.timezone ?? 'Asia/Kolkata';
  const today = todayIn(tz);
  const [date, setDate] = useState(params.get('date') ?? today);
  const [doctorId, setDoctorId] = useState(session?.user.doctorId && session.user.roleCode === 'doctor' ? String(session.user.doctorId) : '');
  const [resched, setResched] = useState<AppointmentRow | null>(null);
  const [cancelling, setCancelling] = useState<AppointmentRow | null>(null);
  const doctors = useDoctors();
  const status = useStatus();
  const booking = params.get('book') === '1';

  const queue = useQuery({
    queryKey: ['queue', date, doctorId],
    queryFn: () => api.get<Queue>('/appointments/queue', { date, doctorId }),
    refetchInterval: 20_000,
  });

  // list tab
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const list = useQuery({
    queryKey: ['appointments', dq, statusFilter, doctorId, page],
    queryFn: () => api.get<Paged<AppointmentRow>>('/appointments', { q: dq, status: statusFilter, doctorId, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });

  const items = queue.data?.items ?? [];
  const closed = items.filter((a) => a.status === 'cancelled' || a.status === 'no_show');

  return (
    <>
      <PageHeader
        icon={CalendarDays}
        title="Appointments"
        description="Live OPD queue with tokens, check-in and consultation hand-off"
        actions={
          can('appointments.create') ? (
            <Button onClick={() => setParams({ book: '1' })}>
              <CalendarPlus /> Book appointment
            </Button>
          ) : null
        }
      />
      <Tabs defaultValue="queue">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="queue">Live queue</TabsTrigger>
            <TabsTrigger value="list">All appointments</TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="w-56">
              <option value="">All doctors</option>
              {doctors.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <TabsContent value="queue">
          <Card className="mb-4 flex flex-wrap items-center gap-3 p-3">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" onClick={() => setDate(addDaysStr(date, -1))} aria-label="Previous day">
                <ChevronLeft />
              </Button>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-40" />
              <Button variant="outline" size="icon-sm" onClick={() => setDate(addDaysStr(date, 1))} aria-label="Next day">
                <ChevronRight />
              </Button>
              {date !== today ? (
                <Button variant="ghost" size="sm" onClick={() => setDate(today)}>
                  Today
                </Button>
              ) : null}
            </div>
            <p className="text-sm font-medium">{f.date(date)}</p>
            <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {LANES.map((l) => (
                <span key={l.label} className="flex items-center gap-1.5">
                  <span className={cn('size-2 rounded-full', l.tone)} /> {l.label} <b className="text-foreground">{items.filter((a) => l.key.includes(a.status)).length}</b>
                </span>
              ))}
              <Button variant="ghost" size="icon-sm" onClick={() => queue.refetch()} aria-label="Refresh">
                <RefreshCw className={cn(queue.isFetching && 'animate-spin')} />
              </Button>
            </div>
          </Card>

          {items.length === 0 && !queue.isLoading ? (
            <Card>
              <EmptyState icon={CalendarDays} title="No appointments for this day" description="Book an appointment or register a walk-in to start the queue." />
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
              {LANES.map((lane) => {
                const laneItems = items.filter((a) => lane.key.includes(a.status));
                return (
                  <div key={lane.label} className="flex min-h-40 flex-col rounded-xl bg-muted/40 p-2.5">
                    <div className="mb-2.5 flex items-center gap-2 px-1">
                      <span className={cn('size-2 rounded-full', lane.tone)} />
                      <span className="text-sm font-semibold">{lane.label}</span>
                      <Badge variant="secondary" className="ml-auto">
                        {laneItems.length}
                      </Badge>
                    </div>
                    <div className="flex flex-col gap-2">
                      {laneItems.map((a) => (
                        <QueueCard key={a.id} a={a} onReschedule={setResched} onCancel={setCancelling} />
                      ))}
                      {laneItems.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">—</p> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {closed.length ? (
            <p className="mt-4 text-xs text-muted-foreground">
              {closed.length} cancelled / no-show: {closed.map((a) => `#${a.tokenNo} ${a.patientName}`).join(', ')}
            </p>
          ) : null}
        </TabsContent>

        <TabsContent value="list">
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Patient, UHID, phone or appointment no." className="w-full max-w-sm" />
              <NativeSelect value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="w-44">
                <option value="">All statuses</option>
                {['booked', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show'].map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <DataTable
              rows={list.data?.data}
              loading={list.isLoading}
              rowKey={(r) => r.id}
              columns={[
                { key: 'no', header: 'Appt #', cell: (r) => <span className="font-mono text-xs">{r.appointmentNo}</span> },
                {
                  key: 'when',
                  header: 'When',
                  cell: (r) => (
                    <div>
                      <p>{f.date(r.date)}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtTime(r.startTime)} · Token #{r.tokenNo}
                      </p>
                    </div>
                  ),
                },
                {
                  key: 'patient',
                  header: 'Patient',
                  cell: (r) => (
                    <Link to={`/patients/${r.patientId}`} className="flex items-center gap-2 hover:text-primary">
                      <Avatar name={r.patientName} className="size-7" />
                      <span>
                        <span className="block font-medium">{r.patientName}</span>
                        <span className="text-xs text-muted-foreground">{r.uhid}</span>
                      </span>
                    </Link>
                  ),
                },
                { key: 'doctor', header: 'Doctor', cell: (r) => <span>{r.doctorName}</span>, className: 'hidden md:table-cell' },
                { key: 'type', header: 'Visit', cell: (r) => (r.visitType === 'follow_up' ? 'Follow-up' : 'New'), className: 'hidden lg:table-cell' },
                { key: 'fee', header: 'Fee', cell: (r) => f.money(r.fee), className: 'hidden lg:table-cell' },
                { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
            {list.data ? <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} /> : null}
          </Card>
        </TabsContent>
      </Tabs>

      <BookAppointmentDialog open={booking} onOpenChange={(o) => !o && setParams({})} />
      {resched ? <RescheduleDialog key={resched.id} appt={resched} onClose={() => setResched(null)} /> : null}
      <ConfirmDialog
        open={Boolean(cancelling)}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={`Cancel ${cancelling?.appointmentNo}?`}
        description={`${cancelling?.patientName} · ${cancelling ? fmtTime(cancelling.startTime) : ''}. An unpaid invoice is cancelled automatically.`}
        destructive
        confirmLabel="Cancel appointment"
        reason={{ label: 'Reason', placeholder: 'e.g. Patient requested' }}
        loading={status.isPending}
        onConfirm={(reason) => status.mutate({ id: cancelling!.id, status: 'cancelled', reason }, { onSuccess: () => setCancelling(null) })}
      />
    </>
  );
}
