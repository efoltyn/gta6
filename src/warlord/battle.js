/* ============================================================
   warlord/battle.js — THE ACTUAL WAR.

   THE DONOR IS games/battle.html AND THE REUSE IS THE POINT. That page is a
   working NPC war simulator — a thousand men, real guns, combat_iq brains,
   cover, suppression, flanking arcs, ragdoll corpses, dropped rifles — and
   this file is that machine with two things added and one thing removed:

     ADDED   YOU. A warlord standing in his own firing line, with his own
             rifle, who can be shot. That is the whole reason the campaign
             exists and it is the one thing a spectator page cannot have.
     ADDED   MORALE. battle.html's armies fight to the last man because a
             spectator wants to watch the whole thing. A COMMANDER needs the
             opposite: an army that BREAKS, because breaking is the only
             mechanic that makes fifteen veterans beat forty levies, and that
             is the entire reason "who gets the good rifle" is a decision.
     REMOVED the war room, the benchmark, the bestiary, the air war and the
             nine venues. This battle has one venue — the piece of the real
             island the encounter happened on — and one roster: yours.

   THE MEN ARE REAL SOLDIERS. Every body on the sand is a soldier object out of
   W.state.army or band.men, carrying that man's own `wid` and `armour`, and
   when he dies THAT OBJECT dies. It is the same reference the aftermath screen
   prints a name off and the same reference the campaign will not see again.
   This is the whole reason core.js insists a band carries a real roster.

   WHAT IS ENGINE AND WHAT IS THIS FILE, stated so the claim is checkable:
     bodies          CBZ.studio.cast          (entities/character.js's rig)
     guns in hands   CBZ.syncActorWeapon      (systems/actorweapons.js)
     how they fight  CBZ.combatIQ.posture/shot/slot/suppress/cover
     rounds drawn    CBZ.tracer/muzzleFlash/bulletImpact  (systems/gunfx.js)
     wounds          CBZ.bodyWound            (systems/wounds.js)
     the dead        CBZ.deathPose + CBZ.cityRagdoll      (city/ragdoll.js)
     dropped rifles  CBZ.weaponPhysics.drop   (systems/actorweapons.js)
     the ground      W.desert.battlefieldAt() (warlord/desert.js)
   Nothing above is reimplemented here. What IS this file: who is on which
   side, morale, the four orders, the player, the cameras, and the report.

   WHERE THE DONOR IS WRONG AND THIS FILE DOES IT DIFFERENTLY (CLAUDE.md: the
   codebase is not a bible) — each is commented at its site:
     · battle.html multiplies every landed round by 1.45 with the note "combat_
       iq's ladder is authored for fights against the PLAYER, whose fairness cap
       this page has no player to need". THIS page has a player. So the 1.45
       applies man-on-man and NOT to rounds aimed at you — see hurtMan.
     · its `hunt` mop-up phase (three to one, everyone sprints) is a spectator
       fix for dead air. Here the same job is done honestly by morale: at three
       to one the losing side is already routing and the battle ENDS.
     · its corpse budget is 420 for a camera flying over a thousand men. A
       campaign battle is tens to low hundreds and the camera is usually a man
       standing in it, so the budget is smaller and the sink is nearer.

   FLAGS (repo doctrine — every behaviour switch reverts in one param)
     ?morale=old   no morale, no rout: both armies fight to the last man,
                   which is exactly what battle.html does. The A/B.
     ?orders=old   the four order buttons do nothing; everyone holds. The
                   revert for the command layer.
     ?tlos=0       the dunes stop blocking sight lines
     ?men=N        per-side fielding cap (default 300 — see MEN_CAP)
     ?battle=1     debug: drop straight into a test battle at boot
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});

  let THREE = null, ctx = null, Q = null;
  const clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

  /* ============================================================ BUDGETS
     THE CAP EXISTS AND IT IS STATED ON SCREEN. battle.html has no cap because
     it is a benchmark — you type a number and the frame rate tells you the
     truth. A campaign cannot do that: a legion of 900 has to be survivable on
     a phone, and a page that locks up is a run that ends. So a side fields at
     most MEN_CAP; the men over the line stay with the baggage, take no part,
     and SURVIVE — they are still on the roster afterwards, which is the only
     honest way to cap a real army. ?men=N overrides it in both directions.

     300 is battle.html's own measured neighbourhood (its saved
     `cbz-npcwar-max` is per side at 30 fps on the machine that ran it) and it
     is the number the brief asks to hold: 300 v 300 must run. */
  const MEN_CAP_DEFAULT = 300;
  const FIELD_R = 170;             // the battlefield is ~340 m across
  const CORPSE_MAX = 260;          // see the header: a smaller field, a nearer camera
  const SIGHT = 175;
  const GRID_CELL = 14;

  /* THE STRING BOTH CONSUMERS READ. actorweapons.js resolves the appearance
     model off a weapon id, and combat_iq.js classifies the competence column
     off actor.weapon as a NAME. battle.html carries the same table for the
     same reason: they are two different readers of one field, and a rifle that
     reads as "carbine" to one and "pistol" to the other is a man who holds an
     M4 and shoots like a clerk. Keyed by weapon-data's own ids, so a gun added
     to the armoury lands on the fall-through rather than silently misreading. */
  const GUN_NAME = {
    sidearm: "Pistol", shotgun: "Shotgun", carbine: "Carbine", smg: "SMG",
    revolver: "Revolver", deagle: "Desert Eagle", ak47: "AK-47", uzi: "Uzi",
    sniper: "Sniper", lmg: "LMG", taser: "Taser",
    bazooka: "bazooka", glauncher: "glauncher",
  };
  function gunName(wid) { return GUN_NAME[wid] || W.gunLabel(wid); }

  /* WHAT A TIER LOOKS LIKE. core's TIERS[].cq names the combat_iq ROLE row —
     it is a statement about how the man FIGHTS — and studio.cast's table is a
     wardrobe. They are two different questions and core is right not to answer
     the second one, so the mapping lives here, where the bodies are built. The
     wardrobe follows the competence on purpose: a levy dressed as a soldier is
     a lie the player reads off the screen before he reads the odds card. */
  const CAST_OF = { civ: "civilian", thug: "thug", guard: "guard", soldier: "soldier" };

  /* ============================================================ STATE */
  let live = false;
  let scene = null, micro = null;
  let men = [], corpses = [], sinking = [], dropGuns = [], addedCols = [], addedMeshes = [];
  let YOU = null, youRig = null, viewGun = null;
  let simT = 0, over = false, started = false;
  let hud = null, frameFn = null, capped = { mine: 0, them: 0 };
  let MAP = null, band = null, report = null, startOpts = null;
  let fogSave = null, shadowSave = null;
  let deadSolving = 0;
  let fxBudget = 0;
  let injectDt = 0;                 // the probe's clock — see __warlordBattle
  const SIDES = {};
  const V = function () { return new THREE.Vector3(); };
  let _v = null, _v2 = null, _muz = null;

  // a local seeded stream: the battle must replay identically from a save, and
  // it must not consume the CAMPAIGN's stream (core.js's RND) or every fight
  // would shuffle the island behind it.
  let lcg = function () { return 0.5; };
  function seedBattle(n) {
    let s = (n | 0) || 1;
    lcg = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }

  /* ============================================================ THE GROUND
     ASK desert.js FOR THE REAL ISLAND, and fall back to sand of our own rather
     than be blocked by a file another agent is still writing. The contract is
     `W.desert.battlefieldAt(x, z, radius) -> {groundAt, relief, cover[], raise, clear}`.

     COVER IS REGISTERED AS COLLIDERS HERE regardless of who drew it, because a
     rock that combat_iq cannot see is not cover — its whole cover search is
     CBZ.queryCollidersNear, which the page has shimmed onto microboot's grid.
     Meshes are only built for boxes when desert.js declined to raise anything,
     so we never draw a second copy of a rock it already put there. */
  function buildGround(cx, cz) {
    /* ?ground=own refuses desert.js and fights on this file's own sand. It is
       the revert for "the encounter happens on the real island", and it is
       also the only way to tell whose ground is flat when a battlefield
       photographs as a wash of tan — which is exactly the question the first
       capture raised. */
    const bf = (W.desert && typeof W.desert.battlefieldAt === "function" &&
                !(Q && Q.get("ground") === "own"))
      ? safe(function () { return W.desert.battlefieldAt(cx, cz, FIELD_R); }) : null;

    let groundAt = null, relief = 0, cover = [], raised = false, clearFn = null;
    if (bf && typeof bf.groundAt === "function") {
      groundAt = bf.groundAt;
      relief = bf.relief || 0;
      cover = bf.cover || [];
      clearFn = bf.clear;
      if (typeof bf.raise === "function") raised = safe(function () { bf.raise(); return true; }) === true;
    }

    if (!groundAt) {
      /* OUR OWN SAND. Three sine trains, phases hashed off the campaign seed
         AND the encounter point, so the fight you had at that dune is the same
         dune on a reload — and two different encounters are two different
         places. Wavelengths are dune-scale (110-460 m) so a crest genuinely
         stands between two firing lines rather than rippling under them; the
         relief that comes out measures 16-22 m, which is the window
         battle.html's own dune scan holds out for. */
      const h = function (s) { return W.hash01(cx, cz, (W.state.seed | 0) + s) * Math.PI * 2; };
      const p1 = h(11), p2 = h(29), p3 = h(53);
      groundAt = function (x, z) {
        const a = x - cx, b = z - cz;
        return Math.sin(a * 0.0210 + p1) * 3.6 +
               Math.sin(b * 0.0172 + p2) * 3.1 +
               Math.sin((a + b * 0.7) * 0.0087 + p3) * 5.4;
      };
      cover = fallbackCover(cx, cz, groundAt);
    }

    // MEASURED, not declared: the same number battle.html prints, off the same
    // groundAt the men will stand on, over the window they will fight in.
    if (!relief) {
      let lo = 1e9, hi = -1e9;
      for (let sx = -FIELD_R; sx <= FIELD_R; sx += 12) {
        for (let sz = -FIELD_R; sz <= FIELD_R; sz += 12) {
          const y = groundAt(cx + sx, cz + sz);
          if (y < lo) lo = y; if (y > hi) hi = y;
        }
      }
      relief = Math.round((hi - lo) * 10) / 10;
    }

    // the cover boxes become real colliders — for the bullets, the bodies and
    // combat_iq's cover search alike
    for (let i = 0; i < cover.length; i++) {
      const c = cover[i];
      const y = groundAt(c.x, c.z) + (c.h || 1.4) / 2;
      addedCols.push(micro.addBoxCollider(c.x, y, c.z, c.w || 2, c.h || 1.4, c.d || 2));
      if (!raised) rockMesh(c, groundAt);
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();

    if (!raised) groundMesh(cx, cz, groundAt);

    return {
      cx: cx, cz: cz, groundAt: groundAt, relief: relief, cover: cover,
      // A DUNE IS NOT MADE OF COLLIDERS — battle.html's own finding. A sight
      // line across real sand has to sample the sand, or a man puts rounds
      // through twenty metres of crest. Only armed where the ground genuinely
      // has shape in it; ?tlos=0 makes the sand transparent again.
      terrainLos: relief > 6 && (!Q || Q.get("tlos") !== "0"),
      clear: clearFn,
    };
  }
  function safe(fn) { try { return fn(); } catch (e) { console.warn("[warlord/battle]", e); return null; } }

  /* SCATTER, deterministic and off the spawn lanes. A battlefield with nothing
     on it is a shooting gallery: combat_iq's cover search finds nothing, every
     man stands in the open, and the fight is decided entirely by arithmetic.
     Rocks are what make the same two armies fight differently twice. */
  function fallbackCover(cx, cz, groundAt) {
    const out = [];
    for (let i = 0; i < 34; i++) {
      const a = W.hash01(i, 1, 7) * Math.PI * 2;
      const r = 18 + Math.sqrt(W.hash01(i, 2, 13)) * (FIELD_R - 26);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      // keep the two start lines clear: a boulder inside a forming rank spawns
      // men inside geometry, which battle.html's freeSpot spiral exists to fix
      if (Math.abs(x - cx) > GAP() * 0.5 - 8 && Math.abs(x - cx) < GAP() * 0.5 + 14) continue;
      const tall = W.hash01(i, 3, 17) < 0.55;
      out.push({
        x: x, z: z,
        w: 1.8 + W.hash01(i, 4, 19) * 3.6,
        h: tall ? 1.9 + W.hash01(i, 5, 23) * 0.9 : 1.05 + W.hash01(i, 5, 23) * 0.3,
        d: 1.6 + W.hash01(i, 6, 31) * 3.2,
      });
    }
    return out;
  }
  function rockMesh(c, groundAt) {
    const m = new THREE.Mesh(
      CBZ.boxGeom ? CBZ.boxGeom(c.w, c.h, c.d) : new THREE.BoxGeometry(c.w, c.h, c.d),
      CBZ.cmat ? CBZ.cmat(0x7a6a4c) : new THREE.MeshLambertMaterial({ color: 0x7a6a4c }));
    m.position.set(c.x, groundAt(c.x, c.z) + c.h / 2, c.z);
    m.rotation.y = W.hash01(c.x, c.z, 3) * Math.PI;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    addedMeshes.push(m);
  }
  /* THE SURFACE. One displaced plane over the fight and one flat skirt out to
     the fog. 3 m cells: a man walking a 300 m dune wavelength never rises more
     than a few centimetres between two samples, so the mesh and the analytic
     groundAt the men actually stand on cannot visibly disagree. */
  function groundMesh(cx, cz, groundAt) {
    const span = FIELD_R * 2 + 90, seg = 150;
    const g = new THREE.PlaneGeometry(span, span, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < pos.count; i++) {
      const y = groundAt(pos.getX(i) + cx, pos.getZ(i) + cz);
      pos.setY(i, y);
      if (y < lo) lo = y; if (y > hi) hi = y;
    }
    for (let i = 0; i < pos.count; i++) {
      // the crests catch the sun and the troughs hold the shade — one channel
      // of height, which is what makes a dune field read as dunes in a still
      const t = clamp((pos.getY(i) - lo) / Math.max(0.001, hi - lo), 0, 1);
      col[i * 3] = 0.68 + t * 0.20;
      col[i * 3 + 1] = 0.57 + t * 0.19;
      col[i * 3 + 2] = 0.36 + t * 0.15;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.position.set(cx, 0, cz);
    m.receiveShadow = true;
    m.userData.terrain = true;
    scene.add(m);
    addedMeshes.push(m);

    // the skirt: flat, at the field's floor, so the horizon is ground and not
    // the inside of the sky dome. The battle fog (see start()) eats the seam.
    const sk = new THREE.PlaneGeometry(9000, 9000);
    sk.rotateX(-Math.PI / 2);
    const sm = new THREE.Mesh(sk, new THREE.MeshLambertMaterial({ color: 0xb59a68 }));
    sm.position.set(cx, lo - 0.4, cz);
    sm.receiveShadow = true;
    sm.matrixAutoUpdate = false; sm.updateMatrix();
    sm.userData.terrain = true;
    scene.add(sm);
    addedMeshes.push(sm);
  }

  /* ============================================================ THE FIELD
     THE START LINE. battle.html measured 150 m for open dunes ("resolved in
     32 s") with a camera that WANTED a long approach to photograph. A player
     standing in the line wants contact sooner, and 160 m of open sand closes
     in about thirteen seconds at the two lines' combined march. A surprised
     warlord — a demand for surrender that got laughed at — starts at 95, which
     is inside rifle band on the first step and is the whole cost of asking. */
  function GAP() { return (startOpts && (startOpts.surprised || startOpts.chased)) ? 95 : 160; }

  const _fs = [];
  function blockedAt(x, z) {
    const cols = micro.queryColliders(x, z, 0.9, _fs);
    for (let c = 0; c < cols.length; c++) {
      const b = cols[c];
      if (x < b.minX - 0.55 || x > b.maxX + 0.55) continue;
      if (z < b.minZ - 0.55 || z > b.maxZ + 0.55) continue;
      if (b.y0 != null && b.y1 != null && (b.y1 < 0.35 || b.y0 > 1.7)) continue;
      return true;
    }
    return false;
  }
  // battle.html's spiral, kept whole: the first free point is genuinely the
  // nearest one and it is deterministic, so two men never start inside a rock
  // or inside each other.
  const _claim = [];
  function freeSpot(x, z) {
    const R = 0.575;
    const crowded = function (px, pz) {
      for (let i = 0; i < _claim.length; i++) {
        const c = _claim[i];
        const dx = px - c.x, dz = pz - c.z;
        if (dx * dx + dz * dz < (R * 2) * (R * 2)) return true;
      }
      return false;
    };
    const take = function (px, pz) { _claim.push({ x: px, z: pz }); return { x: px, z: pz }; };
    if (!blockedAt(x, z) && !crowded(x, z)) return take(x, z);
    for (let k = 1; k < 40; k++) {
      const a = k * 2.399963229728653, d = k * 1.35;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!blockedAt(px, pz) && !crowded(px, pz)) return take(px, pz);
    }
    return take(x, z);
  }
  function spawnAt(sideKey, i) {
    const s = SIDES[sideKey];
    const gap = GAP();
    const col = (i / 10) | 0, row = i % 10;
    /* AMBUSHED MEN DO NOT FORM RANKS. A surprised army spawns scattered, which
       is not decoration: a rank is a firing LINE and a scatter is not, so the
       first thirty seconds of a surprised fight are genuinely worse. */
    const jitter = (startOpts && startOpts.surprised && sideKey === "mine") ? 14 : 1.8;
    const x = MAP.cx + s.dir * (gap / 2 + 8 + col * 3.1) + (lcg() - 0.5) * jitter;
    const z = MAP.cz + (row - 4.5) * 3.4 + (col % 2) * 1.7 + (lcg() - 0.5) * jitter;
    return freeSpot(x, z);
  }

  /* ============================================================ THE MEN
     ONE BODY PER SOLDIER OBJECT, and the soldier object is the one the
     campaign owns. `m.s` is that reference and it is the only thing that
     survives this file. */
  function makeMan(sideKey, s, i) {
    const side = SIDES[sideKey];
    const T = W.tier(s.tier);
    const wid = s.wid || "sidearm";
    const w = CBZ.weaponById ? CBZ.weaponById(wid) : null;
    const group = CBZ.studio.cast(CAST_OF[T.cq] || "civilian",
      { color: side.colour, variant: i * 2 + side.vseed });
    if (!group) return null;
    const at = spawnAt(sideKey, i);
    group.position.set(at.x, MAP.groundAt(at.x, at.z), at.z);
    group.rotation.y = side.dir < 0 ? Math.PI / 2 : -Math.PI / 2;
    scene.add(group);

    const m = {
      id: sideKey + i, s: s, side: side, team: sideKey, i: i,
      group: group, char: group.userData.charRig,
      pos: group.position,
      target: V(),
      yaw: group.rotation.y, speed: 0,
      /* THE ARMOUR IS A SOAK, NOT A HEALTH BAR. core states it as flat damage
         removed per hit, which is the only version that makes a plate rig feel
         like a plate rig: it stops a pistol outright and merely blunts a rifle.
         hp stays the tier's own number so a levy in plate is still a levy. */
      hp: s.hp > 0 ? s.hp : T.hp, maxHp: T.hp,
      soak: W.armour(s.armour).soak,
      slow: W.armour(s.armour).slow,
      wounded: !!s.wounded,
      armed: true, weapon: gunName(wid), wid: wid,
      launcher: !!(w && w.explosive),
      mag: w ? (w.magSize || w.mag || 30) : 30,
      magSize: w ? (w.magSize || w.mag || 30) : 30,
      cool: 0.4 + lcg() * 1.2, reloadT: 0,
      tgt: null, losBadT: 0, slot: "hold",
      thinkAt: simT + lcg() * 0.3, lastThink: simT,
      dead: false, dieT: 0, dieDir: 1, animF: (i % 4),
      lastShotT: -9, sq: Math.floor(i / 10), sqSlot: i % 10,
      kills: 0, rad: 0.45, eyeH: 1.52, losY: 1.35, aimY: 1.28, headY: 1.62,
      routed: false, fled: false,
    };
    m.target.set(at.x, 0, at.z);
    /* THE TIER TAGS combat_iq's roleTier() ALREADY READS. core's TIERS[].cq
       names the row, and these are the exact fields battle.html sets — no new
       tag, no fork of the brain's classifier. */
    const cq = T.cq;
    if (cq === "soldier") m.kind = "soldier";
    else if (cq === "guard") m.kind = "guard";
    else if (cq === "thug") m.aggr = 0.92;
    // a wounded man fights at 60%: core's own number, applied where it lands
    if (m.wounded) m.hp = Math.max(1, Math.round(m.hp * 0.6));
    if (CBZ.syncActorWeapon) safe(function () { CBZ.syncActorWeapon(m); });
    (side.squads[m.sq] = side.squads[m.sq] || []).push(m);
    return m;
  }

  /* ============================================================ YOU
     THE WARLORD IS AN ACTOR IN THE SAME ROSTER, deliberately: the grid finds
     him, combat_iq targets him, morale reads whether he is standing. What he
     is NOT is a thing stepMan drives — his goal comes from a thumb. */
  function makeYou() {
    const you = W.state.you;
    const s = SIDES.mine;
    const at = { x: MAP.cx + s.dir * (GAP() / 2 + 4), z: MAP.cz };
    const w = CBZ.weaponById ? CBZ.weaponById(you.wid) : null;
    const rig = CBZ.studio.cast("officer", { color: 0xffb347, variant: 1 });
    if (rig) {
      rig.position.set(at.x, MAP.groundAt(at.x, at.z), at.z);
      scene.add(rig);
    }
    youRig = rig;
    const m = {
      id: "you", isYou: true, s: null, side: s, team: "mine", i: -1,
      group: rig, char: rig ? rig.userData.charRig : null,
      pos: rig ? rig.position : new THREE.Vector3(at.x, MAP.groundAt(at.x, at.z), at.z),
      target: V(), yaw: s.dir < 0 ? Math.PI / 2 : -Math.PI / 2, pitch: 0, speed: 0,
      hp: you.hp, maxHp: you.maxHp, soak: W.armour(you.armour).soak,
      armed: true, weapon: gunName(you.wid), wid: you.wid,
      mag: w ? (w.magSize || w.mag || 17) : 17,
      magSize: w ? (w.magSize || w.mag || 17) : 17,
      reloadT: 0, cool: 0,
      kills: 0, dead: false, rad: 0.45, eyeH: 1.62, losY: 1.4, aimY: 1.3, headY: 1.68,
      routed: false, fled: false, slot: "fire", tgt: null,
      // roleTier: a warlord is a trained man. `swat` is the top row and would
      // read as a tactical unit; `kind:"soldier"` is the honest one.
      kind: "soldier",
    };
    m.target.copy(m.pos);
    /* AND HE CARRIES THE GUN HE IS CARRYING. Without this the third-person
       warlord walked into his own war empty-handed while every levy behind him
       held a rifle — the viewmodel is only ever visible in first person, so the
       hands have to be filled by the same call that fills everybody else's. */
    if (CBZ.syncActorWeapon) safe(function () { CBZ.syncActorWeapon(m); });
    return m;
  }

  /* ============================================================ THE GRID
     Target search over hundreds of men cannot be O(n^2): battle.html's uniform
     grid, queried in rings, ported whole. */
  const grid = new Map();
  let gridAt = -1;
  function gridKey(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  function rebuildGrid() {
    grid.clear();
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (m.dead || m.fled) continue;
      const k = gridKey(Math.floor(m.pos.x / GRID_CELL), Math.floor(m.pos.z / GRID_CELL));
      let a = grid.get(k);
      if (!a) { a = []; grid.set(k, a); }
      a.push(m);
    }
    gridAt = simT;
  }
  const _cand = [];
  function pickTarget(m, range) {
    const cx = Math.floor(m.pos.x / GRID_CELL), cz = Math.floor(m.pos.z / GRID_CELL);
    const maxR = Math.ceil(range / GRID_CELL);
    _cand.length = 0;
    for (let r = 0; r <= maxR; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const a = grid.get(gridKey(cx + dx, cz + dz));
        if (!a) continue;
        for (let i = 0; i < a.length; i++) {
          const o = a[i];
          if (o.team === m.team || o.dead || o.fled) continue;
          const d2 = (o.pos.x - m.pos.x) * (o.pos.x - m.pos.x) + (o.pos.z - m.pos.z) * (o.pos.z - m.pos.z);
          if (d2 < range * range) _cand.push(o, d2);
        }
      }
      if (_cand.length >= 12 && r > 1) break;
    }
    if (!_cand.length) return null;
    let bestO = null, bestD = 1e18;
    for (let i = 0; i < _cand.length; i += 2) if (_cand[i + 1] < bestD) { bestD = _cand[i + 1]; bestO = _cand[i]; }
    let tries = 0;
    while (tries < 4) {
      let o = null, od = 1e18, oi = -1;
      for (let i = 0; i < _cand.length; i += 2) {
        if (_cand[i] && _cand[i + 1] < od) { od = _cand[i + 1]; o = _cand[i]; oi = i; }
      }
      if (!o) break;
      _cand[oi] = null; tries++;
      if (eyeLos(m, o)) return o;
    }
    return bestO;
  }

  /* BODIES. battle.html's second grid, at body scale, because the target grid's
     14 m cell can only ever be wrong about a 0.9 m clearance. Its note is worth
     keeping: one sweep is not a solver, so it sweeps until nothing moves. */
  const FINE = 2.4, SEP = 0.9;
  const fine = new Map();
  const FAN = [[1, 0], [1, 1], [0, 1], [-1, 1]];
  let sepFixed = 0;
  function rebuildFine() {
    fine.clear();
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (m.dead || m.fled) continue;
      const k = gridKey(Math.floor(m.pos.x / FINE), Math.floor(m.pos.z / FINE));
      let a = fine.get(k);
      if (!a) { a = []; fine.set(k, a); }
      a.push(m);
    }
  }
  function push2(m, o, k) {
    if (o.dead || o === m || o.fled) return;
    const dx = o.pos.x - m.pos.x, dz = o.pos.z - m.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > SEP * SEP) return;
    let d = Math.sqrt(d2), ux, uz;
    if (d < 1e-4) {
      const a = ((m.i * 37 + o.i * 91) % 360) * Math.PI / 180;
      ux = Math.cos(a); uz = Math.sin(a); d = 1e-4;
    } else { ux = dx / d; uz = dz / d; }
    const push = (SEP - d) * 0.5 * (d < SEP * 0.69 ? 1 : k);
    if (!m.isYou) { m.pos.x -= ux * push; m.pos.z -= uz * push; }
    if (!o.isYou) { o.pos.x += ux * push; o.pos.z += uz * push; }
    sepFixed++;
    m.resT = 0; o.resT = 0;
  }
  function separatePass(k) {
    sepFixed = 0;
    fine.forEach(function (a) {
      for (let i = 0; i < a.length; i++) {
        const m = a[i];
        if (m.dead) continue;
        for (let j = i + 1; j < a.length; j++) push2(m, a[j], k);
        const cx = Math.floor(m.pos.x / FINE), cz = Math.floor(m.pos.z / FINE);
        for (let f = 0; f < 4; f++) {
          const b = fine.get(gridKey(cx + FAN[f][0], cz + FAN[f][1]));
          if (!b) continue;
          for (let j = 0; j < b.length; j++) push2(m, b[j], k);
        }
      }
    });
    return sepFixed;
  }
  function separateSolve(k) {
    if (!separatePass(k)) return;
    for (let it = 0; it < 2; it++) { rebuildFine(); if (!separatePass(k)) return; }
  }
  const _fine1 = [];
  function fineNear(x, z, r, out) {
    out = out || _fine1;
    out.length = 0;
    const x0 = Math.floor((x - r) / FINE), x1 = Math.floor((x + r) / FINE);
    const z0 = Math.floor((z - r) / FINE), z1 = Math.floor((z + r) / FINE);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const a = fine.get(gridKey(cx, cz));
      if (a) for (let i = 0; i < a.length; i++) out.push(a[i]);
    }
    return out;
  }

  /* ============================================================ SIGHT */
  function terrainBlocked(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dz = bz - az;
    const d = Math.hypot(dx, dz);
    if (d < 8) return false;
    const dy = by - ay, n = Math.ceil(d / 3);
    for (let i = 1; i < n; i++) {
      const t = i / n, at = t * d;
      if (at < 2 || d - at < 2) continue;
      if (MAP.groundAt(ax + dx * t, az + dz * t) > ay + dy * t + 0.35) return true;
    }
    return false;
  }
  function eyeLos(m, o) {
    const ay = m.pos.y + m.eyeH, by = o.pos.y + o.losY;
    if (micro.segmentBlocked(m.pos.x, ay, m.pos.z, o.pos.x, by, o.pos.z)) return false;
    return !(MAP.terrainLos && terrainBlocked(m.pos.x, ay, m.pos.z, o.pos.x, by, o.pos.z));
  }
  function mateInLane(m, tgt) {
    const dx = tgt.pos.x - m.pos.x, dz = tgt.pos.z - m.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) return 0;
    const nx = dx / d, nz = dz / d, reach = Math.min(d - 0.6, 12);
    if (reach <= 1) return 0;
    const a = fineNear(m.pos.x + nx * reach * 0.5, m.pos.z + nz * reach * 0.5, reach * 0.5 + 1.2);
    let worst = 0, worstOff = 9;
    for (let i = 0; i < a.length; i++) {
      const o = a[i];
      if (o === m || o.dead || o.team !== m.team) continue;
      const ox = o.pos.x - m.pos.x, oz = o.pos.z - m.pos.z;
      const along = ox * nx + oz * nz;
      if (along < 0.8 || along > reach) continue;
      const off = ox * nz - oz * nx;
      if (Math.abs(off) < 0.62 && Math.abs(off) < worstOff) {
        worstOff = Math.abs(off);
        worst = off >= 0 ? 1 : -1;
      }
    }
    return worst;
  }

  /* ============================================================ MORALE
     THE ONE MECHANIC THIS FILE ADDS TO THE DONOR, AND THE REASON THE CAMPAIGN
     WORKS AT ALL.

     An army that fights to the last man makes head count the only variable:
     forty levies with pistols beat fifteen veterans with rifles as long as the
     arithmetic works out, and then "who gets the good rifle" is a menu with no
     consequence. Morale inverts that, and it does it without a single typed
     balance scalar — both halves are read off tables that already exist:

     HOW MUCH AN ARMY HAS LOST is a POWER fraction, not a head count:
     1 - power(standing)/power(started), using core's own W.power(). That is
     already weighted by tier, gun, armour and wounds, so losing your four
     veterans hurts your morale roughly four times as much as losing four
     levies — which is the brief's "has lost a third of its men AND its best
     soldiers" without a second term to tune.

     WHEN A MAN BREAKS is combat_iq's own nerve column. ROLE[cq].nerve is
     already "the hp fraction at which this person breaks for cover" — the
     file's own measure of how much fight is in a man — and core's TIERS[].cq
     already names each tier's row. So: civ 0.62, thug 0.42, guard 0.30,
     soldier 0.20. A levy breaks when the army's morale falls under 0.62 and a
     veteran holds to 0.20, from two tables, neither of them written here.

     AND THE WARLORD IN THE LINE HOLDS IT TOGETHER. You alive and near the
     fighting is worth +0.16; you down is worth -0.30, which on top of losing
     the battle outright is the reason standing at the back is not free.

     ?morale=old removes the whole thing — no break point, no rout, no morale
     end condition — which is battle.html's behaviour exactly, and is the
     honest before side for photographing what it buys. */
  const MORALE_OFF = function () { return Q && Q.get("morale") === "old"; };
  const NERVE_FALLBACK = { civ: 0.62, thug: 0.42, guard: 0.30, soldier: 0.20 };
  function nerveOf(m) { return nerveFor(m.s ? W.tier(m.s.tier).cq : "soldier"); }
  function standing(side) {
    const out = [];
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (m.team === side.key && !m.dead && !m.fled && !m.isYou) out.push(m.s);
    }
    return out;
  }
  function updateMorale() {
    ["mine", "them"].forEach(function (k) {
      const s = SIDES[k], foe = SIDES[k === "mine" ? "them" : "mine"];
      s.alive = 0; s.routing = 0;
      for (let i = 0; i < men.length; i++) {
        const m = men[i];
        if (m.team !== k || m.dead || m.fled || m.isYou) continue;
        s.alive++;
        if (m.routed) s.routing++;
      }
      s.powerNow = W.power(standing(s));
    });
    ["mine", "them"].forEach(function (k) {
      const s = SIDES[k], foe = SIDES[k === "mine" ? "them" : "mine"];
      if (MORALE_OFF()) { s.morale = 1; return; }
      s.morale = moraleFrom({
        lost: 1 - s.powerNow / Math.max(0.001, s.power0),
        theirLost: 1 - foe.powerNow / Math.max(0.001, foe.power0),
        leader: k === "mine",
        leaderDown: YOU.dead,
        leaderNear: !YOU.dead && Math.hypot(YOU.pos.x - s.comX, YOU.pos.z - s.comZ) < 55,
        malus: s.moraleMalus || 0,
        routingFrac: s.routing / Math.max(1, s.alive),
      });
    });
  }
  function stepRout(m) {
    if (MORALE_OFF() || m.isYou) return false;
    const nerve = nerveOf(m);
    if (!m.routed) {
      if (m.side.morale < nerve) {
        m.routed = true;
        m.side.brokeN = (m.side.brokeN || 0) + 1;
        if (m.team === "mine" && hud) feed(m.s.name.toUpperCase() + " BREAKS");
      }
    } else if (m.side.morale > nerve + 0.14) {
      // RALLY, with hysteresis: an army that steadies gets its men back, and
      // without the band the whole line would flicker at the threshold.
      m.routed = false;
    }
    return m.routed;
  }

  /* ============================================================ ONE MODEL,
     TWO PRESENTATIONS — the fast resolution, and why it is not a second game.

     THE REQUIREMENT (owner, through the orchestrator): "it's almost like
     openfront.io met Bannerlord once it's multiplayer" — and in a multiplayer
     campaign the shared clock never stops. Seven other warlords are riding
     while you fight, so a battle cannot be allowed to own the world. Three
     things have to exist: a fight that resolves WITHOUT rendering (a player
     skipped it, a player dropped, the AI is fighting the AI, the match cannot
     wait), a hard ceiling on the 3D one so it cannot run forever, and — the
     part that actually matters — a guarantee that the two agree.

     SO THERE IS EXACTLY ONE MODEL. What follows is the attrition tick, and it
     is the arithmetic the 3D battle is already doing, with the geometry taken
     out:

       · the DPS is combat_iq's OWN ladder. profile() gives dps, hit10 and
         secPerRound for a man's role×weapon, so rounds-per-second and
         damage-per-round are read off the same table that decides every
         trigger pull on the sand. Not a parallel stat block — the same one.
       · every round lands through hurtOne(), which is the soak formula
         hurtMan() uses, term for term.
       · morale is moraleFrom(), the same pure function updateMorale() calls.
       · a man breaks at combat_iq's ROLE[].nerve, the same nerveOf().
       · a side is finished at broken(), the same rule checkEnd() uses.

     WHAT THE GEOMETRY WAS WORTH is the one number that cannot come out of a
     table, because it is everything the sand does to a bullet: the walk into
     range, the crest in the way, the rock a man is behind, combat_iq's fire
     token holding all but two or three shooters off any one mark, the misses
     that spread with distance, the suppression. MEASURED against the 3D battle
     it is standing in for — see BATTLE-CHECK in the report — a 26 v 26 on real
     dunes killed ten men in 54 s against a raw ladder output of ~338 HP/s, and
     ENGAGE is that ratio. It is a measurement of this file against itself, and
     if the 3D fight is retuned this number is what has to be re-measured. */
  /* HOW HARD ARMY-ON-ARMY TRADES ARE, and it is the one dial that decides how
     long a battle lasts.

     battle.html multiplies every landed round by 1.45, with the note that
     combat_iq's ladder is authored for fights against the PLAYER and a page
     with no player does not need that fairness cap. This page HAS a player, so
     the multiplier applies army-on-army and NOT to rounds arriving at the
     warlord — against him the shipped ladder is exactly the balance it was
     measured as (see hurtMan).

     1.9, not 1.45, and the reason is a length target rather than a feel:
     "battles need to be SHORT — closer to 60-120 seconds of real decisions".
     MEASURED at 1.45: a 26 v 26 on real dunes took 54 s in the 3D fight and
     74 s resolved, and a 150 v 150 ran into the 150 s ceiling rather than
     ending on its own. At 1.9 the same fights land at roughly 40 s and 110 s,
     which puts every campaign-sized band inside the window and leaves the
     ceiling for genuine stalemates. Raising it does NOT make the player more
     fragile, because his rounds are the ones that skip the multiplier. */
  const ARMY_MUL = 1.9;
  const ENGAGE = 0.045;           // measured: see above
  const ROUT_ESCAPE = 22;         // seconds a routed man needs to reach the edge (FIELD_R*0.95 / 7.6)

  const _profCache = {};
  function profOf(u) {
    const key = (u.cq || "soldier") + "|" + u.wid;
    let p = _profCache[key];
    if (p) return p;
    const fake = { armed: true, weapon: gunName(u.wid), pos: { x: 0, z: 0 } };
    if (u.cq === "soldier") fake.kind = "soldier";
    else if (u.cq === "guard") fake.kind = "guard";
    else if (u.cq === "thug") fake.aggr = 0.92;
    p = (CBZ.combatIQ && CBZ.combatIQ.profile) ? CBZ.combatIQ.profile(fake) : null;
    if (!p) p = { dps: 8, hit10: 0.5, secPerRound: 0.5 };
    _profCache[key] = p;
    return p;
  }
  /* THE SOAK FORMULA, LIFTED OUT SO BOTH PATHS CALL THE SAME ONE. hurtMan is
     the 3D version and it now delegates here; a second copy of this expression
     is exactly how a plate rig starts meaning two different things. */
  /* ...AND THE FLOOR IS A THIRD, NOT A SEVENTH.

     core states armour as flat damage removed per hit, which is the right model
     — it is what makes a plate rig stop a pistol outright and merely blunt a
     rifle. But the FLOOR under it decides whether "blunt" means anything. At
     0.15 a plate rig (soak 20) against a combat_iq rifle round (~22 after the
     army multiplier) left 3.4 damage: thirty rounds to kill a soldier, i.e. a
     man nothing on the field could reliably hurt. MEASURED on the second
     before/after pair — the enemy band, whose makeBand roster puts about one in
     five in armour, out-traded a bare-shirted army five to one and won every
     run of the storyboard.

     At 0.35 a pistol round (~9) still lands as 3 against plate, which is
     "stops a pistol, mostly" exactly as core's own row says, and a rifle round
     lands as 7.7 — blunted to a third, not to nothing. The row keeps its
     meaning; the fight keeps ending. */
  function hurtOne(u, dmg) {
    const after = Math.max(dmg * 0.35, dmg - (u.soak || 0));
    u.hp -= after;
    return after;
  }

  /* THE PURE MORALE FUNCTION. Both updateMorale() (on the sand) and the
     attrition tick (headless) call it, so an army cannot break at a different
     moment depending on whether anybody was watching. */
  function moraleFrom(o) {
    let mo = 1 - o.lost * 1.6 + o.theirLost * 0.55;
    if (o.leader) mo += o.leaderDown ? -0.30 : (o.leaderNear ? 0.16 : 0);
    mo -= o.malus || 0;
    mo -= clamp(o.routingFrac, 0, 1) * 0.25;   // men watch men run
    return clamp(mo, 0, 1);
  }

  /* THE TICK. One second of battle, no rendering, no geometry. It mutates the
     unit records in place — which is why the 3D battle can hand it its OWN
     live bodies when the clock runs out and simply carry on. */
  function attritionTick(units, sides, ctxR, dt) {
    /* THE FRACTIONAL ROUND CARRIES OVER. A 26-man line puts out about 2.3
       rounds a second at this engagement rate, and flooring that every tick
       throws away a third of the fire — a systematic 15% under-count that
       would make the fast path quietly gentler than the fight it stands in
       for. The remainder lives on the report, so it survives the tick. */
    const acc = ctxR._acc || (ctxR._acc = { mine: 0, them: 0 });
    for (const k in sides) {
      const s = sides[k];
      s.alive = 0; s.routing = 0; s.out = 0; s.roundDmg = 0; s.powerNow = 0;
      const standing = [];
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (u.team !== k || u.dead || u.fled || u.isYou) continue;
        s.alive++;
        if (u.routed) { s.routing++; continue; }
        standing.push(u);
        const p = profOf(u);
        const rounds = (p.hit10 / Math.max(0.05, p.secPerRound)) * ENGAGE;
        const per = (p.dps * p.secPerRound / Math.max(0.05, p.hit10)) * ARMY_MUL *
          (u.wounded ? 0.6 : 1);
        s.out += rounds;
        s.roundDmg += rounds * per;
        if (u.s) s.powerNow += W.soldierPower(u.s);
      }
      s.standing = standing;
      s.perRound = s.out > 0 ? s.roundDmg / s.out : 0;
    }
    /* THE WARLORD SHOOTS TOO, AND HIS ROUNDS ARE ROUNDS — not a bonus on
       everybody else's.

       The first draft added his whole output to the side's roundDmg and ONE to
       its round count, which is a category error: perRound is the mean damage
       of a round and every round the army fires is then dealt at that mean. A
       26-man line puts out about 2.3 rounds a second, so folding a player's
       ~130 HP/s into that average multiplied EVERY rifle round by roughly
       forty. MEASURED: a 26 v 26 resolved in six seconds with the enemy wiped
       and not one friendly casualty, and an 8 v 26 won clean. It read as a
       balance problem and it was an arithmetic one.

       So he contributes a round STREAM at his own rate: three times an engaged
       rifleman's, because he picks his moments and nobody is holding a fire
       token over him, carrying his weapon's own damage at the 0.55 the 3D path
       applies to a player trigger pull. That works out at five or six riflemen
       of output, which is the same neighbourhood core's yourPower() puts him
       in. */
    const you = ctxR.you;
    if (you && !you.dead) {
      const w = CBZ.weaponById ? CBZ.weaponById(you.wid) : null;
      const per = ((w && w.damage) || 24) * ((w && w.pellets) || 1) * 0.55;
      const rounds = 2.0 * ENGAGE * 3;
      sides.mine.out += rounds;
      sides.mine.roundDmg += rounds * per;
      sides.mine.perRound = sides.mine.out > 0 ? sides.mine.roundDmg / sides.mine.out : 0;
    }

    // ---- deal it, one round at a time, through the same soak
    for (const k in sides) {
      const s = sides[k], foe = sides[k === "mine" ? "them" : "mine"];
      const pool = foe.standing.concat(
        foe.routing ? units.filter(function (u) {
          return u.team === foe.key && u.routed && !u.dead && !u.fled;
        }) : []);
      if (!pool.length || s.perRound <= 0) continue;
      acc[k] = (acc[k] || 0) + s.out * dt;
      let n = Math.floor(acc[k]);
      acc[k] -= n;
      /* AND THE WARLORD IS IN THE POOL. He is standing in his own line — that
         is the whole pitch — so the enemy's rounds can find him at the rate
         one man in the line would expect. */
      const youIn = k === "them" && ctxR.you && !ctxR.you.dead && !ctxR.youSafe;
      while (n-- > 0) {
        const total = pool.length + (youIn ? 1 : 0);
        const pick = Math.floor(lcg() * total);
        const tgt = pick >= pool.length ? ctxR.you : pool[pick];
        if (!tgt || tgt.dead) continue;
        // the player does not eat the army-on-army multiplier — hurtMan's rule
        hurtOne(tgt, tgt === ctxR.you ? s.perRound / ARMY_MUL : s.perRound);
        if (tgt.hp <= 0) {
          tgt.dead = true; tgt.hp = 0;
          if (tgt === ctxR.you) { ctxR.youDown = true; continue; }
          const si = pool.indexOf(tgt);
          if (si >= 0) pool.splice(si, 1);
          sides[tgt.team].deadN++;
          if (tgt.s) ctxR.deadOf[tgt.team].push(tgt.s);
          if (!pool.length) break;
        }
      }
    }

    // ---- morale, on the same numbers, through the same function
    for (const k in sides) {
      const s = sides[k], foe = sides[k === "mine" ? "them" : "mine"];
      s.morale = MORALE_OFF() ? 1 : moraleFrom({
        lost: 1 - s.powerNow / Math.max(0.001, s.power0),
        theirLost: 1 - foe.powerNow / Math.max(0.001, foe.power0),
        leader: k === "mine",
        leaderDown: !!ctxR.youDown,
        leaderNear: true,             // headless: a warlord who fights is IN it
        malus: s.moraleMalus || 0,
        routingFrac: s.routing / Math.max(1, s.alive),
      });
    }
    // ---- who breaks, and who gets away
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.dead || u.fled || u.isYou) continue;
      const s = sides[u.team];
      if (!MORALE_OFF()) {
        const nerve = u.nerve;
        if (!u.routed && s.morale < nerve) { u.routed = true; s.brokeN = (s.brokeN || 0) + 1; }
        else if (u.routed && s.morale > nerve + 0.14) u.routed = false;
      }
      if (u.routed) {
        u.runT = (u.runT || 0) + dt;
        if (u.runT >= ROUT_ESCAPE) {
          u.fled = true;
          if (u.s) ctxR.fledOf[u.team].push(u.s);
        }
      } else u.runT = 0;
    }
  }

  /* ============================================================ RESOLVE
     THE SAME FIGHT, WITHOUT A CAMERA. Same rosters, same guns, same armour,
     same morale, same break points, same report shape — and it returns in one
     call, which is what lets a multiplayer campaign carry on while somebody
     skips a battle, drops, or lets two AI bands settle it between themselves.

     It does NOT touch the phase, the screen or the scene. `apply:true` hands
     the result to army.js's aftermath the way a real battle does; leaving it
     off returns the report and changes nothing, which is what a headless
     simulation of somebody else's fight wants. */
  function resolve(opts) {
    opts = opts || {};
    const b = opts.band || W.makeBand({ size: 12 });
    seedBattle((W.state.seed | 0) * 7919 + (W.state.day | 0) * 131 + (b.men.length | 0) +
      (opts.salt | 0));
    const cap = Math.max(1, parseInt((Q && Q.get("men")) || "", 10) || MEN_CAP_DEFAULT);
    const mineR = (opts.army || W.state.army).slice(0, cap);
    const themR = b.men.slice(0, cap);

    const mk = function (s, team) {
      const T = W.tier(s.tier);
      return {
        s: s, team: team, wid: s.wid || "sidearm", cq: T.cq,
        hp: (s.hp > 0 ? s.hp : T.hp) * (s.wounded ? 0.6 : 1),
        maxHp: T.hp, soak: W.armour(s.armour).soak, wounded: !!s.wounded,
        nerve: nerveFor(T.cq), dead: false, fled: false, routed: false, runT: 0,
      };
    };
    const units = [];
    for (let i = 0; i < mineR.length; i++) units.push(mk(mineR[i], "mine"));
    for (let i = 0; i < themR.length; i++) units.push(mk(themR[i], "them"));

    const you = { isYou: true, team: "mine", wid: W.state.you.wid,
      hp: W.state.you.hp, maxHp: W.state.you.maxHp,
      soak: W.armour(W.state.you.armour).soak, dead: false };

    const sides = {
      mine: sideRecord("mine", -1), them: sideRecord("them", 1),
    };
    sides.mine.power0 = W.power(mineR) + 14;
    sides.them.power0 = W.power(themR);
    sides.mine.moraleMalus = opts.surprised ? 0.2 : (opts.chased ? 0.1 : 0);
    sides.mine.men0 = mineR.slice();
    sides.them.men0 = themR.slice();

    const ctxR = {
      band: b, youKills: 0, headless: true, you: you,
      youSafe: !!opts.youSafe,      // an AI-vs-AI fight has no warlord in it
      ratio: sides.mine.power0 / Math.max(0.001, sides.them.power0),
      deadOf: { mine: [], them: [] }, fledOf: { mine: [], them: [] },
      reserveOf: { mine: (opts.army || W.state.army).slice(mineR.length),
                   them: b.men.slice(themR.length) },
    };

    const limit = opts.limit || BATTLE_MAX();
    let t = 0, outcome = null;
    while (t < limit) {
      attritionTick(units, sides, ctxR, 1);
      t++;
      if (ctxR.youDown && !ctxR.youSafe) { outcome = "lost"; break; }
      if (sides.them.alive === 0 || brokenSide(sides.them, ctxR.fledOf.them.length)) { outcome = "won"; break; }
      if (sides.mine.men0.length &&
          ((sides.mine.alive === 0 && !ctxR.reserveOf.mine.length) ||
           brokenSide(sides.mine, ctxR.fledOf.mine.length))) { outcome = "lost"; break; }
    }
    /* A FIGHT THAT WILL NOT END IS DECIDED ON THE FIELD. The cap exists so a
       campaign turn is bounded; when it is reached the side with more power
       left has won, which is what "both sides withdrew and one of them held
       the ground" means. Never a draw: the campaign has no shape for one. */
    if (!outcome) outcome = sides.mine.powerNow >= sides.them.powerNow ? "won" : "retreat";

    const r = buildReport(units, ctxR, outcome, t);
    r.youKills = 0;
    if (!ctxR.youSafe) {
      W.state.you.hp = outcome === "lost"
        ? Math.max(1, Math.round(W.state.you.maxHp * 0.25))
        : Math.max(1, Math.round(you.hp));
    }
    if (opts.apply !== false && W.army && W.army.aftermath) W.army.aftermath(r);
    return r;
  }
  function sideRecord(key, dir) {
    return { key: key, dir: dir, alive: 0, routing: 0, deadN: 0, brokeN: 0,
      morale: 1, power0: 1, powerNow: 1, moraleMalus: 0, men0: [], standing: [] };
  }
  function nerveFor(cq) {
    const R = CBZ.combatIQ && CBZ.combatIQ.ROLE && CBZ.combatIQ.ROLE[cq];
    return (R && R.nerve != null) ? R.nerve : (NERVE_FALLBACK[cq] || 0.4);
  }
  // the break rule, on a side record rather than on the live SIDES — the same
  // arithmetic checkEnd() runs, so a battle cannot end at two different moments
  // depending on which path is running it
  function brokenSide(side, fled) {
    if (MORALE_OFF() || side.men0.length <= 2) return false;
    const fighting = side.alive - side.routing;
    const gone = side.deadN + side.routing + fled;
    return fighting <= Math.max(1, Math.floor(side.men0.length * 0.1)) &&
           gone >= side.men0.length * 0.3;
  }

  /* ============================================================ THE CLOCK
     A BATTLE HAS A CEILING AND THE UI SAYS SO. In a shared campaign a fight
     that runs forever is a player holding seven other people hostage, and even
     solo a stalemate on a dune is a page nobody closes gracefully. At the cap
     the fight does not simply stop: the REMAINDER IS RESOLVED THROUGH THE SAME
     ATTRITION TICK, on the same bodies, with their current hp and morale — the
     3D battle and the fast path meeting in the middle of one fight, which is
     the strongest statement available that they are one model.

     150 s because the fights measured on real rosters land at 45-90 s and a
     ceiling has to sit clear of the honest ones; ?limit=N moves it. */
  function BATTLE_MAX() {
    const n = parseInt((Q && Q.get("limit")) || "", 10);
    return n > 0 ? n : 150;
  }
  function finishOnTheClock() {
    const ctxR = report;
    ctxR.you = YOU;
    for (let i = 0; i < men.length; i++) {
      const u = men[i];
      if (!u.isYou && !u.nerve) u.nerve = nerveOf(u);
    }
    SIDES.mine.men0 = SIDES.mine.men0 || [];
    for (let g = 0; g < 120; g++) {
      attritionTick(men, SIDES, ctxR, 1);
      /* THE MEN THE TICK KILLED STILL HAVE TO FALL. attritionTick knows about
         hp and nothing about bodies, which is right — it is the headless half.
         So the bodies it emptied are laid down here, through the same
         manDeathPhysics every 3D death runs, or the last second and a half
         before the aftermath screen is a rank of standing corpses. */
      for (let i = 0; i < men.length; i++) {
        const u = men[i];
        if (u.dead && !u.isYou && !u.dieT && !u.ragdoll) {
          if (u.char && CBZ.deathPose) safe(function () { CBZ.deathPose(u.char, u.i * 3.7 + 1.3, lcg()); });
          manDeathPhysics(u, null);
          corpses.push(u);
        }
      }
      if (YOU.dead) { endBattle("lost", "YOU WENT DOWN"); return; }
      if (SIDES.them.alive === 0 || brokenSide(SIDES.them, ctxR.fledOf.them.length)) {
        endBattle("won", "THEY BREAK"); return;
      }
      if (SIDES.mine.men0.length && brokenSide(SIDES.mine, ctxR.fledOf.mine.length)) {
        endBattle("lost", "YOUR ARMY BREAKS"); return;
      }
    }
    endBattle(SIDES.mine.powerNow >= SIDES.them.powerNow ? "won" : "retreat", "THE LIGHT GOES");
  }

  /* ============================================================ ORDERS
     FOUR BUTTONS AND NOT ONE MORE. The brief is explicit that the controls stay
     as simple as the natural-disaster game, and four is the number that covers
     every decision a line commander actually makes: go, stay, go around, get
     out. They are not a second AI — each one changes what combat_iq is TOLD
     (where the goal is, whether cover is preferred, whether the band is
     respected) and combat_iq still decides how to fight there.

     ?orders=old pins everybody to HOLD, which is exactly battle.html's
     behaviour (posture(), band, bearing, tokens, nothing else) and is the
     revert for the command layer. */
  const ORDERS = ["charge", "hold", "flank", "fallback"];
  const ORDER_LABEL = { charge: "CHARGE", hold: "HOLD", flank: "FLANK", fallback: "FALL BACK" };
  function orderOf(side) {
    return (Q && Q.get("orders") === "old") ? "hold" : side.order;
  }
  function setOrder(o, sideKey) {
    const s = SIDES[sideKey || "mine"];
    if (!s || ORDERS.indexOf(o) < 0) return;
    if (s.order === o) return;
    s.order = o;
    /* AN ORDER RESETS THE ANCHOR IT IS MEASURED FROM. HOLD means "hold HERE",
       and here is wherever the line is when the order lands — not where it
       formed up two minutes ago. Without this, HOLD after a CHARGE drags the
       whole army backwards to the start line, which reads as a bug. */
    s.anchorX = s.comX; s.anchorZ = s.comZ;
    if (sideKey !== "them") {
      feed("ORDER: " + ORDER_LABEL[o]);
      paintOrders();
    }
  }
  /* THE OTHER SIDE HAS A COMMANDER TOO, and he is four lines because he is
     answering the same four-button question. Re-asked on a slow tick so the
     enemy line does not twitch. */
  function enemyCommand() {
    const s = SIDES.them, foe = SIDES.mine;
    let o = "hold";
    if (s.morale < 0.45) o = "fallback";
    else if (s.powerNow > foe.powerNow * 1.25 || s.alive > foe.alive * 1.4) o = "charge";
    else if (simT > 24 && s.alive > 6 && foe.alive > 3) o = "flank";
    if (o !== s.order) { s.order = o; s.anchorX = s.comX; s.anchorZ = s.comZ; }
  }

  /* ============================================================ THINK */
  function marchGoal(m, gx, gz) {
    const sq = m.side.squads[m.sq];
    let lead = null;
    if (sq) for (let i = 0; i < sq.length; i++) if (!sq[i].dead && !sq[i].fled && !sq[i].routed) { lead = sq[i]; break; }
    if (lead && lead !== m) {
      // the column: a squad rounds a dune as a squad, one lookup per follower
      const ahead = lead.target;
      const my = Math.atan2(ahead.x - lead.pos.x, ahead.z - lead.pos.z);
      const row = ((m.sqSlot / 2) | 0) + 1, col = (m.sqSlot & 1) ? 1.25 : -1.25;
      m.target.set(lead.pos.x - Math.sin(my) * row * 2.0 + Math.cos(my) * col, 0,
                   lead.pos.z - Math.cos(my) * row * 2.0 - Math.sin(my) * col);
    } else {
      m.target.set(gx + (lcg() - 0.5) * 12, 0, gz + (lcg() - 0.5) * 12);
    }
    m.slot = "march";
  }
  const _bn = [];
  function spreadGoal(m) {
    const a = fineNear(m.target.x, m.target.z, 2.6, _bn);
    let ox = 0, oz = 0, n = 0;
    for (let i = 0; i < a.length && n < 4; i++) {
      const o = a[i];
      if (o === m || o.dead || o.team !== m.team) continue;
      const dx = m.target.x - o.pos.x, dz = m.target.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.6 || d < 0.001) continue;
      ox += (dx / d) * (2.6 - d); oz += (dz / d) * (2.6 - d); n++;
    }
    if (n) { m.target.x += ox; m.target.z += oz; }
  }
  // the flank anchor: 90 degrees off the fight axis, on the side of the enemy
  // mass that has fewer of them in it. Stable per man so a wing does not swap
  // sides every think.
  function flankAnchor(m) {
    const foe = SIDES[m.team === "mine" ? "them" : "mine"];
    const ax = Math.atan2(foe.comX - m.side.comX, foe.comZ - m.side.comZ);
    if (m._wing == null) m._wing = ((m.i + m.side.wingBias) & 1) ? 1 : -1;
    const wide = ax + m._wing * 1.15;
    const r = 46 + (m.i % 5) * 5;
    return { x: foe.comX + Math.sin(wide) * r, z: foe.comZ + Math.cos(wide) * r };
  }

  function think(m, now) {
    const thinkDt = Math.min(1.2, now - m.lastThink);
    m.lastThink = now;
    m.thinkAt = now + 0.14 + Math.min(0.42, men.length / 2600) + lcg() * 0.06;

    if (stepRout(m)) {
      /* A ROUTING MAN RUNS FOR HIS OWN EDGE AND DOES NOT SHOOT. He is not
         retreating in good order — that is FALL BACK, which is an order and
         still fires. This is the army coming apart. */
      const s = m.side;
      m.target.set(m.pos.x + s.dir * 40, 0, m.pos.z + (lcg() - 0.5) * 20);
      m.slot = "rout";
      m.tgt = null;
      return;
    }

    if (m.stepAsideT > 0 && m.tgt && !m.tgt.dead) { m.stepAsideT -= thinkDt; return; }
    if (!m.tgt || m.tgt.dead || m.tgt.fled) { m.tgt = pickTarget(m, SIGHT); m.losBadT = 0; }

    const ord = orderOf(m.side);
    const foe = SIDES[m.team === "mine" ? "them" : "mine"];
    const tgt = m.tgt;

    if (!tgt) {
      if (ord === "flank") { const a = flankAnchor(m); marchGoal(m, a.x, a.z); }
      else if (ord === "fallback") marchGoal(m, m.side.anchorX + m.side.dir * 60, m.side.anchorZ);
      else marchGoal(m, foe.comX, foe.comZ);
      return;
    }

    const sees = eyeLos(m, tgt);
    m.sees = sees;
    if (!sees) {
      m.losBadT += thinkDt;
      if (m.losBadT > 2.6) {
        if (m.losBadT > 7) { m.tgt = null; m.losBadT = 0; return; }
        m.target.set(tgt.pos.x, 0, tgt.pos.z);
        m.slot = "push";
        return;
      }
    } else m.losBadT = 0;

    const d = Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z);

    /* ---- FALL BACK: fighting backwards. He keeps his mark and keeps firing;
       he simply refuses to be where he is. A retreat that stops shooting is a
       rout, and the difference between the two is the entire point of having
       both a button and a morale system. */
    if (ord === "fallback") {
      m.target.set(m.pos.x + m.side.dir * 16, 0, m.pos.z + (lcg() - 0.5) * 5);
      m.slot = "fallback";
      spreadGoal(m);
      return;
    }

    /* ---- CHARGE: the band is ignored. combat_iq's posture() exists to hold a
       weapon's preferred distance, which is right and is exactly what a charge
       refuses to do — so a charge does not call it. Goal is the man himself,
       slot "push", which the trigger and the locomotion below already read as
       "close, at speed, shooting". */
    if (ord === "charge") {
      m.target.set(tgt.pos.x, 0, tgt.pos.z);
      m.slot = "push";
      spreadGoal(m);
      return;
    }

    /* ---- FLANK: wide until the wing is around, then fight from there. Men
       out of contact walk the arc; men in contact hand back to posture(), so
       the actual gunfight on the wing is still combat_iq's. */
    if (ord === "flank") {
      const a = flankAnchor(m);
      const da = Math.hypot(a.x - m.pos.x, a.z - m.pos.z);
      if (da > 24 && d > 34) {
        m.target.set(a.x, 0, a.z);
        m.slot = "flank";
        spreadGoal(m);
        return;
      }
    }

    // ---- HOLD (and a flanker who has arrived): the donor's own path.
    const slot = CBZ.combatIQ && CBZ.combatIQ.posture
      ? CBZ.combatIQ.posture(m, tgt, thinkDt) : "fire";
    m.slot = slot || "fire";

    /* HOLD PREFERS COVER OVER ANGLES. posture() hands a man without the fire
       token the "flank" slot — work an angle — which is right for a squad
       manoeuvring and wrong for a line under orders to HOLD. So on HOLD the
       angle-workers are sent to the nearest real cover instead (combat_iq's
       own cover search, not a second one), and only if there is none do they
       keep the angle. This is the "cover preference" the order changes. */
    if (ord === "hold" && slot === "flank" && CBZ.combatIQ && CBZ.combatIQ.cover) {
      const cv = CBZ.combatIQ.cover(m, tgt.pos.x, tgt.pos.z);
      if (cv) { m.target.set(cv.x, 0, cv.z); m.slot = "cover"; }
    }
    /* AND HOLD MEANS HOLD *HERE*. A leash on the anchor the order was given
       at: without it a held line drifts forward one band at a time as men
       re-acquire nearer marks, and after a minute HOLD and CHARGE look the
       same on screen. 26 m is a band's worth of give. */
    if (ord === "hold") {
      const ax = m.side.anchorX, az = m.side.anchorZ;
      const fwd = (m.target.x - ax) * -m.side.dir;
      if (fwd > 26) m.target.x = ax - m.side.dir * 26;
    }
    spreadGoal(m);
  }

  /* ============================================================ FIRE
     The trigger is combat_iq's: reaction beat, settle, burst rhythm, token
     discipline, derived damage. This only draws the round and applies the
     number it was handed. */
  function fireShot(m, tgt, r) {
    const w = CBZ.weaponById(m.wid);
    m.mag--; m.lastShotT = simT;
    m.side.shots++;

    const cd2 = camDist2(m.pos);
    const seen = cd2 < 240 * 240;
    const hit = lcg() < r.hit;
    const head = hit && lcg() < 0.12;

    _v.set(tgt.pos.x, tgt.pos.y + (head ? tgt.headY : tgt.aimY), tgt.pos.z);
    if (!hit) {
      const slot = (w && w.slot) || "_def";
      const spread = (CBZ.NPC_SPREAD && (CBZ.NPC_SPREAD[slot] || CBZ.NPC_SPREAD._def)) || 0.055;
      const mul = CBZ.suppressionAccuracyMul ? CBZ.suppressionAccuracyMul(m) : 1;
      const dist = Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z);
      const miss = spread * mul * dist * (0.5 + lcg() * 1.6);
      const ang = lcg() * Math.PI * 2;
      _v.x += Math.cos(ang) * miss;
      _v.y += (lcg() - 0.35) * miss * 0.8;
      _v.z += Math.sin(ang) * miss;
    }

    if (seen && fxBudget < 26) {
      fxBudget++;
      let from = null;
      if (cd2 < 130 * 130 && CBZ.actorMuzzle) from = CBZ.actorMuzzle(m, _muz);
      if (!from) from = _muz.set(m.pos.x + Math.sin(m.yaw) * 0.5, m.pos.y + 1.42, m.pos.z + Math.cos(m.yaw) * 0.5);
      const lines = (w && w.pellets) ? 3 : 1;
      for (let i = 0; i < lines; i++) {
        _v2.copy(_v);
        if (i) { _v2.x += (lcg() - 0.5) * 1.6; _v2.y += (lcg() - 0.5) * 0.9; _v2.z += (lcg() - 0.5) * 1.6; }
        CBZ.tracer(from, _v2, { shooter: m, targetActor: tgt, muzzle: i === 0,
          muzzleScale: (w && w.flash ? 0.5 + w.flash : 0.9) });
      }
      const dCam = Math.sqrt(cd2);
      if (w && w.sfx && dCam < 230) {
        safe(function () {
          CBZ.sfx(w.sfx, { dist: dCam, ghost: true, volume: (w.sfxVol || 1) * 0.8,
            pitch: w.sfxPitch || 1, delay: dCam > 40 ? dCam / 343 : 0 });
        });
      }
      if (!hit) missImpact(from, _v, cd2);
    }

    if (hit) {
      m.side.hits++;
      if (CBZ.bodyWound && cd2 < 90 * 90) safe(function () { CBZ.bodyWound(tgt, _v, {}); });
      hurtMan(tgt, r.dmg * (head ? 2.2 : 1), { by: m, headshot: head });
    }
  }
  const _mq = [];
  function missImpact(from, to, cd2) {
    if (cd2 > 150 * 150) return;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1) return;
    const steps = Math.min(14, Math.ceil(len / 2.4));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + dx * t, y = from.y + dy * t, z = from.z + dz * t;
      const g = MAP.groundAt(x, z);
      if (y <= g + 0.05) {
        _v2.set(x, g + 0.03, z);
        CBZ.bulletImpact(_v2, { x: 0, y: 1, z: 0 }, { kind: "dust", power: 0.8 });
        return;
      }
      const cols = micro.queryColliders(x, z, 0.4, _mq);
      for (let c = 0; c < cols.length; c++) {
        const b = cols[c];
        if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
        if (b.y0 != null && (y < b.y0 || y > b.y1)) continue;
        _v2.set(x, y, z);
        const nx = Math.abs(x - b.minX) < Math.abs(x - b.maxX) ? -1 : 1;
        CBZ.bulletImpact(_v2, { x: nx, y: 0.2, z: 0 }, { kind: "spark", power: 1 });
        return;
      }
    }
  }

  /* ============================================================ DAMAGE
     ARMOUR IS A FLAT SOAK, taken off before the health, which is core's own
     statement of what armour is. It is applied HERE rather than by raising hp
     because the two are not the same thing on screen: soak makes a pistol
     stop working and leaves a rifle working, and a health bonus makes both
     work slightly less well.

     THE 1.45 IS NOT UNIVERSAL, and this is where this file parts company with
     the donor. battle.html multiplies every landed round by 1.45 with the
     comment "combat_iq's ladder is authored for fights against the PLAYER,
     whose fairness cap this page has no player to need". This page HAS a
     player. So the hotter trade applies army-on-army, where it is what keeps a
     battle from taking four minutes, and NOT to rounds arriving at the
     warlord — against him the shipped ladder is exactly the balance it was
     measured as, DPS_CAP and all. */
  function hurtMan(m, dmg, imp) {
    if (!m || m.dead || !(dmg > 0) || over) return;
    const scaled = (imp && imp.raw) ? dmg : dmg * (m.isYou ? 1 : ARMY_MUL);
    const after = hurtOne(m, scaled);      // ONE soak formula — see hurtOne
    if (CBZ.combatIQ && CBZ.combatIQ.suppress && !m.isYou) CBZ.combatIQ.suppress(m, 0.9);
    if (imp && imp.by && imp.by.team && imp.by.team !== m.team && (!m.tgt || m.tgt.dead)) m.tgt = imp.by;
    if (m.isYou) {
      CBZ.shake && CBZ.shake(Math.min(1.2, after / 30));
      hurtFlash = 1;
    }
    if (m.hp <= 0) killMan(m, imp);
  }

  function killMan(m, imp) {
    m.dead = true; m.hp = 0;
    const by = imp && imp.by;
    if (by && by.team && by.team !== m.team) {
      by.kills = (by.kills || 0) + 1;
      if (by.s) by.s.kills = (by.s.kills || 0) + 1;
      if (by.isYou) { W.state.you.kills++; report.youKills++; }
      by.side.kills++;
    }
    if (m.isYou) {
      /* THE WARLORD GOES DOWN AND THE BATTLE IS OVER. Not "you respawn", not
         "your army fights on" — the brief is explicit, and it is also the only
         thing that makes standing in your own line a decision. */
      W.state.you.hp = 1;
      endBattle("lost", "YOU WENT DOWN");
      return;
    }
    m.side.deadN++;
    if (m.s) report.deadOf[m.team].push(m.s);
    if (m.char && CBZ.deathPose) safe(function () { CBZ.deathPose(m.char, m.i * 3.7 + 1.3, lcg()); });
    m.dieT = 0.0001;
    m.dieDir = lcg() < 0.5 ? -1 : 1;
    manDeathPhysics(m, imp);
    // the rifle leaves his hands and lands like hardware — and it is the same
    // gun the aftermath will put in your cart
    const prop = m._weaponProp;
    if (prop && CBZ.weaponPhysics && CBZ.weaponPhysics.drop) {
      safe(function () {
        scene.attach(prop);
        m._weaponProp = null; m._weaponPropId = null;
        CBZ.weaponPhysics.drop(prop, {
          vx: (lcg() - 0.5) * 2.4, vy: 1.6 + lcg(), vz: (lcg() - 0.5) * 2.4,
          source: "warlord-death",
        });
        dropGuns.push(prop);
        if (dropGuns.length > 120) {
          const old = dropGuns.shift();
          if (old && old.parent) old.parent.remove(old);
        }
      });
    }
    m.armed = false;
    corpses.push(m);
    if (corpses.length > CORPSE_MAX) retireOldestCorpse();
    if (m.team === "mine" && m.s) feed(m.s.name.toUpperCase() + " DOWN");
  }

  const _kdir = { x: 0, y: 0, z: 0 }, _kpt = { x: 0, y: 0, z: 0 };
  function manDeathPhysics(m, imp) {
    if (!m.group || !m.char) { m.dieT = 0.0001; return; }
    let dx = 0, dz = 0;
    const by = imp && imp.by;
    if (by && by.pos) { dx = m.pos.x - by.pos.x; dz = m.pos.z - by.pos.z; }
    const dl = Math.hypot(dx, dz);
    if (dl > 0.01) { dx /= dl; dz /= dl; }
    else { const a = lcg() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); }
    _kdir.x = dx; _kdir.y = 0; _kdir.z = dz;
    _kpt.x = m.pos.x - dx * 0.28; _kpt.y = m.pos.y + 1.28; _kpt.z = m.pos.z - dz * 0.28;
    const w = (by && by.wid) ? CBZ.weaponById(by.wid) : null;
    let energy = 7;
    if (w) energy = w.pellets ? 15 : Math.max(5, Math.min(13, (w.damage || 20) * 0.35));
    if (CBZ.cityRagdoll) {
      const got = safe(function () { return CBZ.cityRagdoll(m, _kpt, _kdir, energy); });
      if (got) { m.ragdoll = true; m.dieT = 0; deadSolving++; return; }
    }
    m.dieT = 0.0001;
  }
  const SINK_NEAR2 = 45 * 45;
  function retireOldestCorpse() {
    let pick = -1;
    for (let i = 0; i < corpses.length; i++) if (camDist2(corpses[i].pos) > SINK_NEAR2) { pick = i; break; }
    if (pick < 0) pick = 0;
    const old = corpses.splice(pick, 1)[0];
    if (!old || !old.group) return;
    if (CBZ.ragdollDrop) safe(function () { CBZ.ragdollDrop(old); });
    if (old.ragdoll) { old.ragdoll = false; deadSolving = Math.max(0, deadSolving - 1); }
    old.retired = true;
    sinking.push({ g: old.group, t: 0 });
  }
  function stepSinking(dt) {
    for (let i = sinking.length - 1; i >= 0; i--) {
      const s = sinking[i];
      s.t += dt;
      s.g.position.y -= dt * 0.8;
      if (s.t > 2.2) { CBZ.studio.drop(s.g); sinking.splice(i, 1); }
    }
  }

  /* ============================================================ SIM STEP */
  function stepMan(m, sdt) {
    if (m.isYou) return;              // a thumb drives him, not this
    if (m.fled) return;
    if (m.dead) {
      if (m.ragdoll) return;          // the solver owns the transform
      if (m.dieT > 0 && m.dieT < 1) {
        m.dieT = Math.min(1, m.dieT + sdt * 2.4);
        const k = 1 - (1 - m.dieT) * (1 - m.dieT);
        m.group.rotation.x = m.dieDir * k * (Math.PI / 2 - 0.07);
      }
      return;
    }
    if (simT >= m.thinkAt) think(m, simT);
    if (m.reloadT > 0) { m.reloadT -= sdt; if (m.reloadT <= 0) m.mag = m.magSize; }
    m.cool -= sdt;

    const dx = m.target.x - m.pos.x, dz = m.target.z - m.pos.z;
    const d = Math.hypot(dx, dz);
    const tgt0 = m.tgt;
    const tdist = tgt0 && !tgt0.dead ? Math.hypot(tgt0.pos.x - m.pos.x, tgt0.pos.z - m.pos.z) : 1e9;
    let spd = 0;
    if (d > 1.1) {
      const hurtish = m.hp < m.maxHp * 0.45;
      spd = m.slot === "rout" ? 7.6 :
            m.slot === "fallback" ? 5.2 :
            (m.slot === "push" || m.slot === "march" || m.slot === "flank") ? 6.2 :
            (m.slot === "cover" || hurtish) ? 7.0 : 4.6;
      // closing to the band is a RUN, whatever the slot says — battle.html's
      // own rule, and it is what stops a rifleman holding a fire token forty
      // metres out of his own range
      if (tdist < 1e9 && tdist > 42 && spd < 6.2) spd = 6.4;
      // ARMOUR COSTS YOU A STEP. core states `slow` per row and nothing was
      // spending it; a heavy kit that only ever helps is not a decision.
      spd *= (1 - (m.slow || 0));
      let nx = dx / d, nz = dz / d;
      if (m.detourT > 0) {
        m.detourT -= sdt;
        const sw = m.detourDir || 1;
        const tx = nz * sw, tz = -nx * sw;
        nx = tx; nz = tz;
      }
      const ox = m.pos.x, oz = m.pos.z;
      m.pos.x += nx * spd * sdt;
      m.pos.z += nz * spd * sdt;
      micro.resolveCircle(m.pos, m.rad, m.pos.y, 1.8);
      const got = Math.hypot(m.pos.x - ox, m.pos.z - oz);
      const want = spd * sdt;
      if (want > 0.001 && got < want * 0.25) {
        m.stuckT = (m.stuckT || 0) + sdt;
        if (m.stuckT > 0.8) {
          m.stuckT = 0;
          m.detourT = 1.5 + ((m.i % 5) * 0.35);
          m.detourDir = (m.i & 1) ? 1 : -1;
        }
      } else if (got > want * 0.6 && m.stuckT) m.stuckT = Math.max(0, m.stuckT - sdt * 2);
    } else {
      m.resT = (m.resT || 0) - sdt;
      if (m.resT <= 0) { m.resT = 0.25; micro.resolveCircle(m.pos, m.rad, m.pos.y, 1.8); }
    }
    m.speed = spd;
    m.pos.y = MAP.groundAt(m.pos.x, m.pos.z);

    // OFF THE EDGE OF THE WORLD. A routed man who reaches his own baseline has
    // left the battle: he lives, he is not a prisoner, and he is not a body
    // the sim has to keep stepping. This is what ENDS a broken army.
    if (m.routed && Math.abs(m.pos.x - MAP.cx) > FIELD_R * 0.95) {
      m.fled = true;
      if (m.s) report.fledOf[m.team].push(m.s);
      if (m.group) m.group.visible = false;
      return;
    }

    const tgt = m.tgt;
    const engaged = tgt && !tgt.dead && m.sees;
    if (!engaged && spd > 0.1) {
      const want = Math.atan2(dx, dz);
      let dy = want - m.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      m.yaw += dy * Math.min(1, sdt * 7);
      m.group.rotation.y = m.yaw;
    }

    // ---- the trigger ----
    if (m.routed) return;             // a broken man is not fighting
    if (!tgt || tgt.dead || tgt.fled || m.reloadT > 0) return;
    const dist = Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z);
    const p = CBZ.combatIQ && CBZ.combatIQ.profile ? CBZ.combatIQ.profile(m) : null;
    const fireMax = p ? Math.min(125, p.hi * 2.6 + 8) : 60;
    if (!m.sees || dist > fireMax) return;
    if (m.slot !== "fire" && m.slot !== "peek" && m.slot !== "push" &&
        m.slot !== "sidestep" && m.slot !== "fallback" && dist > 12) return;
    if (m.cool > 0) return;
    m.sees = eyeLos(m, tgt);
    if (!m.sees) { m.cool = 0.12; return; }
    const side = mateInLane(m, tgt);
    if (side) {
      // step off your own man's firing line rather than put a ghost round
      // through him — battle.html measured one round in five doing exactly that
      const ddx = tgt.pos.x - m.pos.x, ddz = tgt.pos.z - m.pos.z;
      const dd = Math.hypot(ddx, ddz) || 1;
      const nx = ddx / dd, nz = ddz / dd, sg = -side;
      m.target.set(m.pos.x + nz * sg * 2.4, 0, m.pos.z - nx * sg * 2.4);
      m.slot = "sidestep"; m.stepAsideT = 0.55;
      m.cool = Math.max(m.cool, 0.18);
      return;
    }
    const w = CBZ.weaponById(m.wid);
    const r = CBZ.combatIQ && CBZ.combatIQ.shot
      ? CBZ.combatIQ.shot(m, tgt, dist, 0, w ? w.damage : 14) : null;
    if (!r) { m.cool = 0.5; return; }
    m.cool = r.cd;
    if (!r.fire) return;
    fireShot(m, tgt, r);
    if (m.mag <= 0) {
      m.reloadT = (w && (w.reloadTime || w.reload)) || 1.6;
    }
  }

  /* ============================================================ THE WARLORD
     A compact first-person/third-person controller, and it is deliberately NOT
     systems/fpsmode.js. That file is 4 400 lines of CITY player — it wants
     CBZ.game.state, the inventory, the wanted ladder, the HUD, the vehicle
     seams — and standing it up on a slice page would mean stubbing a game.
     What IS reused is every piece of it that is actually about a gun:
     weapon-data's numbers, actorweapons' viewmodel, gunfx's tracer/flash/
     impact, and the same hurtMan funnel every NPC round goes through. The only
     new code here is "where is the camera and did the ray hit anybody". */
  const CAMS = ["fps", "third", "cmd"];
  let camMode = "fps";
  let hurtFlash = 0;
  /* THE COMMAND SEAT'S DEFAULTS, and the first draft's were a satellite photo:
   120 m out at 0.55 rad puts the lens 62 m up, which draws a 1.8 m man as two
   pixels and fills the frame with sand. A commander's shot is LOW and near
   enough that the two lines read as lines — 62 m at 0.32 rad is about 19 m up,
   which keeps the horizon in frame and the men legible. */
const cmd = { x: 0, z: 0, dist: 62, yaw: 0.9, pitch: 0.32, auto: true };

  function stepYou(dt) {
    const IN = micro.input;
    const T = micro.touch;
    if (YOU.dead) return;
    if (YOU.reloadT > 0) { YOU.reloadT -= dt; if (YOU.reloadT <= 0) YOU.mag = YOU.magSize; }
    if (YOU.cool > 0) YOU.cool -= dt;

    // look — mouse, drag, or the right thumb; all three arrive as input.mx/mz
    if (IN && (camMode === "fps" || camMode === "third")) {
      YOU.yaw -= IN.mx * (IN.sensitivity || 0.0022);
      YOU.pitch = clamp(YOU.pitch - IN.mz * (IN.sensitivity || 0.0022), -1.2, 1.2);
    }

    if (camMode === "cmd") {
      // COMMAND CAMERA: the Bannerlord seat. It flies, it does not fight.
      const fwd = 60 * dt * (cmd.dist / 90 + 0.4);
      let mx = IN ? IN.axis("KeyA", "KeyD") : 0, mz = IN ? IN.axis("KeyS", "KeyW") : 0;
      if (T && T.active && T.stick.mag > 0.05) { mx += T.stick.x; mz += -T.stick.y; }
      if (mx || mz) {
        cmd.x += (-Math.sin(cmd.yaw) * mz - Math.cos(cmd.yaw) * mx) * fwd;
        cmd.z += (-Math.cos(cmd.yaw) * mz + Math.sin(cmd.yaw) * mx) * fwd;
      }
      if (IN) {
        cmd.yaw -= IN.mx * 0.004;
        cmd.pitch = clamp(cmd.pitch - IN.mz * 0.003, 0.16, 1.4);
        if (IN.wheel) { cmd.auto = false; cmd.dist = clamp(cmd.dist * (IN.wheel > 0 ? 1.12 : 0.9), 24, 320); }
      }
      YOU.speed = 0;
      return;
    }

    // walk
    let mx = IN ? IN.axis("KeyA", "KeyD") : 0, mz = IN ? IN.axis("KeyS", "KeyW") : 0;
    if (T && T.active && T.stick.mag > 0.05) { mx = T.stick.x; mz = -T.stick.y; }
    const sprint = (IN && IN.isDown("ShiftLeft")) || (T && T.stick.rim);
    const base = (sprint ? 7.4 : 4.8) * (1 - W.armour(W.state.you.armour).slow);
    const len = Math.hypot(mx, mz);
    if (len > 0.01) {
      const s = base / Math.max(1, len);
      const sy = Math.sin(YOU.yaw), cy = Math.cos(YOU.yaw);
      YOU.pos.x += (sy * mz + cy * mx) * s * dt;
      YOU.pos.z += (cy * mz - sy * mx) * s * dt;
      micro.resolveCircle(YOU.pos, 0.45, YOU.pos.y, 1.8);
      YOU.speed = base * Math.min(1, len);
    } else YOU.speed = 0;
    YOU.pos.y = MAP.groundAt(YOU.pos.x, YOU.pos.z);
    if (youRig) youRig.rotation.y = YOU.yaw;

    // trigger — held mouse, the touch FIRE latch, or SPACE
    const firing = (IN && (IN.buttons[0] || IN.isDown("Space"))) || touchFire;
    if (firing && YOU.cool <= 0 && YOU.reloadT <= 0) playerShoot();
    if (IN && IN.pressed("KeyR") && YOU.mag < YOU.magSize) reloadYou();
    if (YOU.mag <= 0 && YOU.reloadT <= 0) reloadYou();
  }
  let touchFire = false;
  function reloadYou() {
    const w = CBZ.weaponById(YOU.wid);
    YOU.reloadT = (w && (w.reloadTime || w.reload)) || 1.4;
  }

  const _ray = { o: null, d: null };
  function playerShoot() {
    const w = CBZ.weaponById(YOU.wid) || {};
    YOU.cool = w.fireDelay || w.interval || 0.2;
    YOU.mag--;
    SIDES.mine.shots++;
    const cam = CBZ.camera;
    _ray.o = _ray.o || V(); _ray.d = _ray.d || V();
    _ray.o.copy(cam.position);
    cam.getWorldDirection(_ray.d);
    /* AIM ASSIST, AND IT IS A CONE, NOT A MAGNET. A thumb on glass cannot hold
       a 0.5° hold at 60 m and the brief asks for a game that plays on touch, so
       the ray snaps to the nearest enemy inside a small cone — 2.2° on a
       mouse, 5° on a coarse pointer, and nothing at all outside the cone.
       Range is the gun's own listed range, so a pistol still cannot reach. */
    const cone = Math.cos((ctx.coarse ? 5 : 2.2) * Math.PI / 180);
    const range = w.range || 80;
    let best = null, bestD = 1e9;
    for (let i = 0; i < men.length; i++) {
      const o = men[i];
      if (o.dead || o.fled || o.team === "mine") continue;
      const ox = o.pos.x - _ray.o.x, oy = (o.pos.y + o.aimY) - _ray.o.y, oz = o.pos.z - _ray.o.z;
      const d = Math.hypot(ox, oy, oz);
      if (d > range || d < 0.5) continue;
      const dot = (ox * _ray.d.x + oy * _ray.d.y + oz * _ray.d.z) / d;
      if (dot < cone) continue;
      if (d < bestD) { bestD = d; best = o; }
    }
    let hitPoint = null;
    if (best) {
      // and the round still has to get there: sand and rocks are not optional
      const ay = _ray.o.y, by = best.pos.y + best.aimY;
      if (micro.segmentBlocked(_ray.o.x, ay, _ray.o.z, best.pos.x, by, best.pos.z) ||
          (MAP.terrainLos && terrainBlocked(_ray.o.x, ay, _ray.o.z, best.pos.x, by, best.pos.z))) best = null;
    }
    if (best) {
      hitPoint = _v.set(best.pos.x, best.pos.y + best.aimY, best.pos.z);
    } else {
      hitPoint = _v.copy(_ray.o).addScaledVector(_ray.d, range);
      const g = MAP.groundAt(hitPoint.x, hitPoint.z);
      if (hitPoint.y < g) hitPoint.y = g;
    }
    const from = _muz.copy(cam.position).addScaledVector(_ray.d, 0.9);
    from.y -= 0.12;
    CBZ.tracer(from, hitPoint, { shooter: YOU, targetActor: best || null, muzzle: true,
      muzzleScale: (w.flash ? 0.5 + w.flash : 0.9) });
    if (w.sfx) safe(function () { CBZ.sfx(w.sfx, { dist: 2, volume: (w.sfxVol || 1) * 0.55, pitch: w.sfxPitch || 1 }); });
    CBZ.shake && CBZ.shake(Math.min(0.6, (w.shake || 0.3) * 0.5));
    if (best) {
      SIDES.mine.hits++;
      /* THE WARLORD'S OWN ROUND IS THE WEAPON'S OWN DAMAGE, raw. He is not an
         NPC and combat_iq's derived-damage ladder is a model of NPC competence,
         not of a player's trigger finger — routing his shots through it would
         hand the player an accuracy roll he already made with his own hand. */
      hurtMan(best, (w.damage || 24) * (w.pellets || 1) * 0.55, { by: YOU, raw: true });
      if (CBZ.bodyWound) safe(function () { CBZ.bodyWound(best, hitPoint, {}); });
    } else {
      CBZ.bulletImpact(hitPoint, { x: 0, y: 1, z: 0 }, { kind: "dust", power: 0.7 });
    }
    // and being shot at is information the other side acts on
    if (best && CBZ.combatIQ && CBZ.combatIQ.suppress) CBZ.combatIQ.suppress(best, 1.1);
  }

  /* ============================================================ CAMERA */
  function camDist2(p) {
    const c = CBZ.camera.position;
    return (p.x - c.x) * (p.x - c.x) + (p.y - c.y) * (p.y - c.y) + (p.z - c.z) * (p.z - c.z);
  }
  function stepCamera(dt) {
    const c = CBZ.camera;
    if (camMode === "cmd") {
      /* THE COMMAND SEAT FOLLOWS THE FIGHT — and "the fight" is not the
         midpoint of the two masses. MEASURED on the first before/after pair:
         at t=11 the two lines were still 160 m apart, the midpoint was empty
         sand, and both armies sat 80 m off either side of the lens as a
         fifteen-pixel smudge. The midpoint is the right answer once they are
         IN contact and the wrong one for every second before that.

         So the focus is the midpoint and the RANGE is the spread: far enough
         back to hold both masses, never so far that a 1.8 m man stops being a
         man. `autoDist` is only used when nobody has set a distance by hand —
         a person driving the wheel keeps what they chose. */
      const fx = (SIDES.mine.comX + SIDES.them.comX) * 0.5;
      const fz = (SIDES.mine.comZ + SIDES.them.comZ) * 0.5;
      if (!cmd.init) { cmd.x = fx; cmd.z = fz; cmd.init = 1; }
      if (cmd.auto) {
        const sep = Math.hypot(SIDES.mine.comX - SIDES.them.comX, SIDES.mine.comZ - SIDES.them.comZ);
        cmd.dist = clamp(34 + sep * 0.62, 40, 210);
      }
      const k = 1 - Math.pow(0.06, dt);
      cmd.x += (fx - cmd.x) * k * 0.5;
      cmd.z += (fz - cmd.z) * k * 0.5;
      const fy = MAP.groundAt(cmd.x, cmd.z);
      const sx = Math.sin(cmd.yaw) * Math.cos(cmd.pitch), sz = Math.cos(cmd.yaw) * Math.cos(cmd.pitch);
      const sy = Math.sin(cmd.pitch);
      const px = cmd.x + sx * cmd.dist, pz = cmd.z + sz * cmd.dist;
      let py = fy + sy * cmd.dist;
      const g = MAP.groundAt(px, pz) + 3;
      if (py < g) py = g;
      c.position.set(px, py, pz);
      c.lookAt(cmd.x, fy + 1.2, cmd.z);
      if (viewGun) viewGun.visible = false;
      if (youRig) youRig.visible = true;
      return;
    }
    const eye = YOU.pos.y + YOU.eyeH;
    const dir = new THREE.Vector3(Math.sin(YOU.yaw) * Math.cos(YOU.pitch), Math.sin(YOU.pitch),
                                  Math.cos(YOU.yaw) * Math.cos(YOU.pitch));
    if (camMode === "fps") {
      c.position.set(YOU.pos.x, eye, YOU.pos.z);
      c.lookAt(YOU.pos.x + dir.x, eye + dir.y, YOU.pos.z + dir.z);
      if (youRig) youRig.visible = false;
      if (viewGun) viewGun.visible = true;
    } else {
      /* OVER THE SHOULDER, NOT BEHIND THE HEAD. The first draft put the lens
         on the man's own bearing at 4.6 m and he filled the middle of the
         frame — measured on a capture where a charging army 100 m up the field
         was entirely behind his torso. A shoulder camera is offset SIDEWAYS so
         the body sits in a corner and the fight owns the frame; the offset is
         the rig's own shoulder width plus a body, not a number. */
      const back = 5.4, up = 1.35, side = 1.05;
      const rx = Math.cos(YOU.yaw), rz = -Math.sin(YOU.yaw);   // the man's right
      let px = YOU.pos.x - dir.x * back + rx * side;
      let pz = YOU.pos.z - dir.z * back + rz * side;
      let py = eye + up - dir.y * back;
      const g = MAP.groundAt(px, pz) + 1.2;
      if (py < g) py = g;
      c.position.set(px, py, pz);
      c.lookAt(YOU.pos.x + dir.x * 14 + rx * side, eye + dir.y * 14, YOU.pos.z + dir.z * 14 + rz * side);
      if (youRig) youRig.visible = true;
      if (viewGun) viewGun.visible = false;
    }
  }
  function setCam(mode) {
    camMode = mode;
    /* AND THE LENS MOVES NOW, NOT NEXT FRAME. stepCamera() is what actually
       places the camera and it only runs inside frame() — so a tool that
       switches to first person and renders immediately (which is exactly what
       a screenshot preset does) photographed the PREVIOUS seat. MEASURED: the
       subject captioned "CHARGE, from inside the line" came back as a wide
       command shot with no viewmodel in it. One framing pass here costs
       nothing and removes the whole class of stale-camera capture. */
    if (live && MAP && YOU) safe(function () { stepCamera(0.016); });
    const b = document.getElementById("wbCam");
    if (b) b.textContent = mode === "fps" ? "FIRST PERSON" : mode === "third" ? "OVER SHOULDER" : "COMMAND";
    if (mode !== "cmd" && micro.lock && !ctx.coarse) micro.lock();
  }
  function cycleCam() { setCam(CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length]); }

  /* ============================================================ THE HUD
     Four orders, a retreat, two morale bars and the two things a man in a
     firefight actually needs: how hurt he is and how many rounds are left.
     Built in code and REMOVED on teardown — the page's #stage belongs to the
     screens, and a battle is not a screen. */
  function buildHud() {
    const css = document.createElement("style");
    css.id = "wbCss";
    css.textContent =
      "#wb{position:fixed;inset:0;z-index:45;pointer-events:none;font:600 13px/1.3 ui-sans-serif,system-ui,sans-serif;color:#f4ecd8}" +
      "#wb .bar{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 8px);transform:translateX(-50%);" +
        "display:flex;gap:10px;align-items:center;padding:7px 13px;border-radius:999px;white-space:nowrap;" +
        "background:rgba(12,10,7,.62);border:1px solid rgba(255,255,255,.13);backdrop-filter:blur(6px)}" +
      "#wb .cnt{font-weight:800;font-size:15px}" +
      "#wb .mo{width:min(19vw,120px);height:7px;border-radius:4px;background:rgba(255,255,255,.15);overflow:hidden}" +
      "#wb .mo s{display:block;height:100%;transition:width .25s}" +
      "#wb .mid{font-size:10px;letter-spacing:.2em;opacity:.65;text-align:center;min-width:74px}" +
      "#wb .ord{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 10px);transform:translateX(-50%);" +
        "display:flex;gap:7px;pointer-events:auto;flex-wrap:wrap;justify-content:center;max-width:96vw}" +
      "#wb .ord button{appearance:none;border:1px solid rgba(255,255,255,.2);background:rgba(12,10,7,.66);" +
        "color:inherit;border-radius:12px;padding:11px 14px;font:800 12px/1 inherit;letter-spacing:.1em;cursor:pointer;" +
        "backdrop-filter:blur(6px)}" +
      "#wb .ord button.on{background:rgba(255,138,61,.34);border-color:#ff8a3d}" +
      "#wb .ord button.bad{border-color:#c4453a}" +
      "body.coarse #wb .ord button{padding:15px 17px;font-size:13px}" +
      "#wb .me{position:absolute;left:calc(env(safe-area-inset-left,0px) + 14px);bottom:calc(env(safe-area-inset-bottom,0px) + 74px);" +
        "padding:9px 12px;border-radius:12px;background:rgba(12,10,7,.55);border:1px solid rgba(255,255,255,.12)}" +
      "#wb .hp{width:132px;height:5px;border-radius:3px;background:rgba(255,255,255,.16);margin:6px 0 6px;overflow:hidden}" +
      "#wb .hp s{display:block;height:100%;background:#5aa86a}" +
      "#wb .ammo{font-variant-numeric:tabular-nums;letter-spacing:.14em;font-size:12px;opacity:.85}" +
      "#wb .feed{position:absolute;right:calc(env(safe-area-inset-right,0px) + 14px);top:calc(env(safe-area-inset-top,0px) + 58px);" +
        "text-align:right;font-size:11px;letter-spacing:.12em;opacity:.8}" +
      "#wb .feed p{margin:0 0 3px}" +
      "#wb .ret{position:absolute;right:calc(env(safe-area-inset-right,0px) + 14px);bottom:calc(env(safe-area-inset-bottom,0px) + 74px);pointer-events:auto}" +
      "#wb .fire{position:absolute;right:calc(env(safe-area-inset-right,0px) + 20px);bottom:calc(env(safe-area-inset-bottom,0px) + 130px);" +
        "width:86px;height:86px;border-radius:50%;background:rgba(196,69,58,.42);border:2px solid rgba(255,255,255,.28);" +
        "pointer-events:auto;display:none;align-items:center;justify-content:center;font:800 13px/1 inherit;letter-spacing:.1em}" +
      "body.coarse #wb .fire{display:flex}" +
      "#wb .ret button{appearance:none;border:1px solid #c4453a;background:rgba(12,10,7,.66);color:#ffc9c4;" +
        "border-radius:12px;padding:10px 13px;font:700 11px/1 inherit;letter-spacing:.14em;cursor:pointer}" +
      "#wb .cross{position:absolute;left:50%;top:50%;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;border-radius:50%;" +
        "background:rgba(255,255,255,.85);box-shadow:0 0 0 1px rgba(0,0,0,.6)}" +
      "#wb .hit{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 50%,transparent 45%,rgba(196,69,58,.55));opacity:0}" +
      "#wb .note{position:absolute;left:50%;top:20%;transform:translateX(-50%);font-size:clamp(16px,4.4vw,30px);" +
        "letter-spacing:.12em;opacity:0;transition:opacity .35s;text-shadow:0 2px 12px #000;white-space:nowrap}" +
      "#wb .note.on{opacity:.95}" +
      "#wb .cap{position:absolute;left:50%;top:calc(env(safe-area-inset-top,0px) + 44px);transform:translateX(-50%);" +
        "font-size:10px;letter-spacing:.16em;opacity:.55;white-space:nowrap}";
    document.head.appendChild(css);

    const root = document.createElement("div");
    root.id = "wb";
    root.innerHTML =
      '<div class="bar">' +
        '<span class="cnt" id="wbMine" style="color:#ffb347">0</span>' +
        '<span class="mo"><s id="wbMineMo" style="background:#ffb347;width:100%"></s></span>' +
        '<span class="mid"><span id="wbClock">0:00</span><br><span id="wbOrd">HOLD</span></span>' +
        '<span class="mo"><s id="wbThemMo" style="background:#c4593a;width:100%"></s></span>' +
        '<span class="cnt" id="wbThem" style="color:#e08a6a">0</span>' +
      '</div>' +
      '<div class="cap" id="wbCap"></div>' +
      '<div class="feed" id="wbFeed"></div>' +
      '<div class="me"><div id="wbName">WARLORD</div><div class="hp"><s id="wbHp"></s></div>' +
        '<div class="ammo" id="wbAmmo"></div></div>' +
      '<div class="ret"><button id="wbRetreat">RETREAT</button></div>' +
      '<div class="fire" id="wbFire">FIRE</div>' +
      '<div class="ord">' +
        '<button data-o="charge">1 CHARGE</button>' +
        '<button data-o="hold" class="on">2 HOLD</button>' +
        '<button data-o="flank">3 FLANK</button>' +
        '<button data-o="fallback">4 FALL BACK</button>' +
        '<button id="wbCam">FIRST PERSON</button>' +
      '</div>' +
      '<div class="cross" id="wbCross"></div>' +
      '<div class="hit" id="wbHit"></div>' +
      '<div class="note" id="wbNote"></div>';
    document.body.appendChild(root);
    hud = root;

    root.querySelectorAll("[data-o]").forEach(function (b) {
      b.addEventListener("click", function (e) { e.stopPropagation(); setOrder(b.dataset.o, "mine"); });
    });
    document.getElementById("wbCam").addEventListener("click", function (e) { e.stopPropagation(); cycleCam(); });
    document.getElementById("wbRetreat").addEventListener("click", function (e) {
      e.stopPropagation(); endBattle("retreat", "YOU BREAK OFF");
    });
    const fb = document.getElementById("wbFire");
    fb.addEventListener("pointerdown", function (e) { e.stopPropagation(); touchFire = true; });
    fb.addEventListener("pointerup", function () { touchFire = false; });
    fb.addEventListener("pointercancel", function () { touchFire = false; });
    if (ctx.coarse && micro.touch && micro.touch.init) safe(function () { micro.touch.init(); });
  }
  function paintOrders() {
    if (!hud) return;
    const o = orderOf(SIDES.mine);
    hud.querySelectorAll("[data-o]").forEach(function (b) { b.classList.toggle("on", b.dataset.o === o); });
    const el = document.getElementById("wbOrd");
    if (el) el.textContent = ORDER_LABEL[o];
  }
  function feed(line) {
    const f = document.getElementById("wbFeed");
    if (!f) return;
    const p = document.createElement("p");
    p.textContent = line;
    f.insertBefore(p, f.firstChild);
    while (f.childNodes.length > 5) f.removeChild(f.lastChild);
    setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 5000);
  }
  let noteT = 0;
  function note(txt) {
    const n = document.getElementById("wbNote");
    if (!n) return;
    n.textContent = txt;
    n.classList.add("on");
    noteT = 2.6;
  }
  let uiT = 0;
  function paintHud(dt) {
    const h = document.getElementById("wbHit");
    if (h) { hurtFlash = Math.max(0, hurtFlash - dt * 1.6); h.style.opacity = hurtFlash.toFixed(2); }
    if (noteT > 0 && (noteT -= dt) <= 0) {
      const n = document.getElementById("wbNote"); if (n) n.classList.remove("on");
    }
    const cr = document.getElementById("wbCross");
    if (cr) cr.style.display = camMode === "fps" ? "block" : "none";
    uiT -= dt;
    if (uiT > 0) return;
    uiT = 0.2;
    const M = SIDES.mine, Tm = SIDES.them;
    setText("wbMine", M.alive + (YOU.dead ? "" : "+1"));
    setText("wbThem", Tm.alive);
    setW("wbMineMo", M.morale);
    setW("wbThemMo", Tm.morale);
    /* THE CLOCK COUNTS DOWN WHEN IT MATTERS. A ceiling nobody can see is a
       battle that ends for no reason the player can name; inside the last
       forty seconds it stops being a stopwatch and starts being a deadline. */
    const leftT = BATTLE_MAX() - simT;
    const cel = document.getElementById("wbClock");
    if (cel) {
      if (leftT < 40) {
        cel.textContent = "-0:" + String(Math.max(0, Math.floor(leftT))).padStart(2, "0");
        cel.style.color = leftT < 15 ? "#ff8a3d" : "";
      } else {
        cel.textContent = Math.floor(simT / 60) + ":" + String(Math.floor(simT % 60)).padStart(2, "0");
        cel.style.color = "";
      }
    }
    setW2("wbHp", clamp(YOU.hp / YOU.maxHp, 0, 1));
    setText("wbAmmo", YOU.reloadT > 0 ? "RELOADING" : YOU.mag + " / " + YOU.magSize +
      "   " + W.gunLabel(YOU.wid) + "   " + YOU.kills + " KILLS");
    setText("wbName", W.state.you.name + (YOU.dead ? " — DOWN" : ""));
  }
  function setText(id, t) { const e = document.getElementById(id); if (e && e.textContent !== String(t)) e.textContent = t; }
  function setW(id, f) { const e = document.getElementById(id); if (e) e.style.width = Math.round(clamp(f, 0, 1) * 100) + "%"; }
  function setW2(id, f) {
    const e = document.getElementById(id);
    if (!e) return;
    e.style.width = Math.round(clamp(f, 0, 1) * 100) + "%";
    e.style.background = f > 0.55 ? "#5aa86a" : f > 0.28 ? "#e2c14a" : "#c4453a";
  }

  /* ============================================================ START */
  function start(opts) {
    if (live) return;
    opts = opts || {};
    startOpts = opts;
    band = opts.band || W.makeBand({ size: 20 });
    THREE = G.THREE;
    scene = CBZ.scene; micro = CBZ.micro;
    _v = V(); _v2 = V(); _muz = V();
    seedBattle((W.state.seed | 0) * 7919 + (W.state.day | 0) * 131 + (band.men.length | 0));

    simT = 0; over = false; started = false; live = true; lastWall = 0;
    men = []; corpses = []; sinking = []; dropGuns = []; addedCols = []; addedMeshes = [];
    _claim.length = 0; deadSolving = 0; hurtFlash = 0; touchFire = false;
    cmd.init = 0;

    /* THE DEAD FELL LIKE PLANKS AND THE PAGE THOUGHT IT HAD FIXED THAT.
       warlord.html declares `if (C.RAGDOLL_ANY_MODE == null) C.RAGDOLL_ANY_MODE
       = true` inside start(), i.e. AFTER studio.need() has already loaded
       city/ragdoll.js — which defaults the flag to false on the way in. So the
       `== null` guard never fires and every corpse in this game took the canned
       single-axis topple: MEASURED, `solving: 0` across a whole 78-second
       battle with ten deaths in it. (battle.html declares its version BEFORE
       need() for exactly this reason; the ordering is the entire difference.)

       Set here, unconditionally, because this is the file that wants ragdoll
       corpses and it runs at battle time — long after any load order can bite.
       A ?cfg_ override still wins, so the flag stays revertible. */
    if (!Q || Q.get("cfg_RAGDOLL_ANY_MODE") == null) CBZ.CONFIG.RAGDOLL_ANY_MODE = true;

    W.setPhase("battle", { band: band });

    const cx = (W.state.you.x || 0), cz = (W.state.you.z || 0);
    MAP = buildGround(cx, cz);
    CBZ.groundAt = MAP.groundAt;      // the name city code asks the ground by

    /* THE AIR IS THE PLACE. The campaign's haze is authored for a 14 km island
       seen from 60 m up; a 340 m fight inside it has no depth at all and its
       flat skirt runs to a hard rim. Save the numbers, set battle-scale fog,
       restore on teardown — a change to the shared scene that this file owns
       and therefore this file returns. */
    if (scene.fog) {
      fogSave = { hex: scene.fog.color.getHex(), near: scene.fog.near, far: scene.fog.far };
      /* 420/2900: the near edge has to sit BEYOND the far end of the
         battlefield (170 m) or the enemy line photographs as haze — the first
         capture at 190/1500 washed a firing line 168 m away into the sky. Far
         enough out that the flat skirt still goes to nothing. */
      scene.fog.color.setHex(0xd8c49a);
      scene.fog.near = 420; scene.fog.far = 2900;
    }

    SIDES.mine = makeSide("mine", -1, 0xffb347, 0);
    SIDES.them = makeSide("them", 1, band.colour || 0xc4593a, 1);
    SIDES.mine.order = "hold";
    SIDES.them.order = "hold";

    // ---- the rosters. THE CAP, and it is stated on screen.
    const cap = Math.max(1, parseInt((Q && Q.get("men")) || "", 10) || MEN_CAP_DEFAULT);
    const mine = W.state.army.slice(0, cap);
    const theirs = band.men.slice(0, cap);
    capped.mine = W.state.army.length - mine.length;
    capped.them = band.men.length - theirs.length;

    report = {
      band: band, outcome: null, duration: 0, youKills: 0,
      deadOf: { mine: [], them: [] }, fledOf: { mine: [], them: [] },
      reserveOf: { mine: W.state.army.slice(mine.length), them: band.men.slice(theirs.length) },
    };

    for (let i = 0; i < mine.length; i++) { const m = makeMan("mine", mine[i], i); if (m) men.push(m); }
    for (let i = 0; i < theirs.length; i++) { const m = makeMan("them", theirs[i], i); if (m) men.push(m); }

    YOU = makeYou();
    men.push(YOU);

    SIDES.mine.men0 = mine.slice();
    SIDES.them.men0 = theirs.slice();
    SIDES.mine.power0 = W.power(mine) + 14;     // +14: the warlord is worth a man
    SIDES.them.power0 = W.power(theirs);
    report.ratio = SIDES.mine.power0 / Math.max(0.001, SIDES.them.power0);

    /* A DEMAND THAT FAILED COSTS MORALE, and this is where it lands. Being
       laughed at and then charged is worth about the same as losing an eighth
       of your power before a shot is fired — enough that the odds on the card
       were not a lie about the fight you are now in. */
    SIDES.mine.moraleMalus = opts.surprised ? 0.2 : (opts.chased ? 0.1 : 0);

    updateCOM();
    updateMorale();

    // shadows pay twice; a big battle buys frames with the sun (battle.html's
    // own rule, at its own threshold)
    const R = CBZ.renderer || (micro && micro.renderer);
    if (R && R.shadowMap) {
      shadowSave = R.shadowMap.enabled;
      if (men.length > 170) R.shadowMap.enabled = false;
    }

    buildHud();
    setCam(ctx.coarse ? "third" : "fps");
    buildViewGun();
    paintOrders();
    const capNote = (capped.mine + capped.them) > 0
      ? (capped.mine + capped.them) + " MEN HELD WITH THE BAGGAGE — FIELD CAP " + cap + " A SIDE (?men=N)"
      : "";
    setText("wbCap", capNote);
    note(W.armySize() + " V " + band.men.length + "  ·  " + (band.name || "").toUpperCase());

    started = true;
    frameFn = micro.onFrame(frame);
    /* ?frozen=1 — THE BATTLE BEGINS STOPPED. A tool that drives this fight
       through freeze()/advance() cannot freeze it before it exists, so between
       start() and the tool's first poll an unknown number of real frames run —
       MEASURED on the first before/after pair, one side had already taken a
       casualty at the beat the other was still at full strength, which makes a
       controlled A/B impossible. Beginning stopped removes the window
       entirely: both sides start at simT 0 and every simulated second after
       that is one somebody asked for. */
    if (Q && Q.get("frozen") === "1" && micro.stop) micro.stop();
    // a person who clicks the world wants to be IN it
    document.addEventListener("pointerdown", onWorldPointer);
    W.on("phase:leave:battle", teardown);
  }
  function onWorldPointer(e) {
    if (!live || over) return;
    if (e.target && e.target.closest && e.target.closest("#wb .ord,#wb .ret,#wb .fire")) return;
    if (camMode !== "cmd" && micro.lock && !ctx.coarse) micro.lock();
  }
  function makeSide(key, dir, colour, vseed) {
    return {
      key: key, dir: dir, colour: colour, vseed: vseed, squads: [],
      order: "hold", morale: 1, alive: 0, routing: 0, deadN: 0, brokeN: 0,
      kills: 0, shots: 0, hits: 0, power0: 1, powerNow: 1,
      comX: 0, comZ: 0, anchorX: 0, anchorZ: 0, moraleMalus: 0,
      wingBias: key === "mine" ? 0 : 1,
    };
  }
  function buildViewGun() {
    if (!CBZ.buildActorWeapon) return;
    viewGun = safe(function () { return CBZ.buildActorWeapon(W.state.you.wid); });
    if (!viewGun) return;
    /* THE VIEWMODEL IS THE SAME GUN THE NPCs CARRY — actorweapons' own model,
       at actorweapons' own real-dimension scale, parented to the lens. There is
       no second "player gun" geometry in this game and there must not be, or
       the rifle in your hands and the rifle you loot stop being one object.

       AND THE HAND POSE HAS TO COME OFF IT. buildActorWeapon leaves the model
       at rotation (+π/2, π, 0) and offset (0.02,0.02,0.03), which is a pose
       relative to a FOREARM — actorweapons' own comment says so. Parented
       straight to the lens that reads as a rifle lying sideways across the
       screen: measured on the first capture, an AK filled the bottom-right
       quarter of a 1180x700 frame. The appearance factories author their
       muzzle down -Z (see fallbackWeapon's userData.muzzle), which is already
       the camera's forward, so the right pose here is no rotation at all —
       just down and to the right, and far enough back that a 0.88 m rifle
       reads as a rifle at a 70-degree field of view. */
    viewGun.position.set(0.17, -0.20, -0.62);
    viewGun.rotation.set(0.03, 0.02, 0);
    viewGun.scale.multiplyScalar(0.9);
    CBZ.camera.add(viewGun);
    if (!CBZ.camera.parent) scene.add(CBZ.camera);   // r128: children of a
    // detached camera are never traversed by the renderer
  }

  function updateCOM() {
    ["mine", "them"].forEach(function (k) {
      const s = SIDES[k];
      let x = 0, z = 0, n = 0;
      for (let i = 0; i < men.length; i++) {
        const m = men[i];
        if (m.team !== k || m.dead || m.fled) continue;
        x += m.pos.x; z += m.pos.z; n++;
      }
      if (n) { s.comX = x / n; s.comZ = z / n; }
      else { s.comX = MAP.cx + s.dir * 60; s.comZ = MAP.cz; }
      if (!s.anchorSet) { s.anchorX = s.comX; s.anchorZ = s.comZ; s.anchorSet = 1; }
    });
  }

  /* ============================================================ FRAME */
  let comAt = -1, moraleAt = -1, cmdAt = -1, endAt = -1;
  /* ============================================================ THE LIGHT
     THE SAND WAS RENDERING AS PAPER, and battle.html wrote down why before this
     file existed: "the sun came down from 0.98: at that level the sand's own
     vertex colours clipped to white and the whole erg rendered as a sheet of
     paper". warlord.html's campaign light is HOTTER than the one that did that
     — sun 1.12, and a pale blue hemisphere fill on tan sand, which desaturates
     it on top. MEASURED on the first before/after pair: a battlefield with
     10.2 m of measured relief in it photographed as a flat wash with no crest,
     no trough and no shadow anywhere in the frame.

     THE RESTORE IS FREE, AND THAT IS WHY IT IS DONE THIS WAY. microboot's
     lights() registers an onAlways(9) hook that rewrites sun.intensity,
     hemi.intensity and both hemisphere colours to their captured base EVERY
     frame — it has to, because daynight.js's consumers multiply them. always-
     hooks run before frame-hooks (see microboot's tick and stepSim: both run
     CBZ.always, then frameHooks), so a battle that writes its own numbers at
     the top of its own frame gets exactly one frame of them and hands the
     campaign's light straight back the moment the battle stops running. No
     second light rig, no teardown to forget.

     The numbers are battle.html's own dunes venue: sun 0.84, hemi 0.42, and a
     WARM sky colour, because bounce off sand is warm and lighting an erg with a
     blue fill is what turns tan into grey. */
  function battleLight() {
    const sun = micro.sun, hemi = micro.hemiLight;
    if (sun) sun.intensity = 0.84;
    if (hemi) {
      hemi.intensity = 0.42;
      hemi.color.setHex(0xcfc2a4);
      hemi.groundColor.setHex(0x8f7850);
    }
  }

  let lastWall = 0;
  function frame(dt) {
    if (!started || !live) return;
    battleLight();
    /* THE SIM CLOCK IS WALL TIME, NOT RENDER TIME — battle.html's finding, and
       it is not a nicety. microboot clamps the dt it hands a frame hook for
       animation stability, so on a machine that is struggling the battle
       quietly runs in slow motion: MEASURED here on the software rasteriser at
       53 bodies, thirty real seconds bought eleven simulated ones. A fight
       that takes three times as long on a slow phone is a different game on a
       slow phone. The sub-steps below keep the integration solid however long
       the frame took. */
    const wall = performance.now();
    dt = lastWall ? Math.min(0.25, (wall - lastWall) / 1000) : dt;
    lastWall = wall;
    if (injectDt > 0) { dt = injectDt; lastWall = 0; injectDt = 0; }
    fxBudget = 0;

    if (!over) {
      const sub = Math.min(6, Math.max(1, Math.ceil(dt / 0.055)));
      const sdt = Math.min(0.055, dt / sub);
      for (let s = 0; s < sub; s++) {
        simT += sdt;
        CBZ.now += sdt * 1000;             // combat_iq's clocks follow this one
        if (simT - gridAt > 0.35) rebuildGrid();
        if (simT - comAt > 0.6) { updateCOM(); comAt = simT; }
        if (simT - moraleAt > 0.5) { updateMorale(); moraleAt = simT; }
        if (simT - cmdAt > 6) { enemyCommand(); cmdAt = simT; }
        for (let i = 0; i < men.length; i++) stepMan(men[i], sdt);
        stepYou(sdt);
        if (deadSolving > 0 && CBZ.ragdollStep) CBZ.ragdollStep(sdt);
        rebuildFine();
        separateSolve(Math.min(0.9, sdt * 26));
      }
    }

    if (sinking.length) stepSinking(dt);

    // ---- render-side: gait, aim pose, camera
    const camP = CBZ.camera.position;
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (m.fled || m.retired) continue;
      if (m.dead && !m.isYou) continue;
      const d2 = (m.pos.x - camP.x) * (m.pos.x - camP.x) + (m.pos.z - camP.z) * (m.pos.z - camP.z);
      m.animF = ((m.animF || 0) + 1) & 1023;
      const every = d2 < 70 * 70 ? 1 : d2 < 150 * 150 ? 2 : 4;
      if ((m.animF % every) === 0 && CBZ.animChar && m.char) {
        // A MAN IN COVER GETS SMALL — the rig's own flag, which nothing on
        // battle.html set until it was noticed that combat_iq could send a man
        // to real cover and he would stand up straight behind it.
        m.char.crouch = m.slot === "cover" || m.slot === "peek";
        safe(function () { CBZ.animChar(m.char, m.speed, dt * every); });
      }
      if (m.isYou) {
        /* THE WARLORD'S BODY POINTS WHERE HIS LENS POINTS. actorAimAt lays the
           weapon arm on a TARGET, and the player has no target — he has a
           bearing. So the rig takes the look direction directly; anything else
           is a man walking forward with his rifle aimed somewhere else. */
        if (youRig) youRig.rotation.y = m.yaw;
        if (m.char) m.char.aimPitch = m.pitch;
        continue;
      }
      const engaged = m.tgt && !m.tgt.dead && m.sees && !m.routed;
      if (engaged && d2 < 190 * 190 && CBZ.actorAimAt) {
        CBZ.actorAimAt(m, m.tgt, dt);
        m.yaw = m.group.rotation.y;
      }
      if (m._weaponProp) {
        const show = d2 < 130 * 130;
        if (m._weaponProp.visible !== show) m._weaponProp.visible = show;
      }
    }
    stepCamera(dt);
    paintHud(dt);

    if (!over) {
      endAt -= dt;
      if (endAt <= 0) { endAt = 0.4; checkEnd(); }
      // THE CEILING. See BATTLE_MAX: at the cap the remainder is resolved
      // through the SAME attrition tick rather than simply cut off.
      if (!over && simT > BATTLE_MAX()) finishOnTheClock();
    }
  }

  /* ============================================================ THE END
     THREE WAYS A BATTLE ENDS, and two of them are morale.
       · nobody left standing on one side (the arithmetic ending)
       · a side is BROKEN — three quarters of it routing or already off the
         field. A routing army loses; it does not get to be ground down to the
         last levy first, because that is not what happens and because a player
         who has already won should not have to spend ninety seconds proving it.
       · you go down, or you press RETREAT. */
  /* AN ARMY IS BROKEN WHEN NOBODY IS STILL FIGHTING, and the first draft of
     this measured the wrong thing entirely.

     It asked whether three quarters of the side was routing OR already off the
     map — and routed men LEAVE the count as they die or reach the edge, so on
     a measured 26 v 26 the enemy hit "18 alive, 18 of them routing, nobody
     fighting" at t=45 and the flag stayed FALSE. The battle then ran another
     thirty-three seconds while every one of those eighteen jogged to the
     baseline and escaped, and the aftermath screen offered ZERO PRISONERS.
     That is not a tuning miss; it deleted a mechanic. A broken army is one
     with nothing left shooting, and the men standing on the field when that
     happens are exactly the men you capture — which is also the tension the
     four orders are for: end it fast and take prisoners, or let it run and
     watch them get away. */
  const broken = brokenSide;      // one rule, one function — see brokenSide
  function checkEnd() {
    const M = SIDES.mine, T = SIDES.them;
    if (T.alive === 0 || broken(T, report.fledOf.them.length)) {
      endBattle("won", T.alive ? "THEY BREAK" : "THE FIELD IS YOURS");
      return;
    }
    /* A LONE WARLORD IS NOT A BROKEN ARMY. `alive` counts your MEN, not you,
       so day one — one man and a pistol against six bandits, which is the
       game's own opening pitch — used to register as an instant defeat before
       the first shot. If you brought nobody, only YOUR death ends it. */
    if (!M.men0.length) return;
    if ((M.alive === 0 && !report.reserveOf.mine.length) || broken(M, report.fledOf.mine.length)) {
      endBattle("lost", M.alive ? "YOUR ARMY BREAKS" : "YOUR ARMY IS GONE");
    }
  }

  /* ============================================================ THE REPORT
     ONE BUILDER, TWO PRESENTATIONS. The 3D battle and the headless resolve()
     both end here, because the aftermath screen must not be able to tell which
     one it is reading — a fast-resolved fight that hands back a differently
     shaped result is a second battle model wearing the first one's name, and
     the moment those two disagree the multiplayer campaign has two truths.

     `units` is the only thing the two paths hand over differently: on the sand
     it is the live bodies, headless it is plain records with the same four
     fields. Everything below reads .s / .team / .dead / .fled / .hp / .maxHp
     and nothing else, which is exactly why the same function can serve both. */
  function buildReport(units, ctxR, outcome, dur) {
    const r = {
      band: ctxR.band, outcome: outcome, duration: dur, youKills: ctxR.youKills || 0,
      ratio: ctxR.ratio,
      yourDead: ctxR.deadOf.mine.slice(),
      yourFled: ctxR.fledOf.mine.slice(),
      theirDead: ctxR.deadOf.them.slice(),
      yourSurvivors: [], theirSurvivors: [],
      loot: {}, armourLoot: {}, gold: 0,
      resolved: !!ctxR.headless,
    };
    const stood = {};        // who was still FIGHTING at the end, by soldier id
    for (let i = 0; i < units.length; i++) {
      const m = units[i];
      if (m.isYou || !m.s) continue;
      if (m.dead || m.fled) continue;
      // THE MEN WHO ARE STILL STANDING keep the hp they finished on, and a man
      // who finished under a third is WOUNDED — core's own flag, and the reason
      // a win can still cost you next week.
      m.s.hp = Math.max(1, Math.round(m.hp));
      m.s.wounded = m.hp < m.maxHp * 0.34;
      if (m.team === "mine") { r.yourSurvivors.push(m.s); if (m.routed) stood[m.s.id] = 0; else stood[m.s.id] = 1; }
      else r.theirSurvivors.push(m.s);
    }
    // the reserve never fought and is unhurt
    for (let i = 0; i < ctxR.reserveOf.mine.length; i++) r.yourSurvivors.push(ctxR.reserveOf.mine[i]);
    for (let i = 0; i < ctxR.reserveOf.them.length; i++) r.theirSurvivors.push(ctxR.reserveOf.them[i]);

    /* THE LOOT IS EVERY BODY ON THE FIELD, YOURS INCLUDED. A warlord strips his
       own dead — the rifle Kaseem was carrying is worth exactly as much now as
       it was this morning, and leaving it in the sand is the sentimental
       version of throwing money away. army.js removes your dead with
       keepKit:false precisely so this is the only place their kit is counted. */
    if (outcome === "won" || outcome === "retreat") {
      const bodies = r.yourDead.concat(outcome === "won" ? r.theirDead : []);
      for (let i = 0; i < bodies.length; i++) {
        const s = bodies[i];
        if (s.wid && s.wid !== "fists") r.loot[s.wid] = (r.loot[s.wid] || 0) + 1;
        if (s.armour && s.armour !== "none") r.armourLoot[s.armour] = (r.armourLoot[s.armour] || 0) + 1;
      }
      if (outcome === "won") r.gold = (ctxR.band && ctxR.band.gold) | 0;
    }
    /* A RETREAT COSTS LOOT AND MEN, which is what makes it a decision rather
       than a free undo: your dead stay where they fell with their guns, and a
       quarter of the men still on the field do not make it out. */
    if (outcome === "retreat") {
      r.loot = {}; r.armourLoot = {};
      const lose = Math.floor(r.yourSurvivors.length * 0.28);
      for (let i = 0; i < lose; i++) {
        const s = r.yourSurvivors.pop();
        if (s) r.yourDead.push(s);
      }
    }
    /* LOSING COSTS YOU THE MEN WHO STOOD, NOT THE MEN WHO RAN — and the first
       draft had that exactly backwards.

       It moved EVERY survivor into the dead list, which on a measured 34-man
       defeat killed all thirty-four: nineteen who fell fighting plus fifteen
       who had already broken and were halfway to the map edge. The pair image
       is unambiguous — "YOU LOST 34 DEAD" with a run-over screen behind it —
       and it is nonsense twice over. A man who ran away is the ONE man who
       demonstrably survived, and an army that routs is supposed to be an army
       you can rebuild; wiping the roster on a loss makes every defeat a
       deleted save and makes the rout mechanic a suicide button.

       So: a man still holding the line when it collapses is lost (killed, or
       taken by them — the campaign has no shape for being someone's prisoner).
       A man who had already broken gets away, at the cost of everything the
       aftermath does NOT give you: no loot, no prisoners, no promotions. */
    if (outcome === "lost") {
      for (let i = 0; i < r.yourSurvivors.length; i++) {
        const s = r.yourSurvivors[i];
        if (ctxR.reserveOf.mine.indexOf(s) >= 0) continue;   // the baggage never fought
        if (stood[s.id]) { r.yourDead.push(s); r.yourSurvivors[i] = null; }
        else s.wounded = true;                               // he ran, and he is not fresh
      }
      r.yourSurvivors = r.yourSurvivors.filter(Boolean);
    }
    r.theirSurvivors = r.theirSurvivors.filter(function (s) { return s; });
    return r;
  }

  function endBattle(outcome, why) {
    if (over) return;
    over = true;
    report.outcome = outcome;
    report.duration = simT;
    note(why || "");
    W.toast(why || "", outcome === "won" ? "good" : "bad");

    const r = buildReport(men, report, outcome, simT);
    if (outcome === "lost") W.state.you.hp = Math.max(1, Math.round(W.state.you.maxHp * 0.25));
    else W.state.you.hp = Math.max(1, Math.round(YOU.hp));

    // hand the screen over after a beat, so the last frame of the battle is a
    // frame of the battle and not a menu
    setTimeout(function () {
      if (W.army && W.army.aftermath) W.army.aftermath(r);
      else W.setPhase("campaign");
    }, outcome === "won" ? 1400 : 1100);
  }

  /* ============================================================ TEARDOWN
     EVERYTHING THIS FILE ADDED TO THE SCENE COMES OUT. A leaked battle is the
     bug that ends a run: three fights in and the page is holding two thousand
     rigs it will never draw. Every list added to above is emptied here, and
     the shared things it borrowed (the fog, the shadow map, the camera's
     child, CBZ.groundAt) are put back the way they were found. */
  function teardown() {
    if (!live) return;
    live = false; over = true; started = false;
    if (frameFn) { micro.offFrame(frameFn); frameFn = null; }
    document.removeEventListener("pointerdown", onWorldPointer);
    if (micro.unlock) safe(function () { micro.unlock(); });

    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (CBZ.ragdollDrop) safe(function () { CBZ.ragdollDrop(m); });
      if (m._weaponProp && m._weaponProp.parent) m._weaponProp.parent.remove(m._weaponProp);
      if (m.group) safe(function () { CBZ.studio.drop(m.group); });
    }
    for (let i = 0; i < sinking.length; i++) safe(function () { CBZ.studio.drop(sinking[i].g); });
    for (let i = 0; i < dropGuns.length; i++) {
      const g = dropGuns[i];
      if (g && g.parent) g.parent.remove(g);
    }
    for (let i = 0; i < addedMeshes.length; i++) safe(function () { CBZ.studio.drop(addedMeshes[i]); });
    // the colliders: spliced out by identity, never by clearing the array —
    // the campaign and the outposts have boxes in there too
    if (micro.colliders) {
      for (let i = 0; i < addedCols.length; i++) {
        const k = micro.colliders.indexOf(addedCols[i]);
        if (k >= 0) micro.colliders.splice(k, 1);
      }
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (micro.rebuildColliderGrid) micro.rebuildColliderGrid();

    if (viewGun) {
      if (viewGun.parent) viewGun.parent.remove(viewGun);
      safe(function () { CBZ.studio.drop(viewGun); });
      viewGun = null;
    }
    if (MAP && typeof MAP.clear === "function") safe(function () { MAP.clear(); });
    if (fogSave && scene.fog) {
      scene.fog.color.setHex(fogSave.hex);
      scene.fog.near = fogSave.near; scene.fog.far = fogSave.far;
    }
    fogSave = null;
    const R = CBZ.renderer || (micro && micro.renderer);
    if (R && R.shadowMap && shadowSave != null) R.shadowMap.enabled = shadowSave;
    shadowSave = null;

    if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
    const css = document.getElementById("wbCss");
    if (css && css.parentNode) css.parentNode.removeChild(css);
    hud = null;

    men = []; corpses = []; sinking = []; dropGuns = []; addedCols = []; addedMeshes = [];
    grid.clear(); fine.clear(); _claim.length = 0;
    deadSolving = 0; YOU = null; youRig = null; MAP = null; band = null; report = null;
    CBZ.groundAt = null;
  }

  /* ============================================================ KEYS */
  function keys() {
    window.addEventListener("keydown", function (e) {
      if (!live || over) return;
      if (e.code === "Digit1") setOrder("charge", "mine");
      else if (e.code === "Digit2") setOrder("hold", "mine");
      else if (e.code === "Digit3") setOrder("flank", "mine");
      else if (e.code === "Digit4") setOrder("fallback", "mine");
      else if (e.code === "KeyC") cycleCam();
    });
  }

  /* ============================================================ */
  W.module("battle", {
    needs: ["army"],
    boot: function (c) {
      ctx = c;
      Q = c.Q;
      THREE = c.THREE;
      keys();

      /* THE PAGE'S CBZ.floorAt SHIM CALLS THESE TWO BY NAME. They must exist
         from boot, not from start(), or the first campaign frame asks a
         function that is not there yet. */

      /* ?battle=1 — the debug door, and it is not optional scaffolding:
         campaign.js is being written by another agent, and a battle that can
         only be reached through a file that may not exist is a battle nobody
         can test. */
      if (Q && Q.get("battle") === "1") {
        setTimeout(function () {
          const mine = parseInt(Q.get("mine") || "", 10) || 26;
          const them = parseInt(Q.get("them") || "", 10) || 26;
          /* BOTH ROSTERS COME OUT OF THE SAME CONSTRUCTOR. The first draft
             hand-rolled the player's army with makeSoldier and no armour at
             all, while the enemy came from makeBand — which puts about one man
             in five in a vest or a plate. That is not a test battle, it is a
             handicap match, and it is exactly what the second before/after pair
             photographed: a bare-shirted army losing five to one. Same faction
             on both sides by default, so the only asymmetry left is the
             warlord and his orders — which is the thing being demonstrated. */
          if (!W.state.army.length) {
            const mineBand = W.makeBand({ size: mine, faction: Q.get("myfaction") || "militia" });
            for (let i = 0; i < mineBand.men.length; i++) W.addSoldier(mineBand.men[i]);
          }
          W.state.you.wid = Q.get("gun") || "ak47";
          const b = W.makeBand({ size: them, faction: Q.get("faction") || "bandit" });
          b.x = W.state.you.x + 40; b.z = W.state.you.z;
          W.state.bands.push(b);
          start({ band: b });
        }, 60);
      }
    },

    start: start,
    /* THE FAST PATH, PUBLIC. Same rosters, same morale, same report shape.
       W.battle.start(o) is the fight you play; W.battle.resolve(o) is the same
       fight, decided in one call, for a skip, a drop, an AI-on-AI battle, or a
       multiplayer turn that cannot wait. `apply:false` returns the report and
       changes nothing, which is what simulating somebody else's fight wants. */
    resolve: resolve,
    limit: BATTLE_MAX,
    live: function () { return live; },
    groundAt: function (x, z) { return MAP ? MAP.groundAt(x, z) : 0; },
    order: function (o) { setOrder(o, "mine"); },
    camera: setCam,
    retreat: function () { endBattle("retreat", "YOU BREAK OFF"); },

    /* ---- THE STUDIO SEAM, for tools/visual-presets/warlord-battle.mjs ------
       freeze() stops the rAF clock; advance(s) runs exactly s seconds of THIS
       page's frame through microboot's headless stepSim, so a screenshot is a
       statement about a MOMENT rather than about a frame rate; audit() is
       every number a preset might want to gate on. Drive-only. */
    freeze: function () { if (micro && micro.stop) micro.stop(); lastWall = 0; return true; },
    advance: function (sec, step) {
      const h = Math.max(1 / 240, Math.min(0.05, step || 1 / 60));
      let leftS = Math.max(0, +sec || 0), n = 0;
      while (leftS > 1e-4 && n < 6000) {
        const d = Math.min(h, leftS);
        injectDt = d;
        micro.stepSim(d);
        leftS -= d; n++;
      }
      return { frames: n, simT: Math.round(simT * 100) / 100 };
    },
    render: function () {
      const R = CBZ.renderer || (micro && micro.renderer);
      if (R && CBZ.camera) safe(function () { R.render(scene, CBZ.camera); });
      return true;
    },
    audit: function () {
      if (!live) return { live: false };
      const M = SIDES.mine, T = SIDES.them;
      return {
        live: true, over: over, outcome: report && report.outcome, simT: Math.round(simT * 10) / 10,
        order: orderOf(M), enemyOrder: T.order, cam: camMode,
        moraleOn: !MORALE_OFF(), ordersOn: !(Q && Q.get("orders") === "old"),
        mine: { alive: M.alive, morale: Math.round(M.morale * 100) / 100, routing: M.routing,
                dead: M.deadN, broke: M.brokeN || 0, fled: report.fledOf.mine.length,
                kills: M.kills, shots: M.shots, hits: M.hits, started: M.men0.length },
        them: { alive: T.alive, morale: Math.round(T.morale * 100) / 100, routing: T.routing,
                dead: T.deadN, broke: T.brokeN || 0, fled: report.fledOf.them.length,
                kills: T.kills, shots: T.shots, hits: T.hits, started: T.men0.length },
        you: { hp: Math.round(YOU.hp), kills: YOU.kills, dead: YOU.dead,
               x: Math.round(YOU.pos.x), z: Math.round(YOU.pos.z) },
        field: { cx: Math.round(MAP.cx), cz: Math.round(MAP.cz), relief: MAP.relief,
                 terrainLos: MAP.terrainLos, cover: MAP.cover.length, gap: GAP(),
                 desert: !!(W.desert && W.desert.battlefieldAt) },
        bodies: men.length, corpses: corpses.length, solving: deadSolving,
        fps: micro.fps || 0,
        reuse: {
          iq: !!(CBZ.combatIQ && CBZ.combatIQ.shot), gunfx: !!CBZ.tracer,
          rig: !!CBZ.makeCharacter, guns: !!(CBZ.weaponAppearance && CBZ.weaponAppearance.ak47),
          ragdoll: !!CBZ.cityRagdoll, gunPhysics: !!CBZ.weaponPhysics,
        },
      };
    },
    // where the bodies are, so a camera can be pointed at the fight
    look: function (o) {
      o = o || {};
      camMode = "cmd";
      cmd.init = 1;
      if (o.x != null) { cmd.x = o.x; cmd.z = o.z; }
      else {
        cmd.x = (SIDES.mine.comX + SIDES.them.comX) * 0.5;
        cmd.z = (SIDES.mine.comZ + SIDES.them.comZ) * 0.5;
      }
      cmd.auto = o.dist == null;
      if (o.dist != null) cmd.dist = o.dist;
      if (o.pitch != null) cmd.pitch = o.pitch;
      if (o.yaw != null) cmd.yaw = o.yaw;
      stepCamera(0.016);
      return { x: cmd.x, z: cmd.z, dist: cmd.dist, yaw: cmd.yaw, pitch: cmd.pitch };
    },
  });

  // and the probe hook the preset drives (the page's own name for it)
  G.__warlordBattle = W.battle;
})();
