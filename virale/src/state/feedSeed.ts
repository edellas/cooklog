import type { Post } from '../types';

/**
 * Passaggio di consegne dalla griglia del profilo allo scorrimento verticale: i post già caricati
 * si mostrano subito, senza aspettare la rete. Si legge una volta sola.
 */
const seeds = new Map<string, Post[]>();

export function seedFeed(username: string, kind: 'posts' | 'saved', posts: Post[]) {
  seeds.set(`${username}:${kind}`, posts);
}

export function takeSeed(username: string, kind: 'posts' | 'saved'): Post[] | undefined {
  const key = `${username}:${kind}`;
  const posts = seeds.get(key);
  seeds.delete(key);
  return posts;
}
