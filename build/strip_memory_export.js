// strip_memory_export.js - post-link step that removes the linear-memory export.
//
// wasm-ld exports the module's linear memory under the name "memory" by default and has no
// switch to turn that off. An exported memory hands the host a live view of every byte of
// module state: the CRC table, the stored built-in test result, the section table. That
// contradicts the encapsulation claim in STANDARD.md and AV Rule 207 as cited in the source.
// This step rewrites the export section without that one entry and copies every other
// section through byte for byte. The code, data, and name sections are untouched, so the
// module computes exactly what it computed before; only the host's handle on memory goes.
//
// Usage: node strip_memory_export.js <input.wasm> <output.wasm>   (output may equal input)
// Exits non-zero unless exactly one memory export named "memory" was found and removed, so
// a toolchain change that renames, duplicates, or drops the export fails the build loudly.

const fs = require("fs");

const wasmMagic = [0x00, 0x61, 0x73, 0x6D];   // "\0asm"
const wasmVersion = [0x01, 0x00, 0x00, 0x00];  // binary format version 1
const headerBytes = 8;
const exportSectionId = 7;
const memoryKind = 2;

function fail(msg) {
  console.error(`  FAIL  strip_memory_export: ${msg}`);
  process.exit(1);
}

function encodeU32(value) {
  const out = [];
  let n = value >>> 0;
  do {
    let byte = n & 0x7F;
    n >>>= 7;
    if (n !== 0) { byte |= 0x80; }
    out.push(byte);
  } while (n !== 0);
  return Buffer.from(out);
}

const inPath = process.argv[2];
const outPath = process.argv[3];
if (!inPath || !outPath) { fail("usage: node strip_memory_export.js <input.wasm> <output.wasm>"); }

const bytes = fs.readFileSync(inPath);
let pos = 0;

function readU32() {
  let result = 0;
  let shift = 0;
  let byte = 0;
  do {
    if (pos >= bytes.length) { fail("truncated LEB128 value"); }
    byte = bytes[pos];
    pos += 1;
    result |= (byte & 0x7F) << shift;
    shift += 7;
  } while ((byte & 0x80) !== 0 && shift < 35);
  if ((byte & 0x80) !== 0) { fail("malformed LEB128 value"); }
  return result >>> 0;
}

for (let i = 0; i < headerBytes; i += 1) {
  const expected = (i < 4) ? wasmMagic[i] : wasmVersion[i - 4];
  if (bytes[i] !== expected) { fail("not a version 1 WebAssembly binary"); }
}

const parts = [bytes.subarray(0, headerBytes)];
let removed = 0;
let exportSections = 0;
pos = headerBytes;

while (pos < bytes.length) {
  const sectionStart = pos;
  const id = bytes[pos];
  pos += 1;
  const length = readU32();
  const bodyStart = pos;
  const sectionEnd = bodyStart + length;
  if (sectionEnd > bytes.length) { fail(`section ${id} runs past the end of the file`); }

  if (id === exportSectionId) {
    exportSections += 1;
    const count = readU32();
    const kept = [];
    for (let i = 0; i < count; i += 1) {
      const entryStart = pos;
      const nameLength = readU32();
      const name = bytes.subarray(pos, pos + nameLength).toString("utf8");
      pos += nameLength;
      const kind = bytes[pos];
      pos += 1;
      readU32();   // index of the exported item
      const entry = bytes.subarray(entryStart, pos);
      if (kind === memoryKind && name === "memory") {
        removed += 1;
      } else {
        kept.push(entry);
      }
    }
    if (pos !== sectionEnd) { fail("export section length does not match its contents"); }
    const body = Buffer.concat([encodeU32(kept.length), ...kept]);
    parts.push(Buffer.from([exportSectionId]), encodeU32(body.length), body);
  } else {
    parts.push(bytes.subarray(sectionStart, sectionEnd));
  }
  pos = sectionEnd;
}

if (exportSections !== 1) { fail(`expected one export section, found ${exportSections}`); }
if (removed !== 1) { fail(`expected exactly one memory export named "memory", found ${removed}`); }

fs.writeFileSync(outPath, Buffer.concat(parts));
console.log(`  PASS  memory export removed: ${outPath}`);
