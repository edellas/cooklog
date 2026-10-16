import { AppState } from 'react-native';

import { registerViews } from '../services/api';

/**
 * Visualizzazioni a gruppi: invece di una chiamata per ogni post visto, l'app ne manda al massimo una
 * ogni pochi secondi con tutti i post rimasti sullo schermo almeno un secondo.
 */
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function queueView(postId: string) {
  pending.add(postId);
  if (timer) return;
  timer = setTimeout(() => void flushViews(), 3000);
}

/** Invia subito quelle in sospeso (prima di uscire dall'account o quando l'app va in secondo piano). */
export async function flushViews(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const ids = [...pending];
  pending.clear();
  const chunks: Promise<void>[] = [];
  for (let i = 0; i < ids.length; i += 20) chunks.push(registerViews(ids.slice(i, i + 20)).catch(() => undefined));
  await Promise.all(chunks);
}

/** Cambiando account le viste in sospeso erano dell'altra persona: si buttano. */
export function clearViews() {
  if (timer) clearTimeout(timer);
  timer = null;
  pending.clear();
}

AppState.addEventListener('change', (state) => {
  if (state === 'background') void flushViews();
});
