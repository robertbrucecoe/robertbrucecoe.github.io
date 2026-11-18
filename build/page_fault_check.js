// page_fault_check.js - gate for what the page shows after a built-in test fault.
//
// The module's built-in test is only useful if a fault changes what a reader sees. This
// gate loads the page twice in a pinned headless Chrome and reads the finished document:
//
//   1. With the committed module. The page must report BIT NOMINAL, show the integrity
//      word, fill one COMPUTED badge per role, and set the service and Eagle Dynamics
//      counters from the module.
//   2. With a copy of the committed module in which one byte of the canonical record has
//      been altered, the way a corrupted download would be. The module must report the
//      record fault, and the page must state BIT FAULT, withhold the integrity word, and
//      show no computed value: no badge filled, counters left at their static text.
//
// Usage: CHROME=<path to chrome or chrome-headless-shell> node page_fault_check.js
// Requires python3 (for a localhost server, since the module will not load from file://).
// Exits non-zero on any failure.

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const chrome = process.env.CHROME;
const port = Number(process.env.PORT || 8139);
const recordFault = 32;   // bit_fail_record in src/Resume_core.cpp

let failures = 0;
function check(label, pass, detail) {
  if (!pass) { failures += 1; }
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ": " + detail : ""}`);
}
function stop(message) {
  console.log(`  FAIL  ${message}`);
  process.exit(1);
}

if (!chrome) { stop("usage: CHROME=<path to chrome> node page_fault_check.js"); }

// Two copies of the site: the committed one, and one whose module carries a corrupted record.
function stage(name, corrupt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `page-${name}-`));
  fs.copyFileSync(path.join(root, "index.html"), path.join(dir, "index.html"));
  fs.cpSync(path.join(root, "fonts"), path.join(dir, "fonts"), { recursive: true });
  const wasm = fs.readFileSync(path.join(root, "resume_core.wasm"));
  if (corrupt) {
    const marker = Buffer.from("NAME=ROBERT COE;", "ascii");
    const at = wasm.indexOf(marker);
    if (at < 0 || wasm.indexOf(marker, at + 1) >= 0) {
      stop("the record text was not found exactly once in resume_core.wasm");
    }
    wasm[at + marker.length - 3] = "U".charCodeAt(0);   // COE becomes CUE
  }
  fs.writeFileSync(path.join(dir, "resume_core.wasm"), wasm);
  return dir;
}

function render(dir) {
  const server = childProcess.spawn("python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", dir],
    { stdio: "ignore" });
  try {
    const deadline = Date.now() + 10000;
    let up = false;
    while (!up && Date.now() < deadline) {
      up = childProcess.spawnSync("curl", ["-fsS", "-o", "/dev/null",
        `http://127.0.0.1:${port}/index.html`]).status === 0;
      if (!up) { childProcess.spawnSync("sleep", ["0.2"]); }
    }
    if (!up) { stop(`local server did not start on port ${port}`); }
    const r = childProcess.spawnSync(chrome, [
      "--headless", "--no-sandbox", "--disable-gpu", "--force-prefers-reduced-motion",
      "--virtual-time-budget=15000", "--dump-dom", `http://127.0.0.1:${port}/index.html`
    ], { encoding: "utf8", env: Object.assign({}, process.env, { TZ: "America/Denver" }),
         maxBuffer: 16 * 1024 * 1024 });
    if (r.error || r.status !== 0 || !r.stdout) {
      stop(`Chrome did not render the page: ${r.error ? r.error.message : r.stderr}`);
    }
    return r.stdout;
  } finally {
    server.kill();
  }
}

function textOf(dom, id) {
  const m = new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(dom);
  return m ? m[1].trim() : null;
}
function filledBadges(dom) {
  return (dom.match(/class="dur filled"/g) || []).length;
}
const roles = (fs.readFileSync(path.join(root, "index.html"), "utf8")
  .match(/class="dur" data-role="/g) || []).length;

const nominalDir = stage("nominal", false);
const faultDir = stage("fault", true);

console.log("Page with the committed module:");
const nominal = render(nominalDir);
check("status strip reads BIT NOMINAL", textOf(nominal, "strip-bit") === "BIT NOMINAL",
  textOf(nominal, "strip-bit"));
check("integrity word shown", /^0x[0-9A-F]{8}$/.test(textOf(nominal, "strip-crc") || ""),
  textOf(nominal, "strip-crc"));
check("colophon self test reads NOMINAL", textOf(nominal, "spec-bit") === "NOMINAL",
  textOf(nominal, "spec-bit"));
check("one COMPUTED badge per role", roles > 0 && filledBadges(nominal) === roles,
  `${filledBadges(nominal)} filled, ${roles} roles`);
check("Eagle Dynamics counter computed in months", textOf(nominal, "stat-ed-unit") === "MOS",
  textOf(nominal, "stat-ed-unit"));

console.log("Page with one byte of the record corrupted:");
const fault = render(faultDir);
check("status strip states the record fault",
  textOf(fault, "strip-bit") === `BIT FAULT ${recordFault}`, textOf(fault, "strip-bit"));
check("integrity word withheld", textOf(fault, "strip-crc") === "--------",
  textOf(fault, "strip-crc"));
check("colophon states the fault code", textOf(fault, "spec-bit") === `FAULT CODE ${recordFault}`,
  textOf(fault, "spec-bit"));
check("no COMPUTED badge filled", filledBadges(fault) === 0, `${filledBadges(fault)} filled`);
check("Eagle Dynamics counter left at its static text", textOf(fault, "stat-ed") === "3+" &&
  textOf(fault, "stat-ed-unit") === "YRS",
  `${textOf(fault, "stat-ed")} ${textOf(fault, "stat-ed-unit")}`);
check("page content still complete", /Closed Beta Tester/.test(fault) &&
  /Battery Operations Center Chief/.test(fault));

fs.rmSync(nominalDir, { recursive: true, force: true });
fs.rmSync(faultDir, { recursive: true, force: true });
console.log(failures === 0 ? "A built-in test fault inhibits every computed value on the page." :
  `${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
