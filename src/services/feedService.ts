import { mockFeedPosts } from '@/src/data/mockSocialData';
import { isSupabaseConfigured, supabase } from '@/src/lib/supabase';
import { STORAGE_KEYS } from '@/src/services/storageKeys';
import { getStoredJson, setStoredJson } from '@/src/services/storage';
import type { FoodPost } from '@/src/types';

function rankPosts(posts: FoodPost[], interests: string[], seenIds: Set<string>): FoodPost[] {
  if (!interests.length) {
    return [...posts].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  }

  return [...posts].sort((a, b) => score(b) - score(a));

  function score(post: FoodPost): number {
    const interestMatchCount = post.interests.filter((i) => interests.includes(i)).length;
    const ageHours = Math.max(1, (Date.now() - +new Date(post.createdAt)) / (1000 * 60 * 60));
    const recencyScore = Math.max(0, 50 - ageHours);
    const alreadySeenPenalty = seenIds.has(post.id) ? 15 : 0;
    return (
      interestMatchCount * 100 +
      post.saveCount * 5 +
      post.likeCount * 2 +
      post.commentCount * 3 +
      recencyScore -
      alreadySeenPenalty
    );
  }
}

export async function loadFeed(input: {
  currentUserId: string;
  interests: string[];
  page: number;
  pageSize: number;
  seenPostIds: string[];
}): Promise<{ items: FoodPost[]; hasMore: boolean }> {
  const allPosts = await getAllFeedPosts(input.currentUserId);
  const ranked = rankPosts(allPosts, input.interests, new Set(input.seenPostIds));
  const start = input.page * input.pageSize;
  const end = start + input.pageSize;
  return { items: ranked.slice(start, end), hasMore: end < ranked.length };
}

export async function getAllFeedPosts(currentUserId: string): Promise<FoodPost[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from('food_posts')
      .select('*')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    if (!data?.length) return getAllFeedPostsFallback(currentUserId);
    return data.map((row) => ({
      id: row.id,
      authorId: row.author_id,
      authorName: 'Utente',
      authorAvatarUrl: null,
      title: row.title,
      description: row.description ?? '',
      mediaUrl: row.media_url,
      mediaType: row.media_type,
      recipeId: row.recipe_id,
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
      updatedAt: row.updated_at,
    }));
  }
  return getAllFeedPostsFallback(currentUserId);
}

async function getAllFeedPostsFallback(currentUserId: string): Promise<FoodPost[]> {
  const liked = await getStoredJson<Record<string, string[]>>(STORAGE_KEYS.likedPosts, {});
  const saved = await getStoredJson<Record<string, string[]>>(STORAGE_KEYS.savedPosts, {});
  const localPosted = await getStoredJson<FoodPost[]>(STORAGE_KEYS.feedPosts, []);
  const merged = [...localPosted, ...mockFeedPosts];
  const deduped = Array.from(new Map(merged.map((post) => [post.id, post])).values());
  return deduped.map((post) => ({
    ...post,
    isLikedByCurrentUser: (liked[currentUserId] ?? []).includes(post.id),
    isSavedByCurrentUser: (saved[currentUserId] ?? []).includes(post.id),
  }));
}

export async function toggleLike(post: FoodPost, userId: string): Promise<FoodPost> {
  if (isSupabaseConfigured && supabase) {
    // MVP: optimistic local toggle; counters server-side in future SQL funcs.
  }
  const liked = await getStoredJson<Record<string, string[]>>(STORAGE_KEYS.likedPosts, {});
  const current = new Set(liked[userId] ?? []);
  const isLiked = current.has(post.id);
  if (isLiked) current.delete(post.id);
  else current.add(post.id);
  liked[userId] = [...current];
  await setStoredJson(STORAGE_KEYS.likedPosts, liked);
  return {
    ...post,
    isLikedByCurrentUser: !isLiked,
    likeCount: Math.max(0, post.likeCount + (isLiked ? -1 : 1)),
  };
}

export async function toggleSave(post: FoodPost, userId: string): Promise<FoodPost> {
  const saved = await getStoredJson<Record<string, string[]>>(STORAGE_KEYS.savedPosts, {});
  const current = new Set(saved[userId] ?? []);
  const isSaved = current.has(post.id);
  if (isSaved) current.delete(post.id);
  else current.add(post.id);
  saved[userId] = [...current];
  await setStoredJson(STORAGE_KEYS.savedPosts, saved);
  return {
    ...post,
    isSavedByCurrentUser: !isSaved,
    saveCount: Math.max(0, post.saveCount + (isSaved ? -1 : 1)),
  };
}
