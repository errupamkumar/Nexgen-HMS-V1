import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle,
  BedDouble,
  CalendarCheck,
  CalendarDays,
  FlaskConical,
  IndianRupee,
  LayoutDashboard,
  Pill,
  Receipt,
  Stethoscope,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, titleCase, useFmt } from '@/lib/format';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@/components/ui';
import { EmptyState, PageHeader, StatCard } from '@/components/common';

interface Dashboard {
  today: string;
  appointmentsToday: { total: number; waiting: number; inConsultation: number; completed: number; cancelled: number };
  patients: { total: number; newToday: number; new30d: number };
  appointmentTrend: { day: string; total: number; completed: number }[];
  departmentLoad: { name: string; value: number }[];
  revenueTrend?: { day: string; amount: number }[];
  collectionToday?: number;
  collection30d?: number;
  outstanding?: { amount: number; count: number };
  paymentModes?: { name: string; value: number }[];
  beds?: { total: number; occupied: number; occupancy: number; admitted: number };
  lab?: { pending: number; toVerify: number; urgent: number };
  pharmacy?: { lowStock: number; expiringSoon: number; pendingRx: number };
}

const PIE_COLORS = ['var(--color-primary)', 'oklch(0.65 0.15 250)', 'oklch(0.72 0.15 75)', 'oklch(0.65 0.18 330)', 'oklch(0.6 0.12 160)', 'oklch(0.55 0.05 265)'];

function fillDays(from: string, days: number) {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  for (let i = days - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() - i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

function ChartTooltip({ active, payload, label, money }: { active?: boolean; payload?: { value: number; name: string; color: string }[]; label?: string; money?: (n: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium">{label && /^\d{4}-/.test(label) ? fmtDate(label, 'EEE, dd MMM') : label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          {titleCase(p.name)}: <span className="font-semibold">{money ? money(p.value) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { session, can } = useAuth();
  const f = useFmt();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/reports/dashboard'), refetchInterval: 60_000 });

  const days = data ? fillDays(data.today, 30) : [];
  const revenue = days.map((d) => ({ day: d, amount: data?.revenueTrend?.find((r) => r.day === d)?.amount ?? 0 }));
  const appts = days.map((d) => {
    const r = data?.appointmentTrend.find((x) => x.day === d);
    return { day: d, total: r?.total ?? 0, completed: r?.completed ?? 0 };
  });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={LayoutDashboard}
        title={`${greeting}, ${session?.user.fullName.split(' ')[0]}`}
        description={`Here's what's happening at ${session?.tenant?.name} today · ${fmtDate(data?.today ?? new Date(), 'EEEE, dd MMMM yyyy')}`}
        actions={
          <>
            {can('patients.create') ? (
              <Button variant="outline" asChild>
                <Link to="/patients?new=1">
                  <UserPlus /> Register patient
                </Link>
              </Button>
            ) : null}
            {can('appointments.create') ? (
              <Button asChild>
                <Link to="/appointments?book=1">
                  <CalendarDays /> Book appointment
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          loading={isLoading}
          label="Appointments today"
          value={data?.appointmentsToday.total ?? 0}
          hint={`${data?.appointmentsToday.waiting ?? 0} waiting · ${data?.appointmentsToday.completed ?? 0} completed`}
          icon={CalendarCheck}
        />
        <StatCard loading={isLoading} label="Patients registered" value={data?.patients.total.toLocaleString() ?? 0} hint={`+${data?.patients.new30d ?? 0} in the last 30 days`} icon={Users} tone="info" />
        {data?.collectionToday !== undefined || isLoading ? (
          <StatCard loading={isLoading} label="Collected today" value={f.money(data?.collectionToday)} hint={`${f.moneyCompact(data?.collection30d)} in 30 days`} icon={IndianRupee} tone="success" />
        ) : null}
        {data?.outstanding ? (
          <StatCard label="Outstanding dues" value={f.money(data.outstanding.amount)} hint={`${data.outstanding.count} open invoices`} icon={Wallet} tone="warning" />
        ) : data?.beds ? null : null}
        {data?.beds ? <StatCard label="Bed occupancy" value={`${data.beds.occupancy}%`} hint={`${data.beds.occupied}/${data.beds.total} beds · ${data.beds.admitted} admitted`} icon={BedDouble} tone="primary" /> : null}
        {data?.lab ? <StatCard label="Lab work pending" value={data.lab.pending} hint={`${data.lab.urgent} urgent · ${data.lab.toVerify} awaiting verification`} icon={FlaskConical} tone={data.lab.urgent ? 'danger' : 'info'} /> : null}
        {data?.pharmacy ? <StatCard label="Prescriptions to dispense" value={data.pharmacy.pendingRx} hint={`${data.pharmacy.lowStock} low-stock · ${data.pharmacy.expiringSoon} expiring`} icon={Pill} tone={data.pharmacy.lowStock ? 'warning' : 'success'} /> : null}
        {data ? (
          <StatCard label="In consultation now" value={data.appointmentsToday.inConsultation} hint={`${data.appointmentsToday.cancelled} cancelled / no-show today`} icon={Stethoscope} tone="info" />
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {data?.revenueTrend ? (
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Collections — last 30 days</CardTitle>
              <CardDescription>Net payments received, refunds deducted</CardDescription>
            </CardHeader>
            <CardContent className="h-72 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenue} margin={{ left: 0, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                  <XAxis dataKey="day" tickFormatter={(d) => fmtDate(d, 'dd MMM')} tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis tickFormatter={(v) => f.moneyCompact(v)} tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} width={56} />
                  <Tooltip content={<ChartTooltip money={f.money} />} />
                  <Area type="monotone" dataKey="amount" stroke="var(--color-primary)" strokeWidth={2} fill="url(#rev)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ) : null}

        <Card className={data?.revenueTrend ? '' : 'xl:col-span-2'}>
          <CardHeader>
            <CardTitle>Today's flow</CardTitle>
            <CardDescription>Where patients are in the OPD right now</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <div className="flex flex-col gap-3">
                {[
                  { label: 'Waiting', value: data?.appointmentsToday.waiting ?? 0, cls: 'bg-warning' },
                  { label: 'In consultation', value: data?.appointmentsToday.inConsultation ?? 0, cls: 'bg-primary' },
                  { label: 'Completed', value: data?.appointmentsToday.completed ?? 0, cls: 'bg-success' },
                  { label: 'Cancelled / no-show', value: data?.appointmentsToday.cancelled ?? 0, cls: 'bg-muted-foreground/40' },
                ].map((r) => {
                  const total = Math.max(1, data?.appointmentsToday.total ?? 1);
                  return (
                    <div key={r.label}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="text-muted-foreground">{r.label}</span>
                        <span className="font-medium">{r.value}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className={`h-full rounded-full ${r.cls} transition-all duration-700`} style={{ width: `${(r.value / total) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
                {can('appointments.view') ? (
                  <Button variant="outline" size="sm" className="mt-2" asChild>
                    <Link to="/appointments">Open live queue</Link>
                  </Button>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Appointments — last 30 days</CardTitle>
            <CardDescription>Booked vs completed</CardDescription>
          </CardHeader>
          <CardContent className="h-64 pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={appts} margin={{ left: -16, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                <XAxis dataKey="day" tickFormatter={(d) => fmtDate(d, 'dd')} tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--color-muted)', opacity: 0.5 }} />
                <Bar dataKey="total" fill="color-mix(in oklab, var(--color-primary) 30%, transparent)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="completed" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Department load</CardTitle>
            <CardDescription>Visits in the last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            {data?.departmentLoad.length ? (
              <div className="flex flex-col gap-2.5">
                {data.departmentLoad.slice(0, 7).map((d, i) => (
                  <div key={d.name} className="flex items-center gap-3 text-sm">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="flex-1 truncate">{d.name}</span>
                    <span className="font-medium tabular-nums">{d.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No visits yet" />
            )}
          </CardContent>
        </Card>

        {data?.paymentModes?.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Payment modes</CardTitle>
              <CardDescription>Share of collections, 30 days</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-4">
              <div className="size-36 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.paymentModes} dataKey="value" nameKey="name" innerRadius={40} outerRadius={64} paddingAngle={2} strokeWidth={0}>
                      {data.paymentModes.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip money={f.money} />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                {data.paymentModes.map((m, i) => (
                  <div key={m.name} className="flex items-center gap-2 text-sm">
                    <span className="size-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="flex-1 uppercase">{m.name}</span>
                    <span className="font-medium">{f.moneyCompact(m.value)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {data?.pharmacy && (data.pharmacy.lowStock > 0 || data.pharmacy.expiringSoon > 0) ? (
          <Card className="border-warning/40 bg-warning/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-warning" /> Inventory alerts
              </CardTitle>
              <CardDescription>Act before patients are turned away</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p>
                <span className="font-semibold">{data.pharmacy.lowStock}</span> medicine(s) at or below reorder level
              </p>
              <p>
                <span className="font-semibold">{data.pharmacy.expiringSoon}</span> medicine(s) with batches expiring soon
              </p>
              <Button variant="outline" size="sm" className="mt-2 w-fit" asChild>
                <Link to="/pharmacy/stock">Review stock</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {data?.outstanding && data.outstanding.count > 0 && can('billing.view') ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="size-4 text-primary" /> Receivables
              </CardTitle>
              <CardDescription>Invoices awaiting payment</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{f.money(data.outstanding.amount)}</p>
              <p className="text-sm text-muted-foreground">across {data.outstanding.count} invoices</p>
              <Button variant="outline" size="sm" className="mt-4" asChild>
                <Link to="/billing?due=1">Collect dues</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
