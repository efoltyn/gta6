/* ============================================================
   city/orders.js — TELL HIM TO DO IT TO HIM. The principal seat.

   OWNER (the delegation thesis): "interaction options are dumb BECAUSE THEY
   ARE ALL 1V1 ... I want to be able to tell someone to do something to
   someone else." This file is that one atom, for everybody who works for
   you: your crew, your hired security, the President's Secret Service and
   his staff. Point the wheel (Q, or a tap) at one of them and three verbs
   take a SECOND person:

     Attack     he goes for the one you point at
     Guard      he sticks to the one you point at and fights whoever does
     Tail       he follows the one you point at, then tells you where he went

   Agent first (this file): you pick the man, then the mark. Mark first is
   city/interact.js's "Send to rob / scare / tail / Sic" on the stranger's own
   wheel, which picks your nearest free man. Both land in ONE engine.

   ...and "Stand down" ends whatever he is doing. Picking who works like
   every verb (city/verbwheel.js): after "Attack" the wheel closes, the
   verb is pinned over whoever you now look at, E gives the order.

   Bodies: tail and a crewman's "go after" are CBZ.followerOrder's (boarding.js).
   Guard, and "go after" for an agent, run here through the shared seams:
   CBZ.cityBrain.exec.verb("attack", a, b), CBZ.protection.moveToward /
   release, CBZ.citySay. A detail agent under an order is skipped by
   protection.js's formation (ped._order) until the order ends.

   PUBLIC: CBZ.cityOrders2 = { give(agent, kind, target), clear(agent),
            worksForYou(ped), list() }
     (named apart from contracts.js's CBZ.cityOrders board)
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
    if (!p || p.dead || p.player || p.vendor || p.kind === "cop" || p._iOnly) return false;
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
  function give(a, kind, t) {
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
    say(a, kind === "attack" ? "On it." : "Got him.");
    return true;
  }
  function clear(a, done) {
    if (!a) return;
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
      const t = o.target;
      o.t += dt || 0;
      if (!t || t.dead) { if (o.kind === "attack") say(a, "Done."); clear(a); return; }
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

  // ---- THE VERBS (they show on the wheel of anyone who works for you) -------
  function wire() {
    const I = CBZ.interactions;
    if (!I || !I.register) return false;
    const on = function (p) { return worksForYou(p); };
    I.register("ped", { id: "order-attack", prio: 30, bad: true, pick: "person", campaignSafe: true,
      canShow: on, label: "Attack", onSelect: function (a, ctx, t) { give(a, "attack", t); } });
    I.register("ped", { id: "order-guard", prio: 29, pick: "person", campaignSafe: true,
      canShow: on, label: "Guard", onSelect: function (a, ctx, t) { give(a, "guard", t); } });
    I.register("ped", { id: "order-tail", prio: 28, pick: "person", campaignSafe: true,
      canShow: on, label: "Tail", onSelect: function (a, ctx, t) { give(a, "tail", t); } });
    I.register("ped", { id: "order-stand-down", prio: 70, campaignSafe: true,
      canShow: function (p) { return !!(p && (p._order || p._cbzJob)); }, label: "Stand down",
      onSelect: function (a) {
        if (a._cbzJob) { a._cbzJob = null; a._sicOn = null; a._boardRun = false; }
        clear(a); say(a, "Sir.");
      } });
    return true;
  }
  if (!wire()) { const t = setInterval(function () { if (wire()) clearInterval(t); }, 250); }

  CBZ.cityOrders2 = {
    give: give, clear: clear, worksForYou: worksForYou,
    list: function () { const out = []; LIVE.forEach(function (a) { out.push({ name: a.name || null, kind: a._order && a._order.kind }); }); return out; },
  };
})();
