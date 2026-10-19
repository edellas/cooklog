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
import { COMMENTERS, CREATORS, DEMO_FOLLOWING, PAST_COVERS, SEED_POSTS, TODAY_COVER } from '../data/seed';
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

import { charCount } from '../design/text';
import { OWNER } from '../legal/docs';
import { canActKnown, friendlyError, GENERIC_ERROR, NETWORK_ERROR, SESSION_ERROR, TOO_BIG_ERROR } from './errors';
import { getJson, removeKey, setJson } from './storage';
import { MAX_UPLOAD_BYTES, prepareVideo } from './video';
import { isSupabaseConfigured, supabase, supabaseAnonKey, supabaseUrl } from './supabase';
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createVideoPlayer } from 'expo-video';

/** Senza Supabase l'app gira in demo: tutto resta sul dispositivo, con un pubblico simulato. */
export const isDemo = !isSupabaseConfigured;

export const TIERS = DEFAULT_ARENA_CONFIG.tierThresholds;

/** Nomi dei livelli: il percorso di un provino fino alla copertina. */
export const TIER_NAMES = ['Provino', 'Bozza', 'Impaginato', 'In macchina', 'Finale'] as const;

/**
 * Le candidature chiudono 4 ore prima della fine della gara (che finisce all'orario della copertina).
 * In demo restano aperte, perché la fine della gara si può simulare in qualsiasi momento.
 */
export function contestOpen(revealMinutes = 0, now = new Date()): boolean {
  return isDemo || submissionsOpen(now, DEFAULT_ARENA_CONFIG, revealMinutes);
}


// ===========================================================================
// Supabase (produzione): le RPC restituiscono post già composti in JSON.
// ===========================================================================

type AuthorJson = { id: string; username: string; display_name: string; avatar_path?: string | null };

/** Indirizzo pubblico di una foto profilo nel bucket "avatars". */
export function avatarUrl(path: string | null | undefined): string | null {
  return path && supabaseUrl ? `${supabaseUrl}/storage/v1/object/public/avatars/${path}` : null;
}

function authorFrom(a: AuthorJson): Author {
  return { id: a.id, username: a.username, displayName: a.display_name, avatar: avatarUrl(a.avatar_path) };
}

type PostJson = {
  id: string;
  author: AuthorJson;
  media: { kind: 'image' | 'video'; url: string; width: number; height: number; duration_ms?: number; poster?: string }[];
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
  contest?: { entry_id: string | null; tier: number | null; status: EntryStatus } | null;
  cursor?: string;
};

function fromJson(p: PostJson): Post {
  return {
    id: p.id,
    author: authorFrom(p.author),
    media: p.media.map((m) => ({ kind: m.kind, src: m.url, width: m.width, height: m.height, durationMs: m.duration_ms, poster: m.poster })),
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
    cursor: p.cursor,
  };
}

function db() {
  if (!supabase) throw new Error('Supabase non configurato.');
  return supabase;
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(friendlyError(error));
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

/**
 * Link da condividere: la pagina di atterraggio sul sito del titolare (apri.html), che apre il post nell'app
 * o porta allo store. Senza sito, il rimando della funzione verifica-eta. In demo non c'è un server: nessun link.
 */
export function postLink(postId: string): string | null {
  if (isDemo) return null;
  if (OWNER.website) return `${OWNER.website.replace(/\/+$/, '')}/apri.html?p=${postId}`;
  return supabaseUrl ? `${supabaseUrl}/functions/v1/verifica-eta/apri/post/${postId}` : null;
}

/** Lato lungo massimo delle foto pubblicate: nitide su ogni telefono, ma leggere da caricare e da guardare. */
const PHOTO_MAX = 1440;

/** Foto: JPEG ridimensionato. Su errore resta l'originale. */
async function preparePhoto(item: NewPost['media'][number]): Promise<NewPost['media'][number]> {
  const big = Math.max(item.width, item.height) > PHOTO_MAX;
  const jpeg = item.mimeType === 'image/jpeg';
  if (!big && jpeg) return item;
  try {
    const ctx = ImageManipulator.manipulate(item.uri);
    if (big) ctx.resize(item.width >= item.height ? { width: PHOTO_MAX } : { height: PHOTO_MAX });
    const out = await (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
    return { ...item, uri: out.uri, width: out.width, height: out.height, mimeType: 'image/jpeg' };
  } catch {
    return item;
  }
}

/** Video: un fotogramma come JPEG (per miniature e per l'attesa del primo fotogramma). Facoltativo. */
async function videoPoster(uri: string): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const player = createVideoPlayer(uri);
  try {
    const [thumb] = await player.generateThumbnailsAsync([0.4], { maxWidth: 720, maxHeight: 720 });
    if (!thumb) return null;
    const out = await (await ImageManipulator.manipulate(thumb).renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
    return out.uri;
  } catch {
    return null;
  } finally {
    player.release();
  }
}

/**
 * Carica un file nel bucket media. Sul telefono lo legge a pezzi dal disco (un video da 100 MB non passa
 * tutto in memoria) e dice a che punto è; sul web usa il client normale. Con `signal` il caricamento sul
 * telefono si interrompe subito (sul web finisce, e il file si cancella dopo).
 */
async function putFile(path: string, uri: string, contentType: string, onFraction?: (f: number) => void, signal?: AbortSignal): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error(TOO_BIG_ERROR);
    const { error } = await db().storage.from('media').upload(path, blob, { contentType });
    if (error) throw new Error(storageMessage(error));
    onFraction?.(1);
    return;
  }
  // Controllo del peso prima di partire: un file oltre il limite verrebbe trasferito tutto e poi rifiutato.
  const info = await FileSystem.getInfoAsync(uri).catch(() => null);
  if (info?.exists && info.size > MAX_UPLOAD_BYTES) throw new Error(TOO_BIG_ERROR);
  const { data } = await db().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sessione scaduta: accedi di nuovo.');
  const task = FileSystem.createUploadTask(
    `${supabaseUrl}/storage/v1/object/media/${path}`,
    uri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey, 'Content-Type': contentType, 'x-upsert': 'false', 'cache-control': 'max-age=3600' },
    },
    (p) => onFraction?.(p.totalBytesExpectedToSend > 0 ? p.totalBytesSent / p.totalBytesExpectedToSend : 0),
  );
  const cancel = () => void task.cancelAsync().catch(() => undefined);
  signal?.addEventListener('abort', cancel);
  let res: Awaited<ReturnType<typeof task.uploadAsync>>;
  try {
    res = await task.uploadAsync();
  } catch (e) {
    if (signal?.aborted) throw new PublishAborted();
    throw new Error(friendlyError(e));
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
  if (signal?.aborted) throw new PublishAborted();
  if (!res || res.status >= 300) {
    let message = '';
    try {
      const body = JSON.parse(res?.body ?? '{}') as { message?: string; error?: string };
      message = body.message ?? body.error ?? '';
    } catch {
      // risposta non JSON
    }
    throw new Error(storageMessage({ message, status: res?.status ?? 0 }));
  }
  onFraction?.(1);
}

/**
 * Errore dello Storage in italiano. La regola di caricamento rifiuta sia chi ha superato il tetto giornaliero
 * sia chi ha la verifica dell'età scaduta: si distingue con lo stato dell'utente.
 */
function storageMessage(error: { message?: string; status?: number; statusCode?: string | number }): string {
  const message = error.message ?? '';
  if (/row-level security|policy|unauthorized|403/i.test(message) || Number(error.status ?? error.statusCode) === 403) {
    return canActKnown() === false ? 'Per pubblicare serve la verifica dell’età.' : 'Hai caricato troppi file oggi: riprova domani.';
  }
  if (!message && !error.status) return 'Connessione assente. Riprova.';
  return friendlyError({ ...error, message, name: 'StorageApiError' });
}

type UploadHooks = {
  /** Avanzamento del file (0-1), compressione compresa. */
  onFraction?: (f: number) => void;
  onPhase?: (p: PublishPhase) => void;
  signal?: AbortSignal;
  /** Ogni percorso prima di caricarlo: se la pubblicazione si interrompe, si sa cosa cancellare. */
  onPath?: (path: string) => void;
};

async function upload(userId: string, raw: NewPost['media'][number], index: number, hooks: UploadHooks = {}): Promise<MediaItem> {
  const { onFraction, onPhase, signal, onPath } = hooks;
  // Video: prima la compressione (solo sul telefono, se serve), che pesa il 40% della barra di questo file.
  let compressed = false;
  const item =
    raw.kind === 'image'
      ? await preparePhoto(raw)
      : await prepareVideo(
          raw,
          (f) => {
            if (!compressed) onPhase?.('prepara');
            compressed = true;
            onFraction?.(f * 0.4);
          },
          signal,
        ).catch((e: unknown) => {
          if (signal?.aborted) throw new PublishAborted();
          throw e;
        });
  if (signal?.aborted) throw new PublishAborted();
  onPhase?.('carica');
  const contentType = item.mimeType ?? (item.kind === 'video' ? 'video/mp4' : 'image/jpeg');
  const base = `${userId}/${Date.now()}-${index}`;
  const path = `${base}.${EXT[contentType] ?? (item.kind === 'video' ? 'mp4' : 'jpg')}`;
  onPath?.(path);
  await putFile(path, item.uri, contentType, (f) => onFraction?.(compressed ? 0.4 + f * 0.6 : f), signal);
  const publicUrl = (p: string) => db().storage.from('media').getPublicUrl(p).data.publicUrl;
  let poster: string | undefined;
  if (item.kind === 'video') {
    // L'anteprima dal file che si pubblica (quello compresso, se c'è).
    const still = await videoPoster(item.uri);
    if (signal?.aborted) throw new PublishAborted();
    if (still) {
      try {
        onPath?.(`${base}-poster.jpg`);
        await putFile(`${base}-poster.jpg`, still, 'image/jpeg', undefined, signal);
        poster = publicUrl(`${base}-poster.jpg`);
      } catch (e) {
        if (e instanceof PublishAborted) throw e;
        // senza anteprima il video si vede lo stesso
      }
    }
  }
  return {
    kind: item.kind,
    src: publicUrl(path),
    width: Math.round(item.width),
    height: Math.round(item.height),
    durationMs: item.durationMs != null ? Math.round(item.durationMs) : undefined,
    poster,
  };
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
  /** Commenti e profili che ho segnalato (i commenti spariscono subito per me). */
  userReports?: DemoUserReport[];
  /** Account creati sul dispositivo (demo): credenziali, dati privati, verifica e stato personale salvato all'uscita. */
  accounts?: Record<string, DemoAccount>;
  settings?: Settings;
  notifications?: AppNotification[];
  /** Post visti oggi (giorno:post): una visualizzazione per persona al giorno. */
  viewed?: string[];
  /** Chi segue l'utente demo (simulati). */
  fans?: string[];
  /** Gusti (come sul server): chiave → punteggio e momento dell'ultimo aggiornamento, per il dimezzamento. */
  interests?: Record<string, { s: number; at: number }>;
  /** Post passati sullo schermo (id → quando): Esplora non li ripropone per qualche giorno. */
  seen?: Record<string, number>;
};

type DemoUserReport = {
  kind: 'comment' | 'profile';
  commentId?: string;
  postId?: string;
  userId: string;
  reason: ReportReason;
  at: string;
  snapshot: { body?: string; username?: string; display_name?: string; bio?: string };
};

type DemoUserState = Pick<DemoDb, 'likes' | 'saves' | 'following' | 'blocked' | 'reported' | 'userReports' | 'shared' | 'myBio' | 'notifications' | 'viewed' | 'interests' | 'seen'> & {
  fans?: string[];
};

type DemoAccount = {
  me: Me;
  passwordHash: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  identity: { status: IdentityStatus; deadline: string; reason: string | null; document?: string; selfie?: string; submittedAt?: string };
  saved?: DemoUserState;
  /** Ultimo cambio del nome mostrato (si cambia una volta ogni 7 giorni, come sul server). */
  nameChangedAt?: string;
  /** Quando è stato creato l'account demo (il voto conta dopo 24 ore, come sul server). */
  createdAt?: string;
  /** Impronta del codice di recupero (mai il codice) e tentativi sbagliati recenti, come sul server. */
  recoveryHash?: string | null;
  recoveryFails?: number[];
};

const DEFAULT_SETTINGS: Settings = { revealMinutes: 0, idGraceDays: 7, cutoffHour: DEFAULT_ARENA_CONFIG.submissionCutoffHour, idProvider: 'manual' };

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
    demo.fans ??= [];
    if (!demo.fans.includes(fan)) {
      demo.fans.push(fan);
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
  const item: AppNotification = {
    id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    actor,
    post,
    data,
    createdAt: new Date().toISOString(),
    read: false,
  };
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
  let demo = await getJson<DemoDb | null>(KEY, null);
  if (!demo) demo = freshDb();
  demo.blocked ??= [];
  demo.reported ??= [];
  demo.userReports ??= [];
  demo.accounts ??= {};
  demo.settings ??= { ...DEFAULT_SETTINGS };
  // Come sul server: il giorno di gara va da un orario di copertina al successivo.
  const today = coverDay(demo.settings.revealMinutes);
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

/** I commenti di un post che l'utente demo vede: niente persone bloccate né commenti che ha segnalato (come get_comments). */
function visibleComments(demo: DemoDb, postId: string): StoredComment[] {
  return (demo.comments[postId] ?? []).filter(
    (cm) => !demo.blocked.includes(cm.authorId) && !(demo.userReports ?? []).some((r) => r.kind === 'comment' && r.commentId === cm.id),
  );
}

function stored(demo: DemoDb, postId: string): StoredPost {
  const p = demo.posts[postId];
  if (!p || !visible(demo, postId)) throw new Error('Questo post non è più disponibile.');
  return p;
}

function author(demo: DemoDb, id: string): Author {
  const p = demo.people[id];
  return p ? { id: p.id, username: p.username, displayName: p.displayName, avatar: p.avatar ?? null } : { id, username: 'utente', displayName: 'Utente' };
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
    commentCount: visibleComments(demo, id).length,
    saveCount: sp.saves,
    shareCount: sp.shares,
    viewCount: postViews(demo, sp),
    likedByMe: liked,
    savedByMe: saved,
    followingAuthor: demo.following.includes(sp.authorId),
    // Come sul server: livello e stato li vede solo l'autore, chi vota sa solo che è in gara.
    contest: !entry
      ? undefined
      : sp.authorId === demo.me?.id
        ? { entryId: entry.id, tier: entry.tier, status: entry.status }
        : entry.status === 'active' || entry.status === 'finalist'
          ? { entryId: null, tier: null, status: 'active' }
          : undefined,
  };
}

/** Visualizzazioni demo: per i post dei creator una stima dai mi piace; per i tuoi, le viste vere della gara. */
function postViews(demo: DemoDb, sp: StoredPost): number {
  const entry = demo.state.entries.find((e) => e.postId === sp.id);
  // I post degli account creati sul dispositivo partono da zero; quelli dei creator demo da una stima.
  const local = sp.authorId.startsWith('me-');
  const base = sp.views ?? (local ? 0 : sp.likes * 9 + (hash(sp.id) % 400));
  return base + (sp.authorId === demo.me?.id ? (entry?.stats.views ?? 0) : 0);
}

/** Demo: il numero dell'uscita è la posizione fra le copertine demo, dalla più vecchia (N. 1). */
function toCover(demo: DemoDb, cv: DemoDb['covers'][number]): Cover {
  const issue = demo.covers.filter((x) => x.featuredOn <= cv.featuredOn).length;
  return { featuredOn: cv.featuredOn, issue, totalEntries: cv.totalEntries, totalViews: cv.totalViews, post: toPost(demo, cv.postId) };
}

// ===========================================================================
// API usata dalle schermate
// ===========================================================================

export async function getMe(): Promise<Me | null> {
  if (!isDemo) {
    // Un errore di rete NON significa "nessun account": lo si segnala, così l'app propone di riprovare.
    const { data, error } = await db().auth.getSession();
    if (error) throw new Error(friendlyError(error));
    const id = data.session?.user.id;
    if (!id) return null;
    const { data: row, error: e2 } = await db().from('profiles').select('id, username, display_name').eq('id', id).maybeSingle();
    if (e2) throw new Error(friendlyError(e2));
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
/** Stesse regole di username_format_ok / username_reserved in schema.sql (solo per le iscrizioni nuove). */
const USERNAME = /^[a-z0-9_.]{3,24}$/;
const RESERVED_USERNAMES = ['virale', 'admin', 'amministratore', 'moderatore', 'moderazione', 'supporto', 'assistenza', 'staff', 'ufficiale', 'official', 'help', 'aiuto', 'copertina', 'provini', 'sistema', 'root'];
export const USERNAME_RULES =
  'Nome utente: da 3 a 24 caratteri tra lettere minuscole, numeri, punto e trattino basso, con almeno una lettera o un numero. Il punto non può stare all’inizio, alla fine o due volte di fila.';
export const USERNAME_RESERVED = 'Questo nome utente non è disponibile.';
export function usernameFormatOk(u: string): boolean {
  return USERNAME.test(u) && /[a-z0-9]/.test(u) && !u.startsWith('.') && !u.endsWith('.') && !u.includes('..');
}
export function usernameReserved(u: string): boolean {
  return RESERVED_USERNAMES.includes(u) || /^(virale|admin)/.test(u);
}
export const MIN_AGE_YEARS = 14;
export const PASSWORD_MIN = 8;

/** Età compiuta alla data di oggi (giorno di gara, ora di Roma). */
export function ageOn(birthDate: string, today = arenaDay()): number {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/** I campi del modulo di registrazione, nell'ordine in cui compaiono: l'errore va sotto quello giusto. */
export type RegisterField = 'first' | 'last' | 'birth' | 'username' | 'password' | 'again' | 'terms';
export type RegistrationProblem = { field: RegisterField; message: string };

/**
 * Controlli del modulo di registrazione, campo per campo e nell'ordine del modulo (gli stessi li rifà il
 * server). `again` è la password ripetuta: si controlla solo se passata.
 */
export function validateRegistration(input: RegisterInput, again?: string): RegistrationProblem | null {
  const u = input.username.trim().toLowerCase();
  const bad = (field: RegisterField, message: string): RegistrationProblem => ({ field, message });
  if (!input.firstName.trim()) return bad('first', 'Scrivi nome e cognome.');
  if (!input.lastName.trim()) return bad('last', 'Scrivi nome e cognome.');
  if (input.firstName.trim().length > 60) return bad('first', 'Nome e cognome: al massimo 60 caratteri.');
  if (input.lastName.trim().length > 60) return bad('last', 'Nome e cognome: al massimo 60 caratteri.');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.birthDate);
  const d = m ? new Date(`${input.birthDate}T12:00:00Z`) : null;
  if (!m || !d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== input.birthDate || input.birthDate < '1900-01-01' || input.birthDate > arenaDay()) {
    return bad('birth', 'Data di nascita non valida.');
  }
  if (ageOn(input.birthDate) < MIN_AGE_YEARS) return bad('birth', `Per usare Virale devi avere almeno ${MIN_AGE_YEARS} anni.`);
  if (!usernameFormatOk(u)) return bad('username', USERNAME_RULES);
  if (usernameReserved(u)) return bad('username', USERNAME_RESERVED);
  const weak = passwordProblem(input.password, u);
  if (weak) return bad('password', weak);
  if (again !== undefined && !again) return bad('again', 'Ripeti la password.');
  if (again !== undefined && again !== input.password) return bad('again', 'Le due password non coincidono.');
  if (!input.acceptedTerms) return bad('terms', 'Per registrarti devi accettare termini e linee guida.');
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

function emptyUserState(): DemoUserState {
  return {
    likes: [],
    saves: [],
    following: DEMO_FOLLOWING.map((u) => `demo-${u}`),
    blocked: [],
    reported: [],
    userReports: [],
    shared: [],
    myBio: '',
    notifications: [],
    viewed: [],
    interests: {},
    seen: {},
  };
}

/** Come sul server: scaduto il tempo per il documento si guarda soltanto. */
function demoAssertCanAct(demo: DemoDb) {
  const acc = demo.me ? demo.accounts?.[demo.me.username] : undefined;
  const id = acc?.identity;
  if (id && id.status !== 'approved' && Date.now() >= Date.parse(id.deadline)) {
    throw new Error('Serve la verifica dell’età: carica il documento dal profilo.');
  }
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
    userReports: demo.userReports,
    shared: demo.shared,
    myBio: demo.myBio,
    notifications: demo.notifications,
    viewed: demo.viewed,
    fans: demo.fans,
    interests: demo.interests,
    seen: demo.seen,
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
  demo.userReports = st?.userReports ?? [];
  demo.shared = st?.shared ?? [];
  demo.myBio = st?.myBio ?? '';
  demo.notifications = st?.notifications ?? [];
  demo.viewed = st?.viewed ?? [];
  demo.fans = st?.fans ?? [];
  demo.interests = st?.interests ?? {};
  demo.seen = st?.seen ?? {};
}

// ---------------------------------------------------------------------------
// Gusti (demo): stessa logica di rank_posts / interest_bump in schema.sql.
// ---------------------------------------------------------------------------
const HALF_LIFE_MS = 14 * 86400000;
const decayed = (v: { s: number; at: number } | undefined, now = Date.now()) => (v ? v.s * 0.5 ** ((now - v.at) / HALF_LIFE_MS) : 0);

/** Chiavi di un post con il loro peso: autore, tipo di contenuto e hashtag della didascalia. */
export function interestKeys(post: { authorId: string; caption: string; media: { kind: string }[] }): [string, number][] {
  const tags = [...new Set([...(post.caption ?? '').matchAll(/#([\p{L}\p{N}_]{2,40})/gu)].map((m) => m[1].toLowerCase()))].slice(0, 8);
  return [
    [`a:${post.authorId}`, 1],
    [`k:${post.media[0]?.kind ?? 'image'}`, 0.25],
    ...tags.map((t): [string, number] => [`t:${t}`, 0.6 / Math.sqrt(tags.length)]),
  ];
}

function bumpKey(demo: DemoDb, key: string, delta: number) {
  if (!delta) return;
  demo.interests ??= {};
  const now = Date.now();
  demo.interests[key] = { s: Math.max(-20, Math.min(50, decayed(demo.interests[key], now) + delta)), at: now };
}

function bumpInterest(demo: DemoDb, postId: string, delta: number) {
  const p = demo.posts[postId];
  if (!p || p.authorId === demo.me?.id) return;
  for (const [key, w] of interestKeys(p)) bumpKey(demo, key, delta * w);
}

/** Punteggio di un post per l'utente demo (senza il termine "persone simili", che in demo non c'è). */
function demoScore(demo: DemoDb, p: StoredPost, personalOnly: boolean): number {
  const now = Date.now();
  const taste = interestKeys(p).reduce((n, [key, w]) => n + w * decayed(demo.interests?.[key], now), 0);
  let score = Math.tanh(taste / 4) * 1.2;
  if (!personalOnly) {
    const views = postViews(demo, p);
    score += Math.min((p.likes + 2 * p.saves + 2 * p.shares + (demo.comments[p.id]?.length ?? 0) + 1) / (views + 8), 1) * 0.8;
    score += Math.exp(-(now - Date.parse(p.createdAt)) / (3 * 86400000)) * 0.4;
    if (demo.following.includes(p.authorId)) score += 0.3;
  }
  return score;
}

/**
 * Esplora in demo: tutti i post (anche in gara), ordinati per gusti con un po' di caso, al massimo 2 per autore.
 * Come sul server: finiti quelli nuovi si ripropongono gli altri evitando gli ultimi 50 mostrati, poi gli
 * ultimi 5, poi nessuno. Non finisce mai.
 */
function demoExplore(demo: DemoDb, limit: number, exclude: string[]): Post[] {
  const meId = demo.me?.id;
  const ex = new Set(exclude.slice(-300));
  const now = Date.now();
  const all = Object.values(demo.posts).filter((p) => p.authorId !== meId && visible(demo, p.id));
  let pool = all.filter((p) => !ex.has(p.id) && !(demo.seen?.[p.id] && now - demo.seen[p.id] < 3 * 86400000));
  for (const recent of [50, 5, 0]) {
    if (pool.length >= limit) break;
    const skip = new Set(recent ? exclude.slice(-recent) : []);
    pool = all.filter((p) => !skip.has(p.id));
    if (pool.length) break;
  }
  const ranked = pool.map((p) => ({ p, s: demoScore(demo, p, false) + Math.random() * 0.6 })).sort((a, b) => b.s - a.s);
  const perAuthor: Record<string, number> = {};
  const out: Post[] = [];
  for (const { p } of ranked) {
    if ((perAuthor[p.authorId] = (perAuthor[p.authorId] ?? 0) + 1) > 2) continue;
    out.push(toPost(demo, p.id));
    if (out.length >= limit) break;
  }
  return out;
}

export async function usernameAvailable(username: string): Promise<boolean> {
  const u = username.trim().toLowerCase();
  if (!usernameFormatOk(u) || usernameReserved(u)) return false;
  if (!isDemo) return rpc<boolean>('username_available', { p_username: u });
  return withDemo((demo) => !Object.values(demo.people).some((p) => p.username === u) && !demo.accounts?.[u]);
}

/** Registrazione: nome, cognome, data di nascita, nome utente e password. */
export async function register(input: RegisterInput): Promise<Me> {
  const problem = validateRegistration(input);
  if (problem) throw new Error(problem.message);
  const username = input.username.trim().toLowerCase();
  if (!isDemo) {
    // Prima si controlla il nome: così non resta un utente di autenticazione "orfano" con un nome già preso.
    if (!(await rpc<boolean>('username_available', { p_username: username }))) {
      throw new Error('Questo nome utente è già preso. Se è tuo, usa "Ho già un account".');
    }
    let { data, error } = await db().auth.signUp({ email: loginEmail(username), password: input.password });
    if (error && /already registered|already exists/i.test(error.message)) {
      // Una registrazione interrotta (per esempio senza rete) ha lasciato l'utente senza profilo: si riprende.
      const res = await db().auth.signInWithPassword({ email: loginEmail(username), password: input.password });
      if (res.error) throw new Error('Questo nome utente è già preso. Se è tuo, usa "Ho già un account".');
      if (await getMe()) {
        await db().auth.signOut({ scope: 'local' }).catch(() => undefined);
        throw new Error('Hai già un account con questo nome: usa "Ho già un account".');
      }
      data = { user: res.data.user, session: res.data.session };
      error = null;
    }
    if (error) throw new Error(authMessage(error.message));
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
      // Senza profilo l'utente di accesso resterebbe "orfano" e terrebbe occupato il nome: lo si elimina.
      // Ma solo se il profilo davvero non c'è (un secondo tocco su "Registrati" non deve cancellare il primo).
      const existing = await getMe().catch(() => null);
      if (existing) return { id: existing.id, username: existing.username, display_name: existing.displayName };
      await rpc('delete_my_account').catch(() => undefined);
      await db().auth.signOut({ scope: 'local' }).catch(() => undefined);
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
    // Come sul server: "Nome I.", contando i caratteri (un'emoji è uno solo, non due).
    const me: Me = { id: `me-${username}`, username, displayName: `${Array.from(first).slice(0, 36).join('')} ${(Array.from(last)[0] ?? '').toUpperCase()}.` };
    const deadline = new Date(Date.now() + demo.settings!.idGraceDays * 86400_000).toISOString();
    demo.accounts![username] = {
      me,
      passwordHash,
      firstName: first,
      lastName: last,
      birthDate: input.birthDate,
      identity: { status: 'missing', deadline, reason: null },
      createdAt: new Date().toISOString(),
    };
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
    if (error) throw new Error(authMessage(error.message));
    const me = await getMe();
    if (!me) {
      await db().auth.signOut({ scope: 'local' }).catch(() => undefined);
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
    // Prima si stacca il telefono dalle notifiche (serve ancora la sessione), poi si esce.
    await unregisterPushToken();
    // Solo questo dispositivo; e se non riesce lo si dice, invece di lasciare la sessione salvata.
    const { error } = await db().auth.signOut({ scope: 'local' });
    if (error) throw new Error('Uscita non riuscita. Controlla la connessione e riprova.');
    return;
  }
  await withDemo((demo) => {
    saveDemoUser(demo);
    demo.me = null;
  }, true);
}

/** Messaggi di Supabase Auth in italiano, comprensibili. */
function authMessage(message: string): string {
  if (/invalid login|credentials/i.test(message)) return 'Nome utente o password sbagliati.';
  if (/different from the old/i.test(message)) return 'La nuova password deve essere diversa da quella attuale.';
  if (/weak|leaked|pwned/i.test(message)) return 'Password troppo debole o già comparsa in furti di dati: scegline un\'altra.';
  if (/at least \d+ characters|too short/i.test(message)) return `La password deve avere almeno ${PASSWORD_MIN} caratteri.`;
  if (/rate limit|too many/i.test(message)) return 'Troppi tentativi: aspetta qualche minuto e riprova.';
  if (/network|fetch/i.test(message)) return 'Connessione assente. Riprova.';
  return friendlyError({ message, name: 'AuthApiError' });
}

/** Regole della password (le stesse nella funzione verifica-eta, rotta /recupero). */
export function passwordProblem(password: string, username: string): string | null {
  if (password.length < PASSWORD_MIN) return `La password deve avere almeno ${PASSWORD_MIN} caratteri.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'La password deve contenere almeno una lettera e un numero.';
  if (username && password.toLowerCase().includes(username.toLowerCase())) return 'La password non può contenere il nome utente.';
  return null;
}

/**
 * Per gli account creati con il vecchio "Entra" (senza password): si collegano nome utente e password,
 * così si può uscire e rientrare. Serve la conferma via email spenta in Supabase.
 */
export async function setPassword(password: string): Promise<void> {
  const me = await getMe();
  if (!me) throw new Error('Sessione scaduta: riapri l’app.');
  const problem = passwordProblem(password, me.username);
  if (problem) throw new Error(problem);
  if (isDemo) return;
  const { data, error } = await db().auth.updateUser({ email: loginEmail(me.username), password });
  if (error) throw new Error(authMessage(error.message));
  if (data.user?.new_email || !data.user?.email) {
    throw new Error('Password non collegata: in Supabase va spenta la conferma via email (Authentication → Sign In / Providers → Email).');
  }
}

export async function changePassword(current: string, next: string): Promise<void> {
  const meNow = await getMe();
  const problem = passwordProblem(next, meNow?.username ?? '');
  if (problem) throw new Error(problem);
  if (next === current) throw new Error('La nuova password deve essere diversa da quella attuale.');
  if (!isDemo) {
    const me = meNow;
    if (!me) throw new Error('Sessione scaduta: accedi di nuovo.');
    // Si verifica la password attuale prima di cambiarla: un telefono lasciato sbloccato non basta.
    const check = await db().auth.signInWithPassword({ email: loginEmail(me.username), password: current });
    if (check.error) throw new Error('La password attuale non è corretta.');
    const { error } = await db().auth.updateUser({ password: next });
    if (error) throw new Error(authMessage(error.message));
    // Gli altri dispositivi collegati con la vecchia password vengono disconnessi.
    await db().auth.signOut({ scope: 'others' }).catch(() => undefined);
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

// ---------------------------------------------------------------------------
// Codice di recupero della password (niente email: con il codice se ne sceglie una nuova da sé)
// ---------------------------------------------------------------------------
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Il codice come lo si scrive: maiuscolo, senza spazi né trattini (come recovery_redeem in schema.sql). */
const recoveryPlain = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Mentre lo si scrive: XXXX-XXXX-XXXX-XXXX. */
export function formatRecoveryCode(text: string): string {
  return (recoveryPlain(text).slice(0, 16).match(/.{1,4}/g) ?? []).join('-');
}
export const RECOVERY_WRONG = 'Nome utente o codice non validi.';
const RECOVERY_TOO_MANY = 'Troppi tentativi: riprova tra un’ora.';

/** Solo demo: un codice nuovo generato sul dispositivo (sul server lo fa create_recovery_code). */
function demoRecoveryCode(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  const plain = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
  return formatRecoveryCode(plain);
}

/**
 * Crea un codice di recupero nuovo (il precedente smette di valere) e lo restituisce: si vede solo adesso.
 * Con `currentPassword` (da Impostazioni) prima si controlla la password, come per cambiarla.
 */
export async function createRecoveryCode(currentPassword?: string): Promise<string> {
  if (!isDemo) {
    if (currentPassword !== undefined) {
      const me = await getMe();
      if (!me) throw new Error(SESSION_ERROR);
      const check = await db().auth.signInWithPassword({ email: loginEmail(me.username), password: currentPassword });
      if (check.error) throw new Error(/invalid login|credentials/i.test(check.error.message) ? 'La password attuale non è corretta.' : authMessage(check.error.message));
    }
    return rpc<string>('create_recovery_code');
  }
  const username = (await getMe())?.username ?? '';
  const given = currentPassword === undefined ? null : await demoHash(username, currentPassword);
  const code = demoRecoveryCode();
  const recoveryHash = await demoHash(username, `recupero:${recoveryPlain(code)}`);
  await withDemo((demo) => {
    const acc = demo.me ? demo.accounts?.[demo.me.username] : undefined;
    if (!acc) throw new Error(SESSION_ERROR);
    if (given !== null && acc.passwordHash !== given) throw new Error('La password attuale non è corretta.');
    acc.recoveryHash = recoveryHash;
  }, true);
  return code;
}

/** Il problema della rotta /recupero spiegato a chi sta recuperando la password (non all'amministratore). */
async function recoveryProblem(error: unknown): Promise<string> {
  const e = error as { name?: string; context?: Response };
  if (e.name === 'FunctionsFetchError') return NETWORK_ERROR;
  const res = e.context;
  if (res && (res.status === 400 || res.status === 429)) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error) return body.error;
  }
  if (res?.status === 404) return 'Il recupero con il codice non è ancora attivo. Riprova più tardi.';
  return GENERIC_ERROR;
}

/**
 * Password dimenticata: con nome utente e codice di recupero se ne sceglie una nuova. Il codice vale una volta
 * sola e gli altri dispositivi collegati escono. Poi si entra con la password nuova.
 */
export async function recoverPassword(username: string, code: string, password: string): Promise<Me> {
  const u = username.trim().toLowerCase().replace(/^@+/, '');
  if (!u || recoveryPlain(code).length !== 16) throw new Error(RECOVERY_WRONG);
  const weak = passwordProblem(password, u);
  if (weak) throw new Error(weak);
  if (!isDemo) {
    const { data, error } = await db().functions.invoke<{ ok?: boolean; error?: string }>('verifica-eta/recupero', { body: { username: u, code, password } });
    if (error) throw new Error(await recoveryProblem(error));
    if (!data?.ok) throw new Error(data?.error ?? GENERIC_ERROR);
    return login(u, password);
  }
  const [given, nextHash] = await Promise.all([demoHash(u, `recupero:${recoveryPlain(code)}`), demoHash(u, password)]);
  // Il tentativo sbagliato va salvato: si restituisce l'errore invece di lanciarlo dentro withDemo.
  const problem = await withDemo((demo): string | null => {
    const acc = demo.accounts?.[u];
    if (!acc) return RECOVERY_WRONG;
    const recent = (acc.recoveryFails ?? []).filter((t) => Date.now() - t < 3600_000);
    if (recent.length >= 5) return RECOVERY_TOO_MANY;
    if (!acc.recoveryHash || acc.recoveryHash !== given) {
      acc.recoveryFails = [...recent, Date.now()];
      return RECOVERY_WRONG;
    }
    // Come sul server: i tentativi sbagliati restano contati per un'ora anche dopo quello giusto.
    acc.recoveryHash = null;
    acc.passwordHash = nextHash;
    return null;
  }, true);
  if (problem) throw new Error(problem);
  return login(u, password);
}

/** Stesse regole di update_my_profile (schema.sql): nome da 1 a 30 caratteri senza nomi da staff, bio fino a 160. */
function profileProblem(name: string | undefined, bio: string | undefined): string | null {
  if (name !== undefined) {
    if (charCount(name) < 1 || charCount(name) > 30) return 'Il nome può avere da 1 a 30 caratteri.';
    if (/[\u0000-\u001f\u007f]/.test(name)) return 'Il nome contiene caratteri non validi.';
    if (/(virale|staff|moderat|amministrat|supporto)/i.test(name)) return 'Questo nome non è disponibile.';
  }
  if (bio !== undefined) {
    if (charCount(bio) > 160) return 'La bio può avere al massimo 160 caratteri.';
    if ((bio.match(/\n/g) ?? []).length > 4) return 'La bio può andare a capo al massimo 4 volte.';
    if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(bio)) return 'La bio contiene caratteri non validi.';
  }
  return null;
}

/**
 * Foto profilo: quadrata 512×512 in JPEG (qualità 0,8), dal centro dell'immagine scelta. In demo un data URL
 * più piccolo (256×256), che sta nello spazio del browser.
 */
async function squareJpeg(uri: string, width: number, height: number, size: number, base64: boolean) {
  const side = Math.min(width, height);
  const ctx = ImageManipulator.manipulate(uri);
  if (side > 0 && width !== height) ctx.crop({ originX: Math.round((width - side) / 2), originY: Math.round((height - side) / 2), width: side, height: side });
  ctx.resize({ width: size, height: size });
  return (await ctx.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64 });
}

export type ProfileUpdate = {
  displayName?: string;
  bio?: string;
  /** Una foto nuova scelta dalla galleria (con le sue misure). */
  photo?: { uri: string; width: number; height: number };
  removePhoto?: boolean;
};

/** Modifica il proprio profilo: nome mostrato (una volta ogni 7 giorni), bio, foto. */
export async function updateProfile(change: ProfileUpdate): Promise<Me & { bio: string }> {
  const name = change.displayName?.trim().replace(/\s+/g, ' ');
  const bio = change.bio?.trim();
  const problem = profileProblem(name, bio);
  if (problem) throw new Error(problem);
  if (!isDemo) {
    const me = await uid();
    let path: string | null = null;
    if (change.photo && !change.removePhoto) {
      const out = await squareJpeg(change.photo.uri, change.photo.width, change.photo.height, 512, false);
      path = `${me}/avatar-${Date.now()}.jpg`;
      const buffer = await (await fetch(out.uri)).arrayBuffer();
      const { error } = await db().storage.from('avatars').upload(path, buffer, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
      if (error) throw new Error(storageMessage(error));
    }
    const row = await rpc<{ id: string; username: string; display_name: string; bio: string; avatar_path: string | null }>('update_my_profile', {
      p_display_name: name ?? null,
      p_bio: bio ?? null,
      p_avatar_path: path,
      p_remove_avatar: Boolean(change.removePhoto),
    }).catch(async (e: Error) => {
      // La foto appena caricata non serve più.
      if (path) await db().storage.from('avatars').remove([path]).catch(() => undefined);
      throw e;
    });
    return { ...authorFrom(row), bio: row.bio };
  }
  const photo = change.photo && !change.removePhoto ? await squareJpeg(change.photo.uri, change.photo.width, change.photo.height, 256, true).catch(() => null) : null;
  return withDemo((demo) => {
    if (!demo.me) throw new Error('Accedi di nuovo.');
    demoAssertCanAct(demo);
    const acc = demo.accounts?.[demo.me.username];
    const person = demo.people[demo.me.id];
    if (!acc || !person) throw new Error('Accedi di nuovo.');
    if (name !== undefined && name !== person.displayName) {
      if (acc.nameChangedAt && Date.now() - Date.parse(acc.nameChangedAt) < 7 * 86400000) throw new Error('Puoi cambiare il nome una volta ogni 7 giorni.');
      person.displayName = name;
      acc.nameChangedAt = new Date().toISOString();
    }
    if (bio !== undefined) {
      person.bio = bio;
      demo.myBio = bio;
    }
    if (change.removePhoto) person.avatar = null;
    else if (photo?.base64) person.avatar = `data:image/jpeg;base64,${photo.base64}`;
    const me: Me = { id: person.id, username: person.username, displayName: person.displayName, avatar: person.avatar ?? null };
    demo.me = me;
    acc.me = me;
    return { ...me, bio: person.bio };
  }, true);
}

/** La copertina di oggi: identica per tutti. */
export async function getTodayCover(): Promise<Cover | null> {
  if (!isDemo) {
    const row = await rpc<CoverJson | null>('get_today_cover');
    return row ? coverFromJson(row) : null;
  }
  return withDemo((demo) => {
    // La più recente già uscita (se l'ultima gara non ha avuto candidati resta quella di prima).
    const day = coverDay(demo.settings!.revealMinutes);
    const cv = demo.covers.filter((x) => x.featuredOn <= day && visible(demo, x.postId)).sort((a, b) => b.featuredOn.localeCompare(a.featuredOn))[0];
    return cv ? toCover(demo, cv) : null;
  });
}

type CoverJson = { featured_on: string; issue?: number; total_entries: number; total_views: number; post: PostJson };
function coverFromJson(r: CoverJson): Cover {
  return { featuredOn: r.featured_on, issue: Number(r.issue ?? 0), totalEntries: r.total_entries, totalViews: Number(r.total_views), post: fromJson(r.post) };
}

/** L'Archivio, dalla più recente, a pagine: `before` è il giorno dell'ultima copertina già mostrata. */
export async function getArchive(before?: string, limit = 30): Promise<Cover[]> {
  if (!isDemo) {
    const rows = await rpc<CoverJson[]>('get_cover_archive', { p_limit: limit, p_before: before ?? null });
    return rows.map(coverFromJson);
  }
  return withDemo((demo) =>
    demo.covers
      .filter((cv) => cv.featuredOn <= coverDay(demo.settings!.revealMinutes) && (!before || cv.featuredOn < before) && visible(demo, cv.postId))
      .sort((a, b) => b.featuredOn.localeCompare(a.featuredOn))
      .slice(0, limit)
      .map((cv) => toCover(demo, cv)),
  );
}

/** La copertina di un giorno (Archivio, link): null se non esiste, non è ancora uscita o non è visibile. */
export async function getCover(day: string): Promise<Cover | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00Z`))) return null;
  if (!isDemo) {
    const row = await rpc<CoverJson | null>('get_cover', { p_day: day });
    return row ? coverFromJson(row) : null;
  }
  return withDemo((demo) => {
    const cv = demo.covers.find((x) => x.featuredOn === day && day <= coverDay(demo.settings!.revealMinutes) && visible(demo, x.postId));
    return cv ? toCover(demo, cv) : null;
  });
}

/**
 * "In gara": solo i post in gara oggi (mai i propri), scelti dal server alla cieca e pesati per i tuoi gusti.
 * Visti tutti, la lista finisce: i post fuori gara stanno in Esplora.
 */
export async function getForYou(limit = 6, excludeIds: string[] = []): Promise<FeedCard[]> {
  if (!isDemo) {
    const rows = await rpc<{ entry_id: string | null; post: PostJson }[]>('feed_for_you', { p_limit: limit, p_exclude: excludeIds.slice(-300) });
    // Difesa in più: anche con un database non aggiornato, qui finiscono solo le candidature.
    return rows.filter((r) => r.entry_id).map((r) => ({ ...fromJson(r.post), entryId: r.entry_id ?? undefined }));
  }
  return withDemo((demo) => {
    if (!demo.me) return [];
    crowdTick(demo, 10);
    // L'app manda gli id dei post già in lista: il motore ragiona per candidature.
    const shown = new Set(excludeIds);
    const exclude = new Set(demo.state.entries.filter((e) => shown.has(e.postId)).map((e) => e.id));
    const batch = serveBatch(demo.state, demo.me.id, limit, Math.random, DEFAULT_ARENA_CONFIG, exclude);
    // Come sul server: dentro la pagina vengono prima i post più vicini ai tuoi gusti (con un po' di caso).
    const cards: FeedCard[] = batch
      .filter((e) => visible(demo, e.postId))
      .map((e) => ({ e, k: -Math.log(Math.max(Math.random(), 1e-12)) / Math.exp(Math.max(-1, Math.min(1.2, demoScore(demo, demo.posts[e.postId], true)))) }))
      .sort((a, b) => a.k - b.k)
      .map(({ e }) => ({ ...toPost(demo, e.postId), entryId: e.id }));
    return cards;
  }, true);
}

/** Feed "Seguiti": i post di chi segui, dal più recente, a pagine (before = data dell'ultimo già mostrato). */
export async function getFollowing(before?: string, limit = 12): Promise<Post[]> {
  if (!isDemo) {
    const rows = await rpc<PostJson[]>('feed_following', { p_limit: limit, p_before: before ?? null });
    return rows.map(fromJson);
  }
  return withDemo((demo) =>
    Object.values(demo.posts)
      .filter((p) => demo.following.includes(p.authorId) && visible(demo, p.id) && (!before || p.createdAt < before))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((p) => toPost(demo, p.id)),
  );
}

/**
 * Esplora: tutti i post di tutti (anche quelli in gara e di chi non segui), ordinati per i tuoi gusti.
 * Non finisce mai. Guardare qui un post in gara non è un voto: si vota solo in "In gara".
 */
export async function getExplore(limit = 8, excludeIds: string[] = []): Promise<Post[]> {
  if (!isDemo) {
    const rows = await rpc<PostJson[]>('feed_explore', { p_limit: limit, p_exclude: excludeIds.slice(-300) });
    return rows.map(fromJson);
  }
  return withDemo((demo) => (demo.me ? demoExplore(demo, limit, excludeIds) : []));
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
      if (error && error.code !== '23505') throw new Error(friendlyError(error));
    });
  }
  await withDemo((demo) => {
    const p = stored(demo, postId);
    if (on) demoAssertCanAct(demo);
    const has = demo.likes.includes(postId);
    if (on && !has) {
      demo.likes.push(postId);
      p.likes += 1;
      bumpInterest(demo, postId, 1);
    } else if (!on && has) {
      demo.likes = demo.likes.filter((x) => x !== postId);
      p.likes = Math.max(0, p.likes - 1);
      bumpInterest(demo, postId, -1);
    }
  }, true);
}

export async function toggleSave(postId: string, on: boolean): Promise<void> {
  if (!isDemo) {
    return inOrder(`save:${postId}`, async () => {
      const me = await uid();
      const q = on ? db().from('post_saves').insert({ post_id: postId, user_id: me }) : db().from('post_saves').delete().match({ post_id: postId, user_id: me });
      const { error } = await q;
      if (error && error.code !== '23505') throw new Error(friendlyError(error));
    });
  }
  await withDemo((demo) => {
    const p = stored(demo, postId);
    // Come sul server: con la verifica scaduta non si salva.
    if (on) demoAssertCanAct(demo);
    const has = demo.saves.includes(postId);
    if (on && !has) {
      demo.saves.push(postId);
      p.saves += 1;
      bumpInterest(demo, postId, 2);
    } else if (!on && has) {
      demo.saves = demo.saves.filter((x) => x !== postId);
      p.saves = Math.max(0, p.saves - 1);
      bumpInterest(demo, postId, -1.5);
    }
  }, true);
}

/** Registra una condivisione. Conta una volta per persona e post, come sul server. */
/**
 * Registra una condivisione (una per persona e post). Restituisce true se è la prima: solo allora il contatore sale.
 * Su Android il sistema non dice se il foglio è stato chiuso senza condividere: conta comunque una volta sola,
 * come una condivisione vera, quindi non si può usare per gonfiare la gara.
 */
export async function registerShare(postId: string): Promise<boolean> {
  if (!isDemo) return Boolean(await rpc<boolean | null>('register_share', { p_post_id: postId }));
  return withDemo((demo) => {
    const p = stored(demo, postId);
    demo.shared ??= [];
    if (demo.shared.includes(postId)) return false;
    demo.shared.push(postId);
    p.shares += 1;
    bumpInterest(demo, postId, 2);
    return true;
  }, true);
}

export async function getComments(postId: string): Promise<Comment[]> {
  if (!isDemo) {
    const rows = await rpc<{ id: string; post_id: string; body: string; created_at: string; author: AuthorJson }[]>('get_comments', {
      p_post_id: postId,
    });
    return rows.map((r) => ({ id: r.id, postId: r.post_id, body: r.body, createdAt: r.created_at, author: authorFrom(r.author) }));
  }
  return withDemo((demo) => visibleComments(demo, postId).map((cm) => ({ id: cm.id, postId, author: author(demo, cm.authorId), body: cm.body, createdAt: cm.createdAt })));
}

export async function addComment(postId: string, body: string): Promise<Comment> {
  const text = body.trim();
  if (!text) throw new Error('Scrivi qualcosa prima di inviare.');
  if (text.length > 300) throw new Error('Massimo 300 caratteri.');
  if (!isDemo) {
    const me = await uid();
    const { data, error } = await db().from('comments').insert({ post_id: postId, user_id: me, body: text }).select('id, created_at').single();
    if (error) throw new Error(error.code === '42501' && canActKnown() !== false ? 'Questo post non è più disponibile.' : friendlyError(error));
    const who = await getMe();
    if (!who) throw new Error('Sessione scaduta: riapri l’app.');
    return { id: data.id, postId, body: text, createdAt: data.created_at, author: who };
  }
  return withDemo((demo) => {
    stored(demo, postId);
    if (!demo.me) throw new Error('Crea prima il tuo profilo.');
    demoAssertCanAct(demo);
    const cm = { id: `c-${Date.now()}`, authorId: demo.me.id, body: text, createdAt: new Date().toISOString() };
    demo.comments[postId] = [...(demo.comments[postId] ?? []), cm];
    bumpInterest(demo, postId, 1.5);
    return { id: cm.id, postId, author: author(demo, cm.authorId), body: text, createdAt: cm.createdAt };
  }, true);
}

/** Elimina un proprio commento. */
export async function deleteComment(postId: string, commentId: string): Promise<void> {
  if (!isDemo) {
    const { data, error } = await db().from('comments').delete().eq('id', commentId).select('id');
    if (error) throw new Error(friendlyError(error));
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
        avatar_path?: string | null;
        name_change_from?: string | null;
        followers: number;
        following: number;
        covers: number;
        views?: number;
        post_count?: number;
        saved_count?: number;
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
        avatar: avatarUrl(pr.avatar_path),
        nameChangeFrom: pr.name_change_from ?? null,
        bio: pr.bio ?? '',
        followers: pr.followers,
        following: pr.following,
        covers: pr.covers,
        views: Number(pr.views ?? 0),
        postCount: Number(pr.post_count ?? res.posts.length),
        savedCount: Number(pr.saved_count ?? res.saved.length),
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
        nameChangeFrom: (() => {
          const at = isMe ? demo.accounts?.[person.username]?.nameChangedAt : undefined;
          return at && Date.now() - Date.parse(at) < 7 * 86400000 ? new Date(Date.parse(at) + 7 * 86400000).toISOString() : null;
        })(),
        bio: isMe ? demo.myBio : person.bio,
        // I creator seguiti all'inizio hanno già te nel conteggio: se smetti di seguirli scende di uno.
        followers: person.followers + (demo.following.includes(person.id) ? 1 : 0) - (DEMO_FOLLOWING.includes(person.username) ? 1 : 0),
        following: isMe ? demo.following.length : person.following,
        covers: demo.covers.filter((cv) => demo.posts[cv.postId]?.authorId === person.id).length,
        views: Object.values(demo.posts)
          .filter((p) => p.authorId === person.id)
          .reduce((n, p) => n + postViews(demo, p), 0),
        postCount: posts.length,
        savedCount: isMe ? demo.saves.filter((id) => visible(demo, id)).length : 0,
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

/** Pagina successiva della griglia del profilo (in demo arriva già tutto con getProfile). */
export async function getProfilePosts(username: string, kind: 'posts' | 'saved', before: string): Promise<Post[]> {
  if (!isDemo) {
    const rows = await rpc<PostJson[]>('profile_posts', { p_username: username, p_kind: kind, p_before: before, p_limit: 30 });
    return rows.map(fromJson);
  }
  return [];
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
    return inOrder(`follow:${userId}`, async () => {
      const me = await uid();
      const q = on ? db().from('follows').insert({ follower_id: me, followee_id: userId }) : db().from('follows').delete().match({ follower_id: me, followee_id: userId });
      const { error } = await q;
      if (error && error.code !== '23505') throw new Error(friendlyError(error));
    });
  }
  await withDemo((demo) => {
    if (on) demoAssertCanAct(demo);
    const has = demo.following.includes(userId);
    if (on && !has) {
      demo.following.push(userId);
      bumpKey(demo, `a:${userId}`, 3);
    }
    if (!on && has) {
      demo.following = demo.following.filter((x) => x !== userId);
      bumpKey(demo, `a:${userId}`, -3);
    }
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

/** Fasi della pubblicazione: compressione dei video, caricamento dei file, creazione del post. */
export type PublishPhase = 'prepara' | 'carica' | 'conclude';

/** La pubblicazione è stata annullata prima di creare il post: i file caricati sono stati cancellati. */
export class PublishAborted extends Error {
  constructor() {
    super('Pubblicazione annullata: non è stato pubblicato niente.');
    this.name = 'PublishAborted';
  }
}

/**
 * Pubblica un post e, se richiesto, lo candida. Una volta creato il post non lancia più errori:
 * se la candidatura non riesce lo dice in `contestError`, così l'utente non ripubblica due volte.
 * onProgress: da 0 a 1 mentre si preparano e caricano i file (non torna mai indietro).
 * opts.signal: annulla finché il post non è stato creato (fase "conclude"); dopo, l'annullamento si ignora.
 */
export async function publish(
  input: NewPost,
  onProgress?: (fraction: number) => void,
  opts: { signal?: AbortSignal; onPhase?: (p: PublishPhase) => void } = {},
): Promise<PublishResult> {
  const { signal, onPhase } = opts;
  if (!input.media.length) throw new Error('Scegli almeno una foto o un video.');
  if (input.media.length > 10) throw new Error('Al massimo 10 elementi per post.');
  if (charCount(input.caption) > 300) throw new Error('La didascalia può avere al massimo 300 caratteri.');
  if (!isDemo) {
    const me = await uid();
    const media: MediaItem[] = [];
    const started: string[] = [];
    let best = 0;
    const progress = (f: number) => {
      // Mai all'indietro: il secondo tentativo di compressione o un file più piccolo non fanno scendere la barra.
      best = Math.max(best, Math.min(1, f));
      onProgress?.(best);
    };
    try {
      const n = input.media.length;
      for (const [i, m] of input.media.entries()) {
        if (signal?.aborted) throw new PublishAborted();
        media.push(await upload(me, m, i, { onFraction: (f) => progress((i + f) / n), onPhase, signal, onPath: (p) => started.push(p) }));
        if (signal?.aborted) throw new PublishAborted();
      }
    } catch (e) {
      await removePaths(started);
      if (e instanceof PublishAborted || signal?.aborted) throw new PublishAborted();
      throw new Error(friendlyError(e));
    }
    if (signal?.aborted) {
      await removePaths(started);
      throw new PublishAborted();
    }
    // Da qui il post viene creato: annullare non è più possibile.
    onPhase?.('conclude');
    const { data, error } = await db()
      .from('posts')
      .insert({
        author_id: me,
        caption: input.caption.trim(),
        media: media.map((m) => ({ kind: m.kind, url: m.src, width: m.width, height: m.height, duration_ms: m.durationMs, ...(m.poster ? { poster: m.poster } : {}) })),
      })
      .select('id')
      .single();
    if (error) {
      await removeUploads(media);
      throw new Error(friendlyError(error));
    }
    let contestError: string | null = null;
    if (input.joinContest) {
      const { error: e2 } = await db().rpc('arena_submit', { p_post_id: data.id });
      if (e2) contestError = friendlyError(e2);
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
  onPhase?.('carica');
  const media: MediaItem[] = [];
  for (const [i, m] of input.media.entries()) {
    if (signal?.aborted) throw new PublishAborted();
    media.push(await persistLocal(m));
    if (signal?.aborted) throw new PublishAborted();
    onProgress?.((i + 1) / input.media.length);
  }
  if (signal?.aborted) throw new PublishAborted();
  onPhase?.('conclude');
  return withDemo((demo) => {
    if (!demo.me) throw new Error('Crea prima il tuo profilo.');
    demoAssertCanAct(demo);
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
        if (recentWinners(demo, shiftDay(coverDay(demo.settings!.revealMinutes), 1)).includes(me.id)) throw new Error('Sei stato in copertina da poco: potrai ricandidarti tra qualche giorno.');
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

/** Cancella file appena caricati (pubblicazione annullata o fallita). Un percorso mai arrivato non dà errore. */
async function removePaths(paths: string[]) {
  if (paths.length) await db().storage.from('media').remove(paths).catch(() => undefined);
}

async function removeUploads(media: MediaItem[]) {
  const paths = media.flatMap((m) => [storagePath(m.src), m.poster ? storagePath(m.poster) : null]).filter(Boolean) as string[];
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
    const today = coverDay(demo.settings!.revealMinutes);
    // La copertina nuova prende il posto di quella visibile adesso (che dipende dall'orario di rivelazione).
    const shown = coverDay(demo.settings!.revealMinutes);
    const before = demo.covers;
    // Scalano solo le copertine già uscite: quella in attesa dell'orario di rivelazione resta dov'è.
    demo.covers = demo.covers.map((cv) => (cv.featuredOn <= shown ? { ...cv, featuredOn: shiftDay(cv.featuredOn, -1) } : cv));
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
    if (!demo.reported.some((r) => r.postId === postId)) {
      demo.reported.push({ postId, reason, at: new Date().toISOString() });
      bumpInterest(demo, postId, -8);
    }
  }, true);
}

/** Segnala un commento: per chi segnala sparisce subito; lo controlla la moderazione. */
export async function reportComment(commentId: string, reason: ReportReason, note?: string): Promise<void> {
  if (!isDemo) {
    await rpc('report_comment', { p_comment_id: commentId, p_reason: reason, p_note: note ?? null });
    return;
  }
  await withDemo((demo) => {
    const postId = Object.keys(demo.comments).find((id) => demo.comments[id].some((c) => c.id === commentId));
    const cm = postId ? demo.comments[postId].find((c) => c.id === commentId) : undefined;
    if (!cm || !postId) throw new Error('Commento non trovato.');
    if (cm.authorId === demo.me?.id) throw new Error('Non puoi segnalare un tuo commento.');
    demo.userReports ??= [];
    if (demo.userReports.some((r) => r.kind === 'comment' && r.commentId === commentId)) return;
    const who = author(demo, cm.authorId);
    demo.userReports.push({ kind: 'comment', commentId, postId, userId: cm.authorId, reason, at: new Date().toISOString(), snapshot: { body: cm.body, username: who.username } });
  }, true);
}

/** Segnala un profilo (nome, bio o foto). */
export async function reportProfile(userId: string, reason: ReportReason, note?: string): Promise<void> {
  if (!isDemo) {
    await rpc('report_profile', { p_user_id: userId, p_reason: reason, p_note: note ?? null });
    return;
  }
  await withDemo((demo) => {
    if (userId === demo.me?.id) throw new Error('Non puoi segnalare il tuo profilo.');
    const person = demo.people[userId];
    if (!person || demo.blocked.includes(userId)) throw new Error('Profilo non trovato.');
    demo.userReports ??= [];
    if (demo.userReports.some((r) => r.kind === 'profile' && r.userId === userId)) return;
    demo.userReports.push({
      kind: 'profile',
      userId,
      reason,
      at: new Date().toISOString(),
      snapshot: { username: person.username, display_name: person.displayName, bio: person.bio },
    });
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
    const rows = await rpc<AuthorJson[]>('list_blocked');
    return rows.map(authorFrom);
  }
  return withDemo((demo) => demo.blocked.map((id) => author(demo, id)));
}

/** Elimina un proprio post (e il suo posto in gara). */
export async function deletePost(postId: string): Promise<void> {
  if (!isDemo) {
    const { data, error } = await db().from('posts').delete().eq('id', postId).select('media');
    if (error) throw new Error(friendlyError(error));
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
    // Prima l'account (che mette in coda di cancellazione tutti i suoi file, foto, video e documenti):
    // se cancellassimo prima i file e poi la chiamata fallisse, resterebbe un account senza più i suoi post.
    await rpc('delete_my_account');
    await removeKey(PUSH_TOKEN_KEY);
    await db().auth.signOut({ scope: 'local' }).catch(() => undefined);
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
      for (const id of Object.keys(demo.comments)) demo.comments[id] = demo.comments[id].filter((c) => c.authorId !== authorId);
      demo.state.entries = demo.state.entries.filter((e) => e.authorId !== authorId);
    }
  }, true);
}

/** Un commento o un profilo segnalato, con il contenuto di adesso e quello al momento della segnalazione. */
export type UserReportItem = {
  kind: 'comment' | 'profile';
  target: string;
  reports: number;
  reasons: ReportReason[];
  firstAt: string;
  snapshot: { body?: string; username?: string; display_name?: string; bio?: string };
  comment: { id: string; body: string; postId: string | null } | null;
  user: { id: string; username: string; displayName: string; bio: string; avatar: string | null } | null;
};

/** Coda di moderazione dei commenti e dei profili segnalati (solo moderatori). */
export async function getUserReports(): Promise<UserReportItem[]> {
  if (!isDemo) {
    const rows = await rpc<
      {
        kind: 'comment' | 'profile';
        target: string;
        reports: number;
        reasons: ReportReason[];
        first_at: string;
        snapshot: UserReportItem['snapshot'] | null;
        comment: { id: string; body: string; post_id: string | null } | null;
        user: { id: string; username: string; display_name: string; bio: string | null; avatar_path?: string | null } | null;
      }[]
    >('mod_user_reports');
    return rows.map((r) => ({
      kind: r.kind,
      target: r.target,
      reports: Number(r.reports),
      reasons: r.reasons,
      firstAt: r.first_at,
      snapshot: r.snapshot ?? {},
      comment: r.comment ? { id: r.comment.id, body: r.comment.body, postId: r.comment.post_id } : null,
      user: r.user ? { id: r.user.id, username: r.user.username, displayName: r.user.display_name, bio: r.user.bio ?? '', avatar: avatarUrl(r.user.avatar_path) } : null,
    }));
  }
  return withDemo((demo) =>
    (demo.userReports ?? [])
      .map((r): UserReportItem | null => {
        const person = demo.people[r.userId];
        const user = person ? { id: person.id, username: person.username, displayName: person.displayName, bio: person.bio, avatar: person.avatar ?? null } : null;
        if (r.kind === 'comment') {
          const cm = r.postId ? demo.comments[r.postId]?.find((c) => c.id === r.commentId) : undefined;
          if (!cm) return null;
          return { kind: 'comment', target: cm.id, reports: 1, reasons: [r.reason], firstAt: r.at, snapshot: r.snapshot, comment: { id: cm.id, body: cm.body, postId: r.postId ?? null }, user };
        }
        if (!user) return null;
        return { kind: 'profile', target: r.userId, reports: 1, reasons: [r.reason], firstAt: r.at, snapshot: r.snapshot, comment: null, user };
      })
      .filter((x): x is UserReportItem => x !== null),
  );
}

export async function modResolveUserReport(kind: 'comment' | 'profile', target: string, action: 'dismiss' | 'remove' | 'ban'): Promise<void> {
  if (!isDemo) {
    await rpc('mod_resolve_user_report', { p_kind: kind, p_target: target, p_action: action });
    return;
  }
  await withDemo((demo) => {
    const reports = demo.userReports ?? [];
    const match = (r: DemoUserReport) => r.kind === kind && (kind === 'comment' ? r.commentId === target : r.userId === target);
    const report = reports.find(match);
    let authorId = report?.userId;
    if (kind === 'comment') {
      const postId = report?.postId ?? Object.keys(demo.comments).find((id) => demo.comments[id].some((c) => c.id === target));
      const cm = postId ? demo.comments[postId]?.find((c) => c.id === target) : undefined;
      authorId = cm?.authorId ?? authorId;
      if (action !== 'dismiss' && postId) demo.comments[postId] = demo.comments[postId].filter((c) => c.id !== target);
    } else if (action !== 'dismiss' && demo.people[target]) {
      demo.people[target].bio = '';
    }
    demo.userReports = reports.filter((r) => !match(r));
    if (action === 'ban' && authorId) {
      for (const p of Object.values(demo.posts)) if (p.authorId === authorId) delete demo.posts[p.id];
      for (const id of Object.keys(demo.comments)) demo.comments[id] = demo.comments[id].filter((c) => c.authorId !== authorId);
      demo.state.entries = demo.state.entries.filter((e) => e.authorId !== authorId);
    }
  }, true);
}

// ===========================================================================
// Stato dell'utente, verifica dell'età, amministrazione, notifiche, visualizzazioni, follower
// ===========================================================================

type StatusJson = {
  identity: { status: IdentityStatus; deadline: string; reason: string | null; can_act: boolean; submitted_at?: string | null; reviewed_at?: string | null } | null;
  is_moderator: boolean;
  is_admin: boolean;
  banned?: boolean;
  needs_private?: boolean;
  voter?: { can_vote: boolean; from: string | null } | null;
  unread: number;
  settings: {
    reveal_minutes: number;
    id_grace_days: number;
    submission_cutoff_hour: number;
    id_provider?: 'manual' | 'didit';
    contest_day?: string;
    closes_at?: string;
  };
};

export async function getStatus(): Promise<Status> {
  if (!isDemo) {
    const [r, session] = await Promise.all([rpc<StatusJson>('my_status'), db().auth.getSession()]);
    const user = session.data.session?.user;
    return {
      // Account creati con il vecchio "Entra" (anonimi): non hanno password finché non la impostano.
      needsPassword: Boolean(user && (user.is_anonymous || !user.email)),
      identity: r.identity
        ? {
            status: r.identity.status,
            deadline: r.identity.deadline,
            reason: r.identity.reason,
            canAct: r.identity.can_act,
            submittedAt: r.identity.submitted_at ?? null,
            reviewedAt: r.identity.reviewed_at ?? null,
          }
        : null,
      isModerator: r.is_moderator,
      isAdmin: r.is_admin,
      banned: Boolean(r.banned),
      needsPrivate: Boolean(r.needs_private),
      unread: Number(r.unread ?? 0),
      settings: settingsFrom(r.settings),
      voter: r.voter ? { canVote: Boolean(r.voter.can_vote), from: r.voter.from ?? null } : null,
    };
  }
  return withDemo((demo) => {
    const acc = demo.me ? demo.accounts?.[demo.me.username] : undefined;
    const id = acc?.identity;
    return {
      identity: id ? { status: id.status, deadline: id.deadline, reason: id.reason, canAct: id.status === 'approved' || Date.now() < Date.parse(id.deadline) } : null,
      isModerator: Boolean(demo.me),
      isAdmin: Boolean(demo.me),
      banned: false,
      needsPrivate: false,
      needsPassword: false,
      unread: (demo.notifications ?? []).filter((n) => !n.read && (!n.actor || !demo.blocked.includes(n.actor.id))).length,
      settings: demo.settings!,
      // Come sul server: vota chi ha l'età verificata e un account con più di 24 ore.
      voter: acc
        ? (() => {
            const from = acc.createdAt ? new Date(Date.parse(acc.createdAt) + 86400000).toISOString() : null;
            return { canVote: id?.status === 'approved' && (!from || Date.parse(from) <= Date.now()), from };
          })()
        : null,
    };
  });
}

/** Le impostazioni pubbliche (orario della copertina), anche prima di accedere. */
function settingsFrom(r: StatusJson['settings']): Settings {
  return {
    revealMinutes: r.reveal_minutes,
    idGraceDays: r.id_grace_days,
    cutoffHour: r.submission_cutoff_hour,
    idProvider: r.id_provider ?? 'manual',
    contestDay: r.contest_day,
    closesAt: r.closes_at,
  };
}

export async function getSettings(): Promise<Settings> {
  if (!isDemo) {
    const r = await rpc<StatusJson['settings']>('get_settings');
    return settingsFrom(r);
  }
  return withDemo((demo) => ({ ...DEFAULT_SETTINGS, ...demo.settings! }));
}

export async function saveSettings(revealMinutes: number, idGraceDays: number): Promise<Settings> {
  if (!Number.isInteger(revealMinutes) || revealMinutes < 0 || revealMinutes > 1439) throw new Error('Orario non valido.');
  if (!Number.isInteger(idGraceDays) || idGraceDays < 1 || idGraceDays > 60) throw new Error('I giorni per il documento vanno da 1 a 60.');
  if (!isDemo) {
    const r = await rpc<StatusJson['settings']>('admin_set_settings', { p_reveal_minutes: revealMinutes, p_id_grace_days: idGraceDays });
    return settingsFrom(r);
  }
  return withDemo((demo) => {
    demo.settings = { ...demo.settings!, revealMinutes, idGraceDays };
    return demo.settings;
  }, true);
}

/** L'amministratore sceglie come si verifica l'età: foto controllate a mano o verifica automatica (Didit). */
export async function setIdProvider(provider: Settings['idProvider']): Promise<Settings> {
  if (!isDemo) return settingsFrom(await rpc<StatusJson['settings']>('admin_set_id_provider', { p_provider: provider }));
  return withDemo((demo) => {
    demo.settings = { ...DEFAULT_SETTINGS, ...demo.settings!, idProvider: provider };
    return demo.settings;
  }, true);
}

/**
 * Errore della funzione verifica-eta spiegato: chi configura (l'amministratore) deve capire cosa sistemare
 * senza aprire i log.
 */
async function functionProblem(error: unknown): Promise<string> {
  const e = error as { name?: string; message?: string; context?: Response };
  if (e.name === 'FunctionsFetchError') return 'Non riesco a raggiungere Supabase: controlla la connessione e riprova.';
  if (e.name === 'FunctionsRelayError') return 'Supabase non riesce ad avviare la funzione verifica-eta: riprova tra poco.';
  const res = e.context;
  if (!res) return 'Il servizio di verifica non risponde. Riprova tra poco.';
  let body: { error?: string; message?: string; msg?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // risposta senza corpo leggibile
  }
  if (body.error) return body.error;
  const detail = body.message ?? body.msg ?? '';
  if (res.status === 404) return 'Su Supabase non c’è la funzione “verifica-eta” (controlla che il nome sia esattamente questo e che sia pubblicata).';
  if (res.status === 401 && /jwt|authorization/i.test(detail)) return 'Su Supabase la funzione “verifica-eta” ha ancora “Verify JWT” acceso: va spento.';
  return `Il servizio di verifica non risponde (errore ${res.status}${detail ? `: ${detail}` : ''}). Riprova tra poco.`;
}

/**
 * Verifica automatica: chiede alla funzione "verifica-eta" una sessione Didit e restituisce il link da aprire
 * nel browser. In demo non c'è nessun servizio: si simula l'esito con la data di nascita dichiarata.
 */
export async function startAgeCheck(): Promise<string | null> {
  if (!isDemo) {
    const { data, error } = await db().functions.invoke<{ url?: string; error?: string }>('verifica-eta', { body: {} });
    if (error) throw new Error(await functionProblem(error));
    if (!data?.url) throw new Error(data?.error ?? 'Il servizio di verifica non risponde. Riprova tra poco.');
    return data.url;
  }
  await withDemo((demo) => {
    const acc = demo.me ? demo.accounts?.[demo.me.username] : undefined;
    if (!acc) throw new Error('Accedi di nuovo.');
    if (acc.identity.status === 'approved') throw new Error('La tua età è già verificata.');
    const ok = ageOn(acc.birthDate) >= MIN_AGE_YEARS;
    acc.identity = { ...acc.identity, status: ok ? 'approved' : 'rejected', reason: ok ? null : `Hai meno di ${MIN_AGE_YEARS} anni.` };
    notifyDemo(demo, ok ? 'identity_ok' : 'identity_ko', null, null, ok ? {} : { reason: acc.identity.reason, final: true });
  }, true);
  return null;
}

/** Solo amministratori: prova tutto il collegamento con Didit (segreti, chiave, workflow) e dice cosa manca. */
export async function diagnoseAgeCheck(): Promise<{ ok: boolean; checks: string[] }> {
  if (isDemo) return { ok: true, checks: ['Demo: nessun servizio esterno da controllare.'] };
  const { data, error } = await db().functions.invoke<{ ok: boolean; checks: string[]; error?: string }>('verifica-eta', { body: { action: 'diagnosi' } });
  if (error) return { ok: false, checks: [`✗ ${await functionProblem(error)}`] };
  if (!data?.checks) return { ok: false, checks: [`✗ ${data?.error ?? 'Risposta inattesa dalla funzione.'}`] };
  return data;
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
      if (error) throw new Error(storageMessage(error));
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
      { user_id: string; username: string; first_name: string; last_name: string; birth_date: string; document_path: string; selfie_path: string; submitted_at: string; deadline: string; method?: 'manual' | 'didit'; provider_note?: string | null; duplicate_of?: string | null }[]
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
      method: r.method ?? 'manual',
      providerNote: r.provider_note ?? null,
      duplicateOf: r.duplicate_of ?? null,
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
        method: 'manual' as const,
        providerNote: null,
        duplicateOf: null,
      })),
  );
}

/** Decisione sul documento: poi le foto si cancellano subito. */
export async function reviewIdentity(userId: string, decision: 'approve' | 'reject' | 'underage', reason?: string, submittedAt?: string): Promise<void> {
  if (!isDemo) {
    await rpc('identity_review', { p_user_id: userId, p_decision: decision, p_reason: reason ?? null, p_submitted_at: submittedAt ?? null });
    // Il server ha messo le foto in coda per la cancellazione: le si cancella subito (se non riesce, alla prossima apertura).
    await purgeStorage().catch(() => undefined);
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
    const data = { reason: acc.identity.reason, final: decision === 'underage' };
    if (demo.me?.id === userId) notifyDemo(demo, ok ? 'identity_ok' : 'identity_ko', null, null, data);
    else {
      // L'altro account (sullo stesso dispositivo) trova la notifica al prossimo accesso.
      const item: AppNotification = { id: `n-${Date.now()}`, kind: ok ? 'identity_ok' : 'identity_ko', actor: null, post: null, data, createdAt: new Date().toISOString(), read: false };
      acc.saved = { ...(acc.saved ?? emptyUserState()), notifications: [item, ...(acc.saved?.notifications ?? [])] };
    }
  }, true);
}

type NotificationJson = {
  id: number;
  kind: NotificationKind;
  data: AppNotification['data'];
  created_at: string;
  read: boolean;
  actor: AuthorJson | null;
  post: { id: string; media: PostJson['media'] } | null;
};

export async function getNotifications(before?: { createdAt: string; id: string }): Promise<AppNotification[]> {
  if (!isDemo) {
    const rows = await rpc<NotificationJson[]>('list_notifications', { p_limit: 40, p_before: before?.createdAt ?? null, p_before_id: before ? Number(before.id) : null });
    return rows.map((n) => ({
      id: String(n.id),
      kind: n.kind,
      data: n.data ?? {},
      createdAt: n.created_at,
      read: n.read,
      actor: n.actor ? authorFrom(n.actor) : null,
      post: n.post ? { id: n.post.id, media: n.post.media.map((m) => ({ kind: m.kind, src: m.url, width: m.width, height: m.height })) } : null,
    }));
  }
  return withDemo((demo) =>
    (demo.notifications ?? []).filter((n) => (!n.actor || !demo.blocked.includes(n.actor.id)) && (!before || n.createdAt < before.createdAt)).slice(0, 40),
  );
}

export async function markNotificationsRead(upTo?: string): Promise<void> {
  if (!isDemo) {
    await rpc('mark_notifications_read', { p_up_to: upTo ?? null });
    return;
  }
  await withDemo((demo) => {
    demo.notifications = (demo.notifications ?? []).map((n) => (!upTo || n.createdAt <= upTo ? { ...n, read: true } : n));
  }, true);
}

// ---------------------------------------------------------------------------
// Notifiche push (solo app per telefono, mai nella demo): il token del telefono e le preferenze
// ---------------------------------------------------------------------------
const PUSH_TOKEN_KEY = 'virale.push.token';
export type PushPrefs = { cover: boolean; contest: boolean; social: boolean };

/** Il telefono riceve le notifiche di questo account (il token passa all'account attuale). */
export async function registerPushToken(token: string, platform: 'ios' | 'android'): Promise<void> {
  if (isDemo) return;
  await rpc('register_push_token', { p_token: token, p_platform: platform });
  await setJson(PUSH_TOKEN_KEY, token);
}

/** Prima di uscire: questo telefono smette di ricevere le notifiche dell'account. Un errore non blocca l'uscita. */
async function unregisterPushToken(): Promise<void> {
  const token = await getJson<string | null>(PUSH_TOKEN_KEY, null);
  if (!token || isDemo) return;
  await rpc('unregister_push_token', { p_token: token }).catch(() => undefined);
  await removeKey(PUSH_TOKEN_KEY);
}

export async function getPushPrefs(): Promise<PushPrefs> {
  if (isDemo) return { cover: true, contest: true, social: true };
  return rpc<PushPrefs>('get_push_prefs');
}

export async function setPushPrefs(prefs: PushPrefs): Promise<PushPrefs> {
  if (isDemo) return prefs;
  return rpc<PushPrefs>('set_push_prefs', { p_cover: prefs.cover, p_contest: prefs.contest, p_social: prefs.social });
}

/** dwellMs assente: post aperto da un link o dalla copertina, conta la vista ma non cambia i gusti. */
export type ViewItem = { postId: string; dwellMs?: number; completed?: boolean; rewatched?: boolean };

/**
 * Cosa è passato sullo schermo e per quanto: conta le visualizzazioni (da 1 secondo, una per persona al giorno)
 * e insegna i gusti (scorrere via subito abbassa, guardare fino in fondo alza). Si manda a gruppi.
 */
export async function trackViews(items: ViewItem[]): Promise<void> {
  const list = items.slice(0, 30);
  if (!list.length) return;
  if (!isDemo) {
    await rpc('track_views', {
      p_items: list.map((v) => ({
        post_id: v.postId,
        dwell_ms: v.dwellMs === undefined ? null : Math.round(v.dwellMs),
        completed: Boolean(v.completed),
        rewatched: Boolean(v.rewatched),
      })),
    });
    return;
  }
  await withDemo((demo) => {
    const today = arenaDay();
    const now = Date.now();
    demo.seen ??= {};
    for (const v of list) {
      const p = demo.posts[v.postId];
      if (!p || p.authorId === demo.me?.id) continue;
      demo.seen[p.id] = now;
      const d = v.dwellMs;
      if (d !== undefined) bumpInterest(demo, p.id, v.rewatched ? 1.2 : v.completed ? 0.7 : d >= 6000 ? 0.5 : d >= 2500 ? 0.2 : d < 1200 ? -0.4 : 0);
      const key = `${today}:${p.id}`;
      if ((d !== undefined && d < 1000) || demo.viewed!.includes(key)) continue;
      p.views = (p.views ?? (p.authorId.startsWith('me-') ? 0 : p.likes * 9 + (hash(p.id) % 400))) + 1;
      demo.viewed!.push(key);
    }
    demo.viewed = demo.viewed!.filter((k) => k.startsWith(today));
    for (const [id, at] of Object.entries(demo.seen)) if (now - at > 30 * 86400000) delete demo.seen[id];
  }, true);
}

export async function listFollows(username: string, kind: 'followers' | 'following', before?: string): Promise<FollowRow[]> {
  if (!isDemo) {
    const rows = await rpc<(AuthorJson & { followed: boolean; is_me: boolean; cursor?: string })[]>('list_follows', {
      p_username: username,
      p_kind: kind,
      p_limit: 50,
      p_before: before ?? null,
    });
    return rows.map((r) => ({ ...authorFrom(r), followedByMe: r.followed, isMe: r.is_me, cursor: r.cursor }));
  }
  // In demo l'elenco arriva tutto alla prima pagina.
  if (before) return [];
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
      return (demo.fans ?? []).filter((id) => !demo.blocked.includes(id)).map(row);
    }
    const sample = COMMENTERS.filter((_, i) => (hash(person.username) + i) % 2 === 0).map((n) => `demo-${n}`);
    if (demo.following.includes(person.id) && demo.me) sample.unshift(demo.me.id);
    return sample.filter((id) => !demo.blocked.includes(id)).map(row);
  });
}

/** Cerca persone per @nome o per nome (dall'inizio): solo profili, la gara resta alla cieca. Da 2 caratteri. */
export async function searchProfiles(query: string): Promise<FollowRow[]> {
  const q = query.trim().toLowerCase().replace(/^@+/, '').slice(0, 30);
  if (charCount(q) < 2) return [];
  if (!isDemo) {
    const rows = await rpc<(AuthorJson & { followed: boolean })[]>('search_profiles', { p_query: q, p_limit: 20 });
    return rows.map((r) => ({ ...authorFrom(r), followedByMe: r.followed, isMe: false }));
  }
  return withDemo((demo) => {
    const fans = (id: string) => demo.people[id]?.followers ?? 0;
    return Object.values(demo.people)
      .filter((p) => p.id !== demo.me?.id && !demo.blocked.includes(p.id) && (p.username.startsWith(q) || p.displayName.toLowerCase().startsWith(q)))
      .sort((a, b) => Number(b.username === q) - Number(a.username === q) || Number(b.username.startsWith(q)) - Number(a.username.startsWith(q)) || fans(b.id) - fans(a.id) || a.username.localeCompare(b.username))
      .slice(0, 20)
      .map((p) => ({ ...author(demo, p.id), followedByMe: demo.following.includes(p.id), isMe: false }));
  });
}

/**
 * Cancella i file in coda (documenti dopo la decisione, media di post rimossi o di account chiusi, foto
 * profilo cambiate). Di norma lo fa ogni minuto il lavoro programmato (funzione verifica-eta, /lavori);
 * l'app dell'amministratore lo fa anche lei, così funziona pure se il lavoro non è ancora configurato.
 */
export async function purgeStorage(): Promise<number> {
  if (isDemo) return 0;
  const rows = await rpc<{ bucket: 'media' | 'documenti' | 'avatars'; path: string }[]>('storage_purge_list', { p_limit: 500 });
  let done = 0;
  for (const bucket of ['documenti', 'media', 'avatars'] as const) {
    const paths = rows.filter((r) => r.bucket === bucket).map((r) => r.path);
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error } = await db().storage.from(bucket).remove(chunk);
      if (error) throw new Error(`Pulizia dei file non riuscita: ${friendlyError(error)}`);
      await rpc('storage_purge_done', { p_bucket: bucket, p_paths: chunk });
      done += chunk.length;
    }
  }
  return done;
}

/** Per chi si era iscritto prima: nome, cognome e data di nascita, necessari per verificare l'età. */
export async function completePrivateData(firstName: string, lastName: string, birthDate: string): Promise<void> {
  const problem = validateRegistration({ username: 'utente', firstName, lastName, birthDate, password: 'a1aaaaaaaa', acceptedTerms: true });
  if (problem) throw new Error(problem.message);
  if (!isDemo) {
    await rpc('complete_private_data', { p_first_name: firstName.trim(), p_last_name: lastName.trim(), p_birth_date: birthDate });
    return;
  }
}
