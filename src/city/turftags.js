/* ============================================================
   city/turftags.js — WHO HOLDS THIS BLOCK, SPRAYED ON ITS WALL.

   Turf was a field on a lot record (building.gang / gangColor) that only the
   radar, the map and a strip of HUD chips ever read; standing on a block
   there was nothing to see but the people. A set marks what it holds: its
   letters, in its colour, on the front wall of every building it claims.
   When a block changes hands the tag changes with it, and that is the whole
   announcement on the street.

   One small pool of quads (the lots nearest you), one cached canvas per set.
   The wall and the spot on it come off the lot's own record through
   CBZ.cityLotFront (city/playergang.js): the door's side of the building's
   rect, near the corner of that wall, at chest height. No coordinates.

   Exposes: CBZ.cityTurfTagsDirty() (a block changed hands: re-read now).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const N = 10, RANGE = 120;
  const W = 1.9, H = 1.25;
  const pool = [];
  const texes = Object.create(null);
  let dirty = true, t = 0, lastX = 1e9, lastZ = 1e9, lastRoot = null;

  function hex6(n) { return "#" + ("000000" + (n >>> 0).toString(16)).slice(-6); }
  function gangOf(id) {
    const L = CBZ.cityGangs || [];
    for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === id) return L[i];
    return null;
  }
  // the set's letters: the capitals of its name ("Crimson Row" -> CR)
  function letters(name) {
    const w = String(name || "").replace(/^the\s+/i, "").split(/\s+/).filter(Boolean);
    if (!w.length) return "X";
    if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
    return (w[0][0] + w[w.length - 1][0]).toUpperCase();
  }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

  function texFor(id, color, name) {
    const key = id + "|" + color + "|" + name;
    if (texes[key]) return texes[key];
    const c = document.createElement("canvas"); c.width = 256; c.height = 168;
    const x = c.getContext("2d");
    const col = hex6(color), tx = letters(name);
    let s = hash(key);
    const r01 = function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    x.clearRect(0, 0, 256, 168);
    x.lineJoin = "round"; x.lineCap = "round";
    // the overspray: a soft cloud of the colour behind the letters
    for (let i = 0; i < 26; i++) {
      x.fillStyle = col; x.globalAlpha = 0.035 + r01() * 0.04;
      x.beginPath(); x.arc(40 + r01() * 176, 40 + r01() * 80, 14 + r01() * 26, 0, 6.283); x.fill();
    }
    x.globalAlpha = 1;
    x.save();
    x.translate(128, 86); x.rotate(-0.07 + r01() * 0.05);
    x.font = "italic 900 104px Impact, 'Arial Black', Arial, sans-serif";
    x.textAlign = "center"; x.textBaseline = "middle";
    x.strokeStyle = "rgba(12,12,16,0.92)"; x.lineWidth = 15; x.strokeText(tx, 0, 0);
    x.strokeStyle = "rgba(255,255,255,0.55)"; x.lineWidth = 5; x.strokeText(tx, 0, 0);
    x.fillStyle = col; x.fillText(tx, 0, 0);
    // the stroke under it, one pass of the can
    x.strokeStyle = col; x.lineWidth = 9;
    x.beginPath(); x.moveTo(-98, 58); x.quadraticCurveTo(-10, 46 + r01() * 14, 100, 60); x.stroke();
    // a crown of three ticks over the first letter
    x.lineWidth = 6;
    x.beginPath();
    x.moveTo(-84, -56); x.lineTo(-76, -70); x.lineTo(-66, -58); x.lineTo(-56, -72); x.lineTo(-46, -58); x.lineTo(-38, -70); x.lineTo(-30, -56);
    x.stroke();
    x.restore();
    // runs: paint that ran down the brick
    x.fillStyle = col;
    for (let i = 0; i < 5; i++) {
      const dx = 50 + r01() * 156, len = 10 + r01() * 22;
      x.globalAlpha = 0.75; x.fillRect(dx, 126, 3, len);
      x.beginPath(); x.arc(dx + 1.5, 126 + len, 2.4, 0, 6.283); x.fill();
    }
    x.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    if ("colorSpace" in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    texes[key] = tex;
    return tex;
  }

  function ensurePool(root) {
    if (pool.length && pool[0].mesh.parent === root) return;
    for (const p of pool) if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
    pool.length = 0;
    const geo = new THREE.PlaneGeometry(W, H);
    for (let i = 0; i < N; i++) {
      const mat = new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false; mesh.renderOrder = 2;
      mesh.userData.transient = true;
      root.add(mesh);
      pool.push({ mesh: mesh, lot: null, key: "" });
    }
  }

  function allLots(A) {
    return (A.annex && A.annex.lots && A.annex.lots.length) ? (A.lots || []).concat(A.annex.lots) : (A.lots || []);
  }

  function refresh() {
    const A = CBZ.city && CBZ.city.arena, P = CBZ.player;
    if (!A || !A.root || !P || !P.pos || !CBZ.cityLotFront) return;
    if (A.root !== lastRoot) { lastRoot = A.root; for (const k in texes) { try { texes[k].dispose(); } catch (e) {} delete texes[k]; } }
    ensurePool(A.root);
    const cands = [];
    for (const lot of allLots(A)) {
      const b = lot.building;
      if (!b || !b.gang || lot.demolished || b.deferred || !b.door) continue;
      const dx = lot.cx - P.pos.x, dz = lot.cz - P.pos.z, d2 = dx * dx + dz * dz;
      if (d2 > RANGE * RANGE) continue;
      cands.push({ lot: lot, d2: d2 });
    }
    cands.sort(function (a, b) { return a.d2 - b.d2; });
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i], c = cands[i];
      if (!c) { s.mesh.visible = false; s.lot = null; s.key = ""; continue; }
      const lot = c.lot, b = lot.building;
      const rec = gangOf(b.gang);
      const color = rec && rec.color != null ? rec.color : (b.gangColor != null ? b.gangColor : 0xb079ea);
      const name = (rec && rec.name) || b.gang;
      const key = b.gang + "|" + color + "|" + name + "|" + Math.round(lot.cx) + "," + Math.round(lot.cz);
      if (s.key !== key) {
        const f = CBZ.cityLotFront(lot);
        if (!f) { s.mesh.visible = false; s.lot = null; s.key = ""; continue; }
        // near one end of the front wall (a pier, not the door or a window bay)
        const side = (hash(key) & 1) ? 1 : -1;
        const along = Math.max(1.4, f.half - 1.25) * side;
        const x = f.mx + f.tx * along + f.ox * 0.07, z = f.mz + f.tz * along + f.oz * 0.07;
        let y = 0.1;
        if (CBZ.floorAt) { const gy = +CBZ.floorAt(x + f.ox * 0.6, z + f.oz * 0.6); if (isFinite(gy)) y = Math.max(0, Math.min(1.2, gy)); }
        s.mesh.position.set(x, y + 1.35, z);
        s.mesh.rotation.set(0, Math.atan2(f.ox, f.oz), 0);
        s.mesh.material.map = texFor(b.gang, color, name);
        s.mesh.material.needsUpdate = true;
        s.lot = lot; s.key = key;
      }
      s.mesh.visible = true;
    }
  }

  CBZ.cityTurfTagsDirty = function () { dirty = true; };
  // what is on the walls near you right now (a read, for looking at the work)
  CBZ.cityTurfTags = function () {
    const out = [];
    for (const s of pool) if (s.lot && s.mesh.visible) out.push({ gang: s.lot.building.gang, x: s.mesh.position.x, y: s.mesh.position.y, z: s.mesh.position.z, yaw: s.mesh.rotation.y });
    return out;
  };

  if (CBZ.onUpdate) CBZ.onUpdate(46.3, function (dt) {
    if (g.mode !== "city") { if (pool.length && pool[0].mesh.visible) for (const p of pool) p.mesh.visible = false; return; }
    t -= dt || 0;
    const P = CBZ.player;
    if (!P || !P.pos) return;
    const moved = Math.hypot(P.pos.x - lastX, P.pos.z - lastZ) > 8;
    if (!dirty && !moved && t > 0) return;
    if (!dirty && !moved) { t = 2; refresh(); return; }
    dirty = false; t = 2; lastX = P.pos.x; lastZ = P.pos.z;
    refresh();
  });
})();
