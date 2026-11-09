import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { FlaskConical, Pill, Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import type { Diagnosis, RxItem } from '@/lib/types';
import { Badge, Card, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { EmptyState, StatusBadge } from '@/components/common';
import { FlagBadge } from '../lab/LabOrderPage';

interface PRx {
  id: number;
  finalizedAt: string;
  diagnoses: Diagnosis[];
  advice: string | null;
  followUpDate: string | null;
  doctorName: string;
  specialization: string | null;
  items: RxItem[];
}
interface PLab {
  id: number;
  orderNo: string;
  verifiedAt: string;
  doctorName: string | null;
  items: { id: number; testName: string; results: { parameter: string; value: string; unit?: string; refRange?: string; flag?: string }[] }[];
}
interface PInv {
  id: number;
  invoiceNo: string;
  type: string;
  status: string;
  total: number;
  amountPaid: number;
  balance: number;
  createdAt: string;
  items: { id: number; description: string; amount: number }[];
}

export default function PortalRecords() {
  const f = useFmt();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'rx';
  const rx = useQuery({ queryKey: ['portal-rx'], queryFn: () => api.get<PRx[]>('/portal/prescriptions') });
  const lab = useQuery({ queryKey: ['portal-lab'], queryFn: () => api.get<PLab[]>('/portal/lab-reports') });
  const inv = useQuery({ queryKey: ['portal-inv'], queryFn: () => api.get<PInv[]>('/portal/invoices') });
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-4 text-2xl font-semibold">My records</h1>
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList>
          <TabsTrigger value="rx">
            <Pill /> Prescriptions
          </TabsTrigger>
          <TabsTrigger value="lab">
            <FlaskConical /> Lab reports
          </TabsTrigger>
          <TabsTrigger value="bills">
            <Receipt /> Bills
          </TabsTrigger>
        </TabsList>
        <TabsContent value="rx" className="flex flex-col gap-3">
          {rx.data?.length ? (
            rx.data.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{r.doctorName}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.specialization} · {f.date(r.finalizedAt)}
                    </p>
                  </div>
                  {r.followUpDate ? <Badge variant="info">Follow-up {f.date(r.followUpDate)}</Badge> : null}
                </div>
                {r.diagnoses.length ? <p className="mt-2 text-sm">Diagnosis: {r.diagnoses.map((d) => d.description).join(', ')}</p> : null}
                {r.items.length ? (
                  <ul className="mt-3 divide-y rounded-lg border text-sm">
                    {r.items.map((i, idx) => (
                      <li key={idx} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                        <span className="font-medium">{i.medicineName}</span>
                        <span className="text-muted-foreground">
                          {[i.dose, i.frequency, i.durationDays ? `${i.durationDays} days` : null, i.instructions].filter(Boolean).join(' · ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {r.advice ? <p className="mt-3 rounded-lg bg-muted/40 p-3 text-sm">Advice: {r.advice}</p> : null}
              </Card>
            ))
          ) : (
            <Card>
              <EmptyState icon={Pill} title="No prescriptions yet" />
            </Card>
          )}
        </TabsContent>
        <TabsContent value="lab" className="flex flex-col gap-3">
          {lab.data?.length ? (
            lab.data.map((o) => (
              <Card key={o.id} className="p-4">
                <div className="flex justify-between">
                  <p className="font-semibold">{o.items.map((i) => i.testName).join(', ')}</p>
                  <span className="text-xs text-muted-foreground">{f.date(o.verifiedAt)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {o.orderNo} · {o.doctorName ?? 'Self'}
                </p>
                {o.items.map((it) => (
                  <table key={it.id} className="mt-3 w-full text-sm">
                    <tbody>
                      {it.results.map((r) => (
                        <tr key={r.parameter} className="border-t">
                          <td className="py-1.5">{r.parameter}</td>
                          <td className="py-1.5 font-semibold">
                            {r.value} <span className="font-normal text-muted-foreground">{r.unit}</span>
                          </td>
                          <td className="hidden py-1.5 text-muted-foreground sm:table-cell">{r.refRange}</td>
                          <td className="py-1.5 text-right">
                            <FlagBadge flag={r.flag} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              </Card>
            ))
          ) : (
            <Card>
              <EmptyState icon={FlaskConical} title="No reports yet" description="Reports appear here once verified by the lab." />
            </Card>
          )}
        </TabsContent>
        <TabsContent value="bills" className="flex flex-col gap-3">
          {inv.data?.length ? (
            inv.data.map((i) => (
              <Card key={i.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono font-semibold">{i.invoiceNo}</p>
                    <p className="text-xs text-muted-foreground">
                      {f.date(i.createdAt)} · {i.type.toUpperCase()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{f.money(i.total)}</p>
                    <StatusBadge status={i.status} />
                  </div>
                </div>
                <ul className="mt-2 text-sm text-muted-foreground">
                  {i.items.map((it) => (
                    <li key={it.id} className="flex justify-between">
                      <span>{it.description}</span>
                      <span>{f.money(it.amount)}</span>
                    </li>
                  ))}
                </ul>
                {i.balance > 0 ? <p className="mt-2 text-sm font-medium text-destructive">Balance due {f.money(i.balance)} — payable at the clinic</p> : null}
              </Card>
            ))
          ) : (
            <Card>
              <EmptyState icon={Receipt} title="No bills" />
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
