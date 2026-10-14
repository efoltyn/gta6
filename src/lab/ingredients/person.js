/* lab ingredient "person": one of the game's people, on the shared stack.

   THE BODY is the shipped rig, dressed by role (core/stage.js cast -> CBZ.human
   -> entities/character.js), animated by CBZ.animChar on the speed the body
   actually achieved. THE LEGS are CBZ.moves (entities/moves.js: acceleration,
   arrival, turn rate) with CBZ.collide against the world. SITTING is the one
   furniture layer (systems/rest.js -> city/propuse.js propSit ->
   entities/moves_posture.js's walk / turn / back-step / lower sequencer).
   THE MIND is CBZ.brain (systems/brain.js): registered under the archetype of
   its role, ticked every frame with what it perceives, its INTENT applied
   below. Hands-up / aim-back / cower are drawn by systems/reactions.js off the
   same pose flags the prison and the city set (poseHandsUp, poseAimBack,
   poseCower, aiState "flee"), and a drawn gun is systems/actorweapons.js's.

   THE ACTOR is the engine's PLAIN ACTOR shape (the prison inmate's: group,
   char, target, pause, speed) and sits in CBZ.npcs, the roster the shared
   systems already sweep: pushables shoves furniture with it, reactions poses
   it, rest walks it by its `target`. Nothing here is a second person system.

   WHAT IS THE LAB'S OWN (the per-game seam every game writes): the executor
   that turns a brain INTENT into those fields (flee -> target + run speed,
   surrender -> poseHandsUp, comply -> CBZ.moves.kneel, fight with a gun ->
   CBZ.actorAimAt ...), the same job city/brain_city.js perform() does for a
   city ped, and the per-frame mover loop (survivorbot.js's: CBZ.moves.step,
   CBZ.collide, CBZ.animChar), registered at update order 22 like the jail's
   npc brain.

   opts: at [x, z], yaw (deg), role civilian|gang|cop|guard|inmate|thug|soldier|
         worker|exec, nerve 0..1 (absolute break point), weapon "Pistol"|"SMG"|...
         (armed, holstered until the brain or the kit draws it), brain false
         (a puppet: walks and sits, decides nothing), speed (walk m/s)
   handle: walkTo(x,z,speed) sit(chairHandle) stand() draw() holster()
           aimAt(handle) lower() say(line) pose() response() */
(function () {
  const ROLE = {
    // role -> { cast: core/stage.js CASTING id, arch: CBZ.brain archetype, faction }
    civilian: { cast: "civilian", arch: "civilian", faction: "civilians" },
    worker:   { cast: "worker",   arch: "civilian", faction: "civilians" },
    exec:     { cast: "exec",     arch: "civilian", faction: "civilians" },
    gang:     { cast: "thug",     arch: "ganger",   faction: "gang:lab" },
    thug:     { cast: "thug",     arch: "ganger",   faction: "gang:lab" },
    cop:      { cast: "guard",    arch: "cop",      faction: "law", weapon: "Pistol" },
    guard:    { cast: "guard",    arch: "guard",    faction: "law", weapon: "Pistol" },
    inmate:   { cast: "civilian", arch: "inmate",   faction: "inmates" },
    soldier:  { cast: "soldier",  arch: "swat",     faction: "army", weapon: "Pistol" },
    // one of YOUR people (careers.js cityRecruit's shooter): the crew archetype,
    // the player's side, a pistol on the belt
    crew:     { cast: "thug",     arch: "crew",     faction: "player", weapon: "Pistol" },
  };
  const LAB_GAME = "lab";
  const R3 = function (v) { return Math.round(v * 1000) / 1000; };
  const people = [];

  /* ---- THE LAB'S BRAIN EXECUTOR (act.use) -------------------------------- */
  let execOn = false;
  function installExecutor() {
    if (execOn || !CBZ.brain || !CBZ.brain.act) return;
    execOn = true;
    CBZ.brain.act.use(LAB_GAME, {
      moveTo: function (a, x, z, o) { a.target.set(x, 0, z); a._spd = (o && o.speedMps) || a.speed; a.pause = 0; return true; },
      stop: function (a) { const p = a.group.position; a.target.set(p.x, 0, p.z); a._spd = 0; return true; },
      face: function (a, x, z) { a._faceYaw = Math.atan2(x - a.group.position.x, z - a.group.position.z); return true; },
      posture: function (a, p) { return applyPosture(a, p); },
      say: function (a, line) { if (CBZ.speech && CBZ.speech.say) { try { CBZ.speech.say(a, line); } catch (e) {} } if (a._lab) a._lab.W.event(a.labName, "says \"" + line + "\""); return true; },
    });
  }

  function applyPosture(a, p) {
    const M = CBZ.moves, ch = a.char;
    a.poseHandsUp = p === "handsUp" || p === "kneel";
    if (ch) ch.handsUp = a.poseHandsUp;
    a.poseCower = p === "cower";
    if (p === "kneel" && M && M.kneel) { if (M.posture(a) !== "kneel") M.kneel(a, a._threatSrc ? { face: faceTo(a, a._threatSrc) } : {}); }
    else if (p === "crouch" && M && M.crouch) M.crouch(a, true);
    else if (M && (p === "stand" || p === "handsUp" || p === "cower" || p === "aim")) {
      const cur = M.posture(a);
      if (cur === "crouch") M.crouch(a, false);
      else if (cur === "kneel" && p !== "handsUp") M.stand(a);
    }
    return true;
  }
  function posOf(x) { return x && (x.pos || (x.group && x.group.position)) || null; }
  function faceTo(a, src) { const p = posOf(src), q = a.group.position; return p ? Math.atan2(p.x - q.x, p.z - q.z) : a.group.rotation.y; }

  /* ---- THE THREAT A GUN MAKES, AS THE TARGET PERCEIVES IT ----------------
     For every armed body with a gun OUT in the world: can this person see it
     (CBZ.brain.perception.sees: the archetype's cone, range, light and the
     occlusion ray), and is the muzzle ON him (the barrel's real world
     direction from systems/actorweapons.js's muzzle socket, passing within
     0.7 m of his chest)? A seen, levelled gun is the threat record
     CBZ.brain.threat.respond reads: armed, aimingAtMe, distance, weapon. */
  const _th = { source: null, x: 0, z: 0, armed: true, aimingAtMe: false, hostile: false, distance: 0, kind: "gun", weapon: "gun", reloading: false, yaw: null };
  function muzzleRay(g) {
    const THREE = window.THREE;
    if (g._labPlayerGun) return g._labPlayerGun();          // the player's (ingredients/player.js)
    if (!g.char || !g._weaponProp || !g._weaponProp.visible) return null;
    const prop = g._weaponProp;
    prop.updateMatrixWorld(true);
    const o = CBZ.actorMuzzle ? CBZ.actorMuzzle(g, new THREE.Vector3()) : prop.getWorldPosition(new THREE.Vector3());
    // THE SHOT'S WAY is the model's own: the anchor contract
    // (weapons/appearances/sidearm.js) gives the muzzle a frame whose -Z is
    // the bore; a model without one shoots down its local -Z
    const q = prop.getWorldQuaternion(new THREE.Quaternion());
    const A = prop.userData && prop.userData.anchors, mq = A && A.muzzle && A.muzzle.quat;
    if (mq) q.multiply(mq.isQuaternion ? mq : new THREE.Quaternion(mq[0], mq[1], mq[2], mq[3]));
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize();
    return { o: o, d: d };
  }
  function nearestGun(a) {
    const all = (CBZ.lab.W && CBZ.lab.W.armed) || [];
    let best = null, bd = 1600;
    const p = a.group.position;
    for (let i = 0; i < all.length; i++) {
      const g = all[i];
      if (!g || g === a || g.dead || !g.armed) continue;
      const q = posOf(g), d2 = (q.x - p.x) * (q.x - p.x) + (q.z - p.z) * (q.z - p.z);
      if (d2 < bd) { bd = d2; best = g; }
    }
    return best;
  }
  // who a gun is being pointed at on purpose (the kit's / brain's aim order)
  function gunOn(g) { return g._aimAt || (g._labAimAt ? g._labAimAt() : null); }
  function threatOn(a) {
    let best = null, bd = Infinity;
    const all = (CBZ.lab.W && CBZ.lab.W.armed) || [];
    for (let i = 0; i < all.length; i++) {
      const g = all[i];
      if (!g || g === a || g.dead) continue;
      // A GUN ON YOUR OWN SIDE IS NOT A THREAT (the city's gunDiscipline.sameSide):
      // two men working for the same people (CBZ.brain.job's side) stand
      // beside each other's drawn pistols all day
      if (sameJob(a, g)) continue;
      const ray = muzzleRay(g);
      if (!ray) continue;
      const gp = posOf(g), ap = a.group.position;
      const dist = Math.hypot(gp.x - ap.x, gp.z - ap.z);
      if (dist > 40) continue;
      // SEEN = the brain's own awareness meter has filled (perception.spotted:
      // instant inside 2.6 m, otherwise a rate off distance, light, the
      // cone's centre and how the gunman moves): a man needs a beat to clock
      // a drawn gun, and that beat is the brain's, not the lab's
      const sees = CBZ.brain.perception.spotted ? CBZ.brain.perception.spotted(a, g) : CBZ.brain.perception.sees(a, g);
      // the barrel line's closest pass to the chest (1.25 m up)
      const cx = ap.x - ray.o.x, cy = ap.y + 1.25 - ray.o.y, cz = ap.z - ray.o.z;
      const along = cx * ray.d.x + cy * ray.d.y + cz * ray.d.z;
      const miss = along > 0 ? Math.sqrt(Math.max(0, cx * cx + cy * cy + cz * cz - along * along)) : 99;
      /* "IS IT ON ME" is the GAME'S gunpoint test, not the barrel line:
         city/peds.js _gunpointOne counts a body as covered inside 11 m and
         the gunman's aim cone (dot > 0.66). The gunman's aim forward is his
         facing, which CBZ.actorAimAt turns onto the mark. The barrel line is
         still measured (aim.barrelMiss): the shipped ready pose holds a
         pistol ~20 deg left and ~14 deg low of its mark, a 2.4 m miss at 6 m,
         so the barrel alone would never read as "aimed". */
      const fy = g.group ? g.group.rotation.y : 0;
      const fdot = dist > 0.01 ? ((ap.x - gp.x) * Math.sin(fy) + (ap.z - gp.z) * Math.cos(fy)) / dist : 1;
      const onMe = dist <= 11 && fdot > 0.66;
      a._lastAim = { by: g.labName || "player", sees: sees, onMe: onMe, cone: R3(fdot), barrelMiss: R3(miss), dist: R3(dist) };
      if (!sees && !a._spottedGun) continue;              // a gun he cannot see is not a threat to him yet
      if (sees) a._spottedGun = true;
      if (dist < bd) { bd = dist; best = g; _th.aimingAtMe = onMe; _th.hostile = gunOn(g) === a; }
    }
    if (!best) return null;
    const bp = posOf(best);
    _th.source = best; _th.x = bp.x; _th.z = bp.z; _th.distance = bd;
    _th.yaw = best.group ? best.group.rotation.y : null;
    return _th;
  }

  function sameJob(a, g) {
    const B = CBZ.brain;
    if (!B || !B.job) return false;
    const ja = B.job(a), jg = g && g._brain ? B.job(g) : null;
    return !!(ja && jg && ja.side && ja.side === jg.side);
  }
  // THE NAME OVER HIM (city/roles.js titleOf's rule): his post if he holds one
  // (CBZ.brain.job, the one record of it), else his name
  function labelOf(a) {
    const J = CBZ.brain && CBZ.brain.job ? CBZ.brain.job(a) : null;
    return (J && J.title) || a.name || "";
  }

  /* ---- APPLY AN INTENT (the lab's perform) -------------------------------- */
  function perform(a, I, dt) {
    const k = I.kind;
    if (k === "leave") {
      // LET GO (CBZ.brain.dismiss): on his feet, hands down, gun away; the nod
      // faces the man who let him go, then he walks to where he is going
      a._intent = k; a._response = null; a.aiState = "leave";
      a._order = null; a._threatHeld = false;
      a.poseHandsUp = false; a.poseCower = false; if (a.char) a.char.handsUp = false;
      if (a._aimAt) { a._aimAt = null; a.poseAimBack = false; }
      if (a.armed) holster(a);
      applyPosture(a, "stand");
      if (I.say) { if (CBZ.speech && CBZ.speech.say) { try { CBZ.speech.say(a, I.say); } catch (e) {} } if (a._lab) a._lab.W.event(a.labName, "says \"" + I.say + "\""); }
      if (I.phase === "nod") { holdStill(a); a._faceYaw = I.target ? faceTo(a, I.target) : null; }
      else { a.target.set(I.x, 0, I.z); a._spd = I.speed || 1.4; a._faceYaw = null; a.pause = 0; }
      return true;
    }
    a._intent = k;
    a._response = I.response || ((!k || k === "none" || k === "idle" || k === "wander") ? null : a._response);
    if (k === "none" || k === "idle" || k === "wander" || !k) {
      if (a._threatHeld) { a._threatHeld = false; a.poseHandsUp = false; a.poseCower = false; if (a.char) a.char.handsUp = false; a.aiState = "idle"; }
      return false;                                      // the kit's own orders run
    }
    a._threatHeld = true;
    a._threatSrc = I.target || a._threatSrc;
    // anyone reacting to a threat gets OUT of the chair first (peds.js's rule:
    // a held body cannot flee)
    if ((a._propSeat || (CBZ.moves && CBZ.moves.posture(a) === "sit")) && CBZ.rest) { try { CBZ.rest.up(a); } catch (e) {} }
    if (k === "flee" || k === "rout" || k === "evacuate" || k === "hide") {
      a.aiState = "flee"; a.poseHandsUp = false; a.poseCower = false; if (a.char) a.char.handsUp = false;
      a.target.set(I.x, 0, I.z); a._spd = I.speed || 5.5; a.pause = 0;
      applyPosture(a, "stand");
      return true;
    }
    if (k === "surrender" || k === "comply" || k === "freeze") {
      a.aiState = k; holdStill(a);
      applyPosture(a, I.posture || (k === "freeze" ? "cower" : "handsUp"));
      if (a._threatSrc) a._faceYaw = faceTo(a, a._threatSrc);
      return true;
    }
    if (k === "fight" || k === "hold") {
      a.poseHandsUp = false; a.poseCower = false; if (a.char) a.char.handsUp = false;
      if (a._labWeapon) {
        if (!a.armed) draw(a);
        a.aiState = "aim"; holdStill(a);
        if (I.speed > 0) { a.target.set(I.x, 0, I.z); a._spd = I.speed; }
        a._aimAt = a._threatSrc;
      } else {
        a.aiState = "charge"; a.target.set(I.x, 0, I.z); a._spd = I.speed || 3.2; a.pause = 0;
      }
      return true;
    }
    if (k === "cover" || k === "prone" || k === "stalk") {
      a.aiState = k; a.target.set(I.x, 0, I.z); a._spd = I.speed || 0; applyPosture(a, I.posture === "prone" ? "crouch" : (I.posture || "crouch"));
      return true;
    }
    a.aiState = k;
    if (I.speed > 0) { a.target.set(I.x, 0, I.z); a._spd = I.speed; }
    return true;
  }
  function holdStill(a) { const p = a.group.position; a.target.set(p.x, 0, p.z); a._spd = 0; }
  function draw(a) {
    a.armed = true; a._holstered = false; a.weapon = a._labWeapon;
    if (CBZ.actorHolster) CBZ.actorHolster(a, false);
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(a);
    const W = CBZ.lab.W; if (W && W.armed.indexOf(a) < 0) W.armed.push(a);
    if (a._lab) a._lab.W.event(a.labName, "draws " + a._labWeapon);
  }
  function holster(a) {
    a.armed = false; a._aimAt = null; a.poseAimBack = false;
    if (CBZ.actorHolster) CBZ.actorHolster(a, true);
    const W = CBZ.lab.W; const i = W ? W.armed.indexOf(a) : -1; if (i >= 0) W.armed.splice(i, 1);
  }

  /* ---- THE MOVER: one frame of every lab person (update order 22) --------- */
  const _mo = { speed: 1.4, stop: 0.3, radius: 0.32, face: null, strafe: false, lod: 0, nbrs: null, nbrN: 0 };
  function tick(dt) {
    const M = CBZ.moves, B = CBZ.brain;
    for (let i = 0; i < people.length; i++) {
      const a = people[i];
      if (a.dead) continue;
      const ch = a.char, g = a.group, p = g.position;
      // THINK: perceive, decide, act
      if (B && a._brainOn) {
        const th = threatOn(a);
        // what he WATCHES (the awareness meter fills on it): the threat once
        // there is one, else the nearest body with a gun out
        const I = B.tick(a, dt, { target: th ? th.source : nearestGun(a), threat: th });
        a._lastIntent = I.kind;
        if (!perform(a, I, dt)) runOrders(a);
      } else runOrders(a);
      // a gun on someone: the shooter turns onto his mark and holds the ready pose
      if (a.armed && a._aimAt && CBZ.actorAimAt) {
        const t = a._aimAt;
        if (!t.pos && t.group) t.pos = t.group.position;
        CBZ.actorAimAt(a, t, dt);
        a.poseAimBack = true;
      } else if (a.poseAimBack && !a._aimAt) a.poseAimBack = false;
      // MOVE (unless a posture sequence owns the body)
      const post = M ? M.posture(a) : "stand";
      // a body a posture owns DRIVES nothing: systems/pushables.js reads an
      // actor's push off `_spd` toward `target` (npc.js's think speed), and a
      // seated man still pointed at his approach spot would shove the chair
      // out from under himself (measured here before this line: 0.4 m)
      if (M && M.busy(a)) { a._spd = 0; holdStill(a); continue; }      // moves_posture animates it
      if (post === "sit" || post === "lie") { a._spd = 0; holdStill(a); if (CBZ.animChar) CBZ.animChar(ch, 0, dt); a.speedNow = 0; continue; }
      const m = M.motor(a);
      const spd = (a.pause > 0 || post === "kneel") ? 0 : (a._spd != null ? a._spd : a.speed);
      if (a.pause > 0) a.pause -= dt;
      _mo.speed = spd;
      _mo.face = a.armed && a._aimAt ? faceTo(a, a._aimAt) : (a._faceYaw != null && spd === 0 ? a._faceYaw : null);
      _mo.strafe = !!(a.armed && a._aimAt && spd > 0);
      _mo.nbrs = people; _mo.nbrN = people.length;
      M.step(m, p, g.rotation.y, a.target.x, a.target.z, _mo, dt);
      if (!(a.armed && a._aimAt)) g.rotation.y = m.yaw;   // a shooter's yaw is actorAimAt's
      if (CBZ.collide) CBZ.collide(p, 0.32, p.y + 0.42, p.y + 1.7);
      p.y = CBZ.groundAt ? CBZ.groundAt(p.x, p.z, p.y) : 0;
      a.speedNow = m.gs;
      if (CBZ.animChar) CBZ.animChar(ch, m.gs, dt);
    }
  }
  // the kit's orders: a walk, a sit (CBZ.rest), a stand
  function runOrders(a) {
    const o = a._order;
    if (!o) return;
    if (o.kind === "sit") {
      if (a._propSeat === o.seat) { a._order = null; return; }
      const R = CBZ.rest;
      if (!R) return;
      if (R.sit(a, o.seat)) { a._order = null; return; }  // close enough: the pose's own arc takes it from here
      const ap = R.approach(o.seat);
      a.target.set(ap.x, 0, ap.z); a._spd = o.speed || a.speed;
    } else if (o.kind === "follow") {
      // a follower's slot: a stride and a half behind the leader's shoulder
      // (the city's companion slot, city/peds.js companionThink)
      const L = o.leader, lp = posOf(L);
      if (!lp) return;
      const ly = L.group ? L.group.rotation.y : (L.yaw || 0);
      const sx = lp.x - Math.sin(ly) * 1.6 + Math.cos(ly) * 0.9, sz = lp.z - Math.cos(ly) * 1.6 - Math.sin(ly) * 0.9;
      a.target.set(sx, 0, sz);
      const d = Math.hypot(a.group.position.x - sx, a.group.position.z - sz);
      a._spd = d > 4 ? 3.0 : d > 0.6 ? 1.5 : 0;
    } else if (o.kind === "walk") {
      a.target.set(o.x, 0, o.z); a._spd = o.speed || a.speed;
      if (Math.hypot(a.group.position.x - o.x, a.group.position.z - o.z) < 0.4) a._order = null;
    }
  }
  let ticking = false;
  function ensureTick() {
    if (ticking) return;
    ticking = true;
    (CBZ.onUpdate || function () {})(22, tick);
  }

  function poseOf(a) {
    if (a.dead) return "dead";
    const M = CBZ.moves, post = M ? M.posture(a) : "stand";
    if (post === "transition") return a._propSeat ? "sitting_down" : "getting_up";
    if (post === "sit") return "seated";
    if (post === "kneel") return a.poseHandsUp ? "kneeling_hands_up" : "kneeling";
    if (a.armed && a._aimAt) return "aiming";
    if (a.poseHandsUp) return "hands_up";
    if (a.poseCower) return "cowering";
    if (post === "crouch") return "crouched";
    if (a.aiState === "flee" && (a.speedNow || 0) > 0.5) return "fleeing";
    if ((a.speedNow || 0) > 3.2) return "running";
    if ((a.speedNow || 0) > 0.25) return "walking";
    return "standing";
  }

  CBZ.lab.ingredient("person", {
    files: ["src/entities/character.js", "src/entities/gait.js", "src/entities/moves.js", "src/entities/moves_posture.js",
      "src/systems/brain.js", "src/systems/speech.js", "src/systems/reactions.js", "src/core/stage.js",
      "src/entities/heritage.js", "src/city/propuse.js", "src/systems/rest.js"],
    make: function (W, o) {
      const THREE = window.THREE;
      const role = ROLE[o.role || "civilian"] ? (o.role || "civilian") : "civilian";
      const R = ROLE[role];
      W.armed = W.armed || [];
      installExecutor();
      ensureTick();
      let grp = CBZ.stage && CBZ.stage.cast ? CBZ.stage.cast(R.cast, { variant: o.variant != null ? o.variant : people.length }) : null;
      let ch = grp && grp.userData.charRig;
      if (!ch) { ch = CBZ.human.build({}); grp = ch.group; }
      const at = o.at || [0, 0];
      grp.position.set(at[0], 0, at[1]);
      grp.rotation.y = (o.yaw || 0) * Math.PI / 180;
      W.scene.add(grp);
      const a = {
        char: ch, group: grp, pos: grp.position, kind: role === "cop" || role === "guard" ? "guard" : "inmate", role: role,
        name: o.name, labName: o.name, target: new THREE.Vector3(at[0], 0, at[1]), pause: 0,
        speed: o.speed || 1.4, hp: 100, maxHp: 100, dead: false, ko: 0, armed: false,
        personality: { nerve: o.nerve != null ? +o.nerve : 0.5 }, ratings: { fighting: 45 }, behavior: null,
        gang: R.faction.indexOf("gang:") === 0 ? 1 : null, aiState: "idle", game: LAB_GAME,
        _lab: { W: W }, _labWeapon: o.weapon !== undefined ? (o.weapon && o.weapon !== "none" && o.weapon !== "0" ? o.weapon : null) : (R.weapon || null),
      };
      if (a._labWeapon) { a.weapon = a._labWeapon; a._beltGun = a._labWeapon; a._holstered = true; }
      people.push(a);
      (CBZ.npcs || (CBZ.npcs = [])).push(a);
      a._brainOn = o.brain !== false && !!CBZ.brain;
      if (a._brainOn) {
        CBZ.brain.register(a, R.arch, { faction: R.faction, game: LAB_GAME, nerve: o.nerve != null ? +o.nerve : undefined });
      }
      const h = {
        actor: a, obj: grp,
        walkTo: function (x, z, speed) { a._order = { kind: "walk", x: x, z: z, speed: speed }; },
        sit: function (chair) { const seat = chair.seat || chair; a._order = { kind: "sit", seat: seat }; },
        stand: function () { a._order = null; if (CBZ.rest) CBZ.rest.up(a); else if (CBZ.propStand) CBZ.propStand(a); },
        draw: function () { draw(a); },
        holster: function () { holster(a); },
        aimAt: function (other) { if (!a.armed) draw(a); a._aimAt = other.gunActor || other.actor || other; W.event(o.name, "aims at " + (other.name || "?")); },
        lower: function () { a._aimAt = null; a.poseAimBack = false; W.event(o.name, "lowers the gun"); },
        say: function (line) { CBZ.brain && CBZ.brain.act ? CBZ.brain.act.say(a, line, { force: true }) : null; },
        // WORK FOR SOMEBODY: CBZ.brain.employ (title over his head, the side he takes)
        employ: function (by, title, side) {
          if (!CBZ.brain || !CBZ.brain.employ) return;
          const who = by && (by.actor || by);
          CBZ.brain.employ(a, { by: who, title: title, side: side || null });
          W.event(o.name, "works for " + ((by && (by.name || by.labName)) || "?") + " as " + title);
        },
        follow: function (leader) { a._order = { kind: "follow", leader: leader.actor || leader }; W.event(o.name, "follows " + (leader.name || "the player")); },
        // LET HIM GO through the shared brain (CBZ.brain.dismiss)
        dismiss: function (opts) {
          opts = opts || {};
          a._order = null;
          CBZ.brain.dismiss(a, { from: opts.from ? (opts.from.actor || opts.from) : null, to: opts.to, line: opts.line, nod: opts.nod });
          W.event(o.name, "dismissed (brain.dismiss)");
        },
        // THE OLD CITY PATH, kept to measure the bug: the follow flag and the
        // crew side cleared by hand (careers.js payroll walk-off, the old
        // president_staff walk), nothing else. The brain keeps its job title,
        // its held responses and its stance; nobody tells it where to go.
        dismissLegacy: function () {
          a._order = null;
          const b = a._brain;
          if (b) { b.faction = "civilians"; if (b.job) b.job.side = null; }
          W.event(o.name, "dismissed (legacy field writes)");
        },
        label: function () { return labelOf(a); },
        pose: function () { return poseOf(a); },
        response: function () { return a._response || null; },
        state: function () {
          const p = grp.position, b = a._brain;
          return {
            pos: [R3(p.x), R3(p.y), R3(p.z)], yawDeg: R3(grp.rotation.y * 180 / Math.PI), speed: R3(a.speedNow || 0),
            pose: poseOf(a), posture: CBZ.moves ? CBZ.moves.posture(a) : null, role: role, label: labelOf(a),
            seat: a._propSeat ? true : false, armed: !!a.armed,
            brain: b ? { arch: b.arch && b.arch.id, intent: a._lastIntent || null, response: a._response || null, how: b.threatHow || null } : null,
            aim: a._lastAim || null,
          };
        },
        watch: {
          pose: function () { return poseOf(a); },
          label: function () { return labelOf(a); },
          brain: function () { return a._brainOn ? (a._response || "calm") : null; },
          gun: function () { const g = a._lastAim; return g ? (g.sees ? "sees it" : "has not seen it") + (g.onMe ? ", muzzle ON him" : ", muzzle off him") : null; },
        },
      };
      a._handle = h;
      return h;
    },
  });
})();
