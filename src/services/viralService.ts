import { mockFeedPosts } from '@/src/data/mockSocialData';
import { isSupabaseConfigured, supabase } from '@/src/lib/supabase';
import { getStoredJson, setStoredJson } from '@/src/services/storage';
import { STORAGE_KEYS } from '@/src/services/storageKeys';
import type { FoodPost } from '@/src/types';
import {
  arenaDay,
  closeArena,
  createArenaState,
  DEFAULT_ARENA_CONFIG,
  recordView,
  seededRng,
  serveBatch,
  shiftDay,
  simulateCrowd,
  submitEntry,
  type ArenaEntry,
  type ArenaState,
  type EntryStatus,
  type ViewSignal,
} from '@/src/viral/engine';

export type ArenaCard = { entryId: string; tier: number; post: FoodPost };

export type DailyViral = {
  featuredOn: string;
  contestDay: string;
  totalEntries: number;
  totalViews: number;
  post: FoodPost;
};

export type MyArenaEntry = {
  entryId: string;
  postId: string;
  tier: number;
  status: EntryStatus;
  views: number;
  contestDay: string;
};

export const ARENA_TIER_COUNT = DEFAULT_ARENA_CONFIG.tierThresholds.length;

/** Modalità locale: Supabase non configurato, l'Arena gira sul dispositivo con un pubblico simulato. */
export const isLocalArena = !isSupabaseConfigured;

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

type PostRow = {
  post_id: string;
  author_id: string;
  author_name: string | null;
  author_avatar_url: string | null;
  title: string;
  description: string | null;
  media_url: string;
  media_type: string | null;
  category: string;
  interests: string[] | null;
  cooking_time_minutes: number | null;
  servings: number | null;
  recipe_id: string | null;
  like_count?: number | null;
  comment_count?: number | null;
  save_count?: number | null;
  created_at: string;
};

function rowToPost(row: PostRow): FoodPost {
  return {
    id: row.post_id,
    authorId: row.author_id,
    authorName: row.author_name ?? 'Utente',
    authorAvatarUrl: row.author_avatar_url,
    title: row.title,
    description: row.description ?? '',
    mediaUrl: row.media_url,
    mediaType: row.media_type === 'video' ? 'video' : 'image',
    recipeId: row.recipe_id ?? undefined,
    category: row.category,
    interests: row.interests ?? [],
    cookingTimeMinutes: row.cooking_time_minutes ?? 0,
    servings: row.servings ?? 1,
    likeCount: row.like_count ?? 0,
    commentCount: row.comment_count ?? 0,
    saveCount: row.save_count ?? 0,
    isLikedByCurrentUser: false,
    isSavedByCurrentUser: false,
    createdAt: row.created_at,
    updatedAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Locale (demo)
// ---------------------------------------------------------------------------

type LocalArena = {
  state: ArenaState;
  posts: Record<string, FoodPost>;
  virals: DailyViral[];
  winners: { authorId: string; featuredOn: string }[];
};

function hashDay(day: string): number {
  return day.split('').reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
}

/** Popola una giornata con i piatti demo e fa passare un pubblico simulato. */
function seedLocalDay(day: string, posts: Record<string, FoodPost>): ArenaState {
  const rng = seededRng(hashDay(day));
  const state = createArenaState(day);
  const quality = new Map<string, number>();
  mockFeedPosts.forEach((post, idx) => {
    const entryId = `entry-${day}-${post.id}`;
    // Ogni piatto demo ha un autore "di folla" distinto (regola: un piatto per autore al giorno).
    submitEntry(state, {
      id: entryId,
      postId: post.id,
      authorId: `crowd-author-${post.id}`,
      createdAt: new Date(Date.parse(`${day}T06:00:00Z`) + idx * 60000).toISOString(),
    });
    posts[post.id] = { ...post, authorId: `crowd-author-${post.id}` };
    quality.set(entryId, rng() ** 1.3);
  });
  simulateCrowd(
    state,
    { quality: (id) => quality.get(id) ?? 0.3, viewers: 60, viewsPerViewer: 8, viewerPrefix: `crowd-${day}-`, forgetViewers: true },
    rng,
  );
  return state;
}

function closeLocalDay(arena: LocalArena): void {
  const { state } = arena;
  const featuredOn = shiftDay(state.day, 1);
  const cooldownStart = shiftDay(featuredOn, -DEFAULT_ARENA_CONFIG.winnerCooldownDays);
  const recent = arena.winners.filter((w) => w.featuredOn > cooldownStart).map((w) => w.authorId);
  const winner = closeArena(state, recent);
  if (!winner || arena.virals.some((v) => v.featuredOn === featuredOn)) return;
  const post = arena.posts[winner.postId];
  if (!post) return;
  arena.virals = [
    {
      featuredOn,
      contestDay: state.day,
      totalEntries: state.entries.length,
      totalViews: state.entries.reduce((sum, e) => sum + e.stats.views, 0),
      post,
    },
    ...arena.virals,
  ].slice(0, 30);
  arena.winners = [{ authorId: winner.authorId, featuredOn }, ...arena.winners].slice(0, 60);
}

// Le operazioni locali sono read-modify-write su AsyncStorage: le serializziamo
// (es. una vista registrata mentre si carica il batch successivo).
let localQueue: Promise<unknown> = Promise.resolve();
function withLocalArena<T>(fn: (arena: LocalArena) => T | Promise<T>): Promise<T> {
  const run = localQueue.then(async () => fn(await loadLocalArena()));
  localQueue = run.catch(() => undefined);
  return run;
}

async function loadLocalArena(): Promise<LocalArena> {
  const today = arenaDay();
  const stored = await getStoredJson<LocalArena | null>(STORAGE_KEYS.arena, null);
  let arena: LocalArena = stored ?? { state: createArenaState(''), posts: {}, virals: [], winners: [] };

  if (arena.state.day !== today) {
    if (arena.state.day) closeLocalDay(arena);
    if (!arena.virals.some((v) => v.featuredOn === today)) {
      // Primo avvio (o app non aperta ieri): il pubblico simulato ha giocato la gara di ieri,
      // così il feed ha già il suo "virale di oggi".
      arena.state = seedLocalDay(shiftDay(today, -1), arena.posts);
      closeLocalDay(arena);
    }
    arena = { ...arena, state: seedLocalDay(today, arena.posts) };
    await setStoredJson(STORAGE_KEYS.arena, arena);
  }
  return arena;
}

function entryToCard(arena: LocalArena, entry: ArenaEntry): ArenaCard | null {
  const post = arena.posts[entry.postId];
  return post ? { entryId: entry.id, tier: entry.tier, post } : null;
}

// ---------------------------------------------------------------------------
// API pubblica
// ---------------------------------------------------------------------------

export async function getDailyViral(): Promise<DailyViral | null> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc('get_daily_viral');
    if (error) throw new Error(error.message);
    const row = (data as (PostRow & { featured_on: string; contest_day: string; total_entries: number; total_views: number })[] | null)?.[0];
    if (!row) return null;
    return {
      featuredOn: row.featured_on,
      contestDay: row.contest_day,
      totalEntries: row.total_entries,
      totalViews: Number(row.total_views),
      post: rowToPost(row),
    };
  }
  return withLocalArena((arena) => arena.virals.find((v) => v.featuredOn === arenaDay()) ?? null);
}

export async function getArenaBatch(userId: string, limit = 10): Promise<ArenaCard[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc('arena_next_batch', { p_limit: limit });
    if (error) throw new Error(error.message);
    return ((data ?? []) as (PostRow & { entry_id: string; tier: number })[]).map((row) => ({
      entryId: row.entry_id,
      tier: row.tier,
      post: rowToPost(row),
    }));
  }
  return withLocalArena(async (arena) => {
    const batch = serveBatch(arena.state, userId, limit);
    await setStoredJson(STORAGE_KEYS.arena, arena);
    return batch.map((e) => entryToCard(arena, e)).filter((x): x is ArenaCard => x !== null);
  });
}

export async function recordArenaView(userId: string, entryId: string, signal: ViewSignal): Promise<boolean> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc('arena_record_view', {
      p_entry_id: entryId,
      p_dwell_ms: Math.round(signal.dwellMs),
      p_liked: Boolean(signal.liked),
      p_saved: Boolean(signal.saved),
      p_shared: Boolean(signal.shared),
      p_reported: Boolean(signal.reported),
    });
    if (error) throw new Error(error.message);
    return Boolean(data);
  }
  return withLocalArena(async (arena) => {
    const { accepted } = recordView(arena.state, userId, entryId, signal);
    if (accepted) await setStoredJson(STORAGE_KEYS.arena, arena);
    return accepted;
  });
}

/** Candida un piatto all'Arena di oggi (uno al giorno per utente). */
export async function submitToArena(userId: string, post: FoodPost): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { data: inserted, error: insertError } = await supabase
      .from('food_posts')
      .insert({
        author_id: userId,
        title: post.title,
        description: post.description,
        media_url: post.mediaUrl,
        media_type: post.mediaType,
        category: post.category,
        cooking_time_minutes: post.cookingTimeMinutes,
        servings: post.servings,
        interests: post.interests,
        is_public: true,
      })
      .select('id')
      .single();
    if (insertError) throw new Error(insertError.message);
    const { error } = await supabase.rpc('arena_submit', { p_post_id: inserted.id });
    if (error) throw new Error(error.message);
    return;
  }
  await withLocalArena(async (arena) => {
    const blocked = arena.winners.some(
      (w) => w.authorId === userId && w.featuredOn > shiftDay(arenaDay(), -DEFAULT_ARENA_CONFIG.winnerCooldownDays),
    );
    if (blocked) throw new Error('Hai già vinto di recente: potrai ripartecipare tra qualche giorno.');
    submitEntry(arena.state, { id: `entry-${arena.state.day}-${post.id}`, postId: post.id, authorId: userId });
    arena.posts[post.id] = post;
    await setStoredJson(STORAGE_KEYS.arena, arena);
  });
}

export async function getMyArenaEntry(userId: string): Promise<MyArenaEntry | null> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc('arena_my_entry');
    if (error) throw new Error(error.message);
    const row = (data as { entry_id: string; post_id: string; tier: number; status: EntryStatus; views: number; contest_day: string }[] | null)?.[0];
    return row
      ? { entryId: row.entry_id, postId: row.post_id, tier: row.tier, status: row.status, views: row.views, contestDay: row.contest_day }
      : null;
  }
  return withLocalArena((arena) => {
    const entry = arena.state.entries.find((e) => e.authorId === userId);
    return entry
      ? { entryId: entry.id, postId: entry.postId, tier: entry.tier, status: entry.status, views: entry.stats.views, contestDay: entry.contestDay }
      : null;
  });
}

/**
 * Solo demo locale: fa passare altro pubblico simulato, chiude la giornata e mette subito
 * in evidenza il vincitore (in produzione lo fa pg_cron a mezzanotte e appare il giorno dopo).
 */
export async function closeArenaNowDemo(): Promise<DailyViral | null> {
  if (!isLocalArena) throw new Error('Disponibile solo in modalità demo.');
  return withLocalArena(async (arena) => {
    const rng = seededRng(Date.now() >>> 0);
    // Qualità nascosta uguale per tutti, anche per il piatto dell'utente: nessun favoritismo.
    const quality = new Map(arena.state.entries.map((e) => [e.id, rng() ** 1.3]));
    simulateCrowd(
      arena.state,
      { quality: (id) => quality.get(id) ?? 0.3, viewers: 120, viewsPerViewer: 8, viewerPrefix: `crowd-close-${Date.now()}-`, forgetViewers: true },
      rng,
    );
    closeLocalDay(arena);
    const viral = arena.virals.find((v) => v.featuredOn === shiftDay(arena.state.day, 1)) ?? null;
    const today = arenaDay();
    if (viral) {
      viral.featuredOn = today;
      arena.virals = [viral, ...arena.virals.filter((v) => v !== viral && v.featuredOn !== today)];
    }
    // Riapre una nuova giornata di gara con i piatti demo.
    arena.state = seedLocalDay(today, arena.posts);
    await setStoredJson(STORAGE_KEYS.arena, arena);
    return viral;
  });
}

export function describeTier(entry: Pick<MyArenaEntry, 'tier' | 'status' | 'views'>): string {
  if (entry.status === 'disqualified') return 'Squalificato per segnalazioni';
  if (entry.status === 'finalist') return `In finale · ${entry.views} viste`;
  const next = DEFAULT_ARENA_CONFIG.tierThresholds[entry.tier];
  if (entry.status === 'parked') return `Fermo al livello ${entry.tier + 1} · ${entry.views} viste`;
  return `Livello ${entry.tier + 1} di ${ARENA_TIER_COUNT} · ${entry.views}/${next} viste`;
}
