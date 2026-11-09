import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Inbox, Search, UserPlus, X, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { ageOf, genderShort, titleCase } from '@/lib/format';
import type { Paged, PatientRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Textarea,
} from './ui';

// ------------------------------------------------------------------ hooks
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ------------------------------------------------------------------ layout bits
export function PageHeader({
  title,
  description,
  actions,
  icon: Icon,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-start gap-3">
        {Icon ? (
          <div className="mt-0.5 hidden size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:flex">
            <Icon className="size-5" />
          </div>
        ) : null}
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'primary',
  loading,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: LucideIcon;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  loading?: boolean;
}) {
  const tones = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/12 text-success',
    warning: 'bg-warning/15 text-warning',
    danger: 'bg-destructive/10 text-destructive',
    info: 'bg-info/12 text-info',
  };
  return (
    <Card className="group relative overflow-hidden p-4 transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {loading ? <Skeleton className="mt-2 h-7 w-24" /> : <p className="mt-1 truncate text-2xl font-semibold tracking-tight">{value}</p>}
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl transition group-hover:scale-105', tones[tone])}>
          <Icon className="size-5" />
        </div>
      </div>
    </Card>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: { icon?: LucideIcon; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="size-6" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

const STATUS_TONES: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'default' | 'secondary'> = {
  booked: 'info',
  checked_in: 'warning',
  in_consultation: 'default',
  completed: 'success',
  cancelled: 'muted',
  no_show: 'danger',
  draft: 'secondary',
  unpaid: 'danger',
  partially_paid: 'warning',
  paid: 'success',
  refunded: 'muted',
  ordered: 'info',
  sample_collected: 'warning',
  verified: 'success',
  admitted: 'default',
  discharged: 'success',
  active: 'success',
  trial: 'info',
  suspended: 'danger',
  inactive: 'muted',
  final: 'success',
  pending: 'warning',
  dispensed: 'success',
  routine: 'muted',
  urgent: 'warning',
  stat: 'danger',
  available: 'success',
  occupied: 'default',
  cleaning: 'warning',
  maintenance: 'muted',
  reserved: 'info',
  simulated: 'info',
  sent: 'success',
  failed: 'danger',
};

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return null;
  return (
    <Badge variant={STATUS_TONES[status] ?? 'secondary'} className={className}>
      {titleCase(status)}
    </Badge>
  );
}

// ------------------------------------------------------------------ data table
export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  empty,
  onRowClick,
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
  rowKey: (row: T) => string | number;
}) {
  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">
          {columns.map((c) => (
            <TH key={c.key} className={c.className}>
              {c.header}
            </TH>
          ))}
        </TR>
      </THead>
      <TBody>
        {loading && !rows?.length
          ? Array.from({ length: 6 }).map((_, i) => (
              <TR key={i}>
                {columns.map((c) => (
                  <TD key={c.key}>
                    <Skeleton className="h-4 w-full max-w-32" />
                  </TD>
                ))}
              </TR>
            ))
          : rows?.map((r) => (
              <TR key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'cursor-pointer' : undefined}>
                {columns.map((c) => (
                  <TD key={c.key} className={c.className}>
                    {c.cell(r)}
                  </TD>
                ))}
              </TR>
            ))}
      </TBody>
      {!loading && rows && rows.length === 0 ? (
        <tbody>
          <tr>
            <td colSpan={columns.length}>{empty ?? <EmptyState title="Nothing here yet" />}</td>
          </tr>
        </tbody>
      ) : null}
    </Table>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return total ? <div className="border-t px-4 py-2.5 text-xs text-muted-foreground">{total} record{total === 1 ? '' : 's'}</div> : null;
  return (
    <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs text-muted-foreground">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="px-2">
          {page} / {pages}
        </span>
        <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-8 pr-8" />
      {value ? (
        <button type="button" onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Clear search">
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ forms
export function Field({
  label,
  error,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Dialog asking for confirmation, optionally with a mandatory reason. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive,
  reason,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  reason?: { label: string; placeholder?: string };
  loading?: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [text, setText] = React.useState('');
  React.useEffect(() => {
    if (open) setText('');
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {reason ? (
          <DialogBody>
            <Field label={reason.label} required>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={reason.placeholder} autoFocus />
            </Field>
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} loading={loading} disabled={Boolean(reason) && text.trim().length < 3} onClick={() => onConfirm(text.trim())}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ patient picker
export function PatientChip({ p }: { p: Pick<PatientRow, 'name' | 'uhid' | 'gender' | 'dob' | 'phone'> }) {
  const age = ageOf(p.dob);
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar name={p.name} className="size-8" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{p.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {[p.uhid, [age !== null ? `${age}y` : '', genderShort(p.gender)].filter(Boolean).join(' '), p.phone].filter(Boolean).join(' · ')}
        </p>
      </div>
    </div>
  );
}

export function PatientPicker({
  value,
  onChange,
  onRegisterNew,
}: {
  value: PatientRow | null;
  onChange: (p: PatientRow | null) => void;
  onRegisterNew?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const dq = useDebounced(q);
  const { data, isFetching } = useQuery({
    queryKey: ['patients', 'picker', dq],
    queryFn: () => api.get<Paged<PatientRow>>('/patients', { q: dq, pageSize: 8 }),
    enabled: open,
  });
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 p-2">
        <PatientChip p={value} />
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm text-muted-foreground shadow-xs hover:bg-accent/50">
          <Search className="size-4" /> Search patient by name, UHID or phone…
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-2">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to search…" />
        <div className="mt-2 max-h-72 overflow-y-auto scrollbar-thin">
          {isFetching && !data ? <p className="p-3 text-xs text-muted-foreground">Searching…</p> : null}
          {data?.data.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full cursor-pointer rounded-md p-2 text-left hover:bg-accent"
              onClick={() => {
                onChange(p);
                setOpen(false);
              }}
            >
              <PatientChip p={p} />
            </button>
          ))}
          {data && data.data.length === 0 ? <p className="p-3 text-xs text-muted-foreground">No matching patients.</p> : null}
        </div>
        {onRegisterNew ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              setOpen(false);
              onRegisterNew();
            }}
          >
            <UserPlus /> Register new patient
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value || '—'}</span>
    </div>
  );
}

export function SectionCard({ title, description, actions, children, className, bodyClassName }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <Card className={className}>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </Card>
  );
}
