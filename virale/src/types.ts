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
  /** Visualizzazioni: una per persona al giorno. */
  viewCount: number;
  likedByMe: boolean;
  savedByMe: boolean;
  /** Segui già l'autore. */
  followingAuthor: boolean;
  /** Se il post è in gara oggi: il suo livello. */
  contest?: { entryId: string; tier: number; status: EntryStatus };
  /** Segnaposto per caricare la pagina successiva di un elenco (data del post o del salvataggio). */
  cursor?: string;
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
  /** Visualizzazioni totali dei suoi post. */
  views: number;
  /** Quanti post e salvati ha in tutto (la griglia li carica a pagine). */
  postCount: number;
  savedCount: number;
  followedByMe: boolean;
  isMe: boolean;
  isModerator: boolean;
  isAdmin: boolean;
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

export type RegisterInput = {
  username: string;
  firstName: string;
  lastName: string;
  /** AAAA-MM-GG */
  birthDate: string;
  password: string;
  acceptedTerms: boolean;
};

export type IdentityStatus = 'missing' | 'pending' | 'approved' | 'rejected';

/** idProvider: come si verifica l'età, 'manual' (foto all'amministratore) o 'didit' (verifica automatica). */
export type Settings = { revealMinutes: number; idGraceDays: number; cutoffHour: number; idProvider: 'manual' | 'didit' };

/** Lo stato dell'utente che serve all'app: verifica dell'età, ruoli, notifiche non lette, impostazioni. */
export type Status = {
  identity: { status: IdentityStatus; deadline: string; reason: string | null; canAct: boolean } | null;
  isModerator: boolean;
  isAdmin: boolean;
  /** Account chiuso dalla moderazione o perché minore dell'età minima. */
  banned: boolean;
  /** Iscritto prima delle password: mancano nome, cognome e data di nascita. */
  needsPrivate: boolean;
  /** Account creato prima delle password: va impostata per poter uscire e rientrare. */
  needsPassword: boolean;
  unread: number;
  settings: Settings;
};

export type NotificationKind = 'follow' | 'like' | 'comment' | 'tier' | 'cover' | 'identity_ok' | 'identity_ko' | 'removed';

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  actor: Author | null;
  post: { id: string; media: MediaItem[] } | null;
  data: { body?: string; tier?: number; featured_on?: string; reason?: string | null; final?: boolean };
  createdAt: string;
  read: boolean;
};

export type FollowRow = Author & { followedByMe: boolean; isMe: boolean; cursor?: string };

export type IdentityItem = {
  userId: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  documentUrl: string | null;
  selfieUrl: string | null;
  submittedAt: string;
  deadline: string;
  /** 'didit': in revisione su Didit, si decide dalla sua console. */
  method: 'manual' | 'didit';
};
