/* ============================================================
   systems/seat_exit.js — THE WAY OUT OF WHATEVER YOU ARE SITTING IN.

   OWNER: "It should be more clear how to exit the seat you're in; there's
   no button."

   He was right in two different ways. On a keyboard the exit verb was a key
   nobody told you about: the ride card is silent (city/interactions.js
   SILENT_RIDE), the chair's stand-up card is silent (CITY_SEAT_SILENT), and
   an aeroplane leaves on [F] while everything else leaves on [E]. On a touch
   screen there WAS a button, but it was a different small pill in a
   different place in every context (EXIT at the top of the car's utility
   column, GET UP and EXIT side by side on a boat, JUMP OUT in the passenger
   seat, DISMOUNT in the aux rail, nothing at all on a chair or a bed).

   So this file is ONE answer to "am I in a seat, and how do I leave it":

     CBZ.seatState()  -> null, or { kind, key, verb, at, exit }
        kind  "aircraft" | "armor" | "vehicle" | "mount" | "seat" | "bed"
        key   the real key for that seat ("f" for an aircraft, where E is the
              rudder — city/interactions.js pilotingAircraft; "e" otherwise)
        verb  what the press will actually do: "Get out", "Jump", "Pull over",
              "Get up", "Climb out", "Get off", "Stand up". A verb, never a
              noun: the thing you are sitting in is the noun.
        at    the world point the verb belongs to (your door, the hatch, the
              chair), or null when there is none
        exit  the owning system's own exit, nothing re-implemented here
     CBZ.seatExit()   -> fires seatState().exit(); true when it did

   Every probe is feature-detected against the system that owns the seat, so
   this file holds no seat state of its own and a page without one of those
   systems simply never reports that kind.

   THREE SURFACES, ONE PATH:
     - KEYBOARD: a capture-phase keydown owns the seat's key while seated.
       It runs before every bubble listener, and CONSUMES the press, because
       the old E path was the ride router (militaryvehicles.js
       cityTryNearestRide), which, the moment you stood up off a bench, went
       on to board the nearest parked car with the same keystroke.
     - DESKTOP LABEL: "[E] Get out" pinned on the door through
       CBZ.prisonPrompt (systems/interactions.js), the same element every
       other walk-up verb uses. When the door is off the frame (a first-person
       seat looks forward, the door is beside you) the label drops to the
       prompt band instead of vanishing.
     - TOUCH: ONE button, #tExit, in ONE place (top centre, clear of the left
       stick, the right thumb cluster and the vehicle column) in every seat
       in every game. It wears the same verb and calls the same exit.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.seatState) return;

  const G = () => CBZ.game || {};
  const STEP_OUT_MS = 2.4;          // passengerseat.js's walking pace (fallback verb only)

  function onTouch() {
    if (CBZ.touchMode) return true;
    try { return !!(document.body && document.body.classList.contains("touch")); } catch (e) { return false; }
  }
  function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }

  // ---- where each seat's verb belongs -------------------------------------
  function doorPoint(car, P) {
    const S = CBZ.carSeats;
    if (S && S.playerSeat && S.door && S.doorWorld) {
      try {
        const seat = S.playerSeat(car) || (S.seatOf && S.seat ? S.seat(car, S.seatOf(car, P) || "driver") : null);
        const d = seat && seat.doorId ? S.door(car, seat.doorId) : null;
        if (d) { const w = S.doorWorld(car, d, {}); w.y += 0.35; return w; }
      } catch (e) {}
    }
    const p = car && car.pos;
    if (!p) return null;
    return { x: p.x, y: num(p.y, 0) + 1.6, z: p.z };
  }
  function above(p, h) { return p ? { x: p.x, y: num(p.y, 0) + h, z: p.z } : null; }

  function craftGrounded(c) {
    if (!c) return true;
    if (c.onGround) return true;
    return Math.abs(num(c.vy, 0)) < 0.6 && Math.abs(num(c.speed, 0)) < 2.5;
  }
  function carSpeed(car) {
    if (!car) return 0;
    const vx = car.vx, vz = car.vz;
    if (isFinite(vx) && isFinite(vz) && (Math.abs(vx) + Math.abs(vz)) > 0.01) return Math.hypot(vx, vz);
    return Math.abs(num(car.v, 0));
  }

  /* THE PROBES, in the order the systems themselves resolve a seat: the air
     outranks everything (P.driving is also true in a cockpit), the armor hull
     keeps a module-local record with no P._vehicle, then the car, the saddle
     and the furniture. */
  function seatState() {
    const P = CBZ.player;
    if (!P || P.dead) return null;

    const craft = P._aircraft;
    if (craft && CBZ.cityPlayerAircraftExit) {
      return {
        kind: "aircraft", key: "f",
        verb: craftGrounded(craft) ? "Get out" : "Jump",
        at: above(craft.pos, 1.4),
        exit: function () { CBZ.cityPlayerAircraftExit(); },
      };
    }

    if (CBZ.cityArmorActive && CBZ.cityArmorActive() && CBZ.cityExitArmor) {
      const rec = CBZ.cityArmorRec ? CBZ.cityArmorRec() : null;
      return {
        kind: "armor", key: "e",
        verb: rec && rec.kind === "tank" ? "Climb out" : "Get out",
        at: rec ? above(rec.pos, rec.kind === "tank" ? 2.4 : 1.8) : null,
        exit: function () { CBZ.cityExitArmor(); },
      };
    }

    if (P.driving && P._vehicle && (CBZ.cityVehicleGetOut || CBZ.cityExitVehicle)) {
      const car = P._vehicle;
      let verb = CBZ.cityVehicleGetOutVerb ? CBZ.cityVehicleGetOutVerb() : null;
      if (!verb) verb = (CBZ.cityVehicleGetOut && carSpeed(car) > STEP_OUT_MS) ? "Jump" : "Get out";
      return {
        kind: "vehicle", key: "e", verb: verb,
        at: doorPoint(car, P),
        exit: function () {
          if (CBZ.cityVehicleGetOut && CBZ.cityVehicleGetOut()) return;
          if (CBZ.cityExitVehicle) CBZ.cityExitVehicle();
        },
      };
    }

    // A saddle. Shark Sim force-remounts every frame (you ARE the shark), so
    // there is no rider to take off it and no verb to offer.
    const mount = P._mountedAnimal;
    if (mount && CBZ.cityDismount && G().mode !== "sharksim") {
      return {
        kind: "mount", key: "e", verb: "Get off",
        at: above(mount.pos || P.pos, 1.2),
        exit: function () { CBZ.cityDismount(); },
      };
    }

    // Furniture (city/propuse.js): every chair, bench, bunk, bed and exec
    // chair. Silent while a sit / lie / stand transition owns the body: the
    // posture sequencer is already moving you and a verb would fight it.
    const s = P._propSeat, b = P._propBed;
    if ((s || b) && !(CBZ.propArcActive && CBZ.propArcActive(P))) {
      const spot = s || b;
      const at = { x: num(spot.x, P.pos.x), y: num(spot.y, P.pos.y) + (s ? 0.6 : 0.5), z: num(spot.z, P.pos.z) };
      if (s && CBZ.propStand) {
        return { kind: "seat", key: "e", verb: "Stand up", at: at, exit: function () { CBZ.propStand(P); } };
      }
      if (b && (CBZ.propWake || CBZ.propStand)) {
        return { kind: "bed", key: "e", verb: "Get up", at: at,
          exit: function () { if (CBZ.propWake) CBZ.propWake(P); else CBZ.propStand(P); } };
      }
    }
    return null;
  }

  function seatExit() {
    const st = seatState();
    if (!st) return false;
    try { st.exit(); } catch (e) { return false; }
    return true;
  }
  CBZ.seatState = seatState;
  CBZ.seatExit = seatExit;

  function live() {
    const g = G(), P = CBZ.player;
    return !!(g.state === "playing" && !CBZ.cityMenuOpen && P && !P.dead);
  }

  // ---- KEYBOARD: the seat owns its key -------------------------------------
  function typing(e) {
    const t = e && e.target;
    if (!t || !t.tagName) return false;
    const tag = t.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || !!t.isContentEditable;
  }
  function onKey(e) {
    if (!e || e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
    if (!live()) return;
    const k = String(e.key || "").toLowerCase();
    if (k !== "e" && k !== "f") return;
    const st = seatState();
    if (!st || st.key !== k) return;
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    try { st.exit(); } catch (err) {}
  }
  if (typeof addEventListener === "function") addEventListener("keydown", onKey, true);

  // ---- DESKTOP: the verb pinned on the thing -------------------------------
  let _v = null;
  function onFrame(p) {
    const cam = CBZ.camera, T = window.THREE;
    if (!p || !cam || !T) return false;
    if (!_v) _v = new T.Vector3();
    try { cam.updateMatrixWorld(); _v.set(p.x, p.y, p.z).project(cam); } catch (e) { return false; }
    return _v.z <= 1 && Math.abs(_v.x) <= 1.02 && Math.abs(_v.y) <= 1.02;
  }
  function pin(st) {
    if (!CBZ.prisonPrompt) return false;
    const at = onFrame(st.at) ? st.at : null;
    // d2 0: while you are seated, the way out is the nearest thing there is.
    return CBZ.prisonPrompt("seat-exit", "@seatExit", st.verb, { at: at, key: st.key.toUpperCase(), d2: 0, city: true });
  }

  // ---- TOUCH: one button, one place -----------------------------------------
  let btn = null, btnVerb = "", btnShown = false;
  function buildBtn() {
    if (btn || typeof document === "undefined" || !document.body) return btn;
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "tExit";
    btn.style.display = "none";
    let touchAt = -1e9;
    btn.addEventListener("touchstart", function (e) { e.preventDefault(); btn.classList.add("on"); }, { passive: false });
    btn.addEventListener("touchcancel", function () { btn.classList.remove("on"); }, { passive: false });
    btn.addEventListener("touchend", function (e) {
      e.preventDefault(); e.stopPropagation();
      btn.classList.remove("on"); touchAt = Date.now();
      seatExit();
    }, { passive: false });
    btn.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      if (Date.now() - touchAt < 700) return;    // the compatibility click after a real tap
      seatExit();
    });
    document.body.appendChild(btn);
    return btn;
  }
  function showBtn(verb) {
    if (!buildBtn()) return;
    const label = String(verb).toUpperCase();
    if (btnVerb !== label) { btnVerb = label; btn.textContent = label; }
    if (!btnShown) { btnShown = true; btn.style.display = ""; }
  }
  function hideBtn() {
    if (btn && btnShown) { btnShown = false; btn.style.display = "none"; btn.classList.remove("on"); }
  }

  // After the camera (50) and before systems/interactions.js places the
  // prompts (96), so a label armed here is swept and pinned the same frame.
  function tick() {
    const st = live() ? seatState() : null;
    if (!st) { hideBtn(); return; }
    if (onTouch()) showBtn(st.verb);
    else { hideBtn(); pin(st); }
  }
  if (CBZ.onAlways) CBZ.onAlways(95, tick);

  // exposed for tools/seat-exit-check.mjs (plain-node logic check)
  CBZ._seatExitTick = tick;
})();
