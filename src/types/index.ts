export type UserProfile = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Ingredient = {
  id: string;
  name: string;
  quantity: string;
  sortOrder: number;
};

export type RecipeStep = {
  id: string;
  order: number;
  text: string;
};

export type Recipe = {
  id: string;
  ownerId: string;
  sourcePostId?: string;
  title: string;
  description: string;
  imageUrl: string;
  category: string;
  cookingTimeMinutes: number;
  servings: number;
  ingredients: Ingredient[];
  steps: RecipeStep[];
  personalNotes: string;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FoodPost = {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  title: string;
  description: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  recipeId?: string;
  category: string;
  interests: string[];
  cookingTimeMinutes: number;
  servings: number;
  likeCount: number;
  commentCount: number;
  saveCount: number;
  isLikedByCurrentUser: boolean;
  isSavedByCurrentUser: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Comment = {
  id: string;
  postId: string;
  userId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  createdAt: string;
};

export type SubscriptionStatus = {
  isPro: boolean;
  plan: 'free' | 'pro-monthly' | 'pro-yearly';
  aiGenerationsUsedThisMonth: number;
  maxAiGenerations: number;
  savedRecipesCount: number;
  maxSavedRecipes: number;
};

export type AppUser = {
  id: string;
  email: string;
};

export const INTEREST_OPTIONS = [
  'Cucina italiana',
  'Dolci',
  'Fit',
  'Vegetariano',
  'Economico',
  'Pasta',
  'Meal prep',
  'Cucina veloce',
  'Street food',
  'Cucina asiatica',
  'Senza glutine',
  'Comfort food',
] as const;

export type InterestOption = (typeof INTEREST_OPTIONS)[number];
