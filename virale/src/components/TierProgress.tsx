import { StyleSheet, Text, View } from 'react-native';

import { TIER_THRESHOLDS } from '../services/api';
import { colors, formatCount } from '../theme';
import type { MyEntry } from '../types';

export function describeEntry(entry: MyEntry): string {
  if (entry.status === 'disqualified') return 'Squalificato per troppe segnalazioni';
  if (entry.status === 'finalist') return `In finale! ${formatCount(entry.views)} viste`;
  if (entry.status === 'parked') return `Fermo al livello ${entry.tier + 1} · ${formatCount(entry.views)} viste`;
  return `Livello ${entry.tier + 1} di ${TIER_THRESHOLDS.length} · ${formatCount(entry.views)}/${formatCount(TIER_THRESHOLDS[entry.tier])} viste`;
}

/** Barra a segmenti: un segmento per livello, più la finale. */
export function TierProgress({ entry }: { entry: MyEntry }) {
  const levels = TIER_THRESHOLDS.length + 1;
  const reached = entry.status === 'finalist' ? levels : entry.tier;
  const partial =
    entry.status === 'active' ? Math.min(1, (entry.views - (TIER_THRESHOLDS[entry.tier - 1] ?? 0)) / (TIER_THRESHOLDS[entry.tier] - (TIER_THRESHOLDS[entry.tier - 1] ?? 0))) : 0;
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {Array.from({ length: levels }, (_, i) => (
          <View key={i} style={styles.segment}>
            <View
              style={[
                styles.fill,
                { width: `${i < reached ? 100 : i === reached ? Math.round(partial * 100) : 0}%` },
                entry.status === 'disqualified' && { backgroundColor: colors.danger },
                i === levels - 1 && styles.final,
              ]}
            />
          </View>
        ))}
      </View>
      <Text style={styles.caption}>{describeEntry(entry)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent },
  final: { backgroundColor: colors.accentAlt },
  caption: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
});
