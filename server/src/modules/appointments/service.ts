import { and, count, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { appointments, doctors, invoices, patients } from '../../db/schema.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { notify, sendPatientMessage } from '../../core/notify.js';
import type { TenantSettings } from '../../core/settings.js';
import { addDays, minToTime, nextNumber, nowInTz, timeToMin } from '../../core/util.js';
import { createInvoice, type LineInput } from '../billing/service.js';
import { getSlots } from './slots.js';

export interface BookCtx {
  tenantId: number;
  userId: number;
  settings: TenantSettings;
  modules: Set<string>;
}

export interface BookInput {
  patientId: number;
  doctorId: number;
  date?: string;
  startTime?: string;
  mode: 'in_person' | 'video';
  source: 'walk_in' | 'phone' | 'desk' | 'portal';
  reason?: string | null;
  notes?: string | null;
  walkIn?: boolean;
}

export const ACTIVE_STATUSES = ['booked', 'checked_in', 'in_consultation'] as const;

/** Allowed status transitions (APT-6). */
export const TRANSITIONS: Record<string, string[]> = {
  booked: ['checked_in', 'in_consultation', 'cancelled', 'no_show'],
  checked_in: ['in_consultation', 'cancelled', 'no_show', 'booked'],
  in_consultation: ['completed', 'checked_in'],
  completed: [],
  cancelled: [],
  no_show: ['booked'],
};

async function lockDoctor(tx: Tx, tenantId: number, doctorId: number) {
  // Row lock serialises concurrent bookings for the same doctor (BR-5).
  const [doctor] = await tx
    .select()
    .from(doctors)
    .where(and(eq(doctors.id, doctorId), eq(doctors.tenantId, tenantId)))
    .for('update');
  if (!doctor) throw notFound('Doctor');
  if (!doctor.isActive) throw badRequest('This doctor is not accepting appointments');
  return doctor;
}

/** Validates that `date/startTime` is a bookable slot; returns the slot end time. */
async function validateSlot(
  tx: Tx,
  ctx: BookCtx,
  doctor: typeof doctors.$inferSelect,
  date: string,
  startTime: string,
  excludeAppointmentId?: number,
) {
  const today = nowInTz(ctx.settings.locale.timezone).date;
  if (date < today) throw badRequest('Cannot book an appointment in the past');
  if (date > addDays(today, ctx.settings.appointments.bookingWindowDays)) {
    throw badRequest(`Appointments can be booked up to ${ctx.settings.appointments.bookingWindowDays} days ahead`);
  }
  const day = await getSlots(tx, ctx.tenantId, ctx.settings, doctor, date);
  if (day.onLeave) throw badRequest(`${doctor.name} is on leave on ${date}${day.leaveReason ? ` (${day.leaveReason})` : ''}`);
  const slot = day.slots.find((s) => s.start === startTime);
  if (!slot) throw badRequest(`${startTime.slice(0, 5)} is not within ${doctor.name}'s schedule on ${date}`);
  if (slot.past) throw badRequest('That slot has already started. Please choose a later time.');
  let booked = slot.booked;
  if (excludeAppointmentId) {
    const [self] = await tx
      .select({ n: count() })
      .from(appointments)
      .where(and(eq(appointments.id, excludeAppointmentId), eq(appointments.date, date), eq(appointments.startTime, startTime)));
    booked -= self.n;
  }
  if (booked >= slot.capacity && !ctx.settings.appointments.allowOverbooking) {
    throw conflict('This slot is fully booked. Please choose another time.');
  }
  return slot.end;
}

export async function bookAppointment(tx: Tx, ctx: BookCtx, input: BookInput) {
  // Lock first: every read below must happen after we own the doctor's booking lock.
  const doctor = await lockDoctor(tx, ctx.tenantId, input.doctorId);
  const [patient] = await tx
    .select()
    .from(patients)
    .where(and(eq(patients.id, input.patientId), eq(patients.tenantId, ctx.tenantId), eq(patients.isDeleted, false)));
  if (!patient) throw notFound('Patient');
  const now = nowInTz(ctx.settings.locale.timezone);

  let date: string;
  let startTime: string;
  let endTime: string;
  if (input.walkIn) {
    if (!ctx.settings.appointments.allowWalkIn) throw badRequest('Walk-in registrations are disabled');
    date = now.date;
    const m = timeToMin(now.time);
    startTime = minToTime(m);
    endTime = minToTime(Math.min(m + doctor.slotMinutes, 23 * 60 + 59));
  } else {
    if (!input.date || !input.startTime) throw badRequest('Date and slot are required');
    date = input.date;
    startTime = input.startTime;
    endTime = await validateSlot(tx, ctx, doctor, date, startTime);
  }

  const [dup] = await tx
    .select({ id: appointments.id, no: appointments.appointmentNo })
    .from(appointments)
    .where(
      and(
        eq(appointments.tenantId, ctx.tenantId),
        eq(appointments.patientId, patient.id),
        eq(appointments.doctorId, doctor.id),
        eq(appointments.date, date),
        inArray(appointments.status, [...ACTIVE_STATUSES]),
      ),
    )
    .limit(1);
  if (dup) throw conflict(`${patient.firstName} already has an active appointment (${dup.no}) with ${doctor.name} on ${date}`);

  // Follow-up detection (BR-6)
  const [last] = await tx
    .select({ date: appointments.date })
    .from(appointments)
    .where(
      and(
        eq(appointments.tenantId, ctx.tenantId),
        eq(appointments.patientId, patient.id),
        eq(appointments.doctorId, doctor.id),
        eq(appointments.status, 'completed'),
      ),
    )
    .orderBy(desc(appointments.date))
    .limit(1);
  const isFollowUp = Boolean(last && doctor.followUpDays > 0 && date <= addDays(last.date, doctor.followUpDays));
  const fee = isFollowUp ? doctor.followUpFee : doctor.consultationFee;

  const [{ maxToken }] = await tx
    .select({ maxToken: sql<number>`COALESCE(MAX(${appointments.tokenNo}), 0)` })
    .from(appointments)
    .where(and(eq(appointments.tenantId, ctx.tenantId), eq(appointments.doctorId, doctor.id), eq(appointments.date, date)));

  const appointmentNo = await nextNumber(tx, ctx.tenantId, ctx.settings, 'appointment');
  const [r] = await tx.insert(appointments).values({
    tenantId: ctx.tenantId,
    appointmentNo,
    patientId: patient.id,
    doctorId: doctor.id,
    departmentId: doctor.departmentId,
    date,
    startTime,
    endTime,
    tokenNo: Number(maxToken) + 1,
    visitType: isFollowUp ? 'follow_up' : 'new',
    mode: input.mode,
    source: input.walkIn ? 'walk_in' : input.source,
    status: input.walkIn ? 'checked_in' : 'booked',
    checkedInAt: input.walkIn ? new Date() : null,
    fee,
    reason: input.reason ?? null,
    notes: input.notes ?? null,
    createdBy: ctx.userId,
  });
  const appointmentId = r.insertId;

  // Auto-invoice (APT-5)
  let invoice: { id: number; invoiceNo: string } | null = null;
  if (ctx.settings.billing.autoInvoiceOnBooking && ctx.modules.has('billing')) {
    const items: LineInput[] = [];
    if (fee > 0) {
      items.push({
        itemType: 'consultation',
        refId: doctor.id,
        description: `${isFollowUp ? 'Follow-up' : 'Consultation'} — ${doctor.name}`,
        quantity: 1,
        unitPrice: fee,
      });
    }
    const [{ prior }] = await tx
      .select({ prior: count() })
      .from(appointments)
      .where(and(eq(appointments.tenantId, ctx.tenantId), eq(appointments.patientId, patient.id)));
    if (prior === 1 && ctx.settings.billing.registrationFee > 0) {
      items.push({ itemType: 'registration', description: 'New patient registration', quantity: 1, unitPrice: ctx.settings.billing.registrationFee });
    }
    if (items.length) {
      invoice = await createInvoice(tx, ctx, { patientId: patient.id, type: 'opd', items, appointmentId });
      await tx.update(appointments).set({ invoiceId: invoice.id }).where(eq(appointments.id, appointmentId));
    }
  }

  if (input.source === 'portal') {
    await notify(tx, ctx.tenantId, {
      title: 'New online booking',
      body: `${patient.firstName} ${patient.lastName ?? ''} booked ${doctor.name} on ${date} at ${startTime.slice(0, 5)}`,
      link: '/appointments',
      type: 'appointment',
      permission: 'appointments.view',
    });
  }
  if (ctx.settings.notifications.bookingConfirmation) {
    await sendPatientMessage(tx, ctx.tenantId, ctx.settings, {
      patientId: patient.id,
      phone: patient.phone,
      email: patient.email,
      subject: 'Appointment confirmed',
      body: `Dear ${patient.firstName}, your appointment ${appointmentNo} with ${doctor.name} is confirmed for ${date} at ${startTime.slice(0, 5)}. Token #${Number(maxToken) + 1}.`,
      sentBy: ctx.userId,
    });
  }

  return { id: appointmentId, appointmentNo, tokenNo: Number(maxToken) + 1, visitType: isFollowUp ? 'follow_up' : 'new', fee, invoice };
}

export async function rescheduleAppointment(tx: Tx, ctx: BookCtx, id: number, date: string, startTime: string) {
  const [appt] = await tx.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.tenantId, ctx.tenantId)));
  if (!appt) throw notFound('Appointment');
  const doctor = await lockDoctor(tx, ctx.tenantId, appt.doctorId);
  const [fresh] = await tx.select({ status: appointments.status }).from(appointments).where(eq(appointments.id, id));
  if (!['booked', 'checked_in'].includes(fresh.status)) throw conflict(`A ${fresh.status.replace('_', ' ')} appointment cannot be rescheduled`);
  const endTime = await validateSlot(tx, ctx, doctor, date, startTime, id);
  let tokenNo = appt.tokenNo;
  if (date !== appt.date) {
    const [{ maxToken }] = await tx
      .select({ maxToken: sql<number>`COALESCE(MAX(${appointments.tokenNo}), 0)` })
      .from(appointments)
      .where(and(eq(appointments.tenantId, ctx.tenantId), eq(appointments.doctorId, doctor.id), eq(appointments.date, date)));
    tokenNo = Number(maxToken) + 1;
  }
  await tx.update(appointments).set({ date, startTime, endTime, tokenNo, status: 'booked', checkedInAt: null }).where(eq(appointments.id, id));
  return { id, date, startTime, tokenNo };
}

export async function changeStatus(tx: Tx, tenantId: number, id: number, status: string, reason?: string | null) {
  const [appt] = await tx.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.tenantId, tenantId))).for('update');
  if (!appt) throw notFound('Appointment');
  if (appt.status === status) return appt;
  if (!TRANSITIONS[appt.status]?.includes(status)) {
    throw conflict(`Cannot move an appointment from ${appt.status.replace('_', ' ')} to ${status.replace('_', ' ')}`);
  }
  const patch: Partial<typeof appointments.$inferInsert> = { status: status as 'booked' };
  if (status === 'checked_in') patch.checkedInAt = new Date();
  if (status === 'in_consultation') patch.startedAt = new Date();
  if (status === 'completed') patch.completedAt = new Date();
  if (status === 'cancelled') patch.cancelReason = reason ?? null;
  await tx.update(appointments).set(patch).where(eq(appointments.id, id));

  let invoiceNote: string | null = null;
  if ((status === 'cancelled' || status === 'no_show') && appt.invoiceId) {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, appt.invoiceId));
    if (inv && inv.amountPaid <= 0 && inv.status === 'unpaid') {
      await tx
        .update(invoices)
        .set({ status: 'cancelled', cancelReason: `Appointment ${status.replace('_', ' ')}` })
        .where(eq(invoices.id, inv.id));
      invoiceNote = `Invoice ${inv.invoiceNo} cancelled`;
    } else if (inv && inv.amountPaid > 0) {
      invoiceNote = `Invoice ${inv.invoiceNo} has payments — process a refund from Billing if required`;
    }
  }
  return { ...appt, status, invoiceNote };
}

export const activeStatusFilter = notInArray(appointments.status, ['cancelled', 'no_show']);
