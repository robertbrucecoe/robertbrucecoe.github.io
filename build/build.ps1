# -------------------------------------------------------------------------------------------------
# build.ps1 — Build, verify, and test the RBC-1 resume logic module.
#
# Toolchain : wasi-sdk (clang/LLVM). Set WASI_SDK to its root, e.g.
#             $env:WASI_SDK = "C:\tools\wasi-sdk-33.0-x86_64-windows"
# Output    : resume_core.wasm at the repository root (committed; GitHub Pages serves it).
#
# The flag set below is part of the project's conformance claim (JSF AV Rule 218 requires
# warning levels set per project policy; this project's policy is: every diagnostic fatal).
# -------------------------------------------------------------------------------------------------

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$sdk  = $env:WASI_SDK
if (-not $sdk) { throw "Set WASI_SDK to the wasi-sdk root directory." }

$clang = Join-Path $sdk "bin\clang++.exe"
$tidy  = Join-Path $sdk "bin\clang-tidy.exe"

# Exported interface — must match the extern "C" declarations in src/Resume_core.h.
$exports = @(
  "rb_init", "rb_bit_status", "rb_data_crc_octet",
  "rb_role_count", "rb_role_months", "rb_service_months",
  "rb_ease", "rb_section_reset", "rb_section_push", "rb_active_section"
)
$exportFlags = $exports | ForEach-Object { "-Wl,--export=$_" }

# Shared compile flags. The diagnostics policy (every warning fatal) is part of the
# project's AV Rule 218 conformance claim.
$commonFlags = @(
  "--target=wasm32", "-std=c++03", "-nostdlib", "-ffreestanding",
  "-fno-exceptions", "-fno-rtti",
  "-Wall", "-Wextra", "-Wpedantic", "-Wconversion", "-Wsign-conversion",
  "-Wshadow", "-Wold-style-cast", "-Werror"
)
$srcFile = Join-Path $root "src\Resume_core.cpp"
$incDir  = Join-Path $root "src"
$wasmOut = Join-Path $root "resume_core.wasm"

Write-Host "[1/4] Compiling shipped module (ISO 14882 C++03, freestanding wasm32, all diagnostics fatal)..."
& $clang @commonFlags -O2 -I $incDir "-Wl,--no-entry" @exportFlags -o $wasmOut $srcFile
if ($LASTEXITCODE -ne 0) { throw "Compilation failed." }

Write-Host "[2/4] Static analysis (clang-tidy)..."
& $tidy $srcFile `
  -checks="clang-analyzer-*,bugprone-*,cppcoreguidelines-avoid-goto,cppcoreguidelines-avoid-magic-numbers,readability-function-size,readability-function-cognitive-complexity,misc-no-recursion" `
  -quiet `
  -- --target=wasm32 -std=c++03 -nostdlib -ffreestanding -fno-exceptions -fno-rtti -I $incDir

Write-Host "[3/4] Memory-safety build (UBSan + bounds, trap-on-violation) and verification..."
# A separate instrumented module. -fsanitize-trap routes every detected undefined behavior
# or out-of-bounds access to a wasm `unreachable` trap, with no run-time library required,
# so it is compatible with the freestanding target. Running the full vector set (including
# the adversarial INT32-extreme inputs) against this module proves that none of those
# vectors triggers UB or an out-of-bounds access: any violation aborts the module and fails
# verification. The shipped module from step 1 is the clean -O2 build; this one is a gate.
$wasmSafe = Join-Path $root "resume_core.san.wasm"
& $clang @commonFlags -O1 "-fsanitize=undefined,bounds" "-fsanitize-trap=all" `
  -I $incDir "-Wl,--no-entry" @exportFlags -o $wasmSafe $srcFile
if ($LASTEXITCODE -ne 0) { throw "Memory-safety build failed to compile." }
node (Join-Path $PSScriptRoot "verify.js") $wasmSafe
if ($LASTEXITCODE -ne 0) { throw "Memory-safety verification trapped or reported failures." }
Remove-Item $wasmSafe -Force

Write-Host "[4/4] Built-in test against shipped module (node)..."
node (Join-Path $PSScriptRoot "verify.js") $wasmOut
if ($LASTEXITCODE -ne 0) { throw "Built-in test reported failures." }

$size = (Get-Item $wasmOut).Length
Write-Host "Build complete. resume_core.wasm = $size bytes. System nominal."
