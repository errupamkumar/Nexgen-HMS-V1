import type { ReactNode } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { HeartPulse, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ageOf, titleCase, useFmt } from '@/lib/format';
import type { Diagnosis, Invoice, Patient, RxItem, Vitals } from '@/lib/types';
import { Button, Skeleton } from '@/components/ui';

function Letterhead({ title, right }: { title: string; right?: ReactNode }) {
  const { session } = useAuth();
  const t = session?.tenant;
  const p = session?.settings?.profile;
  return (
    <header className="flex items-start justify-between gap-6 border-b-2 pb-4" style={{ borderColor: 'var(--brand)' }}>
      <div className="flex items-center gap-3">
        {p?.logoUrl ? (
          <img src={p.logoUrl} alt="" className="size-14 rounded-xl object-cover" />
        ) : (
          <div className="flex size-14 items-center justify-center rounded-xl text-white" style={{ background: 'var(--brand)' }}>
            <HeartPulse className="size-7" />
          </div>
        )}
        <div>
          <p className="text-xl font-bold" style={{ color: 'var(--brand)' }}>
            {t?.name}
          </p>
          {p?.tagline ? <p className="text-xs text-slate-500">{p.tagline}</p> : null}
          <p className="text-xs text-slate-600">{[t?.address, t?.city, t?.state].filter(Boolean).join(', ')}</p>
          <p className="text-xs text-slate-600">
            {[t?.phone && `Ph: ${t.phone}`, t?.email, p?.gstin && `GSTIN: ${p.gstin}`, p?.registrationNo && `Reg: ${p.registrationNo}`].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="whitespace-nowrap text-lg font-semibold uppercase tracking-wider text-slate-700">{title}</p>
        {right}
      </div>
    </header>
  );
}

function PatientBlock({ p, extra }: { p: { name: string; uhid: string; gender: string; dob: string | null; phone: string }; extra?: ReactNode }) {
  return (
    <section className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-slate-50 p-3 text-sm">
      <p>
        <span className="text-slate-500">Patient:</span> <b>{p.name}</b>
      </p>
      <p>
        <span className="text-slate-500">UHID:</span> {p.uhid}
      </p>
      <p>
        <span className="text-slate-500">Age / Sex:</span> {ageOf(p.dob) ?? '—'} / {titleCase(p.gender)}
      </p>
      <p>
        <span className="text-slate-500">Phone:</span> {p.phone}
      </p>
      {extra}
    </section>
  );
}

function PrescriptionDoc({ id }: { id: string }) {
  const f = useFmt();
  const { session } = useAuth();
  const { data: e } = useQuery({
    queryKey: ['encounter', id],
    queryFn: () =>
      api.get<{
        finalizedAt: string | null;
        createdAt: string;
        chiefComplaint: string | null;
        examination: string | null;
        vitals: Vitals;
        diagnoses: Diagnosis[];
        advice: string | null;
        followUpDate: string | null;
        patient: Patient;
        doctor: { name: string; qualification: string | null; registrationNo: string | null; specialization: string | null; departmentName: string | null };
        prescriptions: RxItem[];
        labOrders: { orderNo: string; items: { testName: string }[] }[];
      }>(`/opd/encounters/${id}`),
  });
  if (!e) return <Skeleton className="h-96" />;
  const v = e.vitals ?? {};
  const vit = [v.bpSystolic && `BP ${v.bpSystolic}/${v.bpDiastolic} mmHg`, v.pulse && `Pulse ${v.pulse}/min`, v.temperature && `Temp ${Number(v.temperature).toFixed(1)}°C`, v.spo2 && `SpO₂ ${v.spo2}%`, v.weight && `Wt ${v.weight} kg`, v.bmi && `BMI ${v.bmi}`].filter(Boolean);
  return (
    <>
      <Letterhead
        title="Prescription"
        right={
          <div className="mt-1 text-sm">
            <p className="font-semibold">{e.doctor.name}</p>
            <p className="text-xs text-slate-600">{e.doctor.qualification}</p>
            <p className="text-xs text-slate-600">{e.doctor.specialization}</p>
            {e.doctor.registrationNo ? <p className="text-xs text-slate-600">Reg. No. {e.doctor.registrationNo}</p> : null}
          </div>
        }
      />
      {session?.settings?.clinical.prescriptionHeader ? <p className="mt-2 text-center text-xs text-slate-500">{session.settings.clinical.prescriptionHeader}</p> : null}
      <PatientBlock p={e.patient} extra={<p className="col-span-2"><span className="text-slate-500">Date:</span> {f.dateTime(e.finalizedAt ?? e.createdAt)}</p>} />
      {e.patient.allergies?.length ? <p className="mt-2 text-sm font-semibold text-red-600">Allergies: {e.patient.allergies.join(', ')}</p> : null}
      {vit.length ? <p className="mt-3 text-sm text-slate-700">{vit.join(' · ')}</p> : null}
      {e.chiefComplaint ? (
        <p className="mt-3 text-sm">
          <b>Complaints:</b> {e.chiefComplaint}
        </p>
      ) : null}
      {e.examination ? (
        <p className="mt-1 text-sm">
          <b>Examination:</b> {e.examination}
        </p>
      ) : null}
      {e.diagnoses.length ? (
        <p className="mt-1 text-sm">
          <b>Diagnosis:</b> {e.diagnoses.map((d) => `${d.description}${d.code ? ` (${d.code})` : ''}`).join('; ')}
        </p>
      ) : null}
      <p className="mt-5 text-3xl font-serif font-bold" style={{ color: 'var(--brand)' }}>
        ℞
      </p>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase text-slate-500">
            <th className="py-1.5">#</th>
            <th>Medicine</th>
            <th>Dose</th>
            <th>Frequency</th>
            <th>Duration</th>
            <th>Instructions</th>
            <th className="text-right">Qty</th>
          </tr>
        </thead>
        <tbody>
          {e.prescriptions.map((r, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="py-2">{i + 1}</td>
              <td className="font-semibold">{r.medicineName}</td>
              <td>{r.dose}</td>
              <td>{r.frequency}</td>
              <td>{r.durationDays ? `${r.durationDays} days` : ''}</td>
              <td>{r.instructions}</td>
              <td className="text-right">{r.quantity || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {e.labOrders.length ? (
        <p className="mt-4 text-sm">
          <b>Investigations:</b> {e.labOrders.flatMap((o) => o.items.map((i) => i.testName)).join(', ')}
        </p>
      ) : null}
      {e.advice ? (
        <p className="mt-3 whitespace-pre-line text-sm">
          <b>Advice:</b> {e.advice}
        </p>
      ) : null}
      {e.followUpDate ? (
        <p className="mt-2 text-sm">
          <b>Follow-up on:</b> {f.date(e.followUpDate)}
        </p>
      ) : null}
      <div className="mt-16 flex justify-end">
        <div className="w-56 border-t pt-1 text-center text-sm">
          <p className="font-semibold">{e.doctor.name}</p>
          <p className="text-xs text-slate-500">Signature</p>
        </div>
      </div>
      {session?.settings?.clinical.prescriptionFooter ? <p className="mt-8 border-t pt-2 text-center text-[11px] text-slate-500">{session.settings.clinical.prescriptionFooter}</p> : null}
    </>
  );
}

function InvoiceDoc({ id }: { id: string }) {
  const f = useFmt();
  const { session } = useAuth();
  const { data: inv } = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<Invoice>(`/billing/invoices/${id}`) });
  if (!inv) return <Skeleton className="h-96" />;
  const tax = session?.settings?.billing.taxLabel ?? 'Tax';
  return (
    <>
      <Letterhead
        title={inv.status === 'cancelled' ? 'Cancelled invoice' : 'Tax invoice'}
        right={
          <div className="mt-1 text-sm">
            <p className="font-mono font-semibold">{inv.invoiceNo}</p>
            <p className="text-xs text-slate-600">{f.dateTime(inv.createdAt)}</p>
            <p className="mt-1 text-xs font-semibold uppercase">{titleCase(inv.status)}</p>
          </div>
        }
      />
      <PatientBlock p={inv.patient} />
      <table className="mt-5 w-full text-sm">
        <thead>
          <tr className="border-b-2 text-left text-xs uppercase text-slate-500">
            <th className="py-2">#</th>
            <th>Description</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Rate</th>
            <th className="text-right">Disc.</th>
            <th className="text-right">{tax}</th>
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.items.map((it, i) => (
            <tr key={it.id} className="border-b border-slate-100">
              <td className="py-2">{i + 1}</td>
              <td>{it.description}</td>
              <td className="text-right">{it.quantity}</td>
              <td className="text-right">{f.money(it.unitPrice)}</td>
              <td className="text-right">{it.discount ? f.money(it.discount) : '—'}</td>
              <td className="text-right">{it.taxRate ? `${it.taxRate}%` : '—'}</td>
              <td className="text-right font-medium">{f.money(it.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex justify-end">
        <div className="w-72 text-sm">
          {[
            ['Subtotal', f.money(inv.subtotal)],
            ['Discount', `− ${f.money(inv.discountTotal)}`],
            [tax, f.money(inv.taxTotal)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between py-0.5">
              <span className="text-slate-500">{k}</span>
              <span>{v}</span>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t-2 pt-1.5 text-base font-bold">
            <span>Total</span>
            <span>{f.money(inv.total)}</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-slate-500">Paid</span>
            <span>{f.money(inv.amountPaid)}</span>
          </div>
          <div className="flex justify-between py-0.5 font-semibold">
            <span>Balance</span>
            <span>{f.money(inv.balance)}</span>
          </div>
        </div>
      </div>
      {inv.payments.length ? (
        <section className="mt-6">
          <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Payments received</p>
          <table className="w-full text-xs">
            <tbody>
              {inv.payments.map((p) => (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="py-1">{p.receiptNo}</td>
                  <td>{f.dateTime(p.paidAt)}</td>
                  <td className="uppercase">{p.method}</td>
                  <td>{p.reference}</td>
                  <td className="text-right">{f.money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      <div className="mt-16 flex items-end justify-between text-xs text-slate-500">
        <p className="max-w-sm">{session?.settings?.billing.invoiceFooter}</p>
        <div className="w-48 border-t pt-1 text-center">Authorised signatory</div>
      </div>
    </>
  );
}

function LabDoc({ id }: { id: string }) {
  const f = useFmt();
  const { data: o } = useQuery({
    queryKey: ['lab-order', id],
    queryFn: () =>
      api.get<{
        orderNo: string;
        sampleId: string | null;
        createdAt: string;
        collectedAt: string | null;
        verifiedAt: string | null;
        doctorName: string | null;
        status: string;
        patient: { name: string; uhid: string; gender: string; dob: string | null; phone: string };
        items: { id: number; testName: string; category: string | null; results: { parameter: string; value: string; unit?: string; refRange?: string; flag?: string }[]; resultNotes: string | null }[];
      }>(`/lab/orders/${id}`),
  });
  if (!o) return <Skeleton className="h-96" />;
  return (
    <>
      <Letterhead
        title="Laboratory report"
        right={
          <div className="mt-1 text-sm">
            <p className="font-mono font-semibold">{o.orderNo}</p>
            <p className="text-xs text-slate-600">Sample {o.sampleId}</p>
          </div>
        }
      />
      <PatientBlock
        p={o.patient}
        extra={
          <>
            <p>
              <span className="text-slate-500">Referred by:</span> {o.doctorName ?? 'Self'}
            </p>
            <p>
              <span className="text-slate-500">Collected:</span> {f.dateTime(o.collectedAt)}
            </p>
            <p>
              <span className="text-slate-500">Reported:</span> {f.dateTime(o.verifiedAt)}
            </p>
          </>
        }
      />
      {o.status !== 'verified' ? <p className="mt-3 rounded bg-amber-50 p-2 text-center text-sm font-semibold text-amber-700">PROVISIONAL — not yet verified</p> : null}
      {o.items.map((it) => (
        <section key={it.id} className="mt-6">
          <p className="border-b pb-1 text-sm font-bold uppercase" style={{ color: 'var(--brand)' }}>
            {it.testName}
          </p>
          <table className="mt-1 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500">
                <th className="py-1.5">Investigation</th>
                <th>Result</th>
                <th>Unit</th>
                <th>Reference range</th>
              </tr>
            </thead>
            <tbody>
              {it.results.map((r) => (
                <tr key={r.parameter} className="border-b border-slate-100">
                  <td className="py-1.5">{r.parameter}</td>
                  <td className={r.flag === 'H' || r.flag === 'L' ? 'font-bold text-red-600' : 'font-semibold'}>
                    {r.value} {r.flag === 'H' ? '↑' : r.flag === 'L' ? '↓' : ''}
                  </td>
                  <td className="text-slate-600">{r.unit}</td>
                  <td className="text-slate-600">{r.refRange}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {it.resultNotes ? <p className="mt-1 text-xs text-slate-600">Remarks: {it.resultNotes}</p> : null}
        </section>
      ))}
      <p className="mt-10 text-center text-xs text-slate-500">— End of report —</p>
      <div className="mt-10 flex justify-end">
        <div className="w-56 border-t pt-1 text-center text-xs text-slate-500">Pathologist / Lab in-charge</div>
      </div>
    </>
  );
}

function DischargeDoc({ id }: { id: string }) {
  const f = useFmt();
  const { data: a } = useQuery({
    queryKey: ['admission', id],
    queryFn: () =>
      api.get<{
        admissionNo: string;
        admittedAt: string;
        dischargedAt: string | null;
        reason: string | null;
        provisionalDiagnosis: string | null;
        dischargeType: string | null;
        dischargeSummary: string | null;
        stayDays: number;
        patient: Patient;
        doctor: { name: string; specialization: string | null; departmentName: string | null };
        ward: { name: string };
        bed: { bedNo: string };
      }>(`/ipd/admissions/${id}`),
  });
  if (!a) return <Skeleton className="h-96" />;
  return (
    <>
      <Letterhead title="Discharge summary" right={<p className="mt-1 font-mono text-sm font-semibold">{a.admissionNo}</p>} />
      <PatientBlock
        p={a.patient}
        extra={
          <>
            <p>
              <span className="text-slate-500">Admitted:</span> {f.dateTime(a.admittedAt)}
            </p>
            <p>
              <span className="text-slate-500">Discharged:</span> {f.dateTime(a.dischargedAt)}
            </p>
            <p>
              <span className="text-slate-500">Consultant:</span> {a.doctor.name}
            </p>
            <p>
              <span className="text-slate-500">Ward / bed:</span> {a.ward.name} · {a.bed.bedNo} ({a.stayDays} days)
            </p>
          </>
        }
      />
      <section className="mt-5 space-y-3 text-sm">
        {a.reason ? (
          <p>
            <b>Reason for admission:</b> {a.reason}
          </p>
        ) : null}
        {a.provisionalDiagnosis ? (
          <p>
            <b>Diagnosis:</b> {a.provisionalDiagnosis}
          </p>
        ) : null}
        <p>
          <b>Discharge type:</b> {titleCase(a.dischargeType)}
        </p>
        <div>
          <p className="font-bold">Summary &amp; advice</p>
          <p className="mt-1 whitespace-pre-line">{a.dischargeSummary}</p>
        </div>
      </section>
      <div className="mt-16 flex justify-end">
        <div className="w-56 border-t pt-1 text-center text-sm">
          <p className="font-semibold">{a.doctor.name}</p>
          <p className="text-xs text-slate-500">{a.doctor.specialization}</p>
        </div>
      </div>
    </>
  );
}

export default function PrintPage() {
  const { kind, id } = useParams();
  if (!id) return null;
  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between px-2">
        <p className="text-sm text-slate-600">Print preview · {titleCase(kind)}</p>
        <Button onClick={() => window.print()}>
          <Printer /> Print / Save PDF
        </Button>
      </div>
      <article className="print-area mx-auto min-h-[297mm] max-w-[210mm] bg-white p-[14mm] text-slate-900 shadow-xl">
        {kind === 'prescription' ? <PrescriptionDoc id={id} /> : null}
        {kind === 'invoice' ? <InvoiceDoc id={id} /> : null}
        {kind === 'lab' ? <LabDoc id={id} /> : null}
        {kind === 'discharge' ? <DischargeDoc id={id} /> : null}
      </article>
    </div>
  );
}
