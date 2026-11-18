// bit_faults.js - the faults injected into the built-in test, shared by two gates.
//
// Each entry changes exactly one line of a copy of src/Resume_core.cpp, the way a failing
// part would, and names the fault code the built-in test must report for it.
// build/bit_fault_check.js requires each code exactly. build/coverage_check.js runs the
// same faulty builds instrumented, to show that every fault-report statement of the test,
// which the nominal module never executes, does execute when its fault is present.
// Every replacement keeps the line count, so line numbers match the unmodified source.

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
  { name: "Navigation: capacity guard refuses pushes below capacity",
    find: "if (s_section_count < offset_table_size)", replace: "if (s_section_count < 2)",
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

module.exports = { loadYear, loadMonth, injections };
