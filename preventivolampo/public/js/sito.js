// Script delle pagine del sito (landing, modelli, privacy, termini).
// Prezzi, contatti e dati del titolare arrivano da config.js, così restano sempre allineati.
import { CONFIG } from "./config.js";

const testo = (sel, valore) => document.querySelectorAll(sel).forEach((el) => (el.textContent = valore));

document.querySelectorAll("[data-prezzo]").forEach((el) => {
  const p = CONFIG.prezzi[el.dataset.prezzo];
  if (p) el.textContent = p.importo;
});
testo('[data-config="gratis"]', String(CONFIG.pdfGratisAlMese));
document.querySelectorAll('[data-config="email"]').forEach((el) => (el.href = "mailto:" + CONFIG.emailSupporto));
testo('[data-config="anno"]', String(new Date().getFullYear()));

const t = CONFIG.titolare;
if (t && !t.nome.startsWith("[")) testo('[data-config="titolare"]', ` · ${t.nome} · P.IVA ${t.piva}`);
document.querySelectorAll("[data-t]").forEach((el) => {
  const v = { nome: t.nome, indirizzo: t.indirizzo, piva: t.piva, email: CONFIG.emailSupporto, sito: CONFIG.sito }[
    el.dataset.t
  ];
  if (v) el.textContent = v;
});

const Osservatore = window.IntersectionObserver;

// Il timbro "Accettato" atterra una volta sola, quando si vede. Il CSS lo fa comparire comunque da solo
// poco dopo il caricamento: qui lo si trattiene soltanto se in quel momento è fuori dallo schermo.
const timbro = document.getElementById("timbro-eroe");
if (timbro && Osservatore) {
  const r = timbro.getBoundingClientRect();
  if (r.top > window.innerHeight || r.bottom < 0) {
    timbro.classList.add("attesa");
    const oss = new Osservatore(
      (voci) => {
        if (!voci.some((v) => v.isIntersecting && v.intersectionRatio > 0.85)) return;
        oss.disconnect();
        timbro.classList.replace("attesa", "vista");
      },
      { threshold: [0.9], rootMargin: "0px 0px -8% 0px" },
    );
    oss.observe(timbro);
  }
}

// Sul telefono il pulsante resta a portata di pollice: compare quando quello in alto esce dallo
// schermo e si fa da parte quando si vede quello finale.
const barra = document.getElementById("barra-cta");
const ctaInAlto = document.getElementById("cta-eroe");
const ctaInFondo = document.getElementById("cta-chiusura");
if (barra && ctaInAlto && Osservatore) {
  const visibili = new Set();
  const oss = new Osservatore((voci) => {
    for (const v of voci) {
      if (v.isIntersecting) visibili.add(v.target);
      else visibili.delete(v.target);
    }
    const superato = ctaInAlto.getBoundingClientRect().bottom < 0;
    barra.classList.toggle("su", superato && visibili.size === 0);
  });
  oss.observe(ctaInAlto);
  if (ctaInFondo) oss.observe(ctaInFondo);
}

const st = CONFIG.statistiche;
if (st && st.src) {
  if (st.src.includes("plausible")) {
    window.plausible =
      window.plausible ||
      function () {
        (window.plausible.q = window.plausible.q || []).push(arguments);
      };
  }
  const s = document.createElement("script");
  s.defer = true;
  s.src = st.src;
  for (const [k, v] of Object.entries(st.attributi || {})) s.setAttribute(k, v);
  document.head.appendChild(s);
}
