import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { font, radius, space } from '../design/tokens';
import type { SocialProvider } from '../types';
import { Press } from './Press';
import { Txt } from './Txt';

/**
 * "Continua con Google" / "Continua con Facebook", secondo le linee guida dei due marchi: logo ufficiale a
 * sinistra, nome del servizio scritto per intero, colori del marchio (Google: fondo chiaro con il bordo
 * grigio e la "G" a quattro colori; Facebook: blu #1877F2 con la "f" bianca). Il logo non si ricolora.
 */
export function SocialButton({ provider, onPress, busy, disabled }: { provider: SocialProvider; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  const google = provider === 'google';
  const label = google ? 'Continua con Google' : 'Continua con Facebook';
  const ink = google ? '#1F1F1F' : '#FFFFFF';
  return (
    <Press
      style={[styles.button, google ? styles.google : styles.facebook, disabled && !busy && styles.off]}
      onPress={onPress}
      disabled={disabled || busy}
      hapticOnPress="light"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: Boolean(busy), disabled: Boolean(disabled || busy) }}>
      <View style={styles.logo}>{google ? <GoogleLogo /> : <FacebookLogo />}</View>
      {busy ? (
        <ActivityIndicator color={ink} />
      ) : (
        <Txt variant="label" tone={ink} style={styles.text} numberOfLines={1}>
          {label}
        </Txt>
      )}
      {/* Spazio uguale al logo: il testo resta centrato. */}
      <View style={styles.logo} />
    </Press>
  );
}

/** La "G" di Google a quattro colori (dalle risorse ufficiali per il pulsante di accesso). */
function GoogleLogo() {
  return (
    <Svg width={20} height={20} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  );
}

/** Il logo di Facebook (cerchio con la "f"), bianco sul blu del pulsante. */
function FacebookLogo() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Path
        fill="#FFFFFF"
        d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.control, minHeight: 52, paddingHorizontal: space[4] },
  google: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#747775' },
  facebook: { backgroundColor: '#1877F2' },
  off: { opacity: 0.5 },
  logo: { width: 24, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, textAlign: 'center', fontFamily: font.uiBold, marginHorizontal: space[2] },
});
