import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, Share, StyleSheet, Text, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { msUntilArenaClose } from '../engine/engine';
import { PostView, type VideoProgress } from '../components/PostView';
import { SideAction } from '../components/SideAction';
import { TierProgress } from '../components/TierProgress';
import { closeDayNowDemo, getArenaBatch, getMyEntry, isDemo, recordView } from '../services/api';
import { colors, formatCountdown } from '../theme';
import type { ArenaCard, DailyViral, MyEntry } from '../types';

type Interactions = { liked: boolean; shared: boolean; reported: boolean };
const NONE: Interactions = { liked: false, shared: false, reported: false };
const BATCH = 8;

function confirm(title: string, message: string, ok: string): Promise<boolean> {
  // Sul web la segnalazione è immediata (si annulla toccando di nuovo): niente dialoghi del browser.
  if (Platform.OS === 'web') return Promise.resolve(true);
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Annulla', style: 'cancel', onPress: () => resolve(false) },
      { text: ok, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

/**
 * L'Arena è il feed: i contenuti in gara oggi, scelti dal server e mostrati uno alla volta.
 * Tempo di visione, completamento, ri-visione e interazioni sono i "voti" impliciti.
 */
export function ArenaScreen({ onPublish, onDayClosed }: { onPublish: () => void; onDayClosed: (viral: DailyViral | null) => void }) {
  const insets = useSafeAreaInsets();
  const [cards, setCards] = useState<ArenaCard[]>([]);
  const [interactions, setInteractions] = useState<Record<string, Interactions>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [myEntry, setMyEntry] = useState<MyEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [pageHeight, setPageHeight] = useState(0);
  const [countdown, setCountdown] = useState(() => formatCountdown(msUntilArenaClose()));

  const interactionsRef = useRef(interactions);
  const videoRef = useRef<Record<string, VideoProgress>>({});
  const activeRef = useRef<{ entryId: string; since: number } | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    interactionsRef.current = interactions;
  }, [interactions]);

  /** Chiude la vista corrente e la manda al server con tutti i segnali raccolti. */
  const flush = useCallback(() => {
    const current = activeRef.current;
    activeRef.current = null;
    if (!current) return;
    const done = interactionsRef.current[current.entryId] ?? NONE;
    const video = videoRef.current[current.entryId];
    void recordView(current.entryId, {
      dwellMs: Date.now() - current.since,
      completed: video?.completed,
      rewatched: video?.rewatched,
      ...done,
    })
      .then(() => getMyEntry().then(setMyEntry))
      .catch(() => undefined);
  }, []);

  const load = useCallback(async (reset = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      setError(null);
      const [batch, mine] = await Promise.all([getArenaBatch(BATCH), getMyEntry()]);
      setMyEntry(mine);
      setCards((prev) => (reset ? batch : [...prev, ...batch]));
      setExhausted(batch.length === 0);
    } catch {
      setError('Connessione assente. Riprova.');
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    return () => flush();
  }, [load, flush]);

  useEffect(() => {
    const id = setInterval(() => setCountdown(formatCountdown(msUntilArenaClose())), 30000);
    return () => clearInterval(id);
  }, []);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<ArenaCard>[] }) => {
    const visible = viewableItems[0]?.item;
    if (!visible || visible.entryId === activeRef.current?.entryId) return;
    flushRef.current();
    activeRef.current = { entryId: visible.entryId, since: Date.now() };
    setActiveId(visible.entryId);
  }).current;
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const update = (entryId: string, patch: Partial<Interactions>) =>
    setInteractions((prev) => ({ ...prev, [entryId]: { ...(prev[entryId] ?? NONE), ...patch } }));

  const onShare = async (card: ArenaCard) => {
    try {
      const res = await Share.share({ message: `Guarda @${card.post.authorUsername} in gara su Virale: oggi può diventare il virale di domani!` });
      if (res.action !== Share.dismissedAction) update(card.entryId, { shared: true });
    } catch {
      update(card.entryId, { shared: true });
    }
  };

  const onReport = async (card: ArenaCard) => {
    if ((interactions[card.entryId] ?? NONE).reported) return update(card.entryId, { reported: false });
    if (await confirm('Segnala', 'Contenuto offensivo, spam o falso?', 'Segnala')) update(card.entryId, { reported: true });
  };

  const onCloseDay = async () => {
    if (closing) return;
    flush();
    setClosing(true);
    try {
      const viral = await closeDayNowDemo();
      setCards([]);
      setInteractions({});
      setActiveId(null);
      videoRef.current = {};
      setLoading(true);
      await load(true);
      onDayClosed(viral);
    } finally {
      setClosing(false);
    }
  };

  // La radice resta montata anche durante il caricamento: serve la sua altezza per impaginare il feed.
  return (
    <View style={styles.root} onLayout={(e) => setPageHeight(e.nativeEvent.layout.height)}>
      {loading && !cards.length ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : pageHeight > 0 && cards.length ? (
        <FlatList
          data={cards}
          keyExtractor={(item) => item.entryId}
          pagingEnabled
          decelerationRate="fast"
          snapToInterval={pageHeight}
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, index) => ({ length: pageHeight, offset: pageHeight * index, index })}
          viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
          onViewableItemsChanged={onViewableItemsChanged}
          onEndReachedThreshold={2}
          onEndReached={() => {
            if (!exhausted) void load();
          }}
          ListFooterComponent={
            exhausted ? (
              <View style={[styles.end, { height: pageHeight }]}>
                <Text style={styles.endTitle}>Hai visto tutto quello che è in gara per ora 🙌</Text>
                <Text style={styles.endText}>Nuovi contenuti arrivano durante la giornata.</Text>
                <Pressable style={styles.cta} onPress={() => void load()}>
                  <Text style={styles.ctaText}>Aggiorna</Text>
                </Pressable>
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const it = interactions[item.entryId] ?? NONE;
            return (
              <View style={{ height: pageHeight }}>
                <PostView
                  post={item.post}
                  active={item.entryId === activeId}
                  onVideoProgress={(p) => (videoRef.current[item.entryId] = p)}
                />
                <View style={styles.meta} pointerEvents="none">
                  <Text style={styles.author}>@{item.post.authorUsername}</Text>
                  {item.post.caption ? <Text style={styles.caption}>{item.post.caption}</Text> : null}
                  <Text style={styles.tier}>{item.tier > 0 ? `🔥 Sta salendo: livello ${item.tier + 1}` : '🆕 Nuovo in gara'}</Text>
                </View>
                <View style={styles.side}>
                  <SideAction icon={it.liked ? '❤️' : '🤍'} label="Mi piace" active={it.liked} onPress={() => update(item.entryId, { liked: !it.liked })} />
                  <SideAction icon="↗️" label="Condividi" active={it.shared} onPress={() => void onShare(item)} />
                  <SideAction icon="🚩" label="Segnala" active={it.reported} onPress={() => void onReport(item)} />
                </View>
              </View>
            );
          }}
        />
      ) : (
        <View style={styles.end}>
          <Text style={styles.endTitle}>{error ?? 'Hai visto tutto quello che è in gara per ora 🙌'}</Text>
          {!error ? <Text style={styles.endText}>Nuovi contenuti arrivano durante la giornata.</Text> : null}
          <Pressable style={styles.cta} onPress={() => void load(true)}>
            <Text style={styles.ctaText}>Riprova</Text>
          </Pressable>
        </View>
      )}

      <View style={[styles.header, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Text style={styles.title}>⚔️ Arena · chiude tra {countdown}</Text>
        {myEntry ? (
          <TierProgress entry={myEntry} />
        ) : (
          <Text style={styles.sub}>Scorri e guarda: il tuo tempo di visione è il tuo voto. Un solo vincitore.</Text>
        )}
        <View style={styles.headerActions} pointerEvents="box-none">
          {!myEntry ? (
            <Pressable style={styles.pill} onPress={onPublish}>
              <Text style={styles.pillText}>➕ Partecipa oggi</Text>
            </Pressable>
          ) : null}
          {isDemo ? (
            <Pressable style={[styles.pill, styles.pillGhost]} onPress={() => void onCloseDay()} disabled={closing}>
              <Text style={styles.pillText}>{closing ? 'Chiusura…' : '⏭ Chiudi la giornata (demo)'}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const shadow = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 } as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  header: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, gap: 6 },
  title: { color: '#FFF', fontSize: 16, fontWeight: '800', ...shadow },
  sub: { color: colors.textMuted, fontSize: 12, fontWeight: '600', ...shadow },
  headerActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: { backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  pillGhost: { backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' },
  pillText: { color: '#FFF', fontWeight: '800', fontSize: 12 },
  meta: { position: 'absolute', left: 16, right: 90, bottom: 20, gap: 4 },
  author: { color: '#FFF', fontSize: 17, fontWeight: '800', ...shadow },
  caption: { color: '#FFF', fontSize: 14, ...shadow },
  tier: { color: colors.accentAlt, fontSize: 12, fontWeight: '800', ...shadow },
  side: { position: 'absolute', right: 12, bottom: 28, gap: 16 },
  end: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, backgroundColor: colors.surface },
  endTitle: { color: '#FFF', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  endText: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  cta: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 },
  ctaText: { color: '#FFF', fontWeight: '800' },
});
