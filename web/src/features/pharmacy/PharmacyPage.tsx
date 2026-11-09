import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Boxes, PackagePlus, Pill, Plus, ShoppingCart, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDaysStr, todayIn, useFmt } from '@/lib/format';
import type { Paged, PatientRow, RxItem } from '@/lib/types';
import { cn } from '@/lib/utils';
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
  SheetContent,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { DataTable, EmptyState, Field, PageHeader, Pagination, PatientChip, PatientPicker, SearchInput, StatusBadge, useDebounced } from '@/components/common';
import { PAYMENT_METHODS } from '../billing/BillingPage';

interface StockRow {
  id: number;
  name: string;
  genericName: string | null;
  form: string | null;
  strength: string | null;
  unit: string;
  reorderLevel: number;
  salePrice: number;
  taxRate: number;
  onHand: number;
  expiredQty: number;
  nearestExpiry: string | null;
  low: boolean;
  expiringSoon: boolean;
}
interface RxQueueRow {
  encounterId: number;
  finalizedAt: string;
  patientId: number;
  patientName: string;
  uhid: string;
  phone: string;
  allergies: string[];
  doctorName: string;
  items: (RxItem & { id: number })[];
}
interface Batch {
  id: number;
  batchNo: string;
  expiryDate: string;
  quantity: number;
  purchasePrice: number;
  mrp: number;
  salePrice: number;
  supplier: string | null;
  receivedAt: string;
}
interface Movement {
  id: number;
  type: string;
  quantity: number;
  notes: string | null;
  createdAt: string;
  byName: string | null;
  batchId: number;
}
interface Med {
  id: number;
  name: string;
  strength: string | null;
  salePrice: number;
}

interface DispLine {
  medicineId: string;
  quantity: number;
  prescriptionItemId?: number;
  label?: string;
}

function DispenseDialog({ open, onOpenChange, rx }: { open: boolean; onOpenChange: (o: boolean) => void; rx: RxQueueRow | null }) {
  const qc = useQueryClient();
  const f = useFmt();
  const { can } = useAuth();
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [lines, setLines] = useState<DispLine[]>([]);
  const [discount, setDiscount] = useState(0);
  const [collect, setCollect] = useState(true);
  const [method, setMethod] = useState('cash');
  const meds = useQuery({ queryKey: ['medicines', 'all'], queryFn: () => api.get<Med[]>('/masters/medicines', { all: 1, active: 'true' }), enabled: open });

  useEffect(() => {
    if (!open) return;
    setDiscount(0);
    setCollect(can('billing.payment'));
    if (rx) {
      setPatient({ id: rx.patientId, name: rx.patientName, uhid: rx.uhid, phone: rx.phone } as PatientRow);
      setLines(
        rx.items.map((i) => ({
          medicineId: i.medicineId ? String(i.medicineId) : '',
          quantity: Math.max(0, (i.quantity || 1) - (i.dispensedQty ?? 0)),
          prescriptionItemId: i.id,
          label: `${i.medicineName} · ${i.dose ?? ''} ${i.frequency ?? ''} × ${i.durationDays ?? '—'}d`,
        })),
      );
    } else {
      setPatient(null);
      setLines([{ medicineId: '', quantity: 1 }]);
    }
  }, [open, rx, can]);

  const est = useMemo(
    () => lines.reduce((s, l) => s + (meds.data?.find((m) => String(m.id) === l.medicineId)?.salePrice ?? 0) * l.quantity, 0) - discount,
    [lines, meds.data, discount],
  );

  const m = useMutation({
    mutationFn: () =>
      api.post<{ invoiceId: number; invoiceNo: string; total: number }>('/pharmacy/dispense', {
        patientId: patient!.id,
        encounterId: rx?.encounterId ?? null,
        discount,
        items: lines.filter((l) => l.medicineId && l.quantity > 0).map((l) => ({ medicineId: Number(l.medicineId), quantity: l.quantity, prescriptionItemId: l.prescriptionItemId ?? null })),
        payment: collect ? { method } : undefined,
      }),
    onSuccess: (r) => {
      toast.success(`Dispensed — ${r.invoiceNo}`, { description: `Bill ${f.money(r.total)} (earliest-expiry batches used)` });
      qc.invalidateQueries({ queryKey: ['rx-queue'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const valid = patient && lines.some((l) => l.medicineId && l.quantity > 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{rx ? 'Dispense prescription' : 'Counter sale'}</DialogTitle>
          <DialogDescription>Stock is allocated first-expiry-first-out; expired batches are never dispensed.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {rx ? (
            <div className="rounded-lg border bg-muted/30 p-2.5">
              <PatientChip p={{ name: rx.patientName, uhid: rx.uhid, gender: 'other', dob: null, phone: rx.phone }} />
              <p className="mt-1 text-xs text-muted-foreground">Prescribed by {rx.doctorName}</p>
              {rx.allergies.length ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-destructive">
                  <AlertTriangle className="size-3.5" /> Allergies: {rx.allergies.join(', ')}
                </p>
              ) : null}
            </div>
          ) : (
            <Field label="Patient" required>
              <PatientPicker value={patient} onChange={setPatient} />
            </Field>
          )}
          <div className="flex flex-col gap-2">
            {lines.map((l, i) => (
              <div key={i} className="rounded-lg border p-2.5">
                {l.label ? <p className="mb-1.5 text-xs text-muted-foreground">Rx: {l.label}</p> : null}
                <div className="flex items-center gap-2">
                  <NativeSelect value={l.medicineId} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, medicineId: e.target.value } : x)))} className="flex-1">
                    <option value="">{l.label ? 'Not in catalogue — choose substitute or skip' : 'Select medicine…'}</option>
                    {meds.data?.map((md) => (
                      <option key={md.id} value={md.id}>
                        {md.name} {md.strength ?? ''} — {f.money(md.salePrice)}
                      </option>
                    ))}
                  </NativeSelect>
                  <Input type="number" min={0} className="w-20" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
                  <Button variant="ghost" size="icon-sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove line">
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" className="w-fit" onClick={() => setLines((ls) => [...ls, { medicineId: '', quantity: 1 }])}>
              <Plus /> Add item
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <Field label="Discount">
              <Input type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
            </Field>
            {can('billing.payment') ? (
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex h-9 items-center gap-2 text-sm">
                  <Switch checked={collect} onCheckedChange={setCollect} /> Collect payment
                </label>
                {collect ? (
                  <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)} className="w-32">
                    {PAYMENT_METHODS.map((pm) => (
                      <option key={pm} value={pm}>
                        {pm.toUpperCase()}
                      </option>
                    ))}
                  </NativeSelect>
                ) : null}
              </div>
            ) : null}
          </div>
          <p className="text-right text-sm text-muted-foreground">
            Estimated (before tax): <span className="text-base font-semibold text-foreground">{f.money(Math.max(0, est))}</span>
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid} loading={m.isPending} onClick={() => m.mutate()}>
            <ShoppingCart /> Dispense & bill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StockInDialog({ open, onOpenChange, medicine }: { open: boolean; onOpenChange: (o: boolean) => void; medicine?: StockRow | null }) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const today = todayIn(session?.settings?.locale.timezone ?? 'Asia/Kolkata');
  const meds = useQuery({ queryKey: ['medicines', 'all'], queryFn: () => api.get<Med[]>('/masters/medicines', { all: 1 }), enabled: open });
  const [f, setF] = useState({ medicineId: '', batchNo: '', expiryDate: addDaysStr(today, 365), quantity: '', purchasePrice: '', mrp: '', salePrice: '', supplier: '' });
  useEffect(() => {
    if (open) setF({ medicineId: medicine ? String(medicine.id) : '', batchNo: '', expiryDate: addDaysStr(today, 365), quantity: '', purchasePrice: '', mrp: '', salePrice: medicine ? String(medicine.salePrice) : '', supplier: '' });
  }, [open, medicine, today]);
  const m = useMutation({
    mutationFn: () =>
      api.post('/pharmacy/stock-in', {
        ...f,
        medicineId: Number(f.medicineId),
        quantity: Number(f.quantity),
        purchasePrice: Number(f.purchasePrice || 0),
        mrp: Number(f.mrp || 0),
        salePrice: f.salePrice ? Number(f.salePrice) : undefined,
        supplier: f.supplier || null,
      }),
    onSuccess: () => {
      toast.success('Stock received');
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['batches'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const s = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Stock in (purchase entry)</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Medicine" required className="sm:col-span-2">
            <NativeSelect value={f.medicineId} onChange={s('medicineId')}>
              <option value="">Select…</option>
              {meds.data?.map((md) => (
                <option key={md.id} value={md.id}>
                  {md.name} {md.strength ?? ''}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Batch no." required>
            <Input value={f.batchNo} onChange={s('batchNo')} />
          </Field>
          <Field label="Expiry date" required>
            <Input type="date" min={addDaysStr(today, 1)} value={f.expiryDate} onChange={s('expiryDate')} />
          </Field>
          <Field label="Quantity" required>
            <Input type="number" min={1} value={f.quantity} onChange={s('quantity')} />
          </Field>
          <Field label="Supplier">
            <Input value={f.supplier} onChange={s('supplier')} />
          </Field>
          <Field label="Purchase price">
            <Input type="number" min={0} step="0.01" value={f.purchasePrice} onChange={s('purchasePrice')} />
          </Field>
          <Field label="MRP">
            <Input type="number" min={0} step="0.01" value={f.mrp} onChange={s('mrp')} />
          </Field>
          <Field label="Sale price" hint="Defaults to the catalogue price">
            <Input type="number" min={0} step="0.01" value={f.salePrice} onChange={s('salePrice')} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!f.medicineId || !f.batchNo || !(Number(f.quantity) > 0)} loading={m.isPending} onClick={() => m.mutate()}>
            Receive stock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchesSheet({ med, onClose }: { med: StockRow | null; onClose: () => void }) {
  const f = useFmt();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [adjust, setAdjust] = useState<{ batch: Batch; qty: string; reason: string; type: string } | null>(null);
  const { data } = useQuery({
    queryKey: ['batches', med?.id],
    queryFn: () => api.get<{ batches: Batch[]; movements: Movement[]; today: string }>(`/pharmacy/medicines/${med!.id}/batches`),
    enabled: Boolean(med),
  });
  const adj = useMutation({
    mutationFn: () => api.post('/pharmacy/adjust', { batchId: adjust!.batch.id, quantity: Number(adjust!.qty), reason: adjust!.reason, type: adjust!.type }),
    onSuccess: () => {
      toast.success('Stock adjusted');
      setAdjust(null);
      qc.invalidateQueries({ queryKey: ['batches'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <DialogPrimitive.Root open={Boolean(med)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <div className="border-b p-5">
          <DialogPrimitive.Title className="text-lg font-semibold">{med?.name}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-sm text-muted-foreground">
            {med?.genericName} · On hand {med?.onHand} {med?.unit}
          </DialogPrimitive.Description>
        </div>
        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
          <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Batches (FEFO order)</p>
          <div className="flex flex-col gap-2">
            {data?.batches.map((b) => {
              const expired = b.expiryDate < data.today;
              return (
                <div key={b.id} className={cn('rounded-lg border p-3', expired && 'border-destructive/40 bg-destructive/5')}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-medium">{b.batchNo}</span>
                    <span className="text-sm font-semibold">{b.quantity}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Exp {f.date(b.expiryDate)} {expired ? <Badge variant="danger">Expired</Badge> : null}
                    </span>
                    <span>
                      MRP {f.money(b.mrp)} · Sale {f.money(b.salePrice)}
                    </span>
                  </div>
                  {can('pharmacy.manage') ? (
                    <button className="mt-1.5 cursor-pointer text-xs text-primary hover:underline" onClick={() => setAdjust({ batch: b, qty: expired ? String(-b.quantity) : '', reason: expired ? 'Expired stock written off' : '', type: expired ? 'expired' : 'adjustment' })}>
                      Adjust
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="mb-2 mt-6 text-xs font-semibold uppercase text-muted-foreground">Stock ledger</p>
          <ul className="divide-y rounded-lg border text-sm">
            {data?.movements.map((mv) => (
              <li key={mv.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div>
                  <p className="capitalize">{mv.type}</p>
                  <p className="text-xs text-muted-foreground">
                    {f.dateTime(mv.createdAt)} {mv.byName ? `· ${mv.byName}` : ''} {mv.notes ? `· ${mv.notes}` : ''}
                  </p>
                </div>
                <span className={cn('font-semibold tabular-nums', mv.quantity < 0 ? 'text-destructive' : 'text-success')}>
                  {mv.quantity > 0 ? '+' : ''}
                  {mv.quantity}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </SheetContent>
      <Dialog open={Boolean(adjust)} onOpenChange={(o) => !o && setAdjust(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Adjust batch {adjust?.batch.batchNo}</DialogTitle>
            <DialogDescription>Use a negative number to remove stock.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <Field label="Type">
              <NativeSelect value={adjust?.type} onChange={(e) => setAdjust((a) => a && { ...a, type: e.target.value })}>
                <option value="adjustment">Adjustment</option>
                <option value="return">Return to supplier</option>
                <option value="expired">Expired write-off</option>
              </NativeSelect>
            </Field>
            <Field label="Quantity (+/−)">
              <Input type="number" value={adjust?.qty ?? ''} onChange={(e) => setAdjust((a) => a && { ...a, qty: e.target.value })} />
            </Field>
            <Field label="Reason" required>
              <Input value={adjust?.reason ?? ''} onChange={(e) => setAdjust((a) => a && { ...a, reason: e.target.value })} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjust(null)}>
              Cancel
            </Button>
            <Button disabled={!adjust || !Number(adjust.qty) || adjust.reason.trim().length < 3} loading={adj.isPending} onClick={() => adj.mutate()}>
              Save adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DialogPrimitive.Root>
  );
}

export default function PharmacyPage() {
  const { tab = 'dispense' } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const f = useFmt();
  const [rx, setRx] = useState<RxQueueRow | null>(null);
  const [dispenseOpen, setDispenseOpen] = useState(false);
  const [stockIn, setStockIn] = useState<{ open: boolean; med?: StockRow | null }>({ open: false });
  const [sheet, setSheet] = useState<StockRow | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);

  const queue = useQuery({ queryKey: ['rx-queue'], queryFn: () => api.get<Paged<RxQueueRow>>('/pharmacy/prescriptions', { pageSize: 50 }), refetchInterval: 30_000 });
  const stock = useQuery({
    queryKey: ['stock', dq, filter, page],
    queryFn: () => api.get<Paged<StockRow>>('/pharmacy/stock', { q: dq, filter, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        icon={Pill}
        title="Pharmacy"
        description="Dispensing, counter sales and batch-level inventory"
        actions={
          <>
            {can('pharmacy.manage') ? (
              <Button variant="outline" onClick={() => setStockIn({ open: true })}>
                <PackagePlus /> Stock in
              </Button>
            ) : null}
            {can('pharmacy.dispense') ? (
              <Button
                onClick={() => {
                  setRx(null);
                  setDispenseOpen(true);
                }}
              >
                <ShoppingCart /> Counter sale
              </Button>
            ) : null}
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => navigate(`/pharmacy/${v}`)}>
        <TabsList>
          <TabsTrigger value="dispense">
            <Pill /> Prescriptions {queue.data?.total ? <Badge className="ml-1">{queue.data.total}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="stock">
            <Boxes /> Stock
          </TabsTrigger>
        </TabsList>
        <TabsContent value="dispense">
          {queue.data?.data.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {queue.data.data.map((r) => (
                <Card key={r.encounterId} className="flex flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link to={`/patients/${r.patientId}`} className="font-semibold hover:text-primary">
                        {r.patientName}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {r.uhid} · {r.doctorName}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">{f.dateTime(r.finalizedAt)}</span>
                  </div>
                  {r.allergies.length ? (
                    <p className="mt-2 flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="size-3.5" /> {r.allergies.join(', ')}
                    </p>
                  ) : null}
                  <ul className="mt-3 flex flex-1 flex-col gap-1 text-sm">
                    {r.items.map((i) => (
                      <li key={i.id} className="flex justify-between gap-2">
                        <span className={cn(!i.medicineId && 'text-muted-foreground')}>
                          {i.medicineName} <span className="text-xs text-muted-foreground">{i.frequency}</span>
                        </span>
                        <span className="tabular-nums text-muted-foreground">× {i.quantity}</span>
                      </li>
                    ))}
                  </ul>
                  {can('pharmacy.dispense') ? (
                    <Button
                      className="mt-4"
                      size="sm"
                      onClick={() => {
                        setRx(r);
                        setDispenseOpen(true);
                      }}
                    >
                      Dispense
                    </Button>
                  ) : null}
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState icon={Pill} title="No prescriptions waiting" description="Finalised consultations with medicines appear here automatically." />
            </Card>
          )}
        </TabsContent>
        <TabsContent value="stock">
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Medicine or generic name" className="w-full max-w-xs" />
              <div className="flex flex-wrap gap-1">
                {[
                  ['all', 'All'],
                  ['low', 'Low stock'],
                  ['out', 'Out of stock'],
                  ['expiring', 'Expiring soon'],
                  ['expired', 'Has expired'],
                ].map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => { setFilter(k); setPage(1); }}
                    className={cn('cursor-pointer rounded-full border px-3 py-1 text-xs transition', filter === k ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent')}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <DataTable
              rows={stock.data?.data}
              loading={stock.isLoading}
              rowKey={(r) => r.id}
              onRowClick={setSheet}
              empty={<EmptyState icon={Boxes} title="No medicines match" />}
              columns={[
                {
                  key: 'name',
                  header: 'Medicine',
                  cell: (r) => (
                    <div>
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{[r.genericName, r.form, r.strength].filter(Boolean).join(' · ')}</p>
                    </div>
                  ),
                },
                {
                  key: 'onhand',
                  header: 'On hand',
                  cell: (r) => (
                    <div className="flex items-center gap-2">
                      <span className={cn('font-semibold tabular-nums', r.low && 'text-destructive')}>{r.onHand}</span>
                      <span className="text-xs text-muted-foreground">{r.unit}</span>
                      {r.onHand === 0 ? <Badge variant="danger">Out</Badge> : r.low ? <Badge variant="warning">Low</Badge> : null}
                    </div>
                  ),
                },
                { key: 'reorder', header: 'Reorder at', cell: (r) => r.reorderLevel, className: 'hidden md:table-cell' },
                {
                  key: 'expiry',
                  header: 'Nearest expiry',
                  cell: (r) =>
                    r.nearestExpiry ? (
                      <span className={cn(r.expiringSoon && 'font-medium text-warning')}>{f.date(r.nearestExpiry)}</span>
                    ) : (
                      '—'
                    ),
                },
                { key: 'expired', header: 'Expired qty', cell: (r) => (r.expiredQty ? <Badge variant="danger">{r.expiredQty}</Badge> : '—'), className: 'hidden lg:table-cell' },
                { key: 'price', header: 'Sale price', cell: (r) => f.money(r.salePrice), className: 'hidden md:table-cell' },
                {
                  key: 'act',
                  header: '',
                  cell: (r) =>
                    can('pharmacy.manage') ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setStockIn({ open: true, med: r });
                        }}
                      >
                        <SlidersHorizontal /> Stock in
                      </Button>
                    ) : (
                      <StatusBadge status={r.low ? 'pending' : 'available'} />
                    ),
                },
              ]}
            />
            {stock.data ? <Pagination page={page} pageSize={stock.data.pageSize} total={stock.data.total} onPage={setPage} /> : null}
          </Card>
        </TabsContent>
      </Tabs>
      <DispenseDialog open={dispenseOpen} onOpenChange={setDispenseOpen} rx={rx} />
      <StockInDialog open={stockIn.open} medicine={stockIn.med} onOpenChange={(o) => setStockIn({ open: o })} />
      <BatchesSheet med={sheet} onClose={() => setSheet(null)} />
    </>
  );
}
