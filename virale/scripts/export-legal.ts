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
/** Indirizzo https facoltativo da una variabile (vuoto o non https = assente). */
const url = (k: string) => {
  const v = (process.env[k] ?? '').trim();
  return /^https:\/\/[^\s"<>]+$/.test(v) ? v : '';
};
// Fase di beta su Google Play (test chiuso): la pagina iniziale serve a trovare tester. VIRALE_BETA=no quando
// l'app è pubblica sul Play Store.
const BETA = (process.env.VIRALE_BETA ?? '').trim().toLowerCase() !== 'no';
/** Il Google Gruppo dei tester (chi entra nel gruppo può unirsi al test chiuso). */
const BETA_GROUP = url('VIRALE_BETA_GRUPPO');
/** Pagina di adesione al test di Google Play: uguale per tutte le app, cambia solo il pacchetto. */
const BETA_OPTIN = 'https://play.google.com/apps/testing/app.virale.mobile';
const TIKTOK = url('VIRALE_TIKTOK');
const INSTAGRAM = url('VIRALE_INSTAGRAM');
/** Indirizzo pubblico del sito (canonical, sitemap, anteprime social). */
const SITE = OWNER.website;
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
  .badge { display: inline-block; background: var(--raised); color: var(--giallo); border-radius: 999px; padding: 5px 12px; font-size: 14px; font-weight: 700; margin-top: 28px; }
  .lead { font-size: 19px; color: var(--paper); }
  .shots { display: flex; gap: 12px; margin: 32px 0 8px; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 6px; }
  .shots img { width: 46%; max-width: 220px; height: auto; border-radius: 18px; scroll-snap-align: start; flex: none; }
  ol.steps { list-style: none; padding: 0; margin: 16px 0; counter-reset: step; }
  ol.steps li { counter-increment: step; position: relative; padding: 14px 16px 14px 56px; margin-bottom: 10px; background: var(--raised); border-radius: 16px; color: var(--dim); }
  ol.steps li::before { content: counter(step); position: absolute; left: 16px; top: 13px; width: 28px; height: 28px; border-radius: 50%; background: var(--giallo); color: var(--canvas); font-weight: 700; text-align: center; line-height: 28px; }
  ol.steps strong { color: var(--paper); display: block; }
  ol.steps .btn { margin-top: 10px; display: inline-block; padding: 11px 16px; }
  details { background: var(--raised); border-radius: 14px; padding: 12px 16px; margin-bottom: 10px; }
  summary { cursor: pointer; font-weight: 700; color: var(--paper); }
  details p { margin: 10px 0 2px; }
  .small { font-size: 14px; color: var(--faint); }
  @media (min-width: 720px) { h1.hero { font-size: 56px; } .buttons { flex-direction: row; max-width: none; } .buttons .btn { flex: 1; } }
  [hidden] { display: none !important; }
  ::selection { background: var(--giallo); color: var(--canvas); }
`;

const nav = () =>
  `<nav>${(Object.keys(DOCS) as DocSlug[]).map((s) => `<a href="${s}.html">${esc(DOCS[s].title)}</a>`).join('')}<a href="mailto:${esc(OWNER.email)}">${esc(OWNER.email)}</a></nav>`;

const page = (title: string, body: string, head = '', fullTitle?: string) => `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle ?? `${title} · Virale`)}</title>
<meta name="theme-color" content="#0C1322">
<link rel="icon" href="icona.png">
<link rel="apple-touch-icon" href="icona.png">
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
  writeFileSync(join(OUT, `${slug}.html`), page(d.title, body, `<meta name="description" content="${esc(d.intro.slice(0, 155))}">\n`));
}

// Pagina iniziale: in beta cerca tester Android (test chiuso di Google Play), poi diventa la pagina dell'app.
for (const f of ['schermata-copertina.jpg', 'schermata-provini.jpg', 'schermata-in-gara.jpg', 'anteprima-social.jpg'])
  copyFileSync(join(ROOT, 'store', 'sito', f), join(OUT, f));
const abs = (path: string) => (SITE ? `${SITE}/${path}` : path);
const DESCRIPTION = BETA
  ? 'Virale è l’app italiana dove ogni giorno una sola foto o un solo video diventa la copertina, scelta da chi guarda. Beta gratuita per Android: diventa tester.'
  : 'Virale è l’app italiana dove ogni giorno una sola foto o un solo video diventa la copertina, scelta da chi guarda. Gratis per Android.';
const FAQ: [string, string][] = [
  ['È gratis?', 'Sì: l’app e la beta sono gratuite, senza abbonamenti né acquisti.'],
  ['Che telefono serve?', `Uno smartphone Android 7 o più recente, con un account Google. ${BETA ? 'La beta per iPhone arriverà più avanti.' : ''}`],
  ['Quanti anni bisogna avere?', 'Almeno 14. Nell’app l’età si verifica con un documento: è così che i voti contano davvero.'],
  ['Come si vota?', 'Guardando. Nella sezione “In gara” i post arrivano alla cieca, senza numeri: quanto ti fermi su un post, se lo rivedi, lo salvi o lo condividi è il tuo voto. All’orario della copertina vince un solo post.'],
  ['C’è un premio?', 'Nessun premio in denaro o in oggetti: chi vince diventa la copertina del giorno, la vedono tutti e resta nell’Archivio.'],
  ...(BETA
    ? ([
        ['Cosa deve fare un beta tester?', 'Installare Virale dal Play Store, tenerla installata almeno 14 giorni e usarla quando vuoi: pubblicare, guardare, votare. Se qualcosa non va, scrivici.'],
        ['Posso uscire dalla beta?', 'Sì, quando vuoi: dalla stessa pagina di Google Play con cui sei entrato (“Abbandona il programma”) o disinstallando l’app.'],
      ] as [string, string][])
    : []),
  ['Che dati raccogliete?', 'Solo quelli che servono all’app, spiegati nell’informativa sulla privacy. Questo sito non usa cookie né strumenti di tracciamento.'],
];
const ld = [
  {
    '@context': 'https://schema.org',
    '@type': 'MobileApplication',
    name: 'Virale',
    operatingSystem: 'Android',
    applicationCategory: 'SocialNetworkingApplication',
    inLanguage: 'it',
    description: DESCRIPTION,
    ...(SITE ? { url: `${SITE}/`, image: `${SITE}/anteprima-social.jpg` } : {}),
    downloadUrl: BETA ? BETA_OPTIN : PLAY_URL,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    publisher: { '@type': 'Person', name: OWNER.name, email: OWNER.email },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  },
];
const social = [TIKTOK ? `<a href="${esc(TIKTOK)}" rel="me">TikTok</a>` : '', INSTAGRAM ? `<a href="${esc(INSTAGRAM)}" rel="me">Instagram</a>` : '']
  .filter(Boolean)
  .join(' · ');
const joinStep = BETA_GROUP
  ? `<li><strong>Entra nel gruppo dei tester</strong>Si apre Google Gruppi: tocca “Partecipa al gruppo” con l’account Google che usi sul telefono.<br><a class="btn primary" href="${esc(BETA_GROUP)}" rel="noopener">Entra nel gruppo</a></li>`
  : `<li><strong>Chiedi l’invito</strong>Scrivici dal telefono con l’indirizzo Gmail che usi sul Play Store: ti aggiungiamo ai tester. Lo usiamo solo per invitarti (vedi l’<a href="privacy.html">informativa</a>).<br><a class="btn primary" href="mailto:${esc(OWNER.email)}?subject=${encodeURIComponent('Voglio provare Virale (beta Android)')}&amp;body=${encodeURIComponent('Ciao! Questo è l’indirizzo Gmail del mio telefono Android: ')}">Chiedi l’invito</a></li>`;
const hero = BETA
  ? `<span class="badge">Beta aperta · Android</span>
<h1 class="hero">Ogni giorno una sola copertina.</h1>
<p class="lead">Pubblica una foto o un video e candidalo alla gara del giorno. Chi guarda vota solo guardando: all’orario della copertina vince un solo post, e lo vedono tutti.</p>
<p>Cerchiamo i primi tester: provi Virale prima di tutti, gratis, e ci aiuti a renderla perfetta.</p>
<div class="buttons"><a class="btn primary" href="#beta">Diventa beta tester</a><a class="btn" href="#come-funziona">Come funziona</a></div>`
  : `<h1 class="hero">Ogni giorno una sola copertina.</h1>
<p class="lead">Pubblica una foto o un video e candidalo alla gara del giorno. Chi guarda vota solo guardando: all’orario della copertina vince un solo post, e lo vedono tutti.</p>
<div class="buttons">${storeButtons()}</div>`;
const indexBody = `${hero}
<div class="shots" aria-label="Schermate dell’app">
<img src="schermata-copertina.jpg" width="540" height="1080" alt="La copertina del giorno in Virale: una foto a tutto schermo con il nome di chi l’ha pubblicata" loading="eager">
<img src="schermata-provini.jpg" width="540" height="1080" alt="I provini: foto e video da guardare uno dopo l’altro" loading="lazy">
<img src="schermata-in-gara.jpg" width="540" height="1080" alt="Il proprio post in gara e la sua salita verso la copertina" loading="lazy">
</div>
<h2 id="come-funziona">Come funziona</h2>
<ol class="steps">
<li><strong>Pubblica e candida</strong>Foto o video, anche più di uno insieme. Ogni giorno puoi mettere in gara un solo post: scegli il migliore.</li>
<li><strong>Guarda i provini</strong>In “In gara” i post arrivano alla cieca, senza numeri né classifiche. Il tuo modo di guardare è il voto.</li>
<li><strong>La copertina</strong>All’orario della copertina vince un solo post: diventa la copertina del giorno e resta per sempre nell’Archivio.</li>
</ol>
${
  BETA
    ? `<h2 id="beta">Diventa beta tester</h2>
<p>Servono uno smartphone Android e un account Google. Tre passi, due minuti:</p>
<ol class="steps">
${joinStep}
<li><strong>Accetta l’invito al test</strong>Apri questa pagina di Google Play con lo stesso account e tocca “Diventa un tester”.<br><a class="btn" href="${esc(BETA_OPTIN)}" rel="noopener">Diventa un tester</a></li>
<li><strong>Scarica Virale e tienila almeno 14 giorni</strong>Dal Play Store, come una qualsiasi app. Usala quando vuoi: è importante non disinstallarla per 14 giorni, così Google ci permette di pubblicarla per tutti.<br><a class="btn" href="${esc(PLAY_URL)}" rel="noopener">Apri Virale sul Play Store</a></li>
</ol>
<p class="small">Hai un iPhone? La beta per ora è solo Android.${social ? ` Seguici su ${social} per sapere quando arriva.` : ''} Problemi o idee? Scrivi a <a href="mailto:${esc(OWNER.email)}">${esc(OWNER.email)}</a>.</p>`
    : ''
}
<h2>Domande frequenti</h2>
${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}
<h2>Chi c’è dietro</h2>
<p>Virale è un progetto indipendente italiano. Titolare: ${esc(OWNER.name)} · ${esc(OWNER.address)} · C.F./P.IVA ${esc(OWNER.taxId)} · <a href="mailto:${esc(OWNER.email)}">${esc(OWNER.email)}</a>.${social ? ` Seguici su ${social}.` : ''}</p>
<p class="small">Questo sito non usa cookie, né strumenti di analisi o di tracciamento, né risorse di altri siti.</p>`;
const indexHead = `<meta name="description" content="${esc(DESCRIPTION)}">
${SITE ? `<link rel="canonical" href="${esc(SITE)}/">\n` : ''}<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:locale" content="it_IT">
<meta property="og:site_name" content="Virale">
<meta property="og:title" content="${esc(BETA ? 'Virale · Diventa beta tester' : 'Virale · Ogni giorno una sola copertina')}">
<meta property="og:description" content="${esc(DESCRIPTION)}">
${SITE ? `<meta property="og:url" content="${esc(SITE)}/">\n` : ''}<meta property="og:image" content="${esc(abs('anteprima-social.jpg'))}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Virale: ogni giorno una sola copertina, la scelgono gli occhi di tutti">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" as="image" href="schermata-copertina.jpg">
<script type="application/ld+json">${js(ld)}</script>
`;
writeFileSync(
  join(OUT, 'index.html'),
  page(
    'Virale',
    indexBody,
    indexHead,
    BETA ? 'Virale · L’app dove ogni giorno vince una sola copertina · Beta Android' : 'Virale · L’app dove ogni giorno vince una sola copertina',
  ),
);

// Per i motori di ricerca: si indicizzano la pagina iniziale e i documenti, non apri.html (link dei singoli post).
if (SITE) {
  const urls = ['', ...(Object.keys(DOCS) as DocSlug[]).map((d) => `${d}.html`)];
  writeFileSync(
    join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${esc(`${SITE}/${u}`)}</loc></url>`)
      .join('\n')}\n</urlset>\n`,
  );
}
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nDisallow: /apri.html\n${SITE ? `Sitemap: ${SITE}/sitemap.xml\n` : ''}`);

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
console.log(`Pagine scritte in ${OUT}: index (${BETA ? 'beta' : 'pubblica'}), apri, ${Object.keys(DOCS).join(', ')}, robots${SITE ? ', sitemap' : ''}`);
if (BETA && !BETA_GROUP) console.log('VIRALE_BETA_GRUPPO non impostata: per entrare nella beta si chiede l’invito via email.');
if (missing.length) {
  console.error(`Mancano i dati del titolare (le pagine hanno i segnaposto e non vanno pubblicate): ${missing.join(', ')}`);
  process.exitCode = 1;
}
