import { mockCommentsByPostId } from '@/src/data/mockSocialData';
import { isSupabaseConfigured, supabase } from '@/src/lib/supabase';
import { STORAGE_KEYS } from '@/src/services/storageKeys';
import { getStoredJson, setStoredJson } from '@/src/services/storage';
import type { Comment } from '@/src/types';

function newId() {
  return `comment-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export async function getComments(postId: string): Promise<Comment[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from('comments')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((c) => ({
      id: c.id,
      postId: c.post_id,
      userId: c.user_id,
      authorName: 'Utente',
      authorAvatarUrl: null,
      body: c.body,
      createdAt: c.created_at,
    }));
  }
  const store = await getStoredJson<Record<string, Comment[]>>(STORAGE_KEYS.comments, mockCommentsByPostId);
  return store[postId] ?? [];
}

export async function addComment(input: {
  postId: string;
  userId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
}): Promise<Comment> {
  const next: Comment = {
    id: newId(),
    postId: input.postId,
    userId: input.userId,
    authorName: input.authorName,
    authorAvatarUrl: input.authorAvatarUrl,
    body: input.body,
    createdAt: new Date().toISOString(),
  };

  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from('comments').insert({
      id: next.id,
      post_id: next.postId,
      user_id: next.userId,
      body: next.body,
    });
    if (error) throw new Error(error.message);
    return next;
  }

  const store = await getStoredJson<Record<string, Comment[]>>(STORAGE_KEYS.comments, mockCommentsByPostId);
  const list = store[input.postId] ?? [];
  store[input.postId] = [...list, next];
  await setStoredJson(STORAGE_KEYS.comments, store);
  return next;
}

export async function deleteComment(postId: string, commentId: string, userId: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from('comments').delete().eq('id', commentId).eq('user_id', userId);
    if (error) throw new Error(error.message);
    return;
  }
  const store = await getStoredJson<Record<string, Comment[]>>(STORAGE_KEYS.comments, mockCommentsByPostId);
  store[postId] = (store[postId] ?? []).filter((c) => c.id !== commentId || c.userId !== userId);
  await setStoredJson(STORAGE_KEYS.comments, store);
}
