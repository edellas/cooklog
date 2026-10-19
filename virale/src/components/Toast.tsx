import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { duration, ease } from '../design/motion';
import { color, radius, shadow } from '../design/tokens';
import { Icon } from './Icon';
import { Press } from './Press';
import { Txt } from './Txt';

type Tone = 'ok' | 'error';
/** Un'azione nel toast ("Verifica", "Vedi"): il toast resta un po' di più per dare il tempo di toccarla. */
export type ToastAction = { label: string; onPress: () => void };
type Show = (message: string, tone?: Tone, action?: ToastAction) => void;
const Ctx = createContext<Show>(() => undefined);

/**
 * Avviso breve dal basso. Entra in 240 ms ease-out dal suo stesso lato e esce più in fretta (180 ms):
 * coerenza spaziale, uscita più rapida dell'entrata.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<Tone>('ok');
  const [action, setAction] = useState<ToastAction | null>(null);
  const [shown, setShown] = useState(false);
  const y = useSharedValue(24);
  const o = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!reduced) y.set(withTiming(16, { duration: duration.toastOut, easing: ease.out }));
    o.set(withTiming(0, { duration: duration.toastOut, easing: ease.out }));
    setShown(false);
  }, [o, reduced, y]);

  const show = useCallback(
    (text: string, kind: Tone = 'ok', act?: ToastAction) => {
      setMessage(text);
      setTone(kind);
      setAction(act ?? null);
      setShown(true);
      AccessibilityInfo.announceForAccessibility(text);
      y.set(reduced ? 0 : 24);
      y.set(withTiming(0, { duration: duration.toast, easing: ease.out }));
      o.set(withTiming(1, { duration: duration.toast, easing: ease.out }));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(hide, act ? 4000 : 2600);
    },
    [hide, o, reduced, y],
  );
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const style = useAnimatedStyle(() => ({ opacity: o.get(), transform: [{ translateY: y.get() }] }));

  return (
    <Ctx.Provider value={show}>
      {children}
      {/* Solo il riquadro (e solo se ha un'azione) riceve i tocchi: il resto dello schermo resta usabile. */}
      <View
        pointerEvents="box-none"
        style={[styles.host, { bottom: insets.bottom + 92 }]}
        accessibilityLiveRegion="polite"
        importantForAccessibility={shown ? 'yes' : 'no-hide-descendants'}
        accessibilityElementsHidden={!shown}>
        <Animated.View style={[styles.toast, style]} pointerEvents={shown && action ? 'auto' : 'none'}>
          <Icon name={tone === 'ok' ? 'check' : 'info'} size={18} color={tone === 'ok' ? color.giallo : color.matita} strokeWidth={2.2} />
          <Txt variant="label" style={{ flexShrink: 1 }}>
            {message}
          </Txt>
          {action ? (
            <Press
              style={styles.action}
              onPress={() => {
                hide();
                action.onPress();
              }}
              accessibilityRole="button"
              accessibilityLabel={action.label}>
              <Txt variant="label" tone={color.canvas}>
                {action.label}
              </Txt>
            </Press>
          ) : null}
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
  action: { backgroundColor: color.giallo, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, marginLeft: 4, minHeight: 36, justifyContent: 'center' },
});
