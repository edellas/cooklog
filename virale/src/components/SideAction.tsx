import { Pressable, StyleSheet, Text, View } from 'react-native';

export function SideAction({ icon, label, active, onPress }: { icon: string; label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.wrap} accessibilityLabel={label} hitSlop={8}>
      <View style={[styles.circle, active && styles.active]}>
        <Text style={styles.icon}>{icon}</Text>
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 4 },
  circle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  active: { backgroundColor: 'rgba(255,45,85,0.85)' },
  icon: { fontSize: 22 },
  label: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
});
