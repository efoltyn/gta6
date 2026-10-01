#!/usr/bin/env node
/* ============================================================
   tools/interact-name-check.mjs — THE PERSON'S NAME SITS OVER HIS BUTTONS.

   Owner, 2026-09-28: "In the jail game I can't see the name of the person. I
   just see buttons to interact, but I don't see the name of the person above
   it. That's dumb." The 2026-09-27 prison HUD purge (b47be119) blanked
   #interactName and dropped .piw-name from the touch plate along with the
   dossier; survival_interact.js blanked it too and survivalhud.js hid it.

   Pure node, no browser: the render functions are lifted out of their IIFEs
   (anchored on declaration lines, so a rename fails loudly) and run against
   a stub DOM. Asserts, per surface, that a person target puts his name (and a
   muted role where the game has one) above the verbs.

       node tools/interact-name-check.mjs
============================================================ */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (name, ok, got) => {
  if (!ok) { failed++; console.log(`  FAIL ${name}: got ${JSON.stringify(got)}`); }
  else console.log(`  ok   ${name}`);
};
function extract(SRC, startsWith) {
  const at = SRC.indexOf(startsWith);
  if (at < 0) { console.log(`FATAL: anchor missing: ${startsWith}`); process.exit(2); }
  let i = SRC.indexOf("{", at), depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}") { depth--; if (!depth) return SRC.slice(at, j + 1); }
  }
  console.log(`FATAL: unbalanced braces after ${startsWith}`); process.exit(2);
}
function node() {
  return { textContent: "", innerHTML: "", style: {}, classList: { toggle() {}, add() {}, remove() {} },
    getBoundingClientRect() { return { height: 0 }; } };
}

// ---------------------------------------------------------------- PRISON
// 2026-09-30: the verbs ride ON the person (systems/interact.js render pins a
// group through CBZ.prisonPrompt); his name is that group's top row, a label.
{
  const SRC = readFileSync(join(ROOT, "src/systems/interact.js"), "utf8");
  const calls = [];
  const sb = {
    CBZ: {
      cam: { yaw: 0 }, touchMode: false,
      prisonCars: { label: (i) => ["Sureños", "Black Guerrilla Family", "Aryan Brotherhood", "Border Brothers", "Asian Boyz", "Independents"][i] || "" },
      prisonPrompt: (id, act, verb, opts) => { calls.push({ id, act, verb, opts }); return true; },
      prisonPromptClear: () => {},
    },
  };
  vm.createContext(sb);
  vm.runInContext(
    ["function cleanName(a)", "function shortText(s, max)", "function gangShort(a)", "function whoFor(a)",
     "function anchorOf(a)", "function render(a, verbs)"].map((x) => extract(SRC, x)).join("\n") + `
    const KEYS = ["E", "J", "K", "L"], ROWS = 5;
    function touchUI() { return false; }
    function d2Of(a) { return 1; }
    function subFor(a, v) { return ""; }
    function shortLabel(a, v) { return v[0].toUpperCase() + v.slice(1); }
    this.render = render;`, sb);
  const go = (a) => { calls.length = 0; sb.render(a, ["talk", "trade", "steal", "grab"]); return calls; };
  const at = { group: { position: { x: 0, y: 0, z: 0 } } };
  const nameRow = (c) => c.find((x) => x.id === "person-who");

  let c = go(Object.assign({ data: { name: "Marcus Hale" }, gang: 1, yardCar: 1 }, at));
  check("prison: the name row tops his verbs", nameRow(c) && nameRow(c).opts.row === 0 && nameRow(c).verb.startsWith("Marcus Hale"), nameRow(c) && nameRow(c).verb);
  check("prison: his gang as the muted role", nameRow(c) && /Black Guerrilla Family/.test(nameRow(c).verb), nameRow(c) && nameRow(c).verb);
  check("prison: the name row is a label, not a button", nameRow(c) && nameRow(c).opts.label === true && !nameRow(c).opts.bind, nameRow(c) && nameRow(c).opts);
  check("prison: verbs follow under it, E first", c.filter((x) => /^person\d/.test(x.id)).map((x) => x.opts.key).join("") === "EJKL", c.map((x) => x.opts.key));
  check("prison: verbs are all on the same man", c.every((x) => x.opts.group === "person"), "");
  c = go(Object.assign({ data: { name: "Ray" }, gang: -1 }, at));
  check("prison: a man outside any gang reads Independent", nameRow(c) && /Independent/.test(nameRow(c).verb), nameRow(c) && nameRow(c).verb);
  c = go(Object.assign({ kind: "guard", data: { name: "Officer Diaz" } }, at));
  check("prison: guard reads 'Guard'", nameRow(c) && /Officer Diaz\s+Guard/.test(nameRow(c).verb), nameRow(c) && nameRow(c).verb);
  c = go(Object.assign({ kind: "warden", data: { name: "the Warden" } }, at));
  check("prison: warden not doubled", nameRow(c) && nameRow(c).verb === "Warden", nameRow(c) && nameRow(c).verb);
  check("prison: no fixed card or rail left in interact.js", !/interactOpts\.innerHTML|pinteract/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "");
}

// ---------------------------------------------------------------- SURVIVAL
{
  const SRC = readFileSync(join(ROOT, "src/systems/survival_interact.js"), "utf8");
  const sb = { CBZ: {}, el: { name: node(), note: node(), opts: node() } };
  vm.createContext(sb);
  vm.runInContext(`let verbs = [], tgt = null, cardKey = "";
    const OPT_KEYS = ["i", "j", "k", "l"];` +
    extract(SRC, "function nameOf(t)") + "\n" + extract(SRC, "function keyOf(set)") + "\n" +
    extract(SRC, "function render(set)") + `
    this.go = function (t, set) { tgt = t; render(set); };`, sb);
  sb.go({ name: "Dana K." }, [{ label: "Grab" }, { label: "Shove" }]);
  check("survival desktop: name over the verbs", sb.el.name.textContent === "Dana K.", sb.el.name.textContent);
  sb.go({ name: "Ray P." }, [{ label: "Grab" }, { label: "Shove" }]);
  check("survival desktop: same verbs, new man, name updates", sb.el.name.textContent === "Ray P.", sb.el.name.textContent);
  const HUD = readFileSync(join(ROOT, "src/systems/survivalhud.js"), "utf8");
  check("survival hud no longer hides #interactName", !/#interactName/.test(HUD), "");
}

// ---------------------------------------------------------------- CITY
{
  const SRC = readFileSync(join(ROOT, "src/city/street_talk.js"), "utf8");
  const sb = { CBZ: { cityGangs: [{ id: "g1", name: "the Vipers" }] }, g: { cityPartner: null } };
  vm.createContext(sb);
  vm.runInContext(extract(SRC, "function pedRole(p)") + "\nthis.pedRole = pedRole;", sb);
  check("city: gang member's role is his gang", sb.pedRole({ gang: "g1" }) === "Vipers", sb.pedRole({ gang: "g1" }));
  check("city: detail agent reads Security", sb.pedRole({ kind: "security" }) === "Security", sb.pedRole({ kind: "security" }));
  check("city: plain civilian has no role", sb.pedRole({}) === "", sb.pedRole({}));
  const IX = readFileSync(join(ROOT, "src/city/interactions.js"), "utf8");
  check("city card renders desc.role into #interactName", /rs\.className = "iname-role"/.test(IX), "");
  const CSS = readFileSync(join(ROOT, "css/hud.css"), "utf8");
  check("prison-bare CSS no longer hides a filled #interactName", !/body\.prison-bare #interactName,/.test(CSS), "");
}

console.log(failed ? `\nINTERACT-NAME: ${failed} FAILED` : "\nINTERACT-NAME: ok");
process.exit(failed ? 1 : 0);
