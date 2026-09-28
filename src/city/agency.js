/* ============================================================
   city/agency.js — THE STORY. A hitman in a motel room, and the Bureau.

   OWNER (2026-09-27, round two): "HITMAN MODE in Gang Life: realistic and
   in-world... Contracts arrive as envelopes, calls and meetings. Scouting is
   physical (binoculars, following, the newspaper printing the target's
   public schedule), the dossier is a real folder you carry, kills have
   realistic consequences (police investigation, witnesses describing you,
   the news), and payment is a dead drop you collect. The hitman could even
   kill the president, and it would affect President mode." And: "Stop
   breaking the fourth wall."

   So nothing in this file puts a panel, a banner, an objective or a rating
   on the screen. Everything the player learns arrives the way it would:

     THE ROOM     the burner on the bed rings. NICO, the broker who has fed
                  him street work for years, has one name. An envelope slides
                  under the door: a folder with the man's photo, where he
                  works, his shift, where he sleeps, and an atlas page with
                  the workplace ringed. The same goes up on the corkboard.
     THE KILL     whatever happened happened (city/hitman_fallout.js): the
                  witnesses, the police tape, the story in the paper.
     THE MONEY    when you are clear, a text names a real door. A bag by the
                  bins. "Take the bag".
     THE MEET     an unknown number names a parking lot after dark. VOSS,
                  the Bureau's man, under one sodium lamp. He hands you the
                  first file (LEDGER). The President cancels the election.
     THE FILES    LEDGER (Teodor Brandt, the President's banker), CARGO
                  (Casimir Dranov, arms to the Guard), BLACK BOOK (General
                  Varga). Each after the first arrives at the room in an
                  envelope once the last one's money is collected. The man
                  keeps a routine on the city clock; the morning paper prints
                  his PUBLIC schedule, and reading it fills the folder.
     MEET TWO     same lot. Voss holds out his hand for the book. Hand it to
                  him (the job) or shoot him (the cable in the back of the
                  book says the Bureau plans to retire you).
     THE PRESIDENT  his residence, the address from the Mansion steps, the
                  motorcade; counter-snipers on the roof, agents at the
                  podium, police cars front and back. The President agent's
                  seams (presidency.current/schedule, protection.detail,
                  presidency.onAssassinated) are preferred when present;
                  otherwise this file walks govcomplex's head of state
                  through a loop timed to the city clock.
     ENDINGS      DENIABLE (you survive the Bureau's burn) or THE PRESIDENT'S
                  MAN (you killed Voss). A last phone call and a front page.

   Debug: ?agency=opening|street|meet1|ledger|cargo|book|meet2|finale|exfil
   (CBZ.agency.jump(step)). ?agency_off=1 holds the whole arc back.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.game) return;
  // the before side of the hitman-arc preset: the room and the old pipe only
  try { if (/(?:^|[?&])agency_off=1(?:&|$)/.test(String(window.location && window.location.search || ""))) return; } catch (e) {}
  const g = CBZ.game;

  /* ================================================================
     §1  SMALL READS
     ================================================================ */
  function P() { return CBZ.player || null; }
  function A() { return CBZ.city && CBZ.city.arena; }
  function playing() { return g.mode === "city" && g.state === "playing"; }
  function floorY(x, z) { try { return CBZ.floorAt ? (CBZ.floorAt(x, z) || 0) : 0; } catch (e) { return 0; } }
  function d2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function distP(x, z) { const p = P(); return p && p.pos ? d2(p.pos.x, p.pos.z, x, z) : Infinity; }
  function now() { return CBZ.now || Date.now(); }
  function h01(a, b, c) { return CBZ.hash01 ? CBZ.hash01(a | 0, b | 0, c | 0) : ((Math.sin(a * 12.9898 + b * 78.233 + c) * 43758.5453) % 1 + 1) % 1; }
  function hour() { const h = CBZ.cityHour ? CBZ.cityHour() : 12; return isFinite(h) ? h : 12; }
  function hhmm(h) { h = ((h % 24) + 24) % 24; const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm; }
  function inWin(h, a, b) { return a <= b ? (h >= a && h < b) : (h >= a || h < b); }
  function clock() { return hhmm(hour()); }
  function today() { return CBZ.dayCount ? (CBZ.dayCount() | 0) : 0; }
  function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function clean(s) { return String(s == null ? "" : s).replace(/[—–]/g, ", ").replace(/[·•]/g, ","); }
  function campaignOwns() { return !!(CBZ.cityCampaignOwnsMission && CBZ.cityCampaignOwnsMission()); }
  function hitmanOrigin() { return g.cityOrigin === "contract" || g.cityOrigin === "hitman"; }
  function isPresident() {
    if (g.cityOrigin === "president") return true;
    try {
      const held = CBZ.regimes && CBZ.regimes.heldByPlayer ? CBZ.regimes.heldByPlayer() : null;
      return !!(held && held.length && held.some(function (r) { return r && (r.kind === "country" || r.id === "republic"); }));
    } catch (e) { return false; }
  }
  function paper() { return CBZ.hmPaper || null; }
  function hold() { return CBZ.hmHold || null; }
  function RM() { return CBZ.hmRoom || null; }
  function room() { const R = RM(); if (!R || !R.ensure) return null; try { return R.ensure(); } catch (e) { return null; } }
  function inRoom() { const R = RM(); try { return !!(R && R.inRoom && R.inRoom()); } catch (e) { return false; } }
  function FO() { return CBZ.hmFallout || null; }
  function D() { return CBZ.dossier || null; }

  // THE BURNER. Texts come from people, never from a system.
  const BROKER = "Nico";
  const HANDLER = "Voss";
  function text(body, from) {
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "messages", from: from || "Unknown number", text: clean(body), priority: 2 }); return; } catch (e) {} }
  }
  function news(body) {
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "news", from: "City Desk", text: clean(body), priority: 1 }); } catch (e) {} }
  }
  // who says it: the ped standing there, or "phone" for a voice on the burner.
  // (hitman_hands owns the delivery: CBZ.speech, never a subtitle box.)
  function say(by, line) {
    if (CBZ.hmSay) { try { CBZ.hmSay(by, line); } catch (e) {} }
  }
  function clearSay() {
    if (CBZ.hmSayClear) { try { CBZ.hmSayClear(); } catch (e) {} }
  }
  function call(lines, onEnd) {
    if (CBZ.hmCall) { try { return CBZ.hmCall(lines, onEnd); } catch (e) {} }
    if (onEnd) setTimeout(onEnd, 200);
    return null;
  }
  function bark(ped, line, secs) { if (ped && CBZ.citySay) { try { CBZ.citySay(ped, line, "#e8e2d4", secs || 2.6); } catch (e) {} } }

  // THE QUIET PIN. One pin at a time, and only ever cleared if it is still ours.
  const PIN = { wp: null, key: null };
  function pin(x, z, label, key) {
    const M = CBZ.fullMap; if (!M || !M.setWaypoint || !isFinite(x) || !isFinite(z)) return;
    if (PIN.key === key && PIN.wp) return;
    const fh = CBZ.flashHint; CBZ.flashHint = null;          // quietly: no "waypoint set" toast
    try { PIN.wp = M.setWaypoint(x, z, label) || null; PIN.key = key; } catch (e) {} finally { CBZ.flashHint = fh; }
  }
  function unpin(key) {
    if (key && PIN.key !== key) return;
    const M = CBZ.fullMap;
    if (M && M.clearWaypoint && PIN.wp) {
      let cur = null; try { cur = M.waypoint ? M.waypoint() : null; } catch (e) {}
      if (!M.waypoint || cur === PIN.wp) { try { M.clearWaypoint(); } catch (e) {} }
    }
    PIN.wp = null; PIN.key = null;
  }

  /* ================================================================
     §2  THE ARC STATE — plain data in the world ledger (saves with it)
     ================================================================ */
  const STEPS = ["opening", "street", "meet1", "ledger", "cargo", "book", "meet2", "finale", "exfil", "turned", "done"];
  function recs() {
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    if (!w) return null;
    w.records = w.records || {};
    w.records.hitman = w.records.hitman || { contracts: 0, completed: 0, failed: 0, highValue: 0, heat: 0, paid: 0 };
    return w.records.hitman;
  }
  function arc() {
    const R = recs(); if (!R) return null;
    if (!R.arc || typeof R.arc !== "object") {
      R.arc = { step: hitmanOrigin() ? "opening" : "street", street: 0, clean: 0, lastStreet: null, lastQuiet: false,
        kit: { vial: 0, charge: 0 }, seen: {}, notes: {}, how: {}, book: false, choice: null, ending: null,
        job: null, crossed: [], press: [], paperDay: -1 };
    }
    const a = R.arc;
    if (STEPS.indexOf(a.step) < 0) a.step = "street";
    // SAVE MIGRATION: a Hitman-card save that never did anything starts at
    // the burner, not at a wall that no longer exists.
    if (a.step === "street" && hitmanOrigin() && !(a.street | 0) && !a.openingDone) a.step = "opening";
    a.kit = a.kit || { vial: 0, charge: 0 };
    a.seen = a.seen || {}; a.notes = a.notes || {}; a.how = a.how || a.ratings || {};
    a.crossed = a.crossed || []; a.press = a.press || [];
    if (a.paperDay == null) a.paperDay = -1;
    return a;
  }
  function commit() { if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} } }
  let hitmanRepaint = null;
  function setStep(s) {
    const a = arc(); if (!a || a.step === s) return;
    a.step = s;
    commit();
    boardDirty();
    if (hitmanRepaint) { try { hitmanRepaint(); } catch (e) {} }
  }
  function seenOf(opId) { const a = arc(); if (!a) return { legs: {}, guards: 0, appr: {}, posts: {} }; const s = (a.seen[opId] = a.seen[opId] || { legs: {}, guards: 0, appr: {} }); s.posts = s.posts || {}; return s; }
  function noteOf(opId) { const a = arc(); if (!a) return []; return (a.notes[opId] = a.notes[opId] || []); }
  function addNote(opId, line) {
    if (!line) return;
    const L = noteOf(opId);
    if (L.length && L[L.length - 1].indexOf(line) >= 0) return;
    L.push(clock() + "  " + line);
    if (L.length > 12) L.splice(0, L.length - 12);
    refreshFile();
    boardDirty();
  }
  // the job in hand: {id, phase:'ring'|'call'|'envelope'|'live'|'after'|'drop'|'paid', inc, pay, verdict, dropId}
  function job() { const a = arc(); return a ? a.job : null; }
  function setJob(id, phase) { const a = arc(); if (!a) return null; a.job = { id: id, phase: phase, t0: today() }; commit(); return a.job; }

  /* ================================================================
     §3  THE CAST — fictional people, fixed names (no real person/country)
     sched: [{h, leg}] — the leg he walks to from that hour on the city clock
     ================================================================ */
  const OPS = {
    ledger: {
      id: "ledger", codename: "LEDGER", fileNo: 1, tier: 2, pay: 12000,
      name: "Teodor Brandt", role: "Private banker to the President", job: "banker", gender: "m",
      venues: [
        { key: "office", kinds: ["bank", "office", "tower"] },
        { key: "cafe", kinds: ["food", "club"], near: "office" },
        { key: "bank", kinds: ["bank", "office", "casino", "shop"], near: "office" },
      ],
      legs: [
        { at: "office", label: "Office steps", detail: "Takes his calls on the steps of {office}." },
        { at: "cafe", label: "Coffee", detail: "Same table outside {cafe}. Orders, then walks off and leaves the cup.", prop: "cafe" },
        { at: "bank", label: "Bank run", detail: "Carries the day's cash to {bank}." },
      ],
      sched: [{ h: 8, leg: 0 }, { h: 11, leg: 1 }, { h: 13, leg: 2 }, { h: 15, leg: 0 }, { h: 17, leg: 1 }, { h: 19, leg: 0 }],
      public: function (V) {
        return [
          { k: "Teodor Brandt", v: "The harbor banker is on the steps of " + nm(V.office) + " from 08:00." },
          { k: "Coffee with Brandt", v: "Walks to " + nm(V.cafe) + " at 11:00 and again at 17:00. Same table." },
          { k: "The bank run", v: "Carries the day's takings to " + nm(V.bank) + " at 13:00." },
        ];
      },
      paperLegs: [0, 1, 2],
      security: "One bodyguard. Pistol. Stays close.",
      approaches: [
        { id: "poison", label: "His cup", detail: "It sits alone on the cafe table while he is away. One vial." },
        { id: "long", label: "From a distance", detail: "He stands still on the office steps. Sixty meters or more." },
        { id: "disguise", label: "His guard's clothes", detail: "A man in the guard's suit can stand next to him." },
        { id: "loud", label: "Loud", detail: "It works. It costs." },
      ],
      brief: [
        "Teodor Brandt moves the President's money. Every account the palace has passes through his hands.",
        "He keeps a routine. Office, coffee, bank. Watch it once before you touch him.",
        "One bodyguard. The cafe is the soft spot. The vial is in your case.",
      ],
    },
    cargo: {
      id: "cargo", codename: "CARGO", fileNo: 2, tier: 3, pay: 20000,
      name: "Casimir Dranov", role: "Arms broker to the Presidential Guard", job: "importer", gender: "m",
      venues: [
        { key: "shop", kinds: ["guns", "security", "carlot", "shop"] },
        { key: "club", kinds: ["club", "casino", "food"], near: "shop" },
      ],
      legs: [
        { at: "car", label: "The car", detail: "Black sedan at the curb by {shop}. He never lets it out of sight for long.", prop: "car" },
        { at: "shop", label: "The buy", detail: "Inspects the order at {shop}." },
        { at: "club", label: "Drinks", detail: "Celebrates at {club}. His men relax." },
      ],
      sched: [{ h: 9, leg: 0 }, { h: 10, leg: 1 }, { h: 13, leg: 2 }, { h: 17, leg: 0 }, { h: 18, leg: 1 }, { h: 21, leg: 2 }],
      public: function (V) {
        return [
          { k: "Foreign buyer in town", v: "Casimir Dranov arrives by car at " + nm(V.shop) + " at 09:00 and 17:00." },
          { k: "The order", v: "Inspects the Guard's rifles inside " + nm(V.shop) + " after each arrival." },
          { k: "Evenings", v: "Seen celebrating at " + nm(V.club) + " from 13:00 and late." },
        ];
      },
      paperLegs: [0, 1, 2],
      security: "Three guards. SMGs. One of them stays near the car.",
      approaches: [
        { id: "charge", label: "His car", detail: "Plant it while the car sits alone. It goes when his door closes." },
        { id: "long", label: "From a distance", detail: "He stands at the curb. Sixty meters or more." },
        { id: "disguise", label: "His guard's clothes", detail: "The guards know each other by the suit, not the face." },
        { id: "loud", label: "Loud", detail: "Three SMGs. Your call." },
      ],
      brief: [
        "Casimir Dranov sells the Presidential Guard its rifles. He is in town to close an order.",
        "He arrives by car, inspects the stock, drinks, and leaves. His car is the weak point.",
        "There is a charge in your case.",
      ],
    },
    book: {
      id: "book", codename: "BLACK BOOK", fileNo: 3, tier: 4, pay: 30000,
      name: "General Ruben Varga", role: "Chief of the Presidential Guard", job: "soldier", gender: "m",
      venues: [
        { key: "post", kinds: ["cityhall", "security", "office", "bank"] },
        { key: "bar", kinds: ["club", "food", "casino"], near: "post" },
      ],
      legs: [
        { at: "checkpoint", label: "Checkpoint", detail: "Inspects his own roadblock near {post}.", prop: "checkpoint" },
        { at: "post", label: "Briefing", detail: "Stands outside {post} with his officers." },
        { at: "bar", label: "Evening drink", detail: "A drink at {bar}. The book stays in his coat." },
      ],
      sched: [{ h: 7, leg: 0 }, { h: 10, leg: 1 }, { h: 15, leg: 0 }, { h: 18, leg: 2 }, { h: 22, leg: 1 }],
      public: function (V) {
        return [
          { k: "General Varga inspects", v: "The roadblock by " + nm(V.post) + " at 07:00 and 15:00. Expect delays." },
          { k: "Guard briefing", v: "Outside " + nm(V.post) + " from 10:00." },
        ];
      },
      paperLegs: [0, 1],
      security: "Four men with rifles and two sentries at the roadblock.",
      approaches: [
        { id: "long", label: "From a distance", detail: "He stands in the open at the roadblock. Sixty meters or more." },
        { id: "disguise", label: "A sentry's clothes", detail: "The sentries are relieved on foot. Nobody looks twice at a uniform." },
        { id: "loud", label: "Loud", detail: "Six rifles." },
      ],
      brief: [
        "General Ruben Varga runs the President's guard. The President does not move without him.",
        "He carries the President's week in a black book. I want the book more than I want him.",
        "Take it off his body.",
      ],
    },
  };
  const OP_ORDER = ["ledger", "cargo", "book"];
  const FINALE = {
    id: "finale", codename: "HEAD OF STATE", fileNo: 4, pay: 150000,
    role: "President. Cancelled the election. Rules by decree.",
    security: "The Presidential detail. Rifles. Counter-snipers on the roof. Police front and back on the road.",
    approaches: [
      { id: "long", label: "From a distance", detail: "Past two hundred and fifty meters, or from real cover. Closer than that the roof team sees you first." },
      { id: "roof", label: "The roof team", detail: "Two rifles over the Mansion. Take them off the roof, or find the one who takes money." },
      { id: "disguise", label: "One of his agents", detail: "Every man on the detail has a price or a uniform. Either one walks you closer." },
      { id: "charge", label: "His car", detail: "The state car drives the route the paper prints. A charge goes when it pulls away." },
      { id: "speech", label: "The balcony", detail: "He speaks to the crowd at the times the paper prints. A crowd hides a man." },
      { id: "loud", label: "Through the gate", detail: "It can be done. You will not walk out." },
    ],
    legs: [
      { at: "residence", label: "The residence", detail: "Inside the Mansion with his detail. Nobody sees him." },
      { at: "address", label: "The address", detail: "Speaks from the top of the Mansion steps, 13:00 to 17:00. A crowd on the lawn." },
      { at: "motorcade", label: "The motorcade", detail: "Out the gate on the published route, police front and back. He rides in the state car." },
    ],
    win: { address: [13, 17], motorcade: [17, 19] },
  };
  function nm(lot) { return lotName(lot); }

  /* ================================================================
     §4  PLACES
     ================================================================ */
  function doorOf(lot) { return lot && lot.building && lot.building.door; }
  function outward(lot) {
    const d = doorOf(lot); if (!d) return { x: 0, z: 1 };
    let ox = d.x - lot.cx, oz = d.z - lot.cz;
    const m = Math.hypot(ox, oz);
    if (m < 0.01) return { x: d.nx || 0, z: d.nz || 1 };
    return { x: ox / m, z: oz / m };
  }
  function lotName(lot) {
    if (!lot) return "the place";
    const b = lot.building;
    if (b && b.name) { const n = String(b.name).trim(); return n.indexOf(" ") > 0 ? n : "the " + n.toLowerCase(); }
    const K = { bank: "the bank", office: "the office block", tower: "the tower", food: "the diner", club: "the club",
      casino: "the casino", guns: "the gun shop", security: "the security depot", carlot: "the car lot", shop: "the shop",
      cityhall: "City Hall", gas: "the gas station", hardware: "the hardware store", clothing: "the clothes shop",
      gym: "the gym", barber: "the barber's", electronics: "the electronics store", hospital: "the hospital", chop: "the body shop", bar: "the bar" };
    return K[lot.kind] || "the building";
  }
  function spotAt(lot, out, side) {
    const d = doorOf(lot); const o = outward(lot);
    const sx = -o.z, sz = o.x;
    return { x: d.x + o.x * (out || 3) + sx * (side || 0), z: d.z + o.z * (out || 3) + sz * (side || 0), face: Math.atan2(o.x, o.z) };
  }
  function lotsOfKinds(kinds) {
    const AR = A(); if (!AR) return [];
    const pools = [AR.lots || [], AR.shopLots || []];
    const out = [];
    for (let q = 0; q < pools.length; q++) {
      const L = pools[q];
      for (let i = 0; i < L.length; i++) {
        const l = L[i];
        if (!l || !doorOf(l) || l.demolished || l.kind === "player" || l.kind === "park") continue;
        if (out.indexOf(l) >= 0) continue;
        if (!kinds || kinds.indexOf(l.kind) >= 0) out.push(l);
      }
    }
    return out;
  }
  function pickLot(kinds, cx, cz, minD, maxD, salt, avoid) {
    let pool = lotsOfKinds(kinds).filter(function (l) { const d = d2(l.cx, l.cz, cx, cz); return d >= minD && d <= maxD && (!avoid || avoid.indexOf(l) < 0); });
    if (!pool.length) pool = lotsOfKinds(null).filter(function (l) { const d = d2(l.cx, l.cz, cx, cz); return d >= minD * 0.5 && d <= maxD * 1.6 && (!avoid || avoid.indexOf(l) < 0); });
    if (!pool.length) pool = lotsOfKinds(null).filter(function (l) { return isFinite(l.cx) && d2(l.cx, l.cz, cx, cz) >= 40 && (!avoid || avoid.indexOf(l) < 0); });
    if (!pool.length) pool = lotsOfKinds(null).filter(function (l) { return !avoid || avoid.indexOf(l) < 0; });
    if (!pool.length) return null;
    pool.sort(function (a, b) { return d2(a.cx, a.cz, cx, cz) - d2(b.cx, b.cz, cx, cz); });
    const r = h01(salt, (CBZ.WORLD_SEED | 0), 0xa9e);
    return pool[Math.min(pool.length - 1, (r * Math.min(5, pool.length)) | 0)];
  }
  function lotKey(l) { return l ? (Math.round(l.cx) + ":" + Math.round(l.cz)) : null; }
  function lotByKey(k) {
    if (!k) return null;
    const L = lotsOfKinds(null);
    for (let i = 0; i < L.length; i++) if (lotKey(L[i]) === k) return L[i];
    return null;
  }
  function nearestLot(x, z) {
    const L = lotsOfKinds(null); let best = null, bd = Infinity;
    for (let i = 0; i < L.length; i++) { const d = d2(L[i].cx, L[i].cz, x, z); if (d < bd) { bd = d; best = L[i]; } }
    return best;
  }
  function mansion() {
    const S = CBZ.govComplexes || [];
    for (let i = 0; i < S.length; i++) if (S[i] && S[i].rect && (S[i].id === "execmansion" || (S[i].def && S[i].def.id === "execmansion"))) return S[i];
    return null;
  }
  // the lot a man works at: peds.js's own persistent workplace, else a lot of
  // his job's kind nearest to him
  function workLotOf(ped) {
    if (!ped) return null;
    const w = ped._work || ped._workLot || null;
    if (w && w.building && w.building.door) return w;
    const J = CBZ.cityJobs && ped.job ? CBZ.cityJobs[ped.job] : null;
    const kinds = J && J.lots && J.lots.length ? J.lots : null;
    if (!kinds) return null;
    let best = null, bd = Infinity;
    lotsOfKinds(kinds).forEach(function (l) { const d = d2(l.cx, l.cz, ped.pos.x, ped.pos.z); if (d < bd) { bd = d; best = l; } });
    return best;
  }

  /* ================================================================
     §5  BODIES
     ================================================================ */
  let spawnSalt = 1;
  function spawn(name, x, z, opts) {
    opts = opts || {};
    const AR = A(); if (!AR || !AR.root || !CBZ.cityMakePed) return null;
    let s = ((x * 31 + z * 17) | 0) ^ (spawnSalt++ * 7919) ^ ((CBZ.WORLD_SEED | 0) * 13);
    const rng = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    let p = null;
    try {
      p = CBZ.cityMakePed(x, z, rng, {
        name: name, gender: opts.gender, job: opts.job || null, archetype: opts.archetype || (opts.armed ? "professional" : "resident"),
        armed: !!opts.armed, weapon: opts.weapon || (opts.armed ? "Pistol" : null), aggr: opts.aggr != null ? opts.aggr : 0.2,
        wealth: opts.wealth != null ? opts.wealth : 0.7,
      });
    } catch (e) { p = null; RT.why = "makePed: " + (e && e.message); }
    if (!p) return null;
    p.pos.y = floorY(x, z);
    AR.root.add(p.group);
    (CBZ.cityPeds || (CBZ.cityPeds = [])).push(p);
    p.name = name; p.nameKnown = !!opts.named;
    p._agency = true;
    p._campaignTarget = true;            // the shared "spoken for" stamp
    p.state = "idle"; p.pause = 1;
    if (opts.face != null && p.group) p.group.rotation.y = opts.face;
    if (opts.post) { p.staffPost = { x: x, z: z, face: opts.face != null ? opts.face : 0 }; }
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(p); } catch (e) {} }
    return p;
  }
  function despawn(p) {
    if (!p) return;
    if (!p.dead) {
      if (p.group && p.group.parent) p.group.parent.remove(p.group);
      const L = CBZ.cityPeds || [];
      const i = L.indexOf(p); if (i >= 0) L.splice(i, 1);
      if (CBZ.cityFloorPed && p._occupyY) { try { CBZ.cityFloorPed(p, 0); } catch (e) {} }
    }
    p._agency = false; p._campaignTarget = false;
  }
  function hostile(p) {
    if (!p || p.dead) return;
    p.staffPost = null; p.controlled = false;
    const PA = CBZ.city && CBZ.city.playerActor;
    if (PA) { p.rage = PA; p.state = "fight"; p.pause = 0; p.aggr = Math.max(p.aggr || 0, 0.95); }
  }
  function walkTo(p, x, z, run) {
    if (!p || p.dead) return;
    const AR = A();
    p.controlled = true; p.staffPost = null;
    const goal = { x: x, z: z };
    const far = d2(p.pos.x, p.pos.z, x, z);
    if (AR && AR.nearestIntersection && AR.step && far > AR.step * 0.9) {
      const it = AR.nearestIntersection(x, z);
      p.path = (it && d2(it.x, it.z, x, z) < far * 0.6 && d2(it.x, it.z, p.pos.x, p.pos.z) < far) ? [{ x: it.x, z: it.z }, goal] : [goal];
    } else p.path = [goal];
    p.finalGoal = goal;
    if (p.target && p.target.set) p.target.set(p.path[0].x, 0, p.path[0].z);
    p.state = run ? "flee" : "walk"; p.pause = 0;
  }
  function holdAt(p, face) {
    if (!p || p.dead) return;
    p.path = null; p.finalGoal = null; p.state = "idle"; p.pause = 2; p.speed = 0;
    if (p.target && p.target.set) p.target.set(p.pos.x, 0, p.pos.z);
    if (face != null && p.group) p.group.rotation.y = face;
  }
  function place(p, x, z) {
    if (!p || !p.pos) return;
    p.pos.set(x, floorY(x, z), z);
    if (p.group) p.group.position.copy(p.pos);
    if (p.target && p.target.set) p.target.set(x, 0, z);
  }

  /* ================================================================
     §6  PROPS (shared materials, no lights: an r128 light-count change
     recompiles every material in the city)
     ================================================================ */
  const MATS = {};
  function mat(hex, basic) {
    const k = hex + (basic ? "b" : "l");
    if (!MATS[k]) { MATS[k] = basic ? new THREE.MeshBasicMaterial({ color: hex }) : new THREE.MeshLambertMaterial({ color: hex }); MATS[k]._shared = true; }
    return MATS[k];
  }
  const GEO = {};
  function geo(k, make) { if (!GEO[k]) { GEO[k] = make(); GEO[k]._shared = true; } return GEO[k]; }
  function propGroup(x, z, face) {
    const grp = new THREE.Group();
    grp.position.set(x, floorY(x, z), z);
    grp.rotation.y = face || 0;
    grp.userData.transient = true; grp.userData.dynamic = true;
    const AR = A(); if (AR && AR.root) AR.root.add(grp);
    return grp;
  }
  function killGroup(grp) {
    if (!grp) return;
    if (grp.parent) grp.parent.remove(grp);
    grp.traverse(function (n) {
      if (n.geometry && !n.geometry._shared && n.geometry.dispose) n.geometry.dispose();
      if (n.material && !n.material._shared && n.material.dispose) { if (n.material.map && !n.material.map._shared) n.material.map.dispose(); n.material.dispose(); }
    });
  }
  function mesh(grp, g0, m, x, y, z) { const o = new THREE.Mesh(g0, m); o.position.set(x, y, z); grp.add(o); return o; }
  function buildCafe(x, z, face) {
    const grp = propGroup(x, z, face);
    mesh(grp, geo("pole", function () { return new THREE.CylinderGeometry(0.04, 0.05, 1.05, 8); }), mat(0x2a2c2f), 0, 0.53, 0);
    mesh(grp, geo("foot", function () { return new THREE.CylinderGeometry(0.26, 0.28, 0.04, 14); }), mat(0x2a2c2f), 0, 0.02, 0);
    mesh(grp, geo("top", function () { return new THREE.CylinderGeometry(0.36, 0.36, 0.035, 18); }), mat(0xd9d4c8), 0, 1.07, 0);
    const cup = mesh(grp, geo("cup", function () { return new THREE.CylinderGeometry(0.045, 0.037, 0.09, 10); }), mat(0xf4f1ea), 0.12, 1.135, 0.05);
    mesh(grp, geo("coffee", function () { return new THREE.CircleGeometry(0.04, 10); }), mat(0x3a2414), 0.12, 1.181, 0.05).rotation.x = -Math.PI / 2;
    mesh(grp, geo("saucer", function () { return new THREE.CylinderGeometry(0.08, 0.08, 0.01, 14); }), mat(0xf4f1ea), 0.12, 1.093, 0.05);
    grp.userData.cup = cup;
    return grp;
  }
  function buildCheckpoint(x, z, face) {
    const grp = propGroup(x, z, face);
    const bag = mat(0x8a7d5c);
    for (let s = -1; s <= 1; s += 2) {
      for (let row = 0; row < 3; row++) {
        const o = mesh(grp, geo("bags", function () { return new THREE.BoxGeometry(2.6, 0.32, 0.7); }), bag, s * 4.2, 0.17 + row * 0.3, 0);
        o.scale.x = 1 - row * 0.08;
      }
    }
    mesh(grp, geo("barpost", function () { return new THREE.BoxGeometry(0.22, 1.0, 0.22); }), mat(0x3c3f33), -2.4, 0.5, 0);
    mesh(grp, geo("bararm", function () { return new THREE.BoxGeometry(4.6, 0.12, 0.12); }), mat(0xc9c3b0), 0, 0.95, 0);
    for (let i = 0; i < 4; i++) mesh(grp, geo("barred", function () { return new THREE.BoxGeometry(0.55, 0.13, 0.13); }), mat(0xa3272a), -1.7 + i * 1.15, 0.95, 0);
    return grp;
  }
  let poolTex = null;
  function poolTexture() {
    if (poolTex) return poolTex;
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const cc = c.getContext("2d");
    const gr = cc.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,190,110,0.85)"); gr.addColorStop(0.45, "rgba(255,160,80,0.32)"); gr.addColorStop(1, "rgba(255,140,60,0)");
    cc.fillStyle = gr; cc.fillRect(0, 0, 128, 128);
    poolTex = new THREE.CanvasTexture(c);
    poolTex._shared = true;
    return poolTex;
  }
  function buildLamp(x, z) {
    const grp = propGroup(x, z, 0);
    mesh(grp, geo("lamppole", function () { return new THREE.CylinderGeometry(0.08, 0.11, 6.2, 8); }), mat(0x1d1f22), 0, 3.1, 0);
    mesh(grp, geo("lamparm", function () { return new THREE.BoxGeometry(1.4, 0.1, 0.12); }), mat(0x1d1f22), 0.62, 6.1, 0);
    mesh(grp, geo("lamphead", function () { return new THREE.BoxGeometry(0.6, 0.14, 0.34); }), mat(0xffc27a, true), 1.2, 6.0, 0);
    const coneM = new THREE.MeshBasicMaterial({ color: 0xffb46b, transparent: true, opacity: 0.075, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    mesh(grp, new THREE.ConeGeometry(2.9, 5.8, 20, 1, true), coneM, 1.2, 3.05, 0);
    const poolM = new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const pool = mesh(grp, new THREE.PlaneGeometry(9, 9), poolM, 1.2, 0.04, 0);
    pool.rotation.x = -Math.PI / 2;
    return grp;
  }
  function buildBook(x, z) {
    const grp = propGroup(x, z, h01(x, z, 3) * 6.28);
    mesh(grp, geo("book", function () { return new THREE.BoxGeometry(0.2, 0.035, 0.28); }), mat(0x0d0d0f), 0, 0.03, 0);
    mesh(grp, geo("bookband", function () { return new THREE.BoxGeometry(0.205, 0.037, 0.02); }), mat(0x6b1a17), 0, 0.03, 0.1);
    return grp;
  }

  /* ================================================================
     §7  EYES — what the player actually saw (binoculars are a scope)
     ================================================================ */
  const _v = new THREE.Vector3(), _dir = new THREE.Vector3();
  function bino() { try { return !!(CBZ.hmBinoculars && CBZ.hmBinoculars.active && CBZ.hmBinoculars.active()); } catch (e) { return false; } }
  function scoped() {
    if (bino()) return true;
    try { return !!(CBZ.fpsScoped && CBZ.fpsScoped()); } catch (e) { return false; }
  }
  function sees(x, y, z, range, cosMin) {
    const cam = CBZ.camera; if (!cam || !cam.getWorldDirection) return false;
    cam.getWorldDirection(_dir);
    _v.set(x - cam.position.x, y - cam.position.y, z - cam.position.z);
    const d = _v.length(); if (d > range || d < 0.01) return false;
    return (_v.dot(_dir) / d) >= cosMin;
  }
  function seesPed(p, loose) {
    if (!p || !p.pos || (p.group && !p.group.visible)) return false;
    const y = p.pos.y + 1.5;
    if (scoped() && sees(p.pos.x, y, p.pos.z, 340, bino() ? 0.995 : 0.992)) return true;
    return sees(p.pos.x, y, p.pos.z, loose ? 75 : 34, loose ? 0.8 : 0.86);
  }
  function seesPoint(x, y, z) {
    if (scoped()) return sees(x, y, z, 340, 0.995);
    return sees(x, y, z, 45, 0.9);
  }

  /* ================================================================
     §8  RUNTIME
     ================================================================ */
  const RT = { op: null, meet: null, fin: null, street: null, killWatch: null, openT: 0, ringing: false, envFor: null, why: null, boardKey: "", boardT: 0, tvKey: "", paperCanvas: null, photos: {} };

  /* ================================================================
     §9  THE OPERATIONS (LEDGER / CARGO / BLACK BOOK)
     ================================================================ */
  function opVenues(def) {
    const a = arc();
    a.venues = a.venues || {};
    const saved = a.venues[def.id];
    if (saved) {
      const out = {}; let ok = true;
      for (const k in saved) { out[k] = lotByKey(saved[k]); if (!out[k]) ok = false; }
      if (ok) return out;
    }
    const p = P(); const AR = A();
    const px = p && p.pos ? p.pos.x : (AR && AR.center ? AR.center.x : 0);
    const pz = p && p.pos ? p.pos.z : (AR && AR.center ? AR.center.z : 0);
    const out = {}, used = [], keys = {};
    for (let i = 0; i < def.venues.length; i++) {
      const v = def.venues[i];
      const base = v.near && out[v.near] ? out[v.near] : null;
      const lot = base
        ? pickLot(v.kinds, base.cx, base.cz, 35, 150, def.fileNo * 97 + i, used)
        : pickLot(v.kinds, px, pz, 130, 460, def.fileNo * 131 + i, used);
      if (!lot) { RT.why = "no lot for " + v.key + " near " + Math.round(px) + "," + Math.round(pz) + " lots=" + lotsOfKinds(null).length; return null; }
      out[v.key] = lot; used.push(lot); keys[v.key] = lotKey(lot);
    }
    a.venues[def.id] = keys;
    commit();
    return out;
  }
  function fillText(s, V) { return String(s).replace(/\{(\w+)\}/g, function (_, k) { return V[k] ? lotName(V[k]) : "the place"; }); }
  // the hour a leg first starts in the day, for the file and the paper
  function legFrom(def, i) {
    const S = (def.sched || []).filter(function (e) { return e.leg === i; });
    return S.length ? S[0].h : null;
  }
  function legAtHour(def, h) {
    const S = def.sched || [];
    if (!S.length) return 0;
    let cur = S[S.length - 1].leg;          // before the first entry: last night's leg
    for (let i = 0; i < S.length; i++) if (h >= S[i].h) cur = S[i].leg;
    return cur;
  }

  // THE ROUTINE LIVES IN THE BRAIN (CBZ.brain.needs): each mark's public
  // schedule is his own archetype's day plan ("hitman_target:<op>"), read
  // through a small schedule handle so the city re-registering the body
  // never loses it. Without the core the table above answers the same.
  function brainB() { return CBZ.brain || null; }
  function schedOf(op) {
    if (op._sched !== undefined) return op._sched;
    op._sched = null;
    const B = brainB();
    if (!B || !B.needs || typeof B.needs.define !== "function" || typeof B.define !== "function" || typeof B.of !== "function") return null;
    const id = "hitman_target:" + op.id;
    try {
      B.define(id, B.archetype ? B.archetype("hitman_target") : {});
      const S = op.def.sched || [];
      B.needs.define(id, S.map(function (e) {
        const L = op.legs[e.leg];
        return { id: "leg" + e.leg, from: e.h, activity: L ? L.label : "leg", where: { leg: e.leg, x: L ? L.x : 0, z: L ? L.z : 0 } };
      }));
      const handle = {};
      B.of(handle, id);
      op._sched = handle;
    } catch (e) { op._sched = null; }
    return op._sched;
  }
  function legNow(op) {
    const B = brainB(), S = schedOf(op);
    if (B && S) {
      try { const c = B.needs.current(S, hour()); if (c && c.where && c.where.leg != null) return c.where.leg; } catch (e) {}
    }
    return legAtHour(op.def, hour());
  }
  // HOW HE TAKES A THREAT: CBZ.brain.threat.respond, by his personality,
  // whether he is armed, how close you are and whether you are aiming at him.
  function respondTo(op, p, why) {
    const B = brainB(), pl = P(), PA = CBZ.city && CBZ.city.playerActor;
    if (!B || !B.threat || typeof B.threat.respond !== "function" || !pl || !pl.pos) return "flee";
    let aimed = false;
    if (CBZ.isAimingWeapon && CBZ.isAimingWeapon() && typeof CBZ.aimedActor === "function") {
      try { const a = CBZ.aimedActor(120); aimed = !!(a && a.actor === p); } catch (e) { aimed = false; }
    }
    const th = {
      source: PA || null, x: pl.pos.x, z: pl.pos.z, armed: !!(CBZ.cityHasGun && CBZ.cityHasGun()),
      aimingAtMe: aimed, distance: d2(p.pos.x, p.pos.z, pl.pos.x, pl.pos.z),
      kind: why === "heat" ? "sirens" : why === "hurt" ? "gunshot" : "attack",
    };
    let r = "flee";
    try { B.of(p, "hitman_target"); r = B.threat.respond(p, th) || "flee"; } catch (e) { r = "flee"; }
    if (r === "fight" && !p.armed) r = "flee";            // an unarmed banker does not charge a gun
    return r;
  }

  function buildOp(id) {
    const def = OPS[id]; if (!def) return null;
    const V = opVenues(def); if (!V) return null;
    const op = {
      id: id, def: def, V: V, legs: [], leg: 0, phase: "walk", t: 0, stuckT: 0, lastD: Infinity,
      ped: null, sentries: [], props: [], car: null, charge: false, poisoned: false,
      identified: false, idT: 0, alarm: 0, everAlarm: false,
      kills: { civ: 0, guard: 0 }, accident: null, dead: false, killPt: null,
      book: null, bookTaken: false,
    };
    for (let i = 0; i < def.legs.length; i++) {
      const L = def.legs[i];
      let pt = null;
      if (L.at === "car") {
        const lot = V.shop || V[Object.keys(V)[0]];
        pt = spotAt(lot, 5.2, 3.6);
        op.carPt = spotAt(lot, 7.6, 1.2);
      } else if (L.at === "checkpoint") {
        const lot = V.post; const AR = A();
        const d = doorOf(lot);
        const it = AR && AR.nearestIntersection ? AR.nearestIntersection(d.x, d.z) : null;
        const base = it ? { x: it.x, z: it.z } : spotAt(lot, 12, 0);
        const o = outward(lot);
        pt = { x: base.x + o.z * 3, z: base.z - o.x * 3, face: Math.atan2(o.x, o.z) };
        op.checkPt = { x: base.x, z: base.z, face: Math.atan2(-o.z, o.x) };
      } else {
        pt = spotAt(V[L.at], L.prop === "cafe" ? 3.4 : 2.6, L.prop === "cafe" ? 2.2 : -1.2);
      }
      op.legs.push({ def: L, x: pt.x, z: pt.z, face: pt.face, label: L.label, detail: fillText(L.detail, V), from: legFrom(def, i) });
    }
    return op;
  }

  function stageOp(op) {
    if (op.staged) return;
    op.staged = true;
    const def = op.def;
    for (let i = 0; i < op.legs.length; i++) {
      const L = op.legs[i];
      if (L.def.prop === "cafe") { const cx = L.x + Math.sin(L.face) * 0.6, cz = L.z + Math.cos(L.face) * 0.6; op.cafe = buildCafe(cx, cz, L.face); op.cafePt = { x: cx, z: cz }; op.props.push(op.cafe); }
      if (L.def.prop === "checkpoint" && op.checkPt) {
        op.props.push(buildCheckpoint(op.checkPt.x, op.checkPt.z, op.checkPt.face));
        for (let s = -1; s <= 1; s += 2) {
          const sx = op.checkPt.x + Math.cos(op.checkPt.face) * s * 5.4, sz = op.checkPt.z - Math.sin(op.checkPt.face) * s * 5.4;
          const q = spawn("Sentry", sx, sz, { job: "soldier", armed: true, weapon: "Rifle", aggr: 0.9, post: true, face: L.face, gender: "m" });
          if (q) { q._agencyOp = op.id; q._agencyGuard = true; op.sentries.push(q); }
        }
      }
    }
    if (op.carPt && CBZ.cityAddParkedCar) {
      try { op.car = CBZ.cityAddParkedCar(op.carPt.x, op.carPt.z, op.carPt.face + Math.PI / 2, { color: 0x0e1013 }); } catch (e) { op.car = null; }
      if (op.car) op.car._agencyOp = op.id;
    }
    // he starts where the clock says he is
    op.leg = legNow(op);
    const first = op.legs[op.leg] || op.legs[0];
    const p = spawn(def.name, first.x, first.z, { job: def.job, gender: def.gender, archetype: "official", wealth: 0.9, named: true, face: first.face });
    if (!p) return;
    op.ped = p; p._agencyOp = op.id; p._agencyMark = true;
    p.controlled = true;
    if (CBZ.powerPrincipal) {
      try { CBZ.powerPrincipal(p, { tier: def.tier, org: "detail:" + op.id, lawful: false, role: def.role.split(".")[0] }); } catch (e) {}
    }
    holdAt(p, first.face);
    op.phase = "dwell"; op.t = 0;
    photograph(op.id, p);
  }
  function photograph(key, p) {
    if (RT.photos[key] || !p) return RT.photos[key] || "";
    let ph = "", wr = null;
    if (CBZ.cityMugshot) { try { ph = CBZ.cityMugshot({ ped: p }) || ""; } catch (e) { ph = ""; } }
    if (CBZ.cityMugshotWearing) { try { wr = CBZ.cityMugshotWearing({ ped: p }) || null; } catch (e) {} }
    RT.photos[key] = ph; RT.photos[key + ":wear"] = wr;
    return ph;
  }
  function photoOf(key) { return RT.photos[key] || ""; }

  function teardownOp(op) {
    if (!op) return;
    for (let i = 0; i < op.props.length; i++) killGroup(op.props[i]);
    op.props.length = 0;
    if (op.book) { killGroup(op.book); op.book = null; }
    if (op.ped) {
      if (CBZ.powerDissolve) { try { CBZ.powerDissolve(op.ped); } catch (e) {} }
      if (!op.ped.dead) despawn(op.ped);
      else op.ped._agency = false;
    }
    for (let i = 0; i < op.sentries.length; i++) if (op.sentries[i] && !op.sentries[i].dead) despawn(op.sentries[i]);
    op.sentries.length = 0;
  }
  function guardsOf(op) {
    let G = [];
    if (op.ped && CBZ.powerGuardsOf) { try { G = CBZ.powerGuardsOf(op.ped) || []; } catch (e) { G = []; } }
    G = G.slice();
    for (let i = 0; i < op.sentries.length; i++) G.push(op.sentries[i]);
    return G;
  }
  function currentLeg(op) { return op.legs[op.leg] || op.legs[0]; }

  // THE ROUTINE — the city clock says where he should be. He walks there,
  // stands a while, and does the thing he does there.
  function tickRoutine(op, dt) {
    const p = op.ped; if (!p || p.dead) return;
    if (op.alarm > 0) return;
    const want = legNow(op);
    if (want !== op.leg) {
      op.leg = want; op.phase = "walk"; op.t = 0; op.stuckT = 0; op.lastD = Infinity;
      const N = currentLeg(op);
      walkTo(p, N.x, N.z);
    }
    const L = currentLeg(op);
    if (op.phase === "walk") {
      const d = d2(p.pos.x, p.pos.z, L.x, L.z);
      if (d < 1.3) { op.phase = "dwell"; op.t = 0; holdAt(p, L.face); return; }
      op.stuckT += dt;
      if (op.lastD - d > 1) { op.lastD = d; op.stuckT = 0; }
      if (op.stuckT > 8) {
        op.stuckT = 0; op.lastD = Infinity;
        // the Truman rule: a stuck man is moved only while nobody watches
        if (!seesPed(p, true) && distP(p.pos.x, p.pos.z) > 40) { place(p, L.x, L.z); op.phase = "dwell"; op.t = 0; holdAt(p, L.face); }
        else walkTo(p, L.x, L.z);
      }
      if (p.state !== "walk" && p.state !== "flee") { p.state = "walk"; p.pause = 0; }
      return;
    }
    op.t += dt;
    if (p.state !== "idle") holdAt(p, L.face);
    onDwell(op, L, dt);
  }
  function onDwell(op, L, dt) {
    const p = op.ped;
    if (L.def.prop === "cafe") {
      if (op.t > 5 && op.t - dt <= 5 && op.poisoned) bark(p, "Hm.", 1.6);
      if (op.poisoned && op.t > 9 && !op.dead) { op.accident = "poison"; accidentKill(op, p); }
    }
    if (L.def.prop === "car" && op.car && !op.car.dead && op.charge && op.t > 3 && !op.dead) { op.accident = "charge"; carBomb(op, op.car, p); }
  }
  function accidentKill(op, p) {
    if (!p || p.dead) return;
    p.killedBy = { name: "Heart failure", isPlayer: false };
    const w0 = g.wanted | 0, h0 = g.heat || 0;
    RT.killWatch = { t: now() + 800, noCount: true };
    try { CBZ.cityKillPed(p, { byPlayer: false, noCrime: true }, "poison"); } catch (e) {}
    // an officeholder's death charges heat unconditionally; nobody saw you
    if ((g.wanted | 0) > w0) { g.wanted = w0; g.heat = h0; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
    addNote(op.id, "He sat down at the table and did not get up.");
  }
  function carBomb(op, car, victim) {
    if (!car || car._agencyBoom) return;
    car._agencyBoom = true;
    const x = car.pos.x, z = car.pos.z;
    if (victim && !victim.dead) victim.killedBy = { name: "A car fire", isPlayer: false };
    RT.killWatch = { t: now() + 1200, blast: true };
    try { if (CBZ.cityExplosion) CBZ.cityExplosion(x, z, { power: 1.5, radius: 6, byPlayer: false }); } catch (e) {}
    try { if (CBZ.cityDamageCar) CBZ.cityDamageCar(car, 9999); } catch (e) {}
    try { if (CBZ.cityCarIgnite) CBZ.cityCarIgnite(car); } catch (e) {}
    car.dead = true;
    if (victim && !victim.dead) { try { CBZ.cityKillPed(victim, { byPlayer: false, noCrime: true }, "explosion"); } catch (e) {} }
    if (op) addNote(op.id, "The car went up at the curb.");
  }

  function tickAlarm(op, dt) {
    const p = op.ped; if (!p || p.dead) return;
    const pl = P(); if (!pl || !pl.pos) return;
    let why = null;
    if (p.hp != null && p.maxHp != null && p.hp < p.maxHp - 1) why = "hurt";
    const G = guardsOf(op);
    for (let i = 0; i < G.length && !why; i++) {
      const q = G[i]; if (!q) continue;
      if (q.dead) { why = "guard"; break; }
      if (q.rage && (q.rage === (CBZ.city && CBZ.city.playerActor)) && q.state === "fight") why = "guard";
    }
    const dp = d2(p.pos.x, p.pos.z, pl.pos.x, pl.pos.z);
    if (!why && (g.wanted | 0) >= 2 && dp < 70) why = "heat";
    if (why) {
      if (!op.alarm) {
        op.everAlarm = true;
        op.resp = respondTo(op, p, why); op.respT = 0;
        const R = op.resp;
        addNote(op.id, why === "heat" ? "He heard the sirens and ran."
          : R === "fight" ? "He pulled a gun of his own."
          : R === "surrender" || R === "comply" ? "He put his hands up and begged."
          : R === "freeze" || R === "cover" ? "He froze, then his people went for their guns and he ran."
          : "His people went for their guns. He ran.");
        for (let i = 0; i < op.sentries.length; i++) hostile(op.sentries[i]);
        bark(p, R === "fight" ? "You picked the wrong man." : R === "surrender" || R === "comply" ? "Don't shoot! Please!" : R === "freeze" || R === "cover" ? "Oh God..." : "Get me out of here!", 2);
      }
      op.alarm = 40; op.alarmWhy = why;
      op.respT = (op.respT || 0) + dt;
      const R = op.resp;
      if (R === "fight" && p.armed) { if (!p.rage) hostile(p); return; }
      // a freeze is a beat, not a plan: ducked, then he runs
      if ((R === "freeze" || R === "cover") && op.respT < 2.2) {
        if (p.state !== "idle") holdAt(p, null);
        p.poseCower = Math.max(p.poseCower || 0, 0.6);
        return;
      }
      // hands up while the gun is close; the moment you are not, he runs
      if ((R === "surrender" || R === "comply") && op.respT < 14 && dp < 15) {
        if (p.state !== "idle") holdAt(p, null);
        p.poseHandsUp = true;
        return;
      }
      if (p.poseHandsUp && !p.surrender) p.poseHandsUp = false;
      const home = op.legs[0];
      if (p.controlled || p.state !== "flee") walkTo(p, home.x, home.z, true);
      return;
    }
    if (op.alarm > 0) {
      op.alarm -= dt;
      const home = op.legs[0];
      if (d2(p.pos.x, p.pos.z, home.x, home.z) < 2) holdAt(p, home.face);
      if (op.alarm <= 0 && dp > 45) {
        op.alarm = 0; op.leg = -1; op.phase = "walk";
        addNote(op.id, "Back on his routine. Nervous.");
      } else if (op.alarm <= 0) op.alarm = 5;
    }
  }

  const APPR_NOTE = {
    poison: "His cup sits alone on the table while he walks off.",
    charge: "Nobody watches the car for a minute or two at a time.",
    disguise: "His people all wear the same suit.",
    long: "",
  };
  function knowAppr(op, id, line) {
    const S = seenOf(op.id);
    if (S.appr[id]) return;
    S.appr[id] = true;
    addNote(op.id, line || APPR_NOTE[id] || "");
  }
  function tickIntel(op, dt) {
    const p = op.ped; if (!p || p.dead) return;
    const S = seenOf(op.id);
    const vis = seesPed(p, false), far = vis || seesPed(p, true);
    if (!op.identified) {
      if (vis) op.idT += dt;
      if (op.idT > (scoped() ? 0.5 : 1.1)) {
        op.identified = true; S.id = true;
        addNote(op.id, "Saw his face. That's him.");
        refreshFile(true);
      }
    }
    if (far && op.phase === "dwell") {
      const k = String(op.leg);
      if (!S.legs[k]) {
        S.legs[k] = "eyes";
        const L = currentLeg(op);
        addNote(op.id, L.label + ". " + L.detail);
        if (L.def.prop === "cafe") knowAppr(op, "poison");
        if (L.def.prop === "car") knowAppr(op, "charge");
      }
      if (!S.appr.long && distP(p.pos.x, p.pos.z) > 60 && seesPed(p, true)) knowAppr(op, "long", "A clear line from where I stood. " + Math.round(distP(p.pos.x, p.pos.z)) + " m.");
    }
    const G = guardsOf(op);
    for (let i = 0; i < G.length; i++) {
      const q = G[i]; if (!q || q._agencySeen) continue;
      if (seesPed(q, true)) {
        q._agencySeen = true;
        S.guards = Math.max(S.guards | 0, G.filter(function (x) { return x && x._agencySeen; }).length);
        knowAppr(op, "disguise");
        refreshFile();
      }
    }
    if (op.cafePt && distP(op.cafePt.x, op.cafePt.z) < 10) knowAppr(op, "poison");
    if (op.car && !op.car.dead && distP(op.car.pos.x, op.car.pos.z) < 12) knowAppr(op, "charge");
  }
  // THE STOLEN SUIT (outfits.js corpse swap): a suit off THIS detail is
  // trusted by this detail (power.js reads cityDisguiseTrust(rec.org)).
  function tickDisguise(op) {
    const w = g.cityWornOutfit;
    const G = guardsOf(op);
    for (let i = 0; i < G.length; i++) {
      const q = G[i];
      if (!q || !q.dead || !q._wornOutfit || q._agencyStripped) continue;
      if (distP(q.pos.x, q.pos.z) > 4) continue;
      q._agencyStripped = true;
      if (w) {
        w._claimOrg = op.ped && op.ped._power ? op.ped._power.org : ("detail:" + op.id);
        w._claimRole = w._claimRole || "Close protection";
        w._claimArms = "gun";
        addNote(op.id, "In his people's clothes now. They will let me close.");
        knowAppr(op, "disguise");
      }
    }
  }

  /* ---- the kill, then the world's answer (hitman_fallout.js) ---- */
  function onMarkDead(op) {
    if (op.dead) return;
    op.dead = true;
    const p = op.ped;
    op.killPt = { x: p.pos.x, z: p.pos.z };
    const cause = op.accident || "shot";
    unpin("mark");
    const inc = report({
      ped: p, name: op.def.name, role: op.def.role, place: lotName(nearestLot(p.pos.x, p.pos.z)), cause: cause,
      kills: op.kills, alarm: op.everAlarm, weight: "someone",
    });
    afterKill(op.id, op.def.pay, inc);
    addNote(op.id, cause === "poison" ? "Dead at the table." : (cause === "charge" ? "Dead in his car." : "Dead."));
    if (op.id === "book" && !op.book) {
      op.book = buildBook(op.killPt.x + 0.6, op.killPt.z + 0.3);
      op.bookPt = { x: op.killPt.x + 0.6, z: op.killPt.z + 0.3 };
    }
    crossOut(op.id, op.def.name);
    refreshFile(true);
  }
  function report(info) {
    const F = FO();
    let inc = null;
    if (F && F.kill) { try { inc = F.kill(info); } catch (e) { inc = null; } }
    if (inc && inc.story) addStory({ headline: inc.story.headline, deck: inc.story.deck, body: inc.story.body, photoKey: info.photoKey || null, tv: inc.story.tv, prio: info.weight === "state" ? 3 : 1 });
    return inc;
  }
  const MUL = { clean: 1.5, seen: 1, messy: 0.75, bloodbath: 0.5 };
  function afterKill(id, base, inc) {
    const a = arc(); if (!a) return;
    const v = inc && inc.verdict ? inc.verdict : ((g.wanted | 0) > 0 ? "seen" : "clean");
    const J = a.job && a.job.id === id ? a.job : setJob(id, "after");
    J.phase = "after"; J.inc = inc ? inc.id : null; J.verdict = v;
    J.pay = Math.round(base * (MUL[v] || 1) / 50) * 50;
    J.killX = inc ? inc.x : null; J.killZ = inc ? inc.z : null;
    a.how[id] = v;
    commit();
    boardDirty();
  }
  function crossOut(key, name) {
    const a = arc(); if (!a) return;
    if (a.crossed.some(function (c) { return c.key === key; })) return;
    a.crossed.push({ key: key, name: name });
    commit(); boardDirty();
  }

  /* ---- the verbs on objects (hmVerbs: one caption, no card) ---- */
  let verbsWired = false;
  function wireVerbs() {
    const V = CBZ.hmVerbs;
    if (verbsWired || !V || !V.add) return;
    verbsWired = true;
    const cupTok = { x: 0, z: 0 };
    V.add({
      id: "agency-cup", prio: 15, range: 1.8,
      find: function (px, pz) {
        const op = RT.op;
        if (!op || op.dead || !op.cafePt || op.poisoned || !playing()) return null;
        const a = arc(); if (!a || (a.kit.vial | 0) <= 0) return null;
        if (d2(px, pz, op.cafePt.x, op.cafePt.z) > 1.8) return null;
        // not with him or his man standing right there
        const p = op.ped;
        if (p && !p.dead && d2(p.pos.x, p.pos.z, op.cafePt.x, op.cafePt.z) < 7) return null;
        const G = guardsOf(op);
        for (let i = 0; i < G.length; i++) { const q = G[i]; if (q && !q.dead && d2(q.pos.x, q.pos.z, op.cafePt.x, op.cafePt.z) < 8) return null; }
        cupTok.x = op.cafePt.x; cupTok.z = op.cafePt.z;
        return cupTok;
      },
      verb: "Poison the cup",
      onUse: function () {
        const op = RT.op; const a = arc(); if (!op || !a) return;
        a.kit.vial = Math.max(0, (a.kit.vial | 0) - 1);
        op.poisoned = true; commit();
        knowAppr(op, "poison");
        addNote(op.id, "The vial is in his cup.");
      },
    });
    const carTok = { x: 0, z: 0 };
    V.add({
      id: "agency-car", prio: 15, range: 2.9,
      find: function (px, pz) {
        if (!playing()) return null;
        const a = arc(); if (!a || (a.kit.charge | 0) <= 0) return null;
        const c = chargeCar(); if (!c) return null;
        if (d2(px, pz, c.pos.x, c.pos.z) > 2.9 || chargeWatcher(c)) return null;
        carTok.x = c.pos.x; carTok.z = c.pos.z;
        return carTok;
      },
      verb: "Plant the charge",
      onUse: function () {
        const a = arc(); const c = chargeCar(); if (!a || !c) return;
        a.kit.charge = Math.max(0, (a.kit.charge | 0) - 1);
        c._agencyCharged = true;
        if (RT.op && c === RT.op.car) { RT.op.charge = true; knowAppr(RT.op, "charge"); addNote(RT.op.id, "Charge under the driver's seat. It goes when his door closes."); }
        if (RT.fin && RT.fin.seam && c === realStateCar()) { RT.fin.charge = true; RT.fin.chargeCar = c; RT.fin.chargeAt = { x: c.pos.x, z: c.pos.z }; finNote("Charge under the state car. It goes when it pulls away."); }
        commit();
      },
    });
    const bookTok = { x: 0, z: 0 };
    V.add({
      id: "agency-book", prio: 16, range: 2,
      find: function (px, pz) {
        const op = RT.op;
        if (!op || op.id !== "book" || !op.book || op.bookTaken || !playing()) return null;
        bookTok.x = op.bookPt.x; bookTok.z = op.bookPt.z;
        return d2(px, pz, bookTok.x, bookTok.z) < 2 ? bookTok : null;
      },
      verb: "Take the book",
      onUse: function () { takeBook(); },
    });
    const rideTok = { x: 0, z: 0 };
    V.add({
      id: "agency-ride", prio: 15, range: 3.4,
      find: function (px, pz) {
        const a = arc();
        if (!a || a.step !== "finale" || !RT.meet || !RT.meet.car || RT.meet.car.dead || !playing()) return null;
        if (RT.fin && RT.fin.gate && distP(RT.fin.gate.x, RT.fin.gate.z) < 400) return null;
        rideTok.x = RT.meet.car.pos.x; rideTok.z = RT.meet.car.pos.z;
        return d2(px, pz, rideTok.x, rideTok.z) < 3.4 ? rideTok : null;
      },
      verb: "Get in",
      onUse: function () { rideToMansion(); },
    });
    const vossTok = { x: 0, z: 0 };
    V.add({
      id: "agency-handbook", prio: 18, range: 2.6,
      find: function (px, pz) {
        const mt = RT.meet;
        if (!mt || mt.kind !== "meet2" || !mt.handOut || mt.done || !mt.voss || mt.voss.dead || !playing()) return null;
        vossTok.x = mt.voss.pos.x; vossTok.z = mt.voss.pos.z;
        return d2(px, pz, vossTok.x, vossTok.z) < 2.6 ? vossTok : null;
      },
      verb: "Hand him the book",
      onUse: function () { handBook(); },
    });
    // a man on the President's detail can be paid (protection.suborn: the
    // price and whether he takes it are president mode's rules, not ours)
    const bribeTok = { x: 0, z: 0, ped: null };
    V.add({
      id: "agency-bribe", prio: 14, range: 2.2,
      find: function (px, pz) {
        const F = RT.fin;
        if (!F || !F.seam || F.dead || F.alarm > 0 || !playing() || !CBZ.protection || !CBZ.protection.suborn || !F.seamDetail) return null;
        const G = F.seamDetail.peds;
        for (let i = 0; i < G.length; i++) {
          const q = G[i];
          if (!q || q.dead || q.rage || q._subornT > 0 || q._hmAsked) continue;
          if (d2(px, pz, q.pos.x, q.pos.z) < 2.2) { bribeTok.x = q.pos.x; bribeTok.z = q.pos.z; bribeTok.ped = q; return bribeTok; }
        }
        return null;
      },
      verb: "Offer him money",
      onUse: function (tok) {
        const q = tok && tok.ped; if (!q) return;
        let r = null; try { r = CBZ.protection.suborn(q); } catch (e) { r = null; }
        if (r && r.ok) { bark(q, "I was looking the other way.", 2.6); finNote("One of his men took the money. " + (q.name ? q.name + "." : "")); boardDirty(); }
        else if (r && r.reason === "can't afford") bark(q, "Not for that kind of money.", 2.4);
        else { q._hmAsked = true; bark(q, "Walk away. Now.", 2.2); }
      },
    });
  }
  function chargeCar() {
    const op = RT.op;
    if (op && op.car && !op.car.dead && !op.charge && !op.dead) return op.car;
    const F = RT.fin;
    if (F && F.seam && !F.charge && !F.dead) { const sc = realStateCar(); if (sc && !(sc.v > 1.5)) return sc; }
    return null;
  }
  function chargeWatcher(car) {
    const pools = [];
    if (RT.op && RT.op.ped) { pools.push(RT.op.ped); guardsOf(RT.op).forEach(function (q) { pools.push(q); }); }
    if (RT.fin && RT.fin.ped) { pools.push(RT.fin.ped); finGuards().forEach(function (q) { pools.push(q); }); }
    const disguised = !!(g.cityWornOutfit && g.cityWornOutfit._claimOrg && String(g.cityWornOutfit._claimOrg).indexOf("detail:") === 0);
    for (let i = 0; i < pools.length; i++) {
      const q = pools[i];
      if (!q || q.dead || !q.pos || (q.group && !q.group.visible)) continue;
      if (d2(q.pos.x, q.pos.z, car.pos.x, car.pos.z) < (disguised ? 3 : 9)) return q;
    }
    return null;
  }
  // TAKEN WITH A HAND (systems/verbs_pickup.js): the book leaves the desk in
  // the hand (it is yours on the grab frame), and you open it once it is up.
  function takeBook() {
    const op = RT.op; const a = arc(); if (!op || !a || op.bookTaken || op._bookTaking) return;
    op._bookTaking = true;
    const took = function () {
      op._bookTaking = false;
      if (op.bookTaken) return;
      op.bookTaken = true; a.book = true;
      if (op.book) { killGroup(op.book); op.book = null; }
      commit();
      addNote("book", "The black book. The President's week, in Varga's hand.");
      addNote("book", "A loose page in the back. A Bureau cable with my file number on it.");
    };
    if (CBZ.verbs && CBZ.verbs.pickup) CBZ.verbs.pickup(CBZ.player, op.book || null, { pose: "grip", keep: true, onTaken: took, onDone: readBook });
    else { took(); readBook(); }
  }
  function readBook() {
    // you read it where you stand: his week, then the page at the back
    const K = paper(), H = hold();
    if (K && H && K.bookPage && H.open) {
      const pageC = K.bookPage({ title: "The week", rows: presidentWeekRows() });
      H.open(pageC, { kind: "paper", onClose: function () {
        if (K.cable) setTimeout(function () { H.open(K.cable({ lines: cableLines() }), { kind: "paper" }); }, 250);
      } });
    }
    boardDirty();
  }
  function cableLines() {
    return [
      "BUREAU EYES ONLY. RELAY TO V.",
      "SUBJECT: CONTRACT ASSET, FILE 7731.",
      "ON COMPLETION OF HEAD OF STATE, ASSET TO BE RETIRED.",
      "EXTRACTION POINT TO SERVE. NO RECORD.",
      "V.",
    ];
  }

  /* ================================================================
     §10  THE STREET NAME (the Hitman card's opening)
     ================================================================ */
  const NICO_CALL = [
    { by: "phone", line: "It's Nico. You up?" },
    { by: "phone", line: "I got one for you. Nothing fancy. A guy who owes the wrong people." },
    { by: "phone", line: "Envelope's coming under your door. Photo, where he works, where he sleeps." },
    { by: "phone", line: "Same as always. Quiet is better. I'll text you where the money is." },
  ];
  function bindStreet() {
    if (!CBZ.hitmanBind) return null;
    let con = null;
    try { con = CBZ.hitmanBind(0, { minDist: 70, salt: (arc().street | 0) + 3 }); } catch (e) { con = null; }
    if (!con || !con.ped) return null;
    const p = con.ped;
    p._hitMark = true; p._campaignTarget = true; p._agencyMark = true;
    const work = workLotOf(p);
    let home = null; try { home = CBZ.cityHomeOf ? CBZ.cityHomeOf(p) : null; } catch (e) { home = null; }
    const S = { con: con, ped: p, name: con.name || p.name || "him", work: work, home: home && home.cx != null ? home : null, identified: false, idT: 0, kills: { civ: 0, guard: 0 }, dead: false };
    RT.photos.street = con.photo || "";
    RT.photos["street:wear"] = con.wearing || null;
    RT.street = S;
    return S;
  }
  function streetFile() {
    const S = RT.street; if (!S) return null;
    const p = S.ped;
    const jt = CBZ.cityJobTitle && p && p.job ? (function () { try { return CBZ.cityJobTitle(p.job); } catch (e) { return null; } })() : null;
    const J = CBZ.cityJobs && p && p.job ? CBZ.cityJobs[p.job] : null;
    const facts = [];
    if (jt) facts.push({ k: "WORKS AS", v: String(jt) });
    if (S.work) facts.push({ k: "WORKS AT", v: lotName(S.work) });
    if (J && J.hours) facts.push({ k: "SHIFT", v: hhmm(J.hours[0]) + " to " + hhmm(J.hours[1]) });
    if (S.home) facts.push({ k: "SLEEPS", v: lotName(S.home) });
    else (S.con.facts || []).forEach(function (f) { if (f && /BEDS DOWN/.test(f.k)) facts.push({ k: "SLEEPS", v: "somewhere in " + f.v }); });
    facts.push({ k: "OWES", v: "More than he can pay" });
    const places = [];
    if (S.work) places.push({ x: S.work.cx, z: S.work.cz, label: "works" });
    if (S.home) places.push({ x: S.home.cx, z: S.home.cz, label: "sleeps" });
    if (!places.length && p && p.pos) places.push({ x: p.pos.x, z: p.pos.z, label: "seen here" });
    const surname = String(S.name).split(" ").slice(-1)[0] || "";
    return {
      codename: surname.toUpperCase(), opLabel: "", classification: "PRIVATE",
      status: S.dead ? "DONE" : "OPEN",
      subject: { name: S.name, role: jt ? String(jt) : "", photo: RT.photos.street || "", note: RT.photos["street:wear"] ? ("Last seen wearing " + RT.photos["street:wear"]) : "" },
      identified: !!S.identified,
      brief: ["Owes money to people who stopped asking.", "Quiet is better. Nico."],
      facts: facts,
      routine: [], security: [{ label: "Nobody", detail: "Works, drinks, goes home.", seen: true }],
      approaches: [], kit: [],
      notes: noteOf("street").slice(-6),
      map: { places: places },
      stamp: S.dead ? "PAID" : null, footer: "",
    };
  }
  function tickOpening(dt) {
    const a = arc();
    let J = job();
    if (!J || J.id !== "opening") J = setJob("opening", "ring");
    RT.openT += dt;
    const R = RM();
    if (J.phase === "ring" || J.phase === "call") {
      if (J.phase === "call" && RT.inCall) return;
      // the burner on the bed, a few seconds after he wakes
      if (RT.ringing) {
        // he walked out and left it ringing: it rings in his pocket instead
        if (!inRoom() && RT.openT > RT.ringAt + 40) { try { if (R && R.phone && R.phone.stop) R.phone.stop(); } catch (e) {} RT.ringing = false; answerOpening(); }
        return;
      }
      if (RT.openT < 5) return;
      if (R && R.phone && R.phone.ring && room()) {
        try { R.phone.ring({ from: "Unknown", onAnswer: answerOpening }); RT.ringing = true; RT.ringAt = RT.openT; } catch (e) { answerOpening(); }
      } else if (RT.openT > 7) answerOpening();
      return;
    }
    if (J.phase === "envelope") {
      deliverEnvelope("opening");
      return;
    }
    if (J.phase === "live") {
      if (!RT.street || !RT.street.ped) {
        if (!bindStreet()) { RT.why = "no street name to bind yet"; return; }
        boardDirty();
      }
      const S = RT.street, p = S.ped;
      if (p.dead && !S.dead) {
        S.dead = true;
        unpin("mark");
        const inc = report({ ped: p, name: S.name, role: S.con && S.con.facts && S.con.facts[0] ? String(S.con.facts[0].v) : "", cause: "shot", kills: S.kills, alarm: false, weight: "nobody", photoKey: "street" });
        afterKill("opening", 1500, inc);
        a.street = (a.street | 0) + 1;
        a.lastStreet = S.name; a.lastQuiet = !inc || inc.verdict === "clean";
        crossOut("street", S.name);
        addNote("street", "Done.");
        commit();
        return;
      }
      // the world swept him away alive: Nico finds another
      if (!p.dead && (!p.group || !p.group.parent || (CBZ.cityPeds || []).indexOf(p) < 0)) {
        RT.street = null;
        text("Your guy skipped town. I got another one. Check your door.", BROKER);
        J.phase = "envelope"; RT.envFor = null; commit();
        return;
      }
      if (!S.identified && seesPed(p, false)) { S.idT += dt; if (S.idT > (scoped() ? 0.5 : 1.1)) { S.identified = true; addNote("street", "Saw his face. That's him."); refreshFile(true); } }
      const w = S.work || null;
      pin(w ? doorOf(w).x : p.pos.x, w ? doorOf(w).z : p.pos.z, S.name, "mark");
      return;
    }
    tickPayment("opening");
  }
  function answerOpening() {
    const J = job(); if (!J || J.id !== "opening" || RT.inCall) return;
    RT.ringing = false; RT.inCall = true;
    J.phase = "call"; commit();
    call(NICO_CALL, function () {
      RT.inCall = false;
      const J2 = job(); if (!J2 || J2.id !== "opening") return;
      J2.phase = "envelope"; RT.envFor = null; RT.envT = 0; commit();
    });
  }
  // the envelope under the door. Picking it up opens the folder.
  function deliverEnvelope(forId) {
    const R = RM();
    if (RT.envFor === forId) return;
    RT.envFor = forId;
    const K = paper();
    const rm = room();
    const label = forId === "opening" ? (rm && rm.name ? String(rm.name) : "") : "";
    const onPick = function () { pickEnvelope(forId); };
    if (R && R.door && R.door.deliver && rm) {
      setTimeout(function () {
        try {
          const c = K && K.envelope ? K.envelope({ text: label || (forId === "opening" ? "" : "Yours"), sealed: true }) : null;
          R.door.deliver("envelope", { canvas: c, verb: "Pick up", onPick: onPick });
        } catch (e) { onPick(); }
      }, forId === "opening" ? 2500 : 400);
    } else {
      setTimeout(onPick, 1500);           // no room: the envelope is simply in his hand
    }
  }
  function pickEnvelope(forId) {
    const J = job(); if (!J || J.id !== forId || J.phase !== "envelope") return;
    if (forId === "opening") {
      if (!RT.street && !bindStreet()) { RT.envFor = null; RT.why = "envelope: no street name yet"; setTimeout(function () { pickEnvelope(forId); }, 2000); return; }
      J.phase = "live"; commit();
      openFolder(streetFile());
      boardDirty();
      return;
    }
    if (OPS[forId]) {
      J.phase = "live"; commit();
      ensureOp(forId);
      if (RT.op && RT.op.id === forId) openFolder(fileFor(RT.op));
      boardDirty();
    }
  }
  function openFolder(f) {
    const Dz = D(); if (!Dz || !Dz.open || !f) return;
    try { if (hold() && hold().isOpen && hold().isOpen()) hold().close(); } catch (e) {}
    setTimeout(function () { try { Dz.open(f); } catch (e) {} }, 300);
  }

  /* ---- after every kill: get clear, then the money (shared by every job) ---- */
  const PAY_WORDS = {
    clean: "It's all there, and some more for keeping it quiet.",
    seen: "It's all there. People saw you. Be more careful.",
    messy: "It's short. You know why.",
    bloodbath: "Half. I'm not paying for a massacre.",
  };
  function tickPayment(id) {
    const a = arc(); const J = job(); if (!a || !J || J.id !== id) return;
    const F = FO();
    if (J.phase === "after") {
      if (id === "book" && !a.book) return;                // he wants the book first
      const clear = F && F.clear ? F.clear(J.inc) : ((g.wanted | 0) === 0 && (J.killX == null || distP(J.killX, J.killZ) > 150));
      if (!clear) return;
      const who = id === "opening" ? BROKER : HANDLER;
      const pay = J.pay | 0;
      const words = PAY_WORDS[J.verdict] || PAY_WORDS.seen;
      let D0 = null;
      if (F && F.drop) {
        D0 = F.drop({ pay: pay, from: who, salt: STEPS.indexOf(a.step) * 131 + (a.street | 0),
          line: function (where) { return id === "opening" ? ("Nice. Your money's in a bag by the bins outside " + where + ". " + words) : ("A bag by the bins outside " + where + ". " + words); } });
      }
      if (D0) { J.dropId = D0.id; J.phase = "drop"; pin(D0.x, D0.z, "bag", "drop"); }
      else { if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(pay); J.phase = "paid"; }
      commit();
      return;
    }
    if (J.phase === "drop") {
      const D0 = F && F.dropState ? F.dropState() : null;
      if (!D0 || D0.id !== J.dropId || D0.taken) { unpin("drop"); J.phase = "paid"; commit(); }
      return;
    }
    if (J.phase === "paid") { J.phase = "closed"; commit(); afterPaid(id); }
  }
  function afterPaid(id) {
    const a = arc(); if (!a) return;
    const R0 = recs(); if (R0) R0.completed = (R0.completed | 0) + 1;
    if (id === "opening") {
      a.openingDone = true;
      RT.street = null;
      setStep("meet1");
      a.job = null; commit();
      setTimeout(function () {
        const S = meetSpot();
        const where = S ? S.name : "the parking lot";
        text("Nice work on " + (a.lastStreet || "that one") + ". The lot behind " + where + ". After dark. Come alone.", "Unknown number");
      }, 9000);
      return;
    }
    const i = OP_ORDER.indexOf(id), next = OP_ORDER[i + 1];
    if (RT.op && RT.op.id === id) { teardownOp(RT.op); RT.op = null; }
    if (next) {
      setStep(next);
      if (next === "cargo") a.kit.charge = Math.max(a.kit.charge | 0, 1);
      setJob(next, "envelope"); RT.envFor = null;
      const L = { ledger: "Brandt's heart gave out, the paper says. Good. The next one is at your place.", cargo: "Dranov is finished and the Guard is short of rifles. The last one before the big one is at your place." };
      setTimeout(function () { text(L[id] || "The next one is at your place.", HANDLER); }, 2200);
    } else {
      setStep("meet2");
      a.job = null; commit();
      setTimeout(function () { text("Same lot as before. Bring the book. Come alone.", HANDLER); }, 2600);
    }
  }

  /* ================================================================
     §11  THE FILE (the folder you carry)
     ================================================================ */
  function fileFor(op) {
    const def = op.def, S = seenOf(op.id);
    const a = arc();
    const routine = op.legs.map(function (L, i) {
      const src = S.legs[String(i)];
      return { label: L.label, detail: L.detail + (src === "paper" ? " (the paper)" : ""), dur: L.from != null ? ("from " + hhmm(L.from)) : "", seen: !!src, now: !op.dead && op.ped && op.leg === i && op.phase === "dwell" && !!src };
    });
    const G = guardsOf(op);
    const nG = Math.max(G.length, def.tier === 2 ? 1 : 0);
    const seenG = S.guards | 0;
    const security = [{ label: "Detail", detail: def.security, seen: seenG > 0 }];
    if (seenG > 0) security.push({ label: "Counted", detail: seenG + " of about " + Math.max(nG, seenG) + " seen", seen: true });
    const approaches = (def.approaches || []).map(function (x) {
      return { label: x.label, detail: x.detail, known: x.id === "loud" || !!S.appr[x.id], used: op.dead && ((op.accident === "poison" && x.id === "poison") || (op.accident === "charge" && x.id === "charge")) };
    });
    const kit = [];
    if ((a.kit.vial | 0) > 0) kit.push("A vial (in the case)");
    if ((a.kit.charge | 0) > 0) kit.push("A car charge (in the case)");
    const places = op.legs.map(function (L, i) { return { x: L.x, z: L.z, label: S.legs[String(i)] ? L.label.toLowerCase() : "?" }; });
    return {
      codename: def.codename, opLabel: "FILE " + def.fileNo + " OF 4", classification: "EYES ONLY",
      status: op.dead ? "CONFIRMED" : "ACTIVE",
      subject: { name: def.name, role: def.role, photo: photoOf(op.id), note: RT.photos[op.id + ":wear"] ? ("Last seen wearing " + RT.photos[op.id + ":wear"]) : "" },
      identified: !!op.identified,
      brief: def.brief,
      facts: [
        { k: "LOCATION", v: lotName(op.V[def.venues[0].key]), redacted: false },
        { k: "SECURITY", v: def.security, redacted: seenG === 0 },
        { k: "FEE", v: money(def.pay) + ". Half again if nobody knows it was you.", redacted: false },
      ],
      routine: routine, security: security, approaches: approaches, kit: kit,
      notes: noteOf(op.id).slice(-8),
      map: { places: places },
      stamp: op.dead ? "CONFIRMED" : null,
      footer: op.dead ? "" : "Nothing on this page you did not see yourself.",
    };
  }
  function presidentWeekRows() {
    const rows = scheduleRows();
    return rows.length ? rows : FINALE.legs.map(function (L) { return { k: L.label, v: L.detail }; });
  }
  function bookFile() {
    const fin = RT.fin; const m = mansion();
    const name = presName() || (m && m.actor && m.actor.name) || "The President";
    return {
      codename: "BLACK BOOK", opLabel: "RECOVERED", classification: "EYES ONLY", status: "PENDING",
      subject: { name: name, role: FINALE.role, photo: photoOf("finale"), note: "The Executive Mansion" },
      identified: !!(fin && fin.identified),
      brief: [
        "Varga's hand. The President's day, every day, in the same order.",
        "The residence. The address from the Mansion steps. The motorcade out the gate and back.",
        "A loose page at the back is not Varga's. It is a Bureau cable.",
      ],
      facts: [
        { k: "RESIDENCE", v: "The Executive Mansion", redacted: false },
        { k: "DETAIL", v: "Presidential detail, rifles", redacted: false },
        { k: "CABLE", v: "ASSET TO BE RETIRED ON COMPLETION. NO RECORD. V.", redacted: false },
      ],
      routine: FINALE.legs.map(function (L) { return { label: L.label, detail: L.detail, dur: "", seen: true, now: false }; }),
      security: [{ label: "Detail", detail: FINALE.security, seen: true }],
      approaches: FINALE.approaches.map(function (x) { return { label: x.label, detail: x.detail, known: true, used: false }; }),
      kit: [], notes: noteOf("book").slice(-8), stamp: null,
      footer: "Voss wants this book. He does not know you read the back page.",
    };
  }
  function currentFile() {
    const a = arc(); if (!a) return null;
    if (a.step === "opening" && RT.street) return streetFile();
    if (RT.op) return fileFor(RT.op);
    if (RT.fin) return finFile();
    if (a.step === "meet2" && a.book) return bookFile();
    return null;
  }
  let fileDirtyT = 0;
  function refreshFile(force) {
    const Dz = D(); if (!Dz) return;
    if (!force && now() < fileDirtyT) return;
    fileDirtyT = now() + 700;
    const f = currentFile();
    if (Dz.isOpen && Dz.isOpen() && f && Dz.update) Dz.update(f);
  }
  function syncButton() {
    const Dz = D(); if (!Dz || !Dz.button) return;
    const f = playing() && CBZ.touchMode ? currentFile() : null;
    Dz.button(f ? { folder: true } : null);
  }
  function openFile() {
    const Dz = D(); const f = currentFile();
    if (Dz && f) { if (Dz.isOpen && Dz.isOpen()) Dz.close(); else Dz.open(f); }
  }

  /* ================================================================
     §12  THE CORKBOARD — the live file on the wall, past faces crossed
     ================================================================ */
  const BOARD = { cache: {} };
  function boardDirty() { RT.boardKey = ""; }
  function cached(id, key, make) {
    const c = BOARD.cache[id];
    if (c && c.key === key) return c.canvas;
    let cv = null; try { cv = make(c ? c.canvas : null); } catch (e) { cv = null; }
    BOARD.cache[id] = { key: key, canvas: cv };
    return cv;
  }
  function redrawn() { const R = RM(); if (R && R.board && R.board.refresh) { try { R.board.refresh(); } catch (e) {} } }
  function boardItems() {
    const a = arc(); const K = paper(); if (!a || !K) return null;
    const items = [];
    // past marks crossed out, along the top
    const past = a.crossed.slice(-6);
    for (let i = 0; i < past.length; i++) {
      const c = past[i];
      const cv = cached("x-" + c.key, c.key + ":x:" + !!photoOf(c.key === "street" ? "street" : c.key), function (re) { return K.polaroid({ photo: photoOf(c.key) || null, caption: c.name, crossed: true }, { canvas: re, onRedraw: redrawn }); });
      if (cv) items.push({ id: "x-" + c.key, canvas: cv, w: 0.13, h: 0.156, x: -0.8 + i * 0.16, y: 0.43, rot: ((i * 37) % 7 - 3) * 0.02, pin: "white" });
    }
    // the live one
    let live = null;
    if (a.step === "opening" && RT.street && !RT.street.dead) {
      const S = RT.street;
      const places = streetFile().map.places;
      const J = CBZ.cityJobs && S.ped.job ? CBZ.cityJobs[S.ped.job] : null;
      live = { key: "street", name: S.name, photo: "street", places: places,
        cards: [["Works at " + (S.work ? lotName(S.work) : "?"), J && J.hours ? ("Shift " + hhmm(J.hours[0]) + " to " + hhmm(J.hours[1])) : ""], ["Sleeps at " + (S.home ? lotName(S.home) : "?")]] };
    } else if (RT.op && !RT.op.dead) {
      const op = RT.op, S = seenOf(op.id);
      const cards = [];
      op.legs.forEach(function (L, i) { if (S.legs[String(i)]) cards.push([L.label + (L.from != null ? ", " + hhmm(L.from) : ""), L.detail]); });
      live = { key: op.id, name: op.def.name, photo: op.id, places: op.legs.map(function (L, i) { return { x: L.x, z: L.z, label: S.legs[String(i)] ? L.label.toLowerCase() : "?" }; }), cards: cards, clip: a.clip && a.clip.op === op.id ? a.clip : null };
    } else if ((a.step === "finale" || (a.step === "meet2" && a.book)) && !(RT.fin && RT.fin.dead)) {
      const S = seenOf("finale");
      const cards = presidentWeekRows().slice(0, 3).map(function (r) { return [r.k, r.v]; });
      const seenPosts = Object.keys(S.posts || {}).length;
      if (seenPosts) cards.push(["On the roof", seenPosts + " rifle" + (seenPosts === 1 ? "" : "s") + " counted"]);
      const m = mansion();
      live = { key: "finale", name: presName() || "The President", photo: "finale", places: m ? [{ x: m.cx, z: m.cz - 10, label: "steps" }, { x: (m.gate || { x: m.cx }).x, z: (m.gate || { z: m.rect.maxZ }).z, label: "gate" }] : [], cards: cards, clip: a.clip && a.clip.op === "finale" ? a.clip : null };
    }
    if (live) {
      const pk = live.photo;
      const pol = cached("live-pol", live.key + ":" + !!photoOf(pk), function (re) { return K.polaroid({ photo: photoOf(pk) || null, caption: live.name }, { canvas: re, onRedraw: redrawn }); });
      if (pol) items.push({ id: "live", canvas: pol, w: 0.24, h: 0.288, x: -0.62, y: 0.03, rot: -0.04, pin: "red", links: ["map"] });
      if (live.places && live.places.length) {
        const mk = live.key + ":" + live.places.map(function (p) { return p.label + (p.x | 0); }).join(",");
        const mp = cached("map", mk, function (re) { return K.map({ places: live.places }, { canvas: re }); });
        if (mp) items.push({ id: "map", canvas: mp, w: 0.44, h: 0.44, x: -0.08, y: -0.05, rot: 0.02, pin: "red" });
      }
      for (let i = 0; i < Math.min(4, live.cards.length); i++) {
        const lines = live.cards[i].filter(Boolean);
        const cv = cached("card" + i, live.key + ":" + lines.join("|"), function (re) { return K.note({ lines: lines, hand: true, tone: "index" }, { canvas: re }); });
        if (cv) items.push({ id: "card" + i, canvas: cv, w: 0.24, h: 0.156, x: 0.55, y: 0.2 - i * 0.19, rot: ((i * 53) % 5 - 2) * 0.02, pin: "red", links: ["map"] });
      }
      if (live.clip) {
        const cp = cached("clip", live.clip.headline, function (re) { return K.clipping({ headline: live.clip.headline, body: live.clip.body }, { canvas: re }); });
        if (cp) items.push({ id: "clip", canvas: cp, w: 0.2, h: 0.267, x: -0.62, y: -0.34, rot: 0.05, pin: "white", links: ["live"] });
      }
    } else if (a.step === "done" || a.ending) {
      const note = cached("end-note", a.ending || "done", function (re) { return K.note({ lines: [a.ending === "turned" ? "Voss is dead." : "It's over.", "Nobody has a file on me now."], hand: true, tone: "yellow" }, { canvas: re }); });
      if (note) items.push({ id: "end", canvas: note, w: 0.26, h: 0.17, x: 0, y: 0, rot: -0.03, pin: "red" });
    }
    return items;
  }
  function syncBoard(dt) {
    const R = RM(); if (!R || !R.board || !R.board.set) return;
    RT.boardT -= dt || 0;
    if (RT.boardKey && RT.boardT > 0) return;
    RT.boardT = 2;
    const a = arc(); if (!a) return;
    const S = RT.op ? seenOf(RT.op.id) : null;
    const key = [a.step, a.crossed.length, RT.street ? RT.street.name + !!RT.street.dead : "", RT.op ? RT.op.id + RT.op.dead + JSON.stringify(S.legs) : "",
      a.clip ? a.clip.headline : "", RT.fin ? JSON.stringify(seenOf("finale").posts) : "", !!photoOf("finale"), a.ending || "", !!a.book].join("#");
    if (key === RT.boardKey) return;
    RT.boardKey = key;
    const items = boardItems();
    if (!items) return;
    try { if (items.length) R.board.set(items); else if (R.board.reset) R.board.reset(); } catch (e) {}
  }

  /* ================================================================
     §13  THE PRESS — the morning paper under the door, the TV, the phone
     ================================================================ */
  function addStory(st) {
    const a = arc(); if (!a) return;
    a.press.push({ day: today(), headline: clean(st.headline), deck: clean(st.deck || ""), body: (st.body || []).map(clean), prio: st.prio || 1, photoKey: st.photoKey || null, tv: st.tv || null });
    if (a.press.length > 10) a.press.splice(0, a.press.length - 10);
    commit();
    showTV(a.press[a.press.length - 1]);
  }
  function showTV(st) {
    const R = RM(), K = paper(); if (!R || !R.tv || !R.tv.show || !K || !K.tv || !st) return;
    if (RT.tvKey === st.headline) return;
    RT.tvKey = st.headline;
    try {
      R.tv.show(K.tv({ headline: st.tv ? st.tv.headline : st.headline, sub: st.tv ? st.tv.sub : st.deck, ticker: st.tv ? st.tv.ticker : (st.body || []).join("   "), photo: st.photoKey ? (photoOf(st.photoKey) || null) : null, live: true }));
    } catch (e) {}
  }
  const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  function sidebarFor() {
    const a = arc(); if (!a) return null;
    if (OPS[a.step] && RT.op && !RT.op.dead) {
      const rows = RT.op.def.public(RT.op.V);
      return { title: "AROUND TOWN TODAY", rows: rows, op: RT.op.id, legs: RT.op.def.paperLegs };
    }
    if ((a.step === "finale" || a.step === "meet2") && !(RT.fin && RT.fin.dead)) {
      const rows = scheduleRows();
      if (rows.length) return { title: "THE PRESIDENT'S WEEK", rows: rows.slice(0, 4), op: "finale", legs: [1, 2] };
    }
    return null;
  }
  function buildIssue() {
    const a = arc();
    const d = today();
    // the front page: the city's biggest story since the last paper
    let st = null;
    for (let i = a.press.length - 1; i >= 0; i--) {
      const s = a.press[i];
      if (s.day < a.paperDay - 1) break;
      if (!st || s.prio > st.prio) st = s;
    }
    if (!st && a.press.length) st = a.press[a.press.length - 1];
    const side = sidebarFor();
    return {
      side: side, story: st,
      issue: {
        date: WEEKDAYS[d % 7] + " morning", price: "Morning edition",
        headline: st ? st.headline : "Council delays harbor vote again",
        deck: st ? st.deck : "Port authority figures still short, members say.",
        photo: st && st.photoKey ? (photoOf(st.photoKey) || null) : null,
        body: st ? st.body : [],
        sidebar: side ? { title: side.title, rows: side.rows } : null,
      },
    };
  }
  function tickPaper() {
    const a = arc(); const R = RM(); const K = paper();
    if (!a || !R || !R.door || !R.door.deliver || !K || !K.newspaper || !room()) return;
    const d = today();
    if (a.paperDay === d) return;
    // not in the first seconds of the opening: the burner comes first
    if (a.step === "opening" && (!a.job || a.job.phase === "ring" || a.job.phase === "call" || a.job.phase === "envelope")) return;
    a.paperDay = d; commit();
    const built = buildIssue();
    let c = null; try { c = K.newspaper(built.issue); } catch (e) { c = null; }
    if (!c) return;
    RT.paperCanvas = c; RT.paperSide = built.side;
    try { R.door.deliver("paper", { canvas: c, verb: "Pick up", onPick: function () { readPaper(c, built.side); } }); } catch (e) {}
    if (built.story) showTV(built.story);
  }
  function readPaper(c, side) {
    const H = hold();
    if (H && H.open && c) { try { H.open(c, { kind: "news" }); } catch (e) {} }
    if (!side) return;
    const a = arc(); const S = seenOf(side.op);
    let n = 0;
    (side.legs || []).forEach(function (i) { if (!S.legs[String(i)]) { S.legs[String(i)] = "paper"; n++; } });
    if (side.op === "finale") S.appr.long = true;
    a.clip = { op: side.op, headline: side.title === "THE PRESIDENT'S WEEK" ? "The President's week" : side.rows[0].k, body: side.rows.map(function (r) { return r.k + ". " + r.v; }).join(" ") };
    commit();
    if (n) addNote(side.op, "The paper printed his day.");
    boardDirty(); refreshFile(true);
  }

  /* ================================================================
     §14  THE MEETINGS
     ================================================================ */
  function meetSpot() {
    const a = arc();
    if (a.meet) { const l = lotByKey(a.meet.lot); if (l) { a.meet.name = a.meet.name || lotName(l); return a.meet; } }
    const p = P(); const AR = A(); if (!AR) return null;
    const px = p && p.pos ? p.pos.x : (AR.center ? AR.center.x : 0), pz = p && p.pos ? p.pos.z : (AR.center ? AR.center.z : 0);
    const lot = pickLot(["carlot", "gas", "security", "shop"], px, pz, 140, 420, 0x3e7, null);
    if (!lot) { RT.why = "no meet lot, lots=" + lotsOfKinds(null).length; return null; }
    const s = spotAt(lot, 9, 4);
    a.meet = { lot: lotKey(lot), x: s.x, z: s.z, face: s.face, name: lotName(lot) };
    commit();
    return a.meet;
  }
  function stageMeet(kind) {
    if (RT.meet && RT.meet.kind === kind) return RT.meet;
    const S = meetSpot(); if (!S) return null;
    const mt = { kind: kind, S: S, voss: null, men: [], car: null, lamp: null, started: false, done: false, waitT: 0, handOut: false };
    const fx = Math.sin(S.face), fz = Math.cos(S.face);
    if (CBZ.cityAddParkedCar) { try { mt.car = CBZ.cityAddParkedCar(S.x - fx * 4.2 + fz * 1.2, S.z - fz * 4.2 - fx * 1.2, S.face + Math.PI / 2, { color: 0x0b0c0e }); } catch (e) { mt.car = null; } }
    mt.lamp = buildLamp(S.x - fz * 2.2 - fx * 0.5, S.z + fx * 2.2 - fz * 0.5);
    RT.meet = mt;
    return mt;
  }
  function vossAppear(mt) {
    if (mt.voss) return;
    const S = mt.S;
    mt.voss = spawn("Voss", S.x, S.z, { job: "lawyer", gender: "m", archetype: "professional", wealth: 0.8, post: true, face: S.face, named: true, armed: true, weapon: "Pistol", aggr: 0.1 });
    if (mt.voss) { mt.voss._agencyHandler = true; photograph("voss", mt.voss); }
    if (mt.kind === "meet2") {
      for (let i = 0; i < 2; i++) {
        const fx = Math.sin(S.face), fz = Math.cos(S.face);
        const q = spawn("Bureau man", S.x - fx * 5 + (i ? 1 : -1) * fz * 3.4, S.z - fz * 5 - (i ? 1 : -1) * fx * 3.4, { job: "close protection", armed: true, weapon: "SMG", aggr: 0.4, post: true, face: S.face, gender: "m" });
        if (q) mt.men.push(q);
      }
    }
  }
  function teardownMeet(keepCar) {
    const mt = RT.meet; if (!mt) return;
    if (mt.voss && !mt.voss.dead) despawn(mt.voss);
    for (let i = 0; i < mt.men.length; i++) if (mt.men[i] && !mt.men[i].dead) despawn(mt.men[i]);
    if (mt.lamp) killGroup(mt.lamp);
    if (!keepCar && mt.car && !mt.car.player && CBZ.cityScrapCar) { try { CBZ.cityScrapCar(mt.car); } catch (e) {} }
    RT.meet = null;
  }
  function tickMeet(kind, dt) {
    const mt = stageMeet(kind); if (!mt) return;
    const pl = P(); if (!pl || !pl.pos) return;
    if (!mt.done) pin(mt.S.x, mt.S.z, "parking lot", "meet");
    const d = distP(mt.S.x, mt.S.z);
    const dark = (CBZ.nightAmount != null ? CBZ.nightAmount > 0.35 : true);
    if (!mt.voss && d < 120) {
      if (d < 22) mt.waitT += dt;
      if (dark || mt.waitT > 14 || kind === "meet2") vossAppear(mt);
    }
    if (mt.voss && !mt.started && d < 7.5 && !(CBZ.cineBusy && CBZ.cineBusy()) && !pl.driving) {
      mt.started = true;
      unpin("meet");
      runMeetScene(mt);
    }
    // meet two: he holds out his hand. A bullet is also an answer.
    if (kind === "meet2" && !mt.done && mt.voss) {
      if (mt.voss.dead) { mt.done = true; turned(mt); return; }
      const shotAt = (mt.voss.hp != null && mt.voss.maxHp != null && mt.voss.hp < mt.voss.maxHp - 1) || mt.men.some(function (q) { return q && (q.dead || (q.hp != null && q.maxHp != null && q.hp < q.maxHp - 1)); });
      if (shotAt && !mt.hot) {
        mt.hot = true; mt.handOut = false;
        say(mt.voss, "So you read the back page.");
        hostile(mt.voss); for (let i = 0; i < mt.men.length; i++) hostile(mt.men[i]);
      }
      if (mt.handOut && !mt.hot && mt.voss.group && pl.pos) mt.voss.group.rotation.y = Math.atan2(pl.pos.x - mt.voss.pos.x, pl.pos.z - mt.voss.pos.z);
    }
  }
  function vossLines1() {
    const a = arc();
    const last = a.lastStreet || "the last one";
    return [
      "You did " + last + ". " + (a.lastQuiet ? "Nobody saw a thing." : "People saw you. But he stayed dead."),
      "I am not going to ask your name. I already have it.",
      "I work for the Bureau. You will never prove that, so do not try.",
      "This morning the President cancelled the election. Next he cancels people.",
      "Three men keep him standing. They go first.",
      "Teodor Brandt washes his money. Same cafe table every day. It is all in here.",
      "Watch a man before you touch him. No crowds. No bodies I did not pay for.",
      "There is a vial in your case now. Use it or do not.",
    ];
  }
  function vossLines2() {
    const a = arc();
    const h = a.how || {};
    const cleanN = ["ledger", "cargo", "book"].filter(function (k) { return h[k] === "clean"; }).length;
    return [
      cleanN >= 2 ? "Three for three and you kept it quiet. I noticed." : "Three for three. Not all of it pretty.",
      "The book.",
    ];
  }
  function runMeetScene(mt) {
    const pl = P(); const v = mt.voss; if (!pl || !v) return;
    const lines = mt.kind === "meet1" ? vossLines1() : vossLines2();
    const vx = v.pos.x, vz = v.pos.z, vy = v.pos.y;
    const fx = pl.pos.x - vx, fz = pl.pos.z - vz, fm = Math.hypot(fx, fz) || 1;
    const ux = fx / fm, uz = fz / fm, sx = -uz, sz = ux;
    if (v.staffPost) v.staffPost.face = Math.atan2(ux, uz);
    if (v.group) v.group.rotation.y = Math.atan2(ux, uz);
    const shots = [
      { pos: { x: vx + sx * 8 + ux * 5, y: vy + 2.6, z: vz + sz * 8 + uz * 5 }, look: { x: vx + ux * 2.5, y: vy + 1.3, z: vz + uz * 2.5 } },
      { pos: { x: pl.pos.x + ux * 0.9 - sx * 0.7, y: pl.pos.y + 1.75, z: pl.pos.z + uz * 0.9 - sz * 0.7 }, look: { x: vx, y: vy + 1.55, z: vz } },
      { pos: { x: vx + ux * 1.6 + sx * 0.9, y: vy + 1.6, z: vz + uz * 1.6 + sz * 0.9 }, look: { x: vx, y: vy + 1.6, z: vz } },
    ];
    const Dz = D(); if (Dz && Dz.letterbox) Dz.letterbox(true);
    const steps = [];
    const cut = CBZ.hmPieces || function (l) { return [l]; };
    for (let i = 0; i < lines.length; i++) {
      const shot = i === 0 ? shots[0] : shots[1 + (i % 2)];
      const bits = cut(lines[i]);
      for (let j = 0; j < bits.length; j++) {
        const ln = bits[j];
        const dur = Math.min(4, 1.6 + ln.length * 0.045);
        steps.push({ cut: j === 0 && (i === 0 || (i % 2 === 1)), dur: dur, cam: shot, enter: function () { say(v, ln); } });
      }
    }
    const done = function () {
      if (Dz && Dz.letterbox) Dz.letterbox(false);
      clearSay();
      if (mt.kind === "meet1") afterMeet1(mt); else afterMeet2Lines(mt);
    };
    const ok = CBZ.cinePlay ? CBZ.cinePlay(steps, {}, done) : false;
    if (!ok) {
      call(lines.map(function (ln) { return { by: v, line: ln }; }), done);
    }
  }
  function afterMeet1(mt) {
    const a = arc();
    mt.done = true;
    a.kit.vial = Math.max(a.kit.vial | 0, 1);
    setStep("ledger");
    setJob("ledger", "live");
    dictatorship();
    setTimeout(function () { teardownMeet(true); }, 9000);
    commit();
    // he hands you the first file
    ensureOp("ledger");
    if (RT.op && RT.op.id === "ledger") openFolder(fileFor(RT.op));
    boardDirty();
  }
  function afterMeet2Lines(mt) {
    if (mt.done) return;
    mt.handOut = true;
    say(mt.voss, "Well?");
  }
  function handBook() {
    const mt = RT.meet; const a = arc();
    if (!mt || mt.done || !a) return;
    mt.done = true; mt.handOut = false;
    a.choice = "job"; commit();
    call([
      { by: mt.voss, line: "Good." },
      { by: mt.voss, line: "He speaks from the Mansion steps in the afternoon. Then the motorcade, out the gate and back." },
      { by: mt.voss, line: "Find the gap. My car takes you to the Mansion road when you are ready. The ride out is on me." },
    ], null);
    setStep("finale");
    boardDirty();
  }
  function turned(mt) {
    const a = arc(); if (!a) return;
    a.choice = "kill"; commit();
    for (let i = 0; i < mt.men.length; i++) hostile(mt.men[i]);
    const v = mt.voss;
    report({ ped: v, name: "A man", role: "", place: lotName(nearestLot(v.pos.x, v.pos.z)), cause: "shot", kills: { civ: 0, guard: 0 }, alarm: true, weight: "someone", photoKey: "voss" });
    crossOut("voss", "Voss");
    setStep("turned");
  }
  function dictatorship() {
    try {
      const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get("republic") : null;
      if (rec && CBZ.regimes && CBZ.regimes.transition && rec.govType !== "dictatorship" && rec.govType !== "monarchy" && !isPresident()) {
        const day = CBZ.worldDay ? CBZ.worldDay() : 0;
        CBZ.regimes.transition(rec, "dictatorship", day, -10);
      }
    } catch (e) {}
    const a = arc();
    if (a && !a.press.some(function (s) { return /election/i.test(s.headline); })) {
      addStory({ headline: "President suspends the election", deck: "Courts dissolved by decree. Soldiers on the streets by morning.", body: ["The President announced the suspension from the steps of the Executive Mansion, citing public order.", "Opposition offices were closed overnight. The Presidential Guard now answers to General Ruben Varga alone."], prio: 2, photoKey: "finale" });
      news("The President has suspended the election and dissolved the courts. Soldiers are on the streets.");
    }
  }

  /* ---- THE PRESIDENT'S MAN: you shot Voss ---- */
  function tickTurned() {
    const a = arc(); if (!a || a.ending) return;
    if (RT.turnT == null) RT.turnT = 0;
    RT.turnT += 0.2;
    if (RT.turnT < 6) return;
    a.ending = "turned";
    setStep("done");
    const F = FO();
    call([
      { by: "phone", line: "You don't know me. I work for the President." },
      { by: "phone", line: "We read the Bureau's cable. The one with your number on it." },
      { by: "phone", line: "The man in the parking lot was going to bury you. Now nobody will. The President would like to keep you." },
      { by: "phone", line: "Your first payment is waiting. Check your phone." },
    ], function () {
      if (F && F.drop) F.drop({ pay: 100000, from: "Unknown number", line: function (where) { return "A bag by the bins outside " + where + ". With the President's thanks."; } });
      else if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(100000);
      setTimeout(function () {
        const Dz = D();
        if (Dz && Dz.ending) Dz.ending({
          headline: "Man shot dead in parking lot", deck: "Palace denies any link to foreign agent.",
          lines: ["", "Police identified the dead man only as a foreign national. A black car at the scene was registered to a company that does not exist.",
            "The President's office declined to comment. The election remains suspended."],
          photo: photoOf("voss") || null,
          stories: [{ headline: "Guard doubles Mansion patrols" }, { headline: "Bread up for the third time this year" }, { headline: "Warm spell to hold through weekend" }],
          onClose: function () { teardownMeet(true); },
        });
      }, 1200);
    });
    commit();
  }

  /* ================================================================
     §15  THE PRESIDENT — his seams if they exist, the Mansion loop if not
     ================================================================ */
  function seams() {
    const PZ = CBZ.presidency, PR = CBZ.protection;
    return {
      current: !!(PZ && typeof PZ.current === "function"),
      schedule: !!(PZ && typeof PZ.schedule === "function"),
      detail: !!(PR && typeof PR.detail === "function"),
      onAssassinated: !!(PZ && typeof PZ.onAssassinated === "function"),
    };
  }
  function resolvePed(x) {
    if (!x) return null;
    if (x.pos && x.group) return x;
    if (x.ped && x.ped.pos) return x.ped;
    if (x.person && x.person.pos) return x.person;
    const id = x.id != null ? x.id : (x.sid != null ? x.sid : (x.person && x.person.id != null ? x.person.id : null));
    const L = CBZ.cityPeds || [];
    if (id != null) for (let i = 0; i < L.length; i++) { const p = L[i]; if (p && !p.dead && (p._sid === id || p.sid === id || p.id === id)) return p; }
    const name = x.name || (x.person && x.person.name);
    if (name) for (let i = 0; i < L.length; i++) { const p = L[i]; if (p && !p.dead && p.name === name) return p; }
    return null;
  }
  function presCurrent() {
    if (!seams().current) return null;
    try {
      const c = CBZ.presidency.current();
      // {kind:'player'|'npc'|'vacant', ped, sid, name}: the player in the chair or an empty chair is no mark
      if (!c || c.kind === "player" || c.kind === "vacant") return null;
      return { raw: c, ped: resolvePed(c) };
    } catch (e) { return null; }
  }
  function presName() {
    const F = RT.fin;
    if (F && F.ped && F.ped.name) return F.ped.name;
    const c = presCurrent();
    if (c) return (c.ped && c.ped.name) || c.raw.name || (c.raw.person && c.raw.person.name) || null;
    const m = mansion();
    return m && m.actor && m.actor.name ? m.actor.name : null;
  }
  function presId(c) { if (!c) return null; const r = c.raw || {}; return r.id != null ? r.id : (r.sid != null ? r.sid : (c.ped && c.ped._sid != null ? c.ped._sid : null)); }
  // schedule time: hours of day (<= 24) or CBZ.dayTime()-style days
  function normHour(t) {
    if (t == null || !isFinite(t)) return null;
    if (t <= 24) return t;
    return (((t % 1) * 24 + 6) % 24);
  }
  function normPlace(p) {
    if (!p) return null;
    if (p.x != null && p.z != null) return { x: p.x, z: p.z, name: p.name || p.label || null };
    if (p.pos) return { x: p.pos.x, z: p.pos.z, name: p.name || null };
    if (p.cx != null) return { x: p.cx, z: p.cz, name: p.building && p.building.name ? lotName(p) : (p.name || null) };
    return null;
  }
  function presSchedule() {
    if (!seams().schedule) return null;
    let L = null; try { L = CBZ.presidency.schedule(); } catch (e) { L = null; }
    if (!Array.isArray(L) || !L.length) return null;
    return L.filter(function (e) { return e && !e.cancelled; }).map(function (e) {
      // hour0 is the start as an hour of the day; t0/t1 are CBZ.dayTime() days
      const h0 = e.hour0 != null ? e.hour0 : normHour(e.t0);
      const h1 = (e.hour0 != null && e.t1 != null && e.t0 != null) ? (e.hour0 + (e.t1 - e.t0) * 24) % 24 : normHour(e.t1);
      return { kind: e.kind || "visit", place: normPlace(e.place), t0: h0, t1: h1, route: e.route || null, day: e.t0 > 24 ? Math.floor(e.t0) : null };
    }).filter(function (e) { return e.t0 != null; });
  }
  function scheduleRows() {
    const S = presSchedule();
    if (S) {
      const KN = { speech: "Address", motorcade: "Motorcade", visit: "Visit" };
      return S.slice(0, 4).map(function (e) {
        const where = e.place && e.place.name ? e.place.name : (e.kind === "motorcade" ? "from the Mansion gate" : "the Executive Mansion");
        return { k: KN[e.kind] || "Appearance", v: (e.kind === "motorcade" ? "Leaves " : "At ") + where + ", " + hhmm(e.t0) + (e.t1 != null ? " to " + hhmm(e.t1) : "") + "." };
      });
    }
    return [
      { k: "Address to the nation", v: "From the Mansion steps, daily, 13:00 to 17:00. The public lawn opens at noon." },
      { k: "Residence", v: "The President receives no visitors." },
    ];
  }
  function presDetail(F) {
    if (!seams().detail) return null;
    const id = presId(F.cur || presCurrent());
    let d = null;
    try { d = CBZ.protection.detail("president"); } catch (e) { d = null; }
    if (!d && id != null) { try { d = CBZ.protection.detail(id); } catch (e) { d = null; } }
    if (!d) return null;
    const units = Array.isArray(d) ? d : (d.units || d.members || []);
    const peds = [], posts = [];
    units.forEach(function (u) {
      const p = u && u.pos ? u : (u && u.ped ? u.ped : null);
      if (p) peds.push(p);
      if (u && u.alive === false) return;
      const po = u && u.post ? u.post : (u && u.role === "counter-sniper" && p ? { x: p.pos.x, z: p.pos.z, y: p.pos.y } : null);
      const ROLE = { "counter-sniper": "roof", agent: "agent", "shift-leader": "agent", ring: "agent", gate: "gate", patrol: "post" };
      if (po && po.x != null) posts.push({ x: po.x, z: po.z, y: po.y || 0, kind: ROLE[u.role] || po.kind || "post", ped: p });
    });
    (d.posts || []).forEach(function (po) { if (po && po.x != null) posts.push({ x: po.x, z: po.z, y: po.y || 0, kind: po.kind || "post" }); });
    return { peds: peds, posts: posts };
  }
  let assassSub = false;
  function subAssassinated() {
    if (assassSub || !seams().onAssassinated) return;
    assassSub = true;
    try {
      CBZ.presidency.onAssassinated(function (info) {
        const F = RT.fin;
        if (F && !F.dead) { F.seamDead = info || true; }
      });
    } catch (e) {}
  }

  function finGuards() {
    const F = RT.fin; if (!F) return [];
    let G = [];
    if (F.seamDetail) G = F.seamDetail.peds.slice();
    else if (F.ped && CBZ.powerGuardsOf) { try { G = (CBZ.powerGuardsOf(F.ped) || []).slice(); } catch (e) { G = []; } }
    return G.concat(F.snipers || [], F.agents || []);
  }
  function finNote(line) { addNote("finale", line); }

  function buildFinale() {
    subAssassinated();
    const cur = presCurrent();
    const site = mansion();
    // THE SEAM PATH: their President, their movement, their detail. We watch.
    if (cur && cur.ped && !cur.ped.dead) {
      const F = { seam: true, cur: cur, ped: cur.ped, site: site, phase: "seam", identified: false, idT: 0, dead: false, alarm: 0, everAlarm: false,
        kills: { civ: 0, guard: 0 }, cars: [], crowd: [], snipers: [], agents: [], posts: [], charge: false, stateCar: null };
      F.gate = site ? (site.gate || { x: site.cx, z: site.rect.maxZ }) : { x: cur.ped.pos.x, z: cur.ped.pos.z + 60 };
      return F;
    }
    if (!site) { RT.why = "no Executive Mansion"; return null; }
    const pres = site.actor;
    if (!pres || pres.dead) { RT.why = "no President at the Mansion"; return null; }
    const cx = site.cx, cz = site.cz, R = site.rect;
    const gate = site.gate || { x: cx, z: R.maxZ };
    const sp = site.seatPoint || { x: cx, z: cz - 12, face: 0 };
    const F = {
      site: site, ped: pres, phase: "residence", t: 0, identified: false, idT: 0,
      crowd: [], cars: [], stateCar: null, charge: false, dead: false, alarm: 0, everAlarm: false,
      kills: { civ: 0, guard: 0 }, s: 0, stopT: 0, accident: null, convoyDone: false,
      snipers: [], agents: [], posts: [],
      residence: (function () { const hx = cx - sp.x, hz = (cz - 34) - sp.z, hm = Math.hypot(hx, hz) || 1; return { x: sp.x + hx / hm * 7, z: sp.z + hz / hm * 7, face: sp.face }; })(),
      podium: { x: cx, z: cz - 10.2, face: 0 },
      gate: gate,
    };
    const out = [];
    out.push({ x: cx + 12, z: cz + 8 }, { x: cx + 12, z: cz + 30 }, { x: cx + 3, z: cz + 46 }, { x: gate.x, z: gate.z + 2 });
    let ext = null;
    try {
      const r0 = site.roads && site.roads[0];
      const pts = r0 && (r0.path || r0.points || (r0.rec && r0.rec.path));
      if (pts && pts.length >= 2) ext = pts.map(function (q) { return { x: q.x, z: q.z }; });
    } catch (e) { ext = null; }
    if (ext) {
      let acc0 = 0;
      for (let i = 1; i < ext.length && acc0 < 220; i++) { out.push(ext[i]); acc0 += d2(ext[i].x, ext[i].z, ext[i - 1].x, ext[i - 1].z); }
    } else out.push({ x: gate.x, z: gate.z + 80 }, { x: gate.x, z: gate.z + 170 });
    const back = out.slice(0, -1).reverse();
    F.path = out.concat(back);
    F.pathLen = [0];
    for (let i = 1; i < F.path.length; i++) F.pathLen.push(F.pathLen[i - 1] + d2(F.path[i].x, F.path[i].z, F.path[i - 1].x, F.path[i - 1].z));
    F.total = F.pathLen[F.pathLen.length - 1];
    F.gateS = F.pathLen[3];
    return F;
  }
  function stageFinale(F) {
    if (F.staged) return;
    F.staged = true;
    photograph("finale", F.ped);
    F.ped._agencyMark = true;
    // THE SEAM PATH never claims him: president mode's real motorcade refuses a
    // principal marked _agencyOp === "finale", and it is THE motorcade now.
    if (F.seam) { F.ped._agencyFinale = true; return; }
    F.ped._agencyOp = "finale";
    postSnipers(F);
  }
  // THE HUGE SECURITY (fallback): two counter-snipers on the Mansion's roof
  // edge, rifles, posted, stood on the roof by occupy.js's floor lift.
  function roofY(F) {
    const m = F.site && F.site.main;
    const tops = m && m.floorTops;
    const base = floorY(F.site.cx, F.site.cz - 34);
    if (tops && tops.length) return base + tops[tops.length - 1];
    return base + 9.2;
  }
  function postSnipers(F) {
    if (F.snipers.length || !F.site) return;
    const cx = F.site.cx, cz = F.site.cz, y = roofY(F);
    for (let s = -1; s <= 1; s += 2) {
      const x = cx + s * 20, z = cz - 18.2;
      const q = spawn("Counter-sniper", x, z, { job: "counter-sniper", armed: true, weapon: "Rifle", aggr: 0.85, post: true, face: 0, gender: "m", archetype: "professional" });
      if (!q) continue;
      q._agencyGuard = true; q._finSniper = { x: x, z: z, y: y, face: 0 };   // face: the sector centre (the lawn)
      if (CBZ.cityFloorPed) { try { CBZ.cityFloorPed(q, y); } catch (e) {} } else { q.pos.y = y; }
      if (q.group) q.group.position.copy(q.pos);
      F.snipers.push(q);
      F.posts.push({ x: x, z: z, y: y, kind: "roof", ped: q, side: s < 0 ? "left" : "right" });
    }
  }
  function pinSnipers(F, dt) {
    const DBR = CBZ.detailBrain;
    for (let i = 0; i < F.snipers.length; i++) {
      const q = F.snipers[i]; if (!q || q.dead || !q._finSniper) continue;
      const S = q._finSniper;
      q.pos.x = S.x; q.pos.z = S.z;
      if (!(q._occupyY > 0.2)) q.pos.y = S.y;
      if (q.group) q.group.position.copy(q.pos);
      if (q.target && q.target.set) q.target.set(S.x, 0, S.z);
      if (q.state !== "fight") { q.state = "idle"; q.speed = 0; }
      // the counter-sniper brain: a slow sector scan over the lawn with a
      // long dwell, and onto the mark (a bounded turn, never a snap)
      const pl = q.rage ? CBZ.city && CBZ.city.playerActor : null;
      if (DBR) DBR.sniper(q, S, dt || 0.016, pl || null);
      else if (pl && pl.pos && q.group) q.group.rotation.y = Math.atan2(pl.pos.x - S.x, pl.pos.z - S.z);
    }
  }
  function postAgents(F) {
    if (F.agents.length) return;
    const px = F.podium.x, pz = F.podium.z;
    const spots = [[-2.6, 1.2], [2.6, 1.2], [-5.5, 4.5], [5.5, 4.5]];
    for (let i = 0; i < spots.length; i++) {
      const q = spawn("Agent", px + spots[i][0], pz + spots[i][1], { job: "close protection", armed: true, weapon: i < 2 ? "Pistol" : "SMG", aggr: 0.6, post: true, face: 0, gender: "m", archetype: "professional" });
      if (q) { q._agencyGuard = true; F.agents.push(q); F.posts.push({ x: q.pos.x, z: q.pos.z, y: q.pos.y, kind: "podium", ped: q }); }
    }
  }
  function dropAgents(F) {
    for (let i = 0; i < F.agents.length; i++) if (F.agents[i] && !F.agents[i].dead) despawn(F.agents[i]);
    F.posts = F.posts.filter(function (p) { return p.kind !== "podium"; });
    F.agents.length = 0;
  }
  function spawnCrowd(F) {
    if (F.crowd.length) return;
    const cx = F.site.cx, cz = F.site.cz;
    for (let i = 0; i < 9; i++) {
      const x = cx + (i % 3 - 1) * 5 + (h01(i, 3, 91) - 0.5) * 2.4;
      const z = cz + 3 + ((i / 3) | 0) * 3.4 + (h01(i, 7, 92) - 0.5) * 1.4;
      const q = spawn("Onlooker", x, z, { archetype: "resident", post: true, face: Math.PI, wealth: 0.4 });
      if (q) { q._agencyCrowd = true; F.crowd.push(q); }
    }
  }
  function releaseCrowd(F) {
    for (let i = 0; i < F.crowd.length; i++) {
      const q = F.crowd[i]; if (!q || q.dead) continue;
      q.staffPost = null; q.controlled = false; q.state = "flee"; q.fear = 4;
      if (CBZ.cityFleeFrom && F.podium) { try { CBZ.cityFleeFrom(q, F.podium.x, F.podium.z); } catch (e) {} }
    }
  }
  function dropCrowd(F) {
    for (let i = 0; i < F.crowd.length; i++) if (F.crowd[i] && !F.crowd[i].dead) despawn(F.crowd[i]);
    F.crowd.length = 0;
  }
  function goHot(F) {
    if (F.alarm <= 0) {
      F.everAlarm = true;
      finNote("The detail went hot.");
      releaseCrowd(F);
      for (let i = 0; i < F.snipers.length; i++) hostile(F.snipers[i]);
      for (let i = 0; i < F.agents.length; i++) hostile(F.agents[i]);
    }
    F.alarm = 45;
  }
  function tickFinale(F, dt) {
    const p = F.ped;
    if (!p) return;
    if (p.dead || F.seamDead) { if (!F.dead) finDead(F); return; }
    const pl = P(); if (!pl || !pl.pos) return;
    const dPl = distP(p.pos.x, p.pos.z);
    pin(F.gate.x, F.gate.z + 60, "Mansion road", "mansion");
    if (F.seam) { tickSeamFinale(F, dt); finIntel(F, dt); return; }
    const h = hour();
    const inAddr = inWin(h, FINALE.win.address[0], FINALE.win.address[1]);
    if (dPl < 320 && F.phase === "address" && !F.crowd.length && F.alarm <= 0) spawnCrowd(F);
    if (dPl > 380 && F.crowd.length) dropCrowd(F);
    if ((F.phase === "address" || F.phase === "toaddress") && dPl < 420) postAgents(F);
    else if (F.agents.length && F.alarm <= 0 && F.phase !== "address" && F.phase !== "toaddress") dropAgents(F);
    // alarm
    let hot = (g.wanted | 0) >= 2 && dPl < 120;
    if (p.hp != null && p.maxHp != null && p.hp < p.maxHp - 1) hot = true;
    const G = finGuards();
    for (let i = 0; i < G.length && !hot; i++) { const q = G[i]; if (q && !q._agencyRiding && (q.dead || (q.rage && q.state === "fight"))) hot = true; }
    if (hot) {
      const was = F.alarm > 0;
      goHot(F);
      if (!was && (F.phase === "address" || F.phase === "residence" || F.phase === "walkcar" || F.phase === "walkhome" || F.phase === "toaddress")) {
        F.phase = "bail"; F.t = 0; walkTo(p, F.residence.x, F.residence.z, true);
      }
    } else if (F.alarm > 0) F.alarm -= dt;

    switch (F.phase) {
      case "residence":
        F.t += dt;
        if (p.staffPost == null) p.staffPost = { x: F.residence.x, z: F.residence.z, face: F.residence.face };
        if (F.alarm <= 0 && F.t > 2) {
          if (inAddr) { F.phase = "toaddress"; F.t = 0; walkTo(p, F.podium.x, F.podium.z); }
        }
        break;
      case "toaddress":
        F.t += dt;
        if (d2(p.pos.x, p.pos.z, F.podium.x, F.podium.z) < 1.2 || F.t > 30) {
          if (F.t > 30) place(p, F.podium.x, F.podium.z);
          F.phase = "address"; F.t = 0; holdAt(p, F.podium.face);
        }
        break;
      case "address":
        F.t += dt;
        holdAt(p, F.podium.face);
        if (F.t > 4 && F.t - dt <= 4) bark(p, "My people. The election is postponed, for your safety.", 3.6);
        if (F.t > 16 && F.t - dt <= 16) bark(p, "Order first. Then freedom.", 3);
        if (!inAddr) {
          dropCrowd(F);
          F.phase = "walkhome"; F.t = 0; walkTo(p, F.residence.x, F.residence.z);
        }
        break;
      case "walkhome":
      case "bail":
        F.t += dt;
        if (d2(p.pos.x, p.pos.z, F.residence.x, F.residence.z) < 1.5 || F.t > 40) {
          if (F.t > 40) place(p, F.residence.x, F.residence.z);
          holdAt(p, F.residence.face);
          const wasBail = F.phase === "bail";
          F.phase = "residence"; F.t = wasBail ? -30 : 0;
        }
        break;
    }
    finIntel(F, dt);
  }
  // THE REAL MOTORCADE (president mode, city/motorcade.js). We never move it;
  // we only read its state car so a charge can go under it.
  function realStateCar() {
    try {
      const m = CBZ.motorcade && CBZ.motorcade.active ? CBZ.motorcade.active() : null;
      const c = m && m.stateCar;
      return c && !c.dead ? c : null;
    } catch (e) { return null; }
  }
  function tickSeamCharge(F) {
    const c = F.chargeCar;
    if (!F.charge || !c || F.dead || c._agencyBoom) return;
    if (c.dead) { F.charge = false; return; }
    // it goes when the car pulls away with him in it
    if (d2(c.pos.x, c.pos.z, F.chargeAt.x, F.chargeAt.z) < 8) return;
    const p = F.ped;
    const inside = p && !p.dead && (d2(p.pos.x, p.pos.z, c.pos.x, c.pos.z) < 4.5 || (p.group && !p.group.visible));
    F.accident = "charge";
    carBomb(null, c, null);
    if (inside) { try { CBZ.cityKillPed(p, { byPlayer: true }, "explosion"); } catch (e) {} }
    finNote(inside ? "The state car went up on the route." : "The state car went up. He was not in it.");
  }
  function tickSeamFinale(F, dt) {
    tickSeamCharge(F);
    // their man may have been re-posted as a new body; follow it
    const c = presCurrent();
    if (c && c.ped && c.ped !== F.ped && !c.ped.dead && !F.dead) { F.ped = c.ped; F.cur = c; photograph("finale", c.ped); }
    RT.detailT = (RT.detailT || 0) - dt;
    if (RT.detailT <= 0) {
      RT.detailT = 2;
      const d = presDetail(F);
      F.seamDetail = d;
      if (d) F.posts = d.posts.map(function (po, i) { return { x: po.x, z: po.z, y: po.y, kind: po.kind, ped: po.ped || null, side: i }; });
    }
    let hot = (g.wanted | 0) >= 2 && distP(F.ped.pos.x, F.ped.pos.z) < 120;
    if (F.ped.hp != null && F.ped.maxHp != null && F.ped.hp < F.ped.maxHp - 1) hot = true;
    if (hot) goHot(F); else if (F.alarm > 0) F.alarm -= dt;
  }
  function finIntel(F, dt) {
    const p = F.ped;
    const S = seenOf("finale");
    const vis = !p._agencyRiding && seesPed(p, false);
    if (!F.identified) {
      if (vis) F.idT += dt;
      if (F.idT > (scoped() ? 0.5 : 1.1)) { F.identified = true; S.id = true; finNote("Saw him with my own eyes."); }
    }
    if (!p._agencyRiding && seesPed(p, true)) {
      const k = F.seam ? null : (F.phase === "address" ? "1" : null);
      if (k && !S.legs[k]) { S.legs[k] = "eyes"; finNote(FINALE.legs[+k].label + ". " + FINALE.legs[+k].detail); }
      if (!S.appr.long && (F.seam || F.phase === "address") && distP(p.pos.x, p.pos.z) > 60) { S.appr.long = true; finNote("A clear line to him from here. " + Math.round(distP(p.pos.x, p.pos.z)) + " m."); }
    }
    const sc = realStateCar();
    if (sc && !S.legs["2"] && sees(sc.pos.x, 1, sc.pos.z, 160, 0.8)) { S.legs["2"] = "eyes"; S.appr.charge = true; finNote("The motorcade. He rides in the state car."); }
    if (sc && distP(sc.pos.x, sc.pos.z) < 12) S.appr.charge = true;
    // counting the rifles: a post you have looked at is a post you know
    for (let i = 0; i < F.posts.length; i++) {
      const po = F.posts[i]; const key = (po.kind || "post") + ":" + Math.round(po.x) + ":" + Math.round(po.z);
      if (S.posts[key]) continue;
      if (seesPoint(po.x, (po.y || 0) + 1.5, po.z)) {
        S.posts[key] = po.kind || "post";
        finNote(po.kind === "roof" ? (po.side != null && typeof po.side === "string" ? ("A rifle on the roof, " + po.side + " of the dome.") : "A rifle on a roof, watching the approach.")
          : po.kind === "podium" ? "An agent by the podium." : po.kind === "agent" ? "One of his agents, close in." : po.kind === "gate" ? "Men on the gate, checking everyone." : "A man posted, watching the crowd.");
        boardDirty();
      }
    }
    const G = finGuards();
    for (let i = 0; i < G.length; i++) { const q = G[i]; if (q && !q._agencySeen && seesPed(q, true)) { q._agencySeen = true; S.guards = (S.guards | 0) + 1; S.appr.disguise = true; } }
    const w = g.cityWornOutfit;
    for (let i = 0; i < G.length; i++) {
      const q = G[i];
      if (!q || !q.dead || !q._wornOutfit || q._agencyStripped || distP(q.pos.x, q.pos.z) > 4) continue;
      q._agencyStripped = true;
      if (w && p._power) { w._claimOrg = p._power.org; w._claimRole = w._claimRole || "Presidential detail"; w._claimArms = "gun"; finNote("Wearing the detail's uniform."); }
    }
  }

  function finDead(F) {
    F.dead = true;
    const p = F.ped;
    releaseCrowd(F);
    goHot(F);
    unpin("mansion");
    const cause = F.accident || "shot";
    const inc = report({ ped: p, name: presName() || "The President", role: "", place: "the Executive Mansion", cause: cause, kills: F.kills, alarm: F.everAlarm, weight: "state", photoKey: "finale" });
    crossOut("finale", presName() || "The President");
    // the manhunt: the capital is sealed. Seen, it is every star there is.
    const seen = !!(inc && inc.seen) || cause === "shot";
    const T = CBZ.CITY && CBZ.CITY.starHeat;
    const stars = seen ? 5 : 4;
    if (T && T[stars] != null) { g.heat = Math.max(g.heat || 0, T[stars] + 1); }
    g.wanted = Math.max(g.wanted | 0, stars);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityEvent) { try { CBZ.cityEvent("assassination", { panic: 14, political: -8, respect: 20, label: "The President", message: "The President is dead." }, { silent: true }); } catch (e) {} }
    addStory({ headline: "The President is dead", deck: cause === "charge" ? "His car exploded leaving the Mansion. The army has sealed the capital." : "Shot at the Executive Mansion. The army has sealed the capital.",
      body: ["The President was pronounced dead this afternoon.", "Roadblocks went up on every road out of the city within the hour. The Guard says it is searching for one man."], prio: 5, photoKey: "finale" });
    news("The President is dead. The army has sealed the capital.");
    finNote("It's done.");
    const a = arc();
    a.how.finale = inc ? inc.verdict : "seen";
    const e = exfilSpot(F);
    a.exfil = e; commit();
    setStep("exfil");
    setTimeout(function () { text("It's done. A car is waiting on the road out, " + Math.round(distP(e.x, e.z)) + " m from you. Get there.", HANDLER); pin(e.x, e.z, "car", "exfil"); }, 3500);
  }
  function exfilSpot(F) {
    const gate = F.gate || { x: F.ped.pos.x, z: F.ped.pos.z };
    const q = F.path && F.path.length ? F.path[Math.min(F.path.length - 1, Math.floor(F.path.length / 2))] : { x: gate.x, z: gate.z + 170 };
    const dx = q.x - gate.x, dz = q.z - gate.z, m = Math.hypot(dx, dz) || 1;
    return { x: gate.x + dx / m * 420, z: gate.z + dz / m * 420 };
  }
  function rideToMansion() {
    const F = RT.fin; const pl = P(); if (!F || !pl) return;
    if (pl.driving || pl._vehicle) return;
    const go = function () {
      const gx = F.gate.x, gz = F.gate.z;
      const q = F.path && F.path.length > 5 ? F.path[Math.min(F.path.length - 1, 5)] : { x: gx, z: gz + 150 };
      const dx = q.x - gx, dz = q.z - gz, m = Math.hypot(dx, dz) || 1;
      const x = gx + dx / m * 150, z = gz + dz / m * 150;
      pl.pos.set(x, floorY(x, z), z);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(pl.pos);
      pl.vy = 0; pl.speed = 0; pl.grounded = true;
      if (CBZ.cam) CBZ.cam.yaw = Math.atan2(dx, dz);
    };
    if (CBZ.hmFade) CBZ.hmFade(go, 700); else go();
    setTimeout(function () { say("Driver", "This is as close as I go.", 2.6); }, 1500);
  }

  /* ---- the burn: the extraction is the ambush ---- */
  function tickExfil() {
    const a = arc(); if (!a) return;
    if (a.ending) return;
    const e = a.exfil; if (!e) { endingDeniable(); return; }
    pin(e.x, e.z, "car", "exfil");
    const mt = RT.meet;
    if (!mt || mt.kind !== "burn") {
      if (distP(e.x, e.z) < 45) startBurn(e);
      return;
    }
    if (mt.voss && mt.voss.dead && !mt.done) { mt.done = true; unpin("exfil"); crossOut("voss", "Voss"); endingDeniable(); }
  }
  function startBurn(e) {
    teardownMeet(false);
    const mt = { kind: "burn", S: { x: e.x, z: e.z, face: 0 }, voss: null, men: [], car: null, lamp: null, started: true, done: false };
    if (CBZ.cityAddParkedCar) { try { mt.car = CBZ.cityAddParkedCar(e.x + 3, e.z + 2, 0, { color: 0x0b0c0e }); } catch (err) {} }
    mt.voss = spawn("Voss", e.x, e.z + 1.5, { job: "lawyer", gender: "m", armed: true, weapon: "Pistol", aggr: 0.2, post: true, named: true });
    if (mt.voss) photograph("voss", mt.voss);
    for (let i = 0; i < 3; i++) {
      const ang = i * 2.1 + 0.4;
      const q = spawn("Bureau man", e.x + Math.cos(ang) * 9, e.z + Math.sin(ang) * 9, { job: "close protection", armed: true, weapon: i === 0 ? "Rifle" : "SMG", aggr: 0.4, post: true, gender: "m" });
      if (q) mt.men.push(q);
    }
    RT.meet = mt;
    say(mt.voss, "Nothing personal. A man who kills a President cannot exist afterwards.");
    setTimeout(function () {
      if (mt.voss) hostile(mt.voss);
      for (let i = 0; i < mt.men.length; i++) hostile(mt.men[i]);
    }, 1400);
  }
  function endingDeniable() {
    const a = arc(); if (!a || a.ending) return;
    a.ending = "deniable";
    setStep("done");
    commit();
    setTimeout(function () {
      call([
        { by: "phone", line: "It's Nico. I saw the news." },
        { by: "phone", line: "Whatever you did, don't tell me. I don't want to know." },
        { by: "phone", line: "Nobody's asking about you. Nobody at all. Somebody made sure of that." },
        { by: "phone", line: "Lie low. I'll call you when there's work." },
      ], function () {
        const Dz = D();
        if (Dz && Dz.ending) Dz.ending({
          headline: "The President is dead", deck: "Foreign agency denies involvement. Gunman still at large.",
          lines: ["", "The Bureau, named by opposition papers abroad, said it had no knowledge of any operation in the country.",
            "A man found dead on the Mansion road with three others has not been identified."],
          photo: photoOf("finale") || null,
          stories: [{ headline: "Army council takes interim power" }, { headline: "Roadblocks stay up for a third day" }, { headline: "Election date to be announced, council says" }],
          onClose: function () { teardownMeet(false); RT.fin = null; },
        });
      });
    }, 2500);
  }

  function finFile() {
    const F = RT.fin; if (!F) return null;
    const S = seenOf("finale");
    const a = arc();
    const routine = FINALE.legs.map(function (L, i) {
      const now_ = (i === 0 && F.phase === "residence") || (i === 1 && F.phase === "address") || (i === 2 && F.phase === "convoy");
      const src = S.legs[String(i)];
      return { label: L.label, detail: L.detail, dur: i === 1 ? "13:00" : (i === 2 ? "17:00" : ""), seen: !!src || !!a.book, now: now_ && !F.dead };
    });
    const nRoof = Object.keys(S.posts || {}).filter(function (k) { return S.posts[k] === "roof"; }).length;
    const nPod = Object.keys(S.posts || {}).filter(function (k) { return S.posts[k] === "podium"; }).length;
    const nOther = Object.keys(S.posts || {}).length - nRoof - nPod;
    const security = [
      { label: "Detail", detail: FINALE.security, seen: (S.guards | 0) > 0 || !!a.book },
      { label: "Roof", detail: nRoof ? (nRoof + " rifle" + (nRoof === 1 ? "" : "s") + " on the roof edge, counted") : "Look at the roof first", seen: nRoof > 0 },
      { label: "Podium", detail: nPod ? (nPod + " agents round the podium during the address") : "?", seen: nPod > 0 },
    ];
    if (nOther > 0) security.push({ label: "Posts", detail: nOther + " more men posted, counted", seen: true });
    security.push({ label: "Gate", detail: "Posted staff at the gatehouse. Wall all round.", seen: true });
    const m = mansion();
    return {
      codename: FINALE.codename, opLabel: "FILE 4 OF 4", classification: "EYES ONLY",
      status: F.dead ? "CONFIRMED" : "ACTIVE",
      subject: { name: presName() || "The President", role: FINALE.role, photo: photoOf("finale"), note: RT.photos["finale:wear"] ? ("Last seen wearing " + RT.photos["finale:wear"]) : "" },
      identified: !!F.identified,
      brief: [
        "He cancelled the election and kept the army. That is the whole file.",
        "Varga's book gives you his day. The residence, the address from the Mansion steps, the motorcade out the gate and back.",
        "Find the gap. Take it.",
      ],
      facts: [
        { k: "LOCATION", v: "The Executive Mansion", redacted: false },
        { k: "DETAIL", v: finGuards().length ? (finGuards().length + " men I know of, rifles") : "Presidential detail", redacted: !(S.guards > 0) },
        { k: "FEE", v: money(FINALE.pay), redacted: false },
      ],
      routine: routine, security: security,
      approaches: FINALE.approaches.map(function (x) { return { label: x.label, detail: x.detail, known: x.id === "loud" || !!S.appr[x.id] || !!a.book, used: F.dead && F.accident === "charge" && x.id === "charge" }; }),
      kit: (a.kit.charge | 0) > 0 ? ["A car charge (in the case)"] : [],
      notes: noteOf("finale").slice(-8),
      map: m ? { places: [{ x: m.cx, z: m.cz - 10, label: "steps" }, { x: F.gate.x, z: F.gate.z, label: "gate" }] } : null,
      stamp: F.dead ? "CONFIRMED" : null,
      footer: "The cable from the back of the book is still in my pocket.",
    };
  }

  /* ================================================================
     §16  WHO DIED — kills counted from real deaths, not a guess
     ================================================================ */
  function classify(ped) {
    const op = RT.op, F = RT.fin, S = RT.street;
    if (op && ped === op.ped) return "target";
    if (F && ped === F.ped) return "target";
    if (S && ped === S.ped) return "target";
    if (op && guardsOf(op).indexOf(ped) >= 0) return "guard";
    if (F && finGuards().indexOf(ped) >= 0) return "guard";
    if (ped && (ped._agencyHandler || (RT.meet && RT.meet.men.indexOf(ped) >= 0))) return "bureau";
    if (ped && (ped.kind === "cop" || ped.swat)) return "guard";
    return "civ";
  }
  function liveTarget() {
    const a = arc();
    if (RT.op && !RT.op.dead) return RT.op;
    if (RT.fin && !RT.fin.dead) return RT.fin;
    if (a && a.step === "opening" && RT.street && !RT.street.dead) return RT.street;
    return null;
  }
  function countKill(ped, byPlayer) {
    const kind = classify(ped);
    const W = RT.killWatch && now() < RT.killWatch.t ? RT.killWatch : null;
    const tgt = liveTarget();
    if (!tgt) return;
    if (!byPlayer && !(W && W.blast)) return;
    if (W && W.noCount) return;
    if (kind === "civ") tgt.kills.civ = (tgt.kills.civ | 0) + 1;
    else if (kind === "guard") tgt.kills.guard = (tgt.kills.guard | 0) + 1;
  }
  function hookKills() {
    if (typeof CBZ.cityKillPed === "function" && !CBZ.cityKillPed._agencyWrap) {
      const orig = CBZ.cityKillPed;
      const w = function (ped, imp) {
        const was = !ped || ped.dead;
        const r = orig.apply(this, arguments);
        if (!was && ped && ped.dead && liveTarget()) {
          imp = imp || {};
          const byPlayer = imp.byPlayer !== false && !imp.attacker;
          try { countKill(ped, byPlayer); } catch (e) {}
        }
        return r;
      };
      w._agencyWrap = true;
      for (const k in orig) if (Object.prototype.hasOwnProperty.call(orig, k) && k.charAt(0) === "_") w[k] = orig[k];
      CBZ.cityKillPed = w;
    }
    if (typeof CBZ.cityCrowdKill === "function" && !CBZ.cityCrowdKill._agencyWrap) {
      const origC = CBZ.cityCrowdKill;
      const wc = function (i, opts) {
        const killed = origC.apply(this, arguments);
        const tgt = liveTarget();
        if (killed && tgt) {
          opts = opts || {};
          if (!opts.noCrime && opts.byPlayer !== false && !opts.attacker) tgt.kills.civ = (tgt.kills.civ | 0) + 1;
        }
        return killed;
      };
      wc._agencyWrap = true;
      for (const k in origC) if (Object.prototype.hasOwnProperty.call(origC, k) && k.charAt(0) === "_") wc[k] = origC[k];
      CBZ.cityCrowdKill = wc;
    }
  }

  /* ================================================================
     §17  THE DIRECTOR TICK
     ================================================================ */
  function ensureOp(id) {
    if (RT.op && RT.op.id === id) return RT.op;
    if (RT.op) { teardownOp(RT.op); RT.op = null; }
    const op = buildOp(id); if (!op) return null;
    stageOp(op);
    if (!op.ped) { teardownOp(op); return null; }
    RT.op = op;
    boardDirty();
    return op;
  }
  function tickOp(s, dt) {
    const a = arc();
    let J = job();
    if (!J || J.id !== s) J = setJob(s, s === "ledger" ? "live" : "envelope");
    if (J.phase === "envelope") { deliverEnvelope(s); return; }
    if (J.phase === "live") {
      const op = ensureOp(s); if (!op) return;
      // a mark the world swept away alive is re-staged at the top of his loop
      if (op.ped && !op.ped.dead && !op.dead && (!op.ped.group || !op.ped.group.parent || (CBZ.cityPeds || []).indexOf(op.ped) < 0)) { teardownOp(op); RT.op = null; return; }
      if (op.ped && op.ped.dead && !op.dead) { onMarkDead(op); return; }
      tickAlarm(op, dt); tickRoutine(op, dt); tickIntel(op, dt); tickDisguise(op);
      const L0 = op.legs[0];
      pin(L0.x, L0.z, op.def.name, "mark");
      refreshFile();
      return;
    }
    // after the kill: the book, then clear, then the money. A reload after
    // the kill has no body to take it from; he took it on the way out.
    if (s === "book" && !a.book && (!RT.op || RT.op.id !== "book")) {
      a.book = true; commit();
      addNote("book", "The black book. The President's week, in Varga's hand.");
      addNote("book", "A loose page in the back. A Bureau cable with my file number on it.");
    }
    tickPayment(s);
  }
  function slowTick(dt) {
    const a = arc(); if (!a) return;
    hookKills();
    wireVerbs();
    if (campaignOwns() || isPresident()) return;
    tickPaper();
    syncBoard(dt);
    const s = a.step;
    if (s === "street" || s === "done") return;
    if (s === "opening") { tickOpening(dt); return; }
    if (s === "meet1" || s === "meet2") { tickMeet(s, dt); return; }
    if (s === "exfil") { tickExfil(); return; }
    if (s === "turned") { tickTurned(); return; }
    if (OPS[s]) { tickOp(s, dt); return; }
    if (s === "finale") {
      if (!RT.fin) {
        RT.fin = buildFinale();
        if (!RT.fin) return;
        stageFinale(RT.fin);
        boardDirty();
      }
      const F = RT.fin;
      if (!F.seam && !F.dead && F.site && F.site.actor && F.site.actor !== F.ped && !F.site.actor.dead) {
        teardownFinale(F); RT.fin = null;
        return;
      }
      if (!RT.meet || RT.meet.kind !== "meet2") { stageMeet("meet2"); if (RT.meet && !RT.meet.voss) vossAppear(RT.meet); if (RT.meet) { RT.meet.started = true; RT.meet.done = true; } }
      tickFinale(F, dt);
      refreshFile();
    }
  }
  function teardownFinale(F) {
    if (!F) return;
    dropCrowd(F); dropAgents(F);
    for (let i = 0; i < F.snipers.length; i++) if (F.snipers[i] && !F.snipers[i].dead) despawn(F.snipers[i]);
    F.snipers.length = 0;
  }

  // THE MARK'S BODYGUARDS walk on the same detail brain as the President's
  // (city/brain_protection.js via CBZ.protection.guardRing): a small knot,
  // eyes out, shield and evacuate when it goes loud. Hostile only when
  // somebody actually hurt him or his people (sirens alone just move him).
  const RING_PS = { posture: "normal", threat: null, hostile: false, at: { x: 0, z: 0 } };
  function driveMarkDetail(op, dt) {
    if (!op || !op.ped || op.ped.dead || !CBZ.protection || typeof CBZ.protection.guardRing !== "function") return;
    const pl = P(), PA = CBZ.city && CBZ.city.playerActor;
    const hot = op.alarm > 0;
    RING_PS.posture = hot ? "evac" : "normal";
    RING_PS.hostile = hot && (op.alarmWhy === "hurt" || op.alarmWhy === "guard");
    RING_PS.threat = RING_PS.hostile && PA ? PA : null;
    if (pl && pl.pos) { RING_PS.at.x = pl.pos.x; RING_PS.at.z = pl.pos.z; }
    try { CBZ.protection.guardRing(op.ped, dt, RING_PS); } catch (e) {}
  }

  let acc = 0, btnT = 0;
  if (CBZ.onUpdate) {
    CBZ.onUpdate(39.5, function (dt) {
      if (!playing()) { if (btnT >= 0) { btnT = -1; const Dz = D(); if (Dz && Dz.button) Dz.button(null); } return; }
      acc += dt || 0;
      if (acc >= 0.2) { const step = acc; acc = 0; try { slowTick(step); } catch (e) { if (window.console) console.error("[agency]", e); } }
      btnT -= dt || 0;
      if (btnT <= 0) { btnT = 1; syncButton(); }
    });
    // per frame, after the car loop: the convoy, its riders, the roof rifles
    CBZ.onUpdate(37.3, function (dt) {
      if (!playing()) return;
      driveMarkDetail(RT.op, dt);
      const F = RT.fin;
      if (!F) return;
      if (F.snipers && F.snipers.length) pinSnipers(F, dt);
    });
  }

  // J pulls the folder out (dossier.button is the touch affordance)
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("keydown", function (e) {
      if (e.code !== "KeyJ" || e.repeat || !playing()) return;
      const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (currentFile()) openFile();
    });
  }
  function wireButton() { const Dz = D(); if (Dz && !Dz._agencyWired) { Dz._agencyWired = true; Dz.onButton = openFile; } }

  /* ================================================================
     §18  THE HOOKS other files call
     ================================================================ */
  function resetRuntime() {
    if (RT.op) { teardownOp(RT.op); RT.op = null; }
    if (RT.fin) { teardownFinale(RT.fin); RT.fin = null; }
    teardownMeet(false);
    RT.street = null; RT.ringing = false; RT.inCall = false; RT.envFor = null; RT.openT = 0; RT.turnT = null;
    unpin();
    boardDirty();
  }
  CBZ.agency = {
    // hitman.js settle(): a freelance street contract closed (other origins)
    onStreetSettled: function (con, quiet) {
      const a = arc(); if (!a) return;
      a.street = (a.street | 0) + 1;
      if (quiet) a.clean = (a.clean | 0) + 1;
      a.lastStreet = con && con.name ? con.name : a.lastStreet;
      a.lastQuiet = !!quiet;
      commit();
      if (a.step === "street" && !campaignOwns() && !isPresident() && ((a.clean | 0) >= 1 || (a.street | 0) >= 2)) {
        setStep("meet1");
        setTimeout(function () {
          const S = meetSpot();
          text("Nice work on " + (a.lastStreet || "the last one") + ". The lot behind " + (S ? S.name : "the gas station") + ". After dark. Come alone.", "Unknown number");
        }, 4200);
      }
    },
    step: function () { const a = arc(); return a ? a.step : null; },
    file: currentFile,
    openFile: openFile,
    kit: function () { const a = arc(); return a ? { vial: a.kit.vial | 0, charge: a.kit.charge | 0 } : { vial: 0, charge: 0 }; },
    // hitman.js's wall card (the wall is gone; kept harmless for old callers)
    wall: function () { return null; },
    setRepaint: function (fn) { hitmanRepaint = fn; },
    jump: function (step) {
      const a = arc(); if (!a || STEPS.indexOf(step) < 0) return false;
      resetRuntime();
      a.job = null; a.ending = null; a.exfil = null;
      if (step === "opening") { a.openingDone = false; a.crossed = []; }
      if (step !== "street" && step !== "opening" && !a.lastStreet) { a.lastStreet = "Dario Kovac"; a.lastQuiet = true; }
      if (["ledger", "cargo", "book", "meet2", "finale", "exfil"].indexOf(step) >= 0) { dictatorship(); a.kit.vial = Math.max(a.kit.vial | 0, 1); a.openingDone = true; }
      if (["cargo", "book", "meet2", "finale", "exfil"].indexOf(step) >= 0) a.kit.charge = Math.max(a.kit.charge | 0, 1);
      if (step === "meet2" || step === "finale" || step === "exfil") a.book = true;
      if (OPS[step]) a.job = { id: step, phase: "live", t0: today() };
      if (step === "exfil") { const m = mansion(); const gx = m ? (m.gate || { x: m.cx }).x : 0, gz = m ? (m.gate || { z: m.rect.maxZ }).z : 0; a.exfil = { x: gx, z: gz + 420 }; }
      a.step = step; commit();
      if (OPS[step]) { const op = ensureOp(step); if (op) openFolder(fileFor(op)); }
      if (hitmanRepaint) { try { hitmanRepaint(); } catch (e) {} }
      return true;
    },
    audit: function () {
      const a = arc(); const R = RM(); const F = FO(); const sm = seams();
      let rm = null; try { rm = R && R.audit ? R.audit() : null; } catch (e) { rm = null; }
      const fa = F && F.audit ? F.audit() : null;
      return {
        step: a ? a.step : null,
        job: a && a.job ? { id: a.job.id, phase: a.job.phase, verdict: a.job.verdict || null, pay: a.job.pay || null } : null,
        room: { api: !!R, built: !!(rm && rm.built), inRoom: inRoom(), boardItems: rm ? rm.boardItems : 0 },
        phone: { ringing: !!(R && R.phone && R.phone.ringing && R.phone.ringing()), inCall: !!RT.inCall, openT: Math.round(RT.openT) },
        envelope: { waiting: !!(R && R.door && R.door.waiting && R.door.waiting("envelope")), for: RT.envFor },
        paper: { day: a ? a.paperDay : null, waiting: !!(R && R.door && R.door.waiting && R.door.waiting("paper")), stories: a ? a.press.length : 0 },
        street: RT.street ? { name: RT.street.name, dead: RT.street.dead, identified: RT.street.identified, work: RT.street.work ? lotName(RT.street.work) : null } : null,
        op: RT.op ? { id: RT.op.id, staged: !!RT.op.staged, ped: !!RT.op.ped, leg: RT.op.leg, phase: RT.op.phase, identified: RT.op.identified, guards: guardsOf(RT.op).length, dead: RT.op.dead } : null,
        deadDrop: fa ? fa.deadDrop : null,
        witness: fa ? fa.witness : null,
        scene: fa ? fa.scenes : null,
        president: {
          seams: sm, mode: RT.fin ? (RT.fin.seam ? "seam" : "fallback") : null,
          finale: RT.fin ? { phase: RT.fin.phase, motorcade: !!(CBZ.motorcade && CBZ.motorcade.active && CBZ.motorcade.active()), charge: !!RT.fin.charge, snipers: RT.fin.snipers.length, agents: RT.fin.agents.length, posts: RT.fin.posts.length, crowd: RT.fin.crowd.length, identified: RT.fin.identified, dead: RT.fin.dead, hour: Math.round(hour() * 10) / 10 } : null,
        },
        meet: RT.meet ? { kind: RT.meet.kind, voss: !!RT.meet.voss, started: RT.meet.started, handOut: !!RT.meet.handOut, done: RT.meet.done } : null,
        pin: PIN.key, dossier: !!D(), why: RT.why || null, lots: lotsOfKinds(null).length, arena: !!A(),
        pl: P() && P().pos ? [Math.round(P().pos.x), Math.round(P().pos.z)] : null,
      };
    },
    _rt: RT,
    _test: {
      answer: answerOpening, pickEnvelope: pickEnvelope, handBook: handBook, takeBook: takeBook, readPaper: function () { readPaper(RT.paperCanvas, RT.paperSide); },
      slowTick: slowTick, boardItems: boardItems, scheduleRows: scheduleRows, buildIssue: buildIssue, legAtHour: legAtHour,
    },
  };

  // ?agency=<step> jumps once the city is up
  let jumpDone = false;
  if (CBZ.onUpdate) CBZ.onUpdate(39.6, function () {
    wireButton();
    if (jumpDone || !playing()) return;
    jumpDone = true;
    let q = null;
    try { q = new URLSearchParams(window.location.search).get("agency"); } catch (e) { q = null; }
    if (q && STEPS.indexOf(q) >= 0) CBZ.agency.jump(q);
  });
})();
