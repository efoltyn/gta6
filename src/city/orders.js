/* ============================================================
   city/orders.js — TELL HIM TO DO IT TO HIM. The principal seat.

   OWNER (the delegation thesis): "interaction options are dumb BECAUSE THEY
   ARE ALL 1V1 ... I want to be able to tell someone to do something to
   someone else." This file is that one atom, for everybody who works for
   you: your crew, your hired security, the President's Secret Service and
   his staff, your dog.

   THE ORDER SITS ON THE MAN IT IS ABOUT (owner 2026-10-11: "ATTACK is dumb:
   you have to talk to a security guard and tell them to attack someone. I
   should be able to tell my security to attack someone with a button on the
   person I want attacked"). Look at anyone (or tap him) while you have
   people and his own verbs carry the orders about him:

     Detain     (I J K L) law hands only (agents, police, soldiers): two of
                them take him in (city/custody.js)
     Kill       everyone with you draws and opens fire on him, until he is
                down or you call it off
     Back off   whoever of yours is on him lets him be
     Beat him   your own crew only (never the state's men, never the
                President's): fists until he is down, then it is over
     Threaten   anyone: he answers by who he is (THREATEN below); on your own
                man who said no, the order again, backed by fear
     Escort out (wheel) the President's: two agents walk him off
     Tail       (wheel) your nearest free man follows him, then tells you where
   Plain words, no colour: an order is a decision, not a danger sign (the
   rows are not `bad`, so the card draws them like every other option;
   `harm` keeps them off the tap of E all the same).
   A man of yours who refused you is a man like any other: Detain and Kill
   are on him too, and the rest of them decide about one of their own.

   ONE ORDER PATH, DECIDED (2026-10-22, owner: "commands that are either
   followed or not, and occasionally that lead to coups and fight-backs").
   Every one of those is order({ by, verb, target }) below; who is with you
   is force(), and whether each man DOES it is systems/command.js's: the
   claim you have on him, what he thinks of you (relPlayer, or his
   institution's loyalty to the seat), what the order asks of him (an
   unarmed man in public, a child, one of his own), the danger. He obeys,
   says "Sir?" (give it again to push him), refuses, or turns on you. Enough
   of that and command calls a mutiny: your crew comes for you, the
   President's institutions climb the dissent ladder toward the coup. On your
   own man: Stand down, Hold here, Come; Dismiss and Clear room on the wheel.
   As a patched member of somebody's crew, YOUR BOSS orders you (bossOrders).

   Bodies: tail and a crewman's "go after" are CBZ.followerOrder's (boarding.js).
   Guard, and "go after" for an agent, run here through the shared seams:
   CBZ.cityBrain.exec.verb("attack", a, b), CBZ.protection.moveToward /
   release, CBZ.citySay. A detail agent under an order is skipped by
   protection.js's formation (ped._order) until the order ends.

   PUBLIC: CBZ.cityOrders2 = { give(agent, kind, target), clear(agent),
            worksForYou(ped), list() }
     (named apart from contracts.js's CBZ.cityOrders board)
   Your dog is one more body here: worksForYou(dog) is true for a tamed dog
   and give()/clear() hand it to city/dogs.js (CBZ.cityDogOrder), whose
   protector rules (city/dogbrain.js) are this file's guard rules.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.cityOrders2) return;
  const g = CBZ.game || (CBZ.game = {});
  // the worlds your orders reach: Gang City and the islands (CBZ.economyMode)
  function econ() { return !!(CBZ.economyMode && CBZ.economyMode()); }

  const GUARD_R = 1.8, TAIL_R = 9, RUN_R = 8;
  const LIVE = new Set();

  function hyp(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function presDetailId() {
    const Pz = CBZ.presidency;
    if (!Pz || typeof Pz.seat !== "function") return null;
    let s = null; try { s = Pz.seat(); } catch (e) { s = null; }
    return s ? "off_" + s.id : null;
  }
  // who takes orders from you: the people you pay, lead or are protected by
  function worksForYou(p) {
    if (!p || p.dead || p.player || p.vendor) return false;
    // THE PRESIDENT'S OWN GUNS: his detail, the Mansion's gate and roof and
    // wall walk, the motorcade's agents, the curfew's uniforms. One answer,
    // presidency.js's (it used to be his detail alone, so the officers at his
    // own gate offered him nothing at all).
    const Pz = CBZ.presidency;
    if (Pz && typeof Pz.serves === "function" && Pz.serves(p) === "security") return true;
    if (p.kind === "cop") return false;
    // YOUR DOG is a protector body in this same order system (city/dogs.js)
    if (p.kind === "dog") return !!p.tamed;
    if (p._iOnly && !p._protUnit) return false;      // a staffer is his job, not your muscle
    if (p.recruited || p.kind === "crew" || p.companion) return true;
    if (CBZ.cityPlayerGangIsMember && CBZ.cityPlayerGangIsMember(p)) return true;
    if (p._protUnit && CBZ.protection && CBZ.protection.get) {
      let d = null; try { d = CBZ.protection.get(p._protUnit); } catch (e) { d = null; }
      if (d && d.principal && d.principal.kind === "player") return true;
    }
    return false;
  }
  function say(p, line) { if (CBZ.citySay && p && p.group) { try { CBZ.citySay(p, line, null, 1.8); } catch (e) {} } }

  // ONE ENGINE. A job on somebody (rob / scare / tail / sic) is city/boarding.js's
  // follower engine (CBZ.followerOrder: the walk up, the words, the haul back,
  // the report). This file only adds what that engine has no body for: a
  // GUARD on a third person, and "go after" for a man the companion brain does
  // not drive (a Secret Service agent). Everything else is handed straight on.
  function give(a, kind, t, quiet) {
    // a dog takes the same orders through its own body (CBZ.cityDogOrder):
    // Attack / Guard / Hold / Follow / Stand down, some with no second person
    if (a && a.kind === "dog") return !!(CBZ.cityDogOrder && CBZ.cityDogOrder(a, kind, t));
    if (!a || a.dead || !t || t.dead || t === a) return false;
    if (kind === "tail" || (kind === "attack" && a.companion)) {
      const v = kind === "tail" ? "tail" : "sic";
      if (CBZ.followerOrder && CBZ.followerOrder(a, v, { target: t })) return true;
    }
    if (!a._order) a._orderWas = { companion: !!a.companion };
    a._order = { kind: kind, target: t, t: 0 };
    a.companion = false;
    LIVE.add(a);
    if (kind === "attack") {
      if (CBZ.cityBrain && CBZ.cityBrain.exec && CBZ.cityBrain.exec.verb) CBZ.cityBrain.exec.verb("attack", a, t);
      else { a.rage = t; a.state = "fight"; }
    }
    if (!quiet) say(a, kind === "attack" ? "On it." : "Got him.");
    return true;
  }
  function clear(a, done) {
    if (!a) return;
    if (a.kind === "dog") { if (CBZ.cityDogOrder) CBZ.cityDogOrder(a, "standdown"); return; }
    const w = a._orderWas;
    if (a._order && a._order.kind === "take" && CBZ.cityBrain && CBZ.cityBrain.unholster) { try { CBZ.cityBrain.unholster(a); } catch (e) {} }
    a._order = null; a._orderWas = null;
    LIVE.delete(a);
    if (a.dead) return;
    if (a.rage && done !== "keep") { a.rage = null; if (a.state === "fight") a.state = "idle"; }
    if (w) a.companion = w.companion;
    if (CBZ.protection && CBZ.protection.release) CBZ.protection.release(a);
  }
  // whoever is swinging at (or shooting) the man he guards
  function attackerOf(t) {
    const lists = [CBZ.cityPeds, CBZ.cityCops];
    for (let k = 0; k < lists.length; k++) {
      const L = lists[k]; if (!L) continue;
      for (let i = 0; i < L.length; i++) { const q = L[i]; if (q && !q.dead && q.rage === t) return q; }
    }
    return null;
  }
  function follow(a, t, keep, dt) {
    const d = hyp(a.pos.x, a.pos.z, t.pos.x, t.pos.z);
    if (d <= keep) {
      if (CBZ.protection && CBZ.protection.release) CBZ.protection.release(a);
      a.state = "idle"; a.speed = 0;
      if (a.group) a.group.rotation.y = Math.atan2(t.pos.x - a.pos.x, t.pos.z - a.pos.z);
      return;
    }
    if (CBZ.protection && CBZ.protection.moveToward) CBZ.protection.moveToward(a, t.pos.x, t.pos.z, d > RUN_R ? 5.0 : 2.4, dt);
  }
  if (CBZ.onUpdate) CBZ.onUpdate(36.4, function (dt) {
    if (!LIVE.size || !econ()) return;
    LIVE.forEach(function (a) {
      const o = a._order;
      if (!o || a.dead) { clear(a); return; }
      // a Mansion post went off shift with the compound behind you (its body
      // left the world): nothing is left to order
      if (a._protUnit === "mansion" && CBZ.cityPeds && CBZ.cityPeds.indexOf(a) < 0) { clear(a); return; }
      o.t += dt || 0;
      // HOLD HERE: he keeps the spot you gave him (back to it if pushed off)
      if (o.kind === "hold") { follow(a, o.spot, 0.7, dt); return; }
      const t = o.target;
      if (!t || t.dead) { if (o.kind === "attack" && !o.force) say(a, "Done."); clear(a); return; }
      if (o.kind === "detain") { detainStep(a, o, t, dt); return; }
      if (o.kind === "escort") { escortStep(a, o, t, dt); return; }
      if (o.kind === "attack" || o.kind === "take") {
        // TAKE HIM: hands until he is down, then it is over
        if (o.kind === "take" && downed(t)) { if (a.rage === t) { a.rage = null; if (a.state === "fight") a.state = "idle"; } clear(a); return; }
        if (a.rage !== t) { a.rage = t; a.state = "fight"; }
        return;
      }
      // a guard fights for his man, then goes back to him
      if (o.kind === "guard") {
        const foe = attackerOf(t);
        if (foe && foe !== a) { if (a.rage !== foe) { a.rage = foe; a.state = "fight"; } return; }
        if (a.rage) { a.rage = null; a.state = "idle"; }
      }
      follow(a, t, o.kind === "tail" ? TAIL_R : GUARD_R, dt);
    });
  });

  /* ================================================================
     YOUR FORCE: "Attack" on ANYONE.
     OWNER (2026-10-08): "the cool part when you have security is ordering
     them to attack literally anyone."

     Mark first. Look at the man (a citizen, a reporter, a protester, your own
     Chief of Staff, a General at the table, a cop, a gang kid) and hold E,
     or pick it on his wheel, or tap him: every agent of your detail, the
     soldiers and police standing near a seated President, and your own crew,
     hired guards and dog within 45 m take the order through one engine
     (give() above, CBZ.cityBrain.exec.verb).
       Attack         they draw and go for him
       Detain         the two nearest take him in (city/custody.js): the order
                      shouted, the cuffs (a runner is tackled), the pat-down,
                      walked by the arm to an SUV that pulls up, the door, and
                      the car drives off. He is a detainee from the cuffs on;
                      Stand down calls it off until then. Nobody shoots.
       Escort out     two agents walk up and he is walked off, away from you
       Stand down     (on an agent, or on the man) everyone holsters and
                      comes back to you
     The lead agent answers in one line ("Yes, sir.").

     WHO OBEYS. An agent whose loyalty to the service is under 30 refuses; a
     soldier refuses when the General is sour (president_staff loyalty < 35)
     or the army is turning (dissent stage >= 3); a policeman when the
     Commissioner is sour. A refusal is one line ("Sir, I can't.") and it
     feeds the dissent ladder (CBZ.dissent.bump).

     THE DRAW IS A REASON. Every body that takes the order is stamped
     ped._drawWhy = { why: "order", by: "president", target } and, when the
     armed-NPC intent layer is loaded, CBZ.npcDrawReason(ped, "order", target)
     is called (with null on Stand down). systems/actorweapons.js
     CBZ.gunDiscipline owns that hook and is the one "gun away" rule: the
     order keeps the gun out while it stands, Stand down holsters it there and
     then. (A man who had put it away for a fist fight gets it back first:
     CBZ.cityBrain.unholster.)

     WHAT IT COSTS when the man dies under the order: scandal and approval,
     the dissent ladder, a NEWS ONE story when he had a name or a post
     ("President's guards kill <name>") or anybody saw it, and the
     presidency bus hears "guards-kill". A cabinet officer or a staffer
     killed leaves his chair empty (presidency.js / president_staff.js read
     a dead body that way already).

     PUBLIC: CBZ.cityOrders2.order({ by, verb, target }), takeDown(target,
             mode) (the same call), standDown(), force(), forceOrder()
  ================================================================ */
  const PF = { target: null, mode: null, crew: [], billed: false, by: null, cache: null, cacheAt: -1 };
  function now() { return (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()) / 1000; }
  function presSeat() {
    const Pz = CBZ.presidency;
    if (!Pz || typeof Pz.seat !== "function") return null;
    try { return Pz.seat(); } catch (e) { return null; }
  }
  function presDetail() {
    const id = presDetailId();
    if (!id || !CBZ.protection || !CBZ.protection.get) return null;
    try { return CBZ.protection.get(id); } catch (e) { return null; }
  }
  function stateBody(q) {
    return !!(q && (q._protUnit === "mansion" || q._presPublic || q._occupySrc === "motorcade"));
  }
  const FORCE_R = 45;   // m: who is "with you"
  // everyone who would take the order right now: a seated President's detail
  // and the uniforms near him, then YOUR people (crew, hired guards, gang,
  // your dog) within FORCE_R. Cached for half a second; canShow reads it.
  function force() {
    const t = now();
    if (PF.cache && t - PF.cacheAt < 0.5) return PF.cache;
    const out = [], P = CBZ.player;
    const pres = !!presSeat();
    if (pres) {
      const d = presDetail();
      const refs = (d && d.memberPedRefs) || [];
      for (let i = 0; i < refs.length; i++) { const q = refs[i]; if (q && !q.dead && q.group && !q.restraint && !q._custodyJob) out.push(q); }
    }
    if (P && P.pos) {
      const lists = [CBZ.cityPeds, CBZ.cityCops, CBZ.cityDogs];
      for (let k = 0; k < lists.length; k++) {
        const L = lists[k]; if (!L) continue;
        for (let i = 0; i < L.length; i++) {
          const q = L[i];
          if (!q || q.dead || !q.pos || q.restraint || q._custodyJob || out.indexOf(q) >= 0) continue;
          if (q.kind !== "dog" && !q.group) continue;
          if (!((pres && stateBody(q)) || worksForYou(q))) continue;
          if (hyp(q.pos.x, q.pos.z, P.pos.x, P.pos.z) > FORCE_R) continue;
          out.push(q);
        }
      }
    }
    PF.cache = out; PF.cacheAt = t;
    return out;
  }
  // a body of the state (answers to the presidency's loyalties), not your own man
  function stateMan(q) {
    return !!(q && (stateBody(q) || (q._protUnit && q._protUnit === presDetailId()) || q.organization === "military" || q.kind === "cop"));
  }
  function soldier(q) { return q.organization === "military" || q.job === "soldier"; }
  function policeman(q) { return q.kind === "cop" || q.job === "police officer"; }
  function institution(q) { return soldier(q) ? "Army" : policeman(q) ? "Police" : "Secret Service"; }
  // the same institution by city/politics.js's key (INST_IDS)
  function instKey(q) { return soldier(q) ? "army" : policeman(q) ? "police" : "ss"; }
  // THE ONE POLITICAL MODEL (city/politics.js, when it is loaded) hears every
  // act and owns what it costs (approval, loyalty, the street). Returns true
  // when it took the act; without it, the costs below fall back to the
  // presidency's own numbers. Nothing here keeps a store of its own.
  function polAct(kind, t, q) {
    const PM = CBZ.politics;
    if (!PM || typeof PM.act !== "function") return false;
    try { PM.act(kind, { target: t || null, by: "president", ideology: (t && t.ideology) || null, institution: q ? instKey(q) : null }); return true; } catch (e) { return false; }
  }
  // one of their own: an agent told to kill an agent, a soldier a soldier
  function brother(q, t) { return !!(t && institution(q) === institution(t) && (stateBody(t) || t._protUnit || t._presOfficer || t.kind === "cop" || t.organization === "military")); }
  function PA() { return (CBZ.city && CBZ.city.playerActor) || CBZ.player; }
  function youAre(a) { return !!a && (a === CBZ.player || a.isPlayer || a === (CBZ.city && CBZ.city.playerActor)); }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* ---- WHO OBEYS IS DECIDED (systems/command.js). These are the city's
     answers to its questions: the claim you have on a man, what he thinks of
     you, who his own are, how his body carries the order out. ---- */
  // the institution's loyalty to the seat, 0..1 (the one political model
  // first; the staff's loyalty and the army ladder without it)
  function instLoyalty(q) {
    const PM = CBZ.politics;
    if (PM && typeof PM.instLoyalty === "function") {
      let L = null;
      try { L = PM.instLoyalty(instKey(q)); } catch (e) { L = null; }
      if (L != null && isFinite(L)) return clamp01(L / 100);
    }
    const S = CBZ.presidentStaff, D = CBZ.dissent;
    const sour = function (role) { try { return !!(S && S.vacant && !S.vacant(role) && S.loyalty && S.loyalty(role) < 35); } catch (e) { return false; } };
    if (soldier(q)) { let st = 0; try { st = D && D.stage ? D.stage() : 0; } catch (e) { st = 0; } return sour("general") || st >= 3 ? 0.2 : 0.72; }
    if (policeman(q)) return sour("police") ? 0.25 : 0.72;
    if (q.organizationLoyalty != null && isFinite(q.organizationLoyalty)) return clamp01(q.organizationLoyalty / 100);
    return 0.78;
  }
  // your own man (crew, a hired guard, the gang): he took the job, and then
  // what he thinks of you (city/social.js relPlayer)
  function relStanding(q) {
    const r = CBZ.cityRel ? CBZ.cityRel(q) : q.relPlayer;
    let s = 0.45;
    if (r) s += (r.loyalty || 0) / 100 * 0.45 + (r.respect || 0) / 100 * 0.2 + (r.fear || 0) / 100 * 0.15 - (r.grudge || 0) / 100 * 0.7;
    if (CBZ.cityPlayerGangIsMember && CBZ.cityPlayerGangIsMember(q)) s += 0.08;
    return clamp01(s);
  }
  function downed(t) {
    if (!t || t.dead) return true;
    if (t.restraint || (t.ko || 0) > 0 || (t.surrender && !t.rage)) return true;
    try { if (CBZ.vitals && CBZ.vitals.cuffable && CBZ.vitals.cuffable(t)) return true; } catch (e) {}
    return false;
  }
  function mark(q, kind, t) {
    if (!q._order) q._orderWas = { companion: !!q.companion };
    q._order = { kind: kind, target: t, t: 0 };
    q.companion = false;
    // OFF HIS POST. A detail agent posted at the office door is a staffPost
    // (peds.js roots a staffPost body like a vendor: no step, no fight, no
    // shot) and walks on the formation's moveOrder; both are his order's now.
    if (q._protIndoor || q.staffPost) { q._protIndoor = null; q.staffPost = null; }
    if (CBZ.protection && CBZ.protection.release) CBZ.protection.release(q);
    q.path = null; q.pause = 0; q._boardRun = false;
    LIVE.add(q);
    return true;
  }
  // HOLD HERE / COME: the follower engine for a man walking with you
  // (boarding.js "wait" / "follow"), the _order spot for everyone else
  function holdHere(a) {
    if (a.companion && CBZ.followerOrder && CBZ.followerOrder(a, "wait", {})) return true;
    if (!a._order) a._orderWas = { companion: !!a.companion };
    a._order = { kind: "hold", spot: { pos: { x: a.pos.x, y: a.pos.y, z: a.pos.z } }, t: 0 };
    a.companion = false; LIVE.add(a);
    return true;
  }
  function comeWithMe(a) {
    if (a._protUnit === "mansion") {
      // off his post and at the President's shoulder: the guard order
      // (follows him, fights whoever goes for him)
      if (a._order) clear(a);
      return give(a, "guard", PA(), true);
    }
    if (a._cbzWait && CBZ.followerOrder) CBZ.followerOrder(a, "follow", {});
    if (a._order) clear(a);
    if (CBZ.cityPlayerGangIsMember && CBZ.cityPlayerGangIsMember(a)) { a.companion = true; a.guard = null; a.rage = null; }
    else if (a.recruited || a.kind === "crew") a.companion = true;
    return true;
  }
  // THE BODY OF AN OBEYED ORDER, through the city's real seams
  function cityExec(q, o, t) {
    if (!q || q.dead) return false;
    switch (o) {
      case "kill": if (!t || t.dead) return false; drawFor(q, t); engage(q, t, "attack"); return true;
      case "take":
        // hands, not a gun: the piece goes on his belt until it is over
        if (!t || t.dead) return false;
        if (CBZ.cityBrain && CBZ.cityBrain.holster) { try { CBZ.cityBrain.holster(q); } catch (e) {} }
        engage(q, t, "take"); return true;
      case "detain": case "escort": return t ? mark(q, o, t) : false;
      case "back": if (q._cbzJob) { q._cbzJob = null; q._sicOn = null; q._boardRun = false; } clear(q); drawFor(q, null); return true;
      case "hold": return holdHere(q);
      case "come": return comeWithMe(q);
      case "guard": return give(q, "guard", t || PA(), true);
      default: return false;
    }
  }
  // HE TURNS: on you with his gun, or off the job and into the papers
  function turnOn(q, how) {
    if (!q || q.dead || q.kind === "dog") return false;
    const state = stateMan(q), pres = !!presSeat();
    if (q._protUnit) offDetail(q);
    if (CBZ.cityDismiss) { try { CBZ.cityDismiss(q, { nod: how === "fight" ? 0 : 1.1 }); } catch (e) {} }
    else { clear(q); q.companion = false; q.recruited = false; }
    q._turned = true;
    const P = PA();
    if (how === "fight" && P) {
      if (CBZ.cityBrain && CBZ.cityBrain.unholster) { try { CBZ.cityBrain.unholster(q); } catch (e) {} }
      q.rage = P; q.mem = P; q.state = "fight";
      q._drawWhy = { why: "order", by: "self", target: P };
      if (typeof CBZ.npcDrawReason === "function") { try { CBZ.npcDrawReason(q, "order", P); } catch (e) {} }
    }
    if (state && pres && CBZ.news && CBZ.news.push) {
      try {
        CBZ.news.push(how === "fight" ? institution(q) + " officer turns his gun on the President"
          : institution(q) + " officer walks off the President's detail", { cat: "SECURITY", phone: true });
      } catch (e) {}
    }
    return true;
  }
  if (CBZ.command && CBZ.command.use) CBZ.command.use("city", {
    authority: function (from, q) {
      if (!youAre(from)) return null;
      if (!q || q.dead || q.player || q._turned) return 0;
      if (q.kind === "dog") return q.tamed ? 1 : 0;
      if (presSeat() && (stateBody(q) || (q._protUnit && q._protUnit === presDetailId()))) return q.kind === "cop" ? 0.9 : 1;
      return worksForYou(q) ? 1 : 0;
    },
    standing: function (q, from) {
      if (!youAre(from)) return null;
      if (q.kind === "dog") return 0.9;
      return stateMan(q) && presSeat() ? instLoyalty(q) : relStanding(q);
    },
    law: function (q) { return stateMan(q); },
    kin: function (q, t) { return brother(q, t) || (!!t && !!q.gang && t.gang === q.gang); },
    notable: function (t) { return !!(t && (t._presOfficer || t._presStaff || t.organization === "state" || t._foreignLeader)); },
    lead: function (q) { return q._protRole === "shift-leader" ? 1 : q.rank === "lt" ? 0.8 : 0; },
    exec: function (q, o, t) { return cityExec(q, o, t); },
    turn: function (q, from, how) { return turnOn(q, how); },
    // pushing a man past "Sir?" or hearing his "No" costs what he thinks of you
    cost: function (q, from, kind, amount) {
      if (!youAre(from)) return;
      if (stateMan(q)) {
        // leaning on one of the state's men is felt by his service
        if (kind === "threat" && presSeat() && CBZ.politics && CBZ.politics.instNudge) { try { CBZ.politics.instNudge(instKey(q), -1); } catch (e) {} }
        return;
      }
      const r = CBZ.cityRel ? CBZ.cityRel(q) : null;
      if (!r) return;
      if (kind === "push") r.loyalty = Math.max(0, (r.loyalty || 0) - 3);
      else if (kind === "refuse") { r.loyalty = Math.max(0, (r.loyalty || 0) - 2); r.grudge = Math.min(100, (r.grudge || 0) + 2); }
      else if (kind === "threat" && CBZ.cityRelShift) { try { CBZ.cityRelShift(q, "intimidated", 0.6 + (amount || 0)); } catch (e) {} }
    },
  });
  /* MUTINY (command.js: the men under you have carried and refused enough of
     your orders and think little of you). The President's institutions hear
     it: the army line climbs toward the coup (city/dissent.js -> civilwar.js
     coup), and the man who leads it walks off the detail. Your own crew turns
     on you: the one the rest look to takes it, and they come for you. */
  if (CBZ.command && CBZ.command.on) CBZ.command.on("mutiny", function (m) {
    if (!m || m.game !== "city" || !youAre(m.from) || !econ()) return;
    const men = (m.men || []).filter(function (q) { return q && !q.dead && q.kind !== "dog"; });
    if (!men.length) return;
    const state = men.filter(stateMan), own = men.filter(function (q) { return !stateMan(q); });
    if (state.length && presSeat()) {
      if (CBZ.dissent && CBZ.dissent.bump) { try { CBZ.dissent.bump(2, 4, state.some(soldier) ? 14 : 7); } catch (e) {} }
      const L = state.indexOf(m.leader) >= 0 ? m.leader : state[0];
      if (CBZ.voice && CBZ.voice.say) CBZ.voice.say(L, "turn", { order: m.order, force: true });
      turnOn(L, "walk");
      const Pz = CBZ.presidency;
      if (Pz && Pz.emit) { try { Pz.emit("guards-mutiny", { n: state.length, institution: institution(L) }); } catch (e) {} }
    }
    if (own.length) {
      const L = own.indexOf(m.leader) >= 0 ? m.leader : own[0];
      if (CBZ.voice && CBZ.voice.say) CBZ.voice.say(L, "turn", { order: m.order, force: true });
      for (let i = 0; i < own.length; i++) {
        const q = own[i];
        const armed = q.armed || !!q._holster;
        turnOn(q, armed || q === L ? "fight" : "walk");
      }
    }
  });
  function drawFor(q, t) {
    if (q.kind === "dog") return;
    q._drawWhy = t ? { why: "order", by: PF.by || "player", target: t } : null;
    if (typeof CBZ.npcDrawReason === "function") { try { CBZ.npcDrawReason(q, t ? "order" : null, t || null); } catch (e) {} }
    const B = CBZ.cityBrain;
    if (B) {
      try {
        if (t && B.unholster) B.unholster(q);
      } catch (e) {}
    }
  }
  function able(q) { return !!q && !q.inCar && !q._cbzSeat && !q._cbzArc && q._protRole !== "counter-sniper"; }
  function faceYou(q, holster) {
    if (!q || q.dead || q.kind === "dog") return;
    const P = PA();
    if (P && P.pos && CBZ.cityPedFaceTo) { try { CBZ.cityPedFaceTo(q, P.pos.x, P.pos.z, 1.6); } catch (e) {} }
    if (holster) drawFor(q, null);
  }
  function lead(list) {
    for (let i = 0; i < list.length; i++) if (list[i] && list[i]._protRole === "shift-leader") return list[i];
    return list[0] || null;
  }
  /* THE ONE ORDER PATH: { by, verb, target }. `by` is who gives it (the
     local player today: "president" when he holds the seat, else "player");
     verb is kill | take | detain | escort | tail (attack = kill). The engine
     below picks who is with you (force()) and command.js decides who obeys,
     so the same record from a net player or an AI boss runs the same
     bodies. */
  function order(o) {
    let verb = (o && o.verb) || "kill";
    if (verb === "attack") verb = "kill";
    const t = o && o.target;
    if (!t || t.dead || t.player || t.isPlayer) return { ok: false, why: "" };
    if (verb === "tail") return tailOrder(t);
    return takeDown(t, verb);
  }
  // TAIL: the nearest free man of yours follows him (the follower engine's
  // tail: the walk, the distance, the report back)
  function tailOrder(t) {
    let best = null, bd = Infinity;
    const f = force();
    for (let i = 0; i < f.length; i++) {
      const q = f[i];
      if (q === t || q.kind === "dog" || q._order || q._cbzJob || stateMan(q) || q._carries) continue;
      const d = hyp(q.pos.x, q.pos.z, t.pos.x, t.pos.z);
      if (d < bd) { bd = d; best = q; }
    }
    if (!best) return { ok: false, why: "" };
    if (CBZ.command && CBZ.command.issue) {
      const r = CBZ.command.issue(PA(), best, "go", t, { game: "city", exec: function (q) { return give(q, "tail", t, true); } });
      return { ok: r.answer === "obey", n: r.obey.length, refused: r.refuse.length };
    }
    return { ok: give(best, "tail", t), n: 1, refused: 0 };
  }
  // the attack body for one man under a force order: straight onto the brain
  // (a companion is not sent through the follower "sic" run, whose job ends
  // on its own and would leave the order with nobody on it)
  function engage(q, t, kind) {
    if (q.kind === "dog") { give(q, "attack", t, true); return; }
    mark(q, kind || "attack", t);
    if (CBZ.cityBrain && CBZ.cityBrain.exec && CBZ.cityBrain.exec.verb) CBZ.cityBrain.exec.verb("attack", q, t);
    else { q.rage = t; q.state = "fight"; }
    // a man sent to shoot is not afraid of the man he is sent at, and has
    // rounds (the detail's own engage does the same: city/protection.js)
    q.fear = 0; q.surrender = false;
    if (kind !== "take" && q.armed && q.ammo != null && q.ammo < 8) q.ammo = 60;
  }
  // A MAN WHO SAID NO, sent at by the rest: he is off the detail / the post
  // before they go for him (protection.js would walk him back into the
  // formation), no longer yours to order, and a man on his own feet again.
  // off whatever detail he stood on (the Service sends a replacement in its
  // own time: protection.js THE SERVICE'S ROSTER)
  function offDetail(q) {
    const PR = CBZ.protection;
    if (!PR || !PR.details) return;
    let L = []; try { L = PR.details(); } catch (e) { L = []; }
    for (let i = 0; i < L.length; i++) {
      const d = L[i], k = d && d.memberPedRefs ? d.memberPedRefs.indexOf(q) : -1;
      if (k >= 0) { d.memberPedRefs.splice(k, 1); d.memberCount = Math.max(0, (d.memberCount | 0) - 1); }
    }
    if (PR.release) PR.release(q);
  }
  function cutLoose(q) {
    if (!q || q.dead) return;
    if (q._order) clear(q);
    offDetail(q);
    // the Mansion's post loop walks a posted body unless he is under an order:
    // this one is held by nobody's order and walked by no post again
    if (q._protUnit === "mansion") q._order = { kind: "loose", target: null, t: 0 };
    q._protUnit = null; q._protRole = null; q._protIndoor = null; q._protInbound = null;
    q.staffPost = null; q._iOnly = false; q.controlled = false; q.companion = false; q.recruited = false;
    q._turned = true;
  }
  // he said no (or "Sir?") to you, or turned: he can be the order's man
  function defiant(q) {
    if (!q || q.dead || q.kind === "dog") return false;
    if (q._turned) return true;
    const C = CBZ.command;
    return !!(C && C.pending && C.pending(q, PA()));
  }
  function takeDown(t, mode, pres) {
    mode = mode === "attack" ? "kill" : (mode || "kill");
    if (pres == null) pres = !!presSeat();
    if (!t || t.dead || t.player) return { ok: false, why: "" };
    if ((mode === "escort") && !pres) return { ok: false, why: "" };
    if (PF.target && PF.target !== t) standDown(true);
    // the men already on him stay on him; the order goes to the rest
    const already = PF.target === t ? PF.crew.filter(function (q) { return q && !q.dead && q._order && q._order.force; }) : [];
    let all = force().filter(function (q) { return q !== t && already.indexOf(q) < 0; });
    // detain and escort are law hands (the state's), never your crew's or a dog's
    if (mode === "detain" || mode === "escort") all = all.filter(stateMan);
    // a dog bites; a beating is your own crew's work, never an agent's or a
    // policeman's
    if (mode === "take") all = all.filter(function (q) { return q.kind !== "dog" && !stateMan(q); });
    if (!all.length && !already.length) return { ok: false, why: "" };
    // the aide with the football (q._carries, city/warroom.js) stays with the
    // case while anybody else can go; only when he is all you have does he set
    // it down and take the order (the gun discipline releases it on "order")
    const free = all.filter(function (q) { return !q._carries; });
    if (free.length) all = free;
    // HANDS THAT CAN ACT ON HIM: not a man in a seat of the motorcade (he
    // cannot shoot or walk from it), not a counter-sniper on a roof post
    // (sent, never moved: the man stood there with his hands up and nobody
    // came). The keys only show while there is one (wire: markable).
    all = all.filter(able);
    // a detention or an escort takes the two nearest pairs of hands
    let pool = all;
    if (mode === "detain" || mode === "escort") {
      pool = all.slice().sort(function (a, b) { return hyp(a.pos.x, a.pos.z, t.pos.x, t.pos.z) - hyp(b.pos.x, b.pos.z, t.pos.x, t.pos.z); }).slice(0, Math.max(0, 2 - already.length));
    }
    // a dog does as it is told; the men decide (systems/command.js)
    const crew = already.slice(), no = [];
    let hes = 0;
    const dogs = pool.filter(function (q) { return q.kind === "dog"; }), men = pool.filter(function (q) { return q.kind !== "dog"; });
    if (mode === "kill") for (let i = 0; i < dogs.length; i++) { engage(dogs[i], t); crew.push(dogs[i]); }
    if (men.length) {
      const C = CBZ.command;
      if (C && C.issue) {
        // an escort is a detention's hands without the cuffs
        const r = C.issue(PA(), men, mode === "escort" ? "detain" : mode, t, {
          game: "city", exec: mode === "escort" ? function (q) { return mark(q, "escort", t); } : null,
        });
        for (let i = 0; i < r.obey.length; i++) crew.push(r.obey[i]);
        for (let i = 0; i < r.refuse.length; i++) no.push(r.refuse[i]);
        for (let i = 0; i < r.turn.length; i++) no.push(r.turn[i]);
        hes = r.hesitate.length;
        // THE NO IS SEEN ON THE MAN WHO SAID IT: he turns to you and his gun
        // goes back on his belt (his word is over his head: command.js)
        for (let i = 0; i < r.refuse.length; i++) faceYou(r.refuse[i], true);
        for (let i = 0; i < r.hesitate.length; i++) faceYou(r.hesitate[i], false);
      } else for (let i = 0; i < men.length; i++) if (cityExec(men[i], mode, t)) crew.push(men[i]);
    }
    if (pres && no.some(stateMan) && CBZ.dissent && CBZ.dissent.bump) {
      try { CBZ.dissent.bump(0, 1, no.some(soldier) ? 3 : 1); } catch (e) {}
    }
    if (crew.length === already.length && !already.length) return { ok: false, why: "", hesitate: hes, refused: no.length };
    // one of your own, and the rest went for him: he is not yours any more
    if (crew.length > already.length && (worksForYou(t) || (pres && stateBody(t)))) cutLoose(t);
    // a detention is priced when the cuffs go on (custody fires the act, with
    // the witnesses who saw it), never at the word
    if (pres && mode !== "detain" && crew.length > already.length) polAct(mode === "escort" ? "escort" : "take-down", t, crew[0]);
    PF.target = t; PF.mode = mode; PF.crew = crew; PF.billed = false; PF.by = pres ? "president" : "player";
    for (let i = 0; i < crew.length; i++) if (crew[i]._order) crew[i]._order.force = true;
    if (mode === "detain" && !(CBZ.custody && CBZ.custody.jobOf && CBZ.custody.jobOf(t))) {
      // THE ONE ARREST PIPELINE (city/custody.js). The agents keep their
      // force order (protection.js leaves them be) until custody hands them back.
      const CU = CBZ.custody;
      const j = CU && CU.take ? CU.take(t, {
        by: crew.some(policeman) && !pres ? "police" : "ss", verb: "detain", officers: crew,
        owner: pres ? "president" : "player", act: pres, actBy: pres ? "president" : "player",
        // HELD, NOT SHIPPED: he stays with you, cuffed, until you choose
        // Jail / Search / Execute / Release on him (city/custody.js)
        hold: true,
        actOpts: { ideology: (t && t.ideology) || null, institution: instKey(crew[0]) },
        onCuffed: function () {
          if (CBZ.presidency && CBZ.presidency.emit) { try { CBZ.presidency.emit("guards-detain", { name: t.name || null }); } catch (e) {} }
        },
        onRelease: function (q) { if (q && q._order && q._order.force) clear(q); },
      }) : null;
      if (!j) { standDown(true); return { ok: false, why: "" }; }
    }
    const Pz = CBZ.presidency;
    if (pres && Pz && Pz.emit) { try { Pz.emit("guards-order", { mode: mode === "kill" ? "attack" : mode, name: t.name || null, n: crew.length, refused: no.length }); } catch (e) {} }
    return { ok: true, n: crew.length, refused: no.length, hesitate: hes };
  }
  // STAND DOWN ENDS THE INCIDENT, not just the order: the crew drops the
  // order and holsters (drawFor null -> CBZ.gunDiscipline), forgets the man,
  // and the detail's own alert / cover / evac and everything it heard during
  // the take-down is cleared (CBZ.protection.standDown). Without that last
  // step the detail stayed "under attack" off its own shots and re-drew on
  // "ward" the moment the order holstered them.
  function standDown(quiet) {
    const crew = PF.crew.slice(), t = PF.target;
    if (!quiet && t && PF.by === "president") polAct("stand-down", t, crew[0]);
    // before the cuffs the detention is off; after them he is in custody and
    // the car takes him (custody.cancel refuses a cuffed man)
    if (PF.mode === "detain" && t && CBZ.custody && CBZ.custody.cancel) { try { CBZ.custody.cancel(t); } catch (e) {} }
    const wasPres = PF.by === "president";
    PF.target = null; PF.mode = null; PF.crew = []; PF.by = null;
    for (let i = 0; i < crew.length; i++) {
      const q = crew[i];
      if (!q) continue;
      if (q._order && q._order.force && !q._custodyJob) clear(q);   // custody hands its own back
      if (q.dead) continue;
      if (t && q.mem === t) q.mem = null;
      if (t && q.rage === t && !q._custodyJob) { q.rage = null; if (q.state === "fight") q.state = "idle"; }
      q.alarmed = 0;
      drawFor(q, null);
    }
    // THE OTHER SIDE OF IT STOPS TOO. The man they went for (shot, still on
    // his feet) and anybody who took his part against the agents back off
    // instead of fighting on: left alone, the called-off target kept
    // shooting at the detail, the posture went straight back to evac
    // ("armed attacker") and every gun came out again. A rampage or a cell
    // is a real attacker and is left to the detail.
    const side = crew.concat(force());
    const backOff = function (p) {
      if (!p || p.dead || p.player || p.isPlayer || p.rampage || p.organization === "cell" || side.indexOf(p) >= 0) return;
      p.rage = null;
      if (p.state === "fight" || p.state === "confront") p.state = "walk";
      if (p.mem && side.indexOf(p.mem) >= 0) p.mem = null;
      p._cbThreatSrc = null;
      p.fear = Math.max(p.fear || 0, 5);
    };
    if (t && !t.dead) backOff(t);
    const P = CBZ.player, peds = CBZ.cityPeds || [];
    for (let i = 0; P && P.pos && i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || !p.pos || !p.rage || side.indexOf(p.rage) < 0) continue;
      if (hyp(p.pos.x, p.pos.z, P.pos.x, P.pos.z) > 80) continue;
      backOff(p);
    }
    if (wasPres && CBZ.protection && CBZ.protection.standDown) { try { CBZ.protection.standDown("president"); } catch (e) {} }
    return crew.length;
  }
  // a detention is city/custody.js's from the order on: it walks the agents,
  // and hands each back (onRelease -> clear) when the man is in the car
  function detainStep(a, o, t, dt) {
    const j = CBZ.custody && CBZ.custody.jobOf ? CBZ.custody.jobOf(t) : null;
    if (!j || a._custodyJob !== j.id) clear(a);
  }
  // two agents walk up; then he is walked off down the road, away from you
  function escortStep(a, o, t, dt) {
    const P = CBZ.player;
    const d = hyp(a.pos.x, a.pos.z, t.pos.x, t.pos.z);
    if (!t._escortedOut) {
      if (d > 1.8) { follow(a, t, 1.4, dt); return; }
      const ax = P && P.pos ? t.pos.x - P.pos.x : 1, az = P && P.pos ? t.pos.z - P.pos.z : 0, n = Math.hypot(ax, az) || 1;
      const gx = t.pos.x + ax / n * 28, gz = t.pos.z + az / n * 28;
      t.controlled = true; t.rage = null; t.staffPost = null; t._escortedOut = true;
      t.path = [{ x: gx, z: gz }]; t.finalGoal = { x: gx, z: gz };
      if (t.target && t.target.set) t.target.set(gx, 0, gz);
      t.state = "walk"; t.pause = 0;
      o.t = 0;
      if (CBZ.presidency && CBZ.presidency.emit) { try { CBZ.presidency.emit("guards-escort", { name: t.name || null, pubRole: t._pubRole || null }); } catch (e) {} }
    }
    if (o.t > 9 || d > 6) { if (!t._occupySrc && !t._post) t.controlled = false; clear(a); return; }
    follow(a, t, 1.2, dt);
  }
  // THE BILL, once per man, when he dies under the order (or is executed in
  // custody on it: custody.js calls billKill)
  function bill(t) {
    if (!t || t._ordBilled) return;
    t._ordBilled = true;
    if (PF.target === t) PF.billed = true;
    let seen = 0;
    const L = CBZ.cityPeds || [];
    for (let i = 0; i < L.length; i++) {
      const q = L[i];
      if (!q || q.dead || q === t || stateBody(q) || q._protUnit || !q.pos || !t.pos) continue;
      if (hyp(q.pos.x, q.pos.z, t.pos.x, t.pos.z) < 30) seen++;
    }
    const notable = !!(t._presOfficer || t._presStaff || t.organization === "state" || (t.nameKnown && t.name) || t._foreignLeader);
    const name = (t.nameKnown || t._presOfficer || t._presStaff) && t.name ? t.name : null;
    // the model owns the cost when it is loaded; else the presidency's numbers
    if (!polAct("kill", t, PF.crew[0])) {
      const h = presSeat();
      if (h && CBZ.approvalShock) { try { CBZ.approvalShock(h.id, notable ? -3 : (seen ? -1.5 : -0.5)); } catch (e) {} }
      const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null, pol = (w && w.politics) || g.cityPolitics;
      if (pol) pol.scandal = Math.min(100, (+pol.scandal || 0) + (notable ? 8 : seen ? 4 : 1));
      if (CBZ.dissent && CBZ.dissent.bump) { try { CBZ.dissent.bump(notable ? 5 : 2, notable ? 4 : 1, 0); } catch (e) {} }
    }
    if ((notable || seen) && CBZ.news && CBZ.news.push) {
      try {
        CBZ.news.push(name ? "President's guards kill " + name : "Secret Service kills a man in front of witnesses",
          { cat: "SECURITY", sub: seen ? seen + (seen === 1 ? " witness" : " witnesses") : "", phone: true });
      } catch (e) {}
    }
    const Pz = CBZ.presidency;
    if (Pz && Pz.emit) { try { Pz.emit("guards-kill", { name: t.name || null, notable: notable, witnesses: seen, role: t._presOfficer || t._presStaff || null }); } catch (e) {} }
  }
  // who "Clear room" walks out: anyone near you on your storey who is not
  // the state's (staff, agents, uniforms), not tied, not posted at a job
  function clearable() {
    const P = CBZ.player, out = [];
    if (!P || !P.pos || !presSeat()) return out;
    const L = CBZ.cityPeds || [];
    for (let i = 0; i < L.length; i++) {
      const t = L[i];
      if (!t || t.dead || !t.pos || t.player || t.restraint || t._iOnly || t._protUnit || stateBody(t) || t.organization === "state" || t.vendor) continue;
      if (Math.abs((t.pos.y || 0) - (P.pos.y || 0)) > 2.5) continue;
      if (hyp(t.pos.x, t.pos.z, P.pos.x, P.pos.z) > 10) continue;
      out.push(t);
    }
    return out;
  }
  // the order lives until he is down, tied, walked off or called off
  if (CBZ.onUpdate) CBZ.onUpdate(36.41, function () {
    const t = PF.target;
    if (!t) return;
    if (t.dead) { if (PF.mode !== "escort" && PF.by === "president") bill(t); standDown(true); return; }
    if (PF.by === "president" && !presSeat()) { standDown(true); return; }
    let busy = false;
    for (let i = 0; i < PF.crew.length; i++) { const q = PF.crew[i]; if (q && !q.dead && q._order && q._order.force) { busy = true; break; } }
    // a detention stands while custody has the job: the agents it handed
    // back (stuck, swapped for a unit's crew, the second pair of hands once
    // he is cuffed) do not call it off. This race cancelled a Detain before
    // the cuffs and left the man with nobody on him.
    if (!busy && PF.mode === "detain" && CBZ.custody && CBZ.custody.jobOf && CBZ.custody.jobOf(t)) busy = true;
    if (!busy) standDown(true);
  });

  // ---- THE ORDERS ON THE KEYS ------------------------------------------------
  // ON THE MAN THEY ARE ABOUT, while you have people with you who can carry
  // it out (`anyone` lets them through to a person who otherwise offers only
  // his job's verbs: a staffer, an agent, a General at the table): Detain
  // (law hands only), Kill, Back off, in that order on I J K, then Beat him
  // (your own crew, never the state's) and Threaten. Escort out and Tail are
  // on his wheel. On YOUR OWN man: Stand down, Hold here, Come; Dismiss and
  // Clear room on the wheel; and when he said no, Threaten, Detain, Kill.
  // Every one is an order (systems/command.js): the men decide, a "Sir?" is
  // pushed by giving it again, a "No" stays a no until you lean on him.
  function wire() {
    const I = CBZ.interactions;
    if (!I || !I.register) return false;
    const on = function (p) { return worksForYou(p); };
    // a man your people can be sent at: not you, not one of yours, unless
    // he is one of yours who said no to you (the rest decide about him)
    const markable = function (t) {
      if (!t || t.dead || t.player || t.isPlayer || t.kind === "dog") return false;
      const f = force();
      const mine = worksForYou(t) || f.indexOf(t) >= 0;
      if (mine && !defiant(t)) return false;
      for (let i = 0; i < f.length; i++) if (f[i] !== t && able(f[i])) return true;
      return false;
    };
    const lawHands = function (t) {
      const f = force();
      for (let i = 0; i < f.length; i++) if (f[i] !== t && stateMan(f[i]) && able(f[i])) return true;
      return false;
    };
    // your own crew's hands (not the state's men, not a dog): a beating is
    // their trade, never an agent's or a policeman's
    const crewHands = function (t) {
      if (presSeat()) return false;
      const f = force();
      for (let i = 0; i < f.length; i++) { const q = f[i]; if (q !== t && q.kind !== "dog" && !stateMan(q) && able(q)) return true; }
      return false;
    };
    const stateHands = function () { return !!presSeat() && lawHands(); };
    const freeMan = function () {
      const f = force();
      for (let i = 0; i < f.length; i++) { const q = f[i]; if (q.kind !== "dog" && !stateMan(q) && !q._order && !q._cbzJob) return true; }
      return false;
    };
    const by = function () { return presSeat() ? "president" : "player"; };
    // anybody of yours on him right now (an order, or a fight that is his)
    const onHim = function (t) {
      if (!t) return false;
      if (PF.target === t && !(PF.mode === "detain" && CBZ.custody && CBZ.custody.cuffed(t))) return true;
      const f = force();
      for (let i = 0; i < f.length; i++) if (f[i].rage === t) return true;
      return false;
    };
    const busyOn = function (t) { return PF.target === t && PF.mode === "kill"; };
    I.register("ped", { id: "order-detain", prio: 69, harm: true, campaignSafe: true, forceYes: true, anyone: true,
      canShow: function (t) { return markable(t) && lawHands(t) && !t.restraint && !t.vendor && t.kind !== "cop" && !(CBZ.custody && CBZ.custody.jobOf(t)); },
      label: "Detain", onSelect: function (t) { order({ by: by(), verb: "detain", target: t }); } });
    I.register("ped", { id: "order-kill", prio: 68, harm: true, campaignSafe: true, forceYes: true, anyone: true,
      canShow: function (t) { return markable(t) && !busyOn(t); }, label: "Kill",
      onSelect: function (t) { order({ by: by(), verb: "kill", target: t }); } });
    // BEAT HIM: fists, until he is down. Your own crew's work only.
    I.register("ped", { id: "order-beat", prio: 66, harm: true, campaignSafe: true, forceYes: true, anyone: true,
      canShow: function (t) { return markable(t) && crewHands(t) && !t.restraint && !(PF.target === t && PF.mode === "take"); }, label: "Beat him",
      onSelect: function (t) { order({ by: by(), verb: "take", target: t }); } });
    // THREATEN: anyone (THREATEN below)
    I.register("ped", { id: "threaten", prio: 64, harm: true, campaignSafe: true, forceYes: true, anyone: true,
      canShow: threatenable, label: "Threaten", onSelect: function (t) { threaten(t); } });
    // BACK OFF: whoever of yours is on him lets him be
    I.register("ped", { id: "order-call-off", prio: 67, campaignSafe: true, forceYes: true, anyone: true,
      canShow: onHim, label: "Back off",
      onSelect: function (t) {
        const crew = force().filter(function (q) { return q.kind !== "dog" && (q.rage === t || (PF.target === t && PF.crew.indexOf(q) >= 0)); });
        if (CBZ.command && CBZ.command.issue && crew.length) {
          CBZ.command.issue(PA(), crew, "back", t, { game: "city", exec: function (q) { if (q.rage === t && !q._custodyJob) { q.rage = null; if (q.state === "fight") q.state = "idle"; } return true; } });
        }
        if (PF.target === t) standDown(false);
      } });
    I.register("ped", { id: "order-escort", wheel: true, prio: 25, campaignSafe: true, forceYes: true, anyone: true,
      canShow: function (t) { return markable(t) && stateHands() && !t.restraint && !stateBody(t) && !t._presOfficer && !t._presStaff && t.kind !== "cop"; },
      label: "Escort out", onSelect: function (t) { order({ by: "president", verb: "escort", target: t }); } });
    I.register("ped", { id: "order-tail", wheel: true, prio: 20, campaignSafe: true, anyone: true,
      canShow: function (t) { return markable(t) && !!CBZ.followerOrder && freeMan(); },
      label: "Tail", onSelect: function (t) { order({ by: by(), verb: "tail", target: t }); } });

    // ---- on your own man: his orders, decided like any other ----
    const tell = function (a, o) {
      if (CBZ.command && CBZ.command.issue) return CBZ.command.issue(PA(), a, o, null, { game: "city" });
      return { answer: cityExec(a, o, null) ? "obey" : "refuse" };
    };
    I.register("ped", { id: "order-stand-down", prio: 70, campaignSafe: true, anyone: true,
      canShow: function (p) { return !!(p && on(p) && (p._order || p._cbzJob)); }, label: "Stand down",
      onSelect: function (a) {
        if (a._order && a._order.force) { tell(a, "back"); standDown(false); return; }
        tell(a, "back");
      } });
    // HOLD HERE / COME: one of your men keeps a spot (a door, a corridor), or
    // comes back to you. A MAN ON HIS OWN POST (the Mansion's gate, its wall
    // walk) is already holding it, so his one decision is to leave it and
    // walk with the President. Stand down sends him back: protection.js
    // hands his body to this file while the order stands, and takes it back.
    const posted = function (p) { return !!(p && !p.dead && p._protUnit === "mansion" && p._protRole !== "counter-sniper" && !p._order); };
    I.register("ped", { id: "order-hold", prio: 27, campaignSafe: true, anyone: true,
      canShow: function (p) { return on(p) && !posted(p) && !(p._order && p._order.kind === "hold") && !p._cbzWait && !p._cbzSeat; }, label: "Hold here",
      onSelect: function (a) { tell(a, "hold"); } });
    I.register("ped", { id: "order-come", prio: 72, campaignSafe: true, anyone: true,
      canShow: function (p) {
        if (!p || p.dead) return false;
        if ((p._order && p._order.kind === "hold") || (p._cbzWait && on(p))) return true;
        if (posted(p) && on(p)) return true;
        // a gang member at his own post walks with you on the word
        return !p.companion && !p._order && !!(CBZ.cityPlayerGangIsMember && CBZ.cityPlayerGangIsMember(p));
      }, label: "Come",
      onSelect: function (a) { tell(a, "come"); } });
    // DISMISS: let one of your own people go (a crewman you recruited, a
    // soldier of your gang). CBZ.cityDismiss (city/brain_city.js) is the one
    // let-go: his post and side end, he nods, says one line and walks home.
    // Not the President's guns (the Service owns them) and not a dog.
    const LET_GO = ["Alright. I'm gone.", "Your call.", "See you around.", "Fair enough."];
    I.register("ped", { id: "order-dismiss", wheel: true, prio: 5, campaignSafe: true, anyone: true,
      canShow: function (p) {
        if (!p || p.dead || p.kind === "dog" || p._compoundCrew || !on(p) || !CBZ.cityDismiss) return false;
        const Pz = CBZ.presidency;
        if (Pz && typeof Pz.serves === "function" && Pz.serves(p) === "security") return false;
        return !!(p.recruited || p.companion || (CBZ.cityPlayerGangIsMember && CBZ.cityPlayerGangIsMember(p)));
      },
      label: "Dismiss",
      onSelect: function (a) {
        const h = ((a.name || "x").charCodeAt(0) + (a.name || "").length) % LET_GO.length;
        CBZ.cityDismiss(a, { line: LET_GO[h] });
      } });
    // CLEAR ROOM: the President's agents walk everyone who is not staff out
    // of the room you are in (10 m, your storey)
    I.register("ped", { id: "pv-clear-room", wheel: true, prio: 26, campaignSafe: true, anyone: true,
      canShow: function (p) { return !!(p && p._protUnit && p._protUnit === presDetailId() && !p.dead && clearable().length); },
      label: "Clear room",
      onSelect: function (a) {
        const list = clearable();
        const P = CBZ.player;
        for (let i = 0; i < list.length; i++) {
          const t = list[i];
          const ax = t.pos.x - P.pos.x, az = t.pos.z - P.pos.z, n = Math.hypot(ax, az) || 1;
          const gx = t.pos.x + ax / n * 24, gz = t.pos.z + az / n * 24;
          t.rage = null; t.staffPost = null; t._escortedOut = true;
          t.path = [{ x: gx, z: gz }]; t.finalGoal = { x: gx, z: gz };
          if (t.target && t.target.set) t.target.set(gx, 0, gz);
          t.state = "walk"; t.pause = 0;
        }
        say(a, list.length ? "Everybody out, please." : "Room's clear, sir.");
        const Pz = CBZ.presidency;
        if (Pz && Pz.emit) { try { Pz.emit("guards-clear", { n: list.length }); } catch (e) {} }
      } });
    return true;
  }
  if (!wire()) { const t = setInterval(function () { if (wire()) clearInterval(t); }, 250); }

  /* ================================================================
     THREATEN. Owner (2026-10-22): "Threaten is a good button." A decision
     with consequences, on anybody you look at.
       Your own man (he works for you / stands for the President): the order
       he said no to again, backed by fear (CBZ.command.threaten): he does it
       now, or it breaks him (he walks off the job, or turns his gun on you
       when there is nothing left for you and he is armed). With no order
       pending he is leaned on: cowed, and he thinks less of you.
       Anybody else: his fear of you goes up (city/social.js "intimidated"),
       and he answers by who he is (CBZ.voice "threatened": backs off, goes
       quiet, hands up under a gun, calls his security, squares up, draws).
     It weighs more with your gun out and on him, and with the President's
     men standing behind you. As President the act is the one political
     model's ("threaten": the street, the papers, the scandal).
  ================================================================ */
  function aimingYou() {
    let armed = false, aiming = false;
    try { armed = !!(CBZ.cityHasGun && CBZ.cityHasGun()); } catch (e) { armed = false; }
    try { aiming = armed && !!(CBZ.isAimingWeapon && CBZ.isAimingWeapon()); } catch (e) { aiming = false; }
    return { armed: armed, aiming: aiming };
  }
  function threatenable(t) {
    if (!t || t.dead || t.player || t.isPlayer || t.kind === "dog" || !t.pos) return false;
    if (t.restraint || t._custodyJob || t.inCar || t.ko > 0) return false;
    return true;
  }
  function threaten(t) {
    const P = PA();
    if (!threatenable(t) || !P) return null;
    const A = aimingYou();
    const pres = !!presSeat();
    const C = CBZ.command;
    // ONE OF YOURS: the order backed by fear (or a man leaned on)
    if (C && C.threaten && C.authority && C.authority(P, t, null, "city") > 0) {
      const r = C.threaten(P, t, { game: "city", aimed: A.aiming, armed: A.armed });
      if (r.answer === "obey" && PF.target && r.target === PF.target && PF.crew.indexOf(t) < 0) {
        PF.crew.push(t);
        if (t._order) t._order.force = true;
      }
      if (pres) polAct("threaten", t, t);
      return r;
    }
    // ANYBODY ELSE
    let T = 0.25;
    if (CBZ.voice && CBZ.voice.threat) { try { T += CBZ.voice.threat(t, P, { aimed: A.aiming }) || 0; } catch (e) {} }
    if (A.aiming) T += 0.2; else if (A.armed) T += 0.08;
    // the men behind you are in the threat
    const f = force();
    let behind = 0;
    for (let i = 0; i < f.length && behind < 3; i++) if (f[i].kind !== "dog" && hyp(f[i].pos.x, f[i].pos.z, t.pos.x, t.pos.z) < 20) behind++;
    T += behind * 0.07 + (pres ? 0.08 : 0);
    if (T > 1) T = 1;
    if (CBZ.cityRelShift) { try { CBZ.cityRelShift(t, "intimidated", A.aiming ? 1.5 : 1); } catch (e) {} }
    const guarded = !!(t.vip || t.protectedBy || t._foreignLeader || t._presOfficer || t._powerOf);
    t.fear = Math.max(t.fear || 0, Math.round(T * 6));
    let res = null;
    if (CBZ.voice && CBZ.voice.react) {
      try { res = CBZ.voice.react(t, "threatened", { by: P, threat: T, aimed: A.aiming, guarded: guarded, force: true }); } catch (e) { res = null; }
    }
    if (pres) polAct("threaten", t, null);
    return res;
  }

  /* ---- YOUR BOSS ORDERS YOU (you are patched into somebody's crew,
     g.cityMembership). When he is in a fight and you are standing there, the
     man he is fighting is your order: "Take him out." You answer by doing it
     (systems/command.js toPlayer reads it off the man: down or dead). Stand
     there and watch and the crew remembers: your standing with them drops,
     and a second time the boss says so to your face. ---- */
  const BOSS = { t: 0, rec: null, refusals: 0 };
  function bossOrders(dt) {
    BOSS.t -= dt || 0;
    if (BOSS.t > 0) return;
    BOSS.t = 0.5;
    const C = CBZ.command, M = g.cityMembership, P = CBZ.player;
    if (!C || !C.toPlayer || !M || !M.gangId || !P || !P.pos || P.dead || P.driving) return;
    if (BOSS.rec && BOSS.rec.outcome == null) return;
    const list = CBZ.cityGangs || [];
    let rec = null;
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].id === M.gangId) { rec = list[i]; break; }
    const boss = rec && rec.boss;
    if (!boss || boss.dead || !boss.pos || hyp(boss.pos.x, boss.pos.z, P.pos.x, P.pos.z) > 25) return;
    const t = boss.rage;
    if (!t || t.dead || t.player || t.isPlayer || !t.pos || (t.gang && t.gang === M.gangId)) return;
    if (hyp(t.pos.x, t.pos.z, P.pos.x, P.pos.z) > 30) return;
    BOSS.rec = C.toPlayer(boss, "kill", {
      target: t, maxDist: 60, patience: [6, 6, 5],
      complied: function () { return downed(t); },
      alive: function () { return econ() && !boss.dead; },
      onForce: function () {
        BOSS.refusals++;
        if (CBZ.cityGangAddStanding) { try { CBZ.cityGangAddStanding(M.gangId, -8 * BOSS.refusals); } catch (e) {} }
        if (BOSS.refusals >= 2) say(boss, "You just stood there.");
      },
      onDone: function (r, out) { if (out === "complied") BOSS.refusals = Math.max(0, BOSS.refusals - 1); },
    });
  }
  if (CBZ.onUpdate) CBZ.onUpdate(36.42, function (dt) { if (econ() && g.state === "playing") bossOrders(dt); });

  CBZ.cityOrders2 = {
    give: give, clear: clear, worksForYou: worksForYou, attackerOf: attackerOf,
    order: order, standDown: standDown, threaten: threaten,
    // a man executed in the President's custody: the same bill as a death under the order
    billKill: function (t) { if (t && presSeat()) bill(t); },
    // the same order, by its old name (president_public.js escorts a protester)
    takeDown: function (t, mode) { return order({ by: presSeat() ? "president" : "player", verb: mode || "kill", target: t }); },
    force: function () { return force().slice(); },
    forceOrder: function () { return PF.target ? { target: PF.target, mode: PF.mode, by: PF.by, crew: PF.crew.slice(), billed: PF.billed } : null; },
    list: function () { const out = []; LIVE.forEach(function (a) { out.push({ name: a.name || null, kind: a._order && a._order.kind }); }); return out; },
  };
})();
