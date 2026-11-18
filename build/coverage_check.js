// coverage_check.js - structural coverage gate for the logic module.
//
// The wasm target has no coverage run-time, so coverage is measured on a native build of
// the same source file, compiled with gcc's coverage instrumentation. The calls are not a
// second copy of the test vectors: build/verify.js is run against the wasm module with
// RBC_TRACE set, which records every call it makes and every result the module returned.
// That exact sequence is replayed against the native build, so the coverage reported is
// the coverage achieved by the power-on built-in test (which every rb_init call runs) and
// the verification harness together.
//
// A sound module never executes the statements that report a built-in test failure, so a
// nominal run cannot cover them. Those are covered the only honest way: each fault from
// build/bit_faults.js is built instrumented, initialized, and measured. A line or branch
// outcome the nominal run missed counts as covered only if some injected fault reaches it,
// and the gate lists how many were covered that way.
//
// The gate requires:
//   1. every call in the replay returns on the native build what the wasm module returned
//      (the integer arithmetic is the same on both targets; a difference fails the gate);
//   2. every exported function is called;
//   3. every executable line of src/Resume_core.cpp executed;
//   4. every branch outcome taken: both sides of every decision, and of every operand of
//      && and ||, as gcov counts them.
// MC/DC (each condition shown to affect its decision independently) is not measured. The
// toolchain here (gcc 13) has no MC/DC instrumentation, and this gate does not claim it.
//
// Usage: node coverage_check.js <module.wasm>   (needs g++ and gcov on the path)
// Exits non-zero on any mismatch, unexecuted line, or untaken branch outcome.

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadYear, loadMonth, injections } = require("./bit_faults.js");

const root = path.join(__dirname, "..");
const wasm = process.argv[2];
const sourceName = "Resume_core.cpp";
const exportCount = 10;
const source = fs.readFileSync(path.join(root, "src", sourceName), "utf8");

let failures = 0;
function check(label, pass, detail) {
  if (!pass) { failures += 1; }
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ": " + detail : ""}`);
}
function stop(message) {
  console.log(`  FAIL  ${message}`);
  process.exit(1);
}
function run(cmd, args, cwd, env) {
  const r = childProcess.spawnSync(cmd, args, { cwd, encoding: "utf8",
    env: Object.assign({}, process.env, env || {}), maxBuffer: 16 * 1024 * 1024 });
  if (r.error) { stop(`${cmd} could not run: ${r.error.message}`); }
  return r;
}

if (!wasm) { stop("usage: node coverage_check.js <module.wasm>"); }
const work = fs.mkdtempSync(path.join(os.tmpdir(), "rbc-coverage-"));

// Build `moduleText` with coverage instrumentation, link it with `driverText`, run it, and
// return its exit status, its output, and gcov's per-line view of the module:
// lines: Map(line -> executed?), branches: Map("line:ordinal" -> taken?).
function measure(name, moduleText, driverText) {
  const dir = path.join(work, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, sourceName), moduleText);
  fs.writeFileSync(path.join(dir, "driver.cpp"), driverText);
  fs.copyFileSync(path.join(root, "src", "Resume_core.h"), path.join(dir, "Resume_core.h"));
  fs.copyFileSync(path.join(root, "src", "Std_types.h"), path.join(dir, "Std_types.h"));
  // The module is compiled on its own so its coverage notes are named after it; the
  // driver is not instrumented, since only the module's coverage is measured.
  const flags = ["-std=c++03", "-O0", "-fno-exceptions", "-fno-rtti", "-I", dir];
  [["--coverage", "-c", sourceName, "-o", "Resume_core.o"],
   ["-c", "driver.cpp", "-o", "driver.o"],
   ["--coverage", "Resume_core.o", "driver.o", "-o", "driver"]].forEach((step) => {
    const b = run("g++", flags.concat(step), dir);
    if (b.status !== 0) { stop(`${name}: native build failed: ${b.stderr.trim().split("\n")[0]}`); }
  });
  const exe = run(path.join(dir, "driver"), [], dir);
  const g = run("gcov", ["-b", "-c", "-o", dir, "Resume_core.o"], dir);
  const report = path.join(dir, `${sourceName}.gcov`);
  if (g.status !== 0 || !fs.existsSync(report)) { stop(`${name}: gcov produced no report`); }
  const lines = new Map();
  const branches = new Map();
  let current = 0;
  let ordinal = 0;
  fs.readFileSync(report, "utf8").split("\n").forEach((row) => {
    const m = /^\s*([^:]+):\s*(\d+):/.exec(row);
    if (m) {
      current = Number(m[2]);
      ordinal = 0;
      const count = m[1].trim();
      if (current > 0 && count !== "-") { lines.set(current, !/^#####|^=====/.test(count)); }
      return;
    }
    const b = /^branch\s+\d+\s+(taken (\d+)|never executed)/.exec(row);
    if (b) {
      const key = `${current}:${ordinal}`;
      ordinal += 1;
      branches.set(key, b[1] !== "never executed" && Number(b[2]) > 0);
    }
  });
  return { status: exe.status, output: exe.stdout.trim(), lines, branches };
}

// ---- 1. Record the harness's calls against the wasm module -----------------------------
const tracePath = path.join(work, "trace.json");
const v = run("node", [path.join(root, "build", "verify.js"), path.resolve(wasm)], root,
  { RBC_TRACE: tracePath });
if (v.status !== 0 || !fs.existsSync(tracePath)) {
  stop("build/verify.js failed or wrote no trace; run it on its own first");
}
const trace = JSON.parse(fs.readFileSync(tracePath, "utf8"));
const exportsUsed = new Set(trace.map((c) => c[0]));

// ---- 2. Replay them against an instrumented native build -------------------------------
const toInt = (x) => (x === true ? 1 : (x === false ? 0 : x));
const calls = trace.map((c, i) => {
  const args = c[1].map((a) => (a === -2147483648 ? "(-2147483647 - 1)" : String(a)));
  return `  expect(${i}, "${c[0]}", Rbc::${c[0]}(${args.join(", ")}), ${toInt(c[2])});`;
});
const replayDriver = `// Generated by build/coverage_check.js from the build/verify.js trace.
#include <cstdio>
#include <Resume_core.h>
static int mismatches = 0;
static void expect(int index, const char* name, int actual, int wasm_result)
{
  if (actual != wasm_result)
  {
    std::printf("call %d %s: native %d, wasm %d\\n", index, name, actual, wasm_result);
    mismatches += 1;
  }
}
int main()
{
${calls.join("\n")}
  std::printf("replayed ${trace.length} calls, %d mismatch(es)\\n", mismatches);
  return (mismatches == 0) ? 0 : 1;
}
`;
const nominal = measure("nominal", source, replayDriver);
console.log("Structural coverage gate:");
check("native build agrees with the wasm module on every call", nominal.status === 0,
  nominal.output.split("\n").slice(-1)[0]);
check("harness calls every exported function", exportsUsed.size === exportCount,
  `${exportsUsed.size} of ${exportCount}`);

// ---- 3. Reach what the nominal run cannot: the fault-report statements -----------------
const missedLines = [...nominal.lines].filter(([, hit]) => !hit).map(([line]) => line);
const missedBranches = [...nominal.branches].filter(([, hit]) => !hit).map(([key]) => key);
const reachedLines = new Set();
const reachedBranches = new Set();
const initDriver = `#include <Resume_core.h>
int main()
{
  return (Rbc::rb_init(${loadYear}, ${loadMonth}) == 0) ? 1 : 0;   // a fault must be reported
}
`;
injections.forEach((inj, n) => {
  const at = source.indexOf(inj.find);
  if (at < 0 || source.indexOf(inj.find, at + 1) >= 0) {
    check(`fault "${inj.name}" applies`, false, "injection site not found exactly once");
    return;
  }
  const injectedLine = source.slice(0, at).split("\n").length;
  const faulty = measure(`fault${n}`, source.replace(inj.find, inj.replace), initDriver);
  if (faulty.status !== 0) {
    check(`fault "${inj.name}" is reported`, false, "rb_init returned nominal");
    return;
  }
  // The injected line is not the original code, so its own counts are not credited.
  missedLines.forEach((line) => {
    if (line !== injectedLine && faulty.lines.get(line)) { reachedLines.add(line); }
  });
  missedBranches.forEach((key) => {
    if (Number(key.split(":")[0]) !== injectedLine && faulty.branches.get(key)) {
      reachedBranches.add(key);
    }
  });
});

// ---- 4. Coverage -----------------------------------------------------------------------
const lineCount = nominal.lines.size;
const branchCount = nominal.branches.size;
const lineGaps = missedLines.filter((line) => !reachedLines.has(line));
const branchGaps = missedBranches.filter((key) => !reachedBranches.has(key));
check("every executable line executed", lineCount > 0 && lineGaps.length === 0,
  `${lineCount - lineGaps.length} of ${lineCount}, ${reachedLines.size} of them only under ` +
  `an injected fault` + (lineGaps.length ? `; never executed: line ${lineGaps.join(", ")}` : ""));
check("every branch outcome taken", branchCount > 0 && branchGaps.length === 0,
  `${branchCount - branchGaps.length} of ${branchCount}, ${reachedBranches.size} of them only ` +
  `under an injected fault` + (branchGaps.length ? `; never taken at line ` +
  Array.from(new Set(branchGaps.map((k) => k.split(":")[0]))).join(", ") : ""));

fs.rmSync(work, { recursive: true, force: true });
console.log(failures === 0 ?
  "Every line and every branch outcome of the module is exercised: by the built-in test and " +
  "harness, or, for the fault reports, by the fault that triggers them." :
  `${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
