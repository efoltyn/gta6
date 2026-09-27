/* ============================================================
   city/agency.js — THE BUREAU ARC. The hitman game gets a plot.

   OWNER (2026-09-27): "just trying to make the hitman game cooler. Look
   cooler. Plot seem cooler. Because it's a cool thing... like an eventual
   CIA goal to kill a big guy." And, mid-wave: the big guy is a DICTATOR,
   in his palace, with a real detail, a motorcade and public appearances you
   can scout. Fictional man, fictional country.

   THE ARC, AS PLAYED
     street   hitman.js's wall of marks. A clean street contract (or two of
              any kind) gets you NOTICED: an unknown number texts a place.
     meet 1   a parking lot after dark, one sodium lamp, a black car. VOSS,
              the Bureau's man. Short, cold lines. The President cancels the
              election the same morning (regimes.js flips the republic to
              dictatorship, so the Mansion dresses itself for it through
              president_regime.js). He hands you three files.
     LEDGER   Teodor Brandt, the President's banker. Office steps, the same
              cafe table, the bank run. One bodyguard. A vial for his cup.
     CARGO    Casimir Dranov, arms broker to the Presidential Guard. Arrives
              by car, inspects stock, drinks, leaves. Three guards. A charge
              for his car.
     BLACK BOOK  General Ruben Varga, chief of the Presidential Guard, at his
              own checkpoint. Four men and two sentries. He carries the
              President's week in a black book. Take it off his body. In the
              back of it: a Bureau cable. "Asset to be retired on completion."
     meet 2   same lot. Voss wants the book. You choose: TAKE THE JOB, or
              KILL VOSS NOW.
     THE PRESIDENT  the head of state govcomplex.js already posts at the
              Executive Mansion, walked through a real loop by this file:
              the residence door, the address from the Mansion steps to a
              crowd on the lawn, the motorcade out of the gate and back.
              Long shot through the gate, his car, his detail's uniform, or
              loud. Then the Bureau's extraction, which is the burn.
     endings  DENIABLE (you survive the burn and Voss does not) or THE
              PRESIDENT'S MAN (you killed Voss and the palace pays you).

   HOW A CONTRACT PLAYS (the Hitman grammar, on systems that exist)
     the mark      a named ped this file casts, walked through a ROUTINE of
                   real places (lots with real doors) on a real-seconds loop.
     his detail    power.js's ONE protector system (powerPrincipal). The ring
                   follows him, challenges you, fights for him.
     intel         NOTHING is a meter. A routine leg is "seen" when you watched
                   him at that place; a guard when you looked at him; an
                   approach when you stood where it happens. The dossier
                   shows the rest as redaction bars.
     the mark      no marker over his head until you have IDENTIFIED him (eyes
                   on, close, or through a scope).
     approaches    poison (his cup), car charge (his car), the long shot
                   (distance at the kill), disguise (a guard's clothes via
                   outfits.js's corpse swap, which this file teaches the
                   detail to trust), loud.
     the score     CLEAN / PROFESSIONAL / LOUD / MESSY / MASSACRE, priced off
                   what actually happened (who else died, whether anyone was
                   alarmed, stars at the kill). Clean pays half again.

   WHAT IT REUSES (no second system):
     missions  core/mission.js (stages, waypoint, phone card, pay)
     photos    city/mugshot.js       dialogue  city/campaign_ui.js say/choice
     camera    city/cinematics.js    detail    city/power.js
     regime    city/regimes.js       dress     city/president_regime.js
     the seat  city/govcomplex.js (site.actor at the Executive Mansion)
     cars      vehicles.js cityAddParkedCar (never edited)
     blasts    cityExplosion         disguise  outfits.js corpse swap
   Presentation: city/dossier.js (the classified file, confirm card,
   letterbox, ending card, FILE button).

   Start it: take and settle a contract off the motel wall (or the Crime tab
   in activities). Debug: ?agency=meet1|ledger|cargo|book|meet2|finale
   jumps the arc (CBZ.agency.jump(step) from the console does the same).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.game) return;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

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
  function clock() {
    const h = CBZ.cityHour ? CBZ.cityHour() : 12;
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
  }
  function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function campaignOwns() { return !!(CBZ.cityCampaignOwnsMission && CBZ.cityCampaignOwnsMission()); }
  function isPresident() {
    if (g.cityOrigin === "president") return true;
    // heldByPlayer() answers with a LIST of the seats you hold (an empty
    // array is truthy); only the country's seat makes you the President.
    try {
      const held = CBZ.regimes && CBZ.regimes.heldByPlayer ? CBZ.regimes.heldByPlayer() : null;
      return !!(held && held.length && held.some(function (r) { return r && (r.kind === "country" || r.id === "republic"); }));
    } catch (e) { return false; }
  }

  // THE BUREAU TALKS ON THE PHONE. One sender name, the missions app.
  function text(body, from, urgent) {
    from = from || "THE BUREAU";
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "missions", from: from, text: body, priority: urgent ? 2 : 1 }); return; } catch (e) {} }
    if (CBZ.city && CBZ.city.note) CBZ.city.note(body, 3, { from: from, app: "missions" });
  }
  function news(body) {
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "news", from: "City Desk", text: body, priority: 1 }); return; } catch (e) {} }
    if (CBZ.cityFeed) CBZ.cityFeed(body, "#e6d8b0");
  }
  function say(speaker, line) {
    if (CBZ.campaignUI && CBZ.campaignUI.say) { try { CBZ.campaignUI.say(speaker, line); return; } catch (e) {} }
    if (CBZ.flashHint) CBZ.flashHint(speaker + ": " + line, 3);
  }
  function clearSay() { if (CBZ.campaignUI && CBZ.campaignUI.clearDialogue) { try { CBZ.campaignUI.clearDialogue(); } catch (e) {} } }
  function bark(ped, line, secs) { if (ped && CBZ.citySay) { try { CBZ.citySay(ped, line, "#e8e2d4", secs || 2.6); } catch (e) {} } }
  function D() { return CBZ.dossier || null; }

  /* ================================================================
     §2  THE ARC STATE — plain data in the world ledger (saves with it)
     ================================================================ */
  const STEPS = ["street", "meet1", "ledger", "cargo", "book", "meet2", "finale", "exfil", "turned", "done"];
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
      R.arc = { step: "street", street: 0, clean: 0, lastStreet: null, lastQuiet: false,
        kit: { vial: 0, charge: 0 }, seen: {}, notes: {}, ratings: {}, book: false, choice: null, ending: null };
    }
    const a = R.arc;
    if (STEPS.indexOf(a.step) < 0) a.step = "street";
    a.kit = a.kit || { vial: 0, charge: 0 };
    a.seen = a.seen || {}; a.notes = a.notes || {}; a.ratings = a.ratings || {};
    return a;
  }
  function commit() { if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} } }
  function setStep(s) {
    const a = arc(); if (!a) return;
    if (a.step === s) return;
    a.step = s;
    commit();
    if (hitmanRepaint) hitmanRepaint();
  }
  let hitmanRepaint = null;
  function seenOf(opId) { const a = arc(); if (!a) return {}; return (a.seen[opId] = a.seen[opId] || { legs: {}, guards: 0, appr: {} }); }
  function noteOf(opId) { const a = arc(); if (!a) return []; return (a.notes[opId] = a.notes[opId] || []); }
  function addNote(opId, line) {
    const L = noteOf(opId);
    if (L.length && L[L.length - 1].indexOf(line) >= 0) return;
    L.push(clock() + "  " + line);
    if (L.length > 12) L.splice(0, L.length - 12);
    refreshFile();
  }

  /* ================================================================
     §3  THE CAST — fictional people, fixed names (no real person/country)
     ================================================================ */
  const HANDLER = "VOSS";
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
        { at: "office", dwell: 42, label: "Office steps", detail: "Takes his calls on the steps of {office}." },
        { at: "cafe", dwell: 38, label: "Coffee", detail: "Same table outside {cafe}. Orders, then walks off and leaves the cup.", prop: "cafe" },
        { at: "bank", dwell: 30, label: "Bank run", detail: "Carries the day's cash to {bank}." },
      ],
      security: "One bodyguard. Pistol. Stays close.",
      approaches: [
        { id: "poison", label: "Poison", detail: "His cup sits alone on the cafe table while he is away. One vial." },
        { id: "long", label: "Long shot", detail: "He stands still on the office steps. Sixty meters or more." },
        { id: "disguise", label: "His guard's clothes", detail: "A man in the guard's suit can stand next to him." },
        { id: "loud", label: "Loud", detail: "It works. It costs." },
      ],
      brief: [
        "Teodor Brandt moves the President's money. Every account the palace has passes through his hands.",
        "He keeps a routine. Office, coffee, bank. Watch it once before you touch him.",
        "One bodyguard. The cafe is the soft spot. The vial is in your kit.",
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
        { at: "car", dwell: 26, label: "The car", detail: "Black sedan at the curb by {shop}. He never lets it out of sight for long.", prop: "car" },
        { at: "shop", dwell: 40, label: "The buy", detail: "Inspects the order at {shop}." },
        { at: "club", dwell: 40, label: "Drinks", detail: "Celebrates at {club}. His men relax." },
      ],
      security: "Three guards. SMGs. One of them stays near the car.",
      approaches: [
        { id: "charge", label: "Car charge", detail: "Plant it while the car sits alone. It arms when his door closes." },
        { id: "long", label: "Long shot", detail: "He stands at the curb. Sixty meters or more." },
        { id: "disguise", label: "His guard's clothes", detail: "The guards know each other by the suit, not the face." },
        { id: "loud", label: "Loud", detail: "Three SMGs. Your call." },
      ],
      brief: [
        "Casimir Dranov sells the Presidential Guard its rifles. He is in town to close an order.",
        "He arrives by car, inspects the stock, drinks, and leaves. His car is the weak point.",
        "There is a charge in your kit.",
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
        { at: "checkpoint", dwell: 46, label: "Checkpoint", detail: "Inspects his own roadblock near {post}.", prop: "checkpoint" },
        { at: "post", dwell: 36, label: "Briefing", detail: "Stands outside {post} with his officers." },
        { at: "bar", dwell: 36, label: "Evening drink", detail: "A drink at {bar}. The book stays in his coat." },
      ],
      security: "Four men with rifles and two sentries at the roadblock.",
      approaches: [
        { id: "long", label: "Long shot", detail: "He stands in the open at the roadblock. Sixty meters or more." },
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
    security: "The Presidential detail. Rifles. Posted staff at the gate.",
    approaches: [
      { id: "long", label: "Long shot", detail: "The Mansion gate is twenty meters wide and lines up with the steps. He speaks there." },
      { id: "charge", label: "His car", detail: "The state car waits in the motor court between drives. It arms when his door closes." },
      { id: "disguise", label: "His detail's uniform", detail: "The detail trusts the uniform. Get one." },
      { id: "loud", label: "Loud", detail: "You will not walk out." },
    ],
    legs: [
      { at: "residence", dwell: 40, label: "The residence", detail: "At the Mansion's front door with his detail." },
      { at: "address", dwell: 38, label: "The address", detail: "Speaks from the top of the Mansion steps. A crowd on the lawn." },
      { at: "motorcade", dwell: 0, label: "The motorcade", detail: "Three cars out of the motor court, through the gate, down the road and back." },
    ],
  };

  /* ================================================================
     §4  PLACES
     ================================================================ */
  function doorOf(lot) { return lot && lot.building && lot.building.door; }
  // outward from the building, measured, never assumed (the repo disagrees
  // with itself about which way door.nx points).
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
    if (b && b.name) return String(b.name);
    const K = { bank: "the bank", office: "the office block", tower: "the tower", food: "the diner", club: "the club",
      casino: "the casino", guns: "the gun shop", security: "the security depot", carlot: "the car lot", shop: "the shop",
      cityhall: "City Hall" };
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
    let pool = lotsOfKinds(kinds).filter(function (l) {
      const d = d2(l.cx, l.cz, cx, cz);
      return d >= minD && d <= maxD && (!avoid || avoid.indexOf(l) < 0);
    });
    if (!pool.length) pool = lotsOfKinds(null).filter(function (l) {
      const d = d2(l.cx, l.cz, cx, cz);
      return d >= minD * 0.5 && d <= maxD * 1.6 && (!avoid || avoid.indexOf(l) < 0);
    });
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
  function mansion() {
    const S = CBZ.govComplexes || [];
    for (let i = 0; i < S.length; i++) if (S[i] && S[i].rect && (S[i].id === "execmansion" || (S[i].def && S[i].def.id === "execmansion"))) return S[i];
    return null;
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
    } catch (e) { p = null; }
    if (!p) return null;
    p.pos.y = floorY(x, z);
    AR.root.add(p.group);
    (CBZ.cityPeds || (CBZ.cityPeds = [])).push(p);
    p.name = name; p.nameKnown = !!opts.named;
    p._agency = true;
    p._campaignTarget = true;            // the shared "spoken for" stamp — scene casting and street binders skip it
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
    }
    p._agency = false; p._campaignTarget = false;
  }
  function hostile(p) {
    if (!p || p.dead) return;
    p.staffPost = null; p.controlled = false;
    const PA = CBZ.city && CBZ.city.playerActor;
    if (PA) { p.rage = PA; p.state = "fight"; p.pause = 0; p.aggr = Math.max(p.aggr || 0, 0.95); }
  }
  // walk a body to a point: two hops through the nearest junction when far,
  // exactly pickRoutineGoal's route shape, then let peds.js's mover and
  // pednav do the walking. controlled = the brain keeps its hands off.
  function walkTo(p, x, z, run) {
    if (!p || p.dead) return;
    const AR = A();
    p.controlled = true; p.staffPost = null;
    const goal = { x: x, z: z };
    const far = d2(p.pos.x, p.pos.z, x, z);
    if (AR && AR.nearestIntersection && AR.step && far > AR.step * 0.9) {
      const it = AR.nearestIntersection(x, z);
      // only a junction that actually lies between here and there (the
      // Mansion is kilometres from any city junction)
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
     §6  PROPS (cheap: shared materials, no lights — an r128 light-count
     change recompiles every material in the city)
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
      if (n.material && !n.material._shared && n.material.dispose) { if (n.material.map) n.material.map.dispose(); n.material.dispose(); }
    });
  }
  function mesh(grp, g0, m, x, y, z) { const o = new THREE.Mesh(g0, m); o.position.set(x, y, z); grp.add(o); return o; }
  // a bistro standing table with the cup on it
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
  // a regime roadblock: sandbag walls and a striped barrier arm (no sign)
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
    const arm = mesh(grp, geo("bararm", function () { return new THREE.BoxGeometry(4.6, 0.12, 0.12); }), mat(0xc9c3b0), 0, 0.95, 0);
    for (let i = 0; i < 4; i++) mesh(grp, geo("barred", function () { return new THREE.BoxGeometry(0.55, 0.13, 0.13); }), mat(0xa3272a), -1.7 + i * 1.15, 0.95, 0);
    void arm;
    return grp;
  }
  // the meeting lamp: a sodium head, a fake light cone and a warm pool on the
  // ground, all additive, no real light (see the header of this section)
  let poolTex = null;
  function poolTexture() {
    if (poolTex) return poolTex;
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const cc = c.getContext("2d");
    const gr = cc.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,190,110,0.85)"); gr.addColorStop(0.45, "rgba(255,160,80,0.32)"); gr.addColorStop(1, "rgba(255,140,60,0)");
    cc.fillStyle = gr; cc.fillRect(0, 0, 128, 128);
    poolTex = new THREE.CanvasTexture(c);
    return poolTex;
  }
  function buildLamp(x, z) {
    const grp = propGroup(x, z, 0);
    mesh(grp, geo("lamppole", function () { return new THREE.CylinderGeometry(0.08, 0.11, 6.2, 8); }), mat(0x1d1f22), 0, 3.1, 0);
    mesh(grp, geo("lamparm", function () { return new THREE.BoxGeometry(1.4, 0.1, 0.12); }), mat(0x1d1f22), 0.62, 6.1, 0);
    mesh(grp, geo("lamphead", function () { return new THREE.BoxGeometry(0.6, 0.14, 0.34); }), mat(0xffc27a, true), 1.2, 6.0, 0);
    const coneM = new THREE.MeshBasicMaterial({ color: 0xffb46b, transparent: true, opacity: 0.075, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const cone = mesh(grp, new THREE.ConeGeometry(2.9, 5.8, 20, 1, true), coneM, 1.2, 3.05, 0);
    void cone;
    const poolM = new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    poolM.map._shared = true;
    const pool = mesh(grp, new THREE.PlaneGeometry(9, 9), poolM, 1.2, 0.04, 0);
    pool.rotation.x = -Math.PI / 2;
    return grp;
  }
  // the black book on the General's body
  function buildBook(x, z) {
    const grp = propGroup(x, z, h01(x, z, 3) * 6.28);
    mesh(grp, geo("book", function () { return new THREE.BoxGeometry(0.2, 0.035, 0.28); }), mat(0x0d0d0f), 0, 0.03, 0);
    mesh(grp, geo("bookband", function () { return new THREE.BoxGeometry(0.205, 0.037, 0.02); }), mat(0x6b1a17), 0, 0.03, 0.1);
    return grp;
  }

  /* the ID mark: a small red chevron over an IDENTIFIED mark. One mesh. */
  let chevron = null;
  function chevronMesh() {
    if (chevron && chevron.parent) return chevron;
    const AR = A(); if (!AR || !AR.root) return null;
    const m = new THREE.MeshBasicMaterial({ color: 0xd8322a, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
    chevron = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 4), m);
    chevron.rotation.x = Math.PI;
    chevron.renderOrder = 999;
    chevron.userData.transient = true; chevron.userData.dynamic = true;
    AR.root.add(chevron);
    return chevron;
  }
  function hideChevron() { if (chevron) chevron.visible = false; }

  /* ================================================================
     §7  EYES — intel is what you actually saw
     ================================================================ */
  const _v = new THREE.Vector3(), _dir = new THREE.Vector3();
  function scoped() { try { return !!(CBZ.fpsScoped && CBZ.fpsScoped()); } catch (e) { return false; } }
  // can the player see this point? view cone from the real camera, range by
  // whether he is looking down a scope. No LOS raycast: a cheap honest cone.
  function sees(x, y, z, range, cosMin) {
    const cam = CBZ.camera; if (!cam) return false;
    cam.getWorldDirection(_dir);
    _v.set(x - cam.position.x, y - cam.position.y, z - cam.position.z);
    const d = _v.length(); if (d > range || d < 0.01) return false;
    return (_v.dot(_dir) / d) >= cosMin;
  }
  function seesPed(p, loose) {
    if (!p || !p.pos || (p.group && !p.group.visible)) return false;
    const y = p.pos.y + 1.5;
    if (scoped() && sees(p.pos.x, y, p.pos.z, 320, 0.992)) return true;
    return sees(p.pos.x, y, p.pos.z, loose ? 75 : 34, loose ? 0.8 : 0.86);
  }

  /* ================================================================
     §8  THE OPERATION RUNTIME
     ================================================================ */
  const RT = { op: null, meet: null, fin: null, endT: 0, killWatch: null };

  function opDef(id) { return id === "finale" ? FINALE : OPS[id]; }

  // choose (once, saved) where this op happens
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
      if (!lot) return null;
      out[v.key] = lot; used.push(lot); keys[v.key] = lotKey(lot);
    }
    a.venues[def.id] = keys;
    commit();
    return out;
  }
  function fillText(s, V) {
    return String(s).replace(/\{(\w+)\}/g, function (_, k) { return V[k] ? lotName(V[k]) : "the place"; });
  }

  function buildOp(id) {
    const def = OPS[id]; if (!def) return null;
    const V = opVenues(def); if (!V) return null;
    const op = {
      id: id, def: def, V: V, legs: [], leg: 0, phase: "walk", t: 0, stuckT: 0, lastD: Infinity,
      ped: null, guards: [], sentries: [], props: [], car: null, charge: false, poisoned: false,
      identified: false, idT: 0, alarm: 0, everAlarm: false, seenGuards: [],
      kills: { civ: 0, guard: 0 }, accident: null, dead: false, killPt: null, rating: null, pay: def.pay,
      drank: 0, book: null, bookTaken: false, mission: null, fleeT: 0,
    };
    // legs -> world points
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
      op.legs.push({ def: L, x: pt.x, z: pt.z, face: pt.face, label: L.label, detail: fillText(L.detail, V) });
    }
    return op;
  }

  // bring the op's bodies and props into the world (idempotent)
  function stageOp(op) {
    if (op.staged) return;
    op.staged = true;
    const def = op.def;
    const first = op.legs[0];
    // props
    for (let i = 0; i < op.legs.length; i++) {
      const L = op.legs[i];
      if (L.def.prop === "cafe") { op.cafe = buildCafe(L.x + Math.sin(L.face) * 0.6, L.z + Math.cos(L.face) * 0.6, L.face); op.cafePt = { x: L.x + Math.sin(L.face) * 0.6, z: L.z + Math.cos(L.face) * 0.6 }; op.props.push(op.cafe); }
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
    // the mark
    const p = spawn(def.name, first.x, first.z, { job: def.job, gender: def.gender, archetype: "official", wealth: 0.9, named: true, face: first.face });
    if (!p) return;
    op.ped = p; p._agencyOp = op.id; p._agencyMark = true;
    p.controlled = true;
    if (CBZ.powerPrincipal) {
      try { CBZ.powerPrincipal(p, { tier: def.tier, org: "detail:" + op.id, lawful: false, role: def.role.split(".")[0] }); } catch (e) {}
    }
    holdAt(p, first.face);
    op.phase = "dwell"; op.t = 0;
    // the photo, taken once
    if (CBZ.cityMugshot) { try { op.photo = CBZ.cityMugshot({ ped: p }) || ""; } catch (e) { op.photo = ""; } }
    if (CBZ.cityMugshotWearing) { try { op.wearing = CBZ.cityMugshotWearing({ ped: p }) || null; } catch (e) {} }
  }

  function teardownOp(op) {
    if (!op) return;
    for (let i = 0; i < op.props.length; i++) killGroup(op.props[i]);
    op.props.length = 0;
    if (op.book) { killGroup(op.book); op.book = null; }
    if (op.ped) {
      if (CBZ.powerDissolve) { try { CBZ.powerDissolve(op.ped); } catch (e) {} }
      if (!op.ped.dead) despawn(op.ped);
      else { op.ped._agency = false; }
    }
    for (let i = 0; i < op.sentries.length; i++) if (op.sentries[i] && !op.sentries[i].dead) despawn(op.sentries[i]);
    op.sentries.length = 0;
    hideChevron();
  }

  function guardsOf(op) {
    let G = [];
    if (op.ped && CBZ.powerGuardsOf) { try { G = CBZ.powerGuardsOf(op.ped); } catch (e) { G = []; } }
    for (let i = 0; i < op.sentries.length; i++) G.push(op.sentries[i]);
    return G;
  }

  function currentLeg(op) { return op.legs[op.leg] || op.legs[0]; }

  // THE ROUTINE — real seconds, a loop of places.
  function tickRoutine(op, dt) {
    const p = op.ped; if (!p || p.dead) return;
    if (op.alarm > 0) return;
    const L = currentLeg(op);
    if (op.phase === "walk") {
      const d = d2(p.pos.x, p.pos.z, L.x, L.z);
      if (d < 1.3) { op.phase = "dwell"; op.t = 0; holdAt(p, L.face); return; }
      // stuck: a body that has not closed a metre in eight seconds is moved
      // to its mark, but only while nobody is watching (the Truman rule)
      op.stuckT += dt;
      if (op.lastD - d > 1) { op.lastD = d; op.stuckT = 0; }
      if (op.stuckT > 8) {
        op.stuckT = 0; op.lastD = Infinity;
        if (!seesPed(p, true) && distP(p.pos.x, p.pos.z) > 40) { place(p, L.x, L.z); op.phase = "dwell"; op.t = 0; holdAt(p, L.face); }
        else walkTo(p, L.x, L.z);
      }
      if (p.state !== "walk" && p.state !== "flee") { p.state = "walk"; p.pause = 0; }
      return;
    }
    // dwell
    op.t += dt;
    if (p.state !== "idle") holdAt(p, L.face);
    onDwell(op, L, dt);
    if (op.t >= (L.def.dwell || 30)) {
      op.leg = (op.leg + 1) % op.legs.length;
      const N = currentLeg(op);
      op.phase = "walk"; op.t = 0; op.stuckT = 0; op.lastD = Infinity;
      walkTo(p, N.x, N.z);
    }
  }

  function onDwell(op, L, dt) {
    const p = op.ped;
    // the cup: he drinks a few seconds in
    if (L.def.prop === "cafe") {
      if (op.t > 5 && op.t - dt <= 5) { if (op.poisoned) bark(p, "Hm.", 1.6); }
      if (op.poisoned && op.t > 9 && !op.dead) {
        op.accident = "poison";
        accidentKill(op, p, "poison", "Collapsed at a cafe table. Heart failure, the paper says.");
      }
    }
    // the car: the door closes, the charge arms
    if (L.def.prop === "car" && op.car && !op.car.dead) {
      if (op.charge && op.t > 3 && !op.dead) {
        op.accident = "charge";
        carBomb(op, op.car, p);
      }
    }
  }

  function accidentKill(op, p, cause, line) {
    if (!p || p.dead) return;
    p.killedBy = { name: cause === "poison" ? "Heart failure" : "A car bomb", isPlayer: false };
    const w0 = g.wanted | 0, h0 = g.heat || 0;
    RT.killWatch = { op: op, t: now() + 800, noCount: true };
    try { CBZ.cityKillPed(p, { byPlayer: false, noCrime: true }, cause); } catch (e) {}
    // an officeholder's death charges max heat unconditionally (officials.js);
    // nobody saw you, so the manhunt has no face to hunt. Put it back.
    if (cause === "poison" && (g.wanted | 0) > w0) { g.wanted = w0; g.heat = h0; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
    if (line) addNote(op.id, line);
  }

  function carBomb(op, car, victim) {
    if (!car || car._agencyBoom) return;
    car._agencyBoom = true;
    const x = car.pos.x, z = car.pos.z;
    if (victim && !victim.dead) victim.killedBy = { name: "A car bomb", isPlayer: false };
    RT.killWatch = { op: op, t: now() + 1200, blast: true };
    try { if (CBZ.cityExplosion) CBZ.cityExplosion(x, z, { power: 1.5, radius: 6, byPlayer: false }); } catch (e) {}
    try { if (CBZ.cityDamageCar) CBZ.cityDamageCar(car, 9999); } catch (e) {}
    try { if (CBZ.cityCarIgnite) CBZ.cityCarIgnite(car); } catch (e) {}
    car.dead = true;
    if (victim && !victim.dead) { try { CBZ.cityKillPed(victim, { byPlayer: false, noCrime: true }, "explosion"); } catch (e) {} }
    addNote(op.id, "The car went up at the curb.");
  }

  // ALARM: hurt, a guard down or fighting, or a manhunt next to him
  function tickAlarm(op, dt) {
    const p = op.ped; if (!p || p.dead) return;
    const pl = P(); if (!pl || !pl.pos) return;
    let why = null;
    if (p.hp != null && p.maxHp != null && p.hp < p.maxHp - 1) why = "hurt";
    const G = guardsOf(op);
    for (let i = 0; i < G.length && !why; i++) {
      const q = G[i]; if (!q) continue;
      if (q.dead) { if (!q._agencyCounted) { q._agencyCounted = true; } why = "guard"; break; }
      if (q.rage && (q.rage === (CBZ.city && CBZ.city.playerActor)) && q.state === "fight") why = "guard";
    }
    const dp = d2(p.pos.x, p.pos.z, pl.pos.x, pl.pos.z);
    if (!why && (g.wanted | 0) >= 2 && dp < 70) why = "heat";
    if (why) {
      if (!op.alarm) {
        op.everAlarm = true;
        addNote(op.id, why === "heat" ? "He heard the sirens and ran." : "His detail went hot. He ran.");
        for (let i = 0; i < op.sentries.length; i++) hostile(op.sentries[i]);
        bark(p, "Get me out of here!", 2);
      }
      op.alarm = 40;
      // run for the first place on his loop: he knows it
      const home = op.legs[0];
      if (p.controlled || p.state !== "flee") { walkTo(p, home.x, home.z, true); }
      return;
    }
    if (op.alarm > 0) {
      op.alarm -= dt;
      const home = op.legs[0];
      if (d2(p.pos.x, p.pos.z, home.x, home.z) < 2) holdAt(p, home.face);
      if (op.alarm <= 0 && dp > 45) {
        op.alarm = 0;
        op.leg = 0; op.phase = "dwell"; op.t = 0;
        addNote(op.id, "He is back on his routine. Nervous.");
      } else if (op.alarm <= 0) op.alarm = 5;
    }
  }

  // intel: identification, routine legs seen, guards seen, approaches known
  function tickIntel(op, dt) {
    const p = op.ped; if (!p || p.dead) return;
    const S = seenOf(op.id);
    const vis = seesPed(p, false), far = vis || seesPed(p, true);
    if (!op.identified) {
      if (vis) op.idT += dt;
      if (op.idT > (scoped() ? 0.5 : 1.1)) {
        op.identified = true;
        S.id = true;
        addNote(op.id, "Eyes on " + op.def.name + ". Identified.");
        if (op.mission && op.mission.alive && op.mission.alive() && op.mission.stageId() === "find") op.mission.advance();
        refreshFile(true);
      }
    }
    if (far && op.phase === "dwell") {
      const k = String(op.leg);
      if (!S.legs[k]) {
        S.legs[k] = true;
        const L = currentLeg(op);
        addNote(op.id, L.label + ": " + L.detail);
        if (L.def.prop === "cafe") knowAppr(op, "poison");
        if (L.def.prop === "car") knowAppr(op, "charge");
      }
      // a long, clear line to him while he stands still: that is the perch
      if (!S.appr.long && distP(p.pos.x, p.pos.z) > 60 && seesPed(p, true)) { knowAppr(op, "long", "Clear line from here. " + Math.round(distP(p.pos.x, p.pos.z)) + " m."); }
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
    // you stood where it happens
    if (op.cafePt && distP(op.cafePt.x, op.cafePt.z) < 10) knowAppr(op, "poison");
    if (op.car && !op.car.dead && distP(op.car.pos.x, op.car.pos.z) < 12) knowAppr(op, "charge");
  }
  function knowAppr(op, id, line) {
    const S = seenOf(op.id);
    if (S.appr[id]) return;
    S.appr[id] = true;
    const a = (op.def.approaches || []).find(function (x) { return x.id === id; });
    addNote(op.id, line || (a ? ("Approach: " + a.label.toLowerCase() + ".") : ""));
  }

  // THE STOLEN SUIT. outfits.js's corpse swap stamps the claim from the
  // body's TRUE role, and a private guard's org reads null, so a detail
  // would never trust its own suit. When the suit came off THIS detail, the
  // claim is this detail's org: power.js's reaction then reads you as one of
  // his (cityDisguiseTrust(rec.org)) through the path it already has.
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
        addNote(op.id, "Wearing his detail's colors. They will let you close.");
        knowAppr(op, "disguise");
      }
    }
  }

  /* ---- the kill ---- */
  function onMarkDead(op) {
    if (op.dead) return;
    op.dead = true;
    const p = op.ped;
    const pl = P();
    op.killPt = { x: p.pos.x, z: p.pos.z };
    const dist = pl && pl.pos ? d2(pl.pos.x, pl.pos.z, p.pos.x, p.pos.z) : 0;
    const wanted = g.wanted | 0;
    const silent = !op.everAlarm && wanted === 0;
    const civ = op.kills.civ | 0, gk = op.kills.guard | 0;
    let rating, mul;
    if (civ >= 3) { rating = "MASSACRE"; mul = 0.5; }
    else if (civ > 0) { rating = "MESSY"; mul = 0.8; }
    else if ((silent || op.accident) && gk === 0) { rating = "CLEAN"; mul = 1.5; }
    else if (gk <= 2 && wanted <= 1) { rating = "PROFESSIONAL"; mul = 1.15; }
    else { rating = "LOUD"; mul = 1; }
    op.rating = rating;
    op.pay = Math.round(op.def.pay * mul / 50) * 50;
    const lines = [];
    if (op.accident === "poison") lines.push("Poison. Looked like his heart");
    else if (op.accident === "charge") lines.push("Car charge");
    else if (dist > 60) lines.push("Long shot, " + Math.round(dist) + " m");
    else if (g.cityWornOutfit && g.cityWornOutfit._claimOrg && String(g.cityWornOutfit._claimOrg).indexOf("detail:") === 0) lines.push("In his detail's clothes");
    lines.push(silent || op.accident ? "Nobody raised the alarm" : "The alarm went up");
    lines.push(civ === 0 ? "No civilians" : (civ + " civilian" + (civ === 1 ? "" : "s") + " dead"));
    lines.push(gk === 0 ? "Only the target" : (gk + " of his men down"));
    const a = arc(); if (a) { a.ratings[op.id] = rating; commit(); }
    addNote(op.id, "Confirmed. " + rating + ".");
    if (op.mission && op.mission.def) op.mission.def.reward = { cash: op.pay, notoriety: 40 };
    // the book falls with the General
    if (op.id === "book" && !op.book) {
      op.book = buildBook(op.killPt.x + 0.6, op.killPt.z + 0.3);
      op.bookPt = { x: op.killPt.x + 0.6, z: op.killPt.z + 0.3 };
      text("The book is on him. Take it.", "THE BUREAU");
    }
    killCam(p, function () {
      const Dz = D();
      if (Dz && Dz.confirm) { try { Dz.confirm({ codename: op.def.codename, name: op.def.name || (p && p.name), photo: op.photo || "", rating: rating, lines: lines, pay: op.pay }); } catch (e) {} }
    });
    refreshFile(true);
  }

  // THE CONFIRM MOMENT: slow the world, drop the bars, two shots on the body
  function killCam(p, after) {
    const Dz = D();
    const pl = P();
    const canCine = CBZ.cinePlay && !(CBZ.cineBusy && CBZ.cineBusy()) && pl && !pl.driving && !pl._vehicle && !pl._aircraft && p && p.pos;
    if (CBZ.doSlowmo) { try { CBZ.doSlowmo(0.7); } catch (e) {} }
    if (!canCine) { if (after) after(); return; }
    const bx = p.pos.x, by = p.pos.y, bz = p.pos.z;
    const ax = pl.pos.x - bx, az = pl.pos.z - bz;
    const am = Math.hypot(ax, az) || 1;
    const ux = ax / am, uz = az / am, sx = -uz, sz = ux;
    if (Dz && Dz.letterbox) Dz.letterbox(true);
    const ok = CBZ.cinePlay([
      { cut: true, dur: 0.75, cam: { pos: { x: bx + sx * 2.2 + ux * 0.8, y: by + 0.55, z: bz + sz * 2.2 + uz * 0.8 }, look: { x: bx, y: by + 0.35, z: bz } } },
      { cut: true, dur: 0.9, cam: { pos: { x: bx - sx * 3.5 + ux * 4, y: by + 4.2, z: bz - sz * 3.5 + uz * 4 }, look: { x: bx, y: by + 0.2, z: bz } } },
    ], {}, function () {
      if (Dz && Dz.letterbox) Dz.letterbox(false);
      if (after) after();
    }, { noHolster: true });
    if (!ok) { if (Dz && Dz.letterbox) Dz.letterbox(false); if (after) after(); }
  }

  /* ---- the zones (interactions.js registry: one verb each, no popup) ---- */
  let zonesWired = false;
  function wireZones() {
    const I = CBZ.interactions;
    if (zonesWired || !I || !I.registerZone) return;
    zonesWired = true;
    if (I.describe) {
      try {
        I.describe("agencycup", function () { return { label: "His cup", note: "Still warm" }; });
        I.describe("agencycar", function () { return { label: "His car", note: "Nobody inside" }; });
        I.describe("agencybook", function () { return { label: "The black book", note: "Leather, a red band" }; });
      } catch (e) {}
    }
    const cupTok = { x: 0, z: 0, kind: "agencycup" };
    I.registerZone({
      id: "agency-cup", kind: "agencycup", radius: 1.8, prio: 15,
      find: function (px, pz) {
        const op = RT.op;
        if (!op || op.dead || !op.cafePt || op.poisoned || !playing()) return null;
        const a = arc(); if (!a || (a.kit.vial | 0) <= 0) return null;
        cupTok.x = op.cafePt.x; cupTok.z = op.cafePt.z;
        return d2(px, pz, cupTok.x, cupTok.z) < 1.8 ? cupTok : null;
      },
      options: [{
        id: "agency-cup-poison", slot: "e",
        label: function () { return "Poison the cup"; },
        onSelect: function () {
          const op = RT.op; const a = arc(); if (!op || !a) return;
          const p = op.ped;
          if (p && !p.dead && d2(p.pos.x, p.pos.z, op.cafePt.x, op.cafePt.z) < 7) { if (CBZ.city && CBZ.city.note) CBZ.city.note("Not with him standing there.", 2); return; }
          const G = guardsOf(op);
          for (let i = 0; i < G.length; i++) {
            const q = G[i];
            if (q && !q.dead && d2(q.pos.x, q.pos.z, op.cafePt.x, op.cafePt.z) < 8) { if (CBZ.city && CBZ.city.note) CBZ.city.note("His guard is watching the table.", 2); return; }
          }
          a.kit.vial = Math.max(0, (a.kit.vial | 0) - 1);
          op.poisoned = true; commit();
          knowAppr(op, "poison");
          addNote(op.id, "The vial is in his cup.");
          if (CBZ.city && CBZ.city.note) CBZ.city.note("Done. Walk away.", 2);
        },
      }],
    });
    const carTok = { x: 0, z: 0, kind: "agencycar" };
    I.registerZone({
      id: "agency-car", kind: "agencycar", radius: 2.6, prio: 15,
      find: function (px, pz) {
        if (!playing()) return null;
        const a = arc(); if (!a || (a.kit.charge | 0) <= 0) return null;
        const c = chargeCar(); if (!c) return null;
        carTok.x = c.pos.x; carTok.z = c.pos.z;
        return d2(px, pz, carTok.x, carTok.z) < 2.9 ? carTok : null;
      },
      options: [{
        id: "agency-car-charge", slot: "e",
        label: function () { return "Plant the charge"; },
        onSelect: function () {
          const a = arc(); const c = chargeCar(); if (!a || !c) return;
          const who = chargeWatcher(c);
          if (who) { if (CBZ.city && CBZ.city.note) CBZ.city.note("Not while he is watching the car.", 2); return; }
          a.kit.charge = Math.max(0, (a.kit.charge | 0) - 1);
          c._agencyCharged = true;
          if (RT.op && c === RT.op.car) { RT.op.charge = true; knowAppr(RT.op, "charge"); addNote(RT.op.id, "Charge under the driver's seat. It arms when his door closes."); }
          if (RT.fin && c === RT.fin.stateCar) { RT.fin.charge = true; finNote("Charge under the state car. It arms when his door closes."); }
          commit();
          if (CBZ.city && CBZ.city.note) CBZ.city.note("Armed. It goes when his door closes.", 2.4);
        },
      }],
    });
    const bookTok = { x: 0, z: 0, kind: "agencybook" };
    I.registerZone({
      id: "agency-book", kind: "agencybook", radius: 2.0, prio: 16,
      find: function (px, pz) {
        const op = RT.op;
        if (!op || op.id !== "book" || !op.book || op.bookTaken || !playing()) return null;
        bookTok.x = op.bookPt.x; bookTok.z = op.bookPt.z;
        return d2(px, pz, bookTok.x, bookTok.z) < 2.0 ? bookTok : null;
      },
      options: [{
        id: "agency-book-take", slot: "e",
        label: function () { return "Take the book"; },
        onSelect: function () { takeBook(); },
      }],
    });
  }
  // which car can take a charge right now
  function chargeCar() {
    const op = RT.op;
    if (op && op.car && !op.car.dead && !op.charge && !op.dead) return op.car;
    const F = RT.fin;
    if (F && F.stateCar && !F.stateCar.dead && !F.charge && !F.dead && F.phase !== "convoy") return F.stateCar;
    return null;
  }
  function chargeWatcher(car) {
    const pools = [];
    if (RT.op && RT.op.ped) { pools.push(RT.op.ped); guardsOf(RT.op).forEach(function (q) { pools.push(q); }); }
    if (RT.fin && RT.fin.ped) { pools.push(RT.fin.ped); finGuards().forEach(function (q) { pools.push(q); }); if (RT.fin.chauffeur) pools.push(RT.fin.chauffeur); }
    const disguised = !!(g.cityWornOutfit && g.cityWornOutfit._claimOrg && String(g.cityWornOutfit._claimOrg).indexOf("detail:") === 0);
    for (let i = 0; i < pools.length; i++) {
      const q = pools[i];
      if (!q || q.dead || !q.pos || (q.group && !q.group.visible)) continue;
      if (d2(q.pos.x, q.pos.z, car.pos.x, car.pos.z) < (disguised ? 3 : 9)) return q;
    }
    return null;
  }

  function takeBook() {
    const op = RT.op; const a = arc(); if (!op || !a || op.bookTaken) return;
    op.bookTaken = true; a.book = true;
    if (op.book) { killGroup(op.book); op.book = null; }
    commit();
    addNote("book", "The black book. The President's week, in Varga's hand.");
    addNote("book", "A loose page in the back. A Bureau cable: ASSET TO BE RETIRED ON COMPLETION. NO RECORD. V.");
    if (CBZ.city && CBZ.city.note) CBZ.city.note("The President's week. And a cable in the back with your file number on it.", 3.4);
    refreshFile(true);
    const Dz = D(); if (Dz && Dz.open) Dz.open(bookFile());
  }

  /* ---- the op mission (core/mission.js) ---- */
  function startOpMission(op) {
    const M = CBZ.mission; if (!M || !M.start) return null;
    const def = op.def;
    const m = M.start({
      id: "agency-op-" + op.id,
      title: "OPERATION " + def.codename,
      giver: "THE BUREAU",
      offerText: "File " + def.fileNo + ": " + def.name + ".",
      targetName: def.name,
      brief: def.brief[0],
      photo: op.photo || "",
      facts: [{ k: "ROLE", v: def.role }, { k: "FILE", v: def.fileNo + " of 4" }].concat(op.wearing ? [{ k: "WEARING", v: op.wearing }] : []),
      reward: { cash: def.pay, notoriety: 40 },
      color: 0xd8322a,
      stages: [
        { id: "find", goal: "custom", text: "Find " + def.name + ". Watch his routine.", label: "LAST KNOWN", marker: "none",
          at: function () { const L = op.identified ? null : currentLeg(op); return L ? { x: L.x, z: L.z } : (op.ped || null); },
          done: function () { return op.identified || op.dead; } },
        { id: "kill", goal: "custom", text: "Eliminate " + def.name + ". Quiet pays.", label: def.name.toUpperCase(), marker: "none",
          at: function () { return op.ped && !op.ped.dead ? op.ped : null; },
          done: function () { return op.dead; } },
      ].concat(def.id === "book" ? [{
        id: "take", goal: "custom", text: "Take the black book off his body.", label: "THE BOOK", marker: "ground",
        at: function () { return op.bookPt || null; }, done: function () { return op.bookTaken; },
      }] : []).concat([{
        id: "clear", goal: "custom", text: "Get clear. Lose the heat.", label: "GET CLEAR", marker: "none",
        at: function () { return null; },
        done: function () { return (g.wanted | 0) === 0 && op.killPt && distP(op.killPt.x, op.killPt.z) > 160; },
      }]),
      doneText: "Operation " + def.codename + " closed.",
      failText: "Operation " + def.codename + " lost.",
      onComplete: function () { opDone(op); },
      onFail: function () { RT.op = null; teardownOp(op); },
    });
    if (m && !m.inert) op.mission = m;
    if (op.identified && m && m.stageId && m.stageId() === "find") m.advance();
    return m;
  }

  function opDone(op) {
    const a = arc(); if (!a) return;
    teardownOp(op);
    if (RT.op === op) RT.op = null;
    const i = OP_ORDER.indexOf(op.id);
    const next = OP_ORDER[i + 1];
    const R0 = recs(); if (R0) { R0.paid = (R0.paid | 0) + op.pay; R0.completed = (R0.completed | 0) + 1; }
    if (CBZ.cityEvent) { try { CBZ.cityEvent("hitman-complete", { respect: 8, heat: op.rating === "CLEAN" ? 0 : 3, label: "Operation " + op.def.codename, message: op.def.name + " is dead." }, { silent: true }); } catch (e) {} }
    handlerAfter(op);
    if (next) {
      setStep(next);
      if (next === "cargo") a.kit.charge = Math.max(a.kit.charge | 0, 1);
      commit();
    } else {
      setStep("meet2");
    }
    refreshFile(true);
  }

  function handlerAfter(op) {
    const r = op.rating;
    const lines = {
      ledger: {
        CLEAN: "Brandt had a weak heart. That is what the paper will say.",
        PROFESSIONAL: "Brandt is dead. His guard too. Acceptable.",
        LOUD: "Brandt is dead. Half the city heard it. Do better.",
        MESSY: "Brandt is dead. So are people I did not pay for. Do not do that again.",
        MASSACRE: "That was not a contract. That was a headline.",
      },
      cargo: {
        CLEAN: "Dranov's buyers will find another seller. Not this month.",
        PROFESSIONAL: "Dranov is done. The Guard will be short of rifles.",
        LOUD: "Dranov is done. Loud. The palace will be counting its guards now.",
        MESSY: "Dranov is done. I am still counting the rest.",
        MASSACRE: "You are making this hard to deny.",
      },
      book: {
        CLEAN: "Varga is dead and nobody knows how. Bring me the book.",
        PROFESSIONAL: "Varga is dead. Bring me the book.",
        LOUD: "Varga is dead and the Guard is awake. Bring me the book.",
        MESSY: "Varga is dead. The rest of it will cost me. Bring me the book.",
        MASSACRE: "Bring me the book before the army finds you.",
      },
    };
    const L = lines[op.id] && lines[op.id][r];
    if (L) text(L, HANDLER);
    const nxt = { ledger: "Next file is in your kit. Casimir Dranov. There is a charge with it.", cargo: "Last file before the big one. General Ruben Varga." };
    if (nxt[op.id]) setTimeout(function () { text(nxt[op.id], HANDLER); }, 2600);
    if (op.id === "book") setTimeout(function () { text("Same lot as before. Come alone.", HANDLER, true); }, 3200);
  }

  /* ================================================================
     §9  THE FILE (what the dossier shows)
     ================================================================ */
  function fileFor(op) {
    const def = op.def, S = seenOf(op.id);
    const a = arc();
    const routine = op.legs.map(function (L, i) {
      return { label: L.label, detail: L.detail, dur: L.def.dwell ? ("about " + L.def.dwell + " s") : "", seen: !!S.legs[String(i)], now: !op.dead && op.ped && op.leg === i && op.phase === "dwell" && !!S.legs[String(i)] };
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
    if ((a.kit.vial | 0) > 0) kit.push("Vial x" + a.kit.vial);
    if ((a.kit.charge | 0) > 0) kit.push("Car charge x" + a.kit.charge);
    kit.push("Whatever you carry");
    return {
      codename: def.codename, opLabel: "FILE " + def.fileNo + " OF 4", classification: "EYES ONLY",
      status: op.dead ? "CONFIRMED" : "ACTIVE",
      subject: { name: def.name, role: def.role, photo: op.photo || "", note: op.wearing ? ("Last seen wearing " + op.wearing) : "" },
      identified: !!op.identified,
      brief: def.brief,
      facts: [
        { k: "LOCATION", v: lotName(op.V[def.venues[0].key]), redacted: false },
        { k: "SECURITY", v: def.security, redacted: seenG === 0 },
        { k: "FEE", v: money(def.pay) + ", more for clean work", redacted: false },
      ],
      routine: routine, security: security, approaches: approaches, kit: kit,
      notes: noteOf(op.id).slice(-8),
      stamp: op.dead ? "CONFIRMED" : null,
      footer: op.dead ? ("Rating: " + (op.rating || "")) : "Nothing on this page you did not see yourself.",
    };
  }
  function bookFile() {
    const a = arc();
    const fin = RT.fin;
    const m = mansion();
    const name = (fin && fin.ped && fin.ped.name) || (m && m.actor && m.actor.name) || "The President";
    return {
      codename: "BLACK BOOK", opLabel: "RECOVERED", classification: "EYES ONLY", status: "PENDING",
      subject: { name: name, role: FINALE.role, photo: (fin && fin.photo) || "", note: "The Executive Mansion" },
      identified: false,
      brief: [
        "Varga's hand. The President's day, every day, in the same order.",
        "The residence door. The address from the Mansion steps. The motorcade out the gate and back.",
        "A loose page at the back is not Varga's. It is a Bureau cable.",
      ],
      facts: [
        { k: "RESIDENCE", v: "The Executive Mansion", redacted: false },
        { k: "DETAIL", v: "Presidential detail, rifles", redacted: false },
        { k: "CABLE", v: "ASSET TO BE RETIRED ON COMPLETION. NO RECORD. V.", redacted: false },
      ],
      routine: FINALE.legs.map(function (L) { return { label: L.label, detail: L.detail, dur: L.dwell ? ("about " + L.dwell + " s") : "", seen: true, now: false }; }),
      security: [{ label: "Detail", detail: FINALE.security, seen: true }],
      approaches: FINALE.approaches.map(function (x) { return { label: x.label, detail: x.detail, known: true, used: false }; }),
      kit: [], notes: noteOf("book").slice(-8), stamp: null,
      footer: a && a.choice ? "" : "Voss wants this book. He does not know you read the back page.",
    };
  }
  function currentFile() {
    const a = arc(); if (!a) return null;
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
    const f = playing() ? currentFile() : null;
    Dz.button(f ? { label: "FILE", badge: false } : null);
  }
  function openFile() {
    const Dz = D(); const f = currentFile();
    if (Dz && f) { if (Dz.isOpen && Dz.isOpen()) Dz.close(); else Dz.open(f); }
  }

  /* ================================================================
     §10  THE MEETINGS
     ================================================================ */
  function meetSpot() {
    const a = arc();
    if (a.meet) {
      const l = lotByKey(a.meet.lot);
      if (l) return a.meet;
    }
    const p = P(); const AR = A(); if (!AR) return null;
    const px = p && p.pos ? p.pos.x : AR.center.x, pz = p && p.pos ? p.pos.z : AR.center.z;
    const lot = pickLot(["carlot", "gas", "security", "shop"], px, pz, 140, 420, 0x3e7, null);
    if (!lot) return null;
    const s = spotAt(lot, 9, 4);
    a.meet = { lot: lotKey(lot), x: s.x, z: s.z, face: s.face };
    commit();
    return a.meet;
  }
  function stageMeet(kind) {
    if (RT.meet && RT.meet.kind === kind) return RT.meet;
    const S = meetSpot(); if (!S) return null;
    const mt = { kind: kind, S: S, voss: null, men: [], car: null, lamp: null, started: false, done: false, waitT: 0 };
    // the car behind him, nose toward where you arrive from
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
    if (mt.voss) { mt.voss.vipTitle = "The Bureau"; mt.voss._agencyHandler = true; }
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

  function startMeetMission(kind) {
    const M = CBZ.mission; if (!M || !M.start) return null;
    const S = meetSpot(); if (!S) return null;
    return M.start({
      id: "agency-" + kind,
      title: kind === "meet1" ? "THE MEET" : "THE BOOK",
      giver: "UNKNOWN NUMBER",
      offerText: kind === "meet1" ? "A parking lot. After dark. Come alone." : "Same lot. Bring the book.",
      targetName: "",
      brief: kind === "meet1" ? "Someone noticed your work." : "Voss wants the book.",
      reward: 0, pay: false, color: 0xffc27a,
      stages: [{ id: "go", goal: "custom", text: kind === "meet1" ? "Go to the meet. Come alone." : "Bring Voss the book.", label: "THE MEET", marker: "ground",
        at: function () { return { x: S.x, z: S.z }; }, done: function () { return !!(RT.meet && RT.meet.done); } }],
      doneText: kind === "meet1" ? "You work for the Bureau now." : "",
      announce: true,
      onComplete: function () {},
      onFail: function () { teardownMeet(false); },
    });
  }

  function tickMeet(kind, dt) {
    const mt = stageMeet(kind); if (!mt) return;
    const pl = P(); if (!pl || !pl.pos) return;
    const d = distP(mt.S.x, mt.S.z);
    // he shows after dark, or once you have waited for him
    const dark = (CBZ.nightAmount != null ? CBZ.nightAmount > 0.35 : true);
    if (!mt.voss && d < 120) {
      if (d < 22) mt.waitT += dt;
      if (dark || mt.waitT > 14 || kind === "meet2") vossAppear(mt);
    }
    if (mt.voss && !mt.started && d < 7.5 && !(CBZ.cineBusy && CBZ.cineBusy()) && !pl.driving) {
      mt.started = true;
      runMeetScene(mt);
    }
    if (mt.voss && mt.voss.dead && !mt.done && kind === "meet2" && arc().choice === "kill") {
      mt.done = true;
      endingTurned();
    }
  }

  function vossLines1() {
    const a = arc();
    const last = a.lastStreet || "the last one";
    return [
      "You did " + last + ". " + (a.lastQuiet ? "Nobody saw a thing." : "Loud. But he stayed dead."),
      "I am not going to ask your name. I already have it.",
      "I work for the Bureau. You will never prove that, so do not try.",
      "This morning the President cancelled the election. Next he cancels people.",
      "Three men keep him standing. They go first.",
      "Teodor Brandt washes his money. Same cafe table every day.",
      "Watch a man before you touch him. No crowds. No bodies I did not pay for.",
      "There is a vial in your kit. Use it or do not. I only read the result.",
    ];
  }
  function vossLines2() {
    const a = arc();
    const r = a.ratings || {};
    const cleanN = ["ledger", "cargo", "book"].filter(function (k) { return r[k] === "CLEAN"; }).length;
    return [
      cleanN >= 2 ? "Three for three and you kept it quiet. I noticed." : "Three for three. Not all of it pretty.",
      "The book.",
      "He speaks from the Mansion steps. Then the motorcade, out the gate and back. Every day.",
      "Find the gap. Take it. The ride out is on me.",
    ];
  }

  function runMeetScene(mt) {
    const pl = P(); const v = mt.voss; if (!pl || !v) return;
    const lines = mt.kind === "meet1" ? vossLines1() : vossLines2();
    const vx = v.pos.x, vz = v.pos.z, vy = v.pos.y;
    // he turns to you
    const fx = pl.pos.x - vx, fz = pl.pos.z - vz, fm = Math.hypot(fx, fz) || 1;
    const ux = fx / fm, uz = fz / fm, sx = -uz, sz = ux;
    if (v.staffPost) v.staffPost.face = Math.atan2(ux, uz);
    if (v.group) v.group.rotation.y = Math.atan2(ux, uz);
    const shots = [
      { pos: { x: vx + sx * 8 + ux * 5, y: vy + 2.6, z: vz + sz * 8 + uz * 5 }, look: { x: vx + ux * 2.5, y: vy + 1.3, z: vz + uz * 2.5 } },   // wide, the lamp and the car
      { pos: { x: pl.pos.x + ux * 0.9 - sx * 0.7, y: pl.pos.y + 1.75, z: pl.pos.z + uz * 0.9 - sz * 0.7 }, look: { x: vx, y: vy + 1.55, z: vz } },   // over your shoulder
      { pos: { x: vx + ux * 1.6 + sx * 0.9, y: vy + 1.6, z: vz + uz * 1.6 + sz * 0.9 }, look: { x: vx, y: vy + 1.6, z: vz } },   // his face
    ];
    const Dz = D(); if (Dz && Dz.letterbox) Dz.letterbox(true);
    const steps = [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const shot = i === 0 ? shots[0] : shots[1 + (i % 2)];
      steps.push({ cut: i === 0 || (i % 2 === 1), dur: Math.min(4.2, 1.9 + ln.length * 0.035), cam: shot, enter: function () { say(HANDLER, ln); } });
    }
    let choiceMade = false;
    if (mt.kind === "meet2") {
      steps.push({ dur: 60, cam: shots[1], enter: function () {
        const ui = CBZ.campaignUI;
        const onPick = function (val) {
          if (choiceMade) return; choiceMade = true;
          arc().choice = val === "kill" ? "kill" : "job"; commit();
          if (CBZ.cineAbort) CBZ.cineAbort();
        };
        if (ui && ui.choice) {
          try {
            ui.choice({ speaker: "YOU", prompt: "The cable in the back of the book has your file number on it.",
              options: [{ id: "job", label: "Take the job" }, { id: "kill", label: "Kill Voss now" }], onChoose: onPick });
          } catch (e) { onPick("job"); }
        } else onPick("job");
      } });
    }
    const ok = CBZ.cinePlay ? CBZ.cinePlay(steps, {}, function () {
      if (Dz && Dz.letterbox) Dz.letterbox(false);
      clearSay();
      if (mt.kind === "meet1") afterMeet1(mt); else afterMeet2(mt);
    }) : false;
    if (!ok) {
      // no director: say the lines on the phone and move on
      for (let i = 0; i < lines.length; i++) text(lines[i], HANDLER);
      if (Dz && Dz.letterbox) Dz.letterbox(false);
      if (mt.kind === "meet2") arc().choice = "job";
      if (mt.kind === "meet1") afterMeet1(mt); else afterMeet2(mt);
    }
  }

  function afterMeet1(mt) {
    const a = arc();
    mt.done = true;
    a.kit.vial = Math.max(a.kit.vial | 0, 1);
    setStep("ledger");
    // the morning the vote died: the Mansion dresses for it (president_regime.js)
    dictatorship();
    setTimeout(function () { teardownMeet(true); }, 9000);
    commit();
  }
  function afterMeet2(mt) {
    const a = arc();
    if (a.choice === "kill") {
      // he reads it on your face
      mt.done = true;
      say(HANDLER, "Then we are done here.");
      setTimeout(clearSay, 2600);
      if (mt.voss) { mt.voss.staffPost = null; mt.voss.aggr = 1; hostile(mt.voss); }
      for (let i = 0; i < mt.men.length; i++) hostile(mt.men[i]);
      setStep("turned");
      startTurnMission(mt);
      return;
    }
    mt.done = true;
    say(HANDLER, "Good. My car takes you to the Mansion road when you are ready.");
    setTimeout(clearSay, 3200);
    setStep("finale");
  }

  function dictatorship() {
    try {
      const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get("republic") : null;
      if (rec && CBZ.regimes && CBZ.regimes.transition && rec.govType !== "dictatorship" && rec.govType !== "monarchy" && !isPresident()) {
        const day = CBZ.worldDay ? CBZ.worldDay() : 0;
        CBZ.regimes.transition(rec, "dictatorship", day, -10);
      }
    } catch (e) {}
    news("The President has suspended the election and dissolved the courts. Soldiers are on the streets.");
  }

  /* ---- ending B: you killed Voss ---- */
  let turnMission = null;
  function startTurnMission(mt) {
    const M = CBZ.mission; if (!M || !M.start) return;
    turnMission = M.start({
      id: "agency-turned", title: "THE CABLE", giver: "YOU", offerText: "Voss drew first.",
      targetName: "Voss", brief: "The Bureau planned to bury you. Bury its man first.",
      reward: 0, pay: false, color: 0xd8322a,
      stages: [{ id: "voss", goal: "custom", text: "Kill Voss.", label: "VOSS", marker: "none",
        at: function () { return mt.voss && !mt.voss.dead ? mt.voss : null; },
        done: function () { return !mt.voss || mt.voss.dead; } }],
      onComplete: function () { endingTurned(); },
    });
  }
  function endingTurned() {
    const a = arc(); if (!a || a.ending) return;
    a.ending = "turned";
    setStep("done");
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(100000);
    setTimeout(function () { text("The President heard what you did for him. He pays better than they did.", "UNKNOWN NUMBER", true); }, 1800);
    setTimeout(function () {
      const Dz = D(); const m = mansion();
      if (Dz && Dz.ending) Dz.ending({
        title: "THE PRESIDENT'S MAN", subtitle: "FILE CLOSED",
        lines: [
          "Voss is dead in a parking lot. The Bureau lost an officer and a plan.",
          "The President keeps his palace. " + ((m && m.actor && m.actor.name) ? (m.actor.name + " keeps you too.") : "He keeps you too."),
          "Every file you ever read is his now. $100,000 cleared.",
        ],
        stamp: "FILE CLOSED",
      });
      teardownMeet(true);
    }, 4200);
    commit();
  }

  /* ================================================================
     §11  THE FINALE — the President's loop at the Executive Mansion
     ================================================================ */
  function finGuards() {
    const F = RT.fin;
    if (!F || !F.ped || !CBZ.powerGuardsOf) return [];
    try { return CBZ.powerGuardsOf(F.ped); } catch (e) { return []; }
  }
  function finNote(line) { addNote("finale", line); }

  function buildFinale() {
    const site = mansion(); if (!site) return null;
    const pres = site.actor;
    if (!pres || pres.dead) return null;
    const cx = site.cx, cz = site.cz, R = site.rect;
    const gate = site.gate || { x: cx, z: R.maxZ };
    const F = {
      site: site, ped: pres, phase: "residence", t: 0, legIdx: 0, identified: false, idT: 0,
      crowd: [], cars: [], stateCar: null, chauffeur: null, charge: false, dead: false, alarm: 0, everAlarm: false,
      kills: { civ: 0, guard: 0 }, photo: "", path: null, s: 0, convoyDir: 1, stopT: 0, accident: null,
      // THE RESIDENCE is inside: seven metres past his threshold, toward the
      // hall. From the lawn he is gone; that is the point of the leg.
      residence: (function () {
        const sp = site.seatPoint, hx = cx - sp.x, hz = (cz - 34) - sp.z, hm = Math.hypot(hx, hz) || 1;
        return { x: sp.x + hx / hm * 7, z: sp.z + hz / hm * 7, face: sp.face };
      })(),
      threshold: { x: site.seatPoint.x, z: site.seatPoint.z, face: site.seatPoint.face },
      podium: { x: cx, z: cz - 10.2, face: 0 },
      court: { x: cx + 12, z: cz + 18 },
      gate: gate,
    };
    // the loop's road: court, down the drive, through the gate, out along
    // the approach and back. site.roads is the approach govcomplex laid.
    const out = [];
    out.push({ x: cx + 12, z: cz + 8 }, { x: cx + 12, z: cz + 30 }, { x: cx + 3, z: cz + 46 }, { x: gate.x, z: gate.z + 2 });
    let ext = null;
    try {
      const r0 = site.roads && site.roads[0];
      const pts = r0 && (r0.path || r0.points || (r0.rec && r0.rec.path));
      if (pts && pts.length >= 2) ext = pts.map(function (q) { return { x: q.x, z: q.z }; });
    } catch (e) { ext = null; }
    if (ext) {
      let acc = 0;
      for (let i = 1; i < ext.length && acc < 220; i++) { out.push(ext[i]); acc += d2(ext[i].x, ext[i].z, ext[i - 1].x, ext[i - 1].z); }
    } else {
      out.push({ x: gate.x, z: gate.z + 80 }, { x: gate.x, z: gate.z + 170 });
    }
    // there and back as one polyline
    const back = out.slice(0, -1).reverse();
    F.path = out.concat(back);
    F.pathLen = [0];
    for (let i = 1; i < F.path.length; i++) F.pathLen.push(F.pathLen[i - 1] + d2(F.path[i].x, F.path[i].z, F.path[i - 1].x, F.path[i - 1].z));
    F.total = F.pathLen[F.pathLen.length - 1];
    F.gateS = F.pathLen[3];
    return F;
  }
  function pathAt(F, s) {
    s = Math.max(0, Math.min(F.total, s));
    let i = 1;
    while (i < F.pathLen.length - 1 && F.pathLen[i] < s) i++;
    const a = F.path[i - 1], b = F.path[i];
    const L = F.pathLen[i] - F.pathLen[i - 1] || 1;
    const k = (s - F.pathLen[i - 1]) / L;
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, h: Math.atan2(b.x - a.x, b.z - a.z) };
  }
  function stageFinale(F) {
    if (F.staged) return;
    F.staged = true;
    if (CBZ.cityMugshot) { try { F.photo = CBZ.cityMugshot({ ped: F.ped }) || ""; } catch (e) {} }
    if (CBZ.cityMugshotWearing) { try { F.wearing = CBZ.cityMugshotWearing({ ped: F.ped }) || null; } catch (e) {} }
    F.ped._agencyMark = true; F.ped._agencyOp = "finale";
    // three black cars in the motor court: lead, the state car, tail
    if (CBZ.cityAddParkedCar) {
      for (let i = 0; i < 3; i++) {
        const q = pathAt(F, 22 - i * 11);
        let c = null;
        try { c = CBZ.cityAddParkedCar(q.x, q.z, q.h, { color: i === 1 ? 0x07080a : 0x15171a }); } catch (e) { c = null; }
        if (c) { c._agencyConvoy = true; F.cars.push(c); }
      }
      F.stateCar = F.cars[1] || null;
    }
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
      if (CBZ.cityFleeFrom) { try { CBZ.cityFleeFrom(q, F.podium.x, F.podium.z); } catch (e) {} }
    }
  }
  function dropCrowd(F) {
    for (let i = 0; i < F.crowd.length; i++) if (F.crowd[i] && !F.crowd[i].dead) despawn(F.crowd[i]);
    F.crowd.length = 0;
  }

  // his body sits in the state car: hidden, pinned to it; the detail rides in
  // the lead and tail cars the same way
  function ride(F, on) {
    const p = F.ped; if (!p) return;
    const G = finGuards();
    if (on) {
      p.controlled = true; p.staffPost = null;
      if (p.group) p.group.visible = false;
      p._agencyRiding = true;
      for (let i = 0; i < G.length; i++) { const q = G[i]; if (!q || q.dead) continue; q._agencyRiding = true; if (q.group) q.group.visible = false; }
    } else {
      p._agencyRiding = false;
      if (p.group) p.group.visible = true;
      const c = F.stateCar;
      const ex = c ? c.pos.x + Math.cos(c.heading) * 1.8 : p.pos.x, ez = c ? c.pos.z - Math.sin(c.heading) * 1.8 : p.pos.z;
      place(p, ex, ez);
      for (let i = 0; i < G.length; i++) {
        const q = G[i]; if (!q || q.dead) continue;
        q._agencyRiding = false; if (q.group) q.group.visible = true;
        const cc = F.cars[i % 2 === 0 ? 0 : 2] || c;
        if (cc) place(q, cc.pos.x + (i % 3 - 1) * 1.6, cc.pos.z + ((i / 3) | 0) * 1.4);
      }
    }
  }
  function pinRiders(F) {
    const p = F.ped, c = F.stateCar;
    if (p && p._agencyRiding && c) { p.pos.set(c.pos.x, floorY(c.pos.x, c.pos.z), c.pos.z); if (p.group) p.group.position.copy(p.pos); if (p.target) p.target.set(c.pos.x, 0, c.pos.z); p.state = "idle"; }
    const G = finGuards();
    for (let i = 0; i < G.length; i++) {
      const q = G[i]; if (!q || q.dead || !q._agencyRiding) continue;
      const cc = F.cars[i % 2 === 0 ? 0 : 2] || c; if (!cc) continue;
      q.pos.set(cc.pos.x, floorY(cc.pos.x, cc.pos.z), cc.pos.z); if (q.group) q.group.position.copy(q.pos);
      if (q.target) q.target.set(cc.pos.x, 0, cc.pos.z);
      q.state = "idle"; q.rage = null;
    }
  }

  // per frame: move the convoy along the loop (parkSeat seats a parked car on
  // the terrain from pos/heading every frame, so kinematic is all it needs)
  function tickConvoy(F, dt) {
    if (F.phase !== "convoy") return;
    const c0 = F.cars[0];
    // blocked: something parked on the road in front of the lead car
    let blocked = false;
    if (c0 && CBZ.cityCars) {
      const fx = Math.sin(c0.heading), fz = Math.cos(c0.heading);
      for (let i = 0; i < CBZ.cityCars.length; i++) {
        const o = CBZ.cityCars[i];
        if (!o || o._agencyConvoy || o.dead) continue;
        const dx = o.pos.x - c0.pos.x, dz = o.pos.z - c0.pos.z;
        const ahead = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
        if (ahead > 0 && ahead < 7 && lat < 2.4) { blocked = true; break; }
      }
    }
    const pl = P();
    if (!blocked && pl && pl.pos && c0) {
      const dx = pl.pos.x - c0.pos.x, dz = pl.pos.z - c0.pos.z;
      const ahead = dx * Math.sin(c0.heading) + dz * Math.cos(c0.heading), lat = Math.abs(dx * Math.cos(c0.heading) - dz * Math.sin(c0.heading));
      if (ahead > 0 && ahead < 5 && lat < 1.8) blocked = true;
    }
    if (blocked) { F.stopT += dt; } else F.stopT = 0;
    const v = blocked ? 0 : (F.alarm > 0 ? 13 : 8.5);
    F.s += v * dt;
    for (let i = 0; i < F.cars.length; i++) {
      const c = F.cars[i];
      if (!c || c.dead || c.player) continue;
      const q = pathAt(F, F.s - i * 11);
      c.pos.x = q.x; c.pos.z = q.z; c.heading = q.h; c.v = v;
    }
    pinRiders(F);
    // the charge: armed when his door closed
    if (F.charge && F.s > 14 && !F.dead && F.stateCar && !F.stateCar._agencyBoom) {
      F.accident = "charge";
      RT.killWatch = { fin: F, t: now() + 1200, blast: true };
      F.ped.killedBy = { name: "A car bomb", isPlayer: false };
      const sc = F.stateCar;
      sc._agencyBoom = true;
      try { if (CBZ.cityExplosion) CBZ.cityExplosion(sc.pos.x, sc.pos.z, { power: 1.8, radius: 7, byPlayer: false }); } catch (e) {}
      try { if (CBZ.cityCarIgnite) CBZ.cityCarIgnite(sc); } catch (e) {}
      sc.dead = true;
      F.ped._agencyRiding = false; if (F.ped.group) F.ped.group.visible = true;
      try { CBZ.cityKillPed(F.ped, { byPlayer: false, noCrime: true }, "explosion"); } catch (e) {}
      ride(F, false);
      F.phase = "done";
      return;
    }
    // the state car destroyed any other way takes him with it
    if (F.stateCar && (F.stateCar.dead || F.stateCar.player) && F.ped._agencyRiding) {
      F.ped._agencyRiding = false; if (F.ped.group) F.ped.group.visible = true;
      if (F.stateCar.dead) { try { CBZ.cityKillPed(F.ped, { byPlayer: true }, "explosion"); } catch (e) {} }
      ride(F, false);
      F.phase = F.ped.dead ? "done" : "bail";
      return;
    }
    // ambushed: stopped too long, or the detail is hot. Out, and run for the house.
    if (F.stopT > 3.5 || (F.alarm > 0 && F.s > F.gateS + 20 && F.s < F.total - F.gateS - 20 && blocked)) {
      ride(F, false);
      F.phase = "bail"; F.t = 0;
      finNote("The motorcade stopped. He ran for the house.");
      walkTo(F.ped, F.residence.x, F.residence.z, true);
      return;
    }
    if (F.s >= F.total) {
      ride(F, false);
      F.phase = "walkhome"; F.t = 0;
      walkTo(F.ped, F.residence.x, F.residence.z);
    }
  }

  function tickFinale(F, dt) {
    const p = F.ped;
    if (!p) return;
    if (p.dead) {
      if (!F.dead) finDead(F);
      return;
    }
    const pl = P(); if (!pl || !pl.pos) return;
    const dPl = distP(p.pos.x, p.pos.z);
    // crowd while the address is on and you are in the country
    if (dPl < 320 && F.phase === "address" && !F.crowd.length && F.alarm <= 0) spawnCrowd(F);
    if (dPl > 380 && F.crowd.length) dropCrowd(F);
    // alarm
    let hot = (g.wanted | 0) >= 2 && dPl < 120;
    if (p.hp != null && p.maxHp != null && p.hp < p.maxHp - 1) hot = true;
    const G = finGuards();
    for (let i = 0; i < G.length && !hot; i++) { const q = G[i]; if (q && !q._agencyRiding && (q.dead || (q.rage && q.state === "fight"))) hot = true; }
    if (hot) {
      if (F.alarm <= 0) {
        F.everAlarm = true;
        finNote("The detail went hot.");
        releaseCrowd(F);
        if (F.phase === "address" || F.phase === "residence" || F.phase === "walkcar" || F.phase === "walkhome") {
          F.phase = "bail"; F.t = 0; walkTo(p, F.residence.x, F.residence.z, true);
        }
      }
      F.alarm = 45;
    } else if (F.alarm > 0) F.alarm -= dt;

    switch (F.phase) {
      case "residence":
        F.t += dt;
        if (p.staffPost == null) { p.staffPost = { x: F.residence.x, z: F.residence.z, face: F.residence.face }; }
        if (F.t > FINALE.legs[0].dwell && F.alarm <= 0) { F.phase = "toaddress"; F.t = 0; walkTo(p, F.podium.x, F.podium.z); }
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
        if (F.t > FINALE.legs[1].dwell) { F.phase = "walkcar"; F.t = 0; dropCrowd(F); const c = F.stateCar; if (c) walkTo(p, c.pos.x + Math.cos(c.heading) * 1.8, c.pos.z - Math.sin(c.heading) * 1.8); else { F.phase = "residence"; } }
        break;
      case "walkcar": {
        F.t += dt;
        const c = F.stateCar;
        if (!c || c.dead) { F.phase = "residence"; F.t = 0; walkTo(p, F.residence.x, F.residence.z); break; }
        if (d2(p.pos.x, p.pos.z, c.pos.x, c.pos.z) < 2.6 || F.t > 25) {
          F.phase = "convoy"; F.s = 22; F.stopT = 0; ride(F, true);
          if (distP(c.pos.x, c.pos.z) < 200) finNote("He got into the middle car.");
        }
        break;
      }
      case "convoy": break;          // per-frame, tickConvoy
      case "walkhome":
      case "bail":
        F.t += dt;
        if (d2(p.pos.x, p.pos.z, F.residence.x, F.residence.z) < 1.5 || F.t > 40) {
          if (F.t > 40) place(p, F.residence.x, F.residence.z);
          holdAt(p, F.residence.face);
          const wasBail = F.phase === "bail";
          F.phase = "residence"; F.t = wasBail ? -30 : 0;
          // the cars go home to the court
          F.s = 22;
          for (let i = 0; i < F.cars.length; i++) {
            const c = F.cars[i]; if (!c || c.dead || c.player) continue;
            const q = pathAt(F, 22 - i * 11); c.pos.x = q.x; c.pos.z = q.z; c.heading = q.h;
          }
        }
        break;
    }
    // intel
    const S = seenOf("finale");
    const vis = !p._agencyRiding && seesPed(p, false);
    if (!F.identified) {
      if (vis) F.idT += dt;
      if (F.idT > (scoped() ? 0.5 : 1.1)) {
        F.identified = true; S.id = true;
        finNote("Eyes on the President. Identified.");
        if (F.mission && F.mission.alive && F.mission.alive() && F.mission.stageId() === "find") F.mission.advance();
      }
    }
    if (!p._agencyRiding && seesPed(p, true)) {
      const k = F.phase === "address" ? "1" : (F.phase === "residence" ? "0" : null);
      if (k && !S.legs[k]) { S.legs[k] = true; finNote(FINALE.legs[+k].label + ": " + FINALE.legs[+k].detail); }
      if (!S.appr.long && F.phase === "address" && distP(p.pos.x, p.pos.z) > 60) { S.appr.long = true; finNote("Clear line through the gate from here. " + Math.round(distP(p.pos.x, p.pos.z)) + " m."); }
    }
    if (F.phase === "convoy" && F.stateCar && !S.legs["2"] && sees(F.stateCar.pos.x, 1, F.stateCar.pos.z, 140, 0.8)) { S.legs["2"] = true; S.appr.charge = true; finNote("The motorcade: three cars, he rides in the middle one."); }
    if (F.stateCar && distP(F.stateCar.pos.x, F.stateCar.pos.z) < 12) S.appr.charge = true;
    for (let i = 0; i < G.length; i++) { const q = G[i]; if (q && !q._agencySeen && seesPed(q, true)) { q._agencySeen = true; S.guards = (S.guards | 0) + 1; S.appr.disguise = true; } }
    // the stolen uniform, this detail's
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
    const pl = P();
    const dist = pl && pl.pos ? d2(pl.pos.x, pl.pos.z, p.pos.x, p.pos.z) : 0;
    const wanted = g.wanted | 0;
    const silent = !F.everAlarm;
    const civ = F.kills.civ | 0, gk = F.kills.guard | 0;
    let rating, mul;
    if (civ >= 3) { rating = "MASSACRE"; mul = 0.6; }
    else if (civ > 0) { rating = "MESSY"; mul = 0.85; }
    else if ((silent || F.accident) && gk === 0) { rating = "CLEAN"; mul = 1.4; }
    else if (gk <= 3) { rating = "PROFESSIONAL"; mul = 1.15; }
    else { rating = "LOUD"; mul = 1; }
    F.rating = rating;
    F.pay = Math.round(FINALE.pay * mul / 50) * 50;
    const a = arc(); if (a) { a.ratings.finale = rating; commit(); }
    const lines = [];
    if (F.accident === "charge") lines.push("His own car");
    else if (dist > 60) lines.push("Long shot, " + Math.round(dist) + " m");
    lines.push(silent ? "Nobody saw it coming" : "The detail was awake");
    lines.push(civ === 0 ? "No civilians" : (civ + " civilians dead"));
    lines.push(gk === 0 ? "Only the target" : (gk + " of his detail down"));
    if (F.mission && F.mission.def) F.mission.def.reward = { cash: F.pay, notoriety: 200 };
    finNote("The President is dead. " + rating + ".");
    killCam(p, function () {
      const Dz = D();
      if (Dz && Dz.confirm) { try { Dz.confirm({ codename: FINALE.codename, name: p.name || "The President", photo: F.photo || "", rating: rating, lines: lines, pay: F.pay }); } catch (e) {} }
    });
    news("The President is dead. The army has sealed the capital.");
  }

  function startFinaleMission(F) {
    const M = CBZ.mission; if (!M || !M.start) return null;
    const exfil = exfilSpot(F);
    F.exfil = exfil;
    const m = M.start({
      id: "agency-finale", title: "OPERATION " + FINALE.codename, giver: "THE BUREAU",
      offerText: "File 4. The President.",
      targetName: F.ped.name || "The President",
      brief: "The residence, the address, the motorcade. Find the gap.",
      photo: F.photo || "",
      facts: [{ k: "ROLE", v: "President" }, { k: "FILE", v: "4 of 4" }].concat(F.wearing ? [{ k: "WEARING", v: F.wearing }] : []),
      reward: { cash: FINALE.pay, notoriety: 200 }, color: 0xd8322a,
      stages: [
        { id: "road", goal: "custom", text: "Get to the Executive Mansion. Voss's car can drive you.", label: "THE MANSION", marker: "ground",
          at: function () { return { x: F.gate.x, z: F.gate.z + 40 }; },
          done: function () { return distP(F.gate.x, F.gate.z) < 260; } },
        { id: "find", goal: "custom", text: "Find the President. Learn his loop.", label: "THE MANSION", marker: "none",
          at: function () { return F.identified ? null : { x: F.site.cx, z: F.site.cz }; },
          done: function () { return F.identified || F.dead; } },
        { id: "kill", goal: "custom", text: "Kill the President.", label: "THE PRESIDENT", marker: "none",
          at: function () { return F.ped && !F.ped.dead && !F.ped._agencyRiding ? F.ped : (F.stateCar || null); },
          done: function () { return F.dead; } },
        { id: "exfil", goal: "custom", text: "Get to the Bureau's extraction car.", label: "EXTRACTION", marker: "ground",
          at: function () { return exfil; },
          done: function () { return distP(exfil.x, exfil.z) < 10; } },
      ],
      doneText: "", failText: "Operation " + FINALE.codename + " lost.",
      onComplete: function () { finDone(F); },
      onFail: function () {},
    });
    if (m && !m.inert) F.mission = m;
    return m;
  }
  function exfilSpot(F) {
    // 420 m down the approach road from the gate, or along the gate axis
    const q = F.path && F.path.length ? F.path[Math.min(F.path.length - 1, Math.floor(F.path.length / 2))] : { x: F.gate.x, z: F.gate.z + 170 };
    const dx = q.x - F.gate.x, dz = q.z - F.gate.z, m = Math.hypot(dx, dz) || 1;
    return { x: F.gate.x + dx / m * 420, z: F.gate.z + dz / m * 420 };
  }
  function finDone(F) {
    const R0 = recs(); if (R0) { R0.paid = (R0.paid | 0) + (F.pay || 0); R0.completed = (R0.completed | 0) + 1; }
    setStep("exfil");
    startBurn(F);
  }

  /* ---- the ride to the Mansion road (Voss's car, a fade, you at the kerb) ---- */
  let fadeEl = null;
  function fade(a) {
    if (!fadeEl) {
      fadeEl = document.createElement("div");
      fadeEl.style.cssText = "position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:69;transition:opacity .45s ease";
      document.body.appendChild(fadeEl);
    }
    fadeEl.style.opacity = String(a);
  }
  function rideToMansion() {
    const F = RT.fin; const pl = P(); if (!F || !pl) return;
    if (pl.driving || pl._vehicle) { if (CBZ.city && CBZ.city.note) CBZ.city.note("Get out of the car you are in.", 2); return; }
    fade(1);
    setTimeout(function () {
      const gx = F.gate.x, gz = F.gate.z;
      // on the approach, 150 m out, looking back up the drive at the steps
      const q = F.path && F.path.length > 5 ? F.path[Math.min(F.path.length - 1, 5)] : { x: gx, z: gz + 150 };
      const dx = q.x - gx, dz = q.z - gz, m = Math.hypot(dx, dz) || 1;
      const x = gx + dx / m * 150, z = gz + dz / m * 150;
      pl.pos.set(x, floorY(x, z), z);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(pl.pos);
      pl.vy = 0; pl.speed = 0; pl.grounded = true;
      if (CBZ.cam) CBZ.cam.yaw = Math.atan2(dx, dz);
      setTimeout(function () { fade(0); text("You are on the Mansion road. The steps line up with the gate. He speaks there.", HANDLER); }, 500);
    }, 520);
  }

  /* ---- the burn: the extraction is the ambush ---- */
  function startBurn(F) {
    const e = F.exfil; if (!e) return;
    const S = { x: e.x, z: e.z, face: 0 };
    const mt = { kind: "burn", S: S, voss: null, men: [], car: null, lamp: null, started: true, done: false };
    if (CBZ.cityAddParkedCar) { try { mt.car = CBZ.cityAddParkedCar(e.x + 3, e.z + 2, 0, { color: 0x0b0c0e }); } catch (err) {} }
    mt.voss = spawn("Voss", e.x, e.z + 1.5, { job: "lawyer", gender: "m", armed: true, weapon: "Pistol", aggr: 0.2, post: true, named: true });
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 0.4;
      const q = spawn("Bureau man", e.x + Math.cos(a) * 9, e.z + Math.sin(a) * 9, { job: "close protection", armed: true, weapon: i === 0 ? "Rifle" : "SMG", aggr: 0.4, post: true, gender: "m" });
      if (q) mt.men.push(q);
    }
    RT.meet = mt;
    say(HANDLER, "Nothing personal. A man who kills a President cannot exist afterwards.");
    setTimeout(clearSay, 3400);
    setTimeout(function () {
      if (mt.voss) hostile(mt.voss);
      for (let i = 0; i < mt.men.length; i++) hostile(mt.men[i]);
    }, 1400);
    const M = CBZ.mission;
    if (M && M.start) {
      M.start({
        id: "agency-burn", title: "THE BURN", giver: "YOU", offerText: "The extraction was the plan all along.",
        targetName: "Voss", brief: "Voss came to close the file. Close his.", reward: 0, pay: false, color: 0xd8322a,
        stages: [{ id: "voss", goal: "custom", text: "Survive. Kill Voss.", label: "VOSS", marker: "none",
          at: function () { return mt.voss && !mt.voss.dead ? mt.voss : null; }, done: function () { return !mt.voss || mt.voss.dead; } }],
        onComplete: function () { endingDeniable(); },
      });
    }
  }
  function endingDeniable() {
    const a = arc(); if (!a || a.ending) return;
    a.ending = "deniable";
    setStep("done");
    commit();
    setTimeout(function () {
      const Dz = D();
      if (Dz && Dz.ending) Dz.ending({
        title: "DENIABLE", subtitle: "FILE CLOSED",
        lines: [
          "The President is dead. The Bureau says it had nothing to do with it.",
          "Voss is dead on the Mansion road, with the men he brought to bury you.",
          "Nobody is coming. Nobody has a file on you anymore. You made sure.",
        ],
        stamp: "FILE CLOSED",
        onClose: function () { teardownMeet(false); RT.fin = null; },
      });
    }, 3000);
  }

  function finFile() {
    const F = RT.fin; if (!F) return null;
    const S = seenOf("finale");
    const routine = FINALE.legs.map(function (L, i) {
      const now_ = (i === 0 && F.phase === "residence") || (i === 1 && F.phase === "address") || (i === 2 && F.phase === "convoy");
      return { label: L.label, detail: L.detail, dur: L.dwell ? ("about " + L.dwell + " s") : "", seen: !!S.legs[String(i)] || !!arc().book, now: now_ && !F.dead };
    });
    const G = finGuards();
    return {
      codename: FINALE.codename, opLabel: "FILE 4 OF 4", classification: "EYES ONLY",
      status: F.dead ? "CONFIRMED" : "ACTIVE",
      subject: { name: (F.ped && F.ped.name) || "The President", role: FINALE.role, photo: F.photo || "", note: F.wearing ? ("Last seen wearing " + F.wearing) : "" },
      identified: !!F.identified,
      brief: [
        "He cancelled the election and kept the army. That is the whole file.",
        "Varga's book gives you his day. The residence door, the address from the Mansion steps, the motorcade out the gate and back.",
        "Find the gap. Take it.",
      ],
      facts: [
        { k: "LOCATION", v: "The Executive Mansion", redacted: false },
        { k: "DETAIL", v: G.length ? (G.length + " close protection, rifles") : "Presidential detail", redacted: !(S.guards > 0) },
        { k: "FEE", v: money(FINALE.pay), redacted: false },
      ],
      routine: routine,
      security: [{ label: "Detail", detail: FINALE.security, seen: (S.guards | 0) > 0 }, { label: "Gate", detail: "Posted staff at the gatehouse. Wall all round.", seen: true }],
      approaches: FINALE.approaches.map(function (x) { return { label: x.label, detail: x.detail, known: x.id === "loud" || !!S.appr[x.id] || !!arc().book, used: F.dead && F.accident === "charge" && x.id === "charge" }; }),
      kit: [((arc().kit.charge | 0) > 0 ? "Car charge x" + arc().kit.charge : "No charge left"), "Whatever you carry"],
      notes: noteOf("finale").slice(-8),
      stamp: F.dead ? "CONFIRMED" : null,
      footer: "The cable in the back of the book is still in your pocket.",
    };
  }

  function showChevron(p) {
    const c = chevronMesh(); if (!c || !p || !p.pos) return;
    c.visible = true;
    c.position.set(p.pos.x, p.pos.y + 2.35 + Math.sin(now() * 0.004) * 0.06, p.pos.z);
  }

  /* ================================================================
     §12  WHO DIED — the rating reads real deaths, not a guess
     ================================================================ */
  function classify(ped) {
    const op = RT.op, F = RT.fin;
    if (op && ped === op.ped) return "target";
    if (F && ped === F.ped) return "target";
    if (op) { const G = guardsOf(op); if (G.indexOf(ped) >= 0) return "guard"; }
    if (F) { const G = finGuards(); if (G.indexOf(ped) >= 0) return "guard"; }
    if (ped && (ped._agencyHandler || (RT.meet && RT.meet.men.indexOf(ped) >= 0))) return "bureau";
    if (ped && (ped.kind === "cop" || ped.swat)) return "guard";
    return "civ";
  }
  function countKill(ped, byPlayer) {
    const kind = classify(ped);
    const W = RT.killWatch && now() < RT.killWatch.t ? RT.killWatch : null;
    const tgt = RT.op || RT.fin;
    if (!tgt || tgt.dead && !(W && W.blast)) return;
    if (!byPlayer && !(W && W.blast)) return;
    if (W && W.noCount) return;
    if (kind === "civ") tgt.kills.civ = (tgt.kills.civ | 0) + 1;
    else if (kind === "guard") tgt.kills.guard = (tgt.kills.guard | 0) + 1;
  }
  function hookKills() {
    if (typeof CBZ.cityKillPed === "function" && !CBZ.cityKillPed._agencyWrap) {
      const orig = CBZ.cityKillPed;
      const w = function (ped, imp, cause) {
        const was = !ped || ped.dead;
        const r = orig.apply(this, arguments);
        if (!was && ped && ped.dead && (RT.op || RT.fin)) {
          imp = imp || {};
          const byPlayer = imp.byPlayer !== false && !imp.attacker;
          try { countKill(ped, byPlayer); } catch (e) {}
        }
        return r;
      };
      w._agencyWrap = true;
      // keep the flags other wrappers look for so nobody double-wraps under us
      for (const k in orig) if (Object.prototype.hasOwnProperty.call(orig, k) && k.charAt(0) === "_") w[k] = orig[k];
      CBZ.cityKillPed = w;
    }
    if (typeof CBZ.cityCrowdKill === "function" && !CBZ.cityCrowdKill._agencyWrap) {
      const origC = CBZ.cityCrowdKill;
      const wc = function (i, opts) {
        const killed = origC.apply(this, arguments);
        if (killed && (RT.op || RT.fin)) {
          opts = opts || {};
          const tgt = RT.op || RT.fin;
          if (tgt && !tgt.dead && !opts.noCrime && opts.byPlayer !== false && !opts.attacker) tgt.kills.civ = (tgt.kills.civ | 0) + 1;
        }
        return killed;
      };
      wc._agencyWrap = true;
      for (const k in origC) if (Object.prototype.hasOwnProperty.call(origC, k) && k.charAt(0) === "_") wc[k] = origC[k];
      CBZ.cityCrowdKill = wc;
    }
  }

  /* ================================================================
     §13  THE DIRECTOR TICK
     ================================================================ */
  let acc = 0, btnT = 0;
  function missionLive(id) { const M = CBZ.mission; return !!(M && M.byId && M.byId(id)); }
  function missionBusyOther(prefix) {
    const M = CBZ.mission; if (!M || !M.live) return false;
    const L = M.live();
    for (let i = 0; i < L.length; i++) if (L[i].id.indexOf(prefix) !== 0) return true;
    return !!(g.cityJob && !g.cityJob._mission);
  }

  function slowTick(dt) {
    const a = arc(); if (!a) return;
    hookKills();
    wireZones();
    if (campaignOwns() || isPresident()) return;
    const s = a.step;
    if (s === "street" || s === "done") return;

    if (s === "meet1" || s === "meet2") {
      if (!missionLive("agency-" + s) && !missionBusyOther("agency-")) startMeetMission(s);
      if (missionLive("agency-" + s) || (RT.meet && RT.meet.started)) tickMeet(s, dt);
      return;
    }
    if (s === "exfil") {
      if (!RT.meet || RT.meet.kind !== "burn") endingDeniable();   // a reload after the kill
      return;
    }
    if (s === "turned") {
      if (!RT.meet) { endingTurned(); }       // a reload after the fight
      return;
    }
    if (OPS[s]) {
      if (!RT.op || RT.op.id !== s) {
        if (RT.op) teardownOp(RT.op);
        RT.op = buildOp(s);
        if (!RT.op) return;
      }
      const op = RT.op;
      if (!op.staged) {
        stageOp(op);
        if (!op.ped) { teardownOp(op); RT.op = null; return; }
        const Dz = D();
        if (Dz && Dz.open && !op.announced) { op.announced = true; setTimeout(function () { if (RT.op === op) Dz.open(fileFor(op)); }, 900); }
      }
      if (!op.mission || !op.mission.alive || (!op.mission.alive() && op.mission.state !== "done")) {
        if (!missionBusyOther("agency-")) startOpMission(op);
      }
      // a mark the world swept away alive (a mode change, a cull sweep) is
      // re-staged at the top of his loop rather than left as a ghost target
      if (op.ped && !op.ped.dead && !op.dead && (!op.ped.group || !op.ped.group.parent || (CBZ.cityPeds || []).indexOf(op.ped) < 0)) {
        const m0 = op.mission; teardownOp(op); RT.op = null;
        if (m0 && m0.retire) m0.retire("restage");
        return;
      }
      if (op.ped && op.ped.dead && !op.dead) onMarkDead(op);
      if (!op.dead) { tickAlarm(op, dt); tickRoutine(op, dt); tickIntel(op, dt); tickDisguise(op); }
      refreshFile();
      return;
    }
    if (s === "finale") {
      if (!RT.fin) {
        RT.fin = buildFinale();
        if (!RT.fin) return;
        stageFinale(RT.fin);
      }
      const F = RT.fin;
      // govcomplex re-posts a swept head of state as a NEW body; follow it
      if (!F.dead && F.site.actor && F.site.actor !== F.ped && !F.site.actor.dead) {
        for (let i = 0; i < F.cars.length; i++) if (F.cars[i] && !F.cars[i].player && CBZ.cityScrapCar) { try { CBZ.cityScrapCar(F.cars[i]); } catch (e) {} }
        dropCrowd(F);
        const m0 = F.mission; RT.fin = null;
        if (m0 && m0.retire) m0.retire("restage");
        return;
      }
      if (!F.mission || !F.mission.alive || (!F.mission.alive() && F.mission.state !== "done")) {
        if (!missionBusyOther("agency-")) startFinaleMission(F);
      }
      // Voss's car waits at the lot for the ride out
      if (!RT.meet || RT.meet.kind !== "meet2") { stageMeet("meet2"); if (RT.meet && !RT.meet.voss) vossAppear(RT.meet); if (RT.meet) { RT.meet.started = true; RT.meet.done = true; } }
      tickFinale(F, dt);
      refreshFile();
      return;
    }
  }

  // the ride zone at Voss's car during the finale
  let rideWired = false;
  function wireRide() {
    const I = CBZ.interactions;
    if (rideWired || !I || !I.registerZone) return;
    rideWired = true;
    if (I.describe) { try { I.describe("agencyride", function () { return { label: "Voss's car", note: "The driver knows the way" }; }); } catch (e) {} }
    const tok = { x: 0, z: 0, kind: "agencyride" };
    I.registerZone({
      id: "agency-ride", kind: "agencyride", radius: 3.2, prio: 15,
      find: function (px, pz) {
        const a = arc();
        if (!a || a.step !== "finale" || !RT.meet || !RT.meet.car || RT.meet.car.dead || !playing()) return null;
        if (RT.fin && distP(RT.fin.gate.x, RT.fin.gate.z) < 400) return null;
        tok.x = RT.meet.car.pos.x; tok.z = RT.meet.car.pos.z;
        return d2(px, pz, tok.x, tok.z) < 3.4 ? tok : null;
      },
      options: [{ id: "agency-ride-go", slot: "e", label: function () { return "Ride to the Mansion"; }, onSelect: function () { rideToMansion(); } }],
    });
  }

  if (CBZ.onUpdate) {
    // logic, 5 Hz
    CBZ.onUpdate(39.5, function (dt) {
      if (!playing()) { if (btnT >= 0) { btnT = -1; const Dz = D(); if (Dz && Dz.button) Dz.button(null); } return; }
      acc += dt || 0;
      if (acc >= 0.2) { const step = acc; acc = 0; try { slowTick(step); } catch (e) { if (window.console) console.error("[agency]", e); } }
      btnT -= dt || 0;
      if (btnT <= 0) { btnT = 1; syncButton(); wireRide(); }
    });
    // per frame, after the car loop (37) and before the draw: the convoy,
    // the riders and the chevron. Nothing here runs without a live target.
    CBZ.onUpdate(37.3, function (dt) {
      if (!playing()) return;
      const F = RT.fin;
      if (F && F.phase === "convoy" && !F.dead) tickConvoy(F, dt || 0);
      else if (F && F.ped && F.ped._agencyRiding) pinRiders(F);
      const op = RT.op;
      if (op && op.identified && op.ped && !op.ped.dead) showChevron(op.ped);
      else if (F && F.identified && F.ped && !F.ped.dead && !F.ped._agencyRiding) showChevron(F.ped);
      else hideChevron();
    });
  }

  // J opens the file (and the FILE button does, for touch)
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("keydown", function (e) {
      if (e.code !== "KeyJ" || e.repeat || !playing()) return;
      const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (currentFile()) openFile();
    });
  }
  function wireButton() { const Dz = D(); if (Dz && !Dz._agencyWired) { Dz._agencyWired = true; Dz.onButton = openFile; } }

  /* ================================================================
     §14  THE HOOKS other files call
     ================================================================ */
  CBZ.agency = {
    // hitman.js settle(): a street contract closed
    onStreetSettled: function (con, quiet) {
      const a = arc(); if (!a) return;
      a.street = (a.street | 0) + 1;
      if (quiet) a.clean = (a.clean | 0) + 1;
      a.lastStreet = con && con.name ? con.name : a.lastStreet;
      a.lastQuiet = !!quiet;
      commit();
      if (a.step === "street" && !campaignOwns() && !isPresident() && ((a.clean | 0) >= 1 || (a.street | 0) >= 2)) {
        setStep("meet1");
        setTimeout(function () { text("Nice work on " + (a.lastStreet || "the last one") + ". A parking lot. After dark. Come alone.", "UNKNOWN NUMBER", true); }, 4200);
      }
    },
    step: function () { const a = arc(); return a ? a.step : null; },
    file: currentFile,
    openFile: openFile,
    // the wall's card
    wall: function () {
      const a = arc(); if (!a || a.step === "street") return null;
      const s = a.step;
      if (s === "done") return { title: "THE BUREAU", line: a.ending === "turned" ? "Voss is dead" : "File closed" };
      if (s === "meet1") return { title: "THE BUREAU", line: "Someone wants to meet" };
      if (OPS[s]) return { title: "THE BUREAU", line: "File " + OPS[s].fileNo + ": " + OPS[s].codename };
      if (s === "meet2") return { title: "THE BUREAU", line: "Bring Voss the book" };
      if (s === "finale") return { title: "THE BUREAU", line: "File 4: the President" };
      return { title: "THE BUREAU", line: "Extraction" };
    },
    setRepaint: function (fn) { hitmanRepaint = fn; },
    // debug / playtest: jump the arc
    jump: function (step) {
      const a = arc(); if (!a || STEPS.indexOf(step) < 0) return false;
      if (RT.op) { teardownOp(RT.op); RT.op = null; }
      teardownMeet(false);
      if (step !== "street" && !a.lastStreet) { a.lastStreet = "the florist"; a.lastQuiet = true; }
      if (["ledger", "cargo", "book", "meet2", "finale"].indexOf(step) >= 0) { dictatorship(); a.kit.vial = Math.max(a.kit.vial | 0, 1); }
      if (["cargo", "book", "meet2", "finale"].indexOf(step) >= 0) a.kit.charge = Math.max(a.kit.charge | 0, 1);
      if (step === "meet2" || step === "finale") a.book = true;
      const M = CBZ.mission;
      if (M && M.live) M.live().forEach(function (m) { if (m.id.indexOf("agency-") === 0 && m.retire) m.retire("jump"); });
      a.step = step; commit();
      if (hitmanRepaint) hitmanRepaint();
      return true;
    },
    audit: function () {
      const a = arc();
      return {
        step: a ? a.step : null,
        op: RT.op ? { id: RT.op.id, staged: !!RT.op.staged, ped: !!RT.op.ped, leg: RT.op.leg, phase: RT.op.phase, identified: RT.op.identified, guards: guardsOf(RT.op).length, dead: RT.op.dead, rating: RT.op.rating } : null,
        finale: RT.fin ? { phase: RT.fin.phase, cars: RT.fin.cars.length, crowd: RT.fin.crowd.length, identified: RT.fin.identified, dead: RT.fin.dead, s: Math.round(RT.fin.s), total: Math.round(RT.fin.total || 0) } : null,
        meet: RT.meet ? { kind: RT.meet.kind, voss: !!RT.meet.voss, started: RT.meet.started } : null,
        dossier: !!D(),
      };
    },
    _rt: RT,
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
