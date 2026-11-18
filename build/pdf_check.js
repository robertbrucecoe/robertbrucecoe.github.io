// pdf_check.js - gate for the printed resume (resume.pdf).
//
// The site's Download PDF control serves a PDF that CI renders from index.html with a pinned
// headless Chrome (build/print_pdf.sh). This gate reads that PDF with poppler's command-line
// tools and fails the build unless the print is one a reader can use:
//
//   - Every page is US Letter (612 x 792 points)
//   - No more pages than maxPages
//   - Every word sits inside the @page margins declared in index.html's print block,
//     so nothing is clipped at the paper edge
//   - The text spans the printable width, so the content is not a narrow centered column
//   - The text is printed at its declared size, not shrunk to fit. A browser shrinks the
//     whole page when something on it is wider than the paper; that is the failure this
//     gate exists to catch. Measure: the median word height (body text dominates the page)
//     divided by the .entry li font size declared in the print block. Poppler reports a
//     word's height as the font's ascent plus descent, so an unshrunk print measures above
//     1 for this face. The calibration is stated where minScale is defined below
//   - Every heading, job title, and bullet in index.html appears in the PDF
//   - The logic module ran during the render: one COMPUTED badge per role, the self test
//     reads NOMINAL, and the integrity word equals EXPECTED_CRC in build/verify.js
//   - The page's own fonts are embedded, so the render did not fall back to system fonts
//
// Usage: node pdf_check.js <resume.pdf>
// Requires pdfinfo, pdftotext, and pdffonts (poppler-utils) on the PATH. Exits non-zero on
// any failure, or if a tool is missing.

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pdfPath = process.argv[2];
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const verifySource = fs.readFileSync(path.join(__dirname, "verify.js"), "utf8");

const letter = { width: 612, height: 792 };
const pointsPerInch = 72;
const maxPages = 3;
// The text must reach to within this fraction of the printable width from the right margin.
const minWidthUse = 0.9;
// Scale window for median word height over declared body size. Calibration, both measured
// with this gate: the pinned renderer printing at the declared size measures 1.66. The
// shrunken print that prompted this gate (Chrome on a Windows laptop, laid out at desktop
// width and scaled onto the paper) measures 0.79. The window fails any shrink past about
// 13 percent.
const minScale = 1.45;
const maxScale = 1.9;
// Slack, in points, for glyph overhang past a margin line.
const edgeTolerance = 1.5;

let failures = 0;
function check(label, pass, detail) {
  if (!pass) { failures += 1; }
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ": " + detail : ""}`);
}

function run(tool, args) {
  const r = childProcess.spawnSync(tool, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    console.log(`  FAIL  ${tool} did not run: ` +
      (r.error ? r.error.message : `exit status ${r.status}\n${r.stderr}`));
    process.exit(1);
  }
  return r.stdout;
}

if (!pdfPath) {
  console.log("  FAIL  usage: node pdf_check.js <resume.pdf>");
  process.exit(1);
}

// ---- What the page declares ------------------------------------------------------------

const printStart = html.indexOf("@media print {");
if (printStart < 0) {
  console.log("  FAIL  index.html has no @media print block");
  process.exit(1);
}
const printBlock = html.slice(printStart);

function lengthToPoints(token) {
  const m = /^([0-9.]+)(in|pt)$/.exec(token);
  if (!m) { return NaN; }
  return Number(m[1]) * (m[2] === "in" ? pointsPerInch : 1);
}

const pageRule = /@page\s*\{[^}]*margin:\s*([^;]+);/.exec(printBlock);
const marginTokens = pageRule ? pageRule[1].trim().split(/\s+/).map(lengthToPoints) : [];
const margins = marginTokens.length === 1 ? [marginTokens[0], marginTokens[0]] :
  marginTokens.length === 2 ? marginTokens : [];
const bodyRule = /\.entry li\s*\{[^}]*font-size:\s*([0-9.]+)pt/.exec(printBlock);
const bodySize = bodyRule ? Number(bodyRule[1]) : NaN;
check("print block declares @page margins in in or pt",
  margins.length === 2 && margins.every((v) => v > 0),
  pageRule ? pageRule[1].trim() : "not found");
check("print block declares the .entry li size in pt", bodySize > 0,
  bodyRule ? `${bodySize}pt` : "not found");
if (failures > 0) { process.exit(1); }
const [marginY, marginX] = margins;
const printable = {
  left: marginX, right: letter.width - marginX,
  top: marginY, bottom: letter.height - marginY
};

function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&#0*39;/g, "'").replace(/&nbsp;/g, " ");
}
function textOf(fragment) {
  return decodeEntities(fragment.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
// Comparison key: letters and digits only, so line breaks, dashes, and ligature splits in
// the extracted text do not matter.
function key(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const body = html.slice(html.indexOf("<body"));
const expected = [];
const patterns = [
  /<h2[^>]*>([\s\S]*?)<\/h2>/g,
  /<h3[^>]*>([\s\S]*?)<\/h3>/g,
  /<article class="entry[\s\S]*?<\/article>/g
];
patterns.slice(0, 2).forEach((re) => {
  let m = re.exec(body);
  while (m) { expected.push(textOf(m[1])); m = re.exec(body); }
});
let article = patterns[2].exec(body);
while (article) {
  const li = /<li>([\s\S]*?)<\/li>/g;
  let m = li.exec(article[0]);
  while (m) { expected.push(textOf(m[1])); m = li.exec(article[0]); }
  article = patterns[2].exec(body);
}
const roleCount = (body.match(/class="dur" data-role="/g) || []).length;
const crcMatch = /const EXPECTED_CRC = "(0x[0-9A-F]{8})"/.exec(verifySource);
const expectedCrc = crcMatch ? crcMatch[1] : "";

// ---- What the PDF contains -------------------------------------------------------------

const info = run("pdfinfo", ["-f", "1", "-l", "9999", pdfPath]);
const pageCountMatch = /^Pages:\s+(\d+)/m.exec(info);
const pages = pageCountMatch ? Number(pageCountMatch[1]) : 0;
const sizes = [];
const sizeRe = /^Page\s+\d+ size:\s+([0-9.]+) x ([0-9.]+) pts/gm;
let sm = sizeRe.exec(info);
while (sm) { sizes.push([Number(sm[1]), Number(sm[2])]); sm = sizeRe.exec(info); }

console.log(`Print gate: ${pdfPath}`);
check("PDF has pages", pages > 0, `${pages}`);
check(`no more than ${maxPages} pages`, pages <= maxPages, `${pages}`);
check("every page is US Letter", sizes.length === pages && sizes.every((s) =>
  Math.abs(s[0] - letter.width) < 0.5 && Math.abs(s[1] - letter.height) < 0.5),
  sizes.map((s) => `${s[0]}x${s[1]}`).join(", "));

const bboxHtml = run("pdftotext", ["-bbox", pdfPath, "-"]);
const words = [];
const wordRe = /<word xMin="([0-9.]+)" yMin="([0-9.]+)" xMax="([0-9.]+)" yMax="([0-9.]+)">([^<]*)<\/word>/g;
let wm = wordRe.exec(bboxHtml);
while (wm) {
  words.push({ x0: Number(wm[1]), y0: Number(wm[2]), x1: Number(wm[3]), y1: Number(wm[4]),
    text: decodeEntities(wm[5]) });
  wm = wordRe.exec(bboxHtml);
}
check("PDF has extractable text", words.length > 0, `${words.length} words`);
if (words.length === 0) { process.exit(1); }

const outside = words.filter((w) =>
  w.x0 < printable.left - edgeTolerance || w.x1 > printable.right + edgeTolerance ||
  w.y0 < printable.top - edgeTolerance || w.y1 > printable.bottom + edgeTolerance);
check("every word inside the page margins", outside.length === 0,
  `${outside.length} outside`);
outside.slice(0, 8).forEach((w) => {
  console.log(`        outside: "${w.text}" x ${w.x0.toFixed(1)} to ${w.x1.toFixed(1)}, ` +
    `y ${w.y0.toFixed(1)} to ${w.y1.toFixed(1)}`);
});

const minX = Math.min(...words.map((w) => w.x0));
const maxX = Math.max(...words.map((w) => w.x1));
const printableWidth = printable.right - printable.left;
check("text starts at the left margin", minX <= printable.left + edgeTolerance,
  `first text at ${minX.toFixed(1)}pt, margin ${printable.left.toFixed(1)}pt`);
check("text spans the printable width",
  maxX - printable.left >= minWidthUse * printableWidth,
  `${(100 * (maxX - printable.left) / printableWidth).toFixed(0)}% of ` +
  `${printableWidth.toFixed(0)}pt (needs ${100 * minWidthUse}%)`);

const heights = words.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
const medianHeight = heights[Math.floor(heights.length / 2)];
const scale = medianHeight / bodySize;
check("text printed at its declared size", scale >= minScale && scale <= maxScale,
  `median word height ${medianHeight.toFixed(2)}pt / body ${bodySize}pt = ` +
  `${scale.toFixed(2)} (window ${minScale} to ${maxScale})`);

const rawText = run("pdftotext", ["-raw", pdfPath, "-"]);
const pdfKey = key(rawText);
const missing = expected.filter((t) => pdfKey.indexOf(key(t)) < 0);
check("every heading, title, and bullet present", missing.length === 0,
  `${expected.length - missing.length} of ${expected.length}`);
missing.forEach((t) => { console.log(`        missing: ${t.slice(0, 90)}`); });

// A badge reads like "3 YRS 7 MOS · COMPUTED". Matching on the unit before the word keeps
// the stat label "computed live" out of the count.
const computed = (pdfKey.match(/(yrs?|mos?)computed/g) || []).length;
check("one COMPUTED badge per role", roleCount > 0 && computed === roleCount,
  `${computed} badges, ${roleCount} roles`);
check("self test reads NOMINAL", /\bNOMINAL\b/.test(rawText));
check("integrity word matches EXPECTED_CRC", expectedCrc !== "" && rawText.indexOf(expectedCrc) >= 0,
  expectedCrc || "EXPECTED_CRC not found in verify.js");

const fonts = run("pdffonts", [pdfPath]).split(/\r?\n/).slice(2).filter((l) => l.trim() !== "");
["Fraunces", "SourceSerif4", "IBMPlexMono"].forEach((family) => {
  const rows = fonts.filter((l) => l.indexOf(family) >= 0);
  check(`${family} embedded`, rows.length > 0 && rows.every((l) => /\byes\s+yes\s+yes\b/.test(l)),
    `${rows.length} subset(s)`);
});

console.log(failures === 0 ? "Printed resume verified." : `${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
