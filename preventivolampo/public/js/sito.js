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
