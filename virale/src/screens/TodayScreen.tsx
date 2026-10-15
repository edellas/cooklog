import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { msUntilArenaClose } from '../engine/engine';
import { PostView } from '../components/PostView';
import { getDailyViral, getHallOfFame } from '../services/api';
import { colors, formatCount, formatCountdown, formatDay } from '../theme';
import type { DailyViral, Me } from '../types';

/** La prima cosa che vede chiunque apra l'app: l'unico contenuto virale di oggi. */
export function TodayScreen({
  me,
  refreshKey,
  onOpenRules,
  onGoArena,
}: {
  me: Me;
  refreshKey: number;
  onOpenRules: () => void;
  onGoArena: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [viral, setViral] = useState<DailyViral | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHall, setShowHall] = useState(false);
  const [countdown, setCountdown] = useState(() => formatCountdown(msUntilArenaClose()));

  const load = useCallback(async () => {
    try {
      setError(null);
      setViral(await getDailyViral());
    } catch {
      setError('Connessione assente. Riprova.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const id = setInterval(() => setCountdown(formatCountdown(msUntilArenaClose())), 30000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const isMine = viral?.post.authorId === me.id;

  return (
    <View style={styles.root}>
      {viral ? <PostView post={viral.post} active /> : <View style={styles.emptyBg} />}
      <View style={styles.shade} pointerEvents="none" />

      <View style={[styles.top, { paddingTop: insets.top + 12 }]}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>🔥 IL VIRALE DI OGGI</Text>
        </View>
        {viral ? <Text style={styles.topSub}>{formatDay(viral.featuredOn)} · lo stesso per tutti</Text> : null}
      </View>

      {viral ? (
        <View style={styles.bottom}>
          {isMine ? <Text style={styles.mine}>🎉 Sei tu! Oggi ti vede tutta l’app.</Text> : null}
          <Text style={styles.author}>@{viral.post.authorUsername}</Text>
          {viral.post.caption ? <Text style={styles.caption}>{viral.post.caption}</Text> : null}
          <Text style={styles.stats}>
            Ha battuto altri {formatCount(Math.max(0, viral.totalEntries - 1))} contenuti · {formatCount(viral.totalViews)} viste in gara
          </Text>
          <View style={styles.actions}>
            <Pressable style={styles.secondary} onPress={() => setShowHall(true)}>
              <Text style={styles.secondaryText}>🏆 Albo d’oro</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={onOpenRules}>
              <Text style={styles.secondaryText}>❓ Come funziona</Text>
            </Pressable>
          </View>
          <Pressable style={styles.primary} onPress={onGoArena}>
            <Text style={styles.primaryText}>Domani puoi esserci tu · la gara chiude tra {countdown} →</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>{error ?? 'Oggi nessun virale.'}</Text>
          <Text style={styles.emptyText}>Il primo vincitore apparirà qui domani. Partecipa alla gara di oggi!</Text>
          <Pressable style={styles.primary} onPress={error ? () => void load() : onGoArena}>
            <Text style={styles.primaryText}>{error ? 'Riprova' : 'Vai all’Arena →'}</Text>
          </Pressable>
        </View>
      )}

      <HallOfFame visible={showHall} onClose={() => setShowHall(false)} />
    </View>
  );
}

function HallOfFame({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<DailyViral[] | null>(null);

  useEffect(() => {
    if (visible) void getHallOfFame().then(setItems).catch(() => setItems([]));
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={[styles.sheet, { paddingTop: insets.top + 16 }]}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>🏆 Albo d’oro</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>Chiudi</Text>
          </Pressable>
        </View>
        {items === null ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(v) => `${v.featuredOn}-${v.post.id}`}
            contentContainerStyle={{ gap: 10, paddingBottom: insets.bottom + 24 }}
            ListEmptyComponent={<Text style={styles.emptyText}>Ancora nessun vincitore.</Text>}
            renderItem={({ item }) => (
              <View style={styles.hallRow}>
                <View style={styles.hallThumb}>
                  <PostView post={item.post} active={false} compact />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.hallDate}>{formatDay(item.featuredOn)}</Text>
                  <Text style={styles.hallAuthor}>@{item.post.authorUsername}</Text>
                  <Text style={styles.hallText} numberOfLines={2}>
                    {item.post.caption || item.post.body}
                  </Text>
                  <Text style={styles.hallStats}>su {formatCount(item.totalEntries)} contenuti in gara</Text>
                </View>
              </View>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  emptyBg: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.surface },
  shade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.15)' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', gap: 6 },
  badge: { backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  badgeText: { color: '#FFF', fontWeight: '900', letterSpacing: 1, fontSize: 13 },
  topSub: { color: '#FFF', fontSize: 12, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  bottom: { position: 'absolute', left: 16, right: 16, bottom: 16, gap: 6 },
  mine: { color: colors.accentAlt, fontWeight: '800', fontSize: 15 },
  author: { color: '#FFF', fontSize: 20, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  caption: { color: '#FFF', fontSize: 15, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  stats: { color: colors.textMuted, fontSize: 12, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  secondary: { backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  secondaryText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  primary: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center', marginTop: 4 },
  primaryText: { color: '#FFF', fontWeight: '800', fontSize: 14, textAlign: 'center' },
  emptyBox: { position: 'absolute', left: 24, right: 24, top: '35%', gap: 10, alignItems: 'center' },
  emptyTitle: { color: '#FFF', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  sheet: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: 16, gap: 12 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { color: '#FFF', fontSize: 22, fontWeight: '800' },
  close: { color: colors.accent, fontWeight: '700', fontSize: 15 },
  hallRow: { flexDirection: 'row', gap: 12, backgroundColor: colors.surfaceAlt, borderRadius: 14, padding: 10, alignItems: 'center' },
  hallThumb: { width: 64, height: 96, borderRadius: 10, overflow: 'hidden' },
  hallDate: { color: colors.accentAlt, fontSize: 12, fontWeight: '800' },
  hallAuthor: { color: '#FFF', fontSize: 15, fontWeight: '800' },
  hallText: { color: colors.textMuted, fontSize: 13 },
  hallStats: { color: colors.textSubtle, fontSize: 11 },
});
