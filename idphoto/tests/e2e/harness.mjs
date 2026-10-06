// Quick visual harness: node tests/e2e/harness.mjs <fixture> [spec] [keep]
import { chromium } from 'playwright';
import { startServer } from '../../scripts/serve.mjs';
const [img = 'portrait-office.jpg', spec = 'it-cie', keep = ''] = process.argv.slice(2);
const server = await startServer({ port: 0, extraStatic: { '/fixtures/': 'tests/e2e/fixtures/', '/harness.html': 'tests/e2e/harness.html' } });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => console.log('[browser]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${server.url}/harness.html?img=/fixtures/${img}&spec=${spec}${keep ? '&keep=1' : ''}`);
await page.waitForFunction(() => document.title === 'done', null, { timeout: 120000 });
console.log(JSON.stringify(await page.evaluate(() => window.__result), null, 1));
await page.screenshot({ path: `tests/e2e/out/harness-${img}-${spec}.png`, fullPage: true });
await browser.close();
server.close();
