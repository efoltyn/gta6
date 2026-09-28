/* ============================================================
   city/los.js — shared "is there a clear line of fire from A to B?"

   Cops (police.js) and armed NPCs (combat.js / peds.js) call this BEFORE
   they shoot so they stop firing through buildings — and so their gun props
   stop poking out through walls. It reads the same CBZ.losBlockers mesh set
   the camera occlusion and guard vision already use (buildings register their
   walls into it at build time), so it stays consistent with what the player
   can actually see.

   TWO hard-learned rules live here now:
   • DUAL-DIRECTION: walls are FrontSide boxes and Mesh.raycast CULLS back
     faces — a muzzle poked INSIDE a wall box (a shooter pressed against the
     facade) starts its ray past the entry face, sees only culled back faces,
     and the wall simply vanishes from the test. That false "clear" was how
     people outside shot you through solid walls. The reverse pass (target →
     muzzle) sees that same wall's target-side face as a FRONT face and
     catches it.
   • OPEN WINDOWS ARE HOLES: a wall hit whose point sits inside a SHATTERED
     pane's rect (CBZ.cityShotHole, buildings.js) doesn't block — the frame
     is open air, so NPCs naturally fire through windows someone already
     broke. Intact glass never registers (panes aren't blockers; the solid
     wall behind them is), so an unbroken window still protects.

   MARGIN SCALES WITH WALL THICKNESS (refinement, NOT a redesign): both
   passes exempt the SAME flat 0.45-unit zone hugging the TARGET end of the
   line (forward pass: far = dist-0.45; reverse pass: near = 0.45 — they
   trim the identical physical slice, just expressed from opposite origins)
   so "a wall the target is standing flush against" doesn't self-block. The
   MUZZLE end intentionally keeps ZERO exemption on both passes — that's the
   hard-won shoot-through-walls fix (see DUAL-DIRECTION above) and is left
   completely untouched here; widening the muzzle-side margin would silently
   reopen it. The only change: the target-side 0.45 was a flat guess
   regardless of what's actually there. A thin interior partition (PWT≈0.16,
   buildings.js) doesn't need anywhere near that much slack — a flat 0.45
   happily exempted a wall nearly THREE TIMES its own thickness, which is
   exactly how a target standing at a thin corner got a false "clear" through
   a partition just past it. A thick exterior wall (WT=0.4) or a deep
   structural box can legitimately need close to (or a touch more than) 0.45
   to keep "the wall the target leans on" from self-blocking. targetMargin()
   below fires one quick probe ray from the target, back toward the muzzle,
   to find what's actually sitting there and derives the exemption from ITS
   real thickness (read off BoxGeometry.parameters along the struck face's
   axis — walls are axis-aligned boxes, same fact the dual-direction fix
   above already leans on). Non-box geometry (a cylindrical prop, say) or no
   hit at all falls back to the original 0.45 constant — strictly additive,
   never less safe than before at a spot this can't reason about.
   ============================================================ */
(function () {
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;

  const ray = new THREE.Raycaster();
  const probe = new THREE.Raycaster();
  const o = new THREE.Vector3(), dir = new THREE.Vector3();
  const MARGIN_DEFAULT = 0.45;   // original flat constant — the fallback whenever real thickness can't be read
  const MARGIN_MIN = 0.18;       // never exempt less than a thin partition's own real slack
  const MARGIN_MAX = 0.9;        // cap so a giant structural box can't exempt an absurd stretch of "wall on the target"
  const MARGIN_PAD = 0.08;       // a hair past the true thickness so the far/near edge of the box itself never re-triggers

  // Real thickness of the axis-aligned box mesh `obj` ALONG its local axis
  // closest to world `nx,nz` (the struck face's horizontal normal — walls in
  // this game are vertical boxes, so the relevant thickness is whichever of
  // width(x)/depth(z) the face points along). Returns null when the mesh
  // isn't a plain BoxGeometry (no .parameters) — callers fall back to the
  // flat constant rather than guess.
  function boxThicknessAlong(obj, nx, nz) {
    const geo = obj && obj.geometry, p = geo && geo.parameters;
    if (!p || p.width == null || p.depth == null) return null;
    // object-space normal == world normal for these axis-aligned walls (the
    // same assumption blockedBy() above already relies on for cityShotHole).
    return Math.abs(nx) >= Math.abs(nz) ? p.width : p.depth;
  }

  const _away = new THREE.Vector3();
  // Fire one short probe from the TARGET back along the muzzle direction to
  // find the nearest blocker mesh right at the target's end of the line, and
  // read its real thickness. Returns MARGIN_DEFAULT when nothing useful is
  // hit (no blocker there, or non-box geometry) — same fallback as before.
  function targetMargin(targetPt, dirAwayFromMuzzle, blk) {
    probe.set(targetPt, dirAwayFromMuzzle);
    probe.near = 0;
    probe.far = MARGIN_MAX + 0.5;   // a little past the max we'd ever return
    const hits = CBZ.losRaycast ? CBZ.losRaycast(probe, blk) : probe.intersectObjects(blk, false);
    if (!hits.length) return MARGIN_DEFAULT;
    const h = hits[0], n = h.face && h.face.normal;
    const t = boxThicknessAlong(h.object, n ? n.x : 0, n ? n.z : 0);
    if (t == null) return MARGIN_DEFAULT;
    return Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, t + MARGIN_PAD));
  }

  // does this sorted hit list actually BLOCK, or is every hit an open
  // (shattered) window hole the ray may pass through?
  function blockedBy(hits) {
    if (!hits.length) return false;
    const hole = CBZ.cityShotHole;
    if (!hole || (CBZ.game && CBZ.game.mode !== "city")) return true;
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i], n = h.face && h.face.normal;   // walls are axis-aligned: object-space normal == world
      if (!hole(h.point.x, h.point.y, h.point.z, n ? n.x : 0, n ? n.z : 0)) return true;
    }
    return false;
  }

  /* BULLETPROOF CARS. A car body is not a losBlocker (it moves, and a car is
     cover you can see over), so an NPC's line of fire used to pass straight
     through an armoured cabin to whoever sat in it. A car registered here
     (the state car, motorcade.js) is a closed box to gunfire: a lane that
     crosses its body is blocked, unless the muzzle is INSIDE it (the people
     in the car can still shoot out of a window they opened, as before).
     The player's own rounds already stop at every car body (fpsmode.js
     findCarHit); fpsmode's findActorHit reads `car.bulletproof` so the aim
     spheres of a rider cannot bulge out through the glass either. */
  const ARMORED = [];
  CBZ.bulletproofCar = function (car, on) {
    if (!car) return false;
    const i = ARMORED.indexOf(car);
    if (on === false) { if (i >= 0) ARMORED.splice(i, 1); car.bulletproof = false; return false; }
    if (i < 0) ARMORED.push(car);
    car.bulletproof = true;
    return true;
  };
  // segment A->B (t in [0,1]) against the car's yawed body box
  function cabinBlocks(ax, ay, az, bx, by, bz) {
    for (let i = ARMORED.length - 1; i >= 0; i--) {
      const c = ARMORED[i];
      if (!c || !c.bulletproof || !c.pos) { ARMORED.splice(i, 1); continue; }
      if (c.dead) continue;                            // a wreck has no glass left
      const d = c.dims || (c.group && c.group.userData && c.group.userData.vehicleDims) || null;
      const hx = (d && d.width ? d.width : 2.0) * 0.5 + 0.05;
      const hz = (d && d.length ? d.length : 4.8) * 0.5 + 0.05;
      const y0 = (c.pos.y || 0), y1 = y0 + (d && d.height ? d.height : 1.5) + 0.05;
      const h = c.heading || 0, ch = Math.cos(h), sh = Math.sin(h);
      // into the car frame: local +X = (cos h, -sin h), local +Z = (sin h, cos h)
      const lax = (ax - c.pos.x) * ch - (az - c.pos.z) * sh, laz = (ax - c.pos.x) * sh + (az - c.pos.z) * ch;
      const lbx = (bx - c.pos.x) * ch - (bz - c.pos.z) * sh, lbz = (bx - c.pos.x) * sh + (bz - c.pos.z) * ch;
      if (Math.abs(lax) < hx && Math.abs(laz) < hz && ay > y0 && ay < y1) continue;   // shooting from inside
      // aimed at somebody IN the car (an aim point is a head height, which on
      // a seated rider can sit a hair over the roof line): the glass takes it
      if (Math.abs(lbx) < hx && Math.abs(lbz) < hz && by > y0 && by < y1 + 0.6) return true;
      _t0 = 0; _t1 = 1;
      if (slab(lax, lbx - lax, -hx, hx) && slab(ay, by - ay, y0, y1) && slab(laz, lbz - laz, -hz, hz)) return true;
    }
    return false;
  }
  let _t0 = 0, _t1 = 1;
  function slab(o, dd, lo, hi) {
    if (Math.abs(dd) < 1e-9) return o >= lo && o <= hi;
    let u = (lo - o) / dd, v = (hi - o) / dd;
    if (u > v) { const s = u; u = v; v = s; }
    if (u > _t0) _t0 = u;
    if (v < _t1) _t1 = v;
    return _t0 <= _t1;
  }
  CBZ.bulletproofBlocks = cabinBlocks;

  const _target = new THREE.Vector3();
  // true  = clear shot (nothing solid between the muzzle and the target)
  // false = a wall/building is in the way → don't fire, reposition instead
  CBZ.clearLineOfFire = function (ax, ay, az, bx, by, bz) {
    if (ARMORED.length && cabinBlocks(ax, ay, az, bx, by, bz)) return false;
    const blk = CBZ.losBlockers;
    if (!blk || !blk.length) return true;
    o.set(ax, ay, az);
    dir.set(bx - ax, by - ay, bz - az);
    const dist = dir.length();
    if (dist < 0.0001) return true;
    dir.multiplyScalar(1 / dist);
    // ONE margin per call, read from whatever's actually sitting at the
    // TARGET end (probe fired target → muzzle, i.e. -dir) — shared by both
    // passes below exactly like the original flat 0.45 was, so the muzzle
    // end's exemption-free behaviour (the shoot-through-walls fix) is
    // completely unchanged.
    _target.set(bx, by, bz);
    _away.copy(dir).multiplyScalar(-1);
    const margin = targetMargin(_target, _away, blk);
    // forward pass: muzzle → target
    ray.set(o, dir);
    ray.near = 0;
    ray.far = Math.max(0.1, dist - margin); // ignore a wall sitting right on the target
    if (blockedBy(CBZ.losRaycast ? CBZ.losRaycast(ray, blk) : ray.intersectObjects(blk, false))) { ray.near = 0; return false; }
    // reverse pass: target → muzzle (catches the buried-muzzle case — see top).
    // near mirrors the forward pass's far margin: the first `margin` from the
    // target stays exempt so cover hugging the TARGET still doesn't block.
    o.set(bx, by, bz);
    dir.multiplyScalar(-1);
    ray.set(o, dir);
    ray.near = margin;
    ray.far = dist;
    const blocked = blockedBy(CBZ.losRaycast ? CBZ.losRaycast(ray, blk) : ray.intersectObjects(blk, false));
    ray.near = 0;   // never leak the near offset into the next caller
    return !blocked;
  };
})();
