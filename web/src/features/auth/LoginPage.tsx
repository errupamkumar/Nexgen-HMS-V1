import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, CheckCircle2, Eye, EyeOff, HeartPulse, Lock, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyBrand } from '@/lib/utils';
import { Button, Input, Label } from '@/components/ui';
import { useDebounced } from '@/components/common';
import { homeFor } from '@/lib/nav';

const DEMO = [
  { label: 'Hospital admin', org: 'sunrise', email: 'admin@sunrise.health', pw: 'Admin@123' },
  { label: 'Doctor', org: 'sunrise', email: 'doctor@sunrise.health', pw: 'Staff@123' },
  { label: 'Reception', org: 'sunrise', email: 'reception@sunrise.health', pw: 'Staff@123' },
  { label: 'Pharmacist', org: 'sunrise', email: 'pharmacy@sunrise.health', pw: 'Staff@123' },
  { label: 'Lab technician', org: 'sunrise', email: 'lab@sunrise.health', pw: 'Staff@123' },
  { label: 'Nurse', org: 'sunrise', email: 'nurse@sunrise.health', pw: 'Staff@123' },
  { label: 'Patient portal', org: 'sunrise', email: 'patient@sunrise.health', pw: 'Patient@123' },
  { label: 'Clinic (Starter)', org: 'carewell', email: 'admin@carewell.clinic', pw: 'Admin@123' },
  { label: 'Platform owner', org: '', email: 'owner@nexgen.health', pw: 'Owner@123' },
];

const FEATURES = [
  'OPD, EMR & e-prescriptions',
  'Pharmacy with FEFO batch tracking',
  'Lab results with auto-flagging',
  'Live bed board & IPD billing',
  'Configurable per clinic, no code',
];

export default function LoginPage() {
  const { login, session, ready } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [org, setOrg] = useState(() => params.get('org') ?? localStorage.getItem('nx_org') ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const dOrg = useDebounced(org.trim().toLowerCase(), 350);

  const branding = useQuery({
    queryKey: ['branding', dOrg],
    queryFn: () => api.get<{ name: string; primaryColor: string; tagline: string; logoUrl: string }>(`/public/tenant/${dOrg}`),
    enabled: dOrg.length >= 3,
    retry: false,
  });

  useEffect(() => {
    applyBrand(branding.data?.primaryColor);
  }, [branding.data]);

  useEffect(() => {
    if (ready && session) navigate(params.get('next') || homeFor(session), { replace: true });
  }, [ready, session, navigate, params]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const s = await login(org.trim().toLowerCase(), email.trim(), password);
      toast.success(`Welcome back, ${s.user.fullName.split(' ')[0]}`);
      navigate(params.get('next') || homeFor(s), { replace: true });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="brand-mesh relative hidden overflow-hidden p-10 text-white lg:flex lg:flex-col">
        <div className="relative flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
            <HeartPulse className="size-6" />
          </div>
          <div>
            <p className="text-lg font-semibold">NexGen HMS</p>
            <p className="text-xs text-white/70">Cloud hospital & clinic management</p>
          </div>
        </div>
        <div className="relative mt-auto max-w-lg">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs backdrop-blur">
            <Sparkles className="size-3.5" /> One platform · every specialty · any size
          </span>
          <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight">Run your entire hospital from one beautiful workspace.</h1>
          <p className="mt-4 text-white/75">
            From the front desk to discharge — appointments, consultations, pharmacy, lab, beds and billing, configured to the way your clinic works.
          </p>
          <ul className="mt-8 grid gap-2.5 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm text-white/90">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-300" /> {f}
              </li>
            ))}
          </ul>
          <div className="mt-10 flex items-center gap-2 text-xs text-white/60">
            <ShieldCheck className="size-4" /> Tenant-isolated data · role-based access · full audit trail
          </div>
        </div>
      </section>

      <section className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <HeartPulse className="size-5" />
            </div>
            <p className="text-lg font-semibold">NexGen HMS</p>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">{branding.data ? `Sign in to ${branding.data.name}` : 'Sign in'}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{branding.data?.tagline || 'Use your organisation code and work email.'}</p>

          <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="org">Organisation code</Label>
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="org" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="e.g. sunrise" className="h-10 pl-9" autoComplete="organization" />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {branding.isError && dOrg.length >= 3 ? <span className="text-destructive">No organisation with this code.</span> : 'Leave empty if you are the platform owner.'}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@hospital.com" className="h-10 pl-9" autoComplete="username" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={show ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10 px-9"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
                  aria-label={show ? 'Hide password' : 'Show password'}
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" size="lg" loading={busy} className="mt-2">
              Sign in
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            New to NexGen?{' '}
            <Link to="/signup" className="font-medium text-primary hover:underline">
              Start a 14-day free trial
            </Link>
          </p>

          <div className="mt-8 rounded-xl border bg-muted/30 p-4">
            <p className="text-xs font-semibold">Demo accounts</p>
            <p className="mb-3 text-[11px] text-muted-foreground">Click to fill in. Every role sees a different, permission-trimmed workspace.</p>
            <div className="flex flex-wrap gap-1.5">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => {
                    setOrg(d.org);
                    setEmail(d.email);
                    setPassword(d.pw);
                  }}
                  className="cursor-pointer rounded-md border bg-card px-2 py-1 text-xs transition hover:border-primary hover:text-primary"
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
