# Virale

**Funziona come TikTok: si pubblicano foto e video e si scorrono in verticale. In più, ogni giorno un solo post diventa la Copertina, e il giorno dopo lo vede chiunque apra l'app.**

App mobile multipiattaforma (iOS, Android e web dallo stesso codice) in Expo SDK 54 / React Native, con Expo Router.

- **Prototipo interattivo** (18 passaggi, stile Figma): `python3 prototype/build.py` → `prototype/dist/virale-prototipo.html`.
- **App cliccabile in una sola pagina** (l'app vera in modalità demo, con cornice da telefono): `npx expo export --platform web --output-dir /tmp/virale-web && python3 scripts/make-anteprima.py /tmp/virale-web anteprima.html`.
- **Linguaggio visivo**: [DESIGN.md](DESIGN.md).

## Cosa fa

| Schermata | Cosa succede |
|---|---|
| **Copertina** | Il post vincitore di ieri a tutta pagina, con testata, numero dell'uscita e data. È identico per tutti. Alla prima apertura del giorno la foto "si sviluppa" da sfocata a nitida. In basso il conto alla rovescia per la prossima copertina. |
| **Provini** | Il feed verticale. "Per te" mostra i post in gara oggi, scelti dal server alla cieca; "Seguiti" mostra le persone che segui. Doppio tocco = cerchia (mi piace), poi commenti, salva, condividi, segui. Caroselli di foto e video, con audio a richiesta. |
| **Pubblica** (pulsante giallo) | Da 1 a 10 foto e/o video dalla galleria o dalla fotocamera. Si possono riordinare e togliere, si scrive la didascalia e si sceglie se candidarsi per la copertina di domani (uno al giorno). |
| **Archivio** | Tutte le copertine uscite, con il loro numero. |
| **Profilo** | Follower, seguiti, copertine vinte; il tuo post in gara oggi con i cinque gradini; i tuoi post e i salvati. |
| **Commenti / Regole** | Fogli nativi (form sheet) che si aprono a metà schermo. |

## Come si sceglie la copertina

1. Ogni post candidato parte da un piccolo pubblico: **Provino**, 50 viste.
2. Al raggiungimento della soglia viene valutato. Sale solo se batte l'80% dei post che hanno completato lo stesso gradino quel giorno: **Bozza** (300) → **Impaginato** (1.800) → **In macchina** (10.000) → **Finale**.
3. Il voto è il modo in cui si guarda. Punti per vista:

   | Gesto | Punti |
   |---|---|
   | Visto fino in fondo | +1 |
   | Riguardato | +1,5 |
   | Cerchiato (mi piace) | +2 |
   | Commentato | +3 |
   | Salvato | +3 |
   | Condiviso | +6 |
   | Scorso via subito | −1,5 |
   | Segnalato | −20 |

   Il punteggio parte da una media di prudenza di 20 viste, così pochi spettatori fortunati non bastano.
4. A mezzanotte (Europe/Rome) vince chi è salito più in alto; a parità, il limite inferiore del punteggio più alto.
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
- il link "Demo: simula la mezzanotte" sotto la copertina chiude subito la gara.

## Verifiche

```bash
npm test            # 17 test del motore della gara
npm run simulate    # simulazione con migliaia di spettatori
npm run typecheck
npm run lint
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
  - `anon` non può chiudere la giornata.

  ```bash
  createdb virale_test
  psql -d virale_test -v ON_ERROR_STOP=1 -f supabase/tests/auth-stub.sql -f supabase/schema.sql -f supabase/tests/e2e.sql
  ```
- **Carico**: con 20.000 post in gara, servire 10 Provini (già composti in JSON) e registrare 10 voti richiede circa 20 ms su un core (Postgres 16 locale, senza tuning).
- **App web**: percorso completo verificato in Chromium automatizzato (benvenuto, copertina, provini, cerchia, commenti, seguiti, pubblicazione con foto e video, profilo, archivio, regole, mezzanotte simulata). Quel Chromium non ha il codec H.264, quindi lì i video demo non partono; su iOS, Android, Chrome e Safari sì. Su un telefono vero l'app non è ancora stata provata.

## Produzione (milioni di utenti)

La guida completa per andare su App Store e Google Play è in **[PUBBLICARE.md](PUBBLICARE.md)**. In breve:

1. Crea un progetto **Supabase** in UE ed esegui `supabase/schema.sql`, poi `supabase/setup-produzione.sql` (bucket `media`, permessi sui file, chiusura a mezzanotte con `pg_cron`).
2. **Authentication → Providers**: Email attivo con *Confirm email* spento (si accede con nome utente e password), accessi anonimi spenti.
3. Metti `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_ANON_KEY` nelle variabili d'ambiente EAS (o in `virale/.env.local` per lo sviluppo).
4. `eas build` e `eas submit` con i profili di `eas.json`. Gli identificativi sono `app.virale.mobile`.

Perché regge il carico:
- la copertina è una sola riga uguale per tutti, cacheabile per tutto il giorno;
- i contatori della gara sono divisi su 16 shard, così i post più votati non bloccano una riga;
- i candidati si campionano da un punto casuale di un indice invece di ordinare la tabella;
- le righe per-spettatore si cancellano dopo 7 giorni.

Oltre le decine di milioni di viste al giorno: partizionare `arena_views` per giorno, mettere `arena_record_view` dietro una coda e servire i candidati da Redis.

Già pronto per gli store: accettazione di termini ed età minima, segnalazione dei post con motivo, blocco degli utenti, coda di moderazione, eliminazione dell'account dall'app, documenti legali (in app e come pagine web), icone, splash, testi delle schede, screenshot. Da aggiungere più avanti: moderazione automatica di foto e video e notifiche push.

## Struttura

| Percorso | Contenuto |
|---|---|
| `app/` | Le schermate (Expo Router): `(tabs)/` Copertina, Provini, Archivio, Profilo; `scatta`, `commenti/[postId]`, `azioni/[postId]`, `impostazioni`, `moderazione`, `legale/[doc]`, `regole`, `utente/[username]`, `post/[id]`, `copertina/[day]`, `benvenuto` |
| `src/design/` | Token (colori OKLCH convertiti, tipografia, spaziature), motion, font |
| `src/components/` | Cornice media con carosello, video e doppio tocco; segno di matita; striscia del post; icone SVG; scala dei gradini; toast; testata |
| `src/engine/` | Motore della gara in TypeScript puro, test e simulazione |
| `src/services/api.ts` | Dati: Supabase se configurato, altrimenti demo locale |
| `supabase/` | Schema, RLS, RPC, configurazione di produzione, test end-to-end |
| `src/legal/` | Titolare, termini, privacy, linee guida, eliminazione account |
| `store/` | Testi delle schede, note per la revisione, risposte privacy, screenshot e grafica |
| `prototype/` | Sorgente e script di build del prototipo interattivo |
| `assets/demo/` | Foto e video demo ([crediti](assets/demo/CREDITI.md)) |

Se cambi pesi o soglie della gara, aggiornali sia in `src/engine/engine.ts` sia in `supabase/schema.sql`.
