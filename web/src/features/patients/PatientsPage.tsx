import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { UserPlus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ageOf, genderShort, useFmt } from '@/lib/format';
import type { Paged, PatientRow } from '@/lib/types';
import { Avatar, Badge, Button, Card } from '@/components/ui';
import { DataTable, EmptyState, PageHeader, Pagination, SearchInput, useDebounced } from '@/components/common';
import { PatientFormDialog } from './PatientForm';

export default function PatientsPage() {
  const { can } = useAuth();
  const f = useFmt();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const creating = params.get('new') === '1';

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['patients', dq, page],
    queryFn: () => api.get<Paged<PatientRow>>('/patients', { q: dq, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        icon={Users}
        title="Patients"
        description={`${data?.total ?? '—'} registered patients`}
        actions={
          can('patients.create') ? (
            <Button onClick={() => setParams({ new: '1' })}>
              <UserPlus /> Register patient
            </Button>
          ) : null
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            placeholder="Search by name, UHID, phone or ABHA…"
            className="w-full max-w-md"
          />
          {isFetching ? <span className="text-xs text-muted-foreground">Updating…</span> : null}
        </div>
        <DataTable
          rows={data?.data}
          loading={isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/patients/${r.id}`)}
          empty={<EmptyState icon={Users} title={dq ? 'No patients match your search' : 'No patients yet'} description="Register your first patient to get started." />}
          columns={[
            {
              key: 'name',
              header: 'Patient',
              cell: (r) => (
                <div className="flex items-center gap-3">
                  <Avatar name={r.name} />
                  <div>
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.uhid}</p>
                  </div>
                </div>
              ),
            },
            {
              key: 'age',
              header: 'Age / Sex',
              cell: (r) => (
                <span>
                  {ageOf(r.dob) ?? '—'}
                  {genderShort(r.gender) ? ` / ${genderShort(r.gender)}` : ''}
                </span>
              ),
            },
            { key: 'phone', header: 'Phone', cell: (r) => r.phone },
            { key: 'blood', header: 'Blood', cell: (r) => (r.bloodGroup ? <Badge variant="danger">{r.bloodGroup}</Badge> : '—'), className: 'hidden md:table-cell' },
            {
              key: 'allergies',
              header: 'Allergies',
              className: 'hidden lg:table-cell',
              cell: (r) =>
                r.allergies.length ? (
                  <div className="flex flex-wrap gap-1">
                    {r.allergies.map((a) => (
                      <Badge key={a} variant="warning">
                        {a}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">None</span>
                ),
            },
            { key: 'city', header: 'City', cell: (r) => r.city ?? '—', className: 'hidden xl:table-cell' },
            { key: 'last', header: 'Last visit', cell: (r) => (r.lastVisit ? f.date(r.lastVisit) : <span className="text-muted-foreground">—</span>), className: 'hidden md:table-cell' },
          ]}
        />
        {data ? <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
      </Card>
      <PatientFormDialog
        open={creating}
        onOpenChange={(o) => !o && setParams({})}
        onSaved={(p) => navigate(`/patients/${p.id}`)}
      />
    </>
  );
}
