import { CooklogColors } from '@/constants/cooklogTheme';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

export function LoadingState({ message = 'Caricamento in corso...' }: { message?: string }) {
  return (
    <View style={styles.root}>
      <ActivityIndicator color={CooklogColors.primary} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  text: { color: CooklogColors.textMuted, fontSize: 14 },
});
