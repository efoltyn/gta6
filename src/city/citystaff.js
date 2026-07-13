/* ============================================================
   city/citystaff.js — VISIBLE city life, TIED TO THE COMPANIES that own the
   buildings: people WAITING IN LINE at trending stores and STAFF standing
   around the offices their employer runs. Together with companies.js this is
   one feature — the firms in companies.js own the real estate; the people here
   are those firms' customers (queues) and employees (office staff):

     • a store gets a queue ONLY if a company manages it; the line is LONGER
       when that company is booming (a big portfolio reads as a "trending" store)
     • an office's visible headcount SCALES with how much real estate its
       company manages (a property empire keeps more staff on site)
     • CBZ.cityStaff.atLot(lot) → { company, role, count } so other systems can
       ask "who works/queues here and for whom"

   WHY a standalone decorative layer: the "real" walking crowd + its shared
   navigation brain (crowd.js / peds.js / citynav.js) is owned by a separate
   in-flight wave. To add the VISIBLE, company-linked queues/workers NOW without
   colliding, this file owns its OWN figures end-to-end — it reads companies.js
   (CBZ.cityCompanies) but never touches the crowd/ped/nav systems. Draw-call
   cheap (TWO InstancedMeshes for the whole city), static but for a gentle idle
   sway + a slow queue shuffle, and it shuts at night (stores closed). When the
   nav wave lands, real peds can replace these in place.
   ============================================================ */
(function () {
  if (!window.CBZ || !window.THREE) return;
  const CBZ = window.CBZ, THREE = window.THREE;

  const CAP = 180;
  const SPACING = 0.85;
  const STORE_KINDS = { clothing: 1, food: 1, electronics: 1, guns: 1, gun: 1, jewelry: 1, pawn: 1, hardware: 1, gym: 1, barber: 1, drugs: 1 };
  const TRENDING = { food: 1, clothing: 1, electronics: 1 };
  const OFFICE_KINDS = { bank: 1, security: 1, cityhall: 1, realtor: 1, airfield: 1, casino: 1 };
  const SKIN = [0xf1c8a0, 0xe0a878, 0xc98a5a, 0x8d5a36, 0x6b4226, 0xf3d2b3];
  const SHIRT = [0x4a6fa5, 0xb44b4b, 0x4caf6e, 0xe0a93b, 0x8a5ec9, 0x3a3f46, 0xc96f9b, 0x3f9c8a, 0xd0d0d6, 0x2f6fed];

  let bodyMesh = null, headMesh = null;
  let slots = [];          // { h, sway, line, idx, lat, fixed, x, z, company, lot }
  let lines = [];          // { ax, az, fx, fz, lx, lz, len, shuffleT, members[], co, dname, lot }
  let byLot = new Map();   // lot -> { company, role, count }
  let count = 0;
  let arenaRef = null, buildCool = 0, swayT = 0, feedT = 25, openF = 1;

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(),
    _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();

  function ensureMeshes() {
    if (bodyMesh) return;
    const bg = new THREE.BoxGeometry(0.46, 1.15, 0.28);
    const hg = new THREE.BoxGeometry(0.28, 0.32, 0.28);
    bodyMesh = new THREE.InstancedMesh(bg, new THREE.MeshLambertMaterial(), CAP);
    headMesh = new THREE.InstancedMesh(hg, new THREE.MeshLambertMaterial(), CAP);
    bodyMesh.frustumCulled = false; headMesh.frustumCulled = false;
    bodyMesh.castShadow = false; bodyMesh.receiveShadow = false;
    headMesh.castShadow = false; headMesh.receiveShadow = false;
    bodyMesh.count = 0; headMesh.count = 0;
    CBZ.scene.add(bodyMesh); CBZ.scene.add(headMesh);
  }

  function kindOf(lot) { return lot.kind || (lot.building && lot.building.shop && lot.building.shop.kind) || null; }
  function companyOf(lot) { return (CBZ.cityCompanies && CBZ.cityCompanies.objOfLot) ? CBZ.cityCompanies.objOfLot(lot) : (lot && lot._company) || null; }
  function districtName(arena, dq) { const d = arena && arena.districts && arena.districts[dq]; return (d && (d.name || d.kind)) || ("District " + ((dq | 0) + 1)); }

  function place(x, z, heading, line, idx, company, lot) {
    if (count >= CAP) return -1;
    const i = count++;
    slots[i] = { h: heading, sway: Math.random() * 6.28, line: line, idx: idx, lat: 0, fixed: line < 0, x: x, z: z, company: company || null, lot: lot || null };
    _c.setHex(SHIRT[(Math.random() * SHIRT.length) | 0]); bodyMesh.setColorAt(i, _c);
    _c.setHex(SKIN[(Math.random() * SKIN.length) | 0]); headMesh.setColorAt(i, _c);
    return i;
  }

  function build(arena) {
    // UNIFICATION GATE: wait for the company roster, then staff ONLY the
    // buildings a company manages — so every worker/customer is tied to a firm.
    if (!CBZ.cityCompanies || CBZ.cityCompanies.count() < 1) return false;

    const lots = arena.lots || [];
    let stores = [], offices = [];
    for (const lot of lots) {
      const b = lot.building; if (!b || !b.door) continue;
      if (!companyOf(lot)) continue;                 // company-managed only (the cross-link)
      const k = kindOf(lot);
      if (k && STORE_KINDS[k]) stores.push(lot);
      else if (k && OFFICE_KINDS[k]) offices.push(lot);
    }
    if (!stores.length && !offices.length) return false;

    ensureMeshes();
    count = 0; slots = []; lines = []; byLot = new Map();

    // STORE QUEUES — line out from the door, facing it. A store managed by a
    // booming company (big portfolio) is "trending" → a longer line.
    for (const lot of stores) {
      if (count >= CAP) break;
      const co = companyOf(lot);
      const d = lot.building.door;
      const nx = d.nx != null ? d.nx : 0, nz = d.nz != null ? d.nz : 1;
      const nl = Math.hypot(nx, nz) || 1, ux = nx / nl, uz = nz / nl;
      const lx = -uz, lz = ux;
      const k = kindOf(lot);
      const port = co ? co.lots.length : 1;
      const trending = TRENDING[k] || port >= 5;     // company success → a crowd
      const len = trending ? (6 + ((Math.random() * 4) | 0)) : (2 + ((Math.random() * 3) | 0));
      const heading = Math.atan2(-ux, -uz);
      const line = { ax: d.x + ux * 1.3, az: d.z + uz * 1.3, fx: ux, fz: uz, lx: lx, lz: lz,
        len: len, shuffleT: 3 + Math.random() * 5, members: [],
        co: co, dname: districtName(arena, lot.district), lot: lot };
      for (let j = 0; j < len && count < CAP; j++) {
        const i = place(0, 0, heading, lines.length, j, co ? co.name : null, lot);
        if (i >= 0) { slots[i].lat = (j % 2 ? 0.22 : -0.22); line.members.push(i); }
      }
      byLot.set(lot, { company: co ? co.name : null, role: "queue", count: line.members.length });
      lines.push(line);
    }

    // OFFICE STAFF — a cluster outside the entrance; headcount scales with the
    // managing company's real-estate portfolio (a property empire keeps more
    // people on site). These figures are that company's employees.
    //
    // ONE of them isn't decoration: companies.js stages a REAL, killable owner
    // ped (CBZ.cityMakePed, added to CBZ.cityPeds) right outside every
    // company's HQ door — see companies.js's spawnOwner(). At the HQ lot we
    // shave one body off the decorative cluster so the headcount reads right
    // (the owner stands in the spot a decorative figure would have), instead
    // of double-counting a person who's now a real, targetable NPC.
    for (const lot of offices) {
      if (count >= CAP) break;
      const co = companyOf(lot);
      const isHQ = !!(co && co.hq === lot && co.owner);
      const d = lot.building.door;
      const nx = d.nx != null ? d.nx : 0, nz = d.nz != null ? d.nz : 1;
      const nl = Math.hypot(nx, nz) || 1, ux = nx / nl, uz = nz / nl;
      const port = co ? co.lots.length : 1;
      const n = Math.max(0, 2 + Math.min(5, Math.floor(port / 2)) - (isHQ ? 1 : 0));
      let placed = isHQ ? 1 : 0;     // the real owner ped counts toward this lot's headcount too
      // FRONT DESK (CBZ.CONFIG.NPC_SCHEDULES): one clerk INSIDE the entrance,
      // just behind the doorway facing out — offices have teller counters but
      // had zero interior presence ("time at the front desk"). Stores are NOT
      // double-staffed here: every shop already posts a real vendor ped at its
      // vendorSpot (peds.js finishSpawn), so the desk gap was offices only.
      // Placed FIRST so the CAP always favors the desk over cluster bodies;
      // it rides the same openF night-close as every other figure.
      if (CBZ.CONFIG && CBZ.CONFIG.NPC_SCHEDULES && count < CAP) {
        const ci = place(d.x - ux * 2.4, d.z - uz * 2.4, Math.atan2(ux, uz), -1, -1, co ? co.name : null, lot);
        if (ci >= 0) placed++;
      }
      for (let j = 0; j < n && count < CAP; j++) {
        const fx = d.x + ux * (1.4 + Math.random() * 2.2) + (-uz) * (Math.random() - 0.5) * 3.0;
        const fz = d.z + uz * (1.4 + Math.random() * 2.2) + (ux) * (Math.random() - 0.5) * 3.0;
        const i = place(fx, fz, Math.random() * 6.28, -1, -1, co ? co.name : null, lot);
        if (i >= 0) placed++;
      }
      byLot.set(lot, { company: co ? co.name : null, role: "staff", count: placed });
    }

    arenaRef = arena;
    bodyMesh.count = count; headMesh.count = count;
    writeAll();
    return true;
  }

  function slotXZ(s) {
    if (s.fixed) return s;
    const ln = lines[s.line]; if (!ln) return s;
    const t = s.idx * SPACING;
    return { x: ln.ax + ln.fx * t + ln.lx * s.lat, z: ln.az + ln.fz * t + ln.lz * s.lat };
  }

  function writeAll() {
    if (!bodyMesh) return;
    if (openF <= 0.02) { bodyMesh.count = 0; headMesh.count = 0; bodyMesh.instanceMatrix.needsUpdate = true; headMesh.instanceMatrix.needsUpdate = true; return; }
    bodyMesh.count = count; headMesh.count = count;
    const fl = CBZ.floorAt || null;
    for (let i = 0; i < count; i++) {
      const s = slots[i], xz = slotXZ(s), gy = fl ? fl(xz.x, xz.z) : 0, bob = Math.sin(s.sway) * 0.03;
      _e.set(0, s.h, 0); _q.setFromEuler(_e);
      _p.set(xz.x, gy + 0.62 + bob, xz.z); _m.compose(_p, _q, _s); bodyMesh.setMatrixAt(i, _m);
      _p.set(xz.x, gy + 1.35 + bob, xz.z); _m.compose(_p, _q, _s); headMesh.setMatrixAt(i, _m);
    }
    bodyMesh.instanceMatrix.needsUpdate = true; headMesh.instanceMatrix.needsUpdate = true;
    if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
    if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true;
  }

  function shuffle(dt) {
    let moved = false;
    for (const ln of lines) {
      ln.shuffleT -= dt; if (ln.shuffleT > 0) continue;
      ln.shuffleT = 4 + Math.random() * 6;
      for (const si of ln.members) { const s = slots[si]; s.idx = (s.idx - 1 + ln.len) % ln.len; s.lat = (s.idx % 2 ? 0.22 : -0.22); }
      moved = true;
    }
    return moved;
  }

  // may the open/close flip happen NOW without a visible pop? True when no
  // staffed slot sits close to the player inside the camera's forward cone.
  // Runs only when the day/night dial actually wants to flip (rare), so the
  // ≤CAP distance scan is nothing. Flag off → always true (old behavior).
  function flipSafe() {
    if (!CBZ.CONFIG || !CBZ.CONFIG.NPC_SPAWN_HIDE) return true;
    const P = CBZ.player; if (!P || P.dead) return true;
    const yaw = (CBZ.cam ? CBZ.cam.yaw : 0);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (let i = 0; i < count; i++) {
      const xz = slotXZ(slots[i]);
      const rx = xz.x - P.pos.x, rz = xz.z - P.pos.z, d2 = rx * rx + rz * rz;
      if (d2 >= 45 * 45) continue;
      const rd = Math.sqrt(d2) || 1;
      if ((rx / rd) * fx + (rz / rd) * fz >= 0.35) return false;   // close AND on camera
    }
    return true;
  }

  // a rare feed line that makes the company↔queue link VISIBLE in the ticker
  function feedTie() {
    const busy = lines.filter(function (l) { return l.co && l.members.length >= 5; });
    if (!busy.length) return;
    const ln = busy[(Math.random() * busy.length) | 0];
    try { if (CBZ.cityFlavor) CBZ.cityFlavor("🛍️ Line out the door at " + ln.co.name + "'s store in " + ln.dname, "#bcd0ff"); } catch (e) {}
  }

  CBZ.cityStaff = {
    count: function () { return count; },
    atLot: function (lot) { const e = byLot.get(lot); if (!e) return null; const co = companyOf(lot); return { company: co ? co.name : null, role: e.role, count: e.count }; },
    reset: function () { count = 0; slots = []; lines = []; byLot = new Map(); arenaRef = null; if (bodyMesh) { bodyMesh.count = 0; headMesh.count = 0; } },
  };
  CBZ.cityStaffReset = CBZ.cityStaff.reset;

  CBZ.onUpdate(41.8, function (dt) {
    if (!CBZ.game || CBZ.game.mode !== "city") { if (bodyMesh && bodyMesh.count) { bodyMesh.count = 0; headMesh.count = 0; } return; }
    const arena = CBZ.city && CBZ.city.arena;
    if (!arena || !arena.lots) return;
    if (arena !== arenaRef || !count) {
      buildCool -= dt; if (buildCool > 0) return; buildCool = 1.0;
      try { build(arena); } catch (e) {}
      return;
    }
    const night = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    const want = night < 0.5 ? 1 : 0;
    let dirty = false;
    // SPAWN-IN GUARD (CBZ.CONFIG.NPC_SPAWN_HIDE): the open/close flip rewrites
    // EVERY figure at once — if the player is standing at a staffed lot looking
    // at it, whole queues would blink in (dawn) or vanish (dusk) on camera.
    // Defer the flip while any slot is close AND inside the forward cone; the
    // dial re-tries every tick, so the change lands the moment you look away.
    if (want !== (openF > 0.5 ? 1 : 0) && flipSafe()) { openF = want; dirty = true; }
    if (openF <= 0.02) { if (dirty) writeAll(); return; }
    feedT -= dt; if (feedT <= 0) { feedT = 26 + Math.random() * 12; feedTie(); }
    swayT += dt;
    const sh = shuffle(dt);
    if (swayT >= 0.09 || sh || dirty) {
      swayT = 0;
      for (let i = 0; i < count; i++) slots[i].sway += 0.6 + (i & 3) * 0.05;
      writeAll();
    }
  });
})();
