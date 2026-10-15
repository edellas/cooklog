import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Field } from '../../src/components/Field';
import { Icon } from '../../src/components/Icon';
import { Monogram } from '../../src/components/Monogram';
import { haptic, Press } from '../../src/components/Press';
import { Txt } from '../../src/components/Txt';
import { timeAgo } from '../../src/design/format';
import { color, font, space } from '../../src/design/tokens';
import { addComment, deleteComment, getComments, getPost } from '../../src/services/api';
import { emitPostChange } from '../../src/state/postEvents';
import { useSession } from '../../src/state/session';
import { useGoBack } from '../../src/state/useGoBack';
import type { Comment } from '../../src/types';

/** Commenti in un foglio nativo (formSheet): si apre a metà, si trascina fino in cima, si chiude con un gesto. */
export default function CommentsSheet() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useGoBack();
  const { me } = useSession();
  const [items, setItems] = useState<Comment[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  /** Commento proprio in attesa di conferma per l'eliminazione (secondo tocco). */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }, []);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    getComments(postId)
      .then(setItems)
      .catch(() => setLoadError(true));
  }, [postId]);

  const send = async () => {
    if (sending) return;
    try {
      setSending(true);
      setError(null);
      const c = await addComment(postId, text);
      haptic('light');
      const next = [...(items ?? []), c];
      setItems(next);
      setText('');
      // Il conteggio sotto il post si aggiorna con il numero vero (l'elenco qui può essere filtrato o troncato).
      syncCount(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const syncCount = (commented: boolean) => {
    getPost(postId)
      .then((p) => emitPostChange(postId, { commentCount: p.commentCount, commented }))
      .catch(() => undefined);
  };

  const remove = async (c: Comment) => {
    if (confirmId !== c.id) {
      setConfirmId(c.id);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmId(null), 4000);
      return;
    }
    try {
      setConfirmId(null);
      await deleteComment(postId, c.id);
      const next = (items ?? []).filter((x) => x.id !== c.id);
      setItems(next);
      syncCount(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    // Su Android il foglio si sposta già da solo sopra la tastiera: lì niente padding in più.
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.head}>
        <Txt variant="title">{items ? `${items.length} ${items.length === 1 ? 'commento' : 'commenti'}` : 'Commenti'}</Txt>
        {Platform.OS === 'web' ? (
          <Press style={styles.close} onPress={goBack} accessibilityRole="button" accessibilityLabel="Chiudi">
            <Icon name="chiudi" size={20} />
          </Press>
        ) : null}
      </View>
      {loadError && items === null ? (
        <Txt variant="body" tone={color.paperFaint} style={{ textAlign: 'center', marginTop: space[8], paddingHorizontal: space[5] }}>
          Non riesco a caricare i commenti. Controlla la connessione e riaprili.
        </Txt>
      ) : items === null ? (
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
          renderItem={({ item }) => {
            const mine = item.author.id === me?.id;
            return (
              <View style={styles.row}>
                {/* Toccando l'autore si apre il suo profilo: da lì lo si può bloccare. */}
                <Press
                  onPress={() => router.push(`/utente/${item.author.username}` as Href)}
                  accessibilityRole="link"
                  accessibilityLabel={`Profilo di @${item.author.username}`}
                  hitSlop={6}>
                  <Monogram name={item.author.displayName} seed={item.author.username} size={32} />
                </Press>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="meta" tone={color.paperFaint}>
                    <Txt variant="meta" style={{ fontFamily: font.uiBold }} onPress={() => router.push(`/utente/${item.author.username}` as Href)}>
                      @{item.author.username}
                    </Txt>
                    {'  '}
                    {timeAgo(item.createdAt)}
                  </Txt>
                  <Txt variant="body">{item.body}</Txt>
                  {mine ? (
                    <Press onPress={() => void remove(item)} accessibilityRole="button" style={styles.del} hitSlop={8}>
                      <Txt variant="meta" tone={confirmId === item.id ? color.matita : color.paperFaint}>
                        {confirmId === item.id ? 'Tocca di nuovo per eliminare' : 'Elimina'}
                      </Txt>
                    </Press>
                  ) : null}
                </View>
              </View>
            );
          }}
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
          accessibilityLabel="Scrivi un commento"
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
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[5], paddingTop: space[6], paddingBottom: space[4] },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
  del: { alignSelf: 'flex-start', marginTop: 2 },
  row: { flexDirection: 'row', gap: space[3] },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2], paddingHorizontal: space[4], paddingTop: space[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  input: { maxHeight: 120, paddingVertical: 11 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.giallo, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.4 },
});
