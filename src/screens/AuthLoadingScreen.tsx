import { CooklogColors } from '@/constants/cooklogTheme';
import { LoadingState } from '@/src/components/LoadingState';
import { useAuth } from '@/src/providers/AuthProvider';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function AuthLoadingScreen() {
  const { enableDemoMode } = useAuth();
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Configurazione Supabase mancante</Text>
      <Text style={styles.text}>
        Per usare login, feed cloud e pubblicazione online imposta EXPO_PUBLIC_SUPABASE_URL e
        EXPO_PUBLIC_SUPABASE_ANON_KEY.
      </Text>
      <Pressable onPress={() => void enableDemoMode()} style={styles.button}>
        <Text style={styles.buttonLabel}>Continua in modalità demo</Text>
      </Pressable>
      <LoadingState message="In attesa di configurazione..." />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: CooklogColors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  title: { fontSize: 24, fontWeight: '700', color: CooklogColors.text, textAlign: 'center' },
  text: { fontSize: 15, lineHeight: 22, color: CooklogColors.textMuted, textAlign: 'center' },
  button: {
    borderRadius: 12,
    backgroundColor: CooklogColors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonLabel: { color: '#fff', fontWeight: '700' },
});
