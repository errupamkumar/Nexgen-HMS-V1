/**
 * API client. The access token lives in memory only; the refresh token is an
 * httpOnly cookie the browser sends to /api/auth/refresh. A 401 triggers one
 * single-flight refresh and a retry.
 */
import type { Session } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public fields?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;
let onSessionRefreshed: ((s: Session) => void) | null = null;

export const tokenStore = {
  set: (t: string | null) => {
    accessToken = t;
  },
  get: () => accessToken,
  onLost: (fn: () => void) => {
    onSessionLost = fn;
  },
  onRefreshed: (fn: (s: Session) => void) => {
    onSessionRefreshed = fn;
  },
};

let refreshing: Promise<boolean> | null = null;

export async function refreshSession(attempt = 0): Promise<{ accessToken: string; session: Session } | null> {
  const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
  if (!res.ok) {
    // A sibling tab rotated the cookie a moment ago; the browser now holds the new one.
    if (res.status === 401 && attempt === 0) {
      const body = await res.json().catch(() => null);
      if (body?.error?.code === 'TOKEN_ROTATED') {
        await new Promise((r) => setTimeout(r, 400));
        return refreshSession(1);
      }
    }
    return null;
  }
  const body = (await res.json()) as { accessToken: string; session: Session };
  accessToken = body.accessToken;
  return body;
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = refreshSession()
      .then((r) => {
        if (r) onSessionRefreshed?.(r.session);
        return Boolean(r);
      })
      .finally(() => {
        setTimeout(() => (refreshing = null), 0);
      });
  }
  return refreshing;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(params?: Query) {
  if (!params) return '';
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, url: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`/api${url}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && retry && !url.startsWith('/auth/')) {
    if (await tryRefresh()) return request<T>(method, url, body, false);
    onSessionLost?.();
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.message ?? `Request failed (${res.status})`, e.code, e.fields);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string, params?: Query) => request<T>('GET', url + qs(params)),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
