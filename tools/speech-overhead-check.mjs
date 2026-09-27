#!/usr/bin/env node
/* tools/speech-overhead-check.mjs — pure-node check of the one mouth
   (systems/speech.js): few words, narration dropped, no inner monologue, one
   line per speaker, nearest three win, off-screen important lines ride the
   edge. Also asserts no source file still writes to a removed speech surface.
       node tools/speech-overhead-check.mjs */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`  ok   ${name}`);
};

// ---- a tiny DOM + THREE stand-in --------------------------------------------
function el() {
  const e = { children: [], style: { setProperty() {} }, parentNode: null, textContent: "", id: "",
    classList: { s: new Set(), add(c) { this.s.add(c); }, remove(c) { this.s.delete(c); }, toggle(c, on) { on ? this.s.add(c) : this.s.delete(c); }, contains(c) { return this.s.has(c); } },
    setAttribute() {}, appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); c.parentNode = null; } };
  return e;
}
const body = el();
class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  // camera at origin looking down -z, 90 deg fov-ish
  project() { const d = -this.z; if (d <= 0) { this.x = -this.x / 1e-3; this.y = 0; this.z = 2; return this; } this.x = this.x / d; this.y = (this.y - 1.6) / d; this.z = 0.5; return this; } }
const always = [];
const CBZ = { game: { mode: "city", state: "playing" }, player: { pos: new V3(0, 0, 0) },
  camera: { position: new V3(0, 1.6, 3), updateMatrixWorld() {} },
  onAlways: (o, f) => always.push(f) };
const sandbox = { window: { CBZ, innerWidth: 1000, innerHeight: 800 }, document: { body, createElement: el, getElementById: () => null }, THREE: { Vector3: V3 }, Math, String, Object };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(ROOT, "src/systems/speech.js"), "utf8"), sandbox);
const S = CBZ.speech;
const ped = (x, z, name) => ({ pos: new V3(x, 0, z), name });

check("few words keeps a short line", S.few("Get out of my face."), "Get out of my face.");
check("few words cuts to whole sentences", S.few("You owe me. I want it by tonight, or your cousin finds out what you did last week."), "You owe me.");
check("few words: an unbreakable ramble is dropped", S.few("x".repeat(90)), "");
check("words strips Name: and quotes", S.words('Marcus: "Yard is open."', { name: "Marcus" }), "Yard is open.");
check("the player does not narrate himself", S.say(CBZ.player, "I should find a car."), false);
check("third-person narration is dropped", S.say(ped(1, -4, "Marcus"), "Marcus backs off."), false);
check("a man near you speaks", S.say(ped(1, -4, "Marcus"), "Back off."), true);
check("out of earshot is silent", S.say(ped(0, -40, "Far"), "Hey!"), false);
const a = ped(-1, -5, "A"), b = ped(2, -6, "B"), c = ped(3, -9, "C"), d = ped(0, -12, "D");
S.clear();
S.say(a, "One."); S.say(a, "Two.");
check("one line per speaker", S.audit().live, 1);
S.say(b, "Hi."); S.say(c, "Yo.");
check("three on screen", S.audit().live, 3);
check("a farther fourth is refused", S.say(d, "Hey."), false);
check("a nearer fourth replaces the farthest", S.say(ped(0.5, -2, "E"), "Move."), true);
check("still three", S.audit().live, 3);
check("a phone voice shows", S.phone("Where are you?"), true);
for (let i = 0; i < 300; i++) always.forEach((f) => f(1 / 60));
check("lines age out", S.audit().live, 0);

// ---- no source writes to a removed surface ------------------------------------
const dead = /CBZ\.subtitles\b|getElementById\(["'](citySpeech|prisonSpeech|pinteractSay)["']\)|\.world-subtitle-line|\.pi-subtitle-line/;
const hits = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === "vendor" || f === "node_modules") continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs|html)$/.test(f)) {
      readFileSync(p, "utf8").split("\n").forEach((l, i) => { if (dead.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)) hits.push(`${p.slice(ROOT.length + 1)}:${i + 1}`); });
    }
  }
})(join(ROOT, "src"));
check("no code writes to a removed speech surface", hits, []);

console.log(failed ? `\nSPEECH: ${failed} FAILED` : "\nSPEECH: ok");
process.exit(failed ? 1 : 0);
