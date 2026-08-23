#!/usr/bin/env node
/* ============================================================
   tools/interact-verbs-check.mjs — NEVER MORE THAN THREE BUTTONS.

   OWNER, 2026-08-21: "I like 3 interaction buttons max at a time... more than
   3 interaction buttons showing at once looks bad. trading also has like 5."

   He was right about the five: systems/interact.js's cap only ever ran on
   DESKTOP. The touch path rendered the capped four AND a second row of
   everything the cap dropped, so the surface the game is actually played on
   was the one with no cap at all — a bent guard's stall put five under a thumb.

   This walks EVERY context verbsFor() can produce (every approach kind, every
   role, every merchant/gang/friendship combination) and asserts the menu is
   three or fewer BEFORE the cap has to save it — because a cap that fires is a
   verb the player silently lost, and the curated lists are supposed to make it
   unnecessary. It also asserts the promises that came with the rename:
   BEFRIEND never appears unprompted, and every verb a menu names really exists
   in the VERB table.

       node tools/interact-verbs-check.mjs

   Parses interact.js rather than booting it: verbsFor is a pure if-chain over
   an actor record, so a stub actor and a stub CBZ reach every branch in
   milliseconds, on a box that cannot finish a 25 km world build.
============================================================ */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "src/systems/interact.js"), "utf8");

/* Lift the three pure functions out of the IIFE and run them against stubs.
   Slicing source is ugly, and it is the honest trade: the alternative is
   booting a WebGL prison to ask an arithmetic question. Each slice is anchored
   on a declaration line, so a rename breaks this loudly instead of silently
   testing nothing. */
function extract(name, startsWith) {
  const at = SRC.indexOf(startsWith);
  if (at < 0) { console.log(`FATAL: could not find ${name} (anchor: ${startsWith.slice(0, 40)}…)`); process.exit(2); }
  // walk braces from the first { after the anchor
  let i = SRC.indexOf("{", at), depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}") { depth--; if (!depth) return SRC.slice(at, j + 1); }
  }
  console.log(`FATAL: unbalanced braces in ${name}`); process.exit(2);
}

const sandbox = { CBZ: { game: { role: "inmate", heat: 0 }, player: { gang: null } }, console };
vm.createContext(sandbox);
vm.runInContext(
  extract("verbsFor", "function verbsFor(a)") + "\n" +
  extract("pressureVerb", "function pressureVerb(a)") + "\n" +
  extract("guardPayoffWorthIt", "function guardPayoffWorthIt(a)") + "\n" +
  extract("capVerbs", "function capVerbs(v)") + "\n" +
  // MAX_VERBS / VERB_PRIORITY are consts capVerbs closes over
  SRC.slice(SRC.indexOf("const MAX_VERBS"), SRC.indexOf("function capVerbs")) + "\n" +
  "this.verbsFor = verbsFor; this.capVerbs = capVerbs; this.MAX_VERBS = MAX_VERBS;",
  sandbox);
const { verbsFor, capVerbs, MAX_VERBS } = sandbox;

// Every verb id the VERB table actually defines — so a menu can never name one
// that has no dispatch behind it (a dead button is worse than a missing one).
const VERB_IDS = new Set(
  [...SRC.slice(SRC.indexOf("const VERB = {"), SRC.indexOf("// one-line teaching text per verb"))
    .matchAll(/^\s{4}([a-zA-Z]+):\s*\{/gm)].map((m) => m[1]));

const APPROACH_KINDS = [
  "gangInvite", "gangJob", "gangParley", "crewBackup", "crewDues", "stickUp",
  "coverStory", "heatWarning", "alibiDeal", "witnessFix", "recantOffer", "favor",
  "buyItem", "copBribe", "copTip", "copPlea", "copTaunt", "turfWarning", "deal",
  "tax", "debtCollect", "snitchThreat", "lookout", "diversion", "infoSell",
  "stashCover", "racketCover", "coverDebt", "jobThreat", "reputation", "nonsense",
];

function actor(over) {
  return Object.assign({
    kind: "inmate", rep: 0, gang: -1, corrupt: false, data: { name: "Marcus" },
    playerFear: 0, playerGrudge: 0, playerTrust: 0, approach: null, intimidMode: null,
  }, over || {});
}

let failed = 0, cases = 0, sawBefriend = 0;
function assess(label, a) {
  cases++;
  const raw = verbsFor(a);
  const shown = capVerbs(raw);
  if (raw.length > MAX_VERBS) {
    failed++;
    console.log(`  FAIL ${label}: verbsFor gave ${raw.length} (${raw.join("/")}) — the cap had to drop "${raw.filter((v) => shown.indexOf(v) < 0).join(",")}"`);
  }
  if (shown.length > MAX_VERBS) {
    failed++;
    console.log(`  FAIL ${label}: ${shown.length} buttons would render (${shown.join("/")})`);
  }
  for (const v of raw) {
    if (!VERB_IDS.has(v)) { failed++; console.log(`  FAIL ${label}: "${v}" has no entry in the VERB table`); }
  }
  if (raw.indexOf("listen") >= 0) { failed++; console.log(`  FAIL ${label}: LISTEN is back — the pitch is spoken now (autoListen)`); }
  if (raw.indexOf("befriend") >= 0) sawBefriend++;
  return raw;
}

console.log("interact-verbs-check  (max " + MAX_VERBS + " buttons)");

// ---- every approach kind, priced and unpriced, calm and feared -------------
for (const kind of APPROACH_KINDS) {
  for (const cost of [0, 12]) {
    for (const fear of [0, 9]) {
      assess(`approach:${kind} cost=${cost} fear=${fear}`,
        actor({ approach: { kind, t: 4, cost, msg: "x" }, playerFear: fear, data: { name: "Marcus", offer: { item: "Shiv", price: 8 } } }));
    }
  }
}

// ---- gunpoint, the warden, a known snitch, the player as a cop -------------
assess("gunpoint", actor({ intimidMode: "scared" }));
assess("warden", actor({ kind: "warden" }));
sandbox.CBZ.playerKnowsSnitch = () => true;
assess("known snitch", actor());
sandbox.CBZ.playerKnowsSnitch = () => false;
sandbox.CBZ.game = { role: "cop" };
assess("player is a cop", actor());
sandbox.CBZ.game = { role: "inmate", heat: 0 };

// ---- guards: clean/bent x stall/no stall x heat/no heat --------------------
for (const corrupt of [false, true]) {
  for (const stall of [false, true]) {
    for (const heat of [0, 40]) {
      sandbox.CBZ.game = { role: "inmate", heat };
      assess(`guard corrupt=${corrupt} stall=${stall} heat=${heat}`,
        actor({ kind: "guard", corrupt, data: stall ? { name: "Vance", offer: { item: "Phone", price: 14 } } : { name: "Vance" } }));
    }
  }
}
sandbox.CBZ.game = { role: "inmate", heat: 0 };

// ---- the street menu, in every combination that can stack ------------------
sandbox.CBZ.player = { gang: null };
for (const stall of [false, true]) {
  for (const recruiter of [false, true]) {
    for (const friendly of [false, true]) {
      sandbox.CBZ.prisonFriendOffered = () => friendly;
      const raw = assess(`inmate stall=${stall} recruiter=${recruiter} offering=${friendly}`,
        actor({
          data: stall ? { name: "Marcus", offer: { item: "Shiv", price: 8 } } : { name: "Marcus" },
          gang: recruiter ? 1 : -1, rep: recruiter ? 55 : 0,
        }));
      // THE PROMISE OF THE RENAME: BEFRIEND appears when, and only when, the
      // man in front of you has offered it.
      const has = raw.indexOf("befriend") >= 0;
      if (has !== friendly) {
        failed++;
        console.log(`  FAIL inmate stall=${stall} recruiter=${recruiter}: befriend ${has ? "shown without" : "missing despite"} an offer`);
      }
      // ...and TALK is what carries the favour loop now, on every ordinary man.
      if (raw.indexOf("talk") < 0) { failed++; console.log(`  FAIL inmate stall=${stall}: no TALK — the favour loop is unreachable`); }
    }
  }
}
sandbox.CBZ.prisonFriendOffered = null;

// ---- degradation: no prisonfriends.js at all ------------------------------
{
  const raw = assess("inmate, prisonfriends.js absent", actor());
  if (raw.indexOf("befriend") >= 0) { failed++; console.log("  FAIL befriend offered with no system to back it"); }
}

console.log(`  ${cases} contexts checked · befriend offered in ${sawBefriend}`);
console.log(failed ? `\nINTERACT-VERBS: ${failed} FAILED` : "\nINTERACT-VERBS: ok");
process.exit(failed ? 1 : 0);
