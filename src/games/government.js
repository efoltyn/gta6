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
  const NIGHT_SECONDS = 240;      // the evening, in gameplay seconds, to the gavel
  const BRIBE_COST = 5000;        // real city cash per envelope
  const WIN_PAYOUT = 60000;       // developer kickback on a passed rezoning
  const SCANDAL_PER_LEAK = 34;    // 3 leaks == cap == postponed vote (LOSE)
  const SCANDAL_CAP = 100;
  const JAM_SCANDAL = 8;
  const JAM_CHANCE = 0.30;        // shredder jam (runtime FX)
  const COOLDOWN_DAYS = 1;
  const AUDITOR_SPEED = 1.4, GUARD_SPEED = 1.6;

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
  function officeTitle(rec) {
    if (!rec) return "Councilmember";
    if (rec.kind === "country") return rec.govType === "monarchy" ? "Monarch" : "President";
    if (rec.kind === "state" || rec.kind === "federal") return "Governor";
    if (rec.kind === "city") return rec.tier === "village" ? "Chief" : "Mayor";
    return "Councilmember";
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
      if (i < offs.length) { name = offs[i].name; title = offs[i].title; real = true; key = "sid:" + offs[i].sid; V.realCount++; }
      else { name = fillName(i); title = "Councilmember"; key = "fill:" + i; }
      const handle = ctx.npc ? ctx.npc({ role: "councillor", name: name, outfit: { archetype: "exec" }, at: [seat.x, seat.z], face: 0, post: "pinned", pose: "sit" }) : null;
      COUNCIL.push({ i: i, key: key, name: name, title: title, real: real, handle: handle, want: meta.want, fear: meta.fear, baseStance: meta.baseStance, stance: meta.baseStance, flippedBy: null, dirtLine: null });
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

  /* ---------------- tally board (canvas texture) -------------------------- */
  function makeBoard() {
    const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 320;
    const cc = canvas.getContext("2d");
    const tex = new THREE.CanvasTexture(canvas);
    return { canvas: canvas, cc: cc, tex: tex };
  }
  function redrawBoard() {
    if (!V || !V.board) return;
    const cc = V.board.cc, W = 512, H = 320;
    cc.fillStyle = "#0e141c"; cc.fillRect(0, 0, W, H);
    cc.fillStyle = "#8fc1ff"; cc.font = "700 25px 'Trebuchet MS',Verdana,sans-serif"; cc.textAlign = "center";
    cc.fillText("DOCKLANDS REZONING — THE VOTE", W / 2, 33);
    cc.font = "600 20px 'Trebuchet MS',Verdana,sans-serif";
    if (!COUNCIL.length) { cc.fillStyle = "#7e8aa3"; cc.fillText("the council has not yet been seated", W / 2, 170); V.board.tex.needsUpdate = true; return; }
    cc.textAlign = "left";
    for (let i = 0; i < COUNCIL.length; i++) {
      const m = COUNCIL[i], y = 74 + i * 30;
      cc.fillStyle = "#cfd6dd"; cc.fillText((i + 1) + ". " + shortName(m.name) + (m.real ? "" : " *"), 22, y);
      const st = m.stance, col = st === "for" ? "#5fd08a" : st === "against" ? "#ff6a5e" : "#c9a24a";
      cc.fillStyle = col; cc.textAlign = "right"; cc.fillText(st.toUpperCase(), W - 22, y); cc.textAlign = "left";
    }
    const t = tallyOf(COUNCIL);
    cc.fillStyle = G.result === "win" ? "#5fd08a" : G.scandal >= SCANDAL_CAP ? "#ff6a5e" : "#9aa6bd";
    cc.font = "700 18px 'Trebuchet MS',Verdana,sans-serif"; cc.textAlign = "center";
    const foot = G.result ? resultLine().toUpperCase()
      : "FOR " + t.for + "   AGAINST " + t.against + "   ABSTAIN " + t.abstain + "   (need FOR > AGAINST)";
    cc.fillText(foot, W / 2, 300);
    V.board.tex.needsUpdate = true;
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
      case "lose:scandal": return "vote postponed — scandal";
      case "lose:tie": return "deadlocked — tie fails";
      case "lose:vote": return "rezoning failed";
      default: return "";
    }
  }

  /* ================= THE CHAIR / SESSION HUB ============================== */
  function openSession() {
    if (!C) return;
    const t = tallyOf(COUNCIL);
    let body = head("CITY HALL — DOCKLANDS REZONING", G.active ? clockStr() : "after dark");
    body += "<div style='margin:2px 0 8px;line-height:1.55'>";
    body += "Tally: <b style='color:#5fd08a'>FOR " + t.for + "</b> · <b style='color:#ff6a5e'>AGAINST " + t.against + "</b> · <b style='color:#c9a24a'>UNDECIDED " + t.abstain + "</b> — need FOR &gt; AGAINST.<br>";
    body += "Scandal <b style='color:" + (G.scandal >= SCANDAL_CAP * 0.6 ? "#ff6a5e" : "#9aa6bd") + "'>" + Math.min(100, Math.round(G.scandal)) + "%</b>/" + SCANDAL_CAP + " · Ledger <b>" + G.ledger.length + "</b> page(s) · Cash <b>" + fmt(C.wallet.cash()) + "</b>";
    body += "</div>";
    if (G.result) {
      body += "<div style='margin:6px 0;font-weight:800;color:" + (G.result === "win" ? "#5fd08a" : "#ff6a5e") + "'>" + resultLine().toUpperCase() + "</div>";
      body += btn("close", "Leave", "#26343c");
    } else if (!G.active) {
      if (startable()) body += "<div style='opacity:.85;margin-bottom:6px'>Convene the session and flip the room before the gavel. Bribe, trade favors, dig the records, or lean on the press — just don't let the auditor read your ledger.</div>" + btn("start", "CONVENE THE SESSION", "#1c6b40");
      else body += "<div style='opacity:.7'>The chamber is dark tonight — the clerk's locked up. Come back tomorrow.</div>";
      body += " " + btn("close", "Leave", "#26343c");
    } else {
      body += "<div style='opacity:.8;font-size:12px;margin-bottom:6px'>Flip " + Math.max(0, shortfall()) + " more to carry it. Lobby councillors at their seats; the records room, the cabinets, the press and the shredder are down the halls.</div>";
      body += btn("callvote", "CALL THE VOTE NOW", "#c98f22") + btn("close", "Keep working", "#26343c");
    }
    C.hud.panel(body, {
      start: function () { startNight(); openSession(); },
      callvote: function () { C.hud.closePanel(); gavel("early"); },
      close: function () { C.hud.closePanel(); },
    });
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
    let body = head("THE LOBBY PRESS", "a leak flips a vote — and stains the room");
    if (!G.active) { C.hud.panel(head("THE LOBBY PRESS", "quiet") + "<div style='opacity:.7'>No session tonight.</div>" + btn("close", "Back", "#26343c"), { close: function () { C.hud.closePanel(); } }); return; }
    body += "<div style='margin:2px 0 8px'>Scandal <b style='color:" + (G.scandal >= SCANDAL_CAP * 0.6 ? "#ff6a5e" : "#9aa6bd") + "'>" + Math.min(100, Math.round(G.scandal)) + "%</b> / " + SCANDAL_CAP + "% — at the cap the chair postpones the vote (you lose).</div>";
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
    C.hud.feed("💵 " + shortName(m.name) + " pockets the envelope. It's on the ledger now — shred it before the auditor reads it.", "#ffd166");
    return true;
  }
  function tradeWant(i) {
    if (!G.active) return false;
    const m = COUNCIL[i]; if (!m || m.stance === "for") return false;
    if (!G.satchel[m.want.id]) { C.hud.feed("You're not carrying " + m.want.name + ".", "#ff9aa2"); return false; }
    G.satchel[m.want.id] = false;
    flip(i, "traded");
    C.hud.feed("🤝 You hand over " + m.want.name + ". " + shortName(m.name) + " is an AYE.", "#8fe08a");
    return true;
  }
  function blackmailMember(i) {
    if (!G.active) return false;
    const m = COUNCIL[i]; if (!m || m.stance === "for") return false;
    if (!G.dirt[m.key]) { C.hud.feed("You've got nothing on " + shortName(m.name) + " yet — try the records room.", "#ff9aa2"); return false; }
    flip(i, "blackmailed");
    C.hud.feed("🗂️ You slide the file across. " + shortName(m.name) + " won't cross you tonight.", "#8fe08a");
    return true;
  }
  function pressLeak(i) {
    if (!G.active) return false;
    const m = COUNCIL[i]; if (!m || m.stance === "for") return false;
    flip(i, "pressured");
    G.scandal += SCANDAL_PER_LEAK;
    C.hud.feed("📰 The reporter runs with " + shortName(m.name) + "'s " + m.fear + ". They flip to AYE — but the room reeks.", "#e8c84a");
    redrawBoard();
    if (G.scandal >= SCANDAL_CAP) postpone();
    return true;
  }
  function pickUp(itemId) {
    if (!G.active) { C.hud.feed("Nothing worth taking until the session convenes."); return false; }
    if (G.satchel[itemId]) { C.hud.feed("Already in your bag."); return false; }
    G.satchel[itemId] = true;
    const it = WANT_ITEMS.filter(function (w) { return w.id === itemId; })[0];
    C.hud.feed("🎒 You take " + (it ? it.name : "the item") + ".", "#cfe8ff");
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
      C.hud.feed("🔦 Buried in the files: " + sh.line + " — on " + m.name + ".", "#ffd166");
      return true;
    }
    C.hud.feed("🔦 Dust, old zoning maps, nothing you can use.");
    return false;
  }
  function shredPage() {
    if (!G) return { cleared: true, jammed: false };
    if (G.ledger.length === 0) { C.hud.feed("The ledger's already clean."); return { cleared: true, jammed: false }; }
    const n = G.ledger.length; G.ledger.length = 0;      // the page goes through — shred ALWAYS clears
    const jam = Math.random() < JAM_CHANCE;              // runtime FX RNG is allowed
    if (jam) {
      G.scandal += JAM_SCANDAL; pullGuardToShredder();
      C.hud.feed("🌀 The shredder JAMS — a horrible grinding shriek. The desk guard is coming over.", "#ff9aa2");
      redrawBoard();
      if (G.active && G.scandal >= SCANDAL_CAP) postpone();
    } else {
      C.hud.feed("🗑️ " + n + " ledger page(s) shredded — clean and quiet.", "#8fe08a");
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
    if (CBZ.city && CBZ.city.big) CBZ.city.big("💼 INDICTED — THE AUDITOR FOUND THE LEDGER");
    C.hud.feed("💼 The auditor photographs your ledger page. The rezoning is dead and so is your night.", "#ff6a5e");
  }
  function postpone() {
    if (!G || G.result) return;
    G.active = false; G.voted = true; G.result = "lose:scandal";
    setCooldown(); redrawBoard();
    if (CBZ.city && CBZ.city.big) CBZ.city.big("📰 VOTE POSTPONED — SCANDAL ENGULFS THE CHAMBER");
    C.hud.feed("📰 Too much stink. The chair gavels the session closed — the rezoning is tabled indefinitely.", "#ff6a5e");
  }
  function win(t) {
    G.result = "win";
    C.wallet.give(WIN_PAYOUT, "Docklands rezoning — developer kickback");
    if (CBZ.city && CBZ.city.big) CBZ.city.big("🏗️ DOCKLANDS REZONING PASSES " + t.for + "–" + t.against);
    C.hud.feed("🏗️ The gavel falls. Rezoning carries " + t.for + "–" + t.against + " — the Docklands waterfront is your crew's turf now.", "#8fe08a");
  }
  function lose(t) {
    G.result = t.for === t.against ? "lose:tie" : "lose:vote";
    if (CBZ.city && CBZ.city.big) CBZ.city.big("🔨 REZONING FAILS " + t.for + "–" + t.against);
    C.hud.feed("🔨 " + (t.for === t.against ? "Deadlocked " + t.for + "–" + t.against + " — a tie fails." : "Rezoning fails " + t.for + "–" + t.against + ".") + " The Docklands stay as they are.", "#ff6a5e");
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
      let body = head("ROLL CALL — DOCKLANDS REZONING", "the gavel");
      for (let i = 0; i < shown; i++) {
        const L = lines[i], col = L.vote === "AYE" ? "#5fd08a" : L.vote === "NAY" ? "#ff6a5e" : "#c9a24a";
        body += "<div style='margin:2px 0'>" + (i + 1) + ". " + L.name + " — <b style='color:" + col + "'>" + L.vote + "</b></div>";
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
    if (!force && !startable()) { C.hud.feed("Not tonight — the chamber's on cooldown."); return false; }
    for (let i = 0; i < COUNCIL.length; i++) { const m = COUNCIL[i]; m.stance = m.baseStance; m.flippedBy = null; m.dirtLine = null; }
    if (V.shelves) for (let i = 0; i < V.shelves.length; i++) V.shelves[i].searched = false;
    G = idleGame(); G.active = true; G.clockLeft = NIGHT_SECONDS;
    V.wpIdx = 0; V.guardAlertT = 0;
    redrawBoard();
    if (CBZ.city && CBZ.city.big) CBZ.city.big("🏛️ CITY HALL AFTER DARK — PASS THE DOCKLANDS REZONING BY THE GAVEL");
    C.hud.feed("🏛️ Session convened. FOR must beat AGAINST when the gavel falls — flip " + Math.max(0, shortfall()) + " more. The auditor is on her rounds.", "#8fc1ff");
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
      if (nxt && nxt.desk && G.active && !G.result) C.hud.feed("🕵️ The auditor turns toward the records desk. If a bribe's on the ledger, shred it now.", "#e8c84a");
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
    for (let i = 0; i < COUNCIL_N; i++) { const s = V.seats[i]; ctx.box(g, s.x, 0.46, s.z - 0.16, 0.5, 0.92, 0.5, ctx.mat(COL.woodD)); }

    // ---- the tally board (canvas texture) on the wall behind the bench ----
    V.board = makeBoard();
    const bmesh = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.9), new THREE.MeshBasicMaterial({ map: V.board.tex }));
    bmesh.position.set(0, 2.75, -hz * 0.9); g.add(bmesh);
    ctx.box(g, 0, 2.75, -hz * 0.9 - 0.06, 4.9, 3.2, 0.12, ctx.mat(0x11161d));   // backing frame

    // ---- the chair / podium (the session hub) ----
    ctx.box(g, 0, 0.55, hz * 0.14, 0.95, 1.1, 0.72, ctx.mat(COL.woodD));
    ctx.box(g, 0, 1.16, hz * 0.14, 1.15, 0.1, 0.82, ctx.mat(COL.brass));
    ctx.solid(-0.55, hz * 0.14 - 0.42, 0.55, hz * 0.14 + 0.42);
    ctx.zone({ id: "session", pos: [0, hz * 0.14 + 1.25], r: 2.0, onUse: openSession,
      label: function () { return G.active ? "[E] The chair — call the vote" : (G.result ? "[E] The chamber (session over)" : "[E] Convene the Docklands session"); } });

    // ---- lobby each councillor at their seat ----
    for (let i = 0; i < COUNCIL_N; i++) {
      (function (i) {
        const s = V.seats[i];
        ctx.zone({ id: "seat" + i, pos: [s.x, s.z + 0.9], r: 1.1,
          label: function () { const m = COUNCIL[i]; return m ? "[E] Lobby " + m.title + " " + shortName(m.name) + " (" + m.stance.toUpperCase() + ")" : "[E] The council bench"; },
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

    // ---- the lobby press (leak fears) ----
    V.reporterPost = { x: hx * 0.35, z: hz * 0.62, face: Math.PI };
    ctx.box(g, hx * 0.35, 0.5, hz * 0.72, 1.6, 1.0, 0.5, ctx.mat(COL.woodD));   // press table
    ctx.solid(hx * 0.35 - 0.85, hz * 0.72 - 0.3, hx * 0.35 + 0.85, hz * 0.72 + 0.3);
    ctx.zone({ id: "reporter", pos: [hx * 0.35, hz * 0.5], r: 1.4, onUse: openReporter, label: "[E] The lobby reporter — leak a secret" });

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
      // harness-only hooks — not part of the player-facing surface.
      _setStance: function (i, s) { if (COUNCIL[i]) { COUNCIL[i].stance = s; redrawBoard(); } },
      _drain: function () { return ensureCouncil(); },
      _gavel: function (why) { gavel(why || "test"); },
    },
  });
})();
