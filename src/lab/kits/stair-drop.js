/* lab kit "stair-drop": jump over the stair well's railing and FALL.

   OWNER (President mode): "if I jump over the railing near the stairs, I'm
   standing on air instead of dropping down a floor."

   The player (entities/player.js on systems/physics.js) stands on the upper
   floor behind the balustrade guarding an open stair well, runs at it and
   presses Space (the game's own jump: a clear jump, or the traversal vault
   when it fires). Below the guard is a storey of air and a flight going down.
   Two real stairs, on a real shell (cityMakeBuilding):
     stair=grand  the Executive Mansion's grand stair (city/govcomplex.js
                  CBZ.cityGrandStair): two marble flights up the west wall, a
                  solid balustrade on the open side, the first-floor well
                  guarded across its front edge (default)
     stair=core   the city's one service stair core (city/elevators.js
                  CBZ.cityStairCore): switchback lanes, the guard across lane
                  A's well on the top floor

   lab.html?kit=stair-drop&stair=grand&how=jump
     how     jump (default) | walk (walk into the guard: it must hold you)
     x       grand only: metres from the opening's west edge to run along
             (default 3.5: just past the flights' open-side balustrade, where
             the jump comes down beside the stair's handrail; 1.6 = over the
             lower flight's centre line)
     storeys default 3 (grand) / 2 (core)

   probe(): the player's y every 0.1 s (^ = airborne), how far past the guard
   it ended and the real walk surface under its feet (CBZ.groundAt: the
   floors and the flights). ok (jump) = it ended past the guard, below the
   upper floor, standing ON that surface (not on a rail's collider in the air
   beside the stair, which is what the owner saw).
   ok (walk) = it stayed on the upper floor behind the guard. */
(function () {
"use strict";

function setupGrand(W, P) {
  const B = W.add("building", { name: "building", lot: { x0: 10, x1: 46, z0: 40, z1: 70 }, storeys: +P.storeys || 3, doorSide: 1 });
  const b = B.b;
  if (!CBZ.cityGrandStair) throw new Error("CBZ.cityGrandStair missing (city/govcomplex.js)");
  const G = CBZ.cityGrandStair({ b: b }, null);
  if (!G) throw new Error("grandStair refused this shell");
  const O = G.opening, yTop = G.top.y;
  // the guard runs across the opening's front (+z) edge, 12 cm past it
  const zGuard = O.maxZ + 0.12;
  const x = O.minX + (P.x != null ? +P.x : 3.5);
  const start = { x: x, z: zGuard + 1.6 }, over = { x: x, z: zGuard - 3.0 };
  place(W, P, start, over, yTop, G.bottom.y, function (px, pz) { return zGuard - pz; });
}

function setupCore(W, P) {
  const B = W.add("building", { name: "building", lot: { x0: 20, x1: 44, z0: 40, z1: 64 }, storeys: +P.storeys || 2, doorSide: 0 });
  const b = B.b;
  const core = CBZ.cityStairCore({ building: b }, { roof: false });
  if (!core) throw new Error("cityStairCore built no core on this shell");
  const S = b.stairPlan;
  // the core's frame: dep from the door wall toward the far wall, lat across;
  // lane A climbs from dA0 (its foot) toward the half landing
  const CORE_LD = 1.3, SEAM = 0.02;
  const aC = (S.L0 + S.latMid - S.side * SEAM / 2) / 2, dA0 = S.D0 + CORE_LD;
  const k = core.floors;
  const at = function (dep, lat) { const p = S.pt(dep, lat); return { x: b.ox + p.x, z: b.oz + p.z }; };
  const past = function (x, z) { const lx = x - b.ox - S.base.x, lz = z - b.oz - S.base.z; return lx * S.nx + lz * S.nz - dA0; };
  place(W, P, at(S.D0 + 0.35, aC), at(dA0 + 2.2, aC), core.stops[k], core.stops[k - 1], past);
}

function place(W, P, start, over, yTop, yBottom, past) {
  const pl = W.add("player", { name: "player", at: [start.x, start.z] });
  pl.actor.pos.y = yTop;
  pl.actor.grounded = true;
  W.marks = { yTop: yTop, yBottom: yBottom, over: over, start: start, track: [], past: past };
  let next = 0;
  W.every(function () {
    const t = W.t();
    if (t + 1e-6 < next) return;
    next = t + 0.1;
    W.marks.track.push([Math.round(t * 100) / 100, Math.round(pl.actor.pos.y * 1000) / 1000, !!pl.actor.grounded]);
  });
}

CBZ.lab.kit("stair-drop", {
  about: "the player jumps over a stair well's guard rail on the upper floor; probe reports y over time (must fall, not hang in the air)",
  uses: ["building", "player"],
  files: function (P) {
    return (P.stair || "grand") === "grand"
      ? ["src/systems/stairs.js", "src/city/govcomplex.js"]
      : ["src/systems/stairs.js", "src/city/elevators.js"];
  },
  mode: "city",
  params: { how: "jump", stair: "grand" },
  duration: 4,
  setup: function (W, P) {
    if ((P.stair || "grand") === "grand") setupGrand(W, P); else setupCore(W, P);
  },
  frame: function (W) { return [W.get("building").root]; },
  script: function (W, P) {
    const pl = W.get("player"), M = W.marks;
    const jump = (P.how || "jump") === "jump";
    const keys = function () { return CBZ.keys || (CBZ.keys = {}); };
    return [
      [0.1, function () { pl.walkTo(M.over.x, M.over.z, { sprint: P.run !== "0", stop: 0.05 }); }, "player: run at the guard"],
      [0.42, function () { if (jump) keys()[" "] = true; }, jump ? "player: Space (jump the rail)" : "player: keeps walking into it"],
      [0.6, function () { keys()[" "] = false; }, "release Space"],
      [1.4, function () { pl.stop(); }, "player: let go of the stick"],
    ];
  },
  probe: function (W, P) {
    const M = W.marks, pl = W.get("player");
    const p = pl.actor.pos;
    const into = M.past(p.x, p.z);
    const pastGuard = into > 0.1;
    // the real walk surface: the floors and the flights (platforms), never a
    // collider's top
    const under = CBZ.groundAt(p.x, p.z, p.y);
    const onReal = Math.abs(p.y - under) < 0.05;
    const end = Math.round(p.y * 1000) / 1000;
    const jump = (P.how || "jump") === "jump";
    const fell = end < M.yTop - 0.5;
    const ok = jump ? (pastGuard && fell && onReal && !!pl.actor.grounded) : (!pastGuard && Math.abs(end - M.yTop) < 0.05);
    const trace = M.track.map(function (r) { return r[0].toFixed(1) + ":" + r[1].toFixed(2) + (r[2] ? "" : "^"); }).join(" ");
    return {
      ok: ok,
      summary: (P.stair || "grand") + " stair, " + (jump ? "jumped the guard" : "walked into the guard") + ": upper floor " + M.yTop.toFixed(2) +
        ", ended at y " + end.toFixed(2) + (pastGuard ? " " + into.toFixed(2) + " m past the guard" : " behind the guard") +
        (jump ? (!fell ? ", HANGING IN THE AIR (did not drop)" : onReal ? ", FELL to the stair/floor" : ", STANDING ON AIR " + (p.y - under).toFixed(2) + " m over the stair") : "") +
        "; walk surface under the feet " + under.toFixed(2) + "  y(t): " + trace,
      data: { yTop: M.yTop, yBottom: M.yBottom, end: end, pastGuard: pastGuard, intoWell: Math.round(into * 100) / 100,
        grounded: !!pl.actor.grounded, groundUnder: under, onReal: onReal, track: M.track },
    };
  },
});
})();
