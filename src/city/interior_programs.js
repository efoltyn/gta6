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
  // Ground floors (y≈0) lift the covering to clear the 0.14-top foundation
  // slab the building shells pour; upper floors use the standard 0.02 lift.
  // `dark` drops the ceiling strip: an UNLIT storey in a lit tower, which is a
  // deliberate read from the street and the one variant that must be per-FLOOR.
  function shell(h, r, dark) {
    const w = Math.max(1, r.x1 - r.x0), d = Math.max(1, r.z1 - r.z0);
    const fy = r.y < 0.1 ? r.y + 0.13 : r.y + 0.02;
    h.b.lbox(cx(r), fy, cz(r), w, 0.04, d, P.floor, { cast: false });
    if (dark) return;
    const m = h.b.lbox(cx(r), r.y + h.fh - 0.24, cz(r), Math.min(w * 0.6, 8.0), 0.08, 0.5, P.light,
      { emissive: P.light, ei: 0.32, cast: false });
    ceilingStrip(m);
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
  function unitDoorsReset() { UNIT_DOORS.length = 0; UNIT_GRID.clear(); WALL_TALLY.solid = 0; WALL_TALLY.doors = 0; }

  // fill a partition's doorway with a locked leaf. `axis` is the axis the WALL
  // RUNS along ("x" → fixed z at `at`, doorway centred on `gap` in x).
  function unitDoor(h, y, axis, at, gap, gapW, wallH, id, label) {
    const alongX = axis === "x";
    const lx = alongX ? gap : at, lz = alongX ? at : gap;
    const leaf = h.b.lbox(lx, y + DOOR_H / 2, lz,
      alongX ? gapW : PWT, DOOR_H, alongX ? PWT : gapW, P.door, WALLOPT);
    if (!leaf || !leaf.position) return null;
    // the collider lbox just pushed for this exact mesh (solid:true pushes one)
    const cols = CBZ.colliders || [];
    const col = cols.length && cols[cols.length - 1].ref === leaf ? cols[cols.length - 1] : null;
    if (!col) return null;
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
      x: h.ox + lx, z: h.oz + lz, floorY: y, top: y + wallH,
      mesh: leaf, col: col, b: h.b, ox: h.ox, oz: h.oz,
    };
    unitFile(d);
    WALL_TALLY.doors++;
    return d;
  }

  function unitSetOpen(d, open) {
    if (!d || !d.mesh || !!d.open === !!open) return false;
    d.open = !!open;
    const cols = CBZ.colliders || [];
    if (d.open) {
      if (!(CBZ.batchWallHide && CBZ.batchWallHide(d.mesh))) d.mesh.visible = false;
      const i = cols.indexOf(d.col);
      if (i >= 0) cols.splice(i, 1);
    } else {
      if (!(CBZ.batchWallShow && CBZ.batchWallShow(d.mesh))) d.mesh.visible = true;
      if (cols.indexOf(d.col) < 0) cols.push(d.col);
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    return true;
  }
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
        // the floor you are STANDING on, never the flat two storeys up
        if (py != null && (py < d.floorY - 1.2 || py > d.top + 0.6)) continue;
        const dx = d.x - px, dz = d.z - pz, q = dx * dx + dz * dz;
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
      id: "zone-unit-door", kind: "unitdoor", prio: 8, driving: false,
      find: function (px, pz, ctx) { return unitDoorAt(px, pz, 1.9, ctx && ctx.pos ? ctx.pos.y : null); },
      options: [{
        id: "unit-door-use", slot: "e",
        label: function (d) {
          if (d.open) return "Close " + d.label;
          return unitMayOpen(d) ? ("Unlock " + d.label) : ("Locked. " + d.label + ".");
        },
        onSelect: function (d) {
          const note = (CBZ.city && CBZ.city.note) ? CBZ.city.note : function () {};
          if (d.open) { unitSetOpen(d, false); note("Closed " + d.label + ".", 1.6); return; }
          if (!unitMayOpen(d)) { note("Locked. " + d.label + ".", 2.0); return; }
          // YOU OWN IT → you get the key, once, as a real item in the bag.
          // Ownership already opened the door; the key is so the player can SEE
          // that this address is theirs without standing in front of it.
          if (CBZ.cityKeys && CBZ.cityKeys.grant && !CBZ.cityKeys.has(d.id))
            { try { CBZ.cityKeys.grant(d.id, "Key · " + d.label); } catch (e) {} }
          unitSetOpen(d, true);
          note("Unlocked " + d.label + ".", 1.8);
        },
      }],
    });
    I.describe("unitdoor", function (d) {
      return { label: d.label, note: d.open ? "Open" : (unitMayOpen(d) ? "Your key fits" : "Locked — somebody lives here") };
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
        if (!eb(dx, dz, 0.03, 1.5, 0.66, 0.85, P.desk, { pad: 0.6 })) continue;
        eb(dx, dz, 0.69, 1.62, 0.08, 0.95, P.worktop, { pad: 0.6 });
        if (i === 0) {           // ONE monitor still on — the whole read
          eb(dx, dz - 0.42, 0.79, 0.7, 0.46, 0.06, P.bezel, { pad: 0.55 });
          eb(dx, dz - 0.42 + 0.03 + SCREEN_GAP + 0.01,
            0.81, 0.58, 0.36, 0.02, P.screen,
            { emissive: P.screen, ei: 0.55, pad: 0.55 }); // 2.5cm clear of bezel
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
      const seatZ = dz + 0.85, monZ = dz - 0.42;
      // gate BOTH the chair and the desk body — the door aisle / stair strip /
      // elevator chase punch clean holes in the grid, nothing else does.
      if (!h.clear(dx, seatZ, 0.6) || !h.clear(dx, dz, 0.7)) continue;
      h.b.lbox(dx, y + 0.36, dz, 1.5, 0.66, 0.85, P.desk, { cast: false });        // desk pedestal
      h.b.lbox(dx, y + 0.72, dz, 1.62, 0.08, 0.95, P.worktop, { cast: false });    // worktop
      h.b.lbox(dx, y + 1.02, monZ, 0.7, 0.46, 0.06, P.bezel, { cast: false });     // monitor
      const screenZ = monZ + 0.03 + SCREEN_GAP + 0.01;
      h.b.lbox(dx, y + 1.04, screenZ, 0.58, 0.36, 0.02, P.screen, { cast: false }); // lit face
      h.b.lbox(dx, y + 0.74, monZ, 0.12, 0.12, 0.12, P.bezel, { cast: false });    // stand
      h.b.lbox(dx, y + 0.42, seatZ, 0.6, 0.12, 0.6, P.chair, { cast: false });     // seat pad
      h.b.lbox(dx, y + 0.78, seatZ + 0.26, 0.6, 0.7, 0.12, P.chair, { cast: false }); // backrest
      h.b.lbox(dx, y + 0.2, seatZ, 0.1, 0.4, 0.1, P.bezel, { cast: false });       // post
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
        CBZ.cctvAddScreen(h.ox + dx, y + 1.04, h.oz + screenZ + 0.01, 0, 1);
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
    tb(TL, 0.1, 1.3, 0.48, P.table);                              // top
    tb(Math.max(0.6, TL - 1.4), 0.42, 0.5, 0.24, P.table);        // spine base
    // INTERIOR_LOOT_V1: what somebody left on the boardroom table after the
    // meeting — one container per meeting room, hash-thinned like every desk.
    lootReg(h.ox + mx2, y, h.oz + mz2, "desk");
    // chairs: three a side + one at each end, every one facing the table
    for (let i = -1; i <= 1; i++) for (let s = -1; s <= 1; s += 2) {
      const lat = i * (TL / 2 - 0.7), off = s * 1.05;
      const qx = alongX ? mx2 + off : mx2 + lat;
      const qz = alongX ? mz2 + lat : mz2 + off;
      if (!h.clear(qx, qz, 0.5)) continue;
      h.b.lbox(qx, y + 0.42, qz, 0.5, 0.14, 0.5, P.chair, { cast: false });
      h.b.lbox(qx + (alongX ? s * 0.24 : 0), y + 0.8, qz + (alongX ? 0 : s * 0.24),
        alongX ? 0.12 : 0.5, 0.6, alongX ? 0.5 : 0.12, P.chair, { cast: false });
      seatReg(h, qx, y, qz, Math.atan2(mx2 - qx, mz2 - qz), "chair", 0.49);
    }
    for (let e = -1; e <= 1; e += 2) {
      const lat = e * (TL / 2 + 0.75);
      const qx = alongX ? mx2 : mx2 + lat;
      const qz = alongX ? mz2 + lat : mz2;
      if (!h.clear(qx, qz, 0.5)) continue;
      h.b.lbox(qx, y + 0.42, qz, 0.5, 0.14, 0.5, P.chair, { cast: false });
      h.b.lbox(qx + (alongX ? 0 : e * 0.24), y + 0.8, qz + (alongX ? e * 0.24 : 0),
        alongX ? 0.5 : 0.12, 0.6, alongX ? 0.12 : 0.5, P.chair, { cast: false });
      seatReg(h, qx, y, qz, Math.atan2(mx2 - qx, mz2 - qz), "chair", 0.49);
    }
    // one wall screen on the FAR wall (glow proud of the bezel, toward the
    // room) + one light line over the table
    const fx = alongX ? (din.nx > 0 ? room.x1 - 0.3 : room.x0 + 0.3) : mx2;
    const fz = alongX ? mz2 : (din.nz > 0 ? room.z1 - 0.3 : room.z0 + 0.3);
    h.b.lbox(fx, y + 1.62, fz, alongX ? 0.08 : 2.3, 1.15, alongX ? 2.3 : 0.08, P.bezel, { cast: false });
    const screenOff = 0.04 + SCREEN_GAP + 0.02;
    h.b.lbox(alongX ? fx - Math.sign(din.nx) * screenOff : fx, y + 1.62,
      alongX ? fz : fz - Math.sign(din.nz) * screenOff,
      alongX ? 0.04 : 2.0, 0.9, alongX ? 2.0 : 0.04, P.glow, { emissive: P.glow, ei: 0.4, cast: false });
    ceilingStrip(h.b.lbox(mx2, y + h.fh - 0.28, mz2, alongX ? 0.34 : TL * 0.8, 0.06, alongX ? TL * 0.8 : 0.34, P.light,
      { emissive: P.light, ei: 0.3, cast: false }));
    return { anchors: anchors };
  }

  // ========================================================================
  //  (b/c) STORAGE — uniform rack rows on a fixed pitch, identical heights,
  //  identical shelf lines. An archive floor: monotony executed cleanly.
  // ========================================================================
  const RACK_PITCH = 2.6, RACK_SEG = 2.2, RACK_GAP = 0.5, RACK_H = 2.2;
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
        h.b.lbox(x, y + RACK_H / 2, zc2, 0.6, RACK_H, RACK_SEG, P.desk, { cast: false });   // rack body
        h.b.lbox(x, y + 0.8, zc2, 0.66, 0.06, RACK_SEG + 0.06, P.shelf, { cast: false });   // shelf line
        h.b.lbox(x, y + 1.5, zc2, 0.66, 0.06, RACK_SEG + 0.06, P.shelf, { cast: false });   // shelf line
        h.b.lbox(x, y + RACK_H + 0.03, zc2, 0.66, 0.06, RACK_SEG + 0.06, P.shelf, { cast: false }); // cap
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
    // THE DESK — one long front desk square to the door
    const pd = at(dIn, 0);
    if (inRect(r, pd.x, pd.z, 1.2) && h.clear(pd.x, pd.z, 0.9)) {
      obox(pd, 0.5, 2.6, 0.92, 0.9, P.desk);
      obox(pd, 0.99, 2.8, 0.07, 1.05, P.worktop);
      // INTERIOR_LOOT_V1: the one desk on the arrival floor, and the only
      // container in this kit that is never thinned — there is exactly one
      // reception desk per lobby and skipping it would be skipping the lobby.
      lootReg(h.ox + pd.x, y, h.oz + pd.z, "reception");
      // the receptionist chair behind the desk, facing the door
      const pc = at(dIn + 0.95, 0);
      obox(pc, 0.42, 0.56, 0.14, 0.56, P.chair);
      obox(at(dIn + 1.2, 0), 0.78, 0.56, 0.62, 0.12, P.chair);
      const yaw = Math.atan2(-nx, -nz);               // look back out the door
      anchors.push({
        x: h.ox + pc.x, y: y, z: h.oz + pc.z, face: yaw, lx: pc.x, lz: pc.z,
        cushionH: 0.49, floorBelow: 0,
      });
      // the lit name band floating behind the desk
      const pb = at(dIn + 1.7, 0);
      h.b.lbox(pb.x, y + 2.35, pb.z, along ? 0.07 : 2.8, 0.5, along ? 2.8 : 0.07, P.light,
        { emissive: P.light, ei: 0.35, cast: false });
    }
    // ONE waiting row — three seats, off the walk line, facing it
    const pbn = at(Math.min(dIn - 0.6, 4.6), -3.1);
    if (inRect(r, pbn.x, pbn.z, 1.0) && h.clear(pbn.x, pbn.z, 0.8)) {
      obox(pbn, 0.36, 2.2, 0.16, 0.7, P.chair);                        // bench
      obox(at(Math.min(dIn - 0.6, 4.6), -3.36), 0.72, 2.2, 0.6, 0.14, P.chair);  // backrest
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
      obox(pp, 0.3, 0.6, 0.6, 0.6, P.planter);
      obox(pp, 0.95, 0.7, 0.7, 0.7, P.leaf);
    }
    return { anchors: anchors };
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
        (o && o.emissive) ? { emissive: o.emissive, ei: o.ei || 0.45, cast: false } : { cast: false });
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
    // ---- CRATES stacked in the dead corner (two down, one on top) ---------
    if (A.obox(A.at(dep - 1.2, -half + 0.7), 0.42, 0.85, 0.82, 0.85, P.crate, { pad: 0.45 }))
      lootAtA(A, dep - 1.2, -half + 0.7, "crate");
    A.obox(A.at(dep - 2.1, -half + 0.7), 0.42, 0.85, 0.82, 0.85, P.crate, { pad: 0.45 });
    A.obox(A.at(dep - 1.2, -half + 0.7), 1.28, 0.8, 0.78, 0.8, P.crate, { pad: 0.45 });
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
      A.obox(A.at(sd + 0.6, -half + 1.9), 0.02, Math.min(4.0, span * 0.5), 0.03, Math.min(3.2, homeEnd * 0.34), P.rug, { pad: 0.7 });
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
    const plans = { "-1": planFor(-1), "1": twoSided ? planFor(1) : null };
    // replay ONE unit's plan, shifted along the run, THROUGH THE ONE EXECUTOR
    // (roombuild.js's CBZ.roomExecute) — never a second copy of the ox/oz
    // forwarding, the lamp signature and the seat re-file. Every piece is
    // re-gated on the host's own aisle/stair/chase predicate at its REAL
    // position: the plan is a layout, not a permit.
    function replay(plan, dRun) {
      if (!plan || !CBZ.roomExecute) return 0;
      const ex = CBZ.roomExecute(plan, { y: y }, {
        box: h.b.lbox, ox: h.ox, oz: h.oz, tone: (opts && opts.tone) || null,
        dx: alongX ? dRun : 0, dz: alongX ? 0 : dRun, max: pieceCap,
        accept: function (px, pz) { return inRect(r, px, pz, 0.25) && h.clear(px, pz, 0.45); },
      });
      for (let q = 0; q < ex.beds.length; q++) beds.push(ex.beds[q]);
      return ex.executed;
    }
    // ---- the floor: corridor walls with a door per flat, party walls between,
    //      a kitchen run inside each, and one strip light down the hall --------
    // A flat is only built where its OWN FRONT DOOR is walkable. The ground
    // storey's entrance aisle, the stair strip and the lift chase therefore
    // punch a clean hole in the rank (the roomKit idiom) instead of a corridor
    // wall standing across the way in — which is the same discipline every
    // other program in this kit uses, applied to a whole dwelling.
    const kept = { "-1": [], "1": [] };
    let live = 0;
    for (let u = 0; u < units; u++) {
      const a = runLo + u * UW, b2 = a + UW;
      const mid = (a + b2) / 2;
      for (let s = 0; s < sides.length; s++) {
        const side = sides[s], key = side < 0 ? "-1" : "1";
        const crossAt = side < 0 ? cLo : cHi;
        const dp = P(mid, crossAt);
        if (!inRect(r, dp.x, dp.z, 0.2) || !h.clear(dp.x, dp.z, 0.8)) { kept[key][u] = false; continue; }
        kept[key][u] = true; live++;
        wallRun(crossAt, a, b2, mid, 1.0);                    // the corridor wall...
        // ...and the flat's own LOCKED front door filling the gap in it. This
        // is the one interior wall the owner asked for by name: "locked
        // apartment you have key to that allows interior walls in an apartment
        // building". The corridor stays public; the flat does not.
        const n = u * sides.length + s;
        const label = "Unit " + (floorK + 1) + String.fromCharCode(65 + (n % 26));
        unitDoor(h, y, alongX ? "x" : "z", crossAt, mid, 1.0, wallH,
          addr + ":" + n, label);
        if (u > 0 && kept[key][u - 1]) {                      // party wall between flats
          if (side < 0) wallCross(a, crossLo, cLo);
          else wallCross(a, cHi, crossHi);
        }
        // KITCHEN RUN against the corridor wall, beside the door — cabinets and
        // a worktop, two boxes, the one thing roombuild has no verb for. Its
        // length is what actually FITS between the doorway and the party wall
        // (door half 0.5 + a 0.12 shin gap on one side, 0.13 off the wall on the
        // other), so it can neither block the way in nor cross into next door.
        const kLen = Math.min(UW / 2 - 0.75, 1.6);
        const kOff = 0.62 + kLen / 2;
        const kIn = side < 0 ? -0.42 : 0.42;
        const kp = P(mid - kOff, crossAt + kIn);
        if (kLen >= 0.7 && inRect(r, kp.x, kp.z, 0.3) && h.clear(kp.x, kp.z, 0.5)) {
          h.b.lbox(kp.x, y + 0.45, kp.z, alongX ? kLen : 0.62, 0.9, alongX ? 0.62 : kLen, P_KIT.body, { cast: false });
          h.b.lbox(kp.x, y + 0.93, kp.z, alongX ? kLen + 0.06 : 0.68, 0.06, alongX ? 0.68 : kLen + 0.06, P_KIT.top, { cast: false });
          // INTERIOR_LOOT_V1: somebody's kitchen drawer. The lowest rung of the
          // ladder on purpose — a corridor of flats is a burglary run of small
          // takes, not a vault, and the flats are where a player actually is.
          lootReg(h.ox + kp.x, y, h.oz + kp.z, "kitchen");
        }
        replay(plans[key], (u * UW));
      }
    }
    if (!live) return { anchors: anchors, beds: beds, units: 0 };
    // the hall itself: one long strip light, which is the whole read from the
    // stairhead — a lit corridor with doors down it.
    ceilingStrip(h.b.lbox(cx(r), y + h.fh - 0.26, cz(r),
      alongX ? Math.min(runLen - 1.0, 14) : 0.3, 0.06,
      alongX ? 0.3 : Math.min(runLen - 1.0, 14), P.light,
      { emissive: P.light, ei: 0.26, cast: false }));
    RES_TALLY.floors++; RES_TALLY.units += live; RES_TALLY.beds += beds.length;
    return { anchors: anchors, beds: beds, units: live };
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
    desk:       { rate: 0.18, tier: 0, dud: 0.42, item: 0.20, cash: [4, 44],    label: "Search the desk",           empty: "Paperwork, dead pens, somebody's charger. Nothing." },
    reception:  { rate: 1.00, tier: 0, dud: 0.34, item: 0.26, cash: [10, 80],   label: "Go through the front desk", empty: "Visitor badges and a sign-in book. Nothing worth taking." },
    kitchen:    { rate: 0.45, tier: 0, dud: 0.40, item: 0.34, cash: [3, 26],    label: "Search the kitchen drawers",empty: "Cutlery, takeaway menus, a dead kettle." },
    rack:       { rate: 0.22, tier: 1, dud: 0.38, item: 0.30, cash: [10, 74],   label: "Search the shelves",        empty: "Archive boxes. Somebody's tax returns from nine years ago." },
    crate:      { rate: 0.55, tier: 1, dud: 0.30, item: 0.36, cash: [15, 92],   label: "Pry open the crate",        empty: "Packing foam and an empty inventory sheet." },
    footlocker: { rate: 0.60, tier: 1, dud: 0.32, item: 0.36, cash: [12, 84],   label: "Open the footlocker",       empty: "Spare boots, a bar of soap, a letter he never sent." },
    weapons:    { rate: 1.00, tier: 2, dud: 0.24, item: 0.44, cash: [20, 120],  gun: 0.10, label: "Force the weapons locker", empty: "Empty racks. Whatever was in here walked out already." },
    cabinet:    { rate: 1.00, tier: 3, dud: 0.16, item: 0.46, cash: [140, 620], label: "Open the drinks cabinet", empty: "Good bottles, all of them empty. He drinks alone." },
    safe:       { rate: 1.00, tier: 4, dud: 0.00, item: 0.34, cash: [0, 0],     label: "Crack the floor safe",      empty: "Deeds, a passport in another name — and no cash. He moved it." },
  };
  // WHAT COMES OUT, by container. Every name is checked against the live econ
  // catalog before it is offered, so a catalog edit can only ever shrink these.
  const LOOT_ITEMS = {
    desk:       ["Wallet", "Phone", "Burner Phone", "Laptop"],
    reception:  ["Wallet", "Phone", "Laptop", "Cash Stack"],
    kitchen:    ["Hotdog", "Soda", "Coffee", "Wallet"],
    rack:       ["Crowbar", "Lockpick", "Laptop", "Ammo Box"],
    crate:      ["Ammo Box", "Crowbar", "Body Armor"],
    footlocker: ["Wallet", "Ammo Box", "Knife", "Body Armor"],
    weapons:    ["Ammo Box", "Body Armor", "Knife"],
    cabinet:    ["Rolex", "Diamond Ring", "Cash Stack", "Gold Bar"],
    safe:       ["Gold Bar", "Cash Stack", "Iced Watch", "Briefcase of Cash"],
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
    return K ? K.label : "Search it";
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
  //  PRESIDENTIAL ROOMS — four declared programs, no procedural prop scatter.
  //
  //  These are in the shared interior owner because govcomplex.js should only
  //  say WHICH program occupies a floor. Every chair/sofa/table goes through
  //  CBZ.furnish, so the props expose the same sit/lie interaction grammar as
  //  an apartment or a shop. Three visibly placed decision objects publish
  //  their coordinates for presidency.js to wire into the one interaction
  //  registry; the room program does not implement political state itself.
  // ========================================================================
  const PRESIDENTIAL = { rooms: [], props: [], usable: 0, symbols: 0, emptyDecor: 0 };

  function presidentialReset() {
    PRESIDENTIAL.rooms.length = 0;
    PRESIDENTIAL.props.length = 0;
    PRESIDENTIAL.usable = 0;
    PRESIDENTIAL.symbols = 0;
    PRESIDENTIAL.emptyDecor = 0;
  }
  function presidentialPiece(name, r, h, x, z, yaw, opts) {
    const F = CBZ.furnish;
    const fn = F && F[name];
    if (typeof fn !== "function") return null;
    const o = Object.assign({}, opts || {}, {
      box: h.b.lbox, ox: h.ox, oz: h.oz, oy: 0, lot: null, solid: false,
    });
    try {
      return name === "lamp" ? fn(x, r.y, z, o) : fn(x, r.y, z, yaw || 0, o);
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
    // Publish the authored spatial grammar, not just a room count. Visual QA
    // and future occupants can now target the actual dining table, secure
    // portal, presidential desk, etc. even when two stacked floors approach
    // the same plate from opposite stair directions.
    if (A) {
      const entry = A.at(0, 0);
      rec.approach = {
        x: h.ox + entry.x, z: h.oz + entry.z,
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
  }
  function presidentialProp(key, label, order, h, r, p) {
    const rec = { key: key, label: label, order: order, x: h.ox + p.x, y: r.y, z: h.oz + p.z };
    PRESIDENTIAL.props.push(rec);
    return rec;
  }
  function presidentialZoneRect(A, r, d0, d1, lat0, lat1) {
    const pts = [A.at(d0, lat0), A.at(d0, lat1), A.at(d1, lat0), A.at(d1, lat1)];
    return {
      x0: Math.min.apply(null, pts.map(function (p) { return p.x; })),
      x1: Math.max.apply(null, pts.map(function (p) { return p.x; })),
      z0: Math.min.apply(null, pts.map(function (p) { return p.z; })),
      z1: Math.max.apply(null, pts.map(function (p) { return p.z; })),
      y: r.y,
    };
  }
  function presidentialPortal(A, depth, lateral, gapW) {
    const edge = gapW / 2 + 0.18;
    for (const s of [-1, 1]) {
      A.fitbox(A.at(depth - 0.04, lateral + s * edge), 1.45, 0.30, 2.62, 0.38, P.marble);
      A.fitbox(A.at(depth - 0.10, lateral + s * edge), 1.45, 0.07, 2.38, 0.42, P.gold);
    }
    A.fitbox(A.at(depth - 0.04, lateral), 2.76, gapW + 0.72, 0.18, 0.40, P.marble);
    A.fitbox(A.at(depth - 0.10, lateral), 2.70, gapW + 0.46, 0.06, 0.44, P.gold);
  }

  function progStateHall(r, h, opts) {
    // This is always the first presidential program built, so it is also the
    // world-rebuild boundary for the tiny room/prop ledger below.
    presidentialReset();
    shell(h, r);
    const A = approach(r, h, opts);
    const dep = A.depth, half = A.span / 2 - 0.8;
    let usable = 0;

    // One ceremonial axis from threshold to the state seal. The gold edge is
    // structural hierarchy, not loose decor; everything else stays off it.
    const run = Math.max(8, dep - 4.0), mid = 2.0 + run / 2;
    A.obox(A.at(mid, 0), 0.18, 5.2, 0.05, run, P.rug, { pad: 0.4 });
    for (const s of [-1, 1]) A.obox(A.at(mid, s * 2.52), 0.215, 0.08, 0.025, run, P.gold, { pad: 0.3 });

    // A state hall this wide needs architecture, not more loose furniture.
    // Four paired piers and their ceiling ties turn the carpet into a real
    // processional gallery while preserving a 5 m clear presidential axis.
    const pierLat = Math.min(half - 2.0, 4.45);
    for (const d of [6.5, 13.2, 19.9, 26.6]) {
      if (d > dep - 3.0) continue;
      for (const s of [-1, 1]) {
        const pp = A.at(d, s * pierLat);
        A.obox(pp, 0.15, 0.82, 0.18, 0.82, P.marble, { pad: 0.36 });
        A.obox(pp, 1.55, 0.52, 2.62, 0.52, P.marble, { pad: 0.30 });
        A.obox(pp, 2.86, 0.88, 0.16, 0.88, P.gold, { pad: 0.32 });
      }
      A.obox(A.at(d, 0), h.fh - 0.20, pierLat * 2 + 1.0, 0.16, 0.34, P.marble, { pad: 0.25 });
    }
    // Recessed light panels continue that bay rhythm overhead. They are
    // attached fixtures; no floor lamp is allowed to compete with a doorway.
    for (const d of [9.8, 16.5, 23.2])
      A.obox(A.at(d, 0), h.fh - 0.10, 2.8, 0.055, 0.34, P.lamp, { emissive: P.lamp, ei: 0.62, pad: 0.2 });

    // Waiting belongs by the entrance, square to the axis. These are real
    // benches, so the room offers an action before it offers exposition.
    for (const s of [-1, 1]) {
      const p = A.at(6.0, s * Math.min(half - 1.1, 7.2));
      usable += presidentialUse(presidentialPiece("bench", r, h, p.x, p.z,
        s > 0 ? A.faceIn - Math.PI / 2 : A.faceIn + Math.PI / 2,
        { len: 2.4, tone: "exec" }));
    }

    // Diplomatic reception is one conversational group on the EAST side:
    // sofa → coffee table → two chairs, all facing one another. No duplicates.
    const salonD = Math.min(dep - 7.0, Math.max(13.0, dep * 0.57));
    const salonLat = Math.min(half - 2.2, 8.0);
    const sofa = A.at(salonD, salonLat);
    const coffee = A.at(salonD, salonLat - 1.75);
    A.obox(A.at(salonD + 0.25, salonLat - 1.0), 0.17, 5.0, 0.035, 4.8, P.glow, { pad: 0.25 });
    usable += presidentialUse(presidentialPiece("sofa", r, h, sofa.x, sofa.z, A.faceIn, { len: 2.6, tone: "exec" }));
    presidentialPiece("coffee", r, h, coffee.x, coffee.z, A.faceIn, { len: 1.4, deep: 0.75, tone: "exec" });
    for (const q of [-1, 1]) {
      const cp = A.at(salonD + q * 1.45, salonLat - 1.9);
      const face = Math.atan2(coffee.x - cp.x, coffee.z - cp.z);
      usable += presidentialUse(presidentialPiece("armchair", r, h, cp.x, cp.z, face, { tone: "exec" }));
    }
    // Opposite the salon, a press/waiting bench gives the other half of the
    // hall one legible use without mirroring the entire furniture group.
    const press = A.at(salonD + 1.2, -Math.min(half - 1.4, 8.5));
    usable += presidentialUse(presidentialPiece("bench", r, h, press.x, press.z,
      A.faceIn + Math.PI / 2, { len: 3.0, tone: "exec" }));

    // The far wall terminates the walk with one large state seal and two framed
    // portraits. They are attached architectural signals, never floor clutter.
    A.fitbox(A.at(dep - 0.28, 0), 1.65, 4.2, 2.25, 0.10, P.gold);
    A.fitbox(A.at(dep - 0.38, 0), 1.65, 3.6, 1.72, 0.05, P.glow, { emissive: P.glow, ei: 0.35 });
    A.fitbox(A.at(dep - 0.44, 0), 1.68, 1.75, 0.15, 0.025, P.gold);
    A.fitbox(A.at(dep - 0.44, 0), 1.47, 0.22, 0.78, 0.025, P.gold);
    for (const s of [-1, 1])
      A.fitbox(A.at(dep - 0.44, s * 0.72), 1.86, 0.62, 0.14, 0.025, P.gold);
    for (const s of [-1, 1]) {
      A.fitbox(A.at(dep - 0.26, s * 5.2), 1.65, 1.45, 1.85, 0.08, P.gold);
      A.fitbox(A.at(dep - 0.37, s * 5.2), 1.65, 1.16, 1.52, 0.04, P.marble);
    }
    presidentialRoom("statehall", "State Entrance Hall", h, r, usable, 3, A, {
      diplomaticSalon: coffee,
      stateSeal: A.at(dep - 0.25, 0),
    });
    return { anchors: [] };
  }

  function progStateResidence(r, h, opts) {
    shell(h, r);
    const A = approach(r, h, opts);
    const dep = A.depth, half = A.span / 2 - 0.8;
    let diningUsable = 0, salonUsable = 0, suiteUsable = 0;
    // Three actual rooms in sequence: state dining, family salon, private
    // suite. Alternating wide portals preserve a clear route while ensuring a
    // bed never reads as another prop in the dining hall.
    const publicDoor = A.lat(-5.2, 2.2), privateDoor = A.lat(5.2, 2.2);
    const publicWall = dep * 0.38, privateWall = dep * 0.70;
    if (dep > 22) {
      A.divider(publicWall, publicDoor, 2.6, h.fh - 0.1);
      A.divider(privateWall, privateDoor, 2.2, h.fh - 0.1);
      presidentialPortal(A, publicWall, publicDoor, 2.6);
      presidentialPortal(A, privateWall, privateDoor, 2.2);
    } else if (dep > 10) A.divider(dep * 0.57, A.gapLat, 2.0, h.fh - 0.1);

    // A narrow gallery runner connects those staggered portals and makes the
    // upper floor's circulation intentional rather than leftover carpet.
    const galleryRun = Math.max(5, dep - 4.4);
    A.obox(A.at(2.2 + galleryRun / 2, 0), 0.17, 2.6, 0.035, galleryRun, P.rug, { pad: 0.3 });
    for (const d of [6.2, dep * 0.54, dep - 4.2])
      A.obox(A.at(d, 0), h.fh - 0.10, 2.2, 0.05, 0.30, P.lamp, { emissive: P.lamp, ei: 0.55, pad: 0.2 });

    // A state dining room near the stairs, sized by the plate and ringed with
    // seats from the shared furniture kit.
    const dining = A.at(Math.min(6.2, dep * 0.24), Math.min(half - 2.2, 7.0));
    A.obox(dining, 0.17, 7.4, 0.035, 4.6, P.rug, { pad: 0.32 });
    diningUsable += presidentialUse(presidentialPiece("table", r, h, dining.x, dining.z,
      A.faceIn + Math.PI / 2, { len: Math.min(5.4, A.span * 0.34), deep: 1.25, seats: 8, tone: "warm" }));
    // A fitted serving credenza and state triptych make this a dining room,
    // not merely a large table near a partition.
    const servingD = Math.max(2.4, publicWall - 0.75), servingLat = Math.min(half - 2.0, 7.2);
    A.obox(A.at(servingD, servingLat), 0.48, 4.0, 0.66, 0.62, P.wood, { pad: 0.3 });
    A.obox(A.at(servingD - 0.06, servingLat), 0.84, 4.15, 0.08, 0.72, P.marble, { pad: 0.28 });
    for (const s of [-1, 0, 1]) {
      A.fitbox(A.at(publicWall - 0.17, servingLat + s * 1.38), 1.78, 1.10, 1.28, 0.045, P.gold);
      A.fitbox(A.at(publicWall - 0.23, servingLat + s * 1.38), 1.78, 0.84, 1.00, 0.025,
        s === 0 ? P.glow : P.marble, s === 0 ? { emissive: P.glow, ei: 0.30 } : null);
    }
    // The private salon is the opposite half, not furniture sprinkled between
    // the dining chairs.
    const lounge = A.at(Math.min(dep - 7.8, dep * 0.52), -Math.min(half - 2.0, 6.8));
    A.obox(A.at(Math.min(dep - 7.0, dep * 0.55), -Math.min(half - 2.0, 6.8)), 0.17, 6.2, 0.035, 5.4, P.glow, { pad: 0.3 });
    salonUsable += presidentialUse(presidentialPiece("sofa", r, h, lounge.x, lounge.z, A.faceIn, { len: 2.8, tone: "warm" }));
    const low = A.at(Math.min(dep - 6.4, dep * 0.52 + 1.5), -Math.min(half - 2.0, 6.8));
    presidentialPiece("coffee", r, h, low.x, low.z, A.faceIn, { len: 1.5, deep: 0.8, tone: "warm" });
    for (const s of [-1, 1]) {
      const cp = A.at(Math.min(dep - 6.2, dep * 0.52 + 1.5), -Math.min(half - 3.0, 6.8) + s * 1.6);
      salonUsable += presidentialUse(presidentialPiece("armchair", r, h, cp.x, cp.z,
        Math.atan2(low.x - cp.x, low.z - cp.z), { tone: "warm" }));
    }
    // Paired built-in portraits sit on the private threshold, giving the salon
    // a terminating wall instead of another blank white span.
    for (const s of [-1, 1]) {
      const portraitLat = privateDoor - s * 3.15;
      A.fitbox(A.at(privateWall - 0.16, portraitLat), 1.72, 1.42, 1.62, 0.05, P.gold);
      A.fitbox(A.at(privateWall - 0.22, portraitLat), 1.72, 1.12, 1.30, 0.025, P.marble);
    }
    // The far room is unequivocally residential: one bed with a real lie
    // anchor and two bedside lamps, not the boss-suite aquarium/crate roll.
    const bed = A.at(dep - 3.2, 0);
    A.obox(A.at(dep - 3.5, 0), 0.17, 5.4, 0.035, 6.0, P.rug, { pad: 0.3 });
    suiteUsable += presidentialUse(presidentialPiece("bed", r, h, bed.x, bed.z, A.faceIn, { len: 2.15, wide: 1.65, tone: "warm" }));
    for (const s of [-1, 1]) {
      const lp = A.at(dep - 3.0, s * 1.55);
      presidentialPiece("lamp", r, h, lp.x, lp.z, 0, { h: 1.25, ei: 0.55 });
      // Fitted wardrobes bookend the headboard and give the suite useful
      // storage without adding loose prop scatter.
      A.fitbox(A.at(dep - 0.48, s * 4.30), 1.32, 1.70, 2.34, 0.62, P.wood);
      A.fitbox(A.at(dep - 0.55, s * 4.30), 1.30, 0.06, 1.86, 0.68, P.gold);
    }
    A.fitbox(A.at(dep - 0.34, 0), 1.62, 4.1, 1.82, 0.10, P.wood);
    A.fitbox(A.at(dep - 0.43, 0), 1.62, 3.35, 1.28, 0.045, P.gold);
    const foot = A.at(dep - 6.0, 0);
    suiteUsable += presidentialUse(presidentialPiece("bench", r, h, foot.x, foot.z, A.faceOut,
      { len: 2.2, tone: "warm" }));

    // The ledger mirrors the architecture: dining room, family salon and
    // private suite are three named spaces separated by real partitions.
    const lat0 = -A.span / 2, lat1 = A.span / 2;
    presidentialRoom("statedining", "State Dining Room", h,
      presidentialZoneRect(A, r, 0, publicWall, lat0, lat1), diningUsable, 3, A, {
      stateDiningTable: dining,
      publicPortal: A.at(publicWall, publicDoor),
    });
    presidentialRoom("familysalon", "Family Salon", h,
      presidentialZoneRect(A, r, publicWall, privateWall, lat0, lat1), salonUsable, 2, A, {
      familySalon: low,
      privatePortal: A.at(privateWall, privateDoor),
    });
    presidentialRoom("privatesuite", "Private Presidential Suite", h,
      presidentialZoneRect(A, r, privateWall, dep, lat0, lat1), suiteUsable, 1, A, {
      presidentialBed: bed,
    });
    return { anchors: [], beds: [] };
  }

  function progCabinetRoom(r, h, opts) {
    shell(h, r);
    const A = approach(r, h, opts);
    const dep = A.depth, half = A.span / 2 - 0.7;
    let usable = 0;
    const divider = Math.min(7.0, Math.max(4.8, dep * 0.27));
    if (dep > 11) A.divider(divider, 0, 2.2, h.fh - 0.1);

    // The public-to-secure gradient is built into the room: a runner reaches
    // a framed clearance portal, then the material shifts to command carpet.
    const entryRun = Math.max(2.0, divider - 1.4);
    A.obox(A.at(0.7 + entryRun / 2, 0), 0.17, 2.8, 0.035, entryRun, P.rug, { pad: 0.3 });
    for (const s of [-1, 1]) {
      A.obox(A.at(divider, s * 1.28), 1.43, 0.30, 2.70, 0.34, P.marble, { pad: 0.25 });
      A.obox(A.at(divider - 0.02, s * 1.28), 1.43, 0.07, 2.36, 0.39, P.gold, { pad: 0.20 });
    }
    A.obox(A.at(divider, 0), 2.76, 2.85, 0.16, 0.38, P.marble, { pad: 0.25 });
    A.obox(A.at(divider - 0.10, 0), 2.50, 1.75, 0.34, 0.06, P.glow, { emissive: P.glow, ei: 0.45, pad: 0.2 });
    // The reception wall carries two fitted information panels instead of
    // remaining a blank partition around a decorated doorway.
    for (const s of [-1, 1]) {
      const panelLat = s * Math.min(half - 1.8, 4.8);
      A.obox(A.at(divider - 0.10, panelLat), 1.72, 2.65, 1.42, 0.055, P.gold, { pad: 0.24 });
      A.obox(A.at(divider - 0.16, panelLat), 1.72, 2.34, 1.12, 0.03,
        s < 0 ? P.glow : P.marble, s < 0 ? { emissive: P.glow, ei: 0.32, pad: 0.22 } : { pad: 0.22 });
    }

    // A compact staff reception before the secure portal.
    const reception = A.at(Math.max(2.7, divider - 2.2), -Math.min(half - 1.4, 3.8));
    usable += presidentialUse(presidentialPiece("desk", r, h, reception.x, reception.z, A.faceIn, { len: 1.6, tone: "exec" }));
    const wait = A.at(Math.max(2.2, divider - 2.7), Math.min(half - 1.4, 3.8));
    usable += presidentialUse(presidentialPiece("bench", r, h, wait.x, wait.z, A.faceIn, { len: 2.0, tone: "exec" }));

    // One duty officer works the secure side of the portal. This is a real
    // terminal and seat, but deliberately not a copied desk farm.
    const duty = A.at(Math.min(dep - 4.2, divider + 3.0), -Math.min(half - 1.6, 4.6));
    usable += presidentialUse(presidentialPiece("desk", r, h, duty.x, duty.z, A.faceIn, { len: 1.75, tone: "exec" }));

    // Beyond it: ONE cabinet table, aligned down the length of the wing. The
    // table builder owns all ten chairs and their sit anchors.
    const tableD = divider + Math.max(4.5, (dep - divider) * 0.48);
    const table = A.at(Math.min(dep - 3.5, tableD), 0);
    A.obox(table, 0.17, Math.min(9.0, A.span - 2.0), 0.04, Math.min(8.0, dep - divider - 1.5), P.glow, { pad: 0.28 });
    usable += presidentialUse(presidentialPiece("table", r, h, table.x, table.z,
      A.faceIn + Math.PI / 2, { len: Math.min(7.0, dep - divider - 2.4), deep: 1.45, seats: 10, tone: "exec" }));
    // Continuous acoustic wainscot and brass datum bind the secure half into
    // one briefing chamber. These are fitted wall surfaces, not more props.
    const chamberRun = Math.max(5.0, dep - divider - 1.2);
    for (const s of [-1, 1]) {
      const wallLat = s * (half - 0.22);
      A.fitbox(A.at(divider + 0.6 + chamberRun / 2, wallLat), 0.72, 0.07, 1.10, chamberRun, P.steel);
      A.fitbox(A.at(divider + 0.6 + chamberRun / 2, wallLat), 1.26, 0.08, 0.055, chamberRun, P.gold);
    }
    A.fitbox(A.at(dep - 0.25, 0), 1.62, Math.min(7.8, A.span - 2.4), 1.45, 0.08, P.bezel);
    for (const s of [-1, 0, 1])
      A.fitbox(A.at(dep - 0.36, s * 2.25), 1.62, 1.8, 1.12, 0.035, P.glow, { emissive: P.glow, ei: 0.52 });
    for (const d of [3.3, divider + 4.0, dep - 4.0])
      A.obox(A.at(d, 0), h.fh - 0.10, 2.4, 0.05, 0.30, P.light, { emissive: P.light, ei: 0.48, pad: 0.2 });

    // A physical intelligence folio on the table is the room's verb. The
    // geometry owner publishes position+intent; presidency.js performs the
    // real Bureau order through its existing button seam.
    const folio = A.at(Math.min(dep - 4.0, tableD + 1.0), 0);
    A.obox(folio, 0.82, 0.72, 0.06, 0.48, P.gold, { pad: 0.25 });
    presidentialProp("cabinet-bureau", "Authorize Bureau raid", "bureau", h, r, folio);
    presidentialRoom("cabinetroom", "Cabinet and Briefing Room", h, r, usable + 1, 1, A, {
      reception: reception,
      clearancePortal: A.at(divider, 0),
      dutyStation: duty,
      cabinetTable: table,
      briefingWall: A.at(dep - 0.25, 0),
      bureauFolio: folio,
    });
    return { anchors: [] };
  }

  function progOvalOffice(r, h, opts) {
    shell(h, r);
    const A = approach(r, h, opts);
    const dep = A.depth, half = A.span / 2 - 0.7;
    let usable = 0;

    // A wide, framed antechamber makes this an office you ARRIVE in. The
    // opening stays broad enough for the stair route and puts every command
    // object beyond one deliberate threshold.
    const portalD = Math.min(7.0, Math.max(5.8, dep * 0.22));
    if (dep > 14) A.divider(portalD, 0, 4.2, h.fh - 0.1);
    for (const s of [-1, 1]) {
      A.obox(A.at(portalD, s * 2.28), 1.42, 0.34, 2.68, 0.36, P.marble, { pad: 0.24 });
      A.obox(A.at(portalD - 0.02, s * 2.28), 1.42, 0.07, 2.34, 0.40, P.gold, { pad: 0.2 });
    }
    A.obox(A.at(portalD, 0), 2.75, 4.9, 0.16, 0.40, P.marble, { pad: 0.22 });

    // A warm rug establishes the office destination and leaves a clean walk
    // from the stair portal all the way to the desk.
    const rugStart = portalD + 0.8, rugD = Math.max(4.8, dep - rugStart - 2.2);
    A.obox(A.at(rugStart + rugD / 2, 0), 0.17, Math.min(A.span - 3.2, 9.2), 0.04, rugD, P.rug, { pad: 0.4 });
    for (const s of [-1, 1]) A.obox(A.at(rugStart + rugD / 2, s * Math.min(4.42, half - 0.5)), 0.205, 0.07, 0.02, rugD, P.gold, { pad: 0.25 });

    // The presidential desk is square to the long approach with its throne
    // facing the door. No generic boss-suite dice and no duplicate guest seats.
    const deskD = dep - 5.0;
    const desk = A.at(deskD, 0);
    A.obox(A.at(deskD + 0.15, 0), 0.17, 5.7, 0.035, 4.2, P.glow, { pad: 0.32 });
    usable += presidentialUse(presidentialPiece("bossDesk", r, h, desk.x, desk.z, A.faceIn,
      { len: 3.15, deep: 1.2, tone: "exec" }));

    // One coherent conversation group on the side, all aimed at one low table.
    const loungeD = Math.max(portalD + 4.5, dep * 0.48), loungeLat = Math.min(half - 1.5, 4.6);
    const sofa = A.at(loungeD, loungeLat);
    const low = A.at(loungeD + 1.5, loungeLat - 1.55);
    A.obox(A.at(loungeD + 1.25, loungeLat - 1.0), 0.17, 5.2, 0.035, 4.8, P.marble, { pad: 0.28 });
    usable += presidentialUse(presidentialPiece("sofa", r, h, sofa.x, sofa.z, A.faceIn, { len: 2.7, tone: "exec" }));
    presidentialPiece("coffee", r, h, low.x, low.z, A.faceIn, { len: 1.35, deep: 0.72, tone: "exec" });
    for (const s of [-1, 1]) {
      const cp = A.at(loungeD + 1.5 + s * 1.35, loungeLat - 1.75);
      usable += presidentialUse(presidentialPiece("armchair", r, h, cp.x, cp.z,
        Math.atan2(low.x - cp.x, low.z - cp.z), { tone: "exec" }));
    }
    for (const s of [-1, 1]) {
      const flagLat = s * Math.min(half - 1.0, 4.25);
      // These are wall-mounted standards: cloth spans sideways and is only
      // centimetres deep. The old argument order projected each flag almost a
      // metre into the room, where it read as a freestanding red slab.
      A.fitbox(A.at(dep - 0.34, flagLat), 1.38, 0.07, 2.58, 0.07, P.gold);
      A.fitbox(A.at(dep - 0.40, flagLat - s * 0.34), 2.04, 0.90, 1.05, 0.045,
        s < 0 ? 0x2f4f86 : 0x8f3434);
    }
    // Seal behind the chair: framed, inset, and centred on the desk axis.
    A.fitbox(A.at(dep - 0.25, 0), 1.68, 3.4, 2.25, 0.10, P.gold);
    A.fitbox(A.at(dep - 0.39, 0), 1.68, 2.85, 1.72, 0.035, P.glow, { emissive: P.glow, ei: 0.42 });
    // A small relief reads as an emblem at room distance; the prior blank blue
    // inset was technically a symbol but visually just another screen.
    A.fitbox(A.at(dep - 0.45, 0), 1.70, 1.72, 0.15, 0.022, P.gold);
    A.fitbox(A.at(dep - 0.45, 0), 1.47, 0.22, 0.78, 0.022, P.gold);
    for (const s of [-1, 1])
      A.fitbox(A.at(dep - 0.45, s * 0.70), 1.88, 0.60, 0.14, 0.022, P.gold);
    // Monumental desk wall: paired stone pilasters and a brass entablature
    // frame the flags/seal as one architectural composition.
    for (const s of [-1, 1]) {
      A.fitbox(A.at(dep - 0.30, s * 5.25), 1.45, 0.48, 2.62, 0.42, P.marble);
      A.fitbox(A.at(dep - 0.38, s * 5.25), 1.45, 0.08, 2.34, 0.46, P.gold);
    }
    A.fitbox(A.at(dep - 0.30, 0), 2.78, 11.1, 0.18, 0.42, P.marble);
    A.fitbox(A.at(dep - 0.38, 0), 2.70, 10.5, 0.06, 0.46, P.gold);

    // Warm fitted wainscot makes the office perimeter feel occupied even when
    // all staff are elsewhere. It stops at the arrival portal and desk wall.
    const officeRun = Math.max(5.0, dep - portalD - 1.2);
    for (const s of [-1, 1]) {
      const wallLat = s * (half - 0.22);
      A.fitbox(A.at(portalD + 0.6 + officeRun / 2, wallLat), 0.72, 0.07, 1.10, officeRun, P.wood);
      A.fitbox(A.at(portalD + 0.6 + officeRun / 2, wallLat), 1.26, 0.08, 0.055, officeRun, P.gold);
    }

    // Low fitted credenzas occupy the otherwise dead side wall and read as
    // document storage, while paired portraits terminate the visitor salon.
    const credLat = -Math.min(half - 0.55, 8.0);
    for (const d of [portalD + 4.0, portalD + 7.0]) {
      A.obox(A.at(d, credLat), 0.18, 1.95, 0.58, 0.52, P.wood, { pad: 0.30 });
      A.obox(A.at(d, credLat), 0.78, 2.05, 0.06, 0.58, P.marble, { pad: 0.28 });
      A.obox(A.at(d, credLat - 0.03), 1.72, 1.35, 1.38, 0.055, P.gold, { pad: 0.24 });
      A.obox(A.at(d, credLat - 0.06), 1.72, 1.08, 1.10, 0.03, P.glow, { emissive: P.glow, ei: 0.28, pad: 0.22 });
    }
    for (const d of [portalD + 4.0, deskD - 1.8, dep - 2.2])
      A.obox(A.at(d, 0), h.fh - 0.10, 2.3, 0.05, 0.30, P.lamp, { emissive: P.lamp, ei: 0.58, pad: 0.2 });

    // Two small, visually distinct desk objects turn the office into a second
    // command surface. Their actions call the SAME presidency orders as the
    // Situation Room; this room never invents parallel political state.
    const phone = A.at(deskD, -0.82), folder = A.at(deskD, 0.82);
    A.obox(phone, 0.84, 0.48, 0.14, 0.28, P.bezel, { pad: 0.2 });
    A.obox(A.at(deskD - 0.03, -0.82), 0.96, 0.38, 0.08, 0.10, P.gold, { pad: 0.2 });
    A.obox(folder, 0.82, 0.62, 0.05, 0.42, P.gold, { pad: 0.2 });
    presidentialProp("oval-address", "Address the nation", "address", h, r, phone);
    presidentialProp("oval-pardon", "Sign a pardon", "pardon", h, r, folder);
    presidentialRoom("ovaloffice", "The President's Office", h, r, usable + 2, 3, A, {
      arrivalPortal: A.at(portalD, 0),
      presidentialDesk: desk,
      visitorSofa: sofa,
      visitorTable: low,
      stateSeal: A.at(dep - 0.25, 0),
      securePhone: phone,
      pardonFolder: folder,
    });
    return { anchors: [] };
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

  // ---- dispatch -----------------------------------------------------------
  const PROGRAMS = {
    empty: progEmpty, deskfarm: progDeskFarm, meeting: progMeeting, storage: progStorage, lobby: progLobby,
    checkpoint: progCheckpoint, quarters: progQuarters, bosssuite: progBossSuite,
    residential: progResidential, breakroom: progBreakroom,
    statehall: progStateHall, stateresidence: progStateResidence,
    cabinetroom: progCabinetRoom, ovaloffice: progOvalOffice,
  };
  const PROG_TALLY = Object.create(null);
  CBZ.interiorProgram = function (name, room, ctx) {
    armReset();                        // see armReset: propuse.js parses AFTER this file
    const h = host(ctx);
    const fn = PROGRAMS[name];
    if (!h || !fn || !room) return null;
    if (!(room.x1 - room.x0 > 2) || !(room.z1 - room.z0 > 2)) return null;   // degenerate plate
    const r = CBZ.interiorClampRect(h.b,
      { x0: room.x0, x1: room.x1, z0: room.z0, z1: room.z1 });
    r.y = room.y || 0;
    if (!(r.x1 - r.x0 > 2) || !(r.z1 - r.z0 > 2)) return null;
    // THE SHELL IS THE LAW — every box this program draws (its own, roombuild's
    // planner pieces, furniture.js's kit) goes through the host's lbox, so one
    // wrap here covers all three and no program has to know the rule exists.
    const out = CBZ.interiorBounded(h.b, function () {
      return fn(r, h, (ctx && ctx.opts) || null);
    }, "program:" + name);
    if (out) PROG_TALLY[name] = (PROG_TALLY[name] | 0) + 1;
    return out;
  };
  CBZ.interiorProgramNames = ["empty", "deskfarm", "meeting", "storage", "lobby", "checkpoint",
    "quarters", "bosssuite", "residential", "breakroom", "statehall", "stateresidence",
    "cabinetroom", "ovaloffice"];
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
