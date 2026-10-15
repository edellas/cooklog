import { Platform, Share } from 'react-native';

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
