/* ============================================================
   games/boxing.js — SOUTHPAW PALACE: the boxing card at the Ironjaw ring.

   OWNER: "No dashboards are needed. Everything can be existing."

   WHAT IT WAS: a second ring built on top of Ironjaw Arena's own ring
   (city/arena_fights.js moved its ring under this one and nobody noticed:
   two rings, two referees and two bouts stood in the same four metres), a
   simulated bout machine salvaged from games/boxing.html, and four HTML
   panels: a fight card, the fight itself as JAB / CROSS / HOOK / BODY /
   BLOCK / SLIP buttons with HP and stamina bars and a "tell" line, a corner
   menu and a result card.

   WHAT IT IS: the people and the rules of boxing at the one ring the arena
   has. Nothing here is on a panel.
     · THE RING is city/arena_fights.js's (CBZ.arenaRing: its centre, canvas
       height, rope span). This file builds only what stands round it: the
       judges' table with the bell and the scorecard board, the bookmaker's
       kiosk, the belt in its case.
     · THE FIGHT is the game's own melee. Every man in the ring is a real
       city ped (ctx.npc) fighting through CBZ.verbs / CBZ.melee: the house
       card is two of them, your bout is you against one of them with your
       own attack button (tap, hold to cover, release for the power shot:
       systems/melee.js) and he fights back with systems/melee.js's Fighter.
       What a blow does to a body is systems/vitals.js (rocked, knocked
       down, knocked out); your own hurt is the hurt the city already shows.
     · THE RULES are the only thing this file adds: three rounds on the
       bell, a referee who counts a man who is down and waves it off, three
       judges scoring the 10-point must, fouls (this is boxing: no kicks, no
       weapons, no hitting a man who is down), a decision.
     · YOU ASK PEOPLE. The promoter at the ring steps tells you the bout and
       the purse and takes your answer. The cutman in your corner sells ice,
       oxygen and adrenaline between rounds and sends you back out. The
       bookmaker writes your bet on the one bet slip (city/betslip.js). The
       referee announces the result and the judges' cards go up on the board
       behind their table (and the arena's big screen).
     · YOUR CAREER is the arena's (CBZ.arenaRing.career: one record, one
       fame, the boxing belt), shared with the cage. The purse is what that
       says your name is worth.

   Determinism: build() rolls nothing (ctx.npc casts off the package's seeded
   stream). A fight is runtime (Math.random and the fighters' own seeds). Revert: CBZ.CONFIG.PKG_BOXING = false (the
   ring stands empty).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.games) return;
  const THREE = window.THREE;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PKG_BOXING == null) CBZ.CONFIG.PKG_BOXING = true;

  /* ==========================================================
     1. THE RULES OF BOXING (numbers a probe may turn: api.rules)
     ========================================================== */
  const RULES = {
    ROUNDS: 3, ROUND_SEC: 60,
    REST_SEC: 12,          // the house card's minute between rounds, shortened
    CORNER_SEC: 45,        // yours: the cutman has this long
    COUNT_SEC: 1.0,        // the referee's cadence
    KD_LIMIT: 3,           // three knockdowns in a bout and it is waved off
    FOUL_LIMIT: 4,         // a warning, two points off, and the fourth foul disqualifies you
    EVEN_EPS: 0.6, CARD_MIN: 7, VIG: 94,
    GLOVES: 0.5,           // ten-ounce gloves: how much of a bare fist's daze arrives
    CLEAR: 0.045,          // a trained head clears this much faster, per second, than the street's
    REST_CLEAR: 0.3,       // and this much on the stool
    WEAR: 0.028,           // what one clean blow takes out of a man's legs
    SWING: 6,              // the wind one swing of yours costs in the ring, on top of the street's
    FLURRY: 1.4,           // s: swings inside this window are one flurry
    ARM_PUNCH: 3,          // the third swing in a flurry is an arm punch (half the power), and costs more wind
    READ: 0.12,            // his base chance to have read a punch of yours and caught it, plus his skill
    STOP_HP: 0.12,         // your health, as a fraction: under it the referee stops it
  };
  // boxing is fists: what the engine's fighter would kick, knee or elbow he throws as the nearest punch
  const GLOVED = { kick: "jab", lowKick: "jab", roundKick: "hook", knee: "body", elbow: "hook", headbutt: "jab" };
  /* A FOUL IS A KICK (CBZ.verbs names a landed blow by its family: a push
     kick is "front", a roundhouse "round", a leg kick "low"), a knee, an
     elbow, a head, or anything in the hand. In the ring your one button
     throws punches only, chest to chest as well (gloveYourHands below turns
     systems/melee.js's knee-and-elbow inside sequence into uppercut and hook),
     so a knee or an elbow that lands is one you went out of your way to
     throw, and the referee calls it. */
  const FOUL_KIND = /^(front|round|low|kick|knee|elbow|headbutt|butt|bat|slash|stab)$/;
  function foulBlow(res) { return FOUL_KIND.test(String(res.kind || "")); }
  const CUT = { ice: 150, air: 120, pep: 200 };

  function tenPointMust(a, b) {
    let ra = 10, rb = 10;
    if (Math.abs(a.score - b.score) >= RULES.EVEN_EPS) { if (a.score > b.score) rb = 9; else ra = 9; }
    ra -= (a.kd || 0) + (a.fouls || 0); rb -= (b.kd || 0) + (b.fouls || 0);
    return [Math.max(RULES.CARD_MIN, ra), Math.max(RULES.CARD_MIN, rb)];
  }
  function oddsFromProb(p) { p = Math.min(0.92, Math.max(0.08, p)); return Math.round(RULES.VIG / p) / 100; }
  function fmt(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function asIs(s) { const VW = CBZ.cityVerbWord; if (VW && VW.keep) VW.keep(s); return s; }
  const VB = () => (CBZ.verbs && CBZ.verbs.strike ? CBZ.verbs : null);
  const RING = () => CBZ.arenaRing || null;

  /* ==========================================================
     2. STATE
     ========================================================== */
  let C = null;       // package ctx (once mounted)
  let V = null;       // the venue: origin, cast handles, the board, the bell, the belt
  let BOUT = null;    // the bout in the ring now (the house card's, or yours)
  let OFFER = null;   // what the promoter just offered you { opp, purse, title, t }
  let near = false, boutSeq = 0, gapT = 3, clearT = 0, verbT = 0;

  /* ---- people talk ---- */
  function pedOf(h) { return h ? (h.ped || (h.pos && h.char ? h : null)) : null; }
  function calm(p) { return !!p && !p.dead && !p.surrender && !(p.ko > 0); }
  // ear: how far the line carries (a referee is heard from the seats)
  function say(who, line, secs, ear) {
    const p = pedOf(who);
    if (!p || p.dead || !line || !CBZ.citySay) return false;
    try { return !!CBZ.citySay(p, "“" + line + "”", null, { secs: secs || 2.6, force: true, ear: ear || undefined }); } catch (e) { return false; }
  }
  function refSay(line, secs) { return V ? say(V.ref, line, secs || 2.2, 36) : false; }
  function toast(line) { if (C) C.hud.toast(line); }
  // a person tells you, if you are near enough to hear him; else you hear of it
  function tell(who, line, secs) {
    const p = pedOf(who), P = CBZ.player;
    if (p && calm(p) && P && P.pos && Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z) < 15 && say(p, line, secs || 3.2, 16)) return;
    toast(line);
  }

  /* ---- the house: the arena's crowd, as sound, and the nearest of it as people ---- */
  const SHOUT_DOWN = ["Get up!", "Stay down!", "Ohhh!", "He's hurt!", "Finish him!"];
  const SHOUT_END = ["What a fight!", "Robbery!", "That's my man!", "He earned that."];
  function crowd(cheer, boo, lines) {
    if (!V || !near) return;
    const R = RING(), o = V.origin;
    if (CBZ.crowdVoiceAt) {
      // (lines = a moment the whole house saw: it cuts in over the last roar)
      try { CBZ.crowdVoiceAt(o.x, o.z, { y: R ? R.y : 2, cheer: cheer, boo: boo || 0, size: R && R.houseIn() ? 700 : 40, force: !!lines }); } catch (e) {}
    }
    if (!lines || !CBZ.cityPeds) return;
    let said = 0;
    for (let i = 0, peds = CBZ.cityPeds; lines.length && i < peds.length && said < 2; i++) {
      const p = peds[i];
      if (!p || p.dead || p._venueRole !== "arena-spectator" || Math.random() > 0.3) continue;
      if (Math.hypot(p.pos.x - o.x, p.pos.z - o.z) > 16) continue;
      say(p, lines[(Math.random() * lines.length) | 0], 1.8, 22); said++;
    }
  }

  /* ---- the bell: a struck steel bell at the timekeeper's end of the table ---- */
  function ringBell(n) {
    if (!V) return;
    V.bellT = 0.5 + 0.4 * (n || 1);
    const ac = CBZ.getAudioCtx && CBZ.getAudioCtx(), bus = CBZ.audioSfxBus && CBZ.audioSfxBus(), P = CBZ.player;
    if (!ac || !bus || !P || !P.pos) return;
    const d = Math.hypot(P.pos.x - V.bellAt.x, P.pos.z - V.bellAt.z);
    const level = 1 / (1 + (d / 32) * (d / 32));
    if (level < 0.02) return;
    try {
      const t0 = ac.currentTime;
      // the hum, the strike tone and three partials above it, each dying at its own rate
      const part = [[392, 0.09, 2.4], [784, 0.15, 1.9], [1046.5, 0.08, 1.3], [1568, 0.06, 0.9], [2540, 0.035, 0.5]];
      for (let k = 0; k < (n || 1); k++) {
        const t = t0 + k * 0.4;
        for (let i = 0; i < part.length; i++) {
          const o = ac.createOscillator(); o.type = "sine"; o.frequency.value = part[i][0];
          const gn = ac.createGain();
          gn.gain.setValueAtTime(0, t);
          gn.gain.linearRampToValueAtTime(part[i][1] * level, t + 0.004);
          gn.gain.exponentialRampToValueAtTime(0.0001, t + part[i][2]);
          o.connect(gn); gn.connect(bus);
          o.start(t); o.stop(t + part[i][2] + 0.05);
        }
      }
    } catch (e) { /* no audio yet */ }
  }

  /* ==========================================================
     3. BODIES IN THE RING
     A side is one corner: a cast ped, or you. Everything it does is
     CBZ.verbs on its own rig; this file only says where it should be.
     ========================================================== */
  function W(lx, lz) { return { x: V.origin.x + lx, z: V.origin.z + lz }; }
  function playerActor() { const Vb = VB(); return (CBZ.city && CBZ.city.playerActor) || (Vb && Vb.playerActor && Vb.playerActor()) || CBZ.player; }
  function actorOf(s) { return s.player ? playerActor() : s.ped; }
  function posOf(s) { return s.player ? CBZ.player.pos : s.ped.pos; }
  function downOf(a) {
    if (!a) return false;
    const Vb = VB(), B = Vb && Vb.body ? Vb.body(a) : null;
    if (B && B.down()) return true;
    const VT = CBZ.vitals;
    return !!(VT && VT.cuffable && VT.cuffable(a));
  }
  function outCold(a) { const VT = CBZ.vitals; return !!(VT && VT.state && VT.state(a) === "ko"); }
  function faceTo(ped, yaw, k) {
    const g = ped.group;
    g.rotation.y = CBZ.lerpAngle ? CBZ.lerpAngle(g.rotation.y, yaw, k == null ? 0.25 : k) : yaw;
  }
  // put a cast ped somewhere, on the deck or on the canvas (a relocation, not a walk)
  function place(ped, lx, lz, y, face) {
    if (!ped || ped.dead) return;
    const w = W(lx, lz);
    ped.pos.set(w.x, y, w.z); ped.group.position.set(w.x, y, w.z);
    // (systems/bodymove.js's net sweeps every body from where it stood last frame:
    //  undeclared, a man set down inside the ropes is stopped on their outside)
    if (CBZ.bodyTeleported) CBZ.bodyTeleported(ped);
    if (face != null) ped.group.rotation.y = face;
    if (ped.staffPost) { ped.staffPost.x = w.x; ped.staffPost.z = w.z; ped.staffPost.face = ped.group.rotation.y; }
    ped._feetY = null; ped._feetT = 0;
  }
  // a man on the canvas stays on it, inside the ropes, and his post follows him
  // (city/peds.js roots posted staff and turns them back to their post's facing)
  function hold(ped) {
    const R = RING(), o = V.origin, p = ped.pos, f = R.fight;
    p.x = Math.min(o.x + f, Math.max(o.x - f, p.x));
    p.z = Math.min(o.z + f, Math.max(o.z - f, p.z));
    p.y = R.y;
    ped.group.position.set(p.x, p.y, p.z);
    if (ped.staffPost) { ped.staffPost.x = p.x; ped.staffPost.z = p.z; ped.staffPost.face = ped.group.rotation.y; }
  }
  // one boxing step toward a spot (the feet move, the root follows: CBZ.verbs.step)
  function stepTo(ped, st, wx, wz, dt, stride) {
    const dx = wx - ped.pos.x, dz = wz - ped.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.25) return true;
    const Vb = VB();
    if (!Vb || downOf(ped)) return false;
    faceTo(ped, Math.atan2(dx, dz));
    st.stepT = (st.stepT || 0) - dt;
    if (st.stepT <= 0) { Vb.step(ped, dx, dz, Math.min(stride || 0.5, d), 0.3); st.stepT = 0.32; }
    return false;
  }
  // back to a clean start: nothing in flight, on his feet, awake, hands as told
  function freshen(ped, guard) {
    const Vb = VB();
    if (!ped || ped.dead) return;
    if (CBZ.vitals && CBZ.vitals.reset) { try { CBZ.vitals.reset(ped); } catch (e) {} }
    if (ped._vfS && ped._vfS.leave) ped._vfS.leave();
    ped._mcond = null; ped._vfS = null; ped.ko = 0;
    if (!Vb) return;
    Vb.cancelStrike(ped);
    if (ped.char && ped.char.fall && ped.char.fall.on) Vb.getUp(ped);
    if (ped.char) { ped.char.winded = 0; ped.char.handsUp = false; }
    Vb.guard(ped, !!guard);
  }
  // THE ENGINE'S FIGHTER, under boxing rules: fists only, and he never
  // follows a man to the floor
  function boxer(ped, skill, aggr) {
    const Vb = VB();
    if (!Vb || !Vb.fighter) return null;
    if (ped._vfS && ped._vfS.leave) ped._vfS.leave();
    ped._vfS = null;
    const F = Vb.fighter(ped, { skill: skill, aggression: aggr, style: "boxer" });
    const throwIt = F.strikeAct;
    F.strikeAct = function (kind, o, t) { return throwIt.call(this, GLOVED[kind] || kind, o, t); };
    return F;
  }
  // YOUR HANDS ARE GLOVED IN THE RING. systems/melee.js picks the blow for
  // the one button; chest to chest it throws knees and elbows. In a round of
  // your bout those come out as an uppercut and a hook instead (a deliberate
  // kick, on the back key, is still a kick, and a foul).
  const GLOVE_CLOSE = { knee: "upper", elbow: "hook" };
  (function gloveYourHands() {
    const M = CBZ.melee;
    if (!M || typeof M.pick !== "function" || M.pick._boxWrap) return;
    const orig = M.pick;
    const w = function (c) {
      const r = orig.apply(this, arguments);
      const b = BOUT;
      if (r && b && b.kind === "player" && !b.over && b.phase === "round" && GLOVE_CLOSE[r.kind]) r.kind = GLOVE_CLOSE[r.kind];
      return r;
    };
    w._boxWrap = true;
    M.pick = w;
  })();
  function mkSide(corner, ped, name, skill, aggr) {
    return { corner: corner, ped: ped || null, player: !ped, name: name, skill: skill, aggr: aggr,
      pts: 0, kdRound: 0, kdBout: 0, foulRound: 0, fouls: 0, landed: 0, legs: 1, downT: 0, riseAt: 0,
      F: null, O: null, stepT: 0, cutLeft: 2 };
  }
  const CORNER = { red: [-2.6, -2.6], blue: [2.6, 2.6] };
  const NEUTRAL = [[2.7, -2.7], [-2.7, 2.7]];
  const REF_HOME = [-2.9, 2.9];

  /* ==========================================================
     4. A BLOW THAT LANDED (the only place a bout's numbers move)
     att, def: sides. res: CBZ.verbs' result (zone, power, blocked, dir).
     ========================================================== */
  const _plHit = { kind: "fist", zone: null, point: null, power: 0.6, blocked: false, heavy: false };
  function landed(att, def, res) {
    const b = BOUT;
    if (!b || b.phase !== "round" || (att !== b.red && att !== b.blue)) { res.reaction = "none"; return; }
    if (downOf(actorOf(def))) { res.reaction = "none"; return; }
    const pw = res.power != null ? res.power : 0.6, zm = res.dmgMul || 1;
    const Vb = VB();
    // A HARD ONE UNDER THE RIBS drops a man to a knee: that is CBZ.verbs' own
    // answer to a liver shot, and to any body shot once his wind is gone, every
    // time. In ten-ounce gloves on a trained man it is a knockdown now and then:
    // not on a fresh one, more as his legs go, and never twice inside half a
    // minute. The rest he folds round it and stays up. (Unchecked, a bout ended
    // in eight seconds on the three-knockdown rule.)
    if (res.reaction === "liver" && !res.blocked) {
      const since = b.time - (def.kneeT == null ? -99 : def.kneeT);
      const drops = since > 25 && (def.player ? Math.random() < 0.2 : (def.legs < 0.4 || (def.legs < 0.75 && Math.random() < 0.15)));
      if (drops) def.kneeT = b.time; else res.reaction = "fold";
    }
    if (def.player) {
      // YOUR body is the city's: the same hurt, the same guard (hold the attack
      // button), the same knockout (city/death.js hands a fist to systems/vitals.js)
      const P = CBZ.player, hp0 = P.hp, ap = att.ped.pos;
      const dmg = 5 + 9 * pw;
      _plHit.zone = res.zone || null; _plHit.point = res.point || null; _plHit.power = pw * RULES.GLOVES;
      _plHit.blocked = !!res.blocked; _plHit.heavy = !!res.heavy;
      if (CBZ.cityHurtPlayer) { try { CBZ.cityHurtPlayer(res.blocked ? dmg : dmg * zm, ap.x, ap.z, "beaten in the ring", false, att.ped, true, _plHit); } catch (e) {} }
      const lost = hp0 - P.hp;
      if (lost > 0.4) { att.pts += pw * zm * (lost < dmg * 0.25 ? 0.2 : 1); att.landed++; }
      if (P.dead || downOf(playerActor())) res.reaction = "none";
      if (lost > 6 && zm >= 1) crowd(0.35, 0);
      return;
    }
    // on the gloves: the judges give it a little, and the man who caught it a little more
    if (res.blocked) { att.pts += 0.05 * pw; def.pts += 0.08; return; }
    // what the judges score is a clean punch: a tired arm punch that lands is
    // a quarter of one (volume is not the fight)
    att.pts += pw * zm * (pw < 0.3 ? 0.25 : 1); att.landed++;
    def.legs -= pw * zm * RULES.WEAR / (0.6 + def.skill);
    const VT = CBZ.vitals;
    let r = "none";
    if (VT && VT.blunt) {
      r = VT.blunt(def.ped, { zone: res.zone || "head", power: pw, weapon: "fist", heavy: !!res.heavy,
        by: actorOf(att), dirX: res.dir ? res.dir.x : 0, dirZ: res.dir ? res.dir.z : 1,
        mul: RULES.GLOVES / (0.7 + 0.7 * def.skill) });          // a better man rides a punch
    }
    if (r === "ko" || r === "dead") { res.reaction = "none"; crowd(1, 0, SHOUT_DOWN); return; }   // vitals laid him out
    if (r === "knockdown" || def.legs <= 0) {
      // down for a count: in his own rig, held there until he beats it (or does not)
      res.reaction = "none";
      def.legs = 0.35;
      def.riseAt = Math.random() < 0.1 + 0.22 * def.kdBout ? 99 : 2.6 + Math.random() * 4.2 + 1.6 * def.kdBout - 1.2 * def.skill;
      if (Vb) Vb.knockdown(def.ped, { dir: res.dir, ko: false, dur: 40, power: pw });
      crowd(0.9, 0, SHOUT_DOWN);
      return;
    }
    if (pw * zm > 0.75) crowd(0.3, 0);
  }
  // a foul of yours: a warning, then a point each time, then you are out
  function foul(why) {
    const b = BOUT;
    if (!b || b.kind !== "player" || b.over) return;
    const me = b.red;
    me.fouls++;
    if (me.fouls >= RULES.FOUL_LIMIT) { refSay("I warned you. You're disqualified!", 3); finish(b.blue, "DQ"); return; }
    if (me.fouls === 1) { refSay(why + " That's your warning.", 2.6); return; }
    me.foulRound++;
    refSay(why + " Point off.", 2.6);
    crowd(0, 0.6);
  }
  // one of YOUR blows met him (city/combat.js hands a landed swing to ped.meleeHit
  // instead of the street's assault path): score it like any other blow
  function yourBlow(res, dmg, tier) {
    const b = BOUT;
    if (!b || b.kind !== "player" || b.over) { res.reaction = "none"; return; }
    if (res.weapon) { refSay("A weapon! You're disqualified!", 3); finish(b.blue, "DQ"); return; }
    if (b.phase !== "round") { res.reaction = "none"; if (b.phase === "rest" || b.phase === "count") foul(b.phase === "count" ? "He's down!" : "After the bell!"); return; }
    if (foulBlow(res)) { foul(/knee|elbow/.test(String(res.kind || "")) ? "No knees, no elbows!" : "Fists only!"); res.reaction = "none"; return; }
    // A TIRED MAN AND A MASHER HIT LIKE A CHILD. What a punch of yours carries
    // is your wind (systems/stamina on CBZ.player) and whether it was set up:
    // the third swing of a flurry is an arm punch.
    const P = CBZ.player, st = P.stamina == null ? 100 : P.stamina;
    const n = flurry(b);
    const wind = 0.3 + 0.7 * Math.min(1, st / 50);
    const arm = n >= RULES.ARM_PUNCH + 1 ? 0.45 : n >= RULES.ARM_PUNCH ? 0.7 : 1;
    res.power = (res.power != null ? res.power : 0.6) * wind * arm;
    // HE READS YOU. A trained man who is not hurt catches some of what you
    // throw on the gloves, more of it the more you throw the same way, and
    // throws back into the hole you leave (systems/melee.js's counter beat).
    const opp = b.blue, VT = CBZ.vitals, daze = VT && VT.daze ? VT.daze(opp.ped) : 0;
    if (!res.blocked && opp.ped && !downOf(opp.ped)) {
      const read = RULES.READ + 0.38 * opp.skill + (n >= RULES.ARM_PUNCH ? 0.22 : 0) + (st < 25 ? 0.12 : 0) - 0.6 * daze - (1 - opp.legs) * 0.25;
      if (Math.random() < read) {
        // on the gloves: the rig plays the block, not the hit it was going to
        res.blocked = true; res.landed = false; res.reaction = "block"; res.stagger = false;
        const Vb = VB();
        if (Vb && Vb.block) { try { Vb.block(opp.ped, 0.35); } catch (e) {} }
        if (opp.F) opp.F.counterT = 0.4;
        // and he answers it a beat later, into the arm you left out there
        b.counterAt = b.time + 0.14;
        b.caught = (b.caught || 0) + 1;
      }
    }
    landed(b.red, b.blue, res);
    void dmg; void tier;
  }
  // how many of your swings are in this flurry (the window ends at RULES.FLURRY)
  function flurry(b) {
    const L = b.sw || [];
    let n = 0;
    for (let i = L.length - 1; i >= 0 && b.time - L[i] <= RULES.FLURRY; i--) n++;
    return n;
  }

  /* ==========================================================
     5. THE BOUT
     phases: wait (yours: he is in his corner, you are not in the ring yet)
             walkout -> round <-> count -> rest -> round ... -> decision -> clear
     ========================================================== */
  function mkBout(kind, red, blue) {
    const b = { id: ++boutSeq, kind: kind, red: red, blue: blue, round: 1, clock: RULES.ROUND_SEC,
      phase: "walkout", t: 3.4, time: 0, cards: [[], [], []], count: null, over: false,
      winner: null, method: null, bet: null, oddsRed: 2, oddsBlue: 2, lines: null, outT: 0, called: 0,
      opp: null, purse: 0, title: false, refT: 0, restT: 0 };
    [[red, blue], [blue, red]].forEach(function (pr) {
      const s = pr[0], o = pr[1];
      if (s.player) return;
      s.F = boxer(s.ped, s.skill, s.aggr);
      s.O = { perform: true, groundAndPound: false, onLand: function (res) { landed(s, o, res); } };
    });
    return b;
  }
  function other(b, s) { return s === b.red ? b.blue : b.red; }
  function arenaBoard(a, b, c) { const R = RING(); if (R && near) { try { R.board(a, b, c); } catch (e) {} } }
  function castReady() {
    if (!V || !V.fA || !V.fB) return false;
    const a = V.fA.ped, b = V.fB.ped;
    return !!(a && b && !a.dead && !b.dead && !a.surrender && !b.surrender);
  }

  // ---- the house card: two of the stable, a favourite and his odds ----
  function startCard() {
    if (!castReady() || !VB()) return;
    const R = RING(), names = R.names;
    const i1 = (Math.random() * names.length) | 0; let i2 = (Math.random() * names.length) | 0;
    if (i2 === i1) i2 = (i2 + 1) % names.length;
    const p = 0.35 + Math.random() * 0.30;                 // red's true chance
    const ra = V.fA.ped, rb = V.fB.ped;
    freshen(ra, true); freshen(rb, true);
    ra.name = names[i1]; rb.name = names[i2];
    place(ra, CORNER.red[0], CORNER.red[1], R.y, Math.PI / 4);
    place(rb, CORNER.blue[0], CORNER.blue[1], R.y, -3 * Math.PI / 4);
    const b = BOUT = mkBout("card",
      mkSide("red", ra, names[i1], 0.3 + 0.5 * p, 0.35 + 0.5 * p),
      mkSide("blue", rb, names[i2], 0.3 + 0.5 * (1 - p), 0.35 + 0.5 * (1 - p)));
    b.pRed = p; b.oddsRed = oddsFromProb(p); b.oddsBlue = oddsFromProb(1 - p);
    drawCards();
    arenaBoard("BOUT #" + b.id, b.red.name + "  vs  " + b.blue.name, "RED @" + b.oddsRed.toFixed(2) + "   ·   BLUE @" + b.oddsBlue.toFixed(2));
    refSay("Three rounds. Touch gloves.", 2.4);
    if (near) say(V.bookie, b.red.name + " pays " + b.oddsRed.toFixed(2) + ", " + b.blue.name + " pays " + b.oddsBlue.toFixed(2) + ". Money down before the last round.", 3.6);
  }
  // the book moves with the judges: the man ahead on the cards pays less from here
  function reprice(b) {
    const tot = cardTotals(b);
    let lead = 0;
    for (let j = 0; j < 3; j++) lead += tot[j][0] - tot[j][1];
    const p = Math.min(0.9, Math.max(0.1, b.pRed + 0.14 * lead / 3));
    b.oddsRed = oddsFromProb(p); b.oddsBlue = oddsFromProb(1 - p);
    if (near) say(V.bookie, "After " + b.round + ": " + b.red.name + " " + b.oddsRed.toFixed(2) + ", " + b.blue.name + " " + b.oddsBlue.toFixed(2) + ".", 3.2);
    arenaBoard("AFTER ROUND " + b.round, b.red.name + "  vs  " + b.blue.name, "RED @" + b.oddsRed.toFixed(2) + "   ·   BLUE @" + b.oddsBlue.toFixed(2));
  }
  // the card is pulled (you took a fight, a fighter was hurt outside the rules):
  // stakes go back, the men stand down
  function voidCard(why) {
    const b = BOUT;
    if (!b) return;
    if (b.bet) {
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(b.bet.stake);
      tell(V.bookie, (why || "Bout's off.") + " Your " + fmt(b.bet.stake) + " back.");
      b.bet = null;
    }
    BOUT = null;
    if (V.fA) freshen(V.fA.ped, false);
    if (V.fB) freshen(V.fB.ped, false);
  }

  // ---- your bout: the blue corner is the man the arena booked for you ----
  function startPlayerBout(offer) {
    const R = RING();
    voidCard("Card's changed.");
    const ra = V.fA.ped, rb = V.fB.ped, opp = offer.opp;
    freshen(ra, false); freshen(rb, true);
    V.blueName = rb.name; rb.name = opp.name;
    place(ra, -6.4, 0.9, R.deck, Math.PI / 2);              // the house's red corner man watches from the floor
    place(rb, CORNER.blue[0], CORNER.blue[1], R.y, -3 * Math.PI / 4);
    const b = BOUT = mkBout("player",
      mkSide("red", null, "You", 0.5, 0.5),
      mkSide("blue", rb, opp.name, opp.skill, 0.5 + 0.45 * opp.skill));
    b.opp = opp; b.purse = offer.purse; b.title = offer.title;
    b.phase = "wait"; b.t = 90;
    rb.meleeHit = yourBlow;
    // (the registry's own flag for "a person who is his job": no Threaten / Mug /
    //  Pickpocket card over the man you are boxing)
    V.blueOnly = rb._iOnly; rb._iOnly = true; rb._iBout = true;
    R.event = "box";                                         // the house comes in for it
    drawCards();
    arenaBoard("BOXING" + (b.title ? " TITLE BOUT" : " BOUT"), "YOU  vs  " + opp.name, "purse " + fmt(b.purse));
  }
  function endPlayerBout() {
    const R = RING(), rb = V.fB && V.fB.ped, ra = V.fA && V.fA.ped;
    if (rb) { rb.meleeHit = null; rb._iOnly = !!V.blueOnly; rb._iBout = false; if (V.blueName) rb.name = V.blueName; }
    V.blueName = null; V.blueOnly = false;
    if (R) R.event = null;
    if (ra && !ra.dead) { freshen(ra, false); place(ra, CORNER.red[0], CORNER.red[1], R.y, Math.PI / 4); }
    if (rb && !rb.dead) freshen(rb, false);
    cutmanDown();
    arenaBoard("IRONJAW ARENA", "FIGHT NIGHT", "BOXING / MMA / BEAST PIT");
  }
  function inRing(pos) {
    const R = RING(), o = V.origin;
    return Math.abs(pos.x - o.x) < R.half + 0.25 && Math.abs(pos.z - o.z) < R.half + 0.25 && pos.y > R.y - 0.4;
  }

  // ---- judges ----
  function judgeRound(b) {
    const a = b.red, c = b.blue;
    for (let j = 0; j < 3; j++) {
      const na = 0.9 + 0.2 * Math.random(), nb = 0.9 + 0.2 * Math.random();       // each judge sees his own fight
      b.cards[j].push(tenPointMust({ score: a.pts * na, kd: a.kdRound, fouls: a.foulRound }, { score: c.pts * nb, kd: c.kdRound, fouls: c.foulRound }));
    }
    a.pts = c.pts = 0; a.kdRound = c.kdRound = 0; a.foulRound = c.foulRound = 0;
  }
  function cardTotals(b) {
    const out = [];
    for (let j = 0; j < 3; j++) {
      let ta = 0, tb = 0;
      for (let r = 0; r < b.cards[j].length; r++) { ta += b.cards[j][r][0]; tb += b.cards[j][r][1]; }
      out.push([ta, tb]);
    }
    return out;
  }
  function decide(b) {
    const tot = cardTotals(b);
    let ja = 0, jb = 0;
    for (let j = 0; j < 3; j++) { if (tot[j][0] > tot[j][1]) ja++; else if (tot[j][1] > tot[j][0]) jb++; }
    // a man needs two of the three cards
    if (ja >= 2) finish(b.red, ja === 3 ? "UD" : jb ? "SD" : "MD");
    else if (jb >= 2) finish(b.blue, jb === 3 ? "UD" : ja ? "SD" : "MD");
    else finish(null, "DRAW");
  }
  const METHOD = { KO: "knockout", TKO: "technical knockout", UD: "unanimous decision", SD: "split decision",
    MD: "majority decision", DQ: "disqualification", RTD: "retirement", DRAW: "a draw" };

  // ---- the end: the referee says it, the board shows it, the money moves ----
  function finish(win, method) {
    const b = BOUT;
    if (!b || b.over) return;
    b.over = true; b.winner = win ? win.corner : "draw"; b.method = method;
    b.phase = "decision"; b.t = 8.5; b.count = null;
    const tot = cardTotals(b);
    const byCards = method === "UD" || method === "SD" || method === "MD" || method === "DRAW";
    const whoWon = win ? (win.player ? "the red corner" : win.name) : "";
    b.lines = [];
    if (byCards) {
      b.lines.push({ at: 1.2, text: "The judges score it " + tot.map(function (t) { return t[0] + " " + t[1]; }).join(", ") + ".", secs: 3.6 });
      b.lines.push({ at: 4.8, text: win ? "The winner, by " + METHOD[method] + ": " + whoWon + "!" : "This bout is a draw!", secs: 3.6 });
    } else {
      b.lines.push({ at: 1.4, text: "The winner, by " + METHOD[method] + " in round " + b.round + ": " + whoWon + "!", secs: 4 });
    }
    if (!byCards) ringBell(3);                  // (a decision comes after the last bell, which has rung)
    drawCards();
    arenaBoard(win ? "WINNER BY " + (byCards ? "DECISION" : method) : "A DRAW",
      win ? (win.player ? "YOU" : win.name) : b.red.name + "  /  " + b.blue.name,
      byCards ? tot.map(function (t) { return t[0] + "-" + t[1]; }).join("   ") : "ROUND " + b.round);
    crowd(byCards && method !== "UD" ? 0.7 : 1, method === "SD" || method === "DRAW" || method === "DQ" ? 0.5 : 0.05, SHOUT_END);
    const Vb = VB();
    [b.red, b.blue].forEach(function (s) { if (!s.player && s.ped && Vb) { Vb.cancelStrike(s.ped); Vb.guard(s.ped, false); } });

    if (b.kind === "card") {
      if (b.bet) {
        const t = b.bet;
        if (!win) {
          if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(t.stake);
          tell(V.bookie, "A draw. Stakes back: " + fmt(t.stake) + ".");
        } else {
          const won = t.side === win.corner;
          const pay = CBZ.betSlip ? CBZ.betSlip.settle(t, won) : 0;
          tell(V.bookie, won ? win.name + " by " + METHOD[method] + ". Your ticket pays " + fmt(pay) + "." : win.name + " took it. " + fmt(t.stake) + " to the house.");
        }
        b.bet = null;
      }
      return;
    }
    // yours: the arena's one career keeps the record, the fame and the belt
    const K = RING().career, P = CBZ.player;
    if (win && win.player) {
      const ko = method === "KO" || method === "TKO";
      const war = b.time > 120 && P.hp <= (P.maxHp || 200) * 0.3;
      K.win(b.opp, ko, war, b.purse);
      b.lines.push({ at: byCards ? 8.0 : 5.2, who: "promoter", text: "Your purse. " + fmt(b.purse) + ".", secs: 3 });
      b.t = Math.max(b.t, byCards ? 10.5 : 8.5);
    } else if (win) {
      K.loss();
      b.lines.push({ at: byCards ? 8.0 : 5.2, who: "promoter", text: method === "DQ" || method === "RTD" ? "No purse for that." : "No purse tonight. Come back when you're ready.", secs: 3 });
      b.t = Math.max(b.t, byCards ? 10.5 : 8.5);
    } else {
      const half = Math.round(b.purse / 2);
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(half);
      b.lines.push({ at: 8.0, who: "promoter", text: "A draw splits it. " + fmt(half) + ".", secs: 3 });
      b.t = Math.max(b.t, 10.5);
    }
  }

  // ---- the count ----
  function startCount(b, s) {
    s.kdBout++; s.kdRound++;
    const up = other(b, s);
    const Vb = VB();
    if (!up.player && Vb) Vb.cancelStrike(up.ped);
    arenaBoard("DOWN!", (up.player ? "YOU drop " : up.name + " drops ") + (s.player ? "YOU" : s.name), "the referee is counting");
    if (s.kdBout >= RULES.KD_LIMIT) { refSay("That's enough! It's over!", 2.6); finish(up, "TKO"); return; }
    b.phase = "count"; b.count = { side: s, t: 0, n: 0 };
    if (!s.player && !(s.riseAt > 0) && !outCold(s.ped)) s.riseAt = 3 + Math.random() * 3;   // put down by the blow itself (a liver shot)
  }
  function tickCount(b, dt) {
    const c = b.count, s = c.side, up = other(b, s), a = actorOf(s), Vb = VB();
    c.t += dt;
    // the man on his feet goes to the far neutral corner
    if (!up.player && up.ped && !up.ped.dead) {
      const sp = posOf(s);
      let best = NEUTRAL[0], bd = -1;
      for (let i = 0; i < NEUTRAL.length; i++) { const w = W(NEUTRAL[i][0], NEUTRAL[i][1]); const d = Math.hypot(w.x - sp.x, w.z - sp.z); if (d > bd) { bd = d; best = NEUTRAL[i]; } }
      const w = W(best[0], best[1]);
      if (stepTo(up.ped, up, w.x, w.z, dt, 0.55)) faceTo(up.ped, Math.atan2(sp.x - up.ped.pos.x, sp.z - up.ped.pos.z));
      hold(up.ped);
    } else if (up.player && b.kind === "player" && CBZ.player._gnpOn && CBZ.player._gnpOn === s.ped) {
      // on top of a man who is down (the street's ground and pound: city/combat.js):
      // a foul every time the referee has to say it
      c.gnpT = (c.gnpT || 0) - dt;
      if (c.gnpT <= 0) { c.gnpT = 2.5; foul("He's down! Get off him!"); if (BOUT !== b || b.over) return; }
    }
    // an AI man beats the count when his head clears (a man out cold does not)
    if (!s.player && s.riseAt > 0 && c.t >= s.riseAt && !outCold(s.ped)) { s.riseAt = 0; if (Vb) Vb.getUp(s.ped); }
    if (!s.player && s.ped) hold(s.ped);
    if (c.t > 0.8 && !downOf(a)) {                       // on his feet again
      b.phase = "round"; b.count = null; s.downT = 0; s.riseAt = 0;
      if (!s.player && Vb) Vb.guard(s.ped, true);
      refSay("Box!", 1.4);
      return;
    }
    const n = Math.min(10, 1 + Math.floor(c.t / RULES.COUNT_SEC));
    if (n !== c.n) {
      c.n = n;
      refSay(n === 10 ? "Ten! You're out!" : n + "!", 1.1);
      if (n === 8) crowd(0.5, 0, SHOUT_DOWN);
    }
    if (c.t >= 10 * RULES.COUNT_SEC + 0.5) finish(up, "KO");
  }

  // ---- the referee's feet: near the action, out of the punches ----
  function driveRef(b, dt) {
    const h = V.ref, ped = h && h.ped;
    if (!ped || ped.dead) return;
    const R = RING(), o = V.origin;
    if (!inRingLocal(ped)) return;                       // scared off, knocked out of the ring: he is his own man
    let tx, tz, lx, lz;
    if (b && b.count) {
      const sp = posOf(b.count.side);
      const dx = o.x - sp.x, dz = o.z - sp.z, l = Math.hypot(dx, dz) || 1;
      tx = sp.x + dx / l * 1.1; tz = sp.z + dz / l * 1.1; lx = sp.x; lz = sp.z;
    } else if (b && (b.phase === "round" || b.phase === "walkout")) {
      const a = posOf(b.red), c = posOf(b.blue);
      const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2;
      let nx = -(c.z - a.z), nz = c.x - a.x; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      // the side of them that is nearer the middle of the ring
      if ((mx + nx * 2.3 - o.x) * (mx + nx * 2.3 - o.x) + (mz + nz * 2.3 - o.z) * (mz + nz * 2.3 - o.z) >
          (mx - nx * 2.3 - o.x) * (mx - nx * 2.3 - o.x) + (mz - nz * 2.3 - o.z) * (mz - nz * 2.3 - o.z)) { nx = -nx; nz = -nz; }
      tx = mx + nx * 2.3; tz = mz + nz * 2.3; lx = mx; lz = mz;
    } else if (b && b.phase === "decision") {
      tx = o.x; tz = o.z + 0.4; lx = o.x; lz = o.z + 6;
    } else {
      const w = W(REF_HOME[0], REF_HOME[1]); tx = w.x; tz = w.z; lx = o.x; lz = o.z;
    }
    const lim = R.fight + 0.2;
    tx = Math.min(o.x + lim, Math.max(o.x - lim, tx)); tz = Math.min(o.z + lim, Math.max(o.z - lim, tz));
    const d = Math.hypot(tx - ped.pos.x, tz - ped.pos.z);
    if (d > 0.9 || V.refMoving) {
      V.refMoving = !stepTo(ped, V, tx, tz, dt, 0.55);
    } else faceTo(ped, Math.atan2(lx - ped.pos.x, lz - ped.pos.z), 0.15);
    ped.pos.y = R.y; ped.group.position.set(ped.pos.x, R.y, ped.pos.z);
    if (ped.staffPost) { ped.staffPost.x = ped.pos.x; ped.staffPost.z = ped.pos.z; ped.staffPost.face = ped.group.rotation.y; }
    const Vb = VB();
    if (Vb && ped.char && ped.char.fightStance) Vb.guard(ped, false);
  }
  function inRingLocal(ped) { const R = RING(), o = V.origin; return Math.abs(ped.pos.x - o.x) < R.half + 0.6 && Math.abs(ped.pos.z - o.z) < R.half + 0.6; }

  // ---- one AI man, one frame of a round ----
  function fightAI(b, s, dt) {
    const ped = s.ped, o = other(b, s), Vb = VB();
    if (!ped || ped.dead || !s.F || !Vb) return;
    if (downOf(ped)) { hold(ped); return; }
    if (b.kind === "player") s.F.aggr = Math.min(0.98, s.aggr + urgency(b, s));
    // A TRAINED MAN'S LUNGS. The street fighter's wind (systems/melee.js) is
    // built for a ten-second scuffle; a boxer paces three rounds. He gets his
    // breath back between his own combinations, a better man faster.
    s.F.stam = Math.min(1, s.F.stam + dt * (0.05 + 0.08 * s.skill));
    const tp = posOf(o), d = Math.hypot(tp.x - ped.pos.x, tp.z - ped.pos.z);
    // THE COUNTER. A punch of yours he caught on the gloves leaves your arm
    // out there: he throws back into it, a beat later, if he is in range.
    if (b.counterAt != null && b.time >= b.counterAt && o.player) {
      b.counterAt = null;
      if (d > 0.85 && d < 1.25 && !Vb.strikeOf(ped) && s.F.stam > 0.08) {
        try { s.F.strikeAct(Math.random() < 0.5 ? "cross" : Math.random() < 0.6 ? "hook" : "upper", s.O, actorOf(o)); } catch (e) {}
      }
    }
    if (d > 2.7 && !Vb.strikeOf(ped)) { if (!ped.char.fightStance) Vb.guard(ped, true); stepTo(ped, s, tp.x, tp.z, dt, 0.5); }
    else s.F.tick(dt, actorOf(o), s.O);
    hold(ped);
  }
  // HE COMES BACK. A man behind on the cards goes looking for it, more so in
  // the last round; a man who has just been put down and got up comes out
  // angry; a man who sees you blowing steps on the gas. A man with no legs
  // left cannot, whatever he wants.
  function urgency(b, s) {
    let u = 0;
    if (b.cards[0].length) {
      const tot = cardTotals(b);
      let behind = 0;
      for (let j = 0; j < 3; j++) behind += (s === b.blue ? tot[j][0] - tot[j][1] : tot[j][1] - tot[j][0]);
      if (behind > 0) u += b.round >= RULES.ROUNDS ? 0.3 : 0.15;
    }
    if (s.kdRound > 0) u += 0.15;
    const o = other(b, s);
    if (o.player) { const st = CBZ.player.stamina == null ? 100 : CBZ.player.stamina; if (st < 30) u += 0.2; }
    return u * Math.max(0.3, s.legs);
  }
  // BREAK! Two men chest to chest are not boxing: neither can throw a clean
  // punch (and the engine's fighter whiffs everything at that range). The
  // referee steps in, says it, and walks them apart; the man in the house
  // corner takes the step back.
  function breakClinch(b, dt) {
    const a = actorOf(b.red), c = actorOf(b.blue);
    const pa = posOf(b.red), pc = posOf(b.blue);
    if (!a || !c || downOf(a) || downOf(c)) { b.clinchT = 0; return; }
    const d = Math.hypot(pc.x - pa.x, pc.z - pa.z);
    b.breakCD = Math.max(0, (b.breakCD || 0) - dt);
    b.clinchT = d < 0.88 ? (b.clinchT || 0) + dt : 0;
    if (b.clinchT < 1.3 || b.breakCD > 0) return;
    b.clinchT = 0; b.breakCD = 2.5;
    refSay("Break!", 1.2);
    const ux = (pc.x - pa.x) / (d || 1), uz = (pc.z - pa.z) / (d || 1);
    const Vb = VB();
    [[b.blue, 1], [b.red, -1]].forEach(function (pr) {
      const sd = pr[0];
      if (sd.player || !sd.ped) return;
      if (Vb) Vb.cancelStrike(sd.ped);
      const k = b.kind === "player" ? 0.75 : 0.4;
      sd.ped.pos.x += ux * pr[1] * k; sd.ped.pos.z += uz * pr[1] * k;
      if (CBZ.bodyTeleported) CBZ.bodyTeleported(sd.ped);
      hold(sd.ped);
    });
  }
  // the fight works its way back off the ropes: a pair pinned in a corner cannot
  // step in, and the ropes would eat every lunge (nothing moves a man mid-blow)
  function offTheRopes(b, dt) {
    const Vb = VB(), o = V.origin, ra = b.red.ped, rb = b.blue.ped;
    if (!Vb || !ra || !rb || downOf(ra) || downOf(rb) || Vb.strikeOf(ra) || Vb.strikeOf(rb)) return;
    const mx = (ra.pos.x + rb.pos.x) * 0.5 - o.x, mz = (ra.pos.z + rb.pos.z) * 0.5 - o.z, md = Math.hypot(mx, mz);
    if (md < 0.8) return;
    const k = Math.min(md - 0.8, 0.55 * dt) / md;
    ra.pos.x -= mx * k; ra.pos.z -= mz * k; rb.pos.x -= mx * k; rb.pos.z -= mz * k;
    hold(ra); hold(rb);
  }
  function toCorner(s, dt) {
    const ped = s.ped;
    if (!ped || ped.dead || downOf(ped)) return;
    const c = CORNER[s.corner], w = W(c[0], c[1]), o = V.origin;
    if (stepTo(ped, s, w.x, w.z, dt, 0.55)) faceTo(ped, Math.atan2(o.x - ped.pos.x, o.z - ped.pos.z), 0.15);
    hold(ped);
  }

  // a boxer's head clears faster than a man's in the street (the same number, systems/vitals.js)
  function clearHeads(b, amt) {
    const VT = CBZ.vitals;
    if (!VT || !VT.peek) return;
    for (const s of [b.red, b.blue]) {
      const Rv = VT.peek(s.player ? CBZ.player : s.ped);
      if (Rv && Rv.daze > 0 && !(Rv.koT > 0)) Rv.daze = Math.max(0, Rv.daze - amt);
    }
  }
  function endRound(b) {
    judgeRound(b);
    ringBell(3);
    drawCards();
    const Vb = VB();
    [b.red, b.blue].forEach(function (s) { if (!s.player && s.ped && Vb) { Vb.cancelStrike(s.ped); Vb.guard(s.ped, false); } });
    if (b.round >= RULES.ROUNDS) { refSay("That's the fight!", 2); decide(b); return; }
    refSay("Break! Corners.", 2);
    crowd(0.55, 0, []);
    b.phase = "rest"; b.restT = 0; b.sat = false;
    b.t = b.kind === "player" ? RULES.CORNER_SEC : RULES.REST_SEC;
    if (b.kind === "player") cutmanUp(b); else reprice(b);
  }
  function startRound(b) {
    b.round++; b.clock = RULES.ROUND_SEC; b.phase = "round"; b.called = 0;
    clearHeads(b, RULES.REST_CLEAR);
    [b.red, b.blue].forEach(function (s) {
      s.legs = Math.min(1, s.legs + 0.3);
      if (s.F) s.F.stam = Math.min(1, s.F.stam + 0.45);
      if (s.player) {
        const P = CBZ.player, mx = P.maxHp || 200;
        P.stamina = Math.min(100, (P.stamina == null ? 100 : P.stamina) + 45);
        P.hp = Math.min(mx, P.hp + mx * 0.12);
      }
      if (!s.player && s.ped) VB().guard(s.ped, true);
    });
    if (b.kind === "player") cutmanDown();
    ringBell(1);
    refSay("Round " + b.round + ". Box!", 2);
    arenaBoard("ROUND " + b.round, (b.red.player ? "YOU" : b.red.name) + "  vs  " + b.blue.name, "");
  }

  function tickBout(dt) {
    const b = BOUT, P = CBZ.player, R = RING(), o = V.origin;
    if (!b) return;
    b.time += dt;
    // a man of the cast was shot, or is gone: there is no bout
    const peds = [b.red.ped, b.blue.ped];
    for (let i = 0; i < 2; i++) if (peds[i] && peds[i].dead) { abandon("A fighter is down for good. The card is off."); return; }
    // a gun on the ring: hands go up (city/peds.js) and the fight stands still until it is gone
    for (let i = 0; i < 2; i++) if (peds[i] && (peds[i].surrender || peds[i]._covered)) return;
    // you, in the ring, in somebody else's bout: it stops until you are out of it
    if (b.kind === "card" && !b.over && inRing(P.pos)) {
      clearT -= dt;
      if (clearT <= 0) { clearT = 6; refSay("Get out of my ring!", 2.2); }
      return;
    }

    // NO HEALING ON YOUR FEET. The street's out-of-combat regen (city/death.js,
    // paused while _hurtT runs) does not run in a bout: what you have taken
    // stays taken. The minute on the stool gives some of it back (startRound).
    if (b.kind === "player" && !b.over && b.phase !== "wait") P._hurtT = Math.max(P._hurtT || 0, 0.25);
    if (b.phase === "wait") {
      // he is in his corner; the ring is yours to walk into (the steps, the gap in the ropes)
      b.t -= dt;
      toCorner(b.blue, dt);
      const far = Math.hypot(P.pos.x - o.x, P.pos.z - o.z) > 45;
      if (b.t <= 0 || far || P.dead) { say(V.promoter, "Forget it, then.", 2.4); abandon(null); return; }
      if (inRing(P.pos)) {
        b.phase = "walkout"; b.t = 3.2;
        refSay("Three rounds. Protect yourself at all times. Touch gloves.", 3);
        crowd(0.8, 0, []);
      }
      return;
    }
    if (b.phase === "walkout") {
      b.t -= dt;
      const m = [[-1.3, -0.5], [1.3, 0.5]];
      [b.red, b.blue].forEach(function (s, i) {
        if (s.player || !s.ped) return;
        const w = W(m[i][0], m[i][1]);
        if (stepTo(s.ped, s, w.x, w.z, dt, 0.5)) { const q = posOf(other(b, s)); faceTo(s.ped, Math.atan2(q.x - s.ped.pos.x, q.z - s.ped.pos.z)); }
        hold(s.ped);
      });
      if (b.t <= 0) {
        b.phase = "round"; b.clock = RULES.ROUND_SEC;
        [b.red, b.blue].forEach(function (s) { if (!s.player && s.ped) VB().guard(s.ped, true); });
        ringBell(1);
        refSay("Round 1. Box!", 2);
        arenaBoard("ROUND 1", (b.red.player ? "YOU" : b.red.name) + "  vs  " + b.blue.name, "");
      }
      return;
    }
    if (b.phase === "round") {
      b.clock -= dt;
      if (!b.red.player) fightAI(b, b.red, dt);
      if (BOUT === b && b.phase === "round" && !b.blue.player) fightAI(b, b.blue, dt);
      if (BOUT !== b || b.phase !== "round") return;
      offTheRopes(b, dt);
      breakClinch(b, dt);
      clearHeads(b, RULES.CLEAR * dt);
      // who is on the floor (a jump is not a knockdown: it has to last)
      const sides = [b.red, b.blue];
      for (let i = 0; i < 2; i++) {
        const s = sides[i];
        s.downT = downOf(actorOf(s)) ? s.downT + dt : 0;
        if (s.downT > (s.player ? 0.45 : 0.12)) { startCount(b, s); return; }
      }
      if (b.kind === "player") {
        // THREE MINUTES OF THROWING IS NOT A STREET SCUFFLE. Every swing of yours
        // costs wind on top of what city/combat.js spends (4, or 8 for a power
        // shot, against 18 a second coming back): three a second and you are
        // empty in ten seconds, and an empty man's hands drop and his punches
        // arrive slow and light (the rig's own `winded`). Pick your shots.
        const Sw = VB() && VB().strikeOf ? VB().strikeOf(playerActor()) : null;
        if (Sw && Sw.id !== b.swingId) {
          b.swingId = Sw.id;
          (b.sw || (b.sw = [])).push(b.time); if (b.sw.length > 12) b.sw.shift();
          const extra = Math.max(0, flurry(b) - (RULES.ARM_PUNCH - 1)) * 3;
          P.stamina = Math.max(0, (P.stamina == null ? 100 : P.stamina) - RULES.SWING - extra);
        }
        // out of the ring with the round on is quitting on your feet
        b.outT = inRing(P.pos) ? 0 : b.outT + dt;
        if (b.outT > 3 || P.dead) { refSay("He's left the ring. It's over!", 2.6); finish(b.blue, "RTD"); return; }
        if (P.hp <= (P.maxHp || 200) * RULES.STOP_HP) { refSay("He's had enough. I'm stopping it!", 2.8); finish(b.blue, "TKO"); return; }
        // the corner calls the clock (there is no clock on your screen)
        if (b.clock <= 30 && b.called < 1) { b.called = 1; if (b.clock > 25) say(V.cutman, "Thirty seconds!", 1.8, 30); }
        else if (b.clock <= 10 && b.called < 2) { b.called = 2; say(V.cutman, "Ten seconds! Finish strong!", 1.8, 30); }
      }
      if (b.clock <= 0) endRound(b);
      return;
    }
    if (b.phase === "count") { tickCount(b, dt); return; }
    if (b.phase === "rest") {
      b.t -= dt; b.restT += dt;
      if (!b.red.player) toCorner(b.red, dt);
      if (!b.blue.player) toCorner(b.blue, dt);
      if (b.kind === "player") {
        if (P.dead || Math.hypot(P.pos.x - o.x, P.pos.z - o.z) > 45) { finish(b.blue, "RTD"); return; }
        // walking back out to the middle answers the bell (once you have been to your corner)
        const cw = W(CORNER.red[0], CORNER.red[1]);
        if (Math.hypot(P.pos.x - cw.x, P.pos.z - cw.z) < 2.4) b.sat = true;
        if (b.sat && b.restT > 4 && inRing(P.pos) && Math.hypot(P.pos.x - o.x, P.pos.z - o.z) < 1.1) b.t = 0;
        if (b.t <= 0 && !inRing(P.pos)) { refSay("He's not answering the bell. It's over!", 2.8); finish(b.blue, "RTD"); return; }
        if (b.t <= 8 && b.called < 3) { b.called = 3; refSay("Seconds out!", 1.8); }
      }
      if (b.t <= 0) startRound(b);
      return;
    }
    if (b.phase === "decision") {
      b.t -= dt;
      b.said = (b.said || 0) + dt;
      for (let i = 0; i < b.lines.length; i++) {
        const L = b.lines[i];
        if (L.done || b.said < L.at) continue;
        L.done = true;
        if (L.who === "promoter") tell(V.promoter, L.text, L.secs); else refSay(L.text, L.secs);
      }
      if (b.t <= 0) { b.phase = "clear"; b.t = 5; }
      return;
    }
    if (b.phase === "clear") {
      b.t -= dt;
      if (b.t <= 0) {
        const mine = b.kind === "player";
        BOUT = null;
        if (mine) endPlayerBout();
        else { freshen(b.red.ped, false); freshen(b.blue.ped, false); }
        gapT = 6;
      }
    }
  }
  // the bout cannot go on (a dead fighter, you never got in the ring): nobody wins it
  function abandon(why) {
    const b = BOUT;
    if (!b) return;
    if (why) toast(why);
    if (b.kind === "player") { BOUT = null; endPlayerBout(); }
    else voidCard("Bout's off.");
    gapT = 8;
  }

  /* ==========================================================
     6. WHAT YOU ASK OF PEOPLE
     ========================================================== */
  // ---- the promoter: one bout, one purse, your answer ----
  function askFight() {
    const R = RING(), K = R.career, c = K.state(), opp = K.booked(), purse = K.purse(opp), title = K.title();
    if (!castReady()) { say(V.promoter, "Not tonight. I've got nobody to put in with you.", 3); return; }
    OFFER = { opp: opp, purse: purse, title: title, t: CBZ.now || 0 };
    say(V.promoter, (title ? (c.beltBox ? "You defend the belt. " : "It's for the belt. ") : "") + "Three rounds with " + opp.name + ", " +
      opp.wins + " and " + opp.losses + ". The purse is " + fmt(purse) + ". You in?", 4.6);
  }
  function takeFight() {
    const o = OFFER; OFFER = null;
    if (!o) return;
    if (!castReady() || !VB()) { say(V.promoter, "Not tonight. I've got nobody to put in with you.", 3); return; }
    startPlayerBout(o);
    say(V.promoter, "Up the steps, red corner. The blue corner's waiting on you.", 3.6);
  }
  function passFight() { OFFER = null; say(V.promoter, "Your loss. The offer stands when you want it.", 3); }
  function callOff() { say(V.promoter, "Fine. He gets his walkover money from you next time.", 3.2); abandon(null); }
  function tellRecord() {
    const K = RING().career, c = K.state();
    if (c.wins + c.losses === 0) { say(V.promoter, "You've never had a fight here. Everybody starts at the bottom of the card.", 3.8); return; }
    say(V.promoter, "You're " + c.wins + " and " + c.losses + ", " + c.kos + " by knockout. The papers call you a " + K.rank() + (c.beltBox ? ", and that belt is yours." : "."), 4.2);
  }
  // ---- the bookmaker: the card on the one bet slip ----
  function askBet() {
    const b = BOUT, who = V.bookie;
    if (!CBZ.betSlip) return;
    if (!b || b.kind !== "card" || b.over || b.phase === "clear") { say(who, b && b.kind === "player" ? "No book on that one. Go and fight." : "Nothing in the ring yet. Next bout's coming.", 3); return; }
    const red = b.red, blue = b.blue;
    const lastRound = function () { return b.round >= RULES.ROUNDS; };
    if (b.bet) { say(who, "You're down already: " + fmt(b.bet.stake) + " on " + b.bet.label + ".", 3); return; }
    if (lastRound()) { say(who, "Book's closed on this one. Money goes down before the last round.", 3.2); return; }
    say(who, red.name + " at " + b.oddsRed.toFixed(2) + ", " + blue.name + " at " + b.oddsBlue.toFixed(2) + ". Mark your slip.", 3.4);
    CBZ.betSlip.open({
      key: "southpaw", title: "Southpaw Palace bookmaker", sub: "Boxing, bout #" + b.id + (b.round > 1 ? ", after round " + (b.round - 1) : ", three rounds"),
      min: 25, max: 5000, step: 25, stake: 50,
      picks: [{ id: "red", label: red.name, odds: b.oddsRed, sub: "red" }, { id: "blue", label: blue.name, odds: b.oddsBlue, sub: "blue" }],
      onPlace: function (p, stake, odds) {
        if (BOUT !== b || b.over || lastRound()) {
          if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(stake);
          say(who, "Too late. Book's closed on that one. Here's your money.", 3); return;
        }
        if (odds !== (p.id === "red" ? b.oddsRed : b.oddsBlue)) {      // a bell rang while you held the slip
          if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(stake);
          say(who, "That price is gone. Here's your money. Ask me again.", 3); return;
        }
        b.bet = { side: p.id, stake: stake, odds: odds, label: p.label };
        say(who, "You're on. " + p.label + " it is.", 2.6);
      },
    });
  }
  // ---- the cutman: your corner, between rounds ----
  function cornerNow() { return !!(BOUT && BOUT.kind === "player" && BOUT.phase === "rest" && !BOUT.over); }
  // he comes in to the foot of your corner for the minute, and goes back to his bucket
  const CUT_POST = [-6.0, -3.2], CUT_CORNER = [-5.35, -2.7];
  function cutmanUp(b) {
    const ped = V.cutman && V.cutman.ped;
    if (!ped || ped.dead) return;
    V.cutSpot = CUT_CORNER;
    // he reads you (and the judges), and says it
    const P = CBZ.player, VT = CBZ.vitals, daze = VT && VT.daze ? VT.daze(P) : 0;
    const hpF = P.hp / (P.maxHp || 200), st = P.stamina == null ? 100 : P.stamina;
    let lost = 0;
    for (let j = 0; j < 3; j++) { const c = b.cards[j][b.cards[j].length - 1]; if (c && c[0] < c[1]) lost++; }
    let line = lost >= 2 ? "You gave that one away. Let your hands go." : "Good round. Keep working behind the jab.";
    if (daze > 0.4) line = "You're seeing stars. Let me get ice on that.";
    else if (hpF < 0.45) line = "You're taking too many. Hands up, move your head.";
    else if (st < 40) line = "You're blowing. Breathe.";
    say(ped, line + (b.red.cutLeft > 0 ? "" : " I'm out of tricks."), 3.6, 20);
  }
  function cutmanDown() { if (V) V.cutSpot = CUT_POST; }
  function driveCutman(dt) {
    const ped = V.cutman && V.cutman.ped, sp = V.cutSpot;
    if (!ped || ped.dead || !sp || !calm(ped)) return;
    const w = W(sp[0], sp[1]);
    if (stepTo(ped, V.cutSt, w.x, w.z, dt, 0.45)) {
      faceTo(ped, Math.PI / 2, 0.2);                       // toward the ring
      if (sp === CUT_POST) V.cutSpot = null;               // home: his post holds him again
    }
    ped.group.position.x = ped.pos.x; ped.group.position.z = ped.pos.z;
    if (ped.staffPost) { ped.staffPost.x = ped.pos.x; ped.staffPost.z = ped.pos.z; ped.staffPost.face = ped.group.rotation.y; }
  }
  function cutBuy(kind) {
    const b = BOUT, who = V.cutman;
    if (!cornerNow()) return;
    const me = b.red, cost = CUT[kind], P = CBZ.player, VT = CBZ.vitals, Vb = VB();
    if (me.cutLeft <= 0) { say(who, "That's all I got. Keep your hands up.", 2.8); return; }
    if (!C.wallet.spend(cost)) { say(who, "That's " + fmt(cost) + ". You're short.", 2.6); return; }
    me.cutLeft--;
    if (kind === "ice") {
      // the swelling and the fog: the head's own number (systems/vitals.js)
      const Rv = VT && VT.of ? VT.of(P) : null;
      if (Rv) Rv.daze = Math.max(0, Rv.daze - 0.45);
      const c = Vb && Vb.condition ? Vb.condition(playerActor()) : null;
      if (c) c.daze = Math.max(0, c.daze - 0.45);
      say(who, "Hold still. That'll keep the eye open.", 2.8);
    } else if (kind === "air") {
      P.stamina = Math.min(100, (P.stamina == null ? 100 : P.stamina) + 60);
      const c = Vb && Vb.condition ? Vb.condition(playerActor()) : null;
      if (c) c.wind = 0;
      say(who, "Deep ones. In. Out. There's your legs back.", 2.8);
    } else {
      const mx = P.maxHp || 200;
      P.hp = Math.min(mx, P.hp + mx * 0.2);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      say(who, "One shot. You'll feel it in ten seconds.", 2.8);
    }
  }
  let cutLine = 0;
  function cutmanTalk() {
    const L = mineNow() ? ["Hands up. Chin down. Go.", "I'll be on the apron when the bell goes."]
      : ["Get a fight off the promoter and I'm in your corner.", "One round at a time.", "Your nose has been broke before. I can tell."];
    say(V.cutman, L[cutLine++ % L.length], 3);
  }
  function mineNow() { return !!(BOUT && BOUT.kind === "player"); }
  function answerBell() {
    const b = BOUT;
    if (!cornerNow()) return;
    say(V.cutman, "Go get him.", 1.8);
    b.t = 0;
  }
  function towel() {
    const b = BOUT;
    if (!cornerNow()) return;
    say(V.cutman, "That's it. I'm stopping it.", 2.6);
    refSay("The corner has thrown in the towel!", 2.8);
    finish(b.blue, "RTD");
  }

  function giveCastVerbs() {
    const I = CBZ.interactions;
    if (!V || !I || !I.registerFor) return;
    const give = function (h, tag, rows) {
      const p = pedOf(h);
      if (!p || p._boxVerbs) return;
      p._boxVerbs = true;
      rows.forEach(function (r, i) {
        I.registerFor(p, { id: "boxing-" + tag + "-" + r.id, prio: 96 - i, slot: r.slot, forceYes: true, campaignSafe: true, wheel: !!r.wheel, bad: !!r.bad,
          label: function () { return asIs(typeof r.label === "function" ? r.label() : r.label); },
          canShow: function () { return calm(p) && r.show(); },
          onSelect: r.run });
      });
    };
    const mine = mineNow;
    give(V.promoter, "promoter", [
      { id: "take", label: function () { return "Take the fight, " + fmt(OFFER ? OFFER.purse : 0); }, show: function () { return !!OFFER; }, run: takeFight },
      { id: "pass", label: "Not tonight", show: function () { return !!OFFER; }, run: passFight },
      { id: "ask", label: "Ask about a fight", show: function () { return !OFFER && !mine(); }, run: askFight },
      { id: "off", label: "Call it off", show: function () { return mine() && BOUT.phase === "wait"; }, run: callOff },
      { id: "record", label: "Ask about your record", show: function () { return !OFFER && !mine(); }, run: tellRecord },
    ]);
    give(V.bookie, "bookie", [
      { id: "bet", label: "Bet on the undercard", show: function () { return !(CBZ.betSlip && CBZ.betSlip.isOpen && CBZ.betSlip.isOpen()); }, run: askBet },
    ]);
    give(V.cutman, "cutman", [
      { id: "bell", label: "Answer the bell", slot: "e", show: cornerNow, run: answerBell },
      { id: "ice", label: function () { return "Ice, " + fmt(CUT.ice); }, show: function () { return cornerNow() && BOUT.red.cutLeft > 0; }, run: function () { cutBuy("ice"); } },
      { id: "air", label: function () { return "Oxygen, " + fmt(CUT.air); }, show: function () { return cornerNow() && BOUT.red.cutLeft > 0; }, run: function () { cutBuy("air"); } },
      { id: "pep", label: function () { return "Adrenaline, " + fmt(CUT.pep); }, show: function () { return cornerNow() && BOUT.red.cutLeft > 0; }, run: function () { cutBuy("pep"); } },
      { id: "towel", label: "Throw in the towel", wheel: true, bad: true, show: cornerNow, run: towel },
      { id: "talk", label: "Talk", slot: "e", show: function () { return !cornerNow(); }, run: cutmanTalk },
    ]);
  }

  /* ==========================================================
     7. THE BOARD: the judges' cards, standing behind their table
     ========================================================== */
  function drawCards() {
    if (!V || !V.card) return;
    const b = BOUT;
    // a picture of the facts NOW (the board is painted when it is next seen)
    V.cardData = b ? { red: b.red.player ? "YOU" : b.red.name, blue: b.blue.name, cards: b.cards.map(function (c) { return c.map(function (r) { return [r[0], r[1]]; }); }),
      tot: cardTotals(b), over: b.over, winner: b.winner, method: b.method, round: b.round } : null;
    const rec = V.card;
    if (rec.paintWith) rec.paintWith(paintCards); else { paintCards(); rec.paint(); }
  }
  function paintCards() {
    const rec = V.card, cc = rec.cc, w = rec.w, h = rec.h, d = V.cardData;
    cc.textBaseline = "alphabetic";
    cc.clearRect(0, 0, w, h); cc.fillStyle = "#0c0f16"; cc.fillRect(0, 0, w, h);
    cc.strokeStyle = "#e8b64c"; cc.lineWidth = 6; cc.strokeRect(8, 8, w - 16, h - 16);
    cc.fillStyle = "rgba(232,182,76,.16)"; cc.fillRect(8, 8, w - 16, 58);
    cc.fillStyle = "#e8b64c"; cc.font = "bold 36px Arial"; cc.textAlign = "center";
    cc.fillText("JUDGES' SCORECARDS", w / 2, 50);
    if (!d) { cc.fillStyle = "#8a929c"; cc.font = "bold 44px Arial"; cc.fillText("FIGHT NIGHT", w / 2, h / 2 + 30); return; }
    const fit = function (s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "." : s; };
    cc.font = "bold 26px Arial";
    cc.textAlign = "left"; cc.fillStyle = "#ff8f8f"; cc.fillText(fit(d.red, 22), 30, 104);
    cc.textAlign = "right"; cc.fillStyle = "#8fc0ff"; cc.fillText(fit(d.blue, 22), w - 30, 104);
    const X = [250, 370, 490], XT = w - 40;
    cc.font = "bold 20px Arial"; cc.fillStyle = "#8a929c"; cc.textAlign = "center";
    for (let r = 0; r < RULES.ROUNDS && r < 3; r++) cc.fillText("R" + (r + 1), X[r], 140);
    cc.textAlign = "right"; cc.fillText("TOTAL", XT, 140);
    for (let j = 0; j < 3; j++) {
      const y = 186 + j * 48;
      cc.textAlign = "left"; cc.fillStyle = "#8a929c"; cc.font = "bold 24px Arial"; cc.fillText("JUDGE " + (j + 1), 30, y);
      cc.textAlign = "center"; cc.fillStyle = "#fff6e2"; cc.font = "bold 30px Arial";
      for (let r = 0; r < d.cards[j].length && r < 3; r++) cc.fillText(d.cards[j][r][0] + "-" + d.cards[j][r][1], X[r], y);
      if (d.cards[j].length) { cc.textAlign = "right"; cc.fillStyle = "#e8b64c"; cc.font = "bold 34px Arial"; cc.fillText(d.tot[j][0] + "-" + d.tot[j][1], XT, y + 2); }
    }
    cc.textAlign = "center"; cc.font = "bold 30px Arial";
    if (d.over) {
      cc.fillStyle = d.winner === "red" ? "#ff8f8f" : d.winner === "blue" ? "#8fc0ff" : "#fff6e2";
      cc.fillText(d.winner === "draw" ? "DRAW" : "WINNER: " + fit(d.winner === "red" ? d.red : d.blue, 20) + "  (" + d.method + ")", w / 2, h - 28);
    } else { cc.fillStyle = "#8a929c"; cc.fillText("ROUND " + d.round + " OF " + RULES.ROUNDS, w / 2, h - 28); }
  }
  // the plaque on the belt case, read as a card you hold (city/paper.js)
  function readPlaque() {
    const K = RING().career, c = K.state(), opp = K.booked();
    if (!CBZ.cityPaper) return;
    CBZ.cityPaper.show({
      key: "boxbelt", org: "SOUTHPAW PALACE", title: "BOXING CHAMPIONSHIP", ink: "#6e1524",
      lines: [
        { k: "HOLDER", v: c.beltBox ? "You" + (c.defenses ? ", " + c.defenses + " defended" : "") : "Vacant" },
        { k: "YOUR RECORD", v: c.wins + " - " + c.losses + "  (" + c.kos + " KO)" },
        { k: "RANKED", v: K.rank() },
        { k: "NEXT ON THE CARD", v: opp.name },
      ],
      foot: (K.title() ? "Your next bout is for this belt." : "Five straight wins earns a title bout.") + " Ask the promoter at the ring steps.",
    });
  }

  /* ==========================================================
     8. BUILD: what stands round the arena's ring (the ring is not ours)
     ========================================================== */
  function build(ctx, venue) {
    C = ctx;
    const R = RING(), g = venue.group;
    BOUT = null; OFFER = null; gapT = 3;          // a new world: nobody from the old one is in this ring
    R.event = null;
    g.position.y = R.deck;                        // everything here stands on the arena floor
    V = { origin: venue.origin, fA: null, fB: null, ref: null, judges: [], bookie: null, cutman: null, promoter: null,
      card: null, cardData: null, belt: null, beltLid: null, beltOpen: 0, pending: [], _venue: venue,
      bellAt: null, bellMesh: null, bellT: 0, cutSpot: null, cutSt: { stepT: 0 }, blueName: null, refMoving: false, stepT: 0 };
    try { localStorage.removeItem("cbzPkg:boxing"); } catch (e) { /* the old private belt and record: the arena's career is the one now */ }

    const AP = R.apron;                           // 4.8: the apron's half width
    const K = CBZ.storeFixtureKit, k = K ? K.create() : null;
    const TZ = -(AP + 1.7);                       // the judges' table, north of the ring
    const BZ = TZ - 1.25, BY = 2.5;               // the scorecard board behind it
    const bx = -3.0, bz = AP + 1.7;               // the belt, west of the ring steps
    const wx = AP + 2.2, wz = -1.9;               // the bookmaker, east

    if (k) {
      /* judges' and timekeeper's table: authored along z and turned to run
         along the ring's north side, the three chairs behind it */
      k.frame(0, 0, 0, -Math.PI / 2);
      const jx0 = TZ;
      k.box(jx0, 0.74, 0, 0.9, 0.04, 5.2, 0x24262c, "gloss");
      k.box(jx0 + 0.44, 0.38, 0, 0.02, 0.72, 5.2, 0x0e0f12);                          // front drape
      for (const e of [-1, 1]) k.box(jx0, 0.38, e * 2.59, 0.9, 0.72, 0.02, 0x0e0f12);
      k.box(jx0 + 0.452, 0.66, 0, 0.004, 0.06, 5.2, 0xb81f2c);
      for (let i = 0; i < 3; i++) {
        const z = (i - 1) * 1.7, cxh = jx0 - 0.75;
        for (const dx of [-0.2, 0.2]) for (const dz of [-0.2, 0.2]) k.cyl(cxh + dx, 0.23, z + dz, 0.012, 0.012, 0.46, 0x2a2d33, "metal", 0, 0, 0, 6);
        k.box(cxh, 0.48, z, 0.46, 0.05, 0.46, 0x1a1c22, "gloss");
        k.box(cxh - 0.22, 0.78, z, 0.04, 0.5, 0.44, 0x1a1c22, "gloss");
        k.box(jx0 + 0.1, 0.765, z, 0.22, 0.008, 0.3, 0xf4f2ea);                      // a judge's scorepad and pen
        k.cyl(jx0 + 0.1, 0.772, z + 0.18, 0.004, 0.004, 0.14, 0x1a1c22, "solid", Math.PI / 2, 0, 0, 6);
      }
      // the bell's wooden mount and its hammer (the bell itself is live: it shakes when struck)
      k.box(jx0 + 0.15, 0.78, 2.2, 0.2, 0.04, 0.26, 0x4a2e1c, "gloss");
      k.box(jx0 + 0.15, 0.93, 2.2, 0.04, 0.3, 0.04, 0x4a2e1c, "gloss");
      k.cyl(jx0 + 0.1, 0.78, 2.0, 0.008, 0.008, 0.22, 0x4a2e1c, "solid", Math.PI / 2, 0, 0, 6);
      k.sphere(jx0 + 0.1, 0.78, 1.89, 0.016, 0xb0b6c0, "metal");
      k.frame(0, 0, 0, 0);

      // the scorecard board: on two posts behind the judges, over their heads
      // (from either corner the line to it clears the corner pads)
      for (const e of [-1, 1]) {
        k.cyl(e * 1.25, 0.95, BZ - 0.06, 0.035, 0.035, 1.9, 0x2a2d33, "metal", 0, 0, 0, 8);
        k.box(e * 1.25, 0.03, BZ - 0.06, 0.5, 0.06, 0.5, 0x2a2d33, "metal");
      }
      k.box(0, BY, BZ - 0.04, 2.72, 1.42, 0.05, 0x0e0f12, "solid");

      // belt case: walnut plinth with a lit cap, glass box (the live lid) over it
      k.box(bx, 0.55, bz, 1.4, 1.1, 1.0, 0x2a1a10, "gloss");
      k.box(bx, 1.12, bz, 1.46, 0.04, 1.06, 0xc9a24a, "metal");
      k.box(bx, 1.15, bz, 1.3, 0.02, 0.9, 0x0e0f12, "solid");
      k.box(bx, 0.05, bz, 1.44, 0.1, 1.04, 0x0e0c0a);
      k.box(bx, 0.7, bz + 0.505, 0.8, 0.12, 0.004, 0xe8b64c, "metal");                // the brass plaque
      // the bookmaker's kiosk: framed booth, counter, grille, odds board
      k.box(wx + 0.1, 1.2, wz, 1.4, 2.4, 3.0, 0x16181d, "gloss");
      k.box(wx - 0.62, 0.55, wz, 0.08, 1.1, 3.0, 0x6e1524, "gloss");                   // the counter front
      k.box(wx - 0.72, 1.12, wz, 0.36, 0.05, 3.1, 0x2a1a10, "gloss");                  // counter top
      for (let i = 0; i <= 12; i++) k.cyl(wx - 0.62, 1.62, wz - 1.45 + i * (2.9 / 12), 0.008, 0.008, 0.95, 0xc9a24a, "metal", 0, 0, 0, 6);
      k.box(wx - 0.62, 2.11, wz, 0.05, 0.04, 3.0, 0xc9a24a, "metal");
      k.box(wx - 0.62, 1.16, wz, 0.05, 0.04, 3.0, 0xc9a24a, "metal");
      k.box(wx - 0.75, 2.55, wz, 0.1, 0.5, 2.0, 0x0b0f16, "gloss");
      k.build(g);
    }
    // colliders (world heights): the table, the board's foot, the belt case, the kiosk
    ctx.solid(-2.7, TZ - 0.5, 2.7, TZ + 0.5, R.deck, R.deck + 0.95);
    for (const e of [-1, 1]) ctx.solid(e * 1.25 - 0.25, BZ - 0.31, e * 1.25 + 0.25, BZ + 0.19, R.deck, R.deck + 1.9);
    ctx.solid(bx - 0.75, bz - 0.6, bx + 0.75, bz + 0.6, R.deck, R.deck + 1.4);
    ctx.solid(wx - 0.8, wz - 1.55, wx + 0.8, wz + 1.55, R.deck, R.deck + 2.4);

    // ---- THE BELL: brass, on its mount at the table's west end; struck, it shakes ----
    const bell = ctx.cyl(g, -2.2, 1.02, TZ + 0.15, 0.11, 0.11, 0.05, ctx.pmat(0xd8a832, 90), 20);
    bell.rotation.x = Math.PI / 2;
    V.bellMesh = bell; V.bellHome = bell.position.clone();
    V.bellAt = { x: venue.origin.x - 2.2, z: venue.origin.z + TZ + 0.15 };

    // ---- THE SCORECARD BOARD (a live board: painted only when the cards change) ----
    V.card = ctx.canvasTexLive(768, 384);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshBasicMaterial({ map: V.card.tex }));
    board.position.set(0, BY, BZ - 0.01);         // faces the ring (+z)
    g.add(board);
    drawCards();

    // ---- THE BELT: black leather, the gold centre plate and four side plates ----
    const belt = new THREE.Group(); belt.position.set(bx, 1.2, bz); g.add(belt);
    const gold = ctx.pmat(0xe0b040, 80);
    ctx.box(belt, 0, 0, 0, 1.0, 0.012, 0.1, ctx.pmat(0x111114, 20));
    const plate = ctx.cyl(belt, 0, 0.012, 0, 0.13, 0.13, 0.014, gold, 24); plate.scale.set(1.25, 1, 1);
    ctx.cyl(belt, 0, 0.022, 0, 0.08, 0.09, 0.008, ctx.pmat(0xb81f2c, 40), 20);
    ctx.cyl(belt, 0, 0.028, 0, 0.045, 0.045, 0.006, gold, 16);
    for (const e of [-1, 1]) for (const f of [1, 2]) ctx.box(belt, e * (0.12 + f * 0.11), 0.01, 0, 0.09, 0.012, 0.085, gold);
    V.belt = belt; V.beltHome = 1.2;
    // the glass lid lifts while the belt is yours
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 0.9),
      new THREE.MeshPhongMaterial({ color: 0xdcecf2, specular: 0xffffff, transparent: true, opacity: 0.16, shininess: 120, depthWrite: false }));
    lid.position.set(bx, 1.52, bz); lid.renderOrder = 1; g.add(lid); V.beltLid = lid; V.beltLidHome = 1.52;

    // ---- the bookmaker's sign ----
    const neonTex = ctx.canvasTex(512, 128, (cc, w, h) => { cc.fillStyle = "#0b0f16"; cc.fillRect(0, 0, w, h);
      cc.shadowColor = "#35e0ff"; cc.shadowBlur = 18; cc.strokeStyle = "#35e0ff"; cc.lineWidth = 4; cc.strokeRect(10, 10, w - 20, h - 20);
      cc.fillStyle = "#c8f6ff"; cc.font = "900 56px 'Arial Black', Arial"; cc.textAlign = "center"; cc.textBaseline = "middle"; cc.fillText("BOOKMAKER", w / 2, h / 2 + 2); });
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.47), new THREE.MeshBasicMaterial({ map: neonTex }));
    neon.position.set(wx - 0.81, 2.55, wz); neon.rotation.y = -Math.PI / 2; g.add(neon);

    ctx.light(bx, 2.4, bz, 0xffd77a, 0.7, 6);               // the belt case's own glow

    // ---- CAST: real city peds (deferred: they need the live arena) ----
    // RED and BLUE are the house's two corners; who boxes out of them changes bout to bout.
    queue({ role: "boxer", name: "Red Corner", outfit: 0xb81f2c, skin: 0xc98d5f,
      at: CORNER.red, face: Math.PI / 4, post: "pinned", pose: "stand" }, "fA", R.y);
    queue({ role: "boxer", name: "Blue Corner", outfit: 0x1f3fae, skin: 0x8a5c3a,
      at: CORNER.blue, face: -3 * Math.PI / 4, post: "pinned", pose: "stand" }, "fB", R.y);
    queue({ role: "referee", name: "Ray Okafor", outfit: 0xdedede, skin: 0xd8a878,
      at: REF_HOME, face: 3 * Math.PI / 4, post: "pinned", pose: "stand",
      dialogue: ["Protect yourself at all times.", "I stop it when I stop it."] }, "ref", R.y);
    for (let i = 0; i < 3; i++) queue({ role: "judge", name: ["Judge Halloran", "Judge Petrov", "Judge Amara"][i], outfit: 0x1c2230,
      at: [-(i - 1) * 1.7, TZ - 0.75], face: 0, post: "pinned", pose: "sit", seatRef: { cushion: 0.505, floorBelow: 0 },
      dialogue: ["I score what I see.", "Don't look at me. Look at him."] }, "judge", R.deck);
    queue({ role: "bookmaker", name: "Lou Sabella", outfit: 0x6e1524, skin: 0xcaa06e,
      at: [wx - 1.25, wz], face: -Math.PI / 2, post: "pinned", pose: "stand" }, "bookie", R.deck);
    queue({ role: "cutman", name: "Doc Paredes", outfit: 0xe4e4e4, skin: 0x9c6b41,
      at: CUT_POST, face: Math.PI / 2, post: "pinned", pose: "stand" }, "cutman", R.deck);
    queue({ role: "promoter", name: "Mickey Dunne", outfit: 0x2a2f3a, skin: 0xb98a62,
      at: [2.5, AP + 2.1], face: 0.2, post: "pinned", pose: "stand" }, "promoter", R.deck);

    // the belt: its plaque is a card you can read
    ctx.zone({
      id: "belt", name: "The belt", note: () => (RING().career.state().beltBox ? "Yours" : "Southpaw Palace boxing title"),
      pos: [bx, bz + 1.2], at: [bx, bz], y: 1.3, r: 1.7,
      verbs: [{ id: "plaque", label: "Read the plaque", slot: "e", onSelect: readPlaque }],
    });
  }

  /* deferred cast (the arena's root and peds land after the order-88 build) */
  function queue(spec, tag, y) { if (V && V.pending) V.pending.push({ spec: spec, tag: tag, y: y }); }
  function arenaLive() { return !!(CBZ.city && CBZ.city.arena && CBZ.city.arena.root); }
  function drainCast() {
    if (!V || !V.pending) return;
    if (C.npc && !arenaLive()) return;
    const pend = V.pending; V.pending = null;        // null first: once only
    for (const item of pend) {
      const h = C.npc(item.spec);
      if (item.tag === "judge") V.judges.push(h); else V[item.tag] = h;
      // ctx.npc stands a ped at y 0: the arena floor is a deck, the canvas is above it
      if (h && h.ped) { h.ped.pos.y = item.y; h.ped.group.position.y = item.y; }
    }
    // a boxer boxes bare-chested in his corner's colour (the shared wardrobe paints it)
    trunks(V.fA, 0xcc2233, 0xbb2222); trunks(V.fB, 0x2244cc, 0x2233bb);
  }
  function trunks(h, col, boots) {
    const p = pedOf(h);
    if (!p || !p.char || !CBZ.cityRecolorRig) return;
    const skin = p.skin != null ? p.skin : 0xc08a5a;
    try { CBZ.cityRecolorRig(p.char, { legs: col, torso: skin, collar: skin, arms: skin, forearms: skin, shoes: boots }, null); p._castFit = null; } catch (e) { /* wardrobe absent */ }
  }

  /* ==========================================================
     9. UPDATE
     ========================================================== */
  function update(ctx, dt) {
    if (!V || (V._venue && ctx.venue !== V._venue)) return;
    if (V.pending && V.pending.length) drainCast();
    if (!dt || dt > 0.4) dt = 0.05;
    const P = CBZ.player, R = RING(), o = V.origin;
    if (!R || !P || !P.pos) return;

    // the belt case stands open while the belt is yours
    if (V.beltLid) {
      const t = R.career.state().beltBox ? 1 : 0;
      if (Math.abs(t - V.beltOpen) > 0.001) {
        V.beltOpen += (t - V.beltOpen) * (1 - Math.exp(-4 * dt));
        V.beltLid.position.y = V.beltLidHome + V.beltOpen * 1.1;
        V.belt.position.y = V.beltHome + V.beltOpen * 0.12;
      }
    }
    // the struck bell rings on its mount
    if (V.bellT > 0 && V.bellMesh) {
      V.bellT -= dt;
      const a = V.bellT > 0 ? Math.sin(V.bellT * 70) * 0.012 * Math.min(1, V.bellT * 2) : 0;
      V.bellMesh.position.x = V.bellHome.x + a; V.bellMesh.rotation.z = a * 6;
    }
    const d = Math.hypot(P.pos.x - o.x, P.pos.z - o.z);
    near = d < 150;                                  // any seat in the bowl can see the ring
    if (!near) {
      // across the map nothing boxes; a bout of yours you walked out on is lost in tickBout's own checks
      if (BOUT && BOUT.kind === "player") tickBout(dt);
      return;
    }
    verbT -= dt;
    if (verbT <= 0) { verbT = 0.5; giveCastVerbs(); }
    // an offer does not follow you out of the building
    if (OFFER) {
      const pr = pedOf(V.promoter);
      if (!pr || !calm(pr) || Math.hypot(P.pos.x - pr.pos.x, P.pos.z - pr.pos.z) > 14 || (CBZ.now || 0) - OFFER.t > 90000) OFFER = null;
    }
    if (BOUT) tickBout(dt);
    else if (castReady()) {
      // between bouts: the ring has to be empty of you before the next pair come out
      gapT -= dt;
      if (inRing(P.pos)) { clearT -= dt; if (clearT <= 0) { clearT = 9; refSay("Clear the ring, please.", 2.4); } gapT = Math.max(gapT, 2); }
      else if (gapT <= 0) startCard();
      // the stable waits in its corners
      const ra = V.fA.ped, rb = V.fB.ped;
      if (!BOUT) {
        if (!downOf(ra)) { ra.pos.y = R.y; ra.group.position.y = R.y; }
        if (!downOf(rb)) { rb.pos.y = R.y; rb.group.position.y = R.y; }
      }
    }
    driveRef(BOUT, dt);
    driveCutman(dt);
  }

  /* ==========================================================
     10. REGISTER (a site venue: the arena's ring is the anchor)
     ========================================================== */
  CBZ.games.register({
    id: "boxing",
    title: "SOUTHPAW PALACE",
    venue: {
      site: "southpaw",
      resolve(CBZ) {
        const A = (CBZ.city && CBZ.city.arena) || CBZ._settlementArena, R = CBZ.arenaRing;
        if (!A || !A.root || !A.regions || !R) return null;      // wait until the world can answer
        // the arena was built in THIS world (its landmass names its region)
        if (!A.regions.some((r) => r && /Ironjaw Arena/i.test(r.name || ""))) return null;
        return { x: R.x, z: R.z };
      },
    },
    build(ctx, venue) { build(ctx, venue); },
    update(ctx, dt) { update(ctx, dt); },

    /* probe surface: what a tool may read, and the few things it may turn */
    api: {
      rules: RULES, tenPointMust, oddsFromProb,
      near: () => near,
      live: () => (BOUT ? { kind: BOUT.kind, phase: BOUT.phase, round: BOUT.round, clock: BOUT.clock, over: BOUT.over, winner: BOUT.winner, method: BOUT.method,
        red: BOUT.red.name, blue: BOUT.blue.name, cards: BOUT.cards, count: BOUT.count ? BOUT.count.n : 0, bet: BOUT.bet,
        kd: [BOUT.red.kdBout, BOUT.blue.kdBout], pts: [BOUT.red.pts, BOUT.blue.pts], landed: [BOUT.red.landed, BOUT.blue.landed], legs: [BOUT.red.legs, BOUT.blue.legs], caught: BOUT.caught || 0, fouls: BOUT.red.fouls,
        oppF: BOUT.blue.F ? { thrown: BOUT.blue.F.thrown, landed: BOUT.blue.F.landed, blocked: BOUT.blue.F.blocked, whiffs: BOUT.blue.F.whiffs, aggr: +(BOUT.blue.F.aggr || 0).toFixed(2), stam: +(BOUT.blue.F.stam || 0).toFixed(2), skill: BOUT.blue.skill } : null,
        oddsRed: BOUT.oddsRed, oddsBlue: BOUT.oddsBlue, purse: BOUT.purse } : null),
      offer: () => OFFER,
      cast: () => (V ? { fA: pedOf(V.fA), fB: pedOf(V.fB), ref: pedOf(V.ref), judges: V.judges.map(pedOf), bookie: pedOf(V.bookie), cutman: pedOf(V.cutman), promoter: pedOf(V.promoter) } : null),
      venue: () => V,
      bell: (n) => ringBell(n || 1),
    },
  });
})();
