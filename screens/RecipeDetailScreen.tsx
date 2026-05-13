import { CooklogColors, CooklogRadii, CooklogSpacing } from '@/constants/cooklogTheme';
import { useRecipes } from '@/contexts/RecipeContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import { hrefRecipeEdit } from '@/lib/cooklogHref';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useLayoutEffect, useMemo } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { recipes, toggleFavorite } = useRecipes();

  const recipe = useMemo(() => (id ? recipes.find((r) => r.id === id) : undefined), [id, recipes]);

  useLayoutEffect(() => {
    if (!recipe) return;
    navigation.setOptions({
      title: recipe.title,
      headerRight: () => (
        <Pressable
          onPress={() => toggleFavorite(recipe.id)}
          hitSlop={12}
          style={styles.headerBtn}>
          <IconSymbol
            name={recipe.isFavorite ? 'heart.fill' : 'heart'}
            size={24}
            color={recipe.isFavorite ? CooklogColors.favorite : CooklogColors.textMuted}
          />
        </Pressable>
      ),
    });
  }, [navigation, recipe, toggleFavorite]);

  if (!id || !recipe) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingTitle}>Ricetta non trovata</Text>
        <Pressable onPress={() => router.back()} style={styles.missingCta}>
          <Text style={styles.missingCtaLabel}>Indietro</Text>
        </Pressable>
      </View>
    );
  }

  const onShare = () => {
    Alert.alert('Condividi', 'Link copiato negli appunti (simulazione).');
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
      showsVerticalScrollIndicator={false}>
      <Image source={{ uri: recipe.imageUrl }} style={styles.hero} contentFit="cover" />

      <View style={styles.pad}>
        <Text style={styles.title}>{recipe.title}</Text>
        <Text style={styles.meta}>
          {recipe.cookingTimeMinutes} min · {recipe.servings} porzioni · {recipe.category}
        </Text>
        <Text style={styles.description}>{recipe.description}</Text>

        <View style={styles.row}>
          <Pressable
            onPress={() => toggleFavorite(recipe.id)}
            style={({ pressed }) => [styles.chipBtn, pressed && styles.pressed]}>
            <IconSymbol
              name={recipe.isFavorite ? 'heart.fill' : 'heart'}
              size={20}
              color={recipe.isFavorite ? CooklogColors.favorite : CooklogColors.primary}
            />
            <Text style={styles.chipLabel}>{recipe.isFavorite ? 'Preferita' : 'Aggiungi ai preferiti'}</Text>
          </Pressable>
          <Pressable onPress={onShare} style={({ pressed }) => [styles.chipBtn, pressed && styles.pressed]}>
            <IconSymbol name="square.and.arrow.up" size={20} color={CooklogColors.primary} />
            <Text style={styles.chipLabel}>Condividi</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={() => router.push(hrefRecipeEdit(recipe.id))}
          style={({ pressed }) => [styles.editMain, pressed && styles.pressed]}>
          <IconSymbol name="pencil" size={20} color={CooklogColors.backgroundElevated} />
          <Text style={styles.editMainLabel}>Modifica ricetta</Text>
        </Pressable>

        <Text style={styles.section}>Ingredienti</Text>
        {recipe.ingredients.map((ing) => (
          <View key={ing.id} style={styles.line}>
            <Text style={styles.ingName}>{ing.name}</Text>
            <Text style={styles.ingQty}>{ing.quantity}</Text>
          </View>
        ))}

        <Text style={styles.section}>Preparazione</Text>
        {recipe.steps
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((step) => (
            <View key={step.id} style={styles.step}>
              <Text style={styles.stepIndex}>{step.order}</Text>
              <Text style={styles.stepText}>{step.text}</Text>
            </View>
          ))}

        {recipe.personalNotes.trim() ? (
          <>
            <Text style={styles.section}>Note personali</Text>
            <Text style={styles.notes}>{recipe.personalNotes}</Text>
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: CooklogColors.background,
  },
  hero: {
    width: '100%',
    height: 240,
    backgroundColor: CooklogColors.border,
  },
  pad: {
    paddingHorizontal: CooklogSpacing.screenHorizontal,
    paddingTop: 20,
    gap: 4,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: CooklogColors.text,
    letterSpacing: -0.4,
  },
  meta: {
    fontSize: 15,
    color: CooklogColors.textMuted,
    marginTop: 4,
  },
  description: {
    marginTop: 12,
    fontSize: 16,
    lineHeight: 24,
    color: CooklogColors.text,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 18,
  },
  chipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: CooklogColors.border,
    backgroundColor: CooklogColors.surface,
    borderRadius: CooklogRadii.chip,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: CooklogColors.primary,
  },
  editMain: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: CooklogColors.primary,
    borderRadius: CooklogRadii.button,
    paddingVertical: 14,
  },
  editMainLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: CooklogColors.backgroundElevated,
  },
  pressed: {
    opacity: 0.9,
  },
  section: {
    marginTop: 26,
    marginBottom: 10,
    fontSize: 18,
    fontWeight: '700',
    color: CooklogColors.text,
  },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CooklogColors.border,
  },
  ingName: {
    flex: 1,
    fontSize: 15,
    color: CooklogColors.text,
  },
  ingQty: {
    fontSize: 15,
    fontWeight: '600',
    color: CooklogColors.textMuted,
  },
  step: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  stepIndex: {
    width: 26,
    height: 26,
    borderRadius: 13,
    overflow: 'hidden',
    textAlign: 'center',
    lineHeight: 26,
    fontSize: 14,
    fontWeight: '700',
    color: CooklogColors.backgroundElevated,
    backgroundColor: CooklogColors.primary,
  },
  stepText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: CooklogColors.text,
  },
  notes: {
    fontSize: 15,
    lineHeight: 22,
    color: CooklogColors.textMuted,
  },
  headerBtn: {
    marginRight: 8,
    padding: 4,
  },
  missing: {
    flex: 1,
    backgroundColor: CooklogColors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  missingTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: CooklogColors.text,
  },
  missingCta: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: CooklogRadii.button,
    backgroundColor: CooklogColors.primary,
  },
  missingCtaLabel: {
    color: CooklogColors.backgroundElevated,
    fontWeight: '600',
  },
});
