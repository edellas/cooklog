import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { getMe, getStatus } from '../services/api';
import type { Me, Status } from '../types';

type Session = {
  me: Me | null | undefined;
  /** L'account non si è potuto leggere (rete assente): si mostra "Riprova", non il benvenuto. */
  error: string | null;
  retry: () => void;
  setMe: (me: Me | null) => void;
  /** Verifica dell'età, ruoli, notifiche non lette, impostazioni. Null finché non arriva. */
  status: Status | null;
  refreshStatus: () => void;
  /** Cresce a ogni cambiamento che le altre schermate devono vedere (nuovo post, nuova copertina). */
  version: number;
  bump: () => void;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [version, setVersion] = useState(0);
  const retry = useCallback(() => {
    setError(null);
    getMe()
      .then(setMe)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(retry, [retry]);

  const refreshStatus = useCallback(() => {
    getStatus()
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  // Lo stato si aggiorna all'accesso, a ogni cambiamento, ogni minuto e tornando nell'app.
  useEffect(() => {
    if (!me) {
      setStatus(null);
      return;
    }
    refreshStatus();
    const id = setInterval(refreshStatus, 60_000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshStatus();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [me, version, refreshStatus]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(
    () => ({ me, setMe, error, retry, status, refreshStatus, version, bump }),
    [me, error, retry, status, refreshStatus, version, bump],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession fuori da SessionProvider');
  return ctx;
}
