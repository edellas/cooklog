import { CooklogColors } from '@/constants/cooklogTheme';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.button}>
          <Text style={styles.label}>Riprova</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    margin: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CooklogColors.danger,
    backgroundColor: CooklogColors.surface,
    gap: 10,
  },
  text: { color: CooklogColors.danger, fontSize: 14 },
  button: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: CooklogColors.danger,
  },
  label: { color: CooklogColors.danger, fontWeight: '600' },
});
