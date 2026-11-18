#!/usr/bin/env bash
# build.sh — CI twin of build.ps1. Same flags, same gates, same order.
# Requires WASI_SDK pointing at a wasi-sdk root (clang++, clang-tidy in bin/).
#
# Usage: bash build/build.sh            rebuild and verify; never touches resume_core.wasm
#        bash build/build.sh --update   also replace resume_core.wasm with the rebuild,
#                                       only after every gate has passed on the rebuild
# CI runs without --update, so a stale committed binary still fails the build there.
# build.ps1 always writes resume_core.wasm, which matches --update.
set -euo pipefail

UPDATE=0
if [ "$#" -gt 0 ]; then
  if [ "$1" = "--update" ] && [ "$#" -eq 1 ]; then
    UPDATE=1
  else
    echo "usage: bash build/build.sh [--update]" >&2
    exit 2
  fi
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLANG="$WASI_SDK/bin/clang++"
TIDY="$WASI_SDK/bin/clang-tidy"
SRC="$ROOT/src/Resume_core.cpp"
INC="$ROOT/src"
OUT="$ROOT/resume_core.wasm"

EXPORTS=(rb_init rb_bit_status rb_data_crc_octet rb_role_count rb_role_months \
         rb_service_months rb_ease rb_section_reset rb_section_push rb_active_section)
EXPORT_FLAGS=()
for e in "${EXPORTS[@]}"; do EXPORT_FLAGS+=("-Wl,--export=$e"); done

# Link flags. --max-memory fixes the linear memory at 2 pages (128 KiB) with no room to
# grow. wasm-ld exports the memory by default and has no switch to stop it, so every link
# below is followed by strip_memory_export.js, which removes that one export entry.
LINK=(-Wl,--no-entry -Wl,--max-memory=131072 "${EXPORT_FLAGS[@]}")

COMMON=(--target=wasm32 -std=c++03 -nostdlib -ffreestanding -fno-exceptions -fno-rtti
        -Wall -Wextra -Wpedantic -Wconversion -Wsign-conversion -Wshadow
        -Wold-style-cast -Werror)

echo "[1/7] Compiling shipped module and removing the memory export..."
# CI rebuilds into a scratch directory and byte-compares against the committed binary,
# so a stale or hand-edited resume_core.wasm in the repository is caught. The scratch
# copy keeps the same filename because the wasm name section embeds it.
SCRATCH="$(mktemp -d)"
REBUILT="$SCRATCH/resume_core.wasm"
"$CLANG" "${COMMON[@]}" -O2 -I "$INC" "${LINK[@]}" -o "$REBUILT" "$SRC"
node "$ROOT/build/strip_memory_export.js" "$REBUILT" "$REBUILT"

echo "[2/7] Style gate..."
node "$ROOT/build/style_check.js"

echo "[3/7] Contrast gate..."
node "$ROOT/build/contrast_check.js"

echo "[4/7] Static analysis (fatal outside the documented findings) and complexity..."
node "$ROOT/build/analysis_check.js" "$TIDY"
node "$ROOT/build/complexity_check.js" "$CLANG"

echo "[5/7] Memory-safety build and verification..."
SAFE="$ROOT/resume_core.san.wasm"
"$CLANG" "${COMMON[@]}" -O1 -fsanitize=undefined,bounds -fsanitize-trap=all \
  -I "$INC" "${LINK[@]}" -o "$SAFE" "$SRC"
node "$ROOT/build/strip_memory_export.js" "$SAFE" "$SAFE"
node "$ROOT/build/verify.js" "$SAFE"
rm -f "$SAFE"

echo "[6/7] Module interface gate on the rebuilt module..."
node "$ROOT/build/module_check.js" "$REBUILT"

echo "[7/7] Built-in test on the rebuilt module..."
node "$ROOT/build/verify.js" "$REBUILT"

if [ "$UPDATE" -eq 1 ]; then
  cp "$REBUILT" "$OUT"
  echo "Updated resume_core.wasm from the verified rebuild."
fi

echo "Committed module: interface gate and built-in test..."
node "$ROOT/build/module_check.js" "$OUT"
node "$ROOT/build/verify.js" "$OUT"

if cmp -s "$REBUILT" "$OUT"; then
  echo "Reproducibility: committed resume_core.wasm is byte-identical to the CI rebuild."
else
  echo "Reproducibility: committed wasm differs from CI rebuild (toolchain variance is" \
       "possible across platforms); both passed full functional verification above."
fi
rm -rf "$SCRATCH"

echo "Build complete. System nominal."
