/* ============================================================
   city/civic.js — THE CIVIC DESK.

   buildings_civic.js put seven government buildings in the world and
   furnished them properly: a judge's bench with gallery pews, a DMV queue
   snake under a NOW-SERVING board, a wall of PO boxes, library stacks, a
   fire house apparatus bay, a metal detector inside the federal door. Each
   one is a normal `arena.shopLots` entry with a real door, a real vendor
   spot and a real clerk ped standing at the counter — and every one of them
   fell through to interact.js's generic "Shop here", opened shops.js's
   storefront panel, and offered NOTHING. Seven finished rooms with no verb.

   This file is the verb. It writes no geometry and opens no second UI: the
   clerk at the counter IS the desk, shops.js's counter panel IS the window,
   and every row below is spliced into that panel's existing SERVICES block
   through ONE seam (CBZ.civic.services). interact.js gets its verb text
   from the same place (CBZ.civic.verb), so a civic trade is described in
   exactly one table.

   THE RULE EVERY ROW HERE OBEYS (CLAUDE.md's ban on stat fictions): a
   service must MOVE AN OBJECT THAT ALREADY EXISTS. So —
     · the courthouse writes wanted.js's real heat (clearWanted)
     · the DMV writes vehicles.js's real car.stolen/car.owned, the two
       booleans wanted.js and interact.js actually read
     · the library reads elections.js's real district blocs and polity.js's
       real officeholders
     · the post office runs core/mission.js and pays a mayor out of the
       polity record's real treasury
     · the federal desk seizes a real gang's real treasury and flips its
       real hostility, so a real reprisal squad comes for you
     · the fire house binds to structural.js's real burning buildings and
       vehicles.js's real `_onFire` cars — and says "no calls" when the city
       is not on fire, rather than inventing one (contracts.js's binding
       rule, which is binding)
   Anything that could not be made real was CUT, not stubbed. See the CUTS
   note at the bottom of this header block.

   THE DMV QUEUE IS THE ONE PIECE OF NEW MECHANIC. A Department of Records
   where you press a key and it happens is a betrayal of the joke. You take
   a ticket, the NOW-SERVING number walks up the sim clock whether you stand
   there or not, and the window will not serve you until your number is
   called. Draw a gun in the hall or pick up a star while you wait and the
   hall clears and you lose your place. The whole wait is under 45 sim
   seconds — texture, not a tax.

   HOURS. Government offices keep government hours (9-17) and are shut at
   night; the fire house never closes. shops.js's shopShut() asks
   CBZ.civic.hours() first and falls back byte-for-byte to its own
   SHUT_KINDS table when this file is absent.

   EVERYTHING CROSS-FILE IS FEATURE-DETECTED. CBZ.cityRun (candidacy.js)
   and CBZ.gov (statecraft.js) are siblings in this same wave written by
   other hands: where they are missing the row either hides or degrades to
   the honest truth, and never to a fake.

   CUTS (deliberate, per the no-stat-fictions law):
     · ZONING PERMITS at the annex — games/government.js's rezoning lives
       entirely inside its own council-night session and exposes no permit
       to sell. There is no object to move, so there is no row.
     · A LIBRARY→BLACKMAIL handoff — CBZ.games.api.government.blackmail(i)
       needs an ACTIVE council night and its own `G.dirt[m.key]` seeded by
       its own searchShelf(); there is no clean "here is dirt on this sid"
       entry point and government.js is not ours to edit this wave. The
       archive stamps the campaign hook instead and the dossier is real.

   Flag: CBZ.CONFIG.CIVIC_DESKS (self-defaulted below — config.js is not
   ours). Off → verb(), services() and hours() all go quiet and every
   caller is exactly as it was before this file loaded.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game || (CBZ.game = {});

  CBZ.CONFIG = CBZ.CONFIG || {};
  // CIVIC_DESKS — the whole file. One-line revert: the seven civic counters
  // go back to the generic "Shop here" with an empty SERVICES block.
  if (CBZ.CONFIG.CIVIC_DESKS == null) CBZ.CONFIG.CIVIC_DESKS = true;
  function on() { return CBZ.CONFIG.CIVIC_DESKS !== false; }

  // ============================================================
  //  SMALL SHARED PLUMBING
  // ============================================================
  const KINDS = ["courthouse", "federal", "library", "cityannex", "postoffice", "dmv", "firestation"];
  const KINDSET = {}; for (let i = 0; i < KINDS.length; i++) KINDSET[KINDS[i]] = 1;

  function P() { return CBZ.player || null; }
  function arena() { return (CBZ.city && CBZ.city.arena) || null; }
  function fmt$(n) { return "$" + (Math.round(n) | 0).toLocaleString("en-US"); }
  function dim(s) { return " <span style='color:#7f8794'>" + s + "</span>"; }
  // WHO IS TALKING. mode.js's phoneWorthy() (the one chokepoint every city.note
  // funnels through) DROPS a message outright unless it carries a real sender or
  // app — an unattributed clerk line is deleted before it ever reaches the
  // player, silently. So every line out of this file is signed by the desk that
  // said it, which is also just correct: the phone shows a message FROM the
  // Clerk of the Court, not a floating card. (HUD doctrine: the killfeed is the
  // only popup; rich desk state lives in the counter panel and the phone.)
  const DESK_NAME = {
    courthouse: "Clerk of the Court", federal: "Federal Building",
    library: "Public Library", cityannex: "City Hall Annex",
    postoffice: "Post Office", dmv: "Records & Licensing",
    firestation: "Engine Co. 7",
  };
  let DESK = "Front Desk";   // stamped by services(kind) — see the note there
  function note(msg, sec, opts) {
    if (CBZ.city && CBZ.city.note) CBZ.city.note(msg, sec == null ? 2.2 : sec, opts || { from: DESK, app: "messages" });
  }
  function feed(msg, opts) { if (CBZ.cityFeed) CBZ.cityFeed(msg, "#cfd8e6", opts); }
  function coin() { if (CBZ.sfx) CBZ.sfx("coin"); }
  function day() { return CBZ.worldDay ? CBZ.worldDay() : 0; }
  function stars() { return g.wanted | 0; }
  function armed() { return !!(CBZ.cityHasGun && CBZ.cityHasGun()); }
  function repaint() { if (CBZ.cityShopRender) CBZ.cityShopRender(); }

  // per-run desk state. Everything here is a POINTER into real systems (a lot
  // ref, a sid, an index) or a clock — never a shadow copy of something a
  // real system already owns.
  function st() {
    if (!g.cityCivic) {
      g.cityCivic = {
        q: null,          // the live DMV ticket {lot, num, serving, t, called, w0}
        read: null,       // the live library read {sid, id, t, need}
        recIdx: 0,        // courthouse: which office in the city→state→country chain
        gangIdx: 0,       // federal: which crew the informant desk is naming
        officeIdx: 0,     // annex: which office on cityRun's ballot list
        tax: 0, police: 0,  // annex: the platform sliders, -1..1
        paidDay: -1,      // post office: last day the paycheque was drawn
        informed: {},     // federal: gangId -> day you last sold them out
      };
    }
    return g.cityCivic;
  }

  // string → int, so a sid can ride CBZ.hash01's position-hash channel. Same
  // shape as core/seed.js's own strHash; kept local so this file adds no
  // draws to any shared rng stream (determinism law).
  function sHash(s) {
    let h = 2166136261 >>> 0;
    s = String(s || "");
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h % 100000;
  }
  function h01(a, b, salt) { return CBZ.hash01 ? CBZ.hash01(a, b, salt) : 0.5; }

  // ---- the civic lots the WORLD built (never a list of our own) ------------
  let lotCache = null, lotCacheFor = null;
  function civicLots() {
    const A = arena();
    if (!A) return {};
    if (lotCache && lotCacheFor === A) return lotCache;
    const out = {};
    const src = (A.shopLots && A.shopLots.length) ? A.shopLots : (A.lots || []);
    for (let i = 0; i < src.length; i++) {
      const l = src[i];
      if (!l || !l.kind || !KINDSET[l.kind]) continue;
      if (!out[l.kind]) out[l.kind] = l;
    }
    lotCache = out; lotCacheFor = A;
    return out;
  }
  function insideLot(lot, pad) {
    const p = P(); if (!p || !lot || !p.pos) return false;
    return Math.abs(p.pos.x - lot.cx) < lot.w / 2 + (pad || 2) &&
           Math.abs(p.pos.z - lot.cz) < lot.d / 2 + (pad || 2);
  }
  // where a desk's crime/heat should be stamped: the door the player used.
  function lotAt(lot) {
    const d = lot && lot.building && lot.building.door;
    const p = P();
    if (d) return { x: d.x, z: d.z };
    if (lot) return { x: lot.cx, z: lot.cz };
    return p && p.pos ? { x: p.pos.x, z: p.pos.z } : { x: 0, z: 0 };
  }

  // ---- polity / officials, read-only -------------------------------------
  function hereRec() {
    const p = P();
    if (!CBZ.polity || !CBZ.polity.of || !p || !p.pos) return null;
    return CBZ.polity.of(p.pos.x, p.pos.z);
  }
  // the city→state→country chain over the ground you are standing on. Real
  // records, in the order a clerk would pull the files.
  function chain() {
    const out = [];
    let r = hereRec();
    if (!r && CBZ.polity && CBZ.polity.get) r = CBZ.polity.get("libertyville");
    while (r) {
      out.push(r);
      r = (r.parent && CBZ.polity.get) ? CBZ.polity.get(r.parent) : null;
      if (out.length > 4) break;
    }
    return out;
  }
  // THE LADDER LIVES IN ONE FILE. officials.js exports titleFor() (it was
  // private when the comment this replaces was written); the hand-typed
  // kind->title copy this file carried is deleted — that copy was one of the
  // EIGHT doctrine counts, and the count only goes down. Degrade: "Official".
  function titleOf(rec) {
    if (CBZ.officials && CBZ.officials.titleFor) { try { const t = CBZ.officials.titleFor(rec); if (t) return t; } catch (e) {} }
    return "Official";
  }
  function holderId(rec) {
    const sid = rec && rec.office && rec.office.holder;
    if (sid && CBZ.officials && CBZ.officials.identityOf) return CBZ.officials.identityOf(sid);
    return { name: sid ? "Someone" : "(vacant)", gender: "f" };
  }

  // ---- sibling modules (this wave), all optional --------------------------
  function run() { return CBZ.cityRun || null; }
  function gov() { return CBZ.gov || null; }
  function holdsSeat() { const G = gov(); try { return G && G.holds ? G.holds() : null; } catch (e) { return null; } }
  function stampHook(sid, kind, text) {
    const R = run();
    if (R && R.hook) { try { R.hook(sid, { kind: kind, note: text }); return true; } catch (e) {} }
    return false;
  }

  // ============================================================
  //  COURTHOUSE — the Clerk of the Court
  // ============================================================
  // a fine settles a DOCKET, not a manhunt. Four and five stars are a
  // warrant: the clerk will not take your money, because at that point the
  // city is not looking for a payment.
  function fineCost() { return Math.round(220 * stars() + (g.heat || 0) * 0.30); }
  function copsClose() {
    const p = P(), cops = CBZ.cityCops;
    if (!p || !p.pos || !cops) return false;
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i];
      if (!c || c.dead || !c.pos) continue;
      const dx = c.pos.x - p.pos.x, dz = c.pos.z - p.pos.z;
      if (dx * dx + dz * dz < 55 * 55) return true;
    }
    return false;
  }
  function fineLabel() {
    const s = stars();
    if (s <= 0) return "Settle the docket" + dim("nothing outstanding");
    if (s >= 4) return "Settle the docket" + dim("that's a warrant, not a fine");
    return "Pay your fine " + fmt$(fineCost()) + dim(s + "★, clears the record");
  }
  function payFine() {
    const s = stars();
    if (s <= 0) { note("“Nothing outstanding against you. Have a good day.”", 2); return; }
    if (s >= 4) {
      note("“That's a warrant, not a fine. I can't take your money for that, turn yourself in or run.”", 3);
      return;
    }
    if (copsClose() && s >= 1) {
      note("“There are officers in this building looking for you. Step away from my window.”", 3);
      return;
    }
    const cost = fineCost();
    if (!CBZ.city.spend(cost)) { note("The docket comes to " + fmt$(cost) + ". You're short.", 2.4); return; }
    coin();
    if (CBZ.city.clearWanted) CBZ.city.clearWanted();
    note("Fine paid · " + fmt$(cost) + ". The clerk stamps it and the record closes.", 2.6, { from: "Clerk of the Court", app: "messages" });
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    repaint();
  }

  // COURT RECORDS — the public file on a real officeholder, pulled off the
  // real polity record, for a real fee. Each press walks one step further up
  // the city→state→country chain you are standing in.
  const RECORD_FEE = 90;
  function recordTarget() {
    const c = chain();
    if (!c.length) return null;
    return c[st().recIdx % c.length];
  }
  function recordsLabel() {
    const rec = recordTarget();
    if (!rec) return "Records of the court" + dim("no jurisdiction on file here");
    return "Records of the court " + fmt$(RECORD_FEE) + dim("public file: " + titleOf(rec) + " of " + rec.name);
  }
  function pullRecord() {
    const rec = recordTarget();
    if (!rec) { note("“No jurisdiction on file for this address.”", 2.2); return; }
    if (!CBZ.city.spend(RECORD_FEE)) { note("Copies run " + fmt$(RECORD_FEE) + ".", 2); return; }
    coin();
    st().recIdx = (st().recIdx + 1) % Math.max(1, chain().length);
    const id = holderId(rec), title = titleOf(rec);
    const term = rec.office && rec.office.termDay;
    const left = term != null ? Math.max(0, term - day()) : null;
    const appr = rec.approval != null ? Math.round(rec.approval) : null;
    const line = title + " " + id.name + " · " + rec.name +
      (appr != null ? " · approval " + appr + "%" : "") +
      (left != null ? " · term ends day " + term + " (" + left + " left)" : "") +
      " · treasury " + fmt$(rec.treasury || 0) + " · tax " + Math.round((rec.taxRate || 0) * 100) + "%";
    note(line, 4, { from: "Clerk of the Court", app: "messages" });
    // the payload: a campaign HOOK the run can spend later. Absent cityRun the
    // dossier above is still the service — the information IS the product.
    const sid = rec.office && rec.office.holder;
    if (sid && stampHook(sid, "record", "court file pulled on " + title + " " + id.name + " of " + rec.name)) {
      note("Filed a copy for the campaign.", 1.8);
    }
    repaint();
  }

  // ---- the pardon: statecraft.js's, not ours ------------------------------
  function canPardon() { return !!(gov() && gov().pardon && holdsSeat()); }
  function signPardon() {
    const G = gov();
    if (!G || !G.pardon) { note("There is no seat to sign from.", 2); return; }
    const at = lotAt(civicLots().courthouse);
    let r = null;
    try { r = G.pardon({ at: at }); } catch (e) { r = null; }
    if (!r || !r.ok) { note(r && r.why ? r.why : "The pardon does not carry.", 2.6); return; }
    note("Signed. The clerk enters it on the docket.", 2.4, { from: "Clerk of the Court", app: "messages" });
    repaint();
  }

  // ============================================================
  //  DMV — Dept. of Records & Licensing. THE QUEUE IS THE MECHANIC.
  // ============================================================
  const Q_STEP = 11;          // sim-seconds the window spends on each number
  const Q_AHEAD_MIN = 2;      // you are always at least this far back
  function q() { return st().q; }
  function qLive() { const t = q(); return !!(t && t.lot && !t.done); }

  function takeTicket() {
    const lot = civicLots().dmv;
    if (!lot) { note("There's no records office on this map.", 2); return; }
    const t = q();
    if (t && !t.done) {
      note("You already hold ticket " + t.num + ". The board reads " + t.serving + ".", 2.2);
      return;
    }
    // deterministic per lot per day: the hall is as busy today as the seed says
    const ahead = Q_AHEAD_MIN + Math.floor(h01(lot.cx, lot.cz, 0x515 + day()) * 3);   // 2..4
    const base = 40 + Math.floor(h01(lot.cz, lot.cx, 0x516 + day()) * 55);
    st().q = { lot: lot, num: base + ahead, base: base, serving: base, t: 0, called: false, done: false, w0: stars() };
    note("Ticket " + (base + ahead) + ". The board reads " + base + ". Take a seat.", 2.6,
      { from: "Records & Licensing", app: "messages" });
    repaint();
  }
  function qReset(why) {
    if (!qLive()) return;
    st().q = null;
    note(why, 2.6, { from: "Records & Licensing", app: "messages" });
    repaint();
  }
  function qLabel() {
    const t = q();
    if (!t || t.done) return "Take a number" + dim("the window won't look at you without one");
    if (t.called) return "You're up, window " + (1 + (t.num % 3)) + dim("NOW SERVING " + t.serving);
    return "Waiting · your ticket " + t.num + dim("NOW SERVING " + t.serving + " — " + Math.max(1, Math.ceil((t.num - t.base) * Q_STEP - t.t)) + "s");
  }
  function qGate() {
    const t = q();
    if (!t || t.done) { note("“Take a number first.” She does not look up.", 2.2); return false; }
    if (!t.called) { note("“Number " + t.serving + ". That's not you.”", 2.2); return false; }
    return true;
  }

  // ---- registering a vehicle: the ONE transformation that matters ---------
  // car.stolen and car.owned are the two booleans the rest of the game
  // actually reads — wanted.js's theft wrap (wanted.js:411), interact.js's
  // GET IN vs BOOST IT verbs, restrain.js's "your ride" scan, the chop-shop
  // payout fraction. Titling a car here writes exactly those two, so a
  // registered car stops being hot everywhere at once.
  function targetCar() {
    const p = P(); if (!p || !p.pos) return null;
    if (p.driving && p._vehicle) return p._vehicle;
    return CBZ.cityNearestCar ? CBZ.cityNearestCar(p.pos.x, p.pos.z, 8) : null;
  }
  function titleFee(car) {
    const m = car && car.model;
    const val = (m && (m.price || m.value)) || 0;
    return Math.max(250, Math.round(250 + val * 0.05));
  }
  function regLabel() {
    const car = targetCar();
    if (!car) return "Register a vehicle" + dim("drive one up, or park within 8m");
    const nm = (car.model && car.model.name) || "the vehicle";
    if (car.owned) return "Register a vehicle" + dim(nm + " is already titled to you");
    return "Register " + nm + " " + fmt$(titleFee(car)) + dim(car.stolen ? "it's hot, the title launders it" : "clean title");
  }
  function registerCar() {
    if (!qGate()) return;
    const car = targetCar();
    if (!car) { note("“Bring the vehicle to the window, or park it out front.”", 2.4); return; }
    const nm = (car.model && car.model.name) || "Vehicle";
    if (car.owned) { note("“That one's already titled to you.”", 2); return; }
    if (car.dead || car._exploded) { note("“I can't title a wreck.”", 2); return; }
    // hot with cops ON it: the clerk runs the plate and it comes back flagged.
    if (stars() >= 1 || (car.npcWanted || 0) > 0 || (car.pullover || 0) > 0) {
      note("“The plate comes back flagged and there are units on it. Not today.”", 3);
      return;
    }
    const fee = titleFee(car);
    if (!CBZ.city.spend(fee)) { note("Title and plates run " + fmt$(fee) + ".", 2.4); return; }
    coin();
    const wasHot = !!car.stolen;
    car.stolen = false;
    car.owned = true;                      // the field every ownership reader uses
    st().q = null;                          // served — the ticket is spent
    note(wasHot
      ? "Titled. The " + nm + " is legally yours now, the plate comes back clean."
      : "Titled and plated. The " + nm + " is on the register in your name.",
      3, { from: "Records & Licensing", app: "messages" });
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    repaint();
  }

  // ---- greasing the records clerk: a CRIME, and only real when there is a
  //      set of rolls to alter (candidacy.js owns those).
  const RIG_COST = 700;
  function rigRecords() {
    if (!qGate()) return;
    const R = run();
    if (!R || !R.rig) { note("There's nothing on these rolls worth buying today.", 2.2); return; }
    // SEAM: candidacy.js's rig keys are `rolls` / `machines` / `box`. "records"
    // was not one of them, so this row could only ever return "That is not a
    // thing you can rig" — AFTER taking the money and burning the ticket. Ask
    // the sibling FIRST and only charge the clerk's grease if the roll actually
    // moved; a favour that cannot be delivered must not be sold (the same rule
    // officialdom.js's grease() already keeps).
    let r = null;
    try { r = R.rig("rolls"); } catch (e) { r = null; }
    if (!r || !r.ok) {
      note(r && r.why ? r.why : "There's nothing on these rolls worth buying today.", 3,
        { from: "Records & Licensing", app: "messages" });
      return;
    }
    if (!CBZ.city.spend(RIG_COST)) { note("She wants " + fmt$(RIG_COST) + " to lose a page.", 2.4); return; }
    coin();
    st().q = null;
    const at = lotAt(civicLots().dmv);
    // real consequence: witnessed bribery of a public official. `extortion` is
    // wanted.js's nearest live crime key — an unknown type is a silent no-op
    // there, so never invent one.
    if (CBZ.cityCrime) CBZ.cityCrime(90, { instant: true, x: at.x, z: at.z, type: "extortion" });
    note("She takes it without looking at you. A page goes missing from the rolls.",
      3, { from: "Records & Licensing", app: "messages" });
    repaint();
  }

  // ============================================================
  //  LIBRARY — the archives. Free. Costs TIME.
  // ============================================================
  const READ_SECS = 20;
  // a seeded dossier line. The FACT is deterministic per sid per world seed,
  // so two clients digging the same drawer find the same page (determinism
  // law) — and so the same official is dirty in the same way all game.
  const DIRT = [
    "a land transfer to a shell company recorded the week before the zoning vote",
    "an expense ledger with four months of receipts torn out",
    "a police report naming them, filed and then unfiled the same night",
    "a campaign account that took its whole float from one address",
    "a sealed settlement with a former staffer, paid out of the office budget",
    "a contract awarded to their brother-in-law's firm with no other bidder",
    "a deed under a maiden name on a property they voted a tax break for",
    "a hospital record that puts them nowhere near where they said they were",
  ];
  function readTarget() {
    const c = chain();
    for (let i = 0; i < c.length; i++) if (c[i].office && c[i].office.holder) return c[i];
    return null;
  }
  function archiveLabel() {
    const r = st().read;
    if (r) return "Reading the file…" + dim(Math.max(1, Math.ceil(r.need - r.t)) + "s, stay at the table");
    const rec = readTarget();
    if (!rec) return "Search the archives" + dim("no officeholder on file for this ground");
    const id = holderId(rec);
    return "Search the archives" + dim("free · " + READ_SECS + "s at the table · " + titleOf(rec) + " " + id.name);
  }
  function startRead() {
    if (st().read) { note("You're already reading. Sit still.", 1.8); return; }
    const rec = readTarget();
    if (!rec) { note("“Nothing filed for this jurisdiction, I'm afraid.”", 2.2); return; }
    const lot = civicLots().library;
    st().read = { id: rec.id, sid: rec.office.holder, t: 0, need: READ_SECS, lot: lot };
    note("Boxes on the table. This takes a while, and you have to stay with it.", 2.6,
      { from: "Public Library", app: "messages" });
    repaint();
  }
  function finishRead(r) {
    st().read = null;
    const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(r.id) : null;
    const sid = r.sid;
    const id = (CBZ.officials && CBZ.officials.identityOf) ? CBZ.officials.identityOf(sid) : { name: "Someone" };
    const title = rec ? titleOf(rec) : "Official";
    const pick = DIRT[Math.floor(h01(sHash(sid), 0, 0x1c17) * DIRT.length) % DIRT.length];
    const line = title + " " + id.name + ": " + pick + ".";
    note(line, 5, { from: "Public Library", app: "messages" });
    feed("An old file surfaces on " + title + " " + id.name + ".", { from: "Public Library", app: "news" });
    // stamp it where the campaign can spend it. (games/government.js's own
    // blackmail() needs an active council night and its OWN dirt table seeded
    // by its OWN searchShelf — there is no outside entry point, and that file
    // is not ours to edit this wave. See the CUTS note in the header.)
    if (!stampHook(sid, "record", line)) note("Nowhere to file it yet, but you know it now.", 2);
    repaint();
  }

  // THE VOTER ROLLS — elections.js's real district blocs for the jurisdiction
  // you are standing in, so a petition drive knows where to walk.
  function blocsHere() {
    const rec = hereRec();
    const E = CBZ.elections;
    if (!rec || !E || !E._buildBlocs) return null;
    try { return E._buildBlocs(rec) || []; } catch (e) { return null; }
  }
  function rollsLabel() {
    const b = blocsHere();
    if (!b) return "The voter rolls" + dim("the rolls aren't kept here");
    return "The voter rolls" + dim("free · " + b.length + " district" + (b.length === 1 ? "" : "s") + " on file");
  }
  function readRolls() {
    const rec = hereRec();
    const b = blocsHere();
    if (!b || !b.length) { note("“The rolls for this jurisdiction aren't held at this branch.”", 2.4); return; }
    let tot = 0; for (let i = 0; i < b.length; i++) tot += b[i].pop || 0;
    note((rec ? rec.name : "This city") + " — " + b.length + " blocs, " + tot + " on the rolls.", 3,
      { from: "Public Library", app: "messages" });
    for (let i = 0; i < b.length && i < 6; i++) {
      const x = b[i];
      const lean = (x.taxPref || 0) > 0.15 ? "wants taxes cut" : (x.taxPref || 0) < -0.15 ? "wants services funded" : "split on tax";
      const held = x.intimidated && x.owner ? " · leaned on by " + x.owner : "";
      feed(x.name + ": " + (x.pop | 0) + " voters, " + lean + ", turnout " + Math.round((x.turnout || 0) * 100) + "%" + held + ".",
        { from: "Voter Rolls", app: "news" });
    }
    repaint();
  }

  // ============================================================
  //  POST OFFICE — the window
  // ============================================================
  // A delivery run binds to a lot the world already built and already gave a
  // door (contracts.js's rule verbatim: the generator picks the verb, the
  // WORLD supplies the specifics). Never a spawned marker.
  const RUN_PAY = 340;
  function deliveryLot() {
    const A = arena(); const p = P();
    if (!A || !p || !p.pos) return null;
    const lots = (A.lots && A.lots.length) ? A.lots : (A.shopLots || []);
    let best = null, bestS = -1;
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (!l || l.demolished || !l.building || !l.building.door) continue;
      const dx = l.cx - p.pos.x, dz = l.cz - p.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 140 * 140 || d2 > 620 * 620) continue;
      // deterministic pick: an order-independent score, no rng stream touched
      const s = h01(l.cx, l.cz, 0x9051 + day());
      if (s > bestS) { bestS = s; best = l; }
    }
    return best;
  }
  function runLabel() {
    const l = deliveryLot();
    if (!CBZ.mission || !CBZ.mission.start) return "Take a delivery run" + dim("no route book at this window");
    if (!l) return "Take a delivery run" + dim("nothing on the board for this route");
    return "Take a delivery run " + fmt$(RUN_PAY) + dim("to " + ((l.building && l.building.name) || "an address"));
  }
  function takeRun() {
    if (!CBZ.mission || !CBZ.mission.start) { note("“Route book's not out.”", 2); return; }
    const l = deliveryLot();
    if (!l) { note("“Nothing on the board for you right now.”", 2.2); return; }
    const where = (l.building && l.building.name) || "the address";
    CBZ.mission.start({
      id: "civic:post:run",
      title: "Carry the mail",
      brief: "One sack, one address. " + where + ". Don't lose it.",
      locationName: where,
      reward: { cash: RUN_PAY, respect: 1 },
      color: 0x6fa2e0,
      stages: [
        { id: "drop", goal: "reach", at: [l.cx, l.cz], radius: 10, text: "Deliver to " + where, label: "DELIVERY" },
      ],
      doneText: "Signed for. Come back when you want another.",
    });
    if (CBZ.cityCloseShop) CBZ.cityCloseShop();
  }

  // ---- COLLECT YOUR MAIL — only ever shown when the box is not empty ------
  // Three real senders, each read live off a real system:
  //   1. a SUMMONS, iff wanted.js says there is an open case against you
  //   2. your SALARY as an officeholder, drawn out of the polity record's own
  //      treasury (the same number civilwar.js/regimes.js spend) — a transfer
  //      between two real ledgers, not minted cash
  //   3. a campaign FINANCE STATEMENT, iff candidacy.js has banked anything
  function salarySeat() {
    const h = holdsSeat();
    if (!h) return null;
    const rec = h.rec || (h.id && CBZ.polity && CBZ.polity.get ? CBZ.polity.get(h.id) : null);
    return rec ? { h: h, rec: rec } : null;
  }
  const SALARY = { city: 900, state: 2200, federal: 2200, country: 5000 };
  function salaryDue() {
    const s = salarySeat();
    if (!s) return 0;
    // ONE PAYROLL. city/statecraft.js's daily tick already draws the
    // officeholder's wage out of THIS SAME rec.treasury (its own SALARY table,
    // its own paidDay). Paying it again at this window is a second cheque for
    // one job out of one purse — the parallel-bookkeeping trap. When statecraft
    // is loaded it owns the wage and this row simply is not offered; with it
    // absent the window still pays, so the post office degrades to the whole
    // service rather than to nothing.
    if (CBZ.gov && CBZ.gov.holds) return 0;
    if (st().paidDay >= day()) return 0;
    const amt = SALARY[s.rec.kind] || 900;
    return (s.rec.treasury || 0) >= amt ? amt : 0;
  }
  function mailItems() {
    const out = [];
    if (stars() >= 1) out.push("summons");
    if (salaryDue() > 0) out.push("salary");
    const R = run();
    if (R && R.state) { try { const s = R.state(); if (s && (s.warChest || 0) > 0) out.push("finance"); } catch (e) {} }
    return out;
  }
  function mailLabel() {
    const it = mailItems();
    return "Collect your mail" + dim(it.length + " item" + (it.length === 1 ? "" : "s") + " in the box");
  }
  function collectMail() {
    const it = mailItems();
    if (!it.length) { note("“Box is empty.”", 1.8); return; }
    for (let i = 0; i < it.length; i++) {
      if (it[i] === "summons") {
        note("SUMMONS, an open case in your name. The Clerk of the Court will take " + fmt$(fineCost()) + " to close it.",
          4, { from: "Freeland County Court", app: "messages" });
      } else if (it[i] === "salary") {
        const s = salarySeat(), amt = salaryDue();
        if (s && amt > 0) {
          s.rec.treasury = Math.max(0, (s.rec.treasury || 0) - amt);   // paid OUT of the seat, not conjured
          CBZ.city.addCash(amt);
          st().paidDay = day();
          coin();
          note("Your pay as " + titleOf(s.rec) + " of " + s.rec.name + " — " + fmt$(amt) + ", drawn on the treasury.",
            3.2, { from: "Office of the Treasurer", app: "bank" });
        }
      } else if (it[i] === "finance") {
        const R = run(); let s = null;
        try { s = R.state(); } catch (e) {}
        if (s) note("Campaign finance statement: " + fmt$(s.warChest || 0) + " in the war chest.",
          3, { from: "Campaign Finance", app: "messages" });
      }
    }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    repaint();
  }

  // ============================================================
  //  FEDERAL BUILDING — the hardest door in the city to walk through
  // ============================================================
  // The metal detector is already MODELLED just inside the door (buildings.js
  // stands the arch and the bag table for `federal` and `cityannex`). Walking
  // through it carrying is the thing it exists to catch: the marshal turns
  // you around, the desk shuts to you for a minute, and it goes on the wire.
  const BARRED_MS = 60000;
  function barred(lot) { return !!(lot && lot._civicBarred && (CBZ.now || 0) < lot._civicBarred); }
  function tripDetector(lot) {
    lot._civicBarred = (CBZ.now || 0) + BARRED_MS;
    const at = lotAt(lot);
    note("METAL DETECTOR, the marshal waves you back. “Stow it outside or don't come in.”", 3,
      { from: (lot.building && lot.building.name) || "Federal Building", app: "messages" });
    // a weapon through a screening lane is a real offence; `trespass` is
    // wanted.js's live key that fits, and it is witness-gated (not `instant`)
    // because the marshal has to actually get on the radio.
    if (CBZ.cityCrime) CBZ.cityCrime(45, { x: at.x, z: at.z, type: "trespass" });
    repaint();
  }
  function screened(kind) {
    const lot = civicLots()[kind];
    if (!lot) return true;
    if (barred(lot)) {
      note("“You were carrying. Desk is closed to you, come back later.”", 2.6);
      return false;
    }
    if (armed()) { tripDetector(lot); return false; }
    return true;
  }

  // ---- THE INFORMANT DESK ------------------------------------------------
  // Name a crew and hand over what you have. Real on both sides: the federal
  // seizure takes a bite out of gangs.js's real `treasury` (the number that
  // funds their raids and drives their expansion pressure), and the crew you
  // named finds out — gangops.js's own recipe for turning one gang hostile,
  // copied exactly, ordering included (cityGangProvoke no-ops on a friendly
  // crew, so friendly has to be cleared FIRST).
  function gangList() {
    const gs = CBZ.cityGangs || [];
    const out = [];
    for (let i = 0; i < gs.length; i++) { const x = gs[i]; if (x && x.id && !x.isPlayer && !x.absorbed) out.push(x); }
    return out;
  }
  function namedGang() {
    const l = gangList();
    if (!l.length) return null;
    return l[st().gangIdx % l.length];
  }
  function bounty(gang) {
    const n = CBZ.cityGangStrength ? CBZ.cityGangStrength(gang) : (gang.members ? gang.members.length : 0);
    return Math.round(700 + n * 55);
  }
  function informLabel() {
    const gang = namedGang();
    if (!gang) return "The informant desk" + dim("no crew on file");
    if ((st().informed[gang.id] || -1) >= day()) return "The informant desk" + dim("you already gave them " + gang.name + " today");
    return "Give evidence on " + gang.name + " " + fmt$(bounty(gang)) + dim("they will find out");
  }
  function informNext() {
    const l = gangList();
    if (!l.length) { note("“No open files.”", 2); return; }
    st().gangIdx = (st().gangIdx + 1) % l.length;
    note("File pulled: " + l[st().gangIdx % l.length].name + ".", 1.8);
    repaint();
  }
  function inform() {
    if (!screened("federal")) return;
    const gang = namedGang();
    if (!gang) { note("“No open files.”", 2); return; }
    if ((st().informed[gang.id] || -1) >= day()) { note("“You've already been in today.”", 2); return; }
    st().informed[gang.id] = day();
    const pay = bounty(gang);
    CBZ.city.addCash(pay);
    coin();
    // the seizure — a real bite out of the money that funds their raids
    const before = gang.treasury || 0;
    gang.treasury = Math.max(0, Math.round(before * 0.55));
    // …and the crew finds out. gangops.js:657-670's ordering, verbatim.
    if (CBZ.cityGangSetPlayerFriendly) CBZ.cityGangSetPlayerFriendly(gang.id, false);
    gang.hostility = Math.min(5, Math.max(gang.hostility || 0, 3));
    gang.provoke = 1;
    gang.strikeT = 0;                                   // the first squad rolls now
    if (CBZ.cityGangProvoke) CBZ.cityGangProvoke(gang.id, 1);
    if (CBZ.citySetRelation) CBZ.citySetRelation("player", gang.id, "war");
    if (CBZ.cityDeclareWar) CBZ.cityDeclareWar("player", gang.id);
    if (CBZ.cityGangAddStanding) CBZ.cityGangAddStanding(gang.id, -60);
    if (CBZ.cityRefreshTurfHud) CBZ.cityRefreshTurfHud();
    note("Statement taken. " + fmt$(pay) + " for your trouble.", 2.8, { from: "Federal Building", app: "messages" });
    feed("Federal agents froze " + fmt$(before - gang.treasury) + " tied to the " + gang.name + ".", { from: "City Desk", app: "news" });
    if (CBZ.city.big) CBZ.city.big("The " + gang.name + " know who talked.");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    repaint();
  }

  // ---- FEDERAL REQUEST — statecraft.js's military, from a state/federal seat
  function canRequest() {
    const h = holdsSeat(), G = gov();
    if (!h || !G || !G.deploy) return false;
    const k = (h.rec && h.rec.kind) || "";
    return k === "state" || k === "federal" || k === "country";
  }
  function federalRequest() {
    if (!screened("federal")) return;
    const G = gov();
    if (!G || !G.deploy) return;
    const p = P();
    const at = p && p.pos ? { x: p.pos.x, z: p.pos.z } : lotAt(civicLots().federal);
    let r = null;
    try { r = G.deploy("guard", at); } catch (e) { r = null; }
    if (!r || !r.ok) { note(r && r.why ? r.why : "The request is refused.", 2.6); return; }
    note("Request logged. The Guard is moving.", 2.6, { from: "Federal Building", app: "messages" });
    repaint();
  }

  // ============================================================
  //  CITY HALL ANNEX — the door into politics
  // ============================================================
  function offices() {
    const R = run();
    if (!R || !R.offices) return null;
    try { return R.offices() || []; } catch (e) { return null; }
  }
  function pickedOffice() {
    const o = offices();
    if (!o || !o.length) return null;
    return o[st().officeIdx % o.length];
  }
  function fileLabel() {
    const o = offices();
    if (!o) return "File for office" + dim("the filing window is not open");
    if (!o.length) return "File for office" + dim("no seat is up for election");
    const x = pickedOffice();
    const bits = [];
    if (x.fee != null) bits.push("fee " + fmt$(x.fee));
    if (x.sigsNeeded != null) bits.push(x.sigsNeeded + " signatures");
    if (x.daysLeft != null) bits.push(x.daysLeft + "d to the vote");
    if (!x.canFile && x.why) bits.push(x.why);
    return "File for " + (x.title || "office") + (x.name ? " of " + x.name : "") + dim(bits.join(" · "));
  }
  function fileForOffice() {
    if (!screened("cityannex")) return;
    const R = run();
    if (!R || !R.file) { note("“The filing window is not open.”", 2.4); return; }
    const x = pickedOffice();
    if (!x) { note("“Nothing is up for election right now.”", 2.4); return; }
    let r = null;
    try { r = R.file(x.id); } catch (e) { r = null; }
    if (!r || !r.ok) { note(r && r.why ? r.why : "The filing is refused.", 3); return; }
    // NOT "you are on the ballot" — filing is not ballot access. certify()
    // needs `sigsNeeded` real signatures first, and elections.js's own
    // callElection() fires the ON THE BALLOT headline at the moment that is
    // actually true. Claiming it here is a lie the player can act on, and it
    // steals the one headline that means something.
    if (CBZ.city.big) CBZ.city.big("PAPERS FILED · " + (x.title || "office") + (x.name ? " of " + x.name : ""));
    if (r.sigsNeeded) {
      note("Now get " + r.sigsNeeded + " signatures. Without them your name is not printed.", 3.4,
        { from: "City Hall Annex", app: "messages" });
    }
    repaint();
  }
  function nextOffice() {
    const o = offices();
    if (!o || !o.length) { note("“Nothing is up for election right now.”", 2.2); return; }
    st().officeIdx = (st().officeIdx + 1) % o.length;
    repaint();
  }

  // ---- THE PLATFORM: two −1..1 sliders, said in plain language ------------
  const TAX_STEPS = [
    { v: -1, s: "cut taxes" }, { v: -0.5, s: "trim taxes" }, { v: 0, s: "hold the line" },
    { v: 0.5, s: "raise them for services" }, { v: 1, s: "tax the rich hard" },
  ];
  const POL_STEPS = [
    { v: -1, s: "pull the police back" }, { v: -0.5, s: "fewer patrols" }, { v: 0, s: "keep policing as it is" },
    { v: 0.5, s: "more patrols" }, { v: 1, s: "flood the streets with police" },
  ];
  function stepIdx(list, v) {
    let bi = 0, bd = 9;
    for (let i = 0; i < list.length; i++) { const d = Math.abs(list[i].v - v); if (d < bd) { bd = d; bi = i; } }
    return bi;
  }
  // pledgeNow — the ONE write, and it BELIEVES THE ANSWER. candidacy.js's
  // pledge() returns {ok, why, platform:{tax,police}, limit}: it refuses
  // outright before you have filed, and it CLAMPS the promise to a rank
  // unlock (±0.5 until you are a Machine Boss, ±1.0 after). Ignoring the
  // return made this desk say "Platform filed: tax the rich hard" when the
  // real, tallied platform was 0.5 — or when nothing had been filed at all.
  // The local s.tax/s.police are a cursor into the wording list; the RECORD
  // is candidacy's, and it is read straight back here so the two can never
  // drift apart.
  function pledgeNow() {
    const R = run();
    if (!R || !R.pledge) return null;
    let r = null;
    try { r = R.pledge(st().tax, st().police); } catch (e) { r = null; }
    if (!r || r.ok === false) return r || null;
    if (r.platform) { st().tax = +r.platform.tax || 0; st().police = +r.platform.police || 0; }
    return r;
  }
  function livePlatform() {
    const R = run();
    if (!R || !R.state) return null;
    try { const s = R.state(); return (s && s.platform) || null; } catch (e) { return null; }
  }
  function taxLabel() {
    const lp = livePlatform();
    const v = lp ? lp.tax : st().tax;
    return "Platform · tax: " + TAX_STEPS[stepIdx(TAX_STEPS, v)].s +
      dim(run() && run().pledge ? "press to change" : "no race to pledge to yet");
  }
  function polLabel() {
    const lp = livePlatform();
    const v = lp ? lp.police : st().police;
    return "Platform · police: " + POL_STEPS[stepIdx(POL_STEPS, v)].s +
      dim(run() && run().pledge ? "press to change" : "no race to pledge to yet");
  }
  function cycleTax() {
    const s = st();
    s.tax = TAX_STEPS[(stepIdx(TAX_STEPS, s.tax) + 1) % TAX_STEPS.length].v;
    const r = pledgeNow();
    if (!r) note("Noted, but there's no race to pledge it to yet.", 2.2);
    else if (r.ok === false) { note(r.why || "That cannot be pledged yet.", 2.6); }
    else note("Platform filed: " + TAX_STEPS[stepIdx(TAX_STEPS, s.tax)].s + ".", 2);
    repaint();
  }
  function cyclePolice() {
    const s = st();
    s.police = POL_STEPS[(stepIdx(POL_STEPS, s.police) + 1) % POL_STEPS.length].v;
    const r = pledgeNow();
    if (!r) note("Noted, but there's no race to pledge it to yet.", 2.2);
    else if (r.ok === false) { note(r.why || "That cannot be pledged yet.", 2.6); }
    else note("Platform filed: " + POL_STEPS[stepIdx(POL_STEPS, s.police)].s + ".", 2);
    repaint();
  }

  // ============================================================
  //  FIRE STATION — Engine Co. 7. The one civic house with a call.
  // ============================================================
  // Bound to what is ACTUALLY burning: structural.js's building fire ledger
  // first, then vehicles.js's `_onFire` cars. If nothing in the city is
  // alight the row says so — contracts.js's binding rule, and it is binding.
  let fireCache = null, fireCacheT = -1;
  function liveFire() {
    const now = CBZ.now || 0;
    if (fireCacheT >= 0 && now - fireCacheT < 1000) return fireCache;
    fireCacheT = now;
    fireCache = null;
    if (CBZ.structure && CBZ.structure.burning) {
      let b = null;
      try { b = CBZ.structure.burning(); } catch (e) { b = null; }
      if (b && b.length) { fireCache = { kind: "building", x: b[0].x, z: b[0].z, floors: b[0].floors }; return fireCache; }
    }
    const cars = CBZ.cityCars;
    if (cars) {
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        if (!c || c.player || c.dead || !c.pos) continue;
        if (c._onFire) { fireCache = { kind: "car", car: c, x: c.pos.x, z: c.pos.z }; return fireCache; }
      }
    }
    return fireCache;
  }
  function callLabel() {
    const f = liveFire();
    if (!CBZ.mission || !CBZ.mission.start) return "Sign on for a call" + dim("no board at this house");
    if (!f) return "Sign on for a call" + dim("no calls, the house is quiet");
    return "Sign on for a call " + fmt$(650) + dim(f.kind === "building" ? "structure fire, " + f.floors + " floor(s) alight" : "vehicle fire");
  }
  function signOn() {
    if (!CBZ.mission || !CBZ.mission.start) { note("“No board at this house.”", 2); return; }
    const f = liveFire();
    if (!f) { note("“No calls. Sit down, have a coffee.”", 2.4); return; }
    const fx = f.x, fz = f.z, car = f.car || null;
    const isB = f.kind === "building";
    CBZ.mission.start({
      id: "civic:fire:call",
      title: isB ? "Structure fire" : "Vehicle fire",
      brief: isB ? "Fire on the upper floors. Get on scene and stay on it until it's out."
                 : "Car alight on the street. Get on scene and stay with it until it's out.",
      reward: { cash: 650, respect: 2 },
      color: 0xff7043,
      stages: [
        { id: "roll", goal: "reach", at: [fx, fz], radius: 14, text: "Get on scene", label: "SCENE" },
        {
          id: "out", goal: "custom", at: [fx, fz], label: "HOLD",
          text: "Stay on it until it's out",
          // completion is the WORLD's state, not a timer: the fire is out when
          // structural.js stops listing it (or the car stops burning).
          done: function (m) {
            const p = P();
            if (!p || !p.pos) return false;
            const dx = p.pos.x - fx, dz = p.pos.z - fz;
            if (dx * dx + dz * dz > 46 * 46) { m.progress(0); return false; }
            if (car) return !car._onFire || !!car.dead || !!car._exploded;
            if (CBZ.structure && CBZ.structure.burning) {
              let b = null;
              try { b = CBZ.structure.burning(); } catch (e) { b = null; }
              if (!b) return true;
              for (let i = 0; i < b.length; i++) {
                const ex = b[i].x - fx, ez = b[i].z - fz;
                if (ex * ex + ez * ez < 12 * 12) return false;
              }
              return true;
            }
            return true;
          },
        },
      ],
      doneText: "Knocked down. Engine Co. 7 signs you off.",
    });
    if (CBZ.cityCloseShop) CBZ.cityCloseShop();
  }

  // ============================================================
  //  THE TABLES — verb, hours, services. One place, per the seam contract.
  // ============================================================
  const VERB = {
    courthouse:  { verb: "See the clerk of the court", sub: "pay your fine · court records · pardons" },
    federal:     { verb: "Sign in at the federal desk", sub: "informant desk · no weapons past the arch" },
    library:     { verb: "Ask at the reference desk",   sub: "the archives · the voter rolls · free" },
    cityannex:   { verb: "Step up to the filing window", sub: "file for office · declare a platform" },
    postoffice:  { verb: "Step up to the window",        sub: "delivery runs · collect your mail" },
    dmv:         { verb: "Take a ticket",                sub: "title a vehicle · and then wait" },
    firestation: { verb: "Talk to the house watch",      sub: "sign on for a call" },
  };
  // Government hours, because they are also the joke. The fire house never
  // closes — hours() returns null for it, which sends shopShut() down its
  // own unchanged path (and firestation isn't in SHUT_KINDS, so: always open).
  const HOURS = {
    courthouse: { open: 9, close: 17 },
    federal:    { open: 9, close: 17 },
    library:    { open: 9, close: 20 },
    cityannex:  { open: 9, close: 17 },
    postoffice: { open: 9, close: 17 },
    dmv:        { open: 9, close: 16 },
  };

  // Keys are chosen to dodge every generic shops.js key: [B]jobs, [X]qty,
  // [V]haggle, [R]rob, [E]/[Esc] leave, [0-9] buy/sell, and the boutique
  // closet letters (which only ever arm in a boutique — no civic kind is one).
  function serviceRows(kind) {
    switch (kind) {
      case "courthouse": {
        const s = [
          { key: "f", label: fineLabel(), fn: payFine, note: "settles wanted.js's real heat" },
          { key: "c", label: recordsLabel(), fn: pullRecord, note: "a real officeholder's real file" },
        ];
        const seat = canPardon() ? holdsSeat() : null;
        if (seat) s.push({ key: "p", label: "Sign the pardon" + dim("as " + titleOf(seat.rec)), fn: signPardon });
        return s;
      }
      case "dmv": {
        const s = [
          { key: "t", label: qLabel(), fn: takeTicket, note: "the queue is the mechanic" },
          { key: "n", label: regLabel(), fn: registerCar, note: "writes car.stolen / car.owned" },
        ];
        if (run() && run().rig) s.push({ key: "m", label: "Grease the records clerk " + fmt$(RIG_COST) + dim("a crime"), fn: rigRecords });
        return s;
      }
      case "library":
        return [
          { key: "a", label: archiveLabel(), fn: startRead, note: "timed, interruptible, seeded" },
          { key: "o", label: rollsLabel(), fn: readRolls, note: "elections.js's real blocs" },
        ];
      case "postoffice": {
        const s = [{ key: "d", label: runLabel(), fn: takeRun, note: "core/mission.js, bound to a real lot" }];
        if (mailItems().length) s.push({ key: "m", label: mailLabel(), fn: collectMail });
        return s;
      }
      case "federal": {
        const s = [
          { key: "i", label: informLabel(), fn: inform, note: "real gang treasury + real hostility" },
        ];
        if (gangList().length > 1) s.push({ key: "n", label: "Name a different crew" + dim("pull the next file"), fn: informNext });
        const seat = canRequest() ? holdsSeat() : null;
        if (seat) s.push({ key: "u", label: "Federal request: post the Guard" + dim("as " + titleOf(seat.rec)), fn: federalRequest });
        return s;
      }
      case "cityannex": {
        const s = [
          { key: "f", label: fileLabel(), fn: fileForOffice, note: "candidacy.js's real ballot" },
          { key: "p", label: taxLabel(), fn: cycleTax },
          { key: "l", label: polLabel(), fn: cyclePolice },
        ];
        const o = offices();
        if (o && o.length > 1) s.push({ key: "o", label: "Another seat on the list" + dim(o.length + " up"), fn: nextOffice });
        return s;
      }
      case "firestation":
        return [{ key: "s", label: callLabel(), fn: signOn, note: "binds to a REAL live fire or says no" }];
      default:
        return [];
    }
  }

  // ============================================================
  //  THE CLOCK — the DMV queue, the library read, the federal arch
  // ============================================================
  if (CBZ.onUpdate) {
    let scanT = 0;
    CBZ.onUpdate(38.6, function (dt) {
      if (!on()) return;
      dt = Math.max(0, Math.min(0.25, dt || 0));
      const s = st();

      // ---- the DMV queue walks the sim clock whether you're standing there
      //      or not. That is the whole joke, and it is also the mechanic.
      const t = s.q;
      if (t && !t.done) {
        // the hall clears if you pick up a star, or draw a gun in it
        if (stars() > (t.w0 | 0)) { qReset("Everyone's on the floor. Your ticket is on the floor with them."); }
        else if (armed() && insideLot(t.lot, 1)) { qReset("You drew in the hall. The window shutters and the ticket is void."); }
        else {
          if (t.base == null) t.base = t.serving;   // defensive: the board needs a baseline
          const was = t.serving;
          t.t += dt;
          // the board is a pure function of the ticket's own baseline and the
          // clock — so it can never drift, and a reload picks it back up.
          t.serving = Math.min(t.num, t.base + Math.floor(t.t / Q_STEP));
          if (t.serving !== was) repaint();
          if (!t.called && t.serving >= t.num) {
            t.called = true;
            note("NOW SERVING " + t.num + " · that's you. Step up to the window.", 3,
              { from: "Records & Licensing", app: "messages" });
            repaint();
          }
        }
      }

      // ---- the library read: real seconds, and you have to stay with it
      const r = s.read;
      if (r) {
        if (r.lot && !insideLot(r.lot, 3)) {
          s.read = null;
          note("You walked off and the librarian re-shelved the box.", 2.4, { from: "Public Library", app: "messages" });
          repaint();
        } else {
          r.t += dt;
          if (r.t >= r.need) finishRead(r);
        }
      }

      // ---- the screening arch: 2.5 Hz over at most two lots
      scanT -= dt;
      if (scanT <= 0) {
        scanT = 0.4;
        const L = civicLots();
        for (let i = 0; i < 2; i++) {
          const lot = i ? L.cityannex : L.federal;
          if (!lot) continue;
          if (!insideLot(lot, 0)) { lot._civicIn = false; continue; }
          if (lot._civicIn) continue;              // one trip per entry
          lot._civicIn = true;
          if (armed() && !barred(lot)) tripDetector(lot);
        }
      }
    });
  }

  // ============================================================
  //  PUBLIC API — the seam contract. shops.js and interact.js call THESE.
  // ============================================================
  CBZ.civic = {
    verb: function (kind) { return (on() && VERB[kind]) || null; },
    // NOTE the DESK stamp: shops.js re-derives the rows for the OPEN lot
    // immediately before it dispatches a key (shops.js's keydown does
    // `services(openLot.kind).find(...)`), so naming the desk here is enough
    // to attribute every clerk line the row's fn goes on to say. Harmless for
    // any other caller — it only picks the signature on the phone message.
    services: function (kind) {
      if (!on() || !KINDSET[kind]) return [];
      DESK = DESK_NAME[kind] || "Front Desk";
      return serviceRows(kind);
    },
    hours: function (kind) { return (on() && HOURS[kind]) || null; },
    open: function (kind, lot) { if (on() && lot && CBZ.cityOpenShop) CBZ.cityOpenShop(lot); },
    isCivic: function (kind) { return !!KINDSET[kind]; },
    // THE RATCHET (CLAUDE.md): civic kinds with ZERO live services. Must be 0.
    audit: function () {
      let n = 0;
      for (let i = 0; i < KINDS.length; i++) {
        const rows = CBZ.civic.services(KINDS[i]);
        if (!rows || !rows.length) n++;
      }
      return n;
    },
  };
  CBZ.civicAudit = CBZ.civic.audit;
})();
