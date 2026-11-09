import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Building2, Plus } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { titleCase, useFmt } from '@/lib/format';
import type { Paged } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  SheetContent,
} from '@/components/ui';
import { DataTable, Field, PageHeader, Pagination, SearchInput, StatusBadge, useDebounced } from '@/components/common';

interface TenantRow {
  id: number;
  code: string;
  name: string;
  type: string;
  city: string | null;
  status: string;
  trialEndsAt: string | null;
  createdAt: string;
  planId: number;
  planName: string;
  userCount: number;
  patientCount: number;
}
interface Plan {
  id: number;
  code: string;
  name: string;
  modules: string[];
}
interface TenantDetail extends TenantRow {
  moduleOverrides: { enable: string[]; disable: string[] } | null;
  email: string | null;
  phone: string | null;
}
const ALL_MODULES = ['patients', 'appointments', 'opd', 'billing', 'pharmacy', 'lab', 'ipd', 'reports', 'communication', 'portal'];

function TenantSheet({ id, onClose, plans }: { id: number | null; onClose: () => void; plans: Plan[] }) {
  const qc = useQueryClient();
  const f = useFmt();
  const { data: t } = useQuery({ queryKey: ['tenant', id], queryFn: () => api.get<TenantDetail>(`/platform/tenants/${id}`), enabled: Boolean(id) });
  const [planId, setPlanId] = useState('');
  const [over, setOver] = useState<{ enable: string[]; disable: string[] }>({ enable: [], disable: [] });
  useEffect(() => {
    if (t) {
      setPlanId(String(t.planId));
      setOver(t.moduleOverrides ?? { enable: [], disable: [] });
    }
  }, [t]);
  const patch = useMutation({
    mutationFn: (body: object) => api.patch(`/platform/tenants/${id}`, body),
    onSuccess: () => {
      toast.success('Organisation updated');
      qc.invalidateQueries({ queryKey: ['tenants'] });
      qc.invalidateQueries({ queryKey: ['tenant', id] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const plan = plans.find((p) => String(p.id) === planId);
  const effective = (m: string) => (over.disable.includes(m) ? false : over.enable.includes(m) || Boolean(plan?.modules.includes(m)));
  const cycle = (m: string) => {
    const inPlan = plan?.modules.includes(m);
    const on = effective(m);
    setOver((o) => ({
      enable: inPlan ? o.enable.filter((x) => x !== m) : on ? o.enable.filter((x) => x !== m) : [...o.enable, m],
      disable: inPlan ? (on ? [...o.disable, m] : o.disable.filter((x) => x !== m)) : o.disable.filter((x) => x !== m),
    }));
  };
  return (
    <DialogPrimitive.Root open={Boolean(id)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <div className="border-b p-5">
          <DialogPrimitive.Title className="text-lg font-semibold">{t?.name}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-sm text-muted-foreground">
            {t?.code} · {titleCase(t?.type)} · since {t ? f.date(t.createdAt) : ''}
          </DialogPrimitive.Description>
        </div>
        {t ? (
          <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-5 scrollbar-thin">
            <div>
              <p className="mb-2 text-sm font-semibold">Lifecycle</p>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={t.status} />
                {t.status !== 'active' ? (
                  <Button size="sm" variant="success" onClick={() => patch.mutate({ status: 'active' })}>
                    Activate
                  </Button>
                ) : null}
                {t.status !== 'suspended' ? (
                  <Button size="sm" variant="destructive" onClick={() => patch.mutate({ status: 'suspended' })}>
                    Suspend
                  </Button>
                ) : null}
                {t.status === 'trial' ? (
                  <Button size="sm" variant="outline" onClick={() => patch.mutate({ trialEndsAt: new Date(Date.now() + 14 * 86400000).toISOString() })}>
                    Extend trial 14 days
                  </Button>
                ) : null}
              </div>
              {t.trialEndsAt ? <p className="mt-1 text-xs text-muted-foreground">Trial ends {f.dateTime(t.trialEndsAt)}</p> : null}
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold">Plan & modules</p>
              <NativeSelect value={planId} onChange={(e) => setPlanId(e.target.value)} className="mb-3">
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
              <div className="grid grid-cols-2 gap-2">
                {ALL_MODULES.map((m) => {
                  const on = effective(m);
                  const overridden = over.enable.includes(m) || over.disable.includes(m);
                  return (
                    <button key={m} onClick={() => cycle(m)} className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${on ? 'border-primary/40 bg-primary/8' : 'opacity-60'}`}>
                      {titleCase(m)}
                      <span className="flex gap-1">
                        {overridden ? <Badge variant="warning">Override</Badge> : null}
                        <Badge variant={on ? 'success' : 'muted'}>{on ? 'On' : 'Off'}</Badge>
                      </span>
                    </button>
                  );
                })}
              </div>
              <Button className="mt-3" loading={patch.isPending} onClick={() => patch.mutate({ planId: Number(planId), moduleOverrides: over })}>
                Save plan & modules
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Card className="p-3">
                <p className="text-xs text-muted-foreground">Users</p>
                <p className="text-xl font-semibold">{t.userCount ?? '—'}</p>
              </Card>
              <Card className="p-3">
                <p className="text-xs text-muted-foreground">Contact</p>
                <p className="truncate">{t.email ?? '—'}</p>
              </Card>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </DialogPrimitive.Root>
  );
}

function NewTenantDialog({ open, onOpenChange, plans }: { open: boolean; onOpenChange: (o: boolean) => void; plans: Plan[] }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', code: '', type: 'clinic', city: '', planId: '', status: 'active', adminName: '', adminEmail: '', adminPassword: '' });
  useEffect(() => {
    if (open) setF({ name: '', code: '', type: 'clinic', city: '', planId: plans[0] ? String(plans[0].id) : '', status: 'active', adminName: '', adminEmail: '', adminPassword: '' });
  }, [open, plans]);
  const m = useMutation({
    mutationFn: () =>
      api.post('/platform/tenants', {
        organization: { name: f.name, code: f.code, type: f.type, city: f.city || undefined },
        admin: { fullName: f.adminName, email: f.adminEmail, password: f.adminPassword },
        planId: Number(f.planId),
        status: f.status,
      }),
    onSuccess: () => {
      toast.success('Organisation provisioned with default roles, departments and services');
      qc.invalidateQueries({ queryKey: ['tenants'] });
      qc.invalidateQueries({ queryKey: ['platform-stats'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const s = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Onboard organisation</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Organisation name" required className="sm:col-span-2">
            <Input value={f.name} onChange={s('name')} />
          </Field>
          <Field label="Code" required hint="lowercase, used to sign in">
            <Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} />
          </Field>
          <Field label="Type">
            <NativeSelect value={f.type} onChange={s('type')}>
              {['clinic', 'polyclinic', 'hospital', 'nursing_home', 'diagnostic'].map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Plan">
            <NativeSelect value={f.planId} onChange={s('planId')}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Start as">
            <NativeSelect value={f.status} onChange={s('status')}>
              <option value="active">Active (paid)</option>
              <option value="trial">14-day trial</option>
            </NativeSelect>
          </Field>
          <Field label="Admin full name" required>
            <Input value={f.adminName} onChange={s('adminName')} />
          </Field>
          <Field label="Admin email" required>
            <Input type="email" value={f.adminEmail} onChange={s('adminEmail')} />
          </Field>
          <Field label="Admin password" required hint="At least 8 characters" className="sm:col-span-2">
            <Input value={f.adminPassword} onChange={s('adminPassword')} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!f.name || f.code.length < 3 || !f.adminName || !f.adminEmail || f.adminPassword.length < 8} loading={m.isPending} onClick={() => m.mutate()}>
            Provision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TenantsPage() {
  const f = useFmt();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);
  const dq = useDebounced(q);
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/platform/plans') });
  const { data, isLoading } = useQuery({
    queryKey: ['tenants', dq, status, page],
    queryFn: () => api.get<Paged<TenantRow>>('/platform/tenants', { q: dq, status, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        icon={Building2}
        title="Organisations"
        description="Tenants, subscriptions and module licensing"
        actions={
          <Button onClick={() => setParams({ new: '1' })}>
            <Plus /> Onboard
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Name, code or city" className="w-full max-w-xs" />
          <NativeSelect value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40">
            <option value="">All statuses</option>
            {['trial', 'active', 'suspended', 'cancelled'].map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <DataTable
          rows={data?.data}
          loading={isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => setOpenId(r.id)}
          columns={[
            {
              key: 'n',
              header: 'Organisation',
              cell: (r) => (
                <div>
                  <p className="font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.code} · {titleCase(r.type)}
                    {r.city ? ` · ${r.city}` : ''}
                  </p>
                </div>
              ),
            },
            { key: 'p', header: 'Plan', cell: (r) => <Badge variant="secondary">{r.planName}</Badge> },
            { key: 'u', header: 'Users', cell: (r) => r.userCount, className: 'hidden md:table-cell' },
            { key: 'pt', header: 'Patients', cell: (r) => r.patientCount, className: 'hidden md:table-cell' },
            { key: 'c', header: 'Joined', cell: (r) => f.date(r.createdAt), className: 'hidden lg:table-cell' },
            { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
        {data ? <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
      </Card>
      <TenantSheet id={openId} onClose={() => setOpenId(null)} plans={plans.data ?? []} />
      <NewTenantDialog open={params.get('new') === '1'} onOpenChange={(o) => !o && setParams({})} plans={plans.data ?? []} />
    </>
  );
}
