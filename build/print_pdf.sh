#!/usr/bin/env bash
# print_pdf.sh - renders index.html to resume.pdf with headless Chrome.
#
# The page is served from this repository over localhost, because the logic module is
# fetched at load and a browser will not fetch it from a file:// page. Chrome then loads
# the page, lets it finish (module, self test, durations), and prints it with the page's
# own print stylesheet. CI pins the Chrome build and checks its download; see
# .github/workflows/verify.yml. Run build/pdf_check.js on the result.
#
# Usage: CHROME=<path to chrome or chrome-headless-shell> bash build/print_pdf.sh <out.pdf>
#
# --no-sandbox: the renderer loads only this repository's own page from 127.0.0.1, and the
# sandbox cannot start inside the CI container without it.
# --force-prefers-reduced-motion: counters show their final values at once, not mid-ease.
# TZ: the durations are computed from the date where the resume is kept, Laramie.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-}"
PORT="${PORT:-8137}"

if [[ -z "$OUT" || -z "${CHROME:-}" ]]; then
  echo "  FAIL  usage: CHROME=<path to chrome> bash build/print_pdf.sh <out.pdf>"
  exit 1
fi
case "$OUT" in
  /*) ;;
  *) OUT="$PWD/$OUT" ;;
esac

python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT

ready=0
for _ in $(seq 1 50); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${PORT}/index.html"; then
    ready=1
    break
  fi
  sleep 0.2
done
if [[ "$ready" -ne 1 ]]; then
  echo "  FAIL  local server did not start on port ${PORT}"
  exit 1
fi

rm -f "$OUT"
"$CHROME" --version
TZ=America/Denver "$CHROME" \
  --headless \
  --no-sandbox \
  --disable-gpu \
  --force-prefers-reduced-motion \
  --font-render-hinting=none \
  --run-all-compositor-stages-before-draw \
  --virtual-time-budget=15000 \
  --no-pdf-header-footer \
  --print-to-pdf-no-header \
  --print-to-pdf="$OUT" \
  "http://127.0.0.1:${PORT}/index.html"

if [[ ! -s "$OUT" ]]; then
  echo "  FAIL  Chrome produced no PDF"
  exit 1
fi
echo "  PASS  rendered $(basename "$OUT")"
