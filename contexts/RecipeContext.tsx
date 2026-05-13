import { buildSimulatedPhotoRecipe } from '@/data/simulatedPhotoRecipe';
import type { Recipe, RecipeCategory } from '@/types/cooklog';
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { mockRecipes } from '@/data/mockRecipes';

type RecipeContextValue = {
  recipes: Recipe[];
  addRecipe: (recipe: Recipe) => void;
  updateRecipe: (id: string, patch: Partial<Recipe>) => void;
  replaceRecipe: (recipe: Recipe) => void;
  deleteRecipe: (id: string) => void;
  toggleFavorite: (id: string) => void;
  simulateRecipeFromPhoto: (dishName?: string, notes?: string) => Recipe;
  getRecipeById: (id: string) => Recipe | undefined;
};

const RecipeContext = createContext<RecipeContextValue | null>(null);

export function RecipeProvider({ children }: { children: React.ReactNode }) {
  const [recipes, setRecipes] = useState<Recipe[]>(() => [...mockRecipes]);

  const addRecipe = useCallback((recipe: Recipe) => {
    setRecipes((prev) => [recipe, ...prev]);
  }, []);

  const updateRecipe = useCallback((id: string, patch: Partial<Recipe>) => {
    const updatedAt = new Date().toISOString();
    setRecipes((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch, updatedAt } : r)),
    );
  }, []);

  const replaceRecipe = useCallback((recipe: Recipe) => {
    const updatedAt = new Date().toISOString();
    setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? { ...recipe, updatedAt } : r)));
  }, []);

  const deleteRecipe = useCallback((id: string) => {
    setRecipes((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    const updatedAt = new Date().toISOString();
    setRecipes((prev) =>
      prev.map((r) => (r.id === id ? { ...r, isFavorite: !r.isFavorite, updatedAt } : r)),
    );
  }, []);

  const simulateRecipeFromPhoto = useCallback((dishName?: string, notes?: string) => {
    return buildSimulatedPhotoRecipe(dishName, notes);
  }, []);

  const getRecipeById = useCallback(
    (id: string) => recipes.find((r) => r.id === id),
    [recipes],
  );

  const value = useMemo(
    () => ({
      recipes,
      addRecipe,
      updateRecipe,
      replaceRecipe,
      deleteRecipe,
      toggleFavorite,
      simulateRecipeFromPhoto,
      getRecipeById,
    }),
    [
      recipes,
      addRecipe,
      updateRecipe,
      replaceRecipe,
      deleteRecipe,
      toggleFavorite,
      simulateRecipeFromPhoto,
      getRecipeById,
    ],
  );

  return <RecipeContext.Provider value={value}>{children}</RecipeContext.Provider>;
}

export function useRecipes() {
  const ctx = useContext(RecipeContext);
  if (!ctx) {
    throw new Error('useRecipes deve essere usato dentro RecipeProvider');
  }
  return ctx;
}

export const RECIPE_CATEGORIES: RecipeCategory[] = [
  'Primi',
  'Secondi',
  'Dolci',
  'Contorni',
  'Antipasti',
  'Altro',
];
