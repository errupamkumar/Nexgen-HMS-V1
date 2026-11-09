import { and, asc, eq, gte, lte, notInArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { appointments, doctorLeaves, doctors, doctorSchedules } from '../../db/schema.js';
import type { TenantSettings } from '../../core/settings.js';
import { dayOfWeek, minToTime, nowInTz, timeToMin } from '../../core/util.js';

export interface Slot {
  start: string;
  end: string;
  booked: number;
  capacity: number;
  available: number;
  past: boolean;
}

export interface SlotDay {
  date: string;
  onLeave: boolean;
  leaveReason?: string | null;
  sessions: { startTime: string; endTime: string }[];
  slots: Slot[];
}

type Doctor = typeof doctors.$inferSelect;

export async function getSlots(tx: DbOrTx, tenantId: number, settings: TenantSettings, doctor: Doctor, date: string): Promise<SlotDay> {
  const sessions = await tx
    .select({ startTime: doctorSchedules.startTime, endTime: doctorSchedules.endTime })
    .from(doctorSchedules)
    .where(
      and(eq(doctorSchedules.tenantId, tenantId), eq(doctorSchedules.doctorId, doctor.id), eq(doctorSchedules.dayOfWeek, dayOfWeek(date))),
    )
    .orderBy(asc(doctorSchedules.startTime));

  const [leave] = await tx
    .select()
    .from(doctorLeaves)
    .where(
      and(
        eq(doctorLeaves.tenantId, tenantId),
        eq(doctorLeaves.doctorId, doctor.id),
        lte(doctorLeaves.dateFrom, date),
        gte(doctorLeaves.dateTo, date),
      ),
    )
    .limit(1);

  const counts = await tx
    .select({ start: appointments.startTime, n: sql<number>`COUNT(*)` })
    .from(appointments)
    .where(
      and(
        eq(appointments.tenantId, tenantId),
        eq(appointments.doctorId, doctor.id),
        eq(appointments.date, date),
        notInArray(appointments.status, ['cancelled', 'no_show']),
      ),
    )
    .groupBy(appointments.startTime);
  const booked = new Map(counts.map((c) => [c.start, Number(c.n)]));

  const now = nowInTz(settings.locale.timezone);
  const step = doctor.slotMinutes || settings.appointments.defaultSlotMinutes;
  const slots: Slot[] = [];
  for (const s of sessions) {
    for (let m = timeToMin(s.startTime); m + step <= timeToMin(s.endTime); m += step) {
      const start = minToTime(m);
      const b = booked.get(start) ?? 0;
      const past = date < now.date || (date === now.date && start <= now.time);
      slots.push({
        start,
        end: minToTime(m + step),
        booked: b,
        capacity: doctor.maxPerSlot,
        available: Math.max(0, doctor.maxPerSlot - b),
        past,
      });
    }
  }
  return { date, onLeave: Boolean(leave), leaveReason: leave?.reason ?? null, sessions, slots };
}
