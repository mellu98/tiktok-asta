#!/usr/bin/env bash
#
# Compila il lettore UI senza idle (android-helper/) in un jar dex eseguibile
# sul telefono con app_process. Vedi android-helper/src/.../UiDump.java.
#
# Uso: scripts/build-ui-dumper.sh [percorso-output.jar]
#      (default: android-helper/build/ui-dump.jar)
#
# Serve:
#   - javac (JDK 11+)
#   - D8, in quest'ordine: R8_JAR=/percorso/r8.jar, `d8` nel PATH, oppure
#     l'ultimo build-tools in $ANDROID_HOME / $ANDROID_SDK_ROOT (runner GitHub macOS).
# Niente android.jar: si compila contro gli stub minimi in android-helper/stubs,
# che NON finiscono nel jar.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER_DIR="$REPO_ROOT/android-helper"
OUT="${1:-$HELPER_DIR/build/ui-dump.jar}"
MIN_API=26

command -v javac >/dev/null || {
  echo "javac mancante: serve un JDK 11+" >&2
  exit 1
}

run_d8() {
  if [ -n "${R8_JAR:-}" ]; then
    java -cp "$R8_JAR" com.android.tools.r8.D8 "$@"
    return
  fi
  if command -v d8 >/dev/null 2>&1; then
    d8 "$@"
    return
  fi
  local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  local latest=""
  if [ -n "$sdk" ] && [ -d "$sdk/build-tools" ]; then
    latest="$(find "$sdk/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
  fi
  if [ -n "$latest" ] && [ -x "$latest/d8" ]; then
    "$latest/d8" "$@"
    return
  fi
  echo "D8 non trovato: imposta R8_JAR, metti d8 nel PATH o ANDROID_HOME con build-tools" >&2
  exit 1
}

collect_sources() {
  while IFS= read -r -d '' f; do
    printf '%s\0' "$f"
  done < <(find "$1" -name '*.java' -print0)
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/stubs" "$WORK/classes" "$(dirname "$OUT")"

echo "• javac stub…"
collect_sources "$HELPER_DIR/stubs" | xargs -0 javac --release 11 -nowarn -d "$WORK/stubs"

echo "• javac UiDump…"
collect_sources "$HELPER_DIR/src" | xargs -0 javac --release 11 -Xlint:all -Werror \
  -cp "$WORK/stubs" -d "$WORK/classes"

echo "• d8 (min-api $MIN_API)…"
CLASS_FILES=()
while IFS= read -r -d '' f; do
  CLASS_FILES+=("$f")
done < <(find "$WORK/classes" -name '*.class' -print0)
rm -f "$OUT"
run_d8 --release --min-api "$MIN_API" --output "$OUT" "${CLASS_FILES[@]}"

echo "  ui-dump.jar pronto: $OUT ($(wc -c <"$OUT" | tr -d ' ') byte)"
