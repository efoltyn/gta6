/* ============================================================
   city/origins.js — CHARACTER ORIGINS: 3 opening scenes for CITY mode.

   On the title screen (index.html #originSelect, wired in systems/state.js)
   the player picks ONE of three starting characters before hitting Play:

     • THE EXEC     — THE main story beat. The executive floor at the crown
                       of the TALLEST tower in the city (the 52-storey Spire,
                       storey 50 — city/exec_office.js; falls back to the
                       tallest office lot), suit + gold watch + sunglasses.
                       With CBZ.CONFIG.EXEC_REAL_CRASH his brokerage is REAL
                       share positions on sim/stocks.js and the beat executes
                       a REAL market-wide collapse + margin-call liquidation
                       — every readout (laptop, phone, charpanel, bank)
                       agrees on the number lost. Objective: get down to
                       level 1 / the street (the suite's express lift rides
                       to the door). Jail is still the real endgame if the
                       cops cuff you later — not a scripted raid on frame one.
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

  // ========================================================================
  // ORIGIN_TUNING — every magic number from the three openings, hoisted here
  // so balancing a beat never means hunting through scene-logic code. Each
  // origin owns its own block; shared beat-timing constants stay per-origin
  // too (exec's raid cadence and barfly's toss cadence are unrelated).
  // ========================================================================
  const ORIGIN_TUNING = {
    exec: {
      // Opening wealth. With EXEC_REAL_CRASH the startBank figure is granted
      // as REAL share positions on the exchange (sim/stocks.js) — the laptop,
      // net worth and the phone all read the live portfolio; without stocks
      // (or flag off) it stays a plain insured bank balance. Either way the
      // crash beat destroys it through real state, not a printed line.
      startCash: 2000000,
      startBank: 8000000,
      marginDebt: 250000,          // the margin loan still due after liquidation
      laptopSec: 5.5,              // stock-crash laptop + phone beat before free movement
      crashAfterSec: 2.2,          // when during laptop phase the numbers actually zero
      descendHintSec: 1.2,         // after crash, beat before "go downstairs" objective
      groundYSlop: 2.8,            // within this of ground floor Y => "reached street level"
      // Legacy raid knobs kept so old saves/tools poking them don't NaN; unused by the crash path.
      waitSec: 7,
      copSpeed: 3.8,
      bustRadius: 2.2,
      raidMinSec: 0.6,
      raidTimeoutSec: 6,
      copCount: 2,
      swatCount: 1,
      untouchableBarkCooldown: 2.5,
      missedLotFeed: "The firm's tower is locked for the night, you ride the freight elevator down broke.",
    },
    barfly: {
      startCash: 45,
      startDebt: 350,
      drunkLevel: 2.5,
      standSec: 2.2,               // beat: stand at the door before the shove
      tossSec: 2.4,                // beat: airborne / landing before the doorman turns away
      returnTimeoutSec: 5,         // doorman gives up walking back and just despawns
      tossSpeedXZ: 6.2,
      tossSpeedY: 3.6,
      tossSpin: 2.4,
      shakeAmt: 0.5,
      returnSpeed: 1.7,            // m/s the doorman walks back to the door
      missedLotFeed: "The bar's shuttered for the night, you wake up in the gutter anyway, $45 and a tab you'll never pay off.",
    },
    tenant: {
      startCash: 12,
      startBank: 0,
      missedLotFeed: "Your building's stairwell is roped off tonight, you crash on a friend's floor instead. One room, one way out, same as ever.",
    },
  };

  // ========================================================================
  // ONE REGISTRY (defect #5): id -> {meta, tuning, findSpawn, grants, scene}.
  // A 4th protagonist is a data addition here — nothing else in this file
  // (the vault, the wheel, the dispatcher) hard-codes exec/barfly/tenant by
  // name anymore; they all walk Object.keys(ORIGINS). Declared up here
  // (rather than down by the scene functions it references) because the
  // boot-time ledger peek right below runs SYNCHRONOUSLY at load and needs
  // IDS (derived from these keys) already live — a `const` this file
  // referenced before its own declaration would throw (TDZ). The functions
  // it points at (findOfficeLot/grantExec/sceneExec/…) are plain `function`
  // declarations further down and are fully hoisted, so forward-referencing
  // them here is safe.
  // ========================================================================
  const ORIGINS = {
    exec: {
      meta: { icon: "", name: "The Executive", blurb: "suit, gold watch, zero dollars" },
      get tuning() { return ORIGIN_TUNING.exec; },
      findSpawn: function () { return findExecTower(); },
      grants: function (game) { return grantExec(game); },
      scene: function (game) { return sceneExec(game); },
    },
    barfly: {
      meta: { icon: "", name: "The Barfly", blurb: "last call regular" },
      get tuning() { return ORIGIN_TUNING.barfly; },
      findSpawn: function () { return findBarLot(); },
      grants: function (game) { return grantBarfly(game); },
      scene: function (game) { return sceneBarfly(game); },
    },
    tenant: {
      meta: { icon: "", name: "The Tenant", blurb: "one room, one way out" },
      get tuning() { return ORIGIN_TUNING.tenant; },
      findSpawn: function () { return findTenantTower(); },
      grants: function (game) { return grantTenant(game); },
      scene: function (game) { return sceneTenant(game); },
    },
  };
  // hard-wired to the registry's own keys (defect #5) — no second literal
  // id list to keep in sync when a 4th protagonist ships.
  const IDS = Object.keys(ORIGINS).reduce(function (o, k) { o[k] = 1; return o; }, {});
  // RETIRED IDS (owner, 2026-08-03: "make them one"). The Hitman preset card
  // and The Contract campaign card were the same professional-hit fantasy on
  // one picker; `contract` survives carrying the hitman texture (motel, the
  // suppressed pistol, one name) and `hitman` maps onto it everywhere a saved
  // id can surface — ledger, vault, picker, campaign activation.
  const ORIGIN_ALIASES = { hitman: "contract" };
  function unalias(id) { return ORIGIN_ALIASES[id] || id; }
  function normOrigin(id) { id = unalias(id); return IDS[id] ? id : "exec"; }
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
    // Retired-id saves (`hitman`) sync the picker to the surviving card. Note
    // the composed/contract rows are NOT in IDS yet at peek time (they
    // register further down this file), so those saves fall through here and
    // campaign.js's own boot sync covers them — same as `contract` always has.
    const savedOrigin = unalias(p.origin);
    if (p.originPlayed && IDS[savedOrigin]) {
      if (CBZ.game) CBZ.game.cityOrigin = savedOrigin;
      if (CBZ.setCityOrigin) CBZ.setCityOrigin(savedOrigin);   // picker sync only — no "picked" intent
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
  // (defect #8 — audited, kept as-is: correct design.) A per-session memo,
  // NOT persisted: id -> true once that character has been vaulted (parked)
  // during THIS browser session via a real live handoff (switchLedgerTo with
  // no preservePos). It exists purely to answer one question in restorePos():
  // "is this character's saved lastPos.y trustworthy as an exact height, or
  // should we re-derive standing height from the ground oracle instead?" A
  // position saved by an EARLIER session (or by preservePos's title-screen
  // freeze, which never trusts liveSession) may sit inside a procedurally
  // re-rolled floor after a fresh page load — this session's own handoffs
  // can't have drifted, so they get the cheap exact-height fast path. Reset
  // implicitly every page load (module-scoped, never round-tripped to
  // localStorage) — which is exactly the lifetime it needs.
  const liveSession = {};                   // ids vaulted THIS session — their exact lastPos.y is trustworthy

  function loadVault() {
    try {
      const raw = localStorage.getItem(VAULT_KEY);
      if (raw) { const v = JSON.parse(raw); if (v && v.chars) return migrateVault(v); }
    } catch (e) {}
    return { active: null, chars: {} };
  }
  // A parked ledger under a RETIRED id would be unreachable — the wheel walks
  // ORIGINS keys and `hitman` is no longer one. Idempotent, nothing destroyed:
  // the parked hitman life becomes the merged character (or, if that slot is
  // taken, the recoverable `previous` life; if both are taken it stays parked
  // under its old key — unlisted but intact, never overwritten).
  function migrateVault(v) {
    for (const from in ORIGIN_ALIASES) {
      if (!v.chars[from]) { if (v.active === from) v.active = ORIGIN_ALIASES[from]; continue; }
      const to = ORIGIN_ALIASES[from];
      const dest = !v.chars[to] ? to : (!v.chars[PREV_ID] ? PREV_ID : null);
      if (dest) {
        v.chars[dest] = v.chars[from];
        v.chars[dest].origin = dest;
        delete v.chars[from];
      }
      if (v.active === from) v.active = to;
    }
    return v;
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

  /* Park a PRE-ORIGIN life — a save that predates the story system, so it has
     no character id of its own — into the vault under the reserved id
     `previous`, and hand the main key back empty so the next
     cityWorldEnsure() mints a clean ledger for the story the player chose.

     This is the "nothing is destroyed" half of honouring a real pick. The old
     life keeps its cash, bank, weapons, record and assets intact and is
     reachable again from the [U] wheel, which lists it as Your Previous Life.
     The shared world (economy / politics / clock) is carried forward, exactly
     as an ordinary character switch does — the city does not restart because
     you did. */
  const PREV_ID = "previous";
  function parkPreviousLife(w) {
    if (!w) return false;
    try {
      if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();   // freeze cash/pos as they stand
      const v = loadVault();
      w.origin = PREV_ID; w.originPlayed = true;
      v.chars[PREV_ID] = w;
      saveVault(v);
      pendingShared = {};
      carryShared(w, pendingShared);                    // the city rides across
      g.cityWorld = null;
      try { localStorage.removeItem(MAIN_KEY); } catch (e) {}
      return true;
    } catch (e) { return false; }
  }

  // Returning character: put them back where they were. Within one browser
  // session the exact position (incl. interior floor height) is trusted; a
  // position saved by an EARLIER session keeps its x/z but re-derives a safe
  // standing height from the ground oracle — the city rebuild isn't
  // guaranteed byte-identical across loads, and materializing someone inside
  // a re-rolled wall is worse than them "having wandered downstairs".
  //
  // A cross-session resume that lands INSIDE a building is moved to that
  // building's front step: the height is being re-derived anyway (so the
  // exact floor you saved on is already lost), and waking up in a stairwell
  // or against a partition wall is the worst possible first frame. Either
  // way the body is then turned to face the open street (CBZ.cityFaceOpen).
  function restorePos(w) {
    const p = w && w.lastPos, P = CBZ.player;
    if (!p || !P || !P.pos) return;
    const trusted = !!(w.origin && liveSession[w.origin]);
    let x = p.x, z = p.z;
    let y = trusted ? p.y : (CBZ.floorAt ? CBZ.floorAt(x, z) : 0);
    if (!trusted) {
      const out = frontStepOf(x, z);
      if (out) { x = out.x; z = out.z; y = CBZ.floorAt ? CBZ.floorAt(x, z) : 0; }
    }
    P.pos.set(x, y, z); P.vy = 0;
    if (CBZ.playerChar) CBZ.playerChar.group.position.copy(P.pos);
    if (CBZ.cityFaceOpen) CBZ.cityFaceOpen(P);
  }
  // The outside point in front of the door of the building whose footprint
  // covers (x,z), or null when (x,z) is not over a building. The door normal
  // is outward (the jail-door spawn in mode.js steps along it the same way).
  function frontStepOf(x, z) {
    const nav = CBZ.cityNav;
    if (!nav || !nav.indoorLotAt) return null;
    const lot = nav.indoorLotAt(x, z);
    const d = lot && lot.building && lot.building.door;
    if (!d || d.x == null) return null;
    const nx = d.nx != null ? d.nx : 0, nz = d.nz != null ? d.nz : 1;
    const nl = Math.hypot(nx, nz) || 1;
    for (const s of [2.2, -2.2]) {
      const ox = d.x + (nx / nl) * s, oz = d.z + (nz / nl) * s;
      if (!nav.indoorLotAt(ox, oz)) return { x: ox, z: oz, lot: lot };
    }
    return null;
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
      stripTestKit(w);
      return w;
    };
  })();

  /* THE TEST KIT, RETIRED ONCE PER SAVE. mode.js used to grant every sandbox
     run an RPG (selected) + carbine + sidearm, and the ledger saved whatever
     you were holding, so every old save carries that kit and restores it on
     top of the character's real arsenal: the RPG keeps coming back. The first
     time a ledger is loaded under this build, the kit's two heavy pieces are
     taken back (the sidearm stays: a pistol is a fair thing to own). Stamped
     on the ledger so a rocket launcher bought or looted LATER is never
     touched again. */
  function stripTestKit(w) {
    if (!w || w.testKitStripped) return;
    w.testKitStripped = true;
    if (CBZ.cityCampaignActive && CBZ.cityCampaignActive()) return;
    const has = CBZ.hasWeapon || function () { return false; };
    if (!has("bazooka") || !CBZ.lockWeapon) return;
    CBZ.lockWeapon("bazooka");
    if (has("carbine")) CBZ.lockWeapon("carbine");
    if (Array.isArray(w.weapons)) w.weapons = w.weapons.filter(function (id) { return id !== "bazooka" && id !== "carbine"; });
    if (w.currentWeapon === "bazooka" || w.currentWeapon === "carbine") w.currentWeapon = CBZ.currentWeaponId || null;
  }

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
  // THE EXEC'S TOWER: the flagship 52-storey mega-tower — the ACTUAL tallest
  // building the city generates — when its executive floor was built
  // (CBZ.CONFIG.EXEC_TOP_OFFICE → buildings.js makeMegaTower → exec_office.js
  // stamps building.execOffice). A 12-storey office lot only ever "read" tall;
  // the Spire is 3.5× that. Falls back to the old tallest-office pick when the
  // flag is off / the flagship didn't build (headless minimal city).
  function findExecTower() {
    const mt = CBZ.cityMegaTower && CBZ.cityMegaTower();
    const lot = mt && mt.lot;
    if (lot && lot.building && lot.building.execOffice && lot.building.execOffice.floorY != null) return lot;
    return findOfficeLot();
  }
  // Derived from the LIVE town registry (city/citytemplates.js's
  // CBZ.CITY_TEMPLATES — the one place every themed town, present and
  // future, is defined) instead of a literal snapshot that goes stale the
  // moment a new town ships (harvestmarket/pinecrest shipped after the
  // original literal here and were silently never preferred). Falls back to
  // the last-known-good literal only if the registry hasn't loaded yet.
  function townIds() {
    if (CBZ.CITY_TEMPLATES) {
      const out = {};
      for (const k in CBZ.CITY_TEMPLATES) out[k] = 1;
      return out;
    }
    return { goldspire: 1, capeharbor: 1, neonreef: 1, foundry: 1, harvestmarket: 1, pinecrest: 1 };
  }
  function findBarLot() {
    const TOWN_IDS = townIds();
    const A = arena(); if (!A || !A.lots) return null;
    let town = null, any = null;
    for (const lot of A.lots) {
      if (!lot || lot.kind !== "bar" || !lot.building || !lot.building.door) continue;
      if (!any) any = lot;
      if (lot.district && TOWN_IDS[lot.district]) { town = lot; break; }
    }
    return town || any;
  }
  // THE TENANT'S BUILDING. This used to take the TALLEST home tower, which is
  // always the Spire, the flagship with a penthouse on top; its units[0] is
  // storey 0, which on the Spire is the drive-in HANGAR deck. So "one room,
  // one mattress" woke up among the parked supercars of the richest building
  // in the city. A man with $12 lives in an ordinary tower: never the
  // flagship, the cheapest address tier first, the tallest of those.
  function findTenantTower() {
    const A = arena(); if (!A) return null;
    const pool = A.homeLots || A.lots;
    if (!pool) return null;
    let best = null, bestK = -1e9;
    for (const lot of pool) {
      if (!lot || lot.kind !== "tower" || !lot.building || !lot.building.home) continue;
      const h = lot.building.home;
      if (h.flagship) continue;
      const st = lot.building.storeys || 0;
      if (st < 3) continue;
      const k = -((h.tier | 0) * 1000) + st;              // poorest tier first, then tallest
      if (k > bestK) { bestK = k; best = lot; }
    }
    if (best) return best;
    for (const lot of pool) if (lot && lot.kind === "tower" && lot.building && lot.building.home) return lot;
    return null;
  }
  // WHICH FLOOR: an ordinary flat a couple of storeys up (never the ground
  // plate, which in a tower is the lobby or a garage), cheapest units first.
  function tenantFloorY(lot) {
    const units = (CBZ.cityFloorUnits && lot) ? (CBZ.cityFloorUnits(lot) || []) : [];
    const b = lot && lot.building;
    const ground = (b && b.floorTops && b.floorTops[0] != null) ? b.floorTops[0] : 0.14;
    const ups = units.filter(function (u) { return u && u.floorY != null && u.floorY > ground + 2.0; });
    ups.sort(function (a, c) { return ((a.tier | 0) - (c.tier | 0)) || (a.floorY - c.floorY); });
    if (ups.length) return ups[Math.min(1, ups.length - 1)].floorY;
    return units.length ? units[0].floorY : ground;
  }

  // THE WALL THE MATTRESS GOES AGAINST. Nobody sleeps on a mattress floating
  // in the middle of a room: it is pushed along a wall. Nearest solid that is
  // a WALL (spans waist height, runs 2.2 m or more), with the side it faces.
  function wallBeside(b, floorY, x, z, maxD) {
    const cols = (b && b.colliders) || [];
    let best = null;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.y1 == null || c.y1 < floorY + 1.2 || c.y0 > floorY + 0.4) continue;
      const sx = c.maxX - c.minX, sz = c.maxZ - c.minZ;
      if (Math.max(sx, sz) < 2.2 || Math.min(sx, sz) > 0.8) continue;
      const qx = Math.max(c.minX, Math.min(c.maxX, x)), qz = Math.max(c.minZ, Math.min(c.maxZ, z));
      const d = Math.hypot(x - qx, z - qz);
      if (d <= 0.05 || d > maxD) continue;
      if (!best || d < best.d) best = { d: d, c: c };
    }
    if (!best) return null;
    const c = best.c, alongX = (c.maxX - c.minX) >= (c.maxZ - c.minZ);
    if (alongX) {
      const s = z > (c.minZ + c.maxZ) / 2 ? 1 : -1;
      return { nx: 0, nz: s, face: s > 0 ? c.maxZ : c.minZ, lo: c.minX, hi: c.maxX, alongX: true, c: c };
    }
    const s = x > (c.minX + c.maxX) / 2 ? 1 : -1;
    return { nx: s, nz: 0, face: s > 0 ? c.maxX : c.minX, lo: c.minZ, hi: c.maxZ, alongX: false, c: c };
  }

  // does the squat's whole footprint (frame: long axis local x, wall at -z)
  // land on open floor? Sampled on a grid over the mattress + crate + duffel
  // + the blanket spill, against the building's gate and its real solids.
  function squatFits(b, floorY, cx, cz, yaw) {
    const cols = (b && b.colliders) || [];
    const bx = (b && b.ox != null) ? b.ox : 0, bz = (b && b.oz != null) ? b.oz : 0;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    for (let lx = -1.4; lx <= 1.75; lx += 0.35) for (let lz = -0.42; lz <= 1.05; lz += 0.35) {
      // local (lx, lz) -> world: +z maps to (sin yaw, cos yaw), +x to (cos yaw, -sin yaw)
      const x = cx + lx * cs + lz * sn, z = cz - lx * sn + lz * cs;
      if (b && typeof b.clearFloorPoint === "function" && !b.clearFloorPoint(x - bx, z - bz, 0.05)) return false;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (c.y1 != null && (c.y1 < floorY + 0.05 || c.y0 > floorY + 1.0)) continue;
        if (x > c.minX - 0.04 && x < c.maxX + 0.04 && z > c.minZ - 0.04 && z < c.maxZ + 0.04) return false;
      }
    }
    return true;
  }

  // THE SQUAT: a real twin air mattress (vinyl body, flocked top, a valve),
  // a pillow, a fleece blanket kicked half onto the floor, an upturned milk
  // crate for a nightstand with the phone charging off the wall, a clothes
  // pile, a duffel with everything he owns, last night's pizza box and cans.
  // Built with the exec suite's mesh kit (CBZ.cityMeshKit): real shapes,
  // one merged mesh per material. Frame: long axis local x (head at -x), the
  // wall at local -z, the open floor at +z. Re-staging removes the old one.
  let squat = null;
  function clearSquat() {
    if (!squat) return;
    if (squat.parent) squat.parent.remove(squat);
    squat.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    squat = null;
  }
  function blanketGeo(THREE, hs) {
    const BW = 1.45, BD = 1.75, nx = 26, nz = 30;
    const g = new THREE.PlaneGeometry(BW, BD, nx, nz);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    const TOP = 0.236, HX = 0.9, HZ = 0.46;
    for (let i = 0; i < p.count; i++) {
      const wx = p.getX(i) + 0.32, wz = p.getZ(i) + 0.3;
      let wr = 0.022 * Math.sin(wx * 9.0 + wz * 3.1) + 0.016 * Math.sin(wz * 13.0 - wx * 5.3) + 0.01 * Math.sin(wx * 23 + wz * 17);
      const lump = 0.07 * Math.exp(-((wx - 0.35) * (wx - 0.35) * 6 + (wz + 0.05) * (wz + 0.05) * 9));
      const over = Math.max(0, Math.abs(wx) - HX, Math.abs(wz) - HZ);
      let y;
      if (over <= 0) y = TOP + Math.max(-0.01, wr) + lump;
      else {
        y = TOP + wr * 0.5 - over * 2.8;
        if (y < 0.012) y = 0.012 + Math.max(0, wr * 0.6) + 0.03 * hs(i, 3) * Math.max(0, 1 - over * 2);
      }
      p.setXYZ(i, wx, y, wz);
    }
    g.computeVertexNormals();
    return g;
  }
  function buildSquat(root, x, y, z, rotY) {
    const THREE = window.THREE;
    clearSquat();
    if (!THREE || !root || !CBZ.cityMeshKit) return null;
    const K = CBZ.cityMeshKit(y), M = K.M, hs = CBZ.cityMeshKit.hash;
    K.at(x, z, rotY || 0);
    // the mattress: grey-blue vinyl body, navy flocked top in long I-beam
    // channels, the valve on the foot end
    K.rbox(M.satin, 0, 0.1, 0, 1.88, 0.2, 0.97, 0.085, 0x56647a);
    K.rbox(M.paint, 0, 0.2, 0, 1.76, 0.02, 0.86, 0.009, 0x26314a);
    for (let i = 0; i < 7; i++) {
      K.cyl(M.paint, 0, 0.19, -0.37 + i * 0.1233, 0.036, 0.036, 1.66, 12, 0x2b3752, 0, 0, Math.PI / 2);
    }
    K.cyl(M.satin, 0.94, 0.14, 0.3, 0.022, 0.022, 0.03, 12, 0x2a2e33, 0, 0, Math.PI / 2);
    // pillow at the head, a little crooked, a lived-in off-white
    K.rbox(M.paint, -0.63, 0.285, -0.08, 0.54, 0.12, 0.38, 0.055, 0xd8d0c0, 0.04, 0.12, 0.05);
    // the fleece blanket, kicked off the open side onto the floor
    K.geo(M.leaf, blanketGeo(THREE, hs), 0, 0, 0, 0x6b5a4b);
    // an upturned milk crate at the head end, against the wall
    K.at(x, z, rotY || 0);
    const cx = -1.25, cz = -0.26, CW = 0.33, CH = 0.28, CB = 0x2b4f8c;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box(M.satin, cx + sx * (CW / 2 - 0.012), CH / 2, cz + sz * (CW / 2 - 0.012), 0.024, CH, 0.024, CB);
    for (const yy of [0.012, 0.1, 0.18, CH - 0.012]) {
      K.box(M.satin, cx, yy, cz + CW / 2 - 0.01, CW, 0.018, 0.02, CB);
      K.box(M.satin, cx, yy, cz - CW / 2 + 0.01, CW, 0.018, 0.02, CB);
      K.box(M.satin, cx + CW / 2 - 0.01, yy, cz, 0.02, 0.018, CW, CB);
      K.box(M.satin, cx - CW / 2 + 0.01, yy, cz, 0.02, 0.018, CW, CB);
    }
    for (let i = -2; i <= 2; i++) {
      K.box(M.satin, cx + i * 0.06, CH - 0.01, cz, 0.012, 0.02, CW - 0.02, CB);
      K.box(M.satin, cx, CH - 0.01, cz + i * 0.06, CW - 0.02, 0.02, 0.012, CB);
    }
    // on it: the phone charging, a water bottle, a lighter
    K.rbox(M.satin, cx + 0.05, CH + 0.006, cz + 0.06, 0.075, 0.009, 0.155, 0.006, 0x111214, 0, 0.5, 0);
    K.box(M.emit, cx + 0.05, CH + 0.0112, cz + 0.06, 0.062, 0.001, 0.13, 0x10161c, 0, 0.5, 0);
    K.tube(M.paint, [cx + 0.02, CH + 0.005, cz - 0.01], [cx - 0.08, CH + 0.004, cz - 0.12], 0.003, 0xe8e8e8, 5);
    K.tube(M.paint, [cx - 0.08, CH + 0.004, cz - 0.12], [cx - 0.1, 0.3, -0.505], 0.003, 0xe8e8e8, 5);
    K.box(M.paint, cx - 0.1, 0.3, -0.508, 0.072, 0.115, 0.008, 0xefeee8);
    K.box(M.paint, cx - 0.1, 0.285, -0.49, 0.03, 0.04, 0.03, 0xf4f4f2);
    K.cyl(M.satin, cx - 0.08, CH + 0.11, cz + 0.08, 0.033, 0.033, 0.22, 14, 0x9fc3d6);
    K.cyl(M.paint, cx - 0.08, CH + 0.23, cz + 0.08, 0.016, 0.016, 0.02, 10, 0xf2f2f2);
    K.box(M.satin, cx + 0.1, CH + 0.009, cz - 0.08, 0.025, 0.012, 0.075, 0xc0392b, 0, 0.9, 0);
    // a duffel at the foot, against the wall: everything he owns
    K.cyl(M.satin, 1.28, 0.15, -0.3, 0.15, 0.15, 0.42, 16, 0x1c1e22, 0, 0, Math.PI / 2);
    K.sphere(M.satin, 1.07, 0.15, -0.3, 0.15, 0x1c1e22, 0.35, 1, 1);
    K.sphere(M.satin, 1.49, 0.15, -0.3, 0.15, 0x1c1e22, 0.35, 1, 1);
    K.box(M.satin, 1.28, 0.297, -0.3, 0.44, 0.006, 0.02, 0x0c0d0f);
    K.tube(M.satin, [1.12, 0.26, -0.36], [1.28, 0.36, -0.36], 0.01, 0x2a2d31, 6);
    K.tube(M.satin, [1.28, 0.36, -0.36], [1.44, 0.26, -0.36], 0.01, 0x2a2d31, 6);
    // yesterday's clothes on the floor by the foot, open side
    K.sphere(M.paint, 1.45, 0.05, 0.62, 0.2, 0x55585e, 1.3, 0.35, 1.0);
    K.sphere(M.paint, 1.6, 0.035, 0.38, 0.18, 0x2c3a52, 1.6, 0.25, 0.7);
    K.sphere(M.paint, 1.3, 0.03, 0.85, 0.14, 0xd8d8d2, 1.2, 0.25, 1.0);
    // last night: a pizza box and the cans
    K.at(x, z, rotY || 0);
    K.rbox(M.paint, -0.75, 0.021, 0.88, 0.38, 0.042, 0.38, 0.004, 0xb99a6c, 0, 0.35, 0);
    K.box(M.paint, -0.75, 0.0425, 0.88, 0.2, 0.001, 0.14, 0x8a2f24, 0, 0.35, 0);
    K.cyl(M.chrome, -1.1, 0.033, 0.5, 0.033, 0.033, 0.122, 14, 0xb9bec4, 0, 0.6, Math.PI / 2);
    K.cyl(M.satin, -1.1, 0.033, 0.5, 0.0335, 0.0335, 0.05, 14, 0x9b1f25, 0, 0.6, Math.PI / 2);
    K.cyl(M.chrome, -1.3, 0.061, 0.62, 0.033, 0.033, 0.122, 14, 0xb9bec4);
    K.cyl(M.satin, -1.3, 0.07, 0.62, 0.0335, 0.0335, 0.05, 14, 0x9b1f25);
    const grp = new THREE.Group();
    grp.name = "tenant-squat";
    K.flush(grp, "tenant-squat");
    root.add(grp);
    squat = grp;
    return grp;
  }

  // Generic safe fallback spawn used whenever an origin's SCENE can't be
  // staged (its lot came back null on procedural bad luck — defect #3): the
  // character's GRANTS (cash/bank/debt/outfit/weapon/drunk-level) already
  // landed unconditionally before this runs, so the player is never worse
  // off — they just wake up on the street instead of inside a staged beat.
  function genericSafeSpawn() {
    const A = arena();
    const P = CBZ.player;
    const sx = (A && A.spawn) ? A.spawn.x : 0, sz = (A && A.spawn) ? A.spawn.z : 0;
    const gy = CBZ.floorAt ? CBZ.floorAt(sx, sz) : 0;
    if (P && P.pos) { P.pos.set(sx, gy, sz); P.vy = 0; P.grounded = true; }
    if (CBZ.playerChar) { CBZ.playerChar.group.position.copy(P.pos); CBZ.playerChar.group.rotation.set(0, 0, 0); }
    if (CBZ.cam) { CBZ.cam.yaw = Math.PI; CBZ.cam.pitch = 0.28; }
    if (CBZ.cityFaceOpen) CBZ.cityFaceOpen(P);
    scene = null;
  }

  // ---------------------------------------------------------------
  // EXEC — top of the tallest tower, suit/watch/shades, REAL MARKET
  // CRASH, descend to L1
  // ---------------------------------------------------------------
  // THE REAL PORTFOLIO (EXEC_REAL_CRASH): spread `total` dollars across every
  // listed ticker as GRANTED share positions (stocks.grant — the ipo() idiom:
  // real qty + cost basis, no cash moved, no herd impact). Deterministic sym
  // order. Returns the dollar value actually placed (0 → no exchange, caller
  // falls back to a bank balance so the start is never silently poorer).
  function grantExecPortfolio(total) {
    const S = CBZ.stocks;
    if (!S || !S.list || !S.grant) return 0;
    let rows = [];
    try { rows = S.list().filter(function (st) { return st && isFinite(st.price) && st.price > 0; }); } catch (e) { return 0; }
    if (!rows.length) return 0;
    rows.sort(function (a, b) { return a.sym < b.sym ? -1 : a.sym > b.sym ? 1 : 0; });
    const per = total / rows.length;
    let placed = 0;
    for (const st of rows) {
      const sh = Math.max(1, Math.round(per / st.price));
      try { placed += S.grant(st.sym, sh) || 0; } catch (e) {}
    }
    return Math.round(placed);
  }
  // What the laptop's "Brokerage" cell shows: the LIVE portfolio value plus
  // any swept bank balance — the same numbers netWorth()/charpanel read.
  function execBrokerage() {
    let v = g.cityBank || 0;
    if (CBZ.stocks && CBZ.stocks.portfolioValue) { try { v += CBZ.stocks.portfolioValue(); } catch (e) {} }
    return Math.round(v);
  }
  // GRANTS (defect #3): cash/portfolio/outfit/weapon-strip + ice apply
  // unconditionally, whether or not a real office lot can be found.
  function grantExec(game) {
    const T = ORIGIN_TUNING.exec;
    stripLoadout();                                 // a pen, not an RPG
    game.cash = T.startCash;
    if (CBZ.CONFIG && CBZ.CONFIG.EXEC_REAL_CRASH) {
      // the brokerage is REAL share positions on the exchange; whatever the
      // exchange couldn't place (thin/absent roster) stays a real bank balance
      // so his opening net worth is the same 10M either way.
      const placed = grantExecPortfolio(T.startBank);
      game.cityBank = Math.max(0, T.startBank - placed);
    } else {
      game.cityBank = T.startBank;
    }
    if (CBZ.cityWearOutfit) CBZ.cityWearOutfit("suit", { silent: true });
    // Gold watch + designer shades — owned + worn so bling + drip read live.
    try {
      const e = CBZ.cityEcon;
      if (e && e.add) {
        e.add("Gold Watch", 1);
        e.add("Designer Shades", 1);
      }
      if (CBZ.cityGrantItem) CBZ.cityGrantItem("watch_gold");
      if (CBZ.cityEquip) CBZ.cityEquip("Designer Shades");
      if (CBZ.cityBlingPlayerDirty) CBZ.cityBlingPlayerDirty();
    } catch (err) {}
  }

  // Laptop HUD: a diegetic "office terminal" showing the portfolio die.
  let laptopEl = null;
  function ensureLaptop() {
    if (laptopEl) return laptopEl;
    laptopEl = document.createElement("div");
    laptopEl.id = "originLaptop";
    laptopEl.style.cssText =
      "position:fixed;left:50%;top:46%;transform:translate(-50%,-50%) scale(.96);z-index:55;display:none;" +
      "width:min(520px,92vw);background:linear-gradient(180deg,#0d1118 0%,#151b24 100%);border:1px solid #2a3342;" +
      "border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.65),0 0 0 1px rgba(255,90,90,.08);" +
      "color:#e8edf4;font:600 13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;padding:0;overflow:hidden;" +
      "opacity:0;transition:opacity .35s ease,transform .35s ease;pointer-events:none;";
    laptopEl.innerHTML =
      "<div style='display:flex;align-items:center;gap:8px;padding:10px 14px;background:#0a0d12;border-bottom:1px solid #232a36'>" +
      "<span style='width:10px;height:10px;border-radius:50%;background:#ff5b5b'></span>" +
      "<span style='width:10px;height:10px;border-radius:50%;background:#ffd451'></span>" +
      "<span style='width:10px;height:10px;border-radius:50%;background:#7ed957'></span>" +
      "<span style='margin-left:8px;color:#8a93a3;font-size:11px;letter-spacing:.4px'>STERLING · MARGIN TERMINAL</span></div>" +
      "<div style='padding:16px 18px 18px'>" +
      "<div style='color:#8a93a3;font-size:11px;margin-bottom:6px'>PORTFOLIO · LIVE</div>" +
      "<div id='olNet' style='font-size:28px;font-weight:800;color:#7ed957;letter-spacing:.5px'>$10,000,000</div>" +
      "<div id='olDelta' style='margin-top:4px;font-size:13px;color:#7ed957'>+0.00%  pre-market</div>" +
      "<div style='margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px'>" +
      "<div style='background:#0a0d12;border:1px solid #232a36;border-radius:8px;padding:8px 10px'><div style='color:#8a93a3'>Cash</div><div id='olCash'>$2,000,000</div></div>" +
      "<div style='background:#0a0d12;border:1px solid #232a36;border-radius:8px;padding:8px 10px'><div style='color:#8a93a3'>Brokerage</div><div id='olBank'>$8,000,000</div></div>" +
      "</div>" +
      "<div id='olAlert' style='margin-top:14px;padding:10px 12px;border-radius:8px;background:rgba(255,91,91,.08);border:1px solid rgba(255,91,91,.25);color:#ff9e9e;font-size:12px;display:none'>" +
      "MARGIN CALL · positions liquidated · accounts frozen</div>" +
      "<div style='margin-top:10px;color:#5c6573;font-size:10px'>Not financial advice. Definitely financial ruin.</div>" +
      "</div>";
    document.body.appendChild(laptopEl);
    return laptopEl;
  }
  function showLaptop(show) {
    const el = ensureLaptop();
    if (show) {
      el.style.display = "block";
      requestAnimationFrame(function () {
        el.style.opacity = "1";
        el.style.transform = "translate(-50%,-50%) scale(1)";
      });
    } else {
      el.style.opacity = "0";
      el.style.transform = "translate(-50%,-50%) scale(.96)";
      setTimeout(function () { if (el) el.style.display = "none"; }, 380);
    }
  }
  function paintLaptop(cash, bank, crashed) {
    ensureLaptop();
    const net = (cash | 0) + (bank | 0);
    const netEl = document.getElementById("olNet");
    const dEl = document.getElementById("olDelta");
    const cEl = document.getElementById("olCash");
    const bEl = document.getElementById("olBank");
    const aEl = document.getElementById("olAlert");
    const fmt = function (n) { return "$" + Math.round(n || 0).toLocaleString(); };
    if (netEl) { netEl.textContent = fmt(net); netEl.style.color = crashed ? "#ff5b5b" : "#7ed957"; }
    if (dEl) {
      dEl.textContent = crashed ? "−100.00%  LIQUIDATED" : "−0.4%  pre-market wobble";
      dEl.style.color = crashed ? "#ff5b5b" : "#ffd451";
    }
    if (cEl) cEl.textContent = fmt(cash);
    if (bEl) bEl.textContent = fmt(bank);
    if (aEl) aEl.style.display = crashed ? "block" : "none";
  }

  function fireExecCrash() {
    const T = ORIGIN_TUNING.exec;
    const fmt$ = function (n) { return "$" + Math.round(Math.max(0, n || 0)).toLocaleString(); };
    let lost = 0;
    if (CBZ.CONFIG && CBZ.CONFIG.EXEC_REAL_CRASH) {
      // THE CRASH IS REAL, end to end:
      //  1) the MARKET collapses — stocks.crashAll() marks every listing down
      //     ~97% in one print (every chart, ticker, adboard and phone STOCKS
      //     row shows the same cliff, and stays red);
      //  2) the MARGIN CALL — the broker force-liquidates every position at
      //     the crashed prints through the real sell API (proceeds land in
      //     cash via the canonical faucet);
      //  3) the SEIZURE — proceeds, walking-around cash and the account sweep
      //     all go against the margin loan; it STILL doesn't cover it. Balance
      //     zero, residual loan due. Every readout (laptop, charpanel
      //     netWorth, phone bank app) reads the same zeros because they all
      //     read the same state this actually changed.
      const S = CBZ.stocks;
      const cash0 = g.cash || 0, bank0 = g.cityBank || 0;
      let port0 = 0;
      if (S && S.portfolioValue) { try { port0 = S.portfolioValue(); } catch (e) {} }
      if (S && S.crashAll) { try { S.crashAll(0.97); } catch (e) {} }
      if (S && S.sellAll && g.cityPortfolio) {
        try { for (const sym of Object.keys(g.cityPortfolio)) S.sellAll(sym); } catch (e) {}
      }
      lost = Math.round(cash0 + bank0 + port0);
      g.cash = 0;
      g.cityBank = 0;
      g.cityDebt = Math.max(g.cityDebt || 0, T.marginDebt || 250000);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    } else {
      // legacy scripted zero-out (EXEC_REAL_CRASH off)
      lost = (g.cash || 0) + (g.cityBank || 0);
      g.cash = 0;
      g.cityBank = 0;
      if (g.cityDebt == null || g.cityDebt < 250000) g.cityDebt = 250000;  // margin loan still due
    }
    paintLaptop(0, 0, true);
    if (CBZ.cityWorldCommit) try { CBZ.cityWorldCommit(); } catch (e) {}
    if (CBZ.cityPhoneNotify) {
      try {
        CBZ.cityPhoneNotify({
          app: "bank",
          from: "Apex Brokerage",
          text: "MARGIN CALL, positions liquidated at the low. " + fmt$(lost) +
            " gone. Outstanding margin balance " + fmt$((T.marginDebt || 250000)) + " due immediately.",
        });
      } catch (e) {}
    }
    if (CBZ.city) {
      CBZ.city.big("−" + fmt$(lost));
    }
    if (CBZ.sfx) try { CBZ.sfx("empty"); } catch (e) {}
  }

  // SCENE: the executive floor at the crown of the tallest tower (storey 50
  // of the Spire, ~160m — exec_office.js's suite; tallest-office fallback),
  // laptop crash, then free-roam descent to street level (the suite's express
  // lift rides straight to the door; the walk-in tower lift serves the roof).
  function sceneExec(game) {
    const lot = findExecTower();
    if (!lot || !lot.building) return null;
    const b = lot.building;
    const FH = b.FH || 4.6;
    const storeys = b.storeys || 1;
    const eo = b.execOffice && b.execOffice.floorY != null ? b.execOffice : null;
    const floorY = eo ? eo.floorY
      : (b.floorTops && b.floorTops[storeys - 1] != null) ? b.floorTops[storeys - 1] : (storeys - 1) * FH;
    const groundY = (b.floorTops && b.floorTops[0] != null) ? b.floorTops[0] : 0;
    const w = b.w || (lot.w || 24);
    const bx = (b.ox != null) ? b.ox : lot.cx, bz = (b.oz != null) ? b.oz : lot.cz;
    // In the suite he stands behind HIS desk facing the office door; the
    // generic fallback keeps the old stairwell-facing placement.
    const entry = (eo && eo.face) ? { x: eo.face.x, z: eo.face.z }
      : clearSpot(b, floorY, bx - w / 2 + (b.stairW || 3.2) + 1.4, bz);
    const spot = (eo && eo.spawn) ? clearSpot(b, floorY, eo.spawn.x, eo.spawn.z, 2.5)
      : clearSpot(b, floorY, bx + w / 2 - 2.4, bz);

    const P = CBZ.player;
    P.pos.set(spot.x, floorY, spot.z); P.vy = 0; P.grounded = true;
    const facing = Math.atan2(entry.x - spot.x, entry.z - spot.z);
    if (CBZ.playerChar) { CBZ.playerChar.group.position.copy(P.pos); CBZ.playerChar.group.rotation.set(0, facing, 0); }
    if (CBZ.cam) { CBZ.cam.yaw = facing + Math.PI; CBZ.cam.pitch = 0.32; }

    // Home spawn = this tower's door so dying later doesn't yeet you to the airport.
    try {
      if (b.door) g.citySpawnPoint = { x: b.door.x, z: b.door.z };
      else g.citySpawnPoint = { x: lot.cx, z: lot.cz };
    } catch (e) {}

    // (no narrator card: the suite, the suit and the laptop say who he is)

    const T = ORIGIN_TUNING.exec;
    paintLaptop(g.cash != null ? g.cash : T.startCash, execBrokerage() || T.startBank, false);
    showLaptop(true);

    scene = {
      kind: "exec", t: 0, phase: "laptop", crashed: false, hinted: false,
      floorY: floorY, groundY: groundY, lot: lot, entry: entry,
      cops: [], barkT: -99,
      // Wall-clock anchor: headless SwiftShader crawls sim-dt ~60×, so the
      // laptop/phone beat must not depend on accumulated game dt alone.
      wall0: (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(),
      cleanup: function () {
        showLaptop(false);
        for (const c of this.cops) despawnActor(c);
        this.cops.length = 0;
      },
    };
    return { compact: true };
  }

  function execWallSec(s) {
    const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    return Math.max(0, (now - (s.wall0 || now)) / 1000);
  }

  function tickExec(dt) {
    const s = scene;
    const T = ORIGIN_TUNING.exec;
    s.t += dt;
    const P = CBZ.player;
    // Prefer wall-clock for the staged laptop beat; sim dt still drives descend.
    const wt = execWallSec(s);

    if (s.phase === "laptop") {
      // The laptop shows the REAL balances (live cash + live portfolio value —
      // the same numbers charpanel/netWorth read) with a cosmetic pre-market
      // flutter, then the real crash fires.
      if (!s.crashed && wt >= T.crashAfterSec) {
        s.crashed = true;
        fireExecCrash();
      } else if (!s.crashed) {
        const flut = 1 + Math.sin(wt * 9.1) * 0.004;   // deterministic display flutter only
        paintLaptop(Math.round(g.cash || 0), Math.round(execBrokerage() * flut), false);
      }
      if (wt >= T.laptopSec) {
        showLaptop(false);
        s.phase = "descend"; s.t = 0;
        s.wall0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        if (CBZ.city) {
          if (CBZ.city.big) CBZ.city.big("↓ GROUND FLOOR");
        }
        // The door waypoint, the objective line and the payout for reaching
        // the street belong to the onboarding chain below (step "street"),
        // which clears its own pin on arrival. This beat only narrates.
      }
      return;
    }

    if (s.phase === "descend") {
      // Free movement — player can already use elevators/stairs. End the
      // scripted beat once they're near ground floor of this tower OR far
      // enough from the top plate that they clearly left the penthouse.
      if (!P || !P.pos) return;
      const nearGround = P.pos.y <= (s.groundY + T.groundYSlop);
      const leftTop = P.pos.y < (s.floorY - 3.5);
      if (nearGround || leftTop) {
        s.phase = "street"; s.t = 0;
        if (CBZ.city) {
          CBZ.city.big("LEVEL 1");
        }
        // (A 35% coin-flip 1-star "margin inquiry" used to fire here: the
        // reward for finishing the opening objective was a random police
        // chase you did nothing to cause. Heat is earned by what you do.)
        clearScene();
      }
    }
  }

  // ---------------------------------------------------------------
  // BARFLY — thrown out of a small-town bar, broke and in debt
  // ---------------------------------------------------------------
  // GRANTS (defect #3): apply unconditionally — a broke drunk is broke and
  // in debt whether or not a bar lot can be found for the toss scene.
  function grantBarfly(game) {
    const T = ORIGIN_TUNING.barfly;
    stripLoadout();                                // he drank the gun money
    game.cash = T.startCash; game.cityDebt = T.startDebt;   // cityOriginApply commits right after
    if (CBZ.cityDrink) { try { CBZ.cityDrink(T.drunkLevel); } catch (e) {} }
  }
  // THE BAR'S FRONT DOOR, dressed like one: a pair of wall lanterns on the
  // door casing lit amber, a rubber door mat, a steel ash urn with the night's
  // butts round its foot, and a neon beer mug on a black backer in the window
  // (no invented words: the building's own sign already names the place).
  // props.js already stands a patio set / A-frame on bar frontages, so this
  // stays inside the door's own 2 m and never on the kerb. (fx, fz) is the
  // threshold on the facade, (ox, oz) points OUT. Built once per bar lot with
  // the mesh kit; a rebuilt city is a new lot, so it is rebuilt with it.
  function dressBarFront(A, lot, fx, fz, ox, oz) {
    const THREE = window.THREE;
    if (!THREE || !A || !A.root || !CBZ.cityMeshKit || !lot || !lot.building) return;
    if (lot.building._barFront && lot.building._barFront.parent) return;
    const gy = CBZ.floorAt ? CBZ.floorAt(fx + ox * 0.6, fz + oz * 0.6) : 0;
    const K = CBZ.cityMeshKit(gy), M = K.M;
    const yaw = Math.atan2(ox, oz);           // frame: +z = out to the street, +x along the facade
    K.at(fx, fz, yaw);
    // door mat: black rubber with raised ribs
    K.rbox(M.satin, 0, 0.008, 0.55, 1.05, 0.016, 0.62, 0.006, 0x151617);
    for (let i = -6; i <= 6; i++) K.box(M.satin, i * 0.075, 0.017, 0.55, 0.02, 0.004, 0.54, 0x0b0c0d);
    // two lanterns on the casing: backplate, arm, a boxy black frame with
    // amber glass on all four sides, a cap
    for (const s of [-1, 1]) {
      const lx = s * 0.87, ly = 2.0;
      K.rbox(M.satin, lx, ly, 0.1, 0.1, 0.2, 0.02, 0.006, 0x16171a);
      K.box(M.satin, lx, ly + 0.02, 0.17, 0.03, 0.03, 0.14, 0x16171a);
      for (const cx of [-1, 1]) for (const cz of [-1, 1]) K.box(M.satin, lx + cx * 0.07, ly - 0.02, 0.26 + cz * 0.07, 0.016, 0.26, 0.016, 0x16171a);
      K.box(M.emit, lx, ly - 0.02, 0.26, 0.13, 0.22, 0.13, 0xffb24a);
      K.cyl(M.satin, lx, ly + 0.14, 0.26, 0.02, 0.11, 0.06, 4, 0x16171a, 0, Math.PI / 4);
      K.box(M.satin, lx, ly - 0.155, 0.26, 0.17, 0.03, 0.17, 0x16171a);
    }
    // the ash urn by the door, and the butts nobody swept
    K.at(fx, fz, yaw);
    K.cyl(M.steel, -1.2, 0.31, 0.4, 0.15, 0.16, 0.62, 20, 0xd2d4d6);
    K.sphere(M.steel, -1.2, 0.62, 0.4, 0.15, 0xd2d4d6, 1, 0.35, 1);
    K.cyl(M.paint, -1.2, 0.66, 0.4, 0.09, 0.09, 0.01, 16, 0xcfc5b0);
    const hs = CBZ.cityMeshKit.hash;
    for (let i = 0; i < 7; i++) {
      const a = hs(i, 9) * 6.28, r = 0.22 + hs(i, 10) * 0.35;
      K.cyl(M.paint, -1.2 + Math.cos(a) * r, 0.006, 0.4 + Math.sin(a) * r, 0.0045, 0.0045, 0.03, 6, i & 1 ? 0xefe9dc : 0xc98f4d, 0, a, Math.PI / 2);
    }
    // the neon: a beer mug on a black backer, hung on the window beside the door
    const nx0 = 1.95, ny0 = 1.62, nz0 = 0.06;
    K.rbox(M.satin, nx0, ny0, nz0, 0.66, 0.56, 0.02, 0.01, 0x0d0e10);
    const T = function (a, b, c) { K.tube(M.emit, [nx0 + a[0], ny0 + a[1], nz0 + 0.025], [nx0 + b[0], ny0 + b[1], nz0 + 0.025], 0.009, c || 0xffb03a, 6); };
    T([-0.14, -0.2], [0.1, -0.2]); T([-0.14, -0.2], [-0.16, 0.14]); T([0.1, -0.2], [0.12, 0.14]);
    T([0.12, 0.02], [0.2, 0.02]); T([0.2, 0.02], [0.2, 0.1]); T([0.2, 0.1], [0.12, 0.1]);
    const foam = [[-0.18, 0.14], [-0.12, 0.2], [-0.06, 0.16], [0.0, 0.21], [0.06, 0.16], [0.12, 0.2], [0.15, 0.14]];
    for (let i = 0; i < foam.length - 1; i++) T(foam[i], foam[i + 1], 0xfff3d6);
    T([-0.08, -0.14], [-0.08, 0.06], 0xffd27a); T([0.04, -0.14], [0.04, 0.06], 0xffd27a);
    const grp = new THREE.Group();
    grp.name = "bar-front";
    K.flush(grp, "bar-front");
    A.root.add(grp);
    lot.building._barFront = grp;
  }
  // SCENE (may fail — no bar lot AND no arena spawn to fall back to, which
  // only happens if the arena itself never built): the door + bouncer toss.
  function sceneBarfly(game) {
    const A = arena();
    const lot = findBarLot();
    // THROWN OUT MEANS OUT. building.door is buildings.js's doorPt: 1.6 m
    // INSIDE the facade, carrying doorInfo's INWARD normal (the club block in
    // buildings.js says so and negates it). This scene read it as an outward
    // door on the street, so the player spawned ~3 m inside the bar and the
    // bouncer "threw him out" deeper into the room. Now: (doorX, doorZ) is the
    // threshold on the facade, (nx, nz) points OUT to the sidewalk, the
    // bouncer fills the doorway and the player lands on the pavement.
    let doorX, doorZ, nx = 0, nz = 1;
    if (lot && lot.building && lot.building.door) {
      const door = lot.building.door;
      nx = -(door.nx || 0); nz = -(door.nz || 0);
      if (!nx && !nz) nz = 1;
      doorX = door.x + nx * 1.6; doorZ = door.z + nz * 1.6;     // back out to the facade line
      dressBarFront(A, lot, doorX, doorZ, nx, nz);
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

    let bouncer = null;
    if (CBZ.cityMakePed && CBZ.cityPeds && A && A.root) {
      bouncer = CBZ.cityMakePed(doorX + nx * 0.35, doorZ + nz * 0.35, Math.random, {
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
    const T = ORIGIN_TUNING.barfly;
    s.t += dt;
    // keep the scripted doorman breathing while he stands there — controlled
    // peds are skipped by the civilian brain (peds.js), so nobody else
    // animates him; a statue at the door reads as a bug, not a bouncer.
    if (s.bouncer && s.bouncer.char && CBZ.animChar && (s.phase === "stand" || s.phase === "toss")) {
      CBZ.animChar(s.bouncer.char, 0, dt);
    }
    if (s.phase === "stand") {
      if (s.t < T.standSec) return;
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
      ph.vx = s.nx * T.tossSpeedXZ; ph.vz = s.nz * T.tossSpeedXZ;
      ph.vy = T.tossSpeedY; ph.spin = T.tossSpin;
      if (CBZ.shake) CBZ.shake(T.shakeAmt);
      if (s.bouncer && CBZ.speech) CBZ.speech.say(s.bouncer, "AND STAY OUT!", { secs: 2.6, force: true });
      if (s.bouncer && s.bouncer.group) s.bouncer.group.rotation.y = Math.atan2(-s.nx, -s.nz);
      return;
    }
    if (s.phase === "toss") {
      // let the landing play out, then the doorman turns and walks back
      // inside — he only despawns once he's in the doorway (or the beat
      // times out), never blinking out of existence in front of the player.
      if (s.t >= T.tossSec) { s.phase = "return"; s.rt = 0; }
      return;
    }
    if (s.phase === "return") {
      s.rt = (s.rt || 0) + dt;
      const bn = s.bouncer;
      if (!bn || !bn.group) { s.phase = "done"; clearScene(); return; }
      const gd = stepScriptedTo(bn, s.gy || 0, s.doorX - s.nx * 1.2, s.doorZ - s.nz * 1.2, T.returnSpeed, dt);
      if (gd < 0.5 || s.rt > T.returnTimeoutSec) { s.phase = "done"; clearScene(); }
    }
  }

  // ---------------------------------------------------------------
  // TENANT — a wife-beater, a twin air mattress, $12 and a pistol
  // ---------------------------------------------------------------
  // GRANTS (defect #3): cash/outfit/pistol apply unconditionally, whether or
  // not a real tower unit can be found for the mattress dressing.
  function grantTenant(game) {
    const T = ORIGIN_TUNING.tenant;
    game.cash = T.startCash; game.cityBank = T.startBank;    // cityOriginApply commits right after
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
  }
  // SCENE (may fail — no tower unit AND no arena spawn, i.e. the arena never
  // built): places the player + the air-mattress dressing.
  function sceneTenant(game) {
    const A = arena();
    const lot = findTenantTower();
    let px, pz, mx, mz, myaw = null, floorY;
    if (lot && lot.building) {
      const b = lot.building;
      floorY = tenantFloorY(lot);
      const bx = (b.ox != null) ? b.ox : lot.cx, bz = (b.oz != null) ? b.oz : lot.cz;
      // both the standing spot and the mattress get validated OPEN floor
      // (clearSpot: walls / stair run / shaft / the floor's real furniture
      // colliders) — a micro-unit floor plate is already furnished, and
      // spawning the player inside a partition wall reads as a broken game.
      const sp = clearSpot(b, floorY, bx + 1.2, bz + 0.8);
      px = sp.x; pz = sp.z;
      // the squat goes AGAINST the nearest wall, its whole footprint (the
      // mattress, the crate, the duffel, the blanket spill) on open floor
      const wl = wallBeside(b, floorY, px, pz, 5.0);
      if (wl) {
        const HALF = 0.485 + 0.03;                      // mattress half-width + a finger of air
        const t0 = wl.alongX ? px : pz;
        const yaw = Math.atan2(wl.nx, wl.nz);           // local +z = the open floor
        const cands = [t0, t0 + 1.2, t0 - 1.2, t0 + 2.4, t0 - 2.4];
        for (const tc of cands) {
          const t = Math.max(wl.lo + 1.6, Math.min(wl.hi - 1.8, tc));
          const cx = wl.alongX ? t : wl.face + wl.nx * HALF;
          const cz = wl.alongX ? wl.face + wl.nz * HALF : t;
          if (squatFits(b, floorY, cx, cz, yaw)) { mx = cx; mz = cz; myaw = yaw; break; }
        }
      }
      if (myaw == null) {
        const ms = clearSpot(b, floorY, px - 1.7, pz - 0.4);
        mx = ms.x; mz = ms.z;
        if (Math.hypot(mx - px, mz - pz) < 0.9) { mx = px - 1.7; mz = pz - 0.4; }   // never on top of the player
      } else {
        // he is on his feet on the open side, a step off the mattress's middle
        const s = clearSpot(b, floorY, mx + Math.sin(myaw) * 1.45 + Math.cos(myaw) * 0.35, mz + Math.cos(myaw) * 1.45 - Math.sin(myaw) * 0.35, 2.0);
        px = s.x; pz = s.z;
      }
    } else if (A && A.spawn) {
      px = A.spawn.x; pz = A.spawn.z; floorY = 0.14;
      mx = px - 1.6; mz = pz - 0.3;
    } else return null;

    const P = CBZ.player;
    P.pos.set(px, floorY, pz); P.vy = 0; P.grounded = true;
    const facing = Math.atan2(mx - px, mz - pz);
    if (CBZ.playerChar) { CBZ.playerChar.group.position.copy(P.pos); CBZ.playerChar.group.rotation.set(0, facing, 0); }
    if (CBZ.cam) { CBZ.cam.yaw = facing + Math.PI; CBZ.cam.pitch = 0.34; }

    if (A && A.root) buildSquat(A.root, mx, floorY, mz, myaw != null ? myaw : facing + Math.PI);

    scene = null;   // static dressing only — no ongoing scripted beat
    return { compact: true };
  }

  /* ==================================================================
     THE ORIGIN GENERATOR — a story is a COMPOSITION, not a script.

     OWNER DIRECTION: "the stories should be changed to random — which we
     have 3 right now that could be made into presets but could be
     generatable as random."

     That is exactly the right shape, and it is the BLOCK LAW applied to
     narrative: the three hand-written openings above are each ~120 lines of
     bespoke scene code, so a fourth cost a fourth ~120 lines and a random one
     was impossible. Underneath, though, they only ever differ along SIX AXES:

       WHO    you are            -> outfit, title, the level you start at
       WHERE  you wake up        -> a place the world ALREADY BUILT
       PURSE  what you have      -> cash / bank / debt
       ARMS   what you carry     -> the loadout, or nothing
       HEAT   who wants you dead -> nobody / a shark / a crew / everyone
       VERB   the opening beat   -> get down / get out / get paid / stay alive

     So the axes are the data and the presets are frozen rolls of them. THE
     EXECUTIVE is {exec, tower_top, rich_broke, none, none, descend}. A random
     origin is the same generator with the dice unpinned. Adding a seventh
     story is a row, not a file.

     THE BINDING RULE is contracts.js's, and it is binding here too: THE
     GENERATOR PICKS THE VERB, THE WORLD SUPPLIES THE SPECIFICS. A `where`
     never builds a room — it FINDS one the city generated. A `heat` never
     spawns an enemy — it makes somebody the simulation was already running
     hostile. If the world cannot supply the specifics, the axis degrades to
     a street corner and says so in the feed, exactly as the three hand-
     written scenes already do through missedLotFeed.

     DETERMINISM: this is NOT a world-build path — it grants money and places
     a body, it does not generate terrain — so the roll may use Math.random.
     It is rolled ONCE and PERSISTED onto the character's ledger (w.originRoll),
     so reloading that character replays the same person rather than rerolling
     them into somebody else.
     ================================================================== */

  // A site resolver is the ground-origin equivalent of a lot finder: it asks a
  // world capability for a spawn, never types another venue coordinate.
  // The President wakes in the Executive Mansion's motor court — the complex
  // govcomplex.js placed on its own land (CBZ.govComplexes). Never null: a
  // world without the complex degrades to the arena spawn so the swear-in
  // verb still runs (the SEAT is this story, not the address).
  function mansionSpawn() {
    const L = CBZ.govComplexes;
    if (Array.isArray(L)) {
      for (let i = 0; i < L.length; i++) {
        const s = L[i];
        if (!s || s.id !== "execmansion" || !s.rect) continue;
        const x = s.cx, z = s.cz + 10;                       // the motor court
        const dx = s.cx - x, dz = (s.cz - 17) - z;           // face the front door
        return { x: x, z: z, y: CBZ.floorAt ? CBZ.floorAt(x, z) : 0.14, heading: Math.atan2(dx, dz) };
      }
    }
    const A = arena();
    const sp = (A && A.spawn) || { x: 0, z: 0 };
    return { x: sp.x, z: sp.z, y: CBZ.floorAt ? CBZ.floorAt(sp.x, sp.z) : 0.14, heading: 0 };
  }
  function speedwaySpawn() {
    const c = (CBZ.raceKit && CBZ.raceKit.course && CBZ.raceKit.course("speedway")) || CBZ.speedwayCourse;
    if (!c || typeof c.line !== "function") return null;
    const f = c.line(c.startT || 0), out = (c.trackHalf || 11) + 18;
    const x = f.x + f.nx * out, z = f.z + f.nz * out;
    return {
      x: x, z: z, y: CBZ.floorAt ? CBZ.floorAt(x, z) : 0.14,
      heading: f.heading + Math.PI,
    };
  }

  const AXES = {
    // ---- WHO: the costume, the title, and where you sit in the world -----
    who: {
      exec:    { name: "The Executive", outfit: "suit",       title: "Executive",     blurb: "suit, gold watch, zero dollars" },
      barfly:  { name: "The Barfly",    outfit: "street",     title: "Regular",       blurb: "last call, every call" },
      tenant:  { name: "The Tenant",    outfit: "wifebeater", title: "Tenant",        blurb: "one room, one way out" },
      hitman:  { name: "The Hitman",    outfit: "suit",       title: "Contractor",    blurb: "somebody paid for a name" },
      pilot:   { name: "The Pilot",     outfit: "pilot",      title: "Pilot",         blurb: "already airborne, already committed" },
      hustler: { name: "The Hustler",   outfit: "street",     title: "Hustler",       blurb: "a corner and a mouth on you" },
      debtor:  { name: "The Debtor",    outfit: "street",     title: "Mark",          blurb: "you are three weeks late" },
      wick:    { name: "The Marked",    outfit: "suit",       title: "Open Contract", blurb: "every single person wants the money" },
      racer:   { name: "The Racer",     outfit: "coveralls",  title: "Rookie",        blurb: "a loaner, a back-row start, one way up" },
      president: { name: "The President", outfit: "suit",     title: "President",     blurb: "sworn in this morning; the country is yours" },
      captain: { name: "The Captain",   outfit: "coveralls",  title: "Skipper",       blurb: "your own hull, a crew, and open water" },
    },

    // ---- WHERE: a lot the CITY BUILT. Never a room this file authors. ----
    // Each returns {lot|null, kind} and the placer below reads `kind` to
    // decide the beat. The finders are the ones the three original openings
    // already used, so a new story reuses proven lot searches instead of
    // inventing a seventh way to ask "where is a tall building".
    where: {
      tower_top:  { find: findExecTower,   feed: "The firm's tower is locked for the night, you ride the freight elevator down broke." },
      barfront:   { find: findBarLot,      feed: "The bar's shuttered, you wake up in the gutter anyway." },
      unit:       { find: findTenantTower, feed: "Your building's stairwell is roped off, you crash on a friend's floor instead." },
      airborne:   { find: null,            feed: "The field is fogged in. You start on the apron with the keys in your hand." },
      corner:     { find: null,            feed: "" },   // the street IS the place — never fails
      motel:      { find: findMotelLot,    feed: "No room at the motel. You slept in the stairwell." },
      // The racer does NOT start beside the track — placeComposition below
      // intercepts `speedway` and hands off to CBZ.cityRaceStart, so the story
      // opens on the back row with the lights counting down. `resolve` is now
      // purely the DEGRADE path: a world that could not field a race stands
      // you at the gate and prints the feed, which is the old opening.
      speedway:   { resolve: speedwaySpawn, feed: "The paddock is closed. You wait at the Speedway gate." },
      // never fails (internal degrade to the arena spawn — the seat is the story)
      mansion:    { resolve: mansionSpawn,  feed: "The Mansion is dark. The motorcade never came." },
    },

    // ---- PURSE: cash / bank / debt. The three numbers a start is made of.
    purse: {
      rich_broke: { cash: 2000000, bank: 8000000, debt: 250000 },   // the exec: it is all about to be gone
      broke:      { cash: 45,      bank: 0,       debt: 350 },
      nothing:    { cash: 12,      bank: 0,       debt: 0 },
      pro:        { cash: 4500,    bank: 22000,   debt: 0 },        // the hitman: paid, quiet, liquid
      wages:      { cash: 900,     bank: 3200,    debt: 0 },        // the pilot: a salary, not a fortune
      street:     { cash: 60,      bank: 0,       debt: 0 },
      underwater: { cash: 0,       bank: 0,       debt: 48000 },    // the debtor
      warchest:   { cash: 15000,   bank: 0,       debt: 0 },        // the marked man
      rookie:     { cash: 350,     bank: 0,       debt: 0 },        // enough for entry, not a career
    },

    // ---- ARMS: what is on you when the camera hands over control. --------
    // Names must be REAL catalog entries (city/economy.js's `guns` list). A
    // "Silenced Pistol" is not one and never was — a suppressor is an
    // ATTACHMENT in this game (city/gunmods.js), so `quiet` grants an ordinary
    // pistol and FITS the muzzle device, which is both the truthful model and
    // the one that actually makes the hitman quiet (fpsmode.js reads
    // CBZ.gunModsSuppressed every shot).
    arms: {
      none:     { guns: [] },
      pistol:   { guns: ["Pistol"] },
      // the fitted-mod store is keyed by the FPS weapon id (gunmods.js
      // store()[id]; combat.js GUN_MAP maps "Pistol" -> "sidearm"). The old
      // `pistol` key wrote a record gunModsSuppressed("sidearm") never read,
      // so the quiet start's suppressor never actually fit.
      quiet:    { guns: ["Pistol"], mods: { sidearm: { muzzle: "suppressor" } } },
      sidearms: { guns: ["Pistol", "SMG"] },
      full:     { guns: ["Pistol", "SMG", "Shotgun"] },
    },

    // ---- HEAT: who wants you dead. Binds to actors ALREADY IN THE WORLD. -
    heat: {
      none:     { hunters: 0, bounty: 0 },
      shark:    { hunters: 1, bounty: 0,      collector: true },  // one collector walks at you
      crew:     { hunters: 3, bounty: 25000 },
      everyone: { hunters: 12, bounty: 250000, open: true },      // the John Wick rule
    },

    // ---- VERB: the opening objective, through core/mission.js. -----------
    // No new objective UI: CLAUDE.md's mission block already owns the HUD
    // line, the waypoint, the beacon, the phone card and the payout.
    // `onboard: true` verbs are the FIRST steps of the onboarding chain below
    // ("get to the street", "make your first $500"). They used to start a
    // core/mission.js job of their own: `descend` pointed at A.spawn (the
    // AIRPORT apron, not the street) and `earn`/`settle`/`landit` were
    // goal:"custom" with no completion test, so they could never finish, sat
    // on the HUD forever and made CBZ.mission.busy() refuse every other job.
    // The chain owns the first two; the other two now carry a real `done`.
    verb: {
      descend: { id: "origin_descend", title: "Get to the street", onboard: true },
      survive: { id: "origin_survive", title: "Stay alive",        goal: "survive", reward: 5000, seconds: 180 },
      contract:{ id: "origin_hit",     title: "Fulfil the contract", goal: "kill",  reward: 25000 },
      landit:  {
        id: "origin_land", title: "Put it on the ground", goal: "custom", reward: 1500,
        // done once you have flown and are no longer at the controls
        done: function (m) {
          const P = CBZ.player;
          if (P && P._aircraft) { m.data.flew = true; return false; }
          return !!m.data.flew;
        },
        // the launch never happened (no airframe built): retire quietly
        // rather than leave an un-finishable job holding the HUD slot
        onTick: function (m) { if (!m.data.flew && m.t > PENDING_AIR_SEC + 3 && m.retire) m.retire("grounded"); },
      },
      earn:    { id: "origin_earn",    title: "Make your first $500", onboard: true },
      settle:  {
        id: "origin_settle", title: "Pay what you owe", goal: "custom", reward: { respect: 10 },
        done: function () { return (g.cityDebt || 0) <= 0; },
      },
      racecareer: {
        id: "origin_racer_career", title: "Rookie to APEX Champion", goal: "custom", reward: 0,
        start: function () { return CBZ.cityRacerCareer && CBZ.cityRacerCareer.start(); },
      },
      // the President: the verb IS taking office. presidencyBegin() runs the
      // swear-in through candidacy.js's own write path (the same bookkeeping
      // a won election performs) and arms the walk-to-the-Situation-Room
      // mission through core/mission.js. city/presidency.js owns the rest.
      govern: {
        id: "origin_govern", title: "Govern", goal: "custom", reward: 0,
        start: function () { return CBZ.presidencyBegin && CBZ.presidencyBegin(); },
      },
      // the Captain: the verb IS putting to sea. captainStart() defers until
      // the fleet exists (the pilot's own pendingAir pattern) and then hands
      // the player the helm of a real working trawler through the one enter
      // path. city/captain.js owns the rest — crew, orders, voyages.
      voyage: {
        id: "origin_voyage", title: "Take her to sea", goal: "custom", reward: 0,
        start: function () { return CBZ.captainStart && CBZ.captainStart(); },
      },
      none:    null,
    },
  };

  // A motel/cheap-room lot: the hitman's and the debtor's address. Falls back
  // through the shapes the generator actually produces, so a city that built
  // no motel still supplies a room rather than dropping the whole story.
  function findMotelLot() {
    const A = arena(); if (!A || !A.lots) return null;
    let motel = null, home = null;
    for (const lot of A.lots) {
      if (!lot || !lot.building) continue;
      const k = lot.kind;
      if (k === "motel") { motel = lot; break; }
      if (!home && (k === "home" || k === "house" || k === "tower")) home = lot;
    }
    return motel || home;
  }
  // the ONE motel finder — city/hitman.js (the room annex) and city/campaign.js
  // (the merged opening) resolve the same address this file's presets use.
  CBZ.cityFindMotelLot = findMotelLot;

  /* ---- THE PRESETS ------------------------------------------------------
     Frozen rolls. Read one row and you know the whole story — which is the
     point: the three originals were 120 lines each and you could not. */
  const PRESETS = {
    exec:    { who: "exec",    where: "tower_top", purse: "rich_broke", arms: "none",     heat: "none",     verb: "descend" },
    barfly:  { who: "barfly",  where: "barfront",  purse: "broke",      arms: "none",     heat: "none",     verb: "none" },
    tenant:  { who: "tenant",  where: "unit",      purse: "nothing",    arms: "pistol",   heat: "none",     verb: "none" },
    hitman:  { who: "hitman",  where: "motel",     purse: "pro",        arms: "quiet",    heat: "none",     verb: "contract" },
    pilot:   { who: "pilot",   where: "airborne",  purse: "wages",      arms: "pistol",   heat: "none",     verb: "landit" },
    hustler: { who: "hustler", where: "corner",    purse: "street",     arms: "none",     heat: "none",     verb: "earn" },
    debtor:  { who: "debtor",  where: "motel",     purse: "underwater", arms: "none",     heat: "shark",    verb: "settle" },
    wick:    { who: "wick",    where: "unit",      purse: "warchest",   arms: "full",     heat: "everyone", verb: "survive" },
    racer:   { who: "racer",   where: "speedway",  purse: "rookie",     arms: "none",     heat: "none",     verb: "racecareer" },
    president: { who: "president", where: "mansion", purse: "wages",    arms: "none",     heat: "none",     verb: "govern" },
    captain: { who: "captain", where: "corner",    purse: "wages",      arms: "none",     heat: "none",     verb: "voyage" },
  };

  /* ---- THE ROLL ---------------------------------------------------------
     A random origin is not a random NOISE — an unconstrained roll produces
     nonsense like a penniless executive with an open contract in a cockpit.
     The axes are drawn, then three coherence rules run, which is the whole
     difference between "generated" and "generated and worth playing":
       1. WHERE follows WHO where the who implies an address (a pilot is in a
          cockpit, an executive is in a tower) — otherwise it is free.
       2. HEAT buys ARMS. Nobody is hunted by twelve people and unarmed.
       3. The VERB must be answerable from the PURSE — you are not asked to
          settle a debt you do not have. */
  function pick(obj, rnd) { const k = Object.keys(obj); return k[(rnd() * k.length) | 0]; }
  function rollOrigin(rnd) {
    rnd = rnd || Math.random;
    const comp = {
      who: pick(AXES.who, rnd), where: pick(AXES.where, rnd), purse: pick(AXES.purse, rnd),
      arms: pick(AXES.arms, rnd), heat: pick(AXES.heat, rnd), verb: pick(AXES.verb, rnd),
      generated: true,
    };
    // 1. an address the person would actually have
    if (comp.who === "pilot") comp.where = "airborne";
    else if (comp.who === "exec") comp.where = "tower_top";
    else if (comp.who === "racer") comp.where = "speedway";
    else if (comp.who === "president") comp.where = "mansion";   // a head of state has an address
    else if (comp.where === "airborne") comp.where = "corner";   // only a pilot starts in the air
    else if (comp.where === "mansion") comp.where = "corner";    // only the President wakes in the Mansion
    // 2. hunted people are armed
    const h = AXES.heat[comp.heat];
    if (h.hunters >= 3 && comp.arms === "none") comp.arms = h.hunters >= 12 ? "full" : "sidearms";
    // 3. the objective must be answerable
    const p = AXES.purse[comp.purse];
    if (comp.verb === "settle" && !(p.debt > 0)) comp.verb = "earn";
    if (comp.verb === "descend" && comp.where !== "tower_top") comp.verb = "earn";
    if (comp.verb === "landit" && comp.where !== "airborne") comp.verb = "earn";
    if (comp.verb === "contract" && comp.arms === "none") comp.arms = "quiet";
    if (comp.verb === "racecareer") { comp.who = "racer"; comp.where = "speedway"; }
    if (comp.verb === "govern") { comp.who = "president"; comp.where = "mansion"; }   // only a President governs
    if (comp.who === "captain" || comp.verb === "voyage") { comp.who = "captain"; comp.verb = "voyage"; }   // a captain sails, and only a captain has a boat waiting
    return comp;
  }
  CBZ.cityOriginRoll = rollOrigin;             // exposed for the title screen's re-roll
  CBZ.cityOriginAxes = function () { return AXES; };

  // A one-line human description of a rolled composition, for the picker card.
  CBZ.cityOriginDescribe = function (comp) {
    if (!comp) return "";
    const w = AXES.who[comp.who] || {}, p = AXES.purse[comp.purse] || {}, h = AXES.heat[comp.heat] || {};
    const money = p.debt > 0 && !p.cash ? "$" + p.debt.toLocaleString() + " in the hole"
      : "$" + (p.cash || 0).toLocaleString();
    const chased = h.open ? "everyone wants you" : h.hunters >= 3 ? "a crew wants you"
      : h.hunters ? "somebody wants paying" : "nobody knows you";
    return money + " · " + chased;
  };

  /* ---- THE PLANE PICKER -------------------------------------------------
     The PILOT origin opens in the air, and the owner asked for "EVERY PLANE
     IN GAME AS OPTIONS". This does not maintain a list — a hand-kept list is
     exactly the thing that goes stale the day somebody adds an airframe. It
     reads the LIVE registry militaryvehicles.js already keeps
     (CBZ.cityMilitaryVehicles: the airport's airliners and private jets, the
     base's fighters, the heavy bomber, the helicopters, and strategic.js's
     B-2), and every future aircraft appears in the picker the moment it
     registers, with no edit here. */
  CBZ.cityOriginPlanes = function () {
    const out = [];
    const seen = {};
    const recs = CBZ.cityMilitaryVehicles || [];
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (!r || (r.kind !== "plane" && r.kind !== "heli")) continue;
      const name = (r.model && r.model.name) || (r.kind === "heli" ? "Helicopter" : "Aircraft");
      if (seen[name]) continue;
      seen[name] = 1;
      out.push({ id: name, name: name, kind: r.kind, rec: r });
    }
    return out;
  };
  // The title screen stores a NAME, not a record — records do not exist until
  // the world is built, and the pick is made before that.
  CBZ.setCityOriginPlane = function (name) { g.cityOriginPlane = name || null; };
  CBZ.cityOriginPlane = function () { return g.cityOriginPlane || null; };

  /* ---- THE BOAT PICKER ---------------------------------------------------
     OWNER (2026-08-12): "captain like pilot should let me select any boat in
     start menu." Same law as the aircraft list above, and it does not keep a
     list either — a hand-typed fleet goes stale the day somebody registers a
     twelfth hull.

     ONE DIFFERENCE, AND IT IS AN IMPROVEMENT. The aircraft list has to ship
     FALLBACK_PLANES because militaryvehicles.js only registers once a world
     exists, and the pick happens before that. world/water_hulls.js's registry
     is filled at PARSE time — the four authored hulls plus every row
     city/yachts.js queues ahead of it — so at the title screen this answers
     with the REAL fleet, names, lengths and all. No fallback, nothing to drift.

     Sorted by length, because a picker of boats is a picker of sizes. */
  CBZ.cityOriginBoats = function () {
    const R = CBZ.marineHulls;
    if (!R || !R.list) return [];
    const out = [];
    try {
      for (const rec of R.list()) {
        const h = rec && (rec.hull || rec.spec);
        if (!h || !isFinite(h.loa)) continue;
        const name = rec.label || rec.model || rec.key;
        out.push({ id: rec.key, name: name, loa: +h.loa,
          label: name + " · " + Math.round(h.loa) + " m" });
      }
    } catch (e) { return out; }
    out.sort(function (a, b) { return a.loa - b.loa; });
    return out;
  };
  // A KEY, not a name — unlike the aircraft case the registry is live when the
  // pick is made, so there is nothing to resolve later and nothing to mis-case.
  CBZ.setCityOriginBoat = function (key) { g.cityOriginBoat = key || null; };
  CBZ.cityOriginBoat = function () { return g.cityOriginBoat || null; };
  /* THE PICK, RESOLVED — never null and never a key that is not registered.
     The pick if it still resolves, else the working trawler this story has
     always described, else anything that floats, because a build with
     YACHT_FLEET off has no trawler and must still put the man to sea. This is
     what the title screen LIGHTS UP; city/captain.js layers one more rule on
     top of it (a captain who owns a boat and never touched the picker keeps
     her — see flag() there), which is why that file reads the raw field too. */
  CBZ.cityOriginBoatKey = function () {
    const rows = CBZ.cityOriginBoats();
    if (!rows.length) return g.cityOriginBoat || "trawler";
    const want = g.cityOriginBoat;
    for (let i = 0; i < rows.length; i++) if (rows[i].id === want) return want;
    for (let i = 0; i < rows.length; i++) if (rows[i].id === "trawler") return "trawler";
    return rows[0].id;
  };

  /* ---- APPLYING A COMPOSITION -------------------------------------------
     One function replaces the six grant* functions a six-story registry would
     otherwise need. */
  function applyGrants(comp, game) {
    const W = AXES.who[comp.who] || AXES.who.tenant;
    const P = AXES.purse[comp.purse] || AXES.purse.nothing;
    game.cash = P.cash; game.cityBank = P.bank;
    if (P.debt) game.cityDebt = Math.max(game.cityDebt || 0, P.debt);

    const cat = CBZ.cityOutfitCatalog ? CBZ.cityOutfitCatalog() : null;
    const outfitId = (cat && cat[W.outfit]) ? W.outfit : "street";
    if (CBZ.cityWearOutfit) CBZ.cityWearOutfit(outfitId, { silent: true });

    // Loadout: the exact reset -> unlock -> fpsReset order mode.js itself
    // uses, so weapons arrive with clean base mags.
    const A = AXES.arms[comp.arms] || AXES.arms.none;
    const guns = A.guns || [];
    if (CBZ.resetWeaponInventory) CBZ.resetWeaponInventory();
    for (let i = 0; i < guns.length; i++) {
      if (CBZ.cityGiveWeapon) CBZ.cityGiveWeapon(guns[i]);
      else if (CBZ.unlockWeapon) CBZ.unlockWeapon("sidearm", { select: i === 0 });
    }
    // Fitted attachments ride the SAME store the mod bench writes
    // (g.cityGunMods[weaponId] = {scope, mag, muzzle, under}), so a story that
    // starts you with a suppressed pistol and one you assembled at the bench
    // are the same state — no second "story weapons" ledger.
    if (A.mods) {
      g.cityGunMods = g.cityGunMods || {};
      for (const wid in A.mods) {
        const cur = g.cityGunMods[wid] || { scope: null, mag: null, muzzle: null, under: null };
        const want = A.mods[wid];
        for (const slot in want) cur[slot] = want[slot];
        g.cityGunMods[wid] = cur;
      }
      if (CBZ.gunModsDressAll) { try { CBZ.gunModsDressAll(); } catch (e) {} }
    }
    if (CBZ.fpsResetWeapons) CBZ.fpsResetWeapons();

    // HEAT is a real price on your head, on the existing wanted.js channel —
    // no second bounty ledger (CLAUDE.md bans the parallel-bookkeeping trap).
    const H = AXES.heat[comp.heat] || AXES.heat.none;
    if (H.bounty) game.cityBounty = Math.max(game.cityBounty || 0, H.bounty);
    game._originHunters = H.hunters || 0;
    game._originOpenContract = !!H.open;
  }

  /* HEAT, made real. THE BINDING RULE: this never spawns a hunter. It walks
     the peds the simulation is ALREADY running and flips the ONE field every
     tactical surface in the game reads — `huntPlayer`, the field
     systems/markers.js's cityTargetsPlayer() publishes from. Flipping it
     lights the minimap threat blip, the overhead marker, the HUD and the
     fullmap for free, and costs no new AI. If the world has not populated
     yet, the tick below keeps trying until it has. */
  let heatPending = 0, heatOpen = false, heatT = 0;
  function armHeat(game) {
    heatPending = game._originHunters || 0;
    heatOpen = !!game._originOpenContract;
    heatT = 0;
  }
  function tickHeat(dt) {
    if (heatPending <= 0 && !heatOpen) return;
    heatT -= dt;
    if (heatT > 0) return;
    // An OPEN contract keeps topping itself up — that is what "everyone is
    // trying to kill you" means: not twelve enemies, but a world in which
    // anyone near you may decide today is the day. A closed one arms its
    // hunters once and is done.
    heatT = heatOpen ? 6 : 0.5;
    const peds = CBZ.cityPeds || [];
    if (!peds.length) { heatT = 1; return; }
    const P = CBZ.player; if (!P || !P.pos) return;
    let armed = 0;
    const want = heatOpen ? 2 : heatPending;
    for (let i = 0; i < peds.length && armed < want; i++) {
      const p = peds[(i * 7 + ((heatT * 991) | 0)) % peds.length];
      if (!p || p.dead || p.huntPlayer > 0 || p.vendor || p.isFamily) continue;
      if (p._campaignTarget || p._campaignCaptive) continue;
      const dx = p.pos.x - P.pos.x, dz = p.pos.z - P.pos.z, d2 = dx * dx + dz * dz;
      // near enough to matter, far enough that they arrive rather than appear
      if (d2 < 14 * 14 || d2 > 110 * 110) continue;
      p.huntPlayer = 1;
      p.hunt = Math.max(p.hunt || 0, 1);
      // Arm them the way the rest of the game arms an NPC — the four fields
      // peds.js writes (armed/weapon/ammo) plus the viewmodel sync. There is
      // no "give an NPC a gun" helper; this IS the idiom (peds.js:2635,3220,
      // gangs.js:855). A man who already has a gun keeps the one he has.
      if (!p.armed) {
        p.armed = true;
        p.weapon = p.weapon || "Pistol";
        p.ammo = p.ammo || (12 + ((heatT * 37) | 0) % 18);
        if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(p); } catch (e) {} }
      }
      armed++;
    }
    if (!heatOpen) heatPending = Math.max(0, heatPending - armed);
  }

  /* THE AIRBORNE LAUNCH, retried until an airframe exists.

     `pendingAir` is armed by the PILOT placement below and drained by the
     origins tick. It gives up after PENDING_AIR_SEC and leaves the player on
     the ground with a feed line rather than hanging forever on a world that
     built no aircraft at all (a minimal/headless city). */
  const PENDING_AIR_SEC = 6;
  let pendingAir = null;

  function tryAirborne() {
    if (!pendingAir || !CBZ.cityAirborneStart) return false;
    const comp = pendingAir.comp;
    const want = CBZ.cityOriginPlane && CBZ.cityOriginPlane();
    const planes = CBZ.cityOriginPlanes ? CBZ.cityOriginPlanes() : [];
    if (!planes.length) return false;
    // Name match first (the title-screen pick), then a same-class fallback, then
    // anything that flies — the player asked for a bomber, and being handed a
    // helicopter because the bomber did not build is better than being handed
    // a street corner.
    let choice = null;
    const wantLc = want ? String(want).toLowerCase() : null;
    if (wantLc) for (let i = 0; i < planes.length; i++) {
      if (String(planes[i].id).toLowerCase() === wantLc) { choice = planes[i]; break; }
    }
    if (!choice) for (let i = 0; i < planes.length; i++) if (planes[i].kind === "plane") { choice = planes[i]; break; }
    if (!choice) choice = planes[0];
    const rec = choice.rec;
    if (!rec || !rec.pos || rec.destroyed || rec.taken) return false;
    // Heading: aim at the city, so the opening shot is the skyline coming at
    // you rather than empty ocean. The arena's own spawn IS the city centre.
    const A = arena();
    const tx = (A && A.spawn) ? A.spawn.x : 0, tz = (A && A.spawn) ? A.spawn.z : 0;
    const hdg = Math.atan2(tx - rec.pos.x, tz - rec.pos.z);
    const craft = CBZ.cityAirborneStart(rec, {
      // b2code.html opens at 1,750 m doing 232 m/s. We keep the altitude — it
      // is what makes the opening read — and pull the speed back to something
      // a player can actually think inside of on frame one.
      alt: choice.kind === "heli" ? 420 : 1750,
      speed: choice.kind === "heli" ? 22 : 150,
      heading: hdg,
    });
    if (!craft) return false;
    pendingAir = null;
    if (CBZ.city) CBZ.city.note(choice.name + " · airborne, inbound on the city.", 3.4);
    try { startVerb(comp); } catch (e) {}
    return true;
  }

  function tickAirborne(dt) {
    if (!pendingAir) return;
    pendingAir.t += dt;
    if (tryAirborne()) return;
    if (pendingAir.t > PENDING_AIR_SEC) {
      pendingAir = null;
      if (CBZ.city) CBZ.city.note((AXES.where.airborne.feed) || "You start on the apron.", 3.4);
    }
  }

  /* THE GRID START, retried until the speedway can hold a race.

     OWNER (2026-07-29): "the racer story is poorly built, like the pilot — it
     should start in race." The pilot got a deferred launch and the racer never
     did, so the two stories that both promise to open you INTO something read
     completely differently: one opens at 1,750 m, the other opened standing on
     the grass outside a closed paddock.

     Same deferral, and for the SAME reason it was needed for the plane: the
     RD field is built from cityRacing's standings and cityMakeCar's catalog,
     and neither is guaranteed live at the frame a mode reset applies an
     origin. So we do not race it — stand the player somewhere safe, arm a
     pending grid start, and fire the moment the world can answer, which is
     within a frame or two and long before the player has control.

     The verb is NOT re-armed here (unlike tryAirborne, which double-fires it):
     runComposition already called startVerb the moment the placement returned,
     and racing.js's own 0.8 s career tick re-arms the card for any racer whose
     story is unfinished — so a second start would only race that singleton.

     RETRYING IS FREE NOW, AND IT WAS NOT. Every frame of the deferral used to
     call cityRaceStart, which BUILT A LOANER CAR before it discovered it could
     not race yet and then returned null with the car still standing on the
     grid. Six seconds of that laid down one primer-grey car per frame — the
     twenty-car scrapyard the owner saw. The speedway now publishes
     CBZ.cityRaceReady(), a pure predicate, and this asks THAT every frame and
     only spends a car when the answer is yes. The attempt is also capped: an
     ask that answers "ready" and still fails is a real fault, not a timing
     one, and repeating it is how one leak becomes twenty. */
  const PENDING_RACE_SEC = 6;
  const PENDING_RACE_TRIES = 3;
  let pendingRace = null;
  /* A DEFERRED START THAT NEVER FIRES LEAVES NO TRACE ANYWHERE, which is how
     the racer origin could quietly stop opening on the grid and the only
     symptom anyone ever saw was a player standing at a gate (and, before the
     litter fix, twenty grey cars). These four counters are the whole history
     of the deferral, and CBZ.cityOriginRaceDebug() hands them to a probe. */
  const raceDbg = { armed: 0, ticks: 0, notReady: 0, tried: 0, started: 0, gaveUp: 0 };
  CBZ.cityOriginRaceDebug = function () {
    return Object.assign({ pending: !!pendingRace, t: pendingRace ? pendingRace.t : null }, raceDbg);
  };

  function tryRace() {
    if (!pendingRace || !CBZ.cityRaceStart) return false;
    // the world cannot answer yet — say so for free, spend nothing
    if (CBZ.cityRaceReady && !CBZ.cityRaceReady()) { raceDbg.notReady++; return false; }
    if (pendingRace.tries >= PENDING_RACE_TRIES) return false;
    pendingRace.tries++; raceDbg.tried++;
    const car = CBZ.cityRaceStart({ style: "muscle", number: 99 });
    if (!car) return false;
    pendingRace = null; raceDbg.started++;
    if (CBZ.cityRacerStory && CBZ.cityRacerStory.open) CBZ.cityRacerStory.open();
    else if (CBZ.city) CBZ.city.note("A loaner, the back of the grid, and the championship in front of you.", 3.4);
    return true;
  }

  function tickRace(dt) {
    if (!pendingRace) return;
    raceDbg.ticks++;
    pendingRace.t += dt;
    if (tryRace()) return;
    // every allowed attempt has been spent and none took — stop waiting on a
    // clock that will not change the answer, fall through to the gate now.
    if (pendingRace.tries >= PENDING_RACE_TRIES) pendingRace.t = PENDING_RACE_SEC + 1;
    if (pendingRace.t > PENDING_RACE_SEC) {
      pendingRace = null; raceDbg.gaveUp++;
      // The world could not put a race together this seed. Fall back to the
      // ORIGINAL opening — on foot at the gate — rather than hanging, and say
      // so, because a silent fallback is how the old one went unnoticed.
      const site = speedwaySpawn();
      const P = CBZ.player;
      if (site && P) {
        P.pos.set(site.x, site.y != null ? site.y : 0.14, site.z);
        P.vy = 0; P.grounded = true;
        if (CBZ.playerChar) { CBZ.playerChar.group.position.copy(P.pos); CBZ.playerChar.group.rotation.set(0, site.heading || 0, 0); }
        if (CBZ.cam) { CBZ.cam.yaw = site.heading || 0; CBZ.cam.pitch = 0.3; }
      }
      if (CBZ.city) CBZ.city.note((AXES.where.speedway.feed) || "You wait at the Speedway gate.", 3.4);
    }
  }

  /* WHERE, made real. Returns the intro opts the camera wants, or null so the
     caller falls back to the street exactly as the originals do. */
  function placeComposition(comp, game) {
    raceDbg.placed = (raceDbg.placed || 0) + 1;
    raceDbg.where = comp && comp.where;          // the branch this run actually took
    const WH = AXES.where[comp.where] || AXES.where.corner;

    // AIRBORNE — the owner's headline: "you literally start the game in air in
    // a B2 bomber." Delegated to playeraircraft.js's CBZ.cityAirborneStart so
    // the heading/velocity convention stays in the file that owns it.
    if (comp.where === "airborne") {
      // THE REGISTRY IS NOT UP YET. Aircraft become flyable when
      // militaryvehicles.js adopts the parked props, and island_airport.js /
      // island_military.js / strategic.js all do that from a DEFERRED
      // onUpdate(55.1) pass that has not run when a mode reset applies the
      // origin. Asking for the plane list here always returned an empty array,
      // so the pilot silently fell through to a street corner.
      //
      // So we do not race it. Stand the player somewhere safe now, arm a
      // pending launch, and the tick below fires the moment an airframe
      // exists — which is the very next frame, before the player has control.
      genericSafeSpawn();
      pendingAir = { comp: comp, t: 0 };
      if (!tryAirborne()) return { compact: false, aerial: true, pending: true };
      return { compact: false, aerial: true };
    }

    // SPEEDWAY — the racer's answer to the pilot's opening. Delegated to
    // island_speedway.js's CBZ.cityRaceStart so the grid geometry, the banking
    // and the lights convention stay in the file that owns them. Deferred for
    // the same reason the airframe registry is: the field is built from live
    // standings and the car catalog, neither guaranteed up at reset.
    if (comp.where === "speedway") {
      genericSafeSpawn();
      pendingRace = { comp: comp, t: 0, tries: 0 }; raceDbg.armed++;
      if (!tryRace()) return { compact: false, onGrid: true, pending: true };
      return { compact: false, onGrid: true };
    }

    // GROUND — find the lot this story wants and stand the player in it.
    const site = WH.resolve ? WH.resolve() : null;
    const lot = WH.find ? WH.find() : null;
    if (WH.resolve && !site) return null;
    if (WH.find && !lot) return null;                 // caller prints WH.feed
    const A = arena(); const P = CBZ.player;
    let px, pz, floorY = 0.14, heading = 0;
    if (site) {
      px = site.x; pz = site.z;
      floorY = site.y != null ? site.y : (CBZ.floorAt ? CBZ.floorAt(px, pz) : 0.14);
      heading = site.heading || 0;
    } else if (lot && lot.building) {
      const b = lot.building;
      const bx = (b.ox != null) ? b.ox : lot.cx, bz = (b.oz != null) ? b.oz : lot.cz;
      // Inside a building we must land on a REAL floor: tower_top rides the
      // executive floor if the flagship built one, otherwise the ground plate.
      if (comp.where === "tower_top" && b.execOffice && b.execOffice.floorY != null) floorY = b.execOffice.floorY;
      else if (comp.where === "unit" && CBZ.cityFloorUnits) floorY = tenantFloorY(lot);
      const sp = clearSpot(b, floorY, bx + 1.2, bz + 0.8);
      px = sp.x; pz = sp.z;
    } else if (A && A.spawn) {
      px = A.spawn.x; pz = A.spawn.z;
      floorY = CBZ.floorAt ? CBZ.floorAt(px, pz) : 0;
    } else return null;

    P.pos.set(px, floorY, pz); P.vy = 0; P.grounded = true;
    // A site that names its own heading (the mansion's front door, the
    // speedway gate) keeps it; everywhere else looks down the open street.
    // (The old `cam.yaw = heading` also dropped the +PI every other placement
    // uses, so the camera sat in FRONT of the body looking back at it.)
    if (CBZ.playerChar) { CBZ.playerChar.group.position.copy(P.pos); CBZ.playerChar.group.rotation.set(0, heading, 0); }
    if (CBZ.cam) { CBZ.cam.yaw = heading + Math.PI; CBZ.cam.pitch = 0.3; }
    if (!(site && site.heading) && CBZ.cityFaceOpen) CBZ.cityFaceOpen(P);
    scene = null;
    return { compact: comp.where !== "corner" };
  }

  /* VERB, made real — through core/mission.js, which CLAUDE.md is explicit
     about: ONE tracked, paid objective primitive that already owns completion
     detection, the HUD distance line, the map waypoint, the world beacon, the
     phone card and the payout. We build none of those. And per contracts.js's
     rule, a `kill` objective BINDS to a ped the world already had — it never
     spawns a mark. */
  function startVerb(comp) {
    const V = AXES.verb[comp.verb];
    if (!V || V.onboard) return;            // the onboarding chain owns it
    if (typeof V.start === "function") { try { return V.start(comp); } catch (e) { return null; } }
    if (!CBZ.mission || !CBZ.mission.start) return;
    const A = arena();
    const opts = { id: V.id, title: V.title, goal: V.goal, reward: V.reward || 0 };
    if (V.done) opts.done = V.done;
    if (V.onTick) opts.onTick = V.onTick;
    if (V.goal === "reach") {
      // the street: the lot's own door at ground level
      const s = (A && A.spawn) || { x: 0, z: 0 };
      opts.at = { x: s.x, z: s.z };
    } else if (V.goal === "survive") {
      opts.seconds = V.seconds || 180;
    } else if (V.goal === "kill") {
      const peds = CBZ.cityPeds || [];
      let mark = null;
      for (let i = 0; i < peds.length; i++) {
        const p = peds[i];
        if (!p || p.dead || p.vendor || p.isFamily || p._campaignTarget) continue;
        mark = p; break;
      }
      if (!mark) return;                     // the world could not supply one — no fake contract
      opts.actor = mark;
      opts.title = "Contract: " + (mark.name || "the mark");
    }
    try { CBZ.mission.start(opts); } catch (e) {}
  }

  // The ONE entry a composed origin runs through. Grants land unconditionally
  // (defect #3 above — the character's story must survive a failed lot roll),
  // the placement is best-effort, and the verb only arms once we are somewhere.
  function runComposition(comp, game) {
    applyGrants(comp, game);
    armHeat(game);
    let opts = null;
    try { opts = placeComposition(comp, game); } catch (e) { try { console.error("[origin] place failed", e); } catch (e2) {} }
    if (opts) { try { startVerb(comp); } catch (e) {} }
    return opts;
  }

  // Register every preset into the SAME registry the three originals live in,
  // so the vault, the [U] wheel and the dispatcher — all of which already walk
  // Object.keys(ORIGINS) — pick them up with no further edit. The three
  // originals keep their hand-written scenes (they are better than a generated
  // one and the owner likes them); the new stories run the generator.
  (function registerComposed() {
    // `hitman` is deliberately NOT here: that preset merged into the campaign
    // character (ORIGINS.contract below carries its composition; the alias at
    // the top maps saved ids). PRESETS.hitman stays as DATA — the merged row
    // and the random roll both still read it.
    const NEW = ["pilot", "hustler", "debtor", "wick", "racer", "president", "captain"];
    for (let i = 0; i < NEW.length; i++) {
      const id = NEW[i], comp = PRESETS[id], W = AXES.who[comp.who];
      ORIGINS[id] = {
        meta: { icon: "", name: W.name, blurb: W.blurb },
        composition: comp,
        get tuning() { return { missedLotFeed: (AXES.where[comp.where] || {}).feed || "" }; },
        findSpawn: function () { const f = (AXES.where[comp.where] || {}).find; return f ? f() : null; },
        grants: function (game) { applyGrants(comp, game); armHeat(game); },
        scene: function (game) {
          let o = null;
          try { o = placeComposition(comp, game); } catch (e) { o = null; }
          if (o) { try { startVerb(comp); } catch (e) {} }
          return o;
        },
      };
      IDS[id] = 1;
    }
    // RANDOM: not a preset — a fresh roll every time it is selected, persisted
    // onto the character's ledger so the person you rolled stays that person.
    ORIGINS.random = {
      meta: { icon: "", name: "Roll The Dice", blurb: "a life this city has not run before" },
      get tuning() { return { missedLotFeed: "However it was meant to start, it starts on the street." }; },
      findSpawn: function () { return null; },
      grants: function (game) {
        const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
        let comp = (w && w.originRoll) || null;
        if (!comp) { comp = rollOrigin(); if (w) w.originRoll = comp; }
        game._originComp = comp;
        applyGrants(comp, game); armHeat(game);
      },
      scene: function (game) {
        const comp = game._originComp || rollOrigin();
        let o = null;
        try { o = placeComposition(comp, game); } catch (e) { o = null; }
        if (o) { try { startVerb(comp); } catch (e) {} }
        return o;
      },
    };
    IDS.random = 1;

    // THE HITMAN (id `contract`) — the ONE professional-hit character. The
    // owner's 2026-08-03 merge: the old preset card ("a motel, a silencer,
    // one name") and the authored campaign card ("a roof, a prison, a
    // Director") were the same fantasy twice, so the preset's TEXTURE is now
    // this row's GRANTS (pro purse, suit, genuinely suppressed pistol) and
    // the campaign supplies the beats — its new opening IS the motel and the
    // one name (city/campaign.js PHASE.MOTEL). A real registry character, so
    // the vault, the [U] wheel, the ledger stamp and the title picker treat
    // it like any other life. With CITY_HITMAN_CAMPAIGN off the row degrades
    // to exactly the old hitman preset opening — nothing orphaned.
    const HITCOMP = PRESETS.hitman;
    ORIGINS.contract = {
      meta: { icon: "", name: "The Hitman", blurb: "a motel, a silencer, one name" },
      get tuning() { return { missedLotFeed: (AXES.where[HITCOMP.where] || {}).feed || "" }; },
      findSpawn: function () { const f = (AXES.where[HITCOMP.where] || {}).find; return f ? f() : null; },
      grants: function (game) { applyGrants(HITCOMP, game); armHeat(game); },
      scene: function (game) {
        // Campaign on (only if someone re-enables CITY_HITMAN_CAMPAIGN): the
        // director stages its own opening from its reset wrap.
        if (CBZ.cityCampaignEnabled && CBZ.cityCampaignEnabled()) { genericSafeSpawn(); return { compact: true }; }
        // THE ROOM (2026-09-27, the in-world wave): the Hitman wakes in his
        // motel room (city/hitman_room.js). The Bureau arc (city/agency.js)
        // rings the burner on the bed; nothing is started from here.
        let room = null;
        try { room = CBZ.hmRoom && CBZ.hmRoom.ensure ? CBZ.hmRoom.ensure() : (CBZ.hitmanRoom ? CBZ.hitmanRoom() : null); } catch (e) { room = null; }
        const P = CBZ.player;
        if (room && room.spawn && P && P.pos) {
          const sx = room.spawn.x, sz = room.spawn.z;
          const gy = room.floorY != null ? room.floorY : (CBZ.floorAt ? CBZ.floorAt(sx, sz) : 0);
          P.pos.set(sx, gy, sz); P.vy = 0; P.grounded = true; P.speed = 0; P.driving = false;
          if (CBZ.playerChar) { CBZ.playerChar.group.position.copy(P.pos); CBZ.playerChar.group.rotation.set(0, (room.spawn.heading || 0) + Math.PI, 0); }
          if (CBZ.cam) { CBZ.cam.yaw = room.spawn.heading || 0; CBZ.cam.pitch = 0.12; }
          scene = null;
          return { compact: true };
        }
        let o = null;
        try { o = placeComposition(HITCOMP, game); } catch (e) { o = null; }
        return o;
      },
    };
    IDS.contract = 1;

    // YOUR PREVIOUS LIFE — the pre-origin save parked by parkPreviousLife().
    // A real, switchable character with a full ledger; it simply has no
    // opening scene, because it predates the idea of one. Registering it here
    // is what puts it in the [U] wheel (which walks these keys) so the life is
    // recoverable. It gets NO title-screen button — those are authored in
    // index.html — so it can only ever be reached deliberately, and its
    // grants/scene are never reached at all: its ledger carries
    // originPlayed:true, so cityOriginApply returns at the resume branch.
    ORIGINS[PREV_ID] = {
      meta: { icon: "", name: "Your Previous Life", blurb: "the character you were playing before the stories" },
      get tuning() { return { missedLotFeed: "" }; },
      findSpawn: function () { return null; },
      grants: function () {},
      scene: function () { genericSafeSpawn(); return { compact: false }; },
    };
    IDS[PREV_ID] = 1;
  })();

  // ---------------------------------------------------------------
  // dispatch + public contract
  // ---------------------------------------------------------------
  // (defect #3) GRANTS always apply first — cash/bank/debt/outfit/weapon are
  // the character's story and must land no matter what the procedural city
  // rolled this run. The SCENE (the scripted beat: raid / toss / dressing)
  // is best-effort: if its lot came back null, we fall back to a generic
  // safe street spawn and cover the fiction with a feed line instead of
  // silently skipping the whole origin (the old landmine — it used to stamp
  // originPlayed=true and grant NOTHING when the lot roll failed).
  function applyOrigin(id, game) {
    const o = ORIGINS[normOrigin(id)];
    try { o.grants(game); } catch (e) { try { console.error("[city origin] grants failed:", id, e); } catch (e2) {} }
    let opts = null;
    try { opts = o.scene(game); } catch (e) { try { console.error("[city origin] scene failed:", id, e); } catch (e2) {} opts = null; }
    if (!opts) {
      genericSafeSpawn();
      if (CBZ.city) CBZ.city.note(o.tuning.missedLotFeed || "You get out just ahead of trouble.", 3);
      opts = { compact: true };
    }
    return opts;
  }

  /* WHICH BRANCH DID THIS RUN TAKE? cityOriginApply has five exits and four
     of them are silent, so "my story did not play" has four indistinguishable
     causes: resumed a stamped ledger, silently adopted a legacy save, switched
     characters, or actually played. Every exit records itself here — one push
     per mode reset — and CBZ.cityOriginWhy() hands the list to a probe. This
     is what turned "the racer origin does not open on the grid" from a guess
     into a one-line answer. */
  const applyLog = [];
  CBZ.cityOriginWhy = function () { return applyLog.slice(-6); };

  // The public entry wraps the branch logic below so EVERY exit (resume,
  // adopt, switch, play) also re-arms the onboarding chain from the ledger
  // and the one-shot third-person handoff for a cinematic intro.
  CBZ.cityOriginApply = function (game) {
    const r = applyOriginCore(game);
    lastBranch = applyLog.length ? applyLog[applyLog.length - 1].branch : "";
    try { onboardBegin(game, lastBranch !== "play"); } catch (e) { try { console.error("[onboard] begin", e); } catch (e2) {} }
    pendingTP = !!(r && r.introActive);
    return r;
  };
  let lastBranch = "";
  function applyOriginCore(game) {
    introActiveFlag = false; introOptsCache = null;
    clearScene();
    try {
      if (!CBZ.cityWorldEnsure) return { introActive: false };
      let w = CBZ.cityWorldEnsure();
      const selected = normOrigin(game.cityOrigin);
      // Did the player physically click a story card this session? One-shot:
      // read it and clear it, so it can never leak into a later reset.
      const picked = !!game.cityOriginPicked;
      game.cityOriginPicked = false;

      /* ---- DEFECT 1: THE UNADDRESSABLE LEDGER ---------------------------
         A save stamped `originPlayed:true` whose `origin` is not one of the
         registered ids (an id from an older build, or never written at all)
         is PERMANENTLY LOCKED. Trace it: peekLedger's `IDS[p.origin]` test
         fails, so it falls through; the switch below needs a truthy
         `w.origin` to compare, so it never fires; and the resume branch
         after it returns `{introActive:false}` unconditionally. Every pick
         lands in resume, forever, whatever you click. That is exactly the
         owner's "I always have the same one life regardless of story."
         Claiming it for the default character makes it addressable again, so
         the ordinary switch below can move off it. A RETIRED id is not an
         unknown one: a saved `hitman` life IS the merged `contract` character
         (the alias), never a fallback to the exec. */
      // (in-memory only: the next natural autosave persists it, and the alias
      // re-applies on every boot — committing HERE would let the ledger wrap
      // stamp the mid-reset default spawn over the character's saved lastPos.)
      if (w.originPlayed && ORIGIN_ALIASES[w.origin]) w.origin = ORIGIN_ALIASES[w.origin];
      if (w.originPlayed && !IDS[w.origin]) w.origin = "exec";

      /* ---- DEFECT 2: THE ADOPTION THAT ATE YOUR CHOICE ------------------
         A pre-origin save (progress, but no originPlayed stamp) used to be
         adopted AS whatever was selected, stamped played, and returned with
         no scene. So the first time you chose the Pilot, your existing
         character was silently re-labelled "The Pilot" and marked as having
         already played — and from then on picking the Pilot resumed that
         same life. You could never reach the story, and nothing said so.

         That silent adoption is still right when the player did NOT choose:
         somebody who just presses Play must not have their save wiped. But a
         REAL CLICK is a request to start that story, and it is now honoured —
         the old life is parked in the vault under `previous` (recoverable
         from the [U] wheel; nothing is destroyed) and the chosen character is
         minted fresh so their opening actually runs. */
      if (legacyLedger && !w.originPlayed) {
        legacyLedger = false;
        if (!picked) {
          w.origin = selected; w.originPlayed = true;
          if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
          applyLog.push({ branch: "adopt-legacy", selected: selected, picked: picked });
          return { introActive: false };
        }
        parkPreviousLife(w);
        w = CBZ.cityWorldEnsure();          // a freshly minted, unplayed ledger
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
        applyLog.push({ branch: "resume", selected: selected, on: w.origin, picked: picked });
        return { introActive: false };
      }

      applyLog.push({ branch: "play", selected: selected, picked: picked });
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
  }
  CBZ.cityOriginIntroActive = function () { return !!introActiveFlag; };
  // Every origin cinematic ends on the shoulder camera, never pushed into the
  // eyes (camera.js honours keepThirdPerson). state.js still arms fpsmode's
  // one-shot "FP after intro" for any city intro; the origins tick disarms it
  // on the first frame of the run (pendingTP), so the handoff lands in third
  // person, same as every other city start.
  CBZ.cityOriginIntroOpts = function () { return Object.assign({}, introOptsCache || {}, { keepThirdPerson: true }); };
  // A configured world spawn may intentionally replace the one-time visual
  // origin staging after its grants/ledger stamps have landed. Keep that
  // cancellation explicit instead of having mode.js reach into private state.
  CBZ.cityOriginCancelIntro = function () {
    clearScene(); introActiveFlag = false; introOptsCache = null;
  };

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
  // (defect #5) meta now lives on the ORIGINS registry above — the vault's
  // key list below is derived from it too, so a 4th protagonist just needs
  // a new ORIGINS entry, never a second literal id list here.
  let wheelEl = null, fadeEl = null;

  function moneyFmt(n) { return "$" + Math.round(n || 0).toLocaleString(); }

  function ensureWheel() {
    if (wheelEl) return;
    wheelEl = document.createElement("div");
    wheelEl.id = "originWheel";
    wheelEl.style.cssText =
      "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;display:none;" +
      // max-height + scroll: the roster went from three lives to nine, and a
      // fixed-height modal centred on the viewport simply ran off the top and
      // bottom of a laptop screen once it did.
      "min-width:340px;max-height:78vh;overflow-y:auto;background:rgba(12,14,18,.94);border:1px solid #2c3340;border-radius:14px;" +
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
    for (const id of Object.keys(ORIGINS)) {
      // The parked pre-origin life is only a character if one was ever parked.
      // Offering "Your Previous Life — NEW, their story begins" to somebody who
      // has no previous life would be a row that lies.
      if (id === PREV_ID && !v.chars[id] && act !== id) continue;
      const m = ORIGINS[id].meta;
      let status, dim = "";
      if (id === act) { status = "<span style='color:#7ed957'>YOU · " + moneyFmt(g.cash) + "</span>"; dim = "opacity:.55;pointer-events:none;"; }
      else if (v.chars[id]) status = "<span style='color:#ffd451'>" + moneyFmt(v.chars[id].cash) + "</span>";
      else status = "<span style='color:#7fd0ff'>NEW, their story begins</span>";
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
      "<div style='margin-top:7px;color:#8a93a3;font-size:11px;font-weight:500'>Everyone keeps their own money, gear and record, the city is shared.</div>";
  }

  function wheelOpen() { return wheelEl && wheelEl.style.display === "block"; }
  // KEY OWNERSHIP (see captives.js's matching block): [U] is contextual and
  // three-way shared with captives.js's custody HUD and wealth.js's business
  // panel. wealth.js already sets CBZ.cityMenuOpen while its panel is open,
  // which the guard above already blocks on; this extra check is defense in
  // depth for captives.js specifically, since its own capture-phase handler
  // is the one that actually decides whether the wheel even sees the
  // keypress (it only lets U fall through when it has nothing of its own to
  // show or isn't itself open).
  function openWheel() {
    if (CBZ.cityCampaignActive && CBZ.cityCampaignActive()) return;
    if (g.mode !== "city" || g.state !== "playing" || CBZ.cityMenuOpen) return;
    if (CBZ.cityCaptivesHudOpen && CBZ.cityCaptivesHudOpen()) return;
    const P = CBZ.player;
    if (!P || P.dead || g.busted) return;
    if (P.driving) { if (CBZ.city) CBZ.city.note("Park it first, no switching from the driver's seat.", 1.8); return; }
    if ((g.wanted | 0) > 0) { if (CBZ.city) CBZ.city.note("Can't switch while the heat's on.", 1.8); return; }
    // a live origin beat can't be walked out on — switching mid-crash would
    // let the exec keep the paper millions forever.
    if (scene) { if (CBZ.city) CBZ.city.note("Not now, see it through.", 1.8); return; }
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

  // KEY OWNERSHIP: this is a BUBBLE-phase listener, registered after
  // captives.js's CAPTURE-phase one. captives.js only preventDefault +
  // stopPropagation's the keydown when it has custody state to show (or its
  // own panel is already open) — any other press of U reaches here
  // untouched. openWheel() additionally stands down while the captives HUD
  // or wealth's business panel (via CBZ.cityMenuOpen) is open. No listener
  // here ever needs to check "is this key already handled" — the capture-
  // phase stopPropagation from captives.js (when it fires) prevents this
  // handler from running at all for that keydown.
  document.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    const k = (e.key || "").toLowerCase();
    if (k !== "u") return;
    if (g.mode !== "city") return;
    if (CBZ.cityCampaignActive && CBZ.cityCampaignActive()) return;
    if (wheelOpen()) { e.preventDefault(); closeWheel(); return; }
    if (g.state !== "playing" || CBZ.cityMenuOpen) return;
    e.preventDefault(); openWheel();
  });
  document.addEventListener("keydown", function (e) {
    if (wheelOpen() && (e.key === "Escape")) { e.preventDefault(); closeWheel(); }
  });

  /* ======================================================================
     THE FIRST TEN MINUTES: the onboarding chain.

     OWNER: "the game idea is smart but the logic is dumb and it isn't fun."
     The sandbox opened on a staged beat and then said nothing: the exec got a
     stale STREET pin and a coin-flip police star, the barfly and the tenant
     got nothing at all. This is the ONE next-step line every sandbox
     character follows until they have a job:

       1 street  get out of the building you woke up in       +$50
       2 earn    make your first $500 (mug, pawn, sell, work)  +$150
       3 arm     buy a gun at the gun store, or boost a car    +$200
       4 job     take a contract off the motel wall, or ask a
                 gang for work                                  +$300
       then the job systems (core/mission.js, contracts.js on the phone,
       hitman.js, playergang.js prospecting) own the screen.

     Every step completes off REAL state, never a timer: where your feet are
     (citynav's building footprints + the ground oracle), cash that actually
     arrived in the wallet, the weapon inventory / the driver's seat, and
     "is the player carrying a job" (CBZ.mission.busy, the prospect record,
     gang membership). Each step pins ONE waypoint on the real target and
     clears it on completion (only if the pin is still ours: a waypoint the
     player placed is never touched), pays through the one wallet
     (CBZ.city.addCash, so the HUD's +$ delta fires), and flashes a payoff
     line in the objective slot. Progress is persisted on the character's
     ledger (w.onboard = {step, earned}), so a returning player resumes at the
     right step and a switched-to character keeps their own.

     It is NOT a core/mission.js job, deliberately: a live mission makes
     CBZ.mission.busy() true, and busy() is what gigs, the hitman wall, the
     recruiters and dialogue offers all check before handing out work. A
     tutorial registered as a job would refuse the very jobs step 4 asks you
     to take. It yields instead: while a real job with a destination owns the
     HUD/waypoint, the chain goes quiet and only keeps score.
     ====================================================================== */
  const OB_EARN = 500;
  const OB_STEPS = [
    { id: "street", title: "Get out to the street", pay: { cash: 50 },               doneLine: "On the street" },
    { id: "earn",   title: "Make your first $" + OB_EARN, pay: { cash: 150, respect: 3 }, doneLine: "First $" + OB_EARN + " made" },
    { id: "arm",    title: "Get a gun or a car",    pay: { cash: 200, respect: 3 },  doneLine: "Tooled up" },
    { id: "job",    title: "Take a job",            pay: { cash: 300, respect: 5 },  doneLine: "Hired" },
  ];
  // Stories whose opening IS a career of their own (the grid, the Oval
  // Office, the wheelhouse) do not get told to mug a stranger.
  const OB_SKIP = { president: 1, captain: 1, racer: 1, contract: 1, hitman: 1 };   // the Hitman's opening is the burner on the bed
  let ob = null;            // live chain state, or null (done / skipped / campaign)
  let obSig = "";
  let pendingTP = false;    // one-shot: disarm fpsmode's FP-after-intro on the first frame

  function obVeteran(game) {
    return (game.respect || 0) >= 25 || !!game.cityMembership || !!game.playerGang ||
      ((game.cash || 0) + (game.cityBank || 0)) >= 25000 || (game.kills || 0) >= 10;
  }
  function onboardBegin(game, resumed) {
    ob = null; obSig = "";
    if (CBZ.cityCampaignActive && CBZ.cityCampaignActive()) return;
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    if (!w) return;
    const who = (w.origin === "random" && w.originRoll) ? w.originRoll.who : w.origin;
    if (OB_SKIP[who]) return;
    let rec = w.onboard;
    if (!rec || typeof rec !== "object") {
      // A character who plainly already knows the city (real standing, a
      // crew, money, a body count) is not walked through it again.
      if (resumed && obVeteran(game)) { w.onboard = { step: OB_STEPS.length, earned: 0 }; return; }
      rec = w.onboard = { step: 0, earned: 0 };
    }
    if ((rec.step | 0) >= OB_STEPS.length) return;
    ob = {
      rec: rec, lastCash: null, entered: false, wpWant: true, wp: null,
      flash: null, flashT: 0, finale: 0, evalT: 0, quiet: false,
      mark: null, markT: 0, guns0: 0, jobVia: null,
    };
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // ---- waypoint ownership: we only ever clear a pin WE set ----------------
  function obCurWp() { return (CBZ.fullMap && CBZ.fullMap.waypoint) ? CBZ.fullMap.waypoint("city") : null; }
  // identity, not coordinates: fullmap re-snaps a pin's x/z to the nav
  // route's goal whenever it reroutes, but the record object stays the same
  function obWpMine() {
    const cur = obCurWp();
    return !!(cur && ob && ob.wp && cur === ob.wp);
  }
  function obSetWp(x, z, label) {
    if (!ob || !CBZ.fullMap || !CBZ.fullMap.setWaypoint) return;
    let wp = null;
    try { wp = CBZ.fullMap.setWaypoint(x, z, label); } catch (e) { wp = null; }
    ob.wp = wp || null;
  }
  function obClearWp() {
    if (ob && obWpMine() && CBZ.fullMap.clearWaypoint) { try { CBZ.fullMap.clearWaypoint("city"); } catch (e) {} }
    if (ob) ob.wp = null;
  }

  // ---- real-state predicates ---------------------------------------------
  function obOnStreet(P) {
    if (P.driving) return true;
    const A = arena();
    const gy = (A && A.groundHeightAt) ? A.groundHeightAt(P.pos.x, P.pos.z) : 0;
    if (P.pos.y > gy + 2.5) return false;                 // a roof, a balcony, an upper floor
    const nav = CBZ.cityNav;
    return !(nav && nav.indoorLotAt && nav.indoorLotAt(P.pos.x, P.pos.z));
  }
  function obHasJob() {
    const M = CBZ.mission;
    if (M && M.busy && M.busy()) return true;
    if (g.cityJob) return true;
    if (CBZ.cityProspectGangId && CBZ.cityProspectGangId() != null) return true;
    return !!(g.cityMembership || (CBZ.cityPlayerGangExists && CBZ.cityPlayerGangExists()));
  }
  // a real job with a PLACE owns the HUD line and the waypoint; the chain yields
  function obJobOwnsScreen() {
    const M = CBZ.mission;
    const m = M && M.focus ? M.focus() : null;
    if (m && m.target && m.target()) return true;
    const j = g.cityJob;
    return !!(j && !j._mission && (j.dest || j.target));
  }
  function obStepDone(st, P) {
    if (st.id === "street") return obOnStreet(P);
    if (st.id === "earn") return (ob.rec.earned | 0) >= OB_EARN;
    if (st.id === "arm") {
      if ((CBZ.weaponInventory || []).length > ob.guns0) return true;
      return !!(P.driving && (P._vehicle || P.car));
    }
    if (st.id === "job") return obHasJob();
    return false;
  }

  // ---- targets -----------------------------------------------------------
  // the stranger worth mugging: a civilian with real cash on him, near enough
  // to walk to, richer-and-closer first. Never a cop, a gang member, a vendor,
  // family, or anybody a script is driving.
  function obPickMark(P) {
    const peds = CBZ.cityPeds || [];
    let best = null, bs = 0;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || p.robbed || p.vendor || p.isFamily || p.gang || p.controlled || p._scripted || p._campaignTarget || !p.pos) continue;
      if (p.kind && p.kind !== "civilian") continue;
      const cash = p.cash || 0;
      if (cash < 15) continue;
      const d = Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z);
      if (d < 6 || d > 110) continue;
      const s = Math.min(cash, 1500) / (d + 20);
      if (s > bs) { bs = s; best = p; }
    }
    return best;
  }
  function obDoorPoint(lot) {
    const d = lot && lot.building && lot.building.door;
    if (!d || d.x == null) return null;
    const nx = d.nx || 0, nz = d.nz != null ? d.nz : 1, nl = Math.hypot(nx, nz) || 1;
    return { x: d.x + (nx / nl) * 1.6, z: d.z + (nz / nl) * 1.6 };
  }
  function obNearestGangId(P) {
    const gs = CBZ.cityGangs;
    if (!Array.isArray(gs) || !CBZ.cityGangHQ) return null;
    let best = null, bd = Infinity;
    for (let i = 0; i < gs.length; i++) {
      const r = gs[i];
      if (!r || r.isPlayer || r.absorbed || r.id === "player") continue;
      if (CBZ.cityAtWar && CBZ.cityAtWar("player", r.id)) continue;
      let h = null; try { h = CBZ.cityGangHQ(r.id); } catch (e) { h = null; }
      if (!h || (!h.x && !h.z)) continue;
      const d = Math.hypot(h.x - P.pos.x, h.z - P.pos.z);
      if (d < bd) { bd = d; best = r.id; }
    }
    return best;
  }
  function obGuide(st, P) {
    if (st.id === "street") {
      if (!ob.wpWant) return;
      ob.wpWant = false;
      const out = frontStepOf(P.pos.x, P.pos.z);
      if (out) obSetWp(out.x, out.z, "STREET");
      return;
    }
    if (st.id === "earn") {
      ob.markT -= 0.25;
      const mk = ob.mark;
      const stale = !mk || mk.dead || mk.robbed || !((mk.cash || 0) > 0) ||
        Math.hypot(mk.pos.x - P.pos.x, mk.pos.z - P.pos.z) > 130;
      if (!stale && !ob.wpWant && ob.markT > 0) return;
      ob.markT = 4;
      const best = stale ? obPickMark(P) : mk;
      const changed = best !== ob.mark;
      ob.mark = best;
      if (best && (changed || ob.wpWant) && (obWpMine() || !obCurWp())) obSetWp(best.pos.x, best.pos.z, "MARK");
      else if (!best && obWpMine()) obClearWp();
      ob.wpWant = false;
      return;
    }
    if (st.id === "arm") {
      if (!ob.wpWant) return;
      ob.wpWant = false;
      const A = arena();
      const lot = (A && A.gunShopLot) || (CBZ.cityGunstoreLot && CBZ.cityGunstoreLot()) || null;
      const t = obDoorPoint(lot);
      if (t) obSetWp(t.x, t.z, "GUN STORE");
      return;
    }
    if (st.id === "job") {
      if (!ob.wpWant) return;
      ob.wpWant = false;
      let room = null;
      try { room = CBZ.hitmanRoom ? CBZ.hitmanRoom() : null; } catch (e) { room = null; }
      if (room && room.board) {
        ob.jobVia = "wall"; ob.jobPlace = String(room.name || "the motel room").toLowerCase();
        obSetWp(room.board.x, room.board.z, "MOTEL");
        return;
      }
      const gid = obNearestGangId(P);
      if (gid != null && CBZ.fullMap && CBZ.fullMap.setGangWaypoint) {
        ob.jobVia = "gang";
        let wp = null; try { wp = CBZ.fullMap.setGangWaypoint(gid); } catch (e) { wp = null; }
        ob.wp = wp || null;
      }
    }
  }

  function obComplete(st) {
    const pay = st.pay || {};
    if (pay.cash && CBZ.city && CBZ.city.addCash) CBZ.city.addCash(pay.cash);
    if (pay.respect && CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(pay.respect);
    ob.lastCash = g.cash || 0;                         // our own pay never counts as "earned"
    if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
    obClearWp();
    ob.flash = (pay.cash ? "+$" + pay.cash + "  " : "") + st.doneLine;
    ob.flashT = 3.2;
    ob.rec.step = (ob.rec.step | 0) + 1;
    ob.entered = false; ob.mark = null; ob.wpWant = true;
    if (ob.rec.step >= OB_STEPS.length) ob.finale = 3.2 + 9;
    if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} }
  }

  function obTick(dt) {
    if (!ob) return;
    const P = CBZ.player;
    if (!P || !P.pos) return;
    const rec = ob.rec;
    const st = OB_STEPS[rec.step | 0] || null;
    // the wallet, every frame: only money that ARRIVED counts toward step 2
    const c = g.cash || 0;
    if (ob.lastCash == null) ob.lastCash = c;
    const d = c - ob.lastCash;
    ob.lastCash = c;
    if (st && st.id === "earn" && d > 0 && !P.dead) rec.earned = Math.min(OB_EARN, (rec.earned | 0) + Math.round(d));
    if (ob.flashT > 0) { ob.flashT -= dt; if (ob.flashT <= 0) ob.flash = null; }
    if (!st) {
      ob.finale -= dt;
      if (ob.finale <= 0) { ob = null; obSig = ""; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); return; }
      obRepaint();
      return;
    }
    ob.evalT -= dt;
    if (ob.evalT > 0) { if (ob.flash) obRepaint(); return; }
    ob.evalT = 0.25;
    if (P.dead || g.busted) return;
    // a staged beat (the exec's laptop, the barfly's toss) owns the screen
    const beat = !!(scene && (scene.phase === "laptop" || scene.kind === "barfly"));
    const quiet = beat || obJobOwnsScreen();
    if (quiet !== ob.quiet) { ob.quiet = quiet; if (!quiet) ob.wpWant = true; }
    if (!beat) {
      if (!ob.entered) {
        ob.entered = true; ob.wpWant = true; ob.mark = null; ob.markT = 0;
        ob.guns0 = (CBZ.weaponInventory || []).length;
      }
      if (obStepDone(st, P)) obComplete(st);
      else if (!quiet) obGuide(st, P);
    }
    obRepaint();
  }

  // ---- the ONE compact next-step line (city/hud.js renders it) -----------
  function obLine() {
    if (g.mode !== "city") return null;
    if (!ob) return nmLine();
    if (ob.flash) return { title: ob.flash, flash: true };
    const st = OB_STEPS[ob.rec.step | 0];
    if (!st) return ob.finale > 0 ? { title: "You're in business", hint: "Finish the job. New work comes to your phone." } : null;
    if (ob.quiet) return null;
    const keys = !CBZ.touchMode;
    if (st.id === "street") return { title: st.title, hint: "Find your way down and out the front door" };
    if (st.id === "earn") {
      const e = ob.rec.earned | 0;
      return {
        title: st.title,
        hint: "$" + e + " so far. Walk up to a stranger and mug them" + (keys ? " (I)" : "") + ", or sell loot at a pawn shop",
        progress: Math.min(1, e / OB_EARN),
      };
    }
    if (st.id === "arm") return { title: st.title, hint: "Buy a pistol ($350) at the gun store, or boost a parked car" + (keys ? " (E)" : "") };
    if (st.id === "job") {
      return {
        title: st.title,
        hint: ob.jobVia === "gang"
          ? "Talk to a gang member on their turf and ask to join"
          : "Read the wall in " + (ob.jobPlace || "the motel room") + " for a contract, or ask a gang for work",
      };
    }
    return null;
  }
  function obRepaint() {
    const L = obLine();
    const sig = L ? (L.title + "|" + (L.hint || "") + "|" + (L.progress != null ? Math.round(L.progress * 100) : "")) : "";
    if (sig !== obSig) { obSig = sig; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
  }
  /* ======================================================================
     AFTER THE CHAIN: THE NEXT MOVE.

     The chain ends at "Take a job", and then the city went silent again: the
     heists, the hitman wall, the street races and the gang ladders are all
     real and deep, but every one of them is a door you had to already know
     about ([H] inside a shop, [K] on a racer). A player with nothing on for a
     while was a player wandering. So when you have been idle for ~40 s (no
     job, no heat, not mid-heist, not in a menu), the objective slot offers
     ONE real opportunity near you, pins it if you have no pin of your own,
     and gets out of the way the moment you are busy. It rotates so it never
     nags with the same thing twice, and it only ever points at something the
     live world actually has (a real shop lot, the real wall, a real HQ).
     ====================================================================== */
  const NM_IDLE = 40, NM_SHOW = 30, NM_REST = 50;
  const NM_STORE = { food: 1, gas: 1, barber: 1, gym: 1, hardware: 1 };
  const NM_SMASH = { bar: 1, pawn: 1, drugs: 1, clothing: 1, electronics: 1 };
  const nm = { idle: 0, pick: null, showT: 0, last: "", wp: null, evalT: 0 };
  function nmBusy(P) {
    if (P.dead || g.busted || (g.wanted | 0) > 0) return true;
    if (CBZ.cityMenuOpen || (CBZ.fullMap && CBZ.fullMap.active)) return true;
    const M = CBZ.mission;
    if ((M && M.busy && M.busy()) || g.cityJob) return true;
    let h = null; try { h = CBZ.cityHeistState ? CBZ.cityHeistState() : null; } catch (e) { h = null; }
    if (h && h.phase && h.phase !== "idle") return true;
    let sr = null; try { sr = CBZ.cityStreetRacing ? CBZ.cityStreetRacing.state() : null; } catch (e) { sr = null; }
    return !!(sr && sr.active);
  }
  function nmNearestShop(P, kinds) {
    const A = arena(); const ls = A && A.shopLots;
    if (!ls) return null;
    let best = null, bd = 260;
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i];
      if (!l || l.demolished || !kinds[l.kind]) continue;
      const d = Math.hypot(l.cx - P.pos.x, l.cz - P.pos.z);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }
  function nmCandidates(P) {
    const out = [];
    const armed = (CBZ.weaponInventory || []).length > 0;
    const cash = g.cash || 0;
    if (!armed) {
      const A = arena();
      const lot = (A && A.gunShopLot) || (CBZ.cityGunstoreLot && CBZ.cityGunstoreLot()) || null;
      const t = obDoorPoint(lot);
      if (t && cash >= 350) out.push({ id: "gun", title: "You're walking around unarmed", hint: "The gun store sells a pistol for $350", x: t.x, z: t.z, label: "GUN STORE" });
    }
    if (armed) {
      const s = nmNearestShop(P, NM_STORE);
      if (s) out.push({ id: "store", title: "Stick up a store", hint: "Walk into the " + s.kind + " shop and press H to case it, then grab the till and run", x: s.cx, z: s.cz, label: "SCORE" });
      const s2 = nmNearestShop(P, NM_SMASH);
      if (s2) out.push({ id: "smash", title: "Smash and grab", hint: "The " + s2.kind + " place pays better than a corner store. Press H inside to case it", x: s2.cx, z: s2.cz, label: "SCORE" });
    }
    const inCrew = !!(g.cityMembership || (CBZ.cityPlayerGangExists && CBZ.cityPlayerGangExists()));
    const prospect = CBZ.cityProspectGangId && CBZ.cityProspectGangId() != null;
    if (!inCrew && !prospect) {
      const gid = obNearestGangId(P);
      if (gid != null) {
        const gr = (CBZ.cityGangs || []).find(function (r) { return r && r.id === gid; });
        out.push({ id: "gang", title: "Get put on", hint: "Talk to " + ((gr && gr.name) ? "the " + gr.name : "a gang") + " on their turf and ask for work", gang: gid });
      }
    }
    if (P.driving) out.push({ id: "race", title: "Race for money", hint: "Pull up next to a street racer and press K. Winner takes the pot" });
    return out;
  }
  function nmClearWp() {
    const cur = obCurWp();
    if (nm.wp && cur === nm.wp && CBZ.fullMap && CBZ.fullMap.clearWaypoint) { try { CBZ.fullMap.clearWaypoint("city"); } catch (e) {} }
    nm.wp = null;
  }
  function nmDrop() {
    if (!nm.pick) return;
    nm.pick = null; nmClearWp();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function nmTick(dt) {
    if (ob) { nm.idle = 0; return; }                 // the chain still owns the slot
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    if (!w || !w.onboard || (w.onboard.step | 0) < OB_STEPS.length) return;   // skipped stories keep their own openings
    if (CBZ.cityCampaignActive && CBZ.cityCampaignActive()) return;
    const P = CBZ.player; if (!P || !P.pos) return;
    nm.evalT -= dt;
    if (nm.evalT > 0) return;
    const step = 0.5 - nm.evalT; nm.evalT = 0.5;
    if (nmBusy(P)) { nm.idle = Math.min(nm.idle, 0); nmDrop(); return; }
    if (nm.pick) {
      nm.showT -= step;
      const d = nm.pick.x != null ? Math.hypot(nm.pick.x - P.pos.x, nm.pick.z - P.pos.z) : 1e9;
      // arrived: the pin has done its job, the instruction stays a while
      if (d < 8 && nm.wp) { nmClearWp(); nm.showT = Math.max(nm.showT, 14); }
      if (nm.showT <= 0) { nmDrop(); nm.idle = -NM_REST; }
      return;
    }
    nm.idle += step;
    if (nm.idle < NM_IDLE) return;
    const c = nmCandidates(P).filter(function (o) { return o.id !== nm.last; });
    if (!c.length) { nm.idle = -NM_REST; return; }
    const pick = c[(Math.random() * c.length) | 0];
    nm.pick = pick; nm.last = pick.id; nm.showT = NM_SHOW; nm.idle = 0;
    if (!obCurWp() && CBZ.fullMap) {
      let wp = null;
      try {
        if (pick.gang != null && CBZ.fullMap.setGangWaypoint) wp = CBZ.fullMap.setGangWaypoint(pick.gang);
        else if (pick.x != null && CBZ.fullMap.setWaypoint) wp = CBZ.fullMap.setWaypoint(pick.x, pick.z, pick.label);
      } catch (e) { wp = null; }
      nm.wp = wp || null;
    }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function nmLine() {
    if (!nm.pick) return null;
    return { title: nm.pick.title, hint: nm.pick.hint };
  }

  CBZ.cityOnboardLine = obLine;
  CBZ.cityNextMove = function () { return nm.pick ? { id: nm.pick.id, title: nm.pick.title } : null; };
  // probe/harness read: where the chain is (null when finished or not running)
  CBZ.cityOnboardState = function () {
    return ob ? { step: ob.rec.step | 0, id: (OB_STEPS[ob.rec.step | 0] || {}).id || "done", earned: ob.rec.earned | 0, quiet: ob.quiet } : null;
  };

  // ---- per-frame scripted-scene tick (priority 37: after the wanted decay
  //      tick @33 and scenedirector @36.2, before police maintain/move @35/40
  //      — irrelevant here since our raid cops are deliberately spliced OUT
  //      of CBZ.cityCops so the live police AI never touches them). ----
  CBZ.onUpdate(37, function (dt) {
    // HEAT runs whether or not a scripted scene is live — a hunted origin is
    // a standing condition of the character, not a beat that finishes. It is
    // its own guard clause so a story with no heat costs one comparison.
    if (g.mode === "city" && g.state === "playing") {
      if (pendingTP) { pendingTP = false; if (CBZ.disarmFPSAfterIntro) { try { CBZ.disarmFPSAfterIntro(); } catch (e) {} } }
      tickHeat(dt); tickAirborne(dt); tickRace(dt);
      obTick(dt);
      nmTick(dt);
    }
    if (!scene) return;
    if (g.mode !== "city") { clearScene(); return; }
    if (g.state !== "playing") return;
    if (scene.kind === "exec") tickExec(dt);
    else if (scene.kind === "barfly") tickBarfly(dt);
  });

  /* ---- THE ORIGIN RATCHET ------------------------------------------------
     `bespoke` counts stories still carrying a hand-written scene function
     instead of running through the composition generator. It started at 3
     (exec / barfly / tenant, which are genuinely better hand-written and are
     allowed to stay) and may only ever go DOWN — the point of the number is
     that the SEVENTH story must not add a fourth. */
  CBZ.cityOriginAudit = function () {
    let bespoke = 0, composed = 0, resumeOnly = 0;
    for (const k in ORIGINS) {
      if (k === "random") continue;
      // `previous` is a PARKED CHARACTER, not a story: it has no opening at
      // all (its ledger always carries originPlayed:true, so cityOriginApply
      // returns at the resume branch and its scene is unreachable). Counting
      // it as a hand-written scene made this ratchet read 4 and fail the gate
      // for adding a way to get an old save BACK — which is the opposite of
      // what the number is for. It measures openings that resisted the
      // generator; a character with no opening cannot be one of those.
      if (k === PREV_ID) { resumeOnly++; continue; }
      // `contract` is a DELEGATION, not an opening: with the campaign on its
      // scene is a safe-spawn stub and city/campaign.js stages the real
      // prologue; with it off the row runs the GENERATOR (the merged hitman
      // composition) — either way no hand-written scene resisted the
      // generator, so it never counts toward `bespoke` (same reasoning as the
      // parked previous-life character above).
      if (k === "contract") { resumeOnly++; continue; }
      if (ORIGINS[k].composition) composed++; else bespoke++;
    }
    return {
      stories: Object.keys(ORIGINS).length,
      resumeOnly: resumeOnly,
      composed: composed, bespoke: bespoke,
      axes: Object.keys(AXES).length,
      planes: CBZ.cityOriginPlanes ? CBZ.cityOriginPlanes().length : 0,
      heatPending: heatPending, heatOpen: heatOpen,
    };
  };
})();
