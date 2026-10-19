import { useIsFocused } from '@react-navigation/native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View, type LayoutChangeEvent, type ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../src/components/Icon';
import type { VideoProgress } from '../../src/components/MediaFrame';
import { PostCard } from '../../src/components/PostCard';
import { Press } from '../../src/components/Press';
import { Txt } from '../../src/components/Txt';
import { color, space } from '../../src/design/tokens';
import { getProfile, getProfilePosts } from '../../src/services/api';
import { takeSeed } from '../../src/state/feedSeed';
import { onPostGone } from '../../src/state/postEvents';
import { useSession } from '../../src/state/session';
import { useGoBack } from '../../src/state/useGoBack';
import { queueView } from '../../src/state/views';
import type { Post } from '../../src/types';
import { friendlyError } from '../../src/services/errors';

/**
 * I post di un profilo (o i salvati) uno sotto l'altro, a tutto schermo come il feed: si parte dal post
 * toccato nella griglia e si scorre su e giù. Arrivati in fondo si caricano i successivi.
 */
export default function ScrollPostsScreen() {
  const { username, da, tipo } = useLocalSearchParams<{ username: string; da?: string; tipo?: string }>();
  const kind = tipo === 'saved' ? 'saved' : 'posts';
  const insets = useSafeAreaInsets();
  const goBack = useGoBack(`/utente/${username}`);
  const focused = useIsFocused();
  const { me } = useSession();
  const [seed] = useState(() => takeSeed(username, kind) ?? []);
  const [posts, setPosts] = useState<Post[]>(seed);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(da ?? null);
  const startIndex = useRef(Math.max(0, seed.findIndex((p) => p.id === da)));
  const done = useRef(false);
  const loadingMore = useRef(false);

  // Aperto senza griglia dietro (pagina ricaricata, link): si carica il profilo.
  useEffect(() => {
    if (seed.length) return;
    let alive = true;
    getProfile(username)
      .then((d) => {
        if (!alive) return;
        const list = kind === 'saved' ? d.saved : d.posts;
        startIndex.current = Math.max(0, list.findIndex((p) => p.id === da));
        setPosts(list);
        if (!list.length) setError(kind === 'saved' ? 'Nessun post salvato.' : 'Nessun post per ora.');
      })
      .catch((e: unknown) => alive && setError(friendlyError(e)));
    return () => {
      alive = false;
    };
  }, [da, kind, seed.length, username]);

  // Un post eliminato, segnalato o di un autore bloccato sparisce subito; se non ne resta nessuno si esce.
  const gone = useRef(false);
  useEffect(
    () =>
      onPostGone((g) => {
        setPosts((prev) => {
          const next = prev.filter((p) => ('postId' in g ? p.id !== g.postId : p.author.id !== g.authorId));
          if (prev.length && !next.length) gone.current = true;
          return next;
        });
      }),
    [],
  );
  useEffect(() => {
    if (gone.current && !posts.length) {
      gone.current = false;
      goBack();
    }
  }, [goBack, posts.length]);

  const loadMore = useCallback(() => {
    const last = posts.at(-1)?.cursor;
    if (done.current || loadingMore.current || !last) return;
    loadingMore.current = true;
    getProfilePosts(username, kind, last)
      .then((page) => {
        if (!page.length) done.current = true;
        setPosts((prev) => [...prev, ...page.filter((n) => !prev.some((p) => p.id === n.id))]);
      })
      .catch(() => undefined)
      .finally(() => {
        loadingMore.current = false;
      });
  }, [kind, posts, username]);

  // Tempo passato su ogni post e video completati: insegnano i gusti, come nel feed.
  const current = useRef<{ id: string; since: number } | null>(null);
  const video = useRef<Record<string, VideoProgress>>({});
  const flush = useCallback(() => {
    const cur = current.current;
    current.current = null;
    if (!cur) return;
    const dwellMs = Date.now() - cur.since;
    const v = video.current[cur.id];
    if (dwellMs >= 250) queueView(cur.id, { dwellMs, completed: v?.completed, rewatched: v?.rewatched });
  }, []);
  const activeRef = useRef(activeId);
  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);
  useFocusEffect(
    useCallback(() => {
      if (activeRef.current && !current.current) current.current = { id: activeRef.current, since: Date.now() };
      return flush;
    }, [flush]),
  );
  const flushRef = useRef(flush);
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<Post>[] }) => {
    const visible = viewableItems[0]?.item;
    if (!visible || visible.id === current.current?.id) return;
    flushRef.current();
    current.current = { id: visible.id, since: Date.now() };
    setActiveId(visible.id);
  }).current;
  const onVideoProgress = useCallback((postId: string, p: VideoProgress) => {
    video.current[postId] = p;
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Post }) => (
      <View style={{ height }}>
        <PostCard post={item} meId={me?.id} active={focused && item.id === activeId} onVideoProgress={onVideoProgress} />
      </View>
    ),
    [activeId, focused, height, me?.id, onVideoProgress],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.bar}>
        <Press style={styles.back} onPress={goBack} accessibilityRole="button" accessibilityLabel="Indietro">
          <Icon name="indietro" />
        </Press>
        <Txt variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
          {kind === 'saved' ? 'Salvati' : `@${username}`}
        </Txt>
      </View>
      {/* Con un foglio aperto sopra (sul web) la lista misura 0: si tiene l'ultima altezza buona. */}
      <View
        style={styles.list}
        onLayout={(e: LayoutChangeEvent) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0) setHeight(h);
        }}>
        {posts.length && height > 0 ? (
          <FlatList
            data={posts}
            keyExtractor={(p) => p.id}
            initialScrollIndex={startIndex.current < posts.length ? startIndex.current : 0}
            pagingEnabled
            decelerationRate="fast"
            snapToInterval={height}
            showsVerticalScrollIndicator={false}
            getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
            viewabilityConfig={{ itemVisiblePercentThreshold: 70 }}
            onViewableItemsChanged={onViewable}
            onEndReachedThreshold={1.5}
            onEndReached={loadMore}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            windowSize={3}
            removeClippedSubviews
            renderItem={renderItem}
          />
        ) : error ? (
          <Txt variant="title" style={{ textAlign: 'center', marginTop: 80 }}>
            {error}
          </Txt>
        ) : (
          <ActivityIndicator color={color.giallo} style={{ marginTop: 80 }} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[1] },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
  list: { flex: 1 },
});
