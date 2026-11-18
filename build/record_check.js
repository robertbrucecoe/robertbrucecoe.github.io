// record_check.js - agreement gate for the dated record.
//
// The role dates exist in three places, and nothing at run time can make them agree:
//   1. canonical_record in src/Resume_core.cpp, the text the integrity word covers
//   2. role_table in the same file, the numbers the duration arithmetic uses
//   3. the date line of each role on the page (index.html), the text a reader sees
// This gate reads all three and fails the build unless every role has the same start and
// end in each, the same role count, and the same military flag (a role is military when
// its organization in the record begins with "US ARMY"). It also computes the CRC-32 of
// the record and fails unless record_crc_expected in the source and EXPECTED_CRC in
// build/verify.js both equal it, and prints the value to copy when the record changes.
//
// Usage: node record_check.js
// Exits non-zero on any disagreement or if any of the three cannot be read.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const cpp = fs.readFileSync(path.join(root, "src", "Resume_core.cpp"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const verifier = fs.readFileSync(path.join(root, "build", "verify.js"), "utf8");

let failures = 0;
function check(label, pass, detail) {
  if (!pass) { failures += 1; }
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ": " + detail : ""}`);
}
function stop(message) {
  console.log(`  FAIL  ${message}`);
  process.exit(1);
}

// A date as comparable text: "2023-05", or "PRESENT" for an open role.
function ym(year, month) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

// ---- 1. canonical_record ---------------------------------------------------------------
const recordDecl = /canonical_record\[\]\s*=\s*([\s\S]*?";)\s*\n/.exec(cpp);
if (!recordDecl) { stop("canonical_record not found in src/Resume_core.cpp"); }
const record = (recordDecl[1].match(/"((?:[^"\\]|\\.)*)"/g) || [])
  .map((lit) => lit.slice(1, -1)).join("");
const fromRecord = [];
const roleRe = /R(\d+)=([^,;]*),[^;]*?,(\d{4}-\d{2}),(PRESENT|\d{4}-\d{2});/g;
let rm = roleRe.exec(record);
while (rm) {
  fromRecord.push({ index: Number(rm[1]), start: rm[3], end: rm[4],
    military: /^US ARMY\b/.test(rm[2]) });
  rm = roleRe.exec(record);
}

// ---- 2. role_table ---------------------------------------------------------------------
const sizeDecl = /const int32 role_table_size\s*=\s*(\d+);/.exec(cpp);
const tableDecl = /role_table\[role_table_size\]\s*=\s*\{([\s\S]*?)\};/.exec(cpp);
if (!sizeDecl || !tableDecl) { stop("role_table or role_table_size not found"); }
const tableSize = Number(sizeDecl[1]);
const fromTable = [];
const rowRe = /\{\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*([01])\s*\}/g;
let tm = rowRe.exec(tableDecl[1]);
while (tm) {
  const open = Number(tm[3]) === 0;
  fromTable.push({ start: ym(tm[1], tm[2]), end: open ? "PRESENT" : ym(tm[3], tm[4]),
    military: tm[5] === "1" });
  tm = rowRe.exec(tableDecl[1]);
}

// ---- 3. the page -----------------------------------------------------------------------
const months = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
                 JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
function pageDate(text) {
  const t = text.trim();
  if (t === "PRESENT") { return "PRESENT"; }
  const m = /^([A-Z]{3}) (\d{4})$/.exec(t);
  return (m && months[m[1]]) ? ym(m[2], months[m[1]]) : `unreadable "${t}"`;
}
const fromPage = [];
const whenRe = /<div class="when">\s*<span>([^<]*)<\/span>\s*<span class="dur" data-role="(\d+)">/g;
let pm = whenRe.exec(html);
while (pm) {
  const parts = pm[1].split(/\s+–\s+/);
  fromPage.push({ index: Number(pm[2]),
    start: parts.length === 2 ? pageDate(parts[0]) : `unreadable "${pm[1]}"`,
    end: parts.length === 2 ? pageDate(parts[1]) : `unreadable "${pm[1]}"` });
  pm = whenRe.exec(html);
}

// ---- Agreement -------------------------------------------------------------------------
console.log("Record agreement gate:");
check("role count agrees (record, table, page, role_table_size)",
  fromRecord.length === tableSize && fromTable.length === tableSize &&
  fromPage.length === tableSize,
  `record ${fromRecord.length}, table ${fromTable.length}, page ${fromPage.length}, ` +
  `size ${tableSize}`);

for (let i = 0; i < tableSize; i += 1) {
  const r = fromRecord.find((x) => x.index === i);
  const t = fromTable[i];
  const p = fromPage.find((x) => x.index === i);
  if (!r || !t || !p) {
    check(`role ${i} present in all three`, false,
      `record ${r ? "yes" : "no"}, table ${t ? "yes" : "no"}, page ${p ? "yes" : "no"}`);
  } else {
    check(`role ${i} dates agree`,
      r.start === t.start && r.end === t.end && r.start === p.start && r.end === p.end,
      `record ${r.start} to ${r.end}, table ${t.start} to ${t.end}, ` +
      `page ${p.start} to ${p.end}`);
    check(`role ${i} military flag agrees`, r.military === t.military,
      `record ${r.military ? "military" : "civilian"}, table ${t.military ? 1 : 0}`);
  }
}

// ---- Integrity word --------------------------------------------------------------------
function crc32(text) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < text.length; i += 1) {
    c ^= text.charCodeAt(i);
    for (let b = 0; b < 8; b += 1) { c = (c & 1) ? ((c >>> 1) ^ 0xEDB88320) : (c >>> 1); }
  }
  return ((c ^ 0xFFFFFFFF) >>> 0).toString(16).toUpperCase().padStart(8, "0");
}
const actual = `0x${crc32(record)}`;
const inSource = /record_crc_expected\s*=\s*0x([0-9A-F]{8})U;/.exec(cpp);
const inVerifier = /const EXPECTED_CRC = "(0x[0-9A-F]{8})";/.exec(verifier);
check("record_crc_expected in src/Resume_core.cpp equals the record's CRC-32",
  !!inSource && `0x${inSource[1]}` === actual,
  `${inSource ? "0x" + inSource[1] : "not found"} recorded, ${actual} computed`);
check("EXPECTED_CRC in build/verify.js equals the record's CRC-32",
  !!inVerifier && inVerifier[1] === actual,
  `${inVerifier ? inVerifier[1] : "not found"} recorded, ${actual} computed`);

console.log(failures === 0 ? "Record, table, and page agree." :
  `${failures} check(s) FAILED. If you changed the record on purpose, its CRC-32 is ${actual}.`);
process.exit(failures === 0 ? 0 : 1);
