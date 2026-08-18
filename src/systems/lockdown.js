/* ============================================================
   systems/lockdown.js — FACILITY LOCKDOWN.

   When HEAT (game.detection) maxes out (~100) the whole block goes
   into a one-shot, debounced LOCKDOWN:
     • "LOCKDOWN" toast + a hard red flash + screen shake
     • a dedicated brief lockdown siren
     • a pulsing red full-screen vignette overlay (one fixed DIV,
       created once, only its opacity is animated — cheap on phones)
     • EVERY able guard is forced to hunt the player and gets a
       temporary speed boost (originals saved + restored on lift)
     • the yard door is slammed shut (CBZ.closeDoor)

   It LIFTS only once the player has stayed UNSEEN (witnessGuard()
   null) AND heat has cooled below ~25 for ~6 CONTINUOUS seconds —
   any glimpse or heat spike resets that timer. On lift the siren
   stops, the overlay fades out, guard speeds restore, and the door
   re-opens *only if the player actually holds the keycard*.

   Tense but always escapable: drop out of sight, let it cool.

   State is fully torn down on a new run (watching game.elapsed drop /
   leaving the playing state) so a fresh prison never starts sealed.

   --- review notes -------------------------------------------------
   Guards move on gd.speed in entities/guards.js (both patrol and
   hunt), so multiplying gd.speed is the right lever. The risk is
   entities/ai.js, whose actors() lazily snapshots gd.baseSpeed =
   gd.speed the first time a guard joins combat — and state.js's
   resetGame() calls aiReset() synchronously (it sets guard.hp=null,
   which re-arms that snapshot). If a lockdown were still live when a
   run reset, a BOOSTED gd.speed could get baked into baseSpeed and
   make guards permanently fast. To kill that window we detect the
   reset (elapsed dropping / leaving play) in BOTH ticks and restore
   guard speeds eagerly, never trusting a single deferred frame. We
   only ever touch guards we ourselves boosted — bases live in the
   shared CBZ.jailBoost ledger (entities/guards.js) under the
   "lockdown" tag, never the rest of the roster.
============================================================ */
(function () {
  "use strict";
  // SHOW DON'T TELL (JAIL_SHOW_DONT_TELL, declared in entities/ai.js, gated by
  // systems/capture.js). Returns true when the line was suppressed.
  function tellToast(m) { if (CBZ.jailTell) return CBZ.jailTell.toast(m); if (CBZ.flashToast) try { CBZ.flashToast(m); } catch (e) {} return false; }
  function tellHint(m, s) { if (CBZ.jailTell) return CBZ.jailTell.hint(m, s); if (CBZ.flashHint) try { CBZ.flashHint(m, s); } catch (e) {} return false; }

  const CBZ = window.CBZ;
  if (!CBZ || typeof CBZ.onUpdate !== "function" || typeof CBZ.onAlways !== "function") return;
  const g = CBZ.game;
  if (!g) return;

  // ---- tunables ----
  const TRIGGER_HEAT = 99;     // detection at/above this arms the lockdown
  const COOL_HEAT    = 25;     // heat must fall below this to start cooling
  const CLEAR_SECS   = 6.0;    // continuous unseen+cool seconds needed to lift
  const SIREN_EVERY  = 1.2;    // seconds between siren re-fires
  const HUNT_TOPUP   = 2.5;    // hunt seconds we keep refreshing on each guard
  const SPEED_BOOST  = 1.25;   // multiplier applied to guard.speed during lockdown
  const GRACE        = 1.5;    // min seconds a lockdown stays up before it can lift

  // ---- module state ----
  let active = false;          // is a lockdown currently running?
  let sirenT = 0;              // countdown to next siren blast
  let clearT = 0;              // accumulated continuous "clear" seconds
  let elapsedT = 0;            // seconds this lockdown has been live (for GRACE)
  let pulse = 0;              // 0..1 vignette intensity envelope (eased)
  let fading = false;          // overlay is fading out after a lift
  // boosted-guard bases live in the shared CBZ.jailBoost ledger (tag
  // "lockdown"); new-run detection shares its elapsed watcher too. The tight
  // 0.001 epsilon is this module's original threshold, kept verbatim.
  const pollNewRun = CBZ.jailBoost ? CBZ.jailBoost.newRunWatcher(0.001) : null;

  // ---- the overlay DIV (built lazily, once) ----
  let overlay = null;
  function ensureOverlay() {
    if (overlay || typeof document === "undefined") return overlay;
    const d = document.createElement("div");
    d.id = "lockdownOverlay";
    // sit above the heat vignette but below the menu screens (z-index 30),
    // so title/pause/win never get washed red. never eat clicks.
    const s = d.style;
    s.position = "fixed";
    s.left = s.top = s.right = s.bottom = "0";
    s.pointerEvents = "none";
    s.zIndex = "25";
    s.opacity = "0";
    // a strong inset red ring + a faint full-screen red wash
    s.boxShadow = "inset 0 0 240px 70px rgba(220,20,32,0.95)";
    s.background = "radial-gradient(circle at 50% 50%, rgba(255,30,40,0) 38%, rgba(190,12,22,0.55) 100%)";
    s.willChange = "opacity";
    // attach to body; tolerate a not-yet-ready DOM defensively
    if (document.body) document.body.appendChild(d);
    else if (document.documentElement) document.documentElement.appendChild(d);
    overlay = d;
    return overlay;
  }

  // ---- guard helpers ----
  function able(gd) {
    return gd && !gd.dead && !(gd.ko > 0) && !gd.corrupt;
  }

  // give every able guard the hunt + speed boost; called on trigger and
  // refreshed each frame so guards that spawn / wake mid-lockdown join in.
  function whipGuards() {
    if (!CBZ.guards) return;
    // A man standing his own count is where he is supposed to be. The screws
    // stay whipped up (the block is still sealed) but they stop being AIMED at
    // you — an existing hunt simply runs down instead of being topped up. This
    // is the grace, and it is a decision the player makes, not a stat.
    const grace = playerAtCount();
    if (grace !== graceSaid) {
      graceSaid = grace;
      // SHOW DON'T TELL: the grace IS the screws walking past your door
      // without stopping. Printing "they walk past" over the top of them
      // walking past is the caption track the owner asked us to delete.
      if (grace) tellHint("Count time, stay in your cell and they walk past.", 2.2);
    }
    for (const gd of CBZ.guards) {
      if (!able(gd)) continue;
      // keep them locked onto the player
      if (!grace && !(gd.hunt > HUNT_TOPUP)) gd.hunt = HUNT_TOPUP;
      gd.alert = Math.max(gd.alert || 0, grace ? 0.6 : 1.0);
      // apply the boost once per guard; the ledger remembers its real base
      // speed (snapshotted on first scale) so repeats can never compound
      if (typeof gd.speed === "number" && CBZ.jailBoost && !CBZ.jailBoost.held("lockdown", gd)) {
        CBZ.jailBoost.scale("lockdown", gd, { speed: SPEED_BOOST });
      }
    }
  }

  function restoreGuards() {
    // restore every base we snapshotted (so ai.js can never snapshot a
    // boosted value as baseSpeed after a reset / combat join)
    if (CBZ.jailBoost) CBZ.jailBoost.restoreAll("lockdown");
  }

  /* ============================================================
     CBZ.cellMuster(on) — THE BLOCK GOES TO ITS CELLS.

     A lockdown that only reddens the screen and speeds the guards up is a
     light cue. What a lockdown IS, is the block being put behind doors: every
     inmate with a bunk walks to it and the doors rack shut behind them.

     TWO CONSUMERS in this change, which is the whole reason it lives here as
     a call rather than inline: this file's LOCKDOWN/ALL CLEAR, and
     capture.js's day-beat LOCKUP phase (count time). Both are the same
     routine; neither owns it.

     HOW AN INMATE IS DRIVEN, and why it is not a new movement system.
     entities/npc.js integrates every actor toward n.target every frame, and
     entities/ai.js's brain re-picks that target only from its `wander` branch
     and only when n.aiTimer expires. So a mustered inmate is given a state
     that is NOT wander (which also stands npc.js's purposeful-routine layer
     down — it yields to any real brain state, exactly as a fight does) and an
     aiTimer that will not expire. No pathfinder, no second updater, no edit
     to ai.js or npc.js. The bases are held in the SHARED CBZ.jailBoost ledger
     under tag "cellmuster", so a run reset or a state exit restores them the
     same way a boosted guard speed is restored — this file's own discipline.

     WHAT IT REFUSES TO TOUCH, because a fight outranks a count: anyone
     hunting, fighting, snitching, approaching or held at gunpoint is skipped
     and re-scanned each tick, so they are pulled in the moment they calm
     down. And the PLAYER's cell is never touched at all — systems/capture.js
     owns that one door, and two owners over one collider is how a player
     ends up sealed in for good.
  ============================================================ */
  const MUSTER_TAG = "cellmuster";
  const LOCKUP_STATE = "lockup";     // not "wander" — that is the whole trick
  const SEAL_DELAY = 4.5;            // seconds after the call before doors rack
  const HOLD_TIMER = 1e9;            // an aiTimer the brain will never run down
  let musterOn = false, musterT = 0;
  const mustered = new Set();        // inmates we are driving
  const sealedCells = new Set();     // cell indices WE locked (never any other)

  function beatOn() { return !!(CBZ.CONFIG && CBZ.CONFIG.PRISON_CELL_BEAT); }
  function wing() {
    const c = CBZ.cellblock;
    return (c && Array.isArray(c.cells)) ? c : null;
  }
  function cellIndex(w, k) {
    const r = w.cells[k];
    return (r && typeof r.i === "number" && r.i >= 0) ? r.i : k;
  }
  function playerCellIndex() {
    const c = CBZ.cellblock;
    if (!c || c.playerCell == null) return -1;
    const pc = c.playerCell;
    if (typeof pc === "number") return pc;
    if (typeof pc === "object" && typeof pc.i === "number") return pc.i;
    const w = wing();
    if (!w) return -1;
    const k = w.cells.indexOf(pc);
    return k >= 0 ? cellIndex(w, k) : -1;
  }
  function inCell(cell, x, z, pad) {
    if (!cell) return false;
    const cx = +cell.x, cz = +cell.z, h = +cell.half;
    if (!isFinite(cx) || !isFinite(cz) || !isFinite(h) || h <= 0) return false;
    const r = h - (pad || 0);
    if (r <= 0) return false;
    return Math.abs(x - cx) <= r && Math.abs(z - cz) <= r;
  }
  function doorSet(i, locked) {
    const c = CBZ.cellblock;
    if (!c || typeof c.setDoor !== "function" || !(i >= 0)) return false;
    try { c.setDoor(i, !!locked); return true; } catch (e) { return false; }
  }
  function musterable(n) {
    return !!(n && n.group && n.target && !n.dead && !n.escaped && !(n.ko > 0) && !n._crowd &&
      n.aiState != null);          // aiState null = ai.js has not initialised it yet
  }
  // a count never interrupts a fight
  function busy(n) {
    const s = n.aiState;
    return !!((n.huntPlayer || 0) > 0 || n.foe || n.approach || n.intimidMode ||
      s === "fight" || s === "snitch" || s === "flee" || s === "approachPlayer" ||
      s === "pressurePlayer" || s === "interceptThreat" || s === "diversion" ||
      s === "rumorHuddle");
  }
  // the centre of the wing, and how far out an inmate may be and still be
  // walked home. DERIVED from the cells themselves — a straight-line walk is
  // all npc.js can do, so anyone across the compound is left where they are
  // rather than shoved into a wall for the whole lockdown.
  let hubX = 0, hubZ = 0, hubR = 0, hubFor = null, hubN = -1;
  function hub(w) {
    if (hubFor === w.cells && hubN === w.cells.length) return true;
    let n = 0, sx = 0, sz = 0;
    for (let k = 0; k < w.cells.length; k++) {
      const r = w.cells[k];
      if (!r || !isFinite(+r.x) || !isFinite(+r.z)) continue;
      sx += +r.x; sz += +r.z; n++;
    }
    if (!n) return false;
    hubX = sx / n; hubZ = sz / n;
    let far = 0;
    for (let k = 0; k < w.cells.length; k++) {
      const r = w.cells[k];
      if (!r || !isFinite(+r.x) || !isFinite(+r.z)) continue;
      const dx = +r.x - hubX, dz = +r.z - hubZ;
      far = Math.max(far, Math.hypot(dx, dz));
    }
    hubR = far + 40;                    // the wing, plus a corridor's walk home
    hubFor = w.cells; hubN = w.cells.length;
    return true;
  }
  // the cell this inmate belongs in: the one that already owns them, else a
  // free bunk claimed through the wing's OWN assign() — we never write .owner.
  let assignBroken = false;          // one probe, then never call assign again
  function cellFor(w, n, pIdx) {
    const cells = w.cells;
    for (let k = 0; k < cells.length; k++) if (cells[k] && cells[k].owner === n) return cells[k];
    if (assignBroken || typeof CBZ.cellblock.assign !== "function") return null;
    const dx = n.group.position.x - hubX, dz = n.group.position.z - hubZ;
    if (dx * dx + dz * dz > hubR * hubR) return null;      // too far to walk home
    for (let k = 0; k < cells.length; k++) {
      const r = cells[k], i = cellIndex(w, k);
      if (!r || r.owner != null || i === pIdx) continue;
      try { CBZ.cellblock.assign(n, i); } catch (e) { assignBroken = true; return null; }
      // it took, or the contract does not record owners the way we read them —
      // in which case stop asking rather than re-probing every actor, every frame.
      if (r.owner === n) return r;
      assignBroken = true;
      return null;
    }
    return null;
  }
  const STALL_GIVEUP = 4.0;        // seconds of no progress before we let go
  function hold(n, cell, dt) {
    if (!mustered.has(n)) {
      CBZ.jailBoost.apply(MUSTER_TAG, n, { aiState: LOCKUP_STATE, aiTimer: HOLD_TIMER });
      mustered.add(n);
      n._musterD2 = null; n._musterStall = 0;
    } else { n.aiState = LOCKUP_STATE; n.aiTimer = HOLD_TIMER; }
    const gp = n.group.position;
    if (inCell(cell, gp.x, gp.z, 0)) {
      // settled on the bunk: npc.js's pause branch holds the idle pose
      n.target.set(gp.x, 0, gp.z);
      n.pause = Math.max(n.pause || 0, 0.6);
      n._musterD2 = null; n._musterStall = 0;
      if (CBZ.lerpAngle && isFinite(+cell.doorX) && isFinite(+cell.doorZ)) {
        n.group.rotation.y = CBZ.lerpAngle(n.group.rotation.y,
          Math.atan2(+cell.doorX - gp.x, +cell.doorZ - gp.z), 1 - Math.pow(0.02, dt));
      }
      return true;
    }
    // two legs: the door mouth, then the bunk — a straight line from the yard
    // to a cell interior runs through the wall the door is set in.
    const useDoor = isFinite(+cell.doorX) && isFinite(+cell.doorZ) &&
      !inCell(cell, gp.x, gp.z, -1.2);
    const tx = useDoor ? +cell.doorX : +cell.x, tz = useDoor ? +cell.doorZ : +cell.z;
    n.target.set(tx, 0, tz);
    n.pause = 0;
    // npc.js's stuck-recovery only runs for roaming actors, and a lockup state
    // is deliberately not one — so this owns the give-up. There is no
    // pathfinder here: a body grinding on a corner for a whole lockdown reads
    // far worse than one that never left the yard.
    const d2 = (tx - gp.x) * (tx - gp.x) + (tz - gp.z) * (tz - gp.z);
    if (n._musterD2 != null && d2 > n._musterD2 - 0.02) n._musterStall = (n._musterStall || 0) + dt;
    else n._musterStall = 0;
    n._musterD2 = d2;
    return n._musterStall < STALL_GIVEUP;
  }
  function unhold(n) {
    if (!mustered.has(n)) return;
    // THE BRAIN MAY HAVE MOVED ON FIRST. npc.js thinks at priority 22 and this
    // drives at 72, so a man jumped mid-walk is already in "fight" by the time
    // busy() catches him here — and a blind ledger restore would write our
    // snapshotted "wander" straight over it and cancel the fight. The ledger
    // entry is always dropped (a stale base must never survive to a reset);
    // the STATE is only put back when it is still ours to put back.
    const cur = n.aiState, curT = n.aiTimer, mine = (cur === LOCKUP_STATE);
    if (CBZ.jailBoost) CBZ.jailBoost.restore(MUSTER_TAG, n);
    if (!mine) { n.aiState = cur; n.aiTimer = curT; }
    else {
      if (n.aiState == null || n.aiState === LOCKUP_STATE) n.aiState = "wander";
      n.aiTimer = 0;               // re-decide on the very next think
      n.pause = 0;
    }
    n._musterD2 = null; n._musterStall = 0;
    mustered.delete(n);
  }
  function musterRelease() {
    const was = musterOn || mustered.size || sealedCells.size;
    musterOn = false; musterT = 0;
    sealedCells.forEach(function (i) { doorSet(i, false); });
    sealedCells.clear();
    const list = [];
    mustered.forEach(function (n) { list.push(n); });
    for (const n of list) unhold(n);
    if (CBZ.jailBoost) CBZ.jailBoost.restoreAll(MUSTER_TAG);   // belt and braces
    mustered.clear();
    // the give-up marks are per-muster, not per-run
    if (was) { const all = CBZ.npcs || []; for (let k = 0; k < all.length; k++) if (all[k]) all[k]._musterGaveUp = false; }
  }
  function musterDrive(dt) {
    if (!musterOn) return;
    const w = wing();
    if (!w || !CBZ.jailBoost || !hub(w)) return;
    musterT += dt;
    const pIdx = playerCellIndex();
    const npcs = CBZ.npcs || [];
    for (let k = 0; k < npcs.length; k++) {
      const n = npcs[k];
      if (!musterable(n)) { if (n && mustered.has(n)) unhold(n); continue; }
      if (n._musterGaveUp) continue;                  // couldn't get home this muster
      if (busy(n)) { unhold(n); continue; }
      const cell = cellFor(w, n, pIdx);
      if (!cell) { unhold(n); continue; }
      if (!hold(n, cell, dt)) { unhold(n); n._musterGaveUp = true; }
    }
    if (musterT < SEAL_DELAY) return;
    for (let k = 0; k < w.cells.length; k++) {
      const r = w.cells[k], i = cellIndex(w, k);
      if (!r || i < 0 || i === pIdx || sealedCells.has(i)) continue;
      // HARD INVARIANT: this routine never shuts a door on the player. pIdx
      // covers it whenever the wing declares a playerCell; this covers the
      // case where it does not, and costs two comparisons.
      if (CBZ.player && CBZ.player.pos && inCell(r, CBZ.player.pos.x, CBZ.player.pos.z, 0)) continue;
      const own = r.owner;
      // an empty cell seals with the block; an occupied one waits for its man
      if (own && !(own.group && inCell(r, own.group.position.x, own.group.position.z, 0))) continue;
      if (doorSet(i, true)) sealedCells.add(i);
    }
  }

  // ONE-LINE ADOPTION, degrade-safe: with no wing published, no ledger, or the
  // flag off, this is a no-op and every caller behaves exactly as it did.
  CBZ.cellMuster = function (on) {
    if (!beatOn() || !wing() || !CBZ.jailBoost) { if (!on) musterRelease(); return false; }
    if (!on) { musterRelease(); return false; }
    if (!musterOn) { musterOn = true; musterT = 0; }
    return true;
  };
  CBZ.cellMusterActive = function () { return musterOn; };
  CBZ.cellMusterAudit = function () {
    return { active: musterOn, held: mustered.size, sealed: sealedCells.size,
      cells: wing() ? wing().cells.length : 0 };
  };

  // count time in your OWN cell is compliance, not evasion — capture.js is the
  // one place that answers where your cell is.
  function playerAtCount() {
    return !!(CBZ.playerInOwnCell && CBZ.playerInOwnCell());
  }
  let graceSaid = false;

  // ---- begin / end ----
  function begin() {
    if (active) return;
    active = true;
    fading = false;
    sirenT = 0;          // blare immediately
    clearT = 0;
    elapsedT = 0;
    pulse = 0;

    ensureOverlay();

    // the siren, the red flash, the shake and the doors racking shut ARE the
    // lockdown. The objective line below carries the one piece of state a
    // player cannot see (what lifts it).
    tellToast("LOCKDOWN");
    if (CBZ.shake) try { CBZ.shake(0.7); } catch (e) {}
    // hard red flash via the shared #flash overlay, if present
    try {
      const fl = CBZ.el && CBZ.el.flash;
      if (fl) { fl.classList.remove("go"); void fl.offsetWidth; fl.classList.add("go"); }
    } catch (e) {}
    if (CBZ.setObjective) try { CBZ.setObjective("LOCKDOWN. Get out of sight and lay low to lift it."); } catch (e) {}
    // a BRIEF real siren burst as the block seals — then the guards take over
    // (whipped up to beat/bed inmates). No annoying sustained loop.
    if (CBZ.sfx) try { CBZ.sfx("lockdown"); } catch (e) {}

    graceSaid = false;
    whipGuards();
    if (CBZ.closeDoor) try { CBZ.closeDoor(); } catch (e) {}
    // ...and the block goes behind its doors. The seal itself lands SEAL_DELAY
    // later, so there is a walk between the siren and the racking of the bars.
    if (CBZ.cellMuster) try { CBZ.cellMuster(true); } catch (e) {}
  }

  function end() {
    if (!active) return;
    active = false;
    fading = true;       // overlay eases out in the always-tick
    restoreGuards();
    musterRelease();     // ALL CLEAR reopens every door WE racked shut
    graceSaid = false;

    tellToast("ALL CLEAR");
    if (CBZ.setObjective) try { CBZ.setObjective("The block calms down. Keep your head low."); } catch (e) {}

    // re-open the yard door ONLY if the player actually has the keycard
    if (g && g.hasKey && CBZ.openDoor) {
      try { CBZ.openDoor(); } catch (e) {}
      tellHint("Your keycard pops the gate back open.", 2.0);   // the gate opening says it
    }
  }

  // fully reset everything (new run / leaving play). Hard-clears the overlay
  // (no fade) and restores guard speeds immediately.
  function teardown() {
    restoreGuards();
    musterRelease();     // no inmate keeps a lockup state across a run reset
    graceSaid = false;
    active = false;
    fading = false;
    sirenT = 0; clearT = 0; elapsedT = 0; pulse = 0;
    if (overlay) overlay.style.opacity = "0";
  }
  // leaving play must also hand the block back — the live driver below only
  // runs while playing, so it cannot be the thing that releases.
  if (CBZ.jailBoost && CBZ.jailBoost.onStateExit) CBZ.jailBoost.onStateExit(teardown);

  // watch for a new run: elapsed resets to ~0 in state.js resetGame().
  // Returns true if a reset was just detected (and torn down). One shared
  // poll closure serves BOTH ticks, exactly like the old single lastElapsed.
  function checkReset() {
    if (pollNewRun && pollNewRun()) { teardown(); return true; }
    return false;
  }

  // ---- the live driver: only while playing ----
  CBZ.onUpdate(72, function (dt) {
    if (CBZ.game.mode !== "escape") return;   // jail-only — never in city/disaster (was leaking guard spam into the city)
    // a fresh run is detected here too (this tick runs first while playing),
    // so any boosted gd.speed is restored before combat.js can snapshot it.
    if (checkReset()) return;

    // clamp dt so a tab-stall can't fire dozens of sirens at once
    const d = dt > 0.1 ? 0.1 : (dt > 0 ? dt : 0);

    // The muster is driven BEFORE the active gate: capture.js's day-beat LOCKUP
    // runs it with no lockdown in sight, and a mustered inmate must be
    // re-asserted every frame or ai.js's next think walks him back to the yard.
    musterDrive(d);

    if (!active) {
      // arm the lockdown when heat tops out
      if (typeof g.detection === "number" && g.detection >= TRIGGER_HEAT) begin();
      return;
    }

    elapsedT += d;

    // keep guards whipped up (covers spawns / guards that stood back up)
    whipGuards();

    // (siren is now a continuous diegetic loop started in begin() — no retrigger)

    // ---- lift condition: unseen AND cool for CLEAR_SECS continuous ----
    let seen = false;
    if (CBZ.witnessGuard) { try { seen = !!CBZ.witnessGuard(); } catch (e) { seen = false; } }
    // Being SEEN standing your own count is not being spotted — without this
    // the one correct answer to a lockdown (get in your cell) is also the one
    // that can never lift it, because the screw at your door sees you forever.
    // Heat must still cool: compliance ends the search, not the record.
    if (seen && playerAtCount()) seen = false;
    const cool = typeof g.detection === "number" ? g.detection < COOL_HEAT : true;

    if (!seen && cool && elapsedT >= GRACE) {
      clearT += d;
      if (clearT >= CLEAR_SECS) { end(); return; }
    } else {
      // any sight or heat spike resets the cooldown
      clearT = 0;
    }
  });

  // ---- overlay animation: runs ALWAYS so it can fade out on menus too ----
  CBZ.onAlways(73, function (dt) {
    const d = dt > 0.1 ? 0.1 : (dt > 0 ? dt : 0);

    // detect a new run / leaving play and tear down so we never start sealed
    checkReset();

    if (g.state !== "playing") {
      // never wash the title / pause / win screens red. Restore eagerly so a
      // lockdown that was live when the player paused/won/quit can't leave
      // guards boosted or strand the siren mid-loop.
      if (active || (CBZ.jailBoost && CBZ.jailBoost.count("lockdown"))) teardown();
      else if (overlay && overlay.style.opacity !== "0") { overlay.style.opacity = "0"; pulse = 0; fading = false; }
      return;
    }

    if (!overlay) {
      if (active || fading) ensureOverlay();
      if (!overlay) return;
    }

    if (active) {
      // ease pulse up toward 1, then strobe it for that emergency throb
      pulse += (1 - pulse) * Math.min(1, 6 * d);
      const strobe = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin((CBZ.now || 0) * 0.011));
      overlay.style.opacity = (pulse * strobe).toFixed(3);
    } else if (fading) {
      // smooth fade-out after a lift
      pulse += (0 - pulse) * Math.min(1, 3 * d);
      overlay.style.opacity = pulse.toFixed(3);
      if (pulse < 0.01) { pulse = 0; fading = false; overlay.style.opacity = "0"; }
    }
  });
})();
