/**
 * Dati di chi pubblica l'app: compaiono nei documenti legali e nelle Impostazioni.
 * NON scriverli qui (il repository è pubblico): si mettono nelle variabili d'ambiente,
 * su expo.dev → Environment variables (ambiente "preview" e "production") oppure in .env.local
 * per le prove sul computer. Vedi .env.example. `npm run check:release` segnala quelli mancanti.
 * Expo inserisce nell'app solo le variabili scritte per esteso (process.env.EXPO_PUBLIC_…).
 */
export const OWNER = {
  /** Nome e cognome, oppure ragione sociale. È il titolare del trattamento dei dati. */
  name: process.env.EXPO_PUBLIC_OWNER_NAME || '[Nome e cognome o ragione sociale]',
  /** Indirizzo postale completo. */
  address: process.env.EXPO_PUBLIC_OWNER_ADDRESS || '[Via, numero, CAP, città]',
  /** Partita IVA o codice fiscale. */
  taxId: process.env.EXPO_PUBLIC_OWNER_TAX_ID || '[Partita IVA o codice fiscale]',
  /** Email per supporto, privacy e segnalazioni urgenti: deve essere letta ogni giorno. */
  email: process.env.EXPO_PUBLIC_OWNER_EMAIL || '[supporto@tuodominio.it]',
  /** Dove saranno pubblicate le pagine di legal-site/ (es. https://tuonome.github.io/cooklog). Senza barra finale. */
  website: (process.env.EXPO_PUBLIC_OWNER_WEBSITE || '').trim().replace(/\/+$/, ''),
};

/** I nomi delle variabili EXPO_PUBLIC_OWNER_* non impostate (mai i valori). */
export function ownerMissing(): string[] {
  const missing: string[] = [];
  if (!process.env.EXPO_PUBLIC_OWNER_NAME) missing.push('EXPO_PUBLIC_OWNER_NAME');
  if (!process.env.EXPO_PUBLIC_OWNER_ADDRESS) missing.push('EXPO_PUBLIC_OWNER_ADDRESS');
  if (!process.env.EXPO_PUBLIC_OWNER_TAX_ID) missing.push('EXPO_PUBLIC_OWNER_TAX_ID');
  if (!process.env.EXPO_PUBLIC_OWNER_EMAIL) missing.push('EXPO_PUBLIC_OWNER_EMAIL');
  if (!process.env.EXPO_PUBLIC_OWNER_WEBSITE) missing.push('EXPO_PUBLIC_OWNER_WEBSITE');
  return missing;
}

/** L'email di supporto, o null se è ancora il segnaposto: in quel caso le righe "Scrivi a …" non compaiono. */
export function ownerEmail(): string | null {
  return process.env.EXPO_PUBLIC_OWNER_EMAIL ? OWNER.email : null;
}

/** Data di entrata in vigore dei documenti (aggiornala quando li modifichi). */
export const LEGAL_UPDATED = '19 ottobre 2026';

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
          'Per registrarti indichi il tuo vero nome, cognome e data di nascita, un nome utente e una password. Un account è personale: non puoi crearne più di uno per partecipare alla gara né cederlo ad altri, e sei responsabile di custodire la password.',
          'Entro il periodo indicato nell’app (di regola 7 giorni) devi confermare la tua età con un documento d’identità: con la verifica automatica (documento e breve selfie) oppure caricando la foto del documento e un selfie con il documento. Finché non lo fai, scaduto il periodo, puoi guardare ma non pubblicare, commentare, cerchiare (il nostro mi piace), seguire né votare. Se il documento dimostra un’età inferiore al minimo, l’account viene chiuso.',
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
          'Prima della pubblicazione foto, video (attraverso alcuni fotogrammi), didascalie e foto profilo passano un controllo automatico. Ciò che viola in modo evidente le Linee guida non viene pubblicato; i casi dubbi, o quelli che non è stato possibile controllare, restano nascosti finché una persona non li esamina. Un post in revisione non può partecipare alla gara.',
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
        body: ['Puoi eliminare l’account in qualsiasi momento da Profilo → Impostazioni → Elimina account. Vengono eliminati profilo, post, commenti, cerchi, salvati, follow e partecipazioni alla gara.'],
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
          'Account: nome utente, password (conservata solo in forma cifrata, non la vediamo), nome visualizzato (il tuo nome e l’iniziale del cognome, che puoi cambiare una volta ogni 7 giorni), eventuale bio, eventuale foto profilo (visibile a tutti), un identificativo tecnico dell’account, data di accettazione dei termini.',
          'Ricerca: puoi cercare le persone per nome o nome utente. Non conserviamo le ricerche e la ricerca non mostra mai i post in gara.',
          'Dati privati, che non mostriamo agli altri utenti: nome, cognome e data di nascita.',
          'Verifica dell’età, in uno di due modi. Automatica: tramite Didit inquadri il documento d’identità e fai un breve selfie; Didit controlla che il documento sia autentico e confronta il volto del selfie con la foto del documento (un confronto biometrico), e ci comunica solo l’esito con la data di nascita letta dal documento. Con le foto: carichi la foto del documento e un selfie con il documento, che vede soltanto un amministratore. In entrambi i casi le immagini vengono cancellate appena presa la decisione; conserviamo solo l’esito, la data di nascita, la data della verifica e chi ha deciso.',
          'Contenuti: foto e video che pubblichi (con le loro dimensioni e durata), didascalie, commenti.',
          'Controllo automatico dei contenuti: prima della pubblicazione analizziamo foto, alcuni fotogrammi dei video, didascalie e foto profilo per riconoscere nudo, violenza, autolesionismo, odio e molestie. Conserviamo l’esito (pubblicabile, da rivedere, bloccato) con le categorie e i punteggi, non una copia dei contenuti; i fotogrammi dei video si cancellano appena controllati.',
          'Interazioni: cerchi (il nostro mi piace), salvataggi, condivisioni, commenti, follow, blocchi, segnalazioni, visualizzazioni dei post, il tempo per cui un post resta sullo schermo, il completamento e la ri-visione dei video. Ti mostriamo notifiche su chi ti segue e su chi interagisce con i tuoi post.',
          'Gusti: dalle interazioni ricaviamo punteggi su autori, hashtag e tipo di contenuto (foto o video) che ti interessano di più, che perdono peso col tempo (si dimezzano ogni 14 giorni). Servono solo a ordinare i post in “In gara” ed “Esplora”: non li mostriamo a nessuno, non li usiamo per la pubblicità e non li cediamo.',
          'Notifiche sul telefono, solo se le attivi: un identificativo del telefono per le notifiche (token) e le categorie che hai scelto. Serve solo a inviarti le notifiche; lo cancelliamo quando esci dall’account, quando lo elimini, quando recuperi la password con il codice (da tutti i telefoni) o la cambi dall’app (da tutti tranne quello che stai usando) e quando il telefono non risulta più raggiungibile (per esempio dopo aver disinstallato l’app).',
          'Codice di recupero della password: ne conserviamo solo una forma cifrata, non il codice.',
          'Non chiediamo email, numero di telefono, posizione o rubrica. Non usiamo pubblicità né tracciamento tra app di altre aziende.',
        ],
      },
      {
        heading: 'Perché e su quale base',
        body: [
          'Fornire il servizio, mostrare i contenuti e far funzionare la gara: esecuzione del contratto (art. 6.1.b GDPR).',
          'Sicurezza, moderazione, prevenzione di abusi e di manipolazioni della gara: legittimo interesse (art. 6.1.f) e obblighi di legge (art. 6.1.c).',
          'Controllo automatico dei contenuti prima della pubblicazione: legittimo interesse a proteggere gli utenti, in particolare i minori, e obblighi di legge sulla moderazione (art. 6.1.f e 6.1.c). Riguarda i contenuti, non la persona: non porta da solo a sospensioni dell’account, i casi dubbi li decide una persona e, se pensi che un contenuto sia stato bloccato per errore, puoi scriverci.',
          `Verifica dell’età: obbligo di legge sull’età minima per i servizi online (art. 2-quinquies del Codice privacy, ${MIN_AGE} anni) e legittimo interesse a proteggere i minori (art. 6.1.c e 6.1.f). Con la verifica automatica, il confronto tra il volto del selfie e la foto del documento è un trattamento di dati biometrici (art. 9 GDPR): lo fa Didit, una sola volta e solo per questo scopo, e solo con il tuo consenso esplicito (art. 9.2.a), che dai toccando “Verifica ora” dopo averlo letto. Puoi non darlo: in quel caso carichi le foto e il confronto lo fa una persona, senza trattamenti automatici del volto.`,
          'Ordinare i post secondo i tuoi gusti: legittimo interesse a mostrarti contenuti pertinenti (art. 6.1.f). La gara resta aperta a tutti: anche i post lontani dai tuoi gusti ti vengono proposti, solo meno spesso. Puoi sempre guardare “Seguiti”, in semplice ordine di tempo.',
        ],
      },
      {
        heading: 'Chi riceve i dati',
        body: [
          'Ciò che pubblichi è visibile agli altri utenti; la Copertina è visibile a chiunque apra l’app. Nome, nome utente, foto profilo e bio sono visibili agli altri utenti.',
          'Quando condividi un post, il link porta a una pagina del nostro sito che apre il post nell’app (o lo store): la pagina non usa cookie né strumenti di tracciamento.',
          'Fornitori che trattano i dati per nostro conto come responsabili del trattamento: Supabase (database, archiviazione dei file e autenticazione) e, per la verifica automatica dell’età, Didit (didit.me). Per questi servizi usiamo server situati nell’Unione Europea.',
          'Per il controllo automatico dei contenuti usiamo il servizio di moderazione di OpenAI (openai.com), come responsabile del trattamento: riceve foto, fotogrammi dei video, didascalie e foto profilo solo per analizzarli e restituirci l’esito. Secondo le sue condizioni per i servizi API, OpenAI non li usa per addestrare i propri modelli e li conserva solo per un periodo limitato, per sicurezza e prevenzione degli abusi.',
          'Le notifiche sul telefono passano dal servizio di Expo (650 Industries, Inc., expo.dev) e da quelli di Apple e Google, che le recapitano al telefono: ricevono solo il token del telefono e il testo della notifica.',
          'Il nostro sito (documenti legali e pagina dei link condivisi) è ospitato su GitHub Pages (GitHub, Inc.): come per ogni sito, GitHub riceve l’indirizzo IP e i dati tecnici del browser di chi lo visita.',
          'Trasferimenti fuori dall’Unione Europea: OpenAI, Expo, Apple, Google e GitHub possono trattare questi dati negli Stati Uniti. Il trasferimento si basa sulla decisione di adeguatezza UE-USA (Data Privacy Framework, art. 45 GDPR) per le aziende che vi aderiscono e, in ogni caso, sulle clausole contrattuali tipo approvate dalla Commissione europea (art. 46 GDPR). Puoi chiederne copia scrivendoci.',
          'Autorità, quando la legge lo impone.',
        ],
      },
      {
        heading: 'Quanto li conserviamo',
        body: [
          'Finché l’account esiste. Quando elimini un post o l’account, i dati vengono cancellati dai sistemi attivi subito e dalle copie di sicurezza entro 30 giorni.',
          'I dati tecnici delle singole visualizzazioni della gara vengono cancellati dopo 7 giorni; quelli delle visualizzazioni dei post dopo 2 giorni (resta solo il conteggio).',
          'Le foto del documento e del selfie vengono cancellate appena presa la decisione (anche da Didit, se la verifica è automatica), e comunque eliminando l’account.',
          'Gli esiti del controllo automatico restano finché il contenuto è pubblicato (o la foto è quella del profilo); quelli delle didascalie e dei contenuti non pubblicati, bloccati o eliminati si cancellano dopo 7 giorni. I contenuti bloccati vengono cancellati subito.',
          'I post già visti, usati per non riproporteli in Esplora, dopo 30 giorni; i punteggi dei gusti non aggiornati da 120 giorni vengono cancellati.',
          'Le segnalazioni e le decisioni di moderazione si conservano fino a 12 mesi dalla decisione, per gestire ricorsi e abusi ripetuti, poi si cancellano. Se l’account segnalato o quello che ha segnalato viene eliminato, si cancellano subito le copie dei contenuti e le note salvate con la segnalazione.',
          'Le notifiche sul telefono già inviate si cancellano dopo 7 giorni; le notifiche nell’app dopo 90 giorni.',
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
      {
        heading: 'Sito web e beta',
        body: [
          'Il sito di Virale non usa cookie, né strumenti di analisi o di tracciamento, né risorse di altri siti: il fornitore che lo ospita (GitHub, negli Stati Uniti, con le garanzie del Data Privacy Framework) registra solo i dati tecnici necessari a mostrare le pagine.',
          'Se ci scrivi per entrare nella beta, usiamo il tuo indirizzo email solo per aggiungerti ai tester su Google Play (base: la tua richiesta) e lo cancelliamo dai nostri messaggi al termine della beta. Se entri nel gruppo dei tester su Google Gruppi, quel dato lo tratta Google secondo la sua informativa; puoi uscire dal gruppo e dal test quando vuoi.',
        ],
      },
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
          'Prima di uscire, ogni post passa un controllo automatico: se viola in modo evidente queste regole non viene pubblicato; se è dubbio resta nascosto finché non lo esaminiamo.',
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
          'Profilo, foto e video pubblicati, didascalie, commenti, cerchi, salvati, follow, blocchi e partecipazioni alla gara. Le tue Copertine spariscono anche dall’Archivio.',
          'Le copie di sicurezza vengono sovrascritte entro 30 giorni. Le segnalazioni che ti riguardano possono essere conservate fino a 12 mesi per prevenire abusi.',
        ],
      },
    ],
  },
};
