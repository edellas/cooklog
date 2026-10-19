import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Linking, Platform } from 'react-native';

import { isDemo, registerPushToken } from './api';
import { getJson, setJson } from './storage';

/**
 * Notifiche push sul telefono. Il permesso non si chiede all'avvio: lo si chiede dopo la prima candidatura
 * ("Vuoi sapere quando il tuo post sale di gradino?") o dalle Impostazioni, e il telefono si registra solo
 * dopo quel sì, su ogni versione di Android e iOS. Nessun errore qui blocca l'app.
 */
export type PushState = 'granted' | 'undetermined' | 'denied' | 'unavailable' | 'unsupported';

export const pushMissingReason: string | null = isDemo ? 'Nella demo le notifiche non arrivano.' : null;

// In primo piano: il banner sì, il suono no.
if (!isDemo) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

let channel: Promise<unknown> | null = null;
/** Su Android serve un canale (e prima del permesso, altrimenti Android 13 non mostra la richiesta). */
function ensureChannel(): Promise<unknown> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channel ??= Notifications.setNotificationChannelAsync('default', {
    name: 'Virale',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: '#FADB2C',
  }).catch(() => null);
  return channel;
}

/** Il token non è arrivato (per esempio una build Android senza Firebase): lo si dice nelle Impostazioni. */
let unavailable = false;

/**
 * Il sì dato nell'app ("Avvisami", "Attiva" nelle Impostazioni). Su iPhone e da Android 13 il permesso lo chiede
 * il sistema, quindi è già un consenso; fino ad Android 12 il permesso c'è da subito: senza questo sì il
 * telefono non si registra.
 */
const CONSENT_KEY = 'virale.push.consenso';
const systemAsks = Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) >= 33);
async function hasConsent(): Promise<boolean> {
  return systemAsks || (await getJson<boolean>(CONSENT_KEY, false));
}

function stateOf(p: Notifications.NotificationPermissionsStatus, consent: boolean): PushState {
  if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    if (!consent) return 'undetermined';
    return unavailable ? 'unavailable' : 'granted';
  }
  return p.canAskAgain ? 'undetermined' : 'denied';
}

export async function pushPermission(): Promise<PushState> {
  if (isDemo) return 'unsupported';
  try {
    return stateOf(await Notifications.getPermissionsAsync(), await hasConsent());
  } catch {
    return 'unavailable';
  }
}

async function syncToken(): Promise<PushState> {
  try {
    const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ?? Constants.easConfig?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await registerPushToken(data, Platform.OS === 'ios' ? 'ios' : 'android');
    unavailable = false;
    return 'granted';
  } catch {
    unavailable = true;
    return 'unavailable';
  }
}

export async function registerPush(): Promise<PushState> {
  if (isDemo) return 'unsupported';
  try {
    await ensureChannel();
    // Chi arriva qui ha toccato "Avvisami" o "Attiva": è il consenso (anche dove il sistema non chiede nulla).
    await setJson(CONSENT_KEY, true);
    let p = await Notifications.getPermissionsAsync();
    if (!p.granted && p.canAskAgain) p = await Notifications.requestPermissionsAsync();
    if (!p.granted && p.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) return stateOf(p, true);
    return await syncToken();
  } catch {
    return 'unavailable';
  }
}

export async function refreshPushToken(): Promise<void> {
  if (isDemo) return;
  try {
    const p = await Notifications.getPermissionsAsync();
    // Fino ad Android 12 il permesso c'è già all'installazione: si registra solo dopo il sì nell'app.
    if (!p.granted || !(await hasConsent())) return;
    await ensureChannel();
    await syncToken();
  } catch {
    // Si riprova al prossimo avvio.
  }
}

export function openPushSettings(): void {
  void Linking.openSettings().catch(() => undefined);
}

/**
 * Tocco su una notifica (anche ad app chiusa): si apre l'indirizzo che porta, solo se è interno all'app.
 * Si aspetta di sapere chi è l'utente (`ready`), così il benvenuto non si sovrappone.
 */
export function usePushNavigation(ready: boolean): void {
  const response = Notifications.useLastNotificationResponse();
  const router = useRouter();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (isDemo || !ready || !response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const url = (response.notification.request.content.data as { url?: unknown } | undefined)?.url;
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) router.push(url as Href);
    void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  }, [ready, response, router]);
}
