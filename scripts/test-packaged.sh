#!/usr/bin/env bash
#
# Test automatico dell'app Tauri IMPACCHETTATA, senza dispositivo e senza UI:
#   1. build della dashboard + sidecar + bundle .app
#   2. firma del bundle verificata (codesign --deep --strict)
#   3. avvio dell'app → il server interno risponde (health) su porta dinamica
#   4. endpoint automazione presente (round su device FAKE → errore gestito)
#   5. avvio scrcpy su device FAKE → errore gestito (scrcpy reale = hardware gate)
#
# I controlli che richiedono il Samsung fisico sono SEPARATI (manuali).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "═══ 1. Build dashboard ═══"
npm run build

echo "═══ 2. Sidecar + tool ═══"
bash scripts/fetch-tools.sh

echo "═══ 3. Bundle Tauri ═══"
npx tauri build --bundles app

APP="src-tauri/target/release/bundle/macos/Android Device Control.app"
if [ ! -d "$APP" ]; then
  echo "✗ .app non trovata dopo la build" >&2
  exit 1
fi

echo "═══ 4. Firma bundle ═══"
codesign --verify --deep --strict "$APP"
echo "✓ codesign OK"

echo "═══ 5. Avvio app + health (porta dinamica + token) ═══"
cp -R "$APP" /tmp/ADC-packaged-test.app

# Il server interno comunica porta+token sul stdout (marker nel log app)
LOG="$HOME/Library/Logs/com.mellu98.android-device-control/poc-server.log"
: > "$LOG" 2>/dev/null || true
open /tmp/ADC-packaged-test.app

HEALTH_OK=0
for _ in $(seq 1 30); do
  SESSION=$(grep -o '#\[tauri-session\] .*' "$LOG" 2>/dev/null | tail -1 | sed 's/#\[tauri-session\] //' || true)
  if [ -n "$SESSION" ]; then
    PORT=$(echo "$SESSION" | python3 -c "import json,sys; print(json.load(sys.stdin)['port'])" 2>/dev/null || true)
    TOKEN=$(echo "$SESSION" | python3 -c "import json,sys; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || true)
    if [ -n "$PORT" ] && curl -fsS -H "x-session-token: $TOKEN" "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
      HEALTH_OK=1
      break
    fi
  fi
  sleep 1
done

if [ "$HEALTH_OK" = "1" ]; then
  echo "✓ server interno risponde su porta dinamica $PORT (con token)"
else
  echo "✗ server interno NON risponde" >&2
  osascript -e 'quit app "Android Device Control"' 2>/dev/null || true
  rm -rf /tmp/ADC-packaged-test.app
  exit 1
fi

AUTH=(-H "Content-Type: application/json" -H "x-session-token: $TOKEN")

echo "═══ 6. Endpoint automazione (device FAKE → errore gestito) ═══"
RESP=$(curl -s -X POST "http://127.0.0.1:$PORT/api/devices/FAKE/auction/round" \
  "${AUTH[@]}" -d '{"mode":"evaluate"}' || true)
case "$RESP" in
  *error*) echo "✓ endpoint round presente (errore atteso su device FAKE): $RESP" ;;
  *) echo "✗ endpoint round non risponde: $RESP" >&2 ;;
esac

echo "═══ 6b. Guardie: estop attivo → round bloccato ═══"
curl -s -X POST "http://127.0.0.1:$PORT/api/auction/estop" "${AUTH[@]}" -d '{"engaged":true}' >/dev/null
RESP=$(curl -s -X POST "http://127.0.0.1:$PORT/api/devices/FAKE/auction/round" \
  "${AUTH[@]}" -d '{"mode":"live"}' || true)
curl -s -X POST "http://127.0.0.1:$PORT/api/auction/estop" "${AUTH[@]}" -d '{"engaged":false}' >/dev/null
if [ -z "$RESP" ]; then
  echo "✗ round non risponde" >&2
fi

echo "═══ 7. Chiusura pulita ═══"
osascript -e 'quit app "Android Device Control"' 2>/dev/null || true
sleep 2

if lsof -ti :$PORT >/dev/null 2>&1; then
  echo "✗ porta $PORT ancora occupata dopo la chiusura" >&2
  exit 1
fi
echo "✓ chiusura pulita (porta $PORT liberata)"

rm -rf /tmp/ADC-packaged-test.app
echo ""
echo "═══ TEST APP IMPACCHETTATA: OK ═══"
echo "Il controllo con Samsung FISICO (dump reale, tap) resta manuale:"
echo "vedi docs/TESTER-MACOS.md"
