/* ============================================================
   world/island_dealers.js — THE ISLANDS' CAR DEALERS, NEW AND USED.

   Island Motors (b.use "cardealer": the glass showroom world/disaster_arena.js
   builds on Main Street, three real cars on its tiles) sells NEW cars; the
   used car lot (b.use "usedcars": world/island_lots.js's forecourt with its
   bunting and its sales cabin) sells worn ones, cheaper. The cars are the
   island's real cars (world/island_vehicles.js stands a city/vehicles.js
   record on every spot: a dealer's spot names its model), each with its
   price on a card behind the windscreen: a number.

   THE SALESMAN is one of the island's people at his post through the day
   (CBZ.islandVenue.staff). Browse a car and he walks over to it and says a
   few words. The car's own card (city/interactions.js, islands: true):
     [I] Test drive   the keys are yours and he rides with you, in the
                      passenger seat. Bring it back and get out: the keys go
                      back. Drive it too far off, or keep it too long, and it
                      is a stolen car: the theft goes to the police (cityCrime,
                      the wanted stars).
     [J] Buy $N       the decision: the money comes out of your cash (g.cash,
                      CBZ.city.spend) and the car is yours. It stays yours:
                      while you are off somewhere it is parked where you left
                      it (a new one bought off the showroom floor is moved out
                      to the forecourt once nobody is looking), and when the
                      island it is on comes back into the world, so does your
                      car, where you left it (g.isleCars).
   Getting into a car on sale without a deal (the island's own Drive pin) is
   sitting in it; driving it off the lot is stealing it.
   There is no haggling: buttons are decisions, not words.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  if (!window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game || (CBZ.game = {});

  const NEW_MODELS = ["Voltra Ion", "Bison Frontier", "Kotori Kaze", "Adler Kanzler", "Bison Stampede", "Voltra Halo", "Bison Apex", "Bison Eldorado"];
  const NEW_PAINT = [0xd8dadc, 0x16181b, 0x9e1b22, 0x1e3f73, 0xf2f2ee, 0x3c4a3f, 0xb0b4b8];
  const LINES_NEW = ["Just came in.", "Test drive?", "She's a beauty.", "Full warranty."];
  const LINES_USED = ["Runs like new.", "One owner.", "Good price on that one.", "Take her for a spin?"];
  const STEAL_R = 420;          // m off the lot a test drive becomes a theft
  const TEST_T = 300;           // s a test drive may last
  const BROWSE_R = 4.0, LEAVE_R = 9.0;

  function live() { return !!(g && g.mode === "archipelago"); }
  function fmt(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function h01(x, z, s) { return CBZ.hash01 ? CBZ.hash01(x, z, s) : (Math.abs(Math.sin(x * 12.9898 + z * 78.233 + s)) * 43758.5453) % 1; }
  function econCar(name) { const E = CBZ.cityEcon; return E && E.carByName ? E.carByName(name) : null; }
  function playerOnFoot() { const P = CBZ.player; return !!(P && P.pos && !P.dead && !P.driving); }
  function unseen(x, y, z) { return !CBZ.leave || !CBZ.leave.unseen || CBZ.leave.unseen({ x: x, y: y, z: z }); }
  function sayAt(post, line) {
    const p = post && post.body ? post.body() : null;
    if (p && CBZ.speech && CBZ.speech.say) CBZ.speech.say(p, line, { secs: 2.4, force: true });
  }

  /* ---- THE VENUES (one per dealer building on the islands standing) ----- */
  const lots = [];              // { b, use, post, spots[], browse, nextLine }
  function priceOf(spot) {
    const s = spot.sale;
    if (s.price) return s.price;
    const m = econCar(spot.model) || {};
    const v = m.value || 4000;
    s.price = s.used ? Math.max(400, Math.round(v * (s.wear || 0.65) / 50) * 50) : Math.round(v * 1.12 / 100) * 100;
    return s.price;
  }
  function fitDealer(b, lot, job) {
    const isNew = b.use === "cardealer";
    const L = { b: b, use: b.use, isNew: isNew, post: null, spots: [], browse: null, lineT: 0, said: new Set() };
    if (isNew) {
      // the showroom's floor spots (the arena's carSpots standing on its tiles)
      const A = job && job.arena;
      const hw = (b.lw || b.w) / 2, hd = (b.ld || b.d) / 2;
      for (const s of (A && A.carSpots) || []) {
        if (!s.floor || Math.abs(s.x - b.ox) > hw || Math.abs(s.z - b.oz) > hd) continue;
        s.model = NEW_MODELS[(h01(s.x, s.z, 0x6a1) * NEW_MODELS.length) | 0];
        s.color = NEW_PAINT[(h01(s.z, s.x, 0x6a2) * NEW_PAINT.length) | 0];
        s.sale = { use: "cardealer", used: false };
        L.spots.push(s);
      }
    } else if (b.carlot) {
      for (const s of b.carlot.spots) L.spots.push(s);
    }
    // the salesman: in the showroom by the desk at the back; on the lot at
    // his cabin door, looking at the cars
    const IV = CBZ.islandVenue;
    if (IV && IV.staff) {
      const hw = (b.lw || 18) / 2, hd = (b.ld || 13) / 2;
      // (the showroom: on the floor left of the bay, clear of the display
      // cars, the desk and the sofa, looking across at the cars)
      const at = isNew ? { x: -hw + 4.4, z: -hd + 3.4, face: Math.PI / 2 } : null;
      let lx = 0, lz = 0, face = Math.PI;
      if (at) { lx = at.x; lz = at.z; face = at.face; }
      else if (b.carlot) { const c = b.carlot.cabin.local; lx = (c.x0 + c.x1) / 2 - 0.6; lz = c.z0 - 1.0; face = Math.PI; }
      L.post = IV.staff(b, lx, lz, face, {
        job: "car salesman", hours: [8, 19], near: 160,
        dress: isNew ? { archetype: "office", job: "salesman" } : { archetype: "worker", job: "salesman" },
      });
    }
    lots.push(L);
    return function () {
      const i = lots.indexOf(L);
      if (i >= 0) lots.splice(i, 1);
      for (const s of L.spots) { const c = carOf(s); if (c) unCard(c); }
      if (TD && TD.L === L) endTest(false);
    };
  }
  if (CBZ.islandVenue && CBZ.islandVenue.on) {
    CBZ.islandVenue.on("cardealer", fitDealer);
    CBZ.islandVenue.on("usedcars", fitDealer);
  }

  /* ---- THE CARS ON SALE -------------------------------------------------- */
  // the live vehicle on a spot (world/island_vehicles.js dressRecord)
  const spotCar = new Map();
  function carOf(spot) {
    const c = spotCar.get(spot);
    if (c && !c._scrapped && !c._reap && (CBZ.cityCars || []).indexOf(c) >= 0) return c;
    spotCar.delete(spot);
    return null;
  }
  function relink() {
    const L = CBZ.cityCars || [];
    for (let i = 0; i < L.length; i++) {
      const c = L[i], s = c && c._islandSpot;
      if (s && s.sale && spotCar.get(s) !== c) spotCar.set(s, c);
    }
  }
  function forSale(c) { return !!(c && c._forSale && !c._playerOwned && !c.dead && !c._husk); }
  function card(c, spot) {
    if (c._priceCard || !c.group || !CBZ.islandFit) return;
    const tex = CBZ.islandFit.text([fmt(priceOf(spot))], { bg: "#fffef4", fg: "#b3121b", w: 160, h: 72 });
    if (!tex) return;
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.17), mat);
    const d = c.dims || {};
    const L = +d.length || 4.4, H = +d.height || 1.45;
    // behind the windscreen, on the dash, toward the kerb side, reading out
    m.position.set(-0.28, H * 0.66, L * 0.13);
    m.rotation.x = -0.55;
    m.name = "dealer-price-card";
    c.group.add(m);
    c._priceCard = m;
  }
  function unCard(c) {
    const m = c && c._priceCard;
    if (!m) return;
    c._priceCard = null;
    if (m.parent) m.parent.remove(m);
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
  }
  function tag(c, spot) {
    if (c._playerOwned) { unCard(c); return; }
    if (TD && TD.car === c) return;
    // on sale where it stands on its spot, and only there
    if (c.player || Math.hypot(c.pos.x - spot.x, c.pos.z - spot.z) > 3) return;
    // (the price is the car's own model's: a fleet stood before the dealer
    // named its models keeps what it stood)
    if (c.model && c.model.name && spot.model !== c.model.name && !spot.sale.price) spot.model = c.model.name;
    if (!c._forSale) { c._forSale = spot.sale; c.owned = false; c.stolen = false; }
    card(c, spot);
  }
  // a car on sale left off its spot (sat in, shoved) goes back when nobody sees
  function homeIfMoved(c, spot) {
    if (c.player || (TD && TD.car === c) || c._playerOwned) return;
    const dx = c.pos.x - spot.x, dz = c.pos.z - spot.z;
    if (dx * dx + dz * dz < 4) return;
    if (c.v && Math.abs(c.v) > 0.3) return;
    const P = CBZ.player;
    if (P && P.pos && Math.hypot(P.pos.x - c.pos.x, P.pos.z - c.pos.z) < 40) return;
    if (!unseen(c.pos.x, c.pos.y, c.pos.z) || !unseen(spot.x, spot.y, spot.z)) return;
    place(c, spot.x, spot.y, spot.z, spot.heading, !!spot.floor);
  }
  function place(c, x, y, z, heading, floor) {
    c.heading = heading; c.v = 0; c.vx = 0; c.vz = 0;
    if (c.group) { c.group.position.set(x, y, z); c.group.rotation.set(0, heading, 0); }
    c.x = x; c.z = z; c.oy = y; c.rotY = heading;
    if (floor) { c._parkX = x; c._parkZ = z; c._parkH = heading; c._terrY = y; c._terrPitch = c._terrRoll = 0; }
    else { c._parkX = c._parkZ = c._parkH = null; c._terrY = c._terrPitch = c._terrRoll = null; }
  }

  /* ---- THE TEST DRIVE ---------------------------------------------------- */
  let TD = null;               // { L, car, spot, t, rider, stolen, out }
  function salesmanReady(L) {
    const p = L && L.post && L.post.body ? L.post.body() : null;
    return !!(p && !p.dead && !(p.ko > 0) && L.post.on() && !L.post.hold);
  }
  function startTest(c) {
    const L = lotOfCar(c);
    if (!L || TD || !salesmanReady(L) || !playerOnFoot() || !forSale(c)) return;
    const spot = c._islandSpot;
    c.owned = true;                                 // the keys: no theft at the door
    let ok = false;
    try { ok = !!(CBZ.cityEnterVehicle && CBZ.cityEnterVehicle(c)); } catch (e) { ok = false; }
    if (!ok) { c.owned = false; return; }
    c._everDriven = true;
    TD = { L: L, car: c, spot: spot, t: 0, rider: null, stolen: false, out: 0 };
    unCard(c);
    // he gets in beside you
    const p = L.post.body();
    if (p && CBZ.carSeatPlacement && CBZ.npcLife && CBZ.npcLife.attach) {
      let pl = null;
      try { pl = CBZ.carSeatPlacement(c, "shotgun"); } catch (e) { pl = null; }
      if (pl && CBZ.npcLife.attach(p, pl.parent, pl.anchor)) { p._aboard = true; L.post.hold = true; TD.rider = p; }
    }
    sayAt(L.post, "Keys. Go easy.");
  }
  function riderOut(stand) {
    const p = TD && TD.rider;
    if (!p) return;
    TD.rider = null;
    const c = TD.car;
    try { if (CBZ.npcLife && CBZ.npcLife.detach) CBZ.npcLife.detach(p, {}); } catch (e) {}
    p._aboard = false;
    // he stands up beside the car, on the passenger side
    if (c && c.pos && p.pos) {
      const h = c.heading || 0, s = Math.sin(h), co = Math.cos(h);
      const x = c.pos.x - co * 1.7, z = c.pos.z + s * 1.7;
      const A = CBZ.surv && CBZ.surv.arena;
      p.pos.set(x, A && A.groundHeightAt ? A.groundHeightAt(x, z) : c.pos.y, z);
      if (p.char) { p.char.sitting = false; }
    }
    TD.L.post.hold = false;
    if (stand) TD.L.post.back();
  }
  function endTest(back) {
    if (!TD) return;
    const c = TD.car;
    riderOut(true);
    if (c && !TD.stolen && !c._playerOwned) { c.owned = false; c._forSale = TD.spot && TD.spot.sale; }
    TD = null;
  }
  function stolen() {
    const c = TD.car;
    TD.stolen = true;
    c.owned = false; c.stolen = true;
    c._forSale = null;
    if (CBZ.cityCrime) { try { CBZ.cityCrime(60, { x: c.pos.x, z: c.pos.z, type: "gta" }); } catch (e) {} }
    if (CBZ.cityAddStars) { try { CBZ.cityAddStars(2, "stolen car"); } catch (e) {} }
    if (TD.rider && CBZ.speech) CBZ.speech.say(TD.rider, "Stop the car!", { secs: 2.6, force: true });
  }
  function testTick(dt) {
    if (!TD) return;
    const c = TD.car, P = CBZ.player;
    if (!c || c.dead || c._scrapped || !P) { riderOut(false); TD = null; return; }
    TD.t += dt;
    const spot = TD.spot;
    const d = spot ? Math.hypot(c.pos.x - spot.x, c.pos.z - spot.z) : 0;
    const inIt = !!(P.driving && P._vehicle === c);
    if (inIt) {
      if (!TD.stolen && (d > STEAL_R || TD.t > TEST_T || !TD.L || lots.indexOf(TD.L) < 0)) stolen();
      // a thief's passenger gets out at the first stop
      if (TD.stolen && TD.rider && Math.abs(c.v || 0) < 0.8) riderOut(false);
      return;
    }
    // you got out
    if (TD.stolen) { riderOut(false); TD = null; return; }
    if (d < 30) {
      if (TD.rider) { riderOut(true); sayAt(TD.L.post, "Well?"); }
      endTest(true);
    } else {
      riderOut(false);
      sayAt(TD.L.post, "I'll take the keys.");
      endTest(false);
    }
  }
  // a car on sale taken without a deal is a stolen car (city/vehicles.js's
  // door already reported the theft: an unowned car); off the lot it is no
  // longer on sale, until it is back on its spot
  function joyride(c, spot) {
    const P = CBZ.player;
    if (!P || !P.driving || P._vehicle !== c || (TD && TD.car === c) || c._playerOwned) return;
    if (Math.hypot(c.pos.x - spot.x, c.pos.z - spot.z) < 25) return;
    c._forSale = null;
    unCard(c);
  }

  /* ---- BUYING ------------------------------------------------------------ */
  function buy(c) {
    const L = lotOfCar(c), spot = c && c._islandSpot;
    if (!L || !spot || !forSale(c) || !salesmanReady(L)) return;
    const price = priceOf(spot);
    const paid = !!(CBZ.city && CBZ.city.spend && CBZ.city.spend(price));
    if (!paid) { sayAt(L.post, "You're short."); return; }
    c._forSale = null; c.owned = true; c.stolen = false; c._playerOwned = true;
    unCard(c);
    own(c, spot.model, spot.color, L.isNew ? L : null);
    if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
    sayAt(L.post, L.isNew ? "She's yours." : "Pleasure.");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  /* ---- YOUR CARS (g.isleCars): where you left them, island to island ---- */
  function cars() { return g.isleCars || (g.isleCars = []); }
  function arenaId() { const A = CBZ.surv && CBZ.surv.arena; return A ? (A.id || (A.island && A.island.arena && A.island.arena.id) || null) : null; }
  function own(c, model, color, showroom) {
    const r = { model: model || (c.model && c.model.name) || null, color: color != null ? color : c.color, island: arenaId(),
      x: c.pos.x, y: c.pos.y, z: c.pos.z, heading: c.heading || 0, car: c, showroom: showroom ? showroom.b : null };
    cars().push(r);
    return r;
  }
  function liveCar(c) { return !!(c && !c._scrapped && !c._reap && (CBZ.cityCars || []).indexOf(c) >= 0); }
  function outFront(r) {
    // a new car bought off the showroom floor, out on the forecourt once nobody sees it
    const b = r.showroom, c = r.car;
    if (!b || !c || c.player) return;
    const P = CBZ.player;
    if (P && P.pos && Math.hypot(P.pos.x - b.ox, P.pos.z - b.oz) < 30) return;
    const lot = CBZ.islandVenue && CBZ.islandVenue.lotFor ? CBZ.islandVenue.lotFor(b) : null;
    if (!lot) return;
    const D = lot.building.door;                       // nx/nz: OUT of the building
    const x = D.x + D.nx * 6.5 + D.nz * 3, z = D.z + D.nz * 6.5 - D.nx * 3;
    const A = CBZ.surv && CBZ.surv.arena;
    const y = (A && A.groundHeightAt ? A.groundHeightAt(x, z) : c.pos.y) + 0.045;
    if (!unseen(c.pos.x, c.pos.y, c.pos.z) || !unseen(x, y, z)) return;
    place(c, x, y, z, Math.atan2(D.nz, -D.nx), false);
    r.showroom = null;
  }
  let ownT = 0;
  function ownedTick(dt) {
    ownT += dt;
    if (ownT < 1) return;
    ownT = 0;
    const L = cars(), id = arenaId(), P = CBZ.player;
    for (let i = L.length - 1; i >= 0; i--) {
      const r = L[i];
      if (r.car && r.car.dead) { L.splice(i, 1); continue; }          // a wreck is not a car you own
      if (r.car && !liveCar(r.car)) r.car = null;
      if (r.car) {
        const c = r.car;
        c.owned = true; c._playerOwned = true;
        if (!c.v || Math.abs(c.v) < 0.2) { r.x = c.pos.x; r.y = c.pos.y; r.z = c.pos.z; r.heading = c.heading || 0; if (c.player || !r.island) r.island = id; }
        if (c.player) r.island = id;
        if (r.showroom) outFront(r);
        continue;
      }
      // not in the world: stand it again where you left it, when its island
      // is the one in force, you are near and nobody is looking at the spot
      if (!id || r.island !== id || !P || !P.pos || !CBZ.cityAddParkedCar) continue;
      if (Math.hypot(P.pos.x - r.x, P.pos.z - r.z) > 300 || !unseen(r.x, r.y, r.z)) continue;
      let c = null;
      try { c = CBZ.cityAddParkedCar(r.x, r.z, r.heading, { force: true, modelName: r.model, color: r.color }); } catch (e) { c = null; }
      if (!c) continue;
      c._world = g.mode; c.owned = true; c._playerOwned = true; c.ai = false; c.stolen = false;
      r.car = c;
    }
  }

  /* ---- THE SALESMAN COMES OVER ------------------------------------------- */
  function lotOfCar(c) {
    const s = c && c._islandSpot;
    if (!s || !s.sale) return null;
    for (const L of lots) if (L.spots.indexOf(s) >= 0) return L;
    return null;
  }
  function browseTick(L, dt) {
    const P = CBZ.player;
    if (!L.post || !P || !P.pos || L.post.hold) return;
    const p = L.post.body();
    if (!p || !L.post.on()) { L.browse = null; return; }
    let best = null, bd = BROWSE_R;
    if (playerOnFoot()) for (const s of L.spots) {
      const c = carOf(s);
      if (!forSale(c)) continue;
      const d = Math.hypot(P.pos.x - c.pos.x, P.pos.z - c.pos.z);
      if (d < bd && Math.abs(P.pos.y - c.pos.y) < 2) { bd = d; best = c; }
    }
    if (best && best !== L.browse) {
      L.browse = best;
      // beside the car, on the side away from you, facing you
      const h = best.heading || 0, sx = Math.cos(h), sz = -Math.sin(h);
      const side = ((P.pos.x - best.pos.x) * sx + (P.pos.z - best.pos.z) * sz) > 0 ? -1 : 1;
      const x = best.pos.x + sx * side * 1.8, z = best.pos.z + sz * side * 1.8;
      L.post.goTo(x, z, Math.atan2(P.pos.x - x, P.pos.z - z));
      L.lineT = 2.5;
    }
    if (L.browse) {
      const c = L.browse;
      const d = Math.hypot(P.pos.x - c.pos.x, P.pos.z - c.pos.z);
      if (!forSale(c) || d > LEAVE_R) { L.browse = null; L.post.back(); return; }
      // a word once he is there
      if (L.lineT > 0) {
        L.lineT -= dt;
        const there = !!L.post.at && Math.hypot(p.pos.x - L.post.at.x, p.pos.z - L.post.at.z) < 0.8;
        if (there && !L.said.has(c)) {
          L.said.add(c);
          const lines = L.isNew ? LINES_NEW : LINES_USED;
          sayAt(L.post, lines[(h01(c.pos.x, c.pos.z, 0x6a3) * lines.length) | 0]);
          L.lineT = 0;
        }
      }
    }
  }

  /* ---- THE TICK ---------------------------------------------------------- */
  let acc = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(36.4, function (dt) {
    if (!live()) return;
    testTick(dt || 0);
    ownedTick(dt || 0);
    acc += dt || 0;
    if (acc < 0.25) return;
    const step = acc; acc = 0;
    if (lots.length) relink();
    for (const L of lots) {
      for (const s of L.spots) {
        const c = carOf(s);
        if (!c) continue;
        tag(c, s);
        joyride(c, s);
        homeIfMoved(c, s);
      }
      browseTick(L, step);
    }
  });

  /* ---- THE CARD ---------------------------------------------------------- */
  function nearSale(ctx, px, pz) {
    if (!live() || !lots.length || !playerOnFoot()) return null;
    const out = [];
    const P = CBZ.player;
    for (const L of lots) for (const s of L.spots) {
      const c = carOf(s);
      if (!forSale(c) || c.player) continue;
      if (Math.abs(c.pos.x - px) > 6 || Math.abs(c.pos.z - pz) > 6 || Math.abs(c.pos.y - P.pos.y) > 2) continue;
      out.push({ x: c.pos.x, z: c.pos.z, car: c, spot: s, L: L, reach: 4.2 });
    }
    return out;
  }
  if (CBZ.islandFit) CBZ.islandFit.fixtures("dealer-car", {
    prio: 9, list: nearSale,
    reach: function (f) { return f.reach; },
    dot: function () { return 0.35; },
    name: function (f) { return (f.spot && f.spot.model) || ""; },
    verbs: [
      { id: "dealer-test-drive", slot: "i", prio: 6, label: "Test drive",
        canShow: function (f) { return !!(f && !TD && salesmanReady(f.L)); }, onSelect: function (f) { if (f) startTest(f.car); } },
      { id: "dealer-buy", slot: "j", prio: 6, label: function (f) { return "Buy " + fmt(priceOf(f.spot)); },
        canShow: function (f) { return !!(f && salesmanReady(f.L)); }, onSelect: function (f) { if (f) buy(f.car); } },
    ],
  });

  CBZ.islandDealers = {
    lots: function () { return lots.slice(); }, owned: cars, test: function () { return TD; },
    price: function (spot) { return spot && spot.sale ? priceOf(spot) : 0; },
  };
})();
