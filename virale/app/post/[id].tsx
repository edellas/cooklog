import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../src/components/Icon';
import { PostCard } from '../../src/components/PostCard';
import { Press } from '../../src/components/Press';
import { Txt } from '../../src/components/Txt';
import { color, space } from '../../src/design/tokens';
import { getPost } from '../../src/services/api';
import { useSession } from '../../src/state/session';
import type { Post } from '../../src/types';

export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { me } = useSession();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    void getPost(id)
      .then(setPost)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.bar}>
        <Press style={styles.back} onPress={() => router.back()} accessibilityLabel="Indietro">
          <Icon name="indietro" />
        </Press>
      </View>
      {post ? (
        <PostCard post={post} active muted={muted} onToggleMute={() => setMuted((m) => !m)} meId={me?.id} />
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
