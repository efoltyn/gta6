/* THE FLASH FLOOD storyboard for tools/visual-compare.mjs.

   Skeleton lifted from quake-stages.mjs (same boot, same rAF freeze, same
   CBZ.stepSim clock), narrowed to the flash flood and staged along its real
   timeline. The beats are the real event's beats:

     gutters      the ONLY warning there is: the sky opens and the streets
                  start to stand. Shot as a PAIR 0.15 s apart — the rain
                  moves, the standing water spreads, nothing else does.
     the front    THE shot the event exists for: dry ground in the
                  foreground, a churning wall of moving water arriving
                  behind it. Also a PAIR — a wall that does not move
                  between frames is a stain, not a flood.
     knockdown    six inches of moving water taking someone off their feet.
     car adrift   two feet of water floating a car off its tyres.
     the lake     the stand: streets under opaque brown water, debris riding it.
     the drain    the part that strands people — water going out slowly,
                  flotsam grounding in the streets it leaves.

   CAMERAS ARE SOLVED, NOT TYPED (quake-stages.mjs says why at length): every
   beat asks the LIVE world — the real front line via CBZ.groundWaterFront(),
   the wettest bot, the swept car — and frames THAT. A beat whose subject
   does not exist says so in the frame instead of lying.

   FLAG A/B against this same checkout: the before side boots with
   ?cfg_FLASHFLOOD_V2=0, which reverts systems/flashflood.js (churn, debris,
   mud, crest, roar) and leaves the 2026-08-03 rain-fed flood exactly as it
   shipped — a correct depth field with an invisible front.

   THE HONESTY METRIC IS privateWaterPlanes. The front must stay a term in
   the shared depth field plus non-surface FX; if either side ever answers
   "make the flood visible" with a water mesh, that number catches it. */

const subjects = [
  { id: "gutters-a", label: "The warning — gutters standing, frame 1 of 2", pair: "gutters",
    focus: "Warn phase. The sky has opened and the streets have started to stand — the only warning a flash flood gives. On the after side the runoff is already browning. Frame 1 of a 0.15 s pair.",
    act: { force: "flashflood", untilState: "warn", extraSecs: 3.6 },
    cam: { aim: "street", back: 11, up: 9, look: 0.2 } },
  { id: "gutters-b", label: "The warning — frame 2 of 2", pair: "gutters",
    focus: "The same camera 0.15 s later. The rain has moved and the sheet has crept; the buildings have not. That creep is the whole telegraph.",
    act: { extraSecs: 0.1 },
    cam: { aim: "street", back: 11, up: 9, look: 0.2, hold: true } },

  /* From here every beat is pinned to an ABSOLUTE sim-second of the flood's
     active phase (atSecs), so a --subjects subset photographs the same moment
     as the full storyboard. Def timeline (activeSecs 18): the front runs the
     channel from t=0 and stands down at ~9.9 s; rise 0-7.6 s, stand 7.6-12.2,
     drain 12.2-18. */
  { id: "front-a", requireFlood: true, label: "THE FRONT — frame 1 of 2",
    focus: "Dry ground in the foreground, a wall of moving water arriving behind it — the shot the whole event exists for. Before: the street gets shinier along an invisible line. After: a churning crest of spray and mud with debris tumbling in it, standing proud of the water behind.",
    act: { atSecs: 3.4 },
    cam: { aim: "front", ahead: 22, up: 12 } },
  { id: "front-b", requireFlood: true, label: "THE FRONT — frame 2 of 2", pair: "front",
    focus: "The same camera 0.12 s later. A real front covers more than a metre between these frames; the spray has moved and the streaks on the sheet have advected. A flood that is identical in both frames is a painting.",
    act: { extraSecs: 0.07 },
    cam: { aim: "front", hold: true } },

  { id: "knockdown", requireFlood: true, label: "Six inches of moving water",
    focus: "Someone in the shallow moving water near the front — the depth that looks wadeable and is not. The knockdown physics read the same field on both sides; the after side is the one where you can SEE why (opaque brown water, streaming, churned).",
    act: { atSecs: 5.6 },
    cam: { aim: "wetbot", back: 9, up: 2.6, look: 0.6 } },

  { id: "car-adrift", requireFlood: true, label: "Two feet floats a car",
    focus: "A car picked up by the channel. Both sides fling it off the same shared depth threshold (0.6 m); the after side surrounds it with water that reads as something that could carry a car.",
    act: { atSecs: 8.2 },
    cam: { aim: "car", back: 15, up: 4, look: 0.8 } },

  { id: "lake", requireFlood: true, label: "The stand — an opaque lake in the streets",
    focus: "The front has done its work and the event is a lake at full depth. Before: a clear blue-grey sheet you can see the road through. After: suspended mud — you cannot see the ground under real floodwater, which is precisely why people step into it.",
    act: { atSecs: 12.4 },
    cam: { aim: "channel", back: 26, up: 13, look: 1 } },

  { id: "drain", requireFlood: true, label: "The drain — what the water leaves",
    focus: "Water goes up fast and out slowly; the drain is the part that strands whoever climbed onto something. On the after side the entrained flotsam grounds in the streets as the level drops — the junk line a real flash flood leaves.",
    act: { atSecs: 16.6 },
    cam: { aim: "channel", back: 24, up: 7, look: 0.8 } },
];

async function stageFlood(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const setHud = (visible) => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__floodOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__floodSeq;
  if (!S) {
    const booted = await until(
      () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="survival"]'), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    document.querySelector('[data-mode="survival"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (!CBZ.disasters || typeof CBZ.disasters.force !== "function") return { ok: false, err: "no CBZ.disasters.force" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__floodOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__floodSeq = { overlay, cam: null, t0: null };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const subject = input.subject;
  const act = subject.act || {};
  const heal = () => {
    if (!CBZ.player) return;
    CBZ.player.hp = 100; CBZ.player.dead = false;
    if (CBZ.player.stamina != null) CBZ.player.stamina = 100;
    if (CBZ.player.breath != null) CBZ.player.breath = 100;
  };
  let ticks = 0, totalMs = 0, maxMs = 0, over33 = 0;
  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      const t0 = performance.now();
      CBZ.stepSim(1 / 60);
      const ms = performance.now() - t0;
      ticks++; totalMs += ms;
      if (ms > maxMs) maxMs = ms;
      if (ms > 33) over33++;
      heal();
    }
  };
  const stepUntilState = (want, budget) => {
    let guard = Math.round((budget || 30) * 10);
    while (guard-- > 0 && CBZ.disasters.state() !== want) step(0.1);
  };

  /* ORDER-INDEPENDENCE (quake-stages' rule): any beat that needs the flood
     says so, re-forces it if the director has wandered, and seeks to its own
     absolute second of the ACTIVE phase. */
  const armFlood = () => {
    CBZ.disasters.force("flashflood"); step(0.1);
    stepUntilState("active", 40);
    S.t0 = CBZ.disasters.timeLeft();
  };
  if (subject.requireFlood && CBZ.disasters.current() !== "FLASH FLOOD" && !act.force) armFlood();
  if (act.force) {
    CBZ.disasters.force(act.force); step(0.1);
    if (act.force === "flashflood") S.t0 = null;
  }
  if (act.untilState) stepUntilState(act.untilState, 40);
  if (act.atSecs != null) {
    if (CBZ.disasters.state() !== "active") stepUntilState("active", 40);
    if (S.t0 == null) S.t0 = CBZ.disasters.timeLeft();
    let guard = 900;
    while (guard-- > 0 && CBZ.disasters.state() === "active" &&
           CBZ.disasters.current() === "FLASH FLOOD" &&
           (S.t0 - CBZ.disasters.timeLeft()) < act.atSecs) step(0.1);
  }
  if (act.extraSecs) step(act.extraSecs);

  // ---- SOLVE THE CAMERA off live world state -----------------------------
  const arena = CBZ.surv && CBZ.surv.arena;
  const A = arena ? { cx: arena.center.x, cz: arena.center.z, r: arena.radius } : { cx: 0, cz: 600, r: 120 };
  const cam = subject.cam || {};
  const gw = (x, z) => (CBZ.groundWaterAt ? CBZ.groundWaterAt(x, z) : 0);
  const gnd = (x, z) => (CBZ.floorAt ? CBZ.floorAt(x, z) : 0);
  /* CAN THE EYE SEE THE SUBJECT — tested against the things an island town
     is made of (tower footprints, hills, the terrain itself), because a
     coordinate cannot know what stands at it. Used by every solved shot. */
  const _fr = (arena && arena.fragile) || [];
  const _hills = (arena && arena.hills) || [];
  const corridorBlocked = (ax, ay, az, bx, by, bz) => {
    for (let t = 0.08; t <= 0.92; t += 0.084) {
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      for (const b of _fr) {
        if (b.fallen) continue;
        if (Math.abs(x - b.x) < (b.w || 0) / 2 + 1 && Math.abs(z - b.z) < (b.d || 0) / 2 + 1 &&
            y < (b.gy || 0) + (b.h || 0)) return true;
      }
      for (const h of _hills) {
        if (Math.hypot(x - h.x, z - h.z) < (h.r || 0) * 0.8 && y < (h.peak || 0)) return true;
      }
      if (y < gnd(x, z) + 0.5) return true;
    }
    return false;
  };
  let target = null, note = "";
  if (cam.hold && S.cam) {
    target = S.cam.target; note = S.cam.note + " (held)";
  } else if (cam.aim === "street") {
    // the WETTEST parked car's street — where the gutters actually stand
    // first (the lowest car by floor height sat on dry ground in pass 3)
    const cars = (arena && arena.cars) || [];
    let best = null, bs = -1e9;
    for (const c of cars) {
      const s = gw(c.x, c.z) * 10 - gnd(c.x, c.z) * 0.1;
      if (s > bs) { bs = s; best = c; }
    }
    if (best) { target = { x: best.x, y: gnd(best.x, best.z) + 0.5, z: best.z }; note = "wettest street, gw " + gw(best.x, best.z).toFixed(2) + "m"; }
  } else if (cam.aim === "front") {
    /* THE WALL, shot from the dry ground it is about to take. The front line
       crosses the whole island, dry hills included, so the shot has to find
       the point on the LIVE line where the wall is actually running: scan
       lateral offsets and take the one with the deepest water just behind the
       crest, then stand `ahead` metres downstream of THAT, low, looking back
       upstream. The first pass of this preset aimed at the centreline and
       photographed the dry refuge cone — quake-stages' lesson, relearned. */
    const F = CBZ.groundWaterFront ? CBZ.groundWaterFront() : null;
    if (F) {
      const lx = -F.dz, lz = F.dx;
      /* the eye must SEE the crest: every candidate lane is depth-scored AND
         its eye→crest corridor is tested; the deepest UNBLOCKED lane wins,
         and if the whole line is walled in the shot falls back to a high
         aerial that nothing can stand in front of. */
      const lanes = [];
      for (let u = -A.r * 0.65; u <= A.r * 0.65; u += 5) {
        const px = F.x + F.dx * (F.s - 4) + lx * u, pz = F.z + F.dz * (F.s - 4) + lz * u;
        lanes.push({ u, d: gw(px, pz) });
      }
      lanes.sort((a, b) => b.d - a.d);
      const ahead = cam.ahead != null ? cam.ahead : 22;
      let pick = null;
      for (const L of lanes.slice(0, 12)) {
        if (L.d < 0.1) break;
        const fx = F.x + F.dx * F.s + lx * L.u, fz = F.z + F.dz * F.s + lz * L.u;
        const ex = fx + F.dx * ahead, ez = fz + F.dz * ahead;
        const ey = gnd(ex, ez) + (cam.up != null ? cam.up : 12);
        if (!corridorBlocked(ex, ey, ez, fx, gnd(fx, fz) + 1.2, fz)) { pick = { fx, fz, ex, ez, ey, d: L.d }; break; }
      }
      if (!pick) {
        // walled in: the aerial nobody can block
        const L = lanes[0] || { u: 0, d: 0 };
        const fx = F.x + F.dx * F.s + lx * L.u, fz = F.z + F.dz * F.s + lz * L.u;
        const ex = fx + F.dx * (ahead + 14), ez = fz + F.dz * (ahead + 14);
        pick = { fx, fz, ex, ez, ey: gnd(ex, ez) + 30, d: L.d, aerial: true };
      }
      target = { x: pick.fx, y: gnd(pick.fx, pick.fz) + 0.4, z: pick.fz, look: 0 };
      target.eye = { x: pick.ex, y: pick.ey, z: pick.ez };
      note = "front s=" + F.s.toFixed(1) + " v=" + F.speed.toFixed(1) + " lane " + pick.d.toFixed(2) + "m" +
        (pick.aerial ? " (aerial fallback)" : "") + ", dryAhead gw=" + gw(pick.ex, pick.ez).toFixed(2);
    }
  } else if (cam.aim === "wetbot") {
    // the person the six inches is happening to: a live bot in shallow
    // MOVING water (0.1-1.1 m), scored by depth × flow — a bot in a still
    // puddle on a terrace is not the beat, however deep it stands
    const bots = CBZ.bots || [];
    const flowTmp = { x: 0, z: 0, speed: 0 };
    const FL = CBZ.groundWaterFront ? CBZ.groundWaterFront() : null;
    let best = null, bs = -1, bd = 0, bf = 0;
    for (const b of bots) {
      if (!b || b.dead || !b.pos) continue;
      const d = gw(b.pos.x, b.pos.z);
      if (d < 0.08 || d > 1.3) continue;
      const f = CBZ.groundWaterFlowAt ? CBZ.groundWaterFlowAt(b.pos.x, b.pos.z, flowTmp).speed : 0;
      if (f < 0.8) continue;                       // still water is a puddle, not the beat
      const s = d * (1 + f);
      if (s > bs) { bs = s; bd = d; bf = f; best = b; }
    }
    if (!best && FL) {
      // nobody wading in the torrent — take whoever is closest to the crest
      // line and wet at all: that is where the knockdown is about to happen
      let bDist = 1e9;
      for (const b of bots) {
        if (!b || b.dead || !b.pos) continue;
        if (gw(b.pos.x, b.pos.z) < 0.05) continue;
        const behind = FL.s - ((b.pos.x - FL.x) * FL.dx + (b.pos.z - FL.z) * FL.dz);
        const dist = Math.abs(behind);
        if (dist < bDist) { bDist = dist; best = b; bd = gw(b.pos.x, b.pos.z); bf = 0; }
      }
    }
    if (!best) {
      for (const b of bots) { if (!b || b.dead || !b.pos) continue; const d = gw(b.pos.x, b.pos.z); if (d > bs) { bs = d; bd = d; best = b; } }
    }
    if (best) { target = { x: best.pos.x, y: best.pos.y + 0.9, z: best.pos.z }; note = "bot in " + bd.toFixed(2) + "m moving " + bf.toFixed(1) + "m/s"; }
  } else if (cam.aim === "car") {
    // a car the water actually took, else the deepest-parked one
    const cars = (arena && arena.cars) || [];
    let best = null, bs = -1;
    for (const c of cars) {
      const score = (c.flung ? 10 : 0) + gw(c.x, c.z);
      if (score > bs) { bs = score; best = c; }
    }
    if (best) {
      const g = best.group && best.group.position;
      const y = (g ? g.y : gnd(best.x, best.z)) + 0.6;
      target = { x: g ? g.x : best.x, y, z: g ? g.z : best.z };
      note = (best.flung ? "swept car" : "deepest car") + ", gw " + gw(best.x, best.z).toFixed(2) + "m";
    }
  } else if (cam.aim === "channel") {
    // down the channel the def solved: the low bearing the water runs
    const st = (CBZ.disasters.hazards() || []).find((h) => h.line);
    const F = CBZ.groundWaterFront ? CBZ.groundWaterFront() : null;
    // channel bearing survives after the front stands down: recover it from
    // the water-event descriptor's dx/dz via the deepest ring sample
    let dx = F ? F.dx : (st ? st.dx : null), dz = F ? F.dz : (st ? st.dz : null);
    if (dx == null) {
      let lo = 1e9, la = 0;
      for (let i = 0; i < 16; i++) {
        const a2 = (i / 16) * Math.PI * 2;
        const h = gnd(A.cx + Math.cos(a2) * A.r * 0.8, A.cz + Math.sin(a2) * A.r * 0.8);
        if (h < lo) { lo = h; la = a2; }
      }
      dx = Math.cos(la); dz = Math.sin(la);
    }
    const tx = A.cx + dx * A.r * 0.45, tz = A.cz + dz * A.r * 0.45;
    target = { x: tx, y: gnd(tx, tz), z: tz };
    target.eye = { x: A.cx - dx * (cam.back || 30), y: gnd(A.cx, A.cz) + (cam.up || 20), z: A.cz - dz * (cam.back || 30) };
    note = "down the channel, gw " + gw(tx, tz).toFixed(2) + "m";
  }
  if (!target) {
    target = { x: A.cx, y: 3, z: A.cz };
    note = note || "fallback: subject missing";
  }
  if (!cam.hold) S.cam = { target, note };

  /* THE POND FOLLOWS THE SUBJECT. weather.js's waterline uniform is anchored
     at the camera DURING the sim tick — i.e. at the player, wherever he is —
     so a staged camera photographs streets the sim says are under a metre of
     water and the paint isn't there. Nominate the subject as the anchor and
     give the coat one ministep (3 ticks, 0.05 s — nothing measurable moves)
     to pick it up before the frame. */
  CBZ.weatherPoolAnchor = { x: target.x, z: target.z };
  step(0.05);

  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55; camera.near = 0.4; camera.far = 20000;
  const lookY = (target.y || 0) + (target.look != null ? target.look : (cam.look != null ? cam.look : 1));
  // never inside a building: an eye that lands in a tower's footprint is
  // lifted above its roof (pass 2 of this preset shot the inside of one)
  const clearBuildings = (e) => {
    const fr = (arena && arena.fragile) || [];
    for (const b of fr) {
      if (Math.abs(e.x - b.x) < (b.w || 0) / 2 + 2 && Math.abs(e.z - b.z) < (b.d || 0) / 2 + 2)
        e.y = Math.max(e.y, (b.gy || 0) + (b.h || 0) + 2.5);
    }
  };
  if (target.eye) {
    // never underground, never underwater: the eye clears both fields
    try {
      const g = gnd(target.eye.x, target.eye.z);
      const w = g + gw(target.eye.x, target.eye.z);
      target.eye.y = Math.max(target.eye.y, g + 1.9, w + 1.3);
      clearBuildings(target.eye);
    } catch (_) {}
    camera.position.set(target.eye.x, target.eye.y, target.eye.z);
    camera.lookAt(target.x, lookY, target.z);
  } else {
    /* centre-outward with a swing (quake's rule) — but the swing is CHOSEN,
       not typed: the authored angle is tried first and rotated round the
       subject until the eye→subject corridor is clear of towers and hills.
       Pass 3 of this preset parked the gutters shot nose-first in a wall. */
    let ox = target.x - A.cx, oz = target.z - A.cz;
    const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
    const back0 = cam.back != null ? cam.back : 18;
    const sw0 = cam.swing != null ? cam.swing : 0.55;
    let ex = 0, ez = 0, ey = 0, found = false;
    for (const back of [back0, back0 * 0.55]) {      // walled in at range? step in close
      for (const dsw of [0, 0.7, -0.7, 1.4, -1.4, 2.1, 2.8, 3.5]) {
        const sw = sw0 + dsw;
        const rx = ox * Math.cos(sw) - oz * Math.sin(sw);
        const rz = ox * Math.sin(sw) + oz * Math.cos(sw);
        ex = target.x + rx * back; ez = target.z + rz * back;
        ey = (target.y || 0) + (cam.up != null ? cam.up : 6) * (back / back0);
        try {
          const g = gnd(ex, ez);
          const w = g + gw(ex, ez);
          ey = Math.max(ey, g + 2.1, w + 1.3);
          const e = { x: ex, y: ey, z: ez };
          clearBuildings(e);
          ey = e.y;
        } catch (_) {}
        if (!corridorBlocked(ex, ey, ez, target.x, lookY + 0.6, target.z)) { found = true; break; }
      }
      if (found) break;
    }
    if (!found) ey += 16;                    // walled in everywhere: go high
    camera.position.set(ex, ey, ez);
    camera.lookAt(target.x, lookY, target.z);
  }
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(camera.position.x, 0, camera.position.z);
  }
  setHud(false);
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};

  const gwa = (typeof CBZ.groundWaterAudit === "function") ? CBZ.groundWaterAudit() : {};
  const wa = (typeof CBZ.weatherAudit === "function") ? CBZ.weatherAudit() : {};
  const ffa = (CBZ.flashflood && CBZ.flashflood.audit) ? CBZ.flashflood.audit() : {};
  const carsSwept = ((arena && arena.cars) || []).filter((c) => c.flung).length;

  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector(`[data-${n}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:212px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:380px";
  q("focus").textContent = `${CBZ.disasters.current() || "—"} · ${CBZ.disasters.state()} · ${note}`;
  q("focus").style.cssText = "position:absolute;top:250px;left:27px;color:#c0cfda;font-size:12px;font-weight:550;max-width:400px";
  q("perf").textContent =
    `water ${(gwa.stage || 0).toFixed(2)}m (peak ${(gwa.peak || 0).toFixed(2)}) · planes ${gwa.privateWaterPlanes || 0}\n` +
    `front ${gwa.front ? "s=" + gwa.front.s + " @" + gwa.front.speed + "m/s" : "—"} · mud ${(ffa.mud || 0).toFixed(2)}\n` +
    `churn ${ffa.churnAlive || 0} · debris ${ffa.debrisAfloat || 0} afloat / ${ffa.debrisStranded || 0} stranded\n` +
    `knockdowns ${wa.shinKnockdowns || 0} · cars swept ${carsSwept}\n` +
    `sim ${ticks} ticks · avg ${(ticks ? totalMs / ticks : 0).toFixed(1)}ms · worst ${maxMs.toFixed(0)}ms`;
  q("perf").style.cssText = `position:absolute;right:24px;top:24px;text-align:right;white-space:pre;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:${maxMs > 100 ? "#ff9c9c" : "#9fe8c3"}`;
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {
    privateWaterPlanes: Number(gwa.privateWaterPlanes || 0),
    waterOnGround: Number(gwa.stage || 0),
    waterPeak: Number(gwa.peak || 0),
    frontSpeed: gwa.front ? Number(gwa.front.speed) : 0,
    mudOpacity: Number(ffa.mud || 0),
    churnSpray: Number(ffa.churnAlive || 0),
    debrisAfloat: Number(ffa.debrisAfloat || 0),
    debrisStranded: Number(ffa.debrisStranded || 0),
    shinKnockdowns: Number(wa.shinKnockdowns || 0),
    carsSwept: carsSwept,
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    tickMaxMs: Number(maxMs.toFixed(1)),
    ticksOver33: over33,
    drawCalls: Number(render.calls || 0),
  };

  return { ok: true, disaster: CBZ.disasters.current(), state: CBZ.disasters.state(), note, metrics };
}

export default {
  id: "flashflood-stages",
  title: "The Flash Flood's Front",
  description: "One seeded survival match per build, the director forced to the flash flood and stepped through the same simulated seconds. Before (cfg_FLASHFLOOD_V2=0): the 2026-08-03 rain-fed flood — a correct shared depth field whose front is a faint 3.5 m whitening, whose water is clear blue you can see the road through, and whose arrival is silent. After: the front has a FACE — churn spray thrown off the crest (one Points buffer), entrained debris tumbling behind it (one InstancedMesh) that grounds in the streets when the drain drops the level, opaque mud instead of clear water, a crest-lifted waterline, downstream streaming you can see between paired frames, and a positional roar. Still zero private water planes: everything reads the same depth field.",
  beforeLabel: "BEFORE · FLASHFLOOD_V2=0",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  defaultBefore: "local",
  beforeParams: { cfg_FLASHFLOOD_V2: 0 },
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metricsNote: "Counts come from CBZ.groundWaterAudit(), CBZ.weatherAudit() and CBZ.flashflood.audit(), measured off live state at the moment of the frame. privateWaterPlanes is the honesty check: the front must be a term in the shared depth field plus non-surface FX, never a mesh — it must read 0 on BOTH sides. churnSpray/debrisEntrained 0 on a build means the front is still invisible. carsSwept counts arena cars the channel actually took (same threshold both sides).",
  metrics: {
    privateWaterPlanes: { label: "Private water planes", better: "lower" },
    waterOnGround: { label: "Standing water", unit: "m", better: "higher" },
    waterPeak: { label: "Peak water", unit: "m", better: "higher" },
    frontSpeed: { label: "Front speed", unit: "m/s", better: "higher" },
    mudOpacity: { label: "Mud opacity", better: "higher" },
    churnSpray: { label: "Churn spray live", better: "higher" },
    debrisAfloat: { label: "Debris the water carries", better: "higher" },
    debrisStranded: { label: "Debris stranded by drain", better: "higher" },
    // deliberately DIRECTIONLESS: before's sea surge drowned the whole island,
    // so it knocked down and floated MORE — of everything, everywhere. V2
    // confines the event to the rain and the channel (that is what a flash
    // flood is), so these fall. Printed as evidence, not scored.
    shinKnockdowns: { label: "Knockdowns in moving water" },
    carsSwept: { label: "Cars the water took" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageFlood,
};
