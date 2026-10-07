# PreventivoLampo

**Preventivi professionali dal telefono in 60 secondi, per artigiani.**
Il cliente chiede un preventivo, l'artigiano lo fa sul posto dal telefono (listino già pronto per il suo mestiere o dettatura vocale), lo manda su WhatsApp con un **link di accettazione**: il cliente lo apre sul suo telefono, sceglie le voci facoltative, firma e rimanda la conferma. Tutto senza server e senza database.

Modello di business: **freemium** (3 preventivi PDF al mese gratis, con la scritta "Creato con PreventivoLampo") → **Pro a 9,90 €/mese o 79 €/anno**.

> Il piano per arrivare a 5-10k €/mese, con i numeri e le azioni settimana per settimana, è in **[PIANO.md](PIANO.md)**.

---

## Cosa c'è dentro

| Parte | Dove | Cosa fa |
|---|---|---|
| Sito di vendita | `public/index.html` | Landing con prezzi, FAQ, link ai modelli |
| App | `public/app.html` + `public/js/` | L'app vera e propria (funziona offline, si installa sul telefono) |
| Pagina del cliente | `public/accetta.html` + `public/js/accetta.js` | Dove il cliente vede, accetta e firma il preventivo ricevuto via link |
| 27 pagine "modello di preventivo" | `public/modelli/` | Pagine per Google ("fac simile preventivo idraulico"…): portano clienti gratis |
| Verifica licenze | `lib/licenza.mjs` + `netlify/functions/` + `functions/api/` | Controlla il codice Pro con Polar o Lemon Squeezy |
| Configurazione | `public/js/config.js` | **L'unico file che devi modificare**: link di pagamento, prezzi, email, dati titolare |
| Test | `tests/` | 74 test unitari + 37 passaggi end-to-end nel browser (artigiano e cliente su due "telefoni", più un telefono touch per la pagina di pagamento) |

Scelte che rendono il progetto semplice da gestire da soli:

- **Nessun database, nessun server da mantenere.** I dati di clienti e preventivi restano sul telefono dell'artigiano (IndexedDB). Niente costi di hosting che crescono con gli utenti, niente rischi di data breach.
- **Pagamenti con un "Merchant of Record"** (Polar o Lemon Squeezy): incassano loro, applicano l'IVA di ogni paese, mandano le ricevute e gestiscono rinnovi e disdette. Tu ricevi il netto.
- **Nessuna libreria da installare.** È HTML/JavaScript puro: si pubblica così com'è, gratis.

### Funzioni che fanno vincere più lavori

- **Accettazione e firma online senza server.** Il preventivo viaggia compresso nel link, nella parte dopo `#`, che i browser non mandano mai al server. Il cliente lo apre, firma con il dito e rimanda la conferma su WhatsApp; l'artigiano la registra con un tocco. Un'impronta SHA-256 segnala se qualcuno ha modificato prezzi o voci nel link.
- **Voci facoltative (upsell).** Extra proposti al cliente, esclusi dal totale: il cliente li attiva da solo quando accetta.
- **Da ricontattare.** I preventivi inviati senza risposta da qualche giorno compaiono in cima alla dashboard, con il messaggio di sollecito su WhatsApp già scritto.
- **Foto del lavoro** in una pagina del PDF (Pro).
- **Calcolatore metri quadri** per stanza: pareti, soffitto e pavimento, meno porte e finestre.
- **Guadagno nascosto.** Il costo d'acquisto dei materiali e il margine si vedono solo nell'app, mai nel PDF o nel link.
- **Dettatura di più voci in una frase**, abbinate al listino ("sostituzione miscelatore, poi 2 ore di manodopera").
- **Pagamento dell'acconto.** Il cliente che accetta vede il link di pagamento online dell'artigiano (solo https), il pulsante "Copia dati del bonifico" (beneficiario, IBAN, importo e causale in un tocco, da incollare nell'app della banca) e l'IBAN. Il QR del bonifico c'è, ma dal telefono parte chiuso ("Paghi da un altro dispositivo?"): uno schermo non si può inquadrare da solo, e non tutte le app bancarie italiane leggono i QR SEPA.
- **Data di inizio scelta dal cliente.** L'artigiano propone fino a 3 date; il cliente ne sceglie una mentre firma. La data finisce in agenda ("Prossimi lavori"), nel PDF e nel calendario del telefono (file .ics). Nel link di conferma viaggia solo il numero della data scelta, quindi il cliente non può inventarne un'altra.

### "E se il cliente firma ma non paga?" — Incassi protetti

Tre livelli, tutti senza server:

1. **Prevenire**
   - **Caparra confirmatoria (art. 1385 c.c.)** al posto del semplice acconto, con la dicitura su PDF e pagina del cliente. Se il cliente non rispetta l'accordo, l'artigiano può recedere e trattenerla.
   - **QR del bonifico SEPA** (standard EPC, "QR bonifico") dove serve davvero: sul PDF stampato o aperto al PC, a schermo intero sul telefono dell'artigiano quando il cliente paga di persona ("Mostra QR"), e sulla pagina del cliente aperta da computer. Si inquadra con l'app della banca e importo, IBAN e causale si compilano da soli. L'IBAN viene controllato (mod 97) nelle impostazioni: un errore nelle cifre manderebbe i soldi altrove.
   - Un avviso "inizia i lavori solo dopo l'acconto" finché l'acconto non è arrivato.
2. **Seguire**
   - **Registro incassi** per preventivo: pagamenti con metodo e nota, data di fine lavori, scadenza del saldo (0-90 giorni). L'importo scaduto si calcola da solo.
   - **Dashboard "Da incassare"**: totale da incassare, quanto è scaduto e lavori in ordine di urgenza.
   - **Pulsante "Ho pagato" per il cliente**: manda all'artigiano un avviso su WhatsApp. L'artigiano lo apre, controlla sul conto e lo registra con un tocco. Un'impronta impedisce di registrare due volte lo stesso avviso, e l'avviso non conta come incasso finché non viene confermato.
3. **Recuperare**
   - **Solleciti in tre toni** (cortese, sollecito, ultimo avviso) con importo, scadenza e IBAN già scritti, modificabili prima dell'invio. Il registro dei solleciti tiene date e canali, e suggerisce di aspettare una settimana tra un messaggio e l'altro.
   - **Link di pagamento** per il cliente: importo, già pagato, "Paga online", "Copia dati del bonifico", IBAN e causale da copiare, QR per chi paga da un altro dispositivo, pulsante "Ho pagato".
   - **"Ricordami la scadenza"**: mette la prossima scadenza di pagamento nel calendario del telefono dell'artigiano (file .ics con promemoria), così il controllo arriva anche senza notifiche dal server.
   - **Lettera di sollecito e costituzione in mora** (art. 1219 c.c., termine di 15 giorni, interessi se l'artigiano inserisce il tasso), pronta da firmare e inviare con PEC o raccomandata (Pro).
   - **Fascicolo del credito** (Pro): il preventivo firmato più un riepilogo con prova dell'accettazione (data, ora, nome, impronta del documento accettato online), pagamenti, solleciti e importo scaduto. È quello che serve a un avvocato per un decreto ingiuntivo.

A lavoro pagato, la dashboard suggerisce di **chiedere una recensione** su WhatsApp con il link Google dell'artigiano.

I testi legali sono modelli generici, non consulenza: per crediti importanti l'artigiano deve rivolgersi a un professionista. L'app lo scrive chiaramente nelle impostazioni.

Inoltre: onboarding in 2 passi con listino per 27 mestieri · IVA 22/10/5/4/0% anche mista · regime forfettario con dicitura di legge e bollo 2 € · acconto e saldo · numerazione per anno · PDF multipagina con link "Accetta e firma online" · firma sul posto (Pro) · dashboard con valore del mese, tasso di accettazione e grafico di 6 mesi · clienti · listino con costi · logo e colori (Pro) · backup/ripristino · offline · installabile · tema chiaro e scuro.

### Sicurezza

- Content Security Policy su tutte le pagine (nessuno script inline), intestazioni anti-clickjacking in `public/_headers`.
- Tutti i dati che arrivano da link o da backup vengono validati e mostrati come testo: i test tentano XSS, link `javascript:`, link manomessi, link troncati, "bombe" di compressione e backup costruiti ad arte.
- I backup vengono controllati **prima** di cancellare i dati attuali; la licenza non finisce mai nel backup.
- La funzione licenze rifiuta input malformati o troppo grandi e accetta solo codici del proprio negozio.

---

## 1. Provalo sul tuo computer (5 minuti)

Serve [Node.js](https://nodejs.org) (versione 20 o superiore).

```bash
cd preventivolampo
npm run dev
```

Apri http://localhost:5173 (sito) e http://localhost:5173/app.html (app).
Per provarlo sul telefono, pubblicalo online (passo 2): è gratis.

## 2. Pubblicalo online gratis

### Opzione A - Netlify (la più semplice)

1. Crea un account su [netlify.com](https://netlify.com) e scegli **Add new site → Import an existing project → GitHub**, poi seleziona questo repository.
2. Impostazioni di build:
   - **Base directory:** `preventivolampo`
   - **Build command:** lascia vuoto
   - **Publish directory:** `preventivolampo/public` (Netlify la propone in automatico da `netlify.toml`)
   - **Functions directory:** `preventivolampo/netlify/functions`
3. **Deploy**. Dopo un minuto hai un indirizzo tipo `https://nome-a-caso.netlify.app`.
4. Dominio: compra `preventivolampo.it` (o un nome tuo, ~10 €/anno, ad es. su Netlify stesso, Aruba, Register.it) e collegalo da **Domain management**. HTTPS è automatico.

### Opzione B - Cloudflare Pages (traffico illimitato gratis)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Pages → Connect to Git** → questo repository.
2. **Root directory:** `preventivolampo` · **Build command:** vuoto · **Build output directory:** `public`.
3. La cartella `functions/` viene riconosciuta da sola: `/api/licenza` funziona senza altro.

Le variabili d'ambiente (passo 3) si impostano in **Site configuration → Environment variables** (Netlify) o **Settings → Variables** (Cloudflare). Dopo averle cambiate rifai il deploy.

## 3. Collega i pagamenti

Consiglio **[Polar](https://polar.sh)** (Merchant of Record, commissione circa 5% + 0,50 $). In alternativa [Lemon Squeezy](https://lemonsqueezy.com): il codice supporta entrambi.

### Con Polar

1. Crea l'account e l'organizzazione. Collega il conto per i pagamenti (Stripe, disponibile in Italia).
2. **Prodotti** → crea:
   - "PreventivoLampo Pro - Mensile": abbonamento mensile, **9,90 €**
   - "PreventivoLampo Pro - Annuale": abbonamento annuale, **79 €**
   - (facoltativo, per il lancio) "PreventivoLampo Pro - A vita": pagamento unico, **149 €**
3. In ogni prodotto aggiungi il **Benefit "License Keys"** (lo stesso benefit per tutti va bene). Il cliente riceve il codice per email dopo l'acquisto; se l'abbonamento finisce il codice smette di funzionare da solo.
4. Per ogni prodotto crea un **Checkout Link** e come **Success URL** metti
   `https://IL-TUO-DOMINIO/app.html#/pro?acquisto=ok`
5. Copia i tre link in `public/js/config.js`, sezione `checkout`, e il link del portale clienti (`https://polar.sh/IL-TUO-SLUG/portal`) in `portaleClienti`.
6. Variabili d'ambiente sul sito (Netlify/Cloudflare):

   | Variabile | Valore |
   |---|---|
   | `LICENZE_PROVIDER` | `polar` |
   | `POLAR_ORGANIZATION_ID` | l'ID dell'organizzazione (Impostazioni di Polar) |
   | `POLAR_BENEFIT_IDS` | (facoltativo) l'ID del benefit License Keys, per accettare solo i tuoi codici |
   | `POLAR_SANDBOX` | `true` solo mentre fai le prove con l'ambiente sandbox di Polar |

7. **Prova tutto con la sandbox di Polar** (carte di test): compra, copia il codice dall'email, incollalo nell'app in *Passa a Pro → Hai un codice licenza?*. Quando funziona, togli `POLAR_SANDBOX` e usa i link di produzione.

> Se Polar non ti permette di fissare il prezzo in euro, usa Lemon Squeezy: per un artigiano italiano vedere "9,90 €" invece di "$10.90" conta.

### Con Lemon Squeezy

Stessi passi: prodotti con **License keys** attive, checkout con redirect a `…/app.html#/pro?acquisto=ok`, link in `config.js`. Variabili: `LICENZE_PROVIDER=lemonsqueezy` e `LEMONSQUEEZY_STORE_ID=<id del negozio>` (serve per accettare solo codici del tuo negozio).

## 4. Personalizza `public/js/config.js`

- `sito`, `dominioBreve`, `emailSupporto`
- `titolare`: nome, indirizzo e partita IVA (compaiono in privacy e termini)
- `prezzi`: devono coincidere con quelli dei prodotti
- `pdfGratisAlMese`: limite del piano gratuito (3 è un buon inizio)
- `statistiche`: Plausible o Umami (senza cookie, nessun banner) per misurare il funnel. Eventi già tracciati: *Onboarding completato, PDF creato, Preventivo inviato, Firma cliente, Paywall, Checkout, Pro attivato*.

Se cambi dominio, rigenera pagine SEO, sitemap e URL canonici:

```bash
npm run seo
```

Poi registra il sito su [Google Search Console](https://search.google.com/search-console) e invia `https://IL-TUO-DOMINIO/sitemap.xml`.

## 5. Test

```bash
npm test          # 41 test: IVA/forfettario/acconti, facoltative, margine, superfici, dettatura,
                  # link di accettazione (compressione, sanificazione, manomissioni), firma, backup, licenze
npm run test:e2e  # 29 passaggi nel browser con artigiano e cliente su due "telefoni": onboarding,
                  # preventivo, PDF, accettazione online completa, attacchi XSS, link manomessi,
                  # foto, calcolatore, ricontatti, limite gratuito, Pro, forfettario, offline,
                  # backup, schermi stretti, accessibilità di base e zero violazioni CSP
npm run lint      # controllo statico (richiede eslint: npm i -g eslint)
```

Il test end-to-end richiede Playwright (`npm i -g playwright && npx playwright install chromium`) e `pdftotext`/`pdfimages` (pacchetto `poppler-utils`).

Altri script: `npm run icone` (icone PNG dall'SVG), `node scripts/genera-screenshot.mjs` (immagini della landing e immagine di condivisione).

## 6. Prima di incassare

- **Partita IVA.** Un abbonamento ricorrente è un'attività abituale: serve la partita IVA (il regime forfettario va benissimo per iniziare). Chiedi al commercialista il codice ATECO per la vendita di software/servizi online e come registrare i versamenti del Merchant of Record (che ti paga come rivenditore estero). Costo tipico: qualche centinaio di euro l'anno.
- **Privacy e termini** sono in `public/privacy.html` e `public/termini.html`: compila i dati del titolare in `config.js` e falli rileggere da un professionista quando i ricavi crescono.
- I **prezzi indicativi** dei listini (`public/js/mestieri.js`) sono medie di mercato: l'app li presenta come base da modificare.

## Limiti attuali (e prossimi passi)

- I dati stanno su un solo dispositivo: telefono e computer non si sincronizzano (c'è backup/ripristino). La sincronizzazione cloud è il candidato naturale per un piano "Pro+" più caro.
- Il blocco del piano gratuito è nel browser: un utente esperto potrebbe aggirarlo. Il pubblico (artigiani) non è quello che lo fa, e la funzione Pro principale (niente scritta, logo, firma) resta comunque legata al codice.
- Il link di accettazione contiene i dati del preventivo: chi lo riceve può leggerli (come un PDF). Va mandato solo al cliente. La conferma torna all'artigiano solo se il cliente tocca "Invia conferma".
- Idee per far crescere il valore (e il prezzo): rapportino di intervento firmato, sincronizzazione tra dispositivi, piano "Team" per imprese con più operai, conversione in fattura tramite API di un provider SdI.
