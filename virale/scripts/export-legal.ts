/**
 * Pubblica il sito statico di Virale in legal-site/: i documenti legali (gli store chiedono indirizzi pubblici
 * per privacy policy ed eliminazione dell'account), la pagina iniziale con i link agli store e apri.html, la
 * pagina di atterraggio dei link condivisi (apre il post nell'app o porta allo store).
 * Uso: npm run export:legal. Poi pubblica la cartella (GitHub Pages: vedi PUBBLICARE.md).
 * Nessuna risorsa esterna (niente Google Fonts): i caratteri sono copiati nella cartella, così chi visita non
 * manda il proprio indirizzo IP a terzi.
 * Esce con errore se mancano i dati del titolare (EXPO_PUBLIC_OWNER_*): pagine con i segnaposto non vanno pubblicate.
 */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOCS, OWNER, ownerMissing, type DocSlug } from '../src/legal/docs.ts';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'legal-site');
const PLAY_URL = 'https://play.google.com/store/apps/details?id=app.virale.mobile';
const APPSTORE_URL = (process.env.EXPO_PUBLIC_APPSTORE_URL ?? '').trim();
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Un valore dentro uno <script>: JSON senza "<" (niente </script> chiuso per sbaglio). */
const js = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

// Caratteri della rivista (licenza SIL Open Font License: si possono ridistribuire).
const FONTS: [string, string][] = [
  ['bodoni-moda/700Bold/BodoniModa_700Bold.ttf', 'BodoniModa-700.ttf'],
  ['bodoni-moda/900Black/BodoniModa_900Black.ttf', 'BodoniModa-900.ttf'],
  ['schibsted-grotesk/400Regular/SchibstedGrotesk_400Regular.ttf', 'SchibstedGrotesk-400.ttf'],
  ['schibsted-grotesk/700Bold/SchibstedGrotesk_700Bold.ttf', 'SchibstedGrotesk-700.ttf'],
];

const STYLE = `
  @font-face { font-family: 'Bodoni Moda'; font-weight: 700; font-display: swap; src: url(fonts/BodoniModa-700.ttf) format('truetype'); }
  @font-face { font-family: 'Bodoni Moda'; font-weight: 900; font-display: swap; src: url(fonts/BodoniModa-900.ttf) format('truetype'); }
  @font-face { font-family: 'Schibsted Grotesk'; font-weight: 400; font-display: swap; src: url(fonts/SchibstedGrotesk-400.ttf) format('truetype'); }
  @font-face { font-family: 'Schibsted Grotesk'; font-weight: 700; font-display: swap; src: url(fonts/SchibstedGrotesk-700.ttf) format('truetype'); }
  :root { color-scheme: dark; --canvas: #0C1322; --raised: #151D2D; --paper: #F5F3EE; --dim: #C1C8D5; --faint: #939CAC; --giallo: #FADB2C; }
  body { margin: 0; background: var(--canvas); color: var(--paper); font: 17px/1.6 'Schibsted Grotesk', system-ui, sans-serif; }
  main { max-width: 68ch; margin: 0 auto; padding: 48px max(20px, env(safe-area-inset-left)) 80px; }
  a { color: var(--giallo); }
  .mast { font-family: 'Bodoni Moda', Didot, Georgia, serif; font-weight: 900; font-size: 34px; letter-spacing: -1px; text-decoration: none; color: var(--paper); }
  h1 { font-family: 'Bodoni Moda', Didot, Georgia, serif; font-weight: 700; font-size: 40px; line-height: 1.1; margin: 32px 0 12px; text-wrap: balance; }
  h2 { font-size: 20px; margin: 36px 0 8px; }
  p { color: var(--dim); margin: 0 0 12px; }
  nav { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 48px; padding-top: 20px; border-top: 1px solid #3A4253; font-size: 15px; }
  .buttons { display: flex; flex-direction: column; gap: 12px; margin: 28px 0; max-width: 360px; }
  .btn { display: block; text-align: center; text-decoration: none; font-weight: 700; border-radius: 14px; padding: 15px 18px; background: var(--raised); color: var(--paper); }
  .btn.primary { background: var(--giallo); color: var(--canvas); }
  .btn.off { color: var(--faint); }
  [hidden] { display: none !important; }
  ::selection { background: var(--giallo); color: var(--canvas); }
`;

const nav = () =>
  `<nav>${(Object.keys(DOCS) as DocSlug[]).map((s) => `<a href="${s}.html">${esc(DOCS[s].title)}</a>`).join('')}<a href="mailto:${esc(OWNER.email)}">${esc(OWNER.email)}</a></nav>`;

const page = (title: string, body: string, head = '') => `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Virale</title>
${head}<style>${STYLE}</style>
</head>
<body><main>
<a class="mast" href="index.html">Virale</a>
${body}
${nav()}
</main></body></html>
`;

const storeButtons = () =>
  `<a class="btn" id="play" href="${esc(PLAY_URL)}">Scarica per Android</a>` +
  (APPSTORE_URL ? `<a class="btn" id="ios" href="${esc(APPSTORE_URL)}">Scarica dall’App Store</a>` : `<span class="btn off" id="ios">Presto su App Store</span>`);

mkdirSync(join(OUT, 'fonts'), { recursive: true });
for (const [from, to] of FONTS) copyFileSync(join(ROOT, 'node_modules', '@expo-google-fonts', from), join(OUT, 'fonts', to));
copyFileSync(join(ROOT, 'node_modules', '@expo-google-fonts', 'bodoni-moda', 'LICENSE_FONT'), join(OUT, 'fonts', 'LICENZA-BodoniModa.txt'));
copyFileSync(join(ROOT, 'node_modules', '@expo-google-fonts', 'schibsted-grotesk', 'LICENSE_FONT'), join(OUT, 'fonts', 'LICENZA-SchibstedGrotesk.txt'));
copyFileSync(join(ROOT, 'assets', 'icon.png'), join(OUT, 'icona.png'));

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
    `<h1>Ogni giorno una sola copertina.</h1><p>Virale è l’app dove pubblichi foto e video e, ogni giorno, un solo post diventa la copertina che vedono tutti. La scegliete voi, guardando.</p><div class="buttons">${storeButtons()}</div><p>Supporto: <a href="mailto:${esc(OWNER.email)}">${esc(OWNER.email)}</a></p>`,
  ),
);

// Pagina di atterraggio dei link condivisi: apri.html?p=<id del post>.
// Android: apre l'app con un indirizzo intent:// (se l'app manca, Chrome va da solo al Play Store).
// iPhone: niente apertura automatica (Safari mostrerebbe un errore se l'app non c'è): due pulsanti.
// Computer: si invita ad aprire il link dal telefono.
const image = OWNER.website ? `${OWNER.website}/icona.png` : 'icona.png';
const openGraph = `<meta name="description" content="Ogni giorno una sola copertina, scelta da chi guarda. Apri il post nell’app Virale.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Virale">
<meta property="og:title" content="Un post su Virale">
<meta property="og:description" content="Ogni giorno una sola copertina, scelta da chi guarda. Apri il post nell’app Virale.">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary">
<meta name="robots" content="noindex">
`;
writeFileSync(
  join(OUT, 'apri.html'),
  page(
    'Un post su Virale',
    `<h1 id="title">Un post su Virale</h1>
<p id="msg">Apri questo link dal telefono per vederlo in Virale.</p>
<div class="buttons">
<a class="btn primary" id="open" href="#" hidden>Apri in Virale</a>
${storeButtons()}
</div>
<noscript><p>Apri questo link dal telefono per vederlo in Virale.</p></noscript>
<script>
(function () {
  var PLAY = ${js(PLAY_URL)};
  var id = new URLSearchParams(location.search).get('p') || '';
  var title = document.getElementById('title');
  var msg = document.getElementById('msg');
  var open = document.getElementById('open');
  var play = document.getElementById('play');
  var ios = document.getElementById('ios');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    title.textContent = 'Link non valido.';
    msg.textContent = 'Controlla di averlo copiato per intero.';
    return;
  }
  var ua = navigator.userAgent || '';
  var isAndroid = /Android/i.test(ua);
  var isIos = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isAndroid) {
    var intent = 'intent://post/' + id + '#Intent;scheme=virale;package=app.virale.mobile;S.browser_fallback_url=' + encodeURIComponent(PLAY) + ';end';
    open.href = intent;
    open.hidden = false;
    ios.hidden = true;
    msg.textContent = 'Si apre in Virale. Se non hai l’app, scaricala dal Play Store.';
    location.replace(intent);
  } else if (isIos) {
    open.href = 'virale://post/' + id;
    open.hidden = false;
    play.hidden = true;
    msg.textContent = 'Tocca “Apri in Virale”. Se non hai ancora l’app, scaricala.';
  }
})();
</script>`,
    openGraph,
  ),
);

const missing = ownerMissing();
console.log(`Pagine scritte in ${OUT}: index, apri, ${Object.keys(DOCS).join(', ')}`);
if (missing.length) {
  console.error(`Mancano i dati del titolare (le pagine hanno i segnaposto e non vanno pubblicate): ${missing.join(', ')}`);
  process.exitCode = 1;
}
