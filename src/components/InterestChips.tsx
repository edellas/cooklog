import { CooklogColors } from '@/constants/cooklogTheme';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

export function InterestChips({
  options,
  selected,
  onToggle,
}: {
  options: readonly string[];
  selected: string[];
  onToggle: (item: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {options.map((item) => {
        const active = selected.includes(item);
        return (
          <Pressable key={item} onPress={() => onToggle(item)} style={[styles.chip, active && styles.active]}>
            <Text style={[styles.label, active && styles.labelActive]}>{item}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 4 },
  chip: {
    borderWidth: 1,
    borderColor: CooklogColors.border,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: CooklogColors.surface,
  },
  active: { backgroundColor: CooklogColors.primary, borderColor: CooklogColors.primary },
  label: { color: CooklogColors.textMuted, fontWeight: '500' },
  labelActive: { color: CooklogColors.backgroundElevated },
});
