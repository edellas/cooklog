/**
 * Cattura gli screenshot per gli store dall'app vera (build web di Expo).
 * Uso: npx expo export --platform web --output-dir dist-web && npx serve dist-web -l 8770
 *      PW=<percorso di playwright> node scripts/store-screenshots.cjs <cartella con foto/video di prova>
 * Dimensioni: iPhone 6,9" 1320x2868 (obbligatoria su App Store), Android 1080x2160.
 */
const { chromium } = require(process.env.PW || 'playwright');
const path = require('path');
const OUT = path.join(__dirname, '..', 'store', 'screenshots');
const MEDIA = process.argv[2];

const DEVICES = [
  { name: 'iphone-6.9', viewport: { width: 440, height: 956 } },
  { name: 'android', viewport: { width: 360, height: 720 } },
];

(async () => {
  const browser = await chromium.launch();
  for (const d of DEVICES) {
    const page = await browser.newPage({ viewport: d.viewport, deviceScaleFactor: 3 });
    const vis = (t) => page.getByText(t, { exact: true }).filter({ visible: true }).first();
    // Nasconde le scritte che esistono solo in modalità demo.
    const clean = () => page.evaluate(() => {
      for (const el of document.querySelectorAll('div')) {
        if (el.childElementCount === 0 && /^(Demo:|Ricomincia la demo)/.test(el.textContent || '')) el.style.visibility = 'hidden';
      }
    });
    const shot = async (n) => { await page.waitForTimeout(900); await clean(); await page.screenshot({ path: path.join(OUT, `${d.name}-${n}.jpg`), type: 'jpeg', quality: 88 }); };
    page.on('filechooser', (fc) => fc.setFiles(['tulipani.jpg', 'palme.jpg', 'ciliegie.jpg'].map((f) => path.join(MEDIA, f))));

    await page.goto('http://localhost:8770/'); await page.waitForTimeout(2500);
    await shot('01-benvenuto');
    await vis('Inizia').click();
    await page.getByPlaceholder('nomeutente').fill('emanuele');
    await page.getByPlaceholder('Nome che vedranno gli altri (facoltativo)').fill('Emanuele');
    await page.getByRole('checkbox').click();
    await vis('Entra').click(); await page.waitForTimeout(3200);
    await shot('02-copertina');
    await vis('Provini').click(); await page.waitForTimeout(2200);
    const box = await page.locator('img').filter({ visible: true }).first().boundingBox().catch(() => null);
    if (box) { await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2.4); await page.waitForTimeout(180); }
    await page.screenshot({ path: path.join(OUT, `${d.name}-03-provini.jpg`), type: 'jpeg', quality: 88 });
    await page.waitForTimeout(900);
    await page.getByLabel('Nuovo post').click(); await page.waitForTimeout(1200);
    await vis('Dalla galleria').click(); await page.waitForTimeout(2500);
    await page.getByPlaceholder('Scrivi una didascalia').fill('Primavera in anticipo nel mio terrazzo.');
    await shot('04-nuovo-post');
    await vis('Pubblica e candida').click(); await page.waitForTimeout(2200);
    await shot('05-in-gara');
    await vis('Fatto').click(); await page.waitForTimeout(900);
    await vis('Archivio').click(); await page.waitForTimeout(1800);
    await shot('06-archivio');
    await vis('Profilo').click(); await page.waitForTimeout(1800);
    await shot('07-profilo');
    await page.close();
  }
  await browser.close();
  console.log('Screenshot salvati in', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
