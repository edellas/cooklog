import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../src/components/Icon';
import { Monogram } from '../../src/components/Monogram';
import { haptic, Press } from '../../src/components/Press';
import { useToast } from '../../src/components/Toast';
import { Txt } from '../../src/components/Txt';
import { color, radius, space } from '../../src/design/tokens';
import { listFollows, toggleFollow } from '../../src/services/api';
import { emitFollowChange } from '../../src/state/postEvents';
import { useGoBack } from '../../src/state/useGoBack';
import type { FollowRow } from '../../src/types';

type Kind = 'followers' | 'following';

/** Chi segue un profilo e chi quel profilo segue, con il tasto per seguire a propria volta. */
export default function FollowsScreen() {
  const { username, tipo } = useLocalSearchParams<{ username: string; tipo?: Kind }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useGoBack();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>(tipo === 'following' ? 'following' : 'followers');
  const [rows, setRows] = useState<FollowRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    listFollows(username, kind)
      .then((r) => alive && setRows(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [username, kind]);

  const follow = (row: FollowRow) => {
    const on = !row.followedByMe;
    haptic('light');
    setRows((list) => (list ?? []).map((x) => (x.id === row.id ? { ...x, followedByMe: on } : x)));
    emitFollowChange(row.id, on);
    toggleFollow(row.id, on).catch(() => {
        setRows((list) => (list ?? []).map((x) => (x.id === row.id ? { ...x, followedByMe: !on } : x)));
        emitFollowChange(row.id, !on);
        toast('Non ci sono riuscito. Riprova.', 'error');
      });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Press style={styles.round} onPress={goBack} accessibilityRole="button" accessibilityLabel="Indietro">
          <Icon name="indietro" />
        </Press>
        <Txt variant="title">@{username}</Txt>
        <View style={{ width: 40 }} />
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(['followers', 'following'] as Kind[]).map((k) => (
          <Press key={k} style={[styles.tab, kind === k && styles.tabOn]} scaleTo={1} onPress={() => setKind(k)} accessibilityRole="tab" accessibilityState={{ selected: kind === k }}>
            <Txt variant="label" tone={kind === k ? color.paper : color.paperFaint}>
              {k === 'followers' ? 'Follower' : 'Seguiti'}
            </Txt>
          </Press>
        ))}
      </View>
      {error ? (
        <Txt variant="body" tone={color.paperDim} style={styles.empty}>
          {error}
        </Txt>
      ) : rows === null ? (
        <ActivityIndicator color={color.giallo} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: space[4], paddingBottom: insets.bottom + space[8], gap: space[2] }}
          ListEmptyComponent={
            <Txt variant="body" tone={color.paperDim} style={styles.empty}>
              {kind === 'followers' ? 'Ancora nessun follower.' : 'Non segue ancora nessuno.'}
            </Txt>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Press style={styles.person} onPress={() => router.push(`/utente/${item.username}` as Href)} accessibilityRole="link" accessibilityLabel={`Profilo di @${item.username}`}>
                <Monogram name={item.displayName} seed={item.username} size={40} />
                <View style={{ flexShrink: 1 }}>
                  <Txt variant="label" numberOfLines={1}>
                    {item.displayName}
                  </Txt>
                  <Txt variant="meta" tone={color.paperFaint} numberOfLines={1}>
                    @{item.username}
                  </Txt>
                </View>
              </Press>
              {item.isMe ? null : (
                <Press
                  style={[styles.follow, item.followedByMe && styles.following]}
                  onPress={() => follow(item)}
                  accessibilityRole="button"
                  accessibilityLabel={item.followedByMe ? `Smetti di seguire @${item.username}` : `Segui @${item.username}`}>
                  <Txt variant="meta" tone={item.followedByMe ? color.paper : color.canvas} style={{ fontFamily: 'SchibstedGrotesk_700Bold' }}>
                    {item.followedByMe ? 'Segui già' : 'Segui'}
                  </Txt>
                </Press>
              )}
            </View>
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
  tabs: { flexDirection: 'row', gap: space[2], paddingHorizontal: space[4], paddingBottom: space[2] },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill },
  tabOn: { backgroundColor: color.raised },
  empty: { textAlign: 'center', padding: space[8] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  person: { flexDirection: 'row', alignItems: 'center', gap: space[3], flexShrink: 1, paddingVertical: space[1] },
  follow: { backgroundColor: color.giallo, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8 },
  following: { backgroundColor: color.raised },
});
