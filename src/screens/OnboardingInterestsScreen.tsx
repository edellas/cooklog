import { CooklogColors, CooklogSpacing } from '@/constants/cooklogTheme';
import { InterestChips } from '@/src/components/InterestChips';
import { INTEREST_OPTIONS } from '@/src/types';
import { useAuth } from '@/src/providers/AuthProvider';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function OnboardingInterestsScreen() {
  const { interests, saveInterests } = useAuth();
  const [selected, setSelected] = useState<string[]>(interests);
  const [error, setError] = useState<string | null>(null);

  const toggle = (item: string) => {
    setSelected((prev) => (prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]));
  };

  const onContinue = async () => {
    if (selected.length < 3) {
      setError('Seleziona almeno 3 interessi per continuare.');
      return;
    }
    setError(null);
    await saveInterests(selected);
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Cosa vuoi vedere nel tuo feed?</Text>
      <Text style={styles.sub}>
        Scegli almeno 3 interessi. Li useremo per mostrarti piatti più rilevanti.
      </Text>
      <InterestChips options={INTEREST_OPTIONS} selected={selected} onToggle={toggle} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable onPress={() => void onContinue()} style={styles.button}>
        <Text style={styles.buttonLabel}>Continua</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: CooklogColors.background,
    padding: CooklogSpacing.screenHorizontal,
    paddingTop: 80,
    gap: 16,
  },
  title: { fontSize: 30, fontWeight: '700', color: CooklogColors.text },
  sub: { fontSize: 15, lineHeight: 22, color: CooklogColors.textMuted },
  button: {
    marginTop: 14,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: CooklogColors.primary,
  },
  buttonLabel: { color: '#fff', fontWeight: '700', fontSize: 16 },
  error: { color: CooklogColors.danger, fontSize: 14 },
});
