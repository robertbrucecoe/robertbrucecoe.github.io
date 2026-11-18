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

// Bit_condition codes, as defined in src/Resume_core.cpp.
const crc = 1;
const ease = 2;
const duration = 4;
const bounds = 8;
const record = 32;
const navigation = 64;

// The load date every module is initialized with. In range, so no clock fault.
const loadYear = 2026;
const loadMonth = 6;

const injections = [
  { name: "CRC engine: polynomial corrupted",
    find: "crc32_polynomial    = 0xEDB88320U;", replace: "crc32_polynomial    = 0xEDB88321U;",
    expected: crc | record },
  { name: "CRC octet transport: wrong shift",
    find: "int32  shift = (octet_index * bits_per_byte);",
    replace: "int32  shift = ((octet_index * bits_per_byte) + 1);",
    expected: crc },
  { name: "Easing: smoothstep coefficient corrupted",
    find: "smooth_three         = 768;", replace: "smooth_three         = 769;",
    expected: ease },
  { name: "Easing: descending excursion applied with the wrong sign",
    find: "direction = -1;", replace: "direction = 1;",
    expected: ease },
  { name: "Duration: inclusive month lost",
    find: "int32 month_span = ((end_month - start_month) + 1);",
    replace: "int32 month_span = (end_month - start_month);",
    expected: duration },
  { name: "Duration: open role closed at the wrong month",
    find: "end_month = s_current_month;", replace: "end_month = last_month;",
    expected: duration },
  { name: "Bounds: out-of-range role index answers 1",
    find: "int32 result = 0;                      // out-of-range answer by default",
    replace: "int32 result = 1;                      // out-of-range answer by default",
    expected: bounds },
  { name: "Bounds: out-of-range CRC octet index answers 1",
    find: "int32 result = 0;                      // out-of-range default",
    replace: "int32 result = 1;                      // out-of-range default",
    expected: bounds },
  { name: "Navigation: activation boundary off by one",
    find: "if (s_section_offsets[section_index] <= threshold)",
    replace: "if (s_section_offsets[section_index] < threshold)",
    expected: navigation },
  { name: "Navigation: scroll clamp lost",
    find: "int32 safe_scroll   = clamp_int32(scroll_position, 0, max_scroll_position);",
    replace: "int32 safe_scroll   = scroll_position;",
    expected: navigation },
  { name: "Navigation: capacity guard admits one too many",
    find: "if (s_section_count < offset_table_size)",
    replace: "if (s_section_count < (offset_table_size + 1))",
    expected: navigation },
  { name: "Record: one character of the record altered",
    find: "\"NAME=ROBERT COE;\"", replace: "\"NAME=ROBERT CUE;\"",
    expected: record },
  { name: "Record: recorded CRC-32 altered",
    find: "record_crc_expected = 0x5A75BE76U;", replace: "record_crc_expected = 0x5A75BE77U;",
    expected: record }
];

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
