import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Plus, Receipt, Trash2, Wallet } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { titleCase, useFmt } from '@/lib/format';
import type { Paged, PatientRow } from '@/lib/types';
import { downloadCsv } from '@/lib/utils';
import {
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { DataTable, EmptyState, Field, PageHeader, Pagination, PatientPicker, SearchInput, StatusBadge, useDebounced } from '@/components/common';

interface InvoiceRow {
  id: number;
  invoiceNo: string;
  type: string;
  status: string;
  total: number;
  amountPaid: number;
  balance: number;
  createdAt: string;
  patientId: number;
  patientName: string;
  uhid: string;
}
interface PaymentRow {
  id: number;
  receiptNo: string;
  amount: number;
  method: string;
  reference: string | null;
  isRefund: boolean;
  paidAt: string;
  invoiceId: number;
  invoiceNo: string;
  patientName: string;
  uhid: string;
  receivedByName: string | null;
}
interface Service {
  id: number;
  name: string;
  category: string;
  price: number;
  taxRate: number;
}
interface Line {
  refId?: number | null;
  itemType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
}

export const PAYMENT_METHODS = ['cash', 'upi', 'card', 'netbanking', 'cheque', 'insurance', 'wallet'];

function NewInvoiceDialog({ open, onOpenChange, patientId }: { open: boolean; onOpenChange: (o: boolean) => void; patientId?: string | null }) {
  const f = useFmt();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { can, session } = useAuth();
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [collect, setCollect] = useState(true);
  const [method, setMethod] = useState('cash');
  const [notes, setNotes] = useState('');
  const services = useQuery({ queryKey: ['services', 'all'], queryFn: () => api.get<Service[]>('/masters/services', { all: 1, active: 'true' }), enabled: open });

  useEffect(() => {
    if (!open) return;
    setLines([]);
    setNotes('');
    setCollect(can('billing.payment'));
    if (patientId) api.get<PatientRow>(`/patients/${patientId}`).then(setPatient).catch(() => setPatient(null));
    else setPatient(null);
  }, [open, patientId, can]);

  const totals = useMemo(() => {
    let sub = 0,
      disc = 0,
      tax = 0;
    for (const l of lines) {
      const g = l.quantity * l.unitPrice;
      const d = Math.min(l.discount, g);
      sub += g;
      disc += d;
      tax += ((g - d) * l.taxRate) / 100;
    }
    return { sub, disc, tax, total: Math.round((sub - disc + tax) * 100) / 100 };
  }, [lines]);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: number; invoiceNo: string }>('/billing/invoices', {
        patientId: patient!.id,
        type: 'general',
        notes: notes || null,
        items: lines.filter((l) => l.description.trim()).map((l) => ({ ...l, itemType: l.itemType || 'service' })),
        payment: collect && totals.total > 0 ? { amount: totals.total, method } : undefined,
      }),
    onSuccess: (r) => {
      toast.success(`Invoice ${r.invoiceNo} created`);
      qc.invalidateQueries({ queryKey: ['invoices'] });
      onOpenChange(false);
      navigate(`/billing/invoices/${r.id}`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const upd = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>Totals are recalculated by the server; {session?.settings?.billing.taxLabel ?? 'Tax'} applies per line.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label="Patient" required>
            <PatientPicker value={patient} onChange={setPatient} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <NativeSelect
              value=""
              className="w-72"
              onChange={(e) => {
                const s = services.data?.find((x) => String(x.id) === e.target.value);
                if (s) setLines((ls) => [...ls, { refId: s.id, itemType: 'service', description: s.name, quantity: 1, unitPrice: s.price, discount: 0, taxRate: s.taxRate }]);
              }}
            >
              <option value="">+ Add from service catalogue…</option>
              {services.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {f.money(s.price)}
                </option>
              ))}
            </NativeSelect>
            <Button variant="outline" onClick={() => setLines((ls) => [...ls, { itemType: 'other', description: '', quantity: 1, unitPrice: 0, discount: 0, taxRate: session?.settings?.billing.defaultTaxRate ?? 0 }])}>
              <Plus /> Custom line
            </Button>
          </div>
          {lines.length ? (
            <div className="overflow-x-auto rounded-lg border scrollbar-thin">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Description</th>
                    <th className="px-2 py-2 text-left">Qty</th>
                    <th className="px-2 py-2 text-left">Rate</th>
                    <th className="px-2 py-2 text-left">Discount</th>
                    <th className="px-2 py-2 text-left">Tax %</th>
                    <th className="px-2 py-2 text-right">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const g = l.quantity * l.unitPrice;
                    const amt = g - Math.min(l.discount, g) + ((g - Math.min(l.discount, g)) * l.taxRate) / 100;
                    return (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2">
                          <Input value={l.description} onChange={(e) => upd(i, { description: e.target.value })} />
                        </td>
                        <td className="px-2 py-2">
                          <Input type="number" min={1} className="w-16" value={l.quantity} onChange={(e) => upd(i, { quantity: Number(e.target.value) })} />
                        </td>
                        <td className="px-2 py-2">
                          <Input type="number" min={0} className="w-24" value={l.unitPrice} onChange={(e) => upd(i, { unitPrice: Number(e.target.value) })} />
                        </td>
                        <td className="px-2 py-2">
                          <Input type="number" min={0} className="w-20" value={l.discount} onChange={(e) => upd(i, { discount: Number(e.target.value) })} />
                        </td>
                        <td className="px-2 py-2">
                          <Input type="number" min={0} max={100} className="w-16" value={l.taxRate} onChange={(e) => upd(i, { taxRate: Number(e.target.value) })} />
                        </td>
                        <td className="px-2 py-2 text-right font-medium tabular-nums">{f.money(amt)}</td>
                        <td className="px-2 py-2">
                          <Button variant="ghost" size="icon-sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove line">
                            <Trash2 />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Add services or custom lines to build the bill.</p>
          )}
          <div className="grid gap-4 md:grid-cols-[1fr_280px]">
            <div className="flex flex-col gap-3">
              <Field label="Notes">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              {can('billing.payment') ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={collect} onCheckedChange={setCollect} /> Collect full payment now
                  </label>
                  {collect ? (
                    <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)} className="w-36">
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m.toUpperCase()}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="rounded-lg bg-muted/40 p-4 text-sm">
              <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Subtotal</span><span>{f.money(totals.sub)}</span></div>
              <div className="flex justify-between py-0.5"><span className="text-muted-foreground">Discount</span><span>− {f.money(totals.disc)}</span></div>
              <div className="flex justify-between py-0.5"><span className="text-muted-foreground">{session?.settings?.billing.taxLabel ?? 'Tax'}</span><span>{f.money(totals.tax)}</span></div>
              <div className="mt-2 flex justify-between border-t pt-2 text-base font-semibold"><span>Total</span><span>{f.money(totals.total)}</span></div>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!patient || !lines.some((l) => l.description.trim())} loading={create.isPending} onClick={() => create.mutate()}>
            Create invoice{collect && totals.total > 0 ? ' & collect' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function BillingPage() {
  const { can } = useAuth();
  const f = useFmt();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [due, setDue] = useState(params.get('due') === '1');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const invoices = useQuery({
    queryKey: ['invoices', dq, status, type, due, from, to, page],
    queryFn: () => api.get<Paged<InvoiceRow>>('/billing/invoices', { q: dq, status, type, due: due || undefined, from, to, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });

  const [pq, setPq] = useState('');
  const [method, setMethod] = useState('');
  const [ppage, setPpage] = useState(1);
  const dpq = useDebounced(pq);
  const pays = useQuery({
    queryKey: ['payments', dpq, method, from, to, ppage],
    queryFn: () => api.get<Paged<PaymentRow>>('/billing/payments', { q: dpq, method, from, to, page: ppage, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        icon={Receipt}
        title="Billing"
        description="Invoices, receipts and collections"
        actions={
          can('billing.create') ? (
            <Button onClick={() => setParams({ new: '1' })}>
              <Plus /> New invoice
            </Button>
          ) : null
        }
      />
      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">
            <Receipt /> Invoices
          </TabsTrigger>
          <TabsTrigger value="payments">
            <Wallet /> Receipts
          </TabsTrigger>
        </TabsList>
        <Card className="mt-4 flex flex-wrap items-end gap-3 p-3">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </Field>
        </Card>
        <TabsContent value="invoices">
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Invoice no, patient or UHID" className="w-full max-w-xs" />
              <NativeSelect value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40">
                <option value="">All statuses</option>
                {['draft', 'unpaid', 'partially_paid', 'paid', 'refunded', 'cancelled'].map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="w-36">
                <option value="">All types</option>
                {['opd', 'ipd', 'pharmacy', 'lab', 'general'].map((s) => (
                  <option key={s} value={s}>
                    {s.toUpperCase()}
                  </option>
                ))}
              </NativeSelect>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={due} onCheckedChange={(v) => { setDue(v); setPage(1); }} /> Dues only
              </label>
              <div className="ml-auto flex items-center gap-4 text-sm">
                <span className="text-muted-foreground">
                  Billed <b className="text-foreground">{f.money(invoices.data?.totals?.total)}</b>
                </span>
                <span className="text-muted-foreground">
                  Due <b className="text-destructive">{f.money(invoices.data?.totals?.balance)}</b>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    downloadCsv('invoices.csv', (invoices.data?.data ?? []).map((i) => ({ invoice: i.invoiceNo, date: i.createdAt, patient: i.patientName, uhid: i.uhid, type: i.type, status: i.status, total: i.total, paid: i.amountPaid, balance: i.balance })))
                  }
                >
                  <Download /> CSV
                </Button>
              </div>
            </div>
            <DataTable
              rows={invoices.data?.data}
              loading={invoices.isLoading}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/billing/invoices/${r.id}`)}
              empty={<EmptyState icon={Receipt} title="No invoices found" />}
              columns={[
                { key: 'no', header: 'Invoice', cell: (r) => <span className="font-mono text-xs font-medium">{r.invoiceNo}</span> },
                { key: 'date', header: 'Date', cell: (r) => f.date(r.createdAt) },
                {
                  key: 'patient',
                  header: 'Patient',
                  cell: (r) => (
                    <Link to={`/patients/${r.patientId}`} onClick={(e) => e.stopPropagation()} className="hover:text-primary">
                      <span className="block font-medium">{r.patientName}</span>
                      <span className="text-xs text-muted-foreground">{r.uhid}</span>
                    </Link>
                  ),
                },
                { key: 'type', header: 'Type', cell: (r) => <span className="text-xs uppercase">{r.type}</span>, className: 'hidden md:table-cell' },
                { key: 'total', header: 'Total', cell: (r) => <span className="tabular-nums">{f.money(r.total)}</span> },
                { key: 'bal', header: 'Balance', cell: (r) => <span className={r.balance > 0 ? 'font-medium text-destructive tabular-nums' : 'text-muted-foreground tabular-nums'}>{f.money(r.balance)}</span> },
                { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
            {invoices.data ? <Pagination page={page} pageSize={invoices.data.pageSize} total={invoices.data.total} onPage={setPage} /> : null}
          </Card>
        </TabsContent>
        <TabsContent value="payments">
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              <SearchInput value={pq} onChange={(v) => { setPq(v); setPpage(1); }} placeholder="Receipt no or patient" className="w-full max-w-xs" />
              <NativeSelect value={method} onChange={(e) => { setMethod(e.target.value); setPpage(1); }} className="w-36">
                <option value="">All modes</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m.toUpperCase()}
                  </option>
                ))}
              </NativeSelect>
              <span className="ml-auto text-sm text-muted-foreground">
                Net collected <b className="text-foreground">{f.money(pays.data?.totals?.net)}</b>
              </span>
            </div>
            <DataTable
              rows={pays.data?.data}
              loading={pays.isLoading}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/billing/invoices/${r.invoiceId}`)}
              columns={[
                { key: 'no', header: 'Receipt', cell: (r) => <span className="font-mono text-xs">{r.receiptNo}</span> },
                { key: 'date', header: 'Paid at', cell: (r) => f.dateTime(r.paidAt) },
                { key: 'patient', header: 'Patient', cell: (r) => r.patientName },
                { key: 'inv', header: 'Invoice', cell: (r) => <span className="font-mono text-xs">{r.invoiceNo}</span>, className: 'hidden md:table-cell' },
                { key: 'mode', header: 'Mode', cell: (r) => <span className="uppercase">{r.method}</span> },
                { key: 'by', header: 'Received by', cell: (r) => r.receivedByName ?? '—', className: 'hidden lg:table-cell' },
                { key: 'amt', header: 'Amount', cell: (r) => <span className={r.isRefund ? 'text-destructive tabular-nums' : 'font-medium tabular-nums'}>{f.money(r.amount)}</span> },
              ]}
            />
            {pays.data ? <Pagination page={ppage} pageSize={pays.data.pageSize} total={pays.data.total} onPage={setPpage} /> : null}
          </Card>
        </TabsContent>
      </Tabs>
      <NewInvoiceDialog open={params.get('new') === '1'} patientId={params.get('patient')} onOpenChange={(o) => !o && setParams({})} />
    </>
  );
}
