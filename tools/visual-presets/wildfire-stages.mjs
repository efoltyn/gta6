/* THE WILDFIRE storyboard for tools/visual-compare.mjs.

   Skeleton lifted from quake-stages.mjs (same boot, same rAF freeze, same
   CBZ.stepSim clock), narrowed to the wildfire and staged along its real
   timeline so every mechanism of the rebuilt fire gets its own frame:

     ignition       the warn-phase telegraph: ONE tree torching and its smoke
                    column standing up and bending downwind.
     front          the running head fire: black behind, flame line in the
                    middle, drying green ahead. Shot down the wind so the
                    burn's DIRECTION is the picture.
     smoke-first    from 35 m downwind of the flames at head height — the
                    place a person fleeing downwind would be. Before: clear
                    air with a distant camp-fire. After: the plume got here
                    first.
     spotting       the ember-started fire AHEAD of the front, detached from
                    the main burn — the mechanism that makes "outrun it
                    downwind" a fatal plan.
     escape         the crowd's decision, from above with the wind annotated:
                    crosswind flankers (after) versus radial scatter (before).
     caught         a person deep in the plume corridor.
     scar-air /     after the event ends: what a fire LEAVES. Blackened
     scar-ground    ground along the run, charred consumed crowns, the green
                    crosswind edge. On the before build the ground scorch was
                    literally deleted at burnout, so its aftermath is green.

   FLAG A/B, same checkout: before = ?cfg_WILDFIRE_V2=0 (the exact legacy
   fire, kept verbatim in systems/disasters.js), after = the default.

   CAMERAS ARE SOLVED, NOT TYPED (quake-stages' law): every beat asks the
   LIVE world — the actual burning trees, the actual weather wind, the actual
   actors — and frames that. Both builds answer the same questions (tree
   records and CBZ.weatherWind exist on both paths), so each side is
   photographed on its own truth. */

const subjects = [
  { id: "ignition", label: "Ignition — the smoke column stands up",
    focus: "Warn phase. One tree is torching and its smoke is a COLUMN standing over it, bending downwind — the telegraph that replaced the banner. Before: three additive cones and no column (the 'smoke' is a particle cloud that follows the camera, so it is wherever you are, i.e. nowhere).",
    act: { force: "wildfire", untilState: "warn", extraSecs: 3.6 },
    cam: { aim: "seed", back: 17, up: 4, look: 9 } },

  { id: "front", requireFire: true, label: "The head fire runs",
    focus: "Shot down the wind from behind the burn: consumed black behind, the flame line mid-frame, green (drying to ochre where the front's heat is already on it) ahead. The fire is a travelling wave with a direction, not a scatter of camp-fires.",
    act: { atSecs: 5 },
    cam: { aim: "front", back: 34, up: 16, look: 3 } },

  { id: "smoke-first", requireFire: true, label: "The smoke arrives first",
    focus: "The camera stands 35 m DOWNWIND of the flames at head height — exactly where someone fleeing straight downwind would be. After: the surface smoke has already overtaken this spot and the world is closing in; the flames are a glow behind the murk. Before: clear air, green trees, a distant fire you could stroll away from.",
    act: { atSecs: 7.5 },
    cam: { aim: "downwind", dist: 35, up: 1.8, look: 5 } },

  { id: "spotting", requireFire: true, label: "Spotting — fire ahead of the front",
    focus: "An ember lofted over the head fire has started a NEW fire out ahead of the main burn. This is why a head start does not save you downwind: the fire is already in front of you. Before build: spotting does not exist, so the most advanced fire is always attached to the pack.",
    act: { atSecs: 10 },
    cam: { aim: "spot", back: 20, up: 6, look: 4 } },

  { id: "escape", requireFire: true, label: "The escape decision",
    focus: "From above, looking straight down with the wind blowing toward the top of frame. After: the crowd is flanking OUT of the smoke corridor — across the wind — because threat() sees the plume and safeDir answers crosswind. Before: radial scatter, which for everyone downwind means racing the head fire and losing.",
    act: { atSecs: 12 },
    cam: { aim: "crowd", up: 62 } },

  { id: "caught", requireFire: true, label: "Caught in the smoke",
    focus: "A person deep in the plume corridor. The choke damage that is killing them is the event's real killer — most wildfire deaths are smoke, not flame, and it carries its own killfeed cause ('suffocated in the wildfire smoke'). Before: smoke is cosmetic; standing here costs nothing until a flame touches you.",
    act: { atSecs: 14 },
    cam: { aim: "victim", back: 9, up: 2.6, look: 1.2 } },

  { id: "scar-air", requireFire: true, label: "The burn scar, from the air",
    focus: "The event is over. After: a black scar runs downwind across the island — charred ground under every burnt tree and every ember strike, consumed crowns, a green crosswind edge. Before: burnOut() deleted each ground scorch as it happened and end() disposed the rest, so the aftermath of a wildfire is a green island with some black boxes.",
    act: { atSecs: 17.4, thenSecs: 5 },
    cam: { aim: "scar", up: 72 } },

  { id: "scar-ground", requireFire: true, label: "What is left standing",
    focus: "Ground level, looking along the run: black ground, charred trunks with their canopies burned down to skeletons, thinning smoke. A burnt tree stays burnt and the ground stays black — the scar is the proof the fire was real.",
    act: { atSecs: 17.4, thenSecs: 5, extraSecs: 0.6 },
    cam: { aim: "scarline", back: 26, up: 3.2, look: 2.5 } },
];

async function stageFire(input) {
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
      if (child.id === "__fireOverlay") continue;
      child.style.visibility = visible ? "" : "hidden";
    }
  };

  let S = window.__fireSeq;
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
    overlay.id = "__fireOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__fireSeq = { overlay, cam: null, t0: null, origin: null };
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
      // pin the fire's ORIGIN the first frame anything burns — every later
      // "how far did it run" measurement is relative to this, on both builds
      if (!S.origin) {
        const tr = (CBZ.surv && CBZ.surv.arena && CBZ.surv.arena.flammable) || [];
        for (const t of tr) if (t.burning > 0) { S.origin = { x: t.x, z: t.z }; break; }
      }
    }
  };
  const stepUntilState = (want, budget) => {
    let guard = Math.round((budget || 30) * 10);
    while (guard-- > 0 && CBZ.disasters.state() !== want) step(0.1);
  };

  /* ORDER-INDEPENDENCE (quake-stages' rule): a --subjects subset must land on
     the same absolute sim-second, so any beat needing the fire re-forces it
     and seeks by the event's own clock. */
  const armFire = () => {
    CBZ.disasters.force("wildfire"); step(0.1);
    stepUntilState("active", 40);
    S.t0 = CBZ.disasters.timeLeft();
  };
  // "the fire already happened" counts as having the fire: the aftermath
  // beats must NOT re-arm a second wildfire over the first one's scar
  const fireHappened = () =>
    (((CBZ.surv && CBZ.surv.arena && CBZ.surv.arena.flammable) || []).some((t) => t.burnt || t.burning > 0));
  if (subject.requireFire && CBZ.disasters.current() !== "WILDFIRE" && !fireHappened() && !act.force) armFire();
  if (act.force) {
    CBZ.disasters.force(act.force); step(0.1);
    if (act.force === "wildfire") { S.t0 = null; S.origin = null; }
  }
  if (act.untilState) stepUntilState(act.untilState, 40);
  if (act.atSecs != null && CBZ.disasters.current() === "WILDFIRE") {
    if (CBZ.disasters.state() !== "active") stepUntilState("active", 40);
    if (S.t0 == null) S.t0 = CBZ.disasters.timeLeft();
    let guard = 900;
    while (guard-- > 0 && CBZ.disasters.state() === "active" &&
           CBZ.disasters.current() === "WILDFIRE" &&
           (S.t0 - CBZ.disasters.timeLeft()) < act.atSecs) step(0.1);
  }
  if (act.extraSecs) step(act.extraSecs);
  // thenSecs = "and let the event finish": only meaningful while the fire is
  // still the current disaster (in a sequenced run the aftermath beats find
  // it already over and must not walk into the NEXT disaster's warn)
  if (act.thenSecs && CBZ.disasters.current() === "WILDFIRE") step(act.thenSecs);

  // ---- read the LIVE world once ------------------------------------------
  const A = (CBZ.surv && CBZ.surv.arena) || { center: { x: 0, z: 600 }, radius: 120 };
  const C = A.center || { x: 0, z: 600 };
  const trees = A.flammable || [];
  const burning = trees.filter((t) => t.burning > 0);
  const burnt = trees.filter((t) => t.burnt);
  const touched = burning.concat(burnt);
  // THE WIND — the weather's, which both builds drive with the fire's bearing
  let w = { x: 1, z: 0 };
  try {
    const ww = CBZ.weatherWind ? CBZ.weatherWind() : null;
    if (ww && (ww.x || ww.z)) { const m = Math.hypot(ww.x, ww.z) || 1; w = { x: ww.x / m, z: ww.z / m }; }
  } catch (_) {}
  const centroid = (list) => {
    if (!list.length) return null;
    let x = 0, z = 0;
    for (const t of list) { x += t.x; z += t.z; }
    return { x: x / list.length, z: z / list.length };
  };
  const fireC = centroid(burning) || centroid(touched) || C;
  const gy = (x, z) => { try { return A.groundHeightAt ? A.groundHeightAt(x, z) : 0; } catch (_) { return 0; } };

  // ---- solve the camera off it -------------------------------------------
  const cam = subject.cam || {};
  let eye = null, look = null, note = "";
  const perp = { x: -w.z, z: w.x };

  /* THE EYE MUST NOT STAND IN A HILL OR A TOWER (quake-stages' hard-won law;
     the first pass of THIS preset photographed the inside of the arena
     mountain on one side and the back of a facade on the other). Given a
     subject and a preferred bearing, try azimuths fanning out from it and
     take the first eye with an unblocked line to the subject — checked
     against the arena's building footprints AND the terrain height along
     the ray. If every azimuth is blocked, go up: altitude always sees. */
  const buildings = (A.fragile || []).filter((b) => !b.fallen);
  // occlusion is answered by the SCENE, not by a list: the arena has civic
  // buildings (the hotel, the showroom, the gas station) that exist in no
  // record this preset can read, and pass 4 of this storyboard hid the fire
  // behind one of them. A raycast sees everything that renders.
  const rc = new T.Raycaster();
  if (rc.params) rc.params.Points = { threshold: 0 };
  const losBlocked = (ex, ey, ez, tx, ty, tz, pad) => {
    const m = pad == null ? 1.5 : pad;
    for (const b of buildings) {
      if (Math.abs(ex - b.x) < b.w / 2 + m && Math.abs(ez - b.z) < b.d / 2 + m) return true;  // inside/against one
    }
    for (let u = 0.06; u <= 0.9; u += 0.12) {
      const px = ex + (tx - ex) * u, pz = ez + (tz - ez) * u, py = ey + (ty - ey) * u;
      if (gy(px, pz) + 1.2 > py) return true;                       // terrain in the way
    }
    try {
      const dir = new T.Vector3(tx - ex, ty - ey, tz - ez);
      const len = dir.length(); dir.normalize();
      rc.set(new T.Vector3(ex, ey, ez), dir);
      rc.near = 0; rc.far = Math.max(0, len - 3);
      const hits = rc.intersectObjects((A.root && A.root.children) || [], true);
      for (const h of hits) {
        const o = h.object;
        if (o.isPoints) continue;                                  // smoke/embers never block a shot
        let skip = false;
        for (let p2 = o; p2; p2 = p2.parent) { if (p2.userData && p2.userData.transient) { skip = true; break; } }
        if (skip) continue;
        return true;
      }
    } catch (_) {}
    return false;
  };
  const solveEye = (t, prefX, prefZ, dist, up, lookY) => {
    const base = Math.atan2(prefZ, prefX);
    const ty = gy(t.x, t.z) + lookY;
    const fan = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4, Math.PI];
    // two passes: first demand real CLEARANCE around the eye (a legal shot
    // half-filled by the wall you are standing beside is still a bad shot),
    // then relax to merely not-inside if the strict pass finds nothing
    for (const clearance of [6, 1.5]) {
      for (const da of fan) {
        const ex = t.x + Math.cos(base + da) * dist, ez = t.z + Math.sin(base + da) * dist;
        const ey = Math.max(gy(ex, ez) + 1.7, gy(t.x, t.z) + up);
        if (!losBlocked(ex, ey, ez, t.x, ty, t.z, clearance)) return { x: ex, y: ey, z: ez, az: da };
      }
    }
    const ex = t.x + prefX * dist, ez = t.z + prefZ * dist;         // all blocked: go up
    return { x: ex, y: gy(t.x, t.z) + up + 24, z: ez, az: 0 };
  };
  if (cam.aim === "seed") {
    const s = burning[0] || touched[0];
    if (s) {
      // crosswind stance: the column bends downwind ACROSS the frame
      eye = solveEye(s, perp.x, perp.z, cam.back || 22, cam.up || 6, cam.look || 7);
      look = { x: s.x, y: gy(s.x, s.z) + (cam.look || 7), z: s.z };
      note = "seed tree, crosswind stance" + (eye.az ? " (swung clear)" : "");
    }
  } else if (cam.aim === "front") {
    // the burn's most advanced point, shot DOWN the wind from behind the black
    let head = null, hd = -1e9;
    for (const t of touched) { const d = (t.x - fireC.x) * w.x + (t.z - fireC.z) * w.z; if (d > hd) { hd = d; head = t; } }
    const a = head || { x: fireC.x, z: fireC.z };
    eye = solveEye(a, -w.x, -w.z, cam.back || 34, cam.up || 16, cam.look || 3);
    look = { x: a.x + w.x * 8, y: gy(a.x, a.z) + (cam.look || 3), z: a.z + w.z * 8 };
    note = "head fire, " + burning.length + " torching / " + burnt.length + " burnt";
  } else if (cam.aim === "downwind") {
    // the eye's POSITION is the subject here — where a runner fleeing straight
    // downwind of the HEAD FIRE would be standing — so keep the distance
    // semantic and only slide crosswind if it lands inside a building
    let head = null, hd = -1e9;
    for (const t of burning) { const dd = (t.x - fireC.x) * w.x + (t.z - fireC.z) * w.z; if (dd > hd) { hd = dd; head = t; } }
    const H = head || fireC;
    const d = cam.dist || 35;
    const ty2 = gy(H.x, H.z) + (cam.look || 5);
    outer:
    for (const lift of [0, 3, 7, 13, 22]) {          // a runner tops the rise before seeing it
      for (const side of [0, 4, -4, 9, -9, 15, -15]) {
        const ex = H.x + w.x * d + perp.x * side, ez = H.z + w.z * d + perp.z * side;
        const ey = gy(ex, ez) + (cam.up || 1.8) + lift;
        if (losBlocked(ex, ey, ez, H.x, ty2, H.z, 1.5)) continue;
        eye = { x: ex, y: ey, z: ez };
        if (lift || side) note = " (lifted " + lift + " m, slid " + side + " m)";
        break outer;
      }
    }
    if (!eye) eye = { x: H.x + w.x * d, y: gy(H.x + w.x * d, H.z + w.z * d) + 24, z: H.z + w.z * d };
    look = { x: H.x, y: ty2, z: H.z };
    note = d + " m downwind of the head fire, head height" + (note || "");
  } else if (cam.aim === "spot") {
    // the burning/burnt tree most DETACHED downwind of the pack = a spot fire
    let best = null, bs = -1e9;
    for (const t of touched) {
      const down = (t.x - fireC.x) * w.x + (t.z - fireC.z) * w.z;
      let nearest = 1e9;
      for (const o of touched) { if (o === t) continue; const dd = Math.hypot(o.x - t.x, o.z - t.z); if (dd < nearest) nearest = dd; }
      const score = down + Math.min(nearest, 40) * 1.5;
      if (score > bs) { bs = score; best = t; }
    }
    const a = best || fireC;
    let nearest = 1e9;
    for (const o of touched) { if (o === best) continue; const dd = Math.hypot(o.x - a.x, o.z - a.z); if (dd < nearest) nearest = dd; }
    eye = solveEye(a, perp.x - w.x * 0.3, perp.z - w.z * 0.3, cam.back || 20, cam.up || 6, cam.look || 4);
    look = { x: a.x, y: gy(a.x, a.z) + (cam.look || 4), z: a.z };
    note = "most advanced fire, " + (nearest === 1e9 ? "alone" : Math.round(nearest) + " m from its nearest neighbour");
  } else if (cam.aim === "crowd") {
    const bots = (CBZ.bots || []).filter((b) => b && !b.dead && Math.hypot(b.pos.x - fireC.x, b.pos.z - fireC.z) < 80);
    let bx = fireC.x, bz = fireC.z;
    if (bots.length) { bx = 0; bz = 0; for (const b of bots) { bx += b.pos.x; bz += b.pos.z; } bx /= bots.length; bz /= bots.length; }
    const cx2 = (bx + fireC.x) / 2, cz2 = (bz + fireC.z) / 2;
    eye = { x: cx2, y: gy(cx2, cz2) + (cam.up || 62), z: cz2 };
    look = { x: cx2 + w.x * 0.01, y: 0, z: cz2 + w.z * 0.01 };   // straight down, wind up-frame
    note = bots.length + " people near the fire, top-down, wind toward frame top";
  } else if (cam.aim === "victim") {
    // the person the smoke is ACTUALLY working on: score by live exposure
    // where the field exists (after build), by corridor geometry where it
    // does not (before build) — each side photographs its own truth
    const everyone = [];
    (CBZ.bots || []).forEach((b) => { if (b && b.pos) everyone.push(b); });
    const exposure = (p) => {
      try { if (CBZ.wildfire && CBZ.wildfire.smokeAt) return CBZ.wildfire.smokeAt(p.x, p.z) * 40; } catch (_) {}
      return 0;
    };
    let best = null, bs = -1e9;
    for (const b of everyone) {
      const down = (b.pos.x - fireC.x) * w.x + (b.pos.z - fireC.z) * w.z;
      const cross = Math.abs((b.pos.z - fireC.z) * w.x - (b.pos.x - fireC.x) * w.z);
      const geom = (down > 2 && down < 70) ? down - cross * 2 : -50;
      const score = (b.dead ? 25 : 0) + exposure(b.pos) + geom;
      if (score > bs) { bs = score; best = b; }
    }
    const a = best ? best.pos : { x: fireC.x + w.x * 25, z: fireC.z + w.z * 25 };
    // shoot ALONG the wind axis, from downwind of the victim looking back
    // toward the fire: the corridor's puffs stack up in depth exactly the
    // way the smoke reads to a person standing inside it (a crosswind
    // camera spreads the same puffs thin and photographs clear air)
    eye = solveEye(a, w.x + perp.x * 0.25, w.z + perp.z * 0.25, cam.back || 13, cam.up || 2.8, cam.look || 2.4);
    look = { x: a.x - w.x * 4, y: gy(a.x, a.z) + (cam.look || 2.4), z: a.z - w.z * 4 };
    const sNow = best ? exposure(best.pos) / 40 : 0;
    let dbg = "";
    try { if (best && CBZ.wildfire && CBZ.wildfire.puffStats) { const ps = CBZ.wildfire.puffStats(best.pos.x, best.pos.z); dbg = " · " + ps.near + " puffs around them"; } } catch (_) {}
    note = (best ? ((best.dead ? "a body" : "a person") + " in the plume corridor") : "corridor probe (nobody in it)") +
      (sNow ? " · smoke " + sNow.toFixed(2) : "") + dbg;
  } else if (cam.aim === "scar") {
    const c = centroid(burnt) || fireC;
    eye = { x: c.x, y: gy(c.x, c.z) + (cam.up || 72), z: c.z };
    look = { x: c.x + w.x * 0.01, y: 0, z: c.z + w.z * 0.01 };
    note = burnt.length + " charred trees, top-down, wind toward frame top";
  } else if (cam.aim === "scarline") {
    // stand INSIDE the black at the upwind tail and look down the run's
    // whole length: charred ground in the foreground, skeleton trunks
    // crossing the frame, the green crosswind edge at the sides
    const c = centroid(burnt) || fireC;
    let tail = null, td = 1e9, head2 = null, hd2 = -1e9;
    for (const t of burnt) {
      const d = (t.x - c.x) * w.x + (t.z - c.z) * w.z;
      if (d < td) { td = d; tail = t; }
      if (d > hd2) { hd2 = d; head2 = t; }
    }
    const a = tail || c, hh = head2 || c;
    for (const lift of [0, 4, 9, 16]) {
      const ex = a.x - w.x * 10 + perp.x * 4, ez = a.z - w.z * 10 + perp.z * 4;
      const ey = gy(ex, ez) + (cam.up || 3.2) + lift;
      if (lift === 16 || !losBlocked(ex, ey, ez, hh.x, gy(hh.x, hh.z) + 2.5, hh.z, 1)) { eye = { x: ex, y: ey, z: ez }; break; }
    }
    look = { x: hh.x, y: gy(hh.x, hh.z) + (cam.look || 2.5), z: hh.z };
    note = "down the run: " + burnt.length + " charred trees, tail to head";
  }
  if (!eye) {
    eye = { x: C.x, y: 40, z: C.z + 60 };
    look = { x: C.x, y: 0, z: C.z };
    note = note || "fallback (no fire found)";
  }
  // never stand inside the ground
  try { const g = gy(eye.x, eye.z); if (eye.y < g + 1.6) eye.y = g + 1.6; } catch (_) {}

  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55; camera.near = 0.4; camera.far = 20000;
  camera.position.set(eye.x, eye.y, eye.z);
  camera.lookAt(look.x, look.y, look.z);
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

  // ---- measure off live state --------------------------------------------
  const wa = (typeof CBZ.wildfireAudit === "function") ? CBZ.wildfireAudit() : {};
  let fireRunM = 0;
  if (S.origin) for (const t of touched) {
    const d = Math.hypot(t.x - S.origin.x, t.z - S.origin.z);
    if (d > fireRunM) fireRunM = d;
  }
  const deadBots = (CBZ.bots || []).filter((b) => b && b.dead).length;

  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector(`[data-${n}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:212px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:360px";
  q("focus").textContent =
    `${CBZ.disasters.current() || "—"} · ${CBZ.disasters.state()} · ${note}` +
    (wa.v2 === false ? " · LEGACY FIRE" : "");
  q("focus").style.cssText = "position:absolute;top:250px;left:27px;color:#c0cfda;font-size:12px;font-weight:550;max-width:380px";
  q("perf").textContent =
    `burning ${burning.length} · burnt ${burnt.length} · run ${Math.round(fireRunM)} m\n` +
    `spots ${wa.spotFires || 0} (max ${wa.spotMaxM || 0} m) · scar ${wa.scarM2 || 0} m²\n` +
    `smoke deaths ${wa.smokeDeaths || 0} · flame deaths ${wa.flameDeaths || 0} · dead ${deadBots}\n` +
    `sim ${ticks} ticks · avg ${(ticks ? totalMs / ticks : 0).toFixed(1)}ms · worst ${maxMs.toFixed(0)}ms`;
  q("perf").style.cssText = `position:absolute;right:24px;top:24px;text-align:right;white-space:pre;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:${maxMs > 100 ? "#ff9c9c" : "#9fe8c3"}`;
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  const metrics = {
    treesBurnt: burnt.length,
    fireRunM: Math.round(fireRunM),
    spotFires: Number(wa.spotFires || 0),
    spotMaxM: Number(wa.spotMaxM || 0),
    smokeDamage: Number(wa.smokeDamage || 0),
    smokeDeaths: Number(wa.smokeDeaths || 0),
    deaths: deadBots,
    escapeAngleDeg: wa.escapeAngleDeg == null ? null : Number(wa.escapeAngleDeg),
    scarM2: Number(wa.scarM2 || 0),
    smokeAheadM: Number(wa.plumeLenM || 0),
    tickAvgMs: ticks ? Number((totalMs / ticks).toFixed(2)) : 0,
    tickMaxMs: Number(maxMs.toFixed(1)),
    ticksOver33: over33,
    drawCalls: Number(render.calls || 0),
  };

  return { ok: true, disaster: CBZ.disasters.current(), state: CBZ.disasters.state(), note, metrics };
}

export default {
  id: "wildfire-stages",
  title: "The Wildfire",
  description: "One seeded survival match per build, the director forced to the wildfire and stepped through the same simulated seconds. Before (?cfg_WILDFIRE_V2=0): camera-following ember specks, 13 m coin-flip spread, smoke that hurts nobody, scorch marks deleted at burnout, and 'safety' straight downwind. After: a wind/slope spread wave with a torching head fire, a smoke plume that runs ahead of the front and does the killing, ember spotting that starts fires past anyone fleeing downwind, a persistent black burn scar, and crosswind escape advice for the crowd. Every camera is solved off live world state — the actual burning trees, the actual wind, the actual people.",
  beforeLabel: "BEFORE · V2 OFF",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  defaultBefore: "local",
  beforeParams: { cfg_WILDFIRE_V2: 0 },
  stageTimeoutMs: 480000,
  metricsNote: "Counts come from CBZ.wildfireAudit() (live-measured on both paths; the legacy fire mutates the same tree records) plus the stage's own reads of the arena and the bots. fireRunM is the farthest burnt tree from where the fire started. escapeAngleDeg is the angle between the bots' flee vector 28 m downwind of the fire and the wind — 90° is the crosswind lesson, 0° is 'run straight downwind'. scarM2 is charred ground that persists after the event; the legacy path deletes its scorch at burnout so it reads 0.",
  metrics: {
    treesBurnt: { label: "Trees consumed", better: "higher" },
    fireRunM: { label: "Fire run from origin", unit: "m", better: "higher" },
    spotFires: { label: "Spot fires (embers)", better: "higher" },
    spotMaxM: { label: "Longest spot jump", unit: "m", better: "higher" },
    smokeDamage: { label: "Choke damage dealt", unit: "hp", better: "higher" },
    smokeDeaths: { label: "Deaths by smoke", better: "higher" },
    deaths: { label: "Deaths (all causes)", better: "higher" },
    escapeAngleDeg: { label: "Escape angle vs wind", unit: "°", better: "higher" },
    scarM2: { label: "Ground left black", unit: "m²", better: "higher" },
    smokeAheadM: { label: "Plume reach ahead", unit: "m", better: "higher" },
    tickAvgMs: { label: "Sim tick avg", unit: "ms", better: "lower" },
    tickMaxMs: { label: "Sim tick worst", unit: "ms", better: "lower" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageFire,
};
