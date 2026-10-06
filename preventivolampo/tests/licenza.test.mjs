import { test } from "node:test";
import assert from "node:assert/strict";
import { gestisciRichiesta, verificaLicenza, mascheraEmail } from "../lib/licenza.mjs";

const ENV_POLAR = { LICENZE_PROVIDER: "polar", POLAR_ORGANIZATION_ID: "org-1" };
const ENV_LS = { LICENZE_PROVIDER: "lemonsqueezy", LEMONSQUEEZY_STORE_ID: "123" };

const json = (stato, corpo) => async () => new Response(JSON.stringify(corpo), { status: stato });

function req(corpo, metodo = "POST") {
  return new Request("https://x.it/api/licenza", {
    method: metodo,
    headers: { "content-type": "application/json" },
    body: metodo === "POST" ? (typeof corpo === "string" ? corpo : JSON.stringify(corpo)) : undefined,
  });
}

test("polar: codice valido", async () => {
  let chiamata;
  const f = async (url, init) => {
    chiamata = { url, body: JSON.parse(init.body) };
    return new Response(
      JSON.stringify({
        status: "granted",
        expires_at: null,
        benefit_id: "b1",
        customer: { email: "mario@example.com" },
      }),
      { status: 200 },
    );
  };
  const r = await verificaLicenza("ABCD-1234-EFGH", ENV_POLAR, f);
  assert.equal(r.valida, true);
  assert.equal(r.email, "m***@example.com");
  assert.equal(chiamata.url, "https://api.polar.sh/v1/customer-portal/license-keys/validate");
  assert.deepEqual(chiamata.body, { key: "ABCD-1234-EFGH", organization_id: "org-1" });
});

test("polar: sandbox, revocato, scaduto, inesistente, benefit sbagliato", async () => {
  let url;
  await verificaLicenza("ABCD-1234", { ...ENV_POLAR, POLAR_SANDBOX: "true" }, async (u) => {
    url = u;
    return new Response(JSON.stringify({ status: "granted" }), { status: 200 });
  });
  assert.match(url, /^https:\/\/sandbox-api\.polar\.sh/);
  assert.equal((await verificaLicenza("ABCD-1234", ENV_POLAR, json(200, { status: "revoked" }))).valida, false);
  assert.equal(
    (
      await verificaLicenza(
        "ABCD-1234",
        ENV_POLAR,
        json(200, { status: "granted", expires_at: "2020-01-01T00:00:00Z" }),
      )
    ).valida,
    false,
  );
  assert.equal((await verificaLicenza("ABCD-1234", ENV_POLAR, json(404, { detail: "nf" }))).valida, false);
  const altro = await verificaLicenza(
    "ABCD-1234",
    { ...ENV_POLAR, POLAR_BENEFIT_IDS: "b1, b2" },
    json(200, { status: "granted", benefit_id: "b9" }),
  );
  assert.equal(altro.valida, false);
  const giusto = await verificaLicenza(
    "ABCD-1234",
    { ...ENV_POLAR, POLAR_BENEFIT_IDS: "b1, b2" },
    json(200, { status: "granted", benefit_id: "b2" }),
  );
  assert.equal(giusto.valida, true);
});

test("lemon squeezy: accetta solo codici del proprio negozio", async () => {
  const buono = {
    valid: true,
    license_key: { status: "active", expires_at: null },
    meta: { store_id: 123, customer_email: "a@b.it" },
  };
  assert.equal((await verificaLicenza("ABCD-1234", ENV_LS, json(200, buono))).valida, true);
  const altroNegozio = { ...buono, meta: { store_id: 999 } };
  assert.equal((await verificaLicenza("ABCD-1234", ENV_LS, json(200, altroNegozio))).valida, false);
  const disattivato = { ...buono, license_key: { status: "disabled" } };
  assert.equal((await verificaLicenza("ABCD-1234", ENV_LS, json(200, disattivato))).valida, false);
  assert.equal(
    (await verificaLicenza("ABCD-1234", ENV_LS, json(400, { valid: false, error: "license_key not found" }))).valida,
    false,
  );
});

test("handler HTTP: metodi, input non validi, errori del provider", async () => {
  assert.equal((await gestisciRichiesta(req(null, "GET"), ENV_POLAR)).status, 405);
  assert.equal((await gestisciRichiesta(req(null, "OPTIONS"), ENV_POLAR)).status, 204);
  assert.equal((await gestisciRichiesta(req("non json"), ENV_POLAR)).status, 400);
  assert.equal((await gestisciRichiesta(req({ chiave: "corta" }), ENV_POLAR)).status, 400);
  assert.equal((await gestisciRichiesta(req({ chiave: "<script>alert(1)</script>" }), ENV_POLAR)).status, 400);

  const ok = await gestisciRichiesta(req({ chiave: "ABCD-1234-EFGH" }), ENV_POLAR, json(200, { status: "granted" }));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).valida, true);
  assert.equal(ok.headers.get("cache-control"), "no-store");

  const no = await gestisciRichiesta(req({ chiave: "ABCD-1234-EFGH" }), ENV_POLAR, json(404, {}));
  assert.equal(no.status, 200);
  assert.equal((await no.json()).valida, false);

  const giu = await gestisciRichiesta(req({ chiave: "ABCD-1234-EFGH" }), ENV_POLAR, json(500, {}));
  assert.equal(giu.status, 503);

  const nonConfigurato = await gestisciRichiesta(req({ chiave: "ABCD-1234-EFGH" }), {}, json(200, {}));
  assert.equal(nonConfigurato.status, 503);
});

test("mascheraEmail", () => {
  assert.equal(mascheraEmail("mario.rossi@gmail.com"), "m***@gmail.com");
  assert.equal(mascheraEmail(""), "");
  assert.equal(mascheraEmail("senza-chiocciola"), "");
});
