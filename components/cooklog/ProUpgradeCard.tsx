import { CooklogColors, CooklogRadii } from '@/constants/cooklogTheme';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

export function ProUpgradeCard() {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Cooklog Pro</Text>
      <Text style={styles.sub}>
        Ricette illimitate, backup cloud, export PDF e ricettari condivisi. Demo senza pagamenti
        reali.
      </Text>
      <Pressable
        onPress={() =>
          Alert.alert(
            'Cooklog Pro',
            'Questa è una anteprima: non è possibile acquistare da questa build.',
          )
        }
        style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}>
        <Text style={styles.ctaLabel}>Scopri il piano Pro</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CooklogColors.primary,
    borderRadius: CooklogRadii.card,
    padding: 20,
    gap: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: CooklogColors.backgroundElevated,
    letterSpacing: -0.3,
  },
  sub: {
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,252,247,0.88)',
  },
  cta: {
    marginTop: 4,
    alignSelf: 'flex-start',
    backgroundColor: CooklogColors.backgroundElevated,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: CooklogRadii.button,
  },
  ctaPressed: {
    opacity: 0.9,
  },
  ctaLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: CooklogColors.primary,
  },
});
