import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { Monogram } from '../components/Monogram';
import { haptic, Press } from '../components/Press';
import { Thumb } from '../components/Thumb';
import { TierLadder } from '../components/TierLadder';
import { Txt } from '../components/Txt';
import { formatCount } from '../design/format';
import { color, font, radius, space } from '../design/tokens';
import { blockUser, getProfile, isDemo, resetDemo, toggleFollow } from '../services/api';
import { useToast } from '../components/Toast';
import { emitFollowChange } from '../state/postEvents';
import { useSession } from '../state/session';
import { useGoBack } from '../state/useGoBack';
import type { MyEntry, Post, Profile } from '../types';

export function ProfileView({ username, showBack }: { username: string; showBack?: boolean }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { version, setMe, bump, status } = useSession();
  const [data, setData] = useState<{ profile: Profile; posts: Post[]; saved: Post[]; entry: MyEntry | null } | null>(null);
  const [tab, setTab] = useState<'post' | 'salvati'>('post');
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [gridWidth, setGridWidth] = useState(0);
  const toast = useToast();
  const goBack = useGoBack();
  // Le conferme "tocca di nuovo" scadono dopo qualche secondo: un tocco dimenticato non resta armato.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = (set: (v: boolean) => void) => {
    set(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setConfirmBlock(false);
      setConfirmReset(false);
    }, 4000);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void version; // ricarica quando altrove cambia qualcosa (nuovo post, nuova copertina)
      void getProfile(username)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    }, [username, version]),
  );

  if (error || !data) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + space[3] }]}>
        {showBack ? (
          <View style={styles.pad}>
            <Press style={styles.back} onPress={goBack} accessibilityRole="button" accessibilityLabel="Indietro">
              <Icon name="indietro" />
            </Press>
          </View>
        ) : null}
        <View style={styles.center}>{error ? <Txt variant="title">{error}</Txt> : <ActivityIndicator color={color.giallo} />}</View>
      </View>
    );
  }

  const { profile, posts, saved, entry } = data;
  const grid = tab === 'post' ? posts : saved;

  const follow = () => {
    const on = !profile.followedByMe;
    haptic('light');
    setData({ ...data, profile: { ...profile, followedByMe: on, followers: Math.max(0, profile.followers + (on ? 1 : -1)) } });
    emitFollowChange(profile.id, on);
    toggleFollow(profile.id, on).catch(() => {
      setData((d) => (d ? { ...d, profile: { ...d.profile, followedByMe: !on, followers: profile.followers } } : d));
      emitFollowChange(profile.id, !on);
      toast('Non ci sono riuscito. Riprova.', 'error');
    });
  };
  const block = async () => {
    if (!confirmBlock) return arm(setConfirmBlock);
    try {
      await blockUser(profile.id);
      bump();
      toast(`@${profile.username} è bloccato.`);
      goBack();
    } catch (e) {
      setConfirmBlock(false);
      toast((e as Error).message, 'error');
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + space[3], paddingBottom: space[12] }}>
      <View style={styles.pad}>
        <View style={styles.topRow}>
          {showBack ? (
            <Press style={styles.back} onPress={goBack} accessibilityRole="button" accessibilityLabel="Indietro">
              <Icon name="indietro" />
            </Press>
          ) : (
            <View />
          )}
          {profile.isMe ? (
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <Press
                style={styles.back}
                onPress={() => router.push('/notifiche' as Href)}
                accessibilityRole="button"
                accessibilityLabel={status?.unread ? `Notifiche, ${status.unread} da leggere` : 'Notifiche'}>
                <Icon name="campanella" />
                {status?.unread ? (
                  <View style={styles.badge}>
                    <Txt variant="meta" tone={color.canvas} style={{ fontFamily: font.uiBold, fontSize: 10, lineHeight: 12 }}>
                      {status.unread > 9 ? '9+' : status.unread}
                    </Txt>
                  </View>
                ) : null}
              </Press>
              <Press style={styles.back} onPress={() => router.push('/impostazioni' as Href)} accessibilityRole="button" accessibilityLabel="Impostazioni">
                <Icon name="impostazioni" />
              </Press>
            </View>
          ) : null}
        </View>

        <View style={styles.head}>
          <Monogram name={profile.displayName} seed={profile.username} size={76} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="heading" numberOfLines={2}>
              {profile.displayName}
            </Txt>
            <Txt variant="small" tone={color.paperFaint}>
              @{profile.username}
            </Txt>
          </View>
        </View>

        {profile.bio ? (
          <Txt variant="body" tone={color.paperDim}>
            {profile.bio}
          </Txt>
        ) : null}

        {profile.isMe && status?.identity && status.identity.status !== 'approved' ? (
          <Press style={[styles.verify, !status.identity.canAct && styles.verifyLate]} onPress={() => router.push('/verifica' as Href)} accessibilityRole="button">
            <Icon name="documento" size={22} color={status.identity.canAct ? color.giallo : color.matita} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="label">
                {status.identity.status === 'pending'
                  ? 'Documento in controllo'
                  : status.identity.canAct
                    ? 'Conferma la tua età'
                    : 'Verifica scaduta: puoi solo guardare'}
              </Txt>
              <Txt variant="small" tone={color.paperDim}>
                {status.identity.status === 'pending'
                  ? 'Ti avvisiamo appena l’abbiamo controllato.'
                  : status.identity.status === 'rejected'
                    ? `Non accettato: ${(status.identity.reason ?? 'riprova').replace(/[.\s]+$/, '')}. Tocca per ricaricarlo.`
                    : `Carica il documento entro il ${new Date(status.identity.deadline).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}.`}
              </Txt>
            </View>
            <Icon name="destra" size={20} color={color.paperFaint} />
          </Press>
        ) : null}

        <View style={styles.stats}>
          <Stat value={profile.followers} label="follower" onPress={() => router.push(`/seguaci/${profile.username}?tipo=followers` as Href)} />
          <Stat value={profile.following} label="seguiti" onPress={() => router.push(`/seguaci/${profile.username}?tipo=following` as Href)} />
          <Stat value={profile.covers} label={profile.covers === 1 ? 'copertina' : 'copertine'} highlight={profile.covers > 0} />
        </View>
        <View style={styles.viewsLine} accessible accessibilityLabel={`${formatCount(profile.views)} visualizzazioni dei post`}>
          <Icon name="occhio" size={18} color={color.paperFaint} />
          <Txt variant="small" tone={color.paperDim}>
            {formatCount(profile.views)} {profile.views === 1 ? 'visualizzazione' : 'visualizzazioni'} dei post
          </Txt>
        </View>

        {profile.isMe ? (
          <Press style={styles.secondary} onPress={() => router.push('/regole' as Href)} accessibilityRole="button">
            <Icon name="info" size={20} />
            <Txt variant="label">Come si diventa copertina</Txt>
          </Press>
        ) : (
          <Press
            style={[styles.primary, profile.followedByMe && styles.secondary]}
            onPress={follow}
            accessibilityRole="button"
            accessibilityState={{ selected: profile.followedByMe }}>
            <Icon name={profile.followedByMe ? 'check' : 'segui'} size={20} color={profile.followedByMe ? color.paper : color.canvas} strokeWidth={2} />
            <Txt variant="label" tone={profile.followedByMe ? color.paper : color.canvas}>
              {profile.followedByMe ? 'Segui già' : 'Segui'}
            </Txt>
          </Press>
        )}
        {!profile.isMe ? (
          <Press
            style={styles.block}
            scaleTo={1}
            onPress={() => void block()}
            accessibilityRole="button">
            <Icon name="blocca" size={18} color={confirmBlock ? color.matita : color.paperFaint} />
            <Txt variant="meta" tone={confirmBlock ? color.matita : color.paperFaint}>
              {confirmBlock ? `Tocca di nuovo per bloccare @${profile.username}` : `Blocca @${profile.username}`}
            </Txt>
          </Press>
        ) : null}

        {entry ? (
          <View style={styles.contest}>
            <View style={styles.contestHead}>
              <Txt variant="title">{profile.isMe ? 'Il tuo post in gara oggi' : 'In gara oggi'}</Txt>
            </View>
            <TierLadder entry={entry} />
          </View>
        ) : profile.isMe ? (
          <Press style={styles.contestEmpty} onPress={() => router.push('/scatta' as Href)} accessibilityRole="button">
            <Txt variant="label">Oggi non sei in gara.</Txt>
            <Txt variant="small" tone={color.paperDim}>
              Pubblica foto o video e candidali: domani potresti essere tu la copertina.
            </Txt>
          </Press>
        ) : null}
      </View>

      <View style={styles.tabs}>
        <TabButton label={`Post ${posts.length}`} on={tab === 'post'} onPress={() => setTab('post')} />
        {profile.isMe ? <TabButton label={`Salvati ${saved.length}`} on={tab === 'salvati'} onPress={() => setTab('salvati')} /> : null}
      </View>

      {grid.length ? (
        <View style={styles.grid} onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
          {grid.map((p) => (
            <Press
              key={p.id}
              // Tre colonne esatte: la larghezza si calcola, una percentuale più gli spazi andrebbe a capo.
              style={[styles.cell, gridWidth ? { width: (gridWidth - 6 - 6) / 3 } : null]}
              scaleTo={0.98}
              onPress={() => router.push(`/post/${p.id}` as Href)}
              accessibilityRole="link"
              accessibilityLabel={`Post di @${p.author.username}${p.media.length > 1 ? `, ${p.media.length} elementi` : ''}${p.caption ? `: ${p.caption.slice(0, 60)}` : ''}`}>
              <Thumb media={p.media} rounded={6} />
              <View style={styles.views} pointerEvents="none">
                <Icon name="occhio" size={13} color={color.paper} strokeWidth={2} />
                <Txt variant="meta" style={{ fontSize: 11, lineHeight: 13, fontFamily: font.uiBold }}>
                  {formatCount(p.viewCount)}
                </Txt>
              </View>
            </Press>
          ))}
        </View>
      ) : (
        <View style={[styles.pad, { paddingVertical: space[8] }]}>
          <Txt variant="body" tone={color.paperFaint} style={{ textAlign: 'center' }}>
            {tab === 'post' ? (profile.isMe ? 'Il tuo primo post apparirà qui.' : 'Nessun post per ora.') : 'Tocca il segnalibro sotto un post per ritrovarlo qui.'}
          </Txt>
        </View>
      )}

      {profile.isMe && isDemo ? (
        <Press
          style={styles.reset}
          scaleTo={1}
          onPress={async () => {
            if (!confirmReset) return arm(setConfirmReset);
            await resetDemo();
            setMe(null);
          }}
          accessibilityRole="button">
          <Txt variant="meta" tone={confirmReset ? color.matita : color.paperFaint} style={{ fontFamily: font.uiBold }}>
            {confirmReset ? 'Tocca di nuovo per cancellare la demo' : 'Ricomincia la demo da zero'}
          </Txt>
        </Press>
      ) : null}
    </ScrollView>
  );
}

function Stat({ value, label, highlight, onPress }: { value: number; label: string; highlight?: boolean; onPress?: () => void }) {
  const body = (
    <>
      <Txt variant="numeral" tone={highlight ? color.giallo : color.paper} style={{ fontSize: 26, lineHeight: 30 }}>
        {formatCount(value)}
      </Txt>
      <Txt variant="meta" tone={color.paperFaint} numberOfLines={1}>
        {label}
      </Txt>
    </>
  );
  // Follower e seguiti si toccano: si apre l'elenco.
  return onPress ? (
    <Press style={styles.stat} scaleTo={0.97} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${formatCount(value)} ${label}: apri l’elenco`}>
      {body}
    </Press>
  ) : (
    <View style={styles.stat} accessible accessibilityLabel={`${formatCount(value)} ${label}`}>
      {body}
    </View>
  );
}

function TabButton({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Press style={[styles.tab, on && styles.tabOn]} scaleTo={1} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }}>
      <Txt variant="label" tone={on ? color.paper : color.paperFaint}>
        {label}
      </Txt>
    </Press>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.canvas },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.canvas },
  pad: { paddingHorizontal: space[5], gap: space[4] },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  block: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.raised, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[4] },
  stats: { flexDirection: 'row', gap: space[2] },
  stat: { flex: 1, gap: 2, minWidth: 0 },
  viewsLine: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: -space[1] },
  badge: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: color.matita, alignItems: 'center', justifyContent: 'center' },
  verify: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: color.raised, borderRadius: radius.card, padding: space[4], borderWidth: 1, borderColor: color.giallo },
  verifyLate: { borderColor: color.matita },
  views: { position: 'absolute', left: 6, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: color.scrim, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    backgroundColor: color.giallo,
    borderRadius: radius.control,
    paddingVertical: 13,
  },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    backgroundColor: color.raised,
    borderRadius: radius.control,
    paddingVertical: 13,
  },
  contest: { backgroundColor: color.raised, borderRadius: radius.card, padding: space[4], gap: space[3] },
  contestHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  contestEmpty: { borderWidth: 1, borderColor: color.line, borderStyle: 'dashed', borderRadius: radius.card, padding: space[4], gap: 4 },
  tabs: { flexDirection: 'row', gap: space[2], paddingHorizontal: space[5], marginTop: space[6], marginBottom: space[3] },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill },
  tabOn: { backgroundColor: color.raised },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, paddingHorizontal: 3 },
  cell: { width: '32%', aspectRatio: 2 / 3 },
  reset: { alignSelf: 'center', marginTop: space[8], padding: space[3] },
});
