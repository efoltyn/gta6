/* ============================================================
   president/world.js — THE WORLD, AS ONE DETERMINISTIC MODEL.

   President is a game about knock-on consequences, so there is exactly one
   model and every number in it is connected to every other: a refinery hit
   by your air strike takes fuel off the world market, the world price of
   fuel goes up, your own factories pay it, your unemployment and your CPI
   move, your approval moves, your next election moves. Nothing here is a
   separate minigame with its own numbers.

   SHAPE
     state   one plain JSON object (no THREE, no DOM, no typed arrays, no
             Math.random): everything that changes. JSON.stringify(S) is a
             save game and a network snapshot.
     geo     the map (land, provinces, adjacency, sea lanes) is DERIVED from
             S.seed by geo(seed) and cached; it is never in the state and
             never on the wire.
     step    step(S, actions) applies the actions (from humans, in order),
             lets every AI president act through the SAME apply(), then
             simulates one day. Lockstep multiplayer is: the host broadcasts
             { day, actions } and every client runs step() on the same state.
     act     every decision anyone (human, AI, cabinet) makes is an action
             object { type, c, ... } passed to apply(). There is no other way
             to change the world.

   DAY = ONE TICK. Economy, markets, bonds, war fronts, politics and the
   people around each president all advance once per day.

   PUBLIC  CBZ.presWorld = {
     create(seed, opts) -> S        geo(seed, n) -> map
     step(S, actions[])             apply(S, action) -> {ok, why}
     clone(S)  view(S, c) -> derived numbers for papers
     GOODS, RAW, MADE, BUDGET, ROLES, date(day) -> {y, m, d, text}
     tradeFlow(S, from, to, good) -> units/day   worldPrice(S, good)
     front(S, c) -> [{a, b, prog, attacker}]   checksum(S)
   }
   Node: require('./world.js') returns the same object.
============================================================ */
(function (root) {
  "use strict";
  const G = (typeof window !== "undefined" && window) || root;
  const CBZ = G.CBZ = G.CBZ || {};

  // =============================================================== numbers
  const clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  const fin = function (v, d) { return (typeof v === "number" && isFinite(v)) ? v : (d || 0); };
  // the state's own stream (mulberry32): the ONLY randomness in the world
  function rnd(S) {
    let t = (S.rng = (S.rng + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function stream(seed) {
    const S = { rng: seed | 0 };
    return function () { return rnd(S); };
  }
  function hash2(seed, x, y) {
    let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // ================================================================ goods
  /* Quantities are "M units a day" in each good's own unit, prices are $
     per unit, so value in $bn a year is q * P * 0.365. World quantities are
     the opening world (supply = demand at P0); recipes are input per output
     in the same units. */
  const GOODS = [
    { id: "oil", name: "Crude oil", unit: "Mbbl/d", pu: "$/bbl", P0: 75, raw: 1, fd: 5, el: 0.18, fac: "wells", show: 1 },
    { id: "gas", name: "Natural gas", unit: "bcf/d", pu: "$/mcf", P0: 4, raw: 1, fd: 300, el: 0.25, fac: "fields", show: 1 },
    { id: "iron", name: "Iron ore", unit: "Mt/d", pu: "$/t", P0: 110, raw: 1, fd: 0, el: 0.3, fac: "mines", show: 1 },
    { id: "copper", name: "Copper", unit: "kt/d", pu: "$/t", P0: 9000, raw: 1, fd: 0.025, el: 0.3, fac: "mines", show: 1000 },
    { id: "rare", name: "Rare earths", unit: "t/d", pu: "$/kg", P0: 60000, raw: 1, fd: 0.0002, el: 0.2, fac: "mines", show: 1e6, pshow: 0.001 },
    { id: "grain", name: "Grain", unit: "Mt/d", pu: "$/t", P0: 250, raw: 1, fd: 0.8, el: 0.18, fac: "farms", show: 1 },
    { id: "uranium", name: "Uranium", unit: "t/d", pu: "$/kg", P0: 130000, raw: 1, fd: 0.00016, el: 0.2, fac: "mines", show: 1e6, pshow: 0.001 },
    { id: "fuel", name: "Fuel", unit: "Mbbl/d", pu: "$/bbl", P0: 105, raw: 0, q: 95, fd: 95, el: 0.22, rec: { oil: 1.05 }, show: 1 },
    { id: "steel", name: "Steel", unit: "Mt/d", pu: "$/t", P0: 650, raw: 0, q: 5.2, fd: 5.05, el: 0.35, rec: { iron: 1.4, gas: 3 }, show: 1 },
    { id: "chips", name: "Electronics", unit: "M/d", pu: "$/unit", P0: 110, raw: 0, q: 40, fd: 38, el: 0.5, rec: { copper: 0.000875, rare: 0.000015, gas: 0.5 }, show: 1 },
    { id: "food", name: "Food", unit: "Mt/d", pu: "$/t", P0: 520, raw: 0, q: 6.5, fd: 6.5, el: 0.28, rec: { grain: 1.1 }, show: 1 },
    { id: "arms", name: "Arms", unit: "k/d", pu: "$k/unit", P0: 500000, raw: 0, q: 0.004, fd: 0.004, el: 0.6, rec: { steel: 37.5, chips: 500 }, show: 1000, pshow: 0.001 },
  ];
  const GI = {}; GOODS.forEach(function (g, i) { GI[g.id] = i; });
  const RAW = GOODS.filter(function (g) { return g.raw; }).map(function (g) { return g.id; });
  const MADE = GOODS.filter(function (g) { return !g.raw; }).map(function (g) { return g.id; });
  const NG = GOODS.length;
  // CPI basket: what a household notices
  const CPIW = { food: 0.32, fuel: 0.3, gas: 0.13, chips: 0.15, steel: 0.1 };
  // world raw production at the start = what the factories eat + final use
  (function () {
    GOODS.forEach(function (g) { if (g.raw) g.q = g.fd; });
    GOODS.forEach(function (m) {
      if (!m.rec) return;
      for (const r in m.rec) GOODS[GI[r]].q += m.rec[r] * m.q;
    });
    // intermediates that are themselves made (steel and chips into arms)
    GOODS.forEach(function (m) { if (!m.raw) m.fdShare = m.fd / m.q; });
  })();

  const BUDGET = [
    { id: "military", name: "Military", d: 2.4 },
    { id: "security", name: "Police & intelligence", d: 1.4 },
    { id: "infra", name: "Infrastructure", d: 2.4 },
    { id: "industry", name: "Industry", d: 1.0 },
    { id: "welfare", name: "Welfare & health", d: 13 },
    { id: "research", name: "Research", d: 1.4 },
    { id: "missile", name: "Missile defense", d: 0.3 },
  ];
  const ADMIN = 6;            // % GDP the state spends whatever you sign
  const ROLES = ["general", "treasury", "bank", "trade", "security"];
  const ROLE_TITLE = { general: "General", treasury: "Treasury Secretary", bank: "Central Bank Governor", trade: "Trade Representative", security: "Security Chief" };

  // =============================================================== names
  /* NOBODY HERE IS MADE UP. The countries, their borders, their leaders and
     their numbers are real (president/nations.js, president/earth.js). The
     people AROUND a leader (his ministers, the man who replaces him when he
     falls) are not anybody in particular: a first name and a surname from
     his own country's language. */
  function nationsData() { return CBZ.presNations || (typeof require === "function" ? require("./nations.js") : null); }
  function earthData() { return CBZ.presEarth || (typeof require === "function" ? require("./earth.js") : null); }
  function pick(r, a) { return a[Math.floor(r() * a.length) % a.length]; }
  function personName(r, pool) {
    const P = nationsData().names(pool);
    return pick(r, P[0]) + " " + pick(r, P[1]);
  }

  // ============================================================== the map
  /* THE REAL WORLD AS TILES (earth.js: equirectangular, a few tenths of a
     degree a tile). A country in play is split into provinces, one per city
     in its row (nations.js), each grown over the country's own tiles from
     its city; a front moves city by city. Land of a country not in play is
     `land` but no province: it is drawn, named and bordered, and nobody
     marches across it. Sea lanes run only over open water. */
  let GEO = null;
  function decodeEarth(E) {
    const land = new Int16Array(E.W * E.H);
    let o = 0;
    for (let i = 0; i < E.rle.length; i += 2) {
      const v = E.rle.charCodeAt(i) - 0x30 - 1, n = E.rle.charCodeAt(i + 1) - 0x30;
      land.fill(v, o, o + n); o += n;
    }
    return land;
  }
  function geo() {
    if (GEO) return GEO;
    const E = earthData(), NA = nationsData();
    const Wd = E.W, Ht = E.H, N = Wd * Ht;
    const land = decodeEarth(E);                       // earth country index per tile, -1 sea
    const nat = new Int16Array(N).fill(-1);            // nation in play per tile
    const eIdx = NA.list.map(function (n) { return E.iso.indexOf(n.iso); });
    const natOfE = {};
    eIdx.forEach(function (e, k) { if (e >= 0) natOfE[e] = k; });
    for (let i = 0; i < N; i++) { const e = land[i]; if (e >= 0 && natOfE[e] != null) nat[i] = natOfE[e]; }
    const tileOf = function (lat, lon) {
      const x = Math.floor((lon - E.lonW) / E.step), y = Math.floor((E.latN - lat) / E.step);
      return { x: Math.max(0, Math.min(Wd - 1, x)), y: Math.max(0, Math.min(Ht - 1, y)) };
    };
    const nb4 = function (j) {
      const x = j % Wd, y = (j / Wd) | 0;
      return [x > 0 ? j - 1 : j + Wd - 1, x < Wd - 1 ? j + 1 : j - Wd + 1, y > 0 ? j - Wd : -1, y < Ht - 1 ? j + Wd : -1];
    };
    // ---- the cities: a seed tile each, on its own country's land
    const cell = new Int32Array(N).fill(-1);
    const provs = [];
    NA.list.forEach(function (n, k) {
      n.cities.forEach(function (ct, ci) {
        const t = tileOf(ct[1], ct[2]);
        let best = -1, bd = 1e9;
        for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++) {
          const x = (t.x + dx + Wd) % Wd, y = t.y + dy;
          if (y < 0 || y >= Ht) continue;
          const j = y * Wd + x;
          if (nat[j] !== k || cell[j] >= 0) continue;
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = j; }
        }
        if (best < 0) return;                          // the city's tile is somebody else's: no province
        const id = provs.length;
        cell[best] = id;
        provs.push({ id: id, nation: k, name: ct[0], city: ct[3], occ: ct[4] || null, capital: ci === 0, seed: best,
          n: 0, coast: 0, adj: [], sea: [], lx: best % Wd, ly: (best / Wd) | 0 });
      });
    });
    // ---- grow every city over its country's tiles, all at once (a fair race)
    let q = provs.map(function (p) { return p.seed; }), k = 0;
    while (k < q.length) {
      const j = q[k++];
      for (const t of nb4(j)) if (t >= 0 && cell[t] < 0 && nat[t] >= 0 && nat[t] === provs[cell[j]].nation) { cell[t] = cell[j]; q.push(t); }
    }
    // islands with no city of their own: the nearest city of the same country
    for (let i = 0; i < N; i++) {
      if (nat[i] < 0 || cell[i] >= 0) continue;
      const x = i % Wd, y = (i / Wd) | 0;
      let best = -1, bd = 1e18;
      for (const p of provs) {
        if (p.nation !== nat[i]) continue;
        let dx = Math.abs(p.lx - x); dx = Math.min(dx, Wd - dx);
        const dy = p.ly - y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = p.id; }
      }
      if (best >= 0) cell[i] = best;
    }
    // ---- sizes, coasts, land borders
    const adjSet = provs.map(function () { return {}; });
    let sx = provs.map(function () { return 0; }), sy = provs.map(function () { return 0; });
    for (let i = 0; i < N; i++) {
      const p = cell[i]; if (p < 0) continue;
      const pr = provs[p];
      pr.n++; sx[p] += i % Wd; sy[p] += (i / Wd) | 0;
      for (const t of nb4(i)) {
        if (t < 0) continue;
        if (land[t] < 0) pr.coast++;
        else if (cell[t] >= 0 && cell[t] !== p) adjSet[p][cell[t]] = 1;
      }
    }
    provs.forEach(function (pr, k2) {
      pr.cx = sx[k2] / Math.max(1, pr.n); pr.cy = sy[k2] / Math.max(1, pr.n);
      pr.adj = Object.keys(adjSet[k2]).map(Number).sort(function (a, b) { return a - b; });
      pr.elev = 0;
    });
    // ---- the sea: depth for the map's shading, lanes between coasts
    const sOwn = new Int32Array(N).fill(-1), sDist = new Int16Array(N).fill(9999);
    const sq = [];
    for (let i = 0; i < N; i++) {
      if (land[i] >= 0) continue;
      for (const t of nb4(i)) if (t >= 0 && cell[t] >= 0) { sOwn[i] = cell[t]; sDist[i] = 1; sq.push(i); break; }
    }
    let sk = 0;
    while (sk < sq.length) {
      const j = sq[sk++];
      if (sDist[j] >= LANE_HALF) continue;
      for (const t of nb4(j)) if (t >= 0 && land[t] < 0 && sOwn[t] < 0) { sOwn[t] = sOwn[j]; sDist[t] = sDist[j] + 1; sq.push(t); }
    }
    const seaSet = provs.map(function () { return {}; });
    for (let j = 0; j < N; j++) {
      if (sOwn[j] < 0) continue;
      const x = j % Wd, y = (j / Wd) | 0;
      const nb = [x < Wd - 1 ? j + 1 : j - Wd + 1, y < Ht - 1 ? j + Wd : -1];
      for (const t of nb) {
        if (t < 0 || sOwn[t] < 0 || sOwn[t] === sOwn[j]) continue;
        if (sDist[t] + sDist[j] > LANE_HALF * 2) continue;
        const a = sOwn[j], b = sOwn[t];
        if (adjSet[a][b]) continue;
        seaSet[a][b] = 1; seaSet[b][a] = 1;
      }
    }
    provs.forEach(function (pr, k2) { pr.sea = Object.keys(seaSet[k2]).map(Number).sort(function (a, b) { return a - b; }); });
    // depth: distance to any land (for the map's sea shading)
    const depth = new Int16Array(N).fill(-1), dq = [];
    for (let i = 0; i < N; i++) if (land[i] >= 0) { depth[i] = 0; dq.push(i); }
    let dk = 0;
    while (dk < dq.length) { const j = dq[dk++]; if (depth[j] >= 12) continue; for (const t of nb4(j)) if (t >= 0 && depth[t] < 0) { depth[t] = depth[j] + 1; dq.push(t); } }
    const h = new Array(N);
    for (let i = 0; i < N; i++) h[i] = land[i] >= 0 ? 0.06 : -(depth[i] < 0 ? 12 : depth[i]) * 0.04;
    GEO = { W: Wd, H: Ht, cell: Array.from(cell), land: land, nat: nat, h: h, seaLevel: 0, provs: provs, P: provs.length,
      names: E.names, step: E.step, latN: E.latN, lonW: E.lonW, tileOf: tileOf };
    return GEO;
  }
  // the share of each raw good the countries NOT in play put on the world market
  // (the Gulf's oil and gas, Chile's and the Congo's copper, Kazakhstan's uranium)
  const ROW_SHARE = { oil: 0.3, gas: 0.12, iron: 0.08, copper: 0.4, rare: 0.05, grain: 0.1, uranium: 0.45 };
  const LANE_HALF = 11;          // tiles from a coast a lane reaches out (two coasts: twice that)

  // ============================================================ creation
  function ymdDay(s) {
    // "YYYY-MM" -> days after the start (the 1st of that month)
    if (!s) return 0;
    const a = String(s).split("-"), st = nationsData().START;
    return Math.round((Date.UTC(+a[0], (+a[1] || 1) - 1, 1) - Date.UTC(st.y, st.m - 1, st.d)) / 86400000);
  }
  /* create(seed): the real world on the first day of the game. The seed is
     only the dice (who the ministers are, how the leaders lean when the data
     says nothing, every roll that follows); the world itself is the one in
     nations.js, the same every game. */
  function create(seed, opts) {
    seed = (seed | 0) || 1;
    const NA = nationsData(), M = geo();
    const nC = NA.list.length;
    const S = { v: 2, seed: seed, nC: nC, rng: (seed * 2654435761) | 0, day: 0, nextId: 1, log: [], fallen: [], over: null, fear: 0, fallout: 0 };
    const r = function () { return rnd(S); };
    const idOf = {}; NA.list.forEach(function (n, k) { idOf[n.id] = k; });
    S.c = NA.list.map(function (n, c) {
      const reg = n.regime;
      const dial = (NA.DIALS && NA.DIALS[n.id]) || null;
      const capP = M.provs.find(function (p) { return p.nation === c && p.capital; }) || M.provs.find(function (p) { return p.nation === c; });
      return {
        id: c, key: n.id, name: n.name, short: n.short, pool: n.pool, color: n.color, cap: capP ? capP.id : 0, capital: capP ? capP.name : "", regime: reg,
        freedom: n.freedom, elections: !!n.elections, termDays: Math.round((n.term || 4) * 365.25), nextElection: n.elections ? Math.max(30, ymdDay(n.next)) : 0,
        human: null, alive: true, out: null,
        leader: { name: n.leader, title: n.title, since: 0, original: true,
          aggr: dial ? dial[0] : r() * 0.6, mad: dial ? dial[1] : r() * r() * 0.5, auth: dial ? dial[2] : (reg === "autocracy" ? 0.6 + r() * 0.4 : r() * 0.5), prot: dial ? dial[3] : r() },
        pop: n.pop, gdp0: n.gdp, gdp: n.gdp, prod: 1, gap: 0, svc0: 0, u: n.u, cpi: 100, core: 100, cpiHist: [], infl: n.infl, infl0: n.infl,
        inflBias: (n.infl - 2) / 100,
        tax: 0, budget: {}, debt: 0, coupon: 0, yld: 0, rate: n.rate, rateHold: 0, rating: "A", defaulted: 0, crisis: 0, haven: n.haven || 0,
        approval: n.approval, unrest: clamp(8 + (50 - n.approval) * 0.4 + (n.u > 10 ? 8 : 0), 3, 60), anger: 0, scandal: 0, rally: 0,
        div: 0, planes: 0, md: 0, nukes: n.nukes || 0, nukeProg: n.nukeProg || 0, equip: 1, supply: 1, warDays: 0, dead: 0,
        posture: {}, tariffs: {}, sanctions: [], embargo: {}, allies: [], deals: [], war: [],
        stock: new Array(NG).fill(0), sup: new Array(NG).fill(0), dem: new Array(NG).fill(0),
        imp: new Array(NG).fill(0), exp: new Array(NG).fill(0), fill: new Array(NG).fill(1), pl: GOODS.map(function (g) { return g.P0; }),
        dBase: new Array(NG).fill(0), util: new Array(NG).fill(0.85), cap0: new Array(NG).fill(0), gi0: 1,
        tradeIn: 0, tradeOut: 0, tariffRev: 0, rev: 0, spend: 0, deficit: 0,
        cab: {}, matters: [], memo: {}, gained: 0, lost: 0,
        armyPower: reg === "autocracy" ? 45 : reg === "hybrid" ? 28 : 15, martial: n.martial ? 1 : 0,
        print: 0, fx: 1, cbIndep: reg === "democracy" ? 0.9 : reg === "hybrid" ? 0.6 : 0.35,
        heat: { prices: 0, war: 0, crackdown: 0, scandal: 0, plot: 0, pride: 0 }, promise: null,
        loans: [], patron: -1, ind: n.ind || 1,
      };
    });
    // ---- provinces: the cities, their people, what is under them
    S.p = M.provs.map(function (g) {
      const occ = g.occ != null && idOf[g.occ] != null ? idOf[g.occ] : g.nation;
      return { id: g.id, name: g.name, owner: g.nation, ctl: occ, pop: 0, fac: {}, fact: {}, dmg: { raw: 0, fact: 0, power: 0, city: 0, nuke: 0 }, prog: 0, by: -1 };
    });
    S.c.forEach(function (c) {
      const mine = M.provs.filter(function (g) { return g.nation === c.id; });
      // the people: the metros, and the country's remainder spread over its land
      const metro = mine.reduce(function (a, g) { return a + g.city; }, 0);
      const tiles = mine.reduce(function (a, g) { return a + g.n; }, 0) || 1;
      const rest = Math.max(0, c.pop - metro);
      mine.forEach(function (g) { S.p[g.id].pop = Math.max(0.05, (metro > c.pop ? g.city * c.pop / metro : g.city) + rest * g.n / tiles); });
      // deposits: the country's real output, over its provinces by land, a little uneven
      const res = NA.list[c.id].res || {};
      RAW.forEach(function (gid) {
        const tot = res[gid] || 0;
        if (tot <= 0) return;
        const w = mine.map(function (g) { return g.n * (0.4 + r() * 1.2) * (gid === "grain" ? 1 : (r() < 0.55 ? 1 : 0.08)); });
        const wt = w.reduce(function (a, b) { return a + b; }, 0) || 1;
        mine.forEach(function (g, i) { const v = tot * w[i] / wt; if (v > tot * 0.02) S.p[g.id].fac[gid] = +v.toFixed(3); });
      });
    });
    const facTotal = {};
    RAW.forEach(function (gid) { facTotal[gid] = 0; S.p.forEach(function (p) { facTotal[gid] += p.fac[gid] || 0; }); });
    // what the countries not in play sell the world (the rest is mined and pumped here)
    S.row = GOODS.map(function (g) { return g.raw ? g.q * (ROW_SHARE[g.id] || 0) : 0; });
    S.yield = GOODS.map(function (g) { return g.raw ? g.q * (1 - (ROW_SHARE[g.id] || 0)) / Math.max(1e-6, facTotal[g.id]) : 0; });
    // ---- the state's books, the cabinet, the elections
    const gdpW = S.c.reduce(function (a, c) { return a + c.gdp; }, 0);
    S.P = GOODS.map(function (g) { return g.P0; });
    S.PHist = GOODS.map(function (g) { return [g.P0]; });
    S.c.forEach(function (c) {
      const n = NA.list[c.id];
      const share = c.gdp / gdpW;
      const rich = c.gdp / c.pop;                      // $k a head
      BUDGET.forEach(function (b) { c.budget[b.id] = +(b.d * (0.85 + r() * 0.3)).toFixed(1); });
      c.budget.military = n.mil;
      c.budget.welfare = +clamp(rich > 30 ? 15 + (c.freedom - 80) * 0.1 : rich > 10 ? 9 : 5, 3, 22).toFixed(1);
      c.budget.missile = +(n.nukes > 0 || n.mil > 3 ? 0.5 : 0.2).toFixed(1);
      if (c.regime === "autocracy") c.budget.security += 1.2;
      const spend = ADMIN + BUDGET.reduce(function (a, b) { return a + c.budget[b.id]; }, 0);
      c.debt = c.gdp * n.debt / 100;
      // the deficit a country really runs: taxes a few points under what it spends
      const intPct = c.debt / c.gdp * (c.rate + 1.0) * (1 - c.haven * 0.5);
      c.tax = clamp(Math.round(spend + intPct - (n.debt > 90 ? 4 : 2.5)), 12, 50);
      c.yld = yieldTarget(S, c); c.coupon = c.yld;
      ROLES.forEach(function (role) { c.cab[role] = newMinister(S, role, c); });
      GOODS.forEach(function (g, i) { c.dBase[i] = g.fd * share * (0.85 + r() * 0.3); });
    });
    // normalise final demand to the world totals; factories to world output
    GOODS.forEach(function (g, i) {
      const tot = S.c.reduce(function (a, c) { return a + c.dBase[i]; }, 0) || 1;
      S.c.forEach(function (c) { c.dBase[i] *= g.fd / tot; });
      if (g.raw) return;
      const wts = S.c.map(function (c) { return Math.pow(c.gdp, 0.8) * c.ind * (0.85 + r() * 0.3); });
      const wt = wts.reduce(function (a, b) { return a + b; }, 0) || 1;
      S.c.forEach(function (c, k) {
        const cap = g.q / 0.85 * wts[k] / wt;          // factories run at 85% in a normal year
        c.cap0[i] = cap;
        const mine = S.p.filter(function (p) { return p.owner === c.id; }).sort(function (a, b) { return b.pop - a.pop || a.id - b.id; });
        const top = mine.slice(0, Math.max(1, Math.min(6, mine.length)));
        const tp = top.reduce(function (a, p) { return a + Math.sqrt(p.pop); }, 0) || 1;
        top.forEach(function (p) { p.fact[g.id] = cap * Math.sqrt(p.pop) / tp; });
      });
    });
    S.c.forEach(function (c) {
      const army = NA.list[c.id].army; if (army) c.armyX = Math.max(0, army - divTarget(c));
      c.div = divTarget(c); c.planes = Math.round(planeTarget(c)); c.md = mdTarget(c);
      GOODS.forEach(function (g, i) { c.stock[i] = 30 * (c.dBase[i] + interDemand(S, c, i)); });
      c.memo.mil0 = c.budget.military; c.memo.infra0 = c.budget.infra; c.memo.res0 = c.budget.research;
    });
    // ---- the world as it stands: blocs, grudges, treaties, sanctions, tariffs
    S.rel = [];
    for (let a = 0; a < nC; a++) S.rel.push(new Array(nC).fill(0));
    const bloc = {};
    for (const b in NA.BLOCS) NA.BLOCS[b].forEach(function (id) { bloc[id] = b; });
    for (let a = 0; a < nC; a++) for (let b = a + 1; b < nC; b++) {
      const ka = S.c[a].key, kb = S.c[b].key, ba = bloc[ka], bb = bloc[kb];
      let v = 12 - Math.abs(S.c[a].freedom - S.c[b].freedom) * 0.15;
      if (ba && ba === bb) v = ba === "west" ? 55 : 40;
      else if (ba && bb) v = -45;
      S.rel[a][b] = S.rel[b][a] = Math.round(v);
    }
    NA.REL.forEach(function (t) { const a = idOf[t[0]], b = idOf[t[1]]; if (a != null && b != null) S.rel[a][b] = S.rel[b][a] = t[2]; });
    NA.ALLIANCES.forEach(function (grp) {
      const ids = grp.map(function (k2) { return idOf[k2]; }).filter(function (x) { return x != null; });
      ids.forEach(function (a) { ids.forEach(function (b) { if (a !== b && S.c[a].allies.indexOf(b) < 0) S.c[a].allies.push(b); }); });
    });
    NA.SANCTIONS.forEach(function (t) { const a = idOf[t[0]], b = idOf[t[1]]; if (a != null && b != null && S.c[a].sanctions.indexOf(b) < 0) S.c[a].sanctions.push(b); });
    NA.TARIFFS.forEach(function (t) { const a = idOf[t[0]], b = idOf[t[1]]; if (a != null && b != null) S.c[a].tariffs[b] = { all: t[2] }; });
    // a few silent days to settle the markets and measure goods value added,
    // then services are whatever the rest of the economy is
    for (let k2 = 0; k2 < 4; k2++) marketDay(S);
    S.c.forEach(function (c) { c.svc0 = Math.max(c.gdp0 * 0.4, c.gdp0 - goodsVA(S, c)); c.gdp = c.gdp0; c.tariffRev = 0; c.tradeIn = 0; c.tradeOut = 0; c.gi0 = goodsIndex(c); c.cpiHist = [100]; });
    // the wars already being fought on the first morning
    NA.WARS.forEach(function (t) {
      const a = idOf[t[0]], b = idOf[t[1]];
      if (a == null || b == null) return;
      const A = S.c[a], B = S.c[b];
      A.war.push(b); B.war.push(a); A.posture[b] = "attack"; B.posture[a] = "hold";
      A.allies = A.allies.filter(function (x) { return x !== b; }); B.allies = B.allies.filter(function (x) { return x !== a; });
      A.warStart = B.warStart = -250; A.warDays = B.warDays = 250;
    });
    logEv(S, -1, "world", {});
    return S;
  }

  function newMinister(S, role, c) {
    const r = function () { return rnd(S); };
    return { role: role, name: personName(r, c && c.pool), loyalty: 55 + r() * 30, ambition: r(), hawk: r(), comp: 0.75 + r() * 0.5, since: S.day, mood: 0 };
  }

  // ===================================================== derived budgets
  function milBn(c) { return c.gdp * c.budget.military / 100; }
  // the budget buys divisions; a country that fields more men than its budget (conscripts, aid) carries the difference
  function divTarget(c) { return 2 + milBn(c) * 0.55 / 3 + (c.armyX || 0); }
  function planeTarget(c) { return milBn(c) * 0.25 / 0.35; }
  function mdTarget(c) { return 1 - Math.exp(-c.budget.missile * 0.9 * (0.8 + c.budget.research * 0.1)); }
  function spendPct(c) { return ADMIN + BUDGET.reduce(function (a, b) { return a + c.budget[b.id]; }, 0); }
  function official(c) { let t = 0; for (const l of c.loans) t += l.amt; return t; }
  // government-to-government loans are cheaper, so the market weighs them less
  function debtRatio(c) { return (c.debt + official(c) * 0.5) / Math.max(1, c.gdp); }

  function yieldTarget(S, c) {
    // a reserve currency or a nation of savers carries debt the market shrugs at
    const dr = debtRatio(c) * (1 - (c.haven || 0));
    let y = Math.max(0.25, c.rate) + 1.1;
    if (dr > 0.6) y += 2.4 * (dr - 0.6);
    if (dr > 1.2) y += 5 * (dr - 1.2) * (dr - 1.2) + 2 * (dr - 1.2);
    const def = -c.deficit / Math.max(1, c.gdp) * 100;            // deficit as % GDP (positive = deficit)
    if (c.deficit < 0 && def > 3) y += 0.35 * (def - 3);
    // inflation the policy rate does not already pay for
    y += 0.4 * Math.max(0, c.infl - Math.max(2, c.rate - 1));
    if (c.war && c.war.length) y += 1.2 + 4 * occupiedShare(S, c);
    y += c.unrest / 30 + (c.coupRisk || 0) * 8;
    y += (c.sanctionHit || 0) * 12;
    y += c.defaulted > 0 ? 8 * c.defaulted : 0;
    if (c.freedom < 35) y += (35 - c.freedom) * 0.03;
    // a bank that answers to the president, a press that prints the deficit,
    // a currency on the floor: the market prices all three
    y += (1 - c.cbIndep) * 3 + c.print * 0.3 + (c.fx < 0.7 ? (0.7 - c.fx) * 12 : 0);
    return clamp(y, 0.2, 60);
  }

  function interDemand(S, c, gi) {
    const id = GOODS[gi].id;
    let t = 0;
    GOODS.forEach(function (m, mi) {
      if (!m.rec || !m.rec[id]) return;
      t += m.rec[id] * factoryCap(S, c, mi) * (c.util ? c.util[mi] : 0.85);
    });
    return t;
  }
  // capacity a country can actually run today: its own factories in the
  // provinces it controls, minus what has been bombed
  function factoryCap(S, c, mi) {
    if (!S.p) return c.cap0[mi];
    const id = GOODS[mi].id;
    let t = 0;
    for (let k = 0; k < S.p.length; k++) {
      const p = S.p[k];
      if (p.ctl !== c.id || !p.fact[id]) continue;
      const occ = p.owner !== c.id ? 0.5 : 1;
      t += p.fact[id] * occ * (1 - p.dmg.fact) * (1 - p.dmg.power * 0.8) * (1 - p.dmg.nuke);
    }
    return t;
  }
  function rawOutput(S, c, gi) {
    const id = GOODS[gi].id, y = S.yield[gi];
    let t = 0;
    for (let k = 0; k < S.p.length; k++) {
      const p = S.p[k];
      if (p.ctl !== c.id || !p.fac[id]) continue;
      const occ = p.owner !== c.id ? 0.5 : 1;
      let f = p.fac[id] * y * occ * (1 - p.dmg.raw) * (1 - p.dmg.power * 0.5) * (1 - p.dmg.nuke);
      if (id === "grain") f *= 1 - S.fallout * 0.35;
      f *= clamp(Math.pow(S.P[gi] / GOODS[gi].P0, 0.35), 0.3, 1.3);
      if (p.prog > 0) f *= 0.7;                                   // a contested province
      t += f;
    }
    return t * clamp(1 + (c.budget.infra - 2.4) * 0.02, 0.9, 1.1);
  }

  // ============================================================ the market
  /* One day of every market. Each country brings what it produced and what
     it wants; the gap is offered to or asked of the world; trade routes are
     weighted by tariffs, deals, alliances and relations and cut to zero by
     war, sanctions and embargoes. What is left unmatched moves the world
     price; what a country could not get moves its own price above it. */
  function blocked(S, imp, exp, gid) {
    const a = S.c[imp], b = S.c[exp];
    if (!a.alive || !b.alive) return true;
    if (a.war.indexOf(exp) >= 0) return true;
    if (a.sanctions.indexOf(exp) >= 0 || b.sanctions.indexOf(imp) >= 0) return true;
    const em = b.embargo[imp];
    if (em && (em.indexOf(gid) >= 0 || em.indexOf("all") >= 0)) return true;
    return false;
  }
  function tariffOn(S, imp, exp, gid) {
    const t = S.c[imp].tariffs[exp];
    if (!t) return 0;
    return t[gid] != null ? t[gid] : (t.all || 0);
  }
  function access(S, i, j, gid) {
    if (blocked(S, i, j, gid)) return 0;
    const a = S.c[i];
    let w = 1 / (1 + 4 * tariffOn(S, i, j, gid));
    if (a.deals.indexOf(j) >= 0) w *= 1.25;
    if (a.allies.indexOf(j) >= 0) w *= 1.1;
    w *= 0.75 + 0.25 * (S.rel[i][j] + 100) / 200;
    // a cheap currency is a cheap seller
    w *= Math.pow(clamp(S.c[j].fx, 0.2, 3), -0.4);
    return w;
  }
  function marketDay(S) {
    const C = S.c, n = C.length;
    if (!S.flow) { S.flow = []; for (let g = 0; g < NG; g++) { const m = []; for (let i = 0; i < n; i++) m.push(new Array(n).fill(0)); S.flow.push(m); } }
    // ---- supply and demand per country, raw first, then factories
    for (const c of C) {
      if (!c.alive) { for (let g = 0; g < NG; g++) { c.sup[g] = 0; c.dem[g] = 0; } continue; }
      const gdpF = Math.pow(Math.max(0.2, c.prod * (1 + c.gap)), 0.7);
      for (let g = 0; g < NG; g++) {
        const gd = GOODS[g];
        if (gd.raw) c.sup[g] = rawOutput(S, c, g);
        else {
          // a factory runs when it can get its inputs and the price pays for them
          let acc = 1, cost = 0;
          for (const r in gd.rec) { const ri = GI[r]; acc = Math.min(acc, c.fill[ri]); cost += gd.rec[r] * c.pl[ri]; }
          const margin = (c.pl[g] - cost) / Math.max(1e-9, c.pl[g]);
          // a supply curve: 85% in a normal year, flat out when the price is up a quarter, idling in a glut
          const want = clamp(acc * clamp(0.85 + 0.6 * (c.pl[g] / gd.P0 - 1), 0.4, 1) * (margin < 0 ? 0.6 : 1), 0, 1);
          c.util[g] += (want - c.util[g]) * 0.15;
          c.sup[g] = factoryCap(S, c, g) * c.util[g];
        }
        // final demand: income, own price, and what the budget is buying
        let fd = c.dBase[g] * gdpF * Math.pow(Math.max(0.05, c.pl[g] / gd.P0), -gd.el);
        if (gd.id === "arms") fd *= (c.budget.military / Math.max(0.3, c.memo.mil0 || 1)) * (c.war.length ? 1.6 : 1);
        if (gd.id === "steel") fd *= 0.75 + 0.25 * c.budget.infra / Math.max(0.3, c.memo.infra0 || 1);
        if (gd.id === "chips") fd *= 0.85 + 0.15 * c.budget.research / Math.max(0.3, c.memo.res0 || 1);
        if (gd.id === "fuel" && c.war.length) fd *= 1.12;
        c.dem[g] = fd;
      }
      for (let g = 0; g < NG; g++) c.dem[g] += interDemand(S, c, g);
    }
    // ---- trade, good by good
    for (let g = 0; g < NG; g++) {
      const gid = GOODS[g].id, F = S.flow[g];
      const offer = new Array(n).fill(0), need = new Array(n).fill(0);
      let wSup = 0, wDem = 0, wStock = 0;
      for (let i = 0; i < n; i++) {
        const c = C[i];
        for (let j = 0; j < n; j++) F[i][j] = 0;
        if (!c.alive) continue;
        const target = 30 * c.dem[g];
        const net = c.sup[g] - c.dem[g] + (c.stock[g] - target) * 0.06;
        if (net > 0) offer[i] = net; else need[i] = -net;
        wSup += c.sup[g]; wDem += c.dem[g]; wStock += c.stock[g];
      }
      const left = offer.slice();
      const want = need.slice();
      for (let round = 0; round < 3; round++) {
        const ask = []; for (let i = 0; i < n; i++) ask.push(null);
        const tot = new Array(n).fill(0);
        for (let i = 0; i < n; i++) {
          if (want[i] <= 1e-12) continue;
          let ws = 0; const row = new Array(n).fill(0);
          for (let j = 0; j < n; j++) { if (j === i || left[j] <= 1e-12) continue; const a = access(S, i, j, gid); row[j] = left[j] * a; ws += row[j]; }
          if (ws <= 0) continue;
          for (let j = 0; j < n; j++) { row[j] = want[i] * row[j] / ws; tot[j] += row[j]; }
          ask[i] = row;
        }
        for (let i = 0; i < n; i++) {
          const row = ask[i]; if (!row) continue;
          for (let j = 0; j < n; j++) {
            if (!row[j]) continue;
            const s = tot[j] > left[j] ? left[j] / tot[j] : 1;
            const q = row[j] * s;
            F[i][j] += q;
          }
        }
        for (let j = 0; j < n; j++) { let sold = 0; for (let i = 0; i < n; i++) sold += F[i][j]; left[j] = Math.max(0, offer[j] - sold); }
        for (let i = 0; i < n; i++) { let got = 0; for (let j = 0; j < n; j++) got += F[i][j]; want[i] = Math.max(0, need[i] - got); }
      }
      /* THE REST OF THE WORLD. The countries in play are not the whole
         planet: the Gulf states pump oil, Chile and the Congo mine copper,
         Kazakhstan digs uranium. What they sell (S.row, a share of each raw
         good's world output) goes to whoever is still short after the
         countries in play have traded, at the world price, sanctions or not. */
      const rowS = S.row ? S.row[g] || 0 : 0;
      const rowGot = new Array(n).fill(0);
      if (rowS > 0) {
        let tw = 0; for (let i = 0; i < n; i++) tw += want[i];
        if (tw > 1e-12) { const f = Math.min(1, rowS / tw); for (let i = 0; i < n; i++) rowGot[i] = want[i] * f; }
        wSup += rowS;
      }
      // ---- the world price: fundamentals plus how thin the stocks are
      const stockDays = wStock / Math.max(1e-9, wDem);
      let x = (wDem - wSup) / Math.max(1e-9, wDem) + 0.01 * (30 - stockDays);
      x = clamp(x, -0.6, 0.6);
      const P0 = GOODS[g].P0;
      let P = S.P[g] * Math.exp(0.025 * x);
      // long-run pull toward what it costs to produce (very slow)
      P += (P0 - P) * 0.0008;
      S.P[g] = clamp(P, P0 * 0.15, P0 * 15);
      const panic = (gid === "oil" || gid === "gas" || gid === "fuel" || gid === "grain" || gid === "food") ? S.fear : S.fear * 0.3;
      const Pw = S.P[g] * (1 + panic);
      // ---- each country's books for this good
      for (let i = 0; i < n; i++) {
        const c = C[i];
        if (!c.alive) continue;
        let im = rowGot[i], ex = 0, trf = 0, tariffW = 0;
        for (let j = 0; j < n; j++) {
          im += F[i][j]; ex += F[j][i];
          const t = tariffOn(S, i, j, gid);
          trf += F[i][j] * Pw * t; tariffW += F[i][j] * t;
        }
        c.imp[g] = im; c.exp[g] = ex;
        c.tariffRev += trf * 0.365;
        c.tradeIn += im * Pw * 0.365; c.tradeOut += ex * Pw * 0.365;
        const avail = c.stock[g] + c.sup[g] + im - ex;
        const used = Math.min(c.dem[g], Math.max(0, avail));
        c.fill[g] = c.dem[g] > 1e-12 ? clamp(used / c.dem[g], 0, 1) : 1;
        c.stock[g] = clamp(avail - used, 0, 120 * Math.max(c.dem[g], 1e-9) + 1e-9);
        // local price: the world's, plus the tariff on what came in, plus
        // the scramble when it did not come, minus a glut that cannot leave
        const tAvg = im > 1e-12 ? tariffW / im : 0;
        const glut = offer[i] > 1e-12 ? left[i] / Math.max(1e-9, c.sup[g]) : 0;
        let pl = Pw / Math.pow(clamp(c.fx, 0.05, 5), 0.7) * (1 + tAvg * clamp(im / Math.max(1e-9, c.dem[g]), 0, 1)) * (1 + 1.6 * (1 - c.fill[g])) * (1 - 0.45 * clamp(glut, 0, 1));
        c.pl[g] += (pl - c.pl[g]) * 0.25;
        c.pl[g] = Math.max(P0 * 0.05, fin(c.pl[g], P0));
      }
    }
  }
  function goodsIndex(c) {
    let gi = 0; for (const k in CPIW) gi += CPIW[k] * c.pl[GI[k]] / GOODS[GI[k]].P0;
    return gi;
  }
  function goodsVA(S, c) {
    let va = 0;
    for (let g = 0; g < NG; g++) {
      const gd = GOODS[g];
      if (gd.raw) va += c.sup[g] * S.P[g];
      else {
        let cost = 0; for (const r in gd.rec) cost += gd.rec[r] * S.P[GI[r]];
        va += c.sup[g] * Math.max(gd.P0 * 0.05, S.P[g] - cost);
      }
    }
    return va * 0.365;
  }

  // ======================================================== the economy
  function economyDay(S, c) {
    const fillE = (c.fill[GI.fuel] * 0.6 + c.fill[GI.gas] * 0.4);
    const fillF = c.fill[GI.food];
    const fillC = c.fill[GI.chips];
    // the state's books ($bn a year, booked daily)
    const spend = spendPct(c) * c.gdp / 100;
    const royalty = RAW.reduce(function (a, id) { return a + c.sup[GI[id]] * S.P[GI[id]] * 0.365 * 0.12; }, 0);
    // the printing press pays for what the taxes do not
    const rev = c.tax * c.gdp / 100 + c.tariffRev + royalty + c.print * c.gdp / 100;
    const interest = c.debt * c.coupon / 100;
    c.rev = rev; c.spend = spend + interest; c.interest = interest;
    c.deficit = rev - c.spend;                 // negative = borrowing
    // refinancing crisis: the market will not roll you
    if (c.crisis > 0) {
      c.crisis++;
      if (c.crisis > 60 && c.defaulted <= 0) doDefault(S, c, "forced");
    }
    // stress is what the market charges OVER the money's own price (the
    // policy rate, or inflation): 18% in Brazil is a normal Tuesday
    const stress = c.yld - Math.max(c.rate, c.infl, 0);
    if (!c.crisis && c.defaulted <= 0 && (stress > 9 || (stress > 6 && debtRatio(c) * (1 - (c.haven || 0)) > 1.1))) { c.crisis = 1; logEv(S, c.id, "crisis", { y: +c.yld.toFixed(1) }); }
    if (c.crisis && stress < 4) { c.crisis = 0; logEv(S, c.id, "crisisOver", {}); }
    const crisisCut = c.crisis ? Math.min(0.25, c.crisis / 240) : 0;       // the spending nobody would lend for
    c.debt = Math.max(0, c.debt - c.deficit / 365 - (crisisCut * spend / 365));
    // GDP here is real; the debt is in money, and inflation eats money
    c.debt *= 1 - clamp(c.infl, 0, 80) / 100 / 365;
    // official loans: interest plus a tenth of the principal a year, paid to
    // the lender (borrowed, if it has to be)
    for (const l of c.loans) {
      const L = S.c[l.from];
      const pay = l.amt * (l.rate / 100 + 0.1) / 365;
      c.debt += pay; l.amt = Math.max(0, l.amt - l.amt * 0.1 / 365);
      if (L && L.alive) L.debt = Math.max(0, L.debt - pay);
    }
    c.loans = c.loans.filter(function (l) { return l.amt > 0.5; });
    // coupon walks to the market as debt rolls over (about seven years)
    c.coupon += (c.yld - c.coupon) / (7 * 365);
    // bond market
    c.yld += (yieldTarget(S, c) - c.yld) * 0.04;
    c.yld = clamp(c.yld, 0.2, 60);
    const spr = c.yld - Math.max(c.rate, c.infl, 0);
    c.rating = c.defaulted > 0.5 ? "D" : spr < 1.4 ? "AAA" : spr < 2 ? "AA" : spr < 2.8 ? "A" : spr < 3.8 ? "BBB" : spr < 5 ? "BB" : spr < 7 ? "B" : "CCC";
    if (c.defaulted > 0) c.defaulted = Math.max(0, c.defaulted - 1 / (5 * 365));
    // ---- output: potential grows, the gap breathes
    const def = -c.deficit / Math.max(1, c.gdp) * 100;
    const occ = occupiedShare(S, c);
    // money is tight by the REAL rate: 15% in Brazil is not 15% in Germany
    let target = 0.004 * (def - 2) - 0.004 * (c.rate - Math.max(0, c.infl) - 1)
      - 0.22 * (1 - fillE) - 0.18 * (1 - fillF) - 0.06 * (1 - fillC)
      - (c.sanctionHit || 0) - (c.war.length ? 0.01 + occ * 0.3 : 0)
      - c.unrest / 900 - crisisCut * 0.3 - (c.defaulted > 0 ? 0.05 * c.defaulted : 0)
      - S.fear * 0.03 - (c.tax > 38 ? (c.tax - 38) * 0.002 : 0);
    target = clamp(target, -0.3, 0.06);
    c.gap += (target - c.gap) * 0.02;
    let gStar = 0.008 + c.budget.research * 0.0035 + c.budget.infra * 0.0022 + c.budget.industry * 0.0015 + (c.budget.welfare - 12) * 0.0004
      - Math.max(0, c.tax - 32) * 0.0006 - (c.freedom < 45 ? (45 - c.freedom) * 0.0001 : 0) - (c.war.length ? 0.01 : 0);
    c.prod *= 1 + gStar / 365;
    // nuked or bombed cities take their services with them
    let lostPop = 0, totPop = 0;
    for (const p of S.p) if (p.owner === c.id) { totPop += p.pop; lostPop += p.pop * Math.max(p.dmg.city * 0.5, p.dmg.nuke); }
    const cityF = totPop > 0 ? 1 - lostPop / totPop : 1;
    const svc = c.svc0 * c.prod * (1 + c.gap) * cityF;
    const gdpNew = Math.max(1, svc + goodsVA(S, c));
    c.growth = (gdpNew / Math.max(1, c.gdp) - 1) * 365;
    c.gdp = gdpNew;
    // factories capacity grows with industry spend
    // investment follows prices: a high price builds plants and sinks wells,
    // a glut idles them; industry money speeds both
    if (S.day % 30 === (c.id % 30)) {
      const base = (0.012 + (c.budget.industry - 1) * 0.008) / 12;
      for (const p of S.p) {
        if (p.owner !== c.id || p.ctl !== c.id) continue;
        for (const k in p.fact) { const gi = GI[k]; const pr = c.pl[gi] / GOODS[gi].P0; p.fact[k] = Math.max(0, p.fact[k] * (1 + base + clamp((pr - 1.1) * 0.012, -0.006, 0.03) * (0.6 + c.budget.industry * 0.4))); }
        for (const k in p.fac) { const gi = GI[k]; const pr = S.P[gi] / GOODS[gi].P0; p.fac[k] *= 1 + 0.01 / 12 + (pr > 1.15 ? clamp((pr - 1.15) * 0.012, 0, 0.025) * (0.6 + c.budget.industry * 0.4) : pr < 0.75 ? -0.012 * (0.75 - pr) / 0.6 - 0.002 : 0); }
      }
    }
    // ---- jobs and prices
    let utilAvg = 0, utilN = 0;
    MADE.forEach(function (id) { utilAvg += c.util[GI[id]]; utilN++; });
    utilAvg /= Math.max(1, utilN);
    const uT = clamp(5.2 - c.gap * 55 + (0.9 - utilAvg) * 10 - (c.war.length ? 1 : 0) + (c.crisis ? 2 : 0), 1.5, 45);
    c.u += (uT - c.u) * 0.02;
    const def3 = Math.max(0, def - 3);
    // inflation a country walked in with (Argentina, Turkey, Iran) fades over years, not days
    c.inflBias = (c.inflBias || 0) * 0.9985;
    c.core *= 1 + (0.02 + (c.inflBias || 0) + 0.45 * c.gap + 0.004 * def3 - 0.0035 * (c.rate - Math.max(0, c.infl) - 1) +(c.defaulted > 0 ? 0.08 * c.defaulted : 0)
      + c.print * 0.009 + (1 - c.cbIndep) * 0.012 + Math.max(0, 1 - c.fx) * 0.04) / 365;
    c.cpi = c.core * (0.62 + 0.38 * goodsIndex(c) / c.gi0);
    if (S.day % 30 === 0) { c.cpiHist.push(+c.cpi.toFixed(3)); if (c.cpiHist.length > 13) c.cpiHist.shift(); }
    const h = c.cpiHist;
    if (h.length >= 2) {
      // year on year; until there is a year, the months there are, weighted
      const back = h[0], months = h.length - 1;
      const yoy = (Math.pow(c.cpi / Math.max(1e-6, back), 12 / Math.max(1, months)) - 1) * 100;
      const w = Math.min(1, months / 12);
      c.infl = yoy * w + (c.infl0 != null ? c.infl0 : 2) * (1 - w);
    }
    c.infl = clamp(fin(c.infl, 2), -30, 400);
    // ---- the central bank
    const taylor = clamp(1 + c.infl + 0.5 * (c.infl - 2) + 50 * c.gap, 0, 40);
    // an independent governor leans against the press; a puppet does not
    const want = taylor + c.print * 0.6 * c.cbIndep;
    if (c.rateHold > 0) c.rateHold--;
    else c.rate += (want - c.rate) * 0.01 * c.cab.bank.comp * (0.3 + c.cbIndep);
    c.cbIndep = clamp(c.cbIndep + 0.00008, 0, 1);
    // ---- the currency: real rates, the press, the trade balance, the panic
    const tb = (c.tradeOut - c.tradeIn) / Math.max(1, c.gdp);
    const dfx = 0.00012 * clamp((c.rate - c.infl) - 1, -10, 10) - 0.00012 * c.print + 0.004 * tb / 30
      - (c.crisis ? 0.0015 : 0) - c.defaulted * 0.001 - (1 - c.cbIndep) * 0.0002 + (1 - c.fx) * 0.0004;
    c.fx = clamp(c.fx * Math.exp(clamp(dfx, -0.02, 0.02)), 0.02, 5);
    // ---- military follows the budget, slowly
    const dt = divTarget(c);
    c.div += clamp(dt - c.div, -0.06, 0.04);
    c.div = Math.max(0, c.div);
    const pt = planeTarget(c);
    if (c.planes < pt && S.day % 4 === 0) c.planes += Math.min(1 + Math.floor(pt / 200), Math.ceil(pt - c.planes));
    if (c.planes > pt * 1.3 && S.day % 10 === 0) c.planes--;
    c.md += (mdTarget(c) - c.md) * 0.004;
    c.equip += (clamp(c.fill[GI.arms] * 1.05, 0.2, 1) - c.equip) * 0.02;
    c.supply += (clamp(c.fill[GI.fuel] * 1.05, 0.15, 1) - c.supply) * 0.05;
    if (c.nukeProg > 0) {
      c.nukeProg += (0.5 + c.budget.research * 0.4) * (c.fill[GI.uranium] > 0.5 ? 1 : 0.2);
      if (c.nukeProg >= 730) { c.nukeProg = 0; c.nukes += 3; logEv(S, c.id, "bomb", {}); worldReacts(S, c, "bomb"); }
    }
    // repairs: infrastructure money fixes what was bombed
    const fix = 0.003 + c.budget.infra * 0.0015;
    for (const p of S.p) if (p.owner === c.id && p.ctl === c.id) {
      p.dmg.raw = Math.max(0, p.dmg.raw - fix); p.dmg.fact = Math.max(0, p.dmg.fact - fix);
      p.dmg.power = Math.max(0, p.dmg.power - fix * 1.5); p.dmg.city = Math.max(0, p.dmg.city - fix * 0.5);
      p.dmg.nuke = Math.max(0, p.dmg.nuke - 0.00025);
    }
    c.tariffRev = 0; c.tradeIn = 0; c.tradeOut = 0;
  }

  function doDefault(S, c, why) {
    c.debt *= 0.5; c.defaulted = 1; c.crisis = 0; c.coupon = Math.min(c.coupon, 6);
    c.approval -= 12; c.unrest += 15; c.gap -= 0.04;
    logEv(S, c.id, "default", { why: why });
  }

  // ======================================================== politics
  function politicsDay(S, c) {
    const occ = occupiedShare(S, c);
    const shortages = (1 - c.fill[GI.food]) * 1.2 + (1 - c.fill[GI.fuel]) * 0.8 + (1 - c.fill[GI.gas]) * 0.4;
    const dem = c.regime === "democracy";
    /* WHAT PEOPLE ARE USED TO. South Africa lives with 32% unemployment and
       Turkey with 30% inflation; what moves a voter is it getting WORSE than
       he knows. The norms drift toward today over a few years. */
    if (c.uHab == null) { c.uHab = c.u; c.inflHab = c.infl; }
    c.uHab += (c.u - c.uHab) * 0.0012; c.inflHab += (c.infl - c.inflHab) * 0.0012;
    const uN = Math.max(5, Math.min(30, c.uHab)), iN = Math.max(2.5, c.inflHab);
    let A = 52 - 2.0 * (c.u - uN) - 1.4 * Math.max(0, c.infl - iN) + 0.9 * clamp((c.growth || 0) * 100, -10, 6)
      - shortages * 25 + c.rally - Math.min(18, c.warDays / 40) - occ * 60 + Math.min(10, c.gained * 1.5) - Math.min(20, c.lost * 2.5)
      - (dem ? Math.max(0, 60 - c.freedom) * 0.25 : 0) - c.unrest * 0.12 - c.scandal
      - (c.tax - 30) * 0.5 + (c.budget.welfare - 13) * 0.6 + (c.defaulted > 0 ? 10 * c.defaulted : 0) * -1
      - (c.crisis ? 6 : 0) - S.fear * 8
      - c.heat.prices * 0.3 - c.heat.war * 0.2 - (dem ? c.heat.crackdown * 0.15 : c.heat.crackdown * 0.04) - c.heat.scandal * 0.25 + c.heat.pride * 0.2;
    // everything the numbers do not hold (a face, a party, a war at home) is
    // in the leader's real approval on day one; it fades over years
    if (c.apprBias == null) c.apprBias = c.approval - A;
    c.apprBias *= 0.9994;
    A = clamp(A + c.apprBias, 3, 95);
    c.approval += (A - c.approval) * 0.025;
    c.approval = clamp(fin(c.approval, 40), 1, 99);
    c.rally *= 0.985; c.scandal *= 0.99;
    // unrest: what the people will not put up with, minus what holds them down
    const sec = c.budget.security;
    let U = 6 + Math.max(0, c.u - uN) * 2 +Math.max(0, 50 - c.approval) * 1.25 + shortages * 30 + c.anger - sec * 4 + Math.max(0, 40 - c.freedom) * (sec < 2 ? 0.35 : 0.1)
      + c.heat.crackdown * 0.3 + c.heat.prices * 0.3 + c.heat.scandal * 0.15;
    if (c.martial) U = Math.min(U, 25);
    U = clamp(U, 0, 100);
    c.unrest += (U - c.unrest) * 0.03;
    c.anger *= 0.995;
    if (sec > 3.2) c.freedom = Math.max(0, c.freedom - (sec - 3.2) * 0.004);
    else if (c.regime !== "autocracy" && c.freedom < 85) c.freedom += 0.002;
    // the army's hold: every time it is the army that keeps you in the chair,
    // the army learns it could keep somebody else there
    const apBase = 12 + c.budget.military * 4 + (c.regime === "autocracy" ? 15 : 0) + (c.martial ? 30 : 0) + (c.war.length ? 8 : 0);
    c.armyPower += (clamp(apBase, 0, 100) - c.armyPower) * 0.003;
    c.armyPower = clamp(c.armyPower, 0, 100);
    if (c.martial) { c.martial++; c.freedom = Math.max(0, c.freedom - 0.01); c.heat.crackdown = Math.max(c.heat.crackdown, 10); }
    // coups and revolutions
    const gen = c.cab.general;
    c.coupRisk = clamp((40 - gen.loyalty) / 40, 0, 1) * gen.ambition * (0.3 + c.armyPower / 55) * (0.4 + c.unrest / 80) * clamp(1.4 - sec / 4, 0.2, 1.4)
      + (c.armyPower > 70 && gen.loyalty < 50 ? 0.08 : 0);
    if (c.coupRisk > 0.05 && rnd(S) < c.coupRisk * 0.004) coupAttempt(S, c);
    if (c.unrest > 92) { c.memo.riot = (c.memo.riot || 0) + 1; if (c.memo.riot > 45) fall(S, c, "revolution"); }
    else c.memo.riot = 0;
    // elections
    if (c.elections && c.nextElection > 0 && S.day >= c.nextElection) {
      if (c.martial) { c.nextElection += 180; c.freedom -= 5; c.heat.crackdown += 10; logEv(S, c.id, "postponed", { martial: 1 }); }
      else election(S, c);
    }
    // a promise comes due
    if (c.promise && S.day >= c.promise.due) {
      if (c.infl > c.promise.infl - 1) { c.scandal += 6; c.heat.scandal += 12; logEv(S, c.id, "broken", {}); }
      else { c.heat.pride += 6; logEv(S, c.id, "kept", {}); }
      c.promise = null;
    }
    hollerDay(S, c);
  }

  /* HOLLER: what the country is saying. Heat per topic, fed by what really
     happened this day (prices, the war, crackdowns, leaks, a plot found
     out, a victory) and by what the president posts. Heat is not a second
     approval: it is how loud each real thing is, and approval, the street
     and the world's opinion all read it. holler.js turns the same heat and
     the same log into the posts you read. */
  function hollerDay(S, c) {
    const H = c.heat;
    const shortage = (1 - c.fill[GI.food]) + (1 - c.fill[GI.fuel]) * 0.7;
    H.prices += Math.max(0, c.infl - 3.5) * 0.015 + shortage * 0.6 + (c.fx < 0.8 ? (0.8 - c.fx) * 0.2 : 0);
    H.war += c.war.length ? 0.04 + Math.min(0.5, c.lost * 0.05) : 0;
    H.pride += c.war.length && c.gained > c.lost ? 0.03 : 0;
    H.scandal = Math.max(H.scandal, c.scandal * 0.8);
    H.prices *= 0.97; H.war *= 0.985; H.crackdown *= 0.99; H.scandal *= 0.985; H.plot *= 0.993; H.pride *= 0.98;
    for (const k in H) H[k] = clamp(fin(H[k], 0), 0, 60);
  }

  // what the incumbent gets: his approval, a little for being the incumbent,
  // and whatever an unfree country's count adds
  function voteShare(S, c) {
    return c.approval + 2 + Math.max(0, 60 - c.freedom) * 0.55;
  }
  function election(S, c) {
    const share = voteShare(S, c) + (rnd(S) - 0.5) * 14;
    c.nextElection = S.day + c.termDays;
    if (share >= 50) {
      logEv(S, c.id, "reelected", { share: +share.toFixed(1) });
      c.rally += 3;
    } else {
      logEv(S, c.id, "voted out", { share: +share.toFixed(1) });
      fall(S, c, "election");
    }
  }
  function coupAttempt(S, c) {
    const gen = c.cab.general;
    if (c.human != null && !c.out) {
      // a human sees it come through the door; the answer is his
      if (!c.matters.some(function (m) { return m.kind === "coup"; })) addMatter(S, c, "coup", "general", { name: gen.name }, [
        { label: "Step down", act: { type: "resign" } },
        { label: "Arrest him", act: { type: "arrest", role: "general" }, fatal: 1 },
      ], 3, true);
      return;
    }
    const p = clamp(0.35 + gen.ambition * 0.3 - c.budget.security * 0.06 + c.unrest / 200, 0.05, 0.9);
    if (rnd(S) < p) fall(S, c, "coup");
    else { logEv(S, c.id, "coupFailed", { name: gen.name }); c.cab.general = newMinister(S, "general", c); }
  }

  /* A president falls: the leader is out, a new one (always an AI) comes in.
     For a human that is the end of the game. */
  function fall(S, c, why) {
    if (c.out && c.leader.original === false && c.human == null) { /* an AI successor falling: just replace */ }
    const was = c.leader;
    S.fallen.push({ c: c.id, name: was.name, why: why, day: S.day, original: !!was.original });
    logEv(S, c.id, "fall", { why: why, name: was.name });
    if (c.human != null && was.original) { c.out = why; c.humanLost = S.day; }
    c.leader = { name: personName(function () { return rnd(S); }, c.pool), title: c.leader.title, since: S.day, original: false, aggr: rnd(S), mad: rnd(S) * rnd(S), auth: c.regime === "autocracy" ? 0.5 + rnd(S) * 0.5 : rnd(S) * 0.5, prot: rnd(S) };
    c.approval = clamp(c.approval + 15, 30, 65); c.unrest *= 0.6; c.scandal = 0; c.rally = 0;
    if (why === "coup") { c.regime = "autocracy"; c.elections = false; c.freedom = Math.min(c.freedom, 25); }
    if (why === "revolution") { c.regime = "democracy"; c.elections = true; c.freedom = Math.max(c.freedom, 60); c.nextElection = S.day + c.termDays; }
    if (why === "election") c.nextElection = S.day + c.termDays;
    c.matters = [];
    // a new leader brings his own people
    ROLES.forEach(function (role) { if (rnd(S) < 0.6) c.cab[role] = newMinister(S, role, c); });
    checkOver(S);
  }

  // =========================================================== war
  function neighbours(S, a, b) {
    const M = geo(S.seed, S.nC);
    for (const p of S.p) {
      if (p.ctl !== a) continue;
      for (const q of M.provs[p.id].adj) if (S.p[q].ctl === b) return true;
    }
    return false;
  }
  function reach(S, a, b, noBase) {
    // land border, or a sea lane between them
    const M = geo(S.seed, S.nC);
    for (const p of S.p) {
      if (p.ctl !== a) continue;
      const g = M.provs[p.id];
      for (const q of g.adj) if (S.p[q].ctl === b) return 2;
      for (const q of g.sea) if (S.p[q].ctl === b) return 1;
    }
    // a base in a country next to b is a border with b
    const A = S.c[a];
    if (!noBase && A && A.bases) for (const h of A.bases) if (h !== b && S.c[h] && S.c[h].alive && S.c[h].allies.indexOf(a) >= 0 && reach(S, h, b, true) === 2) return 1;
    // a navy that crosses oceans reaches any coast
    if (A && blueWater(A) && landingFor(S, b) != null) return 1;
    return 0;
  }
  // the real world is wider than a lane: a power with an ocean-going navy
  // (a big enough military budget) can land on any coast it is at war with
  function blueWater(c) { return milBn(c) >= 60 && c.div > 8; }
  function landingFor(S, b) {
    const M = geo();
    let best = null, bc = 0;
    for (const p of S.p) if (p.ctl === b && M.provs[p.id].coast > bc) { bc = M.provs[p.id].coast; best = p.id; }
    return best;
  }
  function occupiedShare(S, c) {
    let own = 0, lost = 0;
    for (const p of S.p) if (p.owner === c.id) { own += p.pop; if (p.ctl !== c.id) lost += p.pop; }
    return own > 0 ? lost / own : 0;
  }
  function strength(c) { return c.div * c.equip * c.supply * c.cab.general.comp; }

  function startWar(S, a, b, why) {
    const A = S.c[a], B = S.c[b];
    if (a === b || A.war.indexOf(b) >= 0 || !A.alive || !B.alive) return false;
    A.war.push(b); B.war.push(a);
    A.posture[b] = A.posture[b] || "attack";
    B.posture[a] = B.posture[a] || "hold";
    // alliances break, trade deals with an enemy end
    A.allies = A.allies.filter(function (x) { return x !== b; }); B.allies = B.allies.filter(function (x) { return x !== a; });
    A.deals = A.deals.filter(function (x) { return x !== b; }); B.deals = B.deals.filter(function (x) { return x !== a; });
    rel(S, a, b, -60);
    A.rally += 6; B.rally += 12;
    if (A.warDays === 0) A.warStart = S.day;
    if (B.warDays === 0) B.warStart = S.day;
    logEv(S, a, "war", { t: b, why: why || "" });
    // the world reacts to an aggressor
    S.c.forEach(function (c) { if (c.id !== a && c.id !== b) rel(S, c.id, a, -8 - (c.allies.indexOf(b) >= 0 ? 25 : 0)); });
    S.fear += 0.04;
    // allies of the defender are called
    B.allies.slice().forEach(function (x) { callToArms(S, x, b, a); });
    return true;
  }
  function callToArms(S, ally, friend, enemy) {
    const c = S.c[ally];
    if (!c.alive || c.war.indexOf(enemy) >= 0 || ally === enemy) return;
    if (c.human != null && !c.out) {
      addMatter(S, c, "callToArms", "general", { friend: friend, enemy: enemy }, [
        { label: "Join the war", act: { type: "war", t: enemy } },
        { label: "Stay out", act: { type: "leaveAlliance", t: friend } },
      ], 20);
      return;
    }
    const join = S.rel[ally][friend] > 35 && S.rel[ally][enemy] < 30 && strength(c) > 1;
    if (join) startWar(S, ally, enemy, "ally");
    else { c.allies = c.allies.filter(function (x) { return x !== friend; }); S.c[friend].allies = S.c[friend].allies.filter(function (x) { return x !== ally; }); rel(S, ally, friend, -30); logEv(S, ally, "abandon", { t: friend }); }
  }
  function makePeace(S, a, b, terms) {
    const A = S.c[a], B = S.c[b];
    A.war = A.war.filter(function (x) { return x !== b; }); B.war = B.war.filter(function (x) { return x !== a; });
    delete A.posture[b]; delete B.posture[a];
    for (const p of S.p) {
      const pair = (p.owner === a && p.ctl === b) || (p.owner === b && p.ctl === a);
      if (!pair) continue;
      if (terms === "white") p.ctl = p.owner;
      else p.owner = p.ctl;                     // the land changes hands
      p.prog = 0; p.by = -1;
    }
    if (!A.war.length) { A.warDays = 0; A.gained = 0; A.lost = 0; }
    if (!B.war.length) { B.warDays = 0; B.gained = 0; B.lost = 0; }
    rel(S, a, b, 25);
    logEv(S, a, "peace", { t: b, terms: terms || "status" });
    checkAlive(S);
  }
  function warDay(S) {
    const M = geo(S.seed, S.nC);
    const C = S.c;
    // contested edges, each counted once
    const edges = [];
    const perC = C.map(function () { return 0; });
    for (const p of S.p) {
      const a = p.ctl;
      if (a < 0 || !C[a].war.length) continue;
      const g = M.provs[p.id];
      const tryEdge = function (q, sea) {
        const b = S.p[q].ctl;
        if (b < 0 || b === a || C[a].war.indexOf(b) < 0) return;
        edges.push({ from: p.id, to: q, a: a, b: b, sea: sea });
        perC[a] += C[a].posture[b] === "attack" ? 2 : 1;
      };
      for (const q of g.adj) tryEdge(q, false);
      for (const q of g.sea) tryEdge(q, true);
    }
    // across an ocean: a landing on the enemy's longest coast, from home
    for (const A of C) {
      if (!A.alive || !A.war.length || !blueWater(A)) continue;
      for (const b of A.war) {
        if (A.posture[b] !== "attack" || edges.some(function (e) { return e.a === A.id && e.b === b; })) continue;
        const q = landingFor(S, b);
        if (q == null || S.p[A.cap].ctl !== A.id) continue;
        edges.push({ from: A.cap, to: q, a: A.id, b: b, sea: true, far: true });
        perC[A.id] += 2;
      }
    }
    const flips = [];
    const pushed = {};
    for (const e of edges) {
      const A = C[e.a], B = C[e.b];
      if (A.posture[e.b] !== "attack") continue;
      const wa = 2 / Math.max(1, perC[e.a]), wb = 1 / Math.max(1, perC[e.b]);
      const atk = Math.max(0.01, strength(A) * wa) * (e.far ? 0.22 : e.sea ? 0.35 : 1) * (1 + A.budget.research * 0.02);
      const dfn = Math.max(0.01, strength(B) * wb) * 1.25 * (1 + B.budget.infra * 0.02) * (S.p[e.to].id === B.cap ? 1.4 : 1) * (1 + occupiedShare(S, B) * 1.5);
      const share = atk / (atk + dfn);
      const tgt = S.p[e.to];
      if (tgt.by !== e.a && tgt.by >= 0 && pushed[e.to]) continue;
      const step = Math.max(0, 4 * share - 1.9);
      if (step > 0) { tgt.prog += step; tgt.by = e.a; pushed[e.to] = 1; }
      // both sides bleed where they meet
      const lossA = 0.0022 * dfn * (0.6 + share), lossB = 0.0022 * atk * (1.4 - share);
      A.div = Math.max(0, A.div - lossA); B.div = Math.max(0, B.div - lossB);
      A.dead += lossA * 9000; B.dead += lossB * 9000;
      if (tgt.prog >= 60) flips.push({ p: e.to, by: e.a });
    }
    for (const f of flips) {
      const p = S.p[f.p];
      if (p.prog < 60) continue;
      const lostBy = p.ctl;
      p.ctl = f.by; p.prog = 0; p.by = -1;
      p.dmg.raw = Math.min(0.9, p.dmg.raw + 0.15); p.dmg.fact = Math.min(0.9, p.dmg.fact + 0.2);
      C[f.by].gained++; C[lostBy].lost++;
      logEv(S, f.by, "took", { p: p.id, from: lostBy });
    }
    // provinces no longer pushed recover their progress
    for (const p of S.p) if (p.prog > 0 && !pushed[p.id]) { p.prog = Math.max(0, p.prog - 0.6); if (!p.prog) p.by = -1; }
    for (const c of C) {
      if (!c.alive) continue;
      if (c.war.length) c.warDays++;
      // capitulation: the capital gone and most of the people under the enemy
      if (c.war.length && S.p[c.cap].ctl !== c.id && occupiedShare(S, c) > 0.55) capitulate(S, c);
    }
  }
  function capitulate(S, c) {
    const taker = S.p[c.cap].ctl;
    logEv(S, c.id, "capitulated", { to: taker });
    c.war.slice().forEach(function (e) { makePeace(S, c.id, e, "status"); });
    fall(S, c, "capitulated");
    checkAlive(S);
  }
  function checkAlive(S) {
    for (const c of S.c) {
      if (!c.alive) continue;
      const any = S.p.some(function (p) { return p.owner === c.id; });
      if (!any) {
        c.alive = false;
        c.war.slice().forEach(function (e) { S.c[e].war = S.c[e].war.filter(function (x) { return x !== c.id; }); });
        c.war = [];
        if (c.leader.original || c.human != null) S.fallen.push({ c: c.id, name: c.leader.name, why: "annexed", day: S.day, original: !!c.leader.original });
        if (c.human != null && !c.out) { c.out = "annexed"; c.humanLost = S.day; }
        c.leader.original = false;
        logEv(S, c.id, "gone", {});
      } else if (S.p[c.cap].owner !== c.id) {
        // a new capital: the biggest city still held
        let best = null; for (const p of S.p) if (p.owner === c.id && (!best || p.pop > best.pop)) best = p;
        if (best) { c.cap = best.id; c.capital = best.name; }
      }
    }
    checkOver(S);
  }

  // ======================================================== strikes
  function airStrike(S, c, t, pid, what) {
    const T = S.c[t], p = S.p[pid];
    // NOTHING IS GATED: no air force means cruise missiles bought today, on
    // the budget (and the bonds); the odds are what change, never the button
    let wing = Math.min(Math.floor(c.planes), 24), missiles = 0;
    if (wing < 4) { missiles = 4 - wing; c.debt += missiles * 1.5; }
    if (c.war.indexOf(t) < 0) startWar(S, c.id, t, "strike");
    let lost = 0;
    const intercept = clamp(T.md * 0.55 + T.planes / Math.max(1, T.planes + wing * 6) * 0.15, 0, 0.85);
    for (let i = 0; i < wing; i++) if (rnd(S) < intercept) lost++;
    let mHit = 0;
    for (let i = 0; i < missiles; i++) if (rnd(S) >= intercept * 1.2) mHit++;
    const hit = wing - lost + mHit * 0.6;
    c.planes = Math.max(0, c.planes - lost);
    const dmg = clamp(hit * 0.026 * (0.8 + c.budget.research * 0.08), 0, 0.95);
    if (what === "oil" || what === "raw") p.dmg.raw = clamp(p.dmg.raw + dmg, 0, 0.97);
    else if (what === "factories") p.dmg.fact = clamp(p.dmg.fact + dmg, 0, 0.97);
    else if (what === "power") p.dmg.power = clamp(p.dmg.power + dmg, 0, 0.97);
    else if (what === "city") {
      p.dmg.city = clamp(p.dmg.city + dmg * 0.6, 0, 0.9);
      const killed = p.pop * dmg * 0.004; p.pop = Math.max(0.05, p.pop - killed);
      T.rally += 8; T.dead += killed * 1e6;
      S.c.forEach(function (o) { if (o.id !== c.id && o.id !== t) rel(S, o.id, c.id, -6); });
      if (c.regime === "democracy") c.approval -= 3;
    }
    if (what !== "city") S.fear += 0.01;
    logEv(S, c.id, "strike", { t: t, p: pid, what: what, lost: lost, wing: wing + missiles, hit: Math.round(hit) });
    return { ok: true, lost: lost, hit: hit };
  }
  function nuke(S, c, t, pid, answer) {
    const T = S.c[t], p = S.p[pid];
    // no stockpile: a crude device, bought and smuggled; it may fizzle, and
    // everybody will know where it came from
    const crude = c.nukes < 1;
    if (crude) { c.debt += 20; c.heat.plot += 20; }
    else c.nukes--;
    if (c.war.indexOf(t) < 0) startWar(S, c.id, t, "nuke");
    const stopped = rnd(S) < T.md * (crude ? 0.5 : 0.35) || (crude && rnd(S) < 0.4);
    logEv(S, c.id, "nuke", { t: t, p: pid, stopped: stopped, crude: crude });
    S.fear = Math.min(2.5, S.fear + 0.6);
    worldReacts(S, c, "nuke");
    if (stopped) return { ok: true, stopped: true };
    const yieldF = crude ? 0.5 : 1;
    const killed = p.pop * 0.35 * yieldF;
    p.pop = Math.max(0.05, p.pop - killed); p.dmg.nuke = 0.95 * yieldF; p.dmg.raw = Math.max(p.dmg.raw, 0.95 * yieldF); p.dmg.fact = Math.max(p.dmg.fact, 0.95 * yieldF);
    T.dead += killed * 1e6; T.div *= 0.85;
    S.fallout = Math.min(1, S.fallout + 0.25);
    S.c.forEach(function (o) { if (o.alive) o.approval -= 4; });
    // the answer, if the target can give one
    // an answer is never itself answered here: the next exchange is a day's decision
    if (!answer && T.nukes > 0 && T.human == null && rnd(S) < 0.85) {
      const tg = biggestCity(S, c.id);
      if (tg != null) nuke(S, T, c.id, tg, true);
    }
    return { ok: true, stopped: false };
  }
  function worldReacts(S, c, what) {
    S.c.forEach(function (o) {
      if (o.id === c.id || !o.alive) return;
      rel(S, o.id, c.id, what === "nuke" ? -80 : -25);
      if (o.freedom > 60 && o.sanctions.indexOf(c.id) < 0 && o.human == null) { o.sanctions.push(c.id); logEv(S, o.id, "sanction", { t: c.id }); }
      o.allies = o.allies.filter(function (x) { return x !== c.id; });
      c.allies = c.allies.filter(function (x) { return x !== o.id; });
    });
  }
  /* A plot found out: the victim's friends turn on you, everybody else
     trusts you less, the country hears it on Holler. If you were already
     the world's problem, the world may decide to deal with you. */
  function plotFound(S, c, T) {
    rel(S, c.id, T.id, -70);
    c.heat.plot += 40; c.scandal += 8;
    S.c.forEach(function (o) {
      if (o.id === c.id || o.id === T.id || !o.alive) return;
      const friend = S.rel[o.id][T.id] > 30 || o.allies.indexOf(T.id) >= 0;
      rel(S, o.id, c.id, friend ? -45 : -15);
      if (friend) { o.allies = o.allies.filter(function (x) { return x !== c.id; }); c.allies = c.allies.filter(function (x) { return x !== o.id; }); }
      if (friend && o.human == null && o.freedom > 50 && o.sanctions.indexOf(c.id) < 0) { o.sanctions.push(c.id); logEv(S, o.id, "sanction", { t: c.id }); }
    });
    if (T.human == null && rnd(S) < 0.5) startWar(S, T.id, c.id, "plot");
    // the gang-up: the countries that hate you most, together
    let sum = 0, n = 0; S.c.forEach(function (o) { if (o.id !== c.id && o.alive) { sum += S.rel[o.id][c.id]; n++; } });
    if (n && sum / n < -30) {
      const foes = S.c.filter(function (o) { return o.alive && o.id !== c.id && o.human == null && S.rel[o.id][c.id] < -50 && reach(S, o.id, c.id) > 0; }).slice(0, 3);
      if (foes.length >= 2) { foes.forEach(function (o) { if (o.war.indexOf(c.id) < 0) startWar(S, o.id, c.id, "coalition"); }); logEv(S, c.id, "coalition", { n: foes.length }); }
    }
  }
  /* A bailout: the lender borrows it on its own bond market, the borrower
     swaps market debt for a cheap official loan, and the strings are real. */
  function bailout(S, L, B, amt, strings) {
    L.debt += amt;
    B.debt = Math.max(0, B.debt - amt);
    B.loans.push({ from: L.id, amt: amt, rate: 2, day: S.day, strings: strings || "none" });
    B.patron = L.id;
    if (B.crisis) B.crisis = 0;
    B.yld = Math.max(1, B.yld - 2);
    rel(S, L.id, B.id, 25);
    if (strings === "alliance" || strings === "bases") {
      if (L.allies.indexOf(B.id) < 0) L.allies.push(B.id);
      if (B.allies.indexOf(L.id) < 0) B.allies.push(L.id);
    }
    if (strings === "bases") { (L.bases || (L.bases = [])).push(B.id); B.approval -= 3; B.heat.pride = Math.max(0, B.heat.pride - 5); }
    if (strings === "trade") {
      if (L.deals.indexOf(B.id) < 0) L.deals.push(B.id);
      if (B.deals.indexOf(L.id) < 0) B.deals.push(L.id);
      delete B.tariffs[L.id];
    }
    logEv(S, L.id, "bailout", { t: B.id, amt: Math.round(amt), strings: strings || "none" });
    return { ok: true };
  }
  function biggestCity(S, cid) {
    let best = null; for (const p of S.p) if (p.ctl === cid && p.dmg.nuke < 0.5 && (!best || p.pop > best.pop)) best = p;
    return best ? best.id : null;
  }

  // =========================================================== people
  /* Every president has five people, and every order runs through one of
     them. They can refuse. They remember. They leak, quit and turn. */
  function obey(S, c, role, weight) {
    const m = c.cab[role];
    let p = m.loyalty / 100 * 0.75 + 0.35 - weight;
    if (role === "general") p += (m.hawk - 0.5) * 0.4 * (weight > 0.2 ? 1 : 0);
    if (c.approval < 30) p -= 0.1;
    const yes = rnd(S) < clamp(p, 0.05, 0.99);
    if (!yes) { m.loyalty -= 4; logEv(S, c.id, "refused", { role: role }); }
    else if (weight > 0.3) m.loyalty -= weight * 6 * (1 - m.hawk);
    return yes;
  }
  function peopleDay(S, c) {
    ROLES.forEach(function (role) {
      const m = c.cab[role];
      let target = 45 + (c.approval - 50) * 0.5 + m.mood;
      if (role === "general") target += (c.budget.military - 2.2) * 6 + (c.war.length ? (m.hawk - 0.4) * 15 : 0) - Math.max(0, c.armyPower - 40) * 0.35;
      if (role === "security") target += (c.budget.security - 1.4) * 6;
      if (role === "treasury") target -= Math.max(0, c.yld - 6) * 3 + (c.crisis ? 15 : 0);
      if (role === "bank") target -= (c.rateHold > 0 ? 18 : 0) + c.print * 3 * c.cbIndep;
      if (role === "trade") target -= c.sanctions.length * 2;
      m.loyalty += (clamp(target, 0, 100) - m.loyalty) * 0.006;
      m.loyalty = clamp(fin(m.loyalty, 50), 0, 100);
      m.mood *= 0.995;
      // a leak: the scandal is real, the timing is his
      if (m.loyalty < 30 && rnd(S) < 0.0025 * (30 - m.loyalty) / 30) {
        c.scandal += 3 + rnd(S) * 5; logEv(S, c.id, "leak", { role: role, name: m.name });
      }
      // he quits
      if (m.loyalty < 12 && rnd(S) < 0.01) {
        logEv(S, c.id, "resigned", { role: role, name: m.name });
        c.scandal += 2; c.cab[role] = newMinister(S, role, c); c.cab[role].loyalty = 50;
      }
    });
    // the Security Chief who wants your chair sends a man through the door
    const sc = c.cab.security;
    if (sc.loyalty < 18 && sc.ambition > 0.55 && rnd(S) < 0.0015) {
      if (c.human != null && !c.out) {
        if (!c.matters.some(function (m) { return m.kind === "traitor"; })) addMatter(S, c, "traitor", "security", { name: sc.name }, [
          { label: "Sign it", act: { type: "resign" } },
          { label: "Refuse", act: { type: "defy" }, fatal: 1 },
        ], 2, true);
      } else if (rnd(S) < 0.4 - c.budget.security * 0.05) fall(S, c, "assassinated");
    }
  }

  // ============================================================ matters
  /* What reaches a human president's desk. A matter names who brings it,
     the facts it is about, and the decisions on offer: each decision is an
     action, so answering one is applying it. Only humans get matters; AI
     presidents decide the same questions in ai.js through the same apply. */
  function addMatter(S, c, kind, from, data, opts, days, critical) {
    if (c.human == null || c.out) return null;
    const m = { id: S.nextId++, kind: kind, from: from, data: data || {}, opts: opts, day: S.day, expires: S.day + (days || 30), critical: !!critical };
    c.matters.push(m);
    if (c.matters.length > 12) c.matters.shift();
    return m;
  }
  function mattersDay(S, c) {
    if (c.human == null || c.out) return;
    // expiry: ignoring a matter is an answer
    c.matters = c.matters.filter(function (m) {
      if (S.day <= m.expires) return true;
      if (m.kind === "coup" || m.kind === "traitor" || m.kind === "hit") { fall(S, c, m.kind === "coup" ? "coup" : "assassinated"); return false; }
      if (m.kind === "bill") { /* unsigned: it dies */ logEv(S, c.id, "billDied", { name: m.data.name }); }
      const who = c.cab[m.from]; if (who) who.loyalty -= 2;
      return false;
    });
    if (c.out) return;
    const has = function (k) { return c.matters.some(function (m) { return m.kind === k; }); };
    const memo = c.memo;
    const due = function (k, gap) { if ((memo["m_" + k] || -1e9) + gap > S.day) return false; memo["m_" + k] = S.day; return true; };
    // the legislature sends bills (democracies and hybrids)
    if (c.regime !== "autocracy" && !has("bill") && due("bill", 50)) {
      const b = billFor(S, c);
      if (b) addMatter(S, c, "bill", "treasury", b, [
        { label: "Sign", act: { type: "bill", sign: 1 } },
        { label: "Veto", act: { type: "bill", sign: 0 } },
      ], 40);
    }
    // the bond market
    if ((c.yld > 7 || c.crisis) && !has("yields") && due("yields", 60)) {
      const opts = [
        { label: "Cut welfare 2%", act: { type: "budget", k: "welfare", v: Math.max(0, c.budget.welfare - 2) } },
        { label: "Raise taxes 3 pts", act: { type: "tax", v: Math.min(60, c.tax + 3) } },
      ];
      if (c.crisis) opts.push({ label: "Default", act: { type: "default" } });
      addMatter(S, c, "yields", "treasury", { y: +c.yld.toFixed(1), crisis: c.crisis > 0, debt: +(debtRatio(c) * 100).toFixed(0) }, opts, 30);
    }
    // the central bank wants to move
    const taylor = 1 + c.infl + 0.5 * (c.infl - 2) + 50 * c.gap;
    if (Math.abs(taylor - c.rate) > 2.5 && c.rateHold <= 0 && !has("rates") && due("rates", 90)) {
      const up = taylor > c.rate;
      addMatter(S, c, "rates", "bank", { up: up, infl: +c.infl.toFixed(1), rate: +c.rate.toFixed(2) }, [
        { label: up ? "Let him raise" : "Let him cut", act: { type: "rate", v: +(c.rate + (up ? 1.5 : -1.5)).toFixed(2), free: 1 } },
        { label: up ? "Hold rates" : "Keep them high", act: { type: "rate", v: +c.rate.toFixed(2) } },
      ], 20);
    }
    // someone tariffed us
    for (const o of S.c) {
      if (o.id === c.id || !o.alive) continue;
      const t = o.tariffs[c.id];
      const k = "tar" + o.id;
      if (t && Object.keys(t).some(function (g) { return t[g] > 0; }) && !memo[k] && !has("tariffed")) {
        memo[k] = S.day;
        const g = Object.keys(t).filter(function (x) { return t[x] > 0; })[0];
        addMatter(S, c, "tariffed", "trade", { t: o.id, good: g, rate: t[g] }, [
          { label: "Tariff them back", act: { type: "tariff", t: o.id, good: topImport(S, c, o.id), v: Math.max(0.25, t[g]) } },
          { label: "Offer a deal", act: { type: "deal", t: o.id } },
          { label: "Let it go", act: { type: "noop" } },
        ], 30);
      }
      if (!t || !Object.keys(t).some(function (g) { return t[g] > 0; })) delete memo[k];
    }
    // the General sees an opening
    if (!c.war.length && !has("opening") && due("opening", 120)) {
      let best = -1, bs = 0;
      for (const o of S.c) {
        if (o.id === c.id || !o.alive || c.allies.indexOf(o.id) >= 0) continue;
        if (reach(S, c.id, o.id) < 2) continue;
        const ratio = strength(c) / Math.max(0.1, strength(o));
        if (ratio > 1.8 && S.rel[c.id][o.id] < 10 && ratio > bs) { bs = ratio; best = o.id; }
      }
      if (best >= 0 && c.cab.general.hawk > 0.35) addMatter(S, c, "opening", "general", { t: best, ratio: +bs.toFixed(1) }, [
        { label: "Invade", act: { type: "war", t: best } },
        { label: "Not now", act: { type: "noop" } },
      ], 25);
    }
    // at war: the General picks a target worth hitting
    if (c.war.length && c.planes >= 4 && !has("target") && due("target", 45)) {
      const e = c.war[0];
      const tgt = bestTarget(S, e);
      if (tgt) addMatter(S, c, "target", "general", { t: e, p: tgt.p, what: tgt.what }, [
        { label: "Strike it", act: { type: "strike", t: e, p: tgt.p, what: tgt.what } },
        { label: "Hold the planes", act: { type: "noop" } },
      ], 15);
    }
    // the street
    if (c.unrest > 45 && !has("unrest") && due("unrest", 70)) {
      addMatter(S, c, "unrest", "security", { u: Math.round(c.unrest), city: S.p[c.cap].name }, [
        { label: "Crack down", act: { type: "crackdown" } },
        { label: "Let them march", act: { type: "noop" } },
        { label: "Raise welfare 2%", act: { type: "budget", k: "welfare", v: c.budget.welfare + 2 } },
      ], 20);
    }
    // the polls before an election
    if (c.elections && c.nextElection - S.day < 120 && c.nextElection - S.day > 20 && voteShare(S, c) < 50 && !has("polls") && due("polls", 200)) {
      addMatter(S, c, "polls", "security", { share: +voteShare(S, c).toFixed(0), days: c.nextElection - S.day }, [
        { label: "Postpone the election", act: { type: "postpone" } },
        { label: "Let it run", act: { type: "noop" } },
      ], 20);
    }
    // a government in trouble asks you for money
    if (c.yld < 6 && !c.crisis && !has("bailoutAsk") && due("bailoutAsk", 150)) {
      for (const o of S.c) {
        if (o.id === c.id || !o.alive || o.human != null || !(o.crisis || o.yld > 10)) continue;
        if (o.gdp > c.gdp * 0.7 || c.war.indexOf(o.id) >= 0) continue;
        if (o.loans.some(function (l) { return l.from === c.id; })) continue;
        const amt = Math.round(o.gdp * 0.12);
        addMatter(S, c, "bailoutAsk", "leader:" + o.id, { t: o.id, amt: amt, y: +o.yld.toFixed(1) }, [
          { label: "Lend for an alliance", act: { type: "bailout", t: o.id, amt: amt, strings: "alliance" } },
          { label: "Lend for bases", act: { type: "bailout", t: o.id, amt: amt, strings: "bases" } },
          { label: "Refuse", act: { type: "noop" } },
        ], 25);
        break;
      }
    }
    // the General is the danger
    if (c.cab.general.loyalty < 28 && c.cab.general.ambition > 0.5 && !has("warning") && due("warning", 150)) {
      addMatter(S, c, "warning", "security", { name: c.cab.general.name }, [
        { label: "Fire the General", act: { type: "fire", role: "general" } },
        { label: "Raise his budget", act: { type: "budget", k: "military", v: c.budget.military + 1 } },
        { label: "Ignore it", act: { type: "noop" } },
      ], 25);
    }
  }
  function topImport(S, c, from) {
    let best = "steel", bv = -1;
    for (let g = 0; g < NG; g++) { const v = S.flow ? S.flow[g][c.id][from] * S.P[g] : 0; if (v > bv) { bv = v; best = GOODS[g].id; } }
    return best;
  }
  function bestTarget(S, e) {
    let best = null, bv = 0;
    for (const p of S.p) {
      if (p.ctl !== e) continue;
      let raw = 0; for (const k in p.fac) raw += p.fac[k] * S.yield[GI[k]] * S.P[GI[k]];
      raw *= 1 - p.dmg.raw;
      let fac = 0; for (const k in p.fact) fac += p.fact[k] * S.P[GI[k]] * 0.3;
      fac *= 1 - p.dmg.fact;
      if (raw > bv) { bv = raw; best = { p: p.id, what: "oil" }; }
      if (fac > bv) { bv = fac; best = { p: p.id, what: "factories" }; }
    }
    return best;
  }
  const BILLS = [
    { id: "taxcut", name: "Tax Relief Act", fx: { tax: -3 }, pop: 8 },
    { id: "infra", name: "National Infrastructure Act", fx: { infra: 1 }, pop: 5 },
    { id: "defense", name: "Defense Authorization Act", fx: { military: 0.8 }, pop: 0 },
    { id: "care", name: "Health Security Act", fx: { welfare: 1.5 }, pop: 6 },
    { id: "police", name: "Public Order Act", fx: { security: 0.8, freedom: -4 }, pop: -2 },
    { id: "science", name: "Research Futures Act", fx: { research: 0.6 }, pop: 2 },
    { id: "austerity", name: "Balanced Budget Act", fx: { welfare: -2, infra: -0.5 }, pop: -6 },
    { id: "press", name: "Open Press Act", fx: { freedom: 6, security: -0.3 }, pop: 3 },
    { id: "shield", name: "Missile Shield Act", fx: { missile: 0.5 }, pop: 1 },
    { id: "plants", name: "Industrial Renewal Act", fx: { industry: 0.8 }, pop: 3 },
    { id: "taxup", name: "Revenue Act", fx: { tax: 3 }, pop: -7 },
  ];
  function billFor(S, c) {
    const b = BILLS[Math.floor(rnd(S) * BILLS.length)];
    const yes = Math.round(clamp(45 + b.pop + (c.approval - 50) * 0.4 + (rnd(S) - 0.5) * 30, 20, 85));
    return { bill: b.id, name: b.name, fx: b.fx, pop: b.pop, yes: yes, no: 100 - yes };
  }

  // ============================================================ actions
  /* apply(S, a) is the ONLY way the world changes. a.c is the country
     acting. Humans' actions come through the network with a.c set by the
     host from the seat; AI presidents call it directly. */
  function rel(S, a, b, d) {
    if (a === b) return;
    const v = clamp(S.rel[a][b] + d, -100, 100);
    S.rel[a][b] = S.rel[b][a] = v;
  }
  function apply(S, a) {
    if (!a || typeof a.type !== "string") return { ok: false, why: "bad" };
    const c = S.c[a.c | 0];
    if (!c || !c.alive) return { ok: false, why: "nobody" };
    if (c.human != null && c.out && a.type !== "seat") return { ok: false, why: "out" };
    const T = a.t != null ? S.c[a.t | 0] : null;
    if (a.t != null && (!T || T.id === c.id)) return { ok: false, why: "target" };
    switch (a.type) {
      case "noop": return { ok: true };
      case "budget": {
        if (!c.budget.hasOwnProperty(a.k)) return { ok: false, why: "key" };
        const v = clamp(+a.v || 0, 0, a.k === "welfare" ? 30 : 15);
        const was = c.budget[a.k];
        c.budget[a.k] = +v.toFixed(2);
        if (a.k === "welfare") c.approval += (v - was) * 0.6;
        if (a.k === "military") c.cab.general.mood += (v - was) * 3;
        if (a.k === "security") c.cab.security.mood += (v - was) * 3;
        return { ok: true };
      }
      case "tax": {
        const v = clamp(Math.round(+a.v || 0), 5, 60);
        c.approval -= (v - c.tax) * 0.7;
        c.tax = v; return { ok: true };
      }
      case "rate": {
        const v = clamp(+a.v || 0, 0, 40);
        if (!a.free) {
          // overruling the bank: he may not take it, the market notices
          if (!obey(S, c, "bank", 0.25)) return { ok: false, why: "refused", role: "bank" };
          c.rateHold = 180; c.yld += 0.4; c.cbIndep = Math.max(0, c.cbIndep - 0.08);
        }
        c.rate = v; return { ok: true };
      }
      case "tariff": {
        if (!T) return { ok: false, why: "target" };
        const g = a.good === "all" || GI[a.good] != null ? a.good : null;
        if (!g) return { ok: false, why: "good" };
        const v = clamp(+a.v || 0, 0, 2);
        const tt = c.tariffs[T.id] || (c.tariffs[T.id] = {});
        const was = tt[g] || 0;
        if (g === "all") { for (const k in tt) delete tt[k]; }
        tt[g] = v;
        if (!Object.keys(tt).some(function (k) { return tt[k] > 0; })) delete c.tariffs[T.id];
        rel(S, c.id, T.id, -(v - was) * 30);
        if (v > was) { c.deals = c.deals.filter(function (x) { return x !== T.id; }); T.deals = T.deals.filter(function (x) { return x !== c.id; }); }
        logEv(S, c.id, "tariff", { t: T.id, good: g, v: v });
        return { ok: true };
      }
      case "sanction": {
        if (!T) return { ok: false, why: "target" };
        const on = a.on !== 0 && a.on !== false;
        const i = c.sanctions.indexOf(T.id);
        if (on && i < 0) { c.sanctions.push(T.id); rel(S, c.id, T.id, -30); c.deals = c.deals.filter(function (x) { return x !== T.id; }); T.deals = T.deals.filter(function (x) { return x !== c.id; }); logEv(S, c.id, "sanction", { t: T.id }); }
        if (!on && i >= 0) { c.sanctions.splice(i, 1); rel(S, c.id, T.id, 10); logEv(S, c.id, "unsanction", { t: T.id }); }
        return { ok: true };
      }
      case "embargo": {
        if (!T) return { ok: false, why: "target" };
        const list = c.embargo[T.id] || (c.embargo[T.id] = []);
        const g = a.good;
        if (GI[g] == null && g !== "all") return { ok: false, why: "good" };
        const i = list.indexOf(g);
        if (a.on === 0) { if (i >= 0) list.splice(i, 1); if (!list.length) delete c.embargo[T.id]; }
        else if (i < 0) { list.push(g); rel(S, c.id, T.id, -15); logEv(S, c.id, "embargo", { t: T.id, good: g }); }
        return { ok: true };
      }
      case "deal": case "alliance": case "peace": {
        if (!T) return { ok: false, why: "target" };
        const kind = a.type;
        if (kind === "deal" && c.deals.indexOf(T.id) >= 0) return { ok: false, why: "have" };
        if (kind === "alliance" && c.allies.indexOf(T.id) >= 0) return { ok: false, why: "have" };
        if (kind === "peace" && c.war.indexOf(T.id) < 0) return { ok: false, why: "nowar" };
        if (kind !== "peace" && c.war.indexOf(T.id) >= 0) return { ok: false, why: "war" };
        // a human on the other end decides; an AI answers now
        if (T.human != null && !T.out) {
          addMatter(S, T, "offer", kind === "deal" ? "trade" : kind === "peace" ? "general" : "security", { kind: kind, t: c.id, terms: a.terms || "white" }, [
            { label: "Accept", act: { type: "accept", t: c.id, kind: kind, terms: a.terms || "white" } },
            { label: "Refuse", act: { type: "refuseOffer", t: c.id, kind: kind } },
          ], 20);
          logEv(S, c.id, "offered", { t: T.id, kind: kind });
          return { ok: true, pending: true };
        }
        const yes = CBZ.presWorld.ai && CBZ.presWorld.ai.accepts ? CBZ.presWorld.ai.accepts(S, T, c, kind, a.terms) : S.rel[T.id][c.id] > 20;
        if (!yes) { logEv(S, T.id, "refusedOffer", { t: c.id, kind: kind }); rel(S, c.id, T.id, -3); return { ok: false, why: "no" }; }
        return accept(S, T, c, kind, a.terms);
      }
      case "accept": {
        if (!T) return { ok: false, why: "target" };
        return accept(S, c, T, a.kind, a.terms);
      }
      case "refuseOffer": { if (T) { rel(S, c.id, T.id, -5); logEv(S, c.id, "refusedOffer", { t: T.id, kind: a.kind }); } return { ok: true }; }
      case "leaveAlliance": {
        if (!T) return { ok: false, why: "target" };
        c.allies = c.allies.filter(function (x) { return x !== T.id; }); T.allies = T.allies.filter(function (x) { return x !== c.id; });
        rel(S, c.id, T.id, -25); logEv(S, c.id, "abandon", { t: T.id });
        return { ok: true };
      }
      case "war": {
        if (!T) return { ok: false, why: "target" };
        if (c.war.indexOf(T.id) >= 0) { c.posture[T.id] = "attack"; return { ok: true }; }
        if (!obey(S, c, "general", c.allies.indexOf(T.id) >= 0 ? 0.45 : 0.12)) return { ok: false, why: "refused", role: "general" };
        startWar(S, c.id, T.id, "declared");
        c.posture[T.id] = "attack";
        return { ok: true };
      }
      case "posture": {
        if (!T || c.war.indexOf(T.id) < 0) return { ok: false, why: "nowar" };
        c.posture[T.id] = a.v === "attack" ? "attack" : "hold"; return { ok: true };
      }
      case "strike": {
        if (!T) return { ok: false, why: "target" };
        const p = S.p[a.p | 0];
        if (!p || p.ctl !== T.id) return { ok: false, why: "where" };
        if (c.war.indexOf(T.id) < 0 && !obey(S, c, "general", 0.15)) return { ok: false, why: "refused", role: "general" };
        return airStrike(S, c, T.id, p.id, a.what || "oil");
      }
      case "nuke": {
        if (!T) return { ok: false, why: "target" };
        const p = S.p[a.p != null ? a.p | 0 : biggestCity(S, T.id)];
        if (!p || p.ctl !== T.id) return { ok: false, why: "where" };
        if (!obey(S, c, "general", 0.42)) return { ok: false, why: "refused", role: "general" };
        return nuke(S, c, T.id, p.id);
      }
      case "assassinate": {
        if (!T) return { ok: false, why: "target" };
        if (!obey(S, c, "security", 0.3)) return { ok: false, why: "refused", role: "security" };
        const mine = c.budget.security * c.gdp, theirs = T.budget.security * T.gdp;
        const p = clamp(0.12 + 0.55 * mine / (mine + theirs * 1.6), 0.05, 0.7);
        // A HUMAN TARGET IS NOT A ROLL: the men come for him in his own
        // building (city/president_storm.js) and the fight answers ("storm").
        // A page with no building lets the clock run out, and he falls.
        if (T.human != null && !T.out) {
          if (!T.matters.some(function (m) { return m.kind === "hit"; })) addMatter(S, T, "hit", "security", { by: c.id }, [{ label: "Run", act: { type: "noop" } }], 4, true);
          logEv(S, c.id, "sent", { t: T.id });
          return { ok: true, sent: true };
        }
        const hit = rnd(S) < p;
        const caught = rnd(S) < (hit ? 0.35 : 0.65);
        logEv(S, c.id, hit ? "killed" : "plotFailed", { t: T.id, name: T.leader.name, caught: caught });
        if (caught) plotFound(S, c, T);
        if (hit) fall(S, T, "assassinated");
        return { ok: true, hit: hit, caught: caught };
      }
      case "nukeProgram": {
        if (c.nukeProg > 0) return { ok: false, why: "have" };
        c.nukeProg = 1; logEv(S, c.id, "program", {});
        S.c.forEach(function (o) { if (o.id !== c.id && o.freedom > 60) rel(S, o.id, c.id, -20); });
        return { ok: true };
      }
      case "crackdown": {
        // thin police means it is the army on the street
        if (c.budget.security < 2) { c.armyPower += 8; logEv(S, c.id, "troops", {}); }
        c.heat.crackdown += 14;
        c.unrest = Math.max(0, c.unrest - 25); c.anger += 12; c.freedom = Math.max(0, c.freedom - 6);
        c.approval -= c.regime === "democracy" ? 5 : 1;
        c.cab.security.mood += 4;
        S.c.forEach(function (o) { if (o.id !== c.id && o.freedom > 65) rel(S, o.id, c.id, -6); });
        logEv(S, c.id, "crackdown", {});
        return { ok: true };
      }
      case "freePress": {
        c.freedom = Math.min(100, c.freedom + 8); c.budget.security = Math.max(0, c.budget.security - 0.3); c.cab.security.mood -= 4;
        S.c.forEach(function (o) { if (o.id !== c.id && o.freedom > 65) rel(S, o.id, c.id, 5); });
        logEv(S, c.id, "freePress", {});
        return { ok: true };
      }
      case "postpone": {
        if (!c.elections) return { ok: false, why: "none" };
        c.nextElection += 365; c.freedom = Math.max(0, c.freedom - 15); c.unrest += 15; c.anger += 8; c.heat.crackdown += 12;
        if (c.regime === "democracy") c.regime = "hybrid";
        S.c.forEach(function (o) {
          if (o.id === c.id || o.freedom < 60) return;
          rel(S, o.id, c.id, -18);
          if (o.human == null && c.freedom < 40 && o.sanctions.indexOf(c.id) < 0 && rnd(S) < 0.5) { o.sanctions.push(c.id); logEv(S, o.id, "sanction", { t: c.id }); }
        });
        logEv(S, c.id, "postponed", {});
        return { ok: true };
      }
      case "cancelElections": {
        if (!c.elections) return { ok: false, why: "none" };
        c.elections = false; c.nextElection = 0; c.regime = "autocracy"; c.freedom = Math.max(0, c.freedom - 35); c.unrest += 25; c.anger += 20;
        c.armyPower += 15; c.heat.crackdown += 25;
        S.c.forEach(function (o) {
          if (o.id === c.id || o.freedom < 60) return;
          rel(S, o.id, c.id, -35);
          if (o.human == null && o.sanctions.indexOf(c.id) < 0) { o.sanctions.push(c.id); logEv(S, o.id, "sanction", { t: c.id }); }
        });
        logEv(S, c.id, "cancelled", {});
        return { ok: true };
      }
      case "restoreElections": {
        if (c.elections) return { ok: false, why: "have" };
        c.elections = true; c.regime = "hybrid"; c.nextElection = S.day + 365; c.freedom = Math.min(100, c.freedom + 20); c.anger = Math.max(0, c.anger - 15);
        S.c.forEach(function (o) { if (o.id !== c.id && o.freedom > 60) rel(S, o.id, c.id, 15); });
        logEv(S, c.id, "restored", {});
        return { ok: true };
      }
      case "martial": {
        const on = a.on !== 0 && a.on !== false;
        if (on && !c.martial) {
          if (!obey(S, c, "general", 0.2)) return { ok: false, why: "refused", role: "general" };
          c.martial = 1; c.unrest = Math.min(c.unrest, 30); c.freedom = Math.max(0, c.freedom - 20); c.armyPower += 30; c.anger += 15;
          c.heat.crackdown += 25; c.cab.general.mood += 6;
          S.c.forEach(function (o) { if (o.id !== c.id && o.freedom > 60) rel(S, o.id, c.id, -20); });
          logEv(S, c.id, "martial", { on: 1 });
        } else if (!on && c.martial) {
          c.martial = 0; c.cab.general.mood -= 6; c.freedom = Math.min(100, c.freedom + 5);
          logEv(S, c.id, "martial", { on: 0 });
        }
        return { ok: true };
      }
      case "print": {
        const v = clamp(+a.v || 0, 0, 25);
        const was = c.print;
        c.print = +v.toFixed(1);
        if (v > was) { c.cab.bank.loyalty -= (v - was) * 2 * c.cbIndep; c.cab.treasury.mood -= (v - was); }
        logEv(S, c.id, "print", { v: c.print });
        return { ok: true };
      }
      case "post": {
        // a post IS the act (Holler): what it does depends on the moment
        const H = c.heat, v = a.v;
        const credible = c.approval > 35 && H.scandal < 20;
        if (v === "calm") { if (credible) { H.prices *= 0.7; H.war *= 0.8; c.unrest = Math.max(0, c.unrest - 3); } else H.scandal += 2; }
        else if (v === "blame") { if (!T) return { ok: false, why: "target" }; H.prices *= 0.6; H.pride += 4; rel(S, c.id, T.id, -12); }
        else if (v === "threaten") { if (!T) return { ok: false, why: "target" }; rel(S, c.id, T.id, -20); c.rally += 3; H.pride += 5; S.fear += 0.01; }
        else if (v === "promise") { if (c.promise) return { ok: false, why: "have" }; c.approval += 3; c.promise = { day: S.day, due: S.day + 120, infl: c.infl }; }
        else if (v === "deny") {
          if (rnd(S) < 0.3 + c.budget.security * 0.08) { H.scandal *= 0.5; H.plot *= 0.6; c.scandal *= 0.7; }
          else { H.scandal *= 1.3; H.plot *= 1.3; H.scandal += 3; }
        }
        else if (v === "enemies") { c.freedom = Math.max(0, c.freedom - 3); H.crackdown += 5; c.approval += 1; S.c.forEach(function (o) { if (o.id !== c.id && o.freedom > 60) rel(S, o.id, c.id, -5); }); }
        else if (v === "victory") { if (c.gained > c.lost) H.pride += 6; else { H.scandal += 5; c.scandal += 2; } }
        else return { ok: false, why: "verb" };
        logEv(S, c.id, "post", { v: v, t: T ? T.id : null });
        return { ok: true };
      }
      case "bailout": {
        // lend a government money, with strings; it comes off your own bonds
        if (!T) return { ok: false, why: "target" };
        const amt = clamp(+a.amt || T.gdp * 0.1, 1, Math.max(c.gdp, T.gdp) * 0.6);
        const strings = a.strings === "alliance" || a.strings === "bases" || a.strings === "trade" ? a.strings : "none";
        if (T.human != null && !T.out) {
          addMatter(S, T, "bailoutOffer", "leader:" + c.id, { t: c.id, amt: Math.round(amt), strings: strings }, [
            { label: "Take the money", act: { type: "acceptBailout", t: c.id, amt: amt, strings: strings } },
            { label: "Refuse", act: { type: "refuseOffer", t: c.id, kind: "bailout" } },
          ], 20);
          logEv(S, c.id, "offered", { t: T.id, kind: "bailout" });
          return { ok: true, pending: true };
        }
        const yes = CBZ.presWorld.ai && CBZ.presWorld.ai.takesBailout ? CBZ.presWorld.ai.takesBailout(S, T, c, amt, strings) : (T.yld > 7 || T.crisis > 0);
        if (!yes) { logEv(S, T.id, "refusedOffer", { t: c.id, kind: "bailout" }); return { ok: false, why: "no" }; }
        return bailout(S, c, T, amt, strings);
      }
      case "acceptBailout": {
        if (!T) return { ok: false, why: "target" };
        return bailout(S, T, c, clamp(+a.amt || 0, 1, Math.max(c.gdp, T.gdp) * 0.6), a.strings);
      }
      case "defaultLoan": {
        // walk away from what you owe a government (or every government)
        const from = a.t != null ? a.t | 0 : -1;
        let n = 0;
        c.loans = c.loans.filter(function (l) {
          if (from >= 0 && l.from !== from) return true;
          n += l.amt; const L = S.c[l.from];
          if (L) { rel(S, c.id, L.id, -55); L.approval -= Math.min(6, l.amt / Math.max(1, L.gdp) * 200); L.allies = L.allies.filter(function (x) { return x !== c.id; }); c.allies = c.allies.filter(function (x) { return x !== L.id; }); logEv(S, c.id, "betrayed", { t: L.id, amt: Math.round(l.amt) }); }
          return false;
        });
        if (c.patron === from || from < 0) c.patron = -1;
        if (!n) return { ok: false, why: "none" };
        c.yld += 1.5;
        return { ok: true };
      }
      case "fire": {
        const role = a.role;
        if (!c.cab[role]) return { ok: false, why: "role" };
        const was = c.cab[role];
        logEv(S, c.id, "fired", { role: role, name: was.name });
        c.cab[role] = newMinister(S, role, c); c.cab[role].loyalty = 62;
        ROLES.forEach(function (r) { if (r !== role) c.cab[r].mood -= 1.5; });
        if (role === "general") c.equip *= 0.95;
        if (role === "bank") { c.cbIndep = Math.max(0, c.cbIndep - 0.35); c.yld += 1.5; c.cab.bank.loyalty = 85; logEv(S, c.id, "bankFired", {}); }
        // a fired general with ambition and friends in the army
        if (role === "general" && was.ambition > 0.75 && was.loyalty < 20 && rnd(S) < 0.25) {
          c.cab.general.loyalty = 15; c.cab.general.ambition = was.ambition; coupAttempt(S, c);
        }
        return { ok: true };
      }
      case "default": { if (c.defaulted > 0) return { ok: false, why: "have" }; doDefault(S, c, "chose"); return { ok: true }; }
      case "bill": {
        const m = c.matters.find(function (x) { return x.kind === "bill"; });
        if (!m) return { ok: false, why: "none" };
        const b = m.data;
        if (a.sign) {
          for (const k in b.fx) {
            if (k === "tax") c.tax = clamp(c.tax + b.fx[k], 5, 60);
            else if (k === "freedom") c.freedom = clamp(c.freedom + b.fx[k], 0, 100);
            else c.budget[k] = Math.max(0, +(c.budget[k] + b.fx[k]).toFixed(2));
          }
          c.approval += b.pop * 0.3;
          logEv(S, c.id, "signed", { name: b.name });
        } else {
          c.approval -= b.pop * 0.25 + (b.yes > 60 ? 2 : 0);
          logEv(S, c.id, "vetoed", { name: b.name });
        }
        c.matters = c.matters.filter(function (x) { return x !== m; });
        return { ok: true };
      }
      case "answer": {
        const m = c.matters.find(function (x) { return x.id === a.m; });
        if (!m) return { ok: false, why: "gone" };
        const o = m.opts[a.o | 0];
        if (!o) return { ok: false, why: "opt" };
        c.matters = c.matters.filter(function (x) { return x !== m; });
        const act = JSON.parse(JSON.stringify(o.act)); act.c = c.id;
        if (m.kind === "bill") { c.matters.push(m); }
        const res = apply(S, act);
        // following his advice (the first answer) or not
        const who = c.cab[m.from];
        if (who) who.loyalty += (a.o | 0) === 0 ? 1.5 : -1;
        return res;
      }
      case "backDown": {
        // an ultimatum met: lift what you put on them
        if (!T) return { ok: false, why: "target" };
        delete c.tariffs[T.id]; delete c.embargo[T.id];
        c.sanctions = c.sanctions.filter(function (x) { return x !== T.id; });
        rel(S, c.id, T.id, 25); c.heat.pride = Math.max(0, c.heat.pride - 6); c.approval -= 2;
        logEv(S, c.id, "backedDown", { t: T.id });
        return { ok: true };
      }
      case "resign": { fall(S, c, "resigned"); return { ok: true }; }
      /* THE FIGHT DECIDED IT. In the real building (city/president_storm.js)
         a coup or an attempt on a human president's life is people with
         guns, and who walks out is what happened, not a roll: the page that
         saw it sends this. In a room it travels through the host like every
         other action, so every machine's world agrees. */
      // the men are in the building: the matter waits for the fight, not the clock
      case "stormBegin": {
        const m = c.matters.find(function (x) { return x.id === a.m; });
        if (!m) return { ok: false, why: "gone" };
        m.expires = S.day + 90;
        return { ok: true };
      }
      case "storm": {
        const m = a.m != null ? c.matters.find(function (x) { return x.id === a.m; }) : null;
        if (m) c.matters = c.matters.filter(function (x) { return x !== m; });
        if (c.out) return { ok: false, why: "out" };
        if (a.won) {
          const kind = m ? m.kind : "coup";
          if (kind === "coup") { logEv(S, c.id, "coupFailed", { name: c.cab.general.name }); c.cab.general = newMinister(S, "general", c); c.freedom -= 3; c.rally += 6; }
          else if (kind === "traitor") { logEv(S, c.id, "plotFoiled", { name: c.cab.security.name }); c.cab.security = newMinister(S, "security", c); c.rally += 4; }
          else { logEv(S, c.id, "survived", { by: m && m.data ? m.data.by : -1 }); c.rally += 8; if (m && m.data && m.data.by >= 0) plotFound(S, S.c[m.data.by], c); }
          return { ok: true, survived: true };
        }
        fall(S, c, a.why || (m && m.kind === "coup" ? "coup" : "assassinated"));
        return { ok: true, survived: false };
      }
      case "arrest": {
        // the coup at your door: your security against his soldiers
        const gen = c.cab.general;
        const p = clamp(0.3 + c.budget.security * 0.08 + c.cab.security.loyalty / 200 - gen.ambition * 0.2, 0.05, 0.9);
        if (rnd(S) < p) { logEv(S, c.id, "coupFailed", { name: gen.name }); c.cab.general = newMinister(S, "general", c); c.freedom -= 3; return { ok: true, survived: true }; }
        fall(S, c, "coup"); return { ok: true, survived: false };
      }
      case "defy": {
        const sc = c.cab.security;
        const p = clamp(0.25 + c.cab.general.loyalty / 160 + c.budget.security * 0.03, 0.05, 0.85);
        if (rnd(S) < p) { logEv(S, c.id, "plotFoiled", { name: sc.name }); c.cab.security = newMinister(S, "security", c); return { ok: true, survived: true }; }
        fall(S, c, "assassinated"); return { ok: true, survived: false };
      }
      case "seat": {
        // a human takes (or leaves) a country
        c.human = a.who == null ? null : String(a.who);
        // a president who takes office at the start gets at least a first
        // term's worth of runway before his first vote
        if (c.human != null && S.day < 30 && c.elections) c.nextElection = Math.max(c.nextElection, 540 + (c.id * 37) % 300);
        return { ok: true };
      }
      default: return { ok: false, why: "unknown" };
    }
  }
  function accept(S, X, Y, kind, terms) {
    // X accepts Y's offer
    if (kind === "deal") {
      if (X.deals.indexOf(Y.id) < 0) X.deals.push(Y.id);
      if (Y.deals.indexOf(X.id) < 0) Y.deals.push(X.id);
      delete X.tariffs[Y.id]; delete Y.tariffs[X.id];
      rel(S, X.id, Y.id, 12); logEv(S, X.id, "deal", { t: Y.id });
    } else if (kind === "alliance") {
      if (X.allies.indexOf(Y.id) < 0) X.allies.push(Y.id);
      if (Y.allies.indexOf(X.id) < 0) Y.allies.push(X.id);
      rel(S, X.id, Y.id, 15); logEv(S, X.id, "allied", { t: Y.id });
    } else if (kind === "peace") {
      makePeace(S, X.id, Y.id, terms === "status" ? "status" : "white");
    }
    return { ok: true };
  }

  // ============================================================ the day
  function logEv(S, c, k, d) {
    const e = { d: S.day, c: c, k: k, n: (S.evN = (S.evN || 0) + 1) };
    for (const key in d) e[key] = d[key];
    S.log.push(e);
    if (S.log.length > 400) S.log.splice(0, S.log.length - 400);
  }
  function diplomacyDay(S) {
    const C = S.c, n = C.length;
    // relations drift toward what the two countries are to each other
    if (S.day % 5 === 0) for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      if (!C[a].alive || !C[b].alive) continue;
      let base = 15 - Math.abs(C[a].freedom - C[b].freedom) * 0.45;
      if (C[a].allies.indexOf(b) >= 0) base += 30;
      if (C[a].deals.indexOf(b) >= 0) base += 15;
      if (C[a].war.indexOf(b) >= 0) base -= 80;
      if (C[a].sanctions.indexOf(b) >= 0 || C[b].sanctions.indexOf(a) >= 0) base -= 25;
      const v = S.rel[a][b] + (clamp(base, -100, 100) - S.rel[a][b]) * 0.01;
      S.rel[a][b] = S.rel[b][a] = v;
    }
    // what the world hears about each country (Holler) moves what it thinks
    if (S.day % 5 === 0) for (const c of C) {
      if (!c.alive) continue;
      const loud = c.heat.crackdown * 0.03 + c.heat.plot * 0.06;
      if (loud > 0.05) for (const o of C) if (o.alive && o.id !== c.id && (o.freedom > 55 || c.heat.plot > 5)) rel(S, o.id, c.id, -loud);
    }
    // sanctions bite in proportion to who is sanctioning
    const gdpW = C.reduce(function (s, c) { return s + (c.alive ? c.gdp : 0); }, 0) || 1;
    for (const c of C) {
      let hit = 0;
      for (const o of C) if (o.alive && o.sanctions.indexOf(c.id) >= 0) hit += o.gdp / gdpW;
      c.sanctionHit = hit * 0.08;
    }
    // incidents: a border shooting, a spy ring, a seized ship. Neighbours and
    // countries that are already cold have them more
    if (S.day % 3 === 0) for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      if (!C[a].alive || !C[b].alive || C[a].war.indexOf(b) >= 0) continue;
      const near = neighbours(S, a, b);
      const p = (near ? 0.0035 : 0.0008) * (S.rel[a][b] < 0 ? 1.8 : 1) * (C[a].allies.indexOf(b) >= 0 ? 0.3 : 1);
      if (rnd(S) < p) {
        const d = 8 + rnd(S) * 18;
        rel(S, a, b, -d);
        logEv(S, a, "incident", { t: b, near: near ? 1 : 0, kind: Math.floor(rnd(S) * 4) });
      }
    }
    // a currency is worth what it is against the others
    let lw = 0, ww = 0;
    for (const c of C) if (c.alive) { lw += Math.log(c.fx) * c.gdp; ww += c.gdp; }
    if (ww > 0) { const m = Math.exp(lw / ww); for (const c of C) if (c.alive) c.fx = clamp(c.fx / m, 0.02, 5); }
    // panic and fallout fade
    S.fear *= 0.993; S.fallout *= 0.9985;
  }

  function checkOver(S) {
    if (S.over) return;
    const humans = S.c.filter(function (c) { return c.human != null; });
    if (!humans.length) return;
    const inOffice = humans.filter(function (c) { return !c.out && c.alive; });
    const rivals = S.c.filter(function (c) { return c.alive && c.leader.original && !(c.human != null && !c.out); });
    if (!inOffice.length) { S.over = { day: S.day, winner: null, why: "all out" }; return; }
    // the last original president standing wins
    if (!rivals.length && inOffice.length === 1) S.over = { day: S.day, winner: inOffice[0].id, why: "last" };
  }

  function step(S, actions) {
    if (S.over && S.over.final) return S;
    const res = [];
    if (actions) for (const a of actions) res.push(apply(S, a));
    // AI presidents act through the same apply()
    const AI = CBZ.presWorld.ai;
    if (AI) for (const c of S.c) if (c.alive && (c.human == null || c.out) && (S.day + c.id) % 7 === 0) AI.turn(S, c, apply);
    marketDay(S);
    for (const c of S.c) if (c.alive) economyDay(S, c);
    warDay(S);
    diplomacyDay(S);
    for (const c of S.c) if (c.alive) { politicsDay(S, c); peopleDay(S, c); mattersDay(S, c); }
    if (S.day % 7 === 0) {
      GOODS.forEach(function (g, i) { const h = S.PHist[i]; h.push(+S.P[i].toPrecision(5)); if (h.length > 104) h.shift(); });
      // two years of weekly readings per country, for the papers' sparklines
      for (const c of S.c) {
        if (!c.alive) continue;
        const H = c.hist || (c.hist = { y: [], a: [], i: [], g: [], u: [] });
        H.y.push(+c.yld.toFixed(2)); H.a.push(+c.approval.toFixed(1)); H.i.push(+c.infl.toFixed(2)); H.g.push(Math.round(c.gdp)); H.u.push(+c.u.toFixed(2));
        for (const k in H) if (H[k].length > 104) H[k].shift();
      }
    }
    S.day++;
    S._res = res;
    return S;
  }

  // ============================================================== views
  function date(day) {
    const st = nationsData().START;
    const d0 = Date.UTC(st.y, st.m - 1, st.d) + day * 86400000;
    const dt = new Date(d0);
    const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate(), text: dt.getUTCDate() + " " + M[dt.getUTCMonth()] + " " + dt.getUTCFullYear() };
  }
  function tradeFlow(S, from, to, good) { return S.flow ? S.flow[GI[good]][to][from] : 0; }
  function worldPrice(S, good) { return S.P[GI[good]] * (1 + ((good === "oil" || good === "gas" || good === "fuel" || good === "grain" || good === "food") ? S.fear : S.fear * 0.3)); }
  function front(S, cid) {
    const M = geo(S.seed, S.nC), out = [];
    for (const p of S.p) {
      if (p.prog > 0 && p.by >= 0) out.push({ p: p.id, by: p.by, prog: p.prog });
    }
    return out;
  }
  function view(S, cid) {
    const c = S.c[cid];
    return {
      c: c, debtGdp: debtRatio(c) * 100, deficitGdp: c.deficit / Math.max(1, c.gdp) * 100, spendPct: spendPct(c), admin: ADMIN,
      vote: voteShare(S, c), strength: strength(c), occupied: occupiedShare(S, c),
    };
  }
  function clone(S) { return JSON.parse(JSON.stringify(S)); }
  function checksum(S) {
    let h = 2166136261 >>> 0;
    const s = JSON.stringify([S.day, S.rng, S.P, S.c.map(function (c) { return [c.gdp, c.approval, c.debt, c.div]; }), S.p.map(function (p) { return p.ctl; })]);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h;
  }

  const API = {
    create: create, geo: geo, step: step, apply: apply, clone: clone, view: view, date: date,
    tradeFlow: tradeFlow, worldPrice: worldPrice, front: front, checksum: checksum,
    GOODS: GOODS, GI: GI, RAW: RAW, MADE: MADE, BUDGET: BUDGET, ADMIN: ADMIN, ROLES: ROLES, ROLE_TITLE: ROLE_TITLE,
    reach: reach, neighbours: neighbours, strength: strength, occupiedShare: occupiedShare, bestTarget: bestTarget,
    biggestCity: biggestCity, debtRatio: debtRatio, voteShare: voteShare, topImport: topImport, rnd: rnd,
    ai: (CBZ.presWorld && CBZ.presWorld.ai) || CBZ.presWorldAI || null,
    _matter: addMatter, official: official,
  };
  CBZ.presWorld = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
