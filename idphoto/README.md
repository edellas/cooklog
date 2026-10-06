# Fototessera online (prototipo in pausa)

Prototipo scartato a favore dei test in `../launch-test/`. Funziona solo il motore, che gira tutto nel
browser:
- riconoscimento del volto;
- scontorno dello sfondo;
- ritaglio secondo le norme (CIE, passaporto, visti USA/UK/Cina, DNI...);
- foglio di stampa 10×15 cm.

Mancano interfaccia, pagine e pagamenti.

Per provarlo: `npm install && npm run fetch-models`, poi `node tests/e2e/harness.mjs <foto> <spec>`
(con Playwright installato e una foto di prova in `tests/e2e/fixtures/`).
