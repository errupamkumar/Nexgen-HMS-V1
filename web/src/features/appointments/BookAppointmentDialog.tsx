import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarOff, Footprints, Video } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDaysStr, fmtTime, todayIn, useFmt } from '@/lib/format';
import type { Doctor, PatientRow, SlotDay } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Button,
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
  Switch,
  Textarea,
} from '@/components/ui';
import { Field, PatientPicker } from '@/components/common';
import { PatientFormDialog } from '../patients/PatientForm';

export function useDoctors() {
  return useQuery({ queryKey: ['doctors', 'all'], queryFn: () => api.get<Doctor[]>('/masters/doctors', { all: 1, active: 'true' }), staleTime: 60_000 });
}

export function BookAppointmentDialog({
  open,
  onOpenChange,
  patient: initialPatient,
  onBooked,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  patient?: PatientRow | null;
  onBooked?: () => void;
}) {
  const { session } = useAuth();
  const f = useFmt();
  const qc = useQueryClient();
  const tz = session?.settings?.locale.timezone ?? 'Asia/Kolkata';
  const appt = session?.settings?.appointments;
  const today = todayIn(tz);
  const [patient, setPatient] = useState<PatientRow | null>(initialPatient ?? null);
  const [doctorId, setDoctorId] = useState<string>('');
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState<string | null>(null);
  const [mode, setMode] = useState<'in_person' | 'video'>('in_person');
  const [walkIn, setWalkIn] = useState(false);
  const [reason, setReason] = useState('');
  const [registering, setRegistering] = useState(false);
  const doctors = useDoctors();

  useEffect(() => {
    if (open) {
      setPatient(initialPatient ?? null);
      setSlot(null);
      setReason('');
      setWalkIn(false);
      setDate(today);
      if (session?.user.doctorId) setDoctorId(String(session.user.doctorId));
    }
  }, [open, initialPatient, today, session?.user.doctorId]);

  const doctor = useMemo(() => doctors.data?.find((d) => String(d.id) === doctorId), [doctors.data, doctorId]);
  const slots = useQuery({
    queryKey: ['slots', doctorId, date],
    queryFn: () => api.get<SlotDay>(`/masters/doctors/${doctorId}/slots`, { date }),
    enabled: open && Boolean(doctorId) && !walkIn,
  });

  const book = useMutation({
    mutationFn: () =>
      api.post<{ appointmentNo: string; tokenNo: number; visitType: string; fee: number }>('/appointments', {
        patientId: patient!.id,
        doctorId: Number(doctorId),
        date: walkIn ? undefined : date,
        startTime: walkIn ? undefined : slot,
        mode,
        reason: reason || null,
        walkIn,
        source: walkIn ? 'walk_in' : 'desk',
      }),
    onSuccess: (r) => {
      toast.success(`Booked ${r.appointmentNo} · Token #${r.tokenNo}`, {
        description: `${r.visitType === 'follow_up' ? 'Follow-up' : 'New visit'} · Fee ${f.money(r.fee)}`,
      });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['slots'] });
      qc.invalidateQueries({ queryKey: ['patient'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onOpenChange(false);
      onBooked?.();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const sessions = useMemo(() => {
    const groups: { label: string; slots: SlotDay['slots'] }[] = [
      { label: 'Morning', slots: [] },
      { label: 'Afternoon', slots: [] },
      { label: 'Evening', slots: [] },
    ];
    for (const s of slots.data?.slots ?? []) {
      const h = Number(s.start.slice(0, 2));
      groups[h < 12 ? 0 : h < 17 ? 1 : 2].slots.push(s);
    }
    return groups.filter((g) => g.slots.length);
  }, [slots.data]);

  const canSubmit = patient && doctorId && (walkIn || slot);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Book appointment</DialogTitle>
            <DialogDescription>Slots come from each doctor's weekly schedule; full and past slots are disabled.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <Field label="Patient" required>
              <PatientPicker value={patient} onChange={setPatient} onRegisterNew={() => setRegistering(true)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Doctor" required>
                <NativeSelect
                  value={doctorId}
                  onChange={(e) => {
                    setDoctorId(e.target.value);
                    setSlot(null);
                    setMode('in_person');
                  }}
                >
                  <option value="">Select doctor…</option>
                  {doctors.data?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} — {d.departmentName ?? d.specialization}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Date" required={!walkIn}>
                <Input
                  type="date"
                  value={walkIn ? today : date}
                  min={today}
                  max={addDaysStr(today, appt?.bookingWindowDays ?? 30)}
                  disabled={walkIn}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setSlot(null);
                  }}
                />
              </Field>
            </div>
            {doctor ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <span>
                  Fee <b className="text-foreground">{f.money(doctor.consultationFee)}</b> · follow-up <b className="text-foreground">{f.money(doctor.followUpFee)}</b> within {doctor.followUpDays} days
                </span>
                {appt?.allowWalkIn ? (
                  <label className="ml-auto flex cursor-pointer items-center gap-2 text-foreground">
                    <Footprints className="size-4" /> Walk-in now
                    <Switch checked={walkIn} onCheckedChange={setWalkIn} />
                  </label>
                ) : null}
              </div>
            ) : null}

            {doctor && !walkIn ? (
              <div>
                <p className="mb-2 text-xs font-medium text-foreground/80">Available slots</p>
                {slots.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : slots.data?.onLeave ? (
                  <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                    <CalendarOff className="size-4 text-warning" /> {doctor.name} is on leave{slots.data.leaveReason ? ` (${slots.data.leaveReason})` : ''}.
                  </div>
                ) : sessions.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No OPD session on this day.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {sessions.map((g) => (
                      <div key={g.label}>
                        <p className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">{g.label}</p>
                        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                          {g.slots.map((s) => {
                            const disabled = s.past || (s.available <= 0 && !appt?.allowOverbooking);
                            return (
                              <button
                                key={s.start}
                                type="button"
                                disabled={disabled}
                                onClick={() => setSlot(s.start)}
                                className={cn(
                                  'relative cursor-pointer rounded-lg border px-1 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
                                  slot === s.start ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'hover:border-primary hover:text-primary',
                                  !disabled && s.available <= 0 && 'border-warning',
                                )}
                                title={`${s.booked}/${s.capacity} booked`}
                              >
                                {fmtTime(s.start)}
                                {s.capacity > 1 && !s.past ? <span className="block text-[9px] font-normal opacity-70">{s.available} left</span> : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
              <Field label="Mode">
                <NativeSelect value={mode} onChange={(e) => setMode(e.target.value as 'in_person' | 'video')}>
                  <option value="in_person">In person</option>
                  {doctor?.telehealthEnabled ? <option value="video">Video consult</option> : null}
                </NativeSelect>
              </Field>
              <Field label="Reason for visit">
                <Textarea rows={1} className="min-h-9" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fever for 3 days" />
              </Field>
            </div>
            {mode === 'video' ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Video className="size-4" /> A video link is shared with the patient on confirmation.
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!canSubmit} loading={book.isPending} onClick={() => book.mutate()}>
              {walkIn ? 'Register walk-in' : slot ? `Book ${fmtTime(slot)}` : 'Book'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PatientFormDialog
        open={registering}
        onOpenChange={setRegistering}
        onSaved={async (p) => {
          const full = await api.get<PatientRow>(`/patients/${p.id}`);
          setPatient(full);
        }}
      />
    </>
  );
}
