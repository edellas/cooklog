import type { Recipe } from '@/types/cooklog';

const now = new Date().toISOString();

export const mockRecipes: Recipe[] = [
  {
    id: 'r-pasta-forno',
    title: 'Pasta al forno',
    description: 'Pasta corta, ragù ricco e mozzarella filante, gratinata al forno.',
    imageUrl:
      'https://images.unsplash.com/photo-1621996345655-e3b646b9c123?w=900&q=80&auto=format&fit=crop',
    category: 'Primi',
    cookingTimeMinutes: 55,
    servings: 6,
    ingredients: [
      { id: 'i1', name: 'Pasta corta', quantity: '400 g' },
      { id: 'i2', name: 'Passata di pomodoro', quantity: '500 ml' },
      { id: 'i3', name: 'Macinato misto', quantity: '300 g' },
      { id: 'i4', name: 'Mozzarella', quantity: '250 g' },
      { id: 'i5', name: 'Parmigiano grattugiato', quantity: '60 g' },
    ],
    steps: [
      { id: 's1', order: 1, text: 'Cuoci la pasta in acqua salata molto al dente.' },
      { id: 's2', order: 2, text: 'Prepara il ragù rosolando la carne, poi aggiungi la passata e cuoci 25 minuti.' },
      { id: 's3', order: 3, text: 'Mescola pasta, ragù e cubetti di mozzarella, versa in teglia e copri con parmigiano.' },
      { id: 's4', order: 4, text: 'Inforna a 190°C per 20 minuti fino a gratinatura dorata.' },
    ],
    personalNotes: 'Versione della domenica: aggiungo un filo di panna nel ragù.',
    isFavorite: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'r-pollo-curry',
    title: 'Pollo al curry',
    description: 'Pollo tenero in salsa speziata, equilibrata e cremosa.',
    imageUrl:
      'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=900&q=80&auto=format&fit=crop',
    category: 'Secondi',
    cookingTimeMinutes: 35,
    servings: 4,
    ingredients: [
      { id: 'i1', name: 'Cosce o sovracosce di pollo', quantity: '800 g' },
      { id: 'i2', name: 'Cipolla', quantity: '1' },
      { id: 'i3', name: 'Latte di cocco', quantity: '200 ml' },
      { id: 'i4', name: 'Passata di pomodoro', quantity: '150 ml' },
      { id: 'i5', name: 'Curry in polvere', quantity: '2 cucchiaini' },
    ],
    steps: [
      { id: 's1', order: 1, text: 'Rosola il pollo a fiamma alta finché la pelle è croccante.' },
      { id: 's2', order: 2, text: 'Aggiungi cipolla tritata e fai appassire 5 minuti.' },
      { id: 's3', order: 3, text: 'Unisci passata, cocco e curry; cuoci a fuoco medio 20 minuti.' },
      { id: 's4', order: 4, text: 'Rectifica di sale e servi con riso basmati.' },
    ],
    personalNotes: 'Meno piccante: riduco il curry e aggiungo un cucchiaio di yogurt a fine cottura.',
    isFavorite: false,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'r-tiramisu',
    title: 'Tiramisù',
    description: 'Classico al caffè con savoiardi e crema al mascarpone.',
    imageUrl:
      'https://images.unsplash.com/photo-1571877227200-a00810970b99?w=900&q=80&auto=format&fit=crop',
    category: 'Dolci',
    cookingTimeMinutes: 30,
    servings: 8,
    ingredients: [
      { id: 'i1', name: 'Mascarpone', quantity: '500 g' },
      { id: 'i2', name: 'Uova', quantity: '4' },
      { id: 'i3', name: 'Zucchero', quantity: '100 g' },
      { id: 'i4', name: 'Caffè espresso freddo', quantity: '300 ml' },
      { id: 'i5', name: 'Savoiardi', quantity: '200 g' },
      { id: 'i6', name: 'Cacao amaro', quantity: 'q.b.' },
    ],
    steps: [
      { id: 's1', order: 1, text: 'Monta tuorli e zucchero fino a crema chiara e spumosa.' },
      { id: 's2', order: 2, text: 'Aggiungi mascarpone e amalgama senza smontare.' },
      { id: 's3', order: 3, text: 'Inzuppa brevemente i savoiardi nel caffè e disponi uno strato.' },
      { id: 's4', order: 4, text: 'Copri con crema, ripeti gli strati e spolvera cacao. Riposa in frigo almeno 6 ore.' },
    ],
    personalNotes: 'Caffè non zuccherato e inzuppatura veloce per savoiardi compatti.',
    isFavorite: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'r-risotto-funghi',
    title: 'Risotto ai funghi',
    description: 'Risotto cremoso con funghi porcini e profumo di bosco.',
    imageUrl:
      'https://images.unsplash.com/photo-1476124369491-e7add44e4870?w=900&q=80&auto=format&fit=crop',
    category: 'Primi',
    cookingTimeMinutes: 40,
    servings: 4,
    ingredients: [
      { id: 'i1', name: 'Riso Carnaroli', quantity: '320 g' },
      { id: 'i2', name: 'Funghi misti', quantity: '400 g' },
      { id: 'i3', name: 'Brodo vegetale caldo', quantity: '1,2 l' },
      { id: 'i4', name: 'Vino bianco', quantity: '100 ml' },
      { id: 'i5', name: 'Burro e parmigiano', quantity: '40 g + 60 g' },
    ],
    steps: [
      { id: 's1', order: 1, text: 'Rosola i funghi in padella ampia finché perdono acqua e s’insaporiscono.' },
      { id: 's2', order: 2, text: 'Tosta il riso, sfuma con vino e prosegui con brodo a mestolate.' },
      { id: 's3', order: 3, text: 'A cottura quasi ultimata, incorpora funghi e manteca con burro e parmigiano.' },
    ],
    personalNotes: 'Brodo sempre caldo: mantiene l’amido e la crema.',
    isFavorite: false,
    createdAt: now,
    updatedAt: now,
  },
];
