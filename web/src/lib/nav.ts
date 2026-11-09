import type { Session } from './types';

/** Landing route for a session: platform console, patient portal or staff workspace. */
export function homeFor(s: Session | null) {
  if (!s) return '/login';
  if (s.user.isPlatformAdmin) return '/platform';
  if (s.user.patientId) return '/portal';
  return s.permissions.includes('dashboard.view') ? '/dashboard' : '/patients';
}
