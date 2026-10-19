import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Path } from 'react-native-svg';

import { duration, ease } from '../design/motion';
import { color } from '../design/tokens';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const SIZE = 150;
// Lunghezza approssimata del tracciato (ellisse con i capi sovrapposti).
const LENGTH = 520;

/**
 * Il "mi piace" di Virale: come un photo editor che cerchia lo scatto giusto sul provino,
 * un ovale di matita grassa rossa si traccia attorno al punto toccato due volte.
 * Momento di feedback: 420 ms di tratto in ease-out, poi svanisce. Con "riduci movimento" appare e svanisce.
 */
export function CircleMark({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  const reduced = useReducedMotion();
  const offset = useSharedValue(reduced ? 0 : LENGTH);
  const opacity = useSharedValue(1);
  // onDone può cambiare a ogni render del genitore: l'animazione deve partire una volta sola.
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);
  const finish = useCallback(() => doneRef.current(), []);

  useEffect(() => {
    if (!reduced) offset.set(withTiming(0, { duration: duration.mark, easing: ease.out }));
    opacity.set(
      withDelay(
        reduced ? 500 : 650,
        withTiming(0, { duration: 220, easing: ease.out }, (finished) => {
          if (finished) scheduleOnRN(finish);
        }),
      ),
    );
  }, [finish, offset, opacity, reduced]);

  const pathProps = useAnimatedProps(() => ({ strokeDashoffset: offset.get() }));
  const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { left: x - SIZE / 2, top: y - SIZE / 2 }, fade]}>
      <Svg width={SIZE} height={SIZE} viewBox="0 0 150 150">
        <AnimatedPath
          d="M108 33c-12-8-28-11-44-7C37 32 20 56 26 80c6 25 33 39 60 33s45-31 39-55c-3-13-11-23-23-29-7-4-15-6-23-6"
          stroke={color.matita}
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray={`${LENGTH} ${LENGTH}`}
          animatedProps={pathProps}
        />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', width: SIZE, height: SIZE },
});
