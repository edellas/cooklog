import type { Post } from '../types';

/**
 * Aggiornamenti di un post fra schermate: un commento scritto nel foglio dei commenti,
 * un "segui" sul profilo o un mi piace sulla copertina si vedono subito anche nelle schede del feed,
 * senza ricaricare (e perdere il punto in cui eri).
 */
type PostPatch = Partial<Pick<Post, 'likeCount' | 'likedByMe' | 'commentCount' | 'saveCount' | 'savedByMe' | 'shareCount'>>;
type Listener<T> = (value: T) => void;

const postListeners = new Map<string, Set<Listener<PostPatch & { commented?: boolean }>>>();
const authorListeners = new Set<Listener<{ authorId: string; following: boolean }>>();

/**
 * Gli ultimi cambiamenti restano in memoria per qualche minuto: una scheda smontata mentre eri altrove
 * (un feed che si svuota quando apri i commenti) quando ricompare li ritrova. Poi vale di nuovo il server.
 */
const KEEP_MS = 3 * 60_000;
const patches = new Map<string, { patch: PostPatch; at: number }>();
const follows = new Map<string, { following: boolean; at: number }>();

/** All'uscita (o cambiando account) i cambiamenti ricordati erano di un'altra persona: si dimenticano. */
export function forgetRecentChanges() {
  patches.clear();
  follows.clear();
}

export function withRecentChanges<T extends Post>(post: T): T {
  const p = patches.get(post.id);
  const f = follows.get(post.author.id);
  const fresh = (at: number) => Date.now() - at < KEEP_MS;
  return {
    ...post,
    ...(p && fresh(p.at) ? p.patch : null),
    ...(f && fresh(f.at) ? { followingAuthor: f.following } : null),
  };
}

export function onPostChange(postId: string, fn: Listener<PostPatch & { commented?: boolean }>): () => void {
  const set = postListeners.get(postId) ?? new Set();
  set.add(fn);
  postListeners.set(postId, set);
  return () => {
    set.delete(fn);
    if (!set.size) postListeners.delete(postId);
  };
}

export function emitPostChange(postId: string, patch: PostPatch & { commented?: boolean }) {
  const { commented: _c, ...data } = patch;
  patches.set(postId, { patch: { ...patches.get(postId)?.patch, ...data }, at: Date.now() });
  for (const fn of postListeners.get(postId) ?? []) fn(patch);
}

export function onFollowChange(fn: Listener<{ authorId: string; following: boolean }>): () => void {
  authorListeners.add(fn);
  return () => {
    authorListeners.delete(fn);
  };
}

export function emitFollowChange(authorId: string, following: boolean) {
  follows.set(authorId, { following, at: Date.now() });
  for (const fn of authorListeners) fn({ authorId, following });
}

/**
 * Post spariti per chi guarda: eliminati, segnalati, o di un autore appena bloccato. Le liste che non si
 * ricaricano da capo (lo scorrimento dei post di un profilo) li tolgono subito.
 */
type Gone = { postId: string } | { authorId: string };
const goneListeners = new Set<Listener<Gone>>();

export function onPostGone(fn: Listener<Gone>): () => void {
  goneListeners.add(fn);
  return () => {
    goneListeners.delete(fn);
  };
}

export function emitPostGone(gone: Gone) {
  for (const fn of goneListeners) fn(gone);
}
