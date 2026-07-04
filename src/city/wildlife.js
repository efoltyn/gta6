/* ============================================================
   city/wildlife.js — THE WILDLIFE + HUNTING ENGINE (RDR2-style).

   The archipelago's biomes were scenery with a handful of decorative deer.
   This turns them into a living ECOSYSTEM you can HUNT: every biome (and the
   open ocean) is stocked with the RIGHT species for its climate — whitetail
   and black bears in the woods, lions & elephants on the savanna, polar bears
   and wolves on the ice, sharks & whales in the sea — plus a scattering of
   INCREDIBLY RARE legendary animals whose pelts are a fortune.

   THE HUNT LOOP (Red Dead Redemption 2 is the north star):
     1. TRACK  — animals wander/graze/flee in herds inside their home biome.
     2. KILL   — they're real hitscan targets (registered in CBZ.cityWildlife,
                 scanned by fpsmode's findActorHit; see the tiny hook there).
                 A clean one-shot / headshot yields a PRISTINE pelt; a messy
                 kill (many shots, body) ruins the hide's quality.
     3. SKIN   — walk up to the carcass; the interaction registry offers
                 "Skin" (hold). You get the PELT (worth $ by species & quality)
                 plus a field-dressing cash bounty. Legendary animals drop a
                 unique, luxe pelt worth a small fortune.
     4. SELL   — pelts are tag:"valuable", so the pawn shop / fence already
                 buys them. No new selling UI — the loot economy absorbs furs.

   SPECIES live in CBZ.WILDLIFE_SPECIES (see wildlife_species.js). Each carries
   its home biome, rarity, HP, pelt name + value, and a low-poly build(ctx)
   that returns a THREE.Group (feet at y=0, nose toward +X).

   DRAW-CALL DISCIPLINE (owner rule #4 — ~1000-NPC draw-call bound): live
   animals are capped (POP_CAP) and each is a small hand-built mesh group, the
   same cheap approach biome_forest used for its deer. No physics, no per-limb
   colliders — a light wander integrator moves them and they never leave home.

   Deterministic (owner rule #5): a single seeded rng places every herd, so the
   same animals stand in the same meadow every run. Ambient motion uses
   Math.random for liveliness only (never world state).

   Gated behind CBZ.WILDLIFE !== false (default ON).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const mat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };

  // ---- tuning -----------------------------------------------------------
  const POP_CAP = 56;            // max live animals across the whole world (draw-call budget)
  const HERD_MAX = 4;            // clamp a spawned herd so no one species floods the cap
  const AQUATIC_R0 = 560;        // ocean band (from field centre) inner radius
  const AQUATIC_R1 = 1500;       // ..outer radius (still inside the terrain ring)
  const FIELD_CX = 0, FIELD_CZ = -700;   // matches terrain.js CX/CZ field centre
  const SKIN_REACH = 4.2;        // how close you must be to skin a carcass
  const RESPAWN_EVERY = 42;      // s between top-up passes
  const CARCASS_LINGER = 150;    // s a skinned/ignored carcass stays before fading

  // ---- deterministic rng (mulberry32) -----------------------------------
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rng = makeRng(0x5EED10);

  // live actor list — the hitscan hook in fpsmode.js scans this every shot.
  const animals = CBZ.cityWildlife = [];
  const carcasses = [];          // skinnable / fading remains
  let root = null, built = false;
  // The arena we were handed at build time. CRITICAL: during buildCity(),
  // `CBZ.city.arena` is NOT yet assigned (the assignment awaits buildCity's
  // return), so every region lookup MUST go through this stored reference, not
  // the global — otherwise land regions read as empty and only ocean spawns.
  let arena = null;
  function ARENA() { return arena || (CBZ.city && CBZ.city.arena); }

  // ============================================================
  //  PELT ECONOMY — register every species' hide into cityEcon.ITEMS so the
  //  pawn shop / fence already buys it. A PRISTINE variant (clean kill) is
  //  worth ~2.1x; legendary pelts are flagged luxe (thinner fence haircut).
  // ============================================================
  function registerPelts() {
    const econ = CBZ.cityEcon; if (!econ || !econ.ITEMS) return;
    const S = CBZ.WILDLIFE_SPECIES || {};
    for (const id in S) {
      const sp = S[id];
      if (!sp.fur) continue;
      if (!econ.ITEMS[sp.fur]) {
        econ.ITEMS[sp.fur] = {
          value: sp.furValue || 20, tag: "valuable",
          luxe: sp.rarity === "legendary" || undefined,
          pelt: true, species: id,
        };
      }
      const pri = "Pristine " + sp.fur;
      if (sp.rarity !== "legendary" && !econ.ITEMS[pri]) {
        econ.ITEMS[pri] = {
          value: Math.round((sp.furValue || 20) * 2.1), tag: "valuable",
          pelt: true, pristine: true, species: id,
        };
      }
      // wild meat — a light valuable that also FEEDS your dog (see dogs.js).
      if (sp.meat && !econ.ITEMS[sp.meat]) {
        econ.ITEMS[sp.meat] = { value: sp.meatValue || 8, tag: "valuable", meat: true, species: id };
      }
    }
  }

  // ============================================================
  //  SPAWNING — stock each biome region with the species that call it home,
  //  plus an ocean band of aquatic life. Legendary animals roll a single,
  //  rare spawn so an encounter feels like a real event.
  // ============================================================
  function biomeRegions(biome) {
    const A = ARENA();
    const regs = (A && A.regions) || [];
    const out = [];
    for (let i = 0; i < regs.length; i++) if (regs[i].biome === biome) out.push(regs[i]);
    return out;
  }

  function regionPoint(reg, r) {
    // a random point comfortably inside a region (rect or circle)
    if (reg.kind === "circle") {
      const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * Math.max(4, reg.r - 14);
      return { x: reg.cx + Math.cos(a) * rad, z: reg.cz + Math.sin(a) * rad };
    }
    const pad = 16;
    return {
      x: reg.minX + pad + r() * Math.max(1, (reg.maxX - reg.minX) - pad * 2),
      z: reg.minZ + pad + r() * Math.max(1, (reg.maxZ - reg.minZ) - pad * 2),
    };
  }

  function oceanPoint(r) {
    // a point in the open-sea band, clear of every land region.
    for (let tries = 0; tries < 24; tries++) {
      const a = r() * Math.PI * 2;
      const rad = AQUATIC_R0 + r() * (AQUATIC_R1 - AQUATIC_R0);
      const x = FIELD_CX + Math.cos(a) * rad, z = FIELD_CZ + Math.sin(a) * rad;
      if (!CBZ.cityAnyRegion || !CBZ.cityAnyRegion(ARENA(), x, z, 30)) return { x, z };
    }
    return { x: FIELD_CX + 900, z: FIELD_CZ };
  }

  function makeActor(sp, x, z) {
    let grp;
    try { grp = sp.build({ THREE: THREE, mat: mat, rng: rng }); }
    catch (e) { grp = fallbackMesh(sp); }
    if (!grp) grp = fallbackMesh(sp);
    const s = sp.scale || 1;
    grp.scale.setScalar(s);
    grp.position.set(x, sp.aquatic ? 0 : groundY(x, z), z);
    grp.rotation.y = rng() * 6.283;
    // castShadow for the read; leave frustumCulled at its DEFAULT (true) so the
    // dozens of animals scattered across the map only draw when actually on
    // screen — never force ~1000 wildlife meshes to render every frame.
    grp.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    root.add(grp);
    const a = {
      species: sp, kind: "animal", animal: true,
      group: grp, pos: grp.position,      // fpsmode/interactions read .group.position and .pos
      hp: sp.hp || 40, maxHp: sp.hp || 40, dead: false, ko: 0, escaped: false,
      heading: rng() * 6.283, turnT: rng() * 3, spd: sp.spd || 1.4,
      state: "wander", alarm: 0, home: { x: x, z: z },
      bob: rng() * 6.283, hitCount: 0, cleanKill: false,
    };
    animals.push(a);
    return a;
  }

  function fallbackMesh(sp) {
    // never let a broken build() crash the world — a plain quadruped box.
    const gp = new THREE.Group();
    const c = sp.color || 0x8a6a44;
    const body = new THREE.Mesh(CBZ.boxGeom(1.5, 0.8, 0.7), mat(c)); body.position.y = 0.9; gp.add(body);
    const head = new THREE.Mesh(CBZ.boxGeom(0.5, 0.5, 0.45), mat(c)); head.position.set(1.0, 1.1, 0); gp.add(head);
    [[-0.55, 0.22], [0.55, 0.22], [-0.55, -0.22], [0.55, -0.22]].forEach(function (o) {
      const leg = new THREE.Mesh(CBZ.boxGeom(0.16, 0.9, 0.16), mat(c));
      leg.position.set(o[0], 0.45, o[1]); gp.add(leg);
    });
    return gp;
  }

  function groundY(x, z) { return (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) || 0; }

  function seedHerd(sp) {
    // place ONE herd of a species in its home biome (or the sea band).
    const regs = sp.aquatic ? null : biomeRegions(sp.biome);
    if (!sp.aquatic && (!regs || !regs.length)) return 0;
    const anchor = sp.aquatic ? oceanPoint(rng) : regionPoint(regs[(rng() * regs.length) | 0], rng);
    let herd = sp.herd ? (sp.herd[0] + ((rng() * (sp.herd[1] - sp.herd[0] + 1)) | 0)) : 1;
    herd = Math.min(herd, HERD_MAX, POP_CAP - animals.length);
    let n = 0;
    for (let h = 0; h < herd; h++) {
      const jx = anchor.x + (rng() - 0.5) * (sp.aquatic ? 60 : 22);
      const jz = anchor.z + (rng() - 0.5) * (sp.aquatic ? 60 : 22);
      makeActor(sp, jx, jz); n++;
    }
    return n;
  }

  function spawnAll() {
    const S = CBZ.WILDLIFE_SPECIES || {};
    // Build an INTERLEAVED work list so the cap is shared FAIRLY across biomes
    // (filling forest-first would starve farmland/water). Bucket species by
    // biome, then round-robin one biome at a time; each species contributes
    // `packs` herds spread across the rounds.
    const buckets = {};
    for (const id in S) {
      const sp = S[id]; if (sp.rarity === "legendary") continue;
      (buckets[sp.biome] || (buckets[sp.biome] = [])).push(sp);
    }
    const biomes = Object.keys(buckets);
    // remaining herd allowance per species
    const left = {};
    for (const b of biomes) for (const sp of buckets[b]) left[sp.id] = Math.max(1, sp.packs || (sp.aquatic ? 2 : 2));
    let progress = true;
    while (animals.length < POP_CAP && progress) {
      progress = false;
      for (let bi = 0; bi < biomes.length && animals.length < POP_CAP; bi++) {
        const list = buckets[biomes[bi]];
        // one species from this biome per round (rotate through the bucket)
        const rot = (buckets[biomes[bi]]._rot || 0);
        for (let k = 0; k < list.length && animals.length < POP_CAP; k++) {
          const sp = list[(rot + k) % list.length];
          if (left[sp.id] > 0) { const added = seedHerd(sp); if (added > 0) { left[sp.id]--; progress = true; } buckets[biomes[bi]]._rot = (rot + k + 1) % list.length; break; }
        }
      }
    }
    // LEGENDARY — the incredibly rare ones. Each gets ONE guaranteed spawn deep
    // in its home range (exempt from POP_CAP — there are only a handful and they
    // ARE the marquee "incredibly rare animal" encounters).
    for (const id in S) {
      const sp = S[id];
      if (sp.rarity !== "legendary") continue;
      let pt;
      if (sp.aquatic) pt = oceanPoint(rng);
      else { const regs = biomeRegions(sp.biome); if (!regs.length) continue; pt = regionPoint(regs[(rng() * regs.length) | 0], rng); }
      const a = makeActor(sp, pt.x, pt.z);
      a.legendary = true;
    }
  }

  function topUp() {
    // gently refill toward the cap so hunted-out meadows recover over time.
    if (animals.length >= POP_CAP - 6) return;
    const S = CBZ.WILDLIFE_SPECIES || {};
    const ids = [];
    for (const id in S) if (S[id].rarity !== "legendary" && (S[id].respawn !== false)) ids.push(id);
    if (!ids.length) return;
    let added = 0;
    for (let i = 0; i < ids.length && animals.length < POP_CAP && added < 8; i++) {
      const sp = S[ids[(rng() * ids.length) | 0]];
      let pt;
      if (sp.aquatic) pt = oceanPoint(rng);
      else { const regs = biomeRegions(sp.biome); if (!regs.length) continue; pt = regionPoint(regs[(rng() * regs.length) | 0], rng); }
      // never pop in right on top of the player.
      const P = CBZ.player && CBZ.player.pos;
      if (P && Math.hypot(pt.x - P.x, pt.z - P.z) < 60) continue;
      makeActor(sp, pt.x, pt.z); added++;
    }
  }

  // ============================================================
  //  THE KILL — routed here from fpsmode.cityGunHit for any a.animal target.
  //  Tracks kill quality (a clean one-shot / headshot => pristine pelt) and
  //  turns the animal into a skinnable carcass on death.
  // ============================================================
  CBZ.cityWildlifeHit = function (a, hit, w) {
    if (!a || a.dead) return { head: false, down: false, dmg: 0 };
    const dmg = Math.max(1, Math.round((w && w.damage || 20) * (hit && hit.head ? (w && w.headMult || 2) : 1)));
    a.hitCount++;
    a.hp -= dmg;
    // blood spritz where reachable (reuse the shared gore if present).
    if (hit && hit.point && CBZ.gore && CBZ.gore.spray) {
      try { CBZ.gore.spray(hit.point, 1); } catch (e) {}
    }
    if (a.hp <= 0) {
      // a PRISTINE pelt needs a clean kill: down in one or two hits, ideally a
      // headshot. Sloppy magazine-dumps ruin the hide (RDR2 rewards precision).
      a.cleanKill = (a.hitCount <= 1) || (a.hitCount <= 2 && !!(hit && hit.head));
      killAnimal(a, hit);
      return { head: !!(hit && hit.head), down: true, dmg: dmg };
    }
    // WOUNDED — predators charge, prey bolts.
    a.alarm = 8;
    const P = CBZ.player && CBZ.player.pos;
    if (a.species.danger > 0.15 && P) { a.state = "charge"; }
    else { a.state = "flee"; if (P) { a.heading = Math.atan2(a.pos.z - P.z, a.pos.x - P.x); } a.spd = (a.species.spd || 1.4) * 2.2; }
    return { head: !!(hit && hit.head), down: false, dmg: dmg };
  };

  function killAnimal(a, hit) {
    a.dead = true; a.ko = 0; a.state = "dead"; a.hp = 0;
    a.skinnable = true; a.skinT = CARCASS_LINGER;
    // topple onto its side (feet were at y=0; drop + roll the group).
    const grp = a.group;
    grp.rotation.z = (Math.random() < 0.5 ? 1 : -1) * (1.15 + Math.random() * 0.25);
    grp.position.y = Math.max(0, grp.position.y) + 0.05;
    carcasses.push(a);
    // score/notify — a kill is a kill.
    if (CBZ.city) {
      if (a.legendary) { if (CBZ.city.note) CBZ.city.note("★ LEGENDARY " + a.species.name + " DOWN — skin it before it's gone!", 4, { urgent: true }); }
      else if (CBZ.city.note) CBZ.city.note(a.species.name + " down · walk up & hold to skin", 2.4);
    }
    if (CBZ.cityKillFeed) { try { CBZ.cityKillFeed("You", a.species.name, "hunted"); } catch (e) {} }
    // let a following dog notice the kill too (dogs.js reads this list).
  }

  // ============================================================
  //  SKINNING — the payoff. Grants the pelt (quality-scaled) + a field bounty.
  // ============================================================
  function skin(a) {
    if (!a || !a.skinnable) return;
    a.skinnable = false;
    const sp = a.species, econ = CBZ.cityEcon;
    let peltName = sp.fur, pristine = false;
    if (sp.rarity !== "legendary" && a.cleanKill && Math.random() < 0.85) { peltName = "Pristine " + sp.fur; pristine = true; }
    if (econ && econ.add) {
      econ.add(peltName, 1);
      if (sp.meat) econ.add(sp.meat, 1 + ((Math.random() * (sp.meatYield || 1)) | 0));
    }
    // a small on-the-spot field bounty on top of the sellable pelt.
    const bounty = Math.round((sp.furValue || 20) * (pristine ? 0.35 : 0.2) * (sp.rarity === "legendary" ? 3 : 1));
    if (CBZ.city && CBZ.city.addCash && bounty > 0) CBZ.city.addCash(bounty);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(sp.rarity === "legendary" ? 8 : 1);
    // toast the haul.
    const worth = (econ && econ.ITEMS[peltName] && econ.ITEMS[peltName].value) || sp.furValue || 20;
    if (CBZ.city && CBZ.city.note) {
      CBZ.city.note("Skinned " + sp.name + " → " + peltName + " (~$" + worth + ")" + (bounty ? " +$" + bounty : ""),
        3.2, sp.rarity === "legendary" ? { urgent: true } : undefined);
    }
    // leave a "skinned" husk that fades shortly.
    a.skinT = Math.min(a.skinT, 14);
    a.skinned = true;
  }

  function removeCarcass(a) {
    const gi = animals.indexOf(a); if (gi >= 0) animals.splice(gi, 1);
    const ci = carcasses.indexOf(a); if (ci >= 0) carcasses.splice(ci, 1);
    if (a.group && a.group.parent) a.group.parent.remove(a.group);
  }

  // ============================================================
  //  INTERACTION — "Skin" on a nearby carcass (the registry, no new keys).
  // ============================================================
  function registerInteractions() {
    const I = CBZ.interactions; if (!I) return;
    I.registerSource({
      id: "src-carcass", kind: "carcass", layers: ["carcass"], prio: 7, driving: false,
      find: function (px, pz, ctx, push) {
        let best = null, bd = SKIN_REACH * SKIN_REACH;
        for (let i = 0; i < carcasses.length; i++) {
          const a = carcasses[i]; if (!a.skinnable) continue;
          const dx = a.pos.x - px, dz = a.pos.z - pz, d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = a; }
        }
        if (best) push(best, Math.sqrt(bd));
      },
    });
    I.describe && I.describe("carcass", function (a) {
      return { label: "🦌 " + (a.species ? a.species.name : "Carcass"), note: a.legendary ? "LEGENDARY pelt" : "field-dress the hide" };
    });
    I.register("carcass", {
      id: "carcass-skin", slot: "e", hold: true, prio: 20,
      label: function (a) { return "Skin the " + (a.species ? a.species.name : "animal"); },
      canShow: function (a) { return !!(a && a.skinnable); },
      onSelect: function (a) { skin(a); },
    });
  }

  // ============================================================
  //  THE UPDATE — wander / graze / flee / charge, aquatic bob, carcass fade.
  // ============================================================
  function tick(dt) {
    if (!dt || dt > 0.5) dt = 0.05;
    const P = CBZ.player && CBZ.player.pos;
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i], sp = a.species, grp = a.group;
      if (a.dead) {
        a.skinT -= dt;
        if (a.skinT <= 0) { removeCarcass(a); i--; continue; }
        // gently sink a skinned husk before it's culled.
        if (a.skinned && a.skinT < 6) grp.position.y -= dt * 0.05;
        continue;
      }
      // ---- aquatic: cruise the sea band, dorsal bob, loop back inward -----
      if (sp.aquatic) {
        a.bob += dt * (1.2 + a.spd * 0.2);
        a.turnT -= dt;
        if (a.turnT <= 0) { a.heading += (Math.random() - 0.5) * 0.8; a.turnT = 3 + Math.random() * 4; }
        const nx = grp.position.x + Math.cos(a.heading) * a.spd * dt * 6;
        const nz = grp.position.z + Math.sin(a.heading) * a.spd * dt * 6;
        const rr = Math.hypot(nx - FIELD_CX, nz - FIELD_CZ);
        if (rr < AQUATIC_R0 || rr > AQUATIC_R1) a.heading += Math.PI * 0.6;      // turn back into the band
        else { grp.position.x = nx; grp.position.z = nz; }
        grp.position.y = Math.sin(a.bob) * 0.12 * (sp.scale || 1);
        grp.rotation.y = -a.heading + Math.PI / 2;
        continue;
      }
      // ---- land: alarm decays; react to the player -----------------------
      if (a.alarm > 0) a.alarm -= dt;
      let nearP = 0;
      if (P) { const dpx = grp.position.x - P.x, dpz = grp.position.z - P.z; nearP = dpx * dpx + dpz * dpz; }
      if (P && a.state !== "charge") {
        const spookR = (sp.spook || 26);
        if (nearP < spookR * spookR && sp.danger < 0.15) { a.state = "flee"; a.alarm = Math.max(a.alarm, 4); a.heading = Math.atan2(grp.position.z - P.z, grp.position.x - P.x); }
        else if (nearP < 18 * 18 && sp.danger >= 0.5) { a.state = "charge"; a.alarm = 6; }
        else if (a.alarm <= 0 && (a.state === "flee")) a.state = "wander";
      }
      // pick speed by state
      let spd = a.spd;
      if (a.state === "flee") spd = (sp.spd || 1.4) * 2.4;
      else if (a.state === "charge") spd = (sp.spd || 1.4) * 2.0;
      // heading logic
      a.turnT -= dt;
      if (a.state === "charge" && P) {
        a.heading = Math.atan2(P.z - grp.position.z, P.x - grp.position.x);
        // a charging predator that reaches you bites (light contact damage).
        if (nearP < 3.2 * 3.2 && CBZ.cityHurtPlayer && (a._biteT || 0) <= 0) {
          try { CBZ.cityHurtPlayer((sp.bite || 10), a); } catch (e) {}
          a._biteT = 1.1;
        }
        if (a._biteT > 0) a._biteT -= dt;
        if (nearP > 55 * 55) a.state = "wander";              // gave up
      } else if (a.turnT <= 0) {
        a.heading += (Math.random() - 0.5) * 1.5;
        a.turnT = 2 + Math.random() * 4;
        if (a.state === "wander") a.spd = (sp.spd || 1.4) * (0.6 + Math.random() * 0.8);
      }
      // integrate + keep inside the home region (turn back at the fence)
      const nx = grp.position.x + Math.cos(a.heading) * spd * dt;
      const nz = grp.position.z + Math.sin(a.heading) * spd * dt;
      const reg = CBZ.cityNearestRegion && CBZ.cityNearestRegion(ARENA(), nx, nz, 40);
      const onHome = reg && (reg.biome === sp.biome) && CBZ.cityRegionHit(reg, nx, nz, 6);
      if (!onHome && a.state !== "charge") {
        // steer back toward home anchor instead of leaving the biome.
        a.heading = Math.atan2(a.home.z - grp.position.z, a.home.x - grp.position.x) + (Math.random() - 0.5) * 0.6;
      } else {
        grp.position.x = nx; grp.position.z = nz;
        grp.position.y = groundY(nx, nz);
      }
      grp.rotation.y = -a.heading + Math.PI / 2;
    }
  }

  // ============================================================
  //  BUILD — stock the world once, after every biome region exists.
  // ============================================================
  CBZ.addLandmass(function (city) {
    if (CBZ.WILDLIFE === false) return null;
    if (built) return null;
    city = city || (CBZ.city && CBZ.city.arena);
    if (!city || !city.root) return null;
    built = true;
    root = city.root;
    arena = city;                 // stash the arena for region lookups during build

    registerPelts();
    registerInteractions();
    spawnAll();

    let respAcc = 0;
    CBZ.onUpdate(47.1, function (dt) {
      tick(dt);
      respAcc += (dt || 0.016);
      if (respAcc >= RESPAWN_EVERY) { respAcc = 0; topUp(); }
    });
    return null;
  }, 95);

  // public: let other systems (dogs.js) read/kill wildlife.
  CBZ.cityWildlifeList = function () { return animals; };
  CBZ.cityWildlifeSkin = skin;
})();
