/* ============================================================
   games/government.js — CITY HALL AFTER DARK, as a GAME PACKAGE.

   An influence heist in one evening: your crew needs the DOCKLANDS
   REZONING passed before the gavel. A 7-seat council sits the chamber;
   you flip the room by any diegetic means and survive the auditor.

   WHAT IS REUSED (the engine already SIMULATES politics — we cast FROM it):
     - THE COUNCIL is drawn from the LIVE officials sim, not invented.
       city/polity.js registers every country/state/city/federal
       jurisdiction; city/officials.js mints a real named holder (and
       deputy) for each; city/elections.js swaps them on election day.
       gatherOfficials() reads polity.list(*) + CBZ.officials.identityOf()
       and seats the President, the Governors, the Mayors and their
       Deputies — by their REAL names and offices — filling only the
       leftover seats with seeded stand-ins when the sim has fewer than 7.
       So the people you're bribing are the same people whose approval,
       elections and assassinations the rest of the game tracks.
     - PEDS: every councillor, the auditor, the desk guard and the lobby
       reporter is a REAL city ped via ctx.npc (brain, wardrobe, gunpoint
       hands-up, cityKillPed death). The auditor is driven along posted
       waypoints as a `controlled` ped (peds.js hands controlled bodies to
       their owner — city/social.js / city/officials.js do the same).
     - MONEY: bribes and the payout are REAL city cash through ctx.wallet.

   THE LEVERS (every prop is interactable or load-bearing — WHY rule):
     tally board (canvas) — the live whip count on the north wall.
     the bench       — walk up to a councillor to lobby them.
     records room    — per-shelf search, seeded dirt tables → BLACKMAIL
                       (clean, but you have to FIND it).
     supply cabinets — fetch a councillor's WANT object → TRADE (clean).
     bribe           — real cash, instant, but writes a LEDGER page.
     the auditor     — patrols the rooms; when she reaches the records
                       desk she reads the ledger. A live page = INDICTED
                       (LOSE) — unless you SHRED it first.
     the shredder    — clears the ledger page; jams 30% (a loud event that
                       pulls the desk guard over + a little scandal).
     the lobby press — LEAK a councillor's FEAR: they fold, but SCANDAL
                       climbs; at the cap the chair postpones (LOSE).
     the gavel       — the evening clock runs out (or you call it): roll
                       call line by line, FOR > AGAINST = WIN (payout +
                       territory), tie/fewer = LOSE gracefully.

   THE POLITICAL LAYER (2026-07 wave) — three seams, every one guarded, so
   this package still plays alone exactly as it did before:
     THE CLERK'S WINDOW  — a barred counter in the lobby. The single most
                       important verb added to this room: it FILES THE PAPERS
                       (city/candidacy.js). It is the one prop here that
                       matters when no session is running, which is most of
                       the time. It owns no rules — the office list, the fee,
                       the signature bar and the refusal reason all come from
                       candidacy.js, because a second copy of those rules is
                       how a feature rots.
     THE CHAIR'S GAVEL — if `rec.office.holder` on THIS jurisdiction is the
                       player sentinel, you are not lobbying the room, you
                       are chairing it, and the interesting move stops being
                       "flip seven people" and becomes "do I OVERRIDE them".
                       Ramming a bill past a council that voted it down is
                       legal, instant, pays exactly the same $60k — and burns
                       real approval (CBZ.approvalShock, approval.js's live
                       number) plus tyranny (city/statecraft.js), which is
                       the number the garrison reads before deciding whether
                       your next order is worth obeying. The override is
                       offered ONLY when the room is genuinely against you;
                       when they already agree it is just the vote.
     THE ARCHIVES      — a hook the campaign banked against a councillor's
                       real sid (an afternoon in the public library's records
                       room) is a file already in your hand when the session
                       opens. No dirt is invented: the line shown is the line
                       the research wrote.
   And a bill carried while you are ON THE BALLOT is real momentum in the
   real tally — elections.js's scoreCandidate() reads `momentum` directly.

   Determinism: BUILD paths + the seeded puzzle (stances, wants, fears,
   shelf dirt) use ctx.rand/ctx.stream only (multiplayer law). Shredder
   jam is runtime FX (Math.random, allowed). Nothing persists across
   nights except a one-day cooldown (ctx.state).
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
  const COUNCIL_SEAT_H = 0.48; // cushion top above the chamber floor
  const NIGHT_SECONDS = 240;      // the evening, in gameplay seconds, to the gavel
  const BRIBE_COST = 5000;        // real city cash per envelope
  const WIN_PAYOUT = 60000;       // developer kickback on a passed rezoning
  const SCANDAL_PER_LEAK = 34;    // 3 leaks == cap == postponed vote (LOSE)
  const SCANDAL_CAP = 100;
  const JAM_SCANDAL = 8;
  const JAM_CHANCE = 0.30;        // shredder jam (runtime FX)
  const COOLDOWN_DAYS = 1;
  const AUDITOR_SPEED = 1.4, GUARD_SPEED = 1.6;
  // THE TALLY BOARD, in metres. BOARD_W/BOARD_H are 1.600 to the canvas's
  // 1024x640 (see makeBoard). BOARD_GAP is the real air between the board's
  // BACK face and the backing frame's FRONT face — the SCREEN_GAP convention
  // (0.025 elsewhere) opened up for a 4.6 m pane read from across the chamber.
  const BOARD_W = 4.64, BOARD_H = 2.90, BOARD_T = 0.06;
  const BOARD_GAP = 0.055;
  const BOARD_EI = 0.65;          // emissiveIntensity — a lit board, not a painted one

  /* ---------------- flavor tables (indexed by seeded picks) --------------- */
  const WANT_ITEMS = [
    { id: "bourbon", name: "a case of 30-year bourbon" },
    { id: "survey",  name: "the sealed harbor survey" },
    { id: "gavel",   name: "the commemorative gold gavel" },
    { id: "polling", name: "the primary-race polling packet" },
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
  const FILL_FIRST = ["Harlan", "Corliss", "Della", "Marcus", "Yvette", "Sol", "Bianca", "Roy", "Nadia", "Grover"];
  const FILL_LAST  = ["Petrakis", "Vandermeer", "Osei", "Calloway", "Sorensen", "Ruiz", "Ashford", "Kwan", "Delgado", "Boyd"];
  const COL = { wood: 0x4a3826, woodD: 0x2e2216, brass: 0xb9922e, wall: 0x3a4250, stone: 0x555f6b, red: 0x6e1524 };

  /* ---------------- module state ------------------------------------------ */
  let C = null;             // mounted ctx
  let V = null;             // venue refs (geometry, cast handles, layout)
  let S = null;             // persisted bag — cooldown ONLY (see header)
  const COUNCIL = [];       // stable per-mount roster {i,key,name,title,real,handle,want,fear,baseStance,stance,flippedBy,dirtLine}
  let G = idleGame();       // session state (never persisted)

  function idleGame() {
    return { active: false, voted: false, result: null, clockLeft: 0, scandal: 0, ledger: [], satchel: {}, dirt: {} };
  }
  function bag() { return S || (S = C.state(function () { return { nextNightDay: 0 }; })); }

  /* ---------------- helpers ----------------------------------------------- */
  function worldDayNow() { return CBZ.worldDay ? CBZ.worldDay() : (CBZ.dayCount ? CBZ.dayCount() : 0); }
  function arenaLive() { return !!(CBZ.city && CBZ.city.arena && CBZ.city.arena.root); }
  function worldOf(lx, lz) { const o = (V && V._venue && V._venue.origin) || { x: 0, z: 0 }; return { x: o.x + lx, z: o.z + lz }; }
  function fmt(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function shortName(n) { if (!n) return "?"; const p = String(n).trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : p[0]; }
  function clampNum(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }
  function clockStr() { const s = Math.max(0, Math.round(G.clockLeft)); return (s / 60 | 0) + ":" + ("0" + (s % 60)).slice(-2) + " to the gavel"; }

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
  // The whip count. A councillor votes AYE (for) / NAY (against) / ABSTAIN
  // (undecided). The rezoning carries iff FOR strictly beats AGAINST — a tie
  // or a shortfall FAILS.  (this is api.tally()'s "majority incl. tie=fail")
  function tallyOf(list) {
    let f = 0, a = 0, ab = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i].stance;
      if (s === "for") f++; else if (s === "against") a++; else ab++;
    }
    return { for: f, against: a, abstain: ab, pass: f > a };
  }
  // minimum flips still needed to make FOR beat AGAINST (for the briefing)
  function shortfall() {
    let f = 0, a = 0, u = 0;
    for (let i = 0; i < COUNCIL.length; i++) { const s = COUNCIL[i].stance; if (s === "for") f++; else if (s === "against") a++; else u++; }
    let flips = 0;
    while (f <= a) { if (a > 0) { a--; f++; } else if (u > 0) { u--; f++; } else break; flips++; }
    return flips;
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
  // real officeholders + deputies, in a sensible seniority order, deduped.
  function gatherOfficials() {
    const out = [], seen = {};
    if (!CBZ.polity || !CBZ.officials || !CBZ.officials.identityOf) return out;
    const recs = [].concat(
      CBZ.polity.list("country"), CBZ.polity.list("state"),
      CBZ.polity.list("federal"), CBZ.polity.list("city"));
    function push(sid, title) {
      if (!sid || seen[sid]) return;
      // NEVER cast the player as a councillor. Once city/candidacy.js can put
      // you in an office, office.holder may literally be the player sentinel —
      // and seating a second "you" at the bench while you're standing in the
      // room is the exact fake-identity trap officials.js refuses to fall into.
      if (sid === PLAYER_SID) { seen[sid] = 1; return; }
      const idn = CBZ.officials.identityOf(sid);
      if (!idn || !idn.name || idn.name === "Someone") return;
      seen[sid] = 1; out.push({ sid: sid, name: idn.name, title: title });
    }
    for (let i = 0; i < recs.length; i++) { const r = recs[i]; if (r.office) push(r.office.holder, officeTitle(r) + " of " + r.name); }
    for (let i = 0; i < recs.length; i++) { const r = recs[i]; if (r.office) push(r.office.deputy, "Deputy " + officeTitle(r) + " of " + r.name); }
    return out;
  }
  function fillName(i) { return FILL_FIRST[Math.floor(C.rand(i, 20, "ff") * FILL_FIRST.length)] + " " + FILL_LAST[Math.floor(C.rand(i, 21, "fl") * FILL_LAST.length)]; }
  function auditorName() { return "Inspector " + FILL_LAST[Math.floor(C.rand(0, 30, "an") * FILL_LAST.length)]; }
  function reporterName() { return FILL_FIRST[Math.floor(C.rand(0, 31, "rf") * FILL_FIRST.length)] + " " + FILL_LAST[Math.floor(C.rand(0, 32, "rl") * FILL_LAST.length)]; }

  function canDrain() {
    if (!V || V.cast) return false;
    if (!CBZ.cityMakePed) return true;                 // bare harness → dummy peds
    if (!arenaLive()) return false;                    // real peds need the live arena
    if (CBZ.officials && !(CBZ.game && CBZ.game.officials && CBZ.game.officials.inited)) return false; // wait for real names
    return true;
  }
  function drainCast(ctx) {
    if (!V || V.cast) return;
    V.cast = true;
    const offs = gatherOfficials();
    COUNCIL.length = 0; V.realCount = 0;
    for (let i = 0; i < COUNCIL_N; i++) {
      const seat = V.seats[i], meta = V.seatMeta[i];
      let name, title, real = false, key;
      let sid = null;
      if (i < offs.length) { sid = offs[i].sid; name = offs[i].name; title = offs[i].title; real = true; key = "sid:" + sid; V.realCount++; }
      else { name = fillName(i); title = "Councilmember"; key = "fill:" + i; }
      const handle = ctx.npc ? ctx.npc({
        role: "councillor", name: name, outfit: { archetype: "exec" },
        at: [seat.x, seat.z], face: 0, post: "pinned", pose: "sit",
        seatRef: { cushion: COUNCIL_SEAT_H, floorBelow: 0 },
      }) : null;
      COUNCIL.push({ i: i, key: key, sid: sid, name: name, title: title, real: real, handle: handle, want: meta.want, fear: meta.fear, baseStance: meta.baseStance, stance: meta.baseStance, flippedBy: null, dirtLine: null });
    }
    // the auditor — a controlled ped we drive along posted waypoints.
    V.auditor = ctx.npc ? ctx.npc({ role: "auditor", name: auditorName(), outfit: { archetype: "exec" }, at: [0, V.hz * 0.2], face: Math.PI, post: "pinned", pose: "stand" }) : null;
    if (V.auditor && V.auditor.ped) { const p = V.auditor.ped; p.controlled = true; p.staffPost = null; p.state = "idle"; p.speed = 0; }
    // the desk guard (jam responder) + the lobby reporter (press leaks)
    V.guard = ctx.npc ? ctx.npc({ role: "guard", name: "Desk Security", at: [V.guardPost.x, V.guardPost.z], face: V.guardPost.face, post: "pinned", pose: "foldarms" }) : null;
    V.reporter = ctx.npc ? ctx.npc({ role: "reporter", name: reporterName(), outfit: { archetype: "nightlife" }, at: [V.reporterPost.x, V.reporterPost.z], face: V.reporterPost.face, post: "pinned", pose: "stand" }) : null;
    redrawBoard();
  }
  function ensureCouncil() { if (COUNCIL.length) return true; if (canDrain()) drainCast(C); return !!COUNCIL.length; }

  /* ================= THE TALLY BOARD ======================================
     The one readout in the room: seven names, seven stances, and the number
     you are trying to move. It is the ONLY prop here that tells you whether
     the evening is being won, so it is worth drawing properly.

     TWO RULES GOVERN IT AND NEITHER IS TASTE:
     (1) EVENT-DRIVEN ONLY. redrawBoard() runs when a FACT changed (the cast
         seated, a member flipped, a leak landed, the gavel fell) — never per
         frame. A CanvasTexture upload is a real GPU cost and nothing on this
         board ticks (the session clock deliberately lives on the panel, not
         here, precisely so the board never needs a per-frame repaint).
     (2) THE CANVAS ASPECT IS THE MESH ASPECT. 1024x640 is 1.600, and the
         board mesh is 4.64 x 2.90 = 1.600 exactly, so no glyph is stretched.
         Move one and you move the other.
     ---------------------------------------------------------------------- */
  const BOARD_CW = 1024, BOARD_CH = 640;   // canvas px (1.600, == the mesh aspect)
  const BC = {
    bg: "#0b1119", head: "#16273a", rule: "#8fc1ff", dim: "#6f88a6",
    name: "#e8eef5", sub: "#7d8ca3", foot: "#0e1722", stripe: "rgba(255,255,255,.030)",
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
  function makeBoard() { return C.canvasTexLive(BOARD_CW, BOARD_CH); }
  function redrawBoard() {
    if (!V || !V.board) return;
    const cc = V.board.cc, W = V.board.w, H = V.board.h;
    cc.textBaseline = "alphabetic";
    cc.fillStyle = BC.bg; cc.fillRect(0, 0, W, H);

    // ---- header: what this board is, and where the evening stands ----------
    cc.fillStyle = BC.head; cc.fillRect(0, 0, W, 92);
    cc.fillStyle = BC.rule; cc.fillRect(0, 92, W, 4);
    cc.textAlign = "left";
    cc.fillStyle = "#dce8f6"; cc.font = "700 42px " + FONT;
    cc.fillText("DOCKLANDS REZONING", 34, 52);
    cc.fillStyle = BC.dim; cc.font = "600 19px " + FONT;
    cc.fillText("COUNCIL ROLL · LIVE WHIP COUNT", 36, 79);
    cc.textAlign = "right";
    cc.fillStyle = G.result === "win" ? BC.for : (G.result ? BC.against : BC.dim);
    cc.font = "700 22px " + FONT;
    cc.fillText(G.result ? resultLine().toUpperCase() : (G.active ? "SESSION IN PROGRESS" : "CHAMBER STANDING BY"), W - 34, 50);
    cc.fillStyle = G.scandal >= SCANDAL_CAP * 0.6 ? BC.against : BC.dim;
    cc.font = "600 18px " + FONT;
    cc.fillText("SCANDAL " + Math.min(100, Math.round(G.scandal)) + "%  ·  LEDGER " + G.ledger.length, W - 34, 79);

    if (!COUNCIL.length) {
      cc.textAlign = "center"; cc.fillStyle = BC.none; cc.font = "600 30px " + FONT;
      cc.fillText("the council has not yet been seated", W / 2, H / 2 + 10);
      V.board.paint(); return;
    }

    // ---- one row per seat: rank · name · office · stance chip --------------
    const TOP = 108, ROWH = 60, CHIPW = 208, CHIPX = W - 34 - CHIPW;
    for (let i = 0; i < COUNCIL.length; i++) {
      const m = COUNCIL[i], y = TOP + i * ROWH, col = stanceCol(m.stance);
      if (i % 2 === 0) { cc.fillStyle = BC.stripe; cc.fillRect(24, y, W - 48, ROWH - 4); }
      cc.fillStyle = col; cc.fillRect(24, y + 6, 6, ROWH - 16);        // stance edge
      cc.textAlign = "right"; cc.fillStyle = BC.sub; cc.font = "700 21px " + FONT;
      cc.fillText(String(i + 1), 70, y + 38);
      cc.textAlign = "left";
      cc.fillStyle = BC.name; cc.font = "700 27px " + FONT;
      cc.fillText(shortName(m.name), 88, y + 29, CHIPX - 108);
      // The stand-in note is SPELLED OUT: the old asterisk needed a legend the
      // board never had room to print, and this line was already free.
      cc.fillStyle = BC.sub; cc.font = "500 17px " + FONT;
      cc.fillText(m.title + (m.real ? "" : " · stand-in") + (m.flippedBy ? "  —  " + m.flippedBy : ""), 90, y + 50, CHIPX - 110);
      cc.globalAlpha = 0.16; cc.fillStyle = col; rrect(cc, CHIPX, y + 12, CHIPW, 34, 8); cc.fill(); cc.globalAlpha = 1;
      cc.strokeStyle = col; cc.lineWidth = 2; rrect(cc, CHIPX, y + 12, CHIPW, 34, 8); cc.stroke();
      cc.textAlign = "center"; cc.fillStyle = col; cc.font = "700 21px " + FONT;
      cc.fillText(m.stance.toUpperCase(), CHIPX + CHIPW / 2, y + 36);
    }

    // ---- footer: the count, as a bar you can read from the bench ----------
    const t = tallyOf(COUNCIL), n = COUNCIL.length || 1;
    cc.fillStyle = BC.foot; cc.fillRect(0, 536, W, H - 536);
    cc.fillStyle = "rgba(143,193,255,.28)"; cc.fillRect(0, 536, W, 2);
    let bx = 34; const BW = W - 68;
    const segs = [[t.for, BC.for], [t.abstain, BC.undecided], [t.against, BC.against]];
    for (const s of segs) {
      const sw = (BW * s[0]) / n; if (sw <= 0) continue;
      cc.fillStyle = s[1]; cc.fillRect(bx, 556, Math.max(0, sw - 2), 12); bx += sw;
    }
    cc.textAlign = "left"; cc.font = "700 24px " + FONT;
    let tx = 34;
    const legend = [["FOR", t.for, BC.for], ["UNDECIDED", t.abstain, BC.undecided], ["AGAINST", t.against, BC.against]];
    for (const L of legend) {
      cc.fillStyle = L[2]; cc.beginPath(); cc.arc(tx + 7, 601, 7, 0, Math.PI * 2); cc.fill();
      const txt = L[0] + " " + L[1];
      cc.fillText(txt, tx + 22, 609);
      tx += 22 + cc.measureText(txt).width + 42;
    }
    cc.textAlign = "right"; cc.font = "700 22px " + FONT;
    cc.fillStyle = G.result ? (G.result === "win" ? BC.for : BC.against) : BC.dim;
    cc.fillText(G.result ? resultLine().toUpperCase() : "NEED FOR > AGAINST", W - 34, 609);
    V.board.paint();
  }

  /* ---------------- panel UI (engine panel, data-act delegation) ---------- */
  const BTN = "display:inline-block;margin:3px 6px 3px 0;padding:9px 15px;border-radius:10px;cursor:pointer;font-weight:800;font-size:13px;user-select:none;box-shadow:0 3px 0 rgba(0,0,0,.4);";
  function btn(act, label, bg, dis) { return "<span data-act='" + act + "' style='" + BTN + "background:" + (bg || "#1c4b6b") + ";" + (dis ? "opacity:.4;pointer-events:none;" : "") + "'>" + label + "</span>"; }
  function head(title, sub) { return "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'><b style='letter-spacing:2px;color:#8fc1ff'>" + title + "</b><span style='opacity:.7;font-size:12px'>" + (sub || "") + " · Esc closes</span></div>"; }
  function stanceTag(s) { const col = s === "for" ? "#5fd08a" : s === "against" ? "#ff6a5e" : "#c9a24a"; return "<b style='color:" + col + "'>" + s.toUpperCase() + "</b>"; }
  function resultLine() {
    switch (G.result) {
      case "win": return "rezoning passed";
      case "lose:indicted": return "you were indicted";
      case "lose:scandal": return "vote postponed, scandal";
      case "lose:tie": return "deadlocked, tie fails";
      case "lose:vote": return "rezoning failed";
      default: return "";
    }
  }

  /* ================= THE CHAIR / SESSION HUB ==============================
     TWO GAMES SHARE THIS ROOM, and which one you're playing is decided by a
     single real fact: does `rec.office.holder` on THIS jurisdiction equal the
     player sentinel?
       NO  — you are a lobbyist working a room after dark. Flip it or lose it.
       YES — you ARE the chair. The gavel is yours, and the interesting move
             is no longer flipping seven people, it is deciding whether to
             OVERRIDE them. Ramming a bill through a council that voted it
             down is legal and it is the fastest way to lose the room: the
             cost is paid in the jurisdiction's REAL approval number and in
             statecraft's tyranny, which is what the garrison reads before it
             decides whether your next order is worth obeying.
     The override is deliberately NOT free money. It is the same $60k the
     honest majority pays — the difference is entirely what it costs you.
     ------------------------------------------------------------------ */
  const CHAIR_OVERRIDE_APPROVAL = 9;   // approval points burned ramming a bill through
  const CHAIR_OVERRIDE_TYRANNY  = 12;  // tyranny added — statecraft decays it slowly

  // the chair's override: legal, instant, and expensive in the only currency
  // an officeholder actually has. Returns false when the room already agrees
  // (then it isn't an override, it's just the vote).
  function chairOverride() {
    if (!G.active || G.result) return false;
    if (!playerChairsHere()) return false;
    const t = tallyOf(COUNCIL);
    if (t.pass) { C.hud.feed("The room's already with you, just call the vote."); return false; }
    const seat = playerSeat();
    // the whole cost, paid to the REAL simulation, before anything is gained.
    if (seat && seat.id && CBZ.approvalShock) {
      try { CBZ.approvalShock(seat.id, -CHAIR_OVERRIDE_APPROVAL); } catch (e) {}
    }
    if (CBZ.gov && CBZ.gov.forceUsed) { try { CBZ.gov.forceUsed(CHAIR_OVERRIDE_TYRANNY, "gavelled a bill past the council"); } catch (e) {} }
    G.voted = true; G.active = false;
    G.result = "win";
    C.wallet.give(WIN_PAYOUT, "Docklands rezoning, chair's prerogative");
    setCooldown(); redrawBoard();
    if (CBZ.city && CBZ.city.big) CBZ.city.big("REZONING GAVELLED THROUGH " + t.for + "–" + t.against + " AGAINST");
    if (CBZ.cityFeed) CBZ.cityFeed("The chair overrode the council on the Docklands rezoning. Two members walked out.", "#ff9a6a");
    creditCampaign("gavelled the Docklands rezoning through");
    C.hud.feed("You gavel it through over the council's objection. It is legal. Nobody in this room will forget it.", "#e8c84a");
    return true;
  }

  // a bill you carried while you are ON THE BALLOT is real momentum in the
  // real tally — elections.js's scoreCandidate() reads `momentum` directly.
  function creditCampaign(why) {
    try {
      if (CBZ.cityRun && CBZ.cityRun.live && CBZ.cityRun.live() && CBZ.cityRun.momentumGain) {
        CBZ.cityRun.momentumGain(3, why);
      }
    } catch (e) {}
  }

  function openSession() {
    if (!C) return;
    const t = tallyOf(COUNCIL);
    const chair = playerChairsHere();
    let body = head("CITY HALL · DOCKLANDS REZONING", G.active ? clockStr() : (chair ? "you have the gavel" : "after dark"));
    body += "<div style='margin:2px 0 8px;line-height:1.55'>";
    body += "Tally: <b style='color:#5fd08a'>FOR " + t.for + "</b> · <b style='color:#ff6a5e'>AGAINST " + t.against + "</b> · <b style='color:#c9a24a'>UNDECIDED " + t.abstain + "</b>, need FOR &gt; AGAINST.<br>";
    body += "Scandal <b style='color:" + (G.scandal >= SCANDAL_CAP * 0.6 ? "#ff6a5e" : "#9aa6bd") + "'>" + Math.min(100, Math.round(G.scandal)) + "%</b>/" + SCANDAL_CAP + " · Ledger <b>" + G.ledger.length + "</b> page(s) · Cash <b>" + fmt(C.wallet.cash()) + "</b>";
    body += "</div>";
    if (G.result) {
      body += "<div style='margin:6px 0;font-weight:800;color:" + (G.result === "win" ? "#5fd08a" : "#ff6a5e") + "'>" + resultLine().toUpperCase() + "</div>";
      body += btn("close", "Leave", "#26343c");
    } else if (!G.active) {
      if (startable()) body += "<div style='opacity:.85;margin-bottom:6px'>Convene the session and flip the room before the gavel. Bribe, trade favors, dig the records, or lean on the press, just don't let the auditor read your ledger.</div>" + btn("start", "CONVENE THE SESSION", "#1c6b40");
      else body += "<div style='opacity:.7'>The chamber is dark tonight, the clerk's locked up. Come back tomorrow.</div>";
      body += " " + btn("close", "Leave", "#26343c");
    } else {
      body += "<div style='opacity:.8;font-size:12px;margin-bottom:6px'>Flip " + Math.max(0, shortfall()) + " more to carry it. Lobby councillors at their seats; the records room, the cabinets, the press and the shredder are down the halls.</div>";
      body += btn("callvote", "CALL THE VOTE NOW", "#c98f22");
      // THE CHAIR'S PREROGATIVE — only when the player genuinely holds this
      // jurisdiction's seat, and only when the room is actually against them
      // (otherwise it is not an override, it is just the vote).
      if (chair && !t.pass) {
        body += btn("override", "GAVEL IT THROUGH ANYWAY", "#7c1626");
        body += "<div style='opacity:.75;font-size:12px;margin:4px 0'>The chair can carry a bill the council rejected. It costs " +
          CHAIR_OVERRIDE_APPROVAL + " points of your approval and it is remembered, the garrison reads that number before it obeys you.</div>";
      }
      body += btn("close", "Keep working", "#26343c");
    }
    C.hud.panel(body, {
      start: function () { startNight(); openSession(); },
      callvote: function () { C.hud.closePanel(); gavel("early"); },
      override: function () { C.hud.closePanel(); chairOverride(); },
      close: function () { C.hud.closePanel(); },
    });
  }

  /* ================= THE CLERK'S WINDOW — the door INTO politics ===========
     The lobby of the flagship City Hall is where a first-time player will
     stand before they have ever heard of the annex. The window does exactly
     one thing and it is the most important verb in the wave: it files the
     papers. Everything about which office, what it costs and why you can't
     yet belongs to city/candidacy.js — this is a door, not a second copy of
     the rules. With that module absent the window is honest about being shut.
     ------------------------------------------------------------------ */
  function openClerkWindow() {
    if (!C) return;
    const R = (CBZ.cityRun && CBZ.cityRun.offices) ? CBZ.cityRun : null;
    let body = head("THE CLERK'S WINDOW", "filings · candidacies · the ballot");
    if (!R) {
      body += "<div style='opacity:.75;line-height:1.5'>The filing window is shuttered. A typed card behind the glass gives an office number and no hours.</div>";
      C.hud.panel(body + btn("close", "Leave", "#26343c"), { close: function () { C.hud.closePanel(); } });
      return;
    }
    /* §PROCLAIM A DOCTRINE — the door the "communism"/"fascism" effect code
       has been waiting behind. Nine gates across six files were tuned and
       live and could never fire, because nothing in 264k lines ever assigned
       either govType. The producer is city/regimes.js's regimeDeclareDoctrine;
       this is simply where a person who HOLDS a seat can reach it, which is
       the owner's "become president… or hold the nation hostage" ending made
       pressable. Nothing renders unless you actually hold an office, so a
       player who has never won anything sees the clerk's window unchanged. */
    const doctH = {};   // doctrine handlers, folded into every panel below
    const holds = (CBZ.regimeHeldByPlayer && CBZ.regimeHeldByPlayer()) || [];
    if (holds.length && CBZ.regimeDeclareDoctrine) {
      const seat = holds[0];
      const canD = !!(CBZ.regimeCanDeclare && CBZ.regimeCanDeclare());
      const need = (!canD && CBZ.cityPowerNeed) ? CBZ.cityPowerNeed("doctrine") : null;
      const govs = (CBZ.regimeDoctrines && CBZ.regimeDoctrines()) || [];
      let dbody = "<div style='margin:2px 0 8px;padding:6px 0;border-top:1px solid #2c3140;line-height:1.5'>" +
        "You hold <b style='color:#8fe08a'>" + (seat.name || seat.id) + "</b>. A state can be REMADE by the person who holds it." +
        (canD ? "" : "<br><span style='opacity:.75;font-size:12px'>Not yet · " + ((need && need.line) || "you need more behind you") + ".</span>") +
        "</div>";
      for (let i = 0; i < govs.length; i++) {
        (function (gov, i) {
          const same = seat.govType === gov;
          dbody += btn("doct" + i, "PROCLAIM " + gov.toUpperCase(), same ? "#3a3f46" : "#7c1626", same || !canD);
          doctH["doct" + i] = function () {
            const r = CBZ.regimeDeclareDoctrine(gov, { rec: seat });
            if (r && r.ok) C.hud.feed(seat.name + " is now under " + r.name + ".", "#ffd76a");
            else if (r && r.reason) C.hud.feed(r.reason, "#ff9aa2");
            C.hud.closePanel();
          };
        })(govs[i], i);
      }
      body += dbody;
    }
    let list = [];
    try { list = R.offices() || []; } catch (e) { list = []; }
    const st = runState();
    if (st && st.filed) {
      const held = playerSeat();
      body += "<div style='margin:2px 0 8px;line-height:1.55'>You are <b style='color:#8fe08a'>on the ballot</b>" +
        (st.officeId ? " for <b>" + String(st.officeId) + "</b>" : "") + ".<br>" +
        "Signatures <b>" + (st.sigCount | 0) + "</b> · war chest <b>" + fmt(st.warChest || 0) + "</b> · momentum <b>" + Math.round(st.momentum || 0) + "</b>" +
        (st.scandal ? " · scandal <b style='color:#ff6a5e'>" + Math.round(st.scandal) + "</b>" : "") + "</div>";
      if (held) body += "<div style='opacity:.8;margin-bottom:6px'>You already hold a seat. Defending it is the same ballot.</div>";
      body += btn("withdraw", "Withdraw the papers", "#7c1626") + btn("close", "Leave", "#26343c");
      C.hud.panel(body, Object.assign({
        withdraw: function () { try { R.withdraw(); } catch (e) {} C.hud.closePanel(); },
        close: function () { C.hud.closePanel(); },
      }, doctH));
      return;
    }
    if (!list.length) {
      body += "<div style='opacity:.75;line-height:1.5'>“Nothing's open. Terms run their course, come back when a seat's up, or when one comes up the hard way.”</div>";
      C.hud.panel(body + btn("close", "Leave", "#26343c"), Object.assign({ close: function () { C.hud.closePanel(); } }, doctH));
      return;
    }
    body += "<div style='opacity:.85;margin-bottom:6px'>“Fee's the fee. Signatures are yours to get. Ballot closes when it closes.”</div>";
    const h = Object.assign({ close: function () { C.hud.closePanel(); } }, doctH);
    for (let i = 0; i < list.length && i < 6; i++) {
      (function (o, i) {
        const ok = o.canFile !== false;
        body += "<div style='margin:6px 0;padding-top:5px;border-top:1px solid #2c3140'>" +
          "<b>" + (o.title || "Office") + " of " + (o.name || o.id) + "</b>" +
          "<span style='opacity:.7;font-size:12px'> · fee " + fmt(o.fee || 0) +
          " · " + (o.sigsNeeded | 0) + " signatures" +
          (o.daysLeft != null ? " · " + o.daysLeft + "d to the ballot" : "") + "</span><br>" +
          btn("file" + i, ok ? "FILE THE PAPERS" : "Can't file", ok ? "#1c6b40" : "#3a3f46", !ok) +
          (!ok && o.why ? "<span style='opacity:.7;font-size:12px'> " + o.why + "</span>" : "") +
          "</div>";
        h["file" + i] = function () {
          let r = null; try { r = R.file(o.id); } catch (e) { r = null; }
          if (r && r.ok === false && r.why) C.hud.feed(r.why, "#ff9aa2");
          C.hud.closePanel();
        };
      })(list[i], i);
    }
    C.hud.panel(body + "<br>" + btn("close", "Leave", "#26343c"), h);
  }

  /* ================= A COUNCILLOR ======================================== */
  function openMember(i) {
    const m = COUNCIL[i]; if (!m) return;
    let body = head(m.title + " " + m.name, m.real ? "real officeholder" : "councilmember");
    body += "<div style='margin:2px 0 8px;line-height:1.55'>";
    body += "Stance: " + stanceTag(m.stance) + (m.flippedBy ? " <span style='opacity:.6'>(" + m.flippedBy + ")</span>" : "") + "<br>";
    body += "Wants: <b>" + m.want.name + "</b><br>";
    body += "Rumored to fear: <i>" + m.fear + "</i>";
    if (G.dirt[m.key]) body += "<br><b style='color:#ff9a6a'>You hold dirt: " + (m.dirtLine || "a damning file") + "</b>";
    body += "</div>";
    if (!G.active) {
      body += "<div style='opacity:.7'>The session hasn't convened.</div>" + btn("close", "Back", "#26343c");
      C.hud.panel(body, { close: function () { C.hud.closePanel(); } });
      return;
    }
    if (m.stance === "for") {
      body += "<div style='color:#5fd08a;margin-bottom:6px'>Already voting AYE on the rezoning.</div>";
    } else {
      body += btn("bribe", "Bribe " + fmt(BRIBE_COST) + " (leaves a ledger page)", "#7c1626", C.wallet.cash() < BRIBE_COST);
      if (G.satchel[m.want.id]) body += btn("trade", "Trade: give " + m.want.name, "#1c6b40");
      if (G.dirt[m.key]) body += btn("blackmail", "Confront with the file", "#5a3a1a");
      body += "<br>";
    }
    body += btn("close", "Back", "#26343c");
    C.hud.panel(body, {
      bribe: function () { if (bribeMember(i)) openMember(i); },
      trade: function () { if (tradeWant(i)) openMember(i); },
      blackmail: function () { if (blackmailMember(i)) openMember(i); },
      close: function () { C.hud.closePanel(); },
    });
  }

  /* ================= THE LOBBY PRESS ===================================== */
  function openReporter() {
    let body = head("THE LOBBY PRESS", "a leak flips a vote, and stains the room");
    if (!G.active) { C.hud.panel(head("THE LOBBY PRESS", "quiet") + "<div style='opacity:.7'>No session tonight.</div>" + btn("close", "Back", "#26343c"), { close: function () { C.hud.closePanel(); } }); return; }
    body += "<div style='margin:2px 0 8px'>Scandal <b style='color:" + (G.scandal >= SCANDAL_CAP * 0.6 ? "#ff6a5e" : "#9aa6bd") + "'>" + Math.min(100, Math.round(G.scandal)) + "%</b> / " + SCANDAL_CAP + "%, at the cap the chair postpones the vote (you lose).</div>";
    const h = { close: function () { C.hud.closePanel(); } };
    let any = false;
    for (let i = 0; i < COUNCIL.length; i++) {
      const m = COUNCIL[i]; if (m.stance === "for") continue; any = true;
      body += btn("leak" + i, "Leak " + shortName(m.name) + "'s secret (+" + SCANDAL_PER_LEAK + "% scandal)", "#7c1626");
      (function (i) { h["leak" + i] = function () { if (pressLeak(i)) openReporter(); }; })(i);
    }
    if (!any) body += "<div style='color:#5fd08a'>Every holdout already folded.</div>";
    body += "<br>" + btn("close", "Back", "#26343c");
    C.hud.panel(body, h);
  }

  /* ---------------- the levers (also the api surface) --------------------- */
  function flip(i, by) { const m = COUNCIL[i]; if (m.stance !== "for") { m.stance = "for"; m.flippedBy = by; } redrawBoard(); }

  function bribeMember(i) {
    if (!G.active) return false;
    const m = COUNCIL[i]; if (!m || m.stance === "for") return false;
    if (!C.wallet.spend(BRIBE_COST, "Envelope to " + shortName(m.name))) return false;
    G.ledger.push({ member: i, name: m.name, amount: BRIBE_COST, day: worldDayNow() });
    flip(i, "bribed");
    C.hud.feed("" + shortName(m.name) + " pockets the envelope. It's on the ledger now, shred it before the auditor reads it.", "#ffd166");
    return true;
  }
  function tradeWant(i) {
    if (!G.active) return false;
    const m = COUNCIL[i]; if (!m || m.stance === "for") return false;
    if (!G.satchel[m.want.id]) { C.hud.feed("You're not carrying " + m.want.name + ".", "#ff9aa2"); return false; }
    G.satchel[m.want.id] = false;
    flip(i, "traded");
    C.hud.feed("You hand over " + m.want.name + ". " + shortName(m.name) + " is an AYE.", "#8fe08a");
    return true;
  }
  function blackmailMember(i) {
    if (!G.active) return false;
    const m = COUNCIL[i]; if (!m || m.stance === "for") return false;
    if (!G.dirt[m.key]) { C.hud.feed("You've got nothing on " + shortName(m.name) + " yet, try the records room.", "#ff9aa2"); return false; }
    flip(i, "blackmailed");
    C.hud.feed("You slide the file across. " + shortName(m.name) + " won't cross you tonight.", "#8fe08a");
    return true;
  }
  function pressLeak(i) {
    if (!G.active) return false;
    const m = COUNCIL[i]; if (!m || m.stance === "for") return false;
    flip(i, "pressured");
    G.scandal += SCANDAL_PER_LEAK;
    C.hud.feed("The reporter runs with " + shortName(m.name) + "'s " + m.fear + ". They flip to AYE, but the room reeks.", "#e8c84a");
    redrawBoard();
    if (G.scandal >= SCANDAL_CAP) postpone();
    return true;
  }
  function pickUp(itemId) {
    if (!G.active) { C.hud.feed("Nothing worth taking until the session convenes."); return false; }
    if (G.satchel[itemId]) { C.hud.feed("Already in your bag."); return false; }
    G.satchel[itemId] = true;
    const it = WANT_ITEMS.filter(function (w) { return w.id === itemId; })[0];
    C.hud.feed("You take " + (it ? it.name : "the item") + ".", "#cfe8ff");
    return true;
  }
  function searchShelf(i) {
    if (!V || !V.shelves) return false;
    const sh = V.shelves[i]; if (!sh) return false;
    if (!G.active) { C.hud.feed("The records room is locked until the session convenes."); return false; }
    if (sh.searched) { C.hud.feed("You've already turned this shelf over."); return false; }
    sh.searched = true;
    if (sh.member >= 0 && COUNCIL[sh.member]) {
      const m = COUNCIL[sh.member]; G.dirt[m.key] = true; m.dirtLine = sh.line;
      C.hud.feed("Buried in the files: " + sh.line + " · on " + m.name + ".", "#ffd166");
      return true;
    }
    C.hud.feed("Dust, old zoning maps, nothing you can use.");
    return false;
  }
  function shredPage() {
    if (!G) return { cleared: true, jammed: false };
    if (G.ledger.length === 0) { C.hud.feed("The ledger's already clean."); return { cleared: true, jammed: false }; }
    const n = G.ledger.length; G.ledger.length = 0;      // the page goes through — shred ALWAYS clears
    const jam = Math.random() < JAM_CHANCE;              // runtime FX RNG is allowed
    if (jam) {
      G.scandal += JAM_SCANDAL; pullGuardToShredder();
      C.hud.feed("The shredder JAMS, a horrible grinding shriek. The desk guard is coming over.", "#ff9aa2");
      redrawBoard();
      if (G.active && G.scandal >= SCANDAL_CAP) postpone();
    } else {
      C.hud.feed("" + n + " ledger page(s) shredded, clean and quiet.", "#8fe08a");
    }
    return { cleared: true, jammed: jam };
  }
  // the auditor reads the ledger. A live page indicts you before any vote.
  function auditorCheck() {
    const indicted = !!G && G.ledger.length > 0;
    if (indicted && G.active && !G.result) indict();
    return { indicted: indicted };
  }

  /* ---------------- terminal states --------------------------------------- */
  function setCooldown() { bag().nextNightDay = worldDayNow() + COOLDOWN_DAYS; try { C.saveState(); } catch (e) {} }
  function startable() { return worldDayNow() >= (bag().nextNightDay || 0); }

  function indict() {
    if (!G || G.result) return;
    G.active = false; G.voted = true; G.result = "lose:indicted";
    setCooldown(); redrawBoard();
    if (CBZ.city && CBZ.city.big) CBZ.city.big("INDICTED · THE AUDITOR FOUND THE LEDGER");
    C.hud.feed("The auditor photographs your ledger page. The rezoning is dead and so is your night.", "#ff6a5e");
  }
  function postpone() {
    if (!G || G.result) return;
    G.active = false; G.voted = true; G.result = "lose:scandal";
    setCooldown(); redrawBoard();
    if (CBZ.city && CBZ.city.big) CBZ.city.big("VOTE POSTPONED · SCANDAL ENGULFS THE CHAMBER");
    C.hud.feed("Too much stink. The chair gavels the session closed, the rezoning is tabled indefinitely.", "#ff6a5e");
  }
  function win(t) {
    G.result = "win";
    C.wallet.give(WIN_PAYOUT, "Docklands rezoning, developer kickback");
    if (CBZ.city && CBZ.city.big) CBZ.city.big("DOCKLANDS REZONING PASSES " + t.for + "–" + t.against);
    C.hud.feed("The gavel falls. Rezoning carries " + t.for + "–" + t.against + " · the Docklands waterfront is your crew's turf now.", "#8fe08a");
    // A bill you carried on a clean majority while you hold the seat is the
    // one thing in this room that BUYS approval instead of spending it — and
    // only when the room genuinely voted for it. Real number, real system.
    const seat = playerChairsHere() ? playerSeat() : null;
    if (seat && seat.id && CBZ.approvalShock) { try { CBZ.approvalShock(seat.id, 4); } catch (e) {} }
    creditCampaign("carried the Docklands rezoning");
  }
  function lose(t) {
    G.result = t.for === t.against ? "lose:tie" : "lose:vote";
    if (CBZ.city && CBZ.city.big) CBZ.city.big("REZONING FAILS " + t.for + "–" + t.against);
    C.hud.feed("" + (t.for === t.against ? "Deadlocked " + t.for + "–" + t.against + " · a tie fails." : "Rezoning fails " + t.for + "–" + t.against + ".") + " The Docklands stay as they are.", "#ff6a5e");
  }
  // the gavel: a dirty ledger indicts first; otherwise roll call → result.
  function gavel(trigger) {
    if (!G || G.result || G.voted) return;
    if (G.ledger.length > 0) { auditorCheck(); return; }
    G.voted = true; G.active = false;
    const t = tallyOf(COUNCIL);
    if (t.pass) win(t); else lose(t);
    setCooldown(); redrawBoard();
    rollCallPanel(t);
  }
  // roll call read line by line in the panel (cosmetic; result already set)
  function rollCallPanel(t) {
    if (!C || !C.hud) return;
    const lines = COUNCIL.map(function (m) { return { name: shortName(m.name), vote: m.stance === "for" ? "AYE" : m.stance === "against" ? "NAY" : "ABSTAIN" }; });
    let shown = 0;
    function render() {
      let body = head("ROLL CALL · DOCKLANDS REZONING", "the gavel");
      for (let i = 0; i < shown; i++) {
        const L = lines[i], col = L.vote === "AYE" ? "#5fd08a" : L.vote === "NAY" ? "#ff6a5e" : "#c9a24a";
        body += "<div style='margin:2px 0'>" + (i + 1) + ". " + L.name + " · <b style='color:" + col + "'>" + L.vote + "</b></div>";
      }
      if (shown >= lines.length) {
        body += "<div style='margin:8px 0;font-weight:800;color:" + (t.pass ? "#8fe08a" : "#ff6a5e") + "'>" + (t.pass ? "CARRIED " + t.for + "–" + t.against : "FAILED " + t.for + "–" + t.against) + "</div>" + btn("close", "Done", "#26343c");
      }
      C.hud.panel(body, shown >= lines.length ? { close: function () { C.hud.closePanel(); } } : null);
    }
    render();
    const iv = setInterval(function () { shown++; render(); if (shown >= lines.length) clearInterval(iv); }, 320);
  }

  /* ---------------- the evening clock ------------------------------------- */
  function tickClock(dt) {
    if (!G || !G.active) return;
    G.clockLeft -= dt;
    if (G.clockLeft <= 0) { G.clockLeft = 0; gavel("clock"); }
  }

  function startNight(opts) {
    if (!C) return false;
    if (!ensureCouncil()) { C.hud.feed("The council hasn't taken their seats yet."); return false; }
    const force = opts && opts.force;
    if (!force && !startable()) { C.hud.feed("Not tonight, the chamber's on cooldown."); return false; }
    for (let i = 0; i < COUNCIL.length; i++) { const m = COUNCIL[i]; m.stance = m.baseStance; m.flippedBy = null; m.dirtLine = null; }
    if (V.shelves) for (let i = 0; i < V.shelves.length; i++) V.shelves[i].searched = false;
    G = idleGame(); G.active = true; G.clockLeft = NIGHT_SECONDS;
    // THE ARCHIVES PAY OFF HERE. A hook the campaign banked against a real
    // sid — the afternoon you spent in the public library's records room —
    // is a file already in your hand when the session opens. We invent no
    // dirt: the line shown is the line the research actually wrote.
    let banked = 0;
    for (let i = 0; i < COUNCIL.length; i++) {
      const m = COUNCIL[i]; if (!m.sid) continue;
      const h = bankedHook(m.sid); if (!h) continue;
      G.dirt[m.key] = true; m.dirtLine = h.note || h.line || "a file you pulled from the archives"; banked++;
    }
    V.wpIdx = 0; V.guardAlertT = 0;
    redrawBoard();
    if (banked) C.hud.feed("You came in with " + banked + " file(s) out of the archives. Someone at that bench knows it.", "#ffd166");
    if (CBZ.city && CBZ.city.big) CBZ.city.big("CITY HALL AFTER DARK · PASS THE DOCKLANDS REZONING BY THE GAVEL");
    C.hud.feed("Session convened. FOR must beat AGAINST when the gavel falls, flip " + Math.max(0, shortfall()) + " more. The auditor is on her rounds.", "#8fc1ff");
    return true;
  }

  /* ---------------- driving the peds (update tick) ------------------------ */
  // step a controlled ped toward a point (peds.js hands controlled bodies to
  // their owner; this mirrors protection.js/social.js's own follow primitive).
  function stepPed(ped, tx, tz, speed, dt) {
    if (!ped || !ped.pos || !ped.group) return true;
    const dx = tx - ped.pos.x, dz = tz - ped.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.6) { ped.state = "idle"; ped.speed = 0; return true; }
    ped.state = "walk"; ped.speed = speed;
    const s = Math.min(d, speed * dt);
    ped.pos.x += (dx / d) * s; ped.pos.z += (dz / d) * s;
    ped.group.position.x = ped.pos.x; ped.group.position.z = ped.pos.z;
    ped.group.rotation.y = Math.atan2(dx, dz);
    return false;
  }
  function driveAuditor(dt) {
    const h = V.auditor, p = h && h.ped;
    if (!p || p.dead || !V.waypoints || !V.waypoints.length) return;
    const wp = V.waypoints[V.wpIdx % V.waypoints.length], t = worldOf(wp.x, wp.z);
    if (stepPed(p, t.x, t.z, AUDITOR_SPEED, dt)) {
      if (wp.desk && G.active && !G.result) auditorCheck();      // she reads the ledger at the records desk
      V.wpIdx = (V.wpIdx + 1) % V.waypoints.length;
      const nxt = V.waypoints[V.wpIdx];
      if (nxt && nxt.desk && G.active && !G.result) C.hud.feed("The auditor turns toward the records desk. If a bribe's on the ledger, shred it now.", "#e8c84a");
    }
  }
  function pullGuardToShredder() { if (V) V.guardAlertT = 6; }
  function driveGuard(dt) {
    const h = V.guard, p = h && h.ped; if (!p || p.dead) return;
    if (V.guardAlertT > 0) {
      if (!p.controlled) { p.controlled = true; p.staffPost = null; }
      const t = worldOf(V.shredderPos.x, V.shredderPos.z);
      stepPed(p, t.x, t.z, GUARD_SPEED, dt);
      V.guardAlertT -= dt;
    } else if (p.controlled) {
      const home = worldOf(V.guardPost.x, V.guardPost.z);
      if (stepPed(p, home.x, home.z, GUARD_SPEED, dt)) { p.controlled = false; p.staffPost = { x: home.x, z: home.z, face: V.guardPost.face }; p.state = "idle"; p.speed = 0; }
    }
  }

  /* ======================= BUILD ========================================= */
  function build(ctx, venue) {
    C = ctx;
    const g = venue.group;
    const lot = venue.lot;
    const hx = lot ? clampNum(6, 11, lot.w / 2 - 1.6) : 9;
    const hz = lot ? clampNum(6, 11, lot.d / 2 - 1.6) : 9;
    V = { _venue: venue, hx: hx, hz: hz, cast: false, realCount: 0, seats: [], seatMeta: [], shelves: [], waypoints: [], wpIdx: 0, guardAlertT: 0 };

    if (venue.kind === "dev") {   // dev pad: the harness mounts us on bare ground
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2 + 6, hz * 2 + 6), ctx.pmat(0x1a2029, 4));
      pad.rotation.x = -Math.PI / 2; pad.position.y = 0.02; g.add(pad);
    }

    // ---- seat layout + the seeded puzzle (deterministic: ctx.rand only) ----
    for (let i = 0; i < COUNCIL_N; i++) {
      const fx = COUNCIL_N === 1 ? 0 : (-0.72 + i * (1.44 / (COUNCIL_N - 1)));
      const x = fx * hx, z = -hz * 0.6 + Math.abs(i - (COUNCIL_N - 1) / 2) * 0.14;
      V.seats.push({ x: x, z: z });
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

    // ---- the bench + seats (the councillors sit here) ----
    ctx.box(g, 0, 0.5, -hz * 0.52, hx * 1.7, 0.9, 0.7, ctx.mat(COL.wood));
    ctx.box(g, 0, 0.98, -hz * 0.52 - 0.34, hx * 1.7, 0.16, 0.08, ctx.mat(COL.brass));
    ctx.solid(-hx * 0.85, -hz * 0.52 - 0.42, hx * 0.85, -hz * 0.52 + 0.42);
    // Proper high-backed council chairs. The old chair was one 0.5 × 0.92 ×
    // 0.5 upright block, so it had neither a visible seat nor a truthful seat
    // height and forced every councillor into character.js's compressed legacy
    // squat. These dimensions and COUNCIL_SEAT_H above are the same contract:
    // the rig's pelvis lands on the burgundy cushion and its feet reach floor.
    for (let i = 0; i < COUNCIL_N; i++) {
      const s = V.seats[i];
      const legH = COUNCIL_SEAT_H - 0.12;
      for (let dx = -1; dx <= 1; dx += 2) for (let dz = -1; dz <= 1; dz += 2)
        ctx.box(g, s.x + dx * 0.27, legH / 2, s.z + dz * 0.25, 0.08, legH, 0.08, ctx.mat(COL.woodD));
      ctx.box(g, s.x, COUNCIL_SEAT_H - 0.06, s.z, 0.70, 0.12, 0.68, ctx.mat(COL.red));
      ctx.box(g, s.x, COUNCIL_SEAT_H + 0.39, s.z - 0.29, 0.72, 0.78, 0.12, ctx.mat(COL.red));
      for (let dx = -1; dx <= 1; dx += 2) {
        ctx.box(g, s.x + dx * 0.38, 0.69, s.z + 0.02, 0.08, 0.08, 0.52, ctx.mat(COL.woodD));
        ctx.box(g, s.x + dx * 0.38, 0.56, s.z + 0.23, 0.08, 0.30, 0.08, ctx.mat(COL.woodD));
      }
    }

    // ---- the tally board on the wall behind the bench ----------------------
    // THE GLITCH, AND WHY IT WAS ARITHMETIC AND NOT TASTE. This board used to
    // be a ZERO-THICKNESS PlaneGeometry parked at z = -hz*0.9 while its backing
    // frame was a CENTRED box at -hz*0.9 - 0.06 with depth 0.12 — so the frame's
    // front face landed at exactly -hz*0.9 too. Two surfaces, one depth value,
    // no epsilon: the depth buffer cannot choose, so which one wins is decided
    // per pixel per frame by float noise, and the blue board uplight below is
    // aimed straight at the seam. That shimmer is the owner's "glitchy screen".
    //
    // THE FIX IS THE ONE EVERY OTHER SCREEN IN THIS CODEBASE ALREADY USES: a
    // screen is a SLAB WITH AIR BEHIND IT, not paint on a wall. BOARD_T gives
    // it real depth (so it cannot fight itself) and BOARD_GAP is honest air in
    // front of the frame — the same SCREEN_GAP convention as
    // interior_programs.js, buildings.js, exec_office.js and furniture.js, only
    // bigger, because this pane is 4.6 m wide and read from across a chamber.
    // Measured by CBZ.govBoardAudit().gap; the gate pins it >= 0.02.
    const frameZ = -hz * 0.9 - 0.06, frameD = 0.12;
    const frameFace = frameZ + frameD / 2;                                      // the frame's front plane
    V.frameMesh = ctx.box(g, 0, 2.75, frameZ, 4.9, 3.2, frameD, ctx.mat(0x11161d));   // backing frame
    V.board = makeBoard();
    // ONE mesh carries the map AND the emissiveMap (games/racing.js's timing
    // tower is the pattern), so the lit face and its glow are structurally
    // incapable of separating. It was the only big screen in the game with no
    // emissive term at all — an unlit MeshBasic pane reads as a painted board,
    // not a lit one. NEVER ctx.emat/ctx.mat here: those caches are keyed by
    // COLOUR and shared world-wide, so hanging a map on one repaints every
    // same-coloured box in every venue. A screen is always a fresh material.
    const bmat = new THREE.MeshLambertMaterial({
      color: 0xffffff, map: V.board.tex,
      emissive: 0xffffff, emissiveMap: V.board.tex, emissiveIntensity: BOARD_EI,
    });
    const bmesh = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W, BOARD_H, BOARD_T), bmat);
    bmesh.position.set(0, 2.75, frameFace + BOARD_GAP + BOARD_T / 2);
    bmesh.castShadow = false; bmesh.receiveShadow = false;
    g.add(bmesh);
    V.boardMesh = bmesh;
    V.screens = [bmesh];

    // ---- the chair / podium (the session hub) ----
    ctx.box(g, 0, 0.55, hz * 0.14, 0.95, 1.1, 0.72, ctx.mat(COL.woodD));
    ctx.box(g, 0, 1.16, hz * 0.14, 1.15, 0.1, 0.82, ctx.mat(COL.brass));
    ctx.solid(-0.55, hz * 0.14 - 0.42, 0.55, hz * 0.14 + 0.42);
    ctx.zone({ id: "session", pos: [0, hz * 0.14 + 1.25], r: 2.0, onUse: openSession,
      label: function () { return G.active ? "[E] The chair, call the vote" : (G.result ? "[E] The chamber (session over)" : "[E] Convene the Docklands session"); } });

    // ---- lobby each councillor at their seat ----
    for (let i = 0; i < COUNCIL_N; i++) {
      (function (i) {
        const s = V.seats[i];
        ctx.zone({ id: "seat" + i, pos: [s.x, s.z + 0.9], r: 1.1,
          // GRAMMAR LAW (owner): no names inside an option label — the member's
          // name belongs to the panel that opens; title + stance identify the seat.
          label: function () { const m = COUNCIL[i]; return m ? "[E] Lobby the " + m.title + " (" + m.stance.toUpperCase() + ")" : "[E] The council bench"; },
          onUse: function () { if (!ensureCouncil()) { C.hud.feed("The council hasn't taken their seats yet."); return; } openMember(i); } });
      })(i);
    }

    // ---- records room: partition + shelves (seeded dirt tables) ----
    ctx.box(g, -hx * 0.55, 1.4, -hz * 0.24, 0.25, 2.8, hz * 0.52, ctx.mat(COL.wall));
    ctx.solid(-hx * 0.55 - 0.15, -hz * 0.5, -hx * 0.55 + 0.15, 0.02);
    const NSHELF = 5;
    for (let i = 0; i < NSHELF; i++) {
      const z = -hz * 0.42 + i * (hz * 0.84 / (NSHELF - 1));
      ctx.box(g, -hx * 0.87, 1.05, z, 0.42, 2.1, 0.95, ctx.mat(COL.woodD));
      ctx.solid(-hx * 0.87 - 0.26, z - 0.5, -hx * 0.87 + 0.26, z + 0.5);
      const hasDirt = ctx.rand(i, 9, "sd") < 0.62;
      V.shelves.push({ searched: false, member: hasDirt ? Math.floor(ctx.rand(i, 10, "sm") * COUNCIL_N) : -1, line: DIRT_LINES[Math.floor(ctx.rand(i, 11, "sl") * DIRT_LINES.length)] });
      (function (i, z) {
        ctx.zone({ id: "shelf" + i, pos: [-hx * 0.66, z], r: 1.3,
          label: function () { return V.shelves[i].searched ? "[E] Shelf (already searched)" : "[E] Search the records shelf"; },
          onUse: function () { searchShelf(i); } });
      })(i, z);
    }

    // ---- supply cabinets: fetch a councillor's WANT object ----
    const SUPPLY = [
      { id: "bourbon", x: hx * 0.68, z: hz * 0.5 },
      { id: "survey",  x: -hx * 0.7, z: -hz * 0.05 },
      { id: "gavel",   x: 1.9, z: hz * 0.02 },
      { id: "polling", x: hx * 0.55, z: -hz * 0.42 },
    ];
    for (let i = 0; i < SUPPLY.length; i++) {
      (function (sp) {
        const it = WANT_ITEMS.filter(function (w) { return w.id === sp.id; })[0];
        ctx.box(g, sp.x, 0.7, sp.z, 0.7, 1.4, 0.6, ctx.mat(COL.wood));
        ctx.box(g, sp.x, 1.45, sp.z, 0.76, 0.12, 0.66, ctx.mat(COL.brass));
        ctx.solid(sp.x - 0.4, sp.z - 0.35, sp.x + 0.4, sp.z + 0.35);
        ctx.zone({ id: "supply_" + sp.id, pos: [sp.x, sp.z + 0.85], r: 1.2,
          label: function () { return (G.satchel && G.satchel[sp.id]) ? "[E] (taken) " + (it ? it.name : sp.id) : "[E] Take " + (it ? it.name : sp.id); },
          onUse: function () { pickUp(sp.id); } });
      })(SUPPLY[i]);
    }

    // ---- THE CLERK'S WINDOW: a barred counter in the lobby, opposite the
    //      press table. This is the door into elected politics — the one prop
    //      in the room that matters when there is NO session running, which
    //      is most of the time. Sited on the -x lobby wall so it reads on the
    //      way in, not tucked behind the bench. ----
    V.clerkPos = { x: -hx * 0.34, z: hz * 0.62 };
    ctx.box(g, V.clerkPos.x, 0.55, V.clerkPos.z, 1.9, 1.1, 0.6, ctx.mat(COL.wood));          // counter
    ctx.box(g, V.clerkPos.x, 1.16, V.clerkPos.z, 2.0, 0.1, 0.7, ctx.mat(COL.stone));         // stone sill
    ctx.box(g, V.clerkPos.x, 1.95, V.clerkPos.z, 1.9, 1.5, 0.08, ctx.mat(0x22282f));         // glass screen
    for (let bi = 0; bi < 5; bi++) {                                                          // the bars
      ctx.box(g, V.clerkPos.x - 0.7 + bi * 0.35, 1.95, V.clerkPos.z - 0.05, 0.05, 1.5, 0.05, ctx.mat(COL.brass));
    }
    ctx.solid(V.clerkPos.x - 1.0, V.clerkPos.z - 0.35, V.clerkPos.x + 1.0, V.clerkPos.z + 0.35);
    ctx.zone({ id: "clerkwindow", pos: [V.clerkPos.x, V.clerkPos.z - 0.95], r: 1.5,
      onUse: openClerkWindow,
      label: function () {
        const st = runState();
        if (st && st.filed) return "[E] The clerk's window, your filing";
        const seat = playerSeat();
        if (seat) return "[E] The clerk's window, the ballot";
        return "[E] The clerk's window, file for office";
      } });

    // ---- the lobby press (leak fears) ----
    V.reporterPost = { x: hx * 0.35, z: hz * 0.62, face: Math.PI };
    ctx.box(g, hx * 0.35, 0.5, hz * 0.72, 1.6, 1.0, 0.5, ctx.mat(COL.woodD));   // press table
    ctx.solid(hx * 0.35 - 0.85, hz * 0.72 - 0.3, hx * 0.35 + 0.85, hz * 0.72 + 0.3);
    ctx.zone({ id: "reporter", pos: [hx * 0.35, hz * 0.5], r: 1.4, onUse: openReporter, label: "[E] The lobby reporter, leak a secret" });

    // ---- security desk + guard (the jam responder) ----
    V.guardPost = { x: hx * 0.82, z: -hz * 0.08, face: -Math.PI / 2 };
    ctx.box(g, hx * 0.86, 0.55, -hz * 0.08, 0.5, 1.1, 2.0, ctx.mat(COL.woodD));  // desk
    ctx.solid(hx * 0.86 - 0.3, -hz * 0.08 - 1.05, hx * 0.86 + 0.3, -hz * 0.08 + 1.05);

    // ---- the shredder (clears the ledger; jams 30%) ----
    V.shredderPos = { x: hx * 0.78, z: -hz * 0.5 };
    ctx.box(g, hx * 0.78, 0.45, -hz * 0.5, 0.6, 0.9, 0.55, ctx.mat(0x232a33));
    ctx.box(g, hx * 0.78, 0.92, -hz * 0.5, 0.66, 0.08, 0.6, ctx.mat(0x14181e));
    ctx.solid(hx * 0.78 - 0.35, -hz * 0.5 - 0.32, hx * 0.78 + 0.35, -hz * 0.5 + 0.32);
    ctx.zone({ id: "shredder", pos: [hx * 0.78, -hz * 0.5 + 0.9], r: 1.2,
      label: function () { return "[E] Feed the shredder (" + (G && G.ledger ? G.ledger.length : 0) + " page)"; },
      onUse: function () { shredPage(); } });

    // ---- the auditor's posted patrol loop (records desk == the ledger) ----
    V.waypoints = [
      { x: -hx * 0.5, z: 0.0, desk: true },
      { x: 0.0, z: -hz * 0.16 },
      { x: hx * 0.5, z: -hz * 0.08 },
      { x: hx * 0.18, z: hz * 0.5 },
    ];

    // ---- lights (budget ≤ 8) ----
    ctx.light(0, 3.5, -hz * 0.3, 0xfff0d0, 0.95, hz * 3);
    ctx.light(-hx * 0.7, 3.0, 0, 0xffe0b0, 0.7, hz * 2);
    ctx.light(hx * 0.55, 3.0, hz * 0.35, 0xffe0b0, 0.7, hz * 2);
    ctx.light(hx * 0.75, 3.0, -hz * 0.3, 0xffd0a0, 0.6, hz * 1.6);
    ctx.light(0, 3.7, -hz * 0.85, 0x9fd0ff, 0.55, hz * 1.4);   // board uplight

    redrawBoard();
    if (canDrain()) drainCast(ctx);   // rebuild case: arena already live
  }

  /* ======================= REGISTER ====================================== */
  CBZ.games.register({
    id: "government",
    title: "CITY HALL AFTER DARK",
    venue: { lotKind: "cityhall" },
    build: build,
    update: function (ctx, dt) {
      if (!V || ctx.venue !== V._venue) return;
      if (canDrain()) drainCast(ctx);
      driveAuditor(dt);
      driveGuard(dt);
      tickClock(dt);
    },
    api: {
      rules: { tallyOf: tallyOf },
      tally: function () { return tallyOf(COUNCIL); },
      council: function () {
        return COUNCIL.map(function (m) { return { i: m.i, name: m.name, title: m.title, real: m.real, stance: m.stance, want: m.want.id, wantName: m.want.name, fear: m.fear, dirt: !!G.dirt[m.key], flippedBy: m.flippedBy }; });
      },
      state: function () {
        return {
          active: G.active, voted: G.voted, result: G.result,
          clockLeft: Math.round(G.clockLeft), scandal: Math.round(G.scandal),
          ledger: G.ledger.length,
          satchel: Object.keys(G.satchel).filter(function (k) { return G.satchel[k]; }),
          dirt: Object.keys(G.dirt).filter(function (k) { return G.dirt[k]; }),
          tally: tallyOf(COUNCIL), realCount: V ? V.realCount : 0, seated: COUNCIL.length,
        };
      },
      cast: function () { return V ? V.realCount : 0; },
      // levers (probe drives the game straight through these)
      start: function (opts) { return startNight(opts || { force: true }); },
      bribe: function (i) { return bribeMember(i); },
      trade: function (i) { return tradeWant(i); },
      blackmail: function (i) { return blackmailMember(i); },
      leak: function (i) { return pressLeak(i); },
      pickup: function (id) { return pickUp(id); },
      searchShelf: function (i) { return searchShelf(i); },
      shred: function () { return shredPage(); },
      auditorCheck: function () { return auditorCheck(); },
      callVote: function () { gavel("early"); return !!(G && G.result); },
      expireClock: function () { if (G) { G.clockLeft = 0; tickClock(0); } return !!(G && G.result); },
      // the political layer (all no-ops when statecraft/candidacy aren't loaded)
      chairs: function () { return playerChairsHere(); },
      override: function () { return chairOverride(); },
      clerkWindow: function () { openClerkWindow(); },
      // harness-only hooks — not part of the player-facing surface.
      _setStance: function (i, s) { if (COUNCIL[i]) { COUNCIL[i].stance = s; redrawBoard(); } },
      _drain: function () { return ensureCouncil(); },
      _gavel: function (why) { gavel(why || "test"); },
    },
  });

  /* ---------------- RATCHET: the board can never go coplanar again ---------
     EXPORT ONLY — tools/math-gate.mjs calls this, this file never does.
       gap      metres of real air between the board's BACK face and the backing
                frame's FRONT face, MEASURED off the two live meshes (their own
                geometry parameters), not read back off the constants that
                positioned them. Pin >= 0.02: at 0 the two surfaces share a
                depth value and the wall shimmers, which is the bug this fixes.
       emissive the board's emissiveIntensity — 0 means it went back to being an
                unlit painted panel.
       screens  how many lit screen surfaces this venue carries.
     `built` is false until the package has actually mounted a venue; the gate
     should read gap/emissive only when it is true, because an unmounted package
     has no geometry to measure and reporting the DESIGN numbers as if they were
     measured is precisely the "audit nobody ran" failure the doctrine names. */
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
