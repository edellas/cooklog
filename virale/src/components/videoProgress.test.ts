import assert from 'node:assert/strict';
import { test } from 'node:test';

import { initialProgress, nextProgress, type ProgressState } from './videoProgress.ts';

const D = 30;
/** Riproduce normalmente da `from` a `to` (secondi), un aggiornamento ogni 0,25 s. */
function play(s: ProgressState, from: number, to: number, clock: { now: number; seekedAt: number | null }): ProgressState {
  let t = from;
  while (t < to - 1e-9) {
    t = Math.min(to, t + 0.25);
    clock.now += 250;
    s = nextProgress(s, { time: t % D, duration: D, seekedAt: clock.seekedAt, now: clock.now });
  }
  return s;
}
function seek(s: ProgressState, to: number, clock: { now: number; seekedAt: number | null }): ProgressState {
  clock.seekedAt = clock.now;
  return nextProgress(s, { time: to, duration: D, seekedAt: clock.seekedAt, now: clock.now });
}

test('trascinare al 95% e aspettare 1,5 s non completa il video', () => {
  const clock = { now: 0, seekedAt: null as number | null };
  let s = play(initialProgress(), 0, 1, clock);
  s = seek(s, D * 0.95, clock);
  s = play(s, D * 0.95, D * 0.95 + 1.5, clock);
  assert.equal(s.completed, false);
  assert.equal(s.loops, 0);
});

test('guardare normalmente il 90% completa il video', () => {
  const clock = { now: 0, seekedAt: null as number | null };
  const s = play(initialProgress(), 0, D * 0.9, clock);
  assert.equal(s.completed, true);
  assert.equal(s.rewatched, false);
});

test('trascinare indietro non conta come rivisto', () => {
  const clock = { now: 0, seekedAt: null as number | null };
  let s = play(initialProgress(), 0, D * 0.97, clock);
  s = seek(s, 0.2, clock);
  s = play(s, 0.2, 5, clock);
  assert.equal(s.loops, 0);
  assert.equal(s.rewatched, false);
});

test('un aggiornamento in ritardo dopo lo spostamento non conta come giro', () => {
  const clock = { now: 0, seekedAt: null as number | null };
  let s = play(initialProgress(), 0, D - 0.3, clock);
  s = seek(s, 0, clock);
  // Arriva in ritardo l'aggiornamento della posizione vecchia, poi quello nuovo.
  clock.now += 100;
  s = nextProgress(s, { time: D - 0.2, duration: D, seekedAt: clock.seekedAt, now: clock.now });
  clock.now += 100;
  s = nextProgress(s, { time: 0.1, duration: D, seekedAt: clock.seekedAt, now: clock.now });
  s = play(s, 0.1, 2, clock);
  assert.equal(s.loops, 0);
});

test('un giro naturale conta: completato, e rivisto dopo una durata intera', () => {
  const clock = { now: 0, seekedAt: null as number | null };
  let s = play(initialProgress(), 0, D + 1, clock);
  assert.equal(s.loops, 1);
  assert.equal(s.completed, true);
  assert.equal(s.rewatched, true);
});

test('watched non cresce durante i salti', () => {
  const clock = { now: 0, seekedAt: null as number | null };
  let s = play(initialProgress(), 0, 5, clock);
  const before = s.watched;
  s = seek(s, 20, clock);
  assert.equal(s.watched, before);
  // Un salto in avanti di più di un secondo, anche senza il segnale dello spostamento, non conta.
  clock.now += 2000;
  s = nextProgress(s, { time: 27, duration: D, seekedAt: clock.seekedAt, now: clock.now });
  assert.equal(s.watched, before);
});

test('saltare alla fine e lasciarlo ripartire non è un giro', () => {
  const clock = { now: 0, seekedAt: null as number | null };
  let s = play(initialProgress(), 0, 3, clock);
  s = seek(s, D - 3, clock);
  s = play(s, D - 3, D + 2, clock);
  assert.equal(s.loops, 0);
  assert.equal(s.completed, false);
});
