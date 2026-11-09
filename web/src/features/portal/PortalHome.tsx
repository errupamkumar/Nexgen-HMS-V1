import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, CalendarPlus, ClipboardList, FlaskConical, MapPin, Phone, Pill, Receipt, Video } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { fmtTime, todayIn, useFmt } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card } from '@/components/ui';
import { ConfirmDialog, EmptyState, SectionCard, StatusBadge } from '@/components/common';

export interface PortalMe {
  patient: { id: number; name: string; uhid: string; phone: string; bloodGroup: string | null; allergies: string[] };
  clinic: { name: string; phone: string | null; address: string | null; city: string | null };
  onlineBooking: boolean;
}
export interface PortalAppt {
  id: number;
  appointmentNo: string;
  date: string;
  startTime: string;
  tokenNo: number;
  status: string;
  mode: string;
  visitType: string;
  fee: number;
  doctorName: string;
  specialization: string | null;
  departmentName: string | null;
}

export default function PortalHome() {
  const f = useFmt();
  const qc = useQueryClient();
  const { session } = useAuth();
  const today = todayIn(session?.settings?.locale.timezone ?? 'Asia/Kolkata');
  const me = useQuery({ queryKey: ['portal-me'], queryFn: () => api.get<PortalMe>('/portal/me') });
  const appts = useQuery({ queryKey: ['portal-appts'], queryFn: () => api.get<PortalAppt[]>('/portal/appointments') });
  const [cancelling, setCancelling] = useState<PortalAppt | null>(null);
  const cancel = useMutation({
    mutationFn: (id: number) => api.post(`/portal/appointments/${id}/cancel`),
    onSuccess: () => {
      toast.success('Appointment cancelled');
      setCancelling(null);
      qc.invalidateQueries({ queryKey: ['portal-appts'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const upcoming = (appts.data ?? []).filter((a) => ['booked', 'checked_in'].includes(a.status) && a.date >= today).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  const past = (appts.data ?? []).filter((a) => !upcoming.includes(a));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <Card className="brand-mesh overflow-hidden border-0 p-6 text-white">
        <p className="text-sm text-white/70">Welcome back</p>
        <h1 className="text-2xl font-semibold">{me.data?.patient.name}</h1>
        <p className="mt-1 text-sm text-white/80">
          {me.data?.patient.uhid}
          {me.data?.patient.bloodGroup ? ` · Blood group ${me.data.patient.bloodGroup}` : ''}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {me.data?.onlineBooking ? (
            <Button asChild className="bg-white text-slate-900 hover:bg-white/90">
              <Link to="/portal/book">
                <CalendarPlus /> Book an appointment
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white">
            <Link to="/portal/records">
              <ClipboardList /> My records
            </Link>
          </Button>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['Prescriptions', Pill, '/portal/records?tab=rx'],
          ['Lab reports', FlaskConical, '/portal/records?tab=lab'],
          ['Bills & receipts', Receipt, '/portal/records?tab=bills'],
        ].map(([label, Icon, to]) => {
          const I = Icon as typeof Pill;
          return (
            <Link key={label as string} to={to as string}>
              <Card className="flex items-center gap-3 p-4 transition hover:shadow-md">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <I className="size-5" />
                </div>
                <span className="font-medium">{label as string}</span>
              </Card>
            </Link>
          );
        })}
      </div>

      <SectionCard title="Upcoming appointments" bodyClassName="p-0">
        {upcoming.length ? (
          <ul className="divide-y">
            {upcoming.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-4 px-4 py-4">
                <div className="w-16 rounded-xl bg-primary/10 py-2 text-center text-primary">
                  <p className="text-[10px] uppercase">{f.date(a.date).split(' ')[1]}</p>
                  <p className="text-xl font-bold leading-none">{a.date.slice(8, 10)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{a.doctorName}</p>
                  <p className="text-sm text-muted-foreground">
                    {a.specialization ?? a.departmentName} · {fmtTime(a.startTime)} · Token #{a.tokenNo}
                  </p>
                  <div className="mt-1 flex gap-1.5">
                    {a.mode === 'video' ? (
                      <Badge>
                        <Video /> Video
                      </Badge>
                    ) : null}
                    <StatusBadge status={a.status} />
                  </div>
                </div>
                {a.status === 'booked' ? (
                  <Button variant="outline" size="sm" onClick={() => setCancelling(a)}>
                    Cancel
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={CalendarDays} title="No upcoming appointments" action={me.data?.onlineBooking ? <Button asChild><Link to="/portal/book">Book now</Link></Button> : undefined} />
        )}
      </SectionCard>

      {past.length ? (
        <SectionCard title="Past visits" bodyClassName="p-0">
          <ul className="divide-y">
            {past.slice(0, 10).map((a) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>
                  {f.date(a.date)} · {a.doctorName}
                </span>
                <StatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {me.data?.clinic ? (
        <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
          <span className="font-semibold">{me.data.clinic.name}</span>
          {me.data.clinic.address ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <MapPin className="size-4" /> {me.data.clinic.address}, {me.data.clinic.city}
            </span>
          ) : null}
          {me.data.clinic.phone ? (
            <a href={`tel:${me.data.clinic.phone}`} className="flex items-center gap-1.5 text-primary">
              <Phone className="size-4" /> {me.data.clinic.phone}
            </a>
          ) : null}
        </Card>
      ) : null}

      <ConfirmDialog
        open={Boolean(cancelling)}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this appointment?"
        description={cancelling ? `${cancelling.doctorName} on ${f.date(cancelling.date)} at ${fmtTime(cancelling.startTime)}` : ''}
        destructive
        confirmLabel="Cancel appointment"
        loading={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
      />
    </div>
  );
}
