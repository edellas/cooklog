// Componenti di interfaccia condivisi: escape HTML, toast, fogli a comparsa, conferme, avatar.
import * as nativo from "./nativo.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Solo immagini incorporate (data:image/png|jpeg|webp): niente URL esterni o javascript:.
export function immagineSicura(src) {
  return typeof src === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src) ? src : "";
}

// Vibrazioni brevi per i tocchi, un ritmo riconoscibile per i momenti buoni (firmato, pagato).
export const VIBRA = { tocco: 10, successo: [16, 50, 28], errore: [36, 60, 36] };

export function vibra(ms = VIBRA.tocco) {
  if (nativo.attiva) return nativo.vibra(ms); // nell'app: il motore di vibrazione del telefono
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* non supportato */
  }
}

let timerToast;
// azione: un pulsante nella notifica (per esempio "Annulla" dopo un'eliminazione), che resta 5 secondi.
export function toast(msg, tipo = "", { azione = "", suAzione = null } = {}) {
  let t = $("#toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.setAttribute("role", "status");
    t.setAttribute("aria-live", "polite");
    document.body.appendChild(t);
  }
  t.textContent = msg;
  if (azione && suAzione) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = azione;
    b.addEventListener("click", () => {
      clearTimeout(timerToast);
      t.className = tipo;
      suAzione();
    });
    t.append(b);
  }
  t.className = `on ${tipo} ${azione ? "con-azione" : ""}`;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => (t.className = tipo), azione ? 5000 : 2600);
}

// Foglio a comparsa dal basso (bottom sheet). Restituisce l'elemento del contenuto.
// Entra e esce con transizioni (interrompibili, a differenza dei keyframe) e si chiude anche
// trascinandolo in giù: basta un gesto rapido, non serve arrivare in fondo.
// Con un foglio aperto il tasto Indietro del telefono chiude il foglio, non la pagina: per questo
// all'apertura si aggiunge una voce alla cronologia, tolta alla chiusura.
let voceStoria = 0;

export function apriFoglio(html, { alMontaggio, classe = "" } = {}) {
  const sostituisce = Boolean($("#foglio"));
  chiudiFoglio(true, { tieniStoria: true });
  const ov = document.createElement("div");
  ov.className = "overlay entra";
  ov.id = "foglio";
  ov.innerHTML = `<div class="foglio ${classe}" role="dialog" aria-modal="true"><div class="maniglia" aria-hidden="true"></div>${html}</div>`;
  ov.addEventListener("click", (e) => {
    if (e.target === ov) chiudiFoglio();
  });
  document.body.appendChild(ov);
  document.body.classList.add("con-foglio");
  const foglio = ov.firstElementChild;
  // Il doppio frame garantisce che lo stato iniziale venga disegnato prima della transizione.
  requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.remove("entra")));
  trascinaPerChiudere(ov, foglio);
  if (!(sostituisce && voceStoria && history.state?.foglio === voceStoria)) {
    voceStoria = Date.now();
    try {
      history.pushState({ ...(history.state || {}), foglio: voceStoria }, "");
    } catch {
      voceStoria = 0;
    }
  }
  const primo = foglio.querySelector("input:not([type=hidden]):not([readonly]), textarea, select");
  if (primo && !primo.dataset.noFocus && matchMedia("(pointer: fine)").matches) primo.focus();
  alMontaggio?.(foglio);
  return foglio;
}

function trascinaPerChiudere(ov, foglio) {
  let inizio = null;
  foglio.addEventListener("pointerdown", (e) => {
    if (inizio || e.button > 0 || matchMedia("(min-width: 700px)").matches) return;
    // Si trascina dalla maniglia o dalla testata, oppure dal contenuto quando è già in cima.
    const daTesta = e.target.closest(".maniglia, .foglio-testa");
    if (!daTesta && (foglio.scrollTop > 0 || e.target.closest("input, textarea, select, canvas, button, a, label")))
      return;
    inizio = { y: e.clientY, t: performance.now(), id: e.pointerId, dy: 0 };
  });
  foglio.addEventListener("pointermove", (e) => {
    if (!inizio || e.pointerId !== inizio.id) return;
    const dy = e.clientY - inizio.y;
    if (!foglio.classList.contains("trascina")) {
      if (dy < 6) return;
      foglio.classList.add("trascina");
      foglio.setPointerCapture?.(e.pointerId);
    }
    // Verso l'alto il foglio resiste, verso il basso segue il dito.
    inizio.dy = dy;
    foglio.style.transform = `translateY(${dy > 0 ? dy : dy / 6}px)`;
  });
  const fine = (e) => {
    if (!inizio || e.pointerId !== inizio.id) return;
    const { dy, t } = inizio;
    inizio = null;
    if (!foglio.classList.contains("trascina")) return;
    foglio.classList.remove("trascina");
    const velocita = dy / Math.max(1, performance.now() - t);
    foglio.style.transform = "";
    if (dy > foglio.offsetHeight * 0.3 || (dy > 24 && velocita > 0.11)) chiudiFoglio();
  };
  foglio.addEventListener("pointerup", fine);
  foglio.addEventListener("pointercancel", fine);
}

export function chiudiFoglio(subito = false, { tieniStoria = false } = {}) {
  const ov = $("#foglio");
  if (!ov) return;
  if (ov._allaChiusura) ov._allaChiusura();
  ov.removeAttribute("id");
  document.body.classList.remove("con-foglio");
  if (!tieniStoria && voceStoria) {
    const voce = voceStoria;
    voceStoria = 0;
    // Dopo il giro corrente: se intanto si è cambiata pagina la voce non è più quella attuale e resta.
    setTimeout(() => {
      if (history.state?.foglio === voce) history.back();
    }, 0);
  }
  if (subito) {
    ov.remove();
    return;
  }
  // Mentre esce resta visibile ma non è più "il" foglio: niente tocchi e niente id doppi con quello nuovo.
  ov.inert = true;
  for (const el of ov.querySelectorAll("[id]")) el.removeAttribute("id");
  ov.classList.add("esce");
  setTimeout(() => ov.remove(), 220);
}

export function titoloFoglio(titolo, sottotitolo = "") {
  return `<div class="foglio-testa"><div><h3>${titolo}</h3>${sottotitolo ? `<p class="muted small">${sottotitolo}</p>` : ""}</div>
    <button class="icon-btn" data-action="chiudi-foglio" aria-label="Chiudi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>`;
}

// Conferma con foglio a comparsa al posto di window.confirm (che su mobile è brutto e bloccante).
export function chiedi({ titolo, testo = "", ok = "Conferma", annulla = "Annulla", pericolo = false }) {
  return new Promise((resolve) => {
    let risposto = false;
    const f = apriFoglio(
      `${titoloFoglio(esc(titolo))}
      ${testo ? `<p class="muted" style="margin:0 0 18px">${esc(testo)}</p>` : ""}
      <div class="grid2"><button class="btn" data-esito="no">${esc(annulla)}</button>
      <button class="btn ${pericolo ? "danger-solid" : "primary"}" data-esito="si">${esc(ok)}</button></div>`,
      { classe: "piccolo" },
    );
    f.parentElement._allaChiusura = () => {
      if (!risposto) resolve(false);
    };
    f.addEventListener("click", (e) => {
      const b = e.target.closest("[data-esito]");
      if (!b) return;
      risposto = true;
      chiudiFoglio();
      resolve(b.dataset.esito === "si");
    });
  });
}

// Avatar con iniziali e colore stabile derivato dal nome.
export function avatar(nome, classe = "") {
  const pulito = String(nome || "").trim();
  const parti = pulito.split(/\s+/).filter(Boolean);
  const iniziali = ((parti[0]?.[0] || "?") + (parti.length > 1 ? parti[parti.length - 1][0] : "")).toUpperCase();
  let h = 0;
  for (const c of pulito) h = (h * 31 + c.codePointAt(0)) % 360;
  return `<span class="avatar ${classe}" style="--h:${h}" aria-hidden="true">${esc(iniziali)}</span>`;
}

// Transizione fluida tra pagine dove supportata (View Transitions API).
// Si attende la fine dell'aggiornamento: chi chiama sa che la pagina è stata disegnata.
export async function transizione(fn) {
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return fn();
  let risultato;
  const t = document.startViewTransition(async () => {
    risultato = await fn();
  });
  // Si risolve quando la pagina è aggiornata (anche se l'animazione viene saltata) e propaga gli errori.
  await t.updateCallbackDone;
  return risultato;
}

export async function copiaTesto(testo) {
  if (nativo.attiva && (await nativo.copia(testo))) return true;
  try {
    await navigator.clipboard.writeText(testo);
    return true;
  } catch {
    const t = document.createElement("textarea");
    t.value = testo;
    t.setAttribute("readonly", "");
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    t.remove();
    return ok;
  }
}

window.addEventListener("popstate", (e) => {
  if (voceStoria && e.state?.foglio !== voceStoria) {
    voceStoria = 0;
    chiudiFoglio(false, { tieniStoria: true });
  }
});

// Su iPhone :active scatta solo se la pagina ascolta i tocchi.
document.addEventListener("touchstart", () => {}, { passive: true });
