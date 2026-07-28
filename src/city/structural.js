/* ============================================================
   city/structural.js — THE BUILDING STRUCTURAL LEDGER.

   OWNER BRIEF: "buildings when hit with a plane should have much more real
   reaction." The reaction was missing because damage had no MEMORY and no
   SHAPE. A blast carved a hole and the building went back to being a box; a
   jet flew into a tower and produced the same fireball as a burning taxi.

   This file gives a building a STATE that survives the hit and escalates:

     0 INTACT     nothing has touched it
     1 SCARRED    scorch, cracks, blown glass — cosmetic memory
     2 WOUNDED    real carved holes; the facade is open to the interior
     3 BURNING    fire has taken hold on one or more floors and is SPREADING;
                  fire is what converts a survivable hit into a fatal one,
                  exactly as in the real sequence (NIST: fireproofing stripped
                  by the impact, steel softens, floors sag)
     4 CRITICAL   load path failing — the tower visibly sags, sways and sheds
                  its facade. The last beat where it is still standing.
     5 COLLAPSING the catastrophe: pancake front descending at ~2/3 g, tilt,
                  ejecta, and a dust curtain that swallows the block
     6 RUBBLE     handed to city/demolition.js, which already owns the
                  aftermath calendar (rubble -> cleared -> scaffold -> rebuilt)

   ------------------------------------------------------------------
   WHAT THIS REPLACES (BLOCK LAW rule 3 — >=3 real consumers migrated):
   There were THREE independent "how hurt is this building" accumulators that
   could not see each other, so a building could be riddled with holes on one
   system's books and pristine on another's:

     city/demolition.js  hp      Map<lot, number>       -> delegates here
     city/fracture.js    wounds  Map<"bkey|face", n>    -> delegates here
     city/buildings.js   wallDmg Map<collider, rec>     -> still separate
                                 (per-wall cosmetic; another domain owns it)

   Plus every caller of CBZ.cityDamageBuilding is migrated for free by the
   wrapper in systems/impactbus.js. CBZ.impactAudit() counts what is left.
   ------------------------------------------------------------------

   RESEARCH THIS IMPLEMENTS (and what it deliberately does NOT):
   • Red Faction Geo-Mod 2.0's insight, cheaply: collapse is decided by a
     LOAD-PATH check (does the intact structure below still carry the mass
     above?), not by a fracture simulation. Ours is O(storeys) arithmetic over
     a per-floor integrity array — a few dozen adds, not a solver.
   • Teardown's author deliberately REFUSED global structural simulation
     because it takes control away from the player. We agree: a building only
     collapses when damage genuinely crosses its capacity, never ambiently.
   • Battlefield/Frostbite + Control: the collapse itself is a PRE-AUTHORED
     mesh swap hidden behind a dust curtain, not a rigid-body sim. This repo
     has no rigid-body engine and does not want one. The real building is
     batch-hidden at the exact frame the dust reaches full occlusion, and a
     cheap proxy shell (<=10 boxes) performs the pancake.
   • Far Cry 2's fire model: a coarse cell automaton (here: one cell per
     FLOOR), wind-biased spread, finite burn lifetime, and cumulative heat
     exposure that eventually flips a floor's load-bearing flag.
   • NIST/Bazant numbers: collapse front at ~2/3 free-fall acceleration,
     visible tilt before the drop, air jets punching out BELOW the front.

   PERFORMANCE ENVELOPE (the brief says levelling a district must not kill a
   low-end machine):
   • The ledger only ever holds lots that have actually been hit.
   • Fire ticks at 4 Hz, not per frame, and only over burning floors.
   • Concurrent collapses are hard-capped (CBZ.qScale 1..4). Over the cap, a
     condemned building SNAPS straight to rubble through demolition.js — the
     same end state, no animation. Nothing queues up unbounded.
   • The proxy shell is <=10 boxes sharing cached materials; a whole district
     coming down is bounded by the concurrency cap, not by district size.
   • Every particle call routes into crashfx.js's already-pooled, already-
     capped systems. This file adds no new particle pool.

   DETERMINISM: the ledger is runtime state, not generation, so FX may use
   Math.random. Anything that must agree across clients (which lot, which
   stage, the rubble pile itself) is coordinate-keyed and delegated to
   demolition.js, whose ledger already serialises and net-replays.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  if (CBZ.structure) return;                       // idempotent family guard

  CBZ.CONFIG = CBZ.CONFIG || {};
  // Master flag. false => hit()/sweep() become no-ops and the game behaves
  // exactly as it did before this file existed (demolition.js keeps its own
  // legacy accumulator alive as a fallback — see the _legacyAccum note there).
  if (CBZ.CONFIG.STRUCT_LEDGER == null) CBZ.CONFIG.STRUCT_LEDGER = true;
  // The animated pancake. false => a condemned building snaps to rubble via
  // demolition.js exactly as it did before (one-line revert of the spectacle
  // without losing the damage model).
  if (CBZ.CONFIG.STRUCT_COLLAPSE_V1 == null) CBZ.CONFIG.STRUCT_COLLAPSE_V1 = true;
  // Fire spread + burn-down. false => buildings take damage and collapse but
  // never catch light.
  if (CBZ.CONFIG.STRUCT_FIRE == null) CBZ.CONFIG.STRUCT_FIRE = true;

  /* ============================================================
     TUNING — every magic number in one block, with its reason.
     ============================================================ */
  // Capacity of a building, in the same damage units systems/impactbus.js
  // emits (struct * power). Calibrated so the pre-existing feel is preserved:
  // demolition.js's old curve was `2 + storeys*1.2 + (w*d)/300` against a raw
  // `power * prox` per blast. Our rows multiply struct*power, so an RPG
  // (2.0*1.9 = 3.8) still needs ~3 hits on a shop and ~6 on a fat block.
  function capacityOf(b) {
    return 12 + b.storeys * 7 + (b.w * b.d) / 26;
  }
  const STAGE = { INTACT: 0, SCARRED: 1, WOUNDED: 2, BURNING: 3, CRITICAL: 4, COLLAPSING: 5, RUBBLE: 6 };
  // Stage thresholds as a fraction of capacity. Wide bands on purpose: most
  // hits should visibly move the building without condemning it.
  const T_SCARRED = 0.08, T_WOUNDED = 0.30, T_CRITICAL = 0.72;
  // Free-fall is 9.81; NIST/Bazant put the observed collapse front at about
  // two thirds of it, because the intact structure below still resists.
  const COLLAPSE_G = 6.5;
  const PRESHUDDER = 1.15;      // seconds of creak/sway/dust before anything moves
  const SETTLE = 2.4;           // seconds of dust after the shell is gone
  // Fire: one cell per floor. Far Cry 2 model — finite lifetime, neighbour
  // ignition, wind bias, cumulative structural exposure.
  const FIRE_TICK = 0.25;       // 4 Hz
  const FIRE_LIFE = 55;         // seconds a floor burns before it is spent
  const FIRE_SPREAD = 9;        // seconds of burning before a neighbour floor lights
  const FIRE_STRUCT_DPS = 0.55; // structural damage per second per burning floor
  // Fire alone tops out at 85% of capacity, so the frac route can never be the
  // thing fire condemns a building by. Fire kills through the LOAD PATH or not
  // at all — which is both the real mechanism and the one the player can read.
  const FIRE_MAX_FRACTION = 0.85;
  // WHAT STARTS A FIRE. Below this, ordnance wounds but never ignites.
  // The line is physical and deliberate: fuel-carrying and incendiary warheads
  // (bomb .30, jdam .35, moab .60, carcook .25, buster .25, meteor .50, and
  // every aircraft crash row .55-1.0) set buildings alight; shaped charges and
  // kinetic rounds (grenade .05, tank .05, c4 .10, rpg .12, missile .15,
  // airstrike .20) do not. Without this line EVERY warhead in the table lit a
  // fire, and since fire drains the load path, every single C4 charge silently
  // condemned its building ~25s later. That is a balance rewrite by accident.
  const FIRE_IGNITE_MIN = 0.25;
  // Per-floor integrity lost per unit of damage fraction. THE CRITICAL NUMBER:
  // collapse is decided by loadPathFailure() over this array, NOT by the
  // damage total, so this is what actually sets "how many rockets".
  //   1-storey shop  (cap 22.8): legacy RPG = 11.4 -> bite .50 -> .275/hit.
  //   4-storey block (cap 55.4): legacy RPG          -> bite .21 -> .113/hit.
  // At 0.55 the load path survives longer than the damage total does, so
  // ORDNANCE condemns through `frac >= 1` (2 rockets for a shop, 5 for a
  // block — the pre-migration feel) and the load path is reserved for what it
  // actually models: the slow, wide integrity loss of FIRE. At the original
  // 2.2 a single rocket flattened a shop and two flattened a block.
  const IMPACT_INTEGRITY = 0.55;
  // A floor that has lost this much of itself cannot carry what is above it,
  // regardless of how little that is. Without the floor, `above*0.42` makes
  // high floors almost unfailable (a floor 3/4 up carries 25% of the tower, so
  // it would need to reach 10% integrity), which is exactly backwards for the
  // plane-strike case — the real failure is AT the impact floor.
  const LOADPATH_FLOOR = 0.35;

  /* ---- DISPROPORTIONATE COLLAPSE (the rule that gives a strike its SHAPE) --
     Engineering's own distinction, and the single most useful thing the
     research turned up: losing a member is NOT the same as losing a building.
     Codes since Murrah require an ALTERNATE LOAD PATH — remove one column and
     the neighbours take the load, the damage ARRESTS, and nothing else
     happens. Collapse is called "disproportionate" precisely when it does not
     arrest, and whether it arrests comes down to one thing: how much mass is
     above the failure versus how much structure is left to catch it.

     NIST's number for the real case: an intact floor system can absorb the
     SUDDEN arrival of about 6 floors' worth of load (about 11 if applied
     gradually — a dynamic amplification factor near 1.8). Fewer than that and
     it holds.

     WHAT THIS BUYS THE PLAYER, and it is the whole reason it is here: WHERE
     you hit a tower now matters. Clip the top four floors of the 52-storey
     flagship and you wound it — fire, sag, a shed facade, a permanent scar,
     but it stands, because four floors cannot overwhelm forty-eight. Put the
     same plane through floor 20 and there is nothing underneath that can catch
     what is above, and the whole thing comes down. That is a decision the
     player gets to make with a control stick, out of one arithmetic rule.

     The `max(2, ...)` floor keeps the pre-existing feel of small buildings
     exactly as it was: a one-storey shop can never be felled through the load
     path (only by out-damaging its capacity outright, which is the "two
     rockets for a shop" tuning), while a two-storey with its ground floor gone
     drops, as it should.
  ------------------------------------------------------------------------- */
  /* ---- DYNAMIC AMPLIFICATION (why a strike is worse than the same load) ---
     The other half of NIST's finding, and the reason `sudden` exists. The
     SAME load applied suddenly is roughly TWICE as destructive as one applied
     gradually: their intact floor system absorbs about 6 floors' worth
     arriving all at once, against about 11 applied slowly. Ratio 11/6 = 1.83.

     This is what separates a plane from a fire, physically and in play. Fire
     is the gradual load: it drains integrity for a minute and tests against
     the static threshold. A strike is the sudden one: everything above arrives
     on the surviving columns in a fraction of a second and they are judged
     against a bar nearly twice as high. It is why an airframe that removes
     "only" 61% of a floor's cross-section still condemns a 52-storey tower,
     while a fire that has quietly eaten the same 61% has not yet.

     Applied ONLY on the evaluation triggered by a sudden load. A later fire
     tick re-evaluates the same building against the static bar, which is
     correct: the shock is a moment, not a property.
  ------------------------------------------------------------------------- */
  const DYNAMIC_AMP = 1.83;

  const DISPROP_FLOORS = 6;
  function disproportionate(n, i) {
    const above = n - i;
    return above >= Math.max(2, Math.min(DISPROP_FLOORS, Math.ceil(n * 0.5)));
  }

  /* ---- SEVER (the kinetic cross-section cut) -----------------------------
     `opts.sever` is the fraction of the struck floor's load-bearing width the
     projectile physically removed — pure geometry, priced by
     systems/impactbus.js from the projectile's frontal width and its energy.
     A 34 m wingspan through a 44 m tower is ~0.7, which is the right
     neighbourhood: NIST found the real impact severed roughly two thirds of
     the impacted face's perimeter columns.

     A sever takes the floor straight past its failure threshold — that is what
     "the columns are gone" means, and clamping it back to the edge would make
     the number a lie. What stops the tower dropping in the same frame is not
     the sever, it is the YIELD below.
  ------------------------------------------------------------------------- */
  const SEVER_CRITICAL = 0.35;  // a cut this deep is visibly a catastrophe THIS instant

  /* ---- THE YIELD (why the tower stands there burning) --------------------
     An overloaded steel floor does not fail the instant its capacity is
     exceeded. It CREEPS: it sags, it pulls the perimeter inward, and it holds
     — for a long time — while it heats. That is not a game concession, it is
     the only full-scale observation anyone has: both towers absorbed their
     impact and STOOD, one for 56 minutes and one for 102, and the recorded
     mechanism was floor trusses sagging over two feet and dragging the
     perimeter columns in until THEY buckled.

     So the load path failing is a VERDICT, not an event. We latch how long the
     structure has left the moment it goes over, and the building spends that
     time visibly dying: burning, groaning, shedding, sagging. That wait is the
     drama. Deleting it would not make the feature bigger, it would make it a
     cut to black.

     Time left is set by HOW FAR past the edge it went, squared, so the shape
     is right at both ends:
       * a MOAB or a nuke leaves nothing of the floor (overload ~1) -> ~0 s,
         it goes now, which is what those weapons are for;
       * an airliner into a tower (overload ~0.33) -> ~30 s of catastrophe;
       * a fire that creeps a floor barely over the line (overload ~0.05) ->
         over a minute of sag before anything happens.

     LATCHED, not recomputed. Fire steadily eating the same floor does NOT
     shorten a countdown already running — the creep time was set by the
     initial overload. Only a NEW sudden load (a second plane, a bomb into the
     wound) re-latches, and then only downward. Without the latch, the fire
     that makes the arc dramatic would also collapse it to a couple of seconds.
  ------------------------------------------------------------------------- */
  const YIELD_MAX = 70;         // seconds a floor can creep when it is barely over the line

  /* ============================================================
     LEDGER
     rec = {
       lot, b,                 the lot and its building
       dmg, cap,               accumulated damage / capacity
       stage,                  STAGE.*
       floors: Float32Array,   per-floor integrity 1..0 (load-path model)
       fires: [{f, t, spread}] burning floors
       fireDmg,                damage fire has contributed so far (capped)
       wound: {x,y,z,nx,nz},   the worst wound — where the collapse initiates
       by,                     who is credited for the eventual collapse
       t,                      seconds in the current stage
       shell,                  the collapse proxy group (stage 5 only)
     }
     Keyed by the lot object itself (stable for the world's lifetime) with a
     coordinate key mirrored in for the net/save side, matching demolition.js's
     addressing so the two ledgers agree on identity.
     ============================================================ */
  const ledger = new Map();          // lot -> rec
  const collapsing = [];             // active collapse choreographies
  // Buildings condemned while the animated-collapse cap was full. Drained a
  // few per frame (see drainCondemned) so levelling a district costs a steady
  // trickle of geometry rather than one catastrophic frame.
  const condemned = [];
  const S = (CBZ.structure = {});
  S.STAGE = STAGE;
  S.onStage = null;                  // fn(rec, stage) — mission/HUD seam
  S.onCollapse = null;               // fn({x, z, lot, by, storeys}) — mission seam

  function arena() { return CBZ.city && (CBZ.city.arena || CBZ.city); }
  function inCity() { return CBZ.game && CBZ.game.mode === "city"; }
  function maxCollapses() { return Math.max(1, Math.round(CBZ.qScale ? CBZ.qScale(1, 4) : 3)); }

  // Buildings that must never pancake — landmark tier, player infrastructure,
  // story anchors. They still take every other stage: holes, fire, sag, a
  // shed facade. They just do not come down.
  //
  // THIS PREDICATE MUST MIRROR city/demolition.js's `eligible()` EXACTLY.
  // finishCollapse() hands the lot to demolition.destroy() to lay the rubble
  // and run the rebuild calendar; if demolition refuses a lot we already
  // batch-hid, the block would be left as an invisible hole in the world with
  // no pile and no rebuild. The helipad/hangar/park exclusions below are
  // demolition's, copied verbatim so the two can never disagree.
  //
  // THE STOREY CAP WAS THE BUG THAT KILLED THE OWNER'S HEADLINE FEATURE.
  // This file hardcoded 11 to mirror what demolition.js hardcoded. demolition
  // has since been fixed to read CBZ.CONFIG.DEMO_MAX_STOREYS (default 64) — and
  // this mirror was left at 11, so the two disagreed and the ONLY buildings a
  // player would ever deliberately fly a plane into were exactly the ones that
  // could not be felled: the 52-storey mega-tower, the 15-storey island twins,
  // every office block over eleven floors. A plane into a skyscraper produced a
  // fireball, a fire, a sagging CRITICAL stage... and then nothing, forever.
  //
  // Read the SAME config value, live, every call — not a load-time copy — so a
  // `?cfg_DEMO_MAX_STOREYS=11` URL revert restores the old behaviour in BOTH
  // files at once and the two can never drift again.
  function maxCollapseStoreys() {
    const v = CBZ.CONFIG.DEMO_MAX_STOREYS;
    return (typeof v === "number" && v > 0) ? v : 64;
  }
  function collapsible(lot) {
    const b = lot && lot.building;
    // demolition.destroy() refuses outright when its master flag is off. If we
    // condemned a lot anyway we would batch-hide a building nobody will ever
    // lay rubble for or rebuild — a permanent invisible hole. Mirror the gate.
    if (!CBZ.CONFIG.CITY_DEMOLITION) return false;
    if (!b || !b.group || !b.colliders || !b.colliders.length) return false;
    if (b.storeys > maxCollapseStoreys()) return false;      // landmark tier, per demolition.js's own gate
    // Mirrors demolition.js's DEMO_LANDMARKS gate exactly. Same reason as the
    // storey cap above: this predicate and demolition's `eligible()` MUST agree
    // or we batch-hide a building demolition then refuses to lay rubble for.
    // The helipad/hangar refusal was the second exemption keeping the 52-storey
    // flagship — the one building this whole feature exists for — immune.
    if (!CBZ.CONFIG.DEMO_LANDMARKS && (b.helipad || b.hangar)) return false;
    if (lot.kind === "park") return false;
    if (lot.demolished) return false;
    if (CBZ.cityDemolition && CBZ.cityDemolition.has && CBZ.cityDemolition.has(lot)) return false;
    return true;
  }

  /* ============================================================
     LOT RESOLUTION — "what did this hit?"
     A blast at (x, z) belongs to the building whose XZ footprint it is inside
     or nearest to, within a margin. This is the same box-distance test
     demolition.js used, lifted here so there is exactly ONE answer to the
     question in the codebase.
     ============================================================ */
  function lotAt(x, z, margin) {
    const A = arena();
    if (!A || !A.lots) return null;
    margin = margin == null ? 3 : margin;
    let best = null, bd = 1e9;
    for (let i = 0; i < A.lots.length; i++) {
      const lot = A.lots[i], b = lot.building;
      if (!b || lot.demolished) continue;
      const dx = Math.max(0, Math.abs(x - b.ox) - b.w / 2);
      const dz = Math.max(0, Math.abs(z - b.oz) - b.d / 2);
      const d = Math.hypot(dx, dz);
      if (d > margin || d >= bd) continue;
      bd = d; best = lot;
    }
    return best;
  }
  S.lotAt = lotAt;

  function recFor(lot) {
    let rec = ledger.get(lot);
    // A lot demolition.js has REBUILT (its rebuild calendar clears
    // lot.demolished) is a fresh building again. Without this the stale
    // stage-6 rec survives, hit()/sweep() early-out on
    // `stage >= COLLAPSING` forever, and the rebuilt block is permanently
    // immune to every future blast.
    if (rec && rec.stage >= STAGE.RUBBLE && !lot.demolished) { ledger.delete(lot); rec = null; }
    if (rec) return rec;
    const b = lot.building;
    const n = Math.max(1, b.storeys | 0);
    rec = {
      lot: lot, b: b, key: Math.round(lot.cx) + "," + Math.round(lot.cz),
      dmg: 0, cap: capacityOf(b), stage: STAGE.INTACT,
      floors: new Float32Array(n).fill(1),
      fires: [], fireDmg: 0, sever: 0, yield: null,
      byPlayer: false,
      wound: null, by: null, t: 0, shell: null,
    };
    ledger.set(lot, rec);
    return rec;
  }

  /* ============================================================
     THE LOAD-PATH CHECK (Red Faction, cheaply).
     A floor carries every floor above it. If a floor's integrity drops below
     the fraction of the tower it is holding up, the load path has failed
     THERE and that is where the collapse initiates. O(storeys) — for an
     11-storey block that is eleven multiplies.

     Returns the initiating floor index, or -1 if the building still stands.
     ============================================================ */
  // What fraction of itself floor `i` must retain to keep carrying the tower.
  // Split out of loadPathFailure so the SEVER brink rule and the failure test
  // can never use two different definitions of "the edge".
  function failThreshold(n, i) {
    // fraction of the building's mass this floor is holding up (1 at the
    // base, ~0 at the roof) — the "tributary load" a real column carries
    const above = (n - i) / n;
    // The 0.42 slack is what stops a single rocket from felling a tower: real
    // structures are massively over-engineered against their own static
    // weight, which is exactly why fire (a slow, wide integrity drain) is the
    // thing that actually brings buildings down.
    return Math.max(LOADPATH_FLOOR, above * 0.42);
  }

  function loadPathFailure(rec, amp) {
    const f = rec.floors, n = f.length;
    if (n < 1) return -1;
    if (!(amp > 0)) amp = 1;
    for (let i = 0; i < n; i++) {
      // A floor fails when what is left of it can no longer carry its load,
      // judged against a bar that a SUDDEN load raises (see DYNAMIC_AMP)...
      if (f[i] >= failThreshold(n, i) * amp) continue;
      // ...and the BUILDING only follows it down if what is above is enough to
      // overwhelm what is below. Otherwise the load redistributes, the damage
      // arrests, and we keep looking further down. See DISPROP_FLOORS above —
      // this is what makes "where you hit it" a real decision.
      if (disproportionate(n, i)) return i;
    }
    return -1;
  }
  // Published so a probe (or the cockpit HUD) can ask "how close is this one".
  S.loadPath = function (lot) {
    const rec = ledger.get(lot);
    if (!rec) return -1;
    return loadPathFailure(rec);
  };

  /* ============================================================
     CBZ.structure.hit(x, y, z, amount, opts) — THE ONE STRUCTURAL VERB.

     opts: {
       kind      ordnance id, for flavour + the kill-bus cause string
       pen       penetration energy. >0 drives damage INTO the building along
                 (dirx,dirz) instead of depositing it all on the facade —
                 the difference between a rocket scorching a wall and a jet
                 ending up in the middle of the floorplate.
       fire      0..1 ignition strength
       severWidth  METRES of the struck floor's load-bearing cross-section
                 physically REMOVED. Geometry, not damage — set only by callers
                 that carry a shape (an airframe, a flung vehicle), priced by
                 systems/impactbus.js as frontal width x energy coupling, and
                 resolved HERE against the building actually struck. See the
                 SEVER block near the top of this file for the brink rule.
       sever     the same thing pre-resolved to a 0..1 fraction, for a caller
                 that already knows its target's cross-section.
       sudden    the load arrived instantly (a strike) rather than gradually
                 (fire). Reserved by the bus; the disproportionate-collapse
                 rule already encodes the dynamic amplification this describes.
       dirx,dirz travel direction (ejecta + penetration axis)
       by        credited actor (kill bus)
       lot       pre-resolved lot
       legacy    set by the cityDamageBuilding wrapper — damage only, never
                 ignites and never initiates a collapse on its own, so
                 wrapping that function cannot change how the game already
                 played.
     }
     Returns the rec (or null).
     ============================================================ */
  S.hit = function (x, y, z, amount, opts) {
    opts = opts || {};
    if (!CBZ.CONFIG.STRUCT_LEDGER || !inCity() || !(amount > 0)) return null;
    // The legacy bridge (systems/impactbus.js's cityDamageBuilding wrapper) is
    // suppressed for the duration of a blast — see CBZ.impact.inBlast() there
    // for why. Checked HERE rather than in the wrapper so any future legacy
    // adopter inherits the same protection for free.
    if (opts.legacy && CBZ.impact && CBZ.impact.inBlast && CBZ.impact.inBlast()) return null;
    const lot = opts.lot || lotAt(x, z, opts.pen > 0 ? 6 : 4);
    if (!lot || !lot.building) return null;
    const rec = recFor(lot);
    if (rec.stage >= STAGE.COLLAPSING) return rec;      // already coming down
    const b = rec.b;

    // ---- PENETRATION -----------------------------------------------------
    // Exponential energy decay (the standard ballistics form E(x) = E0 e^-x/L)
    // decides how deep the warhead deposits its damage. A surface burst puts
    // everything on the facade; a penetrator carries most of it inside, which
    // is why a plane strike guts a floorplate and an RPG only remodels a wall.
    let depth = 0, carried = 1;
    if (opts.pen > 0) {
      const LAMBDA = 2.4;                  // metres of structure per e-fold
      // how far in the energy reaches before it is spent
      depth = Math.min(Math.max(b.w, b.d) * 0.55, LAMBDA * Math.log(1 + opts.pen));
      carried = Math.exp(-depth / (LAMBDA * (1 + opts.pen * 0.35)));
      // A penetrating hit spreads its damage across the floors it passes
      // through, rather than all landing on one.
    }

    // ---- FLOOR INTEGRITY -------------------------------------------------
    // Which floor did it hit? Impact height / floor height, clamped.
    const FH = b.FH || 3.2;
    const nF = rec.floors.length;
    // `|| 0` is a NaN TRAP, not style: a non-finite seat (a caller handing us a
    // NaN y) produced a NaN index, which a Float32Array silently swallows on
    // write — and then travelled into rec.wound.floor -> beginCollapse's initY
    // -> job.fall = NaN, so `k >= 1` was never true and that collapse job sat
    // in the concurrency cap FOREVER, wedging the whole feature after one bad
    // hit. Math.floor(NaN) || 0 === 0; Math.floor(n) || 0 === n for every real n.
    const hitFloor = Math.max(0, Math.min(nF - 1, Math.floor((y - 0.2) / FH) || 0));
    // damage in "capacity" units -> integrity loss on the struck floor and,
    // for a penetrator, its neighbours (a big airframe takes out more than one
    // floorplate: NIST found >50% of the impacted face's columns severed).
    const bite = amount / rec.cap;
    const spread = opts.pen > 6 ? 2 : opts.pen > 0 ? 1 : 0;
    for (let d = -spread; d <= spread; d++) {
      const f = hitFloor + d;
      if (f < 0 || f >= nF) continue;
      const falloff = d === 0 ? 1 : 0.45 / Math.abs(d);
      rec.floors[f] = Math.max(0, rec.floors[f] - bite * IMPACT_INTEGRITY * falloff);
    }

    // ---- SEVER ------------------------------------------------------------
    // Geometry, not damage: how much of the floor's cross-section is simply
    // GONE. This is what a wing does and a warhead cannot, and it is the whole
    // reason a plane strike now reads differently from a big rocket. See the
    // SEVER block up top for the brink rule and why it exists.
    let severed = 0;
    if ((opts.severWidth > 0 || opts.sever > 0) && !opts.legacy) {
      if (opts.sever > 0) {
        severed = Math.min(1, +opts.sever || 0);        // a caller that already knows the fraction
      } else {
        // Resolve METRES against THIS building's cross-section, measured
        // perpendicular to the travel axis: a plane flying along +x cuts
        // across the depth, one flying along +z cuts across the width. Only
        // this file knows which lot was hit, which is why the bus hands over a
        // width and not a fraction.
        let ax = Math.abs(opts.dirx || 0), az = Math.abs(opts.dirz || 0);
        const al = Math.hypot(ax, az);
        let cross;
        if (al > 1e-3) { ax /= al; az /= al; cross = ax * b.d + az * b.w; }
        else cross = Math.max(b.w, b.d);
        severed = Math.min(1, (+opts.severWidth || 0) / Math.max(4, cross));
      }
      const raked = severed >= 0.55 ? 2 : 1;     // a big airframe rakes the floors either side
      for (let d = -raked; d <= raked; d++) {
        const f = hitFloor + d;
        if (f < 0 || f >= nF) continue;
        const cut = d === 0 ? severed : severed * (0.5 / Math.abs(d));
        const target = 1 - cut;
        if (target < rec.floors[f]) rec.floors[f] = target;
      }
    }

    rec.dmg += amount;
    if (severed > rec.sever) rec.sever = severed;
    if (opts.by && !rec.by) rec.by = opts.by;
    // CREDIT AND BLAME ARE DIFFERENT THINGS, and conflating them was a live
    // bug: `by` (who is named in the killfeed) was also being read as "was
    // this the player" for crime, wanted level and kill attribution. So ANY
    // environmental source that filled in `by` for flavour — a tornado naming
    // the storm, a fire naming the building it spread from — charged the
    // player with murder and lit their stars for every block the weather
    // flattened, and the only safe way to attribute a natural collapse was to
    // attribute it to nobody at all. They are two fields now.
    if (opts.byPlayer) rec.byPlayer = true;

    // remember the worst wound — the collapse initiates and tilts from HERE,
    // which is what makes a collapse look like a consequence of the hit
    // rather than a canned animation.
    if (!rec.wound || amount > rec.wound.amount) {
      let nx = opts.dirx || 0, nz = opts.dirz || 0;
      const nl = Math.hypot(nx, nz);
      if (nl > 1e-3) { nx /= nl; nz /= nl; } else { nx = x - b.ox; nz = z - b.oz; const l2 = Math.hypot(nx, nz) || 1; nx /= l2; nz /= l2; }
      rec.wound = { x: x, y: y, z: z, nx: nx, nz: nz, floor: hitFloor, amount: amount, depth: depth };
    }

    // ---- FIRE ------------------------------------------------------------
    // Fuel-carrying ordnance lights the floors it reached. This is the beat
    // that converts an impact into a catastrophe over the following minute.
    if (CBZ.CONFIG.STRUCT_FIRE && opts.fire >= FIRE_IGNITE_MIN && !opts.legacy) {
      const nLit = opts.fire >= 0.7 ? 3 : opts.fire >= 0.3 ? 2 : 1;
      for (let i = 0; i < nLit; i++) ignite(rec, hitFloor + i - ((nLit / 2) | 0));
    }

    // ---- PENETRATION EXIT ------------------------------------------------
    // Energy that survived the structure blows OUT the far side. This is the
    // single most recognisable read of a real strike, and it is one call into
    // the debris system that already exists.
    if (opts.pen > 0 && carried > 0.06 && !opts.legacy) {
      const ex = x + (rec.wound.nx * depth), ez = z + (rec.wound.nz * depth);
      exitPlume(ex, y, ez, rec.wound.nx, rec.wound.nz, carried * (1 + opts.pen * 0.2));
    }

    advance(rec, opts);
    return rec;
  };

  /* ============================================================
     CBZ.structure.sweep(x, z, r0, r1, amount, opts)
     The RING form, used by the impact bus's propagating blast wave: damage
     every building whose footprint lies in the annulus [r0, r1). A nuke rolls
     outward through a district using this and nothing else.

     COST: one pass over lots per ring tick. Bounded by the wave's own tick
     rate (20 Hz) and by the number of lots, and it early-outs on the cheap
     centre-distance test before touching a rec.
     ============================================================ */
  S.sweep = function (x, z, r0, r1, amount, opts) {
    opts = opts || {};
    if (!CBZ.CONFIG.STRUCT_LEDGER || !inCity() || !(amount > 0)) return 0;
    const A = arena();
    if (!A || !A.lots) return 0;
    let n = 0;
    for (let i = 0; i < A.lots.length; i++) {
      const lot = A.lots[i], b = lot.building;
      if (!b || lot.demolished) continue;
      const d = Math.hypot(b.ox - x, b.oz - z);
      // the footprint straddles the front if the ring passes anywhere through it
      const half = Math.max(b.w, b.d) * 0.5;
      if (d + half < r0 || d - half >= r1) continue;
      /* ONE HIT PER BUILDING PER WAVE.

         The straddle test above is the right ADMISSION test — a building is
         caught the moment the front touches any part of its footprint, which
         is what makes a wide building at the rim get hit at all. But the front
         only advances `speed * 0.05` metres per tick: about 9.5 m for a nuke,
         4.5 m for an airliner's wave. Against a 28 m footprint that is three
         to seven consecutive ticks in which the SAME building straddles the
         SAME front and eats a full ring's damage each time.

         Measured cost of the bug: a 4-storey block 40 m from an airliner
         strike took ~245 damage against a capacity of 70 — it was deleted
         instantly — where the intended figure is ~47, a wound it should
         survive and then burn from. Worse, every one of those repeats carried
         `sudden: true`, so it also re-ran the amplified load-path test three to
         seven times. The wave was quietly the strongest weapon in the game.

         The fix is a stamp, not a geometry change: the admission test keeps its
         shape (so nothing about WHICH buildings a wave reaches moves), and the
         ledger simply refuses a second bite from the same wave. */
      if (opts.waveId) {
        const rec0 = ledger.get(lot);
        if (rec0 && rec0.waveId === opts.waveId) continue;
      }
      // HEIGHT GATE (restored from the legacy demolition loop): a blast seated
      // well above the roofline never touched this building. Without it an
      // airburst 300m up wounds every footprint beneath its ground projection.
      // `opts.y == null` means the caller has no seat (a pure ground ring), in
      // which case every building in the annulus is fair game.
      if (opts.y != null && opts.y > b.h + 4) continue;
      let nx = b.ox - x, nz = b.oz - z;
      const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      // Seat the hit at the blast height where that is meaningful, so a rooftop
      // detonation damages the top floors and a street blast the bottom ones —
      // the flat `min(h*0.5, 8)` always hit the ground floor.
      const seatY = opts.y != null ? Math.max(0.5, Math.min(b.h - 0.5, opts.y)) : Math.min(b.h * 0.5, 8);
      S.hit(b.ox, seatY, b.oz, amount, {
        kind: opts.kind, fire: opts.fire, dirx: nx, dirz: nz,
        // A shock front is the textbook sudden load — it is the case the
        // dynamic amplification factor was measured on. Passing it through is
        // what gives a nuke its three readable bands instead of one flat
        // radius: a core out-damaged outright, a middle where the overpressure
        // condemns buildings that then come down over the following minute,
        // and an edge that is scorched and standing.
        sudden: opts.sudden, by: opts.by, byPlayer: opts.byPlayer, lot: lot, pen: 0,
      });
      // stamp AFTER the hit — S.hit is what creates the rec on first contact
      if (opts.waveId) { const r2 = ledger.get(lot); if (r2) r2.waveId = opts.waveId; }
      n++;
    }
    return n;
  };

  /* ============================================================
     STAGE ADVANCE — the visible escalation.
     Each stage change fires the ONE beat that stage is worth, using the
     pooled FX that already exist. No stage draws anything new.
     ============================================================ */
  function advance(rec, opts) {
    const frac = rec.dmg / rec.cap;
    let want = rec.stage;
    if (frac >= T_CRITICAL) want = STAGE.CRITICAL;
    else if (rec.fires.length) want = STAGE.BURNING;
    else if (frac >= T_WOUNDED) want = STAGE.WOUNDED;
    else if (frac >= T_SCARRED) want = STAGE.SCARRED;
    // A DEEP CUT IS A CATASTROPHE THE INSTANT IT LANDS, whatever the damage
    // total says. This is the read the owner is actually asking for: the frame
    // after a plane goes into a tower, that tower must be visibly finished —
    // sagging, shedding its facade, groaning — not "scarred". On a 52-storey
    // flagship an airliner's damage is only ~18% of capacity, so without this
    // line the biggest event in the game would announce itself as a scorch
    // mark and the tell would arrive a minute later, with the fire.
    if (rec.sever >= SEVER_CRITICAL && want < STAGE.CRITICAL) want = STAGE.CRITICAL;
    // a burning building that was already critical does not de-escalate
    if (want < rec.stage) want = rec.stage;

    // CONDEMNATION. A legacy (wrapped cityDamageBuilding) hit can raise stages
    // but must never be the thing that fells a tower — that would change how
    // the game already plays for callers that never opted in.
    if (!opts.legacy && rec.stage < STAGE.COLLAPSING && collapsible(rec.lot)) {
      // OUT-DAMAGED OUTRIGHT: capacity is gone, there is nothing to creep. A
      // nuke, a MOAB, the sixth rocket into a corner shop. Immediate.
      if (frac >= 1) { beginCollapse(rec, rec.wound ? rec.wound.floor : 0); return; }
      const amp = opts.sudden ? DYNAMIC_AMP : 1;
      const f = loadPathFailure(rec, amp);
      // NEVER CLEARED once latched. Structure does not heal, and a gradual
      // re-evaluation must not be able to cancel a countdown a sudden load
      // started — that would let the very fire that makes the arc dramatic
      // also silently save the building on its next 4 Hz tick.
      if (f >= 0) latchYield(rec, f, !!opts.sudden, amp);
    }

    if (want === rec.stage) return;
    rec.stage = want; rec.t = 0;
    stageBeat(rec, want);
    if (typeof S.onStage === "function") { try { S.onStage(rec, want); } catch (e) {} }
  }

  /* ---- yield bookkeeping (see THE YIELD, up top) ------------------------ */
  function latchYield(rec, floor, sudden, amp) {
    const n = rec.floors.length;
    const thr = failThreshold(n, floor) * (amp > 0 ? amp : 1);
    const overload = Math.max(0, Math.min(1, (thr - rec.floors[floor]) / (thr || 1)));
    // squared: barely over the line creeps for a long time, nothing left goes now
    const left = YIELD_MAX * (1 - overload) * (1 - overload);
    if (!rec.yield || rec.yield.floor !== floor) {
      rec.yield = { floor: floor, left: left, t: 0, beat: 0 };
      return;
    }
    // Already counting down on this floor. A SUDDEN new load (another strike
    // into the same wound) may shorten it; the fire that is already eating it
    // may not — that time was set by the initial overload. See the latch note.
    if (sudden && left < rec.yield.left) rec.yield.left = left;
  }

  // Ticked from the main updater. The building spends this time visibly dying.
  //
  // BUDGET: one nuke can leave a district of buildings all counting down at
  // once. The countdown itself is four adds per building and is free; the TELL
  // is not, and un-budgeted it would be dozens of dust puffs and overlapping
  // "rumble" cues a second, which is both a frame cost and — worse — an audio
  // mush in which no individual building reads as dangerous any more. So the
  // tell is camera-gated and hard-capped per tick: the buildings near you
  // groan, the ones across the district just quietly come down later. Over the
  // cap we degrade by skipping the beat, never by queueing it.
  function stepYields(dt) {
    if (!ledger.size) return;
    let tells = Math.max(1, Math.round(CBZ.qScale ? CBZ.qScale(2, 5) : 4));
    const cam = CBZ.camera && CBZ.camera.position;
    const cull = (CBZ.cityCullRadius || 320);
    const fired = [];
    ledger.forEach(function (rec) {
      const y = rec.yield;
      if (!y || rec.stage >= STAGE.COLLAPSING) return;
      y.t += dt;
      // THE TELL. A structure about to go announces it: a groan of steel, dust
      // jetting out of the wound, a shiver through the block. Cadence tightens
      // as it runs out — the single clearest "get out from under this" cue the
      // game can give, and it costs two pooled calls every second or so.
      y.beat += dt;
      const k = Math.max(0.05, 1 - y.t / Math.max(0.001, y.left));
      const every = 0.7 + k * 2.0;
      if (y.beat >= every) {
        y.beat = 0;
        const b = rec.b, w = rec.wound;
        const near = !cam || Math.hypot(b.ox - cam.x, b.oz - cam.z) < cull;
        if (near && tells > 0) {
          tells--;
          try {
            if (CBZ.shake) CBZ.shake(0.5 + (1 - k) * 0.9);
            if (CBZ.sfx) CBZ.sfx("rumble", { volume: 0.5 + (1 - k) * 0.4 });
            if (CBZ.cityDustKick) {
              const px = w ? w.x : b.ox, pz = w ? w.z : b.oz;
              CBZ.cityDustKick(px, (y.floor + 0.5) * (b.FH || 3.2), pz, 1.2 + (1 - k) * 1.4);
            }
          } catch (e) {}
        }
      }
      // Never mutate the ledger from inside its own forEach — collect and act
      // after. beginCollapse can reach demolition.js, which can touch the map.
      if (y.t >= y.left) { rec.yield = null; fired.push(rec); }
    });
    for (let i = 0; i < fired.length; i++) {
      const rec = fired[i];
      if (rec.stage >= STAGE.COLLAPSING) continue;
      if (collapsible(rec.lot)) beginCollapse(rec, rec.wound ? rec.wound.floor : 0);
    }
  }
  // Seam: seconds left before this building goes, or -1. Missions, the cockpit
  // HUD and "get out of the building" prompts all want this one number.
  S.doomedIn = function (lot) {
    const rec = ledger.get(lot);
    if (!rec || !rec.yield) return -1;
    return Math.max(0, +(rec.yield.left - rec.yield.t).toFixed(2));
  };
  S.doomed = function () {
    const out = [];
    ledger.forEach(function (rec) {
      if (rec.yield) out.push({ x: rec.b.ox, z: rec.b.oz, lot: rec.lot, secs: +(rec.yield.left - rec.yield.t).toFixed(2), floor: rec.yield.floor });
    });
    return out;
  };

  function stageBeat(rec, stage) {
    const b = rec.b, w = rec.wound;
    if (!w) return;
    try {
      if (stage === STAGE.WOUNDED) {
        // the facade is genuinely open now — sheet debris down it and let the
        // wound smoke. cityWallRuin composes the whole read in one call.
        if (CBZ.cityWallRuin) CBZ.cityWallRuin(w.x, w.y, w.z, w.nx, w.nz, { power: 1.6, width: 3.2, top: w.y + 2, bottom: Math.max(0, w.y - 2) });
      } else if (stage === STAGE.CRITICAL) {
        // THE SAG. The last beat before it goes: a heavy section sloughs off
        // the facade and the whole block hears it. cityAirstrikeCollapse is
        // the existing partial-collapse composer and it self-throttles.
        if (CBZ.cityAirstrikeCollapse) CBZ.cityAirstrikeCollapse({ x: b.ox, z: b.oz }, { power: 2.4 });
        // SOUND NAMES ARE A CLOSED SET (systems/audio.js BANK). "boom" is NOT
        // in it — several files call it and it silently no-ops with a console
        // warning. The bank already has exactly the two cues this file wants:
        // "rumble" (the groan of a structure giving) and "collapse" (the pile
        // hitting the street). Use those; never invent a name.
        if (CBZ.sfx) CBZ.sfx("rumble");
      }
    } catch (e) {}
  }

  /* ============================================================
     FIRE — one cell per floor (Far Cry 2's automaton, one dimension).
     A floor burns for FIRE_LIFE seconds, drains the integrity of its own
     floor the whole time, and after FIRE_SPREAD seconds lights the floors
     above and below it (fire climbs faster than it falls, which is both true
     and the more dramatic read).
     ============================================================ */
  function ignite(rec, floor) {
    if (!CBZ.CONFIG.STRUCT_FIRE) return;
    const nF = rec.floors.length;
    if (floor < 0 || floor >= nF) return;
    for (let i = 0; i < rec.fires.length; i++) if (rec.fires[i].f === floor) return;
    if (rec.fires.length >= 8) return;               // bounded: a tower shows at most 8 burning floors
    rec.fires.push({ f: floor, t: 0, spread: 0, puff: 0 });
    if (rec.stage < STAGE.BURNING) { rec.stage = STAGE.BURNING; rec.t = 0; if (typeof S.onStage === "function") { try { S.onStage(rec, rec.stage); } catch (e) {} } }
  }
  S.ignite = function (lot, floor) { const r = lot && ledger.get(lot); if (r) ignite(r, floor | 0); };

  let fireAcc = 0;
  function stepFires(dt) {
    fireAcc += dt;
    if (fireAcc < FIRE_TICK) return;
    const step = fireAcc; fireAcc = 0;
    ledger.forEach(function (rec) {
      if (!rec.fires.length || rec.stage >= STAGE.COLLAPSING) return;
      const b = rec.b, FH = b.FH || 3.2;
      let structural = 0;
      for (let i = rec.fires.length - 1; i >= 0; i--) {
        const f = rec.fires[i];
        f.t += step; f.spread += step;
        if (f.t >= FIRE_LIFE) { rec.fires.splice(i, 1); continue; }
        // integrity drain on the burning floor — this is the mechanism that
        // eventually trips loadPathFailure() and fells the tower.
        // A floor that burns its FULL life loses 0.55*55/40 = 0.756 integrity.
        // That is deliberately just past the 0.35 load-path floor when combined
        // with any impact damage, and just short of it on its own — so fire
        // finishes what a strike started (the plane arc: ~40s from impact to
        // collapse) without a stray fire levelling an untouched block.
        rec.floors[f.f] = Math.max(0, rec.floors[f.f] - FIRE_STRUCT_DPS * step / 40);
        structural += FIRE_STRUCT_DPS * step;
        // spread: up first (heat rises), then sometimes down.
        // DETERMINISM: the ignited floor set feeds loadPathFailure -> collapse
        // -> cityDemolition.destroy, whose ledger is SERIALISED and net-relayed.
        // Math.random here would have two clients on one seed fell different
        // buildings. Position-hashed on the lot + floor + burn generation, so
        // every client spreads the same fire.
        if (f.spread >= FIRE_SPREAD) {
          f.spread = 0;
          f.gen = (f.gen || 0) + 1;
          ignite(rec, f.f + 1);
          const roll = CBZ.hash01 ? CBZ.hash01(b.ox + f.f, b.oz + f.gen, 0x1f12e) : 0.5;
          if (roll < 0.4) ignite(rec, f.f - 1);
        }
        // the visible flame + smoke column, on the pooled puff system, at a
        // rate the quality tier scales. Only for fires the camera can see.
        // Flame/smoke cadence rides the quality slider like every other FX
        // budget in the repo: 8 burning floors at 2 Hz is 16 puffs/second per
        // building, and a burning district would put that on every tier.
        // tier 0 emits at ~0.6 Hz, tier 4 at 2 Hz.
        f.puff += step;
        const puffEvery = CBZ.qScale ? CBZ.qScale(1.6, 0.5) : 0.5;
        if (f.puff >= puffEvery && CBZ.cityCrashSmoke) {
          f.puff = 0;
          const cam = CBZ.camera;
          const near = !cam || !cam.position || Math.hypot(b.ox - cam.position.x, b.oz - cam.position.z) < (CBZ.cityCullRadius || 320);
          if (near) {
            const side = Math.random() < 0.5 ? -1 : 1;
            const horiz = Math.random() < 0.5;
            // PLUME STANDOFF + a hot root. This emitted AT the wall plane
            // (`side * b.w * 0.5` IS the face), and cityCrashSmoke jitters every
            // puff +/-0.75 u laterally at scale 1 — so HALF the column was born
            // INSIDE the building and the rest lay flat on the facade. Sprites
            // are camera-facing, so at zero standoff a burning floor read as
            // dark blobs PAINTED on the glass: the same defect the owner just
            // purged from the blast wounds (crashfx.js FX_WALL_WOUNDS).
            // PLUME_OUT is 1.1 because it must strictly EXCEED that 0.75 jitter
            // — 0.6 would still birth a third of the plume inside the wall — so
            // every puff now starts in open air and the column reads as smoke
            // pouring OUT of a burning floor. `flame` adds the warm additive
            // lick under the smoke, because a fire that emits nothing but
            // near-black smoke IS a blob cluster, which is the other half of
            // why this read as a stain instead of as burning. The emitter's
            // rate, lifetime and self-termination are deliberately untouched.
            const PLUME_OUT = 1.1;
            const fnx = horiz ? 0 : side, fnz = horiz ? side : 0;
            const fx = b.ox + (horiz ? (Math.random() - 0.5) * b.w * 0.8 : side * b.w * 0.5) + fnx * PLUME_OUT;
            const fz = b.oz + (horiz ? side * b.d * 0.5 : (Math.random() - 0.5) * b.d * 0.8) + fnz * PLUME_OUT;
            try { CBZ.cityCrashSmoke(fx, f.f * FH + FH * 0.6, fz, { flame: true }); } catch (e) {}
          }
        }
      }
      if (structural > 0 && rec.fireDmg < rec.cap * FIRE_MAX_FRACTION) {
        rec.fireDmg += structural;
        rec.dmg += structural;
        advance(rec, {});
      }
    });
  }

  /* ============================================================
     THE COLLAPSE.

     Beat sheet (research-derived, compressed to game pacing):
       t=0.00  CONDEMNED. The building is still standing and still solid.
               Creak + rising rumble + dust jets punching out of the wound.
               This is the "tell" — the player gets ~1.1s to understand what
               is about to happen, which is what makes it read as a
               consequence rather than a cut.
       t=1.15  THE SWAP. Dust reaches full occlusion at the base; the real
               (batched) building is hidden through CBZ.batchHideGroup and a
               proxy shell of storey bands takes its place in the same pose.
               Colliders/platforms/LOS/doors unregister here — the block is
               no longer solid, which is also when anyone still inside dies.
       t=1.15..T  THE PANCAKE. A collapse front descends from the initiating
               floor at ~2/3 g. Bands above the front compress and sink;
               the shell tilts toward the wound (NIST observed ~25 degrees of
               tilt before the drop). Each band the front passes ejects a dust
               ring OUTWARD and a debris burst — the air jets that punch out
               below the front in every real collapse.
       t=T     IMPACT. Ground shock ring, the heaviest shake in the game short
               of the nuke, and the shell is disposed. demolition.js lays its
               deterministic rubble pile and starts its rebuild calendar.
       t=T+2.4 SETTLE. The dust pall thins.

     T = sqrt(2h / 6.5) — a 35 m block falls in ~3.3 s, a 100 m tower in ~5.5 s.
     ============================================================ */
  function beginCollapse(rec, initFloor) {
    if (rec.stage >= STAGE.COLLAPSING) return;
    rec.stage = STAGE.COLLAPSING; rec.t = 0;
    const b = rec.b, lot = rec.lot;

    // OVER THE CAP: skip the choreography and QUEUE the teardown.
    //
    // NOT a synchronous finishCollapse(): the nuke's blast wave sweeps a ring
    // every 50ms and a single ring can cross dozens of lots at once. Each
    // teardown runs demolition.js's buildRubble — 16-24 `new THREE.BoxGeometry`
    // plus meshes plus a tween — so doing them inline meant hundreds of
    // geometry allocations inside one wave tick, 20x a second, for three
    // seconds. That is the exact frame cliff the brief forbids, and it is the
    // budget the old hand-rolled nuke used to enforce with its own "2 lots per
    // frame" loop before that loop was (correctly) deleted as duplication.
    // The budget belongs HERE, once, for every condemnation source.
    if (!CBZ.CONFIG.STRUCT_COLLAPSE_V1 || collapsing.length >= maxCollapses()) {
      if (condemned.indexOf(rec) < 0) condemned.push(rec);
      return;
    }

    const h = b.h || (b.storeys * (b.FH || 3.2));
    const w = rec.wound || { nx: 1, nz: 0, floor: 0 };
    /* ---- CRUSH-DOWN / CRUSH-UP -----------------------------------------
       The collapse starts AT THE WOUND and eats the building both ways. This
       is the two-phase model from the only full-scale observation there is:

         CRUSH-DOWN  the block above the failed floor drops onto the floor
                     below, overloads its connections, adds that floor's mass
                     to itself, and repeats — a front descending under gravity.
         CRUSH-UP    once enough momentum has accumulated, the columns above
                     start buckling storey by storey too, chasing the mass
                     down. Late in the sequence a storey goes in under a tenth
                     of a second.

       `initY` — where the plane went in — used to be COMPUTED AND THEN NEVER
       READ: the old front started at the roof and swallowed the tower
       uniformly downward, so every collapse looked identical no matter what
       caused it or where. Now the two fronts open out of the hole, which means
       a strike on floor 40 visibly drops the top forty floors THROUGH the
       impact scar while the base stands for another second — the read that
       makes the collapse legibly a consequence of the hit.

       Down runs at the observed ~2/3 g. Up runs slower (it is buckling, not
       falling) but accelerates; 0.8 of the down rate lands the whole event
       inside the 5-9 s window real collapses of this height occupy.
    --------------------------------------------------------------------- */
    const initY = Math.max(0.5, Math.min(h - 0.5, (initFloor || 0) * (b.FH || 3.2)));
    const tDown = Math.sqrt(2 * initY / COLLAPSE_G);
    const tUp = Math.sqrt(2 * Math.max(0.5, h - initY) / (COLLAPSE_G * 0.8));
    const job = {
      rec: rec, lot: lot, b: b, t: 0,
      phase: 0,                                     // 0 pre-shudder, 1 falling, 2 settling
      fall: Math.max(2, Math.min(9, Math.max(tDown, tUp))),
      top: h,
      initY: initY,
      front: initY,                                 // the descending collapse front
      frontUp: initY,                               // the rising buckling front
      tiltX: -w.nz * 0.30, tiltZ: w.nx * 0.30,      // tilt AWAY from the wound side
      shell: null, bands: null, dustAcc: 0,
    };
    collapsing.push(job);

    // the tell: rumble, dust jets out of the wound, a groan of steel
    try {
      if (CBZ.shake) CBZ.shake(1.4);
      if (CBZ.sfx) CBZ.sfx("rumble");
      if (CBZ.cityDustKick) CBZ.cityDustKick(b.ox, 0.6, b.oz, 2.2);
      if (rec.wound && CBZ.cityChunk) {
        CBZ.cityChunk(rec.wound.x, rec.wound.y, rec.wound.z,
          { count: 8, force: 7, dirx: rec.wound.nx, dirz: rec.wound.nz });
      }
    } catch (e) {}
  }
  S.forceCollapse = function (lot, opts) {
    if (!lot || !lot.building) return false;
    const rec = recFor(lot);
    if (rec.stage >= STAGE.COLLAPSING) return false;
    if (opts && opts.by) rec.by = opts.by;
    if (opts && opts.byPlayer) rec.byPlayer = true;   // credit vs blame — see hit()
    if (!collapsible(lot)) return false;
    beginCollapse(rec, 0);
    return true;
  };

  /* ---- the proxy shell ---------------------------------------------------
     A stack of storey BANDS approximating the building's silhouette, built
     the moment the real one is hidden. <=10 boxes on cached materials, so a
     collapse costs about as much as one small prop. Never batched (it lives
     for four seconds), never disposed twice.
     WHY A PROXY AT ALL: the real building's geometry is MERGED into shared
     static buffers by core/batch.js. Moving b.group would not move a single
     merged vertex, and disposing those buffers is explicitly forbidden. So
     the only honest way to animate a collapse in this engine is the industry-
     standard one anyway: hide the real thing behind dust and animate a cheap
     stand-in (Frostbite/Control both ship exactly this).
  ------------------------------------------------------------------------ */
  function buildShell(job) {
    const b = job.b, A = arena();
    if (!A || !A.root || typeof THREE === "undefined") return;
    const g = new THREE.Group();
    const nBand = Math.max(2, Math.min(b.storeys | 0, Math.round(CBZ.qScale ? CBZ.qScale(3, 9) : 8)));
    const bandH = job.top / nBand;
    const mat = CBZ.cmat ? CBZ.cmat(b.wallColor || 0x8b8f94) : new THREE.MeshLambertMaterial({ color: b.wallColor || 0x8b8f94 });
    const bands = [];
    for (let i = 0; i < nBand; i++) {
      // a hair inset so the shell never z-fights the neighbours it replaces
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.w - 0.06, bandH, b.d - 0.06), mat);
      m.position.set(0, bandH * (i + 0.5), 0);
      m.castShadow = false; m.receiveShadow = true;
      g.add(m);
      bands.push({ mesh: m, y0: bandH * i, h: bandH, crushed: 0, blew: false });
    }
    g.position.set(b.ox, 0, b.oz);
    A.root.add(g);
    job.shell = g; job.bands = bands; job.bandH = bandH;
  }

  function disposeShell(job) {
    if (!job.shell) return;
    if (job.shell.parent) job.shell.parent.remove(job.shell);
    job.shell.traverse(function (o) { if (o.isMesh && o.geometry) o.geometry.dispose(); });   // materials are the shared cmat cache — never dispose
    job.shell = null; job.bands = null;
  }

  /* ---- hide the real building (and kill what is inside) ----------------- */
  /* Remove every member of `set` from `arr`, IN PLACE, in one pass.

     WHY THIS EXISTS: the obvious form — `indexOf` + `splice` per item — is
     O(n*m), and the headline case is precisely the one where n and m are both
     large. A 52-storey curtain-walled tower carries hundreds of window panes
     and its own collider set, against a global `CBZ.colliders` array holding
     the whole city. Unregistering it pane-by-pane is hundreds of full-array
     scans plus hundreds of memmoves, all inside the single frame the building
     is swapped out — a visible hitch at exactly the moment the game is asking
     the player to look at something. One filter pass is O(n).

     Compacted in place rather than reassigned: `CBZ.colliders` /
     `CBZ.platforms` / `CBZ.losBlockers` are the shared arrays half the engine
     captured a reference to at boot, and swapping the identity out from under
     them is a much worse bug than the one being fixed. */
  function purge(arr, set) {
    if (!arr || !set.size) return;
    let w = 0;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (set.has(v)) continue;
      if (w !== i) arr[w] = v;
      w++;
    }
    arr.length = w;
  }

  function hideReal(rec) {
    const b = rec.b;
    try {
      if (CBZ.batchHideGroup) CBZ.batchHideGroup(b.group);
      b.group.visible = false;
      const deadCols = new Set(), deadPlats = new Set(), deadLos = new Set();
      for (const gp of b.windows || []) {
        if (gp.shattered) continue;
        gp.shattered = true;
        if (gp.mesh) gp.mesh.visible = false;
        else if (CBZ._paneShow) CBZ._paneShow(gp, false);
        if (gp.col) deadCols.add(gp.col);
      }
      for (const c of b.colliders || []) deadCols.add(c);
      for (const p of b.platforms || []) deadPlats.add(p);
      for (const m of b.losMeshes || []) deadLos.add(m);
      for (const dr of b.doors || []) {
        dr.demolished = true;
        if (dr.colIn) { deadCols.add(dr.col); dr.colIn = false; }
      }
      purge(CBZ.colliders, deadCols);
      purge(CBZ.platforms, deadPlats);
      purge(CBZ.losBlockers, deadLos);
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    } catch (e) {}
    killInside(rec);
  }

  // Anyone standing in the footprint when it comes down dies, credited to
  // whoever condemned the building. EVERY death funnels through the shared
  // kill bus (CLAUDE.md) — this file never toasts a death itself.
  function killInside(rec) {
    const b = rec.b;
    const hx = b.w * 0.55, hz = b.d * 0.55;
    const cause = "crushed in the collapse";
    try {
      if (CBZ.cityCrowdCircleKill) {
        CBZ.cityCrowdCircleKill(b.ox, b.oz, Math.max(hx, hz), { quiet: true, fromX: b.ox, fromZ: b.oz, noCrime: !rec.byPlayer });
      }
      for (const p of (CBZ.cityPeds || [])) {
        if (!p || p.dead || !p.pos) continue;
        if (Math.abs(p.pos.x - b.ox) > hx || Math.abs(p.pos.z - b.oz) > hz) continue;
        if (CBZ.cityKillPed) CBZ.cityKillPed(p, { fromX: b.ox, fromZ: b.oz, force: 8, fling: 5, byPlayer: !!rec.byPlayer }, cause);
      }
      const PL = CBZ.player;
      if (PL && !PL.dead && PL.pos && CBZ.cityHurtPlayer
          && Math.abs(PL.pos.x - b.ox) < hx && Math.abs(PL.pos.z - b.oz) < hz) {
        CBZ.cityHurtPlayer(9999, b.ox, b.oz, cause, false, null, false);
      }
    } catch (e) {}
  }

  /* ---- the per-frame choreography --------------------------------------- */
  function stepCollapse(dt) {
    if (!collapsing.length) return;
    for (let i = collapsing.length - 1; i >= 0; i--) {
      const job = collapsing[i];
      job.t += dt;

      // PHASE 0 — pre-shudder. Nothing moves yet; the world just knows.
      if (job.phase === 0) {
        job.dustAcc += dt;
        if (job.dustAcc > 0.28) {
          job.dustAcc = 0;
          const b = job.b;
          try {
            if (CBZ.cityDustKick) CBZ.cityDustKick(b.ox + (Math.random() - 0.5) * b.w, 0.5, b.oz + (Math.random() - 0.5) * b.d, 1.4);
            if (CBZ.shake) CBZ.shake(0.5);
          } catch (e) {}
        }
        if (job.t >= PRESHUDDER) {
          // THE SWAP — hidden behind the dust we have been building for 1.15s
          hideReal(job.rec);
          buildShell(job);
          job.phase = 1; job.t = 0;
          try { if (CBZ.sfx) CBZ.sfx("explosion"); if (CBZ.shake) CBZ.shake(2.6); } catch (e) {}
        }
        continue;
      }

      // PHASE 1 — the pancake.
      if (job.phase === 1) {
        const k = Math.min(1, job.t / job.fall);
        // BOTH FRONTS OPEN OUT OF THE WOUND. Down under ~2/3 g (the observed
        // collapse-front acceleration), up at 0.8 of that (buckling, not
        // falling). Everything between them has already been consumed.
        job.front = Math.max(0, job.initY - 0.5 * COLLAPSE_G * job.t * job.t);
        job.frontUp = Math.min(job.top, job.initY + 0.5 * COLLAPSE_G * 0.8 * job.t * job.t);
        // how far the surviving upper block has ridden down as the structure
        // beneath it is eaten — this is what makes the top of the tower move
        // as ONE MASS instead of every band squashing in place.
        const sink = job.initY - job.front;
        if (job.shell && job.bands) {
          // tilt grows early then holds — real collapses lean, then drop
          const tk = Math.min(1, job.t / (job.fall * 0.55));
          job.shell.rotation.x = job.tiltX * tk;
          job.shell.rotation.z = job.tiltZ * tk;
          for (let bi = 0; bi < job.bands.length; bi++) {
            const band = job.bands[bi];
            if (band.y0 + band.h <= job.front) continue;      // still below the descending front: intact
            if (band.y0 >= job.frontUp) {
              // ABOVE the rising front: not yet buckling. It rides the
              // collapse down as an intact block — the falling upper section.
              band.mesh.position.y = Math.max(band.h * 0.5, band.y0 - sink + band.h * 0.5);
              continue;
            }
            // this band is inside the consumed zone — crush it
            band.crushed = Math.min(1, band.crushed + dt * 2.6);
            const s = 1 - band.crushed * 0.94;
            band.mesh.scale.y = s < 0.06 ? 0.06 : s;
            const rest = Math.max(0, band.y0 - sink);
            band.mesh.position.y = Math.max(band.h * 0.5 * band.mesh.scale.y,
              job.front + (rest - job.front) * (1 - band.crushed) + band.h * 0.5 * band.mesh.scale.y);
            // the AIR JET: each floor the front passes expels its air and
            // contents OUTWARD, which is the dust puff you see punching out
            // below the front in every real collapse. Once per band.
            if (!band.blew && band.crushed > 0.25) {
              band.blew = true;
              const b = job.b;
              const a = Math.random() * 6.2832;
              try {
                if (CBZ.cityDustKick) CBZ.cityDustKick(b.ox + Math.cos(a) * b.w * 0.5, band.y0, b.oz + Math.sin(a) * b.d * 0.5, 2.0);
                if (CBZ.cityChunk) CBZ.cityChunk(b.ox + Math.cos(a) * b.w * 0.4, band.y0, b.oz + Math.sin(a) * b.d * 0.4,
                  { count: 4, force: 6, dirx: Math.cos(a), dirz: Math.sin(a) });
              } catch (e) {}
            }
          }
        }
        // rolling rumble the whole way down, at ~6 Hz so it reads as a roar
        job.dustAcc += dt;
        if (job.dustAcc > 0.16) { job.dustAcc = 0; try { if (CBZ.shake) CBZ.shake(1.5 * (1 - k * 0.4)); } catch (e) {} }
        if (k >= 1) {
          disposeShell(job);
          finishCollapse(job.rec, false);
          job.phase = 2; job.t = 0;
        }
        continue;
      }

      // PHASE 2 — settle. The pall thins; then the job retires.
      if (job.t >= SETTLE) { collapsing.splice(i, 1); }
    }
  }

  /* ---- the ground impact + handoff to demolition.js ---------------------- */
  function finishCollapse(rec, snap) {
    const b = rec.b, lot = rec.lot;
    if (snap) hideReal(rec);                    // the un-animated path still has to clear the block

    if (!snap) {
      try {
        // the biggest ground beat in the game short of the nuke
        if (CBZ.shake) CBZ.shake(4.0);
        if (CBZ.sfx) { CBZ.sfx("collapse"); CBZ.sfx("rumble", { delay: 0.35 }); }
        if (CBZ.cityScorch) CBZ.cityScorch(b.ox, b.oz, Math.max(b.w, b.d) * 0.6);
        if (CBZ.cityDustKick) {
          // the pall rolls out along the streets — dust volume many times the
          // building's own footprint is the signature of a real collapse
          const n = Math.round(CBZ.qScale ? CBZ.qScale(4, 10) : 8);
          for (let i = 0; i < n; i++) {
            const a = (i / n) * 6.2832;
            CBZ.cityDustKick(b.ox + Math.cos(a) * b.w * 0.7, 0.5, b.oz + Math.sin(a) * b.d * 0.7, 2.6);
          }
        }
        if (CBZ.cityChunk) {
          CBZ.cityChunk(b.ox, 1.4, b.oz, { count: 20, force: 10 });
        }
        if (CBZ.cityShatter) CBZ.cityShatter(b.ox, b.oz, Math.max(b.w, b.d) + 14);   // the block's windows go
      } catch (e) {}

      /* THE DEBRIS FIELD. A tower does not land inside its own footprint.
         killInside() ran at the SWAP, seven seconds ago, and took whoever was
         standing in the building; this takes the street. Reach scales with
         HEIGHT, because that is what actually decides how far the pile and the
         pressure wave throw — a corner shop coming down is a nuisance at 12 m,
         the 52-storey flagship is lethal out to ~85 m.

         Those seven seconds between the pre-shudder and this are the point:
         the building tells you, loudly, and then you either moved or you did
         not. Every death goes through the shared kill bus (CLAUDE.md) — this
         file never toasts a death itself. */
      try {
        const reach = Math.max(b.w, b.d) * 0.6 + (b.h || 12) * 0.35;
        const cause = "buried in the collapse";
        if (CBZ.cityCrowdCircleKill) {
          CBZ.cityCrowdCircleKill(b.ox, b.oz, reach, { quiet: true, fromX: b.ox, fromZ: b.oz, noCrime: !rec.byPlayer });
        }
        for (const p of (CBZ.cityPeds || [])) {
          if (!p || p.dead || !p.pos) continue;
          const d = Math.hypot(p.pos.x - b.ox, p.pos.z - b.oz);
          if (d > reach) continue;
          if (CBZ.cityKillPed) CBZ.cityKillPed(p, { fromX: b.ox, fromZ: b.oz, force: 10, fling: 7, byPlayer: !!rec.byPlayer }, cause);
        }
        const PL = CBZ.player;
        if (PL && !PL.dead && PL.pos && CBZ.cityHurtPlayer) {
          const d = Math.hypot(PL.pos.x - b.ox, PL.pos.z - b.oz);
          // survivable at the rim, not at the base — the gradient is the
          // difference between a warning and a cutscene.
          if (d <= reach) {
            const dmg = Math.round(190 * (1 - d / reach));
            if (dmg > 0) CBZ.cityHurtPlayer(dmg, b.ox, b.oz, cause, false, null, false);
          }
        }
      } catch (e) {}
    }

    rec.stage = STAGE.RUBBLE;
    rec.fires.length = 0;
    rec.yield = null;

    // AFTERMATH IS demolition.js's JOB. It already owns the deterministic
    // rubble pile, the in-game-calendar rebuild arc, the save blob and the
    // net relay. We do NOT reimplement any of that — we hand it the lot.
    // `quiet` suppresses its own collapse FX (we just did a much bigger one)
    // and its own batch-hide is idempotent with ours.
    try {
      if (CBZ.cityDemolition && CBZ.cityDemolition.destroy) CBZ.cityDemolition.destroy(lot, { quiet: true });
    } catch (e) {}

    // MISSION SEAM — "bomb a city if you join the army" hangs off this.
    if (typeof S.onCollapse === "function") {
      try { S.onCollapse({ x: b.ox, z: b.oz, lot: lot, by: rec.by, byPlayer: !!rec.byPlayer, storeys: b.storeys, key: rec.key }); } catch (e) {}
    }
    // Post to the city event bus so panic/police/news react to a building
    // coming down the same way they react to any other atrocity.
    try {
      if (CBZ.cityEvent) CBZ.cityEvent("explosion", { x: b.ox, z: b.oz, panic: 60, damage: 40 }, { silent: true, noWanted: !rec.byPlayer });
    } catch (e) {}
  }

  /* ---- the exit plume (penetration read) --------------------------------- */
  // Energy that made it through the structure blows out the far side: a cone
  // of debris and dust downrange. One composed beat on the pooled systems.
  function exitPlume(x, y, z, nx, nz, strength) {
    const s = Math.min(3, strength);
    try {
      // cityEjectaCone (crashfx.js) is the composed EXIT read: spall thrown
      // downrange in a cone, a lance of hot gas ahead of it, directed slab dust
      // and a smoking mouth. Written for exactly this case — using it is the
      // difference between consolidating and quietly shipping a second one.
      // cityWallRuin is the WRONG read here: it pours everything DOWN the face
      // with a heap and rebar, which is a warhead that STOPPED.
      if (CBZ.cityEjectaCone) { CBZ.cityEjectaCone(x, y, z, nx, nz, 1.0 + s); return; }
      // fallback for a partial load (crashfx absent or older)
      if (CBZ.cityChunk) CBZ.cityChunk(x, y, z, { count: Math.round(5 + 6 * s), force: 8 + 6 * s, dirx: nx, dirz: nz });
      if (CBZ.cityDustKick) CBZ.cityDustKick(x + nx * 1.5, y, z + nz * 1.5, 1.4 + s);
    } catch (e) {}
  }
  S.exitPlume = exitPlume;

  /* ============================================================
     TICK — order 34.45: after systems/impactbus.js's wave sweep (34.4) and
     before city/demolition.js's phase ticker (34.5), so a building condemned
     by a wave this frame collapses and hands off within the same frame.
     Costs two length checks when nothing is damaged.
     ============================================================ */
  // Drain the condemnation queue at a fixed budget per frame. Nearest-first,
  // so what the player can actually see comes down first and the far side of
  // the district catches up over the next second or two — the same priority
  // the deleted hand-rolled nuke loop used.
  function drainCondemned() {
    if (!condemned.length) return;
    let budget = Math.max(1, Math.round(CBZ.qScale ? CBZ.qScale(1, 3) : 2));
    const cam = CBZ.camera && CBZ.camera.position;
    if (cam && condemned.length > 1) {
      // Key ONCE per record, then compare numbers. The comparator used to call
      // Math.hypot TWICE per comparison, and this whole sort re-runs EVERY
      // frame for as long as the queue drains (2-3 per frame) — so a nuke that
      // condemns 200 lots was ~2x200xlog2(200) = 3000 square roots a frame for
      // a hundred frames, in the exact scenario the brief says must not cost
      // frames. Squared distance orders identically; no sqrt at all now.
      for (let i = 0; i < condemned.length; i++) {
        const r = condemned[i], dx = r.b.ox - cam.x, dz = r.b.oz - cam.z;
        r._camD2 = dx * dx + dz * dz;
      }
      condemned.sort(function (a, c) { return a._camD2 - c._camD2; });
    }
    while (budget-- > 0 && condemned.length) {
      const rec = condemned.shift();
      if (!rec || rec.stage === STAGE.RUBBLE) continue;
      // Promote back to the animated path if a slot has opened since — the
      // spectacle is free when the budget allows it.
      if (CBZ.CONFIG.STRUCT_COLLAPSE_V1 && collapsing.length < maxCollapses()) {
        rec.stage = STAGE.CRITICAL;                  // let beginCollapse re-enter cleanly
        beginCollapse(rec, rec.wound ? rec.wound.floor : 0);
      } else {
        finishCollapse(rec, true);
      }
    }
  }

  if (CBZ.onUpdate) CBZ.onUpdate(34.45, function (dt) {
    if (!inCity()) return;
    if (!ledger.size && !collapsing.length && !condemned.length) return;
    const d = dt > 0.25 ? 0.25 : dt;
    if (collapsing.length) stepCollapse(d);
    if (condemned.length) drainCondemned();
    stepYields(d);
    if (CBZ.CONFIG.STRUCT_FIRE) stepFires(d);
  });

  /* ============================================================
     PUBLIC SURFACE — seams for neighbouring domains.
     ============================================================ */
  S.state = function (lot) {
    const rec = ledger.get(lot);
    if (!rec) return { stage: 0, dmg: 0, cap: lot && lot.building ? capacityOf(lot.building) : 0, fires: 0 };
    return {
      stage: rec.stage, dmg: +rec.dmg.toFixed(2), cap: +rec.cap.toFixed(2),
      frac: +(rec.dmg / rec.cap).toFixed(3), fires: rec.fires.length,
      floors: Array.prototype.slice.call(rec.floors).map(function (v) { return +v.toFixed(3); }),
      // the numbers a probe needs to answer "why is/isn't it coming down"
      sever: +(rec.sever || 0).toFixed(3),
      loadPath: loadPathFailure(rec),
      doomedIn: rec.yield ? +(rec.yield.left - rec.yield.t).toFixed(2) : -1,
      woundFloor: rec.wound ? rec.wound.floor : -1,
      storeys: rec.floors.length,
      collapsible: collapsible(rec.lot),
      by: rec.by || null, byPlayer: !!rec.byPlayer,
    };
  };
  S.stateAt = function (x, z) { const lot = lotAt(x, z, 6); return lot ? S.state(lot) : null; };
  S.burning = function () {                                   // mission/HUD seam: every building on fire
    const out = [];
    ledger.forEach(function (rec) { if (rec.fires.length) out.push({ x: rec.b.ox, z: rec.b.oz, floors: rec.fires.length, stage: rec.stage }); });
    return out;
  };
  S.collapsingCount = function () { return collapsing.length; };
  S.damagedCount = function () { return ledger.size; };
  S.list = function () {
    const out = [];
    ledger.forEach(function (rec) { out.push({ k: rec.key, stage: rec.stage, frac: +(rec.dmg / rec.cap).toFixed(3), fires: rec.fires.length }); });
    return out;
  };
  // Full restore for a new run — called alongside demolition.reset().
  //
  // A job that has passed its pre-shudder has ALREADY run hideReal(): the
  // building is batch-hidden and its colliders/platforms/LOS/doors are
  // unregistered, but it is not yet in demolition's ledger. Just dropping the
  // job would leave a permanently invisible, non-solid hole where a building
  // used to be, because demolition's own reset only rebuilds lots IT knows
  // about. So hand every in-flight teardown to demolition first — it lands in
  // that ledger, and the reset running immediately behind us rebuilds it.
  S.reset = function () {
    for (let i = collapsing.length - 1; i >= 0; i--) {
      const job = collapsing[i];
      disposeShell(job);
      if (job.phase >= 1 && job.rec && job.rec.stage !== STAGE.RUBBLE) {
        try {
          if (CBZ.cityDemolition && CBZ.cityDemolition.destroy) CBZ.cityDemolition.destroy(job.lot, { quiet: true, silent: true });
        } catch (e) {}
      }
    }
    collapsing.length = 0;
    // queued-but-untouched condemnations never ran hideReal, so they just drop
    condemned.length = 0;
    ledger.clear();
    fireAcc = 0;
  };
  // dev/QA: read the whole system's numbers from a CDP probe, no rendering.
  S.debug = function () {
    return {
      damaged: ledger.size, collapsing: collapsing.length,
      queued: condemned.length,
      maxConcurrent: maxCollapses(), burning: S.burning().length,
      maxStoreys: maxCollapseStoreys(),
      flags: { ledger: !!CBZ.CONFIG.STRUCT_LEDGER, collapse: !!CBZ.CONFIG.STRUCT_COLLAPSE_V1, fire: !!CBZ.CONFIG.STRUCT_FIRE },
    };
  };

  // A fresh run should not inherit a burning skyline. cityGlassReset is the
  // existing run-reset chokepoint demolition.js already hangs off; wrap it the
  // same lazy, marker-copying way (CLAUDE.md's wrapper rule) so both resets
  // fire and neither clobbers the other.
  if (CBZ.onUpdate) CBZ.onUpdate(0.02, function () {
    const orig = CBZ.cityGlassReset;
    if (typeof orig !== "function" || orig._structResetWrapped) return;
    const wrapped = function () { try { S.reset(); } catch (e) {} return orig.apply(this, arguments); };
    for (const k in orig) if (k.endsWith("Wrapped")) wrapped[k] = orig[k];
    wrapped._structResetWrapped = true;
    CBZ.cityGlassReset = wrapped;
  });
})();
