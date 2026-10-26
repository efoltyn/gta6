"use strict";
/* src/battle/colours.js — NPC War: THE COLOURS. An army fights under its
   flag, and the flag is IN the field, not only on the war room's card.

   THE BEARERS. One man in every thirty of an army that has a country (a
   platoon's worth) carries his country's flag on a staff strapped up his
   back, the cloth a metre clear of his helmet: a hundred Americans field
   four flags, a thousand Guards thirty-four, and a line reads as WHOSE line
   from across the dunes. The cloth is city/flags.js's own (the one flag
   system: the painted flag, the shared wind-driven cloth shader); the staff
   is a thin pole. It follows the man wherever he is drawn: a full rig (his
   object), or a row of the mass (src/battle/mass.js: the row is kept current
   for a full rig too, so a mass battle reads the row always). When he falls,
   his flag goes down with him and stays where he fell.

   THE TALLY. The two armies under their flags at the top of the screen, and
   how many of each are still standing. Nothing else.

   Every src/battle file shares ONE script scope (docs/npcwar/ARCHITECTURE.md). */

const COLOURS = { bearers: [], every: 30, root: null, poleGeo: null, poleMat: null, tallyT: 0, tallyKey: "", rowsAt: -1 };

// is body i of this side a bearer? (men only; a side with no country has none)
function bearerAt(team, i) {
  const S = SIDES[team];
  if (!S || !S.army || !S.nation) return false;
  if (unitIdAt(team, i) !== "men") return false;
  return i % COLOURS.every === 4 || (i === 0 && (team === "red" ? SET.redN : SET.blueN) <= 4);
}
COLOURS.begin = function () {
  COLOURS.clear();
  if (!CBZ.flags || !CBZ.flags.hand || typeof THREE === "undefined") return;
  COLOURS.root = new THREE.Group();
  COLOURS.root.name = "colours";
  CBZ.scene.add(COLOURS.root);
  if (!COLOURS.poleGeo) {
    // a 2.5 m staff, its foot at the origin, a brass finial
    COLOURS.poleGeo = new THREE.CylinderGeometry(0.014, 0.018, 2.5, 6);
    COLOURS.poleGeo.translate(0, 1.25, 0);
    COLOURS.poleGeo._shared = true;
    COLOURS.poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3226 });
    COLOURS.poleMat._shared = true;
    COLOURS.tipGeo = new THREE.SphereGeometry(0.035, 8, 6);
    COLOURS.tipGeo.translate(0, 2.52, 0);
    COLOURS.tipGeo._shared = true;
    COLOURS.tipMat = new THREE.MeshLambertMaterial({ color: 0xb8963e });
    COLOURS.tipMat._shared = true;
  }
  ["red", "blue"].forEach(function (team) {
    const n = team === "red" ? SET.redN : SET.blueN, S = SIDES[team];
    if (!S || !S.army || !S.nation) return;
    for (let i = 0; i < n; i++) {
      if (!bearerAt(team, i)) continue;
      const g = new THREE.Group();
      g.name = "colour-" + team + i;
      const pole = new THREE.Mesh(COLOURS.poleGeo, COLOURS.poleMat);
      pole.castShadow = true;
      g.add(pole);
      g.add(new THREE.Mesh(COLOURS.tipGeo, COLOURS.tipMat));
      // the cloth, hoist on the staff, fly downwind (+x of the group)
      const cloth = CBZ.flags.hand(g, { id: S.nation, fly: 1.15, top: 2.46, x: 0.016 });
      if (cloth) cloth.castShadow = true;
      g.visible = false;
      COLOURS.root.add(g);
      COLOURS.bearers.push({ team: team, i: i, g: g, man: null, row: -1, down: 0, downYaw: 0, dead: false, at: null });
    }
  });
  COLOURS.rowsAt = -1;
  COLOURS.tally(true);
};
COLOURS.clear = function () {
  if (COLOURS.root && COLOURS.root.parent) COLOURS.root.parent.remove(COLOURS.root);
  COLOURS.root = null;
  COLOURS.bearers.length = 0;
  const t = el("tally"); if (t) t.classList.remove("on");
};
// find each bearer's body: his row in the mass, or his object
function coloursResolve() {
  const B = COLOURS.bearers;
  if (MASS.on && STORE && STORE.cols.spawnI) {
    if (COLOURS.rowsAt === STORE.rows) return;
    COLOURS.rowsAt = STORE.rows;
    const C = STORE.cols, key = new Map();
    for (let k = 0; k < B.length; k++) if (B[k].row < 0) key.set((B[k].team === "red" ? 0 : 1) + ":" + B[k].i, B[k]);
    if (!key.size) return;
    for (let r = 0; r < STORE.rows; r++) {
      if (C.kind[r] !== 0 || C.life[r] === 0) continue;
      const b = key.get(C.side[r] + ":" + C.spawnI[r]);
      if (b) b.row = r;
    }
    return;
  }
  for (let k = 0; k < B.length; k++) {
    const b = B[k];
    if (b.man) continue;
    for (let j = 0; j < men.length; j++) {
      const m = men[j];
      if (m.team === b.team && m.i === b.i && !m.beast && !m.vehicle) { b.man = m; break; }
    }
  }
}
const _cw = { x: 1, z: 0 };
COLOURS.frame = function (dt) {
  if (!COLOURS.root) return;
  coloursResolve();
  // the cloth streams downwind (city/flags.js's own wind)
  const U = CBZ.flags._uniforms && CBZ.flags._uniforms.wind && CBZ.flags._uniforms.wind.value;
  if (U) { _cw.x = U.x; _cw.z = U.y; }
  const windYaw = Math.atan2(-_cw.z, _cw.x);
  const B = COLOURS.bearers, C = STORE ? STORE.cols : null;
  for (let k = 0; k < B.length; k++) {
    const b = B[k];
    let x, y, z, h, dead, live = false;
    if (MASS.on && C && b.row >= 0) {
      const r = b.row;
      x = C.x[r]; y = C.y[r]; z = C.z[r]; h = C.heading[r];
      dead = C.life[r] === 4 || C.life[r] === 3; live = C.life[r] !== 0;
      // a FULL man's group is where he really stands (crouch, ragdoll)
      const m = STORE.ref && STORE.ref[r];
      if (m && m.group) { x = m.group.position.x; y = m.group.position.y; z = m.group.position.z; h = m.group.rotation.y; }
    } else if (b.man) {
      const m = b.man;
      x = m.group.position.x; y = m.group.position.y; z = m.group.position.z; h = m.group.rotation.y;
      dead = !!(m.dead || m.fled); live = true;
      if (m.boarded || m.inVehicle) live = false;
    }
    if (!live) { b.g.visible = false; continue; }
    const g = b.g;
    g.visible = true;
    if (dead && !b.dead) { b.dead = true; b.downYaw = h + (k % 2 ? 1.2 : -1.2); b.at = { x: x, y: y, z: z }; }
    if (b.dead) {
      // the colours go down with him and stay where he fell
      b.down = Math.min(1, b.down + dt * 1.6);
      const e = b.down * b.down * (3 - 2 * b.down);
      g.position.set(b.at.x, b.at.y + 0.05, b.at.z);
      g.rotation.set(0, b.downYaw, -e * 1.45);
      continue;
    }
    // strapped up his back: behind the shoulders, a touch to the left
    const fx = Math.sin(h), fz = Math.cos(h);
    g.position.set(x - fx * 0.2 + fz * 0.1, y + 0.95, z - fz * 0.2 - fx * 0.1);
    g.rotation.set(0, windYaw, 0);
  }
  COLOURS.tallyT -= dt;
  if (COLOURS.tallyT <= 0) { COLOURS.tallyT = 0.25; COLOURS.tally(false); }
};
// the tally: [flag] USA 100   1000 IRGC [flag]
COLOURS.tally = function (force) {
  const t = el("tally");
  if (!t) return;
  // two armies under two flags; a war with an animal side has no tally
  const flagged = SIDES.red && SIDES.blue && SIDES.red.title && SIDES.blue.title;
  if (bench || !flagged || (!started && !force)) { t.classList.remove("on"); return; }
  const a = aliveCount("red"), b = aliveCount("blue");
  const key = a + "|" + b + "|" + TEAMS.red.name + "|" + TEAMS.blue.name;
  if (key === COLOURS.tallyKey && !force) return;
  COLOURS.tallyKey = key;
  const fa = flagURL("red"), fb = flagURL("blue");
  t.innerHTML = "<span class=\"ts tr\">" + (fa ? "<img alt=\"\" src=\"" + fa + "\">" : "") + esc(TEAMS.red.name) + " <b>" + a + "</b></span>" +
    "<i>V</i><span class=\"ts tb\"><b>" + b + "</b> " + esc(TEAMS.blue.name) + (fb ? "<img alt=\"\" src=\"" + fb + "\">" : "") + "</span>";
  t.classList.add("on");
};
