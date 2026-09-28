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
{
  const SRC = readFileSync(join(ROOT, "src/systems/interact.js"), "utf8");
  const sb = {
    CBZ: { GANG_NAMES: ["the Reds", "the Blues"], touchInteractionDocked: () => false },
    el: { interactName: node(), interactNote: node(), interactOpts: node() },
    document: { documentElement: { style: { setProperty() {} } } },
    TOUCH: false,
  };
  vm.createContext(sb);
  vm.runInContext(
    ["function esc(s)", "function cleanName(a)", "function shortText(s, max)", "function gangShort(a)",
     "function whoFor(a)", "function whoHTML(a)", "function renderTouch(a, verbs, rawNote)",
     "function setDockHeight(px)", "function renderPanel(a)"].map((a) => extract(SRC, a)).join("\n") + `
    const OPT_KEYS = ["j", "k", "l"];
    let piRoot = null, piName = null, piNote = null, piVerbs = null, piOpts = null, piSig = "";
    function buildTouchUI() {
      if (!piRoot) { piRoot = { getBoundingClientRect() { return { height: 0 }; } };
        piName = el.piName = mk(); piNote = mk(); piVerbs = el.piVerbs = mk(); piOpts = mk(); }
      return piRoot;
      function mk() { return { textContent: "", innerHTML: "", style: {} }; }
    }
    function touchUI() { return TOUCH; }
    function panelNote(a) { return ""; }
    function verbsFor(a) { return ["trade", "talk", "steal"]; }
    function capVerbs(v) { return v; }
    function labelFor(a, v) { return v; }
    function subFor(a, v) { return ""; }
    function shortLabel(a, v) { return v[0].toUpperCase() + v.slice(1); }
    function optButton(cls, i, a, v) { return '<button data-pi="' + i + '">' + shortLabel(a, v) + "</button>"; }
    function optChoice(i, a, v) { return optButton("", i, a, v); }
    this.renderPanel = renderPanel; this.whoFor = whoFor;`, sb);

  const inmate = { data: { name: "Marcus Hale" }, gang: 0 };
  sb.renderPanel(inmate);
  check("prison desktop: #interactName carries the name", sb.el.interactName.innerHTML.startsWith("Marcus Hale"), sb.el.interactName.innerHTML);
  check("prison desktop: clique in muted role span", /<span class="iname-role">Reds<\/span>/.test(sb.el.interactName.innerHTML), sb.el.interactName.innerHTML);
  check("prison desktop: buttons still render", /Trade/.test(sb.el.interactOpts.innerHTML), sb.el.interactOpts.innerHTML);

  sb.renderPanel({ kind: "guard", data: { name: "Officer Diaz" } });
  check("prison desktop: guard reads 'Guard'", /Officer Diaz<span class="iname-role">Guard<\/span>/.test(sb.el.interactName.innerHTML), sb.el.interactName.innerHTML);
  sb.renderPanel({ kind: "warden", data: { name: "the Warden" } });
  check("prison desktop: warden not doubled", sb.el.interactName.innerHTML === "Warden", sb.el.interactName.innerHTML);
  sb.renderPanel({ data: { name: "Tico", offer: { item: "Shiv", price: 15 } }, gang: -1 });
  check("prison desktop: stall man reads 'Trader'", /Tico<span class="iname-role">Trader<\/span>/.test(sb.el.interactName.innerHTML), sb.el.interactName.innerHTML);
  sb.renderPanel({ data: { name: "an inmate" }, gang: -1 });
  check("prison desktop: anonymous man reads 'Inmate'", sb.el.interactName.innerHTML === "Inmate", sb.el.interactName.innerHTML);
  sb.renderPanel({ data: { name: "<b>x</b>" } });
  check("prison desktop: name is escaped", !/<b>/.test(sb.el.interactName.innerHTML), sb.el.interactName.innerHTML);

  sb.TOUCH = true;
  vm.runInContext("TOUCH = true", sb);
  sb.renderPanel(inmate);
  check("prison touch: .piw-name carries the name", sb.el.piName && sb.el.piName.innerHTML.startsWith("Marcus Hale"), sb.el.piName && sb.el.piName.innerHTML);
  check("prison touch: plate visible", sb.el.piName && sb.el.piName.style.display === "", sb.el.piName && sb.el.piName.style.display);
  check("prison touch: verbs render", sb.el.piVerbs && /Steal/.test(sb.el.piVerbs.innerHTML), sb.el.piVerbs && sb.el.piVerbs.innerHTML);
  check("prison touch markup: .piw-name precedes .piw-note", /<span class="piw-name"><\/span><span class="piw-note">/.test(SRC), "");
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
