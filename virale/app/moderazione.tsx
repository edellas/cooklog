import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../src/components/Icon';
import { Monogram } from '../src/components/Monogram';
import { haptic, Press } from '../src/components/Press';
import { Thumb } from '../src/components/Thumb';
import { useToast } from '../src/components/Toast';
import { Txt } from '../src/components/Txt';
import { timeAgo } from '../src/design/format';
import { color, radius, space } from '../src/design/tokens';
import {
  getModQueue,
  getUserReports,
  isDemo,
  modResolve,
  modResolveUserReport,
  purgeStorage,
  REPORT_REASONS,
  type ModItem,
  type UserReportItem,
} from '../src/services/api';
import { friendlyError } from '../src/services/errors';
import { useSession } from '../src/state/session';
import { useGoBack } from '../src/state/useGoBack';

const label = (r: string) => REPORT_REASONS.find((x) => x.key === r)?.label ?? r;
type Action = 'dismiss' | 'remove' | 'ban';
type Tab = 'post' | 'altro';

/**
 * Coda delle segnalazioni per i moderatori, in due schede: i post e i commenti e profili.
 * Gli store chiedono di agire entro 24 ore: “Va bene” lascia tutto com'è (il post torna visibile e in gara),
 * “Rimuovi” toglie il contenuto (il profilo viene azzerato), “Espelli” rimuove e blocca l'autore per sempre.
 * L'autore riceve una notifica con il motivo.
 */
export default function Moderation() {
  const insets = useSafeAreaInsets();
  const goBack = useGoBack('/impostazioni');
  const toast = useToast();
  const { bump, status } = useSession();
  const [tab, setTab] = useState<Tab>('post');
  const [items, setItems] = useState<ModItem[] | null>(null);
  const [others, setOthers] = useState<UserReportItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** "Espelli" è definitivo: chiede un secondo tocco. */
  const [confirmBan, setConfirmBan] = useState<string | null>(null);

  const load = useCallback(() => {
    void getModQueue()
      .then(setItems)
      .catch((e: unknown) => setError(friendlyError(e)));
    void getUserReports()
      .then(setOthers)
      .catch((e: unknown) => setError(friendlyError(e)));
  }, []);
  useEffect(load, [load]);

  /** Dopo una rimozione i file spariscono subito (lo fa anche il lavoro programmato, entro un minuto). */
  const purge = () => {
    if (status?.isAdmin) void purgeStorage().catch(() => undefined);
  };

  const run = async (key: string, action: Action, fn: () => Promise<void>, done: string, after: () => void) => {
    if (busy) return;
    if (action === 'ban' && confirmBan !== key) {
      setConfirmBan(key);
      return;
    }
    try {
      setBusy(key);
      setConfirmBan(null);
      await fn();
      haptic('light');
      bump();
      after();
      if (action !== 'dismiss') purge();
      toast(done);
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const actPost = (item: ModItem, action: Action) =>
    void run(
      item.post.id,
      action,
      () => modResolve(item.post.id, action),
      action === 'dismiss' ? 'Post ripristinato.' : action === 'remove' ? 'Post rimosso.' : `@${item.post.author.username} espulso.`,
      () => setItems((list) => (list ?? []).filter((x) => x.post.id !== item.post.id)),
    );
  const actOther = (item: UserReportItem, action: Action) => {
    const who = item.user?.username ?? item.snapshot.username ?? '';
    void run(
      `${item.kind}:${item.target}`,
      action,
      () => modResolveUserReport(item.kind, item.target, action),
      action === 'dismiss'
        ? 'Segnalazione chiusa.'
        : action === 'ban'
          ? `@${who} espulso.`
          : item.kind === 'comment'
            ? 'Commento rimosso.'
            : 'Profilo azzerato.',
      () => setOthers((list) => (list ?? []).filter((x) => !(x.kind === item.kind && x.target === item.target))),
    );
  };

  const buttons = (key: string, onAct: (a: Action) => void) => (
    <View style={styles.actions}>
      <Press style={[styles.btn, styles.ok]} onPress={() => onAct('dismiss')} disabled={busy !== null} accessibilityRole="button">
        <Txt variant="meta" tone={color.canvas} style={styles.bold}>
          Va bene
        </Txt>
      </Press>
      <Press style={[styles.btn, styles.rm]} onPress={() => onAct('remove')} disabled={busy !== null} accessibilityRole="button">
        <Txt variant="meta" style={styles.bold}>
          Rimuovi
        </Txt>
      </Press>
      <Press style={[styles.btn, styles.ban, confirmBan === key && styles.banOn]} onPress={() => onAct('ban')} disabled={busy !== null} accessibilityRole="button">
        <Txt variant="meta" tone={confirmBan === key ? color.paper : color.matita} style={styles.bold}>
          {confirmBan === key ? 'Conferma: espelli per sempre' : 'Espelli'}
        </Txt>
      </Press>
    </View>
  );

  const reportLine = (reports: number, reasons: string[], firstAt: string, extra = '') => (
    <>
      <Txt variant="meta" tone={color.matita}>
        {reports} {reports === 1 ? 'segnalazione' : 'segnalazioni'} · {reasons.map(label).join(', ')}
      </Txt>
      <Txt variant="meta" tone={color.paperFaint}>
        Prima segnalazione {timeAgo(firstAt) === 'ora' ? 'adesso' : `${timeAgo(firstAt)} fa`}
        {extra}
      </Txt>
    </>
  );

  const empty = (
    <View style={{ alignItems: 'center', gap: space[2], marginTop: space[10] }}>
      <Icon name="check" size={32} color={color.verde} />
      <Txt variant="title">Nessuna segnalazione aperta</Txt>
    </View>
  );
  const demoNote = isDemo ? (
    <Txt variant="small" tone={color.paperFaint} style={{ marginBottom: space[2] }}>
      Demo: qui compaiono le segnalazioni che hai fatto tu. In produzione vedi quelle di tutti.
    </Txt>
  ) : null;
  const listStyle = { padding: space[4], paddingBottom: insets.bottom + space[8], gap: space[4] };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Press style={styles.round} onPress={goBack} accessibilityRole="button" accessibilityLabel="Indietro">
          <Icon name="indietro" />
        </Press>
        <Txt variant="title">Moderazione</Txt>
        <View style={{ width: 40 }} />
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(
          [
            ['post', 'Post', items?.length],
            ['altro', 'Commenti e profili', others?.length],
          ] as const
        ).map(([k, text, n]) => (
          <Press key={k} style={[styles.tab, tab === k && styles.tabOn]} scaleTo={1} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }}>
            <Txt variant="label" tone={tab === k ? color.paper : color.paperFaint}>
              {n ? `${text} ${n}` : text}
            </Txt>
          </Press>
        ))}
      </View>
      {error ? (
        <Txt variant="body" style={{ padding: space[5] }}>
          {error}
        </Txt>
      ) : tab === 'post' ? (
        items === null ? (
          <ActivityIndicator color={color.giallo} style={{ marginTop: 60 }} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(i) => i.post.id}
            contentContainerStyle={listStyle}
            ListHeaderComponent={demoNote}
            ListEmptyComponent={empty}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.thumb}>
                  <Thumb media={item.post.media} rounded={10} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Txt variant="label">@{item.post.author.username}</Txt>
                  <Txt variant="small" tone={color.paperDim} numberOfLines={2}>
                    {item.post.caption || 'Senza didascalia'}
                  </Txt>
                  {reportLine(item.reports, item.reasons, item.firstAt, item.hidden ? ' · già nascosto' : '')}
                  {buttons(item.post.id, (a) => actPost(item, a))}
                </View>
              </View>
            )}
          />
        )
      ) : others === null ? (
        <ActivityIndicator color={color.giallo} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={others}
          keyExtractor={(i) => `${i.kind}:${i.target}`}
          contentContainerStyle={listStyle}
          ListHeaderComponent={demoNote}
          ListEmptyComponent={empty}
          renderItem={({ item }) => {
            const who = item.user?.username ?? item.snapshot.username ?? '?';
            const key = `${item.kind}:${item.target}`;
            return (
              <View style={[styles.card, { flexDirection: 'column' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                  <Monogram name={item.user?.displayName ?? who} seed={who} size={36} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="label">{item.kind === 'comment' ? `Commento di @${who}` : `Profilo di @${who}`}</Txt>
                    {item.user ? (
                      <Txt variant="meta" tone={color.paperFaint} numberOfLines={1}>
                        {item.user.displayName}
                      </Txt>
                    ) : null}
                  </View>
                </View>
                {item.kind === 'comment' ? (
                  <Txt variant="body" tone={color.paper}>
                    “{item.comment?.body ?? item.snapshot.body ?? ''}”
                  </Txt>
                ) : (
                  <View style={{ gap: 2 }}>
                    <Txt variant="small" tone={color.paperDim}>
                      Bio: {item.user?.bio || 'vuota'}
                    </Txt>
                    {item.snapshot.display_name && item.snapshot.display_name !== item.user?.displayName ? (
                      <Txt variant="meta" tone={color.paperFaint}>
                        Al momento della segnalazione si chiamava “{item.snapshot.display_name}”.
                      </Txt>
                    ) : null}
                  </View>
                )}
                {reportLine(item.reports, item.reasons, item.firstAt)}
                {buttons(key, (a) => actOther(item, a))}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], paddingVertical: space[2] },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', gap: space[2], paddingHorizontal: space[4], paddingBottom: space[2] },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, minHeight: 40, justifyContent: 'center' },
  tabOn: { backgroundColor: color.raised },
  card: { flexDirection: 'row', gap: space[3], backgroundColor: color.raised, borderRadius: radius.card, padding: space[3] },
  thumb: { width: 84, height: 126 },
  actions: { flexDirection: 'row', gap: space[4], rowGap: space[2], marginTop: space[2], flexWrap: 'wrap' },
  btn: { borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 10 },
  ok: { backgroundColor: color.verde },
  rm: { backgroundColor: color.line },
  ban: { borderWidth: 1, borderColor: color.matita },
  banOn: { backgroundColor: color.matita },
  bold: { fontFamily: 'SchibstedGrotesk_700Bold' },
});
