import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { haptic } from '../../src/components/Press';
import { useToast } from '../../src/components/Toast';
import { Txt } from '../../src/components/Txt';
import { color } from '../../src/design/tokens';
import { arenaDay } from '../../src/engine/engine';
import { CoverView } from '../../src/screens/CoverView';
import { closeDayNowDemo, getTodayCover, isDemo } from '../../src/services/api';
import { getJson, setJson } from '../../src/services/storage';
import { useSession } from '../../src/state/session';
import type { Cover } from '../../src/types';

const SEEN_KEY = 'virale.cover.seen';

export default function CoverTab() {
  const { version, bump } = useSession();
  const toast = useToast();
  const [cover, setCover] = useState<Cover | null | undefined>(undefined);
  const [reveal, setReveal] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void version; // ricarica quando altrove cambia qualcosa (nuovo post, nuova copertina)
      let alive = true;
      void (async () => {
        const next = await getTodayCover().catch(() => null);
        const today = arenaDay();
        const seen = await getJson<string>(SEEN_KEY, '');
        if (!alive) return;
        setReveal(Boolean(next) && seen !== today);
        setCover(next);
        if (next && seen !== today) void setJson(SEEN_KEY, today);
      })();
      return () => {
        alive = false;
      };
    }, [version]),
  );

  const simulate = async () => {
    const next = await closeDayNowDemo();
    haptic('success');
    setReveal(true);
    setCover(next);
    bump();
    toast(next ? `Nuova copertina: @${next.post.author.username}` : 'Nessun post idoneo oggi.');
  };

  if (cover === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color.giallo} />
      </View>
    );
  }
  if (!cover) {
    return (
      <View style={styles.center}>
        <Txt variant="heading" style={{ textAlign: 'center' }}>
          Ancora nessuna copertina.
        </Txt>
        <Txt variant="body" tone={color.paperDim} style={{ textAlign: 'center' }}>
          La prima esce domattina: pubblica un post e candidalo.
        </Txt>
      </View>
    );
  }
  return <CoverView key={`${cover.featuredOn}-${cover.post.id}`} cover={cover} isToday reveal={reveal} onSimulateMidnight={isDemo ? () => void simulate() : undefined} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32, backgroundColor: color.canvas },
});
