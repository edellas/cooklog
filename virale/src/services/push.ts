/**
 * Notifiche push: sul web (e nella demo) non ci sono. La versione per telefono è push.native.ts:
 * Metro sceglie da sola quella giusta, così expo-notifications non entra nel sito.
 */
export type PushState = 'granted' | 'undetermined' | 'denied' | 'unavailable' | 'unsupported';

/** Perché le notifiche non ci sono qui (null = ci sono). */
export const pushMissingReason: string | null = 'Le notifiche arrivano sull’app per telefono.';

export async function pushPermission(): Promise<PushState> {
  return 'unsupported';
}

/** Chiede il permesso (se serve) e registra il telefono. */
export async function registerPush(): Promise<PushState> {
  return 'unsupported';
}

/** All'accesso o all'avvio: se il permesso c'è già, si aggiorna il token in silenzio. */
export async function refreshPushToken(): Promise<void> {}

export function openPushSettings(): void {}

/** Tocco su una notifica: apre la schermata giusta. */
export function usePushNavigation(_ready: boolean): void {}
