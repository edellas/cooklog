import { CooklogColors, CooklogRadii } from '@/constants/cooklogTheme';
import { EmptyState } from '@/src/components/EmptyState';
import { ErrorState } from '@/src/components/ErrorState';
import { addComment, deleteComment, getComments } from '@/src/services/commentService';
import { useAuth } from '@/src/providers/AuthProvider';
import type { Comment } from '@/src/types';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export function CommentsScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { user, profile } = useAuth();
  const [items, setItems] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!postId) return;
    void getComments(postId)
      .then(setItems)
      .catch(() => setError('Impossibile caricare i commenti.'));
  }, [postId]);

  const onSend = async () => {
    if (!user || !postId || !text.trim()) return;
    try {
      const next = await addComment({
        postId,
        userId: user.id,
        body: text.trim(),
        authorName: profile?.displayName ?? 'Utente',
        authorAvatarUrl: profile?.avatarUrl ?? null,
      });
      setItems((prev) => [...prev, next]);
      setText('');
    } catch {
      setError('Invio commento non riuscito.');
    }
  };

  const onDelete = async (comment: Comment) => {
    if (!user || !postId) return;
    await deleteComment(postId, comment.id, user.id);
    setItems((prev) => prev.filter((c) => c.id !== comment.id));
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Commenti</Text>
      {error ? <ErrorState message={error} /> : null}
      {!items.length ? (
        <EmptyState title="Ancora nessun commento." />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.comment}>
              <Text style={styles.author}>{item.authorName}</Text>
              <Text style={styles.body}>{item.body}</Text>
              <Text style={styles.date}>{new Date(item.createdAt).toLocaleString('it-IT')}</Text>
              {item.userId === user?.id ? (
                <Pressable onPress={() => void onDelete(item)}>
                  <Text style={styles.delete}>Elimina</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        />
      )}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Scrivi un commento"
          placeholderTextColor={CooklogColors.textSubtle}
        />
        <Pressable onPress={() => void onSend()} style={styles.send}>
          <Text style={styles.sendLabel}>Invia</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: CooklogColors.background, padding: 16 },
  title: { fontSize: 26, fontWeight: '700', color: CooklogColors.text, marginBottom: 10 },
  comment: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CooklogColors.border,
    backgroundColor: CooklogColors.surface,
    padding: 12,
    marginBottom: 10,
    gap: 4,
  },
  author: { color: CooklogColors.text, fontWeight: '700' },
  body: { color: CooklogColors.text },
  date: { color: CooklogColors.textSubtle, fontSize: 12 },
  delete: { color: CooklogColors.danger, fontWeight: '600', marginTop: 4 },
  inputRow: { flexDirection: 'row', gap: 8, paddingTop: 8 },
  input: {
    flex: 1,
    borderRadius: CooklogRadii.input,
    borderWidth: 1,
    borderColor: CooklogColors.border,
    backgroundColor: CooklogColors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  send: {
    borderRadius: 10,
    backgroundColor: CooklogColors.primary,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendLabel: { color: '#fff', fontWeight: '700' },
});
