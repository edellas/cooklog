#!/usr/bin/env bash
# Prova dell'app iOS vera nel simulatore (la lancia GitHub Actions su macOS, vedi
# .github/workflows/preventivolampo.yml): installa l'app compilata, la apre, apre un link dell'app
# (preventivolampo://) e legge lo schermo con l'OCR di macOS per controllare cosa compare davvero.
# Uso (in mobile/, dopo la compilazione per il simulatore in build/): bash prove/ios.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PACCHETTO="it.preventivolampo.app"
APP="build/Build/Products/Debug-iphonesimulator/App.app"
FOTO="prove/foto"
mkdir -p "$FOTO"
test -d "$APP" || { echo "Manca $APP: compila prima per il simulatore"; exit 1; }

# Il primo iPhone disponibile nel simulatore.
DISPOSITIVO=$(xcrun simctl list devices available -j | python3 -c '
import json, sys
dati = json.load(sys.stdin)["devices"]
for runtime, lista in sorted(dati.items(), reverse=True):
    if "iOS" not in runtime:
        continue
    for d in lista:
        if d["name"].startswith("iPhone"):
            print(d["udid"]); sys.exit(0)
sys.exit(1)')
echo "Simulatore: $DISPOSITIVO"
xcrun simctl boot "$DISPOSITIVO" 2>/dev/null || true
xcrun simctl bootstatus "$DISPOSITIVO" -b
xcrun simctl install "$DISPOSITIVO" "$APP"

leggi() { swift prove/testo.swift "$1"; }
aspetta_testo() { # aspetta_testo <atteso> <nome foto>
  for i in $(seq 1 30); do
    xcrun simctl io "$DISPOSITIVO" screenshot "$FOTO/$2.png" >/dev/null 2>&1
    if leggi "$FOTO/$2.png" | grep -qi "$1"; then echo "ok - $2: trovato «$1»"; return 0; fi
    sleep 2
  done
  echo "FALLITO - $2: non trovo «$1». Sullo schermo:"; leggi "$FOTO/$2.png"; return 1
}

xcrun simctl launch "$DISPOSITIVO" "$PACCHETTO"
aspetta_testo "lavoro fai" "01-benvenuto"

# Un link dell'app aperto da fuori (come il pulsante «Apri nell'app» della pagina web).
xcrun simctl openurl "$DISPOSITIVO" "preventivolampo://app.html#/accettazione?d=zAAAA"
aspetta_testo "non leggibile" "02-link"

# Riaperta dopo la chiusura, l'app riparte (dati e WebView a posto).
xcrun simctl terminate "$DISPOSITIVO" "$PACCHETTO"
xcrun simctl launch "$DISPOSITIVO" "$PACCHETTO"
aspetta_testo "lavoro fai" "03-riavvio"

echo "App iOS: tutte le prove superate."
