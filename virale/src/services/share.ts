import { Platform, Share } from 'react-native';

import { OWNER } from '../legal/docs';

/**
 * Apre il foglio di condivisione. Restituisce true solo se la condivisione è avvenuta:
 * chiudere il foglio senza condividere non conta (la condivisione pesa molto nella gara).
 * Sul web senza foglio di sistema copia il testo negli appunti.
 */
export async function shareText(message: string): Promise<'shared' | 'copied' | 'none'> {
  try {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: unknown }) : undefined;
    if (Platform.OS === 'web' && nav && typeof nav.share !== 'function') {
      await nav.clipboard.writeText(message);
      return 'copied';
    }
    const res = await Share.share({ message });
    return res.action === Share.dismissedAction ? 'none' : 'shared';
  } catch {
    return 'none';
  }
}

/** "Invita amici": il testo da condividere (null senza il sito del titolare, e allora la riga non compare). */
export function inviteText(): string | null {
  return OWNER.website ? `Ogni giorno una sola copertina, scelta da chi guarda. Vieni su Virale: ${OWNER.website}/` : null;
}

/** Condivide l'invito; sul web senza foglio di sistema lo copia e lo dice. */
export async function invite(toast: (text: string) => void): Promise<void> {
  const text = inviteText();
  if (!text) return;
  if ((await shareText(text)) === 'copied') toast('Link copiato: incollalo dove vuoi.');
}
