import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, CalendarCheck, Stethoscope, Video } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDaysStr, fmtDate, fmtTime, todayIn, useFmt } from '@/lib/format';
import type { SlotDay } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Avatar, Badge, Button, Card, Skeleton, Textarea } from '@/components/ui';
import { EmptyState, SearchInput } from '@/components/common';

interface PDoctor {
  id: number;
  name: string;
  specialization: string | null;
  qualification: string | null;
  experienceYears: number;
  consultationFee: number;
  photoUrl: string | null;
  bio: string | null;
  telehealthEnabled: boolean;
  departmentName: string | null;
}

export default function PortalBook() {
  const f = useFmt();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { session } = useAuth();
  const tz = session?.settings?.locale.timezone ?? 'Asia/Kolkata';
  const today = todayIn(tz);
  const windowDays = Math.min(session?.settings?.appointments.bookingWindowDays ?? 14, 14);
  const [q, setQ] = useState('');
  const [doctor, setDoctor] = useState<PDoctor | null>(null);
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<string | null>(null);
  const [mode, setMode] = useState<'in_person' | 'video'>('in_person');
  const [reason, setReason] = useState('');
  const doctors = useQuery({ queryKey: ['portal-doctors'], queryFn: () => api.get<PDoctor[]>('/portal/doctors') });
  const slots = useQuery({ queryKey: ['portal-slots', doctor?.id, date], queryFn: () => api.get<SlotDay>(`/portal/doctors/${doctor!.id}/slots`, { date }), enabled: Boolean(doctor) });
  const book = useMutation({
    mutationFn: () => api.post<{ appointmentNo: string; tokenNo: number }>('/portal/appointments', { doctorId: doctor!.id, date, startTime: slot, mode, reason: reason || null }),
    onSuccess: (r) => {
      toast.success('Appointment confirmed!', { description: `${r.appointmentNo} · Token #${r.tokenNo}` });
      qc.invalidateQueries({ queryKey: ['portal-appts'] });
      navigate('/portal');
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const days = useMemo(() => Array.from({ length: windowDays + 1 }, (_, i) => addDaysStr(today, i)), [today, windowDays]);
  const list = doctors.data?.filter((d) => !q || `${d.name} ${d.specialization} ${d.departmentName}`.toLowerCase().includes(q.toLowerCase()));

  if (!doctor) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Book an appointment</h1>
          <p className="text-sm text-muted-foreground">Choose a doctor to see available times.</p>
        </div>
        <SearchInput value={q} onChange={setQ} placeholder="Search by doctor, specialty or department" />
        {doctors.isLoading ? <Skeleton className="h-48 w-full" /> : null}
        <div className="grid gap-3 md:grid-cols-2">
          {list?.map((d) => (
            <Card key={d.id} className="flex cursor-pointer gap-4 p-4 transition hover:border-primary hover:shadow-md" onClick={() => setDoctor(d)}>
              <Avatar name={d.name} src={d.photoUrl} className="size-14" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{d.name}</p>
                <p className="text-sm text-muted-foreground">{d.specialization ?? d.departmentName}</p>
                <p className="text-xs text-muted-foreground">
                  {d.qualification} · {d.experienceYears} yrs exp.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{f.money(d.consultationFee)}</Badge>
                  {d.telehealthEnabled ? (
                    <Badge>
                      <Video /> Video available
                    </Badge>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
        {list && list.length === 0 ? <EmptyState icon={Stethoscope} title="No doctors match your search" /> : null}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Button variant="ghost" size="sm" className="w-fit" onClick={() => { setDoctor(null); setSlot(null); }}>
        <ArrowLeft /> All doctors
      </Button>
      <Card className="flex items-center gap-4 p-4">
        <Avatar name={doctor.name} src={doctor.photoUrl} className="size-14" />
        <div>
          <p className="font-semibold">{doctor.name}</p>
          <p className="text-sm text-muted-foreground">
            {doctor.specialization} · {f.money(doctor.consultationFee)}
          </p>
        </div>
      </Card>
      <div>
        <p className="mb-2 text-sm font-medium">Select a date</p>
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
          {days.map((d) => (
            <button
              key={d}
              onClick={() => { setDate(d); setSlot(null); }}
              className={cn('flex w-16 shrink-0 cursor-pointer flex-col items-center rounded-xl border py-2 transition', date === d ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}
            >
              <span className="text-[10px] uppercase opacity-80">{fmtDate(d, 'EEE')}</span>
              <span className="text-lg font-bold leading-tight">{fmtDate(d, 'dd')}</span>
              <span className="text-[10px] opacity-80">{fmtDate(d, 'MMM')}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Available times</p>
        {slots.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : slots.data?.onLeave ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">The doctor is not available on this day.</p>
        ) : slots.data?.slots.filter((s) => !s.past && s.available > 0).length ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {slots.data.slots
              .filter((s) => !s.past)
              .map((s) => (
                <button
                  key={s.start}
                  disabled={s.available <= 0}
                  onClick={() => setSlot(s.start)}
                  className={cn('cursor-pointer rounded-lg border py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-35', slot === s.start ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary')}
                >
                  {fmtTime(s.start)}
                </button>
              ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No free slots on this day — try another date.</p>
        )}
      </div>
      {doctor.telehealthEnabled ? (
        <div className="flex gap-2">
          {(['in_person', 'video'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cn('flex-1 cursor-pointer rounded-lg border p-3 text-sm font-medium transition', mode === m ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent')}>
              {m === 'video' ? 'Video consultation' : 'Visit the clinic'}
            </button>
          ))}
        </div>
      ) : null}
      <Textarea placeholder="Reason for visit (optional)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
      <Button size="lg" disabled={!slot} loading={book.isPending} onClick={() => book.mutate()}>
        <CalendarCheck /> {slot ? `Confirm ${fmtDate(date, 'EEE dd MMM')} at ${fmtTime(slot)}` : 'Choose a time'}
      </Button>
    </div>
  );
}
