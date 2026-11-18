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
| Verification | `build/build.ps1`, `build/verify.js`, `build/module_check.js`, this document | Compile gate, static analysis, a host-side harness for the module's built-in test, and a gate that reads the binary's interface. |

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
| Static analysis | clang-tidy: `clang-analyzer-*`, `bugprone-*`, magic-number, goto, recursion, and function-size checks. Function-size limits set to 200 lines and 7 parameters (clang-tidy's defaults set neither). Headers are analyzed as well as the source. Fatal: `build/analysis_check.js` runs clang-tidy and fails the build on any finding outside the accepted list below, or if an accepted finding stops appearing |
| Complexity gate | `build/complexity_check.js`: McCabe cyclomatic complexity (if, for, while, do, case, `?:`, `&&`, `||`, plus one) for every function, from the compiler's own parse tree; fails above 20 (AV Rule 3). Rev C defines its counting method in Appendix A; where that differs, this gate's definition is the one stated here |
| Style gate | `build/style_check.js`: measures AV Rules 9 (ASCII), 14 (uppercase suffixes), 41 (line length), 43 (no tabs), 126 (// comments) on every build |
| Contrast gate | `build/contrast_check.js`: every text/background pair on the page measured against WCAG 2.1 AA (4.5:1) |
| Linking | `-Wl,--no-entry -Wl,--max-memory=131072`: linear memory fixed at 2 pages (128 KiB) with no room to grow. wasm-ld exports the memory by default and has no switch to stop it, so `build/strip_memory_export.js` removes that one export entry after every link and fails the build unless it removed exactly one |
| Module interface gate | `build/module_check.js`: reads the binary and requires no imports, no start function, exactly the declared function exports, no memory, table, or global export, a memory maximum equal to its initial size, and no `memory.grow` instruction. Run against both the rebuild and the committed binary |
| Memory-safety gate | second module built with `-fsanitize=undefined,bounds -fsanitize-trap=all`; traps on any UB or out-of-bounds access |
| Verification harness | `build/verify.js` under node; all checks required to pass, run against both the shipped and the instrumented module |
| Continuous verification | `.github/workflows/verify.yml`: every push rebuilds from source with a pinned wasi-sdk whose download is checked against a recorded SHA-256 before it is unpacked, runs all gates, functionally verifies the committed binary, and audits the page for third-party references |

**Note on AV Rule 8.** The rule requires ISO/IEC 14882:2002. The closest mode in a modern
clang is `-std=c++03`, which is ISO/IEC 14882:2003, the technical corrigendum of the 2002
standard. No language feature beyond 14882:2002 is used: no C++11 or later constructs
appear anywhere in the source.

## Conformance matrix (selected shall and will rules)

Comment density and file documentation rules (AV Rules 129 to 134) are satisfied
throughout the source and are not repeated per rule here.

| AV Rule | Requirement | Where honored |
|---|---|---|
| 1, 3 | Functions under 200 LSLOC, cyclomatic complexity 20 or less | Rule 1 gated by clang-tidy at 200 physical lines per function, which is stricter than logical lines. Rule 3 gated by `complexity_check.js` (McCabe: decision points plus one, from the compiler's parse tree). Highest today is `run_built_in_test` at 8 |
| 8 | ISO/IEC 14882:2002 | `-std=c++03`; see note above |
| 9 | Basic source character set only | All source files are 7-bit ASCII; gated by `style_check.js` |
| 14 | Uppercase literal suffixes | All unsigned literals use `U`; gated by `style_check.js` |
| 17–25 | Forbidden library facilities (`errno`, `stdio`, `stdlib`, `time.h`, signals, `setjmp`) | Freestanding build; no library exists to misuse |
| 26–31 | Pre-processor restricted to include guards and `#include` | Two `#ifndef`/`#define`/`#endif` guard pairs and two `#include` directives are the only directives in the project |
| 33 | `<filename.h>` include notation | `#include <Std_types.h>`, `#include <Resume_core.h>` with `-I src` |
| 35 | Include guards in every header | `Std_types.h`, `Resume_core.h` |
| 41–44 | Line length, one statement per line, no tabs, consistent indentation | Rules 41 and 43 gated by `style_check.js`; Rules 42 and 44 by inspection |
| 45–52 | Identifier naming (underscore separation, lowercase functions and variables, capitalized first word of types, lowercase constants) | `Role_record`, `Bit_condition`, `rb_role_months`, `months_per_year` |
| 53–56 | File naming and extensions | `Resume_core.h` / `Resume_core.cpp` named for the logical entity |
| 59–61 | Braces around every block, positioned on their own lines | Allman bracing throughout, including single-statement and empty blocks |
| 62 | `int32* p` pointer declaration style | `const char* bytes` |
| 65, 67 | Structs for invariant-free aggregates; public data in structs only | `Role_record` |
| 98 | Every nonlocal name in a namespace | Everything lives in `namespace Rbc`; the module has no `main` |
| 107 | Functions declared at file scope | All helpers are file-scope statics |
| 110 | No more than 7 parameters | Maximum is 4 (`rb_ease`, `months_inclusive`); gated by clang-tidy at 7 |
| 111 | No pointers or references to non-static locals returned | All returns are by value |
| 113, 114 | Single point of exit, through `return` | Every function uses the single-exit result pattern |
| 119 | No recursion, direct or indirect | Gated by `misc-no-recursion` under the fatal static-analysis gate |
| 126, 127 | C++ comments only; no commented-out code | Rule 126 gated by `style_check.js`; Rule 127 by inspection |
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
| 206 | No heap allocation after initialization | No heap allocation exists at all, before or after; the module imports nothing and contains no allocator. Its memory is fixed at 2 pages with no `memory.grow` instruction; gated by `module_check.js` |
| 207 | Unencapsulated global data avoided | All module state is file-scope `static`, and the module exports no memory, table, or global, so the state is reachable only through the exported functions; gated by `module_check.js` |
| 208 | No exceptions | `-fno-exceptions`; no throw, try, or catch |
| 209 | Specific-length typedefs instead of basic types | `Std_types.h`; widths verified at compile time. No basic type (`int`, `short`, `long`, `float`, `double`) appears in implementation code |
| 213 | No reliance on operator precedence below arithmetic | Fully parenthesized expressions throughout |
| 215 | No pointer arithmetic | Array indexing through bounds-checked counters only; the host never receives a pointer into module memory and has no handle on that memory; gated by `module_check.js` |
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
   memory, and the host cannot address that memory unless the module exports it. This
   module does not: the linker's default memory export is removed after every link, and
   `module_check.js` fails the build if any memory, table, or global export is present.
   Section offsets are passed in by value through `rb_section_push`, so no code outside
   the module can read or write the module's state. The only writable surface is the
   integer arguments of the exported functions.
3. **By verification.** The build produces a second, instrumented module compiled with
   `-fsanitize=undefined,bounds -fsanitize-trap=all`. Every detected undefined behavior or
   out-of-bounds access becomes a wasm trap. The full vector set, including adversarial
   `INT32`-extreme inputs and a deliberate attempt to push past the section table's fixed
   capacity, is run against this module; any violation aborts it and fails the build. The
   shipped module is the clean `-O2` build; the instrumented module is a gate.

## Privacy

This site provides information; it does not acquire it. The page makes no request to any
origin other than its own: fonts are served from this repository, there is no analytics,
no tracking pixel, no external script, no CDN. A visitor's address is seen only by the
host that serves the page (GitHub Pages), which is unavoidable for any hosted site. There
are outbound links (GitHub, LinkedIn), and following one is the visitor's choice; nothing
on this page phones anywhere on its own. CI enforces this with a third-party reference
audit on every push.

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
`Resume_core.h` and the known-answer tests that would catch a transposition. These three
are the only findings the build accepts. `build/analysis_check.js` matches them by check and
function name and fails the build on any other finding, so this list is measured, not
asserted.

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

**Round 3 (self-audit).** A self-review found five gaps between what was verified and what
was stated, and closed them: (1) fonts moved from a third-party CDN into this repository,
so the page now references no external origin at all and a visitor's address is disclosed
to no one but the host serving the site; (2) continuous verification was added, rebuilding
the module from source with a pinned toolchain on every push and auditing the page for
third-party references; (3) the style rules previously asserted by inspection (line length,
tabs, character set, comment form, literal suffixes) are now measured by a gate on every
build, and the matrix marks which rows are gated versus inspected; (4) every text color
pair on the page is now measured against WCAG 2.1 AA by a contrast gate, which required
darkening the gold used for small text and raising several dim labels; (5) a maintenance
runbook (MAINTAIN.md) was added so the integrity word and verifier stay in step when the
record changes.

**Round 4 (self-audit).** A review of the shipped binary, rather than the source, found
that the claims of the third round held at the source and not at the module boundary.
wasm-ld exports linear memory by default, so the module carried an export named `memory`
that handed the host every byte of module state. A host script could write the stored
built-in test result directly and the page would report `BIT NOMINAL` without the test
having run. That contradicted the sandbox claim above, the AV Rule 207 encapsulation
comment in the source, and the AV Rule 215 row's statement about pointers into module
memory. No JSF AV rule was broken: the standard governs the C++ source, and the export is
a linker artifact. The source was not changed. The fix is in the build: linear memory is
now fixed at 2 pages with no room to grow, a post-link step removes the memory export, and
a seventh gate (`module_check.js`) reads the binary on every build and fails if any of
those properties is lost. The built-in test and the integrity word are unchanged. The
same review found that static analysis could never fail the build: clang-tidy exits zero
when it reports warnings, and the scripts did not read its findings. A gate now runs it,
fails on any finding outside the three documented above, and fails if one of those stops
appearing. Finally, the source headers called the built-in test continuous; in avionics
usage continuous BIT re-runs while the system operates, and this one runs once per load,
so the headers now call it a power-on test, as this document always did. An audit of the
build against this document then found four more gaps, now closed: the function-size check
had no line or parameter limit, so AV Rules 1 and 110 were met only by inspection, and AV
Rule 3 was not measured at all; clang-tidy skipped the headers; CI pinned the toolchain
version but never verified the download; and the Linux build could not replace the
committed binary, so the maintenance procedure could not be completed there. Each new gate
was shown to fail on a deliberately violating copy of the source before it was accepted.

## Reproducing the verification

```powershell
$env:WASI_SDK = "<path to wasi-sdk>"
.\build\build.ps1
```

The script compiles the shipped module with the full fatal-diagnostics flag set, runs static
analysis and the complexity gate, builds and runs the instrumented memory-safety module,
runs the module interface gate, then runs the verification harness against the shipped
module. On Linux or Mac, run `WASI_SDK=<path> bash build/build.sh` to verify, or add
`--update` to replace the committed module with a rebuild that has passed every gate. The page itself re-runs the module's built-in test on
every load; the result is in the top-right corner of the masthead.
