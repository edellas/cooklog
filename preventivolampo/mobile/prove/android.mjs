// Prova dell'app Android vera, installata su un emulatore (la lancia GitHub Actions, vedi
// .github/workflows/preventivolampo.yml). Playwright si collega alla WebView dell'app (nelle build di debug
// Capacitor la rende ispezionabile) e fa quello che farebbe un artigiano, chiamando i plugin veri.
// Uso: adb install -r android/app/build/outputs/apk/debug/app-debug.apk && node prove/android.mjs
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}
const { _android: android } = playwright;
const PACCHETTO = "it.preventivolampo.app";
const cartella = path.join(path.dirname(fileURLToPath(import.meta.url)), "foto");
mkdirSync(cartella, { recursive: true });

const [device] = await android.devices();
if (!device) throw new Error("Nessun emulatore collegato (adb devices)");
console.log("Telefono:", device.model(), device.serial());
const foto = (nome) => device.screenshot({ path: path.join(cartella, `${nome}.png`) });
const passo = async (nome, fn) => {
  await fn();
  console.log("ok -", nome);
};

async function webview() {
  const w = await device.webView({ pkg: PACCHETTO }, { timeout: 120000 });
  const p = await w.page();
  p.setDefaultTimeout(60000);
  return p;
}

await device.shell(`am force-stop ${PACCHETTO}`);
await device.shell(`pm clear ${PACCHETTO}`);
await device.shell(`pm grant ${PACCHETTO} android.permission.POST_NOTIFICATIONS`).catch(() => {});
await device.shell(`am start -W -n ${PACCHETTO}/.MainActivity`);
let page = await webview();
const errori = [];
page.on("pageerror", (e) => errori.push("JS: " + e.message));
page.on("crash", () => errori.push("La WebView si è chiusa da sola (crash)"));
page.on("close", () => console.log("(la pagina della WebView si è chiusa)"));

// Dopo aver scritto in un campo la tastiera resta aperta e copre i pulsanti in basso (com'è giusto):
// come farebbe l'artigiano, la si chiude con il tasto Indietro prima di toccarli.
const misura = () =>
  page.evaluate(() => {
    const v = globalThis.visualViewport;
    const b = (
      document.querySelector(".barra-totale") || document.querySelector("body:not(.no-tabbar) .tabbar")
    )?.getBoundingClientRect();
    const css = globalThis.getComputedStyle(document.documentElement);
    return {
      attivo: document.activeElement?.tagName,
      finestra: globalThis.innerHeight,
      visibile: v && { alto: v.offsetTop, altezza: v.height, scala: v.scale },
      barra: b && { top: b.top, bottom: b.bottom },
      margini: ["top", "bottom"].map((l) => css.getPropertyValue(`--safe-area-inset-${l}`).trim() || "-").join("/"),
    };
  });
const tastieraAperta = async () =>
  /mInputShown=true|mIsInputViewShown=true/.test((await device.shell("dumpsys input_method")).toString());

async function chiudiTastiera() {
  console.log("  con la tastiera:", JSON.stringify(await misura()));
  if (await tastieraAperta()) await device.shell("input keyevent KEYCODE_BACK");
  // la barra in basso deve tornare tutta visibile, sopra la barra di sistema
  await page
    .waitForFunction(
      () => {
        const v = globalThis.visualViewport;
        const b = (
          document.querySelector(".barra-totale") || document.querySelector("body:not(.no-tabbar) .tabbar")
        )?.getBoundingClientRect();
        return !v || !b || b.bottom <= v.offsetTop + v.height + 1;
      },
      null,
      { timeout: 15000 },
    )
    .catch(async () => {
      throw new Error("La barra in basso resta nascosta: " + JSON.stringify(await misura()));
    });
  console.log("  senza tastiera:", JSON.stringify(await misura()));
  await page.waitForTimeout(400);
}

// I plugin veri, chiamati come li chiama l'app.
const plugin = (nome, metodo, opzioni) =>
  page.evaluate(
    async ([n, m, o]) => {
      const { Capacitor } = await import("/vendor/capacitor-core.js");
      if (!Capacitor.isPluginAvailable(n)) return { manca: n };
      const p = Capacitor.Plugins[n] || Capacitor.registerPlugin(n);
      const r = await p[m](o);
      return JSON.parse(JSON.stringify(r ?? null));
    },
    [nome, metodo, opzioni],
  );

try {
  await passo("l'app si apre sul benvenuto, dentro il guscio nativo", async () => {
    await page.waitForSelector("text=Che lavoro fai?");
    const info = await page.evaluate(() => ({
      nativa: Boolean(window.Capacitor?.isNativePlatform?.()),
      piattaforma: window.Capacitor?.getPlatform?.(),
      origine: location.origin,
      classe: document.documentElement.className,
    }));
    console.log(info);
    assert.equal(info.nativa, true);
    assert.equal(info.piattaforma, "android");
    assert.match(info.classe, /nativa-android/);
    await foto("01-benvenuto");
  });

  await passo("primo preventivo e link per il cliente sul sito pubblico", async () => {
    await page.click('[data-m="idraulico"]');
    await page.click('[data-action="onb-avanti"]');
    await page.fill("#b-nome", "Idraulica Rossi di Mario Rossi");
    await page.fill("#b-tel", "333 1234567");
    await page.check('input[name="b-iva"][value="10"]');
    await page.click('[data-action="onb-dati"]');
    await page.click('[data-action="fine-benvenuto"][data-modo="esempio"]');
    await page.waitForSelector('[data-action="invia"]');
    await page.fill('[data-campo="cliente.nome"]', "Giulia Bianchi");
    await page.fill('[data-campo="cliente.telefono"]', "347 7654321");
    await page.waitForTimeout(800);
    await foto("02-editor");
    await chiudiTastiera();
    await page.click('[data-action="invia"]');
    await page.waitForSelector("#invio-wa");
    const href = await page.getAttribute("#invio-wa", "href");
    const link = new URL(href).searchParams.get("text").match(/https?:\/\/\S+/)[0];
    assert.ok(link.startsWith("https://preventivolampo.it/accetta.html#z"), link);
    await page.waitForTimeout(600);
    await foto("03-invio");
  });

  await passo("plugin del telefono: file, notifiche, schermata di avvio", async () => {
    const scritto = await plugin("Filesystem", "writeFile", {
      path: "prova.txt",
      data: "ciao",
      directory: "DATA",
      encoding: "utf8",
    });
    assert.match(scritto.uri, /^file:\/\//);
    const letto = await plugin("Filesystem", "readFile", { path: "prova.txt", directory: "DATA", encoding: "utf8" });
    assert.equal(letto.data, "ciao");
    const notifiche = await plugin("LocalNotifications", "checkPermissions");
    assert.ok(
      ["granted", "denied", "prompt", "prompt-with-rationale"].includes(notifiche.display),
      JSON.stringify(notifiche),
    );
    // la copia di sicurezza automatica dei dati è stata scritta nella memoria dell'app
    await page.waitForTimeout(3500);
    const copia = await plugin("Filesystem", "readFile", {
      path: "preventivolampo-copia-1.json",
      directory: "LIBRARY",
      encoding: "utf8",
    });
    assert.equal(JSON.parse(copia.data).app, "preventivolampo");
  });

  await passo("firma al tavolo: la pagina del cliente si apre dentro l'app", async () => {
    await page.click('[data-action="chiudi-foglio"]');
    await page.waitForSelector("#foglio", { state: "detached" });
    await page.click('[data-action="invia"]');
    await page.waitForSelector(".invio-tavolo");
    await page.waitForTimeout(500);
    await page.click(".invio-tavolo");
    await page.waitForURL(/accetta\.html\?presenta=1#z/);
    await page.waitForSelector('[data-azione="accetta"]');
    await page.waitForTimeout(800);
    await foto("04-tavolo");
    // il tasto Indietro di Android riporta all'app
    await device.shell("input keyevent KEYCODE_BACK");
    await page.waitForURL(/index\.html|\/#\/p\//);
    await page.waitForSelector('[data-action="invia"]');
  });

  await passo("link dell'app (preventivolampo://) aperto da fuori", async () => {
    await device.shell(
      `am start -W -a android.intent.action.VIEW -d "preventivolampo://app.html#/accettazione?d=zAAAA" ${PACCHETTO}`,
    );
    await page.waitForSelector("text=Conferma non leggibile");
    await foto("05-link");
  });

  assert.deepEqual(errori, [], errori.join("\n"));
  console.log("\nApp Android: tutte le prove superate.");
} catch (err) {
  await foto("errore").catch(() => {});
  console.error("FALLITO:", err.message, "\n" + errori.join("\n"));
  // Gli ultimi messaggi di Android sull'app (WebView, Capacitor, errori), per capire cosa è successo.
  let log = "";
  try {
    log = execSync("adb logcat -d -t 3000", { maxBuffer: 64 * 1024 * 1024 }).toString();
  } catch (e) {
    log = "logcat non disponibile: " + e.message;
  }
  console.error(
    log
      .split("\n")
      .filter((r) => /Capacitor|chromium|cr_|AndroidRuntime|preventivolampo|WebView|FATAL/i.test(r))
      .slice(-120)
      .join("\n"),
  );
  process.exitCode = 1;
} finally {
  await device.close();
}
