import * as Linking from 'expo-linking';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '../src/components/Icon';
import { Monogram } from '../src/components/Monogram';
import { haptic, Press } from '../src/components/Press';
import { useToast } from '../src/components/Toast';
import { Txt } from '../src/components/Txt';
import { color, radius, space } from '../src/design/tokens';
import { DOCS, OWNER, type DocSlug } from '../src/legal/docs';
import { deleteAccount, getProfile, isDemo, listBlocked, unblockUser } from '../src/services/api';
import { useSession } from '../src/state/session';
import type { Author } from '../src/types';

export default function Settings() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { me, setMe, bump } = useSession();
  const [blocked, setBlocked] = useState<Author[] | null>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void listBlocked()
        .then(setBlocked)
        .catch(() => setBlocked([]));
      if (me) void getProfile(me.username).then((d) => setIsModerator(d.profile.isModerator)).catch(() => undefined);
    }, [me]),
  );

  const unblock = async (a: Author) => {
    await unblockUser(a.id);
    setBlocked((list) => (list ?? []).filter((x) => x.id !== a.id));
    bump();
    toast(`@${a.username} sbloccato.`);
  };

  const remove = async () => {
    if (!confirm) return setConfirm(true);
    try {
      setDeleting(true);
      setError(null);
      await deleteAccount();
      haptic('success');
      setMe(null);
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Press style={styles.round} onPress={() => router.back()} accessibilityLabel="Indietro">
          <Icon name="indietro" />
        </Press>
        <Txt variant="title">Impostazioni</Txt>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: insets.bottom + space[10], gap: space[8] }}>
        {isModerator ? (
          <Section title="Moderazione">
            <Row icon="scudo" label="Segnalazioni da rivedere" hint="Rispondi entro 24 ore: è un requisito degli store." onPress={() => router.push('/moderazione' as Href)} />
          </Section>
        ) : null}

        <Section title="Utenti bloccati">
          {blocked === null ? (
            <ActivityIndicator color={color.giallo} />
          ) : blocked.length ? (
            blocked.map((a) => (
              <View key={a.id} style={styles.blockedRow}>
                <Monogram name={a.displayName} seed={a.username} size={32} />
                <Txt variant="label" style={{ flex: 1 }}>
                  @{a.username}
                </Txt>
                <Press style={styles.pill} onPress={() => void unblock(a)} accessibilityRole="button">
                  <Txt variant="meta">Sblocca</Txt>
                </Press>
              </View>
            ))
          ) : (
            <Txt variant="small" tone={color.paperFaint}>
              Nessuno. Puoi bloccare qualcuno dai tre puntini sotto un suo post o dal suo profilo.
            </Txt>
          )}
        </Section>

        <Section title="Regole e privacy">
          {(['linee-guida', 'termini', 'privacy'] as DocSlug[]).map((slug) => (
            <Row key={slug} icon="documento" label={DOCS[slug].title} onPress={() => router.push(`/legale/${slug}` as Href)} />
          ))}
          <Row icon="info" label="Come si diventa copertina" onPress={() => router.push('/regole' as Href)} />
        </Section>

        <Section title="Aiuto">
          <Row icon="posta" label="Scrivici" hint={OWNER.email} onPress={() => void Linking.openURL(`mailto:${OWNER.email}?subject=Virale`).catch(() => undefined)} />
        </Section>

        <Section title="Account">
          <Txt variant="small" tone={color.paperDim}>
            Sei @{me?.username}. Eliminando l’account cancelli profilo, post, commenti, mi piace, salvati, follow e partecipazioni alla gara. Non si può annullare.
          </Txt>
          <Press style={[styles.delete, confirm && styles.deleteConfirm]} onPress={() => void remove()} disabled={deleting} accessibilityRole="button">
            {deleting ? (
              <ActivityIndicator color={color.paper} />
            ) : (
              <Txt variant="label" tone={confirm ? color.paper : color.matita}>
                {confirm ? 'Tocca di nuovo per eliminare per sempre' : isDemo ? 'Elimina account (cancella la demo)' : 'Elimina account'}
              </Txt>
            )}
          </Press>
          {error ? (
            <Txt variant="small" tone={color.matita}>
              {error}
            </Txt>
          ) : null}
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space[3] }}>
      <Txt variant="title">{title}</Txt>
      {children}
    </View>
  );
}

function Row({ icon, label, hint, onPress }: { icon: IconName; label: string; hint?: string; onPress: () => void }) {
  return (
    <Press style={styles.row} onPress={onPress} accessibilityRole="button">
      <Icon name={icon} size={22} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="label">{label}</Txt>
        {hint ? (
          <Txt variant="small" tone={color.paperFaint}>
            {hint}
          </Txt>
        ) : null}
      </View>
      <Icon name="destra" size={20} color={color.paperFaint} />
    </Press>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], paddingVertical: space[2] },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[4], backgroundColor: color.raised, borderRadius: radius.control, padding: space[4], minHeight: 56 },
  blockedRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  pill: { borderWidth: 1, borderColor: color.paper, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 6 },
  delete: { borderWidth: 1.5, borderColor: color.matita, borderRadius: radius.control, paddingVertical: 15, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  deleteConfirm: { backgroundColor: color.matita },
});
