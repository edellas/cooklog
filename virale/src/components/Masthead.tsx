import { useEffect } from 'react';
import { StyleSheet, View, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { ease } from '../design/motion';
import { color, type as typeScale } from '../design/tokens';

const WORD = 'Virale';

/**
 * La testata in Bodoni. Con `reveal` le lettere salgono in sequenza (scarto 40 ms, 360 ms ease-out):
 * succede solo alla prima apertura del giorno, il momento raro in cui un po' di teatro è permesso.
 */
export function Masthead({ size = 72, tone = color.paper, reveal = false }: { size?: number; tone?: string; reveal?: boolean }) {
  const style: TextStyle = { ...typeScale.masthead, fontSize: size, lineHeight: size * 1.04, letterSpacing: -size * 0.03, color: tone };
  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel={WORD}>
      {WORD.split('').map((ch, i) => (
        // Le lettere separate perdono la crenatura: la coppia V-i viene ristretta a mano.
        <Letter key={i} ch={ch} i={i} style={i === 0 ? { ...style, marginRight: -size * 0.07 } : style} reveal={reveal} />
      ))}
    </View>
  );
}

function Letter({ ch, i, style, reveal }: { ch: string; i: number; style: TextStyle; reveal: boolean }) {
  const reduced = useReducedMotion();
  const animate = reveal && !reduced;
  const y = useSharedValue(animate ? 14 : 0);
  const o = useSharedValue(reveal ? 0 : 1);
  useEffect(() => {
    if (!reveal) return;
    y.set(withDelay(i * 40, withTiming(0, { duration: 360, easing: ease.out })));
    o.set(withDelay(reduced ? 0 : i * 40, withTiming(1, { duration: 360, easing: ease.out })));
  }, [i, o, reduced, reveal, y]);
  const a = useAnimatedStyle(() => ({ opacity: o.get(), transform: [{ translateY: y.get() }] }));
  return (
    <Animated.Text style={[style, a]} importantForAccessibility="no">
      {ch}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row' } });
