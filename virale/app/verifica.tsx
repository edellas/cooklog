import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../src/components/Icon';
import { haptic, Press } from '../src/components/Press';
import { useToast } from '../src/components/Toast';
import { Txt } from '../src/components/Txt';
import { color, radius, space } from '../src/design/tokens';
import { Field } from '../src/components/Field';
import { completePrivateData, getStatus, startAgeCheck, submitIdentity } from '../src/services/api';
import { useSession } from '../src/state/session';
import { useGoBack } from '../src/state/useGoBack';

/** Scadenza con l'ora, sempre in ora italiana: è quella che usa il server. */
const deadlineIt = (iso: string) => {
  const d = new Date(iso);
  try {
    return d.toLocaleString('it-IT', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Rome',
    });
  } catch {
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
  }
};

/** JPEG vero (il bucket accetta solo quello) e lato lungo entro 2000 px: leggibile ma non 10 MB. */
const toJpeg = async (a: ImagePicker.ImagePickerAsset): Promise<string> => {
  try {
    const max = 2000;
    const ctx = ImageManipulator.manipulate(a.uri);
    if (a.width > max || a.height > max) ctx.resize(a.width >= a.height ? { width: max } : { height: max });
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    return out.uri;
  } catch {
    return a.uri;
  }
};

/**
 * Verifica dell'età. Due foto: il documento (fronte, con data di nascita leggibile) e un selfie con il
 * documento in mano accanto al viso. Un amministratore le confronta con nome, cognome e data di nascita
 * dichiarati; appena deciso, le foto vengono cancellate.
 */
export default function VerifyScreen() {
  const insets = useSafeAreaInsets();
  const goBack = useGoBack('/profilo');
  const toast = useToast();
  const { status, refreshStatus } = useSession();
  const [doc, setDoc] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Appena inviato mostriamo subito "in controllo", senza aspettare il prossimo aggiornamento dello stato.
  const [sent, setSent] = useState(false);
  const auto = status?.settings.idProvider === 'didit';
  /** Con la verifica automatica attiva, le foto all'amministratore restano come alternativa. */
  const [manual, setManual] = useState(false);
  const [checking, setChecking] = useState(false);

  // Verifica automatica: si apre Didit nel browser; tornati nell'app l'esito arriva dal server in pochi secondi.
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const runAuto = async () => {
    setError(null);
    try {
      setChecking(true);
      const before = status?.identity?.status;
      const url = await startAgeCheck();
      let finished = true;
      if (url) finished = (await WebBrowser.openAuthSessionAsync(url, 'virale://verifica')).type === 'success';
      // L'esito arriva al server qualche secondo dopo: si controlla finché cambia (al massimo ~45 s, o ~9 s se
      // il browser è stato chiuso prima della fine).
      const rounds = !url ? 1 : finished ? 15 : 3;
      for (let i = 0; i < rounds && alive.current; i += 1) {
        const now = await getStatus().catch(() => null);
        if (now?.identity && now.identity.status !== before) break;
        if (i < rounds - 1) await new Promise((r) => setTimeout(r, 3000));
      }
      if (alive.current) await refreshStatus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (alive.current) setChecking(false);
    }
  };

  const identity = status?.identity;
  const state = sent && identity?.status !== 'approved' ? 'pending' : (identity?.status ?? 'missing');

  // Su Android il sistema può chiudere l'app mentre la fotocamera è aperta: la foto scattata arriva qui.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    ImagePicker.getPendingResultAsync()
      .then(async (res) => {
        if (!res || !('assets' in res) || res.canceled || !res.assets?.[0]) return;
        const uri = await toJpeg(res.assets[0]);
        setDoc((d) => {
          if (d) setSelfie(uri);
          return d ?? uri;
        });
      })
      .catch(() => undefined);
  }, []);

  const pick = async (which: 'doc' | 'selfie', camera: boolean) => {
    setError(null);
    try {
      if (camera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return setError('Serve il permesso della fotocamera: puoi darlo dalle Impostazioni del telefono.');
      }
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        quality: 0.7,
        allowsEditing: false,
        cameraType: which === 'selfie' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      };
      const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets[0]) return;
      const uri = await toJpeg(res.assets[0]);
      (which === 'doc' ? setDoc : setSelfie)(uri);
    } catch {
      setError('Non riesco ad aprire fotocamera o galleria. Riprova.');
    }
  };

  const send = async () => {
    if (!doc || !selfie) return setError('Servono entrambe le foto.');
    try {
      setBusy(true);
      setError(null);
      await submitIdentity(doc, selfie);
      haptic('success');
      setSent(true);
      void refreshStatus();
      toast('Documento inviato: lo controlliamo al più presto.');
      setDoc(null);
      setSelfie(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Press style={styles.round} onPress={goBack} accessibilityRole="button" accessibilityLabel="Indietro">
          <Icon name="indietro" />
        </Press>
        <Txt variant="title">Verifica dell’età</Txt>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView
        contentContainerStyle={{
          padding: space[5],
          paddingBottom: insets.bottom + space[10],
          gap: space[5],
        }}>
        {!identity ? (
          <ActivityIndicator color={color.giallo} />
        ) : status?.needsPrivate && state !== 'approved' ? (
          <PrivateData onDone={refreshStatus} />
        ) : state === 'approved' ? (
          <View style={[styles.state, styles.ok]}>
            <Icon name="check" size={22} color={color.verde} strokeWidth={2.4} />
            <Txt variant="label" style={{ flex: 1 }}>
              Età verificata. Non serve fare altro.
            </Txt>
          </View>
        ) : state === 'pending' ? (
          <View style={styles.state}>
            <Icon name="orologio" size={22} color={color.giallo} />
            <Txt variant="body" style={{ flex: 1 }}>
              {identity.canAct
                ? 'Documento ricevuto: lo stiamo controllando. Intanto puoi usare Virale normalmente.'
                : 'Documento ricevuto: lo stiamo controllando. Il tempo per la verifica è passato, quindi finché non abbiamo deciso puoi solo guardare.'}
            </Txt>
          </View>
        ) : (
          <>
            <View style={[styles.state, !identity.canAct && styles.warn]}>
              <Icon name={identity.canAct ? 'orologio' : 'info'} size={22} color={identity.canAct ? color.giallo : color.matita} />
              <Txt variant="body" style={{ flex: 1 }}>
                {state === 'rejected'
                  ? `Il documento non è stato accettato: ${(identity.reason ?? 'riprova con foto più nitide').replace(/[.\s]+$/, '')}. `
                  : ''}
                {identity.canAct
                  ? `Hai tempo fino al ${deadlineIt(identity.deadline)} per verificare l’età.`
                  : 'Il tempo per la verifica è scaduto: finché non la fai puoi solo guardare.'}
              </Txt>
            </View>

            {auto ? (
              <View style={styles.slot}>
                <Txt variant="label">Verifica automatica · circa 2 minuti</Txt>
                <Txt variant="small" tone={color.paperDim}>
                  Si apre Didit, il servizio europeo che usiamo per la verifica: inquadri il documento (carta d’identità elettronica, passaporto o patente) e
                  fai un breve selfie. Legge solo la data di nascita e controlla che il volto sia il tuo. Finita la verifica, i dati vengono cancellati anche da
                  Didit.
                </Txt>
                <Press style={[styles.cta, checking && styles.off]} onPress={() => void runAuto()} disabled={checking} accessibilityRole="button">
                  {checking ? (
                    <ActivityIndicator color={color.canvas} />
                  ) : (
                    <Txt variant="label" tone={color.canvas}>
                      Verifica ora
                    </Txt>
                  )}
                </Press>
                {checking ? (
                  <Txt variant="meta" tone={color.paperFaint}>
                    Aspetto l’esito…
                  </Txt>
                ) : null}
                {!manual ? (
                  <Press onPress={() => setManual(true)} accessibilityRole="button">
                    <Txt variant="small" tone={color.paperDim} style={{ textDecorationLine: 'underline' }}>
                      Non riesci? Manda le foto a un amministratore
                    </Txt>
                  </Press>
                ) : null}
              </View>
            ) : null}

            {auto && !manual ? (
              error ? (
                <Txt variant="small" tone={color.matita}>
                  {error}
                </Txt>
              ) : null
            ) : (
              <>
                <View style={{ gap: space[2] }}>
                  <Txt variant="title">Perché lo chiediamo</Txt>
                  <Txt variant="body" tone={color.paperDim}>
                    Virale è aperta dai 14 anni. Per esserne sicuri un amministratore confronta il documento con nome, cognome e data di nascita che hai dato
                    all’iscrizione. Le foto le vede solo lui e vengono cancellate appena ha deciso: teniamo solo l’esito.
                  </Txt>
                </View>

                <Slot
                  title="1. Il documento"
                  hint="Carta d’identità, patente o passaporto: il lato con foto e data di nascita, tutto dentro l’inquadratura e leggibile."
                  uri={doc}
                  onCamera={() => void pick('doc', true)}
                  onGallery={() => void pick('doc', false)}
                />
                <Slot
                  title="2. Un selfie con il documento"
                  hint="Tieni il documento accanto al viso, senza coprirlo: serve a capire che è proprio il tuo."
                  uri={selfie}
                  onCamera={() => void pick('selfie', true)}
                  onGallery={() => void pick('selfie', false)}
                />

                {error ? (
                  <Txt variant="small" tone={color.matita}>
                    {error}
                  </Txt>
                ) : null}
                <Press
                  style={[styles.cta, (!doc || !selfie || busy) && styles.off]}
                  onPress={() => void send()}
                  disabled={!doc || !selfie || busy}
                  accessibilityRole="button">
                  {busy ? (
                    <ActivityIndicator color={color.canvas} />
                  ) : (
                    <Txt variant="label" tone={color.canvas}>
                      Invia per la verifica
                    </Txt>
                  )}
                </Press>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** Chi si era iscritto prima delle password inserisce qui i dati da confrontare con il documento. */
function PrivateData({ onDone }: { onDone: () => void }) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      setBusy(true);
      setError(null);
      await completePrivateData(first, last, `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space[3] }}>
      <Txt variant="title">Prima, i tuoi dati</Txt>
      <Txt variant="body" tone={color.paperDim}>
        Ti sei iscritto prima che li chiedessimo: servono per confrontarli con il documento. Restano privati.
      </Txt>
      <View style={styles.row}>
        <Field containerStyle={{ flex: 1 }} value={first} onChangeText={setFirst} placeholder="Nome" maxLength={60} accessibilityLabel="Nome" />
        <Field containerStyle={{ flex: 1 }} value={last} onChangeText={setLast} placeholder="Cognome" maxLength={60} accessibilityLabel="Cognome" />
      </View>
      <View style={styles.row}>
        <Field
          containerStyle={{ flex: 1 }}
          value={day}
          onChangeText={(v) => setDay(v.replace(/\D/g, '').slice(0, 2))}
          placeholder="GG"
          keyboardType="number-pad"
          maxLength={2}
          accessibilityLabel="Giorno di nascita"
        />
        <Field
          containerStyle={{ flex: 1 }}
          value={month}
          onChangeText={(v) => setMonth(v.replace(/\D/g, '').slice(0, 2))}
          placeholder="MM"
          keyboardType="number-pad"
          maxLength={2}
          accessibilityLabel="Mese di nascita"
        />
        <Field
          containerStyle={{ flex: 1.6 }}
          value={year}
          onChangeText={(v) => setYear(v.replace(/\D/g, '').slice(0, 4))}
          placeholder="AAAA"
          keyboardType="number-pad"
          maxLength={4}
          accessibilityLabel="Anno di nascita"
        />
      </View>
      {error ? (
        <Txt variant="small" tone={color.matita}>
          {error}
        </Txt>
      ) : null}
      <Press
        style={[styles.cta, busy && styles.off]}
        onPress={() => void save()}
        disabled={busy || !first || !last || year.length !== 4}
        accessibilityRole="button">
        {busy ? (
          <ActivityIndicator color={color.canvas} />
        ) : (
          <Txt variant="label" tone={color.canvas}>
            Continua
          </Txt>
        )}
      </Press>
    </View>
  );
}

function Slot({ title, hint, uri, onCamera, onGallery }: { title: string; hint: string; uri: string | null; onCamera: () => void; onGallery: () => void }) {
  return (
    <View style={styles.slot}>
      <Txt variant="label">{title}</Txt>
      <Txt variant="small" tone={color.paperDim}>
        {hint}
      </Txt>
      {uri ? <Image source={{ uri }} style={styles.preview} contentFit="cover" accessibilityLabel={`Anteprima: ${title}`} /> : null}
      <View style={styles.row}>
        {Platform.OS !== 'web' ? (
          <Press style={styles.pill} onPress={onCamera} accessibilityRole="button" accessibilityLabel={`Scatta: ${title}`}>
            <Icon name="fotocamera" size={18} />
            <Txt variant="meta">{uri ? 'Rifai' : 'Scatta'}</Txt>
          </Press>
        ) : null}
        <Press style={styles.pill} onPress={onGallery} accessibilityRole="button" accessibilityLabel={`Scegli dalla galleria: ${title}`}>
          <Icon name="galleria" size={18} />
          <Txt variant="meta">Dalla galleria</Txt>
        </Press>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: color.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  state: {
    flexDirection: 'row',
    gap: space[3],
    alignItems: 'flex-start',
    backgroundColor: color.raised,
    borderRadius: radius.card,
    padding: space[4],
  },
  ok: { borderWidth: 1, borderColor: color.verde },
  warn: { borderWidth: 1, borderColor: color.matita },
  slot: {
    gap: space[2],
    backgroundColor: color.raised,
    borderRadius: radius.card,
    padding: space[4],
  },
  preview: {
    width: '100%',
    aspectRatio: 1.5,
    borderRadius: radius.control,
    backgroundColor: color.sheet,
  },
  row: { flexDirection: 'row', gap: space[2], marginTop: space[1] },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: color.sheet,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  cta: {
    backgroundColor: color.giallo,
    borderRadius: radius.control,
    paddingVertical: 16,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  off: { opacity: 0.45 },
});
