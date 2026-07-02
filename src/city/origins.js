/* ============================================================
   city/origins.js — CHARACTER ORIGINS: 3 opening scenes for CITY mode.

   On the title screen (index.html #originSelect, wired in systems/state.js)
   the player picks ONE of three starting characters before hitting Play:

     • THE EXEC     — top-floor office suit, millions on the books. A few
                       seconds into the run, police (incl. SWAT) storm the
                       floor and arrest him for securities fraud — every
                       dollar wiped, then off to the jail (escape) game.
     • THE BARFLY    — starts getting bounced out of a small-town bar by
                       the doorman: a shove, a tumble, a screen shake, and
                       he's in the gutter $45 to his name and $350 in debt.
     • THE TENANT    — a wife-beater, a twin air mattress on a bare floor,
                       one of a thousand identical units in a residential
                       tower, $12 cash and a pistol under the mattress.

   Each origin reuses the jail-mode-style cinematic intro (systems/camera.js
   CBZ.startIntro) — front reveal -> 180 deg orbit -> first-person push-in —
   then hands control to the player for a short scripted beat (the raid /
   the toss) driven by our own onUpdate tick, fully independent of the
   police/ped AI so it can't be derailed by the normal simulation.

   CONTRACTS EXPOSED:
     CBZ.cityOriginApply(game)      -> { introActive } — called by
       city/mode.js's reset(), AFTER the default spawn/camera block. Applies
       the picked origin's starting stats/position/scene ONLY the first time
       a character is ever started (or immediately after a fresh reset from
       picking a different origin than the saved character); on every later
       boot it's a no-op (default rooftop spawn stands, no cinematic).
     CBZ.cityOriginIntroActive()    -> bool, valid immediately after the
       cityOriginApply() call above — systems/state.js reads it to decide
       whether to arm first-person-after-intro for this run.
     CBZ.cityOriginIntroOpts()      -> null | {compact:true, ...} — passed
       straight through to CBZ.startIntro(opts) so the two INDOOR origins
       (exec office, tenant apartment) get the close establishing shot
       instead of the default huge outdoor pull-back.

   PERSISTENCE: the ledger object returned by CBZ.cityWorldEnsure() (city/
   worldstate.js) already round-trips to localStorage as opaque JSON via its
   existing commit()/save() — any extra field we set directly on that same
   object (w.origin, w.originPlayed) rides along for free. No wrap of
   cityWorldCommit/cityWorldBeginRun is needed (unlike bank.js's loan ledger,
   which mirrors a SEPARATE g.* field into the ledger every commit — we don't
   have that problem since we read/write the ledger object directly).

   Every cross-module read is guarded (CBZ.x && CBZ.x()) so this file never
   throws if a sibling system hasn't loaded / isn't present.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  const IDS = { exec: 1, barfly: 1, tenant: 1 };
  function normOrigin(id) { return IDS[id] ? id : "tenant"; }
  CBZ.cityOriginNormalize = normOrigin;

  // ---- active scripted-scene state (one at a time) --------------------------
  let scene = null;
  let introActiveFlag = false;
  let introOptsCache = null;

  function clearScene() {
    if (scene && scene.cleanup) { try { scene.cleanup(); } catch (e) {} }
    scene = null;
  }

  function arena() { return CBZ.city && CBZ.city.arena; }

  // dispose a one-off scripted actor's rig (mirrors police.js clearCityCops'
  // disposal loop) — used for both the raid cops and the bouncer once their
  // scene beat is done, since neither is ever added to the normal AI arrays.
  function despawnActor(a) {
    if (!a || !a.group) return;
    if (a.group.parent) a.group.parent.remove(a.group);
    a.group.traverse(function (o) {
      if (o.isSprite) return;
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
      if (o.material) {
        const m = o.material;
        if (Array.isArray(m)) m.forEach(function (x) { if (x && !x._shared && x.dispose) try { x.dispose(); } catch (e) {} });
        else if (m && !m._shared && m.dispose) try { m.dispose(); } catch (e) {}
      }
    });
  }

  // spawn a cop via the shared police rig, lift it to an arbitrary floor Y,
  // then IMMEDIATELY pull it out of CBZ.cityCops — the live police AI
  // (city/police.js onUpdate 35/40) would otherwise instantly re-target /
  // re-ground it (cops normally live at y=0 and hunt off g.wanted, which is
  // 0 during this scene). We drive position/animation ourselves every frame
  // and dispose the rig by hand when the scene ends.
  function scriptedCop(x, z, y, swat) {
    if (!CBZ.citySpawnCop) return null;
    const c = CBZ.citySpawnCop(x, z, !!swat);
    if (!c) return null;
    c.pos.y = y || 0;
    const cops = CBZ.cityCops;
    const idx = cops ? cops.indexOf(c) : -1;
    if (idx >= 0) cops.splice(idx, 1);
    c.hp = 999999; c.dead = false; c._scripted = true;
    return c;
  }
  function stepScriptedTo(c, floorY, tx, tz, spd, dt) {
    const dx = tx - c.pos.x, dz = tz - c.pos.z, gd = Math.hypot(dx, dz) || 1e-4;
    c.pos.x += (dx / gd) * spd * dt;
    c.pos.z += (dz / gd) * spd * dt;
    c.pos.y = floorY;
    const targetYaw = Math.atan2(dx, dz);
    c.group.rotation.y = CBZ.lerpAngle ? CBZ.lerpAngle(c.group.rotation.y, targetYaw, Math.min(1, dt * 8)) : targetYaw;
    if (CBZ.animChar) CBZ.animChar(c.char, spd, dt);
    return gd;
  }

  // ---- lot finders ------------------------------------------------------
  function findOfficeLot() {
    const A = arena(); if (!A || !A.lots) return null;
    let best = null, bestS = -1;
    for (const lot of A.lots) {
      if (!lot || lot.kind !== "office" || !lot.building) continue;
      const st = lot.building.storeys || 0;
      if (st > bestS) { bestS = st; best = lot; }
    }
    return best;
  }
  const TOWN_IDS = { goldspire: 1, capeharbor: 1, neonreef: 1, foundry: 1 };
  function findBarLot() {
    const A = arena(); if (!A || !A.lots) return null;
    let town = null, any = null;
    for (const lot of A.lots) {
      if (!lot || lot.kind !== "bar" || !lot.building || !lot.building.door) continue;
      if (!any) any = lot;
      if (lot.district && TOWN_IDS[lot.district]) { town = lot; break; }
    }
    return town || any;
  }
  function findTenantTower() {
    const A = arena(); if (!A) return null;
    const pool = A.homeLots || A.lots;
    if (!pool) return null;
    let best = null, bestS = -1;
    for (const lot of pool) {
      if (!lot || lot.kind !== "tower" || !lot.building || !lot.building.home) continue;
      const st = lot.building.storeys || 0;
      if (st > bestS) { bestS = st; best = lot; }
    }
    return best;
  }

  // a low, slightly puffy twin air mattress + rumpled sheet + pillow — simple
  // additive scene geometry (props.js pattern: cheap cached MeshLambert boxes,
  // never disposed, matches the rest of the city's static-decor style).
  function buildAirMattress(root, x, y, z, rotY) {
    const THREE = window.THREE;
    if (!THREE || !root) return;
    const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    grp.rotation.y = rotY || 0;
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.25, 0.95), cmat(0xd9cfb6));
    base.position.y = 0.125; base.castShadow = false; base.receiveShadow = true;
    grp.add(base);
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.08, 0.84), cmat(0x8fa6bd));
    sheet.position.set(0.02, 0.25 + 0.04, 0.02);
    grp.add(sheet);
    const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.36), cmat(0xefe8d6));
    pillow.position.set(-1.9 / 2 + 0.34, 0.25 + 0.08 + 0.06, 0);
    grp.add(pillow);
    root.add(grp);
    return grp;
  }

  // ---------------------------------------------------------------
  // EXEC — top-floor office, millions on the books, busted for fraud
  // ---------------------------------------------------------------
  function applyExec(game) {
    const lot = findOfficeLot();
    if (!lot || !lot.building) return null;
    const b = lot.building;
    const FH = b.FH || 4.6;
    const storeys = b.storeys || 1;
    const floorY = (b.floorTops && b.floorTops[storeys - 1] != null) ? b.floorTops[storeys - 1] : (storeys - 1) * FH;
    const w = b.w || (lot.w || 24), d = b.d || (lot.d || 24);
    const door = b.door || { x: lot.cx, z: lot.cz + d / 2, nx: 0, nz: 1 };
    const half = Math.max(4, Math.min(w, d) / 2 - 3);
    const entry = { x: lot.cx - door.nx * half, z: lot.cz - door.nz * half };
    const spot = { x: lot.cx + door.nx * half, z: lot.cz + door.nz * half };

    const P = CBZ.player;
    P.pos.set(spot.x, floorY, spot.z); P.vy = 0; P.grounded = true;
    const facing = Math.atan2(entry.x - spot.x, entry.z - spot.z);
    if (CBZ.playerChar) { CBZ.playerChar.group.position.copy(P.pos); CBZ.playerChar.group.rotation.set(0, facing, 0); }
    if (CBZ.cam) { CBZ.cam.yaw = facing + Math.PI; CBZ.cam.pitch = 0.32; }

    game.cash = 2000000; game.cityBank = 8000000;
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    if (CBZ.cityWearOutfit) CBZ.cityWearOutfit("suit", { silent: true });
    if (CBZ.city) CBZ.city.note("💼 Marcus Sterling. Top floor. On paper, worth more than the building.", 3);

    scene = {
      kind: "exec", t: 0, phase: "wait", cops: [], floorY, entry,
      cleanup: function () { for (const c of this.cops) despawnActor(c); this.cops.length = 0; },
    };
    return { compact: true };
  }

  function fireExecBust() {
    g.cash = 0; g.cityBank = 0;
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    if (CBZ.city) CBZ.city.note("🚨 Federal accounts frozen pending investigation.", 2.6, { urgent: true });
    if (CBZ.cityBust) {
      CBZ.cityBust({ peaceful: true, bigLabel: "BUSTED — SECURITIES FRAUD", note: "Accounts frozen. Every dollar, gone." });
    }
    clearScene();
  }

  function tickExec(dt) {
    const s = scene;
    s.t += dt;
    if (s.phase === "wait") {
      if (s.t < 7) return;
      s.phase = "raid"; s.t = 0;
      const swatCount = 1, extra = 1 + (Math.random() < 0.6 ? 1 : 0);
      for (let i = 0; i < swatCount + extra; i++) {
        const jx = (Math.random() - 0.5) * 3, jz = (Math.random() - 0.5) * 3;
        const c = scriptedCop(s.entry.x + jx, s.entry.z + jz, s.floorY, i === 0);
        if (c) s.cops.push(c);
      }
      if (CBZ.city) CBZ.city.big("👮 POLICE! DON'T MOVE!");
      return;
    }
    if (s.phase === "raid") {
      const P = CBZ.player;
      let minD = 1e9;
      for (const c of s.cops) {
        if (!c) continue;
        const gd = stepScriptedTo(c, s.floorY, P.pos.x, P.pos.z, 3.8, dt);
        if (gd < minD) minD = gd;
      }
      if (s.t > 0.6 && (minD <= 2.2 || s.t >= 6)) { s.phase = "bust"; fireExecBust(); }
    }
  }

  // ---------------------------------------------------------------
  // BARFLY — thrown out of a small-town bar, broke and in debt
  // ---------------------------------------------------------------
  function applyBarfly(game) {
    const A = arena();
    const lot = findBarLot();
    let doorX, doorZ, nx = 0, nz = 1;
    if (lot && lot.building && lot.building.door) {
      const door = lot.building.door;
      doorX = door.x; doorZ = door.z; nx = door.nx; nz = door.nz;
    } else if (A && A.spawn) {
      doorX = A.spawn.x; doorZ = A.spawn.z - 2; nx = 0; nz = 1;
    } else return null;
    const px = doorX + nx * 1.3, pz = doorZ + nz * 1.3;
    const gy = CBZ.floorAt ? CBZ.floorAt(px, pz) : 0;

    const P = CBZ.player;
    P.pos.set(px, gy, pz); P.vy = 0; P.grounded = true;
    const facing = Math.atan2(doorX - px, doorZ - pz);
    if (CBZ.playerChar) { CBZ.playerChar.group.position.copy(P.pos); CBZ.playerChar.group.rotation.set(0, facing, 0); }
    if (CBZ.cam) { CBZ.cam.yaw = facing + Math.PI; CBZ.cam.pitch = 0.3; }

    game.cash = 45; game.cityDebt = 350;
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    if (CBZ.cityDrink) { try { CBZ.cityDrink(2.5); } catch (e) {} }
    if (CBZ.city) CBZ.city.note("🍺 Last call came early tonight.", 2.6);

    let bouncer = null;
    if (CBZ.cityMakePed && CBZ.cityPeds && A && A.root) {
      bouncer = CBZ.cityMakePed(doorX, doorZ, Math.random, {
        name: "Bouncer", kind: "civilian", wealth: 0.6, archetype: "merchant",
        job: "doorman", aggr: 0.7, hp: 220, armed: false,
      });
      if (bouncer) {
        bouncer.controlled = true; bouncer._scripted = true;
        bouncer.pos.y = gy;
        bouncer.group.rotation.y = Math.atan2(px - doorX, pz - doorZ);
        bouncer.state = "idle"; bouncer.speed = 0;
        A.root.add(bouncer.group);
        CBZ.cityPeds.push(bouncer);
      }
    }

    scene = {
      kind: "barfly", t: 0, phase: "stand", bouncer, nx, nz,
      cleanup: function () {
        if (this.bouncer) {
          const peds = CBZ.cityPeds;
          const idx = peds ? peds.indexOf(this.bouncer) : -1;
          if (idx >= 0) peds.splice(idx, 1);
          despawnActor(this.bouncer);
        }
      },
    };
    return { compact: false };
  }

  function tickBarfly(dt) {
    const s = scene;
    s.t += dt;
    if (s.phase === "stand") {
      if (s.t < 2.2) return;
      s.phase = "toss";
      const P = CBZ.player;
      P._phys = P._phys || {};
      const FORCE = 8.5;
      P._phys.kx = (P._phys.kx || 0) + s.nx * FORCE;
      P._phys.kz = (P._phys.kz || 0) + s.nz * FORCE;
      P.vy = Math.max(P.vy || 0, 3.2);
      P.grounded = false;
      if (CBZ.shake) CBZ.shake(0.5);
      if (CBZ.city) { CBZ.city.big("“AND STAY OUT!”"); CBZ.city.note("Tossed out on your ass — $45 and a bar tab you'll never pay off.", 3); }
      if (s.bouncer && s.bouncer.group) s.bouncer.group.rotation.y = Math.atan2(-s.nx, -s.nz);
      return;
    }
    if (s.phase === "toss" && s.t >= 4.0) { s.phase = "done"; clearScene(); }
  }

  // ---------------------------------------------------------------
  // TENANT — a wife-beater, a twin air mattress, $12 and a pistol
  // ---------------------------------------------------------------
  function applyTenant(game) {
    const A = arena();
    const lot = findTenantTower();
    let px, pz, floorY;
    if (lot && lot.building) {
      const units = CBZ.cityFloorUnits ? CBZ.cityFloorUnits(lot) : [];
      let unit = null;
      for (const u of units) { if (u && u.tier === 0) { unit = u; break; } }
      if (!unit && units.length) unit = units[0];
      floorY = unit ? unit.floorY : 0.14;
      px = lot.cx; pz = lot.cz;
    } else if (A && A.spawn) {
      px = A.spawn.x; pz = A.spawn.z; floorY = 0.14;
    } else return null;

    const mx = px - 1.6, mz = pz - 0.3;
    const P = CBZ.player;
    P.pos.set(px, floorY, pz); P.vy = 0; P.grounded = true;
    const facing = Math.atan2(mx - px, mz - pz);
    if (CBZ.playerChar) { CBZ.playerChar.group.position.copy(P.pos); CBZ.playerChar.group.rotation.set(0, facing, 0); }
    if (CBZ.cam) { CBZ.cam.yaw = facing + Math.PI; CBZ.cam.pitch = 0.34; }

    game.cash = 12; game.cityBank = 0;
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();

    const cat = CBZ.cityOutfitCatalog ? CBZ.cityOutfitCatalog() : null;
    const outfitId = (cat && cat.wifebeater) ? "wifebeater" : "street";
    if (CBZ.cityWearOutfit) CBZ.cityWearOutfit(outfitId, { silent: true });

    if (CBZ.cityGiveWeapon) CBZ.cityGiveWeapon("Pistol");
    else if (CBZ.unlockWeapon) CBZ.unlockWeapon("sidearm", { select: true });

    if (A && A.root) buildAirMattress(A.root, mx, floorY, mz, facing + Math.PI);
    if (CBZ.city) CBZ.city.note("🔫 One room, one mattress, one way out.", 2.8);

    scene = null;   // static dressing only — no ongoing scripted beat
    return { compact: true };
  }

  // ---------------------------------------------------------------
  // dispatch + public contract
  // ---------------------------------------------------------------
  function applyOrigin(id, game) {
    try {
      if (id === "exec") return applyExec(game);
      if (id === "barfly") return applyBarfly(game);
      return applyTenant(game);
    } catch (e) {
      try { console.error("[city origin] apply failed:", id, e); } catch (e2) {}
      return null;
    }
  }

  CBZ.cityOriginApply = function (game) {
    introActiveFlag = false; introOptsCache = null;
    clearScene();
    try {
      if (!CBZ.cityWorldEnsure) return { introActive: false };
      let w = CBZ.cityWorldEnsure();
      const selected = normOrigin(game.cityOrigin);
      if (w.origin && w.origin !== selected && CBZ.cityWorldReset) {
        CBZ.cityWorldReset();
        w = CBZ.cityWorldEnsure();
      }
      if (!w.originPlayed) {
        const opts = applyOrigin(selected, game);
        if (opts) {
          w.origin = selected;
          w.originPlayed = true;
          if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
          introActiveFlag = true;
          introOptsCache = opts.compact ? opts : null;
        }
      }
    } catch (e) { try { console.error("[city origin] apply:", e); } catch (e2) {} }
    return { introActive: introActiveFlag };
  };
  CBZ.cityOriginIntroActive = function () { return !!introActiveFlag; };
  CBZ.cityOriginIntroOpts = function () { return introOptsCache; };

  // ---- per-frame scripted-scene tick (priority 37: after the wanted decay
  //      tick @33 and scenedirector @36.2, before police maintain/move @35/40
  //      — irrelevant here since our raid cops are deliberately spliced OUT
  //      of CBZ.cityCops so the live police AI never touches them). ----
  CBZ.onUpdate(37, function (dt) {
    if (!scene) return;
    if (g.mode !== "city") { clearScene(); return; }
    if (g.state !== "playing") return;
    if (scene.kind === "exec") tickExec(dt);
    else if (scene.kind === "barfly") tickBarfly(dt);
  });
})();
