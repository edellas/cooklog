import { FeedActionButton } from '@/src/components/FeedActionButton';
import type { FoodPost } from '@/src/types';
import { Image } from 'expo-image';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

export function FoodPostCard({
  post,
  screenHeight,
  onToggleLike,
  onToggleSave,
  onOpenRecipe,
  onOpenComments,
}: {
  post: FoodPost;
  screenHeight: number;
  onToggleLike: () => void;
  onToggleSave: () => void;
  onOpenRecipe: () => void;
  onOpenComments: () => void;
}) {
  const onShare = async () => {
    await Share.share({
      message: `Guarda questa ricetta su Cooklog: ${post.title}\nCategoria: ${post.category}`,
    });
  };

  return (
    <View style={[styles.container, { height: screenHeight }]}>
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

        <Pressable onPress={onOpenRecipe} style={styles.recipeButton}>
          <Text style={styles.recipeButtonLabel}>Vedi ricetta</Text>
        </Pressable>
      </View>

      <View style={styles.actions}>
        <FeedActionButton
          icon={post.isLikedByCurrentUser ? 'heart.fill' : 'heart'}
          label={`${post.likeCount}`}
          onPress={onToggleLike}
          active={post.isLikedByCurrentUser}
        />
        <FeedActionButton
          icon="book.fill"
          label={`${post.saveCount}`}
          onPress={onToggleSave}
          active={post.isSavedByCurrentUser}
        />
        <FeedActionButton icon="plus.circle.fill" label={`${post.commentCount}`} onPress={onOpenComments} />
        <FeedActionButton icon="square.and.arrow.up" label="Condividi" onPress={onShare} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', backgroundColor: '#000' },
  image: { ...StyleSheet.absoluteFillObject },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  meta: {
    position: 'absolute',
    left: 16,
    right: 88,
    bottom: 38,
    gap: 8,
  },
  author: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: '700' },
  description: { color: 'rgba(255,255,255,0.92)', fontSize: 14, lineHeight: 20 },
  info: { color: 'rgba(255,255,255,0.84)', fontSize: 13 },
  recipeButton: {
    marginTop: 6,
    alignSelf: 'flex-start',
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  recipeButtonLabel: { color: '#1B4332', fontWeight: '700', fontSize: 14 },
  actions: {
    position: 'absolute',
    right: 12,
    bottom: 56,
    gap: 14,
  },
});
