import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getMe } from '../services/api';
import type { Me } from '../types';

type Session = {
  me: Me | null | undefined;
  setMe: (me: Me | null) => void;
  /** Cresce a ogni cambiamento che le altre schermate devono vedere (nuovo post, nuova copertina). */
  version: number;
  bump: () => void;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    void getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(() => ({ me, setMe, version, bump }), [me, version, bump]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession fuori da SessionProvider');
  return ctx;
}
