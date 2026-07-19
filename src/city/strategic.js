/* ============================================================
   city/strategic.js — STRATEGIC WEAPONS (part 2): the B-2, the
   bunker-buster, and the nuke. Partner file to city/bunkers.js.

   WHY ONE LAYER, NOT THREE BOLT-ONS (owner mandate): the pieces chain —
   the military bunker's vault holds THE one nuclear device per world and
   its armory stocks the bunker-busters; the B-2 on the Fort Brandt apron
   is the delivery platform for both; the buster is the only weapon that
   kills THROUGH a bunker roof, which matters because an intact bunker is
   the only thing that shelters you from the nuke. Steal the bomber, raid
   the vault, and the end of the world is a payload switch away.

   THE B-2: a chunky voxel flying wing (sawtooth trailing edge, no tail)
   parked on the military apron. It registers through the EXISTING
   military-hardware seam (CBZ.cityRegisterMilitaryVehicle) and therefore
   inherits, with zero new plumbing: the boarding interaction + heat
   (militaryvehicles.js), the aircraft_doors boarding arc (a real belly
   hatch eases open off rec._doorArcOpen — the same flag the airliner
   panels ride), lock-on targetability (lockon.js sweeps
   cityMilitaryVehicles), and the fly-the-ACTUAL-prop flight path
   (playeraircraft.js spawnFlyableFromProp). Its heavy/stable feel comes
   from stamping the spawned craft onto the existing "airliner" WING_V2
   row (fast, stately, hard-to-flick) — a deliberate reuse instead of
   editing the flight-model file mid-flight-feel-work by another agent.

   ORDNANCE PATHS (hard rule: no parallel blast system): every
   detonation routes through the WRAPPED CBZ.cityExplosion chain, so
   demolition HP, facade fracture, armored reactions, crowd panic and
   heat all fire exactly as they do for the RPG/C4. Each blast gets a
   FRESH opts object → the chain's per-blast idempotence (_demoSeen)
   holds by construction.

   THE NUKE is STAGED (owner: no iPad hitch): detonation enqueues work —
   an outward-sweeping ring of wrapped blasts, building destruction at a
   few lots per frame through cityDemolition (batchHide under the hood —
   merged buffers never disposed), mass deaths through the KILL BUS
   (cityKillPed/cityCrowdKill with cause "nuclear blast" → the corner
   feed reads "You killed Dave Smith · NUCLEAR BLAST"), car wrecks, a
   scorch field and a lingering radiation zone. An INTACT bunker
   (bunkers.js) shelters anyone inside; a breached one does not. Max
   wanted via the military-reason star API. NO new HUD — the killfeed
   carries the story; the flash/cloud are world FX, not UI.

   DETERMINISM: placement/build = hash01 only. Combat-time FX = runtime,
   Math.random allowed (same rule the C4/grenade paths follow). New FX
   materials are PARKED invisible in the scene at load so core/fxwarm's
   renderer.compile prewarms them (no first-nuke shader freeze).

   FLAGS: CBZ.CONFIG.STRAT_B2 / STRAT_BUNKER_BUSTER / STRAT_NUKE — each
   independently one-line revertible. Plain IIFE, THREE r128.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.STRAT_B2 == null) CBZ.CONFIG.STRAT_B2 = true;
  if (CBZ.CONFIG.STRAT_BUNKER_BUSTER == null) CBZ.CONFIG.STRAT_BUNKER_BUSTER = true;
  if (CBZ.CONFIG.STRAT_NUKE == null) CBZ.CONFIG.STRAT_NUKE = true;

  function h01(x, z, s) { return CBZ.hash01 ? CBZ.hash01(x, z, s) : 0.5; }
  function cm(hex, opts) { return CBZ.cmat ? CBZ.cmat(hex, opts) : (CBZ.mat ? CBZ.mat(hex, opts) : new THREE.MeshLambertMaterial({ color: hex })); }
  function bg(w, h, d) { return CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d); }
  function note(m, s) { if (CBZ.city && CBZ.city.note) { try { CBZ.city.note(m, s); } catch (e) {} } }
  function sfx(n, o) { if (CBZ.sfx) { try { CBZ.sfx(n, o); } catch (e) {} } }

  // ---- payload items live in the one city economy (explosives.js idiom:
  // register here, retry if the economy rebuilds; NOT in any shop stock —
  // these are found in bunkers, never bought). ----
  function ensureItems() {
    const e = CBZ.cityEcon;
    if (!e || !e.ITEMS) return false;
    if (!e.ITEMS["Bunker Buster"]) e.ITEMS["Bunker Buster"] = { value: 12000, tag: "ordnance", ordnance: true };
    if (!e.ITEMS["Nuclear Device"]) e.ITEMS["Nuclear Device"] = { value: 250000, tag: "ordnance", ordnance: true };
    return true;
  }
  ensureItems();
  function invCount(n) { const e = CBZ.cityEcon; return e && e.count ? e.count(n) : 0; }
  function invTake(n) { const e = CBZ.cityEcon; return !!(e && e.take && e.take(n, 1)); }
  function invAdd(n) { const e = CBZ.cityEcon; if (e && e.add) e.add(n, 1); }

  /* ==========================================================================
     1) THE B-2 — model, placement, registration, hatch, feel stamp, bay.
  ========================================================================== */

  // sculpt helpers — the r128 position-attribute idiom (same math as
  // island_military's taperBox/wingGeo; local copies, that module is private).
  function taperBox(w, h, d, opt) {
    opt = opt || {};
    const nz = opt.nz != null ? opt.nz : 1, tz = opt.tz != null ? opt.tz : 1;
    const top = opt.top != null ? opt.top : 1, bot = opt.bot != null ? opt.bot : 1;
    const geo = new THREE.BoxGeometry(w, h, d, opt.segW || 2, opt.segH || 2, opt.segD || 6);
    const pos = geo.attributes.position, hd = d / 2, hh = h / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const f = z / hd, zt = f >= 0 ? (1 + (nz - 1) * f) : (1 + (tz - 1) * -f);
      let sx = zt, sy = zt;
      const vy = hh > 0 ? y / hh : 0;
      if (vy > 0) sx *= (1 + (top - 1) * vy);
      if (vy < 0) sx *= (1 + (bot - 1) * -vy);
      pos.setX(i, x * sx); pos.setY(i, y * sy);
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
    return geo;
  }
  function wingGeo(side, span, chord, thick, sweep, taper, thin) {
    const geo = new THREE.BoxGeometry(span, thick, chord, 6, 1, 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), t = (x + span / 2) / span;
      pos.setX(i, side * (x + span / 2));
      pos.setZ(i, pos.getZ(i) * (1 - (taper || 0) * t) - (sweep || 0) * t);
      pos.setY(i, pos.getY(i) * (1 - (thin || 0) * t));
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
    return geo;
  }

  const B2C = { skin: 0x24272c, skinD: 0x1b1e23, panel: 0x2c3037, glass: 0x2a3b4d, gear: 0x3a3f46, tire: 0x14161a };

  // THE FLYING WING — built 1:1 (no group scale, so the aircraft_doors hatch
  // walk-point at local (-2, 0) lands exactly at the belly hatch). Nose +Z,
  // parked on its gear at y=0. Every member ≥0.3u — voxel-chunky by doctrine.
  function makeB2() {
    const gp = new THREE.Group();
    const cy = 2.1;                                    // body centreline height
    // centre body: deep chord, beak nose, humped top
    const body = new THREE.Mesh(taperBox(8.4, 2.4, 19, { nz: 0.16, tz: 0.7, top: 0.5, bot: 0.8, segD: 8 }), cm(B2C.skin));
    body.position.set(0, cy, -1.0); body.castShadow = true; body.receiveShadow = true; gp.add(body);
    // cockpit glass band riding the nose slope
    const canopy = new THREE.Mesh(taperBox(2.6, 0.8, 3.2, { nz: 0.45, top: 0.5 }), cm(B2C.glass));
    canopy.position.set(0, cy + 1.05, 4.6); canopy.castShadow = true; gp.add(canopy);
    // WINGS — hard-swept sculpted slabs; root buried in the body flank
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(wingGeo(s, 19, 12.5, 1.1, 9.5, 0.74, 0.55), cm(B2C.skin));
      w.position.set(s * 3.4, cy + 0.1, 2.2); w.castShadow = true; w.receiveShadow = true; gp.add(w);
      // SAWTOOTH trailing edge — two chunky teeth per side make the W read
      const t1 = new THREE.Mesh(taperBox(4.6, 0.7, 4.4, { tz: 0.12 }), cm(B2C.skinD));
      t1.position.set(s * 6.4, cy + 0.05, -6.6); t1.castShadow = true; gp.add(t1);
      const t2 = new THREE.Mesh(taperBox(3.6, 0.55, 3.4, { tz: 0.12 }), cm(B2C.skinD));
      t2.position.set(s * 12.4, cy + 0.02, -6.2); t2.castShadow = true; gp.add(t2);
      // intake hump + shielded exhaust notch on the upper surface
      const hump = new THREE.Mesh(taperBox(2.4, 0.9, 4.6, { nz: 0.5, tz: 0.7, top: 0.6 }), cm(B2C.panel));
      hump.position.set(s * 3.1, cy + 1.15, 1.6); hump.castShadow = true; gp.add(hump);
      const mES = new THREE.Mesh(bg(1.7, 0.34, 1.2), cm(B2C.skinD));
      mES.position.set(s * 3.1, cy + 1.15, -2.4); gp.add(mES);
      // wingtip nav lights: red port, green starboard
      const nl = new THREE.Mesh(bg(0.3, 0.3, 0.3), cm(s < 0 ? 0xff4a3d : 0x37d67a, { emissive: s < 0 ? 0xff4a3d : 0x37d67a, ei: 0.9 }));
      nl.position.set(s * 21.2, cy + 0.1, -5.6); gp.add(nl);
    }
    // centre tail apex (the middle point of the W)
    const apex = new THREE.Mesh(taperBox(5.2, 0.8, 4.6, { tz: 0.1 }), cm(B2C.skin));
    apex.position.set(0, cy - 0.1, -9.4); apex.castShadow = true; gp.add(apex);
    const wl = new THREE.Mesh(bg(0.26, 0.26, 0.26), cm(0xf2f4ff, { emissive: 0xf2f4ff, ei: 0.9 }));
    wl.position.set(0, cy + 0.3, -11.4); gp.add(wl);
    // BOMB BAY: recessed belly panel + TWO working doors (tagged for the drop)
    const belly = cy - 1.25;
    const bay = new THREE.Mesh(bg(3.6, 0.16, 6.4), cm(B2C.skinD));
    bay.position.set(0, belly, 0.6); gp.add(bay);
    for (const s of [-1, 1]) {
      const dgeo = bg(1.6, 0.14, 6.0);
      dgeo.translate(s * 0.8, 0, 0);                   // hinge on the outboard edge
      const dm = new THREE.Mesh(dgeo, cm(B2C.panel));
      dm.position.set(s * 0.1, belly - 0.06, 0.6);
      dm.castShadow = true; gp.add(dm);
      gp.userData[s < 0 ? "bayL" : "bayR"] = dm;
      dm.userData.bayDoor = true;                      // spare from any static pass
    }
    // CREW HATCH + drop ladder under the port wing root at local (-5.2, 0.5)
    // — OUTSIDE the parked body collider so the aircraft_doors walk-up beat
    // can actually reach it. Tagged as a doorRig so doorSpec picks the
    // "stair" arc at OUR coordinates: the player walks under the wing, the
    // hatch swings down with the ladder (eased off rec._doorArcOpen — the
    // exact flag the airliner panels ride), steps in, and the flight
    // controller takes over.
    const HATCH_Y = 1.45;                              // wing underside at the root
    const hgeo = bg(1.0, 0.12, 1.5);
    hgeo.translate(0, 0, -0.75);                       // hinge on the forward edge
    const hatch = new THREE.Mesh(hgeo, cm(B2C.panel));
    hatch.position.set(-5.2, HATCH_Y, 1.25);
    hatch.castShadow = true; gp.add(hatch);
    const ladder = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const rung = new THREE.Mesh(bg(0.7, 0.08, 0.1), cm(B2C.gear));
      rung.position.set(0, -0.3 - i * 0.32, 0); ladder.add(rung);
    }
    for (const s of [-0.35, 0.35]) {
      const rail = new THREE.Mesh(bg(0.08, 1.4, 0.08), cm(B2C.gear));
      rail.position.set(s, -0.7, 0); ladder.add(rail);
    }
    ladder.position.set(-5.2, HATCH_Y, 0.85);
    ladder.visible = false;
    gp.add(ladder);
    gp.userData.b2Hatch = hatch; gp.userData.b2Ladder = ladder;
    gp.userData.b2HatchBase = { rx: hatch.rotation.x };
    gp.userData.doorRig = { panel: hatch, doorX: -5.2, doorZ: 0.5 };
    // LANDING GEAR — chunky legs; wheels touch y=0
    function leg(x, z, tall) {
      const st = new THREE.Mesh(bg(0.42, tall, 0.42), cm(B2C.gear));
      st.position.set(x, tall / 2 + 0.4, z); st.castShadow = true; gp.add(st);
      for (const s of [-0.3, 0.3]) {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.3, 10), cm(B2C.tire));
        wh.rotation.z = Math.PI / 2; wh.position.set(x + s, 0.44, z); wh.castShadow = true; gp.add(wh);
      }
    }
    leg(0, 6.2, 0.9);                                  // nose
    leg(-3.6, -1.8, 0.9); leg(3.6, -1.8, 0.9);         // mains
    // missile muzzle node at the beak (playeraircraft fires from userData.muzzle)
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, cy, 8.9); gp.add(muzzle);
    gp.userData.muzzle = muzzle; gp.userData.muzzleLocal = muzzle.position.clone();
    const dims = { family: "B-2-stealth", length: 21, span: 44, height: 4.6 };
    gp.userData.aircraftDims = dims;
    return { group: gp, dims };
  }

  // ---- PLACEMENT + REGISTRATION (landmass order 41 — right after the
  // bunkers so the whole strategic kit builds together; the apron slot is
  // clear of every authored Fort Brandt prop: jets end ~x -627, the heavy
  // bomber starts ~x -495, helipads sit at z -670).
  let b2rec = null, _b2Reg = false;
  CBZ.addLandmass(function (city) {
    b2rec = null; _b2Reg = false;
    if (CBZ.CONFIG.STRAT_B2 === false) return;
    const root = city.root || CBZ.scene;
    const made = makeB2();
    const wx = -560, wz = -566, rotY = Math.PI;        // nose toward the runway
    made.group.position.set(wx, 0, wz);
    made.group.rotation.y = rotY;
    made.group.userData.milKind = "plane";
    made.group.userData.milName = "B-2 SPIRIT";
    made.group.userData.dynamic = true;                // never frozen/merged: it flies
    root.add(made.group);
    // the parked SOLID is the centre BODY only (9.2×21): a full 44u-span box
    // would wall off half the apron and stand between the player and the crew
    // hatch under the wing. footW stays the true span (boarding range + the
    // footprint-scaled chase cam read it); colliderW/L feed the re-park.
    const solid = { minX: wx - 4.6, maxX: wx + 4.6, minZ: wz - made.dims.length / 2, maxZ: wz + made.dims.length / 2, y0: 0, y1: made.dims.height, ref: made.group };
    CBZ.colliders.push(solid);
    b2rec = {
      group: made.group, pos: made.group.position, heading: rotY,
      kind: "plane", model: { name: "B-2 SPIRIT" }, collider: solid,
      colliderW: 9.2, colliderL: made.dims.length,
      modelYawOffset: 0, groundOffset: 0, aircraftDims: made.dims,
      footW: made.dims.span, footL: made.dims.length, taken: false, hot: true,
      b2: true,
    };
    // keep the apron under it clear of wandering spawns (runway idiom)
    if (CBZ.registerNoSpawnZone) CBZ.registerNoSpawnZone(city, { minX: solid.minX - 2, maxX: solid.maxX + 2, minZ: solid.minZ - 2, maxZ: solid.maxZ + 2, label: "b2-apron" });
  }, 41);
  // registry hand-off — deferred one tick exactly like the islands (55.1);
  // ours at 55.15 so the base fleet lists first.
  CBZ.onUpdate(55.15, function () {
    if (_b2Reg || !b2rec || CBZ.CONFIG.STRAT_B2 === false) return;
    if (!CBZ.cityRegisterMilitaryVehicle) return;
    CBZ.cityRegisterMilitaryVehicle(b2rec);
    _b2Reg = true;
  });

  // ---- HATCH EASING — rides rec._doorArcOpen, the same flag the airliner
  // panels ease off (aircraft_doors sets it during the walk/step beats).
  let _hatchT = 0;
  CBZ.onUpdate(55.35, function (dt) {
    if (!b2rec || !b2rec.group || !b2rec.group.parent) return;
    const ud = b2rec.group.userData;
    if (!ud.b2Hatch) return;
    const want = b2rec._doorArcOpen ? 1 : 0;
    if (_hatchT === want && want === 0 && !ud.b2Ladder.visible) return;
    _hatchT += Math.sign(want - _hatchT) * dt / 0.45;
    _hatchT = Math.max(0, Math.min(1, _hatchT));
    const e = _hatchT * _hatchT * (3 - 2 * _hatchT);
    ud.b2Hatch.rotation.x = (ud.b2HatchBase.rx || 0) + e * 1.35;   // swings down+aft
    ud.b2Ladder.visible = e > 0.35;
    ud.b2Ladder.scale.y = Math.max(0.001, e);
  });

  // ---- FEEL STAMP — the moment the flight controller takes the B-2, shape
  // the craft ONCE: the heavy/stable "airliner" WING_V2 row (fast, stately —
  // vmax 105, low roll/pitch authority, strong auto-level: a strategic
  // bomber, not a knife-fighter), a small defensive missile load, and the
  // bomb magazine. Done from OUR file so the flight-model module (another
  // agent's active surface) stays untouched.
  const B2_BOMBS = 16, B2_MISSILES = 8;
  function flyingB2() {
    const P = CBZ.player;
    const c = P && P._aircraft;
    return (c && b2rec && c.sourceRec === b2rec) ? c : null;
  }
  CBZ.onUpdate(12.35, function (dt) {
    const c = flyingB2();
    if (c && !c._b2Init) {
      c._b2Init = true;
      c._b2 = true;
      c.airClass = "airliner";                     // the heavy/stable row
      c.ammo = Math.min(c.ammo, B2_MISSILES);
      c.maxAmmo = B2_MISSILES;
      c.bombAmmo = B2_BOMBS;
      c.displayName = "B-2 SPIRIT";
      payload = "bomb";
      note("B-2 SPIRIT — [B] drop payload · [X] switch payload · LMB defensive missiles", 4.2);
    }
    // bay doors ease open around a drop window, then seal
    if (b2rec && b2rec.group && b2rec.group.userData.bayL) {
      const ud = b2rec.group.userData;
      const want = _bayT > 0 ? 1 : 0;
      if (_bayT > 0) _bayT -= dt;
      if (_bayOpen !== want || (_bayOpen > 0 && _bayOpen < 1)) {
        _bayOpen += Math.sign(want - _bayOpen) * dt / 0.5;
        _bayOpen = Math.max(0, Math.min(1, _bayOpen));
        const e = _bayOpen * _bayOpen * (3 - 2 * _bayOpen);
        ud.bayL.rotation.z = -e * 1.15;
        ud.bayR.rotation.z = e * 1.15;
      }
    }
  });
  let _bayT = 0, _bayOpen = 0;

  /* ==========================================================================
     2) THE BOMB BAY — unguided gravity bombs + the two special payloads.
  ========================================================================== */
  let payload = "bomb";                              // "bomb" | "buster" | "nuke"
  const PAYLOADS = ["bomb", "buster", "nuke"];
  function payloadAvailable(k, craft) {
    if (k === "bomb") return craft && (craft.bombAmmo | 0) > 0;
    if (k === "buster") return CBZ.CONFIG.STRAT_BUNKER_BUSTER !== false && invCount("Bunker Buster") > 0;
    if (k === "nuke") return CBZ.CONFIG.STRAT_NUKE !== false && invCount("Nuclear Device") > 0;
    return false;
  }
  function cyclePayload() {
    const c = flyingB2();
    if (!c) return payload;
    const i = PAYLOADS.indexOf(payload);
    for (let k = 1; k <= PAYLOADS.length; k++) {
      const cand = PAYLOADS[(i + k) % PAYLOADS.length];
      if (payloadAvailable(cand, c)) { payload = cand; break; }
    }
    note(payload === "bomb" ? "Payload: Mk-84 bombs (" + (c.bombAmmo | 0) + ")"
      : payload === "buster" ? "Payload: GBU-57 BUNKER BUSTER (" + invCount("Bunker Buster") + ")"
      : "Payload: THE DEVICE", 1.6);
    sfx("switch", { pitch: 1.2, volume: 0.3 });
    return payload;
  }

  // ---- the falling-ordnance pool (shared geo/mats — explosives.js idiom) ---
  let BGEO = null, BMAT = null;
  function bombAssets() {
    if (BGEO) return;
    BGEO = {
      body: new THREE.CylinderGeometry(0.24, 0.28, 1.9, 8),
      buster: new THREE.CylinderGeometry(0.26, 0.3, 3.4, 8),
      nuke: new THREE.CylinderGeometry(0.42, 0.42, 2.4, 10),
      fin: new THREE.BoxGeometry(0.7, 0.5, 0.08),
    };
    BMAT = {
      body: new THREE.MeshLambertMaterial({ color: 0x3a4030 }),
      buster: new THREE.MeshLambertMaterial({ color: 0x2b2e33 }),
      nuke: new THREE.MeshLambertMaterial({ color: 0xb8bec6 }),
      band: new THREE.MeshLambertMaterial({ color: 0xd4a017 }),
    };
    for (const k in BGEO) BGEO[k]._shared = true;
    for (const k in BMAT) BMAT[k]._shared = true;
  }
  function bombMesh(kind) {
    bombAssets();
    const gp = new THREE.Group();
    const body = new THREE.Mesh(kind === "buster" ? BGEO.buster : kind === "nuke" ? BGEO.nuke : BGEO.body,
      kind === "buster" ? BMAT.buster : kind === "nuke" ? BMAT.nuke : BMAT.body);
    body.rotation.x = Math.PI / 2;                   // nose down the flight path
    gp.add(body);
    if (kind !== "bomb") {
      const band = new THREE.Mesh(BGEO.fin, BMAT.band);
      band.scale.set(0.9, 0.4, 1); band.position.z = 0.3; gp.add(band);
    }
    for (let i = 0; i < 2; i++) {
      const f = new THREE.Mesh(BGEO.fin, BMAT.body);
      f.rotation.z = i * Math.PI / 2;
      f.position.z = -(kind === "buster" ? 1.6 : 1.0);
      gp.add(f);
    }
    gp.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    return gp;
  }
  const bombs = [];                                  // {mesh,x,y,z,vx,vy,vz,kind,fuse}
  const GRAV = 14;                                   // gamey-fast fall — reads right at flight alt

  function dropPayload() {
    const c = flyingB2();
    if (!c || !g || g.mode !== "city") return false;
    if (bombs.length >= 12) return false;               // pool cap
    // bomber discipline: a release on the deck detonates under your own tail
    const agl = c.pos.y - (CBZ.floorAt ? CBZ.floorAt(c.pos.x, c.pos.z) : 0);
    if (agl < 14) { note("Too low — climb before releasing.", 1.4); return false; }
    if (!payloadAvailable(payload, c)) { cyclePayload(); if (!payloadAvailable(payload, c)) { note("Bay's empty.", 1.2); return false; } }
    if (c._dropCD > 0) return false;
    if (payload === "bomb") c.bombAmmo--;
    else if (payload === "buster") { if (!invTake("Bunker Buster")) return false; }
    else if (payload === "nuke") { if (!invTake("Nuclear Device")) return false; }
    c._dropCD = payload === "bomb" ? 0.35 : 1.4;
    _bayT = 1.3;                                     // bay doors swing for the release
    const sp = c.airspeed != null && c.airspeed > 0 ? c.airspeed : (c.speed || 0);
    const cp = Math.cos(c.pitch || 0);
    const b = {
      mesh: bombMesh(payload), kind: payload,
      x: c.pos.x, y: c.pos.y - 1.6, z: c.pos.z,
      vx: Math.sin(c.heading) * cp * sp, vy: Math.sin(c.pitch || 0) * sp - 2, vz: Math.cos(c.heading) * cp * sp,
    };
    b.mesh.position.set(b.x, b.y, b.z);
    b.mesh.rotation.y = c.heading;
    if (CBZ.scene) CBZ.scene.add(b.mesh);
    bombs.push(b);
    sfx("whoosh", { pitch: 0.8, volume: 0.5 });
    // dropping ordnance on the city is a crime the moment it leaves the bay
    if (CBZ.cityCrime) { try { CBZ.cityCrime(payload === "bomb" ? 120 : 200, { x: c.pos.x, z: c.pos.z, type: "shots-fired" }); } catch (e) {} }
    return true;
  }

  // ballistic tick + impact resolution
  CBZ.onUpdate(12.45, function (dt) {
    const c = flyingB2();
    if (c && c._dropCD > 0) c._dropCD -= dt;
    if (!bombs.length) return;
    if (g.mode !== "city") {                            // mode flip: sweep the sky
      for (const b of bombs) if (b.mesh.parent) b.mesh.parent.remove(b.mesh);
      bombs.length = 0;
      return;
    }
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      b.vy -= GRAV * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      b.mesh.position.set(b.x, b.y, b.z);
      b.mesh.rotation.x = Math.max(-1.35, b.mesh.rotation.x - dt * 0.9);   // noses over
      // highest surface under the bomb (terrain OR a roof/platform OR a berm)
      let surf = 0;
      try { surf = CBZ.groundAt ? CBZ.groundAt(b.x, b.z, b.y) : (CBZ.floorAt ? CBZ.floorAt(b.x, b.z) : 0); } catch (e) { surf = 0; }
      if (CBZ.strategicBunkerHit) {
        const bk = CBZ.strategicBunkerHit(b.x, b.z);
        if (bk && bk.moundTop > surf) surf = bk.moundTop;   // burst ON the berm, not inside it
      }
      if (b.y > surf + 0.5 && b.y > -2) continue;
      // IMPACT
      if (b.mesh.parent) b.mesh.parent.remove(b.mesh);
      bombs.splice(i, 1);
      if (g.mode !== "city") continue;
      if (b.kind === "bomb") {
        const o = { power: 2.3, radius: 11, byPlayer: true };
        if (surf > 2.5) o.y = surf;                 // roof hits bloom ON the roof
        if (CBZ.cityExplosion) { try { CBZ.cityExplosion(b.x, b.z, o); } catch (e) {} }
        if (CBZ.cityShatter) { try { CBZ.cityShatter(b.x, b.z, 13); } catch (e) {} }
      } else if (b.kind === "buster") {
        resolveBuster(b.x, b.z, surf);
      } else if (b.kind === "nuke") {
        nukeDetonate(b.x, b.z);
      }
    }
  });

  /* ==========================================================================
     3) THE BUNKER-BUSTER — penetrate DOWN, detonate INSIDE.
     Impact grammar: a sharp surface spike (cosmetic — noDamage so the
     wrapped chain ignores it), a beat of silence while it burrows, then
     the REAL detonation under the surface:
       • over a BUNKER berm  → breach the structure (bunkers.js) + an
         interior blast + a kill-bus sweep of everyone inside. The ONLY
         weapon that ends a bunker.
       • over a BUILDING roof → the one-hit through-roof kill: demolition
         takes the whole building (its own batched teardown), plus a
         ground blast through the wrapped chain for the neighbours.
       • open ground → a deep crater blast, double scorch.
  ========================================================================== */
  const pendingBusters = [];                          // {x,z,surf,t}
  function resolveBuster(x, z, surf) {
    if (CBZ.CONFIG.STRAT_BUNKER_BUSTER === false) {
      if (CBZ.cityExplosion) { try { CBZ.cityExplosion(x, z, { power: 2.3, radius: 11, byPlayer: true }); } catch (e) {} }
      return;
    }
    // the entry spike: a thin cosmetic pop AT the surface (fresh opts; noDamage
    // keeps demolition/fracture from double-counting the real blast below)
    if (CBZ.cityExplosion) { try { CBZ.cityExplosion(x, z, { power: 0.8, radius: 3, noDamage: true, y: surf > 2.5 ? surf : undefined }); } catch (e) {} }
    sfx("clank", { pitch: 0.6, volume: 0.8 });
    pendingBusters.push({ x, z, surf, t: 0.4 });      // the burrow beat
  }
  CBZ.onUpdate(12.5, function (dt) {
    if (!pendingBusters.length) return;
    for (let i = pendingBusters.length - 1; i >= 0; i--) {
      const p = pendingBusters[i];
      p.t -= dt;
      if (p.t > 0) continue;
      pendingBusters.splice(i, 1);
      busterDetonate(p.x, p.z, p.surf);
    }
  });
  function busterDetonate(x, z, surf) {
    // 1) a bunker berm under the impact → BREACH
    const bunker = CBZ.strategicBunkerHit && CBZ.strategicBunkerHit(x, z);
    if (bunker && !bunker.breached) {
      CBZ.strategicBunkerBreach(bunker);
      const I = bunker.interior;
      // the blast lives INSIDE: wrapped-chain explosion seated at the room
      if (CBZ.cityExplosion) { try { CBZ.cityExplosion(I.cx, I.cz, { power: 2.6, radius: 10, byPlayer: true }); } catch (e) {} }
      // guarantee the interior kill through the BUS with an honest cause
      sweepKill(I.minX - 1, I.maxX + 1, I.minZ - 1, I.maxZ + 1, "airstrike");
      note("Direct hit — " + (bunker.name || "the bunker") + " is breached.", 2.6);
      if (CBZ.shake) { try { CBZ.shake(1.4); } catch (e) {} }
      return;
    }
    // 2) a building under the impact (came down on its roof) → THROUGH-ROOF KILL
    const A = CBZ.city && (CBZ.city.arena || CBZ.city);
    if (surf > 3 && A && A.lots && CBZ.cityDemolition && CBZ.cityDemolition.destroy) {
      let hit = null;
      for (const lot of A.lots) {
        const b = lot.building;
        if (!b || lot.demolished) continue;
        if (Math.abs(x - b.ox) <= b.w / 2 && Math.abs(z - b.oz) <= b.d / 2 && surf >= b.h * 0.5) { hit = lot; break; }
      }
      if (hit) {
        CBZ.cityDemolition.destroy(hit);            // batched teardown, colliders, rubble
        if (CBZ.cityExplosion) { try { CBZ.cityExplosion(x, z, { power: 2.4, radius: 10, byPlayer: true }); } catch (e) {} }
        if (CBZ.cityShatter) { try { CBZ.cityShatter(x, z, 14); } catch (e) {} }
        return;
      }
    }
    // 3) open ground → the deep crater
    if (CBZ.cityExplosion) { try { CBZ.cityExplosion(x, z, { power: 3.0, radius: 13, byPlayer: true }); } catch (e) {} }
    if (CBZ.cityScorch) { try { CBZ.cityScorch(x, z, 11); } catch (e) {} }
  }
  // kill-bus sweep of a rect (the buster's interior guarantee): named peds +
  // cops through their own bus entries — accurate causes, corner-feed lines.
  function sweepKill(x0, x1, z0, z1, cause) {
    for (const p of (CBZ.cityPeds || [])) {
      if (!p || p.dead || !p.pos) continue;
      if (p.pos.x >= x0 && p.pos.x <= x1 && p.pos.z >= z0 && p.pos.z <= z1 && CBZ.cityKillPed) {
        try { CBZ.cityKillPed(p, { byPlayer: true, force: 8, fling: 5 }, cause); } catch (e) {}
      }
    }
    for (const cp of (CBZ.cityCops || [])) {
      if (!cp || cp.dead || !cp.pos) continue;
      if (cp.pos.x >= x0 && cp.pos.x <= x1 && cp.pos.z >= z0 && cp.pos.z <= z1 && CBZ.cityHurtCop) {
        try { CBZ.cityHurtCop(cp, 9999, { byPlayer: true }); } catch (e) {}
      }
    }
    const P = CBZ.player;
    if (P && !P.dead && P.pos.x >= x0 && P.pos.x <= x1 && P.pos.z >= z0 && P.pos.z <= z1 && CBZ.cityHurtPlayer) {
      try { CBZ.cityHurtPlayer(9999, (x0 + x1) / 2, (z0 + z1) / 2, "caught in an airstrike", false, null, false); } catch (e) {}
    }
  }

  /* ==========================================================================
     4) THE NUKE — multi-stage, staged-over-frames, kill-bus honest.
  ========================================================================== */
  const NK = {
    R_DESTROY: 150,      // buildings inside this come down (rolling, 2/frame)
    R_KILL: 175,         // actors inside this die (24/frame, bunkers exempt)
    R_CAR: 130,          // vehicles wrecked
    R_PLAYER: 160,       // unsheltered player death radius
    RAD_R: 70,           // lingering radiation zone radius
    RAD_DAYS: 1.2,       // in-game days the zone stays hot
    TIMER: 45,           // planted-device countdown (seconds, real)
  };
  let nk = null;                                     // the one live resolution
  const radZones = [];                               // {x,z,r,until}

  // ---- mushroom cloud + flash FX (runtime-only; materials module-shared and
  // PARKED in the scene at load for fxwarm's renderer.compile prewarm) ----
  let CLOUD = null;
  function cloudMats() {
    if (CLOUD) return CLOUD;
    CLOUD = {
      fire: new THREE.MeshBasicMaterial({ color: 0xffb054, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
      smoke: new THREE.MeshLambertMaterial({ color: 0x4a4038, transparent: true, opacity: 0.92 }),
      ash: new THREE.MeshLambertMaterial({ color: 0x33302c, transparent: true, opacity: 0.85 }),
    };
    for (const k in CLOUD) CLOUD[k]._shared = true;
    return CLOUD;
  }
  function buildCloud(x, z) {
    const M = cloudMats();
    // fresh start on the shared materials (an interrupted previous cloud —
    // mode flip / fresh run — may have left them mid-fade)
    M.fire.opacity = 0.95; M.smoke.opacity = 0.92; M.ash.opacity = 0.85;
    const gp = new THREE.Group();
    gp.position.set(x, 0, z);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(6, 10, 1, 12, 1, true), M.smoke);
    stem.position.y = 0.5; gp.add(stem);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(16, 14, 10), M.smoke);
    cap.position.y = 4; gp.add(cap);
    const core = new THREE.Mesh(new THREE.SphereGeometry(12, 12, 8), M.fire);
    core.position.y = 4; gp.add(core);
    const skirt = new THREE.Mesh(new THREE.TorusGeometry(14, 4.5, 8, 18), M.ash);
    skirt.rotation.x = Math.PI / 2; skirt.position.y = 3; gp.add(skirt);
    gp.traverse(function (o) { o.castShadow = false; o.receiveShadow = false; });
    if (CBZ.scene) CBZ.scene.add(gp);
    return { gp, stem, cap, core, skirt, t: 0 };
  }
  function tickCloud(c, dt) {
    c.t += dt;
    const t = c.t, rise = Math.min(1, t / 14);         // column climbs ~14s
    const e = rise * rise * (3 - 2 * rise);
    const H = 20 + e * 95;                             // cap altitude
    c.cap.position.y = H; c.core.position.y = H;
    const swell = 1 + e * 2.1 + Math.min(0.5, t * 0.01);
    c.cap.scale.setScalar(swell);
    c.core.scale.setScalar(Math.max(0.001, swell * (1 - Math.min(1, t / 9))));  // fire cools out
    CLOUD.fire.opacity = Math.max(0, 0.95 * (1 - t / 9));
    c.stem.scale.set(1 + e * 0.8, H, 1 + e * 0.8);
    c.stem.position.y = H / 2;
    c.skirt.position.y = 2 + e * 6;
    c.skirt.scale.setScalar(1 + e * 2.6 + t * 0.02);
    const fade = t > 34 ? Math.max(0, 1 - (t - 34) / 16) : 1;
    CLOUD.smoke.opacity = 0.92 * fade;
    CLOUD.ash.opacity = 0.85 * fade;
    c.gp.rotation.y += dt * 0.03;                      // a slow roil
    if (t > 50) {
      if (c.gp.parent) c.gp.parent.remove(c.gp);
      c.gp.traverse(function (o) { if (o.isMesh && o.geometry && !o.geometry._shared) o.geometry.dispose(); });
      CLOUD.smoke.opacity = 0.92; CLOUD.ash.opacity = 0.85; CLOUD.fire.opacity = 0.95;  // restore for the next one
      return false;
    }
    return true;
  }
  function whiteout() {
    if (typeof document === "undefined" || !document.body) return;
    let el = document.getElementById("nukeFlash");
    if (!el) {
      el = document.createElement("div");
      el.id = "nukeFlash";
      el.style.cssText = "position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:80;transition:opacity 2.8s ease-out";
      document.body.appendChild(el);
    }
    el.style.transition = "none"; el.style.opacity = "1";
    // double rAF so the snap-to-white paints before the long fade starts
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      el.style.transition = "opacity 2.8s ease-out"; el.style.opacity = "0";
    }); });
  }

  function nukeDetonate(x, z) {
    if (CBZ.CONFIG.STRAT_NUKE === false) {
      if (CBZ.cityExplosion) { try { CBZ.cityExplosion(x, z, { power: 3, radius: 14, byPlayer: true }); } catch (e) {} }
      return;
    }
    if (nk) return;                                   // one apocalypse at a time
    if (!g || g.mode !== "city") return;

    // ---- t=0: the FLASH + the first light of a new sun
    whiteout();
    sfx("explosion"); sfx("boom");
    if (CBZ.shake) { try { CBZ.shake(6); } catch (e) {} }
    if (CBZ.doHitstop) { try { CBZ.doHitstop(0.22); } catch (e) {} }
    let light = null;
    try {
      light = new THREE.PointLight(0xfff2d0, 7, 480, 2);
      light.position.set(x, 40, z);
      if (CBZ.scene) CBZ.scene.add(light);
    } catch (e) { light = null; }

    // ---- the blast-wave schedule: an outward-sweeping ring of WRAPPED
    // cityExplosion calls (fresh opts each → chain idempotence holds). Ring
    // points that would sit on an intact bunker are skipped — the berm holds,
    // and the bunker's fate belongs to the buster, not splash.
    const blasts = [{ t: 0.05, x, z, power: 3.0, radius: 20 }];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      blasts.push({ t: 0.55 + i * 0.08, x: x + Math.cos(a) * 55, z: z + Math.sin(a) * 55, power: 2.4, radius: 13 });
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.39;
      blasts.push({ t: 1.5 + i * 0.09, x: x + Math.cos(a) * 105, z: z + Math.sin(a) * 105, power: 1.9, radius: 11 });
    }

    // ---- building queue: every lot inside R_DESTROY, sorted by distance so
    // the collapse VISIBLY rolls outward from ground zero, 2 per frame.
    const lots = [];
    const A = CBZ.city && (CBZ.city.arena || CBZ.city);
    if (A && A.lots && CBZ.cityDemolition) {
      for (const lot of A.lots) {
        const b = lot.building;
        if (!b || lot.demolished) continue;
        const d = Math.hypot(b.ox - x, b.oz - z);
        if (d <= NK.R_DESTROY) lots.push({ lot, d });
      }
      lots.sort(function (a, b) { return a.d - b.d; });
    }

    // ---- car queue
    const cars = [];
    for (const cv of (CBZ.cityCars || [])) {
      if (!cv || cv.dead || !cv.pos) continue;
      if (Math.hypot(cv.pos.x - x, cv.pos.z - z) <= NK.R_CAR) cars.push(cv);
    }

    // ---- the player's verdict, decided NOW (the wavefront is instant at
    // these scales): an INTACT bunker is the one shelter. Everything the
    // staged queues do afterwards respects that same rule.
    const P = CBZ.player;
    let sheltered = false;
    if (P && !P.dead) {
      sheltered = !!(CBZ.strategicBunkerShelterAt && CBZ.strategicBunkerShelterAt(P.pos.x, P.pos.y, P.pos.z));
      const pd = Math.hypot(P.pos.x - x, P.pos.z - z);
      if (sheltered) {
        g.invuln = Math.max(g.invuln || 0, 8);        // the blast wave passes OVER
        if (pd < NK.R_KILL) note("The bunker holds. Outside, there is nothing left.", 4);
      } else if (pd <= NK.R_PLAYER) {
        try { CBZ.cityHurtPlayer(9999, x, z, "caught in a nuclear blast", false, null, false); } catch (e) {}
      } else if (pd <= NK.R_PLAYER + 70) {
        try { CBZ.cityHurtPlayer(Math.round(60 * (1 - (pd - NK.R_PLAYER) / 70)), x, z, "caught in a nuclear blast", false, null, false); } catch (e) {}
      }
    }

    // ---- consequence: the whole state turns on you. The star API grants the
    // owner-reserved 5th star only for a military-scale reason — this is one.
    if (CBZ.cityCrime) { try { CBZ.cityCrime(400, { x, z, type: "terrorism", instant: true }); } catch (e) {} }
    if (CBZ.cityAddStars) { try { CBZ.cityAddStars(5, "Nuclear detonation — military response"); } catch (e) {} }
    // panic buses (the loudest possible scare, C4's exact pattern)
    if (CBZ.cityPostEvent) { try { CBZ.cityPostEvent({ type: "explosion", pos: { x, y: 1, z }, radius: 400, intensity: 4 }); } catch (e) {} }
    if (CBZ.cityEvent) { try { CBZ.cityEvent("explosion", { x, z, panic: 40, damage: 30 }, { silent: true, noWanted: true }); } catch (e) {} }

    // ---- ground zero stays WRONG for days: scorch rings now, a radiation
    // zone that ticks damage until it decays (in-game clock).
    if (CBZ.cityScorch) {
      try {
        CBZ.cityScorch(x, z, 45);
        for (let i = 0; i < 4; i++) {
          const a = i * 1.57 + 0.6;
          CBZ.cityScorch(x + Math.cos(a) * 34, z + Math.sin(a) * 34, 18);
        }
      } catch (e) {}
    }
    radZones.push({ x, z, r: NK.RAD_R, until: (CBZ.dayTime ? CBZ.dayTime() : 0) + NK.RAD_DAYS });

    nk = {
      t: 0, x, z, blasts, lots, cars, carI: 0,
      crowdStep: 0, actorDone: false, light,
      cloud: buildCloud(x, z), acc: 0,
    };
  }
  CBZ.strategicNukeDetonate = nukeDetonate;           // probe/tooling handle

  // ---- the staged resolver (order 34.7 — right after demolition's own
  // ticker, so a lot we destroy this frame settles in the same pass).
  let _lastEl = 0;
  CBZ.onUpdate(34.7, function (dt) {
    // fresh-run detection (the C4 g.elapsed-rewind trick): a new run must not
    // inherit radiation zones, armed devices, falling bombs or a half-resolved
    // apocalypse from the previous life of the city.
    const el = g.elapsed || 0;
    if (el + 0.001 < _lastEl) {
      radZones.length = 0;
      pendingBusters.length = 0;
      for (const b of bombs) if (b.mesh && b.mesh.parent) b.mesh.parent.remove(b.mesh);
      bombs.length = 0;
      for (const a of armed) if (a.mesh && a.mesh.parent) a.mesh.parent.remove(a.mesh);
      armed.length = 0;
      if (nk) {
        if (nk.cloud && nk.cloud.gp.parent) nk.cloud.gp.parent.remove(nk.cloud.gp);
        if (nk.light && nk.light.parent) nk.light.parent.remove(nk.light);
        nk = null;
      }
    }
    _lastEl = el;
    // radiation zones tick even after the resolution finishes
    if (radZones.length) {
      const now = CBZ.dayTime ? CBZ.dayTime() : 0;
      const P = CBZ.player;
      for (let i = radZones.length - 1; i >= 0; i--) {
        const zn = radZones[i];
        if (now - 0.0001 > zn.until) { radZones.splice(i, 1); continue; }
        if (!P || P.dead || g.mode !== "city") continue;
        const d = Math.hypot(P.pos.x - zn.x, P.pos.z - zn.z);
        if (d < zn.r && !(CBZ.strategicBunkerShelterAt && CBZ.strategicBunkerShelterAt(P.pos.x, P.pos.y, P.pos.z))) {
          zn._acc = (zn._acc || 0) + 4 * dt * (1 - d / zn.r + 0.25);
          if (zn._acc >= 2) {
            zn._acc = 0;
            try { CBZ.cityHurtPlayer(2, zn.x, zn.z, "radiation sickness", false, null, false); } catch (e) {}
          }
        }
      }
    }
    if (!nk) return;
    if (g.mode !== "city") {                           // mode flip mid-apocalypse: wind down clean
      if (nk.cloud && nk.cloud.gp.parent) nk.cloud.gp.parent.remove(nk.cloud.gp);
      if (nk.light && nk.light.parent) nk.light.parent.remove(nk.light);
      nk = null;
      return;
    }
    nk.t += dt;

    // the dying sun
    if (nk.light) {
      nk.light.intensity = Math.max(0, 7 * (1 - nk.t / 3.2));
      if (nk.light.intensity <= 0.01) { if (nk.light.parent) nk.light.parent.remove(nk.light); nk.light = null; }
    }
    // the cloud
    if (nk.cloud && !tickCloud(nk.cloud, dt)) nk.cloud = null;

    // scheduled ring blasts (skip points an intact berm is holding under)
    for (let i = 0; i < nk.blasts.length; i++) {
      const b = nk.blasts[i];
      if (b.done || b.t > nk.t) continue;
      b.done = true;
      if (CBZ.strategicBunkerHit) {
        const shel = CBZ.strategicBunkerHit(b.x, b.z);
        if (shel && !shel.breached) continue;
      }
      if (CBZ.cityExplosion) { try { CBZ.cityExplosion(b.x, b.z, { power: b.power, radius: b.radius, byPlayer: true }); } catch (e) {} }
    }

    // rolling building destruction — 2 lots/frame, nearest first
    let budget = 2;
    while (budget > 0 && nk.lots.length) {
      const rec = nk.lots.shift();
      budget--;
      try { CBZ.cityDemolition.destroy(rec.lot); } catch (e) {}
    }

    // the crowd dies in three expanding pulses through the BUS (the wrap logs
    // "You killed <name> · NUCLEAR BLAST"; the feed caps itself at 4 lines)
    const pulses = [[0.2, 70], [0.9, 125], [1.8, NK.R_KILL]];
    while (nk.crowdStep < pulses.length && nk.t >= pulses[nk.crowdStep][0]) {
      const r = pulses[nk.crowdStep][1];
      nk.crowdStep++;
      if (CBZ.cityCrowdCircleKill) {
        try { CBZ.cityCrowdCircleKill(nk.x, nk.z, r, { cause: "nuclear blast", fromX: nk.x, fromZ: nk.z, quiet: true }); } catch (e) {}
      }
    }

    // named peds + cops — 24 kills/frame max, bunker-sheltered spared
    if (!nk.actorDone) {
      let killed = 0, checked = 0;
      const R2 = NK.R_KILL * NK.R_KILL;
      for (const p of (CBZ.cityPeds || [])) {
        if (killed >= 24) break;
        checked++;
        if (!p || p.dead || !p.pos) continue;
        const dx = p.pos.x - nk.x, dz = p.pos.z - nk.z;
        if (dx * dx + dz * dz > R2) continue;
        if (CBZ.strategicBunkerShelterAt && CBZ.strategicBunkerShelterAt(p.pos.x, p.pos.y, p.pos.z)) continue;
        if (CBZ.cityKillPed) { try { CBZ.cityKillPed(p, { byPlayer: true, fromX: nk.x, fromZ: nk.z, force: 12, fling: 9 }, "nuclear blast"); } catch (e) {} }
        killed++;
      }
      for (const cp of (CBZ.cityCops || [])) {
        if (killed >= 24) break;
        if (!cp || cp.dead || !cp.pos) continue;
        const dx = cp.pos.x - nk.x, dz = cp.pos.z - nk.z;
        if (dx * dx + dz * dz > R2) continue;
        if (CBZ.strategicBunkerShelterAt && CBZ.strategicBunkerShelterAt(cp.pos.x, cp.pos.y, cp.pos.z)) continue;
        if (CBZ.cityHurtCop) { try { CBZ.cityHurtCop(cp, 9999, { byPlayer: true, fromX: nk.x, fromZ: nk.z }); } catch (e) {} }
        killed++;
      }
      if (killed === 0 && nk.t > 3) nk.actorDone = true;
    }

    // vehicles — 3 wrecks/frame
    let cb = 3;
    while (cb > 0 && nk.carI < nk.cars.length) {
      const cv = nk.cars[nk.carI++];
      cb--;
      if (cv && !cv.dead && CBZ.cityDamageCar) { try { CBZ.cityDamageCar(cv, 9999, { byPlayer: true }); } catch (e) {} }
    }

    // done when every queue has drained and the cloud has dissolved
    if (nk.t > 6 && !nk.lots.length && nk.carI >= nk.cars.length &&
        nk.actorDone && nk.crowdStep >= pulses.length && !nk.cloud) {
      nk = null;
    }
  });

  /* ==========================================================================
     5) THE PLACED DEVICE — carry it in, set the timer, get out (or don't).
     Both verbs live in the ONE interaction registry (touch pills for free,
     HUD doctrine intact: no new chrome, the killfeed carries the deaths).
  ========================================================================== */
  const armed = [];                                   // {x,z,t,mesh,beep}
  function deviceMesh() {
    bombAssets();
    const gp = bombMesh("nuke");
    gp.rotation.x = 0;                                // lies flat on the ground
    gp.rotation.z = Math.PI / 2;
    const led = new THREE.Mesh(bg(0.12, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
    led.position.set(0, 0.55, 0);
    gp.add(led);
    gp.userData.led = led;
    return gp;
  }
  let _plantWired = false;
  function wirePlantZones() {
    if (_plantWired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    const I = CBZ.interactions;
    const _plantTok = { x: 0, z: 0 };            // stable identity → no panel churn
    I.registerZone({
      id: "nuke-plant", kind: "nukeplant", radius: 2,
      find: function (px, pz) {
        if (CBZ.CONFIG.STRAT_NUKE === false) return null;
        const P = CBZ.player;
        if (!P || P.dead || P.driving || P._aircraft) return null;
        if (invCount("Nuclear Device") <= 0) return null;
        _plantTok.x = px; _plantTok.z = pz;
        return _plantTok;
      },
      options: [{
        id: "nuke-plant-arm", slot: "e", bad: true,
        label: function () { return "Plant the nuclear device (" + NK.TIMER + "s)"; },
        onSelect: function (t) {
          if (!invTake("Nuclear Device")) return;
          const gy = CBZ.floorAt ? CBZ.floorAt(t.x, t.z) : 0;
          const m = deviceMesh();
          m.position.set(t.x, gy + 0.45, t.z);
          if (CBZ.scene) CBZ.scene.add(m);
          armed.push({ x: t.x, z: t.z, t: NK.TIMER, mesh: m, beep: 0 });
          note("DEVICE ARMED — " + NK.TIMER + " seconds. Run.", 3.2);
          sfx("alarm");
          if (CBZ.cityCrime) { try { CBZ.cityCrime(200, { x: t.x, z: t.z, type: "planting-explosives" }); } catch (e) {} }
        },
      }],
    });
    if (I.describe) I.describe("nukeplant", function () {
      return { label: "Nuclear Device", note: "Set it down, start the clock, be somewhere else" };
    });
    I.registerZone({
      id: "nuke-abort", kind: "nukearmed", radius: 3,
      find: function (px, pz) {
        let best = null, bd = 9;
        for (const a of armed) {
          const dx = a.x - px, dz = a.z - pz, d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = a; }
        }
        return best;
      },
      options: [{
        id: "nuke-abort-do", slot: "e",
        label: function (a) { return "Abort the countdown (" + Math.ceil(a.t) + "s)"; },
        onSelect: function (a) {
          const i = armed.indexOf(a);
          if (i < 0) return;
          armed.splice(i, 1);
          if (a.mesh && a.mesh.parent) a.mesh.parent.remove(a.mesh);
          invAdd("Nuclear Device");
          note("Countdown aborted. Your hands are still shaking.", 2.4);
          sfx("clank");
        },
      }],
    });
    if (I.describe) I.describe("nukearmed", function (a) {
      return { label: "ARMED DEVICE", note: Math.ceil(a.t) + " seconds on the clock" };
    });
    _plantWired = true;
  }

  // countdown tick + LED strobe + the last-ten beeps
  CBZ.onUpdate(34.75, function (dt) {
    ensureItems();
    wirePlantZones();
    if (!armed.length) return;
    if (g.mode !== "city") {                          // a mode flip disarms cleanly
      for (const a of armed) if (a.mesh && a.mesh.parent) a.mesh.parent.remove(a.mesh);
      armed.length = 0;
      return;
    }
    for (let i = armed.length - 1; i >= 0; i--) {
      const a = armed[i];
      a.t -= dt;
      const led = a.mesh && a.mesh.userData.led;
      if (led) led.visible = ((a.t * (a.t < 10 ? 6 : 2)) % 1) < 0.5;
      if (a.t <= 10 && Math.ceil(a.t) !== a.beep) {
        a.beep = Math.ceil(a.t);
        sfx("key", { pitch: 1.2 + (10 - a.beep) * 0.06, volume: 0.5 });
      }
      if (a.t <= 0) {
        armed.splice(i, 1);
        if (a.mesh && a.mesh.parent) a.mesh.parent.remove(a.mesh);
        nukeDetonate(a.x, a.z);
      }
    }
  });

  /* ==========================================================================
     6) INPUT + TOUCH SEAM + PREWARM
  ========================================================================== */
  addEventListener("keydown", function (e) {
    if (e.repeat || e.defaultPrevented) return;       // C4's capture handler may own B
    const k = (e.key || "").toLowerCase();
    if (k !== "b" && k !== "x") return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!g || g.mode !== "city" || g.state !== "playing" || CBZ.cityMenuOpen) return;
    if (!flyingB2()) return;                          // only the B-2 owns these keys
    e.preventDefault();
    if (k === "b") dropPayload();
    else cyclePayload();
  });
  // the touch layer (touch_vehicle.js agent) wires these to pills/buttons
  CBZ.strategicBombDrop = dropPayload;
  CBZ.strategicPayloadCycle = cyclePayload;
  CBZ.strategicState = function () {
    const c = flyingB2();
    return {
      b2: !!c, payload,
      bombs: c ? (c.bombAmmo | 0) : 0,
      busters: invCount("Bunker Buster"),
      nukes: invCount("Nuclear Device"),
      armed: armed.length,
      nukeActive: !!nk,
    };
  };

  // ---- PREWARM PARK: every lazy material this file spawns mid-fight (cloud,
  // bombs, device) sits invisible in the scene from load, so core/fxwarm's
  // renderer.compile(scene, camera) builds their programs on the play-start
  // beat instead of a mid-apocalypse freeze (the fxwarm doctrine).
  let _warmed = false;
  CBZ.onAlways(1.1, function () {
    if (_warmed || !CBZ.scene) return;
    _warmed = true;
    try {
      const park = new THREE.Group();
      park.name = "strategic-fx-prewarm";
      park.visible = false;
      const M = cloudMats();
      const a = new THREE.Mesh(bg(0.1, 0.1, 0.1), M.fire);
      const b = new THREE.Mesh(bg(0.1, 0.1, 0.1), M.smoke);
      const c = new THREE.Mesh(bg(0.1, 0.1, 0.1), M.ash);
      park.add(a); park.add(b); park.add(c);
      park.add(bombMesh("bomb")); park.add(bombMesh("buster")); park.add(deviceMesh());
      park.position.set(0, -400, 0);
      CBZ.scene.add(park);
    } catch (e) {}
  });
})();
