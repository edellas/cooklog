# Virale · linguaggio visivo

## Il mondo

Una **rivista fotografica che esce ogni giorno**. I post sono *provini*, le stampe di prova sparse sul tavolo luminoso di una redazione. Chi guarda fa da photo editor: scorre e cerchia con la matita grassa quello che merita. A mezzanotte un solo provino diventa la **copertina** del numero di domani.

Non è TikTok:
- niente tela nera con la colonna di icone sopra il video;
- il post è una stampa in cornice con la sua striscia sotto;
- la vincitrice del giorno ha la testata e il numero dell'uscita.

Il tema è scuro perché l'app si usa la sera, sul divano o a letto. Il fondo però è inchiostro blu, mai nero puro.

## Colore

Strategia: neutri tinti d'inchiostro più due inchiostri da tipografia, ciascuno con un ruolo preciso.

| Token | Valore | Ruolo |
|---|---|---|
| `canvas` | oklch(0.19 0.032 264) `#0C1322` | fondo dell'app |
| `raised` / `sheet` | oklch(0.23 / 0.27 …) | superfici, fogli |
| `line` | oklch(0.38 0.03 264) | filetti, bordi |
| `paper` | oklch(0.965 0.008 95) `#F5F3EE` | testo principale (16,7:1) |
| `paperDim` / `paperFaint` | oklch(0.83 / 0.69 …) | testo secondario (10,9:1) e terziario (6,7:1) |
| `giallo` | oklch(0.89 0.175 98) `#FADB2C` | **la copertina e l'azione principale**: pubblica, fascia del conto alla rovescia, timbro "in gara", numero dell'uscita |
| `matita` | oklch(0.66 0.205 29) `#F65041` | **solo il segno della selezione**: il cerchio di matita (mi piace) e la finale |

Il giallo non decora: dove c'è, c'è un'azione o la copertina.

## Tipografia

- **Bodoni Moda** (900, 700, 500): testata "Virale", titoli, numeri di profilo e di copertina. È il carattere italiano per eccellenza (Parma, 1798) e la voce della rivista. Si usa con parsimonia.
- **Schibsted Grotesk** (400, 500, 700): tutta l'interfaccia. È un grottesco nato in una redazione: è il carattere che lavora.
- Scala: 12 meta · 14 small · 16 body · 15 label · 20 title · 30 heading · 44 numeral · 72+ testata.
- Le lettere della testata animate sono separate, quindi la coppia V-i viene ristretta a mano per non perdere la crenatura.

## Forme

- Griglia di 4 pt.
- Raggi: cornice 22, card 16, controlli 14, pillole.
- Ombre con offset e sfocatura, mai aloni colorati.
- Icone SVG disegnate su griglia 24, tratto 1,75, terminazioni tonde. Nessuna emoji.
- Il mi piace è un ovale tracciato a mano con i capi sovrapposti, come il segno su un provino.

## Movimento (regole di Emil Kowalski per Expo)

| Cosa | Frequenza | Come |
|---|---|---|
| Cambio di tab | centinaia di volte al giorno | nessuna animazione |
| Pressione di qualsiasi elemento | decine di volte | scala 0,97 in 120 ms, ease-out `(0.23, 1, 0.32, 1)`, al tocco e non al rilascio |
| Interruttori, "Per te / Seguiti" | decine di volte | 180 ms ease-out |
| Segno di matita al doppio tocco | spesso, ma è il gesto chiave | tratto in 420 ms ease-out, poi svanisce; vibrazione leggera nello stesso istante |
| Fogli (commenti, regole) | occasionale | form sheet nativo |
| Toast | occasionale | entra in 240 ms e esce in 180 ms dallo stesso lato |
| Scala dei gradini | quando cambia | 600 ms ease-out su un riempimento assoluto senza figli |
| Copertina che si sviluppa, testata lettera per lettera | una volta al giorno | 900 ms; strato sfocato statico che svanisce (si anima l'opacità, mai il raggio di sfocatura) |
| Muro di provini nel benvenuto | primo avvio | moto costante, lineare |
| Provino appuntato dopo la pubblicazione | raro | 420 ms, scala da 0,92 e piccola rotazione |

Altre regole:
- mai `scale(0)`;
- mai ease-in;
- le animazioni girano sul thread della UI (Reanimated 4, `scheduleOnRN`);
- con "Riduci movimento" restano solo le dissolvenze.

## Testi

- Il linguaggio è quello della redazione: Copertina, Provini, Archivio, cerchiare, gradini (Provino, Bozza, Impaginato, In macchina, Finale).
- I pulsanti dicono cosa succede: "Pubblica e candida".
- Gli errori dicono cosa fare: "Da 3 a 24 caratteri: lettere minuscole, numeri, punto e trattino basso."
