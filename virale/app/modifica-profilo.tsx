import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../src/components/Avatar';
import { Field } from '../src/components/Field';
import { Icon } from '../src/components/Icon';
import { haptic, Press } from '../src/components/Press';
import { useToast } from '../src/components/Toast';
import { Txt } from '../src/components/Txt';
import { charCount, clampChars } from '../src/design/text';
import { color, radius, space } from '../src/design/tokens';
import { getProfile, updateProfile } from '../src/services/api';
import { friendlyError } from '../src/services/errors';
import { useSession } from '../src/state/session';
import { useGoBack } from '../src/state/useGoBack';

const BIO_MAX = 160;
const NAME_MAX = 30;

/** Modifica del proprio profilo: foto (quadrata), nome mostrato (una volta ogni 7 giorni) e bio. */
export default function EditProfile() {
  const insets = useSafeAreaInsets();
  const goBack = useGoBack('/profilo');
  const toast = useToast();
  const { me, updateMe, bump, status } = useSession();
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [initial, setInitial] = useState({ name: '', bio: '', avatar: null as string | null });
  const [photo, setPhoto] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [nameLockedUntil, setNameLockedUntil] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = status?.identity?.canAct === false;

  useEffect(() => {
    if (!me) return;
    let alive = true;
    getProfile(me.username)
      .then(({ profile }) => {
        if (!alive) return;
        setName(profile.displayName);
        setBio(profile.bio);
        setInitial({ name: profile.displayName, bio: profile.bio, avatar: profile.avatar ?? null });
        setNameLockedUntil(profile.nameChangeFrom && Date.parse(profile.nameChangeFrom) > Date.now() ? profile.nameChangeFrom : null);
        setLoaded(true);
      })
      .catch((e: unknown) => alive && setError(friendlyError(e)));
    return () => {
      alive = false;
    };
  }, [me]);

  const pickPhoto = async () => {
    setError(null);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
      if (res.canceled || !res.assets?.length) return;
      const a = res.assets[0];
      setPhoto({ uri: a.uri, width: a.width, height: a.height });
      setRemovePhoto(false);
    } catch {
      setError('Non riesco ad aprire la galleria. Riprova.');
    }
  };

  const shownAvatar = removePhoto ? null : (photo?.uri ?? initial.avatar);
  const changed = name.trim() !== initial.name || bio.trim() !== initial.bio || Boolean(photo) || (removePhoto && Boolean(initial.avatar));

  const save = async () => {
    if (busy || !changed) return;
    try {
      setBusy(true);
      setError(null);
      const next = await updateProfile({
        displayName: name.trim() !== initial.name ? name : undefined,
        bio: bio.trim() !== initial.bio ? bio : undefined,
        photo: photo ?? undefined,
        removePhoto: removePhoto && !photo,
      });
      updateMe({ id: next.id, username: next.username, displayName: next.displayName, avatar: next.avatar });
      haptic('success');
      bump();
      toast('Profilo aggiornato.');
      goBack();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const lockedText = nameLockedUntil
    ? `Puoi cambiarlo di nuovo dal ${new Date(nameLockedUntil).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}.`
    : 'Puoi cambiarlo una volta ogni 7 giorni.';

  return (
    <KeyboardAvoidingView style={[styles.root, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.bar}>
        <Press style={styles.round} onPress={goBack} accessibilityRole="button" accessibilityLabel="Indietro">
          <Icon name="indietro" />
        </Press>
        <Txt variant="title">Modifica profilo</Txt>
        <View style={{ width: 40 }} />
      </View>
      {!loaded && !error ? (
        <ActivityIndicator color={color.giallo} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space[5], gap: space[5], paddingBottom: insets.bottom + space[10] }} keyboardShouldPersistTaps="handled">
          {blocked ? (
            <Txt variant="small" tone={color.matita}>
              Per modificare il profilo serve la verifica dell’età.
            </Txt>
          ) : null}
          <View style={styles.photoRow}>
            <Avatar name={name || me?.displayName || '?'} seed={me?.username ?? ''} uri={shownAvatar} size={96} />
            <View style={{ flex: 1, gap: space[2] }}>
              <Press style={styles.pill} onPress={() => void pickPhoto()} disabled={busy || blocked} accessibilityRole="button">
                <Icon name="galleria" size={18} />
                <Txt variant="label">Cambia foto</Txt>
              </Press>
              {shownAvatar ? (
                <Press
                  style={styles.pill}
                  onPress={() => {
                    setPhoto(null);
                    setRemovePhoto(true);
                  }}
                  disabled={busy || blocked}
                  accessibilityRole="button">
                  <Icon name="cestino" size={18} color={color.matita} />
                  <Txt variant="label" tone={color.matita}>
                    Rimuovi foto
                  </Txt>
                </Press>
              ) : null}
            </View>
          </View>

          <View style={{ gap: space[2] }}>
            <Txt variant="label">Nome</Txt>
            <Field
              value={name}
              onChangeText={(t) => setName(clampChars(t, NAME_MAX))}
              placeholder="Il tuo nome"
              accessibilityLabel="Nome"
              editable={!nameLockedUntil && !blocked}
              autoComplete="name"
            />
            <Txt variant="meta" tone={color.paperFaint}>
              {lockedText}
            </Txt>
          </View>

          <View style={{ gap: space[2] }}>
            <Txt variant="label">Bio</Txt>
            <Field
              containerStyle={{ alignItems: 'flex-start' }}
              style={styles.bio}
              value={bio}
              onChangeText={(t) => setBio(clampChars(t, BIO_MAX))}
              placeholder="Racconta qualcosa di te"
              accessibilityLabel="Bio"
              editable={!blocked}
              multiline
            />
            <Txt variant="meta" tone={charCount(bio) >= BIO_MAX ? color.matita : color.paperFaint} style={{ alignSelf: 'flex-end' }}>
              {charCount(bio)}/{BIO_MAX}
            </Txt>
          </View>

          <View style={{ gap: space[2] }}>
            <Txt variant="label">Nome utente</Txt>
            <View style={styles.readonly}>
              <Txt variant="body" tone={color.paperDim}>
                @{me?.username}
              </Txt>
            </View>
            <Txt variant="meta" tone={color.paperFaint}>
              Il nome utente non si può cambiare.
            </Txt>
          </View>

          {error ? (
            <Txt variant="small" tone={color.matita} accessibilityLiveRegion="polite">
              {error}
            </Txt>
          ) : null}

          <Press style={[styles.save, (!changed || busy || blocked) && styles.off]} onPress={() => void save()} disabled={!changed || busy || blocked} accessibilityRole="button">
            {busy ? (
              <ActivityIndicator color={color.canvas} />
            ) : (
              <Txt variant="label" tone={color.canvas}>
                Salva
              </Txt>
            )}
          </Press>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], paddingVertical: space[2] },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space[5] },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space[2], alignSelf: 'flex-start', backgroundColor: color.raised, borderRadius: radius.pill, paddingHorizontal: 16, minHeight: 44 },
  bio: { minHeight: 96, lineHeight: 22, textAlignVertical: 'top' },
  readonly: { backgroundColor: color.raised, borderRadius: radius.control, paddingHorizontal: space[4], paddingVertical: 13, opacity: 0.7 },
  save: { backgroundColor: color.giallo, borderRadius: radius.control, paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  off: { opacity: 0.45 },
});
