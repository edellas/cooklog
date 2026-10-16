import { Image } from 'expo-image';
import { useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, RefreshControl, StyleSheet, View, type LayoutChangeEvent, type ViewToken } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../src/components/Icon';
import type { VideoProgress } from '../../src/components/MediaFrame';
import { PostCard, type Interaction } from '../../src/components/PostCard';
import { haptic, Press } from '../../src/components/Press';
import { Txt } from '../../src/components/Txt';
import { resolveMedia } from '../../src/data/demoMedia';
import { clock } from '../../src/design/format';
import { duration, ease } from '../../src/design/motion';
import { color, font, radius, space } from '../../src/design/tokens';
import { coverDay, msUntil, msUntilReveal } from '../../src/engine/engine';
import { getExplore, getFollowing, getForYou, recordView } from '../../src/services/api';
import { useSession } from '../../src/state/session';
import { queueView } from '../../src/state/views';
import type { FeedCard } from '../../src/types';

type Mode = 'gara' | 'esplora' | 'seguiti';
const MODES: { id: Mode; label: string }[] = [
  { id: 'gara', label: 'In gara' },
  { id: 'esplora', label: 'Esplora' },
  { id: 'seguiti', label: 'Seguiti' },
];

/**
 * Il feed verticale, in tre sezioni.
 * - "In gara": i post candidati oggi. Il server li pesca a caso, più spesso quelli vicini ai tuoi gusti:
 *   come guardi è il tuo voto.
 * - "Esplora": tutti i post (anche quelli in gara), ordinati per i tuoi gusti. Non finisce mai.
 * - "Seguiti": chi segui, dal più recente.
 * Tirando giù dall'alto si ricarica; arrivati in fondo si carica la pagina dopo.
 */
export default function ProviniTab() {
  const insets = useSafeAreaInsets();
  const { me, version, status, refreshStatus } = useSession();
  const reveal = status?.settings.revealMinutes ?? 0;
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  const [mode, setMode] = useState<Mode>('gara');
  const [refreshing, setRefreshing] = useState(false);
  /** Seguiti finisce: quando una pagina torna vuota non si chiede altro fino al prossimo aggiornamento. */
  const exhausted = useRef(false);
  /** Come exhausted, ma per disegnare la pagina finale. */
  const [ended, setEnded] = useState(false);
  /** Un aggiornamento completo è in corso: niente "pagina dopo" finché non arriva (la scarterebbe). */
  const resetting = useRef(false);
  const [cards, setCards] = useState<FeedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focused, setFocused] = useState(true);

  const signals = useRef<Record<string, Partial<Record<Interaction, boolean>>>>({});
  const video = useRef<Record<string, VideoProgress>>({});
  const current = useRef<{ card: FeedCard; since: number } | null>(null);
  /** Numero della vista per ogni post: cambia quando il post torna sullo schermo, e il video riparte. */
  const views = useRef<Record<string, number>>({});
  const cardsRef = useRef<FeedCard[]>([]);
  /** Ogni caricamento ha un numero: le risposte arrivate tardi (dopo un cambio di modalità) si scartano. */
  const request = useRef(0);
  const loadingMore = useRef(false);
  const list = useRef<FlatList<FeedCard>>(null);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  /** Chiude la vista corrente e la manda al server con i segnali raccolti. */
  const flush = useCallback(() => {
    const cur = current.current;
    current.current = null;
    if (!cur) return;
    const dwellMs = Date.now() - cur.since;
    const v = video.current[cur.card.id];
    // Tutto quello che passa sullo schermo insegna i gusti (anche scorrere via subito); da 1 secondo è
    // anche una visualizzazione. Sotto un quarto di secondo è solo lo scorrimento veloce: non conta.
    if (dwellMs >= 250) queueView(cur.card.id, { dwellMs, completed: v?.completed, rewatched: v?.rewatched });
    if (!cur.card.entryId) return;
    const s = signals.current[cur.card.id] ?? {};
    delete signals.current[cur.card.id];
    void recordView(cur.card.entryId, { dwellMs: Date.now() - cur.since, completed: v?.completed, rewatched: v?.rewatched, ...s }).catch(() => undefined);
  }, []);

  const load = useCallback(async (reset: boolean) => {
    if (!reset && (loadingMore.current || resetting.current || exhausted.current)) return;
    const id = ++request.current;
    loadingMore.current = !reset;
    if (reset) resetting.current = true;
    if (reset) {
      exhausted.current = false;
      setEnded(false);
    }
    try {
      const shown = reset ? [] : cardsRef.current;
      let next: FeedCard[];
      if (mode === 'seguiti') next = await getFollowing(shown.at(-1)?.createdAt);
      else if (mode === 'esplora') next = await getExplore(8, shown.map((x) => x.id));
      else next = await getForYou(6, shown.map((x) => x.id));
      if (id === request.current) {
        // Contano solo i post nuovi: una pagina fatta di post già in lista non deve bloccare lo scorrimento.
        const fresh = reset ? next : next.filter((n) => !shown.some((p) => p.id === n.id));
        // Seguiti e In gara finiscono (In gara: visti tutti i candidati di adesso); Esplora no.
        if (mode !== 'esplora' && !fresh.length) {
          exhausted.current = true;
          setEnded(true);
        }
        setCards((prev) => (reset ? next : [...prev, ...next.filter((n) => !prev.some((p) => p.id === n.id))]));
        setError(null);
      }
    } catch (e) {
      if (id === request.current && reset) setError((e as Error).message);
    } finally {
      if (id === request.current) {
        loadingMore.current = false;
        resetting.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [mode]);

  // All'orario della copertina la gara chiude e ne parte una nuova: i candidati di prima spariscono, il feed
  // si ricarica. Il timer può fermarsi col telefono in standby: si ricontrolla anche riaprendo l'app (sotto).
  // Il giorno di gara lo dice il server (che non torna mai su un giorno chiuso); a fine gara si rilegge.
  const closesAt = status?.settings.closesAt;
  const day = status?.settings.contestDay ?? coverDay(reveal);
  useEffect(() => {
    const id = setTimeout(() => void refreshStatus(), msUntil(closesAt, msUntilReveal(reveal)) + 70_000);
    return () => clearTimeout(id);
  }, [closesAt, reveal, refreshStatus]);

  /**
   * Ogni sezione ricorda la sua lista e dove eri: tornando da Esplora a In gara ritrovi i provini che non avevi
   * ancora guardato (consegnati dal server, non vanno buttati). Un cambiamento vero (nuovo post, blocco,
   * segnalazione, nuovo giorno) svuota tutto.
   */
  const saved = useRef<Partial<Record<Mode, { cards: FeedCard[]; activeId: string | null; ended: boolean; at: number }>>>({});
  const restoreIndex = useRef(0);
  const lastKey = useRef({ version, day });
  const switchMode = (m: Mode) => {
    if (m === mode) return;
    flush();
    saved.current[mode] = { cards: cardsRef.current, activeId: activeIdRef.current, ended: exhausted.current, at: Date.now() };
    setMode(m);
  };

  useEffect(() => {
    flush();
    if (lastKey.current.version !== version || lastKey.current.day !== day) saved.current = {};
    lastKey.current = { version, day };
    const keep = saved.current[mode];
    delete saved.current[mode];
    if (keep && keep.cards.length && Date.now() - keep.at < 10 * 60_000) {
      request.current += 1;
      loadingMore.current = false;
      resetting.current = false;
      exhausted.current = keep.ended;
      setEnded(keep.ended);
      restoreIndex.current = Math.max(0, keep.cards.findIndex((c) => c.id === keep.activeId));
      setCards(keep.cards);
      setActiveId(keep.activeId);
      setError(null);
      setLoading(false);
      return;
    }
    restoreIndex.current = 0;
    setLoading(true);
    setError(null);
    setCards([]);
    setActiveId(null);
    void load(true);
  }, [flush, load, mode, version, day]);

  // Mettendo l'app in background la vista corrente si chiude (e conta); riaprendola riprende.
  const focusedRef = useRef(false);

  useEffect(() => {
    focusedRef.current = focused;
  }, [focused]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      // Solo "background": su iPhone "inactive" arriva anche abbassando il Centro di controllo o per una
      // notifica, e chiuderebbe la vista (come uno scorrimento) mentre si sta ancora guardando.
      if (st === 'background') flushRef.current();
      else if (st === 'active') {
        if (focusedRef.current && !current.current) {
          const visible = cardsRef.current.find((c) => c.id === activeIdRef.current);
          if (visible) current.current = { card: visible, since: Date.now() };
        }
      }
    });
    return () => sub.remove();
  }, []);

  // Uscendo dal tab (o aprendo commenti e azioni) la vista corrente si registra e i video si fermano;
  // tornando, la vista del post sullo schermo riprende a contare.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      const visible = cardsRef.current.find((c) => c.id === activeIdRef.current);
      if (visible && !current.current) current.current = { card: visible, since: Date.now() };
      return () => {
        setFocused(false);
        flush();
      };
    }, [flush]),
  );
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<FeedCard>[] }) => {
    const visible = viewableItems[0]?.item;
    // Sulla pagina finale non c'è nessun post: si chiude la vista dell'ultimo (non deve contare il tempo lì).
    if (!visible) {
      flushRef.current();
      setActiveId(null);
      return;
    }
    if (visible.id === current.current?.card.id) return;
    flushRef.current();
    current.current = { card: visible, since: Date.now() };
    views.current[visible.id] = (views.current[visible.id] ?? 0) + 1;
    setActiveId(visible.id);
  }).current;

  // Le immagini dei prossimi due post si scaricano mentre guardi questo: scorrendo sono già lì.
  useEffect(() => {
    const at = cards.findIndex((c) => c.id === activeId);
    if (at < 0) return;
    const urls = cards
      .slice(at + 1, at + 3)
      .flatMap((c) => c.media.slice(0, 2).map((m) => (m.kind === 'image' ? resolveMedia(m.src) : m.poster)))
      .filter((u): u is string => typeof u === 'string' && /^https?:/.test(u));
    if (urls.length) void Image.prefetch(urls).catch(() => undefined);
  }, [activeId, cards]);

  // Toccare di nuovo "Provini" mentre ci sei: si torna in cima e arrivano post nuovi (come su TikTok).
  const navigation = useNavigation();
  const refreshNow = useCallback(() => {
    list.current?.scrollToOffset({ offset: 0, animated: false });
    setRefreshing(true);
    flush();
    void load(true);
  }, [flush, load]);
  useEffect(
    () =>
      navigation.addListener('tabPress' as never, () => {
        if (focusedRef.current) refreshNow();
      }),
    [navigation, refreshNow],
  );

  const onInteract = useCallback((postId: string, kind: Interaction) => {
    signals.current[postId] = { ...signals.current[postId], [kind]: true };
  }, []);
  const onVideoProgress = useCallback((postId: string, p: VideoProgress) => {
    video.current[postId] = p;
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: FeedCard }) => (
      <View style={{ height }}>
        <PostCard
          post={item}
          meId={me?.id}
          active={focused && item.id === activeId}
          viewKey={views.current[item.id] ?? 0}
          blind={mode === 'gara'}
          onInteract={onInteract}
          onVideoProgress={onVideoProgress}
        />
      </View>
    ),
    [activeId, focused, height, me?.id, mode, onInteract, onVideoProgress],
  );

  const onLayout = (e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Segmented
          value={mode}
          onChange={(m) => {
            haptic('selection');
            switchMode(m);
          }}
        />
        {mode === 'gara' ? <ArenaClock reveal={reveal} closesAt={closesAt} /> : null}
      </View>

      <View style={styles.list} onLayout={onLayout}>
        {loading && !cards.length ? (
          <View style={styles.center}>
            <ActivityIndicator color={color.giallo} />
          </View>
        ) : error && !cards.length ? (
          <View style={styles.center}>
            <Txt variant="title" style={{ textAlign: 'center' }}>
              Non riesco a caricare i post.
            </Txt>
            <Txt variant="body" tone={color.paperDim} style={{ textAlign: 'center' }}>
              Controlla la connessione e riprova.
            </Txt>
            <Press
              style={styles.retry}
              onPress={() => {
                setLoading(true);
                void load(true);
              }}
              accessibilityRole="button">
              <Txt variant="label" tone={color.canvas}>
                Riprova
              </Txt>
            </Press>
          </View>
        ) : !cards.length ? (
          <View style={styles.center}>
            <Txt variant="title" style={{ textAlign: 'center' }}>
              {mode === 'seguiti' ? 'Non segui ancora nessuno.' : mode === 'esplora' ? 'Ancora nessun post da scoprire.' : 'Hai visto tutti i provini di adesso.'}
            </Txt>
            <Txt variant="body" tone={color.paperDim} style={{ textAlign: 'center' }}>
              {mode === 'seguiti'
                ? 'Tocca “Segui” sotto un post che ti piace: i suoi nuovi post arriveranno qui.'
                : mode === 'esplora'
                  ? 'Appena qualcuno pubblica, lo trovi qui.'
                  : 'Ogni candidato lo vedi una volta sola, e i tuoi non li vedi: il tuo voto è come guardi. Ne arrivano di nuovi durante il giorno.'}
            </Txt>
            {mode === 'gara' ? (
              <Press style={styles.retry} onPress={() => switchMode('esplora')} accessibilityRole="button">
                <Txt variant="label" tone={color.canvas}>
                  Vai su Esplora
                </Txt>
              </Press>
            ) : null}
            <Press
              style={styles.retry}
              onPress={() => {
                setLoading(true);
                void load(true);
              }}
              accessibilityRole="button">
              <Txt variant="label" tone={color.canvas}>
                Aggiorna
              </Txt>
            </Press>
          </View>
        ) : height > 0 ? (
          <FlatList
            ref={list}
            key={mode}
            initialScrollIndex={restoreIndex.current < cards.length ? restoreIndex.current : 0}
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
            onEndReached={() => void load(false)}
            ListFooterComponent={
              ended && mode !== 'esplora' ? (
                <View style={[styles.center, { height }]}>
                  <Txt variant="title" style={{ textAlign: 'center' }}>
                    {mode === 'gara' ? 'Hai visto tutti i provini di adesso.' : 'Sei in pari con chi segui.'}
                  </Txt>
                  <Txt variant="body" tone={color.paperDim} style={{ textAlign: 'center' }}>
                    {mode === 'gara' ? 'Ne arrivano di nuovi durante il giorno: tira giù per controllare.' : 'Intanto scopri qualcosa di nuovo.'}
                  </Txt>
                  <Press style={styles.retry} onPress={() => switchMode('esplora')} accessibilityRole="button">
                    <Txt variant="label" tone={color.canvas}>
                      Vai su Esplora
                    </Txt>
                  </Press>
                </View>
              ) : null
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={refreshNow}
                tintColor={color.giallo}
                colors={[color.giallo]}
                progressBackgroundColor={color.raised}
              />
            }
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            windowSize={3}
            removeClippedSubviews
            renderItem={renderItem}
          />
        ) : null}
      </View>
    </View>
  );
}

/** Il conto alla rovescia vive da solo: aggiornarlo ogni secondo non ridisegna il feed. */
function ArenaClock({ reveal, closesAt }: { reveal: number; closesAt?: string }) {
  const left0 = () => msUntil(closesAt, msUntilReveal(reveal));
  const [left, setLeft] = useState(left0);
  useEffect(() => {
    const tick = () => setLeft(msUntil(closesAt, msUntilReveal(reveal)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [reveal, closesAt]);
  return (
    <View style={styles.clock} accessible accessibilityLabel={`La gara chiude tra ${clock(left)}`}>
      <Icon name="orologio" size={16} color={color.giallo} strokeWidth={2} />
      <Txt variant="meta" tone={color.paper} style={{ fontFamily: font.uiBold }}>
        {clock(left)}
      </Txt>
    </View>
  );
}

function Segmented({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  const [w, setW] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    // Interruttore: cambio di stato breve, 180 ms ease-out.
    x.set(withTiming(MODES.findIndex((m) => m.id === value) * w, { duration: duration.toggle, easing: ease.out }));
  }, [value, w, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  return (
    <View style={styles.seg} onLayout={(e) => setW((e.nativeEvent.layout.width - 8) / MODES.length)} accessibilityRole="tablist">
      {w > 0 ? <Animated.View style={[styles.segPill, { width: w }, pill]} /> : null}
      {MODES.map((m) => (
        <Press key={m.id} style={styles.segItem} scaleTo={1} onPress={() => onChange(m.id)} accessibilityRole="tab" accessibilityState={{ selected: value === m.id }}>
          <Txt variant="label" tone={value === m.id ? color.canvas : color.paperDim} style={{ fontSize: 14 }} numberOfLines={1}>
            {m.label}
          </Txt>
        </Press>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], paddingVertical: space[2], gap: space[3] },
  seg: { flex: 1, maxWidth: 300, flexDirection: 'row', backgroundColor: color.raised, borderRadius: radius.pill, padding: 4 },
  segPill: { position: 'absolute', top: 4, left: 4, bottom: 4, backgroundColor: color.paper, borderRadius: radius.pill },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  clock: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: color.raised, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  list: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  retry: { marginTop: space[3], backgroundColor: color.giallo, borderRadius: radius.pill, paddingHorizontal: 22, paddingVertical: 12 },
});
