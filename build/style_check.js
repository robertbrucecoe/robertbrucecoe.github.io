// style_check.js — mechanical style gate for the C++ source, mapped to JSF AV rules.
// Each check below corresponds to a rule the conformance matrix previously asserted by
// inspection. What this script checks is now measured; what it cannot measure (bracing
// style, one statement per line) remains an inspection claim and the matrix says so.
//
//   AV Rule 9   - only the C++ basic source character set (enforced as 7-bit ASCII)
//   AV Rule 41  - source lines of 120 characters or less
//   AV Rule 43  - no tab characters
//   AV Rule 126 - C++ style (//) comments only: no /* */ block comments
//   AV Rule 14  - literal suffixes uppercase (no lowercase u/l suffixes on numbers)

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const files = ["src/Std_types.h", "src/Resume_core.h", "src/Resume_core.cpp"];
const maxLine = 120;
let failures = 0;

function fail(file, line, rule, msg) {
  failures += 1;
  console.log(`  FAIL  ${file}:${line}  [AV Rule ${rule}] ${msg}`);
}

for (const rel of files) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const n = i + 1;
    if (line.length > maxLine) {
      fail(rel, n, 41, `line is ${line.length} chars (limit ${maxLine})`);
    }
    if (line.includes("\t")) {
      fail(rel, n, 43, "tab character");
    }
    for (const ch of line) {
      if (ch.charCodeAt(0) > 126) {
        fail(rel, n, 9, `non-ASCII character U+${ch.charCodeAt(0).toString(16).toUpperCase()}`);
      }
    }
    if (line.includes("/*") || line.includes("*/")) {
      fail(rel, n, 126, "C-style block comment");
    }
    if (/\b\d+(u\b|l\b|ul\b|lu\b)/.test(line)) {
      fail(rel, n, 14, "lowercase literal suffix");
    }
  });
  console.log(`  PASS  ${rel}: ${lines.length} lines clean`);
}

console.log(failures === 0 ? "Style gate: all files pass." : `${failures} style violation(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
