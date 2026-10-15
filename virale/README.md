# 🔥 Virale

**Ogni giorno un solo utente diventa virale, e il giorno dopo lo vede chiunque apra l’app.**

App mobile multipiattaforma (iOS, Android e web da un unico codice) in Expo / React Native.
Chiunque pubblica video, foto o testi; i contenuti si sfidano tutto il giorno nell’**Arena**,
e a mezzanotte ne vince uno solo.

## Come funziona TikTok (e cosa abbiamo ripreso)

Analisi basata su fonti pubbliche (nessuna decompilazione dell’app): il post ufficiale
“How TikTok recommends videos #ForYou” (2020), il paper ByteDance *Monolith* (2022), il documento
interno “TikTok Algo 101” riportato dal New York Times (2021) e il TikTok Transparency Center.

| Meccanismo di TikTok | Come lo usa Virale |
|---|---|
| Il feed “Per te” non dipende dai follower: ogni video può arrivare a chiunque | L’Arena ignora completamente i follower: tutti partono alla pari |
| Contano i segnali impliciti: completamento, ri-visione, condivisioni, like; lo skip è negativo | Stessi segnali, con pesi pubblici: completamento +1, ri-visione +1,5, like +2, condivisione +6, skip −1,5, segnalazione −20 |
| Pool di traffico a livelli: un video nuovo va a poche centinaia di persone, poi sale se le metriche reggono | Livelli 50 → 300 → 1.800 → 10.000 viste, poi la finale. Sale solo chi supera l’80° percentile del proprio livello |
| Esplorazione: una quota del feed va ai contenuti nuovi | Metà di ogni batch dell’Arena è riservata ai contenuti appena entrati in gara |
| Moderazione e anti-frode | Assegnazione alla cieca, un voto per contenuto, account nuovi senza voto, squalifica per segnalazioni |

**La differenza:** su TikTok diventano virali migliaia di contenuti al giorno e decide un modello
opaco. Qui c’è **un vincitore al giorno**, con regole uguali per tutti, e la sua ricompensa è
garantita: il giorno dopo è la prima cosa che vede ogni utente.

## Il ciclo di un giorno

1. **Pubblica**: video (max 60 s), foto o testo. Con l’interruttore “Candida al Virale di domani”
   entra in gara: **uno al giorno per utente**, candidature fino alle 20:00 (ora di Roma).
2. **Arena** (il feed): il server sceglie cosa mostrare a ciascuno, alla cieca. Non si può cercare
   il contenuto di un amico per votarlo, e non si vede mai il proprio. **Il voto è come guardi**:
   tempo di visione, video visto fino in fondo, ri-visioni, like, condivisioni, segnalazioni.
3. **Livelli**: raggiunta la soglia di viste del proprio livello, un contenuto viene valutato. Se è
   nel 20% migliore di chi ha completato lo stesso livello quel giorno sale e riceve un pubblico più
   grande; altrimenti si ferma. Il creator vede la sua barra di avanzamento in tempo reale.
4. **Mezzanotte**: vince chi è arrivato al livello più alto; a parità, chi ha il **limite inferiore**
   del punteggio più alto. Il punteggio è bayesiano: la fortuna su pochi spettatori non basta.
5. **Il giorno dopo**: la tab **Oggi** mostra a tutti il vincitore; resta per sempre
   nell’**Albo d’oro**.

**Anti-trucchi:** un voto per contenuto per persona; si vota solo ciò che il server ti ha mostrato;
gli account con meno di 24 ore guardano ma non votano; tempo di visione dichiarato limitato a 60 s;
squalifica oltre il 2% di segnalazioni; chi vince non può ripartecipare per 30 giorni (così la
vetrina ruota).

## Avvio

```bash
cd virale
npm install
npx expo start          # poi: i = iOS, a = Android, w = web, oppure scansiona il QR con Expo Go
```

Senza configurazione l’app parte in **modalità demo**: la gara gira sul dispositivo con un pubblico
simulato e creator fittizi, al primo avvio c’è già un “virale di oggi”, durante l’uso il pubblico
continua a guardare (anche il tuo contenuto sale di livello dal vivo), e il pulsante
“Chiudi la giornata (demo)” chiude subito la gara e incorona il vincitore.

## Verifiche

```bash
npm test             # test del motore (16 test)
npm run simulate     # simulazione: N contenuti con qualità nascosta e migliaia di spettatori
npm run typecheck
npm run lint
```

- **Simulazione** (`npm run simulate -- 300 5000 30 10`): con 300 contenuti, 5.000 spettatori e il 2%
  di spam “acchiappa-click”, il vincitore è **sempre nel top 5 per qualità reale** e **lo spam non
  vince mai** (viene squalificato dalle segnalazioni).
- **Database**: `supabase/tests/e2e.sql` verifica su Postgres 16 le regole della gara (candidatura
  doppia o altrui rifiutata, voto su contenuto non servito rifiutato, doppio voto rifiutato, nessuno
  vede il proprio contenuto, promozione, vincitore corretto, chiusura idempotente, `anon` non può
  chiudere la giornata). Un client non può scrivere direttamente nelle tabelle della gara (RLS).

```bash
createdb virale_test
psql -d virale_test -v ON_ERROR_STOP=1 -f supabase/tests/auth-stub.sql -f supabase/schema.sql -f supabase/tests/e2e.sql
```

## Produzione (milioni di utenti)

1. Crea un progetto **Supabase**. Nel SQL Editor esegui `supabase/schema.sql`.
2. **Authentication → Providers**: abilita gli accessi anonimi (l’onboarding chiede solo uno username;
   puoi aggiungere email/Apple/Google in seguito).
3. **Storage**: crea il bucket pubblico `media` con le policy in fondo allo schema.
4. **Database → Extensions**: abilita `pg_cron` e programma la chiusura giornaliera:
   `select cron.schedule('arena-close-day', '5 0 * * *', $$ select public.arena_close_day(public.arena_today() - 1) $$);`
5. Crea `virale/.env.local` con `EXPO_PUBLIC_SUPABASE_URL=…` e `EXPO_PUBLIC_SUPABASE_ANON_KEY=…`.
6. Store: `npx eas build --platform all` e `npx eas submit` (servono gli account Apple Developer e
   Google Play). Gli identificativi sono `app.virale.mobile` in `app.json`: cambiali se vuoi un
   dominio tuo.

Perché regge il carico:

- **Il virale è uguale per tutti**: `get_daily_viral()` restituisce una sola riga, cacheabile su CDN
  per tutta la giornata. Milioni di aperture della tab Oggi non toccano il database.
- **Contatori shardati**: ogni vista incrementa uno di 16 shard del contenuto, così i finalisti con
  migliaia di viste al secondo non bloccano una riga. Il lock si prende solo al cambio di livello.
- **Campionamento O(log n)** dei candidati da un punto casuale di un indice, invece di ordinare la
  tabella. Misurato in locale: con 20.000 contenuti in gara, servire 10 contenuti e registrare 10 viste
  costa ~8 ms su un core (Postgres 16 locale, senza tuning).
- Le righe per-spettatore si cancellano dopo 7 giorni. Oltre le decine di milioni di viste al giorno:
  partizionare `arena_views` per giorno, mettere `arena_record_view` dietro una coda con aggregazione
  a micro-batch e servire i candidati da Redis. Le regole non cambiano.

Prima del lancio pubblico servono comunque: moderazione (umana o automatica) di video e foto e
controllo dei finalisti prima della mezzanotte, notifica push giornaliera (“Il virale di oggi è…”),
privacy policy, termini d’uso e segnalazione/blocco utenti come richiesto da App Store e Google Play.

## Struttura

| Percorso | Contenuto |
|---|---|
| `App.tsx` | Navigazione a tab, onboarding, festeggiamento del vincitore |
| `src/engine/engine.ts` | Motore della gara (puro TypeScript): punteggi, livelli, batch, chiusura |
| `src/engine/engine.test.ts`, `src/engine/simulation.ts`, `scripts/simulate.ts` | Test e simulazione |
| `src/services/api.ts` | Dati: Supabase se configurato, altrimenti demo locale |
| `src/screens/` | Oggi, Arena, Pubblica, Profilo, Onboarding, Regole |
| `src/components/PostView.tsx` | Contenuto a tutto schermo (video con misura di completamento e ri-visioni, foto, testo) |
| `supabase/schema.sql` | Tabelle, RLS, funzioni RPC, cron (stessa logica del motore) |

Se cambi pesi o soglie, aggiornali sia in `src/engine/engine.ts` sia in `supabase/schema.sql`.
