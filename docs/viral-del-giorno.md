# Virale del giorno

Ogni giorno **un solo** piatto pubblicato su Cooklog diventa virale e il giorno dopo lo vede **ogni utente**,
fissato in cima alla Home. Questo documento spiega come funziona TikTok, cosa abbiamo ripreso, cosa abbiamo
cambiato e come si mette in produzione.

## 1. Come funziona TikTok (analisi da fonti pubbliche)

Non abbiamo decompilato l'app TikTok. Il funzionamento è ricostruito da fonti pubbliche: il post ufficiale
"How TikTok recommends videos #ForYou" (2020), il paper ByteDance *Monolith: Real Time Recommendation System*
(2022), il documento interno "TikTok Algo 101" riportato dal New York Times (2021) e le spiegazioni pubblicate
dal TikTok Transparency Center.

| Meccanismo | Cosa fa TikTok | Perché conta per la viralità |
|---|---|---|
| **Feed "For You" basato sui contenuti** | Il feed non dipende da chi segui: ogni video può arrivare a chiunque. | Un nuovo creator parte (quasi) alla pari con uno famoso. |
| **Segnali impliciti** | Il peso maggiore va a tempo di visione, completamento e re-visione, poi condivisioni, commenti, like; lo skip rapido è un segnale negativo. | Si misura ciò che le persone *fanno*, non ciò che dichiarano. |
| **Pool di traffico a livelli** | Un video nuovo viene mostrato a un piccolo gruppo (centinaia di persone). Se le metriche superano una soglia passa a un gruppo più grande, e così via. | La viralità è una sequenza di "esami" superati su pubblici sempre più ampi. |
| **Esplorazione** | Una parte del feed è riservata a contenuti nuovi o fuori dagli interessi abituali. | Senza esplorazione vincerebbero sempre gli stessi. |
| **Moderazione e anti-frode** | Revisione dei contenuti, rimozione di interazioni false, limiti per gli account nuovi. | Senza, la viralità si comprerebbe. |
| **Addestramento in tempo reale** | I modelli si aggiornano in pochi minuti con le nuove interazioni (Monolith). | Il sistema reagisce mentre un video sta esplodendo. |

## 2. Cosa cambia in Cooklog: un solo vincitore al giorno

Su TikTok possono diventare virali migliaia di video al giorno, e chi vince lo decide un modello opaco.
In Cooklog la viralità diventa una **gara giornaliera con regole pubbliche**:

1. **Candidatura (giorno D)**: ogni utente può candidare *un* piatto al giorno all'**Arena**
   (interruttore "Candida al Virale del giorno" quando pubblichi). Le candidature chiudono alle 20:00
   (ora di Roma), così ogni piatto ha qualche ora per essere visto.
2. **Arena = pool di traffico a livelli**: chi apre la tab Arena riceve i piatti in gara scelti **dal
   server**, alla cieca. Non si può cercare il piatto di un amico per votarlo, e non si vede il proprio.
   - Livelli: 50 → 300 → 1.800 → 10.000 viste, poi finale (soglie configurabili).
   - Metà di ogni batch va ai piatti già promossi (pesati per livello), metà all'esplorazione dei nuovi:
     ogni nuovo piatto ha garantito il suo pubblico iniziale, indipendentemente dai follower.
3. **Voti impliciti**: per ogni vista l'app registra tempo di permanenza, like, salvataggio,
   condivisione, segnalazione. I punti per vista sono: completamento (≥ 3 s) +1, like +2,
   **salvataggio +4** (su un'app di ricette è il segnale più forte: "lo voglio cucinare"),
   condivisione +6, skip (< 1,5 s) −1,5, segnalazione −20.
4. **Promozione**: quando un piatto raggiunge la soglia di viste del suo livello viene valutato. Sale
   solo se il suo punteggio è nell'80° percentile dei piatti che hanno completato lo stesso livello
   quel giorno (con meno di 10 piatti in coorte si usa una soglia fissa). Altrimenti viene
   "parcheggiato": resta nel feed normale ma non riceve altro traffico dall'Arena.
5. **Chiusura (mezzanotte)**: vince il piatto al livello più alto; a parità, quello col **limite
   inferiore** del punteggio più alto. Il punteggio è bayesiano (con poche viste resta vicino alla
   media) e il limite inferiore premia chi è bravo su tante viste, non chi è stato fortunato su poche.
6. **Giorno D+1**: il vincitore è il primo contenuto della Home di tutti, con l'etichetta
   "Virale di oggi · scelto tra N piatti".

### Equità e anti-manipolazione

- **Assegnazione cieca**: si può votare solo un piatto che il server ti ha servito, e una volta sola
  (chiave primaria `(entry_id, viewer_id)`).
- **Gli account nuovi guardano ma non votano** (meno di 24 ore di età), così creare account fantoccio
  non serve.
- **Tempo di visione limitato** a 60 s per vista: un client modificato non può gonfiarlo.
- **Squalifica automatica** oltre il 2% di segnalazioni (con almeno 50 viste).
- **Pausa per i vincitori**: chi ha vinto non può ripartecipare per 30 giorni, così la vetrina ruota.
- **Nessun vantaggio dai follower**: l'Arena ignora completamente il grafo sociale.

## 3. Funziona davvero? Verifiche

- **Test del motore** (`npm test`): regole della gara, punteggi, promozioni, squalifiche, pausa del
  vincitore, fuso orario.
- **Simulazione** (`npm run simulate:viral -- 300 5000 30 10`): 300 piatti con qualità reale nascosta,
  5.000 spettatori con reazioni probabilistiche, il 2% di piatti spam "acchiappa-click". Risultato tipico:
  il vincitore è **nel top 5 per qualità reale in tutti i giorni simulati** (qualità ≥ 0,98 su 1) e
  **lo spam non vince mai**, perché viene squalificato dalle segnalazioni.
- **Test SQL end-to-end** su Postgres 16 (vedi sotto): candidatura doppia rifiutata, voto su un piatto non
  servito rifiutato, doppio voto rifiutato, nessun utente vede il proprio piatto, promozione al livello
  finale, vincitore corretto, chiusura idempotente, `anon` non può chiudere la giornata.
- **Carico**: con 20.000 piatti in gara, servire un batch da 10 e registrare 10 viste costa ~19 ms
  su un singolo core (Postgres locale, senza tuning).

## 4. Architettura e scala (milioni di utenti)

```
app (Expo)                    Supabase (Postgres + RPC)
───────────                   ─────────────────────────
Tab Arena ── arena_next_batch ──► campiona i candidati (indice su rand_key) e registra cosa è stato servito
          ── arena_record_view ─► contatori shardati + valutazione del livello (lock solo al cambio di livello)
Pubblica  ── arena_submit ──────► un piatto per utente al giorno
Home      ── get_daily_viral ───► una riga identica per tutti
pg_cron 00:05 UTC ── arena_close_day ──► daily_viral (un vincitore)
```

Scelte che reggono il carico:

- **Il virale è identico per tutti**: è la cosa più economica da servire. `get_daily_viral()` restituisce
  una riga che può essere messa in cache su CDN (o in un'Edge Function con `Cache-Control`) per tutto il
  giorno: milioni di aperture della Home non toccano il database.
- **Contatori shardati** (`arena_entry_stats`, 16 shard per piatto): i finalisti ricevono migliaia di
  viste al secondo e una singola riga sarebbe un collo di bottiglia. Il lock sulla riga del piatto si
  prende solo quando cambia livello.
- **Campionamento O(log n)**: i candidati si pescano da un punto casuale dell'indice
  `(contest_day, status, tier, rand_key)` invece di ordinare tutta la tabella.
- **Pulizia**: le righe per-spettatore (`arena_views`) si cancellano dopo 7 giorni. Oltre qualche
  decina di milioni di viste al giorno conviene partizionare `arena_views` per `contest_day` e fare
  `DROP PARTITION` invece di `DELETE`.
- Per la scala successiva (decine di milioni di utenti attivi): spostare `arena_record_view` su una coda
  (es. Supabase Queues/pgmq o Kafka) con aggregazione a micro-batch, e servire i batch da una cache
  (Redis) dei candidati per livello. Le regole del gioco non cambiano.

## 5. Messa in produzione

1. Esegui nel SQL Editor di Supabase `docs/supabase-schema.sql` e poi `docs/supabase-viral-of-the-day.sql`.
2. Abilita l'estensione **pg_cron** e programma la chiusura (il comando è in fondo al file SQL):
   `select cron.schedule('arena-close-day', '5 0 * * *', $$ select public.arena_close_day(public.arena_today() - 1) $$);`
3. Imposta `EXPO_PUBLIC_SUPABASE_URL` e `EXPO_PUBLIC_SUPABASE_ANON_KEY` nell'app.
4. Pubblica sugli store con EAS: `npx eas build --platform all` e `npx eas submit`. Prima imposta in
   `app.json` nome, `slug`, `ios.bundleIdentifier` e `android.package` definitivi (oggi l'app si chiama
   ancora "mobile").
5. Consigliato prima del lancio: notifica push giornaliera "Il virale di oggi è…" (expo-notifications +
   un'Edge Function che invia in blocchi da 100 tramite l'API push di Expo), moderazione umana dei
   finalisti prima della chiusura, e una pagina con le regole della gara.

Senza Supabase configurato l'app gira in **modalità demo**: l'Arena vive sul dispositivo con un pubblico
simulato, al primo avvio c'è già un "virale di oggi" e il pulsante "Chiudi giornata (demo)" chiude la gara
subito, così puoi vedere il ciclo completo.

### Testare lo SQL su un Postgres locale

```bash
createdb arena_test
psql -d arena_test -v ON_ERROR_STOP=1 \
  -f docs/sql-tests/auth-stub.sql \
  -f docs/supabase-schema.sql \
  -f docs/supabase-viral-of-the-day.sql \
  -f docs/sql-tests/viral-of-the-day.e2e.sql
```

## 6. Mappa del codice

| File | Ruolo |
|---|---|
| `src/viral/engine.ts` | Motore puro: punteggi, livelli, selezione dei batch, chiusura. Usato da app, test e simulazione. |
| `src/viral/engine.test.ts` | Test (`npm test`). |
| `src/viral/simulation.ts`, `scripts/simulate-viral-day.ts` | Simulazione con pubblico sintetico (`npm run simulate:viral`). |
| `docs/supabase-viral-of-the-day.sql` | Tabelle, RLS e RPC di produzione (stessa logica del motore). |
| `src/services/viralService.ts` | Client: Supabase se configurato, altrimenti Arena locale demo. |
| `src/screens/ArenaScreen.tsx`, `src/components/ArenaEntryCard.tsx` | Tab Arena: piatti a schermo intero, misura del tempo di visione, interazioni. |
| `src/screens/FeedScreen.tsx` | Fissa il virale di oggi in cima alla Home. |
| `src/screens/AddPostScreen.tsx` | Interruttore "Candida al Virale del giorno". |

Se cambi pesi o soglie, aggiornali sia in `engine.ts` (`DEFAULT_ARENA_CONFIG`, `SIGNAL_POINTS`) sia in
`arena_config` / `arena_points` nello SQL.
