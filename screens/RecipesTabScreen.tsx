import { RecipeCard } from '@/components/cooklog/RecipeCard';
import { ScreenScroll } from '@/components/cooklog/ScreenScroll';
import { CooklogColors, CooklogSpacing } from '@/constants/cooklogTheme';
import { useRecipes } from '@/contexts/RecipeContext';
import { hrefRecipeDetail } from '@/lib/cooklogHref';
import { useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

export function RecipesTabScreen() {
  const router = useRouter();
  const { recipes } = useRecipes();

  return (
    <ScreenScroll>
      <View style={styles.header}>
        <Text style={styles.title}>Ricette</Text>
        <Text style={styles.sub}>Archivio completo e accesso al ricettario condiviso (demo).</Text>
      </View>

      <Pressable
        onPress={() => router.push('/shared-cookbook')}
        style={({ pressed }) => [styles.banner, pressed && styles.pressed]}>
        <Text style={styles.bannerTitle}>Ricettario condiviso</Text>
        <Text style={styles.bannerSub}>Ricette di famiglia · mock locale</Text>
      </Pressable>

      <Pressable
        onPress={() =>
          Alert.alert('Condividi link', 'Link condiviso generato (simulazione).')
        }
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
        <Text style={styles.secondaryLabel}>Condividi link del ricettario</Text>
      </Pressable>

      <View style={styles.list}>
        <Text style={styles.count}>
          {recipes.length === 1 ? '1 ricetta salvata' : `${recipes.length} ricette salvate`}
        </Text>
        {recipes.map((recipe) => (
          <RecipeCard
            key={recipe.id}
            recipe={recipe}
            onPress={() => router.push(hrefRecipeDetail(recipe.id))}
          />
        ))}
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: CooklogSpacing.screenHorizontal,
    marginBottom: 16,
    gap: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: CooklogColors.text,
    letterSpacing: -0.5,
  },
  sub: {
    fontSize: 15,
    lineHeight: 22,
    color: CooklogColors.textMuted,
  },
  banner: {
    marginHorizontal: CooklogSpacing.screenHorizontal,
    padding: 18,
    borderRadius: 16,
    backgroundColor: CooklogColors.primary,
    marginBottom: 12,
  },
  bannerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: CooklogColors.backgroundElevated,
  },
  bannerSub: {
    marginTop: 6,
    fontSize: 14,
    color: 'rgba(255,252,247,0.85)',
  },
  secondary: {
    marginHorizontal: CooklogSpacing.screenHorizontal,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CooklogColors.border,
    backgroundColor: CooklogColors.surface,
    marginBottom: 20,
  },
  secondaryLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: CooklogColors.primary,
    textAlign: 'center',
  },
  list: {
    paddingHorizontal: CooklogSpacing.screenHorizontal,
  },
  count: {
    fontSize: 14,
    fontWeight: '600',
    color: CooklogColors.textMuted,
    marginBottom: 10,
  },
  pressed: {
    opacity: 0.92,
  },
});
