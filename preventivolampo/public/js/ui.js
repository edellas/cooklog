// Componenti di interfaccia condivisi: escape HTML, toast, fogli a comparsa, conferme, avatar.

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

export function vibra(ms = 8) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* non supportato */
  }
}

let timerToast;
export function toast(msg, tipo = "") {
  let t = $("#toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.setAttribute("role", "status");
    t.setAttribute("aria-live", "polite");
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = "on " + tipo;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => (t.className = tipo), 2600);
}

// Foglio a comparsa dal basso (bottom sheet). Restituisce l'elemento del contenuto.
export function apriFoglio(html, { alMontaggio, classe = "" } = {}) {
  chiudiFoglio(true);
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.id = "foglio";
  ov.innerHTML = `<div class="foglio ${classe}" role="dialog" aria-modal="true"><div class="maniglia" aria-hidden="true"></div>${html}</div>`;
  ov.addEventListener("click", (e) => {
    if (e.target === ov) chiudiFoglio();
  });
  document.body.appendChild(ov);
  document.body.classList.add("con-foglio");
  const foglio = ov.firstElementChild;
  const primo = foglio.querySelector("input:not([type=hidden]):not([readonly]), textarea, select");
  if (primo && !primo.dataset.noFocus && matchMedia("(pointer: fine)").matches) primo.focus();
  alMontaggio?.(foglio);
  return foglio;
}

export function chiudiFoglio(subito = false) {
  const ov = $("#foglio");
  if (!ov) return;
  if (ov._allaChiusura) ov._allaChiusura();
  ov.removeAttribute("id");
  document.body.classList.remove("con-foglio");
  if (subito || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    ov.remove();
    return;
  }
  ov.classList.add("esce");
  setTimeout(() => ov.remove(), 180);
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
