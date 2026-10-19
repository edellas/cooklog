# Virale

**Funziona come TikTok: si pubblicano foto e video e si scorrono in verticale. In più, ogni giorno un solo post diventa la Copertina, e il giorno dopo lo vede chiunque apra l'app.**

App mobile multipiattaforma (iOS, Android e web dallo stesso codice) in Expo SDK 54 / React Native, con Expo Router.

- **Prototipo interattivo** (18 passaggi, stile Figma): `python3 prototype/build.py` → `prototype/dist/virale-prototipo.html`.
- **App cliccabile in una sola pagina** (l'app vera in modalità demo, con cornice da telefono): `npx expo export --platform web --output-dir /tmp/virale-web && python3 scripts/make-anteprima.py /tmp/virale-web anteprima.html`.
- **Linguaggio visivo**: [DESIGN.md](DESIGN.md).

## Cosa fa

| Schermata | Cosa succede |
|---|---|
| **Benvenuto** | Registrazione con nome, cognome, data di nascita, nome utente e password (niente email). Gli errori compaiono sotto il campo giusto; il nome utente si controlla mentre lo scrivi. Dopo l'iscrizione si riceve il **codice di recupero** della password ("Password dimenticata?"). |
| **Copertina** | Il post vincitore della gara appena chiusa, a tutta pagina, con testata, numero dell'uscita e data. È identica per tutti. Il pulsante "Guarda i provini di oggi" porta alla gara; sotto, quando esce la prossima. Se vinci, una festa ("Hai vinto!") da condividere. |
| **Provini** | Il feed verticale, in tre sezioni: **In gara** (i post candidati oggi, scelti dal server alla cieca: si vota guardando, ognuno lo vedi una volta sola), **Esplora** (tutti gli altri post, secondo i tuoi gusti, senza fine) e **Seguiti**. Doppio tocco = cerchio (il nostro mi piace), poi commenti, salva, condividi, segui, "Non mi interessa". Lente per cercare persone. |
| **Pubblica** (pulsante giallo) | Da 1 a 10 foto e/o video dalla galleria o dalla fotocamera. I video pesanti si comprimono sul telefono prima del caricamento; la pubblicazione si può annullare. Si sceglie se candidarsi per la prossima copertina (un post al giorno). |
| **Archivio** | Tutte le copertine uscite, con il loro numero, a pagine. |
| **Profilo** | Foto, nome e bio modificabili; follower, seguiti, copertine vinte; il tuo post in gara oggi con i cinque gradini; i tuoi post e i salvati; notifiche; impostazioni (password, codice di recupero, notifiche push, utenti bloccati, eliminazione dell'account). |
| **Commenti / Azioni / Regole** | Fogli nativi (form sheet). Commenti e profili si possono segnalare; i moderatori hanno una coda con due schede (post; commenti e profili). |

## Come si sceglie la copertina

1. Ogni post candidato parte da un piccolo pubblico: **Provino**, 50 visualizzazioni.
2. Al raggiungimento della soglia viene valutato. Sale solo se batte l'80% dei post che hanno completato lo stesso gradino quel giorno: **Bozza** (300) → **Impaginato** (1.800) → **In macchina** (10.000) → **Finale**.
3. Il voto è il modo in cui si guarda. Punti per vista:

   | Gesto | Punti |
   |---|---|
   | Visto fino in fondo (un video almeno per il 60% della durata: trascinare la barra non conta) | +1 |
   | Riguardato | +1,5 |
   | Cerchiato (mi piace) | +2 |
   | Commentato | +3 |
   | Salvato | +3 |
   | Condiviso | +6 |
   | Scorso via subito | −1,5 |
   | Segnalato | −20 |

   Il punteggio parte da una media di prudenza di 20 visualizzazioni, così pochi spettatori fortunati non bastano.
4. All'orario della copertina scelto dall'amministratore (ora di Roma, di norma mezzanotte) la gara chiude: vince chi è salito più in alto; a parità, il limite inferiore del punteggio più alto. Senza voti validi vince il post più apprezzato. La copertina esce subito.
5. **Anti-trucchi**:
   - si vota solo ciò che il server ti ha mostrato, una volta e mai sul proprio post;
   - gli account con meno di 24 ore guardano ma non votano;
   - oltre il 2% di segnalazioni si è fuori gara;
   - chi va in copertina aspetta 30 giorni per ricandidarsi;
   - i contatori di like, salvataggi e commenti li mantiene il database.

## Avvio

```bash
cd virale
npm install
npx expo start        # i = iOS, a = Android, w = web, oppure il QR con Expo Go
```

Senza configurazione parte in **modalità demo**:
- creator, foto e video di esempio e un pubblico simulato che continua a guardare mentre usi l'app (anche il tuo post sale di gradino dal vivo);
- tutto resta sul dispositivo (anche più account, il codice di recupero e la verifica dell'età simulata);
- il link "Demo: simula la mezzanotte" sotto la copertina chiude subito la gara;
- niente notifiche push (servono l'app per telefono e Supabase).

Una build di **produzione** (`EXPO_PUBLIC_APP_ENV=production`) senza Supabase o senza i dati del titolare (`EXPO_PUBLIC_OWNER_*`) si apre su "Configurazione mancante" con l'elenco delle variabili: è voluto.

## Verifiche

```bash
npm test            # 28 test: motore della gara e misura onesta dei video (videoProgress)
npm run simulate    # simulazione con migliaia di spettatori
npm run typecheck
npm run lint
npm run check:release   # dati del titolare, sito, pagine legali: cosa manca prima di pubblicare
```

- **Simulazione** (`npm run simulate -- 300 5000 30 10`): 300 post e 5.000 spettatori, con il 2% di spam acchiappa-click. Il vincitore è tra i 5 migliori per qualità reale in 10 giorni su 10 (il migliore in 7) e lo spam non vince mai.
- **Database**: `supabase/tests/e2e.sql`, su Postgres 16, verifica le regole della gara:
  - media non validi rifiutati (0 o più di 10 elementi, video oltre 60 s);
  - contatori falsificati rifiutati;
  - doppia candidatura e candidatura di un post altrui rifiutate;
  - voto su un post non servito e doppio voto rifiutati;
  - nessuno vede il proprio post;
  - mi piace a nome di altri rifiutato;
  - contatori corretti, feed "Seguiti", profilo;
  - promozione tra gradini, vincitore, chiusura idempotente;
  - `anon` non può chiudere la giornata;
  - nomi utente riservati e regole del profilo (nome una volta ogni 7 giorni, bio, foto);
  - segnalazione di commenti e profili, coda di moderazione, notifiche di rimozione con il motivo;
  - commenti coerenti (conteggi, blocchi, espulsi), ricerca di persone, Archivio a pagine con il numero dell'uscita;
  - Esplora che non finisce, pulizia dei file programmata (solo con la chiave di servizio);
  - controllo automatico dei contenuti: niente post senza esito del controllo (né con quello di un altro utente o con una didascalia diversa), "review" pubblica nascosto e fuori gara fino ad "Approva", gli esiti li scrive solo la chiave di servizio;
  - codice di recupero (solo l'impronta, una volta sola, 5 tentativi l'ora), notifiche push (preferenze, ore di silenzio 22–8, raggruppamento), "Non mi interessa", completamento dei video con un tempo minimo.

  Lo schema si può rieseguire su un database esistente: aggiorna senza perdere dati.

  ```bash
  createdb virale_test
  psql -d virale_test -v ON_ERROR_STOP=1 -f supabase/tests/auth-stub.sql -f supabase/schema.sql -f supabase/tests/e2e.sql
  ```
- **Carico**: con 20.000 post in gara, servire 10 Provini (già composti in JSON) e registrare 10 voti richiede circa 20 ms su un core (Postgres 16 locale, senza tuning).
- **App web**: percorsi verificati in Chromium automatizzato (registrazione e codice di recupero, copertina, provini, cerchio, commenti, segnalazioni, ricerca, modifica del profilo, pubblicazione con foto e video e annullamento, profilo, archivio, regole, mezzanotte simulata, schermi piccoli, orizzontale e tablet). Quel Chromium non ha il codec H.264: nei test i video demo si servono come WebM.
- **Funzione `verifica-eta`** (Deno): le rotte `/lavori` (pulizia dei file e invio delle notifiche push a blocchi di 100), `/apri`, `/recupero` e l'azione `modera` (controllo dei contenuti con OpenAI: soglie, fotogrammi dei video, didascalia, OpenAI assente o senza chiave) sono provate con richieste finte (supabase-js locale, senza rete).
- **Sul telefono** vanno provati a mano: un video da 60 s (oltre 48 MB l'app chiede di accorciarlo), notifiche push, link condivisi aperti da WhatsApp, "Password dimenticata?", tastiera su iPhone (vedi PUBBLICARE.md, §6).

## Produzione (milioni di utenti)

La guida completa per andare su App Store e Google Play è in **[PUBBLICARE.md](PUBBLICARE.md)**. In breve:

1. Crea un progetto **Supabase** in UE (piano Pro: con i video il piano gratuito non regge) ed esegui `supabase/schema.sql`, poi `supabase/setup-produzione.sql` (bucket `media`, `documenti` e `avatars`, permessi sui file, chiusura della gara all'orario della copertina, pulizie e lavori ogni minuto con `pg_cron` e `pg_net`).
2. Nel **Vault** i segreti `virale_url` e `virale_cron_secret`; nella funzione `verifica-eta` i segreti `VIRALE_CRON_SECRET` (lo stesso valore), `VIRALE_SITO`, `OPENAI_API_KEY` (controllo automatico dei contenuti prima della pubblicazione, gratuito) e, facoltativo, `EXPO_ACCESS_TOKEN`.
3. **Authentication → Providers**: Email attivo con *Confirm email* spento (si accede con nome utente e password), accessi anonimi spenti.
4. Variabili d'ambiente EAS: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, i dati del titolare `EXPO_PUBLIC_OWNER_*` e, per le notifiche su Android, il file `GOOGLE_SERVICES_JSON` (lo legge `app.config.js`; senza, la build riesce ma Android non riceve notifiche).
5. `eas build` e `eas submit` con i profili di `eas.json`. Gli identificativi sono `app.virale.mobile`.

**Dipendenze native** (servono una build EAS nuova, non bastano gli aggiornamenti OTA): `expo-notifications` ed `expo-clipboard`.

**Video**: non si ricomprimono sul telefono. `react-native-compressor` è stato tolto perché l'APK con quella libreria non si installava su alcuni telefoni Android (e includeva una libreria GPL). `src/services/video.native.ts` controlla il peso prima del caricamento: fino a 48 MB si carica, oltre si chiede di accorciare il video. Su iPhone la conversione a 720p la fa il sistema. Con il piano Pro di Supabase si può alzare il limite del bucket `media` e `MAX_UPLOAD_BYTES`.

Perché regge il carico:
- la copertina è una sola riga uguale per tutti, cacheabile per tutto il giorno;
- i contatori della gara sono divisi su 16 shard, così i post più votati non bloccano una riga;
- i candidati si campionano da un punto casuale di un indice invece di ordinare la tabella;
- le righe per-spettatore si cancellano dopo 7 giorni.

Oltre le decine di milioni di visualizzazioni al giorno: partizionare `arena_views` per giorno, mettere `arena_record_view` dietro una coda e servire i candidati da Redis.

Già pronto per gli store: accettazione di termini ed età minima, verifica dell'età, segnalazione di post, commenti e profili con motivo, blocco degli utenti, coda di moderazione (con notifica push allo staff), eliminazione dell'account dall'app, notifiche push, documenti legali (in app e come pagine web), pagina di atterraggio dei link condivisi, icone, splash, testi delle schede, screenshot. Da aggiungere più avanti: caricamenti riprendibili (TUS) e moderazione automatica di foto e video.

## Struttura

| Percorso | Contenuto |
|---|---|
| `app/` | Le schermate (Expo Router): `(tabs)/` Copertina, Provini, Archivio, Profilo; `scatta`, `commenti/[postId]`, `azioni/[postId]`, `segnala-profilo/[username]`, `cerca`, `modifica-profilo`, `impostazioni`, `notifiche`, `moderazione`, `amministrazione`, `verifica`, `legale/[doc]`, `regole`, `utente/[username]`, `post/[id]`, `scorri/[username]`, `seguaci/[username]`, `copertina/[day]`, `benvenuto` |
| `src/design/` | Token (colori OKLCH convertiti, tipografia, spaziature), motion, font |
| `src/components/` | Cornice media con carosello, video e doppio tocco; segno di matita; striscia del post; icone SVG; scala dei gradini; toast; testata |
| `src/engine/` | Motore della gara in TypeScript puro, test e simulazione |
| `src/services/api.ts` | Dati: Supabase se configurato, altrimenti demo locale |
| `src/services/` | Anche: errori in italiano (`errors.ts`), controllo del peso dei video (`video.native.ts`), notifiche push (`push.native.ts`; sul web `push.ts` non fa nulla) |
| `supabase/functions/verifica-eta/` | Funzione Edge: verifica dell'età con Didit, lavori programmati (pulizia dei file, notifiche push), link condivisi, recupero della password |
| `supabase/` | Schema (rieseguibile), RLS, RPC, configurazione di produzione, test end-to-end |
| `public/index.html` | Pagina web di partenza: lingua italiana e sfondo della rivista durante il caricamento |
| `scripts/` | Pagine legali e sito (`export-legal.ts`: anche `apri.html`), controlli prima del rilascio, screenshot degli store |
| `src/legal/` | Titolare, termini, privacy, linee guida, eliminazione account |
| `store/` | Testi delle schede, note per la revisione, risposte privacy, screenshot e grafica |
| `prototype/` | Sorgente e script di build del prototipo interattivo |
| `assets/demo/` | Foto e video demo ([crediti](assets/demo/CREDITI.md)) |

Se cambi pesi o soglie della gara, aggiornali sia in `src/engine/engine.ts` sia in `supabase/schema.sql`.
