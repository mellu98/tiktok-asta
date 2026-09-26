#!/usr/bin/env bash
#
# Setup ambiente macOS per il POC Android Device Control.
# Verifica e (su conferma) installa: Homebrew, Node, ADB, scrcpy.
# NON installa mai nulla senza chiedere.

set -uo pipefail

GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[0;31m'; CYAN=$'\033[0;36m'; BOLD=$'\033[1m'; NC=$'\033[0m'
ok()   { printf '  \033[0;32m[✓]\033[0m %s\n' "$1"; }
warn() { printf '  \033[1;33m[!]\033[0m %s\n' "$1"; }
err()  { printf '  \033[0;31m[✗]\033[0m %s\n' "$1"; }
info() { printf '  \033[0;36m[i]\033[0m %s\n' "$1"; }
title(){ printf '\n\033[1m%s\033[0m\n' "$1"; }

INTERACTIVE=0
if [ -t 0 ]; then INTERACTIVE=1; fi

ask_install() {
  # $1 = descrizione, $2 = comando brew
  if [ "$INTERACTIVE" = "1" ]; then
    printf '  \033[1;33m?\033[0m Installare %s ora?\n    comando: \033[1m%s\033[0m\n    [s/N] ' "$1" "$2"
    read -r answer
    case "$answer" in
      s|S|si|SI|y|Y)
        info "Eseguo: $2"
        if eval "$2"; then ok "$1 installato"; else err "Installazione di $1 non riuscita — esegui manualmente: $2"; return 1; fi
        ;;
      *)
        warn "Saltato. Installa manualmente con: $2"
        return 1
        ;;
    esac
  else
    warn "Installa manualmente con: $2"
    return 1
  fi
}

echo ""
echo "${BOLD}════════ Setup POC Android Device Control (macOS) ════════${NC}"

# ── macOS ──────────────────────────────────────────────────────────────────
title "1/5 · Sistema"
if [ "$(uname -s)" != "Darwin" ]; then
  err "Questo script supporta solo macOS. Sistema rilevato: $(uname -s)"
  exit 1
fi
ok "macOS $(sw_vers -productVersion 2>/dev/null || echo '?')"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64)  ok "Apple Silicon (arm64)" ;;
  x86_64) ok "Intel (x86_64)" ;;
  *)      warn "Architettura inattesa: $ARCH" ;;
esac

# Homebrew tipicamente in /opt/homebrew (Apple Silicon) o /usr/local/bin (Intel)
for dir in /opt/homebrew/bin /usr/local/bin; do
  [ -d "$dir" ] && PATH="$dir:$PATH"
done
export PATH

# ── Homebrew ───────────────────────────────────────────────────────────────
title "2/5 · Homebrew"
BREW_MISSING=0
if command -v brew >/dev/null 2>&1; then
  ok "Homebrew $(brew --version | head -1 | awk '{print $2}')"
else
  BREW_MISSING=1
  err "Homebrew NON installato"
  info "Homebrew è il gestore pacchetti usato per installare adb e scrcpy."
  info "Istruzioni ufficiali: https://brew.sh"
  info "Comando: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
  ask_install "Homebrew" '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' || true
  if command -v brew >/dev/null 2>&1; then
    ok "Homebrew ora disponibile"
    BREW_MISSING=0
  else
    BREW_MISSING=1
  fi
fi

# ── Node.js ────────────────────────────────────────────────────────────────
title "3/5 · Node.js (≥ 20)"
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [ "${NODE_MAJOR:-0}" -ge 20 ]; then
    ok "Node $(node --version)"
  else
    warn "Node $(node --version) troppo vecchio: serve ≥ 20"
    ask_install "Node aggiornato via Homebrew" "brew install node" || true
  fi
else
  err "Node NON installato"
  if [ "$BREW_MISSING" = "0" ]; then
    ask_install "Node.js via Homebrew" "brew install node" || true
  else
    info "Installa Node da https://nodejs.org (LTS) oppure installa prima Homebrew."
  fi
fi

# ── ADB ────────────────────────────────────────────────────────────────────
title "4/5 · Android Debug Bridge (adb)"
if command -v adb >/dev/null 2>&1; then
  ok "adb $(adb version 2>/dev/null | head -1 | awk '{print $NF}')"
else
  err "adb NON installato"
  if [ "$BREW_MISSING" = "0" ]; then
    ask_install "Android platform tools (adb)" "brew install android-platform-tools" || true
  else
    info "Dopo aver installato Homebrew: brew install android-platform-tools"
  fi
fi

# ── scrcpy ─────────────────────────────────────────────────────────────────
title "5/5 · scrcpy"
if command -v scrcpy >/dev/null 2>&1; then
  ok "scrcpy $(scrcpy --version 2>/dev/null | head -1 | awk '{print $2}')"
else
  err "scrcpy NON installato"
  if [ "$BREW_MISSING" = "0" ]; then
    ask_install "scrcpy" "brew install scrcpy" || true
  else
    info "Dopo aver installato Homebrew: brew install scrcpy"
  fi
fi

# ── Riepilogo ──────────────────────────────────────────────────────────────
echo ""
printf '\033[1m════════ Riepilogo ════════\033[0m\n' 
for tool in brew node adb scrcpy; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool"
  else
    err "$tool — MANCANTE"
  fi
done

echo ""
if command -v adb >/dev/null 2>&1 && command -v scrcpy >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  printf '\033[0;32m\033[1mSetup completato.\033[0m Prossimo passo: \033[1mnpm run doctor\033[0m\n' 
  info "Poi collega il Samsung via USB (vedi README, sezione «Test rapido Samsung su Mac»)."
  exit 0
else
  printf '\033[0;31m\033[1mSetup incompleto.\033[0m Risolvi le voci mancanti e rilancia: \033[1mnpm run setup\033[0m\n' 
  exit 1
fi
