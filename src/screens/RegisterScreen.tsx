import { CooklogColors, CooklogRadii, CooklogSpacing } from '@/constants/cooklogTheme';
import { useAuth } from '@/src/providers/AuthProvider';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export function RegisterScreen() {
  const router = useRouter();
  const { register, authError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    try {
      setBusy(true);
      await register({ email: email.trim(), password, username: username.trim(), displayName: displayName.trim() });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Crea il tuo account</Text>
      <Text style={styles.sub}>Registrati per pubblicare e salvare ricette nel tuo feed.</Text>
      <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="Nome visualizzato" />
      <TextInput style={styles.input} value={username} onChangeText={setUsername} placeholder="Username" autoCapitalize="none" />
      <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" keyboardType="email-address" />
      <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
      {authError ? <Text style={styles.error}>{authError}</Text> : null}
      <Pressable onPress={() => void onSubmit()} disabled={busy} style={styles.button}>
        <Text style={styles.buttonLabel}>{busy ? 'Registrazione...' : 'Registrati'}</Text>
      </Pressable>
      <Pressable onPress={() => router.push('/login' as Href)}>
        <Text style={styles.link}>Hai già un account? Accedi</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: CooklogColors.background,
    padding: CooklogSpacing.screenHorizontal,
    justifyContent: 'center',
    gap: 12,
  },
  title: { fontSize: 30, fontWeight: '700', color: CooklogColors.text },
  sub: { color: CooklogColors.textMuted, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: CooklogColors.border,
    borderRadius: CooklogRadii.input,
    backgroundColor: CooklogColors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  button: {
    marginTop: 6,
    borderRadius: CooklogRadii.button,
    backgroundColor: CooklogColors.primary,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonLabel: { color: '#fff', fontWeight: '700', fontSize: 16 },
  link: { color: CooklogColors.primary, textAlign: 'center', marginTop: 8 },
  error: { color: CooklogColors.danger, fontSize: 14 },
});
