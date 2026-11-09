import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { HeartPulse, Loader2, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { homeFor } from '@/lib/nav';
import { AppShell } from '@/components/layout';
import { EmptyState } from '@/components/common';
import { Button } from '@/components/ui';

const LoginPage = lazy(() => import('@/features/auth/LoginPage'));
const SignupPage = lazy(() => import('@/features/auth/SignupPage'));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const PatientsPage = lazy(() => import('@/features/patients/PatientsPage'));
const PatientDetailPage = lazy(() => import('@/features/patients/PatientDetailPage'));
const AppointmentsPage = lazy(() => import('@/features/appointments/AppointmentsPage'));
const OpdListPage = lazy(() => import('@/features/opd/OpdListPage'));
const ConsultationPage = lazy(() => import('@/features/opd/ConsultationPage'));
const BillingPage = lazy(() => import('@/features/billing/BillingPage'));
const InvoicePage = lazy(() => import('@/features/billing/InvoicePage'));
const PharmacyPage = lazy(() => import('@/features/pharmacy/PharmacyPage'));
const LabPage = lazy(() => import('@/features/lab/LabPage'));
const LabOrderPage = lazy(() => import('@/features/lab/LabOrderPage'));
const IpdPage = lazy(() => import('@/features/ipd/IpdPage'));
const AdmissionPage = lazy(() => import('@/features/ipd/AdmissionPage'));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'));
const MessagesPage = lazy(() => import('@/features/messages/MessagesPage'));
const MastersPage = lazy(() => import('@/features/masters/MastersPage'));
const UsersPage = lazy(() => import('@/features/admin/UsersPage'));
const SettingsPage = lazy(() => import('@/features/admin/SettingsPage'));
const AuditPage = lazy(() => import('@/features/admin/AuditPage'));
const PlatformOverview = lazy(() => import('@/features/platform/PlatformOverview'));
const TenantsPage = lazy(() => import('@/features/platform/TenantsPage'));
const PlansPage = lazy(() => import('@/features/platform/PlansPage'));
const PortalHome = lazy(() => import('@/features/portal/PortalHome'));
const PortalBook = lazy(() => import('@/features/portal/PortalBook'));
const PortalRecords = lazy(() => import('@/features/portal/PortalRecords'));
const PrintPage = lazy(() => import('@/features/print/PrintPage'));

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
        <HeartPulse className="size-7 animate-pulse" />
      </div>
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function RequireAuth() {
  const { session, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Splash />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <Outlet />;
}

function Home() {
  const { session } = useAuth();
  return <Navigate to={homeFor(session)} replace />;
}

function Forbidden() {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="You do not have access to this page"
      description="Your role or your organisation's plan does not include this feature. Ask your administrator if you need access."
      action={
        <Button variant="outline" onClick={() => history.back()}>
          Go back
        </Button>
      }
    />
  );
}

/** Route guard by audience and permission (module licensing is folded into `can`). */
function Guard({ perm, kind, children }: { perm?: string; kind: 'staff' | 'platform' | 'patient'; children: ReactNode }) {
  const { session, can } = useAuth();
  if (!session) return null;
  const isPlatform = session.user.isPlatformAdmin;
  const isPatient = Boolean(session.user.patientId);
  if (kind === 'platform' && !isPlatform) return <Navigate to={homeFor(session)} replace />;
  if (kind === 'patient' && !isPatient) return <Navigate to={homeFor(session)} replace />;
  if (kind === 'staff' && (isPlatform || isPatient)) return <Navigate to={homeFor(session)} replace />;
  if (perm && !can(perm)) return <Forbidden />;
  return <>{children}</>;
}

const wrap = (kind: 'staff' | 'platform' | 'patient', el: ReactNode, perm?: string) => (
  <Guard kind={kind} perm={perm}>
    <Suspense fallback={<PageLoader />}>{el}</Suspense>
  </Guard>
);
const S = (el: ReactNode, perm?: string) => wrap('staff', el, perm);
const P = (el: ReactNode) => wrap('platform', el);
const Pt = (el: ReactNode) => wrap('patient', el);

const router = createBrowserRouter([
  { path: '/login', element: <Suspense fallback={<Splash />}><LoginPage /></Suspense> },
  { path: '/signup', element: <Suspense fallback={<Splash />}><SignupPage /></Suspense> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/print/:kind/:id', element: <Suspense fallback={<Splash />}><PrintPage /></Suspense> },
      {
        element: <AppShell />,
        children: [
          { path: '/dashboard', element: S(<DashboardPage />, 'dashboard.view') },
          { path: '/patients', element: S(<PatientsPage />, 'patients.view') },
          { path: '/patients/:id', element: S(<PatientDetailPage />, 'patients.view') },
          { path: '/appointments', element: S(<AppointmentsPage />, 'appointments.view') },
          { path: '/opd', element: S(<OpdListPage />, 'opd.view') },
          { path: '/opd/:id', element: S(<ConsultationPage />, 'opd.view') },
          { path: '/billing', element: S(<BillingPage />, 'billing.view') },
          { path: '/billing/invoices/:id', element: S(<InvoicePage />, 'billing.view') },
          { path: '/pharmacy', element: S(<PharmacyPage />, 'pharmacy.view') },
          { path: '/pharmacy/:tab', element: S(<PharmacyPage />, 'pharmacy.view') },
          { path: '/lab', element: S(<LabPage />, 'lab.view') },
          { path: '/lab/orders/:id', element: S(<LabOrderPage />, 'lab.view') },
          { path: '/ipd', element: S(<IpdPage />, 'ipd.view') },
          { path: '/ipd/admissions/:id', element: S(<AdmissionPage />, 'ipd.view') },
          { path: '/reports', element: S(<ReportsPage />, 'reports.view') },
          { path: '/messages', element: S(<MessagesPage />, 'communication.send') },
          { path: '/masters', element: S(<MastersPage />, 'masters.manage') },
          { path: '/users', element: S(<UsersPage />, 'staff.view') },
          { path: '/settings', element: S(<SettingsPage />, 'settings.manage') },
          { path: '/audit', element: S(<AuditPage />, 'audit.view') },
          { path: '/platform', element: P(<PlatformOverview />) },
          { path: '/platform/tenants', element: P(<TenantsPage />) },
          { path: '/platform/plans', element: P(<PlansPage />) },
          { path: '/portal', element: Pt(<PortalHome />) },
          { path: '/portal/book', element: Pt(<PortalBook />) },
          { path: '/portal/records', element: Pt(<PortalRecords />) },
          { path: '*', element: <EmptyState title="Page not found" description="The page you are looking for does not exist." /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
