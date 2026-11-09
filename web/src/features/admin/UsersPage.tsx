import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Lock, Pencil, Plus, ShieldCheck, Trash2, UserCog, UserPlus } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { titleCase, useFmt } from '@/lib/format';
import type { Doctor, Paged } from '@/lib/types';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { ConfirmDialog, DataTable, Field, PageHeader, Pagination, SearchInput, StatusBadge, useDebounced } from '@/components/common';

interface UserRow {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  status: 'active' | 'inactive';
  roleId: number;
  roleName: string;
  roleCode: string;
  doctorId: number | null;
  doctorName: string | null;
  lastLoginAt: string | null;
  lockedUntil: string | null;
}
interface Role {
  id: number;
  code: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  userCount: number;
}
interface Meta {
  modules: { key: string; name: string }[];
  permissions: { key: string; module: string; label: string }[];
}

function UserDialog({ user, open, onOpenChange, roles }: { user: UserRow | null; open: boolean; onOpenChange: (o: boolean) => void; roles: Role[] }) {
  const qc = useQueryClient();
  const doctors = useQuery({ queryKey: ['doctors', 'all'], queryFn: () => api.get<Doctor[]>('/masters/doctors', { all: 1 }), enabled: open });
  const [f, setF] = useState({ fullName: '', email: '', phone: '', roleId: '', doctorId: '', status: 'active', password: '' });
  useEffect(() => {
    if (open)
      setF(
        user
          ? { fullName: user.fullName, email: user.email, phone: user.phone ?? '', roleId: String(user.roleId), doctorId: user.doctorId ? String(user.doctorId) : '', status: user.status, password: '' }
          : { fullName: '', email: '', phone: '', roleId: '', doctorId: '', status: 'active', password: '' },
      );
  }, [open, user]);
  const m = useMutation({
    mutationFn: () => {
      const body = { fullName: f.fullName, email: f.email, phone: f.phone || null, roleId: Number(f.roleId), doctorId: f.doctorId ? Number(f.doctorId) : null, status: f.status };
      return user ? api.put(`/admin/users/${user.id}`, body) : api.post('/admin/users', { ...body, password: f.password });
    },
    onSuccess: () => {
      toast.success(user ? 'User updated' : 'User created — share the password securely');
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['roles'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const role = roles.find((r) => String(r.id) === f.roleId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{user ? 'Edit user' : 'Invite staff member'}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" required className="sm:col-span-2">
            <Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
          </Field>
          <Field label="Email (login)" required>
            <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
          <Field label="Role" required>
            <NativeSelect value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })}>
              <option value="">Select…</option>
              {roles
                .filter((r) => r.code !== 'patient')
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field label="Status">
            <NativeSelect value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </NativeSelect>
          </Field>
          {role?.permissions.includes('opd.write') || f.doctorId ? (
            <Field label="Linked doctor profile" hint="Lets the doctor see their own queue and sign prescriptions" className="sm:col-span-2">
              <NativeSelect value={f.doctorId} onChange={(e) => setF({ ...f, doctorId: e.target.value })}>
                <option value="">None</option>
                {doctors.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          {!user ? (
            <Field label="Temporary password" required hint="At least 8 characters" className="sm:col-span-2">
              <Input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            </Field>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!f.fullName || !f.email || !f.roleId || (!user && f.password.length < 8)} loading={m.isPending} onClick={() => m.mutate()}>
            {user ? 'Save' : 'Create user'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleDialog({ role, open, onOpenChange, meta }: { role: Role | null; open: boolean; onOpenChange: (o: boolean) => void; meta?: Meta }) {
  const qc = useQueryClient();
  const { has } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [perms, setPerms] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (open) {
      setName(role?.name ?? '');
      setDescription(role?.description ?? '');
      setPerms(new Set(role?.permissions ?? ['dashboard.view']));
    }
  }, [open, role]);
  const groups = useMemo(() => {
    const out: { key: string; name: string; perms: Meta['permissions'] }[] = [{ key: 'core', name: 'Administration & core', perms: [] }];
    for (const m of meta?.modules ?? []) out.push({ key: m.key, name: m.name, perms: [] });
    for (const p of meta?.permissions ?? []) out.find((g) => g.key === p.module)?.perms.push(p);
    return out.filter((g) => g.perms.length);
  }, [meta]);
  const locked = role?.code === 'admin';
  const m = useMutation({
    mutationFn: () => {
      const body = { name, description: description || null, permissions: [...perms] };
      return role ? api.put(`/admin/roles/${role.id}`, body) : api.post('/admin/roles', body);
    },
    onSuccess: () => {
      toast.success('Role saved — changes apply immediately');
      qc.invalidateQueries({ queryKey: ['roles'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const toggle = (k: string, on: boolean) =>
    setPerms((s) => {
      const n = new Set(s);
      if (on) n.add(k);
      else n.delete(k);
      return n;
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{role ? `Role: ${role.name}` : 'New role'}</DialogTitle>
          <DialogDescription>{locked ? 'The Administrator role always has every permission.' : 'Tick what this role may do. Modules not in your plan are shown greyed out.'}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role name" required>
              <Input disabled={locked} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Description">
              <Input disabled={locked} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {groups.map((g) => {
              const licensed = g.key === 'core' || has(g.key);
              const all = g.perms.every((p) => perms.has(p.key));
              return (
                <div key={g.key} className={`rounded-lg border p-3 ${licensed ? '' : 'opacity-50'}`}>
                  <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm font-semibold">
                    <Checkbox disabled={locked} checked={all} onCheckedChange={(c) => g.perms.forEach((p) => toggle(p.key, Boolean(c)))} />
                    {g.name}
                    {!licensed ? <Badge variant="muted">Not in plan</Badge> : null}
                  </label>
                  <div className="flex flex-col gap-1.5 pl-6">
                    {g.perms.map((p) => (
                      <label key={p.key} className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox disabled={locked} checked={perms.has(p.key)} onCheckedChange={(c) => toggle(p.key, Boolean(c))} />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogBody>
        <DialogFooter>
          <span className="mr-auto self-center text-xs text-muted-foreground">{perms.size} permissions selected</span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {!locked ? (
            <Button disabled={name.trim().length < 2} loading={m.isPending} onClick={() => m.mutate()}>
              Save role
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const { can, session } = useAuth();
  const f = useFmt();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const [userDlg, setUserDlg] = useState<{ open: boolean; user: UserRow | null }>({ open: false, user: null });
  const [roleDlg, setRoleDlg] = useState<{ open: boolean; role: Role | null }>({ open: false, role: null });
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const [newPw, setNewPw] = useState('');
  const [delRole, setDelRole] = useState<Role | null>(null);

  const users = useQuery({ queryKey: ['users', dq, page], queryFn: () => api.get<Paged<UserRow>>('/admin/users', { q: dq, page, pageSize: 20 }), placeholderData: keepPreviousData });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/admin/roles') });
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/admin/meta'), staleTime: Infinity });

  const reset = useMutation({
    mutationFn: () => api.post(`/admin/users/${resetFor!.id}/reset-password`, { password: newPw }),
    onSuccess: () => {
      toast.success('Password reset and account unlocked');
      setResetFor(null);
      setNewPw('');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const removeRole = useMutation({
    mutationFn: (id: number) => api.del(`/admin/roles/${id}`),
    onSuccess: () => {
      toast.success('Role deleted');
      setDelRole(null);
      qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e) => {
      setDelRole(null);
      toast.error(errMsg(e));
    },
  });

  return (
    <>
      <PageHeader icon={UserCog} title="Users & roles" description="Staff accounts and what each role is allowed to do" />
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">
            <UserCog /> Users
          </TabsTrigger>
          <TabsTrigger value="roles">
            <ShieldCheck /> Roles & permissions
          </TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Name or email" className="w-full max-w-xs" />
              {can('staff.manage') ? (
                <Button className="ml-auto" onClick={() => setUserDlg({ open: true, user: null })}>
                  <UserPlus /> Add user
                </Button>
              ) : null}
            </div>
            <DataTable
              rows={users.data?.data}
              loading={users.isLoading}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: 'u',
                  header: 'User',
                  cell: (r) => (
                    <div className="flex items-center gap-3">
                      <Avatar name={r.fullName} />
                      <div>
                        <p className="font-medium">
                          {r.fullName} {r.id === session?.user.id ? <Badge variant="muted">You</Badge> : null}
                        </p>
                        <p className="text-xs text-muted-foreground">{r.email}</p>
                      </div>
                    </div>
                  ),
                },
                { key: 'r', header: 'Role', cell: (r) => <Badge variant="secondary">{r.roleName}</Badge> },
                { key: 'd', header: 'Doctor profile', cell: (r) => r.doctorName ?? '—', className: 'hidden lg:table-cell' },
                { key: 'l', header: 'Last sign-in', cell: (r) => (r.lastLoginAt ? f.dateTime(r.lastLoginAt) : 'Never'), className: 'hidden md:table-cell' },
                {
                  key: 's',
                  header: 'Status',
                  cell: (r) =>
                    r.lockedUntil && new Date(r.lockedUntil) > new Date() ? (
                      <Badge variant="danger">
                        <Lock /> Locked
                      </Badge>
                    ) : (
                      <StatusBadge status={r.status} />
                    ),
                },
                {
                  key: 'a',
                  header: '',
                  className: 'text-right',
                  cell: (r) =>
                    can('staff.manage') ? (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon-sm" onClick={() => setUserDlg({ open: true, user: r })} aria-label="Edit user">
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => setResetFor(r)} aria-label="Reset password">
                          <KeyRound />
                        </Button>
                      </div>
                    ) : null,
                },
              ]}
            />
            {users.data ? <Pagination page={page} pageSize={users.data.pageSize} total={users.data.total} onPage={setPage} /> : null}
          </Card>
        </TabsContent>
        <TabsContent value="roles">
          <div className="mb-3 flex justify-end">
            {can('roles.manage') ? (
              <Button onClick={() => setRoleDlg({ open: true, role: null })}>
                <Plus /> Custom role
              </Button>
            ) : null}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {roles.data
              ?.filter((r) => r.code !== 'patient')
              .map((r) => (
                <Card key={r.id} className="flex flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.description}</p>
                    </div>
                    {r.isSystem ? <Badge variant="muted">System</Badge> : <Badge>Custom</Badge>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {[...new Set(r.permissions.map((p) => p.split('.')[0]))].slice(0, 8).map((m) => (
                      <Badge key={m} variant="secondary">
                        {titleCase(m)}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-auto flex items-center justify-between pt-4 text-xs text-muted-foreground">
                    <span>
                      {r.permissions.length} permissions · {r.userCount} user{r.userCount === 1 ? '' : 's'}
                    </span>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" onClick={() => setRoleDlg({ open: true, role: r })}>
                        {can('roles.manage') && r.code !== 'admin' ? 'Edit' : 'View'}
                      </Button>
                      {!r.isSystem && can('roles.manage') ? (
                        <Button variant="ghost" size="icon-sm" onClick={() => setDelRole(r)} aria-label="Delete role">
                          <Trash2 />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </Card>
              ))}
          </div>
        </TabsContent>
      </Tabs>
      <UserDialog open={userDlg.open} user={userDlg.user} roles={roles.data ?? []} onOpenChange={(o) => setUserDlg({ open: o, user: o ? userDlg.user : null })} />
      <RoleDialog open={roleDlg.open} role={roleDlg.role} meta={meta.data} onOpenChange={(o) => setRoleDlg({ open: o, role: o ? roleDlg.role : null })} />
      <Dialog open={Boolean(resetFor)} onOpenChange={(o) => !o && setResetFor(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Reset password — {resetFor?.fullName}</DialogTitle>
            <DialogDescription>Also clears any lockout after failed sign-ins.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label="New password" hint="At least 8 characters">
              <Input value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button disabled={newPw.length < 8} loading={reset.isPending} onClick={() => reset.mutate()}>
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={Boolean(delRole)} onOpenChange={(o) => !o && setDelRole(null)} title={`Delete role "${delRole?.name}"?`} destructive confirmLabel="Delete" loading={removeRole.isPending} onConfirm={() => delRole && removeRole.mutate(delRole.id)} />
    </>
  );
}
