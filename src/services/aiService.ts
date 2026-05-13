import { isSupabaseConfigured, supabase } from '@/src/lib/supabase';
import { incrementAiUsage } from '@/src/services/subscriptionService';

type GeneratedRecipeResult = {
  title: string;
  description: string;
  category: string;
  cookingTimeMinutes: number;
  servings: number;
  ingredients: { name: string; quantity: string }[];
  steps: { order: number; text: string }[];
  interests: string[];
  personalNotes: string;
};

export async function generateRecipeFromImage(input: {
  imageUrl: string;
  notes?: string;
  userId: string;
}): Promise<GeneratedRecipeResult> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.functions.invoke('generate-recipe-from-image', {
      body: { imageUrl: input.imageUrl, notes: input.notes, language: 'it' },
    });
    if (error) throw new Error(error.message);
    if (!data?.title || !Array.isArray(data.ingredients) || !Array.isArray(data.steps)) {
      throw new Error('Risposta AI non valida');
    }
    await incrementAiUsage(input.userId);
    return data as GeneratedRecipeResult;
  }

  await incrementAiUsage(input.userId);
  return {
    title: 'Ricetta da foto (demo)',
    description: 'Ricetta stimata dalla foto in modalità fallback locale.',
    category: 'Altro',
    cookingTimeMinutes: 25,
    servings: 2,
    ingredients: [
      { name: 'Ingrediente principale', quantity: '300 g' },
      { name: 'Olio extravergine', quantity: '2 cucchiai' },
    ],
    steps: [
      { order: 1, text: 'Prepara tutti gli ingredienti.' },
      { order: 2, text: 'Cuoci a fuoco medio fino a consistenza desiderata.' },
      { order: 3, text: 'Impiatta e servi caldo.' },
    ],
    interests: ['Cucina veloce', 'Comfort food'],
    personalNotes: input.notes ?? 'Ricetta generata in modalità demo.',
  };
}
