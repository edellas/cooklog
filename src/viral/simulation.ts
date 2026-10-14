/**
 * Simulazione di una giornata di Arena con un pubblico sintetico.
 * Ogni piatto ha una "qualità reale" nascosta; gli spettatori reagiscono in modo
 * probabilistico. Serve a verificare che il motore premi davvero il piatto migliore
 * spendendo poche viste su quelli deboli.
 */
import {
  closeArena,
  createArenaState,
  DEFAULT_ARENA_CONFIG,
  seededRng,
  simulateCrowd,
  submitEntry,
  type ArenaConfig,
  type ArenaEntry,
} from './engine.ts';

export type SimulationInput = {
  entries: number;
  viewers: number;
  viewsPerViewer: number;
  /** Quota di piatti spam/inappropriati (molte segnalazioni). */
  spamShare?: number;
  seed?: number;
  config?: ArenaConfig;
};

export type SimulationResult = {
  winner: ArenaEntry | null;
  winnerQuality: number | null;
  /** Posizione del vincitore nella classifica per qualità reale (1 = il migliore). */
  winnerTrueRank: number | null;
  totalViews: number;
  entriesPerTier: number[];
  disqualified: number;
  spamWon: boolean;
};

export function simulateDay(input: SimulationInput): SimulationResult {
  const cfg = input.config ?? DEFAULT_ARENA_CONFIG;
  const rng = seededRng(input.seed ?? 42);
  const state = createArenaState('2026-01-01');
  const quality = new Map<string, number>();
  const spam = new Set<string>();

  for (let i = 0; i < input.entries; i += 1) {
    const id = `e${i}`;
    submitEntry(state, { id, postId: `p${i}`, authorId: `a${i}`, createdAt: new Date(i * 1000).toISOString() });
    const isSpam = rng() < (input.spamShare ?? 0.02);
    // Lo spam "acchiappa-click" ha qualità apparente alta: deve perdere per le segnalazioni.
    quality.set(id, isSpam ? 0.95 : rng() ** 1.5);
    if (isSpam) spam.add(id);
  }

  const totalViews = simulateCrowd(
    state,
    {
      quality: (id) => quality.get(id)!,
      isSpam: (id) => spam.has(id),
      viewers: input.viewers,
      viewsPerViewer: input.viewsPerViewer,
    },
    rng,
    cfg,
  );

  const winner = closeArena(state, [], cfg);
  const ranking = [...quality.entries()].filter(([id]) => !spam.has(id)).sort((a, b) => b[1] - a[1]);
  const winnerTrueRank = winner ? ranking.findIndex(([id]) => id === winner.id) + 1 || null : null;
  const entriesPerTier = Array.from({ length: cfg.tierThresholds.length + 1 }, (_, t) =>
    state.entries.filter((e) => e.tier === t && e.status !== 'disqualified').length,
  );

  return {
    winner,
    winnerQuality: winner ? quality.get(winner.id)! : null,
    winnerTrueRank,
    totalViews,
    entriesPerTier,
    disqualified: state.entries.filter((e) => e.status === 'disqualified').length,
    spamWon: winner ? spam.has(winner.id) : false,
  };
}
