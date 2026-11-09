import { beforeAll, describe, expect, it } from 'vitest';
import { api, as, doctorByName, newPatient, nextWeekday, today } from './helpers.js';

describe('PAT — patients', () => {
  let admin: string;
  beforeAll(async () => {
    admin = await as.admin();
  });

  it('PAT-1/BR-7 assigns sequential UHIDs', async () => {
    const a = await newPatient(admin);
    const b = await newPatient(admin);
    const na = Number(a.uhid.split('-')[1]);
    const nb = Number(b.uhid.split('-')[1]);
    expect(nb).toBe(na + 1);
  });

  it('PAT-1 validates mandatory fields and phone format', async () => {
    expect((await api(admin).post('/api/patients', { gender: 'male', phone: '+91 9000000000' })).status).toBe(422);
    expect((await api(admin).post('/api/patients', { firstName: 'X', gender: 'male', phone: 'abc' })).status).toBe(422);
  });

  it('PAT-2 searches by name, UHID and phone', async () => {
    const p = await newPatient(admin, { firstName: 'Zebulon', phone: '+91 9123401234' });
    for (const q of ['Zebulon', p.uhid, '9123401234']) {
      const r = await api(admin).get(`/api/patients?q=${encodeURIComponent(q)}`);
      expect(r.body.data.some((x: { id: number }) => x.id === p.id)).toBe(true);
    }
  });

  it('PAT-3 surfaces possible duplicates by phone', async () => {
    await newPatient(admin, { firstName: 'Dupe', phone: '+91 9555500001' });
    const r = await api(admin).get(`/api/patients/duplicates?phone=${encodeURIComponent('+91 9555500001')}`);
    expect(r.body.length).toBeGreaterThanOrEqual(1);
  });

  it('PAT-5 edits and soft-deletes (admin only)', async () => {
    const p = await newPatient(admin);
    const upd = await api(admin).put(`/api/patients/${p.id}`, { firstName: 'Edited', gender: 'male', phone: '+91 9000011111', allergies: ['Penicillin'] });
    expect(upd.status).toBe(200);
    expect((await api(admin).get(`/api/patients/${p.id}`)).body.allergies).toEqual(['Penicillin']);
    expect((await api(await as.reception()).del(`/api/patients/${p.id}`)).status).toBe(403);
    expect((await api(admin).del(`/api/patients/${p.id}`)).status).toBe(200);
    expect((await api(admin).get(`/api/patients/${p.id}`)).status).toBe(404);
  });
});

describe('APT — appointments & queue', () => {
  let rec: string;
  let admin: string;
  let ortho: { id: number; consultationFee: number; followUpFee: number };
  let physician: { id: number; consultationFee: number; followUpFee: number };
  const date = nextWeekday(2);

  beforeAll(async () => {
    rec = await as.reception();
    admin = await as.admin();
    ortho = await doctorByName(rec, 'Dr. Vikram Rao'); // capacity 1, 20-min slots
    physician = await doctorByName(rec, 'Dr. Sameer Khan'); // capacity 2, 10-min slots
  });

  it('APT-1 generates slots from the weekly schedule', async () => {
    const r = await api(rec).get(`/api/masters/doctors/${ortho.id}/slots?date=${date}`);
    expect(r.status).toBe(200);
    expect(r.body.onLeave).toBe(false);
    expect(r.body.slots[0].start).toBe('09:00:00');
    expect(r.body.slots[1].start).toBe('09:20:00');
    expect(r.body.slots.every((s: { capacity: number }) => s.capacity === 1)).toBe(true);
  });

  it('APT-2/3 books a valid slot with a token and auto-invoice incl. registration fee (APT-5)', async () => {
    const p = await newPatient(rec);
    const r = await api(rec).post('/api/appointments', { patientId: p.id, doctorId: ortho.id, date, startTime: '10:00' });
    expect(r.status).toBe(201);
    expect(r.body.tokenNo).toBeGreaterThanOrEqual(1);
    expect(r.body.visitType).toBe('new');
    expect(r.body.invoice).toBeTruthy();
    const inv = await api(admin).get(`/api/billing/invoices/${r.body.invoice.id}`);
    expect(inv.body.items.map((i: { itemType: string }) => i.itemType).sort()).toEqual(['consultation', 'registration']);
    expect(inv.body.total).toBe(ortho.consultationFee + 100);
  });

  it('APT-2 rejects past dates, off-schedule times, Sundays and beyond the booking window', async () => {
    const p = await newPatient(rec);
    const past = await api(rec).post('/api/appointments', { patientId: p.id, doctorId: ortho.id, date: '2020-01-06', startTime: '10:00' });
    expect(past.status).toBe(400);
    const off = await api(rec).post('/api/appointments', { patientId: p.id, doctorId: ortho.id, date, startTime: '15:00' });
    expect(off.status).toBe(400);
    const odd = await api(rec).post('/api/appointments', { patientId: p.id, doctorId: ortho.id, date, startTime: '10:05' });
    expect(odd.status).toBe(400);
    const far = await api(rec).post('/api/appointments', { patientId: p.id, doctorId: ortho.id, date: nextWeekday(60), startTime: '10:00' });
    expect(far.status).toBe(400);
  });

  it('BR-5 never overbooks under concurrent requests', async () => {
    const pts = await Promise.all([newPatient(rec), newPatient(rec), newPatient(rec), newPatient(rec)]);
    const results = await Promise.all(pts.map((p) => api(rec).post('/api/appointments', { patientId: p.id, doctorId: ortho.id, date, startTime: '11:00' })));
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(3);
    const slots = await api(rec).get(`/api/masters/doctors/${ortho.id}/slots?date=${date}`);
    expect(slots.body.slots.find((s: { start: string }) => s.start === '11:00:00').available).toBe(0);
  });

  it('rejects a duplicate active booking for the same patient, doctor and day', async () => {
    const p = await newPatient(rec);
    expect((await api(rec).post('/api/appointments', { patientId: p.id, doctorId: physician.id, date, startTime: '09:30' })).status).toBe(201);
    expect((await api(rec).post('/api/appointments', { patientId: p.id, doctorId: physician.id, date, startTime: '09:40' })).status).toBe(409);
  });

  it('honours doctor leave', async () => {
    const leaveDate = nextWeekday(5);
    const lv = await api(admin).post(`/api/masters/doctors/${physician.id}/leaves`, { dateFrom: leaveDate, dateTo: leaveDate, reason: 'Conference' });
    expect(lv.status).toBe(201);
    const slots = await api(rec).get(`/api/masters/doctors/${physician.id}/slots?date=${leaveDate}`);
    expect(slots.body.onLeave).toBe(true);
    const p = await newPatient(rec);
    const r = await api(rec).post('/api/appointments', { patientId: p.id, doctorId: physician.id, date: leaveDate, startTime: '10:00' });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/leave/i);
    await api(admin).del(`/api/masters/doctors/${physician.id}/leaves/${lv.body.id}`);
  });

  it('APT-6 enforces status transitions and cancels the unpaid invoice', async () => {
    const p = await newPatient(rec);
    const b = await api(rec).post('/api/appointments', { patientId: p.id, doctorId: physician.id, date, startTime: '10:00' });
    const id = b.body.id;
    expect((await api(rec).post(`/api/appointments/${id}/status`, { status: 'completed' })).status).toBe(409);
    expect((await api(rec).post(`/api/appointments/${id}/status`, { status: 'checked_in' })).status).toBe(200);
    const c = await api(rec).post(`/api/appointments/${id}/status`, { status: 'cancelled', reason: 'Patient request' });
    expect(c.status).toBe(200);
    expect(c.body.invoiceNote).toMatch(/cancelled/);
    const inv = await api(admin).get(`/api/billing/invoices/${b.body.invoice.id}`);
    expect(inv.body.status).toBe('cancelled');
    expect((await api(rec).post(`/api/appointments/${id}/status`, { status: 'checked_in' })).status).toBe(409);
    // slot is free again
    const p2 = await newPatient(rec);
    const p3 = await newPatient(rec);
    expect((await api(rec).post('/api/appointments', { patientId: p2.id, doctorId: physician.id, date, startTime: '10:00' })).status).toBe(201);
    expect((await api(rec).post('/api/appointments', { patientId: p3.id, doctorId: physician.id, date, startTime: '10:00' })).status).toBe(201);
  });

  it('APT-7 reschedules with full validation', async () => {
    const p = await newPatient(rec);
    const b = await api(rec).post('/api/appointments', { patientId: p.id, doctorId: physician.id, date, startTime: '11:00' });
    const r = await api(rec).post(`/api/appointments/${b.body.id}/reschedule`, { date, startTime: '12:00' });
    expect(r.status).toBe(200);
    expect((await api(rec).post(`/api/appointments/${b.body.id}/reschedule`, { date, startTime: '14:00' })).status).toBe(400);
  });

  it('APT-9 walk-in registers for today and is checked in immediately', async () => {
    const p = await newPatient(rec);
    const r = await api(rec).post('/api/appointments', { patientId: p.id, doctorId: physician.id, walkIn: true });
    expect(r.status).toBe(201);
    const q = await api(rec).get(`/api/appointments/queue?doctorId=${physician.id}`);
    expect(q.body.date).toBe(today());
    const row = q.body.items.find((i: { id: number }) => i.id === r.body.id);
    expect(row.status).toBe('checked_in');
    expect(row.tokenNo).toBe(r.body.tokenNo);
  });

  it('APT-8 queue summarises the day', async () => {
    const q = await api(rec).get('/api/appointments/queue');
    expect(q.status).toBe(200);
    expect(q.body.summary).toHaveProperty('checked_in');
    expect(Array.isArray(q.body.items)).toBe(true);
  });

  it('APT-4/BR-6 prices a follow-up within the window at the follow-up fee', async () => {
    const doc = await as.doctor(); // linked to Dr. Rajesh Sharma
    const cardio = await doctorByName(rec, 'Dr. Rajesh Sharma');
    const p = await newPatient(rec);
    const first = await api(rec).post('/api/appointments', { patientId: p.id, doctorId: cardio.id, walkIn: true });
    expect(first.body.visitType).toBe('new');
    const enc = await api(doc).post('/api/opd/encounters', { appointmentId: first.body.id });
    await api(doc).put(`/api/opd/encounters/${enc.body.id}`, { chiefComplaint: 'Palpitations' });
    expect((await api(doc).post(`/api/opd/encounters/${enc.body.id}/finalize`)).status).toBe(200);
    const fu = await api(rec).post('/api/appointments', { patientId: p.id, doctorId: cardio.id, date: nextWeekday(1), startTime: '09:15' });
    expect(fu.status).toBe(201);
    expect(fu.body.visitType).toBe('follow_up');
    expect(fu.body.fee).toBe(cardio.followUpFee);
  });
});
