import type { Recipe } from '@/types/cooklog';

let seq = 0;

function newId(prefix: string) {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}

/**
 * Simula la “generazione” da foto: nessuna AI reale, solo dati strutturati di esempio.
 */
export function buildSimulatedPhotoRecipe(dishName?: string, notes?: string): Recipe {
  const now = new Date().toISOString();
  const title = dishName?.trim() || 'Ricetta da foto (demo)';
  return {
    id: newId('r-photo'),
    title,
    description:
      'Ricetta creata in modalità demo da immagine. Controlla ingredienti e tempi prima di cucinare.',
    imageUrl:
      'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=900&q=80&auto=format&fit=crop',
    category: 'Altro',
    cookingTimeMinutes: 25,
    servings: 2,
    ingredients: [
      { id: newId('ing'), name: 'Ingrediente principale (stima)', quantity: '300 g' },
      { id: newId('ing'), name: 'Aromi', quantity: 'q.b.' },
      { id: newId('ing'), name: 'Olio extravergine', quantity: '2 cucchiai' },
    ],
    steps: [
      {
        id: newId('st'),
        order: 1,
        text: 'Prepara gli ingredienti come suggerito dalla demo (simulazione).',
      },
      {
        id: newId('st'),
        order: 2,
        text: 'Cuoci a fuoco medio mescolando di tanto in tanto per 12–15 minuti.',
      },
      {
        id: newId('st'),
        order: 3,
        text: 'Assaggia, rectifica di sale e servi caldo.',
      },
    ],
    personalNotes: notes?.trim() || 'Generata in modalità demo: personalizza la ricetta.',
    isFavorite: false,
    createdAt: now,
    updatedAt: now,
  };
}
