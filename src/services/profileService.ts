import { demoProfile } from '@/src/data/mockSocialData';
import { isSupabaseConfigured, supabase } from '@/src/lib/supabase';
import type { UserProfile } from '@/src/types';

export async function getProfileByUserId(userId: string): Promise<UserProfile | null> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      id: data.id,
      username: data.username,
      displayName: data.display_name,
      avatarUrl: data.avatar_url,
      bio: data.bio,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
  return { ...demoProfile, id: userId };
}

export async function createProfile(input: {
  id: string;
  username: string;
  displayName: string;
}): Promise<UserProfile> {
  if (isSupabaseConfigured && supabase) {
    const now = new Date().toISOString();
    const { error } = await supabase.from('profiles').upsert({
      id: input.id,
      username: input.username.toLowerCase(),
      display_name: input.displayName,
      created_at: now,
      updated_at: now,
    });
    if (error) throw new Error(error.message);
  }
  return {
    id: input.id,
    username: input.username.toLowerCase(),
    displayName: input.displayName,
    avatarUrl: null,
    bio: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function updateProfile(
  userId: string,
  patch: Partial<Pick<UserProfile, 'displayName' | 'username' | 'bio' | 'avatarUrl'>>,
): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: patch.displayName,
        username: patch.username?.toLowerCase(),
        bio: patch.bio,
        avatar_url: patch.avatarUrl,
      })
      .eq('id', userId);
    if (error) throw new Error(error.message);
  }
}
