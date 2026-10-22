/* ISLES TOUR — tonight's work, photographed in the real game, for the morning.

   OWNER, 2026-10-22: The Isles is the game's world from now on, and "every
   building should matter in some way". Tonight a crew of builders made the
   island buildings into places: gun stores with real guns on the racks, pawn
   and jewellers' counters, outfitters and tailors, the bank with its
   strongroom, the loan shark, the police station with its cells and its
   cruisers, hotels and motels with beds you rent, and night that is actually
   dark. This sheet walks through all of it, one plate per place.

   WHAT EACH SIDE IS
   -----------------
   AFTER is this checkout. BEFORE is whatever build --before serves; the
   sensible one is the commit before tonight (5696ce8c), which has no
   archipelago at all. So for almost every island plate the BEFORE half is a
   plate that says "The Isles is not in this build", and that is the point:
   the AFTER half is all new. The last plate (the protest outside the
   President's residence, Gang City) exists on both sides and is a true pair.

   HOW A PLATE IS MADE
   -------------------
   One page per side. The first island subject boots The Isles through the
   title screen (the mode tile, then Play), waits for Port Royal to stand
   whole, freezes requestAnimationFrame and from then on moves the world only
   with CBZ.stepSim. Each subject then:
     - finds its building by use (CBZ.islandVenue.list(use)), on the island in
       force, nearest the town centre;
     - walks the player there and steps a couple of seconds so the place
       dresses itself the way it does for a player (shop goods dress when you
       are near, rooms wake within 50 m), with CBZ.leave.unseen briefly forced
       true so the clerks and street people the game only ever stands "where
       nobody is looking" are already at their posts;
     - puts the lens at eye height (inside, a front corner of the room looking
       at the back wall, where every fit-out puts its counter) and renders.
   A use with no fit-out registered on this build (another builder may still
   be finishing it) photographs a "not built yet" plate instead of an empty
   room pretending to be the feature. Highgate's offices are reached by
   flying the player there and stepping the streamer until it is the island
   in force. The Gang City plate switches mode in-page (CBZ.setMode +
   CBZ.startRun) and forces a protest with the President's own harness hook.

   Every subject's staging is defensive: a failure becomes a plate with the
   error on it, never a dead run (and --keep-going covers what slips past).
*/

const S = (id, label, focus, spec) => Object.assign({ id, label, focus }, spec);

const subjects = [
  S("port-royal-street-day", "Port Royal — a shopping street, 11:00",
    "Eye level on the footway of a shop street: the trades' names over their doors, traffic on the carriageway, the island's people on the pavement. This is the frame a player meets the town in.",
    { world: "isles", kind: "street", uses: ["guns", "jewelry", "pawn", "clothing", "phones", "eyewear", "suits"], hour: 11 }),
  S("gun-store-interior", "Gun store — inside",
    "Real weapon models on the wall racks (each one a mesh you pick up), the counter, the gunsmith behind it. Gang City's gun store standing in an island building.",
    { world: "isles", kind: "interior", uses: ["guns"], fit: true, hour: 11 }),
  S("pawn-interior", "Pawn shop — inside",
    "The pawnbroker's counter and the goods on his shelves: real things he buys and sells.",
    { world: "isles", kind: "interior", uses: ["pawn"], fit: true, hour: 11 }),
  S("jewelry-interior", "Jewellers — inside",
    "Glass cases with the stock in them, the jeweller behind the counter.",
    { world: "isles", kind: "interior", uses: ["jewelry"], fit: true, hour: 11 }),
  S("clothing-interior", "Outfitter — inside",
    "Rails of clothes that are the wardrobe's real garments.",
    { world: "isles", kind: "interior", uses: ["clothing"], fit: true, hour: 11 }),
  S("tailor-interior", "Tailor — suits",
    "The suit shop: tailored suits on the rails.",
    { world: "isles", kind: "interior", uses: ["suits"], fit: true, hour: 11 }),
  S("optician-phones-interior", "Optician / phone shop — inside",
    "Whichever of the optician or the phone shop is fitted on this build: glasses or phones on display, a clerk at the counter.",
    { world: "isles", kind: "interior", uses: ["eyewear", "phones"], fit: true, hour: 11 }),
  S("trade-shop-interior", "A trade — hardware / chandlery",
    "An ordinary trade (Hardware or the harbour Chandlery): what is on its shelves, its till.",
    { world: "isles", kind: "interior", uses: ["hardware", "chandlery", "grocer", "chemist"], hour: 11 }),
  S("bank-hall", "Bank — the banking hall",
    "Teller windows behind glass with a teller at each, the manager's office, the strongroom door at the back.",
    { world: "isles", kind: "interior", uses: ["bank"], fit: true, hour: 11 }),
  S("bank-vault", "Bank — inside the strongroom",
    "Standing inside the vault room behind the door: the money the bank keeps.",
    { world: "isles", kind: "vault", uses: ["bank"], fit: true, hour: 11 }),
  S("loan-shark-office", "Loan shark",
    "The cheque casher's counter behind glass; the back office with the man himself and his muscle.",
    { world: "isles", kind: "interior", uses: ["loans"], fit: true, hour: 11 }),
  S("police-station", "Police station — front desk and cells",
    "The desk sergeant at the front counter and, along the back wall, the holding cells with barred fronts.",
    { world: "isles", kind: "interior", uses: ["police"], fit: true, hour: 11 }),
  S("police-yard", "Police station — from the street",
    "The station house and the cruisers parked out front, where a patrol unit pulls out from.",
    { world: "isles", kind: "exterior", uses: ["police"], fit: true, hour: 11 }),
  S("hotel-lobby", "Hotel — lobby and front desk",
    "The ground floor of the hotel: the desk where you rent a room, the clerk behind it.",
    { world: "isles", kind: "interior", uses: ["hotel"], fit: true, hour: 11 }),
  S("hotel-room", "Hotel — a guest room",
    "A real guest room on an upper floor: queen bed, nightstands with lamps, TV, the bathroom door open.",
    { world: "isles", kind: "hotelroom", uses: ["hotel"], fit: true, hour: 11 }),
  S("motel", "Motel — from the ring road",
    "The motel, long and low on the ring road: the cheap bed for the night.",
    { world: "isles", kind: "exterior", uses: ["motel"], fit: true, hour: 11 }),
  S("city-hall", "Town hall",
    "The town hall, inside.",
    { world: "isles", kind: "interior", uses: ["cityhall"], fit: true, hour: 11 }),
  S("car-dealer", "Island Motors — the showroom",
    "The car dealer's showroom floor: new cars you can buy.",
    { world: "isles", kind: "interior", uses: ["cardealer"], fit: true, hour: 11 }),
  S("used-cars", "Used cars — the lot",
    "The used car lot from the street: cars for sale on the forecourt.",
    { world: "isles", kind: "exterior", uses: ["usedcars"], fit: true, hour: 11 }),
  S("recruitment-office", "Army recruiting office",
    "The recruiting office, inside.",
    { world: "isles", kind: "interior", uses: ["recruit"], fit: true, hour: 11 }),
  S("apartment-flat", "A flat over a shop",
    "Upstairs in a tall shop building: a flat someone lives in.",
    { world: "isles", kind: "interior", uses: ["apartments"], fit: true, floor: "upper", hour: 11 }),
  S("horizon-day", "From the shore — the next island, by day",
    "Standing on Port Royal's shore looking at the nearest island: its own silhouette (its far form, drawn from its own buildings) out on the sea.",
    { world: "isles", kind: "horizon", hour: 11 }),
  S("night-street", "The same street at 23:00",
    "The shop street at eleven at night: real darkness, street lamps, lit windows. Same tripod as the day plate.",
    { world: "isles", kind: "street", uses: ["guns", "jewelry", "pawn", "clothing", "phones", "eyewear", "suits"], hour: 23 }),
  S("night-horizon", "From the shore — the next island, at night",
    "The same shore at night: another island's lights on the horizon.",
    { world: "isles", kind: "horizon", hour: 23 }),
  S("office-floor", "Offices — a floor in a tower (Highgate)",
    "Highgate is the downtown island: its towers are offices. The player is flown there and the streamer builds it; this is a floor in one of its towers.",
    { world: "isles", kind: "interior", uses: ["office"], fit: true, floor: "mid", island: "highgate", hour: 11 }),
  S("white-house-crowd", "Gang City — the protest at the President's residence",
    "A second mode, same page: Gang City, a protest forced at the Mansion's gate (president_public's own harness hook). The crowd in the pen behind the bike racks, signs up, bullhorn leaders in front of it. This subject exists on both builds.",
    { world: "city", kind: "crowd", hour: 14 }),
];

/* ------------------------------------------------------------------------- *
   THE STAGE — shipped to the page by toString(): nothing outside it exists
   there, so every helper lives inside.
 * ------------------------------------------------------------------------- */
async function stageIslesTour(input) {
  const CBZ = window.CBZ, THREE = window.THREE;
  const sub = input.subject;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const end = Date.now() + budgetMs;
    while (Date.now() < end) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    try { return !!test(); } catch (_) { return false; }
  };
  const fmtHour = (h) => String(Math.floor(h) % 24).padStart(2, "0") + ":" + String(Math.round((h % 1) * 60)).padStart(2, "0");

  // ---- overlays: the plate (a whole frame of text) and the caption --------
  const ownDom = (el) => el && el.id && el.id.indexOf("__isles") === 0;
  const hideHud = () => {
    const canvas = CBZ && CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas)) || ownDom(child)) continue;
      child.style.visibility = "hidden";
    }
  };
  const dropOverlays = () => {
    for (const id of ["__islesPlate", "__islesCaption"]) { const el = document.getElementById(id); if (el) el.remove(); }
  };
  const caption = (text) => {
    let el = document.getElementById("__islesCaption");
    if (!el) {
      el = document.createElement("div");
      el.id = "__islesCaption";
      el.style.cssText = "position:fixed;left:14px;bottom:12px;z-index:2147483647;pointer-events:none;"
        + "font:600 13px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f4efe4;"
        + "background:rgba(10,14,20,.62);padding:5px 10px;border-radius:4px;letter-spacing:.02em";
      document.body.appendChild(el);
    }
    el.textContent = text;
  };
  const plate = (title, line, extra) => {
    hideHud();
    let el = document.getElementById("__islesPlate");
    if (!el) {
      el = document.createElement("div");
      el.id = "__islesPlate";
      el.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;"
        + "justify-content:center;align-items:center;text-align:center;padding:40px;box-sizing:border-box;"
        + "background:#0d131b;color:#e9e4d8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
      document.body.appendChild(el);
    }
    const esc = (s) => String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    el.innerHTML = "<div style='font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#8a96a6;margin-bottom:18px'>"
      + esc(sub.label) + "</div><div style='font-size:34px;font-weight:700;margin-bottom:14px'>" + esc(title)
      + "</div><div style='font-size:16px;color:#b8c0cb;max-width:760px;line-height:1.45'>" + esc(line) + "</div>";
    return Object.assign({ ok: true, plate: true, plateTitle: title, note: line }, extra || {});
  };

  dropOverlays();
  if (!CBZ || !THREE) return plate("Not in this build", "The page never put up CBZ/THREE.");

  // ---- the per-page state -----------------------------------------------
  let T = window.__islesTour;
  if (!T) {
    T = window.__islesTour = { frozen: false, compositor: null, booted: {}, failed: {}, street: null, camFar: null };
  }
  const g = CBZ.game;

  const tick = (n, dt) => {
    dt = dt || 1 / 30;
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      try { CBZ.stepSim(dt); } catch (_) {}
      const P = CBZ.player;
      if (P) { P.hp = Math.max(P.hp || 100, 90); P.dead = false; }
    }
  };
  // the clerks and the street crowd are only ever stood where nobody is
  // looking (systems/leave.js unseen): for the priming steps, nobody is
  const prime = (sec) => {
    const L = CBZ.leave, u0 = L && L.unseen;
    if (L && u0) L.unseen = function () { return true; };
    try { tick(Math.max(1, Math.round(sec * 30))); }
    finally { if (L && u0) L.unseen = u0; }
    tick(2);
  };
  const setHour = (h) => {
    if (typeof CBZ.dayPhase !== "function") return false;
    CBZ.dayPhase((((h - 6) / 24) % 1 + 1) % 1);
    return true;
  };
  const hourNow = () => (typeof CBZ.dayPhase === "function" ? ((CBZ.dayPhase() * 24 + 6) % 24) : 12);

  const freeze = async () => {
    if (T.frozen) return;
    const native = window.requestAnimationFrame.bind(window);
    T.compositor = native;
    window.requestAnimationFrame = function () { return 0; };
    T.frozen = true;
    // a loop callback may already be queued: let it run and fail to reschedule
    await new Promise((res) => native(() => native(res)));
    window.__cbzVisualCompare = {
      async render() {
        const C = window.CBZ;
        if (C && C.bootMeter && C.bootMeter.hide) { try { C.bootMeter.hide(); } catch (_) {} }
        if (!C || !C.renderer) return;
        try { C.renderer.render(C.scene, C.camera); } catch (_) {}
        await new Promise((res) => native(() => {
          try { C.renderer.render(C.scene, C.camera); } catch (_) {}
          native(() => res());
        }));
        await new Promise((r) => setTimeout(r, 400));
      },
    };
  };

  const titleReady = () => until(() => !!(CBZ.game && CBZ.stepSim && CBZ.bootComplete && document.getElementById("playBtn")), 360000, 300);

  const cityPrefs = () => {
    if (CBZ.CONFIG) { CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; CBZ.CONFIG.GANG_PERSIST = false; CBZ.CONFIG.CONTROLS_AUTO = false; }
  };

  // boot a mode: through the title screen while the page's own loop still
  // runs (the boot meter needs frames), programmatically once it is frozen
  const bootMode = async (mode) => {
    if (g.state === "playing" && g.mode === mode) return true;
    if (mode === "city") cityPrefs();
    if (!T.frozen) {
      if (g.state !== "title" && CBZ.setState) { try { CBZ.setState("title"); } catch (_) {} }
      const btn = document.querySelector('.mode-btn[data-mode="' + mode + '"]') || document.querySelector('[data-mode="' + mode + '"]');
      if (btn) btn.click();
      else if (CBZ.presentModeSwitch) CBZ.presentModeSwitch(mode);
      if (!(await until(() => g.mode === mode, 240000, 300))) { try { CBZ.setMode(mode); } catch (_) {} }
      const ok = await until(() => {
        if (g.state === "playing" && g.mode === mode) return true;
        const b = document.getElementById("playBtn"); if (b) b.click();
        return g.state === "playing" && g.mode === mode;
      }, 600000, 400);
      if (!ok) return false;
      await until(() => { const c = document.getElementById("bootload"); return !c || getComputedStyle(c).display === "none"; }, 60000, 100);
      return true;
    }
    try { CBZ.setMode(mode); } catch (e) { return false; }
    if (mode === "city" && CBZ.cityWorldStoreReady) {
      try { await Promise.race([CBZ.cityWorldStoreReady(6000), wait(7000)]); } catch (_) {}
    }
    try { CBZ.startRun(); } catch (e) { console.error("[isles-tour startRun]", e); }
    return g.state === "playing" && g.mode === mode;
  };

  // ---- THE ISLES ---------------------------------------------------------
  const islesReady = async () => {
    if (T.booted.isles) return { ok: true };
    if (T.failed.isles) return { ok: false, why: T.failed.isles };
    if (!(await titleReady())) { T.failed.isles = "the title screen never came up"; return { ok: false, why: T.failed.isles }; }
    const has = !!(CBZ.modes && CBZ.modes.archipelago && CBZ.archipelago) || !!document.querySelector('[data-mode="archipelago"]');
    if (!has) { T.failed.isles = "absent"; return { ok: false, why: "absent" }; }
    if (!(await bootMode("archipelago"))) { T.failed.isles = "The Isles never reached play"; return { ok: false, why: T.failed.isles }; }
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    try { if (CBZ.setFPS) CBZ.setFPS(false); } catch (_) {}
    const AR = CBZ.archipelago;
    const built = await until(() => { const s = AR.state(); return s.built && !!s.active; }, 300000, 300);
    if (!built) { T.failed.isles = "the spawn island never stood"; return { ok: false, why: T.failed.isles }; }
    await freeze();
    // the streamer's chores (venue fit-outs, people moving in) finish
    for (let i = 0; i < 60; i++) {
      tick(20);
      const s = AR.state();
      if (!s.chores || !s.chores.length) break;
    }
    setHour(11);
    prime(4);
    T.booted.isles = true;
    T.spawn = AR.state().active;
    return { ok: true };
  };

  const isle = () => (CBZ.surv && CBZ.surv.arena && CBZ.surv.arena.island) || CBZ.island || null;
  const isleName = () => {
    const AR = CBZ.archipelago, s = AR && AR.state && AR.state();
    const rec = s && AR.isles && AR.isles().find((I) => I.id === s.active);
    return rec ? rec.name : (s && s.active) || "";
  };
  const groundAt = (x, z) => {
    const I = isle();
    let y = null;
    try { if (I && I.groundAt) y = I.groundAt(x, z); } catch (_) {}
    if (!Number.isFinite(y)) { try { y = CBZ.archipelago.groundAt(x, z); } catch (_) {} }
    return Number.isFinite(y) ? y : 0;
  };
  const onIsle = (b) => {
    const I = isle();
    if (!I) return true;
    return (I.buildings || []).indexOf(b) >= 0 || (I.sites || []).indexOf(b) >= 0;
  };
  // travel: put the player on that island and step the streamer until it
  // is the island in force
  const travel = async (id) => {
    const AR = CBZ.archipelago;
    if (!AR) return false;
    if (AR.state().active === id) return true;
    const I = AR.isles().find((r) => r.id === id);
    if (!I) return false;
    const P = CBZ.player;
    const x = I.x + I.R * 0.2, z = I.z + I.R * 0.2;
    const t0 = Date.now();
    for (let n = 0; n < 6000 && Date.now() - t0 < 420000; n += 15) {
      P.pos.set(x, AR.groundAt(x, z) + 0.05, z); P.vy = 0; P.grounded = true;
      tick(15);
      const s = AR.state();
      if (s.active === id && (!s.chores || !s.chores.length)) return true;
    }
    return AR.state().active === id;
  };

  // which building: the use's buildings on the island in force, nearest the
  // town centre (the downtown trades are the ones a player meets first)
  const IV = CBZ.islandVenue;
  const lodgingHas = (use) => (use === "hotel" || use === "motel") && !!CBZ.islandLodging;
  const fitted = (use) => !!(IV && ((IV.has && IV.has(use)) || lodgingHas(use) || (use === "police" && CBZ.islandPolice)));
  const pick = (uses, needFit) => {
    const I = isle();
    const cx = I ? I.cx : 0, cz = I ? I.cz : 0;
    let any = null;
    for (const use of uses) {
      let L = IV && IV.list ? IV.list(use).filter(onIsle) : [];
      if (!L.length) continue;
      L.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
      if (!needFit || fitted(use)) return { b: L[0], use: use };
      if (!any) any = { b: L[0], use: use, unfitted: true };
    }
    return any;
  };

  // ---- the lens ----------------------------------------------------------
  const camera = CBZ.camera;
  if (T.camFar == null && camera) T.camFar = camera.far;
  const shoot = (pos, aim, fov, far) => {
    camera.fov = fov || 60;
    camera.aspect = input.width / input.height;
    camera.near = 0.05;
    camera.far = far || Math.max(T.camFar || 3000, 3000);
    camera.position.set(pos.x, pos.y, pos.z);
    camera.lookAt(aim.x, aim.y, aim.z);
    camera.updateProjectionMatrix();
    if (typeof CBZ.skySync === "function") { try { CBZ.skySync(); } catch (_) {} }
    else {
      const rig = CBZ.skyDome && CBZ.skyDome.parent;
      if (rig && rig.position) rig.position.set(pos.x, 0, pos.z);
    }
    hideHud();
    try { CBZ.renderer.setSize(input.width, input.height, false); } catch (_) {}
    try { CBZ.renderer.render(CBZ.scene, camera); } catch (_) {}
    return { position: { x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2) }, target: { x: +aim.x.toFixed(2), y: +aim.y.toFixed(2), z: +aim.z.toFixed(2) }, fov: camera.fov };
  };
  const PC = () => CBZ.playerChar;
  const placePlayer = (x, y, z, face) => {
    const P = CBZ.player;
    if (!P || !P.pos) return;
    P.pos.set(x, y, z); P.vy = 0; P.grounded = true;
    const pc = PC();
    if (pc && pc.group) {
      pc.group.position.copy(P.pos);
      if (face != null) pc.group.rotation.set(0, face, 0);
    }
  };
  const showPlayer = (on) => { const pc = PC(); if (pc && pc.group) pc.group.visible = !!on; };
  const wakeRooms = (b) => {
    const ud = b && b.group && b.group.userData;
    if (ud && ud.rooms) { ud.roomsOn = true; for (const o of ud.rooms) o.visible = true; }
  };
  const countNear = (x, z, r) => {
    let people = 0, cars = 0;
    for (const p of CBZ.cityPeds || []) {
      if (!p || p.dead) continue;
      const q = p.pos || (p.group && p.group.position);
      if (q && Math.hypot(q.x - x, q.z - z) < r) people++;
    }
    for (const c of CBZ.cityCars || []) {
      const q = c && ((c.group && c.group.position) || c.pos);
      if (q && Math.hypot(q.x - x, q.z - z) < r * 1.5) cars++;
    }
    return { people, cars };
  };
  const doorOf = (b) => {
    try {
      const lot = IV.lotFor(b);
      const D = lot && lot.building && lot.building.door;
      if (D && Number.isFinite(D.x)) {
        // the door's normal: from the building's middle out through the door
        let nx = D.x - b.x, nz = D.z - b.z;
        const l = Math.hypot(nx, nz);
        if (l > 0.5) { nx /= l; nz /= l; } else { nx = D.nx; nz = D.nz; }
        return { x: D.x, z: D.z, nx, nz };
      }
    } catch (_) {}
    const I = isle();
    let nx = I ? I.cx - b.x : 0, nz = I ? I.cz - b.z : 1;
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    return { x: b.x + nx * (b.d || 10) / 2, z: b.z + nz * (b.d || 10) / 2, nx, nz };
  };
  const clearOfBuildings = (x, z, m) => {
    const I = isle();
    for (const o of (I && I.buildings) || []) {
      if (Math.abs(x - o.x) < (o.w || 0) / 2 + m && Math.abs(z - o.z) < (o.d || 0) / 2 + m) return false;
    }
    return true;
  };

  // ---- the kinds of plate ---------------------------------------------------
  // INSIDE: a front corner of storey k, looking across to the back wall,
  // where every fit-out puts its counter (the door is on local -z, the
  // stair strip on local -x)
  const interiorShot = (b, k) => {
    const F = IV.floor(b, k), L = F.local;
    const W = L.x1 - L.x0, D = L.z1 - L.z0;
    const eyeL = { x: L.x0 + W * 0.78, z: L.z0 + Math.min(0.9, D * 0.1) };
    const aimL = { x: L.x0 + W * 0.42, z: L.z1 - 0.2 };
    const e = F.toWorld(eyeL.x, eyeL.z), a = F.toWorld(aimL.x, aimL.z);
    const mid = F.toWorld((L.x0 + L.x1) / 2, (L.z0 + L.z1) / 2);
    placePlayer(mid.x, F.y + 0.02, mid.z, null);
    prime(2.5);
    placePlayer(mid.x, F.y + 0.02, mid.z, null);
    wakeRooms(b);
    showPlayer(false);
    const cam = shoot({ x: e.x, y: F.y + 1.62, z: e.z }, { x: a.x, y: F.y + 1.05, z: a.z }, 64);
    const n = countNear(mid.x, mid.z, Math.max(W, D) * 0.6);
    return { cam, metrics: { peopleInside: n.people } };
  };
  // OUTSIDE: from across the street, three-quarter on, eye height
  const exteriorShot = (b) => {
    const D = doorOf(b);
    const tx = -D.nz, tz = D.nx;
    let ex = D.x + D.nx * 13, ez = D.z + D.nz * 13;
    let found = false;
    for (const dist of [13, 11, 15, 9, 17, 7]) {
      for (const side of [5, -5, 0, 9, -9]) {
        const x = D.x + D.nx * dist + tx * side, z = D.z + D.nz * dist + tz * side;
        if (clearOfBuildings(x, z, 0.8)) { ex = x; ez = z; found = true; break; }
      }
      if (found) break;
    }
    const gy = groundAt(ex, ez);
    placePlayer(D.x + D.nx * 4, groundAt(D.x + D.nx * 4, D.z + D.nz * 4) + 0.02, D.z + D.nz * 4, null);
    prime(2.5);
    showPlayer(false);
    const by = (b.gy != null ? b.gy : groundAt(b.x, b.z));
    const cam = shoot({ x: ex, y: gy + 1.7, z: ez }, { x: b.x, y: by + Math.min((b.h || 8) * 0.4, 6), z: b.z }, 58);
    const n = countNear(D.x, D.z, 30);
    return { cam, metrics: { peopleNear: n.people, carsNear: n.cars } };
  };
  // THE STREET: on the footway outside a shop, looking along the street
  const streetSpot = (b) => {
    const I = isle();
    const D = doorOf(b);
    const walkAt = I && I.roads && I.roads.walkAt;
    let s = 3, foot = 0;
    for (let k = 1.2; k <= 8; k += 0.4) {
      let w = -2;
      try { w = walkAt ? walkAt(D.x + D.nx * k, D.z + D.nz * k) : -2; } catch (_) {}
      if (w >= 0) { s = k; foot = w; break; }
    }
    const x = D.x + D.nx * s, z = D.z + D.nz * s;
    // along the street: the way with more named buildings ahead
    const tx = -D.nz, tz = D.nx;
    let score = [0, 0];
    for (const o of (I && I.buildings) || []) {
      if (!o.name) continue;
      const dx = o.x - x, dz = o.z - z, al = dx * tx + dz * tz, ac = dx * D.nx + dz * D.nz;
      if (Math.abs(ac) < 26 && Math.abs(al) < 80 && Math.abs(al) > 4) score[al > 0 ? 0 : 1]++;
    }
    const sg = score[0] >= score[1] ? 1 : -1;
    return { x, z, y: groundAt(x, z) + Math.max(0, foot || 0), dx: tx * sg, dz: tz * sg, nx: D.nx, nz: D.nz };
  };
  const streetShot = (b) => {
    if (!T.street) T.street = streetSpot(b);
    const s = T.street;
    // you, a few steps up the pavement, walking the way the lens looks
    const px = s.x + s.dx * 4.2 - s.nx * 0.4, pz = s.z + s.dz * 4.2 - s.nz * 0.4;
    const face = Math.atan2(s.dx, s.dz);
    placePlayer(px, s.y + 0.02, pz, face);
    prime(3);
    placePlayer(px, s.y + 0.02, pz, face);
    tick(1);
    showPlayer(true);
    const cam = shoot({ x: s.x, y: s.y + 1.75, z: s.z },
      { x: s.x + s.dx * 40 - s.nx * 5, y: s.y + 2.2, z: s.z + s.dz * 40 - s.nz * 5 }, 62);
    const n = countNear(s.x + s.dx * 20, s.z + s.dz * 20, 40);
    return { cam, metrics: { peopleNear: n.people, carsNear: n.cars } };
  };
  // THE HORIZON: the shore facing the nearest other island
  const horizonShot = () => {
    const AR = CBZ.archipelago, I = isle();
    const s = AR.state();
    const here = AR.isles().find((r) => r.id === s.active);
    if (!here || !I) throw new Error("no island in force");
    let best = null, bd = 1e12;
    for (const r of AR.isles()) {
      if (r === here) continue;
      const d = Math.hypot(r.x - here.x, r.z - here.z);
      if (d < bd) { bd = d; best = r; }
    }
    if (!best) throw new Error("no other island on the map");
    let dx = best.x - here.x, dz = best.z - here.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const sea = I.seaY != null ? I.seaY : 0;
    // walk out from the middle until the land gives out, then a few metres back
    let r0 = here.R * 0.6;
    for (let r = here.R * 0.6; r < here.R + 200; r += 2) {
      if (groundAt(here.x + dx * r, here.z + dz * r) < sea + 0.4) { r0 = r - 5; break; }
      r0 = r;
    }
    const x = here.x + dx * r0, z = here.z + dz * r0, gy = groundAt(x, z);
    placePlayer(x - dx * 3, gy + 0.02, z - dz * 3, null);
    prime(2);
    showPlayer(false);
    const cam = shoot({ x, y: Math.max(gy, sea) + 1.8, z }, { x: best.x, y: sea + 40, z: best.z }, 34, Math.max(12000, bd * 1.6));
    return { cam, metrics: { horizonKm: +(bd / 1000).toFixed(2) }, toward: best.name };
  };
  const vaultShot = (b) => {
    const F = IV.floor(b, 0);
    let v = null;
    try { v = (CBZ.cityVaults ? CBZ.cityVaults() : []).find((q) => (q._venue && q._venue.b === b) || (q.lot && q.lot.cx === b.ox && q.lot.cz === b.oz)) || null; } catch (_) {}
    if (!v) return null;
    // building-local: the strongroom runs from its partition (plz) back rd m
    const inz = v.inz != null ? v.inz : 1, inx = v.inx || 0;
    const tx = -inz, tz = inx;
    const eL = { x: v.plx + inx * 0.5 - tx * v.rw * 0.32, z: v.plz + inz * 0.5 - tz * v.rw * 0.32 };
    const aL = { x: v.plx + inx * (v.rd - 0.2) + tx * v.rw * 0.2, z: v.plz + inz * (v.rd - 0.2) + tz * v.rw * 0.2 };
    const e = F.toWorld(eL.x, eL.z), a = F.toWorld(aL.x, aL.z);
    placePlayer(e.x, F.y + 0.02, e.z, null);
    prime(2);
    wakeRooms(b);
    showPlayer(false);
    const cam = shoot({ x: e.x, y: F.y + 1.6, z: e.z }, { x: a.x, y: F.y + 0.8, z: a.z }, 66);
    return { cam, metrics: { vaultTier: v.tier === "reserve" ? 2 : 1 } };
  };
  const hotelRoomShot = (b) => {
    const LG = CBZ.islandLodging;
    const room = LG && LG.rooms ? LG.rooms().find((r) => r.b === b && r.use === "hotel" && r.box && r.door) : null;
    if (!room) return null;
    const B = room.box, ins = room.door.inside;
    const fy = ins.y - 1.2;
    placePlayer(ins.x, fy + 0.02, ins.z, null);
    prime(2);
    wakeRooms(b);
    showPlayer(false);
    // back off the door into the room's near corner, look at the bed (east wall)
    const ex = Math.max(B.minX + 0.4, Math.min(B.maxX - 0.4, ins.x - 0.2));
    const ez = Math.max(B.minZ + 0.4, Math.min(B.maxZ - 0.4, ins.z));
    const cam = shoot({ x: ex, y: fy + 1.62, z: ez }, { x: B.maxX - 1.0, y: fy + 0.7, z: (B.minZ + B.maxZ) / 2 }, 68);
    return { cam, metrics: {} };
  };

  // ---- GANG CITY -----------------------------------------------------------
  const crowdShot = async () => {
    if (!T.booted.city) {
      if (!T.frozen && !(await titleReady())) throw new Error("the title screen never came up");
      if (!(await bootMode("city"))) throw new Error("Gang City never reached play");
      try { if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts"; } catch (_) {}
      try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
      try { if (CBZ.disarmFPSAfterIntro) CBZ.disarmFPSAfterIntro(); } catch (_) {}
      try { if (CBZ.setFPS) CBZ.setFPS(false); } catch (_) {}
      await freeze();
      tick(60);
      T.booted.city = true;
    }
    const site = (CBZ.govComplexes || []).find((c) => c && c.id === "execmansion" && c.rect)
      || (CBZ.presidency && CBZ.presidency.site && CBZ.presidency.site());
    if (!site) return plate("Not in this build", "Gang City has no President's residence on this build.");
    setHour(sub.hour || 14);
    const pen = CBZ.perimeter && CBZ.perimeter.pen ? CBZ.perimeter.pen("execmansion") : null;
    const PP = CBZ.presidentPublic;
    let mobId = null;
    if (PP && PP._protestNow) { try { PP._protestNow(14); } catch (e) { console.error("[isles-tour protest]", e); } }
    else if (CBZ.mob && CBZ.mob.form && pen) {
      try { mobId = CBZ.mob.form({ at: pen.at, face: pen.face, size: 4000, side: "opposition", kind: "protest", place: "the Mansion", hold: true, quiet: true, width: 34, aspect: 1.7 }); } catch (_) {}
    } else return plate("Not in this build", "No protest system (president_public / mob) on this build.");
    try { const st = PP && PP._state && PP._state(); if (st && st.prot && st.prot.mob != null) mobId = st.prot.mob; } catch (_) {}
    const gate = (pen && pen.gate) || site.gate || { x: site.cx, z: site.rect.maxZ };
    let ox = pen && pen.out ? pen.out.x : 0, oz = pen && pen.out ? pen.out.z : 1;
    if (!(Number.isFinite(ox) && Number.isFinite(oz))) { ox = gate.x - site.cx; oz = gate.z - site.cz; const l = Math.hypot(ox, oz) || 1; ox /= l; oz /= l; }
    const at = (pen && pen.at) || { x: gate.x + ox * 8.2, z: gate.z + oz * 8.2 };
    const gy = (x, z) => { let y = 0; try { if (typeof CBZ.terrainHeight === "function") y = +CBZ.terrainHeight(x, z); } catch (_) {} return Number.isFinite(y) ? y : 0; };
    // you stand among them (the real rigs are the front rows and a ring round
    // the player), the lens is at the gate looking out at their faces
    placePlayer(at.x + ox * 7, gy(at.x + ox * 7, at.z + oz * 7) + 0.02, at.z + oz * 7, null);
    tick(240);
    let cx = at.x + ox * 9, cz = at.z + oz * 9;
    try {
      const m = mobId != null && CBZ.mob && CBZ.mob.get ? CBZ.mob.get(mobId) : null;
      if (m && m.centroid && Number.isFinite(m.centroid.x)) { cx = m.centroid.x; cz = m.centroid.z; }
    } catch (_) {}
    showPlayer(false);
    const ex = gate.x + ox * 2.2, ez = gate.z + oz * 2.2;
    const y0 = gy(ex, ez);
    const cam = shoot({ x: ex, y: y0 + 3.3, z: ez }, { x: cx, y: gy(cx, cz) + 1.3, z: cz }, 56);
    let n = 0;
    try { const m = mobId != null && CBZ.mob.get ? CBZ.mob.get(mobId) : null; if (m) n = m.agents | 0; } catch (_) {}
    caption("Gang City · the Mansion gate · " + fmtHour(hourNow()) + (n ? " · " + n + " in the crowd model" : ""));
    return { ok: true, camera: cam, metrics: { crowd: n } };
  };

  // =========================================================================
  try {
    if (sub.world === "city") return await crowdShot();

    const R = await islesReady();
    if (!R.ok) {
      if (R.why === "absent") return plate("The Isles is not in this build", "This build has no archipelago mode: there is nothing to photograph here. Everything on the other side of this pair is new.");
      return plate("The Isles did not start", R.why);
    }
    if (sub.island && CBZ.archipelago.state().active !== sub.island) {
      // only travel when the start island has none of these
      if (!pick(sub.uses || [], false)) {
        if (!(await travel(sub.island))) return plate("Could not reach " + sub.island, "The streamer never made " + sub.island + " the island in force.");
        T.street = null;
        setHour(sub.hour || 11);
        prime(3);
      }
    }
    if (sub.hour != null) { setHour(sub.hour); tick(8); }

    let r = null, b = null, use = null;
    if (sub.kind === "horizon") {
      r = horizonShot();
      caption(isleName() + " shore · toward " + r.toward + " · " + fmtHour(hourNow()));
      return { ok: true, camera: r.cam, metrics: r.metrics };
    }
    const got = pick(sub.uses || [], !!sub.fit);
    if (!got) return plate("Not on this island", "No building with use " + (sub.uses || []).join(" / ") + " stands on " + isleName() + ".");
    b = got.b; use = got.use;
    if (got.unfitted) {
      return plate("Not built yet", (b.name || use) + " stands on " + isleName() + " (use \"" + use + "\"), but no fit-out for it is registered on this build (CBZ.islandVenue.has(\"" + use + "\") is false).",
        { building: b.name || use });
    }
    if (sub.kind === "street") r = streetShot(b);
    else if (sub.kind === "exterior") r = exteriorShot(b);
    else if (sub.kind === "vault") {
      r = vaultShot(b);
      if (!r) return plate("No strongroom", (b.name || "The bank") + " has no vault room on this build (the floorplate refused one, or cityVaultRoom is off).");
    } else if (sub.kind === "hotelroom") {
      r = hotelRoomShot(b);
      if (!r) return plate("No guest room", (b.name || "The hotel") + " has no fitted guest room on this build.");
    } else {
      let k = 0;
      const n = Math.max(1, b.storeys | 0);
      if (sub.floor === "upper") k = n > 1 ? Math.min(n - 1, 2) : 0;
      else if (sub.floor === "mid") k = n > 2 ? Math.max(1, Math.floor(n / 2)) : (n > 1 ? 1 : 0);
      r = interiorShot(b, k);
    }
    const where = sub.kind === "street" ? "street" : (b.name || use);
    caption(isleName() + " · " + where + (sub.kind === "street" ? "" : " (" + use + ")") + " · " + fmtHour(hourNow()));
    return { ok: true, camera: r.cam, building: b.name || null, use: use, metrics: r.metrics || {} };
  } catch (err) {
    return plate("Staging failed", String((err && err.message) || err), { error: String((err && err.message) || err) });
  }
}

export default {
  id: "isles-tour",
  title: "The Isles — Tonight's Buildings, in the Game",
  description: "A walk through The Isles after the 2026-10-22 night shift: Port Royal's shop street by day and at 23:00, inside the gun store, pawn shop, jewellers, outfitter, tailor, optician/phone shop and a trade, the bank's hall and strongroom, the loan shark, the police station's desk and cells and its cruisers, the hotel's lobby and a guest room, the motel, town hall, Island Motors, the used car lot, the recruiting office, a flat, a Highgate office floor, the next island on the horizon by day and by night — and, in Gang City, the protest at the President's residence. Every plate is the real game booted through its title screen, not a studio.",
  beforeLabel: "BEFORE · LAST NIGHT'S BUILD",
  afterLabel: "AFTER · TONIGHT",
  viewport: { width: 1280, height: 800 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  stageTimeoutMs: 900000,
  pairNote: "Same page per side, booted once · the before build has no Isles, so its island halves are plates",
  method: "Each side boots The Isles through its title tile (mode button, then Play), waits for the spawn island to stand whole, freezes requestAnimationFrame and moves the world only with CBZ.stepSim from then on. Buildings are found by their use (CBZ.islandVenue.list) on the island in force, nearest the town centre. The player is walked into each place and the sim stepped ~2.5 s so it dresses itself as it would for a player; CBZ.leave.unseen is forced true for those steps only, so staff and street people the game stands 'where nobody is looking' are already there. Interiors are shot from a front corner at 1.62 m looking at the back wall. A use with no fit-out registered is photographed as a 'not built yet' plate. Highgate is reached by putting the player on it and stepping the streamer. The Gang City plate switches mode in-page (CBZ.setMode + CBZ.startRun) and forces a protest with CBZ.presidentPublic._protestNow.",
  metricsNote: "Counts are the live city/peds.js and vehicle lists near the subject at the moment of the shot: a quick check that the place is populated, not a score.",
  metrics: {
    peopleInside: { label: "People inside" },
    peopleNear: { label: "People near" },
    carsNear: { label: "Cars near" },
    crowd: { label: "Protest crowd (model)" },
  },
  subjects,
  stage: stageIslesTour,
};
