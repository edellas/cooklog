import { CooklogColors, CooklogRadii, CooklogSpacing } from '@/constants/cooklogTheme';
import type { Recipe } from '@/types/cooklog';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  recipe: Recipe;
  onPress: () => void;
};

export function RecipeCard({ recipe, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <Image source={{ uri: recipe.imageUrl }} style={styles.image} contentFit="cover" />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {recipe.title}
        </Text>
        <Text style={styles.meta}>
          {recipe.category} · {recipe.cookingTimeMinutes} min · {recipe.servings} porz.
        </Text>
        {recipe.isFavorite ? <Text style={styles.favoriteLabel}>Preferita</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: CooklogColors.surface,
    borderRadius: CooklogRadii.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: CooklogColors.border,
    marginBottom: CooklogSpacing.item,
  },
  cardPressed: {
    opacity: 0.92,
  },
  image: {
    width: 108,
    height: 108,
    backgroundColor: CooklogColors.border,
  },
  body: {
    flex: 1,
    padding: 14,
    justifyContent: 'center',
    gap: 6,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: CooklogColors.text,
    letterSpacing: -0.2,
  },
  meta: {
    fontSize: 13,
    color: CooklogColors.textMuted,
  },
  favoriteLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: CooklogColors.favorite,
  },
});
