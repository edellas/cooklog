import { EmptyState } from '@/src/components/EmptyState';
import { ErrorState } from '@/src/components/ErrorState';
import { FoodPostCard } from '@/src/components/FoodPostCard';
import { LoadingState } from '@/src/components/LoadingState';
import { loadFeed, toggleLike, toggleSave } from '@/src/services/feedService';
import { getSubscriptionStatus, setSavedRecipesCount } from '@/src/services/subscriptionService';
import { hrefRecipeDetail } from '@/lib/cooklogHref';
import { useAuth } from '@/src/providers/AuthProvider';
import type { FoodPost } from '@/src/types';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';

const PAGE_SIZE = 10;

export function FeedScreen() {
  const { height } = useWindowDimensions();
  const router = useRouter();
  const { user, interests } = useAuth();
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<FoodPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const seenIdsRef = useRef<string[]>([]);

  const runLoad = useCallback(
    async (nextPage: number, reset = false) => {
      if (!user) return;
      try {
        if (reset) {
          setRefreshing(true);
          setError(null);
        } else if (nextPage === 0) {
          setLoading(true);
        }
        const res = await loadFeed({
          currentUserId: user.id,
          interests,
          page: nextPage,
          pageSize: PAGE_SIZE,
          seenPostIds: reset ? [] : seenIdsRef.current,
        });
        setItems((prev) => {
          const nextItems = reset || nextPage === 0 ? res.items : [...prev, ...res.items];
          seenIdsRef.current = nextItems.map((x) => x.id);
          return nextItems;
        });
        setHasMore(res.hasMore);
        setPage(nextPage);
      } catch {
        setError('Non riesco a caricare il feed. Controlla la connessione e riprova.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [interests, user],
  );

  useEffect(() => {
    void runLoad(0, true);
  }, [runLoad]);

  const onEndReached = () => {
    if (!hasMore || loading || refreshing) return;
    void runLoad(page + 1);
  };

  const onToggleLike = async (post: FoodPost) => {
    if (!user) return;
    const updated = await toggleLike(post, user.id);
    setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const onToggleSave = async (post: FoodPost) => {
    if (!user) return;
    const subscription = await getSubscriptionStatus(user.id);
    if (!post.isSavedByCurrentUser && !subscription.isPro && subscription.savedRecipesCount >= subscription.maxSavedRecipes) {
      router.push('/paywall' as Href);
      return;
    }
    const updated = await toggleSave(post, user.id);
    setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    const delta = updated.isSavedByCurrentUser ? 1 : -1;
    await setSavedRecipesCount(user.id, Math.max(0, subscription.savedRecipesCount + delta));
  };

  if (loading && !items.length) return <LoadingState message="Sto caricando il tuo feed..." />;
  if (error && !items.length) return <ErrorState message={error} onRetry={() => void runLoad(0, true)} />;
  if (!items.length) {
    return (
      <EmptyState
        title="Ancora nessun piatto nel tuo feed."
        actionLabel="Pubblica il primo"
        onAction={() => router.push('/add-post' as Href)}
      />
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        pagingEnabled
        decelerationRate="fast"
        snapToAlignment="start"
        onEndReachedThreshold={0.65}
        onEndReached={onEndReached}
        refreshing={refreshing}
        onRefresh={() => void runLoad(0, true)}
        renderItem={({ item }) => (
          <FoodPostCard
            post={item}
            screenHeight={height - 96}
            onToggleLike={() => void onToggleLike(item)}
            onToggleSave={() => void onToggleSave(item)}
            onOpenComments={() => router.push(`/comments/${item.id}` as Href)}
            onOpenRecipe={() => router.push(hrefRecipeDetail(item.recipeId ?? item.id))}
          />
        )}
      />
      {error ? <ErrorState message={error} onRetry={() => void runLoad(0, true)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
});
