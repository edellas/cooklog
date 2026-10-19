import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { getMe, getStatus } from '../services/api';
import { friendlyError, setCanAct } from '../services/errors';
import { supabase } from '../services/supabase';
import type { Me, Status } from '../types';
import { forgetRecentChanges } from './postEvents';
import { clearViews } from './views';

type Session = {
  me: Me | null | undefined;
  /** L'account non si è potuto leggere (rete assente): si mostra "Riprova", non il benvenuto. */
  error: string | null;
  retry: () => void;
  setMe: (me: Me | null) => void;
  /** Stesso utente con nome o foto cambiati: niente azzeramento dello stato (non è un cambio di account). */
  updateMe: (me: Me) => void;
  /** Verifica dell'età, ruoli, notifiche non lette, impostazioni. Null finché non arriva. */
  status: Status | null;
  refreshStatus: () => Promise<void>;
  /** Cresce a ogni cambiamento che le altre schermate devono vedere (nuovo post, nuova copertina). */
  version: number;
  bump: () => void;
};

const Ctx = createContext<Session | null>(null);

/** L'utente attuale, per chi deve saperlo solo al momento di un tocco (senza ridisegnarsi a ogni cambio di stato). */
let current: Me | null = null;
export function currentMe(): Me | null {
  return current;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [version, setVersion] = useState(0);
  /** Cresce a ogni cambio di utente: le risposte arrivate tardi per l'utente precedente si scartano. */
  const generation = useRef(0);

  // Cambiando utente (uscita, nuovo accesso) non deve restare nulla del precedente in memoria.
  const setMe = useCallback((next: Me | null) => {
    generation.current += 1;
    clearViews();
    forgetRecentChanges();
    setCanAct(null);
    setStatus(null);
    setMeState(next);
  }, []);

  const updateMe = useCallback((next: Me) => setMeState((cur) => (cur && cur.id === next.id ? next : cur)), []);

  const retry = useCallback(() => {
    setError(null);
    getMe()
      .then(setMeState)
      .catch((e: unknown) => setError(friendlyError(e)));
  }, []);
  useEffect(retry, [retry]);

  // Sessione chiusa altrove (password cambiata su un altro telefono, token scaduto): si torna al benvenuto.
  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) setMe(null);
    });
    return () => data.subscription.unsubscribe();
  }, [setMe]);

  const refreshStatus = useCallback(async () => {
    const gen = generation.current;
    try {
      const next = await getStatus();
      if (gen === generation.current) {
        setCanAct(next.identity ? next.identity.canAct : null);
        setStatus(next);
      }
    } catch {
      // Si riprova al prossimo giro.
    }
  }, []);

  // Lo stato si aggiorna all'accesso, a ogni cambiamento, ogni minuto e tornando nell'app.
  useEffect(() => {
    if (!me) return;
    void refreshStatus();
    const id = setInterval(() => void refreshStatus(), 60_000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refreshStatus();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [me, version, refreshStatus]);

  useEffect(() => {
    current = me ?? null;
  }, [me]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(
    () => ({ me, setMe, updateMe, error, retry, status, refreshStatus, version, bump }),
    [me, setMe, updateMe, error, retry, status, refreshStatus, version, bump],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession fuori da SessionProvider');
  return ctx;
}
