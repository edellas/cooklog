import { CooklogColors, CooklogRadii } from '@/constants/cooklogTheme';
import type { RecipeListFilter } from '@/types/cooklog';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

const FILTERS: RecipeListFilter[] = [
  'Tutte',
  'Preferite',
  'Primi',
  'Secondi',
  'Dolci',
  'Contorni',
  'Antipasti',
  'Altro',
];

type Props = {
  selected: RecipeListFilter;
  onSelect: (f: RecipeListFilter) => void;
};

export function CategoryFilter({ selected, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}>
      {FILTERS.map((f) => {
        const active = f === selected;
        return (
          <Pressable
            key={f}
            onPress={() => onSelect(f)}
            style={[styles.chip, active && styles.chipActive]}>
            <Text style={[styles.label, active && styles.labelActive]}>{f}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 8,
    paddingVertical: 4,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: CooklogRadii.chip,
    backgroundColor: CooklogColors.surface,
    borderWidth: 1,
    borderColor: CooklogColors.border,
  },
  chipActive: {
    backgroundColor: CooklogColors.primary,
    borderColor: CooklogColors.primary,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: CooklogColors.textMuted,
  },
  labelActive: {
    color: CooklogColors.backgroundElevated,
  },
});
