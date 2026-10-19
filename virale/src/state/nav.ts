import { useRouter, type Href } from 'expo-router';
import { useMemo } from 'react';

/**
 * Navigazione a prova di doppio tocco: due tocchi rapidi sul nome di un autore aprirebbero due volte lo
 * stesso profilo (e servirebbero due "indietro"). Una seconda navigazione verso lo stesso indirizzo entro
 * 700 ms si ignora. Anche verso un indirizzo diverso entro 350 ms: è il secondo tocco di un doppio tocco
 * finito sulla schermata appena aperta (che compare sotto il dito), non una scelta.
 */
const SAME_TARGET_MS = 700;
const ANY_TARGET_MS = 350;
let last: { key: string; at: number } | null = null;

/** È già avvenuta una navigazione dentro l'app (vedi useGoBack: distingue una schermata aperta da un link). */
let navigatedInApp = false;
export function noteInAppNavigation() {
  navigatedInApp = true;
}
export function hasNavigatedInApp(): boolean {
  return navigatedInApp;
}

function firstTap(href: Href): boolean {
  navigatedInApp = true;
  const key = typeof href === 'string' ? href : JSON.stringify(href);
  const now = Date.now();
  if (last && now - last.at < (last.key === key ? SAME_TARGET_MS : ANY_TARGET_MS)) return false;
  last = { key, at: now };
  return true;
}

export function useNav() {
  const router = useRouter();
  return useMemo(
    () => ({
      push: (href: Href) => {
        if (firstTap(href)) router.push(href);
      },
      navigate: (href: Href) => {
        if (firstTap(href)) router.navigate(href);
      },
      replace: (href: Href) => {
        navigatedInApp = true;
        router.replace(href);
      },
      dismissTo: (href: Href) => {
        navigatedInApp = true;
        router.dismissTo(href);
      },
      back: () => router.back(),
      canGoBack: () => router.canGoBack(),
    }),
    [router],
  );
}

