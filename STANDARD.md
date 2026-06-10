# Conformance Statement

You found it.

The logic layer of [robertbrucecoe.github.io](https://robertbrucecoe.github.io) is written in
C++ to the discipline of the **Joint Strike Fighter Air Vehicle C++ Coding Standards**,
Lockheed Martin Corporation, Doc. No. 2RDU00001 Rev C, December 2005 (the "JSF AV" standard,
the coding standard of the F-35 air vehicle software). The source is compiled to a
freestanding `wasm32` module of roughly 3.5 KB with no operating system, no C or C++
run-time library, and no standard library.

The precise claim, stated plainly so it survives a strict audit: this is a **conformance
effort with one documented deviation, not a certified compliance**. The honest verb is
"written to the discipline of," not "in conformance with." A standard carrying a logged
deviation is, by definition, non-conforming at that point, and a single author cannot
satisfy the standard's own approval process (AV Rules 4 to 6). The deviation is recorded
below (D-1, CRC-32 bit-vector handling) and the structural limits are set out under
[Limitations](#limitations). Everything that *can* be conformed to and verified, is, with
every diagnostic fatal and a memory-safety gate; what cannot be is named rather than
stamped over. Forged metal, honestly marked, beats certified steel that lies about its
assay.

A resume website does not need flight-software discipline. That is the point. The standard
of work is the same whether the system is a fire direction computer or a web page.

## Why these two technologies belong together

JSF AV Rule 206 forbids allocation from the heap after initialization. A program written
that way needs no allocator, which means it needs no run-time library, which means it
compiles to a clean freestanding WebAssembly module with nothing inside but the program
itself. The discipline and the deployment target are the same idea expressed twice.

## Architecture

| Layer | Artifact | Role |
|---|---|---|
| Presentation | `index.html` | Complete and readable on its own. Scripting enhances it and never gates it. |
| Logic | `src/Resume_core.cpp` → `resume_core.wasm` | Canonical record, CRC-32 integrity word, duration arithmetic, fixed-point easing, navigation state. Deterministic, integer-only, bounded. |
| Verification | `build/build.ps1`, `build/verify.js`, this document | Compile gate, static analysis, and a host-side harness for the module's built-in test. |

On every page load the module runs a power-on built-in test in the manner of an avionics
line-replaceable unit:

1. The CRC-32 engine is verified against the universal known-answer vector
   (`"123456789"` → `0xCBF43926`).
2. The easing subsystem is verified at exact start, midpoint, and end values.
3. The duration subsystem is verified against a known service interval
   (January 2005 to August 2015 is 128 months, inclusive).
4. Defensive bounds handling is verified on both sides of every legal range.

Only after all four pass does the status strip report `BIT NOMINAL`. The integrity word
displayed in the masthead is the live CRC-32 of the canonical record embedded in the module.

## Build environment

| Item | Value |
|---|---|
| Compiler | clang/LLVM (wasi-sdk), `--target=wasm32` |
| Language mode | `-std=c++03` (see note on AV Rule 8 below) |
| Environment | `-nostdlib -ffreestanding -fno-exceptions -fno-rtti` |
| Diagnostics policy (AV Rule 218) | `-Wall -Wextra -Wpedantic -Wconversion -Wsign-conversion -Wshadow -Wold-style-cast -Werror`. Every diagnostic is fatal. |
| Static analysis | clang-tidy: `clang-analyzer-*`, `bugprone-*`, magic-number, goto, recursion, and function-size checks |
| Memory-safety gate | second module built with `-fsanitize=undefined,bounds -fsanitize-trap=all`; traps on any UB or out-of-bounds access |
| Verification harness | `build/verify.js` under node; 19 checks, all required to pass, run against both the shipped and the instrumented module |

**Note on AV Rule 8.** The rule requires ISO/IEC 14882:2002. The closest mode in a modern
clang is `-std=c++03`, which is ISO/IEC 14882:2003, the technical corrigendum of the 2002
standard. No language feature beyond 14882:2002 is used: no C++11 or later constructs
appear anywhere in the source.

## Conformance matrix (selected shall and will rules)

Comment density and file documentation rules (AV Rules 129 to 134) are satisfied
throughout the source and are not repeated per rule here.

| AV Rule | Requirement | Where honored |
|---|---|---|
| 1, 3 | Functions under 200 LSLOC, cyclomatic complexity 20 or less | Largest function is `run_built_in_test`, four independent if/else blocks |
| 8 | ISO/IEC 14882:2002 | `-std=c++03`; see note above |
| 9 | Basic source character set only | All source files are 7-bit ASCII |
| 14 | Uppercase literal suffixes | All unsigned literals use `U` |
| 17–25 | Forbidden library facilities (`errno`, `stdio`, `stdlib`, `time.h`, signals, `setjmp`) | Freestanding build; no library exists to misuse |
| 26–31 | Pre-processor restricted to include guards and `#include` | Two `#ifndef`/`#define`/`#endif` guard pairs and two `#include` directives are the only directives in the project |
| 33 | `<filename.h>` include notation | `#include <Std_types.h>`, `#include <Resume_core.h>` with `-I src` |
| 35 | Include guards in every header | `Std_types.h`, `Resume_core.h` |
| 41–44 | Line length, one statement per line, no tabs, consistent indentation | Enforced throughout; spaces only |
| 45–52 | Identifier naming (underscore separation, lowercase functions and variables, capitalized first word of types, lowercase constants) | `Role_record`, `Bit_condition`, `rb_role_months`, `months_per_year` |
| 53–56 | File naming and extensions | `Resume_core.h` / `Resume_core.cpp` named for the logical entity |
| 59–61 | Braces around every block, positioned on their own lines | Allman bracing throughout, including single-statement and empty blocks |
| 62 | `int32* p` pointer declaration style | `const char* bytes` |
| 65, 67 | Structs for invariant-free aggregates; public data in structs only | `Role_record` |
| 98 | Every nonlocal name in a namespace | Everything lives in `namespace Rbc`; the module has no `main` |
| 107 | Functions declared at file scope | All helpers are file-scope statics |
| 110 | No more than 7 parameters | Maximum is 4 (`rb_ease`, `months_inclusive`) |
| 111 | No pointers or references to non-static locals returned | All returns are by value |
| 113, 114 | Single point of exit, through `return` | Every function uses the single-exit result pattern |
| 119 | No recursion, direct or indirect | Verified by inspection and by `misc-no-recursion` |
| 126, 127 | C++ comments only; no commented-out code | Throughout |
| 130, 132, 133, 134 | Comment density, declaration comments, file headers, documented assumptions | Throughout |
| 135 | No identifier hiding | `-Wshadow` is fatal |
| 136, 142, 143 | Smallest feasible scope, initialization before use | Throughout |
| 137 | File-scope declarations static where possible | All module state and helpers have internal linkage |
| 144 | Braced structure of array initialization | `role_table` |
| 146, 197, 202 | Floating point discipline | No floating point exists in the module; the easing subsystem is fixed point specifically to satisfy AV Rule 202 |
| 148 | Enumeration for limited series of choices | `Bit_condition` |
| 149–151 | No octal, uppercase hex, symbolic values instead of magic numbers | Named constants throughout; verified by clang-tidy magic-number check |
| 152 | One declaration per line | Throughout |
| 153 | No unions | None |
| 157, 158 | No side effects on right of `&&`/`||`; parenthesized operands | Throughout |
| 162, 163 | No signed/unsigned mixing; no unsigned arithmetic | Signed `int32` throughout, except deviation D-1 below |
| 164, 164.1 | Shift bounds; no right-shift of possibly negative values | Shifts occur on `uint32` only; the signed fixed-point path uses division instead of shifts |
| 168 | No comma operator | None |
| 175 | Pointer comparison against plain 0 | Not applicable; no pointer comparisons exist |
| 180 | No information-losing implicit conversions | `-Wconversion -Wsign-conversion` are fatal; narrowing sites carry value-range justification comments. The CRC crosses the boundary octet-by-octet (`rb_data_crc_octet`), each value in [0, 255], so no out-of-range unsigned-to-signed conversion ever occurs |
| 182 | No casting to or from pointer types | No pointer is converted to or from an integer anywhere in the module. The earlier offset-table design exposed a raw address; it was removed in favor of `rb_section_push`, which passes offsets by value |
| 185 | C++ casts only | `static_cast` only; no `reinterpret_cast` remains; `-Wold-style-cast` is fatal |
| 186–196 | Flow control (no goto, no continue, no break outside switch, else on every else-if chain) | Throughout; every `if`/`else if` chain ends in an `else`, including commented empty blocks |
| 198–201 | For-loop discipline (single loop parameter, no body modification) | All loops are simple bounded counters |
| 203 | No overflow | Every arithmetic path carries a worst-case bound analysis in comments; verified against `INT32` extremes in `build/verify.js` |
| 204.1 | Expression value independent of evaluation order | No expression contains more than one side effect |
| 206 | No heap allocation after initialization | No heap allocation exists at all, before or after; the module imports nothing and contains no allocator |
| 208 | No exceptions | `-fno-exceptions`; no throw, try, or catch |
| 209 | Specific-length typedefs instead of basic types | `Std_types.h`; widths verified at compile time. No basic type (`int`, `short`, `long`, `float`, `double`) appears in implementation code |
| 213 | No reliance on operator precedence below arithmetic | Fully parenthesized expressions throughout |
| 215 | No pointer arithmetic | Array indexing through bounds-checked counters only; the host never receives a pointer into module memory |
| 218 | Warning levels per project policy | Policy: every diagnostic fatal; see build environment above |

## Deviation log (AV Rules 4–6)

AV Rule 6 requires each deviation from a shall rule to be documented in the file containing
it. The project has one, recorded in the header of `Resume_core.cpp`.

| ID | Rule | Deviation | Justification |
|---|---|---|---|
| D-1 | AV Rule 163 (no unsigned arithmetic) | `uint32` used in the CRC-32 subsystem | CRC-32 is polynomial division over GF(2), defined on unsigned 32-bit vectors. The operations are exclusively bitwise (XOR, AND, logical shift); no unsigned addition, subtraction, multiplication, or division occurs anywhere in the module. Scope: `crc32_table_entry`, `crc32_of_bytes`, `rb_data_crc_octet`, and the CRC state objects. |

## Memory safety

Memory safety here is established three ways, not asserted.

1. **By construction.** No heap exists, so use-after-free, double-free, and leaks are not
   expressible (AV Rule 206). No pointer arithmetic exists (AV Rule 215). No unions exist
   (AV Rule 153). All storage is fixed-size and statically allocated; every array index is
   produced by a bounded loop counter or a clamped value.
2. **By sandbox.** A WebAssembly module cannot address memory outside its own linear
   memory. The module also exposes no address of its memory to the host: section offsets
   are passed in by value through `rb_section_push`, so no code outside the module can read
   or write the module's state. The only writable surface is the four integer arguments of
   the exported functions.
3. **By verification.** The build produces a second, instrumented module compiled with
   `-fsanitize=undefined,bounds -fsanitize-trap=all`. Every detected undefined behavior or
   out-of-bounds access becomes a wasm trap. The full vector set, including adversarial
   `INT32`-extreme inputs and a deliberate attempt to push past the section table's fixed
   capacity, is run against this module; any violation aborts it and fails the build. The
   shipped module is the clean `-O2` build; the instrumented module is a gate.

## Limitations

This is an honest conformance *effort*, not a certified compliance, and the difference is
worth stating plainly.

- **Process rules cannot be met by a single author.** AV Rules 4 through 6 presume a
  program organization: a software engineering lead and a software product manager who
  approve deviations through a configuration-management tool. This repository has one
  author and no such structure. The deviation log names "module owner" as the approver
  because that is the only authority that exists. The *form* of Rule 6 (document each
  deviation in its file) is met; the *approval process* of Rules 4 and 5 has no analog here
  and is not claimed.
- **AV Rule 8 targets ISO/IEC 14882:2002.** The build uses `-std=c++03` (the 2003 technical
  corrigendum), the closest mode a current clang offers. No construct beyond 14882:2002 is
  used.
- **This matrix covers the verifiable shall and will rules** relevant to a module of this
  size. Rules concerning class hierarchies, templates, virtual dispatch, and multiple
  inheritance are not exercised because the module uses none of those features.

## Accepted static-analysis findings

clang-tidy reports three instances of `bugprone-easily-swappable-parameters` (adjacent
parameters of the same type, in `clamp_int32` and `months_inclusive`). The findings are
acknowledged and accepted; the mitigation is the documented parameter contracts in
`Resume_core.h` and the known-answer tests that would catch a transposition.

## Revision history

**Review 1.** An external review identified three valid findings against the original
version: a pointer-to-integer cast violating AV Rule 182 (with an attendant use of `long`
against AV Rule 209) in the offset-table accessor; a brittle unsigned-to-signed CRC transport
relying on target-specific behavior against AV Rule 8; and an overstatement of AV Rule 4–6
approval authority for a single-author project. The first two were corrected in the source
(the offset accessor was removed in favor of a by-value push interface; the CRC now leaves
through `rb_data_crc_octet` in [0, 255] values); the third is addressed in Limitations above.

**Review 2.** A second pass confirmed the pointer cast and CRC transport were resolved and
made a sharper point that survives those fixes: the verb. Code carrying a logged deviation
and unable to satisfy the standard's approval process is "written to the discipline of" the
standard, not "in conformance with" it. That phrasing was too strong a stamp. The claim was
weakened to its honest form throughout the source headers and this document: a conformance
effort with one documented deviation, not a certified compliance. The reviewer's verdict
("forged metal, not certified steel; the workmanship is real, the stamp is too strong") was
correct, and the stamp was corrected to match the metal.

## Reproducing the verification

```powershell
$env:WASI_SDK = "<path to wasi-sdk>"
.\build\build.ps1
```

The script compiles the shipped module with the full fatal-diagnostics flag set, runs static
analysis, builds and runs the instrumented memory-safety module, then runs the verification
harness against the shipped module. The page itself re-runs the module's built-in test on
every load; the result is in the top-right corner of the masthead.
