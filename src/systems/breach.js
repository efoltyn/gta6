/* ============================================================
   systems/breach.js — THE CHARGE LAW. One law for what an explosive does to a
   building, published once, read by every game.

   OWNER: "the way they affect buildings" — an RPG used to open a 7-9 m
   blown-out apartment (a floor clamped onto the hole radius by ordnance CLASS),
   a grenade and a JDAM made the same glass radius, and a wall either vanished
   or did nothing. Every one of those numbers was a per-caller constant. This
   file replaces them with ONE law driven by ONE input: the charge, W, in kg of
   TNT-equivalent. Every ordnance row in systems/impactbus.js carries its W;
   every building effect below is derived from it.

   ------------------------------------------------------------------
   1. HOPKINSON-CRANZ. Blast effects scale with the cube root of the charge:
      the same overpressure is found at the same SCALED DISTANCE

          Z = R / W^(1/3)          (m / kg^(1/3))

      so an effect that happens at Z* happens at R = Z* . W^(1/3). The
      thresholds (Kingery-Bulmash hemispherical surface burst, rounded):

        Z_GLASS  12    ~2-3 psi   ordinary annealed glazing fails -> windows out
        Z_GUT    2.8   ~50 psi+   (confined, reflected) partitions, fit-out and
                                  the storey's facade infill inside it are gone:
                                  the floor is GUTTED
        Z_FRAME  1.25  ~200 psi+  primary members (columns, the slab) inside it
                                  fail -> the SEVER the structural ledger reads

      A gut smaller than GUT_MIN_R (5.5 m, a room) is a wrecked room behind a
      hole, not a gutted floor — which is exactly why no rocket or tank shell
      guts a storey and every bomb does.

   2. THE WALL (breaching, FM 5-250 / FM 3-34.214). A charge in contact with a
      wall defeats it out to the BREACHING RADIUS

          W = 16 . R^3 . K . C     (metric: kg, m)  =>  R_b = (W / 16KC)^(1/3)

      K is the material (0.23 timber/poor masonry, 0.35 good masonry/ordinary
      concrete, 0.45 dense concrete, 0.70 reinforced concrete), C the tamping
      (1.8 for an untamped charge on the surface). The wall BREACHES when
      R_b >= its thickness, and the opening is ~2 R_b across. Checked against
      the doctrinal C4 table this file used to hard-code (8" wall, K 0.35):
        2 lb  -> 1.0 m  (crawl hole, not walkable)
        5 lb  -> 1.34 m (one man)
       10 lb  -> 1.7 m  (wider still)
      the table falls out of the law instead of being typed in.

      STANDOFF. A charge that is not IN CONTACT spends itself on air. Coupling
      falls with the scaled standoff Zs = d / W^(1/3):  1 / (1 + (Zs/0.35)^2).
      A thrown grenade half a metre off the wall delivers ~15% of itself.

      SHAPED CHARGES (RPG, HEAT, Hellfire). About half the fill goes into the
      jet, so the BLAST part is priced at W/2. The copper jet perforates up to
      JET_PEN metres of concrete whatever R_b says; the hole it leaves is the
      whole warhead's crater at the face, narrowing with depth:
          r = max(0.15, R_b . (1 - t / (2 . JET_PEN)))
      An RPG (0.7 kg, jet 1.5 m) through a 0.4 m facade: a 0.7 m ragged hole.

   3. CRATER. Apparent crater radius for a surface burst ~ 0.8 . W^(1/3) m; the
      dark ejecta blanket reaches ~2.2 crater radii.

   4. ACCUMULATION. A wall that held keeps what it took: effective (coupled)
      charge is banked per 1.6 m cell and the law is re-asked with the running
      total, so enough grenades, or enough rockets into one panel, do open it.
      Concrete does not heal. The bank is bounded (LRU, 512 cells).

   The sanity table the law produces is asserted by tools/blast-scaling-check.mjs
   (plain node): RPG ~0.7 m hole and never guts, grenade never breaches 0.3 m
   concrete, tank ~1.5 m breach, Hellfire guts a room-scale piece of a storey,
   Mk-84 guts a floor and severs a lot-sized frame.
   ------------------------------------------------------------------

   PUBLIC:
     CBZ.blastLaw                     the pure law (above) — no THREE, no world
     CBZ.breachSpec(lb)               C4 by the pound -> {kg, holeR, walkable, power, radius}
     CBZ.breachBank(x,y,z,kg)         bank coupled charge at a wall cell -> running total
     CBZ.breachDeliver(x,y,z,lb,contact,opts)  legacy seam (lb): bank + open
     CBZ.contactBreach(x,y,z,opts)    THE C4 verb: one boom, the law opens the wall
     CBZ.registerBreachTarget(def)    a game declares a defeatable door/vault
     CBZ.breachTargetStrike(x,y,z,kg) the blast chain asks: did this defeat a target?
     CBZ.breachTargetAt / breachAudit
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  if (CBZ.blastLaw) return;                          // idempotent (family guard idiom)

  /* ======================================================================
     THE LAW (pure)
     ====================================================================== */
  const Z_GLASS = 12, Z_GUT = 2.8, Z_FRAME = 1.25;
  const GUT_MIN_R = 5.5;              // a gut smaller than a room is just a wrecked room
  const CRATER_K = 0.8, EJECTA_K = 2.2;
  const C_CONTACT = 1.8;              // FM 5-250 tamping factor, untamped surface charge
  const Z_STANDOFF_HALF = 0.35;       // scaled standoff at which coupling halves
  const K = { timber: 0.23, masonry: 0.35, brick: 0.35, concrete: 0.45, rc: 0.70 };
  const LB_KG = 0.45359237;
  const RE = { tnt: 1, c4: 1.34, compB: 1.33, semtex: 1.35 };
  const WALKABLE_R = 0.6;             // a 1.2 m opening: shoulders plus kit
  const PROP_SPAN = 1.2;              // a band-less collider narrower than this both ways is a post

  function cbrt(W) { return Math.cbrt(Math.max(0, +W || 0)); }
  // the radius at which scaled distance Z is reached for charge W
  function rAt(Z, W) { return Z * cbrt(W); }
  function breachRadius(W, k) { return cbrt((+W || 0) / (16 * (k || K.masonry) * C_CONTACT)); }
  function coupling(W, standoff) {
    const d = Math.max(0, +standoff || 0);
    if (d < 0.05) return 1;
    const zs = d / Math.max(0.05, cbrt(W));
    return 1 / (1 + (zs / Z_STANDOFF_HALF) * (zs / Z_STANDOFF_HALF));
  }
  // What material a wall is, from what the game knows about it: a facade hint
  // ("brick", "civic", "timber", "adobe", "rc"...) and its thickness. A wall
  // over 0.9 m is massive masonry or a pier (prison stone, a plinth): the FM's
  // "dense concrete, first-class masonry" row. Reinforced concrete only when a
  // producer says so.
  function kOf(thick, hint) {
    if (hint === "rc" || hint === "bunker") return K.rc;
    if (thick > 0.9 || hint === "civic" || hint === "fortified" || hint === "concrete") return K.concrete;
    if (hint === "timber" || hint === "adobe" || hint === "wood") return K.timber;
    return K.masonry;
  }

  /* hole(W, wall) — what one charge (or a banked total) does to one wall.
       wall = { thick, k?, hint?, standoff?, shaped?, jetPen?, banked? }
       banked: the running coupled total already in this cell (added AFTER
               coupling this charge; the law is asked with the sum).
     Returns { Weff, Rb, r (opening radius, 0 when held), breach, jet,
               walkable, scarR (the face crater either way) } */
  function hole(W, wall) {
    wall = wall || {};
    const thick = Math.max(0.05, +wall.thick || 0.3);
    const k = wall.k || kOf(thick, wall.hint);
    // A shaped charge spends about half of itself forming the jet, so its BLAST
    // (what banks, what cracks the face) is half the fill; the jet is below.
    const Weff = (+W || 0) * coupling(W, wall.standoff) * (wall.shaped ? 0.5 : 1);
    const Wsum = Weff + Math.max(0, +wall.banked || 0);
    const Rb = breachRadius(Wsum, k);
    let r = 0, jet = false;
    if (Rb >= thick) r = Rb;
    // a shaped jet perforates on its OWN charge (it does not bank), and only
    // when the round actually arrived nose-on (standoff ~0: it is fuzed on impact)
    if (wall.shaped && (wall.jetPen || 0) >= thick && (+wall.standoff || 0) < 0.6) {
      const rj = Math.max(0.15, breachRadius(W, k) * (1 - thick / (2 * wall.jetPen)));
      if (rj > r) { r = rj; jet = true; }
    }
    return { Weff: Weff, W: Wsum, Rb: Rb, r: r, breach: r > 0, jet: jet,
             walkable: r >= WALKABLE_R, scarR: Math.max(0.2, Rb), k: k, thick: thick };
  }

  const glassR = function (W) { return rAt(Z_GLASS, W); };
  const gutR = function (W) { return rAt(Z_GUT, W); };
  const frameR = function (W) { return rAt(Z_FRAME, W); };
  const craterR = function (W) { return CRATER_K * cbrt(W); };
  const ejectaR = function (W) { return EJECTA_K * craterR(W); };
  function guts(W) { return gutR(W) >= GUT_MIN_R; }

  /* The structural deposit into city/structural.js's ledger, in its capacity
     units. Damage is an AREA quantity, so it rides W^(2/3) (the same exponent
     the bus's kinetic law uses). Calibrated on the ledger's own capacities
     (1-storey shop 22.8, 4-storey block 55, 11-storey ~110): a rocket is ~2.5
     (it wounds; ten of them fell a shop), a tank round ~8, a Hellfire ~14, a
     Mk-82 ~64 (a block), a Mk-84 ~180 (anything under ~20 storeys). */
  const DEPOSIT_K = 3.2;
  function deposit(W) { return DEPOSIT_K * Math.pow(Math.max(0, +W || 0), 2 / 3); }

  /* sever(W, cross) — the fraction of a floor's load-bearing width the charge
     physically removed. Only a gutting charge severs: a hole in a wall is not a
     column line. `cross` is the building's width across the blast. */
  function sever(W, cross) {
    if (!guts(W)) return 0;
    return Math.min(1, 2 * frameR(W) / Math.max(4, +cross || 10));
  }

  /* outcome(W, opts) — the whole verdict in one object (the check reads this;
     the game reads the same functions piecemeal).
       opts: { wall:{thick,...}, bld:{w,d,storeys} } */
  function outcome(W, opts) {
    opts = opts || {};
    const h = hole(W, opts.wall || { thick: 0.3 });
    const b = opts.bld || null;
    const out = {
      W: +W || 0, hole: h, breach: h.breach, holeD: 2 * h.r,
      glassR: glassR(W), gut: guts(W), gutR: gutR(W), frameR: frameR(W),
      craterR: craterR(W), ejectaR: ejectaR(W), deposit: deposit(W),
    };
    if (b) {
      const cross = Math.max(b.w || 10, b.d || 10);
      out.sever = sever(W, cross);
      // the gut swallows the whole plan: every floor it reached is gone
      out.gutsPlan = out.gut && out.gutR >= 0.5 * Math.hypot(b.w || 10, b.d || 10);
    }
    return out;
  }

  // Legacy callers hand cityExplosion a `power` and nothing else. The ordnance
  // rows were authored so power ~ cube root of the charge (grenade 1.0, RPG
  // 1.9, airstrike 3.0), so invert that: W = 0.1 . power^3. RPG 1.9 -> 0.69 kg.
  function chargeOfPower(power) { const p = Math.max(0, +power || 0); return 0.1 * p * p * p; }
  function lbToKg(lb, re) { return Math.max(0, +lb || 0) * LB_KG * (re || RE.c4); }

  /* A POST IS NOT A WALL (gta6-props-are-not-walls). A band-less collider
     (street furniture registers a square footprint with no y0/y1) that spans
     less than PROP_SPAN in BOTH horizontal axes is a lamp, a sign, a hydrant:
     never carved, never swept away by a neighbour's carve, never dressed. Plain
     span, not an aspect ratio — a ratio veto broke the 1.4 x 2.5 m heavy wall.
     `declared` = the collider carries its own y0/y1 (first-class wall). */
  function isProp(c, declared) {
    if (!c) return true;
    if (declared) return false;
    return Math.max(c.maxX - c.minX, c.maxZ - c.minZ) < PROP_SPAN;
  }

  // "Did a blast just deliver here?" — the bus stamps every detonation so a
  // caller that ALSO hands the same warhead to breachDeliver (fpsmode's rocket
  // does) is not counted twice.
  let lastDet = { x: 0, y: 0, z: 0, t: -1e9 };
  function stamp(x, y, z) { lastDet.x = x; lastDet.y = y; lastDet.z = z; lastDet.t = now(); }
  function recent(x, y, z) {
    if (now() - lastDet.t > 0.25) return false;
    return Math.abs(x - lastDet.x) < 2 && Math.abs(z - lastDet.z) < 2 && Math.abs((y || 0) - lastDet.y) < 3;
  }
  function now() { return (typeof performance !== "undefined" && performance.now) ? performance.now() / 1000 : Date.now() / 1000; }

  /* Reference charges, kg TNT-equivalent. The ordnance table reads these by
     row id; they are here so the check and any game can ask "what is a Mk-84"
     without loading the bus. shaped/jetPen: metres of concrete the jet
     perforates. */
  const CHARGES = {
    grenade:   { W: 0.2 },                                  // M67-class, Comp B fill
    rpg:       { W: 0.7, shaped: true, jetPen: 1.5 },       // PG-7-class HEAT
    tank:      { W: 4.0 },                                  // 120/125 mm HE-frag
    tankHeat:  { W: 3.0, shaped: true, jetPen: 1.2 },       // 120 mm HEAT-MP
    hellfire:  { W: 9.0, shaped: true, jetPen: 2.0 },       // AGM-114-class
    missile:   { W: 9.0, shaped: true, jetPen: 2.0 },       // the shared missile pool = Hellfire class
    atgm:      { W: 9.0, shaped: true, jetPen: 2.0 },       // the gunship's Hellfire-class round
    shell:     { W: 3.0, shaped: true, jetPen: 1.2 },       // the tank main gun's 120 mm HEAT
    hydra:     { W: 1.4 },                                  // 70 mm unguided rocket, HE warhead
    aam:       { W: 8.0 },                                  // air-to-air blast-frag warhead
    patriot:   { W: 70 },                                   // SAM blast-frag warhead
    rocket227: { W: 90 },                                   // 227 mm unitary guided rocket
    mk82:      { W: 89 },                                   // 500 lb GP bomb
    airstrike: { W: 89 },                                   // a called-in strike: Mk-82 class
    mk84:      { W: 430 },                                  // 2000 lb GP bomb
    bomb:      { W: 430 },                                  // the B-2's unguided Mk-84
    jdam:      { W: 430 },                                  // guidance kit on the same Mk-84 fill
    buster:    { W: 2400 },                                 // GBU-57-class penetrator
    moab:      { W: 11000 },                                // H6 fill, TNT-equivalent
    c4:        { W: lbToKg(5) },                            // the 5 lb brick
    carcook:   { W: 2.0 },                                  // a car's fuel deflagration
  };

  const law = CBZ.blastLaw = {
    Z_GLASS: Z_GLASS, Z_GUT: Z_GUT, Z_FRAME: Z_FRAME, GUT_MIN_R: GUT_MIN_R,
    CRATER_K: CRATER_K, EJECTA_K: EJECTA_K, C_CONTACT: C_CONTACT, K: K, RE: RE,
    WALKABLE_R: WALKABLE_R, PROP_SPAN: PROP_SPAN, CHARGES: CHARGES,
    cbrt: cbrt, scaledDistance: function (R, W) { return R / Math.max(1e-6, cbrt(W)); },
    rAt: rAt, breachRadius: breachRadius, coupling: coupling, kOf: kOf, hole: hole,
    glassR: glassR, gutR: gutR, frameR: frameR, craterR: craterR, ejectaR: ejectaR,
    guts: guts, deposit: deposit, sever: sever, outcome: outcome,
    chargeOfPower: chargeOfPower, lbToKg: lbToKg, isProp: isProp,
    stamp: stamp, recent: recent,
  };

  /* ======================================================================
     THE BANK — what a wall that held keeps.
     ====================================================================== */
  const CELL = 1.6;
  const BANK_MAX = 512;
  const BANK = new Map();             // key -> kg (insertion order = LRU order)
  const audit = { charges: 0, contact: 0, standoff: 0, holes: 0, defeats: 0, byId: {}, banked: 0 };
  function cellKey(x, y, z) { return Math.round(x / CELL) + "," + Math.round(y / CELL) + "," + Math.round(z / CELL); }
  function banked(x, y, z) { return BANK.get(cellKey(x, y, z)) || 0; }
  function bank(x, y, z, kg) {
    const k = cellKey(x, y, z);
    const tot = (BANK.get(k) || 0) + Math.max(0, +kg || 0);
    BANK.delete(k); BANK.set(k, tot);            // refresh LRU position
    if (BANK.size > BANK_MAX) BANK.delete(BANK.keys().next().value);
    audit.banked += Math.max(0, +kg || 0);
    return tot;
  }
  CBZ.breachBank = bank;
  CBZ.breachBanked = banked;
  CBZ.breachDelivered = function (x, y, z) { return banked(x, y, z) / lbToKg(1); };   // legacy read, in lb C4
  CBZ.breachLedgerReset = function () { BANK.clear(); };

  /* ======================================================================
     C4 BY THE POUND — the old table API, now read off the law.
     ====================================================================== */
  const REF_LB = 5, REF_POWER = 1.4, REF_RADIUS = 7;
  function breachSpec(lb) {
    lb = +lb > 0 ? +lb : REF_LB;
    const kg = lbToKg(lb);
    const h = hole(kg, { thick: 0.2, k: K.masonry });
    const k = Math.cbrt(Math.max(0.25, lb) / REF_LB);
    return {
      lb: lb, kg: kg, holeR: h.r, walkable: h.walkable,
      opening: !h.breach ? "scar" : h.walkable ? (h.r >= 0.8 ? "wide breach" : "one man") : "mousehole",
      power: REF_POWER * k, radius: REF_RADIUS * k,
    };
  }
  CBZ.breachSpec = breachSpec;
  // kept for tools that print the doctrinal rows; every value is the law's
  CBZ.BREACH_TABLE = [2, 5, 7, 10].map(function (lb) { const s = breachSpec(lb); return { lb: lb, holeR: s.holeR, opening: s.opening, walkable: s.walkable }; });

  /* ======================================================================
     THE TARGET REGISTRY — doors and vaults a game declares defeatable.
     A target is priced in pounds of C4 in contact; any blast pays toward it in
     coupled kg, so three rockets do eventually what one brick does.
     ====================================================================== */
  const TARGETS = [];
  const TARGET_PAID = new Map();                 // def -> kg paid so far
  CBZ.registerBreachTarget = function (def) {
    if (!def || !def.at || typeof def.defeat !== "function") return null;
    def.reach = def.reach > 0 ? def.reach : 2.2;
    def.lb = def.lb > 0 ? def.lb : REF_LB;
    TARGETS.push(def);
    return def;
  };
  CBZ.unregisterBreachTarget = function (def) {
    const i = TARGETS.indexOf(def);
    if (i >= 0) TARGETS.splice(i, 1);
    TARGET_PAID.delete(def);
  };
  function targetAt(x, y, z, reachBonus) {
    let best = null, bestD = 1e9;
    for (let i = 0; i < TARGETS.length; i++) {
      const t = TARGETS[i];
      let p = null;
      try { p = t.at(); } catch (e) { p = null; }
      if (!p) continue;
      if (t.done && t.done()) continue;
      const dx = p.x - x, dy = (p.y == null ? y : p.y) - y, dz = p.z - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > t.reach + (reachBonus || 0) || d >= bestD) continue;
      bestD = d; best = t;
    }
    return best ? { target: best, dist: bestD } : null;
  }
  CBZ.breachTargetAt = function (x, y, z, reachBonus) {
    const r = targetAt(x, y, z, reachBonus);
    return r ? { id: r.target.id, dist: r.dist, lb: r.target.lb } : null;
  };
  /* The blast chain asks this for every detonation. Returns null (no target
     here — go carve the wall), or {opened, targetId, needLb}. A door is not a
     wall: when a target is in reach the wall carve is skipped. */
  function targetStrike(x, y, z, kg, contact, opts) {
    const hit = targetAt(x, y, z, 0);
    if (!hit) return null;
    const t = hit.target;
    const eff = kg * (contact ? 1 : coupling(kg, Math.max(0.5, hit.dist)));
    const paid = (TARGET_PAID.get(t) || 0) + eff;
    TARGET_PAID.set(t, paid);
    const price = lbToKg(t.lb);
    if (paid + 1e-6 >= price) {
      try { t.defeat({ x: x, y: y, z: z, lb: paid / lbToKg(1), byPlayer: !!(opts && opts.byPlayer) }); } catch (e) {}
      TARGET_PAID.delete(t);
      audit.defeats++;
      audit.byId[t.id || "?"] = (audit.byId[t.id || "?"] || 0) + 1;
      return { opened: true, kind: "target", targetId: t.id || null };
    }
    return { opened: false, kind: "undercharged", targetId: t.id || null, needLb: t.lb };
  }
  CBZ.breachTargetStrike = targetStrike;

  /* CBZ.breachBlowOut(objs, at, o) — A DEFEATED DOOR LEAVES AS ITSELF.
     Every prison door's defeat() used to end in `pivot.visible = false`: the
     leaf blinked out of existence and the doorway was suddenly empty. A
     breaching charge tears a leaf off its hinges and throws it, so the leaf's
     own geometry goes to the one rigid-body sim (systems/debris.js) — each
     welded solid as itself (`whole`): a barred leaf's bars and rails come
     apart bar by bar, a detention leaf's slab, kick plates and pull fly as
     the slab, plates and pull they were, bent a little (steel bends), all of
     them away from where the charge sat. The debris sim hides the source in
     the same breath; a run reset that re-hangs the leaf clears `o.owner`.
       objs  Object3D or array (the pivots)
       at    {x,y,z} the charge (defeat() is handed it), or null
       o     {owner, lb} — lb sizes the throw (a 5 lb brick vs a 10 lb pair)
     Without the debris sim the leaf is only hidden, as before. */
  CBZ.breachBlowOut = function (objs, at, o) {
    o = o || {};
    const list = Array.isArray(objs) ? objs : [objs];
    const D = CBZ.debris;
    const lb = o.lb > 0 ? +o.lb : REF_LB;
    const power = Math.max(0.8, Math.min(2.4, 0.7 * Math.cbrt(lb)));
    let pieces = 0;
    for (let i = 0; i < list.length; i++) {
      const obj = list[i];
      if (!obj || obj.visible === false) continue;
      if (D && D.shatter) {
        try {
          const r = D.shatter(obj, {
            at: at && isFinite(at.x) ? { x: at.x, y: at.y == null ? 1.2 : at.y, z: at.z } : null,
            power: power, whole: true, snap: false, owner: o.owner || "breach-door",
            grit: 0.5, dust: 0.6,
          });
          pieces += r && r.pieces ? r.pieces : 0;
        } catch (e) {}
      }
      obj.visible = false;
    }
    return pieces;
  };
  CBZ.breachClearBlown = function (owner) {
    if (CBZ.debris && CBZ.debris.clear) { try { CBZ.debris.clear(owner || "breach-door"); } catch (e) {} }
  };

  /* ======================================================================
     THE VERBS
     ====================================================================== */
  /* CBZ.breachDeliver(x,y,z,lb,contact,opts) — the legacy seam (fpsmode's
     rocket hands its warhead over after the boom). The boom itself already ran
     the law through the blast chain (buildings.js blastBuildings), so a
     delivery at the same spot in the same instant is the same warhead: skip.
     Otherwise run the one wall response with this charge. */
  function breachDeliver(x, y, z, lb, contact, opts) {
    opts = opts || {};
    const kg = lbToKg(lb);
    const out = { total: banked(x, y, z), opened: false, kind: "banked", targetId: null };
    if (recent(x, y, z)) { out.kind = "same-blast"; return out; }
    if (CBZ.modeHas && !CBZ.modeHas("breach")) return out;
    const t = targetStrike(x, y, z, kg, contact, opts);
    if (t) return Object.assign(out, t);
    if (!CBZ.cityFracture || !CBZ.cityFracture.blastAt) return out;
    // a loose (not stuck) delivery sat at least half a metre off the face
    const h = CBZ.cityFracture.blastAt({ x: x, y: y, z: z }, {
      charge: kg, contact: !!contact, standoff: contact ? 0 : 0.5,
      byPlayer: !!opts.byPlayer, quiet: !!opts.quiet, now: true,
    });
    if (h) { audit.holes++; out.opened = true; out.kind = "wall"; }
    out.total = banked(x, y, z);
    return out;
  }
  CBZ.breachDeliver = breachDeliver;

  /* CBZ.contactBreach(x,y,z,opts) — THE C4 VERB.
       opts.lb       pounds of C4 (default 5)
       opts.contact  stuck to the surface (full coupling) vs lying loose
     One detonation, carrying its charge: the blast chain (structuralBlast)
     prices the wall with the law, and a declared target in reach is paid. */
  function contactBreach(x, y, z, opts) {
    opts = opts || {};
    const spec = breachSpec(opts.lb);
    const contact = !!opts.contact;
    audit.charges++;
    if (contact) audit.contact++; else audit.standoff++;
    const cityWorld = !CBZ.game || CBZ.game.mode === "city";
    // The target is resolved first so the blast chain can skip the wall carve
    // when the charge was stuck to a door.
    const t = (!CBZ.modeHas || CBZ.modeHas("breach")) ? targetStrike(x, y, z, spec.kg, contact, opts) : null;
    const boom = cityWorld ? CBZ.cityExplosion : (CBZ.cityBlastCore || CBZ.cityExplosion);
    if (boom) {
      try {
        boom(x, z, { power: spec.power, radius: spec.radius, byPlayer: !!opts.byPlayer,
                     y: y, cause: opts.cause || "explosion", kind: opts.kind || "c4",
                     normal: opts.normal || null, dir: opts.dir || null,
                     charge: spec.kg, contact: contact, noWallCarve: !!t });
      } catch (e) {}
    }
    stamp(x, y, z);
    const res = t || { opened: false, kind: "wall" };
    return { opened: !!res.opened, kind: res.kind, holeR: spec.holeR, lb: spec.lb,
             opening: spec.opening, targetId: res.targetId || null, needLb: res.needLb,
             total: banked(x, y, z) };
  }
  CBZ.contactBreach = contactBreach;

  /* RATCHET: `unreachable` counts registered targets priced above anything a
     player can carry (the 10 lb row). Pinned at 0. */
  CBZ.breachAudit = function () {
    const maxLb = 10;
    let unreachable = 0;
    const ids = [];
    for (let i = 0; i < TARGETS.length; i++) {
      if (TARGETS[i].lb > maxLb) { unreachable++; ids.push(TARGETS[i].id || "?"); }
    }
    return {
      unreachable: unreachable, unreachableIds: ids, targets: TARGETS.length,
      cells: BANK.size, bankedKg: Math.round(audit.banked * 100) / 100,
      charges: audit.charges, contact: audit.contact, standoff: audit.standoff,
      holes: audit.holes, defeats: audit.defeats, byId: Object.assign({}, audit.byId),
    };
  };
})();
