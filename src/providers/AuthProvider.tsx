import {
  getCurrentUser,
  getDemoProfileFallback,
  login as loginService,
  logout as logoutService,
  register as registerService,
} from '@/src/services/authService';
import { getProfileByUserId, createProfile, updateProfile } from '@/src/services/profileService';
import { getUserInterests, saveUserInterests } from '@/src/services/interestService';
import { isSupabaseConfigured } from '@/src/lib/supabase';
import type { AppUser, UserProfile } from '@/src/types';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type AuthContextValue = {
  isReady: boolean;
  isSupabaseConfigured: boolean;
  isDemoMode: boolean;
  user: AppUser | null;
  profile: UserProfile | null;
  interests: string[];
  authError: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    username: string;
    displayName: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  saveInterests: (next: string[]) => Promise<void>;
  updateProfile: (
    patch: Partial<Pick<UserProfile, 'displayName' | 'username' | 'bio' | 'avatarUrl'>>,
  ) => Promise<void>;
  enableDemoMode: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [user, setUser] = useState<AppUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [authError, setAuthError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setAuthError(null);
    const current = await getCurrentUser();
    setUser(current);
    if (!current) {
      setProfile(null);
      setInterests([]);
      setIsReady(true);
      return;
    }
    const loadedProfile = (await getProfileByUserId(current.id)) ?? (await getDemoProfileFallback());
    const loadedInterests = await getUserInterests(current.id);
    setProfile(loadedProfile);
    setInterests(loadedInterests);
    setIsReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      setAuthError(null);
      await loginService({ email, password });
      await refresh();
    } catch {
      setAuthError('Credenziali non valide. Controlla email e password.');
      throw new Error('Login fallito');
    }
  }, [refresh]);

  const register = useCallback(
    async (input: { email: string; password: string; username: string; displayName: string }) => {
      try {
        setAuthError(null);
        const nextUser = await registerService(input);
        await createProfile({
          id: nextUser.id,
          username: input.username,
          displayName: input.displayName,
        });
        await refresh();
      } catch {
        setAuthError('Registrazione non completata. Verifica i dati inseriti.');
        throw new Error('Register fallito');
      }
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await logoutService();
    await refresh();
  }, [refresh]);

  const saveInterestsHandler = useCallback(
    async (next: string[]) => {
      if (!user) return;
      await saveUserInterests(user.id, next);
      setInterests(next);
    },
    [user],
  );

  const updateProfileHandler = useCallback(
    async (
      patch: Partial<Pick<UserProfile, 'displayName' | 'username' | 'bio' | 'avatarUrl'>>,
    ) => {
      if (!user || !profile) return;
      await updateProfile(user.id, patch);
      setProfile((prev) => (prev ? { ...prev, ...patch, updatedAt: new Date().toISOString() } : prev));
    },
    [profile, user],
  );

  const enableDemoMode = useCallback(async () => {
    const demo = await loginService({ email: 'demo@cooklog.app', password: 'demo-mode' });
    setIsDemoMode(true);
    setUser(demo);
    const loadedProfile = await getDemoProfileFallback();
    setProfile(loadedProfile);
    const loadedInterests = await getUserInterests(demo.id);
    if (!loadedInterests.length) {
      await saveUserInterests(demo.id, ['Cucina italiana', 'Pasta', 'Comfort food']);
      setInterests(['Cucina italiana', 'Pasta', 'Comfort food']);
    } else {
      setInterests(loadedInterests);
    }
    setIsReady(true);
  }, []);

  const value = useMemo(
    () => ({
      isReady,
      isSupabaseConfigured,
      isDemoMode,
      user,
      profile,
      interests,
      authError,
      login,
      register,
      logout,
      saveInterests: saveInterestsHandler,
      updateProfile: updateProfileHandler,
      enableDemoMode,
      refresh,
    }),
    [
      isReady,
      isDemoMode,
      user,
      profile,
      interests,
      authError,
      login,
      register,
      logout,
      saveInterestsHandler,
      updateProfileHandler,
      enableDemoMode,
      refresh,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve essere usato dentro AuthProvider');
  return ctx;
}
