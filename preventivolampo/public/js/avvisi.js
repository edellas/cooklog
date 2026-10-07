// Promemoria sul telefono (solo nell'app nativa): dai preventivi si ricava quando avvisare l'artigiano.
// Niente server: ogni volta che i dati cambiano l'app ricalcola tutto e riprogramma gli avvisi locali.
import { aggiungiGiorni, formatEuro, nomeCliente, oggiISO, scadenzaDi } from "./core.js";
import { FASCE, normalizzaAppuntamento } from "./incassi.js";

// iOS tiene al massimo 64 avvisi in attesa: se ne programmano meno, i più vicini.
export const MAX_AVVISI = 48;
// Ogni venerdì alle 17:30 (per gli avvisi: 1 = domenica ... 6 = venerdì).
export const GIRO_CONTI = { weekday: 6, hour: 17, minute: 30 };

// Un numero intero positivo (32 bit con segno) stabile per ogni avviso: lo stesso avviso ricalcolato ha lo
// stesso numero, così riprogrammare non crea doppioni.
export function idAvviso(chiave) {
  let h = 2166136261;
  for (const c of String(chiave)) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 1) % 2147483646 || 1;
}

function alle(iso, ore, minuti) {
  const [a, m, g] = String(iso).split("-").map(Number);
  if (!a || !m || !g) return null;
  return new Date(a, m - 1, g, ore, minuti, 0, 0);
}

const maiuscola = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// statoDi(prev): lo stato degli incassi del preventivo (come incassoDi nell'app).
export function pianificaAvvisi(preventivi, { ora = new Date(), statoDi, giorniRicontatto = 3, conti = false } = {}) {
  const lista = [];
  const aggiungi = (chiave, quando, titolo, testo, rotta) => {
    if (quando && quando.getTime() > ora.getTime()) lista.push({ id: idAvviso(chiave), quando, titolo, testo, rotta });
  };
  for (const p of Array.isArray(preventivi) ? preventivi : []) {
    if (!p || !p.id) continue;
    const nome = nomeCliente(p.cliente);
    const rotta = `#/p/${p.id}`;
    if (p.stato === "accettato") {
      const s = statoDi ? statoDi(p) : null;
      const q = s && s.residuo > 0.005 ? s.prossima : null;
      if (q && q.data && q.importo > 0) {
        const cosa = q.tipo === "acconto" ? (p.caparra ? "la caparra" : "l'acconto") : "il saldo";
        aggiungi(
          `${p.id}:scade:${q.tipo}:${q.data}`,
          alle(q.data, 9, 0),
          `Oggi scade ${cosa} di ${nome}`,
          `${formatEuro(q.importo)}. Se è arrivato segnalo nell'app, se no mandagli un promemoria gentile.`,
          `${rotta}?sez=incassi`,
        );
        aggiungi(
          `${p.id}:ritardo:${q.tipo}:${q.data}`,
          alle(aggiungiGiorni(q.data, 3), 9, 0),
          `${nome} è in ritardo di 3 giorni`,
          `${maiuscola(cosa)}: ${formatEuro(q.importo)}. Il sollecito è già scritto: lo mandi con un tocco.`,
          `${rotta}?sez=incassi&azione=sollecito`,
        );
      }
      const app = normalizzaAppuntamento(p.appuntamento);
      if (app && app.data)
        aggiungi(
          `${p.id}:lavoro:${app.data}:${app.fascia || ""}`,
          alle(aggiungiGiorni(app.data, -1), 18, 0),
          `Domani: lavoro da ${nome}`,
          [FASCE[app.fascia], p.oggetto].filter(Boolean).join(" · ") || `Preventivo n. ${p.numero}`,
          rotta,
        );
    }
    if (p.stato === "inviato" && Number(p.inviatoIl) > 0) {
      const ultimo = Number(p.ricontattatoIl) || Number(p.inviatoIl);
      const giorno = oggiISO(new Date(ultimo + Math.max(1, Number(giorniRicontatto) || 3) * 86400000));
      aggiungi(
        `${p.id}:risposta:${ultimo}`,
        alle(giorno, 9, 30),
        `${nome} non ha ancora risposto`,
        `Preventivo n. ${p.numero}: un messaggio gentile spesso basta. Te lo preparo io.`,
        rotta,
      );
      const scade = scadenzaDi(p);
      if (scade)
        aggiungi(
          `${p.id}:validita:${scade}`,
          alle(aggiungiGiorni(scade, -2), 9, 30),
          `Il preventivo per ${nome} scade dopodomani`,
          `Dopo, il cliente non può più firmarlo. Scrivigli adesso.`,
          rotta,
        );
    }
  }
  lista.sort((a, b) => a.quando - b.quando);
  const scelti = lista.slice(0, MAX_AVVISI - (conti ? 1 : 0));
  if (conti)
    scelti.push({
      id: idAvviso("giro-dei-conti"),
      ogniSettimana: GIRO_CONTI,
      titolo: "5 minuti per i conti",
      testo: "Chi deve pagare, chi richiamare, quali preventivi stanno per scadere: guarda la lista Da fare.",
      rotta: "#/",
    });
  return scelti;
}
