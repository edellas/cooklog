import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme';

export type Tab = 'today' | 'arena' | 'publish' | 'profile';

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'today', icon: '🔥', label: 'Oggi' },
  { key: 'arena', icon: '⚔️', label: 'Arena' },
  { key: 'publish', icon: '➕', label: 'Pubblica' },
  { key: 'profile', icon: '👤', label: 'Profilo' },
];

export function TabBar({ current, onChange }: { current: Tab; onChange: (tab: Tab) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {TABS.map((t) => {
        const active = t.key === current;
        return (
          <Pressable key={t.key} onPress={() => onChange(t.key)} style={styles.item} accessibilityRole="tab" accessibilityState={{ selected: active }}>
            <Text style={[styles.icon, !active && styles.dim]}>{t.icon}</Text>
            <Text style={[styles.label, active ? styles.labelActive : styles.dim]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  item: { flex: 1, alignItems: 'center', gap: 2 },
  icon: { fontSize: 22 },
  label: { fontSize: 11, fontWeight: '600', color: colors.text },
  labelActive: { color: colors.text },
  dim: { opacity: 0.5 },
});
