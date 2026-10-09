/* tools/probes/president-people.mjs — EVERY PERSON IN THE PRESIDENT'S HOUSE HAS A BODY.

   OWNER (2026-09-30): "PRESIDENT'S GAME HAS INVISIBLE PEOPLE."

   They were there for collisions, for [E], for the line over their head, and
   nothing was drawn. This check boots the real President run (title card,
   seed 260811), sits the player at the Resolute desk, lets the office live
   (the detail comes on shift, the secretary posts, the line forms, an aide
   walks in), then walks him through the West Wing and the Mansion, and at
   every stop counts:

     IN SIM   every living person in CBZ.cityPeds / CBZ.cityCops within 40 m
              of the player and on his storey (+/- 3 m): the people he can
              bump into, talk to, be shot by;
     DRAWN    of those, the ones the renderer actually puts on screen: the rig
              root is in the scene, it and every ancestor is visible, and its
              torso either draws itself (default layer, non-zero world scale)
              or is carried by a live instance in entities/pedinstance.js
              (CBZ.pedInstanceDraws === true on a rig that is not parked).

   Every invisible body is named with its reason (spawnHidden: the shared
   spawn-reveal gate never let it be seen; ancestor hidden; parked rig; zero
   scale; detached).

   EXIT 0 only when DRAWN == IN SIM at every stop.

     testbus:  node tools/testbus/submit.mjs --probe tools/probes/president-people.mjs
     alone:    node tools/president-people-check.mjs [--seed N] [-v]
   Sim only (?cfg_RENDER_FRAMES=0): the camera's matrices are refreshed by
   hand after every step, exactly as renderer.render would. */
export const meta = { world: "president", seed: 260811, fresh: true, dirties: false, timeoutMs: 20 * 60e3 };

export default async function (t) {
  const VERBOSE = t.flag("-v");
  // the stepper and the census, installed once in the page
  await t.evl(`(function(){
    window.__pp = {};
    __pp.step = function (n) {
      for (var k = 0; k < n; k++) {
        CBZ.stepSim(1 / 60);
        var c = CBZ.camera;
        if (c) { c.updateMatrixWorld(true); if (c.matrixWorldInverse) c.matrixWorldInverse.copy(c.matrixWorld).invert(); }
      }
      return true;
    };
    function inScene(o) { var h = 0; while (o && h++ < 80) { if (o === CBZ.scene) return true; o = o.parent; } return false; }
    function chainVis(o) { var h = 0; while (o && h++ < 80) { if (o.visible === false) return false; o = o.parent; } return true; }
    var V = new THREE.Vector3();
    function torsoDraws(g) {
      var best = null;
      g.traverse(function (m) {
        if (best === true || !m.isMesh) return;
        if (!chainVis(m)) return;
        var ours = CBZ.pedInstanceDraws ? CBZ.pedInstanceDraws(m) : null;
        if (ours === true) { best = true; return; }
        if (ours === false) { if (best == null) best = false; return; }
        if (!(m.layers && (m.layers.mask & 1))) return;
        m.updateWorldMatrix(true, false);
        V.setFromMatrixScale(m.matrixWorld);
        if (V.x * V.y * V.z > 1e-9) best = true; else if (best == null) best = false;
      });
      return best === true;
    }
    __pp.census = function (R, DY) {
      var P = CBZ.player, out = { inSim: 0, drawn: 0, hidden: [] };
      if (!P || !P.pos) return out;
      var lists = [CBZ.cityPeds || [], CBZ.cityCops || []];
      for (var L = 0; L < lists.length; L++) for (var i = 0; i < lists[L].length; i++) {
        var p = lists[L][i];
        if (!p || p.dead || p.culled || p._parked || p.isPlayer || !p.group || !p.pos) continue;
        if (p.inCar || p._mcHidden) continue;                     // riding inside a car: the car is what you see
        var dx = p.pos.x - P.pos.x, dz = p.pos.z - P.pos.z, dy = (p.pos.y || 0) - (P.pos.y || 0);
        if (dx * dx + dz * dz > R * R || Math.abs(dy) > DY) continue;
        out.inSim++;
        var g = p.group, why = null;
        if (!inScene(g)) why = "detached";
        else if (p._spawnHidden) why = "spawnHidden";
        else if (!chainVis(g)) why = g.visible === false ? "group.visible=false" : "ancestor hidden";
        else if (!torsoDraws(g)) why = "no drawn part (parked / zero scale)";
        if (!why) { out.drawn++; continue; }
        out.hidden.push({ who: (p.job || p.kind || "?") + (p._occupySrc ? " [" + p._occupySrc + "]" : "") + (p._protRole ? " (" + p._protRole + ")" : ""),
          d: +Math.hypot(dx, dz).toFixed(1), why: why });
      }
      return out;
    };
    // move the player (and his camera) to a world point on a floor, facing yaw
    __pp.put = function (x, y, z, yaw) {
      var P = CBZ.player; if (!P) return false;
      if (CBZ.propStand && (P._propSeat || P._propBed)) { try { CBZ.propStand(P, { instant: true }); } catch (e) {} }
      P.pos.set(x, y, z); if (P.vel) P.vel.set(0, 0, 0);
      if (CBZ.cam) CBZ.cam.yaw = yaw;
      return true;
    };
    return true;
  })()`);

  // settle: sworn in, the room, the staff, the car
  await t.step(240);
  const stops = [];
  async function stop(label, setup, secs) {
    if (setup) await t.evl(setup);
    for (let s = 0; s < secs; s += 2) await t.step(120);
    const c = await t.evl("__pp.census(40, 3)");
    stops.push({ label, ...c });
  }
  // 1. at the desk: the office's own people (detail, secretary, the line, aides)
  await stop("Oval Office, seated at the desk", null, 12);
  // an aide walks in with something that cannot wait
  await stop("an aide walks in", "(function(){try{var O=CBZ.presidentOffice; if(O&&O.offer) O.offer({who:'chief', topic:'security', title:'A word', urgent:true});}catch(e){} return true;})()", 10);
  // 2. the West Wing corridor and 3. the Mansion's state floor
  const rooms = await t.evl("(CBZ.presidentInteriorRooms?CBZ.presidentInteriorRooms():[]).map(function(r){return {key:r.key,x:r.x,z:r.z,y:r.floorY,w:r.w,d:r.d};})");
  const byKey = {}; for (const r of rooms || []) byKey[r.key] = r;
  for (const k of ["wwhall", "outeroffice", "cabinetroom", "statehall", "stateresidence"]) {
    const r = byKey[k] || (rooms || []).find((q) => q.key === k);
    if (!r) continue;
    await stop(k, `__pp.put(${r.x}, ${r.y + 0.02}, ${r.z}, 0)`, 10);
    await stop(k + " (turned round)", `(function(){ if (CBZ.cam) CBZ.cam.yaw += Math.PI; return true; })()`, 4);
  }

  // 4. the Situation Room, the front door / motor court, the gate
  const extra = await t.evl(`(function(){
    var out = [], L = CBZ.govComplexes || [], s = null;
    for (var i = 0; i < L.length; i++) if (L[i] && L[i].id === 'execmansion') s = L[i];
    if (!s) return out;
    var mb = s.lot && s.lot.building, sr = mb && mb._sitRoom;
    if (sr) out.push({ label: 'Situation Room', x: (sr.minX + sr.maxX) / 2, y: (mb.floorTops ? mb.floorTops[0] : 0.14) + 0.02, z: (sr.minZ + sr.maxZ) / 2 });
    var cx = s.cx != null ? s.cx : (s.rect.minX + s.rect.maxX) / 2, cz = s.cz != null ? s.cz : (s.rect.minZ + s.rect.maxZ) / 2;
    out.push({ label: 'front door / motor court', x: cx, y: 0.2, z: cz - 16 });
    if (s.gate) out.push({ label: 'the gate', x: s.gate.x, y: 0.2, z: s.gate.z - 6 });
    return out;
  })()`);
  for (const e of extra || []) {
    await stop(e.label, `__pp.put(${e.x}, ${e.y}, ${e.z}, 0)`, 10);
    await stop(e.label + " (turned round)", `(function(){ if (CBZ.cam) CBZ.cam.yaw += Math.PI; return true; })()`, 4);
  }

  let bad = 0, tin = 0, tdr = 0;
  for (const s of stops) {
    tin += s.inSim; tdr += s.drawn;
    const ok = s.drawn === s.inSim;
    if (!ok) bad++;
    t.log((ok ? "  ok  " : "FAIL  ") + s.label.padEnd(40) + " in sim " + String(s.inSim).padStart(3) + "   drawn " + String(s.drawn).padStart(3));
    if (!ok || VERBOSE) for (const h of s.hidden.slice(0, VERBOSE ? 60 : 12)) t.log("        invisible: " + h.who + " at " + h.d + " m (" + h.why + ")");
  }
  const errs = [...new Set(t.errors())].filter((e) => /president|protection|peds|pedinstance|occupy|interior/.test(e));
  if (errs.length) { t.log("page errors:"); for (const e of errs.slice(0, 8)) t.log("  " + e); }
  // the house's finish was laid while we walked it (city/fitout.js), without a throw
  const fit = await t.evl("JSON.stringify((function(){ var a = CBZ.fitoutAudit ? CBZ.fitoutAudit() : null; return a ? { built: a.stats.built, errors: a.stats.errors, lastError: a.stats.lastError ? String(a.stats.lastError).slice(0, 300) : null, maxMs: Math.round(a.stats.maxMs) } : null; })())");
  if (fit) {
    const F = JSON.parse(fit);
    t.log("fit-out: " + F.built + " floors laid, " + F.errors + " errors, slowest " + F.maxMs + " ms" + (F.lastError ? "\n  " + F.lastError : ""));
    if (F.errors) bad++;
  }
  const rs = await t.evl("JSON.stringify(CBZ.npcRevealStats || null)");
  if (rs) t.log("reveal law: " + rs);
  return { ok: !bad, summary: `PRESIDENT-PEOPLE: ${bad ? "FAIL" : "OK"}  ${tdr} of ${tin} people drawn across ${stops.length} stops`, data: { stops: stops.length, drawn: tdr, inSim: tin } };
}
