/* ============================================================================
   CACAO/FP — smoke unit tests (enhancement #23)
   Runs the real data.js + app.js in a sandbox with a stubbed DOM, then asserts
   the pure formatters / sign logic / PPV math. No test framework — plain node:
     node tests/smoke.unit.js
   ========================================================================== */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/* --- minimal DOM/runtime stub so app.js top-level boot calls don't throw --- */
function stubNode() {
  const node = {
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    textContent: '',
    scrollTop: 0,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return stubNode(); }, querySelectorAll() { return []; },
  };
  return node;
}
const documentStub = {
  getElementById() { return stubNode(); },
  querySelector() { return stubNode(); },
  querySelectorAll() { return []; },
  addEventListener() {}, createElement() { return stubNode(); },
  body: stubNode(), head: stubNode(),
};
const localStorageStub = (() => {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
})();

const ctx = {
  Math, Date, Object, Array, JSON, String, Number, isNaN, parseFloat, parseInt, console,
  document: documentStub,
  localStorage: localStorageStub,
  setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
  requestAnimationFrame: () => 0,
  Chart: function Chart() { return { destroy() {} }; },
};
ctx.window = ctx; ctx.globalThis = ctx;

const code = read('data.js') + '\n' + read('data2.js') + '\n' + read('app.js')
  + '\n;__T = { DATA, fmtInt, fmtNum, fmtEur, fmtEurM, fmtPct, fmtSignedPct, fmtSigned, signClass };';

vm.createContext(ctx);
vm.runInContext(code, ctx);
const T = ctx.__T;

/* --- tiny assert harness --- */
let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`); }
}
function approx(actual, expected, tol, name) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) { pass++; console.log(`  ✓ ${name} (${actual})`); }
  else { fail++; console.log(`  ✗ ${name}: expected ~${expected}±${tol}, got ${actual}`); }
}

console.log('Formatters:');
eq(T.fmtInt(8142), '8,142', 'fmtInt groups thousands');
eq(T.fmtEur(8142), '€8,142', 'fmtEur prefixes € + groups');
eq(T.fmtPct(78), '78.0%', 'fmtPct one decimal');

console.log('Signed formatters (real minus sign):');
const sp = T.fmtSignedPct(-6.9);
eq(sp.includes('6.9'), true, 'fmtSignedPct keeps magnitude');
eq(sp.charAt(0) === '−' || sp.charAt(0) === '-', true, 'fmtSignedPct negative prefix');
eq(T.fmtSignedPct(2.1).charAt(0), '+', 'fmtSignedPct positive prefix is +');

console.log('Sign-color logic (the bug we fixed):');
eq(T.signClass(2.1, false), 'pos', 'positive, no invert → pos');
eq(T.signClass(2.1, true), 'neg', 'positive, invert → neg (cost up = bad)');
eq(T.signClass(-6.9, true), 'pos', 'negative, invert → pos (spend down = good)');

console.log('Domain math:');
let totalVar = 0;
T.DATA.ppvDetail.forEach((p) => { totalVar += (p.actEur - p.stdEur) * p.mt; });
approx(totalVar, 1024450, 1, 'PPV total variance ties to data');
eq(T.DATA.spotHistory.ny.at(-1), 7842, 'spot history lands on NY headline');
eq(T.DATA.spotHistory.ldn.at(-1), 5418, 'spot history lands on LDN headline');
eq(Object.keys(T.DATA).length >= 29, true, 'DATA has all datasets');

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
