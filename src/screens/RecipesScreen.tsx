import { CategoryFilter } from '@/components/cooklog/CategoryFilter';
import { RecipeCard } from '@/components/cooklog/RecipeCard';
import { SearchBar } from '@/components/cooklog/SearchBar';
import { CooklogColors, CooklogSpacing } from '@/constants/cooklogTheme';
import { EmptyState } from '@/src/components/EmptyState';
import { LoadingState } from '@/src/components/LoadingState';
import { mockFeedPosts, mockRecipesFromPosts } from '@/src/data/mockSocialData';
import { useAuth } from '@/src/providers/AuthProvider';
import { loadRecipesForUser } from '@/src/services/recipeService';
import { STORAGE_KEYS } from '@/src/services/storageKeys';
import { getStoredJson } from '@/src/services/storage';
import { hrefRecipeDetail } from '@/lib/cooklogHref';
import type { RecipeCategory, RecipeListFilter } from '@/types/cooklog';
import type { Recipe as SocialRecipe } from '@/src/types';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Segment = 'mine' | 'saved' | 'favorites';

export function RecipesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [segment, setSegment] = useState<Segment>('mine');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RecipeListFilter>('Tutte');
  const [loading, setLoading] = useState(true);
  const [mine, setMine] = useState<SocialRecipe[]>([]);
  const [saved, setSaved] = useState<SocialRecipe[]>([]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      setLoading(true);
      const myRecipes = await loadRecipesForUser(user.id);
      setMine(myRecipes);
      const savedMap = await getStoredJson<Record<string, string[]>>(STORAGE_KEYS.savedPosts, {});
      const savedPostIds = savedMap[user.id] ?? [];
      const mapped = mockFeedPosts
        .filter((p) => savedPostIds.includes(p.id))
        .map((p) => mockRecipesFromPosts.find((r) => r.id === p.recipeId))
        .filter(Boolean);
      setSaved(mapped as SocialRecipe[]);
      setLoading(false);
    })();
  }, [user]);

  const activeData = useMemo(() => {
    const source = segment === 'mine' ? mine : segment === 'saved' ? saved : [...mine, ...saved];
    return source.filter((r) => {
      const byName = r.title.toLowerCase().includes(query.trim().toLowerCase());
      const byCategory = filter === 'Tutte' || filter === 'Preferite' || r.category === filter;
      return byName && byCategory;
    });
  }, [segment, mine, saved, query, filter]);

  if (loading) return <LoadingState message="Caricamento ricette..." />;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Ricette</Text>
      <View style={styles.segmentRow}>
        <SegmentButton text="Le mie" active={segment === 'mine'} onPress={() => setSegment('mine')} />
        <SegmentButton text="Salvate" active={segment === 'saved'} onPress={() => setSegment('saved')} />
        <SegmentButton text="Preferite" active={segment === 'favorites'} onPress={() => setSegment('favorites')} />
      </View>
      <View style={styles.block}>
        <SearchBar value={query} onChangeText={setQuery} />
      </View>
      <View style={styles.block}>
        <CategoryFilter selected={filter} onSelect={setFilter} />
      </View>
      <View style={styles.list}>
        {!activeData.length ? (
          <EmptyState title="Nessuna ricetta disponibile in questa sezione." />
        ) : (
          activeData.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={{
                id: recipe.id,
                title: recipe.title,
                description: recipe.description,
                imageUrl: recipe.imageUrl,
                category: recipe.category as RecipeCategory,
                cookingTimeMinutes: recipe.cookingTimeMinutes,
                servings: recipe.servings,
                ingredients: [],
                steps: [],
                personalNotes: recipe.personalNotes ?? '',
                isFavorite: segment === 'favorites',
                createdAt: recipe.createdAt,
                updatedAt: recipe.updatedAt,
              }}
              onPress={() => router.push(hrefRecipeDetail(recipe.id))}
            />
          ))
        )}
      </View>
    </View>
  );
}

function SegmentButton({ text, active, onPress }: { text: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.segmentButton, active && styles.segmentButtonActive]}>
      <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CooklogColors.background, paddingTop: 12 },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: CooklogColors.text,
    paddingHorizontal: CooklogSpacing.screenHorizontal,
  },
  segmentRow: { flexDirection: 'row', gap: 8, paddingHorizontal: CooklogSpacing.screenHorizontal, marginTop: 12 },
  segmentButton: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CooklogColors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: CooklogColors.surface,
  },
  segmentButtonActive: { backgroundColor: CooklogColors.primary, borderColor: CooklogColors.primary },
  segmentLabel: { color: CooklogColors.textMuted, fontWeight: '600' },
  segmentLabelActive: { color: '#fff' },
  block: { paddingHorizontal: CooklogSpacing.screenHorizontal, marginTop: 12 },
  list: { paddingHorizontal: CooklogSpacing.screenHorizontal, paddingVertical: 10 },
});
