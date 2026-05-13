import { CooklogColors } from '@/constants/cooklogTheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function FeedActionButton({
  icon,
  label,
  onPress,
  active,
}: {
  icon: 'heart' | 'heart.fill' | 'book.fill' | 'square.and.arrow.up' | 'plus.circle.fill';
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={styles.wrap}>
      <View style={[styles.iconWrap, active && styles.activeWrap]}>
        <IconSymbol name={icon} color={active ? CooklogColors.favorite : '#FFFFFF'} size={22} />
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 4 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  activeWrap: { backgroundColor: 'rgba(255,255,255,0.92)' },
  label: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
});
