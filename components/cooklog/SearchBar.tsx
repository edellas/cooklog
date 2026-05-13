import { CooklogColors, CooklogRadii } from '@/constants/cooklogTheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { StyleSheet, TextInput, View } from 'react-native';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
};

export function SearchBar({ value, onChangeText, placeholder = 'Cerca per nome' }: Props) {
  return (
    <View style={styles.wrap}>
      <IconSymbol name="magnifyingglass" size={20} color={CooklogColors.textSubtle} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={CooklogColors.textSubtle}
        style={styles.input}
        autoCorrect={false}
        autoCapitalize="sentences"
        clearButtonMode="while-editing"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: CooklogColors.surface,
    borderRadius: CooklogRadii.input,
    borderWidth: 1,
    borderColor: CooklogColors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: CooklogColors.text,
    padding: 0,
  },
});
