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
| Supabase (database e file) | gratis per iniziare, poi Pro 25 USD/mese |
| Expo EAS (build nel cloud) | gratis con code d'attesa, o piani a pagamento |

Tempi realistici: 1 giorno di configurazione, 1–3 giorni per la revisione Apple;
su Google, se il tuo account sviluppatore è personale e nuovo, **almeno 14 giorni di test chiuso** prima di poter pubblicare.

Alla fine di ogni passo puoi lanciare `npm run check:release` (dalla cartella `virale/`):
ti dice cosa manca ancora.

---

## 1. Crea gli account (oggi, perché le verifiche richiedono giorni)

1. **Apple Developer Program** — <https://developer.apple.com/programs/enroll/>
   - Come *persona fisica*: nome e cognome compaiono come venditore nello store.
   - Come *azienda*: serve il numero D-U-N-S (gratuito, ma arriva in 1–2 settimane).
2. **Google Play Console** — <https://play.google.com/console/signup>
   - Ti chiederanno documento d'identità e, per le aziende, il D-U-N-S.
   - Se scegli *account personale*, prima della pubblicazione dovrai fare il test chiuso con 12 persone per 14 giorni (passo 9).
3. **Expo** — <https://expo.dev/signup> (gratis).
4. **Supabase** — <https://supabase.com/dashboard> (gratis).

Sia Apple sia Google ti chiederanno se sei un **"operatore commerciale" (trader)** ai sensi del
Digital Services Act. Se l'app non ti fa guadagnare (niente pubblicità, niente vendite) puoi
dichiarare di non esserlo; se pensi di guadagnarci, dichiaralo: il tuo indirizzo, telefono ed email
saranno visibili nella scheda. Nel dubbio chiedi al commercialista.

## 2. Inserisci i tuoi dati nei documenti legali

Apri `src/legal/docs.ts` e compila `OWNER`:

```ts
export const OWNER = {
  name: 'Mario Rossi',                    // o la ragione sociale
  address: 'Via Roma 1, 20100 Milano (MI)',
  taxId: 'RSSMRA80A01F205X',             // codice fiscale o partita IVA
  email: 'supporto@virale.app',           // una casella che leggi OGNI giorno
  website: 'https://edellas.github.io/cooklog', // lo scopri al passo 4: aggiornalo dopo
} as const;
```

I testi (Termini, Privacy, Linee guida, Eliminazione account) sono completi e coerenti con
quello che l'app fa davvero, ma **falli leggere a un avvocato** prima del lancio: è un social con
contenuti degli utenti, aperto dai 14 anni.

## 3. Prepara Supabase (database, file, mezzanotte)

1. **New project** → regione **Central EU (Frankfurt)** (i dati restano in UE, come dice l'informativa).
   Scegli una password del database lunga e salvala.
2. **SQL Editor → New query**: incolla tutto `supabase/schema.sql` → **Run**.
3. Nuova query: incolla `supabase/setup-produzione.sql` → **Run**.
   Crea i bucket `media` (foto e video, pubblico) e `documenti` (documenti d'identità, privato),
   i permessi sui file e la chiusura automatica a mezzanotte.
4. **Authentication → Sign In / Providers**:
   - **Email**: attivo, ma con **Confirm email** spento. L'app si accede con nome utente e password:
     Supabase vuole un'email, quindi l'app ne usa una interna (`nomeutente@utenti.virale.invalid`) che non riceve posta.
   - **Allow anonymous sign-ins**: spento (non serve più).
   - In **Authentication → Policies** (o *Password*): lunghezza minima della password **8**.
5. Dopo esserti registrato dall'app, diventa amministratore (modera, verifica i documenti, sceglie l'orario della copertina):
   ```sql
   update public.profiles set is_admin = true where username = 'il_tuo_username';
   ```
6. **Password dimenticata** di un utente (non c'è email per il recupero): dopo aver verificato che l'account è suo,
   reimpostala dal SQL Editor e comunicagliela, chiedendogli di cambiarla da Impostazioni → Cambia password:
   ```sql
   update auth.users set encrypted_password = crypt('NuovaPassword123', gen_salt('bf'))
   where email = 'nomeutente@utenti.virale.invalid';
   ```
7. **Project Settings → API** (o *API Keys*): copia
   - **Project URL** (tipo `https://abcd1234.supabase.co`)
   - **anon / publishable key** (la chiave pubblica; **mai** la `service_role`).

Ti servono al passo 5.

## 4. Pubblica le pagine legali (gli store vogliono dei link)

Apple e Google chiedono gli indirizzi web di Privacy ed Eliminazione account.

**Con GitHub Pages (già configurato):**
1. Fai il merge del branch su `main` (o chiedimelo e apro la pull request).
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
- metti l'indirizzo base in `OWNER.website` (passo 2);
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
- iscrizione con la casella dei termini;
- pubblicazione di foto e video;
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

- **Moderazione entro 24 ore**: apri Impostazioni → Moderazione. *Va bene* rimette il post,
  *Rimuovi* lo toglie a tutti, *Espelli* toglie il post e blocca l'autore. Apple e Google
  controllano che le segnalazioni abbiano risposta.
- **Email di supporto**: rispondi a segnalazioni urgenti, richieste privacy (entro 30 giorni per il GDPR) e ricorsi.
- **Contenuti illegali gravi** (in particolare abusi su minori): rimuovi subito, espelli l'account
  e segnala alla Polizia Postale (<https://www.commissariatodips.it>).

## Aggiornare l'app

1. In `app.json` aumenta `"version"` (es. da `1.0.0` a `1.0.1`). Il numero di build cresce da solo.
2. `eas build --platform all --profile production`
3. `eas submit --platform ios --latest` e `eas submit --platform android --latest` (o caricamento manuale su Play).
4. Su App Store Connect crea la nuova versione, scrivi le novità e inviala in revisione.

Se modifichi i testi legali, aggiorna `LEGAL_UPDATED` in `src/legal/docs.ts`: le pagine web si
ripubblicano da sole al merge su `main`.

## Rigenerare la grafica

- Icone e splash: `npm run icons`
- Grafica in evidenza Play: `npm run store:grafica`
- Screenshot: vedi le istruzioni in cima a `scripts/store-screenshots.cjs`
