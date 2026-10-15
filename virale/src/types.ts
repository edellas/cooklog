import type { EntryStatus } from './engine/engine';

export type MediaType = 'video' | 'image' | 'text';

export type Post = {
  id: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  mediaType: MediaType;
  /** URL del video o della foto; null per i post di solo testo. */
  mediaUrl: string | null;
  body: string | null;
  caption: string;
  /** Uno o due colori separati da virgola, usati come sfondo dei post di testo. */
  background: string;
  createdAt: string;
};

export type ArenaCard = { entryId: string; tier: number; post: Post };

export type DailyViral = {
  featuredOn: string;
  contestDay: string;
  totalEntries: number;
  totalViews: number;
  post: Post;
};

export type MyEntry = {
  entryId: string;
  postId: string;
  tier: number;
  status: EntryStatus;
  views: number;
  contestDay: string;
};

export type Me = { id: string; username: string; displayName: string };

export type NewPost = {
  mediaType: MediaType;
  localUri?: string;
  mimeType?: string;
  body?: string;
  caption: string;
  background: string;
  joinArena: boolean;
};
