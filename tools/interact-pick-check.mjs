// tools/interact-pick-check.mjs — headless check of the city's E targeting
// (src/city/interactions.js pickFrom). No browser: the file is loaded into a
// vm with a stub CBZ and the pure pick step is run on staged rooms.
//   node tools/interact-pick-check.mjs
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "src/city/interactions.js"), "utf8");

const CBZ = {
  game: { mode: "city", state: "playing" },
  CONFIG: {},
  player: { pos: { x: 0, y: 0, z: 0 } },
  cam: { yaw: 0 },          // yaw 0 looks down -z
  onUpdate() {}, onAlways() {},
};
const win = { CBZ, innerWidth: 1440, innerHeight: 900 };
win.window = win;
const sandbox = { window: win, CBZ, addEventListener() {}, document: { getElementById() { return null; } }, console, performance: { now: () => 0 } };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const I = CBZ.interactions;
if (!I || typeof I.pickFrom !== "function") { console.error("FAIL: CBZ.interactions.pickFrom missing"); process.exit(1); }

const fx = 0, fz = -1;   // looking down -z
const at = (x, z) => ({ x, z });
const ped = (name, x, z, rows) => ({ t: { name, pos: at(x, z) }, d: Math.hypot(x, z), kind: "ped", layers: ["ped", "ped:civ"], base: 5, rows });
const zone = (name, x, z, rows, prio = 14) => ({ t: { name, x, z }, d: Math.hypot(x, z), kind: name, layers: [], base: prio, zone: { id: name }, rows });
const fixture = (name, x, z, rows) => ({ t: { name, x, z }, d: Math.hypot(x, z), kind: name, layers: [name], base: 16, rows });
const resolve = (c) => c.rows;
const ROWS = (v) => [{ key: "e", label: v }];

let fails = 0;
function expect(label, list, want, opts = {}) {
  const got = I.pickFrom(list, opts.cur || null, fx, fz, 0, 0, !!opts.touch, resolve);
  const name = got ? got.pick.t.name : null;
  const ok = name === want;
  if (!ok) fails++;
  console.log((ok ? "ok   " : "FAIL ") + label + " -> " + name + (ok ? "" : " (want " + want + ")"));
}

// 1) the owner's bug: phone in front with nothing to say, a stranger 2 m behind
expect("stranger behind never wins over nothing",
  [zone("phone", 0, -0.8, null), ped("stranger", 0.3, 2.0, ROWS("Mug"))], null);
// 2) phone in front with a verb beats a stranger behind
expect("looked-at phone beats stranger behind",
  [zone("phone", 0.1, -0.8, ROWS("Call")), ped("stranger", 0.3, 2.0, ROWS("Mug"))], "phone");
// 3) a guest chair across the desk 2.2 m away, phone 0.8 m slightly off-axis
expect("phone under your hand beats the chair across the desk",
  [zone("phone", 0.45, -0.7, ROWS("Call")), zone("chair", -0.6, -2.2, ROWS("Sit"), 6)], "phone");
// 4) looking straight at a folder, a staffer 1.5 m to the side
expect("folder you look at beats a man at your side",
  [fixture("folder", 0, -0.7, ROWS("Open")), ped("aide", 1.5, 0.1, ROWS("Hear"))], "folder");
// 5) a person you look at beats a zone at your side
expect("man you look at beats a zone beside you",
  [ped("aide", 0.1, -2.0, ROWS("Hear")), zone("phone", 1.4, 0.2, ROWS("Call"))], "aide");
// 6) a person you bump into (0.7 m) behind you still counts
expect("a man touching your back is yours",
  [ped("aide", 0, 0.7, ROWS("Hear"))], "aide");
// 7) standing AT a counter zone, looking down the aisle, it keeps E
expect("counter you stand at keeps its card",
  [zone("counter", 1.0, 0.2, ROWS("Buy"))], "counter");
// 8) touch: a finger picks, no look gate
expect("touch has no look gate",
  [ped("stranger", 0, 2.0, ROWS("Mug"))], "stranger", { touch: true });
// 9) hysteresis: current target held against a near-equal rival
{
  const a = zone("folderA", -0.05, -0.8, ROWS("Open")), b = zone("folderB", 0.05, -0.8, ROWS("Open"));
  expect("current target held against a near-equal rival", [b, a], "folderA", { cur: a });
}
// 10) the current target is dropped once you look away from it
{
  const a = ped("aide", 0, 2.5, ROWS("Hear")), b = zone("phone", 0, -0.8, ROWS("Call"));
  expect("looked-away current target is dropped", [a, b], "phone", { cur: a });
}

console.log(fails ? `\n${fails} FAIL` : "\nall pass");
process.exit(fails ? 1 : 0);
