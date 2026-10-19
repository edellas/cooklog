import { useNavigation, useRoute } from '@react-navigation/native';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';

import { hasNavigatedInApp, noteInAppNavigation } from './nav';

/**
 * Torna indietro; se non c'è niente dietro (link aperto da fuori, pagina web ricaricata)
 * porta alla schermata indicata invece di non fare nulla.
 * Una schermata aperta direttamente all'avvio ha sotto solo i tab aggiunti da expo-router (spesso con i
 * parametri del link copiati): lì "indietro" porta alla destinazione indicata (l'Archivio, il Profilo…)
 * invece che sempre alla Copertina.
 */
export function useGoBack(fallback: Href = '/') {
  const router = useRouter();
  const route = useRoute();
  const navigation = useNavigation();
  // Deciso una volta, quando la schermata compare: dopo, l'utente può aver navigato altrove e tornare qui.
  const [direct] = useState(() => {
    if (hasNavigatedInApp()) return false;
    const st = navigation.getState();
    const at = st?.routes.findIndex((r) => r.key === route.key) ?? -1;
    return at === 1 && st?.routes[0]?.name === '(tabs)';
  });
  return useCallback(() => {
    noteInAppNavigation();
    if (direct) router.dismissTo(fallback);
    else if (router.canGoBack()) router.back();
    else router.replace(fallback);
  }, [router, fallback, direct]);
}
