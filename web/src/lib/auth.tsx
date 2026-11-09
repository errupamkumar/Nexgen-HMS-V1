import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, tokenStore } from './api';
import type { Session } from './types';
import { applyBrand } from './utils';

interface AuthState {
  session: Session | null;
  ready: boolean;
  login: (tenantCode: string, email: string, password: string) => Promise<Session>;
  logout: () => Promise<void>;
  can: (...perms: string[]) => boolean;
  canAny: (...perms: string[]) => boolean;
  has: (module: string) => boolean;
  reload: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

// Module-level single flight: StrictMode mounts effects twice in development.
let bootstrap: ReturnType<typeof refreshSession> | null = null;

/** Permission → module, mirroring the server catalogue (core permissions need no module). */
const moduleOf = (perm: string) => {
  const m = perm.split('.')[0];
  return ['dashboard', 'settings', 'masters', 'staff', 'roles', 'audit'].includes(m) ? null : m === 'communication' ? 'communication' : m;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

  const adopt = useCallback((s: Session | null) => {
    setSession(s);
    applyBrand(s?.settings?.profile.primaryColor);
    if (s?.tenant) localStorage.setItem('nx_org', s.tenant.code);
  }, []);

  useEffect(() => {
    tokenStore.onRefreshed(adopt);
    tokenStore.onLost(() => {
      tokenStore.set(null);
      setSession(null);
    });
    bootstrap ??= refreshSession();
    bootstrap
      .then((r) => adopt(r?.session ?? null))
      .catch(() => adopt(null))
      .finally(() => setReady(true));
  }, [adopt]);

  const login = useCallback(
    async (tenantCode: string, email: string, password: string) => {
      const r = await api.post<{ accessToken: string; session: Session }>('/auth/login', { tenantCode, email, password });
      tokenStore.set(r.accessToken);
      qc.clear();
      adopt(r.session);
      return r.session;
    },
    [adopt, qc],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    tokenStore.set(null);
    bootstrap = null;
    qc.clear();
    setSession(null);
  }, [qc]);

  const reload = useCallback(async () => {
    const s = await api.get<Session>('/auth/me');
    adopt(s);
  }, [adopt]);

  const value = useMemo<AuthState>(() => {
    const perms = new Set(session?.permissions ?? []);
    const mods = new Set(session?.modules ?? []);
    const ok = (p: string) => {
      const m = moduleOf(p);
      return perms.has(p) && (!m || mods.has(m));
    };
    return {
      session,
      ready,
      login,
      logout,
      reload,
      can: (...ps) => ps.every(ok),
      canAny: (...ps) => ps.some(ok),
      has: (m) => mods.has(m),
    };
  }, [session, ready, login, logout, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
