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
import { COMMENTERS, CREATORS, DEMO_FOLLOWING, LAUNCH_DAY, PAST_COVERS, SEED_POSTS, TODAY_COVER } from '../data/seed';
import type { Author, Comment, Cover, FeedCard, Me, MediaItem, MyEntry, NewPost, Post, Profile } from '../types';
import { getJson, removeKey, setJson } from './storage';
import { isSupabaseConfigured, supabase } from './supabase';

/** Senza Supabase l'app gira in demo: tutto resta sul dispositivo, con un pubblico simulato. */
export const isDemo = !isSupabaseConfigured;

export const TIERS = DEFAULT_ARENA_CONFIG.tierThresholds;

/** Nomi dei livelli: il percorso di un provino fino alla copertina. */
export const TIER_NAMES = ['Provino', 'Bozza', 'Impaginato', 'In macchina', 'Finale'] as const;

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

async function uid(): Promise<string> {
  const { data } = await db().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Sessione scaduta: riapri l’app.');
  return id;
}

async function upload(userId: string, item: NewPost['media'][number], index: number): Promise<MediaItem> {
  const buffer = await (await fetch(item.uri)).arrayBuffer();
  const ext = item.kind === 'video' ? 'mp4' : 'jpg';
  const path = `${userId}/${Date.now()}-${index}.${ext}`;
  const { error } = await db()
    .storage.from('media')
    .upload(path, buffer, { contentType: item.mimeType ?? (item.kind === 'video' ? 'video/mp4' : 'image/jpeg') });
  if (error) throw new Error(error.message);
  const url = db().storage.from('media').getPublicUrl(path).data.publicUrl;
  return { kind: item.kind, src: url, width: item.width, height: item.height, durationMs: item.durationMs };
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
  };
}

function recentWinners(demo: DemoDb, day: string): string[] {
  const from = shiftDay(day, -DEFAULT_ARENA_CONFIG.winnerCooldownDays);
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
    if (blocked.has(post.authorId) || post.authorId === demo.me?.id) continue;
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
  const winner = closeArena(demo.state, recentWinners(demo, featuredOn));
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
  if (demo.state.day !== today) {
    if (demo.state.day && !demo.covers.some((cv) => cv.featuredOn === shiftDay(demo!.state.day, 1))) crown(demo, shiftDay(demo.state.day, 1));
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

function author(demo: DemoDb, id: string): Author {
  const p = demo.people[id];
  return p ? { id: p.id, username: p.username, displayName: p.displayName } : { id, username: 'utente', displayName: 'Utente' };
}

function toPost(demo: DemoDb, id: string): Post {
  const sp = demo.posts[id];
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
    const { data } = await db().auth.getSession();
    const id = data.session?.user.id;
    if (!id) return null;
    const { data: row } = await db().from('profiles').select('id, username, display_name').eq('id', id).maybeSingle();
    return row ? { id: row.id, username: row.username, displayName: row.display_name } : null;
  }
  return withDemo((demo) => demo.me);
}

export async function createAccount(username: string, displayName: string): Promise<Me> {
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
    const { error } = await db().from('profiles').insert({ id, username: clean, display_name: name });
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
    const cv = demo.covers.find((x) => x.featuredOn === arenaDay());
    return cv ? toCover(demo, cv) : null;
  });
}

export async function getArchive(): Promise<Cover[]> {
  if (!isDemo) {
    const rows = await rpc<{ featured_on: string; total_entries: number; total_views: number; post: PostJson }[]>('get_cover_archive', { p_limit: 60 });
    return rows.map((r) => ({ featuredOn: r.featured_on, issue: issueNumber(r.featured_on), totalEntries: r.total_entries, totalViews: Number(r.total_views), post: fromJson(r.post) }));
  }
  return withDemo((demo) => demo.covers.filter((cv) => cv.featuredOn <= arenaDay()).map((cv) => toCover(demo, cv)));
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
    const cards: FeedCard[] = batch.filter((e) => demo.posts[e.postId]).map((e) => ({ ...toPost(demo, e.postId), entryId: e.id }));
    if (cards.length < limit) {
      const taken = new Set([...excludeIds, ...cards.map((x) => x.id)]);
      const rest = Object.values(demo.posts)
        .filter((p) => !taken.has(p.id) && p.authorId !== demo.me!.id)
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
      .filter((p) => demo.following.includes(p.authorId))
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
    const me = await uid();
    const q = on ? db().from('post_likes').insert({ post_id: postId, user_id: me }) : db().from('post_likes').delete().match({ post_id: postId, user_id: me });
    const { error } = await q;
    if (error && error.code !== '23505') throw new Error(error.message);
    return;
  }
  await withDemo((demo) => {
    const has = demo.likes.includes(postId);
    if (on && !has) {
      demo.likes.push(postId);
      demo.posts[postId].likes += 1;
    } else if (!on && has) {
      demo.likes = demo.likes.filter((x) => x !== postId);
      demo.posts[postId].likes -= 1;
    }
  }, true);
}

export async function toggleSave(postId: string, on: boolean): Promise<void> {
  if (!isDemo) {
    const me = await uid();
    const q = on ? db().from('post_saves').insert({ post_id: postId, user_id: me }) : db().from('post_saves').delete().match({ post_id: postId, user_id: me });
    const { error } = await q;
    if (error && error.code !== '23505') throw new Error(error.message);
    return;
  }
  await withDemo((demo) => {
    const has = demo.saves.includes(postId);
    if (on && !has) {
      demo.saves.push(postId);
      demo.posts[postId].saves += 1;
    } else if (!on && has) {
      demo.saves = demo.saves.filter((x) => x !== postId);
      demo.posts[postId].saves -= 1;
    }
  }, true);
}

export async function registerShare(postId: string): Promise<void> {
  if (!isDemo) {
    await rpc('register_share', { p_post_id: postId });
    return;
  }
  await withDemo((demo) => {
    demo.posts[postId].shares += 1;
  }, true);
}

export async function getComments(postId: string): Promise<Comment[]> {
  if (!isDemo) {
    const { data, error } = await db()
      .from('comments')
      .select('id, post_id, body, created_at, author:profiles!comments_user_id_fkey(id, username, display_name)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => {
      const a = r.author as unknown as { id: string; username: string; display_name: string };
      return { id: r.id, postId: r.post_id, body: r.body, createdAt: r.created_at, author: { id: a.id, username: a.username, displayName: a.display_name } };
    });
  }
  return withDemo((demo) => (demo.comments[postId] ?? []).map((cm) => ({ id: cm.id, postId, author: author(demo, cm.authorId), body: cm.body, createdAt: cm.createdAt })));
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
    return { id: data.id, postId, body: text, createdAt: data.created_at, author: who! };
  }
  return withDemo((demo) => {
    const cm = { id: `c-${Date.now()}`, authorId: demo.me!.id, body: text, createdAt: new Date().toISOString() };
    demo.comments[postId] = [...(demo.comments[postId] ?? []), cm];
    return { id: cm.id, postId, author: author(demo, cm.authorId), body: text, createdAt: cm.createdAt };
  }, true);
}

export async function getProfile(username: string): Promise<{ profile: Profile; posts: Post[]; saved: Post[]; entry: MyEntry | null }> {
  if (!isDemo) {
    const res = await rpc<{
      profile: { id: string; username: string; display_name: string; bio: string | null; followers: number; following: number; covers: number; followed: boolean; is_me: boolean };
      posts: PostJson[];
      saved: PostJson[];
      entry: { entry_id: string; post_id: string; tier: number; status: MyEntry['status']; views: number; contest_day: string } | null;
    }>('get_profile', { p_username: username });
    const pr = res.profile;
    return {
      profile: { id: pr.id, username: pr.username, displayName: pr.display_name, bio: pr.bio ?? '', followers: pr.followers, following: pr.following, covers: pr.covers, followedByMe: pr.followed, isMe: pr.is_me },
      posts: res.posts.map(fromJson),
      saved: res.saved.map(fromJson),
      entry: res.entry ? { entryId: res.entry.entry_id, postId: res.entry.post_id, tier: res.entry.tier, status: res.entry.status, views: res.entry.views, contestDay: res.entry.contest_day } : null,
    };
  }
  return withDemo((demo) => {
    const person = Object.values(demo.people).find((p) => p.username === username);
    if (!person) throw new Error('Profilo non trovato.');
    const isMe = person.id === demo.me?.id;
    const posts = Object.values(demo.posts)
      .filter((p) => p.authorId === person.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => toPost(demo, p.id));
    const entry = demo.state.entries.find((e) => e.authorId === person.id);
    return {
      profile: {
        ...author(demo, person.id),
        bio: isMe ? demo.myBio : person.bio,
        followers: person.followers + (demo.following.includes(person.id) && !DEMO_FOLLOWING.includes(person.username) ? 1 : 0),
        following: isMe ? demo.following.length : person.following,
        covers: demo.covers.filter((cv) => demo.posts[cv.postId]?.authorId === person.id).length,
        followedByMe: demo.following.includes(person.id),
        isMe,
      },
      posts,
      saved: isMe ? demo.saves.filter((id) => demo.posts[id]).map((id) => toPost(demo, id)) : [],
      entry: entry ? { entryId: entry.id, postId: entry.postId, tier: entry.tier, status: entry.status, views: entry.stats.views, contestDay: entry.contestDay } : null,
    };
  });
}

export async function getPost(postId: string): Promise<Post> {
  if (!isDemo) return fromJson(await rpc<PostJson>('get_post', { p_post_id: postId }));
  return withDemo((demo) => {
    if (!demo.posts[postId]) throw new Error('Post non trovato.');
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
    const e = demo.me ? demo.state.entries.find((x) => x.authorId === demo.me!.id) : undefined;
    return e ? { entryId: e.id, postId: e.postId, tier: e.tier, status: e.status, views: e.stats.views, contestDay: e.contestDay } : null;
  });
}

export async function publish(input: NewPost): Promise<Post> {
  if (!input.media.length) throw new Error('Scegli almeno una foto o un video.');
  if (input.media.length > 10) throw new Error('Al massimo 10 elementi per post.');
  if (input.caption.length > 300) throw new Error('La didascalia può avere al massimo 300 caratteri.');
  if (!isDemo) {
    const me = await uid();
    const media = await Promise.all(input.media.map((m, i) => upload(me, m, i)));
    const { data, error } = await db()
      .from('posts')
      .insert({ author_id: me, caption: input.caption.trim(), media: media.map((m) => ({ kind: m.kind, url: m.src, width: m.width, height: m.height, duration_ms: m.durationMs })) })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    if (input.joinContest) {
      const { error: e2 } = await db().rpc('arena_submit', { p_post_id: data.id });
      if (e2) throw new Error(`Pubblicato, ma non in gara: ${e2.message}`);
    }
    return getPost(data.id);
  }
  return withDemo((demo) => {
    if (!demo.me) throw new Error('Crea prima il tuo profilo.');
    const id = `my-${Date.now()}`;
    demo.posts[id] = {
      id,
      authorId: demo.me.id,
      media: input.media.map((m) => ({ kind: m.kind, src: m.uri, width: m.width, height: m.height, durationMs: m.durationMs })),
      caption: input.caption.trim(),
      createdAt: new Date().toISOString(),
      likes: 0,
      saves: 0,
      shares: 0,
    };
    demo.comments[id] = [];
    demo.myPostIds.unshift(id);
    if (input.joinContest) {
      if (recentWinners(demo, shiftDay(arenaDay(), 1)).includes(demo.me.id)) throw new Error('Sei stato in copertina da poco: potrai ricandidarti tra qualche giorno.');
      const entryId = `e-${demo.state.day}-${id}`;
      submitEntry(demo.state, { id: entryId, postId: id, authorId: demo.me.id });
      // Qualità nascosta estratta come per tutti gli altri: nessun favoritismo.
      demo.quality[entryId] = Math.random() ** 1.3;
    }
    return toPost(demo, id);
  }, true);
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
    demo.covers = demo.covers.map((cv) => ({ ...cv, featuredOn: shiftDay(cv.featuredOn, -1) }));
    const postId = crown(demo, today);
    demo.state = seedDay(demo, today, `${today}-${Date.now()}`);
    const cv = postId ? demo.covers.find((x) => x.featuredOn === today) : undefined;
    return cv ? toCover(demo, cv) : null;
  }, true);
}

export async function resetDemo(): Promise<void> {
  await removeKey(KEY);
}
