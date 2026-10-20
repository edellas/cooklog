import type { EntryStatus } from './engine/engine';

/** Un elemento di un post: foto o video. `src` è un URL o, in demo, una chiave `demo:<nome>`. */
export type MediaItem = {
  kind: 'image' | 'video';
  src: string;
  width: number;
  height: number;
  durationMs?: number;
  /** Solo video: un fotogramma come immagine (miniature e attesa del primo fotogramma). */
  poster?: string;
};

export type Author = {
  id: string;
  username: string;
  displayName: string;
  /** Indirizzo della foto profilo (in demo un data URL); senza, si mostra il monogramma. */
  avatar?: string | null;
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
  /** Se il post è in gara oggi. Livello e stato li vede solo l'autore (per gli altri sono null / 'active'). */
  contest?: { entryId: string | null; tier: number | null; status: EntryStatus };
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
  /** Solo il proprio profilo: da quando si può cambiare di nuovo il nome mostrato (ISO), se c'è un'attesa. */
  nameChangeFrom?: string | null;
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
  /** null: il post in gara è stato eliminato (candidatura ritirata, per oggi non se ne fa un'altra). */
  postId: string | null;
  tier: number;
  status: EntryStatus;
  views: number;
  contestDay: string;
  /** Perché è fuori gara: 'segnalazioni', 'moderazione', 'ritirato' (solo per la propria candidatura). */
  reason?: string | null;
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
export type Settings = {
  revealMinutes: number;
  idGraceDays: number;
  cutoffHour: number;
  idProvider: 'manual' | 'didit';
  /** Gara in corso (dal server, che non torna mai su un giorno già chiuso) e quando finisce. */
  contestDay?: string;
  closesAt?: string;
};

/** Lo stato dell'utente che serve all'app: verifica dell'età, ruoli, notifiche non lette, impostazioni. */
export type Status = {
  identity: {
    status: IdentityStatus;
    deadline: string;
    reason: string | null;
    canAct: boolean;
    submittedAt?: string | null;
    reviewedAt?: string | null;
  } | null;
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
  /** Se le visualizzazioni di chi guarda contano nella gara (serve l'età verificata). */
  voter?: { canVote: boolean; from: string | null } | null;
};

export type NotificationKind = 'follow' | 'like' | 'comment' | 'tier' | 'cover' | 'identity_ok' | 'identity_ko' | 'removed';

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  actor: Author | null;
  post: { id: string; media: MediaItem[] } | null;
  /** removed: `reason` è il motivo della segnalazione (spam, odio…) e `what` cosa è stato rimosso. */
  data: { body?: string; tier?: number; featured_on?: string; reason?: string | null; final?: boolean; what?: 'post' | 'comment' | 'profile' };
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
  /** Perché la verifica automatica è passata a una persona (es. nome sul documento diverso). */
  providerNote: string | null;
  /** Un altro account già verificato con la stessa persona o lo stesso documento. */
  duplicateOf: string | null;
};
