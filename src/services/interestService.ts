import { isSupabaseConfigured, supabase } from '@/src/lib/supabase';
import { STORAGE_KEYS } from '@/src/services/storageKeys';
import { getStoredJson, setStoredJson } from '@/src/services/storage';

export async function getUserInterests(userId: string): Promise<string[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from('user_interests')
      .select('interest')
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    return data?.map((d) => d.interest) ?? [];
  }
  const all = await getStoredJson<Record<string, string[]>>(STORAGE_KEYS.userInterests, {});
  return all[userId] ?? [];
}

export async function saveUserInterests(userId: string, interests: string[]): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error: deleteError } = await supabase.from('user_interests').delete().eq('user_id', userId);
    if (deleteError) throw new Error(deleteError.message);
    if (!interests.length) return;
    const { error } = await supabase
      .from('user_interests')
      .insert(interests.map((interest) => ({ user_id: userId, interest })));
    if (error) throw new Error(error.message);
    return;
  }

  const all = await getStoredJson<Record<string, string[]>>(STORAGE_KEYS.userInterests, {});
  all[userId] = interests;
  await setStoredJson(STORAGE_KEYS.userInterests, all);
}
