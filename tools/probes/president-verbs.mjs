/* tools/probes/president-verbs.mjs — EVERYONE THE PRESIDENT MEETS HAS VERBS,
   AND THE PEOPLE DO THE TALKING.

   OWNER (2026-10-08): "Many of the president mode characters don't have
   interaction options, and Pres mode has separate buttons that are slop."
   "All buttons and interactions should come from players talking to you."
   "the cool part when you have security is ordering them to attack
   literally anyone."

   Boots the real President run (title card, seed 260811), lets the office
   live, walks the player through the house, the Situation Room, the press
   room, the motor court and the gate, starts a protest and a balcony speech,
   and at every stop asks the ONE registry the keys and the taps use
   (CBZ.interactions.wheelOf) what each person within reach of the estate or
   riding in the motorcade offers: E, hold E, F, and the rest of the Q wheel.

   1. CENSUS by role (role: sightings, verb sets).
   2. FIRE each person-verb ("pv-*", the orders about a man excepted) once on
      one person of every role: something is said over a head, nothing throws.
   3. PEOPLE TALK TO YOU: every question that stood during the run, and what
      its answers rode on (a person, or a thing: the desk phone, the lectern).
      The decisions the old reply strip and the "Brief" wall carried must
      each have come from somebody speaking: an aide's matter, a desk-phone
      call, a speech beat, the driver's "Where to?".
   4. TAKE HIM DOWN: a named citizen beside the President: the verb is on him
      (hold E), the agents draw (ped._drawWhy "order"), he dies, NEWS ONE runs
      it. A second: ordered, then Stand down: nobody keeps the order, the
      guns go away (CBZ.gunDiscipline: none drawn) and the detail's incident
      is over (posture normal), still so 5 s later. A third: Detain ties him
      (restraint "cuffed").
   5. THE SERVICE'S ROSTER: shoot one of your own agents; 30 s on nobody has
      been posted in his place, he is off the roster, Secret Service loyalty
      fell.

   FAILS when a MUST role has no verb, a state person offers the street's
   verbs (Mug, Punch, Flirt...), a fired verb throws or says nothing, the
   reply strip (#campaignDialogue choices) ever shows, a required speaker
   never spoke, any take-down step fails, or a president file throws.

     testbus:  node tools/testbus/submit.mjs --probe tools/probes/president-verbs.mjs
     alone:    node tools/president-verbs-check.mjs [--seed N] [-v]
   Sim only (?cfg_RENDER_FRAMES=0). */
export const meta = { world: "president", seed: 260811, fresh: true, dirties: true, timeoutMs: 25 * 60e3 };

// who must have business with the President
const MUST = ["Press Secretary", "Driver", "General", "Bureau Director", "Police Commissioner",
  "Detail agent", "Football aide", "Gate officer", "Aide", "Secretary", "Protester", "Supporter", "Reporter"];
// what the deleted reply strip / "Brief" wall carried: each must come from somebody talking
const SPOKE = ["Aide", "desk phone", "lectern", "Driver"];
const STREET = /^(Mug|Punch|Flirt|Hire|Recruit|Pickpocket|Rob|Propose|Compliment|Insult|Prospect|Ask for a smoke|Ask the way)\b/;

export default async function (t) {
  const VERBOSE = t.flag("-v");
  await t.evl(`(function(){
    var W = window.__pv = { seen: {}, buttons: 0, said: [], asked: {} };
    function mansion() { var L = CBZ.govComplexes || []; for (var i = 0; i < L.length; i++) if (L[i] && L[i].id === 'execmansion') return L[i]; return null; }
    W.site = mansion;
    W.role = function (p) {
      var src = String(p._occupySrc || '');
      if (p._presStaff === 'chief') return 'Chief of Staff';
      if (p._presStaff === 'press') return 'Press Secretary';
      if (p._presStaff === 'driver') return 'Driver';
      if (p._presOfficer) return { general: 'General', bureau: 'Bureau Director', police: 'Police Commissioner', treasury: 'Treasury Secretary' }[p._presOfficer] || 'Officer';
      if (p._footballWired && p._iopts && p._iopts.some(function (o) { return /^football-/.test(o.id) && o.canShow && o.canShow(p, {}); })) return 'Football aide';
      if (p._protUnit === 'mansion') return p._protRole === 'gate' ? 'Gate officer' : p._protRole === 'counter-sniper' ? 'Counter-sniper' : 'Wall agent';
      if (p._protUnit && /^off_/.test(String(p._protUnit))) return 'Detail agent';
      if (src === 'presoffice:aide') return 'Aide';
      if (src === 'presoffice:secretary') return 'Secretary';
      if (src === 'prespublic:pro') return 'Protester';
      if (src === 'prespublic:sup') return 'Supporter';
      if (p.job === 'press correspondent') return 'Reporter';
      if (src === 'motorcade') return 'Motorcade ' + (p.kind === 'cop' ? 'officer' : 'agent');
      if (p._presPublic) return p.job === 'soldier' ? 'Soldier' : 'Street officer';
      if (p._presRaid) return 'Bureau raid agent';
      return null;
    };
    W.step = function (n) {
      for (var k = 0; k < n; k++) {
        CBZ.stepSim(1 / 60);
        var c = CBZ.camera;
        if (c) { c.updateMatrixWorld(true); if (c.matrixWorldInverse) c.matrixWorldInverse.copy(c.matrixWorld).invert(); }
        // the president's reply buttons must never be on the glass
        var d = document.getElementById('campaignDialogue');
        if (d && d.classList.contains('show') && d.querySelector('[data-choice]')) W.buttons++;
        // who asked, and what the answers rode on
        if (k % 15 === 0) {
          var UI = CBZ.campaignUI, r = UI && UI.replies ? UI.replies() : null;
          if (r) {
            var by = r.actor ? (W.role(r.actor) || ('person ' + (r.actor.job || '?'))) : W.thing(r.at);
            var rec = W.asked[by] || (W.asked[by] = { n: 0, labels: {} });
            rec.n++; rec.labels[r.labels.join(' / ')] = 1;
          }
        }
      }
      return true;
    };
    // a reply spot is named by the thing it is at
    W.thing = function (at) {
      if (!at) return '?';
      try { var O = CBZ.presidentOffice, R = O && O._room; if (R && R.phone) { var v = new THREE.Vector3(); R.phone.getWorldPosition(v); if (Math.hypot(v.x - at.x, v.z - at.z) < 1) return 'desk phone'; } } catch (e) {}
      try { var L = CBZ.presidentPublic && CBZ.presidentPublic._state().app.live; if (L && L.stage && Math.hypot(L.stage.x - at.x, L.stage.z - at.z) < 1.5) return 'lectern'; } catch (e) {}
      return 'a spot';
    };
    var say0 = CBZ.citySay;
    if (say0 && !say0._pv) { CBZ.citySay = function (p, line) { W.said.push(String(line || '')); return say0.apply(this, arguments); }; CBZ.citySay._pv = true; }
    var sp = CBZ.speech;
    if (sp && sp.say && !sp.say._pv) { var s0 = sp.say; sp.say = function (a, line) { W.said.push(String(line || '')); return s0.apply(this, arguments); }; sp.say._pv = true; }
    if (sp && sp.phone && !sp.phone._pv) { var s1 = sp.phone; sp.phone = function (line) { W.said.push(String(line || '')); return s1.apply(this, arguments); }; sp.phone._pv = true; }
    var sl0 = CBZ.sayLines;
    if (sl0 && !sl0._pv) { CBZ.sayLines = function (list) { try { for (var i = 0; i < list.length; i++) W.said.push(String(list[i].line || '')); } catch (e) {} return sl0.apply(this, arguments); }; CBZ.sayLines._pv = true; }
    function inEstate(p) {
      var s = mansion(); if (!s || !s.rect) return false; var r = s.rect, m = 40;
      return p.pos.x > r.minX - m && p.pos.x < r.maxX + m && p.pos.z > r.minZ - m && p.pos.z < r.maxZ + m;
    }
    W.cand = function (p) {
      var cop = (CBZ.cityCops || []).indexOf(p) >= 0;
      return { t: p, d: 2, kind: p.vendor ? 'vendor' : cop ? 'cop' : 'ped',
        layers: p.vendor ? ['ped:vendor', 'ped'] : cop ? ['ped:cop', 'ped'] : ['ped:civ', 'ped'], base: 0, gunpoint: false };
    };
    W.verbs = function (p) {
      var I = CBZ.interactions, out = { e: null, hold: null, f: null, q: [], ids: [] };
      var items = []; try { items = I.wheelOf(W.cand(p)) || []; } catch (e) { out.err = String(e && e.message || e); return out; }
      for (var i = 0; i < items.length; i++) {
        var it = items[i], w = String(it.label || '');
        if (CBZ.cityVerbWord) { try { w = CBZ.cityVerbWord(it.label) || w; } catch (e) {} }
        if (/^reply-/.test(String(it.opt && it.opt.id || ''))) continue;     // an answer to a question standing right now
        out.ids.push(String(it.opt && it.opt.id || ''));
        if (it.key === 'e' && !out.e) out.e = w; else if (it.key === 'hold e' && !out.hold) out.hold = w; else if (it.key === 'f' && !out.f) out.f = w; else out.q.push(w);
      }
      return out;
    };
    W.census = function () {
      var lists = [CBZ.cityPeds || [], CBZ.cityCops || []], n = 0;
      for (var L = 0; L < lists.length; L++) for (var i = 0; i < lists[L].length; i++) {
        var p = lists[L][i];
        if (!p || p.dead || p.isPlayer || p.player || !p.pos || !p.group || p._pvTest) continue;
        var role = W.role(p);
        if (!role && !inEstate(p)) continue;
        role = role || ('Estate ' + (p.job || p.kind || 'person'));
        var v = W.verbs(p);
        var rec = W.seen[role] || (W.seen[role] = { n: 0, sig: {}, state: false, iOnly: false });
        rec.n++;
        rec.state = rec.state || p.organization === 'state' || p.organization === 'military' || !!p._iOnly;
        rec.iOnly = rec.iOnly || !!p._iOnly;
        var sig = JSON.stringify([v.e, v.hold, v.f, v.q]);
        rec.sig[sig] = (rec.sig[sig] | 0) + 1;
        if (!rec.sample || rec.sample.dead) rec.sample = p;
        n++;
      }
      return n;
    };
    W.put = function (x, y, z, yaw) {
      var P = CBZ.player; if (!P) return false;
      if (CBZ.propStand && (P._propSeat || P._propBed)) { try { CBZ.propStand(P, { instant: true }); } catch (e) {} }
      P.pos.set(x, y, z); if (P.vel) P.vel.set(0, 0, 0);
      if (CBZ.cam) CBZ.cam.yaw = yaw;
      return true;
    };
    // fire every person-verb (pv-*) on one person of each role; the orders
    // about a man are section 4's
    var ORDERS = /^pv-(take-down|detain|escort-out|call-off|clear-room)$/;
    W.fire = function () {
      var out = [], I = CBZ.interactions;
      Object.keys(W.seen).forEach(function (role) {
        var p = W.seen[role].sample;
        if (!p || p.dead || !p.group) return;
        var items = [];
        try { items = I.wheelOf(W.cand(p)) || []; } catch (e) {}
        items.forEach(function (it) {
          var id = String(it.opt && it.opt.id || '');
          if (!/^pv-/.test(id) || ORDERS.test(id)) return;
          var before = W.said.length, err = null;
          var P = CBZ.player; if (P && P.pos && p.pos) { P.pos.set(p.pos.x + 1.2, p.pos.y != null ? p.pos.y : P.pos.y, p.pos.z); }
          try { I.fireOn(W.cand(p), it.opt); } catch (e) { err = String(e && e.message || e); }
          W.step(40);
          out.push({ role: role, id: id, said: W.said.slice(before, before + 2).join(' / '), err: err });
          try { if (CBZ.campaignUI && CBZ.campaignUI.clearDialogue) CBZ.campaignUI.clearDialogue(); } catch (e) {}
        });
      });
      return out;
    };
    // ---- TAKE HIM DOWN ----------------------------------------------------
    W.citizen = function (name, dx) {
      var P = CBZ.player, q = null;
      try { q = CBZ.cityPostNpc(P.pos.x + dx, P.pos.z + 3, { job: 'tourist', kind: 'civilian', archetype: 'resident', aggr: 0.05, src: 'pvcheck' }); } catch (e) { q = null; }
      if (!q) return null;
      q.name = name; q.nameKnown = true; q._pvTest = true; q.controlled = false; q.staffPost = null;
      return q;
    };
    W.wheelIds = function (q) { try { return (CBZ.interactions.wheelOf(W.cand(q)) || []).map(function (it) { return (it.key ? it.key + ':' : '') + (it.opt && it.opt.id); }); } catch (e) { return ['ERR ' + e.message]; } };
    W.fireId = function (q, id) {
      var items = CBZ.interactions.wheelOf(W.cand(q)) || [];
      for (var i = 0; i < items.length; i++) if (items[i].opt && items[i].opt.id === id) { CBZ.interactions.fireOn(W.cand(q), items[i].opt); return true; }
      return false;
    };
    W.forceState = function () {
      var O = CBZ.cityOrders2, f = O && O.force ? O.force() : [], o = O && O.forceOrder ? O.forceOrder() : null;
      var crew = o ? o.crew : [];
      return { force: f.length, order: o ? o.mode : null,
        drawn: crew.filter(function (q) { return q._drawWhy && q._drawWhy.why === 'order'; }).length,
        crew: crew.length };
    };
    W.allForce = function () { return CBZ.cityOrders2 && CBZ.cityOrders2.force ? CBZ.cityOrders2.force() : []; };
    W.stories = function () { try { return (CBZ.news.stories() || []).map(function (s) { return String(s.headline || s.h || s.title || s); }); } catch (e) { return []; } };
    return true;
  })()`);

  const step = (n) => t.evl(`__pv.step(${n})`);
  const census = () => t.evl("__pv.census()");
  async function stop(label, setup, secs) {
    if (setup) await t.evl(setup);
    for (let s = 0; s < secs; s += 2) { await step(120); const n = await census(); if (VERBOSE) t.log(`  ${label}: ${n} people`); }
  }
  await step(240);
  await stop("Oval Office desk", null, 10);
  await stop("an aide walks in", "(function(){try{var O=CBZ.presidentOffice; if(O&&O.offer) O.offer({who:{name:'Tom Reyes',role:'aide'}, topic:'security', line:'Sir, a word.', yes:{label:'Go on.'}, no:{label:'Later.'}, via:'aide', urgent:true});}catch(e){} return true;})()", 14);
  // the desk phone: a call goes out, the caller talks, the answers are on the handset
  // (the aide's question is let go first: a man who is still waiting on you keeps the line)
  await t.evl("(function(){ try { CBZ.campaignUI.clearDialogue(); } catch (e) {} return __pv.step(60); })()");
  await stop("a call on the desk phone", "(function(){try{var O=CBZ.presidentOffice; O._M.lastCallEnd=-1e9; O._M.holdUntil=0; O.offer({who:{name:'Ian Cole',role:'whip'}, topic:'address', via:'phone', line:'Mr. President, the party wants you on air.', yes:{label:'Book it.'}, no:{label:'Not yet.'}}); if(O._call) O._call();}catch(e){} return true;})()", 8);
  await t.evl("(function(){ try { CBZ.campaignUI.clearDialogue(); } catch (e) {} return true; })()");
  const rooms = await t.evl("(CBZ.presidentInteriorRooms?CBZ.presidentInteriorRooms():[]).map(function(r){return {key:r.key,x:r.x,z:r.z,y:r.floorY,podium:r.landmarks&&r.landmarks.podium||null};})");
  for (const k of ["outeroffice", "wwhall", "cabinetroom", "pressroom", "statehall", "stateresidence"]) {
    const r = (rooms || []).find((q) => q.key === k);
    if (!r) continue;
    const at = r.podium && r.podium.x != null ? r.podium : r;
    await stop(k, `__pv.put(${at.x}, ${r.y + 0.02}, ${at.z}, 0)`, 6);
  }
  const extra = await t.evl(`(function(){
    var out = [], s = __pv.site(); if (!s) return out;
    var mb = s.lot && s.lot.building, sr = mb && mb._sitRoom;
    if (sr) out.push({ label: 'Situation Room', x: (sr.minX + sr.maxX) / 2, y: (mb.floorTops ? mb.floorTops[0] : 0.14) + 0.02, z: (sr.minZ + sr.maxZ) / 2 });
    var cx = s.cx != null ? s.cx : (s.rect.minX + s.rect.maxX) / 2, cz = s.cz != null ? s.cz : (s.rect.minZ + s.rect.maxZ) / 2;
    var car = CBZ.motorcade && CBZ.motorcade.car ? CBZ.motorcade.car() : null;
    if (car && car.pos) out.push({ label: 'the state car', x: car.pos.x + 3, y: (car.pos.y || 0) + 0.2, z: car.pos.z });
    out.push({ label: 'motor court', x: cx, y: 0.2, z: cz - 16 });
    if (s.gate) out.push({ label: 'the gate', x: s.gate.x, y: 0.2, z: s.gate.z - 6 });
    return out;
  })()`);
  for (const e of extra || []) await stop(e.label, `__pv.put(${e.x}, ${e.y}, ${e.z}, 0)`, 8);
  const gate = (extra || []).find((e) => e.label === "the gate");
  if (gate) {
    await stop("a protest at the gate", `(function(){ __pv.put(${gate.x}, ${gate.y}, ${gate.z}, 0); try { CBZ.presidentPublic._protestNow(12); } catch (e) {} return true; })()`, 8);
    // walk up to the front of it: somebody calls out
    await stop("at the protest", `(function(){ var m = CBZ.presidentPublic._state().prot.members[0]; if (m && m.ped) __pv.put(m.ped.pos.x, m.ped.pos.y || 0.2, m.ped.pos.z - 2.5, Math.PI); return true; })()`, 8);
  }
  await stop("a balcony speech", "(function(){ try { CBZ.campaignUI.clearDialogue(); CBZ.presidentPublic._startNow('speech'); } catch (e) {} return true; })()", 8);
  await stop("at the lectern", "(function(){ try { CBZ.presidentPublic._speechBeat(0); } catch (e) {} return true; })()", 6);
  await t.evl("(function(){ try { CBZ.presidentPublic._speechBeat(0); CBZ.campaignUI.clearDialogue(); } catch (e) {} return true; })()");

  const seen = JSON.parse(await t.evl(`JSON.stringify(Object.keys(__pv.seen).map(function(k){ var r = __pv.seen[k]; return { role: k, n: r.n, state: r.state, iOnly: r.iOnly, sig: r.sig }; }))`));
  let bad = 0;
  const fmt = (s) => { const [e, h, f, q] = JSON.parse(s); const parts = ["E " + (e || "-")]; if (h) parts.push("hold E " + h); if (f) parts.push("F " + f); parts.push("Q " + (q.length ? q.join(", ") : "-")); return parts.join(" | "); };
  t.log("1. CENSUS (role: sightings, verb sets)");
  seen.sort((a, b) => a.role.localeCompare(b.role));
  for (const r of seen) {
    const sigs = Object.keys(r.sig).sort((a, b) => r.sig[b] - r.sig[a]);
    const any = sigs.some((s) => { const [e, h, f, q] = JSON.parse(s); return e || h || f || q.length; });
    const street = sigs.some((s) => { const [e, h, f, q] = JSON.parse(s); return [e, h, f].concat(q).some((w) => w && STREET.test(w)); });
    let why = "";
    if (MUST.includes(r.role) && !any) why = "no verbs";
    else if (r.state && street) why = "street verbs on a state person";
    if (why) bad++;
    t.log((why ? "FAIL  " : "  ok  ") + r.role.padEnd(26) + ` x${r.n}` + (why ? "  (" + why + ")" : ""));
    for (const s of sigs.slice(0, VERBOSE ? 6 : 2)) t.log("        " + fmt(s));
  }
  const missing = MUST.filter((m) => !seen.some((r) => r.role === m));
  if (missing.length) t.log("  (never met this run: " + missing.join(", ") + ")");

  t.log("2. FIRE");
  const fired = JSON.parse(await t.evl("JSON.stringify(__pv.fire())"));
  for (const f of fired) {
    const fail = !!f.err || !f.said;
    if (fail) bad++;
    t.log((fail ? "FAIL  " : "  ok  ") + (f.role + " " + f.id).padEnd(44) + (f.err ? " threw " + f.err : f.said ? " \"" + f.said + "\"" : " said nothing"));
  }

  t.log("3. PEOPLE TALK TO YOU (who asked; the answers rode on them)");
  // the driver asks "Where to?" when you ask him (fired above); count it
  const asked = JSON.parse(await t.evl("JSON.stringify(__pv.asked)"));
  for (const k of Object.keys(asked)) t.log("        " + k.padEnd(20) + " " + Object.keys(asked[k].labels).slice(0, 3).join("  |  "));
  for (const k of SPOKE) if (!asked[k]) { bad++; t.log("FAIL  nobody spoke for: " + k); }
  const btn = await t.evl("__pv.buttons");
  if (btn) { bad++; t.log(`FAIL  the reply-button strip (#campaignDialogue) showed for ${btn} frames`); }
  else t.log("  ok  the reply-button strip never showed");

  t.log("4. TAKE HIM DOWN");
  const court = (extra || []).find((e) => e.label === "motor court");
  if (court) await t.evl(`__pv.put(${court.x}, ${court.y}, ${court.z}, 0)`);
  await step(240);
  const r4 = JSON.parse(await t.evl(`JSON.stringify((function(){
    var out = {};
    var a = __pv.citizen('Walter Pike', 2.5);
    if (!a) return { err: 'no citizen' };
    __pv.step(10);
    out.wheel = __pv.wheelIds(a);
    out.force = __pv.allForce().length;
    out.fired = __pv.fireId(a, 'pv-take-down');
    __pv.step(20);
    out.after = __pv.forceState();
    for (var i = 0; i < 40 && !a.dead; i++) __pv.step(30);
    out.dead = !!a.dead;
    __pv.step(30);
    var st = __pv.stories();
    out.news = st.filter(function (s) { return /guards kill|Secret Service kills/.test(s); }).slice(0, 2);
    // ordered, then called off
    var b = __pv.citizen('Ruth Vale', -2.5);
    __pv.step(10);
    __pv.fireId(b, 'pv-take-down');
    __pv.step(20);
    out.drawn2 = __pv.forceState().drawn;
    out.callOff = __pv.fireId(b, 'pv-call-off');
    __pv.step(30);
    var f = __pv.allForce();
    out.stillOrdered = f.filter(function (q) { return q._order && q._order.force; }).length;
    out.stillDrawn = f.filter(function (q) { return q._drawWhy; }).length;
    // A GUN IS OUT when CBZ.gunDiscipline has it drawn (poseList shows the
    // prop only then). q.armed is "he carries one": every agent does, so the
    // old count here (armed && !_holster) read 11 forever and was not a draw.
    var GDd = CBZ.gunDiscipline;
    var out_ = function (q) { return GDd ? GDd.drawn(q) : !!(q.armed && !q._holster && !q._holstered); };
    out.carry = f.filter(function (q) { return q.armed; }).length;
    out.gunsOut = f.filter(out_).length;
    var PRd = function () { return CBZ.protection && CBZ.protection.posture ? CBZ.protection.posture('president') : null; };
    out.posture = PRd();
    // ...and they STAY away: past the 4 s stand-down window nothing of the
    // take-down (their own shots, the dead man, each other's guns) draws again
    __pv.step(330);
    out.gunsLater = f.filter(function (q) { return !q.dead && out_(q); }).length;
    out.postureLater = PRd();
    out.diag = { members: f.filter(out_).map(function (q) { var r = q._gd || {}; var m = q._det; return [q._protUnit || q._occupySrc || (q._presPublic ? 'pub' : '?'), q.job || q.kind, 'lv=' + r.lv, 'why=' + r.why, 'trig=' + r.trigWhy + '@' + (r.trigT != null ? (GDd.now() - r.trigT).toFixed(2) : '-'), 'det=' + (q._detWhy || ''), 'ph=' + (m && m.D ? m.D.phase : '-'), 'st=' + q.state, 'al=' + (q.alarmed || 0).toFixed(1), 'rage=' + !!q.rage, 'mem=' + !!q.mem].join(' '); }),
      ring: GDd ? GDd.log().slice(-24).map(function (e) { return e.t + ' ' + e.kind + ' ' + e.why + ' ' + e.who; }) : [] };
    out.bAlive = !b.dead;
    // detain
    var c = __pv.citizen('Ned Harlow', 3.5);
    __pv.step(10);
    out.detainFired = __pv.fireId(c, 'pv-detain');
    for (var j = 0; j < 40 && !(c.restraint && c.restraint.state); j++) __pv.step(30);
    out.cuffed = c.restraint ? c.restraint.state : null;
    out.cAlive = !c.dead;
    return out;
  })())`));
  const chk = (c, m) => { if (!c) bad++; t.log((c ? "  ok  " : "FAIL  ") + m); };
  if (r4.err) chk(false, r4.err);
  else {
    chk(r4.wheel.includes("hold e:pv-take-down"), `the verb is on him, hold E (wheel: ${r4.wheel.join(", ")})`);
    chk(r4.force > 0, `${r4.force} men take the order`);
    chk(r4.after && r4.after.drawn > 0, `agents draw on the order (${r4.after ? r4.after.drawn : 0} of ${r4.after ? r4.after.crew : 0})`);
    chk(r4.dead, "the target dies");
    chk(r4.news.length > 0, "NEWS ONE runs it: " + (r4.news[0] || "-"));
    chk(r4.drawn2 > 0 && r4.callOff, "a second order, then Stand down");
    chk(r4.stillOrdered === 0 && r4.stillDrawn === 0, `nobody keeps the order (${r4.stillOrdered} ordered, ${r4.stillDrawn} drawn)`);
    chk(r4.gunsOut === 0, `the guns go away (${r4.gunsOut} drawn of ${r4.carry} who carry one)`);
    chk(r4.posture === "normal", `Stand down ends the incident: the detail is back to normal (${r4.posture})`);
    chk(r4.gunsLater === 0 && r4.postureLater === "normal", `...and stays that way 5 s on (${r4.gunsLater} drawn, ${r4.postureLater})`);
    if (r4.gunsOut || r4.gunsLater || VERBOSE) { for (const m of r4.diag.members) t.log("        " + m); for (const e of r4.diag.ring) t.log("        gd " + e); }
    chk(r4.detainFired && r4.cuffed === "cuffed" && r4.cAlive, "Detain ties him (" + r4.cuffed + ")");
  }

  // 5. YOU SHOOT ONE OF YOUR OWN: he is off the Service's roster, it costs
  //    the Service's loyalty, and nobody is posted beside you 20 s later
  //    (owner 2026-10-09: "they keep spawning in around me").
  t.log("5. THE SERVICE'S ROSTER");
  const r5a = JSON.parse(await t.evl(`JSON.stringify((function(){
    var seat = CBZ.presidency && CBZ.presidency.seat ? CBZ.presidency.seat() : null;
    var det = seat && CBZ.protection.get ? CBZ.protection.get('off_' + seat.id) : null;
    if (!det) return { err: 'no detail' };
    var refs = det.memberPedRefs.filter(function (q) { return q && !q.dead; });
    var q = refs.filter(function (q) { return q._protRole !== 'shift-leader'; })[0] || refs[0];
    if (!q) return { err: 'no agent' };
    var PM = CBZ.politics, L0 = PM && PM.instLoyalty ? PM.instLoyalty('ss') : null;
    window.__pv5 = { det: det, before: refs.slice(), books0: det._svc ? det._svc.books : null, L0: L0 };
    CBZ.cityKillPed(q, { byPlayer: true, attacker: CBZ.player, fromX: CBZ.player.pos.x, fromZ: CBZ.player.pos.z }, 'shot');
    return { n0: refs.length, books0: window.__pv5.books0, L0: L0, dead: !!q.dead };
  })())`));
  if (r5a.err) chk(false, r5a.err);
  else {
    for (let s = 0; s < 30; s++) await step(60);
    const r5 = JSON.parse(await t.evl(`JSON.stringify((function(){
      var W = window.__pv5, det = W.det, P = CBZ.player;
      var now = det.memberPedRefs.filter(function (q) { return q && !q.dead; });
      var fresh = now.filter(function (q) { return W.before.indexOf(q) < 0; });
      var PM = CBZ.politics;
      return { n: now.length, fresh: fresh.length, near: fresh.filter(function (q) { return Math.hypot(q.pos.x - P.pos.x, q.pos.z - P.pos.z) < 40; }).length,
        books: det._svc ? det._svc.books : null, L1: PM && PM.instLoyalty ? PM.instLoyalty('ss') : null };
    })())`));
    chk(r5a.dead, "the agent you shot is down");
    chk(r5.fresh === 0, `30 s on, no replacement has appeared (${r5.fresh} new, ${r5.near} within 40 m of you); ${r5.n} of ${r5a.n0} left`);
    chk(r5.books != null && r5a.books0 != null && r5.books === r5a.books0 - 1, `he is off the Service's roster (${r5a.books0} -> ${r5.books})`);
    if (r5a.L0 != null) chk(r5.L1 < r5a.L0, `the Secret Service's loyalty takes it (${(+r5a.L0).toFixed(1)} -> ${(+r5.L1).toFixed(1)})`);
  }

  const errs = [...new Set(t.errors())].filter((e) => /president|presidency|protection|motorcade|warroom|statecraft|interactions|verbwheel|orders|campaign_ui/.test(e));
  if (errs.length) { bad++; t.log("page errors:"); for (const e of errs.slice(0, 8)) t.log("  " + e); }
  return { ok: !bad, summary: `PRESIDENT-VERBS: ${bad ? "FAIL" : "OK"}  ${seen.length} roles, ${fired.length} verbs fired, ${Object.keys(asked).length} speakers` };
}
