/* ============================================================
   city/jewelry.js — THE JEWELRY STORE smash-and-grab: the case IS the score.

   WHY: the loot economy's crown pieces (Rolex, Iced Watch, Diamond
   Necklace, the $5M Engagement Ring) only spawned in pockets — you had to
   get LUCKY to touch the jackpot tier. A glass case downtown holding them
   in plain sight is the purest make-money-show-off loop in the game: you
   WALK PAST your next score every day, and the only thing between you and
   it is 5mm of glass and a screaming alarm. Case → fence → chain on your
   neck for the whole street to read.

   The jewelry lot's shell (door/counter/clerk) already exists; buildings.js
   stamps lot.building.jewelry with four pre-clamped WORLD case anchors (two
   front, one mid-aisle feature island, the back VAULT case). TWO ways in:
   • LOUD — any bullet (fpsmode already rays every city shot through
     cityShatterRay) or melee swing breaks the case glass: the panes are
     registered as REAL city glass via CBZ.cityRegisterGlass, so cracks,
     shards, blasts and the new-run re-glaze are all the existing pane
     systems. Breaking one screams the alarm + charges burglary through
     CBZ.cityCrime (witnesses + cop-LOS → the NORMAL wanted flow, zero
     special-case police code). Then [E] scoops that case's pieces.
   • QUIET — at night, on a case the clerk can't see (the SAME posted
     vendor ped; their gaze + line-of-sight checked live — the vault sits
     at their BACK by design), [E] starts a slow pry: one piece, no alarm,
     but every pull risks the clerk turning around.
   Cases restock on a ~10-minute timer (the insurance payout re-stocks the
   shop — and the re-glazed glass invites you back).

   Loot is the REAL economy items (econ.add) so fencing/wearing/drip all
   work untouched. Perf: built ONCE per city on one group, shared geometries
   + materials for every ring/watch/bust, whole display vis-gated at 55m.
   Mode-gated + headless-guarded. The gunstore architecture, applied to ice.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const RESTOCK = 600;       // seconds an EMPTIED case stays bare (insurance re-stock)
  const VIS_R = 55;          // display group draws only when you're near the shop
  const REACH = 2.8;         // you smash/grab/pry at arm's length
  const LOOK_DOT = 0.55;     // you act on the case you're LOOKING at
  const PRY_TIME = 4.2;      // seconds a quiet pry takes (slow = the price of silence)
  const PRY_RISK = 0.22;     // per finished pry: chance the clerk turns around
  const NIGHT_MIN = 0.5;     // CBZ.nightAmount past this = dark enough to case it
  const ALARM_TIME = 18;     // how long the alarm screams after a smash
  const CASE_W = 1.35, CASE_D = 0.85;   // glass case footprint (long side faces the aisle)

  // what each case holds — REAL ITEMS names, value-tiered front → vault.
  // The Engagement Ring is the rotating showpiece: on display at open, then
  // only SOMETIMES back after a hit (a $5M stone isn't always on the floor).
  const STOCK = [
    ["Rolex", "Gold Chain", "Earrings"],            // front case (street ice)
    ["Diamond Ring", "Diamond Grill", "Gold Chain"],// front case (street ice)
    ["Iced Watch", "Iced Chain", "Diamond Pinky"],  // mid feature island (ICED tier)
    ["Diamond Necklace", "Diamond Tiara", "Engagement Ring"],   // the VAULT
  ];
  const RING_RESTOCK_ODDS = 0.35;   // the $5M rock returns to the vault this often

  const S = { lot: null, jw: null, group: null, cases: [], built: false,
              cur: null, pry: null, alarmT: 0, beepT: 0, prompt: null, lastTxt: "", cx: 0, cz: 0 };

  function econ() { return CBZ.cityEcon || null; }
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s); }

  // ---- shared geometries + materials (one each, flagged _shared) ------------
  let M = null, GEO = null;
  function mats() {
    if (M) return M;
    M = {
      body: new THREE.MeshLambertMaterial({ color: 0x2a2320 }),                                   // dark walnut pedestal
      vault: new THREE.MeshLambertMaterial({ color: 0x2c313a }),                                  // the vault's steel body
      brass: new THREE.MeshLambertMaterial({ color: 0xcaa64a }),                                  // brass trim
      velvet: new THREE.MeshLambertMaterial({ color: 0x4a1420 }),                                 // deep velvet pad
      glow: new THREE.MeshLambertMaterial({ color: 0xffe08a, emissive: 0xffe08a, emissiveIntensity: 0.6 }),  // case under-light (the trade's warm accent)
      gold: new THREE.MeshLambertMaterial({ color: 0xf0c33c, emissive: 0x8a6a14, emissiveIntensity: 0.35 }),
      silver: new THREE.MeshLambertMaterial({ color: 0xd8dde6, emissive: 0x6a7280, emissiveIntensity: 0.3 }),
      ice: new THREE.MeshLambertMaterial({ color: 0xeef6ff, emissive: 0xbcd8ff, emissiveIntensity: 0.75 }),  // diamonds READ from the door
    };
    Object.keys(M).forEach((k) => { M[k]._shared = true; });
    return M;
  }
  function geos() {
    if (GEO) return GEO;
    GEO = {
      box: new THREE.BoxGeometry(1, 1, 1),
      ring: new THREE.TorusGeometry(0.055, 0.018, 6, 12),
      band: new THREE.TorusGeometry(0.075, 0.016, 6, 12),
      link: new THREE.TorusGeometry(0.1, 0.014, 6, 14),
      gem: new THREE.OctahedronGeometry(0.045, 0),
      face: new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10),
      bust: new THREE.CylinderGeometry(0.07, 0.12, 0.24, 8),
    };
    Object.keys(GEO).forEach((k) => { GEO[k]._shared = true; });
    return GEO;
  }
  function mesh(geo, mat, sx, sy, sz) {
    const m = new THREE.Mesh(geo, mat);
    if (sx != null) m.scale.set(sx, sy == null ? sx : sy, sz == null ? sx : sz);
    m.castShadow = false; m.receiveShadow = false;
    return m;
  }

  // the tiny display model for a piece — shared geometry, 1-3 meshes each, so
  // the whole showroom of ice costs a few dozen draw-gated meshes total.
  function buildPiece(name) {
    const GG = geos(), m = mats();
    const grp = new THREE.Group();
    if (name === "Rolex" || name === "Iced Watch" || name === "Omega") {
      const band = mesh(GG.band, name === "Iced Watch" ? m.ice : m.gold);   // upright on its stand
      const face = mesh(GG.face, m.silver); face.rotation.x = Math.PI / 2; face.position.z = 0.0; face.position.y = 0.075;
      grp.add(band); grp.add(face);
    } else if (name === "Gold Chain" || name === "Iced Chain") {
      const link = mesh(GG.link, name === "Iced Chain" ? m.ice : m.gold);
      link.rotation.x = Math.PI / 2; link.position.y = 0.015;               // laid flat on the velvet
      grp.add(link);
    } else if (name === "Earrings") {
      for (const s of [-1, 1]) { const e = mesh(GG.gem, m.ice, 0.7); e.position.set(s * 0.05, 0.035, 0); grp.add(e); }
    } else if (name === "Diamond Grill") {
      const t = mesh(GG.box, m.silver, 0.12, 0.045, 0.07); t.position.y = 0.03;
      const i = mesh(GG.box, m.ice, 0.11, 0.02, 0.06); i.position.y = 0.062;
      grp.add(t); grp.add(i);
    } else if (name === "Diamond Necklace") {
      const b = mesh(GG.bust, m.velvet); b.position.y = 0.12;
      const c = mesh(GG.link, m.gold, 0.85); c.rotation.x = Math.PI / 2 - 0.35; c.position.y = 0.17;
      const p = mesh(GG.gem, m.ice, 0.8); p.position.set(0, 0.1, 0.075);
      grp.add(b); grp.add(c); grp.add(p);
    } else if (name === "Diamond Tiara") {
      const c = mesh(GG.link, m.silver, 1.1); c.rotation.x = Math.PI / 2; c.position.y = 0.02;
      for (let i = -1; i <= 1; i++) { const gm = mesh(GG.gem, m.ice, 0.7 + (i === 0 ? 0.35 : 0)); gm.position.set(i * 0.07, 0.055 + (i === 0 ? 0.02 : 0), 0.08); grp.add(gm); }
      grp.add(c);
    } else {  // rings: Diamond Ring / Diamond Pinky / the Engagement Ring
      const big = name === "Engagement Ring";
      const r = mesh(GG.ring, big ? m.silver : m.gold, big ? 1.2 : 1);
      const gm = mesh(GG.gem, m.ice, big ? 1.5 : 0.8); gm.position.y = big ? 0.1 : 0.075;
      grp.add(r); grp.add(gm);
    }
    return grp;
  }

  function tagSprite(text, color, sx, sy) {
    if (!CBZ.makeLabelSprite) return null;
    const s = CBZ.makeLabelSprite(text, { color: color || "#ffd166" });
    s.scale.set(sx || 1.6, sy || 0.4, 1);
    return s;
  }

  // ---- build the four cases once per city -----------------------------------
  function buildDisplays() {
    const e = econ(), jw = S.jw, m = mats(), GG = geos();
    const group = new THREE.Group();
    S.group = group;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    root.add(group);
    S.cx = (jw.bounds.minX + jw.bounds.maxX) / 2;
    S.cz = (jw.bounds.minZ + jw.bounds.maxZ) / 2;
    const tx = jw.tx, tz = jw.tz;
    // long side of every case faces the aisle (runs along the wall tangent)
    const gw = Math.abs(tx) * CASE_W + Math.abs(tz) * CASE_D;
    const gd = Math.abs(tz) * CASE_W + Math.abs(tx) * CASE_D;

    jw.cases.forEach((anchor, idx) => {
      const vault = !!anchor.vault;
      // pedestal (solid: you walk AROUND the score, never through it)
      const body = mesh(GG.box, vault ? m.vault : m.body, gw, 0.95, gd);
      body.position.set(anchor.x, 0.475, anchor.z); body.receiveShadow = true;
      group.add(body);
      const rim = mesh(GG.box, m.brass, gw + 0.06, 0.05, gd + 0.06);
      rim.position.set(anchor.x, 0.975, anchor.z);
      group.add(rim);
      const pad = mesh(GG.box, m.velvet, gw - 0.1, 0.05, gd - 0.1);
      pad.position.set(anchor.x, 1.02, anchor.z);
      group.add(pad);
      const glowStrip = mesh(GG.box, m.glow, gw - 0.16, 0.03, gd - 0.16);
      glowStrip.position.set(anchor.x, 1.045, anchor.z);
      group.add(glowStrip);
      // the GLASS TOP — registered as REAL city glass: bullets crack-then-burst
      // it (cityShatterRay), blasts/crashes pop it (cityShatter), a new run
      // re-glazes it (cityGlassReset). No bespoke shatter code at all.
      const pane = CBZ.cityRegisterGlass
        ? CBZ.cityRegisterGlass(group, anchor.x, 1.32, anchor.z, gw - 0.04, 0.52, gd - 0.04, 0, 0, null)
        : null;
      // keep the body solid for walkers (height-gated like showroom panes)
      const col = { minX: anchor.x - gw / 2 - 0.04, maxX: anchor.x + gw / 2 + 0.04,
                    minZ: anchor.z - gd / 2 - 0.04, maxZ: anchor.z + gd / 2 + 0.04, y0: 0, y1: 1.0 };
      if (CBZ.colliders) CBZ.colliders.push(col);

      const cs = { idx, x: anchor.x, z: anchor.z, tier: anchor.tier | 0, vault,
                   pane, pieces: [], smashed: false, charged: false, restockT: 0 };
      // the pieces, spread along the case's long side, each with its sticker
      const names = STOCK[Math.min(idx, STOCK.length - 1)];
      names.forEach((name, i) => {
        const it = e && e.ITEMS[name];
        if (!it) return;
        const lat = (i - (names.length - 1) / 2) * ((CASE_W - 0.35) / Math.max(names.length - 1, 1));
        const px = anchor.x + tx * lat, pz = anchor.z + tz * lat;
        const model = buildPiece(name);
        model.position.set(px, 1.07, pz);
        model.rotation.y = Math.atan2(-jw.inx, -jw.inz);   // pieces face the door
        group.add(model);
        const value = (e.buyPrice && e.buyPrice(name)) || it.value || 0;
        const tag = tagSprite(name + " · " + fmt$(value), cs.vault ? "#ffe08a" : "#ffd166", 1.5, 0.36);
        if (tag) { tag.position.set(px, 1.78 + (i % 2) * 0.3, pz); group.add(tag); }
        cs.pieces.push({ name, value, model, tag, taken: false,
                         showpiece: name === "Engagement Ring" });   // the rotating $5M exhibit
      });
      S.cases.push(cs);
    });
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }

  // ---- piece/case state ------------------------------------------------------
  function setTaken(p, on) {
    p.taken = !!on;
    if (p.model) p.model.visible = !on;
    if (p.tag) p.tag.visible = !on;
  }
  function piecesLeft(cs) { let n = 0; for (const p of cs.pieces) if (!p.taken) n++; return n; }
  function caseEmptied(cs) { cs.restockT = RESTOCK * (0.9 + Math.random() * 0.3); }
  function restock(cs) {
    cs.restockT = 0; cs.smashed = false; cs.charged = false;
    // re-glaze the case's own pane (mirrors cityGlassReset for one rec)
    if (cs.pane) { cs.pane.shattered = false; cs.pane.cracked = false; if (cs.pane.mesh) cs.pane.mesh.visible = true; }
    for (const p of cs.pieces) {
      // the $5M showpiece only SOMETIMES returns — scarcity keeps it a jackpot
      if (p.showpiece && Math.random() > RING_RESTOCK_ODDS) { setTaken(p, true); continue; }
      setTaken(p, false);
    }
    const P = CBZ.player;
    if (P && Math.hypot(P.pos.x - cs.x, P.pos.z - cs.z) < 30)
      note("💎 Fresh ice under new glass at " + S.jw.name + ".", 2.2);
  }

  // ---- the ALARM + the charge (normal wanted flow, no special cop code) ------
  function startAlarm(cs) {
    if (S.alarmT <= 0) {
      note("🚨 ALARM — " + S.jw.name + "! Every head on the block just turned.", 2.2);
      if (CBZ.sfx) CBZ.sfx("alarm");
      S.beepT = 1.4;
    }
    S.alarmT = ALARM_TIME;
    chargeCase(cs, 140, "burglary");
  }
  function chargeCase(cs, sev, type) {
    if (cs.charged) return;
    const P = CBZ.player;
    // only YOUR hit gets charged to you — a stray NPC firefight or runaway car
    // popping a case from across the map shouldn't frame the player.
    if (!P || Math.hypot(P.pos.x - cs.x, P.pos.z - cs.z) > 30) return;
    cs.charged = true;
    if (CBZ.cityCrime) CBZ.cityCrime(sev, { type, x: cs.x, z: cs.z });   // tags witnesses + cop-LOS → wanted
  }

  // ---- the CLERK's eyes (the existing posted vendor ped) ----------------------
  // gaze = alive, close, the case is in their forward cone, and no wall between.
  // The vault lives behind their counter post, at their BACK — by design.
  function clerkSees(x, z) {
    const v = S.lot && S.lot.building && S.lot.building.vendor;
    if (!v || v.dead || !v.pos) return false;
    const dx = x - v.pos.x, dz = z - v.pos.z, d = Math.hypot(dx, dz);
    if (d > 16) return false;
    if (d > 0.4) {
      const ry = v.group ? v.group.rotation.y : 0;
      const fx = Math.sin(ry), fz = Math.cos(ry);               // ped forward
      if ((dx / d) * fx + (dz / d) * fz < 0.3) return false;    // behind their back
    }
    if (CBZ.clearLineOfFire && !CBZ.clearLineOfFire(v.pos.x, (v.pos.y || 0) + 1.6, v.pos.z, x, 1.2, z)) return false;
    return true;
  }
  function isNight() { return (CBZ.nightAmount || 0) >= NIGHT_MIN; }
  function pryEligible(cs) {
    return !cs.smashed && (!cs.pane || !cs.pane.shattered) && piecesLeft(cs) > 0 && isNight() && !clerkSees(cs.x, cs.z);
  }

  // ---- LOUD: scoop a smashed case ---------------------------------------------
  function scoop(cs) {
    const e = econ();
    if (!e || piecesLeft(cs) === 0) return;
    // grabbing from someone ELSE's broken case is still theft if you weren't
    // already charged for the smash (witnesses decide, as always)
    chargeCase(cs, 90, "theft");
    let total = 0; const names = [];
    for (const p of cs.pieces) {
      if (p.taken) continue;
      setTaken(p, true);
      e.add(p.name, 1);
      total += p.value; names.push(p.name);
    }
    if (CBZ.sfx) CBZ.sfx("coin");
    note("💎 Scooped: " + names.join(" + ") + " — " + fmt$(total) + " in ice.", 2.6);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(total >= 90000 ? 8 : 3);   // the grab IS the flex
    if (total >= 200000 && CBZ.city && CBZ.city.big) CBZ.city.big("💎 " + fmt$(total) + " SMASH-AND-GRAB!");
    caseEmptied(cs);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // ---- QUIET: the slow pry ----------------------------------------------------
  function startPry(cs) {
    const P = CBZ.player;
    S.pry = { cs, t: 0, px: P.pos.x, pz: P.pos.z };
    note("🤫 Working the lock — stay still, stay quiet…", 1.4);
  }
  function cancelPry(why) {
    if (!S.pry) return;
    S.pry = null;
    if (why) note(why, 1.2);
  }
  function finishPry(cs) {
    S.pry = null;
    const e = econ();
    if (!e) return;
    let best = null;                       // you came for the priciest piece
    for (const p of cs.pieces) if (!p.taken && (!best || p.value > best.value)) best = p;
    if (!best) return;
    setTaken(best, true);
    e.add(best.name, 1);
    if (CBZ.sfx) CBZ.sfx("coin");
    note("🤫 Slipped the " + best.name + " (" + fmt$(best.value) + ") out clean — no alarm.", 2.4);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(best.value >= 90000 ? 6 : 2);
    if (piecesLeft(cs) === 0) caseEmptied(cs);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    // every pull risks the clerk turning around mid-lift
    const v = S.lot.building && S.lot.building.vendor;
    if (v && !v.dead && Math.random() < PRY_RISK) {
      note("👀 The " + (v.name || "Jeweler") + " spun around — you're MADE!", 2.2);
      startAlarm(cs);
    }
  }

  // ---- the look-pick + [E] prompt ---------------------------------------------
  function pickCase() {
    const P = CBZ.player, B = S.jw.bounds;
    const px = P.pos.x, pz = P.pos.z;
    if (px < B.minX - 1.5 || px > B.maxX + 1.5 || pz < B.minZ - 1.5 || pz > B.maxZ + 1.5) return null;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bestScore = -1;
    for (const cs of S.cases) {
      const dx = cs.x - px, dz = cs.z - pz, d = Math.hypot(dx, dz);
      if (d > REACH || d < 0.05) continue;
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot < LOOK_DOT) continue;
      const score = dot - d * 0.06;
      if (score > bestScore) { bestScore = score; best = cs; }
    }
    return best;
  }

  function promptText(cs) {
    const left = piecesLeft(cs);
    const broken = cs.pane && cs.pane.shattered;
    if (broken && left > 0)
      return "<b style='color:#ffd166'>[E]</b> Grab the ice <span style='color:#7f8794'>· " + left + " piece" + (left > 1 ? "s" : "") + " loose in the glass</span>";
    if (left === 0)
      return "<span style='color:#7f8794'>Cleaned out — the insurance re-stock is coming.</span>";
    if (S.pry && S.pry.cs === cs)
      return "<span style='color:#9fe0ff'>Prying… " + Math.round(100 * S.pry.t / PRY_TIME) + "%</span> <span style='color:#7f8794'>· don't move</span>";
    if (pryEligible(cs))
      return "<b style='color:#9fe0ff'>[E]</b> Pry the case <span style='color:#7f8794'>· slow + silent · one piece · the clerk might turn</span>";
    if (!isNight())
      return "<span style='color:#7f8794'>Locked case — too many eyes in daylight. The glass, though…</span>";
    return "<span style='color:#ff9e9e'>The " + ((S.lot.building.vendor && S.lot.building.vendor.name) || "Jeweler") + " is watching this case.</span> <span style='color:#7f8794'>· the glass, though…</span>";
  }

  function promptEl() {
    if (S.prompt) return S.prompt;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "jewelryPrompt";
    d.style.cssText = "position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:46;display:none;" +
      "background:rgba(13,16,21,.9);border:1px solid #3a4150;border-radius:12px;padding:7px 14px;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;font-size:15px;pointer-events:auto;cursor:pointer;text-align:center;max-width:78vw";
    d.addEventListener("click", function () { if (S.cur) actOn(S.cur); });   // tap-to-act (mobile)
    document.body.appendChild(d);
    S.prompt = d;
    return d;
  }
  function showPrompt(txt) {
    const el = promptEl();
    if (!el) return;
    if (txt !== S.lastTxt) { el.innerHTML = txt; S.lastTxt = txt; }
    if (el.style.display !== "block") el.style.display = "block";
  }
  function hidePrompt() {
    if (S.prompt && S.prompt.style.display !== "none") S.prompt.style.display = "none";
    S.cur = null;
  }

  function actOn(cs) {
    if (S.pry) return;                                 // hands are busy
    const broken = cs.pane && cs.pane.shattered;
    if (broken && piecesLeft(cs) > 0) { scoop(cs); return; }
    if (pryEligible(cs)) { startPry(cs); return; }
  }

  // ---- find the lot + build once (self-healing, gunstore pattern) ------------
  function ensure() {
    if (S.built) return true;
    const arena = CBZ.city && CBZ.city.arena;
    if (!arena || !econ() || !CBZ.cityRegisterGlass) return false;
    let lot = arena.jewelryLot || null;
    if (!(lot && lot.building && lot.building.jewelry)) {
      lot = null;
      const lots = arena.lots || [];
      for (let i = 0; i < lots.length; i++) { const L = lots[i]; if (L && L.building && L.building.jewelry) { lot = L; break; } }
    }
    if (!lot) return false;
    S.lot = lot; S.jw = lot.building.jewelry;
    buildDisplays();
    S.built = true;
    return true;
  }

  // ---- per-frame ---------------------------------------------------------------
  CBZ.onUpdate(38, function (dt) {
    if (!g || g.mode !== "city") { if (S.group && S.group.visible) S.group.visible = false; hidePrompt(); S.pry = null; return; }
    if (!ensure()) return;
    const P = CBZ.player;

    for (const cs of S.cases) {
      // someone (you, a bullet, a bumper) just broke this case's glass → ALARM.
      if (cs.pane && cs.pane.shattered && !cs.smashed) {
        cs.smashed = true;
        startAlarm(cs);
      }
      // a full city re-glaze (new run) restored the pane under us → fresh store
      if (cs.smashed && cs.pane && !cs.pane.shattered) restock(cs);
      // insurance re-stock keeps ticking while you're away
      if (cs.restockT > 0) { cs.restockT -= dt; if (cs.restockT <= 0) restock(cs); }
    }

    // the alarm screams in bursts until it times out (cops come via wanted flow)
    if (S.alarmT > 0) {
      S.alarmT -= dt; S.beepT -= dt;
      if (S.beepT <= 0) { if (CBZ.sfx) CBZ.sfx("alarm"); S.beepT = 1.6; }
    }

    // distance VIS-GATE: the showroom draws only when you're near the shop
    const dx = P.pos.x - S.cx, dz = P.pos.z - S.cz;
    const near = (dx * dx + dz * dz) < VIS_R * VIS_R;
    if (S.group && S.group.visible !== near) S.group.visible = near;
    if (!near || g.state !== "playing" || P.dead || P.driving || CBZ.cityMenuOpen) { hidePrompt(); cancelPry(); return; }

    // a live pry: stand still, stay close, and the case must stay intact
    if (S.pry) {
      const pr = S.pry, cs = pr.cs;
      const moved = Math.hypot(P.pos.x - pr.px, P.pos.z - pr.pz) > 0.5;
      const away = Math.hypot(P.pos.x - cs.x, P.pos.z - cs.z) > REACH + 0.8;
      if (moved || away) cancelPry("The pry slipped — you moved.");
      else if ((cs.pane && cs.pane.shattered) || piecesLeft(cs) === 0) cancelPry();
      else {
        pr.t += dt;
        if (pr.t >= PRY_TIME) finishPry(cs);
      }
      if (S.pry) { S.cur = cs; showPrompt(promptText(cs)); return; }
    }

    const cs = pickCase();
    if (!cs) { hidePrompt(); return; }
    S.cur = cs;
    showPrompt(promptText(cs));
  });

  // [E] acts on the case you're looking at. CAPTURE phase so the case wins the
  // key over interact.js's bubble listener; stopImmediatePropagation keeps one
  // press from ALSO opening the clerk's counter menu (the gunstore pattern).
  addEventListener("keydown", function (e) {
    if (!S.cur || !g || g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen || (CBZ.player && (CBZ.player.driving || CBZ.player.dead))) return;
    if ((e.key || "").toLowerCase() !== "e") return;
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    e.stopPropagation();
    actOn(S.cur);
  }, true);

  // a MELEE swing (fists/bat/knife — no gun drawn) on the case you're facing
  // smashes its glass: bullets already break it through fpsmode's
  // cityShatterRay pass, this gives the bat the same one-swing payoff.
  addEventListener("mousedown", function (e) {
    if (e.button !== 0 || !S.built || !g || g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen || !CBZ.player || CBZ.player.driving || CBZ.player.dead) return;
    if (CBZ.cityHasGun && CBZ.cityHasGun()) return;        // gunfire path handles glass itself
    const cs = pickCase();
    if (!cs || (cs.pane && cs.pane.shattered)) return;
    // pop just THIS case's pane through the shared glass system (sfx + shards
    // + the alarm transition above all follow from the pane state change)
    if (CBZ.cityShatter) CBZ.cityShatter(cs.x, cs.z, 0.8);
  });

  // ---- public hooks (headless/harness handles, gunstore-style) ----------------
  CBZ.cityJewelryLot = function () { return (S.built && S.lot) || null; };
  CBZ.cityJewelrySmash = function (i) {
    if (!ensure()) return false;
    const cs = S.cases[i | 0];
    if (!cs || (cs.pane && cs.pane.shattered)) return false;
    if (CBZ.cityShatter) CBZ.cityShatter(cs.x, cs.z, 0.8);
    return true;
  };
  CBZ.cityJewelryScoop = function (i) {
    if (!ensure()) return false;
    const cs = S.cases[i | 0];
    if (!cs || !(cs.pane && cs.pane.shattered) || piecesLeft(cs) === 0) return false;
    scoop(cs);
    return true;
  };
  CBZ.cityJewelryState = function () {
    if (!S.built) return null;
    return {
      alarm: S.alarmT > 0,
      cases: S.cases.map((cs) => ({ tier: cs.tier, vault: !!cs.vault, x: cs.x, z: cs.z,
        smashed: !!(cs.pane && cs.pane.shattered), left: piecesLeft(cs), restockT: cs.restockT })),
    };
  };
})();
