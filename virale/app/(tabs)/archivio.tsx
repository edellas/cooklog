import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Press } from '../../src/components/Press';
import { Thumb } from '../../src/components/Thumb';
import { Txt } from '../../src/components/Txt';
import { shortDate } from '../../src/design/format';
import { color, font, radius, space } from '../../src/design/tokens';
import { getArchive } from '../../src/services/api';
import { useSession } from '../../src/state/session';
import type { Cover } from '../../src/types';
import { useNav } from '../../src/state/nav';

/** L'Archivio: tutte le copertine uscite, come una pila di numeri arretrati. */
export default function ArchiveTab() {
  const insets = useSafeAreaInsets();
  const nav = useNav();
  const { version } = useSession();
  const [covers, setCovers] = useState<Cover[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  /** Pagine più vecchie, arrivati in fondo: l'Archivio non si ferma alle ultime copertine. */
  const loadingMore = useRef(false);
  const ended = useRef(false);

  useFocusEffect(
    useCallback(() => {
      void version; // ricarica quando altrove cambia qualcosa (nuovo post, nuova copertina)
      void tick;
      ended.current = false;
      getArchive()
        .then((all) => {
          setCovers(all);
          setFailed(false);
        })
        .catch(() => setFailed(true))
        .finally(() => setRefreshing(false));
    }, [version, tick]),
  );

  const loadMore = () => {
    const last = covers?.at(-1)?.featuredOn;
    if (!last || loadingMore.current || ended.current) return;
    loadingMore.current = true;
    getArchive(last)
      .then((page) => {
        if (!page.length) ended.current = true;
        setCovers((list) => {
          const have = new Set((list ?? []).map((c) => c.featuredOn));
          return [...(list ?? []), ...page.filter((c) => !have.has(c.featuredOn))];
        });
      })
      .catch(() => undefined)
      .finally(() => {
        loadingMore.current = false;
      });
  };
  // Le uscite finora: il numero della più recente (l'elenco arriva a pagine).
  const issues = covers?.[0]?.issue ?? 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top + space[3] }]}>
      {covers === null && failed ? (
        <Txt variant="body" tone={color.paperDim} style={{ textAlign: 'center', marginTop: 80, paddingHorizontal: space[6] }}>
          Non riesco a caricare l’Archivio. Controlla la connessione: riprovo quando torni su questa pagina.
        </Txt>
      ) : covers === null ? (
        <ActivityIndicator color={color.giallo} style={{ marginTop: 80 }} />
      ) : (
        <FlatList
          data={covers}
          keyExtractor={(c) => `${c.featuredOn}-${c.post.id}`}
          numColumns={2}
          onEndReachedThreshold={0.8}
          onEndReached={loadMore}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                setTick((n) => n + 1);
              }}
              tintColor={color.giallo}
              colors={[color.giallo]}
              progressBackgroundColor={color.raised}
            />
          }
          columnWrapperStyle={{ gap: space[3] }}
          contentContainerStyle={{ paddingHorizontal: space[4], paddingBottom: space[10], gap: space[5] }}
          ListHeaderComponent={
            <View style={styles.head}>
              <Txt variant="heading">Archivio</Txt>
              <Txt variant="body" tone={color.paperDim}>
                {`Una copertina al giorno, scelta da chi guarda. ${issues} ${issues === 1 ? 'uscita' : 'uscite'} finora.`}
              </Txt>
            </View>
          }
          renderItem={({ item }) => (
            <Press style={styles.cell} onPress={() => nav.push(`/copertina/${item.featuredOn}`)} accessibilityRole="link" accessibilityLabel={`Copertina numero ${item.issue}`}>
              <View style={styles.cover}>
                <Thumb media={item.post.media} rounded={radius.card} />
                <View style={styles.coverTop} pointerEvents="none">
                  <Txt style={styles.miniMast}>Virale</Txt>
                </View>
                <View style={styles.coverBottom} pointerEvents="none">
                  <Txt variant="meta" tone={color.canvas} style={{ fontFamily: font.uiBold }}>
                    N. {item.issue}
                  </Txt>
                </View>
              </View>
              <Txt variant="label" numberOfLines={1}>
                @{item.post.author.username}
              </Txt>
              <Txt variant="meta" tone={color.paperFaint}>
                {shortDate(item.featuredOn)} · su {item.totalEntries.toLocaleString('it-IT')} {item.totalEntries === 1 ? 'provino' : 'provini'}
              </Txt>
            </Press>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  head: { gap: space[2], marginBottom: space[2] },
  cell: { flex: 1, gap: 4, maxWidth: '50%' },
  cover: { aspectRatio: 2 / 3, borderRadius: radius.card, overflow: 'hidden', marginBottom: space[1] },
  coverTop: { position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center' },
  miniMast: { fontFamily: font.displayHeavy, fontSize: 30, lineHeight: 32, letterSpacing: -1, color: color.paper, textShadowColor: 'rgba(8,12,22,0.7)', textShadowRadius: 10, textShadowOffset: { width: 0, height: 1 } },
  coverBottom: { position: 'absolute', left: 8, bottom: 8, backgroundColor: color.giallo, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
});
