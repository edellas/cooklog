import {
  arenaDay,
  closeArena,
  createArenaState,
  DEFAULT_ARENA_CONFIG,
  recordView as engineRecordView,
  seededRng,
  serveBatch,
  shiftDay,
  simulateCrowd,
  submitEntry,
  type ArenaState,
  type EntryStatus,
  type ViewSignal,
} from '../engine/engine';
import type { ArenaCard, DailyViral, Me, MyEntry, NewPost, Post } from '../types';
import { DEMO_POSTS } from './demoContent';
import { getJson, removeKey, setJson } from './storage';
import { isSupabaseConfigured, supabase } from './supabase';

/** Senza Supabase l'app gira in modalità demo: la gara vive sul dispositivo con un pubblico simulato. */
export const isDemo = !isSupabaseConfigured;

export const TIER_THRESHOLDS = DEFAULT_ARENA_CONFIG.tierThresholds;

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

type PostRow = {
  post_id: string;
  author_id: string;
  author_username: string | null;
  author_name: string | null;
  media_type: Post['mediaType'];
  media_url: string | null;
  body: string | null;
  caption: string | null;
  background: string | null;
  created_at: string;
};

function rowToPost(row: PostRow): Post {
  return {
    id: row.post_id,
    authorId: row.author_id,
    authorUsername: row.author_username ?? 'utente',
    authorName: row.author_name ?? 'Utente',
    mediaType: row.media_type,
    mediaUrl: row.media_url,
    body: row.body,
    caption: row.caption ?? '',
    background: row.background ?? '#111111',
    createdAt: row.created_at,
  };
}

function db() {
  if (!supabase) throw new Error('Supabase non configurato.');
  return supabase;
}

async function remoteUserId(): Promise<string | null> {
  const { data } = await db().auth.getSession();
  return data.session?.user.id ?? null;
}

async function uploadMedia(userId: string, input: NewPost): Promise<string> {
  const res = await fetch(input.localUri!);
  const buffer = await res.arrayBuffer();
  const ext = input.mediaType === 'video' ? 'mp4' : 'jpg';
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await db()
    .storage.from('media')
    .upload(path, buffer, { contentType: input.mimeType ?? (input.mediaType === 'video' ? 'video/mp4' : 'image/jpeg') });
  if (error) throw new Error(error.message);
  return db().storage.from('media').getPublicUrl(path).data.publicUrl;
}

// ---------------------------------------------------------------------------
// Demo locale
// ---------------------------------------------------------------------------

const DEMO_KEY = 'virale.demo.v1';
const ENTRIES_PER_DAY = 12;
const LATE_JOINERS_PER_BATCH = 3;

type DemoDb = {
  me: Me | null;
  state: ArenaState;
  posts: Record<string, Post>;
  /** Qualità nascosta di ogni contenuto in gara: guida le reazioni del pubblico simulato. */
  quality: Record<string, number>;
  myPostIds: string[];
  virals: DailyViral[];
  winners: { authorId: string; featuredOn: string }[];
};

function hash(text: string): number {
  return text.split('').reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
}

/** Una giornata di gara demo: i creator fittizi candidano un post e un pubblico simulato inizia a guardare. */
function seedDay(day: string, demo: DemoDb, seedKey: string = day): ArenaState {
  const rng = seededRng(hash(seedKey));
  const state = createArenaState(day);
  const start = hash(seedKey) % DEMO_POSTS.length;
  for (let i = 0; i < ENTRIES_PER_DAY; i += 1) {
    const post = DEMO_POSTS[(start + i) % DEMO_POSTS.length];
    demo.posts[post.id] = post;
    const entryId = `entry-${day}-${post.id}`;
    submitEntry(state, {
      id: entryId,
      postId: post.id,
      authorId: post.authorId,
      createdAt: new Date(Date.parse(`${day}T06:00:00Z`) + i * 60000).toISOString(),
    });
    demo.quality[entryId] = rng() ** 1.3;
  }
  simulateCrowd(
    state,
    { quality: (id) => demo.quality[id] ?? 0.3, viewers: 70, viewsPerViewer: 8, viewerPrefix: `crowd-${day}-`, forgetViewers: true },
    rng,
  );
  return state;
}

/** Durante la giornata arrivano nuovi creator in gara (finché ce ne sono nel pool demo). */
function lateJoin(demo: DemoDb): boolean {
  const used = new Set(demo.state.entries.map((e) => e.postId));
  const fresh = DEMO_POSTS.filter((p) => !used.has(p.id)).slice(0, LATE_JOINERS_PER_BATCH);
  const rng = seededRng((Date.now() ^ 0x9e3779b9) >>> 0);
  for (const post of fresh) {
    const entryId = `entry-${demo.state.day}-${post.id}`;
    demo.posts[post.id] = post;
    submitEntry(demo.state, { id: entryId, postId: post.id, authorId: post.authorId });
    demo.quality[entryId] = rng() ** 1.3;
  }
  return fresh.length > 0;
}

/** Il pubblico simulato continua a guardare mentre usi l'app: i contenuti (anche il tuo) salgono di livello dal vivo. */
function crowdTick(demo: DemoDb, viewers: number): void {
  const rng = seededRng((Date.now() ^ hash(demo.state.day)) >>> 0);
  simulateCrowd(
    demo.state,
    { quality: (id) => demo.quality[id] ?? 0.3, viewers, viewsPerViewer: 4, viewerPrefix: `crowd-live-${Date.now()}-`, forgetViewers: true },
    rng,
  );
}

function closeDemoDay(demo: DemoDb): DailyViral | null {
  const { state } = demo;
  const featuredOn = shiftDay(state.day, 1);
  const cooldownStart = shiftDay(featuredOn, -DEFAULT_ARENA_CONFIG.winnerCooldownDays);
  const recent = demo.winners.filter((w) => w.featuredOn > cooldownStart).map((w) => w.authorId);
  const winner = closeArena(state, recent);
  if (!winner || demo.virals.some((v) => v.featuredOn === featuredOn)) return null;
  const post = demo.posts[winner.postId];
  if (!post) return null;
  const viral: DailyViral = {
    featuredOn,
    contestDay: state.day,
    totalEntries: state.entries.length,
    totalViews: state.entries.reduce((sum, e) => sum + e.stats.views, 0),
    post,
  };
  demo.virals = [viral, ...demo.virals].slice(0, 60);
  demo.winners = [{ authorId: winner.authorId, featuredOn }, ...demo.winners].slice(0, 120);
  return viral;
}

async function loadDemo(): Promise<DemoDb> {
  const today = arenaDay();
  let demo = await getJson<DemoDb | null>(DEMO_KEY, null);
  if (!demo) demo = { me: null, state: createArenaState(''), posts: {}, quality: {}, myPostIds: [], virals: [], winners: [] };
  demo.quality ??= {};
  if (demo.state.day !== today) {
    if (demo.state.day) closeDemoDay(demo);
    if (!demo.virals.some((v) => v.featuredOn === today)) {
      // Primo avvio (o app non aperta ieri): il pubblico simulato ha giocato la gara di ieri.
      demo.state = seedDay(shiftDay(today, -1), demo);
      closeDemoDay(demo);
    }
    demo.quality = {};
    demo.state = seedDay(today, demo);
    await setJson(DEMO_KEY, demo);
  }
  return demo;
}

// Operazioni read-modify-write serializzate (es. una vista registrata mentre arriva il batch successivo).
let queue: Promise<unknown> = Promise.resolve();
function withDemo<T>(fn: (demo: DemoDb) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => fn(await loadDemo()));
  queue = run.catch(() => undefined);
  return run;
}
const saveDemo = (demo: DemoDb) => setJson(DEMO_KEY, demo);

// ---------------------------------------------------------------------------
// API usata dalle schermate
// ---------------------------------------------------------------------------

export async function getMe(): Promise<Me | null> {
  if (!isDemo) {
    const uid = await remoteUserId();
    if (!uid) return null;
    const { data } = await db().from('profiles').select('id, username, display_name').eq('id', uid).maybeSingle();
    return data ? { id: data.id, username: data.username, displayName: data.display_name } : null;
  }
  return withDemo((demo) => demo.me);
}

export async function createAccount(username: string, displayName: string): Promise<Me> {
  const clean = username.trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9_.]{3,24}$/.test(clean)) {
    throw new Error('Username: 3-24 caratteri tra lettere minuscole, numeri, punto e trattino basso.');
  }
  const name = displayName.trim() || clean;
  if (!isDemo) {
    let uid = await remoteUserId();
    if (!uid) {
      const { data, error } = await db().auth.signInAnonymously();
      if (error) throw new Error(error.message);
      uid = data.user!.id;
    }
    const { error } = await db().from('profiles').insert({ id: uid, username: clean, display_name: name });
    if (error) throw new Error(error.code === '23505' ? 'Username già preso.' : error.message);
    return { id: uid, username: clean, displayName: name };
  }
  return withDemo(async (demo) => {
    if (DEMO_POSTS.some((p) => p.authorUsername === clean)) throw new Error('Username già preso.');
    demo.me = { id: `me-${clean}`, username: clean, displayName: name };
    await saveDemo(demo);
    return demo.me;
  });
}

export async function getDailyViral(): Promise<DailyViral | null> {
  if (!isDemo) {
    const { data, error } = await db().rpc('get_daily_viral');
    if (error) throw new Error(error.message);
    const row = (data as (PostRow & { featured_on: string; contest_day: string; total_entries: number; total_views: number })[])?.[0];
    return row
      ? { featuredOn: row.featured_on, contestDay: row.contest_day, totalEntries: row.total_entries, totalViews: Number(row.total_views), post: rowToPost(row) }
      : null;
  }
  return withDemo((demo) => demo.virals.find((v) => v.featuredOn === arenaDay()) ?? null);
}

export async function getHallOfFame(): Promise<DailyViral[]> {
  if (!isDemo) {
    const { data, error } = await db().rpc('get_hall_of_fame', { p_limit: 30 });
    if (error) throw new Error(error.message);
    return ((data ?? []) as (PostRow & { featured_on: string; total_entries: number; total_views: number })[]).map((row) => ({
      featuredOn: row.featured_on,
      contestDay: shiftDay(row.featured_on, -1),
      totalEntries: row.total_entries,
      totalViews: Number(row.total_views),
      post: rowToPost(row),
    }));
  }
  return withDemo((demo) => demo.virals.filter((v) => v.featuredOn <= arenaDay()));
}

export async function getArenaBatch(limit = 8): Promise<ArenaCard[]> {
  if (!isDemo) {
    const { data, error } = await db().rpc('arena_next_batch', { p_limit: limit });
    if (error) throw new Error(error.message);
    return ((data ?? []) as (PostRow & { entry_id: string; tier: number })[]).map((row) => ({
      entryId: row.entry_id,
      tier: row.tier,
      post: rowToPost(row),
    }));
  }
  return withDemo(async (demo) => {
    if (!demo.me) return [];
    crowdTick(demo, 12);
    let batch = serveBatch(demo.state, demo.me.id, limit);
    if (batch.length < limit && lateJoin(demo)) batch = [...batch, ...serveBatch(demo.state, demo.me.id, limit - batch.length)];
    await saveDemo(demo);
    return batch.flatMap((e) => (demo.posts[e.postId] ? [{ entryId: e.id, tier: e.tier, post: demo.posts[e.postId] }] : []));
  });
}

export async function recordView(entryId: string, signal: ViewSignal): Promise<boolean> {
  if (!isDemo) {
    const { data, error } = await db().rpc('arena_record_view', {
      p_entry_id: entryId,
      p_dwell_ms: Math.round(signal.dwellMs),
      p_completed: signal.completed ?? null,
      p_rewatched: Boolean(signal.rewatched),
      p_liked: Boolean(signal.liked),
      p_saved: Boolean(signal.saved),
      p_shared: Boolean(signal.shared),
      p_reported: Boolean(signal.reported),
    });
    if (error) throw new Error(error.message);
    return Boolean(data);
  }
  return withDemo(async (demo) => {
    if (!demo.me) return false;
    const { accepted } = engineRecordView(demo.state, demo.me.id, entryId, signal);
    if (accepted) {
      crowdTick(demo, 3);
      await saveDemo(demo);
    }
    return accepted;
  });
}

export async function publish(input: NewPost): Promise<Post> {
  if (input.mediaType === 'text' && !input.body?.trim()) throw new Error('Scrivi qualcosa.');
  if (input.mediaType !== 'text' && !input.localUri) throw new Error('Scegli un file.');

  if (!isDemo) {
    const uid = await remoteUserId();
    if (!uid) throw new Error('Sessione scaduta.');
    const mediaUrl = input.mediaType === 'text' ? null : await uploadMedia(uid, input);
    const { data, error } = await db()
      .from('posts')
      .insert({
        author_id: uid,
        media_type: input.mediaType,
        media_url: mediaUrl,
        body: input.mediaType === 'text' ? input.body!.trim() : null,
        caption: input.caption.trim(),
        background: input.background,
      })
      .select('id, created_at')
      .single();
    if (error) throw new Error(error.message);
    if (input.joinArena) {
      const { error: submitError } = await db().rpc('arena_submit', { p_post_id: data.id });
      if (submitError) throw new Error(`Pubblicato, ma non in gara: ${submitError.message}`);
    }
    const me = await getMe();
    return {
      id: data.id,
      authorId: uid,
      authorUsername: me?.username ?? 'tu',
      authorName: me?.displayName ?? 'Tu',
      mediaType: input.mediaType,
      mediaUrl,
      body: input.body ?? null,
      caption: input.caption,
      background: input.background,
      createdAt: data.created_at,
    };
  }

  return withDemo(async (demo) => {
    if (!demo.me) throw new Error('Crea prima il tuo profilo.');
    const post: Post = {
      id: `my-post-${Date.now()}`,
      authorId: demo.me.id,
      authorUsername: demo.me.username,
      authorName: demo.me.displayName,
      mediaType: input.mediaType,
      mediaUrl: input.localUri ?? null,
      body: input.mediaType === 'text' ? input.body!.trim() : null,
      caption: input.caption.trim(),
      background: input.background,
      createdAt: new Date().toISOString(),
    };
    if (input.joinArena) {
      const blocked = demo.winners.some(
        (w) => w.authorId === demo.me!.id && w.featuredOn > shiftDay(arenaDay(), -DEFAULT_ARENA_CONFIG.winnerCooldownDays),
      );
      if (blocked) throw new Error('Hai vinto di recente: potrai ripartecipare tra qualche giorno.');
      const entryId = `entry-${demo.state.day}-${post.id}`;
      submitEntry(demo.state, { id: entryId, postId: post.id, authorId: demo.me.id });
      // Il tuo contenuto ha una qualità nascosta estratta come quella di tutti gli altri: nessun favoritismo.
      demo.quality[entryId] = Math.random() ** 1.3;
    }
    demo.posts[post.id] = post;
    demo.myPostIds = [post.id, ...demo.myPostIds];
    await saveDemo(demo);
    return post;
  });
}

export async function getMyEntry(): Promise<MyEntry | null> {
  if (!isDemo) {
    const { data, error } = await db().rpc('arena_my_entry');
    if (error) throw new Error(error.message);
    const row = (data as { entry_id: string; post_id: string; tier: number; status: EntryStatus; views: number; contest_day: string }[])?.[0];
    return row
      ? { entryId: row.entry_id, postId: row.post_id, tier: row.tier, status: row.status, views: row.views, contestDay: row.contest_day }
      : null;
  }
  return withDemo((demo) => {
    const entry = demo.me ? demo.state.entries.find((e) => e.authorId === demo.me!.id) : undefined;
    return entry
      ? { entryId: entry.id, postId: entry.postId, tier: entry.tier, status: entry.status, views: entry.stats.views, contestDay: entry.contestDay }
      : null;
  });
}

export async function getMyPosts(): Promise<{ posts: Post[]; wins: DailyViral[] }> {
  if (!isDemo) {
    const uid = await remoteUserId();
    if (!uid) return { posts: [], wins: [] };
    const me = await getMe();
    const { data, error } = await db()
      .from('posts')
      .select('id, author_id, media_type, media_url, body, caption, background, created_at')
      .eq('author_id', uid)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const posts = (data ?? []).map((row) =>
      rowToPost({ ...row, post_id: row.id, author_username: me?.username ?? null, author_name: me?.displayName ?? null }),
    );
    const wins = (await getHallOfFame()).filter((v) => v.post.authorId === uid);
    return { posts, wins };
  }
  return withDemo((demo) => ({
    posts: demo.myPostIds.map((id) => demo.posts[id]).filter(Boolean),
    wins: demo.virals.filter((v) => v.post.authorId === demo.me?.id),
  }));
}

/**
 * Solo demo: fa passare altro pubblico simulato, chiude la gara e mette subito in evidenza il vincitore.
 * In produzione lo fa pg_cron a mezzanotte e il vincitore appare il giorno dopo.
 */
export async function closeDayNowDemo(): Promise<DailyViral | null> {
  if (!isDemo) throw new Error('Disponibile solo in modalità demo.');
  return withDemo(async (demo) => {
    const rng = seededRng(Date.now() >>> 0);
    simulateCrowd(
      demo.state,
      { quality: (id) => demo.quality[id] ?? 0.3, viewers: 150, viewsPerViewer: 8, viewerPrefix: `crowd-close-${Date.now()}-`, forgetViewers: true },
      rng,
    );
    const viral = closeDemoDay(demo);
    const today = arenaDay();
    if (viral) {
      viral.featuredOn = today;
      // Il nuovo vincitore va in cima; il precedente resta nell'albo d'oro.
      demo.virals = [viral, ...demo.virals.filter((v) => v !== viral)];
      demo.winners = demo.winners.map((w) => (w.featuredOn === shiftDay(demo.state.day, 1) && w.authorId === viral.post.authorId ? { ...w, featuredOn: today } : w));
    }
    // Riparte una nuova gara con altri contenuti.
    demo.quality = {};
    demo.state = seedDay(today, demo, `${today}-${Date.now()}`);
    demo.state.entries.forEach((e) => (e.id = `${e.id}-r${Date.now()}`));
    await saveDemo(demo);
    return viral;
  });
}

export async function resetDemo(): Promise<void> {
  await removeKey(DEMO_KEY);
}
