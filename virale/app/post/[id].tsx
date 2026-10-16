import { useIsFocused } from '@react-navigation/native';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../src/components/Icon';
import { PostCard } from '../../src/components/PostCard';
import { Press } from '../../src/components/Press';
import { Txt } from '../../src/components/Txt';
import { color, space } from '../../src/design/tokens';
import { getPost } from '../../src/services/api';
import { useSession } from '../../src/state/session';
import { useGoBack } from '../../src/state/useGoBack';
import { queueView } from '../../src/state/views';
import type { Post } from '../../src/types';

export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const goBack = useGoBack();
  const focused = useIsFocused();
  const { me, version } = useSession();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  // Si ricarica quando qualcosa cambia altrove: se il post è stato eliminato, segnalato o il suo autore
  // bloccato, non resta aperto su qualcosa che non esiste più.
  useEffect(() => {
    let alive = true;
    getPost(id)
      .then((p) => {
        if (!alive) return;
        loaded.current = true;
        setPost(p);
        queueView(p.id);
      })
      .catch((e: Error) => {
        if (!alive) return;
        // Se il post non c'è più si torna indietro; un errore di rete invece lascia il post com'era.
        if (loaded.current) {
          if (/non trovato|non più disponibile/i.test(e.message)) goBack();
        } else setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [id, version, goBack]);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.bar}>
        <Press style={styles.back} onPress={goBack} accessibilityRole="button" accessibilityLabel="Indietro">
          <Icon name="indietro" />
        </Press>
      </View>
      {post ? (
        <PostCard post={post} active={focused} meId={me?.id} />
      ) : error ? (
        <Txt variant="title" style={{ textAlign: 'center', marginTop: 80 }}>
          {error}
        </Txt>
      ) : (
        <ActivityIndicator color={color.giallo} style={{ marginTop: 80 }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  bar: { paddingHorizontal: space[4], paddingVertical: space[1] },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
});
