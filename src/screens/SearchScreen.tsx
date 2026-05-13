import { CategoryFilter } from '@/components/cooklog/CategoryFilter';
import { RecipeCard } from '@/components/cooklog/RecipeCard';
import { SearchBar } from '@/components/cooklog/SearchBar';
import { CooklogColors, CooklogSpacing } from '@/constants/cooklogTheme';
import { EmptyState } from '@/src/components/EmptyState';
import { getAllFeedPosts } from '@/src/services/feedService';
import { useAuth } from '@/src/providers/AuthProvider';
import { hrefRecipeDetail } from '@/lib/cooklogHref';
import type { RecipeCategory, RecipeListFilter } from '@/types/cooklog';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function SearchScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RecipeListFilter>('Tutte');
  const [posts, setPosts] = useState<Awaited<ReturnType<typeof getAllFeedPosts>>>([]);

  useEffect(() => {
    if (!user) return;
    void getAllFeedPosts(user.id).then(setPosts);
  }, [user]);

  const filtered = useMemo(() => {
    return posts.filter((p) => {
      const byName = p.title.toLowerCase().includes(query.trim().toLowerCase());
      const byCategory = filter === 'Tutte' || filter === 'Preferite' ? true : p.category === filter;
      return byName && byCategory;
    });
  }, [filter, posts, query]);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Cerca</Text>
      <View style={styles.block}>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Cerca piatti e ricette" />
      </View>
      <View style={styles.block}>
        <CategoryFilter selected={filter} onSelect={setFilter} />
      </View>
      <View style={styles.list}>
        {!filtered.length ? (
          <EmptyState title="Nessun risultato per la ricerca corrente." />
        ) : (
          filtered.map((item) => (
            <RecipeCard
              key={item.id}
              recipe={{
                id: item.recipeId ?? item.id,
                title: item.title,
                description: item.description,
                imageUrl: item.mediaUrl,
                category: item.category as RecipeCategory,
                cookingTimeMinutes: item.cookingTimeMinutes,
                servings: item.servings,
                ingredients: [],
                steps: [],
                personalNotes: '',
                isFavorite: item.isSavedByCurrentUser,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
              }}
              onPress={() => router.push(hrefRecipeDetail(item.recipeId ?? item.id))}
            />
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CooklogColors.background, paddingTop: 16 },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: CooklogColors.text,
    paddingHorizontal: CooklogSpacing.screenHorizontal,
    marginBottom: 12,
  },
  block: { paddingHorizontal: CooklogSpacing.screenHorizontal, marginBottom: 12 },
  list: { paddingHorizontal: CooklogSpacing.screenHorizontal, paddingBottom: 20 },
});
