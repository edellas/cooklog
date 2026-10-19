import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Icon } from '../../src/components/Icon';
import { Press } from '../../src/components/Press';
import { Txt } from '../../src/components/Txt';
import { color, space } from '../../src/design/tokens';
import { CoverView } from '../../src/screens/CoverView';
import { getArchive } from '../../src/services/api';
import { useNav } from '../../src/state/nav';
import type { Cover } from '../../src/types';
import { friendlyError } from '../../src/services/errors';

/** Un numero arretrato. Se il giorno non esiste (link sbagliato, troppo vecchio) lo dice invece di girare a vuoto. */
export default function ArchivedCover() {
  const { day } = useLocalSearchParams<{ day: string }>();
  const nav = useNav();
  const [cover, setCover] = useState<Cover | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setCover(undefined);
    getArchive()
      .then((all) => alive && setCover(all.find((c) => c.featuredOn === day) ?? null))
      .catch((e: unknown) => alive && setError(friendlyError(e)));
    return () => {
      alive = false;
    };
  }, [day]);
  if (cover) return <CoverView cover={cover} isToday={false} reveal={false} />;
  return (
    <View style={styles.root}>
      {cover === undefined && !error ? (
        <ActivityIndicator color={color.giallo} />
      ) : (
        <>
          <Txt variant="title" style={{ textAlign: 'center' }}>
            {error ? 'Non riesco a caricare questa copertina.' : 'Copertina non trovata.'}
          </Txt>
          <Press style={styles.back} onPress={() => nav.dismissTo('/archivio')} accessibilityRole="button" accessibilityLabel="Torna all'Archivio">
            <Icon name="indietro" size={20} />
            <Txt variant="label">Archivio</Txt>
          </Press>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[4], padding: space[6], backgroundColor: color.canvas },
  back: { flexDirection: 'row', alignItems: 'center', gap: space[2], backgroundColor: color.raised, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
});
