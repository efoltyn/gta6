/* ============================================================
   modes/gungame.js — GUN GAME: weapon-ladder deathmatch on a map you CHOOSE.

   THE WHY (owner: "choose the map between jail natural disaster and others
   and play gun game"): the ladder itself is the gradient. Everyone — you and
   every bot — starts on the same first gun; every kill advances the killer
   ONE rung down a fixed weapon ladder; whoever lands the FINAL rung's kill
   wins the match. The next weapon is always VISIBLE (gungamehud.js shows the
   gun you are one kill from), and the final rung is CATEGORICAL: bare fists,
   the humiliation rung — losing your lead to a punch is the drama.

   THIS MODE BUILDS NO WORLD. It borrows maps whole:
     • JAIL   — the prison world (CBZ.prisonRoot) that boots with the game.
                Flat slab at y=0, colliders already live. The prison CAST is
                hidden for the match (this is an arena, not a prison sim) and
                restored on exit; their standing positions are harvested as
                the spawn pool, because a spot a prison NPC stands on is a
                spot the prison certifies as walkable.
     • ISLAND — the disaster island. Built through survival's OWN
                CBZ.modes.survival.build() so surv.built/surv.arena stay the
                one truth and both modes share one build (never two islands).
   MORE MAPS — the seam: add an entry to MAPS below with {label, small,
   ensure(), root(), floorAt(x,z), point()}. A city-slice map (e.g. the
   speedway infield) is deliberately NOT shipped: CBZ.city builds the whole
   city lazily and paying that on the title screen for one arena slice is the
   wrong trade. When the city is already built, a future map entry can borrow
   it for free through the same five hooks.

   REUSE MAP (what this file drives, never re-implements):
     • Player guns/fists: systems/fpsmode.js untouched. Its non-city target
       scan reads CBZ.guards + CBZ.npcs, so match bots REGISTER into CBZ.npcs
       (and CBZ.bots, whose list grapple.js's shared body physics steps in
       every non-escape mode). Prison actors are group-hidden for the match
       and findActorHit skips invisible groups — bullets only ever find bots.
     • Bot deaths: fpsmode/combat.js kill through CBZ.aiKill. The wrap below
       intercepts ONLY records stamped _ggBot and routes them to this mode's
       death handler (ragdoll via CBZ.body.hit, gore via CBZ.gore, ONE feed
       line via CBZ.cityKillFeed) — prison side effects (case files, gang
       standing, prison drops) never run for an arena bot.
     • Bot guns: systems/actorweapons.js (syncActorWeapon/actorMuzzle/
       actorAimAt) — the visible weapon IS the bot's rung. Fire is
       tracer + gunVoice + a range-honest hit roll, LOS-gated through
       CBZ.clearLineOfFire like city/peds.js's npcAttack.
     • Ladder weapons: ids straight out of CBZ.FPS_WEAPONS (the ONE gun
       system); the player swap is resetWeaponInventory → unlockWeapon →
       fpsResetWeapons. No new guns are invented.
   Flags: GUNGAME_V1 (master, null-check), GUNGAME_BOTS, GUNGAME_LADDER,
   GUNGAME_KILLS_PER_RUNG, GUNGAME_RESPAWN_SEC. Audit: CBZ.gungameAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.GUNGAME_V1 == null) CBZ.CONFIG.GUNGAME_V1 = true;
  if (CBZ.CONFIG.GUNGAME_BOTS == null) CBZ.CONFIG.GUNGAME_BOTS = 9;
  if (CBZ.CONFIG.GUNGAME_KILLS_PER_RUNG == null) CBZ.CONFIG.GUNGAME_KILLS_PER_RUNG = 1;
  if (CBZ.CONFIG.GUNGAME_RESPAWN_SEC == null) CBZ.CONFIG.GUNGAME_RESPAWN_SEC = 3;
  if (CBZ.CONFIG.GUNGAME_V1 === false) return;   // one-line revert: title button falls back to escape (state.js normalizes)

  // ---- THE LADDER -----------------------------------------------------------
  // ids are CBZ.FPS_WEAPONS ids (weapons/weapon-data.js); `name` is the
  // actorweapons/audio-facing name (same strings city/combat.js's GUN_MAP
  // uses), so one row arms the player, the bot's hands AND the gun's voice.
  // Light → heavy → the categorical final rung: BARE FISTS (melee:true —
  // no weapon id at all; fpsmode's unarmed punch / combat.js melee is the gun).
  // Override: CBZ.CONFIG.GUNGAME_LADDER = [{id,name,melee?},…].
  const DEFAULT_LADDER = [
    { id: "sidearm", name: "Pistol" },
    { id: "smg", name: "SMG" },
    { id: "shotgun", name: "Shotgun" },
    { id: "carbine", name: "Rifle" },
    { id: "ak47", name: "AK-47" },
    { id: "lmg", name: "LMG" },
    { id: "sniper", name: "Sniper" },
    { id: "deagle", name: "Desert Eagle" },
    { id: "fists", name: "Fists", melee: true },
  ];
  if (CBZ.CONFIG.GUNGAME_LADDER == null) CBZ.CONFIG.GUNGAME_LADDER = DEFAULT_LADDER;
  function ladder() { return CBZ.CONFIG.GUNGAME_LADDER || DEFAULT_LADDER; }
  function rungAt(i) { const L = ladder(); return L[Math.max(0, Math.min(L.length - 1, i | 0))]; }
  function rungLabel(r) {
    if (!r) return "?";
    if (r.melee) return "BARE FISTS";
    const w = CBZ.weaponById && CBZ.weaponById(r.id);
    return (w && w.label) || r.name || r.id;
  }
  // kills needed on a rung: the final rung is always ONE kill (the drama rung);
  // earlier rungs take GUNGAME_KILLS_PER_RUNG (classic gun game = 1).
  function rungNeed(i) {
    return i >= ladder().length - 1 ? 1 : Math.max(1, CBZ.CONFIG.GUNGAME_KILLS_PER_RUNG | 0);
  }

  // ---- MAPS (borrowed worlds — see header; never authored here) -------------
  const MAPS = {
    jail: {
      id: "jail", label: "The Jail", small: "cell block · yard · corridors",
      ensure() { return !!CBZ.prisonRoot; },          // built at boot with the game
      root() { return CBZ.prisonRoot || null; },
      floorAt() { return 0; },                        // the prison is a flat slab at y=0
      point() { return null; },                       // jail spawns come from the harvested pool
    },
    island: {
      id: "island", label: "Disaster Island", small: "open ground · towers · shore",
      ensure() {
        // ONE island for two modes: go through survival's own build() so its
        // surv.built guard is the single truth — if survival built it we reuse
        // it, if we build it survival adopts it (its build() will early-return
        // forever after). Never call buildDisasterArena() directly from here:
        // survival's build also installs its floorAt override, and skipping it
        // would leave survival standing on y=0 the day gungame built first.
        const m = CBZ.modes && CBZ.modes.survival;
        if (m && m.build) { try { m.build(); } catch (e) { console.error("[gungame island]", e); } }
        return !!(CBZ.surv && CBZ.surv.arena);
      },
      root() { return (CBZ.surv && CBZ.surv.arena && CBZ.surv.arena.root) || null; },
      floorAt(x, z) {
        const A = CBZ.surv && CBZ.surv.arena;
        return A ? A.groundHeightAt(x, z) : 0;
      },
      point() {
        const A = CBZ.surv && CBZ.surv.arena;
        return A ? A.randomPoint(12, A.radius * 0.78) : null;
      },
    },
  };
  function curMap() { return MAPS[g.gungameMap] || MAPS.jail; }
  if (!g.gungameMap) g.gungameMap = "jail";

  // state.js reads this to decide which borrowed root stays visible in-mode.
  CBZ.gungameWorlds = function () {
    return { jail: curMap().id === "jail", island: curMap().id === "island" };
  };

  // ---- match state ----------------------------------------------------------
  const gg = {
    bots: [],            // our records; each also lives in CBZ.bots + CBZ.npcs while a match runs
    match: null,         // {t, over}
    playerRung: 0, playerRungKills: 0, playerKills: 0, playerDeaths: 0,
    respawnT: 0,         // player respawn countdown (>0 while dead mid-match)
    spawnPool: [],       // jail: harvested walkable points
    hiddenCast: [],      // prison actors we group-hid for a jail match (restored on exit)
    matchesPlayed: 0,
    winner: null,        // "You" | bot name, once decided
  };
  CBZ.gungame = gg;

  const rand = Math.random;   // runtime match randomness (FX-class; no world is built here)

  // ---- bot cosmetics (survivorbot.js's lobby palette + naming grammar) ------
  const SKIN = [0xf0c39a, 0xe8b58c, 0xc08a5a, 0x8a5a3a, 0x6b4a32, 0xd8a177, 0xf2cbb0];
  const HAIR = [0x2a2018, 0x4a3526, 0x101820, 0xb9b1a6, 0x7a4a2e, 0x222222, 0xdedede];
  const OUTFIT = [0xff5b5b, 0x4f9dff, 0x44d07a, 0xffd166, 0xc792ea, 0xff9e6b, 0x66d9c0,
    0xf06b9b, 0x5b8bff, 0xff7a1a, 0x39d0c0, 0xe85d8a, 0x7ed957, 0xb07aff];
  const FIRST = ["Liam", "Mia", "Noah", "Ava", "Kai", "Zoe", "Leo", "Ivy", "Max", "Ada",
    "Finn", "Cleo", "Ravi", "Yuki", "Omar", "Nina", "Jude", "Wren", "Theo", "Iris",
    "Hugo", "Vera", "Eli", "Luna", "Remy", "Sol", "Reed", "Beau", "Esme", "Nico",
    "Dane", "Arlo", "Cole", "Mara", "Kofi", "Tess", "Anya", "Dex", "Lena", "Quinn"];
  const LAST_I = "ABCDEFGHJKLMNPRSTVW";
  function pick(a) { return a[(rand() * a.length) | 0]; }
  function pickName() { return pick(FIRST) + " " + LAST_I[(rand() * LAST_I.length) | 0] + "."; }

  // ---- spawns ---------------------------------------------------------------
  // JAIL: a prison NPC's standing spot is a certified-walkable point — harvest
  // the whole cast's positions (plus the two authored spawns) BEFORE hiding
  // them. ISLAND: arena.randomPoint. Both filter through npcTransitionSafe so
  // nobody ever materializes on the player's padded screen.
  function harvestJailSpawns() {
    const pts = [];
    const push = (x, z) => { if (isFinite(x) && isFinite(z)) pts.push({ x: x, z: z }); };
    if (CBZ.SPAWN) push(CBZ.SPAWN.x, CBZ.SPAWN.z);
    if (CBZ.COP_SPAWN) push(CBZ.COP_SPAWN.x, CBZ.COP_SPAWN.z);
    for (const n of CBZ.npcs || []) if (n && !n._ggBot && !n.escaped && n.group) push(n.group.position.x, n.group.position.z);
    for (const gd of CBZ.guards || []) if (gd && gd.group) push(gd.group.position.x, gd.group.position.z);
    return pts;
  }
  function minEnemyDist(x, z, self) {
    let d = Infinity;
    if (!CBZ.player.dead && self !== "player") d = Math.min(d, Math.hypot(x - CBZ.player.pos.x, z - CBZ.player.pos.z));
    for (const b of gg.bots) {
      if (b.dead || b === self) continue;
      d = Math.min(d, Math.hypot(x - b.pos.x, z - b.pos.z));
    }
    return d;
  }
  // best available point: farthest from every living enemy, never on the
  // player's padded screen (npcTransitionSafe). `self` = who is spawning.
  function spawnPoint(self) {
    const map = curMap();
    let best = null, bestD = -1;
    const consider = (p) => {
      if (!p) return;
      if (self !== "player" && CBZ.npcTransitionSafe &&
          !CBZ.npcTransitionSafe(p.x, p.z, { minDistance: 14, maxDistance: 1e6 })) return;
      const d = minEnemyDist(p.x, p.z, self);
      if (d > bestD) { bestD = d; best = p; }
    };
    if (map.id === "jail") {
      for (let i = 0; i < gg.spawnPool.length; i++) consider(gg.spawnPool[i]);
      if (!best && gg.spawnPool.length) best = gg.spawnPool[(rand() * gg.spawnPool.length) | 0];
      if (!best) best = { x: CBZ.SPAWN ? CBZ.SPAWN.x : 0, z: CBZ.SPAWN ? CBZ.SPAWN.z : 0 };
    } else {
      for (let i = 0; i < 10; i++) consider(map.point());
      if (!best) best = map.point() || { x: 0, z: 0 };
    }
    return best;
  }

  // ---- floor handoff --------------------------------------------------------
  // The city's chain pattern (city/mode.js): our wrapper answers ONLY in
  // gungame mode and delegates everything else to whatever floor was installed
  // before us. Re-installed each match because survival's build() stomps
  // CBZ.floorAt unconditionally (same reason city re-installs on reset).
  function mapFloor(x, z) { return curMap().floorAt(x, z); }
  function installFloor() {
    if (CBZ.floorAt && CBZ.floorAt._gungame) return;
    const base = CBZ.floorAt || null;
    const f = function (x, z) {
      if (g.mode === "gungame") return mapFloor(x, z);
      return base && base !== f ? base(x, z) : 0;
    };
    f._gungame = true;
    CBZ.floorAt = f;
  }

  // ---- prison cast parking --------------------------------------------------
  // A jail match plays on the prison MAP, not against the prison CAST: hide
  // every inmate/guard body (visibility flip only — their records, brains and
  // resets are untouched; the escape-gated AI wasn't running anyway) and
  // restore exactly the ones we hid on exit. findActorHit skips invisible
  // groups, so a hidden inmate can never eat a match bullet.
  function hidePrisonCast() {
    restorePrisonCast();
    const park = (a) => {
      if (!a || a._ggBot || !a.group || a.group.visible === false) return;
      a.group.visible = false;
      gg.hiddenCast.push(a);
    };
    for (const n of CBZ.npcs || []) park(n);
    for (const gd of CBZ.guards || []) park(gd);
  }
  function restorePrisonCast() {
    for (const a of gg.hiddenCast) {
      if (a && a.group && !a.escaped) a.group.visible = true;
    }
    gg.hiddenCast.length = 0;
  }

  // ---- bots -----------------------------------------------------------------
  const BOT_RADIUS = 0.5;
  const ANIM_DIST2 = 62 * 62;
  function makeBot(x, z) {
    const outfit = pick(OUTFIT), skin = pick(SKIN);
    const ch = CBZ.makeCharacter({
      legs: pick(OUTFIT), torso: outfit, collar: outfit, arms: outfit,
      skin: skin, hair: pick(HAIR), shoes: 0x2b2b2b,
    });
    ch.group.position.set(x, mapFloor(x, z), z);
    ch.group.rotation.y = rand() * 6.28;
    const name = pickName();
    return {
      kind: "gungame", _ggBot: true, isPlayer: false,
      char: ch, group: ch.group, pos: ch.group.position,
      name: name, data: { name: name },       // fpsmode/killstreaks/combat read a.data.name
      hp: 100, maxHp: 100, dead: false, ko: 0, escaped: false,
      armed: true, weapon: rungAt(0).name,    // actorweapons name — the visible gun IS the rung
      rung: 0, rungKills: 0, kills: 0, deaths: 0,
      outfit: outfit, skin: skin,             // gore colours
      baseSpeed: 2.5 + rand() * 0.9, speed: 0,
      target: new THREE.Vector3(x, 0, z), foe: null,
      pause: 0, slice: (rand() * 6) | 0, thinkT: 0,
      fireCD: 0.8 + rand() * 1.2, burst: 0, strafe: rand() < 0.5 ? 1 : -1,
      respawnT: 0,
    };
  }
  function armBot(b) {
    const r = rungAt(b.rung);
    if (r.melee) { b.armed = false; b.weapon = null; }
    else { b.armed = true; b.weapon = r.name; }
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(b);
  }
  function spawnBots(n) {
    const root = curMap().root() || CBZ.scene;
    for (let i = 0; i < n; i++) {
      const p = spawnPoint(null);
      const b = makeBot(p.x, p.z);
      root.add(b.group);
      gg.bots.push(b);
      CBZ.bots.push(b);   // grapple.js's shared body physics steps CBZ.bots in every non-escape mode
      CBZ.npcs.push(b);   // fpsmode's non-city bullet/punch scan reads CBZ.npcs — this is what makes bots shootable
      armBot(b);
    }
  }
  function despawnBots() {
    for (const b of gg.bots) {
      if (!b.group) continue;
      if (b.group.parent) b.group.parent.remove(b.group);
      // survivorbot.js's dispose discipline: never touch anything _shared
      b.group.traverse(function (o) {
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) try { o.geometry.dispose(); } catch (e) {}
        if (o.material) {
          const m = o.material;
          if (Array.isArray(m)) m.forEach((x) => x && !x._shared && x.dispose && x.dispose());
          else if (!m._shared && m.dispose) try { m.dispose(); } catch (e) {}
        }
      });
      let i = CBZ.bots.indexOf(b); if (i >= 0) CBZ.bots.splice(i, 1);
      i = CBZ.npcs.indexOf(b); if (i >= 0) CBZ.npcs.splice(i, 1);
    }
    gg.bots.length = 0;
  }
  function respawnBot(b) {
    const p = spawnPoint(b);
    b.dead = false; b.hp = 100; b.ko = 0; b.respawnT = 0; b.foe = null;
    b.pos.set(p.x, mapFloor(p.x, p.z), p.z);
    b.group.rotation.set(0, rand() * 6.28, 0);
    if (b._phys) { b._phys.down = 0; b._phys.air = false; b._phys.kx = 0; b._phys.kz = 0; b._phys.heldBy = null; }
    b._lvy = 0;
    b.fireCD = 0.9 + rand() * 0.9;
    if (b.group && !b.group.parent) (curMap().root() || CBZ.scene).add(b.group);
    armBot(b);
  }

  // ---- who killed whom ------------------------------------------------------
  function resolveKiller(k) {
    if (!k) return null;
    if (k === "player" || k === CBZ.player) return "player";
    if (k.group && CBZ.playerChar && k.group === CBZ.playerChar.group) return "player";
    if (k._ggBot) return k;
    return null;
  }
  function killerWeaponName(kRec) {
    const r = kRec === "player" ? rungAt(gg.playerRung) : rungAt(kRec.rung);
    return r.melee ? "fists" : (r.name || r.id).toLowerCase();
  }

  // ---- deaths (bots) --------------------------------------------------------
  // ONE handler whichever gun fired: the player's bullets arrive here through
  // the CBZ.aiKill wrap below (fpsmode/combat.js call aiKill on a lethal hit);
  // bot-vs-bot fire arrives from hurt(). Ragdoll + gore are surv.killBot's
  // exact grammar; the feed line is the one sanctioned popup.
  function botDeath(b, killer, cause) {
    if (!b || b.dead) return;
    b.dead = true; b.hp = 0; b.ko = 0; b.deaths++;
    b.respawnT = Math.max(1, +CBZ.CONFIG.GUNGAME_RESPAWN_SEC || 3);
    const kRec = resolveKiller(killer);
    const label = cause || (kRec ? killerWeaponName(kRec) : "crossfire");
    if (CBZ.body) {
      const kp = kRec === "player" ? CBZ.player.pos : (kRec ? kRec.pos : null);
      if (kp) CBZ.body.hit(b, { fromX: kp.x, fromZ: kp.z, force: 6 + rand() * 3, fling: 4 + rand() * 3 });
      else {
        const a = rand() * 6.28;
        CBZ.body.hit(b, { dir: { x: Math.cos(a), z: Math.sin(a) }, force: 2.5 + rand() * 3, fling: 4 + rand() * 3 });
      }
    }
    if (CBZ.gore) {
      CBZ.gore(b.pos.x, b.pos.y + 1.0, b.pos.z, { amount: 0.95, cloth: b.outfit, skin: b.skin });
    }
    if (CBZ.cityKillFeed) {
      CBZ.cityKillFeed(kRec === "player" ? "You" : (kRec ? kRec.name : ""), b.name, label);
    }
    if (kRec === "player") advancePlayer();
    else if (kRec) advanceBot(kRec);
  }

  // ---- deaths (player) ------------------------------------------------------
  // NO WASTED flow, no permadeath, no spectate: an arena death is a 3 s
  // respawn. The ragdoll is survival's _death fling (physics.js integrates it
  // in every non-escape mode); the feed line is the story.
  function playerDeath(byBot, cause) {
    if (CBZ.player.dead) return;
    CBZ.player.dead = true;
    CBZ.player.hp = 0;
    gg.playerDeaths++;
    gg.respawnT = Math.max(1, +CBZ.CONFIG.GUNGAME_RESPAWN_SEC || 3);
    const a = rand() * 6.28;
    CBZ.player._death = {
      vx: Math.cos(a) * (3 + rand() * 3), vz: Math.sin(a) * (3 + rand() * 3),
      vy: 6 + rand() * 3, spin: (rand() * 2 - 1) * 7, spin2: (rand() * 2 - 1) * 5,
      t: 0, landed: false, seed: rand() * 6.28,
    };
    if (CBZ.player._phys) { CBZ.player._phys.air = false; CBZ.player._phys.down = 0; CBZ.player._phys.kx = CBZ.player._phys.kz = 0; }
    if (CBZ.fpsSetActive) CBZ.fpsSetActive(false);     // third-person death cam for the 3 s
    if (CBZ.shake) CBZ.shake(1.0);
    if (CBZ.sfx) CBZ.sfx("ko");
    if (CBZ.doSlowmo) CBZ.doSlowmo(0.4);
    if (CBZ.killstreakBreak) CBZ.killstreakBreak("Respawning");
    if (CBZ.cityKillFeed) CBZ.cityKillFeed(byBot ? byBot.name : "", "You", cause || "gunfire", { you: true });
    if (byBot && byBot._ggBot) advanceBot(byBot);
  }
  function respawnPlayer() {
    const p = spawnPoint("player");
    const gy = mapFloor(p.x, p.z);
    CBZ.player.pos.set(p.x, gy, p.z);
    CBZ.player.vy = 0; CBZ.player.grounded = true;
    CBZ.player.hp = 100; CBZ.player.dead = false; CBZ.player.ko = 0; CBZ.player.stun = 0;
    CBZ.player._death = null;
    if (CBZ.player._phys) { CBZ.player._phys.air = false; CBZ.player._phys.down = 0; CBZ.player._phys.kx = CBZ.player._phys.kz = 0; }
    CBZ.player.stamina = (CBZ.SURV && CBZ.SURV.staminaMax) || 100;
    CBZ.playerChar.group.position.copy(CBZ.player.pos);
    CBZ.playerChar.group.rotation.set(0, rand() * 6.28, 0);
    CBZ.playerChar.group.scale.y = 1;
    if (CBZ.cam) { CBZ.cam.yaw = CBZ.playerChar.group.rotation.y + Math.PI; CBZ.cam.pitch = 0.34; }
    grantPlayerRung();   // fresh mags on the same rung (re-granting auto-drops back into FPS)
  }

  // ---- rung advancement -----------------------------------------------------
  // A rung advance is a FULL HEAL (stated design: the reward for a kill is the
  // next gun AND a clean slate — it keeps a hot streak hot and makes the
  // leader killable only by actually outshooting them, not by chip damage).
  function grantPlayerRung() {
    const r = rungAt(gg.playerRung);
    if (CBZ.resetWeaponInventory) CBZ.resetWeaponInventory();   // one gun at a time — the rung IS the loadout
    if (!r.melee && CBZ.unlockWeapon) CBZ.unlockWeapon(r.id, { select: true });
    if (CBZ.fpsResetWeapons) CBZ.fpsResetWeapons();             // full mags for the new gun
  }
  function hint(msg, secs) {
    if (CBZ.jailTell) CBZ.jailTell.hint(msg, secs || 2);
    else if (CBZ.flashHint) { try { CBZ.flashHint(msg, secs || 2); } catch (e) {} }
  }
  function advancePlayer() {
    if (!gg.match || gg.match.over) return;
    gg.playerKills++;
    gg.playerRungKills++;
    if (gg.playerRungKills < rungNeed(gg.playerRung)) return;
    if (gg.playerRung >= ladder().length - 1) { matchWon("player"); return; }
    gg.playerRung++;
    gg.playerRungKills = 0;
    CBZ.player.hp = 100;
    grantPlayerRung();
    const nxt = gg.playerRung < ladder().length - 1 ? rungLabel(rungAt(gg.playerRung + 1)) : null;
    hint("RUNG " + (gg.playerRung + 1) + "/" + ladder().length + " — " + rungLabel(rungAt(gg.playerRung)) +
      (nxt ? "  ·  NEXT: " + nxt : "  ·  FINAL RUNG"), 2.4);
    if (CBZ.sfx) CBZ.sfx("key");
  }
  function advanceBot(b) {
    if (!gg.match || gg.match.over || !b || !b._ggBot) return;
    b.kills++;
    b.rungKills++;
    if (b.rungKills < rungNeed(b.rung)) return;
    if (b.rung >= ladder().length - 1) { matchWon(b); return; }
    b.rung++;
    b.rungKills = 0;
    b.hp = 100;
    armBot(b);
  }

  // ---- match end ------------------------------------------------------------
  function matchWon(who) {
    if (!gg.match || gg.match.over) return;
    gg.match.over = true;
    gg.winner = who === "player" ? "You" : who.name;
    if (who === "player") { if (CBZ.winGame) CBZ.winGame("gungame"); }
    else if (CBZ.loseGame) CBZ.loseGame("outgunned");
  }

  // standings, best first: rung then kills. Used by the result cards + HUD.
  function standings() {
    const rows = [{ name: "You", you: true, rung: gg.playerRung, kills: gg.playerKills }];
    for (const b of gg.bots) rows.push({ name: b.name, rung: b.rung, kills: b.kills });
    rows.sort((a, c) => (c.rung - a.rung) || (c.kills - a.kills));
    return rows;
  }
  CBZ.gungameStandings = standings;

  // Fills the SHARED survival result cards (state.js shows #survwin/#survlose
  // for this mode too — reuse, not a new screen). state.js's fillSurvResult
  // restores every label we touch the next time survival ends a round.
  function setText(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }
  function setLabelAfter(id, v) { const e = document.getElementById(id); if (e && e.nextElementSibling) e.nextElementSibling.textContent = v; }
  CBZ.gungameFillResult = function (win) {
    const rows = standings();
    const L = ladder().length;
    const time = CBZ.fmtTime ? CBZ.fmtTime(g.elapsed) : "--";
    if (win) {
      const box = document.getElementById("survwin");
      if (box) {
        const logo = box.querySelector(".logo"); if (logo) logo.textContent = "LADDER COMPLETE";
        const sub = box.querySelector(".sub"); if (sub) sub.textContent = "The fists finished it — every rung climbed";
      }
      setText("swPlace", "#1"); setText("swTotal", "of " + rows.length);
      setText("swTime", time); setLabelAfter("swTime", "Match time");
      setText("swDis", gg.playerKills); setLabelAfter("swDis", "Kills");
    } else {
      let place = 1;
      for (let i = 0; i < rows.length; i++) if (rows[i].you) { place = i + 1; break; }
      const box = document.getElementById("survlose");
      if (box) {
        const logo = box.querySelector(".logo"); if (logo) logo.textContent = "OUTGUNNED";
        const sub = box.querySelector(".sub");
        if (sub) sub.textContent = (gg.winner || "Somebody") + " finished the ladder — you reached rung " +
          (gg.playerRung + 1) + "/" + L + " (" + rungLabel(rungAt(gg.playerRung)) + ")";
      }
      setText("slPlace", "#" + place); setText("slTotal", "of " + rows.length);
      setText("slTime", time); setLabelAfter("slTime", "Match time");
      setText("slDis", gg.playerKills); setLabelAfter("slDis", "Kills");
    }
  };

  // ---- damage funnel --------------------------------------------------------
  // Bot-fired damage lands here (the player's own guns damage bots through
  // fpsmode's existing gunHit → CBZ.aiKill path — never a parallel one).
  // Mirrors CBZ.surv.hurt's shape: player branch honors invuln and runs this
  // mode's respawn death; bot branch converges on botDeath.
  function hurt(actor, dmg, imp) {
    if (!actor || dmg <= 0 || g.mode !== "gungame" || !gg.match || gg.match.over) return;
    if (actor === PLAYER_TGT || actor === CBZ.player || actor.isPlayer) {
      if (CBZ.player.dead || g.invuln > 0) return;
      CBZ.player.hp -= dmg;
      if (CBZ.shake) CBZ.shake(0.12);
      if (CBZ.player.hp <= 0) playerDeath(imp && imp.by, imp && imp.cause);
    } else {
      if (actor.dead) return;
      actor.hp -= dmg;
      if (actor.hp <= 0) botDeath(actor, imp && imp.by, imp && imp.cause);
    }
  }
  gg.hurt = hurt;

  // ---- CBZ.aiKill wrap ------------------------------------------------------
  // fpsmode's gunHit and combat.js's melee execute both finish a non-city kill
  // with CBZ.aiKill(victim, {group: playerChar.group}, …). For a match bot
  // that call must become a GUNGAME death (feed + rung + respawn), never the
  // prison's (case heat, gang standing, prison drops, frisk). Everything that
  // is NOT a match bot passes through byte-identically.
  const prevAiKill = CBZ.aiKill;
  CBZ.aiKill = function (victim, killer, opts) {
    if (victim && victim._ggBot) {
      if (g.mode === "gungame") botDeath(victim, killer, opts && opts.cause);
      else if (!victim.dead) { victim.dead = true; victim.hp = 0; victim.ko = 0; }   // stale record outside the mode: just drop it
      return;
    }
    return prevAiKill ? prevAiKill(victim, killer, opts) : undefined;
  };

  // ---- bot driver -----------------------------------------------------------
  // The SIMPLEST brain composed from existing pieces: pick nearest living
  // target, hold the weapon's standoff, strafe, fire through the shared seams
  // (actorAimAt → actorMuzzle → clearLineOfFire → tracer → gunVoice), damage
  // through hurt(). Locomotion is survivorbot.js's move grammar (collide +
  // floorAt + animChar). No prison brain, no city brain.
  const PLAYER_TGT = {
    isPlayer: true,
    get pos() { return CBZ.player.pos; },
    get dead() { return CBZ.player.dead; },
    get group() { return CBZ.playerChar && CBZ.playerChar.group; },
  };
  const _mz = new THREE.Vector3();
  let frame = 0;

  function botWeapon(b) { const r = rungAt(b.rung); return r.melee ? null : (CBZ.weaponById && CBZ.weaponById(r.id)); }

  function pickTarget(b) {
    let best = null, bd = Infinity;
    if (!CBZ.player.dead) {
      const d = Math.hypot(b.pos.x - CBZ.player.pos.x, b.pos.z - CBZ.player.pos.z);
      if (d < bd) { bd = d; best = PLAYER_TGT; }
    }
    for (const o of gg.bots) {
      if (o === b || o.dead) continue;
      const d = Math.hypot(b.pos.x - o.pos.x, b.pos.z - o.pos.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  function think(b) {
    b.foe = pickTarget(b);
    const w = botWeapon(b);
    if (!b.foe) { b.pause = 0.5; return; }
    const t = b.foe.pos;
    const dx = t.x - b.pos.x, dz = t.z - b.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    // standoff: melee closes to arm's reach; a gun holds inside its sweet
    // spot (dropStart-derived), backs off when hurt, strafes on station.
    const stand = !w ? 1.5 : Math.max(7, Math.min(24, (w.dropStart || 30) * 0.55));
    const hurtback = b.hp < 30 && w ? 6 : 0;
    if (rand() < 0.12) b.strafe = -b.strafe;
    if (dist > stand + 2) {
      // close in (slight lead angle so approaches curve, not beeline)
      const k = (dist - stand) / dist;
      b.target.set(b.pos.x + dx * k + (rand() - 0.5) * 3, 0, b.pos.z + dz * k + (rand() - 0.5) * 3);
    } else if (dist < stand - 3 || hurtback) {
      // give ground, still facing the fight
      const k = (stand + hurtback - dist) / dist;
      b.target.set(b.pos.x - dx * k, 0, b.pos.z - dz * k);
    } else {
      // on station: strafe the circle
      const px = -dz / dist, pz = dx / dist;
      b.target.set(b.pos.x + px * b.strafe * 4, 0, b.pos.z + pz * b.strafe * 4);
    }
    // ISLAND: never chase into the sea — clamp the waypoint inside the shore
    // ring (a bot on the seabed is a bot the match forgot).
    if (curMap().id === "island" && CBZ.surv && CBZ.surv.arena) {
      const A = CBZ.surv.arena;
      const ox = b.target.x - A.center.x, oz = b.target.z - A.center.z;
      const od = Math.hypot(ox, oz), lim = A.radius * 0.9;
      if (od > lim) { b.target.x = A.center.x + (ox / od) * lim; b.target.z = A.center.z + (oz / od) * lim; }
    }
  }

  function botFire(b, dt) {
    const foe = b.foe;
    if (!foe || foe.dead) return;
    b.fireCD -= dt;
    if (b.fireCD > 0) return;
    const w = botWeapon(b);
    const dx = foe.pos.x - b.pos.x, dz = foe.pos.z - b.pos.z;
    const dh = Math.hypot(dx, dz);

    if (!w) {
      // FISTS (final rung): a real swing at arm's reach through the shared
      // body layer — the humiliation kill everyone can see coming.
      if (dh > 2.2 || Math.abs((foe.pos.y || 0) - (b.pos.y || 0)) > 2.0) { b.fireCD = 0.15; return; }
      b.fireCD = 0.8 + rand() * 0.5;
      b.group.rotation.y = Math.atan2(dx, dz);   // square up (no gun-ready pose on the fists rung)
      if (CBZ.body && !foe.isPlayer) CBZ.body.hit(foe, { fromX: b.pos.x, fromZ: b.pos.z, force: 5 });
      if (CBZ.sfx) CBZ.sfx("punch");
      hurt(foe, 16 + rand() * 8, { by: b, cause: "fists" });
      return;
    }

    const reach = Math.min(w.range || 80, 95);
    if (dh > reach) { b.fireCD = 0.25; return; }
    if (CBZ.actorAimAt) CBZ.actorAimAt(b, foe);
    const ty = (foe.pos.y || 0) + (foe.isPlayer ? 1.5 : 1.3);
    // LOS from the CHEST (the peds.js lesson: a muzzle can start inside a
    // wall; the chest can't) — no clear line, hold fire and re-check.
    if (CBZ.clearLineOfFire &&
        !CBZ.clearLineOfFire(b.pos.x, (b.pos.y || 0) + 1.4, b.pos.z, foe.pos.x, ty, foe.pos.z)) {
      b.fireCD = 0.25 + rand() * 0.3;
      return;
    }
    // cadence: autos rip short bursts then breathe; everything else runs its
    // own action's interval with a human beat on top.
    if (w.auto) {
      b.burst = (b.burst || 0) + 1;
      if (b.burst >= 3 + (rand() * 3 | 0)) { b.burst = 0; b.fireCD = 0.7 + rand() * 0.7; }
      else b.fireCD = Math.max(0.09, (w.interval || 0.1) * 1.35);
    } else {
      b.fireCD = (w.interval || 0.5) * 1.2 + 0.15 + rand() * 0.4;
    }
    const from = CBZ.actorMuzzle ? CBZ.actorMuzzle(b, _mz) : { x: b.pos.x, y: (b.pos.y || 0) + 1.4, z: b.pos.z };
    const to = { x: foe.pos.x, y: ty, z: foe.pos.z };
    if (CBZ.tracer) CBZ.tracer(from, to, { shooter: b, targetActor: foe.isPlayer ? CBZ.player : foe });
    else if (CBZ.muzzleFlash) CBZ.muzzleFlash(from, {});
    if (CBZ.gunVoice) CBZ.gunVoice(b.weapon, Math.hypot(from.x - CBZ.player.pos.x, from.z - CBZ.player.pos.z));
    else if (CBZ.sfx) CBZ.sfx("report");
    const d3 = Math.hypot(dh, ty - from.y);
    // honest-with-range hit roll; a touch kinder to the player so duels are
    // winnable against five bots at once (they also shoot each other).
    let chance = Math.max(0.12, 0.82 - d3 * 0.022);
    if (foe.isPlayer) chance *= 0.8;
    if (rand() < chance) {
      const fall = CBZ.weaponFalloffMul ? CBZ.weaponFalloffMul(w, d3) : 1;
      const dmg = Math.max(8, (w.damage || 20) * 0.5) * fall;
      hurt(foe, dmg, { by: b, cause: (rungAt(b.rung).name || "gunfire").toLowerCase() });
    }
  }

  // ---- VAULT (systems/physics.js characterTraversal) ------------------------
  // Another borrowed capability, not a new one. The probe was refused outside
  // city mode until systems/modecaps.js turned the mode enum into a capability;
  // the maps this mode borrows are FULL of the waist-high geometry it wants —
  // the prison's mess benches and stools (world/cafeteria.js registers them
  // with the exact y0/y1 + ref band the probe reads) and the disaster island's
  // abandoned cars. A bot running a duel line now gets over them the same way
  // the player does, off the same code, with no bot-side animation authored.
  // `b.speed` here IS the live per-frame speed (b.baseSpeed holds the base), so
  // the default speedField:true is correct — the traversal drives the animator.
  function ggTraverse(b, dt) {
    const T = CBZ.characterTraversal;
    if (!T || !b.char || !(CBZ.modeHas && CBZ.modeHas("traverse"))) return false;
    if (b._traversal) {
      if (b.dead || b.ko > 0) { T.cancel(b, b.char, false, "interrupted"); return false; }
      const owned = T.step(b, b.char, dt, true);
      if (!b._traversal) b._ggTravT = 0.36;      // a beat before the next probe
      return owned;
    }
    b._ggTravT = (b._ggTravT || 0) - dt;
    if (b._ggTravT > 0 || !b.target) return false;
    const tx = b.target.x - b.pos.x, tz = b.target.z - b.pos.z;
    const dist = Math.hypot(tx, tz);
    if (dist < 0.9) return false;
    const spd = b.baseSpeed * (b.foe ? 1.35 : 1.0);
    b._ggTravT = 0.12;
    const started = T.start(b, b.char, tx, tz, {
      speed: spd, radius: BOT_RADIUS,
      height: (b.char.metric && b.char.metric.height) || 1.7,
      allowTop: false, cars: false, npc: true, running: true,
      sprinting: !!b.foe,
    });
    return !!(started && T.step(b, b.char, dt, true));
  }

  CBZ.onUpdate(23.2, function (dt) {
    if (g.mode !== "gungame" || g.state !== "playing" || !gg.match) return;
    frame++;
    if (!gg.match.over) gg.match.t += dt;

    // player respawn clock (paused screens pause it — onUpdate only runs mid-play)
    if (CBZ.player.dead && gg.respawnT > 0 && !gg.match.over) {
      gg.respawnT -= dt;
      if (gg.respawnT <= 0) respawnPlayer();
    }

    const camx = CBZ.camera.position.x, camz = CBZ.camera.position.z;
    for (let i = 0; i < gg.bots.length; i++) {
      const b = gg.bots[i];
      if (b.dead) {
        if (!gg.match.over) {
          b.respawnT -= dt;
          if (b.respawnT <= 0) respawnBot(b);
        }
        continue;
      }
      // a KO in this mode IS a finish (combat.js's melee can KO instead of
      // kill; an arena has no infirmary — the crowd counts it).
      if (b.ko > 0) { botDeath(b, "player", "beaten cold"); continue; }
      if (gg.match.over) { b.speed = 0; continue; }
      if (CBZ.body && CBZ.body.busy(b)) continue;      // flung / knocked down → body owns it
      if (ggTraverse(b, dt)) continue;                 // a vault owns the whole frame
      const dx = b.pos.x - camx, dz = b.pos.z - camz;
      const near = dx * dx + dz * dz < ANIM_DIST2;
      if ((frame + b.slice) % (near ? 3 : 7) === 0) think(b);
      // locomotion (survivorbot grammar)
      const tx = b.target.x - b.pos.x, tz = b.target.z - b.pos.z;
      const dist = Math.hypot(tx, tz);
      const spd = b.baseSpeed * (b.foe ? 1.35 : 1.0);
      if (dist > 0.5) {
        b.pos.x += (tx / dist) * spd * dt;
        b.pos.z += (tz / dist) * spd * dt;
        if (!b.foe && CBZ.lerpAngle) b.group.rotation.y = CBZ.lerpAngle(b.group.rotation.y, Math.atan2(tx, tz), 1 - Math.pow(0.0008, dt));
        b.speed = spd;
      } else b.speed = 0;
      if (CBZ.collide) CBZ.collide(b.pos, BOT_RADIUS, b.pos.y, b.pos.y + 1.7);
      b.pos.y = mapFloor(b.pos.x, b.pos.z);
      if (near && CBZ.animChar) CBZ.animChar(b.char, b.speed, dt);
      // hold the gun-ready pose EVERY animated frame while engaged — the
      // actorweapons order-36 pose pass is city-only, and animChar just wrote
      // walk-swing over the arms; actorAimAt (after it) turns to the foe and
      // re-applies the ready pose, so the carried gun never droops mid-duel.
      // A FISTS-rung bot only turns (no ready pose — its hands are the gun).
      if (near && b.foe && !b.foe.dead) {
        if (b.armed && CBZ.actorAimAt) CBZ.actorAimAt(b, b.foe, dt);
        else if (CBZ.lerpAngle) {
          const fx = b.foe.pos.x - b.pos.x, fz = b.foe.pos.z - b.pos.z;
          if (fx * fx + fz * fz > 0.01) b.group.rotation.y = CBZ.lerpAngle(b.group.rotation.y, Math.atan2(fx, fz), 1 - Math.pow(0.0005, dt));
        }
      }
      botFire(b, dt);
    }
  });

  // separation — the shared contact solver, exactly survivorbot's wiring
  const sepList = [];
  const playerEntry = { pos: null, _p: true, isPlayer: true, r: 0.55 };
  CBZ.onUpdate(26.2, function (dt) {
    if (g.mode !== "gungame" || !gg.match || !CBZ.humanContact) return;
    sepList.length = 0;
    for (let i = 0; i < gg.bots.length; i++) {
      const b = gg.bots[i];
      if (!b.dead && !(CBZ.body && CBZ.body.busy(b))) sepList.push(b);
    }
    if (!CBZ.player.dead) { playerEntry.pos = CBZ.player.pos; playerEntry.r = CBZ.player.radius || 0.55; sepList.push(playerEntry); }
    CBZ.humanContact.resolve(sepList, dt, {
      mode: "gungame",
      clamp(a) {
        if (CBZ.collide) CBZ.collide(a.pos, a.r || BOT_RADIUS, a.pos.y, a.pos.y + 1.7);
        if (!a._p) a.pos.y = mapFloor(a.pos.x, a.pos.z);
      },
    });
  });

  // ---- island lighting ------------------------------------------------------
  // survival's onAlways(93) only serves ITS mode: in any other mode it parks
  // the sun back on the prison, which would leave a gungame island match lit
  // from 600 u away with a 70 u shadow box. Run right after it (93.6) and
  // re-aim with survival's exact island numbers; restore the escape shadow
  // box ONCE on the way out (survival's own mode latch can't see our writes).
  let islandLit = false;
  CBZ.onAlways(93.6, function () {
    const onIsland = g.mode === "gungame" && curMap().id === "island" && CBZ.surv && CBZ.surv.arena;
    const sun = CBZ.sun;
    if (!onIsland) {
      if (islandLit && sun && sun.shadow) {
        islandLit = false;
        sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
        sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
        sun.shadow.camera.far = 260;
        if (sun.shadow.camera.updateProjectionMatrix) sun.shadow.camera.updateProjectionMatrix();
      }
      return;
    }
    const A = CBZ.surv.arena;
    if (sun) {
      if (!islandLit && sun.shadow) {
        islandLit = true;
        sun.shadow.camera.left = -132; sun.shadow.camera.right = 132;
        sun.shadow.camera.top = 132; sun.shadow.camera.bottom = -132;
        sun.shadow.camera.far = 420;
        if (sun.shadow.camera.updateProjectionMatrix) sun.shadow.camera.updateProjectionMatrix();
      }
      sun.position.set(A.center.x + 70, 140, A.center.z - 50);
    }
    if (CBZ.sunTarget) CBZ.sunTarget.position.set(A.center.x, 6, A.center.z);
  });

  // ---- title-card map picker ------------------------------------------------
  // Buttons are built here (dynamic — the registry is the truth), into the
  // .mode-gungame-only block index.html ships. The note line is the objective
  // line of the title card: it always names the chosen map.
  function refreshNote() {
    const note = document.getElementById("gungameMapNote");
    if (!note) return;
    note.textContent = "Map: " + curMap().label + "  ·  " + ladder().length +
      " rungs, every kill climbs one  ·  final rung: bare fists";
  }
  function setMap(id) {
    g.gungameMap = MAPS[id] ? id : "jail";
    const holder = document.getElementById("gungameMapSelect");
    if (holder) {
      Array.from(holder.children).forEach((c) => c.classList.toggle("active", c.dataset.map === g.gungameMap));
    }
    refreshNote();
  }
  CBZ.setGungameMap = setMap;
  function buildMapButtons() {
    const holder = document.getElementById("gungameMapSelect");
    if (!holder || holder.childElementCount) return;
    Object.keys(MAPS).forEach((id) => {
      const m = MAPS[id];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gg-map-btn" + (g.gungameMap === id ? " active" : "");
      b.dataset.map = id;
      const s = document.createElement("span"); s.textContent = m.label;
      const sm = document.createElement("small"); sm.textContent = m.small;
      b.appendChild(s); b.appendChild(sm);
      b.addEventListener("click", () => setMap(id));
      holder.appendChild(b);
    });
    refreshNote();
  }
  buildMapButtons();

  // ---- the mode descriptor --------------------------------------------------
  function startMatch() {
    const map = curMap();
    if (!map.ensure()) { console.error("[gungame] map failed to build:", map.id); }
    installFloor();
    // borrowed roots: exactly one visible (state.js's setMode lines agree via CBZ.gungameWorlds)
    if (CBZ.prisonRoot) CBZ.prisonRoot.visible = map.id === "jail";
    const A = CBZ.surv && CBZ.surv.arena;
    if (A) {
      A.root.visible = map.id === "island";
      // a fresh arena every match: the island's OWN restore puts back any
      // towers/trees/cars a prior survival round wrecked (idempotent; holes
      // were already emptied by the survival director on mode exit).
      if (map.id === "island" && A.reset) { try { A.reset(); } catch (e) { console.error("[gungame arena reset]", e); } }
    }
    // spawn pool BEFORE the cast disappears (their spots outlive their bodies)
    gg.spawnPool = map.id === "jail" ? harvestJailSpawns() : [];
    if (map.id === "jail") hidePrisonCast();
    else restorePrisonCast();       // island match: prisonRoot is hidden anyway; leave the cast clean for escape
    if (CBZ.fx) CBZ.fx.clear();
    if (CBZ.clearGore) CBZ.clearGore();
    if (CBZ.killFeedReset) CBZ.killFeedReset();
    if (CBZ.clearSpectate) CBZ.clearSpectate();          // never inherit survival's death overlay
    // shared prison combat paths index these; an arena match must not crash them
    g.koLog = g.koLog || {};
    g.kos = g.kos || 0;

    despawnBots();
    gg.playerRung = 0; gg.playerRungKills = 0; gg.playerKills = 0; gg.playerDeaths = 0;
    gg.respawnT = 0; gg.winner = null;
    gg.match = { t: 0, over: false };
    gg.matchesPlayed++;
    spawnBots(Math.max(1, CBZ.CONFIG.GUNGAME_BOTS | 0));

    // the player: far spawn, clean body, rung 0
    const p = spawnPoint("player");
    const gy = mapFloor(p.x, p.z);
    CBZ.player.pos.set(p.x, gy, p.z);
    CBZ.player.vy = 0; CBZ.player.grounded = true;
    CBZ.player.hp = 100; CBZ.player.dead = false; CBZ.player.ko = 0; CBZ.player.stun = 0;
    CBZ.player._death = null;
    if (CBZ.player._phys) { CBZ.player._phys.air = false; CBZ.player._phys.down = 0; CBZ.player._phys.kx = CBZ.player._phys.kz = 0; }
    CBZ.player.stamina = (CBZ.SURV && CBZ.SURV.staminaMax) || 100;
    CBZ.player.sprint = false; CBZ.player.crouch = false;
    CBZ.player.captureState = "normal"; CBZ.player.captureT = 0;
    if (CBZ.playerChar.cuffed) CBZ.playerChar.cuffed = false;
    if (CBZ.player._bandMesh) CBZ.player._bandMesh.visible = false;
    CBZ.playerChar.group.position.copy(CBZ.player.pos);
    CBZ.playerChar.group.rotation.set(0, rand() * 6.28, 0);
    CBZ.playerChar.group.scale.y = 1;
    if (CBZ.cam) { CBZ.cam.yaw = CBZ.playerChar.group.rotation.y + Math.PI; CBZ.cam.pitch = 0.34; }
    if (CBZ.resetZoom) CBZ.resetZoom();
    grantPlayerRung();
    if (CBZ.killstreakReset) CBZ.killstreakReset();
    if (CBZ.setObjective) {
      CBZ.setObjective("GUN GAME on " + map.label + " — every kill advances the ladder; the final rung is bare fists. First through wins.");
    }
  }

  // clean EXIT (state.js calls this whenever setMode leaves gungame): nothing
  // may leak into the next mode — no bots in the shared lists, no rung gun in
  // the inventory, no hidden prison cast, no mid-death ragdoll.
  CBZ.gungameExit = function () {
    despawnBots();
    restorePrisonCast();
    gg.match = null;
    gg.respawnT = 0;
    CBZ.player._death = null;
    if (CBZ.resetWeaponInventory) CBZ.resetWeaponInventory();
    if (CBZ.fpsResetWeapons) CBZ.fpsResetWeapons();
    if (CBZ.killstreakReset) CBZ.killstreakReset();
  };

  CBZ.registerMode("gungame", {
    id: "gungame",
    label: "Gun Game",
    objective: "Pick a map. Everyone starts on the same pistol; every kill advances the killer one rung down the weapon ladder. The final rung is bare fists — land that kill and the match is yours.",
    // build() is deliberately light: the jail exists at boot and the island is
    // only ensured at match start (reset), so clicking the mode button never
    // pays for a world the chosen map might not need.
    build() { buildMapButtons(); },
    reset() { startMatch(); },
    winStats() {
      return [
        { label: "Rungs", value: ladder().length + "/" + ladder().length },
        { label: "Kills", value: gg.playerKills },
        { label: "Match time", value: CBZ.fmtTime ? CBZ.fmtTime(g.elapsed) : "--" },
      ];
    },
  });

  // ---- audit (the orchestrator runs this) -----------------------------------
  CBZ.gungameAudit = function () {
    const L = ladder();
    let alive = 0, listed = 0, leadBot = null;
    for (const b of gg.bots) {
      if (!b.dead) alive++;
      if (!leadBot || b.rung > leadBot.rung || (b.rung === leadBot.rung && b.kills > leadBot.kills)) leadBot = b;
    }
    for (const n of CBZ.npcs || []) if (n && n._ggBot) listed++;
    const leaderRung = Math.max(gg.playerRung, leadBot ? leadBot.rung : 0);
    return {
      on: CBZ.CONFIG.GUNGAME_V1 !== false,
      maps: Object.keys(MAPS),
      map: g.gungameMap || "jail",
      rungs: L.length,
      killsPerRung: Math.max(1, CBZ.CONFIG.GUNGAME_KILLS_PER_RUNG | 0),
      bots: gg.bots.length,
      aliveBots: alive,
      npcListed: listed,           // must equal bots mid-match and 0 outside the mode
      playerRung: gg.playerRung,
      leaderRung: leaderRung,
      leaderName: leadBot && leadBot.rung > gg.playerRung ? leadBot.name : "You",
      matchesPlayed: gg.matchesPlayed,
      matchOver: !!(gg.match && gg.match.over),
      spawnPool: gg.spawnPool.length,
      hiddenCast: gg.hiddenCast.length,
      borrowedWorlds: { jail: !!CBZ.prisonRoot, island: !!(CBZ.surv && CBZ.surv.built) },
    };
  };
})();
