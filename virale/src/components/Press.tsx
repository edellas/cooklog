import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { duration, ease, PRESS_SCALE } from '../design/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Haptic = 'light' | 'medium' | 'selection' | undefined;

export function haptic(kind: Haptic | 'success') {
  if (Platform.OS === 'web' || !kind) return;
  if (kind === 'selection') void Haptics.selectionAsync();
  else if (kind === 'success') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else void Haptics.impactAsync(kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
}

/**
 * Qualunque elemento premibile: feedback alla pressione (non al rilascio), scala 0.97 in 120 ms
 * con ease-out forte, area minima 44 pt tramite hitSlop, nessun ripple Android.
 */
export function Press({
  children,
  style,
  scaleTo = PRESS_SCALE,
  hapticOnPress,
  hitSlop = 8,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  hapticOnPress?: Haptic;
}) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <AnimatedPressable
      {...rest}
      style={[style, animated]}
      hitSlop={hitSlop}
      pressRetentionOffset={16}
      onPressIn={(e) => {
        if (!reduced) scale.set(withTiming(scaleTo, { duration: duration.press, easing: ease.out }));
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withTiming(1, { duration: duration.press, easing: ease.out }));
        rest.onPressOut?.(e);
      }}
      onPress={(e) => {
        haptic(hapticOnPress);
        rest.onPress?.(e);
      }}>
      {children}
    </AnimatedPressable>
  );
}
