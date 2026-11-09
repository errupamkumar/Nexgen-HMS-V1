/**
 * Demo data. Idempotent: skips anything that already exists.
 *   Platform owner : owner@nexgen.health / Owner@123          (no organisation code)
 *   sunrise (Enterprise, full demo data) : admin@sunrise.health / Admin@123 (+ role users, see README)
 *   carewell (Starter trial)             : admin@carewell.clinic / Admin@123
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { db, pool, type Tx } from './client.js';
import {
  admissionNotes,
  admissions,
  appointments,
  beds,
  departments,
  doctors,
  doctorSchedules,
  encounters,
  invoices,
  labOrderItems,
  labOrders,
  labTests,
  medicineBatches,
  medicines,
  notifications,
  patients,
  payments,
  plans,
  prescriptionItems,
  roles,
  stockMovements,
  tenants,
  users,
  wards,
} from './schema.js';
import { hashPassword } from '../core/auth.js';
import { resolveSettings } from '../core/settings.js';
import { addDays, nextNumber, nowInTz } from '../core/util.js';
import { createInvoice, recordPayment } from '../modules/billing/service.js';
import { provisionTenant } from '../modules/platform/provision.js';

// Deterministic PRNG so demo data is the same on every machine.
let s = 42;
const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

const PLANS = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'Single-doctor and small clinics',
    priceMonthly: 1999,
    priceYearly: 19990,
    maxUsers: 5,
    maxBranches: 1,
    modules: ['patients', 'appointments', 'opd', 'billing', 'reports'],
    sortOrder: 1,
  },
  {
    code: 'professional',
    name: 'Professional',
    description: 'Polyclinics with pharmacy and diagnostics',
    priceMonthly: 4999,
    priceYearly: 49990,
    maxUsers: 25,
    maxBranches: 3,
    modules: ['patients', 'appointments', 'opd', 'billing', 'reports', 'pharmacy', 'lab', 'communication', 'portal'],
    sortOrder: 2,
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description: 'Hospitals and nursing homes with in-patient care',
    priceMonthly: 9999,
    priceYearly: 99990,
    maxUsers: 500,
    maxBranches: 50,
    modules: ['patients', 'appointments', 'opd', 'billing', 'reports', 'pharmacy', 'lab', 'communication', 'portal', 'ipd'],
    sortOrder: 3,
  },
];

const FIRST_M = ['Aarav', 'Vihaan', 'Arjun', 'Rohan', 'Kabir', 'Ishaan', 'Rahul', 'Amit', 'Suresh', 'Manoj', 'Deepak', 'Vikram', 'Sanjay', 'Imran', 'Faizan'];
const FIRST_F = ['Ananya', 'Diya', 'Priya', 'Sneha', 'Kavya', 'Pooja', 'Neha', 'Sunita', 'Meera', 'Ritu', 'Ayesha', 'Fatima', 'Lakshmi', 'Shreya', 'Nisha'];
const LAST = ['Sharma', 'Verma', 'Patel', 'Singh', 'Kumar', 'Gupta', 'Yadav', 'Mishra', 'Jha', 'Das', 'Khan', 'Reddy', 'Nair', 'Iyer', 'Sinha'];
const COMPLAINTS = ['Fever and body ache for 3 days', 'Persistent dry cough', 'Lower back pain', 'Headache and dizziness', 'Chest discomfort on exertion', 'Skin rash with itching', 'Stomach pain after meals', 'Joint pain in knees', 'Routine BP follow-up', 'Sore throat', 'Diabetes review'];
const DIAG: [string, string][] = [
  ['J06.9', 'Acute upper respiratory infection'],
  ['I10', 'Essential hypertension'],
  ['E11.9', 'Type 2 diabetes mellitus'],
  ['M54.5', 'Low back pain'],
  ['K30', 'Functional dyspepsia'],
  ['L30.9', 'Dermatitis, unspecified'],
  ['R51', 'Headache'],
  ['M17.9', 'Osteoarthritis of knee'],
  ['A09', 'Infectious gastroenteritis'],
];

async function upsertPlans() {
  for (const p of PLANS) {
    const [ex] = await db.select({ id: plans.id }).from(plans).where(eq(plans.code, p.code));
    if (!ex) await db.insert(plans).values(p);
  }
  console.log('✔ plans');
}

async function platformOwner() {
  const [ex] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, 'owner@nexgen.health'), eq(users.isPlatformAdmin, true)));
  if (ex) return;
  await db.insert(users).values({
    tenantId: null,
    email: 'owner@nexgen.health',
    passwordHash: await hashPassword('Owner@123'),
    fullName: 'Platform Owner',
    isPlatformAdmin: true,
  });
  console.log('✔ platform owner');
}

async function roleId(tx: Tx, tenantId: number, code: string) {
  const [r] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.tenantId, tenantId), eq(roles.code, code)));
  return r.id;
}

async function seedSunrise() {
  const [ex] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.code, 'sunrise'));
  if (ex) return console.log('• sunrise exists — skipped');

  await db.transaction(async (tx) => {
    const { tenantId: t, adminUserId } = await provisionTenant(tx, {
      code: 'sunrise',
      name: 'Sunrise Multispeciality Hospital',
      type: 'hospital',
      planCode: 'enterprise',
      status: 'active',
      phone: '+91 612 245 7788',
      address: 'Boring Road, Near AN College',
      city: 'Patna',
      state: 'Bihar',
      admin: { fullName: 'Ritika Sinha', email: 'admin@sunrise.health', password: 'Admin@123', phone: '+91 98350 11111' },
    });

    // Settings: branding, fees, custom registration fields
    const [tn] = await tx.select().from(tenants).where(eq(tenants.id, t));
    const st = resolveSettings(tn.settings);
    st.profile.tagline = 'Compassionate care, 24×7';
    st.profile.gstin = '10ABCDE1234F1Z5';
    st.profile.registrationNo = 'BR/CEA/2019/0457';
    st.billing.registrationFee = 100;
    st.clinical.prescriptionHeader = 'NABH accredited · Emergency: +91 612 245 7700';
    st.patientFields = [
      { key: 'occupation', label: 'Occupation', type: 'text', required: false },
      { key: 'insurance', label: 'Insurance / Scheme', type: 'select', options: ['None', 'Ayushman Bharat', 'CGHS', 'Star Health', 'HDFC Ergo', 'ICICI Lombard'], required: false },
      { key: 'referred_by', label: 'Referred By', type: 'text', required: false },
    ];
    await tx.update(tenants).set({ settings: st }).where(eq(tenants.id, t));
    const ctx = { tenantId: t, userId: adminUserId, settings: st };

    const depts = await tx.select().from(departments).where(eq(departments.tenantId, t));
    const dep = (name: string) => depts.find((d) => d.name === name)!.id;

    // ---- doctors + schedules
    const docDefs = [
      { name: 'Dr. Rajesh Sharma', dept: 'Cardiology', spec: 'Interventional Cardiologist', q: 'MBBS, MD, DM (Cardiology)', fee: 1000, fu: 500, exp: 18, slot: 15, cap: 2 },
      { name: 'Dr. Ananya Mukherjee', dept: 'Pediatrics', spec: 'Pediatrician', q: 'MBBS, MD (Pediatrics)', fee: 700, fu: 300, exp: 12, slot: 15, cap: 2 },
      { name: 'Dr. Vikram Rao', dept: 'Orthopedics', spec: 'Orthopedic Surgeon', q: 'MBBS, MS (Ortho)', fee: 800, fu: 400, exp: 15, slot: 20, cap: 1 },
      { name: 'Dr. Meera Iyer', dept: 'Gynecology', spec: 'Obstetrician & Gynecologist', q: 'MBBS, MS (OBG)', fee: 800, fu: 400, exp: 14, slot: 15, cap: 2 },
      { name: 'Dr. Sameer Khan', dept: 'General Medicine', spec: 'Physician', q: 'MBBS, MD (Medicine)', fee: 500, fu: 250, exp: 9, slot: 10, cap: 2 },
      { name: 'Dr. Kavita Nair', dept: 'Dermatology', spec: 'Dermatologist', q: 'MBBS, MD (DVL)', fee: 600, fu: 300, exp: 8, slot: 15, cap: 1 },
    ];
    const docIds: number[] = [];
    for (const d of docDefs) {
      const [r] = await tx.insert(doctors).values({
        tenantId: t,
        name: d.name,
        departmentId: dep(d.dept),
        specialization: d.spec,
        qualification: d.q,
        registrationNo: `BMC-${int(10000, 99999)}`,
        experienceYears: d.exp,
        consultationFee: d.fee,
        followUpFee: d.fu,
        followUpDays: 7,
        slotMinutes: d.slot,
        maxPerSlot: d.cap,
        telehealthEnabled: d.dept !== 'Orthopedics',
        bio: `${d.spec} with ${d.exp} years of clinical experience.`,
      });
      docIds.push(r.insertId);
      const sched = [];
      for (let day = 1; day <= 6; day++) {
        sched.push({ tenantId: t, doctorId: r.insertId, dayOfWeek: day, startTime: '09:00:00', endTime: '13:00:00' });
        if (day !== 6) sched.push({ tenantId: t, doctorId: r.insertId, dayOfWeek: day, startTime: '17:00:00', endTime: '20:00:00' });
      }
      await tx.insert(doctorSchedules).values(sched);
    }

    // ---- staff users per role
    const staff = [
      ['Dr. Rajesh Sharma', 'doctor@sunrise.health', 'doctor', docIds[0]],
      ['Pooja Verma', 'reception@sunrise.health', 'receptionist', null],
      ['Sister Mary Joseph', 'nurse@sunrise.health', 'nurse', null],
      ['Anil Gupta', 'pharmacy@sunrise.health', 'pharmacist', null],
      ['Neha Das', 'lab@sunrise.health', 'lab_technician', null],
      ['Suresh Jha', 'accounts@sunrise.health', 'accountant', null],
    ] as const;
    for (const [fullName, email, code, doctorId] of staff) {
      await tx.insert(users).values({
        tenantId: t,
        roleId: await roleId(tx, t, code),
        email,
        passwordHash: await hashPassword('Staff@123'),
        fullName,
        doctorId,
      });
    }

    // ---- medicines + batches
    const meds: [string, string, string, string, number, number][] = [
      ['Paracetamol 650', 'Paracetamol', 'Tablet', '650 mg', 2.5, 12],
      ['Amoxicillin 500', 'Amoxicillin', 'Capsule', '500 mg', 9, 12],
      ['Azithromycin 500', 'Azithromycin', 'Tablet', '500 mg', 24, 12],
      ['Pantoprazole 40', 'Pantoprazole', 'Tablet', '40 mg', 7, 12],
      ['Metformin 500', 'Metformin', 'Tablet', '500 mg', 3, 12],
      ['Amlodipine 5', 'Amlodipine', 'Tablet', '5 mg', 4, 12],
      ['Telmisartan 40', 'Telmisartan', 'Tablet', '40 mg', 8, 12],
      ['Cetirizine 10', 'Cetirizine', 'Tablet', '10 mg', 2, 12],
      ['ORS Sachet', 'Oral Rehydration Salts', 'Sachet', '21 g', 20, 12],
      ['Cough Syrup DX', 'Dextromethorphan', 'Syrup', '100 ml', 95, 12],
      ['Diclofenac Gel', 'Diclofenac', 'Gel', '30 g', 110, 18],
      ['Vitamin D3 60K', 'Cholecalciferol', 'Capsule', '60000 IU', 32, 12],
    ];
    const medIds: number[] = [];
    const today = nowInTz(st.locale.timezone).date;
    for (const [name, generic, form, strength, price, tax] of meds) {
      const [r] = await tx.insert(medicines).values({
        tenantId: t,
        name,
        genericName: generic,
        form,
        strength,
        unit: form === 'Syrup' || form === 'Gel' ? 'bottle' : form === 'Sachet' ? 'sachet' : 'tab',
        reorderLevel: 50,
        salePrice: price,
        taxRate: tax,
        manufacturer: pick(['Cipla', 'Sun Pharma', "Dr. Reddy's", 'Lupin', 'Mankind']),
      });
      medIds.push(r.insertId);
      const batchesForMed = name === 'Vitamin D3 60K' || name === 'Azithromycin 500' ? 1 : 2;
      for (let b = 0; b < batchesForMed; b++) {
        const qty = name === 'Azithromycin 500' ? 24 : int(120, 400);
        const expiry = b === 0 && name === 'Cetirizine 10' ? addDays(today, 45) : addDays(today, int(200, 700));
        const [br] = await tx.insert(medicineBatches).values({
          tenantId: t,
          medicineId: r.insertId,
          batchNo: `${generic.slice(0, 3).toUpperCase()}${int(1000, 9999)}`,
          expiryDate: expiry,
          quantity: qty,
          purchasePrice: Math.round(price * 0.7 * 100) / 100,
          mrp: Math.round(price * 1.1 * 100) / 100,
          salePrice: price,
          supplier: 'MedLine Distributors',
        });
        await tx.insert(stockMovements).values({ tenantId: t, medicineId: r.insertId, batchId: br.insertId, type: 'purchase', quantity: qty, notes: 'Opening stock' });
      }
    }

    // ---- lab tests
    const tests = [
      { code: 'CBC', name: 'Complete Blood Count', category: 'Hematology', sampleType: 'Blood (EDTA)', price: 350, parameters: [
        { name: 'Hemoglobin', unit: 'g/dL', refLow: 12, refHigh: 17 },
        { name: 'Total WBC', unit: '/µL', refLow: 4000, refHigh: 11000 },
        { name: 'Platelets', unit: 'lakh/µL', refLow: 1.5, refHigh: 4.5 },
        { name: 'RBC', unit: 'million/µL', refLow: 4.2, refHigh: 6.1 },
      ] },
      { code: 'FBS', name: 'Blood Sugar Fasting', category: 'Biochemistry', sampleType: 'Blood (Fluoride)', price: 120, parameters: [{ name: 'Glucose (Fasting)', unit: 'mg/dL', refLow: 70, refHigh: 100 }] },
      { code: 'HBA1C', name: 'HbA1c', category: 'Biochemistry', sampleType: 'Blood (EDTA)', price: 550, parameters: [{ name: 'HbA1c', unit: '%', refLow: 4, refHigh: 5.6 }] },
      { code: 'LFT', name: 'Liver Function Test', category: 'Biochemistry', sampleType: 'Serum', price: 700, parameters: [
        { name: 'Bilirubin Total', unit: 'mg/dL', refLow: 0.3, refHigh: 1.2 },
        { name: 'SGOT (AST)', unit: 'U/L', refLow: 5, refHigh: 40 },
        { name: 'SGPT (ALT)', unit: 'U/L', refLow: 7, refHigh: 56 },
        { name: 'Albumin', unit: 'g/dL', refLow: 3.5, refHigh: 5 },
      ] },
      { code: 'KFT', name: 'Kidney Function Test', category: 'Biochemistry', sampleType: 'Serum', price: 650, parameters: [
        { name: 'Urea', unit: 'mg/dL', refLow: 15, refHigh: 40 },
        { name: 'Creatinine', unit: 'mg/dL', refLow: 0.6, refHigh: 1.3 },
        { name: 'Uric Acid', unit: 'mg/dL', refLow: 3.5, refHigh: 7.2 },
      ] },
      { code: 'LIPID', name: 'Lipid Profile', category: 'Biochemistry', sampleType: 'Serum', price: 600, parameters: [
        { name: 'Total Cholesterol', unit: 'mg/dL', refLow: null, refHigh: 200 },
        { name: 'Triglycerides', unit: 'mg/dL', refLow: null, refHigh: 150 },
        { name: 'HDL', unit: 'mg/dL', refLow: 40, refHigh: null },
        { name: 'LDL', unit: 'mg/dL', refLow: null, refHigh: 100 },
      ] },
      { code: 'TSH', name: 'Thyroid Stimulating Hormone', category: 'Immunoassay', sampleType: 'Serum', price: 400, parameters: [{ name: 'TSH', unit: 'µIU/mL', refLow: 0.4, refHigh: 4.0 }] },
      { code: 'URINE', name: 'Urine Routine', category: 'Clinical Pathology', sampleType: 'Urine', price: 150, parameters: [
        { name: 'Colour', refText: 'Pale yellow' },
        { name: 'Protein', refText: 'Nil' },
        { name: 'Pus Cells', unit: '/hpf', refLow: 0, refHigh: 5 },
      ] },
    ];
    const testIds: number[] = [];
    for (const tst of tests) {
      const [r] = await tx.insert(labTests).values({ tenantId: t, ...tst, turnaroundHours: 12 });
      testIds.push(r.insertId);
    }

    // ---- wards & beds
    const wardDefs = [
      { name: 'General Ward A', type: 'general' as const, floor: '1', dailyRate: 1200, beds: 10 },
      { name: 'Semi-Private', type: 'semi_private' as const, floor: '2', dailyRate: 2500, beds: 6 },
      { name: 'Private Suites', type: 'private' as const, floor: '3', dailyRate: 4500, beds: 4 },
      { name: 'ICU', type: 'icu' as const, floor: '2', dailyRate: 9000, beds: 4 },
    ];
    const bedIds: number[] = [];
    for (const w of wardDefs) {
      const [r] = await tx.insert(wards).values({ tenantId: t, name: w.name, type: w.type, floor: w.floor, dailyRate: w.dailyRate });
      const prefix = w.type === 'icu' ? 'ICU' : w.type === 'private' ? 'P' : w.type === 'semi_private' ? 'SP' : 'GA';
      for (let i = 1; i <= w.beds; i++) {
        const [b] = await tx.insert(beds).values({ tenantId: t, wardId: r.insertId, bedNo: `${prefix}-${String(i).padStart(2, '0')}` });
        bedIds.push(b.insertId);
      }
    }

    // ---- patients
    const pIds: number[] = [];
    for (let i = 0; i < 48; i++) {
      const female = rnd() < 0.5;
      const first = pick(female ? FIRST_F : FIRST_M);
      const uhid = await nextNumber(tx, t, st, 'uhid');
      const [r] = await tx.insert(patients).values({
        tenantId: t,
        uhid,
        firstName: first,
        lastName: pick(LAST),
        gender: female ? 'female' : 'male',
        dob: `${int(1950, 2020)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
        phone: `+91 9${int(100000000, 999999999)}`,
        email: rnd() < 0.4 ? `${first.toLowerCase()}${i}@example.com` : null,
        bloodGroup: pick(['A+', 'B+', 'O+', 'AB+', 'O-', 'B-']),
        address: `${int(1, 200)}, ${pick(['Kankarbagh', 'Rajendra Nagar', 'Patliputra Colony', 'Boring Road', 'Bailey Road'])}`,
        city: 'Patna',
        state: 'Bihar',
        pincode: `8000${int(10, 30)}`,
        allergies: rnd() < 0.2 ? [pick(['Penicillin', 'Sulfa drugs', 'Peanuts', 'Dust'])] : [],
        conditions: rnd() < 0.3 ? [pick(['Hypertension', 'Type 2 Diabetes', 'Asthma', 'Hypothyroidism'])] : [],
        customFields: { insurance: pick(['None', 'None', 'Ayushman Bharat', 'Star Health', 'CGHS']), occupation: pick(['Teacher', 'Business', 'Student', 'Homemaker', 'Engineer', 'Farmer']) },
        createdAt: new Date(Date.now() - (i < 4 ? 0 : int(1, 90)) * 86_400_000),
      });
      pIds.push(r.insertId);
    }
    // Demo portal account for the first patient
    await tx.insert(users).values({
      tenantId: t,
      roleId: await roleId(tx, t, 'patient'),
      email: 'patient@sunrise.health',
      passwordHash: await hashPassword('Patient@123'),
      fullName: 'Portal Patient',
      patientId: pIds[0],
    });
    const [p0] = await tx.select().from(patients).where(eq(patients.id, pIds[0]));
    await tx.update(users).set({ fullName: `${p0.firstName} ${p0.lastName}` }).where(and(eq(users.tenantId, t), eq(users.email, 'patient@sunrise.health')));

    // ---- historical appointments (last 30 days) with encounters, invoices, payments
    const slotsAm = ['09:00:00', '09:30:00', '10:00:00', '10:30:00', '11:00:00', '11:30:00', '12:00:00'];
    for (let dOff = -30; dOff <= 0; dOff++) {
      const date = addDays(today, dOff);
      if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) continue;
      const perDay = dOff === 0 ? 10 : int(5, 11);
      const tokenByDoc = new Map<number, number>();
      for (let k = 0; k < perDay; k++) {
        const di = int(0, docIds.length - 1);
        const doctorId = docIds[di];
        const patientId = pick(pIds);
        const token = (tokenByDoc.get(doctorId) ?? 0) + 1;
        tokenByDoc.set(doctorId, token);
        const startTime = slotsAm[Math.min(token - 1, slotsAm.length - 1)];
        let status: 'completed' | 'cancelled' | 'no_show' | 'booked' | 'checked_in' =
          dOff < 0 ? (rnd() < 0.85 ? 'completed' : rnd() < 0.5 ? 'cancelled' : 'no_show') : k < 4 ? 'completed' : k < 7 ? 'checked_in' : 'booked';
        if (dOff === 0 && k < 4) status = 'completed';
        const fee = docDefs[di].fee;
        const appointmentNo = await nextNumber(tx, t, st, 'appointment');
        const [ar] = await tx.insert(appointments).values({
          tenantId: t,
          appointmentNo,
          patientId,
          doctorId,
          departmentId: dep(docDefs[di].dept),
          date,
          startTime,
          endTime: startTime.replace(/:(\d\d):/, (_m, mm) => `:${String(Number(mm) + 15).padStart(2, '0')}:`),
          tokenNo: token,
          visitType: rnd() < 0.25 ? 'follow_up' : 'new',
          mode: rnd() < 0.1 ? 'video' : 'in_person',
          source: pick(['desk', 'desk', 'phone', 'walk_in', 'portal']),
          status,
          fee,
          reason: pick(COMPLAINTS),
          checkedInAt: status === 'checked_in' || status === 'completed' ? new Date() : null,
          completedAt: status === 'completed' ? new Date(`${date}T07:00:00Z`) : null,
        });
        if (status === 'cancelled' || status === 'no_show') continue;
        const inv = await createInvoice(tx, ctx, {
          patientId,
          type: 'opd',
          appointmentId: ar.insertId,
          items: [{ itemType: 'consultation', refId: doctorId, description: `Consultation — ${docDefs[di].name}`, quantity: 1, unitPrice: fee }],
        });
        await tx.update(appointments).set({ invoiceId: inv.id }).where(eq(appointments.id, ar.insertId));
        await tx.update(invoices).set({ createdAt: new Date(`${date}T05:00:00Z`) }).where(eq(invoices.id, inv.id));
        if (status === 'completed' || rnd() < 0.5) {
          const pay = await recordPayment(tx, ctx, inv.id, { amount: fee, method: pick(['cash', 'upi', 'upi', 'card']) });
          await tx.update(payments).set({ paidAt: new Date(`${date}T0${int(4, 9)}:${int(10, 59)}:00Z`) }).where(eq(payments.id, pay.paymentId));
        }
        if (status === 'completed') {
          const dx = pick(DIAG);
          const [er] = await tx.insert(encounters).values({
            tenantId: t,
            patientId,
            doctorId,
            appointmentId: ar.insertId,
            status: 'final',
            chiefComplaint: pick(COMPLAINTS),
            vitals: { bpSystolic: int(110, 150), bpDiastolic: int(70, 95), pulse: int(64, 98), temperature: Math.round((36.5 + rnd() * 1.8) * 10) / 10, spo2: int(95, 99), weight: int(45, 90), height: int(150, 182) },
            diagnoses: [{ code: dx[0], description: dx[1], type: 'final' }],
            advice: 'Plenty of fluids. Review if symptoms persist.',
            followUpDate: addDays(date, 7),
            rxStatus: dOff === 0 ? 'pending' : 'dispensed',
            finalizedAt: new Date(`${date}T07:00:00Z`),
          });
          const mi = int(0, medIds.length - 1);
          await tx.insert(prescriptionItems).values([
            { tenantId: t, encounterId: er.insertId, medicineId: medIds[mi], medicineName: meds[mi][0], dose: '1 tab', frequency: '1-0-1', durationDays: 5, route: 'Oral', instructions: 'After food', quantity: 10 },
            { tenantId: t, encounterId: er.insertId, medicineId: medIds[3], medicineName: meds[3][0], dose: '1 tab', frequency: '1-0-0', durationDays: 5, route: 'Oral', instructions: 'Before breakfast', quantity: 5 },
          ]);
        }
      }
    }

    // ---- lab orders in various states
    for (let i = 0; i < 8; i++) {
      const patientId = pIds[i + 2];
      const tIdx = [int(0, 2), int(3, 7)];
      const orderNo = await nextNumber(tx, t, st, 'lab');
      const status = (['ordered', 'sample_collected', 'completed', 'verified'] as const)[i % 4];
      const [lo] = await tx.insert(labOrders).values({
        tenantId: t,
        orderNo,
        patientId,
        doctorId: docIds[i % docIds.length],
        priority: i === 1 ? 'urgent' : 'routine',
        status,
        sampleId: status === 'ordered' ? null : `S-${orderNo}`,
        collectedAt: status === 'ordered' ? null : new Date(),
        completedAt: status === 'completed' || status === 'verified' ? new Date() : null,
        verifiedAt: status === 'verified' ? new Date() : null,
      });
      const items = [];
      for (const ti of tIdx) {
        const tst = tests[ti];
        items.push({
          tenantId: t,
          labOrderId: lo.insertId,
          labTestId: testIds[ti],
          testName: tst.name,
          price: tst.price,
          results: tst.parameters.map((p) => {
            const lo2 = 'refLow' in p ? (p.refLow as number | null) : null;
            const hi = 'refHigh' in p ? (p.refHigh as number | null) : null;
            const filled = status === 'completed' || status === 'verified';
            let value = '';
            let flag: '' | 'H' | 'L' | 'N' = '';
            if (filled) {
              if (lo2 !== null || hi !== null) {
                const base = hi ?? (lo2 ?? 0) * 1.5;
                const v = Math.round(base * (0.75 + rnd() * 0.45) * 10) / 10;
                value = String(v);
                flag = hi !== null && v > hi ? 'H' : lo2 !== null && v < lo2 ? 'L' : 'N';
              } else value = 'refText' in p ? String(p.refText) : 'Normal';
            }
            return { parameter: p.name, value, unit: 'unit' in p ? (p.unit as string) : '', refRange: lo2 !== null && hi !== null ? `${lo2} – ${hi}` : hi !== null ? `≤ ${hi}` : lo2 !== null ? `≥ ${lo2}` : 'refText' in p ? String(p.refText) : '', flag };
          }),
        });
      }
      await tx.insert(labOrderItems).values(items);
      const inv = await createInvoice(tx, ctx, {
        patientId,
        type: 'lab',
        labOrderId: lo.insertId,
        items: tIdx.map((ti) => ({ itemType: 'lab_test' as const, refId: testIds[ti], description: tests[ti].name, quantity: 1, unitPrice: tests[ti].price })),
      });
      await tx.update(labOrders).set({ invoiceId: inv.id }).where(eq(labOrders.id, lo.insertId));
      if (i % 2 === 0) await recordPayment(tx, ctx, inv.id, { amount: inv.total, method: 'upi' });
    }

    // ---- current admissions
    for (let i = 0; i < 5; i++) {
      const patientId = pIds[20 + i];
      const bedId = bedIds[i * 4];
      const admissionNo = await nextNumber(tx, t, st, 'admission');
      const inv = await createInvoice(tx, ctx, { patientId, type: 'ipd', items: [], status: 'draft', notes: `IPD running bill ${admissionNo}` });
      const admittedAt = new Date(Date.now() - int(1, 5) * 86_400_000);
      const [ad] = await tx.insert(admissions).values({
        tenantId: t,
        admissionNo,
        patientId,
        doctorId: docIds[i % docIds.length],
        departmentId: dep(docDefs[i % docIds.length].dept),
        bedId,
        invoiceId: inv.id,
        admittedAt,
        reason: pick(['Chest pain for evaluation', 'Fracture right femur', 'Dengue fever with thrombocytopenia', 'Post-operative care', 'Uncontrolled diabetes']),
        provisionalDiagnosis: pick(DIAG)[1],
        attendantName: `${pick(FIRST_M)} ${pick(LAST)}`,
        attendantPhone: `+91 9${int(100000000, 999999999)}`,
      });
      await tx.update(invoices).set({ admissionId: ad.insertId }).where(eq(invoices.id, inv.id));
      await tx.update(beds).set({ status: 'occupied' }).where(eq(beds.id, bedId));
      await tx.insert(admissionNotes).values([
        { tenantId: t, admissionId: ad.insertId, type: 'progress', note: 'Admitted. Vitals stable. Started on IV fluids and monitoring.', createdByName: 'Dr. Rajesh Sharma', createdAt: admittedAt },
        { tenantId: t, admissionId: ad.insertId, type: 'nursing', note: 'Patient comfortable, took orally. Night uneventful.', vitals: { pulse: 82, bpSystolic: 128, bpDiastolic: 82, temperature: 37.1, spo2: 97 }, createdByName: 'Sister Mary Joseph' },
      ]);
      await recordPayment(tx, ctx, inv.id, { amount: 5000, method: 'cash', notes: 'Admission deposit' });
    }
    await tx.insert(notifications).values([
      { tenantId: t, title: 'New online booking', body: 'A patient booked Dr. Kavita Nair via the portal', link: '/appointments', type: 'appointment', permission: 'appointments.view', readBy: [] },
      { tenantId: t, title: 'URGENT lab order', body: 'Blood Sugar Fasting, TSH', link: '/lab', type: 'lab', permission: 'lab.result', readBy: [] },
      { tenantId: t, title: 'Low stock: Azithromycin 500', body: 'On hand 24, reorder level 50', link: '/pharmacy', type: 'pharmacy', permission: 'pharmacy.view', readBy: [] },
    ]);
    await tx.update(beds).set({ status: 'cleaning' }).where(eq(beds.id, bedIds[1]));
    await tx.update(beds).set({ status: 'maintenance' }).where(eq(beds.id, bedIds[9]));
  });
  console.log('✔ sunrise (Enterprise) seeded');
}

async function seedCarewell() {
  const [ex] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.code, 'carewell'));
  if (ex) return console.log('• carewell exists — skipped');
  await db.transaction(async (tx) => {
    const { tenantId: t } = await provisionTenant(tx, {
      code: 'carewell',
      name: 'CareWell Family Clinic',
      type: 'clinic',
      planCode: 'starter',
      status: 'trial',
      trialDays: 14,
      city: 'Purnea',
      state: 'Bihar',
      primaryColor: '#4f46e5',
      admin: { fullName: 'Dr. Arun Mehta', email: 'admin@carewell.clinic', password: 'Admin@123' },
    });
    const [tn] = await tx.select().from(tenants).where(eq(tenants.id, t));
    const st = resolveSettings(tn.settings);
    const [dept] = await tx.select().from(departments).where(and(eq(departments.tenantId, t), eq(departments.name, 'General Medicine')));
    const [d] = await tx.insert(doctors).values({
      tenantId: t,
      name: 'Dr. Arun Mehta',
      departmentId: dept.id,
      specialization: 'Family Physician',
      qualification: 'MBBS',
      consultationFee: 400,
      followUpFee: 200,
      slotMinutes: 15,
      maxPerSlot: 1,
    });
    const sched = [];
    for (let day = 1; day <= 6; day++) sched.push({ tenantId: t, doctorId: d.insertId, dayOfWeek: day, startTime: '10:00:00', endTime: '14:00:00' });
    await tx.insert(doctorSchedules).values(sched);
    await tx.update(users).set({ doctorId: d.insertId }).where(and(eq(users.tenantId, t), eq(users.email, 'admin@carewell.clinic')));
    for (let i = 0; i < 6; i++) {
      const female = i % 2 === 0;
      await tx.insert(patients).values({
        tenantId: t,
        uhid: await nextNumber(tx, t, st, 'uhid'),
        firstName: pick(female ? FIRST_F : FIRST_M),
        lastName: pick(LAST),
        gender: female ? 'female' : 'male',
        phone: `+91 8${int(100000000, 999999999)}`,
        allergies: [],
        conditions: [],
        customFields: {},
      });
    }
  });
  console.log('✔ carewell (Starter trial) seeded');
}

export async function seed() {
  await upsertPlans();
  await platformOwner();
  await seedSunrise();
  await seedCarewell();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seed()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
