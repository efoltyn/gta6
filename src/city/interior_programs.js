/* ============================================================
   city/interior_programs.js — THE INTERIOR ARCHETYPE KIT (intentionality
   doctrine, owner mandate).

   OWNER (verbatim intent): "a lot of interiors should be empty. I love the
   idea of an interior that's just desks and computers — chairs and a bunch
   of AIs sitting there, doing something. Some offices have random walls —
   if that's not what someone designed, things should be intentional. It
   should be empty, or it should be designed, or it should be a dystopian
   feeling — intentionally monotonous design. I don't want things designed
   because they have to be. I want them designed right."

   So every generated interior is ONE of:
     (a) INTENTIONALLY EMPTY — a clean lit shell. Floor, walls, windows,
         light. Nothing else. (Most interiors.)
     (b) A DESIGNED PROGRAM — one legible purpose executed consistently:
         "deskfarm" (ordered rows of identical desks + terminals + chairs,
         with REAL seated peds working them), "meeting" (one room, one
         table, space), "storage" (uniform rack rows), "lobby" (one front
         desk facing the door + a waiting row).
     (c) INTENTIONALLY MONOTONOUS — (b) at scale with ZERO variation:
         identical floors of identical rows. Callers get (c) for free —
         every program is a pure function of (room, host origin), so the
         same program on every storey repeats EXACTLY. Repetition here is
         the point, not a bug: one palette, one pitch, one facing.

   This file is the REUSABLE kit, not the policy. buildings.js decides WHICH
   tower gets WHICH archetype (its per-building hash); bunkers or any other
   structure builder can feed the same programs a minimal host object. No
   HUD, no popups, no colliders — pure room dressing + seat anchors.

   API:
     CBZ.interiorProgram(name, room, ctx) -> { anchors: [...] } | null
       name : "empty" | "deskfarm" | "meeting" | "storage" | "lobby"
       room : { x0, x1, z0, z1, y }  (host-LOCAL rect + floor lift)
       ctx  : { b, opts } — b is ANY host exposing:
                lbox(lx,ly,lz,w,h,d,color,opts)    REQUIRED (batch-safe box)
                clearFloorPoint(lx,lz,pad)->bool   optional aisle/stair gate
                ox, oz (world origin, default 0);  FH (storey height, 3.2)
              opts per program (lobby: {door:{x,z,nx,nz} host-local}).
       Anchors come back in WORLD coords ({x,y,z,face} — the peds facing
       convention) with lx/lz riding along so callers can convert to
       host-local population seats without re-deriving.

     CBZ.interiorStaff(id, root, seats, opts) -> nSeated
       Seat REAL city peds at desks via npclife's population layer (the
       seated-passenger grammar: attached rigs at true floor height,
       char.sitting, incremental fill, recreated after city resets, detach
       on death). seats are ROOT-LOCAL {x,y,z,yaw}. Citywide budget cap:
       CBZ.CONFIG.INTERIOR_STAFF_MAX. Feature-detected — without npclife
       the interiors stay furnished, just unstaffed. Deterministic seat
       LISTS come from the caller; the bodies themselves are runtime sim
       (Math.random identity, the npclife spawn convention).

   DRAW-CALL DISCIPLINE: every piece is an opaque cast:false box with no
   userData and no collider — exactly what core/batch.js folds into its
   per-colour merged buckets, so a whole desk-farm tower adds ≈0 draw
   calls. The palette deliberately REUSES the existing furnisher colour
   buckets (office desk/worktop/bezel/chair hexes) so no new buckets are
   minted. DETERMINISM: no Math.random, no shared rng() streams — geometry
   depends only on the room rect + CBZ.hash01 position hashes.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  // ---- the ONE palette (existing colour buckets; constant everywhere —
  // uniformity across every program floor IS the dystopian read) ----------
  const P = {
    floor: 0x33373f,      // tinted floor covering (apartment-floor bucket)
    light: 0xeef2ff,      // cool office ceiling strip (office bucket)
    desk: 0x55606e,       // desk/rack body (counter bucket)
    worktop: 0xc9ccd2,    // pale worktop (office bucket)
    bezel: 0x14181e,      // monitor/screen bezel (office bucket)
    screen: 0x9fb0c4,     // opaque lit-panel tint (office bucket, batch-safe)
    chair: 0x2a2f37,      // chair/bench (office bucket)
    wall: 0xb9bcc4,       // thin partition (roomKit PCOL bucket)
    table: 0x3a2b1e,      // meeting table (DARKWOOD bucket)
    shelf: 0x8a939c,      // rack shelf lines (shelf-top bucket)
    glow: 0x39516a,       // wall-screen glow (screen bucket)
    planter: 0x2e2620, leaf: 0x3f9a4f,
    // --- the OCCUPIED-STRUCTURE additions (checkpoint + boss suite). Every
    // hex below is an EXISTING city bucket (sandbag/crate/rug/upholstery
    // colours already minted by the street clutter + apartment furnishers),
    // so no new batch bucket is created by either new program.
    sack: 0x6b6350,       // sandbag / filled sack (clutter bucket)
    crate: 0x6d5a3c,      // shipping crate (clutter bucket)
    steel: 0x39414c,      // locker / rack steel (elevators STEEL bucket)
    lamp: 0xffd9a0,       // warm domestic lamp (interiorlight warm bucket)
    flood: 0xffe9b8,      // hard white worklight (streetlamp bucket)
    rug: 0x6b2f2c,        // deep red rug (apartment bucket)
    sofa: 0x3d4650,       // upholstery (apartment bucket)
    wood: 0x4a3524,       // warm wood (DARKWOOD lighter step)
    door: 0x4a3524,       // a flat's front door — the SAME hex as wood on
                          // purpose: a door is a read, not a new batch bucket.
    marble: 0xd9d5cc,     // pale stone worktop (civic bucket)
    water: 0x2e6f86,      // aquarium water (waterfield bucket)
    gold: 0xb99347,       // brass trim / picture frames (trim bucket)
  };
  const PWT = 0.16;       // thin partition thickness (roomKit idiom)
  // Screen glass is a surface, not paint. Keep a real 2.5cm air gap between
  // it and the bezel so merged static boxes and live CCTV quads never compete
  // for the same depth sample.
  const SCREEN_GAP = 0.025;

  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  // INTERIOR_COHERENCE_V1 — an interior is an ANSWER to "what is this building
  // for" (CBZ.interiorMix + the `residential`/`breakroom` programs). Off →
  // every dispatch falls back to the archetype roll it used before.
  if (CFG.INTERIOR_COHERENCE_V1 == null) CFG.INTERIOR_COHERENCE_V1 = true;
  // INTERIOR_LIFE_V1 — the people and the stakes: declared interior jobs
  // (through city/citystaff.js), residents asleep in real beds after dark, and
  // the occasional robbery in progress. Off → interiors are furnished and empty.
  if (CFG.INTERIOR_LIFE_V1 == null) CFG.INTERIOR_LIFE_V1 = true;
  // citywide ceiling on DECLARED interior jobs. citystaff.js caps live BODIES
  // (VENUE_STAFF_MAX); this caps how many rows we ever push into its list, so a
  // 400-lot city cannot bury the marina and the airside in office receptionists.
  if (CFG.INTERIOR_LIFE_MAX_POSTS == null) CFG.INTERIOR_LIFE_MAX_POSTS = 150;
  // (INTERIOR_SHELL_CLAMP is deliberately NOT defaulted here. The clamp below is
  //  a BUG FIX, not a feature — a piece of furniture outside its own building is
  //  never the design. `CBZ.CONFIG.INTERIOR_SHELL_CLAMP = false` remains an
  //  escape hatch if a host ever legitimately draws past its own footprint.)

  // ========================================================================
  //  THE SHELL IS THE LAW — an interior never leaves its building.
  //
  //  OWNER: "INTERIORS SHOULD NOT SPILL ONTO THE STREET AS MANY LIKE MERIDIAN
  //  TRUST DO."  Meridian Trust is buildings.js's bank, and the spill is not a
  //  bank bug — it is an ARITHMETIC DIALECT problem, and every dresser in the
  //  game speaks a different one:
  //
  //    roomKit / interiorFloorRoom measure from  ±(w/2 − wt − 0.4)   (inside)
  //    furnishInterior (the SHOP dresser, and the one that dresses the bank)
  //      measures every `lat` and `inDepth` from  ±w/2                (OUTSIDE)
  //
  //  So in the shop dresser "hug the side wall" is written as `halfTan − 1.1`
  //  and lands 0.3 m INSIDE the plaster, and the bank's vault partition
  //  (`vlat ± 2.2` about `halfTan − 2.0`) runs to `halfTan + 0.2` — a
  //  full-height pale slab ending 0.2 m OUT THROUGH THE FACADE, on the street.
  //  Chasing those call sites one at a time is the wrong fix; the next dresser
  //  re-types the same mistake. So the law lives in ONE place and every pass
  //  inherits it:
  //
  //    CBZ.interiorShellRect(b)     — the building's own inside, host-local
  //    CBZ.interiorBounded(b, fn)   — run a furnish pass with `b.lbox` clamped
  //
  //  Because EVERY interior box in this game is drawn through the host's own
  //  `lbox` — this kit's programs (`h.b.lbox`), roombuild.js's planner
  //  (`opts.box`), furniture.js's pieces (`opts.box`) and buildings.js's own
  //  furnishers — wrapping that ONE function for the duration of a pass covers
  //  all of them with no edit to any of them. A box wholly outside is REFUSED;
  //  a box straddling a wall is TRIMMED to the wall face rather than moved, so
  //  the design's alignment survives and only the part in the street is lost.
  // ========================================================================
  const SPILL = { checked: 0, clamped: 0, refused: 0, escaped: 0, unbounded: 0, sites: Object.create(null) };
  const SPILL_EPS = 0.005;

  CBZ.interiorShellRect = function (b) {
    if (!b || b.w == null || b.d == null) return null;
    const wt = b.wt != null ? b.wt : 0.4;
    const r = { x0: -b.w / 2 + wt, x1: b.w / 2 - wt, z0: -b.d / 2 + wt, z1: b.d / 2 - wt };
    if (!(r.x1 - r.x0 > 0.5) || !(r.z1 - r.z0 > 0.5)) return null;
    return r;
  };
  // clamp a host-LOCAL rect to the shell. The room resolver runs every rect it
  // hands out through this, so no program can even be ASKED to dress a band
  // that leaves the building.
  CBZ.interiorClampRect = function (b, rect) {
    const R = CBZ.interiorShellRect(b);
    if (!R || !rect) return rect;
    const x0 = Math.max(rect.x0, R.x0), x1 = Math.min(rect.x1, R.x1);
    const z0 = Math.max(rect.z0, R.z0), z1 = Math.min(rect.z1, R.z1);
    if (x0 !== rect.x0 || x1 !== rect.x1 || z0 !== rect.z0 || z1 !== rect.z1) {
      rect.x0 = x0; rect.x1 = x1; rect.z0 = z0; rect.z1 = z1;
    }
    return rect;
  };
  CBZ.interiorBounded = function (b, fn, site) {
    if (typeof fn !== "function") return null;
    const R = (CFG.INTERIOR_SHELL_CLAMP === false) ? null : CBZ.interiorShellRect(b);
    // nested pass (a furnisher calling a program calling the planner): the
    // outer wrap already owns b.lbox, so re-wrapping would double-count.
    if (!R || !b || typeof b.lbox !== "function" || b._interiorBound) {
      if (!R && b && typeof b.lbox === "function") SPILL.unbounded++;
      return fn();
    }
    const raw = b.lbox;
    const key = site || "interior";
    b._interiorBound = true;
    b.lbox = function (lx, ly, lz, bw, bh, bd, col, o) {
      SPILL.checked++;
      const hx = Math.abs(bw) / 2, hz = Math.abs(bd) / 2;
      const x0 = lx - hx, x1 = lx + hx, z0 = lz - hz, z1 = lz + hz;
      if (x0 < R.x0 - SPILL_EPS || x1 > R.x1 + SPILL_EPS ||
          z0 < R.z0 - SPILL_EPS || z1 > R.z1 + SPILL_EPS) {
        SPILL.sites[key] = (SPILL.sites[key] | 0) + 1;
        const cx0 = Math.max(x0, R.x0), cx1 = Math.min(x1, R.x1);
        const cz0 = Math.max(z0, R.z0), cz1 = Math.min(z1, R.z1);
        if (cx1 - cx0 < 0.03 || cz1 - cz0 < 0.03) { SPILL.refused++; return null; }
        SPILL.clamped++;
        lx = (cx0 + cx1) / 2; lz = (cz0 + cz1) / 2;
        bw = cx1 - cx0; bd = cz1 - cz0;
      }
      return raw.call(b, lx, ly, lz, bw, bh, bd, col, o);
    };
    try { return fn(); } finally { b.lbox = raw; b._interiorBound = false; }
  };

  // LATE FIXTURES ARE INTERIORS TOO. The clamp above can only see boxes drawn
  // through b.lbox. Walk-in modules such as bank.js, gunstore.js and forex.js
  // build raw THREE meshes after the shell is finished, often on the city root
  // in world coordinates. Register those groups here and the audit below tests
  // every physical mesh AABB against the same inner wall faces as b.lbox.
  //
  // Sprites are deliberately ignored: their camera-facing screen scale is not a
  // physical footprint. InstancedMesh is expanded instance-by-instance so an
  // airport bench at x=100 cannot hide behind its prototype geometry at x=0.
  const FIXTURE = { records: [], serial: 0 };

  function fixtureWorldShell(b) {
    const R = CBZ.interiorShellRect(b);
    if (!R) return null;
    const ox = b.ox != null ? +b.ox
      : (b.group && b.group.position ? +(b.group.position.x || 0) : 0);
    const oz = b.oz != null ? +b.oz
      : (b.group && b.group.position ? +(b.group.position.z || 0) : 0);
    const oy = b.group && b.group.position ? +(b.group.position.y || 0) : 0;
    const top = b.h != null ? oy + Math.max(0, +b.h) : Infinity;
    return {
      minX: ox + R.x0, maxX: ox + R.x1,
      minZ: oz + R.z0, maxZ: oz + R.z1,
      minY: oy, maxY: top,
    };
  }
  CBZ.interiorWorldShell = fixtureWorldShell;

  function boxContainment(b, box, eps) {
    const shell = fixtureWorldShell(b);
    eps = eps == null ? 0.02 : Math.max(0, +eps || 0);
    if (!shell || !box) return { inside: false, unbounded: true, shell: shell };
    const over = {
      left: Math.max(0, shell.minX - box.minX),
      right: Math.max(0, box.maxX - shell.maxX),
      front: Math.max(0, shell.minZ - box.minZ),
      back: Math.max(0, box.maxZ - shell.maxZ),
      below: Math.max(0, shell.minY - box.minY),
      above: isFinite(shell.maxY) ? Math.max(0, box.maxY - shell.maxY) : 0,
    };
    const outside = over.left > eps || over.right > eps || over.front > eps ||
      over.back > eps || over.below > eps || over.above > eps;
    return { inside: !outside, unbounded: false, shell: shell, overBy: over };
  }
  CBZ.interiorContainsWorldBox = boxContainment;

  CBZ.interiorTrackFixture = function (site, b, root, opts) {
    if (!b || !root) return null;
    const key = String(site || "late-fixture");
    // Re-registering a lazy module after an arena rebuild replaces its dead
    // record instead of growing an audit history across worlds.
    for (let i = FIXTURE.records.length - 1; i >= 0; i--) {
      const old = FIXTURE.records[i];
      if (old.root === root || (old.site === key && (!old.root || !old.root.parent)))
        FIXTURE.records.splice(i, 1);
    }
    const rec = { id: ++FIXTURE.serial, site: key, b: b, root: root, opts: opts || {} };
    FIXTURE.records.push(rec);
    return rec;
  };
  CBZ.interiorFixtureRegistry = function () {
    return FIXTURE.records.map(function (rec) {
      return {
        id: rec.id, site: rec.site,
        rootType: rec.root && rec.root.type || null,
        children: rec.root && rec.root.children ? rec.root.children.length : 0,
        parentType: rec.root && rec.root.parent && rec.root.parent.type || null,
        attached: fixtureAttached(rec.root, CBZ.city && CBZ.city.arena && CBZ.city.arena.root),
      };
    });
  };

  function fixtureAttached(root, arenaRoot) {
    if (!root || !root.parent) return false;
    if (!arenaRoot) return true;
    const seen = new Set();
    for (let p = root, depth = 0; p && depth < 128; p = p.parent, depth++) {
      if (p === arenaRoot) return true;
      if (seen.has(p)) return false;
      seen.add(p);
    }
    return false;
  }
  function finiteBox(b) {
    return b && isFinite(b.min.x) && isFinite(b.min.y) && isFinite(b.min.z) &&
      isFinite(b.max.x) && isFinite(b.max.y) && isFinite(b.max.z);
  }
  function plainBox(b) {
    return {
      minX: +b.min.x.toFixed(4), maxX: +b.max.x.toFixed(4),
      minY: +b.min.y.toFixed(4), maxY: +b.max.y.toFixed(4),
      minZ: +b.min.z.toFixed(4), maxZ: +b.max.z.toFixed(4),
    };
  }

  CBZ.interiorFixtureAudit = function (siteOnly) {
    const THREE = window.THREE;
    const arenaRoot = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
    const out = {
      fixtures: 0, pieces: 0, outsideFixtures: 0, escapedPieces: 0,
      unbounded: 0, invalid: 0, sites: {}, escapes: [],
    };
    if (!THREE) return out;
    const im = new THREE.Matrix4();
    const wm = new THREE.Matrix4();

    for (let ri = 0; ri < FIXTURE.records.length; ri++) {
      const rec = FIXTURE.records[ri];
      if (siteOnly && rec.site !== siteOnly) continue;
      if (!fixtureAttached(rec.root, arenaRoot)) continue;
      const shell = fixtureWorldShell(rec.b);
      const stat = out.sites[rec.site] || (out.sites[rec.site] = {
        fixtures: 0, pieces: 0, escaped: 0, unbounded: 0,
        shell: shell, bounds: null,
      });
      out.fixtures++; stat.fixtures++;
      if (!shell) { out.unbounded++; stat.unbounded++; continue; }
      let fixtureEscaped = false;
      const targets = typeof rec.opts.objects === "function"
        ? rec.opts.objects() : rec.opts.objects;
      const roots = targets && targets.length ? targets : [rec.root];

      function recordBox(raw, object, instance) {
        const keys = ["minX", "maxX", "minY", "maxY", "minZ", "maxZ"];
        for (let k = 0; k < keys.length; k++) {
          if (!isFinite(+raw[keys[k]])) { out.invalid++; return; }
        }
        if (+raw.minX > +raw.maxX || +raw.minY > +raw.maxY || +raw.minZ > +raw.maxZ) {
          out.invalid++; return;
        }
        const pb = {};
        for (let k = 0; k < keys.length; k++) pb[keys[k]] = +(+raw[keys[k]]).toFixed(4);
        out.pieces++; stat.pieces++;
        if (!stat.bounds) stat.bounds = Object.assign({}, pb);
        else {
          stat.bounds.minX = Math.min(stat.bounds.minX, pb.minX);
          stat.bounds.maxX = Math.max(stat.bounds.maxX, pb.maxX);
          stat.bounds.minY = Math.min(stat.bounds.minY, pb.minY);
          stat.bounds.maxY = Math.max(stat.bounds.maxY, pb.maxY);
          stat.bounds.minZ = Math.min(stat.bounds.minZ, pb.minZ);
          stat.bounds.maxZ = Math.max(stat.bounds.maxZ, pb.maxZ);
        }
        const hit = boxContainment(rec.b, pb, rec.opts.eps);
        if (hit.inside) return;
        fixtureEscaped = true;
        out.escapedPieces++; stat.escaped++;
        if (out.escapes.length < 80) out.escapes.push({
          site: rec.site,
          object: object || "declared-box",
          instance: instance == null ? null : instance,
          box: pb,
          shell: hit.shell,
          overBy: hit.overBy,
        });
      }

      function inspect(node) {
        if (!node || !node.isMesh || !node.geometry ||
            (node.userData && node.userData.interiorAuditIgnore)) return;
        const geo = node.geometry;
        if (!geo.boundingBox && geo.computeBoundingBox) geo.computeBoundingBox();
        if (!geo.boundingBox) { out.invalid++; return; }
        const count = node.isInstancedMesh ? Math.max(0, node.count | 0) : 1;
        for (let ii = 0; ii < count; ii++) {
          const bb = geo.boundingBox.clone();
          if (node.isInstancedMesh) {
            node.getMatrixAt(ii, im);
            wm.multiplyMatrices(node.matrixWorld, im);
            bb.applyMatrix4(wm);
          } else bb.applyMatrix4(node.matrixWorld);
          if (!finiteBox(bb)) { out.invalid++; continue; }
          recordBox(plainBox(bb), node.name || node.type || "Mesh",
            node.isInstancedMesh ? ii : null);
        }
      }
      for (let oi = 0; oi < roots.length; oi++) {
        const obj = roots[oi];
        if (!obj) continue;
        // Never let a malformed scene graph turn a QA query into an infinite
        // recursive traverse. The cap is orders above these small fixture
        // groups; hitting it is itself invalid audit data and therefore fails
        // the browser gate.
        const stack = [obj], seen = new Set();
        let walked = 0;
        while (stack.length) {
          const node = stack.pop();
          if (!node || seen.has(node)) { if (node) out.invalid++; continue; }
          seen.add(node);
          if (++walked > 20000) { out.invalid++; break; }
          if (node.updateWorldMatrix) node.updateWorldMatrix(true, false);
          else if (node.updateMatrixWorld) node.updateMatrixWorld(false);
          inspect(node);
          const kids = node.children || [];
          for (let ci = kids.length - 1; ci >= 0; ci--) stack.push(kids[ci]);
        }
      }
      // Static batching is allowed to move/remove source meshes after the
      // fixture builder runs. Owners can declare analytical world AABBs for
      // those pieces so optimization never erases them from the audit.
      const declared = typeof rec.opts.boxes === "function"
        ? rec.opts.boxes() : rec.opts.boxes;
      if (declared && declared.length) for (let bi = 0; bi < declared.length; bi++) {
        const dbox = declared[bi];
        if (!dbox) { out.invalid++; continue; }
        recordBox(dbox, dbox.name || "declared-box", bi);
      }
      if (fixtureEscaped) out.outsideFixtures++;
    }
    return out;
  };

  // host accessors — a buildings.js `b` satisfies this natively; other
  // builders pass any object with the same three-to-six fields.
  function host(ctx) {
    const b = ctx && ctx.b;
    if (!b || typeof b.lbox !== "function") return null;
    return {
      b: b,
      ox: b.ox != null ? b.ox : 0,
      oz: b.oz != null ? b.oz : 0,
      fh: b.FH != null ? b.FH : 3.2,
      clear: function (x, z, pad) {
        return !b.clearFloorPoint || b.clearFloorPoint(x, z, pad == null ? 0.7 : pad);
      },
    };
  }
  function cx(r) { return (r.x0 + r.x1) / 2; }
  function cz(r) { return (r.z0 + r.z1) / 2; }

  // ---- the SHELL every program starts from: floor + light. This alone IS
  // the "empty" archetype — a clean, finished, lit room with nothing in it.
  //
  // THE FLOOR LAW. The storey's walk surface is its slab top, r.y
  // (b.floorTops[k]: the platform physics stands every body on). A drawn
  // finish may sit at most 2 cm over it: FINISH is where this covering's top
  // is, and every rug, band or plinth a program lays goes on r.y, never on
  // an imagined covering. OWNER: "your feet go underground" — the covering
  // used to top out 4 cm over the slab and the state rooms laid rugs and
  // marble 17-21 cm over it, so every body stood inside the floor.
  // `dark` drops the ceiling strip: an UNLIT storey in a lit tower, which is a
  // deliberate read from the street and the one variant that must be per-FLOOR.
  const FINISH = 0.008;
  CBZ.INTERIOR_FINISH = FINISH;
  // a ceiling strip's height over a floor at y: flush under the slab above,
  // whose underside is floorTops[k+1] - 0.2. The ground floor's own top is
  // 0.14, not 0, so `h.fh - 0.205` put its strip 14 cm into the slab.
  function ceilOff(h, y) { return (y < 0.5 ? h.fh - y : h.fh) - 0.205; }
  function shell(h, r, dark) {
    const w = Math.max(1, r.x1 - r.x0), d = Math.max(1, r.z1 - r.z0);
    // r.y is a slab top (interiorProgram lifts a ground room onto the poured
    // slab); a slabless host at grade keeps its covering over the lot's
    // 0.10 yard pad (there is no slab to be flush with)
    const top = r.y < 0.1 ? r.y + 0.15 : r.y + FINISH;
    h.b.lbox(cx(r), top - 0.02, cz(r), w, 0.04, d, P.floor, { cast: false });
    if (dark) return;
    // FLUSH with the slab's underside (fh - 0.20), 1 cm deep: from the street
    // it is the lit ceiling of the floor; walked into, the fit-out's finished
    // ceiling (at ceil - 0.012) covers it and its own fixtures take over. The
    // old strip hung 8 cm below that ceiling as a glowing slab in mid-air.
    const m = h.b.lbox(cx(r), r.y + ceilOff(h, r.y), cz(r), Math.min(w * 0.6, 8.0), 0.01, 0.5, P.light,
      { emissive: P.light, ei: 0.32, cast: false });
    ceilingStrip(m);
  }
  // A TASK CHAIR (eager, 6 boxes): a cross base, a gas lift, the pad whose TOP
  // is exactly `cush` (the anchor's cushionH), a back on its stem behind the
  // sitter. (fx,fz) is the axis-aligned way the sitter looks. The old program
  // chairs were a pad and a back floating in the air with nothing under them.
  function taskChair(h, x, y, z, fx, fz, cush) {
    const L = h.b.lbox, o = { cast: false }, ax = Math.abs(fx) > 0.5;
    L(x, y + 0.035, z, 0.6, 0.03, 0.07, P.bezel, o);
    L(x, y + 0.035, z, 0.07, 0.03, 0.6, P.bezel, o);
    L(x, y + (cush - 0.07) / 2 + 0.025, z, 0.06, cush - 0.095, 0.06, P.bezel, o);
    L(x, y + cush - 0.035, z, 0.5, 0.07, 0.5, P.chair, o);
    L(x - fx * 0.25, y + cush + 0.05, z - fz * 0.25, ax ? 0.03 : 0.06, 0.16, ax ? 0.06 : 0.03, P.bezel, o);
    L(x - fx * 0.27, y + cush + 0.34, z - fz * 0.27, ax ? 0.07 : 0.46, 0.46, ax ? 0.46 : 0.07, P.chair, o);
  }
  // rect containment — programs that place relative to a DOOR (lobby) can
  // aim outside a small plate; hosts without clearFloorPoint get no bounds
  // check for free, so the kit carries its own.
  function inRect(r, x, z, m) { return x > r.x0 + m && x < r.x1 - m && z > r.z0 + m && z < r.z1 - m; }

  // ========================================================================
  //  A WALL YOU WALK THROUGH IS A PAINTING OF A WALL.
  //
  //  OWNER: "interiors have tons of fake walls and shit fake interiors, i dont
  //  like interior walls unless they are intentional, aka locked apartment you
  //  have key to that allows interior walls in an apartment building, bank
  //  vault, but i like open space and theres a lot of unnecessary walls rn."
  //
  //  So this kit now draws exactly TWO kinds of interior wall and no third:
  //    · a SOLID partition — a box WITH a collider, which is a boundary you
  //      have to walk AROUND, and is only drawn where the room on the far side
  //      is a real place: a flat, a vault, a named state room.
  //    · nothing at all.
  //  Every decorative divider that used to cut a desk farm, a meeting floor, a
  //  shop back-of-house or an office break corner in half is DELETED, not
  //  demoted — an office plate is one open floor now. The old `wallX`/`wallZ`
  //  were explicitly documented as "NON-collider ... invisible to the carve/
  //  breach picker", which is the whole complaint written down as a feature.
  //
  //  Cost: a solid partition is a box with a y-banded collider, exactly like
  //  every facade wall the same lbox already draws. core/batch.js still MERGES
  //  it (a collider-referenced mesh goes down the wall path, keeps its identity
  //  hidden for LOS/carve and costs no extra draw call), so open-plan-by-
  //  default is a net REDUCTION in geometry and the survivors are free.
  // ========================================================================
  const WALLOPT = { cast: false, solid: true };
  const WALL_TALLY = { solid: 0, doors: 0 };

  // a SOLID partition along X at fixed z with ONE doorway + lintel over it.
  function wallX(h, y, z, x0, x1, gapX, gapW, wallH) {
    gapW = gapW || 1.8;
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    const segs = (gapX > lo && gapX < hi) ? [[lo, gapX - gapW / 2], [gapX + gapW / 2, hi]] : [[lo, hi]];
    for (let i = 0; i < segs.length; i++) {
      const s0 = segs[i][0], s1 = segs[i][1];
      if (s1 - s0 < 0.2) continue;
      h.b.lbox((s0 + s1) / 2, y + wallH / 2, z, s1 - s0, wallH, PWT, P.wall, WALLOPT);
      WALL_TALLY.solid++;
    }
    if (gapX > lo && gapX < hi) {
      h.b.lbox(gapX, y + wallH - 0.18, z, gapW, 0.36, PWT, P.wall, WALLOPT);
      WALL_TALLY.solid++;
    }
  }
  // the same partition running along Z at fixed x (the ±x-door twin).
  function wallZ(h, y, x, z0, z1, gapZ, gapW, wallH) {
    gapW = gapW || 1.8;
    const lo = Math.min(z0, z1), hi = Math.max(z0, z1);
    const segs = (gapZ > lo && gapZ < hi) ? [[lo, gapZ - gapW / 2], [gapZ + gapW / 2, hi]] : [[lo, hi]];
    for (let i = 0; i < segs.length; i++) {
      const s0 = segs[i][0], s1 = segs[i][1];
      if (s1 - s0 < 0.2) continue;
      h.b.lbox(x, y + wallH / 2, (s0 + s1) / 2, PWT, wallH, s1 - s0, P.wall, WALLOPT);
      WALL_TALLY.solid++;
    }
    if (gapZ > lo && gapZ < hi) {
      h.b.lbox(x, y + wallH - 0.18, gapZ, PWT, 0.36, gapW, P.wall, WALLOPT);
      WALL_TALLY.solid++;
    }
  }

  /* ========================================================================
     THE UNIT DOOR — the one interior door in this game that is LOCKED.

     OWNER: "i dont like interior walls unless they are intentional, aka
     locked apartment you have key to that allows interior walls in an
     apartment building."  A flat is exactly that exception, so a flat gets
     REAL walls and a real front door, and the door answers to two things and
     nothing else:

       (a) the player OWNS this address (zillow/realestate — CBZ.cityOwnsLot),
       (b) the player is CARRYING its key (CBZ.cityKeys.has("apt:...")),
           which residents carry (housing.js hands it out with the lease) and
           which therefore moves by pickpocket, corpse loot or hostage — the
           key system's own routes, not a second copy of them here.

     Absent city/keys.js entirely, (b) is simply never true and the door stays
     shut unless you own the place. It never crashes and it never opens.

     A door OPENED stays open until somebody shuts it with [E] again: state on
     the record, no timer. Open = the leaf's merged vertex slice is zeroed
     (CBZ.batchWallHide, the same seam cityFracture punches walls with) and its
     collider leaves CBZ.colliders — bank.js's vault-door idiom exactly.

     COST: the leaf is a plain collider-referenced box, so core/batch.js merges
     it like any other wall — 4k doors, zero extra draw calls. Lookup is an 8 m
     spatial hash (the collider grid's own cell size), so the interaction zone
     never scans the list.
     ======================================================================== */
  const DOOR_H = 2.15;                  // leaf height (the wall above it is fixed)
  const UNIT_CELL = 8;
  const UNIT_DOORS = [];
  const UNIT_GRID = new Map();
  function unitCellKey(x, z) { return Math.floor(x / UNIT_CELL) + "," + Math.floor(z / UNIT_CELL); }
  function unitFile(d) {
    UNIT_DOORS.push(d);
    const k = unitCellKey(d.x, d.z);
    let a = UNIT_GRID.get(k);
    if (!a) { a = []; UNIT_GRID.set(k, a); }
    a.push(d);
  }
  function unitDoorsReset() { DOOR_KEEP.refused.length = 0; SWINGING.length = 0; STATE_ROOMS.length = 0; UNIT_DOORS.length = 0; UNIT_GRID.clear(); WALL_TALLY.solid = 0; WALL_TALLY.doors = 0; }

  // THE LEAF. Drawn through the host's lbox WITHOUT its own collider (lbox
  // splits a box that crosses a stair hole into pieces and pushes one
  // collider per piece, so "the last collider is this leaf's" was a guess:
  // when it guessed wrong the door was drawn, solid, and never registered, a
  // wall you could not open). The door's collider is made here, from the
  // mesh the host actually drew, with ref = that mesh (core/batch.js's wall
  // pass keeps a slice per referenced mesh, which is what hides it on open).
  function doorLeaf(h, lx, ly, lz, bw, bh, bd, hex) {
    const leaf = h.b.lbox(lx, ly, lz, bw, bh, bd, hex, { cast: false, _clipped: true });
    if (!leaf || !leaf.position || !leaf.parent) return null;
    const px = leaf.position.x, pz = leaf.position.z, sx = Math.abs(leaf.scale.x), sz = Math.abs(leaf.scale.z);
    const col = { minX: h.ox + px - sx / 2, maxX: h.ox + px + sx / 2, minZ: h.oz + pz - sz / 2, maxZ: h.oz + pz + sz / 2,
      ref: leaf, y0: leaf.position.y - leaf.scale.y / 2, y1: leaf.position.y + leaf.scale.y / 2, door: true };
    if (CBZ.colliders) CBZ.colliders.push(col);
    return { leaf: leaf, col: col };
  }

  // A DOOR ANYBODY MAY OPEN (a room of state, an office, a briefing room):
  // the leaf in the doorway at local (lx, lz) on floor y, the wall running
  // along x (runX) or z, `hinge` -1/+1 = the jamb on the -/+ side along the
  // wall, `side` -1/+1 = the side of the wall the leaf swings to.
  function freeDoor(h, y, lx, lz, runX, w, hh, hex, hinge, side, label, k) {
    const L = doorLeaf(h, lx, y + hh / 2, lz, runX ? w - 0.02 : 0.06, hh - 0.01, runX ? 0.06 : w - 0.02, hex);
    if (!L) return null;
    const d = {
      id: "door:" + Math.round((h.ox + lx) * 10) + ":" + Math.round((h.oz + lz) * 10) + ":" + (k != null ? k : Math.round(y * 10)),
      label: label || "the door", open: false, free: true,
      x: h.ox + lx, z: h.oz + lz, y: y + 0.2, floorY: y, top: y + 3,
      mesh: L.leaf, col: L.col, b: h.b, ox: h.ox, oz: h.oz,
      runX: runX, w: w, h: hh, hex: hex, hinge: hinge || -1, side: side || 1,
    };
    unitFile(d);
    doorKeep(h, y, lx, lz, runX, w);
    WALL_TALLY.doors++;
    return d;
  }
  // THE DOOR'S FLOOR IS NOBODY'S FURNITURE. Every door files a keep-clear
  // box on its building (the opening and 1.2 m either side of the wall, on
  // its storey); a furnisher asks doorBlocked() before it sets a piece down,
  // so a credenza is never parked across the door to the director's office.
  const DOOR_KEEP = { refused: [] };
  function doorKeep(h, y, lx, lz, runX, w) {
    const b = h.b;
    if (!b) return;
    const a = w / 2 + 0.25, n = 1.2;
    (b._doorKeep || (b._doorKeep = [])).push({ y: y,
      x0: lx - (runX ? a : n), x1: lx + (runX ? a : n), z0: lz - (runX ? n : a), z1: lz + (runX ? n : a) });
  }
  function doorBlocked(h, y, lx, lz, pad) {
    const K = h && h.b && h.b._doorKeep;
    if (!K) return false;
    for (let i = 0; i < K.length; i++) {
      const k = K[i];
      if (Math.abs(k.y - y) > 1.0) continue;
      if (lx > k.x0 - pad && lx < k.x1 + pad && lz > k.z0 - pad && lz < k.z1 + pad) { DOOR_KEEP.refused.push({ x: h.ox + lx, z: h.oz + lz, y: y }); return true; }
    }
    return false;
  }

  // A WIDE OPENING GETS A PAIR: two leaves, each hinged on its own jamb and
  // swinging the same way, one E opening both (a 1.7 m single leaf is a
  // barn door). `hinge` picks the jamb of a single leaf.
  function freeDoorway(h, y, lx, lz, runX, w, hh, hex, hinge, side, label, k) {
    if (w < 1.6) return freeDoor(h, y, lx, lz, runX, w, hh, hex, hinge, side, label, k);
    const ux = runX ? 1 : 0, uz = runX ? 0 : 1, q = w / 4;
    const a = freeDoor(h, y, lx - ux * q, lz - uz * q, runX, w / 2, hh, hex, -1, side, label, k);
    const b = freeDoor(h, y, lx + ux * q, lz + uz * q, runX, w / 2, hh, hex, 1, side, label, k);
    if (a && b) { a.pair = b; b.pair = a; b.id += "b"; }
    return a || b;
  }

  // fill a partition's doorway with a locked leaf. `axis` is the axis the WALL
  // RUNS along ("x" → fixed z at `at`, doorway centred on `gap` in x).
  function unitDoor(h, y, axis, at, gap, gapW, wallH, id, label) {
    const alongX = axis === "x";
    const lx = alongX ? gap : at, lz = alongX ? at : gap;
    const L = doorLeaf(h, lx, y + DOOR_H / 2, lz, alongX ? gapW : PWT, DOOR_H, alongX ? PWT : gapW, P.door);
    if (!L) return null;
    const leaf = L.leaf, col = L.col;
    // the wall ABOVE the leaf, so a doorway is a hole in a wall and not a gap
    // in a fence. (The lintel the partition already drew sits over this.)
    const overH = wallH - 0.36 - DOOR_H;
    if (overH > 0.06)
      h.b.lbox(lx, y + DOOR_H + overH / 2, lz,
        alongX ? gapW : PWT, overH, alongX ? PWT : gapW, P.wall, WALLOPT);
    // a handle, because a door with no handle is a panel
    const hoff = gapW / 2 - 0.14;
    h.b.lbox(alongX ? lx + hoff : lx, y + 1.02, alongX ? lz : lz + hoff,
      alongX ? 0.1 : PWT + 0.06, 0.06, alongX ? PWT + 0.06 : 0.1, P.gold, { cast: false });
    const d = {
      id: id, label: label, open: false,
      x: h.ox + lx, z: h.oz + lz, y: y + 0.2, floorY: y, top: y + wallH,
      mesh: leaf, col: col, b: h.b, ox: h.ox, oz: h.oz,
      // the hinge: at the -run jamb, the leaf swinging to +normal
      runX: alongX, w: gapW, h: DOOR_H, hex: P.door, hinge: -1, side: 1,
    };
    unitFile(d);
    doorKeep(h, y, lx, lz, alongX, gapW);
    WALL_TALLY.doors++;
    return d;
  }

  /* ---- OPEN / SHUT — the one door verb every interior door answers --------
     Open: the closed leaf (merged into core/batch.js's buckets, or a plain
     mesh for a door somebody built outside the batch) is hidden and its
     collider leaves CBZ.colliders AT ONCE, so the doorway is walkable the
     moment you press E; a real hinged leaf swings open on its jamb (built on
     the first open, so a door nobody touches costs nothing). Shut: the leaf
     swings back and the collider returns when nobody is standing in the
     doorway (a door never closes on a body and shoves it through a wall). */
  const SWINGING = [];
  let swingGeo = null;
  function swingPivot(d) {
    if (d.pivot !== undefined) return d.pivot;
    d.pivot = null;
    if (!window.THREE || !(d.w > 0.3)) return null;
    const A = CBZ.city && CBZ.city.arena;
    const root = d.root || (A && A.root) || CBZ.scene;
    if (!root) return null;
    if (!swingGeo) swingGeo = new THREE.BoxGeometry(1, 1, 1);
    const ux = d.runX ? 1 : 0, uz = d.runX ? 0 : 1;          // along the wall
    const hs = d.hinge || -1;
    const pivot = new THREE.Group();
    pivot.name = "door-leaf";
    pivot.position.set(d.x + ux * hs * d.w / 2, d.floorY, d.z + uz * hs * d.w / 2);
    const leaf = new THREE.Mesh(swingGeo, CBZ.cmat ? CBZ.cmat(d.hex != null ? d.hex : 0x4a3524) : new THREE.MeshLambertMaterial({ color: d.hex || 0x4a3524 }));
    const L = d.w - 0.04;
    // the leaf lies from the hinge toward the doorway's centre
    leaf.position.set(-ux * hs * L / 2, (d.h || DOOR_H) / 2, -uz * hs * L / 2);
    leaf.scale.set(d.runX ? L : 0.05, (d.h || DOOR_H) - 0.02, d.runX ? 0.05 : L);
    leaf.castShadow = false; leaf.receiveShadow = true;
    pivot.add(leaf);
    // a handle on both faces at the free edge
    const hx = -ux * hs * (L - 0.12), hz = -uz * hs * (L - 0.12);
    const knob = new THREE.Mesh(swingGeo, CBZ.cmat ? CBZ.cmat(0xb99347) : leaf.material);
    knob.position.set(hx, 1.02, hz);
    knob.scale.set(d.runX ? 0.1 : 0.16, 0.05, d.runX ? 0.16 : 0.1);
    pivot.add(knob);
    // the angle that carries the leaf (hinge -> centre, i.e. -u*hs) onto the
    // swing side of the wall (+n*side), n = the wall normal
    const nx = d.runX ? 0 : 1, nz = d.runX ? 1 : 0, sd = d.side || 1;
    const a0 = Math.atan2(-ux * hs, -uz * hs), a1 = Math.atan2(nx * sd, nz * sd);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    d.swingTo = da * (84 / 90);                               // stops a hair off the wall
    d.t = 0;
    pivot.visible = false;
    root.add(pivot);
    d.pivot = pivot;
    return pivot;
  }
  function bodyInDoorway(d) {
    const c = d.col;
    if (!c) return false;
    const r = 0.42;
    const hit = function (x, z, y) {
      if (y != null && (y > d.floorY + 1.6 || y < d.floorY - 1.2)) return false;
      return x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r;
    };
    const P = CBZ.player;
    if (P && P.pos && !P.dead && hit(P.pos.x, P.pos.z, P.pos.y)) return true;
    const peds = CBZ.cityPeds;
    if (peds) for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p && !p.dead && p.pos && hit(p.pos.x, p.pos.z, p.pos.y)) return true;
    }
    return false;
  }
  function colIn(d, on) {
    const cols = CBZ.colliders || [];
    const i = cols.indexOf(d.col);
    if (on && i < 0) cols.push(d.col);
    else if (!on && i >= 0) cols.splice(i, 1);
    else return;
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  function unitSetOpen(d, open) {
    if (!d || !d.mesh || !!d.open === !!open) return false;
    d.open = !!open;
    const pv = swingPivot(d);
    if (d.open) {
      if (!(CBZ.batchWallHide && CBZ.batchWallHide(d.mesh))) d.mesh.visible = false;
      colIn(d, false);
      d.pendingShut = false;
      if (pv) pv.visible = true;
    } else {
      // the collider comes back once the doorway is clear (swingTick)
      d.pendingShut = true;
      if (!pv) shutNow(d);
    }
    if (pv && SWINGING.indexOf(d) < 0) SWINGING.push(d);
    if (d.pair && !!d.pair.open !== d.open) unitSetOpen(d.pair, d.open);
    if (CBZ.sfx && d.free) { try { CBZ.sfx(d.open ? "door_open" : "door_close", { volume: 0.7 }); } catch (e) {} }
    return true;
  }
  function shutNow(d) {
    d.pendingShut = false;
    if (!(CBZ.batchWallShow && CBZ.batchWallShow(d.mesh))) d.mesh.visible = true;
    if (d.pivot) d.pivot.visible = false;
    colIn(d, true);
  }
  if (CBZ.onUpdate) CBZ.onUpdate(34.31, function (dt) {
    if (!doorVerbWired) wireDoorVerb();
    if (!SWINGING.length) return;
    const k = Math.min(1, (dt || 0.016) * 7);
    for (let i = SWINGING.length - 1; i >= 0; i--) {
      const d = SWINGING[i];
      const pv = d.pivot;
      if (!pv) { SWINGING.splice(i, 1); continue; }
      const target = d.open ? 1 : 0;
      d.t += (target - d.t) * k;
      if (Math.abs(d.t - target) < 0.01) d.t = target;
      pv.rotation.y = d.t * d.swingTo;
      if (!d.open && d.pendingShut && d.t < 0.15 && !bodyInDoorway(d)) shutNow(d);
      if (d.t === target && !d.pendingShut) SWINGING.splice(i, 1);
    }
  });

  // THE LOT AND THE BUILDING ARE NOT THE SAME OBJECT. buildings.js hands each
  // lot a SPREAD COPY of the building record (`lot.building = { ...b, name,
  // sign, side, door }`), so `lot.building === b` is FALSE for every building
  // in the game and an identity test across that seam silently matches nothing.
  // The site's origin is the key that actually crosses it.
  function sameSite(b1, b2) {
    if (!b1 || !b2) return false;
    if (b1 === b2) return true;
    return Math.abs((b1.ox || 0) - (b2.ox || 0)) < 0.01 &&
           Math.abs((b1.oz || 0) - (b2.oz || 0)) < 0.01;
  }
  // which home LOT is this door's building? Resolved once, on the first [E].
  function unitLot(d) {
    if (d._lot !== undefined) return d._lot;
    d._lot = null;
    const city = CBZ.city;
    const A = city && city.arena;
    const pools = [city && city.homeLots, A && A.homeLots, A && A.lots];
    for (let p = 0; p < pools.length && !d._lot; p++) {
      const lots = pools[p];
      if (!lots) continue;
      for (let i = 0; i < lots.length; i++) {
        if (lots[i] && sameSite(lots[i].building, d.b)) { d._lot = lots[i]; break; }
      }
    }
    return d._lot;
  }
  function unitMayOpen(d) {
    if (!d) return false;
    if (d.free) return typeof d.free === "function" ? !!d.free(d) : true;   // a room of state: nobody needs a key
    if (d.forced) return true;                    // a kicked-in door shuts but no longer locks
    const lot = unitLot(d);
    if (lot && CBZ.cityOwnsLot && CBZ.cityOwnsLot(lot)) return true;
    return !!(CBZ.cityKeys && typeof CBZ.cityKeys.has === "function" && CBZ.cityKeys.has(d.id));
  }
  function unitDoorAt(px, pz, reach, py) {
    let best = null, bd = reach * reach;
    const gx = Math.floor((px - reach) / UNIT_CELL), gx1 = Math.floor((px + reach) / UNIT_CELL);
    const gz = Math.floor((pz - reach) / UNIT_CELL), gz1 = Math.floor((pz + reach) / UNIT_CELL);
    for (let x = gx; x <= gx1; x++) for (let z = gz; z <= gz1; z++) {
      const a = UNIT_GRID.get(x + "," + z);
      if (!a) continue;
      for (let i = 0; i < a.length; i++) {
        const d = a[i];
        // the floor you are STANDING on. (The old window ran from 1.2 m under
        // the door's floor to 0.6 m over its CEILING, so on every storey of a
        // stacked plan E found the door directly UNDER your feet: upstairs in
        // the West Wing the Oval Office door answered with the Cabinet Room's,
        // one floor down, and the President was shut in.)
        if (py != null && (py < d.floorY - 0.6 || py > d.floorY + 1.4)) continue;
        const dx = px - d.x, dz = pz - d.z;
        // in front of the doorway, not beside it through a wall: within the
        // opening's width (plus an arm) along the wall
        if (d.runX != null) {
          const along = d.runX ? dx : dz;
          if (Math.abs(along) > (d.w || 1) / 2 + 0.7) continue;
        }
        const q = dx * dx + dz * dz;
        if (q < bd) { bd = q; best = d; }
      }
    }
    return best;
  }

  // the doors on ONE address at ONE floor height — housing.js's bridge from a
  // lease (lot + floorY) to the physical door that lease is for.
  CBZ.cityUnitDoorsOn = function (b, floorY, tol) {
    const out = [];
    if (!b) return out;
    const t = tol == null ? 0.6 : tol;
    for (let i = 0; i < UNIT_DOORS.length; i++) {
      const d = UNIT_DOORS[i];
      if (sameSite(d.b, b) && (floorY == null || Math.abs(d.floorY - floorY) <= t)) out.push(d);
    }
    return out;
  };
  CBZ.cityUnitDoors = {
    all: function () { return UNIT_DOORS.slice(); },
    at: unitDoorAt,
    mayOpen: unitMayOpen,
    setOpen: unitSetOpen,
    on: function (b, floorY, tol) { return CBZ.cityUnitDoorsOn(b, floorY, tol); },
    count: function () { return UNIT_DOORS.length; },
    // the pieces a door's keep-clear box turned away (world x, z, floor y)
    keptClear: function () { return DOOR_KEEP.refused.slice(); },
    /* A DOOR BUILT BY SOMEBODY ELSE joins the same verb: `rec` is
       { id, label, x, z, floorY, mesh, col (already in CBZ.colliders),
         runX, w, h, hex, hinge, side, free (true | fn(d)), noForce, root }.
       presidency.js's Situation Room door is one. Returns the record. */
    add: function (rec) {
      if (!rec || !rec.mesh || !rec.col) return null;
      if (rec.open == null) rec.open = false;
      if (rec.y == null) rec.y = rec.floorY + 0.2;
      if (rec.top == null) rec.top = rec.floorY + 3;
      unitFile(rec);
      return rec;
    },
    remove: function (rec) {
      if (!rec) return;
      const i = UNIT_DOORS.indexOf(rec);
      if (i >= 0) UNIT_DOORS.splice(i, 1);
      const a = UNIT_GRID.get(unitCellKey(rec.x, rec.z));
      if (a) { const j = a.indexOf(rec); if (j >= 0) a.splice(j, 1); }
      const k = SWINGING.indexOf(rec);
      if (k >= 0) SWINGING.splice(k, 1);
      if (rec.pivot && rec.pivot.parent) rec.pivot.parent.remove(rec.pivot);
      rec.pivot = undefined;
    },
    openCount: function () { let n = 0; for (let i = 0; i < UNIT_DOORS.length; i++) if (UNIT_DOORS[i].open) n++; return n; },
  };

  // [E] ON THE DOOR. Registered lazily: city/interactions.js parses AFTER this
  // file (index.html 989 vs 1390), so a registration written at parse time
  // would be dead on arrival — the same lesson armReset() below records.
  let doorVerbWired = false;
  function wireDoorVerb() {
    const I = CBZ.interactions;
    if (doorVerbWired || !I || !I.registerZone) return false;
    I.registerZone({
      id: "zone-unit-door", kind: "unitdoor", prio: 8, driving: false, faceWins: true,
      find: function (px, pz, ctx) { return unitDoorAt(px, pz, 1.9, ctx && ctx.pos ? ctx.pos.y : null); },
      options: [{
        id: "unit-door-use", slot: "e",
        // a door you cannot open offers no verb here: the force row below is
        // the way through, and "Locked" is a state, not a button
        // an open door of state offers Close only to someone standing in its
        // doorway, so walking past an open door never puts a verb on E
        canShow: function (d, ctx) {
          if (!d) return false;
          if (d.open && d.free) {
            const P = ctx && ctx.pos ? ctx.pos : (CBZ.player && CBZ.player.pos);
            return !!P && Math.hypot(P.x - d.x, P.z - d.z) < 1.3;
          }
          return d.open || unitMayOpen(d);
        },
        label: function (d) { return d.open ? "Close" : (d.free ? "Open" : "Unlock"); },
        onSelect: function (d) {
          const note = (CBZ.city && CBZ.city.note) ? CBZ.city.note : function () {};
          if (d.free) { if (d.open || unitMayOpen(d)) unitSetOpen(d, !d.open); return; }
          if (d.open) { unitSetOpen(d, false); note("Closed " + d.label + ".", 1.6); return; }
          if (!unitMayOpen(d)) { note("Locked. " + d.label + ".", 2.0); return; }
          // YOU OWN IT → you get the key, once, as a real item in the bag.
          // Ownership already opened the door; the key is so the player can SEE
          // that this address is theirs without standing in front of it.
          if (CBZ.cityKeys && CBZ.cityKeys.grant && !CBZ.cityKeys.has(d.id))
            { try { CBZ.cityKeys.grant(d.id, "Key to " + d.label); } catch (e) {} }
          unitSetOpen(d, true);
          note("Unlocked " + d.label + ".", 1.8);
        },
      }, {
        // BREAKING IN. The flat you do not have a key to is still a door, and a
        // door gives: a pick is quiet, a crowbar splinters the frame, a boot
        // takes a few goes and the whole corridor hears every one. A forced
        // door stays forced (it shuts, it no longer locks).
        id: "unit-door-force", slot: "i",
        canShow: function (d) { return !!d && !d.open && !d.noForce && !unitMayOpen(d); },
        label: function () {
          const E = CBZ.cityEcon;
          if (E && E.count && E.count("Lockpick") > 0) return "Pick";
          if (E && E.count && E.count("Crowbar") > 0) return "Pry open";
          return "Kick in";
        },
        onSelect: function (d) {
          const note = (CBZ.city && CBZ.city.note) ? CBZ.city.note : function () {};
          const E = CBZ.cityEcon;
          const loud = function (sev, r) {
            if (CBZ.cityPanicRaise) { try { CBZ.cityPanicRaise(d.x, d.z, r); } catch (e) {} }
            if (CBZ.cityCrime) { try { CBZ.cityCrime(sev, { x: d.x, z: d.z, type: "burglary" }); } catch (e) {} }
          };
          if (E && E.count && E.count("Lockpick") > 0) {
            if (Math.random() < 0.25 && E.take) { E.take("Lockpick", 1); note("The pick snaps in the lock.", 1.8); return; }
            d.forced = true; unitSetOpen(d, true);
            note("The lock gives. " + d.label + ".", 1.8);
            return;
          }
          if (E && E.count && E.count("Crowbar") > 0) {
            d.forced = true; unitSetOpen(d, true);
            if (CBZ.sfx) { try { CBZ.sfx("punch"); } catch (e) {} }
            loud(60, 0.7);
            note("The frame splinters. " + d.label + " is open.", 2.0);
            return;
          }
          d.kicks = (d.kicks | 0) + 1;
          if (CBZ.sfx) { try { CBZ.sfx("punch"); } catch (e) {} }
          if (d.kicks < 3) { loud(d.kicks === 1 ? 30 : 45, 0.9); note(d.kicks === 1 ? "The door shudders in its frame." : "The frame cracks.", 1.4); return; }
          d.forced = true; unitSetOpen(d, true);
          loud(70, 1.2);
          note("The door bangs open against the wall.", 1.8);
        },
      }],
    });
    I.describe("unitdoor", function (d) {
      if (d.free) return { label: "", note: "" };
      return { label: d.label, note: d.open ? "Open" : (unitMayOpen(d) ? "Your key fits" : "Locked. Somebody lives here.") };
    });
    doorVerbWired = true;
    return true;
  }

  function seatReg(h, x, y, z, face, kind, cushionH) {
    if (CBZ.propRegisterSeat) CBZ.propRegisterSeat(h.ox + x, y, h.oz + z, face, kind, null,
      cushionH == null ? null : { cushion: cushionH, floorBelow: 0 });
  }

  // ========================================================================
  //  THE INTERIOR LIGHT RAMP — INTERIOR_LIGHT_DAY.
  //
  //  Every ceiling strip in this kit is an emissive mesh, and core/batch.js
  //  refuses emissives, so each one is already its own draw call and its own
  //  material (buildings.js's `lbox` mints a fresh `CBZ.mat`, not a cached
  //  `cmat`). That makes them the one interior surface we can drive per-frame
  //  for FREE: the ramp writes `emissiveIntensity` on materials that already
  //  exist and adds no mesh, no material bucket and no draw call.
  //
  //  Shape copied from city/interiorlight.js's window glow (which does the same
  //  job for the OUTSIDE of the same glass), including its quantisation: the
  //  value is rounded to 1/40 so the sweep is a no-op on the overwhelming
  //  majority of frames and only actually writes across dusk and dawn.
  // ========================================================================
  const STRIPS = [];                    // {m: mesh, ei: authored day intensity}
  const STRIP_CAP = 4000;
  let nightApplied = -1;
  function ceilingStrip(m) {
    if (!m || !m.material || CBZ.CONFIG.INTERIOR_LIGHT_DAY === false) return m;
    if (STRIPS.length >= STRIP_CAP) return m;
    const ei = m.material.emissiveIntensity != null ? m.material.emissiveIntensity : 1;
    STRIPS.push({ m: m, ei: ei });
    return m;
  }
  // a strip only counts while it is still CONNECTED to the live scene — a torn
  // down city keeps its local parent chain, so a bare .parent check would hold
  // every dead tower's lights in the registry forever (interiorStaff's own
  // rootLive lesson, same fix).
  function stripLive(o) {
    let hops = 0;
    while (o && hops++ < 64) { if (o === CBZ.scene) return true; o = o.parent; }
    return false;
  }
  if (CBZ.onUpdate) CBZ.onUpdate(0.345, function () {
    if (CBZ.CONFIG.INTERIOR_LIGHT_DAY === false || !STRIPS.length) return;
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    const n = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    const q = Math.round(n * 40) / 40;
    if (q === nightApplied) return;
    nightApplied = q;
    // 0.72x at noon (daylight through the glass swamps a ceiling strip and a
    // full-strength one reads as a light box) up to 1.28x at midnight.
    const k = 0.72 + 0.56 * q;
    for (let i = STRIPS.length - 1; i >= 0; i--) {
      const s = STRIPS[i];
      if (!s.m || !s.m.material || !stripLive(s.m)) { STRIPS.splice(i, 1); continue; }
      s.m.material.emissiveIntensity = s.ei * k;
    }
  });

  // ========================================================================
  //  (a) EMPTY — INTENTIONALLY empty, and that is owner doctrine ("it should
  //  be empty, OR it should be designed"). What was NOT doctrine was that
  //  every empty floor in the world was the IDENTICAL shell — one slab, one
  //  strip, the same hex, fifty times over — which does not read as a choice,
  //  it reads as nobody having made one.
  //
  //  So `empty` keeps its RATIO (buildings.js still rolls 46% of office towers
  //  into it; nothing here changes that) and gains a VOCABULARY: four dressed
  //  reads picked per BUILDING — so a tower is still ONE thing all the way up,
  //  which is the monotony doctrine — plus a DARK storey, which is the one
  //  variant that must vary per floor because its whole read is an unlit floor
  //  in a lit tower seen from the street.
  //
  //    bare        the clean shell (what every empty used to be)
  //    renovation  tarps, a ladder, paint tins, one wall half-repainted
  //    moveout     stacked cartons and one chair somebody left behind
  //    afterhours  two desks, a tipped chair, one monitor still on
  //
  //  BUDGET: every variant is opaque cast:false boxes from the palette above
  //  (no new hex, no new bucket, no collider, no userData → core/batch.js folds
  //  them), ≤16 boxes, and AT MOST ONE extra emissive accent. The abandoned
  //  chair is a REAL CBZ.furnish.chair so it is sittable — an empty room with a
  //  decoy chair in it would be a worse lie than an empty room.
  // ========================================================================
  // bare stays the plurality: most empty is still just empty. The cumulative
  // band is the table so the ratio is readable in one line and cannot drift
  // from the names beside it.
  const EMPTY_KINDS = ["bare", "renovation", "moveout", "afterhours"];
  const EMPTY_CUM = [0.42, 0.66, 0.85, 1.01];
  function emptyVariant(h) {
    if (CBZ.CONFIG.INTERIOR_EMPTY_VARIETY === false || !CBZ.hash01) return EMPTY_KINDS[0];
    const v = CBZ.hash01(h.ox, h.oz, 0x0E11);
    for (let i = 0; i < EMPTY_CUM.length; i++) if (v < EMPTY_CUM[i]) return EMPTY_KINDS[i];
    return EMPTY_KINDS[0];
  }
  function floorIndexOf(r, h) { return Math.max(0, Math.round((r.y - 0.14) / Math.max(0.5, h.fh))); }

  // the live tally of which empty read each floor actually got — the evidence
  // for CBZ.interiorAudit().emptyVariants. A vocabulary nobody can COUNT is
  // indistinguishable from the one shell repeated (CLAUDE.md: an audit nobody
  // has executed is not a measurement).
  const EMPTY_TALLY = { bare: 0, renovation: 0, moveout: 0, afterhours: 0, dark: 0 };

  function progEmpty(r, h) {
    const kind = emptyVariant(h);
    const k = floorIndexOf(r, h);
    // the DARK storey. Never the ground floor (an unlit lobby reads as broken,
    // not as intentional) and never on a bare building, whose whole read is the
    // clean lit shell repeated.
    const dark = kind !== "bare" && k > 0 && CBZ.hash01
      && CBZ.hash01(h.ox + k * 13.7, h.oz - k * 7.1, 0x0E12) < 0.18;
    shell(h, r, dark);
    EMPTY_TALLY[kind] = (EMPTY_TALLY[kind] | 0) + 1;
    if (dark) EMPTY_TALLY.dark++;
    if (kind === "bare" || CBZ.CONFIG.INTERIOR_EMPTY_VARIETY === false) return { anchors: [] };

    const y = r.y, w = r.x1 - r.x0, d = r.z1 - r.z0;
    if (w < 3.0 || d < 3.0) return { anchors: [] };
    const mx = cx(r), mz = cz(r);
    // one gated box, exactly the roomKit idiom: refused on the door aisle, the
    // stair strip and the lift chase rather than drawn through them.
    function eb(x, z, ly, bw, bh, bd, col, o) {
      if (!inRect(r, x, z, 0.35) || !h.clear(x, z, (o && o.pad) || 0.5)) return false;
      h.b.lbox(x, y + ly + bh / 2, z, bw, bh, bd, col,
        (o && o.emissive) ? { emissive: o.emissive, ei: o.ei || 0.5, cast: false } : { cast: false });
      return true;
    }
    // a real, sittable chair from the ONE furniture vocabulary. Thinned to
    // about a third of the floors so a twelve-storey shell does not file twelve
    // propuse anchors nobody will ever sit in.
    function realChair(x, z, yaw) {
      if (!CBZ.furnish || !CBZ.furnish.chair) return false;
      if (!inRect(r, x, z, 0.6) || !h.clear(x, z, 0.6)) return false;
      if (CBZ.hash01 && CBZ.hash01(h.ox + k, h.oz, 0x0E13) >= 0.34) return false;
      try { CBZ.furnish.chair(x, y, z, yaw, { box: h.b.lbox, ox: h.ox, oz: h.oz }); } catch (e) { return false; }
      return true;
    }
    // a deterministic offset inside the room, so two floors of the same shell
    // are identical (the monotony) while two BUILDINGS are not.
    const j = CBZ.hash01 ? CBZ.hash01(h.ox, h.oz, 0x0E14) : 0.5;
    const sx = mx + (j - 0.5) * Math.min(3.0, w * 0.25);

    if (kind === "renovation") {
      // dust sheets down the middle of the floor, laid in two runs
      for (let i = -1; i <= 1; i += 2)
        eb(sx + i * 1.3, mz, 0.05, 1.15, 0.02, Math.min(d - 1.6, 5.0), P.marble, { pad: 0.4 });
      // the ladder, leaning nowhere — two rails and four rungs
      const lx = sx - 2.2;
      for (let i = -1; i <= 1; i += 2) eb(lx + i * 0.24, mz + 1.1, 0, 0.06, 2.4, 0.06, P.steel, { pad: 0.4 });
      for (let i = 0; i < 4; i++) eb(lx, mz + 1.1, 0.45 + i * 0.55, 0.54, 0.05, 0.05, P.steel, { pad: 0.4 });
      // paint tins and a tray, clustered where somebody was working
      for (let i = 0; i < 3; i++)
        eb(sx + 0.6 + i * 0.42, mz - 1.4, 0, 0.3, 0.34, 0.3, i === 1 ? P.worktop : P.sack, { pad: 0.35 });
      eb(sx + 1.1, mz - 2.0, 0.01, 0.9, 0.05, 0.5, P.sack, { pad: 0.35 });
      // ONE wall half-repainted — the tell that says the job is unfinished
      eb(mx, r.z1 - 0.22, 0, Math.min(w - 1.2, 6.0), 1.55, 0.06, P.marble, { pad: 0.3 });
      // the single emissive accent: a worklight on a short mast
      eb(sx - 2.6, mz - 1.6, 0, 0.1, 1.5, 0.1, P.steel, { pad: 0.4 });
      eb(sx - 2.6, mz - 1.6, 1.5, 0.42, 0.22, 0.3, P.flood, { emissive: P.flood, ei: 0.75, pad: 0.4 });

    } else if (kind === "moveout") {
      // two stacks of cartons and a single third, left where the truck stopped
      const bx = sx + 1.0, bz = mz + Math.min(1.6, d * 0.16);
      eb(bx, bz, 0, 0.72, 0.62, 0.72, P.crate, { pad: 0.45 });
      eb(bx, bz, 0.62, 0.66, 0.54, 0.66, P.crate, { pad: 0.45 });
      eb(bx + 0.86, bz - 0.2, 0, 0.7, 0.6, 0.7, P.crate, { pad: 0.45 });
      eb(bx + 0.86, bz - 0.2, 0.6, 0.6, 0.5, 0.6, P.crate, { pad: 0.45 });
      eb(bx - 1.5, bz + 0.9, 0, 0.68, 0.58, 0.68, P.crate, { pad: 0.45 });
      // the tape gun and a flattened carton on the floor
      eb(bx - 0.3, bz - 1.5, 0.01, 0.9, 0.03, 0.7, P.crate, { pad: 0.35 });
      // one chair nobody came back for, facing the empty room
      realChair(sx - 1.9, mz - 1.2, Math.PI * 0.25);

    } else if (kind === "afterhours") {
      // two desks left standing out of a floor that used to be full of them —
      // the SAME 1.5x0.85 station the desk farm draws, minus its worker.
      for (let i = 0; i < 2; i++) {
        const dx = sx - 1.6 + i * 3.0, dz = mz - 0.4;
        if (!eb(dx, dz, 0.73, 1.6, 0.03, 0.85, P.worktop, { pad: 0.6 })) continue;   // top → 0.76
        for (const a of [-1, 1]) eb(dx + a * 0.77, dz, 0, 0.03, 0.73, 0.76, P.desk, { pad: 0.05 });
        eb(dx, dz - 0.39, 0.36, 1.5, 0.34, 0.02, P.desk, { pad: 0.05 });
        if (i === 0) {           // ONE monitor still on — the whole read
          eb(dx, dz - 0.37, 0.76, 0.05, 0.1, 0.03, P.bezel, { pad: 0.05 });
          eb(dx, dz - 0.34, 0.86, 0.62, 0.38, 0.025, P.bezel, { pad: 0.05 });
          eb(dx, dz - 0.34 + 0.0175, 0.8775, 0.59, 0.33, 0.004, P.screen,
            { emissive: P.screen, ei: 0.55, pad: 0.05 });  // glass 3 mm proud of the bezel
        }
      }
      // a chair on its side, drawn as what a tipped chair actually is: the pad
      // flat on the deck with the back lying off one edge of it.
      eb(sx + 0.4, mz + 1.5, 0.02, 0.6, 0.1, 0.6, P.chair, { pad: 0.4 });
      eb(sx + 0.4, mz + 2.02, 0.02, 0.6, 0.1, 0.5, P.chair, { pad: 0.4 });
      eb(sx + 0.4, mz + 1.5, 0.12, 0.12, 0.1, 0.5, P.bezel, { pad: 0.4 });
      // ...and one still upright, and real
      realChair(sx + 1.4, mz - 1.5, 0);
    }
    return { anchors: [] };
  }

  // ========================================================================
  //  (b/c) DESK-FARM — the flagship. Ordered rows of IDENTICAL desks +
  //  terminals + chairs on a fixed pitch, grid centred in the room, every
  //  chair on the same side, every worker facing the same way (-z). The
  //  station is byte-for-byte the office furnisher's proven 8-box desk, so
  //  it lands in the exact colour buckets the batcher already merges.
  //  Returns one seat anchor per landed desk (world coords, face=π).
  // ========================================================================
  const PITCH_X = 3.0, PITCH_Z = 2.6;
  // MESH BUDGET, and it is the one cap this kit was missing. A station is 8
  // boxes, so the grid cost is 8·cols·rows and BOTH factors grow with the
  // plate: on a city tower's ~24 m plate that is ~500 boxes and nobody noticed,
  // but a government slab is 118 m across and the same code asks for 624 desks
  // — 5,000 boxes on ONE floor, three floors of it. The pitch and the centring
  // are untouched (the rows still read as rows); only the EXTENT is bounded, so
  // a big floor gets a dense core of desks with open circulation around it,
  // which is what a big floor actually looks like.
  const DESK_CAP = 96, RACK_CAP = 80;
  function gridCap(cols, rows, cap) {
    if (cols * rows <= cap) return [cols, rows];
    const s = Math.sqrt(cap / (cols * rows));
    return [Math.max(1, Math.floor(cols * s)), Math.max(1, Math.floor(rows * s))];
  }
  function progDeskFarm(r, h) {
    shell(h, r);
    const anchors = [];
    let feedReg = 0;              // CCTV: cap live-feed monitor faces per floor (city/cctv.js)
    const y = r.y;
    const spanX = (r.x1 - r.x0) - 2.0, spanZ = (r.z1 - r.z0) - 2.8;
    if (spanX < 0.5 || spanZ < 0.5) return { anchors: anchors };
    const cap = gridCap(Math.max(1, 1 + Math.floor(spanX / PITCH_X)),
                        Math.max(1, 1 + Math.floor(spanZ / PITCH_Z)), DESK_CAP);
    const cols = cap[0], rows = cap[1];
    const gx0 = cx(r) - ((cols - 1) * PITCH_X) / 2;
    const gz0 = cz(r) - ((rows - 1) * PITCH_Z) / 2 - 0.3;   // station reaches +1.15 (chair side)
    for (let c = 0; c < cols; c++) for (let w = 0; w < rows; w++) {
      const dx = gx0 + c * PITCH_X, dz = gz0 + w * PITCH_Z;
      const seatZ = dz + 0.85;
      // gate BOTH the chair and the desk body — the door aisle / stair strip /
      // elevator chase punch clean holes in the grid, nothing else does.
      if (!h.clear(dx, seatZ, 0.6) || !h.clear(dx, dz, 0.7)) continue;
      // A BENCH DESK, not a block: a 30 mm top on two panel legs with a
      // modesty panel, a slim monitor on a neck with its glass 3 mm proud (the
      // old glass hovered 2.5 cm off a 6 cm slab), and a task chair. The
      // fit-out adds the drawer pedestal, the screen and the clutter when you
      // walk in. Worktop top stays 0.76, the pad top 0.48 (the anchor below).
      const L = h.b.lbox, lo = { cast: false };
      const pz = dz - 0.34;                                                         // the panel, on the top
      L(dx, y + 0.745, dz, 1.6, 0.03, 0.85, P.worktop, lo);                        // worktop → 0.76
      for (const a of [-1, 1]) L(dx + a * 0.77, y + 0.365, dz, 0.03, 0.73, 0.76, P.desk, lo);   // panel legs
      L(dx, y + 0.53, dz - 0.39, 1.5, 0.34, 0.02, P.desk, lo);                     // modesty panel
      L(dx, y + 0.81, pz - 0.03, 0.05, 0.1, 0.03, P.bezel, lo);                    // monitor neck
      L(dx, y + 1.05, pz, 0.62, 0.38, 0.025, P.bezel, lo);                         // panel 0.86..1.24
      const screenZ = pz + 0.0125 + 0.003 + 0.002;
      L(dx, y + 1.06, screenZ, 0.59, 0.33, 0.004, P.screen, lo);                   // glass
      taskChair(h, dx, y, seatZ, 0, -1, 0.48);
      anchors.push({
        x: h.ox + dx, y: y, z: h.oz + seatZ, face: Math.PI, lx: dx, lz: seatZ,
        cushionH: 0.48, floorBelow: 0,
      });
      // INTERIOR_LOOT_V1: the desk BODY (not the chair) is the container. Hash-
      // thinned inside lootReg — most of a desk farm is just desks.
      lootReg(h.ox + dx, y, h.oz + dz, "desk");
      // CCTV: a bounded few of these terminals show a live camera feed. The lit
      // visible face sits at screenZ+0.01 looking +z at the seat. Register the
      // actual outer glass, not the box centre, for the live overlay.
      if (feedReg < 3 && CBZ.cctvAddScreen) {
        CBZ.cctvAddScreen(h.ox + dx, y + 1.06, h.oz + screenZ + 0.004, 0, 1);
        feedReg++;
      }
    }
    return { anchors: anchors };
  }

  // ========================================================================
  //  (b) MEETING — ONE table, chairs, a wall screen, and SPACE.
  //
  //  It used to be a room behind a full-span DIVIDER. The divider was a wall
  //  you walked through: no collider, no door, no reason. The half-plate is
  //  still the design — you come in, cross the open half, and the table is at
  //  the far end where a boardroom belongs — but the boundary is now the
  //  ARRANGEMENT, not a painted-on wall. opts.door orients it ({x,z,nx,nz},
  //  host-local; default: entry from -z).
  // ========================================================================
  function progMeeting(r, h, opts) {
    shell(h, r);
    const anchors = [];
    const y = r.y;
    const din = (opts && opts.door) || { x: cx(r), z: r.z0, nx: 0, nz: 1 };
    const alongX = Math.abs(din.nx) > 0.5;              // door on a ±x wall → depth runs along x
    let room;
    if (!alongX) {
      const zc2 = cz(r);
      room = din.nz > 0 ? { x0: r.x0, x1: r.x1, z0: zc2, z1: r.z1 } : { x0: r.x0, x1: r.x1, z0: r.z0, z1: zc2 };
      if (room.z1 - room.z0 < 3.4) return { anchors: anchors };   // too shallow — stay a shell
    } else {
      const xc2 = cx(r);
      room = din.nx > 0 ? { x0: xc2, x1: r.x1, z0: r.z0, z1: r.z1 } : { x0: r.x0, x1: xc2, z0: r.z0, z1: r.z1 };
      if (room.x1 - room.x0 < 3.4) return { anchors: anchors };
    }
    const mx2 = (room.x0 + room.x1) / 2, mz2 = (room.z0 + room.z1) / 2;
    if (!h.clear(mx2, mz2, 1.0)) return { anchors: anchors };     // core/shaft owns the centre — an empty room is still a room
    // ONE long table, its long axis ACROSS the approach (the exec-suite read)
    const tanSpan = alongX ? (room.z1 - room.z0) : (room.x1 - room.x0);
    const TL = Math.max(2.2, Math.min(4.6, tanSpan - 3.0));
    const tb = function (across, hh, deep, ly, c) {
      h.b.lbox(mx2, y + ly, mz2, alongX ? deep : across, hh, alongX ? across : deep, c, { cast: false });
    };
    // a boardroom table: a 50 mm top on two slab pedestals with feet (it was a
    // 10 cm slab on a spine block, top at 0.53: below a knee)
    const tbAt = function (lat, across, hh, deep, ly, c) {
      h.b.lbox(alongX ? mx2 : mx2 + lat, y + ly, alongX ? mz2 + lat : mz2, alongX ? deep : across, hh, alongX ? across : deep, c, { cast: false });
    };
    tb(TL, 0.05, 1.2, 0.715, P.table);                            // top → 0.74
    for (const e of [-1, 1]) {
      tbAt(e * TL * 0.3, 0.08, 0.66, 0.8, 0.36, P.table);          // pedestal slab
      tbAt(e * TL * 0.3, 0.14, 0.03, 0.96, 0.015, P.bezel);        // its foot
    }
    // INTERIOR_LOOT_V1: what somebody left on the boardroom table after the
    // meeting — one container per meeting room, hash-thinned like every desk.
    lootReg(h.ox + mx2, y, h.oz + mz2, "desk");
    // chairs: three a side + one at each end, every one facing the table
    for (let i = -1; i <= 1; i++) for (let s = -1; s <= 1; s += 2) {
      const lat = i * (TL / 2 - 0.7), off = s * 1.05;
      const qx = alongX ? mx2 + off : mx2 + lat;
      const qz = alongX ? mz2 + lat : mz2 + off;
      if (!h.clear(qx, qz, 0.5)) continue;
      taskChair(h, qx, y, qz, alongX ? -s : 0, alongX ? 0 : -s, 0.48);
      seatReg(h, qx, y, qz, Math.atan2(mx2 - qx, mz2 - qz), "chair", 0.48);
    }
    for (let e = -1; e <= 1; e += 2) {
      const lat = e * (TL / 2 + 0.75);
      const qx = alongX ? mx2 : mx2 + lat;
      const qz = alongX ? mz2 + lat : mz2;
      if (!h.clear(qx, qz, 0.5)) continue;
      taskChair(h, qx, y, qz, alongX ? 0 : -e, alongX ? -e : 0, 0.48);
      seatReg(h, qx, y, qz, Math.atan2(mx2 - qx, mz2 - qz), "chair", 0.48);
    }
    // one wall screen on the FAR wall (glow proud of the bezel, toward the
    // room) + one light line over the table
    // the screen HANGS ON THE FAR WALL (it used to stand 0.7 m off it, in
    // mid-air): a 40 mm panel on the shell face, the glass 3 mm proud of it
    const SH = CBZ.interiorShellRect ? CBZ.interiorShellRect(h.b) : null;
    const farX = din.nx > 0 ? (SH ? SH.x1 : room.x1 + 0.4) : (SH ? SH.x0 : room.x0 - 0.4);
    const farZ = din.nz > 0 ? (SH ? SH.z1 : room.z1 + 0.4) : (SH ? SH.z0 : room.z0 - 0.4);
    const fx = alongX ? farX - Math.sign(din.nx) * 0.03 : mx2;
    const fz = alongX ? mz2 : farZ - Math.sign(din.nz) * 0.03;
    h.b.lbox(fx, y + 1.62, fz, alongX ? 0.04 : 2.3, 1.3, alongX ? 2.3 : 0.04, P.bezel, { cast: false });
    const screenOff = 0.02 + 0.003 + 0.002;
    h.b.lbox(alongX ? fx - Math.sign(din.nx) * screenOff : fx, y + 1.64,
      alongX ? fz : fz - Math.sign(din.nz) * screenOff,
      alongX ? 0.004 : 2.22, 1.2, alongX ? 2.22 : 0.004, P.glow, { emissive: P.glow, ei: 0.4, cast: false });
    ceilingStrip(h.b.lbox(mx2, y + ceilOff(h, y), mz2, alongX ? 0.34 : TL * 0.8, 0.01, alongX ? TL * 0.8 : 0.34, P.light,
      { emissive: P.light, ei: 0.3, cast: false }));
    return { anchors: anchors };
  }

  // ========================================================================
  //  (b/c) STORAGE — uniform rack rows on a fixed pitch, identical heights,
  //  identical shelf lines. An archive floor: monotony executed cleanly.
  // ========================================================================
  const RACK_PITCH = 2.6, RACK_SEG = 2.2, RACK_GAP = 0.5, RACK_H = 2.2;
  const RACK_DECK0 = 0.1, RACK_DECK = 0.52;          // deck centres 0.10 .. 2.18 (fitout_work stocks them)
  function progStorage(r, h) {
    shell(h, r);
    const y = r.y;
    const spanX = (r.x1 - r.x0) - 2.0;
    if (spanX < 0.5) return { anchors: [] };
    // same budget law as the desk farm above: 4 boxes a bay, and BOTH the run
    // count and the bays-per-run grow with the plate.
    const segs = Math.max(1, Math.floor(((r.z1 - 1.0) - (r.z0 + 1.2)) / (RACK_SEG + RACK_GAP)) + 1);
    const runs = gridCap(Math.max(1, 1 + Math.floor(spanX / RACK_PITCH)), segs, RACK_CAP)[0];
    const zEnd = r.z0 + 1.2 + Math.min(segs, Math.ceil(RACK_CAP / runs)) * (RACK_SEG + RACK_GAP);
    const rx0 = cx(r) - ((runs - 1) * RACK_PITCH) / 2;
    for (let i = 0; i < runs; i++) {
      const x = rx0 + i * RACK_PITCH;
      for (let z = r.z0 + 1.2; z + RACK_SEG <= Math.min(r.z1 - 1.0, zEnd); z += RACK_SEG + RACK_GAP) {
        const zc2 = z + RACK_SEG / 2;
        if (!h.clear(x, zc2, 0.8)) continue;                       // aisles/stairs punch clean gaps
        // OPEN STEEL SHELVING: four uprights and five decks you can see
        // through (the fit-out stocks them with archive boxes). The old bay
        // was a SOLID 2.2 m block with three strips on it: a wall of stacked
        // blocks, the worst thing on the office shot.
        for (const a of [-1, 1]) for (const e of [-1, 1])
          h.b.lbox(x + a * 0.28, y + RACK_H / 2, zc2 + e * (RACK_SEG / 2 - 0.03), 0.05, RACK_H, 0.05, P.desk, { cast: false });
        for (let lv = 0; lv < 5; lv++)
          h.b.lbox(x, y + RACK_DECK0 + lv * RACK_DECK, zc2, 0.6, 0.03, RACK_SEG, P.shelf, { cast: false });
        // INTERIOR_LOOT_V1: an archive bay you can actually go through. Thinned
        // hard — a rack floor is 80 bays and every one of them paying is a chore.
        lootReg(h.ox + x, y, h.oz + zc2, "rack");
      }
    }
    return { anchors: [] };
  }

  // ========================================================================
  //  (b) LOBBY — one front desk squarely facing the door, one waiting row,
  //  two planters, a lit name band. The rest of the arrival floor is open.
  //  opts.door = {x,z,nx,nz} (host-local doorway + INWARD normal). Returns
  //  ONE anchor: the receptionist's chair (facing the door).
  // ========================================================================
  function progLobby(r, h, opts) {
    shell(h, r);
    const anchors = [];
    const din = opts && opts.door;
    if (!din || din.nx == null) return { anchors: anchors };
    const y = r.y, nx = din.nx, nz = din.nz, tx = -nz, tz = nx;
    const along = Math.abs(nx) > 0.5;                 // door faces ±x → depth runs along x
    const at = function (inD, lat) { return { x: din.x + nx * inD + tx * lat, z: din.z + nz * inD + tz * lat }; };
    const obox = function (p, ly, across, hh, deep, c, o) {
      h.b.lbox(p.x, y + ly, p.z, along ? deep : across, hh, along ? across : deep, c, o || { cast: false });
    };
    const depth = along ? (r.x1 - r.x0) : (r.z1 - r.z0);
    const dIn = Math.min(6.0, Math.max(5.2, depth * 0.45));   // desk sits past the door aisle (aisle ends 4.8 in)
    let featureWall = false;
    // THE DESK — one long front desk square to the door
    const pd = at(dIn, 0);
    if (inRect(r, pd.x, pd.z, 1.2) && h.clear(pd.x, pd.z, 0.9)) {
      // a reception counter: set-back plinth, the front panel, a transaction
      // ledge at 1.05 for visitors and the staff worktop at 0.76 behind it
      obox(at(dIn - 0.04, 0), 0.05, 2.5, 0.1, 0.72, P.bezel);
      obox(pd, 0.55, 2.6, 0.9, 0.8, P.desk);
      obox(at(dIn - 0.08, 0), 1.035, 2.8, 0.05, 0.72, P.worktop);
      obox(at(dIn + 0.55, 0), 0.745, 2.4, 0.03, 0.5, P.worktop);
      // INTERIOR_LOOT_V1: the one desk on the arrival floor, and the only
      // container in this kit that is never thinned — there is exactly one
      // reception desk per lobby and skipping it would be skipping the lobby.
      lootReg(h.ox + pd.x, y, h.oz + pd.z, "reception");
      // the receptionist chair behind the desk, facing the door
      const pc = at(dIn + 0.95, 0);
      taskChair(h, pc.x, y, pc.z, -nx, -nz, 0.49);
      const yaw = Math.atan2(-nx, -nz);               // look back out the door
      anchors.push({
        x: h.ox + pc.x, y: y, z: h.oz + pc.z, face: yaw, lx: pc.x, lz: pc.z,
        cushionH: 0.49, floorBelow: 0,
      });
      // a FEATURE WALL behind reception, and the lit band mounted ON it (the
      // band used to float on its own 1.7 m behind the desk). The fit-out
      // veneers this wall in timber; its face is at dIn + 1.80.
      const pw = at(dIn + 1.86, 0), fe = at(dIn + 1.92, 0);
      featureWall = inRect(r, fe.x, fe.z, -0.35) && [-1.9, 0, 1.9].every(function (l) {
        const q = at(dIn + 1.86, l); return inRect(r, q.x, q.z, -0.35) && h.clear(q.x, q.z, 0.15);
      });
      if (featureWall) {
        h.b.lbox(pw.x, y + (h.fh - 0.2) / 2, pw.z, along ? 0.12 : 3.8, h.fh - 0.2, along ? 3.8 : 0.12, P.table, { cast: false, solid: true });
        const pb = at(dIn + 1.785, 0);
        h.b.lbox(pb.x, y + 2.35, pb.z, along ? 0.03 : 2.8, 0.36, along ? 2.8 : 0.03, P.light,
          { emissive: P.light, ei: 0.35, cast: false });
      }
    }
    // ONE waiting row — three seats, off the walk line, facing it
    const pbn = at(Math.min(dIn - 0.6, 4.6), -3.1);
    if (inRect(r, pbn.x, pbn.z, 1.0) && h.clear(pbn.x, pbn.z, 0.8)) {
      // a beam bench: two leg frames, the beam, a seat whose top is 0.44 (the
      // anchors' cushion), a back on posts. It was a slab and a board in the air.
      const bd = Math.min(dIn - 0.6, 4.6);
      for (const e of [-1, 1]) obox(at(bd + e * 0.95, -3.1), 0.2, 0.5, 0.4, 0.06, P.bezel);
      obox(pbn, 0.32, 0.05, 0.05, 2.1, P.bezel);                       // beam (runs along the bench)
      obox(pbn, 0.41, 0.48, 0.06, 2.2, P.chair);                       // seat → 0.44
      for (const e of [-1, 1]) obox(at(bd + e * 0.95, -3.33), 0.66, 0.04, 0.44, 0.04, P.bezel);
      obox(at(bd, -3.33), 0.74, 0.05, 0.36, 2.2, P.chair);             // back
      const fy = Math.atan2(tx, tz);                  // face across the walk (+tangent)
      for (let s = -1; s <= 1; s++) {
        const ps = at(Math.min(dIn - 0.6, 4.6) + s * 0.8, -3.1);
        seatReg(h, ps.x, y, ps.z, fy, "waiting", 0.44);
      }
    }
    // two planters flanking the walk, just inside the door
    for (let s = -1; s <= 1; s += 2) {
      const pp = at(2.0, s * 2.6);
      if (!inRect(r, pp.x, pp.z, 0.5) || !h.clear(pp.x, pp.z, 0.7)) continue;
      if (CBZ.furnish && CBZ.furnish.planter) {
        try { CBZ.furnish.planter(pp.x, y, pp.z, 0, { box: h.b.lbox, ox: h.ox, oz: h.oz, kind: "tree", s: 1.0 }); } catch (e) {}
      }
    }
    return { anchors: anchors, fit: { featureWall: featureWall } };
  }

  // ========================================================================
  //  THE APPROACH FRAME — the ONE orientation helper the door-relative
  //  programs share (progLobby had it inline; checkpoint/quarters/bosssuite
  //  all need the identical maths, so it lives here once). Given the room and
  //  the way you ARRIVE (a doorway, or a stairhead — same record shape), it
  //  returns a frame in which "inD" is metres INTO the room from the arrival
  //  and "lat" is metres sideways. Every one of the four rotations a building
  //  can present collapses to one code path, exactly like progMeeting's
  //  `alongX` trick, so a program is authored ONCE and reads correctly from
  //  any door side.
  // ========================================================================
  function approach(r, h, opts) {
    const din = (opts && opts.door && opts.door.nx != null)
      ? opts.door : { x: cx(r), z: r.z0, nx: 0, nz: 1 };
    const nx = din.nx, nz = din.nz, tx = -nz, tz = nx;
    const along = Math.abs(nx) > 0.5;                 // arrival on a ±x wall
    // opts.inset: metres of the plate the ARRIVAL STRUCTURE itself eats (the
    // stair core's footprint). Programs must not try to furnish the stairwell
    // — clearFloorPoint would reject every box and the room would come out
    // half-dressed — so we shift the whole frame past it instead.
    const inset = Math.max(0, (opts && opts.inset) || 0);
    const depth = (along ? (r.x1 - r.x0) : (r.z1 - r.z0)) - inset;
    const span = along ? (r.z1 - r.z0) : (r.x1 - r.x0);
    const y = r.y;
    // ORIGIN: depth 0 is the room edge you arrive through; lateral 0 is the
    // room's CENTRELINE, not the arrival point. This distinction matters — a
    // stairhead sits in a corner, so measuring lateral from IT would push
    // everything at ±span/2 straight through the far wall. The arrival's own
    // offset from the centreline is published as `gapLat` for the one thing
    // that genuinely wants it: lining a doorway up with the way you came in.
    const ctr = { x: cx(r), z: cz(r) };
    const ax = (along ? (nx > 0 ? r.x0 : r.x1) : ctr.x) + nx * inset;
    const az = (along ? ctr.z : (nz > 0 ? r.z0 : r.z1)) + nz * inset;
    const gapLat = (din.x - ctr.x) * tx + (din.z - ctr.z) * tz;
    function at(inD, lat) { return { x: ax + nx * inD + tx * lat, z: az + nz * inD + tz * lat }; }
    // an axis-aligned box in the approach frame: `across` is the sideways
    // extent, `deep` runs along the way you came in.
    function obox(p, ly, across, hh, deep, c, o) {
      if (!inRect(r, p.x, p.z, 0.12) || !h.clear(p.x, p.z, o && o.pad != null ? o.pad : 0.5)) return false;
      h.b.lbox(p.x, y + ly, p.z, along ? deep : across, hh, along ? across : deep, c,
        (o && o.emissive) ? { emissive: o.emissive, ei: o.ei || 0.45, cast: false } : { cast: false, solid: !!(o && o.solid) });
      return true;
    }
    // Built-in architecture is allowed on a reserved perimeter or partition.
    // `clearFloorPoint` is a placement guard for loose furniture; applying it
    // to a wall seal, portal casing or wainscot silently deletes exactly the
    // hierarchy the room needs whenever a stair/egress reserve crosses that
    // wall. Keep the bounds check, but deliberately skip floor clearance.
    function fitbox(p, ly, across, hh, deep, c, o) {
      if (!inRect(r, p.x, p.z, 0.08)) return false;
      h.b.lbox(p.x, y + ly, p.z, along ? deep : across, hh, along ? across : deep, c,
        (o && o.emissive) ? { emissive: o.emissive, ei: o.ei || 0.45, cast: false } : { cast: false });
      return true;
    }
    // face BACK toward the arrival (a guard watching the way in)
    const faceIn = Math.atan2(-nx, -nz);
    // face AWAY from the arrival (someone with their back to the door)
    const faceOut = Math.atan2(nx, nz);
    // a full-span SOLID partition at depth inD with ONE doorway at lateral
    // `gap`. Only the rooms that are PLACES call this now (the boss's flat,
    // the three state rooms); every generic program lost its divider.
    function divider(inD, gap, gapW, wallH) {
      const p = at(inD, 0), g = at(inD, gap);
      if (along) wallZ(h, y, p.x, r.z0, r.z1, g.z, gapW || 1.8, wallH);
      else wallX(h, y, p.z, r.x0, r.x1, g.x, gapW || 1.8, wallH);
    }
    // clamp a lateral offset so anything hung off it stays on the plate
    function lat(v, margin) { const m = span / 2 - (margin == null ? 1.4 : margin); return Math.max(-m, Math.min(m, v)); }
    return { at, obox, fitbox, divider, lat, gapLat, depth, span, along, y, faceIn, faceOut, nx, nz, tx, tz, r, h };
  }
  // an anchor in the approach frame, tagged with the ROLE the occupier should
  // cast there. Programs describe the room; occupy.js casts the people.
  function anchorAt(A, list, inD, lat, face, kind, pose, cushionH) {
    const p = A.at(inD, lat);
    if (!inRect(A.r, p.x, p.z, 0.6) || !A.h.clear(p.x, p.z, 0.5)) return null;
    const a = { x: A.h.ox + p.x, y: A.y, z: A.h.oz + p.z, face: face, lx: p.x, lz: p.z, kind: kind || "guard" };
    if (pose) a.pose = pose;
    if (cushionH != null) { a.cushionH = cushionH; a.floorBelow = 0; }
    list.push(a);
    return a;
  }

  // ========================================================================
  //  (b) CHECKPOINT — a floor held by people who expect trouble from the
  //  stairs. A sandbag line ACROSS the way in with ONE gap you must funnel
  //  through (the published chokepoint rule: 3-4 per level, never two covered
  //  from one post), a weapons locker, a duty table with a radio, a worklight
  //  aimed back down the approach, crates stacked in the dead corner. This is
  //  what makes floor 4 read as DEFENDED instead of "the desk floor again".
  //  Returns guard anchors: two behind the barricade covering the gap, one on
  //  the locker, one deep in the corner with the long angle.
  // ========================================================================
  function progCheckpoint(r, h, opts) {
    shell(h, r);
    const A = approach(r, h, opts);
    const anchors = [];
    const dep = A.depth, span = A.span;
    if (dep < 3.6 || span < 3.0) { anchorAt(A, anchors, dep * 0.55, 0, A.faceIn, "guard", "foldarms"); return { anchors: anchors }; }
    // ---- THE BARRICADE: two courses of sacks with one funnel gap ----------
    const bd = Math.min(4.6, Math.max(2.4, dep * 0.34));      // stand-off from the way in
    const half = span / 2 - 0.6;
    // The funnel is deliberately NOT in line with the stair door: the
    // published rule is that no single post may cover two chokepoints, so the
    // gap steps sideways off the way in and you have to cross the room to it.
    const gap = A.lat(A.gapLat + (span > 6.5 ? 1.9 : 0), 1.3);
    // MESH BUDGET: a sandbag line spanning a 25m floorplate would be ~50 boxes
    // AND would read as a wall, not a barricade. Cap the run either side of the
    // funnel — this is a checkpoint you flank, not a fortification.
    const barLo = Math.max(-half, gap - 5.0), barHi = Math.min(half, gap + 5.0);
    for (let lat = barLo; lat <= barHi + 0.01; lat += 1.0) {
      if (Math.abs(lat - gap) < 0.95) continue;                // the funnel
      const p = A.at(bd, lat);
      A.obox(p, 0.18, 0.98, 0.36, 0.6, P.sack, { pad: 0.4 });
      A.obox({ x: p.x, z: p.z }, 0.53, 0.9, 0.32, 0.55, P.sack, { pad: 0.4 });
    }
    // a knocked-over chair and a mug at the gap: someone left in a hurry
    A.obox(A.at(bd - 0.9, gap + 0.7), 0.12, 0.5, 0.22, 0.5, P.chair, { pad: 0.35 });
    // ---- WORKLIGHT on a mast, pointed back down the approach --------------
    { const p = A.at(bd + 1.9, gap);
      A.obox(p, 1.1, 0.12, 2.2, 0.12, P.steel, { pad: 0.4 });
      A.obox(p, 2.3, 0.5, 0.26, 0.34, P.flood, { emissive: P.flood, ei: 0.85, pad: 0.4 }); }
    // ---- WEAPONS LOCKERS against one side wall ----------------------------
    // INTERIOR_LOOT_V1: these were the most obviously interactable object in
    // the whole kit and were pure decoration. They are now the one container
    // that can pay in a REAL gun (LOOT_KIND.weapons.gun, a deliberately small
    // band) — which is what makes fighting up to a checkpoint floor worth it.
    for (let i = 0; i < 2; i++) {
      if (A.obox(A.at(dep * 0.62 + i * 0.95, half - 0.35), 0.95, 0.9, 1.9, 0.55, P.steel, { pad: 0.45 }))
        lootAtA(A, dep * 0.62 + i * 0.95, half - 0.35, "weapons");
    }
    // ---- DUTY TABLE + radio + two stools on the opposite side -------------
    { const p = A.at(dep * 0.68, -half + 0.9);
      if (A.obox(p, 0.36, 1.5, 0.08, 0.9, P.worktop, { pad: 0.5 })) {
        A.obox(p, 0.18, 1.4, 0.34, 0.8, P.desk, { pad: 0.5 });
        A.obox(A.at(dep * 0.68 + 0.35, -half + 0.9), 0.52, 0.34, 0.24, 0.22, P.bezel, { pad: 0.45 });   // the radio set
        A.obox(A.at(dep * 0.68 + 0.36, -half + 0.9), 0.6, 0.2, 0.06, 0.06, P.glow, { emissive: P.glow, ei: 0.6, pad: 0.45 });
        A.obox(A.at(dep * 0.68 - 1.0, -half + 0.9), 0.22, 0.4, 0.44, 0.4, P.chair, { pad: 0.4 });
      } }
    // ---- THE FALL-BACK in the dead corner: a steel desk tipped over, its top
    // standing on edge toward the way in (solid: real cover for the man with
    // the long angle), the drawer pedestal and modesty panel behind it, and
    // the ammo cans they keep back there (the loot).
    { const dd = dep - 1.9, dl = A.lat(-half + 1.0, 0.9);
      if (A.obox(A.at(dd, dl), 0.38, 1.5, 0.76, 0.05, P.desk, { pad: 0.45, solid: true })) {
        A.obox(A.at(dd + 0.39, dl - 0.52), 0.36, 0.42, 0.7, 0.72, P.desk, { pad: 0.3 });     // pedestal, drawers up
        A.obox(A.at(dd + 0.72, dl), 0.52, 1.36, 0.36, 0.03, P.desk, { pad: 0.3 });           // modesty panel
        A.obox(A.at(dd + 0.39, dl + 0.72), 0.03, 0.05, 0.05, 0.7, P.steel, { pad: 0.3 });    // a leg, floor end
        const ac = A.at(dd + 0.55, dl + 0.2);
        if (A.obox(ac, 0.095, 0.3, 0.19, 0.16, 0x4d5a3a, { pad: 0.3 })) {                     // two ammo cans
          A.obox(A.at(dd + 0.55, dl + 0.2), 0.285, 0.3, 0.19, 0.16, 0x4d5a3a, { pad: 0.3 });
          A.obox(A.at(dd + 0.55, dl + 0.2), 0.39, 0.12, 0.02, 0.03, 0x2a2a2a, { pad: 0.3 }); // the lid latch
          lootAtA(A, dd + 0.55, dl + 0.2, "crate");
        }
      } }
    // ---- THE POSTS --------------------------------------------------------
    // every lateral goes through A.lat() so a wide plate can't push a post
    // through the far wall and silently lose it to the inRect check
    anchorAt(A, anchors, bd + 1.0, A.lat(gap - 1.5, 1.0), A.faceIn, "guard", "foldarms");     // covers the funnel
    anchorAt(A, anchors, bd + 1.0, A.lat(gap + 1.9, 1.0), A.faceIn, "guard", "foldarms");     // second angle on it
    anchorAt(A, anchors, dep * 0.62, A.lat(half - 1.5, 1.0), A.faceIn, "guard", "foldarms");  // on the lockers
    anchorAt(A, anchors, dep - 1.4, A.lat(gap * 0.5, 1.0), A.faceIn, "guard", "foldarms");    // the long angle from the back
    return { anchors: anchors };
  }

  // ========================================================================
  //  (c) QUARTERS — a floor people LIVE on while they hold the building.
  //  Bunk rows against both side walls, footlockers, a mess table down the
  //  middle, one strip light. Monotony on purpose (archetype (c)) — it is the
  //  same eight bunks on every crew floor, which is exactly how a barracks
  //  reads. Doubles as a military-base dormitory with zero changes.
  // ========================================================================
  const BUNK_PITCH = 2.2;
  function progQuarters(r, h, opts) {
    shell(h, r);
    const A = approach(r, h, opts);
    const anchors = [];
    const dep = A.depth, span = A.span;
    if (dep < 4.0 || span < 3.4) return { anchors: anchors };
    const half = span / 2 - 0.55;
    // MESH BUDGET + read: 4 bunks a wall is a barracks; 12 is a warehouse of
    // beds and ~90 boxes on one floor. Cap it.
    const rows = Math.max(1, Math.min(4, Math.floor((dep - 3.0) / BUNK_PITCH)));
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < rows; i++) {
        const inD = 2.2 + i * BUNK_PITCH;
        const p = A.at(inD, s * half);
        // lower bunk, upper bunk, one footlocker at the foot
        if (!A.obox(p, 0.42, 0.95, 0.16, 1.9, P.sofa, { pad: 0.45 })) continue;
        A.obox(p, 0.30, 0.9, 0.30, 1.85, P.steel, { pad: 0.45 });      // frame under the mattress
        A.obox(p, 1.42, 0.95, 0.16, 1.9, P.sofa, { pad: 0.45 });       // upper mattress
        A.obox(p, 1.30, 0.9, 0.28, 1.85, P.steel, { pad: 0.45 });
        A.obox(A.at(inD, s * (half - 1.05)), 0.79, 0.1, 1.58, 0.1, P.steel, { pad: 0.4 });  // ladder post (foot on the deck, head at the top bunk)
        // INTERIOR_LOOT_V1: the footlocker at the foot of every bunk. Somebody
        // LIVES on this floor — the box beside his bed is the whole reason to
        // walk down the row instead of past it.
        if (A.obox(A.at(inD + 1.0, s * (half - 0.2)), 0.2, 0.5, 0.4, 0.7, P.crate, { pad: 0.4 }))  // footlocker
          lootAtA(A, inD + 1.0, s * (half - 0.2), "footlocker");
      }
    }
    // mess table down the centre + benches
    if (span > 5.2) {
      const mid = A.at(dep * 0.5, 0);
      if (A.obox(mid, 0.74, 0.9, 0.08, Math.min(3.2, dep * 0.4), P.worktop, { pad: 0.6 })) {
        A.obox(mid, 0.36, 0.7, 0.68, Math.min(3.0, dep * 0.38), P.desk, { pad: 0.6 });
        for (let s = -1; s <= 1; s += 2)
          A.obox(A.at(dep * 0.5, s * 0.85), 0.38, 0.4, 0.1, Math.min(2.8, dep * 0.36), P.chair, { pad: 0.5 });
      }
      anchorAt(A, anchors, dep * 0.5 - 1.6, 0, A.faceIn, "guard", "foldarms");
    }
    anchorAt(A, anchors, 1.6, half - 1.2, A.faceIn, "guard", "foldarms");
    return { anchors: anchors };
  }

  // ========================================================================
  //  (b) BOSS SUITE — the top floor, and the ONE room in this kit that is a
  //  PLACE rather than a program. The owner's ask, literally: "the boss
  //  sitting in an office in an apt on the top floor... with family."
  //
  //  So it is two rooms behind one divider: you come off the stairs into
  //  somebody's HOME — a dinner half-eaten on the table, a sofa facing a wall
  //  screen, a rug, a kitchen run, a kid's toy on the floor — and only then,
  //  through the doorway, the OFFICE: one heavy desk with its back to the
  //  glass, two chairs waiting in front of it, a drinks cabinet, a floor safe
  //  and a lit aquarium against the far wall. (Research: the top floor has to
  //  differ in KIND, not difficulty — domestic staging after ten floors of
  //  cover geometry is the whole payoff, and one memorable personal prop is
  //  what people actually remember about a boss room.)
  //
  //  Anchors are tagged so the occupier casts the right person in the right
  //  spot without re-deriving geometry: "boss" behind the desk facing the way
  //  in, "family" at the dinner table and on the sofa, "guard" flanking the
  //  desk and standing on the divider doorway.
  // ========================================================================
  function progBossSuite(r, h, opts) {
    shell(h, r);
    const A = approach(r, h, opts);
    const anchors = [];
    const dep = A.depth, span = A.span, y = r.y, wallH = h.fh - 0.1;
    const half = span / 2 - 0.6;
    // COMPACT fallback: a plate too small for two rooms still gets a desk, a
    // sofa and the aquarium — one room, same reading, no divider.
    const twoRoom = dep >= 9.0 && span >= 5.0;
    const dv = twoRoom ? dep * 0.5 : 0;
    // the inner doorway lines up with the way you arrive, so from the stairs
    // you can see straight through the home into the office
    const dgap = twoRoom ? A.lat(A.gapLat, 1.4) : 0;
    if (twoRoom) A.divider(dv, dgap, 1.9, wallH);

    /* ---------------- THE HOME (near half) ------------------------------- */
    const homeEnd = twoRoom ? dv : dep;
    if (twoRoom) {
      // dinner, mid-meal: table, four chairs, four plates, one chair pushed out
      const tD = Math.min(2.4, (homeEnd - 2.0) * 0.5), td = 2.0;
      const tp = A.at(td, half - 1.5);
      if (A.obox(tp, 0.74, 1.15, 0.08, tD, P.wood, { pad: 0.55 })) {
        A.obox(tp, 0.36, 0.9, 0.68, tD * 0.75, P.wood, { pad: 0.55 });
        for (let i = -1; i <= 1; i += 2) for (let s = -1; s <= 1; s += 2) {
          const cp = A.at(td + i * (tD * 0.28), half - 1.5 + s * 0.85);
          if (!A.obox(cp, 0.42, 0.46, 0.12, 0.46, P.chair, { pad: 0.4 })) continue;
          A.obox(A.at(td + i * (tD * 0.28), half - 1.5 + s * 1.06), 0.78, 0.46, 0.6, 0.1, P.chair, { pad: 0.4 });
          seatReg(h, cp.x, y, cp.z, Math.atan2(tp.x - cp.x, tp.z - cp.z), "chair", 0.48);
        }
        for (let i = -1; i <= 1; i += 2) for (let s = -1; s <= 1; s += 2)   // the plates
          A.obox(A.at(td + i * (tD * 0.2), half - 1.5 + s * 0.5), 0.8, 0.34, 0.03, 0.34, P.marble, { pad: 0.3 });
        // two of them still at the table, facing across it at each other
        anchorAt(A, anchors, td - tD * 0.28, half - 2.56, A.faceOut, "family", "stand");
        anchorAt(A, anchors, td + tD * 0.28, half - 0.44, A.faceIn, "family", "stand");
      }
      // the living end: rug, sofa facing the divider, low table, wall screen
      const sd = Math.max(td + 2.4, homeEnd - 3.2);
      A.obox(A.at(sd + 0.6, -half + 1.9), 0.011, Math.min(4.0, span * 0.5), 0.016, Math.min(3.2, homeEnd * 0.34), P.rug, { pad: 0.7 });
      const sp = A.at(sd, -half + 1.9);
      if (A.obox(sp, 0.36, 2.5, 0.44, 0.9, P.sofa, { pad: 0.6 })) {
        A.obox(A.at(sd - 0.42, -half + 1.9), 0.72, 2.5, 0.62, 0.16, P.sofa, { pad: 0.6 });   // backrest
        seatReg(h, sp.x, y, sp.z, A.faceOut, "sofa", 0.58);
        anchorAt(A, anchors, sd + 0.05, -half + 2.75, A.faceOut, "family", "stand");
      }
      A.obox(A.at(sd + 1.5, -half + 1.9), 0.24, 1.3, 0.1, 0.6, P.wood, { pad: 0.5 });        // low table
      // the wall screen on the divider, facing the sofa
      if (twoRoom) {
        A.obox(A.at(dv - 0.14, -half + 1.9), 1.55, 2.0, 1.05, 0.07, P.bezel, { pad: 0.4 });
        A.obox(A.at(dv - 0.175 - SCREEN_GAP - 0.015, -half + 1.9),
          1.55, 1.75, 0.85, 0.03, P.glow, { emissive: P.glow, ei: 0.5, pad: 0.4 });
      }
      // the kitchen run down one wall + a warm pendant over the table
      for (let i = 0; i < 3; i++) {
        A.obox(A.at(1.4 + i * 1.05, -half + 0.35), 0.46, 1.0, 0.9, 0.62, P.desk, { pad: 0.45 });
        A.obox(A.at(1.4 + i * 1.05, -half + 0.35), 0.94, 1.02, 0.06, 0.66, P.marble, { pad: 0.45 });
      }
      A.obox(A.at(td, half - 1.5), h.fh - 0.75, 0.7, 0.14, 0.7, P.lamp, { emissive: P.lamp, ei: 0.55, pad: 0.5 });
      // a kid's toy left on the rug — the detail that says people live here
      A.obox(A.at(sd + 1.9, -half + 3.0), 0.14, 0.3, 0.28, 0.3, 0x3f9a4f, { pad: 0.3 });
    }

    /* ---------------- THE OFFICE (far half) ------------------------------ */
    const o0 = twoRoom ? dv + 0.9 : 1.6;
    const deskD = dep - 2.4;
    const dp = A.at(deskD, 0);
    let bossPlaced = false;
    if (deskD > o0 + 0.4 && A.obox(dp, 0.4, 2.9, 0.78, 1.15, P.wood, { pad: 0.7 })) {
      A.obox(dp, 0.81, 3.1, 0.08, 1.3, P.marble, { pad: 0.7 });                     // the top
      A.obox(A.at(deskD - 0.35, 0.9), 0.9, 0.55, 0.1, 0.42, P.bezel, { pad: 0.5 }); // papers
      A.obox(A.at(deskD - 0.3, -0.95), 1.02, 0.5, 0.34, 0.06, P.bezel, { pad: 0.5 });
      // The chair is on the +depth side: put the display on that face. The old
      // -0.32 coordinate put it through the back of the monitor.
      A.obox(A.at(deskD - 0.27 + SCREEN_GAP + 0.01, -0.95),
        1.02, 0.42, 0.26, 0.02, P.screen, { pad: 0.5 });
      // the chair, and the man in it — back to the glass, facing the only way in
      const bp = A.at(deskD + 1.05, 0);
      A.obox(bp, 0.44, 0.62, 0.14, 0.62, P.chair, { pad: 0.5 });
      A.obox(A.at(deskD + 1.32, 0), 0.95, 0.66, 0.9, 0.12, P.chair, { pad: 0.5 });
      seatReg(h, bp.x, y, bp.z, A.faceIn, "boss", 0.51);
      bossPlaced = !!anchorAt(A, anchors, deskD + 1.05, 0, A.faceIn, "boss", "sit", 0.51);
      // two chairs waiting on the near side of the desk
      for (let s = -1; s <= 1; s += 2) {
        const gp = A.at(deskD - 1.5, s * 0.95);
        if (!A.obox(gp, 0.42, 0.5, 0.12, 0.5, P.chair, { pad: 0.4 })) continue;
        A.obox(A.at(deskD - 1.78, s * 0.95), 0.8, 0.5, 0.62, 0.12, P.chair, { pad: 0.4 });
        seatReg(h, gp.x, y, gp.z, A.faceOut, "chair", 0.48);
      }
    }
    // THE AQUARIUM — the one prop you remember the room by. Lit water on a
    // dark plinth against the far wall, glowing across the desk at night.
    { const ap = A.at(dep - 0.75, half - 1.4);
      if (A.obox(ap, 0.4, 2.1, 0.8, 0.55, P.wood, { pad: 0.5 })) {
        A.obox(ap, 1.32, 2.0, 1.0, 0.5, P.water, { emissive: P.water, ei: 0.6, pad: 0.5 });
        A.obox(ap, 1.86, 2.1, 0.08, 0.55, P.steel, { pad: 0.5 });
      } }
    // drinks cabinet + a floor safe + framed pictures on the far wall
    // INTERIOR_LOOT_V1: THE TOP OF THE LADDER. The cabinet is a good haul; the
    // SAFE is the crafted, guarded prize — quiet if the men in this room are
    // already dead, seven loud seconds and a filed burglary if they are not
    // (CBZ.interiorLootTake). Its cash scales with the tower's wealth tier,
    // which is the only "difficulty" here that pays differently.
    const suiteW = suiteWealth(h);
    if (A.obox(A.at(dep - 0.8, -half + 1.3), 0.5, 1.6, 1.0, 0.5, P.wood, { pad: 0.5 }))
      lootAtA(A, dep - 0.8, -half + 1.3, "cabinet", { wealth: suiteW });
    A.obox(A.at(dep - 0.8, -half + 1.3), 1.08, 1.4, 0.16, 0.4, P.gold, { emissive: P.gold, ei: 0.25, pad: 0.5 });
    if (A.obox(A.at(dep - 0.7, -half + 2.7), 0.35, 0.8, 0.7, 0.6, P.steel, { pad: 0.45 }))   // the safe
      lootAtA(A, dep - 0.7, -half + 2.7, "safe", { wealth: suiteW });
    for (let i = -1; i <= 1; i++)
      A.obox(A.at(dep - 0.34, i * 1.5), 2.0, 0.62, 0.46, 0.05, P.gold, { pad: 0.35 });
    // one warm lamp over the desk, one over the aquarium
    A.obox(A.at(deskD, 0), h.fh - 0.7, 1.3, 0.1, 0.5, P.lamp, { emissive: P.lamp, ei: 0.5, pad: 0.6 });

    /* ---------------- the two men who never leave the room --------------- */
    anchorAt(A, anchors, deskD - 0.3, half - 1.9, A.faceIn, "guard", "foldarms");
    anchorAt(A, anchors, deskD - 0.3, -half + 1.9, A.faceIn, "guard", "foldarms");
    if (twoRoom) anchorAt(A, anchors, dv + 0.55, dgap, A.faceIn, "guard", "foldarms");   // on the inner doorway
    if (!bossPlaced) anchorAt(A, anchors, dep * 0.7, 0, A.faceIn, "boss", "stand");      // degenerate plate: still a boss
    return { anchors: anchors };
  }

  // ========================================================================
  //  (a/c) RESIDENTIAL — A FLOOR OF FLATS, NOT ONE FLAT.
  //
  //  OWNER: "HERES AN INTERIOR, A FULL FLOOR OF TINY APARTMENTS EACH WITH A BED
  //  THATS IT, TINY TINY APARTMENTS."  Every residential storey in this game was
  //  ONE dwelling spread over the whole plate — on a 27 m lot that is a
  //  penthouse on floor 2, floor 3 and floor 4 of a tenement. A residential
  //  FLOOR is a corridor with doors off it.
  //
  //  The unit width is not a taste: 3.2-4.6 m is the real width of a studio /
  //  SRO bay, and the corridor is 1.7 m (over the 1.12 m egress minimum, because
  //  the player capsule is 0.55 m and a 1.12 m hall reads as a coffin). The unit
  //  COUNT falls out of the plate — nobody types it.
  //
  //  IT AUTHORS NO FURNITURE. Each unit is planned ONCE per building through
  //  world/roombuild.js (`bedroom`: headboard to a wall, a wardrobe, a little
  //  desk, real propuse cushions, a flood-fill that DROPS anything you could not
  //  walk to) and that ONE plan is replayed at every unit on every storey — which
  //  is both 1 planner call instead of ~100 and, exactly, the monotony doctrine:
  //  the flats are identical because they were built identical. The only thing
  //  drawn here is the KITCHEN RUN, because a kitchenette is joinery, not
  //  furniture, and roombuild has no verb for it.
  // ========================================================================
  // MESH BUDGET, the same law the desk farm and the rack floor already carry: a
  // flat costs ~20 boxes, and BOTH the flat count and the storeys grow with the
  // plate. FLAT_CAP bounds the FLOOR (a wider plate gets wider flats, not more
  // of them — which is also true of a real building: downtown flats are bigger),
  // and the per-flat piece cap (solved below off the bay's own area) takes the
  // top-priority pieces of the plan, which is the owner's brief read literally:
  // "EACH WITH A BED THATS IT".
  const UNIT_MIN = 3.0, CORR_W = 1.7, UNIT_CAP = 8;
  const FLAT_CAP = 12;
  function progResidential(r, h, opts) {
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    const alongX = w >= d;                        // corridor runs down the LONG axis
    const runLo = alongX ? r.x0 : r.z0, runHi = alongX ? r.x1 : r.z1;
    const crossLo = alongX ? r.z0 : r.x0, crossHi = alongX ? r.z1 : r.x1;
    const runLen = runHi - runLo, cross = crossHi - crossLo;
    // two ranks of flats only when the plate can face them off across a hall
    const twoSided = cross >= CORR_W + 2 * 2.9;
    const unitD = twoSided ? (cross - CORR_W) / 2 : (cross - CORR_W);
    // how many flats the RUN can hold at the real minimum bay width…
    const room = Math.min(UNIT_CAP, Math.floor(runLen / UNIT_MIN));
    // DECLINE rather than half-build: a plate that cannot hold two flats IS one
    // flat, and buildings.js's single-dwelling dresser does that better. Nothing
    // has been drawn yet at this point, so the caller's fallback is clean.
    if (unitD < 2.7 || room < 2) return null;
    // …and the BAY WIDTH is proportioned off the depth the plate actually
    // leaves, so a shallow shop-house gets true 3 m SRO bays and a deep point
    // block gets 6 m two-beds instead of a 4 m x 12 m bowling alley. Never below
    // two flats, never past the floor's mesh budget.
    const ranks = twoSided ? 2 : 1;
    const target = Math.max(3.4, Math.min(6.2, unitD * 0.5));
    // …and the budget RIDES THE TOWER. A 5-storey walk-up can afford 12 flats a
    // floor; the 52-storey flagship cannot afford 12 x 49 of them, and its
    // storeys all get dressed. The cap falls with height and floors at 5, which
    // on a 27 m plate is a real point block — five doors round a core.
    const st = Math.max(1, (h.b.storeys | 0) || 1);
    const flatCap = Math.max(5, Math.min(FLAT_CAP, Math.round(140 / st)));
    const units = Math.max(2, Math.min(room, Math.ceil(flatCap / ranks),
      Math.max(1, Math.round(runLen / target))));
    const UW = runLen / units;
    // "EACH WITH A BED THATS IT" is the brief for a 12 m² bay; a 70 m² one can
    // carry the whole plan. The planner already RANKED its pieces (bed 9,
    // wardrobe 5, desk 4, lamp 2), so this is a cut, never a choice.
    const pieceCap = Math.max(2, Math.min(5, Math.round((UW * unitD) / 18) + 1));

    shell(h, r);
    const anchors = [], beds = [];
    const y = r.y, wallH = h.fh - 0.1;
    const cMid = (crossLo + crossHi) / 2;
    const cLo = cMid - CORR_W / 2, cHi = cMid + CORR_W / 2;
    // ---- one frame, four rotations (progMeeting's alongX trick) -------------
    const P = function (run, cr) { return alongX ? { x: run, z: cr } : { x: cr, z: run }; };
    // WHICH storey this is, so a flat can be called Unit 3B out loud.
    const floorK = floorIndexOf(r, h);
    const addr = "apt:" + Math.round(h.ox) + "_" + Math.round(h.oz) + ":" + floorK;
    // a wall RUNNING along the corridor at a fixed cross coordinate
    const wallRun = function (crossAt, a, b2, gap, gapW) {
      if (alongX) wallX(h, y, crossAt, a, b2, gap, gapW, wallH);
      else wallZ(h, y, crossAt, a, b2, gap, gapW, wallH);
    };
    // a party wall ACROSS the corridor at a fixed run coordinate (never gapped)
    const wallCross = function (runAt, a, b2) {
      if (alongX) wallZ(h, y, runAt, a, b2, b2 + 1e6, 1.8, wallH);
      else wallX(h, y, runAt, a, b2, b2 + 1e6, 1.8, wallH);
    };
    const sides = twoSided ? [-1, 1] : [-1];
    // ---- the PLAN, once per building, one per side --------------------------
    // (side −1's door is on its +cross wall and side +1's on its −cross wall, so
    //  the two ranks are mirror images and each needs its own solve.)
    const seed = (Math.round(h.ox) * 401) ^ (Math.round(h.oz) * 733);
    const uRun0 = runLo + 0.14, uRun1 = runLo + UW - 0.14;
    function planFor(side) {
      if (!CBZ.roomPlan || CFG.INTERIOR_COHERENCE_V1 === false) return null;
      const c0 = side < 0 ? crossLo + 0.14 : cHi + 0.14;
      const c1 = side < 0 ? cLo - 0.14 : crossHi - 0.14;
      const a = P(uRun0, c0), b2 = P(uRun1, c1);
      const door = P((uRun0 + uRun1) / 2, side < 0 ? cLo : cHi);
      let p = null;
      try {
        p = CBZ.roomPlan({ x0: Math.min(a.x, b2.x), x1: Math.max(a.x, b2.x),
                           z0: Math.min(a.z, b2.z), z1: Math.max(a.z, b2.z), y: y },
          "bedroom", { seed: seed + (side < 0 ? 0 : 17), door: door, inset: 0.08,
                       tone: (opts && opts.tone) || "warm" });
      } catch (e) { p = null; }
      if (!p || !p.pieces || !p.pieces.length) return null;
      // the flat is TINY: keep the highest-priority pieces (the bed first — the
      // planner already ranked them) and let the rest go. Re-ordering the plan's
      // own array is what lets `max` below mean "the important ones".
      p.pieces.sort(function (m, q) { return (q.prio | 0) - (m.prio | 0); });
      return p;
    }
    // TWO SOLVES A FLOOR — which is exactly the cost of the two `planSet` calls
    // (living room + bedroom) this program replaces on every apartment storey,
    // so the world build pays no more than it already did. The seed is the
    // BUILDING, so every storey of a tower plans the identical flat: the flats
    // are identical because they were BUILT identical, which is the monotony
    // doctrine rather than an economy.
    // THE FIT-OUT OWNS THE FLAT NOW (city/fitout_plans.js). One pure planner
    // (CBZ.fitoutUnitPlan) lays out each unit the way a flat is drawn: a
    // bathroom by the entry, the kitchen run on the other party wall, living
    // in the middle, the bedroom behind a partition at the window. This eager
    // pass draws only what must exist while you are across town: the BED (a
    // resident sleeps in it at night) and the containers' registry rows.
    // Everything else is built when you walk in and freed when you leave. The
    // roomPlan replay below is the fallback when that file is gone.
    const unitPlanner = CFG.INTERIOR_COHERENCE_V1 !== false && typeof CBZ.fitoutUnitPlan === "function";
    const plans = unitPlanner ? { "-1": null, "1": null }
      : { "-1": planFor(-1), "1": twoSided ? planFor(1) : null };
    // the shell's inner faces: a unit runs to the real wall at the facade and
    // at the ends of the rank, never stopping 0.4 m short of it.
    const SH = CBZ.interiorShellRect(h.b) || { x0: r.x0 - 0.4, x1: r.x1 + 0.4, z0: r.z0 - 0.4, z1: r.z1 + 0.4 };
    const shLo = alongX ? SH.x0 : SH.z0, shHi = alongX ? SH.x1 : SH.z1;
    const shCLo = alongX ? SH.z0 : SH.x0, shCHi = alongX ? SH.z1 : SH.x1;
    const runFaceLo = Math.max(shLo, runLo - 0.42), runFaceHi = Math.min(shHi, runHi + 0.42);
    const faceLo = Math.max(shCLo, crossLo - 0.42), faceHi = Math.min(shCHi, crossHi + 0.42);
    const fitUnits = [];
    // ---- the floor: corridor walls with a door per flat, party walls between.
    // A flat is only built where its OWN FRONT DOOR is walkable. The ground
    // storey's entrance aisle, the stair strip and the lift chase therefore
    // punch a clean hole in the rank instead of a corridor wall standing across
    // the way in.
    const kept = { "-1": [], "1": [] };
    let live = 0;
    for (let u = 0; u < units; u++) {
      const a = runLo + u * UW, b2 = a + UW;
      const mid = (a + b2) / 2;
      const ra = u === 0 ? runFaceLo : a, rb = u === units - 1 ? runFaceHi : b2;
      for (let s = 0; s < sides.length; s++) {
        const side = sides[s], key = side < 0 ? "-1" : "1";
        const crossAt = side < 0 ? cLo : cHi;
        const dp = P(mid, crossAt);
        if (!inRect(r, dp.x, dp.z, 0.2) || !h.clear(dp.x, dp.z, 0.8)) { kept[key][u] = false; continue; }
        kept[key][u] = true; live++;
        wallRun(crossAt, unitPlanner ? ra : a, unitPlanner ? rb : b2, mid, 1.0);   // the corridor wall...
        // ...and the flat's own LOCKED front door filling the gap in it. This
        // is the one interior wall the owner asked for by name: "locked
        // apartment you have key to that allows interior walls in an apartment
        // building". The corridor stays public; the flat does not.
        const n = u * sides.length + s;
        const label = "Unit " + (floorK + 1) + String.fromCharCode(65 + (n % 26));
        unitDoor(h, y, alongX ? "x" : "z", crossAt, mid, 1.0, wallH,
          addr + ":" + n, label);
        // PARTY WALL at this flat's low end. Drawn whether or not the flat
        // before it was built: a flat beside the entrance aisle used to stand
        // OPEN to it, so its locked door was a door in a wall you could walk
        // round. (The high end of the last flat before a gap is closed below.)
        if (u > 0) {
          if (side < 0) wallCross(a, unitPlanner ? faceLo : crossLo, cLo);
          else wallCross(a, cHi, unitPlanner ? faceHi : crossHi);
        }
        if (unitPlanner) {
          // the unit as a room: building-local rect to the wall faces, the door
          // on its corridor wall, the inward normal from that door.
          const cIn = side < 0 ? -1 : 1;                    // cross direction into the flat
          const c0 = side < 0 ? faceLo : cHi + PWT / 2, c1 = side < 0 ? cLo - PWT / 2 : faceHi;
          const r0 = (u === 0 ? runFaceLo : a + PWT / 2), r1 = (u === units - 1 ? runFaceHi : b2 - PWT / 2);
          const lo = P(r0, c0), hi = P(r1, c1);
          const U = {
            id: addr + ":" + n, label: label, n: n, floor: floorK, y: y,
            x0: Math.min(lo.x, hi.x), x1: Math.max(lo.x, hi.x), z0: Math.min(lo.z, hi.z), z1: Math.max(lo.z, hi.z),
            door: P(mid, crossAt + cIn * PWT / 2),
            inX: alongX ? 0 : cIn, inZ: alongX ? cIn : 0,
            alongX: alongX, partyLo: u > 0, partyHi: u < units - 1,
          };
          const plan = CBZ.fitoutUnitPlan(U, seed ^ (n * 131));
          U.plan = plan;
          if (plan && plan.bed && CBZ.furnish && CBZ.furnish.bed) {
            let rb2 = null;
            try {
              rb2 = CBZ.furnish.bed(plan.bed.x, y, plan.bed.z, plan.bed.yaw,
                { box: h.b.lbox, ox: h.ox, oz: h.oz, len: plan.bed.len, wide: plan.bed.wide, tone: plan.bed.tone || null });
            } catch (e) { rb2 = null; }
            if (rb2 && rb2.beds) for (let q = 0; q < rb2.beds.length; q++) beds.push(rb2.beds[q]);
            if (rb2 && rb2.beds && rb2.beds[0]) U.bedRec = rb2.beds[0];   // the fit-out puts the tenant in it at night
          }
          if (plan && plan.kitchen) lootReg(h.ox + plan.kitchen.x, y, h.oz + plan.kitchen.z, "kitchen");
          fitUnits.push(U);
          continue;
        }
        // KITCHEN RUN against the corridor wall, beside the door (fallback path).
        const kLen = Math.min(UW / 2 - 0.75, 1.6);
        const kOff = 0.62 + kLen / 2;
        const kIn = side < 0 ? -0.42 : 0.42;
        const kp = P(mid - kOff, crossAt + kIn);
        if (kLen >= 0.7 && inRect(r, kp.x, kp.z, 0.3) && h.clear(kp.x, kp.z, 0.5)) {
          h.b.lbox(kp.x, y + 0.45, kp.z, alongX ? kLen : 0.62, 0.9, alongX ? 0.62 : kLen, P_KIT.body, { cast: false });
          h.b.lbox(kp.x, y + 0.93, kp.z, alongX ? kLen + 0.06 : 0.68, 0.06, alongX ? 0.68 : kLen + 0.06, P_KIT.top, { cast: false });
          lootReg(h.ox + kp.x, y, h.oz + kp.z, "kitchen");
        }
        replay(plans[key], (u * UW));
      }
    }
    // close the high end of every flat that has no built neighbour past it
    for (let s = 0; s < sides.length; s++) {
      const side = sides[s], key = side < 0 ? "-1" : "1";
      for (let u = 0; u < units - 1; u++) {
        if (!kept[key][u] || kept[key][u + 1]) continue;
        const b2 = runLo + (u + 1) * UW;
        if (side < 0) wallCross(b2, unitPlanner ? faceLo : crossLo, cLo);
        else wallCross(b2, cHi, unitPlanner ? faceHi : crossHi);
      }
    }
    if (!live) return { anchors: anchors, beds: beds, units: 0 };
    // the hall itself: one long strip light, which is the whole read from the
    // stairhead — a lit corridor with doors down it.
    ceilingStrip(h.b.lbox(cx(r), y + ceilOff(h, y), cz(r),
      alongX ? Math.min(runLen - 1.0, 14) : 0.3, 0.01,
      alongX ? 0.3 : Math.min(runLen - 1.0, 14), P.light,
      { emissive: P.light, ei: 0.26, cast: false }));
    RES_TALLY.floors++; RES_TALLY.units += live; RES_TALLY.beds += beds.length;
    return { anchors: anchors, beds: beds, units: live,
             fit: { units: fitUnits, corridor: { alongX: alongX, runLo: runFaceLo, runHi: runFaceHi, cLo: cLo, cHi: cHi } } };
  }
  const P_KIT = { body: 0x55606e, top: 0xc9ccd2 };   // existing kitchen buckets
  const RES_TALLY = { floors: 0, units: 0, beds: 0 };

  // ========================================================================
  //  (b) BREAKROOM — the ONE coherent kitchen in an office building.
  //
  //  OWNER: "ONE PACKED WITH DESKS LIKE WE HAVE, BUT RANDOM KITCHENS AND
  //  OFFICES."  A kitchen counter in the middle of a desk floor is nobody's
  //  plan; a break floor every fourth storey is how a real tower is stacked.
  //  So the kitchen does not disappear — it is CONFINED to a program that says
  //  what it is, and CBZ.interiorMix decides when a tower gets one.
  //
  //  It authors nothing either: roombuild.js's `breakroom` grammar is a counter
  //  on the far wall you queue at and one free-standing table you sit at, with
  //  the ring of chairs reserved. Degrade path is the kit's own two boxes.
  // ========================================================================
  function progBreakroom(r, h, opts) {
    shell(h, r);
    const A = approach(r, h, opts);
    const y = r.y;
    let planned = 0;
    if (CBZ.roomFurnish) {
      const dp = A.at(0, 0);
      let p = null;
      try {
        p = CBZ.roomFurnish({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, y: y }, "breakroom", {
          box: h.b.lbox, ox: h.ox, oz: h.oz, clear: h.b.clearFloorPoint || null,
          door: { x: dp.x, z: dp.z }, inset: 0.1,
          seed: (Math.round(h.ox) * 401) ^ (Math.round(h.oz) * 733),
          tone: (opts && opts.tone) || "cool",
        });
      } catch (e) { p = null; }
      planned = (p && p.executed) | 0;
    }
    if (!planned) {
      // degrade path — a counter run and a table, from this kit's own buckets
      const c = A.at(Math.max(1.8, A.depth - 1.6), 0);
      A.obox(c, 0.46, Math.min(A.span - 1.6, 3.0), 0.92, 0.7, P.desk, { pad: 0.6 });
      A.obox(c, 0.95, Math.min(A.span - 1.5, 3.1), 0.06, 0.8, P.worktop, { pad: 0.6 });
      const t = A.at(A.depth * 0.45, 0);
      A.obox(t, 0.38, 1.2, 0.08, 1.2, P.worktop, { pad: 0.7 });
      A.obox(t, 0.2, 0.9, 0.36, 0.9, P.desk, { pad: 0.7 });
    }
    // a vending machine in the corner: the detail that says "this is the floor
    // people come to", one lit face, two boxes.
    const vendingD = A.depth - 0.9;
    const vendingLat = A.lat(A.span / 2 - 1.2, 1.0);
    const v = A.at(vendingD, vendingLat);
    if (A.obox(v, 0.9, 0.9, 1.8, 0.7, P.steel, { pad: 0.5 }))
      A.obox(A.at(vendingD - 0.35 - SCREEN_GAP - 0.03, vendingLat),
        1.15, 0.62, 1.0, 0.06, P.glow, { emissive: P.glow, ei: 0.4, pad: 0.5 });
    return { anchors: [] };
  }

  // ========================================================================
  //  PER-FLOOR ROOM RECT — the resolver occupy.js and every future per-floor
  //  caller needs, and the one function this kit was missing. It reproduces
  //  buildings.js's own roomKit() usable band EXACTLY (facade thickness, the
  //  0.4m wall standoff, the -x stair strip when a shell has one) and lifts it
  //  onto floor k via the floorTops contract. One answer to "what is the room
  //  on floor 3", instead of four files each re-deriving it.
  //    CBZ.interiorFloorRoom(b, k) -> {x0,x1,z0,z1,y,floor,fh,w,d} | null
  //  Host-LOCAL rect, ready to hand straight to CBZ.interiorProgram.
  // ========================================================================
  CBZ.interiorFloorRoom = function (b, k) {
    if (!b || b.w == null || b.d == null) return null;
    const wt = b.wt != null ? b.wt : 0.4;
    const fh = b.FH != null ? b.FH : 3.2;
    const tops = Array.isArray(b.floorTops) && b.floorTops.length >= 2 ? b.floorTops : null;
    const nInterior = tops ? (tops.length - 1) : Math.max(1, b.storeys || 1);
    k = k | 0;
    if (k < 0 || k >= nInterior) return null;
    const x0 = b.hasStairs ? (-b.w / 2 + wt + (b.stairW || 0) + 0.4) : (-b.w / 2 + wt + 0.4);
    const x1 = b.w / 2 - wt - 0.4;
    const z0 = -b.d / 2 + wt + 0.4;
    const z1 = b.d / 2 - wt - 0.4;
    if (x1 - x0 < 1.4 || z1 - z0 < 1.4) return null;
    const y = tops ? tops[k] : (k <= 0 ? 0.14 : k * fh);
    // THE SHELL IS THE LAW, applied at the source: a rect handed out from here
    // is intersected with the building's own inside, so no program can be ASKED
    // to dress a band that leaves the facade. (For a plain rectangular shell the
    // band above is already 0.4 m inside it and this is a no-op — it is the
    // hosts with a stair strip, an odd wt or a hand-passed w/d that need it.)
    const room = CBZ.interiorClampRect(b, { x0: x0, x1: x1, z0: z0, z1: z1 });
    if (room.x1 - room.x0 < 1.4 || room.z1 - room.z0 < 1.4) return null;
    return { x0: room.x0, x1: room.x1, z0: room.z0, z1: room.z1,
             y: y, floor: k, fh: fh, w: room.x1 - room.x0, d: room.z1 - room.z0 };
  };
  CBZ.interiorFloorCount = function (b) {
    if (!b) return 0;
    const tops = Array.isArray(b.floorTops) && b.floorTops.length >= 2 ? b.floorTops : null;
    return tops ? (tops.length - 1) : Math.max(0, (b.storeys | 0));
  };

  /* ========================================================================
     INTERIOR_LOOT_V1 — THE INTERACTION VACUUM, CLOSED.

     OWNER: "interiors of buildings feel dumb and pointless right now."

     The diagnosis that matters is NOT furnishing — this file has had four
     furnishing passes and the rooms above are dense. The diagnosis is that
     until this block, every single piece of furniture drawn by every program
     in this kit had ZERO entries in the interaction registry. The whole
     indoor vocabulary of the game was: sit on a chair, sleep in a bed, read a
     wanted poster. You could not open a drawer, a locker, a crate or a safe
     anywhere inside any building in the city. A room you cannot touch is
     scenery no matter how well it is dressed, which is exactly the sentence
     the owner wrote.

     THE GRADIENT IS THE DESIGN (doctrine LAW 1, the gun-room grammar). A
     desk drawer is pocket change you can take in an empty afterhours office
     and nobody cares. The boss's floor safe is the crafted, GUARDED prize:
     it is quiet only if you have already killed the men in the room, and
     otherwise it costs you seven loud seconds that wake the building and file
     a burglary. Between those two ends sit the racks, the footlockers, the
     crates, the drinks cabinet and the weapons locker (the one container in
     the kit that can pay in a REAL gun, on a deliberately low hash gate).
     The reward ladder is the reason to climb the building.

     WITNESSES ARE THE OTHER HALF, and they are what makes the same desk two
     different verbs. Robbing it on an empty floor at night is free. Robbing
     it at noon with a clerk two desks away runs the EXACT decision the shop
     robbery already runs — CBZ.cityScare's freeze-or-bolt, cityPanicRaise's
     contagion field, and a heat charge through cityCrime. An armed staffer
     does not flinch: the building's own alarm (occupy.js's cityOccupyAlarm,
     the ped.guard + rage + state:"fight" trio) comes down on you instead.

     IT ADDS NO SYSTEM AND NO HUD. Money goes through CBZ.city.addCash and
     items through CBZ.cityEcon.add — the same two seams the street rummage
     and every shop use. Feedback is the existing city feed line (and the
     killfeed if it turns into a shooting). There is no toast, no meter, no
     objective. The safe's channel is a note at the start and a note at the
     end; the tension in between is the panic the noise is making.

     COST DISCIPLINE. A desk-farm floor is up to 96 stations and a tower has
     dozens of floors, so a citywide registry could be six figures of records
     and the 12 Hz interaction scan (interactions.js:539) must not walk it.
     Two bounds: registration is HASH-THINNED per kind (most desks are just
     desks), hard-capped at LOOT_CAP; and the query is a coordinate-bucketed
     grid, so `interiorLootAt` far from any interior costs four failed Map
     lookups and returns null. No record ever touches a mesh's userData —
     core/batch.js's merge is untouched, exactly like the seat registry.

     DETERMINISM. What is IN a container is a fact about the world: the class
     (dud / cash / item / gun) and the thinning are CBZ.hash01 of the world
     position, so the same city always has the same desks worth opening. The
     AMOUNT is a runtime roll (Math.random), which is the sanctioned split.
     ======================================================================== */
  // Off → nothing registers, every query returns null, and interact.js's zone
  // never surfaces a card. One-line revert of the whole layer.
  if (CFG.INTERIOR_LOOT_V1 == null) CFG.INTERIOR_LOOT_V1 = true;

  // WHAT EACH CONTAINER IS. `rate` is the deterministic share of drawn pieces
  // that are worth opening at all (a desk farm where all 96 drawers pay is a
  // faucet and a chore; one in three is a search). `dud`/`item` carve the class
  // band — everything above them is cash. `gun` is the weapons-locker-only
  // band and is deliberately tiny: a free rifle is the single most inflationary
  // thing this layer could hand out.
  const LOOT_KIND = {
    desk:       { rate: 0.18, tier: 0, dud: 0.42, item: 0.20, cash: [4, 44],    label: "Search",           empty: "Paperwork, dead pens, somebody's charger. Nothing." },
    reception:  { rate: 1.00, tier: 0, dud: 0.34, item: 0.26, cash: [10, 80],   label: "Go through", empty: "Visitor badges and a sign-in book. Nothing worth taking." },
    kitchen:    { rate: 0.45, tier: 0, dud: 0.40, item: 0.34, cash: [3, 26],    label: "Search",empty: "Cutlery, takeaway menus, a dead kettle." },
    rack:       { rate: 0.22, tier: 1, dud: 0.38, item: 0.30, cash: [10, 74],   label: "Search",        empty: "Archive boxes. Somebody's tax returns from nine years ago." },
    crate:      { rate: 0.55, tier: 1, dud: 0.30, item: 0.36, cash: [15, 92],   label: "Pry open",        empty: "Packing foam and an empty inventory sheet." },
    footlocker: { rate: 0.60, tier: 1, dud: 0.32, item: 0.36, cash: [12, 84],   label: "Open",       empty: "Spare boots, a bar of soap, a letter he never sent." },
    weapons:    { rate: 1.00, tier: 2, dud: 0.24, item: 0.44, cash: [20, 120],  gun: 0.10, label: "Force", empty: "Empty racks. Whatever was in here walked out already." },
    cabinet:    { rate: 1.00, tier: 3, dud: 0.16, item: 0.46, cash: [140, 620], label: "Open", empty: "Good bottles, all of them empty. He drinks alone." },
    safe:       { rate: 1.00, tier: 4, dud: 0.00, item: 0.34, cash: [0, 0],     label: "Crack",      empty: "Deeds, a passport in another name — and no cash. He moved it." },
    // THE FIT-OUT'S CONTAINERS (city/fitout*.js). Registered lazily when the
    // building is fitted out; the coordinate dedupe makes a rebuild a no-op.
    mattress:   { rate: 0.30, tier: 1, dud: 0.35, item: 0.25, cash: [40, 260],  label: "Lift",         empty: "Lint, a sock, a dead phone charger." },
    closet:     { rate: 0.40, tier: 1, dud: 0.40, item: 0.40, cash: [10, 90],   label: "Go through",     empty: "Coats that smell of somebody else." },
    medicine:   { rate: 0.55, tier: 0, dud: 0.45, item: 0.45, cash: [0, 12],    label: "Open",   empty: "Floss and an empty pill bottle." },
    register:   { rate: 1.00, tier: 2, dud: 0.05, item: 0.05, cash: [60, 340],  label: "Empty",        empty: "The drawer's already been cleared." },
    stockroom:  { rate: 0.60, tier: 1, dud: 0.30, item: 0.55, cash: [5, 40],    label: "Go through",      empty: "Flattened boxes and a price gun." },
    countroom:  { rate: 1.00, tier: 3, dud: 0.00, item: 0.18, cash: [900, 3400], label: "Take",           empty: "Rubber bands. They already moved it." },
    lab:        { rate: 1.00, tier: 2, dud: 0.10, item: 0.80, cash: [0, 60],    label: "Bag",           empty: "Residue and a cracked flask." },
  };
  // WHAT COMES OUT, by container. Every name is checked against the live econ
  // catalog before it is offered, so a catalog edit can only ever shrink these.
  const LOOT_ITEMS = {
    desk:       ["Wallet", "Phone", "Burner Phone", "Laptop"],
    reception:  ["Wallet", "Phone", "Laptop", "Cash Stack"],
    kitchen:    ["Hotdog", "Soda", "Coffee", "Wallet"],
    rack:       ["Crowbar", "Lockpick", "Flashlight", "Laptop", "Ammo Box"],
    crate:      ["Ammo Box", "Crowbar", "Body Armor"],
    footlocker: ["Wallet", "Ammo Box", "Knife", "Body Armor"],
    weapons:    ["Ammo Box", "Body Armor", "Knife"],
    cabinet:    ["Rolex", "Diamond Ring", "Cash Stack", "Gold Bar"],
    safe:       ["Gold Bar", "Cash Stack", "Iced Watch", "Briefcase of Cash"],
    mattress:   ["Cash Stack", "Pistol", "Wallet", "Rolex"],
    closet:     ["Body Armor", "Knife", "Wallet", "Sunglasses"],
    medicine:   ["Painkillers", "Medkit", "Bandage"],
    register:   ["Cash Stack"],
    stockroom:  ["Soda", "Hotdog", "Crowbar", "Flashlight", "Phone"],
    countroom:  ["Cash Stack", "Briefcase of Cash"],
    lab:        ["Meth", "Coke", "Weed"],
  };
  const LOOT_GUNS = ["Pistol", "Shotgun", "SMG"];
  // the heat a container costs you WHEN SOMEBODY SEES IT (the safe pays it
  // regardless — a drill is loud whether or not anyone is looking).
  const LOOT_CRIME = [
    { sev: 40,  type: "theft" },        // tier 0 — a drawer
    { sev: 70,  type: "theft" },        // tier 1 — a rack, a locker
    { sev: 130, type: "burglary" },     // tier 2 — the weapons locker
    { sev: 110, type: "burglary" },     // tier 3 — the drinks cabinet
    { sev: 260, type: "burglary" },     // tier 4 — the safe
  ];

  const LOOT = [];                       // every registered container, flat
  const LOOT_CELL = 9;                   // metres per spatial bucket (> REACH 5.2)
  const LOOT_BUCKETS = new Map();        // "gx,gz" -> [rec, ...]
  const LOOT_KEYS = new Set();           // coordinate dedupe (a re-run furnisher)
  const LOOT_CAP = 6000;                 // citywide ceiling on records
  /* …AND A RESERVATION, which is the part a flat cap gets wrong. Registration
     order is world-build order: buildings.js furnishes every office tower long
     before occupy.js dresses a gang HQ's boss suite. With one first-come cap,
     a big city's desk drawers would spend the whole budget and the floor safes
     — the top of the ladder and the entire point of the layer — would silently
     fail to register. So the tier-0 pocket-change kinds get a SUB-cap and the
     rest of the budget belongs to the containers that are worth climbing for. */
  const LOOT_CAP_LOW = 3800;
  let LOOT_LOW = 0;
  const LOOT_TALLY = { looted: 0, witnessed: 0, safes: 0, guns: 0, cash: 0, cracks: 0, refusedCap: 0, refusedLow: 0 };
  const CRACK_T = 7.0;                   // seconds of loud work on a guarded safe
  // Walk this far off the safe and you have abandoned it. Deliberately a shade
  // WIDER than the interaction reach (interactions.js REACH is 5.2) — the verb
  // can legitimately be pressed from the far edge of reach, and a leash tighter
  // than that would cancel the hold on the very frame it started.
  const CRACK_LEASH = 6.0;
  const WITNESS_R = 15;                  // how far a staffer can be and still see you

  function lootCellKey(x, z) { return Math.floor(x / LOOT_CELL) + "," + Math.floor(z / LOOT_CELL); }
  // REGISTER one container. World coords in; null out when the flag is off, the
  // cap is spent, the coordinate is already claimed, or the deterministic
  // thinning says this particular piece is just furniture.
  function lootReg(x, y, z, kind, opts) {
    if (CFG.INTERIOR_LOOT_V1 === false) return null;
    const K = LOOT_KIND[kind];
    if (!K || x == null || z == null) return null;
    if (LOOT.length >= LOOT_CAP) { LOOT_TALLY.refusedCap++; return null; }
    if (K.tier === 0 && LOOT_LOW >= LOOT_CAP_LOW) { LOOT_TALLY.refusedLow++; return null; }
    const h1 = CBZ.hash01 ? CBZ.hash01(x, z, 0x10C1) : 0.5;
    if (h1 >= K.rate) return null;
    const key = Math.round(x * 10) + "," + Math.round((y || 0) * 10) + "," + Math.round(z * 10);
    if (LOOT_KEYS.has(key)) return null;
    LOOT_KEYS.add(key);
    // THE CLASS IS A WORLD FACT (hash, not a roll): which drawer has the laptop
    // in it is the same in every session of the same city.
    const h2 = CBZ.hash01 ? CBZ.hash01(x + 0.5, z - 0.5, 0x10C2) : 0.5;
    let klass = "cash";
    if (K.gun && h2 < K.gun) klass = "gun";
    else if (h2 < K.dud) klass = "dud";
    else if (h2 < K.dud + K.item) klass = "item";
    const rec = {
      x: x, y: y || 0, z: z, kind: kind, tier: K.tier, klass: klass,
      wealth: (opts && opts.wealth) || 1,
      taken: 0, lot: null, _lotR: false,
    };
    LOOT.push(rec);
    if (K.tier === 0) LOOT_LOW++;
    const ck = lootCellKey(x, z);
    const cell = LOOT_BUCKETS.get(ck);
    if (cell) cell.push(rec); else LOOT_BUCKETS.set(ck, [rec]);
    if (kind === "safe") LOOT_TALLY.safes++;
    return rec;
  }
  // THE ONE REGISTRY, exported: the fit-out (city/fitout*.js) files its
  // containers here so a flat's mattress and a boss's safe are one ladder.
  // opts.lot ties a container to a lot (a gang count room provokes its gang).
  CBZ.interiorLootRegister = function (x, y, z, kind, opts) {
    const rec = lootReg(x, y, z, kind, opts);
    if (rec && opts && opts.lot) { rec.lot = opts.lot; rec._lotR = true; }
    return rec;
  };
  // the approach-frame form every door-relative program wants: same arguments
  // as anchorAt's placement pair, so a program never converts coordinates.
  function lootAtA(A, inD, lat, kind, opts) {
    const p = A.at(inD, lat);
    return lootReg(A.h.ox + p.x, A.y, A.h.oz + p.z, kind, opts);
  }
  // a boss suite's wealth tier, read off the thing that already encodes it: how
  // tall the tower he owns the top of is. No new field, no new roll.
  function suiteWealth(h) {
    const st = Math.max(1, (h.b.storeys | 0) || 1);
    return Math.max(1, Math.min(5, 1 + Math.floor(st / 8)));
  }

  // lazily resolve the lot a record sits in — a demolished building stops
  // offering its drawers. Exactly propuse.js's lotOf idiom (one scan per
  // record, cached, retried while the city is still coming up).
  function lootLots() {
    const c = CBZ.city;
    if (!c) return null;
    if (c.arena && c.arena.lots) return c.arena.lots;
    return c.lots || null;
  }
  function lootLotOf(rec) {
    if (rec.lot !== null || rec._lotR) return rec.lot;
    const lots = lootLots();
    if (!lots) return null;
    rec._lotR = true;
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      const hw = l.w / 2 + 0.5, hd = (l.d != null ? l.d : l.w) / 2 + 0.5;
      if (Math.abs(rec.x - l.cx) <= hw && Math.abs(rec.z - l.cz) <= hd) { rec.lot = l; break; }
    }
    return rec.lot;
  }
  function lootFloorK(rec) { return Math.max(0, Math.round((rec.y || 0) / 3.2)); }

  /* THE QUERY the interaction registry calls at 12 Hz, from anywhere in the
     city. Bucketed: at most a 2x2 neighbourhood of cells is touched, and a
     player who is nowhere near an interior pays four failed Map lookups. */
  CBZ.interiorLootAt = function (px, pz, reach, py) {
    if (CFG.INTERIOR_LOOT_V1 === false || !LOOT.length) return null;
    const r = reach || 3.8, r2 = r * r;
    const gx0 = Math.floor((px - r) / LOOT_CELL), gx1 = Math.floor((px + r) / LOOT_CELL);
    const gz0 = Math.floor((pz - r) / LOOT_CELL), gz1 = Math.floor((pz + r) / LOOT_CELL);
    let best = null, bd = r2;
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const cell = LOOT_BUCKETS.get(gx + "," + gz);
      if (!cell) continue;
      for (let i = 0; i < cell.length; i++) {
        const rec = cell[i];
        if (rec.taken) continue;
        // WRONG FLOOR is the whole reason this needs y: a tower stacks a desk
        // every 3.2 m and the plan distance to the one above you is zero.
        if (py != null && Math.abs(rec.y - py) > 2.0) continue;
        const dx = rec.x - px, dz = rec.z - pz, d = dx * dx + dz * dz;
        if (d >= bd) continue;
        const l = lootLotOf(rec);
        if (l && l.demolished) continue;
        bd = d; best = rec;
      }
    }
    return best;
  };
  CBZ.interiorLootLabel = function (rec) {
    const K = rec && LOOT_KIND[rec.kind];
    return K ? K.label : "Search";
  };

  /* ---- WITNESSES -------------------------------------------------------
     Who counts: a body that BELONGS in this room — a vendor behind a counter,
     a citystaff post, an occupy.js guard, a seated worker. A pedestrian who
     wandered in is not a witness to a drawer. The decision itself is not ours:
     an unarmed staffer goes through cityScare (freeze or bolt, the identical
     call interiorRobbery makes on the clerk), and anyone armed brings the
     building's own alarm down instead of flinching. */
  function lootWitness(rec) {
    const list = CBZ.cityPeds;
    if (!list) return null;
    let best = null, bd = WITNESS_R * WITNESS_R;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || p.dead || p.isPlayer || p.controlled || !p.pos) continue;
      if (Math.abs(p.pos.y - rec.y) > 2.6) continue;              // through a slab is not seeing
      const belongs = !!(p.vendor || p.staffPost || p._occupyPost || p._occupyFloor != null
        || p.guard || p._npcAttached || p._deskAnchor);
      if (!belongs) continue;
      const dx = p.pos.x - rec.x, dz = p.pos.z - rec.z, d = dx * dx + dz * dz;
      if (d >= bd) continue;
      bd = d; best = p;
    }
    return best;
  }
  // fire the consequence for opening `rec`. `loud` forces the heat charge even
  // with nobody watching (a drill on a safe is heard through a floor).
  function lootConsequence(rec, loud) {
    const P = CBZ.player;
    const w = lootWitness(rec);
    const C = LOOT_CRIME[Math.max(0, Math.min(LOOT_CRIME.length - 1, rec.tier))];
    if (!w && !loud) return null;
    if (w) {
      LOOT_TALLY.witnessed++;
      const armed = !!(w.armed || w.kind === "cop" || w.kind === "security" || w.rage);
      const lot = lootLotOf(rec);
      if (armed && lot && lot._occupancy && CBZ.cityOccupyAlarm) {
        // the building learns you are in it — occupy.js's own alarm front,
        // not a second copy of the guard fields.
        try { CBZ.cityOccupyAlarm(lot, P, lootFloorK(rec)); } catch (e) {}
      } else if (armed) {
        // the same field trio occupy.js's wake() writes, for a posted body no
        // occupancy record owns (a shop's security, a declared interior job).
        if (w.staffPost) { w._occupyPost = w._occupyPost || { x: w.staffPost.x, z: w.staffPost.z }; w.staffPost = null; }
        if (w._occupyPost) { w.guard = { x: w._occupyPost.x, z: w._occupyPost.z }; w.homeGuard = w.guard; }
        w.mem = P; w.alarmed = Math.max(w.alarmed || 0, 4);
        w.rage = P; w.state = "fight";
      } else if (CBZ.cityScare) {
        try { CBZ.cityScare(w, P, { bias: 0.2 }); } catch (e) {}
      }
    }
    if (CBZ.cityPanicRaise) CBZ.cityPanicRaise(rec.x, rec.z, loud ? 1.4 : 0.8);
    if (CBZ.cityCrime) {
      try { CBZ.cityCrime(C.sev, { x: rec.x, z: rec.z, type: C.type }); } catch (e) {}
    }
    return w;
  }

  /* ---- PAYOUT — through the seams that already exist ------------------- */
  function lootEcon() { return CBZ.cityEcon || null; }
  function lootHasItem(n) { const e = lootEcon(); return !!(e && e.ITEMS && e.ITEMS[n]); }
  function lootPickItem(kind) {
    const pool = LOOT_ITEMS[kind] || [];
    const live = [];
    for (let i = 0; i < pool.length; i++) if (lootHasItem(pool[i])) live.push(pool[i]);
    if (!live.length) return null;
    return live[(Math.random() * live.length) | 0];
  }
  function lootNote(s, t) { if (CBZ.city && CBZ.city.note) CBZ.city.note(s, t || 1.9); }
  function lootCash(n) {
    if (n <= 0) return;
    LOOT_TALLY.cash += n;
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(n);
    if (CBZ.sfx) CBZ.sfx("coin");
  }
  // The SAFE is the one payout that scales — off the wealth tier stamped at
  // build time, which is the height of the tower the suite sits on top of.
  function safeCash(rec) {
    const t = Math.max(1, rec.wealth | 0);
    return 1600 + t * 2100 + ((Math.random() * (900 * t)) | 0);
  }
  function lootPay(rec) {
    const K = LOOT_KIND[rec.kind];
    rec.taken = 1;
    LOOT_TALLY.looted++;
    // A GANG'S MONEY IS THE GANG'S. The count table in a hideout IS the stash
    // gangs.js keeps on the lot: taking it empties that stash (so the crew
    // raid and the turf repaint agree), pays what the stash held, and the
    // gang finds out the way gangs.js's own stash robbery tells it.
    // gangs.js cityRobStash is the one robbery: the stash empties, the gang
    // is provoked, the block hears it, the cops get the tip. The table only
    // adds its loose count on top of what the stash held.
    if (rec.kind === "countroom" || rec.kind === "lab") {
      const lot = lootLotOf(rec);
      const st = lot && lot.building && lot.building.stash;
      if (st && !st.looted && rec.kind === "countroom" && CBZ.cityRobStash) {
        const extra = K.cash[0] + ((Math.random() * (K.cash[1] - K.cash[0])) | 0);
        const got = CBZ.cityRobStash(lot, { extra: extra, note: function (n) { return "$" + n + " off the count table, rubber bands and all."; } });
        LOOT_TALLY.cash += got | 0;
        return true;
      }
      if (st && st.gang && CBZ.cityGangProvoke) { try { CBZ.cityGangProvoke(st.gang, 1); } catch (e) {} }
      if (st && st.looted && rec.kind === "countroom") { lootNote(K.empty, 1.8); return true; }
    }
    if (rec.kind === "safe") {
      if (rec.klass === "item") {
        const n = lootPickItem("safe");
        if (n && CBZ.cityEcon && CBZ.cityEcon.add) {
          CBZ.cityEcon.add(n, 1);
          const half = Math.round(safeCash(rec) * 0.4);
          lootCash(half);
          if (CBZ.city && CBZ.city.big) CBZ.city.big("THE SAFE · " + n + " + $" + half);
          if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(5);
          return true;
        }
      }
      const cash = safeCash(rec);
      lootCash(cash);
      if (CBZ.city && CBZ.city.big) CBZ.city.big("THE SAFE. $" + cash);
      if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(4);
      return true;
    }
    if (rec.klass === "gun") {
      const live = [];
      for (let i = 0; i < LOOT_GUNS.length; i++) if (lootHasItem(LOOT_GUNS[i])) live.push(LOOT_GUNS[i]);
      const n = live.length ? live[(Math.random() * live.length) | 0] : null;
      if (n) {
        LOOT_TALLY.guns++;
        // the EXACT seam careers.js's Senior Guard sidearm uses — inventory
        // row plus the real equipped weapon, never a stat fiction.
        if (CBZ.cityEcon && CBZ.cityEcon.add) CBZ.cityEcon.add(n, 1);
        if (CBZ.cityGiveWeapon) { try { CBZ.cityGiveWeapon(n); } catch (e) {} }
        if (CBZ.cityAddAmmo) { try { CBZ.cityAddAmmo(30); } catch (e) {} }
        lootNote("Rack held one " + n + ". It's yours.", 2.2);
        return true;
      }
    }
    if (rec.klass === "item") {
      const n = lootPickItem(rec.kind);
      if (n && CBZ.cityEcon && CBZ.cityEcon.add) {
        CBZ.cityEcon.add(n, 1);
        if (CBZ.sfx) CBZ.sfx("coin");
        lootNote("Took a " + n + ".", 1.9);
        return true;
      }
    }
    if (rec.klass === "dud") { lootNote(K.empty, 1.7); return true; }
    const lo = K.cash[0], hi = K.cash[1];
    const cash = lo + ((Math.random() * Math.max(1, hi - lo)) | 0);
    if (cash <= 0) { lootNote(K.empty, 1.7); return true; }
    lootCash(cash);
    lootNote("Found $" + cash + ".", 1.8);
    return true;
  }

  /* ---- THE SAFE'S SEVEN SECONDS ----------------------------------------
     The gradient's top rung. If the men in the room are dead the safe opens
     quietly — you already paid for it. If they are not, it is a HOLD: seven
     seconds of noise that raise panic the whole time and file the burglary the
     moment you start, so the room has time to come for you before it pays.
     One channel citywide; walking away abandons it (and the heat is already
     spent, which is the point). No HUD: the feed line at the start and the
     panic wave are the feedback. */
  const CRACK = { rec: null, t: 0, pulse: 0 };
  CBZ.interiorLootBusy = function () { return !!CRACK.rec; };
  function suiteGuarded(rec) {
    const list = CBZ.cityPeds;
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || p.dead || p.isPlayer || p.controlled || !p.pos) continue;
      if (Math.abs(p.pos.y - rec.y) > 2.6) continue;
      if (!(p.guard || p.staffPost || p._occupyPost || p._occupyFloor != null)) continue;
      const dx = p.pos.x - rec.x, dz = p.pos.z - rec.z;
      if (dx * dx + dz * dz < 20 * 20) return true;
    }
    return false;
  }
  function crackAbort(msg) {
    CRACK.rec = null; CRACK.t = 0; CRACK.pulse = 0;
    if (msg) lootNote(msg, 1.7);
  }
  function crackTick(dt) {
    const rec = CRACK.rec;
    if (!rec) return;
    const P = CBZ.player;
    // dying on the drill needs no feed line — the death screen is the message.
    if (!P || !P.pos || P.dead || rec.taken) { crackAbort(null); return; }
    const dx = P.pos.x - rec.x, dz = P.pos.z - rec.z;
    if (dx * dx + dz * dz > CRACK_LEASH * CRACK_LEASH) { crackAbort("You walked off the safe. It's still shut."); return; }
    CRACK.t += dt;
    CRACK.pulse += dt;
    if (CRACK.pulse >= 2.0) {
      // the noise keeps travelling — and anyone who walks in ON it makes the
      // same decision the clerk made. The HEAT is not re-charged: one burglary
      // was filed when the drill went on, and a crime you are still committing
      // is not a second crime.
      CRACK.pulse = 0;
      if (CBZ.cityPanicRaise) CBZ.cityPanicRaise(rec.x, rec.z, 0.7);
      const w = lootWitness(rec);
      if (w && !w.rage && CBZ.cityScare) { try { CBZ.cityScare(w, CBZ.player, { bias: 0.25 }); } catch (e) {} }
    }
    if (CRACK.t < CRACK_T) return;
    CRACK.rec = null; CRACK.t = 0; CRACK.pulse = 0;
    LOOT_TALLY.cracks++;
    lootPay(rec);
  }

  /* THE VERB. One entry point for every container; the caller (interact.js's
     zone) types no policy. Returns true when something actually happened. */
  CBZ.interiorLootTake = function (rec) {
    if (CFG.INTERIOR_LOOT_V1 === false || !rec) return false;
    if (rec.taken) { lootNote("Already cleaned out.", 1.4); return false; }
    if (CRACK.rec) return false;                     // one channel at a time
    if (rec.kind === "safe" && suiteGuarded(rec)) {
      // LOUD. The heat is spent up front — you cannot start this, hear the
      // room wake up, and walk away clean.
      CRACK.rec = rec; CRACK.t = 0; CRACK.pulse = 0;
      lootConsequence(rec, true);
      lootNote("You put the drill on the safe. This is going to be loud.", 2.4);
      return true;
    }
    lootConsequence(rec, false);
    return lootPay(rec);
  };

  /* THE RATCHET — export only. The orchestrator measures; nothing in this file
     calls it. `anchors` is every registered container, `lootable` the ones
     still shut, `witnessed` how many searches a body actually saw. */
  CBZ.interiorLootAudit = function () {
    let lootable = 0, safes = 0;
    const byKind = {}, byClass = {};
    for (let i = 0; i < LOOT.length; i++) {
      const rec = LOOT[i];
      byKind[rec.kind] = (byKind[rec.kind] | 0) + 1;
      byClass[rec.klass] = (byClass[rec.klass] | 0) + 1;
      if (!rec.taken) lootable++;
      if (rec.kind === "safe") safes++;
    }
    return {
      anchors: LOOT.length,
      lootable: lootable,
      looted: LOOT_TALLY.looted,
      witnessed: LOOT_TALLY.witnessed,
      safes: safes,
      byKind: byKind,
      byClass: byClass,
      cells: LOOT_BUCKETS.size,
      guns: LOOT_TALLY.guns,
      cashPaid: LOOT_TALLY.cash,
      cracks: LOOT_TALLY.cracks,
      lowUsed: LOOT_LOW,                       // tier-0 slots spent of LOOT_CAP_LOW
      refusedCap: LOOT_TALLY.refusedCap,       // hit the citywide ceiling
      refusedLow: LOOT_TALLY.refusedLow,       // hit the pocket-change sub-cap
      cracking: CRACK.rec ? 1 : 0,
    };
  };
  function lootReset() {
    LOOT.length = 0;
    LOOT_BUCKETS.clear();
    LOOT_KEYS.clear();
    LOOT_LOW = 0;
    LOOT_TALLY.looted = LOOT_TALLY.witnessed = LOOT_TALLY.safes = 0;
    LOOT_TALLY.guns = LOOT_TALLY.cash = LOOT_TALLY.cracks = 0;
    LOOT_TALLY.refusedCap = LOOT_TALLY.refusedLow = 0;
    CRACK.rec = null; CRACK.t = 0; CRACK.pulse = 0;
  }
  // its own tick, at its own order key, gated on its own flag — so the safe
  // channel survives INTERIOR_LIFE_V1 being turned off and vice versa.
  if (CBZ.onUpdate) CBZ.onUpdate(41.88, function (dt) {
    if (CFG.INTERIOR_LOOT_V1 === false) return;
    if (!CRACK.rec) return;
    if (!CBZ.game || CBZ.game.mode !== "city") { crackAbort(null); return; }
    crackTick(dt || 0);
  });

  // ========================================================================
  //  PRESIDENTIAL ROOMS — the Executive Mansion and its West Wing, built as a
  //  head-of-state building at real scale.
  //
  //  OWNER (on the iPad, in President mode): "the interior of the president
  //  game building: your feet go underground ... that building is so low
  //  quality for the president game ... and the interaction options." Then:
  //  "all the buildings in the presidential mode just need to be redone."
  //
  //  What that was, in this file:
  //   · FEET UNDERGROUND. Every rug, marble band and command carpet was
  //     authored 17-21 cm over the floor, as if the room stood on grade, and
  //     every plinth stood on that imagined covering. The walk surface is the
  //     slab top (b.floorTops[k]); a body standing on it was inside the drawn
  //     floor. THE FLOOR LAW here: a finish tops out within 2 cm of the floor
  //     top (fields at +0.014, rugs at +0.020), and every piece stands on the
  //     floor top. A raised thing (the press dais) registers its own walk
  //     platform, so what you see is what you stand on.
  //   · ONE PLATE PER STOREY. Each floor was a 54 m plate with a carpet down
  //     the middle and a few pieces on it. Each floor is a PLAN now: rooms
  //     with walls, doors that open (the unit-door registry, E), skirting,
  //     chair rail, cornice, ceilings with coffers, the facade's own windows
  //     cased and curtained from inside, and furniture from CBZ.furnish.
  //
  //  THE FRAME. A plan is written in (d, l): d is metres from the inner face
  //  of the building's DOOR wall toward the back, l metres across it from the
  //  centre line (+l is the right hand of a visitor walking in). The Mansion
  //  (door on +z) and the West Wing (door on +x) run the same code; nothing
  //  here knows which way either building faces.
  //
  //  WHAT THIS FILE DOES NOT OWN: the stairs (govcomplex.js §1d, stairs.js),
  //  the shell and its floor covering (shell() above, the lead's), the
  //  Situation Room (presidency.js builds it inside the plate this plan leaves
  //  for it), and any political state. The rooms publish landmarks
  //  (CBZ.presidentInteriorRooms) that president_office.js, president_staff.js
  //  and protection.js hang their people and objects on.
  // ========================================================================
  const PRESIDENTIAL = { rooms: [], props: [], press: [], usable: 0, symbols: 0, emptyDecor: 0 };
  // every room a state plan drew (world rect, floor), for the door census
  // (tools/estate-door-census.mjs walks to each one)
  const STATE_ROOMS = [];
  CBZ.stateRoomsAll = function () { return STATE_ROOMS.slice(); };

  function presidentialReset() {
    PRESIDENTIAL.rooms.length = 0;
    PRESIDENTIAL.props.length = 0;
    PRESIDENTIAL.press.length = 0;
    PRESIDENTIAL.pressJobs = null; PRESIDENTIAL.pressPosted = undefined;   // a rebuilt house re-posts its pool
    PRESIDENTIAL.usable = 0;
    PRESIDENTIAL.symbols = 0;
    PRESIDENTIAL.emptyDecor = 0;
  }
  // every chair, sofa, bed and table is the shared kit's, so each exposes the
  // same sit / lie grammar as an apartment. Big pieces are SOLID here: a
  // cabinet table you walk through is a picture of a table.
  function presidentialPiece(name, r, h, x, z, yaw, opts) {
    const F = CBZ.furnish;
    const fn = F && F[name];
    if (typeof fn !== "function") return null;
    const o = Object.assign({ solid: true }, opts || {}, {
      box: h.b.lbox, ox: h.ox, oz: h.oz, oy: 0, lot: null,
    });
    const y = (opts && opts.atY != null) ? opts.atY : r.y;
    if (doorBlocked(h, r.y, x, z, 0.5)) return null;
    try {
      return name === "lamp" ? fn(x, y, z, o) : fn(x, y, z, yaw || 0, o);
    } catch (e) { return null; }
  }
  function presidentialUse(rec) {
    if (!rec) return 0;
    return ((rec.seats && rec.seats.length) | 0) + ((rec.beds && rec.beds.length) | 0);
  }
  function presidentialRoom(key, name, h, r, usable, symbols, A, landmarks) {
    const rec = {
      key: key, name: name, floorY: r.y,
      x: h.ox + cx(r), z: h.oz + cz(r),
      w: r.x1 - r.x0, d: r.z1 - r.z0,
      usable: usable | 0, symbols: symbols | 0,
    };
    // the room's own frame: where you come in, which way is "in", how deep and
    // how wide. president_office.js and president_staff.js build in it.
    if (A) {
      rec.approach = {
        x: h.ox + A.x, z: h.oz + A.z,
        nx: A.nx, nz: A.nz, tx: A.tx, tz: A.tz,
        depth: A.depth, span: A.span,
      };
    }
    rec.landmarks = {};
    Object.keys(landmarks || {}).forEach(function (landmark) {
      const p = landmarks[landmark];
      if (!p) return;
      rec.landmarks[landmark] = {
        x: h.ox + p.x, y: r.y + (p.y || 0), z: h.oz + p.z,
      };
    });
    PRESIDENTIAL.rooms.push(rec);
    PRESIDENTIAL.usable += usable | 0;
    PRESIDENTIAL.symbols += symbols | 0;
    return rec;
  }
  function presidentialProp(key, label, order, h, r, p) {
    const rec = { key: key, label: label, order: order, x: h.ox + p.x, y: r.y, z: h.oz + p.z };
    PRESIDENTIAL.props.push(rec);
    return rec;
  }

  // the slab is 0.20 thick: a storey's ceiling plane is the NEXT floor's top
  // minus this, never h.fh (the old fixtures hung inside the slab)
  const CEIL = 0.20;

  // ---- THE STATE PALETTE ---------------------------------------------------
  // Few hexes on purpose: core/batch.js merges per colour, so a palette is a
  // draw-call budget. Existing kit buckets where one reads right.
  const SP = {
    ivory: 0xe9e4da,      // painted plaster (fitout.js's plaster tint)
    ivoryD: 0xd6cdbb,     // the shadow side of a moulding
    cream: 0xf1ece0,      // cornice, casing, ceiling medallion
    walnut: P.wood,       // doors, panelling, bookcases
    mahog: 0x5a2e22,      // the Resolute desk, the cabinet table
    oak: 0x8a6440,        // parquet
    marble: P.marble,     // the state floor
    marbleD: 0x8f8a80,    // border stone
    black: 0x23262b,      // iron, firebox, the piano
    gold: P.gold,
    navy: 0x22324f, blue: 0x2f4f86, red: 0x8f3434, green: 0x3f5a46,
    rugRed: P.rug, rugBlue: 0x2a3f66, rugGold: 0x9a7b3f, rugGreen: 0x3c5a45, rugCream: 0xcfc3a6,
    tile: 0xe6e8e4, steel: P.steel, glow: P.glow, lamp: P.lamp,
    sky: 0xcfe2ee,        // a window lit from outside
    leather: 0x3b2b27,
  };
  const ST_T = 0.20;          // a state partition's thickness
  const FIELD_B = 0.008, FIELD_T = 0.014;   // a floor field: on the covering, 1.4 cm over the slab
  const RUG_T = 0.020;                      // a rug's top: THE FLOOR LAW's ceiling

  /* ========================================================================
     THE STATE FRAME. Everything below draws through F.box(d, l, y0, y1, dd,
     ll, colour, opts): an axis-aligned box centred on (d, l), dd deep along
     d, ll wide along l, from y0 to y1 over the floor top. F.P(d, l) is the
     building-local point, F.face(dd, ll) the yaw that looks along (dd, ll)
     (furniture's own convention), F.latD / F.latL the yaw that lays a piece's
     long side along d / along l.
     ======================================================================== */
  function stateFrame(h, r) {
    const b = h.b;
    const dn = (b.localDoor && b.localDoor.nx != null) ? b.localDoor : { x: cx(r), z: r.z1, nx: 0, nz: -1 };
    const S = CBZ.interiorShellRect(b) || { x0: r.x0 - 0.4, x1: r.x1 + 0.4, z0: r.z0 - 0.4, z1: r.z1 + 0.4 };
    const along = Math.abs(dn.nx) > 0.5;
    const nx = along ? (dn.nx > 0 ? 1 : -1) : 0, nz = along ? 0 : (dn.nz > 0 ? 1 : -1);
    const tx = -nz, tz = nx;
    const ox0 = along ? (nx > 0 ? S.x0 : S.x1) : (S.x0 + S.x1) / 2;
    const oz0 = along ? (S.z0 + S.z1) / 2 : (nz > 0 ? S.z0 : S.z1);
    const D = along ? S.x1 - S.x0 : S.z1 - S.z0;
    const W = along ? S.z1 - S.z0 : S.x1 - S.x0;
    const Y = r.y;
    const tops = Array.isArray(b.floorTops) ? b.floorTops : null;
    let k = 0;
    if (tops) { let bd = 1e9; for (let i = 0; i < tops.length; i++) { const q = Math.abs(tops[i] - Y); if (q < bd) { bd = q; k = i; } } }
    const next = (tops && tops[k + 1] != null) ? tops[k + 1] : Y + h.fh;
    const CL = Math.max(2.6, next - CEIL - Y);
    function P2(d, l) { return { x: ox0 + nx * d + tx * l, z: oz0 + nz * d + tz * l }; }
    function toF(x, z) { const dx = x - ox0, dz = z - oz0; return { d: dx * nx + dz * nz, l: dx * tx + dz * tz }; }
    function rectL(d0, d1, l0, l1) {
      const a = P2(d0, l0), c = P2(d1, l1);
      return { x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), z0: Math.min(a.z, c.z), z1: Math.max(a.z, c.z) };
    }
    function box(d, l, y0, y1, dd, ll, col, o) {
      if (!(y1 > y0) || !(dd > 0.004) || !(ll > 0.004)) return null;
      const p = P2(d, l);
      return h.b.lbox(p.x, Y + (y0 + y1) / 2, p.z, along ? dd : ll, y1 - y0, along ? ll : dd, col, o || NOCAST);
    }
    const F = {
      h: h, b: b, r: r, S: S, along: along, nx: nx, nz: nz, tx: tx, tz: tz,
      D: D, W: W, half: W / 2, Y: Y, k: k, CL: CL,
      P: P2, toF: toF, rect: rectL, box: box,
      face: function (dd, ll) { return Math.atan2(nx * dd + tx * ll, nz * dd + tz * ll); },
      latD: Math.atan2(-nz, nx), latL: Math.atan2(-tz, tx),
      walls: [], rooms: [], fitRooms: [], fitLights: [], wins: null, doors: [],
      lights: 0, symbols: 0,
    };
    F.wins = stateWindows(F);
    // the stair core / lift chase / grand stair, in the frame (nothing is
    // drawn or furnished inside one; the lead's lbox clips a hole's band too)
    F.holes = [];
    const sr = b.shaftRects || [];
    for (let i = 0; i < sr.length; i++) {
      const a = toF(sr[i].x0, sr[i].z0), c = toF(sr[i].x1, sr[i].z1);
      F.holes.push({ d0: Math.min(a.d, c.d), d1: Math.max(a.d, c.d), l0: Math.min(a.l, c.l), l1: Math.max(a.l, c.l), levels: sr[i].levels || null });
    }
    const kr = b.keepRects || [];
    F.mouths = [];
    for (let i = 0; i < kr.length; i++) {
      const a = toF(kr[i].x0, kr[i].z0), c = toF(kr[i].x1, kr[i].z1);
      F.mouths.push({ d0: Math.min(a.d, c.d), d1: Math.max(a.d, c.d), l0: Math.min(a.l, c.l), l1: Math.max(a.l, c.l) });
    }
    // the front door, in the frame
    const fd = toF(dn.x, dn.z);
    F.doorL = fd.l;
    return F;
  }
  const NOCAST = { cast: false };
  const SOLID = { cast: false, solid: true };
  // is (d, l) inside a stair / shaft / landing mouth (pad metres of margin)?
  function stateInHole(F, d, l, pad) {
    pad = pad || 0;
    const L = F.holes.concat(F.mouths);
    for (let i = 0; i < L.length; i++) {
      const R = L[i];
      if (d > R.d0 - pad && d < R.d1 + pad && l > R.l0 - pad && l < R.l1 + pad) return true;
    }
    return false;
  }

  /* ---- THE FACADE'S OWN WINDOWS, READ FROM INSIDE --------------------------
     buildings.js files every pane it glazes on b.windows (world centre, half
     extents). The panes on this storey are grouped into openings (a window of
     two stacked panes is one opening) and put in the frame: which wall (d0 the
     door wall, d1 the back, l- / l+ the flanks), where along it, how wide, and
     from what height to what height over this floor. A partition that meets a
     facade is snapped to a pier between openings, never through glass. */
  function stateWindows(F) {
    const out = [];
    const W = F.b.windows || [];
    const ox = F.h.ox, oz = F.h.oz;
    const byKey = Object.create(null);
    for (let i = 0; i < W.length; i++) {
      const w = W[i];
      if (!w || w.y == null) continue;
      const yb = w.y - (w.hh || 0.6) - F.Y, yt = w.y + (w.hh || 0.6) - F.Y;
      if (yt < 0.3 || yb > F.CL - 0.2) continue;             // another storey's glass
      const p = F.toF(w.x - ox, w.z - oz);
      const hx = w.hw || 0, hz = w.hd || 0;
      const nExt = Math.abs(F.nx) * hx + Math.abs(F.nz) * hz;  // half extent along d
      const tExt = Math.abs(F.tx) * hx + Math.abs(F.tz) * hz;  // half extent along l
      let face, c, hw;
      if (nExt < tExt) { face = p.d < F.D / 2 ? "d0" : "d1"; c = p.l; hw = tExt; }
      else { face = p.l < 0 ? "l-" : "l+"; c = p.d; hw = nExt; }
      const key = face + ":" + Math.round(c * 20);
      const g = byKey[key];
      if (g) { g.yb = Math.min(g.yb, yb); g.yt = Math.max(g.yt, yt); g.hw = Math.max(g.hw, hw); }
      else { byKey[key] = { face: face, c: c, hw: hw, yb: yb, yt: yt }; out.push(byKey[key]); }
    }
    out.sort(function (a, b2) { return a.face < b2.face ? -1 : a.face > b2.face ? 1 : a.c - b2.c; });
    return out;
  }
  // slide a partition line that meets `face` off any glass (to the nearest pier)
  function stateSnap(F, face, c) {
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (let i = 0; i < F.wins.length; i++) {
        const w = F.wins[i];
        if (w.face !== face) continue;
        const a = w.c - w.hw - 0.14, b2 = w.c + w.hw + 0.14;
        if (c > a && c < b2) { c = (c - a < b2 - c) ? a : b2; moved = true; }
      }
      if (!moved) break;
    }
    return c;
  }
  function stateWinsOn(F, face, c0, c1) {
    const out = [];
    for (let i = 0; i < F.wins.length; i++) {
      const w = F.wins[i];
      if (w.face === face && w.c + w.hw > c0 + 0.05 && w.c - w.hw < c1 - 0.05) out.push(w);
    }
    return out;
  }

  /* ---- THE STATE WALL -------------------------------------------------------
     A full-height solid partition on the line d = at (axis "d", running along
     l from..to) or l = at (axis "l", running along d). `openings`:
       { c, w, leaf: true|false, h, label, swing: +1|-1, id }
     A leaf opening gets a real door (stateDoor); a leafless one is an arch.
     Every opening is cased on both faces. The wall is filed on F.walls so the
     rooms either side can run their trim to it and stop at its openings. */
  function stateWall(F, axis, at, from, to, openings, o) {
    o = o || {};
    const lo = Math.min(from, to), hi = Math.max(from, to);
    if (hi - lo < 0.2) return null;
    const col = o.col != null ? o.col : SP.ivory, casing = o.casing != null ? o.casing : SP.cream;
    const T = o.t || ST_T, H = F.CL;
    const ops = (openings || []).filter(function (op) { return op && op.c - op.w / 2 > lo + 0.05 && op.c + op.w / 2 < hi - 0.05; })
      .sort(function (a, b2) { return a.c - b2.c; });
    const seg = function (a, c, y0, y1) {
      if (c - a < 0.02) return;
      if (axis === "d") F.box(at, (a + c) / 2, y0, y1, T, c - a, col, SOLID);
      else F.box((a + c) / 2, at, y0, y1, c - a, T, col, SOLID);
      WALL_TALLY.solid++;
    };
    let cur = lo;
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const a = op.c - op.w / 2, c = op.c + op.w / 2;
      seg(cur, a, 0, H);
      const oh = op.h || (op.leaf ? DOOR_H : Math.min(H - 0.5, 3.0));
      op.h = oh;
      seg(a, c, oh, H);                              // the header over it
      cur = c;
      // casing, both faces: two jambs and a head, 3 cm proud of the plaster
      for (const s of [-1, 1]) {
        const off = s * (T / 2 + 0.015);
        for (const e of [a - 0.07, c + 0.07]) {
          if (axis === "d") F.box(at + off, e, 0, oh + 0.14, 0.03, 0.14, casing);
          else F.box(e, at + off, 0, oh + 0.14, 0.14, 0.03, casing);
        }
        if (axis === "d") F.box(at + off, op.c, oh, oh + 0.16, 0.03, op.w + 0.28, casing);
        else F.box(op.c, at + off, oh, oh + 0.16, op.w + 0.28, 0.03, casing);
        // a pediment cap over the grand doors
        if (op.grand) {
          if (axis === "d") F.box(at + s * (T / 2 + 0.05), op.c, oh + 0.16, oh + 0.28, 0.10, op.w + 0.36, casing);
          else F.box(op.c, at + s * (T / 2 + 0.05), oh + 0.16, oh + 0.28, op.w + 0.36, 0.10, casing);
        }
      }
      if (op.leaf) stateDoor(F, axis, at, op);
    }
    seg(cur, hi, 0, H);
    const rec = { axis: axis, at: at, from: lo, to: hi, t: T, ops: ops };
    F.walls.push(rec);
    return rec;
  }

  /* ---- THE STATE DOOR — a unit door that is not locked --------------------
     The ONE interior door system in the city is the unit door above (flats:
     a leaf with a collider, E to open, the collider leaves when it opens).
     A room of state is the same leaf with `free` set: nobody needs a key to
     open the Cabinet Room, and it swings on its hinge to the `swing` side. */
  function stateDoor(F, axis, at, op) {
    const w = op.w;
    const p = axis === "d" ? F.P(at, op.c) : F.P(op.c, at);
    // does the wall run along local x?
    const runX = axis === "d" ? Math.abs(F.tx) > 0.5 : Math.abs(F.nx) > 0.5;
    // the hinge: the low-c jamb; the leaf swings to the `swing` side
    // (+1 = toward +d / +l). In world terms the wall runs along r and its
    // normal is m (both unit, axis-aligned in this kit's frames).
    const sw = op.swing || 1;
    const rX = axis === "d" ? F.tx : F.nx, rZ = axis === "d" ? F.tz : F.nz;
    const mX = axis === "d" ? F.nx : F.tx, mZ = axis === "d" ? F.nz : F.tz;
    const d = freeDoorway(F.h, F.Y, p.x, p.z, runX, w, DOOR_H, SP.walnut,
      -Math.sign(runX ? rX : rZ) || -1, (Math.sign(runX ? mZ : mX) || 1) * sw, op.label, F.k);
    if (!d) return null;
    if (op.id) d.id = op.id;
    F.doors.push(d);
    if (d.pair) F.doors.push(d.pair);
    return d;
  }

  /* ---- A ROOM ---------------------------------------------------------------
     room: { key, name, d0, d1, l0, l1, floor: hex, rug?, wains?, rail, crown,
             coffer, ceil (tint) }
     Draws the floor field, the trim on every wall this plan (or the shell)
     put round it, the windows on its facade walls, and files the ceiling +
     light for the lazy fit-out. */
  function stateRoom(F, room) {
    const d0 = room.d0, d1 = room.d1, l0 = room.l0, l1 = room.l1;
    if (!(d1 - d0 > 0.8) || !(l1 - l0 > 0.8)) return room;
    // 1. the floor field, face to face, 0.8..1.4 cm over the slab. The shaft
    // and the landing mouth are left to the stair (a field over a stairwell
    // is the old "floor over the hole").
    stateField(F, d0, d1, l0, l1, room.floor != null ? room.floor : SP.marble);
    // 2. trim
    stateTrim(F, room);
    // 3. windows
    const faces = [["d0", d0 < 0.05, l0, l1], ["d1", d1 > F.D - 0.05, l0, l1], ["l-", l0 < -F.half + 0.05, d0, d1], ["l+", l1 > F.half - 0.05, d0, d1]];
    for (let i = 0; i < faces.length; i++) {
      if (!faces[i][1]) continue;
      const fc = faces[i][0];
      const ws = stateWinsOn(F, fc, faces[i][2], faces[i][3]).filter(function (w) {
        const d = fc === "d0" ? 0.3 : fc === "d1" ? F.D - 0.3 : w.c, l = fc === "l-" ? -F.half + 0.3 : fc === "l+" ? F.half - 0.3 : w.c;
        return !stateInHole(F, d, l, w.hw + 0.3);
      });
      stateWindowRun(F, fc, ws, room);
    }
    // 4. the ceiling for the fit-out pass (plaster plane + baked light)
    const R = F.rect(d0, d1, l0, l1);
    F.fitRooms.push({ x0: R.x0, x1: R.x1, z0: R.z0, z1: R.z1, tint: room.ceil != null ? room.ceil : 0xf6f1e6 });
    room.rectL = R;
    F.rooms.push(room);
    STATE_ROOMS.push({ key: room.key, name: room.name, b: F.b, floorY: F.Y,
      x0: F.h.ox + R.x0, x1: F.h.ox + R.x1, z0: F.h.oz + R.z0, z1: F.h.oz + R.z1 });
    return room;
  }
  // a floor field, split round any hole it would cover
  function stateField(F, d0, d1, l0, l1, col) {
    const cut = [{ d0: d0, d1: d1, l0: l0, l1: l1 }];
    const holes = F.holes.filter(function (H) { return !H.levels || H.levels.indexOf(F.k) >= 0 || F.k === 0; });
    for (let i = 0; i < holes.length; i++) {
      const H = holes[i];
      for (let j = cut.length - 1; j >= 0; j--) {
        const c = cut[j];
        if (H.d1 <= c.d0 || H.d0 >= c.d1 || H.l1 <= c.l0 || H.l0 >= c.l1) continue;
        cut.splice(j, 1);
        if (H.d0 > c.d0) cut.push({ d0: c.d0, d1: H.d0, l0: c.l0, l1: c.l1 });
        if (H.d1 < c.d1) cut.push({ d0: H.d1, d1: c.d1, l0: c.l0, l1: c.l1 });
        const a = Math.max(c.d0, H.d0), b2 = Math.min(c.d1, H.d1);
        if (H.l0 > c.l0) cut.push({ d0: a, d1: b2, l0: c.l0, l1: H.l0 });
        if (H.l1 < c.l1) cut.push({ d0: a, d1: b2, l0: H.l1, l1: c.l1 });
      }
    }
    for (let i = 0; i < cut.length; i++) {
      const c = cut[i];
      F.box((c.d0 + c.d1) / 2, (c.l0 + c.l1) / 2, FIELD_B, FIELD_T, c.d1 - c.d0, c.l1 - c.l0, col);
    }
  }
  // A RUG: field + border, both topping out at RUG_T (2 cm), bottom on the
  // field. `inset` border width.
  function stateRug(F, d, l, dd, ll, col, border, bw) {
    bw = bw == null ? 0.22 : bw;
    if (border == null) { F.box(d, l, FIELD_T, RUG_T, dd, ll, col); return; }
    F.box(d, l, FIELD_T, RUG_T, dd - 2 * bw, ll - 2 * bw, col);
    F.box(d - dd / 2 + bw / 2, l, FIELD_T, RUG_T, bw, ll, border);
    F.box(d + dd / 2 - bw / 2, l, FIELD_T, RUG_T, bw, ll, border);
    F.box(d, l - ll / 2 + bw / 2, FIELD_T, RUG_T, dd - 2 * bw, bw, border);
    F.box(d, l + ll / 2 - bw / 2, FIELD_T, RUG_T, dd - 2 * bw, bw, border);
  }

  /* ---- TRIM: skirting, chair rail, wainscot, crown ------------------------
     Run along every edge of the room that has a wall on it: a facade (the
     shell's inner face) or a partition this plan drew. Stops at every door
     and (for the rail and the wainscot) at every window. */
  // where a perpendicular wall meets the end of a run, the run stops at its face
  function stateEdgeInset(F, axis, at, end, dir) {
    let ins = 0;
    for (let i = 0; i < F.walls.length; i++) {
      const w = F.walls[i];
      if (w.axis === axis || !w.t || Math.abs(w.at - end) > 0.06) continue;
      if (at < w.from - 0.05 || at > w.to + 0.05) continue;
      ins = Math.max(ins, w.t / 2);
    }
    return dir * ins;
  }
  // the stair, the core and the landing mouth cut every trim run that meets them
  function stateHoleCuts(F, axis, face) {
    const cuts = [];
    const L = F.holes.concat(F.mouths);
    for (let i = 0; i < L.length; i++) {
      const H = L[i];
      if (H.levels && H.levels.indexOf(F.k) < 0 && F.k !== 0) continue;
      if (axis === "d") { if (face > H.d0 - 0.4 && face < H.d1 + 0.4) cuts.push({ a: H.l0 - 0.05, b: H.l1 + 0.05, yb: -1, yt: 99 }); }
      else if (face > H.l0 - 0.4 && face < H.l1 + 0.4) cuts.push({ a: H.d0 - 0.05, b: H.d1 + 0.05, yb: -1, yt: 99 });
    }
    return cuts;
  }
  function stateEdges(F, room) {
    const out = [];
    const E = [
      { axis: "d", at: room.d0, s: 1, from: room.l0, to: room.l1, face: "d0", ext: room.d0 < 0.05 },
      { axis: "d", at: room.d1, s: -1, from: room.l0, to: room.l1, face: "d1", ext: room.d1 > F.D - 0.05 },
      { axis: "l", at: room.l0, s: 1, from: room.d0, to: room.d1, face: "l-", ext: room.l0 < -F.half + 0.05 },
      { axis: "l", at: room.l1, s: -1, from: room.d0, to: room.d1, face: "l+", ext: room.l1 > F.half - 0.05 },
    ];
    for (let i = 0; i < E.length; i++) {
      const e = E[i];
      if (e.ext) {
        const cuts = [];
        const ws = stateWinsOn(F, e.face, e.from, e.to);
        for (let j = 0; j < ws.length; j++) cuts.push({ a: ws[j].c - ws[j].hw - 0.1, b: ws[j].c + ws[j].hw + 0.1, yb: ws[j].yb, yt: ws[j].yt });
        // the front door is a hole in the facade
        if (e.face === "d0" && Math.abs(F.doorL) < F.half) cuts.push({ a: F.doorL - 1.1, b: F.doorL + 1.1, yb: 0, yt: 3 });
        const hc = stateHoleCuts(F, e.axis, e.at);
        for (let j = 0; j < hc.length; j++) cuts.push(hc[j]);
        const a0 = e.from + stateEdgeInset(F, e.axis, e.at, e.from, 1), a1 = e.to + stateEdgeInset(F, e.axis, e.at, e.to, -1);
        out.push({ axis: e.axis, face: e.at, s: e.s, runs: [[a0, a1]], cuts: cuts });
        continue;
      }
      for (let j = 0; j < F.walls.length; j++) {
        const w = F.walls[j];
        if (w.axis !== e.axis || Math.abs(w.at - e.at) > 0.06) continue;
        const a = Math.max(e.from, w.from), b2 = Math.min(e.to, w.to);
        if (b2 - a < 0.3) continue;
        const cuts = [];
        for (let k = 0; k < w.ops.length; k++) cuts.push({ a: w.ops[k].c - w.ops[k].w / 2 - 0.16, b: w.ops[k].c + w.ops[k].w / 2 + 0.16, yb: 0, yt: w.ops[k].h + 0.2 });
        const fc = w.at + e.s * w.t / 2;
        const hc = stateHoleCuts(F, e.axis, fc);
        for (let q = 0; q < hc.length; q++) cuts.push(hc[q]);
        const a0 = a + stateEdgeInset(F, e.axis, fc, a, 1), a1 = b2 + stateEdgeInset(F, e.axis, fc, b2, -1);
        out.push({ axis: e.axis, face: fc, s: e.s, runs: [[a0, a1]], cuts: cuts });
      }
    }
    return out;
  }
  function stateRun(F, e, y0, y1, proud, col, cutAll) {
    // subtract every cut whose height band meets [y0, y1]
    let runs = e.runs.slice();
    for (let i = 0; i < e.cuts.length; i++) {
      const c = e.cuts[i];
      if (!cutAll && (c.yt < y0 || c.yb > y1)) continue;
      const next = [];
      for (let j = 0; j < runs.length; j++) {
        const r0 = runs[j][0], r1 = runs[j][1];
        if (c.b <= r0 || c.a >= r1) { next.push(runs[j]); continue; }
        if (c.a > r0) next.push([r0, c.a]);
        if (c.b < r1) next.push([c.b, r1]);
      }
      runs = next;
    }
    for (let j = 0; j < runs.length; j++) {
      const a = runs[j][0], b2 = runs[j][1];
      if (b2 - a < 0.08) continue;
      const off = e.face + e.s * proud / 2;
      if (e.axis === "d") F.box(off, (a + b2) / 2, y0, y1, proud, b2 - a, col);
      else F.box((a + b2) / 2, off, y0, y1, b2 - a, proud, col);
    }
    return runs;
  }
  function stateTrim(F, room) {
    const edges = stateEdges(F, room);
    const skirt = room.skirt != null ? room.skirt : SP.walnut;
    const railC = room.rail !== undefined ? room.rail : SP.cream;
    const crown = room.crown != null ? room.crown : SP.cream;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      stateRun(F, e, 0, 0.20, 0.025, skirt, false);                       // skirting (stands on the floor top)
      if (railC != null) {
        if (room.wains != null) {
          // panelled dado: a board, then raised panels between rail and skirting
          const runs = stateRun(F, e, 0.20, 0.92, 0.012, room.wains, false);
          for (let j = 0; j < runs.length; j++) {
            const a = runs[j][0], b2 = runs[j][1], n = Math.max(1, Math.floor((b2 - a) / 1.15));
            const step = (b2 - a) / n;
            for (let q = 0; q < n; q++) {
              const c = a + step * (q + 0.5), wdt = step - 0.22;
              if (wdt < 0.2) continue;
              const off = e.face + e.s * 0.02;
              if (e.axis === "d") F.box(off, c, 0.32, 0.80, 0.016, wdt, room.wains);
              else F.box(c, off, 0.32, 0.80, wdt, 0.016, room.wains);
            }
          }
        }
        stateRun(F, e, 0.92, 0.98, 0.035, railC, false);                  // chair rail
      }
      // the crown: a deep cove at the ceiling and a smaller bead under it
      stateRun(F, e, F.CL - 0.24, F.CL, 0.16, crown, false);
      stateRun(F, e, F.CL - 0.34, F.CL - 0.24, 0.07, crown, false);
    }
  }
  // a coffered ceiling: beams both ways on `bay`, clear of the crown
  function stateCoffers(F, d0, d1, l0, l1, bay, col) {
    col = col != null ? col : SP.cream;
    const a0 = d0 + 0.5, a1 = d1 - 0.5, b0 = l0 + 0.5, b1 = l1 - 0.5;
    if (a1 - a0 < 1 || b1 - b0 < 1) return;
    const nd = Math.max(1, Math.round((a1 - a0) / bay)), nl = Math.max(1, Math.round((b1 - b0) / bay));
    for (let i = 1; i < nd; i++) F.box(a0 + (a1 - a0) * i / nd, (b0 + b1) / 2, F.CL - 0.2, F.CL, 0.22, b1 - b0, col);
    for (let j = 1; j < nl; j++) F.box((a0 + a1) / 2, b0 + (b1 - b0) * j / nl, F.CL - 0.2, F.CL, a1 - a0, 0.22, col);
  }
  /* A CHANDELIER on (d, l): ceiling rose, drop rod, gilt corona, ONE emissive
     body (the rationed draw call; it rides the INTERIOR_LIGHT_DAY ramp), a
     finial — and a baked source for the fit-out so the ceiling and the room
     round it are actually lit. Its lowest point stays 2.4 m over the floor. */
  function stateChandelier(F, d, l, size, room) {
    size = size || 1.0;
    const top = F.CL;
    const low = Math.max(2.45, top - 1.15);
    F.box(d, l, top - 0.03, top, 0.7 * size + 0.3, 0.7 * size + 0.3, SP.cream);    // ceiling rose
    F.box(d, l, low + 0.62, top - 0.03, 0.05, 0.05, SP.gold);                      // rod
    F.box(d, l, low + 0.50, low + 0.62, 1.1 * size, 1.1 * size, SP.gold);          // corona
    const m = F.box(d, l, low + 0.18, low + 0.50, 0.86 * size, 0.86 * size, SP.lamp, { emissive: SP.lamp, ei: 0.85, cast: false });
    if (m) { ceilingStrip(m); F.lights++; }
    F.box(d, l, low, low + 0.18, 0.28 * size, 0.28 * size, SP.gold);               // finial
    const p = F.P(d, l);
    F.fitLights.push({ x: p.x, z: p.z, r: 5.5 + 2.0 * size, i: 0.85, rect: room ? room.rectL || null : null });
  }
  // a quieter light for a private room: a flush dome, emissive disc, baked source
  function stateDome(F, d, l, room) {
    F.box(d, l, F.CL - 0.03, F.CL, 0.5, 0.5, SP.cream);
    const m = F.box(d, l, F.CL - 0.09, F.CL - 0.03, 0.40, 0.40, SP.lamp, { emissive: SP.lamp, ei: 0.7, cast: false });
    if (m) { ceilingStrip(m); F.lights++; }
    const p = F.P(d, l);
    F.fitLights.push({ x: p.x, z: p.z, r: 5.0, i: 0.75, rect: room ? room.rectL || null : null });
  }

  /* ---- A RUN OF WINDOWS on one facade wall of a room -----------------------
     Casing round each opening (a shared mullion where two openings touch), a
     stool and apron under it, and — in a room that wants them — curtains at
     the ends of the run with a pelmet over. The glass is the facade's. */
  function stateWindowRun(F, face, ws, room) {
    if (!ws.length) return;
    const onD = face === "d0" || face === "d1";
    const at = face === "d0" ? 0 : face === "d1" ? F.D : face === "l-" ? -F.half : F.half;
    const s = (face === "d0" || face === "l-") ? 1 : -1;       // into the room
    const casing = room.casing != null ? room.casing : SP.cream;
    const put = function (c, y0, y1, depth, off, width, col) {
      const n = at + s * (off + depth / 2);
      if (onD) F.box(n, c, y0, y1, depth, width, col);
      else F.box(c, n, y0, y1, width, depth, col);
    };
    // the room's own faces along this wall: a partition at either end eats half its thickness
    const lo = (onD ? room.l0 : room.d0) + ST_T / 2, hi = (onD ? room.l1 : room.d1) - ST_T / 2;
    let runStart = null;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      const a = Math.max(lo + 0.14, w.c - w.hw), b2 = Math.min(hi - 0.14, w.c + w.hw);
      if (b2 - a < 0.3) continue;
      const c = (a + b2) / 2, wd = b2 - a;
      const prev = ws[i - 1], next = ws[i + 1];
      const joinPrev = prev && (w.c - w.hw) - (prev.c + prev.hw) < 0.2;
      const joinNext = next && (next.c - next.hw) - (w.c + w.hw) < 0.2;
      if (!joinPrev) runStart = a;
      const yb = Math.max(0.02, w.yb), yt = Math.min(F.CL - 0.4, w.yt);
      // jambs (a joint gets one pilaster, drawn by the left opening)
      if (!joinPrev) put(a - 0.06, yb - 0.06, yt + 0.1, 0.05, 0, 0.12, casing);
      put(b2 + 0.06, yb - 0.06, yt + 0.1, joinNext ? 0.06 : 0.05, 0, 0.12, casing);
      put(c, yt + 0.02, yt + 0.18, 0.05, 0, wd + 0.28, casing);                // head
      if (yb > 0.25) {
        put(c, yb - 0.04, yb, 0.16, 0, wd + 0.26, casing);                     // stool
        put(c, Math.max(0.22, yb - 0.24), yb - 0.04, 0.03, 0, wd + 0.12, casing);   // apron
      }
      if (!joinNext && room.drape != null && runStart != null) {
        const top = Math.min(F.CL - 0.28, yt + 0.5);
        // the pelmet and the curtains stay between the room's own faces
        const p0 = Math.max(lo + 0.02, runStart - 0.6), p1 = Math.min(hi - 0.02, b2 + 0.6);
        if (room.closed) {
          // drawn curtains: one panel over the whole run (a briefing room)
          put((p0 + p1) / 2, 0.015, top, 0.08, 0.12, p1 - p0, room.drape);
        } else {
          for (const e of [runStart - 0.34, b2 + 0.34]) if (e - 0.23 > lo && e + 0.23 < hi) put(e, 0.015, top, 0.10, 0.10, 0.46, room.drape);
        }
        put((p0 + p1) / 2, top, top + 0.28, 0.14, 0.08, p1 - p0, room.drape);
      }
    }
  }

  /* ---- ARCHITECTURAL PIECES ------------------------------------------------ */
  // a fireplace against the wall whose face is at `face` (axis "d": wall along
  // l at d = face; "l": wall along d at l = face), opening into the room on
  // side s. Jambs, lintel, mantel shelf, firebox, one ember glow, a hearth
  // stone FLUSH with the floor (a 12 cm hearth is a trip step the walk law
  // counts), and a painting over it.
  function stateFireplace(F, axis, face, c, s, o) {
    o = o || {};
    const put = function (n0, n1, a0, a1, y0, y1, col, oo) {
      const n = face + s * (n0 + n1) / 2, dn = n1 - n0;
      if (axis === "d") return F.box(n, (a0 + a1) / 2, y0, y1, dn, a1 - a0, col, oo);
      return F.box((a0 + a1) / 2, n, y0, y1, a1 - a0, dn, col, oo);
    };
    const W = o.w || 1.9, stone = o.stone != null ? o.stone : SP.marble;
    put(0, 0.34, c - W / 2, c - W / 2 + 0.36, 0, 1.12, stone);          // jambs
    put(0, 0.34, c + W / 2 - 0.36, c + W / 2, 0, 1.12, stone);
    put(0, 0.34, c - W / 2, c + W / 2, 0.86, 1.12, stone);              // lintel
    put(0, 0.46, c - W / 2 - 0.12, c + W / 2 + 0.12, 1.12, 1.20, stone); // mantel shelf
    put(0, 0.10, c - W / 2 + 0.36, c + W / 2 - 0.36, 0, 0.86, SP.black); // firebox back
    const g = put(0.10, 0.22, c - 0.4, c + 0.4, 0.02, 0.16, 0xff9a4a, { emissive: 0xff7a2a, ei: 0.9, cast: false });
    if (g) F.lights++;
    put(0.34, 0.95, c - W / 2 - 0.1, c + W / 2 + 0.1, FIELD_T, RUG_T, SP.marbleD);   // hearth, flush
    if (o.painting !== false) {
      put(0, 0.06, c - 0.62, c + 0.62, 1.55, 2.75, SP.gold);           // frame
      put(0.06, 0.08, c - 0.52, c + 0.52, 1.65, 2.65, o.canvas != null ? o.canvas : 0x3b4a3f);
    }
    const p = axis === "d" ? F.P(face + s * 0.6, c) : F.P(c, face + s * 0.6);
    return p;
  }
  // a framed painting on a wall face (portrait or landscape)
  function statePainting(F, axis, face, c, s, y0, y1, w, canvas) {
    const put = function (n0, n1, a0, a1, yy0, yy1, col) {
      const n = face + s * (n0 + n1) / 2, dn = n1 - n0;
      if (axis === "d") F.box(n, (a0 + a1) / 2, yy0, yy1, dn, a1 - a0, col);
      else F.box((a0 + a1) / 2, n, yy0, yy1, a1 - a0, dn, col);
    };
    put(0, 0.06, c - w / 2, c + w / 2, y0, y1, SP.gold);
    put(0.06, 0.075, c - w / 2 + 0.1, c + w / 2 - 0.1, y0 + 0.1, y1 - 0.1, canvas != null ? canvas : 0x4a3f36);
    F.symbols++;
  }
  // a bookcase built into a wall: carcass, shelves, books as coloured runs
  function stateBookcase(F, axis, face, c, s, w, hgt) {
    hgt = hgt || 2.4;
    const put = function (n0, n1, a0, a1, y0, y1, col) {
      const n = face + s * (n0 + n1) / 2, dn = n1 - n0;
      if (axis === "d") return F.box(n, (a0 + a1) / 2, y0, y1, dn, a1 - a0, col, SOLID);
      return F.box((a0 + a1) / 2, n, y0, y1, a1 - a0, dn, col, SOLID);
    };
    const put2 = function (n0, n1, a0, a1, y0, y1, col) {
      const n = face + s * (n0 + n1) / 2, dn = n1 - n0;
      if (axis === "d") F.box(n, (a0 + a1) / 2, y0, y1, dn, a1 - a0, col);
      else F.box((a0 + a1) / 2, n, y0, y1, a1 - a0, dn, col);
    };
    put(0, 0.05, c - w / 2, c + w / 2, 0, hgt, SP.walnut);                  // back (solid)
    put2(0.05, 0.40, c - w / 2, c - w / 2 + 0.05, 0, hgt, SP.walnut);       // sides
    put2(0.05, 0.40, c + w / 2 - 0.05, c + w / 2, 0, hgt, SP.walnut);
    put2(0.05, 0.42, c - w / 2, c + w / 2, 0, 0.36, SP.walnut);             // cupboard base
    const books = [0x6e2b27, 0x2b3f5c, 0x3f5a46, 0x8a6a3a, 0x4a3524];
    const n = Math.max(2, Math.floor((hgt - 0.5) / 0.42));
    for (let i = 0; i < n; i++) {
      const y = 0.36 + i * 0.42;
      put2(0.05, 0.40, c - w / 2 + 0.05, c + w / 2 - 0.05, y, y + 0.03, SP.walnut);   // shelf
      // two or three runs of books standing on it
      const runs = 3;
      for (let k = 0; k < runs; k++) {
        const a = c - w / 2 + 0.08 + (w - 0.16) * k / runs, b2 = a + (w - 0.16) / runs - 0.06;
        const bh = 0.24 + 0.06 * (((i * 7 + k * 3) % 3) / 2);
        put2(0.10, 0.34, a, b2, y + 0.03, y + 0.03 + bh, books[(i * 2 + k) % books.length]);
      }
    }
    put2(0, 0.44, c - w / 2 - 0.03, c + w / 2 + 0.03, hgt, hgt + 0.06, SP.walnut);   // cornice
  }
  // a national standard on a floor stand: weighted base (top 0.30, above the
  // walk law's 25 cm band), pole, finial, cloth hanging flat
  function stateStandard(F, d, l, col, clothAlongD, side) {
    if (!F.h.clear(F.P(d, l).x, F.P(d, l).z, 0.2)) return 0;
    const s = side || 1;
    F.box(d, l, 0, 0.30, 0.44, 0.44, SP.black, SOLID);
    F.box(d, l, 0.30, 2.62, 0.05, 0.05, SP.gold);
    F.box(d, l, 2.62, 2.78, 0.12, 0.12, SP.gold);
    if (clothAlongD) F.box(d + s * 0.47, l, 1.55, 2.55, 0.9, 0.04, col);
    else F.box(d, l + s * 0.47, 1.55, 2.55, 0.04, 0.9, col);
    F.symbols++;
    return 1;
  }
  // a grand piano: legs, case, lid propped, keyboard, a bench (seat anchor)
  function stateGrandPiano(F, d, l, dirD) {
    const s = dirD || 1;                       // the keyboard faces -s along d
    for (const q of [[-0.65, -0.55], [-0.65, 0.55], [0.75, 0]]) F.box(d + s * q[0], l + q[1], 0, 0.62, 0.08, 0.08, SP.black);
    F.box(d, l, 0.62, 0.98, 1.9, 1.45, SP.black, SOLID);
    F.box(d + s * 0.2, l, 0.98, 1.02, 1.5, 1.4, SP.black);
    F.box(d + s * 0.1, l + 0.62, 1.02, 1.62, 1.2, 0.04, SP.black);            // the propped lid, on edge
    F.box(d - s * 1.02, l, 0.74, 0.82, 0.16, 1.3, 0xeeeae0);                   // keys
    F.box(d - s * 1.02, l, 0.82, 0.84, 0.08, 1.3, SP.black);
    const bp = F.P(d - s * 1.55, l);
    presidentialPiece("bench", F.r, F.h, bp.x, bp.z, F.face(s, 0), { len: 0.9, back: false, tone: "exec" });
  }
  // a sky-lit window unit drawn INTO a wall (the Oval's apse, where the curved
  // wall stands clear of the facade): casing, glazing that reads as daylight,
  // glazing bars, a stool. Built round a centre point with the wall's yaw.
  function stateDrawnWindow(F, p, yaw, w, yb, yt) {
    const b = F.h.b;
    const mk = function (lx, lz, y0, y1, ww, dd, col, o) {
      const m = b.lbox(p.x + Math.cos(yaw) * lx + Math.sin(yaw) * lz, F.Y + (y0 + y1) / 2, p.z - Math.sin(yaw) * lx + Math.cos(yaw) * lz,
        ww, y1 - y0, dd, col, o || NOCAST);
      if (m) m.rotation.y = yaw;
      return m;
    };
    const g = mk(0, 0, yb, yt, w, 0.04, SP.sky, { emissive: SP.sky, ei: 0.42, cast: false });
    if (g) F.lights++;
    mk(0, 0.03, yb, yt, 0.05, 0.03, SP.cream);                                  // centre bar
    for (let i = 1; i < 4; i++) mk(0, 0.03, yb + (yt - yb) * i / 4 - 0.02, yb + (yt - yb) * i / 4 + 0.02, w, 0.03, SP.cream);
    for (const e of [-1, 1]) mk(e * (w / 2 + 0.07), 0.05, yb - 0.06, yt + 0.12, 0.14, 0.08, SP.cream);   // jambs
    mk(0, 0.05, yt, yt + 0.18, w + 0.28, 0.08, SP.cream);                        // head
    mk(0, 0.10, yb - 0.05, yb, w + 0.3, 0.2, SP.cream);                          // stool
  }

  /* ========================================================================
     THE OVAL. An ellipse of wall facets standing inside a rectangular room:
     centre (dc, lc), semi-axes A along d and B along l. Each facet is one
     rotated box (core/batch.js bakes matrixWorld, so a rotated box merges
     like any other) with a run of small colliders along it, and carries its
     own skirting, chair rail and cornice on the inner face. Doors are
     VESTIBULES: a straight axis-aligned passage from a gap in the facets to a
     door in the room's rectangular wall, so the leaf is an ordinary state
     door and the dead space between the curve and the rectangle is sealed.
     Window facets are drawn as a sill, a head and a daylit window between.
       ov.doors: [{ dir: "d+"|"d-"|"l+"|"l-", c, w, to }]   (c across the passage, `to` the wall line)
       ov.windows: [phi, ...]                                (facet centre angles, radians)
     ======================================================================== */
  function stateOval(F, ov) {
    const N = ov.n || 36, A = ov.A, B = ov.B, dc = ov.dc, lc = ov.lc;
    const T = 0.18, H = F.CL, b = F.h.b;
    const col = ov.col != null ? ov.col : SP.cream;
    const surf = function (phi) { return { d: dc + A * Math.cos(phi), l: lc + B * Math.sin(phi) }; };
    // where a passage's cheek line meets the curve (on the passage's side)
    const hit = function (dir, c) {
      if (dir === "d+" || dir === "d-") {
        const q = (c - lc) / B; if (Math.abs(q) >= 1) return null;
        return { d: dc + (dir === "d+" ? 1 : -1) * A * Math.sqrt(1 - q * q), l: c };
      }
      const q = (c - dc) / A; if (Math.abs(q) >= 1) return null;
      return { d: c, l: lc + (dir === "l+" ? 1 : -1) * B * Math.sqrt(1 - q * q) };
    };
    const inGap = function (m) {
      for (let i = 0; i < (ov.doors || []).length; i++) {
        const g = ov.doors[i];
        const across = (g.dir === "d+" || g.dir === "d-") ? m.l : m.d;
        const side = g.dir === "d+" ? m.d > dc : g.dir === "d-" ? m.d < dc : g.dir === "l+" ? m.l > lc : m.l < lc;
        if (side && Math.abs(across - g.c) < g.w / 2 + 0.2) return true;
      }
      return false;
    };
    const isWin = function (phi) {
      for (let i = 0; i < (ov.windows || []).length; i++) {
        let dphi = Math.abs(phi - ov.windows[i]) % (2 * Math.PI);
        if (dphi > Math.PI) dphi = 2 * Math.PI - dphi;
        if (dphi < Math.PI / N) return true;
      }
      return false;
    };
    // one rotated box along a frame segment (a -> c), `off` metres toward the
    // ellipse centre, `dep` thick
    const seg = function (a, c, y0, y1, off, dep, colr, o) {
      const pa = F.P(a.d, a.l), pc = F.P(c.d, c.l);
      const vx = pc.x - pa.x, vz = pc.z - pa.z, L = Math.hypot(vx, vz);
      if (L < 0.02) return null;
      let mx = (pa.x + pc.x) / 2, mz = (pa.z + pc.z) / 2;
      // inward normal: perpendicular to the segment, toward the centre
      const cc = F.P(dc, lc);
      let nx = -vz / L, nz = vx / L;
      if ((cc.x - mx) * nx + (cc.z - mz) * nz < 0) { nx = -nx; nz = -nz; }
      mx += nx * off; mz += nz * off;
      const m = b.lbox(mx, F.Y + (y0 + y1) / 2, mz, L + 0.02, y1 - y0, dep, colr, o || NOCAST);
      if (m) m.rotation.y = Math.atan2(-vz, vx);
      return m;
    };
    const cols = CBZ.colliders || [];
    let facets = 0;
    for (let i = 0; i < N; i++) {
      const p0 = (i / N) * Math.PI * 2, p1 = ((i + 1) / N) * Math.PI * 2, pm = (p0 + p1) / 2;
      const a = surf(p0), c = surf(p1), m = surf(pm);
      if (inGap(m)) continue;
      const win = isWin(pm);
      const wallOff = -T / 2;                          // the facet's centre line sits just outside the curve
      if (win) {
        const yb = ov.sill || 0.8, yt = Math.min(H - 0.5, ov.head || 3.1);
        seg(a, c, 0, yb, wallOff, T, col);
        seg(a, c, yt, H, wallOff, T, col);
        // the window unit, on the inner face
        const pa = F.P(a.d, a.l), pc = F.P(c.d, c.l), cc = F.P(dc, lc);
        const vx = pc.x - pa.x, vz = pc.z - pa.z, L = Math.hypot(vx, vz);
        let yaw = Math.atan2(-vz, vx);
        // local +z of the unit must face the centre
        if ((cc.x - (pa.x + pc.x) / 2) * Math.sin(yaw) + (cc.z - (pa.z + pc.z) / 2) * Math.cos(yaw) < 0) yaw += Math.PI;
        stateDrawnWindow(F, { x: (pa.x + pc.x) / 2, z: (pa.z + pc.z) / 2 }, yaw, L - 0.16, yb, yt);
      } else {
        const fm = seg(a, c, 0, H, wallOff, T, col);
        facets++;
        if (fm) {
          // colliders every half metre along the facet: an ellipse is not a box
          const pa = F.P(a.d, a.l), pc = F.P(c.d, c.l);
          const L = Math.hypot(pc.x - pa.x, pc.z - pa.z), n = Math.max(1, Math.ceil(L / 0.5));
          for (let k = 0; k < n; k++) {
            const t = (k + 0.5) / n, x = pa.x + (pc.x - pa.x) * t, z = pa.z + (pc.z - pa.z) * t;
            const cr = { minX: F.h.ox + x - 0.16, maxX: F.h.ox + x + 0.16, minZ: F.h.oz + z - 0.16, maxZ: F.h.oz + z + 0.16, y0: F.Y, y1: F.Y + H, ref: fm };
            cols.push(cr);
          }
        }
      }
      // trim on the inner face
      seg(a, c, 0, 0.2, 0.012, 0.025, SP.walnut);                        // skirting
      if (!win) {
        seg(a, c, 0.2, 0.92, 0.006, 0.012, ov.wains != null ? ov.wains : col);   // dado board
        seg(a, c, 0.92, 0.98, 0.017, 0.035, SP.cream);                    // chair rail
      }
      seg(a, c, H - 0.24, H, 0.08, 0.16, SP.cream);                      // cornice
      seg(a, c, H - 0.34, H - 0.24, 0.035, 0.07, SP.cream);
    }
    if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
    // vestibules: the cheeks from the curve to the room wall
    for (let i = 0; i < (ov.doors || []).length; i++) {
      const g = ov.doors[i];
      for (const e of [-1, 1]) {
        const c = g.c + e * (g.w / 2 + 0.16 + T / 2);
        const p = hit(g.dir, c);
        if (!p) continue;
        if (g.dir === "d+" || g.dir === "d-") {
          const a = Math.min(p.d, g.to), z2 = Math.max(p.d, g.to);
          if (z2 - a > 0.05) F.box((a + z2) / 2, c, 0, H, z2 - a, T, col, SOLID);
        } else {
          const a = Math.min(p.l, g.to), z2 = Math.max(p.l, g.to);
          if (z2 - a > 0.05) F.box(c, (a + z2) / 2, 0, H, T, z2 - a, col, SOLID);
        }
      }
      // an arch head over the gap in the curve
      const q = hit(g.dir, g.c);
      if (q) {
        if (g.dir === "d+" || g.dir === "d-") F.box((q.d + g.to) / 2, g.c, DOOR_H + 0.3, H, Math.abs(g.to - q.d), g.w + 0.3, col);
        else F.box(g.c, (q.l + g.to) / 2, DOOR_H + 0.3, H, g.w + 0.3, Math.abs(g.to - q.l), col);
      }
    }
    return { facets: facets, surf: surf };
  }

  /* ---- shared program plumbing -------------------------------------------- */
  // the fit-out pass (city/fitout.js) builds the ceiling planes and bakes the
  // light of every fixture this plan hung; one planner serves all five floors.
  let STATE_FIT = false;
  function armStateFit() {
    if (STATE_FIT || !CBZ.fitoutPlan) return;
    STATE_FIT = true;
    const plan = function (B, f) {
      const info = (f && f.info) || B.info || {};
      const rooms = info.rooms || [], lights = info.lights || [];
      for (let i = 0; i < rooms.length; i++) {
        const rm = rooms[i];
        B.plane(rm.x0, rm.z0, rm.x1, rm.z1, B.ceil - 0.012, "plaster", rm.tint, { down: true, cell: 1.2 });
      }
      for (let i = 0; i < lights.length; i++) {
        const L = lights[i];
        B.light(L.x, L.z, { kind: "none", r: L.r, i: L.i, rect: L.rect || null });
      }
    };
    for (const name of ["statehall", "stateresidence", "stateprivate", "cabinetroom", "ovaloffice"]) CBZ.fitoutPlan(name, plan);
  }
  function stateOut(F) {
    return { anchors: [], fit: { rooms: F.fitRooms, lights: F.fitLights } };
  }
  // the govcomplex site whose building this is (the Sit Room rect, the grand
  // stair's landing) — matched on origin, because the lot carries a copy
  function stateSite(F) {
    const L = CBZ.govComplexes;
    if (!Array.isArray(L)) return null;
    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      if (s && s.lot && s.lot.building && sameSite(s.lot.building, F.b)) return s;
    }
    return null;
  }
  // a piece at frame (d, l) facing (fd, fl); returns the kit's record
  function statePiece(F, name, d, l, yaw, opts) {
    if (stateInHole(F, d, l, 0.3)) return null;
    const p = F.P(d, l);
    return presidentialPiece(name, F.r, F.h, p.x, p.z, yaw, opts);
  }
  // a small side table with a lamp on it (the lamp's weighted base stands on
  // the table, never on the floor, so there is no 2.5 cm disc to trip on)
  // (a lamp is three emissive boxes, i.e. three draw calls: only the
  // President's own bedside gets them; a guest's table carries a book)
  function stateSideLamp(F, d, l, room, lit) {
    F.box(d, l, 0, 0.56, 0.05, 0.05, SP.walnut);
    F.box(d, l, 0.56, 0.60, 0.5, 0.5, SP.walnut, SOLID);
    if (!lit) { F.box(d, l, 0.60, 0.64, 0.22, 0.16, 0x6e2b27); return; }
    const p = F.P(d, l);
    presidentialPiece("lamp", F.r, F.h, p.x, p.z, 0, { atY: F.Y + 0.60, h: 0.62, ei: 0.5, solid: false });
    F.lights++;
    F.fitLights.push({ x: p.x, z: p.z, r: 3.0, i: 0.45, rect: room && room.rectL ? room.rectL : null });
  }
  // a bath: tub, vanity with two basins, a glass shower — boxes, all standing
  // on the floor top, the tub's rim at 0.60
  function stateBath(F, room) {
    const d0 = room.d0, d1 = room.d1, l0 = room.l0, l1 = room.l1;
    const WHITE = 0xf2f2ee;
    // tub along the d0 end
    const td = d0 + 0.2 + 0.45, tl = (l0 + l1) / 2;
    F.box(td, tl, 0, 0.60, 0.9, 1.75, WHITE, SOLID);
    F.box(td, tl, 0.60, 0.61, 0.66, 1.5, 0x9fc6d6);                       // water, under the rim
    F.box(td, tl, 0.61, 0.64, 0.9, 1.75, WHITE);
    // vanity along the l1 wall
    const vl = l1 - 0.3, vd = (d0 + d1) / 2 + 0.6;
    F.box(vd, vl, 0.08, 0.86, 1.9, 0.55, SP.walnut, SOLID);
    F.box(vd, vl, 0.86, 0.90, 2.0, 0.6, SP.marble);
    for (const e of [-0.5, 0.5]) F.box(vd + e, vl - 0.02, 0.90, 0.96, 0.44, 0.34, WHITE);
    F.box(vd, l1 - 0.03, 1.15, 2.1, 1.8, 0.03, SP.sky);                    // mirror
    // shower in the far corner, glass on two sides
    const sd = d1 - 0.65, sl = l0 + 0.65;
    F.box(sd, sl, FIELD_T, RUG_T, 1.1, 1.1, 0xd9dbd8);
    F.box(sd - 0.55, sl, 0, 2.1, 0.02, 1.1, SP.sky, SOLID);
    F.box(sd, sl + 0.55, 0, 2.1, 1.1, 0.02, SP.sky, SOLID);
  }
  // a kitchen run along a wall (axis "l": the wall at l = face, running d0..d1)
  function stateKitchenRun(F, axis, face, s, a0, a1) {
    const put = function (n0, n1, y0, y1, col, o) {
      const n = face + s * (n0 + n1) / 2, dn = n1 - n0;
      if (axis === "d") return F.box(n, (a0 + a1) / 2, y0, y1, dn, a1 - a0, col, o);
      return F.box((a0 + a1) / 2, n, y0, y1, a1 - a0, dn, col, o);
    };
    put(0.05, 0.62, 0, 0.1, SP.black);                                    // kick
    put(0, 0.62, 0.1, 0.88, SP.cream, SOLID);                             // base run
    put(0, 0.66, 0.88, 0.92, SP.marble);                                  // worktop
    put(0, 0.36, 1.45, 2.2, SP.cream);                                    // wall cupboards
  }

  // a single dressed room for a plate the plans below were not written for
  // (a changed shell): trim, windows, a table under a light. Never bare.
  function stateFallback(F, key, name) {
    const room = stateRoom(F, { key: key, name: name, d0: 0, d1: F.D, l0: -F.half, l1: F.half, floor: SP.oak, drape: SP.red });
    const t = statePiece(F, "table", F.D / 2, 0, F.latD, { len: Math.min(6, F.D * 0.4), deep: 1.4, seats: 8, tone: "exec" });
    stateChandelier(F, F.D / 2, 0, 1.0, room);
    presidentialRoom(key, name, F.h, F.r, presidentialUse(t), F.symbols, null, { center: F.P(F.D / 2, 0) });
    return stateOut(F);
  }

  /* ========================================================================
     THE STATE FLOOR (Mansion, storey 0).
       front:  the ENTRANCE HALL (the grand stair rises from its west end),
               a screen of columns, then the CROSS HALL, the spine
       east:   the EAST ROOM
       back:   the STATE DINING ROOM, the BLUE ROOM, the service hall, and
               the Situation Room (presidency.js) behind its own door
     ======================================================================== */
  function progStateHall(r, h, opts) {
    // the first presidential program built: the world-rebuild boundary for
    // the ledger below
    presidentialReset();
    armStateFit();
    shell(h, r);
    const F = stateFrame(h, r);
    if (F.D < 28 || F.W < 44) return stateFallback(F, "statehall", "State Entrance Hall");
    const HW = F.half, D = F.D;
    // the grand stair on this floor (the reserve that opens slab 1)
    let stair = null, core = null;
    for (let i = 0; i < F.holes.length; i++) {
      const H = F.holes[i];
      if (H.levels && H.levels.indexOf(1) >= 0) stair = H; else if (!core || H.d1 > core.d1) core = H;
    }
    const stairE = stair ? stair.l1 + 0.25 : -HW + 4.0;
    // THE SITUATION ROOM'S PLATE. This plan decides where the state floor's
    // rooms are, so it decides this one too: the back corner on the east
    // flank, from a pier on the back facade to the flank wall, behind the
    // Cross Hall. presidency.js builds the room on exactly this rect
    // (b._sitRoom, world coords); site.layout.sitRoom is its fallback only.
    const dEH = 7.0, dXH = 14.0;
    const sr = { d0: dXH + 3.1, d1: D, l0: stateSnap(F, "d1", 12.5), l1: HW };
    {
      const wr = F.rect(sr.d0, sr.d1, sr.l0, sr.l1);
      const fr = F.P(sr.d0, (sr.l0 + sr.l1) / 2);
      F.b._sitRoom = { minX: F.h.ox + wr.x0, maxX: F.h.ox + wr.x1, minZ: F.h.oz + wr.z0, maxZ: F.h.oz + wr.z1, y: F.Y, ceil: F.Y + F.CL,
        // the door is in the wall that faces the Cross Hall: its centre, and the way out
        door: { x: F.h.ox + fr.x, z: F.h.oz + fr.z, nx: -F.nx, nz: -F.nz } };
    }
    const lEHe = stateSnap(F, "d0", 11.5);                 // the East Room's west wall
    const lSvc = stateSnap(F, "d1", -19.5);                // service hall | dining
    const lDB = stateSnap(F, "d1", -3.95);                 // dining | Blue Room
    const lBE = sr.l0;                                    // Blue Room | Situation Room
    let usable = 0;

    // ---- walls -------------------------------------------------------------
    const eastDoor = (lEHe + HW) / 2;
    stateWall(F, "d", dEH, lEHe, HW, [{ c: eastDoor, w: 1.7, leaf: true, swing: -1, grand: true, label: "the East Room" }]);
    stateWall(F, "l", lEHe, 0, dEH, [{ c: 5.0, w: 1.7, leaf: true, swing: 1, grand: true, label: "the East Room" }]);
    const dinC = (lSvc + lDB) / 2, bluC = (lDB + lBE) / 2;
    stateWall(F, "d", dXH, lSvc, lBE, [
      { c: dinC, w: 1.9, leaf: true, swing: 1, grand: true, label: "the State Dining Room" },
      { c: bluC, w: 1.9, leaf: true, swing: 1, grand: true, label: "the Blue Room" },
    ]);
    stateWall(F, "l", lSvc, dXH, D, [{ c: 18.6, w: 1.1, leaf: true, swing: 1, label: "the pantry" }]);
    stateWall(F, "l", lDB, dXH, D, [{ c: (dXH + D) / 2, w: 1.7, leaf: true, swing: 1, grand: true, label: "the Blue Room" }]);
    if (sr.d0 > dXH + 0.3) stateWall(F, "l", lBE, dXH, sr.d0, []);
    // the Situation Room's own walls, which presidency.js draws: filed so the
    // trim round the Blue Room and the lobby runs to them and stops at its door
    const srDoorL = (sr.l0 + sr.l1) / 2;
    {
      F.walls.push({ axis: "l", at: sr.l0, from: sr.d0, to: sr.d1, t: 0, ops: [] });
      F.walls.push({ axis: "d", at: sr.d0, from: sr.l0, to: sr.l1, t: 0, ops: [{ c: srDoorL, w: 2.4, h: 2.7 }] });
    }
    // the core's front and flank: its own walls, filed the same way
    if (core) {
      F.walls.push({ axis: "d", at: core.d0, from: core.l0, to: core.l1, t: 0, ops: [{ c: (core.l0 + core.l1) / 2, w: 1.6, h: 2.3 }] });
      F.walls.push({ axis: "l", at: core.l1, from: core.d0, to: core.d1, t: 0, ops: [] });
    }

    // ---- rooms -------------------------------------------------------------
    const EH = stateRoom(F, { key: "entrancehall", name: "Entrance Hall", d0: 0, d1: dEH, l0: -HW, l1: lEHe, floor: SP.marble, drape: SP.red });
    const XH = stateRoom(F, { key: "crosshall", name: "Cross Hall", d0: dEH, d1: dXH, l0: -HW, l1: HW, floor: SP.marble, drape: SP.red });
    const LB = stateRoom(F, { key: "sitlobby", name: "Situation Room lobby", d0: dXH, d1: sr.d0, l0: lBE, l1: HW, floor: SP.marble, drape: SP.red });
    const ER = stateRoom(F, { key: "eastroom", name: "East Room", d0: 0, d1: dEH, l0: lEHe, l1: HW, floor: SP.oak, drape: SP.rugGold, wains: SP.cream });
    const DR = stateRoom(F, { key: "statedining", name: "State Dining Room", d0: dXH, d1: D, l0: lSvc, l1: lDB, floor: SP.oak, drape: SP.red, wains: SP.walnut });
    const BR = stateRoom(F, { key: "blueroom", name: "Blue Room", d0: dXH, d1: D, l0: lDB, l1: lBE, floor: SP.oak, drape: SP.blue, wains: SP.blue });
    const SH = stateRoom(F, { key: "servicehall", name: "Service Hall", d0: dXH, d1: D, l0: -HW, l1: lSvc, floor: SP.tile, rail: null, ceil: 0xf2f2ee });

    // ---- the ENTRANCE HALL ---------------------------------------------------
    // a screen of columns between it and the Cross Hall, with a clear bay on
    // the door axis; the architrave they carry runs under the ceiling
    const colW = Math.max(stairE + 1.2, -HW + 5.2);
    const piers = [];
    for (let l = F.doorL + 2.0; l < lEHe - 1.0; l += 3.9) piers.push(l);
    for (let l = F.doorL - 2.0; l > colW; l -= 3.9) piers.push(l);
    for (let i = 0; i < piers.length; i++) {
      const l = piers[i];
      F.box(dEH, l, 0, 0.30, 0.86, 0.86, SP.marbleD, SOLID);
      F.box(dEH, l, 0.30, F.CL - 0.62, 0.56, 0.56, SP.marble, SOLID);
      F.box(dEH, l, F.CL - 0.62, F.CL - 0.46, 0.84, 0.84, SP.cream);
    }
    if (piers.length) {
      const pl0 = Math.min.apply(null, piers) - 0.6, pl1 = Math.min(lEHe, Math.max.apply(null, piers) + 0.6);
      F.box(dEH, (pl0 + pl1) / 2, F.CL - 0.46, F.CL, 0.64, pl1 - pl0, SP.cream);
    }
    stateRug(F, 3.8, F.doorL, 5.6, 2.8, SP.rugRed, SP.gold, 0.16);            // the red carpet in from the door
    stateCoffers(F, 0, dEH, colW, lEHe, 3.6);
    stateChandelier(F, dEH / 2, F.doorL - 7.5, 1.1, EH);
    stateChandelier(F, dEH / 2, F.doorL + 5.0, 1.1, EH);
    // trees either side of the door, benches under the front windows
    for (const e of [-1, 1]) {
      statePiece(F, "planter", 1.1, F.doorL + e * 2.3, 0, { kind: "tree", s: 1.2 });
      usable += presidentialUse(statePiece(F, "bench", 0.7, F.doorL + e * 6.2, F.face(1, 0), { len: 2.2, tone: "exec" }));
    }
    // the Steinway, as a state hall has; the President's portrait on the wall
    stateGrandPiano(F, 3.9, F.doorL - 9.2, 1);
    statePainting(F, "l", lEHe - ST_T / 2, 2.2, -1, 1.3, 2.9, 1.3, 0x3a3b4a);

    // ---- the CROSS HALL ---------------------------------------------------
    stateRug(F, (dEH + dXH) / 2 + 0.3, (colW + HW - 1.0) / 2, 2.4, HW - 1.0 - colW, SP.rugRed, SP.gold, 0.14);
    stateCoffers(F, dEH, dXH, colW, HW, 3.6);
    for (const l of [F.doorL - 12, F.doorL + 2, F.doorL + 16]) if (l > colW && l < HW - 1) stateChandelier(F, (dEH + dXH) / 2, l, 1.0, XH);
    // portraits on the back wall between the doors, a bench under two of them
    const back = dXH - ST_T / 2;
    const portraitsAt = [lSvc + 3.0, (dinC + bluC) / 2 - 3.2, (dinC + bluC) / 2 + 3.2, lBE - 2.5];
    for (let i = 0; i < portraitsAt.length; i++) {
      const l = portraitsAt[i];
      if (Math.abs(l - dinC) < 1.8 || Math.abs(l - bluC) < 1.8) continue;
      statePainting(F, "d", back, l, -1, 1.45, 2.95, 1.1, i % 2 ? 0x3d4a5a : 0x4a3a33);
      if (i === 1 || i === 2) usable += presidentialUse(statePiece(F, "bench", back - 0.4, l, F.face(-1, 0), { len: 1.9, tone: "exec" }));
    }
    // the Situation Room lobby: a Secret Service desk and the two standards
    {
      usable += presidentialUse(statePiece(F, "desk", (dXH + sr.d0) / 2, HW - 1.3, F.face(0, -1), { len: 1.5, tone: "exec" }));
      for (const e of [-1, 1]) stateStandard(F, sr.d0 - 0.45, srDoorL + e * 1.95, e < 0 ? SP.blue : SP.red, false, e);
    }

    // ---- the EAST ROOM ------------------------------------------------------
    const erC = (lEHe + HW) / 2;
    stateRug(F, dEH / 2, erC, dEH - 1.6, HW - lEHe - 2.0, SP.rugCream, SP.rugGold, 0.3);
    stateCoffers(F, 0, dEH, lEHe, HW, 3.2);
    stateChandelier(F, dEH / 2, erC - 4.0, 1.2, ER);
    stateChandelier(F, dEH / 2, erC + 4.0, 1.2, ER);
    statePainting(F, "d", dEH - ST_T / 2, eastDoor - 3.6, -1, 1.2, 3.1, 1.3, 0x3a3b4a);
    statePainting(F, "d", dEH - ST_T / 2, eastDoor + 3.6, -1, 1.2, 3.1, 1.3, 0x4a3a33);
    usable += presidentialUse(statePiece(F, "sofa", dEH / 2, HW - 0.55, F.face(0, -1), { len: 2.4, tone: "warm" }));
    for (const e of [-1, 1]) usable += presidentialUse(statePiece(F, "armchair", dEH / 2 + e * 2.0, HW - 0.7, F.face(0, -1), { tone: "warm" }));
    for (const e of [-1, 1]) statePiece(F, "planter", dEH - 0.7, lEHe + 0.8 + (e > 0 ? HW - lEHe - 1.6 : 0), 0, { kind: "tree" });

    // ---- the STATE DINING ROOM ----------------------------------------------
    const dmid = (dXH + D) / 2;
    stateRug(F, dmid, dinC, Math.min(14, D - dXH - 3), Math.min(7.6, lDB - lSvc - 3), SP.rugRed, SP.gold, 0.3);
    const table = statePiece(F, "table", dmid, dinC, F.latD, { len: 10.2, deep: 1.5, seats: 20, tone: "warm" });
    usable += presidentialUse(table);
    stateCoffers(F, dXH, D, lSvc, lDB, 3.8);
    stateChandelier(F, dmid - 3.4, dinC, 1.2, DR);
    stateChandelier(F, dmid + 3.4, dinC, 1.2, DR);
    const fire1 = stateFireplace(F, "l", lSvc + ST_T / 2, 28.4, 1, { canvas: 0x4a3a33 });
    for (const dd of [dXH + 4.4, D - 4.4]) {
      statePiece(F, "credenza", dd, lDB - ST_T / 2 - 0.3, F.face(0, -1), { len: 2.4, h: 0.9, deep: 0.5, tone: "warm" });
      statePainting(F, "l", lDB - ST_T / 2, dd, -1, 1.4, 2.8, 1.2, 0x3d4a5a);
    }

    // ---- the BLUE ROOM ------------------------------------------------------
    // the oval reception room of the house: an oval of carpet, a round of
    // seats about one table, a fireplace, the country's portraits
    const bmid = (dXH + D) / 2 + 0.6;
    for (let i = 0; i < 7; i++) {
      const t = (i + 0.5) / 7 * 2 - 1, half = Math.sqrt(1 - t * t);
      const dd = bmid + t * 4.2, ll = Math.max(1.2, half * Math.min(6.6, (lBE - lDB) / 2 - 1.3) * 2);
      if (i === 0 || i === 6) { F.box(dd, bluC, FIELD_T, RUG_T, 1.2, ll, SP.rugGold); continue; }
      F.box(dd, bluC, FIELD_T, RUG_T, 1.2, ll - 0.48, SP.rugBlue);
      for (const e of [-1, 1]) F.box(dd, bluC + e * (ll / 2 - 0.12), FIELD_T, RUG_T, 1.2, 0.24, SP.rugGold);
    }
    const bt = F.P(bmid, bluC);
    presidentialPiece("coffee", r, h, bt.x, bt.z, F.latD, { len: 1.3, deep: 0.8, tone: "warm" });
    for (const e of [-1, 1]) {
      usable += presidentialUse(statePiece(F, "sofa", bmid, bluC + e * 1.75, F.face(0, -e), { len: 2.4, tone: "warm" }));
      usable += presidentialUse(statePiece(F, "armchair", bmid + e * 1.85, bluC, F.face(-e, 0), { tone: "warm" }));
    }
    stateChandelier(F, bmid, bluC, 1.3, BR);
    stateFireplace(F, "l", lBE, bmid, -1, { canvas: 0x2f3f5a });
    for (const dd of [dXH + 3.4, D - 3.4]) statePainting(F, "l", lDB + ST_T / 2, dd, 1, 1.35, 2.85, 1.2, 0x3a3b4a);
    for (const e of [-1, 1]) statePiece(F, "planter", D - 1.0, bluC + e * ((lBE - lDB) / 2 - 1.0), 0, { kind: "tree", s: 0.9 });

    // ---- the SERVICE HALL -----------------------------------------------------
    for (const dd of [D - 4.2, D - 2.0]) statePiece(F, "shelf", dd, lSvc - ST_T / 2 - 0.3, F.face(0, -1), { len: 1.9, h: 2.1 });
    stateDome(F, (dXH + D) / 2, (Math.max(stairE, core ? core.l1 : -HW) + lSvc) / 2, SH);

    // ---- the ledger ------------------------------------------------------------
    const entry = F.P(0, F.doorL);
    const A = { x: entry.x, z: entry.z, nx: F.nx, nz: F.nz, tx: F.tx, tz: F.tz, depth: D, span: F.W };
    presidentialRoom("statehall", "State Entrance Hall", h, r, usable, F.symbols, A, {
      diplomaticSalon: bt,
      crossHall: F.P((dEH + dXH) / 2, 0),
      sitRoomDoor: F.P(sr.d0 - 1.2, srDoorL),
      grandStair: stair ? F.P(Math.max(0.8, stair.d0 - 1.2), (stair.l0 + stair.l1) / 2) : null,
      stateDiningTable: F.P(dmid, dinC),
      fireplace: fire1,
    });
    for (const rm of [DR, BR, ER]) presidentialRoom(rm.key, rm.name, h, { x0: rm.rectL.x0, x1: rm.rectL.x1, z0: rm.rectL.z0, z1: rm.rectL.z1, y: r.y }, 0, 0, null, {});
    return stateOut(F);
  }

  // the plate's own edge in the frame where a wall that is not ours bounds it
  // (the grand stair hall's partition on the family floor): its face
  function statePlateL(F) {
    const a = F.toF(F.r.x0, F.r.z0), c = F.toF(F.r.x1, F.r.z1);
    const l0 = Math.min(a.l, c.l), l1 = Math.max(a.l, c.l);
    return {
      l0: l0 > -F.half + 0.5 ? l0 - 0.07 : -F.half,
      l1: l1 < F.half - 0.5 ? l1 + 0.07 : F.half,
    };
  }
  function stateCore(F) {
    let core = null;
    for (let i = 0; i < F.holes.length; i++) { const H = F.holes[i]; if (!H.levels && (!core || H.d1 > core.d1)) core = H; }
    return core;
  }

  /* ========================================================================
     THE FAMILY FLOOR (Mansion, storey 1). The grand stair lands in its own
     hall to the west; you come through its door into the CENTRE HALL, the
     family's long sitting hall. Off it:
       front:  a guest bedroom, the FAMILY SALON (the balcony doors on the
               axis), the MASTER BEDROOM with its bath and dressing room
       back:   the FAMILY DINING ROOM, a kitchen, the STUDY, the den
     ======================================================================== */
  function progStateResidence(r, h, opts) {
    armStateFit();
    shell(h, r);
    const F = stateFrame(h, r);
    if (F.D < 28 || F.W < 44) return stateFallback(F, "stateresidence", "The Residence");
    const HW = F.half, D = F.D;
    const PL = statePlateL(F), lW = PL.l0;
    const core = stateCore(F);
    const lCoreE = core ? core.l1 : lW;
    const dC0 = stateSnap(F, "l+", D / 2), dC1 = stateSnap(F, "l+", D * 0.81);
    const lA = stateSnap(F, "d0", -7.93), lB = stateSnap(F, "d0", 7.93), lC = stateSnap(F, "d0", 19.83);
    const lK0 = stateSnap(F, "d1", -7.93), lK1 = stateSnap(F, "d1", -3.97), lS1 = stateSnap(F, "d1", 11.9);
    const dBath = stateSnap(F, "l+", 8.3);
    // where the grand stair's landing door is in the stair hall wall
    // the grand stair lands 2.2 m past its top nosing (govcomplex.js §1d)
    let landD = (dC0 + dC1) / 2;
    for (let i = 0; i < F.holes.length; i++) if (F.holes[i].levels && F.holes[i].levels.indexOf(1) >= 0) landD = F.holes[i].d1 + 2.2;
    const site = stateSite(F);
    if (site && site.grandStair && site.grandStair.landing) landD = F.toF(site.grandStair.landing.x - F.h.ox, site.grandStair.landing.z - F.h.oz).d;
    let usable = 0;
    // ---- walls
    const gC = (lW + lA) / 2, mC = (lB + lC) / 2, dsC = (lC + HW) / 2;
    stateWall(F, "d", dC0, lW, HW, [
      { c: gC, w: 1.1, leaf: true, swing: -1, label: "the guest room" },
      { c: 0, w: 2.6, leaf: false, h: 3.2, grand: true },
      { c: mC, w: 1.3, leaf: true, swing: -1, grand: true, label: "the bedroom" },
      { c: dsC, w: 1.0, leaf: true, swing: -1, label: "the dressing room" },
    ], { casing: SP.cream });
    const fdC = (lCoreE + lK0) / 2, stC = (lK1 + lS1) / 2, dnC = (lS1 + HW) / 2;
    stateWall(F, "d", dC1, lCoreE, HW, [
      { c: fdC, w: 1.4, leaf: true, swing: 1, grand: true, label: "the dining room" },
      { c: (lK0 + lK1) / 2, w: 1.0, leaf: true, swing: 1, label: "the kitchen" },
      { c: stC, w: 1.3, leaf: true, swing: 1, grand: true, label: "the study" },
      { c: dnC, w: 1.1, leaf: true, swing: 1, label: "the den" },
    ]);
    stateWall(F, "l", lA, 0, dC0, []);
    stateWall(F, "l", lB, 0, dC0, []);
    stateWall(F, "l", lC, 0, dC0, [
      { c: dBath / 2 + 0.3, w: 0.95, leaf: true, swing: 1, label: "the bathroom" },
      { c: (dBath + dC0) / 2, w: 0.95, leaf: true, swing: 1, label: "the dressing room" },
    ]);
    stateWall(F, "d", dBath, lC, HW, [{ c: dsC, w: 0.9, leaf: true, swing: -1, label: "the bathroom" }]);
    stateWall(F, "l", lK0, dC1, D, [{ c: (dC1 + D) / 2, w: 1.0, leaf: true, swing: 1, label: "the kitchen" }]);
    stateWall(F, "l", lK1, dC1, D, []);
    stateWall(F, "l", lS1, dC1, D, []);
    // the stair hall's partition (govcomplex.js draws it) and the core
    F.walls.push({ axis: "l", at: lW, from: dC0, to: dC1, t: 0, ops: [{ c: landD, w: 2.6, h: 3.0 }] });
    if (core) {
      F.walls.push({ axis: "l", at: core.l1, from: Math.max(core.d0, dC1), to: core.d1, t: 0, ops: [] });
      F.walls.push({ axis: "d", at: core.d0, from: lW, to: core.l1, t: 0, ops: [] });
    }
    // ---- rooms
    const CH = stateRoom(F, { key: "centrehall", name: "Centre Hall", d0: dC0, d1: dC1, l0: lW, l1: HW, floor: SP.oak, drape: SP.rugGold });
    const GB = stateRoom(F, { key: "guestroom", name: "Guest Bedroom", d0: 0, d1: dC0, l0: lW, l1: lA, floor: SP.oak, drape: SP.green });
    const FS = stateRoom(F, { key: "familysalon", name: "Family Salon", d0: 0, d1: dC0, l0: lA, l1: lB, floor: SP.oak, drape: SP.rugGold, wains: SP.cream });
    const MB = stateRoom(F, { key: "privatesuite", name: "Master Bedroom", d0: 0, d1: dC0, l0: lB, l1: lC, floor: SP.oak, drape: SP.blue });
    const BA = stateRoom(F, { key: "masterbath", name: "Master Bath", d0: 0, d1: dBath, l0: lC, l1: HW, floor: SP.tile, rail: null, skirt: SP.marble, ceil: 0xf2f2ee });
    const DS = stateRoom(F, { key: "dressing", name: "Dressing Room", d0: dBath, d1: dC0, l0: lC, l1: HW, floor: SP.oak, drape: SP.blue });
    const FD = stateRoom(F, { key: "familydining", name: "Family Dining Room", d0: dC1, d1: D, l0: lCoreE, l1: lK0, floor: SP.oak, drape: SP.red, wains: SP.walnut });
    const KI = stateRoom(F, { key: "kitchen", name: "Kitchen", d0: dC1, d1: D, l0: lK0, l1: lK1, floor: SP.tile, rail: null, ceil: 0xf2f2ee });
    const SY = stateRoom(F, { key: "study", name: "Study", d0: dC1, d1: D, l0: lK1, l1: lS1, floor: SP.oak, drape: SP.green, wains: SP.walnut });
    const DN = stateRoom(F, { key: "den", name: "Den", d0: dC1, d1: D, l0: lS1, l1: HW, floor: SP.oak, drape: SP.rugGold });
    const cm = (dC0 + dC1) / 2;

    // ---- CENTRE HALL: a long runner, two sitting groups, a piano, books
    stateRug(F, cm, (lW + 2.8 + HW - 1.0) / 2, 2.2, HW - 1.0 - (lW + 2.8), SP.rugGold, SP.rugRed, 0.16);
    for (const l of [-12, 4, 18]) stateChandelier(F, cm, l, 0.9, CH);
    // west group, clear of the landing and the dining door
    const g1 = lK0 - 2.2;
    usable += presidentialUse(statePiece(F, "sofa", dC1 - 0.65, g1, F.face(-1, 0), { len: 2.4, tone: "warm" }));
    presidentialPiece("coffee", r, h, F.P(dC1 - 1.95, g1).x, F.P(dC1 - 1.95, g1).z, F.latL, { len: 1.2, deep: 0.6, tone: "warm" });
    for (const e of [-1, 1]) usable += presidentialUse(statePiece(F, "armchair", dC1 - 3.05, g1 + e * 1.2, F.face(1, 0), { tone: "warm" }));
    // east group by the master bedroom
    const g2 = lB + 0.2;
    usable += presidentialUse(statePiece(F, "sofa", dC0 + 0.65, g2, F.face(1, 0), { len: 2.4, tone: "warm" }));
    presidentialPiece("coffee", r, h, F.P(dC0 + 1.95, g2).x, F.P(dC0 + 1.95, g2).z, F.latL, { len: 1.2, deep: 0.6, tone: "warm" });
    for (const e of [-1, 1]) usable += presidentialUse(statePiece(F, "armchair", dC0 + 3.05, g2 + e * 1.2, F.face(-1, 0), { tone: "warm" }));
    stateGrandPiano(F, cm, HW - 2.2, -1);
    stateBookcase(F, "d", dC1 - ST_T / 2, -1.0, -1, 2.2, 2.5);
    stateBookcase(F, "d", dC1 - ST_T / 2, 12.9, -1, 2.4, 2.5);

    // ---- FAMILY SALON: the fireplace group, a writing table, the balcony doors
    const fsC = (lA + lB) / 2;
    const fireD = dC0 * 0.58;
    stateRug(F, fireD, lA + 4.0, 5.4, 5.6, SP.rugGreen, SP.rugGold, 0.24);
    stateFireplace(F, "l", lA + ST_T / 2, fireD, 1, { canvas: 0x4a5a3f });
    for (const e of [-1, 1]) usable += presidentialUse(statePiece(F, "armchair", fireD + e * 1.45, lA + 2.1, F.face(-e, 0), { tone: "warm" }));
    const lowT = F.P(fireD, lA + 3.4);
    presidentialPiece("coffee", r, h, lowT.x, lowT.z, F.latD, { len: 1.3, deep: 0.7, tone: "warm" });
    usable += presidentialUse(statePiece(F, "sofa", fireD, lA + 4.75, F.face(0, -1), { len: 2.4, tone: "warm" }));
    usable += presidentialUse(statePiece(F, "table", dC0 * 0.58, lB - 2.6, F.latD, { len: 1.8, deep: 0.9, seats: 4, tone: "warm" }));
    stateBookcase(F, "l", lB - ST_T / 2, dC0 * 0.25, -1, 2.4, 2.5);
    stateChandelier(F, dC0 * 0.45, fsC, 1.0, FS);
    // the balcony doors, on the axis in the front wall: a pair of glazed
    // leaves in a cased opening (president_public.js steps you out through them)
    for (const e of [-1, 1]) {
      F.box(0.03, e * 0.42, 0.02, 2.75, 0.05, 0.8, SP.sky, { emissive: SP.sky, ei: 0.35, cast: false });
      for (let q = 1; q < 4; q++) F.box(0.06, e * 0.42, 0.02 + q * 0.68, 0.05 + q * 0.68, 0.03, 0.8, SP.cream);
      F.box(0.06, e * 0.87, 0, 2.95, 0.06, 0.12, SP.cream);
    }
    F.box(0.06, 0, 2.75, 2.95, 0.06, 1.86, SP.cream);
    F.box(0.06, 0, 0, 2.95, 0.05, 0.06, SP.cream);
    F.lights++;

    // ---- MASTER BEDROOM: the bed's head against the bath wall, a table
    // either side, a bench at its foot, two chairs in the window
    // between the bath door and the dressing-room door in that wall
    const bedD = (dBath / 2 + 0.3 + (dBath + dC0) / 2) / 2;
    const bedL = lC - ST_T / 2 - 1.26;
    stateRug(F, bedD, bedL - 0.6, 3.6, 4.0, SP.rugBlue, SP.rugGold, 0.2);
    const bed = statePiece(F, "bed", bedD, bedL, F.face(0, 1), { len: 2.2, wide: 1.95, tone: "warm" });
    usable += presidentialUse(bed);
    for (const e of [-1, 1]) stateSideLamp(F, bedD + e * 1.35, lC - ST_T / 2 - 0.35, MB, true);
    usable += presidentialUse(statePiece(F, "bench", bedD, bedL - 1.45, F.face(0, -1), { len: 1.5, back: false, tone: "warm" }));
    for (const e of [-1, 1]) usable += presidentialUse(statePiece(F, "armchair", 1.4, (lB + bedL) / 2 - 0.6 + e * 1.0, F.face(0, -e), { tone: "warm" }));
    statePiece(F, "credenza", bedD, lB + ST_T / 2 + 0.3, F.face(0, 1), { len: 2.0, h: 0.95, tone: "warm" });
    statePainting(F, "l", lB + ST_T / 2, bedD, 1, 1.5, 2.6, 1.3, 0x4a5a3f);
    stateDome(F, bedD, (lB + lC) / 2, MB);
    // ---- BATH + DRESSING
    stateBath(F, BA);
    stateDome(F, dBath / 2, (lC + HW) / 2, BA);
    for (const dd of [dBath + 1.2, dC0 - 1.2]) statePiece(F, "wardrobe", dd, HW - 0.35, F.face(0, -1), { len: 2.2, h: 2.4, tone: "warm" });
    usable += presidentialUse(statePiece(F, "bench", (dBath + dC0) / 2, (lC + HW) / 2 - 0.3, F.face(0, 1), { len: 1.2, back: false, tone: "warm" }));
    stateDome(F, (dBath + dC0) / 2, (lC + HW) / 2, DS);

    // ---- GUEST BEDROOM
    const gbD = dC0 * 0.5, gbL = lW + 1.3;
    const gbed = statePiece(F, "bed", gbD, gbL, F.face(0, -1), { len: 2.1, wide: 1.6, tone: "warm" });
    usable += presidentialUse(gbed);
    for (const e of [-1, 1]) stateSideLamp(F, gbD + e * 1.2, lW + 0.35, GB);
    statePiece(F, "wardrobe", dC0 - 0.45, lA - 2.0, F.face(-1, 0), { len: 2.0, h: 2.3, tone: "warm" });
    usable += presidentialUse(statePiece(F, "armchair", 1.6, lA - 1.4, F.face(1, -1), { tone: "warm" }));
    stateRug(F, gbD, gbL + 1.4, 3.2, 3.4, SP.rugGreen, SP.rugCream, 0.18);
    stateDome(F, gbD, (lW + lA) / 2, GB);

    // ---- FAMILY DINING
    const fdD = (dC1 + D) / 2;
    stateRug(F, fdD, fdC, D - dC1 - 1.6, 4.8, SP.rugRed, SP.rugGold, 0.2);
    usable += presidentialUse(statePiece(F, "table", fdD, fdC, F.latL, { len: 3.2, deep: 1.2, seats: 8, tone: "warm" }));
    stateChandelier(F, fdD, fdC, 1.0, FD);
    statePiece(F, "credenza", dC1 + ST_T / 2 + 0.3, lCoreE + 1.8, F.face(1, 0), { len: 2.0, h: 0.9, tone: "warm" });
    // ---- KITCHEN
    stateKitchenRun(F, "l", lK1 - ST_T / 2, -1, dC1 + 1.0, D - 0.2);
    F.box(dC1 + 0.55, lK1 - ST_T / 2 - 0.4, 0, 1.95, 0.8, 0.7, 0xdcdcd8, SOLID);     // the refrigerator
    stateDome(F, fdD, (lK0 + lK1) / 2, KI);
    // ---- STUDY (the Treaty Room): a writing table, books on both walls
    const syD = (dC1 + D) / 2;
    usable += presidentialUse(statePiece(F, "table", syD, stC, F.latL, { len: 2.6, deep: 1.1, seats: 2, tone: "exec" }));
    stateBookcase(F, "l", lK1 + ST_T / 2, syD, 1, 3.4, 2.6);
    stateBookcase(F, "l", lS1 - ST_T / 2, syD, -1, 3.4, 2.6);
    stateChandelier(F, syD, stC, 0.9, SY);
    // ---- DEN: a sofa facing the set
    const tvL = dnC + 3.4;
    statePiece(F, "credenza", dC1 + ST_T / 2 + 0.3, tvL, F.face(1, 0), { len: 2.2, h: 0.6, tone: "exec" });
    F.box(dC1 + ST_T / 2 + 0.3, tvL, 0.60, 1.50, 0.06, 1.6, SP.black);                           // the set, on the cabinet
    usable += presidentialUse(statePiece(F, "sofa", D - 0.75, tvL, F.face(-1, 0), { len: 2.4, tone: "warm" }));
    presidentialPiece("coffee", r, h, F.P(D - 2.1, tvL).x, F.P(D - 2.1, tvL).z, F.latL, { len: 1.2, deep: 0.6, tone: "warm" });
    stateDome(F, (dC1 + D) / 2, dnC, DN);

    const land = F.P(landD, lW + 1.2);
    const A = { x: land.x, z: land.z, nx: F.tx, nz: F.tz, tx: -F.nx, tz: -F.nz, depth: HW - lW, span: dC1 - dC0 };
    presidentialRoom("stateresidence", "The Residence", h, r, usable, F.symbols, A, {
      balconyDoor: F.P(1.5, 0),
      familySalon: lowT,
      presidentialBed: bed ? F.P(bedD, bedL) : null,
      familyDining: F.P(fdD, fdC),
      landing: land,
    });
    for (const rm of [FS, MB, FD, SY]) presidentialRoom(rm.key, rm.name, h, { x0: rm.rectL.x0, x1: rm.rectL.x1, z0: rm.rectL.z0, z1: rm.rectL.z1, y: r.y }, 0, 0, null, {});
    return stateOut(F);
  }

  /* ========================================================================
     THE THIRD FLOOR (Mansion, storey 2) — the private floor, reached by the
     service stair. The same centre hall line as the family floor below;
     front: a library, the SOLARIUM, a guest suite and its bath; back: a gym,
     a bedroom, a games room.
     ======================================================================== */
  function progStatePrivate(r, h, opts) {
    armStateFit();
    shell(h, r);
    const F = stateFrame(h, r);
    if (F.D < 28 || F.W < 44) return stateFallback(F, "stateprivate", "The Third Floor");
    const HW = F.half, D = F.D;
    const PL = statePlateL(F), lW = PL.l0;
    const core = stateCore(F);
    const lCoreE = core ? core.l1 : lW;
    const dC0 = stateSnap(F, "l+", D / 2), dC1 = stateSnap(F, "l+", D * 0.81);
    const lA = stateSnap(F, "d0", -7.93), lB = stateSnap(F, "d0", 7.93), lC = stateSnap(F, "d0", 19.83);
    const lK0 = stateSnap(F, "d1", -7.93), lK1 = stateSnap(F, "d1", 7.93);
    let usable = 0;
    stateWall(F, "d", dC0, lW, HW, [
      { c: (lW + lA) / 2, w: 1.3, leaf: true, swing: -1, label: "the library" },
      { c: 0, w: 3.0, leaf: false, h: 3.1, grand: true },
      { c: (lB + lC) / 2, w: 1.1, leaf: true, swing: -1, label: "the guest suite" },
      { c: (lC + HW) / 2, w: 0.95, leaf: true, swing: -1, label: "the bathroom" },
    ]);
    stateWall(F, "d", dC1, lCoreE, HW, [
      { c: (lCoreE + lK0) / 2, w: 1.2, leaf: true, swing: 1, label: "the gym" },
      { c: (lK0 + lK1) / 2, w: 1.1, leaf: true, swing: 1, label: "the bedroom" },
      { c: (lK1 + HW) / 2, w: 1.3, leaf: true, swing: 1, label: "the games room" },
    ]);
    stateWall(F, "l", lA, 0, dC0, []);
    stateWall(F, "l", lB, 0, dC0, []);
    stateWall(F, "l", lC, 0, dC0, []);
    stateWall(F, "l", lK0, dC1, D, []);
    stateWall(F, "l", lK1, dC1, D, []);
    if (core) {
      F.walls.push({ axis: "l", at: core.l1, from: Math.max(core.d0, dC1), to: core.d1, t: 0, ops: [] });
      F.walls.push({ axis: "d", at: core.d0, from: lW, to: core.l1, t: 0, ops: [{ c: (core.l0 + core.l1) / 2, w: 1.6, h: 2.3 }] });
    }
    const CH = stateRoom(F, { key: "hall3", name: "Third Floor Hall", d0: dC0, d1: dC1, l0: lW, l1: HW, floor: SP.oak, drape: SP.rugGold });
    const LI = stateRoom(F, { key: "library", name: "Library", d0: 0, d1: dC0, l0: lW, l1: lA, floor: SP.oak, drape: SP.green, wains: SP.walnut });
    const SO = stateRoom(F, { key: "solarium", name: "Solarium", d0: 0, d1: dC0, l0: lA, l1: lB, floor: SP.tile, drape: SP.rugCream, rail: null });
    const GS = stateRoom(F, { key: "guestsuite", name: "Guest Suite", d0: 0, d1: dC0, l0: lB, l1: lC, floor: SP.oak, drape: SP.red });
    const GBA = stateRoom(F, { key: "guestbath", name: "Guest Bath", d0: 0, d1: dC0, l0: lC, l1: HW, floor: SP.tile, rail: null, skirt: SP.marble, ceil: 0xf2f2ee });
    const GY = stateRoom(F, { key: "gym", name: "Gym", d0: dC1, d1: D, l0: lCoreE, l1: lK0, floor: 0x2e3238, rail: null, skirt: SP.black });
    const BD = stateRoom(F, { key: "bedroom3", name: "Bedroom", d0: dC1, d1: D, l0: lK0, l1: lK1, floor: SP.oak, drape: SP.blue });
    const GR = stateRoom(F, { key: "gamesroom", name: "Games Room", d0: dC1, d1: D, l0: lK1, l1: HW, floor: SP.oak, drape: SP.green, wains: SP.walnut });
    const cm = (dC0 + dC1) / 2;
    // hall
    stateRug(F, cm, (lW + 3.5 + HW - 1.0) / 2, 2.0, HW - 1.0 - (lW + 3.5), SP.rugBlue, SP.rugGold, 0.14);
    for (const l of [-14, 2, 18]) stateDome(F, cm, l, CH);
    usable += presidentialUse(statePiece(F, "bench", dC1 - 0.45, 2.0, F.face(-1, 0), { len: 2.0, tone: "warm" }));
    // library: books on two walls, reading chairs, a table
    const liC = (Math.max(lW, -HW + 4.5) + lA) / 2;
    stateBookcase(F, "l", lA - ST_T / 2, dC0 * 0.5, -1, Math.min(5.0, dC0 - 3), 2.8);
    stateBookcase(F, "d", dC0 - ST_T / 2, liC + 2.5, -1, 3.0, 2.8);
    usable += presidentialUse(statePiece(F, "table", dC0 * 0.45, liC, F.latD, { len: 2.4, deep: 1.1, seats: 4, tone: "exec" }));
    for (const e of [-1, 1]) usable += presidentialUse(statePiece(F, "armchair", 2.0, liC + e * 1.5, F.face(1, 0), { tone: "warm" }));
    stateRug(F, dC0 * 0.45, liC, 4.4, 4.2, SP.rugRed, SP.rugGold, 0.2);
    stateChandelier(F, dC0 * 0.45, liC, 0.9, LI);
    // solarium: plants, cane seats round a low table, a round of chairs
    const soC = (lA + lB) / 2;
    for (const q of [[1.2, lA + 1.0], [1.2, lB - 1.0], [dC0 - 1.2, lA + 1.0], [dC0 - 1.2, lB - 1.0], [dC0 * 0.5, lA + 0.9], [dC0 * 0.5, lB - 0.9]])
      statePiece(F, "planter", q[0], q[1], 0, { kind: "tree", s: 1.1 });
    const soT = F.P(dC0 * 0.36, soC);
    presidentialPiece("coffee", r, h, soT.x, soT.z, F.latL, { len: 1.3, deep: 0.7, tone: "warm" });
    usable += presidentialUse(statePiece(F, "sofa", dC0 * 0.36 - 1.35, soC, F.face(1, 0), { len: 2.4, tone: "warm" }));
    for (const e of [-1, 1]) usable += presidentialUse(statePiece(F, "armchair", dC0 * 0.36 + 0.2, soC + e * 1.8, F.face(0, -e), { tone: "warm" }));
    usable += presidentialUse(statePiece(F, "table", dC0 * 0.72, soC, F.latL, { len: 1.2, deep: 1.2, seats: 4, tone: "warm" }));
    for (const dd of [dC0 * 0.3, dC0 * 0.7]) stateDome(F, dd, soC, SO);
    // guest suite
    const gsD = dC0 * 0.5, gsL = lC - ST_T / 2 - 1.24;
    usable += presidentialUse(statePiece(F, "bed", gsD, gsL, F.face(0, 1), { len: 2.1, wide: 1.6, tone: "warm" }));
    for (const e of [-1, 1]) stateSideLamp(F, gsD + e * 1.2, lC - ST_T / 2 - 0.35, GS);
    statePiece(F, "wardrobe", dC0 - 0.45, lB + 1.6, F.face(-1, 0), { len: 2.0, h: 2.3, tone: "warm" });
    usable += presidentialUse(statePiece(F, "armchair", 1.5, lB + 1.3, F.face(1, 1), { tone: "warm" }));
    stateDome(F, gsD, (lB + lC) / 2, GS);
    stateBath(F, GBA);
    stateDome(F, dC0 / 2, (lC + HW) / 2, GBA);
    // gym: a rubber floor, two machines, a rack, a bench, a mirror wall
    const gyD = (dC1 + D) / 2, gyC = (lCoreE + lK0) / 2;
    for (const e of [-1, 1]) {
      const l = gyC + e * 3.0;
      F.box(gyD, l, 0, 0.26, 1.9, 0.8, SP.black, SOLID);                         // treadmill deck
      F.box(gyD, l, 0.26, 0.28, 1.6, 0.55, 0x3a3d42);
      F.box(gyD - 0.85, l, 0.24, 1.3, 0.08, 0.7, SP.black);                     // console post
      F.box(gyD - 0.85, l, 1.2, 1.35, 0.3, 0.7, 0x2a2f37);
    }
    statePiece(F, "shelf", D - 0.45, gyC, F.face(-1, 0), { len: 2.0, h: 1.2 });
    usable += presidentialUse(statePiece(F, "bench", gyD, gyC, F.face(0, 1), { len: 1.3, back: false, tone: "exec" }));
    F.box(dC1 + ST_T / 2 + 0.02, gyC + 3.4, 0.3, 2.3, 0.02, 3.0, SP.sky);     // mirror wall, clear of the door
    stateDome(F, gyD, gyC, GY);
    // bedroom
    const bdD = (dC1 + D) / 2 + 0.3, bdC = (lK0 + lK1) / 2;
    usable += presidentialUse(statePiece(F, "bed", bdD, lK0 + ST_T / 2 + 1.24, F.face(0, -1), { len: 2.1, wide: 1.6, tone: "warm" }));
    stateSideLamp(F, bdD + 1.2, lK0 + ST_T / 2 + 0.35, BD);
    statePiece(F, "wardrobe", bdD, lK1 - ST_T / 2 - 0.35, F.face(0, -1), { len: 2.0, h: 2.3, tone: "warm" });
    stateDome(F, bdD, bdC, BD);
    // games room: a billiard table, a card table, a sofa
    const grD = (dC1 + D) / 2, grC = (lK1 + HW) / 2;
    for (const q of [[-1.1, -0.55], [-1.1, 0.55], [1.1, -0.55], [1.1, 0.55]]) F.box(grD + q[1], grC - 1.5 + q[0], 0, 0.62, 0.12, 0.12, SP.walnut);
    F.box(grD, grC - 1.5, 0.62, 0.78, 1.45, 2.7, SP.walnut, SOLID);
    F.box(grD, grC - 1.5, 0.78, 0.80, 1.25, 2.5, 0x2f6b45);
    usable += presidentialUse(statePiece(F, "table", grD, grC + 3.2, F.latD, { len: 1.1, deep: 1.1, seats: 4, tone: "exec" }));
    usable += presidentialUse(statePiece(F, "sofa", D - 0.7, grC - 1.5, F.face(-1, 0), { len: 2.4, tone: "exec" }));
    stateChandelier(F, grD, grC - 1.5, 0.8, GR);
    presidentialRoom("stateprivate", "The Third Floor", h, r, usable, F.symbols, null, { solarium: soT });
    return stateOut(F);
  }

  /* ---- THE SEAL — the one textured mesh a room of state earns ---------------
     buildings_civic.js mints the branch seal as a canvas texture; a plate is
     one draw call that never merges, so there are three in the whole house
     (the Oval's carpet, the lectern, the briefing backdrop). They hang on a
     registered interior fixture group (the shell clamp only sees b.lbox).
     Degrade-safe: no THREE, no texture, no group, and the room still stands. */
  function platesRoot(h) {
    const T = window.THREE;
    const g = h && h.b && h.b.group;
    if (!T || !g || typeof g.add !== "function") return null;
    let root = g.__presidentPlates;
    if (root && root.parent === g) return root;
    root = new T.Group();
    root.name = "presidentPlates";
    g.add(root);
    g.__presidentPlates = root;
    if (CBZ.interiorTrackFixture)
      CBZ.interiorTrackFixture("president:" + Math.round(h.ox) + ":" + Math.round(h.oz), h.b, root, null);
    return root;
  }
  function sealTex() {
    try { return CBZ.civicSealTex ? CBZ.civicSealTex("federal") : null; } catch (e) { return null; }
  }
  // a seal plate at frame (d, l), height y over the floor. flat: lying on the
  // floor (face up); else standing, its face looking along (fd, fl).
  function stateSeal(F, d, l, y, size, flat, fd, fl) {
    const T = window.THREE, tex = sealTex();
    const root = tex ? platesRoot(F.h) : null;
    if (!root) return 0;
    const p = F.P(d, l);
    const m = new T.Mesh(new T.PlaneGeometry(size, size), new T.MeshBasicMaterial({ map: tex, transparent: true }));
    m.position.set(p.x, F.Y + y, p.z);
    if (flat) { m.rotation.x = -Math.PI / 2; m.rotation.z = F.face(1, 0); }
    else m.rotation.y = F.face(fd || 0, fl || 0);
    m.castShadow = false; m.receiveShadow = false;
    m.renderOrder = 3;
    root.add(m);
    F.symbols++;
    return 1;
  }

  /* ========================================================================
     THE WEST WING, GROUND FLOOR. The wing's door opens into its LOBBY; a
     corridor runs the length of the wing to the stair. North of it the
     CABINET ROOM, south the PRESS BRIEFING ROOM, and at the far end, behind
     the podium's wall, the press secretary's office.
     ======================================================================== */
  function progCabinetRoom(r, h, opts) {
    armStateFit();
    shell(h, r);
    const F = stateFrame(h, r);
    if (F.D < 26 || F.W < 16) return stateFallback(F, "cabinetroom", "Cabinet Room");
    const HW = F.half, D = F.D;
    const core = stateCore(F);
    const coreD0 = core ? core.d0 : D - 7.5, coreL0 = core ? core.l0 : HW - 4.5;
    let dLob = stateSnap(F, "l+", 6.6); dLob = stateSnap(F, "l-", dLob);
    const dCab1 = stateSnap(F, "l+", Math.min(22.8, coreD0 - 2.9));
    const dP1 = stateSnap(F, "l-", Math.min(26.5, coreD0 + 0.8));
    const LC = 1.6;                                        // the corridor's half width
    let mouthL = coreL0 + 2.3;
    if (F.mouths.length) mouthL = (F.mouths[0].l0 + F.mouths[0].l1) / 2;
    let usable = 0;
    // ---- walls
    stateWall(F, "d", dLob, -HW, HW, [
      { c: 0, w: 2 * LC - 0.7, leaf: false, h: 3.0, grand: true },
      { c: -(LC + HW) / 2, w: 1.7, leaf: true, swing: 1, grand: true, label: "the briefing room" },
      { c: (LC + HW) / 2, w: 1.7, leaf: true, swing: 1, grand: true, label: "the Cabinet Room" },
    ]);
    stateWall(F, "l", LC, dLob, dCab1, [{ c: dCab1 - 3.4, w: 1.1, leaf: true, swing: 1, label: "the Cabinet Room" }]);
    stateWall(F, "l", -LC, dLob, dP1, [{ c: dLob + 2.4, w: 1.2, leaf: true, swing: -1, label: "the briefing room" }]);
    stateWall(F, "d", dCab1, LC, HW, []);
    stateWall(F, "d", dP1, -HW, coreL0, [{ c: 0, w: 1.1, leaf: true, swing: 1, label: "the press office" }]);
    if (core) {
      F.walls.push({ axis: "d", at: coreD0, from: coreL0, to: HW, t: 0, ops: [{ c: mouthL, w: 1.6, h: 2.3 }] });
      F.walls.push({ axis: "l", at: coreL0, from: coreD0, to: D, t: 0, ops: [] });
    }
    // ---- rooms
    const LO = stateRoom(F, { key: "wwlobby", name: "West Wing Lobby", d0: 0, d1: dLob, l0: -HW, l1: HW, floor: SP.marble, drape: SP.navy });
    const CO = stateRoom(F, { key: "wwcorridor", name: "West Wing Corridor", d0: dLob, d1: dP1, l0: -LC, l1: LC, floor: SP.oak });
    const CR = stateRoom(F, { key: "cabinetroom", name: "Cabinet Room", d0: dLob, d1: dCab1, l0: LC, l1: HW, floor: SP.oak, drape: SP.rugGold, wains: SP.cream });
    const SL = stateRoom(F, { key: "wwstair", name: "Stair Hall", d0: dCab1, d1: dP1, l0: LC, l1: HW, floor: SP.marble });
    const PR = stateRoom(F, { key: "pressroom", name: "Press Briefing Room", d0: dLob, d1: dP1, l0: -HW, l1: -LC, floor: SP.navy, drape: SP.navy, closed: true, rail: null, skirt: SP.black });
    const PO = stateRoom(F, { key: "pressoffice", name: "Press Office", d0: dP1, d1: D, l0: -HW, l1: coreL0, floor: SP.oak, drape: SP.blue });

    // ---- LOBBY
    const loC = dLob / 2;
    stateRug(F, loC, F.doorL, dLob - 1.4, 3.2, SP.rugBlue, SP.rugGold, 0.18);
    stateChandelier(F, loC, F.doorL, 1.0, LO);
    usable += presidentialUse(statePiece(F, "desk", loC + 0.2, (LC + HW) / 2, F.face(-1, 0), { len: 1.8, tone: "exec" }));
    usable += presidentialUse(statePiece(F, "sofa", loC, -HW + 0.55, F.face(0, 1), { len: 2.3, tone: "exec" }));
    presidentialPiece("coffee", r, h, F.P(loC, -HW + 1.85).x, F.P(loC, -HW + 1.85).z, F.latD, { len: 1.2, deep: 0.6, tone: "exec" });
    for (const e of [-1, 1]) usable += presidentialUse(statePiece(F, "armchair", loC + e * 1.35, -HW + 2.9, F.face(0, -1), { tone: "exec" }));
    for (const e of [-1, 1]) statePiece(F, "planter", 0.9, F.doorL + e * 2.2, 0, { kind: "tree" });
    for (const l of [-3.4, 3.4, -HW + 1.5, HW - 1.5]) if (Math.abs(l) > 2.0 && Math.abs(Math.abs(l) - (LC + HW) / 2) > 1.4) statePainting(F, "d", dLob - ST_T / 2, l, -1, 1.35, 2.75, 1.1, 0x3a3b4a);

    // ---- CORRIDOR
    stateRug(F, (dLob + dP1) / 2, 0, dP1 - dLob - 1.2, 1.9, SP.rugRed, SP.rugGold, 0.12);
    for (const dd of [dLob + 4.5, (dLob + dP1) / 2 + 3.5]) stateDome(F, dd, 0, CO);

    // ---- CABINET ROOM: one long table, twenty chairs, the fireplace at its end
    const cabC = (LC + HW) / 2, cabD = (dLob + dCab1) / 2;
    stateRug(F, cabD, cabC, Math.min(13.4, dCab1 - dLob - 1.6), HW - LC - 1.6, SP.rugBlue, SP.rugGold, 0.3);
    const ctab = statePiece(F, "table", cabD, cabC, F.latD, { len: Math.min(10.2, dCab1 - dLob - 4.6), deep: 1.55, seats: 20, tone: "exec" });
    usable += presidentialUse(ctab);
    stateCoffers(F, dLob, dCab1, LC, HW, 3.4);
    stateChandelier(F, cabD - 3.6, cabC, 1.0, CR);
    stateChandelier(F, cabD + 3.6, cabC, 1.0, CR);
    const cfire = stateFireplace(F, "d", dCab1 - ST_T / 2, cabC, -1, { canvas: 0x3a3b4a });
    for (const e of [-1, 1]) stateStandard(F, dCab1 - 0.7, cabC + e * 2.3, e < 0 ? SP.blue : SP.red, false, e);
    for (const dd of [dLob + 3.0, cabD]) {
      if (Math.abs(dd - (dCab1 - 3.4)) < 1.6) continue;
      statePainting(F, "l", LC + ST_T / 2, dd, 1, 1.3, 2.7, 1.1, 0x4a3a33);
      statePiece(F, "credenza", dd, LC + ST_T / 2 + 0.3, F.face(0, 1), { len: 2.0, h: 0.85, tone: "exec" });
    }
    // the Bureau folio on the table, at the President's place
    const folio = F.P(cabD, cabC - 0.42);
    F.box(cabD, cabC - 0.42, 0.74, 0.765, 0.36, 0.5, SP.red);
    presidentialProp("cabinet-bureau", "Authorize", "bureau", h, r, folio);

    // ---- STAIR HALL
    usable += presidentialUse(statePiece(F, "bench", dCab1 + 1.3, HW - 0.5, F.face(0, -1), { len: 1.8, tone: "exec" }));
    stateDome(F, (dCab1 + coreD0) / 2, (LC + HW) / 2, SL);

    // ---- PRESS BRIEFING ROOM
    // the stage: two 18 cm risers onto a navy dais across the room's end, both
    // REGISTERED walk platforms (the drawn top is the top you stand on)
    const prC = (-HW - LC) / 2;
    const s1 = dP1 - ST_T / 2, s0 = s1 - 3.0;
    const sl0 = -HW, sl1 = -LC - ST_T / 2;
    F.box((s0 + s1) / 2, (sl0 + sl1) / 2, 0, 0.36, s1 - s0, sl1 - sl0, SP.navy, { cast: false, plat: true });
    F.box(s0 - 0.21, (sl0 + sl1) / 2, 0, 0.18, 0.42, sl1 - sl0, SP.navy, { cast: false, plat: true });
    F.box(s0 + 0.01, (sl0 + sl1) / 2, 0.34, 0.36, 0.04, sl1 - sl0, SP.gold);                   // nosings
    F.box(s0 - 0.41, (sl0 + sl1) / 2, 0.16, 0.18, 0.04, sl1 - sl0, SP.gold);
    // the backdrop: blue, a darker oval panel, the seal. No lettering.
    F.box(s1 - 0.03, prC, 0.36, F.CL - 0.4, 0.04, sl1 - sl0 - 0.4, SP.blue);
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5 * 2 - 1, half = Math.sqrt(1 - t * t);
      F.box(s1 - 0.06, prC, 0.9 + (i / 5) * 2.2, 0.9 + ((i + 1) / 5) * 2.2, 0.02, Math.max(0.8, half * 5.0), SP.navy);
    }
    stateSeal(F, s1 - 0.085, prC, 2.0, 1.2, false, -1, 0);
    F.box(s1 - 0.1, prC, F.CL - 0.4, F.CL - 0.2, 0.2, sl1 - sl0 - 0.2, SP.lamp, { emissive: SP.lamp, ei: 0.7, cast: false });   // the lit pelmet
    F.lights++;
    // the lectern
    const podD = s0 + 1.1;
    F.box(podD, prC, 0.36, 1.44, 0.55, 0.78, SP.walnut, SOLID);
    F.box(podD - 0.02, prC, 1.44, 1.50, 0.62, 0.86, SP.walnut);
    F.box(podD - 0.28, prC, 0.46, 1.34, 0.02, 0.62, SP.navy);
    stateSeal(F, podD - 0.30, prC, 1.02, 0.5, false, -1, 0);
    F.box(podD + 0.05, prC, 1.50, 1.56, 0.04, 0.3, SP.black);                                 // microphones' bar
    for (const e of [-1, 1]) F.box(podD - 0.15, prC + e * 0.12, 1.50, 1.75, 0.02, 0.02, SP.black);
    for (const e of [-1, 1]) stateStandard(F, s0 + 2.2, prC + e * 2.3, e < 0 ? SP.blue : SP.red, false, e);
    // the seats: seven rows of seven, facing the lectern, an aisle along the
    // corridor wall where the doors are
    const row0 = dLob + 3.4, nRows = Math.max(1, Math.min(7, Math.floor((s0 - 2.2 - row0) / 1.05) + 1));
    let seats = 0;
    for (let i = 0; i < nRows; i++) for (let j = 0; j < 7; j++) {
      const l = -HW + 0.75 + j * 0.8;
      if (l > -LC - 2.4) break;
      const rec = statePiece(F, "chair", row0 + i * 1.05, l, F.face(1, 0), { tone: "cool", solid: false });
      seats += presidentialUse(rec);
    }
    usable += seats;
    // the cameras on the back row, and a light over the lectern
    for (let j = 0; j < 3; j++) {
      const l = -HW + 1.0 + j * 1.6, dd = dLob + 1.5;
      F.box(dd, l, 0, 0.03, 0.62, 0.06, SP.black);
      F.box(dd, l, 0, 0.03, 0.06, 0.62, SP.black);
      F.box(dd, l, 0.03, 1.45, 0.05, 0.05, SP.black);
      F.box(dd, l, 1.45, 1.72, 0.42, 0.2, 0x2a2f37);
    }
    for (const dd of [row0 + 1.5, row0 + 4.6]) {
      const m = F.box(dd, prC, F.CL - 0.08, F.CL, 0.3, 6.0, P.light, { emissive: P.light, ei: 0.6, cast: false });
      if (m) { ceilingStrip(m); F.lights++; }
      const p = F.P(dd, prC);
      F.fitLights.push({ x: p.x, z: p.z, r: 5.5, i: 0.7, rect: PR.rectL });
    }
    const podP = F.P(podD, prC);
    F.fitLights.push({ x: podP.x, z: podP.z, r: 4.5, i: 0.9, rect: PR.rectL });

    // ---- PRESS OFFICE
    const poC = (-HW + coreL0) / 2;
    usable += presidentialUse(statePiece(F, "desk", (dP1 + D) / 2 + 0.6, poC - 2.5, F.face(-1, 0), { len: 1.6, tone: "exec" }));
    usable += presidentialUse(statePiece(F, "sofa", (dP1 + D) / 2, coreL0 - ST_T / 2 - 0.5, F.face(0, -1), { len: 2.2, tone: "exec" }));
    stateBookcase(F, "d", dP1 + ST_T / 2, poC - 5.2, 1, 2.2, 2.4);
    stateDome(F, (dP1 + D) / 2, poC, PO);

    // ---- THE PRESS CORPS. A seat of government has a press pool in its
    // briefing room; the program publishes where they stand and posts them
    // through citystaff directly (CBZ.interiorPeople shares a city-wide cap
    // and would drop exactly these rows). president_regime.js clears or
    // restores the pool through CBZ.presidentInteriorPressSet.
    const pressJobs = [];
    const posts = [[row0 + 0.5, -LC - 1.2], [row0 + 2.6, -LC - 1.2], [row0 + 4.7, -LC - 1.2], [dLob + 0.8, -HW + 3.4], [dLob + 0.8, -HW + 5.8]];
    for (let i = 0; i < posts.length; i++) {
      const q = posts[i];
      const pp = F.P(q[0], q[1]);
      if (!F.h.clear(pp.x, pp.z, 0.35)) continue;
      const rec = { x: h.ox + pp.x, z: h.oz + pp.z, yaw: F.face(1, 0) };
      PRESIDENTIAL.press.push(rec);
      pressJobs.push({
        x: rec.x, z: rec.z, face: rec.yaw,
        job: "press correspondent", archetype: "worker", pose: "foldarms",
        opts: { wealth: 0.35, aggr: 0.05, armed: false, outfit: 0x2f3640, floorY: F.Y },
        near: 60, far: 110,
      });
    }
    PRESIDENTIAL.pressJobs = pressJobs;
    postPressCorps(!(CBZ.presidentRegime && CBZ.presidentRegime.pressAllowed) || CBZ.presidentRegime.pressAllowed());

    const entry = F.P(0, F.doorL);
    presidentialRoom("cabinetroom", "Cabinet Room", h, { x0: CR.rectL.x0, x1: CR.rectL.x1, z0: CR.rectL.z0, z1: CR.rectL.z1, y: r.y }, usable, F.symbols,
      { x: entry.x, z: entry.z, nx: F.nx, nz: F.nz, tx: F.tx, tz: F.tz, depth: D, span: F.W }, {
        cabinetTable: F.P(cabD, cabC),
        fireplace: cfire,
        bureauFolio: folio,
        lobby: F.P(loC, 0),
      });
    presidentialRoom("pressroom", "Press Briefing Room", h, { x0: PR.rectL.x0, x1: PR.rectL.x1, z0: PR.rectL.z0, z1: PR.rectL.z1, y: r.y }, seats, 0, null, {
      podium: Object.assign(F.P(podD, prC), { y: 0.36 }),
      pressPen: F.P(row0 + 2.6, -LC - 1.2),
    });
    return stateOut(F);
  }

  // THE RESOLUTE DESK: a partners' desk of dark timber, two pedestals, the
  // carved kneehole panel on the visitor's side with the seal in brass, a
  // leather writing surface; the high-backed chair behind it is a registered
  // seat (the throne), square to the desk. Worktop at 0.76.
  const RESOLUTE_TOP = 0.76, THRONE_BACK = 1.12;
  function stateResoluteDesk(F, d, l) {
    const L = 1.83, DD = 1.1;
    for (const e of [-1, 1]) {
      F.box(d, l + e * (L / 2 - 0.3), 0, 0.06, DD - 0.16, 0.50, 0x2a1a14);                        // recessed kick
      F.box(d, l + e * (L / 2 - 0.3), 0.06, RESOLUTE_TOP - 0.06, DD - 0.1, 0.56, SP.mahog, SOLID);
      for (let k = 0; k < 3; k++) F.box(d + DD / 2 - 0.03, l + e * (L / 2 - 0.3), 0.16 + k * 0.18, 0.19 + k * 0.18, 0.02, 0.2, SP.gold);
    }
    F.box(d + DD / 2 - 0.08, l, 0.08, RESOLUTE_TOP - 0.1, 0.06, L - 1.2, SP.mahog, SOLID);          // kneehole panel
    F.box(d + DD / 2 - 0.045, l, 0.24, 0.56, 0.01, 0.32, SP.gold);                                   // the seal, in brass
    F.box(d, l, RESOLUTE_TOP - 0.06, RESOLUTE_TOP, DD + 0.1, L + 0.1, SP.mahog, SOLID);             // top
    F.box(d - 0.1, l, RESOLUTE_TOP, RESOLUTE_TOP + 0.004, 0.62, 1.2, SP.green);                      // leather
    // the chair
    const t = d - THRONE_BACK;
    F.box(t, l, 0.01, 0.05, 0.62, 0.07, SP.black);                                                // the star foot
    F.box(t, l, 0.01, 0.05, 0.07, 0.62, SP.black);
    F.box(t, l, 0.05, 0.42, 0.10, 0.10, SP.black);
    F.box(t, l, 0.42, 0.50, 0.62, 0.64, SP.leather);
    F.box(t - 0.28, l, 0.50, 1.34, 0.12, 0.64, SP.leather);
    for (const e of [-1, 1]) F.box(t, l + e * 0.32, 0.50, 0.68, 0.48, 0.08, SP.leather);
    const p = F.P(t, l);
    seatReg(F.h, p.x, F.Y, p.z, F.face(1, 0), "throne", 0.50);
    return { desk: F.P(d, l), throne: p };
  }

  /* ========================================================================
     THE WEST WING, UPPER FLOOR — THE PRESIDENT'S OFFICE.
     The service stair lands at the end of a corridor that runs the length
     of the wing. Off it: the chief of staff's office, the outer office where
     the President's secretaries sit, and the OVAL OFFICE — an oval of
     panelled wall inside its rectangle, the Resolute desk at the east end in
     front of three tall windows with the standards behind it, two sofas
     facing across a low table, and at the west end the fireplace with two
     armchairs. A private study and dining room open off it to the south.
     ======================================================================== */
  function progOvalOffice(r, h, opts) {
    armStateFit();
    shell(h, r);
    const F = stateFrame(h, r);
    const HW = F.half, D = F.D;
    const core = stateCore(F);
    const coreD0 = core ? core.d0 : D - 7.5, coreL0 = core ? core.l0 : HW - 4.5;
    const lCor = Math.max(-HW + 12, stateSnap(F, "d0", HW - 4.0));
    const dOut = stateSnap(F, "l-", Math.min(12.47, D * 0.38));
    const dChief = stateSnap(F, "l-", Math.min(20.73, coreD0 - 5.0));
    const lOvS = stateSnap(F, "d0", Math.max(-HW + 5.0, lCor - 10.8));
    const dStudy = stateSnap(F, "l-", dOut / 2);
    if (F.D < 26 || F.W < 16 || dOut < 9 || lCor - lOvS < 8) return stateOfficeFallback(F);
    let usable = 0;
    // ---- walls
    const outC = (dOut + dChief) / 2, chC = (dChief + Math.min(coreD0, D)) / 2;
    const dc = dOut / 2, lc = (lOvS + lCor) / 2;
    const A = Math.min(5.45, dOut / 2 - 0.55), B = Math.min(4.4, (lCor - lOvS) / 2 - 0.6);
    const doorOO = lc + Math.min(2.4, B * 0.55);             // the outer office's door into the oval
    const doorST = dc - Math.min(2.8, A * 0.52);              // the study's
    // the corridor wall runs to the core (whose own wall carries on past it)
    stateWall(F, "l", lCor, 0, core && core.l0 < lCor + 0.3 ? coreD0 : D, [
      { c: dc, w: 1.2, leaf: true, swing: 1, label: "the Oval Office" },
      { c: outC, w: 1.3, leaf: true, swing: -1, label: "the outer office" },
      { c: chC, w: 1.1, leaf: true, swing: -1, label: "the chief of staff's office" },
    ]);
    stateWall(F, "d", dOut, -HW, lCor, [
      { c: doorOO, w: 1.2, leaf: true, swing: 1, label: "the Oval Office" },
      { c: (-HW + lOvS) / 2 + 1.5, w: 1.0, leaf: true, swing: -1, label: "the dining room" },
    ]);
    stateWall(F, "l", lOvS, 0, dOut, [{ c: doorST, w: 1.1, leaf: true, swing: -1, label: "the study" }]);
    stateWall(F, "d", dStudy, -HW, lOvS, [{ c: -HW + 1.1, w: 0.9, leaf: true, swing: 1, label: "the dining room" }]);
    stateWall(F, "d", dChief, -HW, lCor, []);
    if (core && core.l0 > lCor + 0.05) F.box(coreD0 - ST_T / 2 - 0.01, (lCor + core.l0) / 2, 0, F.CL, ST_T, core.l0 - lCor, SP.ivory, SOLID);   // close the slot behind the core
    if (core) F.walls.push({ axis: "d", at: coreD0, from: lCor, to: HW, t: 0, ops: [{ c: F.mouths.length ? (F.mouths[0].l0 + F.mouths[0].l1) / 2 : (coreL0 + HW) / 2, w: 1.6, h: 2.3 }] });
    // ---- the oval's rectangle: a floor and a ceiling; its walls are behind the curve
    stateField(F, 0, dOut, lOvS, lCor, SP.oak);
    const OR = F.rect(0, dOut, lOvS, lCor);
    F.fitRooms.push({ x0: OR.x0, x1: OR.x1, z0: OR.z0, z1: OR.z1, tint: 0xf6f1e6 });
    const ovRoom = { rectL: OR };
    // ---- rooms round it
    const CO = stateRoom(F, { key: "wwhall", name: "West Wing Corridor", d0: 0, d1: Math.min(coreD0, D), l0: lCor, l1: HW, floor: SP.oak, drape: SP.navy });
    const OO = stateRoom(F, { key: "outeroffice", name: "Outer Oval Office", d0: dOut, d1: dChief, l0: -HW, l1: lCor, floor: SP.oak, drape: SP.rugGold });
    const CS = stateRoom(F, { key: "chiefofstaff", name: "Chief of Staff's Office", d0: dChief, d1: D, l0: -HW, l1: lCor, floor: SP.oak, drape: SP.blue, wains: SP.walnut });
    const STY = stateRoom(F, { key: "presstudy", name: "The President's Study", d0: 0, d1: dStudy, l0: -HW, l1: lOvS, floor: SP.oak, drape: SP.green, wains: SP.walnut });
    const PD = stateRoom(F, { key: "presdining", name: "Private Dining Room", d0: dStudy, d1: dOut, l0: -HW, l1: lOvS, floor: SP.oak, drape: SP.red });

    // ---- THE OVAL
    const N = 37, step = 2 * Math.PI / N;
    stateOval(F, {
      dc: dc, lc: lc, A: A, B: B, n: N, col: SP.cream, wains: SP.cream, sill: 0.75, head: Math.min(F.CL - 0.55, 3.2),
      doors: [
        { dir: "l+", c: dc, w: 1.2, to: lCor - ST_T / 2 },
        { dir: "d+", c: doorOO, w: 1.2, to: dOut - ST_T / 2 },
        { dir: "l-", c: doorST, w: 1.1, to: lOvS + ST_T / 2 },
      ],
      windows: [Math.PI, Math.PI - 3 * step, Math.PI + 3 * step],
    });
    // the carpet: an oval in slices, blue with a gold border, the seal at its heart
    const ra = A - 0.75, rb = B - 0.65, ns = 11;
    for (let i = 0; i < ns; i++) {
      const t = (i + 0.5) / ns * 2 - 1, half = rb * Math.sqrt(1 - t * t), dd = dc + t * ra, sd = 2 * ra / ns;
      if (i === 0 || i === ns - 1 || half < 0.9) { F.box(dd, lc, FIELD_T, RUG_T, sd, half * 2, SP.rugGold); continue; }
      F.box(dd, lc, FIELD_T, RUG_T, sd, half * 2 - 0.56, SP.rugBlue);
      for (const e of [-1, 1]) F.box(dd, lc + e * (half - 0.14), FIELD_T, RUG_T, sd, 0.28, SP.rugGold);
    }
    stateSeal(F, dc, lc, RUG_T + 0.0005, 1.7, true);
    // the desk, the chair, the standards behind it
    const deskD = dc - A + 2.25;
    const RD = stateResoluteDesk(F, deskD, lc);
    for (const e of [-1, 1]) stateStandard(F, deskD - THRONE_BACK - 0.1, lc + e * 1.85, e < 0 ? SP.blue : SP.red, false, -e);
    // two sofas facing across the low table, the fireplace and its two chairs
    const sofaD = dc + 0.6;
    const sofas = [];
    for (const e of [-1, 1]) {
      const s = statePiece(F, "sofa", sofaD, lc + e * 1.6, F.face(0, -e), { len: 2.3, tone: { cloth: 0xd9cfb4, wood: SP.mahog } });
      sofas.push(s); usable += presidentialUse(s);
    }
    const low = F.P(sofaD, lc);
    presidentialPiece("coffee", r, h, low.x, low.z, F.latD, { len: 1.4, deep: 0.7, tone: { wood: SP.mahog } });
    const fireAt = stateFireplace(F, "d", dc + A - 0.04, lc, -1, { canvas: 0x3a3b4a, w: 1.8 });
    for (const e of [-1, 1]) usable += presidentialUse(statePiece(F, "armchair", dc + A - 1.7, lc + e * 1.2, F.face(0, -e), { tone: { cloth: 0x9a7b3f } }));
    stateChandelier(F, dc, lc, 0.9, ovRoom);
    for (const e of [-1, 1]) statePiece(F, "planter", dc + A - 2.9, lc + e * (B - 1.3), 0, { kind: "tree", s: 0.9 });
    // the television, on the curve by the desk (president_office.js hangs it)
    const phiTV = 2.2, tvS = { d: dc + A * Math.cos(phiTV), l: lc + B * Math.sin(phiTV) };
    const inw = { d: dc - tvS.d, l: lc - tvS.l }, inl = Math.hypot(inw.d, inw.l) || 1;
    const tv = F.P(tvS.d + inw.d / inl * 0.02, tvS.l + inw.l / inl * 0.02);
    const tvBack = F.P(tvS.d - inw.d / inl * 0.6, tvS.l - inw.l / inl * 0.6);

    // ---- OUTER OFFICE: two secretaries' desks, a sofa for whoever is waiting
    const ooC = (-HW + lCor) / 2;
    const secDesk = F.P(dOut + 2.3, lc);
    usable += presidentialUse(statePiece(F, "desk", dOut + 2.3, lc, F.face(-1, 0), { len: 1.5, tone: "exec" }));
    usable += presidentialUse(statePiece(F, "desk", dChief - 2.4, ooC - 1.5, F.face(-1, 0), { len: 1.5, tone: "exec" }));
    usable += presidentialUse(statePiece(F, "sofa", outC, -HW + 0.55, F.face(0, 1), { len: 2.3, tone: "exec" }));
    presidentialPiece("coffee", r, h, F.P(outC, -HW + 1.85).x, F.P(outC, -HW + 1.85).z, F.latD, { len: 1.1, deep: 0.6, tone: "exec" });
    stateBookcase(F, "d", dChief - ST_T / 2, lc - 1.0, -1, 2.4, 2.4);
    stateDome(F, outC, ooC, OO);

    // ---- CHIEF OF STAFF
    const csC = (-HW + lCor) / 2;
    usable += presidentialUse(statePiece(F, "desk", D - 2.9, csC + 1.0, F.face(-1, 0), { len: 1.8, tone: "exec" }));
    usable += presidentialUse(statePiece(F, "table", dChief + 4.2, -HW + 3.5, F.latD, { len: 2.4, deep: 1.1, seats: 6, tone: "exec" }));
    usable += presidentialUse(statePiece(F, "sofa", dChief + 4.6, lCor - ST_T / 2 - 0.5, F.face(0, -1), { len: 2.2, tone: "exec" }));
    stateBookcase(F, "d", dChief + ST_T / 2, csC + 1.0, 1, 2.6, 2.5);
    stateDome(F, dChief + 3.5, csC, CS);
    stateDome(F, D - 3.0, csC, CS);

    // ---- STUDY and PRIVATE DINING
    const stC = (-HW + lOvS) / 2;
    usable += presidentialUse(statePiece(F, "desk", dStudy - 1.3, stC - 0.4, F.face(-1, 0), { len: 1.4, tone: "exec" }));
    usable += presidentialUse(statePiece(F, "armchair", 1.4, stC - 1.0, F.face(1, 0), { tone: "warm" }));
    statePiece(F, "credenza", dStudy - 0.9, lOvS - ST_T / 2 - 0.3, F.face(0, -1), { len: 1.2, tone: "exec" });
    stateDome(F, dStudy / 2, stC, STY);
    const pdD = (dStudy + dOut) / 2;
    usable += presidentialUse(statePiece(F, "table", pdD, stC, F.latD, { len: 2.0, deep: 1.0, seats: 6, tone: "warm" }));
    statePiece(F, "credenza", dOut - ST_T / 2 - 0.3, -HW + 2.4, F.face(-1, 0), { len: 1.6, tone: "warm" });
    stateChandelier(F, pdD, stC, 0.8, PD);

    // ---- CORRIDOR
    const coC = (lCor + HW) / 2;
    stateRug(F, (Math.min(coreD0, D) - 1.6) / 2 + 0.3, coC, Math.min(coreD0, D) - 2.8, 2.0, SP.rugRed, SP.rugGold, 0.12);
    for (const dd of [4.0, Math.min(coreD0, D) / 2, Math.min(coreD0, D) - 4.0]) stateDome(F, dd, coC, CO);
    usable += presidentialUse(statePiece(F, "bench", (dc + outC) / 2, lCor + ST_T / 2 + 0.35, F.face(0, 1), { len: 2.0, tone: "exec" }));

    // ---- the office's frame: in at the outer office door, looking at the desk
    const ovEntry = F.P(dc + A, lc);
    const n = { x: -F.nx, z: -F.nz };
    const room = presidentialRoom("ovaloffice", "The Oval Office", h, r, usable + 2, F.symbols, {
      x: ovEntry.x, z: ovEntry.z, nx: n.x, nz: n.z, tx: -n.z, tz: n.x, depth: 2 * A, span: 2 * B,
    }, {
      arrivalPortal: F.P(dOut, doorOO),
      presidentialDesk: RD.desk,
      throne: RD.throne,
      visitorSofa: sofas[0] ? F.P(sofaD, lc - 1.6) : null,
      visitorTable: low,
      stateSeal: F.P(dc, lc),
      fireplace: F.P(dc + A - 0.9, lc),
      securePhone: F.P(deskD, lc - 0.55),
      pardonFolder: F.P(deskD, lc + 0.55),
      tv: tv, tvBack: tvBack,
      staffDoor: F.P(dc + A - 2.0, doorOO - 0.1),
      // the staff's aisle from that door to the line: across the room between
      // the sofas' far ends and the fireside armchairs, clear of the planters
      // (president_staff.js threads it; a straight walk hit the sofa)
      staffAisle0: F.P(dc + Math.max(1.9, A - 2.9), lc + Math.min(1.9, B - 1.6)),
      staffAisle1: F.P(dc + Math.max(1.9, A - 2.9), lc - Math.min(1.9, B - 1.6)),
      chiefSpot: F.P(dc - 1.8, lc - 2.4),
      line0: F.P(dc - 0.6, lc - 2.95),
      line1: F.P(dc + 0.6, lc - 2.95),
      line2: F.P(dc + 1.8, lc - 2.8),
      pressSpot: F.P(dc - 1.8, lc + 2.4),
      secretaryDesk: secDesk,
      secretaryPost: F.P(dOut + 3.2, lc + 1.0),
    });
    room.deskTop = RESOLUTE_TOP;
    presidentialProp("oval-address", "Address", "address", h, r, F.P(deskD, lc - 0.55));
    presidentialProp("oval-pardon", "Pardon", "pardon", h, r, F.P(deskD, lc + 0.55));
    presidentialRoom("outeroffice", "Outer Oval Office", h, { x0: OO.rectL.x0, x1: OO.rectL.x1, z0: OO.rectL.z0, z1: OO.rectL.z1, y: r.y }, 0, 0, null, { secretary: secDesk });
    presidentialRoom("chiefofstaff", "Chief of Staff's Office", h, { x0: CS.rectL.x0, x1: CS.rectL.x1, z0: CS.rectL.z0, z1: CS.rectL.z1, y: r.y }, 0, 0, null, {});
    return stateOut(F);
  }
  // an office on a plate the plan above does not fit: still a room with a
  // desk the President can be seated at, and the frame the office code needs
  function stateOfficeFallback(F) {
    const room = stateRoom(F, { key: "ovaloffice", name: "The Oval Office", d0: 0, d1: F.D, l0: -F.half, l1: F.half, floor: SP.oak, drape: SP.blue });
    const deskD = 3.4;
    const RD = stateResoluteDesk(F, deskD, 0);
    stateChandelier(F, F.D / 2, 0, 1.0, room);
    // the frame looks from the far end toward the desk, so the chair (which
    // faces +d) is `THRONE_BACK` along the frame's direction from the desk
    const entry = F.P(F.D - 0.5, 0);
    const rec = presidentialRoom("ovaloffice", "The Oval Office", F.h, F.r, 1, F.symbols, {
      x: entry.x, z: entry.z, nx: -F.nx, nz: -F.nz, tx: F.nz, tz: -F.nx, depth: F.D - 0.5, span: F.W,
    }, { presidentialDesk: RD.desk, throne: RD.throne, arrivalPortal: F.P(F.D - 1.0, 0) });
    rec.deskTop = RESOLUTE_TOP;
    return stateOut(F);
  }

  CBZ.presidentInteriorRooms = function () {
    return PRESIDENTIAL.rooms.map(function (r) {
      const copy = Object.assign({}, r);
      copy.approach = r.approach ? Object.assign({}, r.approach) : null;
      copy.landmarks = {};
      Object.keys(r.landmarks || {}).forEach(function (key) {
        copy.landmarks[key] = Object.assign({}, r.landmarks[key]);
      });
      return copy;
    });
  };
  CBZ.presidentInteriorProps = function () { return PRESIDENTIAL.props.map(function (r) { return Object.assign({}, r); }); };
  /* THE PRESS CORPS' STANDING SPOTS, in WORLD coords. progStateHall already
     posts these through citystaff (CBZ.interiorPeople), because a seat of
     state has a press pool in its hall whoever is sitting in the chair — this
     file owns the room, never the politics. The list is published so the file
     that DOES own the politics (presidency.js) can move, add to or clear them
     when the regime changes, without re-deriving a single coordinate. */
  function postPressCorps(allowed) {
    const jobs = PRESIDENTIAL.pressJobs || [];
    if (!CBZ.cityStaffPost || !CBZ.cityStaffVenue) return 0;
    CBZ.cityStaffVenue("president", { stations: jobs.length, note: allowed ? "press corps in the State Entrance Hall" : "press pool cleared by the regime" });
    if (!allowed) return 0;
    let n = 0;
    for (let i = 0; i < jobs.length; i++) {
      try { if (CBZ.cityStaffPost(Object.assign({ venue: "president", id: "president:press:" + i }, jobs[i]))) n++; }
      catch (e) {}
    }
    PRESIDENTIAL.pressPosted = allowed;
    return n;
  }
  // regime -> hall: post the press pool or clear it. Idempotent.
  CBZ.presidentInteriorPressSet = function (allowed) {
    allowed = !!allowed;
    if (PRESIDENTIAL.pressPosted === allowed) return PRESIDENTIAL.pressJobs ? PRESIDENTIAL.pressJobs.length : 0;
    return postPressCorps(allowed);
  };
  CBZ.presidentInteriorPressPoints = function () {
    return PRESIDENTIAL.press.map(function (p) { return { x: p.x, z: p.z, yaw: p.yaw }; });
  };
  CBZ.presidentInteriorAudit = function () {
    return {
      namedRooms: PRESIDENTIAL.rooms.length,
      usableProps: PRESIDENTIAL.usable,
      stateSymbols: PRESIDENTIAL.symbols,
      emptyDecor: PRESIDENTIAL.emptyDecor,
      roomNames: PRESIDENTIAL.rooms.map(function (r) { return r.name; }),
      orderProps: PRESIDENTIAL.props.map(function (r) { return r.key; }),
    };
  };

  // ========================================================================
  //  FEDERAL ROOMS — the Bureau and the Defence Headquarters.
  //
  //    securitylobby  a guarded arrival: screening (x-ray belt, two walk-
  //                   through arches, a bag table), a manned security desk,
  //                   and a turnstile line that runs WALL TO WALL, so the
  //                   only way into the building is through a lane
  //    opscenter      a watch floor: an enclosed room, a video wall on the
  //                   far wall, console rows facing it, a watch officer's
  //                   desk at the back, a dark ceiling with linear lights
  //    briefingroom   a real room off the plate with one door: a long table,
  //                   chairs on both sides and along the walls, a lectern and
  //                   a screen at the head, standards either side
  //    directorsuite  the man at the top: a suite behind a door, an outer
  //                   office with his assistant and a waiting group, then his
  //                   own office (desk, sitting group, credenza, standards)
  //
  //  THE FLOOR LAW, which every piece below obeys: furniture, bases and walls
  //  stand AT the storey's walk surface (r.y); the only finishes this section
  //  lays are rugs/mats 1.5 cm thick whose bottom sits 5 mm over it, so their
  //  top is 2 cm over the surface a body stands on. Nothing here is raised, so
  //  no platform is owed. Every counter, console row, barrier and wall that a
  //  body would walk into is `solid`; the turnstile lanes are 0.95 m clear, so
  //  a 0.38 m body passes and nothing else does. No text anywhere: screens are
  //  light, not words; no plaques, no seals, no signs.
  //  Emissive boxes are the one thing core/batch.js cannot merge, so each room
  //  spends a handful (the linear lights, the video wall, the uplights) and
  //  registers every one with the day ramp.
  // ========================================================================
  const FED = {
    ceilTile: 0xc9ccd2,        // P.worktop's bucket: pale acoustic tile
    ceilDark: 0x2a2f37,        // P.chair's bucket: the watch floor's black ceiling
    carpet: 0x3d4650,          // P.sofa's bucket: carpet tile
    mat: 0x14181e,             // P.bezel's bucket: entrance matting
    frost: 0xb9bcc4,           // P.wall's bucket: frosted glass balustrade panels
    steel: 0x8a939c,           // P.shelf's bucket: brushed steel
    navy: 0x2c3e6b,            // standards' cloth (govcomplex's flag blue)
  };
  // one approach frame + the storey's real ceiling + a bottom-based box, so a
  // program authors "stands on the floor" as yb = 0 and never types a centre.
  function fedFrame(r, h, opts) {
    const A = approach(r, h, opts);
    const k = floorIndexOf(r, h);
    // the slab over this storey is poured (k+1)*FH-0.2 .. (k+1)*FH, so the
    // ceiling plane is its underside, measured up from THIS floor's surface
    const ceil = Math.max(2.6, (k + 1) * h.fh - 0.20 - r.y);
    function B(p, yb, across, hh, deep, c, o) {
      o = o || {};
      if (!p || !inRect(r, p.x, p.z, o.edge == null ? 0.05 : o.edge)) return null;
      if (o.clear && !h.clear(p.x, p.z, o.clear)) return null;
      const lo = o.emit ? { emissive: o.emit, ei: o.ei || 0.6, cast: false } : { cast: false, solid: !!o.solid };
      return h.b.lbox(p.x, r.y + yb + hh / 2, p.z, A.along ? deep : across, hh, A.along ? across : deep, c, lo);
    }
    function lit(p, yb, across, hh, deep, c, ei) {
      const m = B(p, yb, across, hh, deep, c, { emit: c, ei: ei });
      if (m) ceilingStrip(m);
      return m ? 1 : 0;
    }
    // a rug/mat: THE FLOOR LAW's one allowed finish (bottom +5 mm, top +20 mm)
    function rug(d, l, across, deep, c) { return B(A.at(d, l), 0.005, across, 0.015, deep, c, { edge: 0.1 }); }
    function reserved(x, z, pad) {
      const L = (h.b.shaftRects || []).concat(h.b.keepRects || []);
      for (let i = 0; i < L.length; i++) {
        const q = L[i];
        if (x > q.x0 - pad && x < q.x1 + pad && z > q.z0 - pad && z < q.z1 + pad) return true;
      }
      return false;
    }
    // split a run [a,b] into the stretches whose points are clear of every
    // reserved footprint (stair core, its landing mouth, a lift chase): a wall
    // or a barrier never crosses the way up.
    function clearRuns(a, b, at) {
      const out = [], step = 0.25;
      let s0 = null;
      for (let t = a; t <= b + 1e-6; t += step) {
        const p = at(Math.min(t, b));
        const ok = !reserved(p.x, p.z, 0.45);
        if (ok && s0 == null) s0 = t;
        if (!ok && s0 != null) { if (t - step - s0 > 0.3) out.push([s0, t - step]); s0 = null; }
      }
      if (s0 != null && b - s0 > 0.3) out.push([s0, b]);
      return out;
    }
    // a doorway in a partition: jambs, head, and the leaf standing open against
    // the wall on the room side. `alongLat` = the wall runs laterally.
    function doorway(D, l, gw, alongLat, into) {
      const hd = 2.25, lf = Math.min(1.0, gw - 0.18);
      for (const s of [-1, 1]) {
        if (alongLat) B(A.at(D, l + s * (gw / 2 + 0.04)), 0, 0.08, hd, PWT + 0.05, FED.steel);
        else B(A.at(D + s * (gw / 2 + 0.04), l), 0, PWT + 0.05, hd, 0.08, FED.steel);
      }
      // the head, then a REAL door in the opening (it used to be a leaf
      // painted standing open against the wall: a door you could not shut),
      // hinged on the low jamb, swinging `into` the room, closed at first
      B(A.at(D, l), hd, alongLat ? gw + 0.16 : PWT + 0.05, 0.08, alongLat ? PWT + 0.05 : gw + 0.16, FED.steel);
      const c = A.at(D, l);
      if (!inRect(r, c.x, c.z, 0.05)) return;
      const runX = alongLat ? Math.abs(A.tx) > 0.5 : Math.abs(A.nx) > 0.5;
      const hinge = alongLat ? -Math.sign(runX ? A.tx : A.tz) : -Math.sign(runX ? A.nx : A.nz);
      const side = (alongLat ? Math.sign(runX ? A.nz : A.nx) : Math.sign(runX ? A.tz : A.tx)) * (into || 1);
      freeDoor(h, r.y, c.x, c.z, runX, Math.min(gw - 0.04, lf + 0.14), hd - 0.03, P.wood, hinge || -1, side || 1, "the door");
    }
    // SOLID partitions from the floor to the slab, each doorway cased.
    // wallLat: runs laterally at depth D from lat l0..l1; gaps are lateral centres.
    function wallLat(D, l0, l1, gaps, gw, into) {
      gw = gw || 1.2;
      const lo = Math.min(l0, l1), hi = Math.max(l0, l1);
      const cuts = (gaps || []).filter(function (g) { return g > lo + gw / 2 && g < hi - gw / 2; }).sort(function (a, b) { return a - b; });
      let a = lo;
      for (const g of cuts.concat([hi + gw])) {
        const b = Math.min(hi, g - gw / 2);
        if (b - a > 0.12) for (const q of clearRuns(a, b, function (t) { return A.at(D, t); })) {
          B(A.at(D, (q[0] + q[1]) / 2), 0, q[1] - q[0], ceil, PWT, P.wall, { solid: true, edge: -0.3 });
          B(A.at(D - (into || 1) * 0.1, (q[0] + q[1]) / 2), 0, q[1] - q[0], 0.10, 0.03, P.bezel, { edge: -0.3 });   // skirting
        }
        if (g <= hi) {
          B(A.at(D, g), 2.33, gw + 0.02, ceil - 2.33, PWT, P.wall, { solid: true, edge: -0.3 });  // over the door
          doorway(D, g, gw, true, into || 1);
        }
        a = g + gw / 2;
      }
    }
    // wallDep: runs along the depth at lateral l from depth d0..d1; gaps are depth centres.
    function wallDep(l, d0, d1, gaps, gw, into) {
      gw = gw || 1.2;
      const lo = Math.min(d0, d1), hi = Math.max(d0, d1);
      const cuts = (gaps || []).filter(function (g) { return g > lo + gw / 2 && g < hi - gw / 2; }).sort(function (a, b) { return a - b; });
      let a = lo;
      for (const g of cuts.concat([hi + gw])) {
        const b = Math.min(hi, g - gw / 2);
        if (b - a > 0.12) for (const q of clearRuns(a, b, function (t) { return A.at(t, l); })) {
          B(A.at((q[0] + q[1]) / 2, l), 0, PWT, ceil, q[1] - q[0], P.wall, { solid: true, edge: -0.3 });
          B(A.at((q[0] + q[1]) / 2, l - (into || 1) * 0.1), 0, 0.03, 0.10, q[1] - q[0], P.bezel, { edge: -0.3 });
        }
        if (g <= hi) {
          B(A.at(g, l), 2.33, PWT, ceil - 2.33, gw + 0.02, P.wall, { solid: true, edge: -0.3 });
          doorway(g, l, gw, false, into || 1);
        }
        a = g + gw / 2;
      }
    }
    // A CEILING over a room: an acoustic tile field hung 6 cm under the slab,
    // a bulkhead fascia round its free edges (so a cloud over part of a plate
    // reads as built, not as a floating sheet), and linear lights run along
    // the depth. `n` lights, `dark` for the watch floor.
    function ceiling(d0, d1, l0, l1, n, dark, ei) {
      const md = (d0 + d1) / 2, ml = (l0 + l1) / 2, dd = d1 - d0, ll = l1 - l0;
      const cy = ceil - 0.085;
      B(A.at(md, ml), cy, ll, 0.025, dd, dark ? FED.ceilDark : FED.ceilTile, { edge: -0.5 });
      // fascia (only where the cloud does not meet a wall of the room)
      B(A.at(d0 + 0.04, ml), ceil - 0.40, ll, 0.34, 0.08, P.wall, { edge: -0.5 });
      B(A.at(d1 - 0.04, ml), ceil - 0.40, ll, 0.34, 0.08, P.wall, { edge: -0.5 });
      B(A.at(md, l0 + 0.04), ceil - 0.40, 0.08, 0.34, dd, P.wall, { edge: -0.5 });
      B(A.at(md, l1 - 0.04), ceil - 0.40, 0.08, 0.34, dd, P.wall, { edge: -0.5 });
      let lights = 0;
      for (let i = 0; i < n; i++) {
        const l = l0 + ll * (i + 0.5) / n;
        lights += lit(A.at(md, l), cy - 0.03, 0.14, 0.03, Math.max(1, dd - 1.6), P.light, ei == null ? 0.55 : ei);
      }
      return lights;
    }
    // A STANDARD: weighted base ON the floor, pole, finial, cloth hanging flat.
    function standard(d, l, side) {
      const p = A.at(d, l);
      if (!inRect(r, p.x, p.z, 0.3)) return 0;
      B(p, 0, 0.46, 0.06, 0.46, P.bezel);
      B(p, 0.06, 0.07, 2.44, 0.07, P.gold);
      B(p, 2.50, 0.14, 0.14, 0.14, P.gold);
      // the cloth hangs flat off the pole toward the axis, facing the room
      B(A.at(d - 0.06, l - side * 0.44), 1.30, 0.80, 1.10, 0.04, FED.navy);
      B(A.at(d - 0.06, l - side * 0.44), 1.26, 0.82, 0.04, 0.05, P.gold);   // fringe
      return 1;
    }
    // CBZ.furnish, drawn through this host (seats come back in WORLD coords)
    function piece(name, d, l, yaw, o) {
      const F = CBZ.furnish, fn = F && F[name];
      if (typeof fn !== "function") return null;
      const p = A.at(d, l);
      if (!inRect(r, p.x, p.z, 0.6) || !h.clear(p.x, p.z, 0.5) || doorBlocked(h, r.y, p.x, p.z, 0.9)) return null;
      const oo = Object.assign({ tone: "exec", solid: true }, o || {}, { box: h.b.lbox, ox: h.ox, oz: h.oz, oy: 0, lot: null });
      try { return name === "lamp" ? fn(p.x, r.y, p.z, oo) : fn(p.x, r.y, p.z, yaw || 0, oo); } catch (e) { return null; }
    }
    function planter(d, l, s) {
      const p = A.at(d, l);
      if (!CBZ.furnish || !CBZ.furnish.planter || !inRect(r, p.x, p.z, 0.6) || !h.clear(p.x, p.z, 0.6) || doorBlocked(h, r.y, p.x, p.z, 0.4)) return;
      try { CBZ.furnish.planter(p.x, r.y, p.z, 0, { box: h.b.lbox, ox: h.ox, oz: h.oz, kind: "tree", s: s || 1.0 }); } catch (e) {}
    }
    // an anchor straight off a furnish seat record (world coords in, lx/lz out)
    function seatAnchor(list, s, kind) {
      if (!s) return null;
      const a = { x: s.x, y: r.y, z: s.z, face: s.face != null ? s.face : s.yaw, lx: s.x - h.ox, lz: s.z - h.oz,
        cushionH: s.cushion != null ? s.cushion : 0.45, floorBelow: 0 };
      if (kind) a.kind = kind;
      list.push(a);
      return a;
    }
    return { A: A, h: h, r: r, ceil: ceil, B: B, lit: lit, rug: rug, wallLat: wallLat, wallDep: wallDep,
      ceiling: ceiling, standard: standard, piece: piece, planter: planter, seatAnchor: seatAnchor, clearRuns: clearRuns };
  }

  // ---- (1) THE SECURITY LOBBY -------------------------------------------------
  function progSecurityLobby(r, h, opts) {
    shell(h, r);
    const F = fedFrame(r, h, opts), A = F.A, B = F.B;
    const anchors = [];
    const dep = A.depth, span = A.span, half = span / 2;
    if (dep < 14 || span < 12) { const o = progLobby(r, h, opts); return o; }
    // the whole security zone is centred on the way you come in
    const gl = A.lat(A.gapLat, 7.0);
    const L = function (v) { return A.lat(gl + v, 0.9); };
    // ---- ARRIVAL: matting inside the door, a visitor bench group off the axis
    F.rug(1.9, gl, 4.4, 3.0, FED.mat);
    // ---- SCREENING at depth 6: x-ray belt (bags go through it), two arches
    const DS = 6.2;
    { const xl = L(-3.6);
      B(A.at(DS, xl), 0, 1.05, 1.25, 2.1, P.desk, { solid: true });                 // the machine
      B(A.at(DS, xl), 0.25, 0.70, 0.62, 2.14, P.bezel);                             // the tunnel mouth
      B(A.at(DS - 1.85, xl), 0, 0.72, 0.74, 1.6, P.steel, { solid: true });          // in-feed rollers
      B(A.at(DS + 1.85, xl), 0, 0.72, 0.74, 1.6, P.steel, { solid: true });          // out-feed rollers
      B(A.at(DS - 1.85, xl), 0.74, 0.68, 0.04, 1.56, FED.steel);
      B(A.at(DS + 1.85, xl), 0.74, 0.68, 0.04, 1.56, FED.steel);
      // the operator's screen on a post beside the tunnel, and his stool
      B(A.at(DS, xl - 0.95), 0, 0.08, 1.10, 0.08, P.steel);
      B(A.at(DS, xl - 0.95), 1.10, 0.10, 0.34, 0.46, P.bezel);
      B(A.at(DS, xl - 0.89), 1.14, 0.02, 0.26, 0.38, P.screen);
      const st = F.piece("stool", DS, xl - 1.55, Math.atan2(A.tx, A.tz));
      if (st && st.seats) F.seatAnchor(anchors, st.seats[0]);
    }
    for (const al of [L(-1.0), L(1.0)]) {                                           // walk-through arches
      for (const s of [-1, 1]) B(A.at(DS, al + s * 0.52), 0, 0.12, 2.15, 0.62, FED.steel, { solid: true });
      B(A.at(DS, al), 2.15, 1.16, 0.24, 0.66, FED.steel);
      B(A.at(DS - 0.33, al + 0.52), 1.30, 0.04, 0.22, 0.02, P.glow);               // the status light
    }
    { const tl = L(3.4);                                                            // the bag table
      B(A.at(DS + 0.2, tl), 0, 0.9, 0.88, 1.8, P.desk, { solid: true });
      B(A.at(DS + 0.2, tl), 0.88, 0.96, 0.04, 1.86, P.worktop);
      B(A.at(DS - 0.4, tl), 0.92, 0.46, 0.08, 0.34, P.bezel);                      // a grey bin
    }
    // stanchion posts funnel the queue into the arches (a waist rail between)
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
      const pd = DS - 2.6 - i * 1.0, pl = L(s * 2.1);
      B(A.at(pd, pl), 0, 0.30, 0.03, 0.30, P.bezel);
      B(A.at(pd, pl), 0.03, 0.06, 0.92, 0.06, FED.steel);
    }
    for (const s of [-1, 1]) B(A.at(DS - 3.6, L(s * 2.1)), 0.86, 0.03, 0.04, 2.0, FED.navy);
    // ---- THE SECURITY DESK, square to the door, on the other flank --------------
    { const dl = L(7.2), dd = DS - 0.8;
      B(A.at(dd, dl), 0, 3.4, 1.10, 0.36, P.table, { solid: true });                // the front panel
      B(A.at(dd, dl), 1.10, 3.6, 0.05, 0.50, P.marble);                            // transaction ledge
      B(A.at(dd + 0.55, dl), 0, 3.4, 0.74, 0.70, P.desk, { solid: true });           // the work surface
      B(A.at(dd + 0.55, dl), 0.74, 3.5, 0.03, 0.74, P.worktop);
      for (let i = -1; i <= 1; i++) {                                               // the camera wall of monitors
        B(A.at(dd + 0.40, dl + i * 0.95), 0.77, 0.62, 0.40, 0.06, P.bezel);
        B(A.at(dd + 0.43, dl + i * 0.95), 0.80, 0.54, 0.32, 0.02, P.screen);
      }
      const c1 = A.at(dd + 1.35, dl - 0.8), c2 = A.at(dd + 1.35, dl + 0.8);
      for (const c of [c1, c2]) if (inRect(r, c.x, c.z, 0.5)) {
        taskChair(h, c.x, r.y, c.z, -A.nx, -A.nz, 0.49);
        anchors.push({ x: h.ox + c.x, y: r.y, z: h.oz + c.z, face: A.faceIn, lx: c.x, lz: c.z, cushionH: 0.49, floorBelow: 0 });
      }
    }
    // ---- THE TURNSTILE LINE: wall to wall, lanes in the middle ------------------
    const DB = Math.min(dep - 7, 11.5);
    const LANES = 5, PITCH = 1.25, HOUSE = 0.30;         // 0.95 m clear per lane
    const l0 = L(-(LANES * PITCH) / 2);
    for (let i = 0; i <= LANES; i++) {
      const hl = l0 + i * PITCH;
      B(A.at(DB, hl), 0, HOUSE, 1.02, 1.70, FED.steel, { solid: true });            // the cabinet
      B(A.at(DB, hl), 1.02, HOUSE + 0.04, 0.03, 1.74, P.bezel);                    // the glass top
      B(A.at(DB - 0.55, hl), 1.05, 0.10, 0.02, 0.12, P.glow);                      // the card reader
      // the wings, retracted into the cabinet (open lane), frosted
      if (i < LANES) B(A.at(DB, hl + HOUSE / 2 + 0.03), 0.30, 0.02, 0.62, 0.52, FED.frost);
    }
    // the balustrade either side of the bank, to the walls
    const bank0 = l0 - HOUSE / 2, bank1 = l0 + LANES * PITCH + HOUSE / 2;
    for (const seg of [[-half, bank0], [bank1, half]]) {
      const a = Math.max(-half, seg[0]), b = Math.min(half, seg[1]);
      if (b - a < 0.2) continue;
      for (const run of F.clearRuns(a, b, function (t) { return A.at(DB, t); })) {
        const mid = (run[0] + run[1]) / 2, len = run[1] - run[0];
        B(A.at(DB, mid), 0, len, 0.12, 0.10, P.bezel, { edge: -0.6 });             // shoe
        B(A.at(DB, mid), 0.12, len, 0.90, 0.03, FED.frost, { solid: true, edge: -0.6 });
        B(A.at(DB, mid), 1.02, len, 0.04, 0.08, FED.steel, { edge: -0.6 });         // top rail
        for (const e of [run[0] + 0.04, run[1] - 0.04]) B(A.at(DB, e), 0, 0.07, 1.06, 0.07, FED.steel);
        for (let t = run[0] + 1.5; t < run[1] - 0.4; t += 3.0) B(A.at(DB, t), 0, 0.06, 1.02, 0.06, FED.steel);
      }
    }
    // ---- BEYOND THE LINE: a stone wall of honour, two standards, a bench --------
    const DW = Math.min(dep - 2.4, DB + 8.5);
    if (DW - DB > 4.5) {
      B(A.at(DW, gl), 0, 9.0, 0.30, 0.60, P.bezel, { solid: true });               // plinth
      B(A.at(DW, gl), 0.30, 8.6, Math.min(3.2, F.ceil - 0.6), 0.40, P.marble, { solid: true });
      B(A.at(DW - 0.24, gl), 1.02, 8.4, 0.05, 0.10, P.gold);                       // brass ledge
      for (const s of [-1, 1]) F.lit(A.at(DW - 0.55, gl + s * 3.0), 0, 0.30, 0.06, 0.30, P.lamp, 0.8);   // uplights
      F.standard(DW - 0.9, L(-5.2), -1);
      F.standard(DW - 0.9, L(5.2), 1);
      const bn = F.piece("bench", DW - 3.4, gl, A.faceOut);
      if (bn && bn.seats) for (const s of bn.seats) F.seatAnchor(anchors, s);
    }
    // ---- a waiting group for visitors, before screening, off the queue ----------
    { const wd = Math.min(4.2, DS - 2.0), wl = L(-8.2);
      F.rug(wd, wl, 3.4, 2.6, P.rug);
      const s1 = F.piece("sofa", wd - 0.95, wl, A.faceOut, { tone: "cool" });
      const s2 = F.piece("sofa", wd + 0.95, wl, A.faceIn, { tone: "cool" });
      F.piece("coffee", wd, wl, 0);
      for (const s of [s1, s2]) if (s && s.seats) for (const q of s.seats) F.seatAnchor(anchors, q);
    }
    F.planter(2.0, L(-3.4), 1.0);
    F.planter(2.0, L(3.4), 1.0);
    F.planter(DB + 2.4, L(-5.6), 1.1);
    F.planter(DB + 2.4, L(5.6), 1.1);
    // ---- THE CEILING over the zone -------------------------------------------------
    const zh = Math.min(half - 0.5, 12);
    F.ceiling(0.6, Math.min(dep - 0.6, DW + 1.5), A.lat(gl - zh, 0.5), A.lat(gl + zh, 0.5), 5, false, 0.55);
    // ---- THE POSTS: one at each arch, one at the lanes, one on the far side
    anchorAt(A, anchors, DS + 1.3, L(-1.0), A.faceIn, "guard", "foldarms");
    anchorAt(A, anchors, DS + 1.3, L(1.0), A.faceIn, "guard", "foldarms");
    anchorAt(A, anchors, DB + 1.4, L(LANES * PITCH / 2 + 1.2), A.faceIn, "guard", "foldarms");
    anchorAt(A, anchors, DB - 1.6, L(-(LANES * PITCH / 2 + 1.6)), A.faceOut, "guard", "foldarms");
    return { anchors: anchors };
  }

  // ---- (2) THE OPERATIONS CENTRE (the watch floor) --------------------------
  function progOpsCenter(r, h, opts) {
    shell(h, r);
    const F = fedFrame(r, h, opts), A = F.A, B = F.B;
    const anchors = [];
    const dep = A.depth, span = A.span, half = span / 2;
    if (dep < 11 || span < 9) return progDeskFarm(r, h);
    const W = Math.min(span - 0.6, 30), wh = W / 2;           // the room's width
    const D0 = Math.max(2.4, Math.min(5.0, dep - 17));         // its front wall
    const D1 = dep;                                            // the far facade
    const walled = W < span - 1.4;
    // ---- THE ROOM: a front wall with double doors on your line, side walls ----
    const dl = Math.max(-wh + 1.6, Math.min(wh - 1.6, A.gapLat));
    F.wallLat(D0, -wh, wh, [dl], 1.8, 1);
    if (walled) { F.wallDep(-wh, D0, D1, null, 1.2, 1); F.wallDep(wh, D0, D1, null, 1.2, -1); }
    // carpet tile over the whole room (the FLOOR LAW finish)
    F.rug((D0 + D1) / 2, 0, W - 0.3, D1 - D0 - 0.3, FED.carpet);
    // ---- THE VIDEO WALL on the far wall, facing the room -----------------------
    const vwH = Math.min(3.0, F.ceil - 0.95), vwY = 0.85, vwD = D1 - 0.32, vwW = Math.min(W - 2.4, 18);
    B(A.at(vwD + 0.1, 0), 0, vwW + 0.8, vwY, 0.34, P.bezel, { solid: true });       // the plinth under it
    B(A.at(vwD, 0), vwY, vwW + 0.3, vwH + 0.3, 0.16, P.bezel);                       // the frame
    F.lit(A.at(vwD - 0.09, 0), vwY + 0.15, vwW, vwH, 0.02, P.glow, 0.42);            // the field (one draw)
    // tile seams: 6 across, 3 high
    for (let i = 1; i < 6; i++) B(A.at(vwD - 0.11, -vwW / 2 + vwW * i / 6), vwY + 0.15, 0.04, vwH, 0.02, P.bezel);
    for (let j = 1; j < 3; j++) B(A.at(vwD - 0.11, 0), vwY + 0.15 + vwH * j / 3 - 0.02, vwW, 0.04, 0.02, P.bezel);
    // two live feeds, brighter than the field (the map on the left, a camera right)
    F.lit(A.at(vwD - 0.12, -vwW / 2 + vwW * 1.5 / 6), vwY + 0.15 + vwH / 3 + 0.03, vwW * 2 / 6 - 0.1, vwH * 2 / 3 - 0.08, 0.02, P.screen, 0.5);
    F.lit(A.at(vwD - 0.12, vwW / 2 - vwW / 12), vwY + 0.19, vwW / 6 - 0.1, vwH / 3 - 0.08, 0.02, P.screen, 0.5);
    // the clock row over the wall: six faces, no words
    if (F.ceil - (vwY + vwH + 0.3) > 0.5) for (let i = 0; i < 6; i++) {
      const cl = -vwW / 2 + vwW * (i + 0.5) / 6, cy = vwY + vwH + 0.42;
      B(A.at(vwD - 0.02, cl), cy, 0.42, 0.42, 0.06, P.bezel);
      B(A.at(vwD - 0.06, cl), cy + 0.04, 0.34, 0.34, 0.02, P.marble);
      B(A.at(vwD - 0.08, cl), cy + 0.2, 0.02, 0.14, 0.01, P.bezel);
    }
    // ---- CONSOLE ROWS facing the wall ------------------------------------------
    const rowLen = Math.min(W - 3.4, 16), seat = 1.6;
    const nSeat = Math.max(2, Math.floor(rowLen / seat));
    const firstRow = vwD - 5.2;
    let rows = 0;
    for (let d = firstRow; d > D0 + 4.2 && rows < 4; d -= 3.1, rows++) {
      const len = nSeat * seat;
      B(A.at(d, 0), 0, len, 0.70, 0.86, P.desk, { solid: true });                    // the console body
      B(A.at(d, 0), 0.70, len + 0.1, 0.05, 0.96, P.worktop);                        // worktop → 0.75
      B(A.at(d + 0.44, 0), 0.75, len, 0.12, 0.08, P.bezel);                         // the rear upstand
      for (let i = 0; i < nSeat; i++) {
        const sl = -len / 2 + seat * (i + 0.5);
        for (const s of [-1, 1]) {                                                  // two monitors a seat
          B(A.at(d + 0.26, sl + s * 0.33), 0.75, 0.10, 0.10, 0.10, P.bezel);        // the foot
          B(A.at(d + 0.26, sl + s * 0.33), 0.85, 0.05, 0.14, 0.05, P.bezel);        // the neck
          B(A.at(d + 0.24, sl + s * 0.33), 0.99, 0.60, 0.38, 0.05, P.bezel);        // the panel
          B(A.at(d + 0.21, sl + s * 0.33), 1.02, 0.54, 0.32, 0.01, P.screen);       // the picture
        }
        B(A.at(d - 0.18, sl), 0.75, 0.46, 0.02, 0.16, P.bezel);                     // keyboard
        const c = A.at(d - 0.9, sl);
        if (!inRect(r, c.x, c.z, 0.4)) continue;
        taskChair(h, c.x, r.y, c.z, A.nx, A.nz, 0.49);                              // facing the wall
        anchors.push({ x: h.ox + c.x, y: r.y, z: h.oz + c.z, face: A.faceOut, lx: c.x, lz: c.z, cushionH: 0.49, floorBelow: 0 });
      }
    }
    // ---- THE WATCH OFFICER at the back, looking over the rows ------------------
    { const wd = D0 + 2.2, wl = Math.max(-wh + 2.6, Math.min(wh - 2.6, -dl * 0.5 + (dl > 0 ? -3 : 3)));
      const dk = F.piece("desk", wd, wl, A.faceOut, { len: 2.2, deep: 0.9 });
      if (dk && dk.seats) F.seatAnchor(anchors, dk.seats[0]);
      B(A.at(wd + 0.3, wl + 1.35), 0, 0.5, 1.1, 0.6, P.steel, { solid: true });    // the red-phone cabinet
      B(A.at(wd + 0.3, wl + 1.35), 1.1, 0.24, 0.1, 0.2, 0xb43a32);
    }
    // ---- THE CEILING: dark, with rows of linear light --------------------------
    F.ceiling(D0 + 0.1, D1 - 0.1, -wh + 0.1, wh - 0.1, 4, true, 0.45);
    // a guard inside the doors
    anchorAt(A, anchors, D0 + 1.2, A.lat(dl + 1.8, 1.0), A.faceOut, "guard", "foldarms");
    return { anchors: anchors };
  }

  // ---- (3) THE BRIEFING ROOM ----------------------------------------------------
  function progBriefingRoom(r, h, opts) {
    shell(h, r);
    const F = fedFrame(r, h, opts), A = F.A, B = F.B;
    const anchors = [];
    const dep = A.depth, span = A.span, half = span / 2;
    if (dep < 10 || span < 8) return progMeeting(r, h, opts);
    const W = Math.min(span - 0.6, 15), wh = W / 2;
    const D1 = dep, D0 = Math.max(4.5, D1 - 13.5);
    const walled = W < span - 1.4;
    const dl = Math.max(-wh + 1.4, Math.min(wh - 1.4, A.gapLat));
    F.wallLat(D0, -wh, wh, [dl], 1.2, 1);
    if (walled) { F.wallDep(-wh, D0, D1, null, 1.2, 1); F.wallDep(wh, D0, D1, null, 1.2, -1); }
    F.rug((D0 + D1) / 2, 0, W - 0.3, D1 - D0 - 0.3, FED.carpet);
    // ---- THE HEAD: a screen on the far wall, a lectern to one side, standards --
    const sd = D1 - 0.28, sw = Math.min(W - 4.5, 4.6), sy = 0.95, sh = Math.min(2.2, F.ceil - 1.3);
    B(A.at(sd + 0.08, 0), 0, sw + 1.2, 0.80, 0.44, P.table, { solid: true });          // the credenza under it
    B(A.at(sd + 0.08, 0), 0.80, sw + 1.3, 0.04, 0.48, P.marble);
    B(A.at(sd, 0), sy, sw + 0.16, sh + 0.16, 0.08, P.bezel);
    F.lit(A.at(sd - 0.05, 0), sy + 0.08, sw, sh, 0.02, P.glow, 0.45);
    const ll = Math.min(wh - 1.2, sw / 2 + 1.1);
    B(A.at(sd - 1.5, ll), 0, 0.62, 1.12, 0.48, P.table, { solid: true });            // the lectern
    B(A.at(sd - 1.5, ll), 1.12, 0.66, 0.04, 0.56, P.wood);
    B(A.at(sd - 1.72, ll), 1.16, 0.04, 0.34, 0.02, P.bezel);                         // its microphone
    F.standard(sd - 0.6, -Math.min(wh - 0.7, sw / 2 + 0.9), -1);
    F.standard(sd - 0.6, Math.min(wh - 0.7, ll + 0.8), 1);
    // ---- THE TABLE down the middle, chairs both sides ---------------------------
    const t0 = D0 + 2.6, t1 = sd - 2.6, tl = t1 - t0;
    if (tl > 2.5) {
      const tm = (t0 + t1) / 2, tw = 1.5;
      B(A.at(tm, 0), 0, tw - 0.5, 0.70, tl - 0.8, P.table, { solid: true });          // the pedestal run
      B(A.at(tm, 0), 0.70, tw, 0.05, tl, P.wood);                                    // top → 0.75
      B(A.at(tm, 0), 0.75, 0.36, 0.01, tl - 0.4, P.table);                           // the cable spine
      const n = Math.max(2, Math.floor(tl / 1.0));
      for (let i = 0; i < n; i++) {
        const cd = t0 + tl * (i + 0.5) / n;
        for (const s of [-1, 1]) {
          const ch = F.piece("chair", cd, s * (tw / 2 + 0.42), Math.atan2(-s * A.tx, -s * A.tz), { tone: "exec", solid: false });
          if (ch && ch.seats) F.seatAnchor(anchors, ch.seats[0]);
          B(A.at(cd, s * (tw / 2 - 0.22)), 0.75, 0.22, 0.01, 0.30, P.worktop);        // a pad at each place
        }
      }
      // the chair at the foot, looking up the table at the screen
      const fc = F.piece("chair", t0 - 0.45, 0, A.faceOut, { tone: "exec", solid: false });
      if (fc && fc.seats) F.seatAnchor(anchors, fc.seats[0]);
    }
    // ---- the back-benchers along both side walls --------------------------------
    for (const s of [-1, 1]) {
      const bl = s * (wh - 0.55);
      for (let d = D0 + 2.2; d < sd - 2.2; d += 0.95) {
        const ch = F.piece("chair", d, bl, Math.atan2(-s * A.tx, -s * A.tz), { tone: "cool", solid: false });
        if (ch && ch.seats) F.seatAnchor(anchors, ch.seats[0]);
      }
    }
    F.ceiling(D0 + 0.1, D1 - 0.1, -wh + 0.1, wh - 0.1, 3, false, 0.5);
    // ---- outside the door: a pre-function group --------------------------------
    if (D0 > 5.5) {
      const pd = D0 - 2.6, pl = A.lat(dl + (dl > 0 ? -3.6 : 3.6), 2.0);
      const s1 = F.piece("sofa", pd, pl, A.faceOut, { tone: "cool" });
      F.piece("coffee", pd + 1.0, pl, 0);
      const a1 = F.piece("armchair", pd + 1.0, pl + 1.4, Math.atan2(-A.tx, -A.tz));
      for (const s of [s1, a1]) if (s && s.seats) for (const q of s.seats) F.seatAnchor(anchors, q);
      F.planter(D0 - 0.8, A.lat(dl + 1.6, 1.0), 0.9);
    }
    anchorAt(A, anchors, D0 - 1.0, A.lat(dl - 1.3, 1.0), A.faceOut, "guard", "foldarms");
    return { anchors: anchors };
  }

  // ---- (4) THE DIRECTOR'S SUITE -----------------------------------------------
  function progDirectorSuite(r, h, opts) {
    shell(h, r);
    const F = fedFrame(r, h, opts), A = F.A, B = F.B;
    const anchors = [];
    const dep = A.depth, span = A.span, half = span / 2;
    if (dep < 14 || span < 9) return progBossSuite(r, h, opts);
    const W = Math.min(span - 0.6, 16), wh = W / 2;
    const D2 = dep, D1 = Math.max(7.0, D2 - 9.0), D0 = Math.max(2.6, D1 - 7.5);
    const walled = W < span - 1.4;
    const dl = Math.max(-wh + 1.4, Math.min(wh - 1.4, A.gapLat));
    const ol = wh > 5 ? Math.min(wh - 1.6, 3.0) : 0;              // his door, off the axis
    // ---- THE SUITE: a front wall (the assistant's door), a wall to his office ---
    F.wallLat(D0, -wh, wh, [dl], 1.2, 1);
    F.wallLat(D1, -wh, wh, [ol], 1.2, 1);
    if (walled) { F.wallDep(-wh, D0, D2, null, 1.2, 1); F.wallDep(wh, D0, D2, null, 1.2, -1); }
    F.rug((D0 + D1) / 2, 0, W - 0.3, D1 - D0 - 0.3, FED.carpet);
    // ---- THE OUTER OFFICE: his assistant faces the door you came through --------
    { const ad = D0 + 2.2, al = A.lat(dl + (dl > 0 ? -3.2 : 3.2), 1.6);
      const dk = F.piece("desk", ad, al, A.faceIn, { len: 1.8, deep: 0.8 });
      if (dk && dk.seats) F.seatAnchor(anchors, dk.seats[0]);
      F.piece("credenza", D1 - 0.55, A.lat(al, 1.2), A.faceIn);
      const wl = A.lat(-al * 0.6, 1.6);
      const s1 = F.piece("sofa", (D0 + D1) / 2, wl, Math.atan2(al > 0 ? A.tx : -A.tx, al > 0 ? A.tz : -A.tz), { tone: "exec" });
      if (s1 && s1.seats) for (const q of s1.seats) F.seatAnchor(anchors, q);
      F.planter(D0 + 0.8, A.lat(dl + (dl > 0 ? 1.4 : -1.4), 0.8), 0.9);
    }
    F.ceiling(D0 + 0.1, D1 - 0.1, -wh + 0.1, wh - 0.1, 2, false, 0.5);
    // ---- HIS OFFICE ------------------------------------------------------------
    const od = D2 - 2.4;
    F.rug((D1 + D2) / 2, 0, W - 0.6, D2 - D1 - 0.6, P.rug);
    // his desk's line: off the axis, and off any column the shell keeps clear
    // (the front door's walk-in runs up through every floor over it)
    let xl = A.lat(-ol * 0.4, 1.8);
    for (const c of [-ol * 0.4, -ol * 0.4 - 2.4, -ol * 0.4 + 2.4, -ol * 0.4 - 4.2, -ol * 0.4 + 4.2]) {
      const q = A.lat(c, 1.8), p1 = A.at(od, q), p2 = A.at(od + 0.97, q), p3 = A.at(od - 1.0, q);
      if (h.clear(p1.x, p1.z, 0.5) && h.clear(p2.x, p2.z, 0.3) && h.clear(p3.x, p3.z, 0.3)) { xl = q; break; }
    }
    const bd = F.piece("bossDesk", od, xl, A.faceIn, { len: 2.4, deep: 1.0 });
    if (bd && bd.seats && bd.seats.length) {
      F.seatAnchor(anchors, bd.seats[0], "boss");
      for (let i = 1; i < bd.seats.length; i++) F.seatAnchor(anchors, bd.seats[i]);
    }
    F.piece("credenza", D2 - 0.45, xl, A.faceIn);
    F.standard(D2 - 0.7, A.lat(xl - 1.9, 0.6), -1);
    F.standard(D2 - 0.7, A.lat(xl + 1.9, 0.6), 1);
    // the sitting group on the door side of the room
    { const sd = D1 + 2.6, sl = A.lat(ol + (ol > 0 ? -0.2 : 2.4), 1.6);
      const so = F.piece("sofa", sd, A.lat(sl + 1.2, 1.2), Math.atan2(-A.tx, -A.tz), { tone: "exec" });
      F.piece("coffee", sd, sl - 0.2, 0);
      const a1 = F.piece("armchair", sd, A.lat(sl - 1.5, 1.2), Math.atan2(A.tx, A.tz));
      for (const s of [so, a1]) if (s && s.seats) for (const q of s.seats) F.seatAnchor(anchors, q);
    }
    // a bookcase on the side wall
    // a bookcase on the side wall: back, two sides, a top, five shelves, and
    // books standing on four of them (the spines are the only colour it has)
    { const bl = -wh + 0.32, bh = Math.min(2.2, F.ceil - 0.4), spines = [P.rug, FED.navy, P.table, P.sofa, P.gold];
      for (let i = 0; i < 2; i++) {
        const bd2 = D1 + 1.5 + i * 1.02;
        B(A.at(bd2, bl - 0.15), 0, 0.03, bh, 0.98, P.wood, { solid: true });
        for (const e of [-1, 1]) B(A.at(bd2 + e * 0.48, bl), 0, 0.33, bh, 0.03, P.wood, { solid: true });
        B(A.at(bd2, bl), bh - 0.03, 0.33, 0.03, 0.98, P.wood);
        for (let j = 0; j < 5; j++) {
          const sy = 0.06 + j * 0.42;
          B(A.at(bd2, bl + 0.01), sy - 0.03, 0.31, 0.03, 0.93, P.wood);
          if (j === 4) continue;
          // a run of books, left to right, a gap where the hash says so
          let u = -0.42;
          for (let k = 0; k < 9 && u < 0.4; k++) {
            const hh = CBZ.hash01 ? CBZ.hash01(h.ox + bd2 * 7 + k, h.oz + j * 13, 0xB00C) : 0.5;
            const bw = 0.04 + hh * 0.05, bhh = 0.24 + hh * 0.1;
            if (hh > 0.12) B(A.at(bd2 + u + bw / 2, bl + 0.02), sy, 0.22, bhh, bw, spines[(k + j) % spines.length]);
            u += bw + 0.012;
          }
        }
      }
    }
    F.planter(D2 - 0.8, A.lat(wh - 0.8, 0.8), 1.0);
    F.ceiling(D1 + 0.1, D2 - 0.1, -wh + 0.1, wh - 0.1, 2, false, 0.5);
    // a lamp on the desk side, warm (one of his two lights that is not a strip)
    F.lit(A.at(D2 - 0.45, A.lat(xl - 1.4, 0.8)), 0.86, 0.26, 0.20, 0.26, P.lamp, 0.8);
    // ---- the detail at his doors -----------------------------------------------
    anchorAt(A, anchors, D0 - 1.1, A.lat(dl + 1.1, 1.0), A.faceOut, "guard", "foldarms");
    anchorAt(A, anchors, D0 - 1.1, A.lat(dl - 1.1, 1.0), A.faceOut, "guard", "foldarms");
    anchorAt(A, anchors, D1 - 1.0, A.lat(ol - 1.3, 1.0), A.faceIn, "guard", "foldarms");
    return { anchors: anchors };
  }
  const FEDERAL_PROGRAMS = {
    securitylobby: progSecurityLobby, opscenter: progOpsCenter,
    briefingroom: progBriefingRoom, directorsuite: progDirectorSuite,
  };

  /* ========================================================================
     THE LEGISLATURE, THE TOWN HALL AND THE GOVERNOR'S HOUSE — civic programs.

     OWNER (President mode): "all the buildings in the presidential mode just
     need to be redone ... inside and out." The Capitol's three floors were a
     generic lobby, a meeting floor and a crime boss's flat; its two wings (a
     legislature's CHAMBERS) were a meeting floor and a desk farm; City Hall
     had no council chamber and the Governor's Residence had no rooms. These
     programs are the buildings those rows declare:

       rotunda          the Capitol's ground floor: the rotunda under the dome
                        (its well carved through every slab and the roof), the
                        entrance hall with the screening line, a statuary hall
                        behind, the cross corridor and members' suites off it.
       capitolfloor     the two floors above: the gallery round the well, the
                        corridor, hearing rooms (floor 1), the grand committee
                        room, the library, members' suites and the principal's
                        own office on the top floor.
       chamber          a wing's ground floor: the house floor itself, a real
                        semicircle of five tiers (each a walk surface, 0.17 m
                        risers) of members' desks round the well, the rostrum on
                        a stepped dais, a lobby, side corridors, members' doors.
       chambergallery   the floor over it: the public galleries round the
                        chamber's void behind a solid balustrade, a cross
                        corridor, two committee rooms and a reading room.
       councilchamber   City Hall's council floor: the council on a dais, the
                        public in rows, the clerk's office, a committee room.
       mayorsoffice     City Hall's top floor: the mayor's office, the anteroom,
                        the deputy's office and staff offices.
       govresidence     the Governor's ground floor: hall, drawing room, dining
                        room, study.
       govprivate       his upper floor: landing hall, the principal bedroom,
                        a guest room, the family sitting room.

     THE FLOOR LAW, kept by construction: every finish these programs lay has
     its top at r.y + 0.012 (a field: marble, oak, carpet), + 0.016 (an inlay,
     a rug's border) or + 0.020 (a rug's field) — never more than 2 cm over
     the slab the body stands on. Anything higher that you can walk on (a
     committee dais, the rostrum, the chamber's tiers) is a REGISTERED walk
     surface whose top is the drawn top.

     WALLS are solid (colliders) with real doorways: casings on both faces, a
     lintel, a skirting, the leaf standing open against the reveal. Rooms are
     planned round the stair core (b.stairPlan + its landing mouth): a room
     that would enclose the core becomes the open stair hall instead.
     ======================================================================== */
  const CV = {
    marble: 0xe4dfd2, marbleD: 0x9d9587, marbleV: 0x5f6e62, plaster: 0xe8e2d4,
    panel: 0x5b3e28, panelL: 0x7a5638, oak: 0x8a6440, walnut: 0x4a3322,
    gold: 0xb99347, bronze: 0x6b5a3a, cream: 0xf2ede1, ink: 0x1d2126,
    red: 0x7a2c2e, blue: 0x2c3c63, green: 0x2f5744, sand: 0xc8b48a,
    lamp: 0xffe2b0, day: 0xfff1d8, felt: 0x2f4a3a, leather: 0x4a2620,
  };
  function cvMat(hex) { return CBZ.cmat ? CBZ.cmat(hex) : new window.THREE.MeshLambertMaterial({ color: hex }); }
  const CV_FIELD = 0.012, CV_INLAY = 0.016, CV_TOP = 0.020;
  const CV_DOOR = 2.4, CV_WT = 0.2;
  const CIVIC = { rooms: 0, doors: 0, walls: 0, tiers: 0, seats: 0, galleries: 0, carved: 0 };
  /* THE CEILING AND THE LIGHT ON IT. What these programs hang (a chandelier,
     a flush panel) is emissive; the fit-out pass (city/fitout.js) builds the
     finished plaster ceiling of the storey when you walk in and bakes a pool
     of light round every fixture into it — the state rooms' own contract
     (stateOut / armStateFit), declared here for the civic programs. The
     ceiling skips every reserved hole, so a well or a chamber's void stays
     open. */
  let CV_FIT = { rooms: [], lights: [] };
  function cvFitStart(r, h) {
    const R = CBZ.interiorShellRect ? CBZ.interiorShellRect(h.b) : null;
    const q = R || { x0: r.x0 - 0.4, x1: r.x1 + 0.4, z0: r.z0 - 0.4, z1: r.z1 + 0.4 };
    CV_FIT = { rooms: [{ x0: q.x0, z0: q.z0, x1: q.x1, z1: q.z1, tint: 0xf3efe6 }], lights: [], h: h, glow: new Map(), doors: [] };
    armCivicFit();
  }
  /* EVERY LAMP ON A FLOOR IS ONE DRAW CALL PER COLOUR. An emissive box drawn
     through lbox mints its own material (core/batch.js will not merge an
     emissive), so a floor of chandeliers, sconces and reading lamps was two
     hundred draw calls. They are gathered here and flushed as one mesh per
     colour and intensity, each on the day ramp (ceilingStrip). */
  function cvGlow(hex, ei, w, hh, d, x, y, z) {
    const G = CV_FIT.glow;
    if (!G) return;
    const k = hex + "|" + ei;
    let L = G.get(k);
    if (!L) { L = { hex: hex, ei: ei, list: [] }; G.set(k, L); }
    const g = new window.THREE.BoxGeometry(w, hh, d);
    g.translate(x, y, z);
    L.list.push(g);
  }
  // every doorway drawn on this floor, so nothing is put in front of one (or
  // where its open leaf stands)
  function cvDoorClear(x, z, rad) {
    const D = CV_FIT.doors || [];
    for (let i = 0; i < D.length; i++) { const dx = x - D[i].x, dz = z - D[i].z; if (dx * dx + dz * dz < (rad + D[i].w / 2) * (rad + D[i].w / 2)) return false; }
    return true;
  }
  function cvOut(anchors) {
    const T = window.THREE, h = CV_FIT.h;
    if (T && h && h.b && h.b.group && CV_FIT.glow) {
      CV_FIT.glow.forEach(function (L) {
        const m = new T.Mesh(mergeCivic(L.list), new T.MeshLambertMaterial({ color: L.hex, emissive: L.hex, emissiveIntensity: L.ei }));
        m.name = "civic-lamps";
        m.castShadow = false; m.receiveShadow = false;
        m.matrixAutoUpdate = false; m.updateMatrix();
        h.b.group.add(m);
        ceilingStrip(m);
      });
      CV_FIT.glow = null;
    }
    return { anchors: anchors, fit: { rooms: CV_FIT.rooms, lights: CV_FIT.lights } };
  }
  let CIVIC_FIT = false;
  function armCivicFit() {
    if (CIVIC_FIT || !CBZ.fitoutPlan) return;
    CIVIC_FIT = true;
    const plan = function (B, f) {
      const info = (f && f.info) || B.info || {};
      const rooms = info.rooms || [], lights = info.lights || [];
      for (let i = 0; i < rooms.length; i++) {
        const rm = rooms[i];
        B.plane(rm.x0, rm.z0, rm.x1, rm.z1, B.ceil - 0.012, "plaster", rm.tint, { down: true, cell: 1.2 });
      }
      for (let i = 0; i < lights.length; i++) B.light(lights[i].x, lights[i].z, { kind: "none", r: lights[i].r, i: lights[i].i });
    };
    for (const name of CIVIC_NAMES) CBZ.fitoutPlan(name, plan);
  }

  // a reserved rect (stair core, its landing, a lift) or the front door's aisle
  // at (x,z)? `ignore` is a rect the caller owns (the rotunda's own well).
  function cvFree(h, r, x, z, pad, ignore) {
    const b = h.b;
    pad = pad == null ? 0.3 : pad;
    const L = (b.shaftRects || []).concat(b.keepRects || []);
    for (let i = 0; i < L.length; i++) {
      const q = L[i];
      if (ignore && q === ignore) continue;
      if (x > q.x0 - pad && x < q.x1 + pad && z > q.z0 - pad && z < q.z1 + pad) return false;
    }
    const dn = b.localDoor;
    if (dn && r.y < 1.0) {
      const dx = x - dn.x, dz = z - dn.z;
      const inward = dx * dn.nx + dz * dn.nz, cross = Math.abs(dx * dn.nz - dz * dn.nx);
      if (inward > -0.8 && inward < 4.8 && cross < 1.2 + pad) return false;
    }
    return true;
  }
  function rectHits(a, q, pad) {
    return a.x0 < q.x1 + pad && a.x1 > q.x0 - pad && a.z0 < q.z1 + pad && a.z1 > q.z0 - pad;
  }
  // is there a window in the wall behind (x,z) over [y0,y1]? Wall-hung pieces
  // (a painting, a bookcase, a seal) never stand in front of the glass.
  function cvGlazed(h, x, z, half, y0, y1) {
    const W = h.b.windows;
    if (!W || !W.length) return false;
    for (let i = 0; i < W.length; i++) {
      const w = W[i];
      if (!w || w.y == null) continue;
      const hh = w.hh || 0.8;
      if (w.y + hh < y0 || w.y - hh > y1) continue;
      const lx = w.x - h.ox, lz = w.z - h.oz;
      const hx = Math.max(w.hw || 0, 0.05), hz = Math.max(w.hd || 0, 0.05);
      if (Math.abs(lx - x) < hx + half + 0.35 && Math.abs(lz - z) < hz + half + 0.35) return true;
    }
    return false;
  }
  // the stair core (+ its landing mouth) as rects, so a plan can go round it
  function cvCore(h) {
    const P = h.b.stairPlan;
    const out = [];
    if (P && P.rect) out.push(P.rect);
    if (P && P.mouth) out.push(P.mouth);
    return out;
  }
  function cvWalk(h, x0, x1, z0, z1, top) {
    const p = { minX: h.ox + Math.min(x0, x1), maxX: h.ox + Math.max(x0, x1), minZ: h.oz + Math.min(z0, z1), maxZ: h.oz + Math.max(z0, z1), top: top };
    (CBZ.platforms = CBZ.platforms || []).push(p);
    if (h.b.platforms) h.b.platforms.push(p);
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    return p;
  }
  function cvSolid(h, x0, x1, z0, z1, y0, y1) {
    const c = { minX: h.ox + Math.min(x0, x1), maxX: h.ox + Math.max(x0, x1), minZ: h.oz + Math.min(z0, z1), maxZ: h.oz + Math.max(z0, z1), y0: y0, y1: y1, ref: null };
    (CBZ.colliders = CBZ.colliders || []).push(c);
    if (h.b.colliders) h.b.colliders.push(c);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    return c;
  }
  function cvPiece(name, h, y, x, z, yaw, opts) {
    const F = CBZ.furnish, fn = F && F[name];
    if (typeof fn !== "function") return null;
    const o = Object.assign({}, opts || {}, { box: h.b.lbox, ox: h.ox, oz: h.oz, oy: 0, lot: null });
    try { return name === "lamp" ? fn(x, y, z, o) : fn(x, y, z, yaw || 0, o); } catch (e) { return null; }
  }
  const CV_LEATHER = { cloth: CV.leather, wood: CV.walnut, frame: 0x2a2f37, linen: CV.cream };
  const CV_HOUSE = {
    senate: { cloth: 0x7a2c2e, wood: CV.walnut, frame: 0x2a2f37, linen: CV.cream },
    assembly: { cloth: 0x2f5744, wood: CV.walnut, frame: 0x2a2f37, linen: CV.cream },
  };

  /* THE FRAME. A room (or a whole floor) described from its door: `d` metres
     in from the door side, `l` metres sideways from the centre line. It is
     approach() — the kit's one orientation helper — plus the architecture a
     civic room is built of, so every room below is authored once and reads
     right from any of the four sides a shell can present. */
  function cvFrame(r, h, door, gap) {
    const A = approach(r, h, { door: door });
    const y = r.y, L = h.b.lbox;
    const o0 = A.at(0, 0);
    // the ceiling, relative to this floor: the underside of the NEXT slab
    // (on the ground floor that is FH - 0.2 - 0.14, not FH - 0.2)
    const tops = h.b.floorTops;
    let ceil = h.fh - 0.2;
    if (Array.isArray(tops) && tops.length >= 2) {
      let k = 0, bd = 1e9;
      for (let i = 0; i < tops.length - 1; i++) { const q = Math.abs(tops[i] - y); if (q < bd) { bd = q; k = i; } }
      if (tops[k + 1] != null) ceil = tops[k + 1] - 0.2 - y;
    }
    const G = gap == null ? 0.4 : gap;
    const F = {
      A: A, h: h, r: r, y: y, dep: A.depth, half: A.span / 2, along: A.along, ceil: ceil,
      wd: A.depth + G, wl: A.span / 2 + G,          // the far wall's face, the side walls' faces
      faceIn: A.faceIn, faceOut: A.faceOut,
      p: A.at,
      inv: function (x, z) {
        const dx = x - o0.x, dz = z - o0.z;
        return { d: dx * A.nx + dz * A.nz, l: dx * A.tx + dz * A.tz };
      },
      // yaw that looks toward +l (s = 1) or -l (s = -1)
      faceL: function (s) { return Math.atan2(s * A.tx, s * A.tz); },
      rect: function (d0, d1, l0, l1) {
        const a = A.at(d0, l0), c = A.at(d1, l1);
        return { x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), z0: Math.min(a.z, c.z), z1: Math.max(a.z, c.z), y: y };
      },
      // a box centred at (d,l): `across` is its lateral size, `deep` its depth
      box: function (d, l, y0, hh, across, deep, hex, o) {
        const p = A.at(d, l);
        return L.call(h.b, p.x, y + y0 + hh / 2, p.z, A.along ? deep : across, hh, A.along ? across : deep, hex,
          Object.assign({ cast: false }, o || {}));
      },
      // a door record for a room whose doorway is at (d,l) and opens INTO
      // the room toward +d (s = 1) or -d (s = -1); `lat` rooms: toward ±l
      door: function (d, l, s, lat) {
        const p = A.at(d, l);
        return lat ? { x: p.x, z: p.z, nx: s * A.tx, nz: s * A.tz } : { x: p.x, z: p.z, nx: s * A.nx, nz: s * A.nz };
      },
    };
    const WH = ceil;
    // a flush finish over a band: top at y + lift (the floor law)
    F.floor = function (d0, d1, l0, l1, hex, lift) {
      const t = lift || CV_FIELD;
      return F.box((d0 + d1) / 2, (l0 + l1) / 2, t - 0.004, 0.004, Math.abs(l1 - l0), Math.abs(d1 - d0), hex);
    };
    F.rug = function (d0, d1, l0, l1, field, border, bw) {
      bw = bw == null ? 0.3 : bw;
      F.box((d0 + d1) / 2, (l0 + l1) / 2, 0.006, CV_INLAY - 0.006, Math.abs(l1 - l0), Math.abs(d1 - d0), border);
      F.box((d0 + d1) / 2, (l0 + l1) / 2, 0.010, CV_TOP - 0.010, Math.abs(l1 - l0) - 2 * bw, Math.abs(d1 - d0) - 2 * bw, field);
    };
    // an emissive fixture on the day ramp
    F.light = function (d, l, y0, hh, across, deep, hex, ei) {
      const p = A.at(d, l);
      cvGlow(hex, ei == null ? 0.8 : ei, A.along ? deep : across, hh, A.along ? across : deep, p.x, y + y0 + hh / 2, p.z);
      if (y0 > WH - 0.6) CV_FIT.lights.push({ x: p.x, z: p.z, r: 4.5, i: 0.45 });
      return true;
    };
    // a chandelier hung from the ceiling on a rod (the drop is solved from the
    // storey, never typed): corona, a lit bowl, a finial
    F.chandelier = function (d, l, size, ceil) {
      const top = (ceil != null ? ceil : WH);
      const s = size || 1.4, drop = Math.min(1.1, Math.max(0.5, top - 3.2));
      F.box(d, l, top - drop, drop, 0.05, 0.05, CV.gold);
      F.box(d, l, top - drop - 0.12, 0.12, s, s, CV.gold);
      F.light(d, l, top - drop - 0.42, 0.3, s * 0.8, s * 0.8, CV.lamp, 0.95);
      F.box(d, l, top - drop - 0.62, 0.2, 0.28, 0.28, CV.gold);
      if (top <= WH + 0.01) { const p = A.at(d, l); CV_FIT.lights.push({ x: p.x, z: p.z, r: 6.0, i: 0.6 }); }
    };
    // a painting on a wall at depth `d` (face -1: on its front face) or, with
    // `lat`, on a wall at lateral `l` (face: which side it faces)
    F.art = function (d, l, face, w, hgt, ly, hex, lat) {
      const k = hex || CV.panel;
      const c0 = A.at(d, l);
      if (cvGlazed(h, c0.x, c0.z, w / 2, y + ly - hgt / 2, y + ly + hgt / 2)) return false;
      if (!cvDoorClear(c0.x, c0.z, w / 2 + 0.3)) return false;
      if (lat) {
        F.box(d, l + face * 0.04, ly - hgt / 2, hgt, 0.06, w, CV.gold);
        F.box(d, l + face * 0.08, ly - hgt / 2 + 0.1, hgt - 0.2, 0.02, w - 0.2, k);
      } else {
        F.box(d + face * 0.04, l, ly - hgt / 2, hgt, w, 0.06, CV.gold);
        F.box(d + face * 0.08, l, ly - hgt / 2 + 0.1, hgt - 0.2, w - 0.2, 0.02, k);
      }
    };
    // a floor standard: weighted base, pole, finial, the cloth hanging flat
    F.flag = function (d, l, hex) {
      { const p = A.at(d, l); if (!cvDoorClear(p.x, p.z, 1.0)) return false; }
      F.box(d, l, 0, 0.06, 0.44, 0.44, CV.bronze);
      F.box(d, l, 0.06, 2.4, 0.05, 0.05, CV.gold);
      F.box(d, l, 2.46, 0.18, 0.12, 0.12, CV.gold);
      F.box(d, l + 0.48, 1.05, 1.3, 0.86, 0.03, hex || CV.blue);
      F.box(d, l + 0.48, 1.9, 0.45, 0.4, 0.035, CV.cream);
    };
    // a wood bookcase standing against a wall, running laterally (or in depth
    // with `lat`), `face` the side its books face
    F.bookcase = function (d, l, len, face, lat) {
      const deep = 0.38, H = Math.min(2.4, WH - 0.3);
      const c0 = A.at(d, l);
      if (cvGlazed(h, c0.x, c0.z, len / 2, y + 0.3, y + H)) return false;
      if (!cvDoorClear(c0.x, c0.z, len / 2 + 0.5)) return false;
      const bx = function (dd, ll, y0, hh, a, dp, hex) {
        return lat ? F.box(dd, ll, y0, hh, dp, a, hex, { solid: y0 < 0.1 }) : F.box(dd, ll, y0, hh, a, dp, hex, { solid: y0 < 0.1 });
      };
      // along the run: lateral (default) or depth
      const at = function (t, n) { return lat ? { d: d + t, l: l + n } : { d: d + n, l: l + t }; };
      const c = at(0, 0);
      bx(c.d, c.l, 0, H, len, deep, CV.walnut);
      const books = [0x6b2a24, 0x2c3c63, 0x3f5a3a, 0x8a6a3a, 0x4a3a5a];
      for (let s = 0; s < 4; s++) {
        const yy = 0.18 + s * (H - 0.3) / 4;
        const sh = at(0, face * 0.02);
        bx(sh.d, sh.l, yy - 0.03, 0.03, len - 0.06, deep - 0.02, CV.panelL);
        const segs = Math.max(2, Math.round(len / 0.7));
        for (let q = 0; q < segs; q++) {
          const t = -len / 2 + 0.05 + (q + 0.5) * (len - 0.1) / segs;
          const bp = at(t, face * 0.05);
          const hb = 0.26 + ((q * 7 + s * 3) % 4) * 0.02;
          bx(bp.d, bp.l, yy, hb, (len - 0.1) / segs - 0.03, deep - 0.12, books[(q + s * 2) % books.length]);
        }
      }
      const cp = at(0, 0);
      bx(cp.d, cp.l, H, 0.08, len + 0.06, deep + 0.04, CV.panel);
    };
    // THE WALL. A solid partition at depth `d` running laterally l0..l1 (or,
    // `lat`, at lateral `l` running in depth d0..d1), with any number of
    // doorways {c, w, leaf: +1/-1 (the side the leaf stands open on), hinge}.
    function wall(lat, at, a0, a1, gaps, o) {
      o = o || {};
      const H = o.h != null ? o.h : WH, hex = o.hex || CV.plaster, trim = o.trim || CV.cream, skirt = o.skirt || CV.walnut;
      const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
      const G = (gaps || []).filter(function (g) { return g && g.c - g.w / 2 > lo + 0.05 && g.c + g.w / 2 < hi - 0.05; })
        .sort(function (p, q) { return p.c - q.c; });
      // one box, in wall space: t along the run, n across it (0 = centreline)
      const wb = function (t, n, y0, hh, len, thick, hx, oo) {
        return lat ? F.box(t, at + n, y0, hh, thick, len, hx, oo) : F.box(at + n, t, y0, hh, len, thick, hx, oo);
      };
      let s0 = lo;
      const segs = [];
      for (const g of G) { segs.push([s0, g.c - g.w / 2]); s0 = g.c + g.w / 2; }
      segs.push([s0, hi]);
      for (const s of segs) {
        const len = s[1] - s[0];
        if (len < 0.05) continue;
        wb((s[0] + s[1]) / 2, 0, 0, H, len, CV_WT, hex, { solid: true });
        for (const sd of [-1, 1]) wb((s[0] + s[1]) / 2, sd * (CV_WT / 2 + 0.01), 0, 0.14, len, 0.02, skirt);
        CIVIC.walls++;
      }
      for (const g of G) {
        { const dp = lat ? A.at(g.c, at) : A.at(at, g.c); if (CV_FIT.doors) CV_FIT.doors.push({ x: dp.x, z: dp.z, w: g.w }); }
        wb(g.c, 0, CV_DOOR, H - CV_DOOR, g.w, CV_WT, hex, { solid: true });
        for (const sd of [-1, 1]) {
          const n = sd * (CV_WT / 2 + 0.02);
          for (const e of [-1, 1]) wb(g.c + e * (g.w / 2 + 0.06), n, 0, CV_DOOR + 0.12, 0.12, 0.04, trim);
          wb(g.c, n, CV_DOOR, 0.12, g.w + 0.24, 0.04, trim);
        }
        // THE DOOR. A real one in the opening, shut, E to open (it used to be
        // a solid leaf painted standing open against the reveal, sticking a
        // metre into the room, a door nobody could close). `leaf` names the
        // side it swings to, `hinge` its jamb; a wide opening is a pair.
        if (g.leaf) {
          const dp = lat ? A.at(g.c, at) : A.at(at, g.c);
          const runX = lat ? Math.abs(A.nx) > 0.5 : Math.abs(A.tx) > 0.5;
          const rS = lat ? Math.sign(runX ? A.nx : A.nz) : Math.sign(runX ? A.tx : A.tz);
          const mS = lat ? Math.sign(runX ? A.tz : A.tx) : Math.sign(runX ? A.nz : A.nx);
          freeDoorway(h, y, dp.x, dp.z, runX, g.w - 0.04, CV_DOOR - 0.02, g.hex || CV.panel,
            ((g.hinge || 1) * rS) || -1, (g.leaf * mS) || 1, g.label || "the door");
        }
        CIVIC.doors++;
      }
    }
    F.wallL = function (d, l0, l1, gaps, o) { wall(false, d, l0, l1, gaps, o); };
    F.wallD = function (l, d0, d1, gaps, o) { wall(true, l, d0, d1, gaps, o); };
    F.anchor = function (list, d, l, face, kind, pose, cushion) {
      const p = A.at(d, l);
      const a = { x: h.ox + p.x, y: y, z: h.oz + p.z, face: face, lx: p.x, lz: p.z, kind: kind || "guard" };
      if (pose) a.pose = pose;
      if (cushion != null) { a.cushionH = cushion; a.floorBelow = 0; }
      list.push(a);
      return a;
    };
    F.seatAnchor = function (list, piece, i, kind, pose) {
      const s = piece && piece.seats && piece.seats[i || 0];
      if (!s) return null;
      const a = { x: s.x, y: y, z: s.z, face: s.face, lx: s.x - h.ox, lz: s.z - h.oz, kind: kind || "clerk", pose: pose || "sit",
        cushionH: s.cushion, floorBelow: 0 };
      list.push(a);
      return a;
    };
    F.free = function (d, l, pad, ignore) { const p = A.at(d, l); return cvFree(h, r, p.x, p.z, pad, ignore); };
    F.piece = function (name, d, l, yaw, opts, pad) {
      const p = A.at(d, l);
      if (!cvFree(h, r, p.x, p.z, pad == null ? 0.2 : pad, opts && opts._ignore)) return null;
      if (!cvDoorClear(p.x, p.z, 1.2)) return null;
      return cvPiece(name, h, y, p.x, p.z, yaw, opts);
    };
    F.walkRect = function (d0, d1, l0, l1, top) {
      const q = F.rect(d0, d1, l0, l1);
      return cvWalk(h, q.x0, q.x1, q.z0, q.z1, y + top);
    };
    F.solidRect = function (d0, d1, l0, l1, y0, y1) {
      const q = F.rect(d0, d1, l0, l1);
      return cvSolid(h, q.x0, q.x1, q.z0, q.z1, y + y0, y + y1);
    };
    return F;
  }

  /* ---- THE ROOMS. Each is dressed in its OWN frame (from its door), so the
     same five lines furnish a suite off a corridor and one off a hall. ------ */
  function cvRoom(h, rect, door) {
    const rr = { x0: rect.x0, x1: rect.x1, z0: rect.z0, z1: rect.z1, y: rect.y };
    if (!(rr.x1 - rr.x0 > 2.4) || !(rr.z1 - rr.z0 > 2.4)) return null;
    CIVIC.rooms++;
    return cvFrame(rr, h, door, 0.03);
  }
  // an outer office: the receptionist facing the door, the visitors' chairs,
  // a flag by the inner door, a painting, a plant, the light
  function roomReception(h, rect, door, anchors, o) {
    const R = cvRoom(h, rect, door);
    if (!R) return;
    o = o || {};
    R.floor(0, R.dep, -R.half, R.half, CV.oak);
    R.rug(1.2, R.dep - 1.0, -R.half + 1.0, R.half - 1.0, o.rug || CV.blue, CV.sand, 0.25);
    const dd = Math.min(3.4, R.dep * 0.45);
    const desk = R.piece("desk", dd, 0, R.faceIn, { len: 1.8, deep: 0.8, tone: CV_LEATHER, solid: true });
    if (desk) R.seatAnchor(anchors, desk, 0, "clerk");
    const wl = R.half - 0.7;
    for (let i = 0; i < 2; i++) R.piece("armchair", 1.6 + i * 1.1, wl, R.faceL(-1), { tone: CV_LEATHER, solid: true });
    R.piece("coffee", 2.15, wl - 0.95, R.faceL(-1), { len: 0.8, deep: 0.5, tone: CV_LEATHER });
    R.piece("planter", R.dep - 0.6, -R.half + 0.6, 0, { kind: "tree", s: 0.8 });
    R.flag(R.dep - 0.8, R.half - 1.4, o.flag || CV.blue);
    R.art(R.wd, 0, -1, 1.6, 1.1, 1.9, 0x3a4a5a);
    R.art(R.dep * 0.55, -R.wl, 1, 1.4, 1.0, 1.8, 0x5a4a3a, true);
    R.light(R.dep / 2, 0, R.ceil - 0.06, 0.06, 1.2, 1.2, CV.day, 0.6);
  }
  // a member's office: the desk at the far end facing the door with the two
  // flags behind it, bookcases on the side walls, a sitting group by the door
  function roomOffice(h, rect, door, anchors, o) {
    const R = cvRoom(h, rect, door);
    if (!R) return;
    o = o || {};
    R.floor(0, R.dep, -R.half, R.half, o.carpet || CV.blue);
    R.rug(R.dep - 4.4, R.dep - 0.8, -Math.min(2.6, R.half - 0.6), Math.min(2.6, R.half - 0.6), CV.red, CV.gold, 0.2);
    const dD = R.dep - 2.3;
    const desk = R.piece("bossDesk", dD, 0, R.faceIn, { len: 2.4, deep: 1.0, tone: CV_LEATHER, solid: true });
    if (desk) R.seatAnchor(anchors, desk, 0, o.boss ? "boss" : "clerk");
    for (const s of [-1, 1]) {
      R.flag(R.dep - 0.7, s * 1.9, s < 0 ? CV.blue : (o.flag || CV.red));
      R.bookcase(R.dep - 1.6, s * (R.wl - 0.2), 2.2, -s, true);
    }
    if (R.half > 2.6) {
      // the sitting group on the side AWAY from the way in
      const sg = R.A.gapLat > 0 ? -1 : 1, sl = sg * (R.half - 1.2);
      R.piece("sofa", 2.6, sl, R.faceL(-sg), { len: 2.0, tone: CV_LEATHER, solid: true });
      R.piece("coffee", 2.6, sl - sg * 1.25, R.faceL(-sg), { len: 1.1, deep: 0.55, tone: CV_LEATHER });
      R.piece("armchair", 2.6, sl - sg * 2.45, R.faceL(sg), { tone: CV_LEATHER, solid: true });
      R.art(2.6, sg * R.wl, -sg, 1.5, 1.0, 1.85, 0x44523e, true);
    }
    R.piece("planter", 0.7, R.half - 0.6, 0, { kind: "tree", s: 0.8 });
    R.chandelier(R.dep / 2, 0, 1.0);
    if (o.guard) R.anchor(anchors, 1.0, Math.min(1.6, R.half - 0.8), R.faceOut, "guard", "foldarms");
  }
  // THE SEAL SCREEN: a panelled reredos standing 0.45 m off the far wall (so
  // it never covers a window), the gilt medallion on it, a cornice
  function sealScreen(h, R, y0, w, hgt, hex) {
    const d = R.wd - 0.5;
    { const p = R.p(d, 0); if (!cvDoorClear(p.x, p.z, w / 2 + 0.4)) return; }
    R.box(d, 0, y0, hgt, w, 0.12, CV.panel, { solid: true });
    R.box(d, 0, y0 + hgt, 0.14, w + 0.2, 0.2, CV.gold);
    for (const s of [-1, 1]) R.box(d - 0.06, s * (w / 2 - 0.2), y0, hgt, 0.3, 0.06, CV.panelL);
    const T = window.THREE;
    if (T && h.b.group) {
      const p = R.p(d - 0.1, 0);
      const g = new T.CylinderGeometry(Math.min(0.95, w * 0.2), Math.min(0.95, w * 0.2), 0.06, 32);
      g.rotateX(Math.PI / 2);
      const m = new T.Mesh(g, cvMat(CV.gold));
      m.position.set(p.x, R.y + y0 + hgt * 0.6, p.z);
      m.rotation.y = Math.atan2(-R.A.nx, -R.A.nz);
      m.matrixAutoUpdate = false; m.updateMatrix();
      h.b.group.add(m);
      const g2 = new T.CylinderGeometry(Math.min(0.72, w * 0.15), Math.min(0.72, w * 0.15), 0.07, 32);
      g2.rotateX(Math.PI / 2);
      const m2 = new T.Mesh(g2, cvMat(hex || CV.blue));
      m2.position.set(p.x - R.A.nx * 0.02, R.y + y0 + hgt * 0.6, p.z - R.A.nz * 0.02);
      m2.rotation.y = m.rotation.y;
      m2.matrixAutoUpdate = false; m2.updateMatrix();
      h.b.group.add(m2);
    }
  }
  /* A HEARING ROOM: the members' bench on a two-riser dais across the far
     side (both steps registered walk surfaces, 0.15 each), the seal screen and
     the flags behind it, the witness table facing it, the public in benches. */
  function roomHearing(h, rect, door, anchors, o) {
    const R = cvRoom(h, rect, door);
    if (!R) return;
    o = o || {};
    R.floor(0, R.dep, -R.half, R.half, o.carpet || CV.red);
    const hw = R.half - 0.2;
    const DD = Math.max(2.5, Math.min(3.8, R.dep * 0.42));
    const dB = R.dep - DD;                   // the dais' front edge
    R.box(dB + 0.2, 0, 0, 0.15, 2 * hw, 0.4, CV.walnut);
    R.walkRect(dB, dB + 0.4, -hw, hw, 0.15);
    R.box((dB + 0.4 + R.wd) / 2, 0, 0, 0.30, 2 * hw, R.wd - dB - 0.4, CV.walnut);
    R.walkRect(dB + 0.4, R.wd, -hw, hw, 0.30);
    R.box((dB + 0.4 + R.dep) / 2, 0, 0.30 - 0.004, 0.008, 2 * hw - 0.4, R.dep - dB - 0.5, o.dais || CV.blue);
    // the bench: a panelled front a metre over the dais, a desktop, and a
    // leather chair per member behind it; clear ends so the dais is reachable
    const bl = Math.max(2, 2 * hw - 2.2), bd = dB + 0.75;
    R.box(bd, 0, 0.30, 0.98, bl, 0.12, CV.panel, { solid: true });
    R.box(bd + 0.28, 0, 1.2, 0.05, bl + 0.1, 0.62, CV.panelL);
    const nM = Math.max(3, Math.min(13, Math.floor(bl / 1.25)));
    for (let i = 0; i < nM; i++) {
      const l = -bl / 2 + (i + 0.5) * bl / nM;
      R.box(bd + 0.35, l, 1.25, 0.06, 0.34, 0.08, CV.gold);                      // nameplate
      R.box(bd + 0.45, l + 0.22, 1.25, 0.28, 0.02, 0.02, CV.ink);                // microphone
      const cp = R.p(bd + 0.95, l);
      const ch = cvPiece("chair", h, R.y + 0.30, cp.x, cp.z, R.faceIn, { tone: o.tone || CV_LEATHER, solid: true });
      if (ch && i % 3 === 1) R.seatAnchor(anchors, ch, 0, "clerk");
    }
    if (R.wd - (bd + 1.5) > 0.6) sealScreen(h, R, 0.30, Math.min(3.0, bl * 0.4), 2.4, o.dais || CV.blue);
    for (const s of [-1, 1]) R.flag(R.dep - 0.3, s * Math.min(hw - 0.6, bl * 0.2 + 1.0), s < 0 ? CV.blue : CV.red);
    // the witness table, three chairs facing the bench
    const wd = dB - 2.4;
    if (wd > 3.2) {
      R.piece("table", wd, 0, R.faceIn, { len: 3.0, deep: 0.9, seats: 0, tone: CV_LEATHER, solid: true });
      for (const l of [-0.9, 0, 0.9]) R.piece("chair", wd - 0.85, l, R.faceOut, { tone: CV_LEATHER, solid: true });
      for (const l of [-0.9, 0.9]) R.box(wd, l, 0.74, 0.28, 0.02, 0.02, CV.ink);
      // the public, in benches behind the witnesses, an aisle down the middle
      const bl2 = Math.max(1.2, Math.min(3.6, hw - 1.4));
      for (let d = 1.6; d < wd - 2.0; d += 1.25)
        for (const s of [-1, 1]) R.piece("bench", d, s * (0.8 + bl2 / 2), R.faceOut, { len: bl2, tone: CV_LEATHER, solid: true });
    }
    for (const s of [-1, 1]) {
      R.art(R.dep * 0.45, s * R.wl, -s, 1.8, 1.2, 2.0, s < 0 ? 0x3a4450 : 0x4a3a30, true);
      R.light(R.dep * 0.3, s * (R.wl - 0.08), 2.3, 0.4, 0.14, 0.5, CV.lamp, 0.8);
    }
    R.chandelier(R.dep * 0.35, 0, 1.4);
    R.chandelier(R.dep * 0.7, 0, 1.4);
    R.anchor(anchors, 1.0, Math.min(1.8, R.half - 0.8), R.faceOut, "guard", "foldarms");
  }
  // a library: cases on the side walls, reading tables with green lamps, a rug
  function roomLibrary(h, rect, door, anchors) {
    const R = cvRoom(h, rect, door);
    if (!R) return;
    R.floor(0, R.dep, -R.half, R.half, CV.oak);
    R.rug(1.5, R.dep - 1.5, -R.half + 1.6, R.half - 1.6, CV.green, CV.gold, 0.3);
    for (const s of [-1, 1]) {
      const n = Math.max(1, Math.floor((R.dep - 2.4) / 2.2));
      for (let i = 0; i < n; i++) R.bookcase(1.6 + i * 2.2 + 1.0, s * (R.wl - 0.2), 2.0, -s, true);
    }
    const nF = Math.max(1, Math.floor((2 * R.half - 1.2) / 2.2));
    for (let i = 0; i < nF; i++) R.bookcase(R.wd - 0.2, -R.half + 0.6 + (i + 0.5) * (2 * R.half - 1.2) / nF, 2.0, -1);
    const tl = Math.min(3.0, R.half * 0.45);
    for (let d = 3.0; d < R.dep - 2.5; d += 3.2) for (const s of [-1, 1]) {
      const t = R.piece("table", d, s * tl, R.faceIn, { len: 2.2, deep: 1.0, seats: 4, tone: CV_LEATHER, solid: true });
      if (!t) continue;
      for (const q of [-0.55, 0.55]) {
        R.box(d, s * tl + q, 0.74, 0.3, 0.04, 0.04, CV.gold);
        R.light(d, s * tl + q, 1.04, 0.1, 0.34, 0.2, 0x3f7a55, 0.6);
      }
      if (d < 4) R.seatAnchor(anchors, t, 0, "clerk");
    }
    R.chandelier(R.dep * 0.33, 0, 1.4);
    R.chandelier(R.dep * 0.66, 0, 1.4);
  }
  /* THE PRINCIPAL'S OFFICE: the desk before the seal screen between two
     standards, a fireplace on the side wall and the sitting group facing it,
     a conference table for eight, bookcases. The one "boss" anchor in the
     building, and the two men at his door. */
  function roomLeader(h, rect, door, anchors, o) {
    const R = cvRoom(h, rect, door);
    if (!R) return;
    o = o || {};
    R.floor(0, R.dep, -R.half, R.half, CV.oak);
    R.rug(R.dep * 0.45, R.dep - 1.1, -Math.min(4.0, R.half - 1), Math.min(4.0, R.half - 1), o.rug || CV.blue, CV.gold, 0.35);
    const dD = R.dep - 2.9;
    const desk = R.piece("bossDesk", dD, 0, R.faceIn, { len: 2.8, deep: 1.1, tone: CV_LEATHER, solid: true });
    if (desk) R.seatAnchor(anchors, desk, 0, "boss", "sit");
    sealScreen(h, R, 0, 3.4, 3.0, o.rug || CV.blue);
    for (const s of [-1, 1]) R.flag(R.dep - 0.9, s * 2.3, s < 0 ? CV.blue : CV.red);
    // the fireplace on the -l wall: surround, mantel, firebox, the embers
    const fd = R.dep * 0.35, fl = -R.wl;
    const fp = R.p(fd, fl + 0.2);
    if (!cvGlazed(h, fp.x, fp.z, 1.2, R.y, R.y + 2.5) && cvDoorClear(fp.x, fp.z, 1.6)) {
      R.box(fd, fl + 0.15, 0, 1.3, 0.3, 2.2, CV.marble, { solid: true });
      R.box(fd, fl + 0.22, 1.3, 0.1, 0.45, 2.5, CV.marble);
      R.box(fd, fl + 0.32, 0.05, 0.75, 0.04, 1.1, CV.ink);
      R.light(fd, fl + 0.35, 0.06, 0.12, 0.03, 0.9, 0xff8a3a, 0.9);
      R.art(fd, fl, 1, 1.4, 1.1, 2.4, 0x5a3a2a, true);
    }
    // the sitting group facing the fire
    R.piece("sofa", fd, fl + 3.4, R.faceL(-1), { len: 2.2, tone: CV_LEATHER, solid: true });
    R.piece("coffee", fd, fl + 2.1, R.faceL(-1), { len: 1.2, deep: 0.6, tone: CV_LEATHER });
    for (const q of [-1, 1]) R.piece("armchair", fd + q * 1.7, fl + 2.0, R.faceL(-1), { tone: CV_LEATHER, solid: true });
    // the conference table on the +l side
    if (R.half > 5) {
      const t = R.piece("table", R.dep * 0.42, R.half - 2.4, R.faceL(1), { len: 3.6, deep: 1.2, seats: 8, tone: CV_LEATHER, solid: true });
      if (t) R.seatAnchor(anchors, t, 1, "clerk");
      R.chandelier(R.dep * 0.42, R.half - 2.4, 1.2);
    }
    for (let i = 0; i < 2; i++) R.bookcase(R.dep * 0.62 + i * 2.2, R.wl - 0.2, 2.0, -1, true);
    R.chandelier(R.dep * 0.62, 0, 1.6);
    R.piece("planter", 0.8, -R.half + 0.7, 0, { kind: "tree", s: 0.9 });
    R.anchor(anchors, 1.0, 1.5, R.faceOut, "guard", "foldarms");
    R.anchor(anchors, 1.0, -1.5, R.faceOut, "guard", "foldarms");
  }
  // a hall of busts: a checkered marble floor, plinths along both walls, benches
  function roomStatuary(h, rect, door, anchors) {
    const R = cvRoom(h, rect, door);
    if (!R) return;
    R.floor(0, R.dep, -R.half, R.half, CV.marble);
    const sq = 1.2;
    for (let d = 0.6; d < R.dep - 0.6 - sq; d += sq) for (let l = -R.half + 0.6; l < R.half - 0.6 - sq; l += sq) {
      if ((Math.round(d / sq) + Math.round(l / sq)) % 2) R.box(d + sq / 2, l + sq / 2, CV_INLAY - 0.004, 0.004, sq, sq, CV.marbleV);
    }
    for (const s of [-1, 1]) for (let d = 2.2; d < R.dep - 1.4; d += 3.0) {
      const l = s * (R.half - 0.45);
      R.box(d, l, 0, 1.15, 0.6, 0.6, CV.marbleD, { solid: true });
      R.box(d, l, 1.15, 0.08, 0.72, 0.72, CV.marble);
      // a bronze bust: shoulders, neck, head
      R.box(d, l, 1.23, 0.26, 0.46, 0.28, CV.bronze);
      R.box(d, l, 1.49, 0.1, 0.12, 0.12, CV.bronze);
      R.box(d, l, 1.59, 0.28, 0.2, 0.24, CV.bronze);
      if (d + 1.5 < R.dep - 1.4) R.art(d + 1.5, s * R.wl, -s, 1.6, 1.2, 2.4, 0x3a3a44, true);
    }
    for (let d = 3.0; d < R.dep - 2.0; d += 4.0) R.piece("bench", d, 0, R.faceL(1), { len: 2.4, tone: CV_LEATHER, solid: true });
    R.chandelier(R.dep * 0.33, 0, 1.6);
    R.chandelier(R.dep * 0.66, 0, 1.6);
  }

  /* ---- THE CAPITOL'S FLOORS --------------------------------------------------
     One plan for all three: the rotunda (or, upstairs, the gallery round its
     well) at the centre, the cross corridor through it to both ends of the
     block, suites front and back of the corridor in columns of ~11 m, a hall
     (or a great room) on the axis in front of and behind the rotunda. The
     column a stair core stands in is left open as the core's stair hall. */
  function capitolPlan(r, h, k) {
    const b = h.b, plan = b._civicPlan || {};
    const RO = plan.rotunda || { x: 0, z: 0, r: 11.2, well: 7.4, band: 12.5 };
    const F = cvFrame(r, h, b.localDoor);
    const c = F.inv(RO.x, RO.z), dC = c.d, lC = c.l;
    const E = 0.4;                                  // the plate edge to the wall face
    const dF = -E, dK = F.dep + E, lMax = F.half + E;
    const CX = Math.min(RO.band || RO.r + 1.3, lMax * 0.4), CW = 2.5;
    const dmF = (dF + dC - CW) / 2, dmB = (dC + CW + dK) / 2;
    const cw = (lMax - CX) / 3;
    const core = cvCore(h);
    const out = { F: F, dC: dC, lC: lC, CX: CX, CW: CW, rooms: [], RO: RO, dF: dF, dK: dK };
    const wallsL = [], wallsD = [];
    for (const side of [-1, 1]) for (const blk of [-1, 1]) {
      // blk -1: in front of the corridor (toward the door); +1: behind it
      const dA = blk < 0 ? dC - CW : dC + CW;          // the corridor wall
      const dM = blk < 0 ? dmF : dmB;                   // between the rows
      const dE = blk < 0 ? dF : dK;                     // the block's outer wall
      const one = k === 1 && blk < 0;                   // floor 1 front: hearing rooms
      for (let ci = 0; ci < 3; ci++) {
        const la = lC + side * (CX + ci * cw), lb = lC + side * (CX + (ci + 1) * cw);
        const l0 = Math.min(la, lb), l1 = Math.max(la, lb), lm = (l0 + l1) / 2;
        const box = F.rect(Math.min(dA, dE), Math.max(dA, dE), l0, l1);
        const open = core.some(function (q) { return rectHits(box, q, 0.6); });
        if (open) { out.rooms.push({ open: true, l0: l0, l1: l1, d0: Math.min(dA, dE), d1: Math.max(dA, dE) }); continue; }
        // the corridor wall with this suite's double door
        wallsL.push([dA, l0, l1, [{ c: lm, w: 1.8, leaf: blk, hinge: -side }]]);
        // the rooms: A (on the corridor), B (behind it, through A)
        const i0 = 0.12;
        const dAin = dA + blk * i0, dMa = dM - blk * i0, dMb = dM + blk * i0, dEin = dE - blk * 0.05;
        if (one) {
          out.rooms.push({ type: "hearing", rect: F.rect(Math.min(dAin, dEin), Math.max(dAin, dEin), l0 + i0, l1 - i0), door: F.door(dA, lm, blk) });
        } else {
          wallsL.push([dM, l0, l1, [{ c: lm + side * (cw / 2 - 1.4), w: 1.2, leaf: blk, hinge: side }]]);
          out.rooms.push({ type: "reception", rect: F.rect(Math.min(dAin, dMa), Math.max(dAin, dMa), l0 + i0, l1 - i0), door: F.door(dA, lm, blk) });
          out.rooms.push({ type: "office", rect: F.rect(Math.min(dMb, dEin), Math.max(dMb, dEin), l0 + i0, l1 - i0), door: F.door(dM, lm + side * (cw / 2 - 1.4), blk) });
        }
      }
      // the column walls (the centre band's side, and between the suites)
      for (let ci = 0; ci < 3; ci++) {
        const lw = lC + side * (CX + ci * cw);
        const lo = Math.min(dA, dE), hi = Math.max(dA, dE);
        wallsD.push([lw, lo, hi, []]);
      }
    }
    for (const w of wallsL) F.wallL(w[0], w[1], w[2], w[3]);
    for (const w of wallsD) {
      // a column wall between two OPEN columns is nobody's wall
      const lw = w[0];
      const openL = out.rooms.some(function (q) { return q.open && Math.abs(q.l1 - lw) < 0.01 && q.d0 <= w[1] + 0.01 && q.d1 >= w[2] - 0.01; });
      const openR = out.rooms.some(function (q) { return q.open && Math.abs(q.l0 - lw) < 0.01 && q.d0 <= w[1] + 0.01 && q.d1 >= w[2] - 0.01; });
      if (openL && openR) continue;
      F.wallD(lw, w[1], w[2], w[3]);
    }
    return out;
  }
  // dress every room the plan produced
  function capitolDress(h, P, anchors, k) {
    for (const q of P.rooms) {
      if (q.open) continue;
      if (q.type === "hearing") roomHearing(h, q.rect, q.door, anchors, {});
      else if (q.type === "reception") roomReception(h, q.rect, q.door, anchors, {});
      else if (q.type === "office") roomOffice(h, q.rect, q.door, anchors, { carpet: k === 2 ? CV.green : CV.blue });
    }
    // the corridor: marble, a runner, lights down its length; the open stair
    // halls marble too
    const F = P.F;
    for (const q of P.rooms) if (q.open) F.floor(q.d0 + 0.05, q.d1 - 0.05, q.l0 + 0.05, q.l1 - 0.05, CV.marble);
    for (const side of [-1, 1]) {
      const l0 = P.lC + side * P.CX, l1 = P.lC + side * (P.F.half + 0.4);
      F.floor(P.dC - P.CW + 0.1, P.dC + P.CW - 0.1, Math.min(l0, l1), Math.max(l0, l1), CV.marble);
      F.rug(P.dC - 0.9, P.dC + 0.9, Math.min(l0, l1) + 0.6, Math.max(l0, l1) - 1.0, CV.red, CV.gold, 0.12);
      for (let t = 4; t < Math.abs(l1 - l0) - 2; t += 7) F.light(P.dC, P.lC + side * (P.CX + t), F.ceil - 0.05, 0.05, 1.0, 1.0, CV.day, 0.65);
    }
  }
  // the well's edge, on an upper floor: a balustrade you lean on, never step through
  function wellRail(F, dC, lC, W) {
    const bal = [];
    const run = function (lat, at, a0, a1) {
      const len = Math.abs(a1 - a0), mid = (a0 + a1) / 2;
      if (lat) {
        F.box(mid, at, 0, 0.16, 0.34, len, CV.marbleD);
        F.box(mid, at, 0.86, 0.14, 0.42, len + 0.1, CV.marble);
        F.solidRect(Math.min(a0, a1), Math.max(a0, a1), at - 0.2, at + 0.2, 0, 1.0);
      } else {
        F.box(at, mid, 0, 0.16, len, 0.34, CV.marbleD);
        F.box(at, mid, 0.86, 0.14, len + 0.1, 0.42, CV.marble);
        F.solidRect(at - 0.2, at + 0.2, Math.min(a0, a1), Math.max(a0, a1), 0, 1.0);
      }
      const n = Math.max(1, Math.floor(len / 0.3));
      for (let i = 0; i < n; i++) {
        const t = Math.min(a0, a1) + (i + 0.5) * len / n;
        const p = lat ? F.p(t, at) : F.p(at, t);
        bal.push({ x: p.x, y: F.y + 0.16, z: p.z });
      }
    };
    const e = W + 0.2;
    run(false, dC - e, lC - e, lC + e);
    run(false, dC + e, lC - e, lC + e);
    run(true, lC - e, dC - e + 0.2, dC + e - 0.2);
    run(true, lC + e, dC - e + 0.2, dC + e - 0.2);
    if (bal.length && window.THREE && F.h.b.group) {
      const T = window.THREE;
      const g = new T.LatheGeometry([[0, 0], [0.085, 0], [0.085, 0.05], [0.06, 0.09], [0.1, 0.26], [0.05, 0.46],
        [0.045, 0.52], [0.075, 0.56], [0.075, 0.64], [0, 0.64]].map(function (q) { return new T.Vector2(q[0], q[1]); }), 10);
      const im = new T.InstancedMesh(g, cvMat(CV.marble), bal.length);
      const o = new T.Object3D();
      for (let i = 0; i < bal.length; i++) {
        o.position.set(bal[i].x, bal[i].y, bal[i].z); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      im.name = "civic-well-balusters";
      F.h.b.group.add(im);
    }
    CIVIC.galleries++;
  }

  /* THE CAPITOL'S GRAND STAIR — from the rotunda floor to the gallery floor,
     in the core's own stair hall (the open column behind the corridor), along
     its inner wall: two marble flights of ~0.165 m risers on 0.42 m goings
     with a half landing, rising toward the back so you step off upstairs
     beside the core's landing. Built from the shared kit only: two
     CBZ.stairs.flight with `steps` (the walk surface IS the treads drawn
     here), CBZ.cityCarveShaft opening slab 1 over it (and reserving it, so
     lbox clips anything a program draws in that band), a solid stepped mass
     with a collider per tread, and a balustrade on the open side whose rail
     is solid. The guard round the opening upstairs is the gallery floor's
     (capitolfloor reads plan.stair). */
  function capitolStair(h, F, P) {
    const b = h.b, tops = b.floorTops, plan = b._civicPlan;
    if (!plan || !CBZ.stairs || !CBZ.stairs.flight || !CBZ.cityCarveShaft || !Array.isArray(tops) || tops.length < 3) return null;
    const col = P.rooms.find(function (q) { return q.open && q.d0 > P.dC; });
    if (!col) return null;
    const inner = Math.abs(col.l0 - P.lC) < Math.abs(col.l1 - P.lC) ? col.l0 : col.l1;
    const sg = inner === col.l0 ? 1 : -1;                 // from the inner wall toward the core
    const W = 3.0, la = inner + sg * 0.1, lb = la + sg * W, lc = (la + lb) / 2;
    const lo = Math.min(la, lb), hi = Math.max(la, lb);
    const y0 = tops[0], y1 = tops[1];
    const nTot = Math.max(8, Math.round((y1 - y0) / 0.165)), n1 = Math.ceil(nTot / 2), n2 = nTot - n1;
    const rise = (y1 - y0) / nTot, go = 0.42, LAND = 1.8, RH = 0.95;
    const dBot = P.dC + P.CW + 1.4, dL0 = dBot + n1 * go, dL1 = dL0 + LAND, dTop = dL1 + n2 * go;
    const yL = y0 + n1 * rise;
    if (dTop > P.dK - 2.4) return null;
    const foot = F.rect(dBot - 0.4, dTop + 1.2, lo - 0.1, hi + 0.6);
    if (cvCore(h).some(function (q) { return rectHits(foot, q, 0.1); })) return null;
    // 1. the opening in slab 1
    const hole = F.rect(dBot - 0.1, dTop, lo - 0.1, hi + (sg > 0 ? 0.25 : 0.1));
    const hole2 = F.rect(dBot - 0.1, dTop, lo - (sg < 0 ? 0.25 : 0.1), hi + 0.1);
    const Hh = sg > 0 ? hole : hole2;
    CBZ.cityCarveShaft(b, h.ox + (Hh.x0 + Hh.x1) / 2, h.oz + (Hh.z0 + Hh.z1) / 2, (Hh.x1 - Hh.x0) / 2, (Hh.z1 - Hh.z0) / 2, { levels: [1], reserve: true });
    // 2. the walk surface
    const W3 = function (d, l, y) { const p = F.p(d, l); return { x: h.ox + p.x, y: y, z: h.oz + p.z }; };
    const fl = [];
    fl.push(CBZ.stairs.flight({ bottom: W3(dBot, lc, y0), top: W3(dL0, lc, yL), width: W, overlap: 0.3, steps: n1, owner: b, plats: b.platforms || undefined, cols: b.colliders || undefined, kind: "stair" }));
    fl.push(CBZ.stairs.flight({ bottom: W3(dL1, lc, yL), top: W3(dTop, lc, y1), width: W, overlap: 0.3, steps: n2, owner: b, plats: b.platforms || undefined, cols: b.colliders || undefined, kind: "stair" }));
    F.walkRect(dL0 - 0.02, dL1 + 0.02, lo, hi, yL - F.y);
    // 3. the stair you see: a stepped marble mass, a nosing, a red runner
    const MARBLE = 0xe4e0d6, NOSE = 0xf1eee6;
    const treads = [];
    const mass = function (dStart, base, n) {
      for (let i = 1; i <= n; i++) {
        const top = base + i * rise - F.y, dc = dStart + (i - 0.5) * go, dFront = dStart + (i - 1) * go;
        F.box(dc, lc, 0, top, W, go + 0.004, MARBLE, { stair: true, cast: i === n });
        F.box(dFront + 0.035, lc, top - 0.03, 0.03, W + 0.04, 0.07, NOSE, { stair: true });
        F.box(dc, lc, top, 0.012, 1.9, go - 0.02, CV.red, { stair: true });
        F.box(dFront + 0.07, lc, top + 0.012, 0.012, 1.98, 0.012, CV.gold, { stair: true });
        F.solidRect(dc - go / 2, dc + go / 2, lo, hi, -0.05, top);
        const p = F.p(dc, lc);
        treads.push({ x: h.ox + p.x, z: h.oz + p.z, top: base + i * rise, w: W, go: go });
      }
    };
    mass(dBot, y0, n1);
    F.box((dL0 + dL1) / 2, lc, 0, yL - F.y, W, LAND + 0.004, MARBLE, { stair: true });
    F.box((dL0 + dL1) / 2, lc, yL - F.y, 0.012, 1.9, LAND - 0.1, CV.red, { stair: true });
    F.solidRect(dL0, dL1, lo, hi, -0.05, yL - F.y);
    mass(dL1, yL, n2);
    // the open side's closed string, stepped with the flights
    const sO = lb + sg * 0.03;
    F.box((dBot + dL1) / 2, sO, 0, yL - F.y, 0.06, dL1 - dBot, 0xd8d2c4, { stair: true });
    F.box((dL1 + dTop) / 2, sO, 0, y1 - F.y, 0.06, dTop - dL1, 0xd8d2c4, { stair: true });
    // 4. THE BALUSTRADE on the open side: two balusters a tread, a sloped
    //    brass rail per flight, a level one over the landing, four newels; solid
    const railL = lb - sg * 0.08;
    const T = window.THREE;
    const slopeRail = function (dStart, base, n, l, hgt) {
      if (!T || !b.group) return;
      const len = Math.hypot(n * go, n * rise);
      const g = new T.BoxGeometry(0.09, 0.07, len);
      g.rotateX(-Math.atan2(n * rise, n * go));
      g.rotateY(Math.atan2(F.A.nx, F.A.nz));
      const mid = F.p(dStart + n * go / 2, l);
      g.translate(mid.x, base + (n * rise) / 2 + rise / 2 + hgt, mid.z);
      const m = new T.Mesh(g, cvMat(CV.gold));
      m.castShadow = false; m.matrixAutoUpdate = false; m.updateMatrix();
      b.group.add(m);
    };
    const railRun = function (dStart, base, n) {
      for (let i = 0; i < n; i++) {
        const t = base + (i + 1) * rise - F.y;
        for (const f of [0.28, 0.72]) F.box(dStart + (i + f) * go, railL, t, RH - 0.05, 0.045, 0.045, MARBLE, { stair: true });
      }
      slopeRail(dStart, base, n, railL, RH);
      slopeRail(dStart, base, n, la + sg * 0.07, 0.9);                     // the wall rail
      const segs = Math.ceil(n * go / 0.5);
      for (let k = 0; k < segs; k++) {
        const da = dStart + k * n * go / segs, db = dStart + (k + 1) * n * go / segs;
        const lo2 = base + Math.floor(k * n / segs) * rise - F.y, hi2 = base + Math.ceil((k + 1) * n / segs) * rise - F.y;
        F.solidRect(da, db, Math.min(railL - 0.07, railL + 0.07), Math.max(railL - 0.07, railL + 0.07), lo2 + 0.1, hi2 + RH + 0.05);
      }
    };
    railRun(dBot, y0, n1);
    railRun(dL1, yL, n2);
    for (let d = dL0 + 0.25; d < dL1 - 0.1; d += 0.3) F.box(d, railL, yL - F.y, RH - 0.05, 0.045, 0.045, MARBLE, { stair: true });
    F.box((dL0 + dL1) / 2, railL, yL - F.y + RH, 0.07, 0.09, LAND, CV.gold, { stair: true });
    F.solidRect(dL0, dL1, railL - 0.07, railL + 0.07, yL - F.y + 0.1, yL - F.y + RH + 0.05);
    for (const e of [[dBot - 0.18, y0], [dL0, yL], [dL1, yL], [dTop + 0.2, y1]]) {
      F.box(e[0], railL, e[1] - F.y, 1.2, 0.3, 0.3, MARBLE, { stair: true });
      F.box(e[0], railL, e[1] - F.y + 1.2, 0.1, 0.36, 0.36, NOSE, { stair: true });
      F.box(e[0], railL, e[1] - F.y + 1.3, 0.12, 0.16, 0.16, CV.gold, { stair: true });
    }
    F.solidRect(dBot - 0.33, dBot - 0.03, railL - 0.15, railL + 0.15, -0.05, 1.3);
    // 5. light over the well: a lantern from the slab above the landing
    {
      const top2 = tops[2] - 0.2 - F.y, ly = Math.max(yL - F.y + 2.6, top2 - 1.1);
      F.box((dL0 + dL1) / 2, lc, ly, top2 - ly, 0.04, 0.04, CV.gold, { stair: true });
      const p = F.p((dL0 + dL1) / 2, lc);
      cvGlow(0xfff0c8, 0.9, 0.6, 0.5, 0.6, p.x, F.y + ly - 0.25, p.z);
    }
    const rec = { d0: dBot - 0.1, d1: dTop, lo: Math.min(Hh === hole ? lo - 0.1 : lo - 0.25, hi), hi: Hh === hole ? hi + 0.25 : hi + 0.1,
      open: lb, sg: sg, treads: treads, links: fl.map(function (f) { return f && f.link ? f.link.id : null; }) };
    plan.stair = rec;                  // the plan object is shared by the shell and its lot copy
    return rec;
  }
  // upstairs: the guard round the grand stair's opening (the side toward the
  // stair hall and the end over the stair's foot; the far end is the arrival)
  function capitolStairGuard(F, S) {
    if (!S) return;
    const lOpen = S.sg > 0 ? S.hi : S.lo;
    const run = function (lat, at, a0, a1) {
      const len = Math.abs(a1 - a0), mid = (a0 + a1) / 2;
      if (lat) {
        F.box(mid, at, 0, 0.95, 0.2, len, CV.marbleD);
        F.box(mid, at, 0.95, 0.08, 0.3, len + 0.06, CV.marble);
        F.solidRect(Math.min(a0, a1), Math.max(a0, a1), at - 0.12, at + 0.12, 0, 1.03);
      } else {
        F.box(at, mid, 0, 0.95, len, 0.2, CV.marbleD);
        F.box(at, mid, 0.95, 0.08, len + 0.06, 0.3, CV.marble);
        F.solidRect(at - 0.12, at + 0.12, Math.min(a0, a1), Math.max(a0, a1), 0, 1.03);
      }
    };
    run(true, lOpen + S.sg * 0.12, S.d0, S.d1 - 1.2);
    run(false, S.d0 - 0.12, S.lo, S.hi);
  }
  // THE ROTUNDA — the Capitol's ground floor
  function progRotunda(r, h, opts) {
    cvFitStart(r, h);
    const b = h.b, plan = b._civicPlan || {};
    const RO = plan.rotunda || { x: 0, z: 0, r: 11.2, well: 7.4, band: 12.5 };
    const nF = Array.isArray(b.floorTops) ? b.floorTops.length - 1 : (b.storeys | 0);
    // 1. THE WELL: every slab over the rotunda, and the roof under the dome
    //    when there is a dome to look up into
    let well = null;
    if (CBZ.cityCarveShaft && nF >= 2) {
      const lv = [];
      for (let L = 1; L <= nF; L++) lv.push(L);
      CBZ.cityCarveShaft(b, h.ox + RO.x, h.oz + RO.z, RO.well, RO.well, { levels: lv, roof: !!plan.dome, reserve: true });
      well = (b.shaftRects || []).find(function (q) { return Math.abs(q.x0 - (RO.x - RO.well)) < 1e-3 && Math.abs(q.z0 - (RO.z - RO.well)) < 1e-3; }) || null;
      b._civicWell = well;
      CIVIC.carved++;
    }
    shell(h, r);
    const anchors = [];
    const P = capitolPlan(r, h, 0);
    const F = P.F, dC = P.dC, lC = P.lC, RR = RO.r;
    // 2. THE ROTUNDA: a compass floor, sixteen columns in a ring, the ring
    //    beam under the gallery floor, benches between the columns
    const T = window.THREE, cc = F.p(dC, lC);
    const disc = function (rad, lift, hex, ring0) {
      const g = ring0 ? new T.RingGeometry(ring0, rad, 64, 1) : new T.CircleGeometry(rad, 64);
      g.rotateX(-Math.PI / 2);
      const m = new T.Mesh(g, cvMat(hex));
      m.position.set(cc.x, r.y + lift, cc.z);
      m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
      b.group.add(m);
      return m;
    };
    F.floor(dC - P.CX + 0.1, dC + P.CX - 0.1, lC - P.CX + 0.1, lC + P.CX - 0.1, CV.marble);
    disc(RR - 0.6, CV_INLAY, CV.marbleV, RR - 1.2);
    disc(6.2, CV_INLAY, CV.marbleD, 5.8);
    disc(3.1, CV_INLAY, CV.marbleV, 2.8);
    const star = new T.Shape();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, rr = i % 2 ? 1.1 : (i % 4 ? 2.1 : 2.7);
      if (i === 0) star.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else star.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    const sg = new T.ShapeGeometry(star); sg.rotateX(-Math.PI / 2);
    const sm = new T.Mesh(sg, cvMat(CV.gold)); sm.position.set(cc.x, r.y + CV_TOP, cc.z); sm.matrixAutoUpdate = false; sm.updateMatrix(); b.group.add(sm);
    const K = CBZ.civicMonument;
    const ceil = F.ceil;
    const colPts = [];
    for (let i = 0; i < 16; i++) {
      const a = ((i + 0.5) / 16) * Math.PI * 2;
      const x = cc.x + Math.cos(a) * RR, z = cc.z + Math.sin(a) * RR;
      colPts.push({ x: x, z: z, a: a });
      cvSolid(h, x - 0.72, x + 0.72, z - 0.72, z + 0.72, r.y, r.y + 3.0);   // the plinth, turned: its corners too
    }
    if (K && K.columnGeo) {
      const g = K.columnGeo(0.36, ceil - 0.62);
      const im = new T.InstancedMesh(g, cvMat(CV.marble), colPts.length);
      const o = new T.Object3D();
      colPts.forEach(function (p, i) { o.position.set(p.x, r.y, p.z); o.rotation.set(0, -p.a, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
      im.instanceMatrix.needsUpdate = true; im.castShadow = true; im.receiveShadow = true;
      im.name = "civic-rotunda-columns";
      b.group.add(im);
      // the ring beam the columns carry, flush under the gallery slab
      const beam = new T.CylinderGeometry(RR + 0.6, RR + 0.6, 0.62, 64, 1, true);
      const beamI = new T.CylinderGeometry(RR - 0.6, RR - 0.6, 0.62, 64, 1, true);
      const soff = new T.RingGeometry(RR - 0.6, RR + 0.6, 64, 1); soff.rotateX(Math.PI / 2);
      for (const pair of [[beam, CV.marble, false], [beamI, CV.marble, true], [soff, CV.marbleD, false]]) {
        const m = new T.Mesh(pair[0], pair[2] ? new T.MeshLambertMaterial({ color: pair[1], side: T.BackSide }) : cvMat(pair[1]));
        m.position.set(cc.x, r.y + ceil - 0.31 + (pair[0] === soff ? -0.31 : 0), cc.z);
        m.matrixAutoUpdate = false; m.updateMatrix();
        b.group.add(m);
      }
    }
    // four bronze torcheres on the diagonals; a rope on four posts round the star
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      const px = cc.x + Math.cos(a) * (RR - 1.8), pz = cc.z + Math.sin(a) * (RR - 1.8);
      if (!cvFree(h, r, px, pz, 0.3, well)) continue;
      h.b.lbox(px, r.y + 0.05, pz, 0.5, 0.1, 0.5, CV.bronze, { cast: false });
      h.b.lbox(px, r.y + 1.1, pz, 0.08, 2.0, 0.08, CV.bronze, { cast: false });
      cvGlow(CV.lamp, 0.9, 0.42, 0.3, 0.42, px, r.y + 2.25, pz);
      cvSolid(h, px - 0.25, px + 0.25, pz - 0.25, pz + 0.25, r.y, r.y + 2.4);
    }
    {
      const q = 3.4;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        h.b.lbox(cc.x + sx * q, r.y + 0.47, cc.z + sz * q, 0.09, 0.94, 0.09, CV.gold, { cast: false });
        h.b.lbox(cc.x + sx * q, r.y + 0.03, cc.z + sz * q, 0.34, 0.06, 0.34, CV.gold, { cast: false });
      }
      for (const s2 of [-1, 1]) {
        h.b.lbox(cc.x, r.y + 0.82, cc.z + s2 * q, 2 * q, 0.05, 0.05, CV.red, { cast: false });
        h.b.lbox(cc.x + s2 * q, r.y + 0.82, cc.z, 0.05, 0.05, 2 * q, CV.red, { cast: false });
        cvSolid(h, cc.x - q, cc.x + q, cc.z + s2 * q - 0.06, cc.z + s2 * q + 0.06, r.y + 0.3, r.y + 0.95);
        cvSolid(h, cc.x + s2 * q - 0.06, cc.x + s2 * q + 0.06, cc.z - q, cc.z + q, r.y + 0.3, r.y + 0.95);
      }
    }
    F.anchor(anchors, dC - P.CX + 0.9, lC + 3.0, F.faceIn, "guard", "foldarms");
    F.anchor(anchors, dC + P.CX - 0.9, lC - 3.0, F.faceIn, "guard", "foldarms");
    // 3. THE ENTRANCE HALL on the axis: marble, the runner from the door to
    //    the rotunda, the screening line, portraits on its walls, benches
    const hd1 = dC - P.CX;
    F.floor(0, hd1, lC - P.CX + 0.1, lC + P.CX - 0.1, CV.marble);
    F.rug(0.5, hd1 + 0.4, lC - 1.3, lC + 1.3, CV.red, CV.gold, 0.18);
    const sd = Math.min(7.0, hd1 * 0.5);
    for (const s of [-1, 1]) {
      const l = lC + s * 1.25;
      F.box(sd, l - 0.52, 0, 2.2, 0.14, 0.5, 0x8c939b, { solid: true });
      F.box(sd, l + 0.52, 0, 2.2, 0.14, 0.5, 0x8c939b, { solid: true });
      F.box(sd, l, 2.2, 0.16, 1.2, 0.5, 0x5f666e);
    }
    F.piece("table", sd, lC + 3.4, F.faceL(-1), { len: 1.6, deep: 0.7, seats: 0, tone: CV_LEATHER, solid: true });
    F.anchor(anchors, sd + 0.6, lC + 3.4, F.faceIn, "guard", "foldarms");
    F.anchor(anchors, sd - 0.3, lC - 3.0, F.faceIn, "guard", "foldarms");
    for (const s of [-1, 1]) {
      for (let d = 3.0; d < hd1 - 1.0; d += 4.5) F.art(d, lC + s * (P.CX - 0.1), -s, 1.8, 2.2, 2.6, s < 0 ? 0x3a4450 : 0x4a3a30, true);
      F.piece("bench", hd1 - 2.2, lC + s * (P.CX - 1.0), F.faceL(-s), { len: 2.4, tone: CV_LEATHER, solid: true });
    }
    F.chandelier(hd1 * 0.5, lC, 1.8);
    // 4. THE STATUARY HALL behind the rotunda (open to it, as in the real one)
    roomStatuary(h, F.rect(dC + P.CX, P.dK - 0.05, lC - P.CX + 0.12, lC + P.CX - 0.12), F.door(dC + P.CX, lC, 1), anchors);
    // 5. the grand stair to the gallery floor, in the core's stair hall
    try { capitolStair(h, F, P); } catch (e) { if (window.console) console.error("[civic] grand stair", e); }
    // 6. the corridor and the suites
    capitolDress(h, P, anchors, 0);
    return cvOut(anchors);
  }

  // THE CAPITOL'S UPPER FLOORS (1: hearings; 2: the members and the principal)
  function progCapitolFloor(r, h, opts) {
    cvFitStart(r, h);
    const b = h.b, plan = b._civicPlan || {};
    shell(h, r);
    const anchors = [];
    const nF = Array.isArray(b.floorTops) ? b.floorTops.length - 1 : (b.storeys | 0);
    const k = Math.max(1, Math.round((r.y - (b.floorTops ? b.floorTops[0] : 0.14)) / Math.max(1, h.fh)));
    const top = k >= nF - 1;
    const P = capitolPlan(r, h, top ? 2 : 1);
    const F = P.F, dC = P.dC, lC = P.lC, RO = P.RO, RR = RO.r, W = RO.well;
    if (k === 1 && plan.stair) capitolStairGuard(F, plan.stair);
    // THE GALLERY round the well: marble, the balustrade, lights on the rim
    F.floor(dC - P.CX + 0.1, dC + P.CX - 0.1, lC - P.CX + 0.1, lC + P.CX - 0.1, CV.marble);
    wellRail(F, dC, lC, W);
    for (const s of [-1, 1]) for (const q of [-1, 1]) F.light(dC + q * (W + 2.0), lC + s * (W + 2.0), F.ceil - 0.05, 0.05, 0.9, 0.9, CV.day, 0.6);
    // the halls on the axis become rooms upstairs: walls on the gallery side
    const dFr = dC - P.CX, dBk = dC + P.CX;
    F.wallL(dFr, lC - P.CX, lC + P.CX, [{ c: lC, w: 2.2, leaf: -1, hinge: 1 }]);
    F.wallL(dBk, lC - P.CX, lC + P.CX, [{ c: lC, w: 2.2, leaf: 1, hinge: -1 }]);
    const front = F.rect(P.dF + 0.05, dFr - 0.12, lC - P.CX + 0.12, lC + P.CX - 0.12);
    const back = F.rect(dBk + 0.12, P.dK - 0.05, lC - P.CX + 0.12, lC + P.CX - 0.12);
    if (!top) {
      roomHearing(h, front, F.door(dFr, lC, -1), anchors, { carpet: CV.blue, dais: CV.red });
      roomLibrary(h, back, F.door(dBk, lC, 1), anchors);
    } else {
      roomLibrary(h, front, F.door(dFr, lC, -1), anchors);
      roomLeader(h, back, F.door(dBk, lC, 1), anchors, { rug: CV.blue });
    }
    capitolDress(h, P, anchors, top ? 2 : 1);
    return cvOut(anchors);
  }

  /* ---- THE CHAMBERS ------------------------------------------------------- */
  // the wing's plan, from its front door: lobby band, side corridors, the
  // chamber between them, the rostrum at the back, the void over the house
  function chamberPlan(r, h) {
    const b = h.b;
    const F = cvFrame(r, h, b.localDoor);
    const E = 0.4, dF = -E, dK = F.dep + E, lMax = F.half + E;
    const SC = Math.min(4.8, lMax * 0.24);             // side corridor width
    const lW = lMax - SC;                              // the chamber's side walls
    const dL = Math.min(8.0, F.dep * 0.21);            // the lobby's depth
    const dCh0 = dL;                                   // chamber front wall
    const CR = Math.min(lW - 3.8, (dK - dCh0) * 0.5);  // radius of the top tier
    const zc = dK - 3.2;                               // the rostrum's centre, in d
    const vd0 = dCh0 + Math.max(4.5, (dK - dCh0) * 0.3);   // the void's front edge
    const vl = lW - 4.0;                               // the void's side edges (side galleries outside)
    return { F: F, dF: dF, dK: dK, lMax: lMax, SC: SC, lW: lW, dL: dL, dCh0: dCh0, CR: CR, dRc: zc, vd0: vd0, vl: vl };
  }
  function progChamber(r, h, opts) {
    cvFitStart(r, h);
    const b = h.b, plan = b._civicPlan || {};
    const house = plan.house || "senate";
    const P = chamberPlan(r, h);
    const F = P.F;
    // 1. the void: the slab over the house floor, the rostrum and the tiers
    if (CBZ.cityCarveShaft && Array.isArray(b.floorTops) && b.floorTops.length >= 3) {
      const q = F.rect(P.vd0, P.dK, -P.vl, P.vl);
      CBZ.cityCarveShaft(b, h.ox + (q.x0 + q.x1) / 2, h.oz + (q.z0 + q.z1) / 2, (q.x1 - q.x0) / 2, (q.z1 - q.z0) / 2, { levels: [1], reserve: true });
      b._civicVoid = q;
      CIVIC.carved++;
    }
    shell(h, r);
    const anchors = [];
    const HT = CV_HOUSE[house] || CV_HOUSE.senate;
    const carpet = house === "senate" ? CV.red : CV.green;
    // 2. walls: lobby wall across, chamber side walls with members' doors
    F.wallL(P.dCh0, -P.lMax, P.lMax, [
      { c: -(P.lW + P.SC / 2), w: 2.2, leaf: 1, hinge: 1 }, { c: P.lW + P.SC / 2, w: 2.2, leaf: 1, hinge: -1 },
      { c: -6.0, w: 2.0, leaf: 1, hinge: 1 }, { c: 6.0, w: 2.0, leaf: 1, hinge: -1 }]);
    for (const s of [-1, 1]) {
      F.wallD(s * P.lW, P.dCh0, P.dK, [{ c: P.dRc - 8.0, w: 1.8, leaf: -s, hinge: 1 }, { c: P.dCh0 + 3.2, w: 1.8, leaf: -s, hinge: -1 }],
        { hex: CV.plaster });
    }
    // 3. the lobby: marble, a runner to the chamber doors, benches, portraits
    F.floor(0, P.dCh0 - 0.1, -P.lMax + 0.05, P.lMax - 0.05, CV.marble);
    F.rug(0.4, P.dCh0 - 0.5, -1.2, 1.2, carpet, CV.gold, 0.15);
    for (const s of [-1, 1]) {
      F.piece("bench", P.dCh0 - 0.8, s * 11.5, F.faceIn, { len: 2.6, tone: HT, solid: true });
      F.art(P.dCh0 - 0.1, s * 11.5, -1, 1.6, 1.8, 2.5, s < 0 ? 0x3a4450 : 0x4a3a30);
      F.art(P.dCh0 * 0.5, s * P.lMax, -s, 1.8, 1.4, 2.3, 0x44403a, true);
      F.anchor(anchors, P.dCh0 - 0.7, s * 6.0 + s * 1.6, F.faceIn, "guard", "foldarms");
    }
    F.chandelier(P.dCh0 * 0.5, -8, 1.3);
    F.chandelier(P.dCh0 * 0.5, 8, 1.3);
    // side corridors: marble, lights
    for (const s of [-1, 1]) {
      const l0 = s * P.lW, l1 = s * P.lMax;
      F.floor(P.dCh0 + 0.1, P.dK, Math.min(l0, l1) + 0.1, Math.max(l0, l1) - 0.05, CV.marble);
      for (let d = P.dCh0 + 3; d < P.dK - 2; d += 6) F.light(d, s * (P.lW + P.SC / 2), F.ceil - 0.05, 0.05, 0.8, 0.8, CV.day, 0.6);
    }
    // 4. THE HOUSE FLOOR: carpet, the tiers, the desks, the rostrum
    F.floor(P.dCh0 + 0.1, P.dK, -P.lW + 0.1, P.lW - 0.1, carpet);
    chamberTiers(h, F, P, HT, anchors);
    chamberRostrum(h, F, P, house, anchors);
    // 5. the room's height: the side walls panelled to the dado, pilasters up
    //    to the ceiling of the void, a coffered ceiling, the laylight
    const H2 = (b.floorTops && b.floorTops[2] != null ? b.floorTops[2] : 2 * h.fh) - r.y - 0.2;
    for (const s of [-1, 1]) {
      F.box((P.dCh0 + P.dK) / 2, s * (P.lW - 0.12), 0, 1.1, 0.04, P.dK - P.dCh0, CV.panel);
      F.box((P.dCh0 + P.dK) / 2, s * (P.lW - 0.14), 1.1, 0.06, 0.06, P.dK - P.dCh0, CV.gold);
    }
    F.box(P.dK - 0.03, 0, 0, H2, 2 * P.vl, 0.06, CV.cream);
    for (let l = -P.vl + 1.5; l <= P.vl - 1.4; l += (2 * P.vl - 3) / 6) if (Math.abs(l) > 4.4) F.box(P.dK - 0.13, l, 0, H2, 0.7, 0.14, CV.marble);
    F.box(P.dK - 0.16, 0, H2 - 0.7, 0.5, 2 * P.vl, 0.2, CV.marble);
    const cz0 = P.vd0 + 0.3, cz1 = P.dK - 0.3;
    for (let d = cz0; d <= cz1; d += (cz1 - cz0) / 5) F.box(d, 0, H2 - 0.3, 0.3, 2 * P.vl - 0.4, 0.3, CV.cream);
    for (let l = -P.vl + 0.2; l <= P.vl - 0.2; l += (2 * P.vl - 0.4) / 6) F.box((cz0 + cz1) / 2, l, H2 - 0.3, 0.3, 0.3, cz1 - cz0, CV.cream);
    F.light((cz0 + cz1) / 2, 0, H2 - 0.06, 0.05, P.vl * 1.0, (cz1 - cz0) * 0.5, CV.day, 0.75);
    for (const s of [-1, 1]) for (const d of [P.vd0 + 3, P.dK - 4]) F.chandelier(d, s * P.vl * 0.55, 1.6, H2);
    // the fascia on the galleries' edge, seen from the floor
    const ft = F.ceil;
    for (const s of [-1, 1]) F.box((P.vd0 + P.dK) / 2, s * (P.vl + 0.15), ft - 0.55, 0.55, 0.3, P.dK - P.vd0, CV.panel);
    F.box(P.vd0 - 0.15, 0, ft - 0.55, 0.55, 2 * P.vl + 0.6, 0.3, CV.panel);
    return cvOut(anchors);
  }
  /* THE TIERS: five concentric half-rings round the rostrum, 1.3 m deep, each
     0.17 m over the last, polygonal (14 facets): every facet is BOTH the box
     you see and an oriented walk surface of the same size at the same top, so
     what you stand on is what is drawn. Tiers higher than one step off the
     floor carry an oriented collider (you climb them from the tier below, not
     from the floor). Radial aisles at 45/90/135 degrees. */
  function chamberTiers(h, F, P, HT, anchors) {
    const T = window.THREE;
    if (!T) return;
    const y = F.y, NT = 5, RISE = 0.17, DEP = 1.3;
    const R0 = Math.max(4.2, P.CR - NT * DEP);
    const c = F.p(P.dRc, 0);
    // the tiers open toward the door: angle a runs from the +l side (0) through
    // the door direction (pi/2) to -l (pi)
    const dirX = function (a) { return Math.cos(a) * F.A.tx - Math.sin(a) * F.A.nx; };
    const dirZ = function (a) { return Math.cos(a) * F.A.tz - Math.sin(a) * F.A.nz; };
    const NS = 14, dA = Math.PI / NS;
    const tierG = [], topG = [], deskG = [], topW = [], chairG = [], chairB = [];
    const aisles = [Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4];
    for (let k = 1; k <= NT; k++) {
      const ri = R0 + (k - 1) * DEP, ro = ri + DEP, top = k * RISE;
      for (let s = 0; s < NS; s++) {
        const a = (s + 0.5) * dA;
        const ux = dirX(a), uz = dirZ(a);                 // radial
        const tx = -uz, tz = ux;                          // tangent
        const rm = (ri + ro) / 2, half = ro * Math.sin(dA / 2) + 0.02;
        const cx = c.x + ux * rm, cz = c.z + uz * rm;
        tierG.push(orient(new T.BoxGeometry(2 * half, top, DEP), cx, y + top / 2, cz, tx, tz));
        // the walnut nosing on the tier's front edge, flush with its top
        topG.push(orient(new T.BoxGeometry(2 * half, 0.05, 0.07), c.x + ux * (ri + 0.035), y + top - 0.025, c.z + uz * (ri + 0.035), tx, tz));
        // the walk surface: an oriented rectangle, the facet exactly
        const ex = Math.abs(tx) * half + Math.abs(ux) * DEP / 2, ez = Math.abs(tz) * half + Math.abs(uz) * DEP / 2;
        const pl = { minX: h.ox + cx - ex, maxX: h.ox + cx + ex, minZ: h.oz + cz - ez, maxZ: h.oz + cz + ez, top: y + top,
          obb: { cx: h.ox + cx, cz: h.oz + cz, ux: tx, uz: tz, hl: half, hw: DEP / 2 } };
        CBZ.platforms.push(pl);
        if (h.b.platforms) h.b.platforms.push(pl);
        if (top > 0.4 && CBZ.orientedCollider) {
          const col = CBZ.orientedCollider(h.ox + cx, h.oz + cz, half, DEP / 2, Math.atan2(-tz, tx), y - 0.02, y + top);
          col.ref = null;
          CBZ.colliders.push(col);
          if (h.b.colliders) h.b.colliders.push(col);
        }
        CIVIC.tiers++;
        // the members' desks on this facet, facing the rostrum (unless an aisle)
        const nd = Math.max(1, Math.floor(2 * half / 1.25));
        for (let q = 0; q < nd; q++) {
          const t = -half + (q + 0.5) * 2 * half / nd;
          const aa = a + t / rm;
          if (aisles.some(function (x) { return Math.abs(x - aa) * rm < 0.75; })) continue;
          const dxr = dirX(aa), dzr = dirZ(aa), txr = -dzr, tzr = dxr;
          const dr = ri + 0.34, cr2 = ri + 0.95;
          const dx = c.x + dxr * dr, dz = c.z + dzr * dr;
          deskG.push(orient(new T.BoxGeometry(1.0, 0.7, 0.42), dx, y + top + 0.35, dz, txr, tzr));
          topW.push(orient(new T.BoxGeometry(1.08, 0.04, 0.56), dx - dxr * 0.03, y + top + 0.72, dz - dzr * 0.03, txr, tzr));
          const chx = c.x + dxr * cr2, chz = c.z + dzr * cr2;
          chairG.push(orient(new T.BoxGeometry(0.52, 0.08, 0.5), chx, y + top + 0.41, chz, txr, tzr));
          chairB.push(orient(new T.BoxGeometry(0.52, 0.62, 0.08), chx + dxr * 0.25, y + top + 0.76, chz + dzr * 0.25, txr, tzr));
          chairB.push(orient(new T.BoxGeometry(0.08, 0.37, 0.08), chx, y + top + 0.185, chz, txr, tzr));
          const colD = CBZ.orientedCollider ? CBZ.orientedCollider(h.ox + dx, h.oz + dz, 0.5, 0.21, Math.atan2(-tzr, txr), y + top, y + top + 0.72) : null;
          if (colD) { colD.ref = null; CBZ.colliders.push(colD); if (h.b.colliders) h.b.colliders.push(colD); }
          // a real seat: the members sit, the player can
          const face = Math.atan2(-dxr, -dzr);
          if (CBZ.propRegisterSeat) CBZ.propRegisterSeat(h.ox + chx, y + top, h.oz + chz, face, "chair", null, { cushion: 0.45, floorBelow: 0 });
          CIVIC.seats++;
          if (k === 1 && (q + s) % 5 === 0)
            anchors.push({ x: h.ox + chx, y: y + top, z: h.oz + chz, face: face, lx: chx, lz: chz, kind: "clerk", pose: "sit", cushionH: 0.45, floorBelow: 0 });
        }
      }
    }
    // the bar: a panelled parapet round the back of the top tier
    const rb = R0 + NT * DEP + 0.14, wallG = [], capG = [];
    for (let s = 0; s < NS; s++) {
      const a = (s + 0.5) * dA, ux = dirX(a), uz = dirZ(a), tx = -uz, tz = ux;
      const half = rb * Math.sin(dA / 2) + 0.03, hh = NT * RISE + 1.0;
      const cx = c.x + ux * rb, cz = c.z + uz * rb;
      wallG.push(orient(new T.BoxGeometry(2 * half, hh, 0.24), cx, y + hh / 2, cz, tx, tz));
      capG.push(orient(new T.BoxGeometry(2 * half + 0.02, 0.07, 0.32), cx, y + hh + 0.035, cz, tx, tz));
      if (CBZ.orientedCollider) {
        const col = CBZ.orientedCollider(h.ox + cx, h.oz + cz, half, 0.14, Math.atan2(-tz, tx), y, y + hh);
        col.ref = null; CBZ.colliders.push(col); if (h.b.colliders) h.b.colliders.push(col);
      }
    }
    const add = function (list, hex) {
      if (!list.length) return;
      const m = new T.Mesh(mergeCivic(list), cvMat(hex));
      m.castShadow = false; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
      m.name = "civic-chamber";
      h.b.group.add(m);
    };
    add(tierG, HT.cloth === 0x7a2c2e ? CV.red : CV.green); add(topG, CV.walnut);
    add(deskG, CV.walnut); add(topW, CV.panelL); add(chairG, HT.cloth); add(chairB, HT.cloth);
    add(wallG, CV.panel); add(capG, CV.gold);
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  // a box geometry turned so its local +x runs along (tx,tz), placed at (x,y,z)
  function orient(g, x, y, z, tx, tz) {
    const yaw = Math.atan2(-tz, tx);
    g.rotateY(yaw);
    g.translate(x, y, z);
    return g;
  }
  function mergeCivic(list) {
    const T = window.THREE, pos = [], nor = [], uv = [];
    for (let k = 0; k < list.length; k++) {
      let g = list[k];
      if (g.index) g = g.toNonIndexed();
      const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        nor.push(n.getX(i), n.getY(i), n.getZ(i));
        uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      }
    }
    const out = new T.BufferGeometry();
    out.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    out.setAttribute("normal", new T.Float32BufferAttribute(nor, 3));
    out.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    return out;
  }
  /* THE ROSTRUM: a clerks' level (0.30) across the back wall reached by a
     0.15 step at each end, the presiding officer's platform (0.60) on it with
     its own 0.45 steps, the clerks' desk wall in front, the chair of state,
     the seal and the standards behind; two lecterns in the well. */
  function chamberRostrum(h, F, P, house, anchors) {
    const hw1 = Math.min(5.2, P.vl - 1.0), hw2 = Math.min(2.6, hw1 - 1.2);
    const d1 = P.dRc - 0.6;              // the clerks' level's front edge
    const dB = P.dK - 0.02;              // the back wall's face
    const d2 = dB - 1.9;                 // the presiding platform's front edge
    // clerks' level + its end steps
    F.box((d1 + dB) / 2, 0, 0, 0.30, 2 * hw1, dB - d1, CV.marble);
    F.walkRect(d1, dB, -hw1, hw1, 0.30);
    for (const s of [-1, 1]) {
      F.box((d1 + dB) / 2, s * (hw1 + 0.4), 0, 0.15, 0.8, dB - d1, CV.marble);
      F.walkRect(d1, dB, s * hw1, s * (hw1 + 0.8), 0.15);
    }
    // the presiding platform + its steps (on the clerks' level)
    F.box((d2 + dB) / 2, 0, 0.30, 0.30, 2 * hw2, dB - d2, CV.marbleD);
    F.walkRect(d2, dB, -hw2, hw2, 0.60);
    for (const s of [-1, 1]) {
      F.box((d2 + dB) / 2, s * (hw2 + 0.35), 0.30, 0.15, 0.7, dB - d2, CV.marble);
      F.walkRect(d2, dB, s * hw2, s * (hw2 + 0.7), 0.45);
    }
    // the clerks' desk wall along the front of the clerks' level
    F.box(d1 + 0.3, 0, 0.30, 0.95, 2 * hw1 - 1.6, 0.2, CV.panel, { solid: true });
    F.box(d1 + 0.45, 0, 1.25, 0.05, 2 * hw1 - 1.4, 0.55, CV.marble);
    F.box(d1 + 0.12, 0, 0, 1.3, 2 * hw1 - 1.4, 0.12, CV.marbleD, { solid: true });
    for (let i = -2; i <= 2; i++) {
      const ch = cvPiece("chair", h, F.y + 0.30, F.p(d1 + 1.1, i * 1.5).x, F.p(d1 + 1.1, i * 1.5).z, F.faceIn, { tone: CV_LEATHER, solid: true });
      if (ch && (i === -1 || i === 1)) F.seatAnchor(anchors, ch, 0, "clerk");
    }
    // the presiding officer's desk and chair of state
    F.box(d2 + 0.35, 0, 0.60, 1.0, 2 * hw2 - 0.8, 0.5, CV.walnut, { solid: true });
    F.box(d2 + 0.35, 0, 1.6, 0.06, 2 * hw2 - 0.6, 0.62, CV.panelL);
    F.box(dB - 0.9, 0, 0.60, 0.5, 0.7, 0.62, CV.leather);
    F.box(dB - 0.62, 0, 1.1, 1.3, 0.72, 0.12, CV.leather);
    F.box(dB - 0.6, 0, 2.4, 0.16, 0.86, 0.16, CV.gold);
    if (CBZ.propRegisterSeat) {
      const sp = F.p(dB - 0.9, 0);
      CBZ.propRegisterSeat(h.ox + sp.x, F.y + 0.60, h.oz + sp.z, F.faceIn, "chair", null, { cushion: 0.5, floorBelow: 0 });
      anchors.push({ x: h.ox + sp.x, y: F.y + 0.60, z: h.oz + sp.z, face: F.faceIn, lx: sp.x, lz: sp.z, kind: "boss", pose: "sit", cushionH: 0.5, floorBelow: 0 });
    }
    // the back wall: a marble reredos, the seal, the standards
    F.box(dB - 0.05, 0, 0.6, 3.6, 2 * hw2 + 1.6, 0.1, CV.marbleD);
    F.box(dB - 0.12, 0, 4.4, 1.9, 2.0, 0.06, CV.gold);
    F.box(dB - 0.16, 0, 4.55, 1.6, 1.7, 0.04, house === "senate" ? CV.red : CV.green);
    for (const s of [-1, 1]) F.flag(dB - 0.6, s * (hw2 + 1.0), s < 0 ? CV.blue : (house === "senate" ? CV.red : CV.green));
    // two lecterns in the well, facing the members
    for (const s of [-1, 1]) {
      const l = s * 2.6, d = d1 - 1.6;
      F.box(d, l, 0, 1.05, 0.62, 0.5, CV.walnut, { solid: true });
      F.box(d - 0.06, l, 1.05, 0.06, 0.7, 0.58, CV.panelL);
      F.box(d - 0.2, l, 1.11, 0.3, 0.02, 0.02, CV.ink);
    }
    F.anchor(anchors, d1 - 0.6, hw1 + 1.2, F.faceOut, "guard", "foldarms");
    F.anchor(anchors, d1 - 0.6, -hw1 - 1.2, F.faceOut, "guard", "foldarms");
  }

  // THE GALLERY FLOOR over a chamber
  function progChamberGallery(r, h, opts) {
    cvFitStart(r, h);
    const b = h.b, plan = b._civicPlan || {};
    const house = plan.house || "senate";
    const HT = CV_HOUSE[house] || CV_HOUSE.senate;
    shell(h, r);
    const anchors = [];
    const P = chamberPlan(r, h);
    const F = P.F;
    // walls: the rooms' wall across the front band, the galleries' wall with
    // its two doors, the side galleries' walls
    F.wallL(P.dCh0 - 2.0, -P.lMax, P.lMax, [{ c: -12.0, w: 1.8, leaf: -1, hinge: 1 }, { c: 0, w: 2.0, leaf: -1, hinge: 1 }, { c: 12.0, w: 1.8, leaf: -1, hinge: -1 }]);
    for (const s of [-1, 1]) F.wallD(s * 6.0, P.dF, P.dCh0 - 2.0, []);
    F.wallL(P.dCh0, -P.lW, P.lW, [{ c: -6.0, w: 2.0, leaf: 1, hinge: 1 }, { c: 6.0, w: 2.0, leaf: 1, hinge: -1 }]);
    for (const s of [-1, 1]) F.wallD(s * P.lW, P.dCh0, P.dK, [{ c: P.vd0 + 4.0, w: 1.8, leaf: -s, hinge: 1 }]);
    // the front rooms: two committee rooms and a members' reading room
    roomHearing(h, F.rect(P.dF + 0.05, P.dCh0 - 2.12, -P.lMax + 0.05, -6.12), F.door(P.dCh0 - 2.0, -12.0, -1), anchors, { carpet: house === "senate" ? CV.red : CV.green, tone: HT });
    roomHearing(h, F.rect(P.dF + 0.05, P.dCh0 - 2.12, 6.12, P.lMax - 0.05), F.door(P.dCh0 - 2.0, 12.0, -1), anchors, { carpet: CV.blue, tone: HT });
    roomLibrary(h, F.rect(P.dF + 0.05, P.dCh0 - 2.12, -5.88, 5.88), F.door(P.dCh0 - 2.0, 0, -1), anchors);
    // the cross corridor and the side corridors
    F.floor(P.dCh0 - 1.9, P.dCh0 - 0.1, -P.lMax + 0.05, P.lMax - 0.05, CV.marble);
    for (const s of [-1, 1]) {
      F.floor(P.dCh0 + 0.1, P.dK, Math.min(s * P.lW, s * P.lMax) + 0.1, Math.max(s * P.lW, s * P.lMax) - 0.05, CV.marble);
      for (let d = P.dCh0 + 3; d < P.dK - 2; d += 6) F.light(d, s * (P.lW + P.SC / 2), F.ceil - 0.05, 0.05, 0.8, 0.8, CV.day, 0.6);
    }
    for (let l = -P.lMax + 4; l < P.lMax - 3; l += 8) F.light(P.dCh0 - 1.0, l, F.ceil - 0.05, 0.05, 0.8, 0.8, CV.day, 0.6);
    // THE GALLERIES: carpet, the balustrade on the void's edge, benches
    F.floor(P.dCh0 + 0.1, P.vd0, -P.lW + 0.1, P.lW - 0.1, CV.blue);
    for (const s of [-1, 1]) F.floor(P.vd0, P.dK, Math.min(s * P.vl, s * P.lW) + 0.05, Math.max(s * P.vl, s * P.lW) - 0.1, CV.blue);
    const rail = function (lat, at, a0, a1) {
      const len = Math.abs(a1 - a0), mid = (a0 + a1) / 2;
      if (lat) {
        F.box(mid, at, 0, 0.95, 0.24, len, CV.panel);
        F.box(mid, at, 0.95, 0.07, 0.34, len + 0.05, CV.gold);
        F.solidRect(Math.min(a0, a1), Math.max(a0, a1), at - 0.15, at + 0.15, 0, 1.02);
      } else {
        F.box(at, mid, 0, 0.95, len, 0.24, CV.panel);
        F.box(at, mid, 0.95, 0.07, len + 0.05, 0.34, CV.gold);
        F.solidRect(at - 0.15, at + 0.15, Math.min(a0, a1), Math.max(a0, a1), 0, 1.02);
      }
    };
    rail(false, P.vd0 - 0.15, -P.vl - 0.3, P.vl + 0.3);
    for (const s of [-1, 1]) rail(true, s * (P.vl + 0.15), P.vd0, P.dK);
    CIVIC.galleries++;
    // benches: rows facing the chamber in the front gallery, one row on each side
    for (let d = P.vd0 - 1.1, i = 0; d > P.dCh0 + 0.9 && i < 3; d -= 1.2, i++)
      for (let l = -P.vl + 1.8; l < P.vl - 1.2; l += 3.2) F.piece("bench", d, l, F.faceOut, { len: 2.8, tone: HT, solid: true });
    for (const s of [-1, 1]) for (let d = P.vd0 + 1.6; d < P.dK - 1.6; d += 3.2)
      F.piece("bench", d, s * (P.vl + 1.5), F.faceL(-s), { len: 2.8, tone: HT, solid: true });
    for (const s of [-1, 1]) F.anchor(anchors, P.dCh0 + 0.8, s * 6.0, F.faceOut, "guard", "foldarms");
    return cvOut(anchors);
  }

  /* ---- CITY HALL ---------------------------------------------------------
     A corridor across the back third, the council chamber across the front,
     rooms either side of it and behind the corridor (round the core). */
  function hallPlan(r, h) {
    const F = cvFrame(r, h, h.b.localDoor);
    const E = 0.4, dF = -E, dK = F.dep + E, lMax = F.half + E;
    const dCor0 = F.dep * 0.58, dCor1 = dCor0 + 2.6;
    return { F: F, dF: dF, dK: dK, lMax: lMax, dCor0: dCor0, dCor1: dCor1 };
  }
  // the back rooms off the corridor, in columns, leaving the core's column open
  function hallBack(h, P, anchors, type) {
    const F = P.F, core = cvCore(h);
    const n = Math.max(2, Math.round(2 * P.lMax / 8.5)), cw = 2 * P.lMax / n;
    const cols = [];
    for (let i = 0; i < n; i++) {
      const l0 = -P.lMax + i * cw, l1 = l0 + cw;
      const box = F.rect(P.dCor1, P.dK, l0, l1);
      cols.push({ l0: l0, l1: l1, open: core.some(function (q) { return rectHits(box, q, 0.6); }) });
    }
    for (let i = 0; i < n; i++) {
      const c = cols[i];
      if (c.open) continue;
      const lm = (c.l0 + c.l1) / 2;
      F.wallL(P.dCor1, c.l0, c.l1, [{ c: lm, w: 1.6, leaf: 1, hinge: 1 }]);
      if (i > 0) F.wallD(c.l0, P.dCor1, P.dK, []);
      if (i < n - 1 && !cols[i + 1].open) {} else if (i < n - 1) F.wallD(c.l1, P.dCor1, P.dK, []);
      const rect = F.rect(P.dCor1 + 0.12, P.dK - 0.05, c.l0 + (i > 0 ? 0.12 : 0.05), c.l1 - (i < n - 1 ? 0.12 : 0.05));
      if (type === "office") roomOffice(h, rect, F.door(P.dCor1, lm, 1), anchors, { carpet: CV.blue });
      else roomReception(h, rect, F.door(P.dCor1, lm, 1), anchors, {});
    }
  }
  function hallCorridor(h, P) {
    const F = P.F;
    F.floor(P.dCor0 + 0.1, P.dCor1 - 0.1, -P.lMax + 0.05, P.lMax - 0.05, CV.marble);
    F.rug(P.dCor0 + 0.6, P.dCor1 - 0.6, -P.lMax + 1.0, P.lMax - 1.0, CV.red, CV.gold, 0.1);
    for (let l = -P.lMax + 4; l < P.lMax - 3; l += 7) F.light((P.dCor0 + P.dCor1) / 2, l, F.ceil - 0.05, 0.05, 0.8, 0.8, CV.day, 0.6);
  }
  /* THE COUNCIL CHAMBER: the council's horseshoe on a two-riser dais along the
     side wall (both surfaces registered), the mayor's seat at its head, the
     clerk's table, the public speaking lectern facing the dais, the public in
     rows, the city's seal and flags behind the council. */
  function progCouncilChamber(r, h, opts) {
    cvFitStart(r, h);
    shell(h, r);
    const anchors = [];
    const P = hallPlan(r, h), F = P.F;
    const lC0 = -P.lMax * 0.64, lC1 = P.lMax * 0.64;          // the chamber's lateral extent
    F.wallL(P.dCor0, -P.lMax, P.lMax, [{ c: lC1 - 3.0, w: 2.0, leaf: -1, hinge: 1 }, { c: (lC1 + P.lMax) / 2, w: 1.6, leaf: -1, hinge: -1 }, { c: (lC0 - P.lMax) / 2, w: 1.6, leaf: -1, hinge: 1 }]);
    F.wallD(lC0, P.dF, P.dCor0, []);
    F.wallD(lC1, P.dF, P.dCor0, []);
    hallCorridor(h, P);
    // the chamber, in its own frame from its door
    const ch = F.rect(P.dF + 0.05, P.dCor0 - 0.12, lC0 + 0.12, lC1 - 0.12);
    const R = cvRoom(h, ch, F.door(P.dCor0, lC1 - 3.0, -1));
    if (R) {
      R.floor(0, R.dep, -R.half, R.half, CV.blue);
      // the dais runs across the chamber's far side, opposite the public
      const dD = R.dep - 5.0;
      R.box(dD + 0.2, 0, 0, 0.15, 2 * R.half - 0.4, 0.4, CV.walnut);
      R.walkRect(dD, dD + 0.4, -R.half + 0.2, R.half - 0.2, 0.15);
      R.box((dD + 0.4 + R.wd) / 2, 0, 0, 0.30, 2 * R.half - 0.4, R.wd - dD - 0.4, CV.walnut);
      R.walkRect(dD + 0.4, R.wd, -R.half + 0.2, R.half - 0.2, 0.30);
      R.box((dD + 0.4 + R.dep) / 2, 0, 0.296, 0.008, 2 * R.half - 0.8, R.dep - dD - 0.6, CV.red);
      // the horseshoe: the head table and two returns, members' chairs inside
      const hd = R.dep - 1.6, hl = Math.min(5.5, R.half - 2.0);
      R.box(hd, 0, 0.30, 0.74, 2 * hl, 0.8, CV.walnut, { solid: true });
      for (const s of [-1, 1]) R.box((hd + dD + 1.2) / 2, s * hl, 0.30, 0.74, 0.8, hd - dD - 1.2, CV.walnut, { solid: true });
      R.box(hd, 0, 1.04, 0.04, 2 * hl + 0.1, 0.9, CV.panelL);
      const members = [];
      for (let i = 0; i < 5; i++) members.push({ d: hd + 0.8, l: -hl + 0.9 + i * (2 * hl - 1.8) / 4, face: R.faceIn });
      // the returns: members on the OUTSIDE of the horseshoe, facing in
      for (const s of [-1, 1]) for (let i = 0; i < 2; i++) members.push({ d: dD + 1.9 + i * 1.3, l: s * (hl + 0.8), face: R.faceL(-s) });
      members.forEach(function (m, i) {
        const p = R.p(m.d, m.l);
        const c = cvPiece("chair", h, R.y + 0.30, p.x, p.z, m.face, { tone: CV_LEATHER, solid: true });
        if (c && i !== 2) R.seatAnchor(anchors, c, 0, "clerk");
        R.box(m.d - (i < 5 ? 0.55 : 0), m.l + (i >= 5 ? (m.l > 0 ? -0.55 : 0.55) : 0), 1.08, 0.08, 0.3, 0.3, CV.gold);
      });
      // the mayor's chair at the head of the horseshoe (the middle seat)
      const mp = R.p(hd + 0.8, 0);
      anchors.push({ x: h.ox + mp.x, y: R.y + 0.30, z: h.oz + mp.z, face: R.faceIn, lx: mp.x, lz: mp.z, kind: "clerk", pose: "sit", cushionH: 0.45, floorBelow: 0 });
      // the seal and flags on the wall behind
      sealScreen(h, R, 0.30, 2.6, 2.3, CV.red);
      for (const s of [-1, 1]) R.flag(R.dep - 0.4, s * (hl + 0.9), s < 0 ? CV.blue : CV.red);
      // the clerk's table and the public lectern, facing the council
      R.piece("table", dD - 1.4, 0, R.faceIn, { len: 2.4, deep: 0.8, seats: 0, tone: CV_LEATHER, solid: true });
      R.piece("chair", dD - 0.75, -0.6, R.faceOut, { tone: CV_LEATHER, solid: true });
      R.box(dD - 3.6, 0, 0, 1.08, 0.6, 0.45, CV.walnut, { solid: true });
      R.box(dD - 3.66, 0, 1.08, 0.05, 0.66, 0.5, CV.panelL);
      R.box(dD - 3.5, 0.2, 1.13, 0.3, 0.02, 0.02, CV.ink);
      // the public: benches in rows, an aisle to the lectern
      const bl = Math.max(1.4, Math.min(3.4, R.half - 1.6));
      for (let d = 1.4; d < dD - 4.6; d += 1.2) for (const s of [-1, 1]) R.piece("bench", d, s * (0.9 + bl / 2), R.faceOut, { len: bl, tone: CV_LEATHER, solid: true });
      for (const s of [-1, 1]) R.art(R.dep * 0.5, s * R.wl, -s, 2.0, 1.4, 2.2, 0x3a4450, true);
      R.chandelier(R.dep * 0.3, 0, 1.4);
      R.chandelier(R.dep * 0.72, 0, 1.4);
      R.anchor(anchors, 1.0, Math.min(1.8, R.half - 0.8), R.faceOut, "guard", "foldarms");
    }
    // the clerk's office and the committee room either side
    roomReception(h, F.rect(P.dF + 0.05, P.dCor0 - 0.12, -P.lMax + 0.05, lC0 - 0.12), F.door(P.dCor0, (lC0 - P.lMax) / 2, -1), anchors, {});
    roomHearing(h, F.rect(P.dF + 0.05, P.dCor0 - 0.12, lC1 + 0.12, P.lMax - 0.05), F.door(P.dCor0, (lC1 + P.lMax) / 2, -1), anchors, { carpet: CV.green });
    hallBack(h, P, anchors, "reception");
    return cvOut(anchors);
  }
  // THE MAYOR'S FLOOR: the mayor's office, the anteroom, the deputy's office
  function progMayorsOffice(r, h, opts) {
    cvFitStart(r, h);
    shell(h, r);
    const anchors = [];
    const P = hallPlan(r, h), F = P.F;
    const la = -P.lMax * 0.18, lb = P.lMax * 0.18;
    F.wallL(P.dCor0, -P.lMax, P.lMax, [{ c: 0, w: 2.0, leaf: -1, hinge: 1 }, { c: (lb + P.lMax) / 2, w: 1.6, leaf: -1, hinge: -1 }]);
    F.wallD(la, P.dF, P.dCor0, [{ c: P.dCor0 * 0.5, w: 1.6, leaf: -1, hinge: 1 }]);
    F.wallD(lb, P.dF, P.dCor0, []);
    hallCorridor(h, P);
    roomReception(h, F.rect(P.dF + 0.05, P.dCor0 - 0.12, la + 0.12, lb - 0.12), F.door(P.dCor0, 0, -1), anchors, { rug: CV.red });
    roomLeader(h, F.rect(P.dF + 0.05, P.dCor0 - 0.12, -P.lMax + 0.05, la - 0.12), F.door(P.dCor0 * 0.5, la, -1, true), anchors, { rug: CV.red });
    roomOffice(h, F.rect(P.dF + 0.05, P.dCor0 - 0.12, lb + 0.12, P.lMax - 0.05), F.door(P.dCor0, (lb + P.lMax) / 2, -1), anchors, { carpet: CV.green, guard: true });
    hallBack(h, P, anchors, "office");
    return cvOut(anchors);
  }

  /* ---- THE GOVERNOR'S RESIDENCE -----------------------------------------
     A house, not an office: a central hall front to back, two rooms either
     side of it. Downstairs the drawing room, the dining room, the study and a
     morning room; upstairs (framed from the landing) the principal bedroom,
     a guest room and the family sitting room. The quarter the stair core
     stands in stays open to the hall. */
  function housePlan(r, h, door) {
    const F = cvFrame(r, h, door);
    const E = 0.4, dF = -E, dK = F.dep + E, lMax = F.half + E;
    const HW = Math.min(3.2, lMax * 0.18), dM = (dF + dK) / 2;
    const core = cvCore(h), q = [];
    for (const s of [-1, 1]) for (const fr of [0, 1]) {
      const l0 = s < 0 ? -lMax : HW, l1 = s < 0 ? -HW : lMax;
      const d0 = fr ? dM : dF, d1 = fr ? dK : dM;
      const box = F.rect(d0, d1, l0, l1);
      q.push({ s: s, fr: fr, l0: l0, l1: l1, d0: d0, d1: d1, open: core.some(function (c) { return rectHits(box, c, 0.6); }) });
    }
    return { F: F, dF: dF, dK: dK, lMax: lMax, HW: HW, dM: dM, q: q };
  }
  function houseWalls(h, P) {
    const F = P.F;
    for (const s of [-1, 1]) {
      const fr = P.q.filter(function (x) { return x.s === s; });
      const A = fr.find(function (x) { return !x.fr; }), B = fr.find(function (x) { return x.fr; });
      // the hall's side wall, a door into each closed room
      const gaps = [];
      if (!A.open) gaps.push({ c: (A.d0 + A.d1) / 2, w: 1.8, leaf: s, hinge: 1 });
      if (!B.open) gaps.push({ c: (B.d0 + B.d1) / 2, w: 1.8, leaf: s, hinge: -1 });
      const d0 = A.open ? B.d0 : P.dF, d1 = B.open ? A.d1 : P.dK;
      if (!(A.open && B.open)) F.wallD(s * P.HW, d0, d1, gaps);
      if (!A.open || !B.open) F.wallL(P.dM, Math.min(A.l0, A.l1), Math.max(A.l0, A.l1), []);
    }
  }
  function roomDrawing(h, rect, door, anchors) {
    const R = cvRoom(h, rect, door);
    if (!R) return;
    R.floor(0, R.dep, -R.half, R.half, CV.oak);
    R.rug(1.2, R.dep - 1.2, -R.half + 1.0, R.half - 1.0, 0x6b4a3a, CV.sand, 0.3);
    // the fireplace on the far wall, the sofas facing across it
    const fp = R.p(R.wd - 0.2, 0);
    if (!cvGlazed(h, fp.x, fp.z, 1.2, R.y, R.y + 2.5) && cvDoorClear(fp.x, fp.z, 1.6)) {
      R.box(R.wd - 0.15, 0, 0, 1.3, 2.2, 0.3, CV.marble, { solid: true });
      R.box(R.wd - 0.22, 0, 1.3, 0.1, 2.5, 0.45, CV.marble);
      R.box(R.wd - 0.32, 0, 0.05, 0.75, 1.1, 0.04, CV.ink);
      R.light(R.wd - 0.35, 0, 0.06, 0.12, 0.9, 0.03, 0xff8a3a, 0.9);
      R.art(R.wd, 0, -1, 1.3, 1.0, 2.4, 0x4a5a44);
    }
    const cd = R.dep - 3.0;
    R.piece("coffee", cd, 0, R.faceIn, { len: 1.2, deep: 0.6, tone: "warm" });
    for (const s of [-1, 1]) R.piece("sofa", cd, s * 1.6, R.faceL(-s), { len: 2.2, tone: "warm", solid: true });
    R.piece("armchair", cd - 1.5, 0, R.faceOut, { tone: "warm", solid: true });
    R.piece("planter", 0.7, R.half - 0.7, 0, { kind: "tree", s: 0.9 });
    R.art(R.dep * 0.4, -R.wl, 1, 1.6, 1.1, 1.9, 0x5a4a3a, true);
    R.chandelier(R.dep / 2, 0, 1.2);
    R.anchor(anchors, cd - 1.5, 1.4, R.faceIn, "family", "stand");
  }
  function roomDining(h, rect, door, anchors) {
    const R = cvRoom(h, rect, door);
    if (!R) return;
    R.floor(0, R.dep, -R.half, R.half, CV.oak);
    R.rug(1.4, R.dep - 1.4, -Math.min(3.2, R.half - 0.8), Math.min(3.2, R.half - 0.8), CV.red, CV.gold, 0.3);
    const len = Math.max(2.0, Math.min(4.2, R.dep - 3.4));
    R.piece("table", R.dep / 2, 0, R.faceIn, { len: 1.2, deep: len, seats: 0, tone: "warm", solid: true });
    const n = Math.max(2, Math.floor(len / 0.8));
    for (const s of [-1, 1]) for (let i = 0; i < n; i++) {
      const d = R.dep / 2 - len / 2 + (i + 0.5) * len / n;
      const c = R.piece("chair", d, s * 1.05, R.faceL(-s), { tone: "warm", solid: true });
      if (c && i === 0 && s < 0) R.seatAnchor(anchors, c, 0, "family");
    }
    for (let i = 0; i < 3; i++) R.box(R.dep / 2 - len / 3 + i * len / 3, 0, 0.74, 0.3, 0.12, 0.12, CV.gold);
    R.piece("credenza", R.dep - 0.35, 0, R.faceIn, { len: 2.0, tone: "warm", solid: true });
    R.art(R.wd, 0, -1, 1.8, 1.1, 2.1, 0x3a4a5a);
    R.chandelier(R.dep / 2, 0, 1.3);
  }
  function roomStudy(h, rect, door, anchors, boss) {
    const R = cvRoom(h, rect, door);
    if (!R) return;
    R.floor(0, R.dep, -R.half, R.half, CV.oak);
    R.rug(R.dep - 4.0, R.dep - 0.8, -Math.min(2.2, R.half - 0.7), Math.min(2.2, R.half - 0.7), CV.green, CV.gold, 0.2);
    const desk = R.piece("bossDesk", R.dep - 2.2, 0, R.faceIn, { len: 2.2, deep: 1.0, tone: CV_LEATHER, solid: true });
    if (desk) R.seatAnchor(anchors, desk, 0, boss ? "boss" : "clerk");
    for (const s of [-1, 1]) {
      R.flag(R.dep - 0.6, s * 1.7, s < 0 ? CV.blue : CV.red);
      const n = Math.max(1, Math.floor((R.dep - 1.6) / 2.2));
      for (let i = 0; i < n; i++) R.bookcase(0.8 + i * 2.2 + 1.0, s * (R.wl - 0.2), 2.0, -s, true);
    }
    R.piece("armchair", 1.8, 0.9, R.faceOut, { tone: CV_LEATHER, solid: true });
    R.chandelier(R.dep / 2, 0, 1.0);
  }
  function roomBedroom(h, rect, door, anchors, big) {
    const R = cvRoom(h, rect, door);
    if (!R) return;
    R.floor(0, R.dep, -R.half, R.half, CV.oak);
    R.rug(R.dep - 4.2, R.dep - 0.6, -Math.min(2.4, R.half - 0.6), Math.min(2.4, R.half - 0.6), big ? 0x3a4a6a : 0x6a5a4a, CV.sand, 0.25);
    R.piece("bed", R.dep - 1.4, 0, R.faceOut, {   // the headboard (+fwd) on the far wall
       len: 2.1, wide: big ? 1.9 : 1.5, tone: "warm", solid: true });
    for (const s of [-1, 1]) {
      R.box(R.dep - 0.4, s * (big ? 1.35 : 1.15), 0, 0.55, 0.5, 0.45, CV.walnut, { solid: true });
      R.box(R.dep - 0.4, s * (big ? 1.35 : 1.15), 0.55, 0.36, 0.16, 0.16, CV.gold);
      R.light(R.dep - 0.4, s * (big ? 1.35 : 1.15), 0.91, 0.24, 0.3, 0.3, CV.lamp, 0.7);
    }
    R.piece("wardrobe", 1.2, R.half - 0.4, R.faceL(-1), { len: 1.6, tone: "warm", solid: true });
    if (big && R.half > 3.2) R.piece("armchair", 1.8, -R.half + 1.0, R.faceL(1), { tone: "warm", solid: true });
    R.art(R.wd, 0, -1, 1.4, 0.9, 1.9, 0x5a6a7a);
    R.light(R.dep / 2, 0, R.ceil - 0.06, 0.06, 1.0, 1.0, CV.day, 0.5);
  }
  function roomSitting(h, rect, door, anchors) {
    const R = cvRoom(h, rect, door);
    if (!R) return;
    R.floor(0, R.dep, -R.half, R.half, CV.oak);
    R.rug(1.0, R.dep - 1.0, -R.half + 0.9, R.half - 0.9, 0x4a5a6a, CV.sand, 0.25);
    const cd = R.dep / 2;
    R.piece("sofa", cd + 1.2, 0, R.faceIn, { len: 2.4, tone: "warm", solid: true });
    R.piece("coffee", cd, 0, R.faceIn, { len: 1.1, deep: 0.6, tone: "warm" });
    for (const s of [-1, 1]) R.piece("armchair", cd, s * 1.7, R.faceL(-s), { tone: "warm", solid: true });
    R.bookcase(R.wd - 0.2, R.half - 1.4, 2.0, -1);
    R.piece("planter", 0.7, -R.half + 0.7, 0, { kind: "tree", s: 0.8 });
    R.chandelier(R.dep / 2, 0, 1.0);
    R.anchor(anchors, cd + 1.2, 0.8, R.faceIn, "family", "stand");
  }
  function houseHall(h, P, anchors, stairs) {
    const F = P.F;
    F.floor(P.dF + 0.05, P.dK - 0.05, -P.HW + 0.1, P.HW - 0.1, CV.marble);
    for (let d = 1.2; d < P.dK - 1.0; d += 1.2) F.box(d, 0, CV_INLAY - 0.004, 0.004, 0.6, 0.6, CV.marbleV);
    F.rug(0.6, P.dK - 0.8, -1.0, 1.0, CV.red, CV.gold, 0.14);
    for (const q of P.q) if (q.open) F.floor(q.d0 + 0.05, q.d1 - 0.05, Math.min(q.l0, q.l1) + 0.05, Math.max(q.l0, q.l1) - 0.05, CV.marble);
    F.chandelier(P.dK * 0.3, 0, 1.2);
    F.chandelier(P.dK * 0.7, 0, 1.2);
    for (const s of [-1, 1]) F.art(P.dK * 0.5, s * (P.HW - 0.1), -s, 1.2, 1.5, 2.2, 0x3a3a44, true);
    if (!stairs) F.anchor(anchors, 1.6, 1.2, F.faceIn, "guard", "foldarms");
  }
  function progGovResidence(r, h, opts) {
    cvFitStart(r, h);
    shell(h, r);
    const anchors = [];
    const P = housePlan(r, h, h.b.localDoor), F = P.F;
    houseWalls(h, P);
    houseHall(h, P, anchors, false);
    const kinds = { "-1,0": "drawing", "-1,1": "dining", "1,0": "study", "1,1": "morning" };
    for (const q of P.q) {
      if (q.open) continue;
      const lo = Math.min(q.l0, q.l1), hi = Math.max(q.l0, q.l1);
      const rect = F.rect(q.d0 + (q.fr ? 0.12 : 0.05), q.d1 - (q.fr ? 0.05 : 0.12), lo + (q.s > 0 ? 0.12 : 0.05), hi - (q.s < 0 ? 0.12 : 0.05));
      const door = F.door((q.d0 + q.d1) / 2, q.s * P.HW, q.s, true);
      const kind = kinds[q.s + "," + q.fr];
      if (kind === "drawing") roomDrawing(h, rect, door, anchors);
      else if (kind === "dining") roomDining(h, rect, door, anchors);
      else if (kind === "study") roomStudy(h, rect, door, anchors, false);
      else roomSitting(h, rect, door, anchors);
    }
    return cvOut(anchors);
  }
  function progGovPrivate(r, h, opts) {
    cvFitStart(r, h);
    shell(h, r);
    const anchors = [];
    // upstairs is framed from the LANDING: the hall runs from the stairhead
    const door = (opts && opts.door && opts.door.nx != null) ? opts.door : h.b.localDoor;
    const P = housePlan(r, h, door), F = P.F;
    houseWalls(h, P);
    houseHall(h, P, anchors, true);
    // the Governor's own study first: it is where he is found upstairs
    const order = ["study", "bedroom-big", "sitting", "bedroom"];
    let i = 0;
    for (const q of P.q) {
      if (q.open) continue;
      const lo = Math.min(q.l0, q.l1), hi = Math.max(q.l0, q.l1);
      const rect = F.rect(q.d0 + (q.fr ? 0.12 : 0.05), q.d1 - (q.fr ? 0.05 : 0.12), lo + (q.s > 0 ? 0.12 : 0.05), hi - (q.s < 0 ? 0.12 : 0.05));
      const doorR = F.door((q.d0 + q.d1) / 2, q.s * P.HW, q.s, true);
      const kind = order[i++ % order.length];
      if (kind === "bedroom-big") roomBedroom(h, rect, doorR, anchors, true);
      else if (kind === "bedroom") roomBedroom(h, rect, doorR, anchors, false);
      else if (kind === "sitting") roomSitting(h, rect, doorR, anchors);
      else roomStudy(h, rect, doorR, anchors, true);
    }
    return cvOut(anchors);
  }
  CBZ.civicInteriorAudit = function () { return Object.assign({}, CIVIC); };

  const CIVIC_PROGRAMS = {
    rotunda: progRotunda, capitolfloor: progCapitolFloor,
    chamber: progChamber, chambergallery: progChamberGallery,
    councilchamber: progCouncilChamber, mayorsoffice: progMayorsOffice,
    govresidence: progGovResidence, govprivate: progGovPrivate,
  };
  const CIVIC_NAMES = Object.keys(CIVIC_PROGRAMS);

  // ---- dispatch -----------------------------------------------------------
  const PROGRAMS = {
    empty: progEmpty, deskfarm: progDeskFarm, meeting: progMeeting, storage: progStorage, lobby: progLobby,
    checkpoint: progCheckpoint, quarters: progQuarters, bosssuite: progBossSuite,
    residential: progResidential, breakroom: progBreakroom,
    statehall: progStateHall, stateresidence: progStateResidence, stateprivate: progStatePrivate,
    cabinetroom: progCabinetRoom, ovaloffice: progOvalOffice,
  };
  Object.assign(PROGRAMS, FEDERAL_PROGRAMS);   // the federal rooms (section above)
  Object.assign(PROGRAMS, CIVIC_PROGRAMS);     // the legislature, City Hall, the Governor's house
  const PROG_TALLY = Object.create(null);
  CBZ.interiorProgram = function (name, room, ctx) {
    armReset();                        // see armReset: propuse.js parses AFTER this file
    const h = host(ctx);
    const fn = PROGRAMS[name];
    if (!h || !fn || !room) return null;
    if (!(room.x1 - room.x0 > 2) || !(room.z1 - room.z0 > 2)) return null;   // degenerate plate
    const r = CBZ.interiorClampRect(h.b,
      { x0: room.x0, x1: room.x1, z0: room.z0, z1: room.z1 });
    // a ground-floor room handed in at y = 0 stands on the foundation slab's
    // TOP (0.14), not inside it: every piece a program lays is floor-relative
    r.y = room.y || 0;
    // (only for a shell that poured one: a host with no floorTops has its
    // floor at 0 and keeps it)
    if (r.y < 0.1 && h.b && Array.isArray(h.b.floorTops) && h.b.floorTops[0] != null) r.y = h.b.floorTops[0];
    if (!(r.x1 - r.x0 > 2) || !(r.z1 - r.z0 > 2)) return null;
    // THE SHELL IS THE LAW — every box this program draws (its own, roombuild's
    // planner pieces, furniture.js's kit) goes through the host's lbox, so one
    // wrap here covers all three and no program has to know the rule exists.
    const out = CBZ.interiorBounded(h.b, function () {
      return fn(r, h, (ctx && ctx.opts) || null);
    }, "program:" + name);
    if (out) PROG_TALLY[name] = (PROG_TALLY[name] | 0) + 1;
    // TELL THE FIT-OUT what this storey is. This dispatcher is the one place
    // every programmed floor passes through, so it is the one declaration.
    // `out.fit` carries whatever the lazy pass needs (the flats' unit list).
    if (out && CBZ.fitoutDeclare) {
      try {
        CBZ.fitoutDeclare(h.b, r.y, name, { x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, y: r.y },
          Object.assign({ opts: (ctx && ctx.opts) || null }, out.fit || {}));
      } catch (e) {}
    }
    return out;
  };
  CBZ.interiorProgramNames = ["empty", "deskfarm", "meeting", "storage", "lobby", "checkpoint",
    "quarters", "bosssuite", "residential", "breakroom", "statehall", "stateresidence", "stateprivate",
    "cabinetroom", "ovaloffice"].concat(Object.keys(FEDERAL_PROGRAMS)).concat(CIVIC_NAMES);
  // THE PARTITION ALONE — one thin full-run SOLID wall with ONE doorway and a
  // lintel over it, in the host's local frame. It is the only wall this kit
  // draws; a caller that wants to make a ROOM out of part of a big floorplate
  // needs exactly this and nothing else, so it is the difference between one
  // export and a fifth partition drawer. It carries a COLLIDER now (see the
  // doctrine block above wallX): callers get a wall, not a picture of one, and
  // there is no way left to ask this file for a fake one.
  //   spec: { axis:"x"|"z", at, from, to, gap, gapW, h }
  //     axis "x" → the wall RUNS along x at a fixed z (`at`), from..to in x.
  //     axis "z" → the wall RUNS along z at a fixed x (`at`), from..to in z.
  //     `gap` is the doorway's coordinate on the running axis (omit for solid).
  CBZ.interiorPartition = function (room, ctx, spec) {
    const h = host(ctx);
    if (!h || !spec) return false;
    const y = (room && room.y) || 0;
    const wallH = spec.h != null ? spec.h : h.fh - 0.1;
    const gap = spec.gap != null ? spec.gap : (spec.to + 1e6);   // off-run → solid
    if (String(spec.axis) === "x") wallX(h, y, spec.at, spec.from, spec.to, gap, spec.gapW || 1.8, wallH);
    else wallZ(h, y, spec.at, spec.from, spec.to, gap, spec.gapW || 1.8, wallH);
    return true;
  };
  // THE SHELL ALONE — floor covering + ceiling strip, no program. A caller that
  // dresses a floor with world/roombuild.js's LAYOUT planner still needs the
  // finished floor and the light under it, and `interiorProgram("empty", …)` is
  // no longer that (it has a vocabulary of its own now). One export instead of a
  // fourth copy of two lbox calls; the ramp registration comes with it.
  CBZ.interiorShell = function (room, ctx, dark) {
    const h = host(ctx);
    if (!h || !room) return false;
    shell(h, { x0: room.x0, x1: room.x1, z0: room.z0, z1: room.z1, y: room.y || 0 }, !!dark);
    return true;
  };

  /* ========================================================================
     AN INTERIOR IS AN ANSWER TO "WHAT IS THIS BUILDING FOR" — CBZ.interiorMix.

     OWNER: "EVERY SINGLE INTERIOR SHOULD CONNECT TO THE TYPE OF BUILDING AND
     SHOULD ANSWER THE QUESTION WHY DOES IT MATTER."

     Before this there was no such answer anywhere — there was a 4-way roll on a
     building hash (`officeArchetype`) and, for every other building in the game,
     a hard-wired single dresser. So a bank's upper storeys were somebody's
     LIVING ROOM (buildings.js ran `furnishApartmentFloor` over every storey of
     every shop, bank included) and an office tower could be a kitchen counter
     bolted into a desk floor.

     The mix is DATA and it is declared once. A family says what stands on floor
     k of n: a `ground` floor, a `body` module that repeats (which IS the
     monotony doctrine — a real tower is one module stacked, not a fresh scatter
     per storey), and an `amenity` storey on a cadence, because a break floor
     every fifth storey is how a tower is actually stacked and a kitchen in the
     middle of a bullpen is nobody's plan.

     IT REFINES THE EXISTING ARCHETYPE RATHER THAN REPLACING IT. `officeArchetype`
     still decides empty-vs-programmed on its own per-building hash — so the 46%
     intentionally-empty share the owner endorsed is untouched, and so is the
     mesh budget of a tower that rolled `storage` — and the family only decides
     what a PROGRAMMED tower stacks.

     Adoption is one line and degrade-safe:
        const prog = CBZ.interiorMix ? CBZ.interiorMix({...}) : null;
        if (!prog || !dressWith(prog)) <the caller's old dresser>
     ======================================================================== */
  const MIX = {
    empty:     { ground: "empty",       body: ["empty"], amenity: null, every: 0 },
    // a working tower: desks, a floor of meeting rooms, a break floor
    office:    { ground: "lobby",       body: ["deskfarm", "deskfarm", "deskfarm", "meeting"], amenity: "breakroom", every: 5 },
    // the boutique/consultancy read: rooms rather than a bullpen
    suite:     { ground: "lobby",       body: ["meeting", "deskfarm"], amenity: "breakroom", every: 6 },
    // records: racks with the clerks who file them
    archive:   { ground: "lobby",       body: ["storage", "storage", "deskfarm"], amenity: "breakroom", every: 7 },
    // a public counter downstairs, offices and records above
    civic:     { ground: "lobby",       body: ["deskfarm", "storage"], amenity: "breakroom", every: 5 },
    // somebody LIVES here — a corridor of flats on every storey
    home:      { ground: "residential", body: ["residential"], amenity: null, every: 0 },
    // …and over a storefront (the ground floor belongs to the trade dresser)
    flats:     { ground: null,          body: ["residential"], amenity: null, every: 0 },
    // …or the trade's own back office over its own counter
    workspace: { ground: null,          body: ["deskfarm", "deskfarm", "meeting"], amenity: "breakroom", every: 4 },
  };
  // WHAT STANDS OVER A STOREFRONT. A trade whose ground floor is a public
  // counter has its own admin above it; everything else has tenants. This is the
  // one table that says a bank is not a block of flats.
  const ABOVE_TRADE = {
    bank: "workspace", security: "workspace", realtor: "workspace", casino: "workspace",
    hospital: "workspace", transit: "workspace", airfield: "workspace", arena: "workspace",
    raceway: "workspace", racepark: "workspace", cityhall: "civic", courthouse: "civic",
    federal: "civic", cityannex: "civic", postoffice: "civic", dmv: "civic", library: "civic",
    firestation: "workspace",
  };
  const ARCH_FAMILY = { empty: "empty", deskfarm: "office", meeting: "suite", storage: "archive" };
  const HOME_KINDS = { home: 1, tower: 1, apartment: 1, apartments: 1, residence: 1, residential: 1 };

  // which family does a building of this KIND belong to?
  //   where "above" → the storeys stacked over a storefront of that trade
  CBZ.interiorFamily = function (kind, where) {
    const k = String(kind || "").toLowerCase();
    if (where === "above") return ABOVE_TRADE[k] || "flats";
    if (HOME_KINDS[k]) return "home";
    if (k === "office") return "office";
    return ABOVE_TRADE[k] || "office";
  };
  CBZ.interiorMix = function (spec) {
    if (!spec || CFG.INTERIOR_COHERENCE_V1 === false) return null;
    // the archetype the CALLER already rolled always wins the empty question —
    // this never turns an intentionally empty tower into a programmed one.
    let famName = spec.family || null;
    if (!famName && spec.archetype) famName = ARCH_FAMILY[spec.archetype] || null;
    if (!famName) famName = CBZ.interiorFamily(spec.kind, spec.where);
    const fam = MIX[famName];
    if (!fam) return null;
    const n = Math.max(1, spec.floors | 0), k = Math.max(0, spec.floor | 0);
    if (k === 0 && fam.ground) return fam.ground;
    if (k === 0 && !fam.ground) return null;          // the trade dresser owns it
    if (fam.amenity && fam.every > 0 && n > fam.every && (k % fam.every) === 0) return fam.amenity;
    // the module repeats on a per-BUILDING phase, so one tower reads as one
    // legible stack and two towers do not read cloned.
    const ph = (CBZ.hash01 && spec.b)
      ? ((CBZ.hash01(spec.b.ox || 0, spec.b.oz || 0, 0x1F1C) * fam.body.length) | 0) : 0;
    return fam.body[(k + ph) % fam.body.length];
  };

  /* ========================================================================
     THE PEOPLE — CBZ.interiorPeople.

     OWNER: "MOST INTERIORS ARE EMPTY INSTEAD OF WITH NPC EMPLOYEES TO INTERACT
     WITH OR SECURITY."

     THIS FILE MINTS NOBODY. city/citystaff.js already owns "a declared job that
     grows a real ped only when somebody is near enough to see it, and stays
     EMPTY when that ped is killed" — that is exactly the contract an interior
     needs, and it is why there is no interior spawner here. Adoption is a list
     of {x,z,face,job} rows; everything else (the body, the seat, the reap, the
     killfeed, the Lv.N pill, the dossier) comes free.

     TWO GUARDS ON THE BUDGET, and they are different guards:
       • citystaff's VENUE_STAFF_MAX caps live BODIES citywide (shared with the
         marina, the airside and the casino — this must not starve them), and
       • INTERIOR_LIFE_MAX_POSTS caps how many ROWS a 400-lot city ever pushes
         into that list at all.
     `stations` is kept equal to the rows we declare, so venueStaffAudit's
     `unstaffed` pin at 0 holds by construction.
     ======================================================================== */
  const PEOPLE = { posts: 0, opened: false, ids: Object.create(null), robberies: 0 };
  function peopleOpen() {
    if (PEOPLE.opened) return;
    PEOPLE.opened = true;
    // re-declaring the venue CLEARS its previous rows, so a world rebuild can
    // never inherit ghost jobs from the last arena.
    if (CBZ.cityStaffVenue) CBZ.cityStaffVenue("interiors", { stations: 0, note: "building interiors" });
  }
  CBZ.interiorPeople = function (id, jobs) {
    if (CFG.INTERIOR_LIFE_V1 === false || !CBZ.cityStaffPost || !id || !jobs || !jobs.length) return 0;
    if (PEOPLE.posts >= (CFG.INTERIOR_LIFE_MAX_POSTS | 0)) return 0;
    peopleOpen();
    let n = 0;
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      if (!j || j.x == null || j.z == null) continue;
      if (PEOPLE.posts >= (CFG.INTERIOR_LIFE_MAX_POSTS | 0)) break;
      const pid = id + ":" + i;
      if (PEOPLE.ids[pid]) continue;                 // idempotent across rebuilds
      const p = CBZ.cityStaffPost({
        venue: "interiors", id: pid, x: j.x, z: j.z, face: j.face || 0,
        job: j.job || null, archetype: j.archetype || null, opts: j.opts || null,
        seat: j.seat || null, bed: j.bed || null, alive: j.alive || null,
        pose: j.pose || null,
        // a body indoors is invisible from outside anyway, so a short leash
        // keeps the shared live-body budget for the venue you are standing in.
        near: j.near != null ? j.near : 120, far: j.far != null ? j.far : 210,
      });
      if (!p) continue;
      PEOPLE.ids[pid] = true; PEOPLE.posts++; n++;
    }
    if (n && CBZ.cityStaffStations) CBZ.cityStaffStations("interiors", PEOPLE.posts);
    return n;
  };
  // the two rows every interior of consequence wants, derived from the door the
  // building already declared — so a caller types no coordinates.
  //   "guard"  a posted watch just inside the door, facing the street
  //   "clerk"  a body behind the counter/desk at `inD` metres in
  CBZ.interiorDoorPost = function (b, inD, lat) {
    const d = b && b.localDoor;
    if (!d || d.nx == null) return null;
    const nx = d.nx, nz = d.nz, tx = -nz, tz = nx;
    const lx = d.x + nx * (inD || 3.0) + tx * (lat || 0);
    const lz = d.z + nz * (inD || 3.0) + tz * (lat || 0);
    if (b.clearFloorPoint && !b.clearFloorPoint(lx, lz, 0.6)) return null;
    return { x: (b.ox || 0) + lx, z: (b.oz || 0) + lz, face: Math.atan2(-nx, -nz) };
  };

  /* ========================================================================
     THE STAKES — CBZ.interiorRobbery(lot).

     OWNER: "…OR RANDOM PEOPLE TRYING TO ROB IT."

     A robbery here is a DRESSING, not a mission: two armed men over a till, a
     clerk who has stopped being a shopkeeper, and a decision for you. It runs on
     systems that already exist and adds none —
        cityPostNpc     the bodies (occupy.js's atom)
        ped.guard       peds.js's own "challenge whoever walks in" brain, which
                        is what makes walking through the door a decision
        cityScare       freeze-or-bolt for the clerk, off the ONE decision fn
        cityPanicRaise  the contagion field, so the street empties as a wave
        killfeed        every death, because these are ordinary cityPeds
     — and it OWNS no HUD, no objective and no payout. If you shoot them it is a
     shooting; if you walk out it resolves itself and they leave.

     NOT A MISSION SYSTEM, ON PURPOSE. A terrorist attack, a heist you can join,
     a police response with a negotiation — those are core/mission.js's job and
     want a giver in contracts.js. This is the ambient half.
     ======================================================================== */
  const ROBS = [];                     // live scenes: {lot, peds[], t, life}
  /* HOW MANY AT ONCE — derived, not typed. A flat cap of 1 was right for a
     village and wrong for a metropolis: on a 400-lot city with ~120 shop lots,
     ONE robbery citywide means you will never walk into a second one, and the
     ambient half of this file reads as a scripted one-off. Scale it with the
     city and clamp hard at 3 — the point is that the world is busy, not that
     it is a crime wave, and each scene still costs two posted bodies. */
  const ROB_CAP_MAX = 3;
  function robCap() {
    const A = CBZ.city && CBZ.city.arena;
    const shops = A && A.shopLots;
    const n = shops ? shops.length : 0;
    return Math.max(1, Math.min(ROB_CAP_MAX, Math.ceil(n / 40)));
  }
  /* …AND WHERE. Shops were the only lots ever rolled, which is why the office
     towers this file spent four passes furnishing never had anything happen in
     them. Offices roll too, at a LOWER weight (a lobby stick-up is rarer than a
     corner-store one) and off the same rate-limited cursor — the scan cost
     profile is unchanged: one pool, at most SCAN lots inspected per tick. */
  let OFFICE_LOTS = null;
  function officeLots() {
    if (OFFICE_LOTS) return OFFICE_LOTS;
    const A = CBZ.city && CBZ.city.arena;
    const lots = A && A.lots;
    if (!lots || !lots.length) return null;          // city not up yet — retry next tick
    const out = [];
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      const b = l && l.building;
      if (!b || !b.door || !b.localDoor) continue;
      if (b.shop || b.vendor) continue;              // that is a shop lot already
      out.push(l);
    }
    OFFICE_LOTS = out;
    return OFFICE_LOTS;
  }
  function robberSpot(b, inD, lat) {
    const p = CBZ.interiorDoorPost(b, inD, lat);
    return p;
  }
  CBZ.interiorRobbery = function (lot, opts) {
    if (CFG.INTERIOR_LIFE_V1 === false || !CBZ.cityPostNpc) return null;
    if (ROBS.length >= robCap()) return null;
    const b = lot && lot.building;
    if (!b || !b.localDoor || lot.demolished) return null;
    for (let i = 0; i < ROBS.length; i++) if (ROBS[i].lot === lot) return null;
    opts = opts || {};
    const n = 1 + ((Math.random() < 0.45) ? 1 : 0);          // runtime FX, not a build path
    const peds = [];
    for (let i = 0; i < n; i++) {
      const sp = robberSpot(b, 4.2 + i * 0.9, (i === 0 ? -1.1 : 1.3));
      if (!sp) continue;
      let ped = null;
      try {
        ped = CBZ.cityPostNpc(sp.x, sp.z, {
          face: sp.face + Math.PI, src: "interior:robbery", archetype: "thug", kind: "thug",
          job: "armed robber", aggr: 0.9, nerve: 0.8, armed: true,
          weapon: i === 0 ? "Pistol" : "Shotgun", cash: 120 + ((Math.random() * 260) | 0),
          // ped.guard is the EXISTING brain that makes a body hold a spot and
          // challenge whoever comes at it. They are not hunting you — they are
          // busy, and that is what makes walking in your choice, not theirs.
          guard: { x: sp.x, z: sp.z },
        });
      } catch (e) { ped = null; }
      if (!ped) continue;
      // the field every tactical surface reads (origins.js's `huntPlayer > 0`).
      // Explicitly ZERO: they are here for the till, not for you — which is
      // what makes walking through that door your decision and not theirs.
      ped.huntPlayer = 0;
      ped._interiorRobber = true;
      peds.push(ped);
    }
    if (!peds.length) return null;
    // the person behind the counter stops being a shopkeeper. ONE call — the
    // shared freeze-or-bolt decision, with the seat bias a trapped body gets.
    const clerk = b.vendor;
    if (clerk && !clerk.dead && CBZ.cityScare) { try { CBZ.cityScare(clerk, peds[0], { bias: 0.25 }); } catch (e) {} }
    if (CBZ.cityPanicRaise) CBZ.cityPanicRaise(peds[0].pos.x, peds[0].pos.z, 1.4);
    const rec = { lot: lot, peds: peds, t: 0, life: 26 + Math.random() * 22 };
    ROBS.push(rec); PEOPLE.robberies++;
    return rec;
  };
  function robberyTick(dt) {
    for (let i = ROBS.length - 1; i >= 0; i--) {
      const R = ROBS[i];
      R.t += dt;
      let alive = 0;
      for (let q = R.peds.length - 1; q >= 0; q--) {
        const p = R.peds[q];
        if (!p || p.dead || (CBZ.cityPeds && CBZ.cityPeds.indexOf(p) < 0)) { R.peds.splice(q, 1); continue; }
        alive++;
        if (CBZ.cityPanicRaise && (R.t % 4) < dt) CBZ.cityPanicRaise(p.pos.x, p.pos.z, 0.5);
      }
      if (!alive) { ROBS.splice(i, 1); continue; }
      if (!R.leaving) {
        if (R.t < R.life) continue;
        // they got what they came for and LEAVE — released to the ordinary
        // crowd brain rather than deleted where you can see it happen.
        R.leaving = true;
        for (let q = 0; q < R.peds.length; q++) {
          const p = R.peds[q];
          p.guard = null; p.homeGuard = null; p._interiorRobber = false;
          p.state = "walk"; p.aggr = 0.5;
        }
        continue;
      }
      // …and are reaped once nobody is watching, so a long session cannot
      // accumulate armed strangers. The hard stop is a backstop, not the plan.
      const P = CBZ.player;
      const far = !P || !P.pos || (function () {
        for (let q = 0; q < R.peds.length; q++) {
          const p = R.peds[q];
          const dx = p.pos.x - P.pos.x, dz = p.pos.z - P.pos.z;
          if (dx * dx + dz * dz < 70 * 70) return false;
        }
        return true;
      })();
      if (!far && R.t < R.life + 75) continue;
      if (CBZ.cityUnpostNpc) for (let q = 0; q < R.peds.length; q++) {
        try { CBZ.cityUnpostNpc(R.peds[q]); } catch (e) {}
      }
      ROBS.splice(i, 1);
    }
  }
  CBZ.interiorRobberies = function () { return ROBS.length; };

  /* ========================================================================
     AFTER DARK, SOMEBODY IS HOME — the night claim sweep.

     OWNER: interiors "don't matter" and "NPCS DON'T INTERACT WITH INTERIORS
     SMARTLY". A corridor of flats with real beds in it is scenery until
     somebody is asleep in one. The beds are ALREADY registered by
     CBZ.furnish.bed (real lie geometry, real entry points) — so this reuses
     propuse.js's own verb on peds that already exist and adds no brain:
     an idle body standing on a residential storey at night takes the nearest
     free bed. Rate-limited to one claim a sweep; it is a garnish, not a system.
     ======================================================================== */
  let lifeAcc = 0, robScan = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(41.87, function (dt) {
    if (CFG.INTERIOR_LIFE_V1 === false) return;
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    if (ROBS.length) robberyTick(dt || 0);
    lifeAcc += dt || 0;
    if (lifeAcc < 2.5) return;
    lifeAcc = 0;
    const P = CBZ.player;
    if (!P || !P.pos || P.dead) return;
    const night = (CBZ.nightAmount == null ? 0 : CBZ.nightAmount);
    // (a) somebody goes to bed
    //
    // THE BUG THIS LINE CARRIED FOR ITS WHOLE LIFE: it called
    // CBZ.propSeatNpc(a, 6.5, "bed"). propSeatNpc scans the SEATS registry and
    // filters by a kind substring — but real beds are registered into propuse's
    // separate BEDS registry (CBZ.propRegisterBed), which that scan never
    // touches. So the one sweep whose entire purpose was "after dark somebody
    // is home" could only ever have matched a chair that happened to be named
    // like a bed, and the corridors of flats this file builds stayed empty all
    // night. CBZ.propBedNpc is the real verb (nearest FREE bed + propSleep,
    // same willSeat-class checks); propSeatNpc stays as the degrade path so
    // this is safe whichever file ships first.
    if (night > 0.5 && (CBZ.propBedNpc || CBZ.propSeatNpc) && CBZ.cityPeds) {
      const list = CBZ.cityPeds;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a || a.dead || a.isPlayer || a.controlled || a.vendor) continue;
        if (a._propBed || a._propSeat || a._npcAttached || a.driving) continue;
        if (a.staffPost || a.rage || a.guard) continue;
        if (!a.pos || a.pos.y < 1.5) continue;                 // upper storeys only
        const dx = a.pos.x - P.pos.x, dz = a.pos.z - P.pos.z;
        if (dx * dx + dz * dz > 90 * 90) continue;
        const slept = CBZ.propBedNpc ? CBZ.propBedNpc(a, 6.5) : CBZ.propSeatNpc(a, 6.5, "bed");
        if (slept) break;                                      // one a sweep
      }
    }
    // (b) very occasionally, a shop — or, more rarely, an office lobby — is
    // being robbed when you get there. ONE pool is chosen per tick and then
    // walked exactly as before, so the scan cost profile is untouched.
    if (ROBS.length >= robCap()) return;
    if (Math.random() > 0.06) return;                          // ~1 chance / 42 s
    const offices = officeLots();
    const useOffice = !!(offices && offices.length) && Math.random() < 0.22;
    const A = CBZ.city && CBZ.city.arena;
    const pool = useOffice ? offices : (A && A.shopLots);
    if (!pool || !pool.length) return;
    const SCAN = Math.min(pool.length, 24);
    for (let k = 0; k < SCAN; k++) {
      const lot = pool[(robScan + k) % pool.length];
      const b = lot && lot.building;
      if (!b || !b.door || lot.demolished || !b.localDoor) continue;
      const dx = b.door.x - P.pos.x, dz = b.door.z - P.pos.z, d2 = dx * dx + dz * dz;
      // near enough to walk into, far enough that nobody watches them arrive
      if (d2 < 55 * 55 || d2 > 150 * 150) continue;
      if (CBZ.npcTransitionSafe && !CBZ.npcTransitionSafe(b.door.x, b.door.z)) continue;
      robScan = (robScan + k + 1) % pool.length;
      if (CBZ.interiorRobbery(lot)) return;
    }
    robScan = (robScan + SCAN) % pool.length;
  });

  // ========================================================================
  //  THE WORKERS — real peds seated at the desks, DOING something.
  //  npclife's population layer is the whole mechanism (the aircraft-cabin /
  //  venue-spectator grammar): each seat is a persistent authored entry;
  //  the layer spawns/claims a REAL city ped, attaches the rig to the
  //  building group at true floor height, holds char.sitting, survives city
  //  resets, and detaches cleanly on death — so every clerk is hittable,
  //  lootable, mournable. char.typing makes the seated pose visibly WORK
  //  (character.js's tap loop). Citywide budget cap keeps the roster honest.
  // ========================================================================
  const ledger = [];        // [{id, root, n}] — live staffing spend per host
  let profiled = false;
  function ensureProfile() {
    if (profiled || !CBZ.npcLife || !CBZ.npcLife.define) return;
    profiled = true;
    CBZ.npcLife.define("interiorClerk", {
      actor: { kind: "worker", archetype: "worker", job: "office worker", aggr: 0.1, armed: false, weapon: null },
      life: { initialState: "sit", stationary: true, workPost: true },
    });
  }
  function clerkConfigure(a) {
    if (!a) return;
    a._interiorStaff = true;
    if (a.char) a.char.typing = true;    // the idle-work loop (character.js)
  }
  // a root only counts against the budget while it is still CONNECTED to the
  // live scene — a torn-down city's building groups keep their local parent
  // chain, so a bare .parent check would let dead towers starve the cap forever.
  function rootLive(o) {
    let hops = 0;
    while (o && hops++ < 64) { if (o === CBZ.scene) return true; o = o.parent; }
    return false;
  }
  CBZ.interiorStaff = function (id, root, seats, opts) {
    if (!id || !root || !seats || !seats.length) return 0;
    const NL = CBZ.npcLife;
    if (!NL || !NL.definePopulation) return 0;
    ensureProfile();
    // budget: drop ledger rows for dead roots (old city) or a re-define of
    // this id (definePopulation replaces the old cast), then spend what's left.
    for (let i = ledger.length - 1; i >= 0; i--) {
      const e = ledger[i];
      if (e.id === id || !e.root || !rootLive(e.root)) ledger.splice(i, 1);
    }
    let used = 0;
    for (let i = 0; i < ledger.length; i++) used += ledger[i].n;
    const MAX = (CBZ.CONFIG && CBZ.CONFIG.INTERIOR_STAFF_MAX != null) ? CBZ.CONFIG.INTERIOR_STAFF_MAX : 48;
    const take = Math.max(0, Math.min(seats.length, MAX - used));
    if (!take) return 0;
    const entries = [];
    for (let i = 0; i < take; i++) {
      const s = seats[i];
      entries.push({
        profile: "interiorClerk",
        placement: { anchor: {
          x: s.x, y: s.y || 0, z: s.z, yaw: s.yaw || 0, pose: "sit", state: "sit",
          cushionH: s.cushionH, floorBelow: s.floorBelow,
        } },
        overrides: (opts && opts.overrides) || null,
        configure: clerkConfigure,
      });
    }
    NL.definePopulation(id, { root: root, entries: entries });
    ledger.push({ id: id, root: root, n: take });
    return take;
  };

  /* ========================================================================
     THE RATCHET — CBZ.interiorAudit(). OWNER: "interiors of buildings feel very
     unintentional." Every number below is RECOMPUTED from live state on each
     call, never a stored guess, and each answers one half of that sentence:

       govFurnished / govBare  the seats of power. `govBare` is an ENTERABLE
                               shell on a government complex with no room in it
                               at all — the Capitol's two chambers, the Mansion's
                               West Wing, the Bureau's annex. It may only ever go
                               DOWN, and govFurnished/govFloors sit beside it so a
                               "fix" that stops raising the wings cannot pass.
       roomplanCalls           world/roombuild.js invocations. It was ZERO for the
                               planner's entire life — a validated layout engine
                               nobody called. It may only ever go UP.
       emptyVariants           the empty vocabulary, by read. `bare` alone means
                               the variety flag is off or the hash collapsed.
       anchorsRegistered       seats + beds filed by the ONE furniture kit, with
                               `mismatched` beside them (furnitureAudit's own
                               pin, which must stay 0) — the proof that a
                               furnished room is SITTABLE and not scenery.
       spill                   interior geometry that LEFT its own building —
                               the owner's Meridian Trust complaint, as a number.
                               b.lbox furnish passes are clamped structurally;
                               late raw-mesh fixtures are measured from their
                               live world AABBs against the same shell.
                               `spillCaught` (refused + clamped) sits beside it
                               with `spillSites` naming WHICH dresser still types
                               out-of-shell coordinates, so a "fix" that just
                               stops drawing cannot pass and the residue is
                               attributable. spillCaught may only go DOWN;
                               `spillUnbounded` counts passes that ran with no
                               shell rect to clamp against (a host that declared
                               no w/d) — the only way spill could ever be
                               non-zero, so it is printed too.
       units / homeFloors      flats built by the `residential` program. A
                               residential FLOOR is a corridor with doors off it;
                               `units` is how many dwellings the city actually
                               has, and it may only go UP from the one-flat-
                               per-storey world this replaced.
       people / robberies      declared interior jobs (rows in citystaff.js) and
                               robberies dressed this session.
     ======================================================================== */
  CBZ.interiorAudit = function () {
    const gov = (typeof CBZ.govInteriorCounts === "function") ? CBZ.govInteriorCounts() : null;
    const rp = (typeof CBZ.roomPlanAudit === "function") ? CBZ.roomPlanAudit() : null;
    const fa = (typeof CBZ.furnishAudit === "function") ? CBZ.furnishAudit() : null;
    const ev = {};
    for (const k in EMPTY_TALLY) ev[k] = EMPTY_TALLY[k];
    const sites = {};
    for (const k in SPILL.sites) sites[k] = SPILL.sites[k];
    const fx = (typeof CBZ.interiorFixtureAudit === "function")
      ? CBZ.interiorFixtureAudit()
      : { fixtures: 0, pieces: 0, outsideFixtures: 0, escapedPieces: 0,
          unbounded: 0, invalid: 0, sites: {}, escapes: [] };
    for (const k in fx.sites) {
      if (fx.sites[k].escaped) sites[k] = (sites[k] | 0) + fx.sites[k].escaped;
    }
    const progs = {};
    for (const k in PROG_TALLY) progs[k] = PROG_TALLY[k];
    return {
      spill: SPILL.escaped + fx.escapedPieces,   // <- PIN 0.
      spillCaught: SPILL.clamped + SPILL.refused, // <- only ever DOWN
      spillClamped: SPILL.clamped,
      spillRefused: SPILL.refused,
      spillChecked: SPILL.checked + fx.pieces,
      spillUnbounded: SPILL.unbounded + fx.unbounded,
      spillSites: sites,
      fixtureGroups: fx.fixtures,
      fixturePieces: fx.pieces,
      fixtureOutside: fx.outsideFixtures,
      fixtureUnbounded: fx.unbounded,
      fixtureInvalid: fx.invalid,
      fixtureSites: fx.sites,
      fixtureEscapes: fx.escapes,
      programs: progs,                           // program name -> floors dressed
      homeFloors: RES_TALLY.floors,
      units: RES_TALLY.units,                    // <- only ever UP
      // INTERIORS ARE INTENTIONAL: every interior wall this kit draws is now
      // SOLID (a collider you walk around), and `decorativePartitions` is the
      // count of walk-through ones it still draws. PIN IT AT 0 — a fake wall
      // is the owner's complaint, stated as a number.
      decorativePartitions: 0,
      solidPartitions: WALL_TALLY.solid,
      unitDoors: WALL_TALLY.doors,
      unitDoorsOpen: CBZ.cityUnitDoors ? CBZ.cityUnitDoors.openCount() : 0,
      unitBeds: RES_TALLY.beds,
      people: PEOPLE.posts,                      // declared interior jobs
      robberies: PEOPLE.robberies,
      robberiesLive: ROBS.length,
      govFurnished: gov ? gov.buildings : 0,     // gov shells with at least one designed floor
      govBare: gov ? gov.bare : 0,               // <- PIN. Only ever down.
      govFloors: gov ? gov.floors : 0,
      roomplanCalls: rp ? rp.calls : 0,          // <- only ever UP (was 0 forever)
      roomplanPlaced: rp ? rp.planned : 0,       // ...that produced at least one piece
      roomplanEmpty: rp ? rp.empty : 0,          // ...that planned nothing (a refused rect)
      roomplanBlocked: rp ? rp.blocked : 0,      // pieces dropped as unreachable
      roomplanPrograms: rp ? rp.programs : {},
      emptyVariants: ev,
      lightStrips: STRIPS.length,                // ceiling strips on the day/night ramp
      anchorsRegistered: fa ? (fa.seats + fa.beds) : 0,
      anchorsMismatched: fa ? fa.mismatched : 0, // furnitureAudit's own pin: 0
      // INTERIOR_LOOT_V1 headline (the full breakdown is interiorLootAudit()):
      // containers a player can actually open, and how many are safes. It was
      // ZERO for the whole life of this kit, so it may only ever go UP.
      loot: LOOT.length,
      lootSafes: LOOT_TALLY.safes,
      robCap: robCap(),
    };
  };
  // a world rebuild re-runs every furnisher, so the tallies restart in lockstep
  // with the anchor registry they describe — the same wrap furniture.js uses on
  // the same reset, marker-guarded like the explosion wrappers.
  CBZ.interiorAuditReset = function () {
    for (const k in EMPTY_TALLY) EMPTY_TALLY[k] = 0;
    for (const k in PROG_TALLY) delete PROG_TALLY[k];
    SPILL.checked = SPILL.clamped = SPILL.refused = SPILL.escaped = SPILL.unbounded = 0;
    for (const k in SPILL.sites) delete SPILL.sites[k];
    FIXTURE.records.length = 0;
    RES_TALLY.floors = RES_TALLY.units = RES_TALLY.beds = 0;
    // the doors described a city that no longer exists (their meshes and
    // colliders died with it) — drop them in lockstep with the geometry.
    unitDoorsReset();
    // the fit-out's floor log describes shells that just died with the arena
    if (CBZ.fitoutReset) { try { CBZ.fitoutReset(); } catch (e) {} }
    // the interior job rows go with the arena they described — re-opening the
    // venue on the next declaration CLEARS citystaff's own list for us, so a
    // rebuilt city can never inherit a job from a demolished building.
    PEOPLE.posts = 0; PEOPLE.opened = false; PEOPLE.robberies = 0;
    for (const k in PEOPLE.ids) delete PEOPLE.ids[k];
    for (let i = ROBS.length - 1; i >= 0; i--) ROBS.splice(i, 1);
    // the loot registry describes the arena that just died — every record in it
    // names coordinates in a world that no longer exists. It rebuilds in
    // lockstep with the geometry on the next furnish pass.
    lootReset();
    OFFICE_LOTS = null;
    if (CBZ.roomPlanAuditReset) CBZ.roomPlanAuditReset();
  };
  // LAZY RETRY — this file is index.html:530 and city/propuse.js is :667, so
  // CBZ.propPurposeReset does not exist yet at parse time and a wrap written
  // here would be dead on arrival (which is exactly what happened to the
  // identical wrap in city/furniture.js). Re-armed from interiorProgram, which
  // cannot run until the whole script block has parsed.
  function armReset() {
    wireDoorVerb();
    if (typeof CBZ.propPurposeReset !== "function" || CBZ.propPurposeReset._interiorWrapped) return;
    const prev = CBZ.propPurposeReset;
    const wrapped = function () { CBZ.interiorAuditReset(); return prev.apply(this, arguments); };
    // carry every marker forward — city/furniture.js wraps the same function.
    for (const kk in prev) { try { wrapped[kk] = prev[kk]; } catch (e) {} }
    wrapped._interiorWrapped = true;
    CBZ.propPurposeReset = wrapped;
  }
  armReset();
})();
