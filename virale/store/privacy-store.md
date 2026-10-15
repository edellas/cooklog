# Risposte per "Privacy dell'app" (Apple) e "Sicurezza dei dati" (Google)

Coerenti con l'Informativa privacy (`src/legal/docs.ts`) e con quello che il codice fa davvero:
nessun SDK di analisi o pubblicità, nessun tracciamento tra app, nessuna posizione, nessun contatto.
Se aggiungi servizi (es. Sentry, analytics, notifiche push) **aggiorna queste risposte e l'informativa**.

---

## Apple — App Store Connect → Privacy dell'app

**Raccogli dati da questa app?** Sì.

| Tipo di dato (nome Apple) | Raccolto | Collegato all'identità | Usato per tracciare | Scopo |
|---|---|---|---|---|
| Contatti → Nome (nome e cognome; agli altri si mostra nome e iniziale) | Sì | Sì | No | Funzionalità dell'app, Gestione account |
| Altri dati → Data di nascita (Apple non ha una voce dedicata: "Altri tipi di dati") | Sì | Sì | No | Funzionalità dell'app (età minima) |
| Altri dati → Documento d'identità e selfie (cancellati dopo la verifica) | Sì | Sì | No | Funzionalità dell'app (verifica dell'età) |
| Contenuti utente → Foto o video | Sì | Sì | No | Funzionalità dell'app |
| Contenuti utente → Altri contenuti utente (didascalie, commenti, bio) | Sì | Sì | No | Funzionalità dell'app |
| Identificatori → ID utente | Sì | Sì | No | Funzionalità dell'app |
| Utilizzo → Interazioni con il prodotto (visioni, mi piace, salvataggi, condivisioni) | Sì | Sì | No | Funzionalità dell'app (la gara si basa su queste) |
| Contatti → Indirizzo email | Solo se l'utente ci scrive | Sì | No | Supporto |

Nota: le foto del documento vengono cancellate appena l'amministratore decide. Nelle note per la revisione
(`revisione.md`) spiega che la verifica serve all'età minima di legge e che non c'è riconoscimento facciale automatico.

Tutto il resto: **Non raccolto** (posizione, contatti, salute, finanze, cronologia di navigazione,
ricerca, diagnostica, dati sensibili, identificatori del dispositivo/pubblicitari).

**Tracciamento:** No → non serve il prompt App Tracking Transparency.

---

## Google Play — Play Console → Contenuti dell'app → Sicurezza dei dati

- La tua app raccoglie o condivide dati utente dei tipi richiesti? **Sì**
- Tutti i dati raccolti sono criptati in transito? **Sì** (HTTPS)
- Fornite un modo per richiedere l'eliminazione dei dati? **Sì** — nell'app e a <sito>/eliminazione-account.html
- Condivisione con terze parti: **No** (Supabase è un fornitore che tratta i dati per tuo conto: non conta come "condivisione")

| Categoria → tipo | Raccolto | Condiviso | Facoltativo? | Scopo |
|---|---|---|---|---|
| Informazioni personali → Nome | Sì | No | Obbligatorio (nome, cognome, nome utente) | Funzionalità app, Gestione account |
| Informazioni personali → Altre informazioni (data di nascita) | Sì | No | Obbligatorio | Funzionalità app (età minima), Sicurezza |
| Informazioni personali → Altre informazioni (documento d'identità e selfie, solo per la verifica dell'età, cancellati dopo la decisione) | Sì | No | Obbligatorio per pubblicare | Prevenzione frodi, sicurezza e conformità |
| Informazioni personali → ID utente | Sì | No | Obbligatorio | Funzionalità app, Gestione account |
| Foto e video → Foto | Sì | No | Facoltativo | Funzionalità app |
| Foto e video → Video | Sì | No | Facoltativo | Funzionalità app |
| Attività nelle app → Interazioni con l'app | Sì | No | Obbligatorio | Funzionalità app, Prevenzione frodi |
| Attività nelle app → Altri contenuti generati dagli utenti (commenti, didascalie, bio) | Sì | No | Facoltativo | Funzionalità app |
| Messaggi → Email | Solo se l'utente scrive al supporto | No | Facoltativo | Supporto |

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
