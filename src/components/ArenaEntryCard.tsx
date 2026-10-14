import { IconSymbol } from '@/components/ui/icon-symbol';
import { CooklogColors } from '@/constants/cooklogTheme';
import type { ArenaCard } from '@/src/services/viralService';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export type ArenaInteractions = { liked: boolean; saved: boolean; shared: boolean; reported: boolean };

export function ArenaEntryCard({
  card,
  height,
  interactions,
  onToggleLike,
  onToggleSave,
  onShare,
  onReport,
}: {
  card: ArenaCard;
  height: number;
  interactions: ArenaInteractions;
  onToggleLike: () => void;
  onToggleSave: () => void;
  onShare: () => void;
  onReport: () => void;
}) {
  const { post } = card;
  return (
    <View style={[styles.container, { height }]}>
      <Image source={{ uri: post.mediaUrl }} style={styles.image} contentFit="cover" />
      <View style={styles.overlay} />

      <View style={styles.meta}>
        <Text style={styles.author}>@{post.authorName}</Text>
        <Text style={styles.title}>{post.title}</Text>
        <Text style={styles.description} numberOfLines={3}>
          {post.description}
        </Text>
        <Text style={styles.info}>
          {post.category} · {post.cookingTimeMinutes} min · {post.servings} porzioni
        </Text>
      </View>

      <View style={styles.actions}>
        <Action icon={interactions.liked ? 'heart.fill' : 'heart'} label="Mi piace" active={interactions.liked} onPress={onToggleLike} />
        <Action icon="book.fill" label="Salva" active={interactions.saved} onPress={onToggleSave} />
        <Action icon="square.and.arrow.up" label="Condividi" active={interactions.shared} onPress={onShare} />
        <Action icon="flag.fill" label="Segnala" active={interactions.reported} onPress={onReport} />
      </View>
    </View>
  );
}

function Action({
  icon,
  label,
  active,
  onPress,
}: {
  icon: 'heart' | 'heart.fill' | 'book.fill' | 'square.and.arrow.up' | 'flag.fill';
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.actionWrap} accessibilityLabel={label}>
      <View style={[styles.iconWrap, active && styles.activeWrap]}>
        <IconSymbol name={icon} color={active ? CooklogColors.favorite : '#FFFFFF'} size={22} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', backgroundColor: '#000' },
  image: { ...StyleSheet.absoluteFillObject },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.34)' },
  meta: { position: 'absolute', left: 16, right: 88, bottom: 38, gap: 8 },
  author: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: '700' },
  description: { color: 'rgba(255,255,255,0.92)', fontSize: 14, lineHeight: 20 },
  info: { color: 'rgba(255,255,255,0.84)', fontSize: 13 },
  actions: { position: 'absolute', right: 12, bottom: 56, gap: 14 },
  actionWrap: { alignItems: 'center', gap: 4 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  activeWrap: { backgroundColor: 'rgba(255,255,255,0.92)' },
  actionLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
});
