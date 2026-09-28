#!/usr/bin/env node
/* tools/cuff-gate-check.mjs — CAN A MAN ON HIS FEET BE CUFFED? (he can't)

   Owner, 2026-09-28: "it's too easy to get handcuffed. I need to get knocked
   down or knocked out or tased and knocked unconscious to get handcuffed."

   systems/arrest.js's rule, on the real rigs and the real verbs (plain node,
   tools/lib/verbs-vm.mjs):
     1. the pure rule (A.canCuff): down / ko / tased / pinned / surrendered /
        already cuffed, never a man who merely stopped, never "outnumbered"
     2. read off a live body (A.cuffable): the player standing, hands up,
        kneeling, tased, pinned, knocked out; an NPC standing, surrendered,
        complying by his own brain, knocked out
     3. CBZ.vitals (systems/vitals.js) outranks the old flags when loaded
     4. the hands (A.take) refuse a man on his feet who has not given up, and
        take one who put his hands up; a tased man on the floor is cuffed
        (on the floor, when verbs.js has the ground cuff)

     node tools/cuff-gate-check.mjs        exit 0 = ok */
import { loadVerbsVM } from "./lib/verbs-vm.mjs";

const t0 = Date.now();
const DT = 1 / 60;
const v = loadVerbsVM({ mode: "city" });
const { CBZ } = v;
const V = CBZ.verbs, A = CBZ.arrest;
if (!A || !A.cuffable) { console.log("FAIL: arrest.js did not load (or has no A.cuffable)"); process.exit(1); }
CBZ.CITY = { staminaMax: 100 };
const P = CBZ.player, PC = CBZ.playerChar, g = CBZ.game;

let fails = 0;
const rows = [];
function check(ok, name, detail) { rows.push({ ok, name, detail }); if (!ok) fails++; }
let seed = 777;
Math.random = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

function resetAll() {
  const live = A.active(); if (live) live.cancel();
  A.unsubdue();
  for (let i = V.sessions.length - 1; i >= 0; i--) V.sessions[i].cancel();
  if (PC.cuffed) V.setCuffs(V.playerActor(), false);
  v.clearActors(); v.world({});
  P.pos.set(0, 0, 3); P.dead = false; P.hp = 100; P.stun = 0; P.speed = 0; P.ko = 0; P.crouch = false; P.prone = false;
  P._wind = 1; P.stamina = 100; P._cityArrested = false;
  PC.group.position.copy(P.pos); PC.group.rotation.set(0, 0, 0);
  PC.cuffed = false; PC.handsUp = false; PC.surrender = false;
  if (PC.fall) { PC.fall.on = false; PC.fall.phase = ""; }
  g._citySurrender = false;
  delete CBZ.vitals;
  v.actors.push({ char: PC, pos: P.pos, dead: false, name: "player" });
}
function frames(n) { for (let i = 0; i < n; i++) { g.elapsed = (g.elapsed || 0) + DT; v.frame(DT); } }

// ---------------------------------------------------------------- 1. THE RULE
{
  const C = A.canCuff;
  const table = [
    [{}, null], [{ compliant: false }, null],
    [{ behind: true, backup: 3 }, null],                 // outnumbered from behind is NOT a reason any more
    [{ fighting: true }, null],
    [{ compliant: true }, "compliant"], [{ subdued: true }, "subdued"], [{ pinned: true }, "pinned"],
    [{ down: true }, "down"], [{ ko: true }, "ko"], [{ cuffed: true }, "cuffed"],
    [{ fighting: true, subdued: true }, "subdued"],        // tased mid-swing: he is down
    [{ fighting: true, compliant: true }, null],           // hands "up" while swinging: no
  ];
  const bad = table.filter(([ctx, want]) => C(ctx) !== want);
  check(!bad.length, "rule: down / out / tased / pinned / surrendered only", bad.length ? JSON.stringify(bad[0]) + " -> " + C(bad[0][0]) : `${table.length} cases`);
}

// ------------------------------------------------------- 2. THE PLAYER'S BODY
{
  const pa = () => V.playerActor();
  resetAll(); frames(3);
  check(A.cuffable(pa()) === null, "player: standing, hands down: not cuffable", String(A.cuffable(pa())));
  P.speed = 0; frames(1);
  check(A.cuffable(pa()) === null, "player: standing STILL, hands down: still not cuffable", String(A.cuffable(pa())));
  PC.handsUp = true;
  check(A.cuffable(pa()) === "compliant", "player: hands up: cuffable (he gave up)", String(A.cuffable(pa())));
  resetAll(); P.crouch = true; P.speed = 0;
  check(A.cuffable(pa()) === "compliant", "player: on his knees (crouched, still): cuffable", String(A.cuffable(pa())));
  P.speed = 3;
  check(A.cuffable(pa()) === null, "player: crouch-running is not kneeling", String(A.cuffable(pa())));
  resetAll(); frames(2);
  const c = v.actor({ x: 0, z: 0, name: "cop" }); c.kind = "cop"; CBZ.cityCops = [c];
  const r = A.tase(c, { chance: 1 }); frames(4);
  check(r.hit && A.cuffable(pa()) === "subdued", "player: tased: cuffable", `hit ${r.hit}, ${A.cuffable(pa())}`);
  resetAll(); A.subdue(2.2, "pinned");
  check(A.cuffable(pa()) === "down", "player: pinned under a tackle: cuffable", String(A.cuffable(pa())));
  resetAll(); P.ko = 3;
  check(!!A.cuffable(pa()), "player: knocked down: cuffable", String(A.cuffable(pa())));
}

// ------------------------------------------------------------ 3. AN NPC'S BODY
{
  resetAll();
  const n = v.actor({ x: 3, z: 3, name: "inmate" }); frames(2);
  check(A.cuffable(n) === null, "npc: standing: not cuffable", String(A.cuffable(n)));
  n.char.handsUp = true;
  check(A.cuffable(n) === "compliant", "npc: hands up: cuffable", String(A.cuffable(n)));
  n.char.handsUp = false; n._brain = { response: "comply" };
  check(A.cuffable(n) === "compliant", "npc: his own brain complied (kneels): cuffable", String(A.cuffable(n)));
  n._brain = { response: "fight" };
  check(A.cuffable(n) === null, "npc: his brain is fighting: not cuffable", String(A.cuffable(n)));
  n.ko = 4;
  check(A.cuffable(n) === "ko", "npc: knocked out: cuffable", String(A.cuffable(n)));
  n.ko = 0; n.dead = true;
  check(A.cuffable(n) === null, "npc: dead: nobody cuffs a corpse", String(A.cuffable(n)));
}

// ---------------------------------------------------------------- 4. CBZ.vitals
{
  resetAll();
  const n = v.actor({ x: 3, z: 3, name: "ped" }); frames(2);
  let st = "ok", tz = false;
  CBZ.vitals = { state: () => st, tased: () => tz };
  const seq = [];
  seq.push(A.cuffable(n)); st = "down"; seq.push(A.cuffable(n)); st = "ko"; seq.push(A.cuffable(n));
  st = "ok"; tz = true; seq.push(A.cuffable(n)); tz = false; st = "dead"; seq.push(A.cuffable(n));
  const want = [null, "down", "ko", "subdued", null];
  check(JSON.stringify(seq) === JSON.stringify(want), "vitals: state() and tased() decide when loaded", JSON.stringify(seq));
  delete CBZ.vitals;
}

// ---------------------------------------------------------------- 5. THE HANDS
{
  resetAll();
  const c = v.actor({ x: 0, z: 1.2, name: "cop" }); c.kind = "cop"; CBZ.cityCops = [c];
  frames(4);
  const h0 = A.take(c, {});
  frames(60);
  check(!h0 && !PC.cuffed && !V.playerHeld(), "take: refused on a man on his feet who has not given up", `handle ${!!h0}, cuffed ${PC.cuffed}`);

  resetAll();
  const c2 = v.actor({ x: 0, z: 1.2, name: "cop" }); c2.kind = "cop"; CBZ.cityCops = [c2];
  frames(4);
  PC.handsUp = true;
  const h1 = A.take(c2, {});
  for (let f = 0; f < 60 * 8 && h1 && !PC.cuffed; f++) frames(1);
  check(!!h1 && PC.cuffed, "take: hands up = cuffed (standing)", `handle ${!!h1}, cuffed ${PC.cuffed}`);

  resetAll();
  const c3 = v.actor({ x: 0, z: 0, name: "cop" }); c3.kind = "cop"; CBZ.cityCops = [c3];
  frames(4);
  A.tase(c3, { chance: 1 });
  frames(20);
  let downAtHands = null;
  const h2 = A.take(c3, { subdued: true });
  for (let f = 0; f < 60 * 10 && h2 && !PC.cuffed; f++) {
    frames(1);
    if (downAtHands == null && V.playerHeld()) downAtHands = !!A.downState(V.playerActor());
  }
  check(!!h2 && PC.cuffed, "take: tased = cuffed", `handle ${!!h2}, cuffed ${PC.cuffed}`);
  if (V.cuffDown) check(downAtHands === true, "take: tased = cuffed ON THE FLOOR (he kneels on you, not hauls you up)", `down when the hands landed: ${downAtHands}`);
  else check(true, "take: ground cuff not in this verbs.js (hauled up first)", "V.cuffDown absent");
}

const errs = v.errors.splice(0);
check(!errs.length, "no errors thrown by the loaded files", errs[0] ? errs[0].split("\n")[0] : "0");
for (const r of rows) console.log(`  ${r.ok ? "ok  " : "FAIL"} ${r.name}  ${r.detail || ""}`);
console.log(`CUFF GATE: ${fails ? "FAIL" : "PASS"}  ${rows.length - fails}/${rows.length}  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(fails ? 1 : 0);
