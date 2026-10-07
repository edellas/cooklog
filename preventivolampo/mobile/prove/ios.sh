#!/usr/bin/env bash
# Prova dell'app iOS vera nel simulatore (la lancia GitHub Actions su macOS, vedi
# .github/workflows/preventivolampo.yml): installa l'app compilata, la apre, la usa con tocchi veri sullo
# schermo (idb) e legge lo schermo con l'OCR di macOS per controllare cosa compare davvero.
# Uso (in mobile/, dopo la compilazione per il simulatore in build/ e con idb installato): bash prove/ios.sh
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

# L'OCR si compila una volta sola: interpretato, swift impiega secondi a ogni lettura.
swiftc -O prove/testo.swift -o build/testo
leggi() { build/testo "$@"; }

# Grandezza dello schermo in punti, l'unità dei tocchi di idb.
read -r LARGO ALTO < <(idb describe --udid "$DISPOSITIVO" --json | python3 -c '
import json, sys
s = json.load(sys.stdin)["screen_dimensions"]
d = s.get("density") or 1
print(s.get("width_points") or s["width"] / d, s.get("height_points") or s["height"] / d)')
[ -n "${LARGO:-}" ] || { echo "idb non risponde: installa idb-companion e fb-idb"; exit 1; }
echo "Schermo: $LARGO x $ALTO punti"

# Se una prova fallisce: cosa c'è sullo schermo e gli ultimi messaggi dell'app (console JS compresa).
diagnosi() {
  echo "Sullo schermo:"; leggi "$FOTO/$1.png" || true
  echo "Messaggi dell'app:"
  xcrun simctl spawn "$DISPOSITIVO" log show --last 3m --style compact \
    --predicate 'process == "App"' 2>/dev/null | tail -n 150 || true
}
foto() { xcrun simctl io "$DISPOSITIVO" screenshot "$FOTO/$1.png" >/dev/null 2>&1 || true; }
aspetta_testo() { # aspetta_testo <atteso> <nome foto>
  for _ in $(seq 1 45); do
    foto "$2"
    if leggi "$FOTO/$2.png" 2>/dev/null | grep -qi "$1"; then echo "ok - $2: trovato «$1»"; return 0; fi
    sleep 2
  done
  echo "FALLITO - $2: non trovo «$1»."; diagnosi "$2"; return 1
}
tocca() { # tocca <scritta> <nome foto>: tocca la scritta sullo schermo con un dito
  local punto=""
  for _ in $(seq 1 20); do
    foto "$2"
    if punto=$(leggi "$FOTO/$2.png" "$1" 2>/dev/null); then break; fi
    sleep 1
  done
  [ -n "$punto" ] || { echo "FALLITO - $2: non trovo «$1» da toccare."; diagnosi "$2"; return 1; }
  read -r nx ny <<<"$punto"
  idb ui tap --udid "$DISPOSITIVO" \
    "$(python3 -c "print(round($nx * $LARGO))")" "$(python3 -c "print(round($ny * $ALTO))")"
  echo "ok - $2: toccato «$1»"
  sleep 1
}

xcrun simctl launch "$DISPOSITIVO" "$PACCHETTO"
aspetta_testo "lavoro fai" "01-benvenuto"

# Tocchi veri nella WebView: si sceglie il mestiere e si passa al secondo passo.
tocca "Idraulico" "02-mestiere"
tocca "Avanti" "03-avanti"
aspetta_testo "Passo 2 di 3" "04-passo-2"

# Un link dell'app aperto da fuori (come il pulsante «Apri nell'app» della pagina web). iOS chiede prima
# se aprirlo nell'app: si tocca «Apri».
xcrun simctl openurl "$DISPOSITIVO" "preventivolampo://app.html#/accettazione?d=zAAAA"
for _ in $(seq 1 20); do
  foto "05-domanda"
  if leggi "$FOTO/05-domanda.png" | grep -qiE "^(open|apri)$"; then
    tocca "$(leggi "$FOTO/05-domanda.png" | grep -iE "^(open|apri)$" | head -n 1)" "05-domanda"
    break
  fi
  if leggi "$FOTO/05-domanda.png" | grep -qi "non leggibile"; then break; fi
  sleep 1
done
aspetta_testo "non leggibile" "06-link"

# Riaperta dopo la chiusura, l'app riparte (dati e WebView a posto).
xcrun simctl terminate "$DISPOSITIVO" "$PACCHETTO"
xcrun simctl launch "$DISPOSITIVO" "$PACCHETTO"
aspetta_testo "lavoro fai" "07-riavvio"

echo "App iOS: tutte le prove superate."
