import { CooklogColors, CooklogRadii, CooklogSpacing } from '@/constants/cooklogTheme';
import { ErrorState } from '@/src/components/ErrorState';
import { InterestChips } from '@/src/components/InterestChips';
import { LoadingState } from '@/src/components/LoadingState';
import { useAuth } from '@/src/providers/AuthProvider';
import { pickImageFromLibrary, uploadAvatar } from '@/src/services/mediaService';
import { INTEREST_OPTIONS } from '@/src/types';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';

export function EditProfileScreen() {
  const router = useRouter();
  const { profile, updateProfile, interests, saveInterests, user } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl ?? '');
  const [selectedInterests, setSelectedInterests] = useState<string[]>(interests);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleInterest = (item: string) => {
    setSelectedInterests((prev) => (prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]));
  };

  const pickAvatar = async () => {
    if (!user) return;
    try {
      const uri = await pickImageFromLibrary();
      if (!uri) return;
      const uploaded = await uploadAvatar(uri, user.id);
      setAvatarUrl(uploaded);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onSave = async () => {
    if (!username.trim() || /\s/.test(username) || username !== username.toLowerCase()) {
      setError('Username obbligatorio, minuscolo e senza spazi.');
      return;
    }
    if (selectedInterests.length < 3) {
      setError('Seleziona almeno 3 interessi.');
      return;
    }
    try {
      setBusy(true);
      setError(null);
      await updateProfile({ displayName, username, bio, avatarUrl });
      await saveInterests(selectedInterests);
      router.back();
    } catch {
      setError('Aggiornamento profilo non riuscito.');
    } finally {
      setBusy(false);
    }
  };

  if (busy) return <LoadingState message="Aggiornamento profilo..." />;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Modifica profilo</Text>
      <Pressable onPress={() => void pickAvatar()} style={styles.avatarPick}>
        {avatarUrl ? <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" /> : null}
        <Text style={styles.avatarPickLabel}>{avatarUrl ? 'Cambia avatar' : 'Carica avatar'}</Text>
      </Pressable>
      {error ? <ErrorState message={error} /> : null}
      <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="Display name" />
      <TextInput style={styles.input} value={username} onChangeText={setUsername} placeholder="Username" autoCapitalize="none" />
      <TextInput style={[styles.input, styles.multiline]} value={bio} onChangeText={setBio} placeholder="Bio" multiline />
      <InterestChips options={INTEREST_OPTIONS} selected={selectedInterests} onToggle={toggleInterest} />
      <Pressable onPress={() => void onSave()} style={styles.button}>
        <Text style={styles.buttonLabel}>Salva</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CooklogColors.background },
  content: { padding: CooklogSpacing.screenHorizontal, gap: 12, paddingBottom: 80 },
  title: { marginTop: 12, fontSize: 28, fontWeight: '700', color: CooklogColors.text },
  avatarPick: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CooklogColors.border,
    padding: 12,
    alignItems: 'center',
    gap: 8,
    backgroundColor: CooklogColors.surface,
  },
  avatar: { width: 90, height: 90, borderRadius: 45 },
  avatarPickLabel: { color: CooklogColors.primary, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: CooklogColors.border,
    backgroundColor: CooklogColors.surface,
    borderRadius: CooklogRadii.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  button: {
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: CooklogColors.primary,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonLabel: { color: '#fff', fontWeight: '700' },
});
