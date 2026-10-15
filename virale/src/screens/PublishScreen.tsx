import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PostView } from '../components/PostView';
import { TEXT_BACKGROUNDS } from '../services/demoContent';
import { getMyEntry, isDemo, publish } from '../services/api';
import { colors } from '../theme';
import type { MediaType, Me, Post } from '../types';

const TYPES: { key: MediaType; label: string }[] = [
  { key: 'video', label: '🎬 Video' },
  { key: 'image', label: '📷 Foto' },
  { key: 'text', label: '✍️ Testo' },
];

export function PublishScreen({ me, onPublished }: { me: Me; onPublished: (post: Post, joinedArena: boolean) => void }) {
  const insets = useSafeAreaInsets();
  const [type, setType] = useState<MediaType>('text');
  const [asset, setAsset] = useState<{ uri: string; mimeType?: string } | null>(null);
  const [body, setBody] = useState('');
  const [caption, setCaption] = useState('');
  const [background, setBackground] = useState(TEXT_BACKGROUNDS[0]);
  const [joinArena, setJoinArena] = useState(true);
  const [alreadyIn, setAlreadyIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getMyEntry()
      .then((entry) => {
        setAlreadyIn(Boolean(entry));
        if (entry) setJoinArena(false);
      })
      .catch(() => undefined);
  }, []);

  const pick = async (fromCamera: boolean) => {
    setError(null);
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: type === 'video' ? ['videos'] : ['images'],
      allowsEditing: type === 'image',
      aspect: [9, 16],
      quality: 0.7,
      videoMaxDuration: 60,
      // Sul web (anteprima demo) la foto viene salvata come data URI per sopravvivere al ricaricamento.
      base64: Platform.OS === 'web' && type === 'image' && isDemo,
    };
    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return setError('Permesso fotocamera negato.');
    }
    const res = fromCamera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const a = res.canceled ? null : res.assets[0];
    if (!a) return;
    if (a.type === 'video' && a.duration && a.duration > 61000) return setError('Massimo 60 secondi.');
    const uri = a.base64 ? `data:${a.mimeType ?? 'image/jpeg'};base64,${a.base64}` : a.uri;
    setAsset({ uri, mimeType: a.mimeType ?? undefined });
  };

  const onSubmit = async () => {
    try {
      setBusy(true);
      setError(null);
      const post = await publish({
        mediaType: type,
        localUri: asset?.uri,
        mimeType: asset?.mimeType,
        body,
        caption,
        background,
        joinArena: joinArena && !alreadyIn,
      });
      setAsset(null);
      setBody('');
      setCaption('');
      onPublished(post, joinArena && !alreadyIn);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const preview: Post = {
    id: 'preview',
    authorId: me.id,
    authorUsername: me.username,
    authorName: me.displayName,
    mediaType: type,
    mediaUrl: asset?.uri ?? null,
    body: body || 'Scrivi qualcosa che merita di essere visto da tutti…',
    caption,
    background,
    createdAt: new Date().toISOString(),
  };
  const ready = type === 'text' ? body.trim().length > 0 : Boolean(asset);

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Pubblica</Text>

      <View style={styles.segment}>
        {TYPES.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => {
              setType(t.key);
              setAsset(null);
            }}
            style={[styles.segmentItem, type === t.key && styles.segmentActive]}>
            <Text style={styles.segmentText}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.preview}>
        {type === 'text' || asset ? (
          <PostView post={preview} active />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>{type === 'video' ? 'Video verticale, max 60 s' : 'Foto verticale'}</Text>
            <View style={styles.row}>
              <Pressable style={styles.button} onPress={() => void pick(false)}>
                <Text style={styles.buttonText}>Scegli dalla galleria</Text>
              </Pressable>
              {Platform.OS !== 'web' ? (
                <Pressable style={styles.button} onPress={() => void pick(true)}>
                  <Text style={styles.buttonText}>{type === 'video' ? 'Registra' : 'Scatta'}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
        {asset ? (
          <Pressable style={styles.change} onPress={() => setAsset(null)}>
            <Text style={styles.buttonText}>Cambia</Text>
          </Pressable>
        ) : null}
      </View>

      {type === 'text' ? (
        <>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={body}
            onChangeText={setBody}
            placeholder="Il tuo testo (max 280 caratteri)"
            placeholderTextColor={colors.textSubtle}
            maxLength={280}
            multiline
          />
          <View style={styles.row}>
            {TEXT_BACKGROUNDS.map((bg) => {
              const [a, b] = bg.split(',');
              return (
                <Pressable key={bg} onPress={() => setBackground(bg)} accessibilityLabel="Sfondo">
                  <LinearGradient colors={[a, b]} style={[styles.swatch, background === bg && styles.swatchActive]} />
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      <TextInput
        style={styles.input}
        value={caption}
        onChangeText={setCaption}
        placeholder="Didascalia"
        placeholderTextColor={colors.textSubtle}
        maxLength={150}
      />

      <View style={styles.toggle}>
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleTitle}>🔥 Candida al Virale di domani</Text>
          <Text style={styles.toggleText}>
            {alreadyIn
              ? 'Oggi sei già in gara con un altro contenuto: uno al giorno.'
              : 'Uno al giorno. Se vinci, domani ti vede chiunque apra l’app.'}
          </Text>
        </View>
        <Switch value={joinArena && !alreadyIn} onValueChange={setJoinArena} disabled={alreadyIn} trackColor={{ true: colors.accent }} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={[styles.submit, (!ready || busy) && styles.disabled]} onPress={() => void onSubmit()} disabled={!ready || busy}>
        {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitText}>Pubblica</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 12 },
  title: { color: '#FFF', fontSize: 28, fontWeight: '900' },
  segment: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 4 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { color: '#FFF', fontWeight: '700' },
  preview: { height: 340, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 16 },
  placeholderText: { color: colors.textMuted, fontSize: 14 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  button: { backgroundColor: colors.surfaceAlt, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: '#FFF', fontWeight: '700' },
  change: { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    color: '#FFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  swatch: { width: 36, height: 36, borderRadius: 18 },
  swatchActive: { borderWidth: 3, borderColor: '#FFF' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 12 },
  toggleTitle: { color: '#FFF', fontWeight: '800' },
  toggleText: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  error: { color: colors.danger, fontWeight: '600' },
  submit: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  submitText: { color: '#FFF', fontWeight: '900', fontSize: 16 },
  disabled: { opacity: 0.5 },
});
