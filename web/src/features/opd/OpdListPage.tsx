import { useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Stethoscope } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useFmt } from '@/lib/format';
import type { Diagnosis, Paged } from '@/lib/types';
import { Avatar, Card, NativeSelect, Switch } from '@/components/ui';
import { DataTable, EmptyState, PageHeader, Pagination, StatusBadge } from '@/components/common';

interface Row {
  id: number;
  status: string;
  createdAt: string;
  diagnoses: Diagnosis[];
  chiefComplaint: string | null;
  patientId: number;
  patientName: string;
  uhid: string;
  doctorName: string;
}

export default function OpdListPage() {
  const { session } = useAuth();
  const f = useFmt();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(Boolean(session?.user.doctorId));
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['encounters', status, mine, page],
    queryFn: () => api.get<Paged<Row>>('/opd/encounters', { status, doctorId: mine ? session?.user.doctorId : undefined, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader icon={Stethoscope} title="Consultations" description="OPD encounters — start new consultations from the appointment queue" />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <NativeSelect value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40">
            <option value="">All</option>
            <option value="draft">In progress</option>
            <option value="final">Finalised</option>
          </NativeSelect>
          {session?.user.doctorId ? (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={mine} onCheckedChange={(v) => { setMine(v); setPage(1); }} /> Only my patients
            </label>
          ) : null}
        </div>
        <DataTable
          rows={data?.data}
          loading={isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/opd/${r.id}`)}
          empty={<EmptyState icon={Stethoscope} title="No consultations yet" />}
          columns={[
            { key: 'when', header: 'Date', cell: (r) => f.dateTime(r.createdAt) },
            {
              key: 'patient',
              header: 'Patient',
              cell: (r) => (
                <div className="flex items-center gap-2">
                  <Avatar name={r.patientName} className="size-7" />
                  <div>
                    <p className="font-medium">{r.patientName}</p>
                    <p className="text-xs text-muted-foreground">{r.uhid}</p>
                  </div>
                </div>
              ),
            },
            {
              key: 'dx',
              header: 'Diagnosis / complaint',
              cell: (r) => <span className="line-clamp-1">{r.diagnoses.map((d) => d.description).join(', ') || r.chiefComplaint || '—'}</span>,
            },
            { key: 'doctor', header: 'Doctor', cell: (r) => r.doctorName, className: 'hidden md:table-cell' },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status === 'draft' ? 'in_consultation' : r.status} /> },
          ]}
        />
        {data ? <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
      </Card>
    </>
  );
}
