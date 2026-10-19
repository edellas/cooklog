import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View, type NativeScrollEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../components/Icon';
import { Avatar } from '../components/Avatar';
import { haptic, Press } from '../components/Press';
import { Thumb } from '../components/Thumb';
import { TierLadder } from '../components/TierLadder';
import { Txt } from '../components/Txt';
import { formatCount } from '../design/format';
import { color, font, radius, space } from '../design/tokens';
import { blockUser, getProfile, getProfilePosts, isDemo, resetDemo, toggleFollow } from '../services/api';
import { useToast } from '../components/Toast';
import { seedFeed } from '../state/feedSeed';
import { useNav } from '../state/nav';
import { emitFollowChange } from '../state/postEvents';
import { useActGuard } from '../state/useActGuard';
import { useSession } from '../state/session';
import { useGoBack } from '../state/useGoBack';
import type { MyEntry, Post, Profile } from '../types';
import { actionError, friendlyError } from '../services/errors';

export function ProfileView({ username, showBack }: { username: string; showBack?: boolean }) {
  const insets = useSafeAreaInsets();
  const nav = useNav();
  const canAct = useActGuard();
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

  const [refreshing, setRefreshing] = useState(false);
  const reload = useCallback(
    () =>
      getProfile(username)
        .then((d) => {
          // Le pagine già caricate più in basso restano (tornando da un post la griglia non si accorcia):
          // si aggiorna la prima pagina e si tengono le altre che esistono ancora.
          setData((prev) => {
            if (!prev || prev.profile.id !== d.profile.id) return d;
            const merge = (first: Post[], old: Post[]) => {
              const last = first.at(-1)?.cursor;
              const have = new Set(first.map((x) => x.id));
              return [...first, ...old.filter((x) => !have.has(x.id) && last !== undefined && x.cursor !== undefined && x.cursor < last)];
            };
            return { ...d, posts: merge(d.posts, prev.posts), saved: merge(d.saved, prev.saved) };
          });
          setError(null);
        })
        .catch((e: unknown) => setError(friendlyError(e))),
    [username],
  );
  useFocusEffect(
    useCallback(() => {
      void version; // ricarica quando altrove cambia qualcosa (nuovo post, nuova copertina)
      void reload();
    }, [reload, version]),
  );

  // Griglia a pagine: arrivati quasi in fondo si caricano altri 30 post (o salvati).
  const loadingMore = useRef(false);
  /** Per ogni scheda: finita (l'ultima pagina è arrivata vuota). */
  const more = useRef({ post: false, salvati: false });
  const loadMore = () => {
    if (!data || loadingMore.current || more.current[tab]) return;
    const list = tab === 'post' ? data.posts : data.saved;
    const total = tab === 'post' ? data.profile.postCount : data.profile.savedCount;
    const last = list.at(-1)?.cursor;
    if (!last || list.length >= total) return;
    loadingMore.current = true;
    getProfilePosts(username, tab === 'post' ? 'posts' : 'saved', last)
      .then((page) => {
        if (!page.length) more.current[tab] = true;
        setData((d) => {
          if (!d) return d;
          const key = tab === 'post' ? 'posts' : 'saved';
          const have = new Set(d[key].map((x) => x.id));
          return { ...d, [key]: [...d[key], ...page.filter((x) => !have.has(x.id))] };
        });
      })
      .catch(() => undefined)
      .finally(() => {
        loadingMore.current = false;
      });
  };
  const onScroll = ({ nativeEvent: e }: { nativeEvent: NativeScrollEvent }) => {
    if (e.layoutMeasurement.height + e.contentOffset.y >= e.contentSize.height - 600) loadMore();
  };

  // Un errore nell'aggiornamento non nasconde un profilo già caricato.
  if (!data) {
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
    if (on && !canAct()) return;
    haptic('light');
    setData({ ...data, profile: { ...profile, followedByMe: on, followers: Math.max(0, profile.followers + (on ? 1 : -1)) } });
    emitFollowChange(profile.id, on);
    toggleFollow(profile.id, on).catch((e: unknown) => {
      setData((d) => (d ? { ...d, profile: { ...d.profile, followedByMe: !on, followers: profile.followers } } : d));
      emitFollowChange(profile.id, !on);
      toast(
        actionError(e, on ? `Non è stato possibile seguire @${profile.username}. Riprova.` : `Non è stato possibile smettere di seguire @${profile.username}. Riprova.`),
        'error',
      );
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
      toast(friendlyError(e), 'error');
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingTop: insets.top + space[3], paddingBottom: space[12] }}
      onScroll={onScroll}
      scrollEventThrottle={200}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void reload().finally(() => setRefreshing(false));
          }}
          tintColor={color.giallo}
          colors={[color.giallo]}
          progressBackgroundColor={color.raised}
          progressViewOffset={insets.top}
        />
      }>
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
              <Press style={styles.back} onPress={() => nav.push('/cerca')} accessibilityRole="button" accessibilityLabel="Cerca persone">
                <Icon name="cerca" />
              </Press>
              <Press
                style={styles.back}
                onPress={() => nav.push('/notifiche')}
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
              <Press style={styles.back} onPress={() => nav.push('/impostazioni')} accessibilityRole="button" accessibilityLabel="Impostazioni">
                <Icon name="impostazioni" />
              </Press>
            </View>
          ) : null}
        </View>

        <View style={styles.head}>
          <Avatar name={profile.displayName} seed={profile.username} uri={profile.avatar} size={76} />
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

        {profile.isMe && status?.needsPassword ? (
          <Press style={[styles.verify, styles.verifyLate]} onPress={() => nav.push('/impostazioni')} accessibilityRole="button">
            <Icon name="chiave" size={22} color={color.matita} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="label">Imposta una password</Txt>
              <Txt variant="small" tone={color.paperDim}>
                Senza password non potrai rientrare nel tuo account. Tocca per impostarla.
              </Txt>
            </View>
          </Press>
        ) : null}

        {profile.isMe && status?.identity && status.identity.status !== 'approved' ? (
          <Press style={[styles.verify, !status.identity.canAct && styles.verifyLate]} onPress={() => nav.push('/verifica')} accessibilityRole="button">
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
          <Stat value={profile.followers} label="follower" onPress={() => nav.push(`/seguaci/${profile.username}?tipo=followers`)} />
          <Stat value={profile.following} label="seguiti" onPress={() => nav.push(`/seguaci/${profile.username}?tipo=following`)} />
          <Stat value={profile.covers} label={profile.covers === 1 ? 'copertina' : 'copertine'} highlight={profile.covers > 0} />
        </View>
        <View style={styles.viewsLine} accessible accessibilityLabel={`${formatCount(profile.views)} visualizzazioni dei post`}>
          <Icon name="occhio" size={18} color={color.paperFaint} />
          <Txt variant="small" tone={color.paperDim}>
            {formatCount(profile.views)} {profile.views === 1 ? 'visualizzazione' : 'visualizzazioni'} dei post
          </Txt>
        </View>

        {profile.isMe ? (
          <View style={styles.meButtons}>
            <Press style={[styles.primary, { flex: 1.4 }]} onPress={() => nav.push('/modifica-profilo')} accessibilityRole="button">
              <Txt variant="label" tone={color.canvas}>
                Modifica profilo
              </Txt>
            </Press>
            <Press style={[styles.secondary, { flex: 1 }]} onPress={() => nav.push('/regole')} accessibilityRole="button">
              <Icon name="info" size={20} />
              <Txt variant="label" numberOfLines={1}>
                Come si sceglie
              </Txt>
            </Press>
          </View>
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
          <View style={styles.safety}>
            <Press style={styles.block} scaleTo={1} onPress={() => nav.push(`/segnala-profilo/${profile.username}`)} accessibilityRole="button">
              <Icon name="segnala" size={18} color={color.paperFaint} />
              <Txt variant="meta" tone={color.paperFaint}>
                {`Segnala @${profile.username}`}
              </Txt>
            </Press>
            <Press style={styles.block} scaleTo={1} onPress={() => void block()} accessibilityRole="button">
              <Icon name="blocca" size={18} color={confirmBlock ? color.matita : color.paperFaint} />
              <Txt variant="meta" tone={confirmBlock ? color.matita : color.paperFaint}>
                {confirmBlock ? `Tocca di nuovo per bloccare @${profile.username}` : `Blocca @${profile.username}`}
              </Txt>
            </Press>
          </View>
        ) : null}

        {entry && !entry.postId ? (
          <View style={styles.contestEmpty}>
            <Txt variant="label">Oggi hai ritirato la candidatura.</Txt>
            <Txt variant="small" tone={color.paperDim}>
              Il post in gara è stato eliminato. Si partecipa con un post al giorno: potrai candidarne un altro domani.
            </Txt>
          </View>
        ) : entry ? (
          <View style={styles.contest}>
            <View style={styles.contestHead}>
              <Txt variant="title">{profile.isMe ? 'Il tuo post in gara oggi' : 'In gara oggi'}</Txt>
            </View>
            <TierLadder entry={entry} />
          </View>
        ) : null}
        {!entry && profile.isMe ? (
          <Press style={styles.contestEmpty} onPress={() => nav.push('/scatta')} accessibilityRole="button">
            <Txt variant="label">Oggi non sei in gara.</Txt>
            <Txt variant="small" tone={color.paperDim}>
              Pubblica foto o video e candidali: domani potresti essere tu la copertina.
            </Txt>
          </Press>
        ) : null}
      </View>

      <View style={styles.tabs}>
        <TabButton label={`Post ${profile.postCount}`} on={tab === 'post'} onPress={() => setTab('post')} />
        {profile.isMe ? <TabButton label={`Salvati ${profile.savedCount}`} on={tab === 'salvati'} onPress={() => setTab('salvati')} /> : null}
      </View>

      {grid.length ? (
        <View style={styles.grid} onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
          {grid.map((p) => (
            <Press
              key={p.id}
              // Tre colonne esatte: la larghezza si calcola, una percentuale più gli spazi andrebbe a capo.
              style={[styles.cell, gridWidth ? { width: (gridWidth - 6 - 6) / 3 } : null]}
              scaleTo={0.98}
              onPress={() => {
                // Come su TikTok: dal post toccato si scorrono tutti gli altri della griglia.
                const kind = tab === 'post' ? 'posts' : 'saved';
                seedFeed(profile.username, kind, grid);
                nav.push(`/scorri/${profile.username}?da=${p.id}&tipo=${kind}`);
              }}
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
  meButtons: { flexDirection: 'row', gap: space[2] },
  safety: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: space[5] },
  block: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44 },
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
