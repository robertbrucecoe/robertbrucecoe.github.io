// bit_fault_check.js - fault-injection gate for the built-in test.
//
// A built-in test that has never been seen to fail proves nothing: it may pass because the
// module is sound or because the test cannot see the fault. This gate builds the module
// once from the unmodified source, which must report nominal, and then once per injected
// fault. Each injection changes exactly one line of a copy of the source, the way a
// failing part would: a corrupted constant, a wrong comparison, a lost clamp, an altered
// record. The built-in test must report exactly the expected fault code for every one, so
// each subsystem is shown to detect a fault in itself and only in itself.
//
// The host-clock check is exercised at run time by build/verify.js, which passes dates
// outside the record's era to rb_init; it needs no rebuilt module.
//
// Usage: node bit_fault_check.js <path to clang++>
// Exits non-zero if any build fails, if an injection site is not found exactly once, or if
// any module reports a code other than the one expected.

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const clang = process.argv[2];
const srcDir = path.join(root, "src");
const sourceName = "Resume_core.cpp";
const source = fs.readFileSync(path.join(srcDir, sourceName), "utf8");

// The injected faults and the load date are shared with build/coverage_check.js, which
// uses them to show that every fault-report statement of the built-in test can execute.
const { loadYear, loadMonth, injections } = require("./bit_faults.js");

let failures = 0;
function check(label, pass, detail) {
  if (!pass) { failures += 1; }
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ": " + detail : ""}`);
}

if (!clang) {
  console.log("  FAIL  usage: node bit_fault_check.js <path to clang++>");
  process.exit(1);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "bit-fault-"));
fs.copyFileSync(path.join(srcDir, "Std_types.h"), path.join(work, "Std_types.h"));
fs.copyFileSync(path.join(srcDir, "Resume_core.h"), path.join(work, "Resume_core.h"));

function buildAndTest(text) {
  const cpp = path.join(work, sourceName);
  const wasm = path.join(work, "fault.wasm");
  fs.writeFileSync(cpp, text);
  const r = childProcess.spawnSync(clang, [
    "--target=wasm32", "-std=c++03", "-nostdlib", "-ffreestanding", "-fno-exceptions",
    "-fno-rtti", "-O2", "-I", work, "-Wl,--no-entry", "-Wl,--export=rb_init",
    "-o", wasm, cpp
  ], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    return { error: r.error ? r.error.message : r.stderr.trim().split("\n")[0] };
  }
  const instance = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(wasm)));
  return { code: instance.exports.rb_init(loadYear, loadMonth) };
}

console.log("Built-in test fault injection:");
const control = buildAndTest(source);
check("unmodified source reports nominal", control.code === 0,
  control.error ? `build failed: ${control.error}` : `code ${control.code}`);

injections.forEach((inj) => {
  const sites = source.split(inj.find).length - 1;
  if (sites !== 1) {
    check(inj.name, false, `injection site found ${sites} times, expected once`);
    return;
  }
  const result = buildAndTest(source.replace(inj.find, inj.replace));
  check(inj.name, result.code === inj.expected,
    result.error ? `build failed: ${result.error}` :
      `code ${result.code}, expected ${inj.expected}`);
});

fs.rmSync(work, { recursive: true, force: true });
console.log(failures === 0 ?
  `Every injected fault was detected by its own subsystem (${injections.length} faults).` :
  `${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
