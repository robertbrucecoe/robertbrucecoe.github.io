# Maintenance Runbook

How to change things on this site without breaking the masthead. Written for a future
maintainer who has not touched this repository in a year.

## The one rule

The page (`index.html`) and the logic module (`src/` compiled to `resume_core.wasm`) are
separate layers. HTML and CSS changes never require a rebuild. Changes to the dated facts
inside the C++ do.

## Changing page content (no toolchain needed)

Job bullets, honors, education, competencies, styling, wording: edit `index.html`, commit,
push. The deploy workflow runs every gate and then publishes the site; if a gate fails,
nothing is published. The integrity word does not cover the HTML, so it does not change.
CI checks the page for third-party references and the palette for contrast, so if you add
a remote font, script, or a low-contrast color, CI fails on purpose.

## The printed resume

Download PDF serves `resume.pdf`, which is not in the repository. CI renders it from
`index.html` on every deploy and on the 1st of each month, reads it back with
`build/pdf_check.js`, and publishes it only if it passes. Edit the page, not a PDF.

- The print layout is the `@media print` block at the end of the stylesheet. It is written
  in points and inches only. Keep it that way: a size in `vw`, or anything wider than the
  paper, makes browsers shrink the whole page to fit.
- If you add a role, bullet, or section, the print gate checks it appears in the PDF. If
  the PDF grows past 3 pages, the gate fails; tighten the print block or raise `maxPages`
  in `build/pdf_check.js` deliberately.
- The renderer is pinned in `.github/workflows/verify.yml` (`CHROME_VERSION`,
  `CHROME_SHA256`). To move it, change both together, the same way as the wasi-sdk pin.
- To render locally: `CHROME=<path to chrome> bash build/print_pdf.sh resume.pdf`, then
  `node build/pdf_check.js resume.pdf` (needs poppler-utils).
- GitHub pauses scheduled workflows in a repository with no activity for 60 days. If the
  months in the PDF stop advancing, run the deploy workflow by hand from the Actions tab.
- The site is published by GitHub Actions: Settings > Pages > Source must stay on
  GitHub Actions.

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
   - Linux or Mac: `WASI_SDK=<sdk path> bash build/build.sh --update`

   On Windows the script always writes `resume_core.wasm`. On Linux or Mac, `--update`
   does the same, but only after every gate has passed on the rebuild. Without it the
   script checks your committed binary and leaves it alone, which is what CI does.
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
