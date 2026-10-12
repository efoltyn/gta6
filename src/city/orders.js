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

     Attack     hold E: everyone with you goes for him
     Detain     the President's: two agents take him in (city/custody.js)
     Escort out the President's: two agents walk him off
     Tail       your nearest free man follows him, then tells you where
     Stand down on him while the order stands: everyone comes back

   ONE ORDER PATH. Every one of those is order({ by, verb, target }) below:
   who obeys (your detail, the uniforms near a seated President, your crew,
   hired guards, your dog), who refuses, what it costs. A net player or an AI
   boss hands the same record in. On your own man only his own verbs remain:
   Hold, Follow, Stand down, Clear room. The old agent-first flow (open your
   guard's wheel, pick Attack, then point at the mark) is gone.

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
    if (!p || p.dead || p.player || p.vendor || p.kind === "cop") return false;
    // YOUR DOG is a protector body in this same order system (city/dogs.js)
    if (p.kind === "dog") return !!p.tamed;
    if (p._iOnly && !p._protUnit) return false;      // a staffer is his job, not your muscle
    if (p.recruited || p.kind === "crew" || p.companion) return true;
    if (CBZ.cityPlayerGangIsMember && CBZ.cityPlayerGangIsMember(p)) return true;
    if (p._protUnit && CBZ.protection && CBZ.protection.get) {
      let d = null; try { d = CBZ.protection.get(p._protUnit); } catch (e) { d = null; }
      if (d && d.principal && d.principal.kind === "player") return true;
      if (d && d.id === presDetailId()) return true;
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
    if (!LIVE.size || g.mode !== "city") return;
    LIVE.forEach(function (a) {
      const o = a._order;
      if (!o || a.dead) { clear(a); return; }
      o.t += dt || 0;
      // HOLD HERE: he keeps the spot you gave him (back to it if pushed off)
      if (o.kind === "hold") { follow(a, o.spot, 0.7, dt); return; }
      const t = o.target;
      if (!t || t.dead) { if (o.kind === "attack" && !o.force) say(a, "Done."); clear(a); return; }
      if (o.kind === "detain") { detainStep(a, o, t, dt); return; }
      if (o.kind === "escort") { escortStep(a, o, t, dt); return; }
      if (o.kind === "attack") {
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
  // THE ONE POLITICAL MODEL (city/politics.js, when it is loaded) hears every
  // act and owns what it costs (approval, loyalty, the street). Returns true
  // when it took the act; without it, the costs below fall back to the
  // presidency's own numbers. Nothing here keeps a store of its own.
  function polAct(kind, t, q) {
    const PM = CBZ.politics;
    if (!PM || typeof PM.act !== "function") return false;
    try { PM.act(kind, { target: t || null, by: "president", ideology: (t && t.ideology) || null, institution: q ? institution(q) : null }); return true; } catch (e) { return false; }
  }
  // one of their own: an agent told to kill an agent, a soldier a soldier
  function brother(q, t) { return !!(t && institution(q) === institution(t) && (stateBody(t) || t._protUnit || t._presOfficer || t.kind === "cop" || t.organization === "military")); }
  function refuses(q, t) {
    if (q.kind === "dog") return false;
    // your own man (crew, a hired guard, the gang): only one who hates you says no
    if (!stateMan(q)) {
      const r = q.relPlayer;
      return !!(r && r.loyalty != null && r.loyalty < 20 && (r.grudge || 0) > 40);
    }
    // the model's loyalty of his institution, when it exists (0..100)
    const PM = CBZ.politics;
    let L = null;
    if (PM) {
      try {
        if (typeof PM.institutionLoyalty === "function") L = PM.institutionLoyalty(institution(q));
        else if (typeof PM.loyalty === "function") L = PM.loyalty(institution(q));
      } catch (e) { L = null; }
      if (L != null && !isFinite(L)) L = null;
    }
    if (L != null) {
      let p = Math.max(0, Math.min(0.95, (55 - L) / 55));
      if (brother(q, t)) p = 0.6 + 0.4 * p;          // much more likely to refuse to kill his own
      return Math.random() < p;
    }
    // without the model: the staff's loyalty and the army ladder
    const S = CBZ.presidentStaff, D = CBZ.dissent;
    const sour = function (role) { try { return !!(S && S.vacant && !S.vacant(role) && S.loyalty && S.loyalty(role) < 35); } catch (e) { return false; } };
    if (brother(q, t) && Math.random() < 0.7) return true;
    if (soldier(q)) {
      let st = 0; try { st = D && D.stage ? D.stage() : 0; } catch (e) { st = 0; }
      return sour("general") || st >= 3;
    }
    if (policeman(q)) return sour("police");
    if (q.organizationLoyalty != null && q.organizationLoyalty < 30) return true;
    const r = q.relPlayer;
    return !!(r && r.loyalty != null && r.loyalty < 20 && (r.grudge || 0) > 40);
  }
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
  function lead(list) {
    for (let i = 0; i < list.length; i++) if (list[i] && list[i]._protRole === "shift-leader") return list[i];
    return list[0] || null;
  }
  /* THE ONE ORDER PATH: { by, verb, target }. `by` is who gives it (the
     local player today: "president" when he holds the seat, else "player");
     verb is attack | detain | escort | tail. The engine below picks who
     obeys from force(), so the same record from a net player or an AI boss
     would run the same bodies. */
  function order(o) {
    const verb = (o && o.verb) || "attack", t = o && o.target;
    if (!t || t.dead || t.player || t.isPlayer) return { ok: false, why: "" };
    const pres = !!presSeat();
    if ((verb === "detain" || verb === "escort") && !pres) return { ok: false, why: "" };
    if (verb === "tail") return tailOrder(t);
    return takeDown(t, verb, pres);
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
    return { ok: give(best, "tail", t), n: 1, refused: 0 };
  }
  // the attack body for one man under a force order: straight onto the brain
  // (a companion is not sent through the follower "sic" run, whose job ends
  // on its own and would leave the order with nobody on it)
  function engage(q, t) {
    if (q.kind === "dog") { give(q, "attack", t, true); return; }
    if (!q._order) q._orderWas = { companion: !!q.companion };
    q._order = { kind: "attack", target: t, t: 0 };
    q.companion = false;
    LIVE.add(q);
    if (CBZ.cityBrain && CBZ.cityBrain.exec && CBZ.cityBrain.exec.verb) CBZ.cityBrain.exec.verb("attack", q, t);
    else { q.rage = t; q.state = "fight"; }
  }
  function takeDown(t, mode, pres) {
    mode = mode || "attack";
    if (pres == null) pres = !!presSeat();
    if (!t || t.dead || t.player) return { ok: false, why: "" };
    if ((mode === "detain" || mode === "escort") && !pres) return { ok: false, why: "" };
    if (PF.target && PF.target !== t) standDown(true);
    let all = force().filter(function (q) { return q !== t; });
    // detain and escort are the state's hands, never your crew's or a dog's
    if (mode !== "attack") all = all.filter(stateMan);
    if (!all.length) return { ok: false, why: pres ? "Nobody's with you, sir." : "" };
    // the aide with the football (q._carries, city/warroom.js) stays with the
    // case while anybody else can go; only when he is all you have does he set
    // it down and take the order (the gun discipline releases it on "order")
    const free = all.filter(function (q) { return !q._carries; });
    if (free.length) all = free;
    // a detention or an escort takes the two nearest pairs of hands
    let pool = all;
    if (mode !== "attack") {
      pool = all.slice().sort(function (a, b) { return hyp(a.pos.x, a.pos.z, t.pos.x, t.pos.z) - hyp(b.pos.x, b.pos.z, t.pos.x, t.pos.z); }).slice(0, 2);
    }
    const crew = [], no = [];
    for (let i = 0; i < pool.length; i++) { const q = pool[i]; if (refuses(q, t)) no.push(q); else crew.push(q); }
    if (no.length) {
      // a refusal is said to your face, never shown as a number
      for (let i = 0; i < Math.min(2, no.length); i++) say(no[i], pres ? (i ? "Not like this." : "Sir, I can't.") : (i ? "Not me." : "Do it yourself."));
      if (pres && no.some(stateMan)) {
        const took = polAct("refuse", t, no[0]);
        if (!took && CBZ.dissent && CBZ.dissent.bump) { try { CBZ.dissent.bump(1, 2, no.some(soldier) ? 4 : 1); } catch (e) {} }
      }
    }
    if (!crew.length) return { ok: false, why: "" };
    // a detention is priced when the cuffs go on (custody fires the act, with
    // the witnesses who saw it), never at the word
    if (pres && mode !== "detain") polAct(mode === "attack" ? "take-down" : mode, t, crew[0]);
    PF.target = t; PF.mode = mode; PF.crew = crew; PF.billed = false; PF.by = pres ? "president" : "player";
    for (let i = 0; i < crew.length; i++) {
      const q = crew[i];
      if (mode === "attack") { drawFor(q, t); engage(q, t); }
      else {
        if (!q._order) q._orderWas = { companion: !!q.companion };
        q._order = { kind: mode, target: t, t: 0 };
        q.companion = false;
        LIVE.add(q);
      }
      if (q._order) q._order.force = true;
    }
    if (mode === "detain") {
      // THE ONE ARREST PIPELINE (city/custody.js). The agents keep their
      // force order (protection.js leaves them be) until custody hands them back.
      const CU = CBZ.custody;
      const j = CU && CU.take ? CU.take(t, {
        by: "ss", verb: "detain", officers: crew, owner: "president", act: true, actBy: "president",
        actOpts: { ideology: (t && t.ideology) || null, institution: institution(crew[0]) },
        onCuffed: function () {
          const L = lead(PF.crew.filter(function (q) { return q && !q.dead; }));
          if (L) say(L, "He's secured, sir.");
          if (CBZ.presidency && CBZ.presidency.emit) { try { CBZ.presidency.emit("guards-detain", { name: t.name || null }); } catch (e) {} }
        },
        onRelease: function (q) { if (q && q._order && q._order.force) clear(q); },
      }) : null;
      if (!j) { standDown(true); return { ok: false, why: "" }; }
    }
    const L0 = lead(crew.filter(function (q) { return q.kind !== "dog"; }));
    if (mode !== "detain" && L0) say(L0, mode === "attack" ? (pres ? "Yes, sir." : "On it.") : "Sir. This way, please.");
    const Pz = CBZ.presidency;
    if (pres && Pz && Pz.emit) { try { Pz.emit("guards-order", { mode: mode, name: t.name || null, n: crew.length, refused: no.length }); } catch (e) {} }
    return { ok: true, n: crew.length, refused: no.length };
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
    if (!quiet) { const L = lead(crew.filter(function (q) { return q && !q.dead && q.kind !== "dog"; })); if (L) say(L, wasPres ? "Sir." : "Okay."); }
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
  // THE BILL, once, when the man dies under the order
  function bill(t) {
    if (PF.billed) return;
    PF.billed = true;
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
    if (!busy) standDown(true);
  });

  // ---- THE VERBS ------------------------------------------------------------
  // ON THE MAN THEY ARE ABOUT, while you have people with you (`anyone` lets
  // them through to a person who otherwise offers only his job's verbs: a
  // staffer, an agent, a General at the table). Attack is hold E; the rest
  // ride his wheel / his tap. On YOUR OWN man only his own orders remain:
  // Stand down, Hold, Follow, and the detail's Clear room.
  function wire() {
    const I = CBZ.interactions;
    if (!I || !I.register) return false;
    const on = function (p) { return worksForYou(p); };
    // a man your people can be sent at: not you, not one of yours, not the
    // man they are already on
    const mark = function (t) {
      if (!t || t.dead || t.player || t.isPlayer || PF.target === t || worksForYou(t)) return false;
      const f = force();
      return f.length > 0 && f.indexOf(t) < 0;
    };
    const stateHands = function () {
      if (!presSeat()) return false;
      const f = force();
      for (let i = 0; i < f.length; i++) if (stateMan(f[i])) return true;
      return false;
    };
    const freeMan = function () {
      const f = force();
      for (let i = 0; i < f.length; i++) { const q = f[i]; if (q.kind !== "dog" && !stateMan(q) && !q._order && !q._cbzJob) return true; }
      return false;
    };
    const by = function () { return presSeat() ? "president" : "player"; };
    I.register("ped", { id: "order-attack", hold: true, prio: 60, bad: true, campaignSafe: true, forceYes: true, anyone: true,
      canShow: mark, label: "Attack",
      onSelect: function (t) { order({ by: by(), verb: "attack", target: t }); } });
    I.register("ped", { id: "order-detain", wheel: true, prio: 59, campaignSafe: true, forceYes: true, anyone: true,
      canShow: function (t) { return mark(t) && stateHands() && !t.restraint && !t.vendor && t.kind !== "cop" && !(CBZ.custody && CBZ.custody.jobOf(t)); },
      label: "Detain", onSelect: function (t) { order({ by: "president", verb: "detain", target: t }); } });
    I.register("ped", { id: "order-escort", wheel: true, prio: 25, campaignSafe: true, forceYes: true, anyone: true,
      canShow: function (t) { return mark(t) && stateHands() && !t.restraint && !stateBody(t) && !t._presOfficer && !t._presStaff && t.kind !== "cop"; },
      label: "Escort out", onSelect: function (t) { order({ by: "president", verb: "escort", target: t }); } });
    I.register("ped", { id: "order-tail", wheel: true, prio: 20, campaignSafe: true, anyone: true,
      canShow: function (t) { return mark(t) && !!CBZ.followerOrder && freeMan(); },
      label: "Tail", onSelect: function (t) { order({ by: by(), verb: "tail", target: t }); } });
    // the man they are on: call it off from him too
    I.register("ped", { id: "order-call-off", prio: 80, campaignSafe: true, forceYes: true, anyone: true,
      canShow: function (t) { return !!(t && PF.target === t && !(PF.mode === "detain" && CBZ.custody && CBZ.custody.cuffed(t))); }, label: "Stand down",
      onSelect: function () { standDown(false); } });

    // ---- on your own man ----
    I.register("ped", { id: "order-stand-down", prio: 70, campaignSafe: true, anyone: true,
      canShow: function (p) { return !!(p && (p._order || p._cbzJob)); }, label: "Stand down",
      onSelect: function (a) {
        if (a._order && a._order.force) { standDown(false); return; }
        if (a._cbzJob) { a._cbzJob = null; a._sicOn = null; a._boardRun = false; }
        clear(a); say(a, "Sir.");
      } });
    // HOLD / FOLLOW: one of your men keeps a spot (a door, a corridor), or
    // comes back to you. A follower (your crew walking with you) holds through
    // the follower engine (boarding.js "wait"), everyone else through _order.
    I.register("ped", { id: "order-hold", prio: 27, campaignSafe: true, anyone: true,
      canShow: function (p) { return on(p) && !(p._order && p._order.kind === "hold") && !p._cbzWait && !p._cbzSeat; }, label: "Hold",
      onSelect: function (a) {
        if (a.companion && CBZ.followerOrder && CBZ.followerOrder(a, "wait", {})) { say(a, "I'll hold here."); return; }
        if (!a._order) a._orderWas = { companion: !!a.companion };
        a._order = { kind: "hold", spot: { pos: { x: a.pos.x, y: a.pos.y, z: a.pos.z } }, t: 0 };
        a.companion = false; LIVE.add(a);
        say(a, "I'll hold here.");
      } });
    I.register("ped", { id: "order-follow", prio: 72, campaignSafe: true, anyone: true,
      canShow: function (p) {
        if (!p || p.dead) return false;
        if ((p._order && p._order.kind === "hold") || (p._cbzWait && on(p))) return true;
        // a gang member at his own post walks with you on the word
        return !p.companion && !p._order && !!(CBZ.cityPlayerGangIsMember && CBZ.cityPlayerGangIsMember(p));
      }, label: "Follow",
      onSelect: function (a) {
        if (a._cbzWait && CBZ.followerOrder) CBZ.followerOrder(a, "follow", {});
        if (a._order) clear(a);
        if (CBZ.cityPlayerGangIsMember && CBZ.cityPlayerGangIsMember(a)) { a.companion = true; a.guard = null; a.rage = null; }
        say(a, "With you.");
      } });
    // CLEAR ROOM: the President's agents walk everyone who is not staff out
    // of the room you are in (10 m, your storey)
    I.register("ped", { id: "pv-clear-room", prio: 26, campaignSafe: true, anyone: true,
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

  CBZ.cityOrders2 = {
    give: give, clear: clear, worksForYou: worksForYou, attackerOf: attackerOf,
    order: order, standDown: standDown,
    // the same order, by its old name (president_public.js escorts a protester)
    takeDown: function (t, mode) { return order({ by: presSeat() ? "president" : "player", verb: mode || "attack", target: t }); },
    force: function () { return force().slice(); },
    forceOrder: function () { return PF.target ? { target: PF.target, mode: PF.mode, by: PF.by, crew: PF.crew.slice(), billed: PF.billed } : null; },
    list: function () { const out = []; LIVE.forEach(function (a) { out.push({ name: a.name || null, kind: a._order && a._order.kind }); }); return out; },
  };
})();
