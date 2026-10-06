// Pagina del cliente. Apre due tipi di link:
// - il preventivo: il cliente sceglie le voci facoltative e la data di inizio, firma e rimanda
//   l'accettazione all'impresa; poi può versare subito l'acconto (QR, IBAN o link) e avvisare;
// - la richiesta di pagamento (sollecito): importo, QR del bonifico e pulsante "Ho pagato".
// Nessun dato lascia il telefono del cliente se non nei messaggi che il cliente stesso decide di inviare.
import { leggiLinkCliente, creaLinkConferma, creaLinkAvviso } from "./link.js";
import { calcolaTotali, formatEuro, formatQta, formatData, oggiISO, scadenzaDi, telefonoWhatsApp } from "./core.js";
import { payloadEpc, causale, ibanValido, testoAppuntamento, creaIcs, METODI } from "./incassi.js";
import { svgQr } from "./qr.js";
import { creaPadFirma, decodificaTratti, trattiInPng } from "./firma.js";
import { $, $$, esc, toast, apriFoglio, chiudiFoglio, titoloFoglio, copiaTesto, vibra, avatar } from "./ui.js";
import { ICONE } from "./icone.js";
import { CONFIG } from "./config.js";

const BASE = new URL(".", location.href).href;
const app = () => $("#app");

const stato = {
  tipo: "preventivo",
  prev: null,
  richiesta: null,
  hash: "",
  scelte: new Set(),
  accettazione: null, // { link, nome, data, scelte, firma, appuntamento, pagamento }
  pagamento: null, // solo per le richieste di pagamento: { importo, metodo, il, link }
  pad: null,
};

const memoria = {
  chiave: () => (stato.tipo === "pagamento" ? "pl-pagato-" : "pl-accettato-") + stato.hash,
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

const azienda = () => (stato.tipo === "pagamento" ? stato.richiesta.azienda : stato.prev.azienda);
const nomeAnticipo = (p) => (p.caparra ? "Caparra confirmatoria" : "Acconto");

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
      <h3>Non riesco ad aprire questo link</h3>
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
    h +=
      r(`${nomeAnticipo(stato.prev)} all'accettazione`, esc(formatEuro(t.acconto))) +
      r("Saldo a fine lavori", esc(formatEuro(t.saldo)));
  return h;
}

function aggiornaTotali() {
  const t = totali();
  $("#cp-riepilogo").innerHTML = htmlRiepilogo(t);
  $("#cp-totale").textContent = formatEuro(t.totale);
}

// ------------------------------------------------------------------
// Pagamento: QR del bonifico, IBAN, link e "Ho pagato"
// ------------------------------------------------------------------
function htmlPaga(a, importo, causaleTesto) {
  const payload = ibanValido(a.iban)
    ? payloadEpc({ nome: a.intestatarioIban || a.ragioneSociale, iban: a.iban, importo, causale: causaleTesto })
    : null;
  return `
    ${
      payload
        ? `<div class="qr-box"><div class="qr">${svgQr(payload, { etichetta: `QR per pagare ${formatEuro(importo)} con bonifico` })}</div>
        <div class="muted xsmall">Inquadra il QR con l'app della tua banca: importo, IBAN e causale si compilano da soli. Se la tua app non legge i QR SEPA, copia l'IBAN qui sotto.</div></div>`
        : ""
    }
    ${a.linkPagamento ? `<a class="btn primary block" href="${esc(a.linkPagamento)}" target="_blank" rel="noopener noreferrer">${ICONE.euro} Paga online <span class="xsmall" style="opacity:.8">(${esc(new URL(a.linkPagamento).hostname)})</span></a>` : ""}
    ${a.iban ? `<div class="cp-iban"><div><div class="muted xsmall">IBAN${a.intestatarioIban ? ` · ${esc(a.intestatarioIban)}` : ""}</div><b class="tnum">${esc(a.iban)}</b></div><button class="btn small" data-azione="copia-iban">${ICONE.copia} Copia</button></div>` : ""}
    <div class="cp-iban"><div><div class="muted xsmall">Causale</div><b>${esc(causaleTesto)}</b></div><button class="btn small" data-azione="copia-causale" data-testo="${esc(causaleTesto)}">${ICONE.copia} Copia</button></div>`;
}

function htmlSegnalato(seg) {
  return `<div class="banner ok"><span class="ico">✅</span><div>Hai segnalato il pagamento di <b>${esc(formatEuro(seg.importo))}</b> il ${esc(formatData(oggiISO(new Date(seg.il))))}. Se non l'hai ancora fatto, invia l'avviso all'impresa.</div></div>
    <a class="btn wa block" id="cp-avviso-wa" href="${esc(linkWa(azienda(), testoAvviso(seg)))}" target="_blank" rel="noopener noreferrer">${ICONE.whatsapp} Invia l'avviso su WhatsApp</a>
    <button class="btn ghost block" data-azione="copia-avviso">${ICONE.copia} Copia l'avviso</button>`;
}

function linkWa(a, testo) {
  return `https://wa.me/${telefonoWhatsApp(a.telefono)}?text=${encodeURIComponent(testo)}`;
}

function testoAvviso(seg) {
  const numero = stato.tipo === "pagamento" ? stato.richiesta.numero : stato.prev.numero;
  return (
    `Buongiorno, ho pagato ${formatEuro(seg.importo)} per il preventivo n. ${numero} (${METODI[seg.metodo] || "pagamento"}${seg.nota ? `: ${seg.nota}` : ""}).` +
    `\nEcco l'avviso da registrare: ${seg.link}`
  );
}

// Dati del pagamento da segnalare, a seconda della pagina aperta.
function pagamentoCorrente() {
  if (stato.tipo === "pagamento") {
    const r = stato.richiesta;
    return { id: r.id, numero: r.numero, importo: r.importo, causale: r.causale || causale(r, r.tipo) };
  }
  const p = stato.prev;
  return { id: p.id, numero: p.numero, importo: totali().acconto, causale: causale(p, "acconto") };
}

function foglioHoPagato() {
  const pg = pagamentoCorrente();
  const a = azienda();
  const metodi = [a.iban ? "bonifico" : "", a.linkPagamento ? "online" : "", "contanti", "carta", "altro"].filter(
    Boolean,
  );
  apriFoglio(
    `${titoloFoglio("Hai pagato?", `${esc(formatEuro(pg.importo))} · ${esc(pg.causale)}`)}
    <div class="stack">
      <div class="scelta" role="radiogroup" aria-label="Come hai pagato">
        ${metodi.map((m, i) => `<label><input type="radio" name="hp-metodo" value="${m}" ${i === 0 ? "checked" : ""}><span>${esc(METODI[m])}</span></label>`).join("")}
      </div>
      <input id="hp-nota" maxlength="200" placeholder="Nota facoltativa (es. data o CRO del bonifico)" aria-label="Nota" data-no-focus="1">
      <p class="muted xsmall" style="margin:0">L'impresa riceverà un avviso da controllare con il suo conto: il pagamento risulta solo quando lo conferma.</p>
      <button class="btn primary big block" data-azione="hp-conferma">${ICONE.check} Prepara l'avviso</button>
    </div>`,
  );
}

async function confermaHoPagato() {
  const pg = pagamentoCorrente();
  const metodo = $('input[name="hp-metodo"]:checked')?.value || "altro";
  const nota = $("#hp-nota").value.trim().slice(0, 200);
  const link = await creaLinkAvviso(BASE, {
    id: pg.id,
    numero: pg.numero,
    importo: pg.importo,
    metodo,
    data: oggiISO(),
    nota,
  });
  const seg = { importo: pg.importo, metodo, nota, il: Date.now(), link };
  if (stato.tipo === "pagamento") {
    stato.pagamento = seg;
    memoria.scrivi(seg);
  } else {
    stato.accettazione.pagamento = seg;
    memoria.scrivi(stato.accettazione);
  }
  chiudiFoglio();
  vibra(30);
  const box = $("#cp-pagato");
  if (box) box.innerHTML = htmlSegnalato(seg);
  box?.scrollIntoView({ block: "center", behavior: "smooth" });
}

// ------------------------------------------------------------------
// Preventivo da accettare
// ------------------------------------------------------------------
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
        p.disponibilita.length && !scad
          ? `<section class="card stack">
        <div class="sezione-titolo" style="margin:0"><span class="ico">${ICONE.orologio}</span><div><h2>Quando iniziamo?</h2><div class="muted xsmall">Scegli una data quando accetti</div></div></div>
        <div class="row wrap">${p.disponibilita.map((d) => `<span class="chip">${esc(testoAppuntamento(d))}</span>`).join("")}</div>
      </section>`
          : ""
      }
      ${
        p.tempi || p.pagamento || p.note || a.iban || (p.caparra && t.acconto > 0)
          ? `<section class="card stack">
        <div class="sezione-titolo" style="margin:0"><span class="ico">${ICONE.condizioni}</span><h2>Condizioni</h2></div>
        ${p.tempi ? `<div><div class="muted xsmall">TEMPI</div><div>${esc(p.tempi)}</div></div>` : ""}
        ${p.pagamento ? `<div><div class="muted xsmall">PAGAMENTO</div><div class="cp-testo">${esc(p.pagamento)}</div></div>` : ""}
        ${p.caparra && t.acconto > 0 ? `<div><div class="muted xsmall">CAPARRA CONFIRMATORIA</div><div class="small">${esc(FRASE_CAPARRA_BREVE)}</div></div>` : ""}
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

const FRASE_CAPARRA_BREVE =
  "L'anticipo è versato come caparra confirmatoria (art. 1385 c.c.): se il cliente non rispetta l'accordo l'impresa può trattenerla; se non lo rispetta l'impresa, il cliente può chiederne il doppio.";

function foglioFirma() {
  if (scaduto()) return;
  const p = stato.prev;
  const t = totali();
  const date = p.disponibilita;
  const f = apriFoglio(
    `${titoloFoglio("Accetta e firma", `Totale ${esc(formatEuro(t.totale))}${stato.scelte.size ? ` · ${stato.scelte.size} voci facoltative aggiunte` : ""}`)}
    <div class="stack">
      <input id="acc-nome" autocomplete="name" placeholder="Nome e cognome" value="${esc(p.cliente.nome)}" data-no-focus="1" aria-label="Nome e cognome">
      ${
        date.length
          ? `<div class="scelta" role="radiogroup" aria-label="Quando preferisci iniziare">
          <div class="muted small">Quando preferisci che iniziamo?</div>
          ${date.map((d, i) => `<label><input type="radio" name="acc-data" value="${i}"><span>${esc(testoAppuntamento(d))}</span></label>`).join("")}
          <label><input type="radio" name="acc-data" value="-1" checked><span>Decidiamo insieme<small>L'impresa ti contatterà per fissare la data</small></span></label>
        </div>`
          : ""
      }
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
  const ap = Number($('input[name="acc-data"]:checked')?.value ?? -1);
  const appuntamento = Number.isInteger(ap) && ap >= 0 && ap < p.disponibilita.length ? ap : -1;
  const link = await creaLinkConferma(BASE, {
    id: p.id,
    numero: p.numero,
    hash: stato.hash,
    scelte,
    descrizioni: scelte.map((i) => p.righe[i].descrizione),
    nome,
    firma,
    appuntamento,
  });
  stato.accettazione = { link, nome, data: new Date().toISOString(), scelte, firma, appuntamento, pagamento: null };
  memoria.scrivi(stato.accettazione);
  chiudiFoglio();
  vibra(30);
  successo(true);
}

function dataScelta() {
  const i = stato.accettazione?.appuntamento;
  return Number.isInteger(i) && i >= 0 ? stato.prev.disponibilita[i] || null : null;
}

function testoConferma() {
  const p = stato.prev;
  const t = totali();
  const aggiunte = stato.accettazione.scelte.map((i) => p.righe[i]?.descrizione).filter(Boolean);
  const data = dataScelta();
  return (
    `Buongiorno, ho accettato il preventivo n. ${p.numero}${p.oggetto ? ` "${p.oggetto}"` : ""} per un totale di ${formatEuro(t.totale)}.` +
    (aggiunte.length ? ` Ho aggiunto: ${aggiunte.join(", ")}.` : "") +
    (data ? ` Per iniziare scelgo: ${testoAppuntamento(data)}.` : "") +
    `\nEcco la conferma con la mia firma: ${stato.accettazione.link}`
  );
}

function successo(appena = false) {
  const p = stato.prev;
  const a = p.azienda;
  stato.scelte = new Set(stato.accettazione.scelte);
  const t = totali();
  const testo = testoConferma();
  const quando = new Date(stato.accettazione.data);
  const data = dataScelta();
  const seg = stato.accettazione.pagamento;
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
        <a class="btn wa big block" id="cp-invia-wa" href="${esc(linkWa(a, testo))}" target="_blank" rel="noopener noreferrer">${ICONE.whatsapp} Invia conferma su WhatsApp</a>
        ${a.email ? `<a class="btn block" href="mailto:${esc(a.email)}?subject=${encodeURIComponent(`Accettazione preventivo n. ${p.numero}`)}&body=${encodeURIComponent(testo)}">${ICONE.mail} Invia per email</a>` : ""}
        <button class="btn ghost block" data-azione="copia-conferma">${ICONE.copia} Copia il link di conferma</button>
      </section>
      ${
        data
          ? `<section class="card stack">
        <div class="sezione-titolo" style="margin:0"><span class="ico">${ICONE.orologio}</span><div><h2>Inizio lavori</h2><div class="muted xsmall">${esc(testoAppuntamento(data))} · la data è confermata quando l'impresa riceve l'accettazione</div></div></div>
        <button class="btn block" data-azione="ics">${ICONE.orologio} Aggiungi al calendario</button>
      </section>`
          : ""
      }
      ${
        t.acconto > 0
          ? `<section class="card stack">
        <div class="sezione-titolo" style="margin:0"><span class="ico">${ICONE.euro}</span><div><h2>${esc(nomeAnticipo(p))}: ${esc(formatEuro(t.acconto))}</h2><div class="muted xsmall">Da versare all'accettazione${a.iban || a.linkPagamento ? "" : ": l'impresa ti dirà come"}</div></div></div>
        ${htmlPaga(a, t.acconto, causale(p, "acconto"))}
        <div id="cp-pagato" class="stack">${seg ? htmlSegnalato(seg) : `<button class="btn soft block" data-azione="ho-pagato">${ICONE.check} Ho pagato: avvisa l'impresa</button>`}</div>
      </section>`
          : ""
      }
      <button class="btn block" data-azione="pdf">${ICONE.scarica} Scarica il preventivo firmato (PDF)</button>
      <p class="muted xsmall cp-avviso">${esc(CONFIG.nomeProdotto)} non verifica l'identità di chi invia il preventivo: effettua pagamenti solo se conosci l'impresa.</p>
    </main>`;
}

// ------------------------------------------------------------------
// Richiesta di pagamento
// ------------------------------------------------------------------
function paginaPagamento() {
  const r = stato.richiesta;
  const a = r.azienda;
  const scad = r.scadenza && r.scadenza < oggiISO();
  const titolo = { acconto: r.caparra ? "Caparra" : "Acconto", saldo: "Saldo", residuo: "Importo da pagare" }[r.tipo];
  const caus = r.causale || causale(r, r.tipo);
  document.title = `Pagamento preventivo ${r.numero} - ${a.ragioneSociale || "Impresa"}`;
  app().innerHTML = `
    <header class="cp-testa" style="--accento:${esc(a.colore)}">
      <div class="cp-azienda">${avatar(a.ragioneSociale || "?", "small")}<div><b>${esc(a.ragioneSociale || "Impresa")}</b>${a.piva ? `<div class="xsmall">P.IVA ${esc(a.piva)}</div>` : ""}</div></div>
      <div class="cp-num">Richiesta di pagamento · Preventivo n. ${esc(r.numero)}</div>
      <h1 class="tnum">${esc(formatEuro(r.importo))}</h1>
      <div class="cp-per">${esc(titolo)}${r.oggetto ? ` · ${esc(r.oggetto)}` : ""}${r.cliente.nome ? ` · per ${esc(r.cliente.nome)}` : ""}</div>
      ${r.scadenza ? `<span class="badge ${scad ? "rifiutato" : "nodot"}">${scad ? "Scaduto il" : "Da pagare entro il"} ${esc(formatData(r.scadenza))}</span>` : ""}
    </header>
    <main class="pagina cp-corpo">
      ${
        r.totale > 0
          ? `<section class="card riepilogo">
        <div class="r"><span>Totale del preventivo</span><b class="tnum">${esc(formatEuro(r.totale))}</b></div>
        ${r.incassato > 0 ? `<div class="r"><span>Già pagato</span><b class="tnum">- ${esc(formatEuro(r.incassato))}</b></div>` : ""}
        <div class="r tot"><span><b>Da pagare ora</b></span><b><span class="big tnum">${esc(formatEuro(r.importo))}</span></b></div>
      </section>`
          : ""
      }
      <section class="card stack">
        <div class="sezione-titolo" style="margin:0"><span class="ico">${ICONE.euro}</span><h2>Come pagare</h2></div>
        ${htmlPaga(a, r.importo, caus)}
      </section>
      <section class="card stack">
        <div class="sezione-titolo" style="margin:0"><span class="ico">${ICONE.check}</span><div><h2>Hai già pagato?</h2><div class="muted xsmall">Avvisa l'impresa con un tocco</div></div></div>
        <div id="cp-pagato" class="stack">${stato.pagamento ? htmlSegnalato(stato.pagamento) : `<button class="btn primary block" data-azione="ho-pagato">${ICONE.check} Ho pagato</button>`}</div>
      </section>
      <section class="card stack">
        <div class="sezione-titolo" style="margin:0"><span class="ico">${ICONE.telefono}</span><h2>Domande? Contatta l'impresa</h2></div>
        ${contatti(a, `Buongiorno, la contatto per il pagamento del preventivo n. ${r.numero}.`)}
      </section>
      <p class="muted xsmall cp-avviso">Richiesta inviata da ${esc(a.ragioneSociale || "un'impresa")}. ${esc(CONFIG.nomeProdotto)} non verifica chi invia il link né l'IBAN indicato: paga solo se conosci l'impresa e l'IBAN è quello che ti ha comunicato.</p>
      ${r.conMarchio ? `<p class="xsmall cp-marchio">Creato con <a href="${esc(CONFIG.sito)}" target="_blank" rel="noopener">${esc(CONFIG.nomeProdotto)}</a></p>` : ""}
    </main>`;
}

// ------------------------------------------------------------------
// File: PDF firmato e calendario
// ------------------------------------------------------------------
function scaricaFile(blob, nome) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
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
    const data = dataScelta();
    if (data) p.appuntamento = { ...data, da: "cliente" };
    const a = stato.prev.azienda;
    const blob = creaPdfBlob({
      prev: p,
      azienda: { ...a, cap: "", provincia: "" },
      totali: calcolaTotali(p, { regime: p.regime, addebitaBollo: p.addebitaBollo }),
      pro: !stato.prev.conMarchio,
      config: CONFIG,
    });
    scaricaFile(blob, `Preventivo-${p.numero.replace(/[^\w-]+/g, "-")}-firmato.pdf`);
  } catch (err) {
    pdfCaricato = null;
    toast(err.message || "Impossibile creare il PDF");
  }
}

function scaricaIcs() {
  const p = stato.prev;
  const data = dataScelta();
  if (!data) return;
  const ics = creaIcs({
    id: p.id,
    titolo: `${p.azienda.ragioneSociale || "Lavori"}${p.oggetto ? ` - ${p.oggetto}` : ""}`,
    data: data.data,
    fascia: data.fascia,
    luogo: p.luogo || [p.cliente.indirizzo, p.cliente.citta].filter(Boolean).join(", "),
    descrizione: `Preventivo n. ${p.numero}${p.azienda.telefono ? `\nTel. ${p.azienda.telefono}` : ""}`,
  });
  scaricaFile(new Blob([ics], { type: "text/calendar" }), `Lavori-${p.numero.replace(/[^\w-]+/g, "-")}.ics`);
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
    toast((await copiaTesto(azienda().iban.replace(/\s/g, ""))) ? "IBAN copiato" : "Copia non riuscita");
  if (azione === "copia-causale")
    toast((await copiaTesto(el.dataset.testo || "")) ? "Causale copiata" : "Copia non riuscita");
  if (azione === "ho-pagato") foglioHoPagato();
  if (azione === "hp-conferma") confermaHoPagato();
  if (azione === "copia-avviso") {
    const seg = stato.tipo === "pagamento" ? stato.pagamento : stato.accettazione?.pagamento;
    if (seg) toast((await copiaTesto(testoAvviso(seg))) ? "Avviso copiato" : "Copia non riuscita");
  }
  if (azione === "ics") scaricaIcs();
  if (azione === "pdf") scaricaPdf();
});

// Quanto salvato sul telefono del cliente viene ricontrollato prima di essere mostrato.
function segnalazioneSalvata(s) {
  if (!s || typeof s !== "object" || typeof s.link !== "string" || !s.link.startsWith(BASE)) return null;
  const importo = Number(s.importo);
  if (!(importo > 0)) return null;
  return {
    importo,
    metodo: Object.hasOwn(METODI, s.metodo) ? s.metodo : "altro",
    nota: typeof s.nota === "string" ? s.nota.slice(0, 200) : "",
    il: Number.isFinite(s.il) ? s.il : Date.now(),
    link: s.link,
  };
}

async function avvio() {
  const codice = location.hash.slice(1);
  if (!codice) return errore("Il link è vuoto");
  try {
    const letto = await leggiLinkCliente(codice);
    stato.tipo = letto.tipo;
    stato.hash = letto.hash;
    stato.prev = letto.prev || null;
    stato.richiesta = letto.richiesta || null;
  } catch (err) {
    return errore(err.message || "Link non valido");
  }
  const salvata = memoria.leggi();
  if (stato.tipo === "pagamento") {
    stato.pagamento = segnalazioneSalvata(salvata);
    return paginaPagamento();
  }
  // Se il cliente riapre il link dopo aver già accettato, ritrova la conferma da inviare.
  if (salvata && typeof salvata.link === "string" && salvata.link.startsWith(BASE) && Array.isArray(salvata.scelte)) {
    stato.accettazione = {
      ...salvata,
      appuntamento: Number.isInteger(salvata.appuntamento) ? salvata.appuntamento : -1,
      pagamento: segnalazioneSalvata(salvata.pagamento),
    };
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
  stato.pagamento = null;
  stato.pad = null;
  avvio();
});
avvio();
