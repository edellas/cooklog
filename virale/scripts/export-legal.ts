/**
 * Pubblica i documenti legali come pagine web statiche in legal-site/ (gli store chiedono
 * indirizzi pubblici per privacy policy ed eliminazione dell'account).
 * Uso: npm run export:legal. Poi pubblica la cartella (GitHub Pages: vedi PUBBLICARE.md).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOCS, OWNER, type DocSlug } from '../src/legal/docs.ts';

const OUT = join(import.meta.dirname, '..', 'legal-site');
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const page = (title: string, body: string) => `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Virale</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,700;6..96,900&family=Schibsted+Grotesk:wght@400;700&display=swap">
<style>
  :root { color-scheme: dark; --canvas: #0C1322; --raised: #151D2D; --paper: #F5F3EE; --dim: #C1C8D5; --faint: #939CAC; --giallo: #FADB2C; }
  body { margin: 0; background: var(--canvas); color: var(--paper); font: 17px/1.6 'Schibsted Grotesk', system-ui, sans-serif; }
  main { max-width: 68ch; margin: 0 auto; padding: 48px max(20px, env(safe-area-inset-left)) 80px; }
  a { color: var(--giallo); }
  .mast { font-family: 'Bodoni Moda', Didot, Georgia, serif; font-weight: 900; font-size: 34px; letter-spacing: -1px; text-decoration: none; color: var(--paper); }
  h1 { font-family: 'Bodoni Moda', Didot, Georgia, serif; font-weight: 700; font-size: 40px; line-height: 1.1; margin: 32px 0 12px; text-wrap: balance; }
  h2 { font-size: 20px; margin: 36px 0 8px; }
  p { color: var(--dim); margin: 0 0 12px; }
  nav { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 48px; padding-top: 20px; border-top: 1px solid #3A4253; font-size: 15px; }
  ::selection { background: var(--giallo); color: var(--canvas); }
</style>
</head>
<body><main>
<a class="mast" href="index.html">Virale</a>
${body}
<nav>${(Object.keys(DOCS) as DocSlug[]).map((s) => `<a href="${s}.html">${esc(DOCS[s].title)}</a>`).join('')}<a href="mailto:${esc(OWNER.email)}">${esc(OWNER.email)}</a></nav>
</main></body></html>
`;

mkdirSync(OUT, { recursive: true });
for (const slug of Object.keys(DOCS) as DocSlug[]) {
  const d = DOCS[slug];
  const body = `<h1>${esc(d.title)}</h1><p>${esc(d.intro)}</p>${d.sections
    .map((s) => `<h2>${esc(s.heading)}</h2>${s.body.map((p) => `<p>${esc(p)}</p>`).join('')}`)
    .join('')}`;
  writeFileSync(join(OUT, `${slug}.html`), page(d.title, body));
}
writeFileSync(
  join(OUT, 'index.html'),
  page(
    'Virale',
    `<h1>Ogni giorno una sola copertina.</h1><p>Virale è l’app dove pubblichi foto e video e, ogni giorno, un solo post diventa la copertina che vedono tutti. La scelgono gli occhi di chi guarda.</p><p>Supporto: <a href="mailto:${esc(OWNER.email)}">${esc(OWNER.email)}</a></p>`,
  ),
);
console.log(`Pagine scritte in ${OUT}: index, ${Object.keys(DOCS).join(', ')}`);
