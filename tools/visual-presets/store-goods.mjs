/* THE SHELVES SELL THE GOODS — real stock in real stores.

   OWNER (verbatim): "gun store having all the real guns for sale on shelves and
   armoury having real armour on mannequins, and sunglass store, things already
   existing in the game real wearable or holdable items that can be in space i
   dont want a store with a bunch of fake shit why should that even be built."

   WHAT THE BEFORE SIDE IS, MEASURED. buildings.js's furnishShop is written to
   stand wall shelving in every store and put painted blocks on it. It never
   does. `wallShelves` places its units hugging the wall (lateral offset
   halfTan - deep - 0.05) and then gates each one through
   clearFloorPoint(..., 0.8), which demands 0.8 m of clearance from the INNER
   WALL FACE — with WT = 0.4 the deepest a wall-hugging piece can sit and pass
   is halfTan - 1.2, and the shelf asks for halfTan - 0.75. Probed on a live
   city at seed 90210: clearPad08 false at every wall-shelf spot, and
   lot.building.shoplift empty on 179 of 182 shops. So the deployed store is a
   floor, a counter and a clerk, with its entire stock living in nine rows of
   text behind the register. The gun store's armoury displayed body armour as a
   0.55x0.78x0.32 box on a stick.

   WHAT THE AFTER SIDE IS. city/storegoods.js STANDS the shelving — a back
   panel, two uprights, a kick and three open boards, long axis along the wall,
   drawn through the building's own b.lbox so it folds into the batch merge —
   then deals the shop's real cityEcon stock across those boards as real
   CBZ.itemAsset models: the phone, the laptop, the medkit, the burger, the
   crowbar, the shades. Each is bought with [E] where it sits through the
   counter's own money path, or pocketed when the clerk is not looking.
   gunstore.js's armoury is now real character rigs wearing armor.js's real
   vests and helmet. And there is a sunglass store, because every frame in it is
   a real pair of glasses that goes on your face.

   STAGING. store-dress.mjs's pattern: the real game boots once per side at seed
   90210, rAF is frozen and CBZ.stepSim is the clock. The player is teleported
   into the store so the interior visibility gates open, and the tripod stands in
   the aisle looking at one shelf.

   THE SIDES DO NOT SHARE A CITY LAYOUT, and they cannot: adding a shop kind
   adds one draw to the shop-queue shuffle, so at the same seed the trades land
   on different lots. Each side therefore photographs ITS OWN nearest store of
   the named trade. The question these plates answer is not "is this the same
   building" — it is "is there anything real on that shelf", and that reads
   whichever building it is. */

const subjects = [
  { id: "electronics", label: "Volt Electronics — the shelf",
    kind: "electronics", shelf: 0,
    focus: "BEFORE: bare wall — furnishShop's shelving is vetoed by its own clearance gate, so there is nowhere for a phone to be. AFTER: real shelving with actual phones and laptops on it, each one buyable where it stands." },
  { id: "gas", label: "Pump & Go — the cooler aisle",
    kind: "gas", shelf: 0,
    focus: "A convenience shop is drinks and snacks. BEFORE: an empty wall and a menu. AFTER: soda, coffee, water, an energy drink, a hotdog — the exact models the inventory photographs and the pavement drops." },
  { id: "hardware", label: "Hammer & Nail — the racks",
    kind: "hardware", shelf: 1,
    focus: "BEFORE: nothing between the door and the counter. AFTER: crowbars, lockpicks, a bat and a medkit on three levels of real racking — tools that exist as tools." },
  { id: "pharmacy", label: "City Hospital — the pharmacy shelf",
    kind: "hospital", shelf: 0,
    focus: "The dispensary: medkits and body armour standing on real racking instead of two lines of text, with the clerk's eyes deciding whether taking one is free or a called-in theft." },
  { id: "eyewear", label: "SHADES — the sunglass store",
    kind: "eyewear", shelf: 1,
    focus: "THE NEW STORE. A whole shop kind whose stock is the glasses slot: five real frames on the shelves, each a distinct look bling.js mounts on your face when you buy it. There is no such store on the deployed side at all." },
  { id: "food", label: "The Greasy Spoon — the counter shelf",
    kind: "food", shelf: 0,
    focus: "Burgers, pizza, bread, an apple — food you can see before you buy it, and then eat at the shelf through the one eat path. BEFORE: a text row called Burger." },
  { id: "armoury", label: "The armoury — real armour on mannequins",
    kind: "guns", view: "armoury",
    focus: "THE MONEY SHOT. BEFORE: a torso-shaped box and a dome on a post. AFTER: character rigs in studio cream wearing armor.js's OWN vest, plate carrier and ballistic helmet — the same props mounted by the same function that dresses a SWAT officer." },
  { id: "gunwall", label: "The gun wall + the armoury row",
    kind: "guns", view: "room",
    focus: "The whole floor: the real guns already hung on the wall, and now a row of armoured bodies beside them instead of blocks. One store where nothing on display is a stand-in." },
];

async function stageGoods(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__goodsOverlay") continue;
      child.style.visibility = "hidden";
    }
  };
  const tick = (n) => {
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      try { CBZ.stepSim(1 / 60); } catch (_) {}
      if (CBZ.player) CBZ.player.hp = 100;
    }
  };

  let S = window.__goodsSeq;
  if (!S) {
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        CBZ.stepSim && document.getElementById("playBtn"), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing";
    }, 120000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    tick(60);
    const overlay = document.createElement("div");
    overlay.id = "__goodsOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-fit></div><div data-where></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__goodsSeq = { overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const sub = input.subject;
  const arena = CBZ.city && CBZ.city.arena;
  if (!arena) return { ok: false, err: "no arena" };
  const lots = arena.shopLots || arena.lots || [];
  const centre = (arena.center || { x: 0, z: 0 });

  // the nearest store of this trade to the city centre — a stable, layout-free
  // rule that picks one on either side without assuming they agree.
  let lot = null, bd = 1e18;
  for (const l of lots) {
    const b = l && l.building;
    if (!b || l.demolished) continue;
    const k = (b.shop && b.shop.kind) || l.kind;
    if (k !== sub.kind) continue;
    const d = Math.hypot(l.cx - centre.x, l.cz - centre.z);
    if (d < bd) { bd = d; lot = l; }
  }
  if (!lot) return { ok: false, err: "no " + sub.kind + " lot in this city", absent: true };

  const b = lot.building;
  /* WHERE THE SHOP FLOOR IS, AND WHY NOT floorAt(). Standing inside a shell,
     CBZ.floorAt returns the platform above you — the first run of this sheet
     framed a gun store from 6 m up and photographed its ROOF. The shell knows
     where its own floor is: its group's world origin plus the 0.14 foundation
     slab. That number is also what makes the town shops work at all, because a
     town's shell rides a TRANSLATED root and its local coordinates are not
     world ones. */
  const shellPos = new T.Vector3();
  if (b.group) { try { b.group.updateMatrixWorld(true); shellPos.setFromMatrixPosition(b.group.matrixWorld); } catch (_) {} }
  const floorY = shellPos.y + 0.14;
  const cx0 = b.group ? shellPos.x : lot.cx;
  const cz0 = b.group ? shellPos.z : lot.cz;

  // stand the player INSIDE so every interior gate (and storegoods' own live
  // dresser) opens, then let it settle.
  if (CBZ.game) CBZ.game.cityHolstered = true;
  if (CBZ.player && CBZ.player.pos && CBZ.player.pos.set) {
    CBZ.player.pos.set(cx0, floorY + 0.08, cz0);
    CBZ.player.vy = 0; CBZ.player.grounded = true; CBZ.player.hp = 100;
  }
  tick(40);

  // ---- the tripod -----------------------------------------------------------
  let camPos = null, aim = null, fov = 58;
  // BOTH sides read the same anchor list: the AFTER side moved it under a name
  // that says who owns it now, and nothing else about it changed.
  const shelves = b.storeShelves || b.shoplift || [];
  if (sub.view === "armoury" || sub.view === "room") {
    const gs = b.gunstore;
    const C = gs && gs.counter;
    if (!C) return { ok: false, err: "no gun store counter" };
    const longLen = Math.max(C.w, C.d);
    // the store interior is the way a customer looks at the back counter
    let inx = cx0 - C.x, inz = cz0 - C.z;
    const il = Math.hypot(inx, inz) || 1; inx /= il; inz /= il;
    /* THE GUN STORE'S DISPLAY LIVES IN THE BACK BAND, and that is the whole
       framing problem. furnishShop runs a full-height back-of-house partition
       across every deep shop at 5.5 m in front of the back wall; gunstore.js
       hangs its rack ON the back wall and stands its counter 2.8 m off it, so
       the rack, the counter and the armoury row are all inside a 5.5 m strip
       you reach through a 1.7 m doorway. A tripod that steps "3 m into the
       room" from a mannequin steps into that partition and photographs stucco.
       Every camera below therefore stays INSIDE the band and looks ALONG it. */
    if (sub.view === "armoury") {
      /* The armoury row runs down the counter's − tangent end. Both builds put
         it there and space it differently (deployed: L/2+0.7 stepping 0.9;
         local: L/2+0.95 stepping 1.15), so frame the MIDDLE of whichever row
         this build actually stood, from the counter end, looking down the row. */
      let rx = null, rz = null;
      const row = CBZ.cityGunstoreArmoury && CBZ.cityGunstoreArmoury();
      if (row && row.length && row[(row.length / 2) | 0] && row[(row.length / 2) | 0].x != null) {
        const mid = row[(row.length / 2) | 0];
        rx = mid.x; rz = mid.z;
      } else {
        const off = -(longLen / 2 + 1.6);
        rx = C.x + C.tx * off; rz = C.z + C.tz * off;
      }
      camPos = { x: rx + C.tx * 3.1 + inx * 1.5, y: floorY + 1.62, z: rz + C.tz * 3.1 + inz * 1.5 };
      aim = { x: rx, y: floorY + 1.10, z: rz };
      fov = 56;
    } else {
      // the back-wall rack, from inside the band: gs.rack's normal points back
      // INTO the room, and 3.6 m is as far as the partition lets you stand.
      const R = gs.rack;
      camPos = { x: R.x + R.nx * 4.2 - R.tx * 3.2, y: floorY + 2.15, z: R.z + R.nz * 4.2 - R.tz * 3.2 };
      aim = { x: R.x - R.tx * 1.4, y: floorY + 1.55, z: R.z - R.tz * 1.4 };
      fov = 76;
    }
  } else {
    /* THE SAME SPOT IN THE ROOM ON BOTH SIDES. The tripod is solved from the
       BUILDING'S OWN frame — b.localDoor's inward normal, the shell half-widths
       and the wall thickness — so "the side wall, 5.2 m in from the door, at
       shelf height" is the same place whether or not anything is standing
       there. When the local build has stood shelving, its published board
       positions are used instead, and they land on the same wall. */
    const dr = b.localDoor;
    if (!dr) return { ok: false, err: "no localDoor on the " + sub.kind + " shell" };
    const inx = dr.nx || 0, inz = dr.nz || 0;
    const tx = -inz, tz = inx;
    const along = Math.abs(inx) > 0.5;
    const halfIn = (along ? b.w : b.d) / 2, halfTan = (along ? b.d : b.w) / 2;
    const wt = b.wt != null ? b.wt : 0.4;
    const lat = halfTan - wt - 0.28;
    const depth = 5.2 + (sub.shelf | 0) * 3.0;
    // pick the wall that is not the stair strip (clearFloorPoint answers on
    // both sides — it is a property of the shell, not of this wave).
    let side = 1;
    for (const s2 of [1, -1]) {
      const lx = inx * (-halfIn + depth) + tx * (s2 * lat);
      const lz = inz * (-halfIn + depth) + tz * (s2 * lat);
      if (!b.clearFloorPoint || b.clearFloorPoint(lx, lz, 0.06)) { side = s2; break; }
    }
    let sx = cx0 + inx * (-halfIn + depth) + tx * (side * lat);
    let sz = cz0 + inz * (-halfIn + depth) + tz * (side * lat);
    let sy = floorY + 1.05;
    // aisle direction: on the estimate, toward the room centre.
    let ax = cx0 - sx, az = cz0 - sz;
    const boards = (CBZ.cityStoreGoodsShelves && CBZ.cityStoreGoodsShelves(lot)) || null;
    if (boards && boards.length) {
      /* WHEN THE SHELVING EXISTS, STAND ON THE SHELF'S OWN TERMS. Solving the
         tripod out of room geometry put it on the pavement outside three
         different 28 m stores — a shop's "room centre" is not reliably on the
         aisle side of a given wall once partitions, storefronts and stacked
         upper floors are in the shell. Each board publishes the direction it
         FACES (the way its goods are turned), so the camera steps that way and
         looks straight back down it. Nothing else can put it in a wall. */
      let best = null, bdd = 1e9;
      for (const bo of boards) {
        if (bo.island) continue;
        const d = Math.hypot(bo.x - sx, bo.z - sz) + Math.abs((bo.y - floorY) - 1.02) * 3;
        if (d < bdd) { bdd = d; best = bo; }
      }
      if (best) { sx = best.x; sz = best.z; sy = best.y; ax = best.fx; az = best.fz; }
    }
    const axz = Math.hypot(ax, az) || 1;
    ax /= axz; az /= axz;
    camPos = { x: sx + ax * 2.0, y: sy + 0.52, z: sz + az * 2.0 };
    aim = { x: sx, y: sy + 0.08, z: sz };
    fov = 54;
  }

  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = fov;
  camera.near = 0.05;
  camera.far = 4000;
  camera.position.set(camPos.x, camPos.y, camPos.z);
  camera.lookAt(aim.x, aim.y, aim.z);
  camera.updateProjectionMatrix();
  const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
  if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);
  hideHud();
  try { CBZ.renderer.info.reset(); } catch (_) {}
  CBZ.renderer.render(CBZ.scene, camera);
  const calls = (CBZ.renderer.info && CBZ.renderer.info.render && CBZ.renderer.info.render.calls) | 0;
  if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = true;

  // ---- the numbers ----------------------------------------------------------
  // realGoods is counted OFF THE SCENE, not off an audit export, so the
  // deployed side is measured by the same rule and not merely assumed to be 0:
  // every named unit of stock a store stands up carries userData.storeGood.
  let realGoods = 0;
  if (CBZ.scene) {
    const wp = new T.Vector3();
    CBZ.scene.traverse(function (o) {
      if (!o.userData || !o.userData.storeGood) return;
      o.getWorldPosition(wp);
      if (Math.abs(wp.x - cx0) > 22 || Math.abs(wp.z - cz0) > 22) return;
      realGoods++;
    });
  }
  // shelf boards actually standing in this store — the thing goods can sit on.
  // MEASURED ON THE DEPLOYED SIDE TOO: furnishShop's wallShelves are gated
  // through clearFloorPoint(0.8) at a wall-hugging offset that gate can never
  // pass, so the deployed number is whatever islands it did manage to record.
  const boardList = (CBZ.cityStoreGoodsShelves && CBZ.cityStoreGoodsShelves(lot)) || null;
  const shelfBoards = boardList ? boardList.length : (b.shoplift || []).length;
  // how much of this trade's stock is still sold as TEXT at the counter.
  const stock = (CBZ.cityEcon && CBZ.cityEcon.stockFor(sub.kind)) || [];
  const shelved = (CBZ.cityGoodsLive && CBZ.cityGoodsLive(lot)) || [];
  const textRows = Math.min(9, stock.filter((n) => shelved.indexOf(n) < 0).length);
  // the armoury: real armor.js parts actually mounted on a display body.
  let armourParts = 0, mannequins = 0;
  if (CBZ.cityGunstoreArmoury) {
    for (const r of CBZ.cityGunstoreArmoury()) { armourParts += r.armorParts | 0; if (r.rig) mannequins++; }
  }

  const metrics = { realGoods, shelfBoards, textRows, drawCalls: calls };
  if (sub.view === "armoury" || sub.view === "room") {
    metrics.armourParts = armourParts;
    metrics.mannequins = mannequins;
  }

  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector(`[data-${n}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = sub.label;
  q("name").style.cssText = "position:absolute;top:64px;left:26px;font-size:27px;font-weight:800;letter-spacing:-.02em";
  q("focus").textContent = sub.focus;
  q("focus").style.cssText = "position:absolute;top:100px;left:28px;color:#c0cfda;font-size:13px;font-weight:550;max-width:760px";
  q("fit").textContent = Object.keys(metrics).map((k) => k + " " + metrics[k]).join(" · ");
  q("fit").style.cssText = "position:absolute;right:24px;top:24px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3";
  q("where").textContent = (b.name || sub.kind) + "  @ " + Math.round(cx0) + "," + Math.round(cz0) +
    "  ·  room " + Math.round(b.w) + "x" + Math.round(b.d) + "m  ·  legacy shelf anchors " + shelves.length;
  q("where").style.cssText = "position:absolute;bottom:40px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return { ok: true, kind: sub.kind, lot: [Number(cx0.toFixed(1)), Number(cz0.toFixed(1))],
           name: b.name || null, metrics };
}

export default {
  id: "store-goods",
  title: "No Store Sells Anything That Is Not In The Room",
  description: "The real game boots once per side at seed 90210 and the player walks into an electronics shop, a gas station, a hardware store, the trap house, the diner, the new sunglass store and the gun store's armoury. Tripods stand in the aisle looking at one shelf. The deployed side shows furnishShop's painted blocks and a shoplift verb that hands you a flavour word; the local side shows the shop's real cityEcon stock standing up as its real item models, buyable where it sits, and an armoury of character rigs wearing armor.js's actual vests.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1200, height: 760 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 600000,
  metricsNote: "realGoods counts scene objects tagged userData.storeGood within 22 m of the lot — the same scan runs on both sides. shelfBoards is how many surfaces goods can stand on in that store; on the deployed side furnishShop's wall units are vetoed by a clearance gate a wall-hugging shelf can never pass, so it counts only the free-standing islands it did record. textRows is how much of the trade's stock the clerk still sells as a menu line. The two sides do not share a city layout (a new shop kind adds one draw to the shop-queue shuffle), so each photographs its own nearest store of the named trade — the tripod is solved from that building's own door frame so it stands in the same place in the room either way.",
  metrics: {
    realGoods: { label: "Real item models on the shelves", better: "higher" },
    shelfBoards: { label: "Shelf boards standing in the store", better: "higher" },
    textRows: { label: "Stock still sold as menu text", better: "lower" },
    armourParts: { label: "Real armour parts worn on display", better: "higher" },
    mannequins: { label: "Armoury display bodies", better: "higher" },
    drawCalls: { label: "Draw calls in frame", better: "lower" },
  },
  subjects,
  stage: stageGoods,
};
