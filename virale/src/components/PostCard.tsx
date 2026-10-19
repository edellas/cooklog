import { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { formatCount, timeAgo } from '../design/format';
import { color, radius, space } from '../design/tokens';
import { postLink, registerShare, TIER_NAMES, toggleFollow, toggleLike, toggleSave } from '../services/api';
import { actionError } from '../services/errors';
import { shareText } from '../services/share';
import { useNav } from '../state/nav';
import { emitFollowChange, emitPostChange, onFollowChange, onPostChange, withRecentChanges } from '../state/postEvents';
import { useActGuard } from '../state/useActGuard';
import { toggleMute, useMuted } from '../state/sound';
import type { Post } from '../types';
import { Icon } from './Icon';
import { MediaFrame, type VideoProgress } from './MediaFrame';
import { Avatar } from './Avatar';
import { haptic, Press } from './Press';
import { useToast } from './Toast';
import { Txt } from './Txt';

export type Interaction = 'liked' | 'commented' | 'saved' | 'shared';

/**
 * Un post come una stampa sul tavolo luminoso: la cornice con foto e video in alto,
 * sotto la striscia con autore, didascalia e azioni in riga (non una colonna di icone sopra il video).
 * `blind` (In gara): niente numeri di mi piace, salvataggi, condivisioni e visualizzazioni, così si vota guardando il post e non
 * seguendo chi è già avanti.
 */
export const PostCard = memo(function PostCard({
  post: initial,
  active,
  meId,
  onInteract,
  onVideoProgress,
  viewKey,
  blind,
}: {
  post: Post;
  active: boolean;
  meId?: string;
  onInteract?: (postId: string, kind: Interaction) => void;
  onVideoProgress?: (postId: string, p: VideoProgress) => void;
  viewKey?: number;
  blind?: boolean;
}) {
  const nav = useNav();
  const toast = useToast();
  const canAct = useActGuard();
  const muted = useMuted();
  const [post, setPost] = useState(() => withRecentChanges(initial));
  const [following, setFollowing] = useState(() => withRecentChanges(initial).followingAuthor);
  const [expanded, setExpanded] = useState(false);

  // Se arriva una versione nuova del post (ricaricata), la si mostra, con i cambiamenti appena fatti.
  useEffect(() => {
    const next = withRecentChanges(initial);
    setPost(next);
    setFollowing(next.followingAuthor);
  }, [initial]);

  // Cambiamenti fatti altrove: un commento scritto, un mi piace sulla copertina, un "segui" dal profilo.
  useEffect(
    () =>
      onPostChange(initial.id, ({ commented, ...patch }) => {
        setPost((p) => ({ ...p, ...patch }));
        if (commented) onInteract?.(initial.id, 'commented');
      }),
    [initial.id, onInteract],
  );
  useEffect(
    () =>
      onFollowChange(({ authorId, following: on }) => {
        if (authorId === initial.author.id) setFollowing(on);
      }),
    [initial.author.id],
  );

  const like = (on: boolean) => {
    if (post.likedByMe === on) return;
    if (on && !canAct()) return;
    haptic('light');
    const likeCount = Math.max(0, post.likeCount + (on ? 1 : -1));
    setPost((p) => ({ ...p, likedByMe: on, likeCount }));
    emitPostChange(post.id, { likedByMe: on, likeCount });
    if (on) onInteract?.(post.id, 'liked');
    toggleLike(post.id, on).catch((e: unknown) => {
      const back = { likedByMe: !on, likeCount: post.likeCount };
      setPost((p) => ({ ...p, ...back }));
      emitPostChange(post.id, back);
      toast(actionError(e, 'Cerchio non salvato. Riprova.'), 'error');
    });
  };
  const save = () => {
    const on = !post.savedByMe;
    if (on && !canAct()) return;
    const saveCount = Math.max(0, post.saveCount + (on ? 1 : -1));
    setPost((p) => ({ ...p, savedByMe: on, saveCount }));
    emitPostChange(post.id, { savedByMe: on, saveCount });
    if (on) onInteract?.(post.id, 'saved');
    toggleSave(post.id, on).catch((e: unknown) => {
      const back = { savedByMe: !on, saveCount: post.saveCount };
      setPost((p) => ({ ...p, ...back }));
      emitPostChange(post.id, back);
      toast(actionError(e, 'Salvataggio non riuscito. Riprova.'), 'error');
    });
  };
  const share = async () => {
    if (!canAct()) return;
    const text = post.caption ? `@${post.author.username} su Virale: “${post.caption}”` : `Guarda il post di @${post.author.username} su Virale`;
    const link = postLink(post.id);
    const res = await shareText(link ? `${text}\n${link}` : text);
    if (res === 'none') return;
    if (res === 'copied') toast(link ? 'Link copiato: incollalo dove vuoi.' : 'Testo copiato: incollalo dove vuoi.');
    onInteract?.(post.id, 'shared');
    registerShare(post.id)
      .then((first) => {
        if (first) setPost((p) => ({ ...p, shareCount: p.shareCount + 1 }));
      })
      .catch(() => undefined);
  };
  const follow = () => {
    if (!canAct()) return;
    setFollowing(true);
    emitFollowChange(post.author.id, true);
    haptic('light');
    toggleFollow(post.author.id, true).catch((e: unknown) => {
      setFollowing(false);
      emitFollowChange(post.author.id, false);
      toast(actionError(e, `Non è stato possibile seguire @${post.author.username}. Riprova.`), 'error');
    });
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
          onToggleMute={toggleMute}
          onDoubleTap={() => like(true)}
          onLongPress={() => nav.push(`/azioni/${post.id}`)}
          onVideoProgress={onVideoProgress ? (p) => onVideoProgress(post.id, p) : undefined}
          viewKey={viewKey}
          overlay={
            contest && contest.status !== 'disqualified' ? (
              <View style={styles.stamp} pointerEvents="none">
                <Txt variant="meta" tone={color.canvas} style={styles.stampText}>
                  {contest.tier === null
                    ? 'In gara'
                    : `In gara · ${TIER_NAMES[contest.status === 'finalist' ? TIER_NAMES.length - 1 : contest.tier]}`}
                </Txt>
              </View>
            ) : null
          }
        />
      </View>

      <View style={styles.strip}>
        <View style={styles.authorRow}>
          <Press
            style={styles.author}
            onPress={() => nav.push(`/utente/${post.author.username}`)}
            accessibilityRole="link"
            accessibilityLabel={`Profilo di ${post.author.displayName}, @${post.author.username}`}>
            <Avatar name={post.author.displayName} seed={post.author.username} uri={post.author.avatar} size={34} />
            <View style={{ flexShrink: 1 }}>
              <Txt variant="label" numberOfLines={1}>
                {post.author.displayName}
              </Txt>
              <Txt variant="meta" tone={color.paperFaint} numberOfLines={1}>
                @{post.author.username} · {timeAgo(post.createdAt)}
                {blind ? '' : ` · ${formatCount(post.viewCount)} ${post.viewCount === 1 ? 'visualizzazione' : 'visualizzazioni'}`}
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
            label={blind ? '' : formatCount(post.likeCount)}
            on={post.likedByMe}
            pop
            tone={color.matita}
            onPress={() => like(!post.likedByMe)}
            a11y={post.likedByMe ? 'Togli il cerchio' : 'Cerchia: mi piace'}
          />
          <Action
            icon="commento"
            label={formatCount(post.commentCount)}
            onPress={() => nav.push(`/commenti/${post.id}`)}
            a11y="Commenti"
          />
          <Action icon="salva" label={blind ? '' : formatCount(post.saveCount)} on={post.savedByMe} tone={color.giallo} filled onPress={save} a11y={post.savedByMe ? 'Togli dai salvati' : 'Salva'} />
          <Action icon="condividi" label={blind ? '' : formatCount(post.shareCount)} onPress={() => void share()} a11y="Condividi" />
          <Press
            style={styles.more}
            onPress={() => nav.push(`/azioni/${post.id}`)}
            accessibilityRole="button"
            accessibilityLabel={isMine ? 'Opzioni del post' : 'Segnala o blocca'}>
            <Icon name="altro" size={22} color={color.paperDim} />
          </Press>
        </View>
      </View>
    </View>
  );
});

function Action({
  icon,
  label,
  on,
  tone,
  filled,
  pop,
  onPress,
  a11y,
}: {
  icon: 'cerchia' | 'commento' | 'salva' | 'condividi';
  label: string;
  on?: boolean;
  tone?: string;
  filled?: boolean;
  /** Piccolo salto dell'icona quando si accende (il mi piace, anche dal doppio tocco). */
  pop?: boolean;
  onPress: () => void;
  a11y: string;
}) {
  const c = on && tone ? tone : color.paper;
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const was = useRef(on);
  useEffect(() => {
    if (pop && on && !was.current && !reduced) scale.set(withSequence(withTiming(1.35, { duration: 110 }), withSpring(1, { damping: 9, stiffness: 260 })));
    was.current = on;
  }, [on, pop, reduced, scale]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <Press style={styles.action} onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ selected: !!on }}>
      <Animated.View style={iconStyle}>
        <Icon name={icon} size={24} color={c} strokeWidth={on ? 2.4 : 1.75} filled={filled && on} />
      </Animated.View>
      {label ? (
        <Txt variant="meta" tone={on && tone ? tone : color.paperDim}>
          {label}
        </Txt>
      ) : null}
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
