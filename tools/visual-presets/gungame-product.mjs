/* Gun Game — PRODUCT PHOTOGRAPHY, shot by the engine.

   Store covers for GUN GAME (index.html?mode=gungame): the weapon-ladder
   deathmatch modes/gungame.js runs on a borrowed map. No generated art, no
   posed dummies: the real match starts through the title's own PLAY button,
   the real bots spawn through spawnBots, the player is armed through
   CBZ.unlockWeapon and fires through CBZ.fpsFire, the bot fires through its
   own botFire (fireCD zeroed, nothing else), and a knockout is CBZ.punch
   landing on a bot with 4 hp left, which is exactly how a fists-rung finish
   happens in play. The lens is then fitted to the two bodies for whatever
   ratio ba was asked for and the sun is pinned to golden hour.

   Portal rules this obeys (docs.crazygames.com/requirements/game-covers):
     16:9 1920x1080 · 2:3 800x1200 · 1:1 800x800 — no borders, no text but the
     title, no icons.

   Run (one ratio per run, the lens re-fits itself):
     ba gungame-product --before local --only after --width 1920 --height 1080 \
        --out ~/harness/out/gta6/portal/gungame --no-open --cdp-timeout 600000
     ba gungame-product ... --width 800 --height 800
     ba gungame-product ... --width 800 --height 1200

   HARNESS TRAP: stage() is SERIALIZED into the page by toString(); nothing
   from this module's scope is reachable inside it. Every knob rides on
   input.subject, and the title/sun constants are inlined below.

   THE TWO MAPS COST TWO MATCHES. Subjects run in declaration order on one
   page; a subject on a different map than the last one restarts the match
   through CBZ.startRun (the island build is paid once — survival's build()
   guard keeps it). Keep same-map subjects adjacent. */

const subjects = [
  { id: 'cover-firefight', map: 'island', kind: 'fire', playerRung: 4, botRung: 3, duelM: 6.5, sun: 0.40,
    label: 'Two players trading fire · Disaster Island',
    focus: 'Low and close behind the player\'s hip: AK against carbine at six metres on a street of the island, both muzzles lit, the bot\'s round in the air, the island\'s towers and hills behind. Every body, gun and round is the shipped match.' },
  { id: 'cover-ladder', map: 'jail', kind: 'ko', playerRung: 8, botRung: 7, duelM: 1.75, sun: 0.35,
    label: 'The winning rung · bare fists · the knockout',
    focus: 'The final rung is categorical: whoever holds the Desert Eagle rung loses it to a punch. The player has climbed every gun and stands with nothing in his hands; the hook has just landed and the bot is leaving the ground. Jail yard, golden hour.' },
];

async function stage(input) {
  const C = window.CBZ, T = window.THREE;
  if (!C || !T) return { ok: false, missing: 'CBZ/THREE' };
  const sub = input.subject;
  const TITLE = 'GUN GAME';
  // CBZ.dayPhase: 0 sunrise, .25 noon, .5 sunset; daynight.js's sun height is
  // sin(phase*2pi). Measured: .47 (height .19) lights the prison with a
  // 0.46-intensity ac969d sun under a 7a7988 hemisphere — a murky grey, the
  // dusk burn lives in the sky dome, not the light — so both covers stay in
  // the bright afternoon (.35 / .40) where the shadows are long but the
  // colours are still the game's.
  const SUN = sub.sun != null ? sub.sun : 0.40;
  const LADDER = { 0: 'sidearm', 1: 'smg', 2: 'shotgun', 3: 'carbine', 4: 'ak47', 5: 'lmg', 6: 'sniper', 7: 'deagle' };
  const LADDER_NAME = { 0: 'Pistol', 1: 'SMG', 2: 'Shotgun', 3: 'Rifle', 4: 'AK-47', 5: 'LMG', 6: 'Sniper', 7: 'Desert Eagle' };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const tick = (n) => {
    for (let i = 0; i < n; i++) {
      C.hitstop = 0; C.slowmo = 0;
      C.stepSim(1 / 60);
      if (C.player) { C.player.hp = 100; C.player.dead = false; }
    }
  };
  const floorAt = (x, z) => {
    if (C.floorAt) { try { const y = C.floorAt(x, z); if (isFinite(y)) return y; } catch (_) {} }
    return 0;
  };

  // ---- boot once ------------------------------------------------------------
  let S = window.__ggProduct;
  if (!S) {
    const booted = await until(() => C.game && (C.bootComplete || C.game.state === 'title') &&
      C.stepSim && document.getElementById('playBtn'), 540000);
    if (!booted) return { ok: false, err: 'never booted' };
    S = window.__ggProduct = { map: null, matches: 0 };
    window.__cbzVisualCompare = {
      render() { try { C.renderer.render(C.scene, C.camera); } catch (_) {} },
    };
  }

  // ---- the match, on the subject's map ---------------------------------------
  if (S.map !== sub.map) {
    if (C.game.state !== 'playing' && C.game.mode !== 'gungame') {
      // the title's own mode button — the path a player takes
      const btn = document.querySelector('.mode-btn[data-mode="gungame"]');
      if (btn) btn.click(); else if (C.setMode) C.setMode('gungame');
    }
    if (C.setGungameMap) C.setGungameMap(sub.map);
    if (C.game.state !== 'playing') {
      const playing = await until(() => {
        if (C.game.state === 'playing') return true;
        const b = document.getElementById('playBtn');
        if (b) b.click();
        return C.game.state === 'playing';
      }, 240000, 300);
      if (!playing) return { ok: false, err: 'never reached playing (state ' + C.game.state + ')' };
    } else if (C.startRun) {
      C.startRun();                      // a new match on the other map (the island build is kept)
    }
    window.requestAnimationFrame = function () { return 0; };
    await wait(600);
    // the arrival cinematic owns the camera and the body for 3.55 s and
    // hands off into first person; step through all of it, then leave FP
    tick(300);
    if (C.fpsSetActive) C.fpsSetActive(false);
    S.map = sub.map; S.matches++;
    if (C.game.mode !== 'gungame') return { ok: false, err: 'mode is ' + C.game.mode + ', not gungame' };
  }
  const gg = C.gungame;
  if (!gg || !gg.match || !gg.bots.length) return { ok: false, err: 'no match / no bots' };

  // ---- the stage: a flat duel line with a backdrop ---------------------------
  // ISLAND: a street inside the downtown ring, the player looking INTO the
  // skyline so the towers stand behind the bot. JAIL: the north yard (flat,
  // open — gunpoint-studio.mjs's own stage), looking down its length.
  // SOLIDS ARE BOXES. CBZ.clearLineOfFire only knows the city's LOS blockers
  // (city/los.js) and answers "clear" for everything on the island, which is
  // how round 2's lens ended up INSIDE a parked car (the "dark slabs" across
  // the frame were its roof and seats). CBZ.colliders holds every solid the
  // body physics knows — {minX,maxX,minZ,maxZ, y0?,y1?} — so both bodies and
  // every lens are tested against those directly.
  const cols = C.colliders || [];
  const inSolid = (x, z, m) => { for (let i = 0; i < cols.length; i++) { const c = cols[i]; if (x > c.minX - m && x < c.maxX + m && z > c.minZ - m && z < c.maxZ + m) return true; } return false; };
  const segSolid = (ax, az, bx, bz, y) => {
    const dx = bx - ax, dz = bz - az;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.y0 != null && c.y1 != null && (y < c.y0 || y > c.y1)) continue;
      let t0 = 0, t1 = 1;
      if (Math.abs(dx) < 1e-9) { if (ax < c.minX || ax > c.maxX) continue; }
      else { let ta = (c.minX - ax) / dx, tb = (c.maxX - ax) / dx; if (ta > tb) { const q = ta; ta = tb; tb = q; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
      if (Math.abs(dz) < 1e-9) { if (az < c.minZ || az > c.maxZ) continue; }
      else { let ta = (c.minZ - az) / dz, tb = (c.maxZ - az) / dz; if (ta > tb) { const q = ta; ta = tb; tb = q; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
      return true;
    }
    return false;
  };
  // every lens this preset may use for a site (both ratios, both subjects),
  // as [back, side, height] off the player along the duel line
  const LENSES = [[2.4, -1.2, 0.95], [2.9, -1.55, 1.2], [1.4, 3.0, 0.85], [0.9, 2.4, 1.05]];
  const siteClear = (px, pz, bx, bz, ux, uz, h0, hb) => {
    if (inSolid(px, pz, 0.7) || inSolid(bx, bz, 0.7)) return false;
    if (segSolid(px, pz, bx, bz, h0 + 1.3)) return false;
    const rx = uz, rz = -ux;
    for (const [back, side, h] of LENSES) {
      const ex = px - ux * back + rx * side, ez = pz - uz * back + rz * side, ey = h0 + h;
      if (inSolid(ex, ez, 1.3)) return false;
      if (segSolid(ex, ez, bx, bz, ey) || segSolid(ex, ez, px, pz, ey) || segSolid(ex, ez, px + ux * 3, pz + uz * 3, ey)) return false;
    }
    return true;
  };
  let P, B;
  if (sub.map === 'island') {
    const A = C.surv && C.surv.arena;
    if (!A) return { ok: false, err: 'no island arena' };
    const cx = A.center.x, cz = A.center.z, R = A.radius;
    const wet = (x, z) => C.survSeaHeightAt ? (A.groundHeightAt(x, z) < C.survSeaHeightAt(x, z) + 0.3) : false;
    let best = null, bestScore = Infinity;
    for (let i = 0; i < 240; i++) {
      const a = (i / 240) * Math.PI * 2;
      for (const rad of [0.30, 0.36, 0.42, 0.48, 0.54]) {
        const px = cx + Math.cos(a) * R * rad, pz = cz + Math.sin(a) * R * rad;
        const dx = (cx - px), dz = (cz - pz), dl = Math.hypot(dx, dz) || 1;
        const ux = dx / dl, uz = dz / dl;
        const bx = px + ux * sub.duelM, bz = pz + uz * sub.duelM;
        if (wet(px, pz) || wet(bx, bz)) continue;
        const h0 = A.groundHeightAt(px, pz);
        let rough = 0, bad = false;
        for (let s = -2; s <= 12; s += 2) {
          for (const side of [-1.5, 0, 1.5]) {
            const x = px + ux * s - uz * side, z = pz + uz * s + ux * side;
            const h = A.groundHeightAt(x, z);
            if (!isFinite(h)) { bad = true; break; }
            rough = Math.max(rough, Math.abs(h - h0));
          }
          if (bad) break;
        }
        if (bad) continue;
        const score = rough * 10 + Math.abs(rad - 0.42);
        if (score >= bestScore) continue;
        if (!siteClear(px, pz, bx, bz, ux, uz, h0, A.groundHeightAt(bx, bz))) continue;
        if (score < bestScore) { bestScore = score; best = { px, pz, bx, bz }; }
      }
    }
    if (!best) return { ok: false, err: 'no flat duel line on the island' };
    P = { x: best.px, z: best.pz }; B = { x: best.bx, z: best.bz };
  } else {
    P = { x: 0, z: 30 }; B = { x: 0, z: 30 - sub.duelM };
    if (!siteClear(P.x, P.z, B.x, B.z, 0, -1, 0, 0)) return { ok: false, err: 'the north yard mark is not clear' };
  }
  P.y = floorAt(P.x, P.z); B.y = floorAt(B.x, B.z);
  const faceYaw = Math.atan2(B.x - P.x, B.z - P.z);     // rig faces (sin y, cos y)

  // ---- the cast: one bot on the mark, the rest out of the frame -------------
  const bot = gg.bots[0];
  for (const o of gg.bots) {
    if (o === bot) continue;
    o.dead = true; o.respawnT = 1e9; o.hp = 0;
    if (o.group) o.group.visible = false;
  }
  const park = () => {
    bot.dead = false; bot.ko = 0; bot.respawnT = 0; bot.baseSpeed = 0; bot.speed = 0;
    bot.pos.set(B.x, B.y, B.z); bot.target.set(B.x, 0, B.z);
    bot.group.rotation.y = Math.atan2(P.x - B.x, P.z - B.z);
    if (bot._phys) { bot._phys.down = 0; bot._phys.air = false; bot._phys.kx = 0; bot._phys.kz = 0; }
    if (bot.group && !bot.group.parent) C.scene.add(bot.group);
    bot.group.visible = true;
    C.player.driving = false; C.player._swim = false; C.player.dead = false;
    C.player.pos.set(P.x, P.y + 0.05, P.z);
    C.player.vy = 0; C.player.grounded = true; C.player.hp = 100; C.player.ko = 0; C.player.stun = 0;
    C.player.crouch = false; C.player.prone = false; C.player.sprint = false;
    if (C.playerChar && C.playerChar.group) { C.playerChar.group.position.copy(C.player.pos); C.playerChar.group.rotation.y = faceYaw; }
    if (C.cam) { C.cam.yaw = faceYaw + Math.PI; C.cam.pitch = 0.02; }
    if (C.fpsSetActive && C.fps && C.fps.active) C.fpsSetActive(false);
  };
  // rungs: the bot's gun is the bot's rung (actorweapons draws it); the
  // player's rung is the one gun in the inventory — or nothing at all
  bot.rung = sub.botRung; bot.armed = true; bot.weapon = LADDER_NAME[sub.botRung];
  if (C.syncActorWeapon) C.syncActorWeapon(bot);
  gg.playerRung = sub.playerRung; gg.playerRungKills = 0;
  const arm = () => {
    if (C.game) { C.game.cityHolstered = false; C.game.cityMeleeWeapon = null; }
    if (C.resetWeaponInventory) C.resetWeaponInventory();
    if (LADDER[sub.playerRung] && C.unlockWeapon) C.unlockWeapon(LADDER[sub.playerRung], { select: true });
    if (C.fpsResetWeapons) C.fpsResetWeapons();
    if (C.fpsAddAmmo && LADDER[sub.playerRung]) { try { C.fpsAddAmmo(200); } catch (_) {} }
  };
  arm();
  if (C.fpsSetAim) C.fpsSetAim(sub.kind === 'fire');
  // settle: re-granting a rung drops the player back into first person, and
  // the bot's brain re-targets every third frame — hold both on the mark
  for (let i = 0; i < 48; i++) { if (i % 12 === 0) arm(); park(); bot.hp = 100; tick(1); }
  park(); bot.hp = 100;

  // ---- the sun ----------------------------------------------------------------
  if (typeof C.dayPhase === 'function') { C.dayPhase(SUN); for (let i = 0; i < 4; i++) { park(); bot.hp = 100; tick(1); } }

  // ---- the moment -----------------------------------------------------------
  const shots = [];
  const origTracer = C.tracer;
  C.tracer = function (from, to, opts) {
    shots.push({ shooter: opts && opts.shooter === bot ? 'bot' : (opts && opts.shooter === C.player ? 'player' : 'other'),
      from: [from.x, from.y, from.z].map((v) => +v.toFixed(2)) });
    return origTracer.apply(this, arguments);
  };
  let landed = null;
  if (sub.kind === 'fire') {
    // the bot fires through its own botFire: cooldown zeroed, LOS its own test
    bot.foe = null;
    let botShot = false;
    for (let i = 0; i < 90 && !botShot; i++) {
      park(); bot.hp = 100; bot.fireCD = 0; bot.burst = 0;
      const n = shots.length;
      tick(1);
      botShot = shots.slice(n).some((s) => s.shooter === 'bot');
    }
    // A round aimed at the player gets gunfx.js's "that one's aimed at YOU"
    // halo — 3x the muzzle scale, 0.16 s — which in a still is a ball of
    // light the size of the man (round 1). Four frames on, it is a flash.
    for (let i = 0; i < 6; i++) { park(); bot.hp = 100; tick(1); }
    // the player fires LAST, through the trigger the mouse uses: his flash is
    // a worldMuzzle sprite that fades in 0.065 s, so no step follows it. The
    // bot is given deep hp for this one round: a lethal hit would run
    // botDeath (ragdoll + a rung advance that swaps the AK for the LMG).
    park(); bot.hp = 100000;
    const roundsBefore = C.fps && C.fps.rounds ? C.fps.rounds[C.fps.weapon] : null;
    if (C.fpsFire) { C.fpsFire(true); C.fpsFire(false); }
    const roundsAfter = C.fps && C.fps.rounds ? C.fps.rounds[C.fps.weapon] : null;
    landed = { botShot, playerFired: roundsBefore != null && roundsAfter < roundsBefore, roundsBefore, roundsAfter,
      weaponIndex: C.fps && C.fps.weapon, reloading: C.fps && C.fps.reloading, bullets: C.fpsBulletsInFlight ? C.fpsBulletsInFlight() : null };
  } else {
    // three punches: jab, cross, then the hook that finishes a 4 hp man.
    // combat.js's combo counter is the real one (punches < 980 ms apart).
    const swing = (hp) => { park(); bot.hp = hp; if (C.fpsSetAim) C.fpsSetAim(false); const r = C.punch(bot); if (C.fpsPunchAnim && r && r.ok) C.fpsPunchAnim(); return r; };
    const r1 = swing(100); for (let i = 0; i < 26; i++) { park(); bot.hp = 100; tick(1); }
    const r2 = swing(100); for (let i = 0; i < 26; i++) { park(); bot.hp = 100; tick(1); }
    // THE WIN IS STUBBED FOR THE SHOT: this kill completes the ladder, and
    // matchWon → CBZ.winGame flips game.state out of "playing", which stops
    // every updater — the ragdoll would freeze on the frame it was hit.
    const winGame = C.winGame; C.winGame = function () {};
    // the finishing blow sprays through goreImpact; the drops are sized by
    // the game's own GORE_DROP_SCALE tuning — a cover wants them small
    const dropScale = C.CONFIG.GORE_DROP_SCALE; C.CONFIG.GORE_DROP_SCALE = 0.3;
    const r3 = swing(4);
    // the hook lands at 0.19 s and execute() restarts the hook swing on the
    // frame it lands (punchT = 0.4), so a fifth of a second later the arm is
    // driven through the target and the body is off the ground
    let frames = 0;
    for (; frames < 40; frames++) {
      C.hitstop = 0; C.slowmo = 0; C.stepSim(1 / 60);
      C.player.hp = 100; C.player.dead = false;
      if (bot.dead) break;
    }
    // measured: 12 frames put the body 5.9 m away and out of the frame's
    // edge; 8 keeps it inside the lens below with the arm still driving
    for (let i = 0; i < 8; i++) { C.hitstop = 0; C.slowmo = 0; C.stepSim(1 / 60); C.player.hp = 100; C.player.dead = false; }
    C.winGame = winGame; C.CONFIG.GORE_DROP_SCALE = dropScale;
    landed = { punches: [r1 && r1.ok, r2 && r2.ok, r3 && r3.ok], botDead: !!bot.dead, framesToDeath: frames,
      botLift: +(bot.pos.y - B.y).toFixed(2), playerPunchT: +(C.playerChar.punchT || 0).toFixed(2), punchKind: C.playerChar.punchKind };
  }
  C.tracer = origTracer;

  // ---- clean frame ------------------------------------------------------------
  const canvas = C.renderer && C.renderer.domElement;
  for (const el of Array.from(document.body.children)) {
    if (el === canvas || (canvas && el.contains && el.contains(canvas))) continue;
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
    el.style.setProperty('display', 'none', 'important');
  }
  if (C.bootMeter && C.bootMeter.hide) { try { C.bootMeter.hide(); } catch (_) {} }
  if (C.playerChar && C.playerChar.group) C.playerChar.group.visible = true;

  // ---- the lens, fitted to the two bodies for this ratio -----------------------
  const cam = C.camera, aspect = innerWidth / innerHeight;
  const k = Math.max(0, Math.min(1, (aspect - 0.667) / (1.778 - 0.667)));   // 0 = portrait 2:3, 1 = landscape 16:9
  const dx = B.x - P.x, dz = B.z - P.z, dl = Math.hypot(dx, dz) || 1;
  const ux = dx / dl, uz = dz / dl;            // player → bot
  const rx = uz, rz = -ux;                     // the player's right
  let eye, aim, fov;
  if (sub.kind === 'fire') {
    // behind the player's left hip, at waist height, looking past his gun at
    // the bot: portrait stands closer and higher so both fit the tall frame
    const back = 2.4 + 0.5 * (1 - k), side = -(1.2 + 0.35 * (1 - k)), h = 0.95 + 0.25 * (1 - k);
    eye = new T.Vector3(P.x - ux * back + rx * side, P.y + h, P.z - uz * back + rz * side);
    aim = new T.Vector3(P.x + ux * dl * (0.45 + 0.1 * k), P.y + 1.15 + 0.15 * (1 - k), P.z + uz * dl * (0.45 + 0.1 * k));
    fov = 52 + 12 * (1 - k);
  } else {
    // three-quarter from the player's right, low, the bot flying away to the
    // left: the aim point sits where the body IS after the flight, not on the
    // mark it left
    // (measured at 2:3 with the landscape offsets: the player was a shoulder
    // at the right edge — a tall frame has to swing round BEHIND him)
    const back = 1.2 + 0.9 * (1 - k), side = 3.8 - 1.5 * (1 - k), h = 0.9 + 0.2 * (1 - k);
    eye = new T.Vector3(P.x - ux * back + rx * side, P.y + h, P.z - uz * back + rz * side);
    const bd = Math.min(4.2, Math.hypot(bot.pos.x - P.x, bot.pos.z - P.z));
    const along = 0.55 - 0.15 * (1 - k);
    aim = new T.Vector3(P.x + ux * bd * along, P.y + 1.1 + 0.2 * (1 - k), P.z + uz * bd * along);
    fov = 50 + 14 * (1 - k);
  }
  // never inside the ground
  eye.y = Math.max(eye.y, floorAt(eye.x, eye.z) + 0.45);
  cam.fov = fov; cam.aspect = aspect; cam.updateProjectionMatrix();
  cam.position.copy(eye); cam.up.set(0, 1, 0); cam.lookAt(aim); cam.updateMatrixWorld(true);

  // ---- the title — the one word a cover may carry -----------------------------
  let title = document.getElementById('ggProductTitle');
  if (!title) { title = document.createElement('div'); title.id = 'ggProductTitle'; document.body.appendChild(title); }
  const px = Math.round(Math.min(innerWidth * 0.15, innerHeight * 0.17));
  title.style.cssText = 'position:fixed;z-index:2147483647;top:' + (aspect < 1 ? 6 : 5) + '%;left:4%;right:4%;text-align:center;color:#fff;font-family:Fredoka,\'Arial Black\',Impact,Arial,sans-serif;font-weight:900;font-size:' + px + 'px;line-height:.86;letter-spacing:-.04em;text-shadow:0 5px 0 #3a1408,0 10px 28px rgba(20,6,2,.9);pointer-events:none;display:block';
  title.textContent = TITLE;

  window.__cbzVisualCompare.render();
  return {
    ok: true, subject: sub.id, map: sub.map, matches: S.matches,
    player: { x: +P.x.toFixed(1), y: +P.y.toFixed(2), z: +P.z.toFixed(1), rung: gg.playerRung, armed: !!(C.playerArmed && C.playerArmed()), fps: !!(C.fps && C.fps.active) },
    bot: { name: bot.name, rung: bot.rung, weapon: bot.weapon, dead: !!bot.dead, x: +bot.pos.x.toFixed(1), y: +bot.pos.y.toFixed(2), z: +bot.pos.z.toFixed(1) },
    shots: shots.length, landed,
    camera: { eye: eye.toArray().map((v) => +v.toFixed(2)), aim: aim.toArray().map((v) => +v.toFixed(2)), fov, aspect: +aspect.toFixed(3) },
    width: innerWidth, height: innerHeight,
    scene: { fog: C.scene.fog ? [C.scene.fog.color.getHexString(), C.scene.fog.near, C.scene.fog.far] : null,
      background: C.scene.background && C.scene.background.getHexString ? C.scene.background.getHexString() : String(C.scene.background),
      skyDome: !!(C.skyDome && C.skyDome.visible), sunHeight: C.sunHeight, dayPhase: typeof C.dayPhase === 'function' ? +C.dayPhase().toFixed(3) : null,
      sun: C.sun ? { i: +C.sun.intensity.toFixed(2), c: C.sun.color.getHexString(), pos: C.sun.position.toArray().map((v) => Math.round(v)) } : null,
      hemi: C.hemi ? { i: +C.hemi.intensity.toFixed(2), c: C.hemi.color.getHexString() } : null,
      prisonRoot: !!(C.prisonRoot && C.prisonRoot.visible), island: !!(C.surv && C.surv.arena && C.surv.arena.root.visible),
      ocean: !!(C.surv && C.surv.arena && C.surv.arena.ocean && C.surv.arena.ocean.visible),
      nearCar: (() => { const A = C.surv && C.surv.arena; if (!A || !A.cars) return null; let d = 1e9, n = null;
        for (const c of A.cars) { const o = c.group || c.mesh || c; if (!o || !o.position) continue; const dd = Math.hypot(o.position.x - eye.x, o.position.z - eye.z); if (dd < d) { d = dd; n = [Math.round(o.position.x), Math.round(o.position.z)]; } }
        return { d: Math.round(d), at: n, count: A.cars.length }; })() },
  };
}

export default {
  id: 'gungame-product',
  title: 'Gun Game — in-engine product photography',
  description: 'Store covers for GUN GAME, staged in the shipped build: the match starts through the title\'s PLAY button on the chosen map, the bot on camera is a real match bot on its real rung firing through its own brain, the player fires through the mouse\'s own trigger and knocks out through CBZ.punch, the sun is pinned at golden hour and the lens is fitted to the two bodies for whatever ratio the run asks for.',
  defaultBefore: 'local',
  beforeLabel: 'SOURCE GAME', afterLabel: 'PRODUCT CAPTURE',
  viewport: { width: 1920, height: 1080 },
  readyExpression: 'window.THREE && window.CBZ && CBZ.CONFIG',
  urlParams: { mode: 'gungame', seed: 90210 },
  stageTimeoutMs: 900000,
  pairNote: 'Every pixel is the game rendering its own match · title is the only overlay',
  metrics: {}, metricsNote: 'Product captures, not a gameplay score.',
  subjects, stage,
};
