import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Field } from '../../src/components/Field';
import { Icon } from '../../src/components/Icon';
import { Monogram } from '../../src/components/Monogram';
import { haptic, Press } from '../../src/components/Press';
import { Txt } from '../../src/components/Txt';
import { timeAgo } from '../../src/design/format';
import { color, font, space } from '../../src/design/tokens';
import { addComment, getComments } from '../../src/services/api';
import type { Comment } from '../../src/types';

/** Commenti in un foglio nativo (formSheet): si apre a metà, si trascina fino in cima, si chiude con un gesto. */
export default function CommentsSheet() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    void getComments(postId)
      .then(setItems)
      .catch(() => setItems([]));
  }, [postId]);

  const send = async () => {
    if (sending) return;
    try {
      setSending(true);
      setError(null);
      const c = await addComment(postId, text);
      haptic('light');
      setItems((prev) => [...(prev ?? []), c]);
      setText('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.head}>
        <Txt variant="title">{items ? `${items.length} ${items.length === 1 ? 'commento' : 'commenti'}` : 'Commenti'}</Txt>
      </View>
      {items === null ? (
        <ActivityIndicator color={color.giallo} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingHorizontal: space[5], paddingBottom: space[4], gap: space[5] }}
          ListEmptyComponent={
            <Txt variant="body" tone={color.paperFaint} style={{ textAlign: 'center', marginTop: space[8] }}>
              Ancora nessun commento. Scrivi il primo.
            </Txt>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Monogram name={item.author.displayName} seed={item.author.username} size={32} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="meta" tone={color.paperFaint}>
                  <Txt variant="meta" style={{ fontFamily: font.uiBold }}>
                    @{item.author.username}
                  </Txt>
                  {'  '}
                  {timeAgo(item.createdAt)}
                </Txt>
                <Txt variant="body">{item.body}</Txt>
              </View>
            </View>
          )}
        />
      )}
      {error ? (
        <Txt variant="small" tone={color.matita} style={{ paddingHorizontal: space[5] }}>
          {error}
        </Txt>
      ) : null}
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, space[3]) }]}>
        <Field
          containerStyle={{ flex: 1 }}
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Aggiungi un commento"
          maxLength={300}
          multiline
        />
        <Press
          style={[styles.send, !text.trim() && styles.sendOff]}
          onPress={() => void send()}
          disabled={!text.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel="Invia commento">
          <Icon name="invia" size={20} color={color.canvas} strokeWidth={2.4} />
        </Press>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.sheet },
  head: { paddingHorizontal: space[5], paddingTop: space[6], paddingBottom: space[4] },
  row: { flexDirection: 'row', gap: space[3] },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2], paddingHorizontal: space[4], paddingTop: space[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  input: { maxHeight: 120, paddingVertical: 11 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.giallo, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.4 },
});
