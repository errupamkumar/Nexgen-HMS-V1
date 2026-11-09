import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Ban, CheckCircle2, Printer, Trash2, Undo2, Wallet } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { titleCase, useFmt } from '@/lib/format';
import type { Invoice } from '@/lib/types';
import {
  Badge,
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
  Skeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@/components/ui';
import { ConfirmDialog, Field, SectionCard, StatusBadge } from '@/components/common';
import { PAYMENT_METHODS } from './BillingPage';

export function PaymentDialog({
  invoice,
  open,
  onOpenChange,
  refund,
}: {
  invoice: Pick<Invoice, 'id' | 'invoiceNo' | 'balance' | 'amountPaid'>;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  refund?: boolean;
}) {
  const f = useFmt();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (open) {
      setAmount(String(refund ? invoice.amountPaid : Math.max(0, invoice.balance)));
      setReference('');
      setNotes('');
      setMethod(refund ? 'cash' : 'upi');
    }
  }, [open, invoice, refund]);
  const m = useMutation({
    mutationFn: () => api.post<{ receiptNo: string }>(`/billing/invoices/${invoice.id}/${refund ? 'refund' : 'payments'}`, { amount: Number(amount), method, reference: reference || null, notes: notes || null }),
    onSuccess: (r) => {
      toast.success(`${refund ? 'Refund' : 'Payment'} recorded — ${r.receiptNo}`);
      qc.invalidateQueries({ queryKey: ['invoice'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['queue'] });
      qc.invalidateQueries({ queryKey: ['admission'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{refund ? 'Issue refund' : 'Collect payment'}</DialogTitle>
          <DialogDescription>
            {invoice.invoiceNo} · {refund ? `Paid ${f.money(invoice.amountPaid)}` : `Balance ${f.money(invoice.balance)}`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field label="Amount" required>
            <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <Field label="Mode">
            <div className="grid grid-cols-4 gap-1.5">
              {PAYMENT_METHODS.slice(0, 4).map((pm) => (
                <button
                  key={pm}
                  type="button"
                  onClick={() => setMethod(pm)}
                  className={`cursor-pointer rounded-lg border py-2 text-xs font-medium uppercase transition ${method === pm ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'}`}
                >
                  {pm}
                </button>
              ))}
            </div>
            <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1.5">
              {PAYMENT_METHODS.map((pm) => (
                <option key={pm} value={pm}>
                  {pm.toUpperCase()}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Reference" hint="UPI txn id, card last 4, cheque no.">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          {refund ? (
            <Field label="Reason" required>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Test not performed" />
            </Field>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={refund ? 'destructive' : 'success'} disabled={!(Number(amount) > 0) || (refund && notes.trim().length < 3)} loading={m.isPending} onClick={() => m.mutate()}>
            {refund ? 'Refund' : 'Record'} {f.money(Number(amount) || 0)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function InvoicePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const { can, session } = useAuth();
  const f = useFmt();
  const [refund, setRefund] = useState(false);
  const [cancel, setCancel] = useState(false);
  const { data: inv, isLoading } = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<Invoice>(`/billing/invoices/${id}`) });
  const pay = params.get('pay') === '1';

  const cancelM = useMutation({
    mutationFn: (reason: string) => api.post(`/billing/invoices/${id}/cancel`, { reason }),
    onSuccess: () => {
      toast.success('Invoice cancelled');
      setCancel(false);
      qc.invalidateQueries({ queryKey: ['invoice', id] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const finalize = useMutation({
    mutationFn: () => api.post(`/billing/invoices/${id}/finalize`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoice', id] }),
    onError: (e) => toast.error(errMsg(e)),
  });
  const removeItem = useMutation({
    mutationFn: (itemId: number) => api.del(`/billing/invoices/${id}/items/${itemId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invoice', id] }),
    onError: (e) => toast.error(errMsg(e)),
  });

  if (isLoading || !inv) return <Skeleton className="h-96 w-full" />;
  const editable = ['draft', 'unpaid', 'partially_paid'].includes(inv.status) && can('billing.create');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft /> Back
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to={`/print/invoice/${inv.id}`} target="_blank">
              <Printer /> Print
            </Link>
          </Button>
          {inv.status === 'draft' && !inv.admissionId && can('billing.create') ? (
            <Button variant="outline" loading={finalize.isPending} onClick={() => finalize.mutate()}>
              <CheckCircle2 /> Finalise
            </Button>
          ) : null}
          {inv.amountPaid > 0 && can('billing.refund') && inv.status !== 'cancelled' ? (
            <Button variant="outline" onClick={() => setRefund(true)}>
              <Undo2 /> Refund
            </Button>
          ) : null}
          {inv.amountPaid <= 0 && can('billing.cancel') && inv.status !== 'cancelled' && !(inv.admissionId && inv.status === 'draft') ? (
            <Button variant="outline" onClick={() => setCancel(true)}>
              <Ban /> Cancel
            </Button>
          ) : null}
          {inv.balance > 0 && inv.status !== 'cancelled' && can('billing.payment') ? (
            <Button variant="success" onClick={() => setParams({ pay: '1' })}>
              <Wallet /> Collect {f.money(inv.balance)}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 [&>*]:min-w-0 xl:grid-cols-[1fr_360px]">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b bg-gradient-to-r from-primary/8 to-transparent p-5">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{titleCase(inv.type)} invoice</p>
              <h1 className="mt-1 font-mono text-xl font-semibold">{inv.invoiceNo}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {f.dateTime(inv.createdAt)}
                {inv.createdByName ? ` · by ${inv.createdByName}` : ''}
              </p>
            </div>
            <div className="text-right">
              <StatusBadge status={inv.status} className="text-xs" />
              <p className="mt-2 text-2xl font-semibold">{f.money(inv.total)}</p>
              {inv.balance > 0 ? <p className="text-sm text-destructive">Balance {f.money(inv.balance)}</p> : inv.balance < 0 ? <p className="text-sm text-warning">Refund due {f.money(-inv.balance)}</p> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-6 border-b px-5 py-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Billed to</p>
              <Link to={`/patients/${inv.patient.id}`} className="font-medium hover:text-primary">
                {inv.patient.name}
              </Link>
              <p className="text-xs text-muted-foreground">
                {inv.patient.uhid} · {inv.patient.phone}
              </p>
            </div>
            {inv.notes ? (
              <div>
                <p className="text-xs text-muted-foreground">Notes</p>
                <p>{inv.notes}</p>
              </div>
            ) : null}
            {inv.cancelReason ? (
              <div>
                <p className="text-xs text-muted-foreground">Cancellation reason</p>
                <p className="text-destructive">{inv.cancelReason}</p>
              </div>
            ) : null}
          </div>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>#</TH>
                <TH>Description</TH>
                <TH className="text-right">Qty</TH>
                <TH className="text-right">Rate</TH>
                <TH className="hidden text-right md:table-cell">Disc.</TH>
                <TH className="hidden text-right md:table-cell">{session?.settings?.billing.taxLabel ?? 'Tax'}</TH>
                <TH className="text-right">Amount</TH>
                {editable ? <TH /> : null}
              </TR>
            </THead>
            <TBody>
              {inv.items.map((it, i) => (
                <TR key={it.id}>
                  <TD className="text-muted-foreground">{i + 1}</TD>
                  <TD>
                    {it.description}
                    <Badge variant="muted" className="ml-2">
                      {titleCase(it.itemType)}
                    </Badge>
                  </TD>
                  <TD className="text-right tabular-nums">{it.quantity}</TD>
                  <TD className="text-right tabular-nums">{f.money(it.unitPrice)}</TD>
                  <TD className="hidden text-right tabular-nums md:table-cell">{it.discount ? f.money(it.discount) : '—'}</TD>
                  <TD className="hidden text-right tabular-nums md:table-cell">{it.taxRate ? `${it.taxRate}%` : '—'}</TD>
                  <TD className="text-right font-medium tabular-nums">{f.money(it.amount)}</TD>
                  {editable ? (
                    <TD>
                      {!it.batchId ? (
                        <Button variant="ghost" size="icon-sm" onClick={() => removeItem.mutate(it.id)} aria-label="Remove line">
                          <Trash2 />
                        </Button>
                      ) : null}
                    </TD>
                  ) : null}
                </TR>
              ))}
              {inv.items.length === 0 ? (
                <TR>
                  <TD colSpan={8} className="py-8 text-center text-muted-foreground">
                    No line items yet {inv.admissionId ? '— charges are added from the admission page' : ''}
                  </TD>
                </TR>
              ) : null}
            </TBody>
          </Table>
          <div className="ml-auto w-full max-w-xs p-5 text-sm">
            <div className="flex justify-between py-1"><span className="text-muted-foreground">Subtotal</span><span>{f.money(inv.subtotal)}</span></div>
            <div className="flex justify-between py-1"><span className="text-muted-foreground">Discount</span><span>− {f.money(inv.discountTotal)}</span></div>
            <div className="flex justify-between py-1"><span className="text-muted-foreground">{session?.settings?.billing.taxLabel ?? 'Tax'}</span><span>{f.money(inv.taxTotal)}</span></div>
            <div className="mt-1 flex justify-between border-t pt-2 text-base font-semibold"><span>Total</span><span>{f.money(inv.total)}</span></div>
            <div className="flex justify-between py-1 text-success"><span>Paid</span><span>{f.money(inv.amountPaid)}</span></div>
            <div className="flex justify-between py-1 font-semibold"><span>Balance</span><span>{f.money(inv.balance)}</span></div>
          </div>
        </Card>

        <SectionCard title="Payments & refunds" bodyClassName="p-0">
          {inv.payments.length ? (
            <ul className="divide-y">
              {inv.payments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={`flex size-9 items-center justify-center rounded-lg ${p.isRefund ? 'bg-destructive/10 text-destructive' : 'bg-success/12 text-success'}`}>
                    {p.isRefund ? <Undo2 className="size-4" /> : <Wallet className="size-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {p.receiptNo} <span className="text-xs uppercase text-muted-foreground">· {p.method}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {f.dateTime(p.paidAt)}
                      {p.receivedByName ? ` · ${p.receivedByName}` : ''}
                      {p.reference ? ` · ${p.reference}` : ''}
                    </p>
                    {p.notes ? <p className="text-xs text-muted-foreground">{p.notes}</p> : null}
                  </div>
                  <span className={`font-semibold tabular-nums ${p.isRefund ? 'text-destructive' : ''}`}>{f.money(p.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">No payments recorded.</p>
          )}
        </SectionCard>
      </div>

      <PaymentDialog invoice={inv} open={pay} onOpenChange={(o) => !o && setParams({})} />
      <PaymentDialog invoice={inv} open={refund} onOpenChange={setRefund} refund />
      <ConfirmDialog
        open={cancel}
        onOpenChange={setCancel}
        title={`Cancel ${inv.invoiceNo}?`}
        description="Cancelled invoices stay in the ledger for audit with the reason recorded."
        destructive
        confirmLabel="Cancel invoice"
        reason={{ label: 'Reason', placeholder: 'e.g. Duplicate bill' }}
        loading={cancelM.isPending}
        onConfirm={(r) => cancelM.mutate(r)}
      />
    </div>
  );
}
