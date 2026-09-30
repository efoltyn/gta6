/* ============================================================
   city/president_staff.js — THE PRESIDENT HIRES HIS PEOPLE.

   OWNER (2026-09-29): "You can hire people as a president, but it's like
   talk, hire. It's such a dumb flow."

   The old flow was the street's: walk up to any stranger, Talk, then the
   one row left was Hire (interact.js ped-hire, the residue of a one-row
   funnel). A head of state does not recruit off the pavement.

   THE FLOW NOW, as the player lives it:
     • The people who want a job are IN THE OFFICE. Along the wall by the
       door stands a short line (never more than three), and the Chief of
       Staff stands at the head of it. Each one is dressed as the job: the
       black suit and earpiece of the detail, a chauffeur's cap, a press
       secretary's suit, a general's uniform when a cabinet chair is empty.
       Walk up and he says one line of his own. E: Hire. Q: Hire or Send
       away. No interview, no card of numbers.
     • A hire WALKS TO HIS POST and starts doing the job:
         Secret Service  joins your detail (protection.js's own record,
                         memberCount + 1: this man, not a clone). The detail
                         walks you, posts at your door and shoots back.
                         The office grants two; the other four are yours.
         Driver          goes down to the state car and waits at it. With a
                         driver, F at the car is "Where to?" and the column
                         takes you (motorcade.js). Without one you drive it.
         Press Secretary takes the desk outside your door. When the scandal
                         climbs she goes to the cameras by herself, once a
                         day (it is on the TV); E on her sends her now.
         Cabinet         only when a chair is empty (you fired him, or he is
                         dead): the new General / Director / Commissioner /
                         Secretary IS that post from now on - the voice on
                         the phone and the man at the Situation Room table.
     • Letting someone go is an ORDER, given to the Chief of Staff about
       somebody else (the delegation thesis): Q on him, "Fire", look at the
       man, E. He walks out; his chair opens; the line refills.
     • Your agents take orders about other people (city/orders.js): Go
       after, Guard, Tail, Stand down.

   REUSED, NOT REBUILT: bodies are CBZ.cityPostNpc (occupy.js) dressed by
   job (outfits.js jobFit); walking is president_office.js's path idiom;
   speech is CBZ.citySay over the head; the detail is CBZ.protection; the
   cabinet is CBZ.presidency.fillCabinet / vacateCabinet; the column is
   motorcade.js (it asks has("driver")); the TV is CBZ.presidentOffice.news.
   Saved: CBZ.presidency.staff() (inside the presidency's own save).

   PUBLIC: CBZ.presidentStaff = { has(role), line(), audit() }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.presidentStaff) return;
  const g = CBZ.game || (CBZ.game = {});

  const AGENT_HIRES = 4;       // on top of the two the office grants (protection.js PRES_BASE)
  const LINE_MAX = 3;
  const NEAR_R = 30;           // m from the desk: the line exists while you are this close
  const SEND_AWAY_WAIT = 45;   // s before that job sends somebody else
  const BRIEF_AT = 25;         // scandal at which the press secretary goes to the cameras by herself

  const ROLES = {
    agent: { job: "secret service", archetype: "security", armed: true, weapon: "Pistol", hp: 150 },
    driver: { job: "chauffeur", archetype: "professional" },
    press: { job: "press secretary", archetype: "professional" },
    general: { cabinet: true, job: "military general", archetype: "military", armed: true },
    bureau: { cabinet: true, job: "federal agent", archetype: "professional" },
    police: { cabinet: true, job: "police commissioner", archetype: "professional" },
    treasury: { cabinet: true, job: "treasury secretary", archetype: "professional" },
  };
  // what each says: one line when you walk up, one word when hired
  const SAYS = {
    agent: ["Twelve years on the detail, sir.", "Sir."],
    driver: ["I know every road out of here.", "I'll be with the car."],
    press: ["Bad weeks are my job.", "I'll take the room."],
    general: ["The army answers to you. Not to me.", "Mr. President."],
    bureau: ["Give me a thread and I'll pull it.", "Mr. President."],
    police: ["I want more cars on the corners.", "Mr. President."],
    treasury: ["The books will balance. Mostly.", "Mr. President."],
  };
  const ORDER = ["general", "bureau", "police", "treasury", "driver", "agent", "press"];

  let CLOCK = 0;
  const LINE = [];             // { role, ped, spot, phase: "enter"|"wait"|"leave", greeted, t }
  const OUT = [];              // people walking out of the door: { ped, t }
  const W = { chief: null, press: null, driver: null, nextFor: {}, seq: 0 };

  // ---- seams --------------------------------------------------------------
  function Pz() { return CBZ.presidency || null; }
  function seat() { const p = Pz(); if (!p || typeof p.seat !== "function") return null; try { return p.seat(); } catch (e) { return null; } }
  function staff() { const p = Pz(); return p && p.staff ? p.staff() : {}; }
  function day() { try { return CBZ.worldDay ? (CBZ.worldDay() | 0) : 0; } catch (e) { return 0; } }
  function playing() { return g.mode === "city" && g.state === "playing"; }
  function say(p, line, secs) { if (CBZ.citySay && p && p.group && !p.dead) { try { CBZ.citySay(p, line, "#e8e2cf", secs || 2.6); } catch (e) {} } }
  function detail() { const s = seat(); return s && CBZ.protection && CBZ.protection.get ? CBZ.protection.get("off_" + s.id) : null; }
  function has(role) {
    const S = staff();
    if (role === "agent") return (S.agents | 0) > 0;
    return !!S[role];
  }

  // the office, in president_office.js's frame (local x = lateral, z = depth)
  let _rec = null, _recAt = -9;
  function office() {
    if (_rec && CLOCK - _recAt < 1) return _rec;
    _recAt = CLOCK; _rec = null;
    if (!CBZ.presidentInteriorRooms) return null;
    let list = [];
    try { list = CBZ.presidentInteriorRooms() || []; } catch (e) { list = []; }
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r && r.key === "ovaloffice" && r.approach && r.landmarks && r.landmarks.presidentialDesk) { _rec = r; break; }
    }
    return _rec;
  }
  function toWorld(rec, lx, lz) { const A = rec.approach, L = -lx; return { x: A.x + A.nx * lz + A.tx * L, z: A.z + A.nz * lz + A.tz * L }; }
  function toLocal(rec, wx, wz) { const A = rec.approach, dx = wx - A.x, dz = wz - A.z; return { x: -(dx * A.tx + dz * A.tz), z: dx * A.nx + dz * A.nz }; }
  // where the staff stand: the room's own spots when it publishes them (the
  // Oval Office does: an oval has no straight side wall to line people up on),
  // else a line down the side of a rectangular office
  function spots(rec) {
    const A = rec.approach, half = A.span / 2, L = rec.landmarks;
    const lp = L.arrivalPortal ? toLocal(rec, L.arrivalPortal.x, L.arrivalPortal.z) : { x: 0, z: 6 };
    const side = half - 1.1;
    const line = [];
    for (let i = 0; i < LINE_MAX; i++) {
      const q = L["line" + i];
      line.push(q ? { x: q.x, z: q.z } : toWorld(rec, side, lp.z + 2.1 + i * 1.2));
    }
    const desk = L.presidentialDesk;
    return {
      door: L.staffDoor ? { x: L.staffDoor.x, z: L.staffDoor.z } : toWorld(rec, 0, 1.0),
      chief: L.chiefSpot ? { x: L.chiefSpot.x, z: L.chiefSpot.z } : toWorld(rec, side, lp.z + 0.9),
      line: line,
      press: L.pressSpot ? { x: L.pressSpot.x, z: L.pressSpot.z } : toWorld(rec, Math.min(3.4, half - 1.4), Math.max(1.4, lp.z - 2.0)),
      // everybody in the room turns to the man at the desk
      faceIn: function (p) {
        if (desk) return Math.atan2(desk.x - p.x, desk.z - p.z);
        const c = toWorld(rec, 0, toLocal(rec, p.x, p.z).z); return Math.atan2(c.x - p.x, c.z - p.z);
      },
    };
  }
  function nearOffice(rec) {
    const P = CBZ.player;
    if (!rec || !P || !P.pos || P.dead || Math.abs((P.pos.y || 0) - rec.floorY) > 3) return false;
    const d = rec.landmarks.presidentialDesk;
    return Math.hypot(P.pos.x - d.x, P.pos.z - d.z) < NEAR_R;
  }

  // ---- bodies (president_office.js's idiom) ---------------------------------
  function post(rec, at, R, opts) {
    if (!CBZ.cityPostNpc) return null;
    const o = { job: R.job, archetype: R.archetype, armed: !!R.armed, aggr: 0.05, wealth: 0.7, floorY: rec.floorY, src: "presstaff" };
    if (R.weapon) o.weapon = R.weapon;
    if (R.hp) o.hp = R.hp;
    if (opts) for (const k in opts) if (opts[k] != null) o[k] = opts[k];
    let p = null;
    try { p = CBZ.cityPostNpc(at.x, at.z, o); } catch (e) { p = null; }
    // a staffer is his job, not a pedestrian: only his own verbs (no street
    // Talk / Mug / Hire on the man waiting to be hired)
    if (p) { p.organization = "state"; p.nameKnown = true; p._iOnly = true; }
    return p;
  }
  function unpost(p) {
    if (!p || p.dead) return;
    if (CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(p); return; } catch (e) {} }
    try { if (p.group && p.group.parent) p.group.parent.remove(p.group); const a = CBZ.cityPeds; if (a) { const i = a.indexOf(p); if (i >= 0) a.splice(i, 1); } } catch (e) {}
  }
  // THE AISLE (interior_programs.js publishes it for the Oval Office): the
  // lane round the sofas and the low table from the staff door to the line.
  // Walked straight, a man from the door cut through the sofa, stuck on it
  // and was left standing in the door lane (the President's way out).
  // walkTo(p, x, z, true) threads the aisle, in the order that runs from
  // wherever he is toward (x, z).
  function aisleTo(p, x, z) {
    const rec = office(), L = rec && rec.landmarks;
    if (!L || !L.staffAisle0 || !L.staffAisle1) return [];
    const A = [L.staffAisle0, L.staffAisle1];
    const d = function (q, r) { return Math.hypot(q.x - r.x, q.z - r.z); };
    const fwd = d(p.pos, A[0]) <= d(p.pos, A[A.length - 1]) ? A : A.slice().reverse();
    // leave out the points behind him and past the goal
    const out = [];
    for (let i = 0; i < fwd.length; i++) if (d(fwd[i], { x: x, z: z }) < d(p.pos, { x: x, z: z }) + 0.5) out.push({ x: fwd[i].x, z: fwd[i].z });
    return out;
  }
  function walkTo(p, x, z, aisle) {
    if (!p || p.dead) return;
    p.controlled = true; p.staffPost = null;
    p.path = (aisle ? aisleTo(p, x, z) : []).concat([{ x: x, z: z }]); p.finalGoal = { x: x, z: z };
    if (p.target && p.target.set) p.target.set(x, 0, z);
    p.state = "walk"; p.pause = 0;
  }
  function holdAt(p, face) {
    if (!p || p.dead) return;
    p.path = null; p.finalGoal = null; p.state = "idle"; p.pause = 2; p.speed = 0;
    if (p.target && p.target.set) p.target.set(p.pos.x, 0, p.pos.z);
    if (face != null && p.group) p.group.rotation.y = face;
  }
  function near(p, at, r) { return p && at && Math.hypot(p.pos.x - at.x, p.pos.z - at.z) < r; }
  function walkOut(p) {
    if (!p || p.dead) return;
    p._iopts = null;
    const rec = office();
    if (!rec) { unpost(p); return; }
    const S = spots(rec);
    walkTo(p, S.door.x, S.door.z, true);
    OUT.push({ ped: p, t: 0, door: S.door });
  }
  let _nameRng = null;
  function mintName(gender) {
    if (!_nameRng) {
      let s = 0x5eed ^ (day() * 7919);
      _nameRng = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    }
    return CBZ.cityMintName ? CBZ.cityMintName(_nameRng, gender) : ("Candidate " + (++W.seq));
  }

  // ---- WHICH JOBS ARE OPEN ----------------------------------------------------
  function openRoles() {
    const S = staff(), out = [];
    let cab = null;
    try { cab = Pz().cabinet(); } catch (e) { cab = null; }
    for (let i = 0; i < ORDER.length; i++) {
      const role = ORDER[i], R = ROLES[role];
      if (R.cabinet) { if (cab && cab[role] && cab[role].dead) out.push(role); continue; }
      if (role === "agent") {
        const d = detail(), cap = (CBZ.protection && CBZ.protection.HIRE_CAP) || 8;
        if ((S.agents | 0) < AGENT_HIRES && d && (d.memberCount | 0) < cap) out.push(role);
        continue;
      }
      if (!S[role]) out.push(role);
    }
    return out;
  }
  function inLine(role) { for (let i = 0; i < LINE.length; i++) if (LINE[i].role === role) return true; return false; }

  // ---- THE LINE -----------------------------------------------------------------
  function bringCandidate(rec, role) {
    const S = spots(rec), R = ROLES[role];
    const i = LINE.length;
    const gender = role === "press" ? "f" : (R.cabinet && ((W.seq++ * 7 + day()) % 10) < 3 ? "f" : "m");
    const p = post(rec, S.door, R, { gender: gender, face: Math.atan2(S.line[i].x - S.door.x, S.line[i].z - S.door.z) });
    if (!p) return false;
    p.name = mintName(gender);
    p._presCandidate = role;
    const c = { role: role, ped: p, spot: i, phase: "enter", greeted: false, t: 0 };
    LINE.push(c);
    walkTo(p, S.line[i].x, S.line[i].z, true);
    if (CBZ.interactions && CBZ.interactions.registerFor) {
      CBZ.interactions.registerFor(p, { id: "pres-hire", slot: "e", prio: 60, campaignSafe: true, forceYes: true,
        label: "Hire", canShow: function () { return c.phase !== "leave" && !!seat(); }, onSelect: function () { hire(c); } });
      CBZ.interactions.registerFor(p, { id: "pres-send-away", prio: 5, campaignSafe: true, forceYes: true,
        label: "Send away", canShow: function () { return c.phase !== "leave"; }, onSelect: function () { sendAway(c); } });
    }
    return true;
  }
  function dropFromLine(c) {
    const i = LINE.indexOf(c);
    if (i >= 0) LINE.splice(i, 1);
    // the rest of the line steps up
    const rec = office();
    if (!rec) return;
    const S = spots(rec);
    for (let k = 0; k < LINE.length; k++) {
      const e = LINE[k];
      if (e.spot !== k) { e.spot = k; if (e.phase !== "leave") { e.phase = "enter"; walkTo(e.ped, S.line[k].x, S.line[k].z, true); } }
    }
  }
  function sendAway(c) {
    W.nextFor[c.role] = CLOCK + SEND_AWAY_WAIT;
    dropFromLine(c);
    walkOut(c.ped);
  }

  // ---- HIRE: the man takes the job and goes to it ------------------------------
  function hire(c) {
    const p = c.ped, R = ROLES[c.role], S = staff();
    if (!p || p.dead || !seat()) return;
    dropFromLine(c);
    p._presCandidate = null; p._iopts = null;
    say(p, SAYS[c.role][1], 2.2);
    if (c.role === "agent") {
      const d = detail();
      if (!d) { walkOut(p); return; }
      const cap = (CBZ.protection && CBZ.protection.HIRE_CAP) || 8;
      d.memberCount = Math.min(cap, (d.memberCount | 0) + 1);
      p.controlled = true; p.staffPost = null; p.path = null; p.finalGoal = null;
      p._protUnit = d.id; p.ammo = 30; p.maxHp = R.hp; p.hp = R.hp;
      p._iOnly = false;                            // one of your men now: he takes orders (city/orders.js)
      d.memberPedRefs.push(p);
      S.agents = (S.agents | 0) + 1;
      if (CBZ.cityRelShift) { try { CBZ.cityRelShift(p, "recruited", 0.6); } catch (e) {} }
      return;
    }
    if (R.cabinet) {
      const pz = Pz();
      if (pz && pz.fillCabinet) pz.fillCabinet(c.role, { name: p.name, gender: p.gender || "m", sid: p._sid });
      walkOut(p);                                  // to his table in the Situation Room
      return;
    }
    S[c.role] = { name: p.name, gender: p.gender || "m", day: day() };
    if (c.role === "press") {
      if (W.press) unpost(W.press);
      W.press = p; p._presStaff = "press";
      const rec = office();
      if (rec) { const sp = spots(rec).press; walkTo(p, sp.x, sp.z); }
      wirePress(p);
      return;
    }
    if (c.role === "driver") walkOut(p);           // down to the car (he is posted there, below)
  }

  // ---- FIRE: an order to the Chief of Staff about somebody else --------------
  function fire(chief, who) {
    const S = staff();
    if (!who || who.dead) return;
    if (who._presCandidate) { for (let i = 0; i < LINE.length; i++) if (LINE[i].ped === who) { sendAway(LINE[i]); break; } say(chief, "Next.", 1.6); return; }
    if (who._presOfficer) {
      const pz = Pz();
      if (pz && pz.vacateCabinet) pz.vacateCabinet(who._presOfficer);
      say(chief, "I'll tell him.", 2);
      return;
    }
    if (who._presStaff === "press" || who._presStaff === "driver") {
      const role = who._presStaff;
      S[role] = null;
      if (W[role] === who) W[role] = null;
      who._presStaff = null;
      say(chief, "Done.", 1.6);
      walkOut(who);
      return;
    }
    const d = detail();
    if (d && who._protUnit === d.id) {
      const i = d.memberPedRefs.indexOf(who);
      if (i >= 0) d.memberPedRefs.splice(i, 1);
      d.memberCount = Math.max(0, (d.memberCount | 0) - 1);
      S.agents = Math.max(0, (S.agents | 0) - 1);
      who._protUnit = null; who._order = null;
      say(chief, "Done.", 1.6);
      walkOut(who);
      return;
    }
    say(chief, "He doesn't work for us.", 2);
  }

  // ---- THE PRESS SECRETARY: she goes to the cameras --------------------------
  function politics() { const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null; return (w && w.politics) || g.cityPolitics || null; }
  function brief(byHand) {
    const S = staff(), pol = politics();
    if (!S.press || !pol) return false;
    if (S.pressDay === day()) { if (byHand && W.press) say(W.press, "I already did today.", 2); return false; }
    const before = +pol.scandal || 0;
    if (before <= 0 && !byHand) return false;
    S.pressDay = day();
    pol.scandal = Math.max(0, before - 6);
    if (W.press) say(W.press, "I'll handle them.", 2);
    const O = CBZ.presidentOffice;
    if (O && O.news) { try { O.news("White House briefing: " + S.press.name + " takes questions", { sub: "\"The President is focused on the country.\"" }); } catch (e) {} }
    return true;
  }
  function wirePress(p) {
    if (!p || !CBZ.interactions || !CBZ.interactions.registerFor) return;
    p._iopts = null;
    CBZ.interactions.registerFor(p, { id: "pres-press-brief", slot: "e", prio: 40, campaignSafe: true, forceYes: true,
      label: "Brief", canShow: function () { return !!seat() && staff().pressDay !== day(); },
      onSelect: function () { brief(true); } });
  }

  // ---- THE CHIEF OF STAFF stands at the head of the line --------------------
  function chiefName() { try { const c = Pz().cabinet().chief; return c && !c.dead ? c.display || c.name : null; } catch (e) { return null; } }
  function postChief(rec) {
    const nm = chiefName();
    if (!nm) return;
    const S = spots(rec);
    const p = post(rec, S.chief, { job: "chief of staff", archetype: "professional" }, { pin: true, face: S.faceIn(S.chief) });
    if (!p) return;
    p.name = nm; p._presStaff = "chief";
    W.chief = p;
    if (CBZ.interactions && CBZ.interactions.registerFor) {
      // E on him is Talk: the day in one sentence. His orders are on the wheel.
      CBZ.interactions.registerFor(p, { id: "pres-chief-talk", slot: "e", prio: 30, campaignSafe: true, forceYes: true,
        label: "Talk", canShow: function () { return !!seat(); },
        onSelect: function () {
          const O = CBZ.presidentOffice;
          let line = "Nothing that can't wait, sir.";
          if (O && O.dayLine) { try { line = O.dayLine() || line; } catch (e) {} }
          say(p, line, Math.min(5, 2 + line.length * 0.04));
        } });
      CBZ.interactions.registerFor(p, { id: "pres-chief-fire", prio: 20, pick: "person", campaignSafe: true, forceYes: true,
        label: "Fire", canShow: function () { return !!seat(); }, onSelect: function (chief, ctx, who) { fire(chief, who); } });
    }
  }
  function aideVisiting() {
    const O = CBZ.presidentOffice;
    if (!O || !O._M) return false;
    try { return !!(O.audit && O.audit().aide); } catch (e) { return false; }
  }

  // ---- THE DRIVER waits at the state car ---------------------------------------
  function tickDriver() {
    const S = staff(), M = CBZ.motorcade, P = CBZ.player;
    const car = S.driver && M && M.car ? M.car() : null;
    const busy = !!(M && M.active && M.active());
    const want = !!(car && car.pos && !busy && P && P.pos && Math.hypot(P.pos.x - car.pos.x, P.pos.z - car.pos.z) < 70 && Math.abs((P.pos.y || 0) - (car.pos.y || 0)) < 4);
    if (!want) { if (W.driver) { unpost(W.driver); W.driver = null; } return; }
    if (W.driver && !W.driver.dead) return;
    // the driver's door, a step out from the car (the car's left side)
    const h = car.heading != null ? car.heading : (car.group ? car.group.rotation.y : 0);
    const x = car.pos.x + Math.cos(h) * 1.6, z = car.pos.z - Math.sin(h) * 1.6;
    let p = null;
    try { p = CBZ.cityPostNpc(x, z, { job: "chauffeur", archetype: "professional", pin: true, face: h, floorY: car.pos.y || 0, src: "presstaff:driver" }); } catch (e) { p = null; }
    if (!p) return;
    p.name = S.driver.name; p.nameKnown = true; p.organization = "state"; p._presStaff = "driver"; p._iOnly = true;
    W.driver = p;
  }

  // ---- TICK -----------------------------------------------------------------------
  function releaseAll() {
    for (let i = 0; i < LINE.length; i++) unpost(LINE[i].ped);
    LINE.length = 0;
    for (let i = 0; i < OUT.length; i++) unpost(OUT[i].ped);
    OUT.length = 0;
    if (W.chief) { unpost(W.chief); W.chief = null; }
    if (W.press) { unpost(W.press); W.press = null; }
  }
  let acc = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(36.25, function (dt) {
    dt = dt || 0.016;
    CLOCK += dt;
    if (!playing()) return;
    const s = seat();
    if (!s) { if (LINE.length || W.chief || W.press || W.driver) { releaseAll(); if (W.driver) { unpost(W.driver); W.driver = null; } } return; }
    const rec = office();
    // people walking out: gone at the door, or after a while regardless
    for (let i = OUT.length - 1; i >= 0; i--) {
      const o = OUT[i]; o.t += dt;
      if (!o.ped || o.ped.dead || near(o.ped, o.door, 0.9) || o.t > 12) { if (o.ped && !o.ped.dead) unpost(o.ped); OUT.splice(i, 1); }
    }
    // the line: walk in, stand, say one line when you come up
    const P = CBZ.player;
    for (let i = LINE.length - 1; i >= 0; i--) {
      const c = LINE[i], p = c.ped;
      if (!p || p.dead) { LINE.splice(i, 1); continue; }
      c.t += dt;
      if (c.phase === "enter" && rec) {
        const sp = spots(rec).line[c.spot];
        // a man who has not made his place in the line in 14 s is put there:
        // he never waits wherever he stalled (that was the Oval Office door)
        if (!near(p, sp, 0.6) && c.t > 14) { p.pos.x = sp.x; p.pos.z = sp.z; if (p.group) { p.group.position.x = sp.x; p.group.position.z = sp.z; } }
        if (near(p, sp, 0.6)) { holdAt(p, spots(rec).faceIn(sp)); c.phase = "wait"; }
      } else if (c.phase === "wait" && !c.greeted && P && P.pos && Math.hypot(P.pos.x - p.pos.x, P.pos.z - p.pos.z) < 2.8) {
        c.greeted = true; say(p, SAYS[c.role][0], 3);
      }
    }
    if (W.press && !W.press.dead && rec && W.press.state === "walk" && near(W.press, spots(rec).press, 0.6)) holdAt(W.press, spots(rec).faceIn(spots(rec).press));

    acc += dt;
    if (acc < 0.5) return;
    acc = 0;
    tickDriver();
    // the press secretary works whether or not you are watching
    const pol = politics();
    if (staff().press && pol && (+pol.scandal || 0) >= BRIEF_AT) brief(false);
    if (!rec || !nearOffice(rec)) {
      if (LINE.length || W.chief || W.press) releaseAll();
      return;
    }
    // the Chief of Staff, unless president_office.js has him (or an aide) walking in
    if (aideVisiting()) { if (W.chief) { unpost(W.chief); W.chief = null; } }
    else if (!W.chief || W.chief.dead) { if (W.chief && W.chief.dead) W.chief = null; if (!W.chief) postChief(rec); }
    // the press secretary at her desk outside the door
    if (staff().press && !W.press) {
      const sp = spots(rec).press;
      const p = post(rec, sp, ROLES.press, { pin: true, face: spots(rec).faceIn(sp), gender: staff().press.gender || "f" });
      if (p) { p.name = staff().press.name; p._presStaff = "press"; W.press = p; wirePress(p); }
    }
    // the line refills with whoever the open jobs send
    if (LINE.length < LINE_MAX) {
      const open = openRoles();
      for (let i = 0; i < open.length && LINE.length < LINE_MAX; i++) {
        const role = open[i];
        if (inLine(role) || (W.nextFor[role] || 0) > CLOCK) continue;
        bringCandidate(rec, role);
        break;                                     // one at a time through the door
      }
    }
  });

  CBZ.presidentStaff = {
    has: has,
    line: function () { return LINE.map(function (c) { return { role: c.role, name: c.ped && c.ped.name, phase: c.phase }; }); },
    audit: function () {
      const S = staff();
      return { line: LINE.length, open: seat() ? openRoles() : [], chief: !!W.chief, press: S.press ? S.press.name : null,
        driver: S.driver ? S.driver.name : null, agents: S.agents | 0, briefedToday: S.pressDay === day() };
    },
    // harness hooks
    _hire: function (i) { const c = LINE[i | 0]; if (c) hire(c); return !!c; },
    _fire: fire,
  };
})();
