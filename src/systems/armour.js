/* ============================================================
   systems/armour.js — CBZ.armour: WHAT A ROUND DOES TO A PERSON WEARING KIT.

   One rule book for every game. A hit lands in a ZONE of the body; the zone
   is covered by a PIECE of armour (a hard plate, a soft panel, a helmet) or it
   is not. A piece either stops the round, with the energy still arriving as
   blunt trauma (a stagger, a winded man), or it is beaten and the round goes
   on into him with some of its energy spent. Where nothing covers him (the
   face, the neck, the gap under the arms, the pelvis, the limbs) he is
   wounded, and that is where wounds happen in a real fight.

   Page-free and THREE-free: node-loadable, no DOM, no scene. NPC War's damage
   funnel (src/battle/damage.js hurtMan) and Gang City's NPC hit path both ask
   it; entities/combatkit.js is what a wearer LOOKS like, this is what the
   same kit DOES, and both read one LOADOUT table (CBZ.combatKit.LOADOUTS ->
   its `armour` row -> issue()).

   ------------------------------------------------------------------
   THE HOOK (the weapons agent's side of the contract)
   ------------------------------------------------------------------
     const res = CBZ.armour.resolve(hit)
       hit = {
         target   the unit hit; its armour state is target.armour (issue())
         dmg      the damage the round would do to an unarmoured torso
         kind     "bullet" | "frag" | "blast" | "blunt" | "bite" | "crush"
                  (default "bullet" when a round/wid is given)
         round    a ROUNDS id ("556", "762x39", "9mm", ...) or
                  { threat, energy } of your own; else derived from `wid`
         wid      the weapon id (weapon-data.js) when there is no round
         zone     a ZONES id if the shooter already knows where it landed
                  (a raycast); else it is rolled (area-weighted)
         region   "head"|"torso"|"arm"|"leg": roll the zone inside it only
         raw      true = dmg is already priced for where it hit (a hitscan
                  with its own head/limb multipliers): only the kit acts
         headshot true = the shooter's roll put it in the head
         dirX/dirZ the direction the round TRAVELLED (world), for front/back
         yaw      the target's facing (radians, +Z forward at 0) for the same
         rng      a () -> [0,1) source (deterministic hosts pass their own)
       }
     res = {
       dmg        what reaches the person (hp to take off)
       zone       the zone it landed in; region = "head"|"torso"|"arm"|"leg"
       piece      "front"|"back"|"side"|"soft"|"helmet"|null
       stopped    the armour held          pen   it was beaten
       deflect    a helmet turned it (glancing)
       blunt      the share of dmg that is blunt trauma behind a stop
       stagger    0..1: how hard it rocks him (CBZ.soldier.hit sev)
       winded     seconds he is winded (slow, shaky aim)
       wound      a CBZ.soldier.wound zone ("legL","armR","torso",...) or null
     }
     The host applies it: hp -= res.dmg; stagger -> CBZ.soldier.hit;
     winded -> its own slow/aim; wound -> CBZ.soldier.wound.

   Unarmoured, a body hit is worth what it always was ON AVERAGE: the zone
   multipliers are normalised so the area-weighted mean is 1 (and the head's
   mean is HEAD_MEAN = 2.2, the multiplier NPC War's fire used). Balance moves
   only where there is armour.

   Other entries
     CBZ.armour.issue(spec)       a fresh armour STATE {pieces}, from a spec
                                  { plates, sides, soft, helmet } of CLASSES ids
                                  (or a LOADOUT's armour row)
     CBZ.armour.roundOf(widOrId)  the ROUNDS row a weapon fires
     CBZ.armour.pickZone(hit)     the zone roll alone
     CBZ.armour.coverage(state)   0..1 of presented area under armour (blasts)
     CBZ.armour.ROUNDS / CLASSES / ZONES / RULES   the tables (read-only)

   THE NUMBERS. Threat and rating share one scale, roughly the NIJ ladder:
   1 = 9 mm FMJ, 2.2 = what a IIIA panel is rated to (.44 Magnum), 3.4 = 5.56
   M855 / 7.62x39 MSC, 3.7 = 7.62x51 M80 (a Level III plate's rating), 4.6 =
   .30-06 M2 AP (a Level IV / ESAPI plate's rating), 6+ = .50 BMG. A round
   whose threat is under the piece's (integrity-adjusted) rating is stopped
   almost always; over it, almost always through; near it, a coin flip.
   Plates crack: every stop costs integrity in proportion to the energy, and
   a cracked ceramic plate's rating falls, so a burst into one plate gets
   through where a single round would not.
============================================================ */
(function () {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const CBZ = root.CBZ = root.CBZ || {};
  if (CBZ.armour && CBZ.armour.version) return;

  /* ---- THE ROUNDS: threat (the scale above) and muzzle energy (J) ---------
     energy drives the blunt trauma behind a stop and how fast a plate
     cracks. pellets: buckshot arrives as several small threats. */
  const ROUNDS = {
    "9mm":     { threat: 1.0, energy: 500,  label: "9x19 FMJ" },
    "45acp":   { threat: 1.1, energy: 480,  label: ".45 ACP" },
    "357":     { threat: 1.6, energy: 800,  label: ".357 Magnum" },
    "50ae":    { threat: 2.4, energy: 1900, label: ".50 AE" },
    "buck":    { threat: 0.8, energy: 2400, label: "12 ga 00 buck", pellets: 9 },
    "slug":    { threat: 2.1, energy: 3000, label: "12 ga slug" },
    "545":     { threat: 3.3, energy: 1300, label: "5.45x39 7N6" },
    "556":     { threat: 3.4, energy: 1750, label: "5.56x45 M855" },
    "762x39":  { threat: 3.3, energy: 2100, label: "7.62x39 PS" },
    "762x51":  { threat: 3.7, energy: 3300, label: "7.62x51 M80" },
    "762x54":  { threat: 3.9, energy: 3600, label: "7.62x54R LPS" },
    "300wm":   { threat: 4.3, energy: 5000, label: ".300 Win Mag" },
    "3006ap":  { threat: 4.6, energy: 4000, label: ".30-06 M2 AP" },
    "338":     { threat: 5.2, energy: 6500, label: ".338 Lapua" },
    "50bmg":   { threat: 6.5, energy: 18000, label: ".50 BMG" },
    "frag":    { threat: 0.7, energy: 300,  label: "fragment" },
    "fist":    { threat: 0,   energy: 120,  label: "blow" },
  };
  // what each gun in weapons/weapon-data.js fires (by id, then by slot)
  const ROUND_OF_WID = {
    sidearm: "9mm", smg: "9mm", uzi: "9mm", revolver: "357", deagle: "50ae", shotgun: "buck",
    carbine: "556", ak47: "762x39", lmg: "556", sniper: "762x51",
    taser: null, shank: null, bazooka: "frag", glauncher: "frag",
  };
  const ROUND_OF_SLOT = { pistol: "9mm", auto: "9mm", rifle: "556", long: "762x39" };

  /* ---- THE PIECES ----------------------------------------------------------
     rating on the threat scale; mat: ceramic cracks (rating falls with
     integrity), steel dents (rating holds, spalls), soft frays. trauma = the
     share of a stopped round's damage that still arrives as blunt trauma. */
  const CLASSES = {
    esapi:   { kind: "plate", mat: "ceramic", rating: 4.8, trauma: 0.10, label: "ESAPI (Level IV ceramic)" },
    gr6:     { kind: "plate", mat: "ceramic", rating: 4.6, trauma: 0.11, label: "6B45 Gr.6 ceramic (Br5)" },
    lvl3:    { kind: "plate", mat: "steel",   rating: 3.75, trauma: 0.14, label: "Level III steel" },
    lvl3pe:  { kind: "plate", mat: "pe",      rating: 3.6, trauma: 0.16, label: "Level III polyethylene" },
    esbi:    { kind: "plate", mat: "ceramic", rating: 4.5, trauma: 0.12, label: "ESBI side plate" },
    iiia:    { kind: "soft",  mat: "aramid",  rating: 2.2, trauma: 0.18, label: "NIJ IIIA soft panel" },
    ii:      { kind: "soft",  mat: "aramid",  rating: 1.4, trauma: 0.22, label: "NIJ II concealable" },
    ach:     { kind: "helmet", mat: "aramid", rating: 1.7, trauma: 0.15, deflect: 0.24, label: "ACH / ECH" },
    b6b47:   { kind: "helmet", mat: "aramid", rating: 1.7, trauma: 0.15, deflect: 0.22, label: "6B47 Ratnik" },
    pasgt:   { kind: "helmet", mat: "aramid", rating: 1.4, trauma: 0.17, deflect: 0.18, label: "PASGT" },
    steelpot:{ kind: "helmet", mat: "steel",  rating: 0.9, trauma: 0.2,  deflect: 0.15, label: "steel helmet" },
  };

  /* ---- THE ZONES -----------------------------------------------------------
     area: share of the presented silhouette of a standing man (body zones sum
     to 1; the head is rolled separately, by the shooter's headshot or HEAD_P).
     mult: lethality, relative (normalised below). cover: which piece covers
     it and how much of the zone's area that piece spans. */
  const ZONES = {
    skull:  { region: "head", headArea: 0.62, mult: 2.4, cover: { helmet: 0.92 } },
    face:   { region: "head", headArea: 0.38, mult: 2.0, cover: {} },
    neck:   { region: "torso", area: 0.03, mult: 2.4, cover: {} },
    thorax: { region: "torso", area: 0.20, mult: 1.25, cover: { plate: 0.86, soft: 1.0 }, wound: "torso" },
    abdomen:{ region: "torso", area: 0.12, mult: 1.05, cover: { plate: 0.18, soft: 0.55 }, wound: "gut" },
    side:   { region: "torso", area: 0.07, mult: 1.0, cover: { sides: 0.55, soft: 0.85 }, wound: "torso" },
    armpit: { region: "torso", area: 0.03, mult: 1.3, cover: {}, wound: "torso" },
    pelvis: { region: "torso", area: 0.08, mult: 0.9, cover: {}, wound: "gut" },
    upperArm:{ region: "arm", area: 0.09, mult: 0.55, cover: {}, wound: "arm" },
    forearm:{ region: "arm", area: 0.08, mult: 0.5, cover: {}, wound: "arm" },
    thigh:  { region: "leg", area: 0.18, mult: 0.7, cover: {}, wound: "leg" },
    shin:   { region: "leg", area: 0.12, mult: 0.55, cover: {}, wound: "leg" },
  };
  const HEAD_P = 0.12;          // a rolled hit that the shooter did not call
  const HEAD_MEAN = 2.2;        // the head multiplier NPC War's fire always used
  (function normalise() {
    let s = 0, a = 0, hs = 0;
    for (const k in ZONES) { const z = ZONES[k]; if (z.area) { s += z.area * z.mult; a += z.area; } else hs += z.headArea * z.mult; }
    const kb = a / s, kh = HEAD_MEAN / hs;
    for (const k in ZONES) { const z = ZONES[k]; z.k = z.mult * (z.area ? kb : kh); }
  })();

  const RULES = {
    steep: 4.0,           // the logistic slope of P(pen) over threat - rating
    penKeep: { plate: 0.72, soft: 0.86, helmet: 0.9 },   // the share of dmg left after beating a piece
    crack: { ceramic: 1.0, pe: 0.7, steel: 0.25, aramid: 0.45 },   // integrity cost multiplier
    crackPerJ: 0.11 / 1800,            // integrity lost per joule stopped (ceramic): ~4 rifle stops
    spent: 0.42,                       // rating share of a fully broken piece
    staggerRifle: 0.62, staggerPistol: 0.28,
    windedRifle: 2.4, windedPistol: 0.9,
    blastShare: 0.55,                  // of a blast's damage, the fragment share armour can stop
  };

  function roundOf(w) {
    if (!w) return null;
    if (typeof w === "object") return w.threat != null ? w : null;
    if (ROUNDS[w]) return ROUNDS[w];
    let id = ROUND_OF_WID[w];
    if (id === undefined && CBZ.weaponById) {
      const def = CBZ.weaponById(w);
      if (def && def.round && ROUNDS[def.round]) return ROUNDS[def.round];
      id = def ? ROUND_OF_SLOT[def.slot] : null;
    }
    return id ? ROUNDS[id] : null;
  }

  function piece(id) {
    const C = id && CLASSES[id];
    if (!C) return null;
    return { id: id, kind: C.kind, mat: C.mat, rating: C.rating, trauma: C.trauma, deflect: C.deflect || 0, integrity: 1, hits: 0 };
  }
  // spec: { plates, sides, soft, helmet } (CLASSES ids) -> the wearer's state
  function issue(spec) {
    if (!spec) return null;
    const P = {};
    if (spec.plates) { P.front = piece(spec.plates); P.back = piece(spec.plates); }
    if (spec.sides) { P.sideL = piece(spec.sides); P.sideR = piece(spec.sides); }
    if (spec.soft) P.soft = piece(spec.soft);
    if (spec.helmet) P.helmet = piece(spec.helmet);
    for (const k in P) if (!P[k]) delete P[k];
    return Object.keys(P).length ? { spec: spec, pieces: P, stops: 0, pens: 0 } : null;
  }

  function rngOf(hit) { return typeof hit.rng === "function" ? hit.rng : Math.random; }
  function pickZone(hit) {
    if (hit.zone && ZONES[hit.zone]) return hit.zone;
    const R = rngOf(hit);
    const head = hit.region === "head" || (hit.headshot != null ? !!hit.headshot : R() < HEAD_P);
    if (head) return R() < ZONES.skull.headArea ? "skull" : "face";
    // a caller that knows the region (a hitscan that hit the torso) rolls
    // only inside it
    let tot = 0;
    for (const k in ZONES) { const z = ZONES[k]; if (z.area && (!hit.region || z.region === hit.region)) tot += z.area; }
    let u = R() * tot, last = "thorax";
    for (const k in ZONES) {
      const z = ZONES[k]; if (!z.area || (hit.region && z.region !== hit.region)) continue;
      last = k;
      if ((u -= z.area) <= 0) return k;
    }
    return last;
  }
  // did it come in from behind? (dir = the round's travel, yaw = his facing)
  function fromBehind(hit) {
    if (hit.dirX == null || hit.yaw == null) return false;
    const fx = Math.sin(hit.yaw), fz = Math.cos(hit.yaw);
    return hit.dirX * fx + hit.dirZ * fz > 0;      // travelling the way he faces = into his back
  }
  // which piece covers this zone for this round, rolled against its span
  function coverOf(state, zone, hit, R) {
    if (!state || !state.pieces) return null;
    const P = state.pieces, c = ZONES[zone].cover;
    if (c.helmet && P.helmet && R() < c.helmet) return { key: "helmet", p: P.helmet };
    if (c.plate && (P.front || P.back) && R() < c.plate) {
      const k = fromBehind(hit) ? "back" : "front";
      if (P[k]) return { key: k, p: P[k] };
    }
    if (c.sides && (P.sideL || P.sideR) && R() < c.sides) {
      const k = R() < 0.5 ? "sideL" : "sideR";
      if (P[k]) return { key: k, p: P[k] };
    }
    if (c.soft && P.soft && R() < c.soft) return { key: "soft", p: P.soft };
    return null;
  }
  function ratingOf(p) {
    // a ceramic or PE plate loses rating as it cracks; steel and aramid barely
    const brk = p.mat === "ceramic" || p.mat === "pe" ? 1 : 0.35;
    return p.rating * (RULES.spent + (1 - RULES.spent) * Math.pow(Math.max(0, p.integrity), 0.7 * brk + 0.3));
  }
  function soldierZone(zone, R) {
    const w = ZONES[zone].wound;
    if (w === "leg") return R() < 0.5 ? "legL" : "legR";
    if (w === "arm") return R() < 0.5 ? "armL" : "armR";
    return w || null;
  }

  function resolve(hit) {
    hit = hit || {};
    const R = rngOf(hit);
    const dmg0 = +hit.dmg || 0;
    const state = hit.armour || (hit.target && hit.target.armour) || null;
    const kind = hit.kind || "bullet";
    const out = { dmg: dmg0, zone: null, region: null, piece: null, stopped: false, pen: false, deflect: false,
      blunt: 0, stagger: 0, winded: 0, wound: null };

    // ---- a BLAST: the fragment share is cut by what his kit covers -------
    if (kind === "blast") {
      const cov = coverage(state);
      out.dmg = dmg0 * (1 - RULES.blastShare * cov);
      out.zone = "body"; out.region = "torso";
      if (cov > 0) { out.stopped = true; out.stagger = Math.min(1, dmg0 / 120); }
      return out;
    }
    const zone = pickZone(hit), Z = ZONES[zone];
    out.zone = zone; out.region = Z.region;
    // the zone's lethality is a ROUND's: a blow, a bite or a crush keeps its
    // own number (only what the kit takes off it changes)
    const zk = (kind === "bullet" || kind === "frag") && !hit.raw ? Z.k : 1;
    out.dmg = dmg0 * zk;
    // ---- crush and blows to bare kit: plates spread a blow, not a crush ----
    if (kind === "crush") return out;
    const cv = coverOf(state, zone, hit, R);
    if (kind === "blunt" || kind === "bite") {
      if (cv) { out.piece = cv.key; out.dmg *= cv.p.kind === "plate" ? 0.45 : (cv.p.kind === "helmet" ? 0.35 : 0.7); out.stopped = cv.p.kind !== "soft" || kind === "blunt"; }
      if (!cv && R() < 0.5) out.wound = soldierZone(zone, R);
      return out;
    }
    // ---- a round (bullet / fragment) ----------------------------------------
    const rd = roundOf(hit.round) || roundOf(hit.wid) || (kind === "frag" ? ROUNDS.frag : ROUNDS["556"]);
    const rifle = rd.threat >= 3;
    if (!cv) {
      out.wound = soldierZone(zone, R);
      return out;
    }
    const p = cv.p;
    out.piece = cv.key;
    p.hits++;
    const rating = ratingOf(p);
    // a helmet turns a fair share of rifle rounds that meet it obliquely
    if (p.kind === "helmet" && rd.threat > rating && R() < p.deflect) {
      out.deflect = true; out.stopped = true;
      out.dmg = dmg0 * p.trauma * 0.8; out.blunt = out.dmg;
      out.stagger = 0.72; out.winded = 0.6;
      p.integrity = Math.max(0, p.integrity - 0.18);
      state.stops++;
      return out;
    }
    const pPen = 1 / (1 + Math.exp(-(rd.threat - rating) * RULES.steep));
    const ej = rd.energy / (rd.pellets || 1);
    const cost = ej * RULES.crackPerJ * (RULES.crack[p.mat] || 0.5);
    if (R() < pPen) {
      out.pen = true;
      out.dmg = dmg0 * zk * (RULES.penKeep[p.kind] || 0.8);
      out.stagger = rifle ? 0.5 : 0.3;
      out.wound = soldierZone(zone, R);
      p.integrity = Math.max(0, p.integrity - cost * 1.6);
      state.pens++;
      return out;
    }
    // stopped: the energy still arrives
    out.stopped = true;
    const e = Math.min(1.6, Math.sqrt(ej / 1750));             // a rifle round ~1
    out.dmg = dmg0 * p.trauma * (0.6 + 0.4 * e) * (p.kind === "helmet" ? 1.2 : 1);
    out.blunt = out.dmg;
    out.stagger = Math.min(1, (rifle ? RULES.staggerRifle : RULES.staggerPistol) * (0.7 + 0.3 * e));
    out.winded = p.kind === "helmet" ? 0.5 : (rifle ? RULES.windedRifle : RULES.windedPistol) * (0.7 + 0.3 * e);
    p.integrity = Math.max(0, p.integrity - cost);
    state.stops++;
    return out;
  }

  /* ---- THE FLOWN ROUND (NPC War's fire.js, src/weapons/ballistics.js) ------
     CBZ.battleArmour.layer(unit, zone, hit) -> {mat, mm} | null is the hook
     the weapons layer asks for the zone a traced round enters (ballistics
     zones: head, torso, gut, armL/armR, legL/legR). The ballistics model
     stops a round when the layer is thicker than the round's penetration
     depth in that material. This answers in that language with THIS file's
     rules: which piece covers the point (coverage roll inside the zone),
     whether it holds (threat v the piece's cracked rating, the same logistic),
     a helmet's deflection, and the crack it takes. Stopped -> a layer far
     thicker than the round can cross; beaten -> a layer it crosses, losing
     speed; nothing there -> null. The stop's blunt trauma is ballistics'
     own (12% of the energy); the stagger and the winded seconds are left on
     state.last for the damage funnel (battle/damage.js). hit = { cart, v, v0,
     dx, dz } (the round: a ballistics cartridge and its speed). */
  // the ballistics zone -> this file's zones (area-weighted inside it)
  const BZ = { head: ["skull", "face"], torso: ["neck", "thorax", "side", "armpit"], gut: ["abdomen", "pelvis"] };
  // a rating on the threat scale as mm of mild steel, the ballistics layer's unit
  const RATE_MM = [[0.9, 3], [1.4, 4.5], [1.7, 5.5], [2.2, 7.5], [3.6, 13.6], [3.75, 14.6], [4.6, 19], [4.8, 21], [6, 40]];
  function rateMM(r) {
    if (r <= RATE_MM[0][0]) return RATE_MM[0][1];
    for (let i = 1; i < RATE_MM.length; i++) {
      const a = RATE_MM[i - 1], b = RATE_MM[i];
      if (r <= b[0]) return a[1] + (b[1] - a[1]) * (r - a[0]) / (b[0] - a[0]);
    }
    return RATE_MM[RATE_MM.length - 1][1];
  }
  /* WHAT A FLOWN ROUND HAS AGAINST A PIECE: its steel-equivalent penetration
     (mm) at velocity v, the way that piece meets it. Aramid (a soft panel, a
     helmet shell) is rated against handgun speeds: a rifle round past ~600 m/s
     cuts it like the cloth it is. A hardened steel or PE plate rated Level III
     against 7.62x51 ball is beaten by a STEEL-PENETRATOR round at speed: M855
     (and 5.45 7N6) through AR500 inside ~100 m is why NIJ 0101.07 added RF2.
     The cartridge says so with `core: "steel"` (weapons/ballistics.js CART). */
  function pierceMM(p, cart, v, v0) {
    const B = CBZ.ballistics;
    if (!B || !cart) return 10;
    let pd = B.depth(cart, "steel", v, v0) * 1000;
    if (p.mat === "aramid" && v > 600) pd *= 2.2;
    if (cart.core === "steel" && (p.mat === "steel" || p.mat === "pe")) pd *= 1.55;
    return pd;
  }
  /* A PLATE AGAINST A FLOWN ROUND, by its own rules (shared by NPC War's page
     and the infantry core): "pen" | "stop" | "deflect". rng is the caller's
     seeded dice. The piece's rating falls as it cracks (ratingOf). */
  function versus(p, cart, v, v0, rng) {
    const R = rng || Math.random;
    const pd = pierceMM(p, cart, v, v0);
    const mm = rateMM(ratingOf(p));
    if (p.kind === "helmet" && pd > mm && R() < (p.deflect || 0)) return "deflect";
    const pPen = 1 / (1 + Math.exp(-((pd - mm) / Math.max(1, mm * 0.06))));
    return R() < pPen ? "pen" : "stop";
  }
  function layer(unit, zone, hit) {
    const state = unit && unit.armour;
    if (!state || !state.pieces) return null;
    const list = BZ[zone];
    if (!list) return null;                         // a limb: no plate on it
    const R = Math.random;
    let tot = 0;
    for (const k of list) tot += ZONES[k].area || ZONES[k].headArea * 0.5;
    let u = R() * tot, zn = list[0];
    for (const k of list) { u -= ZONES[k].area || ZONES[k].headArea * 0.5; if (u <= 0) { zn = k; break; } }
    const yaw = unit.yaw != null ? unit.yaw : (unit.group ? unit.group.rotation.y : 0);
    const cv = coverOf(state, zn, { dirX: hit && hit.dx, dirZ: hit && hit.dz, yaw: yaw }, R);
    if (!cv) return null;
    const p = cv.p;
    p.hits++; state.hits = (state.hits || 0) + 1;
    const B = CBZ.ballistics;
    // the round's steel-equivalent penetration now, in mm
    let pdMM = 10, ej = 1750, pdReal = 10;
    if (B && hit && hit.cart) {
      pdReal = B.depth(hit.cart, "steel", hit.v, hit.v0) * 1000;
      pdMM = pierceMM(p, hit.cart, hit.v, hit.v0);
      ej = B.energy(hit.cart, hit.v) / (hit.cart.pellets || 1);
    }
    const mm = rateMM(ratingOf(p));
    const rifle = pdMM > 8.5;
    const last = { t: state.hits, piece: cv.key, zone: zn, stopped: false, pen: false, deflect: false, stagger: 0, winded: 0 };
    state.last = last;
    if (p.kind === "helmet" && pdMM > mm && R() < p.deflect) {
      last.deflect = last.stopped = true; last.stagger = 0.72; last.winded = 0.6;
      p.integrity = Math.max(0, p.integrity - 0.18);
      state.stops++;
      return { mat: "steel", mm: pdMM * 4 + 10, piece: cv.key, deflect: true };
    }
    // the same logistic as resolve(), on the steel scale (a mm of margin ~ 0.1 of threat)
    const pPen = 1 / (1 + Math.exp(-((pdMM - mm) / Math.max(1, mm * 0.06))));
    const cost = ej * RULES.crackPerJ * (RULES.crack[p.mat] || 0.5);
    if (R() < pPen) {
      last.pen = true; last.stagger = rifle ? 0.5 : 0.3;
      p.integrity = Math.max(0, p.integrity - cost * 1.6);
      state.pens++;
      // it crosses: a layer it goes through, costing it what the plate took
      return { mat: "steel", mm: Math.min(mm, pdReal * 0.9), piece: cv.key };
    }
    last.stopped = true;
    const e = Math.min(1.6, Math.sqrt(ej / 1750));
    last.stagger = Math.min(1, (rifle ? RULES.staggerRifle : RULES.staggerPistol) * (0.7 + 0.3 * e));
    last.winded = p.kind === "helmet" ? 0.5 : (rifle ? RULES.windedRifle : RULES.windedPistol) * (0.7 + 0.3 * e);
    p.integrity = Math.max(0, p.integrity - cost);
    state.stops++;
    return { mat: "steel", mm: pdMM * 4 + 10, piece: cv.key };
  }

  /* WHAT A WEARER'S KIT ISSUES. N: a nation's kit row (entities/combatkit.js
     NATIONS, or battle/core/countries.js `kit`); pieces: what his loadout
     wears of it (["plates", "soft", "helmet"]); grade "second": a second-line
     issue (PE plates, no side plates). One mapping for the rig (combatkit.js
     wear) and for the infantry core, so the man drawn and the man simulated
     wear the same armour. */
  function kitSpec(N, pieces, grade) {
    const a = {};
    if (!N) return a;
    for (const k of pieces || []) {
      if (k === "plates") { if (N.plates) a.plates = grade === "second" ? "lvl3pe" : N.plates; if (N.sides && grade !== "second") a.sides = N.sides; }
      else if (k === "soft") { if (N.soft) a.soft = N.soft; }
      else if (k === "helmet") a.helmet = N.helmet === "b6b47" ? "b6b47" : (N.helmet === "pasgt" ? "pasgt" : (N.helmet ? "ach" : null));
    }
    return a;
  }
  // the share of a standing man's presented area under armour (blasts)
  function coverage(state) {
    if (!state || !state.pieces) return 0;
    const P = state.pieces;
    let c = 0;
    const hw = HEAD_P;                             // the head's share of the silhouette
    for (const k in ZONES) {
      const z = ZONES[k], cv = z.cover, area = z.area ? z.area * (1 - hw) : z.headArea * hw;
      let f = 0;
      if (cv.helmet && P.helmet) f = Math.max(f, cv.helmet * P.helmet.integrity);
      if (cv.plate && P.front) f = Math.max(f, cv.plate * (0.5 + 0.5 * P.front.integrity));
      if (cv.sides && P.sideL) f = Math.max(f, cv.sides);
      if (cv.soft && P.soft) f = Math.max(f, cv.soft * 0.9);
      c += area * f;
    }
    return Math.min(1, c);
  }

  CBZ.armour = {
    version: 1,
    ROUNDS: ROUNDS, CLASSES: CLASSES, ZONES: ZONES, RULES: RULES, ROUND_OF_WID: ROUND_OF_WID,
    HEAD_P: HEAD_P,
    roundOf: roundOf,
    issue: issue,
    pickZone: pickZone,
    resolve: resolve,
    coverage: coverage,
    layer: layer,
    rateMM: rateMM,
    pierceMM: pierceMM,
    kitSpec: kitSpec,
    versus: versus,
    piece: piece,
    ratingOf: ratingOf,
  };
  // the weapons layer's name for the hook (src/battle/fire.js armsHit)
  CBZ.battleArmour = CBZ.battleArmour || {};
  CBZ.battleArmour.layer = layer;
})();
