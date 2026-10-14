import { CooklogColors } from '@/constants/cooklogTheme';
import { ArenaEntryCard, type ArenaInteractions } from '@/src/components/ArenaEntryCard';
import { EmptyState } from '@/src/components/EmptyState';
import { ErrorState } from '@/src/components/ErrorState';
import { LoadingState } from '@/src/components/LoadingState';
import { useAuth } from '@/src/providers/AuthProvider';
import {
  closeArenaNowDemo,
  describeTier,
  getArenaBatch,
  getMyArenaEntry,
  isLocalArena,
  recordArenaView,
  type ArenaCard,
  type MyArenaEntry,
} from '@/src/services/viralService';
import { msUntilArenaClose } from '@/src/viral/engine';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, Share, StyleSheet, Text, View, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const BATCH_SIZE = 10;
const NO_INTERACTIONS: ArenaInteractions = { liked: false, saved: false, shared: false, reported: false };

function formatCountdown(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * L'Arena: i piatti in gara oggi, scelti dal server e mostrati uno alla volta.
 * Il tempo di permanenza su ogni piatto e le interazioni sono i "voti" impliciti.
 */
export function ArenaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [cards, setCards] = useState<ArenaCard[]>([]);
  const [interactions, setInteractions] = useState<Record<string, ArenaInteractions>>({});
  const [myEntry, setMyEntry] = useState<MyArenaEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageHeight, setPageHeight] = useState(0);
  const [countdown, setCountdown] = useState(() => formatCountdown(msUntilArenaClose()));

  const interactionsRef = useRef(interactions);
  const activeRef = useRef<{ entryId: string; since: number } | null>(null);
  const loadingMoreRef = useRef(false);

  const flushActive = useCallback(() => {
    const active = activeRef.current;
    activeRef.current = null;
    if (!active || !user) return;
    const done = interactionsRef.current[active.entryId] ?? NO_INTERACTIONS;
    void recordArenaView(user.id, active.entryId, { dwellMs: Date.now() - active.since, ...done }).catch(() => undefined);
  }, [user]);

  const flushActiveRef = useRef(flushActive);
  useEffect(() => {
    interactionsRef.current = interactions;
    flushActiveRef.current = flushActive;
  }, [interactions, flushActive]);

  const loadMore = useCallback(
    async (reset = false) => {
      if (!user || loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      try {
        setError(null);
        const [batch, mine] = await Promise.all([getArenaBatch(user.id, BATCH_SIZE), getMyArenaEntry(user.id)]);
        setMyEntry(mine);
        setCards((prev) => (reset ? batch : [...prev, ...batch]));
        setExhausted(batch.length === 0);
      } catch {
        setError("Non riesco a caricare l'Arena. Controlla la connessione e riprova.");
      } finally {
        loadingMoreRef.current = false;
        setLoading(false);
      }
    },
    [user],
  );

  useEffect(() => {
    void loadMore(true);
  }, [loadMore]);

  useEffect(() => {
    const id = setInterval(() => setCountdown(formatCountdown(msUntilArenaClose())), 30000);
    return () => clearInterval(id);
  }, []);

  // Uscendo dalla schermata la vista corrente viene registrata.
  useFocusEffect(
    useCallback(() => {
      return () => flushActive();
    }, [flushActive]),
  );

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<ArenaCard>[] }) => {
    const visible = viewableItems[0]?.item;
    if (visible?.entryId === activeRef.current?.entryId) return;
    flushActiveRef.current();
    if (visible) activeRef.current = { entryId: visible.entryId, since: Date.now() };
  }).current;

  const update = (entryId: string, patch: Partial<ArenaInteractions>) =>
    setInteractions((prev) => ({ ...prev, [entryId]: { ...(prev[entryId] ?? NO_INTERACTIONS), ...patch } }));

  const onShare = async (card: ArenaCard) => {
    const res = await Share.share({ message: `Vota questo piatto nell'Arena di Cooklog: ${card.post.title}` });
    if (res.action === Share.sharedAction) update(card.entryId, { shared: true });
  };

  const onReport = (card: ArenaCard) => {
    Alert.alert('Segnala piatto', 'Contenuto inappropriato, spam o non è cibo?', [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Segnala', style: 'destructive', onPress: () => update(card.entryId, { reported: true }) },
    ]);
  };

  const onDemoClose = async () => {
    flushActive();
    const viral = await closeArenaNowDemo();
    Alert.alert(
      'Giornata chiusa',
      viral ? `Vince "${viral.post.title}" di @${viral.post.authorName}: ora è in cima alla Home di tutti.` : 'Nessun vincitore idoneo.',
      [{ text: 'Vai alla Home', onPress: () => router.navigate('/' as Href) }],
    );
    setCards([]);
    setInteractions({});
    setLoading(true);
    void loadMore(true);
  };

  if (!user) return <EmptyState title="Sessione non disponibile." />;
  if (loading && !cards.length) return <LoadingState message="Sto preparando l'Arena..." />;

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
      <Text style={styles.headerTitle}>Arena di oggi · chiude tra {countdown}</Text>
      <Text style={styles.headerSub}>
        {myEntry ? `Il tuo piatto: ${describeTier(myEntry)}` : 'Un solo piatto oggi diventerà virale e lo vedranno tutti.'}
      </Text>
      <View style={styles.headerActions}>
        {!myEntry ? (
          <Pressable style={styles.headerButton} onPress={() => router.push('/add-post?arena=1' as Href)}>
            <Text style={styles.headerButtonLabel}>Partecipa</Text>
          </Pressable>
        ) : null}
        {isLocalArena ? (
          <Pressable style={[styles.headerButton, styles.headerButtonGhost]} onPress={() => void onDemoClose()}>
            <Text style={styles.headerButtonGhostLabel}>Chiudi giornata (demo)</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={styles.root} onLayout={(e) => setPageHeight(e.nativeEvent.layout.height)}>
      {error && !cards.length ? <ErrorState message={error} onRetry={() => void loadMore(true)} /> : null}
      {!cards.length && !error ? (
        <View style={styles.empty}>
          <EmptyState title="Hai visto tutti i piatti in gara per ora. Torna più tardi!" actionLabel="Aggiorna" onAction={() => void loadMore(true)} />
        </View>
      ) : null}
      {pageHeight > 0 && cards.length ? (
        <FlatList
          data={cards}
          keyExtractor={(item) => item.entryId}
          pagingEnabled
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, index) => ({ length: pageHeight, offset: pageHeight * index, index })}
          viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
          onViewableItemsChanged={onViewableItemsChanged}
          onEndReachedThreshold={2}
          onEndReached={() => {
            if (!exhausted) void loadMore();
          }}
          ListFooterComponent={
            exhausted ? (
              <View style={[styles.footer, { height: pageHeight }]}>
                <EmptyState title="Hai visto tutti i piatti in gara per ora. Torna più tardi!" />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <ArenaEntryCard
              card={item}
              height={pageHeight}
              interactions={interactions[item.entryId] ?? NO_INTERACTIONS}
              onToggleLike={() => update(item.entryId, { liked: !(interactions[item.entryId]?.liked ?? false) })}
              onToggleSave={() => update(item.entryId, { saved: !(interactions[item.entryId]?.saved ?? false) })}
              onShare={() => void onShare(item)}
              onReport={() => onReport(item)}
            />
          )}
        />
      ) : null}
      {header}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  empty: { flex: 1, justifyContent: 'center', backgroundColor: CooklogColors.background },
  footer: { justifyContent: 'center', backgroundColor: CooklogColors.background },
  header: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, gap: 4 },
  headerTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  headerSub: { color: 'rgba(255,255,255,0.9)', fontSize: 13 },
  headerActions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  headerButton: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    backgroundColor: CooklogColors.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerButtonLabel: { color: '#FFFFFF', fontWeight: '700' },
  headerButtonGhost: { backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)' },
  headerButtonGhostLabel: { color: '#FFFFFF', fontWeight: '600' },
});
