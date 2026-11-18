// analysis_check.js - fatal static-analysis gate.
//
// clang-tidy exits zero when it reports warnings, so running it alone can never fail the
// build. This gate runs clang-tidy itself, reads every finding, and fails the build on any
// finding that is not in the accepted list below. It also fails if an accepted finding no
// longer appears, so the list here and the "Accepted static-analysis findings" section of
// STANDARD.md cannot drift from what the analyzer actually reports. Findings are matched by
// check name and function, not line number, so editing unrelated code does not disturb them.
//
// Usage: node analysis_check.js <path to clang-tidy> [source file]
// Exits non-zero if clang-tidy fails to run, reports an error, or reports any finding that
// does not match the accepted list exactly.

const childProcess = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const tidy = process.argv[2];
const src = process.argv[3] || path.join(root, "src", "Resume_core.cpp");
const inc = path.dirname(src);

const checks = [
  "clang-analyzer-*", "bugprone-*", "cppcoreguidelines-avoid-goto",
  "cppcoreguidelines-avoid-magic-numbers", "readability-function-size",
  "readability-function-cognitive-complexity", "misc-no-recursion"
].join(",");

// Each accepted finding is documented, with its mitigation, in STANDARD.md.
const accepted = [
  { check: "bugprone-easily-swappable-parameters", fn: "clamp_int32", count: 1 },
  { check: "bugprone-easily-swappable-parameters", fn: "months_inclusive", count: 2 }
];

if (!tidy) {
  console.log("  FAIL  usage: node analysis_check.js <path to clang-tidy> [source file]");
  process.exit(1);
}

const result = childProcess.spawnSync(tidy, [
  src, `-checks=${checks}`, "-quiet", "--",
  "--target=wasm32", "-std=c++03", "-nostdlib", "-ffreestanding",
  "-fno-exceptions", "-fno-rtti", "-I", inc
], { encoding: "utf8" });

if (result.error) {
  console.log(`  FAIL  clang-tidy did not run: ${result.error.message}`);
  process.exit(1);
}

const output = `${result.stdout || ""}\n${result.stderr || ""}`;
const findingPattern = /^(.*?):(\d+):(\d+): (warning|error): (.*) \[([^\]]+)\]\s*$/;
const findings = [];
output.split(/\r?\n/).forEach((line) => {
  const m = findingPattern.exec(line);
  if (m) {
    const fnMatch = /of '([^']+)'/.exec(m[5]);
    findings.push({
      where: `${path.basename(m[1])}:${m[2]}`,
      severity: m[4],
      message: m[5],
      check: m[6],
      fn: fnMatch ? fnMatch[1] : ""
    });
  }
});

let failures = 0;
function check(label, pass, detail) {
  if (!pass) { failures += 1; }
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ": " + detail : ""}`);
}

check("clang-tidy completed", result.status === 0 && !/error:/.test(output),
  result.status === 0 ? "" : `exit status ${result.status}`);

const unexpected = findings.filter((f) =>
  f.severity !== "warning" || !accepted.some((a) => a.check === f.check && a.fn === f.fn));
unexpected.forEach((f) => {
  console.log(`  FAIL  ${f.where}  [${f.check}] ${f.message}`);
});
check("no finding outside the accepted list", unexpected.length === 0,
  `${unexpected.length} unaccepted finding(s)`);

accepted.forEach((a) => {
  const n = findings.filter((f) => f.check === a.check && f.fn === a.fn).length;
  check(`accepted finding ${a.check} in ${a.fn}`, n === a.count,
    `${n} reported, ${a.count} documented`);
});

console.log(failures === 0 ? "Static analysis: only the documented findings." :
  `${failures} check(s) FAILED. Fix the code, or document the finding in STANDARD.md and here.`);
process.exit(failures === 0 ? 0 : 1);
