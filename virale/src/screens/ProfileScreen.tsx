import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PostView } from '../components/PostView';
import { TierProgress } from '../components/TierProgress';
import { getMyEntry, getMyPosts, isDemo, resetDemo } from '../services/api';
import { colors, formatDay } from '../theme';
import type { DailyViral, Me, MyEntry, Post } from '../types';

export function ProfileScreen({ me, refreshKey, onOpenRules, onReset }: { me: Me; refreshKey: number; onOpenRules: () => void; onReset: () => void }) {
  const insets = useSafeAreaInsets();
  const [entry, setEntry] = useState<MyEntry | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [wins, setWins] = useState<DailyViral[]>([]);

  useEffect(() => {
    void getMyEntry().then(setEntry).catch(() => undefined);
    void getMyPosts()
      .then((res) => {
        setPosts(res.posts);
        setWins(res.wins);
      })
      .catch(() => undefined);
  }, [refreshKey]);

  const [confirmReset, setConfirmReset] = useState(false);
  const reset = async () => {
    if (!confirmReset) return setConfirmReset(true);
    await resetDemo();
    onReset();
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{me.displayName.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{me.displayName}</Text>
          <Text style={styles.username}>@{me.username}</Text>
        </View>
      </View>

      <View style={styles.stats}>
        <Stat value={posts.length} label="Contenuti" />
        <Stat value={wins.length} label="Volte virale" />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>In gara oggi</Text>
        {entry ? <TierProgress entry={entry} /> : <Text style={styles.muted}>Non stai partecipando. Pubblica e attiva “Candida al Virale”.</Text>}
      </View>

      {wins.length ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🏆 Le tue vittorie</Text>
          {wins.map((w) => (
            <Text key={w.featuredOn} style={styles.win}>
              {formatDay(w.featuredOn)} · visto da tutta l’app
            </Text>
          ))}
        </View>
      ) : null}

      <Text style={styles.section}>I tuoi contenuti</Text>
      {posts.length ? (
        <View style={styles.grid}>
          {posts.map((p) => (
            <View key={p.id} style={styles.tile}>
              <PostView post={p} active={false} compact />
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.muted}>Ancora niente. Il primo contenuto potrebbe essere quello giusto.</Text>
      )}

      <Pressable style={styles.link} onPress={onOpenRules}>
        <Text style={styles.linkText}>❓ Come funziona la gara</Text>
      </Pressable>
      {isDemo ? (
        <Pressable style={styles.link} onPress={() => void reset()}>
          <Text style={[styles.linkText, { color: colors.danger }]}>
            {confirmReset ? 'Tocca di nuovo per cancellare tutto' : 'Ricomincia la demo da zero'}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFF', fontSize: 32, fontWeight: '900' },
  name: { color: '#FFF', fontSize: 22, fontWeight: '900' },
  username: { color: colors.textMuted, fontSize: 15 },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 12, alignItems: 'center' },
  statValue: { color: '#FFF', fontSize: 22, fontWeight: '900' },
  card: { backgroundColor: colors.surfaceAlt, borderRadius: 14, padding: 14, gap: 8 },
  cardTitle: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  win: { color: colors.accentAlt, fontWeight: '700' },
  section: { color: '#FFF', fontWeight: '800', fontSize: 17, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: { width: '32%', aspectRatio: 9 / 16, borderRadius: 8, overflow: 'hidden' },
  muted: { color: colors.textMuted, fontSize: 13 },
  link: { paddingVertical: 8 },
  linkText: { color: colors.accent, fontWeight: '700' },
});
