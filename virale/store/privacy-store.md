# Risposte per "Privacy dell'app" (Apple) e "Sicurezza dei dati" (Google)

Coerenti con l'Informativa privacy (`src/legal/docs.ts`) e con quello che il codice fa davvero:
nessun SDK di analisi o pubblicità, nessun tracciamento tra app, nessuna posizione, nessun contatto.
Le notifiche push (facoltative) usano un token del telefono, inviato tramite Expo, Apple e Google solo per
recapitarle. La verifica automatica dell'età (Didit, facoltativa) fa un **confronto biometrico del volto** tra
selfie e documento, solo con il consenso esplicito dell'utente. Prima della pubblicazione foto, fotogrammi dei video,
didascalie e foto profilo passano dal controllo automatico di OpenAI (Moderation API, chiamata solo dal server): è
un fornitore che tratta i dati per nostro conto, non una "condivisione", e non cambia le risposte qui sotto
(i dati sono gli stessi: foto, video, didascalie). L'accesso con **Google o Facebook** passa dalla pagina del
provider nel browser (OAuth gestito da Supabase, nessun SDK di Google o Meta nell'app): riceviamo nome, email,
immagine del profilo (non usata) e un identificativo, usati solo per l'accesso; l'email non è visibile agli altri
utenti e non pubblichiamo nulla sui social. Si entra solo così: l'app non ha password né codici di recupero. Se aggiungi servizi (es. Sentry, analytics)
**aggiorna queste risposte e l'informativa**.

---

## Apple — App Store Connect → Privacy dell'app

**Raccogli dati da questa app?** Sì.

| Tipo di dato (nome Apple) | Raccolto | Collegato all'identità | Usato per tracciare | Scopo |
|---|---|---|---|---|
| Contatti → Nome (nome e cognome; agli altri si mostra nome e iniziale) | Sì | Sì | No | Funzionalità dell'app, Gestione account |
| Altri dati → Data di nascita (Apple non ha una voce dedicata: "Altri tipi di dati") | Sì | Sì | No | Funzionalità dell'app (età minima) |
| Altri dati → Documento d'identità e selfie (cancellati dopo la verifica) | Sì | Sì | No | Funzionalità dell'app (verifica dell'età) |
| Informazioni sensibili → Dati biometrici (confronto del volto del selfie con la foto del documento, fatto da Didit solo con la verifica automatica e con il consenso esplicito; immagini cancellate dopo la decisione) | Sì | Sì | No | Funzionalità dell'app (verifica dell'età) |
| Contenuti utente → Foto o video (post e foto profilo facoltativa) | Sì | Sì | No | Funzionalità dell'app |
| Contenuti utente → Altri contenuti utente (didascalie, commenti, bio) | Sì | Sì | No | Funzionalità dell'app |
| Identificatori → ID utente | Sì | Sì | No | Funzionalità dell'app |
| Identificatori → ID dispositivo (token per le notifiche push, solo se l'utente le attiva) | Sì | Sì | No | Funzionalità dell'app |
| Utilizzo → Interazioni con il prodotto (visioni, mi piace, salvataggi, condivisioni) | Sì | Sì | No | Funzionalità dell'app (la gara si basa su queste) |
| Contatti → Indirizzo email (ricevuto da Google o Facebook con l'accesso; mai mostrato agli altri utenti) | Sì | Sì | No | Gestione account (accesso); Supporto se l'utente ci scrive |

Nota: le foto del documento e del selfie vengono cancellate appena presa la decisione (anche da Didit). Nelle note per
la revisione (`revisione.md`) spiega che la verifica serve all'età minima di legge e che, con la verifica automatica,
Didit confronta il volto del selfie con la foto del documento (un solo confronto 1:1, nessuna identificazione, nessun
uso per altri scopi), solo dopo il consenso esplicito dell'utente; chi non lo dà manda le foto a un amministratore.

Tutto il resto: **Non raccolto** (posizione, contatti, salute, finanze, cronologia di navigazione,
ricerca, diagnostica, altri dati sensibili, identificatori pubblicitari).

**Tracciamento:** No → non serve il prompt App Tracking Transparency.

---

## Google Play — Play Console → Contenuti dell'app → Sicurezza dei dati

- La tua app raccoglie o condivide dati utente dei tipi richiesti? **Sì**
- Tutti i dati raccolti sono criptati in transito? **Sì** (HTTPS)
- Fornite un modo per richiedere l'eliminazione dei dati? **Sì** — nell'app e a <sito>/eliminazione-account.html
- Condivisione con terze parti: **No** (Supabase, Didit, OpenAI ed Expo sono fornitori che trattano i dati per tuo conto: non conta come "condivisione")

| Categoria → tipo | Raccolto | Condiviso | Facoltativo? | Scopo |
|---|---|---|---|---|
| Informazioni personali → Nome | Sì | No | Obbligatorio (nome, cognome, nome utente) | Funzionalità app, Gestione account |
| Informazioni personali → Altre informazioni (data di nascita) | Sì | No | Obbligatorio | Funzionalità app (età minima), Sicurezza |
| Informazioni personali → Altre informazioni (documento d'identità e selfie, solo per la verifica dell'età, cancellati dopo la decisione; con la verifica automatica Didit confronta il volto del selfie con la foto del documento, un trattamento biometrico fatto solo con il consenso esplicito) | Sì | No | Obbligatorio per pubblicare | Prevenzione frodi, sicurezza e conformità |
| Informazioni personali → ID utente (anche l'identificativo dell'account Google o Facebook usato per entrare) | Sì | No | Obbligatorio | Funzionalità app, Gestione account |
| Informazioni personali → Indirizzo email (ricevuto da Google o Facebook con l'accesso; mai mostrato agli altri utenti) | Sì | No | Obbligatorio (manca solo per gli account Facebook senza email) | Gestione account |
| ID dispositivo o altri ID → ID dispositivo (token per le notifiche push) | Sì | No | Facoltativo (solo con le notifiche attive) | Funzionalità app (notifiche); non per pubblicità né tracciamento |
| Foto e video → Foto (post e foto profilo) | Sì | No | Facoltativo | Funzionalità app, Sicurezza (controllo automatico prima della pubblicazione) |
| Foto e video → Video | Sì | No | Facoltativo | Funzionalità app, Sicurezza (controllo automatico prima della pubblicazione) |
| Attività nelle app → Interazioni con l'app | Sì | No | Obbligatorio | Funzionalità app, Prevenzione frodi |
| Attività nelle app → Altri contenuti generati dagli utenti (commenti, didascalie, bio) | Sì | No | Facoltativo | Funzionalità app |
| Messaggi → Email | Solo se l'utente scrive al supporto | No | Facoltativo | Supporto |

Nota: l'accesso con Google o Facebook non è una "condivisione" con Google o Meta (sono loro a comunicarci i dati,
su richiesta dell'utente) e non cambia la risposta "Tracciamento: No".

I dati vengono trattati in modo effimero? **No** (restano finché l'utente non li elimina).

---

## Altre sezioni di Play Console → Contenuti dell'app

- **Norme sulla privacy:** <sito>/privacy.html
- **Annunci:** l'app non contiene annunci.
- **Accesso alle app:** tutte le funzionalità sono disponibili senza credenziali speciali (vedi `revisione.md`).
- **Classificazione dei contenuti (IARC):** categoria "Social o comunicazione"; rispondi **Sì** a
  "Gli utenti possono interagire o scambiarsi contenuti" e "Gli utenti possono condividere foto/video";
  **No** a violenza, sesso, droghe, gioco d'azzardo nel contenuto *fornito da te*. Risultato atteso: PEGI 12 / Teen.
- **Pubblico di destinazione:** 13–15, 16–17, 18+ **non** selezionare fasce sotto i 13. L'app non è rivolta ai bambini.
- **App di notizie:** No. **App governative:** No. **Funzionalità finanziarie:** nessuna. **Salute:** nessuna.

## Apple → Classificazione per età
Domande del questionario: tutte "Nessuno" tranne **Contenuti generati dagli utenti / interazione tra utenti: Sì**.
Il risultato tipico è **13+** (Apple non ha una fascia 14+). È coerente con l'età minima 14 dei Termini:
l'app la fa rispettare con la casella di conferma all'iscrizione.
