// Generazione del PDF del preventivo (jsPDF + AutoTable, caricati come script globali).
import {
  formatEuro,
  formatQta,
  formatData,
  aggiungiGiorni,
  oggiISO,
  FRASE_FORFETTARIO,
  IMPORTO_BOLLO,
} from "./core.js";

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

// opts: { prev, azienda, totali, pro, config }
export function creaPdf({ prev, azienda, totali, pro, config }) {
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
    doc.text("Acconto all'accettazione", xEt, y);
    doc.text(formatEuro(totali.acconto), W - MARGINE - 2, y, { align: "right" });
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.text("Saldo a fine lavori", xEt, y);
    doc.text(formatEuro(totali.saldo), W - MARGINE - 2, y, { align: "right" });
    y += 6;
  }
  y += 3;

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
  sezione(
    "Modalità di pagamento",
    [
      prev.pagamento,
      azienda.iban
        ? `IBAN: ${azienda.iban}${azienda.intestatarioIban ? " - intestato a " + azienda.intestatarioIban : ""}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
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

  // --- Accettazione e firma ---
  spazio(40);
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
    doc.text(`Firmato da ${prev.firma.nome || c.nome || "il cliente"} su dispositivo`, xFirma, yLinea + 7.5);
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
