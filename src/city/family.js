/* ============================================================
   city/family.js — HOUSES THAT MATTER: pools + the people in them.
   WHY (the whole loop in one file): homes show wealth (a pool in the
   yard, a pool on the penthouse roof), wealth houses FAMILY (wives,
   kids, girlfriends — and a mistress at a second address nobody is
   supposed to know about), and family is LEVERAGE. A boss's people
   can be robbed, taken at gunpoint (the existing hostage flow works
   on them) or killed — which the set takes PERSONALLY (they carry
   the gang colors, so the vendetta/witness system in gangs.js fires).
   And once YOU own a real home, you get people too — and crews you've
   bled will snatch them and ring you with a number. Pay, or come get
   them. That's why the houses exist.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;
  const g = CBZ.game;

  let rs = 31337;
  function rng() { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; }

  // ---- POOLS ----------------------------------------------------------------
  // backyard pools on the nicer homes, a roof pool on the high-tier towers.
  // Shared materials, a handful of boxes per pool — set dressing that reads
  // as money from the street and from the air.
  let poolsBuilt = null; // arena ref the pools were built for
  const waterMat = new THREE.MeshLambertMaterial({ color: 0x3fb6e0, emissive: 0x1a5d7a, emissiveIntensity: 0.35 });
  waterMat._shared = true;
  const deckMat = new THREE.MeshLambertMaterial({ color: 0xd8d2c2 });
  deckMat._shared = true;
  const pools = []; // {x, z, y, w, d} — family stroll magnets

  function buildPool(root, x, z, y, w, d) {
    const water = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, d), waterMat);
    water.position.set(x, y + 0.09, z); water.receiveShadow = false; water.castShadow = false;
    root.add(water);
    const rim = 0.5;
    const mk = function (rx, rz, rw, rd) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.3, rd), deckMat);
      m.position.set(rx, y + 0.15, rz); m.castShadow = false; m.receiveShadow = true;
      root.add(m);
    };
    mk(x, z - d / 2 - rim / 2, w + rim * 2, rim);
    mk(x, z + d / 2 + rim / 2, w + rim * 2, rim);
    mk(x - w / 2 - rim / 2, z, rim, d);
    mk(x + w / 2 + rim / 2, z, rim, d);
    pools.push({ x, z, y, w, d });
  }

  function buildPools() {
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.homeLots || poolsBuilt === A) return;
    poolsBuilt = A;
    pools.length = 0;
    for (const lot of A.homeLots) {
      const home = lot.building && lot.building.home;
      if (!home) continue;
      // backyard pool: tier 2+ ground homes get one in the yard corner
      if ((home.tier || 0) >= 2 && (home.tier || 0) <= 4) {
        buildPool(A.root, lot.cx + lot.w * 0.3, lot.cz + lot.d * 0.3, 0.02, 4.2, 2.8);
      }
      // NO roof pool. A water slab on a tower roof collided with the penthouse
      // HELIPAD (the missile-chopper / F-22 deck) and read as a box floating in
      // the sky — removed. Backyard pools (above) are the wealth tell now.
      // (Roof pools were never family-drift magnets anyway — the drift code
      // gates on pool.y < 1, so this removal changes only the visual.)
    }
  }

  // ---- FAMILIES ---------------------------------------------------------------
  const WIVES = ["Maria", "Tasha", "Elena", "Kim", "Rosa", "Dee"];
  const KIDS = ["Lil Marco", "Nia", "Tito", "Zoe", "Junior", "Keke"];
  const SIDE = ["Candy", "Desirée", "Lola", "Bambi"];
  const families = []; // {gangId|0(player), members:[ped], homeX, homeZ}
  let spawned = null;  // arena the families were cast for
  let kidnap = null;   // {ped, gangId, captors:[], ransom, t, x, z}
  let kidnapCD = 90;   // first window opens a minute and a half in

  function famPed(x, z, name, role, gangId, kid) {
    if (!CBZ.cityMakePed) return null;
    const p = CBZ.cityMakePed(x, z, Math.random, {
      name, aggr: 0, armed: false, archetype: "resident",
      job: role, behavior: "timid", cash: 20 + ((rng() * 60) | 0),
    });
    if (!p) return null;
    if (gangId) p.gang = gangId;        // wears the colors in the books — kill her
    p.family = role;                    // and the SET takes it personally (gangs.js)
    if (kid && p.char && p.char.group) { p.char.group.scale.setScalar(0.62); p.hp = 40; p.maxHp = 40; }
    return p;
  }

  function castFamilies() {
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.homeLots || !CBZ.cityPeds || !CBZ.cityPeds.length) return;
    if (spawned === A && families.some((f) => f.members.some((m) => !m.dead))) return;
    spawned = A;
    families.length = 0;
    const gangs = (CBZ.cityGangs || []).filter((x) => x && !x.isPlayer);
    const lots = A.homeLots.filter((l) => l.building && l.building.home && (l.building.home.tier || 0) >= 2)
      .sort((a, b) => (b.building.home.tier || 0) - (a.building.home.tier || 0));
    let gi = 0;
    for (const lot of lots.slice(0, 4)) {
      const home = lot.building.home;
      const mine = !!home.owned;        // the player's address: HIS people live here
      const gang = mine ? null : gangs[gi++ % Math.max(1, gangs.length)];
      const fam = { gangId: gang ? gang.id : 0, homeX: lot.cx + lot.w * 0.22, homeZ: lot.cz - lot.d * 0.22, members: [] };
      const wife = famPed(fam.homeX, fam.homeZ, WIVES[(rng() * WIVES.length) | 0], mine ? "your wife" : "his wife", fam.gangId, false);
      if (wife) fam.members.push(wife);
      const nKids = 1 + ((rng() * 2) | 0);
      for (let k = 0; k < nKids; k++) {
        const kid = famPed(fam.homeX + 1.5 + k, fam.homeZ + 1.2, KIDS[(rng() * KIDS.length) | 0], "the kid", fam.gangId, true);
        if (kid) fam.members.push(kid);
      }
      if (fam.members.length) families.push(fam);
      // the FIRST boss also keeps a mistress at a second address — the secret
      // the street can sell: she wears no colors, but he pays to keep her safe.
      if (gang && gi === 1 && lots.length > 4) {
        const second = lots[4];
        const her = famPed(second.cx, second.cz, SIDE[(rng() * SIDE.length) | 0], "a friend of " + (gang.boss && gang.boss.name ? gang.boss.name : "the boss"), fam.gangId, false);
        if (her) families.push({ gangId: fam.gangId, homeX: second.cx, homeZ: second.cz, members: [her] });
      }
    }
    if (families.length && CBZ.cityFeed) CBZ.cityFeed("🏠 The big houses are lived in now. Families, pools — leverage.", "#9fd0ff");
  }

  // ---- HOME LIFE: stay near the house, drift to the pool, mourn the dead ----
  let tick = 0;
  CBZ.onUpdate(36.2, function (dt) {
    if (g.mode !== "city") return;
    buildPools();
    castFamilies();
    tick += dt;
    if (tick < 1.2) return;
    tick = 0;
    const P = CBZ.player;
    for (const fam of families) {
      for (const m of fam.members) {
        if (!m || m.dead) continue;
        if (m._kidnapped) continue;
        if (m.state === "flee" || m.alarmed > 0) continue;   // panic owns the legs
        const dx = m.pos.x - fam.homeX, dz = m.pos.z - fam.homeZ;
        if (dx * dx + dz * dz > 16 * 16) {
          if (m.target && m.target.set) m.target.set(fam.homeX, 0, fam.homeZ);
        } else if (rng() < 0.3 && m.target && m.target.set) {
          // drift around the yard; if there's a pool on this lot, hang at its edge
          let px = fam.homeX + (rng() - 0.5) * 8, pz = fam.homeZ + (rng() - 0.5) * 8;
          for (const pool of pools) {
            if (Math.abs(pool.x - fam.homeX) < 14 && Math.abs(pool.z - fam.homeZ) < 14 && pool.y < 1 && rng() < 0.5) {
              px = pool.x + (rng() - 0.5) * (pool.w + 2); pz = pool.z + pool.d / 2 + 0.8;
              break;
            }
          }
          m.target.set(px, 0, pz);
        }
      }
      // a death in the family: the player's people get a feed eulogy + revenge
      // note; a BOSS family death already fires the gang machinery via .gang.
      for (const m of fam.members) {
        if (m && m.dead && !m._mourned) {
          m._mourned = true;
          if (!fam.gangId) {
            if (CBZ.cityFeed) CBZ.cityFeed("🕯 They got " + (m.name || "your people") + " at the house. This can't stand.", "#ff7a7a");
            if (CBZ.city && CBZ.city.note) CBZ.city.note("They hit your HOME. " + (m.name || "Family") + " is gone.", 4);
          } else if (CBZ.cityFeed) {
            CBZ.cityFeed("🕯 " + (m.name || "Someone") + " — somebody's whole world — is gone. The set won't forget.", "#ffce7a");
          }
        }
      }
    }

    // ---- KIDNAP DIRECTOR: a crew you've bled snatches one of YOURS ----------
    if (!kidnap) {
      kidnapCD -= 1.2;
      if (kidnapCD <= 0) {
        kidnapCD = 120 + rng() * 120;
        const mine = families.find((f) => !f.gangId && f.members.some((m) => !m.dead));
        const angry = (CBZ.cityGangs || []).find((x) => x && !x.isPlayer && !x.playerFriendly && (x.hostility || 0) >= 2 && x.hq);
        if (mine && angry && P && !P.dead) {
          const ped = mine.members.find((m) => !m.dead && !m._kidnapped);
          if (ped) startKidnap(ped, angry);
        }
      }
    } else {
      tickKidnap();
    }
  });

  function startKidnap(ped, gang) {
    const hx = gang.hq.x + 4, hz = gang.hq.z + 4;
    ped._kidnapped = gang.id;
    ped.pos.set(hx, 0, hz);
    if (ped.char) { ped.char.handsUp = true; }
    ped.state = "idle"; ped.speed = 0;
    if (ped.target && ped.target.set) ped.target.set(hx, 0, hz);
    const captors = [];
    for (let i = 0; i < 3; i++) {
      const c = CBZ.cityMakePed && CBZ.cityMakePed(hx + Math.cos(i * 2.1) * 2.2, hz + Math.sin(i * 2.1) * 2.2, Math.random, {
        armed: true, aggr: 0.95, gang: gang.id, job: "holding your people",
      });
      if (c) captors.push(c);
    }
    const ransom = Math.max(2000, Math.round((g.cash || 0) * 0.12 / 100) * 100);
    kidnap = { ped, gangId: gang.id, captors, ransom, t: 180, x: hx, z: hz };
    if (CBZ.cityFeed) CBZ.cityFeed("📞 The " + gang.name + " took " + (ped.name || "your girl") + ". They want $" + ransom.toLocaleString() + ".", "#ff7a7a");
    if (CBZ.city && CBZ.city.note) CBZ.city.note("📞 They have " + (ped.name || "your family") + ". $" + ransom.toLocaleString() + " — or come take them back.", 5);
    if (CBZ.fullMap && CBZ.fullMap.setWaypoint) CBZ.fullMap.setWaypoint(hx, hz, "THEY HAVE " + (ped.name || "FAMILY").toUpperCase());
  }

  function endKidnap(freed, line, color) {
    const k = kidnap; kidnap = null;
    if (!k) return;
    k.ped._kidnapped = null;
    if (k.ped.char) k.ped.char.handsUp = false;
    if (freed && !k.ped.dead) {
      const fam = families.find((f) => f.members.indexOf(k.ped) >= 0);
      if (fam && k.ped.target && k.ped.target.set) k.ped.target.set(fam.homeX, 0, fam.homeZ);
      k.ped.state = "walk"; k.ped.speed = k.ped.baseSpeed || 2;
    }
    if (CBZ.fullMap && CBZ.fullMap.clearWaypoint) CBZ.fullMap.clearWaypoint("city");
    if (line && CBZ.cityFeed) CBZ.cityFeed(line, color || "#9aa6bd");
  }

  function tickKidnap() {
    const k = kidnap, P = CBZ.player;
    if (!k) return;
    if (k.ped.dead) { endKidnap(false, "🕯 They didn't wait. " + (k.ped.name || "Family") + " is gone.", "#ff7a7a"); return; }
    k.t -= 1.2;
    let live = 0;
    for (const c of k.captors) if (c && !c.dead && !(c.ko > 0)) live++;
    if (!live) {
      if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(5);
      endKidnap(true, "🏠 You took " + (k.ped.name || "them") + " back the hard way. The street saw it.", "#7fe0a0");
      return;
    }
    // standing close with the money: pay the number
    if (P && !P.dead) {
      const d = Math.hypot(P.pos.x - k.x, P.pos.z - k.z);
      if (d < 5) {
        if ((g.cash || 0) >= k.ransom) {
          if (CBZ.city && CBZ.city.note) CBZ.city.note("[E] Pay $" + k.ransom.toLocaleString() + " — or kill the three holding " + (k.ped.name || "them"), 1.4);
          if (CBZ.keys && (CBZ.keys["e"] || CBZ.keys["E"])) {
            g.cash -= k.ransom;
            if (CBZ.cityHudDirty) CBZ.cityHudDirty();
            for (const c of k.captors) if (c && !c.dead) { c.rage = null; c.state = "walk"; }
            endKidnap(true, "💸 You paid. " + (k.ped.name || "They") + " walks home. The number is a memory now.", "#ffce7a");
            return;
          }
        } else if (CBZ.city && CBZ.city.note) {
          CBZ.city.note("You're short of $" + k.ransom.toLocaleString() + " — guns will have to do it", 1.4);
        }
      }
    }
    if (k.t <= 0) {
      if (CBZ.cityKillPed) CBZ.cityKillPed(k.ped, { fromX: k.x + 1, fromZ: k.z, force: 4, fling: 1 }, "executed");
      endKidnap(false, "🕯 The clock ran out. They put " + (k.ped.name || "your family") + " down.", "#ff7a7a");
    }
  }

  // a fresh run re-casts everything (peds were wiped by spawnCityPeds anyway)
  CBZ.cityFamilyReset = function () {
    families.length = 0;
    spawned = null;
    if (kidnap) { kidnap = null; }
    kidnapCD = 90;
    // pools are arena-bound meshes: they persist with the arena (buildPools
    // re-runs only when a NEW arena is built, so no duplicates on reset)
  };
  CBZ.cityFamilies = families;   // read-only peek for tests/debug
})();
