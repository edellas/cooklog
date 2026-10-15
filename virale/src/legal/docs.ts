/**
 * Dati di chi pubblica l'app. COMPILALI prima di andare sugli store: compaiono nei documenti
 * legali, nelle Impostazioni e nelle schede degli store. `npm run check:release` segnala
 * quelli ancora tra parentesi quadre.
 */
export const OWNER = {
  /** Nome e cognome, oppure ragione sociale. È il titolare del trattamento dei dati. */
  name: 'Edoardo Della Seta',
  /** Indirizzo postale completo. */
  address: '[Via Fonteiana, 148, 00152, Roma]',
  /** Partita IVA o codice fiscale. */
  taxId: 'DLLDRD97R19H501K',
  /** Email per supporto, privacy e segnalazioni urgenti: deve essere letta ogni giorno. */
  email: 'edoardo.dellaseta@gmail.com',
  /** Dove saranno pubblicate le pagine di legal-site/ (es. https://tuonome.github.io/cooklog). Senza barra finale. */
  website: '',
} as const;

/** Data di entrata in vigore dei documenti (aggiornala quando li modifichi). */
export const LEGAL_UPDATED = '15 ottobre 2026';

/** Età minima: in Italia 14 anni per iscriversi da soli a un servizio online (art. 2-quinquies Codice privacy). */
export const MIN_AGE = 14;

/**
 * Testi legali di Virale. Sono una base completa e coerente con come funziona l'app,
 * ma vanno fatti rivedere da un legale prima della pubblicazione.
 * Gli stessi testi sono mostrati nell'app (app/legale/[doc].tsx) e pubblicati come pagine web
 * (npm run export:legal → legal-site/), richieste dagli store.
 */

export type LegalDoc = { slug: DocSlug; title: string; intro: string; sections: { heading: string; body: string[] }[] };
export type DocSlug = 'termini' | 'privacy' | 'linee-guida' | 'eliminazione-account';

const contact = `${OWNER.name}, ${OWNER.address}, email ${OWNER.email}`;

export const DOCS: Record<DocSlug, LegalDoc> = {
  termini: {
    slug: 'termini',
    title: 'Termini di servizio',
    intro: `In vigore dal ${LEGAL_UPDATED}. Usando Virale accetti questi termini. Il servizio è fornito da ${contact}.`,
    sections: [
      {
        heading: 'Chi può usare Virale',
        body: [
          `Devi avere almeno ${MIN_AGE} anni. Se hai meno di 18 anni, usa Virale solo con il permesso di un genitore o di chi ne fa le veci.`,
          'Un account è personale. Non puoi crearne più di uno per partecipare alla gara né cederlo ad altri.',
        ],
      },
      {
        heading: 'Cosa pubblichi',
        body: [
          'Puoi pubblicare foto e video di cui hai i diritti. Restano tuoi: ci concedi solo la licenza non esclusiva, gratuita e mondiale di conservarli, mostrarli nell’app, adattarli ai formati dello schermo e, se vincono, mostrarli come Copertina e nell’Archivio. La licenza termina quando li elimini o elimini l’account, salvo copie conservate per obblighi di legge.',
          'Sei responsabile di ciò che pubblichi e di avere il consenso delle persone riconoscibili nelle tue foto e nei tuoi video, in particolare dei minori.',
          'Devi rispettare le Linee guida della community: sono parte di questi termini.',
        ],
      },
      {
        heading: 'La gara e la Copertina',
        body: [
          'Ogni giorno puoi candidare un solo post. Il vincitore è scelto automaticamente in base a come le persone guardano i post in gara, secondo le regole descritte nell’app (“Come si diventa copertina”).',
          'Non ci sono premi in denaro. La vittoria consiste nella pubblicazione del post come Copertina per un giorno e nell’Archivio.',
          'È vietato alterare la gara: account multipli, voti comprati o scambiati, automatismi. In questi casi possiamo escludere il post, togliere la Copertina ed espellere l’account.',
        ],
      },
      {
        heading: 'Moderazione',
        body: [
          'Puoi segnalare qualsiasi post e bloccare qualsiasi utente. Un post segnalato da più persone viene nascosto subito fino alla revisione.',
          'Esaminiamo le segnalazioni entro 24 ore. Possiamo rimuovere contenuti e sospendere o espellere account che violano termini o linee guida, anche senza preavviso nei casi gravi. Se pensi che una decisione sia sbagliata, scrivi a ' + OWNER.email + '.',
        ],
      },
      {
        heading: 'Disponibilità e modifiche',
        body: [
          'Virale è fornito così com’è. Possiamo modificare, sospendere o chiudere funzioni del servizio. Se cambiamo questi termini in modo rilevante te lo diremo nell’app prima che le modifiche abbiano effetto.',
          'Nei limiti di legge non rispondiamo di danni indiretti derivanti dall’uso del servizio. Restano salvi i diritti che la legge riconosce ai consumatori.',
        ],
      },
      {
        heading: 'Chiusura dell’account',
        body: ['Puoi eliminare l’account in qualsiasi momento da Profilo → Impostazioni → Elimina account. Vengono eliminati profilo, post, commenti, mi piace, salvati, follow e partecipazioni alla gara.'],
      },
      {
        heading: 'Legge applicabile',
        body: ['Si applica la legge italiana. Se sei un consumatore, è competente il foro del luogo in cui risiedi.'],
      },
    ],
  },

  privacy: {
    slug: 'privacy',
    title: 'Informativa sulla privacy',
    intro: `In vigore dal ${LEGAL_UPDATED}. Questa informativa spiega quali dati tratta Virale e perché, ai sensi del Regolamento (UE) 2016/679 (GDPR).`,
    sections: [
      { heading: 'Titolare del trattamento', body: [contact + '. Per qualsiasi domanda sulla privacy scrivi a questo indirizzo.'] },
      {
        heading: 'Quali dati trattiamo',
        body: [
          'Account: nome utente, nome visualizzato, eventuale bio, un identificativo tecnico dell’account, data di accettazione dei termini.',
          'Contenuti: foto e video che pubblichi (con le loro dimensioni e durata), didascalie, commenti.',
          'Interazioni: mi piace, salvataggi, condivisioni, follow, blocchi, segnalazioni, e per i post in gara il tempo di visione, il completamento e la ri-visione dei video.',
          'Non chiediamo email, numero di telefono, posizione o rubrica. Non usiamo pubblicità né tracciamento tra app di altre aziende.',
        ],
      },
      {
        heading: 'Perché e su quale base',
        body: [
          'Fornire il servizio, mostrare i contenuti e far funzionare la gara: esecuzione del contratto (art. 6.1.b GDPR).',
          'Sicurezza, moderazione, prevenzione di abusi e di manipolazioni della gara: legittimo interesse (art. 6.1.f) e obblighi di legge (art. 6.1.c).',
        ],
      },
      {
        heading: 'Chi riceve i dati',
        body: [
          'Ciò che pubblichi è visibile agli altri utenti; la Copertina è visibile a chiunque apra l’app.',
          'Fornitori che trattano i dati per nostro conto come responsabili del trattamento: Supabase (database, archiviazione dei file e autenticazione). Usiamo server situati nell’Unione Europea.',
          'Autorità, quando la legge lo impone.',
        ],
      },
      {
        heading: 'Quanto li conserviamo',
        body: [
          'Finché l’account esiste. Quando elimini un post o l’account, i dati vengono cancellati dai sistemi attivi subito e dalle copie di sicurezza entro 30 giorni.',
          'I dati tecnici delle singole visualizzazioni della gara vengono cancellati dopo 7 giorni.',
          'Le segnalazioni e le decisioni di moderazione possono essere conservate fino a 12 mesi per gestire ricorsi e abusi ripetuti.',
        ],
      },
      {
        heading: 'I tuoi diritti',
        body: [
          'Puoi chiedere accesso, rettifica, cancellazione, limitazione, portabilità dei dati e opporti al trattamento basato sul legittimo interesse, scrivendo a ' + OWNER.email + '. Rispondiamo entro un mese.',
          'Puoi eliminare l’account direttamente dall’app. Hai il diritto di presentare reclamo al Garante per la protezione dei dati personali (garanteprivacy.it).',
        ],
      },
      { heading: 'Minori', body: [`Virale non è destinato a chi ha meno di ${MIN_AGE} anni. Se scopriamo un account di una persona più giovane lo eliminiamo.`] },
    ],
  },

  'linee-guida': {
    slug: 'linee-guida',
    title: 'Linee guida della community',
    intro: 'Virale funziona se tutti possono guardare e pubblicare tranquilli. Queste regole valgono per post, didascalie, commenti e profili.',
    sections: [
      {
        heading: 'Non è permesso',
        body: [
          'Nudo e contenuti sessuali. Qualsiasi contenuto che sessualizzi o metta in pericolo minori: lo segnaliamo alle autorità.',
          'Violenza, autolesionismo, contenuti scioccanti, minacce, istigazione all’odio o alla discriminazione.',
          'Molestie, bullismo, condivisione di dati o immagini private di altre persone senza consenso.',
          'Spam, truffe, furto d’identità, contenuti che violano diritti d’autore o di altri.',
          'Attività illegali, armi, droghe, gioco d’azzardo.',
        ],
      },
      {
        heading: 'La gara è leale',
        body: ['Niente account multipli, voti comprati o scambiati, gruppi organizzati per segnalare i concorrenti, automatismi. Chi bara viene escluso.'],
      },
      {
        heading: 'Cosa puoi fare',
        body: [
          'Segnala un post dal pulsante con i tre puntini: per te sparisce subito. Con più segnalazioni sparisce per tutti fino alla nostra revisione, entro 24 ore.',
          'Blocca un utente: non vedrete più i contenuti l’uno dell’altro.',
          `Per casi urgenti scrivi a ${OWNER.email}.`,
        ],
      },
      { heading: 'Conseguenze', body: ['A seconda della gravità: rimozione del contenuto, esclusione dalla gara, sospensione o espulsione dell’account.'] },
    ],
  },

  'eliminazione-account': {
    slug: 'eliminazione-account',
    title: 'Eliminare l’account Virale',
    intro: 'Puoi eliminare il tuo account e tutti i tuoi dati in qualsiasi momento.',
    sections: [
      {
        heading: 'Dall’app',
        body: ['Apri Virale → Profilo → Impostazioni (icona in alto a destra) → Elimina account, poi conferma. L’eliminazione è immediata e definitiva.'],
      },
      {
        heading: 'Senza l’app',
        body: [`Scrivi a ${OWNER.email} dall’indirizzo che preferisci indicando il tuo nome utente. Ti chiederemo una conferma dall’app o una prova che l’account è tuo, e lo elimineremo entro 30 giorni.`],
      },
      {
        heading: 'Cosa viene eliminato',
        body: [
          'Profilo, foto e video pubblicati, didascalie, commenti, mi piace, salvati, follow, blocchi e partecipazioni alla gara. Le tue Copertine spariscono anche dall’Archivio.',
          'Le copie di sicurezza vengono sovrascritte entro 30 giorni. Le segnalazioni che ti riguardano possono essere conservate fino a 12 mesi per prevenire abusi.',
        ],
      },
    ],
  },
};
