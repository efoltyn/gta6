/* ============================================================
   battle/core/host.js — THE HOST INTERFACE. Everything the battle sim asks
   of the WORLD it is fought in, and nothing else.

   The battle (core + sim: units, squads, fire, vehicles, the tiers) runs in
   two places on the same code: NPC War's own arenas (games/battle.html) and
   Gang City itself (index.html, city/army.js + city/armyrealm.js), where a
   president, an AI nation, a coup or martial law puts real soldiers, tanks
   and aircraft on the real streets. So the sim never reads a page global
   for the ground or the walls; it asks HOST (src/battle/state.js).

   THE CONTRACT (a host is a plain object with these members)
     id                     string: "dunes", "water", "city:war7" ...
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
     colliderContains(c, x, z, pad)         exact, on a turned box too
     rayColliders(ox,oy,oz, dx,dy,dz, maxT, out, opts) -> record | null
                            the first box along a ray (a flown round's path;
                            physics.js / microboot share this contract)
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
   NPC War: HOST = fromArena(MAP, CBZ.micro, CBZ.scene) when the field is
   raised (begin.js). Gang City: HOST = fromCity({...}) when its war engine
   boots (city/armyrealm.js), on the city's own physics (systems/physics.js,
   systems/solidground.js).
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const FNS = ["groundAt", "bodyY", "camFloor", "spawnAt", "resolveCircle", "segmentBlocked", "queryColliders", "colliderContains", "rayColliders"];
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
    h.rayColliders = micro.rayColliders || function () { return null; };
    h.scene = scene || CBZ.scene;
    h.map = map;
    return h;
  }

  /* GANG CITY: the real world's names. systems/solidground.js owns the floor
     (CBZ.floorAt), systems/physics.js the walls (CBZ.collide, the collider
     grid, the ray). Each member reads the city's function when it is CALLED,
     so a module that wraps one later (moving platforms, the mode gate) is
     honoured, and a node tool can build the host before the city exists.
     o = { id, cx, cz, gap, spawnAt, scene, floorAt }: where the field is and
     how each side forms up are the war's decision; the city answers for the
     ground and the walls. */
  const _ray = { hit: false, c: null, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
  const ANY = { any: true };
  function fromCity(o) {
    o = o || {};
    function floor(x, z) {
      const f = o.floorAt || CBZ.floorAt || CBZ.groundAt;
      return f ? f(x, z) : 0;
    }
    const h = {
      id: o.id || "city", cx: o.cx || 0, cz: o.cz || 0, gap: o.gap || 150,
      water: false, terrainTrue: false, terrainLos: false,
      groundAt: floor,
      bodyY: function (m, x, z) { return floor(x, z); },
      camFloor: function (x, z) { return floor(x, z) + 1.6; },
      spawnAt: o.spawnAt || function (side, i) {
        const s = side === "red" ? -1 : 1;
        return { x: h.cx + s * (h.gap / 2 + 8 + ((i / 10) | 0) * 3.1), z: h.cz + ((i % 10) - 4.5) * 3.4 };
      },
      // a body of `height` standing at `y` (height omitted = a 1.8 m person)
      resolveCircle: function (pos, r, y, height) {
        if (!CBZ.collide) return false;
        const y0 = y == null ? undefined : y;
        return CBZ.collide(pos, r, y0, y0 == null ? undefined : y0 + (height != null ? height : 1.8));
      },
      // anything solid on the straight line between two points (sight, fire)
      segmentBlocked: function (ax, ay, az, bx, by, bz) {
        if (!CBZ.rayColliders) return false;
        return !!CBZ.rayColliders(ax, ay, az, bx - ax, by - ay, bz - az, 1, _ray, ANY);
      },
      queryColliders: function (x, z, r, out) {
        out = out || [];
        if (!CBZ.queryCollidersNear) { out.length = 0; return out; }
        return CBZ.queryCollidersNear(x, z, r, out);
      },
      // exact on a turned box (physics.js orientedCollider: cx cz hw hd yaw)
      colliderContains: function (c, x, z, pad) {
        const p = pad || 0;
        if (c.yaw && c.hw != null) {
          const co = Math.cos(c.yaw), si = Math.sin(c.yaw), rx = x - c.cx, rz = z - c.cz;
          const lx = rx * co - rz * si, lz = rx * si + rz * co;
          return lx >= -c.hw - p && lx <= c.hw + p && lz >= -c.hd - p && lz <= c.hd + p;
        }
        return x >= c.minX - p && x <= c.maxX + p && z >= c.minZ - p && z <= c.maxZ + p;
      },
      rayColliders: function (ox, oy, oz, dx, dy, dz, maxT, out, opts) {
        return CBZ.rayColliders ? CBZ.rayColliders(ox, oy, oz, dx, dy, dz, maxT, out, opts || undefined) : null;
      },
      scene: o.scene || CBZ.scene,
    };
    // the city's cover is the same registry when a page has loaded it
    if (CBZ.battleCover) { h.coverNear = CBZ.battleCover.near; h.coverFrom = CBZ.battleCover.from; }
    return h;
  }
  CBZ.battleHost = { fromArena: fromArena, fromCity: fromCity, validate: validate, KEYS: KEYS };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.battleHost;
})();
