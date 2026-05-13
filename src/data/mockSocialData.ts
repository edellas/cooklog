import type { Comment, FoodPost, Recipe, UserProfile } from '@/src/types';

const now = new Date();
const isoAt = (minsAgo: number) => new Date(now.getTime() - minsAgo * 60000).toISOString();

export const demoProfile: UserProfile = {
  id: 'demo-user',
  username: 'cooklover',
  displayName: 'Marco Rossi',
  avatarUrl: null,
  bio: 'Cucino spesso piatti semplici e replicabili.',
  createdAt: isoAt(50000),
  updatedAt: isoAt(120),
};

const POSTS_BASE = [
  { title: 'Pasta al forno', category: 'Primi', interests: ['Cucina italiana', 'Pasta', 'Comfort food'] },
  { title: 'Pollo al curry', category: 'Secondi', interests: ['Cucina asiatica', 'Cucina veloce'] },
  { title: 'Tiramisù', category: 'Dolci', interests: ['Dolci', 'Cucina italiana'] },
  { title: 'Risotto ai funghi', category: 'Primi', interests: ['Cucina italiana', 'Comfort food'] },
  { title: 'Bowl fit con salmone', category: 'Secondi', interests: ['Fit', 'Meal prep'] },
  { title: 'Carbonara', category: 'Primi', interests: ['Pasta', 'Cucina italiana'] },
  { title: 'Curry vegetariano', category: 'Secondi', interests: ['Vegetariano', 'Economico'] },
  { title: 'Pancake proteici', category: 'Dolci', interests: ['Fit', 'Dolci'] },
  { title: 'Ramen veloce', category: 'Primi', interests: ['Cucina asiatica', 'Cucina veloce'] },
  { title: 'Pizza fatta in casa', category: 'Altro', interests: ['Comfort food', 'Cucina italiana'] },
  { title: 'Insalata greca', category: 'Contorni', interests: ['Fit', 'Cucina veloce'] },
  { title: 'Tacos di pollo', category: 'Secondi', interests: ['Street food', 'Cucina veloce'] },
] as const;

const FEED_IMAGE_URLS = [
  'https://images.unsplash.com/photo-1621996345655-e3b646b9c123?w=1200&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=1200&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1571877227200-a00810970b99?w=1200&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1476124369491-e7add44e4870?w=1200&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=1200&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1612874742237-6526221588e3?w=1200&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1547592180-85f173990554?w=1200&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1587735243615-c03f25aaff15?w=1200&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1557872943-16a5ac26437e?w=1200&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=1200&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=1200&q=80&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1565299585323-38174c4a6b8d?w=1200&q=80&auto=format&fit=crop',
];

export const mockFeedPosts: FoodPost[] = POSTS_BASE.map((p, idx) => ({
  id: `post-${idx + 1}`,
  authorId: idx % 3 === 0 ? 'demo-user' : `author-${idx % 4}`,
  authorName: idx % 3 === 0 ? 'Marco Rossi' : ['Giulia', 'Luca', 'Sara', 'Marta'][idx % 4],
  authorAvatarUrl: null,
  title: p.title,
  description: `Versione domestica di ${p.title.toLowerCase()}, facile da replicare anche in settimana.`,
  mediaUrl: FEED_IMAGE_URLS[idx % FEED_IMAGE_URLS.length],
  mediaType: 'image',
  recipeId: `recipe-${idx + 1}`,
  category: p.category,
  interests: [...p.interests],
  cookingTimeMinutes: 15 + (idx % 5) * 10,
  servings: 2 + (idx % 3),
  likeCount: 12 + idx * 3,
  commentCount: 2 + (idx % 5),
  saveCount: 4 + idx,
  isLikedByCurrentUser: false,
  isSavedByCurrentUser: false,
  createdAt: isoAt(idx * 45),
  updatedAt: isoAt(idx * 45),
}));

export const mockRecipesFromPosts: Recipe[] = mockFeedPosts.map((post, idx) => ({
  id: post.recipeId!,
  ownerId: post.authorId,
  sourcePostId: post.id,
  title: post.title,
  description: post.description,
  imageUrl: post.mediaUrl,
  category: post.category,
  cookingTimeMinutes: post.cookingTimeMinutes,
  servings: post.servings,
  ingredients: [
    { id: `ing-${idx}-1`, name: 'Ingrediente principale', quantity: '300 g', sortOrder: 1 },
    { id: `ing-${idx}-2`, name: 'Olio extravergine', quantity: '2 cucchiai', sortOrder: 2 },
  ],
  steps: [
    { id: `st-${idx}-1`, order: 1, text: 'Prepara gli ingredienti e porta tutto a temperatura ambiente.' },
    { id: `st-${idx}-2`, order: 2, text: 'Cuoci a fuoco medio fino a consistenza desiderata.' },
    { id: `st-${idx}-3`, order: 3, text: 'Impiatta e servi subito.' },
  ],
  personalNotes: 'Adatta sale e spezie ai tuoi gusti.',
  isPrivate: false,
  createdAt: post.createdAt,
  updatedAt: post.updatedAt,
}));

export const mockCommentsByPostId: Record<string, Comment[]> = {
  'post-1': [
    {
      id: 'comment-1',
      postId: 'post-1',
      userId: 'author-1',
      authorName: 'Giulia',
      authorAvatarUrl: null,
      body: 'Fatta ieri sera, ottima e semplice.',
      createdAt: isoAt(30),
    },
  ],
};
