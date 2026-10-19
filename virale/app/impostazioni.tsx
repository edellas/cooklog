import * as Linking from 'expo-linking';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '../src/components/Icon';
import { Avatar } from '../src/components/Avatar';
import { haptic, Press } from '../src/components/Press';
import { useToast } from '../src/components/Toast';
import { Txt } from '../src/components/Txt';
import { color, radius, space } from '../src/design/tokens';
import { DOCS, ownerEmail, type DocSlug } from '../src/legal/docs';
import {
  changePassword,
  createRecoveryCode,
  deleteAccount,
  getPushPrefs,
  isDemo,
  listBlocked,
  logout,
  PASSWORD_MIN,
  setPassword,
  setPushPrefs,
  unblockUser,
  type PushPrefs,
} from '../src/services/api';
import { openPushSettings, pushMissingReason, pushPermission, registerPush, type PushState } from '../src/services/push';
import { RecoveryCodeCard } from '../src/components/RecoveryCode';
import { flushViews } from '../src/state/views';
import { Field } from '../src/components/Field';
import { useSession } from '../src/state/session';
import { useGoBack } from '../src/state/useGoBack';
import type { Author } from '../src/types';
import { friendlyError } from '../src/services/errors';
import { useNav } from '../src/state/nav';

export default function Settings() {
  const insets = useSafeAreaInsets();
  const nav = useNav();
  const goBack = useGoBack('/profilo');
  const toast = useToast();
  const { me, setMe, bump, status } = useSession();
  const [blocked, setBlocked] = useState<Author[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unblocking, setUnblocking] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void listBlocked()
        .then(setBlocked)
        .catch(() => setBlocked([]));
    }, []),
  );

  const unblock = async (a: Author) => {
    if (unblocking) return;
    try {
      setUnblocking(a.id);
      await unblockUser(a.id);
      setBlocked((list) => (list ?? []).filter((x) => x.id !== a.id));
      bump();
      toast(`@${a.username} sbloccato.`);
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setUnblocking(null);
    }
  };

  const exit = async () => {
    try {
      await flushViews();
      await logout();
      setMe(null);
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  const remove = async () => {
    if (!confirm) {
      setConfirm(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setConfirm(false), 4000);
      return;
    }
    try {
      setDeleting(true);
      setError(null);
      await deleteAccount();
      haptic('success');
      setMe(null);
    } catch (e) {
      setError(friendlyError(e));
      setDeleting(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Press style={styles.round} onPress={goBack} accessibilityRole="button" accessibilityLabel="Indietro">
          <Icon name="indietro" />
        </Press>
        <Txt variant="title">Impostazioni</Txt>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: insets.bottom + space[10], gap: space[8] }}>
        {status?.isAdmin || status?.isModerator ? (
          <Section title={status.isAdmin ? 'Amministrazione' : 'Moderazione'}>
            {status.isAdmin ? (
              <Row icon="impostazioni" label="Copertina e documenti" hint="Orario della copertina, verifica dell’età." onPress={() => nav.push('/amministrazione')} />
            ) : null}
            <Row icon="scudo" label="Segnalazioni da rivedere" hint="Rispondi entro 24 ore: è un requisito degli store." onPress={() => nav.push('/moderazione')} />
          </Section>
        ) : null}

        <Section title="Il tuo account">
          <Row
            icon="documento"
            label="Verifica dell’età"
            hint={
              status?.identity?.status === 'approved'
                ? 'Verificata.'
                : status?.identity?.status === 'pending'
                  ? 'Documento in controllo.'
                  : status?.identity?.canAct === false
                    ? 'Scaduta: carica il documento per tornare a pubblicare.'
                    : 'Da fare: carica il documento d’identità.'
            }
            onPress={() => nav.push('/verifica')}
          />
          {status?.needsPassword ? (
            <PasswordSet />
          ) : (
            <>
              <PasswordChange />
              <RecoveryCode />
              <Press style={styles.row} onPress={() => void exit()} accessibilityRole="button">
                <Icon name="esci" size={22} />
                <Txt variant="label" style={{ flex: 1 }}>
                  Esci
                </Txt>
              </Press>
            </>
          )}
        </Section>

        <Section title="Notifiche">
          <NotificationSettings />
        </Section>

        <Section title="Utenti bloccati">
          {blocked === null ? (
            <ActivityIndicator color={color.giallo} />
          ) : blocked.length ? (
            blocked.map((a) => (
              <View key={a.id} style={styles.blockedRow}>
                <Avatar name={a.displayName} seed={a.username} uri={a.avatar} size={32} />
                <Txt variant="label" style={{ flex: 1 }}>
                  @{a.username}
                </Txt>
                <Press style={styles.pill} onPress={() => void unblock(a)} disabled={unblocking !== null} accessibilityRole="button" accessibilityLabel={`Sblocca @${a.username}`}>
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
            <Row key={slug} icon="documento" label={DOCS[slug].title} onPress={() => nav.push(`/legale/${slug}`)} />
          ))}
          <Row icon="info" label="Come si diventa copertina" onPress={() => nav.push('/regole')} />
        </Section>

        {ownerEmail() ? (
          <Section title="Aiuto">
            <Row icon="posta" label="Scrivici" hint={ownerEmail() ?? ''} onPress={() => void Linking.openURL(`mailto:${ownerEmail()}?subject=Virale`).catch(() => undefined)} />
          </Section>
        ) : null}

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

/**
 * Per gli account creati prima delle password: finché non ne imposti una, uscire significherebbe
 * perdere l'account. Per questo "Esci" compare solo dopo.
 */
function PasswordSet() {
  const toast = useToast();
  const { refreshStatus } = useSession();
  const [first, setFirst] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (first !== again) return setError('Le due password non coincidono.');
    try {
      setBusy(true);
      setError(null);
      await setPassword(first);
      await refreshStatus();
      toast('Password impostata: ora puoi uscire e rientrare con nome utente e password.');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[styles.row, styles.warnBox, { flexDirection: 'column', alignItems: 'stretch', gap: space[3] }]}>
      <Txt variant="label">Imposta una password</Txt>
      <Txt variant="small" tone={color.paperDim}>
        Il tuo account è stato creato prima delle password: impostane una per poter uscire e rientrare. Senza, uscendo perderesti l’account.
      </Txt>
      <Field value={first} onChangeText={setFirst} placeholder="Nuova password" secureTextEntry autoCapitalize="none" accessibilityLabel="Nuova password" maxLength={72} />
      <Field value={again} onChangeText={setAgain} placeholder="Ripeti la password" secureTextEntry autoCapitalize="none" accessibilityLabel="Ripeti la nuova password" maxLength={72} />
      <Txt variant="meta" tone={color.paperFaint}>
        Almeno {PASSWORD_MIN} caratteri, con lettere e numeri.
      </Txt>
      {error ? (
        <Txt variant="small" tone={color.matita}>
          {error}
        </Txt>
      ) : null}
      <Press style={[styles.pill, { backgroundColor: color.giallo, borderColor: color.giallo, alignSelf: 'flex-start' }]} onPress={() => void save()} disabled={busy || !first || !again} accessibilityRole="button">
        <Txt variant="meta" tone={color.canvas}>
          {busy ? 'Salvo…' : 'Imposta password'}
        </Txt>
      </Press>
    </View>
  );
}

function PasswordChange() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <Press style={styles.row} onPress={() => setOpen(true)} accessibilityRole="button">
        <Icon name="chiave" size={22} />
        <Txt variant="label" style={{ flex: 1 }}>
          Cambia password
        </Txt>
        <Icon name="destra" size={20} color={color.paperFaint} />
      </Press>
    );
  }
  const save = async () => {
    if (next !== again) return setError('Le due password nuove non coincidono.');
    try {
      setBusy(true);
      setError(null);
      await changePassword(current, next);
      toast('Password cambiata.');
      setOpen(false);
      setCurrent('');
      setNext('');
      setAgain('');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch', gap: space[3] }]}>
      <Txt variant="label">Cambia password</Txt>
      <Field value={current} onChangeText={setCurrent} placeholder="Password attuale" secureTextEntry autoCapitalize="none" accessibilityLabel="Password attuale" maxLength={72} />
      <Field value={next} onChangeText={setNext} placeholder={`Nuova password (almeno ${PASSWORD_MIN} caratteri)`} secureTextEntry autoCapitalize="none" accessibilityLabel="Nuova password" maxLength={72} />
      <Field value={again} onChangeText={setAgain} placeholder="Ripeti la nuova password" secureTextEntry autoCapitalize="none" accessibilityLabel="Ripeti la nuova password" maxLength={72} />
      {error ? (
        <Txt variant="small" tone={color.matita}>
          {error}
        </Txt>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        <Press style={[styles.pill, { backgroundColor: color.giallo, borderColor: color.giallo }]} onPress={() => void save()} disabled={busy || !current || !next || !again} accessibilityRole="button">
          <Txt variant="meta" tone={color.canvas}>
            {busy ? 'Salvo…' : 'Salva'}
          </Txt>
        </Press>
        <Press style={styles.pill} onPress={() => setOpen(false)} accessibilityRole="button">
          <Txt variant="meta">Annulla</Txt>
        </Press>
      </View>
    </View>
  );
}

/** Codice di recupero nuovo: serve la password attuale (come per cambiarla). Il precedente smette di valere. */
function RecoveryCode() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    setCode(null);
    setCurrent('');
    setError(null);
  };
  if (code) {
    return (
      <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch' }]}>
        <RecoveryCodeCard code={code} note={false} compact onDone={close} />
      </View>
    );
  }
  if (!open) {
    return (
      <Press style={styles.row} onPress={() => setOpen(true)} accessibilityRole="button">
        <Icon name="scudo" size={22} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="label">Codice di recupero</Txt>
          <Txt variant="small" tone={color.paperFaint}>
            Serve se dimentichi la password.
          </Txt>
        </View>
        <Icon name="destra" size={20} color={color.paperFaint} />
      </Press>
    );
  }
  const create = async () => {
    try {
      setBusy(true);
      setError(null);
      setCode(await createRecoveryCode(current));
      haptic('success');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch', gap: space[3] }]}>
      <Txt variant="label">Codice di recupero</Txt>
      <Txt variant="small" tone={color.paperDim}>
        Serve se dimentichi la password. Il codice precedente smetterà di funzionare.
      </Txt>
      <Field value={current} onChangeText={setCurrent} placeholder="Password attuale" secureTextEntry autoCapitalize="none" accessibilityLabel="Password attuale" maxLength={72} />
      {error ? (
        <Txt variant="small" tone={color.matita}>
          {error}
        </Txt>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
        <Press style={[styles.pill, { backgroundColor: color.giallo, borderColor: color.giallo }]} onPress={() => void create()} disabled={busy || !current} accessibilityRole="button">
          <Txt variant="meta" tone={color.canvas}>
            {busy ? 'Creo…' : 'Crea un nuovo codice'}
          </Txt>
        </Press>
        <Press style={styles.pill} onPress={close} accessibilityRole="button">
          <Txt variant="meta">Annulla</Txt>
        </Press>
      </View>
    </View>
  );
}

const PUSH_ROWS: { key: keyof PushPrefs; label: string }[] = [
  { key: 'cover', label: 'Nuova copertina ogni giorno' },
  { key: 'contest', label: 'Il tuo post in gara' },
  { key: 'social', label: 'Follower e commenti' },
];

/** Notifiche sul telefono: permesso del sistema e tre categorie (verifica e rimozioni arrivano sempre). */
function NotificationSettings() {
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [prefs, setPrefs] = useState<PushPrefs | null>(null);
  const [asking, setAsking] = useState(false);

  // Il permesso si rilegge tornando nella schermata e tornando dalle impostazioni del telefono.
  const refresh = useCallback(() => {
    if (pushMissingReason) return;
    void pushPermission().then(setState);
  }, []);
  useFocusEffect(refresh);
  useEffect(() => {
    if (pushMissingReason) return;
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    getPushPrefs()
      .then(setPrefs)
      .catch(() => setPrefs(null));
    return () => sub.remove();
  }, [refresh]);

  if (pushMissingReason) {
    return (
      <Txt variant="small" tone={color.paperFaint}>
        {pushMissingReason}
      </Txt>
    );
  }

  const toggle = (key: keyof PushPrefs) => {
    if (!prefs) return;
    const before = prefs;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setPushPrefs(next)
      .then(setPrefs)
      .catch((e: unknown) => {
        setPrefs(before);
        toast(friendlyError(e), 'error');
      });
  };

  const ask = async () => {
    setAsking(true);
    setState(await registerPush());
    setAsking(false);
  };

  return (
    <View style={{ gap: space[3] }}>
      {state === 'denied' ? (
        <View style={[styles.row, { flexDirection: 'column', alignItems: 'flex-start', gap: space[3] }]}>
          <Txt variant="small" tone={color.paperDim}>
            Le notifiche sono spente nelle impostazioni del telefono.
          </Txt>
          <Press style={styles.pill} onPress={openPushSettings} accessibilityRole="button">
            <Txt variant="meta">Apri impostazioni</Txt>
          </Press>
        </View>
      ) : state === 'undetermined' ? (
        <Press style={[styles.pill, styles.pushOn]} onPress={() => void ask()} disabled={asking} accessibilityRole="button">
          <Txt variant="meta" tone={color.canvas}>
            {asking ? 'Un attimo…' : 'Attiva le notifiche'}
          </Txt>
        </Press>
      ) : state === 'unavailable' ? (
        <Txt variant="small" tone={color.paperFaint}>
          Su questo telefono le notifiche non sono ancora disponibili: riprova più tardi.
        </Txt>
      ) : null}
      {prefs
        ? PUSH_ROWS.map((r) => (
            <View key={r.key} style={styles.switchRow}>
              <Txt variant="label" style={{ flex: 1 }}>
                {r.label}
              </Txt>
              <Switch
                value={prefs[r.key]}
                onValueChange={() => toggle(r.key)}
                accessibilityLabel={r.label}
                trackColor={{ false: color.line, true: color.giallo }}
                thumbColor={color.paper}
              />
            </View>
          ))
        : null}
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
  warnBox: { borderWidth: 1, borderColor: color.giallo },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space[4], backgroundColor: color.raised, borderRadius: radius.control, paddingHorizontal: space[4], minHeight: 56 },
  pushOn: { backgroundColor: color.giallo, borderColor: color.giallo, alignSelf: 'flex-start', paddingVertical: 10 },
});
