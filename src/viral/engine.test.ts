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
  percentile,
  qualityScore,
  recordView,
  seededRng,
  serveBatch,
  shiftDay,
  submitEntry,
  type ArenaState,
} from './engine.ts';
import { simulateDay } from './simulation.ts';

const GOOD = { dwellMs: 8000, liked: true, saved: true };
const BAD = { dwellMs: 500 };

function stateWith(n: number): ArenaState {
  const state = createArenaState('2026-10-14');
  for (let i = 0; i < n; i += 1) {
    submitEntry(state, { id: `e${i}`, postId: `p${i}`, authorId: `a${i}`, createdAt: new Date(i).toISOString() });
  }
  return state;
}

describe('punteggio', () => {
  it('senza viste vale il prior', () => {
    assert.equal(qualityScore(emptyStats()), DEFAULT_ARENA_CONFIG.priorPointsPerView);
  });

  it('classifica completamenti/salvataggi sopra gli skip', () => {
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
  it('un solo piatto per utente al giorno', () => {
    const state = stateWith(1);
    assert.throws(() => submitEntry(state, { id: 'x', postId: 'px', authorId: 'a0' }));
  });

  it("non si vede il proprio piatto e non si vota ciò che non è stato servito", () => {
    const state = stateWith(3);
    const batch = serveBatch(state, 'a0', 10, seededRng(1));
    assert.ok(batch.every((e) => e.authorId !== 'a0'));
    assert.equal(recordView(state, 'intruso', 'e1', GOOD).accepted, false);
  });

  it('una vista per spettatore per piatto', () => {
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

  it('parcheggia un piatto debole', () => {
    const state = stateWith(1);
    for (let v = 0; v < DEFAULT_ARENA_CONFIG.tierThresholds[0]; v += 1) {
      const [entry] = serveBatch(state, `v${v}`, 1, seededRng(v));
      recordView(state, `v${v}`, entry.id, BAD);
    }
    assert.equal(state.entries[0].status, 'parked');
    assert.equal(serveBatch(state, 'nuovo', 5, seededRng(9)).length, 0);
  });

  it('squalifica i piatti molto segnalati', () => {
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
});

describe('simulazione', () => {
  it('su molti giorni vince quasi sempre uno dei piatti migliori e mai lo spam', () => {
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
