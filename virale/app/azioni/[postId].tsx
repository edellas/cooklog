import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '../../src/components/Icon';
import { SheetClose } from '../../src/components/SheetClose';
import { haptic, Press } from '../../src/components/Press';
import { useToast } from '../../src/components/Toast';
import { Txt } from '../../src/components/Txt';
import { color, radius, space } from '../../src/design/tokens';
import { blockUser, deletePost, getPost, REPORT_REASONS, reportPost, type ReportReason } from '../../src/services/api';
import { emitPostGone } from '../../src/state/postEvents';
import { useSession } from '../../src/state/session';
import { useGoBack } from '../../src/state/useGoBack';
import type { Post } from '../../src/types';

type Step = 'menu' | 'segnala' | 'blocca' | 'elimina';

/**
 * Le azioni su un post, in un foglio nativo: segnala (con il motivo), blocca l'autore,
 * oppure elimina il proprio post. Sono i controlli che App Store e Google Play chiedono
 * alle app con contenuti pubblicati dagli utenti.
 */
export default function PostActions() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const insets = useSafeAreaInsets();
  const goBack = useGoBack();
  const toast = useToast();
  const { me, bump } = useSession();
  const [post, setPost] = useState<Post | null>(null);
  const [step, setStep] = useState<Step>('menu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getPost(postId)
      .then(setPost)
      .catch((e: Error) => setError(e.message));
  }, [postId]);

  const run = async (fn: () => Promise<void>, done: string, gone: Parameters<typeof emitPostGone>[0]) => {
    try {
      setBusy(true);
      setError(null);
      await fn();
      haptic('success');
      emitPostGone(gone);
      bump();
      goBack();
      toast(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!post) {
    return (
      <View style={[styles.root, styles.center]}>
        {error ? <Txt variant="body">{error}</Txt> : <ActivityIndicator color={color.giallo} />}
      </View>
    );
  }

  const mine = post.author.id === me?.id;
  const who = `@${post.author.username}`;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: space[5], paddingTop: space[6], paddingBottom: insets.bottom + space[6], gap: space[3] }}>
      <SheetClose />
      {step === 'menu' ? (
        <>
          <Txt variant="title" style={{ marginBottom: space[2] }}>
            {mine ? 'Il tuo post' : `Post di ${who}`}
          </Txt>
          {mine ? (
            <Row icon="cestino" label="Elimina post" hint="Sparisce dal tuo profilo, dai feed e dalla gara." danger onPress={() => setStep('elimina')} />
          ) : (
            <>
              <Row icon="segnala" label="Segnala post" hint="Per te sparisce subito. Lo controlliamo entro 24 ore." danger onPress={() => setStep('segnala')} />
              <Row icon="blocca" label={`Blocca ${who}`} hint="Non vedrete più i contenuti l’uno dell’altro." onPress={() => setStep('blocca')} />
            </>
          )}
        </>
      ) : null}

      {step === 'segnala' ? (
        <>
          <Txt variant="title">Perché lo segnali?</Txt>
          <Txt variant="small" tone={color.paperDim} style={{ marginBottom: space[2] }}>
            {who} non saprà chi l’ha segnalato.
          </Txt>
          {REPORT_REASONS.map((r) => (
            <Row
              key={r.key}
              label={r.label}
              onPress={() => void run(() => reportPost(post.id, r.key as ReportReason), 'Grazie: post segnalato. Non lo vedrai più.', { postId: post.id })}
              disabled={busy}
            />
          ))}
        </>
      ) : null}

      {step === 'blocca' ? (
        <Confirm
          title={`Bloccare ${who}?`}
          text="Non vedrete più post, commenti e profilo l’uno dell’altro, e smetterete di seguirvi. Puoi sbloccare quando vuoi dalle Impostazioni."
          action="Blocca"
          busy={busy}
          onConfirm={() => void run(() => blockUser(post.author.id), `${who} è bloccato.`, { authorId: post.author.id })}
          onCancel={() => setStep('menu')}
        />
      ) : null}

      {step === 'elimina' ? (
        <Confirm
          title="Eliminare questo post?"
          text="Lo elimini per sempre, con i suoi commenti e il suo posto nella gara di oggi."
          action="Elimina"
          busy={busy}
          onConfirm={() => void run(() => deletePost(post.id), 'Post eliminato.', { postId: post.id })}
          onCancel={() => setStep('menu')}
        />
      ) : null}

      {error ? (
        <Txt variant="small" tone={color.matita}>
          {error}
        </Txt>
      ) : null}
    </ScrollView>
  );
}

function Row({ icon, label, hint, danger, onPress, disabled }: { icon?: IconName; label: string; hint?: string; danger?: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Press style={styles.row} onPress={onPress} disabled={disabled} accessibilityRole="button">
      {icon ? <Icon name={icon} size={22} color={danger ? color.matita : color.paper} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="label" tone={danger ? color.matita : color.paper}>
          {label}
        </Txt>
        {hint ? (
          <Txt variant="small" tone={color.paperFaint}>
            {hint}
          </Txt>
        ) : null}
      </View>
    </Press>
  );
}

function Confirm({ title, text, action, busy, onConfirm, onCancel }: { title: string; text: string; action: string; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <View style={{ gap: space[3] }}>
      <Txt variant="title">{title}</Txt>
      <Txt variant="body" tone={color.paperDim}>
        {text}
      </Txt>
      <Press style={[styles.button, styles.danger]} onPress={onConfirm} disabled={busy} accessibilityRole="button">
        {busy ? <ActivityIndicator color={color.paper} /> : <Txt variant="label">{action}</Txt>}
      </Press>
      <Press style={[styles.button, styles.ghost]} onPress={onCancel} disabled={busy} accessibilityRole="button">
        <Txt variant="label">Annulla</Txt>
      </Press>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.sheet },
  center: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[4], backgroundColor: color.raised, borderRadius: radius.control, padding: space[4], minHeight: 56 },
  button: { borderRadius: radius.control, paddingVertical: 15, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  danger: { backgroundColor: color.matita },
  ghost: { backgroundColor: color.raised },
});
