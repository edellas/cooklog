import { demoProfile } from '@/src/data/mockSocialData';
import { isSupabaseConfigured, supabase } from '@/src/lib/supabase';
import { STORAGE_KEYS } from '@/src/services/storageKeys';
import { getStoredJson, setStoredJson } from '@/src/services/storage';
import type { AppUser, UserProfile } from '@/src/types';

type RegisterInput = {
  email: string;
  password: string;
  username: string;
  displayName: string;
};

type LoginInput = {
  email: string;
  password: string;
};

export async function getCurrentUser(): Promise<AppUser | null> {
  if (isSupabaseConfigured && supabase) {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) return null;
    return { id: data.session.user.id, email: data.session.user.email ?? '' };
  }
  return getStoredJson<AppUser | null>(STORAGE_KEYS.authDemoUser, null);
}

export async function login(input: LoginInput): Promise<AppUser> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.auth.signInWithPassword(input);
    if (error || !data.user) throw new Error(error?.message ?? 'Login fallito');
    return { id: data.user.id, email: data.user.email ?? input.email };
  }

  const demoUser: AppUser = { id: demoProfile.id, email: input.email };
  await setStoredJson(STORAGE_KEYS.authDemoUser, demoUser);
  return demoUser;
}

export async function register(input: RegisterInput): Promise<AppUser> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { username: input.username, display_name: input.displayName } },
    });
    if (error || !data.user) throw new Error(error?.message ?? 'Registrazione fallita');
    return { id: data.user.id, email: data.user.email ?? input.email };
  }

  const demoUser: AppUser = { id: demoProfile.id, email: input.email };
  await setStoredJson(STORAGE_KEYS.authDemoUser, demoUser);
  return demoUser;
}

export async function logout(): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    await supabase.auth.signOut();
    return;
  }
  await setStoredJson(STORAGE_KEYS.authDemoUser, null);
}

export async function getDemoProfileFallback(): Promise<UserProfile> {
  return demoProfile;
}
