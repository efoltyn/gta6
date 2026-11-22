/* ============================================================
   city/basewatch.js — A BASE IS GUARDED BY PEOPLE, NOT BY A RECTANGLE.

   OWNER: stepping onto Fort Brandt put five stars on you whoever you were
   and however you got in, so "the stealth night and the brig are played
   under fire". That rule (city/wanted.js militaryZone: a sensor grid that
   locked a hard 5-star floor the moment the player's feet were inside the
   base AABB) is deleted. This is how a base works instead:

     THE WIRE     Fort Brandt's own perimeter (CBZ._militaryBase min/max)
                  and its gate. Outside it, on the causeway approach, the
                  gate sentries challenge a stranger walking up.
     THE EYES     Trespass is noticed by a SOLDIER WHO SEES YOU (the brain's
                  one sight test: his cone, the light, the walls), never by
                  the rectangle. A man nobody has seen is not reported by
                  anybody. Night shrinks every cone (brain lightAt).
     THE LADDER   seen -> "Halt, restricted area, turn around" -> the order
                  to leave ("Last warning") -> "Intruder, detain him" (a
                  trespass report, one star, the posts stand to) -> hostile
                  (three stars, the base's quick-reaction section is turned
                  out on you through city/fortresponse.js). Walking back out
                  calms it; running, a drawn weapon, and going deeper climb
                  it. The restricted heart (the armoury, headquarters, the
                  flight line) climbs it much faster. A crime reported inside
                  the wire is hostile at once.
     A UNIFORM    Somebody in this garrison's fatigues (outfits.js stamps the
                  claim "army" on clothes taken off a soldier, and keeps the
                  trust: CBZ.cityDisguiseTrust("army")) is NOT trespassing on
                  sight; the gate nods him through. But every soldier who can
                  see him keeps his OWN doubt, and you can watch it climb: he
                  stops and holds the look, he walks over ("Soldier. Hold
                  up."), he keys his radio ("Guardhouse, I have a man here I
                  can't place"), and when that call is made the cover is blown
                  and he is reported (the ladder at "detain"). What climbs it:
                  how close, running, a drawn gun (much worse in the heart of
                  the base), glass up, the base at stand-to, the sealed gate;
                  a man in a drill rank has his eyes front.
     WHAT A JOB   knows that the base does not comes in through a LENS,
     KNOWS        CBZ.cityBaseLens(fn): fn(soldier, ctx) -> a multiplier on his
                  doubt, or { mul, line, blown } (what he says walking over,
                  what he says calling it in). city/hitman_m_general.js adds the
                  dead man's own company knowing his face, a private near
                  headquarters, a man up its ladder. The job never keeps a
                  second doubt of its own.
     STAND-TO     CBZ.cityBaseStandTo(on, at): the base has heard a shot or
                  found a body (the general's lockdown). A stranger seen inside
                  the wire is hostile at once, and every uniform is looked at
                  harder. CBZ.cityBaseBlow(by, line, level) is how a job says
                  "that one, there": the cover goes and the ladder jumps.

   ONE QUESTION, for this file, the hitman job and anybody else:
     CBZ.cityBaseStanding(actor?) -> {
       standing: "allowed" | "challenged" | "hostile",
       where:    "outside" | "approach" | "inside" | "restricted",
       noticed:  has a soldier actually clocked him,
       level:    0..4 (the ladder above),
       why:      a short plain reason ("in uniform", "warned at the gate",
                 "ordered off the base", "reported as an intruder",
                 "armed intruder", "a soldier", "outside the wire", ...),
       doubt:    in uniform: the most any one soldier doubts him (0..1.1)
     }
   actor = the player (default) or any ped.

   Yields entirely to games/military.js while its stealth night is running
   (that package has its own guards and alert ladder) and to the brig.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.game) return;
  const g = CBZ.game;

  const SCAN = 0.2;                 // s between sight scans
  const SEE_R = 48;                 // m a sentry looks for a stranger (night shrinks it)
  const SEE_HALF = 1.2;             // rad: half his cone
  const WARN_AT = 0, ORDER_AT = 4, DETAIN_AT = 8, HOSTILE_AT = 13;
  const CALM_T = 20;                // s unseen outside the wire before the ladder resets
  const LOOK_R = 36;                // m a soldier looks twice at a uniform

  const W = {
    level: 0, susp: 0, seer: null, seenT: -1e9, scanT: 0, unseen: 0,
    doubt: 0, doubtBy: null, caller: null, lineT: 0, nod: false, lastPos: null, speed: 0,
    told: [false, false, false, false, false], where: "outside",
  };
  // what a job knows (CBZ.cityBaseLens) and whether the base is at stand-to
  const LENS = [];
  const STAND = { on: false, at: null };

  function base() { return CBZ._militaryBase || null; }
  function PA() { return CBZ.city && CBZ.city.playerActor; }
  function now() { return CBZ.now || 0; }
  function inRect(B, x, z, pad) { return x > B.minX - pad && x < B.maxX + pad && z > B.minZ - pad && z < B.maxZ + pad; }

  // the restricted heart: the armoury, headquarters, the flight line (runway,
  // apron, the aircraft stands), read off the base's own published anchors
  function restricted(B, x, z) {
    const near = function (p, r) { return p && Math.hypot(x - p.x, z - p.z) < r; };
    if (near(B.armory, 30) || near(B.hq, 30)) return true;
    const P = B.plan, c = B.center;
    if (P && c) {
      const lx = x - c.x, lz = z - c.z;
      const r = function (q) { return q && lx > q.x0 && lx < q.x1 && lz > q.z0 && lz < q.z1; };
      if (r(P.keepOut) || r(P.apron)) return true;
    }
    const R = B.runway;
    if (R && Math.abs(z - R.z) < (R.w || 30) / 2 + 6 && Math.abs(x - R.x) < (R.len || 400) / 2) return true;
    return false;
  }
  function whereAt(B, x, z) {
    if (!B) return "outside";
    if (inRect(B, x, z, -2)) return restricted(B, x, z) ? "restricted" : "inside";
    const G = B.gate;
    if (G && Math.hypot(x - G.x, z - G.z) < 60) return "approach";
    return "outside";
  }

  // the games that own the base for a while
  function nightRunning() {
    const A = CBZ.games && CBZ.games.api && CBZ.games.api.military;
    if (!A || !A.night) return false;
    try { const n = A.night(); return !!(n && (n.active || n.brig)); } catch (e) { return false; }
  }
  function glassUp() {
    try { if (CBZ.hmBinoculars && CBZ.hmBinoculars.active && CBZ.hmBinoculars.active()) return true; } catch (e) {}
    try { return !!(CBZ.fpsScoped && CBZ.fpsScoped()); } catch (e) { return false; }
  }
  function uniformTrusted() {
    try { return !!(CBZ.cityDisguiseTrust && CBZ.cityDisguiseTrust("army")); } catch (e) { return false; }
  }
  function soldiers() {
    if (CBZ.militaryPersonnel) { try { return CBZ.militaryPersonnel(); } catch (e) {} }
    return CBZ.cityMilitaryPersonnel || [];
  }
  function armed() { return !!(CBZ.cityHasGun && CBZ.cityHasGun()); }

  const _see = { range: SEE_R, fovHalf: SEE_HALF };
  function seerOf(P, pa) {
    const per = CBZ.brain && CBZ.brain.perception;
    const L = soldiers();
    let best = null, bd = 1e9;
    for (let i = 0; i < L.length; i++) {
      const q = L[i];
      if (!q || q.dead || (q.ko || 0) > 0 || q.inCar || q._parked || !q.pos) continue;
      const d = Math.hypot(q.pos.x - P.pos.x, q.pos.z - P.pos.z);
      if (d > SEE_R || d >= bd) continue;
      let ok = false;
      if (per && per.sees) { try { ok = per.sees(q, pa || P, _see); } catch (e) { ok = false; } }
      else ok = d < 20;
      if (ok) { best = q; bd = d; }
    }
    return best;
  }
  function say(q, line, secs) {
    if (!q || q.dead || !CBZ.citySay) return;
    try { CBZ.citySay(q, line, "#e8e2d4", { secs: secs || 2.8, force: true }); } catch (e) {}
  }
  function faceYou(q, P, dt) {
    if (!q || !q.group || q.rage || q.state === "fight" || q.state === "shoot") return;
    const want = Math.atan2(P.pos.x - q.pos.x, P.pos.z - q.pos.z);
    q.group.rotation.y = CBZ.lerpAngle ? CBZ.lerpAngle(q.group.rotation.y, want, Math.min(1, dt * 6)) : want;
  }

  const LINES = {
    warnGate: ["Halt. This is a restricted military area. Turn around.", "Stop right there. Military property. Turn around."],
    warnIn: ["Hey! You can't be in here. Walk back out the gate.", "Stop. You're on a military base. Turn around and walk out."],
    order: ["Last warning. Leave now or you will be detained.", "I said leave. Now, or you're detained."],
    orderGun: ["Weapon! Put it down and get out!", "Drop the weapon! Hands where I can see them!"],
    detain: ["Intruder! Detain him!", "Intruder on the base! Grab him!"],
    hostile: ["Contact! Armed intruder!", "He's not stopping. Weapons free!"],
    doubt: ["Hold on. What unit are you with?", "You. Where's your post?"],
    blown: ["You're not one of ours!", "That's not his uniform. Intruder!"],
  };
  function pick(a) { return a[(Math.random() * a.length) | 0]; }

  function setLevel(n, q, P) {
    if (n <= W.level) return;
    W.level = n;
    const x = P.pos.x, z = P.pos.z;
    if (n === 1) say(q, pick(W.where === "approach" ? LINES.warnGate : LINES.warnIn), 3.2);
    else if (n === 2) say(q, pick(armed() ? LINES.orderGun : LINES.order), 3.0);
    else if (n === 3) {
      say(q, pick(LINES.detain), 2.4);
      // the trespass is REPORTED by the man who saw it: one star, and the
      // posts on the wire stand to
      if (CBZ.cityCrime) { try { CBZ.cityCrime(60, { type: "trespass", instant: true, x: x, z: z }); } catch (e) {} }
      if (CBZ.fortAlert) { try { CBZ.fortAlert(x, z, { level: 0.6, by: PA() }); } catch (e) {} }
    } else if (n >= 4) {
      W.armedAt4 = armed();
      say(q, pick(LINES.hostile), 2.4);
      if (CBZ.cityRaiseStars) { try { CBZ.cityRaiseStars(3, "Armed Intrusion, Military Installation"); } catch (e) {} }
      else if (CBZ.cityForceStars) CBZ.cityForceStars(3);
      if (CBZ.fortAlert) { try { CBZ.fortAlert(x, z, { level: 1.5, by: PA() }); } catch (e) {} }
    }
  }
  function reset() {
    W.level = 0; W.susp = 0; W.seer = null; W.seenT = -1e9; W.unseen = 0;
    W.doubt = 0; W.doubtBy = null; W.lastPos = null; W.speed = 0; W.where = "outside";
    if (W.anyDoubt) {
      W.anyDoubt = false;
      const L = soldiers();
      for (let i = 0; i < L.length; i++) { const q = L[i]; if (q && (q._bwAct || q._bwDoubt)) { relaxDoubt(q); q._bwDoubt = 0; } }
    }
  }
  CBZ.cityBaseWatchReset = reset;

  // a job's eyes on the base's men (see the header): add once, remove with off
  CBZ.cityBaseLens = function (fn, off) {
    const i = LENS.indexOf(fn);
    if (off) { if (i >= 0) LENS.splice(i, 1); return false; }
    if (typeof fn === "function" && i < 0) LENS.push(fn);
    return true;
  };
  // the base stands to (a shot heard, a body found) and stands down
  CBZ.cityBaseStandTo = function (on, at) {
    STAND.on = !!on;
    STAND.at = on && at && isFinite(at.x) ? { x: at.x, z: at.z } : null;
    return STAND.on;
  };
  // "that one, there": the cover is gone and the ladder jumps to `level`
  // (3 reported as an intruder, 4 hostile). `by` says it; null for nobody.
  function blowCover(by, line, level) {
    const P = CBZ.player; if (!P || !P.pos) return;
    if (CBZ.cityDisguiseBlow) { try { CBZ.cityDisguiseBlow(by || null, line || pick(LINES.blown)); } catch (e) {} }
    const L = soldiers();
    for (let i = 0; i < L.length; i++) { const q = L[i]; if (q && q._bwAct) relaxDoubt(q); if (q) q._bwDoubt = 0; }
    W.doubt = 0; W.doubtBy = null; W.caller = null;
    const n = Math.max(1, Math.min(4, level || 3));
    W.where = whereAt(base(), P.pos.x, P.pos.z);
    W.seenT = now(); W.unseen = 0; if (by) W.seer = by;
    W.susp = Math.max(W.susp, [0, WARN_AT, ORDER_AT, DETAIN_AT, HOSTILE_AT][n]);
    // (the man who blew it has just said so: the jump itself is silent, the
    // report and the stand-to still happen)
    setLevel(n, null, P);
  }
  CBZ.cityBaseBlow = function (by, line, level) {
    if (!base() || nightRunning()) return null;
    blowCover(by, line, level || 3);
    return CBZ.cityBaseStanding();
  };

  // a crime the street reported, inside the wire (wanted.js report()): the
  // base is hostile at once — no ladder for a man shooting on the parade ground
  CBZ.cityBaseIncident = function (x, z, type) {
    const B = base(), P = CBZ.player;
    // (the trespass report is this file's own ladder speaking: not a new crime)
    if (type === "trespass") return false;
    if (!B || !P || !inRect(B, x, z, 20) || nightRunning()) return false;
    W.where = whereAt(B, P.pos.x, P.pos.z);
    W.seenT = now();
    W.susp = Math.max(W.susp, HOSTILE_AT);
    setLevel(4, W.seer || seerOf(P, PA()), P);
    return true;
  };

  CBZ.cityBaseStanding = function (actor) {
    const B = base();
    const P = CBZ.player, pa = PA();
    const isPlayer = !actor || actor === P || actor === pa;
    const a = isPlayer ? P : actor;
    if (!B || !a || !a.pos) return { standing: "allowed", where: "outside", noticed: false, level: 0, why: "no base" };
    const where = whereAt(B, a.pos.x, a.pos.z);
    if (!isPlayer) {
      if (a.organization === "military" || a.milRank) return { standing: "allowed", where: where, noticed: false, level: 0, why: "a soldier" };
      if (a.rage === pa || (a.npcWanted | 0) >= 2) return { standing: where === "outside" ? "allowed" : "hostile", where: where, noticed: false, level: 0, why: "armed and wanted" };
      return { standing: where === "inside" || where === "restricted" ? "challenged" : "allowed", where: where, noticed: false, level: 0, why: where === "outside" ? "outside the wire" : "a civilian on the base" };
    }
    const noticed = now() - W.seenT < 4000;
    if (W.level >= 4) return { standing: "hostile", where: where, noticed: noticed, level: 4, why: W.armedAt4 ? "armed intruder" : "an intruder who would not stop" };
    if ((g.wanted | 0) >= 2 && where !== "outside") return { standing: "hostile", where: where, noticed: noticed, level: W.level, why: "a wanted man on the base" };
    if (uniformTrusted() && W.level === 0) return { standing: "allowed", where: where, noticed: noticed || W.doubt > 0.24, level: 0, why: "in uniform", doubt: +W.doubt.toFixed(2) };
    if (STAND.on && (where === "inside" || where === "restricted")) return { standing: "hostile", where: where, noticed: noticed, level: W.level, why: "a stranger inside the wire at stand-to" };
    if (W.level === 3) return { standing: "challenged", where: where, noticed: noticed, level: 3, why: "reported as an intruder" };
    if (W.level === 2) return { standing: "challenged", where: where, noticed: noticed, level: 2, why: "ordered off the base" };
    if (W.level === 1) return { standing: "challenged", where: where, noticed: noticed, level: 1, why: where === "approach" ? "warned at the gate" : "warned off" };
    if (where === "outside") return { standing: "allowed", where: where, noticed: false, level: 0, why: "outside the wire" };
    if (where === "approach") return { standing: "allowed", where: where, noticed: false, level: 0, why: "on the road to the gate" };
    return { standing: "challenged", where: where, noticed: false, level: 0, why: "trespassing, not seen yet" };
  };

  /* A UNIFORM, LOOKED AT. Every soldier who can see him keeps his own doubt
     (q._bwDoubt). A quarter: he stops (if nobody else is steering him) and
     holds the look. Past half: he walks over and says so (three at most walk
     at once). Eight tenths: he keys his radio, one man at a time, and three
     and a half seconds later the cover is blown and he is reported. Out of
     sight it drains, and a man who walked over goes to where he last saw you.
     q._bwFree lends a job's man to this (city/hitman_m_general.js's man on the
     fence); posted, drilling and job-steered men only turn their heads. */
  function relaxDoubt(q) {
    if (!q) return;
    if (q._bwCtl && !q._bwFree && !q.dead) { q.controlled = false; q._navOk = false; if (!q.rage) { q.state = "idle"; q.pause = 0.6; q.path = null; q.finalGoal = null; } }
    q._bwCtl = false; q._bwAct = null; q._bwRadio = 0;
    if (W.caller === q) W.caller = null;
  }
  function holdStill(q) {
    q.path = null; q.finalGoal = null; q.state = "idle"; q.pause = 2; q.speed = 0;
    if (q.target && q.target.set) q.target.set(q.pos.x, 0, q.pos.z);
  }
  function walkOver(q, x, z) {
    const gl = { x: x, z: z };
    q.path = [gl]; q.finalGoal = gl; q.state = "walk"; q.pause = 0; q.staffPost = null; q._navOk = true;
    if (q.target && q.target.set) q.target.set(x, 0, z);
  }
  function sfxRadio(q) { if (CBZ.sfxAt) { try { CBZ.sfxAt("switch", q.pos.x, q.pos.z, { vol: 0.7 }); } catch (e) {} } }
  const _look = { range: LOOK_R, fovHalf: 1.35 };
  const _ctx = { x: 0, z: 0, y: 0, d: 0, where: "", armed: false, fast: false, glass: false, standTo: false, worn: null, climbing: false };
  function uniformDoubt(P, B, dt) {
    const pa = PA(), per = CBZ.brain && CBZ.brain.perception;
    const px = P.pos.x, pz = P.pos.z, py = P.pos.y || 0;
    const L = soldiers();
    const gun = armed(), fast = W.speed > 4.4 && !P.driving, gl = glassUp();
    const G = B.gate, atGate = STAND.on && G && Math.hypot(px - G.x, pz - G.z) < 26;
    const C = _ctx;
    C.x = px; C.z = pz; C.y = py; C.where = W.where; C.armed = gun; C.fast = fast; C.glass = gl; C.standTo = STAND.on;
    C.worn = g.cityWornOutfit || null;
    C.climbing = !!(CBZ.climb && CBZ.climb.playerOn && CBZ.climb.playerOn());
    let comers = 0, top = 0, topBy = null;
    for (let i = 0; i < L.length; i++) {
      const q = L[i];
      if (!q || !q.pos) continue;
      if (q.dead || (q.ko || 0) > 0 || q.inCar || q._parked || q.rage) { if (q._bwAct) relaxDoubt(q); continue; }
      const d = Math.hypot(px - q.pos.x, pz - q.pos.z);
      let s = q._bwDoubt || 0;
      if (d > LOOK_R + 4 && !s && !q._bwAct) continue;
      let sees = false;
      if (d < LOOK_R) {
        if (per && per.sees) { try { sees = per.sees(q, pa || P, _look); } catch (e) { sees = false; } }
        else sees = d < 12;
      }
      if (!sees) {
        s = Math.max(0, s - dt * (q._bwAct ? 0.03 : 0.06));
        q._bwDoubt = s;
        if (q._bwAct && s < 0.16) relaxDoubt(q);
        else if (q._bwAct === "come" && q._bwCtl && q._bwLast && Math.hypot(q.pos.x - q._bwLast.x, q.pos.z - q._bwLast.z) > 2) {
          if (!q.finalGoal || Math.hypot(q.finalGoal.x - q._bwLast.x, q.finalGoal.z - q._bwLast.z) > 0.6) walkOver(q, q._bwLast.x, q._bwLast.z);
        }
        continue;
      }
      let rate = d < 4 ? 0.06 : d < 9 ? 0.026 : d < 18 ? 0.011 : 0.004;
      if (fast) rate *= 3;
      if (gun) rate *= W.where === "restricted" ? 7 : 3;
      if (gl) rate *= 3;
      if (STAND.on) rate *= 2.6;
      if (atGate) rate *= 3;
      if (q._drill) rate *= 0.3;                                       // eyes front
      let said = null, callIn = null;
      C.d = d;
      for (let k = 0; k < LENS.length; k++) {
        let r = 1;
        try { r = LENS[k](q, C); } catch (e) { r = 1; }
        if (typeof r === "number") rate *= r;
        else if (r) { if (r.mul != null) rate *= r.mul; if (r.line) said = r.line; if (r.blown) callIn = r.blown; }
      }
      if (!(rate > 0)) { q._bwDoubt = Math.max(0, s - dt * 0.06); continue; }
      s = Math.min(1.1, s + rate * dt);
      q._bwDoubt = s; q._bwLast = { x: px, z: pz }; W.anyDoubt = true;
      if (s > top) { top = s; topBy = q; }
      if (s < 0.24) { if (q._bwAct && s < 0.16) relaxDoubt(q); continue; }
      // ---- what you can see him do about it ----
      const free = (!q.controlled || q._bwFree || q._bwCtl) && !q._drill && !q._stationed && !q._post && !q.staffPost;
      if (!q._bwAct) {
        q._bwAct = "look";
        if (free) { q._bwCtl = true; q.controlled = true; holdStill(q); }
      }
      if (!q._drill && q.group) q.group.rotation.y = Math.atan2(px - q.pos.x, pz - q.pos.z);
      if (s >= 0.55 && q._bwAct === "look") {
        q._bwAct = "come";
        // (one voice at a time: a rank of men does not say it in chorus)
        if (now() > W.lineT) { W.lineT = now() + 4000; say(q, said || (atGate ? "Gate's sealed. Back to your unit." : pick(LINES.doubt)), 2.6); }
      }
      if (q._bwAct === "come" && q._bwCtl && comers < 3) {
        comers++;
        if (d > 2.6) { if (q.state !== "walk" || !q.finalGoal || Math.hypot(q.finalGoal.x - px, q.finalGoal.z - pz) > 2.5) walkOver(q, px, pz); }
        else if (q.state !== "idle") holdStill(q);
      }
      const calling = W.caller && W.caller !== q && !W.caller.dead && W.caller._bwAct === "radio";
      if (s >= 0.8 && q._bwAct !== "radio" && !calling) {
        q._bwAct = "radio"; q._bwRadio = 3.4; q._bwCallIn = callIn; W.caller = q;
        if (q._bwCtl) holdStill(q);
        say(q, "Guardhouse, I have a man here I can't place. Stand by.", 3.2);
        sfxRadio(q);
      }
      if (q._bwAct === "radio") {
        q._bwRadio -= dt;
        if (q._bwRadio <= 0) { blowCover(q, callIn || q._bwCallIn || pick(LINES.blown), 3); return; }
      }
    }
    W.doubt = top; W.doubtBy = topBy;
  }
  // the gate sentry nods a uniform through
  function gateNod(P, B, seer) {
    const G = B.gate; if (!G) return;
    const d = Math.hypot(P.pos.x - G.x, P.pos.z - G.z);
    if (d > 30) { W.nod = false; return; }
    if (W.nod || d > 16 || !seer || STAND.on) return;
    W.nod = true;
    if (P.driving) return;
    const h = CBZ.cityHour ? CBZ.cityHour() : 12;
    say(seer, h < 12 ? "Morning." : h < 18 ? "Afternoon." : "Evening.", 1.6);
  }

  // the man on the radio holds it to his ear: after the rig's own pose for
  // the frame (city/peds.js, 34) and before the rig is drawn from its parts
  // (a pose written at 38.x arrives a frame late and is overwritten)
  CBZ.onUpdate(37.36, function () {
    const rc = W.caller;
    if (rc && rc._bwAct === "radio" && !rc.dead && rc.char && rc.char.parts && rc.char.parts.la) { rc.char.parts.la.rotation.x = -2.65; rc.char.parts.la.rotation.z = -0.4; }
  });
  CBZ.onUpdate(38.76, function (dt) {
    if (g.mode !== "city" || g.state !== "playing") return;
    const B = base(), P = CBZ.player;
    if (!B || !P || !P.pos || P.dead || g.busted || (CBZ.cityArrestActive && CBZ.cityArrestActive())) return;
    if (!(dt > 0) || dt > 0.5) dt = 0.05;
    const where = whereAt(B, P.pos.x, P.pos.z);
    W.where = where;
    // speed off the actual displacement (driving included)
    if (W.lastPos) W.speed = W.speed * 0.8 + 0.2 * (Math.hypot(P.pos.x - W.lastPos.x, P.pos.z - W.lastPos.z) / dt);
    W.lastPos = { x: P.pos.x, z: P.pos.z };
    if (where === "outside") {
      W.unseen += dt;
      if (W.unseen > CALM_T && W.level < 4) reset();
      else if (W.unseen > CALM_T * 3) reset();
      return;
    }
    if (nightRunning()) return;
    W.scanT -= dt;
    if (W.scanT > 0) { if (W.seer) faceYou(W.seer, P, dt); return; }
    const sdt = SCAN - W.scanT; W.scanT = SCAN;
    const seer = seerOf(P, PA());
    if (seer) { W.seer = seer; W.seenT = now(); W.unseen = 0; } else { W.unseen += sdt; if (W.seer && now() - W.seenT > 3000) W.seer = null; }
    // IN UNIFORM: not trespassing on sight, but looked at
    if (uniformTrusted() && W.level === 0) {
      gateNod(P, B, seer);
      uniformDoubt(P, B, sdt);
      if (uniformTrusted() && W.level === 0) { W.susp = 0; return; }
    } else if (W.doubt) { W.doubt = 0; W.doubtBy = null; }
    // AT STAND-TO a stranger seen inside the wire is not warned
    if (STAND.on && seer && where !== "approach" && W.level < 4) { W.susp = Math.max(W.susp, HOSTILE_AT); setLevel(4, seer, P); }
    if (!seer) {
      W.susp = Math.max(0, W.susp - sdt * 0.15);
      return;
    }
    faceYou(seer, P, sdt);
    // HOW HE IS BEHAVING. Leaving (moving away from the middle of the base,
    // or off the approach) calms it; running, a drawn gun and going deeper
    // climb it; the heart of the base climbs it fastest.
    let rate = where === "approach" ? 0.35 : 1;
    if (where === "restricted") rate *= 2.6;
    if (W.speed > 5.2) rate *= 1.8;
    if (armed()) rate *= where === "approach" ? 4 : 3;
    if (P.driving) rate *= 1.4;
    const c = B.center;
    if (W._prevD != null && c) {
      const d = Math.hypot(P.pos.x - c.x, P.pos.z - c.z);
      const leaving = (d - W._prevD) / sdt > 0.6 && !armed();
      if (leaving) rate = -1.2;
    }
    W._prevD = c ? Math.hypot(P.pos.x - c.x, P.pos.z - c.z) : null;
    W.susp = Math.max(0, W.susp + rate * sdt);
    // the approach only ever gets as far as the order to leave: crossing the
    // wire afterwards climbs the rest of the ladder a step at a time
    if (where === "approach" && !armed()) W.susp = Math.min(W.susp, DETAIN_AT - 0.5);
    if (W.level < 1) setLevel(1, seer, P);
    // the approach is only ever warned and ordered (unless he is armed)
    const cap = where === "approach" && !armed() ? 2 : 4;
    if (W.susp >= ORDER_AT && cap >= 2) setLevel(2, seer, P);
    if (W.susp >= DETAIN_AT && cap >= 3) setLevel(3, seer, P);
    if ((W.susp >= HOSTILE_AT || (where === "restricted" && armed() && W.level >= 2)) && cap >= 4) setLevel(4, seer, P);
    if (W.level >= 2 && CBZ.actorAimAt && (armed() || W.level >= 3)) { try { CBZ.actorAimAt(seer, PA(), sdt); } catch (e) {} }
  });

  CBZ.cityBaseWatchAudit = function () {
    return { level: W.level, susp: +W.susp.toFixed(2), where: W.where, seer: W.seer ? (W.seer.name || "soldier") : null,
      seenAgo: Math.round(now() - W.seenT), speed: +W.speed.toFixed(1), doubt: +W.doubt.toFixed(2), standTo: STAND.on, lenses: LENS.length,
      doubters: soldiers().filter(function (q) { return q && ((q._bwDoubt || 0) > 0.05 || q._bwAct); }).map(function (q) { return (q.name || "soldier") + ":" + (+(q._bwDoubt || 0).toFixed(2)) + ":" + (q._bwAct || ""); }).slice(0, 6),
      standing: CBZ.cityBaseStanding() };
  };
})();
