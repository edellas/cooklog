import { CooklogColors, CooklogRadii, CooklogSpacing } from '@/constants/cooklogTheme';
import { EmptyState } from '@/src/components/EmptyState';
import { LoadingState } from '@/src/components/LoadingState';
import { mockRecipesFromPosts } from '@/src/data/mockSocialData';
import { useAuth } from '@/src/providers/AuthProvider';
import { buildRecipeFromPost, loadRecipesForUser, saveRecipe } from '@/src/services/recipeService';
import { STORAGE_KEYS } from '@/src/services/storageKeys';
import { getStoredJson, setStoredJson } from '@/src/services/storage';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Share, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import type { Recipe } from '@/src/types';

export function RecipeDetailSocialScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [myRecipes, setMyRecipes] = useState<Recipe[]>([]);
  const [savedPostIds, setSavedPostIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      setLoading(true);
      const mine = await loadRecipesForUser(user.id);
      setMyRecipes(mine);
      const savedMap = await getStoredJson<Record<string, string[]>>(STORAGE_KEYS.savedPosts, {});
      setSavedPostIds(savedMap[user.id] ?? []);
      setLoading(false);
    })();
  }, [user]);

  const recipe = useMemo(() => {
    const fromMine = myRecipes.find((r) => r.id === id);
    if (fromMine) return fromMine;
    return mockRecipesFromPosts.find((r) => r.id === id);
  }, [id, myRecipes]);

  if (loading) return <LoadingState message="Caricamento ricetta..." />;
  if (!recipe) return <EmptyState title="Ricetta non trovata." />;
  if (!user) return <EmptyState title="Sessione non disponibile." />;

  const isOwner = recipe.ownerId === user.id;
  const isSaved = recipe.sourcePostId ? savedPostIds.includes(recipe.sourcePostId) : false;

  const toggleSaved = async () => {
    if (!recipe.sourcePostId) return;
    const savedMap = await getStoredJson<Record<string, string[]>>(STORAGE_KEYS.savedPosts, {});
    const current = new Set(savedMap[user.id] ?? []);
    if (current.has(recipe.sourcePostId)) current.delete(recipe.sourcePostId);
    else current.add(recipe.sourcePostId);
    savedMap[user.id] = [...current];
    await setStoredJson(STORAGE_KEYS.savedPosts, savedMap);
    setSavedPostIds(savedMap[user.id]);
  };

  const copyToMine = async () => {
    const copied = buildRecipeFromPost(user.id, {
      ...recipe,
      id: `recipe-copy-${Date.now()}`,
      sourcePostId: recipe.sourcePostId,
      title: `${recipe.title} (copia)`,
    });
    await saveRecipe(user.id, copied);
    router.push(`/recipe/${copied.id}`);
  };

  const onShare = async () => {
    await Share.share({
      message: `${recipe.title} · ${recipe.category}\nTempo: ${recipe.cookingTimeMinutes} min`,
    });
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Image source={{ uri: recipe.imageUrl }} style={styles.hero} contentFit="cover" />
      <Text style={styles.title}>{recipe.title}</Text>
      <Text style={styles.meta}>
        {recipe.category} · {recipe.cookingTimeMinutes} min · {recipe.servings} porzioni
      </Text>
      <Text style={styles.description}>{recipe.description}</Text>

      <View style={styles.actions}>
        <Pressable onPress={() => void toggleSaved()} style={styles.action}>
          <IconSymbol name={isSaved ? 'heart.fill' : 'heart'} color={CooklogColors.primary} size={18} />
          <Text style={styles.actionLabel}>{isSaved ? 'Rimuovi dai salvati' : 'Salva'}</Text>
        </Pressable>
        {!isOwner ? (
          <Pressable onPress={() => void copyToMine()} style={styles.action}>
            <IconSymbol name="plus.circle.fill" color={CooklogColors.primary} size={18} />
            <Text style={styles.actionLabel}>Copia nel mio ricettario</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => router.push(`/recipe/${recipe.id}/edit`)} style={styles.action}>
            <IconSymbol name="pencil" color={CooklogColors.primary} size={18} />
            <Text style={styles.actionLabel}>Modifica</Text>
          </Pressable>
        )}
        <Pressable onPress={() => void onShare()} style={styles.action}>
          <IconSymbol name="square.and.arrow.up" color={CooklogColors.primary} size={18} />
          <Text style={styles.actionLabel}>Condividi</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>Ingredienti</Text>
      {recipe.ingredients.map((ing) => (
        <Text key={ing.id} style={styles.line}>
          - {ing.name} {ing.quantity ? `(${ing.quantity})` : ''}
        </Text>
      ))}
      <Text style={styles.section}>Passaggi</Text>
      {recipe.steps.map((step) => (
        <Text key={step.id} style={styles.line}>
          {step.order}. {step.text}
        </Text>
      ))}
      {recipe.personalNotes ? (
        <>
          <Text style={styles.section}>Note personali</Text>
          <Text style={styles.notes}>{recipe.personalNotes}</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CooklogColors.background },
  content: { paddingBottom: 60 },
  hero: { width: '100%', height: 250, backgroundColor: CooklogColors.border },
  title: { fontSize: 28, fontWeight: '700', color: CooklogColors.text, marginTop: 14, paddingHorizontal: CooklogSpacing.screenHorizontal },
  meta: { color: CooklogColors.textMuted, marginTop: 6, paddingHorizontal: CooklogSpacing.screenHorizontal },
  description: { color: CooklogColors.text, lineHeight: 22, marginTop: 12, paddingHorizontal: CooklogSpacing.screenHorizontal },
  actions: {
    marginTop: 16,
    marginHorizontal: CooklogSpacing.screenHorizontal,
    gap: 10,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: CooklogColors.border,
    borderRadius: CooklogRadii.button,
    padding: 12,
    backgroundColor: CooklogColors.surface,
  },
  actionLabel: { color: CooklogColors.primary, fontWeight: '700' },
  section: { fontSize: 20, fontWeight: '700', color: CooklogColors.text, marginTop: 20, paddingHorizontal: CooklogSpacing.screenHorizontal },
  line: { color: CooklogColors.text, lineHeight: 22, marginTop: 8, paddingHorizontal: CooklogSpacing.screenHorizontal },
  notes: { color: CooklogColors.textMuted, lineHeight: 22, marginTop: 8, paddingHorizontal: CooklogSpacing.screenHorizontal },
});
