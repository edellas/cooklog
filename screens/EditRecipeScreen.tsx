import { CooklogColors, CooklogRadii, CooklogSpacing } from '@/constants/cooklogTheme';
import { RECIPE_CATEGORIES, useRecipes } from '@/contexts/RecipeContext';
import type { Ingredient, Recipe, RecipeCategory } from '@/types/cooklog';
import { hrefRecipeDetail } from '@/lib/cooklogHref';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function tempId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function emptyRecipe(): Recipe {
  const now = new Date().toISOString();
  return {
    id: tempId('r'),
    title: '',
    description: '',
    imageUrl:
      'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=900&q=80&auto=format&fit=crop',
    category: 'Altro',
    cookingTimeMinutes: 30,
    servings: 2,
    ingredients: [
      { id: tempId('ing'), name: '', quantity: '' },
    ],
    steps: [{ id: tempId('st'), order: 1, text: '' }],
    personalNotes: '',
    isFavorite: false,
    createdAt: now,
    updatedAt: now,
  };
}

type Props = {
  mode: 'create' | 'edit';
};

export function EditRecipeScreen({ mode }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { getRecipeById, addRecipe, replaceRecipe, deleteRecipe } = useRecipes();

  const [draft, setDraft] = useState<Recipe>(() => emptyRecipe());

  useEffect(() => {
    if (mode === 'edit' && id) {
      const existing = getRecipeById(id);
      if (existing) {
        setDraft({
          ...existing,
          ingredients: existing.ingredients.map((i) => ({ ...i })),
          steps: existing.steps.map((s) => ({ ...s })),
        });
      }
    } else if (mode === 'create') {
      setDraft(emptyRecipe());
    }
  }, [mode, id, getRecipeById]);

  const setTitle = (title: string) => setDraft((d) => ({ ...d, title }));
  const setDescription = (description: string) => setDraft((d) => ({ ...d, description }));
  const setCategory = (category: RecipeCategory) => setDraft((d) => ({ ...d, category }));
  const setCooking = (v: string) => {
    const n = parseInt(v.replace(/\D/g, ''), 10);
    setDraft((d) => ({ ...d, cookingTimeMinutes: Number.isFinite(n) ? Math.max(0, n) : 0 }));
  };
  const setServings = (v: string) => {
    const n = parseInt(v.replace(/\D/g, ''), 10);
    setDraft((d) => ({ ...d, servings: Number.isFinite(n) ? Math.max(1, n) : 1 }));
  };
  const setNotes = (personalNotes: string) => setDraft((d) => ({ ...d, personalNotes }));

  const updateIngredient = (index: number, patch: Partial<Ingredient>) => {
    setDraft((d) => {
      const ingredients = d.ingredients.map((ing, i) => (i === index ? { ...ing, ...patch } : ing));
      return { ...d, ingredients };
    });
  };

  const addIngredient = () => {
    setDraft((d) => ({
      ...d,
      ingredients: [...d.ingredients, { id: tempId('ing'), name: '', quantity: '' }],
    }));
  };

  const removeIngredient = (index: number) => {
    setDraft((d) => ({
      ...d,
      ingredients: d.ingredients.filter((_, i) => i !== index),
    }));
  };

  const updateStep = (index: number, text: string) => {
    setDraft((d) => {
      const steps = d.steps.map((s, i) => (i === index ? { ...s, text } : s));
      return { ...d, steps };
    });
  };

  const addStep = () => {
    setDraft((d) => ({
      ...d,
      steps: [...d.steps, { id: tempId('st'), order: d.steps.length + 1, text: '' }],
    }));
  };

  const removeStep = (index: number) => {
    setDraft((d) => {
      const steps = d.steps
        .filter((_, i) => i !== index)
        .map((s, i) => ({ ...s, order: i + 1 }));
      return { ...d, steps };
    });
  };

  const onSave = () => {
    if (!draft.title.trim()) {
      Alert.alert('Titolo mancante', 'Inserisci un titolo per salvare la ricetta.');
      return;
    }
    const cleanedIngredients = draft.ingredients.filter((i) => i.name.trim() || i.quantity.trim());
    const cleanedSteps = draft.steps
      .map((s, idx) => ({ ...s, order: idx + 1 }))
      .filter((s) => s.text.trim());
    if (cleanedIngredients.length === 0) {
      Alert.alert('Ingredienti', 'Aggiungi almeno un ingrediente con nome o quantità.');
      return;
    }
    if (cleanedSteps.length === 0) {
      Alert.alert('Preparazione', 'Aggiungi almeno un passaggio.');
      return;
    }
    const now = new Date().toISOString();
    const toSave: Recipe = {
      ...draft,
      ingredients: cleanedIngredients,
      steps: cleanedSteps,
      updatedAt: now,
      createdAt: mode === 'create' ? now : draft.createdAt,
    };
    if (mode === 'create') {
      addRecipe(toSave);
      router.replace(hrefRecipeDetail(toSave.id));
    } else {
      replaceRecipe(toSave);
      router.back();
    }
  };

  const onDelete = () => {
    if (mode !== 'edit' || !id) return;
    Alert.alert('Elimina ricetta', 'Questa azione non può essere annullata in questa versione.', [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Elimina',
        style: 'destructive',
        onPress: () => {
          deleteRecipe(id);
          router.replace('/(tabs)');
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      keyboardShouldPersistTaps="handled">
      <View style={styles.pad}>
        <Text style={styles.label}>Titolo</Text>
        <TextInput
          value={draft.title}
          onChangeText={setTitle}
          placeholder="Nome del piatto"
          placeholderTextColor={CooklogColors.textSubtle}
          style={styles.input}
        />

        <Text style={styles.label}>Descrizione</Text>
        <TextInput
          value={draft.description}
          onChangeText={setDescription}
          placeholder="Breve descrizione"
          placeholderTextColor={CooklogColors.textSubtle}
          style={[styles.input, styles.multiline]}
          multiline
        />

        <Text style={styles.label}>Categoria</Text>
        <View style={styles.chips}>
          {RECIPE_CATEGORIES.map((c) => {
            const active = draft.category === c;
            return (
              <Pressable
                key={c}
                onPress={() => setCategory(c)}
                style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.row2}>
          <View style={styles.half}>
            <Text style={styles.label}>Tempo (min)</Text>
            <TextInput
              value={String(draft.cookingTimeMinutes)}
              onChangeText={setCooking}
              keyboardType="number-pad"
              style={styles.input}
            />
          </View>
          <View style={styles.half}>
            <Text style={styles.label}>Porzioni</Text>
            <TextInput
              value={String(draft.servings)}
              onChangeText={setServings}
              keyboardType="number-pad"
              style={styles.input}
            />
          </View>
        </View>

        <Text style={styles.section}>Ingredienti</Text>
        {draft.ingredients.map((ing, index) => (
          <View key={ing.id} style={styles.ingRow}>
            <TextInput
              value={ing.name}
              onChangeText={(t) => updateIngredient(index, { name: t })}
              placeholder="Ingrediente"
              placeholderTextColor={CooklogColors.textSubtle}
              style={[styles.input, styles.ingName]}
            />
            <TextInput
              value={ing.quantity}
              onChangeText={(t) => updateIngredient(index, { quantity: t })}
              placeholder="Quantità"
              placeholderTextColor={CooklogColors.textSubtle}
              style={[styles.input, styles.ingQty]}
            />
            <Pressable onPress={() => removeIngredient(index)} style={styles.remove}>
              <Text style={styles.removeLabel}>Rimuovi</Text>
            </Pressable>
          </View>
        ))}
        <Pressable onPress={addIngredient} style={styles.addLine}>
          <Text style={styles.addLineLabel}>Aggiungi ingrediente</Text>
        </Pressable>

        <Text style={styles.section}>Preparazione</Text>
        {draft.steps.map((step, index) => (
          <View key={step.id} style={styles.stepBlock}>
            <Text style={styles.stepLabel}>Passaggio {index + 1}</Text>
            <TextInput
              value={step.text}
              onChangeText={(t) => updateStep(index, t)}
              placeholder="Descrivi il passaggio"
              placeholderTextColor={CooklogColors.textSubtle}
              style={[styles.input, styles.multiline]}
              multiline
            />
            {draft.steps.length > 1 ? (
              <Pressable onPress={() => removeStep(index)} style={styles.remove}>
                <Text style={styles.removeLabel}>Rimuovi passaggio</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        <Pressable onPress={addStep} style={styles.addLine}>
          <Text style={styles.addLineLabel}>Aggiungi passaggio</Text>
        </Pressable>

        <Text style={styles.label}>Note personali</Text>
        <TextInput
          value={draft.personalNotes}
          onChangeText={setNotes}
          placeholder="Varianti, accorgimenti, abbinamenti"
          placeholderTextColor={CooklogColors.textSubtle}
          style={[styles.input, styles.multiline]}
          multiline
        />

        <Pressable onPress={onSave} style={({ pressed }) => [styles.save, pressed && styles.pressed]}>
          <Text style={styles.saveLabel}>{mode === 'create' ? 'Salva ricetta' : 'Salva modifiche'}</Text>
        </Pressable>

        {mode === 'edit' ? (
          <Pressable
            onPress={onDelete}
            style={({ pressed }) => [styles.delete, pressed && styles.pressed]}>
            <Text style={styles.deleteLabel}>Elimina ricetta</Text>
          </Pressable>
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
  pad: {
    paddingHorizontal: CooklogSpacing.screenHorizontal,
    paddingTop: 12,
    gap: 4,
  },
  label: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
    color: CooklogColors.textMuted,
    marginBottom: 6,
  },
  section: {
    marginTop: 18,
    marginBottom: 8,
    fontSize: 17,
    fontWeight: '700',
    color: CooklogColors.text,
  },
  input: {
    borderWidth: 1,
    borderColor: CooklogColors.border,
    borderRadius: CooklogRadii.input,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: CooklogColors.text,
    backgroundColor: CooklogColors.surface,
  },
  multiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: CooklogRadii.chip,
    borderWidth: 1,
    borderColor: CooklogColors.border,
    backgroundColor: CooklogColors.surface,
  },
  chipActive: {
    backgroundColor: CooklogColors.primary,
    borderColor: CooklogColors.primary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: CooklogColors.textMuted,
  },
  chipTextActive: {
    color: CooklogColors.backgroundElevated,
  },
  row2: {
    flexDirection: 'row',
    gap: 12,
  },
  half: {
    flex: 1,
  },
  ingRow: {
    gap: 8,
    marginBottom: 12,
  },
  ingName: {
    marginBottom: 0,
  },
  ingQty: {
    marginBottom: 0,
  },
  remove: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  removeLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: CooklogColors.danger,
  },
  addLine: {
    marginBottom: 8,
    paddingVertical: 8,
  },
  addLineLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: CooklogColors.accent,
  },
  stepBlock: {
    marginBottom: 12,
    gap: 6,
  },
  stepLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: CooklogColors.textMuted,
  },
  save: {
    marginTop: 22,
    backgroundColor: CooklogColors.primary,
    borderRadius: CooklogRadii.button,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: CooklogColors.backgroundElevated,
  },
  delete: {
    marginTop: 14,
    borderRadius: CooklogRadii.button,
    borderWidth: 1,
    borderColor: CooklogColors.danger,
    paddingVertical: 14,
    alignItems: 'center',
  },
  deleteLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: CooklogColors.danger,
  },
  pressed: {
    opacity: 0.92,
  },
});
