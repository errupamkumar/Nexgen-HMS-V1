import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDaysStr, fmtDate, titleCase, todayIn, useFmt } from '@/lib/format';
import { downloadCsv } from '@/lib/utils';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { DataTable, EmptyState, Field, PageHeader, StatCard } from '@/components/common';
import { IndianRupee, TrendingUp, Undo2 } from 'lucide-react';

const COLORS = ['var(--color-primary)', 'oklch(0.65 0.15 250)', 'oklch(0.72 0.15 75)', 'oklch(0.65 0.18 330)', 'oklch(0.6 0.12 160)', 'oklch(0.55 0.05 265)', 'oklch(0.7 0.1 30)'];
const axis = { fontSize: 11, fill: 'var(--color-muted-foreground)' };

function Donut({ data, money }: { data: { name: string; value: number }[]; money?: (n: number) => string }) {
  if (!data.length) return <EmptyState title="No data in range" />;
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex items-center gap-4">
      <div className="size-40 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72} paddingAngle={2} strokeWidth={0}>
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => (money ? money(Number(v)) : String(v))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 text-sm">
        {data.map((d, i) => (
          <div key={d.name} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="flex-1">{titleCase(d.name)}</span>
            <span className="font-medium tabular-nums">{money ? money(d.value) : d.value}</span>
            <span className="w-10 text-right text-xs text-muted-foreground">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const { session, has, can } = useAuth();
  const f = useFmt();
  const today = todayIn(session?.settings?.locale.timezone ?? 'Asia/Kolkata');
  const [from, setFrom] = useState(addDaysStr(today, -29));
  const [to, setTo] = useState(today);
  const range = { from, to };

  const coll = useQuery({
    queryKey: ['rep-coll', from, to],
    queryFn: () => api.get<{ daily: { day: string; collected: number; refunded: number; net: number }[]; byMethod: { method: string; amount: number }[]; byType: { type: string; billed: number; count: number }[]; totals: { collected: number; refunded: number; net: number } }>('/reports/collections', range),
    enabled: can('billing.view'),
  });
  const docs = useQuery({
    queryKey: ['rep-docs', from, to],
    queryFn: () => api.get<{ rows: { doctorId: number; doctorName: string; department: string | null; total: number; completed: number; noShow: number; cancelled: number; newVisits: number; followUps: number; revenue: number }[] }>('/reports/doctors', range),
  });
  const appts = useQuery({
    queryKey: ['rep-appts', from, to],
    queryFn: () => api.get<{ byStatus: { name: string; value: number }[]; bySource: { name: string; value: number }[]; byMode: { name: string; value: number }[]; byHour: { hour: number; value: number }[] }>('/reports/appointments', range),
  });
  const pharm = useQuery({
    queryKey: ['rep-pharm', from, to],
    queryFn: () => api.get<{ topMedicines: { name: string; quantity: number; amount: number }[] }>('/reports/pharmacy', range),
    enabled: has('pharmacy') && can('pharmacy.view'),
  });
  const lab = useQuery({
    queryKey: ['rep-lab', from, to],
    queryFn: () => api.get<{ tests: { name: string; count: number; revenue: number }[] }>('/reports/lab', range),
    enabled: has('lab') && can('lab.view'),
  });

  const presets: [string, number][] = [
    ['7 days', 6],
    ['30 days', 29],
    ['90 days', 89],
  ];

  return (
    <>
      <PageHeader icon={BarChart3} title="Reports & analytics" description="Financial, clinical and operational performance" />
      <Card className="mb-5 flex flex-wrap items-end gap-3 p-3">
        <Field label="From">
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        </Field>
        <Field label="To">
          <Input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="w-40" />
        </Field>
        <div className="flex gap-1">
          {presets.map(([l, d]) => (
            <Button
              key={l}
              variant="outline"
              size="sm"
              onClick={() => {
                setTo(today);
                setFrom(addDaysStr(today, -d));
              }}
            >
              {l}
            </Button>
          ))}
        </div>
      </Card>

      <Tabs defaultValue={can('billing.view') ? 'collections' : 'doctors'}>
        <TabsList>
          {can('billing.view') ? <TabsTrigger value="collections">Collections</TabsTrigger> : null}
          <TabsTrigger value="doctors">Doctors</TabsTrigger>
          <TabsTrigger value="appointments">Appointments</TabsTrigger>
          {has('pharmacy') && can('pharmacy.view') ? <TabsTrigger value="pharmacy">Pharmacy</TabsTrigger> : null}
          {has('lab') && can('lab.view') ? <TabsTrigger value="lab">Laboratory</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="collections" className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Collected" value={f.money(coll.data?.totals.collected)} icon={IndianRupee} tone="success" loading={coll.isLoading} />
            <StatCard label="Refunded" value={f.money(coll.data?.totals.refunded)} icon={Undo2} tone="danger" loading={coll.isLoading} />
            <StatCard label="Net" value={f.money(coll.data?.totals.net)} icon={TrendingUp} loading={coll.isLoading} />
          </div>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Daily collections</CardTitle>
                <CardDescription>
                  {fmtDate(from)} – {fmtDate(to)}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => downloadCsv(`collections_${from}_${to}.csv`, coll.data?.daily ?? [])}>
                <Download /> CSV
              </Button>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer>
                <AreaChart data={coll.data?.daily ?? []}>
                  <defs>
                    <linearGradient id="net" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                  <XAxis dataKey="day" tickFormatter={(d) => fmtDate(d, 'dd MMM')} tick={axis} axisLine={false} tickLine={false} minTickGap={20} />
                  <YAxis tickFormatter={(v) => f.moneyCompact(v)} tick={axis} axisLine={false} tickLine={false} width={56} />
                  <Tooltip formatter={(v) => f.money(Number(v))} labelFormatter={(d) => fmtDate(String(d))} />
                  <Area type="monotone" dataKey="net" stroke="var(--color-primary)" strokeWidth={2} fill="url(#net)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>By payment mode</CardTitle>
              </CardHeader>
              <CardContent>
                <Donut data={(coll.data?.byMethod ?? []).map((m) => ({ name: m.method, value: m.amount }))} money={f.money} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Billed by department</CardTitle>
                <CardDescription>Invoice totals excluding cancelled</CardDescription>
              </CardHeader>
              <CardContent>
                <Donut data={(coll.data?.byType ?? []).map((m) => ({ name: m.type.toUpperCase(), value: m.billed }))} money={f.money} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="doctors">
          <Card>
            <div className="flex items-center justify-between border-b p-3">
              <p className="text-sm font-semibold">Doctor productivity</p>
              <Button variant="outline" size="sm" onClick={() => downloadCsv(`doctors_${from}_${to}.csv`, docs.data?.rows ?? [])}>
                <Download /> CSV
              </Button>
            </div>
            <DataTable
              rows={docs.data?.rows}
              loading={docs.isLoading}
              rowKey={(r) => r.doctorId}
              columns={[
                {
                  key: 'd',
                  header: 'Doctor',
                  cell: (r) => (
                    <div>
                      <p className="font-medium">{r.doctorName}</p>
                      <p className="text-xs text-muted-foreground">{r.department}</p>
                    </div>
                  ),
                },
                { key: 't', header: 'Booked', cell: (r) => r.total },
                {
                  key: 'c',
                  header: 'Seen',
                  cell: (r) => (
                    <div className="flex items-center gap-2">
                      <span className="w-8 tabular-nums">{r.completed}</span>
                      <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-muted sm:block">
                        <div className="h-full bg-success" style={{ width: `${r.total ? (r.completed / r.total) * 100 : 0}%` }} />
                      </div>
                    </div>
                  ),
                },
                { key: 'n', header: 'New / F-up', cell: (r) => `${r.newVisits} / ${r.followUps}`, className: 'hidden md:table-cell' },
                { key: 'ns', header: 'No-show', cell: (r) => r.noShow, className: 'hidden md:table-cell' },
                { key: 'rev', header: 'Consult revenue', cell: (r) => <span className="font-medium">{f.money(r.revenue)}</span> },
              ]}
            />
          </Card>
        </TabsContent>

        <TabsContent value="appointments" className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Outcome</CardTitle>
            </CardHeader>
            <CardContent>
              <Donut data={appts.data?.byStatus ?? []} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Booking channel</CardTitle>
            </CardHeader>
            <CardContent>
              <Donut data={appts.data?.bySource ?? []} />
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Peak hours</CardTitle>
              <CardDescription>Appointments by slot start hour — plan staffing around these</CardDescription>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer>
                <BarChart data={appts.data?.byHour ?? []}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                  <XAxis dataKey="hour" tickFormatter={(h) => `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`} tick={axis} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="value" name="Appointments" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pharmacy">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Top-selling medicines</CardTitle>
              <Button variant="outline" size="sm" onClick={() => downloadCsv(`pharmacy_${from}_${to}.csv`, pharm.data?.topMedicines ?? [])}>
                <Download /> CSV
              </Button>
            </CardHeader>
            <CardContent className="h-96">
              {pharm.data?.topMedicines.length ? (
                <ResponsiveContainer>
                  <BarChart data={pharm.data.topMedicines} layout="vertical" margin={{ left: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
                    <XAxis type="number" tickFormatter={(v) => f.moneyCompact(v)} tick={axis} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={130} tick={axis} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => f.money(Number(v))} />
                    <Bar dataKey="amount" name="Sales" fill="var(--color-primary)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState title="No pharmacy sales in range" />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lab">
          <Card>
            <div className="flex items-center justify-between border-b p-3">
              <p className="text-sm font-semibold">Test volume</p>
              <Button variant="outline" size="sm" onClick={() => downloadCsv(`lab_${from}_${to}.csv`, lab.data?.tests ?? [])}>
                <Download /> CSV
              </Button>
            </div>
            <DataTable
              rows={lab.data?.tests}
              loading={lab.isLoading}
              rowKey={(r) => r.name}
              columns={[
                { key: 'n', header: 'Test', cell: (r) => r.name },
                { key: 'c', header: 'Orders', cell: (r) => r.count },
                { key: 'r', header: 'Revenue', cell: (r) => f.money(r.revenue) },
              ]}
            />
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
