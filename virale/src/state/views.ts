import { AppState } from 'react-native';

import { trackViews, type ViewItem } from '../services/api';

/**
 * Cosa è passato sullo schermo, raccolto e mandato a gruppi ogni pochi secondi (una chiamata invece di una
 * per post). Per lo stesso post si tiene il tempo più lungo e i segnali più forti (finito, rivisto).
 */
const pending = new Map<string, ViewItem>();
let timer: ReturnType<typeof setTimeout> | null = null;

export function queueView(postId: string, info: { dwellMs?: number; completed?: boolean; rewatched?: boolean } = {}) {
  const prev = pending.get(postId);
  const times = [prev?.dwellMs, info.dwellMs].filter((x): x is number => x !== undefined);
  pending.set(postId, {
    postId,
    // Senza tempo (copertina, post aperto da un link): conta la vista, i gusti restano com'erano.
    dwellMs: times.length ? Math.max(...times) : undefined,
    completed: Boolean(prev?.completed || info.completed),
    rewatched: Boolean(prev?.rewatched || info.rewatched),
  });
  if (pending.size >= 30) {
    void flushViews();
    return;
  }
  if (timer) return;
  timer = setTimeout(() => void flushViews(), 4000);
}

/** Invia subito quelle in sospeso (prima di uscire dall'account o quando l'app va in secondo piano). */
export async function flushViews(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const items = [...pending.values()];
  pending.clear();
  const chunks: Promise<void>[] = [];
  for (let i = 0; i < items.length; i += 30) chunks.push(trackViews(items.slice(i, i + 30)).catch(() => undefined));
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
