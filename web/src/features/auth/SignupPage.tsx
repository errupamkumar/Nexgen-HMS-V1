import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, HeartPulse } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Badge, Button, Card, Input, NativeSelect } from '@/components/ui';
import { Field } from '@/components/common';

interface Plan {
  id: number;
  code: string;
  name: string;
  description: string;
  priceMonthly: number;
  maxUsers: number;
  modules: string[];
}
interface ModuleDef {
  key: string;
  name: string;
}

const TYPES = [
  ['clinic', 'Clinic'],
  ['polyclinic', 'Polyclinic'],
  ['hospital', 'Hospital'],
  ['nursing_home', 'Nursing home'],
  ['diagnostic', 'Diagnostic centre'],
];

export default function SignupPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [step, setStep] = useState(0);
  const [org, setOrg] = useState({ name: '', code: '', type: 'clinic', phone: '', city: '', state: '' });
  const [admin, setAdmin] = useState({ fullName: '', email: '', password: '' });
  const [planCode, setPlanCode] = useState('professional');

  const plans = useQuery({ queryKey: ['public-plans'], queryFn: () => api.get<{ plans: Plan[]; modules: ModuleDef[] }>('/public/plans') });
  const moduleName = (k: string) => plans.data?.modules.find((m) => m.key === k)?.name ?? k;

  const signup = useMutation({
    mutationFn: () => api.post('/public/signup', { organization: org, admin, planCode }),
    onSuccess: async () => {
      toast.success('Your workspace is ready!');
      await login(org.code, admin.email, admin.password);
      navigate('/dashboard');
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const codeOk = /^[a-z0-9][a-z0-9-]{2,29}$/.test(org.code);
  const step0 = org.name.trim().length >= 2 && codeOk;
  const step1 = admin.fullName.trim().length >= 2 && /\S+@\S+\.\S+/.test(admin.email) && admin.password.length >= 8;

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background px-4 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center justify-between">
          <Link to="/login" className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <HeartPulse className="size-5" />
            </div>
            <span className="font-semibold">NexGen HMS</span>
          </Link>
          <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">
            Already have an account? <span className="font-medium text-primary">Sign in</span>
          </Link>
        </div>

        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Start your 14-day free trial</h1>
          <p className="mt-2 text-muted-foreground">No credit card. Your workspace is ready in under a minute.</p>
        </div>

        <div className="mb-6 flex items-center justify-center gap-2">
          {['Organisation', 'Administrator', 'Plan'].map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className={cn('flex size-7 items-center justify-center rounded-full text-xs font-semibold', i <= step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                {i < step ? <Check className="size-4" /> : i + 1}
              </div>
              <span className={cn('hidden text-sm sm:inline', i === step ? 'font-medium' : 'text-muted-foreground')}>{label}</span>
              {i < 2 ? <div className="mx-1 h-px w-8 bg-border" /> : null}
            </div>
          ))}
        </div>

        <Card className="p-6 sm:p-8">
          {step === 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Organisation name" required className="sm:col-span-2">
                <Input
                  value={org.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setOrg((o) => ({
                      ...o,
                      name,
                      code: o.code && o.code !== slug(o.name) ? o.code : slug(name),
                    }));
                  }}
                  placeholder="e.g. Lotus Children's Clinic"
                />
              </Field>
              <Field label="Organisation code" required hint="Your team uses this to sign in. Lowercase letters, digits and hyphens." error={org.code && !codeOk ? 'Use 3–30 lowercase letters, digits or hyphens' : undefined}>
                <Input value={org.code} onChange={(e) => setOrg({ ...org, code: e.target.value.toLowerCase() })} placeholder="lotus-clinic" />
              </Field>
              <Field label="Type">
                <NativeSelect value={org.type} onChange={(e) => setOrg({ ...org, type: e.target.value })}>
                  {TYPES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Phone">
                <Input value={org.phone} onChange={(e) => setOrg({ ...org, phone: e.target.value })} />
              </Field>
              <Field label="City">
                <Input value={org.city} onChange={(e) => setOrg({ ...org, city: e.target.value })} />
              </Field>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Your full name" required className="sm:col-span-2">
                <Input value={admin.fullName} onChange={(e) => setAdmin({ ...admin, fullName: e.target.value })} />
              </Field>
              <Field label="Work email" required>
                <Input type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} />
              </Field>
              <Field label="Password" required hint="At least 8 characters">
                <Input type="password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} />
              </Field>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-4 md:grid-cols-3">
              {plans.data?.plans.map((p) => (
                <button
                  key={p.code}
                  type="button"
                  onClick={() => setPlanCode(p.code)}
                  className={cn(
                    'relative flex cursor-pointer flex-col rounded-xl border p-5 text-left transition hover:shadow-md',
                    planCode === p.code ? 'border-primary ring-2 ring-primary/30' : '',
                  )}
                >
                  {p.code === 'professional' ? <Badge className="absolute right-3 top-3">Popular</Badge> : null}
                  <p className="font-semibold">{p.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
                  <p className="mt-4 text-2xl font-semibold">
                    ₹{p.priceMonthly.toLocaleString('en-IN')}
                    <span className="text-sm font-normal text-muted-foreground">/month</span>
                  </p>
                  <p className="mb-3 text-xs text-muted-foreground">Up to {p.maxUsers} users</p>
                  <ul className="flex flex-col gap-1.5">
                    {p.modules.map((m) => (
                      <li key={m} className="flex items-center gap-2 text-xs">
                        <Check className="size-3.5 text-success" /> {moduleName(m)}
                      </li>
                    ))}
                  </ul>
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-8 flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={step === 0}>
              <ArrowLeft /> Back
            </Button>
            {step < 2 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={step === 0 ? !step0 : !step1}>
                Continue <ArrowRight />
              </Button>
            ) : (
              <Button onClick={() => signup.mutate()} loading={signup.isPending}>
                Create my workspace
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}
