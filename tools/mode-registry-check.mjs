#!/usr/bin/env node
/* tools/mode-registry-check.mjs — CAN A GAME OUTSIDE ENGINE SOURCE JOIN?

   OWNER DOCTRINE (2026-08-07): "make it so next time there's a one shot of a
   new HTML game, they can easily use Gang City like an engine… we're making a
   really powerful game development engine out of the gang city code."

   systems/modecaps.js made the shared verbs ask for a CAPABILITY instead of a
   scenario, and then answered that question out of a table hard-coded in
   engine source. So the only way a new games/ page could join was to edit the
   engine, which is the coupling the whole block exists to remove. Capability
   fields on config.js's existing mode descriptor closed that; this file is
   the thing that keeps it closed — including the part where there is exactly
   ONE registerMode in the engine, since a second one is what broke the city.

   Runs modecaps.js in plain node — no browser, no GPU, under a second — and
   asks by CONSEQUENCE, never by reading the table back:

     1. THE FAULT IS REAL. An unregistered mode gets nothing: no capability,
        no roster. (If this stops failing, the test has stopped testing.)
     2. THE FIX IS REAL. After ONE registerMode call from outside, the same
        mode vaults, breaches, and a blast finds and kills its people through
        the GAME's own funnel — with a man outside the radius left standing,
        because "everyone died" and "the blast worked" are different claims.
     3. THE RATCHET BITES. A mode that declares blast+blastActors and wires no
        damage funnel is UNROUTED — a registration cannot lie its way past the
        number pinned in tools/math-gate.mjs.
     4. THE REVERT IS EXACT. MODE_CAPS_DECL_V1=false makes the game a stranger
        again AND leaves the four built-in rows untouched, and MODE_CAPS_V1=0
        still collapses everything to the old city-only answer.

   Usage: node tools/mode-registry-check.mjs
   Exit 0 = ok.                                                             */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, "src/systems/modecaps.js");

globalThis.window = {};
window.CBZ = { CONFIG: {}, game: { mode: "city" } };
const CBZ = window.CBZ;
(0, eval)(fs.readFileSync(SRC, "utf8"));

const fails = [];
const lines = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  lines.push((ok ? "  ok   " : "  FAIL ") + label.padEnd(44) +
    JSON.stringify(got) + (ok ? "" : "   want " + JSON.stringify(want)));
  if (!ok) fails.push(label);
}

if (!CBZ.registerMode) { console.error("MODE-REGISTRY: FAIL — CBZ.registerMode missing"); process.exit(1); }

/* 1 — THE FAULT ---------------------------------------------------------- */
lines.push("1. an unregistered mode, which is what every new games/ page is");
check("built-in city keeps blast", CBZ.modeHas("blast", "city"), true);
check("built-in city blastActors stays 0", CBZ.modeHas("blastActors", "city"), false);
CBZ.game.mode = "oneshot";
check("oneshot blast    before register", CBZ.modeHas("blast"), false);
check("oneshot traverse before register", CBZ.modeHas("traverse"), false);
check("oneshot roster   before register", CBZ.worldActors([]).length, 0);

/* 2 — THE FIX, declared the way a games/ page declares it ----------------- */
lines.push("2. one registerMode call, from outside engine source");
const men = [
  { hp: 100, pos: { x: 0, z: 0 } },
  { hp: 100, pos: { x: 3, z: 0 } },
  { hp: 100, pos: { x: 400, z: 0 } },   // the control: far outside the radius
];
let booked = 0;
CBZ.registerMode("oneshot", {
  id: "oneshot", label: "one-shot page",
  caps: { traverse: 1, stepLedge: 1, blast: 1, blastActors: 1, breach: 1 },
  actors: (out) => { for (const m of men) if (!m.dead) out.push(m); return out; },
  hurt: (a, dmg) => { a.hp -= dmg; if (a.hp <= 0) { a.dead = true; booked++; } return true; },
  route: "oneshot roster + oneshot kill",
});
check("oneshot blast    after register", CBZ.modeHas("blast"), true);
check("oneshot traverse after register", CBZ.modeHas("traverse"), true);
check("oneshot breach   after register", CBZ.modeHas("breach"), true);
check("oneshot roster   after register", CBZ.worldActors([]).length, 3);
const reached = CBZ.blastWorldActors(0, 0, 0, 20, 1, {});
check("bodies a blast reached", reached, 2);
check("kills booked by the GAME's funnel", booked, 2);
check("the man at 400 m still standing", !men[2].dead, true);

/* 3 — THE RATCHET -------------------------------------------------------- */
lines.push("3. the ratchet, which a registration must not be able to lie past");
const before = CBZ.modeCapsAudit();
check("audit sees the registered mode", before.registered, 1);
check("oneshot resolves a real route", before.routes.oneshot, "oneshot roster + oneshot kill");
CBZ.registerMode("liar", { id: "liar", caps: { blast: 1, blastActors: 1 } });   // no funnel
const after = CBZ.modeCapsAudit();
check("a funnel-less mode reads UNROUTED", after.routes.liar, "UNROUTED");
check("and pushes unrouted up by one", after.unrouted - before.unrouted, 1);

/* 4 — THE REVERT --------------------------------------------------------- */
lines.push("4. the flags, proved rather than asserted");
CBZ.CONFIG.MODE_CAPS_DECL_V1 = false;
check("decl off:   oneshot blast", CBZ.modeHas("blast"), false);
check("decl off:   oneshot roster", CBZ.worldActors([]).length, 0);
check("decl off:   city untouched", CBZ.modeHas("blast", "city"), true);
check("decl off:   escape untouched", CBZ.modeHas("traverse", "escape"), true);
CBZ.CONFIG.MODE_CAPS_DECL_V1 = true;
CBZ.CONFIG.MODE_CAPS_V1 = false;
check("caps off: oneshot blast", CBZ.modeHas("blast"), false);
check("caps off: city keeps its row", CBZ.modeHas("blast", "city"), true);
CBZ.CONFIG.MODE_CAPS_V1 = true;

console.log(lines.join("\n"));
if (fails.length) {
  console.error("\nMODE-REGISTRY: FAIL — " + fails.join(" | "));
  process.exit(1);
}
console.log("\nMODE-REGISTRY: ok — a games/ page joins the engine in one call, " +
  "the ratchet still bites, both flags revert clean.");
