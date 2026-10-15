/**
 * Simula N giornate di Arena e stampa chi vince rispetto alla qualità reale dei contenuti.
 * Uso: npm run simulate -- [contenuti] [spettatori] [vistePerSpettatore] [giorni]
 */
import { simulateDay } from '../src/engine/simulation.ts';

const [entries = 300, viewers = 5000, viewsPerViewer = 30, days = 10] = process.argv
  .slice(2)
  .map((x) => Number.parseInt(x, 10));

console.log(`Arena: ${entries} contenuti, ${viewers} spettatori x ${viewsPerViewer} viste, ${days} giorni\n`);
console.log('giorno  pos.reale  qualità  viste      contenuti per livello (0/1/2/3/finale)  squalificati');

const ranks: number[] = [];
for (let day = 1; day <= days; day += 1) {
  const r = simulateDay({ entries, viewers, viewsPerViewer, seed: day });
  ranks.push(r.winnerTrueRank ?? Number.NaN);
  console.log(
    [
      String(day).padEnd(7),
      String(r.winnerTrueRank ?? '-').padEnd(10),
      (r.winnerQuality?.toFixed(3) ?? '-').padEnd(8),
      String(r.totalViews).padEnd(10),
      r.entriesPerTier.join('/').padEnd(38),
      r.spamWon ? `${r.disqualified} (HA VINTO SPAM!)` : String(r.disqualified),
    ].join(' '),
  );
}

const top1 = ranks.filter((r) => r === 1).length;
const top5 = ranks.filter((r) => r <= 5).length;
console.log(`\nVincitore = contenuto migliore in ${top1}/${days} giorni, nel top 5 in ${top5}/${days} giorni.`);
