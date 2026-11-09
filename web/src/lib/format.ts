import { differenceInYears, format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { useAuth } from './auth';

/** Formatters bound to the tenant's locale settings. */
export function useFmt() {
  const { session } = useAuth();
  const loc = session?.settings?.locale ?? { currency: 'INR', currencySymbol: '₹', timezone: 'Asia/Kolkata', dateFormat: 'dd MMM yyyy' };
  const nf = new Intl.NumberFormat(loc.currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: loc.currency, maximumFractionDigits: 2 });
  const compact = new Intl.NumberFormat(loc.currency === 'INR' ? 'en-IN' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 });
  return {
    money: (n: number | null | undefined) => nf.format(Number(n ?? 0)),
    moneyCompact: (n: number | null | undefined) => `${loc.currencySymbol}${compact.format(Number(n ?? 0))}`,
    symbol: loc.currencySymbol,
    date: (d: string | Date | null | undefined) => fmtDate(d, loc.dateFormat),
    dateTime: (d: string | Date | null | undefined) => (d ? `${fmtDate(d, loc.dateFormat)}, ${format(toDate(d), 'h:mm a')}` : '—'),
    timezone: loc.timezone,
  };
}

const toDate = (d: string | Date) => (typeof d === 'string' ? (d.length === 10 ? parseISO(d) : new Date(d)) : d);

export function fmtDate(d: string | Date | null | undefined, pattern = 'dd MMM yyyy') {
  if (!d) return '—';
  try {
    return format(toDate(d), pattern);
  } catch {
    return String(d);
  }
}

/** "14:30:00" → "2:30 PM" */
export function fmtTime(t: string | null | undefined) {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function ageOf(dob: string | null | undefined) {
  if (!dob) return null;
  try {
    return differenceInYears(new Date(), parseISO(dob));
  } catch {
    return null;
  }
}

export const ago = (d: string | Date) => formatDistanceToNowStrict(toDate(d), { addSuffix: true });

export const genderShort = (g?: string | null) => (g === 'male' ? 'M' : g === 'female' ? 'F' : g ? 'O' : '');

export const titleCase = (s: string | null | undefined) =>
  (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Today in the tenant timezone (YYYY-MM-DD). */
export function todayIn(tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDaysStr(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
