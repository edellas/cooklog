import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { duration, ease } from '../design/motion';
import { color, radius, shadow } from '../design/tokens';
import { Icon } from './Icon';
import { Txt } from './Txt';

const Ctx = createContext<(message: string) => void>(() => undefined);

/**
 * Avviso breve dal basso. Entra in 240 ms ease-out dal suo stesso lato e esce più in fretta (180 ms):
 * coerenza spaziale, uscita più rapida dell'entrata.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [message, setMessage] = useState<string | null>(null);
  const y = useSharedValue(24);
  const o = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (text: string) => {
      setMessage(text);
      y.set(reduced ? 0 : 24);
      y.set(withTiming(0, { duration: duration.toast, easing: ease.out }));
      o.set(withTiming(1, { duration: duration.toast, easing: ease.out }));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (!reduced) y.set(withTiming(16, { duration: duration.toastOut, easing: ease.out }));
        o.set(withTiming(0, { duration: duration.toastOut, easing: ease.out }));
      }, 2600);
    },
    [o, reduced, y],
  );
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const style = useAnimatedStyle(() => ({ opacity: o.get(), transform: [{ translateY: y.get() }] }));

  return (
    <Ctx.Provider value={show}>
      {children}
      <View pointerEvents="none" style={[styles.host, { bottom: insets.bottom + 92 }]}>
        <Animated.View style={[styles.toast, style]}>
          <Icon name="check" size={18} color={color.giallo} strokeWidth={2.2} />
          <Txt variant="label" style={{ flexShrink: 1 }}>
            {message}
          </Txt>
        </Animated.View>
      </View>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: color.sheet,
    borderRadius: radius.control,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: 420,
    ...shadow.lifted,
  },
});
