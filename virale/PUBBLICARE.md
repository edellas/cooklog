# Pubblicare Virale su App Store e Google Play

Guida passo passo. Tutto quello che si poteva preparare nel codice è già fatto:
segnalazione e blocco, moderazione, eliminazione account, accettazione dei termini, testi legali,
icone, splash, configurazione di build, testi delle schede, screenshot e grafica.
Quello che resta richiede **i tuoi account, i tuoi dati e i tuoi pagamenti**.

Non serve un Mac: le build iOS si fanno nel cloud con EAS (Expo).

| Cosa | Costo |
|---|---|
| Apple Developer Program | 99 USD l'anno |
| Google Play Console | 25 USD una volta |
| Supabase (database e file) | **Pro, 25 USD/mese** (con i video il piano gratuito non regge: 1 GB di file, niente backup, pausa se inattivo) |
| Expo EAS (build nel cloud) | gratis con code d'attesa, o piani a pagamento |

Tempi realistici: 1 giorno di configurazione, 1–3 giorni per la revisione Apple;
su Google, se il tuo account sviluppatore è personale e nuovo, **almeno 14 giorni di test chiuso** prima di poter pubblicare.

Alla fine di ogni passo puoi lanciare `npm run check:release` (dalla cartella `virale/`):
ti dice cosa manca ancora.

---

## 0. Hai già Virale su Supabase? Aggiorna così (in quest'ordine)

Questa versione aggiunge l'accesso con Google e Facebook (l'unico modo di entrare), foto profilo, ricerca, segnalazione
di commenti e profili, notifiche push, pulizia automatica dei file e pagina per i link condivisi. Si fa tutto dal browser
(anche del telefono): supabase.com, expo.dev, GitHub, Firebase.

**Si entra solo con Google o Facebook (nuovo).** Chi usa Virale entra con "Continua con Google" o "Continua con
Facebook"; al primo accesso completa il profilo (nome utente, nome, cognome, data di nascita, termini), poi tutto
come prima, verifica dell'età compresa. L'accesso con nome utente e password, il cambio della password e il codice
di recupero non esistono più: gli account creati in quel modo vanno cancellati (l'app riparte da zero). Nell'app non
ci sono chiavi: l'accesso passa dal browser e da Supabase. Serve una **build nuova** (passo 9) e va **rieseguito
`supabase/schema.sql`** (passo 2): crea la funzione che completa il profilo e i controlli sull'email di accesso, e
toglie le funzioni della password e del codice di recupero (con le relative colonne).
**Supabase → Authentication → Sign In / Providers → Email**: **disattivalo** (non serve più: nessuno entra con
email e password), e lascia spenti anche gli accessi anonimi. Restano attivi solo Google e Facebook.
Finché un provider non è acceso, il suo
pulsante risponde "L'accesso con … non è ancora attivo". Si fa tutto dal browser, anche del telefono (per Google
Cloud e Meta conviene la "versione desktop" del sito). Al posto di `<progetto>` metti il codice del tuo progetto
Supabase (quello di `https://<progetto>.supabase.co`, in Project Settings → API).

A. **Supabase → Authentication → URL Configuration**:
   - **Site URL**: l'indirizzo del sito, `https://edellas.github.io/cooklog`;
   - **Redirect URLs** → *Add URL*: `virale://auth` (è dove torna l'app dopo l'accesso; scritto esattamente così).
     Se un giorno pubblichi anche la versione web dell'app, aggiungi pure il suo indirizzo (per esempio `https://app.tuosito.it`).

B. **Google** (gratis) — su <https://console.cloud.google.com>:
   1. In alto, menu dei progetti → **Nuovo progetto** → nome `Virale` → Crea, e selezionalo.
   2. Menu ☰ → **API e servizi** → **Schermata consenso OAuth** (oggi si chiama *Google Auth Platform*) → **Inizia**:
      nome app `Virale`, email di assistenza (la tua), pubblico **Esterno**, email di contatto, accetta e crea.
   3. **Branding**: home page `https://edellas.github.io/cooklog`, privacy `https://edellas.github.io/cooklog/privacy.html`,
      termini `https://edellas.github.io/cooklog/termini.html`; domini autorizzati `edellas.github.io` e `supabase.co`.
      **Non caricare il logo**: con il logo Google chiede una verifica che dura settimane; senza, con i soli dati di
      base, non serve.
   4. **Accesso ai dati** (*Data access*): bastano `openid`, `.../auth/userinfo.email` e `.../auth/userinfo.profile`
      (sono quelli di base, non "sensibili": nessuna verifica). Salva.
   5. **Client** → **Crea client** → tipo **Applicazione web** (*Web application*), nome `Virale Supabase`.
      In **URI di reindirizzamento autorizzati** aggiungi `https://<progetto>.supabase.co/auth/v1/callback`
      (lo trovi già scritto, da copiare, in Supabase → Authentication → Sign In / Providers → Google → *Callback URL*).
      Crea e copia **ID client** e **Client secret**.
      Non servono client "Android" o "iOS": quelli servono solo all'accesso nativo con l'SDK di Google, che l'app non
      usa (l'accesso passa dal browser e Google parla solo con Supabase).
   6. **Pubblico** (*Audience*) → **Pubblica app** → stato **In produzione**. Finché resta "Test" entrano solo gli
      indirizzi aggiunti come utenti di prova (massimo 100).
   7. **Supabase → Authentication → Sign In / Providers → Google**: attivalo, incolla **Client ID** e **Client Secret**, Save.

C. **Facebook** (gratis) — su <https://developers.facebook.com> (accedi con Facebook; la prima volta conferma
   l'account sviluppatore con il numero di telefono):
   1. **Le mie app** → **Crea app** → caso d'uso **"Autenticare e richiedere dati agli utenti con Facebook Login"**
      (nelle versioni vecchie della procedura: tipo **Consumatore**), nome `Virale`, email di contatto → Crea.
   2. **Casi d'uso → Facebook Login → Personalizza → Autorizzazioni**: aggiungi **email** (`public_profile` c'è già).
      Bastano queste due: non serve la revisione dell'app (App Review).
   3. **Facebook Login → Impostazioni**: *Login OAuth client* e *Login OAuth web* attivi; in **URI di reindirizzamento
      OAuth validi** metti `https://<progetto>.supabase.co/auth/v1/callback`. Salva.
   4. **Impostazioni app → Di base**: URL della privacy `https://edellas.github.io/cooklog/privacy.html`, URL dei
      termini `https://edellas.github.io/cooklog/termini.html`, **eliminazione dei dati** → "URL delle istruzioni per
      l'eliminazione dei dati" `https://edellas.github.io/cooklog/eliminazione-account.html`, icona 1024×1024
      (`assets/icon.png`), categoria. Salva e copia **ID app** e **Chiave segreta** (Mostra).
   5. In alto: **Modalità app → Live** (pubblica). In "Sviluppo" entrano solo gli account con un ruolo nell'app.
      Se Meta lo chiede, completa la **verifica dell'azienda** o dello sviluppatore individuale.
   6. **Supabase → Authentication → Sign In / Providers → Facebook**: attivalo, incolla **Facebook client ID** (ID app)
      e **Facebook secret** (chiave segreta), Save. Se c'è l'opzione **"Allow users without an email"**, attivala: così
      entra anche chi ha Facebook registrato solo con il numero di telefono (senza, l'app gli spiega di aggiungere
      un'email a Facebook o di usare Google).

D. **Controllo** (con la build nuova, non con Expo Go): "Continua con Google" → scegli l'account → torni nell'app su
   **Completa il profilo** → "Entra in Virale". Poi Impostazioni → Esci → di nuovo "Continua con Google": entri
   direttamente. Prova anche Facebook e "Annulla ed esci" su Completa il profilo. Su Supabase → Authentication → Users trovi i nuovi utenti con il provider.

Da sapere:
- **Instagram**: un "Accedi con Instagram" per le persone comuni non esiste più. Meta ha chiuso la Instagram Basic
  Display API il 4 dicembre 2024; l'accesso con Instagram che resta è solo per account business e creator. Chi
  usa Instagram ha un account Meta e può usare "Continua con Facebook".
- **iPhone**: le regole dell'App Store (linea guida 4.8, *Login Services*) chiedono che un'app con accesso tramite
  Google o Facebook offra anche un accesso equivalente che rispetti la privacy: in pratica **"Accedi con Apple"**.
  Non c'è ancora: va aggiunto (Supabase lo supporta) **prima di inviare l'app ad Apple**. Su Android non serve.
- Nella schermata di Google compare "procedi su `<progetto>.supabase.co`": è normale. Per mostrare un tuo dominio
  serve il *Custom Domain* di Supabase (a pagamento), facoltativo.
- Chi inizia con Google/Facebook e non completa il profilo viene cancellato dopo 7 giorni dalla pulizia notturna
  (subito se tocca "Annulla ed esci").

**Controllo automatico dei contenuti (OpenAI) — fallo per primo, in quest'ordine.** Prima di pubblicare, foto,
fotogrammi dei video, didascalie e foto profilo passano dal servizio di moderazione di OpenAI (modello
`omni-moderation-latest`, **gratuito**: non consuma credito). Lo chiama solo la funzione `verifica-eta`: nell'app
non c'è nessuna chiave.

1. Su <https://platform.openai.com> (accedi o crea l'account) → **API keys** → **Create new secret key**: nome
   "Virale", progetto di default. Se scegli permessi limitati ("Restricted"), basta l'accesso a **Moderations**.
   Copia la chiave (`sk-…`): si vede una volta sola.
2. **Supabase → Edge Functions → Secrets** → aggiungi `OPENAI_API_KEY` con quella chiave.
3. **Supabase → Edge Functions → `verifica-eta`**: incolla di nuovo tutto `supabase/functions/verifica-eta/index.ts`
   e ripubblica ("Verify JWT" resta **spento**). Va fatto **prima** dello schema: con lo schema nuovo il database
   accetta solo post controllati dalla funzione nuova.
4. **Supabase → SQL Editor**: riesegui `supabase/schema.sql` (crea la tabella `media_checks` e le regole; non perde dati).
5. Controllo: apri `https://<il-tuo-progetto>.supabase.co/functions/v1/verifica-eta/stato` → `controllo_contenuti`
   deve dire "attivo (OpenAI accetta la chiave)". Poi pubblica dall'app un post di prova: deve uscire subito
   (se dice "in revisione", la chiave non va: guarda Edge Functions → `verifica-eta` → Logs).

Senza la chiave (o se OpenAI non risponde) nessun post esce senza controllo: va **in revisione**, nascosto, e compare
in cima a Impostazioni → Moderazione (scheda Post) con **Approva** / **Rimuovi**; le foto profilo nuove non si
possono salvare. Regole e soglie sono all'inizio della sezione "Controllo automatico" in `index.ts`.

1. **Supabase → piano Pro** (Organization → Billing). Valuta lo "Spend cap".
2. **Supabase → SQL Editor**:
   1. incolla ed esegui il nuovo `supabase/schema.sql` (aggiorna senza perdere dati; si può rieseguire);
   2. incolla ed esegui il nuovo `supabase/setup-produzione.sql` (crea il bucket `avatars` e i lavori ogni minuto);
   3. esegui, mettendo i tuoi valori (la stringa segreta inventala lunga almeno 32 caratteri, per esempio con un generatore di password):
      ```sql
      select vault.create_secret('https://<il-tuo-progetto>.supabase.co', 'virale_url');
      select vault.create_secret('<stringa segreta lunga>', 'virale_cron_secret');
      ```
   4. controllo: `select jobname, schedule from cron.job;` deve mostrare `arena-close-day`, `virale-pulizia` e `virale-lavori`.
3. **Supabase → Edge Functions → `verifica-eta`**: incolla di nuovo tutto `supabase/functions/verifica-eta/index.ts`
   e ripubblica ("Verify JWT" resta **spento**). In **Secrets** aggiungi:
   - `VIRALE_CRON_SECRET`: la stessa stringa segreta del punto 2;
   - `VIRALE_SITO`: l'indirizzo del sito, per esempio `https://edellas.github.io/cooklog` (senza barra finale);
   - facoltativo `EXPO_ACCESS_TOKEN` (expo.dev → Account settings → Access tokens), poi su expo.dev → progetto
     attiva "Enhanced security for push notifications".

   Controllo: Edge Functions → `verifica-eta` → **Logs**: ogni minuto una chiamata a `/lavori` con stato 200.
4. **Supabase → Authentication → Sign In / Providers**: **Email spento** (non serve più: si entra solo con Google o
   Facebook), accessi anonimi spenti, Google e Facebook attivi (punto 0, B e C).
5. **expo.dev → progetto → Environment variables** (ambienti preview e production, Plain text): i dati del titolare
   (passo 2), `EXPO_PUBLIC_APPSTORE_URL` appena esiste la scheda App Store, e le chiavi di Supabase (passo 5).
   **Senza i dati del titolare la build di produzione si apre su "Configurazione mancante"**: è voluto.
6. **GitHub → repository → Settings → Secrets and variables → Actions → Variables**: crea le stesse
   `EXPO_PUBLIC_OWNER_*` e `EXPO_PUBLIC_APPSTORE_URL`. Poi fai il **merge di questo branch in `master`** (il ramo
   predefinito del repository: GitHub esegue e mostra il lavoro "Virale · pagine legali" solo se il file
   `.github/workflows/virale-pagine-legali.yml` è lì), attiva **Settings → Pages → Source: GitHub Actions** e infine
   **Actions → "Virale · pagine legali" → Run workflow**. Da allora il sito si ripubblica da solo a ogni modifica
   dei testi legali su `master`.
   Controllo: `…/privacy.html` mostra i tuoi dati e `…/apri.html?p=00000000-0000-0000-0000-000000000000`
   mostra la pagina di Virale.
7. **Notifiche push su Android (Firebase)**:
   1. su <https://console.firebase.google.com> crea un progetto e aggiungi un'app Android con pacchetto `app.virale.mobile`;
   2. scarica `google-services.json`;
   3. su expo.dev → Environment variables crea una variabile di tipo **File** chiamata `GOOGLE_SERVICES_JSON`
      (ambienti preview e production) caricando quel file;
   4. su Firebase → Impostazioni progetto → Account di servizio → "Genera nuova chiave privata" (un file JSON);
   5. su expo.dev → progetto → Credentials → Android → `app.virale.mobile` → "FCM V1 service account key" → carica quel JSON.

   Senza questi passi l'app funziona lo stesso, ma su Android non arrivano notifiche (le Impostazioni lo dicono).
8. **Notifiche push su iPhone**: alla prima `eas build --platform ios --profile production` accetta quando EAS
   propone di creare la chiave per le notifiche push (Apple Push Notifications key).
9. **Build nuova** (servono le dipendenze native nuove: notifiche e appunti):
   `eas build --platform android --profile preview` (anche dal sito expo.dev). Sul telefono prova:
   un video da 60 secondi, la notifica "nuovo follower" con un secondo account, un link condiviso aperto da
   WhatsApp, "Continua con Google" e "Continua con Facebook" (punto D sopra), uscita e rientro con lo stesso
   account, la tastiera su iPhone mentre scrivi la didascalia.
10. **Testi legali**: l'informativa privacy cambia (accesso solo con Google e Facebook, niente più password, foto profilo, ricerca, token delle notifiche):
    falla rileggere all'avvocato.
11. **Schede degli store**: aggiorna le risposte privacy secondo `store/privacy-store.md` e carica i nuovi screenshot.
12. **Moderazione ogni giorno**: Impostazioni → Segnalazioni da rivedere, **entrambe** le schede (Post; Commenti e
    profili), entro 24 ore. In cima alla scheda Post ci sono i post messi in revisione dal controllo automatico:
    restano nascosti (e fuori dalla gara) finché non tocchi **Approva** o **Rimuovi**. Le notifiche push allo staff ti avvisano (al massimo una all'ora).
13. **Nome utente ufficiale**: i nomi che cominciano con `virale` sono riservati. Per avere `@virale`, registrati con
    un altro nome e rinomina dal SQL Editor:
    ```sql
    update public.profiles set username = 'virale' where username = 'il_tuo_nome';
    ```

## 1. Crea gli account (oggi, perché le verifiche richiedono giorni)

1. **Apple Developer Program** — <https://developer.apple.com/programs/enroll/>
   - Come *persona fisica*: nome e cognome compaiono come venditore nello store.
   - Come *azienda*: serve il numero D-U-N-S (gratuito, ma arriva in 1–2 settimane).
2. **Google Play Console** — <https://play.google.com/console/signup>
   - Ti chiederanno documento d'identità e, per le aziende, il D-U-N-S.
   - Se scegli *account personale*, prima della pubblicazione dovrai fare il test chiuso con 12 persone per 14 giorni (passo 9).
3. **Expo** — <https://expo.dev/signup> (gratis).
4. **Supabase** — <https://supabase.com/dashboard> (gratis).
5. **Google Cloud** — <https://console.cloud.google.com> e **Meta for Developers** — <https://developers.facebook.com>
   (gratis), per "Continua con Google" e "Continua con Facebook" (sezione 0, punti B e C).

Sia Apple sia Google ti chiederanno se sei un **"operatore commerciale" (trader)** ai sensi del
Digital Services Act. Se l'app non ti fa guadagnare (niente pubblicità, niente vendite) puoi
dichiarare di non esserlo; se pensi di guadagnarci, dichiaralo: il tuo indirizzo, telefono ed email
saranno visibili nella scheda. Nel dubbio chiedi al commercialista.

## 2. Inserisci i tuoi dati nei documenti legali

Il repository è pubblico: **i tuoi dati non vanno scritti nel codice**. Si mettono nelle variabili
d'ambiente di Expo, che finiscono solo nell'app compilata (dove la legge vuole che si vedano).

Su **expo.dev → il progetto → Environment variables → Add variable**, per gli ambienti
**preview** e **production**, visibilità **Plain text**:

| Nome | Esempio |
|---|---|
| `EXPO_PUBLIC_OWNER_NAME` | Mario Rossi (o la ragione sociale) |
| `EXPO_PUBLIC_OWNER_ADDRESS` | Via Roma 1, 20100 Milano (MI) |
| `EXPO_PUBLIC_OWNER_TAX_ID` | codice fiscale o partita IVA |
| `EXPO_PUBLIC_OWNER_EMAIL` | una casella che leggi OGNI giorno |
| `EXPO_PUBLIC_OWNER_WEBSITE` | https://tuonome.github.io/cooklog (lo scopri al passo 4) |

Sul computer, per le prove, gli stessi valori vanno in `.env.local` (non finisce su git).

I testi (Termini, Privacy, Linee guida, Eliminazione account) sono completi e coerenti con
quello che l'app fa davvero, ma **falli leggere a un avvocato** prima del lancio: è un social con
contenuti degli utenti, aperto dai 14 anni.

## 3. Prepara Supabase (database, file, chiusura della gara)

1. **New project** → regione **Central EU (Frankfurt)** (i dati restano in UE, come dice l'informativa).
   Scegli una password del database lunga e salvala.
2. **SQL Editor → New query**: incolla tutto `supabase/schema.sql` → **Run**.
3. Nuova query: incolla `supabase/setup-produzione.sql` → **Run**.
   Crea i bucket `media` (foto e video, pubblico), `documenti` (documenti d'identità, privato) e
   `avatars` (foto profilo, pubblico), i permessi sui file, le pulizie quotidiane, i lavori ogni minuto
   (pulizia dei file e notifiche push: partono dopo i segreti del Vault, passo 0.2) e la chiusura automatica della gara: ogni minuto si controlla se è arrivato l'orario
   della copertina (lo scegli nell'app, Impostazioni → Copertina e documenti); a quell'ora la gara chiude e
   la nuova copertina esce subito.
4. **Authentication → Sign In / Providers**:
   - **Google** e **Facebook**: attivi, come spiegato nella sezione 0 (punti A–C). Si entra solo così.
   - **Email**: **spento** (l'accesso con email o nome utente e password non esiste più).
   - **Allow anonymous sign-ins**: spento.
5. Dopo esserti registrato dall'app, diventa amministratore (modera, verifica i documenti, sceglie l'orario
   della copertina). Questa query rende amministratore **solo** te e toglie il ruolo a chiunque altro:
   ```sql
   update public.profiles
      set is_admin = (username = 'il_tuo_username'), is_moderator = false
    where is_admin or is_moderator or username = 'il_tuo_username';
   ```
   L'amministratore è anche moderatore. Nessuno può darsi un ruolo dall'app: si cambia solo da qui.
6. **Accesso perso** (per esempio l'account Google o Facebook chiuso): non c'è una password da reimpostare. Chi
   non riesce più a entrare scrive all'email di supporto; dopo aver verificato che l'account è suo, l'amministratore
   può eliminarlo (così il nome utente si libera) e la persona si iscrive di nuovo con l'account che usa ora.
7. **Verifica automatica dell'età (Didit)** — facoltativa, si fa tutto dal browser del telefono:
   1. Registrati su **business.didit.me** (gratis, niente carta: 500 verifiche al mese incluse, poi circa 0,30 $ l'una).
   2. **Workflows** → crea un workflow con *ID Verification*, *Passive Liveness* e *Face Match*.
      Nelle opzioni dell'ID Verification attiva la **restrizione d'età**: minimo **14** anni. Pubblicalo e copia il suo **ID**.
   3. **Settings → API keys**: copia la **API key**.
   4. **Settings → Data retention**: scegli il periodo più breve (l'app cancella comunque ogni sessione appena decisa).
   5. Su Supabase: **Edge Functions → Deploy a new function → Via Editor**, nome **`verifica-eta`**.
      Incolla tutto `supabase/functions/verifica-eta/index.ts` e pubblica.
      Poi nelle impostazioni della funzione **spegni "Verify JWT"** (Didit non ha un account Supabase: la funzione
      controlla l'utente da sola).
   6. **Edge Functions → Secrets**: aggiungi `DIDIT_API_KEY` e `DIDIT_WORKFLOW_ID`.
   7. Su Didit, **Settings → Webhooks**: indirizzo
      `https://<il-tuo-progetto>.supabase.co/functions/v1/verifica-eta/webhook`, versione **v3**.
      Copia il **segreto** del webhook e aggiungilo su Supabase come `DIDIT_WEBHOOK_SECRET`.
   8. Nell'app: **Impostazioni → Copertina e documenti → Come si verifica l'età → Automatica (Didit)**.
      Prova con il tuo account (o uno nuovo): "Verifica ora".
   Se qualcosa non va, torna su "Foto all'amministratore": l'app continua a funzionare come prima.

   La stessa funzione fa anche da **link di condivisione**: quando qualcuno condivide un post, il messaggio
   contiene `https://<il-tuo-progetto>.supabase.co/functions/v1/verifica-eta/apri/post/<id>`, che apre il
   post nell'app di chi lo riceve. Anche se non usi Didit, pubblica la funzione (passo 5) perché i link funzionino.
8. **Controllo automatico dei contenuti (OpenAI)** — obbligatorio: la stessa funzione `verifica-eta` controlla foto,
   video e didascalie prima che escano, e senza la funzione pubblicata **nessuno può pubblicare**. Crea la chiave e
   aggiungi il segreto `OPENAI_API_KEY` come spiegato nella sezione 0 ("Controllo automatico dei contenuti").
   Senza chiave i post escono solo dopo la tua approvazione (Impostazioni → Moderazione).
   **Ogni volta che il file `index.ts` cambia**, aprila su Supabase, incolla di nuovo tutto il file e ripubblica.
8. **Project Settings → API** (o *API Keys*): copia
   - **Project URL** (tipo `https://abcd1234.supabase.co`)
   - **anon / publishable key** (la chiave pubblica; **mai** la `service_role`).

Ti servono al passo 5.

## 4. Pubblica le pagine legali (gli store vogliono dei link)

Apple e Google chiedono gli indirizzi web di Privacy ed Eliminazione account.

**Con GitHub Pages (già configurato):**
1. Fai il merge del branch in `master`, il ramo predefinito del repository (o chiedimelo e apro la pull request):
   il lavoro che pubblica il sito parte solo da lì.
2. Su GitHub: **Settings → Pages → Source: GitHub Actions**.
3. **Actions → "Virale · pagine legali" → Run workflow**.
4. Gli indirizzi saranno:
   - `https://edellas.github.io/cooklog/privacy.html`
   - `https://edellas.github.io/cooklog/termini.html`
   - `https://edellas.github.io/cooklog/linee-guida.html`
   - `https://edellas.github.io/cooklog/eliminazione-account.html`

GitHub Pages su un repository **privato** richiede un piano a pagamento. In alternativa:
`npm run export:legal`, poi trascina la cartella `legal-site/` su <https://app.netlify.com/drop>.

Poi:
- metti l'indirizzo base in `EXPO_PUBLIC_OWNER_WEBSITE` (passo 2);
- in `store/scheda-store.md`, `store/revisione.md` e `store/privacy-store.md` sostituisci
  `<sito>`, `<nome del titolare>` e `<OWNER.email>`.

## 5. Collega il progetto a Expo e inserisci le chiavi

Dal tuo computer (serve Node.js 20 o più recente):

```bash
git clone https://github.com/edellas/cooklog.git
cd cooklog/virale
npm install
npm install -g eas-cli
eas login
eas init          # crea il progetto su expo.dev e scrive il suo ID in app.json
```

Le chiavi di Supabase (passo 3) vanno su EAS, così entrano nelle build:

```bash
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value "https://abcd1234.supabase.co" \
  --environment preview --environment production --visibility plaintext
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "la-tua-anon-key" \
  --environment preview --environment production --visibility plaintext
```

Se mancano, la build di produzione si apre su una schermata "Configurazione mancante"
invece di partire con i dati demo: è voluto, così non pubblichi per sbaglio la demo.

Fai commit e push di `app.json` (ora contiene l'ID del progetto EAS).

## 6. Provala sul tuo telefono Android (prima di tutto il resto)

```bash
eas build --platform android --profile preview
```

Alla fine EAS ti dà un link/QR: aprilo dal telefono e installa l'APK. Controlla:
- "Continua con Google" (e "Continua con Facebook"), Completa il profilo con la casella dei termini;
- Impostazioni → Esci, poi di nuovo "Continua con Google": rientri nello stesso account;
- pubblicazione di foto e video (con la percentuale di caricamento), anche un video da 60 secondi
  (prima "Preparo il video…", poi "Carico…") e "Annulla" a metà;
- dopo la prima candidatura, la richiesta delle notifiche; poi un secondo account che ti segue → notifica entro 2 minuti,
  e toccandola si apre il suo profilo;
- un link condiviso aperto da WhatsApp (apre l'app, o lo store se non c'è);
- nei Provini: un tocco mette in pausa, la barra in basso si trascina, tenendo premuto si aprono le opzioni;
- "···" sotto un post → Segnala e Blocca;
- Profilo → impostazioni → Elimina account.

Poi nomina te stesso amministratore. In Supabase, **SQL Editor**:

```sql
update public.profiles set is_admin = true where username = 'il_tuo_username';
```

Nell'app compariranno **Impostazioni → Amministrazione** (orario della copertina, documenti da verificare)
e **Segnalazioni da rivedere**. Per un moderatore che non verifica documenti: `set is_moderator = true`.

Su iPhone si prova tramite TestFlight (passo 7).

## 7. App Store

1. **Build e invio a TestFlight:**
   ```bash
   eas build --platform ios --profile production
   eas submit --platform ios --latest
   ```
   EAS ti chiede l'Apple ID, crea da solo certificati, profili e l'app in App Store Connect
   (identificativo `app.virale.mobile`). Dopo circa 15 minuti la build compare in **TestFlight**:
   installala sul tuo iPhone e rifai le prove del passo 6.
2. **App Store Connect → la tua app → Distribuzione:**
   - testi da `store/scheda-store.md` (nome, sottotitolo, testo promozionale, parole chiave, descrizione);
   - screenshot iPhone 6,9": `store/screenshots/iphone-6.9-*.jpg` (Apple li adatta da solo agli altri iPhone; l'app non è disponibile per iPad);
   - categoria Foto e video, URL privacy e assistenza dal passo 4;
   - **Privacy dell'app**: rispondi come in `store/privacy-store.md`;
   - **Classificazione per età**: come in `store/privacy-store.md`;
   - **Prezzi e disponibilità**: Gratis; **Conformità DSA (trader)**: vedi passo 1;
   - **Informazioni per la revisione**: incolla `store/revisione.md` nelle note; nessun account demo necessario.
3. Seleziona la build di TestFlight → **Aggiungi per la revisione** → **Invia**.

Se ti rifiutano, il messaggio cita una linea guida (es. 1.2 o 5.1.1): mandamelo e lo sistemiamo.

## 8. Google Play — prima configurazione

1. **Play Console → Crea app**: nome "Virale", lingua Italiano, App, Gratuita.
2. **Contenuti dell'app** (menu a sinistra, in fondo): compila tutto come in `store/privacy-store.md`
   (norme sulla privacy, annunci, accesso alle app, classificazione, pubblico di destinazione,
   sicurezza dei dati). Alla voce **Eliminazione dell'account** metti l'URL `…/eliminazione-account.html`.
3. **Presenza nello store → Scheda principale**: testi da `store/scheda-store.md`,
   icona `store/grafica/play-icona-512.png`, grafica `store/grafica/play-grafica-1024x500.png`,
   screenshot `store/screenshots/android-*.jpg`.
4. **Prima build, caricata a mano** (Google non accetta il primo caricamento via API):
   ```bash
   eas build --platform android --profile production
   ```
   Scarica il file `.aab` dal link di EAS. In Play Console: **Test → Test chiuso → Crea release**,
   carica l'`.aab`, accetta la *Firma dell'app di Google Play*, salva e invia alla revisione.

## 9. Google Play — test chiuso e produzione

**Account personale nuovo:** servono **almeno 12 tester iscritti per 14 giorni di fila**.
1. Nel test chiuso aggiungi una lista email (12 o più amici con Android) e condividi il link di adesione.
2. Chiedi loro di installare l'app e di aprirla qualche volta nei 14 giorni.
3. Dopo 14 giorni: **Dashboard → Richiedi l'accesso alla produzione** (domande su come hai testato).
4. Approvato l'accesso: **Produzione → Crea release** → promuovi la stessa build → invia.

**Account aziendale:** puoi andare in produzione subito, ma un test chiuso con qualche persona resta consigliato.

**Invii automatici dalle versioni successive** (facoltativo):
crea in Google Cloud un *service account* con accesso alla Play Console
(guida: <https://docs.expo.dev/submit/android/>), salva la chiave JSON in
`virale/secrets/google-play-service-account.json` (la cartella `secrets/` non finisce su git) e poi:
```bash
eas submit --platform android --latest
```
La release arriva come bozza nel canale interno: la promuovi tu dalla console.

## 10. Dopo il lancio (ogni giorno)

- **Moderazione entro 24 ore**: apri Impostazioni → Segnalazioni da rivedere, **tutte e due le schede**
  (Post; Commenti e profili). *Va bene* rimette il contenuto, *Rimuovi* lo toglie a tutti (per un profilo:
  foto, nome e bio azzerati), *Espelli* blocca l'autore. Chi viene rimosso riceve una notifica con il motivo.
  Le notifiche push allo staff ti avvisano delle segnalazioni nuove. Apple e Google controllano che le
  segnalazioni abbiano risposta.
- **Funzione `verifica-eta`**: ogni tanto guarda i Logs: `/lavori` ogni minuto con stato 200 (se manca, la
  pulizia dei file e le notifiche push sono ferme: controlla i segreti del passo 0).
- **Email di supporto**: rispondi a segnalazioni urgenti, richieste privacy (entro 30 giorni per il GDPR) e ricorsi.
- **Contenuti illegali gravi** (in particolare abusi su minori): rimuovi subito, espelli l'account
  e segnala alla Polizia Postale (<https://www.commissariatodips.it>).

## Aggiornare l'app

1. In `app.json` aumenta `"version"` (es. da `1.0.0` a `1.0.1`). Il numero di build cresce da solo.
2. `eas build --platform all --profile production`
3. `eas submit --platform ios --latest` e `eas submit --platform android --latest` (o caricamento manuale su Play).
4. Su App Store Connect crea la nuova versione, scrivi le novità e inviala in revisione.

Se modifichi i testi legali, aggiorna `LEGAL_UPDATED` in `src/legal/docs.ts`: le pagine web si
ripubblicano da sole al merge in `master`.

## Rigenerare la grafica

- Icone e splash: `npm run icons`
- Grafica in evidenza Play: `npm run store:grafica`
- Screenshot: vedi le istruzioni in cima a `scripts/store-screenshots.cjs`
