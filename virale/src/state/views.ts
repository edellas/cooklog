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
  timer = setTimeout(flushViews, 3000);
}

export function flushViews() {
  if (timer) clearTimeout(timer);
  timer = null;
  const ids = [...pending];
  pending.clear();
  for (let i = 0; i < ids.length; i += 20) registerViews(ids.slice(i, i + 20)).catch(() => undefined);
}
