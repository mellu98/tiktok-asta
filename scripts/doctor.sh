#!/usr/bin/env bash
#
# Doctor: diagnostica sola lettura dell'ambiente POC.
# Esci con 0 = ambiente pronto; 1 = manca qualcosa di essenziale.
# Un dispositivo NON collegato è un WARN (ambiente comunque pronto), non un errore.

set -uo pipefail

GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[0;31m'; CYAN=$'\033[0;36m'; BOLD=$'\033[1m'; NC=$'\033[0m'
ok()   { printf '\033[0;32m[✓]\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$1"; }
err()  { printf '\033[0;31m[✗]\033[0m %s\n' "$1"; }
info() { printf '\033[0;36m[i]\033[0m %s\n' "$1"; }

FAIL=0

for dir in /opt/homebrew/bin /usr/local/bin; do
  [ -d "$dir" ] && PATH="$dir:$PATH"
done
export PATH

echo ""
echo "${BOLD}Android Device Doctor${NC}"
echo "────────────────────────────────────────────"

# 1. macOS
if [ "$(uname -s)" = "Darwin" ]; then
  ok "macOS detected ($(sw_vers -productVersion 2>/dev/null || echo '?'))"
else
  err "$(uname -s) rilevato — questo POC supporta macOS. Ferma qui."
  exit 1
fi

# 2. Architettura
case "$(uname -m)" in
  arm64)  ok "Apple Silicon" ;;
  x86_64) ok "Intel Mac" ;;
  *)      warn "Architettura sconosciuta: $(uname -m)" ;;
esac

# 3. Homebrew
if command -v brew >/dev/null 2>&1; then
  ok "Homebrew detected"
else
  err "Homebrew NON presente — installa da https://brew.sh poi rilancia"
  FAIL=1
fi

# 4. Node
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${NODE_MAJOR:-0}" -ge 20 ]; then
    ok "Node detected ($(node --version))"
  else
    err "Node $(node --version) troppo vecchio — serve ≥ 20 (brew install node)"
    FAIL=1
  fi
else
  err "Node NON presente — brew install node (o LTS da https://nodejs.org)"
  FAIL=1
fi

# 5. ADB
ADB_OK=0
if command -v adb >/dev/null 2>&1; then
  ok "ADB detected ($(adb version 2>/dev/null | head -1))"
  ADB_OK=1
else
  err "ADB NON presente — brew install android-platform-tools"
  FAIL=1
fi

# 6. scrcpy
if command -v scrcpy >/dev/null 2>&1; then
  ok "scrcpy detected ($(scrcpy --version 2>/dev/null | head -1))"
else
  err "scrcpy NON presente — brew install scrcpy"
  FAIL=1
fi

if [ "$FAIL" = "1" ]; then
  echo "────────────────────────────────────────────"
  printf '\033[0;31m\033[1mNOT READY\033[0m — installa ciò che manca (vedi [✗]) e rilancia: \033[1mnpm run doctor\033[0m\n' 
  info "Puoi usare: npm run setup (ti guida all'installazione)"
  exit 1
fi

# ── Check dispositivo (solo WARN: il tester può lanciare doctor prima di collegare il telefono)
if [ "$ADB_OK" = "1" ]; then
  adb start-server >/dev/null 2>&1
  LIST="$(adb devices -l 2>/dev/null | tail -n +2 | grep -v '^[[:space:]]*$' || true)"
  DEVICE_ROWS="$(echo "$LIST" | grep -v '\*\*\*' || true)"

  if [ -z "$DEVICE_ROWS" ]; then
    warn "Nessun dispositivo Android rilevato"
    info "1. Collega il Samsung via USB"
    info "2. Attiva: Impostazioni → Opzioni sviluppatore → Debug USB"
    info "3. Sblocca lo schermo e accetta «Consentire debug USB?»"
    info "4. Rilancia: npm run doctor"
    echo "────────────────────────────────────────────"
    printf '\033[0;32m\033[1mAMBIENTE PRONTO\033[0m \033[1;33m(nessun telefono collegato)\033[0m\n' 
    exit 0
  fi

  COUNT=0
  UNAUTHORIZED=0
  while IFS= read -r row; do
    [ -z "$row" ] && continue
    COUNT=$((COUNT + 1))
    SERIAL="$(echo "$row" | awk '{print $1}')"
    STATE="$(echo "$row" | awk '{print $2}')"
    MODEL="$(echo "$row" | grep -o 'model:[^ ]*' | cut -d: -f2 || true)"
    if [ "$STATE" = "device" ]; then
      ok "Dispositivo ${MODEL:-$SERIAL} ($SERIAL)"
      # Leggi il modello reale via getprop (più leggibile di model:SM_X_Y_Z)
      REAL_MODEL="$(adb -s "$SERIAL" shell getprop ro.product.marketname 2>/dev/null | tr -d '[:space:]')"
      REAL_MODEL2="$(adb -s "$SERIAL" shell getprop ro.product.model 2>/dev/null | tr -d '[:space:]')"
      [ -n "$REAL_MODEL" ] && ok "Modello: $REAL_MODEL" || { [ -n "$REAL_MODEL2" ] && ok "Modello: $REAL_MODEL2"; }
      ok "USB debugging authorized"
    elif [ "$STATE" = "unauthorized" ]; then
      UNAUTHORIZED=1
      warn "Dispositivo rilevato ma NON autorizzato ($SERIAL)"
      info "Sul telefono: tocca «Consenti sempre da questo computer» nella richiesta «Consentire debug USB?»"
    elif [ "$STATE" = "offline" ]; then
      warn "Dispositivo offline ($SERIAL)"
      info "Scollega e ricollega il cavo USB, oppure: adb kill-server && adb start-server"
    else
      warn "Dispositivo in stato $STATE ($SERIAL)"
    fi
  done <<< "$DEVICE_ROWS"

  if [ "$COUNT" -gt 1 ]; then
    ok "$COUNT dispositivi rilevati (multi-device supportato)"
  fi

  if [ "$UNAUTHORIZED" = "1" ]; then
    echo "────────────────────────────────────────────"
    printf '\033[1;33m\033[1mQUASI PRONTO\033[0m — autorizza il debug USB sul telefono, poi rilancia il doctor\n' 
    exit 0
  fi

  echo "────────────────────────────────────────────"
  printf '\033[0;32m\033[1mREADY\033[0m — avvia la dashboard con: \033[1mnpm run dev\033[0m\n' 
  exit 0
fi
