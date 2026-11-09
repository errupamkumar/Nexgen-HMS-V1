import * as React from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { toast } from 'sonner';
import {
  BarChart3,
  BedDouble,
  Bell,
  Building2,
  CalendarDays,
  ClipboardList,
  Crown,
  FlaskConical,
  HeartPulse,
  Home,
  KeyRound,
  LayoutDashboard,
  Layers,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Pill,
  Receipt,
  ScrollText,
  Search,
  Settings,
  Stethoscope,
  Sun,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ago, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SheetContent,
} from './ui';
import { Field, useDebounced } from './common';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm?: string;
  anyPerm?: string[];
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

const STAFF_NAV: NavGroup[] = [
  { label: 'Overview', items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.view' }] },
  {
    label: 'Front office',
    items: [
      { to: '/patients', label: 'Patients', icon: Users, perm: 'patients.view' },
      { to: '/appointments', label: 'Appointments', icon: CalendarDays, perm: 'appointments.view' },
    ],
  },
  {
    label: 'Clinical',
    items: [
      { to: '/opd', label: 'Consultations', icon: Stethoscope, perm: 'opd.view' },
      { to: '/lab', label: 'Laboratory', icon: FlaskConical, perm: 'lab.view' },
      { to: '/pharmacy', label: 'Pharmacy', icon: Pill, perm: 'pharmacy.view' },
      { to: '/ipd', label: 'In-Patient', icon: BedDouble, perm: 'ipd.view' },
    ],
  },
  {
    label: 'Finance & insight',
    items: [
      { to: '/billing', label: 'Billing', icon: Receipt, perm: 'billing.view' },
      { to: '/reports', label: 'Reports', icon: BarChart3, perm: 'reports.view' },
      { to: '/messages', label: 'Messages', icon: MessageSquare, perm: 'communication.send' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/masters', label: 'Masters', icon: ClipboardList, perm: 'masters.manage' },
      { to: '/users', label: 'Users & Roles', icon: UserCog, perm: 'staff.view' },
      { to: '/settings', label: 'Settings', icon: Settings, perm: 'settings.manage' },
      { to: '/audit', label: 'Audit Trail', icon: ScrollText, perm: 'audit.view' },
    ],
  },
];

const PLATFORM_NAV: NavGroup[] = [
  {
    label: 'Platform',
    items: [
      { to: '/platform', label: 'Overview', icon: LayoutDashboard },
      { to: '/platform/tenants', label: 'Organisations', icon: Building2 },
      { to: '/platform/plans', label: 'Plans & Modules', icon: Layers },
    ],
  },
];

const PORTAL_NAV: NavGroup[] = [
  {
    label: 'My health',
    items: [
      { to: '/portal', label: 'Home', icon: Home },
      { to: '/portal/book', label: 'Book appointment', icon: CalendarDays },
      { to: '/portal/records', label: 'My records', icon: ClipboardList },
    ],
  },
];

export function useTheme() {
  const [dark, setDark] = React.useState(() => document.documentElement.classList.contains('dark'));
  const toggle = React.useCallback(() => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('nx_theme', next ? 'dark' : 'light');
    setDark(next);
  }, []);
  return { dark, toggle };
}

function useNavGroups() {
  const { session, can } = useAuth();
  if (!session) return [];
  if (session.user.isPlatformAdmin) return PLATFORM_NAV;
  if (session.user.patientId) return PORTAL_NAV;
  return STAFF_NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || can(i.perm)) })).filter((g) => g.items.length);
}

function Brand({ compact }: { compact?: boolean }) {
  const { session } = useAuth();
  const name = session?.user.isPlatformAdmin ? 'NexGen Cloud' : session?.tenant?.name ?? 'NexGen HMS';
  const logo = session?.settings?.profile.logoUrl;
  return (
    <Link to="/" className="flex min-w-0 items-center gap-2.5">
      {logo ? (
        <img src={logo} alt="" className="size-9 shrink-0 rounded-xl object-cover" />
      ) : (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/30">
          {session?.user.isPlatformAdmin ? <Crown className="size-5" /> : <HeartPulse className="size-5" />}
        </div>
      )}
      {!compact ? (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {session?.user.isPlatformAdmin ? 'Platform console' : session?.tenant ? `${session.tenant.planName} plan` : ''}
          </p>
        </div>
      ) : null}
    </Link>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const groups = useNavGroups();
  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4 scrollbar-thin">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">{g.label}</p>
          <div className="flex flex-col gap-0.5">
            {g.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/platform' || item.to === '/portal'}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                    isActive && 'bg-primary/10 text-primary hover:bg-primary/12 hover:text-primary',
                  )
                }
              >
                <item.icon className="size-[18px] shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter() {
  const { session } = useAuth();
  if (!session?.tenant || session.user.patientId) return null;
  return (
    <div className="m-3 rounded-xl border bg-gradient-to-br from-primary/10 to-transparent p-3">
      <p className="text-xs font-semibold">{session.tenant.planName} plan</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{session.modules.length} modules enabled</p>
    </div>
  );
}

// ------------------------------------------------------------------ command palette
interface SearchResult {
  patients: { id: number; name: string; uhid: string; phone: string }[];
  doctors: { id: number; name: string; specialization: string | null }[];
  appointments: { id: number; appointmentNo: string; date: string; status: string }[];
  invoices: { id: number; invoiceNo: string; total: number; status: string }[];
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const groups = useNavGroups();
  const [q, setQ] = React.useState('');
  const dq = useDebounced(q, 250);
  const { session } = useAuth();
  const staff = Boolean(session?.tenant && !session.user.patientId);
  const { data } = useQuery({
    queryKey: ['search', dq],
    queryFn: () => api.get<SearchResult>('/search', { q: dq }),
    enabled: open && staff && dq.length >= 2,
  });
  const go = (to: string) => {
    onOpenChange(false);
    setQ('');
    navigate(to);
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-2xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <Command shouldFilter={false} className="flex flex-col">
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="size-4 text-muted-foreground" />
              <Command.Input value={q} onValueChange={setQ} placeholder="Search patients, UHID, invoices, pages…" className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
              <kbd className="rounded border bg-muted px-1.5 text-[10px] text-muted-foreground">ESC</kbd>
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin">
              <Command.Empty className="p-6 text-center text-sm text-muted-foreground">No results.</Command.Empty>
              {data?.patients.length ? (
                <Command.Group heading="Patients" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
                  {data.patients.map((p) => (
                    <Command.Item key={`p${p.id}`} value={`p${p.id}`} onSelect={() => go(`/patients/${p.id}`)} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent">
                      <Avatar name={p.name} className="size-7" />
                      <span className="flex-1">{p.name}</span>
                      <span className="text-xs text-muted-foreground">{p.uhid}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {data?.invoices.length ? (
                <Command.Group heading="Invoices" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
                  {data.invoices.map((i) => (
                    <Command.Item key={`i${i.id}`} value={`i${i.id}`} onSelect={() => go(`/billing/invoices/${i.id}`)} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent">
                      <Receipt className="size-4 text-muted-foreground" />
                      <span className="flex-1">{i.invoiceNo}</span>
                      <Badge variant="secondary">{titleCase(i.status)}</Badge>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {data?.appointments.length ? (
                <Command.Group heading="Appointments" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
                  {data.appointments.map((a) => (
                    <Command.Item key={`a${a.id}`} value={`a${a.id}`} onSelect={() => go(`/appointments?date=${a.date}`)} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent">
                      <CalendarDays className="size-4 text-muted-foreground" />
                      <span className="flex-1">{a.appointmentNo}</span>
                      <span className="text-xs text-muted-foreground">{a.date}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
                {groups
                  .flatMap((g) => g.items)
                  .filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()))
                  .map((i) => (
                    <Command.Item key={i.to} value={i.to} onSelect={() => go(i.to)} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent">
                      <i.icon className="size-4 text-muted-foreground" />
                      {i.label}
                    </Command.Item>
                  ))}
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ------------------------------------------------------------------ notifications
interface Notif {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  type: string;
  createdAt: string;
  read: boolean;
}

function Notifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ unread: number; items: Notif[] }>('/notifications'),
    refetchInterval: 30_000,
  });
  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const open = async (n: Notif) => {
    if (!n.read) await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    qc.invalidateQueries({ queryKey: ['notifications'] });
    if (n.link) navigate(n.link);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="size-[18px]" />
          {data?.unread ? (
            <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white ring-2 ring-background">
              {data.unread > 9 ? '9+' : data.unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {data?.unread ? (
            <button className="cursor-pointer text-xs text-primary hover:underline" onClick={() => readAll.mutate()}>
              Mark all read
            </button>
          ) : null}
        </div>
        <div className="max-h-96 overflow-y-auto scrollbar-thin">
          {data?.items.length ? (
            data.items.map((n) => (
              <button key={n.id} onClick={() => open(n)} className={cn('flex w-full cursor-pointer gap-3 border-b px-3 py-2.5 text-left last:border-0 hover:bg-accent/60', !n.read && 'bg-primary/5')}>
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-primary')} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{n.title}</span>
                  {n.body ? <span className="block truncate text-xs text-muted-foreground">{n.body}</span> : null}
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{ago(n.createdAt)}</span>
                </span>
              </button>
            ))
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">You're all caught up.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ------------------------------------------------------------------ user menu
function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [cur, setCur] = React.useState('');
  const [next, setNext] = React.useState('');
  const m = useMutation({
    mutationFn: () => api.post<{ accessToken: string }>('/auth/change-password', { currentPassword: cur, newPassword: next }),
    onSuccess: () => {
      toast.success('Password changed. Other sessions were signed out.');
      onOpenChange(false);
      setCur('');
      setNext('');
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field label="Current password">
            <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={m.isPending} disabled={!cur || next.length < 8} onClick={() => m.mutate()}>
            Update password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UserMenu() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const [pw, setPw] = React.useState(false);
  if (!session) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex cursor-pointer items-center gap-2 rounded-lg p-1 pr-2 transition hover:bg-accent" aria-label="Account menu">
            <Avatar name={session.user.fullName} className="size-8" />
            <span className="hidden text-left leading-tight md:block">
              <span className="block max-w-36 truncate text-sm font-medium">{session.user.fullName}</span>
              <span className="block text-[11px] text-muted-foreground">{session.user.roleName}</span>
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <p className="truncate text-sm font-medium text-foreground">{session.user.fullName}</p>
            <p className="truncate text-xs font-normal">{session.user.email}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setPw(true)}>
            <KeyRound /> Change password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            onSelect={async () => {
              await logout();
              navigate('/login');
            }}
          >
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={pw} onOpenChange={setPw} />
    </>
  );
}

function TrialBanner() {
  const { session } = useAuth();
  const t = session?.tenant;
  if (!t || t.status !== 'trial' || !t.trialEndsAt) return null;
  const days = Math.max(0, Math.ceil((new Date(t.trialEndsAt).getTime() - Date.now()) / 86_400_000));
  return (
    <div className="no-print flex items-center justify-center gap-2 bg-gradient-to-r from-primary to-primary/80 px-4 py-1.5 text-center text-xs font-medium text-primary-foreground">
      <Crown className="size-3.5" /> Free trial — {days} day{days === 1 ? '' : 's'} left on the {t.planName} plan.
    </div>
  );
}

export function AppShell() {
  const [mobileNav, setMobileNav] = React.useState(false);
  const [palette, setPalette] = React.useState(false);
  const { dark, toggle } = useTheme();
  const { session } = useAuth();
  const location = useLocation();
  const staff = Boolean(session?.tenant && !session.user.patientId);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <TrialBanner />
      <div className="flex flex-1">
        <aside className="no-print sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
          <div className="flex h-16 items-center border-b px-4">
            <Brand />
          </div>
          <SidebarNav />
          <SidebarFooter />
        </aside>

        <DialogPrimitive.Root open={mobileNav} onOpenChange={setMobileNav}>
          <SheetContent side="left" className="p-0">
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <div className="flex h-16 items-center border-b px-4">
              <Brand />
            </div>
            <SidebarNav onNavigate={() => setMobileNav(false)} />
          </SheetContent>
        </DialogPrimitive.Root>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-xl sm:px-6">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open navigation">
              <Menu />
            </Button>
            <div className="lg:hidden">
              <Brand compact />
            </div>
            <button
              onClick={() => setPalette(true)}
              className="ml-auto flex h-9 w-full max-w-sm cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-sm text-muted-foreground shadow-xs transition hover:bg-accent/50 sm:ml-0 lg:ml-0"
            >
              <Search className="size-4" />
              <span className="min-w-0 flex-1 truncate text-left">{staff ? 'Search patients, invoices…' : 'Search pages…'}</span>
              <kbd className="hidden rounded border bg-muted px-1.5 text-[10px] sm:inline">Ctrl K</kbd>
            </button>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
                {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
              </Button>
              {staff ? <Notifications /> : null}
              <UserMenu />
            </div>
          </header>
          <main key={location.pathname.split('/')[1]} className="mx-auto w-full max-w-[1500px] flex-1 px-3 py-6 animate-in fade-in-0 slide-in-from-bottom-1 duration-300 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </div>
  );
}
