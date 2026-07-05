/* tools/aimlib.js — SELF-VERIFYING camera aiming for headless probes.
   Injected into the live page via Runtime.evaluate (it is plain in-page JS,
   not a Node module). Defines window.__aim.

   WHY THIS EXISTS: probes used to hand-roll teleport + yaw math, and one
   sign-convention mistake had a probe photographing the WRONG BUILDING for
   two full verification rounds while every numeric check passed. A camera
   that cannot prove its subject is in frame turns screenshots from evidence
   into noise. So this helper:
     1. AIMS — teleports the player to a sensible vantage (door-facing
        street for a lot, or an explicit offset) and sets CBZ.cam yaw/pitch.
     2. VERIFIES — waits for real rendered frames, then PROJECTS the target
        through the live camera (THREE .project → NDC). The target must land
        inside the frustum, in front of the camera, reasonably central.
     3. SELF-CALIBRATES — tries yaw and yaw+PI and a ladder of pitches,
        keeping the first candidate that verifies. A convention change in
        camera.js can never silently flip a probe's view again.
   Usage from a probe (evl = Runtime.evaluate with awaitPromise):
     await evl(<contents of this file>);
     const r = JSON.parse(await evl("__aim.atLot(window.__lot)"));
     if (!r.ok) FAIL — and say so, never screenshot-and-pretend.
*/
window.__aim = (function () {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  async function settle(n) { for (let i = 0; i < (n || 2); i++) await raf(); }

  function ndcOf(tx, ty, tz) {
    const v = new THREE.Vector3(tx, ty, tz);
    v.project(CBZ.camera);
    return v;
  }

  // occlusion PROXY: march the eye→target segment against collider AABBs
  // (colliders are the real occluders; raycasting meshes would false-hit the
  // invisible wall-batch originals). Colliders inside the target's own
  // footprint are ignored. Advisory only — glass/doors also register here.
  function blockers(tx, ty, tz, skipRect) {
    const cam = CBZ.camera.position;
    let n = 0;
    const cs = CBZ.colliders || [];
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!c || c.y1 == null) continue;
      if (skipRect && c.minX >= skipRect.minX && c.maxX <= skipRect.maxX && c.minZ >= skipRect.minZ && c.maxZ <= skipRect.maxZ) continue;
      // sample the segment coarsely (cheap, good enough for a yes/no count)
      for (let t = 0.08; t < 0.92; t += 0.06) {
        const x = cam.x + (tx - cam.x) * t, y = cam.y + (ty - cam.y) * t, z = cam.z + (tz - cam.z) * t;
        if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ && y > c.y0 && y < c.y1) { n++; break; }
      }
    }
    return n;
  }

  // aim the player-camera at world point (tx,ty,tz) from (px,pz), trying
  // yaw/pitch candidates until the target PROVABLY lands in frame.
  async function at(tx, ty, tz, px, pz, opts) {
    opts = opts || {};
    CBZ.player.pos.x = px; CBZ.player.pos.z = pz;
    CBZ.player.pos.y = opts.py != null ? opts.py : 1.5;
    const base = Math.atan2(tx - px, tz - pz);
    const yaws = [base + Math.PI, base];                 // known-good convention first
    const pitches = opts.pitch != null ? [opts.pitch] : [-0.02, -0.15, 0.12, -0.3, 0.28];
    const tried = [];
    for (const yaw of yaws) for (const pitch of pitches) {
      if (CBZ.cam) { CBZ.cam.yaw = yaw; if (typeof CBZ.cam.pitch === "number") CBZ.cam.pitch = pitch; }
      await settle(2);
      const v = ndcOf(tx, ty, tz);
      const ok = v.z < 1 && Math.abs(v.x) < 0.85 && Math.abs(v.y) < 0.85;
      tried.push({ yaw: +yaw.toFixed(2), pitch, ndc: { x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(3) }, ok });
      if (ok) {
        return { ok: true, ndc: tried[tried.length - 1].ndc, tried: tried.length,
                 blockers: blockers(tx, ty, tz, opts.skipRect), view: { px, pz }, target: { x: tx, y: ty, z: tz } };
      }
    }
    return { ok: false, tried, view: { px, pz }, target: { x: tx, y: ty, z: tz } };
  }

  // frame a LOT's building from the street its door faces (clear of
  // neighbours by construction), far enough back to see the whole facade.
  async function atLot(lot, opts) {
    opts = opts || {};
    const b = lot.building;
    const door = (b && b.door && b.door.nx != null) ? b.door
      : { x: lot.cx - lot.w / 2, z: lot.cz, nx: -1, nz: 0 };
    const back = opts.back != null ? opts.back : Math.max(lot.w, lot.d) * 0.55 + 26;
    const px = door.x + door.nx * back, pz = door.z + door.nz * back;
    const ty = opts.ty != null ? opts.ty : Math.min((b ? b.h : 6) * 0.45, 8);
    const skip = { minX: lot.cx - lot.w / 2, maxX: lot.cx + lot.w / 2, minZ: lot.cz - lot.d / 2, maxZ: lot.cz + lot.d / 2 };
    const r = await at(b ? b.ox : lot.cx, ty, b ? b.oz : lot.cz, px, pz, { skipRect: skip, py: opts.py, pitch: opts.pitch });
    return JSON.stringify(r);
  }

  // re-assert the last atLot view (post-blast shoves etc.) — same guarantees
  async function atPoint(tx, ty, tz, px, pz, opts) {
    return JSON.stringify(await at(tx, ty, tz, px, pz, opts || {}));
  }

  return { at, atLot, atPoint };
})();
