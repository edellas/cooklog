import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { createAccount, isDemo } from '../services/api';
import { colors } from '../theme';
import type { Me } from '../types';

export function OnboardingScreen({ onDone }: { onDone: (me: Me) => void }) {
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    try {
      setBusy(true);
      setError(null);
      onDone(await createAccount(username, name));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.logo}>🔥 Virale</Text>
      <Text style={styles.claim}>Ogni giorno, un solo vincitore.{'\n'}Lo vede chiunque apra l’app.</Text>

      <View style={styles.points}>
        <Point n="1" text="Pubblica un video, una foto o un testo e mettilo in gara." />
        <Point n="2" text="Nell’Arena le persone ti vedono alla cieca: conta quanto ti guardano, non quanti follower hai." />
        <Point n="3" text="A mezzanotte vince uno solo. Domani è la prima cosa che vedono tutti." />
      </View>

      <TextInput
        style={styles.input}
        value={username}
        onChangeText={(v) => setUsername(v.toLowerCase())}
        placeholder="username"
        placeholderTextColor={colors.textSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={24}
      />
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Nome (facoltativo)"
        placeholderTextColor={colors.textSubtle}
        maxLength={40}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={[styles.button, !username && styles.disabled]} onPress={() => void submit()} disabled={!username || busy}>
        {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.buttonText}>Entra</Text>}
      </Pressable>
      {isDemo ? <Text style={styles.demo}>Modalità demo: dati e pubblico simulato restano su questo dispositivo.</Text> : null}
    </KeyboardAvoidingView>
  );
}

function Point({ n, text }: { n: string; text: string }) {
  return (
    <View style={styles.point}>
      <Text style={styles.pointN}>{n}</Text>
      <Text style={styles.pointText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
  logo: { color: '#FFF', fontSize: 44, fontWeight: '900', textAlign: 'center' },
  claim: { color: '#FFF', fontSize: 18, fontWeight: '700', textAlign: 'center', lineHeight: 26, marginBottom: 8 },
  points: { gap: 10, marginBottom: 12 },
  point: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  pointN: { color: '#FFF', backgroundColor: colors.accent, width: 24, height: 24, borderRadius: 12, textAlign: 'center', lineHeight: 24, fontWeight: '900', overflow: 'hidden' },
  pointText: { color: colors.textMuted, flex: 1, fontSize: 14, lineHeight: 20 },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    color: '#FFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  error: { color: colors.danger, fontWeight: '600' },
  button: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  buttonText: { color: '#FFF', fontWeight: '900', fontSize: 16 },
  disabled: { opacity: 0.5 },
  demo: { color: colors.textSubtle, fontSize: 12, textAlign: 'center' },
});
