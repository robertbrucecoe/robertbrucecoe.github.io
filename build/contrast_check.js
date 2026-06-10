// contrast_check.js — WCAG 2.1 contrast gate for the palette in index.html.
// Every pair listed here is a real text-on-background combination used by the page.
// The gate enforces AA for normal text (4.5:1). Decorative hairlines and non-text
// ornament are exempt by the spec and are not listed.
// Alpha-composited colors are resolved against their backdrop before measurement.

function lin(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance([r, g, b]) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(fg, bg) {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}
function hex(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function blend(fg, alpha, bg) {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
}

const ink   = hex('#0B1622');
const paper = hex('#FBF8F2');
const cream = hex('#F5F0E6');
const fs    = require('fs');
const html  = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');

// Pull the live values out of the stylesheet so this gate cannot drift from the page.
function cssVar(name) {
  const m = html.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})'));
  if (!m) { throw new Error('css variable --' + name + ' not found'); }
  return hex(m[1]);
}

const pairs = [
  // [label, foreground, background, minimum]
  ['body slate on paper',          cssVar('slate'),               paper, 4.5],
  ['gold-text labels on paper',    cssVar('gold-text'),           paper, 4.5],
  ['gold-text on cream',           cssVar('gold-text'),           cream, 4.5],
  ['ink headings on paper',        cssVar('ink'),                 paper, 4.5],
  ['navy lede on paper',           cssVar('navy'),                paper, 4.5],
  ['duration badge navy on cream', cssVar('navy'),                cream, 4.5],
  ['strip base text on ink',       blend(cream, 0.62, ink),       ink,   4.5],
  ['strip section label on ink',   blend(cream, 0.78, ink),       ink,   4.5],
  ['strip gold-soft on ink',       cssVar('gold-soft'),           ink,   4.5],
  ['amber BIT text on ink',        cssVar('amber'),               ink,   4.5],
  ['colophon body on ink',         blend(cream, 0.78, ink),       ink,   4.5],
  ['spec keys on ink',             blend(cream, 0.62, ink),       ink,   4.5],
  ['footer text on ink',           blend(cream, 0.62, ink),       ink,   4.5],
  ['rail resting on paper',        blend(cssVar('slate'), 0.78, paper), paper, 4.5],
];

let failures = 0;
for (const [label, fg, bg, min] of pairs) {
  const r = ratio(fg, bg);
  const pass = r >= min;
  if (!pass) { failures += 1; }
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}: ${r.toFixed(2)}:1 (needs ${min}:1)`);
}
console.log(failures === 0 ? 'Contrast gate: all pairs pass AA.' : `${failures} contrast pair(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
