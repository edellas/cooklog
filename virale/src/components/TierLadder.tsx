import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { ease } from '../design/motion';
import { color, radius } from '../design/tokens';
import { TIER_NAMES, TIERS } from '../services/api';
import type { MyEntry } from '../types';
import { Txt } from './Txt';

export function describeEntry(entry: Pick<MyEntry, 'tier' | 'status' | 'views'>): string {
  const n = entry.views.toLocaleString('it-IT');
  if (entry.status === 'disqualified') return 'Fuori gara: troppe segnalazioni.';
  if (entry.status === 'finalist') return `In finale con ${n} viste. A mezzanotte si decide.`;
  if (entry.status === 'parked') return `Fermo a “${TIER_NAMES[entry.tier]}” con ${n} viste. Domani si riparte.`;
  return `${n} di ${TIERS[entry.tier].toLocaleString('it-IT')} viste per passare a “${TIER_NAMES[entry.tier + 1]}”.`;
}

/**
 * Il percorso di un provino fino alla copertina: cinque gradini con il loro nome.
 * Il riempimento del gradino corrente si anima (stato che cambia, 600 ms ease-out): è un elemento
 * assoluto senza figli, quindi animarne la larghezza non ricalcola il layout di nessun altro.
 */
export function TierLadder({ entry, compact }: { entry: Pick<MyEntry, 'tier' | 'status' | 'views'>; compact?: boolean }) {
  const reduced = useReducedMotion();
  const reached = entry.status === 'finalist' ? TIER_NAMES.length - 1 : entry.tier;
  const floor = TIERS[entry.tier - 1] ?? 0;
  const ceil = TIERS[entry.tier] ?? 1;
  const partial = entry.status === 'active' ? Math.max(0.04, Math.min(1, (entry.views - floor) / (ceil - floor))) : entry.status === 'finalist' ? 1 : 0;
  const fill = useSharedValue(reduced ? partial : 0);
  useEffect(() => {
    fill.set(withTiming(partial, { duration: reduced ? 0 : 600, easing: ease.out }));
  }, [fill, partial, reduced]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.get() * 100}%` }));
  const off = entry.status === 'disqualified';

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.row}>
        {TIER_NAMES.map((name, i) => {
          const done = i < reached || entry.status === 'finalist';
          const current = i === reached && entry.status !== 'finalist';
          return (
            <View key={name} style={styles.step}>
              <View style={styles.track}>
                {done ? <View style={[styles.fill, { width: '100%' }, i === TIER_NAMES.length - 1 && styles.final, off && styles.off]} /> : null}
                {current ? <Animated.View style={[styles.fill, fillStyle, off && styles.off]} /> : null}
              </View>
            </View>
          );
        })}
      </View>
      {compact ? null : (
        <Txt variant="meta" tone={color.paperFaint}>
          {TIER_NAMES.map((name, i) => (
            <Txt key={name} variant="meta" tone={i === reached ? color.giallo : i < reached ? color.paper : color.paperFaint} style={i === reached ? styles.now : undefined}>
              {name}
              {i < TIER_NAMES.length - 1 ? '  ·  ' : ''}
            </Txt>
          ))}
        </Txt>
      )}
      <Txt variant="small" tone={color.paperDim}>
        {describeEntry(entry)}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4 },
  step: { flex: 1 },
  now: { fontFamily: 'SchibstedGrotesk_700Bold' },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: color.line, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: color.giallo, borderRadius: radius.pill },
  final: { backgroundColor: color.matita },
  off: { backgroundColor: color.paperFaint },
});
