import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
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
import { relTime, relTimeLong } from '../../src/design/format';
import { duration, ease } from '../../src/design/motion';
import { color, font, radius, space } from '../../src/design/tokens';
import { coverDay, msUntil, msUntilReveal } from '../../src/engine/engine';
import { getExplore, getFollowing, getForYou, recordView } from '../../src/services/api';
import { friendlyError } from '../../src/services/errors';
import { useToast } from '../../src/components/Toast';
import { useNav } from '../../src/state/nav';
import { alreadySeen, markSeen } from '../../src/state/hints';
import { onPostGone } from '../../src/state/postEvents';
import { onSectionRequest, takeSection } from '../../src/state/sections';
import { useSession } from '../../src/state/session';
import { queueView } from '../../src/state/views';
import type { FeedCard } from '../../src/types';

type Mode = 'gara' | 'esplora' | 'seguiti';
/** Una scheda della lista. In Esplora lo stesso post può tornare: la chiave distingue le sue apparizioni. */
type Card = FeedCard & { key: string };
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
  // "Guarda i provini di oggi" dalla Copertina (o un link …/provini?sezione=gara) apre la sezione chiesta.
  const [mode, setMode] = useState<Mode>(() => takeSection() ?? 'gara');
  const { sezione } = useLocalSearchParams<{ sezione?: string }>();
  /** Spiegazione di In gara alla prima apertura: finché è sullo schermo il post sotto non conta e non parte. */
  const [intro, setIntro] = useState(false);
  const introRef = useRef(false);
  /** La fascia "il tuo voto conterà…" si chiude per la sessione. */
  const [bandClosed, setBandClosed] = useState(voterBandClosed);
  const [refreshing, setRefreshing] = useState(false);
  /** Seguiti finisce: quando una pagina torna vuota non si chiede altro fino al prossimo aggiornamento. */
  const exhausted = useRef(false);
  /** Come exhausted, ma per disegnare la pagina finale. */
  const [ended, setEnded] = useState(false);
  /** Un aggiornamento completo è in corso: niente "pagina dopo" finché non arriva (la scarterebbe). */
  const resetting = useRef(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(0);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [focused, setFocused] = useState(true);

  const signals = useRef<Record<string, Partial<Record<Interaction, boolean>>>>({});
  const video = useRef<Record<string, VideoProgress>>({});
  const current = useRef<{ card: Card; since: number } | null>(null);
  /** Numero della vista per ogni scheda: cambia quando la scheda torna sullo schermo, e il video riparte. */
  const views = useRef<Record<string, number>>({});
  const cardsRef = useRef<Card[]>([]);
  const toast = useToast();
  const nav = useNav();
  /** Chiavi uniche: In gara e Seguiti non ripetono i post (chiave = id), Esplora sì (id~n). */
  const keySeq = useRef(0);
  const keyed = useCallback((list: FeedCard[], existing: Card[]): Card[] => {
    const used = new Set(existing.map((c) => c.key));
    return list.map((c) => {
      let key = c.id;
      while (used.has(key)) key = `${c.id}~${(keySeq.current += 1)}`;
      used.add(key);
      return { ...c, key };
    });
  }, []);
  /** Ogni caricamento ha un numero: le risposte arrivate tardi (dopo un cambio di modalità) si scartano. */
  const request = useRef(0);
  const loadingMore = useRef(false);
  const list = useRef<FlatList<Card>>(null);

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
      else if (mode === 'esplora') {
        next = await getExplore(8, shown.map((x) => x.id));
        // Esplora non finisce: se la pagina ripete solo post già in lista, si richiede escludendo solo gli
        // ultimi 30 e si accodano anche i ripetuti (con una chiave nuova).
        if (!reset && next.every((n) => shown.some((p) => p.id === n.id))) next = await getExplore(8, shown.slice(-30).map((x) => x.id));
      } else next = await getForYou(6, shown.map((x) => x.id));
      if (id === request.current) {
        // Contano solo i post nuovi: una pagina fatta di post già in lista non deve bloccare lo scorrimento.
        const fresh = reset || mode === 'esplora' ? next : next.filter((n) => !shown.some((p) => p.id === n.id));
        // Seguiti e In gara finiscono (In gara: visti tutti i candidati di adesso). Esplora solo se non esiste
        // più nessun post da vedere.
        if (!fresh.length && (mode !== 'esplora' || !reset)) {
          exhausted.current = true;
          setEnded(true);
        }
        setCards((prev) => {
          if (reset) return keyed(next, []);
          const add = mode === 'esplora' ? next : next.filter((n) => !prev.some((p) => p.id === n.id));
          return [...prev, ...keyed(add, prev)];
        });
        setError(null);
      }
    } catch (e) {
      if (id === request.current) {
        if (reset) setError(friendlyError(e));
        // Aggiornamento o pagina successiva falliti con dei post già sullo schermo: lo si dice, senza toglierli.
        if (cardsRef.current.length) toast('Non riesco ad aggiornare. Controlla la connessione.', 'error');
      }
    } finally {
      if (id === request.current) {
        loadingMore.current = false;
        resetting.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [keyed, mode, toast]);

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
  const saved = useRef<Partial<Record<Mode, { cards: Card[]; activeKey: string | null; ended: boolean; at: number }>>>({});
  const restoreIndex = useRef(0);
  const lastKey = useRef({ version, day });
  const switchMode = (m: Mode) => {
    if (m === mode) return;
    flush();
    saved.current[mode] = { cards: cardsRef.current, activeKey: activeKeyRef.current, ended: exhausted.current, at: Date.now() };
    setMode(m);
  };
  const switchRef = useRef(switchMode);
  switchRef.current = switchMode;
  useEffect(() => onSectionRequest((m) => switchRef.current(m)), []);
  useEffect(() => {
    if (sezione === 'gara' || sezione === 'esplora' || sezione === 'seguiti') switchRef.current(sezione);
  }, [sezione]);

  // Prima apertura di In gara (per questo account): la spiegazione, una volta sola.
  const introKey = me ? `virale.spiegazione.ingara.${me.id}` : null;
  useEffect(() => {
    if (mode !== 'gara' || !introKey) return;
    let alive = true;
    void alreadySeen(introKey).then((seen) => {
      if (!alive || seen) return;
      introRef.current = true;
      // Il tempo passato a leggere non è un voto: la vista del post sotto si scarta.
      current.current = null;
      setIntro(true);
    });
    return () => {
      alive = false;
    };
  }, [introKey, mode]);
  const closeIntro = () => {
    if (introKey) void markSeen(introKey);
    introRef.current = false;
    setIntro(false);
    const visible = cardsRef.current.find((c) => c.key === activeKeyRef.current);
    if (visible && focusedRef.current && !current.current) current.current = { card: visible, since: Date.now() };
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
      restoreIndex.current = Math.max(0, keep.cards.findIndex((c) => c.key === keep.activeKey));
      cardsRef.current = keep.cards;
      setCards(keep.cards);
      setActiveKey(keep.activeKey);
      setError(null);
      setLoading(false);
      return;
    }
    restoreIndex.current = 0;
    setLoading(true);
    setError(null);
    cardsRef.current = [];
    setCards([]);
    setActiveKey(null);
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
        if (focusedRef.current && !current.current && !introRef.current) {
          const visible = cardsRef.current.find((c) => c.key === activeKeyRef.current);
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
      const visible = cardsRef.current.find((c) => c.key === activeKeyRef.current);
      if (visible && !current.current && !introRef.current) current.current = { card: visible, since: Date.now() };
      // Una sezione chiesta da un'altra schermata mentre i Provini erano già aperti.
      const wanted = takeSection();
      if (wanted) switchRef.current(wanted);
      return () => {
        setFocused(false);
        flush();
      };
    }, [flush]),
  );
  const activeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Post spariti altrove ("Non mi interessa", eliminati, autore bloccato): via dalla lista senza ricaricarla
  // (la posizione resta), anche dalle sezioni messe da parte.
  useEffect(
    () =>
      onPostGone((g) => {
        const drop = (c: Card) => ('postId' in g ? c.id === g.postId : c.author.id === g.authorId);
        for (const keep of Object.values(saved.current)) if (keep) keep.cards = keep.cards.filter((c) => !drop(c));
        const list = cardsRef.current;
        if (!list.some(drop)) return;
        const at = list.findIndex((c) => c.key === activeKeyRef.current);
        const next = list.filter((c) => !drop(c));
        if (current.current && drop(current.current.card)) flushRef.current();
        cardsRef.current = next;
        setCards(next);
        if (activeKeyRef.current && !next.some((c) => c.key === activeKeyRef.current)) {
          const after = list.slice(at + 1).find((c) => !drop(c)) ?? next.at(-1);
          setActiveKey(after?.key ?? null);
        }
      }),
    [],
  );
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<Card>[] }) => {
    const visible = viewableItems[0]?.item;
    // Sulla pagina finale non c'è nessun post: si chiude la vista dell'ultimo (non deve contare il tempo lì).
    if (!visible) {
      flushRef.current();
      setActiveKey(null);
      return;
    }
    if (visible.key === current.current?.card.key) return;
    flushRef.current();
    current.current = introRef.current ? null : { card: visible, since: Date.now() };
    views.current[visible.key] = (views.current[visible.key] ?? 0) + 1;
    setActiveKey(visible.key);
  }).current;

  // Le immagini dei prossimi due post si scaricano mentre guardi questo: scorrendo sono già lì.
  useEffect(() => {
    const at = cards.findIndex((c) => c.key === activeKey);
    if (at < 0) return;
    const urls = cards
      .slice(at + 1, at + 3)
      .flatMap((c) => c.media.slice(0, 2).map((m) => (m.kind === 'image' ? resolveMedia(m.src) : m.poster)))
      .filter((u): u is string => typeof u === 'string' && /^https?:/.test(u));
    if (urls.length) void Image.prefetch(urls).catch(() => undefined);
  }, [activeKey, cards]);

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
    ({ item }: { item: Card }) => (
      <View style={{ height }}>
        <PostCard
          post={item}
          meId={me?.id}
          active={focused && !intro && item.key === activeKey}
          viewKey={views.current[item.key] ?? 0}
          blind={mode === 'gara'}
          onInteract={onInteract}
          onVideoProgress={onVideoProgress}
        />
      </View>
    ),
    [activeKey, focused, height, intro, me?.id, mode, onInteract, onVideoProgress],
  );

  // Con i commenti o un profilo aperti sopra (sul web) la lista misura 0: si tiene l'ultima altezza buona,
  // altrimenti la lista si smonterebbe e ripartirebbe dal primo post.
  const onLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) setHeight(h);
  };

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
        <Press style={styles.search} onPress={() => nav.push('/cerca')} accessibilityRole="button" accessibilityLabel="Cerca persone">
          <Icon name="cerca" size={20} color={color.paper} strokeWidth={2} />
        </Press>
      </View>
      {/* In gara: quanto manca alla chiusura, sotto le sezioni (accanto non ci starebbe sui telefoni piccoli). */}
      {mode === 'gara' ? <ArenaClock reveal={reveal} closesAt={closesAt} /> : null}

      {mode === 'gara' && !bandClosed && status?.voter && !status.voter.canVote ? (
        <VoterBand
          status={status}
          onOpen={() => nav.push('/verifica')}
          onClose={() => {
            voterBandClosed = true;
            setBandClosed(true);
          }}
        />
      ) : null}

      <View style={styles.list} onLayout={onLayout}>
        {mode === 'gara' && intro ? <ArenaIntro onClose={closeIntro} /> : null}
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
              {mode === 'seguiti' ? 'Non segui ancora nessuno.' : mode === 'esplora' ? 'Per ora hai visto tutto.' : 'Per ora li hai visti tutti.'}
            </Txt>
            <Txt variant="body" tone={color.paperDim} style={{ textAlign: 'center' }}>
              {mode === 'seguiti'
                ? 'Tocca “Segui” sotto un post che ti piace: i suoi nuovi post arriveranno qui.'
                : mode === 'esplora'
                  ? 'Appena qualcuno pubblica, lo trovi qui.'
                  : 'Ogni post in gara lo vedi una volta sola (i tuoi mai). Votare è guardare: più ti fermi, più conta. Ne arrivano di nuovi durante il giorno.'}
            </Txt>
            {mode === 'gara' ? (
              <Press style={styles.retry} onPress={() => switchMode('esplora')} accessibilityRole="button">
                <Txt variant="label" tone={color.canvas}>
                  Vai su Esplora
                </Txt>
              </Press>
            ) : mode === 'seguiti' ? (
              <Press style={styles.retry} onPress={() => nav.push('/cerca')} accessibilityRole="button">
                <Txt variant="label" tone={color.canvas}>
                  Trova persone da seguire
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
            keyExtractor={(c) => c.key}
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
              ended && mode === 'esplora' ? (
                <View style={[styles.center, { height }]}>
                  <Txt variant="title" style={{ textAlign: 'center' }}>
                    Per ora hai visto tutto.
                  </Txt>
                  <Txt variant="body" tone={color.paperDim} style={{ textAlign: 'center' }}>
                    Appena qualcuno pubblica, lo trovi qui.
                  </Txt>
                  <Press style={styles.retry} onPress={refreshNow} accessibilityRole="button">
                    <Txt variant="label" tone={color.canvas}>
                      Aggiorna
                    </Txt>
                  </Press>
                </View>
              ) : ended ? (
                <View style={[styles.center, { height }]}>
                  <Txt variant="title" style={{ textAlign: 'center' }}>
                    {mode === 'gara' ? 'Per ora li hai visti tutti.' : 'Sei in pari con chi segui.'}
                  </Txt>
                  <Txt variant="body" tone={color.paperDim} style={{ textAlign: 'center' }}>
                    {mode === 'gara'
                      ? 'Ogni post in gara lo vedi una volta sola (i tuoi mai). Votare è guardare: più ti fermi, più conta. Ne arrivano di nuovi durante il giorno.'
                      : 'Intanto scopri qualcosa di nuovo.'}
                  </Txt>
                  <Press style={styles.retry} onPress={() => switchMode('esplora')} accessibilityRole="button">
                    <Txt variant="label" tone={color.canvas}>
                      Vai su Esplora
                    </Txt>
                  </Press>
                  {mode === 'seguiti' ? (
                    <Press style={styles.ghostBtn} onPress={() => nav.push('/cerca')} accessibilityRole="button">
                      <Txt variant="label">Trova persone da seguire</Txt>
                    </Press>
                  ) : null}
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

/** Quanto manca alla chiusura della gara ("Chiude tra 14 h 27 min"): vive da solo, così non ridisegna il feed. */
function ArenaClock({ reveal, closesAt }: { reveal: number; closesAt?: string }) {
  const left0 = () => msUntil(closesAt, msUntilReveal(reveal));
  const [left, setLeft] = useState(left0);
  useEffect(() => {
    const tick = () => {
      const next = msUntil(closesAt, msUntilReveal(reveal));
      setLeft((cur) => (relTime(cur) === relTime(next) ? cur : next));
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [reveal, closesAt]);
  return (
    <View style={styles.clock} accessible accessibilityLabel={`La gara chiude tra ${relTimeLong(left)}`}>
      <Icon name="orologio" size={14} color={color.giallo} strokeWidth={2} />
      <Txt variant="meta" tone={color.paperDim} style={{ fontFamily: font.uiBold }} numberOfLines={1}>
        {`Chiude tra ${relTime(left)}`}
      </Txt>
    </View>
  );
}

/** Chiusa una volta, la fascia del voto resta chiusa fino al prossimo avvio dell'app. */
let voterBandClosed = false;

/** Perché il voto di chi guarda non conta ancora, con il modo per rimediare (quando c'è). */
function VoterBand({ status, onOpen, onClose }: { status: NonNullable<ReturnType<typeof useSession>['status']>; onOpen: () => void; onClose: () => void }) {
  const id = status.identity;
  const expired = id?.canAct === false;
  const unverified = !expired && id?.status !== 'approved';
  const from = status.voter?.from ? new Date(status.voter.from) : null;
  const when = from
    ? `${from.toDateString() === new Date().toDateString() ? 'oggi' : from.toDateString() === new Date(Date.now() + 86400000).toDateString() ? 'domani' : from.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })} alle ${from.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`
    : 'domani';
  const text = expired
    ? 'Verifica scaduta: puoi guardare ma non votare.'
    : unverified
      ? 'Il tuo voto conterà dopo la verifica dell’età.'
      : `Il tuo voto conterà da ${when}: gli account nuovi guardano per 24 ore.`;
  const action = expired || unverified;
  return (
    <View style={styles.band}>
      <Press style={{ flex: 1, minHeight: 36, justifyContent: 'center' }} onPress={action ? onOpen : undefined} disabled={!action} accessibilityRole={action ? 'button' : 'text'}>
        <Txt variant="meta" tone={color.paperDim}>
          {text}
          {action ? (
            <Txt variant="meta" tone={color.giallo} style={{ fontFamily: font.uiBold }}>
              {' Verifica ora'}
            </Txt>
          ) : null}
        </Txt>
      </Press>
      <Press style={styles.bandClose} onPress={onClose} accessibilityRole="button" accessibilityLabel="Chiudi l’avviso">
        <Icon name="chiudi" size={16} color={color.paperFaint} />
      </Press>
    </View>
  );
}

/** La spiegazione di In gara, alla prima apertura. */
function ArenaIntro({ onClose }: { onClose: () => void }) {
  const lines: { icon: 'provini' | 'occhio' | 'cerchia' | 'copertina'; text: string }[] = [
    { icon: 'provini', text: 'Ogni post in gara lo vedi una volta sola, i tuoi mai.' },
    { icon: 'occhio', text: 'Niente numeri: conta come guardi. Più ti fermi, più conta.' },
    { icon: 'cerchia', text: 'Doppio tocco o il cerchio qui sotto: è il nostro mi piace.' },
    { icon: 'copertina', text: 'Quando la gara chiude, il più apprezzato diventa la copertina.' },
  ];
  return (
    <View style={styles.introWrap} accessibilityViewIsModal>
      <View style={styles.intro}>
        <Txt variant="heading" accessibilityRole="header">
          Qui voti guardando
        </Txt>
        {lines.map((l) => (
          <View key={l.text} style={styles.introLine}>
            <Icon name={l.icon} size={22} color={l.icon === 'cerchia' ? color.matita : color.giallo} />
            <Txt variant="body" style={{ flex: 1 }}>
              {l.text}
            </Txt>
          </View>
        ))}
        <Press style={[styles.retry, { alignSelf: 'stretch', alignItems: 'center' }]} onPress={onClose} accessibilityRole="button">
          <Txt variant="label" tone={color.canvas}>
            Ho capito
          </Txt>
        </Press>
      </View>
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
  seg: { flex: 1, maxWidth: 360, flexDirection: 'row', backgroundColor: color.raised, borderRadius: radius.pill, padding: 4 },
  segPill: { position: 'absolute', top: 4, left: 4, bottom: 4, backgroundColor: color.paper, borderRadius: radius.pill },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  clock: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: space[2] },
  list: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  retry: { marginTop: space[3], backgroundColor: color.giallo, borderRadius: radius.pill, paddingHorizontal: 22, paddingVertical: 12 },
  ghostBtn: { backgroundColor: color.raised, borderRadius: radius.pill, paddingHorizontal: 22, paddingVertical: 12 },
  band: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginHorizontal: space[4], marginBottom: space[1], paddingLeft: space[3], backgroundColor: color.raised, borderRadius: radius.control },
  bandClose: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  introWrap: { ...StyleSheet.absoluteFillObject, zIndex: 5, backgroundColor: 'rgba(12,19,34,0.88)', justifyContent: 'center', padding: space[5] },
  intro: { backgroundColor: color.sheet, borderRadius: radius.card, padding: space[5], gap: space[4] },
  introLine: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  search: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
});
