import { useCallback } from 'react';

import { useToast } from '../components/Toast';
import { VERIFY_ERROR } from '../services/errors';
import { useNav } from './nav';
import { useSession } from './session';

/**
 * Cerchiare, salvare, seguire, commentare e condividere richiedono la verifica dell'età (o di essere ancora
 * nei giorni concessi). Se è scaduta non si chiama il server per poi dire "riprova": lo si spiega subito,
 * con il pulsante per verificarsi.
 */
export function useActGuard() {
  const { status } = useSession();
  const toast = useToast();
  const nav = useNav();
  const blocked = status?.identity?.canAct === false;
  return useCallback((): boolean => {
    if (!blocked) return true;
    toast(VERIFY_ERROR, 'error', { label: 'Verifica', onPress: () => nav.push('/verifica') });
    return false;
  }, [blocked, nav, toast]);
}
