// ============================================================
//  CONFIGURAZIONE: è l'unico file che devi modificare.
//  Dopo aver creato i prodotti su Polar (o Lemon Squeezy)
//  incolla qui i link di pagamento. Vedi README.md, passo 3.
// ============================================================

export const CONFIG = {
  nomeProdotto: "PreventivoLampo",

  // Indirizzo del sito una volta pubblicato (serve per sitemap e link nei PDF gratuiti).
  sito: "https://preventivolampo.it",
  dominioBreve: "preventivolampo.it",
  emailSupporto: "supporto@preventivolampo.it",

  // Dati del titolare del servizio (privacy e termini). Compilali prima di andare online.
  titolare: {
    nome: "[Nome e Cognome / Ragione sociale]",
    indirizzo: "[Indirizzo]",
    piva: "[Partita IVA]",
  },

  // Piano gratuito: quanti preventivi diversi si possono esportare in PDF ogni mese.
  pdfGratisAlMese: 3,

  // Prezzi mostrati nell'app e nella landing (IVA inclusa, devono coincidere con Polar).
  prezzi: {
    mensile: { importo: "9,90 €", periodo: "/mese" },
    annuale: { importo: "79 €", periodo: "/anno", nota: "Risparmi il 33%" },
    // Offerta lancio facoltativa: lascia link vuoto per nasconderla.
    aVita: { importo: "149 €", periodo: "una volta", nota: "Offerta fondatori - primi 100" },
  },

  // Link di pagamento (checkout) creati su Polar / Lemon Squeezy.
  // Finché sono vuoti, i pulsanti "Acquista" mostrano un avviso.
  checkout: {
    mensile: "",
    annuale: "",
    aVita: "",
  },

  // Link dove il cliente gestisce/disdice l'abbonamento (portale clienti Polar o LS).
  portaleClienti: "",

  // Statistiche anonime senza cookie (facoltative): Plausible o Umami.
  // Esempio Plausible: { src: "https://plausible.io/js/script.js", attributi: { "data-domain": "preventivolampo.it" } }
  // Esempio Umami:     { src: "https://cloud.umami.is/script.js", attributi: { "data-website-id": "IL-TUO-ID" } }
  statistiche: { src: "", attributi: {} },

  // Funzione serverless che verifica il codice licenza (inclusa nel progetto).
  apiLicenza: "/api/licenza",

  // Ogni quanti giorni l'app ricontrolla la licenza (se online) e quanti giorni
  // continua a funzionare in Pro senza connessione.
  giorniRevalidazione: 3,
  giorniTolleranzaOffline: 21,
};
