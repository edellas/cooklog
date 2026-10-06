// Generazione del PDF del preventivo (jsPDF + AutoTable, caricati come script globali).
import {
  formatEuro,
  formatQta,
  formatData,
  aggiungiGiorni,
  oggiISO,
  FRASE_FORFETTARIO,
  IMPORTO_BOLLO,
  nomeCliente,
} from "./core.js";
import {
  payloadEpc,
  causale,
  METODI,
  LIVELLI_SOLLECITO,
  normalizzaDisponibilita,
  normalizzaAppuntamento,
  testoAppuntamento,
  interessiMora,
  ibanValido,
} from "./incassi.js";
import { matriceQr, rettangoliQr } from "./qr.js";

const MARGINE = 15;
const GRIGIO = [90, 98, 110];
const NERO = [20, 24, 32];

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return [29, 78, 216];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function righeNonVuote(...valori) {
  return valori.map((v) => (v == null ? "" : String(v).trim())).filter(Boolean);
}

const due = (n) => String(n).padStart(2, "0");
function dataOra(v) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatData(oggiISO(d))} ore ${due(d.getHours())}:${due(d.getMinutes())}`;
}

export const FRASE_CAPARRA =
  "La somma è versata a titolo di caparra confirmatoria ai sensi dell'art. 1385 c.c.: se il cliente è inadempiente l'impresa può recedere dal contratto e trattenerla; se inadempiente è l'impresa, il cliente può recedere ed esigerne il doppio.";

// QR del bonifico SEPA (vettoriale: nitido anche stampato). Restituisce false se l'IBAN non è valido.
function disegnaQr(doc, payload, x, y, lato) {
  if (!payload) return false;
  const m = matriceQr(payload);
  const modulo = lato / (m.length + 4);
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, lato, lato, "F");
  doc.setFillColor(0, 0, 0);
  for (const q of rettangoliQr(m)) doc.rect(x + (q.x + 2) * modulo, y + (q.y + 2) * modulo, q.w * modulo, modulo, "F");
  return true;
}

function payloadPerImporto(azienda, importo, causaleTesto) {
  if (!ibanValido(azienda.iban)) return null;
  return payloadEpc({
    nome: azienda.intestatarioIban || azienda.ragioneSociale,
    iban: azienda.iban,
    importo,
    causale: causaleTesto,
  });
}

// Riquadro "Paga con il QR": QR a sinistra, istruzioni a destra.
function riquadroQr(doc, { x, y, larghezza, payload, titolo, righe, accento }) {
  const lato = 30;
  const h = lato + 6;
  doc.setDrawColor(...accento);
  doc.setLineWidth(0.4);
  doc.roundedRect(x, y, larghezza, h, 2, 2, "S");
  disegnaQr(doc, payload, x + 3, y + 3, lato);
  const xt = x + lato + 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...accento);
  doc.text(titolo, xt, y + 9);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...NERO);
  let yy = y + 14;
  for (const r of righe) {
    for (const l of doc.splitTextToSize(r, larghezza - lato - 12)) {
      doc.text(l, xt, yy);
      yy += 3.7;
    }
  }
  return h;
}

// opts: { prev, azienda, totali, pro, config, linkAccettazione, fascicolo }
// fascicolo: { stato } (da statoIncasso) -> aggiunge in fondo il "fascicolo del credito".
export function creaPdf({ prev, azienda, totali, pro, config, linkAccettazione = "", fascicolo = null }) {
  const { jsPDF } = globalThis.jspdf;
  const autoTable = globalThis.autoTable;
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const accento = pro ? hexRgb(azienda.colore) : hexRgb("#1d4ed8");
  const larghezza = W - MARGINE * 2;
  const fondo = H - 18; // spazio riservato al piè di pagina

  doc.setProperties({
    title: `Preventivo ${prev.numero}`,
    subject: prev.oggetto || "Preventivo",
    author: azienda.ragioneSociale || "",
    creator: config.nomeProdotto,
  });

  let y = MARGINE;

  // --- Intestazione: logo + dati impresa a sinistra, titolo a destra ---
  let xTesto = MARGINE;
  if (pro && azienda.logo) {
    try {
      const p = doc.getImageProperties(azienda.logo);
      const maxW = 38;
      const maxH = 22;
      const scala = Math.min(maxW / p.width, maxH / p.height);
      const w = p.width * scala;
      const h = p.height * scala;
      doc.addImage(azienda.logo, p.fileType || "PNG", MARGINE, y, w, h);
      xTesto = MARGINE + w + 5;
    } catch {
      /* logo non leggibile: si ignora */
    }
  }

  doc.setTextColor(...NERO);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  const nomeImpresa = azienda.ragioneSociale || "La tua impresa";
  doc.text(doc.splitTextToSize(nomeImpresa, 95 - (xTesto - MARGINE)), xTesto, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIGIO);
  const datiImpresa = righeNonVuote(
    azienda.indirizzo,
    [azienda.cap, azienda.citta, azienda.provincia ? `(${azienda.provincia})` : ""].filter(Boolean).join(" "),
    [azienda.piva ? `P.IVA ${azienda.piva}` : "", azienda.cf && azienda.cf !== azienda.piva ? `C.F. ${azienda.cf}` : ""]
      .filter(Boolean)
      .join(" - "),
    [azienda.telefono ? `Tel. ${azienda.telefono}` : "", azienda.email].filter(Boolean).join(" - "),
    azienda.pec ? `PEC ${azienda.pec}` : "",
    azienda.sito,
  );
  let yImpresa = y + 10.5;
  for (const r of datiImpresa) {
    doc.text(r, xTesto, yImpresa);
    yImpresa += 3.8;
  }

  doc.setTextColor(...accento);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("PREVENTIVO", W - MARGINE, y + 6, { align: "right" });
  doc.setFontSize(9.5);
  doc.setTextColor(...NERO);
  doc.text(`N. ${prev.numero}`, W - MARGINE, y + 12, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GRIGIO);
  doc.text(`Data: ${formatData(prev.data)}`, W - MARGINE, y + 16.5, { align: "right" });
  if (Number(prev.validitaGiorni) > 0) {
    doc.text(`Valido fino al: ${formatData(aggiungiGiorni(prev.data, prev.validitaGiorni))}`, W - MARGINE, y + 21, {
      align: "right",
    });
  }

  y = Math.max(yImpresa, y + 25) + 2;
  doc.setDrawColor(...accento);
  doc.setLineWidth(0.6);
  doc.line(MARGINE, y, W - MARGINE, y);
  y += 6;

  // --- Cliente e luogo intervento ---
  const c = prev.cliente || {};
  const colonna = larghezza / 2 - 3;
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...accento);
  doc.text("SPETT.LE CLIENTE", MARGINE, y);
  if (prev.luogo) doc.text("LUOGO DELL'INTERVENTO", MARGINE + colonna + 6, y);
  y += 4.5;
  doc.setTextColor(...NERO);
  doc.setFontSize(10.5);
  doc.text(doc.splitTextToSize(c.nome || "-", colonna), MARGINE, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIGIO);
  let yCli = y + 4.5;
  for (const r of righeNonVuote(
    c.indirizzo,
    c.citta,
    c.cfpiva ? `C.F./P.IVA ${c.cfpiva}` : "",
    [c.telefono ? `Tel. ${c.telefono}` : "", c.email].filter(Boolean).join(" - "),
  )) {
    doc.text(doc.splitTextToSize(r, colonna), MARGINE, yCli);
    yCli += 3.8;
  }
  let yLuogo = y;
  if (prev.luogo) {
    doc.setFontSize(9);
    doc.setTextColor(...NERO);
    const linee = doc.splitTextToSize(prev.luogo, colonna);
    doc.text(linee, MARGINE + colonna + 6, y);
    yLuogo = y + linee.length * 4;
  }
  y = Math.max(yCli, yLuogo) + 3;

  // --- Oggetto ---
  if (prev.oggetto) {
    doc.setFillColor(244, 246, 250);
    const linee = doc.splitTextToSize(prev.oggetto, larghezza - 24);
    const h = 4 + linee.length * 4.4;
    doc.rect(MARGINE, y, larghezza, h, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...accento);
    doc.text("OGGETTO:", MARGINE + 3, y + 5);
    doc.setTextColor(...NERO);
    doc.setFontSize(9.5);
    doc.text(linee, MARGINE + 21, y + 5);
    y += h + 4;
  }

  // --- Tabella voci ---
  const righe = totali.righe;
  const conSconto = righe.some((r) => Number(r.sconto) > 0);
  const aliquote = new Set(righe.map((r) => Number(r.iva)));
  const conIva = !totali.forfettario && aliquote.size > 1;

  const head = ["Descrizione", "Q.tà", "U.m.", "Prezzo"];
  if (conSconto) head.push("Sc.%");
  if (conIva) head.push("IVA");
  head.push("Importo");

  const body = righe.map((r) => {
    const riga = [r.descrizione || "", formatQta(r.qta), r.um || "", formatEuro(r.prezzo)];
    if (conSconto) riga.push(Number(r.sconto) > 0 ? formatQta(r.sconto) : "");
    if (conIva) riga.push(`${r.iva}%`);
    riga.push(formatEuro(r.importo));
    return riga;
  });

  const colonne = {};
  let i = 1;
  colonne[i++] = { halign: "right", cellWidth: 14 };
  colonne[i++] = { halign: "center", cellWidth: 16 };
  colonne[i++] = { halign: "right", cellWidth: 24 };
  if (conSconto) colonne[i++] = { halign: "right", cellWidth: 12 };
  if (conIva) colonne[i++] = { halign: "right", cellWidth: 12 };
  colonne[i] = { halign: "right", cellWidth: 26, fontStyle: "bold" };

  autoTable(doc, {
    startY: y,
    head: [head],
    body: body.length
      ? body
      : [[{ content: "Nessuna voce inserita", colSpan: head.length, styles: { halign: "center" } }]],
    theme: "plain",
    margin: { left: MARGINE, right: MARGINE, bottom: 22 },
    styles: {
      font: "helvetica",
      fontSize: 8.8,
      cellPadding: { top: 2.2, bottom: 2.2, left: 2, right: 2 },
      textColor: NERO,
      overflow: "linebreak",
    },
    headStyles: { fillColor: accento, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8.3 },
    alternateRowStyles: { fillColor: [248, 249, 251] },
    columnStyles: colonne,
    didParseCell: (d) => {
      if (d.section === "head" && d.column.index > 0) d.cell.styles.halign = colonne[d.column.index]?.halign || "left";
    },
  });
  y = doc.lastAutoTable.finalY + 5;

  function spazio(altezza) {
    if (y + altezza > fondo) {
      doc.addPage();
      y = MARGINE;
    }
  }

  // --- Totali ---
  const voci = [];
  const haMan = totali.subtotali.man > 0;
  const haMat = totali.subtotali.mat > 0;
  if (haMan && haMat) {
    voci.push(["di cui manodopera", formatEuro(totali.subtotali.man), "piccolo"]);
    voci.push(["di cui materiali e forniture", formatEuro(totali.subtotali.mat), "piccolo"]);
  }
  if (totali.scontoImporto > 0) {
    voci.push(["Totale voci", formatEuro(totali.imponibileRighe)]);
    voci.push([`Sconto ${formatQta(totali.scontoPerc)}%`, "- " + formatEuro(totali.scontoImporto)]);
  }
  voci.push([totali.forfettario ? "Totale prestazioni" : "Imponibile", formatEuro(totali.imponibile)]);
  if (!totali.forfettario) {
    for (const g of totali.riepilogoIva) {
      const etichetta =
        totali.riepilogoIva.length > 1 ? `IVA ${g.aliquota}% su ${formatEuro(g.imponibile)}` : `IVA ${g.aliquota}%`;
      voci.push([etichetta, formatEuro(g.imposta)]);
    }
  }
  if (totali.bollo > 0) voci.push(["Imposta di bollo", formatEuro(IMPORTO_BOLLO)]);

  const xEt = W - MARGINE - 82;
  spazio(voci.length * 5.5 + 26);
  doc.setFontSize(9);
  for (const [et, val, stile] of voci) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(stile === "piccolo" ? 8 : 9);
    doc.setTextColor(...(stile === "piccolo" ? GRIGIO : NERO));
    doc.text(et, xEt, y);
    doc.text(val, W - MARGINE - 2, y, { align: "right" });
    y += stile === "piccolo" ? 4.3 : 5.3;
  }
  y += 0.5;
  doc.setFillColor(...accento);
  doc.rect(xEt - 3, y - 4.6, 82 + 3, 9, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.text(totali.forfettario ? "TOTALE" : "TOTALE IVA INCLUSA", xEt, y + 1.4);
  doc.text(formatEuro(totali.totale), W - MARGINE - 2, y + 1.4, { align: "right" });
  y += 10;

  if (totali.acconto > 0) {
    doc.setTextColor(...NERO);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(prev.caparra ? "Caparra confirmatoria all'accettazione" : "Acconto all'accettazione", xEt, y);
    doc.text(formatEuro(totali.acconto), W - MARGINE - 2, y, { align: "right" });
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.text("Saldo a fine lavori", xEt, y);
    doc.text(formatEuro(totali.saldo), W - MARGINE - 2, y, { align: "right" });
    y += 6;
  }
  y += 3;

  // --- Voci facoltative (proposte al cliente, non incluse nel totale) ---
  if (totali.opzionali && totali.opzionali.length) {
    spazio(22);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...accento);
    doc.text("VOCI FACOLTATIVE - NON INCLUSE NEL TOTALE, SU RICHIESTA", MARGINE, y);
    y += 2;
    autoTable(doc, {
      startY: y,
      body: totali.opzionali.map((r) => [
        r.descrizione || "",
        `${formatQta(r.qta)} ${r.um || ""}`,
        "+ " + formatEuro(r.importo) + (totali.forfettario ? "" : ` + IVA ${r.iva}%`),
      ]),
      theme: "plain",
      margin: { left: MARGINE, right: MARGINE, bottom: 22 },
      styles: {
        font: "helvetica",
        fontSize: 8.6,
        cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 },
        textColor: NERO,
      },
      alternateRowStyles: { fillColor: [253, 248, 236] },
      bodyStyles: { fillColor: [255, 251, 242] },
      columnStyles: { 1: { halign: "right", cellWidth: 26 }, 2: { halign: "right", cellWidth: 44, fontStyle: "bold" } },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // --- Sezioni testuali ---
  function sezione(titolo, testo, dimensione = 8.8) {
    if (!testo || !String(testo).trim()) return;
    doc.setFontSize(dimensione);
    const linee = doc.splitTextToSize(String(testo).trim(), larghezza);
    spazio(6 + Math.min(linee.length, 6) * 3.9);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...accento);
    doc.text(titolo.toUpperCase(), MARGINE, y);
    y += 4.2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(dimensione);
    doc.setTextColor(...NERO);
    for (const l of linee) {
      spazio(4);
      doc.text(l, MARGINE, y);
      y += 3.9;
    }
    y += 3;
  }

  sezione("Tempi di esecuzione", prev.tempi);
  const appuntamento = normalizzaAppuntamento(prev.appuntamento);
  const proposte = normalizzaDisponibilita(prev.disponibilita);
  if (appuntamento) {
    sezione("Inizio lavori concordato", testoAppuntamento(appuntamento));
  } else if (proposte.length) {
    sezione(
      "Date proposte per l'inizio dei lavori",
      proposte.map((d) => "- " + testoAppuntamento(d)).join("\n") +
        "\nIl cliente può sceglierne una accettando online.",
    );
  }
  sezione(
    "Modalità di pagamento",
    [
      prev.pagamento,
      azienda.iban
        ? `IBAN: ${azienda.iban}${azienda.intestatarioIban ? " - intestato a " + azienda.intestatarioIban : ""}`
        : "",
      totali.acconto > 0 && prev.caparra ? FRASE_CAPARRA : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  // QR del bonifico per l'acconto: il cliente lo inquadra con l'app della banca.
  const qrAcconto = totali.acconto > 0 ? payloadPerImporto(azienda, totali.acconto, causale(prev, "acconto")) : null;
  if (qrAcconto) {
    spazio(42);
    y +=
      riquadroQr(doc, {
        x: MARGINE,
        y,
        larghezza,
        payload: qrAcconto,
        titolo: `Paga ${prev.caparra ? "la caparra" : "l'acconto"} di ${formatEuro(totali.acconto)} con il QR`,
        righe: [
          "Inquadra il codice con l'app della tua banca: il bonifico si compila da solo (se la tua app non legge i QR SEPA, usa l'IBAN qui sopra).",
          `Beneficiario: ${azienda.intestatarioIban || azienda.ragioneSociale} - Causale: ${causale(prev, "acconto")}`,
        ],
        accento,
      }) + 5;
  }
  sezione("Note e condizioni", prev.note, 8.2);

  if (totali.forfettario) {
    const frase = [azienda.fraseForfettario || FRASE_FORFETTARIO];
    if (totali.bollo > 0)
      frase.push(
        `Imposta di bollo di ${formatEuro(IMPORTO_BOLLO)} a carico del cliente (importi superiori a € 77,47).`,
      );
    doc.setFontSize(7.5);
    const linee = doc.splitTextToSize(frase.join(" "), larghezza);
    spazio(linee.length * 3.4 + 2);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(...GRIGIO);
    doc.text(linee, MARGINE, y);
    y += linee.length * 3.4 + 3;
  }

  // --- Accettazione e firma (il blocco è alto circa 54 mm: non deve finire sul piè di pagina) ---
  spazio(56);
  y += 2;
  doc.setDrawColor(210, 214, 220);
  doc.setLineWidth(0.3);
  doc.line(MARGINE, y, W - MARGINE, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...NERO);
  doc.text("PER ACCETTAZIONE DEL PREVENTIVO", MARGINE, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.8);
  doc.setTextColor(...GRIGIO);
  doc.text(
    doc.splitTextToSize(
      "Il cliente dichiara di aver letto e accettato il presente preventivo, le condizioni e le modalità di pagamento indicate.",
      larghezza,
    ),
    MARGINE,
    y + 4,
  );
  y += 12;
  if (linkAccettazione && !(prev.firma && prev.firma.img)) {
    doc.setFillColor(...accento);
    doc.roundedRect(MARGINE, y - 4, 74, 9, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.textWithLink("Accetta e firma online >", MARGINE + 4, y + 1.6, { url: linkAccettazione });
    doc.link(MARGINE, y - 4, 74, 9, { url: linkAccettazione });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRIGIO);
    doc.text("oppure firma qui sotto", MARGINE + 78, y + 1.6);
    y += 8;
  }

  const xFirma = W - MARGINE - 75;
  if (prev.firma && prev.firma.img) {
    try {
      // Il riquadro firma nell'app ha proporzioni 2,5:1.
      doc.addImage(prev.firma.img, "PNG", xFirma + 10, y - 2, 50, 20);
    } catch {
      /* firma non leggibile */
    }
  }
  const yLinea = y + 19;
  doc.setDrawColor(...GRIGIO);
  doc.line(MARGINE, yLinea, MARGINE + 60, yLinea);
  doc.line(xFirma, yLinea, W - MARGINE, yLinea);
  doc.setFontSize(7.8);
  doc.setTextColor(...GRIGIO);
  doc.text("Luogo e data", MARGINE, yLinea + 4);
  doc.text("Firma del cliente", xFirma, yLinea + 4);
  if (prev.firma && prev.firma.img) {
    doc.setTextColor(...NERO);
    doc.setFontSize(9);
    const quando = new Date(prev.firma.data);
    const dataFirma = `${formatData(oggiISO(quando))} ore ${String(quando.getHours()).padStart(2, "0")}:${String(quando.getMinutes()).padStart(2, "0")}`;
    doc.text(`${prev.firma.luogo ? prev.firma.luogo + ", " : ""}${dataFirma}`, MARGINE, yLinea - 2);
    doc.setFontSize(7);
    doc.setTextColor(...GRIGIO);
    doc.text(
      `Firmato da ${prev.firma.nome || c.nome || "il cliente"} ${prev.firma.online ? "online (accettazione via link)" : "su dispositivo"}`,
      xFirma,
      yLinea + 7.5,
    );
  }

  // --- Documentazione fotografica ---
  const foto = (prev.foto || []).filter((f) => f && typeof f.img === "string" && f.img.startsWith("data:image/"));
  if (foto.length) {
    doc.addPage();
    y = MARGINE;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...accento);
    doc.text("DOCUMENTAZIONE FOTOGRAFICA", MARGINE, y + 4);
    y += 11;
    const colW = (larghezza - 6) / 2;
    const fotoH = 72;
    foto.forEach((f, k) => {
      const col = k % 2;
      if (col === 0 && k > 0) y += fotoH + 14;
      if (y + fotoH + 10 > fondo) {
        doc.addPage();
        y = MARGINE;
      }
      const x = MARGINE + col * (colW + 6);
      try {
        const p = doc.getImageProperties(f.img);
        const scala = Math.min(colW / p.width, fotoH / p.height);
        const w = p.width * scala;
        const h = p.height * scala;
        doc.setFillColor(244, 246, 250);
        doc.rect(x, y, colW, fotoH, "F");
        doc.addImage(f.img, p.fileType || "JPEG", x + (colW - w) / 2, y + (fotoH - h) / 2, w, h, undefined, "FAST");
      } catch {
        /* foto non leggibile */
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...GRIGIO);
      doc.text(doc.splitTextToSize(f.didascalia || `Foto ${k + 1}`, colW)[0], x, y + fotoH + 4.5);
    });
  }

  if (fascicolo && fascicolo.stato) {
    paginaFascicolo(doc, { prev, azienda, totali, stato: fascicolo.stato, accento, autoTable });
  }

  // --- Piè di pagina su tutte le pagine ---
  const pagine = doc.getNumberOfPages();
  for (let p = 1; p <= pagine; p++) {
    doc.setPage(p);
    doc.setDrawColor(230, 232, 236);
    doc.setLineWidth(0.2);
    doc.line(MARGINE, H - 12, W - MARGINE, H - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRIGIO);
    doc.text(`Preventivo n. ${prev.numero} - Pagina ${p} di ${pagine}`, W - MARGINE, H - 7.5, { align: "right" });
    if (pro) {
      doc.text(azienda.ragioneSociale || "", MARGINE, H - 7.5);
    } else {
      doc.setTextColor(...accento);
      doc.textWithLink(`Creato gratis con ${config.nomeProdotto} - ${config.dominioBreve}`, MARGINE, H - 7.5, {
        url: config.sito,
      });
    }
  }

  return doc;
}

export function creaPdfBlob(opts) {
  return creaPdf(opts).output("blob");
}

// ------------------------------------------------------------------
// Fascicolo del credito: tutto ciò che serve per dimostrare l'accordo e il mancato pagamento
// ------------------------------------------------------------------
function descriviAccettazione(prev) {
  const f = prev.firma;
  if (prev.accettazioneOnline && f) {
    const imp = prev.accettazioneOnline.hash
      ? ` - impronta del preventivo accettato: ${prev.accettazioneOnline.hash}`
      : "";
    return `Online tramite link, firmato da ${f.nome || "il cliente"} il ${dataOra(f.data)}${imp}`;
  }
  if (f && f.img)
    return `Firmato sul dispositivo dell'impresa da ${f.nome || "il cliente"} il ${dataOra(f.data)}${f.luogo ? ` a ${f.luogo}` : ""}`;
  return "Segnato come accettato dall'impresa (senza firma registrata nell'app)";
}

function paginaFascicolo(doc, { prev, azienda, totali, stato, accento, autoTable }) {
  doc.addPage();
  let y = MARGINE;
  const W = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...accento);
  doc.text("FASCICOLO DEL CREDITO", MARGINE, y + 5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIGIO);
  doc.text(`Preventivo n. ${prev.numero} - riepilogo generato il ${dataOra(Date.now())}`, MARGINE, y + 11);
  y += 16;
  const c = prev.cliente || {};
  const app = normalizzaAppuntamento(prev.appuntamento);
  const righe = [
    ["Impresa", righeNonVuote(azienda.ragioneSociale, azienda.piva ? `P.IVA ${azienda.piva}` : "").join(" - ")],
    ["Cliente", righeNonVuote(nomeCliente(c), c.cfpiva ? `C.F./P.IVA ${c.cfpiva}` : "").join(" - ")],
    ["Recapiti cliente", righeNonVuote(c.indirizzo, c.citta, c.telefono, c.email).join(" - ") || "-"],
    ["Preventivo", `N. ${prev.numero} del ${formatData(prev.data)}${prev.oggetto ? ` - ${prev.oggetto}` : ""}`],
    ["Importo totale", `${formatEuro(stato.totale)}${totali.forfettario ? "" : " IVA inclusa"}`],
    ["Accettazione", descriviAccettazione(prev)],
  ];
  const aggiunte = prev.accettazioneOnline?.facoltativeAggiunte || [];
  if (aggiunte.length) righe.push(["Voci aggiunte dal cliente", aggiunte.join(", ")]);
  if (totali.acconto > 0)
    righe.push([
      prev.caparra ? "Caparra confirmatoria" : "Acconto",
      `${formatEuro(totali.acconto)} ${stato.accontoPagato ? "(versato)" : "(non versato)"}`,
    ]);
  if (app)
    righe.push([
      "Inizio lavori concordato",
      testoAppuntamento(app) + (app.da === "cliente" ? " (scelto dal cliente)" : ""),
    ]);
  if (stato.fineLavori) righe.push(["Fine lavori", formatData(stato.fineLavori)]);
  if (stato.scadenzaSaldo) righe.push(["Scadenza del saldo", formatData(stato.scadenzaSaldo)]);
  righe.push(["Incassato", formatEuro(stato.incassato)]);
  righe.push(["Da incassare", formatEuro(stato.residuo)]);
  if (stato.importoScaduto > 0)
    righe.push([
      "Scaduto",
      `${formatEuro(stato.importoScaduto)} dal ${formatData(stato.scadutoDal)} (${stato.giorniRitardo} giorni)`,
    ]);

  const stile = {
    theme: "plain",
    margin: { left: MARGINE, right: MARGINE, bottom: 22 },
    styles: { font: "helvetica", fontSize: 8.6, cellPadding: 1.8, textColor: NERO, overflow: "linebreak" },
  };
  autoTable(doc, {
    ...stile,
    startY: y,
    body: righe,
    columnStyles: { 0: { cellWidth: 46, fontStyle: "bold", textColor: GRIGIO } },
    alternateRowStyles: { fillColor: [248, 249, 251] },
  });
  y = doc.lastAutoTable.finalY + 7;

  const tabella = (titolo, head, body, vuoto) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...accento);
    if (y > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      y = MARGINE;
    }
    doc.text(titolo, MARGINE, y);
    autoTable(doc, {
      ...stile,
      startY: y + 2,
      head: [head],
      body: body.length ? body : [[{ content: vuoto, colSpan: head.length }]],
      headStyles: { fillColor: accento, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
    });
    y = doc.lastAutoTable.finalY + 7;
  };
  tabella(
    "PAGAMENTI RICEVUTI",
    ["Data", "Metodo", "Importo", "Nota"],
    stato.pagamenti.map((p) => [formatData(p.data), METODI[p.metodo] || "", formatEuro(p.importo), p.nota || ""]),
    "Nessun pagamento ricevuto",
  );
  tabella(
    "SOLLECITI INVIATI",
    ["Data e ora", "Tipo", "Canale"],
    stato.solleciti.map((s) => [
      dataOra(s.il),
      LIVELLI_SOLLECITO[s.livello] || "",
      { whatsapp: "WhatsApp", email: "Email", lettera: "Lettera di messa in mora", copia: "Messaggio copiato" }[
        s.canale
      ] || "",
    ]),
    "Nessun sollecito registrato",
  );
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIGIO);
  doc.text(
    doc.splitTextToSize(
      "Il preventivo accettato è riportato nelle pagine precedenti di questo documento. Riepilogo generato dai dati registrati dall'impresa nell'app: conserva anche i messaggi WhatsApp/email e le ricevute dei pagamenti.",
      W - MARGINE * 2,
    ),
    MARGINE,
    y,
  );
}

// ------------------------------------------------------------------
// Lettera di sollecito e costituzione in mora (art. 1219 c.c.)
// opts: { prev, azienda, totali, stato, config, oggi, tassoMora }
// ------------------------------------------------------------------
export function creaDiffida({ prev, azienda, totali, stato, config, oggi = oggiISO(), tassoMora = "" }) {
  const { jsPDF } = globalThis.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const larghezza = W - MARGINE * 2;
  const c = prev.cliente || {};
  const a = azienda;
  doc.setProperties({
    title: `Messa in mora - preventivo ${prev.numero}`,
    author: a.ragioneSociale || "",
    creator: config.nomeProdotto,
  });
  let y = MARGINE + 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...NERO);
  doc.text(doc.splitTextToSize(a.ragioneSociale || "", 90), MARGINE, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIGIO);
  let ym = y + 5;
  for (const r of righeNonVuote(
    a.indirizzo,
    [a.cap, a.citta, a.provincia ? `(${a.provincia})` : ""].filter(Boolean).join(" "),
    a.piva ? `P.IVA ${a.piva}` : "",
    [a.telefono ? `Tel. ${a.telefono}` : "", a.email].filter(Boolean).join(" - "),
    a.pec ? `PEC ${a.pec}` : "",
  )) {
    doc.text(r, MARGINE, ym);
    ym += 4;
  }

  const xd = W / 2 + 10;
  let yd = ym + 8;
  doc.setFontSize(9.5);
  doc.setTextColor(...NERO);
  doc.text("Spett.le / Gent.mo", xd, yd);
  yd += 5;
  doc.setFont("helvetica", "bold");
  doc.text(doc.splitTextToSize(nomeCliente(c), W - MARGINE - xd), xd, yd);
  doc.setFont("helvetica", "normal");
  yd += 5;
  for (const r of righeNonVuote(c.indirizzo, c.citta, c.cfpiva ? `C.F./P.IVA ${c.cfpiva}` : "")) {
    for (const l of doc.splitTextToSize(r, W - MARGINE - xd)) {
      doc.text(l, xd, yd);
      yd += 4.5;
    }
  }
  y = Math.max(ym, yd) + 8;
  doc.text(`${a.citta ? a.citta + ", " : ""}${formatData(oggi)}`, W - MARGINE, y, { align: "right" });
  y += 10;

  doc.setFont("helvetica", "bold");
  const oggetto = `Oggetto: sollecito di pagamento e costituzione in mora - Preventivo n. ${prev.numero} del ${formatData(prev.data)}${prev.oggetto ? ` ("${prev.oggetto}")` : ""}`;
  for (const l of doc.splitTextToSize(oggetto, larghezza)) {
    doc.text(l, MARGINE, y);
    y += 5;
  }
  y += 3;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);

  const scrivi = (testo, rientro = 0) => {
    for (const l of doc.splitTextToSize(testo, larghezza - rientro)) {
      if (y > H - 30) {
        doc.addPage();
        y = MARGINE;
      }
      doc.text(l, MARGINE + rientro, y);
      y += 4.8;
    }
    y += 2;
  };
  const punto = (testo) => {
    doc.text("-", MARGINE + 2, y);
    scrivi(testo, 6);
  };

  const iva = totali.forfettario ? "" : " IVA inclusa";
  const modo = prev.accettazioneOnline
    ? "online, con firma apposta tramite il link ricevuto"
    : prev.firma && prev.firma.img
      ? "sottoscrivendolo"
      : "";
  scrivi(`Gentile ${nomeCliente(c)},`);
  scrivi("con la presente Le ricordiamo che:");
  punto(
    `in data ${formatData(stato.dataAccettazione || prev.data)} Lei ha accettato${modo ? ` ${modo},` : ""} il preventivo n. ${prev.numero} del ${formatData(prev.data)}${prev.oggetto ? ` relativo a "${prev.oggetto}"` : ""}, per un importo complessivo di ${formatEuro(stato.totale)}${iva};`,
  );
  if (stato.fineLavori) punto(`i lavori sono stati eseguiti e ultimati in data ${formatData(stato.fineLavori)};`);
  punto(
    stato.incassato > 0
      ? `a fronte di tale importo risultano versati ${formatEuro(stato.incassato)} (${stato.pagamenti.map((p) => `${formatEuro(p.importo)} il ${formatData(p.data)}`).join(", ")});`
      : "a oggi non risulta effettuato alcun pagamento;",
  );
  punto(
    `residua pertanto a Suo carico la somma di ${formatEuro(stato.residuo)}${stato.scadutoDal ? `, scaduta il ${formatData(stato.scadutoDal)}` : ""};`,
  );
  const precedenti = stato.solleciti.filter((s) => s.canale !== "lettera");
  if (precedenti.length)
    punto(
      `nonostante i solleciti del ${precedenti.map((s) => formatData(oggiISO(new Date(s.il)))).join(", ")}, il pagamento non è stato effettuato.`,
    );
  y += 2;
  scrivi(
    `La invitiamo pertanto formalmente a corrispondere la somma di ${formatEuro(stato.residuo)} entro e non oltre 15 (quindici) giorni dal ricevimento della presente${
      a.iban
        ? `, mediante bonifico bancario sul conto IBAN ${a.iban}${a.intestatarioIban ? ` intestato a ${a.intestatarioIban}` : ""}, causale "${causale(prev, "saldo")}"`
        : ""
    }.`,
  );
  const giorni = stato.giorniRitardo;
  const interessi = interessiMora(stato.importoScaduto || stato.residuo, tassoMora, giorni);
  scrivi(
    "La presente vale quale atto di costituzione in mora ai sensi e per gli effetti dell'art. 1219 del Codice civile. Sulla somma dovuta decorrono gli interessi moratori nella misura di legge" +
      (interessi > 0
        ? ` (tasso annuo applicato ${String(tassoMora).replace(".", ",")}%: ${formatEuro(interessi)} maturati alla data odierna per ${giorni} giorni di ritardo).`
        : "."),
  );
  scrivi(
    "In mancanza del pagamento nel termine indicato, ci vedremo costretti a tutelare le nostre ragioni nelle sedi competenti, senza ulteriore avviso, con aggravio di spese a Suo carico.",
  );
  scrivi("Restiamo a disposizione per concordare, se necessario, le modalità di pagamento.");
  y += 4;
  scrivi("Distinti saluti");
  y += 2;
  doc.setFont("helvetica", "bold");
  scrivi(a.ragioneSociale || "");
  doc.setFont("helvetica", "normal");
  doc.setDrawColor(...GRIGIO);
  doc.setLineWidth(0.3);
  if (y > H - 60) {
    doc.addPage();
    y = MARGINE;
  }
  doc.line(MARGINE, y + 10, MARGINE + 65, y + 10);
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIGIO);
  doc.text("Firma", MARGINE, y + 14);
  y += 22;

  const payload = payloadPerImporto(a, stato.residuo, causale(prev, "saldo"));
  if (payload) {
    riquadroQr(doc, {
      x: MARGINE,
      y,
      larghezza,
      payload,
      titolo: `Paga ${formatEuro(stato.residuo)} con il QR del bonifico`,
      righe: [
        "Inquadra il codice con l'app della tua banca: importo, IBAN e causale si compilano da soli.",
        `Causale: ${causale(prev, "saldo")}`,
      ],
      accento: NERO,
    });
  }
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIGIO);
  doc.text(`Allegato: copia del preventivo n. ${prev.numero} accettato.`, MARGINE, H - 10);
  return doc;
}

export function creaDiffidaBlob(opts) {
  return creaDiffida(opts).output("blob");
}
