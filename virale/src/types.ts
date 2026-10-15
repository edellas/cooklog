import type { EntryStatus } from './engine/engine';

/** Un elemento di un post: foto o video. `src` è un URL o, in demo, una chiave `demo:<nome>`. */
export type MediaItem = {
  kind: 'image' | 'video';
  src: string;
  width: number;
  height: number;
  durationMs?: number;
};

export type Author = {
  id: string;
  username: string;
  displayName: string;
};

/** Un post: da 1 a 10 foto e/o video, come su TikTok. */
export type Post = {
  id: string;
  author: Author;
  media: MediaItem[];
  caption: string;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  saveCount: number;
  shareCount: number;
  likedByMe: boolean;
  savedByMe: boolean;
  /** Se il post è in gara oggi: il suo livello. */
  contest?: { entryId: string; tier: number; status: EntryStatus };
};

export type FeedCard = Post & { entryId?: string };

export type Comment = {
  id: string;
  postId: string;
  author: Author;
  body: string;
  createdAt: string;
};

export type Profile = Author & {
  bio: string;
  followers: number;
  following: number;
  covers: number;
  followedByMe: boolean;
  isMe: boolean;
  isModerator: boolean;
};

/** La copertina: il post vincitore di un giorno, visto da tutti il giorno dopo. */
export type Cover = {
  featuredOn: string;
  issue: number;
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

export type Me = Author;

export type DraftMedia = { uri: string; kind: 'image' | 'video'; width: number; height: number; durationMs?: number; mimeType?: string };

export type NewPost = { media: DraftMedia[]; caption: string; joinContest: boolean };
