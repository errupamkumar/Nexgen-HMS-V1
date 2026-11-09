import request from 'supertest';
import { createApp } from '../src/app.js';
import { nowInTz, addDays, dayOfWeek } from '../src/core/util.js';

export const app = createApp();

export async function login(tenantCode: string | null, email: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ tenantCode: tenantCode ?? '', email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

export function api(token: string) {
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body?: object) => auth(request(app).post(url)).send(body ?? {}),
    put: (url: string, body?: object) => auth(request(app).put(url)).send(body ?? {}),
    patch: (url: string, body?: object) => auth(request(app).patch(url)).send(body ?? {}),
    del: (url: string) => auth(request(app).delete(url)),
  };
}

export const as = {
  admin: () => login('sunrise', 'admin@sunrise.health', 'Admin@123'),
  doctor: () => login('sunrise', 'doctor@sunrise.health', 'Staff@123'),
  reception: () => login('sunrise', 'reception@sunrise.health', 'Staff@123'),
  nurse: () => login('sunrise', 'nurse@sunrise.health', 'Staff@123'),
  pharmacist: () => login('sunrise', 'pharmacy@sunrise.health', 'Staff@123'),
  lab: () => login('sunrise', 'lab@sunrise.health', 'Staff@123'),
  accountant: () => login('sunrise', 'accounts@sunrise.health', 'Staff@123'),
  patient: () => login('sunrise', 'patient@sunrise.health', 'Patient@123'),
  carewell: () => login('carewell', 'admin@carewell.clinic', 'Admin@123'),
  owner: () => login(null, 'owner@nexgen.health', 'Owner@123'),
};

/** Next Monday–Friday date at least `minDays` ahead in the clinic timezone (sunrise doctors sit Mon–Sat). */
export function nextWeekday(minDays = 1) {
  let d = addDays(nowInTz('Asia/Kolkata').date, minDays);
  while (dayOfWeek(d) === 0 || dayOfWeek(d) === 6) d = addDays(d, 1);
  return d;
}
export const today = () => nowInTz('Asia/Kolkata').date;

let seq = 0;
export async function newPatient(token: string, overrides: Record<string, unknown> = {}) {
  seq++;
  const res = await api(token).post('/api/patients', {
    firstName: `Test${seq}${Date.now() % 10000}`,
    lastName: 'Patient',
    gender: 'female',
    age: 30,
    phone: `+91 70000${String(Date.now() % 100000).padStart(5, '0')}`,
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`patient create failed: ${JSON.stringify(res.body)}`);
  return res.body as { id: number; uhid: string };
}

export async function doctorByName(token: string, name: string) {
  const res = await api(token).get('/api/masters/doctors?all=1');
  const d = (res.body as { id: number; name: string }[]).find((x) => x.name === name);
  if (!d) throw new Error(`doctor ${name} not found`);
  return d as { id: number; name: string; consultationFee: number; followUpFee: number; maxPerSlot: number };
}
