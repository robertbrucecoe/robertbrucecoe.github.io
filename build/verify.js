// verify.js - Host-side verification harness for the RBC-1 resume logic module.
// Instantiates the wasm module, runs the built-in test, and exercises every export,
// including defensive bounds behavior. Exits non-zero on any failure so the build
// script can gate on it.

const fs = require("fs");

// EXPECTED_CRC is the CRC-32 of the canonical record inside src/Resume_core.cpp, and must
// equal record_crc_expected there. If you edit that record (new role, new dates), both
// change with it: build/record_check.js prints the new value. See MAINTAIN.md.
const EXPECTED_CRC = "0x5A75BE76";

const wasmPath = process.argv[2] || "resume_core.wasm";
let failures = 0;

function check(label, actual, expected) {
  const pass = actual === expected;
  if (!pass) failures += 1;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}: ${actual}${pass ? "" : " (expected " + expected + ")"}`);
}

function crcHex(e) {
  // Reassemble the CRC from its four octets, most significant first. No octet exceeds
  // 255, so the host never receives an out-of-range signed value to reinterpret.
  let s = "0x";
  for (let i = crcOctetCount - 1; i >= 0; i -= 1) {
    s += ("0" + (e.rb_data_crc_octet(i) & 0xFF).toString(16).toUpperCase()).slice(-2);
  }
  return s;
}

const crcOctetCount = 4;

// With RBC_TRACE set to a file path, every call into the module is recorded there as
// [export name, arguments, result], in order. build/coverage_check.js replays that exact
// sequence against an instrumented native build of the same source, so the coverage it
// reports is the coverage of this harness, not of a second copy of its vectors.
const tracePath = process.env.RBC_TRACE || "";
const trace = [];
function traced(exports) {
  const wrapped = {};
  Object.keys(exports).forEach((name) => {
    const f = exports[name];
    wrapped[name] = (typeof f !== "function") ? f : (...args) => {
      const result = f(...args);
      trace.push([name, args, result]);
      return result;
    };
  });
  return wrapped;
}

WebAssembly.instantiate(fs.readFileSync(wasmPath)).then(({ instance }) => {
  const e = tracePath ? traced(instance.exports) : instance.exports;

  // Before initialization the module must report that it has not run its test.
  check("BIT status before rb_init (16 = not initialized)", e.rb_bit_status(), 16);

  // A host clock outside the record's era is clamped and reported, never trusted silently.
  check("clock fault: year 1970 (128 = clock)", e.rb_init(1970, 1), 128);
  check("clock fault: year 2100", e.rb_init(2100, 1), 128);
  check("clock fault: month 13", e.rb_init(2026, 13), 128);
  check("clock fault: month 0", e.rb_init(2026, 0), 128);
  check("clock fault: INT32 extremes", e.rb_init(-2147483648, 2147483647), 128);
  check("rb_bit_status reports the clock fault", e.rb_bit_status(), 128);

  // rb_init clears the section table, so a host always starts from empty.
  e.rb_section_push(0);
  e.rb_section_push(100);

  // Initialize with a fixed date so every check below is deterministic.
  const bit = e.rb_init(2026, 6);
  check("BIT status (0 = nominal)", bit, 0);
  check("rb_bit_status matches rb_init", e.rb_bit_status(), bit);
  check("rb_init leaves the section table empty", e.rb_active_section(5000), 0);
  check("CRC-32 integrity word", crcHex(e), EXPECTED_CRC);
  check("CRC octet out-of-range (low) is 0", e.rb_data_crc_octet(-1), 0);
  check("CRC octet out-of-range (high) is 0", e.rb_data_crc_octet(99), 0);

  // Duration subsystem.
  check("role count", e.rb_role_count(), 6);
  check("Eagle Dynamics months (May 2023 - Jun 2026)", e.rb_role_months(0), 38);
  check("Army battery role months (Jan 2005 - Aug 2015)", e.rb_role_months(5), 128);
  check("total uniformed service months", e.rb_service_months(), 132);
  check("out-of-range role index (low)", e.rb_role_months(-1), 0);
  check("out-of-range role index (high)", e.rb_role_months(99), 0);

  // Easing subsystem: endpoints exact, midpoint symmetric, hostile inputs clamped.
  check("ease at t=0", e.rb_ease(0, 1000, 0, 100), 0);
  check("ease at t=duration", e.rb_ease(1000, 1000, 0, 100), 100);
  check("ease at midpoint", e.rb_ease(500, 1000, 0, 1000), 500);
  check("ease descending, off centre", e.rb_ease(250, 1000, 0, -1000), -156);
  check("ease descending, midpoint", e.rb_ease(500, 1000, 1000, 0), 500);
  check("ease with INT32 extremes (clamped, no UB)", e.rb_ease(2147483647, 2147483647, -2147483648, 2147483647), 1000000);
  check("ease with INT32 extremes, descending", e.rb_ease(2147483647, -2147483648, 2147483647, -2147483648), -1000000);

  // Navigation state machine, fed by value through rb_section_push (no shared memory).
  check("section reset returns 0", e.rb_section_reset(), 0);
  [0, 800, 1600, 2400, 3200, 4000].forEach((offset) => { e.rb_section_push(offset); });
  check("active section at scroll 0", e.rb_active_section(0), 0);
  check("active section at scroll 900", e.rb_active_section(900), 1);
  check("active section at scroll 5000", e.rb_active_section(5000), 5);
  check("active section at INT32 max (clamped, no overflow)", e.rb_active_section(2147483647), 5);
  check("active section at INT32 min (clamped)", e.rb_active_section(-2147483648), 0);

  // Capacity guard: pushing past the fixed table size must be rejected, never overrun.
  e.rb_section_reset();
  let acceptedAll = true;
  let rejectedPastCapacity = false;
  for (let i = 0; i < 64; i += 1) {
    const ok = e.rb_section_push(i * 100);
    if (i < 16 && ok !== 1) { acceptedAll = false; }
    if (i >= 16 && ok === 0) { rejectedPastCapacity = true; }
  }
  check("section table accepts up to capacity", acceptedAll, true);
  check("section table rejects beyond capacity (no overrun)", rejectedPastCapacity, true);

  if (tracePath) { fs.writeFileSync(tracePath, JSON.stringify(trace)); }
  console.log(failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
});
