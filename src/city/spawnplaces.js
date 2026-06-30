/* ============================================================
   city/spawnplaces.js — PLACE-ANCHORED SPAWNING (SPAWN-2)

   OWNER COMPLAINT / WHY
   ---------------------
   A living city's people come OUT of where life happens — a resident off
   their apartment stoop, a shopper standing at a store counter, a body IN
   the velvet-rope line, a commuter through an office lobby door. The old
   spawner teleported every fresh civilian onto a random sidewalk point, so
   the world read like bodies materialising on pavement, not people leaving
   places. This module hands peds.js a PLACE to spawn AT instead.

   HOW IT PLUGS IN (zero new systems)
   ----------------------------------
   peds.js' spawnOneCivilian() ALREADY calls CBZ.cityPlaceSpawnPoint(A, rng)
   first-and-always (so the seeded rng / MP host snapshot never drift) and,
   when we hand back a place AND the CITY_PLACE_SPAWN flag is on, spawns AT
   {x,z} with our pre-baked opts and SKIPS the random-district cast (the place
   already decided who they are). We return null ~half the time BY DESIGN so
   the street keeps its through-traffic — the sidewalks never empty.

   The opts we bake are exactly the tags peds.js + SCHED-1 read:
     • _emerge   — apartment door: walk a few metres off the stoop first.
     • _queueAt  — club line: hold this lane slot (someone IN the queue).
     • _role     — 'commuter' (office lobby), 'shopper' (counter).
     • _claimDesk— office: officejobs.js may seat them at a free desk.
     • place.lot — the home/shop LOT (peds.js stamps it as _home/_digs).

   COST DISCIPLINE
   ---------------
   The anchor list is pure DATA, built ONCE per arena and cached (a weighted
   flat array of {x,z,kind,opts,lot}); re-derived only when the arena identity
   changes (a fresh city). Per call we do a weighted pick + a bounded offscreen
   retry — no allocation in the hot path beyond the returned literal. No THREE,
   no rigs — headless-safe (every field guarded; varied lot shapes tolerated).

   FLAG: CBZ.CONFIG.CITY_PLACE_SPAWN (self-defaulted true; peds.js gates on
   `!== false` so flipping it false reverts to pure random-pavement spawning).
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const C = (CBZ.CONFIG = CBZ.CONFIG || {});
  // self-default the flag at the TOP of our own module (we never touch config.js)
  if (C.CITY_PLACE_SPAWN == null) C.CITY_PLACE_SPAWN = true;

  // never morph / spawn / pop a body IN VIEW — the owner hates pop-in. Reuse
  // the millionaires.js OFFSCREEN2 budget (80²): a place anchor must be at
  // least this far from the camera or we skip it this call (fall to street).
  const OFFSCREEN2 = 80 * 80;
  // probability a given spawn stays random STREET ambient (preserve through-
  // traffic). The other ~half emerges from a place when one is offscreen.
  const STREET_CHANCE = 0.5;

  function camD2(x, z) {
    const c = CBZ.camera; if (!c || !c.position) return 1e9;
    const dx = x - c.position.x, dz = z - c.position.z;
    return dx * dx + dz * dz;
  }

  // ---- the cache: a weighted flat array of anchors, keyed to one arena -----
  // We weight by REPEATING an anchor in the array (cheap, no float math at pick
  // time): homes are the bulk of a city's bodies, so they dominate the list;
  // counters/queues/lobbies are the spice. A single index pick is O(1).
  let _cacheArena = null;     // identity guard (the arena object we built for)
  let _anchors = null;        // the weighted flat array

  // optional reset hooks (mirror cityOfficeDesksReset-style): a fresh city
  // re-derives anyway via the identity guard, but expose a manual flush too.
  CBZ.citySpawnPlacesReset = function () { _cacheArena = null; _anchors = null; };

  function arena() { return CBZ.city && CBZ.city.arena; }

  // build (lazily) the anchor list from the LIVE arena. Pure data; every field
  // is feature-detected because lot/building shapes vary across districts.
  function buildAnchors(A) {
    const out = [];
    if (!A) { _anchors = out; _cacheArena = A; return out; }

    // (1) APARTMENT DOORS — stand JUST OUTSIDE the stoop. door.nx/nz is the
    //     INWARD normal (points into the building, per buildings.js), so we
    //     step OUT along -n. Tag _emerge so SCHED-1 walks them off the door.
    //     Homes are the population bulk → weight 3.
    const homeLots = A.homeLots || [];
    for (let i = 0; i < homeLots.length; i++) {
      const lot = homeLots[i];
      const b = lot && lot.building;
      const door = b && b.door;
      if (!door || door.x == null || door.z == null) continue;
      const nx = door.nx != null ? door.nx : 0, nz = door.nz != null ? door.nz : 0;
      const ax = door.x - nx * 2, az = door.z - nz * 2;   // 2m out onto the sidewalk
      const a = { x: ax, z: az, kind: "home", lot: lot, opts: { _emerge: true } };
      out.push(a, a, a);   // weight 3
    }

    // (2) STORE COUNTERS + CLUB QUEUES — a body AT the counter (clerk-adjacent
    //     customer) or standing IN the velvet-rope line. shopLots carry a
    //     vendorSpot (world coords) and, for the one bar, building.club.queue.
    const shopLots = A.shopLots || [];
    for (let i = 0; i < shopLots.length; i++) {
      const lot = shopLots[i];
      const b = lot && lot.building;
      if (!b) continue;

      // a customer standing at the counter, a short step back from the clerk
      const vs = b.vendorSpot;
      if (vs && vs.x != null && vs.z != null) {
        // back off ~1.2m from the exact clerk spot so we don't stack on them;
        // face is clerk-ward (vs.face), the shopper opts pin a "shopper" life.
        const fx = vs.face != null ? -Math.sin(vs.face) : 0;
        const fz = vs.face != null ? -Math.cos(vs.face) : 0;
        out.push({
          x: vs.x + fx * 1.2, z: vs.z + fz * 1.2, kind: "counter", lot: lot,
          opts: { _role: "shopper" },
        });
      }

      // a body IN the club line — pick a random middle slot of the queue lane
      const club = b.club;
      if (club && club.queue && club.queue.length) {
        const q = club.queue;
        // a couple of representative slots (not the whole line — club.js fills
        // the rest); we add the 2nd & a middle slot so a body reads "waiting".
        const slots = [q[1] || q[0], q[(q.length / 2) | 0]];
        for (let s = 0; s < slots.length; s++) {
          const sl = slots[s];
          if (sl && sl.x != null && sl.z != null) {
            out.push({ x: sl.x, z: sl.z, kind: "queue", lot: lot, opts: { _queueAt: { x: sl.x, z: sl.z }, _clubLine: true } });
          }
        }
      }

      // (3) OFFICE LOBBIES — a commuter arriving through the tower door. Some
      //     shopLots ARE office towers (building.office). Anchor at the door,
      //     stepped OUT, tag commuter + a desk claim for officejobs.js.
      if (b.office && b.door && b.door.x != null) {
        const d = b.door;
        const nx = d.nx != null ? d.nx : 0, nz = d.nz != null ? d.nz : 0;
        out.push({
          x: d.x - nx * 2, z: d.z - nz * 2, kind: "office", lot: lot,
          opts: { _role: "commuter", _claimDesk: true },
        });
      }
    }

    // (3b) stand-alone OFFICE TOWERS that aren't shopLots (buildings.js pushes
    //      office towers with building.office but no shop). Some arenas expose
    //      them on placed/buildingLots — guard for either, skip if absent.
    const officeLots = A.officeLots || null;
    if (officeLots && officeLots.length) {
      for (let i = 0; i < officeLots.length; i++) {
        const lot = officeLots[i];
        const b = lot && lot.building, d = b && b.door;
        if (!d || d.x == null) continue;
        const nx = d.nx != null ? d.nx : 0, nz = d.nz != null ? d.nz : 0;
        out.push({
          x: d.x - nx * 2, z: d.z - nz * 2, kind: "office", lot: lot,
          opts: { _role: "commuter", _claimDesk: true },
        });
      }
    }

    _anchors = out;
    _cacheArena = A;
    return out;
  }

  function anchorsFor(A) {
    if (_cacheArena !== A || !_anchors) return buildAnchors(A);
    return _anchors;
  }

  // ============================================================
  //  THE EXPORT — peds.js calls this FIRST and ALWAYS (determinism), then only
  //  USES the result when CITY_PLACE_SPAWN !== false. Returns null (street
  //  ambient) ~half the time; else a jittered, OFFSCREEN place anchor.
  // ============================================================
  CBZ.cityPlaceSpawnPoint = function (A, rng) {
    if (!A) A = arena();
    if (!A) return null;
    const rnd = (typeof rng === "function") ? rng : Math.random;

    // ~half the spawns stay street ambient (preserve through-traffic). We pull
    // the rng EVEN when flag-off won't use us isn't our concern — peds.js calls
    // us unconditionally and we always consume one draw here for a stable order.
    if (rnd() < STREET_CHANCE) return null;

    const list = anchorsFor(A);
    if (!list || !list.length) return null;

    // weighted pick + bounded OFFSCREEN retry: try a few random anchors; take
    // the first that's out of view. If the player is parked right on top of all
    // sampled places, fall back to street (null) rather than pop a body in view.
    for (let t = 0; t < 6; t++) {
      const a = list[(rnd() * list.length) | 0];
      if (!a) continue;
      if (camD2(a.x, a.z) <= OFFSCREEN2) continue;     // would pop in view → skip
      // ~1m jitter so multiple emergers from one door don't stack perfectly.
      const jx = (rnd() - 0.5) * 2, jz = (rnd() - 0.5) * 2;
      // clamp the jittered point off any collider if the arena offers it.
      const p = { x: a.x + jx, z: a.z + jz };
      if (A.clampToCity) { try { A.clampToCity(p, 0.4); } catch (e) {} }
      // return the shape peds.js consumes (it reads x/z/opts and lot/role/etc).
      return {
        x: p.x, z: p.z, kind: a.kind, lot: a.lot || null,
        role: (a.opts && a.opts._role) || null,
        emerge: !!(a.opts && a.opts._emerge),
        queueAt: (a.opts && a.opts._queueAt) || null,
        opts: a.opts || {},
      };
    }
    return null;   // everything sampled was on-screen → keep it street this time
  };

  // a tiny tick export to satisfy the cross-module contract name
  // (CBZ.citySpawnPlacesTick) — the heavy lifting is the lazy cache above, so
  // the tick only nudges a re-derive if the arena swapped out from under us
  // (defensive; the identity guard in cityPlaceSpawnPoint already handles it).
  CBZ.citySpawnPlacesTick = function () {
    const A = arena();
    if (A && _cacheArena !== A) buildAnchors(A);
  };
})();
