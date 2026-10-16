import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '../src/components/Icon';
import { Monogram } from '../src/components/Monogram';
import { Press } from '../src/components/Press';
import { Thumb } from '../src/components/Thumb';
import { Txt } from '../src/components/Txt';
import { timeAgo } from '../src/design/format';
import { color, radius, space } from '../src/design/tokens';
import { getNotifications, markNotificationsRead, TIER_NAMES } from '../src/services/api';
import { useSession } from '../src/state/session';
import { useGoBack } from '../src/state/useGoBack';
import type { AppNotification } from '../src/types';

function text(n: AppNotification): string {
  const who = n.actor ? `@${n.actor.username}` : '';
  switch (n.kind) {
    case 'follow':
      return `${who} ha iniziato a seguirti.`;
    case 'like':
      return `${who} ha cerchiato il tuo post.`;
    case 'comment':
      return `${who} ha commentato: “${n.data.body ?? ''}”`;
    case 'tier':
      return `Il tuo post in gara è salito a “${TIER_NAMES[Math.min(n.data.tier ?? 0, TIER_NAMES.length - 1)]}”.`;
    case 'cover':
      return 'Il tuo post è la copertina di Virale: lo vede chiunque apra l’app.';
    case 'identity_ok':
      return 'Età verificata: grazie! Le foto del documento sono state cancellate.';
    case 'identity_ko': {
      const why = (n.data.reason ?? 'riprova con foto più nitide').replace(/[.\s]+$/, '');
      const reason = why.charAt(0).toLowerCase() + why.slice(1);
      if (n.data.final) return `Account chiuso: ${reason}. Virale è aperta dai 14 anni.`;
      return `Documento non accettato: ${reason}. Puoi ricaricarlo.`;
    }
    case 'removed':
      return 'Un tuo post è stato rimosso perché viola le linee guida. Se pensi sia un errore, scrivici.';
  }
}

const ICON: Record<AppNotification['kind'], IconName> = {
  follow: 'segui',
  like: 'cerchia',
  comment: 'commento',
  tier: 'provini',
  cover: 'copertina',
  identity_ok: 'check',
  identity_ko: 'info',
  removed: 'segnala',
};

/** Le notifiche: chi ti segue, mi piace e commenti, i gradini del tuo post, la copertina, la verifica. */
export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useGoBack('/profilo');
  const { status, refreshStatus } = useSession();
  const unread = status?.unread ?? 0;
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const loadingMore = useRef(false);
  const ended = useRef(false);

  // Più vecchie, a pagine, arrivati in fondo.
  const loadMore = () => {
    const last = items?.at(-1)?.createdAt;
    if (!last || loadingMore.current || ended.current) return;
    loadingMore.current = true;
    getNotifications(last)
      .then((page) => {
        if (!page.length) ended.current = true;
        setItems((list) => {
          const have = new Set((list ?? []).map((n) => n.id));
          return [...(list ?? []), ...page.filter((n) => !have.has(n.id))];
        });
      })
      .catch(() => undefined)
      .finally(() => {
        loadingMore.current = false;
      });
  };

  useFocusEffect(
    useCallback(() => {
      void tick;
      let alive = true;
      ended.current = false;
      getNotifications()
        .then(async (list) => {
          if (!alive) return;
          setItems(list);
          setError(false);
          // Segno lette solo quelle che ho davvero mostrato: una arrivata un attimo dopo resta nuova.
          if (list.some((n) => !n.read) || unread > 0) {
            const newest = list.reduce<string | null>((m, n) => (!m || n.createdAt > m ? n.createdAt : m), null);
            if (newest) await markNotificationsRead(newest).catch(() => undefined);
            void refreshStatus();
          }
        })
        .catch(() => alive && setError(true))
        .finally(() => alive && setRefreshing(false));
      return () => {
        alive = false;
      };
    }, [refreshStatus, unread, tick]),
  );

  const open = (n: AppNotification) => {
    if (n.kind === 'identity_ko' && n.data.final) return;
    if (n.kind === 'identity_ko' || n.kind === 'identity_ok') return router.push('/verifica' as Href);
    if (n.post) return router.push(`/post/${n.post.id}` as Href);
    if (n.actor) return router.push(`/utente/${n.actor.username}` as Href);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Press style={styles.round} onPress={goBack} accessibilityRole="button" accessibilityLabel="Indietro">
          <Icon name="indietro" />
        </Press>
        <Txt variant="title">Notifiche</Txt>
        <View style={{ width: 40 }} />
      </View>
      {items === null && error ? (
        <Txt variant="body" tone={color.paperDim} style={styles.empty}>
          Non riesco a caricare le notifiche. Controlla la connessione e riapri questa pagina.
        </Txt>
      ) : items === null ? (
        <ActivityIndicator color={color.giallo} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ padding: space[4], paddingBottom: insets.bottom + space[8], gap: space[2] }}
          onEndReachedThreshold={0.6}
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
          ListEmptyComponent={
            <Txt variant="body" tone={color.paperDim} style={styles.empty}>
              Ancora niente. Qui trovi chi ti segue, chi cerchia e commenta i tuoi post, e come va il tuo post in gara.
            </Txt>
          }
          renderItem={({ item }) => (
            <Press style={[styles.row, !item.read && styles.unread]} onPress={() => open(item)} accessibilityRole="button" accessibilityLabel={text(item)}>
              {item.actor ? (
                <Monogram name={item.actor.displayName} seed={item.actor.username} size={38} />
              ) : (
                <View style={styles.badge}>
                  <Icon name={ICON[item.kind]} size={20} color={color.giallo} />
                </View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="small" numberOfLines={3}>
                  {text(item)}
                </Txt>
                <Txt variant="meta" tone={color.paperFaint}>
                  {timeAgo(item.createdAt) === 'ora' ? 'adesso' : `${timeAgo(item.createdAt)} fa`}
                </Txt>
              </View>
              {item.post ? (
                <View style={styles.thumb}>
                  <Thumb media={item.post.media} rounded={6} />
                </View>
              ) : null}
            </Press>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], paddingVertical: space[2] },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
  empty: { textAlign: 'center', padding: space[8] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], borderRadius: radius.card },
  unread: { backgroundColor: color.raised },
  badge: { width: 38, height: 38, borderRadius: 19, backgroundColor: color.sheet, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 40, height: 60 },
});
