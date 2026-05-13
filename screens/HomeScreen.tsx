import { CategoryFilter } from '@/components/cooklog/CategoryFilter';
import { RecipeCard } from '@/components/cooklog/RecipeCard';
import { ScreenScroll } from '@/components/cooklog/ScreenScroll';
import { SearchBar } from '@/components/cooklog/SearchBar';
import { CooklogColors, CooklogSpacing } from '@/constants/cooklogTheme';
import { useRecipes } from '@/contexts/RecipeContext';
import type { RecipeListFilter } from '@/types/cooklog';
import { hrefRecipeDetail } from '@/lib/cooklogHref';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

function matchesFilter(
  filter: RecipeListFilter,
  recipe: { category: string; isFavorite: boolean },
): boolean {
  if (filter === 'Tutte') return true;
  if (filter === 'Preferite') return recipe.isFavorite;
  return recipe.category === filter;
}

export function HomeScreen() {
  const router = useRouter();
  const { recipes } = useRecipes();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RecipeListFilter>('Tutte');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      const byName = !q || r.title.toLowerCase().includes(q);
      return byName && matchesFilter(filter, r);
    });
  }, [recipes, query, filter]);

  return (
    <ScreenScroll>
      <View style={styles.header}>
        <Text style={styles.brand}>Cooklog</Text>
        <Text style={styles.tagline}>Il tuo ricettario personale</Text>
      </View>

      <View style={styles.block}>
        <SearchBar value={query} onChangeText={setQuery} />
      </View>

      <View style={styles.block}>
        <CategoryFilter selected={filter} onSelect={setFilter} />
      </View>

      <View style={styles.list}>
        <Text style={styles.sectionTitle}>
          {filtered.length === 1 ? '1 ricetta' : `${filtered.length} ricette`}
        </Text>
        {filtered.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            onPress={() => router.push(hrefRecipeDetail(recipe.id))}
          />
        ))}
        {filtered.length === 0 ? (
          <Text style={styles.empty}>Nessuna ricetta corrisponde ai filtri.</Text>
        ) : null}
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: CooklogSpacing.screenHorizontal,
    paddingBottom: 8,
    gap: 6,
  },
  brand: {
    fontSize: 32,
    fontWeight: '700',
    color: CooklogColors.text,
    letterSpacing: -0.8,
  },
  tagline: {
    fontSize: 16,
    color: CooklogColors.textMuted,
  },
  block: {
    paddingHorizontal: CooklogSpacing.screenHorizontal,
    marginBottom: 14,
  },
  list: {
    paddingHorizontal: CooklogSpacing.screenHorizontal,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: CooklogColors.textMuted,
    marginBottom: 10,
  },
  empty: {
    marginTop: 24,
    textAlign: 'center',
    color: CooklogColors.textSubtle,
    fontSize: 15,
  },
});
