#!/usr/bin/env node
/* ============================================================
   tools/warlord-cover-check.mjs — THE DUNE IS THE COVER, AND THE ROUND FALLS.

   THE REPORT (owner, 2026-09-04): "for multiplayer and main game improve
   battle mechanics, rn scopes and shooting mechanics is dumb, and desert is
   great but fake rocks fuck, there is already cover from the natural steepness
   of the desert dunes ... the big thing is battle logic improving."

   WHY A PROBE AND NOT A PICTURE. Three of the five things that changed are
   invisible in a still. A boulder that is gone photographs as sand, and so
   does sand. A man hull-down behind a crest photographs as a man, and so does
   a man standing in a dip. A bullet that falls 0.9 m over 300 m photographs as
   a bullet. Only numbers can say whether the mechanic is there, so this asks
   for numbers and fails on them.

   IT ASKS THE GAME ITS OWN QUESTIONS. hullDown() is called through
   W.battle.hullDown and the drop through CBZ.fpsBallisticProbe — both public
   drive seams over the exact functions the AI and the bullet use. A probe that
   re-derives the terrain rule in node is grading the game against a second
   implementation of the rule, and the two disagreeing is the bug it would
   never find.

   THE SIX GATES

     A. NO FAKE ROCKS. On a DUNE-biome field: zero boulders, zero slabs, zero
        banks — zero cover props of any kind. Before this pass desert.js
        scattered 8 boulders on a dune field and battle.js scattered 34 more
        when it drew its own ground.
     B. THE GROUND IS THE COVER. Of the men holding a line under fire, at least
        60% have found a reverse-slope position, and the men in one are really
        crouched (a stance with a lower losY, not a pose) at some point in the
        sample window.
     C. A CHARGE ACROSS OPEN DUNES COSTS. With the enemy pinned on HOLD, the
        charging army takes more casualties than the holding one over the same
        window. Both numbers are printed — the assertion is the comparison,
        because absolute casualty counts move with the roster.
     D. THE ROUND FALLS. A sniper round fired dead level has measurably dropped
        by 300 m, a pistol round has not (it is hitscan and says so), and a
        live sniper shot really is in flight on the following frame while a
        live pistol shot never is.
     E. THREE GUNS, THREE SIGHT PICTURES. Aiming a pistol, a carbine and the
        bolt gun gives three different fields of view and three different hold
        wobbles. Before this pass all three gave 50 degrees, because ADS was
        one constant for every weapon in the game.
     F. THE HEADLESS TWIN AGREES. W.battle.resolve() — CONTRACT.md's promise of
        "two presentations of one battle model, never two models that can
        disagree", and the path every multiplayer and every skipped fight takes
        — kills men on BOTH sides, runs longer than a couple of ticks, and
        wins an even fight at roughly the rate W.odds() promised the player.

   Run:
     node tools/warlord-cover-check.mjs
     node tools/warlord-cover-check.mjs --seed 1337 --men 44
   Exit 0 clean, 1 on any gate.
============================================================ */
import { launch } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEED = opt("--seed", "1337");
const MEN = parseInt(opt("--men", "44"), 10);

const fails = [];
const gate = (ok, name, line) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}  ${line}`);
  if (!ok) fails.push(name + " — " + line);
};
const r2 = (v) => Math.round(v * 100) / 100;

const run = async () => {
  const rig = await launch({ rafBudget: 0 });
  try {
    const url = await rig.open("games/warlord.html", `go=1&seed=${SEED}&weather=off&sound=off`);
    console.log(`booting ${url}`);
    if (!await rig.wait(`window.__warlordReady === true && CBZ.warlord.phase() === "campaign"`, 180000)) {
      throw new Error("the campaign never came up");
    }

    /* ---- FIND THE GROUND, AND NOT BY PEAK-TO-PEAK RELIEF.

       The first version of this picked the dune field whose `relief` sat in
       the middle of the island's distribution, and landed on (-2400,-4400):
       26 m of relief, terrain-LOS armed, and the middle 150 m of it — exactly
       where two lines 160 m apart meet — a dead-flat pan at 2.4 m. A basin
       with high walls. Every one of 496 reverse-slope probes came back empty
       and every one of them was RIGHT.

       So the field is chosen by the question the mechanic actually asks: at
       the centre, with a threat 120 m off, how many positions in a fan are
       hidden to a crouched man and open to a standing one. That is hullDown()'s
       own test, run over the raw heightfield, and it is also the island-wide
       measurement worth printing — how much of this desert is folded enough to
       fight from at all. */
    const field = await rig.evl(`(() => {
      const D = CBZ.warlord.desert, gA = D.heightAt;
      const blocked = (ax, ay, az, bx, by, bz) => {
        const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
        if (d < 8) return false;
        const dy = by - ay, n = Math.ceil(d / 2.69);
        for (let i = 1; i < n; i++) {
          const t = i / n, at = t * d;
          if (at < 2 || d - at < 2) continue;
          if (gA(ax + dx * t, az + dz * t) > ay + dy * t + 0.35) return true;
        }
        return false;
      };
      const fold = (cx, cz) => {
        const tx = cx + 60, tz = cz, ty = gA(tx, tz) + 1.6;
        const mx = cx - 60, mz = cz, base = Math.atan2(mx - tx, mz - tz);
        let hid = 0, both = 0, n = 0;
        for (let a = -1.8; a <= 1.8; a += 0.55) {
          const sa = Math.sin(base + a), ca = Math.cos(base + a);
          for (let r = 3; r <= 26; r += 1.6) {
            n++;
            const px = mx + sa * r, pz = mz + ca * r, gy = gA(px, pz);
            if (!blocked(tx, ty, tz, px, gy + 1.0, pz)) continue;
            hid++;
            if (!blocked(tx, ty, tz, px, gy + 1.6, pz)) both++;
          }
        }
        return { n, hid, both };
      };
      const core = (cx, cz, R) => {
        let lo = 1e9, hi = -1e9;
        for (let x = -R; x <= R; x += 6) for (let z = -R; z <= R; z += 6) {
          const y = gA(cx + x, cz + z); if (y < lo) lo = y; if (y > hi) hi = y;
        }
        return Math.round((hi - lo) * 10) / 10;
      };
      const all = [];
      for (let x = -6000; x <= 6000; x += 400) {
        for (let z = -6000; z <= 6000; z += 400) {
          if (D.biomeAt(x, z) !== "dune") continue;
          const bf = D.battlefieldAt(x, z, 170);
          const f = fold(x, z);
          all.push({ x, z, relief: bf.relief, core: core(x, z, 90), both: f.both, fan: f.n });
        }
      }
      const folded = all.filter((f) => f.both > 0);
      folded.sort((a, b) => b.both - a.both);
      const pick = folded.length ? folded[Math.floor(folded.length * 0.15)] : all[0];
      const rs = all.map((f) => f.relief).sort((a, b) => a - b);
      return { pick, n: all.length, foldedN: folded.length,
               lo: rs[0], hi: rs[rs.length - 1], median: rs[Math.floor(rs.length / 2)],
               under6: all.filter((f) => f.relief <= 6).length };
    })()`);
    console.log(`\n  DUNE FIELDS ON SEED ${SEED}: ${field.n} sampled — peak-to-peak relief ${field.lo}..${field.hi} m, median ${field.median} m`);
    console.log(`  the terrain-LOS gate is relief > 6 m; ${field.under6} of ${field.n} dune fields fall under it (${r2(field.under6 / field.n * 100)}%) — the gate is honest, dunes are not flat`);
    console.log(`  but only ${field.foldedN} of ${field.n} (${r2(field.foldedN / field.n * 100)}%) hold a REVERSE-SLOPE position at the centre: peak-to-peak counts the rim, and a basin with high walls is flat where the men stand`);
    console.log(`  fighting at (${field.pick.x}, ${field.pick.z}) — dune, relief ${field.pick.relief} m, core relief ${field.pick.core} m, ${field.pick.both}/${field.pick.fan} of the reference fan is hull-down ground\n`);

    /* ---- STAND THE FIGHT UP ON IT. Both rosters out of the same constructor
       (the ?battle=1 door does this too), the player moved onto the chosen
       ground first so buildGround centres the field there. */
    await rig.evl(`(() => {
      const W = CBZ.warlord;
      W.state.you.x = ${field.pick.x}; W.state.you.z = ${field.pick.z};
      W.state.you.wid = "ak47";
      if (!W.state.army.length) {
        const mine = W.makeBand({ size: ${MEN}, faction: "militia" });
        for (let i = 0; i < mine.men.length; i++) W.addSoldier(mine.men[i]);
      }
      // the guns the sight gate needs in his hands later
      W.state.baggage = W.state.baggage || {};
      W.state.baggage.sidearm = (W.state.baggage.sidearm || 0) + 1;
      W.state.baggage.carbine = (W.state.baggage.carbine || 0) + 1;
      W.state.baggage.sniper  = (W.state.baggage.sniper  || 0) + 1;
      const b = W.makeBand({ size: ${MEN}, faction: "militia" });
      b.x = W.state.you.x + 40; b.z = W.state.you.z;
      W.state.bands.push(b);
      W.battle.start({ band: b });
      return true;
    })()`);
    if (!await rig.wait(`window.__warlordBattle && __warlordBattle.live() && __warlordGunplay && __warlordGunplay.on()`, 300000)) {
      throw new Error("the battle never came up");
    }
    await rig.evl(`__warlordBattle.freeze()`);
    // both sides dig in; the enemy is PINNED so the charge gate measures one charge
    await rig.evl(`(__warlordBattle.order("hold"), __warlordBattle.order("hold", "them", { lock: true }), true)`);
    await rig.evl(`__warlordBattle.advance(26)`);

    const a0 = await rig.evl(`__warlordBattle.audit()`);
    console.log(`  battle live: ${a0.mine.alive} v ${a0.them.alive}, biome ${a0.field.biome}, ` +
      `relief ${a0.field.relief} m / core ${a0.field.coreRelief} m, terrainLos ${a0.field.terrainLos}, folded ${a0.field.folded}`);

    // ---------------------------------------------------------------- GATE A
    const kinds = a0.field.coverKinds || {};
    const rocky = (kinds.boulder || 0) + (kinds.slab || 0) + (kinds.bank || 0);
    gate(a0.field.cover === 0 && rocky === 0, "A no fake rocks",
      `cover props on this dune field: ${a0.field.cover} (${JSON.stringify(kinds)})`);

    // ---------------------------------------------------------------- GATE B
    /* Sampled over eight seconds rather than read off one frame: a man in a
       fold POPS — down behind the lip, up to shoot, down again — so a single
       frame reports roughly half of them crouched by construction, and the
       question is whether each man is ever down at all. */
    const hull = await rig.evl(`(() => {
      const B = __warlordBattle;
      const seen = {}, everDown = {}, held = {};
      for (let k = 0; k < 16; k++) {
        B.advance(0.5);
        const men = B.men();
        const HOLDPATH = { hull: 1, cover: 1, fire: 1, peek: 1, flank: 1, sidestep: 1 };
        for (let i = 0; i < men.length; i++) {
          const m = men[i];
          if (m.you || m.dead || m.fled || m.routed || m.tgt === null) continue;
          /* THE DENOMINATOR IS THE MEN WHO ACTUALLY ASKED. think() only reaches
             the fold search on the HOLD path: a man still marching into
             contact, one who has lost sight of his mark and is pushing to
             regain it, one on a charge — none of them are looking for a
             reverse slope, and counting them would grade the search on men who
             never called it. */
          if (!HOLDPATH[m.slot]) continue;
          held[m.i + "/" + m.team] = 1;
          if (m.hull) seen[m.i + "/" + m.team] = 1;
          if (m.stance === "crouch") everDown[m.i + "/" + m.team] = 1;
        }
      }
      const a = B.audit();
      return { held: Object.keys(held).length, found: Object.keys(seen).length,
               down: Object.keys(everDown).length,
               probes: a.field.hull.probes, hits: a.field.hull.found };
    })()`);
    const foundPc = hull.held ? hull.found / hull.held : 0;
    const downPc = hull.found ? hull.down / hull.found : 0;
    gate(foundPc >= 0.60, "B the ground is the cover",
      `${hull.found}/${hull.held} engaged men found a reverse-slope position (${r2(foundPc * 100)}%), ` +
      `${hull.down} of those went down behind the lip (${r2(downPc * 100)}%); ` +
      `${hull.hits}/${hull.probes} terrain probes found one`);
    gate(downPc >= 0.60, "B they are really crouched",
      `${hull.down}/${hull.found} men in a fold reached crouch stance in the 8 s window`);

    // ---------------------------------------------------------------- GATE C
    /* THE CHARGE. Same battle, same men, enemy pinned on HOLD: order MINE to
       cross the open ground and count who dies over the same forty seconds.
       The holders are in folds (gate B just proved it); the chargers crest the
       dunes and are on the forward slope with nothing between them and the
       line. */
    const charge = await rig.evl(`(() => {
      const B = __warlordBattle;
      const a = B.audit();
      const d0 = { mine: a.mine.dead, them: a.them.dead };
      B.order("charge");
      B.advance(40);
      const b = B.audit();
      return { chargerDead: b.mine.dead - d0.mine, holderDead: b.them.dead - d0.them,
               order: b.order, enemyOrder: b.enemyOrder, live: !!b.live,
               mineAlive: b.mine.alive, themAlive: b.them.alive, over: !!b.over,
               hull: b.field ? b.field.hull : null };
    })()`);
    gate(charge.chargerDead > charge.holderDead, "C a charge across open dunes costs",
      `charging side lost ${charge.chargerDead}, holding side lost ${charge.holderDead} over the same 40 s ` +
      `(orders ${charge.order} v ${charge.enemyOrder}; ${charge.mineAlive} v ${charge.themAlive} left, over=${charge.over})`);

    // ---------------------------------------------------------------- GATE D
    const ball = await rig.evl(`(() => {
      const out = {};
      ["sniper", "carbine", "ak47", "lmg", "sidearm", "smg"].forEach(function (id) {
        out[id] = CBZ.fpsBallisticProbe(id, 300);
      });
      out.pistol50 = CBZ.fpsBallisticProbe("sidearm", 50);
      /* AND AT THE RANGE THE WEAPON ACTUALLY REACHES. 300 m is the number the
         brief asked for and the number a ballistic table is quoted at, but a
         live round dies at w.range (the sniper's own listed 240 m — past that
         the damage curve has no floor to stand on), so the holdover a player
         really dials is this one. */
      out.sniperAtRange = CBZ.fpsBallisticProbe("sniper", CBZ.weaponById("sniper").range);
      out.sniperRange = CBZ.weaponById("sniper").range;
      return out;
    })()`);
    console.log("");
    for (const id of ["sniper", "carbine", "ak47", "lmg", "sidearm", "smg"]) {
      const b = ball[id];
      console.log(`    ${id.padEnd(8)} v0 ${String(b.v0).padStart(3)} m/s   ` +
        (b.ballistic
          ? `drop at 300 m ${b.drop.toFixed(2)} m   time of flight ${b.tof.toFixed(3)} s   striking ${b.vEnd} m/s`
          : "HITSCAN (its band ends inside 90 m — see fpsmode's PROJECTILES block)"));
    }
    gate(ball.sniper.ballistic && ball.sniper.drop > 0.3, "D the sniper round falls",
      `${ball.sniper.drop.toFixed(2)} m of holdover at 300 m (${ball.sniper.tof.toFixed(3)} s in the air); ` +
      `${ball.sniperAtRange.drop.toFixed(2)} m at its own listed ${ball.sniperRange} m reach, which is the shot a player takes`);
    gate(!ball.sidearm.ballistic && ball.sidearm.drop === 0, "D the pistol does not",
      `sidearm stays hitscan (drop reported ${ball.sidearm.drop} m)`);

    /* AND THE LIVE ROUND REALLY LEAVES THE BARREL. The arithmetic above proves
       the integrator; this proves the integrator is wired to the trigger. */
    const flight = await rig.evl(`(() => {
      const GP = __warlordGunplay, B = __warlordBattle;
      GP.heal();
      const out = {};
      ["sniper", "sidearm"].forEach(function (id) {
        GP.rearm(id);
        B.advance(0.4);
        GP.look({ pitch: 0.02 });
        GP.pull();
        B.advance(1 / 60);
        out[id] = CBZ.fpsBulletsInFlight();
        B.advance(2.2);            // let it land before the next one
      });
      return out;
    })()`);
    gate(flight.sniper > 0 && flight.sidearm === 0, "D and it is really in flight",
      `one frame after the trigger: sniper rounds airborne ${flight.sniper}, pistol rounds airborne ${flight.sidearm}`);

    // ---------------------------------------------------------------- GATE E
    const sights = await rig.evl(`(() => {
      const GP = __warlordGunplay, B = __warlordBattle;
      const out = [];
      ["sidearm", "carbine", "sniper"].forEach(function (id) {
        GP.rearm(id);
        GP.stance("stand");
        GP.aim(false); B.advance(0.6);
        const hip = CBZ.camera.fov;
        GP.aim(true);  B.advance(1.4);
        const w = CBZ.currentGun();
        out.push({ id: id, optic: CBZ.weaponOptic(w).id, mag: CBZ.weaponOptic(w).mag,
                   hip: Math.round(hip * 100) / 100,
                   ads: Math.round(CBZ.camera.fov * 100) / 100,
                   want: Math.round(CBZ.weaponAdsFov(w, 75) * 100) / 100,
                   sens: Math.round(CBZ.fpsLookSensMul() * 1000) / 1000,
                   swayStand: Math.round(CBZ.playerSwayRad(w) * 1e6) / 1e6,
                   scoped: !!(CBZ.fpsScoped && CBZ.fpsScoped()) });
        GP.stance("prone"); B.advance(0.3);
        out[out.length - 1].swayProne = Math.round(CBZ.playerSwayRad(w) * 1e6) / 1e6;
        GP.stance("stand");
        GP.aim(false); B.advance(0.4);
      });
      return out;
    })()`);
    console.log("");
    for (const s of sights) {
      console.log(`    ${s.id.padEnd(8)} ${String(s.optic).padEnd(5)} ${s.mag}x   ` +
        `ADS fov ${String(s.ads).padStart(6)} (target ${s.want})   sens x${s.sens}   ` +
        `sway stand ${(s.swayStand * 1000).toFixed(2)} mrad / prone ${(s.swayProne * 1000).toFixed(2)} mrad` +
        (s.scoped ? "   [tube]" : ""));
    }
    const fovs = new Set(sights.map((s) => s.ads));
    const sways = new Set(sights.map((s) => s.swayStand));
    gate(fovs.size === 3, "E three guns, three fields of view",
      `ADS fov ${sights.map((s) => s.ads).join(" / ")} — before this pass every weapon in the game gave 50.00`);
    gate(sways.size === 3, "E three guns, three hold wobbles",
      `standing sway ${sights.map((s) => (s.swayStand * 1000).toFixed(2) + " mrad").join(" / ")}`);
    const proneDrops = sights.every((s) => s.swayProne < s.swayStand * 0.5);
    gate(proneDrops, "E the stance moves the wobble",
      `prone is ${sights.map((s) => r2(s.swayProne / s.swayStand)).join(" / ")} of standing`);

    // ---------------------------------------------------------------- GATE F
    /* THE HEADLESS TWIN. CONTRACT.md promises "two presentations of one battle
       model, never two models that can disagree" — W.battle.resolve() is what
       runs when a player skips a fight, drops mid-battle, when AI fights AI,
       and whenever a live multiplayer match cannot wait. It had never had a
       caller, and it disagreed: an even 20-levy fight resolved as a win 86% of
       the time with ZERO friendly casualties, and on a poorer roster every man
       routed on tick one and the fight ended on tick two with nobody dead. */
    const rs = await rig.evl(`(() => {
      const W = CBZ.warlord;
      /* THE WARLORD'S OWN GUN IS A VARIABLE IN THIS MODEL — attritionTick sizes
         his round stream off W.yourPower(), which reads his equipped weapon —
         so the gate pins it rather than inheriting whatever gate E left in his
         hands. The sidearm is what a campaign starts him with. */
      W.state.you.wid = "sidearm";
      const mk = (n) => { const a = []; for (let i = 0; i < n; i++) a.push(W.makeSoldier("levy", "sidearm")); return a; };
      const runN = (mine, them, N) => {
        let won = 0, dur = 0, yd = 0, td = 0, minDur = 1e9;
        for (let s = 0; s < N; s++) {
          const army = mk(mine);
          const band = { id: "t" + s, faction: "militia", name: "T", men: mk(them), x: 0, z: 0, gold: 0 };
          const r = W.battle.resolve({ band, army, apply: false, salt: s * 101 + 7 });
          if (r.outcome === "won") won++;
          dur += r.duration; minDur = Math.min(minDur, r.duration);
          yd += (r.yourDead || []).length; td += (r.theirDead || []).length;
        }
        const a2 = mk(mine), b2 = mk(them);
        return { pair: mine + "v" + them, n: N,
                 odds: Math.round(W.odds(W.power(a2) + 14, W.power(b2)) * 100) / 100,
                 win: won / N, dur: Math.round(dur / N), minDur: minDur,
                 yd: Math.round(yd / N * 10) / 10, td: Math.round(td / N * 10) / 10 };
      };
      return [runN(20, 14, 50), runN(20, 20, 50), runN(20, 28, 50)];
    })()`);
    console.log("");
    for (const r of rs) {
      console.log(`    resolve ${r.pair.padEnd(6)} over ${r.n} seeds: won ${(r.win * 100).toFixed(0)}% ` +
        `(W.odds says ${(r.odds * 100).toFixed(0)}%)   mean ${r.dur} ticks (shortest ${r.minDur})   ` +
        `mean dead ${r.yd} yours / ${r.td} theirs`);
    }
    const even = rs[1];
    gate(even.yd > 0 && even.td > 0, "F resolve() kills on both sides",
      `20 v 20 levies: ${even.yd} of yours and ${even.td} of theirs down per fight, on average`);
    gate(even.minDur > 10, "F resolve() is a battle, not a tick",
      `shortest of 50 even fights ran ${even.minDur} ticks (was 2, every time)`);
    gate(Math.abs(even.win - even.odds) <= 0.25, "F resolve() agrees with the card",
      `an even fight resolves ${(even.win * 100).toFixed(0)}% won against the ${(even.odds * 100).toFixed(0)}% W.odds promises the player`);
    gate(rs[0].win > even.win && even.win > rs[2].win, "F and it is monotone in strength",
      `20v14 ${(rs[0].win * 100).toFixed(0)}% > 20v20 ${(even.win * 100).toFixed(0)}% > 20v28 ${(rs[2].win * 100).toFixed(0)}%`);

    const errs = (rig.errors || []).filter((e) => !/favicon|ERR_/.test(e));
    if (errs.length) { console.log("\n  page errors:"); errs.slice(0, 8).forEach((e) => console.log("    " + e)); }
    gate(errs.length === 0, "page threw nothing", `${errs.length} console/exception entries`);
  } finally {
    await rig.close();
  }
};

run().then(() => {
  if (fails.length) {
    console.log(`\nWARLORD COVER CHECK FAILED — ${fails.length} gate(s)`);
    fails.forEach((f) => console.log("  · " + f));
    process.exit(1);
  }
  console.log("\nWARLORD COVER CHECK OK — the dunes are the cover, the sights are the weapon's, the round falls.");
  process.exit(0);
}).catch((e) => {
  console.error("\nWARLORD COVER CHECK ERROR — " + (e && e.message ? e.message : e));
  process.exit(1);
});
