import { useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';

/**
 * Torna indietro; se non c'è niente dietro (link aperto da fuori, pagina web ricaricata)
 * porta alla schermata indicata invece di non fare nulla.
 */
export function useGoBack(fallback: Href = '/') {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  }, [router, fallback]);
}
