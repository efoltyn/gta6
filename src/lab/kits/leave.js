/* lab kit "leave": a person finishes his line and WALKS OUT. Nobody vanishes.

   OWNER (2026-10-14, the President's office): "There's a guy who starts on my
   left, says 'three folders on your desk, sir', and then he disappears ...
   They need to walk out of the room."

   A room (8 x 6 m, 3 m walls) with one door in the far wall (a real leaf on a
   hinge whose collider is a systems/bodydoors.js door: a body walking into it
   opens it, and it shuts behind him once the doorway is clear) and a short
   corridor turning right behind that wall. The PLAYER stands at the near
   wall watching the room (the camera is his eyes). A person stands on his
   left, says his line, and is handed to CBZ.leave (systems/leave.js), the
   one exit every game uses: he walks his route through the door and round
   the corner, and is removed only when nobody can see him.

   params: route door (default: through the door and round the corner) |
           away (no route: the leave layer picks the way, away from the camera)
           look 0 = the player turns his back at 3 s (removed sooner, unseen)
   probe: walked metres, when he went through the door, when he was removed,
          and IN VIEW AT DESPAWN, measured here independently of leave.js
          (the kit's own frustum + a segment test against the kit's own walls
          and leaf). ok = removed, never in view at removal, through the door. */
(function () {
"use strict";
const HX = 4, HZ = 3, WT = 0.2, WH = 3.0;          // room half-extents, wall thickness and height
const DOOR_X = 2.0, DOOR_W = 1.0;                  // the door in the far (+z) wall
const EYE = { x: 0.2, z: -2.3 };                   // where the player stands

function box(W, x0, x1, z0, z1, y0, y1, color, list) {
  const THREE = window.THREE;
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), new THREE.MeshStandardMaterial({ color: color, roughness: 0.85 }));
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = true; m.receiveShadow = true;
  W.scene.add(m);
  const c = { minX: x0, maxX: x1, minZ: z0, maxZ: z1, y0: y0, y1: y1, ref: m };
  (CBZ.colliderAdd || function (q) { CBZ.colliders.push(q); })(c);
  if (list) list.push(c);
  return { mesh: m, col: c };
}

CBZ.lab.kit("leave", {
  about: "a person in a room says his line and walks out through the door (CBZ.leave); removed only when the watching player cannot see him",
  uses: ["person", "player"],
  files: ["src/systems/leave.js", "src/systems/bodydoors.js"],
  params: { route: "door", look: 1 },
  duration: 16,
  setup: function (W, P) {
    const THREE = window.THREE;
    const walls = W.walls = [];
    const y0 = 0, y1 = WH;
    // the room: near wall (behind the player), left, right, far wall with the doorway
    box(W, -HX - WT, HX + WT, -HZ - WT, -HZ, y0, y1, 0xd9d2c3, walls);
    box(W, -HX - WT, -HX, -HZ, HZ, y0, y1, 0xd9d2c3, walls);
    box(W, HX, HX + WT, -HZ, HZ + 3.2, y0, y1, 0xd9d2c3, walls);
    box(W, -HX - WT, DOOR_X - DOOR_W / 2, HZ, HZ + WT, y0, y1, 0xd9d2c3, walls);
    box(W, DOOR_X + DOOR_W / 2, HX, HZ, HZ + WT, y0, y1, 0xd9d2c3, walls);
    // the corridor behind the far wall: its back wall, and its left end
    box(W, -HX - WT, HX + WT, HZ + 3.0, HZ + 3.2, y0, y1, 0xc9c0ae, walls);
    box(W, -HX - WT, -HX, HZ + WT, HZ + 3.0, y0, y1, 0xc9c0ae, walls);
    // THE DOOR: a leaf hung on its hinge (x = DOOR_X - w/2), swinging out into the corridor
    const pivot = new THREE.Group();
    pivot.position.set(DOOR_X - DOOR_W / 2, 0, HZ + WT / 2);
    W.scene.add(pivot);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W - 0.02, 2.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.6 }));
    leaf.position.set((DOOR_W - 0.02) / 2, 1.05, 0);
    leaf.castShadow = true;
    pivot.add(leaf);
    const col = { minX: DOOR_X - DOOR_W / 2, maxX: DOOR_X + DOOR_W / 2, minZ: HZ, maxZ: HZ + WT, y0: 0, y1: 2.1, ref: leaf };
    (CBZ.colliderAdd || function (q) { CBZ.colliders.push(q); })(col);
    const door = W.door = { open: false, col: col, pivot: pivot, swing: 0, id: "lab-door", label: "the door" };
    const PROV = {
      name: "lab",
      isOpen: function (d) { return d.open; },
      set: function (d, v) {
        if (d.open === !!v) return;
        d.open = !!v;
        if (d.open) { if (CBZ.colliderRemove) CBZ.colliderRemove(d.col); else { const i = CBZ.colliders.indexOf(d.col); if (i >= 0) CBZ.colliders.splice(i, 1); } }
        else (CBZ.colliderAdd || function (q) { CBZ.colliders.push(q); })(d.col);
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      },
      may: function () { return true; },
      bodies: function () { return [CBZ.npcs]; },
    };
    if (CBZ.bodyDoors) CBZ.bodyDoors.tag(col, PROV, door);
    // the leaf swings to where the door is (a quarter turn in ~0.6 s)
    W.every(function (dt) {
      const want = door.open ? -Math.PI / 2 : 0;
      door.swing += Math.max(-dt * 2.6, Math.min(dt * 2.6, want - door.swing));
      pivot.rotation.y = door.swing;
    });
    W.add("player", { name: "player", at: [EYE.x, EYE.z], yaw: 0 });
    W.add("person", { name: "aide", at: [-1.6, 0.6], yaw: 150, role: "exec", brain: false });
    W.watch("door", "door", function () { return door.open ? "open" : "shut"; });
    W.marks = { look: true };
    // THE PLAYER'S EYES: the camera stands where he stands and looks into the
    // room, before the leave layer asks who can see whom (update order 36.6)
    (CBZ.onUpdate || function () {})(36.5, function () {
      const pl = CBZ.player, c = CBZ.camera;
      if (!pl || !pl.pos || !c) return;
      c.aspect = 16 / 10; c.updateProjectionMatrix();
      c.position.set(pl.pos.x, (pl.pos.y || 0) + 1.62, pl.pos.z);
      if (W.marks.look) c.lookAt(0.6, 1.3, HZ);
      else c.lookAt(pl.pos.x, 1.4, pl.pos.z - 5);     // he turned round
      c.updateMatrixWorld(true);
    });
  },
  frame: function (W) { return W.subjects().concat(W.walls.map(function (c) { return c.ref; })); },
  script: function (W, P) {
    const aide = W.get("aide");
    const a = aide.actor;
    const route = String(P.route || "door");
    return [
      [0.3, function () { aide.say("Three folders on your desk, sir."); }, "aide: his line"],
      [2.6, function () {
        W.marks.leftAt = W.t();
        const opts = {
          tag: "lab:aide",
          walk: function (b, x, z) { aide.walkTo(x, z); },
          onGone: function (b, info) {
            W.marks.gone = info;
            W.marks.goneAt = W.t();
            W.marks.goneSeen = seenHere(W, a);
            W.event("aide", "removed (walked " + info.walked + " m)");
          },
        };
        if (route === "door") {
          // the nearest exit: in front of the door, through it, round the corner
          opts.exits = [{ x: HX - 0.8, z: HZ + 1.5, route: [{ x: DOOR_X, z: HZ - 0.8 }, { x: DOOR_X, z: HZ + WT / 2, door: true }, { x: DOOR_X, z: HZ + 1.5 }] }];
        }
        CBZ.leave.go(a, opts);
      }, "aide: done talking, CBZ.leave.go"],
      [3.0, function () { if (+P.look === 0) { W.marks.look = false; W.event("player", "turns his back"); } }, ""],
    ];
  },
  probe: function (W, P) {
    const g = W.marks.gone, ev = W.log;
    let opened = null;
    for (let i = 0; i < ev.length; i++) if (ev[i].who === "door" && ev[i].what === "door: open") { opened = ev[i].t; break; }
    const left = W.marks.leftAt || 0;
    const door = g && g.throughDoorAt != null ? +(left + g.throughDoorAt).toFixed(2) : null;
    const inView = W.marks.goneSeen ? W.marks.goneSeen.inView : null;
    // watched, he must have walked out; with the player's back turned he may
    // go the moment nobody sees him
    const watched = +P.look !== 0;
    const ok = !!g && inView === false && (!watched || ((String(P.route || "door") !== "door" || door != null) && g.walked > 2));
    const f = function (v) { return v == null ? "never" : (+v).toFixed(1) + " s"; };
    return {
      ok: ok,
      summary: g
        ? "walked " + g.walked.toFixed(1) + " m, door opened at " + f(opened) + ", through door at " + f(door) + ", despawned at " + f(W.marks.goneAt) +
          ", in view at despawn: " + inView + " (frustum " + W.marks.goneSeen.inFrustum + ", line of sight " + (W.marks.goneSeen.blockedBy || "clear") + ")"
        : "NOT removed by " + W.t().toFixed(1) + " s (" + JSON.stringify(CBZ.leave ? CBZ.leave.audit().live : null) + ")",
      data: { gone: g || null, seenAtDespawn: W.marks.goneSeen || null, doorOpenedAt: opened, throughDoorAt: door, leave: CBZ.leave ? CBZ.leave.audit() : null },
    };
  },
});

/* IN VIEW, measured by the kit and not by leave.js: the camera's frustum
   (THREE's own), then a segment from the eye to his head, chest and knees
   against the kit's own walls and the leaf (when shut). Any point that is
   inside the frustum with a clear segment = in view. */
function seenHere(W, a) {
  const THREE = window.THREE, c = CBZ.camera;
  const p = a.group.position;
  c.updateMatrixWorld(true);
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse));
  const boxes = W.walls.slice();
  if (!W.door.open) boxes.push(W.door.col);
  let anyIn = false, blockedBy = null;
  for (const h of [1.62, 1.1, 0.5]) {
    const q = new THREE.Vector3(p.x, p.y + h, p.z);
    if (!fr.containsPoint(q)) continue;
    anyIn = true;
    const hit = segHits(c.position, q, boxes, W.door.col);
    if (!hit) return { inView: true, inFrustum: true, blockedBy: null };
    blockedBy = hit;
  }
  return { inView: false, inFrustum: anyIn, blockedBy: anyIn ? blockedBy : "out of frame" };
}
function segHits(o, q, boxes, doorCol) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    let t0 = 0, t1 = 1;
    const ax = [[o.x, q.x - o.x, b.minX, b.maxX], [o.y, q.y - o.y, b.y0, b.y1], [o.z, q.z - o.z, b.minZ, b.maxZ]];
    let hit = true;
    for (let k = 0; k < 3 && hit; k++) {
      const s = ax[k][0], d = ax[k][1], lo = ax[k][2], hi = ax[k][3];
      if (Math.abs(d) < 1e-9) { if (s < lo || s > hi) hit = false; continue; }
      let u = (lo - s) / d, v = (hi - s) / d;
      if (u > v) { const w = u; u = v; v = w; }
      if (u > t0) t0 = u; if (v < t1) t1 = v;
      if (t0 > t1) hit = false;
    }
    if (hit && t1 > 0 && t0 < 1) return b === doorCol ? "the door" : "a wall";
  }
  return null;
}
})();
