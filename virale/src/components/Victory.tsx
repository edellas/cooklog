import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { duration, ease } from '../design/motion';
import { color, radius, space } from '../design/tokens';
import { Press } from './Press';
import { Txt } from './Txt';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const LENGTH = 520;

/**
 * Il momento della vittoria: la prima volta che il vincitore apre la sua copertina, a tutto schermo.
 * Il segno di matita (il "cerchio" di Virale) si traccia attorno a "Hai vinto!" e resta; con "riduci
 * movimento" compare già disegnato.
 */
export function Victory({ issue, onShare, onClose }: { issue: number; onShare: () => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const offset = useSharedValue(reduced ? 0 : LENGTH);
  const fade = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    fade.set(withTiming(1, { duration: 300, easing: ease.out }));
    if (!reduced) offset.set(withDelay(250, withTiming(0, { duration: duration.mark * 2, easing: ease.out })));
  }, [fade, offset, reduced]);
  const pathProps = useAnimatedProps(() => ({ strokeDashoffset: offset.get() }));
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, { paddingTop: insets.top + space[10], paddingBottom: insets.bottom + space[6] }, fadeStyle]} accessibilityViewIsModal>
      <View style={styles.center}>
        <View style={styles.mark}>
          <Svg width={300} height={300} viewBox="0 0 150 150" style={StyleSheet.absoluteFill}>
            <AnimatedPath
              d="M108 33c-12-8-28-11-44-7C37 32 20 56 26 80c6 25 33 39 60 33s45-31 39-55c-3-13-11-23-23-29-7-4-15-6-23-6"
              stroke={color.matita}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              strokeDasharray={`${LENGTH} ${LENGTH}`}
              animatedProps={pathProps}
            />
          </Svg>
          <Txt variant="heading" style={styles.title} accessibilityRole="header">
            Hai vinto!
          </Txt>
        </View>
        <Txt variant="body" tone={color.paperDim} style={styles.text}>
          {`Sei la copertina N. ${issue} di Virale: oggi ti vede chiunque apra l’app.`}
        </Txt>
      </View>
      <View style={{ gap: space[3], alignSelf: 'stretch' }}>
        <Press style={styles.primary} onPress={onShare} accessibilityRole="button">
          <Txt variant="label" tone={color.canvas}>
            Condividi la vittoria
          </Txt>
        </Press>
        <Press style={styles.secondary} onPress={onClose} accessibilityRole="button">
          <Txt variant="label">Guarda la copertina</Txt>
        </Press>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: 'rgba(12,19,34,0.94)', paddingHorizontal: space[6], alignItems: 'center', justifyContent: 'space-between', zIndex: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[4] },
  mark: { width: 300, height: 300, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 52, lineHeight: 56, textAlign: 'center' },
  text: { textAlign: 'center', maxWidth: 320 },
  primary: { backgroundColor: color.giallo, borderRadius: radius.control, paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  secondary: { backgroundColor: color.raised, borderRadius: radius.control, paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
});
