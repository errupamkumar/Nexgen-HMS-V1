import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { api } from '@/lib/api';
import { titleCase, useFmt } from '@/lib/format';
import type { Paged } from '@/lib/types';
import { Badge, Card, Input, NativeSelect } from '@/components/ui';
import { DataTable, EmptyState, PageHeader, Pagination, SearchInput, useDebounced } from '@/components/common';

interface Row {
  id: number;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string | null;
  ip: string | null;
  createdAt: string;
}

const ACTION_TONE: Record<string, 'success' | 'info' | 'danger' | 'warning' | 'secondary' | 'default'> = {
  create: 'success',
  update: 'info',
  delete: 'danger',
  login: 'default',
  login_failed: 'danger',
  status: 'warning',
  payment: 'success',
  refund: 'warning',
  dispense: 'info',
};
const ENTITIES = ['patient', 'appointment', 'encounter', 'invoice', 'lab_order', 'admission', 'user', 'role', 'settings', 'doctor', 'stock', 'medicine', 'service', 'department'];

export default function AuditPage() {
  const f = useFmt();
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data, isLoading } = useQuery({
    queryKey: ['audit', dq, entity, action, from, to, page],
    queryFn: () => api.get<Paged<Row>>('/admin/audit', { q: dq, entity, action, from, to, page, pageSize: 30 }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader icon={ScrollText} title="Audit trail" description="Immutable log of every sign-in and every change to clinical, financial and configuration data" />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search summary or user" className="w-full max-w-xs" />
          <NativeSelect value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} className="w-40">
            <option value="">All records</option>
            {ENTITIES.map((x) => (
              <option key={x} value={x}>
                {titleCase(x)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="w-40">
            <option value="">All actions</option>
            {Object.keys(ACTION_TONE).map((x) => (
              <option key={x} value={x}>
                {titleCase(x)}
              </option>
            ))}
          </NativeSelect>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From date" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To date" />
        </div>
        <DataTable
          rows={data?.data}
          loading={isLoading}
          rowKey={(r) => r.id}
          empty={<EmptyState icon={ScrollText} title="No audit events match" />}
          columns={[
            { key: 't', header: 'When', cell: (r) => <span className="whitespace-nowrap text-xs">{f.dateTime(r.createdAt)}</span> },
            { key: 'u', header: 'User', cell: (r) => r.userName ?? 'System' },
            { key: 'a', header: 'Action', cell: (r) => <Badge variant={ACTION_TONE[r.action] ?? 'secondary'}>{titleCase(r.action)}</Badge> },
            { key: 'e', header: 'Record', cell: (r) => <span className="text-xs">{titleCase(r.entity)}{r.entityId ? ` #${r.entityId}` : ''}</span>, className: 'hidden md:table-cell' },
            { key: 's', header: 'Summary', cell: (r) => <span className="line-clamp-2">{r.summary}</span> },
            { key: 'ip', header: 'IP', cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.ip}</span>, className: 'hidden xl:table-cell' },
          ]}
        />
        {data ? <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
      </Card>
    </>
  );
}
