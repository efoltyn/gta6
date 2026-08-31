#!/usr/bin/env node
/* ============================================================
   tools/warlord-take-check.mjs — CAN YOU TAKE THE GUN OFF THE SAND.

   OWNER: "when u kill in battle guns already drops nicely add e to pickup or
   to switch guns each guy carries one and for touch a button to switch guns
   mid battle to whatever is on the ground in front of you."

   THE REASON THIS IS A TOOL AND NOT A SCREENSHOT. Every part of this feature
   is invisible in a still. A rifle lying on sand looks identical whether it is
   a prop nobody can touch (which is what `dropGuns` was for the life of the
   game — push-only, capped, swept at teardown) and a thing you can walk over
   and pick up. What tells them apart is a chain of state changes, and each
   link fails silently:

     · the dropped mesh has to KNOW WHICH GUN IT IS (actorweapons stamps
       userData.weaponId — but only on models it built)
     · the reach test has to find it (and not find one still in the air)
     · KeyE has to reach battle.js (the touch button synthesises the same code
       into microboot's input, so one path proves both devices)
     · core's W.equip has to swap it in and put the old gun in the cart
     · fpsmode has to actually be HOLDING it afterwards — a wid the warlord
       owns that fpsmode never selected is a man carrying an invisible rifle
     · and the dead man's row has to LOSE it, or the aftermath cart counts the
       same AK twice: once in your hands, once in the baggage.

   THE ONE THAT NEEDED A CONTROL. `taken` going up proves nothing on its own —
   so this asserts the gun in the warlord's hands CHANGED to the id that was on
   the ground, and that the id it changed FROM is now in the baggage. Both
   sides of the swap, from the two systems that own them.

     node tools/warlord-take-check.mjs
     node tools/warlord-take-check.mjs --seed 90210

   Exit 0 clean, 1 on any failure.
============================================================ */
import { launch } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEED = opt("--seed", "1337");

const run = async () => {
  const rig = await launch({ rafBudget: 0 });
  const fails = [];
  const ok = (cond, label, detail) => {
    console.log((cond ? "  ok    " : "  FAIL  ") + label + (detail != null ? "   " + detail : ""));
    if (!cond) fails.push(label + (detail != null ? "   " + detail : ""));
  };
  try {
    /* THE WARLORD CARRIES A PISTOL AND THE ENEMY CARRIES RIFLES. `gun=sidearm`
       is the whole point of the test: the id he ends up holding must be one he
       could only have got off the sand. A warlord who starts with the same AK
       the militia carries proves nothing when he picks one up. */
    const url = await rig.open("games/warlord.html",
      `battle=1&frozen=1&seed=${SEED}&mine=14&them=30&gun=sidearm&faction=militia&myfaction=legion&weather=off&sound=off`);
    console.log(`booting ${url}\n`);

    const up = await rig.wait(
      `!!(window.__warlordBattle && window.__warlordBattle.live && window.__warlordBattle.live())`, 300000);
    if (!up) { fails.push("the battle never started"); throw new Error("no battle"); }

    for (const e of (rig.errors || [])) fails.push(`console error: ${typeof e === "string" ? e : JSON.stringify(e)}`);

    /* RUN THE FIGHT UNTIL THERE ARE RIFLES ON THE GROUND. frozen=1 means the
       page's own clock is stopped and advance() is the only time that passes,
       so this is deterministic rather than "wait and hope". */
    const sown = await rig.evl(`(() => {
      const B = window.__warlordBattle;
      B.freeze();
      for (let i = 0; i < 40; i++) {
        B.advance(3);
        const a = B.audit();
        if (a && a.floor && a.floor.guns >= 6) break;
        if (a && a.over) break;
      }
      const a = B.audit();
      return { guns: a.floor.guns, on: a.floor.on, dead: a.them.dead, t: Math.round(a.simT) };
    })()`);
    console.log("  " + JSON.stringify(sown) + "\n");
    ok(sown.on, "the pickup is live (not ?take=off)");
    ok(sown.guns > 0, "dead men leave rifles on the sand", sown.guns + " guns after " + sown.t + "s");

    /* WALK HIM ONTO ONE. gunplay's place() is the same seam the visual preset
       uses to stand the warlord somewhere; the reach test is battle.js's own. */
    const reach = await rig.evl(`(() => {
      const B = window.__warlordBattle, W = CBZ.warlord;
      const g = B.floorGuns()[0];
      if (!g) return { err: "no gun on the floor" };
      W.gunplay.place({ x: g.x, z: g.z });
      B.advance(0.001);
      const a = B.audit();
      return { at: g.id, reach: a.floor.reach, label: a.floor.label, held: W.state.you.wid };
    })()`);
    console.log("  " + JSON.stringify(reach) + "\n");
    ok(!reach.err, "a dropped rifle can be located", reach.err || "ok");
    ok(!!reach.reach, "standing on it puts it in reach", "prompt: " + JSON.stringify(reach.label));
    ok(/^(TAKE|AMMO)/.test(String(reach.label || "")), "the prompt names the gun", reach.label);

    /* THE PRESS. Synthesised into microboot's own input map, which is exactly
       what the phone button does — so this one press exercises both devices.
       Held for two frames and released, because the pickup fires on the RISING
       EDGE and a test that never releases would not notice if it did not. */
    const took = await rig.evl(`(() => {
      const B = window.__warlordBattle, W = CBZ.warlord;
      const before = { wid: W.state.you.wid, fps: CBZ.currentWeaponId,
                       bag: JSON.parse(JSON.stringify(W.state.baggage || {})),
                       guns: B.audit().floor.guns };
      const want = B.floorGuns()[0];
      B.press("KeyE", true);
      B.advance(0.05);
      B.press("KeyE", false);
      B.advance(0.05);
      const a = B.audit();
      return {
        wanted: want ? want.wid : null,
        before: before,
        after: { wid: W.state.you.wid, fps: CBZ.currentWeaponId,
                 bag: JSON.parse(JSON.stringify(W.state.baggage || {})),
                 guns: a.floor.guns, taken: a.floor.taken },
      };
    })()`);
    console.log("  " + JSON.stringify(took) + "\n");
    const b = took.before, a2 = took.after;
    ok(a2.taken === 1, "one press takes exactly one rifle", "taken " + a2.taken);
    ok(a2.guns === b.guns - 1, "and it leaves the sand", b.guns + " → " + a2.guns);
    ok(a2.wid === took.wanted, "the warlord is holding the gun that was on the ground",
       b.wid + " → " + a2.wid + " (wanted " + took.wanted + ")");
    ok(a2.fps === took.wanted, "…and fpsmode agrees he is holding it",
       b.fps + " → " + a2.fps);
    ok((a2.bag[b.wid] || 0) === (b.bag[b.wid] || 0) + 1,
       "his old gun went into the cart, not onto the sand",
       b.wid + " in baggage: " + (b.bag[b.wid] || 0) + " → " + (a2.bag[b.wid] || 0));

    /* THE DOUBLE-COUNT. The aftermath builds your cart by walking every dead
       man's own wid; a rifle taken off the sand has to be struck off the row
       it came from or you are handed it twice. */
    const dbl = await rig.evl(`(() => {
      const B = window.__warlordBattle;
      return B.spoilPeek();
    })()`);
    console.log("  " + JSON.stringify(dbl) + "\n");
    ok(dbl.armedDead + dbl.strippedDead === dbl.dead,
       "every dead man is either still armed or stripped", JSON.stringify(dbl));
    ok(dbl.strippedDead >= 1, "the man you looted is stripped in the aftermath ledger",
       dbl.strippedDead + " stripped of " + dbl.dead + " dead");
  } finally {
    await rig.close();
  }

  if (fails.length) {
    console.log(`\nWARLORD TAKE: FAIL — ${fails.length}\n`);
    for (const f of fails) console.log("  · " + f);
    process.exit(1);
  }
  console.log("\nWARLORD TAKE OK — a rifle off a body is a rifle in your hands.");
};

run().catch((e) => { console.error(e); process.exit(1); });
