import { CooklogColors, CooklogRadii, CooklogSpacing } from '@/constants/cooklogTheme';
import { EmptyState } from '@/src/components/EmptyState';
import { useAuth } from '@/src/providers/AuthProvider';
import { deleteRecipe as deleteRecipeService, loadRecipesForUser, saveRecipe } from '@/src/services/recipeService';
import type { Recipe } from '@/src/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';

export function EditRecipeSocialScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [recipe, setRecipe] = useState<Recipe | null>(null);

  useEffect(() => {
    if (!user) return;
    void loadRecipesForUser(user.id).then((list) => setRecipe(list.find((r) => r.id === id) ?? null));
  }, [id, user]);

  if (!user) return <EmptyState title="Sessione non disponibile." />;
  if (!recipe) return <EmptyState title="Ricetta non modificabile o non trovata." />;

  const onSave = async () => {
    await saveRecipe(user.id, { ...recipe, updatedAt: new Date().toISOString() });
    router.back();
  };

  const onDelete = () => {
    Alert.alert('Elimina ricetta', 'Confermi l’eliminazione?', [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Elimina',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteRecipeService(user.id, recipe.id);
            router.replace('/recipes');
          })();
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Modifica ricetta</Text>
      <TextInput style={styles.input} value={recipe.title} onChangeText={(v) => setRecipe({ ...recipe, title: v })} placeholder="Titolo" />
      <TextInput style={styles.input} value={recipe.category} onChangeText={(v) => setRecipe({ ...recipe, category: v })} placeholder="Categoria" />
      <TextInput
        style={[styles.input, styles.multiline]}
        multiline
        value={recipe.description}
        onChangeText={(v) => setRecipe({ ...recipe, description: v })}
        placeholder="Descrizione"
      />
      <TextInput
        style={[styles.input, styles.multiline]}
        multiline
        value={recipe.personalNotes}
        onChangeText={(v) => setRecipe({ ...recipe, personalNotes: v })}
        placeholder="Note personali"
      />
      <Pressable onPress={() => void onSave()} style={styles.primary}>
        <Text style={styles.primaryLabel}>Salva modifiche</Text>
      </Pressable>
      <Pressable onPress={onDelete} style={styles.danger}>
        <Text style={styles.dangerLabel}>Elimina ricetta</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CooklogColors.background },
  content: { padding: CooklogSpacing.screenHorizontal, gap: 10, paddingBottom: 80 },
  title: { marginTop: 12, fontSize: 28, fontWeight: '700', color: CooklogColors.text },
  input: {
    borderWidth: 1,
    borderColor: CooklogColors.border,
    backgroundColor: CooklogColors.surface,
    borderRadius: CooklogRadii.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  primary: { marginTop: 10, borderRadius: 12, backgroundColor: CooklogColors.primary, paddingVertical: 14, alignItems: 'center' },
  primaryLabel: { color: '#fff', fontWeight: '700' },
  danger: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CooklogColors.danger,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dangerLabel: { color: CooklogColors.danger, fontWeight: '700' },
});
