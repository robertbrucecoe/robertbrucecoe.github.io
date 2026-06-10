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
  "rb_init", "rb_bit_status", "rb_data_crc",
  "rb_role_count", "rb_role_months", "rb_service_months",
  "rb_ease", "rb_offsets_addr", "rb_offsets_capacity", "rb_active_section"
)
$exportFlags = $exports | ForEach-Object { "-Wl,--export=$_" }

Write-Host "[1/3] Compiling (ISO 14882 C++03, freestanding wasm32, all diagnostics fatal)..."
& $clang --target=wasm32 -std=c++03 -nostdlib -ffreestanding -fno-exceptions -fno-rtti -O2 `
  -Wall -Wextra -Wpedantic -Wconversion -Wsign-conversion -Wshadow -Wold-style-cast -Werror `
  -I (Join-Path $root "src") `
  "-Wl,--no-entry" @exportFlags `
  -o (Join-Path $root "resume_core.wasm") `
  (Join-Path $root "src\Resume_core.cpp")
if ($LASTEXITCODE -ne 0) { throw "Compilation failed." }

Write-Host "[2/3] Static analysis (clang-tidy)..."
& $tidy (Join-Path $root "src\Resume_core.cpp") `
  -checks="clang-analyzer-*,bugprone-*,cppcoreguidelines-avoid-goto,cppcoreguidelines-avoid-magic-numbers,readability-function-size,readability-function-cognitive-complexity,misc-no-recursion" `
  -quiet `
  -- --target=wasm32 -std=c++03 -nostdlib -ffreestanding -fno-exceptions -fno-rtti `
  -I (Join-Path $root "src")

Write-Host "[3/3] Built-in test (node)..."
node (Join-Path $PSScriptRoot "verify.js") (Join-Path $root "resume_core.wasm")
if ($LASTEXITCODE -ne 0) { throw "Built-in test reported failures." }

$size = (Get-Item (Join-Path $root "resume_core.wasm")).Length
Write-Host "Build complete. resume_core.wasm = $size bytes. System nominal."
