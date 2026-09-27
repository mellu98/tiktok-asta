#!/usr/bin/env bash
#
# Prepara gli artefatti necessari alla build dell'app Tauri:
#   1. adb (platform-tools ufficiali Google, zip darwin)
#   2. scrcpy (release ufficiali GitHub, con verifica SHA256)
#   3. sidecar del server Node compilato in binario standalone (bun --compile)
#
# Sorgenti SOLO ufficiali: dl.google.com + github.com/Genymobile/scrcpy/releases.
# Lo script è idempotente: ricrea sempre artefatti puliti.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="$REPO_ROOT/src-tauri/resources/tools"
BINARIES_DIR="$REPO_ROOT/src-tauri/binaries"
SCRCPY_VERSION="${SCRCPY_VERSION:-4.1}"
SCRCPY_TAG="v${SCRCPY_VERSION}"

ARCH="$(uname -m)"
case "$ARCH" in
arm64)
  RUST_TRIPLE="aarch64-apple-darwin"
  SCRCPY_ARCH="aarch64"
  ;;
x86_64)
  RUST_TRIPLE="x86_64-apple-darwin"
  SCRCPY_ARCH="x86_64"
  ;;
*)
  echo "Architettura non supportata: $ARCH" >&2
  exit 1
  ;;
esac

echo "═══ fetch-tools (${ARCH} → ${RUST_TRIPLE}) ═══"

command -v curl >/dev/null || {
  echo "curl mancante" >&2
  exit 1
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$TOOLS_DIR" "$BINARIES_DIR"
rm -rf "$TOOLS_DIR"/*
find "$BINARIES_DIR" -name 'poc-server-*' -type f -delete 2>/dev/null || true

# ── 1. adb (platform-tools ufficiali) ───────────────────────────────────────
echo "• adb: platform-tools (dl.google.com)…"
PT_ZIP="$WORK/platform-tools.zip"
curl -fsSL -o "$PT_ZIP" "https://dl.google.com/android/repository/platform-tools-latest-darwin.zip"
unzip -q "$PT_ZIP" -d "$WORK/pt"
cp "$WORK/pt/platform-tools/adb" "$TOOLS_DIR/adb"
chmod +x "$TOOLS_DIR/adb"
echo "  adb installato: $("$TOOLS_DIR/adb" version | head -1)"

# ── 2. scrcpy (release ufficiale + SHA256) ──────────────────────────────────
SCRCPY_ASSET="scrcpy-macos-${SCRCPY_ARCH}-${SCRCPY_TAG}.tar.gz"
SCRCPY_URL="https://github.com/Genymobile/scrcpy/releases/download/${SCRCPY_TAG}/${SCRCPY_ASSET}"
echo "• scrcpy: ${SCRCPY_ASSET} (github.com/Genymobile)…"
curl -fsSL -o "$WORK/$SCRCPY_ASSET" "$SCRCPY_URL"
curl -fsSL -o "$WORK/SHA256SUMS.txt" "https://github.com/Genymobile/scrcpy/releases/download/${SCRCPY_TAG}/SHA256SUMS.txt"

(
  cd "$WORK"
  grep "$SCRCPY_ASSET" SHA256SUMS.txt | shasum -a 256 -c -
) || {
  echo "Checksum scrcpy NON valido" >&2
  exit 1
}
echo "  checksum OK"

tar -xzf "$WORK/$SCRCPY_ASSET" -C "$WORK"
EXTRACTED="$WORK/scrcpy-macos-${SCRCPY_ARCH}-${SCRCPY_TAG}"
cp "$EXTRACTED/scrcpy" "$TOOLS_DIR/scrcpy"
cp "$EXTRACTED/scrcpy-server" "$TOOLS_DIR/scrcpy-server"
chmod +x "$TOOLS_DIR/scrcpy"
echo "  scrcpy installato: $("$TOOLS_DIR/scrcpy" --version 2>/dev/null | head -1)"

# ── 3. sidecar: server Node → binario standalone (bun --compile) ────────────
if ! command -v bun >/dev/null 2>&1; then
  echo "bun non trovato — installalo con: brew install bun" >&2
  exit 1
fi
echo "• sidecar server (bun --compile)…"
cd "$REPO_ROOT"
bun build --compile src/server/index.ts \
  --outfile "src-tauri/binaries/poc-server-${RUST_TRIPLE}" \
  --target=bun-${SCRCPY_ARCH} 2>/dev/null ||
  bun build --compile src/server/index.ts \
    --outfile "src-tauri/binaries/poc-server-${RUST_TRIPLE}"
chmod +x "src-tauri/binaries/poc-server-${RUST_TRIPLE}"

# Verifica che il sidecar parta e risponda
echo "• smoke test sidecar…"
SIDE_BIN="$REPO_ROOT/src-tauri/binaries/poc-server-${RUST_TRIPLE}"
POC_ADB_BIN="$TOOLS_DIR/adb" \
  POC_SCRCPY_BIN="$TOOLS_DIR/scrcpy" \
  POC_LOG_DIR="$WORK/sidelog" \
  "$SIDE_BIN" >/dev/null 2>&1 &
SIDE_PID=$!
HEALTH_OK=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:5175/api/health" >/dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
  sleep 1
done
kill "$SIDE_PID" 2>/dev/null || true
wait "$SIDE_PID" 2>/dev/null || true
if [ "$HEALTH_OK" = "1" ]; then
  echo "  sidecar OK (health risponde)"
else
  echo "  ✗ sidecar NON risponde sulla /api/health" >&2
  exit 1
fi

echo ""
echo "═══ fetch-tools completato ═══"
ls -la "$TOOLS_DIR" | sed 's/^/  /'
for f in "$BINARIES_DIR"/poc-server-*; do
  [ -e "$f" ] && ls -la "$f" | sed 's/^/  /'
done
