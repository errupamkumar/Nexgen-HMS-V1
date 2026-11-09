import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Building2, Crown, IndianRupee, LayoutDashboard, Users, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';
import { PageHeader, StatCard, StatusBadge } from '@/components/common';

interface Stats {
  tenantsByStatus: Record<string, number>;
  totalTenants: number;
  users: number;
  patients: number;
  mrr: number;
  byPlan: { plan: string; n: number }[];
  recent: { id: number; name: string; code: string; status: string; createdAt: string }[];
}

export default function PlatformOverview() {
  const f = useFmt();
  const { data, isLoading } = useQuery({ queryKey: ['platform-stats'], queryFn: () => api.get<Stats>('/platform/stats') });
  return (
    <>
      <PageHeader
        icon={LayoutDashboard}
        title="Platform overview"
        description="Every organisation running on NexGen HMS"
        actions={
          <Button asChild>
            <Link to="/platform/tenants?new=1">
              <Building2 /> Onboard organisation
            </Link>
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard loading={isLoading} label="Organisations" value={data?.totalTenants ?? 0} hint={`${data?.tenantsByStatus.active ?? 0} active · ${data?.tenantsByStatus.trial ?? 0} on trial`} icon={Building2} />
        <StatCard loading={isLoading} label="Monthly recurring revenue" value={f.money(data?.mrr)} hint="Active subscriptions at list price" icon={IndianRupee} tone="success" />
        <StatCard loading={isLoading} label="Staff users" value={data?.users ?? 0} icon={Users} tone="info" />
        <StatCard loading={isLoading} label="Patients managed" value={data?.patients.toLocaleString() ?? 0} icon={UserRound} tone="warning" />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="size-4 text-primary" /> Organisations by plan
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer>
              <BarChart data={data?.byPlan ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                <XAxis dataKey="plan" tick={{ fontSize: 12, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--color-muted-foreground)' }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="n" name="Organisations" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recently joined</CardTitle>
            <CardDescription>Newest organisations</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {data?.recent.map((t) => (
                <li key={t.id} className="flex items-center justify-between px-5 py-2.5">
                  <div>
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.code} · {f.date(t.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={t.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
