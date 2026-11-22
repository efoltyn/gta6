/* ============================================================
   city/dealership.js — THE CAR DEALER: the cars on the floor are the stock.

   WHAT THIS REPLACED. The dealer's counter opened the storefront panel, and
   its one row was "Buy $1,500": a flat price for a car picked at random,
   which appeared outside. The showroom round it (city/buildings.js
   showroomFloor: the whole catalog on turntable pads, every floor) was
   scenery, each car under a name-and-price label floating in the air.

   NOW the car you want is the car you walk up to. Each one on the floor
   wears its price on a sticker inside the windscreen (the model, the price,
   the dealer's stock number), printed where that body's glass actually is.
   Standing at it:
     Buy $X          the salesman is on the floor: the money leaves (cash,
                     then bank), and that model is brought round to the door,
                     yours (CBZ.citySpawnOwnedCar: the one owned-vehicle path).
     Finance it      the bank's auto note for it (city/bank.js CBZ.cityBankLoan
                     "auto": underwritten on your net worth, billed each cycle)
   The floor car keeps standing with SOLD across its sticker until the next
   one is delivered. Half the sale books to the dealer group and half to the
   model's maker (sim/corporations.js), as the old row did.

   Cost: nothing until you are at a dealer. Then one small canvas per car on
   your floor, a quad each, gone when you leave.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const NEAR = 46;             // stickers exist inside this range of a dealer's door
  const REACH = 3.6;           // you buy a car standing at it
  const RESTOCK = 240;         // seconds a SOLD sticker stays up
  const MAKER_CORP_ID = { KAI: "kaido", VLT: "volante" };   // economy.js CARS .maker -> sim/corporations.js id

  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function now() { return (CBZ.now || 0) / 1000; }
  function priceOf(rec) { return Math.max(500, Math.round((rec.model && rec.model.value) || 1500)); }

  /* WHERE A BODY'S WINDSCREEN IS. Each body style is measured once: the real
     visual is built, and rays dropped onto its centreline from above find the
     steepest run of glass ahead of the roof. -> { y, z, pitch } in the car's
     own frame (nose +Z). */
  const GLASS = Object.create(null);
  const RC = new THREE.Raycaster(), _o = new THREE.Vector3(), _d = new THREE.Vector3(0, -1, 0);
  function glassOf(model) {
    const style = (CBZ.cityInferCarStyle && CBZ.cityInferCarStyle(model)) || "muscle";
    if (GLASS[style]) return GLASS[style];
    let out = { y: 1.05, z: 0.75, pitch: 0.95 };
    let v = null;
    try { v = CBZ.cityBuildPlayerCarVisual ? CBZ.cityBuildPlayerCarVisual(style, model && model.color) : null; } catch (e) { v = null; }
    if (v) {
      v.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(v);
      const len = bb.max.z - bb.min.z, top = bb.max.y;
      // the skin height along the centreline, nose to tail
      const N = 40, prof = [];
      for (let i = 0; i <= N; i++) {
        const z = bb.min.z + len * i / N;
        _o.set(0, top + 1, z); RC.set(_o, _d); RC.far = top + 2 - bb.min.y;
        const hit = RC.intersectObject(v, true);
        prof.push({ z: z, y: hit.length ? hit[0].point.y : bb.min.y });
      }
      // the roof is everything within a hand of the top; the windscreen is the
      // fall from its front edge (a windscreen's height of it, no further)
      let a = 0;
      for (let i = 0; i <= N; i++) if (prof[i].y >= top - 0.07) a = i;
      const slope = function (i) { return (prof[i].y - prof[i + 1].y) / (prof[i + 1].z - prof[i].z); };
      if (a < N - 2) {
        let b2 = a + 1;
        while (b2 < N && prof[a].y - prof[b2].y < 0.44 && slope(b2) > 0.15) b2++;
        if (prof[a].y - prof[b2].y > 0.18) {
          const t = 0.55;
          out = { y: prof[a].y + (prof[b2].y - prof[a].y) * t - bb.min.y, z: prof[a].z + (prof[b2].z - prof[a].z) * t,
                  pitch: Math.atan2(prof[b2].z - prof[a].z, prof[a].y - prof[b2].y) };   // lean back from upright
        }
      }
      v.traverse(function (o) { if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} } });
    }
    GLASS[style] = out;
    return out;
  }

  // the sticker: a dealer's window card
  function drawSticker(cv, rec, lot) {
    const c = cv.getContext("2d"), w = cv.width, h = cv.height;
    const sold = rec.soldT > 0;
    c.fillStyle = sold ? "#b3261e" : "#f6f1dc"; c.fillRect(0, 0, w, h);
    c.strokeStyle = sold ? "#f6f1dc" : "#b3261e"; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12);
    c.textAlign = "center"; c.textBaseline = "middle";
    const fit = function (text, max, px, wt) { do { c.font = (wt || "800 ") + px + "px 'Helvetica Neue', Helvetica, Arial, sans-serif"; px -= 2; } while (px > 8 && c.measureText(text).width > max); };
    if (sold) { c.fillStyle = "#f6f1dc"; fit("SOLD", w - 40, 96); c.fillText("SOLD", w / 2, h / 2 + 4); return; }
    const name = String((rec.model && rec.model.name) || "This one").toUpperCase();
    c.fillStyle = "#1c1c1c"; fit(name, w - 30, 30, "700 "); c.fillText(name, w / 2, 34);
    c.fillStyle = "#b3261e"; fit(fmt$(priceOf(rec)), w - 30, 78); c.fillText(fmt$(priceOf(rec)), w / 2, h / 2 + 10);
    c.fillStyle = "#4a463c"; c.font = "600 15px Helvetica, Arial, sans-serif";
    c.fillText(((lot.building && lot.building.name) || "").toUpperCase() + "  STK " + rec.stock, w / 2, h - 22);
  }

  // one live showroom: its stickers, while you are at it
  let LIVE = null;
  const PLANE = new THREE.PlaneGeometry(1, 1);
  PLANE._shared = true;
  function drop() {
    if (!LIVE) return;
    if (LIVE.group.parent) LIVE.group.parent.remove(LIVE.group);
    for (const rec of LIVE.cars) {
      if (rec.mesh) { rec.mesh.material.map.dispose(); rec.mesh.material.dispose(); rec.mesh = null; rec.cv = null; }
    }
    LIVE = null;
  }
  function stand(lot) {
    const b = lot.building, cars = CBZ.cityShowroomCars ? CBZ.cityShowroomCars(b.group) : null;
    if (!cars || !cars.length) return null;
    const group = new THREE.Group();
    group.name = "dealer-stickers";
    group.userData.dynamic = true;
    b.group.add(group);
    b.group.updateMatrixWorld(true);
    const R = CBZ.renderer, srgb = R && THREE.SRGBColorSpace && R.outputColorSpace === THREE.SRGBColorSpace;
    const v3 = new THREE.Vector3();
    cars.forEach(function (rec, i) {
      if (rec.stock == null) rec.stock = 1000 + ((Math.abs(Math.round(lot.cx * 7 + lot.cz * 13)) + i * 37) % 9000);
      const G = glassOf(rec.model);
      const cv = document.createElement("canvas"); cv.width = 320; cv.height = 200;
      drawSticker(cv, rec, lot);
      const tex = new THREE.CanvasTexture(cv);
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(PLANE, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
      // on the glass, on the passenger side, lying back with it
      const pivot = new THREE.Group();
      pivot.position.set(rec.lx, rec.ly, rec.lz);
      pivot.rotation.y = rec.ang;
      m.scale.set(0.36, 0.225, 1);
      m.position.set(-0.34, G.y + Math.sin(G.pitch) * 0.02, G.z + Math.cos(G.pitch) * 0.02);
      m.rotation.x = -G.pitch;
      m.castShadow = false;
      pivot.add(m); group.add(pivot);
      rec.mesh = m; rec.cv = cv;
      // where it is in the world (the card's anchor)
      v3.set(rec.lx, rec.ly, rec.lz); b.group.localToWorld(v3);
      rec.x = v3.x; rec.y = v3.y; rec.z = v3.z; rec.lot = lot;
    });
    return { lot: lot, group: group, cars: cars };
  }
  function redraw(rec) {
    if (!rec.mesh || !rec.cv) return;
    drawSticker(rec.cv, rec, rec.lot);
    rec.mesh.material.map.needsUpdate = true;
  }

  // the salesman: the dealer's own clerk, on his feet and not being robbed
  function salesman(lot) {
    const v = lot && lot.building && lot.building.vendor;
    return v && !v.dead && !((v.ko || 0) > 0) && !v._keepFree && !v.surrender && !v.poseHandsUp && !v.rage ? v : null;
  }
  function say(v, text) { if (v && CBZ.citySay) { try { CBZ.citySay(v, text, null, { secs: 2.8, force: true }); } catch (e) {} } }
  // brought round to the door, yours
  function deliver(rec, lot, price) {
    const d = lot.building.door;
    let car = null;
    try { car = CBZ.citySpawnOwnedCar ? CBZ.citySpawnOwnedCar(d.x - (d.nx || 0) * 4.6, d.z - (d.nz || 0) * 4.6, rec.model && rec.model.name) : null; } catch (e) { car = null; }
    if (!car) return false;
    const mk = rec.model && MAKER_CORP_ID[rec.model.maker];
    const co = mk && CBZ.corps && CBZ.corps.get ? CBZ.corps.get(mk) : null;
    if (CBZ.corps && CBZ.corps.creditRevenue) {
      CBZ.corps.creditRevenue("apex", price * 0.25);
      if (mk) CBZ.corps.creditRevenue(mk, price * 0.25 * (co ? (co.brandHeat || 1) : 1));
    }
    rec.soldT = RESTOCK;
    redraw(rec);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(price >= 60000 ? 4 : 1);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    return true;
  }
  // cash, then the bank (a car is not pocket money)
  function funds() { return (g.cash || 0) + (g.cityBank || 0); }
  function pay(price) {
    if (funds() < price) return false;
    const fromCash = Math.min(g.cash || 0, price);
    g.cash = (g.cash || 0) - fromCash;
    if (price > fromCash) g.cityBank = (g.cityBank || 0) - (price - fromCash);
    if (CBZ.sfx) CBZ.sfx("coin");
    return true;
  }
  function buy(rec) {
    const lot = rec.lot, v = salesman(lot), price = priceOf(rec);
    if (!v || rec.soldT > 0) return;
    if (funds() < price) { say(v, "She's " + fmt$(price) + ". Come back with it, or talk to the bank."); return; }
    if (!pay(price)) return;
    if (!deliver(rec, lot, price)) { g.cash = (g.cash || 0) + price; say(v, "I can't get one round today."); return; }
    say(v, "She's out front. Keys are in it.");
  }
  function note(rec) {
    const L = CBZ.cityBankLoan;
    if (!L || !L.offer) return null;
    let o = null;
    try { o = L.offer("auto", priceOf(rec), { collateral: priceOf(rec) }); } catch (e) { o = null; }
    return o && o.approved && o.principal >= priceOf(rec) ? o : null;
  }
  function finance(rec) {
    const lot = rec.lot, v = salesman(lot), price = priceOf(rec), o = note(rec);
    if (!v || rec.soldT > 0 || !o) return;
    o.purpose = "auto";
    const id = CBZ.cityBankLoan.take(o);
    if (!id) { say(v, "The bank said no."); return; }
    // the bank's money came to you; it goes to him
    if (!pay(price)) return;
    if (!deliver(rec, lot, price)) { g.cash = (g.cash || 0) + price; return; }
    say(v, "Signed. " + fmt$(o.payment) + " a cycle to the bank. She's out front.");
  }

  // the dealer you are at (its door within range)
  function lotNear(P) {
    const A = CBZ.cityArenaLive ? CBZ.cityArenaLive() : (CBZ.city && CBZ.city.arena);
    const lots = A && A.shopLots;
    if (!lots) return null;
    let best = null, bd = NEAR * NEAR;
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i], b = lot && lot.building;
      if (!b || lot.kind !== "carlot" || lot.demolished || !b.group || !b.door) continue;
      const dx = b.door.x - P.pos.x, dz = b.door.z - P.pos.z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = lot; }
    }
    return best;
  }
  let scanT = 0;
  CBZ.onUpdate(38.7, function (dt) {
    if (!g || g.mode !== "city" || g.state !== "playing") { if (LIVE) drop(); return; }
    wire();
    if (LIVE) for (const rec of LIVE.cars) if (rec.soldT > 0) { rec.soldT -= dt; if (rec.soldT <= 0) { rec.soldT = 0; redraw(rec); } }
    scanT -= dt;
    if (scanT > 0) return;
    scanT = 0.5;
    const P = CBZ.player;
    if (!P || !P.pos) return;
    const lot = lotNear(P);
    if (LIVE && LIVE.lot !== lot) drop();
    if (lot && !LIVE) LIVE = stand(lot);
  });

  let wired = false;
  const _out = [];
  function wire() {
    const I = CBZ.interactions;
    if (wired || !I || !I.registerFixtures) return;
    wired = true;
    I.registerFixtures({
      id: "showcar", kind: "showcar", prio: 8,
      list: function (ctx, px, pz) {
        if (!LIVE) return null;
        const py = ctx && ctx.pos ? ctx.pos.y : (CBZ.player ? CBZ.player.pos.y : 0);
        _out.length = 0;
        for (const rec of LIVE.cars) {
          if (Math.abs(rec.y - py) > 2.4) continue;                  // the cars on your floor
          if (Math.abs(rec.x - px) > 6 || Math.abs(rec.z - pz) > 6) continue;
          _out.push(rec);
        }
        return _out.length ? _out : null;
      },
      reach: function () { return REACH; },
      dot: function () { return 0.5; },
      name: function (rec) { return rec.soldT > 0 ? "Sold" : ((rec.model && rec.model.name) || "Car"); },
      verbs: [
        { id: "showcar-buy", slot: "e", prio: 7, label: function (rec) { return "Buy " + fmt$(priceOf(rec)); },
          canShow: function (rec) { return !(rec.soldT > 0) && !!salesman(rec.lot); }, onSelect: buy },
        { id: "showcar-finance", prio: 5, label: function (rec) { const o = note(rec); return "Finance it, " + fmt$(o ? o.payment : 0) + " a cycle"; },
          canShow: function (rec) { return !(rec.soldT > 0) && !!salesman(rec.lot) && funds() < priceOf(rec) && !!note(rec); }, onSelect: finance },
      ],
    });
  }
  CBZ.cityDealer = {
    live: function () { return LIVE ? { lot: LIVE.lot, cars: LIVE.cars.map(function (r) { return { name: r.model && r.model.name, price: priceOf(r), sold: r.soldT > 0, x: r.x, y: r.y, z: r.z }; }) } : null; },
    buy: function (i) { if (LIVE && LIVE.cars[i]) buy(LIVE.cars[i]); },
    glass: function (model) { return glassOf(model); },
  };
})();
