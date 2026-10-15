import * as ImagePicker from 'expo-image-picker';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Field } from '../src/components/Field';
import { Icon } from '../src/components/Icon';
import { MediaFrame } from '../src/components/MediaFrame';
import { haptic, Press } from '../src/components/Press';
import { Thumb } from '../src/components/Thumb';
import { TierLadder } from '../src/components/TierLadder';
import { Txt } from '../src/components/Txt';
import { useGoBack } from '../src/state/useGoBack';
import { duration, ease } from '../src/design/motion';
import { color, radius, space } from '../src/design/tokens';
import { contestOpen, getMyEntry, publish } from '../src/services/api';
import { useSession } from '../src/state/session';
import type { DraftMedia, MediaItem, MyEntry, Post } from '../src/types';

const MAX = 10;

export default function CreateScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { bump } = useSession();
  const [media, setMedia] = useState<DraftMedia[]>([]);
  const [selected, setSelected] = useState(0);
  const [caption, setCaption] = useState('');
  const [join, setJoin] = useState(true);
  const [alreadyIn, setAlreadyIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [done, setDone] = useState<{ post: Post; entry: MyEntry | null; contestError: string | null } | null>(null);
  const [closed] = useState(() => !contestOpen());
  const [confirmClose, setConfirmClose] = useState(false);
  const goBack = useGoBack();
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }, []);
  const canJoin = !alreadyIn && !closed;

  /** Chiudere con foto già scelte chiede conferma: non si perde il lavoro con un tocco. */
  const close = () => {
    if (!media.length || confirmClose) return goBack();
    setConfirmClose(true);
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => setConfirmClose(false), 4000);
  };

  useEffect(() => {
    void getMyEntry()
      .then((e) => {
        setAlreadyIn(Boolean(e));
        if (e) setJoin(false);
      })
      .catch(() => undefined);
  }, []);

  const pick = async (camera: boolean) => {
    setError(null);
    const room = MAX - media.length;
    if (room <= 0) return setError(`Al massimo ${MAX} foto e video per post.`);
    try {
      if (camera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return setError('Serve il permesso della fotocamera: puoi darlo dalle Impostazioni.');
      }
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images', 'videos'],
        quality: 0.8,
        videoMaxDuration: 60,
        allowsMultipleSelection: !camera,
        selectionLimit: room,
        orderedSelection: true,
        // Su iPhone le foto HEIC e i video HEVC diventano JPEG e H.264: si vedono anche su Android e sul web.
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      };
      const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled) return;
      // Sul web la durata arriva in secondi, sul telefono in millisecondi.
      const ms = (d: number | null | undefined) => (d == null ? undefined : Math.round(Platform.OS === 'web' ? d * 1000 : d));
      const tooLong = res.assets.some((a) => a.type === 'video' && (ms(a.duration) ?? 0) > 61_000);
      const next: DraftMedia[] = res.assets
        .filter((a) => !(a.type === 'video' && (ms(a.duration) ?? 0) > 61_000))
        .map((a) => ({
          uri: a.uri,
          kind: a.type === 'video' ? 'video' : 'image',
          width: a.width,
          height: a.height,
          durationMs: ms(a.duration),
          mimeType: a.mimeType ?? undefined,
        }));
      const extra = next.length - room;
      if (tooLong) setError('I video possono durare al massimo 60 secondi: quelli più lunghi non sono stati aggiunti.');
      else if (extra > 0) setError(`Al massimo ${MAX} per post: ne ho tenuti ${room}, gli altri ${extra} no.`);
      setMedia((m) => [...m, ...next].slice(0, MAX));
    } catch {
      setError('Non riesco ad aprire la galleria. Riprova.');
    }
  };

  const move = (dir: -1 | 1) => {
    setMedia((m) => {
      const j = selected + dir;
      if (j < 0 || j >= m.length) return m;
      const copy = [...m];
      [copy[selected], copy[j]] = [copy[j], copy[selected]];
      return copy;
    });
    setSelected((s) => Math.max(0, Math.min(media.length - 1, s + dir)));
  };
  const remove = () => {
    setMedia((m) => m.filter((_, i) => i !== selected));
    setSelected((s) => Math.max(0, Math.min(s, media.length - 2)));
  };

  const submit = async () => {
    try {
      setBusy(true);
      setError(null);
      const res = await publish({ media, caption, joinContest: join && canJoin });
      haptic('success');
      bump();
      setDone(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) return <Done post={done.post} entry={done.entry} contestError={done.contestError} onClose={goBack} onGo={() => router.replace('/provini' as Href)} />;

  const preview: MediaItem[] = media.map((m) => ({ kind: m.kind, src: m.uri, width: m.width, height: m.height, durationMs: m.durationMs }));

  return (
    // iOS: la ScrollView sposta da sola il contenuto sopra la tastiera; Android (bordo a bordo): padding.
    <KeyboardAvoidingView style={[styles.root, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? undefined : 'padding'}>
      <View style={styles.bar}>
        <Press style={[styles.round, confirmClose && styles.roundWarn]} onPress={close} accessibilityRole="button" accessibilityLabel={confirmClose ? 'Tocca di nuovo per scartare il post' : 'Chiudi'}>
          <Icon name="chiudi" color={confirmClose ? color.matita : color.paper} />
        </Press>
        <Txt variant="title">{confirmClose ? 'Scartare il post?' : 'Nuovo post'}</Txt>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space[4], gap: space[4], paddingBottom: insets.bottom + space[8] }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        {!media.length ? (
          <View style={{ gap: space[3] }}>
            <Press style={styles.source} onPress={() => void pick(false)} accessibilityRole="button">
              <Icon name="galleria" size={30} color={color.giallo} />
              <Txt variant="title">Dalla galleria</Txt>
              <Txt variant="small" tone={color.paperDim}>
                Fino a 10 foto e video insieme, nell’ordine in cui li tocchi.
              </Txt>
            </Press>
            {Platform.OS !== 'web' ? (
              <Press style={styles.source} onPress={() => void pick(true)} accessibilityRole="button">
                <Icon name="fotocamera" size={30} color={color.giallo} />
                <Txt variant="title">Scatta o registra</Txt>
                <Txt variant="small" tone={color.paperDim}>
                  Una foto o un video fino a 60 secondi.
                </Txt>
              </Press>
            ) : null}
          </View>
        ) : (
          <>
            <View style={styles.preview}>
              <MediaFrame media={preview} active muted={muted} onToggleMute={() => setMuted((x) => !x)} index={selected} onIndexChange={setSelected} />
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }}>
              {media.map((m, i) => (
                <Press key={`${m.uri}-${i}`} style={[styles.thumb, i === selected && styles.thumbOn]} scaleTo={0.96} onPress={() => setSelected(i)} accessibilityRole="button" accessibilityState={{ selected: i === selected }} accessibilityLabel={`${m.kind === 'video' ? 'Video' : 'Foto'} ${i + 1} di ${media.length}`}>
                  <Thumb media={[{ kind: m.kind, src: m.uri, width: m.width, height: m.height }]} rounded={8} />
                </Press>
              ))}
              {media.length < MAX ? (
                <Press style={[styles.thumb, styles.add]} onPress={() => void pick(false)} accessibilityRole="button" accessibilityLabel="Aggiungi foto o video">
                  <Icon name="scatta" size={22} color={color.paperDim} />
                </Press>
              ) : null}
            </ScrollView>

            <View style={styles.tools}>
              <Tool icon="sinistra" label="Prima" onPress={() => move(-1)} disabled={selected === 0} />
              <Tool icon="destra" label="Dopo" onPress={() => move(1)} disabled={selected >= media.length - 1} />
              <Tool icon="cestino" label="Togli" onPress={remove} />
              <Txt variant="meta" tone={color.paperFaint} style={{ marginLeft: 'auto' }}>
                {media.length} / {MAX}
              </Txt>
            </View>

            <View style={{ gap: 4 }}>
              <Field
                containerStyle={{ alignItems: 'flex-start' }}
                style={styles.caption}
                value={caption}
                onChangeText={setCaption}
                placeholder="Scrivi una didascalia"
                accessibilityLabel="Didascalia"
                maxLength={300}
                multiline
              />
              <Txt variant="meta" tone={color.paperFaint} style={{ alignSelf: 'flex-end' }}>
                {caption.length}/300
              </Txt>
            </View>

            <Press style={styles.contest} scaleTo={0.99} onPress={() => canJoin && setJoin((j) => !j)} disabled={!canJoin} accessibilityRole="switch" accessibilityState={{ checked: join && canJoin, disabled: !canJoin }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Txt variant="label">Candidalo per la copertina di domani</Txt>
                <Txt variant="small" tone={color.paperDim}>
                  {alreadyIn
                    ? 'Oggi hai già un post in gara: se ne candida uno al giorno.'
                    : closed
                      ? 'Le candidature di oggi hanno chiuso alle 20:00. Riaprono a mezzanotte.'
                      : 'Entra nei Provini. Se vince, domani lo vede chiunque apra Virale.'}
                </Txt>
              </View>
              <Toggle on={join && canJoin} />
            </Press>
          </>
        )}

        {error ? (
          <Txt variant="small" tone={color.matita}>
            {error}
          </Txt>
        ) : null}

        {media.length ? (
          <Press style={[styles.publish, busy && styles.off]} onPress={() => void submit()} disabled={busy} accessibilityRole="button">
            {busy ? (
              <ActivityIndicator color={color.canvas} />
            ) : (
              <Txt variant="label" tone={color.canvas}>
                {join && canJoin ? 'Pubblica e candida' : 'Pubblica'}
              </Txt>
            )}
          </Press>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Tool({ icon, label, onPress, disabled }: { icon: 'sinistra' | 'destra' | 'cestino'; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Press style={[styles.tool, disabled && styles.off]} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name={icon} size={18} />
      <Txt variant="meta">{label}</Txt>
    </Press>
  );
}

/** Interruttore: cambio di stato in 180 ms ease-out. */
function Toggle({ on }: { on: boolean }) {
  const x = useSharedValue(on ? 20 : 0);
  useEffect(() => {
    x.set(withTiming(on ? 20 : 0, { duration: duration.toggle, easing: ease.out }));
  }, [on, x]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  return (
    <View style={[styles.track, on && styles.trackOn]}>
      <Animated.View style={[styles.knob, knob]} />
    </View>
  );
}

/** Pubblicato. Momento raro: il provino si "appunta" sul tavolo con una piccola rotazione. */
function Done({ post, entry, contestError, onClose, onGo }: { post: Post; entry: MyEntry | null; contestError: string | null; onClose: () => void; onGo: () => void }) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const s = useSharedValue(reduced ? 1 : 0.92);
  const r = useSharedValue(reduced ? -2 : -7);
  const o = useSharedValue(0);
  useEffect(() => {
    s.set(withTiming(1, { duration: 420, easing: ease.out }));
    r.set(withTiming(-2, { duration: 420, easing: ease.out }));
    o.set(withTiming(1, { duration: 300, easing: ease.out }));
  }, [o, r, s]);
  const card = useAnimatedStyle(() => ({ opacity: o.get(), transform: [{ scale: s.get() }, { rotate: `${r.get()}deg` }] }));
  return (
    <View style={[styles.root, styles.done, { paddingTop: insets.top + space[8], paddingBottom: insets.bottom + space[5] }]}>
      <Animated.View style={[styles.pinned, card]}>
        <Thumb media={post.media} rounded={12} />
      </Animated.View>
      <View style={{ gap: space[2], alignItems: 'center' }}>
        <Txt variant="heading" style={{ textAlign: 'center' }}>
          {entry ? 'Sei nei Provini.' : 'Pubblicato.'}
        </Txt>
        <Txt variant="body" tone={color.paperDim} style={{ textAlign: 'center', maxWidth: 320 }}>
          {entry ? 'Da adesso il tuo post arriva a un primo pubblico. Se piace, sale di gradino.' : 'Lo trovi nel tuo profilo e lo vedono i tuoi follower.'}
        </Txt>
        {contestError ? (
          <Txt variant="small" tone={color.matita} style={{ textAlign: 'center', maxWidth: 320 }}>
            Non è in gara: {contestError}
          </Txt>
        ) : null}
      </View>
      {entry ? (
        <View style={styles.doneLadder}>
          <TierLadder entry={entry} />
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      <View style={{ gap: space[2], alignSelf: 'stretch' }}>
        {entry ? (
          <Press style={styles.publish} onPress={onGo} accessibilityRole="button">
            <Txt variant="label" tone={color.canvas}>
              Guarda gli altri provini
            </Txt>
          </Press>
        ) : null}
        <Press style={styles.secondary} onPress={onClose} accessibilityRole="button">
          <Txt variant="label">Fatto</Txt>
        </Press>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], paddingVertical: space[2] },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
  roundWarn: { borderWidth: 1.5, borderColor: color.matita },
  source: { backgroundColor: color.raised, borderRadius: radius.card, padding: space[5], gap: space[2] },
  preview: { height: 420, borderRadius: 22, overflow: 'hidden' },
  thumb: { width: 60, height: 90, borderRadius: 10, borderWidth: 2, borderColor: 'transparent', padding: 1 },
  thumbOn: { borderColor: color.giallo },
  add: { borderColor: color.line, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  tools: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: color.raised, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  caption: { minHeight: 84, lineHeight: 22, textAlignVertical: 'top' },
  contest: { flexDirection: 'row', alignItems: 'center', gap: space[4], backgroundColor: color.raised, borderRadius: radius.card, padding: space[4] },
  track: { width: 48, height: 28, borderRadius: 14, backgroundColor: color.line, padding: 3 },
  trackOn: { backgroundColor: color.giallo },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: color.paper },
  publish: { backgroundColor: color.giallo, borderRadius: radius.control, paddingVertical: 16, alignItems: 'center', minHeight: 52, justifyContent: 'center' },
  secondary: { backgroundColor: color.raised, borderRadius: radius.control, paddingVertical: 16, alignItems: 'center' },
  off: { opacity: 0.4 },
  done: { alignItems: 'center', paddingHorizontal: space[6], gap: space[6] },
  pinned: { width: 170, height: 255, borderRadius: 14, borderWidth: 6, borderColor: color.paper, backgroundColor: color.paper },
  doneLadder: { alignSelf: 'stretch', backgroundColor: color.raised, borderRadius: radius.card, padding: space[4] },
});
