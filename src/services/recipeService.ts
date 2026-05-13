import { mockRecipesFromPosts } from '@/src/data/mockSocialData';
import { isSupabaseConfigured, supabase } from '@/src/lib/supabase';
import { STORAGE_KEYS } from '@/src/services/storageKeys';
import { getStoredJson, setStoredJson } from '@/src/services/storage';
import type { Recipe } from '@/src/types';

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export async function loadRecipesForUser(userId: string): Promise<Recipe[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from('recipes').select('*').eq('owner_id', userId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id,
      ownerId: r.owner_id,
      sourcePostId: r.source_post_id ?? undefined,
      title: r.title,
      description: r.description ?? '',
      imageUrl: r.image_url ?? '',
      category: r.category,
      cookingTimeMinutes: r.cooking_time_minutes ?? 0,
      servings: r.servings ?? 1,
      ingredients: [],
      steps: [],
      personalNotes: r.personal_notes ?? '',
      isPrivate: r.is_private ?? false,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  const all = await getStoredJson<Record<string, Recipe[]>>(STORAGE_KEYS.recipes, {});
  if (!all[userId]) {
    all[userId] = mockRecipesFromPosts.filter((r) => r.ownerId === userId);
    await setStoredJson(STORAGE_KEYS.recipes, all);
  }
  return all[userId];
}

export async function saveRecipe(userId: string, recipe: Recipe): Promise<Recipe> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from('recipes').upsert({
      id: recipe.id,
      owner_id: userId,
      source_post_id: recipe.sourcePostId ?? null,
      title: recipe.title,
      description: recipe.description,
      image_url: recipe.imageUrl,
      category: recipe.category,
      cooking_time_minutes: recipe.cookingTimeMinutes,
      servings: recipe.servings,
      personal_notes: recipe.personalNotes,
      is_private: recipe.isPrivate,
    });
    if (error) throw new Error(error.message);
    return recipe;
  }

  const all = await getStoredJson<Record<string, Recipe[]>>(STORAGE_KEYS.recipes, {});
  const recipes = all[userId] ?? [];
  const index = recipes.findIndex((r) => r.id === recipe.id);
  const next = index >= 0 ? recipes.map((r) => (r.id === recipe.id ? recipe : r)) : [recipe, ...recipes];
  all[userId] = next;
  await setStoredJson(STORAGE_KEYS.recipes, all);
  return recipe;
}

export async function deleteRecipe(userId: string, recipeId: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from('recipes').delete().eq('id', recipeId).eq('owner_id', userId);
    if (error) throw new Error(error.message);
    return;
  }
  const all = await getStoredJson<Record<string, Recipe[]>>(STORAGE_KEYS.recipes, {});
  all[userId] = (all[userId] ?? []).filter((r) => r.id !== recipeId);
  await setStoredJson(STORAGE_KEYS.recipes, all);
}

export function buildRecipeFromPost(userId: string, input: Partial<Recipe> & { title: string; category: string }): Recipe {
  const now = new Date().toISOString();
  return {
    id: input.id ?? newId('recipe'),
    ownerId: userId,
    sourcePostId: input.sourcePostId,
    title: input.title,
    description: input.description ?? '',
    imageUrl: input.imageUrl ?? '',
    category: input.category,
    cookingTimeMinutes: input.cookingTimeMinutes ?? 0,
    servings: input.servings ?? 1,
    ingredients: input.ingredients ?? [],
    steps: input.steps ?? [],
    personalNotes: input.personalNotes ?? '',
    isPrivate: input.isPrivate ?? false,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}
