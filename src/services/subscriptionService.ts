import { STORAGE_KEYS } from '@/src/services/storageKeys';
import { getStoredJson, setStoredJson } from '@/src/services/storage';
import type { SubscriptionStatus } from '@/src/types';

const FREE_LIMITS = {
  maxAiGenerations: 10,
  maxSavedRecipes: 20,
};

export async function getSubscriptionStatus(userId: string): Promise<SubscriptionStatus> {
  const all = await getStoredJson<Record<string, SubscriptionStatus>>(STORAGE_KEYS.subscription, {});
  return (
    all[userId] ?? {
      isPro: false,
      plan: 'free',
      aiGenerationsUsedThisMonth: 0,
      maxAiGenerations: FREE_LIMITS.maxAiGenerations,
      savedRecipesCount: 0,
      maxSavedRecipes: FREE_LIMITS.maxSavedRecipes,
    }
  );
}

export async function upgradeToProMock(userId: string, plan: 'pro-monthly' | 'pro-yearly'): Promise<void> {
  const all = await getStoredJson<Record<string, SubscriptionStatus>>(STORAGE_KEYS.subscription, {});
  all[userId] = {
    isPro: true,
    plan,
    aiGenerationsUsedThisMonth: 0,
    maxAiGenerations: 9999,
    savedRecipesCount: all[userId]?.savedRecipesCount ?? 0,
    maxSavedRecipes: 9999,
  };
  await setStoredJson(STORAGE_KEYS.subscription, all);
}

export async function incrementAiUsage(userId: string): Promise<void> {
  const status = await getSubscriptionStatus(userId);
  if (!status.isPro && status.aiGenerationsUsedThisMonth >= status.maxAiGenerations) {
    throw new Error('Limite mensile generazioni AI raggiunto.');
  }
  const all = await getStoredJson<Record<string, SubscriptionStatus>>(STORAGE_KEYS.subscription, {});
  all[userId] = { ...status, aiGenerationsUsedThisMonth: status.aiGenerationsUsedThisMonth + 1 };
  await setStoredJson(STORAGE_KEYS.subscription, all);
}

export async function setSavedRecipesCount(userId: string, count: number): Promise<void> {
  const status = await getSubscriptionStatus(userId);
  const all = await getStoredJson<Record<string, SubscriptionStatus>>(STORAGE_KEYS.subscription, {});
  all[userId] = { ...status, savedRecipesCount: count };
  await setStoredJson(STORAGE_KEYS.subscription, all);
}
