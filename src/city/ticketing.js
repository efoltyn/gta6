/* ============================================================
   city/ticketing.js — BUY A SEAT, WALK OUT TO THE AEROPLANE, FLY.

   OWNER (2026-08-09): "make it so you can buy a ticket and get on the plane."

   THIS FILE IS ONLY THE VERB. It owns no geometry (city/airport_kit.js draws
   the counter and posts the agent behind it; island_airport.js already had
   four counters and four gate agents), no money (`CBZ.city.spend` is the one
   wallet), no aeroplane and no flight (systems/airline.js), and no boarding
   arc — the walk-up-and-step-in that gets you into an airliner cabin has
   shipped since the airliner wave and is the SAME verb whether you paid or
   stole it. What was missing between all of those was one sentence: "a seat
   on the 14:20 to Cape Harbor, please."

   THE WHOLE LOOP, and every step of it is somebody else's code:
     [E] at a check-in counter  -> this file, one interaction option
     the fare leaves your cash  -> CBZ.city.spend (mode.js's wallet)
     the flight WAITS for you   -> airline.js holds the doors on a ticket
     you walk out and board     -> island_airport.js's "Board the cabin"
     you sit down               -> its cabin seat zone
     the aeroplane flies        -> airline.js, with real pilots in the seats
     the cabin carries you      -> CBZ.cabinCarry
     the doors open at the far
       field and you walk off   -> island_airport.js's door + exit zones

   NO FADE TO BLACK AND NO TELEPORT. A ticket in this game buys a seat on an
   aeroplane that genuinely taxis, rotates, cruises and lands; if you shoot
   the pilot on the way it is your problem. That is the whole reason to have
   built the flight rather than a menu.

   THE COUNTER IS NOT A MENU SCREEN either. One option on [E] books the
   soonest departure; a second on [I] cycles the destination when the network
   has more than two fields. A ticket you already hold turns the same option
   into the flight's status, so the counter is also the departures board.

   Flag: `AIRLINE_TICKETS_V1=false` -> the counters go back to being scenery.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.AIRLINE_TICKETS_V1 == null) CFG.AIRLINE_TICKETS_V1 = true;

  const REACH = 4.2;                 // counter-side, a little past arm's length
  let pick = 0;                      // which destination the [I] option has cycled to
  const target = { x: 0, z: 0, ap: null, deps: null };

  function note(m, s) { if (CBZ.city && CBZ.city.note) { try { CBZ.city.note(m, s || 3); } catch (e) {} } }
  function money(n) { return "$" + (n | 0).toLocaleString("en-US"); }
  function mmss(s) {
    s = Math.max(0, Math.round(s));
    return s < 60 ? (s + "s") : (Math.floor(s / 60) + "m " + (s % 60) + "s");
  }

  function chosen() {
    const deps = target.deps;
    if (!deps || !deps.length) return null;
    return deps[Math.min(pick, deps.length - 1)];
  }

  function register() {
    if (!CBZ.interactions || !CBZ.interactions.registerZone) return false;
    CBZ.interactions.registerZone({
      id: "airline_desk", kind: "counter", prio: 4, radius: REACH,
      find: function (px, pz) {
        if (CFG.AIRLINE_TICKETS_V1 === false || !CBZ.airports) return null;
        const P = CBZ.player;
        if (!P || P.dead || P.driving || P._aircraft) return null;
        let best = null, bd = REACH * REACH;
        for (let i = 0; i < CBZ.airports.length; i++) {
          const ap = CBZ.airports[i];
          if (!ap.desk) continue;
          const dx = ap.desk.x - px, dz = ap.desk.z - pz, d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = ap; }
        }
        if (!best) return null;
        target.ap = best; target.x = best.desk.x; target.z = best.desk.z;
        target.deps = CBZ.airlineDepartures ? CBZ.airlineDepartures(best) : [];
        if (pick >= target.deps.length) pick = 0;
        return target;
      },
      options: [
        {
          id: "airline_buy", slot: "e",
          label: function () {
            const t = CBZ.airlineTicket;
            if (t) {
              if (!t.shuttle) return "Ticket to " + t.to.code + " · waiting for the next aircraft";
              const d = (CBZ.airlineDepartures(target.ap) || []).find(function (x) { return x.shuttle === t.shuttle; });
              if (d && d.boarding) return "Boarding now, stand " + (d.gate || "?") + " for " + t.to.code;
              if (d) return "Ticket to " + t.to.code + " · boards in " + mmss(d.eta);
              return "Ticket to " + t.to.code + " · aircraft inbound";
            }
            const dep = chosen();
            if (!dep) return "No departures";
            return "Buy ticket to " + dep.to.name + " — " + money(dep.price) +
              (dep.boarding ? " (boarding)" : " (" + mmss(dep.eta) + ")");
          },
          canShow: function () { return !!(target.deps && target.deps.length); },
          onSelect: function () {
            if (CBZ.airlineTicket) {
              const t = CBZ.airlineTicket;
              note("You are already booked to " + t.to.name + ".", 2.6);
              return;
            }
            const dep = chosen();
            if (!dep) return;
            const W = CBZ.city;
            if (!W || !W.spend) return;
            if (!W.spend(dep.price)) { note("You cannot afford " + money(dep.price) + ".", 2.6); return; }
            const t = CBZ.airlineBook(dep);
            if (!t) { if (W.addCash) W.addCash(dep.price); note("That flight is no longer available.", 2.6); return; }
            note("Ticket to " + dep.to.name + ", " + money(dep.price) + ". " +
              (dep.boarding
                ? ("Boarding now at stand " + (dep.gate || "?") + " · walk out to the aircraft.")
                : ("Boards in " + mmss(dep.eta) + (dep.gate ? (" at stand " + dep.gate) : "") + ".")), 5);
          },
        },
        {
          id: "airline_dest", slot: "i",
          label: function () {
            const dep = chosen();
            const n = target.deps ? target.deps.length : 0;
            return "Other destinations (" + (n ? (pick + 1) : 0) + "/" + n + (dep ? " — " + dep.to.code : "") + ")";
          },
          // Only worth a key when there is genuinely a choice to make.
          canShow: function () { return !CBZ.airlineTicket && !!(target.deps && target.deps.length > 1); },
          onSelect: function () {
            if (!target.deps || !target.deps.length) return;
            pick = (pick + 1) % target.deps.length;
            const dep = chosen();
            if (dep) note(dep.to.name + " — " + money(dep.price) + ", " + mmss(dep.eta) + ".", 2.4);
          },
        },
        {
          id: "airline_refund", slot: "j", bad: true,
          label: function () {
            const t = CBZ.airlineTicket;
            return "Refund the " + (t ? t.to.code : "") + " ticket";
          },
          canShow: function () { return !!CBZ.airlineTicket; },
          onSelect: function () {
            const t = CBZ.airlineTicket;
            if (!t) return;
            // Half back, at the counter, like every airline that ever lived.
            const back = Math.round(t.price * 0.5);
            if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(back);
            CBZ.airlineCancelTicket();
            note("Ticket refunded · " + money(back) + " of " + money(t.price) + ".", 3);
          },
        },
      ],
    });
    return true;
  }

  // The registry and the airports both come up during the world build, so the
  // zone registers on the first tick that has them rather than at load.
  let done = false;
  CBZ.onUpdate(42.95, function () {
    if (done) return;
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    if (!CBZ.airports || !CBZ.airports.length) return;
    done = register();
  });

  CBZ.ticketingAudit = function () {
    let desks = 0;
    if (CBZ.airports) for (const a of CBZ.airports) if (a.desk) desks++;
    return {
      registered: done, desks: desks,
      ticket: CBZ.airlineTicket ? (CBZ.airlineTicket.to && CBZ.airlineTicket.to.code) : null,
    };
  };
})();
