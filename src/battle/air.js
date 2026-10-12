"use strict";
/* src/battle/air.js — NPC War: AIR SUPPORT.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ AIR SUPPORT
   A team's bombers are the SHIPPED B-2 on the derived-coefficient airframe,
   dropping ordnance sticks on the densest enemy concentration the grid can
   see. The nuke run is one aircraft, one release, after the armies have
   already met — then it leaves. Aircraft are equipment, not actors: nobody
   down there has anything that reaches 330 m. */
const airAim = { red: null, blue: null };   // where each team's AIR is looking (enemy mass)
let airAimT = 0;
function densestCellOf(team) {
  let best = null, bn = 0;
  grid.forEach(function (a) {
    let n = 0, x = 0, z = 0;
    for (let i = 0; i < a.length; i++) {
      const m = a[i];
      if (m.dead || m.team !== team) continue;
      n++; x += m.pos.x; z += m.pos.z;
    }
    if (n > bn) { bn = n; best = { x: x / n, z: z / n, n: n }; }
  });
  return best;
}
function spawnPlanes() {
  ["red", "blue"].forEach(function (team) {
    const opt = team === "red" ? SET.redS : SET.blueS;
    if (opt === "none") return;
    const count = opt === "bomber2" ? 2 : 1;
    for (let i = 0; i < count; i++) spawnBomber(team, i, opt === "nuke" && i === 0, 0);
  });
}
/* ONE BOMBER, for either side: the opening's air support, on its racetrack. */
function spawnBomber(team, i, isNuke, near) {
    {
      const side = team === "red" ? -1 : 1;
      // A NUKE PLANE NEVER TURNS. A loaded bomber's turnaround measured
      // close to a minute here, longer than half a war — so the armed run
      // is its FIRST run: it spawns however far out release-time-times-
      // airspeed says, already nose-on, and simply arrives.
      // release happens ~1.3 km short of the mass (that is how far a bomb
      // thrown at 165 m/s travels): the spawn distance buys the seconds
      // that put each plane's FIRST window after its own opening gate
      const dist = isNuke ? Math.max(2800, 165 * (AIR.nukeAt + 6)) : (near || 3400);
      const sx = HOST.cx + side * dist, sz = HOST.cz + (300 + i * 340) * side;
      const flown = STUDIO.fly("bomber", {
        groundAt: HOST.groundAt,
        at: { x: sx, y: 330 + i * 45, z: sz },
        heading: Math.atan2(sx - HOST.cx, sz - HOST.cz), speed: 165,
      });
      if (!flown || !flown.af) return;
      planes.push({
        team: team, af: flown.af, group: flown.group,
        mode: "in", outPt: null, runPt: null,
        nuke: isNuke, egress: false, dropCool: 1 + i * 2,
        trail: STUDIO.trail({ length: 60, color: TEAMS[team].color, opacity: 0.35, minStep: 24 }),
      });
    }
}
function dropStick(p) {
  // five bombs a pass on a long cooldown: air PUNCTUATES an infantry fight.
  // Seven on a short one deleted both armies at first contact and the
  // scoreboard read 8% infantry hits — a bombing demo, not a war.
  p.dropCool = 15 + lcg() * 9;
  AIR.sticks = (AIR.sticks || 0) + 1;
  CBZ.ordnance.stick({
    count: 5, interval: 0.14, kind: "iron", team: p.team, owner: "air-" + p.team,
    getState: function () { return p.af ? { pos: p.af.pos, vel: p.af.vel } : null;
    },
    onDetonate: function (b) {
      if (b && b.impact && HOST.id !== "arena") {
        // the stick is Mk 82s (ordnance.js "iron" names the row): the
        // building it lands on answers to that charge (systems/strike.js)
        STUDIO.collapseAt(b.impact, { mun: "mk82" });
      }
    },
  });
}
function releaseNuke(p) {
  p.nuke = false; p.egress = true;
  AIR.nukes = (AIR.nukes || 0) + 1;
  const kinds = CBZ.ordnance.kinds || {};
  CBZ.ordnance.release({
    pos: p.af.pos, vel: p.af.vel, kind: kinds.nuke ? "nuke" : "heavy",
    team: p.team, owner: "air-" + p.team,
    onDetonate: function (b) {
      const f = el("nflash");
      if (f) {
        f.style.transition = "none"; f.style.opacity = "1";
        setTimeout(function () { f.style.transition = "opacity 2.6s"; f.style.opacity = "0"; }, 90);
      }
      if (b && b.impact && HOST.id !== "arena") {
        for (let r = 0; r < 9; r++) {
          const a = (r / 9) * Math.PI * 2, d = b.radius * 0.5;
          STUDIO.collapseAt({ x: b.impact.x + Math.cos(a) * d, y: b.impact.y, z: b.impact.z + Math.sin(a) * d },
            { mun: "b61" });
        }
      }
    },
  });
}
/* A bomber at 165 m/s turns on a KILOMETRES-wide circle — measured here:
   bank-limited, ~1.6 km radius, which is why "orbit the target" never put
   the fall line over the mass and the first build dropped nothing all
   battle. So it flies what real bombers fly: a RACETRACK. A long straight
   run-in (head-on geometry always sweeps the release solution through the
   aim), one stick per pass, then a slow wide turnaround far past the
   target and back in. The pause between passes is not a limitation, it is
   the drone of a returning bomber. */
function stepPlanes(sdt) {
  for (let i = planes.length - 1; i >= 0; i--) {
    const p = planes[i];
    const enemy = p.team === "red" ? "blue" : "red";
    const aim = airAim[p.team] || teamCOM[enemy];
    p.dropCool -= sdt;
    const distAim = Math.hypot(p.af.pos.x - aim.x, p.af.pos.z - aim.z);
    /* THE ORBIT TRAP, measured twice before this shape: a jet whose turn
       circle is WIDER than its distance to the mark can chase the mark's
       bearing forever and never arrive — it settles into a stable ring at
       exactly its own turn radius (logged: d≈1.1 km, "inbound", for a
       whole battle). So the pattern is a real attack profile:
         out  — fly well past the mass and away (3 km), any bank
         turn — far out, slow to ~90 and haul around until the nose is ON
         in   — LOCK THE LINE: a fixed point far beyond the mass on the
                run-in bearing; never chase the aim sideways again. The
                predict gate spends the precision; the line spends none. */
    let hx, hz, phase = p.egress ? "egress" : p.mode;
    if (phase === "egress") {
      hx = HOST.cx + (p.team === "red" ? -4200 : 4200); hz = HOST.cz;
    } else if (phase === "out") {
      hx = p.outPt.x; hz = p.outPt.z;
      if (distAim > 1900) { p.mode = "turn"; phase = "turn"; }
    }
    if (phase === "turn") {
      hx = aim.x; hz = aim.z;
      let hErr = Math.atan2(p.af.pos.x - aim.x, p.af.pos.z - aim.z) - p.af.heading();
      while (hErr > Math.PI) hErr -= Math.PI * 2;
      while (hErr < -Math.PI) hErr += Math.PI * 2;
      if (Math.abs(hErr) < 0.3) {
        p.mode = "in"; phase = "in";
        const fx = aim.x - p.af.pos.x, fz = aim.z - p.af.pos.z;
        const fl = Math.hypot(fx, fz) || 1;
        p.runPt = { x: aim.x + (fx / fl) * 3000, z: aim.z + (fz / fl) * 3000 };
      }
    }
    if (phase === "in") {
      // the line is RE-LOCKED while far (the mass marches; a line drawn at
      // spawn points at where they were) and FROZEN inside 1200 m, where
      // chasing the aim sideways is the orbit trap again
      if (!p.runPt || (distAim > 1200 && (p.relockT = (p.relockT || 0) - sdt) <= 0)) {
        p.relockT = 2;
        const fx = aim.x - p.af.pos.x, fz = aim.z - p.af.pos.z;
        const fl = Math.hypot(fx, fz) || 1;
        p.runPt = { x: aim.x + (fx / fl) * 3000, z: aim.z + (fz / fl) * 3000 };
      }
      hx = p.runPt.x; hz = p.runPt.z;
    }
    // the airframe convention: heading h means forward is (-sin h, -cos h)
    const hdg = Math.atan2(p.af.pos.x - hx, p.af.pos.z - hz);
    _v.set(p.af.pos.x - Math.sin(hdg) * 2400, 330, p.af.pos.z - Math.cos(hdg) * 2400);
    const cmd = p.af.steerTo(_v, { gain: 2.4, bankLimit: phase === "turn" ? 1.15 : 0.8 });
    p.af.holdAltitude(330, cmd);
    p.af.throttle = phase === "turn" ? 0.42 : 0.72;
    p.af.step(sdt, cmd);
    if (p.group) p.af.applyTo(p.group);
    if (p.trail) p.trail.push(p.af.pos);
    if (p.egress) {
      if (Math.hypot(p.af.pos.x - HOST.cx, p.af.pos.z - HOST.cz) > 3200) {
        if (p.trail) p.trail.dispose();
        if (p.group) STUDIO.drop(p.group);
        if (p.af.dispose) p.af.dispose();
        planes.splice(i, 1);
      }
      continue;
    }
    if (p.mode !== "in" && distAim > 500) continue;
    // release when the SHARED integrator says the fall lands on the mass —
    // the same one-integrator rule the bombing game learned the hard way
    let dropped = false;
    if (CBZ.ordnance.predict) {
      const wantNuke = p.nuke && simT >= AIR.nukeAt;
      const nukeKind = (CBZ.ordnance.kinds && CBZ.ordnance.kinds.nuke) ? "nuke" : "heavy";
      const pr = CBZ.ordnance.predict(p.af.pos, p.af.vel, wantNuke ? nukeKind : "iron", 40);
      if (pr && pr.x != null) {
        const d = Math.hypot(pr.x - aim.x, pr.z - aim.z);
        p._predD = d;
        // a kilometre-radius weapon does not need a bullseye: any pass
        // within a few hundred metres of the mass IS on target
        if (wantNuke && (d < 400 || distAim < 700)) { releaseNuke(p); dropped = true; }
        // no bombs before the lines have even formed: the opening belongs
        // to the infantry, the air arrives ON a battle. The stick WALKS, so
        // overhead within half its spread is close enough when the
        // predicted point never quite kisses the aim.
        else if (!p.nuke && (d < 110 || (d < 300 && distAim < 500)) && p.dropCool <= 0 && simT > 10) { dropStick(p); dropped = true; }
      } else p._predD = -2;
    }
    // one pass, one stick: past the mass (or having dropped, or overshot
    // the locked line), swing out and set up the next run
    const overshot = p.runPt && Math.hypot(p.af.pos.x - p.runPt.x, p.af.pos.z - p.runPt.z) < 1100;
    if (!p.egress && p.mode === "in" && (dropped || distAim < 300 || overshot)) {
      p.mode = "out"; p.runPt = null;
      // outbound point: straight ahead through the mass and past it — kept
      // short, because every metre out here is lap time between passes
      const fwdH = p.af.heading();
      p.outPt = { x: p.af.pos.x - Math.sin(fwdH) * 1900, z: p.af.pos.z - Math.cos(fwdH) * 1900 };
    }
  }
}
