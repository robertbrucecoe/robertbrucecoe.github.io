# Conformance Statement

You found it.

The logic layer of [robertbrucecoe.github.io](https://robertbrucecoe.github.io) is written in
C++ to the discipline of the **Joint Strike Fighter Air Vehicle C++ Coding Standards**,
Lockheed Martin Corporation, Doc. No. 2RDU00001 Rev C, December 2005 (the "JSF AV" standard,
the coding standard of the F-35 air vehicle software). The source is compiled to a
freestanding `wasm32` module of roughly 4 KB with no operating system, no C or C++
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
| Verification | `build/build.ps1`, `build/build.sh`, `build/verify.js`, `build/module_check.js`, `build/record_check.js`, `build/bit_fault_check.js`, `build/page_fault_check.js`, this document | Compile gate, static analysis, a host-side harness for the module's built-in test, a gate that reads the binary's interface, a gate that holds the record, the role table, and the page's dates in agreement, and fault injection into both the module and the page. |
| Print | `resume.pdf`, rendered by CI from `index.html` | The printed resume behind Download PDF. Rendered with a pinned browser after every gate passes, read back by a print gate, and published only if it passes. |

On every page load the module runs a power-on built-in test in the manner of an avionics
line-replaceable unit. Each subsystem is tested against vectors that are independent of the
data it serves, and reports its own bit of the result:

1. **CRC-32 (1).** The engine is verified against the universal known-answer vector
   (`"123456789"` → `0xCBF43926`), and the octet transport that carries a CRC across the
   module boundary is verified on that check value, octet by octet.
2. **Easing (2).** Eight vectors: start, end, midpoint, off-centre ascending and
   descending, a reversed span, elapsed time past the duration, and the largest endpoint.
3. **Duration (4).** Three hand-worked intervals held as literals apart from the role
   table (one month, a year boundary, and the 128 months from January 2005 to August 2015),
   so a corrupted table entry cannot also corrupt its expected answer. Every open-ended
   role is checked against the load date, so the path that computes a current role is
   tested, not assumed.
4. **Bounds (8).** Out-of-range indices on both sides of the role table and of the CRC
   octet index, the two indexed interfaces.
5. **Navigation (64).** The section table is filled with known offsets and the active
   section is checked one pixel short of a boundary, on it, at the largest and smallest
   scroll positions, and at capacity, where a further push must be refused. The table is
   cleared again before the page uses it.
6. **Record (32).** The CRC-32 of the canonical record is compared against the value
   recorded in the source (`record_crc_expected`). A corrupted or altered record fails.
7. **Clock (128).** A load date outside 2026 to 2099, or a month outside 1 to 12, is
   clamped so the arithmetic stays defined, and reported as a fault rather than silently
   accepted.

Only when every bit is clear does the status strip report `BIT NOMINAL`. On any fault the
page states `BIT FAULT n`, withholds the integrity word, and shows no computed value: no
duration badge, no computed counter, no live section indicator. It falls back to its static
content, exactly as if the module had not loaded. The integrity word in the masthead is the
CRC-32 of the canonical record, recomputed on every load and checked as in item 6.

What the record does not cover is stated rather than implied. The dates exist in three
places: the canonical record, the role table that the duration arithmetic uses, and the
page text. No run-time check can make the page text agree with the module, so
`build/record_check.js` reads all three on every build and fails unless every role's dates
and the role count agree, and unless the recorded CRC-32 equals the record's actual CRC-32.

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
| Record agreement gate | `build/record_check.js`: the canonical record, the role table, and each role's date line on the page must give the same start, end, and count, the same military flag in record and table, and the recorded CRC-32 in the source and in `verify.js` must equal the CRC-32 it computes from the record |
| Fault-injection gate | `build/bit_fault_check.js`: builds the module from the unmodified source, which must report nominal, and then 14 times with one injected fault each (corrupted constants, wrong comparisons, a lost clamp, an altered record or recorded CRC). Every build must report exactly its expected fault code, so each subsystem is shown to detect a fault in itself and only in itself |
| Linking | `-Wl,--no-entry -Wl,--max-memory=131072`: linear memory fixed at 2 pages (128 KiB) with no room to grow. wasm-ld exports the memory by default and has no switch to stop it, so `build/strip_memory_export.js` removes that one export entry after every link and fails the build unless it removed exactly one |
| Module interface gate | `build/module_check.js`: reads the binary and requires no imports, no start function, exactly the declared function exports, no memory, table, or global export, a memory maximum equal to its initial size, and no `memory.grow` instruction. Run against both the rebuild and the committed binary |
| Memory-safety gate | second module built with `-fsanitize=undefined,bounds -fsanitize-trap=all`; traps on any UB or out-of-bounds access |
| Verification harness | `build/verify.js` under node; all checks required to pass, run against both the shipped and the instrumented module. Covers the not-initialized state, the clock fault at five out-of-range dates, `rb_bit_status`, out-of-range indices, and `INT32` extremes on the clock, easing, and scroll inputs |
| Structural coverage gate | `build/coverage_check.js`: records every call `verify.js` makes and every result the wasm module returns, replays that sequence against a native build of the same source instrumented by gcc, and fails unless the native results match the wasm results call for call, every exported function is called, every executable line runs, and both outcomes of every decision and of every `&&`/`\|\|` operand are taken. The statements that report a test failure cannot run in a sound module, so each is credited only if one of the injected faults of `build/bit_faults.js`, built instrumented, reaches it. Branch coverage, not MC/DC |
| Reproducibility | the committed `resume_core.wasm` must be byte-identical to the rebuild from source; `build/build.sh` fails otherwise |
| Page fault gate | `build/page_fault_check.js`, in the print job: loads the page in the pinned browser with the committed module and requires `BIT NOMINAL`, the integrity word, and every computed value; then loads it with a copy of the module whose record has one byte altered and requires `BIT FAULT 32`, the integrity word withheld, and no computed value on the page |
| Continuous verification | `.github/workflows/verify.yml`: every pull request and every deploy rebuilds from source with a pinned wasi-sdk whose download is checked against a recorded SHA-256 before it is unpacked, runs all gates, requires the committed binary to be byte-identical to the rebuild, audits the page for third-party references, renders and gates the printed resume, and checks that a built-in test fault withholds every computed value on the page |
| Print renderer | Chrome for Testing headless shell, pinned by version in `verify.yml` and checked against a recorded SHA-256 before it is unpacked. `build/print_pdf.sh` serves the page from localhost so the module loads, and prints it with the page's own print stylesheet, which is written in paper units only |
| Print gate | `build/pdf_check.js`: reads `resume.pdf` with poppler and requires US Letter pages, no more than 3 of them, every word inside the declared margins, text spanning the printable width, text at its declared size rather than shrunk to fit, every heading, job title, and bullet in `index.html`, one computed duration per role (proof the module ran during the render), no colophon (it describes the live page, not a printed copy), and the page's own fonts embedded |
| Deployment | `.github/workflows/deploy.yml`: on every push to `main` and on the 1st of each month, runs `verify.yml` in full, then publishes the page, the module, the fonts, and the gated PDF to GitHub Pages. Nothing is published if any gate fails. The monthly run keeps the durations computed into the PDF current |

**Note on AV Rule 8.** The rule requires ISO/IEC 14882:2002. The closest mode in a modern
clang is `-std=c++03`, which is ISO/IEC 14882:2003, the technical corrigendum of the 2002
standard. No language feature beyond 14882:2002 is used: no C++11 or later constructs
appear anywhere in the source.

## Conformance matrix (selected shall and will rules)

Comment density and file documentation rules (AV Rules 129 to 134) are satisfied
throughout the source and are not repeated per rule here.

| AV Rule | Requirement | Where honored |
|---|---|---|
| 1, 3 | Functions under 200 LSLOC, cyclomatic complexity 20 or less | Rule 1 gated by clang-tidy at 200 physical lines per function, which is stricter than logical lines. Rule 3 gated by `complexity_check.js` (McCabe: decision points plus one, from the compiler's parse tree). Highest today is `bit_navigation` at 8 |
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
| 167 | Integer division documented | Every division has a non-negative dividend and a positive divisor, so no implementation-defined rounding of a negative quotient can occur; the easing subsystem divides the magnitude of a descending span and applies the sign after. Stated in the source header under INTEGER DIVISION |
| 168 | No comma operator | None |
| 175 | Pointer comparison against plain 0 | Not applicable; no pointer comparisons exist |
| 180 | No information-losing implicit conversions | `-Wconversion -Wsign-conversion` are fatal; narrowing sites carry value-range justification comments. The CRC crosses the boundary octet-by-octet (`rb_data_crc_octet`, through the `crc_octet` helper), each value in [0, 255], so no out-of-range unsigned-to-signed conversion ever occurs; the built-in test checks that transport on the CRC-32 check value |
| 182 | No casting to or from pointer types | No pointer is converted to or from an integer anywhere in the module. The earlier offset-table design exposed a raw address; it was removed in favor of `rb_section_push`, which passes offsets by value |
| 185 | C++ casts only | `static_cast` only; no `reinterpret_cast` remains; `-Wold-style-cast` is fatal |
| 186–196 | Flow control (no goto, no continue, no break outside switch, else on every else-if chain) | Throughout; every `if`/`else if` chain ends in an `else`, including commented empty blocks |
| 198–201 | For-loop discipline (single loop parameter, no body modification) | All loops are simple bounded counters |
| 203 | No overflow | Every arithmetic path carries a worst-case bound analysis in comments; every argument that enters arithmetic is clamped first, including the scroll position, which `rb_active_section` clamps to [0, 1 000 000 000] before adding its bias. Verified against `INT32` extremes on the clock, easing, and scroll inputs in `build/verify.js`, and the scroll clamp is shown necessary by `build/bit_fault_check.js` |
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
| D-1 | AV Rule 163 (no unsigned arithmetic) | `uint32` used in the CRC-32 subsystem | CRC-32 is polynomial division over GF(2), defined on unsigned 32-bit vectors. The operations are exclusively bitwise (XOR, AND, logical shift); no unsigned addition, subtraction, multiplication, or division occurs anywhere in the module. Scope: `crc32_table_entry`, `crc32_of_bytes`, `crc_octet`, the `crc32_*` constants and `record_crc_expected`, and the CRC state objects. |

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
audit on every pull request and every deploy. The downloadable PDF is served from the same
origin and is rendered from the same page.

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
- **Coverage is branch coverage, measured on a native build.** The wasm target has no
  coverage run-time, so the gate measures the same source compiled natively by gcc and
  requires it to return what the wasm module returned on every call. It does not measure
  MC/DC, which DO-178C requires of its most critical software; gcc 13 cannot instrument it.
  A helper shared by several callers (`clamp_int32`) is covered once, not once per caller.
- **The checks are tested by their own failure, not by a suite.** Each gate was shown to
  fail on a deliberately broken input before it was accepted, and the fault-injection and
  coverage gates re-prove the built-in test on every build. The other gates have no
  standing set of bad inputs run against them.
- **`build/build.ps1` mirrors `build/build.sh` but CI does not run it.** CI and every
  result in this document come from the Linux script.
- **This matrix covers the verifiable shall and will rules** relevant to a module of this
  size. Rules concerning class hierarchies, templates, virtual dispatch, and multiple
  inheritance are not exercised because the module uses none of those features.

## Accepted static-analysis findings

clang-tidy reports four instances of `bugprone-easily-swappable-parameters` (adjacent
parameters of the same or convertible types, in `clamp_int32`, `months_inclusive`, and
`crc_octet`). The findings are acknowledged and accepted; the mitigation is the documented
parameter contracts in `Resume_core.h` and the source, and the built-in test vectors that
would catch a transposition (for `crc_octet`, the octet-transport check of the CRC-32 check
value, which `build/bit_fault_check.js` shows failing on a corrupted shift). These four are
the only findings the build accepts. `build/analysis_check.js` matches them by check and
function name and fails the build on any other finding, so this list is measured, not
asserted.

## Requirements traceability

Each requirement the module and the page are held to is stated once below, with the code
that implements it and every check that verifies it. A requirement with no verifying check
would be a claim, and none is left that way. The structural coverage gate closes the loop
in the other direction: it fails if any line or branch outcome of the module is exercised by
no check, so no code exists that the requirements and their tests do not reach.

Abbreviations: **BIT** is the power-on built-in test, by subsystem; **VJ** is a named check
in `build/verify.js`; **FI** is a fault in `build/bit_faults.js`, run by the fault-injection
and coverage gates.

| ID | Requirement | Implemented in | Verified by |
|---|---|---|---|
| R-01 | `rb_init` shall run the built-in test and return 0 only when every subsystem passes and the date is in range; otherwise a bitmask naming each failure | `rb_init`, `run_built_in_test` | VJ "BIT status (0 = nominal)"; all 14 FI, each by its exact code |
| R-02 | Before `rb_init`, `rb_bit_status` shall return 16 (not initialized) | `s_bit_status` initial value | VJ "BIT status before rb_init" |
| R-03 | `rb_bit_status` shall return the result of the last `rb_init` | `rb_bit_status` | VJ "rb_bit_status matches rb_init", "rb_bit_status reports the clock fault" |
| R-04 | A year outside [2026, 2099] or a month outside [1, 12] shall be clamped and reported as 128 | `rb_init` | VJ five "clock fault" checks, including `INT32` extremes |
| R-05 | The CRC-32 engine shall reproduce the IEEE 802.3 check value, and report 1 otherwise | `crc32_table_entry`, `crc32_of_bytes`, `bit_crc` | BIT CRC (1); FI "polynomial corrupted" |
| R-06 | A CRC shall leave the module only as octets in [0, 255]; an octet index outside [0, 3] shall return 0 | `crc_octet`, `rb_data_crc_octet` | BIT CRC octet transport, BIT bounds (8); VJ "CRC-32 integrity word", both "CRC octet out-of-range"; FI "wrong shift", "CRC octet index answers 1" |
| R-07 | The record's CRC-32 shall be compared at every load with `record_crc_expected`, and a mismatch reported as 32 | `run_built_in_test` | BIT record (32); FI "one character of the record altered", "recorded CRC-32 altered"; page fault gate |
| R-08 | The record, the role table, and the page's dates shall agree, and the recorded CRC-32 shall equal the record's | `canonical_record`, `role_table`, `index.html` | `record_check.js` |
| R-09 | A role's duration shall count both its first and last months; an open role shall end at the load date | `months_inclusive`, `role_months_internal`, `bit_duration` | BIT duration (4); VJ "Eagle Dynamics months", "Army battery role months"; FI "inclusive month lost", "open role closed at the wrong month" |
| R-10 | A role index outside the table shall return 0 | `role_months_internal` | BIT bounds (8); VJ both "out-of-range role index"; FI "role index answers 1" |
| R-11 | `rb_service_months` shall return the sum of the military roles' durations | `rb_service_months` | VJ "total uniformed service months" (not in the BIT: a wrong sum shows as a wrong counter, never as a corrupted record) |
| R-12 | `rb_ease` shall return its endpoints exactly, use integer fixed point only, clamp elapsed to [0, duration], duration to [1, 60 000] ms and endpoints to [-1 000 000, 1 000 000], and ease a descending span symmetrically | `ease_internal`, `rb_ease`, `bit_ease` | BIT easing (2), eight vectors; VJ seven "ease" checks, both `INT32`-extreme cases; FI "smoothstep coefficient corrupted", "descending excursion applied with the wrong sign" |
| R-13 | The section table shall hold at most 16 entries, refuse any push past that, and be emptied by `rb_section_reset` and by `rb_init` | `section_push_internal`, `rb_section_reset`, `rb_init` | BIT navigation (64); VJ "section reset returns 0", "rb_init leaves the section table empty", both capacity checks; FI "capacity guard refuses pushes below capacity", "admits one too many" |
| R-14 | `rb_active_section` shall return the last section whose top is at or above the scroll position plus 160 px, after clamping the scroll to [0, 1 000 000 000], and 0 when none qualifies | `active_section_internal` | BIT navigation (64); VJ five "active section" checks; FI "activation boundary off by one", "scroll clamp lost" |
| R-15 | The module shall import nothing, export exactly its ten functions and no memory, table, or global, and have fixed memory with no growth | link flags, `strip_memory_export.js` | `module_check.js`, on the rebuild and the committed binary |
| R-16 | No input in the harness shall cause undefined behavior or an out-of-bounds access | the whole module | memory-safety build plus `verify.js` |
| R-17 | After any built-in test fault the page shall show the fault code and no computed value | `index.html` | page fault gate |
| R-18 | The committed module shall be the build of the committed source | `build.sh` | reproducibility comparison |
| R-19 | The printed resume shall be at most 3 US Letter pages, at its declared size, with every heading, title, and bullet and one computed duration per role | `index.html` print stylesheet, `print_pdf.sh` | `pdf_check.js` |
| R-20 | Every line and branch outcome of the module shall be exercised by a check above | the whole module | `coverage_check.js` |

R-14 reads "at or above" in page coordinates: a section is active once its top has scrolled
to within 160 px below the top of the window.

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

**Round 5 (print).** Download PDF opened the browser's print dialog, and the first real
print of the page failed: on a laptop, Chrome laid the page out at desktop width and shrank
it onto the paper, producing a narrow column of roughly 6 point text across three pages.
The print stylesheet depended on the width of the screen, and something on the page was
wider than the paper. The print stylesheet now restates every width-dependent rule in
points and removes the decoration that extended past the column, so nothing can overflow
and the print is the same from any device. Download PDF now serves a PDF that CI renders
with a pinned browser and reads back with a print gate before publishing, and the site is
deployed by a workflow that publishes nothing unless every gate passes. The print gate was
calibrated on both prints and was shown to fail the shrunken one, and to fail on a missing
bullet and on text outside the margins. The colophon is left out of the print: it describes
a self test that runs on every load and a word in the masthead, and a printed copy has
neither.

**Round 6 (built-in test).** A line-by-line review of the built-in test against this
document found that the test was weaker than it was described, and that its result changed
nothing a reader saw. A fault replaced the status word, but the page still filled every
computed badge and counter and displayed the integrity word. The integrity word itself was
computed on every load and compared with nothing, so a corrupted record still read nominal;
it covered the record string, but not the role table the durations come from, nor the page
text. An impossible clock (1970, or month 13) was silently clamped and reported nominal.
The open-ended role path, service months, navigation, and the octet transport were never
tested; the duration vector was the record's own entry, so it tested the record against
itself; the bounds test covered one index of two. No fault had ever been injected, so the
fault path had never been seen to work, and `rb_bit_status` had no caller. The review also
found an overflow in `rb_active_section` at the top of the `int32` range (AV Rule 203),
undocumented division of a negative value in the easing subsystem (AV Rule 167), a
reproducibility comparison in `build.sh` that could not fail, a service counter written as a
page constant beside an unused module function, and the 60 000 ms cap missing from the
`rb_ease` header. All are corrected. The built-in test now has the seven subsystems listed
above, with vectors held apart from the data they check; a fault inhibits every computed output; the
record is checked at run time against its recorded CRC-32 and at build time against the
role table and the page; and three new gates prove the failure paths: fault injection into
the source, a corrupted module loaded in the browser, and a stale committed binary. Each was
shown to fail on a weakened copy (a removed boundary vector goes undetected and fails the
fault-injection gate) before it was accepted.

**Round 7 (traceability and coverage).** Asked whether the project would satisfy a defense
engineering lead, the honest answer named two gaps first: no record tying each requirement
to the checks that verify it, and no measurement of how much of the code those checks
actually exercise. Both are now closed. The requirements traceability table above states
twenty requirements, each with its implementation and every check that verifies it. The
new structural coverage gate replays the harness's own calls against an instrumented
native build and requires every line and both outcomes of every decision to be exercised.
It found what such a gate should: the bounds test was one compound decision, so a fault on
one side of one range could hide behind the others; it is now four decisions. And no
injected fault reached the navigation test's report that a push below capacity was refused;
a fourteenth fault now does. The gate was shown to fail with that fault removed and with
the harness's clock-fault checks removed. The limits of the measurement (branch coverage,
not MC/DC; a native build, not the wasm binary) are stated under Limitations, along with the
remaining gaps the same review named.

## Reproducing the verification

```powershell
$env:WASI_SDK = "<path to wasi-sdk>"
.\build\build.ps1
```

The script compiles the shipped module with the full fatal-diagnostics flag set, runs the
style, contrast, and record agreement gates, static analysis and the complexity gate, and
the fault-injection gate, builds and runs the instrumented memory-safety module, runs the
module interface gate, runs the verification harness against the shipped module, then
runs the structural coverage gate if g++ and gcov are installed. On Linux or Mac, run
`WASI_SDK=<path> bash build/build.sh` to verify, or add `--update` to replace the committed
module with a rebuild that has passed every gate. The page itself re-runs the module's
built-in test on every load; the result is in the top-right corner of the masthead.
