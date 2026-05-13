import { CooklogColors } from '@/constants/cooklogTheme';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function EmptyState({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} style={styles.button}>
          <Text style={styles.buttonLabel}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { padding: 24, alignItems: 'center', gap: 12 },
  title: { color: CooklogColors.textMuted, fontSize: 16, textAlign: 'center' },
  button: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: CooklogColors.primary,
  },
  buttonLabel: { color: CooklogColors.primary, fontWeight: '600' },
});
