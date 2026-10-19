import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { color, radius, space } from '../design/tokens';
import { Icon } from './Icon';
import { haptic, Press } from './Press';
import { useToast } from './Toast';
import { Txt } from './Txt';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' });

/**
 * Il codice di recupero appena creato: si vede solo adesso. "Ho salvato il codice" si attiva dopo averlo
 * copiato o dopo 5 secondi (il tempo di fare uno screenshot o di scriverlo).
 */
export function RecoveryCodeCard({
  code,
  lead,
  doneLabel = 'Ho salvato il codice',
  note = true,
  compact = false,
  onDone,
}: {
  code: string;
  /** Una riga prima della spiegazione (per esempio dopo il recupero della password). */
  lead?: string;
  doneLabel?: string;
  /** La nota su Impostazioni → Codice di recupero (non serve quando si è già in Impostazioni). */
  note?: boolean;
  /** Dentro un'altra schermata (Impostazioni): titolo più piccolo. */
  compact?: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 5000);
    return () => clearTimeout(id);
  }, []);

  const copy = async () => {
    const ok = await Clipboard.setStringAsync(code).catch(() => false);
    if (ok === false) {
      toast('Non riesco a copiarlo: scrivilo a mano o fai uno screenshot.', 'error');
      return;
    }
    haptic('success');
    toast('Codice copiato.');
    setReady(true);
  };

  return (
    <View style={{ gap: space[4] }}>
      <Txt variant={compact ? 'title' : 'heading'} accessibilityRole="header">
        Il tuo codice di recupero
      </Txt>
      {lead ? (
        <Txt variant="body" tone={color.giallo}>
          {lead}
        </Txt>
      ) : null}
      <Txt variant={compact ? 'small' : 'body'} tone={color.paperDim}>
        Se dimentichi la password, con questo codice ne scegli una nuova da solo. Salvalo in un posto sicuro (note, gestore di password, screenshot): lo vedi solo adesso.
      </Txt>
      <View style={styles.codeBox} accessible accessibilityLabel={`Codice di recupero: ${code.replace(/-/g, '').split('').join(' ')}`}>
        <Text selectable style={styles.code} numberOfLines={1} adjustsFontSizeToFit>
          {code}
        </Text>
      </View>
      <Press style={styles.ghost} onPress={() => void copy()} accessibilityRole="button">
        <Icon name="documento" size={20} />
        <Txt variant="label">Copia codice</Txt>
      </Press>
      <Press style={[styles.cta, !ready && styles.off]} onPress={onDone} disabled={!ready} hapticOnPress="light" accessibilityRole="button">
        <Txt variant="label" tone={color.canvas}>
          {doneLabel}
        </Txt>
      </Press>
      {note ? (
        <Txt variant="meta" tone={color.paperFaint} style={{ textAlign: 'center' }}>
          Puoi crearne uno nuovo da Impostazioni → Codice di recupero.
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  codeBox: { backgroundColor: color.raised, borderRadius: radius.control, borderWidth: 1.5, borderColor: color.giallo, paddingVertical: space[5], paddingHorizontal: space[3], alignItems: 'center' },
  code: { fontFamily: MONO, fontSize: 22, letterSpacing: 1, color: color.paper, fontWeight: '700' },
  ghost: { flexDirection: 'row', gap: space[2], borderWidth: 1.5, borderColor: color.paper, borderRadius: radius.control, paddingVertical: 14, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  cta: { backgroundColor: color.giallo, borderRadius: radius.control, paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  off: { opacity: 0.45 },
});
