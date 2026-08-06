/* ============================================================
   systems/breach.js — THE CHARGE TABLE. Real-world breaching arithmetic,
   published once, read by every game.

   OWNER (2026-08-06): "What we discovered is a math, a real math, that should
   be put into Gang City and then put throughout my games — which makes a
   reason for connecting the engine to the games."

   That is the whole point of this file. The engine and the scenarios have been
   connected by CAPABILITY (systems/modecaps.js). This connects them by FACT: a
   number that is true in a prison, in a bank and on a disaster island because
   it is true in the world, so every game can read the same one and none of
   them has to invent it.

   ------------------------------------------------------------------
   THE SOURCE, and it is a real one. US Army urban-operations doctrine
   (FM 3-06.11 ch.8; FM 90-10-1 app.M "Field-Expedient Breaching of Common
   Urban Barriers"; ATP 3-21.8 app.H) gives the charge-to-opening table for
   C4 against a non-reinforced concrete wall:

       2 lb  -> a MOUSEHOLE                       (crawl, not walk)
       5 lb  -> a hole large enough for ONE MAN to move through
       7 lb  -> large enough for TWO MEN abreast
      10 lb  -> larger still

   The tactic has a name — MOUSE-HOLING — and it goes back to Stalingrad: you
   move through the buildings instead of the street, because a street is a
   killing field. That is a GAME MECHANIC that already existed in 1942, and it
   is the reason a breaching charge is not just a bigger grenade.

   THE OTHER HALF OF THE MATH, and the half that makes the game honest:
   CONTACT vs STANDOFF. A shaped-charge rocket does NOT make a doorway. The
   RPG-7's copper jet is focused to defeat armour, so it PENETRATES (the
   PG-7VR will go through 1.5 m of reinforced concrete and 2 m of brick) while
   the hole it leaves is ~30 cm or less — practitioners report never seeing an
   RPG hole big enough to walk through. The thermobaric TBG-7V is smaller
   still at the wall, 30-40 mm, because its job is to inject the fuel-air
   cloud INSIDE. What opens a wall is an explosive in CONTACT with it: the
   energy couples into the structure instead of into the air.

   So the law this file encodes, in one line:

       A CHARGE YOU STICK TO SOMETHING OPENS IT. A ROCKET WRECKS IT.

   That single distinction is what makes C4 categorically different from the
   RPG rather than a cheaper version of it — the LOYALTY+WEAPONS doctrine's
   "categorical asymmetry is the reward that works". It is also what connects
   this to every game at once, because "a thing that is stuck to a door and
   goes off" means the same thing in a prison corridor, a bank strongroom and
   a burning island.
   ------------------------------------------------------------------

   PUBLIC:
     CBZ.breachSpec(lb)                  -> {lb, holeR, opening, power, radius}
     CBZ.contactBreach(x, y, z, opts)    -> {opened, kind, ...}  THE shared verb
     CBZ.breachTargetAt(x, y, z, reach)  -> what a charge here would defeat
     CBZ.registerBreachTarget(def)       -> a game declares a defeatable thing
     CBZ.breachAudit()                   -> ratchet

   THE REGISTRY IS THE CONNECTIVE TISSUE. A game does not teach the charge
   about its doors; it hands the charge a one-line description of a thing that
   can be defeated and what to do when it is:

       CBZ.registerBreachTarget({
         id: "prison-yard-door",
         at: () => ({ x, y, z }),      // where it is, live
         reach: 2.2,                   // how close the charge must be stuck
         lb: 5,                        // charge mass that defeats it
         defeat: () => CBZ.openDoor(), // what "opened" means HERE
       });

   Nothing in here knows what a prison is, what a bank is, or what a door is.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  if (CBZ.breachSpec) return;                    // idempotent (family guard idiom)

  CBZ.CONFIG = CBZ.CONFIG || {};
  // Master switch. false => contactBreach degenerates to a plain detonation
  // with no carve and no target defeat, i.e. exactly what C4 did before this
  // file existed. One-line revert.
  if (CBZ.CONFIG.BREACH_TABLE_V1 == null) CBZ.CONFIG.BREACH_TABLE_V1 = true;

  /* ---- THE TABLE ----------------------------------------------------------
     `opening` is the doctrinal description; `holeR` is that description turned
     into a RADIUS in metres for city/buildings.js carveHole. The conversion is
     deliberately conservative and stated rather than tuned:
       a mousehole you crawl      ~0.6 m across -> r 0.30
       one man moving through     ~1.0 m across -> r 0.50   (shoulders ~0.5 m,
                                                             plus kit and a lip)
       two men abreast            ~1.7 m across -> r 0.85
       "larger"                   ~2.4 m across -> r 1.20
     carveHole floors its own opening at 0.5 m, so a 2 lb mousehole comes out
     as the smallest hole the carve can express — which is correct: the game
     has no crawl, so a mousehole should read as damage you cannot use, and
     that is exactly what the doctrine says a 2 lb charge buys you. */
  const TABLE = [
    { lb: 2, holeR: 0.30, opening: "mousehole", walkable: false },
    { lb: 5, holeR: 0.50, opening: "one man", walkable: true },
    { lb: 7, holeR: 0.85, opening: "two abreast", walkable: true },
    { lb: 10, holeR: 1.20, opening: "wide breach", walkable: true },
  ];
  CBZ.BREACH_TABLE = TABLE;

  // Blast power/radius for a charge of this mass. Anchored on the shipped C4
  // row in systems/impactbus.js (5 lb == power 1.4 / radius 7, which is what
  // city/explosives.js has always used) and scaled by the CUBE ROOT of mass —
  // Hopkinson-Cranz, the same scaling law the ordnance bus already applies to
  // kinetic impacts. A 10 lb charge is not twice the fireball of a 5 lb one.
  const REF_LB = 5, REF_POWER = 1.4, REF_RADIUS = 7;
  function blastOf(lb) {
    const k = Math.cbrt(Math.max(0.25, lb) / REF_LB);
    return { power: REF_POWER * k, radius: REF_RADIUS * k };
  }

  function breachSpec(lb) {
    lb = +lb > 0 ? +lb : REF_LB;
    let row = TABLE[0];
    for (let i = 0; i < TABLE.length; i++) if (lb >= TABLE[i].lb) row = TABLE[i];
    // between rows, interpolate the hole so a 6 lb charge is not a 5 lb one
    let holeR = row.holeR;
    const next = TABLE[TABLE.indexOf(row) + 1];
    if (next && lb > row.lb) {
      const t = (lb - row.lb) / (next.lb - row.lb);
      holeR = row.holeR + (next.holeR - row.holeR) * t;
    }
    const b = blastOf(lb);
    return { lb: lb, holeR: holeR, opening: row.opening, walkable: row.walkable,
             power: b.power, radius: b.radius };
  }
  CBZ.breachSpec = breachSpec;

  /* ---- THE TARGET REGISTRY ------------------------------------------------
     A "breach target" is anything a game says can be DEFEATED by a charge
     stuck to it, as opposed to merely damaged: a locked door, a vault, a
     grate, a hatch. One line to declare, and the charge never learns what it
     is defeating. Degrade-safe: with no targets registered, contactBreach is
     just a carve + a boom, exactly as before. */
  const TARGETS = [];
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
  };

  function targetAt(x, y, z, reachBonus) {
    let best = null, bestD = 1e9;
    for (let i = 0; i < TARGETS.length; i++) {
      const t = TARGETS[i];
      let p = null;
      try { p = t.at(); } catch (e) { p = null; }
      if (!p) continue;                            // a target that is gone reports nothing
      if (t.done && t.done()) continue;            // already defeated this run
      const dx = p.x - x, dy = (p.y == null ? y : p.y) - y, dz = p.z - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const reach = t.reach + (reachBonus || 0);
      if (d > reach || d >= bestD) continue;
      bestD = d; best = t;
    }
    return best ? { target: best, dist: bestD } : null;
  }
  CBZ.breachTargetAt = function (x, y, z, reachBonus) {
    const r = targetAt(x, y, z, reachBonus);
    return r ? { id: r.target.id, dist: r.dist, lb: r.target.lb } : null;
  };

  const audit = { charges: 0, contact: 0, standoff: 0, holes: 0, defeats: 0, byId: {}, delivered: 0, cells: 0 };

  /* ---- THE LEDGER: ENOUGH IS ENOUGH ---------------------------------------
     OWNER: "the parts of buildings that fake blow up — with enough C4 actually
     blowing up, or enough rockets actually opening a man-sized hole. Your
     research proved it."

     It did, and this is the piece that was missing. Until now a hit either
     opened a wall or did nothing at all, forever: `carveHole` refuses anything
     thicker than 0.9 m, and a wall that refused the first rocket refused the
     hundredth. That is the "fake blow up" — a fireball, a scar, a scorch, and
     a wall that is exactly as solid as it was. Concrete does not work that way
     and neither does doctrine: a charge too small for the job still DAMAGES
     the wall, and the next one starts from there.

     So every detonation DELIVERS explosive mass into a cell of the world, the
     cell remembers, and the wall opens when the running total crosses the
     doctrinal threshold. One 5 lb brick in contact opens a wall on the spot
     (that is the FM row). A rocket standing off delivers a fraction of its
     mass, so it takes several — which is precisely what the research says:
     the RPG's shaped jet penetrates, it does not breach, and if you want a
     doorway from rockets you are going to spend rockets.

     THE COUPLING FACTOR is the one number here that is a judgement call, and
     it is stated rather than buried: explosive-breaching practice puts a
     contact charge at roughly 5x the wall effect of the same charge standing
     off, because a contact charge couples into the structure while a standoff
     charge spends most of itself on air. 0.35 is deliberately GENEROUS to the
     rocket (a strict 0.2 would want eleven of them); at 0.35 a 2.2 lb warhead
     delivers 0.77 lb, so a man-sized hole costs ~7 rockets or ONE brick. That
     ratio is the whole design: the rocket is the loud way, the charge is the
     right way.

     THE LEDGER DOES NOT DECAY. city/fracture.js's chewWall forgets a cell
     after 14 s because sustained rifle fire is a burst, not a wound. Concrete
     that has been shocked stays shocked, so a wall you softened yesterday is
     still soft. */
  const STANDOFF_COUPLING = 0.35;
  const CELL = 1.6;                 // metres — a wall panel's worth of damage
  const DELIVERED = new Map();
  function ledgerKey(x, y, z) {
    return Math.round(x / CELL) + "," + Math.round(y / CELL) + "," + Math.round(z / CELL);
  }
  function deliver(x, y, z, lb, contact) {
    const eff = Math.max(0, +lb || 0) * (contact ? 1 : STANDOFF_COUPLING);
    if (eff <= 0) return delivered(x, y, z);
    const k = ledgerKey(x, y, z);
    const tot = (DELIVERED.get(k) || 0) + eff;
    if (!DELIVERED.has(k)) audit.cells++;
    DELIVERED.set(k, tot);
    audit.delivered += eff;
    return tot;
  }
  function delivered(x, y, z) { return DELIVERED.get(ledgerKey(x, y, z)) || 0; }
  CBZ.breachDelivered = delivered;
  CBZ.breachLedgerReset = function () { DELIVERED.clear(); };

  /* CBZ.breachDeliver(x, y, z, lb, contact) — THE ONE CALL every explosion
     makes. It banks the mass and, if the running total in that cell has
     reached the man-sized row, opens whatever is there. Returns
     {total, opened, kind}. Any ordnance can call it; nothing has to know what
     it is hitting. */
  function breachDeliver(x, y, z, lb, contact, opts) {
    opts = opts || {};
    const total = deliver(x, y, z, lb, contact);
    const out = { total: total, opened: false, kind: "banked", targetId: null };
    if (CBZ.CONFIG.BREACH_TABLE_V1 === false) return out;
    if (CBZ.modeHas && !CBZ.modeHas("breach")) return out;

    // a declared target (vault, door) opens when the TOTAL reaches its price —
    // so three rockets into a branch vault do what one brick does, eventually.
    const hit = targetAt(x, y, z, 0);
    if (hit) {
      if (total >= hit.target.lb) {
        try { hit.target.defeat({ x: x, y: y, z: z, lb: total, byPlayer: !!opts.byPlayer }); } catch (e) {}
        audit.defeats++;
        audit.byId[hit.target.id || "?"] = (audit.byId[hit.target.id || "?"] || 0) + 1;
        out.opened = true; out.kind = "target"; out.targetId = hit.target.id || null;
      } else {
        out.kind = "undercharged"; out.targetId = hit.target.id || null; out.needLb = hit.target.lb;
      }
      return out;                                   // a door is not a wall; do not also carve it
    }

    const MAN = TABLE[1].lb;                        // 5 lb — the one-man row
    if (total < MAN) return out;                    // not enough yet. It remembers.
    if (!CBZ.cityCarveWall) return out;
    const spec = breachSpec(total);
    try {
      // HEAVY charges defeat what a single hit cannot. carveHole refuses a wall
      // thicker than 0.9 m by default because a single rocket genuinely should
      // not open a pier; enough accumulated mass should, and says so in pounds.
      const rec = CBZ.cityCarveWall(x, y, z, spec.holeR, {
        search: 2.4, gapW: spec.holeR * 2, maxThick: total >= TABLE[3].lb ? 1.6 : (total >= TABLE[2].lb ? 1.2 : 0.9),
      });
      if (rec) {
        audit.holes++;
        out.opened = true; out.kind = "wall"; out.holeR = spec.holeR;
        /* THE LEDGER IS NOT ZEROED ON A HIT, and that is load-bearing. It used
           to be ("the wall is open, the debt is paid"), and the measurement
           caught what that costs: a facade is LAYERS, so the first 5 lb opens
           the thin skin, the counter resets, and the total can never climb to
           the 7 lb / 10 lb rows that raise carveHole's thickness ceiling — a
           thick pier behind a thin panel was unopenable at SIXTY pounds.
           Concrete does not heal, so the cell keeps its running total; each
           wall still only opens once (carveHole's own `_breached`), and the
           mass keeps working through the stack until there is nothing left to
           open. That is exactly "with enough C4, actually blowing up". */
        const fr = CBZ.cityFracture;
        if (fr && fr._adopt) { try { fr._adopt(rec, spec.holeR); } catch (e) {} }
      }
    } catch (e) {}
    return out;
  }
  CBZ.breachDeliver = breachDeliver;

  /* ---- THE VERB ------------------------------------------------------------
     CBZ.contactBreach(x, y, z, opts)
       opts.lb        charge mass in pounds (default 5 — the doctrinal
                      man-sized row, and the value C4 has always been priced at)
       opts.contact   true when the charge was STUCK to something. false (or a
                      thrown/loose charge) gets the blast and no opening: that
                      is the standoff half of the law above.
       opts.byPlayer  routes kills/heat to the player, as everywhere else
       opts.normal    {x,z} surface normal it was stuck to, when known
     Returns {opened, kind, holeR, targetId}. */
  function contactBreach(x, y, z, opts) {
    opts = opts || {};
    const spec = breachSpec(opts.lb);
    const on = CBZ.CONFIG.BREACH_TABLE_V1 !== false;
    const contact = !!opts.contact;
    audit.charges++;
    if (contact) audit.contact++; else audit.standoff++;

    // 1) THE BOOM, always — the owner's point exactly: "C4 can use the same
    //    explosion" the rocket already has. Nothing new is drawn. The city
    //    keeps the full wrapper chain (structural ledger, vaults, wildlife);
    //    every other mode detonates through the unwrapped core.
    const cityWorld = !CBZ.game || CBZ.game.mode === "city";
    const boom = cityWorld ? CBZ.cityExplosion : (CBZ.cityBlastCore || CBZ.cityExplosion);
    if (boom) {
      try {
        boom(x, z, { power: spec.power, radius: spec.radius, byPlayer: !!opts.byPlayer,
                     y: y, cause: opts.cause || "explosion" });
      } catch (e) {}
    }

    if (!on) return { opened: false, kind: "off", holeR: 0, lb: spec.lb, targetId: null };

    // 2) BANK THE MASS AND LET THE LEDGER DECIDE. Contact couples fully;
    //    standoff banks a fraction. Either way the cell remembers, so a wall
    //    that was not opened by this charge is closer to opening than it was —
    //    which is the whole of "enough C4, or enough rockets".
    const res = breachDeliver(x, y, z, spec.lb, contact, opts);
    return { opened: !!res.opened, kind: res.kind, holeR: res.holeR || spec.holeR,
             lb: spec.lb, opening: spec.opening, targetId: res.targetId || null,
             needLb: res.needLb, total: res.total };
  }
  CBZ.contactBreach = contactBreach;

  /* ---- RATCHET (Block Law rule 5) -----------------------------------------
     `unreachable` counts registered breach targets that NO charge in the table
     could ever defeat — a door declared with an lb requirement above the
     heaviest row, which is a promise the player can never keep. It resolves
     against the real table rather than a copy of it, so adding a target with a
     typo'd mass shows up immediately. Pinned at 0. */
  CBZ.breachAudit = function () {
    const maxLb = TABLE[TABLE.length - 1].lb;
    let unreachable = 0;
    const ids = [];
    for (let i = 0; i < TARGETS.length; i++) {
      if (TARGETS[i].lb > maxLb) { unreachable++; ids.push(TARGETS[i].id || "?"); }
    }
    return {
      unreachable: unreachable,      // <- THE RATCHET. Pin at 0.
      unreachableIds: ids,
      targets: TARGETS.length,
      rows: TABLE.length,
      standoffCoupling: STANDOFF_COUPLING,
      deliveredLb: Math.round(audit.delivered * 10) / 10, cells: audit.cells,
      charges: audit.charges, contact: audit.contact, standoff: audit.standoff,
      holes: audit.holes, defeats: audit.defeats, byId: Object.assign({}, audit.byId),
      flag: CBZ.CONFIG.BREACH_TABLE_V1 !== false,
    };
  };
})();
