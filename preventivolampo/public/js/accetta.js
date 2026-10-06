// Pagina del cliente: mostra il preventivo arrivato via link, permette di scegliere le voci
// facoltative, firmare e rimandare l'accettazione all'impresa. Nessun dato lascia il telefono
// del cliente se non nel messaggio che il cliente stesso decide di inviare.
import { leggiLinkAccettazione, creaLinkConferma } from "./link.js";
import { calcolaTotali, formatEuro, formatQta, formatData, oggiISO, scadenzaDi, telefonoWhatsApp } from "./core.js";
import { creaPadFirma, decodificaTratti, trattiInPng } from "./firma.js";
import { $, $$, esc, toast, apriFoglio, chiudiFoglio, titoloFoglio, copiaTesto, vibra, avatar } from "./ui.js";
import { ICONE } from "./icone.js";
import { CONFIG } from "./config.js";

const BASE = new URL(".", location.href).href;
const app = () => $("#app");

const stato = {
  prev: null,
  hash: "",
  scelte: new Set(),
  accettazione: null, // { link, nome, data, scelte, firma }
  pad: null,
};

const memoria = {
  chiave: () => "pl-accettato-" + stato.hash,
  leggi() {
    try {
      return JSON.parse(localStorage.getItem(this.chiave()) || "null");
    } catch {
      return null;
    }
  },
  scrivi(v) {
    try {
      localStorage.setItem(this.chiave(), JSON.stringify(v));
    } catch {
      /* archiviazione non disponibile: la conferma resta valida in questa sessione */
    }
  },
};

function prevConScelte() {
  const p = stato.prev;
  return { ...p, righe: p.righe.map((r, i) => (r.opzionale && stato.scelte.has(i) ? { ...r, opzionale: false } : r)) };
}

const totali = () =>
  calcolaTotali(prevConScelte(), { regime: stato.prev.regime, addebitaBollo: stato.prev.addebitaBollo });

function scaduto() {
  const s = scadenzaDi(stato.prev);
  return Boolean(s && s < oggiISO());
}

function errore(messaggio) {
  document.title = "Link non valido";
  app().innerHTML = `<main class="pagina" style="padding-top:40px">
    <div class="card vuoto">
      <div class="illustrazione">${ICONE.link}</div>
      <h3>Non riesco ad aprire questo preventivo</h3>
      <p class="muted">${esc(messaggio)}. Il link potrebbe essere stato tagliato durante l'invio: chiedi a chi te l'ha mandato di inviarlo di nuovo.</p>
    </div></main>`;
}

function contatti(a, testoWa) {
  const tel = telefonoWhatsApp(a.telefono);
  const voci = [];
  if (tel)
    voci.push(
      `<a class="btn wa" href="https://wa.me/${tel}?text=${encodeURIComponent(testoWa)}" target="_blank" rel="noopener noreferrer">${ICONE.whatsapp} WhatsApp</a>`,
    );
  if (a.telefono)
    voci.push(`<a class="btn" href="tel:${esc(a.telefono.replace(/\s/g, ""))}">${ICONE.telefono} Chiama</a>`);
  if (a.email) voci.push(`<a class="btn" href="mailto:${esc(a.email)}">${ICONE.mail} Email</a>`);
  return voci.length ? `<div class="grid2">${voci.join("")}</div>` : "";
}

function htmlVoce(r) {
  return `<div class="cp-voce">
    <div class="corpo"><div class="d">${esc(r.descrizione || "Voce")}</div>
      <div class="muted xsmall tnum">${esc(formatQta(r.qta))} ${esc(r.um)} × ${esc(formatEuro(r.prezzo))}${r.sconto > 0 ? ` · sconto ${esc(formatQta(r.sconto))}%` : ""}</div></div>
    <div class="imp tnum">${esc(formatEuro(r.importo))}</div></div>`;
}

function htmlRiepilogo(t) {
  const r = (et, v, cls = "") => `<div class="r ${cls}"><span>${et}</span><b>${v}</b></div>`;
  let h = "";
  if (t.scontoImporto > 0) h += r(`Sconto ${esc(formatQta(t.scontoPerc))}%`, "- " + esc(formatEuro(t.scontoImporto)));
  h += r(t.forfettario ? "Totale prestazioni" : "Imponibile", esc(formatEuro(t.imponibile)));
  if (!t.forfettario) for (const g of t.riepilogoIva) h += r(`IVA ${esc(g.aliquota)}%`, esc(formatEuro(g.imposta)));
  if (t.bollo > 0) h += r("Imposta di bollo", esc(formatEuro(t.bollo)));
  h += r("<b>Totale</b>", `<span class="big">${esc(formatEuro(t.totale))}</span>`, "tot");
  if (t.acconto > 0)
    h += r("Acconto all'accettazione", esc(formatEuro(t.acconto))) + r("Saldo a fine lavori", esc(formatEuro(t.saldo)));
  return h;
}

function aggiornaTotali() {
  const t = totali();
  $("#cp-riepilogo").innerHTML = htmlRiepilogo(t);
  $("#cp-totale").textContent = formatEuro(t.totale);
}

function pagina() {
  const p = stato.prev;
  const a = p.azienda;
  const t = totali();
  const s = scadenzaDi(p);
  const scad = scaduto();
  document.title = `Preventivo ${p.numero} - ${a.ragioneSociale || "Preventivo"}`;
  const opz = p.righe.map((r, i) => ({ r, i })).filter((x) => x.r.opzionale);
  const tutte = calcolaTotali(p, { regime: p.regime, addebitaBollo: p.addebitaBollo });
  const importoOpz = new Map(tutte.opzionali.map((r) => [r.id, r.importo]));

  app().innerHTML = `
    <header class="cp-testa" style="--accento:${esc(a.colore)}">
      <div class="cp-azienda">${avatar(a.ragioneSociale || "?", "small")}<div><b>${esc(a.ragioneSociale || "Impresa")}</b>${a.piva ? `<div class="xsmall">P.IVA ${esc(a.piva)}</div>` : ""}</div></div>
      <div class="cp-num">Preventivo n. ${esc(p.numero)} · ${esc(formatData(p.data))}</div>
      <h1>${esc(p.oggetto || "Preventivo")}</h1>
      ${p.cliente.nome ? `<div class="cp-per">Per ${esc(p.cliente.nome)}${p.luogo ? ` · ${esc(p.luogo)}` : ""}</div>` : ""}
      ${s ? `<span class="badge ${scad ? "rifiutato" : "nodot cp-valid"}">${scad ? "Scaduto il" : "Valido fino al"} ${esc(formatData(s))}</span>` : ""}
    </header>
    <main class="pagina cp-corpo">
      ${scad ? `<div class="banner warn"><span class="ico">⏰</span><div>Questo preventivo è scaduto. Chiedi a ${esc(a.ragioneSociale || "l'impresa")} di aggiornarlo.</div></div>` : ""}
      <section class="card">
        <div class="sezione-titolo"><span class="ico">${ICONE.lavoro}</span><h2>Lavori compresi</h2></div>
        <div class="cp-voci">${tutte.righe.map(htmlVoce).join("") || `<p class="muted">Nessuna voce.</p>`}</div>
      </section>
      ${
        opz.length
          ? `<section class="card">
        <div class="sezione-titolo"><span class="ico" style="background:var(--warn-soft);color:var(--warn)">${ICONE.scintille}</span><div><h2>Puoi aggiungere</h2><div class="muted xsmall">Voci facoltative: attivale se ti interessano</div></div></div>
        ${opz
          .map(
            ({ r, i }) => `<label class="cp-opz">
            <div class="corpo"><div class="d">${esc(r.descrizione || "Voce")}</div><div class="muted xsmall tnum">${esc(formatQta(r.qta))} ${esc(r.um)} × ${esc(formatEuro(r.prezzo))}</div></div>
            <b class="tnum">+ ${esc(formatEuro(importoOpz.get(r.id) || 0))}</b>
            <span class="switch"><input type="checkbox" data-opz="${i}" ${stato.scelte.has(i) ? "checked" : ""} ${stato.accettazione || scad ? "disabled" : ""} aria-label="Aggiungi ${esc(r.descrizione)}"><span></span></span>
          </label>`,
          )
          .join("")}
      </section>`
          : ""
      }
      <section class="card riepilogo" id="cp-riepilogo">${htmlRiepilogo(t)}</section>
      ${
        p.tempi || p.pagamento || p.note || a.iban
          ? `<section class="card stack">
        <div class="sezione-titolo" style="margin:0"><span class="ico">${ICONE.condizioni}</span><h2>Condizioni</h2></div>
        ${p.tempi ? `<div><div class="muted xsmall">TEMPI</div><div>${esc(p.tempi)}</div></div>` : ""}
        ${p.pagamento ? `<div><div class="muted xsmall">PAGAMENTO</div><div class="cp-testo">${esc(p.pagamento)}</div></div>` : ""}
        ${p.note ? `<details><summary>Note e condizioni</summary><div class="cp-testo small">${esc(p.note)}</div></details>` : ""}
        ${p.regime === "forfettario" && a.fraseForfettario ? `<div class="muted xsmall">${esc(a.fraseForfettario)}</div>` : ""}
      </section>`
          : ""
      }
      <section class="card stack">
        <div class="sezione-titolo" style="margin:0"><span class="ico">${ICONE.telefono}</span><h2>Domande? Contatta l'impresa</h2></div>
        ${contatti(a, `Buongiorno, ho una domanda sul preventivo n. ${p.numero}.`)}
      </section>
      <p class="muted xsmall cp-avviso">Documento inviato da ${esc(a.ragioneSociale || "un'impresa")}${a.citta ? `, ${esc(a.citta)}` : ""}. ${esc(CONFIG.nomeProdotto)} non verifica l'identità di chi invia il preventivo né gli importi: accetta ed effettua pagamenti solo se conosci chi te l'ha mandato.</p>
      ${p.conMarchio ? `<p class="xsmall cp-marchio">Creato con <a href="${esc(CONFIG.sito)}" target="_blank" rel="noopener">${esc(CONFIG.nomeProdotto)}</a> · preventivi dal telefono in 60 secondi</p>` : ""}
    </main>
    <footer class="barra-totale">
      <div class="tot"><div class="muted xsmall">${p.regime === "forfettario" ? "Totale" : "Totale IVA inclusa"}</div><div class="big" id="cp-totale">${esc(formatEuro(t.totale))}</div></div>
      <button class="btn primary big" data-azione="accetta" ${scad ? "disabled" : ""}>${ICONE.firma}<span>Accetta e firma</span></button>
    </footer>`;
  $$("[data-opz]").forEach((el) =>
    el.addEventListener("change", () => {
      const i = Number(el.dataset.opz);
      if (el.checked) stato.scelte.add(i);
      else stato.scelte.delete(i);
      vibra();
      aggiornaTotali();
    }),
  );
}

function foglioFirma() {
  if (scaduto()) return;
  const p = stato.prev;
  const t = totali();
  const f = apriFoglio(
    `${titoloFoglio("Accetta e firma", `Totale ${esc(formatEuro(t.totale))}${stato.scelte.size ? ` · ${stato.scelte.size} voci facoltative aggiunte` : ""}`)}
    <div class="stack">
      <input id="acc-nome" autocomplete="name" placeholder="Nome e cognome" value="${esc(p.cliente.nome)}" data-no-focus="1">
      <div><div class="row spazia"><span class="muted small">Firma con il dito nel riquadro</span><button class="btn ghost small" data-azione="cancella-firma">Cancella</button></div>
      <canvas class="firma" id="acc-firma" aria-label="Riquadro per la firma"></canvas></div>
      <label class="check"><input type="checkbox" id="acc-ok"> <span>Ho letto il preventivo e accetto lavori, prezzi e condizioni indicati.</span></label>
      <button class="btn primary big block" data-azione="conferma">${ICONE.check} Conferma accettazione</button>
    </div>`,
  );
  stato.pad = creaPadFirma($("#acc-firma", f));
  f.parentElement._allaChiusura = () => stato.pad?.distruggi();
}

async function conferma() {
  const p = stato.prev;
  const nome = $("#acc-nome").value.trim();
  if (nome.length < 2) return toast("Scrivi nome e cognome");
  if (!stato.pad.valida()) return toast("Firma nel riquadro");
  if (!$("#acc-ok").checked) return toast("Spunta la casella per accettare");
  const scelte = [...stato.scelte].sort((x, y) => x - y);
  const firma = stato.pad.codificata();
  const link = await creaLinkConferma(BASE, {
    id: p.id,
    numero: p.numero,
    hash: stato.hash,
    scelte,
    descrizioni: scelte.map((i) => p.righe[i].descrizione),
    nome,
    firma,
  });
  stato.accettazione = { link, nome, data: new Date().toISOString(), scelte, firma };
  memoria.scrivi(stato.accettazione);
  chiudiFoglio();
  vibra(30);
  successo(true);
}

function testoConferma() {
  const p = stato.prev;
  const t = totali();
  const aggiunte = stato.accettazione.scelte.map((i) => p.righe[i]?.descrizione).filter(Boolean);
  return (
    `Buongiorno, ho accettato il preventivo n. ${p.numero}${p.oggetto ? ` "${p.oggetto}"` : ""} per un totale di ${formatEuro(t.totale)}.` +
    (aggiunte.length ? ` Ho aggiunto: ${aggiunte.join(", ")}.` : "") +
    `\nEcco la conferma con la mia firma: ${stato.accettazione.link}`
  );
}

function successo(appena = false) {
  const p = stato.prev;
  const a = p.azienda;
  stato.scelte = new Set(stato.accettazione.scelte);
  const t = totali();
  const tel = telefonoWhatsApp(a.telefono);
  const testo = testoConferma();
  const quando = new Date(stato.accettazione.data);
  window.scrollTo(0, 0);
  app().innerHTML = `
    <main class="pagina cp-successo">
      <div class="cp-check ${appena ? "anima" : ""}">${ICONE.check}</div>
      <h1>Preventivo accettato</h1>
      <p class="muted">N. ${esc(p.numero)} · ${esc(formatEuro(t.totale))} · firmato da ${esc(stato.accettazione.nome)} il ${esc(formatData(oggiISO(quando)))}</p>
      <section class="card stack cp-passo">
        <div class="row"><span class="badge warn nodot">Ultimo passo</span></div>
        <h2>Avvisa ${esc(a.ragioneSociale || "l'impresa")}</h2>
        <p class="muted small" style="margin:0">Invia la conferma con un tocco: l'impresa la riceve con la tua firma e può programmare il lavoro.</p>
        <a class="btn wa big block" id="cp-invia-wa" href="https://wa.me/${tel}?text=${encodeURIComponent(testo)}" target="_blank" rel="noopener noreferrer">${ICONE.whatsapp} Invia conferma su WhatsApp</a>
        ${a.email ? `<a class="btn block" href="mailto:${esc(a.email)}?subject=${encodeURIComponent(`Accettazione preventivo n. ${p.numero}`)}&body=${encodeURIComponent(testo)}">${ICONE.mail} Invia per email</a>` : ""}
        <button class="btn ghost block" data-azione="copia-conferma">${ICONE.copia} Copia il link di conferma</button>
      </section>
      ${
        t.acconto > 0
          ? `<section class="card stack">
        <div class="sezione-titolo" style="margin:0"><span class="ico">${ICONE.euro}</span><div><h2>Acconto: ${esc(formatEuro(t.acconto))}</h2><div class="muted xsmall">Da versare all'accettazione${a.iban || a.linkPagamento ? "" : ": l'impresa ti dirà come"}</div></div></div>
        ${a.linkPagamento ? `<a class="btn primary block" href="${esc(a.linkPagamento)}" target="_blank" rel="noopener noreferrer">${ICONE.euro} Paga online <span class="xsmall" style="opacity:.8">(${esc(new URL(a.linkPagamento).hostname)})</span></a>` : ""}
        ${a.iban ? `<div class="cp-iban"><div><div class="muted xsmall">IBAN${a.intestatarioIban ? ` · ${esc(a.intestatarioIban)}` : ""}</div><b class="tnum">${esc(a.iban)}</b></div><button class="btn small" data-azione="copia-iban">${ICONE.copia} Copia</button></div>` : ""}
        <p class="muted xsmall" style="margin:0">Causale consigliata: Acconto preventivo n. ${esc(p.numero)}</p>
      </section>`
          : ""
      }
      <button class="btn block" data-azione="pdf">${ICONE.scarica} Scarica il preventivo firmato (PDF)</button>
      <p class="muted xsmall cp-avviso">${esc(CONFIG.nomeProdotto)} non verifica l'identità di chi invia il preventivo: effettua pagamenti solo se conosci l'impresa.</p>
    </main>`;
}

let pdfCaricato = null;
function carica(src) {
  return new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = () => ko(new Error("Impossibile caricare " + src));
    document.head.appendChild(s);
  });
}

async function scaricaPdf() {
  try {
    if (!pdfCaricato) {
      pdfCaricato = carica("vendor/jspdf.umd.min.js").then(() => carica("vendor/jspdf.plugin.autotable.min.js"));
    }
    await pdfCaricato;
    const { creaPdfBlob } = await import("./pdf.js");
    const p = prevConScelte();
    p.firma = {
      img: trattiInPng(decodificaTratti(stato.accettazione.firma)),
      nome: stato.accettazione.nome,
      luogo: "",
      data: stato.accettazione.data,
      online: true,
    };
    const a = stato.prev.azienda;
    const blob = creaPdfBlob({
      prev: p,
      azienda: { ...a, cap: "", provincia: "" },
      totali: calcolaTotali(p, { regime: p.regime, addebitaBollo: p.addebitaBollo }),
      pro: !stato.prev.conMarchio,
      config: CONFIG,
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Preventivo-${p.numero.replace(/[^\w-]+/g, "-")}-firmato.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    pdfCaricato = null;
    toast(err.message || "Impossibile creare il PDF");
  }
}

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-azione], [data-action]");
  if (!el) return;
  const azione = el.dataset.azione || el.dataset.action;
  if (azione === "chiudi-foglio") return chiudiFoglio();
  if (el.tagName !== "A") e.preventDefault();
  if (azione === "accetta") foglioFirma();
  if (azione === "cancella-firma") stato.pad?.cancella();
  if (azione === "conferma") conferma();
  if (azione === "copia-conferma")
    toast((await copiaTesto(stato.accettazione.link)) ? "Link copiato" : "Copia non riuscita");
  if (azione === "copia-iban")
    toast((await copiaTesto(stato.prev.azienda.iban.replace(/\s/g, ""))) ? "IBAN copiato" : "Copia non riuscita");
  if (azione === "pdf") scaricaPdf();
});

async function avvio() {
  const codice = location.hash.slice(1);
  if (!codice) return errore("Il link è vuoto");
  try {
    const { prev, hash } = await leggiLinkAccettazione(codice);
    stato.prev = prev;
    stato.hash = hash;
  } catch (err) {
    return errore(err.message || "Link non valido");
  }
  // Se il cliente riapre il link dopo aver già accettato, ritrova la conferma da inviare.
  const salvata = memoria.leggi();
  if (salvata && salvata.link && Array.isArray(salvata.scelte)) {
    stato.accettazione = salvata;
    successo();
  } else {
    pagina();
  }
}

// Un nuovo link aperto nella stessa scheda: si riparte da capo senza ricaricare la pagina
// (un ricaricamento a metà farebbe perdere la firma in corso).
window.addEventListener("hashchange", () => {
  chiudiFoglio(true);
  stato.scelte = new Set();
  stato.accettazione = null;
  stato.pad = null;
  avvio();
});
avvio();
