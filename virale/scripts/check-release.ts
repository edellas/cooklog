/**
 * Controlla che il progetto sia pronto per gli store. Uso: npm run check:release
 * Esce con errore se qualcosa manca.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ownerMissing } from '../src/legal/docs.ts';

const root = join(import.meta.dirname, '..');
const problems: string[] = [];
const ok: string[] = [];

for (const name of ownerMissing()) problems.push(`${name} manca: impostalo nelle variabili d'ambiente (vedi .env.example)`);
if (!problems.length) ok.push('Dati del titolare compilati');

const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;
if (!app.extra?.eas?.projectId) problems.push('app.json non ha ancora extra.eas.projectId: esegui `eas init`');
else ok.push('Progetto EAS collegato');
if (!app.ios?.bundleIdentifier || !app.android?.package) problems.push('Mancano ios.bundleIdentifier o android.package in app.json');
else ok.push(`Identificativi: ${app.ios.bundleIdentifier} / ${app.android.package}`);

if (!existsSync(join(root, 'legal-site', 'privacy.html'))) problems.push('Pagine legali non generate: esegui `npm run export:legal`');
else {
  ok.push('Pagine legali generate in legal-site/');
  if (!existsSync(join(root, 'legal-site', 'apri.html'))) problems.push('Manca legal-site/apri.html (pagina dei link condivisi): rigenera con `npm run export:legal`');
  // Nessuna risorsa da Google (Fonts): l'indirizzo IP di chi visita non deve finire a terzi senza consenso.
  const pages = readdirSync(join(root, 'legal-site')).filter((f) => f.endsWith('.html'));
  const external = pages.filter((f) => /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(readFileSync(join(root, 'legal-site', f), 'utf8')));
  if (external.length) problems.push(`legal-site/ carica Google Fonts (${external.join(', ')}): rigenera con \`npm run export:legal\``);
  else ok.push('Pagine del sito senza Google Fonts');
}

// Limiti di caratteri dei testi in store/scheda-store.md (sezione "### Titolo (max N)" → testo sotto).
const listing = readFileSync(join(root, 'store', 'scheda-store.md'), 'utf8');
let tooLong = 0;
for (const m of listing.matchAll(/^### (.+?) \(max (\d+)[^)]*\)\n([\s\S]*?)(?=\n### |\n---|(?![\s\S]))/gm)) {
  const text = m[3].trim();
  if (text.startsWith('(')) continue;
  if (text.length > Number(m[2])) {
    tooLong++;
    problems.push(`store/scheda-store.md → "${m[1]}" ha ${text.length} caratteri, il massimo è ${m[2]}`);
  }
}
if (!tooLong) ok.push('Testi della scheda store entro i limiti di caratteri');
if (listing.includes('<sito>') || listing.includes('<nome del titolare>')) problems.push('store/scheda-store.md contiene ancora <sito> o <nome del titolare>: sostituiscili');

const sa = join(root, 'secrets', 'google-play-service-account.json');
if (!existsSync(sa)) problems.push('Manca secrets/google-play-service-account.json (serve solo per `eas submit` su Android)');
else ok.push('Chiave del service account Google presente');

for (const line of ok) console.log(`✓ ${line}`);
for (const line of problems) console.log(`✗ ${line}`);
console.log(problems.length ? `\n${problems.length} cose da sistemare prima di pubblicare.` : '\nPronto per `eas build`.');
process.exitCode = problems.length ? 1 : 0;
