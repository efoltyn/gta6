#!/usr/bin/env node
/* tools/button-gate.mjs — THE BUTTON LAW, ENFORCED AT THE SOURCE.

   OWNER, 2026-08-18, looking at a bank vault card that printed
   "The vault needs more than any one…" beside a button reading THE VAULT
   NEEDS, under a title plate that already said The vault:

       "Look at how many words there are next to that button… find other
        instances where there's so many fucking words next to a button.
        There should be almost no words next to a button. Almost none, if
        any."   …and: "figure out what sucks. surrounding buttons."

   The renderers were fixed in that wave (city/interactions.js and
   systems/interact.js emit a button and nothing else). This file stops the
   AUTHORING side from putting the words back, and it is a pure static scan:
   no browser, no world build, ~1 second. It reads what the source literally
   writes into a control and fails when a control grows a sentence.

   THE SIX RULES IT PINS
     1. LABEL BUDGET      a `label:` is a verb phrase, not a clause.
     2. SUB BUDGET        a `sub:` is a status chip, not an explanation.
     3. TILE BUDGET       a menu tile's `desc:` is ONE short line.
     4. NO EM DASH        anywhere in any of the three. An em dash in a
                          control is a sentence wearing a disguise, and the
                          renderers cut on it, which is how half a sentence
                          ended up on a button in the first place.
     5. NO COPY BAR       the deleted prose cell beside the docked button
                          stays deleted.
     6. NO DEAF PANEL     a panel built with innerHTML that listens only for a
                          keydown is a menu a thumb cannot press.

   THE COUNTS ARE RATCHETS, not thresholds: they may go DOWN and never up.
   Fix the string, then lower the number in BUDGET below.

   Usage: node tools/button-gate.mjs [--list]
   Exit 0 = BUTTONGATE: ok. Anything else = FAIL (exit 1).
*/
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LIST = process.argv.includes("--list");

/* ---- BUDGETS ------------------------------------------------------------
   Widths are CAPS characters on a 440px docked rail at 14px/800, measured
   against city/interactions.js's own BUTTON_MAX. A tile desc is a card line
   at 12px in a 300px column. */
const MAX = { label: 34, sub: 44, desc: 60 };

/* Files whose `label:` / `note:` / `sub:` keys are NOT player-facing text.
   Each entry is a deliberate, named exemption — never add one to silence a
   real string. */
const NOT_UI = new Set([
  "src/city/occupy.js",            // `note:` is this file's own design commentary
  "src/systems/prisonshanks.js",   // `note:` quotes the owner's raw dictation
  "src/city/civic.js",             // `note:` on a service row is a dev annotation, unrendered
  "src/city/piracy.js",            // `marque:`/`label:` are vessel spec sheets
  "src/config.js",                 // `desc:` on a personality axis is design data
  "src/city/wanted.js",            // `label:` is a crime NAME on the rap sheet
  "src/city/playergang.js",        // `label:` is an objective line in the tracker
  "src/city/take.js",              // `label:` names a money source in a ledger
]);

const SKIP_DIR = new Set(["vendor", "node_modules", "archive", "workers"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

const PATTERNS = [
  ["label", /\blabel:\s*"([^"]*)"/g],
  ["sub", /\bsub:\s*"([^"]*)"/g],
  ["desc", /\bdesc:\s*"([^"]*)"/g],
];

const findings = [];
for (const file of walk(path.join(ROOT, "src"))) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  if (NOT_UI.has(rel)) continue;
  const src = readFileSync(file, "utf8");
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const text = m[1];
      if (!text) continue;
      const line = src.slice(0, m.index).split("\n").length;
      // an em dash is a sentence hiding inside a control
      if (/[—–]/.test(text)) findings.push({ rel, line, kind, why: "em dash", text });
      else if (text.length > MAX[kind]) findings.push({ rel, line, kind, why: text.length + " > " + MAX[kind], text });
    }
  }
}

/* ---- RULE 5: THE COPY BAR STAYS DELETED ---------------------------------
   The docked interaction card used to print the authored line in a bar beside
   the button. That markup is gone from city/interactions.js; if the class ever
   comes back, so has the fault. */
const copyBars = [];
for (const file of walk(path.join(ROOT, "src"))) {
  const src = readFileSync(file, "utf8");
  if (src.includes("itouch-copy")) copyBars.push(path.relative(ROOT, file).split(path.sep).join("/"));
}

/* ---- RULE 6: A VERB A THUMB CANNOT PRESS --------------------------------
   A file that draws with innerHTML and listens ONLY for a keydown has no
   existence on a tablet. There are exactly two ways to be reachable and this
   accepts both: a delegated CLICK (a menu whose rows are tap targets) or a
   registered INTERACTION ZONE (a proximity verb, which the registry turns
   into a card with a button). Everything in this repo that failed on
   2026-08-18 failed by having neither — six menus and four [E] verbs. */
const keyboardOnly = [];
for (const file of walk(path.join(ROOT, "src"))) {
  const src = readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const panel = src.includes("innerHTML") && /createElement\("div"\)/.test(src);
  const keyed = src.includes('addEventListener("keydown"');
  const clicky = /addEventListener\("(click|pointerdown|mousedown|touchstart)"/.test(src);
  const zoned = src.includes("registerZone");
  if (panel && keyed && !clicky && !zoned) keyboardOnly.push(rel);
}

/* ---- THE RATCHET --------------------------------------------------------
   Measured 2026-08-18 after the sweep. These may only ever go DOWN. */
const BUDGET = { label: 0, sub: 0, desc: 0 };
const COPY_BARS = 0;        // rule 5: never again
/* rule 6. The two left are HUD overlays with nothing to press: the swim meter
   and a killstreak banner. Anything else appearing here is a verb or a menu
   that a tablet cannot reach. */
const KEYBOARD_ONLY = 2;

const byKind = { label: 0, sub: 0, desc: 0 };
for (const f of findings) byKind[f.kind]++;

if (LIST || Object.keys(byKind).some((k) => byKind[k] > BUDGET[k])) {
  for (const f of findings) {
    console.log(`  ${f.rel}:${f.line}  [${f.kind}: ${f.why}]  ${JSON.stringify(f.text)}`);
  }
}

const fails = [];
for (const k of Object.keys(BUDGET)) {
  if (byKind[k] > BUDGET[k]) fails.push(`${k} violations rose to ${byKind[k]} (ratchet ${BUDGET[k]})`);
  else if (byKind[k] < BUDGET[k]) fails.push(`${k} is down to ${byKind[k]} — LOWER the ratchet from ${BUDGET[k]} in tools/button-gate.mjs`);
}

if (copyBars.length > COPY_BARS) fails.push("THE COPY BAR IS BACK (words beside a button): " + copyBars.join(", "));
if (keyboardOnly.length > KEYBOARD_ONLY) {
  fails.push("KEYBOARD-ONLY PANEL(S) — a menu a thumb cannot press: " +
    keyboardOnly.join(", ") + " (ratchet " + KEYBOARD_ONLY + ")");
} else if (keyboardOnly.length < KEYBOARD_ONLY) {
  fails.push("keyboard-only panels down to " + keyboardOnly.length + " — LOWER the ratchet from " + KEYBOARD_ONLY);
}

const head = Object.keys(byKind).map((k) => `${k} ${byKind[k]}/${BUDGET[k]}`).join(" · ") +
  ` · copyBars ${copyBars.length} · keyboardOnly ${keyboardOnly.length}`;
if (fails.length) {
  console.log("BUTTONGATE: FAIL — " + fails.join(" | "));
  process.exit(1);
}
console.log(`BUTTONGATE: ok (${head})`);
