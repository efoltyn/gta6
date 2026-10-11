/* ============================================================
   battle/core/host.js — THE HOST INTERFACE. Everything the battle core asks
   of the WORLD it is fought in, and nothing else.

   The battle core (units, roster, sides, series, tactics, combat, the scale
   tiers) must run in two places: NPC War's own arenas (games/battle.html),
   and later Gang City itself, where a president declares war and watches
   his tanks, men and planes take another city. So the core never reads a
   page global for the ground or the walls; it asks the HOST.

   THE CONTRACT (a host is a plain object with these members)
     id                     string: "dunes", "water", "city:veridia-front" ...
     cx, cz, gap            the field's centre and the start gap between sides
     water                  true when bodies swim (bodyY is not the ground)
     terrainTrue/terrainLos the ground is analytic terrain / it blocks sight
     groundAt(x, z)         the surface height (land, or the swell)
     bodyY(unit, x, z)      where THIS body sits (a shark: surface - depth)
     camFloor(x, z)         the lowest a lens may go
     spawnAt(side, i, r)    a free start spot for body i of a side ("red"|"blue")
     resolveCircle(pos, r, y, h)            push a body out of the walls
     segmentBlocked(ax,ay,az, bx,by,bz)      the geometry between two points
     queryColliders(x, z, r, out)           colliders near a point (cover)
     colliderContains(c, x, z, pad)
     scene                  the THREE.Scene the units are added to
   OPTIONAL (a host that has them hands them over; a caller feature-detects)
     coverNear(x, z, r, out, opts)   cover points near a spot: { x, z, y, nx, nz,
                                     h, low, kind, rec } -- the cover is on the
                                     -n side; opts { threat:{x,z}, minH, maxH, kinds }
                                     keeps only points that hide you from it
     coverFrom(x, z, tx, tz, r, opts) the one point a man would run to
                            (NPC War: arenas/cover.js, CBZ.battleCover)

   PUBLIC  CBZ.battleHost = { fromArena(map, micro, scene), fromCity(o),
                              validate(host) -> [missing names], KEYS }
   NPC War sets the page's HOST = CBZ.battleHost.fromArena(MAP, CBZ.micro,
   CBZ.scene) when the field is raised (begin.js). fromCity is the seam for
   the Gang City host: written against the city's physics names, not wired.
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const FNS = ["groundAt", "bodyY", "camFloor", "spawnAt", "resolveCircle", "segmentBlocked", "queryColliders", "colliderContains"];
  const KEYS = ["id", "cx", "cz", "gap", "water", "scene"].concat(FNS);

  function validate(h) {
    const miss = [];
    if (!h) return KEYS.slice();
    for (let i = 0; i < FNS.length; i++) if (typeof h[FNS[i]] !== "function") miss.push(FNS[i]);
    if (!isFinite(h.cx) || !isFinite(h.cz)) miss.push("cx/cz");
    return miss;
  }
  // NPC War: the MAP record buildMap() returns + microboot's collision world.
  // The functions are the SAME function objects (no wrapper on a hot path).
  function fromArena(map, micro, scene) {
    const h = Object.assign({}, map);
    h.resolveCircle = micro.resolveCircle;
    h.segmentBlocked = micro.segmentBlocked;
    h.queryColliders = micro.queryColliders;
    h.colliderContains = micro.colliderContains;
    h.scene = scene || CBZ.scene;
    h.map = map;
    return h;
  }
  /* GANG CITY (the president's war): the real world's names (physics.js /
     microboot publish them on CBZ). o = { id, cx, cz, gap, spawnAt, scene }:
     the war decides where the field is and where each side forms up; the
     city answers for the ground and the walls. UNWIRED in wave A. */
  function fromCity(o) {
    o = o || {};
    const floor = CBZ.floorAt || CBZ.groundAt || function () { return 0; };
    const h = {
      id: o.id || "city", cx: o.cx || 0, cz: o.cz || 0, gap: o.gap || 150,
      water: false, terrainTrue: false, terrainLos: false,
      groundAt: function (x, z) { return floor(x, z); },
      bodyY: function (m, x, z) { return floor(x, z); },
      camFloor: function (x, z) { return floor(x, z) + 1.6; },
      spawnAt: o.spawnAt || function (side, i) {
        const s = side === "red" ? -1 : 1;
        return { x: h.cx + s * (h.gap / 2 + 8 + ((i / 10) | 0) * 3.1), z: h.cz + ((i % 10) - 4.5) * 3.4 };
      },
      resolveCircle: CBZ.resolveCircle || function () {},
      segmentBlocked: CBZ.segmentBlocked || function () { return false; },
      queryColliders: CBZ.queryCollidersNear || function () { return []; },
      colliderContains: CBZ.colliderContains || function () { return false; },
      scene: o.scene || CBZ.scene,
    };
    // the city's cover is the same registry when a page has loaded it
    if (CBZ.battleCover) { h.coverNear = CBZ.battleCover.near; h.coverFrom = CBZ.battleCover.from; }
    return h;
  }
  CBZ.battleHost = { fromArena: fromArena, fromCity: fromCity, validate: validate, KEYS: KEYS };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.battleHost;
})();
