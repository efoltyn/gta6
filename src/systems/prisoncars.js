/* ============================================================
   systems/prisoncars.js — THE CARS. A YARD SORTS ITSELF BY RACE.

   OWNER (2026-09-28): "look at the colorful bands on people's arms. That's
   really dumb. Instead of a colorful band showing what gang you're in, it's
   the race. We already have races. Make races more clear and make more of
   them. And those are the gangs. That's how it is in real life."

   WHAT WAS HERE. entities/ai.js dealt the yard into two gangs, the Reds and
   the Blues, hung a red or blue box on each member's left forearm, painted a
   red and a blue disc on the yard floor under their corners, and put the
   colour in the name plate ("Mack  Reds"). That is a video game's idea of a
   prison. Nobody in a real yard wears a colour to say who he runs with; you
   can SEE who he runs with, because it is who he looks like.

   HOW A REAL US YARD WORKS (the design note, kept short and factual).
   General-population yards in US state prisons self-segregate by race and
   region, a system inmates call "cars" (or "cars"/"tables"/"politics").
   California is the textbook case and uses the same five or six headings its
   own paperwork does: Black, White, Southern Hispanic ("Southsiders"),
   Northern Hispanic (kept on different yards from Southerners because the two
   are at war, so a given yard is one or the other), Mexican nationals
   ("Paisas"), and "Others" (Asian, Pacific Islander, Native American, Middle
   Eastern and anybody who does not fit; some yards run Asians as their own
   car). Mixed-race men usually ride with the car they were raised in or are
   read as, and otherwise with the Others.
     - Membership is not a choice you make on the yard. A new arrival is met
       inside his first hours by somebody from his own car ("who you with,
       where you from, what are you in for, got paperwork?"), told the rules
       and, if his paperwork is clean, taken in. Refusing your car leaves you
       with no protection and nobody's business.
     - Each car has its own politics: a shot-caller (the "key holder") who
       speaks for it, men who put in work, and men who just do their time
       under its umbrella. Every man of the race is under the car; only some
       are active in its business.
     - The unwritten rules are the same everywhere: you eat at your car's
       tables and sit only in its seats (mess hall, dayroom, yard benches);
       you do not share food, drinks, smokes or a cup with another car; you
       use your car's phone and shower slot, in your car's turn; you do not
       stand in another car's spot on the yard; and a problem with another
       car goes through your shot-caller, not your fists.
     - Breaking a rule is answered: the other car tells you once, then puts
       hands on you; your own car disciplines you for the embarrassment, since
       one man's disrespect is the whole car's problem.
   PLAYER-FACING NAMES (owner, 2026-09-30): use recognizable real gang
   names instead of "White car" / "Black car". Internal car IDs remain the
   yard partition keys; they are not the text shown to the player. These
   six gameplay factions simplify affiliations, not a historical roster.
   A man outside a faction's active business is labeled Independent by
   interact.js. Tattoos remain the existing generic ink cultures.

   WHAT THIS FILE OWNS (everything the arm band used to fake):
     CARS           the catalogue: index = the int ai.js keeps in `n.gang`
                    and `n.yardCar` (0 is the old Reds' corner, 1 the old Blues').
     carOf(actor)   membership from HERITAGE (heritage.js car field), never
                    from a coin toss; the player's comes off his own body.
     tension        car x car politics: rises on fights between their men,
                    decays back to a baseline; rivalOf(car) is who a car's
                    business is currently pointed at.
     seats          the mess hall's tables and the yard benches, partitioned
                    by car (contiguous runs of stools, sized by headcount).
     lines          the three phones (by car) and the shower rotation (by
                    car, in turn, during the morning unlock).
     errand(n)      where a man walks when he is not busy: his car's end of
                    the table at chow, his car's spot on the yard, his car's
                    phone, his car's shower turn. ai.js's wander calls it.
     rules          the player breaking them (another car's seat, phone or
                    shower; sharing across cars) and what happens next.
     the claim      data for ai.js's arrival: his car comes to get him.

   SHOW, DON'T TELL: nothing is printed. You learn the rules the way a new
   man does: somebody walks up and tells you, once.
============================================================ */
(function () {
  "use strict";
  const CBZ = typeof window !== "undefined" ? window.CBZ : globalThis.CBZ;
  if (!CBZ) return;

  // ---- 1. THE CATALOGUE ------------------------------------------------------
  // yard: the car's spot on the north yard (x, z, radius). The first two are
  // where the Reds' and the Blues' corners always were, so every coordinate
  // that was tuned against them still means something.
  // phone: which of the three yard phones is theirs (world/yardfurniture.js
  // phone bank at x 11, z 17: phones at x 9.85 / 11.0 / 12.15).
  const CARS = [
    { id: "south",  label: "Sureños", phrase: "the Sureños", yard: { x: -22, z: 30, r: 6.5 }, phone: 0 },
    { id: "black",  label: "Black Guerrilla Family", phrase: "the Black Guerrilla Family", yard: { x: 22, z: 16, r: 6.5 }, phone: 1 },
    { id: "white",  label: "Aryan Brotherhood", phrase: "the Aryan Brotherhood", yard: { x: 7, z: 32, r: 6.0 }, phone: 2 },
    { id: "paisa",  label: "Border Brothers", phrase: "the Border Brothers", yard: { x: -12, z: 39, r: 5.5 }, phone: 0 },
    { id: "asian",  label: "Asian Boyz", phrase: "the Asian Boyz", yard: { x: -3, z: 46, r: 5.0 }, phone: 2 },
    { id: "others", label: "Independents", phrase: "the Independents", yard: { x: 11, z: 45, r: 5.0 }, phone: 2 },
  ];
  const N = CARS.length;
  const IDX = {};
  for (let i = 0; i < N; i++) IDX[CARS[i].id] = i;

  // heritage -> car, used only when heritage.js is older than this file (its
  // defs carry `car` and CBZ.heritageCar reads it)
  const FALLBACK = {
    black: "black", caribbean: "black",
    white: "white", skinhead: "white", easteuro: "white",
    latino: "south", centralam: "south", carlatino: "south",
    mexican: "paisa",
    eastasian: "asian", seasian: "asian", filipino: "asian",
    southasian: "others", mideast: "others", native: "others", islander: "others", mixed: "others",
  };
  function carOfHeritage(h) {
    if (!h) return -1;
    let id = null;
    if (CBZ.heritageCar) { try { id = CBZ.heritageCar(h); } catch (e) { id = null; } }
    if (!id) id = FALLBACK[h] || null;
    return id != null && IDX[id] != null ? IDX[id] : -1;
  }
  function heritageOf(a) {
    return (a && a.char && a.char.heritage) || (a && a.heritage) || null;
  }
  function isPlayer(a) { return !!(a && (a === CBZ.player || a.isPlayer)); }

  // THE PLAYER'S RACE comes off his own body: the heritage his rig was rolled
  // with, or (the default convict is built from bare colours) the heritage
  // whose skin range holds his skin tone, weighted by how common it is.
  function lum3(h) { return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }
  function heritageBySkin(skin) {
    const H = CBZ.HERITAGE;
    if (!H || skin == null) return null;
    const s = lum3(skin);
    let best = null, bs = Infinity;
    for (const id of Object.keys(H)) {
      const d = H[id];
      if (!d || !d.skins || !(d.weight > 0)) continue;
      for (const k of d.skins) {
        const t = lum3(k);
        const dist = Math.abs(s[0] - t[0]) + Math.abs(s[1] - t[1]) + Math.abs(s[2] - t[2]);
        const score = dist - Math.log(1 + d.weight) * 2;          // ties go to the common heritage
        if (score < bs) { bs = score; best = id; }
      }
    }
    return best;
  }
  /* LEAVING A CAR. Membership used to be pure heritage, so nothing could
     take a man OUT of his car: systems/prisonsnitch.js cast the player out for
     talking and could only park a private flag on him (`_carOutcast`) that
     the seat, phone and shower rules here never read, so a known rat still
     sat at his car's table, used its phone and showered in its turn.
     The state lives HERE now. `leave(why)` puts the player out ("outcast":
     his car turned on him); `rejoin()` is the new-run reset. While he is out:
       playerCar()   -1. Every consumer that asks "which car is he" (the
                     rules below, ai.js's recruit/claim/hostility, interact.js's
                     offer) gets NOBODY'S, which is what a cast-out man is.
       bloodCar()    the car his heritage puts him in, for the few callers that
                     need where he CAME from (the old car's grudge).
       the rules     every car's seat is somebody else's seat, every phone is
                     somebody else's phone, every shower turn is somebody
                     else's turn, and his OLD car is the one that answers first
                     at its own table. */
  const member = { out: false, why: "", t: 0, from: -1 };
  function isOut() { return !!(member.out || (CBZ.player && CBZ.player._carOutcast)); }
  function bloodCar() {
    const p = CBZ.player;
    if (!p) return -1;
    if (typeof p.yardCar === "number" && p.yardCar >= 0) return p.yardCar;
    const ch = CBZ.playerChar;
    let h = ch && ch.heritage;
    if (!h && ch) h = heritageBySkin(ch.skinTone);
    const c = h ? carOfHeritage(h) : -1;
    return c >= 0 ? c : IDX.white;
  }
  function leave(why) {
    const P = CBZ.player;
    if (member.out) return false;
    member.from = bloodCar();
    member.out = true; member.why = why || "outcast"; member.t = now();
    if (P) {
      P._carOutcast = true;                      // the old flag, kept as the mirror other code may read
      if (P.gang != null && P.gang >= 0) P.gang = null;
    }
    if (CBZ.game) CBZ.game.carClaim = "outcast";
    return true;
  }
  function rejoin() {
    member.out = false; member.why = ""; member.t = 0; member.from = -1;
    if (CBZ.player) CBZ.player._carOutcast = false;
  }
  function status() { return isOut() ? (member.why || "outcast") : "member"; }
  function playerCar() {
    const p = CBZ.player;
    if (!p) return -1;
    if (isOut()) return -1;
    if (typeof p.yardCar === "number" && p.yardCar >= 0) return p.yardCar;
    const ch = CBZ.playerChar;
    let h = ch && ch.heritage;
    if (!h && ch) h = heritageBySkin(ch.skinTone);
    const c = h ? carOfHeritage(h) : -1;
    return c >= 0 ? c : IDX.white;
  }
  function carOf(a) {
    if (!a) return -1;
    if (isPlayer(a)) return playerCar();
    if (a.kind === "guard" || a.kind === "warden") return -1;
    if (typeof a.yardCar === "number") return a.yardCar;
    const h = heritageOf(a) || (a.char && a.char.skinTone != null ? heritageBySkin(a.char.skinTone) : null);
    return carOfHeritage(h);
  }
  function label(i) { return i >= 0 && CARS[i] ? CARS[i].label : ""; }
  function phrase(i) { return i >= 0 && CARS[i] ? CARS[i].phrase : "the block"; }

  // ---- 2. POLITICS: car x car tension ----------------------------------------
  // 0..100. A baseline (the old Reds/Blues feud survives as South vs Black;
  // the rest start cool) plus what the yard has done lately.
  const BASE = [];
  for (let i = 0; i < N; i++) { BASE.push(new Array(N).fill(4)); BASE[i][i] = 0; }
  function base(a, b, v) { BASE[IDX[a]][IDX[b]] = v; BASE[IDX[b]][IDX[a]] = v; }
  base("south", "black", 22);
  base("white", "black", 14);
  base("south", "white", 8);
  base("south", "paisa", 2);           // Mexican cars: separate politics, rarely at odds
  base("asian", "others", 2);
  const T = BASE.map((r) => r.slice());
  function tension(a, b) { return a >= 0 && b >= 0 && a !== b && T[a] ? T[a][b] : 0; }
  function addTension(a, b, v) {
    if (!(a >= 0 && b >= 0) || a === b || !T[a] || !T[b]) return;
    const x = Math.max(0, Math.min(100, T[a][b] + v));
    T[a][b] = x; T[b][a] = x;
  }
  function atOdds(a, b) { return tension(a, b) >= 30; }
  function rivalOf(a) {
    if (!(a >= 0) || !T[a]) return a === 0 ? 1 : 0;
    let best = -1, bv = -1;
    for (let b = 0; b < N; b++) {
      if (b === a) continue;
      if (T[a][b] > bv) { bv = T[a][b]; best = b; }
    }
    return best;
  }
  // a fight between men of two cars is the two cars' business
  function incident(x, y, v) {
    const a = carOf(x), b = carOf(y);
    if (a >= 0 && b >= 0 && a !== b) addTension(a, b, v == null ? 5 : v);
  }
  function decay(dt) {
    for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) {
      const t = T[a][b], bb = BASE[a][b];
      const n2 = t > bb ? Math.max(bb, t - dt * 0.05) : Math.min(bb, t + dt * 0.02);
      T[a][b] = n2; T[b][a] = n2;
    }
  }
  function resetPolitics() { for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) T[a][b] = BASE[a][b]; }

  // ---- 3. THE SEATS -----------------------------------------------------------
  // Mess hall: stools in contiguous runs per car, sized by how many men that
  // car has in the building (largest remainder, never fewer than 2 for a car
  // that exists). Order along the tables follows the car order below so the
  // two biggest cars sit at opposite ends of the room.
  const TABLE_ORDER = ["black", "others", "asian", "white", "paisa", "south"];
  function headcount() {
    const c = new Array(N).fill(0);
    for (const n of CBZ.npcs || []) {
      if (!n || n.dead || n.escaped || n._crowd) continue;
      if (!(n.kind === "inmate" || n.role === "inmate")) continue;
      const k = carOf(n);
      if (k >= 0) c[k]++;
    }
    return c;
  }
  let messPool = null, yardPool = null, messKey = "";
  function allotMess(seats, force) {
    if (!seats || !seats.length) return;
    const counts = headcount();
    const key = seats.length + "|" + counts.join(",");
    if (!force && key === messKey && messPool === seats) return;
    messPool = seats; messKey = key;
    // group into table rows (stools either side of a table share a row)
    const byZ = seats.slice().sort((a, b) => a.z - b.z);
    const rows = [];
    for (const s of byZ) {
      const last = rows[rows.length - 1];
      if (last && s.z - last.z1 < 1.6) { last.list.push(s); last.z1 = s.z; }
      else rows.push({ z1: s.z, list: [s] });
    }
    const ordered = [];
    for (const r of rows) {
      r.list.sort((a, b) => (a.x - b.x) || (a.z - b.z));
      for (const s of r.list) ordered.push(s);
    }
    const total = ordered.length;
    const cars = TABLE_ORDER.map((id) => IDX[id]).filter((i) => counts[i] > 0);
    if (!cars.length) { for (const s of ordered) s._car = -1; return; }
    const sum = cars.reduce((t, i) => t + counts[i], 0);
    const quota = cars.map((i) => Math.max(2, Math.floor(total * counts[i] / sum)));
    let used = quota.reduce((t, q) => t + q, 0);
    // trim the biggest while over, hand the remainder to the biggest while under
    while (used > total) { let bi = 0; for (let k = 1; k < quota.length; k++) if (quota[k] > quota[bi]) bi = k; if (quota[bi] <= 1) break; quota[bi]--; used--; }
    const rem = cars.map((i, k) => ({ k, r: total * counts[i] / sum - quota[k] })).sort((a, b) => b.r - a.r);
    for (let j = 0; used < total; j = (j + 1) % rem.length) { quota[rem[j].k]++; used++; }
    let at = 0;
    for (let k = 0; k < cars.length; k++) for (let q = 0; q < quota[k] && at < total; q++) ordered[at++]._car = cars[k];
    while (at < total) ordered[at++]._car = cars[cars.length - 1];
  }
  // yard benches belong to the car whose spot they sit in; the rest are anybody's
  function allotYard(seats) {
    if (!seats || yardPool === seats) return;
    yardPool = seats;
    for (const s of seats) {
      s._car = -1;
      let bd = Infinity;
      for (let i = 0; i < N; i++) {
        const y = CARS[i].yard, d = Math.hypot(s.x - y.x, s.z - y.z);
        if (d < y.r + 3 && d < bd) { bd = d; s._car = i; }
      }
    }
  }
  function seatOwner(seat) { return seat && typeof seat._car === "number" ? seat._car : -1; }
  function maySit(actor, seat) {
    const o = seatOwner(seat);
    return o < 0 || o === carOf(actor);
  }
  // the middle of a car's run of stools: where he walks to at chow
  function messSpot(car) {
    if (!messPool) return null;
    let x = 0, z = 0, k = 0;
    for (const s of messPool) if (s._car === car) { x += s.x; z += s.z; k++; }
    return k ? { x: x / k, z: z / k } : null;
  }

  // ---- 4. THE LINES: phones and showers ---------------------------------------
  const PHONES = [{ x: 9.85, z: 17.65 }, { x: 11.0, z: 17.65 }, { x: 12.15, z: 17.65 }];
  const PHONE_YAW = Math.PI;                         // facing the panel (-z)
  // world/cellblock.js north row: the shower alcove x[-15.5,-13.24],
  // z[-43.5,-38.0], open to the south, roses on the west wall at z -42.25
  // and -39.65. One car showers at a time, in turn, during the unlock.
  const SHOWER = { heads: [{ x: -15.0, z: -42.25 }, { x: -15.0, z: -39.65 }], mouth: { x: -14.37, z: -37.2 }, yaw: -Math.PI / 2 };
  const SHOWER_ORDER = ["white", "black", "south", "paisa", "asian", "others"].map((id) => IDX[id]);
  function sched() { const S = CBZ.prisonSchedule; return S && S.enabled && S.enabled() ? S : null; }
  function blockId() { const S = sched(); return S ? S.id() : "yard"; }
  function showerTurn() {
    const S = sched();
    if (!S || S.id() !== "wake") return -1;
    const h = S.hour();                              // 05:00 .. 07:00
    const k = Math.max(0, Math.min(SHOWER_ORDER.length - 1, Math.floor((h - 5) / 2 * SHOWER_ORDER.length)));
    return SHOWER_ORDER[k];
  }
  const holders = { phone: [null, null, null], shower: [null, null] };
  function live(a) { return !!(a && !a.dead && !(a.ko > 0) && !a.escaped); }
  function freeSlot(list, i, n) { const h = list[i]; return !h || h === n || !live(h) || h._carErrand == null || h._carErrand.slot !== i; }

  // ---- 5. ERRANDS: where a man walks when nothing else wants him --------------
  function now() { return (CBZ.game && CBZ.game.elapsed) || ((CBZ.now || 0) / 1000); }
  function hash01(n, salt) {
    const name = (n && n.data && n.data.name) || "";
    let h = 2166136261 ^ salt;
    const key = name + "|" + (n.id != null ? n.id : "") + "|" + ((n.region && n.region.join(",")) || "");
    for (let k = 0; k < key.length; k++) { h ^= key.charCodeAt(k); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 10000) / 10000;
  }
  function northYardMan(n) {
    const r = n.region, W = CBZ.WORLD && CBZ.WORLD.northYard;
    if (!r || !W) return true;
    const cx = (r[0] + r[1]) / 2, cz = (r[2] + r[3]) / 2;
    return cx > W.x0 - 2 && cx < W.x1 + 2 && cz > W.z0 - 2 && cz < W.z1 + 2;
  }
  function release(n) {
    const e = n._carErrand;
    if (!e) return;
    if (e.kind === "phone" && holders.phone[e.slot] === n) holders.phone[e.slot] = null;
    if (e.kind === "shower" && holders.shower[e.slot] === n) holders.shower[e.slot] = null;
    if (e.seat && e.seat._carFor === n) e.seat._carFor = null;
    n._carErrand = null;
  }
  /* HIS STOOL AT HIS CAR'S TABLE. Chow used to send a man at the middle of
     his car's run give or take two metres, and he sat only if a free stool of
     his car happened to be within reach when the 2 Hz sweep looked: measured,
     one man seated in forty seconds of chow and half the room circling. Now
     he is handed one free stool of his car's run (reserved for him, so two men
     never walk at the same one) and walks to IT; systems/prisonrest.js sits
     him on it when he gets there. A man who cannot reach the hall from where
     he stands (another yard, a racked gate: the nav grid has no route) is not
     sent at all. */
  function mealSeat(n, car) {
    if (!messPool) return null;
    const gp = n.group.position;
    let best = null, bd = Infinity;
    for (const s of messPool) {
      if (s._car !== car || (s.occupant && s.occupant !== n)) continue;
      const f = s._carFor;
      if (f && f !== n && live(f) && f._carErrand && f._carErrand.seat === s) continue;
      const d = (s.x - gp.x) * (s.x - gp.x) + (s.z - gp.z) * (s.z - gp.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  function reachable(n, x, z) {
    const N = CBZ.prisonNav;
    if (!N || !N.ready || !N.ready() || !N.plan) return true;     // no grid: let the mover try
    return !!N.plan(n.group.position, { x, z });
  }
  function rnd() { return CBZ.econ && CBZ.econ.rng ? CBZ.econ.rng() : Math.random(); }
  function setTarget(n, x, z) { if (n.target && n.target.set) n.target.set(x, 0, z); }
  /* errand(n) -> true when it has set n.target (ai.js's wander then leaves
     him be). Called on the wander re-think (every 1.5-4.5 s), not per frame. */
  function errand(n) {
    if (!n || !n.group || !n.target || n._crowd) return false;
    if (!(CBZ.game && CBZ.game.mode === "escape")) return false;
    if (n.role === "merchant" || n.role === "dealer") return false;
    const car = carOf(n);
    if (car < 0) return false;
    const blk = blockId();
    const t = now();
    const gp = n.group.position;
    let e = n._carErrand;
    if (e && (e.until < t || e.block !== blk)) { release(n); e = null; }
    if (e) {
      // on the spot: hold still and face it; otherwise keep walking there
      const d = Math.hypot(gp.x - e.x, gp.z - e.z);
      setTarget(n, e.x, e.z);
      if (d < 0.8 && e.yaw != null) {
        n.pause = Math.max(n.pause || 0, 2.5);
        n._faceYaw = e.yaw; n._faceTTL = 3.0;
      }
      return true;
    }
    const chow = blk === "mess" || blk === "supper";
    const cell = !!(n.data && n.data.cell);
    if (chow) {
      // most of the yard goes to chow, and every man to his own car's run
      if (hash01(n, 51) > 0.85) return false;
      // a man behind his own bars, or kept at his bunk by the wing's cast
      // (world/cellblock.js), is not walking anywhere: sending him would only
      // hold a stool nobody else may take
      if (n._cellPose || (CBZ.cellblock && CBZ.cellblock.held && CBZ.cellblock.held(n))) return false;
      if (n._chowNo === blk + "|" + Math.floor(t / 60)) return false;   // no route this minute
      const seat = mealSeat(n, car);
      if (seat) {
        if (!reachable(n, seat.x, seat.z)) { n._chowNo = blk + "|" + Math.floor(t / 60); return false; }
        seat._carFor = n;
        n._carErrand = { kind: "mess", block: blk, until: t + 900, seat, x: seat.x, z: seat.z, yaw: null };
        setTarget(n, seat.x, seat.z);
        return true;
      }
      // his car's run is full: he stands with his people at their end
      const spot = messSpot(car);
      if (!spot || !reachable(n, spot.x, spot.z)) return false;
      const a = rnd() * Math.PI * 2, r = 0.8 + rnd() * 1.2;
      n._carErrand = { kind: "mess", block: blk, until: t + 40, x: spot.x + Math.cos(a) * r, z: spot.z + Math.sin(a) * r * 0.6, yaw: null };
      setTarget(n, n._carErrand.x, n._carErrand.z);
      return true;
    }
    if (blk === "wake") {
      // his car's shower turn, if he is in the house for it
      const S = sched();
      const inside = S && S.inBlock ? S.inBlock(gp.x, gp.z, 0.5) : false;
      if (!inside || showerTurn() !== car || rnd() > 0.35) return false;
      for (let i = 0; i < SHOWER.heads.length; i++) {
        if (!freeSlot(holders.shower, i, n)) continue;
        holders.shower[i] = n;
        const H = SHOWER.heads[i];
        n._carErrand = { kind: "shower", slot: i, block: blk, until: t + 10 + rnd() * 8, x: H.x, z: H.z, yaw: SHOWER.yaw };
        setTarget(n, H.x, H.z);
        return true;
      }
      // both heads taken: wait at the mouth of the alcove, his turn is next
      n._carErrand = { kind: "showerLine", block: blk, until: t + 6, x: SHOWER.mouth.x + (rnd() - 0.5) * 0.8, z: SHOWER.mouth.z + 0.4 + rnd() * 1.2, yaw: Math.PI };
      setTarget(n, n._carErrand.x, n._carErrand.z);
      return true;
    }
    if (blk !== "yard" && blk !== "work") return false;
    if (cell || !northYardMan(n)) return false;
    // the phone: a man's own car's phone, or the line behind it
    if (rnd() < 0.05) {
      const slot = CARS[car].phone;
      const P = PHONES[slot];
      if (freeSlot(holders.phone, slot, n)) {
        holders.phone[slot] = n;
        n._carErrand = { kind: "phone", slot, block: blk, until: t + 12 + rnd() * 18, x: P.x, z: P.z, yaw: PHONE_YAW };
      } else {
        n._carErrand = { kind: "phoneLine", block: blk, until: t + 8, x: P.x + (rnd() - 0.5) * 0.3, z: P.z + 1.0 + rnd() * 1.4, yaw: PHONE_YAW };
      }
      setTarget(n, n._carErrand.x, n._carErrand.z);
      return true;
    }
    // otherwise: his car's spot on the yard, about half the time
    if (rnd() < 0.5) {
      const Y = CARS[car].yard;
      const a = rnd() * Math.PI * 2, r = 1 + rnd() * (Y.r - 1);
      setTarget(n, Y.x + Math.cos(a) * r, Y.z + Math.sin(a) * r);
      return true;
    }
    return false;
  }
  function onYardSpot(car, x, z, pad) {
    const Y = CARS[car] && CARS[car].yard;
    return !!Y && Math.hypot(x - Y.x, z - Y.z) < Y.r + (pad || 0);
  }

  // ---- 6. THE RULES (the player) ---------------------------------------------
  // Another car's seat, another car's phone, the shower out of your car's
  // turn: the car it belongs to tells you once, then puts hands on you, and
  // your own car pays for the embarrassment. Sharing smokes or food with
  // another car: your own car sees it and corrects you.
  const RULE_LINE = {
    seat: ["Wrong table.", "You lost? That's ours.", "Get up. Your people sit over there."],
    phone: ["That's our phone.", "Your phone's down there.", "Hang it up."],
    shower: ["Not your turn.", "Wait for your people's turn.", "Out. We're up."],
  };
  // what his OLD car says to a man it put out, at its own table / phone / slot
  const OUTCAST_LINE = {
    seat: ["You don't sit with us no more.", "Get up. You know why.", "Nah. Not here."],
    phone: ["You don't touch our phone.", "Put it down. You're done here."],
    shower: ["You shower when we're gone.", "Not with us. Out."],
  };
  const OWN_LINE = {
    seat: "Get up. That's not our table.",
    phone: "Use our phone.",
    shower: "Wait for our turn.",
    share: "We don't share with them.",
  };
  const viol = { kind: "", yardCar: -1, t: 0, warned: 0, warnAt: 0, by: null, hands: false };
  const strikes = { share: 0, rules: 0 };
  function pick(list) { return list[(rnd() * list.length) | 0]; }
  function pdist(n) { const p = CBZ.player.pos, q = n.group.position; return Math.hypot(p.x - q.x, p.z - q.z); }
  // the man of `car` who comes to say it: an active one, close, with nerve
  function enforcerOf(car, maxD, not) {
    let best = null, bs = -Infinity;
    for (const n of CBZ.npcs || []) {
      if (!live(n) || !n.group || n === not || carOf(n) !== car) continue;
      if (n.approach || n.aiState === "fight" || (n.huntPlayer || 0) > 0 || n.cuffed) continue;
      if (n.role === "merchant" || n.role === "dealer") continue;
      const d = pdist(n);
      if (d > maxD) continue;
      const nerve = (n.personality && n.personality.nerve) || 0.5;
      const s = (n.gang >= 0 ? 2 : 0) + (n.crewRole === "enforcer" || n.crewRole === "shotcaller" ? 1.5 : 0) + nerve - d * 0.12;
      if (s > bs) { bs = s; best = n; }
    }
    return best;
  }
  function sayOver(n, text, secs) {
    if (!n || !text) return;
    if (CBZ.prisonSay) CBZ.prisonSay(n, text, { secs: secs || 2.4, force: true });
  }
  function playerViolation() {
    const P = CBZ.player, g = CBZ.game;
    if (!P || !g || g.mode !== "escape" || g.role === "cop" || P.dead) return null;
    // an outcast is nobody's (mine = -1): every owned seat, phone and shower
    // turn below belongs to somebody else, his old car's included
    const mine = playerCar();
    // 1. sitting in another car's seat
    const seat = P._propSeat;
    if (seat) {
      const o = seatOwner(seat);
      if (o >= 0 && o !== mine) return { kind: "seat", yardCar: o };
    }
    const p = P.pos;
    if (!p) return null;
    // 2. on another car's phone
    for (let i = 0; i < PHONES.length; i++) {
      if (Math.hypot(p.x - PHONES[i].x, p.z - PHONES[i].z) > 0.75) continue;
      const own = CARS.filter((c) => c.phone === i).map((c) => IDX[c.id]);
      if (own.indexOf(mine) < 0) return { kind: "phone", yardCar: own[0] };
    }
    // 3. in the showers out of turn
    const turn = showerTurn();
    if (turn >= 0 && turn !== mine && p.x > -15.6 && p.x < -13.1 && p.z > -43.6 && p.z < -38.3) return { kind: "shower", yardCar: turn };
    return null;
  }
  function tickRules(dt) {
    const v = playerViolation();
    if (!v) {
      if (viol.kind) { viol.t = Math.max(0, viol.t - dt * 2); if (viol.t <= 0) { viol.kind = ""; viol.hands = false; } }
      return;
    }
    if (v.kind !== viol.kind || v.yardCar !== viol.yardCar) { viol.kind = v.kind; viol.yardCar = v.yardCar; viol.t = 0; viol.warned = 0; viol.by = null; viol.hands = false; }
    viol.t += dt;
    const g = CBZ.game;
    const mine = playerCar();
    // once: somebody of theirs walks up and says it
    if (!viol.warned && viol.t > 2.5) {
      const m = enforcerOf(v.yardCar, 16);
      if (m && CBZ.prisonStartApproach) {
        const exiled = isOut() && v.yardCar === member.from;
        const ok = CBZ.prisonStartApproach(m, "turfWarning", 0, { forced: true, shove: true, carRule: v.kind,
          msg: pick((exiled ? OUTCAST_LINE : RULE_LINE)[v.kind]), motive: exiled ? "outcast" : "yard rules" });
        if (ok) { viol.warned = 1; viol.warnAt = viol.t; viol.by = m; }
      } else if (viol.t > 6) { viol.warned = 1; viol.warnAt = viol.t; }
    }
    // still there: hands, and it goes on both cars' books. His OLD car gives
    // a man it put out half the patience: he knows why.
    const patience = isOut() && v.yardCar === member.from ? 3.5 : 7;
    if (viol.warned && !viol.hands && viol.t - viol.warnAt > patience) {
      viol.hands = true;
      strikes.rules++;
      addTension(mine, v.yardCar, 6);
      if (CBZ.addGangStanding) { CBZ.addGangStanding(v.yardCar, -5); if (g.carClaim === "in") CBZ.addGangStanding(mine, -3); }
      const m = (viol.by && live(viol.by)) ? viol.by : enforcerOf(v.yardCar, 20);
      if (m && CBZ.requestInmateHunt) {
        sayOver(m, "I told you.", 1.8);
        CBZ.requestInmateHunt(m, 6, "rules");
      }
      // your own car saw you embarrass it
      const own = enforcerOf(mine, 16, m);
      if (own) sayOver(own, OWN_LINE[v.kind], 2.6);
    }
  }
  // the player gave something to a man of another car (economy.js gift)
  function noteShare(actor) {
    const g = CBZ.game;
    if (!actor || !g || g.mode !== "escape" || g.role === "cop") return;
    const mine = playerCar(), theirs = carOf(actor);
    if (mine < 0 || theirs < 0 || mine === theirs) return;
    const own = enforcerOf(mine, 16, actor);
    if (!own) return;                                 // nobody of yours saw it
    strikes.share++;
    sayOver(own, OWN_LINE.share, 2.6);
    if (CBZ.addGangStanding && g.carClaim === "in") CBZ.addGangStanding(mine, -4);
    // twice is a lesson: a short correction from your own
    if (strikes.share >= 2 && CBZ.requestInmateHunt) { CBZ.requestInmateHunt(own, 4, "rules"); strikes.share = 0; }
  }

  // ---- 7. THE CLAIM: who from his car comes to get the new man ---------------
  function claimer() {
    const mine = playerCar();
    if (mine < 0) return null;
    const L = CBZ.prisonCarLeader ? CBZ.prisonCarLeader(mine) : null;
    // an approach only survives from inside ~16 m (ai.js APPROACH_FAR + 5)
    if (L && live(L) && !L.approach && !(L.huntPlayer > 0) && pdist(L) < 16) return L;
    return enforcerOf(mine, 16);
  }

  /* THE HORN CALLS CHOW. The errand used to be offered only on a man's own
     wander re-think, so a man mid-conversation (a third of the yard at any
     moment) never heard it and chow filled one stool at a time. On the block
     change every free inmate is handed his stool now; a chat breaks up for it
     (a fight, a run or a man on the phone does not). */
  function callChow() {
    for (const n of CBZ.npcs || []) {
      if (!live(n) || n._crowd || !(n.kind === "inmate" || n.role === "inmate")) continue;
      const s = n.aiState;
      if (s && s !== "wander" && s !== "socialize") continue;
      if (n._propBed || n._propLie || (n.char && n.char.lying)) continue;
      release(n);
      if (errand(n) && s === "socialize") { n.aiState = "wander"; n.social = null; n.aiTimer = 3 + rnd() * 3; }
    }
  }

  // ---- 8. TICK + AUDIT --------------------------------------------------------
  let lastBlock = "";
  function tick(dt) {
    const g = CBZ.game;
    if (!g || g.mode !== "escape") return;
    decay(dt);
    const R = CBZ.prisonRestSeats;
    if (R) {
      const blk = blockId();
      if (blk !== lastBlock) {
        lastBlock = blk;
        if (blk === "mess" || blk === "supper") { allotMess(R.mess, true); callChow(); }
      }
      allotMess(R.mess, false);
      allotYard(R.yard);
    }
    if (g.state === "playing") tickRules(dt);
  }
  if (typeof CBZ.onUpdate === "function") CBZ.onUpdate(42.1, tick);

  function reset() {
    resetPolitics();
    rejoin();
    holders.phone.fill(null); holders.shower.fill(null);
    viol.kind = ""; viol.t = 0; viol.warned = 0; viol.by = null; viol.hands = false;
    strikes.share = 0; strikes.rules = 0;
    for (const n of CBZ.npcs || []) if (n) n._carErrand = null;
    messKey = "";
  }

  // does every prisoner's car follow his heritage, and does nobody wear a band?
  function audit() {
    const out = { N, byCar: new Array(N).fill(0), mismatched: [], unassigned: 0, bands: 0, leaders: [], tension: T.map((r) => r.map((v) => Math.round(v))) };
    for (const n of CBZ.npcs || []) {
      if (!n || n._crowd || !(n.kind === "inmate" || n.role === "inmate")) continue;
      const want = carOfHeritage(heritageOf(n));
      if (n.yardCar == null || n.yardCar < 0) out.unassigned++;
      else out.byCar[n.yardCar]++;
      if (want >= 0 && n.yardCar !== want) out.mismatched.push((n.data && n.data.name) || "?");
      if (n.gang >= 0 && n.gang !== n.yardCar) out.mismatched.push(((n.data && n.data.name) || "?") + " (gang)");
      if (n._band) out.bands++;
      if (n.isLeader) out.leaders.push(n.yardCar);
    }
    return out;
  }

  CBZ.prisonCars = {
    CARS, N, IDX,
    carOf, carOfHeritage, heritageOf, playerCar, bloodCar, heritageBySkin,
    leave, rejoin, isOut, status,
    label, phrase,
    tension, addTension, atOdds, rivalOf, incident,
    allotMess, allotYard, seatOwner, maySit, messSpot,
    PHONES, SHOWER, showerTurn,
    errand, release, onYardSpot,
    playerViolation, noteShare, claimer,
    reset, audit, tick,
  };
})();
