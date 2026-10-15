import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../src/components/Icon';
import { haptic, Press } from '../src/components/Press';
import { Thumb } from '../src/components/Thumb';
import { useToast } from '../src/components/Toast';
import { Txt } from '../src/components/Txt';
import { timeAgo } from '../src/design/format';
import { color, radius, space } from '../src/design/tokens';
import { getModQueue, isDemo, modResolve, REPORT_REASONS, type ModItem } from '../src/services/api';
import { useSession } from '../src/state/session';

const label = (r: string) => REPORT_REASONS.find((x) => x.key === r)?.label ?? r;

/**
 * Coda delle segnalazioni per i moderatori. Gli store chiedono di agire entro 24 ore:
 * “Va bene” rimette il post visibile (e in gara), “Rimuovi” lo elimina dalla vista di tutti,
 * “Espelli” rimuove il post e blocca l'autore per sempre.
 */
export default function Moderation() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { bump } = useSession();
  const [items, setItems] = useState<ModItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void getModQueue()
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const act = async (item: ModItem, action: 'dismiss' | 'remove' | 'ban') => {
    await modResolve(item.post.id, action);
    haptic('light');
    bump();
    setItems((list) => (list ?? []).filter((x) => x.post.id !== item.post.id));
    toast(action === 'dismiss' ? 'Post ripristinato.' : action === 'remove' ? 'Post rimosso.' : `@${item.post.author.username} espulso.`);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Press style={styles.round} onPress={() => router.back()} accessibilityLabel="Indietro">
          <Icon name="indietro" />
        </Press>
        <Txt variant="title">Moderazione</Txt>
        <View style={{ width: 40 }} />
      </View>
      {error ? (
        <Txt variant="body" style={{ padding: space[5] }}>
          {error}
        </Txt>
      ) : items === null ? (
        <ActivityIndicator color={color.giallo} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.post.id}
          contentContainerStyle={{ padding: space[4], paddingBottom: insets.bottom + space[8], gap: space[4] }}
          ListHeaderComponent={
            isDemo ? (
              <Txt variant="small" tone={color.paperFaint} style={{ marginBottom: space[2] }}>
                Demo: qui compaiono i post che hai segnalato. In produzione vedi quelli segnalati da tutti.
              </Txt>
            ) : null
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', gap: space[2], marginTop: space[10] }}>
              <Icon name="check" size={32} color={color.verde} />
              <Txt variant="title">Nessuna segnalazione aperta</Txt>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.thumb}>
                <Thumb media={item.post.media} rounded={10} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Txt variant="label">@{item.post.author.username}</Txt>
                <Txt variant="small" tone={color.paperDim} numberOfLines={2}>
                  {item.post.caption || 'Senza didascalia'}
                </Txt>
                <Txt variant="meta" tone={color.matita}>
                  {item.reports} {item.reports === 1 ? 'segnalazione' : 'segnalazioni'} · {item.reasons.map(label).join(', ')}
                </Txt>
                <Txt variant="meta" tone={color.paperFaint}>
                  Prima segnalazione {timeAgo(item.firstAt) === 'ora' ? 'adesso' : `${timeAgo(item.firstAt)} fa`}{item.hidden ? ' · già nascosto' : ''}
                </Txt>
                <View style={styles.actions}>
                  <Press style={[styles.btn, styles.ok]} onPress={() => void act(item, 'dismiss')} accessibilityRole="button">
                    <Txt variant="meta" tone={color.canvas} style={styles.bold}>
                      Va bene
                    </Txt>
                  </Press>
                  <Press style={[styles.btn, styles.rm]} onPress={() => void act(item, 'remove')} accessibilityRole="button">
                    <Txt variant="meta" style={styles.bold}>
                      Rimuovi
                    </Txt>
                  </Press>
                  <Press style={[styles.btn, styles.ban]} onPress={() => void act(item, 'ban')} accessibilityRole="button">
                    <Txt variant="meta" tone={color.matita} style={styles.bold}>
                      Espelli
                    </Txt>
                  </Press>
                </View>
              </View>
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
  card: { flexDirection: 'row', gap: space[3], backgroundColor: color.raised, borderRadius: radius.card, padding: space[3] },
  thumb: { width: 84, height: 126 },
  actions: { flexDirection: 'row', gap: space[2], marginTop: space[2], flexWrap: 'wrap' },
  btn: { borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7 },
  ok: { backgroundColor: color.verde },
  rm: { backgroundColor: color.line },
  ban: { borderWidth: 1, borderColor: color.matita },
  bold: { fontFamily: 'SchibstedGrotesk_700Bold' },
});
