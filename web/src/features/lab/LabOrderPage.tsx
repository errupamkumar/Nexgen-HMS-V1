import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, BadgeCheck, Ban, CheckCircle2, Printer, Save, TestTube } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ageOf, titleCase, useFmt } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge, Button, Card, Input, Skeleton, Textarea } from '@/components/ui';
import { ConfirmDialog, InfoRow, SectionCard, StatusBadge } from '@/components/common';

interface ResultValue {
  parameter: string;
  value: string;
  unit?: string;
  refRange?: string;
  flag?: string;
}
interface Order {
  id: number;
  orderNo: string;
  status: string;
  priority: string;
  sampleId: string | null;
  notes: string | null;
  createdAt: string;
  collectedAt: string | null;
  completedAt: string | null;
  verifiedAt: string | null;
  invoiceId: number | null;
  doctorName: string | null;
  patient: { id: number; name: string; uhid: string; gender: string; dob: string | null; phone: string };
  items: { id: number; testName: string; category: string | null; sampleType: string | null; results: ResultValue[]; resultNotes: string | null }[];
}

/** Client-side preview of the server's H/L rule, from the stored reference range text. */
function previewFlag(value: string, refRange?: string) {
  const n = Number(value);
  if (!value.trim() || !Number.isFinite(n) || !refRange) return '';
  const range = /^([\d.]+)\s*–\s*([\d.]+)$/.exec(refRange);
  if (range) return n < Number(range[1]) ? 'L' : n > Number(range[2]) ? 'H' : 'N';
  const le = /^≤\s*([\d.]+)$/.exec(refRange);
  if (le) return n > Number(le[1]) ? 'H' : 'N';
  const ge = /^≥\s*([\d.]+)$/.exec(refRange);
  if (ge) return n < Number(ge[1]) ? 'L' : 'N';
  return '';
}

export function FlagBadge({ flag }: { flag?: string }) {
  if (flag === 'H') return <Badge variant="danger">High ↑</Badge>;
  if (flag === 'L') return <Badge variant="info">Low ↓</Badge>;
  if (flag === 'N') return <Badge variant="success">Normal</Badge>;
  return null;
}

const STEPS = ['ordered', 'sample_collected', 'completed', 'verified'];

export default function LabOrderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const f = useFmt();
  const { data: o, isLoading } = useQuery({ queryKey: ['lab-order', id], queryFn: () => api.get<Order>(`/lab/orders/${id}`) });
  const [values, setValues] = useState<Record<number, ResultValue[]>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [cancel, setCancel] = useState(false);

  useEffect(() => {
    if (!o) return;
    setValues(Object.fromEntries(o.items.map((i) => [i.id, i.results.map((r) => ({ ...r }))])));
    setNotes(Object.fromEntries(o.items.map((i) => [i.id, i.resultNotes ?? ''])));
  }, [o]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['lab-order', id] });
    qc.invalidateQueries({ queryKey: ['lab-orders'] });
  };
  const collect = useMutation({ mutationFn: () => api.post(`/lab/orders/${id}/collect`, {}), onSuccess: () => { toast.success('Sample collected'); refresh(); }, onError: (e) => toast.error(errMsg(e)) });
  const saveResults = useMutation({
    mutationFn: (complete: boolean) =>
      api.put(`/lab/orders/${id}/results`, {
        complete,
        items: Object.entries(values).map(([itemId, results]) => ({ id: Number(itemId), results: results.map((r) => ({ parameter: r.parameter, value: r.value })), resultNotes: notes[Number(itemId)] || null })),
      }),
    onSuccess: (_, complete) => {
      toast.success(complete ? 'Results completed — awaiting verification' : 'Results saved');
      refresh();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const verify = useMutation({ mutationFn: () => api.post(`/lab/orders/${id}/verify`), onSuccess: () => { toast.success('Report verified and released'); refresh(); }, onError: (e) => toast.error(errMsg(e)) });
  const cancelM = useMutation({ mutationFn: () => api.post(`/lab/orders/${id}/cancel`), onSuccess: () => { toast.success('Order cancelled'); setCancel(false); refresh(); }, onError: (e) => toast.error(errMsg(e)) });

  if (isLoading || !o) return <Skeleton className="h-96 w-full" />;
  const editable = o.status === 'sample_collected' || o.status === 'completed';
  const canEdit = editable && can('lab.result');
  const stepIdx = STEPS.indexOf(o.status);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft /> Back
        </Button>
        <div className="flex flex-wrap gap-2">
          {o.status === 'verified' ? (
            <Button variant="outline" asChild>
              <Link to={`/print/lab/${o.id}`} target="_blank">
                <Printer /> Print report
              </Link>
            </Button>
          ) : null}
          {['ordered', 'sample_collected'].includes(o.status) && can('lab.order') ? (
            <Button variant="outline" onClick={() => setCancel(true)}>
              <Ban /> Cancel
            </Button>
          ) : null}
          {o.status === 'ordered' && can('lab.result') ? (
            <Button loading={collect.isPending} onClick={() => collect.mutate()}>
              <TestTube /> Collect sample
            </Button>
          ) : null}
          {canEdit ? (
            <>
              <Button variant="outline" loading={saveResults.isPending && !saveResults.variables} onClick={() => saveResults.mutate(false)}>
                <Save /> Save
              </Button>
              {o.status === 'sample_collected' ? (
                <Button loading={saveResults.isPending && saveResults.variables} onClick={() => saveResults.mutate(true)}>
                  <CheckCircle2 /> Complete
                </Button>
              ) : null}
            </>
          ) : null}
          {o.status === 'completed' && can('lab.verify') ? (
            <Button variant="success" loading={verify.isPending} onClick={() => verify.mutate()}>
              <BadgeCheck /> Verify & release
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-lg font-semibold">{o.orderNo}</p>
            <p className="text-sm text-muted-foreground">
              <Link to={`/patients/${o.patient.id}`} className="font-medium text-foreground hover:text-primary">
                {o.patient.name}
              </Link>{' '}
              · {o.patient.uhid} · {ageOf(o.patient.dob) ?? '—'} yrs · {titleCase(o.patient.gender)}
            </p>
          </div>
          <div className="flex gap-2">
            {o.priority !== 'routine' ? <StatusBadge status={o.priority} /> : null}
            <StatusBadge status={o.status} />
          </div>
        </div>
        {o.status !== 'cancelled' ? (
          <div className="mt-5 grid grid-cols-4 gap-2">
            {['Ordered', 'Sample collected', 'Results entered', 'Verified'].map((s, i) => (
              <div key={s}>
                <div className={cn('h-1.5 rounded-full', i <= stepIdx ? 'bg-primary' : 'bg-muted')} />
                <p className={cn('mt-1.5 text-xs', i <= stepIdx ? 'font-medium' : 'text-muted-foreground')}>{s}</p>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <div className="grid gap-5 [&>*]:min-w-0 xl:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-4">
          {o.items.map((it) => (
            <SectionCard key={it.id} title={it.testName} description={[it.category, it.sampleType].filter(Boolean).join(' · ')} bodyClassName="p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Parameter</th>
                    <th className="px-2 py-2 text-left">Result</th>
                    <th className="px-2 py-2 text-left">Unit</th>
                    <th className="px-2 py-2 text-left">Reference</th>
                    <th className="px-4 py-2 text-left">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {(values[it.id] ?? it.results).map((r, idx) => {
                    const flag = canEdit ? previewFlag(r.value, r.refRange) : r.flag;
                    return (
                      <tr key={r.parameter} className="border-t">
                        <td className="px-4 py-2 font-medium">{r.parameter}</td>
                        <td className="px-2 py-2">
                          {canEdit ? (
                            <Input
                              className={cn('h-8 w-32 tabular-nums', flag === 'H' && 'border-destructive text-destructive', flag === 'L' && 'border-info text-info')}
                              value={r.value}
                              onChange={(e) => setValues((v) => ({ ...v, [it.id]: v[it.id].map((x, j) => (j === idx ? { ...x, value: e.target.value } : x)) }))}
                            />
                          ) : (
                            <span className={cn('font-semibold tabular-nums', flag === 'H' && 'text-destructive', flag === 'L' && 'text-info')}>{r.value || '—'}</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">{r.unit}</td>
                        <td className="px-2 py-2 text-muted-foreground">{r.refRange}</td>
                        <td className="px-4 py-2">
                          <FlagBadge flag={flag} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {canEdit || it.resultNotes ? (
                <div className="border-t p-3">
                  {canEdit ? (
                    <Textarea rows={1} placeholder="Interpretation / remarks" value={notes[it.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [it.id]: e.target.value }))} />
                  ) : (
                    <p className="text-sm text-muted-foreground">Remarks: {it.resultNotes}</p>
                  )}
                </div>
              ) : null}
            </SectionCard>
          ))}
        </div>
        <SectionCard title="Order details">
          <InfoRow label="Referred by" value={o.doctorName ?? 'Self'} />
          <InfoRow label="Sample ID" value={o.sampleId} />
          <InfoRow label="Ordered" value={f.dateTime(o.createdAt)} />
          <InfoRow label="Collected" value={o.collectedAt ? f.dateTime(o.collectedAt) : null} />
          <InfoRow label="Completed" value={o.completedAt ? f.dateTime(o.completedAt) : null} />
          <InfoRow label="Verified" value={o.verifiedAt ? f.dateTime(o.verifiedAt) : null} />
          {o.invoiceId && can('billing.view') ? (
            <Button variant="outline" size="sm" className="mt-3 w-full" asChild>
              <Link to={`/billing/invoices/${o.invoiceId}`}>View invoice</Link>
            </Button>
          ) : null}
        </SectionCard>
      </div>
      <ConfirmDialog open={cancel} onOpenChange={setCancel} title={`Cancel ${o.orderNo}?`} description="An unpaid lab invoice is cancelled with it." destructive confirmLabel="Cancel order" loading={cancelM.isPending} onConfirm={() => cancelM.mutate()} />
    </div>
  );
}
