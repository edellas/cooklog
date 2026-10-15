import {
  arenaDay,
  closeArena,
  coverDay,
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
import type {
  AppNotification,
  Author,
  Comment,
  Cover,
  FeedCard,
  FollowRow,
  IdentityItem,
  IdentityStatus,
  Me,
  MediaItem,
  MyEntry,
  NewPost,
  NotificationKind,
  Post,
  Profile,
  RegisterInput,
  Settings,
  Status,
} from '../types';
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
  view_count?: number;
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
    viewCount: p.view_count ?? 0,
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
  views?: number;
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
  /** Account creati sul dispositivo (demo): credenziali, dati privati, verifica e stato personale salvato all'uscita. */
  accounts?: Record<string, DemoAccount>;
  settings?: Settings;
  notifications?: AppNotification[];
  /** Post visti oggi (giorno:post): una visualizzazione per persona al giorno. */
  viewed?: string[];
};

type DemoUserState = Pick<DemoDb, 'likes' | 'saves' | 'following' | 'blocked' | 'reported' | 'shared' | 'myBio' | 'notifications' | 'viewed'>;

type DemoAccount = {
  me: Me;
  passwordHash: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  identity: { status: IdentityStatus; deadline: string; reason: string | null; document?: string; selfie?: string; submittedAt?: string };
  saved?: DemoUserState;
};

const DEFAULT_SETTINGS: Settings = { revealMinutes: 0, idGraceDays: 7, cutoffHour: DEFAULT_ARENA_CONFIG.submissionCutoffHour };

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
  const mine = demo.me ? demo.state.entries.find((e) => e.authorId === demo.me!.id && demo.posts[e.postId]) : undefined;
  const tierBefore = mine?.tier ?? 0;
  simulateCrowd(demo.state, { quality: (id) => demo.quality[id] ?? 0.3, viewers, viewsPerViewer: 4, viewerPrefix: `crowd-live-${Date.now()}-`, forgetViewers: true }, rng);
  if (!mine || !demo.me) return;
  // Il pubblico simulato reagisce anche al tuo post: qualche mi piace, qualche nuovo follower, i gradini.
  if (mine.tier > tierBefore) notifyDemo(demo, 'tier', null, mine.postId, { tier: mine.tier });
  const fans = COMMENTERS.map((n) => `demo-${n}`).filter((id) => !demo.blocked.includes(id));
  if (fans.length && rng() < 0.35) {
    const fan = fans[Math.floor(rng() * fans.length)];
    demo.posts[mine.postId].likes += 1;
    notifyDemo(demo, 'like', fan, mine.postId);
  }
  const me = demo.people[demo.me.id];
  if (me && fans.length && rng() < 0.12) {
    const fan = fans[Math.floor(rng() * fans.length)];
    if (!demo.notifications!.some((n) => n.kind === 'follow' && n.actor?.id === fan)) {
      me.followers += 1;
      notifyDemo(demo, 'follow', fan, null);
    }
  }
}

function notifyDemo(demo: DemoDb, kind: NotificationKind, actorId: string | null, postId: string | null, data: AppNotification['data'] = {}) {
  const list = (demo.notifications ??= []);
  const key = (n: AppNotification) => `${n.kind}|${n.actor?.id ?? ''}|${n.post?.id ?? ''}`;
  const actor = actorId ? author(demo, actorId) : null;
  const post = postId && demo.posts[postId] ? { id: postId, media: demo.posts[postId].media } : null;
  const item: AppNotification = { id: `n-${Date.now()}-${list.length}`, kind, actor, post, data, createdAt: new Date().toISOString(), read: false };
  demo.notifications = [item, ...list.filter((n) => key(n) !== key(item))].slice(0, 100);
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
  demo.accounts ??= {};
  demo.settings ??= { ...DEFAULT_SETTINGS };
  demo.notifications ??= [];
  demo.viewed ??= [];
  // Un profilo demo di prima delle password non ha un account con cui rientrare: si riparte dalla registrazione.
  if (demo.me && !demo.accounts[demo.me.username]) demo.me = null;
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
    viewCount: postViews(demo, sp),
    likedByMe: liked,
    savedByMe: saved,
    followingAuthor: demo.following.includes(sp.authorId),
    contest: entry ? { entryId: entry.id, tier: entry.tier, status: entry.status } : undefined,
  };
}

/** Visualizzazioni demo: per i post dei creator una stima dai mi piace; per i tuoi, le viste vere della gara. */
function postViews(demo: DemoDb, sp: StoredPost): number {
  const entry = demo.state.entries.find((e) => e.postId === sp.id);
  const base = sp.views ?? (sp.authorId === demo.me?.id ? 0 : sp.likes * 9 + (hash(sp.id) % 400));
  return base + (sp.authorId === demo.me?.id ? (entry?.stats.views ?? 0) : 0);
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

/**
 * Accesso con nome utente e password. Supabase Auth vuole un'email: se ne usa una interna, derivata dal
 * nome utente, che non riceve mai posta (in Supabase la conferma via email va disattivata).
 */
const LOGIN_DOMAIN = process.env.EXPO_PUBLIC_LOGIN_DOMAIN || 'utenti.virale.invalid';
const loginEmail = (username: string) => `${username.trim().toLowerCase().replace(/^@/, '')}@${LOGIN_DOMAIN}`;
const USERNAME = /^[a-z0-9_.]{3,24}$/;
export const MIN_AGE_YEARS = 14;
export const PASSWORD_MIN = 8;

/** Età compiuta alla data di oggi (giorno di gara, ora di Roma). */
export function ageOn(birthDate: string, today = arenaDay()): number {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/** Controlli del modulo di registrazione: gli stessi li rifà il server. */
export function validateRegistration(input: RegisterInput): string | null {
  const u = input.username.trim().toLowerCase();
  if (!input.firstName.trim() || !input.lastName.trim()) return 'Scrivi nome e cognome.';
  if (input.firstName.trim().length > 60 || input.lastName.trim().length > 60) return 'Nome e cognome: al massimo 60 caratteri.';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.birthDate);
  const d = m ? new Date(`${input.birthDate}T12:00:00Z`) : null;
  if (!m || !d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== input.birthDate || input.birthDate < '1900-01-01' || input.birthDate > arenaDay()) {
    return 'Data di nascita non valida.';
  }
  if (ageOn(input.birthDate) < MIN_AGE_YEARS) return `Per usare Virale devi avere almeno ${MIN_AGE_YEARS} anni.`;
  if (!USERNAME.test(u)) return 'Nome utente: da 3 a 24 caratteri tra lettere minuscole, numeri, punto e trattino basso.';
  if (input.password.length < PASSWORD_MIN) return `La password deve avere almeno ${PASSWORD_MIN} caratteri.`;
  if (!/[A-Za-z]/.test(input.password) || !/\d/.test(input.password)) return 'La password deve contenere almeno una lettera e un numero.';
  if (input.password.toLowerCase().includes(u)) return 'La password non può contenere il nome utente.';
  if (!input.acceptedTerms) return 'Per registrarti devi accettare termini e linee guida.';
  return null;
}

/** Hash locale della password demo (la demo non ha un server: serve solo a non tenerla in chiaro). */
async function demoHash(username: string, password: string): Promise<string> {
  const text = `virale-demo:${username}:${password}`;
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (subtle) {
    const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + text.charCodeAt(i), 2246822519) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}`;
}

function saveDemoUser(demo: DemoDb) {
  const acc = demo.me ? demo.accounts?.[demo.me.username] : undefined;
  if (!acc) return;
  acc.saved = {
    likes: demo.likes,
    saves: demo.saves,
    following: demo.following,
    blocked: demo.blocked,
    reported: demo.reported,
    shared: demo.shared,
    myBio: demo.myBio,
    notifications: demo.notifications,
    viewed: demo.viewed,
  };
}

function restoreDemoUser(demo: DemoDb, acc: DemoAccount) {
  const st = acc.saved;
  demo.me = acc.me;
  demo.likes = st?.likes ?? [];
  demo.saves = st?.saves ?? [];
  demo.following = st?.following ?? DEMO_FOLLOWING.map((u) => `demo-${u}`);
  demo.blocked = st?.blocked ?? [];
  demo.reported = st?.reported ?? [];
  demo.shared = st?.shared ?? [];
  demo.myBio = st?.myBio ?? '';
  demo.notifications = st?.notifications ?? [];
  demo.viewed = st?.viewed ?? [];
}

export async function usernameAvailable(username: string): Promise<boolean> {
  const u = username.trim().toLowerCase();
  if (!USERNAME.test(u)) return false;
  if (!isDemo) return rpc<boolean>('username_available', { p_username: u });
  return withDemo((demo) => !Object.values(demo.people).some((p) => p.username === u) && !demo.accounts?.[u]);
}

/** Registrazione: nome, cognome, data di nascita, nome utente e password. */
export async function register(input: RegisterInput): Promise<Me> {
  const problem = validateRegistration(input);
  if (problem) throw new Error(problem);
  const username = input.username.trim().toLowerCase();
  if (!isDemo) {
    let { data, error } = await db().auth.signUp({ email: loginEmail(username), password: input.password });
    if (error && /already registered|already exists/i.test(error.message)) {
      // Una registrazione interrotta (per esempio senza rete) ha lasciato l'utente senza profilo: si riprende.
      const res = await db().auth.signInWithPassword({ email: loginEmail(username), password: input.password });
      if (res.error) throw new Error('Questo nome utente è già preso.');
      if (await getMe()) throw new Error('Hai già un account: usa "Accedi".');
      data = { user: res.data.user, session: res.data.session };
      error = null;
    }
    if (error) throw new Error(/password/i.test(error.message) ? 'Password troppo debole: usane una più lunga.' : error.message);
    if (!data.session) {
      throw new Error('Registrazione non completata: in Supabase va disattivata la conferma via email (Authentication → Sign In / Providers → Email).');
    }
    const row = await rpc<{ id: string; username: string; display_name: string }>('complete_registration', {
      p_username: username,
      p_first_name: input.firstName.trim(),
      p_last_name: input.lastName.trim(),
      p_birth_date: input.birthDate,
      p_accept_terms: input.acceptedTerms,
    }).catch(async (e: Error) => {
      // Senza profilo l'utente non può fare nulla: si esce, così il prossimo tentativo riparte pulito.
      await db().auth.signOut().catch(() => undefined);
      throw e;
    });
    return { id: row.id, username: row.username, displayName: row.display_name };
  }
  const passwordHash = await demoHash(username, input.password);
  return withDemo((demo) => {
    if (Object.values(demo.people).some((p) => p.username === username) || demo.accounts?.[username]) throw new Error('Questo nome utente è già preso.');
    saveDemoUser(demo);
    const first = input.firstName.trim();
    const last = input.lastName.trim();
    const me: Me = { id: `me-${username}`, username, displayName: `${first.slice(0, 38)} ${last.slice(0, 1).toUpperCase()}.` };
    const deadline = new Date(Date.now() + demo.settings!.idGraceDays * 86400_000).toISOString();
    demo.accounts![username] = { me, passwordHash, firstName: first, lastName: last, birthDate: input.birthDate, identity: { status: 'missing', deadline, reason: null } };
    demo.people[me.id] = { ...me, bio: '', followers: 0, following: 0 };
    restoreDemoUser(demo, demo.accounts![username]);
    demo.people[me.id].following = demo.following.length;
    return me;
  }, true);
}

export async function login(username: string, password: string): Promise<Me> {
  const u = username.trim().toLowerCase().replace(/^@/, '');
  if (!u || !password) throw new Error('Scrivi nome utente e password.');
  if (!isDemo) {
    const { error } = await db().auth.signInWithPassword({ email: loginEmail(u), password });
    if (error) throw new Error(/invalid login|credentials/i.test(error.message) ? 'Nome utente o password sbagliati.' : error.message);
    const me = await getMe();
    if (!me) {
      await db().auth.signOut().catch(() => undefined);
      throw new Error('La registrazione di questo account non è stata completata: registrati di nuovo con lo stesso nome utente e la stessa password.');
    }
    return me;
  }
  const passwordHash = await demoHash(u, password);
  return withDemo((demo) => {
    const acc = demo.accounts?.[u];
    if (!acc || acc.passwordHash !== passwordHash) throw new Error('Nome utente o password sbagliati.');
    saveDemoUser(demo);
    restoreDemoUser(demo, acc);
    return acc.me;
  }, true);
}

export async function logout(): Promise<void> {
  if (!isDemo) {
    await db().auth.signOut();
    return;
  }
  await withDemo((demo) => {
    saveDemoUser(demo);
    demo.me = null;
  }, true);
}

export async function changePassword(current: string, next: string): Promise<void> {
  if (next.length < PASSWORD_MIN || !/[A-Za-z]/.test(next) || !/\d/.test(next)) {
    throw new Error(`La nuova password deve avere almeno ${PASSWORD_MIN} caratteri, con lettere e numeri.`);
  }
  if (!isDemo) {
    const me = await getMe();
    if (!me) throw new Error('Sessione scaduta: accedi di nuovo.');
    // Si verifica la password attuale prima di cambiarla: un telefono lasciato sbloccato non basta.
    const check = await db().auth.signInWithPassword({ email: loginEmail(me.username), password: current });
    if (check.error) throw new Error('La password attuale non è corretta.');
    const { error } = await db().auth.updateUser({ password: next });
    if (error) throw new Error(error.message);
    return;
  }
  const meName = (await getMe())?.username ?? '';
  const [oldHash, newHash] = await Promise.all([demoHash(meName, current), demoHash(meName, next)]);
  await withDemo((demo) => {
    const acc = demo.me ? demo.accounts?.[demo.me.username] : undefined;
    if (!acc || acc.passwordHash !== oldHash) throw new Error('La password attuale non è corretta.');
    acc.passwordHash = newHash;
  }, true);
}

/** La copertina di oggi: identica per tutti. */
export async function getTodayCover(): Promise<Cover | null> {
  if (!isDemo) {
    const row = await rpc<{ featured_on: string; total_entries: number; total_views: number; post: PostJson } | null>('get_today_cover');
    return row ? { featuredOn: row.featured_on, issue: issueNumber(row.featured_on), totalEntries: row.total_entries, totalViews: Number(row.total_views), post: fromJson(row.post) } : null;
  }
  return withDemo((demo) => {
    const cv = demo.covers.find((x) => x.featuredOn === coverDay(demo.settings!.revealMinutes) && visible(demo, x.postId));
    return cv ? toCover(demo, cv) : null;
  });
}

export async function getArchive(): Promise<Cover[]> {
  if (!isDemo) {
    const rows = await rpc<{ featured_on: string; total_entries: number; total_views: number; post: PostJson }[]>('get_cover_archive', { p_limit: 60 });
    return rows.map((r) => ({ featuredOn: r.featured_on, issue: issueNumber(r.featured_on), totalEntries: r.total_entries, totalViews: Number(r.total_views), post: fromJson(r.post) }));
  }
  return withDemo((demo) =>
    demo.covers.filter((cv) => cv.featuredOn <= coverDay(demo.settings!.revealMinutes) && visible(demo, cv.postId)).map((cv) => toCover(demo, cv)),
  );
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
      profile: {
        id: string;
        username: string;
        display_name: string;
        bio: string | null;
        followers: number;
        following: number;
        covers: number;
        views?: number;
        followed: boolean;
        is_me: boolean;
        is_moderator: boolean;
        is_admin?: boolean;
      };
      posts: PostJson[];
      saved: PostJson[];
      entry: { entry_id: string; post_id: string; tier: number; status: MyEntry['status']; views: number; contest_day: string } | null;
    }>('get_profile', { p_username: username });
    const pr = res.profile;
    return {
      profile: {
        id: pr.id,
        username: pr.username,
        displayName: pr.display_name,
        bio: pr.bio ?? '',
        followers: pr.followers,
        following: pr.following,
        covers: pr.covers,
        views: Number(pr.views ?? 0),
        followedByMe: pr.followed,
        isMe: pr.is_me,
        isModerator: pr.is_moderator,
        isAdmin: Boolean(pr.is_admin),
      },
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
        views: Object.values(demo.posts)
          .filter((p) => p.authorId === person.id)
          .reduce((n, p) => n + postViews(demo, p), 0),
        followedByMe: demo.following.includes(person.id),
        isMe,
        // In demo sei anche moderatore e amministratore, così puoi provare code e impostazioni.
        isModerator: isMe,
        isAdmin: isMe,
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
        viewCount: 0,
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
    // La copertina nuova prende il posto di quella visibile adesso (che dipende dall'orario di rivelazione).
    const shown = coverDay(demo.settings!.revealMinutes);
    const before = demo.covers;
    demo.covers = demo.covers.map((cv) => ({ ...cv, featuredOn: shiftDay(cv.featuredOn, -1) }));
    const winnerEntry = demo.state.entries;
    const postId = crown(demo, shown);
    if (!postId) demo.covers = before;
    else {
      const won = winnerEntry.find((e) => e.postId === postId);
      if (won && demo.me && won.authorId === demo.me.id) notifyDemo(demo, 'cover', null, postId, { featured_on: shown });
    }
    demo.state = seedDay(demo, today, `${today}-${Date.now()}`);
    const cv = postId ? demo.covers.find((x) => x.featuredOn === shown) : undefined;
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
    // Foto e video pubblicati, e gli eventuali documenti d'identità ancora in attesa.
    for (const name of ['media', 'documenti']) {
      const bucket = db().storage.from(name);
      for (;;) {
        const { data, error } = await bucket.list(me, { limit: 100 });
        if (error) throw new Error(error.message);
        if (!data?.length) break;
        const { error: rmError } = await bucket.remove(data.map((f) => `${me}/${f.name}`));
        if (rmError) throw new Error(rmError.message);
        if (data.length < 100) break;
      }
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

// ===========================================================================
// Stato dell'utente, verifica dell'età, amministrazione, notifiche, visualizzazioni, follower
// ===========================================================================

type StatusJson = {
  identity: { status: IdentityStatus; deadline: string; reason: string | null; can_act: boolean } | null;
  is_moderator: boolean;
  is_admin: boolean;
  unread: number;
  settings: { reveal_minutes: number; id_grace_days: number; submission_cutoff_hour: number };
};

export async function getStatus(): Promise<Status> {
  if (!isDemo) {
    const r = await rpc<StatusJson>('my_status');
    return {
      identity: r.identity ? { status: r.identity.status, deadline: r.identity.deadline, reason: r.identity.reason, canAct: r.identity.can_act } : null,
      isModerator: r.is_moderator,
      isAdmin: r.is_admin,
      unread: Number(r.unread ?? 0),
      settings: { revealMinutes: r.settings.reveal_minutes, idGraceDays: r.settings.id_grace_days, cutoffHour: r.settings.submission_cutoff_hour },
    };
  }
  return withDemo((demo) => {
    const acc = demo.me ? demo.accounts?.[demo.me.username] : undefined;
    const id = acc?.identity;
    return {
      identity: id ? { status: id.status, deadline: id.deadline, reason: id.reason, canAct: id.status === 'approved' || Date.now() < Date.parse(id.deadline) } : null,
      isModerator: Boolean(demo.me),
      isAdmin: Boolean(demo.me),
      unread: (demo.notifications ?? []).filter((n) => !n.read).length,
      settings: demo.settings!,
    };
  });
}

/** Le impostazioni pubbliche (orario della copertina), anche prima di accedere. */
export async function getSettings(): Promise<Settings> {
  if (!isDemo) {
    const r = await rpc<StatusJson['settings']>('get_settings');
    return { revealMinutes: r.reveal_minutes, idGraceDays: r.id_grace_days, cutoffHour: r.submission_cutoff_hour };
  }
  return withDemo((demo) => demo.settings!);
}

export async function saveSettings(revealMinutes: number, idGraceDays: number): Promise<Settings> {
  if (!Number.isInteger(revealMinutes) || revealMinutes < 0 || revealMinutes > 1439) throw new Error('Orario non valido.');
  if (!Number.isInteger(idGraceDays) || idGraceDays < 1 || idGraceDays > 60) throw new Error('I giorni per il documento vanno da 1 a 60.');
  if (!isDemo) {
    const r = await rpc<StatusJson['settings']>('admin_set_settings', { p_reveal_minutes: revealMinutes, p_id_grace_days: idGraceDays });
    return { revealMinutes: r.reveal_minutes, idGraceDays: r.id_grace_days, cutoffHour: r.submission_cutoff_hour };
  }
  return withDemo((demo) => {
    demo.settings = { ...demo.settings!, revealMinutes, idGraceDays };
    return demo.settings;
  }, true);
}

/** Carica foto del documento e selfie con il documento in mano, nella cartella privata dell'utente. */
export async function submitIdentity(documentUri: string, selfieUri: string): Promise<void> {
  if (!isDemo) {
    const me = await uid();
    const bucket = db().storage.from('documenti');
    const put = async (uri: string, name: string) => {
      const buffer = await (await fetch(uri)).arrayBuffer();
      const path = `${me}/${Date.now()}-${name}.jpg`;
      const { error } = await bucket.upload(path, buffer, { contentType: 'image/jpeg', upsert: false });
      if (error) throw new Error(`Caricamento non riuscito: ${error.message}`);
      return path;
    };
    const doc = await put(documentUri, 'documento');
    const selfie = await put(selfieUri, 'selfie').catch(async (e: Error) => {
      await bucket.remove([doc]).catch(() => undefined);
      throw e;
    });
    try {
      await rpc('submit_identity', { p_document_path: doc, p_selfie_path: selfie });
    } catch (e) {
      await bucket.remove([doc, selfie]).catch(() => undefined);
      throw e;
    }
    return;
  }
  const [doc, selfie] = await Promise.all([
    persistLocal({ uri: documentUri, kind: 'image', width: 0, height: 0 }),
    persistLocal({ uri: selfieUri, kind: 'image', width: 0, height: 0 }),
  ]);
  await withDemo((demo) => {
    const acc = demo.me ? demo.accounts?.[demo.me.username] : undefined;
    if (!acc) throw new Error('Accedi di nuovo.');
    if (acc.identity.status === 'approved') throw new Error('La tua età è già verificata.');
    acc.identity = { ...acc.identity, status: 'pending', reason: null, document: doc.src, selfie: selfie.src, submittedAt: new Date().toISOString() };
  }, true);
}

/** Coda dei documenti da verificare (amministratori). Le foto si aprono con link temporanei di 10 minuti. */
export async function getIdentityQueue(): Promise<IdentityItem[]> {
  if (!isDemo) {
    const rows = await rpc<
      { user_id: string; username: string; first_name: string; last_name: string; birth_date: string; document_path: string; selfie_path: string; submitted_at: string; deadline: string }[]
    >('identity_queue');
    const paths = rows.flatMap((r) => [r.document_path, r.selfie_path]).filter(Boolean);
    const signed = paths.length ? (await db().storage.from('documenti').createSignedUrls(paths, 600)).data ?? [] : [];
    const url = (p: string) => signed.find((x) => x.path === p)?.signedUrl ?? null;
    return rows.map((r) => ({
      userId: r.user_id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
      birthDate: r.birth_date,
      documentUrl: url(r.document_path),
      selfieUrl: url(r.selfie_path),
      submittedAt: r.submitted_at,
      deadline: r.deadline,
    }));
  }
  return withDemo((demo) =>
    Object.values(demo.accounts ?? {})
      .filter((a) => a.identity.status === 'pending')
      .map((a) => ({
        userId: a.me.id,
        username: a.me.username,
        firstName: a.firstName,
        lastName: a.lastName,
        birthDate: a.birthDate,
        documentUrl: a.identity.document ?? null,
        selfieUrl: a.identity.selfie ?? null,
        submittedAt: a.identity.submittedAt ?? '',
        deadline: a.identity.deadline,
      })),
  );
}

/** Decisione sul documento: poi le foto si cancellano subito. */
export async function reviewIdentity(userId: string, decision: 'approve' | 'reject' | 'underage', reason?: string): Promise<void> {
  if (!isDemo) {
    const res = await rpc<{ paths: (string | null)[] }>('identity_review', { p_user_id: userId, p_decision: decision, p_reason: reason ?? null });
    const paths = (res?.paths ?? []).filter(Boolean) as string[];
    if (paths.length) await db().storage.from('documenti').remove(paths);
    return;
  }
  await withDemo((demo) => {
    const acc = Object.values(demo.accounts ?? {}).find((a) => a.me.id === userId);
    if (!acc || acc.identity.status !== 'pending') throw new Error('Nessun documento in attesa per questo utente.');
    const ok = decision === 'approve';
    acc.identity = {
      status: ok ? 'approved' : 'rejected',
      deadline: acc.identity.deadline,
      reason: ok ? null : decision === 'underage' ? `Hai meno di ${MIN_AGE_YEARS} anni.` : reason?.trim() || 'Documento non leggibile o non corrispondente.',
    };
    if (demo.me?.id === userId) notifyDemo(demo, ok ? 'identity_ok' : 'identity_ko', null, null, { reason: acc.identity.reason });
  }, true);
}

type NotificationJson = {
  id: number;
  kind: NotificationKind;
  data: AppNotification['data'];
  created_at: string;
  read: boolean;
  actor: { id: string; username: string; display_name: string } | null;
  post: { id: string; media: PostJson['media'] } | null;
};

export async function getNotifications(): Promise<AppNotification[]> {
  if (!isDemo) {
    const rows = await rpc<NotificationJson[]>('list_notifications', { p_limit: 80 });
    return rows.map((n) => ({
      id: String(n.id),
      kind: n.kind,
      data: n.data ?? {},
      createdAt: n.created_at,
      read: n.read,
      actor: n.actor ? { id: n.actor.id, username: n.actor.username, displayName: n.actor.display_name } : null,
      post: n.post ? { id: n.post.id, media: n.post.media.map((m) => ({ kind: m.kind, src: m.url, width: m.width, height: m.height })) } : null,
    }));
  }
  return withDemo((demo) => (demo.notifications ?? []).filter((n) => !n.actor || !demo.blocked.includes(n.actor.id)));
}

export async function markNotificationsRead(): Promise<void> {
  if (!isDemo) {
    await rpc('mark_notifications_read');
    return;
  }
  await withDemo((demo) => {
    demo.notifications = (demo.notifications ?? []).map((n) => ({ ...n, read: true }));
  }, true);
}

/** Registra le visualizzazioni dei post rimasti sullo schermo (a gruppi, una per persona al giorno). */
export async function registerViews(postIds: string[]): Promise<void> {
  const ids = [...new Set(postIds)].slice(0, 20);
  if (!ids.length) return;
  if (!isDemo) {
    await rpc('register_views', { p_post_ids: ids });
    return;
  }
  await withDemo((demo) => {
    const today = arenaDay();
    for (const id of ids) {
      const p = demo.posts[id];
      const key = `${today}:${id}`;
      if (!p || p.authorId === demo.me?.id || demo.viewed!.includes(key)) continue;
      p.views = postViews(demo, p) + 1;
      demo.viewed!.push(key);
    }
    demo.viewed = demo.viewed!.filter((k) => k.startsWith(today));
  }, true);
}

export async function listFollows(username: string, kind: 'followers' | 'following'): Promise<FollowRow[]> {
  if (!isDemo) {
    const rows = await rpc<{ id: string; username: string; display_name: string; followed: boolean; is_me: boolean }[]>('list_follows', {
      p_username: username,
      p_kind: kind,
      p_limit: 300,
    });
    return rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, followedByMe: r.followed, isMe: r.is_me }));
  }
  return withDemo((demo) => {
    const person = Object.values(demo.people).find((p) => p.username === username);
    if (!person || demo.blocked.includes(person.id)) throw new Error('Profilo non trovato.');
    const row = (id: string): FollowRow => ({ ...author(demo, id), followedByMe: demo.following.includes(id), isMe: id === demo.me?.id });
    const isMe = person.id === demo.me?.id;
    if (kind === 'following') {
      if (isMe) return demo.following.filter((id) => !demo.blocked.includes(id)).map(row);
      // Per gli altri, in demo, un campione stabile delle persone che seguono.
      return COMMENTERS.filter((_, i) => (hash(person.id) + i) % 3 === 0).map((n) => row(`demo-${n}`));
    }
    if (isMe) {
      const fans = (demo.notifications ?? []).filter((n) => n.kind === 'follow' && n.actor).map((n) => n.actor!.id);
      return [...new Set(fans)].filter((id) => !demo.blocked.includes(id)).map(row);
    }
    const sample = COMMENTERS.filter((_, i) => (hash(person.username) + i) % 2 === 0).map((n) => `demo-${n}`);
    if (demo.following.includes(person.id) && demo.me) sample.unshift(demo.me.id);
    return sample.filter((id) => !demo.blocked.includes(id)).map(row);
  });
}
