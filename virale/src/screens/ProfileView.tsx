import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
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
import { useSession } from '../state/session';
import type { MyEntry, Post, Profile } from '../types';

export function ProfileView({ username, showBack }: { username: string; showBack?: boolean }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { version, setMe, bump } = useSession();
  const [data, setData] = useState<{ profile: Profile; posts: Post[]; saved: Post[]; entry: MyEntry | null } | null>(null);
  const [tab, setTab] = useState<'post' | 'salvati'>('post');
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const toast = useToast();

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

  if (error) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Txt variant="title">{error}</Txt>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color.giallo} />
      </View>
    );
  }

  const { profile, posts, saved, entry } = data;
  const grid = tab === 'post' ? posts : saved;

  const follow = () => {
    const on = !profile.followedByMe;
    haptic('light');
    setData({ ...data, profile: { ...profile, followedByMe: on, followers: profile.followers + (on ? 1 : -1) } });
    void toggleFollow(profile.id, on);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + space[3], paddingBottom: space[12] }}>
      <View style={styles.pad}>
        <View style={styles.topRow}>
          {showBack ? (
            <Press style={styles.back} onPress={() => router.back()} accessibilityLabel="Indietro">
              <Icon name="indietro" />
            </Press>
          ) : (
            <View />
          )}
          {profile.isMe ? (
            <Press style={styles.back} onPress={() => router.push('/impostazioni' as Href)} accessibilityLabel="Impostazioni">
              <Icon name="impostazioni" />
            </Press>
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

        <View style={styles.stats}>
          <Stat value={profile.followers} label="follower" />
          <Stat value={profile.following} label="seguiti" />
          <Stat value={profile.covers} label={profile.covers === 1 ? 'copertina' : 'copertine'} highlight={profile.covers > 0} />
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
            onPress={async () => {
              if (!confirmBlock) return setConfirmBlock(true);
              await blockUser(profile.id);
              bump();
              toast(`@${profile.username} è bloccato.`);
              router.back();
            }}
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
        <View style={styles.grid}>
          {grid.map((p) => (
            <Press key={p.id} style={styles.cell} scaleTo={0.98} onPress={() => router.push(`/post/${p.id}` as Href)} accessibilityRole="link">
              <Thumb media={p.media} rounded={6} />
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
            if (!confirmReset) return setConfirmReset(true);
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

function Stat({ value, label, highlight }: { value: number; label: string; highlight?: boolean }) {
  return (
    <View style={styles.stat}>
      <Txt variant="numeral" tone={highlight ? color.giallo : color.paper} style={{ fontSize: 30, lineHeight: 34 }}>
        {formatCount(value)}
      </Txt>
      <Txt variant="meta" tone={color.paperFaint}>
        {label}
      </Txt>
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
  stat: { flex: 1, gap: 2 },
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
  cell: { width: '32.9%', aspectRatio: 2 / 3 },
  reset: { alignSelf: 'center', marginTop: space[8], padding: space[3] },
});
