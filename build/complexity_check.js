// complexity_check.js - cyclomatic complexity gate for AV Rule 3.
//
// AV Rule 3: "All functions shall have a cyclomatic complexity number of 20 or less."
// clang-tidy has no cyclomatic metric (its cognitive-complexity check is a different
// measure), so this gate computes one. It asks the compiler for its own parse tree of the
// source (clang -ast-dump=json), rather than reading the text, so comments, strings, and
// formatting cannot fool it.
//
// Measure: McCabe cyclomatic complexity, V(G) = decision points + 1, counted per function.
// Decision points: if, for, while, do, case, the conditional operator (?:), and each && and
// || operator. AV Rule 3 permits an exception for a switch with many case labels; this
// module has no switch statement, so no exception is taken.
//
// Usage: node complexity_check.js <path to clang++> [source file]
// Exits non-zero if the compiler fails, if no function definition is found, or if any
// function exceeds the limit.

const childProcess = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const clang = process.argv[2];
const src = process.argv[3] || path.join(root, "src", "Resume_core.cpp");
const inc = path.dirname(src);
const limit = 20;

const decisionKinds = ["IfStmt", "ForStmt", "WhileStmt", "DoStmt", "CaseStmt",
                       "ConditionalOperator", "BinaryConditionalOperator"];
const decisionOperators = ["&&", "||"];

if (!clang) {
  console.log("  FAIL  usage: node complexity_check.js <path to clang++> [source file]");
  process.exit(1);
}

const result = childProcess.spawnSync(clang, [
  "--target=wasm32", "-std=c++03", "-nostdlib", "-ffreestanding", "-fno-exceptions",
  "-fno-rtti", "-I", inc, "-fsyntax-only", "-Xclang", "-ast-dump=json", src
], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

if (result.error || result.status !== 0) {
  console.log(`  FAIL  compiler did not produce a parse tree: ` +
    (result.error ? result.error.message : `exit status ${result.status}\n${result.stderr}`));
  process.exit(1);
}

let tree = null;
try {
  tree = JSON.parse(result.stdout);
} catch (err) {
  console.log(`  FAIL  parse tree is not valid JSON: ${err.message}`);
  process.exit(1);
}

function countDecisions(node) {
  let n = 0;
  if (node && typeof node === "object") {
    if (decisionKinds.indexOf(node.kind) >= 0) { n += 1; }
    if (node.kind === "BinaryOperator" && decisionOperators.indexOf(node.opcode) >= 0) {
      n += 1;
    }
    (node.inner || []).forEach((child) => { n += countDecisions(child); });
  }
  return n;
}

// Every function definition the source provides. The build is freestanding, so the parse
// tree holds no library code; implicit declarations the compiler adds have no body.
const functions = [];
function collect(node) {
  if (node && typeof node === "object") {
    const isDefinition = (node.kind === "FunctionDecl" || node.kind === "CXXMethodDecl") &&
      !node.isImplicit && (node.inner || []).some((c) => c.kind === "CompoundStmt");
    if (isDefinition) {
      const body = node.inner.filter((c) => c.kind === "CompoundStmt");
      const decisions = body.reduce((sum, b) => sum + countDecisions(b), 0);
      functions.push({ name: node.name, complexity: decisions + 1 });
    } else {
      (node.inner || []).forEach(collect);
    }
  }
}
collect(tree);

let failures = 0;
function check(label, pass, detail) {
  if (!pass) { failures += 1; }
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ": " + detail : ""}`);
}

check("function definitions found", functions.length > 0, `${functions.length}`);
functions.sort((a, b) => b.complexity - a.complexity);
functions.forEach((f) => {
  check(`cyclomatic complexity of ${f.name}`, f.complexity <= limit,
    `${f.complexity} (limit ${limit})`);
});

console.log(failures === 0 ?
  `Cyclomatic complexity: every function at or under ${limit} [AV Rule 3].` :
  `${failures} check(s) FAILED [AV Rule 3].`);
process.exit(failures === 0 ? 0 : 1);
