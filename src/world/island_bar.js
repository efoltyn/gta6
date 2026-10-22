/* ============================================================
   world/island_bar.js — THE ISLANDS' BARS.

   Every town island has a bar or two (world/island_plan.js lot.use "bar"):
   the place the evening goes. This file fits one out on its building's
   ground floor (CBZ.islandVenue.on("bar")):

     THE BAR       a long counter down the right-hand wall, panelled front,
                   a brass foot rail, beer taps on the top; behind it the
                   back bar: a cabinet, a mirror and three shelves of
                   bottles, a television up in the corner; stools along it
                   (real seats: city/propuse.js sits you on one)
     BOOTHS        down the other wall: high-backed benches facing over a
                   table, each a pair of seats
     A POOL TABLE  in the back half when the room has the floor for it
     THE LIGHT     dark boards, dark wainscot, warm pendants low over the
                   counter, the booths and the table; nothing else lit
     THE BARTENDER one of the island's own people (CBZ.islandVenue.staff)
                   behind the counter from opening (16:00) to closing (02:00)
     A DRINK       at the counter while he is at it: [E] Drink $8 — the
                   money, then city/drinking.js's drunk level (one is a
                   buzz, several put you on the floor), a little food and
                   a little patch-up, as Gang City's bar pours it
     THE CROWD     world/island_people.js stands the drinkers (its
                   customers: an evening crowd from six, thickest from
                   eight to midnight, the last of them out by two)
     A FIGHT       late on, two of them who have had enough go for each
                   other: the city's own fight (ped.rage), their posts
                   given up; the bar's other people react the way the
                   street's people always do

   API: CBZ.islandBars = { list(), drink(bar), state() }
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  if (!window.THREE) return;
  const g = CBZ.game || (CBZ.game = {});

  const PRICE = 8;
  const OPEN = [16, 2];
  const WOOD = 0x3a2417, WOOD2 = 0x52331f, TOP = 0x6b4a2e, BRASS = 0xb08d4a, FLOOR = 0x2e1e14, WAINS = 0x3b2a1e;
  const FELT = 0x1f5a34, WARM = 0xffc27a;
  const bars = [];

  function hour() { return CBZ.islandFit && CBZ.islandFit.hour ? CBZ.islandFit.hour() : (CBZ.cityHour ? CBZ.cityHour() : 20); }
  function onShift(H) { const h = hour(), a = H[0], z = H[1]; return a <= z ? (h >= a && h < z) : (h >= a || h < z); }
  function hsh(s) { return CBZ.islandFit && CBZ.islandFit.hash ? CBZ.islandFit.hash(s) : 0.5; }

  function fitBar(b, lot, job) {
    const IV = CBZ.islandVenue, FIT = CBZ.islandFit;
    if (!IV || !FIT || !b.interior || !b.group) return null;
    IV.clear(b, 0);
    const R = FIT.room(b, 0);
    const W = R.x1 - R.x0, D = R.z1 - R.z0;
    if (W < 4.6 || D < 6.5) return null;
    const F = IV.floor(b, 0), y = F.yLocal + 0.012;
    const ceil = FIT.ceil(b, 0);
    const K = FIT.kit(b, { name: "bar" });
    const keepOut = F.keepOut || [];
    const free = function (r) {
      for (const q of keepOut) if (q.why !== "stairs" && r.x1 > q.x0 && r.x0 < q.x1 && r.z1 > q.z0 && r.z0 < q.z1) return false;
      return true;
    };
    const salt = (b.planId | 0) * 7 + Math.round(b.ox);

    // ---- THE ROOM: dark boards, a dark wainscot round the walls
    K.lbox((R.x0 + R.x1) / 2, y - 0.006, (R.z0 + R.z1) / 2, W, 0.012, D, FLOOR, { nb: true });
    for (let i = 1; i < Math.floor(W / 0.18); i++) K.lbox(R.x0 + i * 0.18, y + 0.0005, (R.z0 + R.z1) / 2, 0.008, 0.002, D, 0x23170f, { nb: true });
    for (const e of [["x0", R.x0 + 0.015], ["x1", R.x1 - 0.015]]) K.lbox(e[1], y + 0.55, (R.z0 + R.z1) / 2, 0.03, 1.1, D, WAINS);
    K.lbox((R.x0 + R.x1) / 2, y + 0.55, R.z1 - 0.015, W, 1.1, 0.03, WAINS);
    for (const e of [R.x0 + 0.035, R.x1 - 0.035]) K.lbox(e, y + 1.11, (R.z0 + R.z1) / 2, 0.05, 0.04, D, WOOD2);

    // ---- THE COUNTER down the +x wall, the bartender's aisle behind it
    const BACK = 0.95, CD = 0.62, CH = 1.08;
    const cx = R.x1 - BACK - CD / 2;
    const cz0 = R.z0 + 2.5, cz1 = R.z1 - 0.9;
    const CL = cz1 - cz0, czc = (cz0 + cz1) / 2;
    if (CL < 2.4) return null;
    K.lbox(cx, y + (CH - 0.05) / 2, czc, CD, CH - 0.05, CL, WOOD, { solid: true, noStep: true, y1: F.yLocal + CH });
    K.lbox(cx - 0.02, y + CH - 0.025, czc, CD + 0.12, 0.05, CL + 0.1, TOP);
    // the hinged flap at the front end (the bartender's way in), the panelling
    K.lbox(cx, y + CH - 0.02, cz0 - 0.35, CD, 0.04, 0.7, TOP);
    for (let i = 0; i < Math.floor(CL / 0.9); i++) K.lbox(cx - CD / 2 - 0.006, y + 0.55, cz0 + 0.45 + i * 0.9, 0.012, 0.7, 0.72, WOOD2);
    // the foot rail on its brackets
    K.lbox(cx - CD / 2 - 0.22, y + 0.18, czc, 0.05, 0.05, CL - 0.1, BRASS);
    for (let z = cz0 + 0.3; z < cz1; z += 1.2) K.lbox(cx - CD / 2 - 0.11, y + 0.18, z, 0.22, 0.03, 0.03, BRASS);
    // the taps, a towel, the glasses rack
    const tz = czc - CL * 0.2;
    K.lbox(cx + 0.1, y + CH + 0.06, tz, 0.08, 0.12, 0.6, 0x9aa0a6);
    for (let i = 0; i < 4; i++) {
      K.lbox(cx + 0.1, y + CH + 0.22, tz - 0.22 + i * 0.15, 0.03, 0.2, 0.03, 0xc8ccd2);
      K.lbox(cx + 0.1, y + CH + 0.36, tz - 0.22 + i * 0.15, 0.04, 0.09, 0.04, [0x1a1a1a, 0x8a2b20, 0x1f4a6e, 0xc9a44a][i]);
    }
    K.lbox(cx + 0.2, y + CH + 0.01, czc + CL * 0.25, 0.3, 0.015, 0.5, 0x1b1f24);
    for (let i = 0; i < 6; i++) K.lbox(cx + 0.2, y + CH + 0.075, czc + CL * 0.25 - 0.2 + i * 0.08, 0.06, 0.12, 0.06, 0xd8e4e8, { glass: true });

    // ---- THE BACK BAR: cabinet, mirror, three shelves of bottles
    const bx = R.x1 - 0.24;
    K.lbox(bx, y + 0.45, czc, 0.44, 0.9, CL, WOOD, { solid: true, noStep: true });
    K.lbox(bx - 0.01, y + 0.915, czc, 0.48, 0.03, CL + 0.04, TOP);
    K.lbox(R.x1 - 0.03, y + 1.7, czc, 0.02, 1.3, CL - 0.4, 0x8a979c);
    const BOT = [0x6b3a12, 0x2f5a2a, 0xd8d0b8, 0x8a5a1a, 0x3a1a10, 0x9ab0a0, 0x5a1a22];
    for (let s = 0; s < 3; s++) {
      const sy = y + 1.25 + s * 0.42;
      K.lbox(R.x1 - 0.13, sy, czc, 0.2, 0.025, CL - 0.3, WOOD2);
      const n = Math.floor((CL - 0.5) / 0.11);
      for (let i = 0; i < n; i++) {
        const z = cz0 + 0.3 + i * 0.11 + (hsh(salt + ":" + s + ":" + i) - 0.5) * 0.02;
        const hb = 0.22 + hsh(i + ":" + s + salt) * 0.1, col = BOT[(hsh(s * 31 + i + salt) * BOT.length) | 0];
        K.lbox(R.x1 - 0.13, sy + 0.0125 + hb / 2, z, 0.07, hb, 0.07, col, { glass: hsh(i * 3 + s) < 0.4 });
        K.lbox(R.x1 - 0.13, sy + 0.0125 + hb + 0.035, z, 0.025, 0.07, 0.025, col);
      }
    }
    // the television up in the front corner, over the counter
    K.lbox(R.x1 - 0.08, ceil - 0.55, cz0 + 0.1, 0.06, 0.5, 0.86, 0x111214);
    K.lbox(R.x1 - 0.115, ceil - 0.55, cz0 + 0.1, 0.005, 0.44, 0.8, 0x1c3a4e, { glow: true });
    // pendants low over the counter
    for (let z = cz0 + 0.6; z < cz1 - 0.3; z += 1.5) pendant(K, cx - 0.05, z, ceil, y + 1.95);

    // ---- STOOLS along the counter, facing it
    const stools = [];
    for (let z = cz0 + 0.4; z < cz1 - 0.2; z += 0.72) {
      const sx = cx - CD / 2 - 0.5;
      if (!free({ x0: sx - 0.25, x1: sx + 0.25, z0: z - 0.25, z1: z + 0.25 })) continue;
      K.furnish("stool", sx, z, y, Math.PI / 2, { tone: { cloth: 0x5a1f22 } });
      stools.push({ lx: sx, lz: z });
    }

    // ---- BOOTHS down the -x wall
    const booths = [];
    const BL = 1.25, bX = R.x0 + 0.08 + BL / 2;
    for (let zc = R.z0 + 2.6 + 0.95; zc + 0.95 < R.z1 - 0.1; zc += 2.0) {
      const r = { x0: R.x0, x1: R.x0 + BL + 0.2, z0: zc - 0.95, z1: zc + 0.95 };
      if (!free(r)) continue;
      K.furnish("bench", bX, zc - 0.62, y, 0, { len: BL, back: true, tone: { wood: WOOD2 } });
      K.furnish("bench", bX, zc + 0.62, y, Math.PI, { len: BL, back: true, tone: { wood: WOOD2 } });
      // the high backs, a table between, a lamp low over it
      for (const s of [-1, 1]) K.lbox(bX, y + 0.72, zc + s * 0.93, BL, 1.44, 0.06, WOOD, { solid: true });
      K.lbox(bX, y + 0.37, zc, 0.12, 0.74, 0.12, 0x1a1612);
      K.lbox(bX, y + 0.75, zc, BL - 0.15, 0.04, 0.62, TOP, { solid: true, y0: F.yLocal + 0.6, y1: F.yLocal + 0.77 });
      pendant(K, bX, zc, ceil, y + 1.7);
      booths.push({ lx: bX, lz: zc });
    }

    // ---- THE POOL TABLE: the back half, along the room, when there is floor
    const mx0 = R.x0 + BL + 0.35, mx1 = cx - CD / 2 - 1.1;
    const PL = 2.3, PW = 1.25;
    let pool = null;
    const pxc = (mx0 + mx1) / 2, pzc = R.z1 - 0.9 - PL / 2 - 0.8;
    if (mx1 - mx0 >= PW + 1.5 && pzc - PL / 2 - 0.9 > R.z0 + 2.6) {
      const r = { x0: pxc - PW / 2 - 0.2, x1: pxc + PW / 2 + 0.2, z0: pzc - PL / 2 - 0.2, z1: pzc + PL / 2 + 0.2 };
      if (free(r)) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.lbox(pxc + sx * (PW / 2 - 0.12), y + 0.33, pzc + sz * (PL / 2 - 0.15), 0.12, 0.66, 0.12, WOOD);
        K.lbox(pxc, y + 0.71, pzc, PW, 0.12, PL, WOOD, { solid: true, y0: F.yLocal + 0.05, y1: F.yLocal + 0.82 });
        K.lbox(pxc, y + 0.775, pzc, PW - 0.16, 0.01, PL - 0.16, FELT);
        for (const sx of [-1, 1]) K.lbox(pxc + sx * (PW / 2 - 0.04), y + 0.8, pzc, 0.08, 0.04, PL, WOOD2);
        for (const sz of [-1, 1]) K.lbox(pxc, y + 0.8, pzc + sz * (PL / 2 - 0.04), PW, 0.04, 0.08, WOOD2);
        for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) {
          if (sx === 0) { K.lbox(pxc + sz * (PW / 2 - 0.07), y + 0.782, pzc, 0.07, 0.01, 0.1, 0x0a0a0a); continue; }
          K.lbox(pxc + sx * (PW / 2 - 0.07), y + 0.782, pzc + sz * (PL / 2 - 0.07), 0.09, 0.01, 0.09, 0x0a0a0a);
        }
        // the balls racked, two cues across the felt
        const BALL = [0xf2efe6, 0xe0b020, 0x1f3a8a, 0xb02020, 0x5a2a7a, 0xe06a1a, 0x1f6a3a, 0x6a1a1a, 0x101010];
        for (let i = 0; i < 9; i++) K.lbox(pxc + ((i % 3) - 1) * 0.06, y + 0.81, pzc + PL * 0.22 + Math.floor(i / 3) * 0.055, 0.05, 0.05, 0.05, BALL[i]);
        K.lbox(pxc - 0.2, y + 0.795, pzc - 0.1, 0.025, 0.025, 1.45, 0xc9a46a);
        // the long shade over it
        K.lbox(pxc, ceil - 0.6, pzc, 0.4, 0.12, 1.5, 0x1f4a2e);
        K.lbox(pxc, ceil - 0.67, pzc, 0.34, 0.02, 1.4, WARM, { glow: true });
        K.lbox(pxc, (ceil - 0.6 + ceil) / 2, pzc, 0.02, 0.6, 0.02, 0x1a1a1a);
        pool = { lx: pxc, lz: pzc };
      }
    }
    // a dartboard on the back wall, the name over the counter end
    K.lbox(R.x0 + (W * 0.55), y + 1.73, R.z1 - 0.04, 0.46, 0.46, 0.04, 0x1a1612);
    K.lbox(R.x0 + (W * 0.55), y + 1.73, R.z1 - 0.065, 0.36, 0.36, 0.01, 0xd8cfa8);
    K.lbox(R.x0 + (W * 0.55), y + 1.73, R.z1 - 0.07, 0.12, 0.12, 0.01, 0xa02020);
    if (b.name && FIT.text && FIT.panel) {
      const tex = FIT.text([b.name.toUpperCase()], { bg: "#1a120c", fg: "#e2b86a", w: 512, h: 96, border: false });
      if (tex) FIT.panel(b, null, R.x1 - 0.05, ceil - 0.3, czc + CL * 0.15, 1.8, 0.34, -Math.PI / 2, tex, false);
    }
    K.flush();
    if (IV.claim) IV.claim(b, 0, { x0: R.x0, x1: R.x1, z0: R.z0 + 2.4, z1: R.z1 });

    // ---- THE BARTENDER behind the counter, facing the stools
    const postL = { lx: R.x1 - BACK * 0.5 - 0.15, lz: czc, face: -Math.PI / 2 };
    const look = function (Pp, p) {
      const Pl = CBZ.player && CBZ.player.pos;
      return Pl && Math.hypot(Pl.x - p.pos.x, Pl.z - p.pos.z) < 6 ? { x: Pl.x, z: Pl.z } : null;
    };
    const post = IV.staff ? IV.staff(b, postL.lx, postL.lz, postL.face, { job: "bartender", hours: OPEN, near: 120, look: look }) : null;
    const isle = IV.island ? IV.island(b) : null;
    const bar = {
      b: b, post: post, F: F, stools: stools, booths: booths, pool: !!pool, isle: isle,
      // where you order: the counter top over each stool
      spots: stools.map(function (s) { const w = F.toWorld(cx - 0.1, s.lz); return { bar: null, x: w.x, y: F.y + CH + 0.1, z: w.z, reach: 2.2, dot: 0.35 }; }),
      box: F.bounds, fy: F.y,
      inside: function (x, z) { const q = F.toLocal(x, z); return q.x > R.x0 - 0.2 && q.x < R.x1 + 0.2 && q.z > R.z0 - 0.2 && q.z < R.z1 + 0.2; },
      fightT: 40 + hsh(salt + "f") * 80,
    };
    for (const s of bar.spots) s.bar = bar;
    bars.push(bar);
    wire();
    return function () { const i = bars.indexOf(bar); if (i >= 0) bars.splice(i, 1); };
  }
  // a warm pendant: the flex, the shade, the bulb glowing under it
  function pendant(K, lx, lz, ceil, ly) {
    K.lbox(lx, (ceil + ly + 0.14) / 2, lz, 0.015, ceil - ly - 0.14, 0.015, 0x1a1a1a);
    K.lbox(lx, ly + 0.08, lz, 0.32, 0.14, 0.32, 0x2a2014);
    K.lbox(lx, ly - 0.005, lz, 0.2, 0.03, 0.2, WARM, { glow: true });
  }

  /* ---- A DRINK ------------------------------------------------------------ */
  function bartender(bar) {
    const p = bar && bar.post && bar.post.body ? bar.post.body() : null;
    if (!p || p.dead || (p.ko || 0) > 0 || p._upT > 0 || p.state === "flee" || p.rage) return null;
    if (Math.hypot(p.pos.x - bar.post.x, p.pos.z - bar.post.z) > 1.2) return null;
    return p;
  }
  function drink(bar) {
    const P = CBZ.player;
    if (!bar || !P || !bartender(bar) || !CBZ.city || !CBZ.city.spend) return false;
    if (!CBZ.city.spend(PRICE)) { if (CBZ.city.note) CBZ.city.note("$" + PRICE, 1.2); return false; }
    if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
    g.hunger = Math.min(100, (g.hunger || 0) + 10);
    P._boost = 10;
    if (P.hp != null && P.maxHp) P.hp = Math.min(P.maxHp, P.hp + 6);
    if (CBZ.cityDrink) CBZ.cityDrink(1);
    if (CBZ.cityHudDirty) { try { CBZ.cityHudDirty(); } catch (e) {} }
    return true;
  }
  let wired = false;
  const _list = [];
  function wire() {
    if (wired || !CBZ.islandFit || !CBZ.islandFit.fixtures) return;
    wired = true;
    CBZ.islandFit.fixtures("isle-bar", {
      prio: 8,
      list: function (ctx, px, pz) {
        _list.length = 0;
        for (const bar of bars) if (bar.inside(px, pz)) for (const s of bar.spots) _list.push(s);
        return _list.length ? _list : null;
      },
      reach: function (s) { return s.reach; },
      dot: function (s) { return s.dot; },
      name: function () { return ""; },
      verbs: [
        { id: "isle-bar-drink", slot: "e", prio: 6, label: "Drink $" + PRICE,
          canShow: function (s) { return !!(s && s.bar && bartender(s.bar)); }, onSelect: function (s) { drink(s.bar); } },
      ],
    });
  }

  /* ---- LATE ON: A FIGHT --------------------------------------------------- */
  function drinkersIn(bar) {
    const out = [];
    for (const p of CBZ.cityPeds || []) {
      if (!p || p.dead || p._customer !== "bar" || !p._islandPost || p._islandPost.b !== bar.b || !(p.staffPost || p._propSeat)) continue;
      out.push(p);
    }
    return out;
  }
  /* A SEAT FOR A DRINKER (world/island_people.js stands the evening's crowd
     on them): a free stool or booth seat in this bar (city/propuse.js's
     seats, the ones the stools and benches registered), stools first */
  const _seats = [];
  function freeSeat(b) {
    const bar = bars.find(function (x) { return x.b === b; });
    if (!bar || !CBZ.propSeatsIn) return null;
    const B = bar.box;
    CBZ.propSeatsIn(B.x0, B.x1, B.z0, B.z1, bar.fy, _seats);
    const free = _seats.filter(function (r) { return !r.occupant && !r.tipped; });
    if (!free.length) return null;
    free.sort(function (a, c) { return (a.kind === "stool" ? 0 : 1) - (c.kind === "stool" ? 0 : 1) || Math.random() - 0.5; });
    return free[0];
  }
  function brawl(a, c) {
    for (const p of [a, c]) {
      if (p._propSeat && CBZ.propStand) CBZ.propStand(p, { instant: true });
      p.staffPost = null; p._islandPost = null; p.controlled = false; p.path = null;
    }
    a.rage = c; a.state = "fight";
    c.rage = a; c.state = "fight";
    if (CBZ.speech && CBZ.speech.say) { try { CBZ.speech.say(a, "You what?", { force: true }); } catch (e) {} }
  }
  let tickT = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(35.7, function (dt) {
    if (!g || g.mode !== "archipelago" || g.state !== "playing" || !bars.length) return;
    tickT -= dt;
    if (tickT > 0) return;
    tickT = 1;
    const Pl = CBZ.player && CBZ.player.pos;
    if (!Pl) return;
    const h = hour();
    const late = h >= 21 || h < 2;
    for (const bar of bars) {
      if (!late || Math.hypot(Pl.x - bar.b.x, Pl.z - bar.b.z) > 45) continue;
      bar.fightT -= 1;
      if (bar.fightT > 0) continue;
      bar.fightT = 120 + Math.random() * 180;
      const D = drinkersIn(bar);
      if (D.length < 3) continue;
      const i = (Math.random() * D.length) | 0;
      let j = (Math.random() * (D.length - 1)) | 0; if (j >= i) j++;
      brawl(D[i], D[j]);
    }
  });

  CBZ.islandBars = {
    list: function () { return bars.slice(); },
    drink: drink, freeSeat: freeSeat,
    state: function () {
      return bars.map(function (bar) {
        return { name: bar.b.name || null, stools: bar.stools.length, booths: bar.booths.length, pool: bar.pool,
          bartender: !!bartender(bar), drinkers: drinkersIn(bar).length, open: onShift(OPEN) };
      });
    },
  };
  if (CBZ.islandVenue && CBZ.islandVenue.on) CBZ.islandVenue.on("bar", fitBar);
})();
