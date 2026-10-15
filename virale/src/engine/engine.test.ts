import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applySignal,
  arenaDay,
  closeArena,
  createArenaState,
  DEFAULT_ARENA_CONFIG,
  emptyStats,
  lowerBoundScore,
  coverDay,
  msUntilArenaClose,
  msUntilReveal,
  percentile,
  qualityScore,
  recordView,
  seededRng,
  serveBatch,
  shiftDay,
  submitEntry,
  submissionsOpen,
  type ArenaState,
} from './engine.ts';
import { simulateDay } from './simulation.ts';

const GOOD = { dwellMs: 8000, liked: true, shared: true };
const BAD = { dwellMs: 500 };

function stateWith(n: number): ArenaState {
  const state = createArenaState('2026-10-15');
  for (let i = 0; i < n; i += 1) {
    submitEntry(state, { id: `e${i}`, postId: `p${i}`, authorId: `a${i}`, createdAt: new Date(i).toISOString() });
  }
  return state;
}

describe('punteggio', () => {
  it('senza viste vale il prior', () => {
    assert.equal(qualityScore(emptyStats()), DEFAULT_ARENA_CONFIG.priorPointsPerView);
  });

  it('un commento vale più di un like', () => {
    const liked = applySignal(emptyStats(), { dwellMs: 5000, liked: true });
    const commented = applySignal(emptyStats(), { dwellMs: 5000, commented: true });
    assert.equal(commented.comments, 1);
    assert.ok(qualityScore(commented) > qualityScore(liked));
  });

  it('per i video conta il completamento reale, non il tempo', () => {
    const s = applySignal(emptyStats(), { dwellMs: 20000, completed: false, rewatched: true });
    assert.equal(s.completes, 0);
    assert.equal(s.rewatches, 1);
  });

  it('classifica completamenti/condivisioni sopra gli skip', () => {
    let good = emptyStats();
    let bad = emptyStats();
    for (let i = 0; i < 30; i += 1) {
      good = applySignal(good, GOOD);
      bad = applySignal(bad, BAD);
    }
    assert.ok(qualityScore(good) > qualityScore(bad));
    assert.equal(good.completes, 30);
    assert.equal(bad.skips, 30);
  });

  it('il limite inferiore premia la stessa qualità su più viste', () => {
    let few = emptyStats();
    let many = emptyStats();
    for (let i = 0; i < 10; i += 1) few = applySignal(few, GOOD);
    for (let i = 0; i < 1000; i += 1) many = applySignal(many, GOOD);
    assert.ok(lowerBoundScore(many) > lowerBoundScore(few));
  });

  it('limita il tempo di visione dichiarato dal client', () => {
    const s = applySignal(emptyStats(), { dwellMs: 10_000_000 });
    assert.equal(s.dwellMs, DEFAULT_ARENA_CONFIG.maxDwellMs);
  });

  it('percentile interpola come percentile_cont', () => {
    assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
    assert.equal(percentile([0, 10], 0.8), 8);
  });
});

describe('regole della gara', () => {
  it('un solo contenuto per utente al giorno', () => {
    const state = stateWith(1);
    assert.throws(() => submitEntry(state, { id: 'x', postId: 'px', authorId: 'a0' }));
  });

  it("non si vede il proprio contenuto e non si vota ciò che non è stato servito", () => {
    const state = stateWith(3);
    const batch = serveBatch(state, 'a0', 10, seededRng(1));
    assert.ok(batch.every((e) => e.authorId !== 'a0'));
    assert.equal(recordView(state, 'intruso', 'e1', GOOD).accepted, false);
  });

  it('una vista per spettatore per contenuto', () => {
    const state = stateWith(2);
    const [entry] = serveBatch(state, 'v1', 1, seededRng(2));
    assert.equal(recordView(state, 'v1', entry.id, GOOD).accepted, true);
    assert.equal(recordView(state, 'v1', entry.id, GOOD).accepted, false);
    assert.equal(serveBatch(state, 'v1', 10, seededRng(3)).some((e) => e.id === entry.id), false);
  });

  it('promuove al livello successivo solo dopo la soglia di viste', () => {
    const state = stateWith(1);
    const threshold = DEFAULT_ARENA_CONFIG.tierThresholds[0];
    for (let v = 0; v < threshold; v += 1) {
      const [entry] = serveBatch(state, `v${v}`, 1, seededRng(v));
      recordView(state, `v${v}`, entry.id, GOOD);
      assert.equal(state.entries[0].tier, v + 1 < threshold ? 0 : 1);
    }
  });

  it('parcheggia un contenuto debole', () => {
    const state = stateWith(1);
    for (let v = 0; v < DEFAULT_ARENA_CONFIG.tierThresholds[0]; v += 1) {
      const [entry] = serveBatch(state, `v${v}`, 1, seededRng(v));
      recordView(state, `v${v}`, entry.id, BAD);
    }
    assert.equal(state.entries[0].status, 'parked');
    assert.equal(serveBatch(state, 'nuovo', 5, seededRng(9)).length, 0);
  });

  it('squalifica i contenuti molto segnalati', () => {
    const state = stateWith(1);
    for (let v = 0; v < DEFAULT_ARENA_CONFIG.tierThresholds[0]; v += 1) {
      const [entry] = serveBatch(state, `v${v}`, 1, seededRng(v));
      recordView(state, `v${v}`, entry.id, { ...GOOD, reported: v % 10 === 0 });
    }
    assert.equal(state.entries[0].status, 'disqualified');
    assert.equal(closeArena(state), null);
  });

  it('un vincitore recente non può rivincere', () => {
    const state = stateWith(2);
    for (let v = 0; v < 40; v += 1) {
      for (const entry of serveBatch(state, `v${v}`, 2, seededRng(v))) {
        recordView(state, `v${v}`, entry.id, entry.authorId === 'a0' ? GOOD : { dwellMs: 3500 });
      }
    }
    assert.equal(closeArena(structuredClone(state))?.authorId, 'a0');
    assert.equal(closeArena(state, ['a0'])?.authorId, 'a1');
  });

  it("dopo la chiusura non si serve né si vota più", () => {
    const state = stateWith(2);
    closeArena(state);
    assert.equal(serveBatch(state, 'v', 5).length, 0);
  });
});

describe('date', () => {
  it('usa il fuso orario di gara', () => {
    // 23:30 UTC del 14 ottobre = 01:30 del 15 ottobre a Roma (ora legale).
    assert.equal(arenaDay(new Date('2026-10-14T23:30:00Z'), 'Europe/Rome'), '2026-10-15');
    assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  });

  it('conta bene il tempo alla mezzanotte anche nei giorni del cambio d’ora', () => {
    const h = 3600_000;
    // 29 marzo 2026 alle 00:30 a Roma (23:30 UTC del 28): il giorno dura 23 ore, ne restano 22,5.
    assert.equal(msUntilArenaClose(new Date('2026-03-28T23:30:00Z')), 22.5 * h);
    // 25 ottobre 2026 alle 01:00 a Roma (23:00 UTC del 24): il giorno dura 25 ore, ne restano 24.
    assert.equal(msUntilArenaClose(new Date('2026-10-24T23:00:00Z')), 24 * h);
    // Un giorno normale: alle 18:00 a Roma (16:00 UTC, ora legale) mancano 6 ore.
    assert.equal(msUntilArenaClose(new Date('2026-07-01T16:00:00Z')), 6 * h);
  });

  it('mostra la copertina nuova solo dall’orario di rivelazione', () => {
    const h = 3600_000;
    // Rivelazione alle 20:00 di Roma. Alle 19:00 del 1° luglio (17:00 UTC) si vede ancora quella del 30 giugno.
    assert.equal(coverDay(20 * 60, new Date('2026-07-01T17:00:00Z')), '2026-06-30');
    assert.equal(coverDay(20 * 60, new Date('2026-07-01T18:00:00Z')), '2026-07-01');
    assert.equal(msUntilReveal(20 * 60, new Date('2026-07-01T17:00:00Z')), 1 * h);
    // Dopo la rivelazione si conta fino a quella di domani.
    assert.equal(msUntilReveal(20 * 60, new Date('2026-07-01T18:30:00Z')), 23.5 * h);
    // Rivelazione a mezzanotte: come la chiusura della gara.
    assert.equal(msUntilReveal(0, new Date('2026-07-01T16:00:00Z')), msUntilArenaClose(new Date('2026-07-01T16:00:00Z')));
  });

  it('chiude le candidature alle 20 ora di Roma', () => {
    assert.equal(submissionsOpen(new Date('2026-07-01T17:59:00Z')), true); // 19:59 a Roma
    assert.equal(submissionsOpen(new Date('2026-07-01T18:00:00Z')), false); // 20:00 a Roma
    assert.equal(submissionsOpen(new Date('2026-12-01T18:30:00Z')), true); // 19:30 a Roma (ora solare)
  });
});

describe('simulazione', () => {
  it('su molti giorni vince quasi sempre uno dei contenuti migliori e mai lo spam', () => {
    const ranks: number[] = [];
    for (let seed = 1; seed <= 5; seed += 1) {
      const res = simulateDay({ entries: 200, viewers: 3000, viewsPerViewer: 30, seed });
      assert.equal(res.spamWon, false);
      assert.ok(res.winnerTrueRank !== null);
      ranks.push(res.winnerTrueRank);
    }
    // Il vincitore è nel top 5% in tutti i giorni simulati.
    assert.ok(ranks.every((r) => r <= 10), `posizioni reali dei vincitori: ${ranks.join(', ')}`);
  });
});
