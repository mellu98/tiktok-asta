#!/usr/bin/env bash
#
# Disinstallazione POC. Non tocca MAI nulla di sistema senza conferma esplicita.
# 1) Rimuove solo gli artefatti generati dal progetto (sempre, in sicurezza).
# 2) Su richiesta esplicita disinstalla anche scrcpy/adb da Homebrew.

set -uo pipefail

GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[0;31m'; BOLD=$'\033[1m'; NC=$'\033[0m'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo ""
echo "${BOLD}════════ Disinstallazione POC Android Device Control ════════${NC}"
echo ""
echo "  1) Pulizia artefatti del progetto (node_modules, build, screenshot, log)"
echo "  2) Anche disinstallazione di scrcpy + adb via Homebrew"
echo "  0) Annulla"
echo ""
printf "Scelta [0-2, default 1]: "
read -r choice
choice="${choice:-1}"

case "$choice" in
  0)
    echo "Annullato."
    exit 0
    ;;
  1)
    echo ""
    echo "Rimuovo artefatti in $REPO_ROOT …"
    rm -rf "$REPO_ROOT/node_modules" "$REPO_ROOT/dist" "$REPO_ROOT/dashboard/dist" \
           "$REPO_ROOT/screenshots" "$REPO_ROOT/logs"
    mkdir -p "$REPO_ROOT/screenshots" "$REPO_ROOT/logs"
    touch "$REPO_ROOT/screenshots/.gitkeep" "$REPO_ROOT/logs/.gitkeep"
    printf '\033[0;32m[✓]\033[0m Artefatti rimossi. Il codice resta intatto.\n' 
    ;;
  2)
    echo ""
    echo "Rimuovo artefatti + pacchetti Homebrew…"
    rm -rf "$REPO_ROOT/node_modules" "$REPO_ROOT/dist" "$REPO_ROOT/dashboard/dist" \
           "$REPO_ROOT/screenshots" "$REPO_ROOT/logs"
    mkdir -p "$REPO_ROOT/screenshots" "$REPO_ROOT/logs"
    touch "$REPO_ROOT/screenshots/.gitkeep" "$REPO_ROOT/logs/.gitkeep"
    for pkg in scrcpy android-platform-tools; do
      if brew list --formula 2>/dev/null | grep -qx "$pkg"; then
        if brew uninstall "$pkg"; then
          printf '%s brew uninstall %s\n' "$(printf '\033[0;32m[✓]\033[0m')" "$pkg"
        else
          printf '\033[0;31m[✗]\033[0m Impossibile rimuovere %s (vedi errore sopra)\n' "$pkg"
        fi
      else
        printf '\033[1;33m[!]\033[0m %s non risulta installato via Homebrew\n' "$pkg"
      fi
    done
    printf '\n\033[1;33mNota:\033[0m Homebrew e Node NON vengono toccati (usati anche da altri progetti).\n' 
    ;;
  *)
    echo "Scelta non valida."
    exit 1
    ;;
esac

echo ""
printf '\033[1mFatto.\033[0m Per reinstallare: \033[1mnpm install && npm run setup && npm run doctor\033[0m\n' 
