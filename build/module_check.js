// module_check.js - interface gate for the shipped RBC-1 module.
//
// verify.js proves what the module computes. This gate proves what the module is, by reading
// the binary itself, so the claims in STANDARD.md about the module boundary are measured on
// every build rather than asserted:
//
//   - Imports nothing (no host function, memory, table, or global comes in)       [AV Rule 206]
//   - Runs nothing at instantiation (no start function)
//   - Exports exactly the declared functions and nothing else: no memory, no table, no
//     global, so no code outside the module can read or write its state           [AV Rule 207]
//   - Declares one linear memory with a fixed maximum equal to its initial size, so the
//     memory cannot grow at run time                                       [AV Rules 15, 206]
//   - Contains no memory.grow instruction in any function body                     [AV Rule 206]
//
// The instruction walk fails closed: an opcode this gate does not recognize is a failure,
// because an unread instruction is an unproven one. Exits non-zero on any failure.

const fs = require("fs");

// Must match EXPORTS in build.sh and build.ps1 and the extern "C" block in src/Resume_core.h.
const expectedExports = [
  "rb_init", "rb_bit_status", "rb_data_crc_octet",
  "rb_role_count", "rb_role_months", "rb_service_months",
  "rb_ease", "rb_section_reset", "rb_section_push", "rb_active_section"
];

const wasmPath = process.argv[2] || "resume_core.wasm";
const bytes = fs.readFileSync(wasmPath);
let failures = 0;
let pos = 0;

function check(label, pass, detail) {
  if (!pass) { failures += 1; }
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ": " + detail : ""}`);
}

function abort(msg) {
  console.log(`  FAIL  module_check could not read ${wasmPath}: ${msg}`);
  process.exit(1);
}

function readU32() {
  let result = 0;
  let shift = 0;
  let byte = 0;
  do {
    if (pos >= bytes.length) { abort("truncated LEB128 value"); }
    byte = bytes[pos];
    pos += 1;
    result |= (byte & 0x7F) << shift;
    shift += 7;
  } while ((byte & 0x80) !== 0 && shift < 35);
  if ((byte & 0x80) !== 0) { abort("malformed LEB128 value"); }
  return result >>> 0;
}

function skipLeb() {
  let byte = 0;
  let count = 0;
  do {
    if (pos >= bytes.length) { abort("truncated LEB128 value"); }
    byte = bytes[pos];
    pos += 1;
    count += 1;
  } while ((byte & 0x80) !== 0 && count < 10);
  if ((byte & 0x80) !== 0) { abort("malformed LEB128 value"); }
}

function readName() {
  const length = readU32();
  const name = bytes.subarray(pos, pos + length).toString("utf8");
  pos += length;
  return name;
}

// Block types: empty (0x40), a single value type, or a signed type index.
const singleByteBlockTypes = [0x40, 0x7F, 0x7E, 0x7D, 0x7C, 0x7B, 0x70, 0x6F];

// Walks one function body. Returns the number of memory.grow instructions, or -1 with a
// reason recorded in walkError if the body contains an instruction the gate does not read.
let walkError = "";
function countMemoryGrow(bodyEnd) {
  let grows = 0;
  const localGroups = readU32();
  for (let i = 0; i < localGroups; i += 1) { readU32(); pos += 1; }
  while (pos < bodyEnd) {
    const op = bytes[pos];
    pos += 1;
    if (op === 0x00 || op === 0x01 || op === 0x05 || op === 0x0B || op === 0x0F ||
        op === 0x1A || op === 0x1B || op === 0xD1 || (op >= 0x45 && op <= 0xC4)) {
      // no immediates: control, drop, select, ref.is_null, numeric
    } else if (op >= 0x02 && op <= 0x04) {
      if (singleByteBlockTypes.indexOf(bytes[pos]) >= 0) { pos += 1; } else { skipLeb(); }
    } else if (op === 0x0C || op === 0x0D || op === 0x10 || op === 0xD2 ||
               (op >= 0x20 && op <= 0x26)) {
      readU32();
    } else if (op === 0x0E) {
      const targets = readU32();
      for (let i = 0; i <= targets; i += 1) { readU32(); }
    } else if (op === 0x11) {
      readU32(); readU32();
    } else if (op === 0x1C) {
      const types = readU32();
      pos += types;
    } else if (op >= 0x28 && op <= 0x3E) {
      readU32(); skipLeb();   // memarg: alignment, offset
    } else if (op === 0x3F) {
      readU32();              // memory.size
    } else if (op === 0x40) {
      readU32();              // memory.grow
      grows += 1;
    } else if (op === 0x41 || op === 0x42) {
      skipLeb();
    } else if (op === 0x43) {
      pos += 4;
    } else if (op === 0x44) {
      pos += 8;
    } else if (op === 0xD0) {
      pos += 1;
    } else if (op === 0xFC) {
      const sub = readU32();
      if (sub <= 7) {
        // saturating float-to-int conversions: no immediates
      } else if (sub === 8) {
        readU32(); readU32();   // memory.init
      } else if (sub === 9 || sub === 11 || sub === 13 || (sub >= 15 && sub <= 17)) {
        readU32();
      } else if (sub === 10 || sub === 12 || sub === 14) {
        readU32(); readU32();
      } else {
        walkError = `unrecognized instruction 0xFC ${sub}`;
        return -1;
      }
    } else {
      walkError = `unrecognized opcode 0x${op.toString(16).toUpperCase()}`;
      return -1;
    }
  }
  if (pos !== bodyEnd) {
    walkError = "function body length does not match its instructions";
    return -1;
  }
  return grows;
}

const header = [0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];
for (let i = 0; i < header.length; i += 1) {
  if (bytes[i] !== header[i]) { abort("not a version 1 WebAssembly binary"); }
}
pos = header.length;

let importCount = 0;
let hasStart = false;
let exportsFound = [];
let memories = [];
let memoryGrowCount = 0;
let codeReadable = true;
let codeDetail = "";

while (pos < bytes.length) {
  const id = bytes[pos];
  pos += 1;
  const length = readU32();
  const sectionEnd = pos + length;
  if (sectionEnd > bytes.length) { abort(`section ${id} runs past the end of the file`); }

  if (id === 2) {
    importCount = readU32();
  } else if (id === 5) {
    const count = readU32();
    for (let i = 0; i < count; i += 1) {
      const flags = readU32();
      const initial = readU32();
      const maximum = ((flags & 1) === 1) ? readU32() : null;
      memories.push({ initial: initial, maximum: maximum });
    }
  } else if (id === 7) {
    const count = readU32();
    for (let i = 0; i < count; i += 1) {
      const name = readName();
      const kind = bytes[pos];
      pos += 1;
      readU32();
      exportsFound.push({ name: name, kind: kind });
    }
  } else if (id === 8) {
    hasStart = true;
  } else if (id === 10) {
    const count = readU32();
    for (let i = 0; i < count && codeReadable; i += 1) {
      const size = readU32();
      const bodyEnd = pos + size;
      const grows = countMemoryGrow(bodyEnd);
      if (grows < 0) {
        codeReadable = false;
        codeDetail = `function ${i}: ${walkError}`;
      } else {
        memoryGrowCount += grows;
      }
      pos = bodyEnd;
    }
  }
  pos = sectionEnd;
}

const kindNames = ["function", "table", "memory", "global"];
const functionExports = exportsFound.filter((x) => x.kind === 0).map((x) => x.name);
const otherExports = exportsFound.filter((x) => x.kind !== 0)
  .map((x) => `${x.name} (${kindNames[x.kind] || "kind " + x.kind})`);
const missing = expectedExports.filter((n) => functionExports.indexOf(n) < 0);
const extra = functionExports.filter((n) => expectedExports.indexOf(n) < 0);

console.log(`Module interface gate: ${wasmPath}`);
check("imports nothing", importCount === 0, `${importCount} import(s)`);
check("no start function", !hasStart);
check("exports no memory, table, or global", otherExports.length === 0,
  otherExports.length === 0 ? "" : otherExports.join(", "));
check("exports exactly the declared functions", missing.length === 0 && extra.length === 0,
  `${functionExports.length} function export(s)` +
  (missing.length ? `; missing ${missing.join(", ")}` : "") +
  (extra.length ? `; undeclared ${extra.join(", ")}` : ""));
check("one linear memory", memories.length === 1, `${memories.length} declared`);
if (memories.length === 1) {
  const m = memories[0];
  check("memory has a fixed maximum equal to its initial size",
    m.maximum !== null && m.maximum === m.initial,
    `initial ${m.initial} page(s), maximum ${m.maximum === null ? "none" : m.maximum + " page(s)"}`);
}
check("every function body read", codeReadable, codeDetail);
check("no memory.grow instruction", codeReadable && memoryGrowCount === 0,
  codeReadable ? `${memoryGrowCount} found` : "not proven");

console.log(failures === 0 ? "Module interface verified." : `${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
