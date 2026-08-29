/* ONE LAW, PHOTOGRAPHED: all debris comes off something.

   OWNER, 2026-08-29: "I HATE FAKE DEBRIS ALL DEBRIS SHOULD COME OFF OF
   SOMETHING THINK OF VOXEL NOT THAT I WANT VOXEL BUT RPG DAMAGE AND DEBRIS
   SHOULD BE VOXEL ONLY NO FAKE DEBRIS IT MUST COME FROM SOMEWHERE."

   Both sides of this comparison open the SAME hole in the SAME wall with the
   SAME rocket. The only difference is where the rubble comes from:

     BEFORE  crashfx's point-and-count spawners. rubbleHeap() takes a position
             and a number and invents `14 + width*4 + power*6` lumps of a shared
             grey; facadeAvalanche() invents `7 + 5*power` more. Neither ever
             looked at the wall, so the pile is the same colour and the same
             size whatever it fell off, and the metric "debris invented from
             nothing" counts every one of them.

     AFTER   the carve dices the solids it is removing and throws the cells.
             Each fragment carries the SOURCE MESH'S OWN MATERIAL, starts at the
             sub-volume it occupied, and the volume of the pieces is the volume
             of the hole (conservation = 1.00). Nothing is minted.

   The two-building plate is the proof that survives argument: two shells with
   different wall colours, one rocket each. On the before side both piles are
   the same grey. On the after side each pile is the colour of the building it
   came off, because it is that building. */

const subjects = [
  { id: "in-flight", label: "0.4 s — what is in the air", focus: "Same rocket, same wall, same instant. BEFORE: a spray of shared dark-grey shards that exist only because a number said so. AFTER: cells of that wall, in that wall's colour, leaving the volume they occupied." },
  { id: "pile", label: "6 s — what is on the ground", focus: "Close on the base of the wound. BEFORE: invented lumps off a debris palette, in a pile whose size came from an arithmetic expression. AFTER: the material that left the facade, stacked where it fell, sized by how much of the building actually went." },
  { id: "wound", label: "The edge of the hole", focus: "BEFORE: a machined rectangle with a decorative jagged tooth laid over it. AFTER: the perimeter is diced too and the cells that survived are still welded to the shell — the edge is ragged because material is missing, not because something was drawn on top." },
  { id: "two-colours", label: "Two buildings, two rubbles", focus: "The proof. Two shells of clearly different wall colour, one rocket each. BEFORE: both piles are the same grey, because the palette is the same. AFTER: each pile is the colour of the building it came off." },
];

async function stageDebris(input) {
  const CBZ = window.CBZ, T = window.THREE;
  if (!CBZ || !T) return { ok: false, err: "missing CBZ/THREE" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const tick = () => {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    CBZ.stepSim(1 / 60);
    if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
  };
  const seconds = (s) => { const n = Math.max(1, Math.round(s * 60)); for (let i = 0; i < n; i++) tick(); };
  const DAY = 0.40;
  const daylight = () => { try { if (CBZ.dayPhase) CBZ.dayPhase(DAY); } catch (_) {} };
  const clean = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__debrisHud") continue;
      child.style.visibility = "hidden";
    }
    const cam = CBZ.camera;
    if (cam && cam.children) for (const c of cam.children) c.visible = false;
  };
  const groundAt = (x, z) => { try { return CBZ.floorAt ? +CBZ.floorAt(x, z) || 0 : 0; } catch (_) { return 0; } };
  const wet = (x, z) => { try { return !!(CBZ.cityWaterAt && CBZ.cityWaterAt(x, z)); } catch (_) { return false; } };
  const solidAt = (x, y, z, pad) => {
    const cols = CBZ.colliders || [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i]; if (!c) continue;
      const y0 = c.y0 == null ? -1e3 : c.y0, y1 = c.y1 == null ? 1e3 : c.y1;
      if (y < y0 - 0.6 || y > y1 + 0.6) continue;
      if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
    }
    return false;
  };
  const _ray = new T.Raycaster(), _o = new T.Vector3(), _d = new T.Vector3();
  const losClear = (from, to) => {
    const L = CBZ.losBlockers;
    if (!L || !L.length) return true;
    _d.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const d = _d.length(); if (d < 2) return true;
    _d.divideScalar(d);
    _ray.set(_o.set(from.x, from.y, from.z), _d);
    _ray.near = 0.5; _ray.far = d - 2.2;
    try { return _ray.intersectObjects(L, false).length === 0; } catch (_) { return true; }
  };
  const sees = (eye, w) => {
    const a = Math.min(13, w.width * 0.42);
    return losClear(eye, { x: w.x, y: w.y, z: w.z }) &&
      losClear(eye, { x: w.x + w.tx * a, y: w.y + 1, z: w.z + w.tz * a }) &&
      losClear(eye, { x: w.x - w.tx * a, y: w.y + 1, z: w.z - w.tz * a });
  };
  let indoors = () => false;                 // replaced once the shell list exists
  const eyeFor = (w, tries) => {
    const look = { x: w.x, y: w.y, z: w.z };
    for (const t of tries) {
      const eye = { x: w.x + w.nx * t[0] + w.tx * t[2], y: Math.max(2.2, w.y + t[1]), z: w.z + w.nz * t[0] + w.tz * t[2] };
      if (solidAt(eye.x, eye.y, eye.z, 1.4) || indoors(eye.x, eye.y, eye.z)) continue;
      if (!sees(eye, w)) continue;
      return { eye, look, fov: t[3] || 52 };
    }
    const t = tries[0];
    return { eye: { x: w.x + w.nx * t[0] + w.tx * t[2], y: Math.max(2.2, w.y + t[1]), z: w.z + w.nz * t[0] + w.tz * t[2] }, look, fov: t[3] || 52 };
  };

  let S = window.__debrisSeq;
  if (!S) {
    const booted = await until(() => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
      document.querySelector('.mode-btn[data-mode="city"]'), 420000);
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) {
      CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
      // A MATCHED PAIR MUST NOT READ LOCALSTORAGE. gangs.js restores a saved
      // turf board on the first city frame, which makes the shoot depend on
      // whatever this machine happened to play last — and its restore throws
      // (`[gangs] persist restore failed`) straight into the harness's
      // console-error watch, failing the first subject's capture every run.
      CBZ.CONFIG.GANG_PERSIST = false;
    }
    document.querySelector('.mode-btn[data-mode="city"]').click();
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 300000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(650);
    for (let i = 0; i < 260; i++) tick();
    daylight(); seconds(0.3);

    const A = CBZ.city && CBZ.city.arena;
    const shells = (A && A.root && A.root.userData && A.root.userData.shells) || [];
    const density = (x, z) => {
      let n = 0;
      for (const b of shells) if (b && Math.abs(b.ox - x) < 200 && Math.abs(b.oz - z) < 200) n++;
      return n;
    };
    // A TRIPOD INDOORS SEES A WINDOW. solidAt only asks "am I standing in a
    // collider" and the air inside a room is not one, so a camera could park in
    // an office and photograph a pane of glass — glass is not in losBlockers
    // either, so every visibility ray sailed straight through it. Ask the shell
    // registry instead: am I inside anybody's footprint, under their roof.
    const insideShell = (x, y, z) => {
      for (const b of shells) {
        if (!b || !(b.h > 0)) continue;
        if (y > b.h + 0.5) continue;
        if (Math.abs(x - b.ox) < b.w / 2 + 0.4 && Math.abs(z - b.oz) < b.d / 2 + 0.4) return true;
      }
      return false;
    };
    indoors = insideShell;
    const cands = [];
    for (const b of shells) {
      if (!b || b.boarded || !b.colliders || !b.colliders.length) continue;
      if (!(b.storeys >= 3) || b.w < 11 || b.d < 11) continue;
      if (!(b.h >= 12 && b.h <= 40)) continue;
      if (Math.hypot(b.ox, b.oz) > 900) continue;
      if (density(b.ox, b.oz) < 4) continue;
      const faces = [
        { nx: 1, nz: 0, x: b.ox + b.w / 2, z: b.oz, width: b.d },
        { nx: -1, nz: 0, x: b.ox - b.w / 2, z: b.oz, width: b.d },
        { nx: 0, nz: 1, x: b.ox, z: b.oz + b.d / 2, width: b.w },
        { nx: 0, nz: -1, x: b.ox, z: b.oz - b.d / 2, width: b.w },
      ];
      for (const f of faces) {
        // aim LOW: the pile is the subject, so the wound wants to be near the
        // deck where the material lands in the same frame as the hole.
        const y = Math.min(b.h - 1.6, b.FH * 1.15);
        const tx = -f.nz, tz = f.nx;
        const eye = { x: f.x + f.nx * 22 + tx * 8, y: Math.max(2.2, y + 1.2), z: f.z + f.nz * 22 + tz * 8 };
        if (wet(eye.x, eye.z)) continue;
        const ok = !solidAt(eye.x, eye.y, eye.z, 1.4) && !insideShell(eye.x, eye.y, eye.z) &&
          sees(eye, { x: f.x, y: y, z: f.z, tx, tz, width: f.width });
        cands.push({ b, f, y, tx, tz, ok, score: (ok ? 100 : 0) + Math.min(12, density(b.ox, b.oz)) * 3 });
      }
    }
    cands.sort((p, q) => (q.score - p.score) || (p.b.ox - q.b.ox) || (p.b.oz - q.b.oz));
    if (!cands.length) return { ok: false, err: "no candidate shells", shells: shells.length };
    const spec = (c) => ({ x: c.f.x, z: c.f.z, y: c.y, nx: c.f.nx, nz: c.f.nz, tx: c.tx, tz: c.tz,
      width: c.f.width, h: c.b.h, ox: c.b.ox, oz: c.b.oz,
      colour: Number(c.b.wallColor == null ? 0x777777 : c.b.wallColor) >>> 0 });
    const one = spec(cands[0]);
    // THE SECOND SHELL IS CHOSEN FOR ITS COLOUR. The whole claim of the last
    // plate is that rubble is the colour of what it came off, which only shows
    // if the two buildings are not already the same colour.
    const lum = (h) => (((h >> 16) & 255) * 0.3 + ((h >> 8) & 255) * 0.59 + (h & 255) * 0.11);
    let two = null, best = -1;
    for (const c of cands) {
      if (c.b === cands[0].b || !c.ok) continue;
      const s = spec(c);
      const d = Math.hypot(s.x - one.x, s.z - one.z);
      if (d < 40 || d > 190) continue;
      const sc = Math.abs(lum(s.colour) - lum(one.colour)) - Math.abs(d - 95) * 0.25;
      if (sc > best) { best = sc; two = s; }
    }
    if (!two) two = spec(cands[1] || cands[0]);

    const hud = document.createElement("div");
    hud.id = "__debrisHud";
    hud.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;color:#f6f9fb;text-shadow:0 2px 10px rgba(0,0,0,.85);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    hud.innerHTML = "<div data-side></div><div data-name></div><div data-state></div><div data-detail></div>";
    document.body.appendChild(hud);

    const cams = {
      inFlight: eyeFor(one, [[17, 2.5, 7, 55], [20, 3, 11, 54], [15, 2, -7, 58], [24, 4, -14, 52]]),
      pile: eyeFor({ x: one.x, y: 1.8, z: one.z, nx: one.nx, nz: one.nz, tx: one.tx, tz: one.tz, width: one.width },
        [[13, 1.6, 4, 52], [16, 2.2, 7, 52], [11, 1.2, -5, 56], [20, 3, -10, 50]]),
      wound: eyeFor(one, [[11, 0.6, 3, 54], [14, 1.0, 5, 54], [9, 0.4, -3, 58]]),
    };
    // the two-colour plate stands between the pair, looking at the midpoint
    // BOTH WOUNDS OR IT PROVES NOTHING. The tripod has to stand where it can see
    // the base of BOTH facades at once — a point above the roofs photographs two
    // roofs. Try a ring of standoffs on both flanks and take the first that has
    // a clear line to each pile.
    const mx = (one.x + two.x) / 2, mz = (one.z + two.z) / 2;
    const sep = Math.max(30, Math.hypot(two.x - one.x, two.z - one.z));
    const ux2 = (two.x - one.x) / sep, uz2 = (two.z - one.z) / sep;
    const px = -uz2, pz = uz2 * 0 + ux2;      // perpendicular to the pair
    const lowOne = { x: one.x, y: 2.2, z: one.z, tx: one.tx, tz: one.tz, width: one.width };
    const lowTwo = { x: two.x, y: 2.2, z: two.z, tx: two.tx, tz: two.tz, width: two.width };
    let twoEye = null;
    for (const s2 of [1, -1]) {
      for (const D of [0.75, 0.95, 1.2, 1.5]) {
        for (const H of [7, 11, 16]) {
          const e = { x: mx + px * sep * D * s2, y: H, z: mz + pz * sep * D * s2 };
          if (wet(e.x, e.z) || solidAt(e.x, e.y, e.z, 2) || insideShell(e.x, e.y, e.z)) continue;
          if (!losClear(e, lowOne) || !losClear(e, lowTwo)) continue;
          twoEye = e; break;
        }
        if (twoEye) break;
      }
      if (twoEye) break;
    }
    if (!twoEye) twoEye = { x: mx + px * sep * 0.95, y: 11, z: mz + pz * sep * 0.95 };
    cams.two = { eye: twoEye, look: { x: mx, y: 3.2, z: mz }, fov: 58 };

    S = window.__debrisSeq = { one, two, hud, cams, fired: false, firedTwo: false, t: 0 };
    window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
  }

  const pose = (c) => {
    const cam = CBZ.camera;
    cam.aspect = input.width / input.height; cam.fov = c.fov || 52; cam.near = 0.25; cam.far = 20000;
    cam.position.set(c.eye.x, c.eye.y, c.eye.z); cam.lookAt(c.look.x, c.look.y, c.look.z);
    cam.updateProjectionMatrix();
    if (CBZ.skySync) CBZ.skySync();
    CBZ.renderer.render(CBZ.scene, cam);
  };
  // Park the player on the building's own lot: land by construction, and never
  // over water (a submerged eye hands scene.fog to the underwater treatment and
  // every later frame comes back teal).
  const park = (w) => {
    if (!CBZ.player || !CBZ.player.pos) return;
    CBZ.player.pos.set(w.ox, groundAt(w.ox, w.oz) + 1.0, w.oz);
    if (CBZ.player.vel) CBZ.player.vel.set(0, 0, 0);
  };
  const rocket = (w) => {
    park(w);
    CBZ.detonate(w.x + w.nx * 0.1, w.y, w.z + w.nz * 0.1, "rpg", { byPlayer: true, dirx: -w.nx, dirz: -w.nz });
  };
  const advanceTo = (t) => { if (t > S.t) { seconds(t - S.t); S.t = t; } };

  const id = input.subject.id;
  daylight(); clean();

  if (!S.fired) { rocket(S.one); S.fired = true; S.t = 0; }
  if (id === "two-colours" && !S.firedTwo) { rocket(S.two); S.firedTwo = true; }

  let state = "";
  const on = !CBZ.CONFIG || CBZ.CONFIG.DEBRIS_CONSERVED_V1 !== false;
  if (id === "in-flight") { advanceTo(0.4); pose(S.cams.inFlight); state = on ? "cells of that wall, leaving the volume they occupied" : "a shared grey, spawned by a count"; }
  else if (id === "pile") { advanceTo(6); pose(S.cams.pile); state = on ? "the material that left the facade, where it fell" : "invented lumps off a debris palette"; }
  else if (id === "wound") { advanceTo(6); pose(S.cams.wound); state = on ? "ragged because material is missing" : "a machined rectangle with a tooth drawn on it"; }
  else { advanceTo(6); pose(S.cams.two); state = on ? "each pile is the colour of its own building" : "two buildings, one grey"; }

  daylight(); clean();
  const da = CBZ.cityDebrisAudit ? CBZ.cityDebrisAudit() : {};
  const fa = CBZ.cityFacadeBreachAudit ? CBZ.cityFacadeBreachAudit() : {};
  const before = input.side === "before";
  const q = (n) => S.hud.querySelector("[data-" + n + "]");
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = "position:absolute;top:20px;left:24px;padding:7px 12px;border-radius:7px;background:" +
    (before ? "#b0453e" : "#1f7d59") + ";font-size:12px;font-weight:900;letter-spacing:.13em";
  q("name").textContent = input.subject.label;
  q("name").style.cssText = "position:absolute;left:25px;bottom:74px;font-size:23px;font-weight:850";
  q("state").textContent = state;
  q("state").style.cssText = "position:absolute;left:26px;bottom:50px;color:#dfeaf1;font-size:12.5px;font-weight:650";
  q("detail").textContent =
    "shed " + (da.shedPieces || 0) + " · invented " + (da.inventedPieces || 0) +
    " · removed " + (da.removedVolume || 0) + " m³ · conservation x" + (da.conservation || 0) +
    " · rim kept " + (da.keptRimCells || 0) + " · facade " + (fa.openArea || 0) + " m² open";
  q("detail").style.cssText = "position:absolute;left:26px;bottom:27px;color:#a4bac8;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return { ok: true, state, debug: { da, one: S.one, two: S.two },
    metrics: {
      debrisInvented: Number(da.inventedPieces || 0),
      debrisShed: Number(da.shedPieces || 0),
      sourcedShare: da.liveDebris ? +(da.sourcedDebris / da.liveDebris).toFixed(3) : 0,
      conservation: Number(da.conservation || 0),
      removedVolume: Number(da.removedVolume || 0),
      rimCellsKept: Number(da.keptRimCells || 0),
    } };
}

export default {
  id: "debris-conserved",
  title: "All Debris Comes Off Something",
  description: "Same rocket, same wall, same hole on both sides — only the source of the rubble changes. BEFORE runs crashfx's point-and-count spawners, which invent a pile of shared grey from an arithmetic expression. AFTER dices the solids the carve is actually removing and throws the cells, each carrying its own wall's material, with the volume of the pieces equal to the volume of the hole.",
  beforeLabel: "BEFORE · INVENTED DEBRIS",
  afterLabel: "AFTER · CUT FROM THE BUILDING",
  pairNote: "Same seed, same buildings, same rocket, same cameras, same simulated second; only DEBRIS_CONSERVED_V1 changes",
  defaultBefore: "local",
  beforeParams: { cfg_DEBRIS_CONSERVED_V1: 0 },
  afterParams: { cfg_DEBRIS_CONSERVED_V1: 1 },
  urlParams: { seed: 90210 },
  viewport: { width: 1200, height: 740 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  stageTimeoutMs: 900000,
  metricsNote: "Read live from CBZ.cityDebrisAudit(). 'Invented' counts pieces minted by rubbleHeap/facadeAvalanche, which take a position and a number and never look at the wall — it must be zero on the conserved path. 'Conservation' is the volume of shed fragments over the volume of solid the carve actually removed; 1.00 means every cubic metre that left the building is on the ground, and nothing else is.",
  metrics: {
    debrisInvented: { label: "Debris invented from nothing", better: "lower" },
    debrisShed: { label: "Debris cut from removed material", better: "higher" },
    sourcedShare: { label: "Share of live debris with a source", unit: "0..1", better: "higher" },
    conservation: { label: "Shed volume / removed volume", unit: "x", better: "higher" },
    removedVolume: { label: "Solid actually removed", unit: "m³", better: "higher" },
    rimCellsKept: { label: "Rim cells that survived (the ragged edge)", better: "higher" },
  },
  subjects,
  stage: stageDebris,
};
