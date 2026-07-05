/* ============================================================
   city/millionaires.js — THE MONEYED CLASS: make the world richer for a
   rich player, and give millions of dollars something to DO.

   OWNER COMPLAINT
   ---------------
   "I got millions of dollars, make it more interesting for millionaires,
    add more millionaires."

   vips.js already puts 4 walking SUMMITS (Magnate/Don/Senator/Star/Judge)
   on the sidewalk — but that's a TINY rotating cast and it's the very TOP.
   Below them the street is all working-class civvies; the rich district
   doesn't read rich, and once you're loaded there's nothing the loaded
   actually do with each other. This file fills that gap WITHOUT touching
   vips.js / wealth.js — it builds on top of their exports.

   WHY (every piece has a felt, in-world reason)
   ---------------------------------------------
   1) MILLIONAIRES ON THE STREET — the uptown/core blocks are now lined with
      sharp-suited high-net-worth NPCs ("Tycoon" reads over the head), real
      watches/ice on them (= loot if you take them), a few SUPERCARS parked
      at the curb (Bugatti/Ferrari/Lambo), and some walking with a bodyguard.
      WHY: a rich district has to LOOK rich, and rich bodies are rich SCORES.
      Drafted from existing far civilians (zero new rigs where possible),
      capped, and released when they wander far — headcount stays flat-ish.

   2) SHAKE DOWN THE ULTRA-RICH (gunpoint) — put a drawn gun on a tycoon and
      you can demand their fortune: a HUGE payout scaled to their wealth, but
      their bodyguard squares up and it brings real heat. WHY: millions only
      mean something if there's a way to take millions — high risk, high score.

   3) THE FLEX LOOP — millionaires READ your flex/net-worth. Roll up loaded
      (high CBZ.cityFlexLevel / kingpin tier) and they nod, respect, gawk at
      your drip; roll up broke and they sneer and give you a wide berth.
      WHY: wealth should be SEEN and should change how the world treats you —
      the whole point of being rich in a city. Pure reuse of cityFlexLevel.

   4) THE CHARITY GALA + BILLIONAIRE TIER — a recurring black-tie gala in the
      core: sponsor it with a serious donation and buy a wall of RESPECT + a
      lasting flex bump (the philanthropy flex). And one tier ABOVE kingpin:
      cross $1B net worth and the city crowns you — a marquee, once-in-a-game
      recognition + a standing perk note. WHY: a goal BEYOND millions, and a
      classy money-sink that converts cash into status (what the rich buy).

   Everything DERIVES through existing systems: cityMakePed (peds.js) for the
   bodies, cityMakeCar (vehicles.js) for the supercars, the interactions
   registry (interactions.js) for every verb, cityRobPed / valuables → corpse
   & mug loot (economy.js / interact.js), CBZ.cityCrime + cityForceStars for
   heat, CBZ.cityFlexLevel + CBZ.cityEcon.wealthTier/netWorth for the read,
   CBZ.city.addCash/addRespect for payouts, CBZ.cityWealth.flexLevel data.

   GUARDED: no-ops outside city mode and whenever an export it needs is
   missing, so a missing sibling never throws.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const hyp = Math.hypot;

  let _s = 424242;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  const ri = (a, b) => a + ((rng() * (b - a + 1)) | 0);
  const pick = (arr) => arr[(rng() * arr.length) | 0];

  function arena() { return CBZ.city && CBZ.city.arena; }
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s); }
  function big(t) { if (CBZ.city && CBZ.city.big) CBZ.city.big(t); else note(t, 2.6); }
  function camD2(x, z) {
    const c = CBZ.camera; if (!c) return 1e9;
    const dx = x - c.position.x, dz = z - c.position.z;
    return dx * dx + dz * dz;
  }
  function money(n) { n = Math.round(n || 0); return "$" + n.toLocaleString("en-US"); }
  function netWorth() { return (CBZ.cityEcon && CBZ.cityEcon.netWorth) ? (CBZ.cityEcon.netWorth() | 0) : ((g.cash || 0) + (g.cityBank || 0)); }
  function flexLevel() { return CBZ.cityFlexLevel ? (CBZ.cityFlexLevel() | 0) : 0; }
  function tierId() { return (CBZ.cityEcon && CBZ.cityEcon.wealthTier) ? (CBZ.cityEcon.wealthTier().id || "broke") : "broke"; }

  // ============================================================
  //  THE CAST — believable old/new-money silhouettes. Suits are dark luxe;
  //  valuables are the real economy.js top-tier pieces (so they LOOT right).
  //  guardChance = how often this one walks with private security.
  // ============================================================
  const SUITS = [0x14171f, 0x1b2030, 0x232021, 0x2a2530, 0x1a1d24, 0x2e2622];
  const TYCOONS = [
    { title: "Tycoon",      job: "real-estate money",     wealth: 0.97, cash: [9000, 26000], vals: ["Richard Mille", "Briefcase of Cash"], guard: 0.5,  bag: [180000, 520000] },
    { title: "Heiress",     job: "old family fortune",    wealth: 0.96, cash: [6000, 18000], vals: ["Diamond Necklace", "Designer Bag"],    guard: 0.35, bag: [150000, 420000] },
    { title: "Financier",   job: "runs a hedge fund",     wealth: 0.95, cash: [7000, 20000], vals: ["Patek Philippe", "Cash Stack"],        guard: 0.3,  bag: [160000, 460000] },
    { title: "Developer",   job: "owns the new towers",   wealth: 0.94, cash: [5000, 15000], vals: ["Omega", "Briefcase of Cash"],          guard: 0.25, bag: [120000, 360000] },
    { title: "Mogul",       job: "media empire",          wealth: 0.95, cash: [8000, 22000], vals: ["Patek Philippe", "Gold Chain"],        guard: 0.4,  bag: [170000, 480000] },
  ];
  // supercars at the curb — the richest entries in economy.js's CARS.
  const SUPERCARS = ["Bugatti Veyron", "Ferrari 488", "Ferrari Enzo", "Lamborghini Aventador", "Porsche 911 Turbo"];

  const TARGET_TYCOONS = 9;     // how many to keep walking the rich blocks
  const TARGET_CARS = 4;        // parked supercars
  const MAX_FRESH = 7;          // hard cap on bodies WE create (vs. draft existing)
  const FAR2 = 130 * 130;       // beyond this from the camera → recycle the tycoon
  const OFFSCREEN2 = 80 * 80;   // never morph / spawn / despawn in view

  const M = {
    inited: false, tycoons: [], cars: [], fresh: 0,
    spawnCD: 1.5, carCD: 3, scanCD: 0, flexCD: 0, galaCD: 30, gala: null,
    crowned: false, billionaireNoted: false,
  };
  CBZ.cityMillionaires = M;   // read-only peek for siblings

  // ---- district helpers: only seed the WEALTHY blocks ----------------------
  function richPoint(A) {
    for (let t = 0; t < 12; t++) {
      const p = A.weightedSidewalkPoint ? A.weightedSidewalkPoint(rng) : A.randomSidewalkPoint();
      const d = A.districtAt ? A.districtAt(p.x, p.z) : null;
      const rich = !d || d.kind === "core" || d.kind === "commercial" || (d.tier && d.tier >= 1.05);
      if (rich && camD2(p.x, p.z) > OFFSCREEN2) return p;
    }
    return A.randomSidewalkPoint();
  }
  function roadRichPoint(A) {
    for (let t = 0; t < 10; t++) {
      const p = A.randomRoadPoint ? A.randomRoadPoint() : (A.weightedSidewalkPoint ? A.weightedSidewalkPoint(rng) : A.randomSidewalkPoint());
      const d = A.districtAt ? A.districtAt(p.x, p.z) : null;
      const rich = !d || d.kind === "core" || d.kind === "commercial" || (d.tier && d.tier >= 1.05);
      if (rich && camD2(p.x, p.z) > OFFSCREEN2) return p;
    }
    return null;
  }

  // ============================================================
  //  THE OFFICE / PENTHOUSE ANCHOR (LE5 + MAGNATE-1)
  // ------------------------------------------------------------
  //  THE #1 COMPLAINT: the magnate + his detail spawned glitching in the MIDDLE
  //  OF THE STREET (weightedSidewalkPoint). That reads broken AND wrong — a man
  //  who owns the new towers belongs IN one, behind a desk on a high floor, not
  //  loitering in a traffic lane. So a fresh tycoon now spawns at a PLACE that
  //  fits his story: the flagship MEGA-TOWER penthouse (CBZ.cityMegaTower) or a
  //  core-district OFFICE lot's lobby. The point is chosen OFF-SCREEN (he never
  //  morphs into view) and carries a y on the interior SLAB so an upper-floor
  //  anchor sits him on the penthouse marble, not sunk into the terrain.
  //
  //  Returns { x, z, y, face, lot, upper } or null. y>0 + upper=true means the
  //  body must be PINNED to that y every frame (peds.js gravity-resets pos.y=0),
  //  which the per-frame park below does. All reads are feature-detected so a
  //  missing buildings.js export just falls through to the sidewalk fallback.
  // ============================================================
  function megaPenthouseAnchor() {
    if (!CBZ.cityMegaTower) return null;
    let mt = null;
    try { mt = CBZ.cityMegaTower(); } catch (e) { return null; }
    if (!mt || !mt.lot) return null;
    const lot = mt.lot, b = lot.building || {};
    // the penthouse interior slab Y — the elevator/tour landing (NOT terrain).
    const floorY = (b.home && b.home.floorY != null) ? b.home.floorY
                 : (mt.penthouseDoor && mt.penthouseDoor.y != null ? mt.penthouseDoor.y : null);
    if (floorY == null || !(floorY > 0)) return null;   // headless / no upper slab → bail to fallback
    const door = mt.penthouseDoor;
    // stand a couple of metres INSIDE the penthouse off the door landing (the door
    // is pushed +1.6 OUT along its normal, so step back inward toward the cab/loft).
    let ax, az, face;
    if (door && door.x != null) {
      const nx = door.nx || 1, nz = door.nz || 0;
      ax = door.x - nx * 3.2; az = door.z - nz * 3.2;
      face = Math.atan2(nx, nz);                     // look back out toward the door/player
    } else {
      ax = lot.cx; az = lot.cz; face = 0;
    }
    return { x: ax, z: az, y: floorY, face: face, lot: lot, upper: true };
  }
  // a core-district OFFICE lot's lobby (ground-floor door) — the second-best
  // "fits his story" spawn when the single penthouse is occupied/onscreen. Ground
  // floor, so y stays 0 (no pinning needed); we still gate it OFF-SCREEN.
  function officeLobbyAnchor(A) {
    const lots = A.lots; if (!lots || !lots.length) return null;
    // a small randomized scan so we don't always pick the same tower; first
    // off-screen office whose lobby is clear wins.
    const start = (rng() * lots.length) | 0;
    for (let s = 0; s < lots.length; s++) {
      const lot = lots[(start + s) % lots.length];
      if (!lot) continue;
      const isOffice = lot.kind === "office" || (lot.building && lot.building.office);
      if (!isOffice) continue;
      const b = lot.building; const door = b && b.door;
      const x = door && door.x != null ? door.x : lot.cx;
      const z = door && door.z != null ? door.z : lot.cz;
      if (camD2(x, z) <= OFFSCREEN2) continue;       // never pop into view
      const nx = door && door.nx != null ? door.nx : 0, nz = door && door.nz != null ? door.nz : 1;
      return { x: x, z: z, y: 0, face: Math.atan2(-nx, -nz), lot: lot, upper: false };
    }
    return null;
  }
  // the chooser: penthouse first (the apex story), then an office lobby. Either
  // can be null (occupied / onscreen / absent) → spawnTycoon falls back to a
  // sidewalk richPoint so tycoon spawning NEVER stalls on a sparse-office tick.
  function officeAnchor(A) {
    // don't double-book the penthouse: if a parked magnate already holds it, skip
    // straight to an office lobby for the next one.
    let penthBusy = false;
    for (let i = 0; i < M.tycoons.length; i++) {
      const r = M.tycoons[i]; if (r && r._penthouse && r.ped && !r.ped.dead) { penthBusy = true; break; }
    }
    if (!penthBusy) {
      const ph = megaPenthouseAnchor();
      if (ph && camD2(ph.x, ph.z) > OFFSCREEN2) { ph._penthouse = true; return ph; }
    }
    return officeLobbyAnchor(A);
  }

  // ---- drafting an existing far civilian (cheapest: zero new rigs) ----------
  function draftableCiv(p) {
    if (!p || p.dead || p.isPlayer || p.vendor || p.gang || p.kind !== "civilian") return false;
    if (p.controlled || p.companion || p.recruited || p.vagrant || p._crowd || p._parked || p.inCar || p.enterT > 0) return false;
    if (p.vip || p._vipGuard || p._vipStash || p._milli || p._milliGuard) return false;
    if ((p.npcWanted | 0) || p.bounty || p.rage || p.surrender || p.reportState || p.approach || p.ko > 0) return false;
    if (p.isFamily || p.protectGang || p._clubLine || p.hostage || p.kidnapped) return false;
    if (camD2(p.pos.x, p.pos.z) < OFFSCREEN2) return false;
    return true;
  }
  function draftBody() {
    const peds = CBZ.cityPeds || [];
    let best = null, bw = -1;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!draftableCiv(p)) continue;
      const w = (p.wealth || 0) + rng() * 0.15;     // the well-dressed read as money
      if (w > bw) { bw = w; best = p; }
    }
    return best;
  }

  // ---- FIT: paint a body's torso/legs into a luxe suit (vips.js pattern) ----
  function paintFit(p, hex) {
    const ss = p.char && p.char.skinSlots; if (!ss || hex == null) return;
    const first = (arr) => (arr && arr[0] && arr[0].material && arr[0].material.color) ? arr[0].material.color.getHex() : null;
    if (!p._milliFit0) p._milliFit0 = { torso: first(ss.torso), collar: first(ss.collar), legs: first(ss.legs) };
    if (!p._milliFitIso) {
      const iso = (arr) => (arr || []).forEach((m) => { if (m && m.material) m.material = m.material.clone(); });
      iso(ss.torso); iso(ss.collar); iso(ss.legs);
      p._milliFitIso = true;
    }
    const paint = (arr, h) => { if (h == null) return; (arr || []).forEach((m) => { if (m && m.material && m.material.color) m.material.color.setHex(h); }); };
    paint(ss.torso, hex); paint(ss.collar, hex); paint(ss.legs, hex);
  }
  function restoreFit(p) {
    const f = p._milliFit0; if (!f) return;
    const ss = p.char && p.char.skinSlots; if (!ss) { p._milliFit0 = null; return; }
    const paint = (arr, h) => { if (h == null) return; (arr || []).forEach((m) => { if (m && m.material && m.material.color) m.material.color.setHex(h); }); };
    paint(ss.torso, f.torso); paint(ss.collar, f.collar); paint(ss.legs, f.legs);
    p._milliFit0 = null;
  }

  // ---- the LEVEL/title tag: "Tycoon" reads over the head -------------------
  function stampTag(p) {
    if (!p || !p.tag || p.dead || !CBZ.makeLabelSprite) return;
    const lv = CBZ.cityLevel ? CBZ.cityLevel(p) : 50;
    const want = "Lv." + lv + " " + p._milliTitle;
    if (p._milliTagText === want && p.tag.material === p._milliTagMat) {
      // still keep level.js's cache in sync so its sweep doesn't fight us
      if (CBZ.cityLevel) p._lvlShown = CBZ.cityLevel(p);
      p._lvlMat = p.tag.material;
      return;
    }
    const s = CBZ.makeLabelSprite(want, { color: "#ffe08a" });
    if (!s) return;
    p.tag.material = s.material;
    p._milliTagMat = s.material; p._milliTagText = want;
    if (CBZ.cityLevel) p._lvlShown = CBZ.cityLevel(p);
    p._lvlMat = p.tag.material;
  }

  // ---- casting a tycoon ----------------------------------------------------
  function castTycoon(p, def) {
    p._milli = def;
    p._milliTitle = def.title;
    p._milliBag = ri(def.bag[0], def.bag[1]);     // the fortune you shake them down for
    p.archetype = "socialite"; p.job = def.job; p.wealth = def.wealth;
    p.aggr = 0.18;                                  // money doesn't brawl
    p.cash = ri(def.cash[0], def.cash[1]);
    p.valuables = def.vals.slice();                 // economy.js top tiers → loot
    p._drip = null; p._dripKey = null;              // bling.js re-mirrors any worn ice
    p.baseSpeed = 1.45;                             // an unhurried stroll
    p.snitch = 0.35;                                // they DO call it in
    paintFit(p, pick(SUITS));
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(p);
  }
  function castGuard(q) {
    q._milliGuard = true; q.controlled = true;   // we drive it every frame (vips.js guard pattern)
    q.kind = "security"; q.archetype = "security"; q.job = "close protection";
    q.aggr = 0.9; q.armed = true; q.weapon = "Pistol"; q.ammo = 40;
    q.hp = q.maxHp = 150; q.baseSpeed = 2.2; q.snitch = 0; q.fear = 0;
    paintFit(q, 0x12141a);
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(q);
  }

  function recordTycoon(p, guard, anchor) {
    const rec = { ped: p, guard: guard || null };
    if (anchor) { rec._officeAt = anchor; rec._penthouse = !!anchor._penthouse; }
    M.tycoons.push(rec);
  }

  function spawnTycoon() {
    const A = arena(); if (!A || !A.root || !CBZ.cityPeds) return false;
    const def = pick(TYCOONS);
    let p = draftBody();
    let madeFresh = false;
    let anchor = null;                                 // set only for fresh bodies we place
    if (!p) {
      if (M.fresh >= MAX_FRESH || !CBZ.cityMakePed) return false;
      // FRESH BODY → spawn him at his OFFICE/PENTHOUSE, not the street. The office
      // anchor (penthouse slab or a core office lobby) is the story-correct WHERE;
      // it gracefully returns null when none is off-screen this tick, so we fall
      // back to a sidewalk richPoint and tycoon spawning never stalls.
      anchor = officeAnchor(A);
      const sp = anchor || richPoint(A);
      if (camD2(sp.x, sp.z) < OFFSCREEN2) return false;
      try {
        p = CBZ.cityMakePed(sp.x, sp.z, rng, { wealth: 0.95, archetype: "socialite" });
        if (!p) return false;
        A.root.add(p.group); CBZ.cityPeds.push(p); M.fresh++; madeFresh = true;
        // lift onto the interior slab if this is an UPPER-floor (penthouse) anchor —
        // peds.js gravity-resets pos.y, so the per-frame park re-pins it; this just
        // gets the first rendered frame right (no one-frame floor-of-the-world pop).
        if (anchor && anchor.upper && anchor.y > 0) p.pos.y = anchor.y;
        if (anchor && anchor.face != null && p.group) p.group.rotation.y = anchor.face;
        // anchor his identity to the tower so that IF he's ever drafted into the
        // ambient brain (aigoals.js) he gravitates home rather than wandering off —
        // his job IS this building. _digs (home) sticks for the penthouse owner;
        // _jobLot is the workplace. (The per-frame park is the authority either way,
        // so these are just belt-and-suspenders for a brain hand-off.)
        if (anchor && anchor.lot) { p._jobLot = anchor.lot; if (anchor.upper) p._digs = anchor.lot; }
      } catch (e) { return false; }
    }
    castTycoon(p, def);
    if (anchor) {
      p._officeAt = anchor;                            // the per-frame park reads this
      // LE5 — TIE HIS WEALTH TO THE MONEY LEDGER. When his tower carries a real
      // NPC account (wallet.js), let the fortune you shake him down for REFLECT
      // that ledger: a man parked atop a money-laden building is a fatter mark
      // than the floor sets by default. Pure READ of CBZ.cityNpcAcct (the contract
      // marks it read-only) — never seeds, never touches ownership, so companies.js
      // / housing.js state is untouched. Feature-detected; missing wallet = no-op.
      if (CBZ.cityNpcAcct && anchor.lot) {
        const till = CBZ.cityNpcAcct(anchor.lot) | 0;
        if (till > 0) {
          // a meaningful slice of the building's cash, floored to the def's bag so
          // the loot never reads SMALLER for sitting on money.
          p._milliBag = Math.max(p._milliBag || 0, Math.min(1500000, Math.round(till * 0.6)));
          p._milliLedgerLot = anchor.lot;              // for the size-up flavor line
        }
      }
    }
    // a private bodyguard for some of them: prefer drafting another far body
    let guard = null;
    if (rng() < def.guard) {
      const q = draftBody();
      if (q && q !== p) {
        castGuard(q);
        if (camD2(q.pos.x, q.pos.z) > OFFSCREEN2 && camD2(p.pos.x, p.pos.z) > OFFSCREEN2) {
          q.pos.set(p.pos.x + (rng() - 0.5) * 3, p.pos.y || 0, p.pos.z - 2);
          // a guard placed AT an upper-floor principal must ride the same slab Y,
          // else he stands in mid-air below the penthouse (the park re-pins both).
          if (anchor && anchor.upper && anchor.y > 0) q.pos.y = anchor.y;
        }
        guard = q;
      }
    }
    recordTycoon(p, guard, anchor);
    return true;
  }

  function releaseTycoon(rec, hard) {
    const p = rec.ped;
    if (p && !p.dead) {
      p._milli = null; p._milliTitle = null; p._milliBag = 0; p._milliTagText = null; p._milliTagMat = null;
      restoreFit(p);
      p.archetype = "resident"; p.state = "walk"; p.path = null; p.pause = 0.4 + rng();
      p._lvlShown = -1; p._lvlMat = null; p._drip = null; p._dripKey = null;
      p._officeAt = null;                              // stop parking him; back to street life
      if (p.pos && p.pos.y > 0.1) p.pos.y = 0;         // drop off any upper slab so he doesn't float
      if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(p);
    }
    const q = rec.guard;
    if (q && !q.dead) {
      q._milliGuard = false; q.controlled = false; q.rage = null;
      q.kind = "civilian"; q.archetype = "resident";
      q.job = "between jobs"; q.armed = false; q.weapon = null; q.aggr = 0.22;
      q.state = "walk"; q.path = null; restoreFit(q);
      if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(q);
    }
  }

  // ---- bodyguard driving: trail the principal, fight anyone raging at it ----
  function driveGuard(rec, dt) {
    const p = rec.ped, q = rec.guard;
    if (!q || q.dead) { rec.guard = null; return; }
    q.fear = 0; q.alarmed = 0; q.surrender = false;
    if (q.armed && q.ammo < 4) q.ammo = 40;
    // is anyone (incl. the player) a live threat to the principal?
    let th = q.rage && !q.rage.dead ? q.rage : null;
    if (!th) {
      const peds = CBZ.cityPeds || [];
      for (let i = 0; i < peds.length; i++) {
        const o = peds[i];
        if (!o || o.dead || o === q || o === p) continue;
        if (o.rage === p && hyp(o.pos.x - p.pos.x, o.pos.z - p.pos.z) < 22) { th = o; break; }
      }
      if (!th && p._milliThreat && !p._milliThreat.dead && p._milliThreatT > 0) th = p._milliThreat;
    }
    if (th) {
      q.rage = th; q.state = "fight";
      q.target.set(th.pos.x, 0, th.pos.z); q.path = null;
      return;
    }
    if (q.rage) q.rage = null;
    // hold a trailing post just behind the principal
    const h = p.group ? p.group.rotation.y : 0;
    const fx = p.pos.x - Math.sin(h) * 2.0 + Math.cos(h) * 1.1;
    const fz = p.pos.z - Math.cos(h) * 2.0 - Math.sin(h) * 1.1;
    const d = hyp(fx - q.pos.x, fz - q.pos.z);
    if (d > 50 && camD2(q.pos.x, q.pos.z) > OFFSCREEN2 && camD2(fx, fz) > OFFSCREEN2) {
      q.pos.set(fx, 0, fz); q.path = null;
    } else if (d > 1.3) {
      q.state = "walk"; q.path = null; q.pause = 0; q.target.set(fx, 0, fz);
    } else { q.state = "idle"; q.speed = 0; q.target.set(q.pos.x, 0, q.pos.z); }
  }

  // ============================================================
  //  PARK THE MAGNATE AT HIS OFFICE (MAGNATE-1)
  // ------------------------------------------------------------
  //  A spawned-fresh tycoon carries _officeAt (his penthouse slab or office
  //  lobby). While the player is FAR, we HOLD him there — idle pose, no stroll
  //  path, pinned to the anchor x/z AND (for an upper floor) re-pinned to the
  //  interior slab Y every frame, because peds.js gravity-resets pos.y=0 in its
  //  brain (order 34); THIS runs at 35.8, AFTER the brain, so the pin is what the
  //  frame renders — he stands ON the penthouse marble, never sinks to terrain.
  //  His bodyguard parks beside him on the same slab.
  //
  //  We RELEASE him to the existing stroll/flex/shakedown loop only when the
  //  player has actually REACHED him: within OFFSCREEN2 horizontally AND (for a
  //  penthouse) up on his floor (player pos.y near anchor.y — i.e. they took the
  //  elevator up). That makes meeting/robbing a penthouse magnate a real act —
  //  you go to him — and a ground-floor office magnate releases the instant you
  //  walk up, exactly as a sidewalk tycoon would. Returns true if it parked him
  //  (caller then SKIPS driveGuard's trailing logic for this frame).
  // ============================================================
  function parkAtOffice(rec, dt) {
    const anchor = rec._officeAt; const p = rec.ped;
    if (!anchor || !p || p.dead) return false;
    // a tycoon mid-interaction (raging, fleeing a shakedown, in a fight, fearful,
    // or already "entering" a building) is NOT parked — let his own brain run so
    // the rob/flee/guard-fight plays out uninterrupted.
    if (p.rage || p.state === "flee" || p.state === "fight" || (p.fear || 0) > 1 || (p.enterT || 0) > 0 || p._milliShaken) return false;

    const PA = CBZ.city && CBZ.city.playerActor;
    let reached = false;
    if (PA && !PA.dead) {
      const ddx = PA.pos.x - anchor.x, ddz = PA.pos.z - anchor.z;
      const near = (ddx * ddx + ddz * ddz) <= OFFSCREEN2;
      // upper-floor: also require the player to be ON the floor (elevator-arrived);
      // ground-floor office: anchor.y≈0 so the height test passes trivially.
      const onFloor = !anchor.upper || Math.abs((PA.pos.y || 0) - (anchor.y || 0)) < 3.0;
      reached = near && onFloor;
    }
    if (reached) return false;   // player is here → hand him to the normal loop

    // HOLD: pin to the anchor, idle pose, no stroll path. (pos IS group.position in
    // peds.js, so setting pos here is what renders this frame.)
    p.pos.x = anchor.x; p.pos.z = anchor.z;
    if (anchor.upper && anchor.y > 0) p.pos.y = anchor.y; else p.pos.y = 0;
    if (anchor.face != null && p.group) p.group.rotation.y = anchor.face;
    p.state = "idle"; p.speed = 0; p.path = null; p.pause = Math.max(p.pause || 0, 0.5);
    if (p.target) p.target.set(anchor.x, 0, anchor.z);

    // his guard parks at his shoulder on the same slab (no trailing wander).
    const q = rec.guard;
    if (q && !q.dead) {
      q.fear = 0; q.alarmed = 0; q.surrender = false; if (q.rage) q.rage = null;
      if (q.armed && q.ammo < 4) q.ammo = 40;
      q.pos.x = anchor.x + 1.3; q.pos.z = anchor.z - 0.6;
      q.pos.y = (anchor.upper && anchor.y > 0) ? anchor.y : 0;
      if (anchor.face != null && q.group) q.group.rotation.y = anchor.face;
      q.state = "idle"; q.speed = 0; q.path = null;
      if (q.target) q.target.set(q.pos.x, 0, q.pos.z);
    }
    return true;
  }

  // ============================================================
  //  SUPERCARS at the curb
  // ============================================================
  function spawnSupercar() {
    const A = arena();
    if (!A || !CBZ.cityMakeCar || !CBZ.cityEcon || !CBZ.cityEcon.carByName) return false;
    const sp = roadRichPoint(A); if (!sp) return false;
    const model = CBZ.cityEcon.carByName(pick(SUPERCARS)); if (!model) return false;
    try {
      const heading = sp.heading != null ? sp.heading : (rng() * Math.PI * 2);
      const c = CBZ.cityMakeCar(sp.x, sp.z, heading, !!sp.vertical, model, 0);
      if (!c) return false;
      c.v = 0; c.vx = 0; c.vz = 0; c.dwell = 9999;   // parked, not driving
      c._parked = true; c._milliCar = true;
      M.cars.push(c);
      return true;
    } catch (e) { return false; }
  }

  // ============================================================
  //  THE FLEX LOOP — millionaires READ your wealth & react
  // ------------------------------------------------------------
  //  Roll up loaded (high flex / top tier) → nods + envy gawks. Roll up broke
  //  → a sneer and a wide berth. Pure read of cityFlexLevel + wealthTier.
  // ============================================================
  function flexRead(dt) {
    M.flexCD -= dt; if (M.flexCD > 0) return;
    M.flexCD = 2.4;
    const PA = CBZ.city && CBZ.city.playerActor; if (!PA || PA.dead) return;
    const flex = flexLevel();
    const tid = tierId();
    const loaded = flex >= 6 || tid === "millionaire" || tid === "rich" || tid === "kingpin" || tid === "billionaire";
    const broke = flex < 1 && (tid === "broke" || tid === "hustler");
    let n = 0;
    for (let i = 0; i < M.tycoons.length && n < 2; i++) {
      const rec = M.tycoons[i]; const p = rec.ped;
      if (!p || p.dead || p.rage || p.fear > 1 || p.enterT > 0) continue;
      const d = hyp(p.pos.x - PA.pos.x, p.pos.z - PA.pos.z);
      if (d > 14 || d < 2) continue;
      if (camD2(p.pos.x, p.pos.z) > 60 * 60) continue;
      if (rng() < 0.4) continue;
      // turn to look at the player; brief stand-still using the brain's chatT
      p.group.rotation.y = Math.atan2(PA.pos.x - p.pos.x, PA.pos.z - p.pos.z);
      p.chatT = Math.max(p.chatT || 0, 1.4 + rng() * 1.6);
      p.reactCD = Math.max(p.reactCD || 0, 7);
      if (rng() < 0.35) {
        if (loaded) note("💼 " + (p._milliTitle || "A tycoon") + " gives you a respectful nod — they know real money.", 2.0);
        else if (broke) note("💼 " + (p._milliTitle || "A tycoon") + " looks you up and down and steps wide.", 2.0);
      }
      n++;
    }
  }

  // ============================================================
  //  THE CHARITY GALA — sponsor it: cash → respect + lasting flex.
  //  A money-sink that converts millions into the one thing the rich can't
  //  steal: standing. Surfaces as a zone interaction at a core point.
  // ============================================================
  function galaSpot() {
    const A = arena(); if (!A) return null;
    // anchor it near a clubbing/core lot if we can find one, else a core point
    for (const l of A.shopLots || []) {
      if (l.kind === "club" && l.building && l.building.door) {
        return { x: l.building.door.x, z: l.building.door.z };
      }
    }
    const p = richPoint(A);
    return { x: p.x, z: p.z };
  }
  function galaDonation() {
    // scaled to net worth so it stays a real bite for the loaded (elastic sink)
    const nw = netWorth();
    return Math.max(50000, Math.round(nw * 0.04 / 1000) * 1000);
  }
  function sponsorGala() {
    const amt = galaDonation();
    if ((g.cash || 0) < amt) {
      if ((g.cityBank || 0) >= amt && CBZ.city && CBZ.city.addCash) {
        // pull from the vault automatically
        g.cityBank -= amt;
      } else {
        note("The gala needs " + money(amt) + " on hand to headline. Come back richer.", 2.6);
        return;
      }
    } else {
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(-amt); else g.cash = Math.max(0, (g.cash || 0) - amt);
    }
    const resp = Math.max(40, Math.min(400, Math.round(amt / 4000)));
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(resp);
    // a lasting philanthropy flex bump (additive to wealth.js's recomputed flex)
    g.cityFlexBonus = (g.cityFlexBonus || 0) + 2;
    g.cityMilliGala = (g.cityMilliGala || 0) + 1;
    big("🥂 You headline the Charity Gala — " + money(amt) + " donated. The city's elite raise a glass to you.");
    note("+" + resp + " respect · the philanthropist's flex sticks.", 2.8);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.shake) CBZ.shake(0.2);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    M.galaCD = 90 + rng() * 60;   // the gala moves on; comes back later
  }

  // ============================================================
  //  THE BILLIONAIRE TIER — a goal ABOVE millions. Cross $1B net worth and
  //  the city crowns you, once. A standing recognition (and a note that the
  //  marquee — the Spire / apex purchase — is now within reach).
  // ============================================================
  const BILLION = 1000000000;
  function checkBillionaire() {
    if (M.crowned) return;
    const nw = netWorth();
    if (nw >= BILLION) {
      M.crowned = true; g.cityBillionaire = true;
      big("👑 BILLIONAIRE. The whole city knows your name now — you're not rich, you OWN this place.");
      note("There's nothing left to prove with money. Buy the marquee. Run the skyline.", 3.4);
      if (CBZ.sfx) CBZ.sfx("coin"); if (CBZ.shake) CBZ.shake(0.4);
    } else if (!M.billionaireNoted && nw >= BILLION * 0.5) {
      M.billionaireNoted = true;
      note("💵 Half a billion. The billionaire's club is in sight — " + money(BILLION - nw) + " to go.", 3.0);
    }
  }

  // ============================================================
  //  INTERACTIONS — registered once into the interaction registry.
  // ============================================================
  function isTycoon(p) { return !!(p && p._milli && !p.dead); }

  function shakeDown(p, ctx) {
    if (!isTycoon(p)) return;
    if (p._milliShaken) { note((p.name || "They") + " has nothing left to give.", 1.8); return; }
    const PA = CBZ.city && CBZ.city.playerActor;
    // if they have a live bodyguard nearby, it's a FIGHT, not a payday
    const rec = M.tycoons.find((r) => r.ped === p);
    const guard = rec && rec.guard;
    if (guard && !guard.dead && hyp(guard.pos.x - p.pos.x, guard.pos.z - p.pos.z) < 20) {
      if (rng() < 0.5) {
        // sometimes they pay anyway, scared — but the guard reacts
        guard.rage = PA; guard.state = "fight";
        p._milliThreat = PA; p._milliThreatT = 12;
      } else {
        note("💼 \"You think my security lets that happen?\" — the bodyguard goes for his gun.", 2.4);
        if (guard) { guard.rage = PA; guard.state = "fight"; }
        p._milliThreat = PA; p._milliThreatT = 12;
        p.fear = 4; p.state = "flee"; if (CBZ.cityFleeFrom && PA) CBZ.cityFleeFrom(p, PA.pos.x, PA.pos.z);
        if (CBZ.cityCrime) CBZ.cityCrime(90, { x: p.pos.x, z: p.pos.z, type: "armed-robbery" });
        return;
      }
    }
    // they pay. A huge score scaled to their fortune.
    const bag = p._milliBag || 200000;
    p._milliShaken = true; p.robbed = true; p.valuables = p.valuables || [];
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(bag); else g.cash = (g.cash || 0) + bag;
    big("💎 You shook down the " + (p._milliTitle || "tycoon") + " — " + money(bag) + ".");
    note("The ultra-rich pay to make you disappear. Cops will be looking.", 2.6);
    // real heat: this is grand extortion of a high-profile mark
    if (CBZ.cityCrime) CBZ.cityCrime(170, { x: p.pos.x, z: p.pos.z, type: "armed-robbery" });
    p.fear = 5; p.state = "flee"; if (CBZ.cityFleeFrom && PA) CBZ.cityFleeFrom(p, PA.pos.x, PA.pos.z);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  function registerInteractions() {
    const I = CBZ.interactions; if (!I || !I.register) return;
    // GUNPOINT-only: demand a tycoon's fortune (huge score, big heat).
    I.register("ped:civ", {
      id: "milli-shakedown", slot: "i", prio: 80, bad: true, needsGunDrawn: true,
      canShow: (p) => isTycoon(p) && !p._milliShaken,
      label: (p) => "Shake down for their fortune (" + money(p._milliBag || 0) + ")",
      onSelect: shakeDown,
    });
    // A flavor read so the rich aren't anonymous (no-gun, harmless).
    I.register("ped:civ", {
      id: "milli-sizeup", slot: "e", prio: 2,
      canShow: (p) => isTycoon(p),
      label: (p) => "Size up the " + (p._milliTitle || "tycoon"),
      onSelect: (p) => {
        const job = (p._milli && p._milli.job) || "serious money";
        // LE5: if his fortune is tied to a tower in the ledger, SAY so — the
        // building IS the money, which is why he's such a fat mark.
        if (p._milliLedgerLot && CBZ.cityNpcAcct) {
          const till = CBZ.cityNpcAcct(p._milliLedgerLot) | 0;
          if (till > 0) { note("💼 " + (p._milliTitle || "Tycoon") + " — " + job + ". His tower's books carry " + money(till) + "; squeeze him and a slice of that is yours.", 3.0); return; }
        }
        note("💼 " + (p._milliTitle || "Tycoon") + " — " + job + ". Worth a small fortune in cash and ice.", 2.6);
      },
    });

    // THE CHARITY GALA zone: walk up and sponsor it.
    I.registerZone({
      id: "milli-gala", kind: "milli-gala", radius: 5.5, prio: 7,
      find: function () {
        if (!M.gala) return null;
        if ((M.galaCD || 0) > 0) return null;        // between galas
        return { x: M.gala.x, z: M.gala.z, pos: { x: M.gala.x, y: 0, z: M.gala.z } };
      },
      options: [{
        id: "milli-gala-sponsor", slot: "e", prio: 10,
        label: () => "🥂 Headline the Charity Gala (" + money(galaDonation()) + ")",
        onSelect: () => sponsorGala(),
      }],
    });
    if (I.describe) I.describe("milli-gala", () => ({ label: "🥂 Charity Gala", note: "Donate big · buy the city's respect" }));
  }

  // ============================================================
  //  PER-FRAME — order 35.8 (just after vips.js at 35.7).
  // ============================================================
  CBZ.onUpdate(35.8, function (dt) {
    if (g.mode !== "city") return;
    const A = arena(); if (!A || !CBZ.cityPeds || !CBZ.cityPeds.length) return;
    if (CBZ.citySpawnDraining) return;   // wait until the roster is whole

    if (!M.inited) {
      M.inited = true;
      registerInteractions();
      M.gala = galaSpot();
      M.galaCD = 8;     // first gala opens shortly after load
    }

    // 1) MAINTAIN the millionaire population (drop far/dead, top up gradually)
    M.scanCD -= dt;
    if (M.scanCD <= 0) {
      M.scanCD = 0.5;
      for (let i = M.tycoons.length - 1; i >= 0; i--) {
        const rec = M.tycoons[i]; const p = rec.ped;
        const gone = !p || (CBZ.cityPeds.indexOf(p) < 0);
        const dead = p && p.dead;
        // the PENTHOUSE magnate is a DESTINATION, not a wanderer — he STAYS atop
        // his tower however far the player roams, so riding up to meet (or rob) him
        // always finds him home. He's only recycled if dead/gone, or once SPENT
        // (shaken — he's fled, purpose served). Ground-floor office-lobby magnates
        // (a spawn-location fallback, not a fixed destination) AND street tycoons
        // still recycle on distance so the walking cast keeps rotating near you.
        const anchored = p && rec._officeAt && rec._officeAt.upper && !p._milliShaken;
        const far = p && !dead && !anchored && camD2(p.pos.x, p.pos.z) > FAR2 && rng() < 0.25;
        // a shaken/robbed one has served its purpose — let it wander off when far
        const spent = p && p._milliShaken && camD2(p.pos.x, p.pos.z) > OFFSCREEN2;
        if (gone) { M.tycoons.splice(i, 1); continue; }
        if (dead) { /* leave the body as loot; just drop our record */ M.tycoons.splice(i, 1); continue; }
        if (far || spent) {
          if (camD2(p.pos.x, p.pos.z) > OFFSCREEN2) { releaseTycoon(rec, false); M.tycoons.splice(i, 1); }
        }
      }
    }
    M.spawnCD -= dt;
    if (M.spawnCD <= 0) {
      M.spawnCD = 1.2 + rng();
      if (M.tycoons.length < TARGET_TYCOONS) spawnTycoon();
    }

    // 2) supercars at the curb
    M.carCD -= dt;
    if (M.carCD <= 0) {
      M.carCD = 4 + rng() * 4;
      // prune dead/gone cars from our list
      for (let i = M.cars.length - 1; i >= 0; i--) {
        const c = M.cars[i];
        if (!c || c.dead || (CBZ.cityCars && CBZ.cityCars.indexOf(c) < 0)) M.cars.splice(i, 1);
      }
      if (M.cars.length < TARGET_CARS) spawnSupercar();
    }

    // 3) park office/penthouse magnates while the player is away, else drive
    //    bodyguards; decay threat memory; keep the tag fresh
    for (let i = 0; i < M.tycoons.length; i++) {
      const rec = M.tycoons[i]; const p = rec.ped;
      if (!p || p.dead) continue;
      if (p._milliThreatT > 0) p._milliThreatT -= dt;
      // a fresh magnate HOLDS at his office until the player reaches him; if parked
      // this frame, the park already posted his guard, so skip the trailing driver.
      const parked = rec._officeAt ? parkAtOffice(rec, dt) : false;
      if (!parked && rec.guard) driveGuard(rec, dt);
      if (camD2(p.pos.x, p.pos.z) < 70 * 70) stampTag(p);
    }

    // 4) the flex loop + gala timer + billionaire watch
    flexRead(dt);
    if (M.galaCD > 0) M.galaCD -= dt;
    checkBillionaire();
  });
})();
