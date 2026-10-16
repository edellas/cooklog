/**
 * Motore "Virale del giorno".
 *
 * Modulo puro (nessuna dipendenza da React Native): lo usano l'app in modalità demo,
 * i test e la simulazione. La versione server (supabase/schema.sql) implementa la
 * stessa logica in SQL: se cambi pesi o soglie qui, aggiornali anche lì.
 *
 * Idea (vedi README.md):
 * - Giorno D: ogni utente può candidare UN post (foto e/o video) ai Provini.
 *   Gli spettatori ricevono i post alla cieca (li sceglie il server: non si può
 *   "votare l'amico") e i segnali impliciti (completamento, ri-visione, like,
 *   commenti, salvataggi, condivisioni, skip, segnalazioni) alimentano livelli di traffico come su TikTok:
 *   50 → 300 → 1.800 → 10.000 viste. Sale solo chi supera il percentile del livello.
 * - Fine giorno D: vince UN solo utente (livello più alto, poi limite inferiore del
 *   punteggio: la fortuna su pochi dati non basta).
 * - Giorno D+1: il vincitore è la Copertina, la prima cosa che vede chiunque apra l'app.
 */

export type ArenaConfig = {
  /** Viste cumulative necessarie per completare il livello i. Dopo l'ultimo si è finalisti. */
  tierThresholds: number[];
  /** Percentile (0-1) del proprio livello da superare per essere promossi. */
  promotePercentile: number;
  /** Sotto questa dimensione di coorte si usa la soglia assoluta baselineScore. */
  minCohort: number;
  baselineScore: number;
  /** Giorni durante i quali un vincitore non può rivincere. */
  winnerCooldownDays: number;
  /** Oltre questo tasso di segnalazioni (con almeno reportMinViews viste) il contenuto è squalificato. */
  maxReportRate: number;
  reportMinViews: number;
  /** Tempo di visione oltre il quale la vista conta come "completata". */
  completeDwellMs: number;
  /** Tempo di visione sotto il quale la vista conta come "skip". */
  skipDwellMs: number;
  /** Tempo di visione massimo accettato (anti-manipolazione). */
  maxDwellMs: number;
  /** Pseudo-viste del prior bayesiano. */
  smoothing: number;
  /** Punti per vista attesi da un contenuto medio (prior). */
  priorPointsPerView: number;
  /** Ampiezza usata per il limite inferiore del punteggio. */
  lcbSpread: number;
  /** Quota di ogni batch riservata ai contenuti già promossi (il resto è esplorazione dei nuovi). */
  upperShare: number;
  /** Ora (nel fuso di gara) da cui non si accettano più candidature per la giornata. */
  submissionCutoffHour: number;
  timeZone: string;
};

export const DEFAULT_ARENA_CONFIG: ArenaConfig = {
  tierThresholds: [50, 300, 1800, 10000],
  promotePercentile: 0.8,
  minCohort: 10,
  baselineScore: 0.35,
  winnerCooldownDays: 30,
  maxReportRate: 0.02,
  reportMinViews: 50,
  completeDwellMs: 3000,
  skipDwellMs: 1500,
  maxDwellMs: 60000,
  smoothing: 20,
  priorPointsPerView: 0.15,
  lcbSpread: 2,
  upperShare: 0.5,
  submissionCutoffHour: 20,
  timeZone: 'Europe/Rome',
};

/** Pesi per vista: chi riguarda o condivide vale più di chi mette solo like (come su TikTok). */
export const SIGNAL_POINTS = {
  complete: 1,
  rewatch: 1.5,
  like: 2,
  comment: 3,
  save: 3,
  share: 6,
  skip: -1.5,
  report: -20,
} as const;

export type EntryStats = {
  views: number;
  completes: number;
  rewatches: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  skips: number;
  reports: number;
  dwellMs: number;
};

export type EntryStatus = 'active' | 'parked' | 'finalist' | 'disqualified';

export type ArenaEntry = {
  id: string;
  postId: string;
  authorId: string;
  contestDay: string;
  tier: number;
  status: EntryStatus;
  lastScore: number | null;
  createdAt: string;
  stats: EntryStats;
};

export type ViewSignal = {
  dwellMs: number;
  /** Per i video: visto fino in fondo (se assente si usa la soglia di tempo). */
  completed?: boolean;
  /** Per i video: ripartito almeno una volta. */
  rewatched?: boolean;
  liked?: boolean;
  commented?: boolean;
  saved?: boolean;
  shared?: boolean;
  reported?: boolean;
};

export type ArenaState = {
  day: string;
  closed: boolean;
  entries: ArenaEntry[];
  /** Punteggi di chi ha completato ciascun livello (coorte per il percentile). */
  tierScores: Record<number, number[]>;
  /** viewerId -> entryId -> true se la vista è già stata registrata, false se solo servita. */
  served: Record<string, Record<string, boolean>>;
};

export type Rng = () => number;

export function emptyStats(): EntryStats {
  return { views: 0, completes: 0, rewatches: 0, likes: 0, comments: 0, saves: 0, shares: 0, skips: 0, reports: 0, dwellMs: 0 };
}

export function applySignal(stats: EntryStats, signal: ViewSignal, cfg: ArenaConfig = DEFAULT_ARENA_CONFIG): EntryStats {
  const dwell = Math.max(0, Math.min(cfg.maxDwellMs, Math.round(signal.dwellMs || 0)));
  return {
    views: stats.views + 1,
    // Come arena_record_view: per i video conta se è arrivato alla fine (con un tempo compatibile), per le
    // foto il tempo; la ri-visione conta solo con almeno due volte la soglia di completamento.
    completes:
      stats.completes + ((signal.completed !== undefined ? signal.completed && dwell >= cfg.skipDwellMs : dwell >= cfg.completeDwellMs) ? 1 : 0),
    rewatches: stats.rewatches + (signal.rewatched && dwell >= 2 * cfg.completeDwellMs ? 1 : 0),
    likes: stats.likes + (signal.liked ? 1 : 0),
    comments: stats.comments + (signal.commented ? 1 : 0),
    saves: stats.saves + (signal.saved ? 1 : 0),
    shares: stats.shares + (signal.shared ? 1 : 0),
    skips: stats.skips + (dwell < cfg.skipDwellMs ? 1 : 0),
    reports: stats.reports + (signal.reported ? 1 : 0),
    dwellMs: stats.dwellMs + dwell,
  };
}

export function engagementPoints(stats: EntryStats): number {
  return (
    stats.completes * SIGNAL_POINTS.complete +
    stats.rewatches * SIGNAL_POINTS.rewatch +
    stats.likes * SIGNAL_POINTS.like +
    stats.comments * SIGNAL_POINTS.comment +
    stats.saves * SIGNAL_POINTS.save +
    stats.shares * SIGNAL_POINTS.share +
    stats.skips * SIGNAL_POINTS.skip +
    stats.reports * SIGNAL_POINTS.report
  );
}

/** Punti medi per vista, con prior bayesiano: pochi dati => vicino alla media. */
export function qualityScore(stats: EntryStats, cfg: ArenaConfig = DEFAULT_ARENA_CONFIG): number {
  return (engagementPoints(stats) + cfg.smoothing * cfg.priorPointsPerView) / (stats.views + cfg.smoothing);
}

/** Limite inferiore prudente: premia chi è bravo su tante viste, non chi è fortunato su poche. */
export function lowerBoundScore(stats: EntryStats, cfg: ArenaConfig = DEFAULT_ARENA_CONFIG): number {
  return qualityScore(stats, cfg) - cfg.lcbSpread / Math.sqrt(stats.views + cfg.smoothing);
}

export function isFinalTier(tier: number, cfg: ArenaConfig = DEFAULT_ARENA_CONFIG): boolean {
  return tier >= cfg.tierThresholds.length;
}

/** Percentile con interpolazione lineare (come percentile_cont di Postgres). */
export function percentile(values: number[], p: number): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function isDisqualified(stats: EntryStats, cfg: ArenaConfig = DEFAULT_ARENA_CONFIG): boolean {
  return stats.views >= cfg.reportMinViews && stats.reports / stats.views > cfg.maxReportRate;
}

export function createArenaState(day: string): ArenaState {
  return { day, closed: false, entries: [], tierScores: {}, served: {} };
}

export function submitEntry(
  state: ArenaState,
  input: { id: string; postId: string; authorId: string; createdAt?: string },
): ArenaEntry {
  if (state.closed) throw new Error("L'Arena di oggi è chiusa.");
  if (state.entries.some((e) => e.authorId === input.authorId)) {
    throw new Error('Puoi candidare un solo contenuto al giorno.');
  }
  if (state.entries.some((e) => e.postId === input.postId)) {
    throw new Error('Questo contenuto è già in gara.');
  }
  const entry: ArenaEntry = {
    id: input.id,
    postId: input.postId,
    authorId: input.authorId,
    contestDay: state.day,
    tier: 0,
    status: 'active',
    lastScore: null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    stats: emptyStats(),
  };
  state.entries.push(entry);
  return entry;
}

function isServable(entry: ArenaEntry): boolean {
  return entry.status === 'active' || entry.status === 'finalist';
}

/** Campionamento pesato senza reinserimento (Efraimidis–Spirakis). */
function weightedSample<T>(items: T[], n: number, weight: (item: T) => number, rng: Rng): T[] {
  return items
    .map((item) => ({ item, key: -Math.log(Math.max(rng(), 1e-12)) / Math.max(weight(item), 1e-9) }))
    .sort((a, b) => a.key - b.key)
    .slice(0, n)
    .map((x) => x.item);
}

/**
 * Sceglie i prossimi contenuti da mostrare a uno spettatore. Metà batch va ai contenuti già promossi
 * (pesati per livello: devono raccogliere più viste), il resto all'esplorazione dei nuovi:
 * ogni nuovo contenuto riceve il suo pubblico iniziale, indipendentemente dai follower.
 */
export function serveBatch(
  state: ArenaState,
  viewerId: string,
  limit: number,
  rng: Rng = Math.random,
  cfg: ArenaConfig = DEFAULT_ARENA_CONFIG,
  /** Già sullo schermo di chi guarda: non si ripropongono nella stessa lista. */
  exclude: ReadonlySet<string> = new Set(),
): ArenaEntry[] {
  if (state.closed || limit <= 0) return [];
  const seen = state.served[viewerId] ?? {};
  // Come sul server: un candidato consegnato ma mai guardato torna disponibile (non si perde se il feed si ricarica).
  const candidates = state.entries.filter((e) => isServable(e) && e.authorId !== viewerId && seen[e.id] !== true && !exclude.has(e.id));
  const upper = candidates.filter((e) => e.tier >= 1);
  const lower = candidates.filter((e) => e.tier === 0);

  const upperSlots = Math.min(upper.length, Math.ceil(limit * cfg.upperShare));
  const pickedUpper = weightedSample(upper, upperSlots, (e) => 1 + e.tier, rng);
  const pickedLower = weightedSample(lower, limit - pickedUpper.length, () => 1, rng);
  let picked = [...pickedUpper, ...pickedLower];
  if (picked.length < limit) {
    const taken = new Set(picked.map((e) => e.id));
    const rest = upper.filter((e) => !taken.has(e.id));
    picked = [...picked, ...weightedSample(rest, limit - picked.length, (e) => 1 + e.tier, rng)];
  }

  const shuffled = weightedSample(picked, picked.length, () => 1, rng);
  const viewerMap = (state.served[viewerId] = { ...seen });
  for (const e of shuffled) viewerMap[e.id] = false;
  return shuffled;
}

export type EvaluationResult = { tier: number; score: number; promoted: boolean } | null;

/** Valuta un contenuto che ha raggiunto la soglia del proprio livello. Muta lo stato. */
export function evaluateEntry(state: ArenaState, entry: ArenaEntry, cfg: ArenaConfig = DEFAULT_ARENA_CONFIG): EvaluationResult {
  if (entry.status !== 'active') return null;
  if (isDisqualified(entry.stats, cfg)) {
    entry.status = 'disqualified';
    return null;
  }
  const threshold = cfg.tierThresholds[entry.tier];
  if (threshold === undefined || entry.stats.views < threshold) return null;

  const score = qualityScore(entry.stats, cfg);
  const cohort = (state.tierScores[entry.tier] = [...(state.tierScores[entry.tier] ?? []), score]);
  const cut = cohort.length >= cfg.minCohort ? percentile(cohort, cfg.promotePercentile) : cfg.baselineScore;
  const promoted = score >= cut;
  const evaluatedTier = entry.tier;

  entry.lastScore = score;
  if (promoted) {
    entry.tier += 1;
    if (isFinalTier(entry.tier, cfg)) entry.status = 'finalist';
  } else {
    entry.status = 'parked';
  }
  return { tier: evaluatedTier, score, promoted };
}

/**
 * Registra una vista. Accetta solo contenuti effettivamente serviti a quello spettatore e una sola volta:
 * non si può scegliere chi votare né votare due volte.
 */
export function recordView(
  state: ArenaState,
  viewerId: string,
  entryId: string,
  signal: ViewSignal,
  cfg: ArenaConfig = DEFAULT_ARENA_CONFIG,
): { accepted: boolean; evaluation: EvaluationResult } {
  const viewerMap = state.served[viewerId];
  if (state.closed || !viewerMap || viewerMap[entryId] !== false) return { accepted: false, evaluation: null };
  const entry = state.entries.find((e) => e.id === entryId);
  if (!entry || entry.authorId === viewerId) return { accepted: false, evaluation: null };

  viewerMap[entryId] = true;
  entry.stats = applySignal(entry.stats, signal, cfg);
  if (entry.status === 'finalist' && isDisqualified(entry.stats, cfg)) entry.status = 'disqualified';
  return { accepted: true, evaluation: evaluateEntry(state, entry, cfg) };
}

/** Ordinamento finale: livello raggiunto, poi limite inferiore del punteggio, poi chi è arrivato prima. */
export function rankEntries(entries: ArenaEntry[], cfg: ArenaConfig = DEFAULT_ARENA_CONFIG): ArenaEntry[] {
  return entries
    .filter((e) => e.status !== 'disqualified' && !isDisqualified(e.stats, cfg) && e.stats.views > 0)
    .sort(
      (a, b) =>
        b.tier - a.tier ||
        lowerBoundScore(b.stats, cfg) - lowerBoundScore(a.stats, cfg) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

/** Chiude la giornata e restituisce l'unico vincitore (o null se nessuno è idoneo). */
export function closeArena(
  state: ArenaState,
  recentWinnerAuthorIds: Iterable<string> = [],
  cfg: ArenaConfig = DEFAULT_ARENA_CONFIG,
): ArenaEntry | null {
  const blocked = new Set(recentWinnerAuthorIds);
  state.closed = true;
  return rankEntries(state.entries, cfg).find((e) => !blocked.has(e.authorId)) ?? null;
}

/** Giorno di gara (YYYY-MM-DD) nel fuso orario configurato. */
export function arenaDay(date: Date = new Date(), timeZone: string = DEFAULT_ARENA_CONFIG.timeZone): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
}

export function shiftDay(day: string, deltaDays: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** RNG deterministico (mulberry32) per simulazioni e test riproducibili. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scarto in millisecondi tra l'ora locale del fuso e UTC in un dato istante (es. +2h a Roma d'estate). */
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wall - (date.getTime() - date.getMilliseconds());
}

/** Istante (epoch ms) della mezzanotte locale che apre il giorno `day` nel fuso di gara. */
export function arenaDayStart(day: string, timeZone: string = DEFAULT_ARENA_CONFIG.timeZone): number {
  const naive = Date.parse(`${day}T00:00:00Z`);
  // Due passaggi: l'offset da usare è quello in vigore a mezzanotte, che può differire da quello di adesso (ora legale).
  let t = naive - tzOffsetMs(new Date(naive), timeZone);
  t = naive - tzOffsetMs(new Date(t), timeZone);
  return t;
}

/** Istante (epoch ms) dell'ora locale `minutes` (minuti dalla mezzanotte) del giorno `day` nel fuso di gara. */
export function wallTimeToEpoch(day: string, minutes: number, timeZone: string = DEFAULT_ARENA_CONFIG.timeZone): number {
  const naive = Date.parse(`${day}T00:00:00Z`) + minutes * 60_000;
  let t = naive - tzOffsetMs(new Date(naive), timeZone);
  t = naive - tzOffsetMs(new Date(t), timeZone);
  return t;
}

/**
 * Il giorno della copertina visibile adesso: la gara chiude a mezzanotte, ma la nuova copertina
 * compare all'orario scelto dall'amministratore (`revealMinutes` dopo la mezzanotte).
 */
export function coverDay(revealMinutes: number, date: Date = new Date(), timeZone: string = DEFAULT_ARENA_CONFIG.timeZone): string {
  const today = arenaDay(date, timeZone);
  return date.getTime() >= wallTimeToEpoch(today, revealMinutes, timeZone) ? today : shiftDay(today, -1);
}

/** Millisecondi alla prossima rivelazione della copertina. */
export function msUntilReveal(revealMinutes: number, date: Date = new Date(), timeZone: string = DEFAULT_ARENA_CONFIG.timeZone): number {
  try {
    const today = arenaDay(date, timeZone);
    const todayReveal = wallTimeToEpoch(today, revealMinutes, timeZone);
    const next = date.getTime() < todayReveal ? todayReveal : wallTimeToEpoch(shiftDay(today, 1), revealMinutes, timeZone);
    return Math.max(0, next - date.getTime());
  } catch {
    return msUntilArenaClose(date, timeZone);
  }
}

/**
 * Millisecondi alla chiusura dell'Arena (mezzanotte nel fuso orario di gara).
 * Tiene conto dei giorni da 23 o 25 ore del cambio d'ora.
 */
export function msUntilArenaClose(date: Date = new Date(), timeZone: string = DEFAULT_ARENA_CONFIG.timeZone): number {
  try {
    return Math.max(0, arenaDayStart(shiftDay(arenaDay(date, timeZone), 1), timeZone) - date.getTime());
  } catch {
    const end = new Date(date);
    end.setHours(24, 0, 0, 0);
    return end.getTime() - date.getTime();
  }
}

/** Le candidature della giornata sono aperte fino all'ora di chiusura (le 20 a Roma). */
export function submissionsOpen(date: Date = new Date(), cfg: ArenaConfig = DEFAULT_ARENA_CONFIG): boolean {
  try {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: cfg.timeZone, hour: '2-digit', hourCycle: 'h23' }).formatToParts(date).find((p) => p.type === 'hour')?.value ?? 0,
    );
    return hour < cfg.submissionCutoffHour;
  } catch {
    return date.getHours() < cfg.submissionCutoffHour;
  }
}

/** Reazione plausibile di uno spettatore a un contenuto di qualità `quality` (0-1). */
export function syntheticReaction(quality: number, spam: boolean, rng: Rng): ViewSignal {
  const watches = rng() < 0.15 + 0.7 * quality;
  const bounced = !watches && rng() < 0.75 - 0.5 * quality;
  const dwellMs = watches ? 3000 + rng() * 12000 : bounced ? rng() * 1400 : 1600 + rng() * 1300;
  return {
    dwellMs,
    liked: watches && rng() < 0.03 + 0.2 * quality,
    commented: watches && rng() < 0.004 + 0.04 * quality,
    saved: watches && rng() < 0.005 + 0.1 * quality * quality,
    shared: watches && rng() < 0.002 + 0.05 * quality ** 3,
    reported: rng() < (spam ? 0.08 : 0.001),
    rewatched: watches && rng() < 0.02 + 0.15 * quality,
  };
}

/** Fa passare un pubblico sintetico sull'Arena. Restituisce le viste accettate. */
export function simulateCrowd(
  state: ArenaState,
  input: {
    quality: (entryId: string) => number;
    isSpam?: (entryId: string) => boolean;
    viewers: number;
    viewsPerViewer: number;
    viewerPrefix?: string;
    forgetViewers?: boolean;
  },
  rng: Rng,
  cfg: ArenaConfig = DEFAULT_ARENA_CONFIG,
): number {
  let accepted = 0;
  const prefix = input.viewerPrefix ?? 'crowd-';
  for (let v = 0; v < input.viewers; v += 1) {
    const viewerId = `${prefix}${v}`;
    let remaining = input.viewsPerViewer;
    while (remaining > 0) {
      const batch = serveBatch(state, viewerId, Math.min(10, remaining), rng, cfg);
      if (!batch.length) break;
      for (const entry of batch) {
        const signal = syntheticReaction(input.quality(entry.id), input.isSpam?.(entry.id) ?? false, rng);
        if (recordView(state, viewerId, entry.id, signal, cfg).accepted) accepted += 1;
      }
      remaining -= batch.length;
    }
    if (input.forgetViewers) delete state.served[viewerId];
  }
  return accepted;
}
