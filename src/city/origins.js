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
       city/mode.js's reset(), AFTER the default spawn/camera block. Plays a
       character's origin scene ONLY the first time THAT character is ever
       started; afterwards it resumes them (their own ledger + last position).
       Picking / switching to a different character is a GTA5-style swap via
       the CHARACTER VAULT below — never a reset of anyone.
     CBZ.citySwitchLedger(id)       -> bool — park the active character's
       ledger, activate `id`'s (or mint it fresh). The [U] wheel + the title
       picker both route through this; caller restarts the run.
     CBZ.cityOriginIntroActive()    -> bool, valid immediately after the
       cityOriginApply() call above — systems/state.js reads it to decide
       whether to arm first-person-after-intro for this run.
     CBZ.cityOriginIntroOpts()      -> null | {compact:true, ...} — passed
       straight through to CBZ.startIntro(opts) so the two INDOOR origins
       (exec office, tenant apartment) get the close establishing shot
       instead of the default huge outdoor pull-back.

   PERSISTENCE: the ledger object returned by CBZ.cityWorldEnsure() (city/
   worldstate.js) round-trips to localStorage as opaque JSON via its existing
   commit()/save() — extra fields set directly on it (w.origin,
   w.originPlayed, w.lastPos, w.spawnPoint) ride along for free. THREE such
   ledgers exist — one per character (see THE CHARACTER VAULT below): the
   active one lives in worldstate's own CBZ_CITY_WORLD_V2 key, the parked
   ones in CBZ_CITY_CHARS_V1. cityWorldCommit/BeginRun ARE wrapped (the
   bank.js pattern) — but only to piggyback the live position + home-spawn
   per character, not to change how the ledger itself saves.

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

  // ---- boot-time ledger peek --------------------------------------------
  // Read the saved world ledger ONCE at script load, BEFORE any run starts:
  //   • a save WITH an origin on record syncs the title-screen picker to it,
  //     so a returning player who never touches the picker can't be misread
  //     as "picked a different origin" (which would reset their character);
  //   • a PRE-ORIGIN save (a real character from before this feature — no
  //     originPlayed stamp but visible progress) must NEVER be wiped or have
  //     an intro scene played over its money/state: it's adopted silently on
  //     the first cityOriginApply instead. A stale do-nothing ledger (fresh
  //     startCash, nothing logged, nothing owned) is NOT protected — that
  //     player never really began, so they get the full opening scene.
  let legacyLedger = false;
  (function peekLedger() {
    let raw = null;
    try { raw = localStorage.getItem("CBZ_CITY_WORLD_V2"); } catch (e) { return; }
    if (!raw) return;
    let p = null;
    try { p = JSON.parse(raw); } catch (e) { return; }
    if (!p || p.version !== 2) return;
    if (p.originPlayed && IDS[p.origin]) {
      if (CBZ.game) CBZ.game.cityOrigin = p.origin;
      if (CBZ.setCityOrigin) CBZ.setCityOrigin(p.origin);   // picker sync only — no "picked" intent
      return;
    }
    const startCash = (CBZ.CITY && CBZ.CITY.econ && CBZ.CITY.econ.startCash) || 30;
    const progressed =
      (p.activityLog && p.activityLog.length > 0) ||
      (p.weapons && p.weapons.length > 0) ||
      (p.bank || 0) > 0 || (p.debt || 0) > 0 || (p.respect || 0) > 0 ||
      (p.cash != null && Math.round(p.cash) !== startCash) ||
      (p.criminalRecord && ((p.criminalRecord.arrests || 0) > 0 || (p.criminalRecord.charges || []).length > 0)) ||
      (p.assets && Object.keys(p.assets).length > 0);
    if (progressed) legacyLedger = true;
  })();

  // ========================================================================
  // THE CHARACTER VAULT — GTA5-style three-protagonist persistence.
  //
  // Each character owns a FULL world ledger (cash, bank, debt, weapons,
  // outfit, loans, record, home, last position). The ACTIVE character's
  // ledger lives exactly where it always has — worldstate.js's
  // CBZ_CITY_WORLD_V2 key — so every existing system (bank, pawnshop,
  // autosave, multiplayer collect) keeps working untouched. The two
  // INACTIVE characters are parked, as complete ledger snapshots, in
  // CBZ_CITY_CHARS_V1 = { active, chars: { id: ledger } }.
  //
  // Switching (title-screen pick OR the in-game [U] wheel) is a swap, NEVER
  // a wipe: commit + park the outgoing ledger, pull the incoming one into
  // the main key (or mint a fresh one → that character's origin intro
  // plays), and carry the SHARED WORLD (economy / politics / world clock)
  // across so the city itself is one continuous place no matter who's
  // holding the controller.
  // ========================================================================
  const MAIN_KEY = "CBZ_CITY_WORLD_V2";
  const VAULT_KEY = "CBZ_CITY_CHARS_V1";
  const SHARED_KEYS = ["world", "economy", "politics"];   // the city, not the character
  let pendingShared = null;                 // shared-world payload for a not-yet-minted fresh ledger
  const liveSession = {};                   // ids vaulted THIS session — their exact lastPos.y is trustworthy

  function loadVault() {
    try {
      const raw = localStorage.getItem(VAULT_KEY);
      if (raw) { const v = JSON.parse(raw); if (v && v.chars) return v; }
    } catch (e) {}
    return { active: null, chars: {} };
  }
  function saveVault(v) {
    try { localStorage.setItem(VAULT_KEY, JSON.stringify(v)); } catch (e) {}
  }
  function carryShared(from, to) {
    if (!from || !to) return;
    for (const k of SHARED_KEYS) if (from[k] != null) to[k] = from[k];
  }

  // Swap the persisted ledgers so `id` becomes the active character. Pure
  // ledger bookkeeping — the caller restarts the run (mode reset re-applies
  // ledger → live game state, then cityOriginApply resumes or plays the
  // newcomer's intro). Safe crash-wise: the outgoing snapshot is written to
  // the vault BEFORE the main key changes hands.
  function switchLedgerTo(id, opts) {
    if (!IDS[id] || !CBZ.cityWorldEnsure) return false;
    const cur = CBZ.cityWorldEnsure();
    const curId = (cur && cur.originPlayed && IDS[cur.origin]) ? cur.origin : null;
    if (curId === id) return false;
    // preservePos (the TITLE-SCREEN switch, mid-reset): the outgoing
    // character never actually got control this run — the live player.pos is
    // the fresh default rooftop, NOT where they left off — so their stored
    // resume position must survive the freeze-commit below untouched.
    const keepPos = (opts && opts.preservePos && cur) ? (cur.lastPos || null) : undefined;
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();       // freeze the outgoing character (stamps lastPos too)
    if (keepPos !== undefined && g.cityWorld) g.cityWorld.lastPos = keepPos;
    const v = loadVault();
    if (curId) {
      v.chars[curId] = g.cityWorld;
      // exact-height trust only applies to a REAL live handoff — a
      // preserved position may be from an earlier session's city build.
      if (keepPos === undefined) liveSession[curId] = true;
    }
    const incoming = v.chars[id] || null;
    delete v.chars[id];
    v.active = id;
    if (incoming) {
      carryShared(g.cityWorld, incoming);                 // the city moved on while they were away
      saveVault(v);
      g.cityWorld = incoming;
      try { localStorage.setItem(MAIN_KEY, JSON.stringify(incoming)); } catch (e) {}
    } else {
      // never played: park the shared world; the fresh ledger is minted by
      // the next cityWorldEnsure() (inside cityOriginApply) and receives it.
      pendingShared = {};
      carryShared(g.cityWorld, pendingShared);
      saveVault(v);
      g.cityWorld = null;
      try { localStorage.removeItem(MAIN_KEY); } catch (e) {}
    }
    g.cityOrigin = id;
    if (CBZ.setCityOrigin) CBZ.setCityOrigin(id);
    return true;
  }
  CBZ.citySwitchLedger = switchLedgerTo;    // exposed for the [U] wheel below + harness pokes

  // Returning character: put them back where they were. Within one browser
  // session the exact position (incl. interior floor height) is trusted; a
  // position saved by an EARLIER session keeps its x/z but re-derives a safe
  // standing height from the ground oracle — the city rebuild isn't
  // guaranteed byte-identical across loads, and materializing someone inside
  // a re-rolled wall is worse than them "having wandered downstairs".
  function restorePos(w) {
    const p = w && w.lastPos, P = CBZ.player;
    if (!p || !P || !P.pos) return;
    const y = (w.origin && liveSession[w.origin]) ? p.y
      : (CBZ.floorAt ? CBZ.floorAt(p.x, p.z) : 0);
    P.pos.set(p.x, y, p.z); P.vy = 0;
    if (CBZ.playerChar) CBZ.playerChar.group.position.copy(P.pos);
  }

  // ---- ledger piggybacks (the documented bank.js wrap pattern) -----------
  // commit: stamp the live position + home-spawn onto the ledger BEFORE the
  // original writes it out, so every autosave keeps the character findable.
  // Skipped while dead/busted — a WASTED/BUSTED pose is not a place to
  // resume, and the exec's fraud arrest explicitly clears lastPos.
  (function wrapLedger() {
    const prevCommit = CBZ.cityWorldCommit;
    if (prevCommit) CBZ.cityWorldCommit = function () {
      try {
        const w = CBZ.cityWorldEnsure && CBZ.cityWorldEnsure();
        const P = CBZ.player;
        if (w && g.mode === "city" && P && P.pos && !P.dead && !g.busted) {
          w.lastPos = { x: P.pos.x, y: P.pos.y, z: P.pos.z };
          w.spawnPoint = g.citySpawnPoint ? { x: g.citySpawnPoint.x, z: g.citySpawnPoint.z } : null;
        }
      } catch (e) {}
      return prevCommit.apply(this, arguments);
    };
    // beginRun: each character gets THEIR home respawn back (citySpawnPoint
    // was never persisted before — died with the session; now it's per-char).
    const prevBegin = CBZ.cityWorldBeginRun;
    if (prevBegin) CBZ.cityWorldBeginRun = function () {
      const w = prevBegin.apply(this, arguments);
      try { g.citySpawnPoint = (w && w.spawnPoint) ? { x: w.spawnPoint.x, z: w.spawnPoint.z } : null; } catch (e) {}
      return w;
    };
  })();

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
    // don't run THROUGH desks/walls on the way — and pass the actor's real
    // standing band, else collide() treats every collider on every OTHER
    // floor of the tower as blocking too (its height gate needs feetY/headY).
    if (CBZ.collide) CBZ.collide(c.pos, 0.45, floorY + 0.1, floorY + 1.9);
    c.pos.y = floorY;                            // re-seat on the slab after any nudge
    if (CBZ.animChar) CBZ.animChar(c.char, spd, dt);
    return gd;
  }

  // Every origin defines its own armament — mode.js's default CITY test
  // loadout (bazooka/carbine/sidearm, granted earlier in the same reset())
  // would make "starts with (only) a pistol" meaningless, so each opening
  // strips back to bare hands first and grants exactly what its story says.
  function stripLoadout() {
    if (CBZ.resetWeaponInventory) CBZ.resetWeaponInventory();
    if (CBZ.fpsResetWeapons) CBZ.fpsResetWeapons();
  }

  // Find an OPEN standing spot on a furnished floor: honors the building's
  // own clearFloorPoint gate (door swing / stairwell run / lift shafts — the
  // same gate the furnisher itself places around) AND the real solid
  // colliders (desks, beds, partition walls) in the floor's standing band,
  // so neither the player nor a scripted cop ever spawns inside furniture.
  // Falls back to the preferred point if the spiral finds nothing.
  function clearSpot(b, floorY, wx, wz, maxR) {
    const bx = (b && b.ox != null) ? b.ox : 0, bz = (b && b.oz != null) ? b.oz : 0;
    const cols = (b && b.colliders) || [];
    function open(x, z) {
      if (b && typeof b.clearFloorPoint === "function" && !b.clearFloorPoint(x - bx, z - bz, 0.6)) return false;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (c.y1 != null && (c.y1 < floorY + 0.2 || c.y0 > floorY + 1.9)) continue;   // outside the standing band
        if (x > c.minX - 0.35 && x < c.maxX + 0.35 && z > c.minZ - 0.35 && z < c.maxZ + 0.35) return false;
      }
      return true;
    }
    if (open(wx, wz)) return { x: wx, z: wz };
    for (let r = 0.8; r <= (maxR || 6.5); r += 0.8)
      for (let a = 0; a < 6.28; a += 0.524) {
        const x = wx + Math.cos(a) * r, z = wz + Math.sin(a) * r;
        if (open(x, z)) return { x: x, z: z };
      }
    return { x: wx, z: wz };
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
    const w = b.w || (lot.w || 24);
    const bx = (b.ox != null) ? b.ox : lot.cx, bz = (b.oz != null) ? b.oz : lot.cz;
    // The raid arrives the way anyone reaches an upper floor — the STAIRWELL,
    // which makeBuilding always runs along the local -X edge (buildings.js's
    // roofCx comment: "clear of the -x stairwell"). Entry = just past the
    // stair run; the exec stands across the plate by the far window wall.
    // Both points are validated open (walls/desks/shaft) by clearSpot.
    const entry = clearSpot(b, floorY, bx - w / 2 + (b.stairW || 3.2) + 1.4, bz);
    const spot = clearSpot(b, floorY, bx + w / 2 - 2.4, bz);

    const P = CBZ.player;
    P.pos.set(spot.x, floorY, spot.z); P.vy = 0; P.grounded = true;
    const facing = Math.atan2(entry.x - spot.x, entry.z - spot.z);
    if (CBZ.playerChar) { CBZ.playerChar.group.position.copy(P.pos); CBZ.playerChar.group.rotation.set(0, facing, 0); }
    if (CBZ.cam) { CBZ.cam.yaw = facing + Math.PI; CBZ.cam.pitch = 0.32; }

    stripLoadout();                                // a fraudster carries a pen, not an RPG
    game.cash = 2000000; game.cityBank = 8000000;  // cityOriginApply commits right after
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
    // he does NOT resume on the raided top floor when he's out of jail — drop
    // the resume position (bust() already set g.busted, so the commit wrap
    // won't re-stamp it) and persist the cleared ledger.
    if (g.cityWorld) { g.cityWorld.lastPos = null; }
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
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

    stripLoadout();                                // he drank the gun money
    game.cash = 45; game.cityDebt = 350;           // cityOriginApply commits right after
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
      doorX, doorZ, gy,
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
    // keep the scripted doorman breathing while he stands there — controlled
    // peds are skipped by the civilian brain (peds.js), so nobody else
    // animates him; a statue at the door reads as a bug, not a bouncer.
    if (s.bouncer && s.bouncer.char && CBZ.animChar && (s.phase === "stand" || s.phase === "toss")) {
      CBZ.animChar(s.bouncer.char, 0, dt);
    }
    if (s.phase === "stand") {
      if (s.t < 2.2) return;
      s.phase = "toss"; s.t = 0;   // toss clock restarts — he watches you land before turning away
      // The real "picked up and THROWN" contract (systems/physics.js's
      // ph.air branch — the same channel grapple.js's fling uses): ballistic
      // vx/vz/vy plus a tumble spin; physics carries him through the air,
      // lands him in a knockdown (ph.down) flat on his back, and he gets
      // back up. (The old kx/kz knockback only integrates for a player who
      // is ALREADY knocked down — a standing player ignores it completely,
      // so it never visibly threw anyone.)
      const P = CBZ.player;
      const ph = P._phys = P._phys || {};
      ph.air = true; ph.down = 0;
      ph.vx = s.nx * 6.2; ph.vz = s.nz * 6.2;
      ph.vy = 3.6; ph.spin = 2.4;
      if (CBZ.shake) CBZ.shake(0.5);
      if (CBZ.city) { CBZ.city.big("“AND STAY OUT!”"); CBZ.city.note("Tossed out on your ass — $45 and a bar tab you'll never pay off.", 3); }
      if (s.bouncer && s.bouncer.group) s.bouncer.group.rotation.y = Math.atan2(-s.nx, -s.nz);
      return;
    }
    if (s.phase === "toss") {
      // let the landing play out, then the doorman turns and walks back
      // inside — he only despawns once he's in the doorway (or the beat
      // times out), never blinking out of existence in front of the player.
      if (s.t >= 2.4) { s.phase = "return"; s.rt = 0; }
      return;
    }
    if (s.phase === "return") {
      s.rt = (s.rt || 0) + dt;
      const bn = s.bouncer;
      if (!bn || !bn.group) { s.phase = "done"; clearScene(); return; }
      const gd = stepScriptedTo(bn, s.gy || 0, s.doorX - s.nx * 1.2, s.doorZ - s.nz * 1.2, 1.7, dt);
      if (gd < 0.5 || s.rt > 5) { s.phase = "done"; clearScene(); }
    }
  }

  // ---------------------------------------------------------------
  // TENANT — a wife-beater, a twin air mattress, $12 and a pistol
  // ---------------------------------------------------------------
  function applyTenant(game) {
    const A = arena();
    const lot = findTenantTower();
    let px, pz, mx, mz, floorY;
    if (lot && lot.building) {
      const b = lot.building;
      const units = CBZ.cityFloorUnits ? CBZ.cityFloorUnits(lot) : [];
      let unit = null;
      for (const u of units) { if (u && u.tier === 0) { unit = u; break; } }
      if (!unit && units.length) unit = units[0];
      floorY = unit ? unit.floorY : 0.14;
      const bx = (b.ox != null) ? b.ox : lot.cx, bz = (b.oz != null) ? b.oz : lot.cz;
      // both the standing spot and the mattress get validated OPEN floor
      // (clearSpot: walls / stair run / shaft / the floor's real furniture
      // colliders) — a micro-unit floor plate is already furnished, and
      // spawning the player inside a partition wall reads as a broken game.
      const sp = clearSpot(b, floorY, bx + 1.2, bz + 0.8);
      px = sp.x; pz = sp.z;
      const ms = clearSpot(b, floorY, px - 1.7, pz - 0.4);
      mx = ms.x; mz = ms.z;
      if (Math.hypot(mx - px, mz - pz) < 0.9) { mx = px - 1.7; mz = pz - 0.4; }   // never on top of the player
    } else if (A && A.spawn) {
      px = A.spawn.x; pz = A.spawn.z; floorY = 0.14;
      mx = px - 1.6; mz = pz - 0.3;
    } else return null;

    const P = CBZ.player;
    P.pos.set(px, floorY, pz); P.vy = 0; P.grounded = true;
    const facing = Math.atan2(mx - px, mz - pz);
    if (CBZ.playerChar) { CBZ.playerChar.group.position.copy(P.pos); CBZ.playerChar.group.rotation.set(0, facing, 0); }
    if (CBZ.cam) { CBZ.cam.yaw = facing + Math.PI; CBZ.cam.pitch = 0.34; }

    game.cash = 12; game.cityBank = 0;             // cityOriginApply commits right after

    const cat = CBZ.cityOutfitCatalog ? CBZ.cityOutfitCatalog() : null;
    const outfitId = (cat && cat.wifebeater) ? "wifebeater" : "street";
    if (CBZ.cityWearOutfit) CBZ.cityWearOutfit(outfitId, { silent: true });

    // $12 buys ONE gun's worth of story — strip the test loadout, grant the
    // pistol, THEN seed the viewmodel/mags (the exact reset→unlock→fpsReset
    // order mode.js itself uses, so the pistol arrives with clean base mags).
    if (CBZ.resetWeaponInventory) CBZ.resetWeaponInventory();
    if (CBZ.cityGiveWeapon) CBZ.cityGiveWeapon("Pistol");
    else if (CBZ.unlockWeapon) CBZ.unlockWeapon("sidearm", { select: true });
    if (CBZ.fpsResetWeapons) CBZ.fpsResetWeapons();

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

      // PRE-ORIGIN character (see peekLedger): a real save from before this
      // feature. Adopt whatever's selected as their origin-on-record — play
      // nothing, wipe nothing, override nothing.
      if (legacyLedger && !w.originPlayed) {
        legacyLedger = false;
        w.origin = selected; w.originPlayed = true;
        if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
        return { introActive: false };
      }
      legacyLedger = false;

      // deliver a parked shared-world payload into a freshly minted ledger —
      // and re-point the live g reference (worldstate's applyToGame may have
      // already handed g.cityPolitics the blank pre-carry object).
      function consumeShared(tw) {
        if (!pendingShared || !tw || tw.originPlayed) return;
        carryShared(pendingShared, tw); pendingShared = null;
        if (tw.politics != null) g.cityPolitics = tw.politics;
      }
      consumeShared(w);   // in-game wheel switch to a NEW character: ledger was minted by this run's beginRun

      // Picking a DIFFERENT character than the active one is a GTA5-style
      // SWITCH, never a wipe: the active character's ledger is parked in the
      // vault and the target's is pulled in (or freshly minted — in which
      // case their one-time origin scene plays below). The shared world
      // (economy/politics/clock) rides across in both directions.
      if (w.originPlayed && w.origin && w.origin !== selected) {
        switchLedgerTo(selected, { preservePos: true });
        w = CBZ.cityWorldEnsure();
        consumeShared(w);   // title-screen switch to a NEW character: ledger minted just now
        // the run's earlier beginRun applied the OUTGOING ledger — clear the
        // shared weapon inventory before re-applying, or the newcomer would
        // inherit the other character's arsenal on top of their own
        // (worldstate's restore only ADDS). Same reset→fpsReset→restore
        // sequence mode.js itself runs.
        if (CBZ.resetWeaponInventory) CBZ.resetWeaponInventory();
        if (CBZ.fpsResetWeapons) CBZ.fpsResetWeapons();
        if (CBZ.cityWorldBeginRun) CBZ.cityWorldBeginRun(game);   // the incoming character's stats go live
      }

      if (w.originPlayed) {
        if (w.origin && game.cityOrigin !== w.origin) {
          game.cityOrigin = w.origin;                       // adopt the character on record
          if (CBZ.setCityOrigin) CBZ.setCityOrigin(w.origin);
        }
        restorePos(w);                                      // resume them where they were
        return { introActive: false };
      }

      const opts = applyOrigin(selected, game);
      if (opts) {
        w.origin = selected;
        w.originPlayed = true;
        if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
        introActiveFlag = true;
        introOptsCache = opts.compact ? opts : null;
      }
    } catch (e) { try { console.error("[city origin] apply:", e); } catch (e2) {} }
    return { introActive: introActiveFlag };
  };
  CBZ.cityOriginIntroActive = function () { return !!introActiveFlag; };
  CBZ.cityOriginIntroOpts = function () { return introOptsCache; };

  // ========================================================================
  // [U] — THE CHARACTER WHEEL (GTA5-style in-game switching).
  // Opens a small modal listing all three characters: the active one, any
  // parked ones (with their own cash, straight off their vaulted ledger),
  // and never-played ones (switching to those plays their origin intro).
  // Blocked while wanted / driving / dead / mid-menu — same spirit as GTA
  // refusing the wheel during a chase. The switch itself: fade to black,
  // swap ledgers, restart the city run (mode reset resumes the newcomer
  // where they were), fade back in.
  // ========================================================================
  const CHAR_META = {
    exec: { icon: "💼", name: "The Executive", blurb: "fraud, allegedly" },
    barfly: { icon: "🍺", name: "The Barfly", blurb: "last call regular" },
    tenant: { icon: "🔫", name: "The Tenant", blurb: "one room, one way out" },
  };
  let wheelEl = null, fadeEl = null;

  function moneyFmt(n) { return "$" + Math.round(n || 0).toLocaleString(); }

  function ensureWheel() {
    if (wheelEl) return;
    wheelEl = document.createElement("div");
    wheelEl.id = "originWheel";
    wheelEl.style.cssText =
      "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;display:none;" +
      "min-width:340px;background:rgba(12,14,18,.94);border:1px solid #2c3340;border-radius:14px;" +
      "padding:14px 16px;color:#e8edf4;font:600 14px/1.35 system-ui,sans-serif;box-shadow:0 18px 60px rgba(0,0,0,.55);";
    document.body.appendChild(wheelEl);
    fadeEl = document.createElement("div");
    fadeEl.id = "originSwitchFade";
    fadeEl.style.cssText = "position:fixed;inset:0;z-index:70;background:#000;opacity:0;pointer-events:none;transition:opacity .45s ease;";
    document.body.appendChild(fadeEl);
    wheelEl.addEventListener("click", function (e) {
      const btn = e.target && e.target.closest ? e.target.closest("[data-char]") : null;
      if (btn) doSwitch(btn.getAttribute("data-char"));
    });
  }

  function activeCharId() {
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    return (w && w.originPlayed && IDS[w.origin]) ? w.origin : null;
  }

  function renderWheel() {
    const v = loadVault();
    const act = activeCharId();
    let rows = "";
    for (const id of ["exec", "barfly", "tenant"]) {
      const m = CHAR_META[id];
      let status, dim = "";
      if (id === act) { status = "<span style='color:#7ed957'>YOU · " + moneyFmt(g.cash) + "</span>"; dim = "opacity:.55;pointer-events:none;"; }
      else if (v.chars[id]) status = "<span style='color:#ffd451'>" + moneyFmt(v.chars[id].cash) + "</span>";
      else status = "<span style='color:#7fd0ff'>NEW — their story begins</span>";
      rows +=
        "<button data-char='" + id + "' style='" + dim + "display:flex;align-items:center;gap:10px;width:100%;margin:5px 0;" +
        "padding:9px 11px;border:1px solid #333c4b;border-radius:10px;background:#171b22;color:inherit;" +
        "font:inherit;text-align:left;cursor:pointer;'>" +
        "<span style='font-size:20px'>" + m.icon + "</span>" +
        "<span style='flex:1'><b>" + m.name + "</b><br><span style='font-weight:500;color:#8a93a3;font-size:12px'>" + m.blurb + "</span></span>" +
        "<span style='font-size:12px'>" + status + "</span></button>";
    }
    wheelEl.innerHTML =
      "<div style='display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px'>" +
      "<b style='letter-spacing:.6px'>SWITCH CHARACTER</b>" +
      "<span style='color:#8a93a3;font-size:12px'>[U] close</span></div>" + rows +
      "<div style='margin-top:7px;color:#8a93a3;font-size:11px;font-weight:500'>Everyone keeps their own money, gear and record — the city is shared.</div>";
  }

  function wheelOpen() { return wheelEl && wheelEl.style.display === "block"; }
  function openWheel() {
    if (g.mode !== "city" || g.state !== "playing" || CBZ.cityMenuOpen) return;
    const P = CBZ.player;
    if (!P || P.dead || g.busted) return;
    if (P.driving) { if (CBZ.city) CBZ.city.note("Park it first — no switching from the driver's seat.", 1.8); return; }
    if ((g.wanted | 0) > 0) { if (CBZ.city) CBZ.city.note("🚔 Can't switch while the heat's on.", 1.8); return; }
    // a live origin beat can't be walked out on — switching mid-raid would
    // let the exec keep the fraud millions and never meet the handcuffs.
    if (scene) { if (CBZ.city) CBZ.city.note("Not now — see it through.", 1.8); return; }
    if (CBZ.cityDrunk && CBZ.cityDrunk.blackout) return;   // nobody switches while unconscious
    ensureWheel(); renderWheel();
    wheelEl.style.display = "block";
    CBZ.cityMenuOpen = true;
    if (document.exitPointerLock) try { document.exitPointerLock(); } catch (e) {}
  }
  function closeWheel() {
    if (!wheelEl) return;
    wheelEl.style.display = "none";
    CBZ.cityMenuOpen = false;
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }

  function doSwitch(id) {
    if (!IDS[id] || id === activeCharId()) { closeWheel(); return; }
    closeWheel();
    ensureWheel();
    fadeEl.style.opacity = "1";                      // fade down…
    setTimeout(function () {
      try {
        switchLedgerTo(id);
        // drunkenness is a body, not a save-file: the incoming character
        // wakes up sober even if the outgoing one was mid-bender.
        if (CBZ.cityDrunk) CBZ.cityDrunk.level = 0;
        if (CBZ.startRun) CBZ.startRun();            // mode reset resumes / plays the intro
      } catch (e) { try { console.error("[city origin] switch:", e); } catch (e2) {} }
      setTimeout(function () { fadeEl.style.opacity = "0"; }, 350);   // …and back up on the other life
    }, 470);
  }

  document.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    const k = (e.key || "").toLowerCase();
    if (k !== "u") return;
    if (g.mode !== "city") return;
    if (wheelOpen()) { e.preventDefault(); closeWheel(); return; }
    if (g.state !== "playing" || CBZ.cityMenuOpen) return;
    e.preventDefault(); openWheel();
  });
  document.addEventListener("keydown", function (e) {
    if (wheelOpen() && (e.key === "Escape")) { e.preventDefault(); closeWheel(); }
  });

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
