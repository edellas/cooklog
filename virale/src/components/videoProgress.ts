/**
 * Quanto di un video è stato guardato davvero: è un segnale della gara, quindi trascinare la barra non
 * deve "completare" un video. Funzione pura (senza React), provata in videoProgress.test.ts.
 *
 * - `watched` cresce solo con l'avanzamento normale (aggiornamenti a meno di 1 secondo l'uno dall'altro);
 * - dopo uno spostamento a mano (`seekedAt`) per 600 ms gli aggiornamenti non contano e la posizione riparte da lì;
 * - un giro naturale (dalla fine all'inizio) conta solo senza spostamenti a mano negli ultimi 600 ms e se in
 *   quel giro se n'è guardata almeno metà (saltare alla fine e lasciarlo ripartire non è un giro);
 * - completato: almeno un giro, o l'85% della durata guardato; rivisto: un giro e almeno una durata intera.
 */
export type ProgressState = {
  /** Secondi guardati davvero, in tutto. */
  watched: number;
  /** Secondi guardati nel giro in corso. */
  lap: number;
  /** Ultima posizione vista (secondi). */
  last: number;
  loops: number;
  completed: boolean;
  rewatched: boolean;
};

export type ProgressUpdate = {
  /** Posizione attuale (secondi). */
  time: number;
  /** Durata del video (secondi). */
  duration: number;
  /** Quando c'è stato l'ultimo spostamento a mano (ms, stesso orologio di `now`). */
  seekedAt?: number | null;
  now: number;
};

export const SEEK_QUIET_MS = 600;

export function initialProgress(): ProgressState {
  return { watched: 0, lap: 0, last: 0, loops: 0, completed: false, rewatched: false };
}

export function nextProgress(state: ProgressState, { time, duration, seekedAt, now }: ProgressUpdate): ProgressState {
  if (!(duration > 0) || !Number.isFinite(time)) return state;
  const s = { ...state };
  const recentSeek = seekedAt != null && now - seekedAt < SEEK_QUIET_MS;
  if (recentSeek) {
    // Subito dopo uno spostamento: si riparte dalla posizione nuova, senza contare nulla (né un giro).
    s.last = time;
    s.lap = 0;
  } else {
    const delta = time - s.last;
    if (delta > 0 && delta < 1) {
      s.watched += delta;
      s.lap += delta;
    } else if (s.last > duration - 1 && time < 1 && s.lap >= duration * 0.5) {
      s.loops += 1;
      s.lap = time;
      s.watched += time;
    } else if (delta < 0) {
      // Indietro senza un giro naturale: si riparte da qui, il giro ricomincia.
      s.lap = 0;
    }
    s.last = time;
  }
  s.completed = s.loops > 0 || s.watched >= duration * 0.85;
  s.rewatched = s.loops > 0 && s.watched >= duration;
  return s;
}
