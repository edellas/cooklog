import { StyleSheet, View } from 'react-native';

import { color, font, space } from '../design/tokens';
import { useNav } from '../state/nav';
import { Icon } from './Icon';
import { Press } from './Press';
import { Txt } from './Txt';

/** L'errore di un campo, scritto subito sotto (e letto dallo screen reader). */
export function FieldError({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <Txt variant="small" tone={color.matita} accessibilityLiveRegion="polite">
      {text}
    </Txt>
  );
}

/** Termini, linee guida e privacy: si leggono prima di accettarli. */
export function LegalLinks() {
  const nav = useNav();
  return (
    <View style={styles.docs}>
      {(
        [
          ['termini', 'Termini'],
          ['linee-guida', 'Linee guida'],
          ['privacy', 'Privacy'],
        ] as const
      ).map(([slug, label]) => (
        <Press key={slug} style={styles.doc} onPress={() => nav.push(`/legale/${slug}`)} accessibilityRole="link" accessibilityLabel={`Leggi ${label}`}>
          <Txt variant="small" style={formStyles.link}>
            {label}
          </Txt>
        </Press>
      ))}
    </View>
  );
}

/** Casella da spuntare con il suo testo (accettazione dei termini). */
export function CheckRow({ checked, invalid, onToggle, children }: { checked: boolean; invalid?: boolean; onToggle: () => void; children: string }) {
  return (
    <Press style={styles.terms} scaleTo={1} onPress={onToggle} accessibilityRole="checkbox" accessibilityState={{ checked }}>
      <View style={[styles.box, checked && styles.boxOn, invalid && styles.boxBad]}>{checked ? <Icon name="check" size={16} color={color.canvas} strokeWidth={2.6} /> : null}</View>
      <Txt variant="small" tone={color.paperDim} style={{ flex: 1 }}>
        {children}
      </Txt>
    </Press>
  );
}

export const formStyles = StyleSheet.create({
  link: { color: color.paper, textDecorationLine: 'underline', fontFamily: font.uiMedium },
});

const styles = StyleSheet.create({
  docs: { flexDirection: 'row', gap: space[2], marginTop: -space[2], flexWrap: 'wrap' },
  doc: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space[2] },
  terms: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start', paddingVertical: space[1] },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: color.paperDim, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  boxOn: { backgroundColor: color.giallo, borderColor: color.giallo },
  boxBad: { borderColor: color.matita },
});
