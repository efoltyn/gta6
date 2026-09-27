/* ============================================================
   modes/gungame.js — GUN GAME: weapon-ladder deathmatch on a map you choose.

   THE GAME. You and nine bots start on the same pistol. Every kill climbs the
   killer one rung (pistol, SMG, shotgun, rifle, AK, LMG, sniper, Desert
   Eagle, bare fists). The first to land a kill on the fists rung wins. A
   MELEE kill (F while armed, or any punch) HUMILIATES the victim: they drop a
   rung. That rule is what makes the ladder a race instead of a queue, because
   nobody is ever safely ahead.

   THE ARENA. The mode borrows a world whole (the prison, or the disaster
   island through survival's own build()) and fences a PLAY ZONE inside it: the
   prison's inner compound (yard + south courtyard), or the island's downtown
   ring. The old match spread ten people over the whole 6 ha prison; you
   walked for a minute to find anyone. Spawns, bot movement and the player are
   all held inside the zone.

   THE BOTS (2026-09-27 rewrite). The old brain chased the nearest body
   through walls it could not path around, knew where everyone was, and hit on
   a flat dice roll. Now:
     NAV    a 1 m walk grid rasterised from CBZ.colliders over the zone (plus
            sea and slope on the island), the main connected region only, A*
            with string-pulling, budgeted per frame.
     SIGHT  a view cone + range + line of sight against the same colliders
            (and CBZ.losBlockers before a shot). Bots HEAR gunfire and go to it.
            A bot that is shot turns on its shooter.
     AIM    a reaction delay on a new target, aim that settles the longer a bot
            tracks, worse against a moving/crouching target, falloff by the
            weapon's real effective range, and misses that visibly crack past
            you. Each bot has its own skill.
     PLAY   each rung is played to its gun: shotguns and SMGs push in, rifles
            hold mid range and strafe, the sniper holds still, fists sprint and
            weave. Low on health, a bot breaks line of sight. Everyone hunts
            the leader a little harder, which keeps the race close.

   IT BORROWS THE GEOMETRY, NEVER THE GAME. The prison's own simulation
   (detection, breakout props, killstreak cards) is gated to mode "escape" at
   its owners (systems/detection.js, systems/interactions.js,
   systems/killstreaks.js); CBZ.gungameAudit().prisonLeak pins it at 0. The
   prison cast is hidden for the match and restored on exit.

   HUD. systems/gungamehud.js draws the ladder track, damage direction,
   promotion pulse, death card and result standings, all off gg.on(type, fn)
   events emitted here: matchstart, matchend, promote, demote, kill, hurt,
   death, respawn, leader, final.

   REUSE: player guns are systems/fpsmode.js (bots register into CBZ.npcs so
   its target scan finds them); bot guns are systems/actorweapons.js; deaths
   are ragdoll via CBZ.body.hit + CBZ.gore + one CBZ.cityKillFeed line; the
   ladder ids are CBZ.FPS_WEAPONS ids. Audit: CBZ.gungameAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.GUNGAME_BOTS == null) CBZ.CONFIG.GUNGAME_BOTS = 9;
  if (CBZ.CONFIG.GUNGAME_KILLS_PER_RUNG == null) CBZ.CONFIG.GUNGAME_KILLS_PER_RUNG = 1;
  if (CBZ.CONFIG.GUNGAME_RESPAWN_SEC == null) CBZ.CONFIG.GUNGAME_RESPAWN_SEC = 3;

  // ---- THE LADDER -----------------------------------------------------------
  // ids are CBZ.FPS_WEAPONS ids; `name` is the actorweapons/audio name, so one
  // row arms the player, the bot's hands and the gun's voice.
  const DEFAULT_LADDER = [
    { id: "sidearm", name: "Pistol" },
    { id: "smg", name: "SMG" },
    { id: "shotgun", name: "Shotgun" },
    { id: "carbine", name: "Rifle" },
    { id: "ak47", name: "AK-47" },
    { id: "lmg", name: "LMG" },
    { id: "sniper", name: "Sniper" },
    { id: "deagle", name: "Desert Eagle" },
    { id: "fists", name: "Fists", melee: true },
  ];
  if (CBZ.CONFIG.GUNGAME_LADDER == null) CBZ.CONFIG.GUNGAME_LADDER = DEFAULT_LADDER;
  function ladder() { return CBZ.CONFIG.GUNGAME_LADDER || DEFAULT_LADDER; }
  function rungAt(i) { const L = ladder(); return L[Math.max(0, Math.min(L.length - 1, i | 0))]; }
  function rungLabel(r) {
    if (!r) return "?";
    if (r.melee) return "BARE FISTS";
    const w = CBZ.weaponById && CBZ.weaponById(r.id);
    return (w && w.label) || r.name || r.id;
  }
  function rungNeed(i) {
    return i >= ladder().length - 1 ? 1 : Math.max(1, CBZ.CONFIG.GUNGAME_KILLS_PER_RUNG | 0);
  }

  // How each gun is PLAYED by a bot. band = the distance window it tries to
  // hold; eff = the range at which its hit chance has halved; still = plants
  // its feet to shoot (the sniper). Anything unlisted plays like a rifle.
  const PLAY = {
    sidearm: { band: [7, 16], eff: 22 },
    smg: { band: [4, 12], eff: 18 },
    shotgun: { band: [2.5, 7], eff: 9 },
    carbine: { band: [12, 28], eff: 46 },
    ak47: { band: [11, 26], eff: 40 },
    lmg: { band: [12, 30], eff: 40 },
    sniper: { band: [24, 70], eff: 120, still: true },
    deagle: { band: [6, 16], eff: 26 },
    fists: { band: [0.9, 1.4], eff: 2 },
  };
  function playOf(r) { return PLAY[r && r.id] || PLAY.carbine; }

  // ---- MAPS -----------------------------------------------------------------
  // Borrowed worlds. `zone` is the play area inside the borrowed world; `phase`
  // pins the time of day for the whole match (a deathmatch is one light, not a
  // 150-second day that turns to night halfway through a duel).
  const MAPS = {
    jail: {
      id: "jail", label: "The Jail", small: "yard, courtyard, cell blocks",
      phase: 0.34,
      // the inner compound: the yard (walls x = +-30, z -8..52) and the south
      // courtyard (walls x = +-44, z 52..128). Measured off CBZ.colliders.
      zone: { kind: "rect", minX: -43.4, maxX: 43.4, minZ: -13.4, maxZ: 127.4 },
      ensure() { return !!CBZ.prisonRoot; },
      root() { return CBZ.prisonRoot || null; },
      floorAt() { return 0; },
      sea() { return -Infinity; },
    },
    island: {
      id: "island", label: "Disaster Island", small: "downtown, towers, wrecks",
      phase: 0.40,
      zone: null,      // filled from the built arena (a circle over downtown)
      ensure() {
        // ONE island for two modes: survival's own build() keeps surv.built the
        // single truth and installs its floor; never build the arena directly.
        const m = CBZ.modes && CBZ.modes.survival;
        if (m && m.build) { try { m.build(); } catch (e) { console.error("[gungame island]", e); } }
        const A = CBZ.surv && CBZ.surv.arena;
        if (A) this.zone = { kind: "circle", cx: A.center.x, cz: A.center.z, r: A.radius * 0.56 };
        return !!A;
      },
      root() { return (CBZ.surv && CBZ.surv.arena && CBZ.surv.arena.root) || null; },
      floorAt(x, z) {
        const A = CBZ.surv && CBZ.surv.arena;
        return A ? A.groundHeightAt(x, z) : 0;
      },
      sea(x, z) { return CBZ.survSeaHeightAt ? CBZ.survSeaHeightAt(x, z) : 0; },
    },
  };
  function curMap() { return MAPS[g.gungameMap] || MAPS.jail; }
  if (!g.gungameMap) g.gungameMap = "jail";
  CBZ.gungameWorlds = function () {
    return { jail: curMap().id === "jail", island: curMap().id === "island" };
  };

  // ---- zone -----------------------------------------------------------------
  function zoneBox(Z) {
    if (!Z) return null;
    if (Z.kind === "rect") return { minX: Z.minX, maxX: Z.maxX, minZ: Z.minZ, maxZ: Z.maxZ };
    return { minX: Z.cx - Z.r, maxX: Z.cx + Z.r, minZ: Z.cz - Z.r, maxZ: Z.cz + Z.r };
  }
  function inZone(x, z, m) {
    const Z = curMap().zone; m = m || 0;
    if (!Z) return true;
    if (Z.kind === "rect") return x > Z.minX + m && x < Z.maxX - m && z > Z.minZ + m && z < Z.maxZ - m;
    return Math.hypot(x - Z.cx, z - Z.cz) < Z.r - m;
  }
  function clampZone(p, m) {
    const Z = curMap().zone; m = m || 0;
    if (!Z) return;
    if (Z.kind === "rect") {
      p.x = Math.max(Z.minX + m, Math.min(Z.maxX - m, p.x));
      p.z = Math.max(Z.minZ + m, Math.min(Z.maxZ - m, p.z));
    } else {
      const dx = p.x - Z.cx, dz = p.z - Z.cz, d = Math.hypot(dx, dz), lim = Z.r - m;
      if (d > lim && d > 0) { p.x = Z.cx + dx / d * lim; p.z = Z.cz + dz / d * lim; }
    }
  }

  // ---- match state + events ---------------------------------------------------
  const gg = {
    bots: [],
    match: null,          // {t, over}
    playerRung: 0, playerRungKills: 0, playerKills: 0, playerDeaths: 0,
    respawnT: 0,
    spawnProtectT: 0,     // player spawn shield (ends early when you fire)
    hiddenCast: [],
    matchesPlayed: 0,
    winner: null,
    killer: null,         // {name, weapon, x, z} of whoever last killed you
    leader: null,         // name of the current leader
    heatAtStart: 0,
    spawnPool: [],        // kept for the audit + tools: the walkable spawn cells
    nav: null,
  };
  CBZ.gungame = gg;
  const listeners = {};
  gg.on = function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); return fn; };
  gg.off = function (type, fn) { const L = listeners[type]; if (L) { const i = L.indexOf(fn); if (i >= 0) L.splice(i, 1); } };
  function emit(type, data) {
    const L = listeners[type]; if (!L) return;
    for (let i = 0; i < L.length; i++) { try { L[i](data || {}); } catch (e) { console.error("[gungame " + type + "]", e); } }
  }

  const BR = CBZ.brain;       // systems/brain.js: the bots' senses and memory live there
  const rand = Math.random;   // runtime match randomness (FX-class; no world is built here)

  // ---- NAV: a walk grid over the zone -------------------------------------------
  // 1 m cells. A cell is BLOCKED if any collider (grown by a body radius)
  // covers it at body height, if it is outside the zone, or on the island if it
  // is sea or a cliff. Only the largest connected region is walkable, so a
  // spawn can never land in a sealed room. `clear` is the distance in cells to
  // the nearest blocked cell (spawns want room; paths prefer it).
  const CS = 1.0, BODY_R = 0.42;
  function buildNav() {
    const map = curMap(), Z = map.zone, bb = zoneBox(Z);
    if (!bb) return null;
    const x0 = bb.minX, z0 = bb.minZ;
    const w = Math.ceil((bb.maxX - bb.minX) / CS), h = Math.ceil((bb.maxZ - bb.minZ) / CS);
    const N = w * h;
    const blocked = new Uint8Array(N), floor = new Float32Array(N);
    const island = map.id === "island";
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i, x = x0 + (i + 0.5) * CS, z = z0 + (j + 0.5) * CS;
      if (!inZone(x, z, 0.6)) { blocked[k] = 1; continue; }
      const f = map.floorAt(x, z);
      floor[k] = isFinite(f) ? f : 0;
      if (island && floor[k] < map.sea(x, z) + 0.25) blocked[k] = 1;
    }
    if (island) {
      // cliffs: a step of more than ~0.8 m between neighbouring cells
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const k = j * w + i; if (blocked[k] === 1) continue;
        if ((i + 1 < w && Math.abs(floor[k] - floor[k + 1]) > 0.8) || (j + 1 < h && Math.abs(floor[k] - floor[k + w]) > 0.8)) blocked[k] = 2;
      }
    }
    const cityOn = g.mode === "city";
    const cols = [];
    for (const c of CBZ.colliders || []) {
      if (!c || (c._city && !cityOn)) continue;
      if (c.maxX < bb.minX - 2 || c.minX > bb.maxX + 2 || c.maxZ < bb.minZ - 2 || c.minZ > bb.maxZ + 2) continue;
      cols.push(c);
      const i0 = Math.max(0, Math.floor((c.minX - BODY_R - x0) / CS)), i1 = Math.min(w - 1, Math.floor((c.maxX + BODY_R - x0) / CS));
      const j0 = Math.max(0, Math.floor((c.minZ - BODY_R - z0) / CS)), j1 = Math.min(h - 1, Math.floor((c.maxZ + BODY_R - z0) / CS));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * w + i;
        if (c.y0 != null && c.y1 != null) {
          const fl = floor[k];
          if (c.y1 <= fl + 0.4 || c.y0 >= fl + 1.9) continue;   // a kerb you step over / a beam you walk under
        }
        blocked[k] = 1;
      }
    }
    // largest connected region (4-neighbour flood)
    const comp = new Int32Array(N).fill(-1);
    const q = new Int32Array(N);
    let best = -1, bestN = 0, id = 0;
    for (let s = 0; s < N; s++) {
      if (blocked[s] || comp[s] >= 0) continue;
      let qh = 0, qt = 0; q[qt++] = s; comp[s] = id; let n = 0;
      while (qh < qt) {
        const k = q[qh++]; n++;
        const i = k % w, j = (k / w) | 0;
        if (i > 0 && !blocked[k - 1] && comp[k - 1] < 0) { comp[k - 1] = id; q[qt++] = k - 1; }
        if (i < w - 1 && !blocked[k + 1] && comp[k + 1] < 0) { comp[k + 1] = id; q[qt++] = k + 1; }
        if (j > 0 && !blocked[k - w] && comp[k - w] < 0) { comp[k - w] = id; q[qt++] = k - w; }
        if (j < h - 1 && !blocked[k + w] && comp[k + w] < 0) { comp[k + w] = id; q[qt++] = k + w; }
      }
      if (n > bestN) { bestN = n; best = id; }
      id++;
    }
    const walk = new Uint8Array(N);
    for (let k = 0; k < N; k++) walk[k] = comp[k] === best ? 1 : 0;
    // clearance: multi-source BFS from every non-walkable cell, capped at 6
    const clear = new Uint8Array(N).fill(6);
    let qh = 0, qt = 0;
    for (let k = 0; k < N; k++) if (!walk[k]) { clear[k] = 0; q[qt++] = k; }
    while (qh < qt) {
      const k = q[qh++], c1 = clear[k] + 1; if (c1 >= 6) continue;
      const i = k % w, j = (k / w) | 0;
      if (i > 0 && clear[k - 1] > c1) { clear[k - 1] = c1; q[qt++] = k - 1; }
      if (i < w - 1 && clear[k + 1] > c1) { clear[k + 1] = c1; q[qt++] = k + 1; }
      if (j > 0 && clear[k - w] > c1) { clear[k - w] = c1; q[qt++] = k - w; }
      if (j < h - 1 && clear[k + w] > c1) { clear[k + w] = c1; q[qt++] = k + w; }
    }
    const open = [];
    for (let k = 0; k < N; k++) if (walk[k] && clear[k] >= 2) open.push(k);
    return {
      x0, z0, w, h, walk, clear, floor, cols, open, cells: bestN,
      g: new Float32Array(N), from: new Int32Array(N), stamp: new Uint32Array(N), closed: new Uint32Array(N), gen: 0,
      heap: new Int32Array(N), hf: new Float32Array(N),
    };
  }
  function cellOf(N, x, z) {
    const i = Math.floor((x - N.x0) / CS), j = Math.floor((z - N.z0) / CS);
    if (i < 0 || j < 0 || i >= N.w || j >= N.h) return -1;
    return j * N.w + i;
  }
  function cellX(N, k) { return N.x0 + ((k % N.w) + 0.5) * CS; }
  function cellZ(N, k) { return N.z0 + (((k / N.w) | 0) + 0.5) * CS; }
  // nearest walkable cell to a point (spiral out to r cells)
  function snapCell(N, x, z, r) {
    const k0 = cellOf(N, x, z);
    if (k0 >= 0 && N.walk[k0]) return k0;
    const ci = Math.floor((x - N.x0) / CS), cj = Math.floor((z - N.z0) / CS);
    for (let d = 1; d <= (r || 6); d++) {
      for (let dj = -d; dj <= d; dj++) for (let di = -d; di <= d; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== d) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= N.w || j >= N.h) continue;
        const k = j * N.w + i;
        if (N.walk[k]) return k;
      }
    }
    return -1;
  }
  // is the straight walk a->b open? (grid DDA through walkable cells)
  function navLine(N, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(L / (CS * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, k = cellOf(N, ax + dx * t, az + dz * t);
      if (k < 0 || !N.walk[k]) return false;
    }
    return true;
  }
  // A* (8-neighbour, no corner cutting, octile heuristic, soft wall cost) +
  // string pulling. Returns [{x,z}...] excluding the start, or null.
  function findPath(N, sx, sz, tx, tz) {
    const s = snapCell(N, sx, sz, 4), t = snapCell(N, tx, tz, 8);
    if (s < 0 || t < 0) return null;
    if (s === t) return [{ x: tx, z: tz }];
    const gen = ++N.gen;
    const W = N.w, heap = N.heap, hf = N.hf;
    let hn = 0;
    const tx0 = t % W, tz0 = (t / W) | 0;
    const H = (k) => { const di = Math.abs((k % W) - tx0), dj = Math.abs(((k / W) | 0) - tz0); return (di + dj) + (1.4142 - 2) * Math.min(di, dj); };
    const push = (k, f) => {
      let i = hn++; heap[i] = k; hf[i] = f;
      while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= hf[i]) break; const tk = heap[p], tf = hf[p]; heap[p] = heap[i]; hf[p] = hf[i]; heap[i] = tk; hf[i] = tf; i = p; }
    };
    const pop = () => {
      const top = heap[0]; hn--;
      if (hn > 0) {
        heap[0] = heap[hn]; hf[0] = hf[hn];
        let i = 0;
        for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < hn && hf[l] < hf[m]) m = l; if (r < hn && hf[r] < hf[m]) m = r; if (m === i) break; const tk = heap[m], tf = hf[m]; heap[m] = heap[i]; hf[m] = hf[i]; heap[i] = tk; hf[i] = tf; i = m; }
      }
      return top;
    };
    N.stamp[s] = gen; N.g[s] = 0; N.from[s] = -1;
    push(s, H(s));
    let found = false, exp = 0;
    const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    while (hn > 0 && exp < 9000) {
      const k = pop();
      if (N.closed[k] === gen) continue;
      N.closed[k] = gen; exp++;
      if (k === t) { found = true; break; }
      const i = k % W, j = (k / W) | 0, gk = N.g[k];
      for (let d = 0; d < 8; d++) {
        const ni = i + DI[d], nj = j + DJ[d];
        if (ni < 0 || nj < 0 || ni >= W || nj >= N.h) continue;
        const nk = nj * W + ni;
        if (!N.walk[nk] || N.closed[nk] === gen) continue;
        if (d >= 4 && (!N.walk[j * W + ni] || !N.walk[nj * W + i])) continue;   // no corner cutting
        const cl = N.clear[nk];
        const step = (d >= 4 ? 1.4142 : 1) + (cl <= 1 ? 1.2 : cl === 2 ? 0.35 : 0);
        const ng = gk + step;
        if (N.stamp[nk] !== gen || ng < N.g[nk]) {
          N.stamp[nk] = gen; N.g[nk] = ng; N.from[nk] = k;
          push(nk, ng + H(nk));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = t; k >= 0; k = N.from[k]) { cells.push(k); if (k === s) break; }
    cells.reverse();
    // string-pull: from each anchor, jump to the farthest cell still in a straight open line
    const out = [];
    let ax = sx, az = sz, i = 0;
    while (i < cells.length - 1) {
      let j = cells.length - 1;
      while (j > i + 1 && !navLine(N, ax, az, cellX(N, cells[j]), cellZ(N, cells[j]))) j--;
      const px = j === cells.length - 1 ? tx : cellX(N, cells[j]);
      const pz = j === cells.length - 1 ? tz : cellZ(N, cells[j]);
      out.push({ x: px, z: pz });
      ax = px; az = pz; i = j;
    }
    if (!out.length) out.push({ x: tx, z: tz });
    // the goal itself may sit in a blocked cell (a target hugging a wall): end on the snapped cell
    const last = out[out.length - 1], lk = cellOf(N, last.x, last.z);
    if (lk < 0 || !N.walk[lk]) { last.x = cellX(N, t); last.z = cellZ(N, t); }
    return out;
  }

  // ---- LINE OF SIGHT against the colliders (+ the mesh blockers to fire) ------
  // CBZ.clearLineOfFire only knows CBZ.losBlockers, which the island never
  // registers, so on the island everybody used to see (and shoot) through
  // towers and wrecks. The walk grid's collider list IS the solid world.
  function segBlocked(cols, ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dz = bz - az;
    for (let n = 0; n < cols.length; n++) {
      const c = cols[n];
      let t0 = 0, t1 = 1;
      if (Math.abs(dx) < 1e-9) { if (ax < c.minX || ax > c.maxX) continue; }
      else { let ta = (c.minX - ax) / dx, tb = (c.maxX - ax) / dx; if (ta > tb) { const q = ta; ta = tb; tb = q; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
      if (Math.abs(dz) < 1e-9) { if (az < c.minZ || az > c.maxZ) continue; }
      else { let ta = (c.minZ - az) / dz, tb = (c.maxZ - az) / dz; if (ta > tb) { const q = ta; ta = tb; tb = q; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
      if (c.y0 != null && c.y1 != null) {
        // the ray's height across the box: blocked only if some of it is inside the slab
        const ya = ay + (by - ay) * t0, yb = ay + (by - ay) * t1;
        if (Math.max(ya, yb) < c.y0 || Math.min(ya, yb) > c.y1) continue;
      }
      return true;
    }
    return false;
  }
  function eyeY(a) { return (a.pos.y || 0) + (a.isPlayer ? ((CBZ.player && CBZ.player.crouch) ? 1.05 : 1.55) : 1.5); }
  function chestY(a) { return (a.pos.y || 0) + (a.isPlayer && CBZ.player && CBZ.player.crouch ? 0.85 : 1.25); }
  /* SIGHT IS CBZ.brain's (systems/brain.js perception); THE WALLS ARE THIS
     MAP'S. The walk grid's collider list is installed as the brain's occlusion
     for the length of a match (startMatch / gungameExit), so the bots' cone,
     the awareness meter and gunshot hearing through a wall all ask the same
     boxes the bullets do. sees() below is the raw eye-to-chest line (no cone,
     no range) that spawn safety, cover and the trigger ask. */
  function ggOcclusion(ox, oy, oz, tx, ty, tz) {
    const N = gg.nav;
    return !!N && segBlocked(N.cols, ox, oy, oz, tx, ty, tz);
  }
  function sees(a, b) {
    return !BR.perception.occluded(a.pos.x, eyeY(a), a.pos.z, b.pos.x, chestY(b), b.pos.z);
  }
  function canFire(a, b) {
    if (!sees(a, b)) return false;
    if (CBZ.clearLineOfFire && !CBZ.clearLineOfFire(a.pos.x, eyeY(a) - 0.1, a.pos.z, b.pos.x, chestY(b), b.pos.z)) return false;
    return true;
  }

  // ---- bot cosmetics ------------------------------------------------------------
  // Real people dressed for a fight: work jackets, fatigues, hoodies, denim and
  // cargo in muted colours, some in a plate carrier and a helmet. (The old
  // roster wore fourteen candy colours and read as a toy box.)
  const SKIN = [0xf0c39a, 0xe8b58c, 0xc08a5a, 0x8a5a3a, 0x6b4a32, 0xd8a177, 0xf2cbb0, 0x9c6b47];
  const HAIR = [0x2a2018, 0x4a3526, 0x101820, 0x6d655c, 0x7a4a2e, 0x1c1c1c, 0x3b2a1d];
  const TOPS = [0x4b5320, 0x6b5b3e, 0x2f3236, 0x1f2a3a, 0x7d6f52, 0x55595e, 0x5a2a2a, 0x2b3b36, 0x3d3a34, 0x6e7069, 0x28303f, 0x4a4436];
  const LEGS = [0x2e3b52, 0x1e1f22, 0x5f5543, 0x3f4a2a, 0x46494e, 0x33302b, 0x243049];
  const FIRST = ["Liam", "Mia", "Noah", "Ava", "Kai", "Zoe", "Leo", "Ivy", "Max", "Ada",
    "Finn", "Cleo", "Ravi", "Yuki", "Omar", "Nina", "Jude", "Wren", "Theo", "Iris",
    "Hugo", "Vera", "Eli", "Luna", "Remy", "Sol", "Reed", "Beau", "Esme", "Nico",
    "Dane", "Arlo", "Cole", "Mara", "Kofi", "Tess", "Anya", "Dex", "Lena", "Quinn"];
  const LAST_I = "ABCDEFGHJKLMNPRSTVW";
  function pick(a) { return a[(rand() * a.length) | 0]; }
  function pickName(taken) {
    for (let i = 0; i < 20; i++) { const n = pick(FIRST) + " " + LAST_I[(rand() * LAST_I.length) | 0] + "."; if (!taken[n]) { taken[n] = 1; return n; } }
    return pick(FIRST) + " " + ((rand() * 90) | 0);
  }

  // ---- spawns -------------------------------------------------------------------
  // A spawn is a roomy walkable cell (clearance >= 2) as far as possible from
  // every living enemy AND out of their sight: a spawn in an enemy's view is a
  // spawn kill. The player also never gets a bot materialising on screen.
  const _probe = { pos: { x: 0, y: 0, z: 0 }, isPlayer: false };
  function spawnPoint(self) {
    const N = gg.nav;
    if (!N || !N.open.length) {
      const Z = curMap().zone;
      return Z && Z.kind === "circle" ? { x: Z.cx, z: Z.cz } : { x: 0, z: 40 };
    }
    let best = null, bestS = -Infinity;
    for (let n = 0; n < 28; n++) {
      const k = N.open[(rand() * N.open.length) | 0];
      const x = cellX(N, k), z = cellZ(N, k);
      if (self !== "player" && CBZ.npcTransitionSafe && !CBZ.npcTransitionSafe(x, z, { minDistance: 12, maxDistance: 1e6 })) continue;
      _probe.pos.x = x; _probe.pos.z = z; _probe.pos.y = N.floor[k];
      let dmin = 1e9, seen = 0;
      const test = (a) => {
        const d = Math.hypot(a.pos.x - x, a.pos.z - z);
        if (d < dmin) dmin = d;
        if (d < 55 && sees(a, _probe)) seen++;
      };
      if (self !== "player" && !CBZ.player.dead) test(PLAYER_TGT);
      for (const b of gg.bots) if (!b.dead && b !== self) test(b);
      const score = Math.min(dmin, 60) - seen * 22 + N.clear[k] * 0.5 + rand() * 3;
      if (score > bestS) { bestS = score; best = { x, z }; }
    }
    if (!best) { const k = N.open[(rand() * N.open.length) | 0]; best = { x: cellX(N, k), z: cellZ(N, k) }; }
    return best;
  }

  // ---- floor handoff ---------------------------------------------------------------
  function mapFloor(x, z) { return curMap().floorAt(x, z); }
  function installFloor() {
    CBZ.registerGroundBase("gungame", function (x, z) { return mapFloor(x, z); });
  }

  // ---- THE ZONE EDGE YOU CAN SEE ---------------------------------------------------
  // The island's play zone is a circle over downtown, and clampZone() holds
  // everybody inside it. Before this, that edge was an invisible wall in the
  // middle of a street: you ran into nothing and stopped. Now the edge is a
  // line of temporary site fencing (the 3.5 x 2 m galvanised mesh panels on
  // concrete feet you see around any closed-off block), stood on the real
  // ground where the circle crosses streets and plazas, left out wherever it
  // would pass through a building (the building is already the wall there) or
  // out over the sea. The jail needs none: its zone IS the compound walls.
  // Visual only: it stands 0.5 m outside the clamp, so it never needs a collider.
  // Shared: one merged mesh infill (prison kit's chain-link skin), one
  // instanced tube frame, one instanced foot. Built once per island.
  const FENCE = { group: null, key: "" };
  function fenceSkin(kind, tint, fallback) {
    const K = CBZ.prisonKit;
    if (K && K.skin) { try { return K.skin(kind, tint); } catch (e) {} }
    return fallback();
  }
  function colliderAt(x, z, fl) {
    const cityOn = g.mode === "city";
    for (const c of CBZ.colliders || []) {
      if (!c || (c._city && !cityOn)) continue;
      if (x < c.minX - 0.15 || x > c.maxX + 0.15 || z < c.minZ - 0.15 || z > c.maxZ + 0.15) continue;
      if (c.y0 != null && c.y1 != null && (c.y1 <= fl + 0.4 || c.y0 >= fl + 1.9)) continue;
      return true;
    }
    return false;
  }
  function buildZoneFence() {
    const map = curMap(), Z = map.zone;
    if (map.id !== "island" || !Z || Z.kind !== "circle") return null;
    const key = Z.cx.toFixed(1) + "," + Z.cz.toFixed(1) + "," + Z.r.toFixed(1);
    if (FENCE.group && FENCE.key === key) return FENCE.group;
    disposeZoneFence();
    const R = Z.r + 0.05, PANEL = 3.45, H = 2.0, LIFT = 0.1;
    const n = Math.max(12, Math.round((Math.PI * 2 * R) / PANEL));
    // post points on the circle: their ground, and whether a panel may stand there
    const px = [], pz = [], py = [], ok = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Z.cx + Math.cos(a) * R, z = Z.cz + Math.sin(a) * R;
      const y = map.floorAt(x, z);
      px.push(x); pz.push(z); py.push(isFinite(y) ? y : 0);
      ok.push(isFinite(y) && y > map.sea(x, z) + 0.25 && !colliderAt(x, z, y));
    }
    const panels = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (!ok[i] || !ok[j] || Math.abs(py[i] - py[j]) > 0.7) continue;
      const mx = (px[i] + px[j]) / 2, mz = (pz[i] + pz[j]) / 2;
      const my = map.floorAt(mx, mz);
      if (!isFinite(my) || colliderAt(mx, mz, my) || my < map.sea(mx, mz) + 0.25) continue;
      panels.push([i, j]);
    }
    if (!panels.length) return null;

    const group = new THREE.Group();
    group.name = "gungame-zone-fence";
    // 1. mesh infill: one merged quad per panel, world-metre UVs (2 m tile, 50 mm diamonds)
    const pos = new Float32Array(panels.length * 12), uv = new Float32Array(panels.length * 8);
    const idx = [];
    let along = 0;
    panels.forEach(function (p, k) {
      const i = p[0], j = p[1];
      const L = Math.hypot(px[j] - px[i], pz[j] - pz[i]);
      const yi = py[i] + LIFT, yj = py[j] + LIFT;
      const v = [px[i], yi + 0.04, pz[i], px[j], yj + 0.04, pz[j], px[j], yj + H - 0.04, pz[j], px[i], yi + H - 0.04, pz[i]];
      pos.set(v, k * 12);
      uv.set([along / 2, 0, (along + L) / 2, 0, (along + L) / 2, H / 2, along / 2, H / 2], k * 8);
      along += L + 0.37;   // panels do not share a mesh phase
      const b = k * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    });
    const infill = new THREE.BufferGeometry();
    infill.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    infill.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    infill.setIndex(idx);
    infill.computeVertexNormals();
    const meshMat = fenceSkin("chainlink", 0xb3bac1, function () {
      return new THREE.MeshStandardMaterial({ color: 0xb3bac1, metalness: 0.7, roughness: 0.45, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    });
    const infillMesh = new THREE.Mesh(infill, meshMat);
    infillMesh.castShadow = false; infillMesh.receiveShadow = false;
    group.add(infillMesh);

    // 2. the frame: a 40 mm galvanised tube round each panel (two stiles, top
    //    and bottom rail) plus a coupler clamp where two panels meet
    const tubeGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 6, 1, true);
    const galv = fenceSkin("galv", 0xa7afb7, function () { return new THREE.MeshStandardMaterial({ color: 0xa7afb7, metalness: 0.7, roughness: 0.42 }); });
    const tubes = new THREE.InstancedMesh(tubeGeo, galv, panels.length * 4);
    const up = new THREE.Vector3(0, 1, 0), A = new THREE.Vector3(), B = new THREE.Vector3(), d = new THREE.Vector3();
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), m = new THREE.Matrix4();
    let t = 0;
    const tube = function (ax, ay, az, bx, by, bz) {
      A.set(ax, ay, az); B.set(bx, by, bz);
      d.subVectors(B, A); const len = d.length(); d.divideScalar(len || 1);
      q.setFromUnitVectors(up, d);
      s.set(1, len, 1);
      m.compose(A.add(B).multiplyScalar(0.5), q, s);
      tubes.setMatrixAt(t++, m);
    };
    // 3. feet: a cast concrete block per post, 0.62 x 0.14 x 0.2, across the line
    const footGeo = new THREE.BoxGeometry(0.2, 0.14, 0.62);
    const conc = fenceSkin("concrete", 0x8f8b84, function () { return new THREE.MeshStandardMaterial({ color: 0x8f8b84, roughness: 0.92 }); });
    const usedPosts = [];
    panels.forEach(function (p) {
      const i = p[0], j = p[1];
      // the stiles sit 0.06 m in from the panel ends so neighbours clamp side by side
      const ux = (px[j] - px[i]), uz = (pz[j] - pz[i]), L = Math.hypot(ux, uz) || 1;
      const ex = ux / L * 0.06, ez = uz / L * 0.06;
      const ax = px[i] + ex, az = pz[i] + ez, bx = px[j] - ex, bz = pz[j] - ez;
      const ya = py[i] + LIFT, yb = py[j] + LIFT;
      tube(ax, ya, az, ax, ya + H, az);
      tube(bx, yb, bz, bx, yb + H, bz);
      tube(ax, ya + H - 0.02, az, bx, yb + H - 0.02, bz);
      tube(ax, ya + 0.03, az, bx, yb + 0.03, bz);
      if (usedPosts.indexOf(i) < 0) usedPosts.push(i);
      if (usedPosts.indexOf(j) < 0) usedPosts.push(j);
    });
    tubes.count = t;
    tubes.instanceMatrix.needsUpdate = true;
    tubes.castShadow = true; tubes.receiveShadow = false;
    tubes.frustumCulled = false;   // r128 culls an InstancedMesh by its ONE unit tube at the origin
    group.add(tubes);
    const feet = new THREE.InstancedMesh(footGeo, conc, usedPosts.length);
    const e = new THREE.Euler();
    usedPosts.forEach(function (i, k) {
      const a = Math.atan2(pz[i] - Z.cz, px[i] - Z.cx);   // long axis across the fence line
      e.set(0, -a + Math.PI / 2, 0);
      q.setFromEuler(e);
      A.set(px[i], py[i] + 0.07 - 0.015, pz[i]);          // seated, a hair into the ground
      s.set(1, 1, 1);
      m.compose(A, q, s);
      feet.setMatrixAt(k, m);
    });
    feet.instanceMatrix.needsUpdate = true;
    feet.castShadow = true; feet.receiveShadow = true;
    feet.frustumCulled = false;
    group.add(feet);

    group.userData.panels = panels.length;
    group.userData.posts = usedPosts.length;
    FENCE.group = group; FENCE.key = key;
    return group;
  }
  function showZoneFence(on) {
    if (on && !FENCE.group) { try { buildZoneFence(); } catch (e) { console.error("[gungame fence]", e); } }
    const G = FENCE.group;
    if (!G) return;
    if (on) { if (!G.parent && CBZ.scene) CBZ.scene.add(G); G.visible = true; }
    else { G.visible = false; if (G.parent) G.parent.remove(G); }
  }
  function disposeZoneFence() {
    const G = FENCE.group;
    if (!G) return;
    if (G.parent) G.parent.remove(G);
    // materials are the prison kit's shared skins: only our geometry goes
    G.traverse(function (o) { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); });
    FENCE.group = null; FENCE.key = "";
  }

  // ---- DROPPED GUNS ----------------------------------------------------------------------
  // A man shot dead lets go of his gun. It used to stay glued in the ragdoll's
  // fist until he respawned. Now the real held model leaves the hand on the
  // shared weapon body (systems/actorweapons.js: it clatters, bounces and
  // settles flat on a side, clear of the corpse) and lies where he fell. Not a
  // pickup: in a gun game the ladder hands you your gun. Litter is capped; the
  // oldest gun leaves first, and a new match starts on clean ground.
  const DROP_CAP = 8;
  const drops = [];
  function dropBotGun(b, fromX, fromZ) {
    const prop = b._weaponProp;
    const WP = CBZ.weaponPhysics;
    if (!prop || !prop.parent || prop.visible === false || !WP || !WP.drop) return;
    const root = curMap().root() || CBZ.scene;
    try {
      root.attach(prop);                   // keeps the world pose it had in the hand
      b._weaponProp = null; b._weaponPropId = null;   // armBot builds him a fresh one on respawn
      let dx = b.pos.x - (fromX != null ? fromX : b.pos.x - 1), dz = b.pos.z - (fromZ != null ? fromZ : b.pos.z);
      const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const sp = 0.8 + rand() * 1.4, side = rand() * 1.2 - 0.6;
      WP.drop(prop, {
        vx: dx * sp - dz * side, vy: 1.2 + rand() * 1.2, vz: dz * sp + dx * side,
        source: "gungame-death", sound: "shell", corpseCollision: true,
      });
      drops.push(prop);
      while (drops.length > DROP_CAP) disposeDrop(drops.shift());
    } catch (e) { console.error("[gungame drop]", e); }
  }
  function disposeDrop(prop) {
    if (!prop) return;
    const WP = CBZ.weaponPhysics;
    if (WP && WP.release) { try { WP.release(prop); } catch (e) {} }
    if (prop.parent) prop.parent.remove(prop);
    prop.traverse(function (o) { if (o.geometry && o.geometry.dispose && !o.geometry._shared) o.geometry.dispose(); });
  }
  function clearDrops() {
    while (drops.length) disposeDrop(drops.pop());
    if (CBZ.fpsDeathDropReset) { try { CBZ.fpsDeathDropReset(); } catch (e) {} }
  }

  // ---- prison cast parking ---------------------------------------------------------
  function hidePrisonCast() {
    restorePrisonCast();
    const park = (a) => {
      if (!a || a._ggBot || !a.group || a.group.visible === false) return;
      a.group.visible = false;
      gg.hiddenCast.push(a);
    };
    for (const n of CBZ.npcs || []) park(n);
    for (const gd of CBZ.guards || []) park(gd);
  }
  function restorePrisonCast() {
    for (const a of gg.hiddenCast) if (a && a.group && !a.escaped) a.group.visible = true;
    gg.hiddenCast.length = 0;
  }

  // ---- bots ---------------------------------------------------------------------------
  const ANIM_DIST2 = 70 * 70;
  const PLAYER_TGT = {
    isPlayer: true, name: "You",
    get pos() { return CBZ.player.pos; },
    get dead() { return CBZ.player.dead; },
    get group() { return CBZ.playerChar && CBZ.playerChar.group; },
    get rung() { return gg.playerRung; },
    // what the bots' awareness meter reads off a target (brain.awareness)
    get crouch() { return !!CBZ.player.crouch; },
    get speed() { return playerSpeed; },
  };
  gg.playerTarget = PLAYER_TGT;

  function makeBot(x, z, taken, idx) {
    const top = pick(TOPS), skin = pick(SKIN);
    const ch = CBZ.makeCharacter({
      legs: pick(LEGS), torso: top, collar: top, arms: top,
      skin: skin, hair: pick(HAIR), shoes: rand() < 0.5 ? 0x1f1d1b : 0x3a3129,
      beard: rand() < 0.3 ? pick(["stubble", "full", "goatee"]) : undefined,
    });
    ch.group.position.set(x, mapFloor(x, z), z);
    ch.group.rotation.y = rand() * 6.28;
    const name = pickName(taken);
    const b = {
      kind: "gungame", _ggBot: true, isPlayer: false,
      char: ch, group: ch.group, pos: ch.group.position,
      name: name, data: { name: name },
      hp: 100, maxHp: 100, dead: false, ko: 0, escaped: false,
      armed: true, weapon: rungAt(0).name,
      rung: 0, rungKills: 0, kills: 0, deaths: 0,
      outfit: top, skin: skin,
      // skill: 0.45 (sloppy) .. 0.9 (sharp). Spread across the roster so a
      // match has a couple of genuinely dangerous players and some fodder.
      skill: 0.45 + ((idx * 0.37 + rand() * 0.3) % 1) * 0.45,
      speed: 0, target: new THREE.Vector3(x, 0, z),
      foe: null, foeSeen: false, lostT: 99, react: 0, track: 0,
      hurtBy: null, hurtT: 99, glance: null, giveUpT: -1e9, percT: -1, coverAt: null,
      path: null, pathI: 0, pathGoal: null, repathT: 0,
      stuckT: 0, lastX: x, lastZ: z,
      strafe: rand() < 0.5 ? 1 : -1, strafeT: 0,
      fireCD: 0.8 + rand() * 1.0, burst: 0, meleeCD: 0,
      thinkT: rand() * 0.2, spawnT: 1.2, respawnT: 0, _hpSeen: 100,
      mode: "hunt",
    };
    // a third of the roster wears plates + helmet, a third a soft vest: pure
    // costume (nothing in this mode reads the armour pool), pooled meshes
    const kitRoll = rand();
    if (CBZ.cityArmorDressPed) {
      try {
        if (kitRoll < 0.33) CBZ.cityArmorDressPed(b, ["plateCarrier", "helmet"]);
        else if (kitRoll < 0.6) CBZ.cityArmorDressPed(b, ["softVest"]);
      } catch (e) {}
      b._armor = 0;
    }
    return b;
  }
  function armBot(b) {
    const r = rungAt(b.rung);
    if (r.melee) { b.armed = false; b.weapon = null; }
    else { b.armed = true; b.weapon = r.name; }
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(b);
  }
  function spawnBots(n) {
    const root = curMap().root() || CBZ.scene;
    const taken = {};
    for (let i = 0; i < n; i++) {
      const p = spawnPoint(null);
      const b = makeBot(p.x, p.z, taken, i);
      root.add(b.group);
      gg.bots.push(b);
      BR.register(b, "gg_bot", {
        game: "gungame", faction: "ffa",
        personality: { courage: 0.5 + b.skill * 0.5, aggression: 0.6 + b.skill * 0.4, discipline: b.skill },
      });
      CBZ.bots.push(b);   // grapple.js's shared body physics steps CBZ.bots in every non-escape mode
      CBZ.npcs.push(b);   // fpsmode's non-city bullet/punch scan reads CBZ.npcs
      armBot(b);
    }
  }
  function despawnBots() {
    for (const b of gg.bots) {
      if (!b.group) continue;
      // pooled armour goes back to its pool BEFORE the rig is disposed
      if (b._armorMeshes && CBZ.cityArmorDressPed) { try { CBZ.cityArmorDressPed(b, []); } catch (e) {} }
      if (b.group.parent) b.group.parent.remove(b.group);
      b.group.traverse(function (o) {
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) try { o.geometry.dispose(); } catch (e) {}
        if (o.material) {
          const m = o.material;
          if (Array.isArray(m)) m.forEach((x) => x && !x._shared && x.dispose && x.dispose());
          else if (!m._shared && m.dispose) try { m.dispose(); } catch (e) {}
        }
      });
      BR.unregister(b); BR.memory.forget(b);
      let i = CBZ.bots.indexOf(b); if (i >= 0) CBZ.bots.splice(i, 1);
      i = CBZ.npcs.indexOf(b); if (i >= 0) CBZ.npcs.splice(i, 1);
    }
    gg.bots.length = 0;
  }
  function resetBrain(b) {
    b.foe = null; b.foeSeen = false; b.lostT = 99; b.react = 0; b.track = 0;
    BR.memory.forget(b);                              // lastSeen, heard, awareness
    b.hurtBy = null; b.hurtT = 99; b.glance = null; b.giveUpT = -1e9; b.percT = -1; b.coverAt = null;
    b.path = null; b.pathI = 0; b.pathGoal = null; b.repathT = 0; b.stuckT = 0;
    b.mode = "hunt"; b.meleeCD = 0; b.burst = 0;
  }
  function respawnBot(b) {
    const p = spawnPoint(b);
    b.dead = false; b.hp = 100; b._hpSeen = 100; b.ko = 0; b.respawnT = 0;
    b.pos.set(p.x, mapFloor(p.x, p.z), p.z);
    b.lastX = p.x; b.lastZ = p.z;
    b.group.rotation.set(0, rand() * 6.28, 0);
    if (b._phys) { b._phys.down = 0; b._phys.air = false; b._phys.kx = 0; b._phys.kz = 0; b._phys.heldBy = null; }
    b._lvy = 0;
    b.fireCD = 0.6 + rand() * 0.6;
    b.spawnT = 1.2;
    resetBrain(b);
    if (b.group && !b.group.parent) (curMap().root() || CBZ.scene).add(b.group);
    armBot(b);
  }

  // ---- who killed whom --------------------------------------------------------------
  function resolveKiller(k) {
    if (!k) return null;
    if (k === "player" || k === CBZ.player || k === PLAYER_TGT) return "player";
    if (k.group && CBZ.playerChar && k.group === CBZ.playerChar.group) return "player";
    if (k._ggBot) return k;
    return null;
  }
  function killerWeaponName(kRec) {
    const r = kRec === "player" ? rungAt(gg.playerRung) : rungAt(kRec.rung);
    return r.melee ? "fists" : (r.name || r.id).toLowerCase();
  }
  function nameOf(kRec) { return kRec === "player" ? "You" : (kRec ? kRec.name : ""); }

  // ---- deaths (bots) ------------------------------------------------------------------
  // cause "melee" = a humiliation: the victim drops a rung (gun game's knife rule).
  function botDeath(b, killer, cause, headshot) {
    if (!b || b.dead) return;
    b.dead = true; b.hp = 0; b.ko = 0; b.deaths++;
    b.respawnT = Math.max(1, +CBZ.CONFIG.GUNGAME_RESPAWN_SEC || 3);
    const kRec = resolveKiller(killer);
    const melee = cause === "melee" || cause === "fists";
    const humiliate = melee;
    let label = cause || (kRec ? killerWeaponName(kRec) : "crossfire");
    if (melee && kRec) {
      const kr = kRec === "player" ? rungAt(gg.playerRung) : rungAt(kRec.rung);
      label = kr.melee ? "fists" : "gun butt";
    }
    const kp = kRec === "player" ? CBZ.player.pos : (kRec ? kRec.pos : null);
    dropBotGun(b, kp ? kp.x : null, kp ? kp.z : null);
    if (CBZ.body) {
      if (kp) CBZ.body.hit(b, { fromX: kp.x, fromZ: kp.z, force: 6 + rand() * 3, fling: 4 + rand() * 3 });
      else {
        const a = rand() * 6.28;
        CBZ.body.hit(b, { dir: { x: Math.cos(a), z: Math.sin(a) }, force: 2.5 + rand() * 3, fling: 4 + rand() * 3 });
      }
    }
    if (CBZ.gore) CBZ.gore(b.pos.x, b.pos.y + 1.0, b.pos.z, { amount: melee ? 0.4 : 0.95, cloth: b.outfit, skin: b.skin });
    if (CBZ.cityKillFeed) CBZ.cityKillFeed(nameOf(kRec), b.name, label);
    // humiliation: the victim loses a rung
    if (humiliate && b.rung > 0 && kRec) { b.rung--; b.rungKills = 0; }
    if (kRec === "player") {
      emit("kill", { victim: b.name, weapon: label, melee: melee, headshot: !!headshot });
      advancePlayer();
    } else if (kRec) advanceBot(kRec);
  }

  // ---- deaths (player) -------------------------------------------------------------
  // No WASTED flow and no permadeath: an arena death is a 3 s respawn with the
  // camera turned on whoever did it.
  function playerDeath(byBot, cause) {
    if (CBZ.player.dead) return;
    CBZ.player.dead = true;
    CBZ.player.hp = 0;
    gg.playerDeaths++;
    gg.respawnT = Math.max(1, +CBZ.CONFIG.GUNGAME_RESPAWN_SEC || 3);
    const melee = cause === "melee" || cause === "fists";
    const weapon = melee ? (byBot && rungAt(byBot.rung).melee ? "fists" : "gun butt") : (cause || "gunfire");
    gg.killer = byBot ? { name: byBot.name, weapon: weapon, bot: byBot } : null;
    const a = byBot ? Math.atan2(CBZ.player.pos.z - byBot.pos.z, CBZ.player.pos.x - byBot.pos.x) : rand() * 6.28;
    CBZ.player._death = {
      vx: Math.cos(a) * (2.5 + rand() * 2), vz: Math.sin(a) * (2.5 + rand() * 2),
      vy: 4 + rand() * 2, spin: (rand() * 2 - 1) * 5, spin2: (rand() * 2 - 1) * 4,
      t: 0, landed: false, seed: rand() * 6.28,
    };
    if (CBZ.player._phys) { CBZ.player._phys.air = false; CBZ.player._phys.down = 0; CBZ.player._phys.kx = CBZ.player._phys.kz = 0; }
    if (CBZ.fpsSetActive) CBZ.fpsSetActive(false);
    // your gun leaves your hand too, and lies where you fell (fpsmode's shared drop)
    if (CBZ.fpsDeathDrop) { try { CBZ.fpsDeathDrop(); } catch (e) {} }
    if (CBZ.shake) CBZ.shake(1.0);
    if (CBZ.sfx) CBZ.sfx("ko");
    if (CBZ.doSlowmo) CBZ.doSlowmo(0.4);
    if (CBZ.cityKillFeed) CBZ.cityKillFeed(byBot ? byBot.name : "", "You", weapon, { you: true });
    emit("death", { by: byBot ? byBot.name : "", weapon: weapon });
    if (melee && byBot && gg.playerRung > 0) {
      gg.playerRung--; gg.playerRungKills = 0;
      emit("demote", { rung: gg.playerRung, by: byBot.name });
    }
    if (byBot && byBot._ggBot) advanceBot(byBot);
  }
  function respawnPlayer() {
    const p = spawnPoint("player");
    const gy = mapFloor(p.x, p.z);
    CBZ.player.pos.set(p.x, gy, p.z);
    CBZ.player.vy = 0; CBZ.player.grounded = true;
    CBZ.player.hp = 100; CBZ.player.dead = false; CBZ.player.ko = 0; CBZ.player.stun = 0;
    CBZ.player._death = null;
    if (CBZ.player._phys) { CBZ.player._phys.air = false; CBZ.player._phys.down = 0; CBZ.player._phys.kx = CBZ.player._phys.kz = 0; }
    CBZ.player.stamina = (CBZ.SURV && CBZ.SURV.staminaMax) || 100;
    CBZ.playerChar.group.position.copy(CBZ.player.pos);
    // face the middle of the zone, not a wall
    const Z = curMap().zone, bb = zoneBox(Z);
    const mx = bb ? (bb.minX + bb.maxX) / 2 : 0, mz = bb ? (bb.minZ + bb.maxZ) / 2 : 0;
    const face = Math.atan2(mx - p.x, mz - p.z);
    CBZ.playerChar.group.rotation.set(0, face, 0);
    CBZ.playerChar.group.scale.y = 1;
    if (CBZ.cam) { CBZ.cam.yaw = face + Math.PI; CBZ.cam.pitch = 0.1; }
    if (CBZ.fps) CBZ.fps.fp = 0;
    gg.spawnProtectT = 2.0;
    gg.killer = null;
    grantPlayerRung();
    emit("respawn", {});
  }

  // ---- rung advancement -------------------------------------------------------------
  // A rung advance is a FULL HEAL and a fresh gun: it keeps a hot streak hot.
  function grantPlayerRung() {
    const r = rungAt(gg.playerRung);
    if (CBZ.resetWeaponInventory) CBZ.resetWeaponInventory();
    if (!r.melee && CBZ.unlockWeapon) CBZ.unlockWeapon(r.id, { select: true });
    if (CBZ.fpsResetWeapons) CBZ.fpsResetWeapons();
    if (r.melee && CBZ.fpsSetActive && !CBZ.player.dead) CBZ.fpsSetActive(true);
  }
  function advancePlayer() {
    if (!gg.match || gg.match.over) return;
    gg.playerKills++;
    gg.playerRungKills++;
    if (gg.playerRungKills < rungNeed(gg.playerRung)) return;
    if (gg.playerRung >= ladder().length - 1) { matchWon("player"); return; }
    gg.playerRung++;
    gg.playerRungKills = 0;
    CBZ.player.hp = 100;
    grantPlayerRung();
    if (CBZ.sfx) CBZ.sfx("key");
    const r = rungAt(gg.playerRung);
    emit("promote", { rung: gg.playerRung, weaponId: r.id, label: rungLabel(r) });
    if (r.melee) emit("final", { name: "You", you: true });
  }
  function advanceBot(b) {
    if (!gg.match || gg.match.over || !b || !b._ggBot) return;
    b.kills++;
    b.rungKills++;
    if (b.rungKills < rungNeed(b.rung)) return;
    if (b.rung >= ladder().length - 1) { matchWon(b); return; }
    b.rung++;
    b.rungKills = 0;
    b.hp = 100;
    armBot(b);
    if (rungAt(b.rung).melee) {
      emit("final", { name: b.name, you: false });
      if (CBZ.sfx) CBZ.sfx("alarm");
    }
  }

  // ---- match end ------------------------------------------------------------------
  function matchWon(who) {
    if (!gg.match || gg.match.over) return;
    gg.match.over = true;
    gg.winner = who === "player" ? "You" : who.name;
    emit("matchend", { win: who === "player", winner: gg.winner });
    if (who === "player") { if (CBZ.winGame) CBZ.winGame("gungame"); }
    else if (CBZ.loseGame) CBZ.loseGame("outgunned");
  }

  function standings() {
    const rows = [{ name: "You", you: true, rung: gg.playerRung, kills: gg.playerKills }];
    for (const b of gg.bots) rows.push({ name: b.name, rung: b.rung, kills: b.kills });
    rows.sort((a, c) => (c.rung - a.rung) || (c.kills - a.kills));
    return rows;
  }
  CBZ.gungameStandings = standings;

  // Fills the SHARED survival result cards (state.js shows #survwin/#survlose
  // for this mode too); state.js's fillSurvResult restores what we relabel.
  function setText(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }
  function setLabelAfter(id, v) { const e = document.getElementById(id); if (e && e.nextElementSibling) e.nextElementSibling.textContent = v; }
  CBZ.gungameFillResult = function (win) {
    const rows = standings();
    const L = ladder().length;
    const time = CBZ.fmtTime ? CBZ.fmtTime(gg.match ? gg.match.t : g.elapsed) : "--";
    if (win) {
      const box = document.getElementById("survwin");
      if (box) {
        const logo = box.querySelector(".logo"); if (logo) logo.textContent = "LADDER COMPLETE";
        const sub = box.querySelector(".sub"); if (sub) sub.textContent = "Every rung climbed, finished with bare fists";
      }
      setText("swPlace", "#1"); setText("swTotal", "of " + rows.length);
      setText("swTime", time); setLabelAfter("swTime", "Match time");
      setText("swDis", gg.playerKills); setLabelAfter("swDis", "Kills");
    } else {
      let place = 1;
      for (let i = 0; i < rows.length; i++) if (rows[i].you) { place = i + 1; break; }
      const box = document.getElementById("survlose");
      if (box) {
        const logo = box.querySelector(".logo"); if (logo) logo.textContent = "OUTGUNNED";
        const sub = box.querySelector(".sub");
        if (sub) sub.textContent = (gg.winner || "Somebody") + " finished the ladder. You reached rung " +
          (gg.playerRung + 1) + " of " + L + ", " + rungLabel(rungAt(gg.playerRung));
      }
      setText("slPlace", "#" + place); setText("slTotal", "of " + rows.length);
      setText("slTime", time); setLabelAfter("slTime", "Match time");
      setText("slDis", gg.playerKills); setLabelAfter("slDis", "Kills");
    }
    if (CBZ.gungameResultCard) { try { CBZ.gungameResultCard(win); } catch (e) { console.error("[gungame result]", e); } }
  };

  // ---- damage funnel ---------------------------------------------------------------
  // Bot-fired damage lands here; the player's own guns reach bots through
  // fpsmode's gunHit -> CBZ.aiKill (wrapped below).
  function hurt(actor, dmg, imp) {
    if (!actor || dmg <= 0 || g.mode !== "gungame" || !gg.match || gg.match.over) return;
    imp = imp || {};
    if (actor === PLAYER_TGT || actor === CBZ.player || actor.isPlayer) {
      if (CBZ.player.dead || g.invuln > 0 || gg.spawnProtectT > 0) return;
      CBZ.player.hp -= dmg;
      if (CBZ.shake) CBZ.shake(Math.min(0.5, 0.08 + dmg * 0.006));
      const by = imp.by;
      emit("hurt", { dmg: dmg, fromX: by ? by.pos.x : (imp.fromX || CBZ.player.pos.x), fromZ: by ? by.pos.z : (imp.fromZ || CBZ.player.pos.z), by: by ? by.name : "" });
      if (CBZ.player.hp <= 0) playerDeath(by, imp.cause);
    } else {
      if (actor.dead) return;
      actor.hp -= dmg;
      actor._hpSeen = actor.hp;
      if (imp.by) { actor.hurtBy = imp.by; actor.hurtT = 0; }
      if (actor.hp <= 0) botDeath(actor, imp.by, imp.cause, imp.head);
    }
  }
  gg.hurt = hurt;

  // ---- CBZ.aiKill wrap ---------------------------------------------------------------
  // fpsmode's gunHit and combat.js's melee finish a non-city kill through
  // CBZ.aiKill. For a match bot that becomes a GUNGAME death; everything else
  // passes through untouched.
  const prevAiKill = CBZ.aiKill;
  CBZ.aiKill = function (victim, killer, opts) {
    if (victim && victim._ggBot) {
      if (g.mode === "gungame") {
        // a single round from the gun in hand could not have taken what the
        // bot had left unless it found the head
        const w = CBZ.weaponById && CBZ.weaponById(rungAt(gg.playerRung).id);
        const head = !!(w && victim._hpSeen > (w.damage || 30) * 1.05);
        botDeath(victim, killer, opts && opts.melee ? "melee" : (opts && opts.cause), head);
      } else if (!victim.dead) { victim.dead = true; victim.hp = 0; victim.ko = 0; }
      return;
    }
    return prevAiKill ? prevAiKill(victim, killer, opts) : undefined;
  };

  // ---- PLAYER MELEE --------------------------------------------------------------------
  // F (or the fists rung's left click) swings at the bot in front of you. Two
  // clean hits drop a man; a melee kill humiliates him down a rung. The fists
  // rung punches through this path too, so the final rung is a weapon, not a
  // prison scuffle (combat.js's jail punch took six swings to put a bot down).
  let meleeCD = 0, meleeCombo = 0, meleePending = null;
  // starts the swing (body + viewmodel); the blow LANDS ~0.14 s later, on the
  // animation's drive frame, against whoever is in front of you THEN
  function playerMelee(fromClick) {
    if (g.mode !== "gungame" || g.state !== "playing" || !gg.match || gg.match.over) return false;
    if (CBZ.player.dead || meleeCD > 0) return false;
    const fists = rungAt(gg.playerRung).melee;
    meleeCD = fists ? 0.42 : 0.6;
    gg.spawnProtectT = 0;
    meleeCombo++;
    const ch = CBZ.playerChar;
    if (ch) {
      ch.punchArm = fists ? (meleeCombo % 2 ? "r" : "l") : "l";
      ch.punchKind = fists ? (meleeCombo % 3 === 0 ? "hook" : meleeCombo % 2 ? "jab" : "cross") : "hook";
      ch.punchDur = fists ? 0.34 : 0.4;
      ch.punchT = ch.punchDur;
    }
    // the fists viewmodel swings itself when fpsmode's click path gets ok:true;
    // F / touch have to ask for it
    if (fists && !fromClick && CBZ.fpsPunchAnim) CBZ.fpsPunchAnim();
    meleePending = { t: 0.14, fists: fists };
    return true;
  }
  function landMelee(fists) {
    const P = CBZ.player.pos, yaw = CBZ.cam ? CBZ.cam.yaw : 0;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bd = 2.5;
    for (const b of gg.bots) {
      if (b.dead) continue;
      const dx = b.pos.x - P.x, dz = b.pos.z - P.z, d = Math.hypot(dx, dz);
      if (d > bd || d < 0.01) continue;
      if ((dx * fx + dz * fz) / d < 0.5) continue;
      if (Math.abs((b.pos.y || 0) - (P.y || 0)) > 1.4) continue;
      best = b; bd = d;
    }
    if (!best) { if (CBZ.sfx) CBZ.sfx("step"); return; }
    if (CBZ.fpsPunchLanded) CBZ.fpsPunchLanded(fists ? "hook" : "bash", true);
    if (CBZ.sfx) CBZ.sfx("punch");
    if (CBZ.body) CBZ.body.hit(best, { fromX: P.x, fromZ: P.z, force: 5.5 });
    if (CBZ.doHitstop) CBZ.doHitstop(0.06);
    if (CBZ.shake) CBZ.shake(0.12);
    best.hurtBy = PLAYER_TGT; best.hurtT = 0;
    // two clean hits drop a man; a melee kill humiliates him down a rung
    best.hp -= fists ? 52 : 58; best._hpSeen = best.hp;
    if (best.hp <= 0) botDeath(best, "player", "melee");
  }
  function meleeTick(dt) {
    meleeCD = Math.max(0, meleeCD - dt);
    if (!meleePending) return;
    meleePending.t -= dt;
    if (meleePending.t > 0) return;
    const f = meleePending.fists;
    meleePending = null;
    if (!CBZ.player.dead) landMelee(f);
  }
  // combat.js's jail punch took six swings to put a bot down and knew nothing
  // of the ladder: in a match every punch (fists rung click, third-person
  // unarmed, the grapple verb) is this mode's melee
  const prevPunch = CBZ.punch;
  if (prevPunch) {
    CBZ.punch = function () {
      if (g.mode === "gungame" && gg.match) return { ok: playerMelee(true), msg: "" };
      return prevPunch.apply(this, arguments);
    };
  }
  if (CBZ.grapple && CBZ.grapple.punch) {
    const prevGP = CBZ.grapple.punch;
    CBZ.grapple.punch = function () {
      if (g.mode === "gungame" && gg.match) { playerMelee(false); return; }
      return prevGP.apply(this, arguments);
    };
  }
  window.addEventListener("keydown", function (e) {
    if (e.code !== "KeyF" || e.repeat || g.mode !== "gungame" || g.state !== "playing") return;
    const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    playerMelee(false);
  });
  gg.melee = playerMelee;
  // TOUCH: a gun-game loadout is one gun, so the SWAP button has nothing to
  // swap. In this mode it becomes the melee button (fist icon); a document
  // capture listener gets there before touch.js's own handler.
  let swapSaved = null;
  const FIST_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M6.2 9.4V7.3c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v-.6c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8v.2c0-1 .8-1.7 1.8-1.7s1.7.8 1.7 1.7v.9c.2-.8.9-1.3 1.7-1.3 1 0 1.7.8 1.7 1.7v5.2c0 3.6-2.9 6.6-6.6 6.6h-1.2c-2.8 0-5.2-1.8-6.1-4.4l-.9-2.5c-.3-.9.1-1.9 1-2.3.8-.3 1.6-.1 2.1.5z"/></svg>';
  function swapButtonIsMelee(on) {
    const b = document.getElementById("tswap");
    if (!b) return;
    if (on && !swapSaved) { swapSaved = { html: b.innerHTML, label: b.getAttribute("aria-label") }; b.innerHTML = FIST_SVG; b.setAttribute("aria-label", "Melee"); }
    else if (!on && swapSaved) { b.innerHTML = swapSaved.html; if (swapSaved.label != null) b.setAttribute("aria-label", swapSaved.label); swapSaved = null; }
  }
  function swapCapture(e) {
    if (g.mode !== "gungame" || !gg.match) return;
    const t = e.target, b = document.getElementById("tswap");
    if (!b || !t || !(t === b || b.contains(t))) return;
    e.stopPropagation(); e.preventDefault();
    b.classList.add("on"); setTimeout(() => b.classList.remove("on"), 110);
    playerMelee(false);
  }
  document.addEventListener("touchstart", swapCapture, { capture: true, passive: false });
  document.addEventListener("mousedown", swapCapture, true);

  // ---- REGENERATION -------------------------------------------------------------
  // Five seconds out of the fight and you heal, the shooter's standard. It is
  // what makes breaking line of sight a real move, for you and for the bots.
  let playerQuietT = 0;
  gg.on("hurt", function () { playerQuietT = 0; });
  function regen(dt) {
    playerQuietT += dt;
    if (!CBZ.player.dead && playerQuietT > 5 && CBZ.player.hp < 100) CBZ.player.hp = Math.min(100, CBZ.player.hp + 14 * dt);
    for (const b of gg.bots) {
      if (!b.dead && b.hurtT > 5 && b.hp < 100) { b.hp = Math.min(100, b.hp + 14 * dt); b._hpSeen = b.hp; }
    }
  }

  // ---- NOISE: gunfire is heard (through CBZ.brain.perception.noise) --------------------
  // Every registered bot inside the radius hears it; through a wall the
  // radius halves (the map's colliders are the brain's occlusion this match).
  // The brain keeps the nearest/newest sound in memory.heard. A bot already in
  // a fight it can see simply doesn't act on it (decide() reads heard only
  // when nobody is in sight), which is what the old "busy" skip did.
  function noise(src, x, z, radius) {
    BR.perception.noise(x, z, radius, "gunshot", src);
  }
  let lastRounds = -1;
  function playerShotWatch() {
    const f = CBZ.fps; if (!f || !f.rounds) return;
    const n = f.rounds[f.weapon] | 0;
    if (lastRounds >= 0 && n < lastRounds && !CBZ.player.dead) {
      gg.spawnProtectT = 0;                          // firing ends your spawn shield
      noise(PLAYER_TGT, CBZ.player.pos.x, CBZ.player.pos.z, 48);
    }
    lastRounds = n;
  }

  // ---- BOT BRAIN ----------------------------------------------------------------------
  function enemiesOf(b, out) {
    out.length = 0;
    if (!CBZ.player.dead) out.push(PLAYER_TGT);
    for (const o of gg.bots) if (o !== b && !o.dead) out.push(o);
    return out;
  }
  const _cands = [];
  function leaderRung() {
    let r = gg.playerRung;
    for (const o of gg.bots) if (o.rung > r) r = o.rung;
    return r;
  }
  /* WHO IS THIS BOT FIGHTING? The senses are CBZ.brain's: the gg_bot archetype
     is this file's old numbers (70 m, the ~200 degree cone cos > -0.2, a 5 m
     touch radius), and a candidate now has to be SPOTTED — the brain's
     awareness meter, which fills fast close and centre-of-cone, slower at the
     edge of vision and on a crouched or still target, and holds 1.4 s after
     sight breaks. Before, anybody inside the cone with a clear line was seen
     on the frame he stepped into it, at 70 m, crouched or not. Three things
     skip the meter, because they are not a question of noticing: a man inside
     5 m, the man who just shot you, and the man you were already fighting.
     A candidate that is half-noticed becomes the bot's GLANCE: with nobody to
     fight it turns and checks where it caught the movement.
     Scoring (distance, who shot me, the leader is hunted, stickiness) and the
     aim model below are unchanged. */
  const GG_FOV = 1.77, GG_RANGE = 70;
  const _spot = { range: GG_RANGE, fovHalf: GG_FOV, eyeY: 1.5, targetY: 1.25 };
  function perceive(b) {
    const t = BR.now();
    const dt = b.percT < 0 ? 0 : Math.min(0.6, Math.max(0, t - b.percT));
    b.percT = t;
    const top = leaderRung();
    let best = null, bestS = Infinity, glance = null, glanceA = 0.25;
    enemiesOf(b, _cands);
    for (let i = 0; i < _cands.length; i++) {
      const e = _cands[i];
      if (!e.isPlayer && e.spawnT > 0) continue;
      if (e.isPlayer && gg.spawnProtectT > 0) continue;
      const dx = e.pos.x - b.pos.x, dz = e.pos.z - b.pos.z, d = Math.hypot(dx, dz);
      if (d > GG_RANGE) continue;
      const known = e === b.hurtBy || e === b.foe;
      _spot.fovHalf = known ? Math.PI : GG_FOV;                 // you turn to the man shooting you
      _spot.eyeY = eyeY(b) - (b.pos.y || 0);
      _spot.targetY = chestY(e) - (e.pos.y || 0);
      const aw = BR.perception.awareness(b, e, dt, _spot);
      const rec = BR.memory.lastSeen(b, e);
      if (!rec || !rec.visible) continue;                       // no line this think
      const primed = d < 5 || (e === b.hurtBy && b.hurtT < 4) || (e === b.foe && b.lostT < 1.5);
      if (aw < 1 && !primed) {
        if (aw > glanceA) { glanceA = aw; glance = e; }         // something moved over there
        continue;
      }
      let s = d;
      if (e === b.foe) s -= 10;
      if (e.isPlayer) s -= 5;                          // the human is the one everybody noticed
      if (e === b.hurtBy && b.hurtT < 4) s -= 18;
      const er = e.isPlayer ? gg.playerRung : e.rung;
      if (er >= top && top > 0) s -= 12 + er * 1.5;    // everybody hunts the leader
      if (e.isPlayer && top - gg.playerRung >= 3) s += 12;   // a trailing player gets breathing room
      if (s < bestS) { bestS = s; best = e; }
    }
    b.glance = best ? null : glance;
    if (best) {
      if (best !== b.foe || !b.foeSeen) {
        // reaction time: shorter if we were already looking for them
        const primed = (best === b.foe && b.lostT < 1.5) || (best === b.hurtBy && b.hurtT < 1.5);
        b.react = primed ? 0.12 + rand() * 0.1 : (0.55 - b.skill * 0.35) + rand() * 0.25;
        if (best !== b.foe) b.track = 0;
      }
      b.foe = best; b.foeSeen = true; b.lostT = 0;
      BR.memory.see(b, best);                          // where the fight is
    } else if (b.foe) {
      b.foeSeen = false;
    }
  }

  /* MOVEMENT GOES THROUGH CBZ.brain.act. This file's own mover (A* on the walk
     grid, the vault, the stall sidestep, all in the frame loop below) is
     registered as the gungame executor: act.moveTo writes b.goal + b.moveKind
     and the loop walks it. CBZ.moves, when it exists, is tried first by the
     brain. HARNESS TRAP: a generic CBZ.moves.moveTo knows nothing of this
     map's nav grid; if it lands without it, give this executor prefer: true. */
  function gait(b, kind) {
    const r = rungAt(b.rung);
    return kind === "strafe" ? 2.3 : kind === "back" ? 2.6 : b.mode === "retreat" ? 4.6
      : (r.melee && b.foeSeen) ? 5.4 : b.foeSeen ? 3.6 : 4.2;
  }
  BR.act.use("gungame", {
    moveTo: function (a, x, z, o) {
      const G = a.goal || (a.goal = { x: 0, z: 0 });
      G.x = x; G.z = z;
      a.moveKind = (o && o.kind) || "run";
      return true;
    },
    stop: function (a) { a.goal = null; a.moveKind = "hold"; return true; },
    face: function (a, x, z) {
      const dx = x - a.pos.x, dz = z - a.pos.z;
      if (dx * dx + dz * dz > 0.01) a.group.rotation.y = Math.atan2(dx, dz);
      return true;
    },
  });
  const _go = { speed: 0, kind: "run", arrive: 0.6, face: false };
  function go(b, x, z, kind) {
    _go.kind = kind; _go.speed = gait(b, kind);
    BR.act.moveTo(b, x, z, _go);
  }

  // where should this bot be going right now? (through go() / act.stop) + b.mode
  function decide(b) {
    const r = rungAt(b.rung), P = playOf(r);
    const foe = b.foe && !b.foe.dead ? b.foe : null;
    if (foe && b.foeSeen) {
      const dx = foe.pos.x - b.pos.x, dz = foe.pos.z - b.pos.z, d = Math.hypot(dx, dz) || 1;
      const ux = dx / d, uz = dz / d;
      // hurt and holding a gun: break line of sight
      if (b.hp < 38 && !r.melee && b.mode !== "retreat" && rand() < 0.7) {
        const hide = findCover(b, foe);
        if (hide) { b.mode = "retreat"; b.coverAt = hide; b.path = null; go(b, hide.x, hide.z, "run"); return; }
      }
      if (b.mode === "retreat" && b.coverAt && Math.hypot(b.coverAt.x - b.pos.x, b.coverAt.z - b.pos.z) > 1.2 && b.hp < 60) return;
      b.mode = "engage"; b.coverAt = null;
      const lo = P.band[0], hi = P.band[1];
      let gx, gz, kind;
      if (d > hi) { gx = foe.pos.x - ux * (hi * 0.8); gz = foe.pos.z - uz * (hi * 0.8); kind = "close"; }
      else if (d < lo && !r.melee) { gx = b.pos.x - ux * (lo - d + 2); gz = b.pos.z - uz * (lo - d + 2); kind = "back"; }
      else if (P.still && b.track > 0.4) { BR.act.stop(b); return; }
      else if (r.melee) { gx = foe.pos.x; gz = foe.pos.z; kind = "close"; }
      else {
        // strafe across the line, swapping sides on a human rhythm
        gx = b.pos.x - uz * b.strafe * 3.5; gz = b.pos.z + ux * b.strafe * 3.5; kind = "strafe";
        if (gg.nav && !navLine(gg.nav, b.pos.x, b.pos.z, gx, gz)) {
          b.strafe = -b.strafe;
          gx = b.pos.x - uz * b.strafe * 3.5; gz = b.pos.z + ux * b.strafe * 3.5;
        }
      }
      go(b, gx, gz, kind);
      return;
    }
    // no one in sight: go where the fight was (memory.lastSeen), then check the
    // movement it half-caught (the glance), then where the shooting is
    // (memory.heard), then hunt the nearest enemy (bots know roughly where
    // people are, like a radar ping every few seconds, otherwise a big map
    // goes quiet). A goal the grid could not path to is given up (giveUpT).
    b.mode = "hunt";
    const t = BR.now();
    const ls = foe ? BR.memory.lastSeen(b, foe) : null;
    if (ls && t - ls.t < 6 && ls.t > b.giveUpT) { go(b, ls.x, ls.z, "run"); return; }
    const gl = b.glance && !b.glance.dead ? BR.memory.lastSeen(b, b.glance) : null;
    if (gl && t - gl.t < 3 && gl.t > b.giveUpT) {
      go(b, gl.x, gl.z, "run");
      return;
    }
    const h = BR.memory.heard(b);
    if (h && t - h.t < 8 && h.t > b.giveUpT) { go(b, h.x, h.z, "run"); return; }
    if (!b.huntGoal || b.huntT <= 0) {
      let best = null, bd = Infinity;
      enemiesOf(b, _cands);
      for (const e of _cands) {
        let d = Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z);
        const er = e.isPlayer ? gg.playerRung : e.rung;
        d -= er * 4;                                   // drawn to the leaders
        if (d < bd) { bd = d; best = e; }
      }
      if (best) {
        const jit = 10;
        b.huntGoal = { x: best.pos.x + (rand() - 0.5) * jit, z: best.pos.z + (rand() - 0.5) * jit };
      } else if (gg.nav && gg.nav.open.length) {
        const k = gg.nav.open[(rand() * gg.nav.open.length) | 0];
        b.huntGoal = { x: cellX(gg.nav, k), z: cellZ(gg.nav, k) };
      }
      b.huntT = 5 + rand() * 4;
    }
    if (b.huntGoal) go(b, b.huntGoal.x, b.huntGoal.z, "run");
  }

  // a nearby walkable spot the foe cannot see from where it stands
  function findCover(b, foe) {
    const N = gg.nav; if (!N) return null;
    let best = null, bd = Infinity;
    for (let n = 0; n < 14; n++) {
      const a = (n / 14) * Math.PI * 2 + rand() * 0.3, rr = 4 + rand() * 7;
      const x = b.pos.x + Math.cos(a) * rr, z = b.pos.z + Math.sin(a) * rr;
      const k = cellOf(N, x, z);
      if (k < 0 || !N.walk[k]) continue;
      _probe.pos.x = x; _probe.pos.z = z; _probe.pos.y = N.floor[k];
      if (!segBlocked(N.cols, foe.pos.x, eyeY(foe), foe.pos.z, x, _probe.pos.y + 1.2, z)) continue;
      const d = Math.hypot(x - b.pos.x, z - b.pos.z) - Math.hypot(x - foe.pos.x, z - foe.pos.z) * 0.3;
      if (d < bd) { bd = d; best = { x, z }; }
    }
    return best;
  }

  // steer toward b.goal: straight when the grid says the line is open,
  // otherwise along an A* path (re-planned when the goal moves or we stall)
  let pathBudget = 0;
  const _steer = { x: 0, z: 0 };
  function steer(b, dt) {
    const N = gg.nav, goal = b.goal;
    if (!goal) return null;
    const gdx = goal.x - b.pos.x, gdz = goal.z - b.pos.z, gd = Math.hypot(gdx, gdz);
    if (gd < 0.6) { b.path = null; return null; }
    if (!N || navLine(N, b.pos.x, b.pos.z, goal.x, goal.z)) {
      b.path = null; _steer.x = goal.x; _steer.z = goal.z; return _steer;
    }
    b.repathT -= dt;
    const moved = b.pathGoal ? Math.hypot(b.pathGoal.x - goal.x, b.pathGoal.z - goal.z) : 1e9;
    if ((!b.path || moved > 4 || b.repathT <= 0) && pathBudget > 0) {
      pathBudget--;
      b.path = findPath(N, b.pos.x, b.pos.z, goal.x, goal.z);
      b.pathI = 0; b.pathGoal = { x: goal.x, z: goal.z };
      b.repathT = 1.6 + rand() * 0.8;
      if (!b.path) { b.huntT = 0; b.giveUpT = BR.now(); }
    }
    if (!b.path) return null;
    // advance through reached waypoints; skip ahead when a later one is directly walkable
    while (b.pathI < b.path.length - 1) {
      const wp = b.path[b.pathI];
      if (Math.hypot(wp.x - b.pos.x, wp.z - b.pos.z) < 0.9) { b.pathI++; continue; }
      const nx = b.path[b.pathI + 1];
      if (navLine(N, b.pos.x, b.pos.z, nx.x, nx.z)) { b.pathI++; continue; }
      break;
    }
    const wp = b.path[Math.min(b.pathI, b.path.length - 1)];
    _steer.x = wp.x; _steer.z = wp.z;
    return _steer;
  }

  // ---- bot weapons ------------------------------------------------------------------
  function botWeapon(b) { const r = rungAt(b.rung); return r.melee ? null : (CBZ.weaponById && CBZ.weaponById(r.id)); }
  let playerSpeed = 0, _ppx = 0, _ppz = 0;
  const _mz = new THREE.Vector3();
  function botFire(b, dt) {
    const foe = b.foe;
    b.meleeCD = Math.max(0, b.meleeCD - dt);
    if (!foe || foe.dead || !b.foeSeen) { b.track = Math.max(0, b.track - dt * 2); return; }
    if (foe.isPlayer && gg.spawnProtectT > 0) return;
    b.track += dt;
    if (b.react > 0) { b.react -= dt; return; }
    const dx = foe.pos.x - b.pos.x, dz = foe.pos.z - b.pos.z;
    const dh = Math.hypot(dx, dz);
    const r = rungAt(b.rung);
    // MELEE: fists always; a gun-holder bashes when someone is in its face
    if ((r.melee || (dh < 1.7 && rand() < 0.5)) && dh < 2.0 && Math.abs((foe.pos.y || 0) - (b.pos.y || 0)) < 1.5) {
      if (b.meleeCD > 0) return;
      b.meleeCD = r.melee ? 0.62 + rand() * 0.25 : 0.9;
      b.group.rotation.y = Math.atan2(dx, dz);
      if (b.char) { b.char.punchT = 0.4; b.char.punchKind = rand() < 0.5 ? "jab" : "hook"; }
      if (CBZ.body && !foe.isPlayer) CBZ.body.hit(foe, { fromX: b.pos.x, fromZ: b.pos.z, force: 5 });
      if (CBZ.sfx) CBZ.sfx("punch");
      const hitP = 0.55 + b.skill * 0.35;
      if (rand() < hitP) hurt(foe, (r.melee ? 34 + rand() * 10 : 45) * (foe.isPlayer ? 1 : 0.7), { by: b, cause: "melee" });
      return;
    }
    if (r.melee) return;
    const w = botWeapon(b);
    if (!w) return;
    b.fireCD -= dt;
    if (b.fireCD > 0) return;
    const P = playOf(r);
    if (dh > Math.min((w.range || 80) * 1.1, 110)) { b.fireCD = 0.3; return; }
    if (!canFire(b, foe)) { b.fireCD = 0.2 + rand() * 0.2; return; }
    if (CBZ.actorAimAt) CBZ.actorAimAt(b, foe);
    // cadence: autos rip short bursts and breathe; the rest run their action
    if (w.auto) {
      b.burst = (b.burst || 0) + 1;
      if (b.burst >= 3 + (rand() * 4 | 0)) { b.burst = 0; b.fireCD = 0.45 + rand() * 0.5; }
      else b.fireCD = Math.max(0.07, (w.interval || 0.1) * 1.15);
    } else {
      b.fireCD = (w.interval || 0.5) * 1.1 + 0.12 + rand() * 0.3 + (1 - b.skill) * 0.25;
    }
    const from = CBZ.actorMuzzle ? CBZ.actorMuzzle(b, _mz) : { x: b.pos.x, y: (b.pos.y || 0) + 1.4, z: b.pos.z };
    const ty = chestY(foe) + 0.1;
    const d3 = Math.hypot(dh, ty - from.y);
    // THE HIT MODEL
    let p = 0.25 + b.skill * 0.6;                                  // 0.52 .. 0.79 at point blank, settled
    p *= 1 / (1 + Math.pow(d3 / P.eff, 2));                        // the gun's effective range
    p *= 0.45 + 0.55 * Math.min(1, b.track / (1.4 - b.skill * 0.6)); // aim settles while tracking
    if (b.speed > 0.5) p *= P.still ? 0.4 : 0.8;                   // shooting on the move
    if (foe.isPlayer) {
      p *= 1 / (1 + playerSpeed * 0.07);                           // a moving target is harder
      if (CBZ.player.crouch) p *= 0.82;
      if (gg.match.t < 20) p *= 0.7;                               // the opening is a warm-up
      if (CBZ.player.hp < 30) p *= 0.8;                            // one more chance
      if (leaderRung() - gg.playerRung >= 3) p *= 0.85;           // trailing: a little mercy
    } else {
      // bots fighting bots is the backdrop, not the race: they trade slower
      // than they fight you, so the ladder is decided by the one human in it
      p *= 0.33 / (1 + (foe.speed || 0) * 0.06);
    }
    if (w.pellets > 1 || r.id === "shotgun") p = Math.min(0.95, p * 1.25);
    const hit = rand() < p;
    let to;
    if (hit) to = { x: foe.pos.x + (rand() - 0.5) * 0.3, y: ty, z: foe.pos.z + (rand() - 0.5) * 0.3 };
    else {
      // a miss cracks PAST the target, not through it
      const side = (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 1.2);
      const nx = -dz / (dh || 1), nz = dx / (dh || 1);
      to = { x: foe.pos.x + nx * side + dx / (dh || 1) * 3, y: ty + (rand() - 0.3) * 0.8, z: foe.pos.z + nz * side + dz / (dh || 1) * 3 };
    }
    if (CBZ.tracer) CBZ.tracer(from, to, { shooter: b, targetActor: foe.isPlayer ? CBZ.player : foe });
    else if (CBZ.muzzleFlash) CBZ.muzzleFlash(from, {});
    if (CBZ.gunVoice) CBZ.gunVoice(b.weapon, Math.hypot(from.x - CBZ.player.pos.x, from.z - CBZ.player.pos.z));
    else if (CBZ.sfx) CBZ.sfx("report");
    noise(b, b.pos.x, b.pos.z, 42);
    if (hit) {
      const fall = CBZ.weaponFalloffMul ? CBZ.weaponFalloffMul(w, d3) : 1;
      const head = rand() < 0.06 + b.skill * 0.08;
      const base = (w.damage || 20) * (foe.isPlayer ? 0.55 : 0.45);
      let dmg = Math.max(7, base * fall * (head ? 1.9 : 1));
      if (!foe.isPlayer) dmg = Math.min(dmg, 55);                  // no one-shot trades between bots
      hurt(foe, dmg, { by: b, cause: (r.name || "gunfire").toLowerCase(), head: head });
    }
  }

  // ---- VAULT (systems/physics.js characterTraversal) ---------------------------------
  function ggTraverse(b, dt, tx, tz, spd) {
    const T = CBZ.characterTraversal;
    if (!T || !b.char || !(CBZ.modeHas && CBZ.modeHas("traverse"))) return false;
    if (b._traversal) {
      if (b.dead || b.ko > 0) { T.cancel(b, b.char, false, "interrupted"); return false; }
      const owned = T.step(b, b.char, dt, true);
      if (!b._traversal) b._ggTravT = 0.36;
      return owned;
    }
    b._ggTravT = (b._ggTravT || 0) - dt;
    if (b._ggTravT > 0) return false;
    const vx = tx - b.pos.x, vz = tz - b.pos.z;
    if (Math.hypot(vx, vz) < 0.9) return false;
    b._ggTravT = 0.15;
    const started = T.start(b, b.char, vx, vz, {
      speed: spd, radius: 0.5,
      height: (b.char.metric && b.char.metric.height) || 1.7,
      allowTop: false, cars: false, npc: true, running: true, sprinting: spd > 4,
    });
    return !!(started && T.step(b, b.char, dt, true));
  }

  // ---- THE FRAME -----------------------------------------------------------------------
  let lastLeader = null;
  CBZ.onUpdate(23.2, function (dt) {
    if (g.mode !== "gungame" || g.state !== "playing" || !gg.match) return;
    if (!gg.match.over) gg.match.t += dt;
    pathBudget = 3;
    meleeTick(dt);
    if (gg.spawnProtectT > 0) gg.spawnProtectT = Math.max(0, gg.spawnProtectT - dt);
    if (!gg.match.over) regen(dt);

    // the player: speed (for the bots' aim), shots (noise), the zone fence
    const P = CBZ.player.pos;
    if (dt > 0) playerSpeed = playerSpeed * 0.8 + (Math.hypot(P.x - _ppx, P.z - _ppz) / dt) * 0.2;
    _ppx = P.x; _ppz = P.z;
    playerShotWatch();
    if (!CBZ.player.dead && !CBZ.player._death) clampZone(P, 0.5);

    // death cam: third person, turned on whoever did it
    if (CBZ.player.dead && gg.killer && gg.killer.bot && CBZ.cam) {
      const k = gg.killer.bot;
      const want = Math.atan2(-(k.pos.x - P.x), -(k.pos.z - P.z));
      CBZ.cam.yaw = CBZ.lerpAngle ? CBZ.lerpAngle(CBZ.cam.yaw, want, 1 - Math.pow(0.02, dt)) : want;
      CBZ.cam.pitch = CBZ.cam.pitch + (0.18 - CBZ.cam.pitch) * Math.min(1, dt * 3);
    }
    if (CBZ.player.dead && gg.respawnT > 0 && !gg.match.over) {
      gg.respawnT -= dt;
      if (gg.respawnT <= 0) respawnPlayer();
    }

    const camx = CBZ.camera.position.x, camz = CBZ.camera.position.z;
    for (let i = 0; i < gg.bots.length; i++) {
      const b = gg.bots[i];
      if (b.dead) {
        if (!gg.match.over) { b.respawnT -= dt; if (b.respawnT <= 0) respawnBot(b); }
        continue;
      }
      // a KO in this mode is a finish (combat.js's melee can KO instead of kill)
      if (b.ko > 0) { botDeath(b, "player", "melee"); continue; }
      // shot by the player through fpsmode (hp moved without passing hurt())
      if (b.hp < b._hpSeen - 0.5) { b.hurtBy = PLAYER_TGT; b.hurtT = 0; b.react = Math.min(b.react, 0.15); }
      b._hpSeen = b.hp;
      b.hurtT += dt; b.lostT += dt; b.spawnT = Math.max(0, b.spawnT - dt);
      b.huntT = (b.huntT || 0) - dt;
      b.strafeT -= dt;
      if (b.strafeT <= 0) { b.strafe = -b.strafe; b.strafeT = 0.6 + rand() * 1.3; }
      if (gg.match.over) { b.speed = 0; continue; }
      if (CBZ.body && CBZ.body.busy(b)) continue;

      const dx = b.pos.x - camx, dz = b.pos.z - camz;
      const near = dx * dx + dz * dz < ANIM_DIST2;
      b.thinkT -= dt;
      if (b.thinkT <= 0) {
        b.thinkT = near ? 0.12 + rand() * 0.06 : 0.3 + rand() * 0.1;
        perceive(b);
        decide(b);
      }

      // locomotion
      const st = steer(b, dt);
      let spd = 0;
      if (st) {
        spd = gait(b, b.moveKind);
        if (ggTraverse(b, dt, st.x, st.z, spd)) continue;
        const tx = st.x - b.pos.x, tz = st.z - b.pos.z, dist = Math.hypot(tx, tz);
        if (dist > 0.05) {
          const step = Math.min(dist, spd * dt);
          b.pos.x += tx / dist * step; b.pos.z += tz / dist * step;
        }
        if (!(b.foe && b.foeSeen) && CBZ.lerpAngle) b.group.rotation.y = CBZ.lerpAngle(b.group.rotation.y, Math.atan2(tx, tz), 1 - Math.pow(0.002, dt));
      }
      b.speed = spd;
      if (CBZ.collide) CBZ.collide(b.pos, 0.5, b.pos.y, b.pos.y + 1.7);
      clampZone(b.pos, 0.6);
      b.pos.y = mapFloor(b.pos.x, b.pos.z);
      // stall detection: wanted to move, didn't -> replan / sidestep
      if (spd > 0) {
        const moved = Math.hypot(b.pos.x - b.lastX, b.pos.z - b.lastZ);
        if (moved < spd * dt * 0.25) b.stuckT += dt; else b.stuckT = Math.max(0, b.stuckT - dt * 2);
        if (b.stuckT > 0.8) { b.stuckT = 0; b.path = null; b.repathT = 0; b.strafe = -b.strafe; b.huntT = 0; }
      }
      b.lastX = b.pos.x; b.lastZ = b.pos.z;
      if (near && CBZ.animChar) CBZ.animChar(b.char, b.speed, dt);
      // hold the gun on the foe every animated frame (animChar just wrote walk-swing over the arms)
      if (b.foe && b.foeSeen && !b.foe.dead) {
        if (b.armed && CBZ.actorAimAt) { if (near) CBZ.actorAimAt(b, b.foe, dt); else b.group.rotation.y = Math.atan2(b.foe.pos.x - b.pos.x, b.foe.pos.z - b.pos.z); }
        else if (CBZ.lerpAngle) {
          const fx = b.foe.pos.x - b.pos.x, fz = b.foe.pos.z - b.pos.z;
          if (fx * fx + fz * fz > 0.01) b.group.rotation.y = CBZ.lerpAngle(b.group.rotation.y, Math.atan2(fx, fz), 1 - Math.pow(0.0005, dt));
        }
      }
      botFire(b, dt);
    }

    // the race: announce leader changes
    let lead = { name: "You", rung: gg.playerRung, kills: gg.playerKills, you: true };
    for (const b of gg.bots) if (b.rung > lead.rung || (b.rung === lead.rung && b.kills > lead.kills)) lead = { name: b.name, rung: b.rung, kills: b.kills, you: false };
    if (lead.name !== lastLeader && lead.rung > 0) {
      lastLeader = lead.name; gg.leader = lead.name;
      emit("leader", { name: lead.name, rung: lead.rung, you: lead.you });
    }
  });

  // separation — the shared contact solver
  const sepList = [];
  const playerEntry = { pos: null, _p: true, isPlayer: true, r: 0.55 };
  CBZ.onUpdate(26.2, function (dt) {
    if (g.mode !== "gungame" || !gg.match || !CBZ.humanContact) return;
    sepList.length = 0;
    for (let i = 0; i < gg.bots.length; i++) {
      const b = gg.bots[i];
      if (!b.dead && !(CBZ.body && CBZ.body.busy(b))) sepList.push(b);
    }
    if (!CBZ.player.dead) { playerEntry.pos = CBZ.player.pos; playerEntry.r = CBZ.player.radius || 0.55; sepList.push(playerEntry); }
    CBZ.humanContact.resolve(sepList, dt, {
      mode: "gungame",
      clamp(a) {
        if (CBZ.collide) CBZ.collide(a.pos, a.r || 0.5, a.pos.y, a.pos.y + 1.7);
        if (!a._p) a.pos.y = mapFloor(a.pos.x, a.pos.z);
      },
    });
  });

  // ---- the light ------------------------------------------------------------------------
  // One time of day per map, held for the whole match (daynight.js advances
  // the clock at order 2; re-pinning just before it keeps it still).
  CBZ.onAlways(1.9, function () {
    if (g.mode !== "gungame" || !gg.match || !CBZ.dayPhase) return;
    const ph = curMap().phase;
    if (ph != null) CBZ.dayPhase(ph);
  });
  // island: survival's onAlways(93) only lights ITS mode; re-aim the sun and
  // widen the shadow box over the island for a gungame match, and restore the
  // escape shadow box once on the way out.
  let islandLit = false;
  CBZ.onAlways(93.6, function () {
    const onIsland = g.mode === "gungame" && curMap().id === "island" && CBZ.surv && CBZ.surv.arena;
    const sun = CBZ.sun;
    if (!onIsland) {
      if (islandLit && sun && sun.shadow) {
        islandLit = false;
        sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
        sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
        sun.shadow.camera.far = 260;
        if (sun.shadow.camera.updateProjectionMatrix) sun.shadow.camera.updateProjectionMatrix();
      }
      return;
    }
    const A = CBZ.surv.arena;
    if (sun) {
      if (!islandLit && sun.shadow) {
        islandLit = true;
        sun.shadow.camera.left = -132; sun.shadow.camera.right = 132;
        sun.shadow.camera.top = 132; sun.shadow.camera.bottom = -132;
        sun.shadow.camera.far = 420;
        if (sun.shadow.camera.updateProjectionMatrix) sun.shadow.camera.updateProjectionMatrix();
      }
      sun.position.set(A.center.x + 70, 140, A.center.z - 50);
    }
    if (CBZ.sunTarget) CBZ.sunTarget.position.set(A.center.x, 6, A.center.z);
  });

  // ---- title-card map picker -----------------------------------------------------------
  function refreshNote() {
    const note = document.getElementById("gungameMapNote");
    if (!note) return;
    note.textContent = curMap().label + ". " + ladder().length + " rungs, every kill climbs one. A melee kill drops the victim a rung. Win on bare fists.";
  }
  function setMap(id) {
    g.gungameMap = MAPS[id] ? id : "jail";
    const holder = document.getElementById("gungameMapSelect");
    if (holder) Array.from(holder.children).forEach((c) => c.classList.toggle("active", c.dataset.map === g.gungameMap));
    refreshNote();
  }
  CBZ.setGungameMap = setMap;
  function buildMapButtons() {
    const holder = document.getElementById("gungameMapSelect");
    if (!holder || holder.childElementCount) return;
    Object.keys(MAPS).forEach((id) => {
      const m = MAPS[id];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "gg-map-btn" + (g.gungameMap === id ? " active" : "");
      b.dataset.map = id;
      const s = document.createElement("span"); s.textContent = m.label;
      const sm = document.createElement("small"); sm.textContent = m.small;
      b.appendChild(s); b.appendChild(sm);
      b.addEventListener("click", () => setMap(id));
      holder.appendChild(b);
    });
    refreshNote();
  }
  buildMapButtons();

  // ---- the mode descriptor ----------------------------------------------------------------
  function startMatch() {
    const map = curMap();
    if (!map.ensure()) console.error("[gungame] map failed to build:", map.id);
    installFloor();
    if (CBZ.prisonRoot) CBZ.prisonRoot.visible = map.id === "jail";
    const A = CBZ.surv && CBZ.surv.arena;
    if (A) {
      A.root.visible = map.id === "island";
      if (map.id === "island" && A.reset) { try { A.reset(); } catch (e) { console.error("[gungame arena reset]", e); } }
    }
    if (map.id === "jail") hidePrisonCast(); else restorePrisonCast();
    clearDrops();
    showZoneFence(map.id === "island");
    if (CBZ.fx) CBZ.fx.clear();
    if (CBZ.clearGore) CBZ.clearGore();
    if (CBZ.killFeedReset) CBZ.killFeedReset();
    if (CBZ.clearSpectate) CBZ.clearSpectate();
    g.koLog = g.koLog || {};
    g.kos = g.kos || 0;
    // no sentence follows you into the arena
    g.detection = 0; g.strikeHeatFloor = 0; g.witnessReportT = 0; g.lastKnown = null;
    if (CBZ.releasePlayerCell) { try { CBZ.releasePlayerCell(); } catch (e) {} }
    gg.heatAtStart = g.detection;
    if (map.phase != null && CBZ.dayPhase) CBZ.dayPhase(map.phase);

    despawnBots();
    gg.nav = buildNav();
    // the brain's walls, for this match: the same collider boxes the rounds hit
    // (cleared in gungameExit; see the contract gap noted on ggOcclusion)
    BR.perception.setOcclusion(ggOcclusion);
    gg.spawnPool = gg.nav ? gg.nav.open.map((k) => ({ x: cellX(gg.nav, k), z: cellZ(gg.nav, k) })) : [];
    gg.playerRung = 0; gg.playerRungKills = 0; gg.playerKills = 0; gg.playerDeaths = 0;
    gg.respawnT = 0; gg.winner = null; gg.killer = null; gg.leader = null; lastLeader = null;
    gg.match = { t: 0, over: false };
    gg.matchesPlayed++;
    spawnBots(Math.max(1, CBZ.CONFIG.GUNGAME_BOTS | 0));

    const p = spawnPoint("player");
    const gy = mapFloor(p.x, p.z);
    CBZ.player.pos.set(p.x, gy, p.z);
    _ppx = p.x; _ppz = p.z; playerSpeed = 0; lastRounds = -1;
    CBZ.player.vy = 0; CBZ.player.grounded = true;
    CBZ.player.hp = 100; CBZ.player.dead = false; CBZ.player.ko = 0; CBZ.player.stun = 0;
    CBZ.player._death = null;
    if (CBZ.player._phys) { CBZ.player._phys.air = false; CBZ.player._phys.down = 0; CBZ.player._phys.kx = CBZ.player._phys.kz = 0; }
    CBZ.player.stamina = (CBZ.SURV && CBZ.SURV.staminaMax) || 100;
    CBZ.player.sprint = false; CBZ.player.crouch = false;
    CBZ.player.captureState = "normal"; CBZ.player.captureT = 0;
    if (CBZ.playerChar.cuffed) CBZ.playerChar.cuffed = false;
    if (CBZ.player._bandMesh) CBZ.player._bandMesh.visible = false;
    CBZ.playerChar.group.position.copy(CBZ.player.pos);
    const bb = zoneBox(map.zone);
    const face = bb ? Math.atan2((bb.minX + bb.maxX) / 2 - p.x, (bb.minZ + bb.maxZ) / 2 - p.z) : rand() * 6.28;
    CBZ.playerChar.group.rotation.set(0, face, 0);
    CBZ.playerChar.group.scale.y = 1;
    if (CBZ.cam) { CBZ.cam.yaw = face + Math.PI; CBZ.cam.pitch = 0.1; }
    if (CBZ.resetZoom) CBZ.resetZoom();
    gg.spawnProtectT = 2.0;
    grantPlayerRung();
    if (CBZ.setObjective) CBZ.setObjective("Gun Game on " + map.label + ". Win on bare fists.");
    swapButtonIsMelee(true);
    playerQuietT = 0;
    emit("matchstart", { map: map.id, label: map.label });
  }

  // clean EXIT (state.js calls this whenever setMode leaves gungame)
  CBZ.gungameExit = function () {
    swapButtonIsMelee(false);
    despawnBots();
    clearDrops();
    showZoneFence(false);
    restorePrisonCast();
    gg.match = null;
    gg.respawnT = 0;
    gg.nav = null;
    BR.perception.setOcclusion(null);                 // back to the brain's default walls
    CBZ.player._death = null;
    if (CBZ.resetWeaponInventory) CBZ.resetWeaponInventory();
    if (CBZ.fpsResetWeapons) CBZ.fpsResetWeapons();
  };

  CBZ.registerMode("gungame", {
    id: "gungame",
    label: "Gun Game",
    objective: "Pick a map. Everyone starts on the same pistol and every kill climbs one rung of the weapon ladder. A melee kill knocks the victim down a rung. The last rung is bare fists: land that kill and the match is yours.",
    build() { buildMapButtons(); },
    reset() { startMatch(); },
    winStats() {
      return [
        { label: "Rungs", value: ladder().length + "/" + ladder().length },
        { label: "Kills", value: gg.playerKills },
        { label: "Match time", value: CBZ.fmtTime ? CBZ.fmtTime(gg.match ? gg.match.t : g.elapsed) : "--" },
      ];
    },
  });

  // ---- THE URL DOOR, ANSWERED LATE ----------------------------------------------------------
  // state.js answers ?mode=gungame at parse time, before this file registered
  // the mode, and normalised it to escape. Re-answer it once, now.
  try {
    const want = (typeof location !== "undefined" && location.search &&
      new URLSearchParams(location.search).get("mode")) || CBZ.START_MODE;
    if (want === "gungame" && g.mode !== "gungame" && g.state !== "playing" && CBZ.setMode) CBZ.setMode("gungame");
  } catch (e) {}

  // ---- audit -----------------------------------------------------------------------------------
  CBZ.gungameAudit = function () {
    const L = ladder();
    let alive = 0, listed = 0, leadBot = null, seeing = 0, pathing = 0, stuck = 0;
    for (const b of gg.bots) {
      if (!b.dead) alive++;
      if (b.foeSeen) seeing++;
      if (b.path) pathing++;
      if (b.stuckT > 0.4) stuck++;
      if (!leadBot || b.rung > leadBot.rung || (b.rung === leadBot.rung && b.kills > leadBot.kills)) leadBot = b;
    }
    for (const n of CBZ.npcs || []) if (n && n._ggBot) listed++;
    const leaderR = Math.max(gg.playerRung, leadBot ? leadBot.rung : 0);
    const N = gg.nav;
    return {
      maps: Object.keys(MAPS),
      map: g.gungameMap || "jail",
      rungs: L.length,
      killsPerRung: Math.max(1, CBZ.CONFIG.GUNGAME_KILLS_PER_RUNG | 0),
      bots: gg.bots.length,
      aliveBots: alive,
      npcListed: listed,
      playerRung: gg.playerRung,
      playerKills: gg.playerKills, playerDeaths: gg.playerDeaths,
      leaderRung: leaderR,
      leaderName: leadBot && leadBot.rung > gg.playerRung ? leadBot.name : "You",
      botKills: gg.bots.reduce((s, b) => s + b.kills, 0),
      seeing: seeing, pathing: pathing, stuck: stuck,
      nav: N ? { w: N.w, h: N.h, cells: N.cells, open: N.open.length, cols: N.cols.length } : null,
      matchT: gg.match ? +gg.match.t.toFixed(1) : 0,
      matchesPlayed: gg.matchesPlayed,
      matchOver: !!(gg.match && gg.match.over),
      spawnPool: gg.spawnPool.length,
      hiddenCast: gg.hiddenCast.length,
      zoneFence: FENCE.group && FENCE.group.visible ? { panels: FENCE.group.userData.panels, posts: FENCE.group.userData.posts } : null,
      droppedGuns: drops.length,
      // THE RATCHET (pin at 0): heat that arrived during a match means the
      // prison's wanted machine reached a deathmatch again, whatever the source.
      prisonLeak: (gg.match && g.mode === "gungame")
        ? Math.max(0, Math.round(((g.detection || 0) - gg.heatAtStart) * 100) / 100)
        : 0,
      borrowedWorlds: { jail: !!CBZ.prisonRoot, island: !!(CBZ.surv && CBZ.surv.built) },
    };
  };
})();
