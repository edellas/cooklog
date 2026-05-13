import { CooklogColors, CooklogRadii, CooklogSpacing } from '@/constants/cooklogTheme';
import { useRecipes } from '@/contexts/RecipeContext';
import { Image } from 'expo-image';
import { hrefRecipeDetail } from '@/lib/cooklogHref';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function AddRecipeScreen() {
  const router = useRouter();
  const { createRecipe, simulateRecipeFromPhoto } = useRecipes();
  const insets = useSafeAreaInsets();
  const [dishName, setDishName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const onSimulate = () => {
    setBusy(true);
    setTimeout(() => {
      void (async () => {
        try {
          const recipe = simulateRecipeFromPhoto(dishName, notes);
          await createRecipe(recipe);
          router.replace(hrefRecipeDetail(recipe.id));
        } finally {
          setBusy(false);
        }
      })();
    }, 1400);
  };

  const onManual = () => {
    router.push('/recipe/new');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.inner}>
        <Text style={styles.title}>Aggiungi</Text>
        <Text style={styles.sub}>
          Carica o scatta una foto: la generazione è simulata in questa versione, senza intelligenza
          artificiale reale.
        </Text>

        <View style={styles.preview}>
          <Image
            source={{
              uri: 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?w=900&q=80&auto=format&fit=crop',
            }}
            style={styles.previewImage}
            contentFit="cover"
          />
          <Text style={styles.previewHint}>Anteprima dimostrativa</Text>
        </View>

        <Text style={styles.label}>Nome piatto (opzionale)</Text>
        <TextInput
          value={dishName}
          onChangeText={setDishName}
          placeholder="Es. Zuppa di verdure"
          placeholderTextColor={CooklogColors.textSubtle}
          style={styles.input}
        />

        <Text style={styles.label}>Note (opzionali)</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Allergie, varianti, tempo disponibile"
          placeholderTextColor={CooklogColors.textSubtle}
          style={[styles.input, styles.inputMultiline]}
          multiline
        />

        <Pressable
          onPress={() => {
            if (busy) return;
            onSimulate();
          }}
          style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed, busy && styles.disabled]}
          disabled={busy}>
          {busy ? (
            <ActivityIndicator color={CooklogColors.backgroundElevated} />
          ) : (
            <Text style={styles.primaryLabel}>Genera ricetta (demo)</Text>
          )}
        </Pressable>

        <Pressable onPress={onManual} style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}>
          <Text style={styles.secondaryLabel}>Crea manualmente</Text>
        </Pressable>

        <Pressable
          onPress={() =>
            Alert.alert(
              'Foto',
              'In questa build la fotocamera non è collegata: usa Genera ricetta (demo) o Crea manualmente.',
            )
          }
          style={styles.ghost}>
          <Text style={styles.ghostLabel}>Simula scatto foto</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: CooklogColors.background,
  },
  inner: {
    flex: 1,
    paddingHorizontal: CooklogSpacing.screenHorizontal,
    paddingBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: CooklogColors.text,
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  sub: {
    fontSize: 15,
    lineHeight: 22,
    color: CooklogColors.textMuted,
    marginBottom: 20,
  },
  preview: {
    borderRadius: CooklogRadii.card,
    overflow: 'hidden',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: CooklogColors.border,
  },
  previewImage: {
    height: 160,
    width: '100%',
    backgroundColor: CooklogColors.border,
  },
  previewHint: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 13,
    color: CooklogColors.textMuted,
    backgroundColor: CooklogColors.surface,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: CooklogColors.textMuted,
    marginBottom: 6,
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
    marginBottom: 14,
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  primary: {
    backgroundColor: CooklogColors.primary,
    borderRadius: CooklogRadii.button,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryPressed: {
    opacity: 0.92,
  },
  disabled: {
    opacity: 0.7,
  },
  primaryLabel: {
    color: CooklogColors.backgroundElevated,
    fontSize: 16,
    fontWeight: '600',
  },
  secondary: {
    marginTop: 12,
    borderRadius: CooklogRadii.button,
    borderWidth: 1,
    borderColor: CooklogColors.primary,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryPressed: {
    opacity: 0.9,
  },
  secondaryLabel: {
    color: CooklogColors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  ghost: {
    marginTop: 16,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  ghostLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: CooklogColors.accent,
  },
});
