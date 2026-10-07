# PreventivoLampo per iPhone e Android

L'app per gli store è la stessa app web di `public/`. [Capacitor](https://capacitorjs.com) 8 la mette in un
guscio nativo e le dà le funzioni del telefono. Non c'è un secondo codice da mantenere: quando cambi l'app web,
rigeneri le app con `npm run sync`.

## Cosa fa in più l'app nativa

| Sul web | Nell'app |
| --- | --- |
| PDF scaricato | Il PDF si apre nel lettore del telefono, o va nel foglio Condividi (WhatsApp, email, Salva in File/Drive) |
| Promemoria come file da aggiungere al calendario | **Avvisi sul telefono**, programmati dall'app: il giorno di una scadenza di pagamento, 3 giorni dopo se non è arrivato, la sera prima di un lavoro, quando un cliente non risponde, due giorni prima che un preventivo scada, e il "giro dei conti" del venerdì alle 17:30. Toccando l'avviso si apre la pagina giusta. |
| Data del lavoro come file `.ics` | L'evento si apre già compilato nell'app Calendario |
| La conferma del cliente si apre nel browser | Il link della conferma o dell'avviso di pagamento apre l'app (App Links e Universal Links). Se non sono configurati, la pagina web mostra "Apri nell'app". |
| Dettatura solo su alcuni browser | Dettatura con il riconoscimento vocale del telefono, anche in Android |
| Rubrica solo su Chrome Android | Cliente scelto dalla rubrica, su iPhone e Android |
| Schermo che si spegne durante la firma al tavolo | Lo schermo resta acceso finché il cliente firma |
| I dati stanno nel browser | In più c'è una **copia di sicurezza automatica** nella memoria dell'app (due file a turno). Se iOS o Android svuotano i dati della WebView, l'app li riprende da sola. |
| Pro con il codice licenza | Pro dall'App Store o da Google Play (RevenueCat). Chi ha già Pro dal sito lo attiva con il codice. |

Ci sono anche: il tasto Indietro di Android (chiude il foglio aperto, torna indietro, dalla home riduce
l'app), le vibrazioni del motore aptico, le barre di sistema che seguono il tema, la schermata di avvio e
l'icona del marchio. WhatsApp, Telefono e Mail si aprono con le loro app.

I link mandati ai clienti portano sempre al sito (`CONFIG.sito` in `public/js/config.js`): il cliente non deve
installare niente.

## Struttura

```
mobile/
  capacitor.config.json   nome, ID dell'app (it.preventivolampo.app), plugin
  android/                progetto Android Studio (lo genera Capacitor, le modifiche restano)
  ios/                    progetto Xcode (Swift Package Manager)
  assets/                 icona e schermata di avvio di partenza (le crea scripts/genera-icone.mjs)
  prove/                  prove sull'emulatore Android e sul simulatore iOS (le lancia GitHub Actions)
  www/                    l'app web pronta per il telefono (generata, non va nel repository)
public/js/nativo.js       il ponte verso il telefono; sul web non carica niente
public/js/avvisi.js       quali avvisi programmare (funzione pura, con i suoi test)
scripts/prepara-www.mjs   copia public/ in mobile/www, senza sito di vendita né service worker
```

## Compilare

Servono Node 22, Android Studio con JDK 21 e SDK 36 per Android, e un Mac con Xcode 16 o successivo per iOS.

```bash
cd mobile
npm ci
npm run sync        # prepara www/ e la copia nei progetti nativi
npm run android     # apre Android Studio: Run sul telefono o sull'emulatore
npm run ios         # apre Xcode: scegli il tuo team in Signing & Capabilities, poi Run
```

Per cambiare icona o schermata di avvio modifica `scripts/genera-icone.mjs` e lancia `npm run risorse`.

## Prima di pubblicare negli store

1. **Dominio.** Metti il tuo dominio in `public/js/config.js` (`sito`), in
   `android/app/src/main/AndroidManifest.xml` (`android:host`) e in `ios/App/App/App.entitlements`
   (`applinks:`).
2. **Firma e link verificati.** Firma l'app: su Android con Play App Signing, su iOS con il tuo team in Xcode;
   Xcode attiva da solo la capability "Associated Domains". Poi crea i file che collegano il sito all'app e
   ripubblica il sito:
   ```bash
   ANDROID_SHA256="AB:CD:..." IOS_TEAM_ID="ABCDE12345" node scripts/genera-link-app.mjs
   ```
3. **Acquisti nell'app.** Apple e Google chiedono che un abbonamento digitale si compri dentro l'app.
   - Crea i prodotti nei due store: un abbonamento annuale, uno mensile e, se vuoi, un acquisto "a vita".
   - Su [RevenueCat](https://www.revenuecat.com), gratis fino a 2.500 $ al mese di incassi, crea:
     - un progetto con le due app;
     - l'entitlement `pro`;
     - un'offering "current" con i pacchetti annuale, mensile e a vita.
   - Incolla le due chiavi pubbliche dell'SDK in `config.js`, alla voce `app` (`revenuecatIos`,
     `revenuecatAndroid`).
   - Prova l'acquisto con gli account sandbox.

   Finché le chiavi sono vuote, l'app non mostra prezzi né link di pagamento esterni, e Pro si attiva solo con
   il codice del sito. Non pubblicare in questo stato: gli store rifiutano un'app che vende Pro altrove e
   non dentro l'app.
4. **Schede degli store.**
   - Indirizzo della privacy: `<sito>/privacy.html`.
   - Dati raccolti: i preventivi restano sul telefono; il codice licenza viene verificato dal sito;
     RevenueCat gestisce gli acquisti; le statistiche sono solo quelle facoltative di `config.js`.
   - Permessi, chiesti solo quando servono: microfono e riconoscimento vocale (dettatura), rubrica, foto e
     fotocamera, notifiche, calendario.
5. **Versione.**
   - Android: `versionCode` e `versionName` in `android/app/build.gradle`.
   - iOS: `MARKETING_VERSION` e `CURRENT_PROJECT_VERSION` in Xcode.

## Come si prova

- `npm run test:nativo`, dalla cartella del progetto: l'app di `www/` gira in Chromium con un finto ponte
  Capacitor che registra ogni chiamata ai plugin, in 14 passi:
  - rubrica e dettatura;
  - PDF aperto e condiviso; WhatsApp aperto con l'app giusta;
  - avvisi programmati e toccati;
  - link in arrivo e firma al tavolo;
  - calendario e tasto Indietro;
  - copia di sicurezza ripresa dopo che la memoria è stata svuotata;
  - acquisti nello store e licenza del sito.
- **GitHub Actions** (`.github/workflows/preventivolampo.yml`), a ogni modifica di `preventivolampo/`:
  - compila l'APK di debug e lo prova su un emulatore Android: Playwright si collega alla WebView dell'app
    installata e usa i plugin veri;
  - compila l'app iOS per il simulatore, la apre e controlla cosa compare con l'OCR di macOS: benvenuto, link
    dell'app aperto da fuori, riapertura;
  - APK e foto dello schermo restano tra gli artefatti della run.

## Limiti

- I dati stanno su un solo telefono: c'è la copia da salvare dove vuoi, non una sincronizzazione.
- Gli avvisi sono locali: si aggiornano quando l'app si apre o cambia qualcosa, non arrivano da un server.
  Android può spostarli di qualche minuto per risparmiare batteria.
- iOS tiene al massimo 64 avvisi in attesa: l'app ne programma al massimo 48, i più vicini.
- Su Android con una WebView molto vecchia, mai aggiornata, il ponte nativo può non caricarsi. In quel caso
  l'app funziona come quella web.
