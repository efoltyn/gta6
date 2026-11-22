/* ============================================================
   games/government.js — CITY HALL AFTER DARK, as a GAME PACKAGE.

   An influence heist in one evening: your crew needs the DOCKLANDS
   REZONING passed before the gavel. A 7-seat council sits the chamber;
   you flip the room by any means that exists in it and survive the auditor.

   OWNER: "No dashboards are needed. Everything can be existing."

   THERE IS NO PANEL IN THIS GAME. It used to be played in the shared HTML
   package panel (a session hub of buttons, a card per councillor, a list of
   leak buttons, a clerk's-window form, a roll call typed out line by line).
   Everything that panel did is now a person you ask, a paper you hold or a
   thing you use:

     THE SPEAKER   stands at the lectern in front of the bench. You ask him
                   to convene, for the count, to call the vote. He says the
                   count out loud, calls the time, calls the roll, and each
                   member answers "Aye" / "Nay" from his seat.
     A MEMBER      in his seat says where he stands and what he wants. Your
                   answers are his rows: slip an envelope, give him the
                   thing he asked for, show him the file.
     THE REPORTER  tells you ONE rumour at a time; you confirm it or ask
                   about somebody else.
     THE CLERK     behind his barred window tells you ONE office at a time
                   (city/candidacy.js owns every rule); you file, and the
                   stamped declaration is a sheet in your hands.
     THE BOARD     the council roll on the wall behind the bench: stances,
                   then each vote as it is called, then the result.
     THE CLOCK     a dial beside the board; its hand reaches the top at the
                   gavel. The Speaker calls two minutes, one, thirty seconds.
     THE SHELVES   you pull a box; what was in it is a sheet you read. A
                   file on a member is yours to show him.
     THE CABINETS  what a member wants stands on a cabinet. You take it with
                   your hand and set it on the bench in front of him.
     THE REGISTER  every envelope is entered in the gift register on the
                   records desk. The auditor walks to that desk and reads
                   it. You tear the page out and feed it to
     THE SHREDDER  which jams 30% of the time and brings the desk guard.

   THE ROOM IS BUILT IN THE BUILDING IT IS IN. City Hall is a real building
   (city/buildings.js): its door, its lobby desk, its back-of-house wall, its
   stairs and lift, its 3.2 m storeys. siteRoom() reads those and stands the
   chamber in the open half of the public hall, bench against the back,
   facing the door, the clerk's window beside the lobby desk. It used to be
   laid out for an empty box: the board stood through the ceiling, the
   clerk's window and the press table were behind the back-of-house wall.

   WHAT IS REUSED: the council is cast from the LIVE officials sim
   (city/polity.js + city/officials.js); every person is a real city ped
   (ctx.npc); money is real city cash (ctx.wallet); a run for office is
   city/candidacy.js; the chair's override costs real approval
   (CBZ.approvalShock) and tyranny (city/statecraft.js).

   RULES THAT CHANGED WITH THE PANEL:
     - the vote is a roll call you watch (about ten seconds), not a button
     - a member who is dead, or out of his chair, does not answer the roll:
       he is ABSENT. With fewer than four in their chairs there is no
       quorum and the Speaker will not call it.
     - the page is torn out at the register before it can be shredded; a
       page still in the book when the auditor reads it, or any page not
       shredded at the gavel, is an indictment
     - the board shows no scandal or ledger number. The reporter and the
       Speaker say where the scandal stands.
     - a file in the records is on somebody who is NOT already with you
     - the session can be convened again the next day (the panel only ever
       offered it once per page load)

   THE BENCH HOLDS. Seated members sit out the street's panic waves like
   every other posted person in a venue (they used to stand up and run out
   of the building at any shot fired nearby, for good). A threat in the
   room still unseats one; when it is quiet he walks back round the end of
   the bench and sits (tickSeats).

   Determinism: BUILD paths + the seeded puzzle use ctx.rand only. Shredder
   jam is runtime FX (Math.random, allowed). Nothing persists across nights
   except a one-day cooldown (ctx.state).
   Revert: CBZ.CONFIG.PKG_GOVERNMENT = false (nothing mounts, zero cost).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.games) return;
  const THREE = window.THREE;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PKG_GOVERNMENT == null) CBZ.CONFIG.PKG_GOVERNMENT = true;

  /* ---------------- tunables ---------------------------------------------- */
  const COUNCIL_N = 7;
  const COUNCIL_SEAT_H = 0.48;    // cushion top above the CHAIR's own floor (the dais)
  // The bench is 0.92 tall; a body seated at floor height shows 15 cm of suit
  // over it. The members sit on a raised platform so the upper body clears.
  const DAIS_H = 0.34;
  const NIGHT_SECONDS = 240;      // the evening, in gameplay seconds, to the gavel
  const BRIBE_COST = 5000;        // real city cash per envelope
  const WIN_PAYOUT = 60000;       // developer kickback on a passed rezoning
  const SCANDAL_PER_LEAK = 34;    // 3 leaks == cap == postponed vote (LOSE)
  const SCANDAL_CAP = 100;
  const JAM_SCANDAL = 8;
  const JAM_CHANCE = 0.30;        // shredder jam (runtime FX)
  const COOLDOWN_DAYS = 1;
  const AUDITOR_SPEED = 1.4, GUARD_SPEED = 1.6;
  // THE BOARD, in metres: 3.60 x 1.26 is 2.857, the canvas's 1280 x 448. It
  // is a slab with air behind it (BOARD_GAP), never paint on its frame: two
  // surfaces at one depth shimmer. CBZ.govBoardAudit() measures the gap.
  const BOARD_W = 3.6, BOARD_H = 1.26, BOARD_T = 0.06;
  const BOARD_GAP = 0.055;
  const BOARD_EI = 0.65;          // emissiveIntensity: a lit board, not a painted one

  /* ---------------- flavor tables (indexed by seeded picks) --------------- */
  const WANT_ITEMS = [
    { id: "bourbon", name: "a case of 30-year bourbon", short: "the bourbon", title: "Case of bourbon" },
    { id: "survey",  name: "the sealed harbor survey", short: "the survey", title: "Harbor survey" },
    { id: "gavel",   name: "the commemorative gold gavel", short: "the gold gavel", title: "Gold gavel" },
    { id: "polling", name: "the primary-race polling packet", short: "the polling packet", title: "Polling packet" },
  ];
  const FEARS = [
    "a sealed DUI from '09", "an offshore account in an in-law's name",
    "a ghost-payroll cousin", "a spiked environmental report",
    "a second family across the bay", "a no-bid contract to their old firm",
    "a plagiarized law-school thesis",
  ];
  const DIRT_LINES = [
    "a memo they signed and swore they never saw",
    "expense reports that do not add up",
    "a deed transfer timed to a rezoning they voted",
    "minutes from a meeting that officially never happened",
    "a photograph they would pay to burn",
  ];
  // what is in a box with nothing in it
  const DULL_BOXES = ["Parking variances", "Sewer easements", "Dog licences", "Street-naming petitions", "Tree-trimming bids"];
  const FILL_FIRST = ["Harlan", "Corliss", "Della", "Marcus", "Yvette", "Sol", "Bianca", "Roy", "Nadia", "Grover"];
  const FILL_LAST  = ["Petrakis", "Vandermeer", "Osei", "Calloway", "Sorensen", "Ruiz", "Ashford", "Kwan", "Delgado", "Boyd"];
  const NUM = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven"];

  /* ---------------- module state ------------------------------------------ */
  let C = null;             // mounted ctx
  let V = null;             // venue refs (geometry, cast handles)
  let L = null;             // where the room stands in the building (siteRoom)
  let S = null;             // persisted bag: cooldown ONLY (see header)
  const COUNCIL = [];       // per-mount roster {i,key,sid,name,title,real,handle,want,fear,baseStance,stance,flippedBy,dirtLine,cast}
  let G = idleGame();       // session state (never persisted)
  const SCR = [];           // things said and done a moment from now: {t, fn}

  function idleGame() {
    return { active: false, rolling: false, voted: false, result: null, count: null, clockLeft: 0, scandal: 0,
      ledger: [],           // pages in the gift register on the records desk
      torn: [],             // pages torn out and in your coat
      satchel: {},          // what you took off a cabinet and carry
      given: {},            // what stands on a member's bench now
      dirt: {} };           // files you hold, by member key
  }
  function bag() { return S || (S = C.state(function () { return { nextNightDay: 0 }; })); }

  /* ---------------- helpers ----------------------------------------------- */
  function worldDayNow() { return C ? C.time.day() : 0; }
  function arenaLive() { return !!(CBZ.city && CBZ.city.arena && CBZ.city.arena.root); }
  function fmt(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function shortName(n) { if (!n) return "?"; const p = String(n).trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : p[0]; }
  function clampNum(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  function sfx(n) { if (CBZ.sfx) { try { CBZ.sfx(n); } catch (e) {} } }
  // a label that prints as written (city/verbword.js would cut it to its verb)
  function asIs(s) { const VW = CBZ.cityVerbWord; if (VW && VW.keep) VW.keep(s); return s; }
  // at his work and not running for his life
  function calm(p) { return !!p && !p.dead && !(p.ko > 0) && p.state !== "flee" && p.state !== "fight" && !p.surrender && !p.rage; }

  // ROOM COORDINATES. Everything in this file is placed in the room's own
  // frame: +z runs from the bench toward the building's door, the back wall
  // is at z = -L.hz. These put a room point in the venue (the lot) and the
  // world; the meshes hang in V.R, a group already turned and placed.
  function RL(x, z) { return [L.cx + x * L.c + z * L.s, L.cz - x * L.s + z * L.c]; }
  function worldOf(x, z) { const p = RL(x, z), o = (V && V._venue && V._venue.origin) || { x: 0, z: 0 }; return { x: o.x + p[0], z: o.z + p[1] }; }
  function worldPt(x, y, z) { const w = worldOf(x, z); return { x: w.x, y: L.fy + y, z: w.z }; }
  function solid(x1, z1, x2, z2) { const a = RL(x1, z1), b = RL(x2, z2); return C.solid(a[0], a[1], b[0], b[1], L.fy - 0.2, L.fy + 2.6); }
  function light(x, y, z, col, i, d) { const p = RL(x, z); return C.light(p[0], y, p[1], col, i, d); }
  function npc(spec) { spec.at = RL(spec.at[0], spec.at[1]); spec.face = (spec.face || 0) + L.th; return C.npc ? C.npc(spec) : null; }
  function zone(z) { z.pos = RL(z.pos[0], z.pos[1]); if (z.at) z.at = RL(z.at[0], z.at[1]); z.y = L.fy + (z.y || 1.1); return C.zone(z); }

  // SOMEBODY SAYS IT. A line is over the speaker's head (systems/speech.js
  // cuts anything past two short lines, so a longer thing is said in turns).
  function say(h, line, secs) {
    if (!h || !line) return;
    const p = h.ped || null;
    if (p && CBZ.citySay) { try { CBZ.citySay(p, line, null, { secs: secs || 3, force: true, ear: 30 }); } catch (e) {} return; }
    if (h.say) { try { h.say(line, secs); } catch (e) {} }
  }
  function after(secs, fn, who) { SCR.push({ t: secs, fn: fn, who: who || null }); }
  // what he was still going to say is dropped (he has something new to say)
  function hush(h) { if (h) for (let i = SCR.length - 1; i >= 0; i--) if (SCR[i].who === h) SCR.splice(i, 1); }
  function sayLines(h, lines, gap) {
    hush(h);
    for (let i = 0; i < lines.length; i++) {
      (function (line, k) { if (!k) say(h, line); else after(k * (gap || 2.4), function () { say(h, line); }, h); })(lines[i], i);
    }
  }
  function tickScript(dt) {
    for (let i = SCR.length - 1; i >= 0; i--) {
      const s = SCR[i]; s.t -= dt;
      if (s.t <= 0) { SCR.splice(i, 1); try { s.fn(); } catch (e) { console.error("[government script]", e); } }
    }
  }

  // YOUR HAND DOES IT (systems/verbs_pickup.js). A take off a shelf, a paper
  // into a slot, an envelope into a hand: `then` fires on the frame the hand
  // is there, exactly once, and at once where there is no body to animate.
  function reachFor(item, then, pose) {
    const Vb = CBZ.verbs; let P = null, done = false;
    const fin = function () { if (done) return; done = true; then(); };
    if (Vb && Vb.pickup) { try { P = Vb.pickup(CBZ.player, item, { onTaken: fin, pose: pose || "card", dur: 0.55 }); } catch (e) { P = null; } }
    if (!P) fin();
  }
  function setDown(item, then) {
    const Vb = CBZ.verbs; let P = null, done = false;
    const fin = function () { if (done) return; done = true; if (item && item.isObject3D) item.visible = true; then(); };
    if (Vb && Vb.putDown) { try { P = Vb.putDown(CBZ.player, item, null, { onPlaced: fin, dur: 0.6 }); } catch (e) { P = null; } }
    if (!P) fin();
  }
  function handed(h, then, kind) {
    const p = h && h.ped, Vb = CBZ.verbs; let P = null, done = false;
    const fin = function () { if (done) return; done = true; then(); };
    if (p && Vb && Vb.takeFrom) { try { P = Vb.takeFrom(CBZ.player, p, { at: "wristR", kind: kind || "cash", pose: "card", dur: 0.55, onTaken: fin }); } catch (e) { P = null; } }
    if (!P) fin();
  }
  // a painted canvas is an sRGB picture (unmarked, three.js reads it as linear
  // data and a dark board comes out pale)
  function srgb(tex) { if (tex && THREE.SRGBColorSpace && !tex.colorSpace) tex.colorSpace = THREE.SRGBColorSpace; return tex; }
  // a sheet in your hands (city/paper.js)
  function paper(spec, lowerAfter) {
    const K = CBZ.cityPaper;
    if (!K || !K.show) return false;
    const ok = K.show(spec);
    if (ok && lowerAfter) setTimeout(function () { if (CBZ.cityPaper) CBZ.cityPaper.down(spec.key); }, lowerAfter * 1000);
    return ok;
  }

  /* ---------------- the POLITICAL LAYER bridge (all feature-detected) ------
     This package used to be a closed evening: you flipped a room, you got
     paid, nothing outside the chamber ever knew. Three real systems now meet
     in here, and every one of them is read through a guard so the chamber
     still works alone:
       city/statecraft.js (CBZ.gov)    — if YOU hold this jurisdiction's seat,
                                         you are the chair, not a lobbyist.
       city/candidacy.js (CBZ.cityRun) — the clerk's window in the lobby is
                                         where a run for office is filed, and
                                         a bill passed mid-campaign is real
                                         momentum in the real tally.
       city/library research           — dirt dug in the archives arrives here
                                         as a file you already hold, because a
                                         hook on a sid is a hook on the person
                                         sitting at that bench.
     ------------------------------------------------------------------ */
  const PLAYER_SID = (CBZ.officials && CBZ.officials.PLAYER_SID) || "player";
  // the seat the PLAYER holds, if any — null when statecraft isn't loaded.
  function playerSeat() {
    try { return (CBZ.gov && CBZ.gov.holds) ? CBZ.gov.holds() : null; } catch (e) { return null; }
  }
  // Does the player chair THIS chamber? Their seat must be the jurisdiction
  // the city hall actually STANDS IN. This is a point lookup on purpose:
  // CBZ.polity.of(x,z) resolves only `city` and `federal` records (states and
  // countries are hierarchy nodes, never point targets), so a governor or a
  // president standing in a municipal chamber correctly fails this test. A
  // president does not gavel a city council — the narrow compare IS the rule.
  function playerChairsHere() {
    const seat = playerSeat(); if (!seat || !seat.id) return false;
    const o = (V && V._venue && V._venue.origin) || null;
    if (!o || !CBZ.polity || !CBZ.polity.of) return false;
    let here = null;
    try { here = CBZ.polity.of(o.x, o.z); } catch (e) { here = null; }
    return !!(here && here.id === seat.id);
  }
  function runState() {
    try { return (CBZ.cityRun && CBZ.cityRun.state) ? CBZ.cityRun.state() : null; } catch (e) { return null; }
  }
  // a hook the campaign banked on this sid IS dirt in this room. Read both
  // key shapes (bare sid, and the "sid:"-prefixed roster key) so whichever
  // convention candidacy.js settled on, the archive research pays off here.
  function bankedHook(sid) {
    const R = runState(); const H = R && R.hooks; if (!H || !sid) return null;
    return H[sid] || H["sid:" + sid] || null;
  }

  /* ---------------- pure rules (probe-testable via api) ------------------- */
  // A member who is dead, or out of his chair (a scare stands the whole bench
  // up and runs it out of the room), is not there: he cannot be lobbied and he
  // does not answer the roll.
  function gone(m) {
    const p = m && m.handle && m.handle.ped;
    if (!p) return false;
    if (p.dead) return true;
    const rec = V && V.seatRecs ? V.seatRecs[m.i] : null;
    if (rec) return p._propSeat !== rec;
    const s = V && V.seats ? V.seats[m.i] : null;
    if (!s) return false;
    const w = worldOf(s.x, s.z);
    return Math.hypot(p.pos.x - w.x, p.pos.z - w.z) > 1.5;
  }
  // The whip count. A councillor votes AYE (for) / NAY (against) / ABSTAIN
  // (undecided). The rezoning carries iff FOR strictly beats AGAINST: a tie
  // or a shortfall FAILS.
  function tallyOf(list) {
    let f = 0, a = 0, ab = 0, ex = 0;
    for (let i = 0; i < list.length; i++) {
      if (gone(list[i])) { ex++; continue; }
      const s = list[i].stance;
      if (s === "for") f++; else if (s === "against") a++; else ab++;
    }
    return { for: f, against: a, abstain: ab, absent: ex, pass: f > a };
  }

  /* ---------------- casting FROM the real officials sim ------------------- */
  // officials.js OWNS this derivation and exports it — call the owner.
  function officeTitle(rec) {
    // THE LADDER LIVES IN ONE FILE. officials.js's exported titleFor() is
    // the one declaration; this file's hand-typed kind->title branches (one
    // of the EIGHT copies doctrine counts) are deleted. Degrade: "Official".
    if (CBZ.officials && CBZ.officials.titleFor) {
      try { const t = CBZ.officials.titleFor(rec); if (t) return t; } catch (e) {}
    }
    return "Official";
  }
  // THE COUNCIL OF THE CITY THIS HALL STANDS IN: its own people, minted once
  // by city/officials.js (councilOf) as real ledger identities, the same names
  // every night. [0] is the council president, who is the Speaker; the rest
  // sit the bench, one per ward. (This used to seat any officeholder in the
  // country: foreign presidents, a queen and two governors.)
  function hallCity() {
    if (!CBZ.polity) return null;
    const o = (V && V._venue && V._venue.origin) || null;
    let rec = null;
    if (o && CBZ.polity.of) { try { rec = CBZ.polity.of(o.x, o.z); } catch (e) { rec = null; } }
    if (!rec || rec.kind !== "city") { const L = CBZ.polity.list ? CBZ.polity.list("city") : []; rec = L && L.length ? L[0] : null; }
    return rec;
  }
  function gatherOfficials() {
    const out = [];
    const O = CBZ.officials;
    if (!O || !O.councilOf || !O.identityOf) return out;
    const rec = hallCity();
    if (!rec) return out;
    const sids = O.councilOf(rec, COUNCIL_N + 1);
    for (let i = 0; i < sids.length; i++) {
      const idn = O.identityOf(sids[i]);
      if (!idn || !idn.name || idn.name === "Someone") continue;
      out.push({ sid: sids[i], name: idn.name, title: i ? "Councilmember, Ward " + i + ", " + rec.name : "Council President, " + rec.name });
    }
    return out;
  }
  function fillName(i) { return FILL_FIRST[Math.floor(C.rand(i, 20, "ff") * FILL_FIRST.length)] + " " + FILL_LAST[Math.floor(C.rand(i, 21, "fl") * FILL_LAST.length)]; }
  function auditorName() { return "Inspector " + FILL_LAST[Math.floor(C.rand(0, 30, "an") * FILL_LAST.length)]; }
  function reporterName() { return FILL_FIRST[Math.floor(C.rand(0, 31, "rf") * FILL_FIRST.length)] + " " + FILL_LAST[Math.floor(C.rand(0, 32, "rl") * FILL_LAST.length)]; }

  function speakerName() { return "Speaker " + FILL_LAST[Math.floor(C.rand(0, 33, "sp") * FILL_LAST.length)]; }

  function canDrain() {
    if (!V || V.cast) return false;
    if (!CBZ.cityMakePed) return true;                 // bare harness: dummy peds
    if (!arenaLive()) return false;                    // real peds need the live arena
    if (CBZ.officials && !(CBZ.game && CBZ.game.officials && CBZ.game.officials.inited)) return false; // wait for real names
    return true;
  }
  function drainCast() {
    if (!V || V.cast) return;
    V.cast = true;
    const all = gatherOfficials();
    const chair = all.length > COUNCIL_N ? all[0] : null;          // the council president is the Speaker
    const offs = chair ? all.slice(1) : all;
    COUNCIL.length = 0; V.realCount = 0;
    for (let i = 0; i < COUNCIL_N; i++) {
      const seat = V.seats[i], meta = V.seatMeta[i];
      let name, title, real = false, key, sid = null;
      if (i < offs.length) { sid = offs[i].sid; name = offs[i].name; title = offs[i].title; real = true; key = "sid:" + sid; V.realCount++; }
      else { name = fillName(i); title = "Councilmember"; key = "fill:" + i; }
      // The body is cast standing and committed to the REGISTERED chair through
      // CBZ.propSit({instant}): from there the seat owns the whole transform
      // (no second writer, no bob). pose + seatRef is only the path for a build
      // with no seat registry.
      const rec = (V.seatRecs && V.seatRecs[i]) || null;
      const canProp = !!(rec && CBZ.propSit);
      const spec = { role: "councillor", name: name, outfit: { archetype: "exec" }, at: [seat.x, seat.z], face: 0, post: "pinned" };
      if (!canProp) { spec.pose = "sit"; spec.seatRef = { cushion: COUNCIL_SEAT_H, floorBelow: -DAIS_H }; }
      const handle = npc(spec);
      if (canProp && handle && handle.ped && handle.ped.group) {
        const p = handle.ped;
        try {
          p.staffPost = null;                          // the SEAT has custody, not the staff post
          p.group.position.set(rec.x, rec.y || 0, rec.z);
          CBZ.propSit(p, rec, { instant: true });
          p.group.rotation.y = rec.face;
          // HE KEEPS HIS SEAT. Posted staff are left out of the street's panic
          // waves by their staffPost (city/peds.js); a councillor has none (the
          // post pin fights the sit hold), so every shot fired in the next
          // street stood the whole bench up and ran it out of the building.
          // `controlled` is the other thing those waves leave alone. A threat
          // in the room still unseats him (tickSeats lets him run, and brings
          // him back).
          p.controlled = true;
        } catch (e) {}
      }
      COUNCIL.push({ i: i, key: key, sid: sid, name: name, title: title, real: real, handle: handle, want: meta.want, fear: meta.fear, baseStance: meta.baseStance, stance: meta.baseStance, flippedBy: null, dirtLine: null, cast: null });
    }
    // the Speaker at the lectern, his back to the bench, facing the room
    V.speaker = npc({ role: "speaker", name: chair ? "Speaker " + shortName(chair.name) : speakerName(), outfit: { archetype: "exec" }, at: [0, L.zLect - 0.74], face: 0, post: "pinned", pose: "stand" });
    // the clerk behind his window
    V.clerk = npc({ role: "city clerk", name: "City Clerk", outfit: { archetype: "professional" }, at: [L.clerk.x, L.clerk.z - 0.78], face: 0, post: "pinned", pose: "stand" });
    // the auditor: a controlled ped driven along posted waypoints
    const w0 = V.waypoints[1] || { x: 0, z: 0 };
    V.auditor = npc({ role: "auditor", name: auditorName(), outfit: { archetype: "exec" }, at: [w0.x, w0.z], face: Math.PI, post: "pinned", pose: "stand" });
    if (V.auditor && V.auditor.ped) { const p = V.auditor.ped; p.controlled = true; p.staffPost = null; p.state = "idle"; p.speed = 0; }
    // the desk guard (jam responder) and the reporter (press leaks)
    V.guard = npc({ role: "guard", name: "Desk Security", at: [L.guard.x, L.guard.z], face: L.S * Math.PI / 2, post: "pinned", pose: "foldarms" });
    V.reporter = npc({ role: "reporter", name: reporterName(), outfit: { archetype: "nightlife" }, at: [L.reporter.x, L.reporter.z], face: -L.S * Math.PI / 2, post: "pinned", pose: "stand" });
    giveCastVerbs();
    redrawBoard();
  }
  function ensureCouncil() { if (COUNCIL.length) return true; if (canDrain()) drainCast(); return !!COUNCIL.length; }

  /* ================= WHAT YOU SAY TO THEM =================================
     Each person has a short list of asks: { id, label(), show(), run(),
     harm?, bad? }. On the person they are his I J K L, best first, with the
     rest round the wheel; the same list hangs on the spot he works at (the
     lectern, the window, the press table, the bench in front of a seat), so
     a tap on the furniture reaches it too. `harm` marks an ask that costs
     something (an envelope, a filing fee, the vote itself): a tap of E is
     never that one. `line()` is what he says by himself when you walk up
     (the registry's `speak` option).
     ---------------------------------------------------------------------- */
  function hang(h, tag, asks, line) {
    const I = CBZ.interactions, p = h && h.ped;
    if (!p || p._govVerbs || !I || !I.registerFor) return;
    p._govVerbs = true;
    asks.forEach(function (a, n) {
      I.registerFor(p, {
        id: "gov-" + tag + "-" + a.id, prio: 90 - n, forceYes: true, campaignSafe: true, bad: !!a.bad, harm: !!a.harm, wheel: !!a.wheel,
        label: function () { return asIs(a.label()); },
        canShow: function () { return calm(p) && !!V && a.show(); },
        onSelect: function () { a.run(); },
      });
    });
    if (line) I.registerFor(p, {
      id: "gov-" + tag + "-speak", speak: true, speakCD: 20, forceYes: true, campaignSafe: true, label: "…",
      canShow: function () { return calm(p) && !!V && !G.rolling; },
      onSelect: function () { line(); },
    });
  }
  function spotVerbs(asks, who) {
    // (a thing's E is its first verb: the ones that cost nothing go first)
    const free = asks.filter(function (a) { return !a.harm && !a.bad; }), dear = asks.filter(function (a) { return a.harm || a.bad; });
    return free.concat(dear).map(function (a) {
      return { id: a.id, bad: !!a.bad, wheel: !!a.wheel, label: function () { return asIs(a.label()); },
        canShow: function () { const h = who(); return !!h && (!h.ped || calm(h.ped)) && a.show(); }, onSelect: function () { a.run(); } };
    });
  }
  function giveCastVerbs() {
    if (!V) return;
    hang(V.speaker, "speaker", SPEAKER_ASKS, speakerGreets);
    hang(V.clerk, "clerk", clerkAsks(), clerkGreets);
    hang(V.reporter, "press", PRESS_ASKS, pressGreets);
    for (let i = 0; i < COUNCIL.length; i++) {
      (function (i) { hang(COUNCIL[i].handle, "seat" + i, memberAsks(i), function () { if (G.active) memberSays(i); }); })(i);
    }
  }

  /* ================= THE BOARD ============================================
     The council roll on the wall behind the bench: seven names, where each
     stands, then each vote as the Speaker calls it, then the result. It is
     repainted when a FACT changed (the cast seated, a member flipped, a vote
     called, the gavel fell), never per frame: a canvas upload is a real GPU
     cost. The session clock is a dial beside it for the same reason.
     THE CANVAS ASPECT IS THE MESH ASPECT (1280 x 448 == 3.60 x 1.26).
     ---------------------------------------------------------------------- */
  const BOARD_CW = 1280, BOARD_CH = 448;
  const BC = {
    bg: "#0b1119", head: "#16273a", rule: "#8fc1ff", dim: "#6f88a6",
    name: "#e8eef5", sub: "#7d8ca3", foot: "#0e1722", stripe: "rgba(255,255,255,.035)",
    for: "#5fd08a", against: "#ff6a5e", undecided: "#c9a24a", none: "#7e8aa3",
  };
  const FONT = "'Trebuchet MS',Verdana,sans-serif";
  function stanceCol(s) { return s === "for" ? BC.for : s === "against" ? BC.against : BC.undecided; }
  function rrect(cc, x, y, w, h, r) {
    cc.beginPath();
    cc.moveTo(x + r, y); cc.lineTo(x + w - r, y); cc.quadraticCurveTo(x + w, y, x + w, y + r);
    cc.lineTo(x + w, y + h - r); cc.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    cc.lineTo(x + r, y + h); cc.quadraticCurveTo(x, y + h, x, y + h - r);
    cc.lineTo(x, y + r); cc.quadraticCurveTo(x, y, x + r, y); cc.closePath();
  }
  function resultLine() {
    const c = G.count;
    switch (G.result) {
      case "win": return c ? "carried " + c.for + " to " + c.against : "rezoning carried";
      case "win:gavel": return "gavelled through";
      case "lose:indicted": return "session suspended";
      case "lose:scandal": return "vote postponed";
      case "lose:tie": return c ? "tied " + c.for + " to " + c.against + ", fails" : "tied, fails";
      case "lose:vote": return c ? "failed " + c.for + " to " + c.against : "rezoning fails";
      default: return "";
    }
  }
  function won() { return G.result === "win" || G.result === "win:gavel"; }
  // the board paints itself when it is next drawn (core/texfree.js paintWith):
  // a chamber nobody is in holds no canvas, however often the count moves
  function redrawBoard() {
    if (!V || !V.board) return;
    if (V.board.paintWith) V.board.paintWith(redrawBoardNow);
    else redrawBoardNow();
  }
  function redrawBoardNow() {
    if (!V || !V.board) return;
    const cc = V.board.cc, W = V.board.w, H = V.board.h;
    cc.textBaseline = "alphabetic";
    cc.fillStyle = BC.bg; cc.fillRect(0, 0, W, H);
    // ---- header ------------------------------------------------------------
    cc.fillStyle = BC.head; cc.fillRect(0, 0, W, 64);
    cc.fillStyle = BC.rule; cc.fillRect(0, 64, W, 3);
    cc.textAlign = "left";
    cc.fillStyle = "#dce8f6"; cc.font = "700 34px " + FONT;
    cc.fillText("DOCKLANDS REZONING", 28, 43);
    cc.fillStyle = BC.dim; cc.font = "600 17px " + FONT;
    cc.fillText("COUNCIL ROLL", 432, 42);
    cc.textAlign = "right";
    cc.fillStyle = G.result ? (won() ? BC.for : BC.against) : BC.dim;
    cc.font = "700 24px " + FONT;
    cc.fillText(G.result ? resultLine().toUpperCase() : G.rolling ? "ROLL CALL" : G.active ? "IN SESSION" : "STANDING BY", W - 28, 43);

    if (!COUNCIL.length) {
      cc.textAlign = "center"; cc.fillStyle = BC.none; cc.font = "600 28px " + FONT;
      cc.fillText("the council has not yet been seated", W / 2, H / 2 + 20);
      V.board.paint(); return;
    }
    // ---- two columns of seats: number, name, office, the chip -----------------
    const TOP = 76, ROWH = 73, COLW = (W - 60) / 2, CHIPW = 170;
    for (let i = 0; i < COUNCIL.length; i++) {
      const m = COUNCIL[i], col = i < 4 ? 0 : 1, row = i < 4 ? i : i - 4;
      const x = 24 + col * (COLW + 12), y = TOP + row * ROWH;
      const out = gone(m), voted = !!m.cast;
      const c = out ? BC.none : stanceCol(voted ? (m.cast === "aye" ? "for" : m.cast === "nay" ? "against" : "undecided") : m.stance);
      if (row % 2 === 0) { cc.fillStyle = BC.stripe; cc.fillRect(x, y, COLW, ROWH - 4); }
      cc.fillStyle = c; cc.fillRect(x, y + 6, 6, ROWH - 16);
      cc.textAlign = "right"; cc.fillStyle = BC.sub; cc.font = "700 20px " + FONT;
      cc.fillText(String(i + 1), x + 40, y + 42);
      cc.textAlign = "left";
      cc.fillStyle = out ? BC.none : BC.name; cc.font = "700 26px " + FONT;
      cc.fillText(shortName(m.name), x + 54, y + 31, COLW - CHIPW - 80);
      cc.fillStyle = BC.sub; cc.font = "500 16px " + FONT;
      cc.fillText(m.title + (m.real ? "" : ", stand-in"), x + 55, y + 54, COLW - CHIPW - 80);
      const cx = x + COLW - CHIPW - 12, word = out ? "ABSENT" : voted ? (m.cast === "aye" ? "AYE" : m.cast === "nay" ? "NAY" : "ABSTAIN") : m.stance.toUpperCase();
      // a vote that has been CALLED is a lit chip; a stance is only its outline
      cc.globalAlpha = voted ? 1 : 0.16; cc.fillStyle = c; rrect(cc, cx, y + 16, CHIPW, 36, 8); cc.fill(); cc.globalAlpha = 1;
      cc.strokeStyle = c; cc.lineWidth = 2; rrect(cc, cx, y + 16, CHIPW, 36, 8); cc.stroke();
      cc.textAlign = "center"; cc.fillStyle = voted ? "#0b1119" : c; cc.font = "700 21px " + FONT;
      cc.fillText(word, cx + CHIPW / 2, y + 42);
    }
    // ---- the eighth cell: what it takes, or how it went ------------------------
    {
      const x = 24 + COLW + 12, y = TOP + 3 * ROWH;
      cc.textAlign = "center";
      cc.fillStyle = G.result ? (won() ? BC.for : BC.against) : BC.dim;
      cc.font = "700 " + (G.result ? 30 : 20) + "px " + FONT;
      cc.fillText(G.result ? resultLine().toUpperCase() : "TO CARRY: MORE FOR THAN AGAINST", x + COLW / 2, y + (G.result ? 46 : 42), COLW - 20);
    }
    // ---- footer: the count as a bar ----------------------------------------
    const t = tallyOf(COUNCIL), n = Math.max(1, t.for + t.against + t.abstain);
    cc.fillStyle = BC.foot; cc.fillRect(0, 372, W, H - 372);
    cc.fillStyle = "rgba(143,193,255,.28)"; cc.fillRect(0, 372, W, 2);
    let bx = 28; const BW = W - 56;
    const segs = [[t.for, BC.for], [t.abstain, BC.undecided], [t.against, BC.against]];
    for (const s of segs) {
      const sw = (BW * s[0]) / n; if (sw <= 0) continue;
      cc.fillStyle = s[1]; cc.fillRect(bx, 386, Math.max(0, sw - 2), 12); bx += sw;
    }
    cc.textAlign = "left"; cc.font = "700 24px " + FONT;
    let tx = 28;
    const legend = [["FOR", t.for, BC.for], ["UNDECIDED", t.abstain, BC.undecided], ["AGAINST", t.against, BC.against]];
    if (t.absent) legend.push(["ABSENT", t.absent, BC.none]);
    for (const e of legend) {
      cc.fillStyle = e[2]; cc.beginPath(); cc.arc(tx + 7, 424, 7, 0, Math.PI * 2); cc.fill();
      const txt = e[0] + " " + e[1];
      cc.fillText(txt, tx + 22, 432);
      tx += 22 + cc.measureText(txt).width + 42;
    }
    V.board.paint();
  }

  /* ================= THE SPEAKER ==========================================
     TWO GAMES SHARE THIS ROOM. If `rec.office.holder` on THIS jurisdiction is
     the player sentinel you are the chair, and one more thing can be asked of
     the Speaker: bring the gavel down over a council that is against you.
     It pays exactly what the honest majority pays; the cost is real approval
     and tyranny (the number the garrison reads before it obeys you).
     ---------------------------------------------------------------------- */
  const CHAIR_OVERRIDE_APPROVAL = 9;   // approval points burned ramming a bill through
  const CHAIR_OVERRIDE_TYRANNY  = 12;  // tyranny added; statecraft decays it slowly

  function knock() { sfx("thud"); }
  function countLine() {
    const t = tallyOf(COUNCIL);
    return NUM[t.for] + " for. " + NUM[t.against] + " against. " + NUM[t.abstain] + " undecided.";
  }
  function timeLine() {
    const s = G.clockLeft;
    if (s >= 90) return NUM[Math.round(s / 60)] + " minutes to the vote.";
    if (s >= 45) return "A minute to the vote.";
    return "Seconds. Make it quick.";
  }
  function speakerGreets() {
    const h = V.speaker;
    if (G.active) return say(h, countLine());
    if (G.result) return say(h, cap(resultLine()) + ".");
    say(h, startable() ? "The rezoning is on the table tonight." : "The council sits again tomorrow.");
  }
  function convene() {
    if (!startNight()) { say(V.speaker, "There is no quorum tonight."); return; }
    knock();
    sayLines(V.speaker, ["The council is in session.", "The Docklands rezoning is before us.", countLine(), NUM[Math.round(NIGHT_SECONDS / 60)] + " minutes, then I call the vote."]);
  }
  // the chair's override. False when the room already agrees (then it is not
  // an override, it is just the vote).
  function chairOverride() {
    if (!G.active || G.result) return false;
    if (!playerChairsHere()) return false;
    const t = tallyOf(COUNCIL);
    if (t.pass) return false;
    const seat = playerSeat();
    // the whole cost, paid to the REAL simulation, before anything is gained
    if (seat && seat.id && CBZ.approvalShock) { try { CBZ.approvalShock(seat.id, -CHAIR_OVERRIDE_APPROVAL); } catch (e) {} }
    if (CBZ.gov && CBZ.gov.forceUsed) { try { CBZ.gov.forceUsed(CHAIR_OVERRIDE_TYRANNY, "gavelled a bill past the council"); } catch (e) {} }
    G.voted = true; G.active = false; G.count = t;
    G.result = "win:gavel";
    knock();
    sayLines(V.speaker, ["Over the council's objection.", "So ordered. The rezoning stands."]);
    C.wallet.give(WIN_PAYOUT, "Docklands rezoning, chair's prerogative");
    setCooldown(); redrawBoard();
    if (CBZ.cityFeed) CBZ.cityFeed("The chair overrode the council on the Docklands rezoning. Two members walked out.", "#ff9a6a");
    creditCampaign("gavelled the Docklands rezoning through");
    return true;
  }
  // a bill you carried while you are ON THE BALLOT is real momentum in the
  // real tally (elections.js's scoreCandidate() reads `momentum` directly)
  function creditCampaign(why) {
    try {
      if (CBZ.cityRun && CBZ.cityRun.live && CBZ.cityRun.live() && CBZ.cityRun.momentumGain) CBZ.cityRun.momentumGain(3, why);
    } catch (e) {}
  }
  const SPEAKER_ASKS = [
    { id: "convene", label: function () { return "Convene the session"; },
      show: function () { return !G.active && !G.rolling && startable(); }, run: convene },
    { id: "count", label: function () { return "Ask the count"; },
      show: function () { return G.active; }, run: function () { sayLines(V.speaker, [countLine(), timeLine()]); } },
    { id: "vote", harm: true, label: function () { return "Call the vote"; },
      show: function () { return G.active; }, run: function () { gavel("early"); } },
    { id: "gavel", bad: true, label: function () { return "Gavel it through"; },
      show: function () { return G.active && playerChairsHere() && !tallyOf(COUNCIL).pass; }, run: chairOverride },
    { id: "when", label: function () { return "Ask when they sit"; },
      show: function () { return !G.active && !G.rolling && !startable(); },
      run: function () { sayLines(V.speaker, G.result ? [cap(resultLine()) + ".", "The council sits again tomorrow."] : ["The council sits again tomorrow."]); } },
  ];

  /* ================= THE CLERK'S WINDOW ===================================
     The door INTO elected politics. Which office, what it costs and why you
     cannot yet all belong to city/candidacy.js: the clerk only reads its rows
     out, one office at a time, and takes the filing. A stamped declaration
     is a sheet in your hands. If you already HOLD a seat, a proclamation of
     doctrine (city/regimes.js) is filed at this window too.
     ---------------------------------------------------------------------- */
  const CP = { i: -1, list: [], at: 0 };
  function runApi() { return (CBZ.cityRun && CBZ.cityRun.offices) ? CBZ.cityRun : null; }
  function filed() { const st = runState(); return !!(st && st.filed); }
  function officeRows() {
    const R = runApi(), now = (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (!R) return [];
    if (now - CP.at > 800) { CP.at = now; try { CP.list = R.offices() || []; } catch (e) { CP.list = []; } }
    return CP.list;
  }
  function pitched() { const l = officeRows(); return CP.i >= 0 && l.length ? l[CP.i % l.length] : null; }
  function officeName(o) { return (o.title || "Office") + " of " + (o.name || o.id); }
  function clerkPitch() {
    const o = pitched();
    if (!o) { say(V.clerk, "No seat is open."); return; }
    const ok = o.canFile !== false;
    sayLines(V.clerk, [officeName(o) + ".", ok
      ? fmt(o.fee || 0) + " and " + (o.sigsNeeded | 0) + " signatures." + (o.daysLeft != null ? " " + o.daysLeft + " days to the ballot." : "")
      : (o.why || "You can't file for that one.")]);
  }
  function clerkGreets() {
    if (!runApi()) return say(V.clerk, "The window is closed.");
    say(V.clerk, filed() ? "Your papers are on file." : "Filing for office?");
  }
  function clerkFile() {
    const R = runApi(), o = pitched(); if (!R || !o) return;
    let r = null; try { r = R.file(o.id); } catch (e) { r = null; }
    if (!r || r.ok === false) { say(V.clerk, (r && r.why) || "I can't take that filing."); return; }
    CP.i = -1; CP.at = 0;
    say(V.clerk, "Filed. " + (r.sigsNeeded | 0) + " signatures puts you on the ballot.");
    handed(V.clerk, function () { filingPaper(o); }, "card");
  }
  // the declaration: what the clerk stamped, and where the run stands
  function filingPaper(o) {
    const st = runState(); if (!st) return;
    let office = o ? officeName(o) : null;
    if (!office) {
      const rows = officeRows();
      for (let i = 0; i < rows.length; i++) if (rows[i].id === st.officeId) office = officeName(rows[i]);
      if (!office) { let rec = null; try { rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(st.officeId) : null; } catch (e) {} office = (rec && rec.name) || String(st.officeId || ""); }
    }
    const lines = [
      { k: "OFFICE SOUGHT", v: office },
      { k: "SIGNATURES", v: (st.sigCount | 0) + " of " + (st.sigsNeeded | 0), big: true },
      { k: "WAR CHEST", v: fmt(st.warChest || 0) },
      { k: "MOMENTUM", v: String(Math.round(st.momentum || 0)) },
    ];
    if (st.scandal) lines.push({ k: "SCANDAL", v: String(Math.round(st.scandal)) });
    paper({ key: "govfiling", org: "City Clerk", title: "DECLARATION OF CANDIDACY", ink: "#1f3a5c", lines: lines,
      foot: "Short of the signatures when nomination closes, the name is not printed.",
      stamp: st.certified ? "ON THE BALLOT" : "FILED" });
  }
  function clerkWithdraw() {
    const R = runApi(); if (!R) return;
    let r = null; try { r = R.withdraw(); } catch (e) { r = null; }
    say(V.clerk, r && r.ok ? "Withdrawn. The fee stays here." : ((r && r.why) || "I can't pull those papers."));
    CP.at = 0;
  }
  function heldSeat() { const h = (CBZ.regimeHeldByPlayer && CBZ.regimeHeldByPlayer()) || []; return h.length ? h[0] : null; }
  function proclaim(gov) {
    const seat = heldSeat(); if (!seat || !CBZ.regimeDeclareDoctrine) return;
    if (CBZ.regimeCanDeclare && !CBZ.regimeCanDeclare()) {
      const need = CBZ.cityPowerNeed ? CBZ.cityPowerNeed("doctrine") : null;
      say(V.clerk, "Not yet. " + ((need && need.line) || "You need more behind you."));
      return;
    }
    const r = CBZ.regimeDeclareDoctrine(gov, { rec: seat });
    if (!r || !r.ok) { say(V.clerk, cap((r && r.reason) || "I can't enter that.")); return; }
    say(V.clerk, "Entered. It is the law of " + (seat.name || "the seat") + ".");
    paper({ key: "govproclaim", org: "City Clerk", title: "PROCLAMATION", ink: "#5c1f24",
      lines: [{ k: "JURISDICTION", v: seat.name || String(seat.id) }, { k: "PROCLAIMED UNDER", v: r.name, big: true }],
      foot: "Entered in the record by the holder of the seat.", stamp: "ON RECORD" });
  }
  function clerkAsks() {
    const asks = [
      { id: "file", harm: true, label: function () { const o = pitched(); return "File the papers " + fmt((o && o.fee) || 0); },
        show: function () { const o = pitched(); return !!runApi() && !filed() && !!o && o.canFile !== false; }, run: clerkFile },
      { id: "ask", label: function () { return "Ask about running"; },
        show: function () { return !!runApi() && !filed() && !pitched(); },
        run: function () { CP.at = 0; CP.i = officeRows().length ? 0 : -1; if (CP.i < 0) say(V.clerk, "No seat is open."); else clerkPitch(); } },
      { id: "next", label: function () { return "Ask about another office"; },
        show: function () { return !!runApi() && !filed() && !!pitched() && officeRows().length > 1; },
        run: function () { CP.i = (CP.i + 1) % officeRows().length; clerkPitch(); } },
      { id: "mine", label: function () { return "See my filing"; },
        show: function () { return !!runApi() && filed(); }, run: function () { say(V.clerk, "Here is where it stands."); filingPaper(null); } },
      { id: "withdraw", bad: true, label: function () { return "Withdraw the papers"; },
        show: function () { return !!runApi() && filed(); }, run: clerkWithdraw },
    ];
    const govs = (CBZ.regimeDoctrines && CBZ.regimeDoctrines()) || [];
    govs.forEach(function (gov) {
      asks.push({ id: "doct-" + gov, wheel: true, bad: true, label: function () { return "Proclaim " + gov; },
        show: function () { const s = heldSeat(); return !!s && !!CBZ.regimeDeclareDoctrine && s.govType !== gov; },
        run: function () { proclaim(gov); } });
    });
    return asks;
  }

  /* ================= A COUNCILLOR ======================================== */
  function memberSays(i) {
    const m = COUNCIL[i]; if (!m) return;
    if (!G.active) { say(m.handle, "The council isn't sitting."); return; }
    if (m.stance === "for") { say(m.handle, m.flippedBy ? "You have my vote." : "I'm for the rezoning."); return; }
    if (G.dirt[m.key]) { say(m.handle, "What do you want?"); return; }
    sayLines(m.handle, [m.stance === "against" ? "I'm voting no." : "I haven't decided.", "Get me " + m.want.name + ". Then we talk."]);
  }
  function memberAsks(i) {
    const m = function () { return COUNCIL[i]; };
    const open = function () { const mm = m(); return !!mm && G.active && !gone(mm) && mm.stance !== "for"; };
    return [
      { id: "file", label: function () { return "Show the file"; },
        show: function () { return open() && !!G.dirt[m().key]; },
        run: function () { handed(m().handle, function () { blackmailMember(i); }, "card"); } },
      { id: "give", label: function () { return "Give " + m().want.short; },
        show: function () { return open() && !!G.satchel[m().want.id]; }, run: function () { giveWant(i); } },
      { id: "bribe", harm: true, label: function () { return "Slip an envelope, " + fmt(BRIBE_COST); }, show: open,
        run: function () {
          if (C.wallet.cash() < BRIBE_COST) { say(m().handle, "Come back with " + fmt(BRIBE_COST) + "."); return; }
          handed(m().handle, function () { bribeMember(i); });
        } },
      { id: "ask", label: function () { return "Ask for the vote"; },
        show: function () { const mm = m(); return !!mm && !gone(mm) && !G.rolling; }, run: function () { memberSays(i); } },
    ];
  }
  // the thing he asked for, out of your coat and onto the bench in front of him
  function giveWant(i) {
    const m = COUNCIL[i]; if (!m || !G.satchel[m.want.id]) return;
    const it = V.items && V.items[m.want.id], s = V.seats[i];
    if (!it) { tradeWant(i); return; }
    it.grp.position.set(s.x - 0.2, 0.975, L.zBench + 0.02);
    it.grp.visible = false;
    setDown(it.grp, function () { tradeWant(i); });
  }

  /* ================= THE LOBBY PRESS =====================================
     She has heard something about every holdout. She tells you one; you
     confirm it (it runs, the member folds, the scandal climbs) or ask who
     else. Three stories in one night and the Speaker postpones. */
  const PR = { i: -1 };
  function holdouts() { const out = []; for (let i = 0; i < COUNCIL.length; i++) if (COUNCIL[i].stance !== "for" && !gone(COUNCIL[i])) out.push(i); return out; }
  function rumour() { return (G.active && PR.i >= 0 && COUNCIL[PR.i] && COUNCIL[PR.i].stance !== "for" && !gone(COUNCIL[PR.i])) ? COUNCIL[PR.i] : null; }
  function pressPitch(i) {
    PR.i = i;
    const m = COUNCIL[i];
    sayLines(V.reporter, [shortName(m.name) + ". " + cap(m.fear) + ".", "Confirm it and it runs tonight."]);
  }
  function pressGreets() { say(V.reporter, G.active ? "Got something for me?" : "Slow night. Nothing to print."); }
  const PRESS_ASKS = [
    { id: "confirm", harm: true, label: function () { return "Confirm it"; }, show: function () { return !!rumour(); },
      run: function () { const m = rumour(); if (m) pressLeak(m.i); } },
    { id: "heard", label: function () { return "Ask what she's heard"; }, show: function () { return G.active && !rumour(); },
      run: function () { const h = holdouts(); if (!h.length) say(V.reporter, "Nobody left worth a headline."); else pressPitch(h[0]); } },
    { id: "else", label: function () { return "Ask about someone else"; }, show: function () { return !!rumour() && holdouts().length > 1; },
      run: function () { const h = holdouts(), k = h.indexOf(PR.i); pressPitch(h[(k + 1) % h.length]); } },
  ];

  /* ---------------- the levers (also the api surface) --------------------- */
  function flip(i, by) { const m = COUNCIL[i]; if (m.stance !== "for") { m.stance = "for"; m.flippedBy = by; } hush(m.handle); redrawBoard(); }

  function bribeMember(i) {
    if (!G.active) return false;
    const m = COUNCIL[i]; if (!m || m.stance === "for") return false;
    if (!C.wallet.spend(BRIBE_COST, "Envelope to " + shortName(m.name))) return false;
    // every envelope is entered: a page in the gift register on the records desk
    G.ledger.push({ member: i, name: m.name, title: m.title, amount: BRIBE_COST, day: worldDayNow() });
    showPage();
    flip(i, "bribed");
    say(m.handle, "I never saw you.");
    return true;
  }
  function tradeWant(i) {
    if (!G.active) return false;
    const m = COUNCIL[i]; if (!m || m.stance === "for") return false;
    if (!G.satchel[m.want.id]) return false;
    G.satchel[m.want.id] = false; G.given[m.want.id] = true;
    flip(i, "traded");
    say(m.handle, "You'll have my vote.");
    return true;
  }
  function blackmailMember(i) {
    if (!G.active) return false;
    const m = COUNCIL[i]; if (!m || m.stance === "for") return false;
    if (!G.dirt[m.key]) return false;
    flip(i, "blackmailed");
    say(m.handle, "Put that away. Aye. Fine.");
    return true;
  }
  function pressLeak(i) {
    if (!G.active) return false;
    const m = COUNCIL[i]; if (!m || m.stance === "for") return false;
    flip(i, "pressured");
    G.scandal += SCANDAL_PER_LEAK;
    PR.i = -1;
    if (G.scandal >= SCANDAL_CAP) { say(V.reporter, "That's the front page."); postpone(); return true; }
    say(V.reporter, G.scandal + SCANDAL_PER_LEAK >= SCANDAL_CAP ? "That runs tonight. One more and they postpone." : "That runs tonight.");
    return true;
  }
  // what a member wants: off the cabinet and into your coat
  function pickUp(itemId) {
    if (!G.active) return false;
    if (G.satchel[itemId] || G.given[itemId]) return false;
    G.satchel[itemId] = true;
    const it = V && V.items && V.items[itemId];
    if (it) it.grp.visible = false;
    return true;
  }
  function takeItem(itemId) {
    const it = V.items && V.items[itemId];
    if (!it) { pickUp(itemId); return; }
    reachFor(it.grp, function () { pickUp(itemId); }, "grip");
  }
  function searchShelf(i) {
    if (!V || !V.shelves) return false;
    const sh = V.shelves[i]; if (!sh) return false;
    if (!G.active) return false;
    if (sh.searched) return false;
    sh.searched = true;
    if (sh.member >= 0 && COUNCIL[sh.member]) {
      const m = COUNCIL[sh.member]; G.dirt[m.key] = true; m.dirtLine = sh.line;
      return true;
    }
    return false;
  }
  // what came out of the box: a file on a member, or nothing on anyone
  function shelfPaper(i) {
    const sh = V.shelves[i], m = sh.member >= 0 ? COUNCIL[sh.member] : null;
    if (m && G.dirt[m.key]) {
      paper({ key: "govfile", org: "City Records", title: "FILE " + (i + 1) + "-" + String.fromCharCode(65 + m.i), ink: "#3a2a1a",
        lines: [{ k: "SUBJECT", v: m.name }, { k: "OFFICE", v: m.title }, { gap: 10 }, { text: cap(m.dirtLine || sh.line) + "." }],
        foot: "Not to leave the records room.", stamp: "SEALED" });
    } else {
      paper({ key: "govfile", org: "City Records", title: "BOX " + (i + 1), ink: "#3a2a1a",
        lines: [{ k: "CONTENTS", v: DULL_BOXES[i % DULL_BOXES.length] }, { k: "YEARS", v: (1984 + i * 3) + " to " + (1991 + i * 3) }],
        foot: "Retain seven years." });
    }
  }
  // the page with your envelopes on it, out of the register and into your coat
  function showPage() { if (V && V.pageMesh) V.pageMesh.visible = G.ledger.length > 0; }
  function tearPage() {
    if (!G.ledger.length) return false;
    for (let i = 0; i < G.ledger.length; i++) G.torn.push(G.ledger[i]);
    G.ledger.length = 0;
    showPage(); sfx("cloth");
    const lines = [{ cols: ["RECEIVED BY", "AMOUNT"], head: true }];
    for (let i = 0; i < G.torn.length; i++) lines.push({ cols: [G.torn[i].name, fmt(G.torn[i].amount)] });
    paper({ key: "govpage", org: "Council Gift Register", title: "PAGE " + (40 + worldDayNow() % 50), ink: "#4a3826", colw: [0.68, 0.32],
      lines: lines, foot: "Entries are public record and are read by the auditor." }, 3.4);
    return true;
  }
  // into the shredder: the pages in your coat are gone. It jams 30% of the
  // time: loud, a little scandal, and the desk guard comes over.
  function shredPage() {
    if (!G.torn.length) return { cleared: false, jammed: false };
    G.torn.length = 0;
    const jam = Math.random() < JAM_CHANCE;              // runtime FX RNG is allowed
    if (V && V.strip) { V.strip.visible = true; V.stripT = 0.8; }
    if (jam) {
      G.scandal += JAM_SCANDAL; pullGuardToShredder();
      sfx("rack");
      say(V && V.guard, "Hey! What's grinding over there?");
      if (G.active && G.scandal >= SCANDAL_CAP) postpone();
    } else sfx("switch");
    return { cleared: true, jammed: jam };
  }
  // the auditor at the records desk reads the register. A page still in it
  // indicts you on the spot; a page torn out is only a page missing, for now.
  function auditorCheck() {
    const indicted = G.ledger.length > 0;
    if (indicted && G.active && !G.result) indict("book");
    else if (G.torn.length && G.active && !V.missSaid) { V.missSaid = true; say(V.auditor, "A page is gone from this register."); }
    return { indicted: indicted };
  }

  /* ---------------- terminal states --------------------------------------- */
  function setCooldown() { bag().nextNightDay = worldDayNow() + COOLDOWN_DAYS; try { C.saveState(); } catch (e) {} }
  function startable() { return worldDayNow() >= (bag().nextNightDay || 0); }

  function indict(where) {
    if (!G || G.result) return;
    G.active = false; G.voted = true; G.result = "lose:indicted";
    setCooldown(); redrawBoard();
    say(V && V.auditor, where === "book" ? "Your name is in the gift register." : "That page in your coat is evidence.");
    after(2.2, function () { knock(); say(V && V.speaker, "This session is suspended."); });
  }
  function postpone() {
    if (!G || G.result) return;
    G.active = false; G.voted = true; G.result = "lose:scandal";
    setCooldown(); redrawBoard();
    after(1.6, function () { knock(); sayLines(V && V.speaker, ["Not under this cloud.", "The vote is postponed."]); });
  }
  function payWin() {
    C.wallet.give(WIN_PAYOUT, "Docklands rezoning, developer kickback");
    // a bill you carried on a clean majority while you hold the seat is the one
    // thing in this room that BUYS approval instead of spending it
    const seat = playerChairsHere() ? playerSeat() : null;
    if (seat && seat.id && CBZ.approvalShock) { try { CBZ.approvalShock(seat.id, 4); } catch (e) {} }
    creditCampaign("carried the Docklands rezoning");
  }
  /* THE GAVEL: THE ROLL IS CALLED. Any page not shredded (in the register or
     in your coat) is an indictment before a single name is read. Otherwise
     the Speaker calls each member; he answers from his seat and his chip on
     the board lights; then the Speaker gives the count and the result.
     `instant` (probes) skips the telling and settles it at once. */
  function castOf(m) { return gone(m) ? "absent" : m.stance === "for" ? "aye" : m.stance === "against" ? "nay" : "abstain"; }
  function gavel(trigger, instant) {
    if (!G || G.result || G.voted || G.rolling) return;
    if (!COUNCIL.length) return;
    if (G.ledger.length > 0 || G.torn.length > 0) { indict(G.ledger.length > 0 ? "book" : "coat"); return; }
    // four of seven in their chairs, or there is nobody to call
    let seated = 0; for (let i = 0; i < COUNCIL.length; i++) if (!gone(COUNCIL[i])) seated++;
    if (!instant && seated * 2 <= COUNCIL.length) {
      sayLines(V.speaker, ["There is no quorum.", "We wait for the members."]);
      if (trigger === "clock") G.clockLeft = 8;          // he asks again shortly
      return;
    }
    hush(V.speaker);
    G.voted = true; G.active = false; G.rolling = true;
    redrawBoard();
    if (instant) { for (let i = 0; i < COUNCIL.length; i++) COUNCIL[i].cast = castOf(COUNCIL[i]); settleVote(true); return; }
    knock();
    say(V.speaker, trigger === "clock" ? "Time. I will call the roll." : "The question is called.");
    let t = 2.0;
    for (let i = 0; i < COUNCIL.length; i++) {
      (function (m, at) {
        after(at, function () { say(V.speaker, shortName(m.name) + "?", 1.6); });
        after(at + 0.6, function () {
          m.cast = castOf(m);
          if (m.cast !== "absent") say(m.handle, m.cast === "aye" ? "Aye." : m.cast === "nay" ? "Nay." : "I abstain.", 1.8);
          sfx("switch"); redrawBoard();
        });
      })(COUNCIL[i], t);
      t += 1.3;
    }
    after(t + 0.5, function () { settleVote(false); });
  }
  function settleVote(quiet) {
    const t = tallyOf(COUNCIL);
    G.count = t; G.rolling = false;
    G.result = t.pass ? "win" : (t.for === t.against ? "lose:tie" : "lose:vote");
    setCooldown(); redrawBoard();
    if (quiet) { if (t.pass) payWin(); return; }
    knock();
    sayLines(V.speaker, [NUM[t.for] + (t.for === 1 ? " aye. " : " ayes. ") + NUM[t.against] + (t.against === 1 ? " nay." : " nays."),
      t.pass ? "The rezoning is carried." : (t.for === t.against ? "A tie. The rezoning fails." : "The rezoning fails.")]);
    if (t.pass) after(2.6, payWin);
  }

  /* ---------------- the evening clock ------------------------------------- */
  const CALLS = [[120, "Two minutes to the vote."], [60, "One minute."], [30, "Thirty seconds."]];
  function tickClock(dt) {
    if (!G || !G.active) return;
    const was = G.clockLeft;
    G.clockLeft -= dt;
    for (let i = 0; i < CALLS.length; i++) if (was > CALLS[i][0] && G.clockLeft <= CALLS[i][0]) say(V.speaker, CALLS[i][1]);
    if (G.clockLeft <= 0) { G.clockLeft = 0; gavel("clock"); }                 // (no quorum: he puts time back on the clock)
  }
  // the dial's hand: once round in an evening, at the top when the gavel falls
  function tickDial() {
    if (!V || !V.hand) return;
    const a = G.active ? (1 - G.clockLeft / NIGHT_SECONDS) * Math.PI * 2 : 0;
    if (Math.abs(a - V.handA) > 0.002) { V.handA = a; V.hand.rotation.z = -a; }
  }

  function startNight(opts) {
    if (!C) return false;
    if (!ensureCouncil()) return false;
    const force = opts && opts.force;
    if (!force && !startable()) return false;
    for (let i = 0; i < COUNCIL.length; i++) { const m = COUNCIL[i]; m.stance = m.baseStance; m.flippedBy = null; m.dirtLine = null; m.cast = null; }
    if (V.shelves) for (let i = 0; i < V.shelves.length; i++) V.shelves[i].searched = false;
    SCR.length = 0; PR.i = -1;
    G = idleGame(); G.active = true; G.clockLeft = NIGHT_SECONDS;
    // what you carried off last time is back on its cabinet
    for (const id in V.items) { const it = V.items[id]; it.grp.position.copy(it.home); it.grp.visible = true; }
    showPage();
    // THE ARCHIVES PAY OFF HERE. A hook the campaign banked against a real sid
    // (an afternoon in the public library's records room) is a file already in
    // your hand when the session opens. No dirt is invented: the line is the
    // line the research wrote.
    for (let i = 0; i < COUNCIL.length; i++) {
      const m = COUNCIL[i]; if (!m.sid) continue;
      const h = bankedHook(m.sid); if (!h) continue;
      G.dirt[m.key] = true; m.dirtLine = h.note || h.line || "a file you pulled from the archives";
    }
    V.wpIdx = 0; V.guardAlertT = 0; V.missSaid = false;
    redrawBoard();
    return true;
  }

  /* ---------------- driving the peds (update tick) ------------------------ */
  // send a ped toward a point through THE ONE MOVER (ped.moveOrder, the
  // CBZ.moves seam in city/peds.js): velocity, a braking arrival, a bounded
  // turn. True once she is there.
  function stepPed(ped, tx, tz, speed) {
    if (!ped || !ped.pos || !ped.group) return true;
    const dx = tx - ped.pos.x, dz = tz - ped.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.6) { if (ped.moveOrder) ped.moveOrder = null; ped.state = "idle"; ped.speed = 0; return true; }
    ped.state = "walk";
    if (CBZ.protection && CBZ.protection.order) CBZ.protection.order(ped, tx, tz, speed, null, false, 0, 0, 0.45);
    else {
      let o = ped.moveOrder;
      if (!o) o = ped.moveOrder = { x: 0, z: 0, speed: 0, stop: 0.45, face: null, strafe: false, vffX: 0, vffZ: 0, leg: false, t: 0 };
      o.x = tx; o.z = tz; o.speed = speed; o.t = CBZ.now || 0;
      if (ped.target && ped.target.set) ped.target.set(tx, 0, tz);
    }
    return false;
  }
  function driveAuditor() {
    const h = V.auditor, p = h && h.ped;
    if (!p || p.dead || !V.waypoints || !V.waypoints.length) return;
    const wp = V.waypoints[V.wpIdx % V.waypoints.length], t = worldOf(wp.x, wp.z);
    if (stepPed(p, t.x, t.z, AUDITOR_SPEED)) {
      if (wp.desk && G.active && !G.result) auditorCheck();      // she reads the register at the records desk
      V.wpIdx = (V.wpIdx + 1) % V.waypoints.length;
      const nxt = V.waypoints[V.wpIdx];
      if (nxt && nxt.desk && G.active && !G.result) say(h, "Records desk. Let's see that register.");
    }
  }
  function pullGuardToShredder() { if (V) V.guardAlertT = 6; }
  function driveGuard(dt) {
    const h = V.guard, p = h && h.ped;
    if (V.jamLamp) V.jamLamp.visible = V.guardAlertT > 0;
    if (!p || p.dead) { if (V.guardAlertT > 0) V.guardAlertT -= dt; return; }
    if (V.guardAlertT > 0) {
      if (!p.controlled) { p.controlled = true; p.staffPost = null; }
      const t = worldOf(L.shred.x, L.shred.z + 0.9);
      stepPed(p, t.x, t.z, GUARD_SPEED);
      V.guardAlertT -= dt;
    } else if (p.controlled) {
      const home = worldOf(L.guard.x, L.guard.z);
      if (stepPed(p, home.x, home.z, GUARD_SPEED)) { p.controlled = false; p.staffPost = { x: home.x, z: home.z, face: L.S * Math.PI / 2 + L.th }; p.state = "idle"; p.speed = 0; }
    }
  }
  /* A MEMBER WHO LEFT HIS CHAIR COMES BACK TO IT. Gunfire, a brawl, the
     mayor's detail hustling her out: any scare stands a seated body up
     (city/peds.js) and it runs. The staff with a post walk back by
     themselves (city/keepers.js); a councillor's post is his chair, which
     had no way home, so one scare emptied the bench for good. Quiet for a
     while, he walks to the end of the bench, along the dais, and sits. */
  function tickSeats(dt) {
    if (!V || !V.seatRecs || !CBZ.propSit) return;
    for (let i = 0; i < COUNCIL.length; i++) {
      const m = COUNCIL[i], p = m.handle && m.handle.ped, rec = V.seatRecs[i];
      if (!p || !rec) continue;
      const out = gone(m);
      if (out !== !!m.out) { m.out = out; redrawBoard(); }     // the board marks an empty chair
      if (p.dead) continue;
      if (p._propSeat === rec) { m.calmT = 0; if (!p.controlled) p.controlled = true; continue; }
      if (!m.walking && p.controlled) p.controlled = false;    // out of his chair: his own legs have him
      if (!calm(p) || (p.fear || 0) > 3 || p.restraint) { m.calmT = 0; if (m.walking) { m.walking = false; p.controlled = false; } continue; }
      m.calmT = (m.calmT || 0) + dt;
      if (m.calmT < 8) continue;
      const s = V.seats[i], home = worldOf(s.x, s.z), far = Math.hypot(p.pos.x - home.x, p.pos.z - home.z) > 14;
      if (far) {
        // out of the building: he is back in his chair when nobody is in the
        // room to see him arrive, or after a long quiet
        const P = CBZ.player, seen = P && P.pos && Math.hypot(P.pos.x - home.x, P.pos.z - home.z) < 18;
        if (seen && m.calmT < 30) continue;
      } else {
        if (!m.walking) { m.walking = true; m.leg = 0; m.walkT = 0; p.controlled = true; p.staffPost = null; }
        // the way in: the records side of the bench is walled by the partition,
        // so everybody comes round the other end and along behind the chairs
        const way = V.wayIn, n = way.length + 1;
        const t = m.leg < way.length ? worldOf(way[m.leg].x, way[m.leg].z) : m.leg === way.length ? worldOf(s.x, way[way.length - 1].z) : home;
        if (!stepPed(p, t.x, t.z, 1.5)) { m.walkT += dt; if (m.walkT < 14) continue; }   // (stuck that long on one leg: he is sat)
        else if (m.leg < n) { m.leg++; m.walkT = 0; continue; }
      }
      m.walking = false; m.walkT = 0; m.calmT = 0; p.moveOrder = null; p.state = "idle"; p.speed = 0;
      try { p.group.position.set(rec.x, rec.y || 0, rec.z); if (p.pos && p.pos.set) p.pos.set(rec.x, rec.y || 0, rec.z); CBZ.propSit(p, rec, { instant: true }); p.group.rotation.y = rec.face; } catch (e) {}
      p.controlled = p._propSeat === rec;
    }
  }
  // the page going into the slot
  function tickStrip(dt) {
    if (!V || !V.strip || !(V.stripT > 0)) return;
    V.stripT -= dt;
    V.strip.position.y = 0.94 + Math.max(0, V.stripT) * 0.16;
    if (V.stripT <= 0) V.strip.visible = false;
  }

  /* ======================= WHERE THE ROOM STANDS ==========================
     City Hall is a real building (city/buildings.js). What it tells us:
       localDoor {x,z,nx,nz}   the doorway and its INWARD normal
       w, d, wt                the footprint and wall thickness
       floorTops               the ground floor's top, and the next one up
       shaftRects, keepRects   the stair core, the lift, the stair mouth
     and what its own dressers do with the public hall: a lobby desk square to
     the door with a feature wall behind it, all inside the first 8 m
     (interior_programs.js progLobby), and a back-of-house wall 5.5 m off the
     far wall with a doorway in its middle (buildings.js BACK_OF_HOUSE).
     The chamber takes what is left: from behind the lobby's feature wall to
     the back-of-house wall, bench at the back, facing the door. The board
     stands on its own wall a stride in front of that doorway, so the back
     office is still reached round it. Records go on the side the building
     has NOT put its stairs and lift.
     On the dev pad (no building) the same room stands on open ground.
     ---------------------------------------------------------------------- */
  function siteRoom(venue) {
    const lot = venue.lot, b = lot && lot.building, d = b && b.localDoor;
    const o = { th: 0, cx: 0, cz: 0, fy: 0, clear: 2.84, hx: 10, hz: 4.8, backGap: 0.12, S: 1 };
    let rects = [];
    if (b && d && (d.nx || d.nz) && b.w && b.d) {
      const nx = Math.round(d.nx), nz = Math.round(d.nz), along = Math.abs(nx) > 0.5;
      const depth = along ? b.w : b.d, width = along ? b.d : b.w, wt = b.wt != null ? b.wt : 0.4;
      const walled = depth >= 13 && width >= 8;          // buildings.js: the back-of-house wall stands
      const uBack = walled ? depth - 5.6 : depth - wt - 0.05;   // metres in from the door face
      const Dc = clampNum(7.4, 11, uBack - 8.4);         // 8.4: past the lobby desk and its feature wall
      o.hz = Dc / 2; o.hx = clampNum(6, 11, width / 2 - wt - 0.25);
      o.backGap = (walled && Dc >= 8.6) ? 1.25 : 0.12;
      const off = -depth / 2 + uBack - o.hz, bx = (b.ox || 0) - lot.cx, bz = (b.oz || 0) - lot.cz;
      o.cx = bx + nx * off; o.cz = bz + nz * off;
      o.th = Math.atan2(-nx, -nz);                       // the room's +z looks back at the door
      const ft = b.floorTops;
      if (ft && ft.length) { o.fy = ft[0] || 0; if (ft.length > 1) o.clear = clampNum(2.5, 3.2, ft[1] - o.fy - 0.22); }
      rects = (b.shaftRects || []).concat(b.keepRects || []).map(function (r) { return { x0: r.x0 + bx, x1: r.x1 + bx, z0: r.z0 + bz, z1: r.z1 + bz }; });
    } else if (lot) {
      o.hx = clampNum(6, 11, lot.w / 2 - 1.6);
    }
    o.c = Math.cos(o.th); o.s = Math.sin(o.th);
    // which side has the building's stairs and lift on it
    const load = [0, 0];
    const toRoom = function (lx, lz) { const dx = lx - o.cx, dz = lz - o.cz; return [dx * o.c - dz * o.s, dx * o.s + dz * o.c]; };
    for (let i = 0; i < rects.length; i++) {
      const a = toRoom(rects[i].x0, rects[i].z0), e = toRoom(rects[i].x1, rects[i].z1);
      const x0 = Math.min(a[0], e[0]), x1 = Math.max(a[0], e[0]);
      const z0 = Math.max(-o.hz, Math.min(a[1], e[1])), z1 = Math.min(o.hz, Math.max(a[1], e[1]));
      if (z1 <= z0) continue;
      if (x1 > 4) load[1] += (x1 - Math.max(4, x0)) * (z1 - z0);
      if (x0 < -4) load[0] += (Math.min(-4, x1) - x0) * (z1 - z0);
    }
    const S = o.S = load[1] > load[0] ? -1 : 1;          // records side
    // ---- the plan, in room metres (+z toward the door, back wall at -hz) ----
    const zb = -o.hz;
    o.zFrame = zb + o.backGap;                           // the board's wall
    o.zSeat = o.zFrame + 1.25;                           // the middle chair
    o.zBench = o.zSeat + 0.88;
    o.zLect = o.zBench + 3.0;
    o.gap = clampNum(1.25, 1.6, (2 * o.hx - 6) / COUNCIL_N);   // chair to chair
    o.BL = o.gap * COUNCIL_N;                            // the bench's length
    const end = o.BL / 2;
    o.boardY = o.clear - 0.08 - BOARD_H / 2;
    o.partX = S * (end + 0.55); o.partZ0 = o.zFrame - 0.2; o.partZ1 = o.zBench + 0.2;
    o.reg = { x: o.partX + S * 0.5, z: o.zSeat + 0.3 };                    // the gift register's desk
    o.shelfX = S * (o.hx - 0.75);
    o.shelfZ = []; for (let i = 0; i < 5; i++) o.shelfZ.push(zb + 1.0 + i * ((2 * o.hz - 2.0) / 4));
    o.sup = {
      survey:  { x: S * Math.min(o.hx - 3.4, end + 1.9), z: zb + 0.42 },
      gavel:   { x: 1.9, z: o.zLect - 0.2 },
      polling: { x: -S * (end + 0.9), z: o.zBench - 0.2 },
      bourbon: { x: -S * 4.6, z: o.hz - 0.5 },
    };
    o.shred = { x: -S * (end + 0.7), z: zb + 0.45 };
    o.guardDesk = { x: -S * Math.min(o.hx - 3.1, end + 2.3), z: o.hz - 0.8 };
    o.guard = { x: o.guardDesk.x + S * 0.5, z: o.guardDesk.z };
    o.reporter = { x: S * Math.min(o.hx - 1.9, end - 0.4), z: o.zLect + 1.7 };
    o.press = { x: o.reporter.x + S * 0.9, z: o.reporter.z };
    o.clerk = { x: S * Math.min(o.hx - 1.6, 6.4), z: o.hz + 2.5 };
    return o;
  }

  /* ======================= THE FURNITURE ==================================
     Real furniture in real metres on the merged store fixture kit
     (city/gunstore.js), so the whole room is a handful of draw calls: the
     panelled council bench with nameplates, blotters and gooseneck mics; the
     carpeted dais; tufted high-back chairs; the Speaker's lectern with the
     city seal and the gavel; the board's walnut wall; shelving with archive
     boxes and binders; two-door cabinets; the clerk's counter under a brass-
     framed barred glass; the press table; the security desk; the records desk
     with the gift register; a real office shredder. */
  function dressChamber(ctx, R) {
    const K = CBZ.storeFixtureKit;
    if (!K) return;
    const k = K.create();
    const W = 0x4a3826, WD = 0x2e2216, BR = 0xc9a24a, LEA = 0x5a1a1e, LEAd = 0x3a0e12;
    const S = L.S, BL = L.BL, bz = L.zBench;
    // ---- the bench: a panelled desk the councillors sit behind (front = +z) --
    k.frame(0, 0, bz, 0);
    K.dressCounter(k, BL, 0.66, 0.92, 0, { clad: W, trim: BR, work: 0x2a1c12, kick: 0x1a120c, cladKind: "gloss" });
    const panels = Math.max(2, Math.round(BL / 1.1));
    for (let i = 0; i < panels; i++) {                                     // raised panels on the room face
      const x = -BL / 2 + (i + 0.5) * (BL / panels);
      k.box(x, 0.5, 0.345, BL / panels - 0.16, 0.56, 0.02, 0x553f2a, "gloss");
      k.box(x, 0.5, 0.357, BL / panels - 0.26, 0.46, 0.006, W, "gloss");
    }
    // ---- the dais under the chairs (carpet top, wood nosing) ---------------
    k.frame(0, 0, L.zSeat + 0.15, 0);
    k.box(0, DAIS_H / 2 - 0.01, 0, BL, DAIS_H - 0.02, 1.5, WD, "gloss");
    k.box(0, DAIS_H - 0.01, 0, BL - 0.04, 0.02, 1.46, 0x4a1418);
    k.cyl(0, DAIS_H - 0.02, 0.75, 0.03, 0.03, BL, 0x553f2a, "gloss", 0, 0, Math.PI / 2, 8);
    // ---- each seat: chair, nameplate, blotter, mic --------------------------
    for (let i = 0; i < COUNCIL_N; i++) {
      const s = V.seats[i];
      k.frame(s.x, DAIS_H, s.z, 0);                                         // the chair faces +z
      const SH = COUNCIL_SEAT_H;
      for (const dx of [-0.25, 0.25]) for (const dz of [-0.23, 0.23]) {
        k.cyl(dx, (SH - 0.12) / 2, dz, 0.025, 0.03, SH - 0.12, WD, "gloss", 0, 0, 0, 8);
        k.cyl(dx, 0.02, dz, 0.032, 0.032, 0.04, BR, "metal", 0, 0, 0, 8);   // brass ferrules
      }
      k.box(0, SH - 0.1, 0, 0.6, 0.06, 0.58, WD, "gloss");                  // seat frame
      k.box(0, SH - 0.045, 0.01, 0.6, 0.09, 0.56, LEA, "gloss");            // cushion
      k.box(0, SH + 0.45, -0.27, 0.64, 0.86, 0.1, LEA, "gloss", -0.08);     // the high back
      k.cyl(0, SH + 0.88, -0.3, 0.05, 0.05, 0.66, WD, "gloss", 0, 0, Math.PI / 2, 10);   // crest rail
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++)               // buttoned tufting
        k.cyl(-0.21 + c * 0.14, SH + 0.2 + r * 0.22, -0.215 + r * 0.018, 0.014, 0.014, 0.01, LEAd, "gloss", Math.PI / 2 - 0.08, 0, 0, 6);
      for (const dx of [-1, 1]) {
        k.box(dx * 0.34, 0.69, 0.02, 0.07, 0.05, 0.52, WD, "gloss");        // arm (0.69 above the dais)
        k.box(dx * 0.34, 0.715, 0.02, 0.075, 0.025, 0.46, LEA, "gloss");    // arm pad
        k.cyl(dx * 0.34, 0.56, 0.22, 0.022, 0.022, 0.26, WD, "gloss", 0, 0, 0, 8);   // arm post
      }
      // on the bench in front of him: blotter, brass nameplate, a gooseneck mic
      k.frame(s.x, 0, bz, 0);
      k.box(0, 0.965, -0.06, 0.62, 0.006, 0.4, 0x1a3a2a);
      k.box(0, 0.98, 0.18, 0.36, 0.06, 0.012, BR, "metal", -0.35);
      k.cyl(0.22, 0.97, 0.12, 0.045, 0.05, 0.02, 0x1a1c20, "metal", 0, 0, 0, 12);
      k.cyl(0.22, 1.1, 0.06, 0.006, 0.006, 0.28, 0x1a1c20, "metal", -0.45, 0, 0, 6);
      k.cyl(0.22, 1.22, -0.02, 0.014, 0.012, 0.05, 0x1a1c20, "metal", -1.2, 0, 0, 8);
      k.sphere(0.22, 1.215, 0.005, 0.006, 0xff3a2a, "glow");               // the mic's light
    }
    // ---- the board's wall: walnut, a brass rail, the city seal --------------
    k.frame(0, 0, L.zFrame, 0);
    k.box(0, L.clear / 2, -0.09, 5.5, L.clear - 0.04, 0.06, WD, "gloss");
    k.box(0, 0.95, -0.055, 5.5, 0.06, 0.03, BR, "metal");
    k.cyl(2.34, L.boardY, -0.045, 0.3, 0.3, 0.03, BR, "metal", Math.PI / 2, 0, 0, 28);        // the seal
    k.cyl(2.34, L.boardY, -0.028, 0.22, 0.22, 0.012, 0x1f3a6a, "solid", Math.PI / 2, 0, 0, 24);
    k.torus(2.34, L.boardY, -0.02, 0.26, 0.008, 0xe8dcb0, "metal", 0, 0, 0, null, 28);
    k.torus(-2.34, L.boardY, -0.03, 0.31, 0.02, BR, "metal", 0, 0, 0, null, 32);                // the dial's rim
    // ---- the lectern: the Speaker behind it, the seal to the room ------------
    k.frame(0, 0, L.zLect, 0);
    k.box(0, 0.04, 0, 0.95, 0.08, 0.72, 0x1a120c);
    k.box(0, 0.55, 0, 0.82, 0.95, 0.6, W, "gloss");
    k.box(0, 0.55, 0.305, 0.66, 0.78, 0.02, 0x553f2a, "gloss");
    k.cyl(0, 0.62, 0.32, 0.17, 0.17, 0.02, BR, "metal", Math.PI / 2, 0, 0, 28);
    k.cyl(0, 0.62, 0.332, 0.12, 0.12, 0.012, 0x1f3a6a, "solid", Math.PI / 2, 0, 0, 24);
    k.torus(0, 0.62, 0.34, 0.145, 0.006, 0xe8dcb0, "metal", 0, 0, 0, null, 28);
    k.box(0, 1.08, -0.04, 0.95, 0.05, 0.72, BR, "metal", -0.18);            // the slanted top, low side to him
    k.box(0, 1.105, -0.05, 0.6, 0.006, 0.42, 0x1a3a2a, "solid", -0.18);
    k.box(0.32, 1.12, -0.2, 0.12, 0.03, 0.12, WD, "gloss");                  // the gavel block
    k.cyl(0.32, 1.165, -0.2, 0.028, 0.028, 0.11, WD, "gloss", 0, 0, Math.PI / 2, 10);   // gavel head
    k.cyl(0.32, 1.16, -0.09, 0.01, 0.012, 0.2, 0x553f2a, "gloss", Math.PI / 2, 0, 0, 8);
    // ---- the records side: a partition (plaster over a wood dado) -----------
    {
      const len = L.partZ1 - L.partZ0, ph = Math.min(2.6, L.clear - 0.05);
      k.frame(L.partX, 0, (L.partZ0 + L.partZ1) / 2, 0);
      k.box(0, ph / 2, 0, 0.25, ph, len, 0xb8b0a0);
      for (const e of [-1, 1]) {
        k.box(e * 0.13, 0.5, 0, 0.012, 1.0, len, W, "gloss");
        k.box(e * 0.135, 1.0, 0, 0.02, 0.05, len, WD, "gloss");
        k.box(e * 0.135, 0.06, 0, 0.02, 0.12, len, WD, "gloss");
      }
    }
    // the records desk against it: a clerk's standing desk, the gift register
    // open on its slope, a brass lamp (the page you tear out is its own mesh)
    k.frame(L.reg.x, 0, L.reg.z, S * Math.PI / 2);                           // local +z = where you stand
    k.box(0, 0.04, 0, 0.86, 0.08, 0.5, 0x1a120c);
    k.box(0, 0.52, 0, 0.8, 0.9, 0.44, W, "gloss");
    k.box(0, 0.5, 0.225, 0.62, 0.7, 0.012, 0x553f2a, "gloss");
    k.box(0, 1.03, 0.02, 0.88, 0.04, 0.54, WD, "gloss", 0.2);                // the slope, low side to you
    k.box(-0.17, 1.065, 0.03, 0.3, 0.03, 0.4, 0xefe8d2, "solid", 0.2);       // the register's left leaf
    k.box(0.17, 1.065, 0.03, 0.3, 0.03, 0.4, 0xe8e0c8, "solid", 0.2);        // and its right
    k.box(0, 1.058, 0.03, 0.66, 0.02, 0.44, 0x4a1418, "gloss", 0.2);         // its oxblood boards
    k.box(0, 1.085, 0.03, 0.012, 0.012, 0.4, 0x8a1f2b, "solid", 0.2);        // the ribbon in the gutter
    k.cyl(-0.34, 1.1, -0.2, 0.04, 0.05, 0.02, BR, "metal", 0, 0, 0, 12);
    k.cyl(-0.34, 1.22, -0.2, 0.007, 0.007, 0.24, BR, "metal", 0, 0, 0, 6);
    k.cyl(-0.3, 1.34, -0.16, 0.05, 0.08, 0.07, 0x2a5a3a, "gloss", 0.5, 0, 0, 12);   // banker's shade
    k.cyl(-0.3, 1.32, -0.15, 0.03, 0.05, 0.02, 0xffe2a0, "glow", 0.5, 0, 0, 10);
    // the shelving: steel uprights, five shelves, archive boxes and binders
    for (let i = 0; i < L.shelfZ.length; i++) {
      k.frame(L.shelfX, 0, L.shelfZ[i], -S * Math.PI / 2);                   // faces the aisle
      for (const e of [-1, 1]) k.box(e * 0.465, 1.05, 0, 0.03, 2.1, 0.42, 0x5a5e66, "metal");
      k.box(0, 1.05, -0.2, 0.93, 2.1, 0.01, 0x3a3e46, "metal");
      for (let sh = 0; sh < 5; sh++) {
        const y = 0.1 + sh * 0.48;
        k.box(0, y, 0, 0.93, 0.025, 0.42, 0x6a6e76, "metal");
        if (sh === 4) continue;
        let x = -0.42, n = 0;
        while (x < 0.4 && n < 8) {
          const r = ctx.rand(i * 11 + sh, n, "shelfgoods");
          if (r < 0.55) {                                                   // a bankers box with its lid and hand hole
            const w = 0.3;
            if (x + w > 0.44) break;
            k.box(x + w / 2, y + 0.14, 0.01, w - 0.01, 0.25, 0.38, 0xc8b48a);
            k.box(x + w / 2, y + 0.27, 0.01, w + 0.004, 0.03, 0.385, 0xb8a47a);
            k.box(x + w / 2, y + 0.2, 0.2, 0.08, 0.03, 0.004, 0x3a2e1c);
            x += w + 0.01;
          } else {                                                          // a run of binders
            const nb = 3 + Math.floor(r * 4);
            for (let b = 0; b < nb && x < 0.4; b++) {
              const col = [0x1f3a6a, 0x6e1524, 0x2a2a2a, 0x2a5a3a][(b + sh + i) % 4];
              k.box(x + 0.03, y + 0.17, 0.02, 0.05, 0.31, 0.28, col);
              k.box(x + 0.03, y + 0.2, 0.161, 0.03, 0.06, 0.002, 0xe8e4d8);
              x += 0.055;
            }
            x += 0.02;
          }
          n++;
        }
      }
    }
    // ---- cabinets: two-door walnut with brass pulls (front = +z) -------------
    for (const id in L.sup) {
      const p = L.sup[id];
      k.frame(p.x, 0, p.z, 0);
      k.box(0, 0.05, 0, 0.66, 0.1, 0.56, 0x1a120c);
      k.box(0, 0.72, 0, 0.7, 1.24, 0.6, W, "gloss");
      k.box(0, 1.37, 0, 0.76, 0.06, 0.66, WD, "gloss");                      // top
      for (const e of [-1, 1]) {
        k.box(e * 0.17, 0.74, 0.302, 0.32, 1.12, 0.012, 0x553f2a, "gloss");  // door
        k.box(e * 0.17, 0.74, 0.31, 0.24, 1.0, 0.006, W, "gloss");           // its raised panel
        k.cyl(e * 0.025, 0.82, 0.325, 0.008, 0.008, 0.14, BR, "metal", 0, 0, 0, 6);   // pull
      }
      k.box(0, 0.74, 0.304, 0.006, 1.12, 0.012, 0x1a120c);                   // the door gap
    }
    // ---- the clerk's window (you stand on the door side, +z) -----------------
    {
      k.frame(L.clerk.x, 0, L.clerk.z, 0);
      const top = K.dressCounter(k, 1.9, 0.6, 1.1, 0, { clad: W, trim: BR, work: 0x8a8e94, kick: 0x1a120c, cladKind: "gloss" });
      k.box(0, top + 0.47, 0.05, 1.86, 0.86, 0.012, 0, "glass");
      k.box(0, top + 0.92, 0.05, 1.96, 0.06, 0.06, BR, "metal");
      for (const e of [-1, 1]) k.box(e * 0.95, top + 0.47, 0.05, 0.05, 0.94, 0.06, BR, "metal");
      for (let bi = 0; bi < 7; bi++) k.cyl(-0.78 + bi * 0.26, top + 0.47, 0.09, 0.012, 0.012, 0.86, BR, "metal", 0, 0, 0, 6);
      k.box(0, top + 0.02, 0.08, 0.36, 0.03, 0.26, 0x6a6e74, "metal");       // the deal tray under the glass
      k.cyl(0, top + 0.32, 0.06, 0.07, 0.07, 0.02, 0x6a6e74, "metal", Math.PI / 2, 0, 0, 16);   // speaking grille
      k.box(0, top + 1.04, 0.05, 1.0, 0.2, 0.03, 0x1f3a6a);                  // the sign band over it (lettered in build)
      K.till(k, 0.55, top, 0.6);
    }
    // ---- the press table: folding table, recorders, a notepad, a laptop ----
    {
      k.frame(L.press.x, 0, L.press.z, -S * Math.PI / 2);                    // local +z = the reporter
      k.box(0, 0.74, 0, 1.6, 0.03, 0.5, 0xd8d6d0);
      k.box(0, 0.7, 0, 1.5, 0.05, 0.44, 0x9a9ea4, "metal");
      for (const e of [-1, 1]) for (const f of [-1, 1]) k.cyl(e * 0.72, 0.36, f * 0.2, 0.014, 0.014, 0.72, 0x9a9ea4, "metal", 0, 0, 0, 6);
      for (let i = 0; i < 3; i++) {
        k.box(-0.5 + i * 0.16, 0.77, 0.1, 0.06, 0.02, 0.11, 0x1a1c20, "gloss", 0, 0.2 * (i - 1), 0);
        k.box(-0.5 + i * 0.16, 0.782, 0.08, 0.03, 0.003, 0.02, 0xff4a2a, "glow", 0, 0.2 * (i - 1), 0);
      }
      k.box(0.05, 0.758, 0.04, 0.16, 0.006, 0.22, 0xf2eedc);
      k.box(0.45, 0.762, 0.02, 0.33, 0.014, 0.23, 0x2a2d33, "metal");
      k.box(0.45, 0.88, -0.1, 0.33, 0.22, 0.012, 0x2a2d33, "metal", 0.25);
      k.box(0.45, 0.88, -0.092, 0.3, 0.19, 0.003, 0x3a5a7a, "glow", 0.25);
    }
    // ---- the security desk: counter + two CCTV monitors (the guard's side = the room)
    {
      k.frame(L.guardDesk.x, 0, L.guardDesk.z, S * Math.PI / 2);
      const top = K.dressCounter(k, 2.0, 0.5, 1.06, 0, { clad: WD, trim: BR, work: 0x1d1e21, kick: 0x111214 });
      for (const e of [-0.45, 0.45]) {
        k.box(e, top + 0.02, 0.05, 0.2, 0.02, 0.14, 0x1a1c20, "metal");
        k.box(e, top + 0.22, 0.05, 0.46, 0.3, 0.04, 0x1a1c20, "metal", -0.1);
        k.box(e, top + 0.22, 0.073, 0.42, 0.26, 0.003, 0x4a6a5a, "glow", -0.1);
      }
    }
    // ---- the shredder (front = +z): bin, head unit, feed slot, status LEDs ---
    {
      k.frame(L.shred.x, 0, L.shred.z, 0);
      for (const e of [-1, 1]) for (const f of [-1, 1]) k.cyl(e * 0.24, 0.03, f * 0.21, 0.025, 0.025, 0.04, 0x111214, "solid", Math.PI / 2, 0, 0, 8);
      k.box(0, 0.42, 0, 0.58, 0.74, 0.52, 0x3a3e46, "gloss");
      k.box(0, 0.45, 0.262, 0.4, 0.3, 0.004, 0, "glass");                    // the bin's window
      k.box(0, 0.38, 0.258, 0.38, 0.16, 0.003, 0xe8e4d8);                    // confetti in it
      k.box(0, 0.86, 0, 0.62, 0.14, 0.56, 0x16181d, "gloss");                // head unit
      k.box(0, 0.932, 0.05, 0.36, 0.004, 0.012, 0x050506);                   // the feed slot
      for (let i = 0; i < 2; i++) k.box(-0.2 + i * 0.05, 0.931, 0.2, 0.025, 0.004, 0.012, [0x3aff6a, 0xffb43a][i], "glow");
      k.box(0.2, 0.93, 0.2, 0.08, 0.008, 0.04, 0x2a2d33, "metal");
    }
    const fix = new THREE.Group(); fix.name = "chamber-fixtures";
    k.build(fix); R.add(fix);
  }

  // WHAT A MEMBER WANTS, STANDING ON ITS CABINET: four small things you can
  // pick up and set down. Each is its own group, so it can leave the cabinet
  // in your hand and come to rest on a bench.
  function buildItems(R) {
    const K = CBZ.storeFixtureKit;
    V.items = {};
    if (!K) return;
    const BR = 0xc9a24a;
    const make = {
      bourbon: function (k) {
        k.box(0, 0.09, 0, 0.36, 0.18, 0.26, 0x6a4a2a, "gloss");                // the crate
        k.box(0, 0.185, 0, 0.38, 0.012, 0.28, 0x553f2a, "gloss");
        k.box(0, 0.1, 0.132, 0.2, 0.08, 0.004, 0xe8dcb0);                      // its label
        for (let i = 0; i < 3; i++) {
          k.cyl(-0.11 + i * 0.11, 0.25, 0, 0.018, 0.018, 0.12, 0x3a1a0a, "gloss", 0, 0, 0, 8);   // three necks
          k.cyl(-0.11 + i * 0.11, 0.315, 0, 0.02, 0.02, 0.02, BR, "metal", 0, 0, 0, 8);
        }
      },
      survey: function (k) {
        k.cyl(0, 0.05, 0, 0.05, 0.05, 0.44, 0x1f3a6a, "gloss", 0, 0, Math.PI / 2, 14);  // a map tube on its side
        for (const e of [-1, 1]) k.cyl(e * 0.225, 0.05, 0, 0.054, 0.054, 0.02, BR, "metal", 0, 0, Math.PI / 2, 14);
        k.cyl(0, 0.102, 0, 0.03, 0.03, 0.006, 0x8a1f2b, "gloss", 0, 0, 0, 12);         // the wax seal
      },
      gavel: function (k) {
        k.box(0, 0.025, 0, 0.3, 0.05, 0.16, 0x1a120c, "gloss");                // its plinth
        k.box(0, 0.052, 0.07, 0.16, 0.004, 0.02, BR, "metal");                 // the plaque
        k.cyl(0, 0.11, 0, 0.035, 0.035, 0.13, BR, "metal", 0, 0, Math.PI / 2, 12);     // the head
        k.cyl(0.02, 0.085, 0.09, 0.011, 0.014, 0.24, BR, "metal", Math.PI / 2 - 0.25, 0, 0, 8);
      },
      polling: function (k) {
        k.box(0, 0.03, 0, 0.26, 0.06, 0.34, 0xd8b878);                        // a fat manila packet
        k.box(0, 0.062, 0, 0.27, 0.004, 0.02, 0x8a1f2b);                       // a red band round it
        k.box(0, 0.063, -0.08, 0.16, 0.003, 0.08, 0xf2eedc);                   // the cover sheet
      },
    };
    for (const id in L.sup) {
      const p = L.sup[id], k = K.create(), grp = new THREE.Group();
      grp.name = "want-" + id;
      k.frame(0, 0, 0, 0);
      make[id](k);
      k.build(grp);
      grp.position.set(p.x, 1.4, p.z + 0.02);
      grp.userData.mover = true;
      R.add(grp);
      V.items[id] = { grp: grp, home: grp.position.clone() };
    }
  }

  function build(ctx, venue) {
    C = ctx;
    const g = venue.group;
    L = siteRoom(venue);
    g.position.y = L.fy;                                 // the hall's own floor, not the lot's ground
    const R = new THREE.Group(); R.name = "chamber";
    R.position.set(L.cx, 0, L.cz); R.rotation.y = L.th;
    g.add(R);
    V = { _venue: venue, R: R, cast: false, realCount: 0, seats: [], seatMeta: [], seatRecs: [], shelves: [], waypoints: [], wpIdx: 0, guardAlertT: 0, handA: -1, items: {} };
    const hx = L.hx, hz = L.hz, S = L.S;

    if (venue.kind === "dev") {   // dev pad: the harness mounts us on bare ground
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2 + 6, hz * 2 + 12), ctx.pmat(0x1a2029, 4));
      pad.rotation.x = -Math.PI / 2; pad.position.set(0, 0.02, 2); R.add(pad);
    }

    // ---- seats + the seeded puzzle (deterministic: ctx.rand only) ----
    const mid = (COUNCIL_N - 1) / 2;
    for (let i = 0; i < COUNCIL_N; i++) {
      V.seats.push({ x: (i - mid) * L.gap, z: L.zSeat + Math.abs(i - mid) * 0.14 });
      V.seatMeta.push({
        want: WANT_ITEMS[Math.floor(ctx.rand(i, 1, "want") * WANT_ITEMS.length)],
        fear: FEARS[Math.floor(ctx.rand(i, 3, "fear") * FEARS.length)],
        baseStance: "against",     // overwritten by the seeded shuffle below
      });
    }
    // starting whip count: a losing-but-winnable multiset (2 for / 3 against /
    // 2 undecided), shuffled deterministically across the seats.
    const base = ["against", "against", "against", "for", "for", "undecided", "undecided"];
    for (let k = base.length - 1; k > 0; k--) { const j = Math.floor(ctx.rand(k, 5, "shuf") * (k + 1)); const tmp = base[k]; base[k] = base[j]; base[j] = tmp; }
    for (let i = 0; i < COUNCIL_N; i++) V.seatMeta[i].baseStance = base[i] || "against";
    const against = []; for (let i = 0; i < COUNCIL_N; i++) if (V.seatMeta[i].baseStance !== "for") against.push(i);

    // ---- the bench; each chair a REGISTERED SEAT on the dais (CBZ.propSit
    //      puts the real chair solve in charge of the body: cushion
    //      COUNCIL_SEAT_H above the dais, kind "throne" for a high-backed
    //      armchair) ----
    solid(-L.BL / 2 - 0.05, L.zBench - 0.42, L.BL / 2 + 0.05, L.zBench + 0.42);
    for (let i = 0; i < COUNCIL_N; i++) {
      const s = V.seats[i], w = worldOf(s.x, s.z);
      let rec = null;
      if (CBZ.propRegisterSeat) {
        try { rec = CBZ.propRegisterSeat(w.x, L.fy + DAIS_H, w.z, L.th, "throne", venue.lot || null, { cushion: COUNCIL_SEAT_H, floorBelow: 0 }); } catch (e) { rec = null; }
      }
      V.seatRecs.push(rec);
    }

    // ---- THE BOARD on its wall behind the bench: a slab with air behind it,
    //      one fresh material carrying the map AND the emissiveMap (never
    //      ctx.mat/ctx.emat: those are shared world-wide by colour) ----
    const frameD = 0.12, frameFace = L.zFrame + frameD / 2;
    V.frameMesh = ctx.box(R, 0, L.boardY, L.zFrame, BOARD_W + 0.24, BOARD_H + 0.24, frameD, ctx.mat(0x11161d));
    V.board = C.canvasTexLive(BOARD_CW, BOARD_CH);
    srgb(V.board.tex);
    const bmat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: V.board.tex, emissive: 0xffffff, emissiveMap: V.board.tex, emissiveIntensity: BOARD_EI });
    const bmesh = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W, BOARD_H, BOARD_T), bmat);
    bmesh.position.set(0, L.boardY, frameFace + BOARD_GAP + BOARD_T / 2);
    bmesh.castShadow = false; bmesh.receiveShadow = false;
    R.add(bmesh);
    V.boardMesh = bmesh;
    V.screens = [bmesh];
    solid(-2.75, L.zFrame - 0.14, 2.75, L.zFrame + 0.08);

    // ---- THE SESSION CLOCK beside it: a dial whose one hand goes once round
    //      in an evening and is at the top when the gavel falls ----
    {
      const face = new THREE.Mesh(new THREE.CircleGeometry(0.3, 40), new THREE.MeshLambertMaterial({
        color: 0xffffff, map: srgb(ctx.canvasTex(256, 256, function (cc, w, h) {
          cc.fillStyle = "#f2ecd8"; cc.fillRect(0, 0, w, h);
          cc.translate(w / 2, h / 2);
          cc.fillStyle = "#a3261f"; cc.beginPath(); cc.moveTo(0, 0); cc.arc(0, 0, 112, -Math.PI / 2 - Math.PI / 4, -Math.PI / 2); cc.closePath(); cc.fill();   // the last half minute
          cc.strokeStyle = "#1a1a1a";
          for (let i = 0; i < 16; i++) {
            const a = i * Math.PI / 8, big = i % 4 === 0;
            cc.lineWidth = big ? 7 : 3; cc.beginPath();
            cc.moveTo(Math.sin(a) * (big ? 92 : 102), -Math.cos(a) * (big ? 92 : 102)); cc.lineTo(Math.sin(a) * 116, -Math.cos(a) * 116); cc.stroke();
          }
          cc.fillStyle = "#1a1a1a"; cc.textAlign = "center"; cc.textBaseline = "middle"; cc.font = "700 34px Georgia, serif";
          cc.fillText("3", 70, 2); cc.fillText("2", 0, 72); cc.fillText("1", -70, 2);
          cc.font = "700 17px Georgia, serif"; cc.fillText("VOTE", 0, -66);
          cc.font = "600 12px Georgia, serif"; cc.fillText("MINUTES LEFT", 0, 34);
        })) }));
      face.position.set(-2.34, L.boardY, L.zFrame - 0.045);
      R.add(face);
      const hg = new THREE.BoxGeometry(0.024, 0.25, 0.012); hg.translate(0, 0.1, 0);
      const hand = new THREE.Mesh(hg, ctx.mat(0x14100c));
      hand.position.set(-2.34, L.boardY, L.zFrame - 0.03);
      hand.userData.mover = true;
      R.add(hand);
      ctx.cyl(R, -2.34, L.boardY, L.zFrame - 0.028, 0.022, 0.022, 0.02, ctx.mat(0xb9922e), 12).rotation.x = Math.PI / 2;
      V.hand = hand;
    }

    // ---- THE LECTERN, where the Speaker stands and the session is run ----
    solid(-0.5, L.zLect - 0.36, 0.5, L.zLect + 0.36);
    zone({ id: "session", name: "Speaker's lectern", pos: [0, L.zLect + 1.15], at: [0, L.zLect], y: 1.25, r: 1.7,
      verbs: spotVerbs(SPEAKER_ASKS, function () { return V.speaker; }) });

    // ---- a member, across the bench from his seat ----
    for (let i = 0; i < COUNCIL_N; i++) {
      (function (i) {
        const s = V.seats[i];
        zone({ id: "seat" + i, name: function () { const m = COUNCIL[i]; return m ? m.name : "The council bench"; },
          note: function () { const m = COUNCIL[i]; return m ? m.title : ""; },
          pos: [s.x, L.zBench + 0.95], at: [s.x, s.z], y: DAIS_H + 1.35, r: Math.min(0.85, L.gap * 0.55),
          verbs: spotVerbs(memberAsks(i), function () { const m = COUNCIL[i]; return m && m.handle; }) });
      })(i);
    }

    // ---- the records side: partition, the gift register's desk, the shelves ----
    solid(L.partX - 0.15, L.partZ0, L.partX + 0.15, L.partZ1);
    solid(L.reg.x - 0.26, L.reg.z - 0.44, L.reg.x + 0.26, L.reg.z + 0.44);
    {
      // the page with your envelopes on it: lies on the register until you tear it out
      const dg = new THREE.Group(); dg.position.set(L.reg.x, 0, L.reg.z); dg.rotation.y = S * Math.PI / 2; R.add(dg);
      const pg = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.004, 0.36), ctx.mat(0xfff8e0));
      pg.position.set(0.17, 1.088, 0.03); pg.rotation.x = 0.2;
      const ink = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.005, 0.03), ctx.mat(0xa3261f));
      ink.position.set(0, 0.001, -0.08); pg.add(ink);
      pg.visible = false; dg.add(pg);
      V.pageMesh = pg;
    }
    zone({ id: "register", name: "Gift register",
      note: function () { return G.ledger.length ? "A page with your envelopes on it" : (G.torn.length ? "A page is missing" : "Nothing entered tonight"); },
      pos: [L.reg.x + S * 0.95, L.reg.z], at: [L.reg.x, L.reg.z], y: 1.2, r: 1.2,
      verbs: [{ id: "tear", label: function () { return asIs("Tear out the page"); },
        canShow: function () { return G.ledger.length > 0; },
        onSelect: function () { const w = worldPt(L.reg.x + S * 0.1, 1.1, L.reg.z); reachFor({ x: w.x, y: w.y, z: w.z, kind: "card" }, tearPage); } }] });
    for (let i = 0; i < L.shelfZ.length; i++) {
      const z = L.shelfZ[i];
      solid(L.shelfX - 0.26, z - 0.5, L.shelfX + 0.26, z + 0.5);
      const hasDirt = ctx.rand(i, 9, "sd") < 0.62;
      V.shelves.push({ searched: false, member: hasDirt ? against[Math.floor(ctx.rand(i, 10, "sm") * against.length)] : -1, line: DIRT_LINES[Math.floor(ctx.rand(i, 11, "sl") * DIRT_LINES.length)] });
      (function (i, z) {
        zone({ id: "shelf" + i, name: "City records", note: function () { return V.shelves[i].searched ? "Shelf " + (i + 1) + ", gone through" : "Shelf " + (i + 1); },
          pos: [L.shelfX - S * 1.0, z], at: [L.shelfX, z], y: 1.3, r: 0.95,
          verbs: [
            { id: "search", label: function () { return asIs("Search"); },
              canShow: function () { return G.active && !V.shelves[i].searched; },
              onSelect: function () { const w = worldPt(L.shelfX - S * 0.2, 1.2, z); reachFor({ x: w.x, y: w.y, z: w.z, kind: "card" }, function () { searchShelf(i); shelfPaper(i); }); } },
            { id: "read", label: function () { return asIs("Read the file"); },
              canShow: function () { const sh = V.shelves[i], m = sh.member >= 0 ? COUNCIL[sh.member] : null; return sh.searched && !!m && !!G.dirt[m.key]; },
              onSelect: function () { shelfPaper(i); } },
          ] });
      })(i, z);
    }

    // ---- the cabinets, and on each the thing a member wants ----
    buildItems(R);
    for (const id in L.sup) {
      (function (id, p) {
        const it = WANT_ITEMS.filter(function (w) { return w.id === id; })[0];
        solid(p.x - 0.38, p.z - 0.33, p.x + 0.38, p.z + 0.33);
        zone({ id: "supply_" + id, name: it.title, pos: [p.x, p.z + 0.9], at: [p.x, p.z], y: 1.55, r: 1.1,
          verbs: [{ id: "take", label: function () { return asIs("Take"); },
            canShow: function () { return G.active && !G.satchel[id] && !G.given[id]; },
            onSelect: function () { takeItem(id); } }] });
      })(id, L.sup[id]);
    }

    // ---- THE CLERK'S WINDOW, in the lobby beside the building's own desk ----
    solid(L.clerk.x - 1.0, L.clerk.z - 0.33, L.clerk.x + 1.0, L.clerk.z + 0.33);
    {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.16), new THREE.MeshBasicMaterial({ map: srgb(ctx.canvasTex(376, 64, function (cc, w, h) {
        cc.fillStyle = "#1f3a6a"; cc.fillRect(0, 0, w, h);
        cc.fillStyle = "#e8dcb0"; cc.textAlign = "center"; cc.textBaseline = "middle"; cc.font = "700 38px Georgia, serif";
        cc.fillText("CITY CLERK", w / 2, h / 2 + 2);
      })) }));
      sign.position.set(L.clerk.x, 1.14 + 1.04, L.clerk.z + 0.067);
      R.add(sign);
    }
    zone({ id: "clerkwindow", name: "Clerk's window",
      note: function () { return filed() ? "Your papers are on file" : (playerSeat() ? "The ballot" : "File for office here"); },
      pos: [L.clerk.x, L.clerk.z + 1.0], at: [L.clerk.x, L.clerk.z], y: 1.4, r: 1.4,
      verbs: spotVerbs(clerkAsks(), function () { return V.clerk; }) });

    // ---- the press table and the reporter ----
    solid(L.press.x - 0.28, L.press.z - 0.85, L.press.x + 0.28, L.press.z + 0.85);
    zone({ id: "reporter", name: "Press table", pos: [L.reporter.x - S * 1.0, L.reporter.z], at: [L.press.x, L.press.z], y: 1.1, r: 1.3,
      verbs: spotVerbs(PRESS_ASKS, function () { return V.reporter; }) });

    // ---- the security desk (the guard answers a jam) ----
    solid(L.guardDesk.x - 0.28, L.guardDesk.z - 1.05, L.guardDesk.x + 0.28, L.guardDesk.z + 1.05);

    // ---- THE SHREDDER: what you tore out of the register goes in here ----
    solid(L.shred.x - 0.33, L.shred.z - 0.3, L.shred.x + 0.33, L.shred.z + 0.3);
    {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.3, 0.004), ctx.mat(0xfff8e0));
      st.position.set(L.shred.x, 1.1, L.shred.z + 0.05); st.visible = false; st.userData.mover = true; R.add(st);
      V.strip = st; V.stripT = 0;
      const jl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.014), ctx.emat(0xff3a2a, 1));
      jl.position.set(L.shred.x - 0.1, 0.932, L.shred.z + 0.2); jl.visible = false; R.add(jl);
      V.jamLamp = jl;
    }
    zone({ id: "shredder", name: "Shredder",
      note: function () { return G.torn.length ? "The page is in your coat" : ""; },
      pos: [L.shred.x, L.shred.z + 0.9], at: [L.shred.x, L.shred.z], y: 1.05, r: 1.1,
      verbs: [{ id: "feed", label: function () { return asIs("Feed it the page"); },
        canShow: function () { return G.torn.length > 0; },
        onSelect: function () { const w = worldPt(L.shred.x, 0.95, L.shred.z + 0.05); setDown({ x: w.x, y: w.y, z: w.z, kind: "card" }, shredPage); } }] });

    // ---- the auditor's round: the records desk, the floor of the chamber,
    //      and back (out and home by the same way, so she never cuts the bench) ----
    const wa = { x: L.reg.x + S * 1.05, z: L.reg.z, desk: true }, wb = { x: S * 2.8, z: L.zLect + 2.9 };
    const wc = { x: -S * 3.4, z: L.zLect + 2.7 }, wd = { x: -S * (L.BL / 2 + 0.9), z: L.zBench + 1.5 };
    V.waypoints = [wa, wb, wc, wd, wc, wb];
    // a member's way back to his chair (tickSeats): out wide of the bench's
    // open end, then along the aisle between the chair backs and the board's wall
    const ex = -S * (L.BL / 2 + 1.9);
    V.wayIn = [{ x: ex, z: L.zBench + 0.7 }, { x: ex, z: L.zFrame + 0.5 }];

    dressChamber(ctx, R);

    // ---- lights (budget ≤ 8) ----
    const ly = L.clear - 0.25;
    light(0, ly, L.zBench + 1.6, 0xfff0d0, 0.95, 16);
    light(S * (L.BL / 2 + 2.6), ly, -0.5, 0xffe0b0, 0.7, 13);
    light(-S * (L.BL / 2 + 1.5), ly, 1.5, 0xffe0b0, 0.7, 13);
    light(0, ly, L.zFrame + 0.9, 0x9fd0ff, 0.5, 8);      // the board's wall
    light(L.clerk.x, ly, L.clerk.z + 0.4, 0xffd0a0, 0.6, 8);

    G = idleGame(); SCR.length = 0;
    redrawBoard();
    if (canDrain()) drainCast();   // rebuild case: arena already live
  }

  /* ======================= REGISTER ====================================== */
  CBZ.games.register({
    id: "government",
    title: "CITY HALL AFTER DARK",
    venue: { lotKind: "cityhall" },
    build: build,
    update: function (ctx, dt) {
      if (!V || ctx.venue !== V._venue) return;
      if (canDrain()) drainCast();
      tickScript(dt);
      driveAuditor();
      driveGuard(dt);
      tickSeats(dt);
      tickClock(dt);
      tickDial();
      tickStrip(dt);
    },
    api: {
      rules: { tallyOf: tallyOf },
      tally: function () { return tallyOf(COUNCIL); },
      council: function () {
        return COUNCIL.map(function (m) { return { i: m.i, name: m.name, title: m.title, real: m.real, stance: m.stance, cast: m.cast, want: m.want.id, wantName: m.want.name, fear: m.fear, dirt: !!G.dirt[m.key], flippedBy: m.flippedBy }; });
      },
      state: function () {
        return {
          active: G.active, rolling: G.rolling, voted: G.voted, result: G.result,
          clockLeft: Math.round(G.clockLeft), scandal: Math.round(G.scandal),
          ledger: G.ledger.length, torn: G.torn.length,
          satchel: Object.keys(G.satchel).filter(function (k) { return G.satchel[k]; }),
          dirt: Object.keys(G.dirt).filter(function (k) { return G.dirt[k]; }),
          tally: tallyOf(COUNCIL), realCount: V ? V.realCount : 0, seated: COUNCIL.length,
        };
      },
      cast: function () { return V ? V.realCount : 0; },
      // where the room and everything in it stands, in the world (probes)
      site: function () {
        if (!V || !L) return null;
        const at = function (x, z) { const w = worldOf(x, z); return { x: w.x, z: w.z }; };
        const out = { y: L.fy, th: L.th, hx: L.hx, hz: L.hz, side: L.S, clear: L.clear,
          lectern: at(0, L.zLect + 1.15), speaker: at(0, L.zLect - 0.74), board: at(0, L.zFrame),
          clerk: at(L.clerk.x, L.clerk.z + 1.0), reporter: at(L.reporter.x - L.S * 1.0, L.reporter.z),
          register: at(L.reg.x + L.S * 0.95, L.reg.z), shredder: at(L.shred.x, L.shred.z + 0.9), guard: at(L.guard.x, L.guard.z),
          seats: V.seats.map(function (s) { return at(s.x, L.zBench + 0.95); }),
          shelves: L.shelfZ.map(function (z) { return at(L.shelfX - L.S * 1.0, z); }), cabinets: {} };
        for (const id in L.sup) out.cabinets[id] = at(L.sup[id].x, L.sup[id].z + 0.9);
        return out;
      },
      people: function () { return V ? { speaker: V.speaker, clerk: V.clerk, reporter: V.reporter, auditor: V.auditor, guard: V.guard, council: COUNCIL.map(function (m) { return m.handle; }) } : null; },
      // levers (a probe drives the game straight through these)
      start: function (opts) { return startNight(opts || { force: true }); },
      bribe: function (i) { return bribeMember(i); },
      trade: function (i) { return tradeWant(i); },
      blackmail: function (i) { return blackmailMember(i); },
      leak: function (i) { return pressLeak(i); },
      pickup: function (id) { return pickUp(id); },
      searchShelf: function (i) { return searchShelf(i); },
      tear: function () { return tearPage(); },
      shred: function () { return shredPage(); },
      auditorCheck: function () { return auditorCheck(); },
      callVote: function () { gavel("early", true); return !!(G && G.result); },
      expireClock: function () { if (G) { G.clockLeft = 0.0001; tickClock(1); } return !!(G && (G.result || G.rolling)); },
      // the political layer (all no-ops when statecraft/candidacy aren't loaded)
      chairs: function () { return playerChairsHere(); },
      override: function () { return chairOverride(); },
      // harness-only hooks, not part of the player-facing surface
      _setStance: function (i, s) { if (COUNCIL[i]) { COUNCIL[i].stance = s; redrawBoard(); } },
      _drain: function () { return ensureCouncil(); },
      _gavel: function (why) { gavel(why || "test"); },
    },
  });

  /* ---------------- RATCHET: the board can never go coplanar again ---------
     EXPORT ONLY. gap = metres of real air between the board's BACK face and
     its frame's FRONT face, MEASURED off the two live meshes (at 0 the two
     surfaces share a depth value and the wall shimmers); emissive = the
     board's emissiveIntensity (0 means it went back to an unlit painted
     panel); screens = lit screen surfaces in the venue. `built` is false
     until a venue is mounted. */
  CBZ.govBoardAudit = function () {
    const out = { gap: 0, emissive: 0, screens: 0, built: false };
    if (!V || !V.boardMesh || !V.frameMesh) return out;
    const b = V.boardMesh, f = V.frameMesh;
    const bp = (b.geometry && b.geometry.parameters) || {};
    const fp = (f.geometry && f.geometry.parameters) || {};
    const bd = bp.depth || 0, fd = fp.depth || 0;
    out.gap = Math.round(((b.position.z - bd / 2) - (f.position.z + fd / 2)) * 10000) / 10000;
    out.emissive = (b.material && b.material.emissiveIntensity != null) ? b.material.emissiveIntensity : 0;
    out.screens = V.screens ? V.screens.length : 0;
    out.built = true;
    return out;
  };
})();
