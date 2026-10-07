// Genera le pagine "Fac simile preventivo <mestiere>" (una per mestiere), l'indice dei modelli,
// sitemap.xml e robots.txt. Rilancialo dopo aver cambiato config.js o mestieri.js:
//   npm run seo
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MESTIERI, vociListino } from "../public/js/mestieri.js";
import { CONFIG } from "../public/js/config.js";
import { ICONE_MESTIERI } from "../public/js/icone.js";
import { calcolaTotali, formatEuro, formatQta, rigaVuota } from "../public/js/core.js";

const pubblica = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const SITO = CONFIG.sito.replace(/\/$/, "");
const ANNO = new Date().getFullYear();

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const iconaMestiere = (m) => ICONE_MESTIERI[m.id] || ICONE_MESTIERI.altro;

// Marchio dell'app (lo stesso di ICONE.logo) e icone Lucide (licenza ISC) usate nelle pagine.
const MARCHIO = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#1a1d21"/><path d="M36.5 7 15 36h14.5l-4 21L49 27H34.5z" fill="#ffc21a"/></svg>`;
const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
    <symbol id="i-freccia" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></symbol>
    <symbol id="i-giu" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></symbol>
    <symbol id="i-avanti" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></symbol>
    <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></symbol>
  </svg>`;
const ico = (id) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`;

function qtaEsempio(v) {
  if (v.um === "mq") return v.prezzo < 2 ? 300 : 20;
  if (v.um === "ml") return 10;
  if (v.um === "ora") return 3;
  if (v.um === "mc") return 4;
  if (v.um === "km") return 60;
  return 1;
}

const aliquotaEsempio = (m) => (m.iva.includes("10%") ? 10 : 22);

function testa({ titolo, descrizione, canonico, jsonld = [] }) {
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://plausible.io https://cloud.umami.is; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://plausible.io https://cloud.umami.is https://api-gateway.umami.dev; object-src 'none'; base-uri 'none'; form-action 'none'">
  <title>${esc(titolo)}</title>
  <meta name="description" content="${esc(descrizione)}">
  <link rel="canonical" href="${esc(canonico)}">
  <meta name="theme-color" content="#f4f2ed" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#131518" media="(prefers-color-scheme: dark)">
  <link rel="icon" href="../img/icona.svg" type="image/svg+xml">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${esc(titolo)}">
  <meta property="og:description" content="${esc(descrizione)}">
  <meta property="og:image" content="${SITO}/img/og.png">
  <meta property="og:locale" content="it_IT">
  <link rel="preload" href="../fonts/archivo-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="../css/sito.css">
${jsonld.map((j) => `  <script type="application/ld+json">${JSON.stringify(j)}</script>`).join("\n")}
</head>
<body>
  ${SPRITE}
  <a class="salta" href="#contenuto">Vai al contenuto</a>
  <header class="testata carta">
    <div class="wrap">
      <a class="marchio" href="../">${MARCHIO}<span>PreventivoLampo</span></a>
      <nav aria-label="Sezioni"><a class="largo" href="./">Modelli</a><a class="largo" href="../#prezzi">Prezzi</a><a class="btn" href="../app.html">Prova gratis</a></nav>
    </div>
  </header>`;
}

const piede = `
  <footer class="piede">
    <div class="wrap">
      <span>© ${ANNO} PreventivoLampo</span>
      <nav aria-label="Informazioni"><a href="../">Home</a><a href="./">Modelli di preventivo</a><a href="../privacy.html">Privacy</a><a href="../termini.html">Termini</a></nav>
    </div>
  </footer>
  <script type="module" src="../js/sito.js"></script>
</body>
</html>
`;

function boxCta(m, testo) {
  return `<div class="box-cta">
        <div class="testo"><h3>${esc(testo)}</h3><p>Si apre già compilato: cambi i prezzi, aggiungi il cliente e lo invii su WhatsApp. Il cliente lo accetta e firma dal suo telefono. Gratis, senza registrazione.</p></div>
        <a class="btn medio" href="../app.html?mestiere=${m.id}&amp;modello=1">Apri il modello nell'app${ico("freccia")}</a>
      </div>`;
}

const faqHtml = (faq) =>
  `<div class="faq">
${faq.map(([q, a]) => `        <details><summary>${esc(q)}${ico("giu")}</summary><p>${esc(a)}</p></details>`).join("\n")}
      </div>`;

function paginaMestiere(m, i) {
  const nomeMin = m.nome.toLowerCase();
  const voci = vociListino(m);
  const aliquota = aliquotaEsempio(m);
  const righe = voci.slice(0, 6).map((v) => rigaVuota(aliquota, { ...v, qta: qtaEsempio(v), iva: aliquota }));
  const totali = calcolaTotali({ righe, acconto: { tipo: "perc", valore: 30 } }, { regime: "ordinario" });
  const url = `${SITO}/modelli/preventivo-${m.id}.html`;
  const titolo = `Fac simile preventivo ${nomeMin}: esempio gratis con prezzi ${ANNO} (PDF)`;
  const descrizione = `Modello di preventivo per ${nomeMin} pronto da compilare: voci, prezzi indicativi ${ANNO}, IVA e condizioni. Personalizzalo e invialo in PDF su WhatsApp in 60 secondi, gratis.`;

  const faq = [
    [
      `Cosa deve contenere un preventivo da ${nomeMin}?`,
      "Dati dell'impresa (con partita IVA), dati del cliente, descrizione chiara dei lavori, quantità e prezzi di manodopera e materiali, IVA applicata, tempi di esecuzione, validità del preventivo, modalità di pagamento e spazio per la firma di accettazione.",
    ],
    [
      "Il preventivo accettato è vincolante?",
      "Quando il cliente lo accetta, il preventivo diventa l'accordo tra le parti su lavori e prezzi. Per questo conviene descrivere bene cosa è compreso e cosa no, e farlo firmare per accettazione.",
    ],
    [
      "Per quanto tempo è valido un preventivo?",
      "La validità la decidi tu: di solito 15 o 30 giorni, soprattutto quando i prezzi dei materiali cambiano spesso. Indica sempre la data di scadenza sul preventivo.",
    ],
    ["Che IVA si applica?", m.iva],
    [
      "Il preventivo va inviato allo SdI come la fattura?",
      "No, il preventivo non è un documento fiscale. La fattura elettronica si emette dopo, quando incassi o a lavoro concluso.",
    ],
  ];
  const jsonld = [
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map(([q, a]) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "PreventivoLampo", item: `${SITO}/` },
        { "@type": "ListItem", position: 2, name: "Modelli di preventivo", item: `${SITO}/modelli/` },
        { "@type": "ListItem", position: 3, name: `Preventivo ${nomeMin}`, item: url },
      ],
    },
  ];

  const correlati = [1, 2, 3, 4, 5, 6].map((k) => MESTIERI[(i + k) % MESTIERI.length]);

  return `${testa({ titolo: `${titolo} | PreventivoLampo`, descrizione, canonico: url, jsonld })}
  <main class="articolo" id="contenuto">
    <div class="wrap stretto">
      <nav class="briciole" aria-label="Percorso"><a href="../">Home</a> › <a href="./">Modelli di preventivo</a> › ${esc(m.nome)}</nav>
      <h1>Fac simile preventivo ${esc(nomeMin)}: esempio gratis con prezzi</h1>
      <p class="apertura">Ecco un esempio completo di <b>preventivo per ${esc(nomeMin)}</b>, con le voci di lavoro più comuni e prezzi indicativi aggiornati al ${ANNO}. Invece di scaricare un file Word da riempire a mano, puoi aprirlo direttamente nell'app, cambiare i prezzi e mandarlo al cliente in PDF su WhatsApp in un minuto.</p>
      ${boxCta(m, `Usa questo preventivo da ${nomeMin}`)}

      <h2>Esempio: ${esc(m.oggetto.toLowerCase())}</h2>
      <div class="tabella-wrap"><table class="t-esempio">
        <thead><tr><th>Descrizione</th><th class="num">Q.tà</th><th>U.m.</th><th class="num">Prezzo</th><th class="num">Importo</th></tr></thead>
        <tbody>
${totali.righe.map((r) => `          <tr><td>${esc(r.descrizione)}</td><td class="num">${formatQta(r.qta)}</td><td>${esc(r.um)}</td><td class="num">${formatEuro(r.prezzo)}</td><td class="num">${formatEuro(r.importo)}</td></tr>`).join("\n")}
        </tbody>
        <tfoot>
          <tr><td colspan="4">Imponibile</td><td class="num">${formatEuro(totali.imponibile)}</td></tr>
          <tr><td colspan="4">IVA ${aliquota}%</td><td class="num">${formatEuro(totali.iva)}</td></tr>
          <tr class="totale"><td colspan="4">Totale IVA inclusa</td><td class="num">${formatEuro(totali.totale)}</td></tr>
          <tr><td colspan="4">Acconto 30% all'accettazione</td><td class="num">${formatEuro(totali.acconto)}</td></tr>
        </tfoot>
      </table></div>
      <p class="avviso">${ico("info")}<span>Prezzi indicativi medi: variano in base a zona, materiali, accessibilità del lavoro e urgenza. Usali come base e inserisci sempre i tuoi.</span></p>

      <h2>Cosa scrivere in un preventivo da ${esc(nomeMin)}</h2>
      <ul class="punti">
${m.consigli.map((c) => `        <li>${esc(c)}</li>`).join("\n")}
        <li>Indica la validità (ad esempio 30 giorni) e le modalità di pagamento, con eventuale acconto.</li>
        <li>Lascia lo spazio per la firma "per accettazione": con l'app il cliente può firmare direttamente sul tuo telefono.</li>
      </ul>

      <h2>Prezzi indicativi ${esc(nomeMin)} ${ANNO}</h2>
      <div class="tabella-wrap"><table class="t-prezzi">
        <thead><tr><th>Voce</th><th>Tipo</th><th>U.m.</th><th class="num">Prezzo indicativo</th></tr></thead>
        <tbody>
${voci.map((v) => `          <tr><td>${esc(v.descrizione)}</td><td>${v.tipo === "mat" ? "Materiale" : "Manodopera"}</td><td>${esc(v.um)}</td><td class="num">${formatEuro(v.prezzo)}</td></tr>`).join("\n")}
        </tbody>
      </table></div>
      <p>Queste voci sono già caricate nel listino dell'app quando scegli "${esc(m.nome)}" come mestiere: le adatti una volta e le riusi in ogni preventivo.</p>

      <h2>Che IVA applicare</h2>
      <p>${esc(m.iva)}</p>

      ${boxCta(m, "Fai il preventivo in 60 secondi")}

      <h2>Domande frequenti</h2>
      ${faqHtml(faq)}

      <h2>Altri modelli di preventivo</h2>
      <div class="mestieri">
${correlati.map((c) => `        <a href="preventivo-${c.id}.html">${iconaMestiere(c)}Preventivo ${esc(c.nome.toLowerCase())}</a>`).join("\n")}
        <a href="./">Tutti i modelli</a>
      </div>
    </div>
  </main>${piede}`;
}

function paginaIndice() {
  const url = `${SITO}/modelli/`;
  return `${testa({
    titolo: `Modelli di preventivo gratis per artigiani (${ANNO}) | PreventivoLampo`,
    descrizione: `Fac simile di preventivo gratuiti per ${MESTIERI.length} mestieri: idraulico, elettricista, imbianchino, muratore e altri. Con prezzi indicativi ${ANNO}, da compilare e inviare in PDF.`,
    canonico: url,
  })}
  <main class="articolo" id="contenuto">
    <div class="wrap stretto">
      <nav class="briciole" aria-label="Percorso"><a href="../">Home</a> › Modelli di preventivo</nav>
      <h1>Modelli di preventivo gratis per artigiani</h1>
      <p class="apertura">Scegli il tuo mestiere: trovi un esempio di preventivo completo, i prezzi indicativi ${ANNO} e i consigli su cosa scrivere. Ogni modello si apre nell'app già compilato, pronto da inviare in PDF.</p>
      <ul class="elenco-mestieri">
${MESTIERI.map((m) => `        <li><a href="preventivo-${m.id}.html"><span class="segno">${iconaMestiere(m)}</span><span class="corpo"><b>Preventivo ${esc(m.nome.toLowerCase())}</b><span class="s">${esc(m.oggetto)}</span></span>${ico("avanti")}</a></li>`).join("\n")}
      </ul>
      <div class="box-cta"><div class="testo"><h3>Il tuo mestiere non c'è?</h3><p>L'app funziona per qualsiasi lavoro: crei il tuo listino e fai preventivi in un minuto.</p></div><a class="btn medio" href="../app.html">Prova gratis${ico("freccia")}</a></div>
    </div>
  </main>${piede}`;
}

mkdirSync(path.join(pubblica, "modelli"), { recursive: true });
MESTIERI.forEach((m, i) =>
  writeFileSync(path.join(pubblica, "modelli", `preventivo-${m.id}.html`), paginaMestiere(m, i)),
);
writeFileSync(path.join(pubblica, "modelli", "index.html"), paginaIndice());

// Elenco mestieri e URL canonici nella home.
const fileHome = path.join(pubblica, "index.html");
let home = readFileSync(fileHome, "utf8");
home = home.replace(
  /<!-- MESTIERI:INIZIO -->[\s\S]*?<!-- MESTIERI:FINE -->/,
  `<!-- MESTIERI:INIZIO -->\n${MESTIERI.map((m) => `          <a href="modelli/preventivo-${m.id}.html">${iconaMestiere(m)}${esc(m.nome)}</a>`).join("\n")}\n          <!-- MESTIERI:FINE -->`,
);
home = home.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${SITO}/">`);
home = home.replace(
  /<meta property="og:image" content="[^"]*">/,
  `<meta property="og:image" content="${SITO}/img/og.png">`,
);
writeFileSync(fileHome, home);

const oggi = new Date().toISOString().slice(0, 10);
const urls = [
  "/",
  "/modelli/",
  ...MESTIERI.map((m) => `/modelli/preventivo-${m.id}.html`),
  "/privacy.html",
  "/termini.html",
];
writeFileSync(
  path.join(pubblica, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${SITO}${u}</loc><lastmod>${oggi}</lastmod></url>`)
    .join("\n")}\n</urlset>\n`,
);
writeFileSync(
  path.join(pubblica, "robots.txt"),
  `User-agent: *\nAllow: /\nDisallow: /app\n\nSitemap: ${SITO}/sitemap.xml\n`,
);

console.log(
  `Generate ${MESTIERI.length} pagine modello, indice, sitemap (${urls.length} URL) e robots.txt per ${SITO}`,
);
