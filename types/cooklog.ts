export type RecipeCategory =
  | 'Primi'
  | 'Secondi'
  | 'Dolci'
  | 'Contorni'
  | 'Antipasti'
  | 'Altro';

/** Filtri UI: include viste speciali oltre alle categorie salvate sulla ricetta. */
export type RecipeListFilter = 'Tutte' | 'Preferite' | RecipeCategory;

export type Ingredient = {
  id: string;
  name: string;
  quantity: string;
};

export type RecipeStep = {
  id: string;
  order: number;
  text: string;
};

export type Recipe = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  category: RecipeCategory;
  cookingTimeMinutes: number;
  servings: number;
  ingredients: Ingredient[];
  steps: RecipeStep[];
  personalNotes: string;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
};
