# Piano: da 0 a 5.000-10.000 € al mese con PreventivoLampo

## Prima di tutto, la verità

Il prodotto è pronto e funziona: 70 controlli automatici superati (41 test unitari e 29 passaggi nel browser, compresi i tentativi di attacco). **Nessuno però può garantirti 10.000 € al mese**, e chi lo fa ti sta vendendo qualcosa. I soldi non li fa il codice: li fanno i clienti che lo scoprono, lo provano e pagano. Quella parte (distribuzione) dipende da te, e questo piano ti dice esattamente cosa fare.

Quello che posso darti è: un'idea con domanda reale e misurabile, costi quasi nulli, un prodotto finito e i numeri per capire in poche settimane se sta funzionando.

---

## Perché questa idea

- **Mercato enorme e raggiungibile**: in Italia ci sono circa **1,23 milioni di imprese artigiane** (CNA/Unioncamere, fine 2025), più centinaia di migliaia di freelance che fanno preventivi (fotografi, web designer, imprese di pulizia…). Basta circa lo **0,15%** di loro per arrivare a 10.000 €/mese.
- **Problema quotidiano legato ai soldi**: il preventivo è il momento in cui l'artigiano vince o perde un lavoro. Chi lo manda prima e fatto bene, lo prende più spesso. Pagare 7-10 € al mese per questo è facile da giustificare: basta un lavoro in più all'anno.
- **Le alternative attuali sono scomode**: blocchetto di carta, Word/Excel la sera, messaggi WhatsApp confusi, oppure gestionali di fatturazione completi (pesanti da imparare). Esistono app concorrenti (es. PrevAI, Artesan, i moduli preventivi dei software di fatturazione), ma nessuna domina il mercato degli artigiani in Italia: lo spazio c'è, e la differenza la fa chi arriva agli artigiani.
- **Cosa ci distingue**: il cliente **accetta e firma dal suo telefono** con un link su WhatsApp (senza installare nulla), sceglie da solo le **voci facoltative** (più valore per ogni lavoro), l'app ricorda **chi ricontattare** con il messaggio pronto. In più: zero registrazione, listino per 27 mestieri, dettatura di più voci insieme, foto nel PDF, calcolatore dei metri quadri, guadagno visibile solo all'artigiano, funziona offline.
- **Costi quasi zero**: niente server né database (i dati stanno sul telefono dell'utente), hosting gratuito, pagamenti e IVA gestiti dal Merchant of Record. Il margine è circa il 90% dell'incasso netto IVA.

---

## I numeri

### Quanto ti resta per ogni abbonato

| Piano | Prezzo (IVA incl.) | Netto per te* | Al mese |
|---|---|---|---|
| Mensile | 9,90 €/mese | ~7,20 € | 7,20 € |
| Annuale | 79 €/anno | ~60 €/anno | 5,00 € |
| **Media (metà e metà)** | | | **~6,10 €** |

\* dopo IVA (22% sui privati) e commissioni del Merchant of Record (~5% + 0,50 $). Prima delle tue tasse.

### Quanti abbonati servono

| Obiettivo | Abbonati paganti attivi |
|---|---|
| 1.000 €/mese | ~165 |
| 5.000 €/mese | ~820 |
| **10.000 €/mese** | **~1.650** |

### Quanti artigiani devono provarla

Nei prodotti freemium per professionisti tipicamente paga dal **2% al 6%** di chi li prova. Il nostro limite gratuito (3 preventivi al mese) è pensato per spingere a pagare proprio chi lavora tanto.

| Conversione | Prove necessarie per 820 abbonati (5k) | Per 1.650 abbonati (10k) |
|---|---|---|
| 3% | ~27.000 | ~55.000 |
| 6% | ~14.000 | ~27.500 |

Più una quota di disdette (3-5% al mese sui mensili) da rimpiazzare con nuovi clienti.

### Tempi realistici

| Momento | Scenario prudente | Scenario buono (esecuzione costante) |
|---|---|---|
| Mese 3 | 10-30 abbonati (~60-180 €/mese) | 50-100 abbonati (~300-600 €/mese) |
| Mese 6 | 50-150 (~300-900 €) | 200-400 (~1.200-2.500 €) |
| Mese 12 | 200-400 (~1.200-2.500 €) | 800-1.200 (**~5.000-7.000 €**) |
| Mese 18-24 | 500-900 (~3.000-5.500 €) | 1.500-2.500 (**~9.000-15.000 €**) |

**Come accorciare i tempi** (sono le tre leve che contano davvero):

1. **Prezzo più alto.** Prova 14,90 €/mese e 119 €/anno: se la conversione non crolla, ti servono la metà degli abbonati. (Basta cambiare i prodotti su Polar e `config.js`.)
2. **Canali che portano centinaia di utenti alla volta** (grossisti, commercialisti, associazioni: vedi sotto). È la strada più veloce verso i 10k.
3. **Piani più ricchi** quando hai i primi 100 clienti: "Pro Team" per le imprese con 3-10 operai (es. 29 €/mese), sincronizzazione tra telefono e computer, rapportini firmati.

---

## Piano operativo

### Giorni 1-3: messa online

- [ ] Pubblica il sito (README, passo 2) e compra il dominio.
- [ ] Crea i prodotti su Polar, prova un acquisto in sandbox e attiva Pro con il codice (README, passo 3).
- [ ] Compila `config.js` (email, titolare, link) e rilancia `npm run seo` se il dominio è diverso.
- [ ] Apri la partita IVA forfettaria (o fissa l'appuntamento con il commercialista).
- [ ] Attiva le statistiche (Plausible o Umami) e Google Search Console con la sitemap.
- [ ] Installa l'app sul tuo telefono e fai 5 preventivi veri di prova.

### Settimane 1-2: i primi 20 utenti veri, di persona

L'obiettivo non è vendere: è vedere 20 artigiani usarla e sentire cosa dicono.

- Parti da chi conosci: parenti, amici, l'idraulico o l'elettricista che hai chiamato a casa.
- Vai alle **7 del mattino** nei negozi dove gli artigiani comprano il materiale (ferramenta, grossisti idrotermosanitari ed elettrici, colorifici). Mostra l'app in 30 secondi dal tuo telefono e lascia un volantino con il QR code.
- Siediti accanto a 5 di loro mentre fanno il primo preventivo: annota dove si bloccano. Sistemare quei punti vale più di qualsiasi pubblicità.
- Chiedi a chi la usa volentieri **2 righe di recensione con nome e mestiere** (con il loro permesso) e mettile sulla landing. Recensioni vere, mai inventate.

### Settimane 3-6: contenuti e community (costo 0 €)

- **Video brevi (TikTok, Reels, Shorts), uno al giorno per 30 giorni.** Gli artigiani guardano tantissimi video di cantiere. Formato: telefono in mano in un cantiere vero, "preventivo fatto e mandato in 40 secondi". Idee pronte qui sotto.
- **Gruppi Facebook di mestiere** (idraulici, elettricisti, imbianchini, edili: alcuni hanno decine di migliaia di iscritti). Leggi le regole, partecipa, poi pubblica chiedendo un parere sincero, non uno spot. Testo pronto qui sotto.
- **SEO**: le 27 pagine "fac simile preventivo" sono già online. Ogni settimana aggiungine 3-5 per lavori specifici e molto cercati ("preventivo rifacimento bagno", "preventivo tinteggiatura appartamento", "preventivo impianto elettrico casa"): duplica una voce in `mestieri.js` e rilancia `npm run seo`. Le pagine iniziano a portare visite dopo 2-4 mesi e poi lavorano da sole.

### Settimane 7-12: canali che scalano

- **Grossisti e rivenditori di materiale** (la leva più forte). Hanno migliaia di artigiani come clienti e cercano modi per fidelizzarli. Proposta: "Regala PreventivoLampo Pro ai tuoi clienti con il tuo marchio". Prezzo a pacchetto, es. 100 licenze annuali a 30 € l'una = 3.000 € in un colpo. Dieci accordi così valgono più di mesi di pubblicità. (Le licenze le generi su Polar come codici sconto al 100% o come vendita diretta.)
- **Commercialisti e CAF**: seguono decine di artigiani ciascuno. Offri il 20-30% di ogni abbonamento portato (codici sconto personalizzati per tracciarli) o licenze gratuite per i loro clienti migliori.
- **Associazioni di categoria** (CNA, Confartigianato, Casartigiani: sedi provinciali): proponi una convenzione per i soci e un articolo nella loro newsletter.
- **Google Ads, test da 300 €** su parole come "app preventivi", "programma preventivi gratis", "fac simile preventivo idraulico". Un abbonato vale circa 6 € al mese per più di un anno (~100 €): finché un cliente pagante ti costa meno di 30-40 €, aumenta il budget; se costa di più, ferma e lavora sugli altri canali.

### Ogni settimana guarda questi 6 numeri

| Numero | Dove | Se è basso… |
|---|---|---|
| Visite al sito | Statistiche | Il problema è la distribuzione: più video, post, partner |
| Onboarding completati / visite | Evento *Onboarding completato* | Landing poco convincente: cambia titolo e immagini |
| Chi crea almeno 1 PDF / onboarding | Evento *PDF creato* | L'app non è chiara: guarda 5 persone usarla |
| Arrivati al paywall | Evento *Paywall* | Pochi utenti attivi: aumenta l'uso, ricontatta chi ha provato |
| Checkout / paywall | Evento *Checkout* | Prezzo o valore percepito: prova l'annuale in evidenza, l'offerta "a vita" per il lancio |
| Disdette al mese | Polar | Chiedi a chi disdice perché: è il feedback più prezioso |

**Regola dei 90 giorni:** se dopo 3 mesi di lavoro costante hai meno di 20 clienti paganti, non insistere alla cieca. Guarda la tabella: il numero più basso ti dice dove intervenire. Se tutto è basso, cambia mestiere di riferimento (es. concentrati solo su imprese di pulizia o fotografi) o canale.

---

## Testi pronti da usare

### Post per gruppi Facebook

> Ciao a tutti, faccio [il tuo lavoro/sviluppo app] e ho fatto un'app per fare i preventivi dal telefono in un minuto: scegli le voci (ci sono già quelle tipiche da idraulico, elettricista ecc.), il totale con IVA si fa da solo, lo mandi in PDF su WhatsApp e se il cliente accetta lo fa firmare sul telefono.
> È gratis e non serve registrarsi. Mi servirebbe il parere di chi i preventivi li fa davvero: cosa manca? Cosa non vi piace? Il link è nel primo commento.

### 6 video da 20-40 secondi

1. **"Preventivo fatto prima di risalire in furgone"**: dal cliente, apri l'app, 4 voci dal listino, invio su WhatsApp. Cronometro in sovrimpressione.
2. **"Il cliente ha firmato mentre tornavo a casa"**: notifica WhatsApp con la conferma, la apri e il preventivo diventa "Accettato" con la firma. È il video più forte: mostra soldi che arrivano.
3. **"Gli ho proposto il sifone nuovo e l'ha aggiunto da solo"**: le voci facoltative spiegate in 20 secondi.
4. **"Detto il preventivo con la voce"**: "sostituzione miscelatore, poi due ore di manodopera" → le righe si compilano da sole con i prezzi del listino.
5. **"Blocchetto vs app"**: split screen, a sinistra il preventivo a mano, a destra il PDF. "Quale sceglieresti se fossi il cliente?"
6. **"Quanto costa rifare un bagno nel 2026?"**: mostra il preventivo di esempio con i prezzi medi. Questo tipo di video lo guardano anche i privati, e lo condividono con il loro artigiano.

### Email/telefonata a un grossista

> Buongiorno, sono [nome], ho creato PreventivoLampo, un'app con cui gli artigiani fanno preventivi dal telefono in un minuto e li mandano su WhatsApp. Vi propongo di regalarla ai vostri clienti con il vostro marchio come vantaggio fedeltà: per loro vale 79 € l'anno, a voi la proponiamo a pacchetto con uno sconto importante. Posso passare 10 minuti a mostrarla al responsabile commerciale?

### Messaggio a un commercialista

> Buongiorno, molti suoi clienti artigiani fanno ancora i preventivi a mano o in Word. Ho creato un'app che li fa in un minuto e in modo corretto (IVA, forfettario con dicitura e bollo). Se la consiglia ai suoi clienti le riconosco il 25% di ogni abbonamento, per sempre, con un codice dedicato. Le mando il link per provarla?

### Volantino (A6, con QR code al sito)

> **Il preventivo fatto in 60 secondi. Dal telefono.**
> Listino pronto per il tuo mestiere · Invio su WhatsApp · Firma del cliente sul posto.
> **Gratis, senza registrazione.** Inquadra il codice e fai il primo adesso.

---

## Costi

| Voce | Costo |
|---|---|
| Hosting (Netlify o Cloudflare) | 0 € |
| Dominio | ~10 €/anno |
| Pagamenti (Polar/Lemon Squeezy) | ~5% + 0,50 $ per transazione, solo quando incassi |
| Statistiche (facoltative) | 0 € (Umami) - 9 €/mese (Plausible) |
| Volantini | ~30 € per 1.000 |
| Commercialista e INPS | variabili: chiedi un preventivo prima di partire |
| Pubblicità | facoltativa, solo dopo aver visto che i canali gratuiti convertono |

---

## Rischi da conoscere

- **Concorrenza**: software di fatturazione e altre app hanno funzioni simili. La difesa non è il codice ma la velocità: stare vicino agli artigiani, sistemare in fretta quello che chiedono, chiudere accordi con grossisti e commercialisti prima degli altri.
- **Diffidenza verso gli abbonamenti**: per questo ci sono l'annuale in evidenza e l'offerta "a vita" per i primi clienti (utile anche per incassare subito).
- **Dati su un solo telefono**: se un utente perde il telefono senza backup perde i preventivi. Ricordaglielo (c'è il backup) e metti la sincronizzazione tra le prime funzioni Pro future.
- **Tempo**: i primi mesi rendono poco. Il risultato arriva sommando ogni settimana un po' di utenti, contenuti e partner. Se puoi dedicarci 1-2 ore al giorno in modo costante, i numeri di questo piano sono realistici.
