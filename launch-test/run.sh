#!/usr/bin/env bash
# Installs MiroFish (once), starts its backend and runs every concept in concepts/.
# Keys are read from the environment, never written to disk:
#   LLM_API_KEY, LLM_BASE_URL, LLM_MODEL_NAME  (any OpenAI-compatible API)
#   ZEP_API_KEY                                (Zep Cloud, free tier is enough)
# Usage: ./run.sh [concept-folder ...]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MF_DIR="${MIROFISH_DIR:-$HERE/.mirofish}"
MF_COMMIT="7657031ac01184afe2cb220f5ee3545573b5e843" # version this kit was written against
PORT="${FLASK_PORT:-5001}"

: "${LLM_API_KEY:?Imposta LLM_API_KEY (vedi README.md)}"
: "${ZEP_API_KEY:?Imposta ZEP_API_KEY (vedi README.md)}"
export LLM_BASE_URL="${LLM_BASE_URL:-https://dashscope-intl.aliyuncs.com/compatible-mode/v1}"
export LLM_MODEL_NAME="${LLM_MODEL_NAME:-qwen-plus}"

if [ ! -d "$MF_DIR/.git" ]; then
  echo ">> Scarico MiroFish..."
  git clone https://github.com/666ghj/MiroFish "$MF_DIR"
  git -C "$MF_DIR" checkout -q "$MF_COMMIT"
fi

# Italian locale: MiroFish only ships zh/en translation files, and any other
# language silently falls back to Chinese. Add "it" (UI strings copied from en).
if [ ! -f "$MF_DIR/locales/it.json" ]; then
  cp "$MF_DIR/locales/en.json" "$MF_DIR/locales/it.json"
  python3 - "$MF_DIR/locales/languages.json" <<'PY'
import json, sys
path = sys.argv[1]
langs = json.load(open(path, encoding="utf-8"))
langs["it"] = {"label": "Italiano", "llmInstruction": "Rispondi sempre in italiano."}
json.dump(langs, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
PY
fi

if [ ! -x "$MF_DIR/backend/.venv/bin/python" ]; then
  echo ">> Installo le dipendenze di MiroFish (circa 6 GB, 5-15 minuti)..."
  command -v uv >/dev/null || pip install --user uv
  (cd "$MF_DIR/backend" && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt)
fi

echo ">> Avvio il backend di MiroFish sulla porta $PORT..."
mkdir -p "$HERE/results"
(cd "$MF_DIR/backend" && FLASK_PORT="$PORT" FLASK_HOST=127.0.0.1 .venv/bin/python run.py >"$HERE/results/backend.log" 2>&1) &
BACKEND_PID=$!
trap 'kill $BACKEND_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  if curl -fs "http://127.0.0.1:$PORT/health" >/dev/null; then break; fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Il backend non è partito, vedi results/backend.log"; tail -20 "$HERE/results/backend.log"; exit 1
  fi
  sleep 2
done

MIROFISH_URL="http://127.0.0.1:$PORT" python3 "$HERE/mirofish_runner.py" "$@"
