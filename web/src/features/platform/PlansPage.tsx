import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Layers, Pencil, Plus } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { titleCase, useFmt } from '@/lib/format';
import { Badge, Button, Card, Checkbox, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Switch } from '@/components/ui';
import { Field, PageHeader } from '@/components/common';

interface Plan {
  id: number;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  maxUsers: number;
  maxBranches: number;
  modules: string[];
  isActive: boolean;
  sortOrder: number;
  tenantCount: number;
}
const MODULES = ['patients', 'appointments', 'opd', 'billing', 'pharmacy', 'lab', 'ipd', 'reports', 'communication', 'portal'];
const empty = { code: '', name: '', description: '', priceMonthly: 0, priceYearly: 0, maxUsers: 10, maxBranches: 1, modules: ['patients', 'appointments'], isActive: true, sortOrder: 9 };

export default function PlansPage() {
  const f = useFmt();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['plans'], queryFn: () => api.get<Plan[]>('/platform/plans') });
  const [edit, setEdit] = useState<(typeof empty & { id?: number }) | null>(null);
  const [form, setForm] = useState(empty);
  useEffect(() => {
    if (edit) setForm({ ...empty, ...edit, description: edit.description ?? '' });
  }, [edit]);
  const save = useMutation({
    mutationFn: () => (edit?.id ? api.put(`/platform/plans/${edit.id}`, form) : api.post('/platform/plans', form)),
    onSuccess: () => {
      toast.success('Plan saved — tenants on this plan get the change immediately');
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['plans'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <>
      <PageHeader
        icon={Layers}
        title="Plans & modules"
        description="Package modules into subscription tiers"
        actions={
          <Button onClick={() => setEdit({ ...empty })}>
            <Plus /> New plan
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.map((p) => (
          <Card key={p.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-lg font-semibold">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.description}</p>
              </div>
              {p.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Hidden</Badge>}
            </div>
            <p className="mt-4 text-3xl font-semibold">
              {f.money(p.priceMonthly)}
              <span className="text-sm font-normal text-muted-foreground">/mo</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {f.money(p.priceYearly)}/yr · {p.maxUsers} users · {p.maxBranches} branch(es)
            </p>
            <ul className="mt-4 flex flex-1 flex-col gap-1.5">
              {p.modules.map((m) => (
                <li key={m} className="flex items-center gap-2 text-sm">
                  <Check className="size-4 text-success" /> {titleCase(m)}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between border-t pt-3">
              <span className="text-xs text-muted-foreground">{p.tenantCount} organisation(s)</span>
              <Button variant="outline" size="sm" onClick={() => setEdit({ ...p, description: p.description ?? '' })}>
                <Pencil /> Edit
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <Dialog open={Boolean(edit)} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{edit?.id ? `Edit ${edit.name}` : 'New plan'}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-3 sm:grid-cols-3">
            <Field label="Name" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Code" required>
              <Input value={form.code} disabled={Boolean(edit?.id)} onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })} />
            </Field>
            <Field label="Sort order">
              <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} />
            </Field>
            <Field label="Description" className="sm:col-span-3">
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field label="Monthly price">
              <Input type="number" value={form.priceMonthly} onChange={(e) => setForm({ ...form, priceMonthly: Number(e.target.value) })} />
            </Field>
            <Field label="Yearly price">
              <Input type="number" value={form.priceYearly} onChange={(e) => setForm({ ...form, priceYearly: Number(e.target.value) })} />
            </Field>
            <Field label="Max users">
              <Input type="number" value={form.maxUsers} onChange={(e) => setForm({ ...form, maxUsers: Number(e.target.value) })} />
            </Field>
            <Field label="Modules" className="sm:col-span-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {MODULES.map((m) => (
                  <label key={m} className="flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm">
                    <Checkbox checked={form.modules.includes(m)} onCheckedChange={(c) => setForm({ ...form, modules: c ? [...form.modules, m] : form.modules.filter((x) => x !== m) })} />
                    {titleCase(m)}
                  </label>
                ))}
              </div>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} /> Offered at signup
            </label>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button disabled={!form.name || !form.code || !form.modules.length} loading={save.isPending} onClick={() => save.mutate()}>
              Save plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
