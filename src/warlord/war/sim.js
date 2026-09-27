/* ============================================================
   warlord/war/sim.js — THE WAR, as things standing on a map.

   The owner's core loop, verbatim: "Not have production. Just have cities.
   You go up to a city with your army. There's rogue armies walking around,
   but there should also be armies protecting the city that come out to
   defend it. You take that army, they surrender, you get the city."

   So CITIES ARE THE ATOM and every number is something on the map:

     PEOPLE     live in the towns (real populations from the map file) and on
                the countryside each town feeds (its CATCHMENT: the land
                nearer to it, by marching cost, than to any other town).
     GARRISON   every town keeps real men, raised from its own catchment's
                people, up to a share of them. When a hostile army comes
                near, the garrison MARCHES OUT to meet it in the field, and
                leaves a WATCH on the walls.
     TAKING IT  beat the garrison in the field and it SURRENDERS: the men lay
                down their arms and go home (they are the town's own sons, so
                they become its people again, and the town now raises its
                garrison for YOU). Walk in past the watch and the town is
                yours. Why home and not into your column: an army that grows
                by absorbing every garrison it beats snowballs in a week and
                nothing on the map can stop it; a town that becomes yours and
                refills under your flag is the same reward, paid at the speed
                of the people who actually live there.
     STRENGTH   the men in your armies plus the garrisons of the towns you
                hold. An army standing in its own town can RAISE men out of
                the garrison. Nothing else makes soldiers.
     LAND       is painted from the towns: a tile belongs to whoever holds the
                town that feeds it. Borders are where two owners' catchments
                touch; that is the front.
     ROGUES     warbands with no town: raiders and deserters. Every beaten
                army sheds deserters into them. They roam, hunt what they can
                beat, run from what they cannot, raid small towns, and slowly
                drift home if nothing feeds them.
     SUPPLY     an army on its own or allied land, or within a few tiles of it
                (foraging range), is supplied. Past that it bleeds men and
                order every day and fights at 60%.

   Deterministic from (map, seed, orders). No Math.random. Node-runnable.
   Contract: src/warlord/war/CONTRACT.md section 3.
============================================================ */
(function () {
  "use strict";
  const G0 = typeof window !== "undefined" ? window : globalThis;
  const CBZ = (G0.CBZ = G0.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  const WAR = (W.war = W.war || {});
  const SIM = (WAR.sim = WAR.sim || {});

  const K = {
    GARRISON_SHARE: 0.025,    // a town can keep this share of its catchment's people under arms
    GARRISON_GROW: 0.00012,   // men per person per day while the town is held and quiet
    WATCH_SHARE: 0.2,         // what stays on the walls when the garrison marches out
    SALLY_KM: 32,             // how close a hostile army may come before the garrison marches
    LOSS_K: 0.06,             // share of enemy effective strength killed per day of battle
    RETREAT_ORG: 0.25,
    RETREAT_RATIO: 0.3,
    ORG_REGEN: 0.06,
    CUT_ORG: 0.035, CUT_MEN: 0.006,
    CUT_MUL: 0.6,
    FORAGE_KM: 55,            // an army can live off the land this far beyond its own
    DESERT_SHARE: 0.12,       // beaten armies shed this share as deserters -> rogues
    ROGUE_DRIFT: 0.004,       // rogue bands lose this share a day to men walking home
    MIN_ARMY: 25,
    CATCH_KM: 170,            // land farther than this (march cost) from every town is wilderness
    AI_EVERY: 3,
    MARCH_KM: 20,             // km a day on plains
    MAX_TILES_DAY: 3,
  };
  SIM.K = K;
  /* A MAP MAY RETUNE THE KNOBS (data.knobs). The Mediterranean is antiquity at
     11 km a tile; the island is a warband war at 75 m a tile, where a town of
     four thousand puts a far bigger share under arms and a column crosses the
     island in days, not seasons. Reset to the defaults on every create. */
  const K0 = Object.assign({}, K);
  function applyKnobs(M) { Object.assign(K, K0, (M.data && M.data.knobs) || {}); }

  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const DX4 = [1, -1, 0, 0], DY4 = [0, 0, 1, -1];
  const DX8 = [1, -1, 0, 0, 1, 1, -1, -1], DY8 = [0, 0, 1, -1, 1, -1, 1, -1];

  /* ================================================================ CREATE */
  SIM.create = function (M, opts) {
    opts = opts || {};
    const N = M.w * M.h;
    const nf = M.factions.length;
    applyKnobs(M);
    const ROGUE = nf + 1;
    const G = {
      M: M, day: 0, seed: (opts.seed | 0) || 1, player: opts.player | 0, ROGUE: ROGUE,
      owner: new Uint8Array(N),
      factions: [null], armies: [], battles: [], events: [],
      dirty: new Uint8Array(N), dirtyList: [],
      rel: new Uint8Array((ROGUE + 1) * (ROGUE + 1)),   // 0 peace, 1 war, 2 ally
      warSince: new Int32Array((ROGUE + 1) * (ROGUE + 1)),
      peaceDay: new Int32Array((ROGUE + 1) * (ROGUE + 1)).fill(-100000),
      townsTaken: new Int32Array((ROGUE + 1) * (ROGUE + 1)),
      townOwner: new Uint8Array(M.towns.length),
      townPop: new Float64Array(M.towns.length),
      townCatch: new Float64Array(M.towns.length),      // rural people the town feeds on
      garrison: new Float64Array(M.towns.length),       // men on the walls right now
      sallied: new Int32Array(M.towns.length),          // id of the army that marched out, or 0
      catchOf: null, catchTiles: null,
      over: null, nextId: 1, landTiles: 0,
      speed: Math.max(0.5, Math.min(K.MAX_TILES_DAY || 3, K.MARCH_KM / Math.max(0.01, M.tileKm || 10))),
      sallyR: Math.max(2, Math.round(K.SALLY_KM / Math.max(0.01, M.tileKm || 10))),
      _rand: rng(opts.seed || 1),
      _at: new Map(), _battleById: new Map(),
    };
    // sally radius on tiny-tile maps (the island) cannot be 400 tiles
    if (G.sallyR > 12) G.sallyR = 12;
    for (let f = 1; f <= nf; f++) {
      const d = M.factions[f - 1];
      G.factions.push({ i: f, id: d.id, name: d.name, adj: d.adj || d.name, colour: d.colour, css: d.css,
        alive: true, isPlayer: f === G.player, capital: d.capital, ai: d.ai || {},
        towns: 0, tiles: 0, people: 0, soldiers: 0, garrisons: 0, armies: 0 });
    }
    G.factions.push({ i: ROGUE, id: "rogues", name: "Warbands", adj: "Rogue", colour: 0x8c8374, css: "#8c8374",
      alive: true, isPlayer: false, isRogue: true, capital: -1, ai: {}, towns: 0, tiles: 0, people: 0, soldiers: 0, garrisons: 0, armies: 0 });
    for (let f = 1; f <= nf; f++) setRel(G, f, ROGUE, 1);

    buildCatchment(G);
    buildComponents(G);
    for (let t = 0; t < M.towns.length; t++) {
      const T = M.towns[t];
      G.townOwner[t] = T.owner | 0;
      G.townPop[t] = T.pop;
      const cap = garrisonCap(G, t);
      G.garrison[t] = T.garrison != null ? T.garrison : cap * 0.85;
      paintTown(G, t);
    }
    for (let i = 0; i < N; i++) if (G.catchOf[i] >= 0) G.landTiles++;
    for (const p of M.wars || []) setRel(G, p[0], p[1], 1);
    for (const p of M.alliances || []) setRel(G, p[0], p[1], 2);
    for (const a of M.startArmies || []) spawnArmy(G, a.owner, a.tile, a.men, a.name);
    const rog = M.rogues || ((M.data && M.data.rogues) || []).map(function (r) {
      const p = M.toTile(r.at[0], r.at[1]);
      return { tile: nearestLandTile(M, Math.max(0, Math.min(M.w - 1, p[0] | 0)) + Math.max(0, Math.min(M.h - 1, p[1] | 0)) * M.w), men: r.men, name: r.name };
    });
    for (const r of rog) if (r.tile >= 0) spawnArmy(G, ROGUE, r.tile, r.men, r.name);
    G.date = function () { return dateOf(G); };
    G.relation = function (a, b) { return relName(G, a, b); };
    G.dirtyList.length = 0; G.dirty.fill(0);
    rebuildIndex(G);
    recount(G);
    return G;
  };

  /* ---------------------------------------------------------------- catchment
     Multi-source Dijkstra from every town by marching cost. Each land tile
     belongs to the town it is cheapest to walk to; past CATCH_KM it is
     nobody's. Computed ONCE: towns do not move, only their owners change. */
  function buildCatchment(G) {
    const M = G.M, w = M.w, h = M.h, N = w * h;
    const C = new Int32Array(N).fill(-1);
    const D = new Float32Array(N).fill(1e30);
    const maxCost = K.CATCH_KM / Math.max(0.01, M.tileKm || 10);
    const heap = new Heap(N * 2 + 16);
    for (let t = 0; t < M.towns.length; t++) {
      const i = M.towns[t].tile;
      // a big town reaches further: weight the start by size
      const bonus = -Math.min(4, Math.log10(Math.max(1, M.towns[t].pop)) - 2.5) * 0.6;
      if (bonus + 0 < D[i]) { D[i] = Math.min(0, bonus); C[i] = t; heap.push(i, D[i]); }
    }
    while (heap.n) {
      const i = heap.pop();
      const di = heap.lastF;
      if (di > D[i]) continue;
      const x = i % w, y = (i / w) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX8[k], ny = y + DY8[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = nx + ny * w;
        if (!M.land[j]) continue;
        let c = moveCost(G, j) * (k >= 4 ? 1.414 : 1);
        const nd = di + c;
        if (nd > maxCost || nd >= D[j]) continue;
        D[j] = nd; C[j] = C[i]; heap.push(j, nd);
      }
    }
    /* NO HOLES IN A REALM. The high Apennines are more than CATCH_KM of
       marching from any town, and the first screenshot had grey islands of
       nobody's land in the middle of Italy. Mountains inside a realm belong
       to it: unclaimed land within a few tiles of claimed land takes the
       nearest claim (plain distance). Deep desert stays wilderness. */
    {
      const FILL = Math.max(3, Math.round(70 / Math.max(0.01, M.tileKm || 10)));
      const Q = new Int32Array(N), dist = new Int16Array(N).fill(-1);
      let qh = 0, qt = 0;
      for (let i = 0; i < N; i++) if (C[i] >= 0) { Q[qt++] = i; dist[i] = 0; }
      while (qh < qt) {
        const i = Q[qh++], x = i % w, y = (i / w) | 0;
        if (dist[i] >= FILL) continue;
        for (let k = 0; k < 4; k++) {
          const nx = x + DX4[k], ny = y + DY4[k];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = nx + ny * w;
          if (!M.land[j] || dist[j] >= 0) continue;
          dist[j] = dist[i] + 1; C[j] = C[i]; Q[qt++] = j;
        }
      }
    }
    G.catchOf = C;
    const lists = [];
    for (let t = 0; t < M.towns.length; t++) lists.push([]);
    for (let i = 0; i < N; i++) if (C[i] >= 0) { lists[C[i]].push(i); G.townCatch[C[i]] += M.rural[i]; }
    // tiles of a town's catchment, sorted by distance from it, so the view
    // can spread the new colour outward from the gate
    for (let t = 0; t < lists.length; t++) {
      const tx = M.towns[t].x, ty = M.towns[t].y;
      lists[t].sort(function (a, b) {
        const ax = a % w - tx, ay = ((a / w) | 0) - ty, bx = b % w - tx, by = ((b / w) | 0) - ty;
        return ax * ax + ay * ay - (bx * bx + by * by);
      });
      lists[t] = Int32Array.from(lists[t]);
    }
    G.catchTiles = lists;
  }
  /* LAND MASSES. A march from Italy to Africa with no ship is not a long
     search that fails, it is a question with a known answer: different
     land masses. Asked once, here, it saves the pathfinder from exhausting
     half the map every time an AI eyes a town over the water. */
  function buildComponents(G) {
    const M = G.M, w = M.w, h = M.h, N = w * h;
    const comp = new Int32Array(N).fill(-1), Q = new Int32Array(N);
    let id = 0;
    for (let s0 = 0; s0 < N; s0++) {
      if (!M.land[s0] || comp[s0] >= 0) continue;
      let qh = 0, qt = 0; Q[qt++] = s0; comp[s0] = id;
      while (qh < qt) {
        const i = Q[qh++], x = i % w, y = (i / w) | 0;
        for (let k = 0; k < 8; k++) {
          const nx = x + DX8[k], ny = y + DY8[k];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = nx + ny * w;
          if (!M.land[j] || comp[j] >= 0) continue;
          comp[j] = id; Q[qt++] = j;
        }
      }
      id++;
    }
    G.comp = comp;
  }
  function garrisonCap(G, t) { return (G.townCatch[t] + G.townPop[t]) * K.GARRISON_SHARE; }
  SIM.garrisonCap = garrisonCap;
  function paintTown(G, t) {
    const f = G.townOwner[t], L = G.catchTiles[t];
    for (let k = 0; k < L.length; k++) {
      const i = L[k];
      if (G.owner[i] === f) continue;
      G.owner[i] = f;
      if (!G.dirty[i]) { G.dirty[i] = 1; G.dirtyList.push(i); }
    }
  }
  SIM.takeDirty = function (G) {
    const out = G.dirtyList.slice();
    for (let i = 0; i < G.dirtyList.length; i++) G.dirty[G.dirtyList[i]] = 0;
    G.dirtyList.length = 0;
    return out;
  };

  /* ---------------------------------------------------------------- binary heap */
  function Heap(cap) { this.id = new Int32Array(cap); this.f = new Float32Array(cap); this.n = 0; this.lastF = 0; }
  Heap.prototype.push = function (i, f) {
    if (this.n >= this.id.length) {
      const id2 = new Int32Array(this.id.length * 2), f2 = new Float32Array(this.id.length * 2);
      id2.set(this.id); f2.set(this.f); this.id = id2; this.f = f2;
    }
    let k = this.n++;
    const I = this.id, F = this.f;
    I[k] = i; F[k] = f;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (F[p] <= F[k]) break;
      const ti = I[p]; I[p] = I[k]; I[k] = ti;
      const tf = F[p]; F[p] = F[k]; F[k] = tf;
      k = p;
    }
  };
  Heap.prototype.pop = function () {
    const I = this.id, F = this.f;
    const top = I[0];
    this.lastF = F[0];
    const n = --this.n;
    if (n > 0) {
      I[0] = I[n]; F[0] = F[n];
      let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1;
        let m = k;
        if (l < n && F[l] < F[m]) m = l;
        if (r < n && F[r] < F[m]) m = r;
        if (m === k) break;
        const ti = I[m]; I[m] = I[k]; I[k] = ti;
        const tf = F[m]; F[m] = F[k]; F[k] = tf;
        k = m;
      }
    }
    return top;
  };

  /* ---------------------------------------------------------------- relations */
  function ri(G, a, b) { return a * (G.ROGUE + 1) + b; }
  function setRel(G, a, b, v) {
    if (!a || !b || a === b) return;
    G.rel[ri(G, a, b)] = v; G.rel[ri(G, b, a)] = v;
    if (v === 1) { G.warSince[ri(G, a, b)] = G.day; G.warSince[ri(G, b, a)] = G.day; G.townsTaken[ri(G, a, b)] = 0; G.townsTaken[ri(G, b, a)] = 0; }
  }
  function rel(G, a, b) { if (a === b) return 2; if (!a || !b) return 1; return G.rel[ri(G, a, b)]; }
  function relName(G, a, b) { if (a === b) return "self"; const r = rel(G, a, b); return r === 1 ? "war" : r === 2 ? "ally" : "peace"; }
  function hostile(G, a, b) { return a !== b && rel(G, a, b) === 1; }
  function friendly(G, a, b) { return a === b || (a && b && rel(G, a, b) === 2); }
  SIM.hostile = function (G, a, b) { return hostile(G, a, b); };
  SIM.relation = function (G, a, b) { return relName(G, a, b); };

  function dateOf(G) {
    const s = (G.M.data && G.M.data.startDate) || { year: 1, month: 1, day: 1, era: null };
    let y = s.year, m = (s.month || 1) - 1, d = (s.day || 1) - 1 + G.day;
    const bc = s.era === "BC";
    for (;;) {
      const ml = MONTH_DAYS[m];
      if (d < ml) break;
      d -= ml; m++;
      if (m >= 12) { m = 0; y += bc ? -1 : 1; if (bc && y === 0) y = 1; }
    }
    return { year: y, month: m + 1, day: d + 1, era: s.era || null };
  }

  /* ---------------------------------------------------------------- armies */
  function spawnArmy(G, owner, tile, men, name) {
    const M = G.M;
    const a = { id: G.nextId++, owner: owner, name: name || null, tile: tile, prev: tile,
      x: tile % M.w + 0.5, y: ((tile / M.w) | 0) + 0.5, men: Math.round(men), org: 1,
      supplied: true, entrench: 0, order: { kind: "idle" }, path: null, pi: 0, mp: 0,
      battle: 0, naval: false, home: -1, rogue: owner === G.ROGUE, lastWin: 0 };
    G.armies.push(a);
    indexArmy(G, a);
    return a;
  }
  function armyById(G, id) { for (let i = 0; i < G.armies.length; i++) if (G.armies[i].id === id) return G.armies[i]; return null; }
  SIM.army = armyById;
  function rebuildIndex(G) { G._at.clear(); for (const a of G.armies) indexArmy(G, a); }
  function indexArmy(G, a) { let l = G._at.get(a.tile); if (!l) { l = []; G._at.set(a.tile, l); } if (l.indexOf(a) < 0) l.push(a); }
  function unindexArmy(G, a) {
    const l = G._at.get(a.tile); if (!l) return;
    const k = l.indexOf(a); if (k >= 0) l.splice(k, 1);
    if (!l.length) G._at.delete(a.tile);
  }
  function placeArmy(G, a, t) {
    unindexArmy(G, a);
    a.tile = t; a.x = t % G.M.w + 0.5; a.y = ((t / G.M.w) | 0) + 0.5;
    a.naval = !G.M.land[t];
    indexArmy(G, a);
  }
  function removeArmy(G, a) {
    unindexArmy(G, a);
    const k = G.armies.indexOf(a);
    if (k >= 0) G.armies.splice(k, 1);
    a.dead = true;
    if (a.home >= 0 && G.sallied[a.home] === a.id) G.sallied[a.home] = 0;
  }
  function hostileArmyAt(G, tile, f) {
    const l = G._at.get(tile); if (!l) return null;
    for (const a of l) if (hostile(G, f, a.owner)) return a;
    return null;
  }
  SIM.armiesAt = function (G, tile) { return G._at.get(tile) || []; };

  /* ---------------------------------------------------------------- terrain */
  function moveCost(G, t) {
    const M = G.M, T = M.TERRAIN[M.terrain[t]];
    return (T ? T.move : 1) + (M.river[t] ? 0.6 : 0);
  }
  function defenceAt(G, t) {
    const M = G.M, T = M.TERRAIN[M.terrain[t]];
    let d = T ? T.defence : 1;
    if (M.townAt[t]) d *= 1.5;               // walls
    return d;
  }

  /* ---------------------------------------------------------------- pathing
     A* over tiles. No walking into the land of somebody you are at peace
     with. Sea only for an army that starts on a port its side holds. */
  let _g = null, _from = null, _stamp = null, _gen = 1, _heap = null;
  function findPath(G, f, start, goal, opts) {
    const M = G.M, w = M.w, h = M.h, N = w * h;
    if (start === goal) return [start];
    if (!M.land[goal]) return null;
    if (!_g || _g.length < N) { _g = new Float32Array(N); _from = new Int32Array(N); _stamp = new Uint32Array(N); _heap = new Heap(4096); }
    const gen = ++_gen;
    const ti0 = M.townAt[start] - 1;
    const canSail = (!opts || opts.sea !== false) && ti0 >= 0 && M.towns[ti0].port && friendly(G, f, G.townOwner[ti0]);
    if (!canSail && G.comp && M.land[start] && G.comp[start] !== G.comp[goal]) return null;
    // a route that failed lately fails again: do not pay for the same no twice
    const nk = f * 1e7 + start * 7 + goal;
    const nr = G._noRoute || (G._noRoute = new Map());
    const failed = nr.get(nk);
    if (failed != null && G.day - failed < 12) return null;
    const gx = goal % w, gy = (goal / w) | 0, hmin = canSail ? 0.5 : 1;
    const hc = function (i) { const dx = Math.abs(i % w - gx), dy = Math.abs(((i / w) | 0) - gy); return hmin * (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)); };
    const H = _heap; H.n = 0;
    _g[start] = 0; _stamp[start] = gen; _from[start] = -1;
    H.push(start, hc(start));
    const limit = (opts && opts.limit) || 16000;   // a real road here costs a few hundred expansions; a no costs the whole limit
    let exp = 0;
    while (H.n) {
      const i = H.pop();
      if (i === goal) break;
      if (++exp > limit) { nr.set(nk, G.day); return null; }
      const gi = _g[i], x = i % w, y = (i / w) | 0, iSea = !M.land[i];
      for (let k = 0; k < 8; k++) {
        const nx = x + DX8[k], ny = y + DY8[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = nx + ny * w;
        let c;
        if (!M.land[j]) {
          if (M.terrain[j] !== 0 || !canSail) continue;
          if (!iSea && i !== start) continue;
          c = iSea ? 0.5 : 2.5;
        } else {
          const o = G.owner[j];
          if (o && o !== f && rel(G, f, o) === 0 && j !== goal) continue;
          c = moveCost(G, j) + (iSea ? 2.5 : 0);
          if (k >= 4 && !iSea) {
            if (!M.land[x + DX8[k] + y * w] || !M.land[x + (y + DY8[k]) * w]) continue;
          }
        }
        if (k >= 4) c *= 1.414;
        const ng = gi + c;
        if (_stamp[j] === gen && _g[j] <= ng) continue;
        _stamp[j] = gen; _g[j] = ng; _from[j] = i;
        H.push(j, ng + hc(j));
      }
    }
    if (_stamp[goal] !== gen) { if (nr.size > 20000) nr.clear(); nr.set(nk, G.day); return null; }
    const out = [];
    for (let i = goal; i !== -1; i = _from[i]) out.push(i);
    return out.reverse();
  }
  SIM.path = function (G, id, tile) { const a = armyById(G, id); return a ? findPath(G, a.owner, a.tile, tile) : null; };
  SIM.findPath = function (G, f, a, b, o) { return findPath(G, f, a, b, o); };

  /* ---------------------------------------------------------------- orders
       move   { to: tile }          march there (a town tile = go and take it)
       chase  { target: armyId }    follow an army and fight it
       hold   {}                    stay, dig in
       raise  {}                    take men out of the garrison of the own town you stand in
       idle   {}
     Garrisons marching out use "sally"; rogues use "chase" and "move". */
  SIM.order = function (G, ids, order) {
    if (!Array.isArray(ids)) ids = [ids];
    for (const id of ids) {
      const a = typeof id === "object" ? id : armyById(G, id);
      if (!a || a.dead) continue;
      if (order.kind === "raise") { raise(G, a, order.men); continue; }
      a.order = Object.assign({}, order);
      a.path = null; a.pi = 0;
      if (order.kind !== "hold") a.entrench = 0;
      if (order.kind === "move") {
        const p = findPath(G, a.owner, a.tile, order.to);
        if (!p) { a.order = { kind: "hold" }; continue; }
        a.path = p;
      } else if (order.kind === "chase") {
        const t = armyById(G, order.target);
        if (!t) { a.order = { kind: "hold" }; continue; }
        a.path = findPath(G, a.owner, a.tile, t.tile);
      }
    }
  };
  function raise(G, a, want) {
    const ti = G.M.townAt[a.tile] - 1;
    if (ti < 0 || G.townOwner[ti] !== a.owner || a.battle) return 0;
    const keep = garrisonCap(G, ti) * K.WATCH_SHARE;
    const can = Math.max(0, Math.floor(G.garrison[ti] - keep));
    const n = Math.min(can, want == null ? can : Math.max(0, want | 0));
    if (n <= 0) return 0;
    G.garrison[ti] -= n;
    a.org = (a.org * a.men + 0.8 * n) / (a.men + n);
    a.men += n;
    G.events.push({ type: "raise", army: a.id, town: ti, men: n, owner: a.owner });
    return n;
  }
  SIM.raise = function (G, id, men) { const a = armyById(G, id); return a ? raise(G, a, men) : 0; };
  SIM.raisable = function (G, ti) { return Math.max(0, Math.floor(G.garrison[ti] - garrisonCap(G, ti) * K.WATCH_SHARE)); };
  /* A new army is men taken out of a town's garrison and stood up in the
     field. It is the same people, moved; no one is created here. */
  SIM.levy = function (G, ti, men) {
    const f = G.townOwner[ti];
    if (!f) return null;
    const n = Math.min(SIM.raisable(G, ti), men == null ? 1e12 : men | 0);
    if (n < K.MIN_ARMY * 2) return null;
    G.garrison[ti] -= n;
    const a = spawnArmy(G, f, G.M.towns[ti].tile, n);
    a.org = 0.8; a.order = { kind: "hold" };
    G.events.push({ type: "levy", army: a.id, town: ti, men: n, owner: f });
    return a;
  };
  SIM.split = function (G, id, men) {
    const a = armyById(G, id);
    if (!a || a.battle || men < K.MIN_ARMY || a.men - men < K.MIN_ARMY) return null;
    a.men -= men;
    const b = spawnArmy(G, a.owner, a.tile, men);
    b.org = a.org; b.order = { kind: "hold" };
    return b;
  };
  SIM.merge = function (G, ids) {
    const list = ids.map(function (id) { return typeof id === "object" ? id : armyById(G, id); }).filter(Boolean);
    if (!list.length) return null;
    const host = list[0];
    for (let k = 1; k < list.length; k++) {
      const b = list[k];
      if (b === host || b.owner !== host.owner || b.battle || host.battle) continue;
      if (Math.max(Math.abs(b.x - host.x), Math.abs(b.y - host.y)) > 1.6) continue;
      host.org = (host.org * host.men + b.org * b.men) / (host.men + b.men);
      host.men += b.men;
      removeArmy(G, b);
    }
    return host;
  };

  /* ---------------------------------------------------------------- diplomacy */
  SIM.declareWar = function (G, a, b) {
    if (!a || !b || a === b || rel(G, a, b) === 1 || a === G.ROGUE || b === G.ROGUE) return false;
    setRel(G, a, b, 1);
    G.events.push({ type: "war", a: a, b: b });
    for (let f = 1; f < G.ROGUE; f++) {
      if (f === a || f === b || !G.factions[f].alive) continue;
      if (rel(G, f, b) === 2 && rel(G, f, a) !== 1) { setRel(G, f, a, 1); G.events.push({ type: "war", a: f, b: a }); }
    }
    return true;
  };
  SIM.peaceAcceptable = function (G, a, b) {
    if (rel(G, a, b) !== 1 || a === G.ROGUE || b === G.ROGUE) return false;
    const Fa = G.factions[a], Fb = G.factions[b];
    const lostB = G.townsTaken[ri(G, a, b)], lostA = G.townsTaken[ri(G, b, a)];
    const long = G.day - G.warSince[ri(G, a, b)];
    if (long < 120) return false;
    const sa = Fa.soldiers + Fa.garrisons, sb = Fb.soldiers + Fb.garrisons;
    if (sb < sa * 0.5 && lostB >= lostA) return true;
    if (lostB >= Math.max(2, (Fb.towns + lostB) * 0.3) && lostB > lostA) return true;
    if (long > 540 && Math.abs(lostA - lostB) <= 1) return true;
    return false;
  };
  SIM.makePeace = function (G, a, b) {
    if (rel(G, a, b) !== 1) return false;
    setRel(G, a, b, 0);
    G.events.push({ type: "peace", a: a, b: b });
    G.peaceDay[ri(G, a, b)] = G.day; G.peaceDay[ri(G, b, a)] = G.day;
    for (const bt of G.battles.slice()) {
      if ((bt.attOwner === a && bt.defOwner === b) || (bt.attOwner === b && bt.defOwner === a)) endBattle(G, bt, null);
    }
    return true;
  };
  // days since these two last made peace (a truce the AI honours for a year)
  SIM.sincePeace = function (G, a, b) { return G.day - G.peaceDay[ri(G, a, b)]; };
  SIM.ally = function (G, a, b) { if (rel(G, a, b) === 1) return false; setRel(G, a, b, 2); G.events.push({ type: "ally", a: a, b: b }); return true; };

  /* ---------------------------------------------------------------- fronts (a readout) */
  SIM.frontTiles = function (G, a, b) {
    const M = G.M, w = M.w, h = M.h, own = G.owner, out = [];
    for (let i = 0; i < own.length; i++) {
      if (own[i] !== a) continue;
      const x = i % w, y = (i / w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX4[k], ny = y + DY4[k];
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && own[nx + ny * w] === b) { out.push(i); break; }
      }
    }
    return out;
  };
  SIM.townsOf = function (G, f) { const out = []; for (let t = 0; t < G.townOwner.length; t++) if (G.townOwner[t] === f) out.push(t); return out; };
  function nearestTownOf(G, f, tile) {
    const M = G.M; let best = -1, bd = 1e18;
    const x0 = tile % M.w, y0 = (tile / M.w) | 0;
    for (let t = 0; t < M.towns.length; t++) {
      if (G.townOwner[t] !== f) continue;
      const dx = M.towns[t].x - x0, dy = M.towns[t].y - y0, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  SIM.nearestTownOf = nearestTownOf;

  /* ---------------------------------------------------------------- strength */
  function eff(G, a) { return a.men * (0.35 + 0.65 * a.org) * (a.supplied ? 1 : K.CUT_MUL); }
  SIM.strength = eff;
  /* what a town will put in the field against you, and what stays on the walls */
  SIM.townDefence = function (G, ti) {
    const g = G.garrison[ti];
    const s = G.sallied[ti] ? armyById(G, G.sallied[ti]) : null;
    return { garrison: Math.round(g + (s ? s.men : 0)), watch: Math.round(Math.min(g, garrisonCap(G, ti) * K.WATCH_SHARE)), out: s ? s.id : 0 };
  };

  /* ---------------------------------------------------------------- the garrison marches out
     A hostile army inside the sally radius of a held town: the garrison
     (minus the watch) forms up as a field army and goes for it. A free town
     (no owner) only marches at an army that is coming for IT. When the
     threat is gone the men walk home and rejoin the walls. */
  function sallies(G) {
    const M = G.M, R = G.sallyR;
    for (let t = 0; t < M.towns.length; t++) {
      if (G.sallied[t]) continue;
      const f = G.townOwner[t];
      const T = M.towns[t];
      const keep = garrisonCap(G, t) * K.WATCH_SHARE;
      const out = G.garrison[t] - keep;
      if (out < K.MIN_ARMY * 2) continue;
      let threat = null, td = 1e9;
      for (const a of G.armies) {
        if (a.dead || a.naval || a.home >= 0) continue;
        const d = Math.max(Math.abs(a.x - T.x), Math.abs(a.y - T.y));
        if (d > R || d >= td) continue;
        if (f) { if (!hostile(G, f, a.owner)) continue; }
        else {
          // a free town only answers somebody marching on it or camped at its gate
          const coming = a.order.kind === "move" && a.order.to === T.tile;
          if (!coming && d > 1.5) continue;
        }
        threat = a; td = d;
      }
      if (!threat) continue;
      G.garrison[t] -= out;
      const s = spawnArmy(G, f || G.ROGUE, T.tile, out, (T.name || "Town") + " garrison");
      if (!f) { s.owner = 0; s.free = true; }
      s.home = t; s.org = 0.95;
      s.order = { kind: "sally", target: threat.id };
      G.sallied[t] = s.id;
      G.events.push({ type: "sally", town: t, army: s.id, men: Math.round(out), against: threat.id, owner: f });
    }
  }
  function steerSallies(G) {
    for (const a of G.armies) {
      if (a.home < 0 || a.battle || a.dead) continue;
      const T = G.M.towns[a.home];
      if (a.order.kind === "sally") {
        const tgt = armyById(G, a.order.target);
        const far = !tgt || Math.max(Math.abs(tgt.x - T.x), Math.abs(tgt.y - T.y)) > G.sallyR + 2 || tgt.naval;
        if (far) { a.order = { kind: "home" }; a.path = findPath(G, a.owner, a.tile, T.tile, { sea: false }); a.pi = 0; }
        else if (stale(G, a, tgt)) { a.path = findPath(G, a.owner, a.tile, tgt.tile, { sea: false, limit: 20000 }); a.pi = 0; a.pathDay = G.day; }
      }
      if (a.order.kind === "home" && a.tile === T.tile) {
        // back on the walls
        G.garrison[a.home] += a.men;
        G.sallied[a.home] = 0;
        removeArmy(G, a);
      } else if (a.order.kind === "home" && !a.path) {
        a.path = findPath(G, a.owner, a.tile, T.tile, { sea: false }); a.pi = 0;
        if (!a.path) { G.garrison[a.home] += a.men; G.sallied[a.home] = 0; removeArmy(G, a); }
      }
    }
  }
  // re-plan a pursuit only when the quarry has moved off the end of the
  // road by more than a couple of tiles, and at most every other day
  function stale(G, a, tgt) {
    if (!a.path) return G.day - (a.pathDay || -9) >= 2;
    const e = a.path[a.path.length - 1], w = G.M.w;
    const d = Math.max(Math.abs(e % w - tgt.tile % w), Math.abs(((e / w) | 0) - ((tgt.tile / w) | 0)));
    return d > 2 && G.day - (a.pathDay || -9) >= 2;
  }
  // owner 0 armies are a free town's own men: hostile to anyone who comes for it
  function hostileA(G, a, b) {
    if (a.free || b.free) return a.owner !== b.owner || a.free !== b.free;
    return hostile(G, a.owner, b.owner);
  }

  /* ---------------------------------------------------------------- movement */
  function moveArmies(G) {
    const M = G.M;
    for (let k = 0; k < G.armies.length; k++) {
      const a = G.armies[k];
      a.prev = a.tile;
      if (a.battle || a.dead) continue;
      const kind = a.order.kind;
      if (kind === "hold" || kind === "idle") {
        if (kind === "hold") a.entrench = Math.min(1, a.entrench + 1 / 6);
        const o = G.owner[a.tile];
        if (!a.free && o && o !== a.owner && rel(G, a.owner, o) === 0) {
          const tt = nearestTownOf(G, a.owner, a.tile);
          if (tt >= 0) SIM.order(G, a, { kind: "move", to: M.towns[tt].tile });
        }
        continue;
      }
      if (kind === "chase") {
        const t = armyById(G, a.order.target);
        if (!t || t.dead || (!t.naval && false)) { a.order = { kind: "hold" }; a.path = null; continue; }
        if (stale(G, a, t)) {
          a.path = findPath(G, a.owner, a.tile, t.tile, { limit: 12000 }); a.pi = 0; a.pathDay = G.day;
          // no road to the quarry (the water, a closed border): give the chase up
          if (!a.path) { a.order = { kind: "hold" }; continue; }
        }
      }
      if (!a.path || a.pi >= a.path.length - 1) {
        if (kind === "move") { a.order = { kind: "hold" }; a.path = null; }
        continue;
      }
      a.mp += G.speed;
      let steps = 0;
      while (a.path && a.pi < a.path.length - 1 && steps < 6) {
        const nxt = a.path[a.pi + 1];
        const cost = !M.land[nxt] ? 0.5 : moveCost(G, nxt);
        if (a.mp < cost) break;
        // somebody hostile in the way: that is the battle
        const l = G._at.get(nxt);
        let foe = null;
        if (l) for (const b of l) if (hostileA(G, a, b)) { foe = b; break; }
        if (foe) {
          if (foe.battle) joinBattle(G, G._battleById.get(foe.battle), a);
          else if (!foe.naval && !a.naval) startBattle(G, a, foe, nxt);
          a.mp = 0; break;
        }
        const o = G.owner[nxt];
        if (!a.free && M.land[nxt] && o && o !== a.owner && rel(G, a.owner, o) === 0) { a.path = null; break; }
        a.mp -= cost;
        placeArmy(G, a, nxt);
        a.pi++; a.entrench = 0; steps++;
        // in the gate
        const ti = M.townAt[nxt] - 1;
        if (ti >= 0 && !a.free && !a.rogue && a.home < 0) atTheGate(G, a, ti);
      }
      if (a.mp > 3) a.mp = 3;
    }
  }
  /* An army standing in a town that is not its side's: the watch fights on
     the walls if there is one worth the name, otherwise the town is taken. */
  function canTake(G, f, ti) { const o = G.townOwner[ti]; return o !== f && (!o || hostile(G, f, o)); }
  function atTheGate(G, a, ti) {
    const f = G.townOwner[ti];
    if (!canTake(G, a.owner, ti)) return;
    const watch = G.garrison[ti];
    if (watch >= K.MIN_ARMY) {
      const w = spawnArmy(G, f || 0, G.M.towns[ti].tile, watch, (G.M.towns[ti].name || "Town") + " watch");
      if (!f) w.free = true;
      w.home = ti; w.walls = true; w.entrench = 1; w.order = { kind: "hold" };
      G.garrison[ti] = 0;
      startBattle(G, a, w, w.tile);
      return;
    }
    takeTown(G, ti, a.owner);
  }
  function takeTown(G, ti, f) {
    const from = G.townOwner[ti];
    if (from === f) return;
    G.townOwner[ti] = f;
    G.townPop[ti] *= 0.95;                 // a town that changes hands loses people
    G.garrison[ti] = 0;
    if (from && f) G.townsTaken[ri(G, f, from)]++;
    paintTown(G, ti);
    G.events.push({ type: "town", town: ti, from: from, to: f });
  }
  SIM.takeTown = takeTown;

  /* ---------------------------------------------------------------- contact
     Hostile armies side by side fight when one of them came for the other:
     a garrison that marched out, a chaser, a rogue on the hunt, or a
     marcher whose road runs through. Two holders stare at each other. */
  function contact(G) {
    const M = G.M, w = M.w, h = M.h;
    for (let k = 0; k < G.armies.length; k++) {
      const a = G.armies[k];
      if (a.battle || a.dead || a.naval) continue;
      const kind = a.order.kind;
      if (kind === "hold" || kind === "idle" || kind === "home") continue;
      const x = a.tile % w, y = (a.tile / w) | 0;
      for (let d = -1; d < 8; d++) {
        const nx = d < 0 ? x : x + DX8[d], ny = d < 0 ? y : y + DY8[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const t = nx + ny * w;
        const l = G._at.get(t);
        if (!l) continue;
        let foe = null;
        for (const b of l) if (b !== a && hostileA(G, a, b) && !b.naval) { foe = b; break; }
        if (!foe) continue;
        const aimed = (kind === "sally" || kind === "chase") ? a.order.target === foe.id : true;
        if (!aimed) continue;
        if (foe.battle) joinBattle(G, G._battleById.get(foe.battle), a);
        else startBattle(G, a, foe, foe.tile);
        break;
      }
    }
  }

  /* ---------------------------------------------------------------- battles */
  function startBattle(G, att, def, tile) {
    const M = G.M;
    const b = { id: G.nextId++, tile: tile, x: tile % M.w + 0.5, y: ((tile / M.w) | 0) + 0.5,
      att: [att.id], def: [def.id], attOwner: att.owner, defOwner: def.owner,
      day0: G.day, attMen0: att.men, defMen0: def.men, watched: false,
      river: !!(M.river[tile] || M.river[att.tile]), town: M.townAt[tile] - 1, walls: !!def.walls,
      attLoss: 0, defLoss: 0 };
    att.battle = b.id; def.battle = b.id; att.path = null;
    G.battles.push(b);
    G._battleById.set(b.id, b);
    G.events.push({ type: "battle", phase: "start", id: b.id, tile: tile, att: att.owner, def: def.owner,
                    attArmy: att.id, defArmy: def.id, attMen: b.attMen0, defMen: b.defMen0 });
    return b;
  }
  function joinBattle(G, b, a) {
    if (!b || a.battle) return;
    const A = armyById(G, b.att[0]), D = armyById(G, b.def[0]);
    let side = null;
    if (A && !hostileA(G, a, A) && D && hostileA(G, a, D)) side = "att";
    else if (D && !hostileA(G, a, D) && A && hostileA(G, a, A)) side = "def";
    if (!side) return;
    b[side].push(a.id); a.battle = b.id; a.path = null;
    if (side === "att") b.attMen0 += a.men; else b.defMen0 += a.men;
  }
  function fight(G) {
    for (const b of G.battles.slice()) {
      if (b.watched) continue;
      const att = b.att.map(function (id) { return armyById(G, id); }).filter(Boolean);
      const def = b.def.map(function (id) { return armyById(G, id); }).filter(Boolean);
      if (!att.length || !def.length) { endBattle(G, b, att.length ? "att" : "def"); continue; }
      let A = 0, D = 0, am = 0, dm = 0, ent = 0;
      for (const a of att) { A += eff(G, a); am += a.men; }
      for (const a of def) { D += eff(G, a); dm += a.men; ent = Math.max(ent, a.entrench); }
      D *= defenceAt(G, b.tile) * (b.river ? 1.25 : 1) * (1 + ent * 0.25);
      // Lanchester with the square softened: not every man reaches the line
      const attLoss = Math.min(am, K.LOSS_K * Math.pow(D, 0.9) * (0.85 + 0.3 * G._rand()));
      const defLoss = Math.min(dm, K.LOSS_K * Math.pow(A, 0.9) * (0.85 + 0.3 * G._rand()));
      applyLoss(att, attLoss, am); applyLoss(def, defLoss, dm);
      b.attLoss += attLoss; b.defLoss += defLoss;
      let am2 = 0, dm2 = 0, ao = 0, dO = 0;
      for (const a of att) { am2 += a.men; ao += a.org * a.men; }
      for (const a of def) { dm2 += a.men; dO += a.org * a.men; }
      ao /= Math.max(1, am2); dO /= Math.max(1, dm2);
      const days = G.day - b.day0;
      if (am2 < K.MIN_ARMY || ao < K.RETREAT_ORG || (days >= 1 && am2 < dm2 * K.RETREAT_RATIO)) endBattle(G, b, "def");
      else if (dm2 < K.MIN_ARMY || dO < K.RETREAT_ORG || (days >= 1 && dm2 < am2 * K.RETREAT_RATIO)) endBattle(G, b, "att");
      else if (days > 10) endBattle(G, b, A > D ? "att" : "def");
    }
  }
  function applyLoss(list, loss, total) {
    for (const a of list) {
      const share = loss * a.men / Math.max(1, total);
      const frac = share / Math.max(1, a.men);
      a.men = Math.max(0, a.men - share);
      a.org = Math.max(0, a.org - frac * 2.4 - 0.025);
    }
  }
  /* winner: "att" | "def" | null (peace broke it up) */
  function endBattle(G, b, winner) {
    const i = G.battles.indexOf(b);
    if (i < 0) return;
    G.battles.splice(i, 1);
    G._battleById.delete(b.id);
    const att = b.att.map(function (id) { return armyById(G, id); }).filter(Boolean);
    const def = b.def.map(function (id) { return armyById(G, id); }).filter(Boolean);
    for (const a of att.concat(def)) { a.battle = 0; a.men = Math.round(a.men); }
    const losers = winner === "att" ? def : winner === "def" ? att : [];
    const winners = winner === "att" ? att : winner === "def" ? def : [];
    let surrendered = 0, deserted = 0;
    for (const a of losers) {
      if (a.home >= 0) {
        // a beaten garrison SURRENDERS. The men lay down their arms and go
        // home: they are that town's people again. And the town opens its
        // gates to the side that beat it — the watch on the walls just saw
        // its army lay down its arms.
        const home = a.home, v = winners[0];
        surrendered += a.men;
        G.townPop[home] += a.men;
        G.events.push({ type: "surrender", army: a.id, town: home, men: Math.round(a.men), owner: a.owner, to: v ? v.owner : 0 });
        removeArmy(G, a);
        if (v && !v.rogue && !v.free && canTake(G, v.owner, home)) {
          G.townPop[home] += G.garrison[home];
          G.garrison[home] = 0;
          takeTown(G, home, v.owner);
        }
        continue;
      }
      // a beaten field army sheds deserters, who become a warband
      if (!a.rogue && a.men > K.MIN_ARMY * 4) {
        const d = Math.round(a.men * K.DESERT_SHARE);
        a.men -= d; deserted += d;
        shedRogues(G, a.tile, d);
      }
      retreat(G, a, b);
    }
    for (const a of winners) { a.org = Math.max(0, a.org - 0.05); a.lastWin = G.day; }
    // a winning attacker at a town gate walks in
    if (winner === "att" && b.town >= 0 && att[0] && !att[0].dead) {
      const lead = att[0];
      if (!lead.rogue && !lead.free && canTake(G, lead.owner, b.town)) {
        if (lead.tile !== b.tile) placeArmy(G, lead, b.tile);
        if (G.garrison[b.town] < K.MIN_ARMY) takeTown(G, b.town, lead.owner);
      } else if (lead.rogue) {
        // raiders sack and move on: people flee or die, nothing changes hands
        G.townPop[b.town] *= 0.95;
        G.events.push({ type: "sacked", town: b.town, by: lead.id });
      }
    }
    // a winning garrison goes home
    for (const a of winners) if (a.home >= 0 && !a.dead) { a.order = { kind: "home" }; a.path = null; }
    for (const a of att.concat(def)) if (!a.dead && a.men < K.MIN_ARMY) removeArmy(G, a);
    G.events.push({ type: "battle", phase: "end", id: b.id, tile: b.tile, winner: winner ? (winner === "att" ? b.attOwner : b.defOwner) : 0,
                    side: winner, att: b.attOwner, def: b.defOwner, attLoss: Math.round(b.attLoss), defLoss: Math.round(b.defLoss),
                    surrendered: Math.round(surrendered), deserted: deserted, town: b.town });
  }
  function shedRogues(G, tile, men) {
    if (men < K.MIN_ARMY) return;
    for (const r of G.armies) {
      if (!r.rogue || r.battle) continue;
      if (Math.max(Math.abs(r.tile % G.M.w - tile % G.M.w), Math.abs(((r.tile / G.M.w) | 0) - ((tile / G.M.w) | 0))) <= 4) {
        r.men += men; return;
      }
    }
    const a = spawnArmy(G, G.ROGUE, tile, men, "Deserters");
    a.org = 0.5;
    G.events.push({ type: "deserters", army: a.id, men: men, tile: tile });
  }
  function retreat(G, a, b) {
    const M = G.M, w = M.w, h = M.h;
    const x0 = a.tile % w, y0 = (a.tile / w) | 0;
    let best = -1, bs = -1e9;
    for (let r = 1; r <= 4 && best < 0; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x0 + dx, ny = y0 + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const t = nx + ny * w;
        if (!M.land[t]) continue;
        if (!a.rogue && !friendly(G, a.owner, G.owner[t]) && G.owner[t]) continue;
        if (hostileArmyAt(G, t, a.owner)) continue;
        const away = (nx + 0.5 - b.x) * (nx + 0.5 - b.x) + (ny + 0.5 - b.y) * (ny + 0.5 - b.y);
        const s = away + (G.owner[t] === a.owner ? 30 : 0) - r;
        if (s > bs) { bs = s; best = t; }
      }
    }
    if (best < 0) {
      // nowhere to run: hemmed in, or the sea at its back. It surrenders.
      G.events.push({ type: "destroyed", army: a.id, owner: a.owner, men: Math.round(a.men), tile: a.tile });
      removeArmy(G, a);
      return;
    }
    placeArmy(G, a, best);
    a.order = { kind: "hold" }; a.path = null; a.entrench = 0;
    a.org = Math.max(0.05, a.org);
  }
  SIM.battleById = function (G, id) { return G._battleById.get(id) || null; };
  SIM.battleAt = function (G, tile) { for (const b of G.battles) if (b.tile === tile) return b; return null; };
  SIM.watch = function (G, id, on) { const b = G._battleById.get(id); if (b) b.watched = !!on; return !!b; };
  SIM.resolveExternal = function (G, id, r) {
    const b = G._battleById.get(id);
    if (!b) return false;
    const att = b.att.map(function (x) { return armyById(G, x); }).filter(Boolean);
    const def = b.def.map(function (x) { return armyById(G, x); }).filter(Boolean);
    const am = att.reduce(function (s, a) { return s + a.men; }, 0), dm = def.reduce(function (s, a) { return s + a.men; }, 0);
    const al = Math.max(0, Math.min(1, r.attLossFrac || 0)) * am, dl = Math.max(0, Math.min(1, r.defLossFrac || 0)) * dm;
    applyLoss(att, al, am); applyLoss(def, dl, dm);
    b.attLoss += al; b.defLoss += dl;
    b.watched = false;
    endBattle(G, b, r.winner === "att" ? "att" : "def");
    return true;
  };

  /* ---------------------------------------------------------------- rogues
     Warbands play by the same movement and battle rules; this is only their
     head. Hunt what you can beat nearby, run from what you cannot, else
     wander. They never take towns — they raid the small ones. */
  function rogueMinds(G) {
    const M = G.M, w = M.w, h = M.h, R = G.ROGUE;
    for (const a of G.armies) {
      if (!a.rogue || a.battle || a.dead) continue;
      a.men *= 1 - (G.day - a.lastWin < 30 ? K.ROGUE_DRIFT * 0.3 : K.ROGUE_DRIFT);
      if ((G.day + a.id) % 3) continue;
      const x0 = a.tile % w, y0 = (a.tile / w) | 0;
      const my = eff(G, a);
      let prey = null, pd = 1e9, danger = null, dd = 1e9;
      for (const b of G.armies) {
        if (b === a || b.rogue || b.dead || b.naval) continue;
        const d = Math.max(Math.abs(b.tile % w - x0), Math.abs(((b.tile / w) | 0) - y0));
        if (d > 8) continue;
        const s = eff(G, b);
        if (s * 1.3 < my && d < pd) { prey = b; pd = d; }
        if (s > my * 0.9 && d < dd) { danger = b; dd = d; }
      }
      if (danger && dd <= 4) {
        // run the other way
        const bx = danger.tile % w, by = (danger.tile / w) | 0;
        let fx = x0 + Math.sign(x0 - bx) * 6, fy = y0 + Math.sign(y0 - by) * 6;
        fx = Math.max(0, Math.min(w - 1, fx)); fy = Math.max(0, Math.min(h - 1, fy));
        const t = nearestLand(G, fx + fy * w);
        if (t >= 0) SIM.order(G, a, { kind: "move", to: t });
        continue;
      }
      if (prey) { SIM.order(G, a, { kind: "chase", target: prey.id }); continue; }
      // raid a small town nearby that cannot stand against us
      let raid = -1;
      for (let t = 0; t < M.towns.length && raid < 0; t++) {
        const T = M.towns[t];
        if (Math.max(Math.abs(T.x - x0), Math.abs(T.y - y0)) > 10) continue;
        if (G.garrison[t] * 1.5 < a.men && G.townPop[t] < 20000 && G._rand() < 0.15) raid = t;
      }
      if (raid >= 0) { SIM.order(G, a, { kind: "move", to: M.towns[raid].tile }); continue; }
      if (a.order.kind === "hold" || a.order.kind === "idle" || !a.path) {
        const t = nearestLand(G, Math.max(0, Math.min(w - 1, x0 + Math.round((G._rand() - 0.5) * 16))) +
                                  Math.max(0, Math.min(h - 1, y0 + Math.round((G._rand() - 0.5) * 16))) * w);
        if (t >= 0) SIM.order(G, a, { kind: "move", to: t });
      }
    }
  }
  function nearestLand(G, t) { return nearestLandTile(G.M, t); }
  function nearestLandTile(M, t) {
    const w = M.w, h = M.h;
    if (M.land[t]) return t;
    const x0 = t % w, y0 = (t / w) | 0;
    for (let r = 1; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (M.land[x + y * w]) return x + y * w;
    }
    return -1;
  }
  // rogues raid towns: a rogue arriving at a town gate fights the watch
  function rogueGates(G) {
    for (const a of G.armies) {
      if (!a.rogue || a.battle || a.dead) continue;
      const ti = G.M.townAt[a.tile] - 1;
      if (ti < 0 || a._raided === ti) continue;
      a._raided = ti;
      const watch = G.garrison[ti];
      if (watch >= K.MIN_ARMY) {
        const f = G.townOwner[ti];
        const wa = spawnArmy(G, f || 0, a.tile, watch, (G.M.towns[ti].name || "Town") + " watch");
        if (!f) wa.free = true;
        wa.home = ti; wa.walls = true; wa.entrench = 1; wa.order = { kind: "hold" };
        G.garrison[ti] = 0;
        startBattle(G, a, wa, a.tile);
      } else {
        G.townPop[ti] *= 0.95;
        G.events.push({ type: "sacked", town: ti, by: a.id });
      }
    }
  }

  /* ---------------------------------------------------------------- upkeep */
  function upkeep(G) {
    const M = G.M, w = M.w, h = M.h;
    const F = Math.max(2, Math.min(8, Math.round(K.FORAGE_KM / Math.max(0.01, M.tileKm || 10))));
    for (let k = G.armies.length - 1; k >= 0; k--) {
      const a = G.armies[k];
      // farmland nobody holds feeds whoever camps on it; sand and rock do not
      const tt = M.terrain[a.tile], wild = !G.owner[a.tile] && (tt === 1 || tt === 2 || tt === 3) && M.rural[a.tile] > 0;
      let sup = a.naval || a.rogue || a.home >= 0 || wild || friendly(G, a.owner, G.owner[a.tile]);
      if (!sup) {
        const x0 = a.tile % w, y0 = (a.tile / w) | 0;
        for (let dy = -F; dy <= F && !sup; dy++) for (let dx = -F; dx <= F && !sup; dx++) {
          const x = x0 + dx, y = y0 + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          if (friendly(G, a.owner, G.owner[x + y * w])) sup = true;
        }
      }
      if (!sup && a.supplied) G.events.push({ type: "cut", army: a.id, owner: a.owner, tile: a.tile });
      a.supplied = sup;
      if (a.battle) continue;
      if (!sup) {
        a.men *= 1 - K.CUT_MEN * (M.terrain[a.tile] === 5 ? 2 : 1);
        a.org = Math.max(0, a.org - K.CUT_ORG);
      } else a.org = Math.min(1, a.org + K.ORG_REGEN);
      if (a.men < K.MIN_ARMY) removeArmy(G, a);
    }
    // garrisons refill from their own people while the town is quiet
    for (let t = 0; t < M.towns.length; t++) {
      const cap = garrisonCap(G, t);
      if (G.garrison[t] >= cap || G.sallied[t]) continue;
      const pool = G.townCatch[t] + G.townPop[t];
      G.garrison[t] = Math.min(cap, G.garrison[t] + pool * K.GARRISON_GROW * (G.townOwner[t] ? 1 : 0.6));
    }
  }

  /* ---------------------------------------------------------------- counts */
  function recount(G) {
    const M = G.M, F = G.factions, N = G.owner.length;
    for (let f = 1; f < F.length; f++) { const x = F[f]; x.tiles = 0; x.towns = 0; x.people = 0; x.soldiers = 0; x.garrisons = 0; x.armies = 0; }
    // land is the sum of the catchments of the towns held (a tile belongs to exactly one town)
    for (let t = 0; t < M.towns.length; t++) { const o = G.townOwner[t]; if (o) F[o].tiles += G.catchTiles[t].length; }
    for (let t = 0; t < M.towns.length; t++) {
      const o = G.townOwner[t];
      if (!o) continue;
      F[o].towns++;
      F[o].people += G.townPop[t] + G.townCatch[t];
      F[o].garrisons += G.garrison[t];
    }
    for (const a of G.armies) {
      if (!a.owner || a.free) continue;
      if (a.home >= 0) { F[a.owner].garrisons += a.men; continue; }
      F[a.owner].soldiers += a.men; F[a.owner].armies++;
    }
    for (let f = 1; f < F.length; f++) { F[f].people = Math.round(F[f].people); F[f].garrisons = Math.round(F[f].garrisons); F[f].soldiers = Math.round(F[f].soldiers); }
  }
  SIM.stats = function (G, f) {
    const x = G.factions[f];
    return { people: x.people, soldiers: x.soldiers, garrisons: x.garrisons, tiles: x.tiles, towns: x.towns, armies: x.armies,
             share: x.tiles / Math.max(1, G.landTiles) };
  };

  /* ---------------------------------------------------------------- death & win */
  function judge(G) {
    const F = G.factions;
    for (let f = 1; f < G.ROGUE; f++) {
      if (!F[f].alive || F[f].towns > 0) continue;
      // no towns: the field armies scatter into warbands
      F[f].alive = false;
      for (const a of G.armies.slice()) if (a.owner === f) {
        if (a.home < 0 && a.men > K.MIN_ARMY * 2) { a.owner = G.ROGUE; a.rogue = true; a.name = "Remnants of " + F[f].name; a.order = { kind: "idle" }; }
        else removeArmy(G, a);
      }
      for (let g = 1; g < G.ROGUE; g++) if (g !== f) { G.rel[ri(G, f, g)] = 0; G.rel[ri(G, g, f)] = 0; }
      G.events.push({ type: "dead", faction: f });
      if (f === G.player) { G.over = { lose: f }; G.events.push({ type: "lose", faction: f }); }
    }
    if (G.over) return;
    const share = (G.M.win && G.M.win.share) || 0.6;
    const alive = [];
    for (let f = 1; f < G.ROGUE; f++) if (F[f].alive) alive.push(f);
    for (const f of alive) {
      const friends = alive.every(function (g) { return g === f || rel(G, f, g) === 2; });
      if (F[f].tiles / Math.max(1, G.landTiles) >= share || (friends && alive.length <= 3)) {
        G.over = { win: f };
        G.events.push({ type: "win", faction: f });
        if (G.player && f !== G.player && rel(G, f, G.player) !== 2) G.events.push({ type: "lose", faction: G.player });
        return;
      }
    }
  }

  /* ================================================================ STEP */
  SIM.step = function (G, days) {
    days = days == null ? 1 : days;
    const AI = WAR.ai;
    for (let d = 0; d < days; d++) {
      if (G.over) return G;
      if (AI && AI.think) {
        for (let f = 1; f < G.ROGUE; f++) {
          if (f === G.player || !G.factions[f].alive) continue;
          if ((G.day + f) % K.AI_EVERY === 0) AI.think(G, f);
        }
      }
      rogueMinds(G);
      sallies(G);
      steerSallies(G);
      moveArmies(G);
      rogueGates(G);
      contact(G);
      fight(G);
      upkeep(G);
      recount(G);
      judge(G);
      if (G.day % 30 === 0) for (let t = 0; t < G.townPop.length; t++) G.townPop[t] *= 1.001;
      G.day++;
    }
    return G;
  };
})();
