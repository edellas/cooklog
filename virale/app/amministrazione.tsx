import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Field } from '../src/components/Field';
import { Icon } from '../src/components/Icon';
import { haptic, Press } from '../src/components/Press';
import { useToast } from '../src/components/Toast';
import { Txt } from '../src/components/Txt';
import { color, radius, space } from '../src/design/tokens';
import { ageOn, diagnoseAgeCheck, getIdentityQueue, MIN_AGE_YEARS, purgeStorage, reviewIdentity, saveSettings, setIdProvider } from '../src/services/api';
import { useSession } from '../src/state/session';
import { useGoBack } from '../src/state/useGoBack';
import type { IdentityItem } from '../src/types';
import { friendlyError } from '../src/services/errors';
import { useNav } from '../src/state/nav';

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const dateIt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Amministrazione: orario in cui compare la nuova copertina, giorni concessi per il documento,
 * e la coda dei documenti da verificare. Solo per gli amministratori (il server lo ricontrolla).
 */
export default function AdminScreen() {
  const insets = useSafeAreaInsets();
  const nav = useNav();
  const goBack = useGoBack('/impostazioni');
  const toast = useToast();
  const { status, refreshStatus, bump } = useSession();
  const [reveal, setReveal] = useState<number | null>(null);
  const [grace, setGrace] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [queue, setQueue] = useState<IdentityItem[] | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [diag, setDiag] = useState<{ ok: boolean; checks: string[] } | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);

  const isAdmin = Boolean(status?.isAdmin);
  const revealNow = reveal ?? status?.settings.revealMinutes ?? 0;
  const graceNow = grace ?? status?.settings.idGraceDays ?? 7;
  const dirty = (reveal !== null && reveal !== status?.settings.revealMinutes) || (grace !== null && grace !== status?.settings.idGraceDays);

  const loadQueue = useCallback(() => {
    if (!isAdmin) return;
    getIdentityQueue()
      .then((q) => {
        setQueue(q);
        setQueueError(null);
      })
      .catch((e: unknown) => setQueueError(friendlyError(e)));
  }, [isAdmin]);
  useFocusEffect(loadQueue);
  // Ogni apertura cancella i file rimasti in coda (documenti già decisi, media di account chiusi).
  useFocusEffect(
    useCallback(() => {
      if (!isAdmin) return;
      purgeStorage()
        .then((n) => {
          if (n) toast(`Cancellati ${n} file non più necessari.`);
        })
        .catch((e: unknown) => toast(friendlyError(e), 'error'));
    }, [toast, isAdmin]),
  );

  if (!status) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={color.giallo} />
      </View>
    );
  }
  if (!status.isAdmin) {
    return (
      <View style={[styles.root, styles.center]}>
        <Txt variant="title">Solo per gli amministratori.</Txt>
        <Press style={styles.pill} onPress={goBack} accessibilityRole="button">
          <Txt variant="label">Indietro</Txt>
        </Press>
      </View>
    );
  }

  const save = async () => {
    try {
      setSaving(true);
      await saveSettings(revealNow, graceNow);
      haptic('success');
      // Prima si rilegge lo stato, poi si azzerano le modifiche: così i selettori non tornano un attimo al valore vecchio.
      await refreshStatus();
      setReveal(null);
      setGrace(null);
      bump();
      toast(`Fatto: la copertina compare alle ${hhmm(revealNow)}.`);
    } catch (e) {
      toast(friendlyError(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Press style={styles.round} onPress={goBack} accessibilityRole="button" accessibilityLabel="Indietro">
          <Icon name="indietro" />
        </Press>
        <Txt variant="title">Amministrazione</Txt>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: space[5], paddingBottom: insets.bottom + space[10], gap: space[8] }}>
        <View style={{ gap: space[3] }}>
          <Txt variant="title">Orario della copertina</Txt>
          <Txt variant="small" tone={color.paperDim}>
            A quest’ora (ora italiana) la gara chiude, si sceglie il vincitore e la nuova copertina esce subito, per tutti. Le candidature chiudono 4
            ore prima. Se l’orario che scegli per oggi è già passato, la gara chiude adesso.
          </Txt>
          <View style={styles.stepRow}>
            <Stepper label="Ore" value={Math.floor(revealNow / 60)} min={0} max={23} onChange={(h) => setReveal(h * 60 + (revealNow % 60))} />
            <Txt style={styles.big}>{hhmm(revealNow)}</Txt>
            <Stepper label="Minuti" value={revealNow % 60} min={0} max={55} step={5} onChange={(m) => setReveal(Math.floor(revealNow / 60) * 60 + m)} />
          </View>
        </View>

        <View style={{ gap: space[3] }}>
          <Txt variant="title">Tempo per il documento</Txt>
          <Txt variant="small" tone={color.paperDim}>
            Giorni concessi ai nuovi iscritti per caricare il documento d’identità. Vale per chi si iscrive da adesso.
          </Txt>
          <View style={styles.stepRow}>
            <Stepper label="Giorni" value={graceNow} min={1} max={60} onChange={setGrace} />
            <Txt style={styles.big}>
              {graceNow} {graceNow === 1 ? 'giorno' : 'giorni'}
            </Txt>
          </View>
        </View>

        <Press style={[styles.cta, (!dirty || saving) && styles.off]} onPress={() => void save()} disabled={!dirty || saving} accessibilityRole="button">
          {saving ? <ActivityIndicator color={color.canvas} /> : <Txt variant="label" tone={color.canvas}>Salva</Txt>}
        </Press>

        <View style={{ gap: space[3] }}>
          <Txt variant="title">Come si verifica l’età</Txt>
          <Txt variant="small" tone={color.paperDim}>
            Automatica: Didit legge il documento e confronta il volto con un selfie (500 verifiche gratis al mese, poi circa 0,30 $ l’una). Prima va
            collegata la funzione “verifica-eta” su Supabase (vedi PUBBLICARE.md). Con le foto, decidi tu qui sotto.
          </Txt>
          <View style={styles.actions}>
            {(
              [
                ['manual', 'Foto all’amministratore'],
                ['didit', 'Automatica (Didit)'],
              ] as const
            ).map(([id, label]) => {
              const on = status.settings.idProvider === id;
              return (
                <Press
                  key={id}
                  style={[styles.btn, on ? styles.ok : styles.no]}
                  onPress={() => {
                    if (on) return;
                    setIdProvider(id)
                      .then(() => refreshStatus())
                      .then(() => toast(id === 'didit' ? 'Verifica automatica attiva.' : 'Verifica con le foto attiva.'))
                      .catch((e: unknown) => toast(friendlyError(e), 'error'));
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}>
                  <Txt variant="meta" tone={on ? color.canvas : color.paper} style={styles.bold}>
                    {label}
                  </Txt>
                </Press>
              );
            })}
          </View>
        </View>

        {status.settings.idProvider === 'didit' ? (
          <View style={{ gap: space[2] }}>
            <Press
              style={[styles.pill, { alignSelf: 'flex-start' }, diagBusy && styles.off]}
              disabled={diagBusy}
              onPress={() => {
                setDiagBusy(true);
                diagnoseAgeCheck()
                  .then(setDiag)
                  .finally(() => setDiagBusy(false));
              }}
              accessibilityRole="button">
              <Txt variant="label">{diagBusy ? 'Controllo…' : 'Prova il collegamento con Didit'}</Txt>
            </Press>
            {diag
              ? diag.checks.map((c) => (
                  <Txt key={c} variant="small" tone={c.startsWith('✗') ? color.matita : c.startsWith('✓') ? color.verde : color.paperDim} selectable>
                    {c}
                  </Txt>
                ))
              : null}
          </View>
        ) : null}

        <View style={{ gap: space[3] }}>
          <Txt variant="title">Documenti da verificare</Txt>
          <Txt variant="small" tone={color.paperDim}>
            Controlla che nome, cognome e data di nascita coincidano con il documento e che la persona del selfie sia la stessa. Dopo la decisione le foto
            vengono cancellate.
          </Txt>
          {queueError ? (
            <Txt variant="small" tone={color.matita}>
              {queueError}
            </Txt>
          ) : queue === null ? (
            <ActivityIndicator color={color.giallo} />
          ) : queue.length ? (
            queue.map((item) => <Review key={item.userId} item={item} onDone={loadQueue} />)
          ) : (
            <Txt variant="body" tone={color.paperFaint}>
              Nessun documento in attesa.
            </Txt>
          )}
        </View>

        <Press style={styles.link} onPress={() => nav.push('/moderazione')} accessibilityRole="button">
          <Icon name="scudo" size={20} />
          <Txt variant="label" style={{ flex: 1 }}>
            Segnalazioni da moderare
          </Txt>
          <Icon name="destra" size={20} color={color.paperFaint} />
        </Press>
      </ScrollView>
    </View>
  );
}

function Stepper({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  const wrap = (v: number) => (v > max ? min : v < min ? max : v);
  return (
    <View style={styles.stepper} accessibilityLabel={`${label}: ${value}`}>
      <Press style={styles.stepBtn} onPress={() => onChange(wrap(value - step))} accessibilityRole="button" accessibilityLabel={`${label} meno`}>
        <Icon name="meno" size={18} />
      </Press>
      <Txt variant="meta" tone={color.paperFaint}>
        {label}
      </Txt>
      <Press style={styles.stepBtn} onPress={() => onChange(wrap(value + step))} accessibilityRole="button" accessibilityLabel={`${label} più`}>
        <Icon name="piu" size={18} />
      </Press>
    </View>
  );
}

function Review({ item, onDone }: { item: IdentityItem; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmUnderage, setConfirmUnderage] = useState(false);
  const age = item.birthDate ? ageOn(item.birthDate) : null;
  const [zoom, setZoom] = useState<string | null>(null);

  const decide = async (decision: 'approve' | 'reject' | 'underage') => {
    if (decision === 'underage' && !confirmUnderage) return setConfirmUnderage(true);
    try {
      setBusy(true);
      await reviewIdentity(item.userId, decision, reason, item.submittedAt);
      haptic('success');
      toast(decision === 'approve' ? `@${item.username}: età verificata.` : decision === 'reject' ? `@${item.username}: documento rifiutato.` : `@${item.username}: espulso.`);
      onDone();
    } catch (e) {
      toast(friendlyError(e), 'error');
      setBusy(false);
      // Spesso significa che qualcun altro ha già deciso o che l'utente ha rimandato le foto: si ricarica la coda.
      onDone();
    }
  };

  return (
    <View style={styles.card}>
      <Txt variant="label">
        @{item.username} · {item.firstName ?? '—'} {item.lastName ?? ''}
      </Txt>
      {item.duplicateOf ? (
        <Txt variant="small" tone={color.matita}>
          Attenzione: la stessa persona (nome, cognome e data di nascita) ha già un account verificato, @{item.duplicateOf}. Una persona, un account:
          approva solo se è un caso giustificato (per esempio l’account vecchio è perso).
        </Txt>
      ) : null}
      {item.method === 'didit' ? (
        <Txt variant="small" tone={color.giallo}>
          {item.providerNote
            ? `Didit ha verificato il documento, ma è di un’altra persona? ${item.providerNote} Controlla foto e video nella console di Didit (business.didit.me) e poi decidi qui.`
            : 'Verifica automatica in revisione: guarda foto e video nella console di Didit (business.didit.me) e decidi lì. L’esito arriva qui da solo.'}
        </Txt>
      ) : null}
      <Txt variant="small" tone={item.birthDate ? color.paperDim : color.matita}>
        {item.birthDate ? `Nato/a il ${dateIt(item.birthDate)} (${age} anni dichiarati)` : 'Dati personali mancanti: rifiuta e chiedi di completarli.'}
      </Txt>
      <View style={styles.photos}>
        {[item.documentUrl, item.selfieUrl].map((u, i) =>
          u ? (
            <Press key={i} style={styles.photo} onPress={() => setZoom(u)} accessibilityRole="imagebutton" accessibilityLabel={`${i === 0 ? 'Documento' : 'Selfie con documento'}: tocca per ingrandire`}>
              <Image source={{ uri: u }} style={StyleSheet.absoluteFill} contentFit="contain" />
            </Press>
          ) : (
            <View key={i} style={[styles.photo, styles.center]}>
              <Txt variant="meta" tone={color.paperFaint}>
                Foto non disponibile
              </Txt>
            </View>
          ),
        )}
      </View>
      <Modal visible={Boolean(zoom)} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <Press style={styles.zoom} onPress={() => setZoom(null)} accessibilityRole="button" accessibilityLabel="Chiudi">
          {zoom ? <Image source={{ uri: zoom }} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}
        </Press>
      </Modal>
      <Field value={reason} onChangeText={setReason} placeholder="Motivo, se rifiuti (lo legge l’utente)" maxLength={200} accessibilityLabel="Motivo del rifiuto" />
      <View style={styles.actions}>
        <Press style={[styles.btn, styles.ok]} onPress={() => void decide('approve')} disabled={busy} accessibilityRole="button">
          <Txt variant="meta" tone={color.canvas} style={styles.bold}>
            Approva
          </Txt>
        </Press>
        <Press style={[styles.btn, styles.no]} onPress={() => void decide('reject')} disabled={busy} accessibilityRole="button">
          <Txt variant="meta" style={styles.bold}>
            Rifiuta
          </Txt>
        </Press>
        <Press style={[styles.btn, styles.ban, confirmUnderage && styles.banOn]} onPress={() => void decide('underage')} disabled={busy} accessibilityRole="button">
          <Txt variant="meta" tone={confirmUnderage ? color.paper : color.matita} style={styles.bold}>
            {confirmUnderage ? 'Conferma: espelli' : `Meno di ${MIN_AGE_YEARS} anni`}
          </Txt>
        </Press>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  center: { alignItems: 'center', justifyContent: 'center', gap: space[4] },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], paddingVertical: space[2] },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  stepper: { alignItems: 'center', gap: space[1] },
  stepBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
  big: { fontFamily: 'BodoniModa_900Black', fontSize: 40, lineHeight: 46, color: color.paper },
  cta: { backgroundColor: color.giallo, borderRadius: radius.control, paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  off: { opacity: 0.45 },
  pill: { borderWidth: 1, borderColor: color.paper, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 8 },
  card: { backgroundColor: color.raised, borderRadius: radius.card, padding: space[4], gap: space[3] },
  photos: { flexDirection: 'row', gap: space[2] },
  photo: { flex: 1, aspectRatio: 0.75, borderRadius: radius.control, backgroundColor: color.sheet, overflow: 'hidden' },
  zoom: { flex: 1, backgroundColor: '#000' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  btn: { borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 10 },
  ok: { backgroundColor: color.verde },
  no: { backgroundColor: color.line },
  ban: { borderWidth: 1, borderColor: color.matita },
  banOn: { backgroundColor: color.matita },
  bold: { fontFamily: 'SchibstedGrotesk_700Bold' },
  link: { flexDirection: 'row', alignItems: 'center', gap: space[4], backgroundColor: color.raised, borderRadius: radius.control, padding: space[4], minHeight: 56 },
});
