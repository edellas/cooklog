# PreventivoLampo: sistema visivo

Riferimento per chi tocca l'interfaccia. Segue le linee guida di Impeccable (modalità "Operate" per l'app,
"Persuade" per la pagina di vendita) e quelle di Emil Kowalski per animazioni e interazioni.

## La scena

Chi usa l'app è un artigiano (idraulico, elettricista, muratore...) in cantiere o a casa del cliente:
telefono in una mano, spesso alla luce del sole, interrotto di continuo. Chi riceve il preventivo è il cliente,
spesso non giovane, che lo apre da WhatsApp al tavolo di cucina.

Da qui le scelte: tema chiaro di base e molto contrasto, testi grandi, un'azione principale per schermata,
pulsanti larghi nella metà bassa dello schermo, nessuna decorazione che rallenti la lettura.

## Il mondo visivo: "carta da cantiere"

Il riferimento è il blocchetto dei preventivi e delle ricevute: carta chiara un po' calda, inchiostro scuro,
il numero progressivo del modulo, la firma a penna blu, il timbro dell'impresa. Il giallo del lampo (il nome
dell'app) è il giallo degli attrezzi e dei cartelli di cantiere: si vede anche al sole e segna l'azione da fare.

Dettagli che solo questo prodotto ha:

- **Numero del preventivo come su un modulo**: "N° 2026-004" in cifre tabulari.
- **Firma blu penna**: il tratto della firma e i link usano lo stesso blu (`--penna`), come la firma su un contratto.
- **Timbro**: "Accettato" e "Pagato" sulla pagina del cliente appaiono come un timbro (doppio bordo, maiuscoletto,
  leggera rotazione), con un'unica animazione breve. È il momento più importante per l'artigiano e per il cliente.

## Colore

Palette sobria: neutri caldi, un solo accento (giallo) usato solo per l'azione principale, colori di stato
standard. Contrasti verificati (WCAG AA: testo ≥ 4,5:1).

| Token | Chiaro | Scuro | Uso |
| --- | --- | --- | --- |
| `--bg` | `#F4F2ED` | `#131518` | fondo pagina (carta) |
| `--surface` | `#FFFFFF` | `#1C1F23` | schede, fogli |
| `--surface-2` | `#EEEBE4` | `#262A2F` | campi, righe interne |
| `--line` | `#DDD8CE` | `#353A41` | bordi |
| `--ink` | `#1A1D21` | `#F1EFEA` | testo (16,9:1 su bianco) |
| `--ink-2` | `#4C525A` | `#B6BAC0` | testo secondario (7,9:1) |
| `--muted` | `#62676F` | `#92979E` | etichette, segnaposto (≥ 4,5:1 anche sui campi) |
| `--lampo` | `#FFC21A` | `#FFC933` | sfondo dell'azione principale, con testo `--ink` (10,5:1) |
| `--penna` | `#2445B0` | `#93B1FF` | link, firma, informazioni |
| `--ok` | `#17724A` | `#5CD39A` | accettato, pagato |
| `--bad` | `#B42318` | `#FF8F85` | scaduto, errori, eliminazioni |
| `--warn` | `#A3480A` | `#FFB070` | da verificare, in attesa di acconto |
| `--wa` | `#0F7A3D` | `#0F7A3D` | pulsante WhatsApp (testo bianco 5,4:1) |

Regole:

- Il giallo non diventa mai testo e non decora: è il fondo del pulsante principale e il segno del lampo.
- Niente sfumature, niente vetro e sfocature decorative, niente aloni colorati.
- I testi secondari sui fondi colorati prendono la tinta di quel fondo, non il grigio.

## Caratteri

Un'unica famiglia: **Archivo** (Omnibus-Type, licenza OFL), variabile in peso e larghezza, in `public/fonts`.
È una grottesca robusta con cifre tabulari ben disegnate.

- Testo: larghezza 100, peso 400–500, 16 px (campi 17 px, così iOS non ingrandisce).
- Titoli e importi: larghezza 112 (`font-stretch: 112%`), peso 700–800, con un carattere da scritta sul furgone.
- Scala fissa (rapporto ~1,2): 12 · 13,5 · 15 · 16 · 17 · 20 · 24 · 29 · 35 px.
- Importi sempre `tabular-nums`. Niente etichette in maiuscoletto sopra i titoli.

## Forme ed elevazione

- Raggi: 8 px piccoli controlli, 12 px pulsanti e campi, 14 px schede, 20 px fogli dal basso; pillole solo per
  badge e filtri.
- Le schede si staccano dal fondo con un bordo da 1 px, senza ombra. L'ombra è solo per ciò che galleggia:
  barra in basso, fogli, notifiche.
- Mai schede dentro schede: dentro una scheda si separa con spazio e linee sottili.

## Icone

Lucide (licenza ISC), tratto 2 px, 20–24 px. Nessuna emoji come icona: anche i mestieri hanno la loro icona.

## Movimento

Regole di Emil Kowalski, in `app.css` come variabili:

- `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` per ciò che entra; `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`
  per i fogli dal basso; mai `ease-in` sull'interfaccia.
- Durate: pressione 120 ms, piccoli elementi 150–200 ms, fogli 300 ms in entrata e 200 ms in uscita.
- I fogli dal basso seguono il dito: si chiudono trascinando (oltre il 30% dell'altezza o con un gesto veloce) e con il
  tasto Indietro di Android.
- Ogni elemento premibile risponde con `scale(0.97)`.
- Gli effetti al passaggio del mouse solo con `(hover: hover) and (pointer: fine)`.
- Transizioni, non keyframe, per ciò che si ripete (notifiche): si possono interrompere.
- Si anima solo `transform` e `opacity`. Niente animazioni da `scale(0)`: si parte da 0,95 con opacità 0.
- Con "riduci movimento" restano solo le dissolvenze.
- Un solo tipo di momento celebrativo, il timbro: "Accettato" quando il cliente firma (sulla sua pagina e nell'app
  dell'artigiano) e "Pagato" quando l'ultimo pagamento è registrato. Nessun coriandolo, nessun rimbalzo.
- Vibrazioni brevi e rare (`VIBRA` in `ui.js`): tocco, successo, errore.

## Testi

L'app parla come l'artigiano, non come un gestionale: "Da inviare" invece di "Bozza", "I miei prezzi" invece di
"Listino", verbi sui pulsanti ("Manda il sollecito", "Segna come pagato"). Ogni errore dice cosa è successo e
come rimediare.

## Struttura delle schermate

- **Home = cose da fare.** In cima il saluto e "Nuovo preventivo"; sotto "Da fare" (una riga, un verbo), poi agenda e
  lista. Le statistiche stanno in "Andamento", non in apertura.
- **Editor in tre blocchi**: per chi è, cosa c'è da fare, acconto. Il resto in "Altre opzioni". Un preventivo firmato è
  bloccato finché non si sceglie "Modifica comunque".
- **Barra in basso** con il totale e un'azione principale che dipende dallo stato del lavoro.
- **Sole**: `data-contrasto="sole"` alza i contrasti (bordi e testi secondari più scuri) per l'uso all'aperto.
