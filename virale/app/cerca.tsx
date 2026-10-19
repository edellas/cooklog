import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View, type TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../src/components/Avatar';
import { Field } from '../src/components/Field';
import { Icon } from '../src/components/Icon';
import { haptic, Press } from '../src/components/Press';
import { useToast } from '../src/components/Toast';
import { Txt } from '../src/components/Txt';
import { charCount } from '../src/design/text';
import { color, radius, space } from '../src/design/tokens';
import { searchProfiles, toggleFollow } from '../src/services/api';
import { actionError, friendlyError } from '../src/services/errors';
import { useNav } from '../src/state/nav';
import { emitFollowChange } from '../src/state/postEvents';
import { useActGuard } from '../src/state/useActGuard';
import { useGoBack } from '../src/state/useGoBack';
import type { FollowRow } from '../src/types';

/** Cerca persone per nome o @nome. Solo profili: i post in gara restano alla cieca. */
export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const nav = useNav();
  const goBack = useGoBack('/provini');
  const toast = useToast();
  const canAct = useActGuard();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<FollowRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<TextInput>(null);
  const q = query.trim().replace(/^@+/, '');
  const tooShort = charCount(q) < 2;

  // Si cerca dopo 300 ms senza battute; una risposta arrivata tardi (per un testo vecchio) si scarta.
  useEffect(() => {
    if (tooShort) {
      setRows(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const id = setTimeout(() => {
      searchProfiles(q)
        .then((r) => {
          if (!alive) return;
          setRows(r);
          setError(null);
        })
        .catch((e: unknown) => alive && setError(friendlyError(e)))
        .finally(() => alive && setLoading(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [q, tooShort]);

  useEffect(() => {
    const id = setTimeout(() => input.current?.focus(), 300);
    return () => clearTimeout(id);
  }, []);

  const follow = (row: FollowRow) => {
    const on = !row.followedByMe;
    if (on && !canAct()) return;
    haptic('light');
    setRows((list) => (list ?? []).map((x) => (x.id === row.id ? { ...x, followedByMe: on } : x)));
    emitFollowChange(row.id, on);
    toggleFollow(row.id, on).catch((e: unknown) => {
      setRows((list) => (list ?? []).map((x) => (x.id === row.id ? { ...x, followedByMe: !on } : x)));
      emitFollowChange(row.id, !on);
      toast(actionError(e, on ? `Non è stato possibile seguire @${row.username}. Riprova.` : `Non è stato possibile smettere di seguire @${row.username}. Riprova.`), 'error');
    });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Press style={styles.round} onPress={goBack} accessibilityRole="button" accessibilityLabel="Indietro">
          <Icon name="indietro" />
        </Press>
        <Field
          ref={input}
          containerStyle={{ flex: 1 }}
          value={query}
          onChangeText={(t) => setQuery(t.slice(0, 40))}
          placeholder="Cerca persone per nome o @nome"
          accessibilityLabel="Cerca persone"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          prefix={<Icon name="cerca" size={18} color={color.paperFaint} />}
        />
      </View>
      <FlatList
        data={rows ?? []}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: space[4], paddingBottom: insets.bottom + space[8], gap: space[2] }}
        ListHeaderComponent={
          error ? (
            <Txt variant="small" tone={color.matita}>
              {error}
            </Txt>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            {loading ? (
              <ActivityIndicator color={color.giallo} />
            ) : (
              <Txt variant="body" tone={color.paperDim} style={{ textAlign: 'center' }}>
                {tooShort ? 'Scrivi almeno 2 lettere.' : 'Nessuno con questo nome.'}
              </Txt>
            )}
            <Txt variant="small" tone={color.paperFaint} style={{ textAlign: 'center' }}>
              La ricerca trova solo persone: i post in gara restano alla cieca.
            </Txt>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Press style={styles.person} onPress={() => nav.push(`/utente/${item.username}`)} accessibilityRole="link" accessibilityLabel={`Profilo di @${item.username}`}>
              <Avatar name={item.displayName} seed={item.username} uri={item.avatar} size={44} />
              <View style={{ flexShrink: 1 }}>
                <Txt variant="label" numberOfLines={1}>
                  {item.displayName}
                </Txt>
                <Txt variant="meta" tone={color.paperFaint} numberOfLines={1}>
                  @{item.username}
                </Txt>
              </View>
            </Press>
            <Press
              style={[styles.follow, item.followedByMe && styles.following]}
              onPress={() => follow(item)}
              accessibilityRole="button"
              accessibilityLabel={item.followedByMe ? `Smetti di seguire @${item.username}` : `Segui @${item.username}`}>
              <Txt variant="meta" tone={item.followedByMe ? color.paper : color.canvas} style={{ fontFamily: 'SchibstedGrotesk_700Bold' }}>
                {item.followedByMe ? 'Segui già' : 'Segui'}
              </Txt>
            </Press>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[2] },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: space[3], paddingTop: space[10], paddingHorizontal: space[6] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  person: { flexDirection: 'row', alignItems: 'center', gap: space[3], flexShrink: 1, paddingVertical: space[1], minHeight: 44 },
  follow: { backgroundColor: color.giallo, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8, minHeight: 36, justifyContent: 'center' },
  following: { backgroundColor: color.raised },
});
