import { Platform, StyleSheet } from 'react-native';

import { color } from '../design/tokens';
import { useGoBack } from '../state/useGoBack';
import { Icon } from './Icon';
import { Press } from './Press';

/** Sul web i fogli non hanno la maniglia per chiuderli trascinando: serve un pulsante. Altrove non compare. */
export function SheetClose() {
  const goBack = useGoBack();
  if (Platform.OS !== 'web') return null;
  return (
    <Press style={styles.close} onPress={goBack} accessibilityRole="button" accessibilityLabel="Chiudi">
      <Icon name="chiudi" size={20} />
    </Press>
  );
}

const styles = StyleSheet.create({
  close: { position: 'absolute', top: 14, right: 14, zIndex: 2, width: 36, height: 36, borderRadius: 18, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
});
