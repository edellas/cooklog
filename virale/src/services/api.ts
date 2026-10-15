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
  submissionsOpen,
  type ArenaState,
  type EntryStatus,
  type ViewSignal,
} from '../engine/engine';
import { COMMENTERS, CREATORS, DEMO_FOLLOWING, LAUNCH_DAY, PAST_COVERS, SEED_POSTS, TODAY_COVER } from '../data/seed';
import type { Author, Comment, Cover, FeedCard, Me, MediaItem, MyEntry, NewPost, Post, Profile } from '../types';
import { Platform } from 'react-native';

import { getJson, removeKey, setJson } from './storage';
import { isSupabaseConfigured, supabase } from './supabase';

/** Senza Supabase l'app gira in demo: tutto resta sul dispositivo, con un pubblico simulato. */
export const isDemo = !isSupabaseConfigured;

export const TIERS = DEFAULT_ARENA_CONFIG.tierThresholds;

/** Nomi dei livelli: il percorso di un provino fino alla copertina. */
export const TIER_NAMES = ['Provino', 'Bozza', 'Impaginato', 'In macchina', 'Finale'] as const;

/**
 * Le candidature chiudono alle 20 (ora di Roma). In demo restano aperte, perché la mezzanotte
 * si può simulare in qualsiasi momento.
 */
export function contestOpen(now = new Date()): boolean {
  return isDemo || submissionsOpen(now);
}

export function issueNumber(day: string): number {
  return Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${LAUNCH_DAY}T12:00:00Z`)) / 86400000) + 1;
}

// ===========================================================================
// Supabase (produzione): le RPC restituiscono post già composti in JSON.
// ===========================================================================

type PostJson = {
  id: string;
  author: { id: string; username: string; display_name: string };
  media: { kind: 'image' | 'video'; url: string; width: number; height: number; duration_ms?: number }[];
  caption: string;
  created_at: string;
  like_count: number;
  comment_count: number;
  save_count: number;
  share_count: number;
  liked: boolean;
  saved: boolean;
  following?: boolean;
  contest?: { entry_id: string; tier: number; status: EntryStatus } | null;
};

function fromJson(p: PostJson): Post {
  return {
    id: p.id,
    author: { id: p.author.id, username: p.author.username, displayName: p.author.display_name },
    media: p.media.map((m) => ({ kind: m.kind, src: m.url, width: m.width, height: m.height, durationMs: m.duration_ms })),
    caption: p.caption,
    createdAt: p.created_at,
    likeCount: p.like_count,
    commentCount: p.comment_count,
    saveCount: p.save_count,
    shareCount: p.share_count,
    likedByMe: p.liked,
    savedByMe: p.saved,
    followingAuthor: Boolean(p.following),
    contest: p.contest ? { entryId: p.contest.entry_id, tier: p.contest.tier, status: p.contest.status } : undefined,
  };
}

function db() {
  if (!supabase) throw new Error('Supabase non configurato.');
  return supabase;
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Le scritture sullo stesso oggetto (mi piace, salva, segui) partono in ordine: un tocco rapido non arriva prima del precedente. */
const lanes = new Map<string, Promise<unknown>>();
function inOrder<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (lanes.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
  lanes.set(key, run);
  void run.finally(() => {
    if (lanes.get(key) === run) lanes.delete(key);
  }).catch(() => undefined);
  return run;
}

async function uid(): Promise<string> {
  const { data } = await db().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Sessione scaduta: riapri l’app.');
  return id;
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

/** Percorso nel bucket "media" a partire dall'URL pubblico di un file. */
function storagePath(url: string): string | null {
  const marker = '/object/public/media/';
  const i = url.indexOf(marker);
  return i >= 0 ? decodeURIComponent(url.slice(i + marker.length).split('?')[0]) : null;
}

async function upload(userId: string, item: NewPost['media'][number], index: number): Promise<MediaItem> {
  const buffer = await (await fetch(item.uri)).arrayBuffer();
  const contentType = item.mimeType ?? (item.kind === 'video' ? 'video/mp4' : 'image/jpeg');
  const path = `${userId}/${Date.now()}-${index}.${EXT[contentType] ?? (item.kind === 'video' ? 'mp4' : 'jpg')}`;
  const { error } = await db().storage.from('media').upload(path, buffer, { contentType });
  if (error) throw new Error(error.message);
  const url = db().storage.from('media').getPublicUrl(path).data.publicUrl;
  return { kind: item.kind, src: url, width: Math.round(item.width), height: Math.round(item.height), durationMs: item.durationMs != null ? Math.round(item.durationMs) : undefined };
}

// ===========================================================================
// Demo locale
// ===========================================================================

const KEY = 'virale.demo.v2';

type StoredPost = {
  id: string;
  authorId: string;
  media: MediaItem[];
  caption: string;
  createdAt: string;
  likes: number;
  saves: number;
  shares: number;
};

type StoredComment = { id: string; authorId: string; body: string; createdAt: string };

type DemoDb = {
  me: Me | null;
  myBio: string;
  people: Record<string, Author & { bio: string; followers: number; following: number }>;
  posts: Record<string, StoredPost>;
  comments: Record<string, StoredComment[]>;
  likes: string[];
  saves: string[];
  following: string[];
  myPostIds: string[];
  covers: { featuredOn: string; postId: string; totalEntries: number; totalViews: number }[];
  state: ArenaState;
  quality: Record<string, number>;
  /** Persone bloccate da me: non vedo più i loro post e commenti. */
  blocked: string[];
  /** Post che ho condiviso: una condivisione conta una volta sola. */
  shared?: string[];
  /** Post che ho segnalato: spariscono subito dal mio feed. */
  reported: { postId: string; reason: ReportReason; at: string }[];
};

function hash(text: string): number {
  let h = 7;
  for (const ch of text) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return h;
}

function freshDb(): DemoDb {
  const now = Date.now();
  const today = arenaDay();
  const people: DemoDb['people'] = {};
  for (const cr of CREATORS) people[cr.id] = { ...cr };
  for (const name of COMMENTERS) people[`demo-${name}`] = { id: `demo-${name}`, username: name, displayName: name, bio: '', followers: 120, following: 300 };
  const posts: DemoDb['posts'] = {};
  const comments: DemoDb['comments'] = {};
  for (const sp of SEED_POSTS) {
    const authorId = `demo-${sp.username}`;
    posts[sp.id] = {
      id: sp.id,
      authorId,
      media: sp.media,
      caption: sp.caption,
      createdAt: new Date(now - sp.age * 3600_000).toISOString(),
      likes: sp.likes,
      saves: sp.saves,
      shares: sp.shares,
    };
    comments[sp.id] = sp.comments.map((body, i) => ({
      id: `${sp.id}-c${i}`,
      authorId: `demo-${COMMENTERS[(hash(sp.id) + i) % COMMENTERS.length]}`,
      body,
      createdAt: new Date(now - (sp.age * 3600_000) / (i + 2)).toISOString(),
    }));
  }
  const covers = [
    { featuredOn: today, postId: TODAY_COVER.postId, totalEntries: TODAY_COVER.totalEntries, totalViews: TODAY_COVER.totalViews },
    ...PAST_COVERS.map((pc) => ({ featuredOn: shiftDay(today, -pc.daysAgo), postId: pc.postId, totalEntries: pc.totalEntries, totalViews: pc.totalViews })),
  ];
  return {
    me: null,
    myBio: '',
    people,
    posts,
    comments,
    likes: [],
    saves: [],
    following: DEMO_FOLLOWING.map((u) => `demo-${u}`),
    myPostIds: [],
    covers,
    state: createArenaState(''),
    quality: {},
    blocked: [],
    reported: [],
  };
}

/** Cosa può vedere l'utente demo: niente post bloccati o segnalati. */
function visible(demo: DemoDb, postId: string): boolean {
  const p = demo.posts[postId];
  return Boolean(p) && !demo.blocked.includes(p.authorId) && !demo.reported.some((r) => r.postId === postId);
}

/**
 * In demo i creator sono pochi: con i 30 giorni di pausa reali dopo poche "mezzanotti simulate"
 * non resterebbe nessuno in gara. La pausa demo è quindi di 5 giorni.
 */
const DEMO_COOLDOWN_DAYS = 5;

function recentWinners(demo: DemoDb, day: string): string[] {
  const from = shiftDay(day, -DEMO_COOLDOWN_DAYS);
  return demo.covers.filter((cv) => cv.featuredOn > from).map((cv) => demo.posts[cv.postId]?.authorId).filter(Boolean) as string[];
}

/** Una giornata di gara: i post dei creator non in pausa entrano nei Provini e il pubblico simulato inizia a guardare. */
function seedDay(demo: DemoDb, day: string, seedKey = day): ArenaState {
  const rng = seededRng(hash(seedKey));
  const state = createArenaState(day);
  const blocked = new Set(recentWinners(demo, shiftDay(day, 1)));
  demo.quality = {};
  let i = 0;
  for (const post of Object.values(demo.posts)) {
    // Un solo post in gara per persona; il tuo lo candidi tu.
    if (blocked.has(post.authorId) || post.authorId === demo.me?.id || state.entries.some((e) => e.authorId === post.authorId)) continue;
    const entryId = `e-${day}-${post.id}-${hash(seedKey) % 997}`;
    submitEntry(state, { id: entryId, postId: post.id, authorId: post.authorId, createdAt: new Date(Date.parse(`${day}T06:00:00Z`) + i++ * 60000).toISOString() });
    demo.quality[entryId] = rng() ** 1.3;
  }
  simulateCrowd(state, { quality: (id) => demo.quality[id] ?? 0.3, viewers: 80, viewsPerViewer: 7, viewerPrefix: `crowd-${seedKey}-`, forgetViewers: true }, rng);
  return state;
}

/** Il pubblico simulato continua a guardare mentre usi l'app: i post (anche il tuo) salgono di livello dal vivo. */
function crowdTick(demo: DemoDb, viewers: number) {
  const rng = seededRng((Date.now() ^ hash(demo.state.day)) >>> 0);
  simulateCrowd(demo.state, { quality: (id) => demo.quality[id] ?? 0.3, viewers, viewsPerViewer: 4, viewerPrefix: `crowd-live-${Date.now()}-`, forgetViewers: true }, rng);
}

/** Chiude la gara: il vincitore diventa la copertina del giorno indicato. */
function crown(demo: DemoDb, featuredOn: string): string | null {
  // Se tutti i migliori sono in pausa, vince comunque il migliore: in demo la copertina non resta mai vuota.
  const winner = closeArena(demo.state, recentWinners(demo, featuredOn)) ?? closeArena(demo.state);
  if (!winner) return null;
  demo.covers = [
    {
      featuredOn,
      postId: winner.postId,
      totalEntries: 9000 + demo.state.entries.length * 230 + (hash(featuredOn) % 900),
      totalViews: demo.state.entries.reduce((s, e) => s + e.stats.views, 0) * 1180 + (hash(featuredOn) % 50000),
    },
    ...demo.covers.filter((cv) => cv.featuredOn !== featuredOn),
  ].slice(0, 60);
  return winner.postId;
}

async function load(): Promise<DemoDb> {
  const today = arenaDay();
  let demo = await getJson<DemoDb | null>(KEY, null);
  if (!demo) demo = freshDb();
  demo.blocked ??= [];
  demo.reported ??= [];
  if (demo.state.day !== today) {
    // Recupera i giorni passati senza aprire l'app: ogni giornata ha la sua gara e la sua copertina.
    let day = demo.state.day;
    for (let guard = 0; day && day < today && guard < 60; guard += 1) {
      const next = shiftDay(day, 1);
      if (!demo.covers.some((cv) => cv.featuredOn === next)) crown(demo, next);
      if (next < today) demo.state = seedDay(demo, next);
      day = next;
    }
    demo.state = seedDay(demo, today);
    await setJson(KEY, demo);
  }
  return demo;
}

let queue: Promise<unknown> = Promise.resolve();
/** Operazioni read-modify-write serializzate: una vista registrata mentre arriva il batch successivo non si perde. */
function withDemo<T>(fn: (demo: DemoDb) => T | Promise<T>, save = false): Promise<T> {
  const run = queue.then(async () => {
    const demo = await load();
    const out = await fn(demo);
    if (save) await setJson(KEY, demo);
    return out;
  });
  queue = run.catch(() => undefined);
  return run;
}

function stored(demo: DemoDb, postId: string): StoredPost {
  const p = demo.posts[postId];
  if (!p || !visible(demo, postId)) throw new Error('Questo post non è più disponibile.');
  return p;
}

function author(demo: DemoDb, id: string): Author {
  const p = demo.people[id];
  return p ? { id: p.id, username: p.username, displayName: p.displayName } : { id, username: 'utente', displayName: 'Utente' };
}

function toPost(demo: DemoDb, id: string): Post {
  const sp = demo.posts[id];
  if (!sp) throw new Error('Questo post non è più disponibile.');
  const entry = demo.state.entries.find((e) => e.postId === id);
  const liked = demo.likes.includes(id);
  const saved = demo.saves.includes(id);
  return {
    id,
    author: author(demo, sp.authorId),
    media: sp.media,
    caption: sp.caption,
    createdAt: sp.createdAt,
    likeCount: sp.likes,
    commentCount: demo.comments[id]?.length ?? 0,
    saveCount: sp.saves,
    shareCount: sp.shares,
    likedByMe: liked,
    savedByMe: saved,
    followingAuthor: demo.following.includes(sp.authorId),
    contest: entry ? { entryId: entry.id, tier: entry.tier, status: entry.status } : undefined,
  };
}

function toCover(demo: DemoDb, cv: DemoDb['covers'][number]): Cover {
  return { featuredOn: cv.featuredOn, issue: issueNumber(cv.featuredOn), totalEntries: cv.totalEntries, totalViews: cv.totalViews, post: toPost(demo, cv.postId) };
}

// ===========================================================================
// API usata dalle schermate
// ===========================================================================

export async function getMe(): Promise<Me | null> {
  if (!isDemo) {
    // Un errore di rete NON significa "nessun account": lo si segnala, così l'app propone di riprovare.
    const { data, error } = await db().auth.getSession();
    if (error) throw new Error(error.message);
    const id = data.session?.user.id;
    if (!id) return null;
    const { data: row, error: e2 } = await db().from('profiles').select('id, username, display_name').eq('id', id).maybeSingle();
    if (e2) throw new Error(e2.message);
    return row ? { id: row.id, username: row.username, displayName: row.display_name } : null;
  }
  return withDemo((demo) => demo.me);
}

export async function createAccount(username: string, displayName: string, acceptedTerms: boolean): Promise<Me> {
  if (!acceptedTerms) throw new Error('Per entrare devi accettare termini e linee guida e confermare di avere almeno 14 anni.');
  const clean = username.trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9_.]{3,24}$/.test(clean)) throw new Error('Da 3 a 24 caratteri: lettere minuscole, numeri, punto e trattino basso.');
  const name = displayName.trim() || clean;
  if (!isDemo) {
    let id: string | null = (await db().auth.getSession()).data.session?.user.id ?? null;
    if (!id) {
      const { data, error } = await db().auth.signInAnonymously();
      if (error) throw new Error(error.message);
      id = data.user!.id;
    }
    const { error } = await db().from('profiles').insert({ id, username: clean, display_name: name, terms_accepted_at: new Date().toISOString() });
    if (error?.code === '23505' && /profiles_pkey/.test(error.message)) {
      // Il profilo esiste già (per esempio creato prima di una caduta di rete): si entra con quello.
      const existing = await getMe();
      if (existing) return existing;
    }
    if (error) throw new Error(error.code === '23505' ? 'Questo nome è già preso. Prova ad aggiungere un numero.' : error.message);
    return { id, username: clean, displayName: name };
  }
  return withDemo((demo) => {
    if (Object.values(demo.people).some((p) => p.username === clean)) throw new Error('Questo nome è già preso. Prova ad aggiungere un numero.');
    const me = { id: `me-${clean}`, username: clean, displayName: name };
    demo.me = me;
    demo.people[me.id] = { ...me, bio: '', followers: 0, following: demo.following.length };
    return me;
  }, true);
}

/** La copertina di oggi: identica per tutti. */
export async function getTodayCover(): Promise<Cover | null> {
  if (!isDemo) {
    const row = await rpc<{ featured_on: string; total_entries: number; total_views: number; post: PostJson } | null>('get_today_cover');
    return row ? { featuredOn: row.featured_on, issue: issueNumber(row.featured_on), totalEntries: row.total_entries, totalViews: Number(row.total_views), post: fromJson(row.post) } : null;
  }
  return withDemo((demo) => {
    const cv = demo.covers.find((x) => x.featuredOn === arenaDay() && visible(demo, x.postId));
    return cv ? toCover(demo, cv) : null;
  });
}

export async function getArchive(): Promise<Cover[]> {
  if (!isDemo) {
    const rows = await rpc<{ featured_on: string; total_entries: number; total_views: number; post: PostJson }[]>('get_cover_archive', { p_limit: 60 });
    return rows.map((r) => ({ featuredOn: r.featured_on, issue: issueNumber(r.featured_on), totalEntries: r.total_entries, totalViews: Number(r.total_views), post: fromJson(r.post) }));
  }
  return withDemo((demo) => demo.covers.filter((cv) => cv.featuredOn <= arenaDay() && visible(demo, cv.postId)).map((cv) => toCover(demo, cv)));
}

/**
 * Feed "Per te": prima i Provini (post in gara oggi, scelti dal server alla cieca),
 * poi i post recenti fuori gara così il feed non finisce mai.
 */
export async function getForYou(limit = 6, excludeIds: string[] = []): Promise<FeedCard[]> {
  if (!isDemo) {
    const rows = await rpc<{ entry_id: string | null; post: PostJson }[]>('feed_for_you', { p_limit: limit, p_exclude: excludeIds });
    return rows.map((r) => ({ ...fromJson(r.post), entryId: r.entry_id ?? undefined }));
  }
  return withDemo((demo) => {
    if (!demo.me) return [];
    crowdTick(demo, 10);
    const batch = serveBatch(demo.state, demo.me.id, limit);
    const cards: FeedCard[] = batch.filter((e) => visible(demo, e.postId)).map((e) => ({ ...toPost(demo, e.postId), entryId: e.id }));
    if (cards.length < limit) {
      const taken = new Set([...excludeIds, ...cards.map((x) => x.id)]);
      const rest = Object.values(demo.posts)
        .filter((p) => !taken.has(p.id) && p.authorId !== demo.me!.id && visible(demo, p.id))
        .sort((a, b) => b.likes - a.likes)
        .slice(0, limit - cards.length);
      cards.push(...rest.map((p) => toPost(demo, p.id)));
    }
    return cards;
  }, true);
}

/** Feed "Seguiti": i post di chi segui, dal più recente. */
export async function getFollowing(): Promise<Post[]> {
  if (!isDemo) {
    const rows = await rpc<PostJson[]>('feed_following', { p_limit: 30 });
    return rows.map(fromJson);
  }
  return withDemo((demo) =>
    Object.values(demo.posts)
      .filter((p) => demo.following.includes(p.authorId) && visible(demo, p.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => toPost(demo, p.id)),
  );
}

/** Registra una vista dei Provini con i segnali raccolti (tempo, completamento, interazioni). */
export async function recordView(entryId: string, signal: ViewSignal): Promise<boolean> {
  if (!isDemo) {
    return rpc<boolean>('arena_record_view', {
      p_entry_id: entryId,
      p_dwell_ms: Math.round(signal.dwellMs),
      p_completed: signal.completed ?? null,
      p_rewatched: Boolean(signal.rewatched),
      p_liked: Boolean(signal.liked),
      p_commented: Boolean(signal.commented),
      p_saved: Boolean(signal.saved),
      p_shared: Boolean(signal.shared),
      p_reported: Boolean(signal.reported),
    });
  }
  return withDemo((demo) => {
    if (!demo.me) return false;
    const { accepted } = engineRecordView(demo.state, demo.me.id, entryId, signal);
    if (accepted) crowdTick(demo, 3);
    return accepted;
  }, true);
}

export async function toggleLike(postId: string, on: boolean): Promise<void> {
  if (!isDemo) {
    return inOrder(`like:${postId}`, async () => {
      const me = await uid();
      const q = on ? db().from('post_likes').insert({ post_id: postId, user_id: me }) : db().from('post_likes').delete().match({ post_id: postId, user_id: me });
      const { error } = await q;
      if (error && error.code !== '23505') throw new Error(error.message);
    });
  }
  await withDemo((demo) => {
    const p = stored(demo, postId);
    const has = demo.likes.includes(postId);
    if (on && !has) {
      demo.likes.push(postId);
      p.likes += 1;
    } else if (!on && has) {
      demo.likes = demo.likes.filter((x) => x !== postId);
      p.likes = Math.max(0, p.likes - 1);
    }
  }, true);
}

export async function toggleSave(postId: string, on: boolean): Promise<void> {
  if (!isDemo) {
    return inOrder(`save:${postId}`, async () => {
      const me = await uid();
      const q = on ? db().from('post_saves').insert({ post_id: postId, user_id: me }) : db().from('post_saves').delete().match({ post_id: postId, user_id: me });
      const { error } = await q;
      if (error && error.code !== '23505') throw new Error(error.message);
    });
  }
  await withDemo((demo) => {
    const p = stored(demo, postId);
    const has = demo.saves.includes(postId);
    if (on && !has) {
      demo.saves.push(postId);
      p.saves += 1;
    } else if (!on && has) {
      demo.saves = demo.saves.filter((x) => x !== postId);
      p.saves = Math.max(0, p.saves - 1);
    }
  }, true);
}

/** Registra una condivisione. Conta una volta per persona e post, come sul server. */
export async function registerShare(postId: string): Promise<void> {
  if (!isDemo) {
    await rpc('register_share', { p_post_id: postId });
    return;
  }
  await withDemo((demo) => {
    const p = stored(demo, postId);
    demo.shared ??= [];
    if (demo.shared.includes(postId)) return;
    demo.shared.push(postId);
    p.shares += 1;
  }, true);
}

export async function getComments(postId: string): Promise<Comment[]> {
  if (!isDemo) {
    const rows = await rpc<{ id: string; post_id: string; body: string; created_at: string; author: { id: string; username: string; display_name: string } }[]>('get_comments', {
      p_post_id: postId,
    });
    return rows.map((r) => ({ id: r.id, postId: r.post_id, body: r.body, createdAt: r.created_at, author: { id: r.author.id, username: r.author.username, displayName: r.author.display_name } }));
  }
  return withDemo((demo) =>
    (demo.comments[postId] ?? [])
      .filter((cm) => !demo.blocked.includes(cm.authorId))
      .map((cm) => ({ id: cm.id, postId, author: author(demo, cm.authorId), body: cm.body, createdAt: cm.createdAt })),
  );
}

export async function addComment(postId: string, body: string): Promise<Comment> {
  const text = body.trim();
  if (!text) throw new Error('Scrivi qualcosa prima di inviare.');
  if (text.length > 300) throw new Error('Massimo 300 caratteri.');
  if (!isDemo) {
    const me = await uid();
    const { data, error } = await db().from('comments').insert({ post_id: postId, user_id: me, body: text }).select('id, created_at').single();
    if (error) throw new Error(error.message);
    const who = await getMe();
    if (!who) throw new Error('Sessione scaduta: riapri l’app.');
    return { id: data.id, postId, body: text, createdAt: data.created_at, author: who };
  }
  return withDemo((demo) => {
    stored(demo, postId);
    if (!demo.me) throw new Error('Crea prima il tuo profilo.');
    const cm = { id: `c-${Date.now()}`, authorId: demo.me.id, body: text, createdAt: new Date().toISOString() };
    demo.comments[postId] = [...(demo.comments[postId] ?? []), cm];
    return { id: cm.id, postId, author: author(demo, cm.authorId), body: text, createdAt: cm.createdAt };
  }, true);
}

/** Elimina un proprio commento. */
export async function deleteComment(postId: string, commentId: string): Promise<void> {
  if (!isDemo) {
    const { data, error } = await db().from('comments').delete().eq('id', commentId).select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('Puoi eliminare solo i tuoi commenti.');
    return;
  }
  await withDemo((demo) => {
    const list = demo.comments[postId] ?? [];
    const c = list.find((x) => x.id === commentId);
    if (!c || c.authorId !== demo.me?.id) throw new Error('Puoi eliminare solo i tuoi commenti.');
    demo.comments[postId] = list.filter((x) => x.id !== commentId);
  }, true);
}

export async function getProfile(username: string): Promise<{ profile: Profile; posts: Post[]; saved: Post[]; entry: MyEntry | null }> {
  if (!isDemo) {
    const res = await rpc<{
      profile: { id: string; username: string; display_name: string; bio: string | null; followers: number; following: number; covers: number; followed: boolean; is_me: boolean; is_moderator: boolean };
      posts: PostJson[];
      saved: PostJson[];
      entry: { entry_id: string; post_id: string; tier: number; status: MyEntry['status']; views: number; contest_day: string } | null;
    }>('get_profile', { p_username: username });
    const pr = res.profile;
    return {
      profile: { id: pr.id, username: pr.username, displayName: pr.display_name, bio: pr.bio ?? '', followers: pr.followers, following: pr.following, covers: pr.covers, followedByMe: pr.followed, isMe: pr.is_me, isModerator: pr.is_moderator },
      posts: res.posts.map(fromJson),
      saved: res.saved.map(fromJson),
      entry: res.entry ? { entryId: res.entry.entry_id, postId: res.entry.post_id, tier: res.entry.tier, status: res.entry.status, views: res.entry.views, contestDay: res.entry.contest_day } : null,
    };
  }
  return withDemo((demo) => {
    const person = Object.values(demo.people).find((p) => p.username === username);
    if (!person || demo.blocked.includes(person.id)) throw new Error('Profilo non trovato.');
    const isMe = person.id === demo.me?.id;
    const posts = Object.values(demo.posts)
      .filter((p) => p.authorId === person.id && (isMe || visible(demo, p.id)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => toPost(demo, p.id));
    const entry = demo.state.entries.find((e) => e.authorId === person.id && demo.posts[e.postId]);
    return {
      profile: {
        ...author(demo, person.id),
        bio: isMe ? demo.myBio : person.bio,
        // I creator seguiti all'inizio hanno già te nel conteggio: se smetti di seguirli scende di uno.
        followers: person.followers + (demo.following.includes(person.id) ? 1 : 0) - (DEMO_FOLLOWING.includes(person.username) ? 1 : 0),
        following: isMe ? demo.following.length : person.following,
        covers: demo.covers.filter((cv) => demo.posts[cv.postId]?.authorId === person.id).length,
        followedByMe: demo.following.includes(person.id),
        isMe,
        // In demo sei anche moderatore, così puoi provare la coda delle segnalazioni.
        isModerator: isMe,
      },
      posts,
      saved: isMe ? demo.saves.filter((id) => visible(demo, id)).map((id) => toPost(demo, id)) : [],
      entry: isMe && entry ? { entryId: entry.id, postId: entry.postId, tier: entry.tier, status: entry.status, views: entry.stats.views, contestDay: entry.contestDay } : null,
    };
  });
}

export async function getPost(postId: string): Promise<Post> {
  if (!isDemo) {
    const row = await rpc<PostJson | null>('get_post', { p_post_id: postId });
    if (!row) throw new Error('Post non trovato o non più disponibile.');
    return fromJson(row);
  }
  return withDemo((demo) => {
    const p = demo.posts[postId];
    if (!p || (p.authorId !== demo.me?.id && !visible(demo, postId))) throw new Error('Post non trovato o non più disponibile.');
    return toPost(demo, postId);
  });
}

export async function toggleFollow(userId: string, on: boolean): Promise<void> {
  if (!isDemo) {
    const me = await uid();
    const q = on ? db().from('follows').insert({ follower_id: me, followee_id: userId }) : db().from('follows').delete().match({ follower_id: me, followee_id: userId });
    const { error } = await q;
    if (error && error.code !== '23505') throw new Error(error.message);
    return;
  }
  await withDemo((demo) => {
    const has = demo.following.includes(userId);
    if (on && !has) demo.following.push(userId);
    if (!on && has) demo.following = demo.following.filter((x) => x !== userId);
  }, true);
}

export async function getMyEntry(): Promise<MyEntry | null> {
  if (!isDemo) {
    const rows = await rpc<{ entry_id: string; post_id: string; tier: number; status: MyEntry['status']; views: number; contest_day: string }[]>('arena_my_entry');
    const r = rows?.[0];
    return r ? { entryId: r.entry_id, postId: r.post_id, tier: r.tier, status: r.status, views: r.views, contestDay: r.contest_day } : null;
  }
  return withDemo((demo) => {
    const e = demo.me ? demo.state.entries.find((x) => x.authorId === demo.me!.id && demo.posts[x.postId]) : undefined;
    return e ? { entryId: e.id, postId: e.postId, tier: e.tier, status: e.status, views: e.stats.views, contestDay: e.contestDay } : null;
  });
}

export type PublishResult = { post: Post; entry: MyEntry | null; contestError: string | null };

/**
 * Pubblica un post e, se richiesto, lo candida. Una volta creato il post non lancia più errori:
 * se la candidatura non riesce lo dice in `contestError`, così l'utente non ripubblica due volte.
 */
export async function publish(input: NewPost): Promise<PublishResult> {
  if (!input.media.length) throw new Error('Scegli almeno una foto o un video.');
  if (input.media.length > 10) throw new Error('Al massimo 10 elementi per post.');
  if (input.caption.length > 300) throw new Error('La didascalia può avere al massimo 300 caratteri.');
  if (!isDemo) {
    const me = await uid();
    const media: MediaItem[] = [];
    try {
      for (const [i, m] of input.media.entries()) media.push(await upload(me, m, i));
    } catch (e) {
      await removeUploads(media);
      throw new Error(`Caricamento non riuscito: ${(e as Error).message}`);
    }
    const { data, error } = await db()
      .from('posts')
      .insert({ author_id: me, caption: input.caption.trim(), media: media.map((m) => ({ kind: m.kind, url: m.src, width: m.width, height: m.height, duration_ms: m.durationMs })) })
      .select('id')
      .single();
    if (error) {
      await removeUploads(media);
      throw new Error(error.message);
    }
    let contestError: string | null = null;
    if (input.joinContest) {
      const { error: e2 } = await db().rpc('arena_submit', { p_post_id: data.id });
      if (e2) contestError = e2.message;
    }
    // Il post esiste già: da qui in poi niente più errori, al massimo lo si compone in locale.
    const post = await getPost(data.id).catch(
      (): Post => ({
        id: data.id,
        author: { id: me, username: '', displayName: '' },
        media,
        caption: input.caption.trim(),
        createdAt: new Date().toISOString(),
        likeCount: 0,
        commentCount: 0,
        saveCount: 0,
        shareCount: 0,
        likedByMe: false,
        savedByMe: false,
        followingAuthor: false,
      }),
    );
    const entry = input.joinContest && !contestError ? await getMyEntry().catch(() => null) : null;
    return { post, entry, contestError };
  }
  const media = await Promise.all(input.media.map(persistLocal));
  return withDemo((demo) => {
    if (!demo.me) throw new Error('Crea prima il tuo profilo.');
    const me = demo.me;
    const id = `my-${Date.now()}`;
    demo.posts[id] = {
      id,
      authorId: me.id,
      media,
      caption: input.caption.trim(),
      createdAt: new Date().toISOString(),
      likes: 0,
      saves: 0,
      shares: 0,
    };
    demo.comments[id] = [];
    demo.myPostIds.unshift(id);
    let contestError: string | null = null;
    let entry: MyEntry | null = null;
    if (input.joinContest) {
      try {
        if (recentWinners(demo, shiftDay(arenaDay(), 1)).includes(me.id)) throw new Error('Sei stato in copertina da poco: potrai ricandidarti tra qualche giorno.');
        const e = submitEntry(demo.state, { id: `e-${demo.state.day}-${id}`, postId: id, authorId: me.id });
        // Qualità nascosta estratta come per tutti gli altri: nessun favoritismo.
        demo.quality[e.id] = Math.random() ** 1.3;
        entry = { entryId: e.id, postId: id, tier: e.tier, status: e.status, views: 0, contestDay: e.contestDay };
      } catch (err) {
        contestError = (err as Error).message;
      }
    }
    return { post: toPost(demo, id), entry, contestError };
  }, true);
}

async function removeUploads(media: MediaItem[]) {
  const paths = media.map((m) => storagePath(m.src)).filter(Boolean) as string[];
  if (paths.length) await db().storage.from('media').remove(paths).catch(() => undefined);
}

/**
 * In demo sul web le foto scelte sono indirizzi blob: che spariscono ricaricando la pagina.
 * Le si rimpicciolisce e salva come data URL (i video restano blob: sono troppo grandi).
 */
async function persistLocal(m: NewPost['media'][number]): Promise<MediaItem> {
  const item: MediaItem = { kind: m.kind, src: m.uri, width: m.width, height: m.height, durationMs: m.durationMs != null ? Math.round(m.durationMs) : undefined };
  if (Platform.OS !== 'web' || m.kind !== 'image' || !m.uri.startsWith('blob:') || typeof document === 'undefined') return item;
  try {
    const img = new Image();
    img.src = m.uri;
    await img.decode();
    // 720 px e qualità media: la demo vive nello spazio del browser (pochi MB), così ci stanno decine di foto.
    const scale = Math.min(1, 720 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { ...item, src: canvas.toDataURL('image/jpeg', 0.72), width: canvas.width, height: canvas.height };
  } catch {
    return item;
  }
}

/**
 * Solo demo: simula il resto della giornata e la mezzanotte. Il vincitore diventa la copertina di oggi,
 * le copertine precedenti scalano di un giorno nell'Archivio e riparte una nuova gara.
 */
export async function closeDayNowDemo(): Promise<Cover | null> {
  if (!isDemo) throw new Error('Disponibile solo in modalità demo.');
  return withDemo((demo) => {
    const rng = seededRng(Date.now() >>> 0);
    simulateCrowd(demo.state, { quality: (id) => demo.quality[id] ?? 0.3, viewers: 160, viewsPerViewer: 7, viewerPrefix: `crowd-close-${Date.now()}-`, forgetViewers: true }, rng);
    const today = arenaDay();
    const before = demo.covers;
    demo.covers = demo.covers.map((cv) => ({ ...cv, featuredOn: shiftDay(cv.featuredOn, -1) }));
    const postId = crown(demo, today);
    if (!postId) demo.covers = before;
    demo.state = seedDay(demo, today, `${today}-${Date.now()}`);
    const cv = postId ? demo.covers.find((x) => x.featuredOn === today) : undefined;
    return cv ? toCover(demo, cv) : null;
  }, true);
}

/** Cancella la demo. Passa dalla stessa coda delle altre scritture, così nessuna la fa "rivivere". */
export function resetDemo(): Promise<void> {
  const run = queue.then(() => removeKey(KEY));
  queue = run.catch(() => undefined);
  return run;
}

// ===========================================================================
// Sicurezza della community: segnalazioni, blocchi, eliminazione (richiesti dagli store)
// ===========================================================================

export type ReportReason = 'spam' | 'nudo' | 'violenza' | 'odio' | 'molestie' | 'minori' | 'falso' | 'altro';

export const REPORT_REASONS: { key: ReportReason; label: string }[] = [
  { key: 'nudo', label: 'Nudo o contenuti sessuali' },
  { key: 'minori', label: 'Mette in pericolo un minore' },
  { key: 'violenza', label: 'Violenza o contenuti scioccanti' },
  { key: 'odio', label: 'Odio o discriminazione' },
  { key: 'molestie', label: 'Molestie o bullismo' },
  { key: 'falso', label: 'Falso, truffa o furto d’identità' },
  { key: 'spam', label: 'Spam' },
  { key: 'altro', label: 'Altro' },
];

/** Segnala un post: sparisce subito per chi segnala; con 3 segnalazioni sparisce per tutti fino alla revisione. */
export async function reportPost(postId: string, reason: ReportReason, note?: string): Promise<void> {
  if (!isDemo) {
    await rpc('report_post', { p_post_id: postId, p_reason: reason, p_note: note ?? null });
    return;
  }
  await withDemo((demo) => {
    if (demo.posts[postId]?.authorId === demo.me?.id) throw new Error('Non puoi segnalare un tuo post.');
    if (!demo.reported.some((r) => r.postId === postId)) demo.reported.push({ postId, reason, at: new Date().toISOString() });
  }, true);
}

export async function blockUser(userId: string): Promise<void> {
  if (!isDemo) {
    await rpc('block_user', { p_user_id: userId });
    return;
  }
  await withDemo((demo) => {
    if (!demo.blocked.includes(userId)) demo.blocked.push(userId);
    demo.following = demo.following.filter((x) => x !== userId);
  }, true);
}

export async function unblockUser(userId: string): Promise<void> {
  if (!isDemo) {
    await rpc('unblock_user', { p_user_id: userId });
    return;
  }
  await withDemo((demo) => {
    demo.blocked = demo.blocked.filter((x) => x !== userId);
  }, true);
}

export async function listBlocked(): Promise<Author[]> {
  if (!isDemo) {
    const rows = await rpc<{ id: string; username: string; display_name: string }[]>('list_blocked');
    return rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name }));
  }
  return withDemo((demo) => demo.blocked.map((id) => author(demo, id)));
}

/** Elimina un proprio post (e il suo posto in gara). */
export async function deletePost(postId: string): Promise<void> {
  if (!isDemo) {
    const { data, error } = await db().from('posts').delete().eq('id', postId).select('media');
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error('Puoi eliminare solo i tuoi post.');
    // Anche i file: un post eliminato non deve restare raggiungibile dal suo indirizzo.
    const media = (data[0].media as { url: string }[] | null) ?? [];
    await removeUploads(media.map((m) => ({ kind: 'image', src: m.url, width: 0, height: 0 })));
    return;
  }
  await withDemo((demo) => {
    if (demo.posts[postId]?.authorId !== demo.me?.id) throw new Error('Puoi eliminare solo i tuoi post.');
    delete demo.posts[postId];
    delete demo.comments[postId];
    demo.myPostIds = demo.myPostIds.filter((x) => x !== postId);
    // Come sul server: la candidatura resta, ritirata. Non se ne fa una seconda lo stesso giorno.
    for (const e of demo.state.entries) if (e.postId === postId) e.status = 'disqualified';
  }, true);
}

/**
 * Elimina l'account e tutto ciò che contiene: prima i file nello Storage, poi il profilo
 * con post, commenti, like, follow e partecipazioni (a cascata nel database).
 */
export async function deleteAccount(): Promise<void> {
  if (!isDemo) {
    const me = await uid();
    const bucket = db().storage.from('media');
    for (;;) {
      const { data, error } = await bucket.list(me, { limit: 100 });
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      const { error: rmError } = await bucket.remove(data.map((f) => `${me}/${f.name}`));
      if (rmError) throw new Error(rmError.message);
      if (data.length < 100) break;
    }
    await rpc('delete_my_account');
    await db().auth.signOut();
    return;
  }
  await resetDemo();
}

export type ModItem = { post: Post; hidden: boolean; reports: number; reasons: ReportReason[]; firstAt: string };

/** Coda di moderazione (solo moderatori): i post segnalati, dal più vecchio. */
export async function getModQueue(): Promise<ModItem[]> {
  if (!isDemo) {
    const rows = await rpc<{ post: PostJson; hidden: boolean; reports: number; reasons: ReportReason[]; first_at: string }[]>('mod_queue');
    return rows.map((r) => ({ post: fromJson(r.post), hidden: r.hidden, reports: r.reports, reasons: r.reasons, firstAt: r.first_at }));
  }
  return withDemo((demo) =>
    demo.reported
      .filter((r) => demo.posts[r.postId])
      .map((r) => ({ post: toPost(demo, r.postId), hidden: true, reports: 1, reasons: [r.reason], firstAt: r.at })),
  );
}

export async function modResolve(postId: string, action: 'dismiss' | 'remove' | 'ban'): Promise<void> {
  if (!isDemo) {
    await rpc('mod_resolve', { p_post_id: postId, p_action: action });
    return;
  }
  await withDemo((demo) => {
    const authorId = demo.posts[postId]?.authorId;
    demo.reported = demo.reported.filter((r) => r.postId !== postId);
    if (action !== 'dismiss') {
      delete demo.posts[postId];
      demo.state.entries = demo.state.entries.filter((e) => e.postId !== postId);
    }
    if (action === 'ban' && authorId) {
      for (const p of Object.values(demo.posts)) if (p.authorId === authorId) delete demo.posts[p.id];
      demo.state.entries = demo.state.entries.filter((e) => e.authorId !== authorId);
    }
  }, true);
}
