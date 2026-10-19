import { StyleSheet, View } from 'react-native';

import { color, radius, space } from '../design/tokens';
import { REPORT_REASONS, type ReportReason } from '../services/api';
import { Press } from './Press';
import { Txt } from './Txt';

/**
 * I motivi di una segnalazione (post, commento o profilo): stesso elenco e stesso ordine ovunque,
 * con la rassicurazione che chi viene segnalato non sa da chi.
 */
export function ReportReasons({
  title = 'Perché lo segnali?',
  who,
  onPick,
  disabled,
}: {
  title?: string;
  /** @nome di chi viene segnalato. */
  who: string;
  onPick: (reason: ReportReason) => void;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: space[3] }}>
      <Txt variant="title">{title}</Txt>
      <Txt variant="small" tone={color.paperDim} style={{ marginBottom: space[2] }}>
        {who} non saprà chi l’ha segnalato.
      </Txt>
      {REPORT_REASONS.map((r) => (
        <Press key={r.key} style={styles.row} onPress={() => onPick(r.key)} disabled={disabled} accessibilityRole="button">
          <Txt variant="label">{r.label}</Txt>
        </Press>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: color.raised, borderRadius: radius.control, padding: space[4], minHeight: 56 },
});
