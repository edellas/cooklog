# Test di lancio con MiroFish

Questa cartella mette a confronto **4 idee di business solo online** (nessuna vendita diretta, nessun
contatto con i clienti) usando [MiroFish](https://github.com/666ghj/MiroFish).

MiroFish crea centinaia di "persone" simulate con l'intelligenza artificiale, le fa discutere del prodotto
su un finto social (stile X e Reddit), poi le intervista una per una e scrive un report.

| # | Idea | Prezzo | Perché è in lista |
|---|---|---|---|
| 1 | **Canzone per Te**: canzone personalizzata con l'IA da regalare | 14,99 € | Regalo emozionale. Il passaparola è integrato (ogni canzone viene condivisa). Nelle ricerche non ho trovato un concorrente italiano dominante. Natale è tra meno di 3 mesi. |
| 2 | **InvitoFacile**: inviti digitali animati con conferma presenza su WhatsApp | 9,90 € / 29 € | Ogni invito lo vedono 50-150 persone (pubblicità gratis). Mercato frammentato tra Canva, Etsy e piccoli grafici. |
| 3 | **ColfFacile**: busta paga e contributi di colf, badanti e baby-sitter | 3,99 €/mese | Bisogno reale e ricorrente (circa 800.000 lavoratori domestici, dato INPS 2025), si paga ogni mese. Concorrenza fatta di CAF e associazioni, poco digitali. |
| 4 | **FotoCV**: foto profilo professionale con l'IA da un selfie | 9,99 € | Domanda costante (curriculum, LinkedIn), ma concorrenti stranieri forti e alternative gratuite. Serve da termine di paragone. |

I dossier completi (prodotto, prezzo, dati di mercato, obiezioni, persone tipo, sia favorevoli sia
scettiche) sono in `concepts/<idea>/seed.md`. Le domande poste a MiroFish sono in `concept.json`.

## Cosa può dire, e cosa no

- **Può** far emergere le obiezioni più frequenti, i messaggi che convincono e quale delle 4 idee suscita
  più interesse rispetto alle altre.
- **Non può** dire quanti soldi farai. Le "persone" sono generate da un'IA: non hanno un portafoglio e non
  pagano davvero. Le simulazioni con IA tendono anche a essere più entusiaste della realtà. Usa il
  **confronto tra le idee**, non le percentuali assolute.
- L'unico test che misura i soldi veri è quello in fondo a questa pagina: una pagina di vendita più una
  piccola pubblicità.

## Cosa serve per farlo partire

### 1. Due chiavi API

- **Modello AI compatibile OpenAI**, per esempio Qwen di Alibaba (consigliato da MiroFish), OpenAI o
  DeepSeek. Variabili:
  - `LLM_API_KEY`
  - `LLM_BASE_URL` (default `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`)
  - `LLM_MODEL_NAME` (default `qwen-plus`)
- **Zep Cloud** (memoria degli agenti, il piano gratuito basta). Variabile: `ZEP_API_KEY`.
  Si crea su https://app.getzep.com/

Le chiavi vanno messe come **variabili d'ambiente**, mai scritte nei file o incollate in chat.

### 2. Rete

- **In questo ambiente cloud di Claude Code**: la rete di default blocca questi servizi. Apri il menu
  dell'ambiente nel titolo della sessione → **Edit**. In *Network access* scegli *Custom* e aggiungi agli
  *Allowed domains*:
  - `api.getzep.com`;
  - il dominio del modello (es. `dashscope-intl.aliyuncs.com`, `api.openai.com` o `api.deepseek.com`).

  Nella stessa schermata aggiungi le variabili d'ambiente del punto 1, poi apri una **nuova sessione** e
  chiedimi di lanciare il test.
- **Sul tuo computer** non serve niente di speciale. Bastano Python 3.11/3.12, `git` e circa 7 GB liberi.

### 3. Costo

Dipende dal modello e dal numero di round. MiroFish avverte che consuma molti token e consiglia di
restare sotto i 40 round alla prima prova: qui il default è 30 (`MAX_ROUNDS`). La mia stima, non verificata, è di
qualche euro per idea con un modello economico come qwen-plus. Lancia prima una sola idea e controlla il
consumo reale sul pannello del tuo fornitore.

## Come si lancia

```bash
cd launch-test
./run.sh                       # tutte e 4 le idee
./run.sh 01-canzone-ai         # solo alcune
MAX_ROUNDS=20 ./run.sh         # simulazione più corta ed economica
```

Lo script:

1. scarica MiroFish (versione fissa) e aggiunge la lingua italiana, perché di serie MiroFish ripiega sul
   cinese per ogni lingua diversa da inglese e cinese;
2. installa le dipendenze (circa 6 GB, solo la prima volta) e avvia il backend;
3. per ogni idea esegue: grafo della conoscenza → agenti → simulazione → intervista a tutti gli agenti
   ("lo compreresti a questo prezzo? SÌ / FORSE / NO") → report.

Se si interrompe, rilancia lo stesso comando: riparte dall'ultimo passo completato.

## Risultati

- `results/SUMMARY.md`: tabella di confronto delle risposte SÌ/FORSE/NO per ogni idea.
- `results/<idea>/report.md`: report di MiroFish (reazioni, obiezioni, previsioni).
- `results/<idea>/interviews.json`: ogni singola risposta degli agenti.

## Dopo la simulazione: il test con soldi veri (consigliato)

Prendi le 1-2 idee migliori e prima di costruirle per intero misura se la gente paga davvero:

1. **Pagina di vendita.** Una pagina con prezzo e pulsante "Acquista". Chi clicca vede "Stiamo aprendo:
   lascia l'email e avrai il 50% di sconto al lancio", oppure fa un vero pre-ordine con rimborso
   garantito.
2. **Pubblicità.** 100-200 € di inserzioni Instagram/Facebook per idea, in 7-10 giorni.
3. **Lettura dei numeri.**
   - Costo per clic sul pulsante "Acquista".
   - Percentuale di visitatori che cliccano "Acquista": sotto l'1% l'idea è debole, sopra il 3-5% è
     promettente.

Con quei numeri si calcola quanto costa acquisire un cliente e se 5-10 mila euro al mese sono
raggiungibili, con dati veri invece che simulati.
