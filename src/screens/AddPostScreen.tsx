import { CooklogColors, CooklogRadii, CooklogSpacing } from '@/constants/cooklogTheme';
import { EmptyState } from '@/src/components/EmptyState';
import { ErrorState } from '@/src/components/ErrorState';
import { InterestChips } from '@/src/components/InterestChips';
import { LoadingState } from '@/src/components/LoadingState';
import { useAuth } from '@/src/providers/AuthProvider';
import { generateRecipeFromImage } from '@/src/services/aiService';
import { pickImageFromLibrary, uploadFoodMedia } from '@/src/services/mediaService';
import { buildRecipeFromPost, saveRecipe } from '@/src/services/recipeService';
import { getSubscriptionStatus } from '@/src/services/subscriptionService';
import { INTEREST_OPTIONS } from '@/src/types';
import type { FoodPost, Recipe } from '@/src/types';
import { getStoredJson, setStoredJson } from '@/src/services/storage';
import { STORAGE_KEYS } from '@/src/services/storageKeys';
import { useRouter, type Href } from 'expo-router';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function AddPostScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Altro');
  const [time, setTime] = useState('20');
  const [servings, setServings] = useState('2');
  const [ingredientsText, setIngredientsText] = useState('');
  const [stepsText, setStepsText] = useState('');
  const [notes, setNotes] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [publishToFeed, setPublishToFeed] = useState(true);
  const [saveToRecipes, setSaveToRecipes] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return <EmptyState title="Sessione non disponibile." />;

  const toggleInterest = (item: string) => {
    setInterests((prev) => (prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]));
  };

  const pickPhoto = async () => {
    try {
      setError(null);
      const next = await pickImageFromLibrary();
      if (next) setImageUri(next);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onGenerate = async () => {
    if (!imageUri) {
      setError('Seleziona prima un’immagine.');
      return;
    }
    try {
      setBusy(true);
      setError(null);
      const subscription = await getSubscriptionStatus(user.id);
      if (!subscription.isPro && subscription.aiGenerationsUsedThisMonth >= subscription.maxAiGenerations) {
        router.push('/paywall' as Href);
        return;
      }
      const uploaded = await uploadFoodMedia(imageUri, user.id);
      const ai = await generateRecipeFromImage({ imageUrl: uploaded, notes, userId: user.id });
      setTitle(ai.title);
      setDescription(ai.description);
      setCategory(ai.category);
      setTime(String(ai.cookingTimeMinutes));
      setServings(String(ai.servings));
      setIngredientsText(ai.ingredients.map((i) => `${i.name} - ${i.quantity}`).join('\n'));
      setStepsText(ai.steps.map((s) => `${s.order}. ${s.text}`).join('\n'));
      setInterests(ai.interests);
      setNotes(ai.personalNotes);
    } catch {
      setError('Generazione AI non disponibile al momento. Puoi compilare manualmente.');
    } finally {
      setBusy(false);
    }
  };

  const onPublish = async () => {
    const ingredientLines = ingredientsText.split('\n').map((x) => x.trim()).filter(Boolean);
    const stepLines = stepsText.split('\n').map((x) => x.trim()).filter(Boolean);

    if (!title.trim()) return setError('Titolo obbligatorio.');
    if (!category.trim()) return setError('Categoria obbligatoria.');
    if (!ingredientLines.length) return setError('Inserisci almeno un ingrediente.');
    if (!stepLines.length) return setError('Inserisci almeno un passaggio.');
    if (publishToFeed && !imageUri) return setError('Immagine obbligatoria per pubblicare nel feed.');
    if (publishToFeed && interests.length < 1) return setError('Inserisci almeno un interesse.');

    try {
      setBusy(true);
      setError(null);
      const mediaUrl = imageUri ? await uploadFoodMedia(imageUri, user.id) : '';
      const recipe: Recipe = buildRecipeFromPost(user.id, {
        title: title.trim(),
        description: description.trim(),
        imageUrl: mediaUrl,
        category,
        cookingTimeMinutes: parseInt(time, 10) || 0,
        servings: parseInt(servings, 10) || 1,
        ingredients: ingredientLines.map((line, idx) => {
          const [name, qty] = line.split(' - ');
          return { id: newId('ing'), name: name ?? line, quantity: qty ?? '', sortOrder: idx + 1 };
        }),
        steps: stepLines.map((line, idx) => ({
          id: newId('step'),
          order: idx + 1,
          text: line.replace(/^\d+\.\s*/, ''),
        })),
        personalNotes: notes.trim(),
      });

      if (saveToRecipes) {
        await saveRecipe(user.id, recipe);
      }

      if (publishToFeed) {
        const localPosts = await getStoredJson<FoodPost[]>(STORAGE_KEYS.feedPosts, []);
        const newPost: FoodPost = {
          id: newId('post'),
          authorId: user.id,
          authorName: profile?.displayName ?? 'Utente',
          authorAvatarUrl: profile?.avatarUrl ?? null,
          title: recipe.title,
          description: recipe.description,
          mediaUrl: mediaUrl || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=1200&q=80&auto=format&fit=crop',
          mediaType: 'image',
          recipeId: recipe.id,
          category: recipe.category,
          interests,
          cookingTimeMinutes: recipe.cookingTimeMinutes,
          servings: recipe.servings,
          likeCount: 0,
          commentCount: 0,
          saveCount: 0,
          isLikedByCurrentUser: false,
          isSavedByCurrentUser: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await setStoredJson(STORAGE_KEYS.feedPosts, [newPost, ...localPosts]);
      }
      router.replace('/' as Href);
    } catch {
      setError('Pubblicazione non riuscita. Riprova.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Aggiungi</Text>
      <Text style={styles.sub}>Pubblica un nuovo piatto o crea una ricetta nel tuo ricettario.</Text>
      <Pressable onPress={() => void pickPhoto()} style={styles.pickBtn}>
        <Text style={styles.pickLabel}>{imageUri ? 'Cambia immagine' : 'Scegli immagine'}</Text>
      </Pressable>
      {imageUri ? <Image source={{ uri: imageUri }} style={styles.preview} contentFit="cover" /> : null}

      <Pressable onPress={() => void onGenerate()} style={styles.secondary}>
        <Text style={styles.secondaryLabel}>Genera da foto</Text>
      </Pressable>
      {busy ? <LoadingState message="Sto creando la ricetta..." /> : null}
      {error ? <ErrorState message={error} /> : null}

      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Titolo piatto" />
      <TextInput style={styles.input} value={description} onChangeText={setDescription} placeholder="Descrizione breve" />
      <TextInput style={styles.input} value={category} onChangeText={setCategory} placeholder="Categoria" />
      <View style={styles.row}>
        <TextInput style={[styles.input, styles.half]} value={time} onChangeText={setTime} placeholder="Tempo (min)" keyboardType="number-pad" />
        <TextInput style={[styles.input, styles.half]} value={servings} onChangeText={setServings} placeholder="Porzioni" keyboardType="number-pad" />
      </View>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={ingredientsText}
        onChangeText={setIngredientsText}
        placeholder="Ingredienti (uno per riga, es: Pomodoro - 300 g)"
        multiline
      />
      <TextInput
        style={[styles.input, styles.multiline]}
        value={stepsText}
        onChangeText={setStepsText}
        placeholder="Passaggi (uno per riga)"
        multiline
      />
      <TextInput style={[styles.input, styles.multiline]} value={notes} onChangeText={setNotes} placeholder="Note personali" multiline />
      <InterestChips options={INTEREST_OPTIONS} selected={interests} onToggle={toggleInterest} />

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Pubblica nel feed</Text>
        <Switch value={publishToFeed} onValueChange={setPublishToFeed} />
      </View>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Salva anche nel mio ricettario</Text>
        <Switch value={saveToRecipes} onValueChange={setSaveToRecipes} />
      </View>

      <Pressable onPress={() => void onPublish()} style={styles.primary}>
        <Text style={styles.primaryLabel}>Pubblica</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CooklogColors.background },
  content: { padding: CooklogSpacing.screenHorizontal, gap: 10, paddingBottom: 120 },
  title: { fontSize: 30, fontWeight: '700', color: CooklogColors.text, marginTop: 8 },
  sub: { color: CooklogColors.textMuted, lineHeight: 20, marginBottom: 8 },
  pickBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CooklogColors.primary,
    paddingVertical: 12,
    alignItems: 'center',
  },
  pickLabel: { color: CooklogColors.primary, fontWeight: '700' },
  preview: { width: '100%', height: 220, borderRadius: 14, backgroundColor: CooklogColors.border },
  secondary: { borderRadius: 12, borderWidth: 1, borderColor: CooklogColors.border, paddingVertical: 12, alignItems: 'center' },
  secondaryLabel: { color: CooklogColors.text, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: CooklogColors.border,
    backgroundColor: CooklogColors.surface,
    borderRadius: CooklogRadii.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  toggleLabel: { color: CooklogColors.text, fontWeight: '500' },
  primary: {
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: CooklogColors.primary,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryLabel: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
