/* ============================================================
   warlord/gunplay.js — THE WARLORD'S TRIGGER IS THE ENGINE'S TRIGGER.

   THE REPORT (owner): "the actual shooting controls right now suck. They are
   not like the jail game or gun game, which are great. Fix that too — because
   you didn't reuse for that."

   He is right, and the fault is named in battle.js's own comment. It said:

       "A compact first-person/third-person controller, and it is deliberately
        NOT systems/fpsmode.js. That file is 4 400 lines of CITY player — it
        wants CBZ.game.state, the inventory, the wanted ladder, the HUD, the
        vehicle seams — and standing it up on a slice page would mean stubbing
        a game."

   Every clause of that is checkable and every clause of it is wrong:

     · CBZ.game.state — core/microboot.js DECLARES it. `{state:"playing",
       mode:"slice"}`, with a comment saying it exists precisely so engine
       modules run on a slice page. It was already there when that was typed.
     · the inventory — fpsmode asks ONE question, `CBZ.hasWeapon(id)`. The
       warlord already owns guns: his own `wid` plus everything in
       `W.state.baggage`. Four lines of routing, and weapon switching (a thing
       the fork simply did not have) arrives with it.
     · the wanted ladder — `CBZ.reportCrime && …`. Feature-detected. Absent
       here, so it never runs.
     · the HUD — `document.getElementById("crosshair")` and `"ammo"`. Two
       divs. It draws its own hit marker in JS.
     · the vehicle seams — `CBZ.player.driving`, read as falsy. One field.

   So the fork bought us a 150-line controller that had no ADS, no recoil
   pattern, no reload, no spread, no falloff, no headshots, no hit marker, no
   weapon switching, no reserve ammo, a 5-degree magnet the code itself called
   "aim assist", and a third-person camera whose LOOK POINT was offset
   sideways from its POSITION — so in third person the rounds did not go where
   the dot was. What it cost was the file the owner actually likes.

   ---------------------------------------------------------------- WHAT THIS
   FILE IS. An ADAPTER, in the exact idiom games/warlord.html already uses for
   `queryCollidersNear` / `floorAt` / `collide`: ROUTE THE NAME, NEVER FORK THE
   FILE. It loads systems/fpsmode.js (plus gunhands and lockon) at battle time
   and points the handful of names that file asks the CITY for at what the
   warlord already has. It writes no ballistics, no spread model, no recoil
   ladder, no reload timing, no reticle and no hit detection — all of that is
   fpsmode.js's, unmodified, running here. (The one large block of gun code
   below the fold is the OLD one, moved here whole behind ?gunplay=old so the
   two can be photographed against each other. It is dead unless you ask for
   it, and it is in this file so that the day the comparison stops being
   interesting the whole fork comes out in one delete.)

   THE ROUTING TABLE (the whole adapter, stated so it is checkable):

     fpsmode asks for        warlord answers with              why
     ---------------------   -------------------------------   ------------
     CBZ.player.pos/speed    the warlord actor's own pos        he IS the player
     CBZ.playerChar.group    his studio.cast rig                death credit
     CBZ.cam.yaw/pitch       THE look state, owned here         see LOOK below
     CBZ.hasWeapon(id)       his wid + W.state.baggage          his real guns
     CBZ.npcs                the enemy roster                   scan() targets
     CBZ.cityPeds            the same list                      lockon's assist
     CBZ.losBlockers         the rocks + an analytic dune       cover stops it
     CBZ.aiKill              battle.js's killMan                ONE death path
     CBZ.knockback           battle.js's hit funnel             armour + morale
     CBZ.keys.q              microboot's key state              the weapon swap
     CBZ.CONFIG.FPS_ADS_SIGHTS  config.js's own shipped true    the ADS pose
     #crosshair / #ammo      two divs this file makes           the repo's own

   Everything else fpsmode wants is either already on the page (CBZ.camera,
   CBZ.scene, CBZ.onAlways, CBZ.sfx, CBZ.shake, CBZ.tracer, CBZ.bulletImpact,
   CBZ.FPS_WEAPONS) or feature-detected and absent.

   ---------------------------------------------------------------- LOOK, and
   why there is exactly one owner of it. fpsmode reads the aim off `CBZ.cam.yaw`
   + `fps.fp` in first person and `CBZ.cam.yaw` + `CBZ.cam.pitch` in the
   shoulder, and RECOIL IS WRITTEN BACK INTO THOSE SAME FIELDS (kickView) —
   that is the whole reason its recoil climbs the view instead of secretly
   bending the bullet. So CBZ.cam is THE look state here and the warlord's
   yaw/pitch are DERIVED from it every frame, never the other way round. The
   fork kept its own YOU.yaw and would have eaten every kick.
   Sign check, done once, on paper, because getting it wrong is invisible:
     fpsmode first person  forward = (-sin y·cos p,  sin p, -cos y·cos p), p=fps.fp
     fpsmode shoulder      forward = (-sin y·cos p, -sin p, -cos y·cos p), p=cam.pitch
     warlord                   dir = ( sin Y·cos P,  sin P,  cos Y·cos P)
   → cam.yaw = Y + PI, fps.fp = P, cam.pitch = -P. Both branches agree.

   ---------------------------------------------------------------- WHAT COULD
   NOT BE MOUNTED, and why, because a reuse claim with no exceptions in it is
   not a reuse claim:

     systems/touch.js — NOT MOUNTED. It is the CITY's thumb layer: it builds a
       radar, a vehicle/heli button bank, tap-to-interact against cityCars and
       city/interactions.js, and it styles all of it out of css/mobile.css. Its
       own header says so ("it reaches into cityCars, fpsFire, interactions,
       grapple, the camera rig and the ped grid, so it cannot stand up without
       the whole game under it"), and core/microboot.js already ships the
       PORTABLE half of it — the same fixed left stick, the same rim-sprint,
       the same right-half look drag, the same "a hold owns its thumb, so
       anything held with the trigger is a LATCH" grammar. So the buttons below
       are built with micro.touch.addButton and wired to touch.js's OWN verbs:
       CBZ.fpsFire / CBZ.fpsSetAim / CBZ.fpsReload / CBZ.fpsNextWeapon. Same
       four calls touch.js makes, off the same grammar, without the city.

     systems/combat.js — NOT MOUNTED. It is melee, and the brief is explicit
       that this game stays ultra-simple. No stance, no blade, no punch.

     css/hud.css — NOT LINKED, two rules COPIED (see the style block). That
       file also styles #hud, #compass and #minimap, and warlord.html owns
       #hud for the campaign strip; linking it whole repaints the campaign.

     the reticle/ammo/hit-marker DOM — fpsmode reads `#crosshair` and `#ammo`
       by id AT LOAD, so they are created before the script tag goes in.

   FLAGS (repo doctrine — every behaviour switch reverts in one param)
     ?gunplay=old   the hand-rolled controller battle.js used to carry, moved
                    here verbatim so the A/B can still be photographed. This is
                    the before side of tools/visual-presets/warlord-gunplay.mjs.
     ?gunplay=0     no player gunplay at all (spectate the AI war)
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  if (W.gunplay) return;                       // idempotent (family guard idiom)

  const clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  function safe(fn) { try { return fn(); } catch (e) { console.warn("[warlord/gunplay]", e); return null; } }

  /* THE ENGINE FILES THIS ADAPTER MOUNTS. Loaded at battle time rather than at
     page load: a campaign ride does not need a first-person weapon system, and
     warlord.html's boot bar is already forty files long on a phone. Order is
     load order only — gunhands and lockon both reach fpsmode through
     feature-detected CBZ.* names at CALL time, never at load, so none of the
     three can be broken by arriving second. */
  const ENGINE = [
    "systems/fpsmode.js",    // THE gun: spread, recoil pattern, ADS, reload,
                             // falloff, headshots, hit marker, reticle, tracers
    "systems/gunhands.js",   // the off hand actually holds the gun, and reloads it
    "systems/lockon.js",     // soft aim-lock while ADS + the real sniper scope
  ];

  let loading = null, loaded = false;
  function loadScript(rel) {
    return new Promise(function (resolve) {
      const src = (CBZ.studio && CBZ.studio.root ? CBZ.studio.root : "../src/") + rel;
      const s = document.createElement("script");
      s.src = src; s.async = false;
      s.onload = function () { resolve(true); };
      s.onerror = function () { console.warn("[warlord/gunplay] missing:", rel); resolve(false); };
      document.head.appendChild(s);
    });
  }

  /* ============================================================ THE SHIMS
     Installed BEFORE fpsmode.js is fetched, because that file resolves
     `#crosshair`, `#ammo` and `CBZ.camera.add(vm)` at load time — a shim that
     arrives after the script tag is a shim that never happened.

     Every one of these is `if absent`. If this page ever loads the real city
     files, they win and this file adds nothing. */
  function installShims() {
    /* CBZ.game already exists — core/microboot.js declares
       {state:"playing", mode:"slice"} for exactly this reason. Nothing to do:
       "slice" is the honest answer and it is what makes every
       `mode === "city"` branch in fpsmode a clean no-op. */
    if (!CBZ.game) CBZ.game = { state: "playing", mode: "slice" };

    /* THE PLAYER RECORD. Fields fpsmode reads: pos (live reference), dead,
       driving, stun, _swim, speed, grounded, crouch, prone. `pos` is
       re-pointed at the warlord's own position vector on mount, so nothing
       here ever copies coordinates around. */
    if (!CBZ.player) CBZ.player = { pos: { x: 0, y: 0, z: 0 }, dead: false, driving: false,
      speed: 0, grounded: true, crouch: false, prone: false, stun: 0 };
    /* THE LOOK STATE. See the LOOK block in the header: this is the ONE owner,
       and it is what recoil is written into. */
    if (!CBZ.cam) CBZ.cam = { yaw: 0, pitch: 0, dist: 5 };
    /* fpsmode polls CBZ.keys["q"] once a frame for the weapon swap (its own
       comment explains why it is a poll and not a keydown). */
    if (!CBZ.keys) CBZ.keys = Object.create(null);
    /* island modes hand the pointer to the grapple; this is not one. */
    if (!CBZ.islandModeOn) CBZ.islandModeOn = function () { return false; };
    /* WHAT A BULLET STOPS ON. fpsmode's wallDistance raycasts this array — an
       undefined one throws inside intersectObjects, so it must at minimum be
       []. Filled on mount with the battlefield's own rocks, which is what
       turns cover from a thing the AI respects into a thing YOUR rounds do. */
    if (!CBZ.losBlockers) CBZ.losBlockers = [];
    /* The two rosters findActorHit scans outside the city. Kept as stable
       array objects so the identity never changes under fpsmode. */
    if (!CBZ.npcs) CBZ.npcs = [];
    if (!CBZ.guards) CBZ.guards = [];
    /* systems/lockon.js's soft aim-lock (and fpsmode's pickLockActor) scan the
       CITY ped lists unconditionally — they predate the mode split. Pointing
       cityPeds at the same enemy list is a name route, not a fork: the city
       branch of findActorHit is gated on mode === "city" so nothing is scanned
       twice. This is what gives a thumb a target that holds still. */
    if (!CBZ.cityPeds) CBZ.cityPeds = [];
    if (!CBZ.cityCops) CBZ.cityCops = [];

    /* THE ONE CONFIG SEED THIS PAGE IS MISSING. src/config.js sets
       FPS_ADS_SIGHTS = true and is a CITY file, so on a slice page fpsmode's
       centred down-the-sights viewmodel pose is gated off by a `=== true` test
       that reads undefined — MEASURED: holding aim punched the FOV from 75 to
       50 and left the rifle sitting in the bottom-right corner, which is a
       zoom, not aiming. Seeded with config.js's own shipped value and its own
       `== null` guard, so a ?cfg_ override still wins. Every other gate
       fpsmode reads it seeds itself. */
    CBZ.CONFIG = CBZ.CONFIG || {};
    if (CBZ.CONFIG.FPS_ADS_SIGHTS == null) CBZ.CONFIG.FPS_ADS_SIGHTS = true;

    ensureHudDom();
  }

  /* THE RETICLE AND THE AMMO READOUT ARE THE REPO'S OWN, down to the CSS.
     css/hud.css is COPIED here rather than linked, and only these two rules:
     that stylesheet also owns #hud, #compass and #minimap, and warlord.html
     uses #hud for the campaign strip — linking it whole repaints the campaign
     from a file about the city. The rules below are byte-for-byte the ones at
     css/hud.css:407-449, so the crosshair the warlord aims with is literally
     the crosshair the jail and gun game aim with, including the .hot / .dry /
     .blocked / .locked states fpsmode toggles on it. */
  function ensureHudDom() {
    if (!document.getElementById("wgpCss")) {
      const st = document.createElement("style");
      st.id = "wgpCss";
      st.textContent =
        "#crosshair{position:absolute;left:50%;top:50%;width:16px;height:16px;transform:translate(-50%,-50%);" +
          "display:none;pointer-events:none;border:0;box-sizing:border-box;color:rgba(255,255,255,.92);" +
          "background:radial-gradient(circle,currentColor 0 1px,transparent 1.35px);" +
          "filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.95));transition:color 55ms linear,opacity 55ms linear;z-index:46}" +
        "#crosshair::before,#crosshair::after{content:\"\";position:absolute;border-radius:2px;box-shadow:0 0 1.5px rgba(0,0,0,.95)}" +
        "#crosshair::before{left:50%;top:0;bottom:0;width:1.5px;margin-left:-.75px;" +
          "background:linear-gradient(to bottom,currentColor 0 4px,transparent 4px calc(100% - 4px),currentColor calc(100% - 4px))}" +
        "#crosshair::after{top:50%;left:0;right:0;height:1.5px;margin-top:-.75px;" +
          "background:linear-gradient(to right,currentColor 0 4px,transparent 4px calc(100% - 4px),currentColor calc(100% - 4px))}" +
        "#crosshair.locked{color:#8fd0ff;background:radial-gradient(circle,currentColor 0 1px,transparent 1.5px)}" +
        "#crosshair.hot{color:#ff4a42;background:radial-gradient(circle,currentColor 0 1px,transparent 1.5px)}" +
        "#crosshair.blocked{color:#ffb33f;opacity:.94}" +
        "#crosshair.dry{color:#ffd451;background:radial-gradient(circle,currentColor 0 1px,transparent 1.5px)}" +
        "#ammo{position:absolute;right:22px;bottom:210px;display:none;pointer-events:none;font-weight:700;" +
          "font-size:22px;letter-spacing:1px;color:#fff;font-variant-numeric:tabular-nums;" +
          "text-shadow:0 2px 0 rgba(0,0,0,.5);white-space:pre;text-align:right;line-height:1.18;z-index:46}" +
        /* THE AMMO READOUT MOVES OFF THE THUMBS ON A PHONE — the same line
           css/hud.css carries, for the same reason: the trigger lives at
           bottom-right and a number under it is a number under a thumb. */
        "body.micro-touch #ammo{bottom:auto;top:118px;right:18px;font-size:18px}" +
        "#hitMarker{z-index:47}";
      document.head.appendChild(st);
    }
    /* The two elements fpsmode resolves BY ID AT LOAD. They live in a wrapper
       so teardown removes one node, and the wrapper is positioned so the
       crosshair's `left/top: %` land on the viewport — fpsmode projects the
       real muzzle ray's impact into these percentages, which is the whole
       mechanism that makes the dot honest beside cover. */
    if (!document.getElementById("wgpHud")) {
      const root = document.createElement("div");
      root.id = "wgpHud";
      root.style.cssText = "position:fixed;inset:0;z-index:46;pointer-events:none";
      root.innerHTML = '<div id="crosshair"></div><div id="ammo"></div>';
      document.body.appendChild(root);
    }
  }

  function ensure() {
    if (loaded) return Promise.resolve(true);
    if (loading) return loading;
    /* THE REVERT DOES NOT DOWNLOAD THE THING IT REVERTS. ?gunplay=old is meant
       to be the build as it was, so it must not fetch four thousand lines of
       fpsmode and then not use them — and the A/B's own ratchet (how many
       engine gun files are answering) is only honest if the before side really
       has none. Read off location rather than ctx.Q because ensure() runs at
       page boot, before any battle has a context. */
    try {
      const q = new URLSearchParams(location.search).get("gunplay");
      if (q === "old" || q === "0") { loaded = false; return Promise.resolve(false); }
    } catch (e) {}
    installShims();
    loading = ENGINE.reduce(function (p, rel) {
      return p.then(function () { return loadScript(rel); });
    }, Promise.resolve()).then(function () {
      loaded = !!CBZ.fpsFire;
      if (!loaded) console.warn("[warlord/gunplay] fpsmode did not mount — falling back to the legacy controller");
      return loaded;
    });
    return loading;
  }

  /* ============================================================ MOUNT
     `api` is battle.js's side of the seam. It is deliberately a set of
     FUNCTIONS rather than a pile of state: this file must not be able to
     reach into the battle and change anything except through a door battle.js
     opened on purpose. */
  let A = null;              // the api
  let on = false;            // gunplay is mounted
  let legacy = false;        // ?gunplay=old
  let THREE = null, micro = null;
  let camMode = "fps";
  const CAMS = ["fps", "third", "cmd"];
  let alwaysFn = null, ledgerFn = null;
  let touchBtns = [];
  let enemies = [];          // the array CBZ.npcs / CBZ.cityPeds point at
  let enemyT = 0;
  let wasDead = false;
  let baseFov = 0;
  /* THE SHOT LEDGER. fpsmode has no "a round left the barrel" callback — it
     just decrements its own magazine — so rounds fired are read off that
     magazine once a frame. Everything the preset measures (rounds fired, hits,
     time to kill) is counted here, at the one place that sees both ends. */
  const stats = { shots: 0, hits: 0, kills: 0, damage: 0, firstShotT: -1, lastKillT: -1, t: 0 };
  let lastRounds = -1;

  function Q() { return (A && A.ctx && A.ctx.Q) || null; }
  function flag() { const q = Q(); return q ? (q.get("gunplay") || "") : ""; }

  function mount(api) {
    A = api;
    THREE = api.THREE; micro = api.micro;
    on = true;
    camMode = api.coarse ? "third" : "fps";
    legacy = flag() === "old";
    /* ?gunplay=0 — NO PLAYER GUN AT ALL, which is only a coherent thing to ask
       for from the command seat: without a controller nobody drives the
       first-person lens, so leaving it in first person is a frozen camera
       staring at sand. Hand the battle its own chair and get out of the way. */
    if (flag() === "0") {
      on = false; A = null;
      if (api.setCam) safe(function () { api.setCam("cmd"); });
      return { mode: "off" };
    }

    if (legacy) { legacyMount(); return { mode: "legacy" }; }
    if (!loaded) { legacy = true; legacyMount(); return { mode: "legacy-fallback" }; }

    installShims();
    baseFov = CBZ.camera.fov;

    /* ---- the player. `pos` is the warlord's OWN vector, by reference: he is
       one actor in one roster and there is no second copy of where he is. */
    CBZ.player.pos = A.you.pos;
    CBZ.player.dead = false; CBZ.player.driving = false; CBZ.player._swim = false;
    CBZ.player.stun = 0; CBZ.player.grounded = true; CBZ.player.speed = 0;
    CBZ.player.crouch = false; CBZ.player.prone = false;
    /* THE PLAYER'S BODY IS THE REAL RIG, sockets and all — and this is what
       makes third person aim true. fpsmode hangs its carried gun in the rig's
       `thirdPersonWeapon` hand socket and then WORLD-BARREL-LOCKS it onto the
       reticle ray every frame; with a `{group: …}` stand-in there was no
       socket, the gun fell back onto the rig root, and the first third-person
       capture had the muzzle firing off toward the bottom-right corner while
       the crosshair sat on the horizon. entities/character.js's own return
       shape carries the sockets; studio.cast leaves it on userData.charRig. */
    const charRig = A.youRig && A.youRig.userData && A.youRig.userData.charRig;
    CBZ.playerChar = (charRig && charRig.sockets) ? charRig : { group: A.youRig || CBZ.camera };
    /* AND HE CARRIES ONE GUN, NOT TWO. battle.js fills every man's hands with
       systems/actorweapons.js — right for an NPC, and the warlord got it too.
       fpsmode's carried model is the one that ADS-poses, reloads (gunhands.js)
       and CHANGES when you switch weapons, so it wins and actorweapons' prop
       is stood down. Not dropped: killMan still owns what happens to a rifle
       when its man goes down, and this one belongs to a man who, when he goes
       down, ends the battle. */
    if (A.you._weaponProp) A.you._weaponProp.visible = false;
    /* r128: A CHILD OF A DETACHED CAMERA IS NEVER TRAVERSED BY THE RENDERER,
       and fpsmode parents its whole viewmodel to CBZ.camera. On the city pages
       the camera is already in the graph; on a slice page it is not, so the
       first capture after the fork came out came back with tracers, brass and
       a hit marker but NO GUN IN FRAME. (battle.js's deleted buildViewGun
       carried this same line for the same reason — it is the one thing in that
       function that was not about building a second weapon model.) */
    if (!CBZ.camera.parent) CBZ.scene.add(CBZ.camera);
    if (A.youRig && A.youRig.userData) CBZ.playerChar.charRig = A.youRig.userData.charRig;

    /* ---- the look. Seeded from the spawn bearing the battle gave him so the
       first frame is not a stare at the sky. See the sign check in the header. */
    CBZ.cam.yaw = A.you.yaw + Math.PI;
    CBZ.cam.pitch = 0;
    if (CBZ.fps) CBZ.fps.fp = 0.06;

    /* ---- HIS GUNS ARE HIS GUNS. `hasWeapon` is the ONE ownership question
       fpsmode asks, and answering it off core.js's own state is what makes
       weapon switching real without a weapon wheel: the guns you can cycle to
       are the guns in your cart, and when you loot an AK off a body the swap
       list grows. No new inventory, no new UI, no invented ballistics — every
       number comes off the weapon-data record for that id. */
    /* CAPTURE THE PREVIOUS OWNER ONCE. A mount that ran twice without a
       teardown between would otherwise capture ITS OWN wrapper as the fallback
       and recurse forever the first time it was asked about a gun it does not
       own. The marker makes a double mount idempotent instead. */
    const prevHas = (CBZ.hasWeapon && CBZ.hasWeapon._wlOwn) ? CBZ._wlPrevHasWeapon : CBZ.hasWeapon;
    CBZ._wlPrevHasWeapon = prevHas || null;
    CBZ.hasWeapon = function (id) {
      if (!on || legacy) return prevHas ? prevHas(id) : false;
      const S = W.state;
      if (!S || !S.you) return false;
      if (id === S.you.wid) return true;
      return !!(S.baggage && S.baggage[id] > 0);
    };
    CBZ.hasWeapon._wlOwn = true;
    CBZ.weaponInventory = ownedIds();
    CBZ.currentWeaponId = W.state.you.wid;
    if (CBZ.fpsResetWeapons) safe(CBZ.fpsResetWeapons);
    /* AND HIS RESERVE IS WHAT HE IS CARRYING, not weapon-data's shop default.
       A campaign warlord who rode out with one spare magazine should not have
       120 rounds because the city's carbine row says so. `reserve` is the
       gun's own listed reserve scaled by how many of that gun sit in the cart
       — the only honest number this game has for "how much ammo did you
       bring", and it is derived, not typed. */
    setReserves();

    /* ---- the targets. Enemies only, and that is a decision, not an
       oversight: the fork did the same and it is right for a game whose whole
       loop is EARNING an army. A rank of your own men that eats your rounds
       makes the army you spent the campaign collecting a liability, and the
       brief is "ultra simple". Rocks still stop the round; men on your side
       do not. */
    CBZ.npcs = enemies; CBZ.cityPeds = enemies; CBZ.guards.length = 0; CBZ.cityCops.length = 0;
    refreshEnemies(true);
    /* ---- WHAT A ROUND STOPS ON. Two things, and neither is the terrain
       MESH. The rocks go in as themselves; the SAND goes in as an analytic
       blocker (below) rather than as the 45 000-triangle displaced plane the
       battlefield is drawn with, because fpsmode raycasts this array three
       times a FRAME for the reticle — once for camera intent, once for the
       real muzzle ray, once for the acquire — and a full-mesh test there is
       a millisecond of phone budget for an answer battle.js can already
       give exactly. The analytic one is also the more correct one: it agrees
       with the ground the men are standing on, and the mesh only approximates
       that at 3 m cells. The flat fog skirt is excluded outright — a round
       must not stop on the horizon. */
    const blockers = [];
    const raw = A.losBlockers || [];
    for (let i = 0; i < raw.length; i++) {
      const m = raw[i];
      if (m && !(m.userData && m.userData.terrain)) blockers.push(m);
    }
    blockers.push(groundBlocker());
    CBZ.losBlockers = blockers;

    /* ---- THE DEATH PATH. fpsmode's non-city gunHit finishes a lethal round
       through CBZ.aiKill — the same one choke point the prison and gun game
       use — so routing it into battle.js's killMan means the warlord's kills
       and an NPC's kills land in ONE funnel: the ragdoll, the dropped rifle
       the aftermath will put in your cart, the kill credit, the morale hit and
       the corpse budget. There is no second death rule for the player. */
    if (!(CBZ.aiKill && CBZ.aiKill._wlOwn)) CBZ._wlPrevAiKill = CBZ.aiKill || null;
    CBZ.aiKill = function (a, by, opts) {
      if (!on || !A || !isBattleMan(a)) {
        if (CBZ._wlPrevAiKill) return CBZ._wlPrevAiKill(a, by, opts);
        if (a) { a.dead = true; a.hp = 0; }
        return;
      }
      stats.kills++; stats.lastKillT = stats.t;
      A.kill(a);
    };
    CBZ.aiKill._wlOwn = true;

    /* ---- THE HIT PATH, and it is the one genuinely awkward seam in this
       file, so it is stated in full.

       fpsmode's gunHit subtracts the round from `a.hp` itself and then calls
       CBZ.knockback — which makes knockback the first callback after every
       landed round, lethal or not. That is where warlord's ARMOUR goes on.
       core.js states armour as a flat per-hit SOAK that never stops more than
       about two thirds of a round (it stops a pistol outright and merely
       blunts a rifle), and fpsmode has no field for that concept — so the raw
       round is PUT BACK and re-applied through battle.js's own hurtOne, which
       is the file's one soak formula and stays the only one. Not faked as
       extra hp: soak and hp are visibly different things and this game's
       armour screen promises the first.

       The stamp `_wlHp` is refreshed for every man once a frame in drive()
       rather than lazily, because between our shots the NPC war is also moving
       hp and a stale stamp would re-apply somebody else's damage. Six hundred
       float writes a frame is cheaper than being wrong. */
    if (!(CBZ.knockback && CBZ.knockback._wlOwn)) CBZ._wlPrevKnockback = CBZ.knockback || null;
    CBZ.knockback = function (a, fx, fz, k) {
      if (!on || !A || !isBattleMan(a)) {
        if (CBZ._wlPrevKnockback) return CBZ._wlPrevKnockback(a, fx, fz, k);
        return;
      }
      const prev = (a._wlHp == null) ? a.hp : a._wlHp;
      const raw = prev - a.hp;
      if (raw > 0) {
        a.hp = prev;                       // undo fpsmode's un-armoured subtraction
        const after = A.soak(a, raw);      // battle.js's hurtOne — it subtracts
        stats.hits++; stats.damage += after;
        /* THE KILL IS COUNTED HERE, NOT IN THE aiKill SHIM, and that is not an
           accident: this hook runs INSIDE fpsmode's gunHit, before its own
           `if (a.hp <= 0) CBZ.aiKill(...)` line, and A.hit below already ends
           in battle.js's killMan — so by the time fpsmode looks, the man is
           dead and it correctly declines to kill him twice. aiKill stays wired
           for the paths that reach it first (a headshot sets hp to 0 without
           passing through the soak refund). */
        if (a.hp <= 0 && !a.dead) { stats.kills++; stats.lastKillT = stats.t; }
        A.hit(a, prev - a.hp);
      }
      a._wlHp = a.hp;
    };
    CBZ.knockback._wlOwn = true;

    buildTouch();
    setCam(camMode);
    if (CBZ.fpsSetActive) CBZ.fpsSetActive(camMode === "fps");

    /* ---- THE FRAME SEAT. 51.5, immediately before fpsmode's own onAlways(52)
       and after microboot's light pin at 9 — the same slot systems/camera.js
       occupies in the city (50), and for the same reason: fpsmode's viewmodel,
       reticle projection and held-trigger auto fire all read the camera and
       the aim, so the lens has to already be where this frame's input put it.
       Running this from battle.js's frame hook instead put it AFTER fpsmode
       and every burst photographed the previous frame's aim. */
    alwaysFn = function (dt) { if (on && !legacy) drive(dt || 0); };
    CBZ.onAlways(51.5, alwaysFn);
    /* AND THE LEDGER READS AFTER THE GUN, at 53. fpsmode has no "a round left
       the barrel" callback — it decrements its own magazine — so rounds fired
       are the drop in that magazine, and it has to be sampled AFTER its
       onAlways(52) or every burst is counted one frame short. Measured: 4
       rounds against 5 landed hits, which is an impossible accuracy and the
       reason this is a second hook instead of one. */
    ledgerFn = function () {
      if (!on || legacy || !A) return;
      const f = CBZ.fps;
      if (!f || !f.rounds) return;
      const now = f.rounds[f.weapon];
      // a reload puts rounds BACK; only a drop is fire
      if (lastRounds >= 0 && now < lastRounds) {
        const n = lastRounds - now;
        stats.shots += n;
        if (stats.firstShotT < 0) stats.firstShotT = stats.t;
        A.shot(n);
      }
      lastRounds = now;
    };
    CBZ.onAlways(53.2, ledgerFn);
    return { mode: "engine" };
  }

  function ownedIds() {
    const S = W.state, out = [];
    if (!S || !S.you) return out;
    out.push(S.you.wid);
    for (const id in (S.baggage || {})) if (S.baggage[id] > 0 && id !== S.you.wid) out.push(id);
    return out;
  }
  function setReserves() {
    const f = CBZ.fps, S = W.state;
    if (!f || !f.reserves || !CBZ.FPS_WEAPONS) return;
    for (let i = 0; i < CBZ.FPS_WEAPONS.length; i++) {
      const w = CBZ.FPS_WEAPONS[i];
      const id = w.id || w.key;
      const spares = (S.baggage && S.baggage[id]) || 0;
      // the gun you carry brings its own listed reserve; a spare in the cart is
      // another gun's worth of magazines. Derived from weapon-data, not typed.
      const mags = (id === S.you.wid ? 1 : 0) + spares;
      f.reserves[i] = Math.round((w.reserve || 0) * clamp(mags * 0.5, 0.34, 1));
    }
    if (CBZ.fpsResyncAmmo) safe(CBZ.fpsResyncAmmo);
  }

  /* THE SAND, AS A RAYCAST TARGET. A bare Object3D with its own raycast(),
     which is three.js's own extension point — `ray.intersectObjects` calls it
     like any mesh, so fpsmode's wallDistance, its reticle projection and its
     acquire all get an honest dune with nothing in that file changed. The
     march is coarse-then-bisect: 1.5 m steps out to the weapon's range (a
     dune's wavelength here is hundreds of metres, so a 1.5 m step cannot skip
     a crest), then eight bisections to land the impact point within ~6 mm. */
  let _gb = null;
  function groundBlocker() {
    if (_gb) return _gb;
    const o = new THREE.Object3D();
    o.name = "warlordSand";
    o.userData.terrain = true;
    o.matrixAutoUpdate = false;
    o.raycast = function (rc, out) {
      if (!A || !A.live()) return;
      const o0 = rc.ray.origin, d = rc.ray.direction;
      const far = Math.min(rc.far || 400, 400);
      if (d.y > -0.0005 && o0.y - A.groundAt(o0.x, o0.z) > 0.05) {
        // climbing or level and already above the sand: only a very long shot
        // can come back down, and this game's rounds are hitscan and flat
        if (d.y >= 0) return;
      }
      const STEP = 1.5;
      let prev = 0, prevAbove = o0.y - A.groundAt(o0.x, o0.z);
      if (prevAbove < 0) return;                       // started underground; not our problem
      for (let t = STEP; t <= far; t += STEP) {
        const x = o0.x + d.x * t, y = o0.y + d.y * t, z = o0.z + d.z * t;
        const above = y - A.groundAt(x, z);
        if (above <= 0) {
          let lo = prev, hi = t;
          for (let k = 0; k < 8; k++) {
            const mid = (lo + hi) * 0.5;
            const my = o0.y + d.y * mid;
            if (my - A.groundAt(o0.x + d.x * mid, o0.z + d.z * mid) > 0) lo = mid; else hi = mid;
          }
          const p = new THREE.Vector3(o0.x + d.x * hi, o0.y + d.y * hi, o0.z + d.z * hi);
          out.push({ distance: hi, point: p, object: o, face: null });
          return;
        }
        prev = t; prevAbove = above;
      }
    };
    _gb = o;
    return o;
  }

  function isBattleMan(a) { return !!(a && A && a.side && a.team && a.pos); }

  /* The enemy list fpsmode scans. Rebuilt on a 5 Hz tick rather than every
     frame: findActorHit already skips the dead, so a man who died between
     rebuilds costs one skipped iteration, and lockon re-picks at 10 Hz. */
  function refreshEnemies(force) {
    if (!A) return;
    if (!force && (enemyT -= 1) > 0) return;
    enemyT = 12;
    enemies.length = 0;
    const men = A.men();
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (!m || m.isYou || m.team === "mine" || m.dead || m.fled || !m.group) continue;
      enemies.push(m);
    }
  }

  /* ============================================================ THE FRAME */
  const _dir = { x: 0, y: 0, z: 0 };
  function drive(dt) {
    if (!A || !A.live()) return;
    const you = A.you;
    const IN = micro.input, T = micro.touch;

    stats.t += dt;
    // the shot bookkeeping stamp — see the CBZ.knockback block for why
    const men = A.men();
    for (let i = 0; i < men.length; i++) men[i]._wlHp = men[i].hp;
    refreshEnemies(false);

    // ---- the player record fpsmode reads
    CBZ.player.dead = !!you.dead;
    if (you.dead && !wasDead) { wasDead = true; if (CBZ.fpsSetActive) safe(function () { CBZ.fpsSetActive(false); }); }
    CBZ.game.state = "playing";
    if (you.dead) return;

    if (camMode === "cmd") { you.speed = 0; CBZ.player.speed = 0; return; }

    /* ---- LOOK. One place, one owner. Mouse/drag/thumb all arrive as
       input.mx/mz (microboot merges them on purpose), and the PITCH is only
       applied here in the shoulder: in first person fpsmode's own mousemove
       listener already moves fps.fp under pointer lock, and applying it twice
       made the view climb at double rate the first time this ran. */
    const sens = (IN && IN.sensitivity) || 0.0022;
    if (IN) {
      CBZ.cam.yaw -= IN.mx * sens;
      const pitchDelta = IN.mz * sens;
      if (camMode === "third") CBZ.cam.pitch = clamp(CBZ.cam.pitch + pitchDelta, -1.2, 1.2);
      else if (!IN.locked) CBZ.fps.fp = clamp(CBZ.fps.fp - pitchDelta, -1.3, 1.3);
      // (locked: fpsmode's own mousemove owns fps.fp — see above)
    }
    // the warlord's own bearing is DERIVED from the look, never the reverse,
    // so every degree of recoil kickView put into cam is a degree he turned
    you.yaw = CBZ.cam.yaw - Math.PI;
    you.pitch = camMode === "third" ? -CBZ.cam.pitch : CBZ.fps.fp;
    if (A.youRig) A.youRig.rotation.y = you.yaw;

    // ---- WALK. Same axes and same speed rule battle.js had; the armour slow
    // is core's own number and stays.
    let mx = IN ? IN.axis("KeyA", "KeyD") : 0, mz = IN ? IN.axis("KeyS", "KeyW") : 0;
    if (T && T.active && T.stick.mag > 0.05) { mx = T.stick.x; mz = -T.stick.y; }
    const sprint = (IN && IN.isDown("ShiftLeft")) || (T && T.stick.rim);
    const base = (sprint ? 7.4 : 4.8) * (1 - W.armour(W.state.you.armour).slow);
    const len = Math.hypot(mx, mz);
    if (len > 0.01) {
      const s = base / Math.max(1, len);
      const sy = Math.sin(you.yaw), cy = Math.cos(you.yaw);
      you.pos.x += (sy * mz + cy * mx) * s * dt;
      you.pos.z += (cy * mz - sy * mx) * s * dt;
      micro.resolveCircle(you.pos, 0.45, you.pos.y, 1.8);
      you.speed = base * Math.min(1, len);
    } else you.speed = 0;
    you.pos.y = A.groundAt(you.pos.x, you.pos.z);
    CBZ.player.speed = you.speed;

    /* ---- THE KEYS fpsmode POLLS RATHER THAN LISTENS FOR. It reads
       CBZ.keys["q"] once a frame for the weapon swap — deliberately, its own
       comment explains that a keydown listener replays buffered switches after
       a lag spike. systems/controls.js fills CBZ.keys in the city and is not
       here, so microboot's key state is mirrored into the same name. */
    if (IN) {
      CBZ.keys.q = IN.isDown("KeyQ");
      CBZ.keys.r = IN.isDown("KeyR");
      CBZ.keys.shift = IN.isDown("ShiftLeft");

      // SPACE is a trigger too (the fork's binding, kept: it is what a laptop
      // trackpad has)
      const sp = IN.isDown("Space");
      if (sp !== spaceHeld) { spaceHeld = sp; if (CBZ.fpsFire) CBZ.fpsFire(sp); }

      /* THE TRIGGER WITHOUT POINTER LOCK. fpsmode's mousedown requires
         `document.pointerLockElement`, which is right in the city and wrong
         here: microboot ships a DRAG-LOOK fallback precisely because lock gets
         refused in real places (an iframe without allow="pointer-lock", a
         browser wanting a fresh gesture, a user who pressed Escape), and its
         own comment says the page must stay playable when it is. Unlocked, the
         held left button drives the trigger the way it drove the fork's. */
      if (!IN.locked && !A.coarse) {
        const lmb = !!IN.buttons[0];
        if (lmb !== mouseHeld) { mouseHeld = lmb; if (CBZ.fpsFire) CBZ.fpsFire(lmb); }
      } else if (mouseHeld) { mouseHeld = false; if (CBZ.fpsFire) CBZ.fpsFire(false); }
    }

    /* ---- AND [V] STILL MEANS WHAT IT MEANS. fpsmode binds V to
       CBZ.toggleFPS() outside the city, which flips fps.active straight past
       this file — so the seat would change and camMode would still say "fps",
       and the next setCam would put it back. Follow the gun rather than fight
       it: fps.active IS the first/third switch, so read it back. */
    if (camMode !== "cmd" && CBZ.fpsActive) {
      const want = CBZ.fpsActive() ? "fps" : "third";
      if (want !== camMode) setCam(want);
    }

    placeCamera(dt);

    /* HIS BODY IS ANIMATED HERE, NOT IN battle.js's RENDER PASS, and the order
       is the whole reason. fpsmode WORLD-BARREL-LOCKS the carried gun onto the
       reticle ray at onAlways(52), which means it writes a local rotation
       measured against the hand socket's CURRENT world transform. battle.js
       animates every man from its frame hook — which microboot runs AFTER
       every always-hook — so animChar re-posed the warlord's arm after the
       lock had been computed against the old one, and the third-person AK
       photographed pointing forty-five degrees above the crosshair while the
       tracer left sideways. Posing him at 51.5 puts the arm where it is going
       to be BEFORE the barrel is locked to the sights. battle.js skips him in
       its own loop for this reason. */
    if (CBZ.animChar && A.you.char) {
      A.you.char.aimPitch = you.pitch;
      safe(function () { CBZ.animChar(A.you.char, you.speed, dt); });
    }
  }
  let spaceHeld = false, mouseHeld = false;

  /* ============================================================ THE LENS
     THE CAMERA FORWARD IS THE AIM, EXACTLY, IN BOTH SEATS. This is the bug the
     fork shipped: its third-person branch put the lens at
     `pos - dir*back + right*side` and then `lookAt(pos + dir*14 + right*side)`
     — two different sideways offsets, so the camera's forward was NOT dir, so
     screen centre was not the aim, so rounds landed off the dot. Here the
     position is offset and the ORIENTATION is set from the aim, which makes
     the two agree by construction. (fpsmode then does the honest half of the
     job on top: its two-ray shoulder aim starts the round at the rendered
     muzzle and converges it on the point under the reticle, so cover beside
     the barrel really can catch a shot the camera can see past.) */
  const _q = { dir: null, look: null };
  function placeCamera(dt) {
    const c = CBZ.camera, you = A.you;
    if (!_q.dir) { _q.dir = new THREE.Vector3(); _q.look = new THREE.Vector3(); }
    /* THE AIM IS COMPUTED, NOT ASKED FOR — and the first draft asked, which was
       a circular definition that cost a whole capture round. In the shoulder
       seat fpsmode's aimForward() answers `CBZ.camera.getWorldDirection()`, so
       orienting the camera from CBZ.playerAimDir() orients the camera from the
       camera: the lens kept whatever bearing it already had, the reticle sat on
       empty sand, and eleven rounds in third person found nothing at all.
       Derived from the look state instead, both seats agree with fpsmode by
       construction — first person because its forward() is this same
       expression off cam.yaw/fps.fp, the shoulder because the camera's own
       forward IS this vector. */
    const dir = _q.dir;
    dir.set(Math.sin(you.yaw) * Math.cos(you.pitch), Math.sin(you.pitch), Math.cos(you.yaw) * Math.cos(you.pitch));
    _dir.x = dir.x; _dir.y = dir.y; _dir.z = dir.z;

    /* THE LENS ANGLE, AND ONLY THE HALF NOBODY ELSE OWNS. fpsmode already eases
       the FIRST-PERSON fov itself (75 hip, 50 on ADS) and its own comment names
       the bug for touching it from outside: "two writers racing toward the same
       target with different smoothing states produced the ADS FLICKER". The
       first draft of this file did exactly that and the lens settled at 73.5
       hip / 51.9 ADS instead of 75 / 50 — measured, and the reason this block
       is four lines rather than twelve. First person is fpsmode's outright; the
       SHOULDER is nobody's here (systems/camera.js owns it in the city and is
       not mounted), so it is taken with camera.js's own armed-chase number and
       the same fourteen-degree ADS punch. */
    if (camMode === "third") {
      const scopeF = (CBZ.fpsScopeFov && CBZ.fpsScopeFov()) || 0;
      const wantFov = scopeF || ((CBZ.isADS && CBZ.isADS()) ? 66 - 14 : 66);
      if (Math.abs(c.fov - wantFov) > 0.05) {
        c.fov += (wantFov - c.fov) * Math.min(1, (dt || 0.016) * 12);
        c.updateProjectionMatrix();
      }
    }

    const eye = you.pos.y + (you.eyeH || 1.62);
    if (camMode === "fps") {
      c.position.set(you.pos.x, eye, you.pos.z);
    } else {
      /* OVER THE SHOULDER — the natural-disaster follow camera's shape, which
         is what the owner asked for in battle: back, up, and offset SIDEWAYS so
         the body sits in a corner and the fight owns the frame. The lens never
         goes under the sand.

         THE MAN'S RIGHT IS dir × up, and getting that backwards is why the
         first capture had him in the middle of the frame: with
         dir = (sin y, ·, cos y), right = (-cos y, 0, sin y). The fork had the
         negative of it and called it "the man's right", so its lens sat on his
         LEFT and the fight it was meant to expose stayed behind him. */
      /* THE SIDE OFFSET IS SCALED BY THE FRAME'S SHAPE. A shoulder camera's
         offset reads as a fraction of the HORIZONTAL field, and a phone held
         upright has barely half a laptop's — measured at 393x852, a fixed
         0.95 m offset put the warlord half off the left edge with his own
         muzzle flash out of frame. Scaled by aspect, he sits in the same
         corner of the picture whatever shape the picture is. */
      /* AND SO IS THE DISTANCE. A tall frame gives the body more of the
         picture at the same range — measured at 393x852 he owned 44% of the
         frame height against 35% on a laptop — so the lens steps back as the
         frame narrows. Both offsets are fractions of the SAME shape, which is
         why they scale together. */
      const asp = c.aspect || 1.7;
      const back = 4.6 * clamp(1.7 / asp, 1, 1.45);
      const up = 1.25;
      const side = 0.95 * clamp(asp / 1.7, 0.42, 1);
      const rx = -Math.cos(you.yaw), rz = Math.sin(you.yaw);
      let px = you.pos.x - dir.x * back + rx * side;
      let pz = you.pos.z - dir.z * back + rz * side;
      let py = eye + up - dir.y * back;
      const g = A.groundAt(px, pz) + 1.2;
      if (py < g) py = g;
      c.position.set(px, py, pz);
    }
    /* AND THE ORIENTATION IS THE AIM, EXACTLY, IN BOTH SEATS. This is the bug
       the fork shipped: its third-person branch put the lens at
       `pos - dir*back + right*side` and then looked at `pos + dir*14 +
       right*side` — two different sideways offsets, so the camera's forward was
       NOT dir, so screen centre was not the aim, so rounds landed off the dot.
       Looking one metre down the aim from wherever the lens ended up makes the
       two agree by construction. (fpsmode then does the honest half on top: its
       two-ray shoulder aim starts the round at the rendered muzzle and
       converges it on the point under the reticle, so cover beside the barrel
       really can catch a shot the camera can see past.) */
    _q.look.copy(c.position).add(dir);
    c.lookAt(_q.look);
    c.updateMatrixWorld(true);
    if (A.youRig) A.youRig.visible = camMode !== "fps";
  }

  /* ============================================================ CAMERAS */
  function setCam(mode) {
    camMode = mode;
    if (!on) return camMode;
    if (legacy) return legacySetCam(mode);
    /* fps.active IS the first/third switch as far as the gun is concerned:
       fpsmode draws the viewmodel and takes the tight assist radii when it is
       on, and falls to shoulderActive() — the carried gun in the rig's hands,
       wider assist, the two-ray muzzle aim — when it is off. One boolean, both
       seats, no second code path. */
    if (CBZ.fpsSetActive) safe(function () { CBZ.fpsSetActive(mode === "fps"); });
    if (mode !== "cmd" && A && A.live()) safe(function () { placeCamera(0.016); });
    if (mode === "cmd" && CBZ.fpsSetAim) CBZ.fpsSetAim(false);
    syncTouchVisible();
    if (mode !== "cmd" && micro.lock && A && !A.coarse) micro.lock();
    return camMode;
  }
  function cycleCam() { return setCam(CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length]); }
  function mode() { return camMode; }

  /* ============================================================ THE THUMBS
     touch.js's verbs, microboot's grammar. See the header for why the file
     itself is not mounted. The LATCH on AIM is the 2026-08-04 rule from
     touch.js verbatim: the right thumb is the only one that can reach the
     trigger, so anything you would hold at the same time as the trigger has to
     be a press-once latch or you end up swiping to shoot. */
  function buildTouch() {
    if (!A || !A.coarse || !micro.touch) return;
    safe(function () { micro.touch.init(); });
    if (!micro.touch.active || !micro.touch.root) return;
    clearTouch();
    /* THE CLUSTER SITS ABOVE THE COMMAND RAIL, not on it. battle.js's four
       order buttons dock along the bottom edge and a phone-width capture had
       FALL BACK sitting on top of the trigger — a mis-tap that costs the run,
       on the one screen where it costs the most. The rail keeps the bottom
       strip; the gun owns the right column above it. */
    touchBtns.push(micro.touch.addButton({
      id: "wgpFire", glyph: "◉", size: 82, right: 18, bottom: 168,
      onDown: function () { if (CBZ.fpsFire) CBZ.fpsFire(true); },
      onUp: function () { if (CBZ.fpsFire) CBZ.fpsFire(false); },
    }));
    touchBtns.push(micro.touch.addButton({
      id: "wgpAim", glyph: "◎", size: 58, right: 112, bottom: 236, latch: true,
      onDown: function (h) { if (CBZ.fpsSetAim) CBZ.fpsSetAim(h.lit); },
    }));
    touchBtns.push(micro.touch.addButton({
      id: "wgpReload", glyph: "↻", size: 54, right: 112, bottom: 168,
      onDown: function () { if (CBZ.fpsReload) CBZ.fpsReload(); },
    }));
    touchBtns.push(micro.touch.addButton({
      id: "wgpSwap", glyph: "⇄", size: 54, right: 112, bottom: 96,
      onDown: function () { if (CBZ.fpsNextWeapon) CBZ.fpsNextWeapon(); },
    }));
    /* TAKE THE GUN OFF THE SAND, and it is a WORD, not an icon. Every other
       control here is a verb the player already knows (fire, aim, reload,
       swap) and an icon is enough; this one has to say WHICH GUN, because the
       whole decision is whether the thing at your feet beats the thing in your
       hands. microboot's own `word:true` pill is exactly that shape, and it
       sizes itself to the label — so the button IS the prompt on a phone and
       battle.js's #wbPick line is hidden there rather than printed twice.

       IT IS THE ONLY CONTEXTUAL CONTROL IN THE CLUSTER: hidden until battle.js
       says something is in reach (showPick below), so the thumb column does
       not carry a button that does nothing for most of a fight. It sits ABOVE
       the trigger rather than under SWAP because the first capture put it at
       the bottom of the column, behind battle.js's order rail, where it was
       half a circle nobody could hit.

       AND IT CARRIES NO onDown. `key` makes microboot synthesise KeyE into its
       own input map, which is the exact thing battle.js's stepPickup() polls —
       so the phone and the keyboard are one code path rather than two. */
    touchBtns.push(micro.touch.addButton({
      id: "wgpPick", word: true, glyph: "TAKE", size: 44, right: 18, bottom: 306, key: "KeyE",
    }));
    touchBtns.push(micro.touch.addButton({
      id: "wgpView", glyph: "▣", size: 48, right: 22, top: 74,
      onDown: function () { cycleCam(); },
    }));
    syncTouchVisible();
  }
  function syncTouchVisible() {
    const show = camMode !== "cmd";
    for (let i = 0; i < touchBtns.length; i++) {
      const b = touchBtns[i];
      if (!b || !b.el) continue;
      if (b.id === "wgpView") continue;              // the seat toggle is always reachable
      // the reach button is CONTEXTUAL — the seat can only take it away, never
      // hand it back. Its own condition is whether a rifle is at your feet.
      if (b.id === "wgpPick") { b.set(show && pickOn, null, pickLbl || "TAKE"); continue; }
      b.set(show);
    }
  }
  /* WHAT battle.js SAYS THROUGH. It owns the reach test (it owns the dropped
     rifles); this file owns the thumb column. One boolean crosses. */
  let pickOn = false, pickLbl = "";
  function showPick(on, label) {
    on = !!on;
    label = label || "";
    if (on === pickOn && label === pickLbl) return;
    pickOn = on; pickLbl = label;
    syncTouchVisible();
  }
  function clearTouch() {
    for (let i = 0; i < touchBtns.length; i++) {
      const b = touchBtns[i];
      if (b && b.el && b.el.parentNode) b.el.parentNode.removeChild(b.el);
      if (micro.touch && micro.touch.buttons) {
        const k = micro.touch.buttons.indexOf(b);
        if (k >= 0) micro.touch.buttons.splice(k, 1);
      }
    }
    touchBtns = [];
  }

  /* ============================================================ THE READOUT
     WHAT GOES IN battle.js's CORNER PANEL, and it is deliberately different on
     the two sides of the flag because the two builds have different things to
     say. With the engine mounted, fpsmode's own big #ammo readout — the
     tabular "24 / 30  RES 60" under the weapon's name that the jail and gun
     game use — is already on screen, so the panel keeps only what is the
     WARLORD's rather than the gun's: which gun and how many he has killed.
     (The first capture after the mount printed the same magazine twice, eight
     inches apart, in two different fonts.) On the legacy side there is no
     #ammo readout at all, because there is no fpsmode — so the panel prints
     the fork's own line, magazine and all, exactly as it always did. A before
     side missing a readout it actually had would be a lie about the before. */
  function tally() {
    if (legacy) return legacyAmmo();
    const gun = (CBZ.currentGun && CBZ.currentGun() && CBZ.currentGun().label) ||
      W.gunLabel(W.state.you.wid);
    return gun.toUpperCase() + "   " + (A ? A.you.kills : 0) + " KILLS";
  }

  function unmount() {
    if (!on) { A = null; return; }
    on = false;
    if (CBZ.always) {
      for (let i = CBZ.always.length - 1; i >= 0; i--) {
        const f = CBZ.always[i].fn;
        if (f === alwaysFn || f === ledgerFn) CBZ.always.splice(i, 1);
      }
    }
    alwaysFn = null; ledgerFn = null;
    pickOn = false; pickLbl = "";
    clearTouch();
    if (CBZ.fpsSetActive) safe(function () { CBZ.fpsSetActive(false); });
    if (CBZ.fpsSetAim) CBZ.fpsSetAim(false);
    if (CBZ.fpsFire) safe(function () { CBZ.fpsFire(false); });
    // the lens goes back the way it was found — the campaign rides at micro's own
    if (CBZ.camera && baseFov) { CBZ.camera.fov = baseFov; CBZ.camera.updateProjectionMatrix(); }
    if (CBZ._wlPrevAiKill !== undefined) { CBZ.aiKill = CBZ._wlPrevAiKill || undefined; CBZ._wlPrevAiKill = undefined; }
    if (CBZ._wlPrevKnockback !== undefined) { CBZ.knockback = CBZ._wlPrevKnockback || undefined; CBZ._wlPrevKnockback = undefined; }
    if (CBZ._wlPrevHasWeapon !== undefined) { CBZ.hasWeapon = CBZ._wlPrevHasWeapon || undefined; CBZ._wlPrevHasWeapon = undefined; }
    enemies.length = 0;
    lastRounds = -1;
    stats.shots = stats.hits = stats.kills = stats.damage = 0;
    stats.firstShotT = stats.lastKillT = -1; stats.t = 0;
    CBZ.losBlockers = [];
    legacyUnmount();
    const hud = document.getElementById("wgpHud");
    if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
    const cr = document.getElementById("crosshair");
    if (cr) cr.style.display = "none";
    const am = document.getElementById("ammo");
    if (am) am.style.display = "none";
    spaceHeld = false; mouseHeld = false; wasDead = false;
    A = null;
  }

  /* ============================================================ THE AUDIT
     Every number a tool or a person might want to gate on, including the one
     that answers "is this actually the engine's gun or the fork's". */
  function audit() {
    const f = CBZ.fps || {};
    return {
      mounted: on, engine: on && !legacy, legacy: legacy, loaded: loaded,
      cam: camMode, active: !!(CBZ.fpsActive && CBZ.fpsActive()),
      ads: !!(CBZ.isADS && CBZ.isADS()),
      armed: !!(CBZ.playerArmed && CBZ.playerArmed()),
      gun: CBZ.currentWeaponId || null,
      owned: ownedIds(),
      reach: pickOn,                 // is a rifle at the warlord's feet right now
      mag: legacy && L ? L.mag : f.ammo,
      magSize: legacy && L ? L.magSize : f.mag,
      /* THE FORK HAS NO RESERVE AT ALL — it reloads out of thin air forever,
         which is one of the things this comparison is for. */
      reserve: legacy ? null : f.reserve,
      reloading: legacy && L ? L.reloadT : f.reloading,
      targets: enemies.length, blockers: (CBZ.losBlockers || []).length,
      reticle: (CBZ.fpsReticleState && CBZ.fpsReticleState()) || null,
      lock: !!(CBZ.aimLockTarget && CBZ.aimLockTarget()),
      files: { fpsmode: !!CBZ.fpsFire, gunhands: !!CBZ.gunReloadPose, lockon: !!CBZ.lockonFireTarget },
      aim: { x: _dir.x, y: _dir.y, z: _dir.z },
      shots: stats.shots, hits: stats.hits, kills: stats.kills,
      damage: Math.round(stats.damage),
      accuracy: stats.shots ? Math.round(stats.hits / stats.shots * 100) / 100 : 0,
      ttk: (stats.firstShotT >= 0 && stats.lastKillT >= 0)
        ? Math.round((stats.lastKillT - stats.firstShotT) * 100) / 100 : null,
    };
  }

  /* ============================================================ THE CART CHANGED
     WHAT HAPPENS WHEN A GUN ARRIVES MID-FIGHT.

     battle.js's stepPickup() takes a rifle off the sand and routes it through
     core's W.equip, so by the time this is called `W.state.you.wid` is already
     the new gun and the old one is already in the baggage. Nothing here owns
     an inventory rule; this is the four lines fpsmode needs to notice.

     AND IT DELIBERATELY DOES NOT CALL fpsResetWeapons. That refills EVERY
     magazine in the catalog, which would make walking over a pistol a free
     reload for the rifle you are holding. The only magazine topped up is the
     one that just came off a body — because it did come off a body, loaded.

     CBZ.hasWeapon already answers off W.state live (see the mount), so
     fpsmode's availableIndices() picks the new gun up with nothing told to
     it — which is why this is short. */
  function canHold(id) {
    if (!id) return false;
    if (legacy) return true;                       // the fork holds a wid, not a row
    const L2 = CBZ.FPS_WEAPONS;
    if (!L2) return false;
    for (let i = 0; i < L2.length; i++) if ((L2[i].id || L2[i].key) === id) return true;
    return false;
  }
  function rearm(id) {
    if (!on) return false;
    if (legacy) { if (L) L.mag = L.magSize; return true; }
    const f = CBZ.fps, L2 = CBZ.FPS_WEAPONS;
    CBZ.weaponInventory = ownedIds();
    if (f && f.rounds && L2) {
      for (let i = 0; i < L2.length; i++) {
        if ((L2[i].id || L2[i].key) !== id) continue;
        f.rounds[i] = Math.max(f.rounds[i] || 0, L2[i].mag || 0);
        break;
      }
    }
    setReserves();
    if (id && CBZ.fpsSelectWeaponId) safe(function () { CBZ.fpsSelectWeaponId(id); });
    CBZ.currentWeaponId = W.state.you.wid;
    if (CBZ.fpsResyncAmmo) safe(CBZ.fpsResyncAmmo);
    return true;
  }

  /* ============================================================ DRIVE SEAM
     What a headless tool needs to actually pull the trigger, since a synthetic
     mouse event cannot enter pointer lock. Same two verbs a person has. */
  function fire(down) { if (CBZ.fpsFire) CBZ.fpsFire(!!down); }
  function pull() { if (CBZ.fpsFire) CBZ.fpsFire(); }
  function aim(onOff) { if (CBZ.fpsSetAim) CBZ.fpsSetAim(!!onOff); }
  function reload() { if (CBZ.fpsReload) CBZ.fpsReload(); }
  function nextGun() { if (CBZ.fpsNextWeapon) CBZ.fpsNextWeapon(); }
  function look(o) {
    o = o || {};
    if (o.yaw != null) CBZ.cam.yaw = o.yaw + Math.PI;
    if (o.pitch != null) {
      if (camMode === "third") CBZ.cam.pitch = -o.pitch;
      else if (CBZ.fps) CBZ.fps.fp = o.pitch;
    }
    /* AIM AT A POINT — and iterate, because in the shoulder seat the answer
       moves the question: the bearing is measured from the LENS, and changing
       the bearing moves the lens (it hangs off the aim direction). Three
       passes takes a 25 m shot from about three degrees off to under a tenth. */
    if (o.at) {
      for (let k = 0; k < 3; k++) {
        const c = CBZ.camera.position;
        const dx = o.at.x - c.x, dy = o.at.y - c.y, dz = o.at.z - c.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const yaw = Math.atan2(dx, dz), pitch = Math.asin(clamp(dy / d, -1, 1));
        CBZ.cam.yaw = yaw + Math.PI;
        if (camMode === "third") CBZ.cam.pitch = -pitch;
        else if (CBZ.fps) CBZ.fps.fp = pitch;
        if (A) { A.you.yaw = yaw; A.you.pitch = pitch; }
        if (!A || !A.live() || legacy) break;
        safe(function () { placeCamera(0.016); });
      }
    }
    if (A && A.live() && !legacy) safe(function () { placeCamera(0.016); });
    return { yaw: CBZ.cam.yaw - Math.PI, pitch: camMode === "third" ? -CBZ.cam.pitch : (CBZ.fps ? CBZ.fps.fp : 0) };
  }
  /* ZERO THE LEDGER. A storyboard is seven beats in ONE page, so a ledger that
     only ever accumulates makes "time to kill" the time since the FIRST round
     of the session — which climbs all afternoon and photographs as a
     regression on every subject after the first. Called between beats so
     rounds/hits/kills/ttk mean this beat and nothing else. Drive-only. */
  function resetLedger() {
    stats.shots = stats.hits = stats.kills = stats.damage = 0;
    stats.firstShotT = stats.lastKillT = -1;
    return true;
  }

  /* THE STUDIO'S OWN NO-DEATH. A storyboard about a GUN cannot also be a
     storyboard about the warlord dying: he is staged thirty metres in front of
     his own line facing a whole militia, and the first run of
     tools/visual-presets/warlord-gunplay.mjs lost him — and with him the
     battle, the teardown and the last four subjects on both sides. Drive-only;
     nothing in the game calls it. */
  function heal() {
    if (!A) return null;
    A.you.hp = A.you.maxHp;
    if (CBZ.player) CBZ.player.dead = false;
    wasDead = false;
    return A.you.hp;
  }

  /* PUT THE WARLORD SOMEWHERE, in world coordinates, sitting on the sand. The
     drive seam's other half: a preset that wants both builds photographed from
     the same piece of ground cannot ask the player to walk there. Works in the
     legacy path too — it moves the actor, which is the one thing both
     controllers agree about. */
  function place(o) {
    if (!A || !o) return null;
    const p = A.you.pos;
    if (o.x != null) p.x = o.x;
    if (o.z != null) p.z = o.z;
    p.y = A.groundAt(p.x, p.z);
    if (A.youRig) A.youRig.position.copy(p);
    // the legacy path installs no shims (it needs none), so CBZ.player may not
    // exist at all — the drive seam has to work on both sides of the flag
    if (CBZ.player) CBZ.player.pos = p;
    if (!legacy) safe(function () { placeCamera(0.016); });
    else if (L) safe(function () { legacyCamera(0.016); });
    return { x: p.x, y: p.y, z: p.z };
  }

  /* The nearest live enemy in front of the warlord — the thing a preset means
     by "shoot at the enemy line" without hard-coding a coordinate. */
  function nearestEnemy() {
    if (!A) return null;
    refreshEnemies(true);
    let best = null, bd = 1e9;
    const p = A.you.pos;
    for (let i = 0; i < enemies.length; i++) {
      const m = enemies[i];
      const d = Math.hypot(m.pos.x - p.x, m.pos.z - p.z);
      if (d < bd) { bd = d; best = m; }
    }
    /* PLAIN NUMBERS ONLY — a preset JSON-stringifies this, and a warlord man
       holds a reference to his side which holds the roster which holds him. */
    return best ? { x: best.pos.x, y: best.pos.y + (best.aimY || 1.28), z: best.pos.z,
                    d: bd, hp: best.hp, id: best.id } : null;
  }

  /* ============================================================================
     ============================================================================
     THE LEGACY CONTROLLER — ?gunplay=old

     THIS IS THE FORK, MOVED HERE UNCHANGED. It is battle.js's old hand-rolled
     player: its own aim, its own cone magnet, its own trigger, its own ammo,
     its own viewmodel pose and its own two camera seats. It is kept for exactly
     one reason — repo doctrine says a behaviour change ships with a one-param
     revert so the two can be photographed against each other, and
     tools/visual-presets/warlord-gunplay.mjs IS that photograph.

     It is in THIS file rather than in battle.js so that battle.js is clean and
     so that the day this comparison stops being interesting, the whole fork
     comes out in one delete.

     Nothing below is called unless ?gunplay=old is on the URL.
     ============================================================================
     ============================================================================ */
  let L = null;
  function legacyMount() {
    const you = A.you;
    const w = CBZ.weaponById ? CBZ.weaponById(you.wid) : null;
    L = {
      mag: w ? (w.magSize || w.mag || 17) : 17,
      magSize: w ? (w.magSize || w.mag || 17) : 17,
      reloadT: 0, cool: 0, touchFire: false, viewGun: null,
      ray: { o: new THREE.Vector3(), d: new THREE.Vector3() },
      v: new THREE.Vector3(), muz: new THREE.Vector3(),
      btn: null,
    };
    legacyBuildViewGun();
    legacyBuildFireButton();
    alwaysFn = function (dt) { if (on && legacy) legacyDrive(dt || 0); };
    CBZ.onAlways(51.5, alwaysFn);
  }
  function legacyUnmount() {
    if (!L) return;
    if (L.viewGun) {
      if (L.viewGun.parent) L.viewGun.parent.remove(L.viewGun);
      safe(function () { CBZ.studio.drop(L.viewGun); });
    }
    if (L.btn && L.btn.parentNode) L.btn.parentNode.removeChild(L.btn);
    if (L.cross && L.cross.parentNode) L.cross.parentNode.removeChild(L.cross);
    const css = document.getElementById("wgpOldCss");
    if (css && css.parentNode) css.parentNode.removeChild(css);
    L = null;
  }
  function legacyAmmo() {
    if (!L) return "";
    return L.reloadT > 0 ? "RELOADING"
      : L.mag + " / " + L.magSize + "   " + W.gunLabel(W.state.you.wid) + "   " + A.you.kills + " KILLS";
  }
  function legacySetCam(m) {
    camMode = m;
    if (A && A.live()) safe(function () { legacyCamera(0.016); });
    return camMode;
  }
  function legacyBuildFireButton() {
    if (!A.coarse) return;
    const css = document.createElement("style");
    css.id = "wgpOldCss";
    css.textContent =
      "#wgpOldFire{position:fixed;right:calc(var(--wl-safe-r, env(safe-area-inset-right,0px)) + 20px);" +
      "bottom:calc(var(--wl-safe-b, env(safe-area-inset-bottom,0px)) + 130px);width:86px;height:86px;border-radius:50%;" +
      "background:rgba(196,69,58,.42);border:2px solid rgba(255,255,255,.28);z-index:47;" +
      "pointer-events:auto;display:flex;align-items:center;justify-content:center;" +
      "font:800 13px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.1em;color:#f4ecd8}" +
      "#wgpOldCross{position:fixed;left:50%;top:50%;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;" +
      "border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 0 0 1px rgba(0,0,0,.6);z-index:46;pointer-events:none}";
    document.head.appendChild(css);
    const b = document.createElement("div");
    b.id = "wgpOldFire"; b.textContent = "FIRE";
    document.body.appendChild(b);
    b.addEventListener("pointerdown", function (e) { e.stopPropagation(); L.touchFire = true; });
    b.addEventListener("pointerup", function () { L.touchFire = false; });
    b.addEventListener("pointercancel", function () { L.touchFire = false; });
    L.btn = b;
    const cr = document.createElement("div");
    cr.id = "wgpOldCross";
    document.body.appendChild(cr);
    L.cross = cr;
  }
  function legacyBuildViewGun() {
    if (!CBZ.buildActorWeapon) return;
    let g = safe(function () { return CBZ.buildActorWeapon(W.state.you.wid); });
    if (!g) return;
    const VIEW_LEN = 0.27;
    const box = new THREE.Box3().setFromObject(g);
    const sz = new THREE.Vector3(); box.getSize(sz);
    const longest = Math.max(sz.x, sz.y, sz.z) || 1;
    g.rotation.set(0, 0, 0);
    if (sz.x >= sz.y && sz.x >= sz.z) g.rotation.y = Math.PI / 2;
    else if (sz.y > sz.z) g.rotation.x = -Math.PI / 2;
    g.scale.multiplyScalar(VIEW_LEN / longest);
    const holder = new THREE.Group();
    holder.add(g);
    holder.updateMatrixWorld(true);
    const mid = new THREE.Vector3();
    new THREE.Box3().setFromObject(g).getCenter(mid);
    g.position.sub(mid);
    holder.position.set(0.23, -0.20, -0.68);
    holder.rotation.set(-0.07, 0.06, 0);
    L.viewGun = holder;
    CBZ.camera.add(holder);
    if (!CBZ.camera.parent) CBZ.scene.add(CBZ.camera);
  }
  function legacyDrive(dt) {
    if (!A || !A.live() || !L) return;
    const you = A.you, IN = micro.input, T = micro.touch;
    if (you.dead) return;
    stats.t += dt;
    if (L.reloadT > 0) { L.reloadT -= dt; if (L.reloadT <= 0) L.mag = L.magSize; }
    if (L.cool > 0) L.cool -= dt;
    if (IN && (camMode === "fps" || camMode === "third")) {
      you.yaw -= IN.mx * (IN.sensitivity || 0.0022);
      you.pitch = clamp(you.pitch - IN.mz * (IN.sensitivity || 0.0022), -1.2, 1.2);
    }
    if (camMode === "cmd") { you.speed = 0; return; }
    let mx = IN ? IN.axis("KeyA", "KeyD") : 0, mz = IN ? IN.axis("KeyS", "KeyW") : 0;
    if (T && T.active && T.stick.mag > 0.05) { mx = T.stick.x; mz = -T.stick.y; }
    const sprint = (IN && IN.isDown("ShiftLeft")) || (T && T.stick.rim);
    const base = (sprint ? 7.4 : 4.8) * (1 - W.armour(W.state.you.armour).slow);
    const len = Math.hypot(mx, mz);
    if (len > 0.01) {
      const s = base / Math.max(1, len);
      const sy = Math.sin(you.yaw), cy = Math.cos(you.yaw);
      you.pos.x += (sy * mz + cy * mx) * s * dt;
      you.pos.z += (cy * mz - sy * mx) * s * dt;
      micro.resolveCircle(you.pos, 0.45, you.pos.y, 1.8);
      you.speed = base * Math.min(1, len);
    } else you.speed = 0;
    you.pos.y = A.groundAt(you.pos.x, you.pos.z);
    if (A.youRig) A.youRig.rotation.y = you.yaw;
    const firing = (IN && (IN.buttons[0] || IN.isDown("Space"))) || L.touchFire;
    if (firing && L.cool <= 0 && L.reloadT <= 0) legacyShoot();
    if (IN && IN.pressed("KeyR") && L.mag < L.magSize) legacyReload();
    if (L.mag <= 0 && L.reloadT <= 0) legacyReload();
    legacyCamera(dt);
  }
  function legacyReload() {
    const w = CBZ.weaponById(W.state.you.wid);
    L.reloadT = (w && (w.reloadTime || w.reload)) || 1.4;
  }
  function legacyShoot() {
    const you = A.you;
    const w = CBZ.weaponById(you.wid) || {};
    L.cool = w.fireDelay || w.interval || 0.2;
    L.mag--;
    /* THE LEDGER COUNTS BOTH SIDES OF THE A/B, or the comparison has one
       column. Same three numbers, same meaning, counted at the same two
       moments: a round leaving, and a round landing. */
    stats.shots++;
    if (stats.firstShotT < 0) stats.firstShotT = stats.t;
    A.shot();
    const cam = CBZ.camera;
    L.ray.o.copy(cam.position);
    cam.getWorldDirection(L.ray.d);
    const cone = Math.cos((A.coarse ? 5 : 2.2) * Math.PI / 180);
    const range = w.range || 80;
    const men = A.men();
    let best = null, bestD = 1e9;
    for (let i = 0; i < men.length; i++) {
      const o = men[i];
      if (o.dead || o.fled || o.team === "mine") continue;
      const ox = o.pos.x - L.ray.o.x, oy = (o.pos.y + o.aimY) - L.ray.o.y, oz = o.pos.z - L.ray.o.z;
      const d = Math.hypot(ox, oy, oz);
      if (d > range || d < 0.5) continue;
      const dot = (ox * L.ray.d.x + oy * L.ray.d.y + oz * L.ray.d.z) / d;
      if (dot < cone) continue;
      if (d < bestD) { bestD = d; best = o; }
    }
    let hitPoint = null;
    if (best) {
      const ay = L.ray.o.y, by = best.pos.y + best.aimY;
      if (A.blocked(L.ray.o.x, ay, L.ray.o.z, best.pos.x, by, best.pos.z)) best = null;
    }
    if (best) hitPoint = L.v.set(best.pos.x, best.pos.y + best.aimY, best.pos.z);
    else {
      hitPoint = L.v.copy(L.ray.o).addScaledVector(L.ray.d, range);
      const g = A.groundAt(hitPoint.x, hitPoint.z);
      if (hitPoint.y < g) hitPoint.y = g;
    }
    const from = L.muz.copy(cam.position).addScaledVector(L.ray.d, 0.9);
    from.y -= 0.12;
    CBZ.tracer(from, hitPoint, { shooter: you, targetActor: best || null, muzzle: true,
      muzzleScale: (w.flash ? 0.5 + w.flash : 0.9) });
    if (w.sfx) safe(function () { CBZ.sfx(w.sfx, { dist: 2, volume: (w.sfxVol || 1) * 0.55, pitch: w.sfxPitch || 1 }); });
    CBZ.shake && CBZ.shake(Math.min(0.6, (w.shake || 0.3) * 0.5));
    if (best) {
      A.hitCount();
      stats.hits++;
      const hp0 = best.hp;
      A.legacyHurt(best, (w.damage || 24) * (w.pellets || 1) * 0.55);
      stats.damage += Math.max(0, hp0 - best.hp);
      if (best.dead) { stats.kills++; stats.lastKillT = stats.t; }
      if (CBZ.bodyWound) safe(function () { CBZ.bodyWound(best, hitPoint, {}); });
    } else CBZ.bulletImpact(hitPoint, { x: 0, y: 1, z: 0 }, { kind: "dust", power: 0.7 });
    if (best && CBZ.combatIQ && CBZ.combatIQ.suppress) CBZ.combatIQ.suppress(best, 1.1);
  }
  function legacyCamera(dt) {
    const c = CBZ.camera, you = A.you;
    /* THE LENS ANGLE, AND ONLY THE HALF NOBODY ELSE OWNS. fpsmode already
       eases the FIRST-PERSON fov itself (75 hip, 50 on ADS) and its own
       comment names the bug for touching it from outside: "two writers racing
       toward the same target with different smoothing states produced the ADS
       FLICKER". The first draft of this file did exactly that and the lens
       settled at 73.5 hip / 51.9 ADS instead of 75 / 50 — measured, and the
       reason this block is now four lines instead of twelve. So first person
       is fpsmode's outright; the SHOULDER is nobody's here (systems/camera.js
       owns it in the city and is not mounted), so it is taken with camera.js's
       own armed-chase number and the same 14-degree ADS punch. */
    if (camMode === "third") {
      const scopeF = (CBZ.fpsScopeFov && CBZ.fpsScopeFov()) || 0;
      const wantFov = scopeF || ((CBZ.isADS && CBZ.isADS()) ? 66 - 14 : 66);
      const c0 = CBZ.camera;
      if (Math.abs(c0.fov - wantFov) > 0.05) {
        c0.fov += (wantFov - c0.fov) * Math.min(1, dt * 12);
        c0.updateProjectionMatrix();
      }
    }

    const eye = you.pos.y + (you.eyeH || 1.62);
    const dir = new THREE.Vector3(Math.sin(you.yaw) * Math.cos(you.pitch), Math.sin(you.pitch),
      Math.cos(you.yaw) * Math.cos(you.pitch));
    if (camMode === "fps") {
      c.position.set(you.pos.x, eye, you.pos.z);
      c.lookAt(you.pos.x + dir.x, eye + dir.y, you.pos.z + dir.z);
      if (A.youRig) A.youRig.visible = false;
      if (L.viewGun) L.viewGun.visible = true;
    } else {
      const back = 5.4, up = 1.35, side = 1.05;
      const rx = Math.cos(you.yaw), rz = -Math.sin(you.yaw);
      let px = you.pos.x - dir.x * back + rx * side;
      let pz = you.pos.z - dir.z * back + rz * side;
      let py = eye + up - dir.y * back;
      const g = A.groundAt(px, pz) + 1.2;
      if (py < g) py = g;
      c.position.set(px, py, pz);
      c.lookAt(you.pos.x + dir.x * 14 + rx * side, eye + dir.y * 14, you.pos.z + dir.z * 14 + rz * side);
      if (A.youRig) A.youRig.visible = true;
      if (L.viewGun) L.viewGun.visible = false;
    }
    if (L.cross) L.cross.style.display = camMode === "fps" ? "block" : "none";
  }
  /* legacy look, so the preset can point both sides at the same man */
  function legacyLook(o) {
    if (!A || !L) return null;
    o = o || {};
    if (o.at) {
      const c = CBZ.camera.position;
      const dx = o.at.x - c.x, dy = o.at.y - c.y, dz = o.at.z - c.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      A.you.yaw = Math.atan2(dx, dz);
      A.you.pitch = Math.asin(clamp(dy / d, -1, 1));
    } else {
      if (o.yaw != null) A.you.yaw = o.yaw;
      if (o.pitch != null) A.you.pitch = o.pitch;
    }
    legacyCamera(0.016);
    return { yaw: A.you.yaw, pitch: A.you.pitch };
  }

  /* ============================================================ */
  W.gunplay = {
    ensure: ensure,
    mount: mount,
    unmount: unmount,
    camera: setCam,
    cycleCam: cycleCam,
    mode: mode,
    tally: tally,
    audit: audit,
    on: function () { return on; },
    engine: function () { return on && !legacy; },
    // the drive seam (a headless tool, and the visual preset)
    fire: function (d) { return legacy ? legacyFire(d) : fire(d); },
    pull: function () { return legacy ? legacyFire(true) : pull(); },
    aim: aim,
    reload: function () { return legacy ? legacyReload() : reload(); },
    nextGun: nextGun,
    look: function (o) { return legacy ? legacyLook(o) : look(o); },
    nearestEnemy: nearestEnemy,
    // the battlefield floor (battle.js owns the reach; this file owns the hands)
    canHold: canHold,
    rearm: rearm,
    showPick: showPick,
    place: place,
    heal: heal,
    resetLedger: resetLedger,
  };
  function legacyFire(d) { if (L) L.touchFire = !!d; }

  G.__warlordGunplay = W.gunplay;
})();
