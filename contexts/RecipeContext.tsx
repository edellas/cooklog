import { mockRecipes } from '@/data/mockRecipes';
import { buildSimulatedPhotoRecipe } from '@/data/simulatedPhotoRecipe';
import type { Recipe, RecipeCategory } from '@/types/cooklog';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const RECIPES_STORAGE_KEY = 'cooklog.recipes.v1';

type RecipeContextValue = {
  recipes: Recipe[];
  isLoading: boolean;
  error: string | null;
  loadRecipes: () => Promise<void>;
  createRecipe: (recipe: Recipe) => Promise<void>;
  updateRecipe: (id: string, patch: Partial<Recipe>) => Promise<void>;
  deleteRecipe: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  simulateRecipeFromPhoto: (dishName?: string, notes?: string) => Recipe;
  getRecipeById: (id: string) => Recipe | undefined;
};

const RecipeContext = createContext<RecipeContextValue | null>(null);

export function RecipeProvider({ children }: { children: React.ReactNode }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const persistRecipes = useCallback(async (nextRecipes: Recipe[]) => {
    try {
      await AsyncStorage.setItem(RECIPES_STORAGE_KEY, JSON.stringify(nextRecipes));
    } catch (err) {
      console.error('Errore salvataggio ricette', err);
      setError('Non sono riuscito a salvare le ricette in locale.');
    }
  }, []);

  const loadRecipes = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const raw = await AsyncStorage.getItem(RECIPES_STORAGE_KEY);
      if (!raw) {
        const seeded = [...mockRecipes];
        setRecipes(seeded);
        await AsyncStorage.setItem(RECIPES_STORAGE_KEY, JSON.stringify(seeded));
        return;
      }

      const parsed = JSON.parse(raw) as Recipe[];
      if (!Array.isArray(parsed)) {
        throw new Error('Formato storage non valido');
      }
      setRecipes(parsed);
    } catch (err) {
      console.error('Errore caricamento ricette', err);
      setError('Non sono riuscito a caricare le ricette salvate.');
      setRecipes([...mockRecipes]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecipes();
  }, [loadRecipes]);

  const createRecipe = useCallback(
    async (recipe: Recipe) => {
      setError(null);
      let nextRecipes: Recipe[] = [];
      setRecipes((prev) => {
        nextRecipes = [recipe, ...prev];
        return nextRecipes;
      });
      await persistRecipes(nextRecipes);
    },
    [persistRecipes],
  );

  const updateRecipe = useCallback(
    async (id: string, patch: Partial<Recipe>) => {
      setError(null);
      const updatedAt = new Date().toISOString();
      let nextRecipes: Recipe[] = [];
      setRecipes((prev) => {
        nextRecipes = prev.map((r) => (r.id === id ? { ...r, ...patch, updatedAt } : r));
        return nextRecipes;
      });
      await persistRecipes(nextRecipes);
    },
    [persistRecipes],
  );

  const deleteRecipe = useCallback(
    async (id: string) => {
      setError(null);
      let nextRecipes: Recipe[] = [];
      setRecipes((prev) => {
        nextRecipes = prev.filter((r) => r.id !== id);
        return nextRecipes;
      });
      await persistRecipes(nextRecipes);
    },
    [persistRecipes],
  );

  const toggleFavorite = useCallback(
    async (id: string) => {
      setError(null);
      const updatedAt = new Date().toISOString();
      let nextRecipes: Recipe[] = [];
      setRecipes((prev) => {
        nextRecipes = prev.map((r) =>
          r.id === id ? { ...r, isFavorite: !r.isFavorite, updatedAt } : r,
        );
        return nextRecipes;
      });
      await persistRecipes(nextRecipes);
    },
    [persistRecipes],
  );

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
      isLoading,
      error,
      loadRecipes,
      createRecipe,
      updateRecipe,
      deleteRecipe,
      toggleFavorite,
      simulateRecipeFromPhoto,
      getRecipeById,
    }),
    [
      recipes,
      isLoading,
      error,
      loadRecipes,
      createRecipe,
      updateRecipe,
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
