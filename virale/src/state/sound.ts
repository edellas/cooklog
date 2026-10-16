import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

/**
 * Audio dei video, uguale in tutta l'app come su TikTok: sul telefono parte acceso, e se lo spegni resta
 * spento ovunque finché non lo riaccendi. Sul web parte spento: i browser bloccano i video con l'audio
 * che partono da soli.
 */
let muted = Platform.OS === 'web';
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function toggleMute() {
  muted = !muted;
  listeners.forEach((l) => l());
}

export function useMuted(): boolean {
  return useSyncExternalStore(subscribe, () => muted, () => muted);
}
