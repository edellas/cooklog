import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View, type LayoutChangeEvent, type ViewToken } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../src/components/Icon';
import type { VideoProgress } from '../../src/components/MediaFrame';
import { PostCard, type Interaction } from '../../src/components/PostCard';
import { haptic, Press } from '../../src/components/Press';
import { Txt } from '../../src/components/Txt';
import { clock } from '../../src/design/format';
import { duration, ease } from '../../src/design/motion';
import { color, font, radius, space } from '../../src/design/tokens';
import { msUntilArenaClose } from '../../src/engine/engine';
import { getFollowing, getForYou, recordView } from '../../src/services/api';
import { useSession } from '../../src/state/session';
import type { FeedCard } from '../../src/types';

type Mode = 'perte' | 'seguiti';

/**
 * I Provini: il feed verticale. "Per te" mostra i post in gara oggi, scelti dal server alla cieca:
 * come guardi è il tuo voto. "Seguiti" mostra chi segui, in ordine di tempo.
 */
export default function ProviniTab() {
  const insets = useSafeAreaInsets();
  const { me, version } = useSession();
  const [mode, setMode] = useState<Mode>('perte');
  const [cards, setCards] = useState<FeedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [height, setHeight] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [focused, setFocused] = useState(true);
  const [left, setLeft] = useState(() => msUntilArenaClose());

  const signals = useRef<Record<string, Partial<Record<Interaction, boolean>>>>({});
  const video = useRef<Record<string, VideoProgress>>({});
  const current = useRef<{ card: FeedCard; since: number } | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setLeft(msUntilArenaClose()), 1000);
    return () => clearInterval(id);
  }, []);

  /** Chiude la vista corrente e la manda al server con i segnali raccolti. */
  const flush = useCallback(() => {
    const cur = current.current;
    current.current = null;
    if (!cur?.card.entryId) return;
    const s = signals.current[cur.card.id] ?? {};
    const v = video.current[cur.card.id];
    void recordView(cur.card.entryId, { dwellMs: Date.now() - cur.since, completed: v?.completed, rewatched: v?.rewatched, ...s }).catch(() => undefined);
  }, []);

  const load = useCallback(
    async (reset: boolean) => {
      if (busy.current) return;
      busy.current = true;
      try {
        if (mode === 'seguiti') {
          setCards(await getFollowing());
        } else {
          const exclude = reset ? [] : cards.map((x) => x.id);
          const next = await getForYou(6, exclude);
          setCards((prev) => (reset ? next : [...prev, ...next.filter((n) => !prev.some((p) => p.id === n.id))]));
        }
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [cards, mode],
  );

  useEffect(() => {
    flush();
    setLoading(true);
    setCards([]);
    setActiveId(null);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, version]);

  // Uscendo dal tab la vista corrente si registra e i video si fermano.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
        flush();
      };
    }, [flush]),
  );

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<FeedCard>[] }) => {
    const visible = viewableItems[0]?.item;
    if (!visible || visible.id === current.current?.card.id) return;
    flushRef.current();
    current.current = { card: visible, since: Date.now() };
    setActiveId(visible.id);
  }).current;
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const onLayout = (e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Segmented
          value={mode}
          onChange={(m) => {
            haptic('selection');
            setMode(m);
          }}
        />
        <View style={styles.clock} accessibilityLabel={`La gara chiude tra ${clock(left)}`}>
          <Icon name="orologio" size={16} color={color.giallo} strokeWidth={2} />
          <Txt variant="meta" tone={color.paper} style={{ fontFamily: font.uiBold }}>
            {clock(left)}
          </Txt>
        </View>
      </View>

      <View style={styles.list} onLayout={onLayout}>
        {loading && !cards.length ? (
          <View style={styles.center}>
            <ActivityIndicator color={color.giallo} />
          </View>
        ) : !cards.length ? (
          <View style={styles.center}>
            <Txt variant="title" style={{ textAlign: 'center' }}>
              {mode === 'seguiti' ? 'Non segui ancora nessuno.' : 'Hai visto tutti i provini di adesso.'}
            </Txt>
            <Txt variant="body" tone={color.paperDim} style={{ textAlign: 'center' }}>
              {mode === 'seguiti' ? 'Tocca “Segui” sotto un post che ti piace: i suoi nuovi post arriveranno qui.' : 'Ne arrivano di nuovi per tutto il giorno.'}
            </Txt>
          </View>
        ) : height > 0 ? (
          <FlatList
            data={cards}
            keyExtractor={(c) => c.id}
            pagingEnabled
            decelerationRate="fast"
            snapToInterval={height}
            showsVerticalScrollIndicator={false}
            getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
            viewabilityConfig={{ itemVisiblePercentThreshold: 70 }}
            onViewableItemsChanged={onViewable}
            onEndReachedThreshold={1.5}
            onEndReached={() => {
              if (mode === 'perte') void load(false);
            }}
            windowSize={3}
            renderItem={({ item }) => (
              <View style={{ height }}>
                <PostCard
                  post={item}
                  meId={me?.id}
                  active={focused && item.id === activeId}
                  muted={muted}
                  onToggleMute={() => setMuted((m) => !m)}
                  onInteract={(kind) => {
                    signals.current[item.id] = { ...signals.current[item.id], [kind]: true };
                  }}
                  onVideoProgress={(p) => {
                    video.current[item.id] = p;
                  }}
                />
              </View>
            )}
          />
        ) : null}
      </View>
    </View>
  );
}

function Segmented({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    // Interruttore: cambio di stato breve, 180 ms ease-out.
    x.set(withTiming(value === 'perte' ? 0 : w, { duration: duration.toggle, easing: ease.out }));
  }, [value, w, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  return (
    <View style={styles.seg} onLayout={(e) => setW((e.nativeEvent.layout.width - 8) / 2)} accessibilityRole="tablist">
      {w > 0 ? <Animated.View style={[styles.segPill, { width: w }, pill]} /> : null}
      {(['perte', 'seguiti'] as Mode[]).map((m) => (
        <Press key={m} style={styles.segItem} scaleTo={1} onPress={() => onChange(m)} accessibilityRole="tab" accessibilityState={{ selected: value === m }}>
          <Txt variant="label" tone={value === m ? color.canvas : color.paperDim}>
            {m === 'perte' ? 'Per te' : 'Seguiti'}
          </Txt>
        </Press>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], paddingVertical: space[2], gap: space[3] },
  seg: { flexDirection: 'row', backgroundColor: color.raised, borderRadius: radius.pill, padding: 4, width: 210 },
  segPill: { position: 'absolute', top: 4, left: 4, bottom: 4, backgroundColor: color.paper, borderRadius: radius.pill },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  clock: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: color.raised, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  list: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
});
