# Maintenance Runbook

How to change things on this site without breaking the masthead. Written for a future
maintainer who has not touched this repository in a year.

## The one rule

The page (`index.html`) and the logic module (`src/` compiled to `resume_core.wasm`) are
separate layers. HTML and CSS changes never require a rebuild. Changes to the dated facts
inside the C++ do.

## Changing page content (no toolchain needed)

Job bullets, honors, education, competencies, styling, wording: edit `index.html`, commit,
push. GitHub Pages redeploys automatically. The integrity word does not cover the HTML, so
it does not change. The CI workflow will still run and must stay green; it checks the page
for third-party references and the palette for contrast, so if you add a remote font,
script, or a low-contrast color, CI fails on purpose.

## Changing dated facts (toolchain needed)

The role dates, the role list, and the identity line live in `src/Resume_core.cpp` in two
places that must agree:

1. `canonical_record` (the string the CRC covers)
2. `role_table` (the dates the duration math uses)

Procedure:

1. Get the toolchain once: download a `wasi-sdk` release for your platform from
   `github.com/WebAssembly/wasi-sdk/releases` (CI pins major version 33; match it) and
   unpack it anywhere.
2. Edit both `canonical_record` and `role_table` so they agree. If you add or remove a
   role, update `role_table_size` and the role indices used by `index.html`
   (`data-role="N"`) and any known-answer values in `run_built_in_test`.
3. Build:
   - Windows: `$env:WASI_SDK = "<sdk path>"; .\build\build.ps1`
   - Linux or Mac: `WASI_SDK=<sdk path> bash build/build.sh`
4. The verifier will FAIL on the integrity word and print the actual new CRC. That is the
   procedure working, not breaking: the record changed, so its checksum changed.
5. Copy the new value into `EXPECTED_CRC` at the top of `build/verify.js`, and update the
   CRC mentioned in `STANDARD.md` if you care about it matching.
6. Build again. All gates must pass.
7. Commit `src/`, `resume_core.wasm`, and `build/verify.js` together. Push. CI rebuilds
   from source and must agree with the binary you committed.

## What the masthead states mean

- `BIT NOMINAL` - the module loaded and every built-in test passed.
- `BIT FAULT n` - the module loaded but a subsystem failed its known-answer test; `n` is a
  bitmask defined by `Bit_condition` in `src/Resume_core.cpp`. The page content is still
  complete; fix before the next push.
- `STATIC MODE` - scripting is off or `resume_core.wasm` failed to load. The page is fully
  readable; computed extras (badges, counters, live section indicator) are simply absent.

## Standing constraints (do not regress these)

- No request to any third party: fonts live in `fonts/`, there is no analytics, no external
  scripts. CI enforces this.
- The page must remain complete with JavaScript disabled.
- The email address in `index.html` stays entity-encoded against scrapers.
- Prose style: no em dashes. En dashes in date ranges are fine.
- The colophon alludes; it does not explain. Architecture detail belongs in the repository
  documents, not on the page.
