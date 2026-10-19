import { getJson, setJson } from '../services/storage';
import type { ToastAction } from '../components/Toast';
import { currentMe } from './session';

/**
 * Suggerimenti che compaiono una volta sola per persona (sul dispositivo): la spiegazione di In gara,
 * il primo cerchio, la festa della vittoria.
 */
const seen = new Set<string>();

/** true la prima volta per quella chiave (e la segna come vista). */
export async function firstTime(key: string): Promise<boolean> {
  if (seen.has(key)) return false;
  seen.add(key);
  if (await getJson<boolean>(key, false)) return false;
  await setJson(key, true);
  return true;
}

/** Già visto? Senza segnarlo. */
export async function alreadySeen(key: string): Promise<boolean> {
  return seen.has(key) || (await getJson<boolean>(key, false));
}

export async function markSeen(key: string): Promise<void> {
  seen.add(key);
  await setJson(key, true);
}

/** Primo cerchio della vita: si spiega che è il "mi piace" di Virale. */
export function firstCircleHint(userId: string | undefined, toast: (text: string) => void) {
  if (!userId) return;
  void firstTime(`virale.primo.cerchio.${userId}`).then((first) => {
    if (first) toast('Hai cerchiato: è il nostro mi piace.');
  });
}

/** Dopo "Salva": dove trovarlo, con "Vedi" che apre i propri Salvati. */
export function savedToast(toast: (text: string, tone?: 'ok' | 'error', action?: ToastAction) => void, push: (to: string) => void) {
  const me = currentMe();
  toast('Salvato nei tuoi Salvati', 'ok', me ? { label: 'Vedi', onPress: () => push(`/scorri/${me.username}?tipo=saved`) } : undefined);
}
