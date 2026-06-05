/* ============================================================
   city/death.js — cinematic WASTED deaths + hospital respawn, and the
   BUSTED → jail fade.

   The city is third-person already, so a death plays out in full view:
   a spinning ragdoll fling (physics.js integrates player._death in any
   non-escape mode), a hard shake, slow-mo, a blood burst, and a big
   WASTED title. A few seconds later you respawn at the nearest hospital
   (lighter wallet, lower heat) — the run continues, GTA-style.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;

  let overlay = null, titleEl = null, subEl = null;
  let respawnT = 0, dying = false, wastedT = 0, pendingWasted = null;

  function buildOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "cityWasted";
    overlay.style.cssText = "position:fixed;inset:0;z-index:55;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;pointer-events:none;font-family:Fredoka,system-ui,sans-serif;text-align:center;background:radial-gradient(ellipse at 50% 50%,rgba(40,0,0,0) 30%,rgba(20,0,0,.75) 100%)";
    titleEl = document.createElement("div");
    titleEl.style.cssText = "font-size:clamp(54px,12vw,140px);font-weight:700;letter-spacing:4px;color:#c9202a;text-shadow:0 6px 0 #5e070b,0 10px 26px rgba(0,0,0,.6);opacity:0;transition:opacity 1s ease,transform 1s ease;transform:scale(1.25)";
    subEl = document.createElement("div");
    subEl.style.cssText = "font-size:clamp(22px,3.4vw,34px);font-weight:600;letter-spacing:1px;text-shadow:0 3px 0 rgba(0,0,0,.45),0 4px 14px rgba(0,0,0,.55);opacity:0;transition:opacity 1.1s ease .4s";
    overlay.appendChild(titleEl); overlay.appendChild(subEl);
    document.body.appendChild(overlay);
  }
  function showOverlay(big, sub, color) {
    buildOverlay();
    titleEl.textContent = big; titleEl.style.color = color || "#c9202a";
    subEl.textContent = sub || ""; subEl.style.color = color || "#c9202a";
    overlay.style.display = "flex";
    void overlay.offsetWidth;
    titleEl.style.opacity = "1"; titleEl.style.transform = "scale(1)";
    subEl.style.opacity = "1";
  }
  function hideOverlay() {
    if (!overlay) return;
    overlay.style.display = "none";
    titleEl.style.opacity = "0"; titleEl.style.transform = "scale(1.25)"; subEl.style.opacity = "0";
  }

  CBZ.cityDeathReset = function () { dying = false; respawnT = 0; wastedT = 0; pendingWasted = null; hideOverlay(); if (CBZ.cityCam) CBZ.cityCam.death = null; };

  // a red damage flash (the engine never defined CBZ.hitFlash) — drives the
  // existing #hitfx overlay so getting shot reads dramatically.
  let hitEl = null;
  if (!CBZ.hitFlash) CBZ.hitFlash = function () {
    if (!hitEl) { hitEl = document.getElementById("hitfx") || document.getElementById("vignette"); }
    if (!hitEl) return;
    hitEl.style.transition = "none"; hitEl.style.boxShadow = "inset 0 0 160px 40px rgba(200,20,20,.6)"; hitEl.style.opacity = "1";
    void hitEl.offsetWidth;
    hitEl.style.transition = "opacity .45s ease, box-shadow .45s ease";
    hitEl.style.opacity = "0";
  };

  // ---- central player damage: armoured, survivable, with out-of-combat
  //      regen so a gunfight is a back-and-forth, not an instant death.
  //      The CITY player is tougher than an NPC: incoming damage is scaled
  //      down, and a headshot is brutal but SURVIVABLE from full health
  //      (it one-shots NPCs, not you), so a firefight is winnable. ----
  const CITY_DR = 0.6;           // fraction of incoming damage the player actually takes
  const HEADSHOT_FRAC = 0.6;     // a headshot deals up to 60% of max HP (not an instakill)

  CBZ.cityHurtPlayer = function (dmg, fromX, fromZ, reason, headshot, attacker, nonlethal) {
    const P = CBZ.player;
    if (P.dead || (g.invuln || 0) > 0) return;
    if (attacker) { g._cityKiller = attacker; g._cityKillerT = CBZ.now || 0; }
    if (headshot) dmg = Math.max(dmg, (P.maxHp || 200) * HEADSHOT_FRAC);
    dmg *= CITY_DR;
    // Bumps and medium-speed traffic impacts can hurt badly, but should not
    // turn a scrape into a WASTED screen. Truly catastrophic hits opt out.
    if (nonlethal) dmg = Math.min(dmg, Math.max(0, P.hp - 1));
    if (P._armor > 0) { const a = Math.min(P._armor, dmg * (headshot ? 0.45 : 0.7)); P._armor -= a; dmg -= a; }
    P.hp -= dmg;
    P._hurtT = 3.5;                     // pause regen briefly, then it ramps back
    if (CBZ.hitFlash) CBZ.hitFlash();
    if (CBZ.shake) CBZ.shake(Math.min(0.4, 0.12 + dmg * 0.01));
    if (P.hp <= 0) CBZ.cityKillPlayer(reason || "killed", { fromX, fromZ });
  };

  // ---- did an EXPLOSION kill us? (car blast / airstrike / missile) ----
  // All player blast damage in crashfx.js routes through ONE path with the
  // reason "caught in an explosion"; airstrikes/missiles share it. Match that
  // plus any obvious blast wording so the cinematic fires on every boom.
  function isExplosionCause(reason) {
    if (!reason) return false;
    const r = ("" + reason).toLowerCase();
    return r.indexOf("explos") >= 0 || r.indexOf("blast") >= 0 ||
           r.indexOf("airstrike") >= 0 || r.indexOf("missile") >= 0 ||
           r.indexOf("blown up") >= 0;
  }

  // ---- are we under a ROOF (inside a building)? ----
  // Building floor/roof slabs are registered as CBZ.platforms (with `top`) AND
  // as CBZ.losBlockers meshes. Cheap test first: any platform whose footprint
  // covers us and whose top sits above head height = a ceiling overhead. Then a
  // single short up-ray against the LOS meshes as a backstop (covers roofs that
  // only exist as meshes). No per-frame cost — only runs once, on death.
  const _upRay = new THREE.Raycaster();
  const _upOrigin = new THREE.Vector3(), _upDir = new THREE.Vector3(0, 1, 0);
  function isIndoors(px, py, pz) {
    // overhead platform (floor/roof slab above the player)
    const plats = CBZ.platforms;
    if (plats) {
      const headY = py + 1.6;
      for (let i = 0; i < plats.length; i++) {
        const p = plats[i];
        if (p.top == null) continue;
        if (p.top > headY && p.top < py + 28 &&
            px >= p.minX && px <= p.maxX && pz >= p.minZ && pz <= p.maxZ) return true;
      }
    }
    // backstop: short up-ray hits a roof/ceiling LOS mesh
    const blk = CBZ.losBlockers;
    if (blk && blk.length) {
      _upOrigin.set(px, py + 1.5, pz);
      _upRay.set(_upOrigin, _upDir); _upRay.far = 26;
      const hit = _upRay.intersectObjects(blk, false);
      if (hit.length) return true;
    }
    return false;
  }

  // ---- WASTED ----
  CBZ.cityKillPlayer = function (reason, imp) {
    const P = CBZ.player;
    if (P.dead) return;
    P.dead = true; P.hp = 0; dying = true;
    // cinematic third-person replay: orbit the body (camera.js reads cityCam)
    if (CBZ.cityCam) CBZ.cityCam.death = { t: 0, ang0: Math.random() * 6.28 };

    // CINEMATIC EXTERIOR DEATH CAM: killed by an explosion while INSIDE a
    // building → first cut to a street-level shot looking back at the building +
    // the blast, hold a beat, THEN the normal orbit + fade-to-WASTED. Outdoor or
    // non-explosion deaths skip this and keep the stock behaviour.
    let extBeat = 0;
    if (isExplosionCause(reason) && imp && imp.fromX != null &&
        CBZ.cityCam && CBZ.cityCam.death && CBZ.cityCam.beginExteriorDeathCam &&
        isIndoors(P.pos.x, P.pos.y, P.pos.z)) {
      extBeat = 1.5;
      CBZ.cityCam.beginExteriorDeathCam({
        bx: imp.fromX, bz: imp.fromZ, by: P.pos.y + 0.6,
        px: P.pos.x, pz: P.pos.z, dur: extBeat,
      });
    }
    if (CBZ.playerChar) CBZ.playerChar.group.visible = true;
    if (P.driving && CBZ.cityExitVehicle) { CBZ.cityExitVehicle(); }
    // spinning ragdoll fling (physics.js handles player._death in non-escape modes)
    const a = Math.random() * 6.28;
    P._death = {
      vx: Math.cos(a) * (3 + Math.random() * 3), vz: Math.sin(a) * (3 + Math.random() * 3),
      vy: 6 + Math.random() * 3, spin: (Math.random() * 2 - 1) * 7, spin2: (Math.random() * 2 - 1) * 5,
      t: 0, landed: false, seed: Math.random() * 6.28,
    };
    if (P._phys) { P._phys.air = false; P._phys.down = 0; P._phys.kx = P._phys.kz = 0; }
    if (CBZ.shake) CBZ.shake(1.2);
    if (CBZ.sfx) CBZ.sfx("ko");
    if (CBZ.doSlowmo) CBZ.doSlowmo(0.5);
    if (CBZ.gore) {
      let dir = imp && imp.fromX != null ? { x: P.pos.x - imp.fromX, z: P.pos.z - imp.fromZ } : null;
      CBZ.gore(P.pos.x, P.pos.y + 1.0, P.pos.z, { dir, amount: 1.4, player: true });
    }
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    const where = g.citySpawnPoint ? "home" : "the hospital";
    const killer = (g._cityKiller && (CBZ.now || 0) - (g._cityKillerT || 0) < 6) ? g._cityKiller : null;
    const line = killer ? ("Killed by " + killer) : (reason ? ("You were " + reason) : "You died");
    // hold the WASTED title back ~1.8s so the ragdoll fling plays out first, THEN
    // it fades in — no jarring instant pop on the exact frame you die. When the
    // exterior cinematic plays, hold the title until the street shot has done its
    // job (the full beat + a touch of the orbit hand-off) so the reveal lands.
    pendingWasted = line + "  ·  respawning at " + where + "…";
    const titleDelay = extBeat > 0 ? (extBeat + 0.6) : 1.8;
    wastedT = titleDelay;
    g._cityKiller = null;
    respawnT = 4.6 + titleDelay;   // keep the title on screen its full duration after the delay
  };

  function respawn() {
    const P = CBZ.player;
    dying = false; hideOverlay();
    if (CBZ.cityCam) CBZ.cityCam.death = null;          // end the cinematic, back to FP
    // own a home? respawn there for free. Otherwise the ER patches you up for a bill.
    const A = CBZ.city.arena;
    let spot = A.spawn, atHome = false;
    if (g.citySpawnPoint) { spot = g.citySpawnPoint; atHome = true; }
    else if (A.lots) { const h = A.lots.find((l) => l.kind === "hospital" && l.building); if (h) spot = h.building.door; }
    let bill = 0;
    if (!atHome) { bill = Math.min(g.cash || 0, 250 + (g.wanted | 0) * 150); if (bill > 0) g.cash -= bill; }
    g._lastBill = bill;
    if (CBZ.cityWantedReset) CBZ.cityWantedReset();
    if (CBZ.clearCityCops) CBZ.clearCityCops();
    P.pos.set(spot.x, 0, spot.z);
    P.vy = 0; P.grounded = true; P.dead = false; P.maxHp = P.maxHp || 200; P.hp = P.maxHp; P.ko = 0; P.stun = 0; P._hurtT = 0;
    P._death = null; P._armor = Math.max(0, (P._armor || 0));
    g.hunger = Math.max(40, g.hunger || 0);
    if (P._phys) { P._phys.air = false; P._phys.down = 0; P._phys.kx = P._phys.kz = 0; }
    CBZ.playerChar.group.visible = true;
    CBZ.playerChar.group.rotation.set(0, Math.random() * 6.28, 0);
    CBZ.playerChar.group.scale.y = 1;
    CBZ.playerChar.group.position.copy(P.pos);
    g.invuln = 2.5;       // brief grace after the ER
    if (CBZ.cam) CBZ.cam.pitch = 0.4;
    if (CBZ.setFPS) CBZ.setFPS(true);     // back to first-person after the death orbit
    if (CBZ.requestLock) CBZ.requestLock();
    if (CBZ.city) CBZ.city.note(atHome ? "🏡 You wake up at home, patched up." : ("🏥 City Hospital. Bill: $" + (g._lastBill || 0)), 2.4);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  CBZ.onUpdate(13, function (dt) {
    if (g.mode !== "city") return;
    if (g.invuln > 0) g.invuln = Math.max(0, g.invuln - dt);
    if (dying) {
      if (pendingWasted && wastedT > 0) { wastedT -= dt; if (wastedT <= 0) { showOverlay("WASTED", pendingWasted, "#c9202a"); pendingWasted = null; } }
      respawnT -= dt; if (respawnT <= 0) respawn(); return;
    }
    // out-of-combat health regen (GTA-style) so a flesh wound isn't a death
    const P = CBZ.player;
    if (!P.dead) {
      if (P._hurtT > 0) P._hurtT -= dt;
      else if (P.hp < (P.maxHp || 200)) { P.hp = Math.min(P.maxHp || 200, P.hp + 16 * dt); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
    }
  });

  // ---- BUSTED fade (called by city/wanted.js before the jail handoff) ----
  CBZ.cityBustOverlay = function (lost, done) {
    showOverlay("BUSTED", "Cuffed and processed" + (lost > 0 ? "  ·  lost $" + lost : "") + "  ·  off to the cells…", "#5b8bff");
    let t = 0;
    const tick = function () {
      t += 0.05;
      if (t >= 2.6) { hideOverlay(); if (done) done(); return; }
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  };

  // ---- CINEMATIC EXTERIOR DEATH CAM (self-contained fallback) ----
  // The primary home for this is city/camera.js, but if that module isn't loaded
  // we install the exact same exterior-shot plumbing here so the feature still
  // works. systems/camera.js positions the death ORBIT at onAlways(50); this
  // override runs at 51 and, ONLY during the authored exterior beat
  // (CBZ.cityCam.death.ext), takes the camera over — pulling it out to the street
  // and looking back at the building + blast — without clipping into walls, then
  // releases cleanly to the orbit. Guarded so it never double-installs.
  (function installExteriorDeathCam() {
    const cc = CBZ.cityCam = CBZ.cityCam || { fp: false, death: null };
    if (cc._extHookInstalled) return;            // camera.js already owns it
    cc._extHookInstalled = true;

    const camera = CBZ.camera;
    if (!camera) return;
    const _ro = new THREE.Vector3(), _rd = new THREE.Vector3();
    const _eye = new THREE.Vector3(), _look = new THREE.Vector3();
    const ray = new THREE.Raycaster();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const lerp = (a, b, t) => a + (b - a) * t;

    function unclip(ox, oy, oz, px, py, pz) {
      _ro.set(ox, oy, oz);
      _rd.set(px - ox, py - oy, pz - oz);
      let d = _rd.length();
      if (d < 0.001) return null;
      _rd.multiplyScalar(1 / d);
      let best = d;
      ray.set(_ro, _rd); ray.far = d;
      const blk = CBZ.losBlockers;
      if (blk && blk.length) { const hit = ray.intersectObjects(blk, false); if (hit.length && hit[0].distance < best) best = hit[0].distance; }
      const rad = 0.34, cs = CBZ.colliders;
      if (cs) {
        for (let i = 0; i < cs.length; i++) {
          const c = cs[i]; if (c.noCam) continue;
          const minX = c.minX - rad, maxX = c.maxX + rad, minZ = c.minZ - rad, maxZ = c.maxZ + rad;
          const minY = (c.y0 != null ? c.y0 : -1e4) - rad, maxY = (c.y1 != null ? c.y1 : 1e4) + rad;
          let t0 = 0, t1 = best, ta, tb, tmp; const dx = _rd.x, dy = _rd.y, dz = _rd.z;
          if (dx > -1e-8 && dx < 1e-8) { if (ox < minX || ox > maxX) continue; }
          else { ta = (minX - ox) / dx; tb = (maxX - ox) / dx; if (ta > tb) { tmp = ta; ta = tb; tb = tmp; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
          if (dy > -1e-8 && dy < 1e-8) { if (oy < minY || oy > maxY) continue; }
          else { ta = (minY - oy) / dy; tb = (maxY - oy) / dy; if (ta > tb) { tmp = ta; ta = tb; tb = tmp; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
          if (dz > -1e-8 && dz < 1e-8) { if (oz < minZ || oz > maxZ) continue; }
          else { ta = (minZ - oz) / dz; tb = (maxZ - oz) / dz; if (ta > tb) { tmp = ta; ta = tb; tb = tmp; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
          if (t0 > 0.001 && t0 < best) best = t0;
        }
      }
      if (best < d) { const dd = Math.max(2.0, best - 0.4); _eye.set(ox + _rd.x * dd, oy + _rd.y * dd, oz + _rd.z * dd); return _eye; }
      _eye.set(px, py, pz); return _eye;
    }

    function resolveLot(x, z) {
      const A = CBZ.city && CBZ.city.arena;
      if (!A || !A.lots) return null;
      let best = null, bestD = 1e9;
      for (let i = 0; i < A.lots.length; i++) {
        const l = A.lots[i]; if (!l || !l.building) continue;
        const hw = (l.w || 8) / 2 + 1.5, hd = (l.d || 8) / 2 + 1.5;
        if (Math.abs(x - l.cx) <= hw && Math.abs(z - l.cz) <= hd) return l;
        const dx = x - l.cx, dz = z - l.cz, dd = dx * dx + dz * dz;
        if (dd < bestD) { bestD = dd; best = l; }
      }
      return bestD < 36 * 36 ? best : null;
    }

    cc.beginExteriorDeathCam = function (opts) {
      if (!cc.death) return;
      opts = opts || {};
      const bx = opts.bx != null ? opts.bx : (opts.px || 0);
      const bz = opts.bz != null ? opts.bz : (opts.pz || 0);
      const px = opts.px != null ? opts.px : bx;
      const pz = opts.pz != null ? opts.pz : bz;
      const by = opts.by != null ? opts.by : 1.4;
      let nx = 0, nz = 0;
      const lot = resolveLot(px, pz);
      if (lot && lot.building && lot.building.door && lot.building.door.nx != null) { nx = lot.building.door.nx; nz = lot.building.door.nz; }
      if (nx === 0 && nz === 0) {
        const A = CBZ.city && CBZ.city.arena;
        const ccx = (A && A.cx != null) ? A.cx : 0, ccz = (A && A.cz != null) ? A.cz : 0;
        nx = px - ccx; nz = pz - ccz; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      }
      const out = 13.5, side = 5.5, height = 3.4;
      const sx = -nz, sz = nx;
      const camX = bx + nx * out + sx * side, camZ = bz + nz * out + sz * side;
      cc.death.ext = {
        px: camX, py: height, pz: camZ,
        lx: bx, ly: by + 1.2, lz: bz,
        ox: bx, oy: by + 1.0, oz: bz,
        t: 0, dur: opts.dur != null ? opts.dur : 1.4, fov: 44, _bx: null,
      };
      cc.death.ang0 = Math.atan2(camZ - bz, camX - bx);
    };

    CBZ.onAlways(51, function (dt) {
      if (g.mode !== "city") return;
      if (!cc.death || !cc.death.ext) return;
      const ex = cc.death.ext;
      ex.t = (ex.t || 0) + dt;
      if (ex.t >= ex.dur) { cc.death.ext = null; return; }
      const clamped = unclip(ex.ox, ex.oy, ex.oz, ex.px, ex.py, ex.pz);
      let cx = ex.px, cy = ex.py, cz = ex.pz;
      if (clamped) { cx = clamped.x; cy = clamped.y; cz = clamped.z; }
      cy = Math.max(cy, 0.9);
      const k = easeOut(Math.min(1, ex.t / 0.45));
      const creep = Math.min(1, ex.t / ex.dur) * 0.6;
      _eye.set(lerp(cx, ex.ox, creep * 0.06), cy, lerp(cz, ex.oz, creep * 0.06));
      if (ex._bx == null) { ex._bx = camera.position.x; ex._by = camera.position.y; ex._bz = camera.position.z; }
      camera.position.set(lerp(ex._bx, _eye.x, k), lerp(ex._by, _eye.y, k), lerp(ex._bz, _eye.z, k));
      _look.set(ex.lx, ex.ly, ex.lz);
      camera.lookAt(_look);
      const wantFov = ex.fov || 46;
      if (Math.abs(camera.fov - wantFov) > 0.02) { camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 4.5); camera.updateProjectionMatrix(); }
    });
  })();
})();
