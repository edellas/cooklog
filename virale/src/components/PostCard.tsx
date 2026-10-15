import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { formatCount, timeAgo } from '../design/format';
import { color, radius, space } from '../design/tokens';
import { registerShare, TIER_NAMES, toggleFollow, toggleLike, toggleSave } from '../services/api';
import type { Post } from '../types';
import { Icon } from './Icon';
import { MediaFrame, type VideoProgress } from './MediaFrame';
import { Monogram } from './Monogram';
import { haptic, Press } from './Press';
import { Txt } from './Txt';

export type Interaction = 'liked' | 'commented' | 'saved' | 'shared';

/**
 * Un post come una stampa sul tavolo luminoso: la cornice con foto e video in alto,
 * sotto la striscia con autore, didascalia e azioni in riga (non una colonna di icone sopra il video).
 */
export function PostCard({
  post: initial,
  active,
  muted,
  onToggleMute,
  meId,
  onInteract,
  onVideoProgress,
}: {
  post: Post;
  active: boolean;
  muted: boolean;
  onToggleMute: () => void;
  meId?: string;
  onInteract?: (kind: Interaction) => void;
  onVideoProgress?: (p: VideoProgress) => void;
}) {
  const router = useRouter();
  const [post, setPost] = useState(initial);
  const [following, setFollowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const like = (on: boolean) => {
    if (post.likedByMe === on) return;
    haptic('light');
    setPost((p) => ({ ...p, likedByMe: on, likeCount: p.likeCount + (on ? 1 : -1) }));
    if (on) onInteract?.('liked');
    void toggleLike(post.id, on).catch(() => setPost((p) => ({ ...p, likedByMe: !on, likeCount: p.likeCount + (on ? -1 : 1) })));
  };
  const save = () => {
    const on = !post.savedByMe;
    setPost((p) => ({ ...p, savedByMe: on, saveCount: p.saveCount + (on ? 1 : -1) }));
    if (on) onInteract?.('saved');
    void toggleSave(post.id, on);
  };
  const share = async () => {
    try {
      await Share.share({ message: `@${post.author.username} su Virale: “${post.caption}”` });
    } catch {
      // Il foglio di condivisione può non esistere (web): la condivisione conta comunque come intenzione.
    }
    onInteract?.('shared');
    setPost((p) => ({ ...p, shareCount: p.shareCount + 1 }));
    void registerShare(post.id);
  };
  const follow = () => {
    setFollowing(true);
    haptic('light');
    void toggleFollow(post.author.id, true);
  };

  const isMine = post.author.id === meId;
  const contest = post.contest;

  return (
    <View style={styles.card}>
      <View style={styles.frameWrap}>
        <MediaFrame
          media={post.media}
          active={active}
          muted={muted}
          onToggleMute={onToggleMute}
          onDoubleTap={() => like(true)}
          onVideoProgress={onVideoProgress}
          overlay={
            contest && contest.status !== 'disqualified' ? (
              <View style={styles.stamp} pointerEvents="none">
                <Txt variant="meta" tone={color.canvas} style={styles.stampText}>
                  In gara · {TIER_NAMES[contest.status === 'finalist' ? TIER_NAMES.length - 1 : contest.tier]}
                </Txt>
              </View>
            ) : null
          }
        />
      </View>

      <View style={styles.strip}>
        <View style={styles.authorRow}>
          <Press style={styles.author} onPress={() => router.push(`/utente/${post.author.username}` as Href)} accessibilityRole="link">
            <Monogram name={post.author.displayName} seed={post.author.username} size={34} />
            <View style={{ flexShrink: 1 }}>
              <Txt variant="label" numberOfLines={1}>
                {post.author.displayName}
              </Txt>
              <Txt variant="meta" tone={color.paperFaint} numberOfLines={1}>
                @{post.author.username} · {timeAgo(post.createdAt)}
              </Txt>
            </View>
          </Press>
          {!isMine && !following ? (
            <Press style={styles.follow} onPress={follow} accessibilityRole="button" accessibilityLabel={`Segui ${post.author.username}`}>
              <Txt variant="meta" style={{ fontFamily: 'SchibstedGrotesk_700Bold' }}>
                Segui
              </Txt>
            </Press>
          ) : null}
        </View>

        {post.caption ? (
          <Press scaleTo={1} onPress={() => setExpanded((e) => !e)} accessibilityHint="Mostra tutta la didascalia">
            <Txt variant="small" tone={color.paperDim} numberOfLines={expanded ? undefined : 2}>
              {post.caption}
            </Txt>
          </Press>
        ) : null}

        <View style={styles.actions}>
          <Action
            icon="cerchia"
            label={formatCount(post.likeCount)}
            on={post.likedByMe}
            tone={color.matita}
            onPress={() => like(!post.likedByMe)}
            a11y={post.likedByMe ? 'Togli il cerchio' : 'Cerchia: mi piace'}
          />
          <Action
            icon="commento"
            label={formatCount(post.commentCount)}
            onPress={() => {
              onInteract?.('commented');
              router.push(`/commenti/${post.id}` as Href);
            }}
            a11y="Commenti"
          />
          <Action icon="salva" label={formatCount(post.saveCount)} on={post.savedByMe} tone={color.giallo} filled onPress={save} a11y={post.savedByMe ? 'Togli dai salvati' : 'Salva'} />
          <Action icon="condividi" label={formatCount(post.shareCount)} onPress={() => void share()} a11y="Condividi" />
          <Press
            style={styles.more}
            onPress={() => router.push(`/azioni/${post.id}` as Href)}
            accessibilityRole="button"
            accessibilityLabel={isMine ? 'Opzioni del post' : 'Segnala o blocca'}>
            <Icon name="altro" size={22} color={color.paperDim} />
          </Press>
        </View>
      </View>
    </View>
  );
}

function Action({
  icon,
  label,
  on,
  tone,
  filled,
  onPress,
  a11y,
}: {
  icon: 'cerchia' | 'commento' | 'salva' | 'condividi';
  label: string;
  on?: boolean;
  tone?: string;
  filled?: boolean;
  onPress: () => void;
  a11y: string;
}) {
  const c = on && tone ? tone : color.paper;
  return (
    <Press style={styles.action} onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ selected: !!on }}>
      <Icon name={icon} size={24} color={c} strokeWidth={on ? 2.4 : 1.75} filled={filled && on} />
      <Txt variant="meta" tone={on && tone ? tone : color.paperDim}>
        {label}
      </Txt>
    </Press>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, paddingHorizontal: space[3], paddingTop: space[2], paddingBottom: space[3], gap: space[3] },
  frameWrap: { flex: 1 },
  stamp: {
    position: 'absolute',
    left: 12,
    bottom: 14,
    backgroundColor: color.giallo,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    transform: [{ rotate: '-2deg' }],
  },
  stampText: { fontFamily: 'SchibstedGrotesk_700Bold' },
  strip: { gap: space[2], paddingHorizontal: space[1] },
  authorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  author: { flexDirection: 'row', alignItems: 'center', gap: space[3], flexShrink: 1 },
  follow: {
    borderWidth: 1,
    borderColor: color.paper,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space[5], marginTop: space[1] },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  more: { marginLeft: 'auto', minHeight: 32, minWidth: 32, alignItems: 'center', justifyContent: 'center' },
});
