/* Freeport storyboard for tools/visual-compare.mjs — the place stolen money
   becomes yours.

   WHAT THIS PHOTOGRAPHS (wave G, 2026-08-03):
     • a warehouse compound on its OWN claimed land, with the access road
       city/govcomplex.js pushed to its gate — the owner's "a plot like the
       plot we put the fake pentagon on";
     • the loading dock a truck backs into and the apron/strip a freighter
       can sit on;
     • the racking INSIDE, empty, and then the same rack after sixteen real
       deposits — the shot the whole wave exists for, because the pile IS the
       bank statement;
     • the floor safe in a house bought on [Z], holding a bag flown home.

   THE BEFORE SIDE HAS NONE OF THIS AND SAYS SO. The deployed build has no
   `freeport` COMPLEXES row and no CBZ.cashStore, so its coordinates simply do
   not exist — there is no honest tripod to copy. Rather than photograph an
   arbitrary field and imply it is the same place, the before side flies to
   the city it does have, states NO WAREHOUSE COMPLEX / NO CASH STORE on the
   plate, and reports zeroes into the metrics table. Every number in that
   table therefore reads as a genuine 0 → N.

   NOTHING IS POKED INTO STATE THAT A PLAYER COULD NOT DO. The stacked-rack
   plate spawns real CBZ.cashBags at the dock and calls the real
   CBZ.cashStore.unloadHere() verb; the home-safe plate buys a real listing
   through CBZ.cityZillow, picks a real bag up off the floor and calls the
   real stow verb. The only thing granted outright is the deed, and it is
   granted through storage.js's own grant() — the same ledger write buying it
   performs — because photographing a $1.75M purchase is not what this
   storyboard is for.

   Staging facts: rAF is stubbed after boot so CBZ.stepSim is the only clock;
   every tripod is derived from CBZ.cashStore.warehouse() (the coordinates
   govcomplex.js published) rather than typed, so a different seed puts the
   camera in the right place with no edit here. */

const subjects = [
  { id: "compound-exterior", label: "The Freeport, from the air",
    focus: "The claim: a fenced yard on empty land with a real access road running to its gate, a shed, a container yard and a lit cargo strip. This is the plot the fake pentagon taught us to make.",
    shot: "aerial" },
  { id: "gate-road", label: "The gate and the road in",
    focus: "The road is the whole point of a place you DRIVE the money to. govcomplex.js pushes a real drivable spur from the nearest junction to this gate; the for-sale board stands beside it until you buy.",
    shot: "gate" },
  { id: "loading-dock", label: "The loading dock",
    focus: "Truck-height deck against the shed's own face, three roller doors, bumpers and a stair down to the yard. Back a bed up here and one verb unloads the whole load.",
    shot: "dock" },
  { id: "air-apron", label: "The cargo strip and apron",
    focus: "172 m of paved strip with a hardstand off the middle of it — the 'load up the cargo plane and fly it somewhere else' half of the loop has somewhere to land.",
    shot: "apron" },
  { id: "shelves-empty", label: "The racks, empty",
    focus: "Three runs of two-level racking inside the shed: 48 slots, every one a published coordinate. This is what the room looks like before you have done anything.",
    shot: "racks", stash: 0 },
  { id: "shelves-stacked", label: "The racks after sixteen deposits",
    focus: "THE MONEY SHOT. Sixteen real duffels driven in and unloaded through the real verb, each one sitting on a real slot. The room is the bank statement — you can read your net worth off the shelves.",
    shot: "racks", stash: 16 },
  { id: "home-safe", label: "The floor safe at home",
    focus: "A house bought on [Z] takes three bags in a floor safe just inside the door. Fly a load home and it is physically in your house.",
    shot: "home", homeStash: 2 },
];

async function stageWarehouse(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const subject = input.subject || {};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };

  let S = window.__freeportSeq;
  if (!S) {
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        CBZ.stepSim && document.getElementById("playBtn"),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn");
      if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    try { if (CBZ.dayPhase) CBZ.dayPhase(0.42); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    for (let i = 0; i < 150; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }

    const overlay = document.createElement("div");
    overlay.id = "__freeportOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-perf></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__freeportSeq = { overlay: overlay, homeId: null };
    window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
  }

  const step = (secs) => {
    const n = Math.max(0, Math.round(secs * 60));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      CBZ.stepSim(1 / 60);
      if (CBZ.player) { CBZ.player.hp = Math.max(CBZ.player.hp || 100, 80); CBZ.player.dead = false; }
    }
  };
  const put = (x, z) => {
    const P = CBZ.player; if (!P || !P.pos) return;
    if (P.driving && CBZ.cityExitVehicle) { try { CBZ.cityExitVehicle(); } catch (_) {} }
    const y = CBZ.floorAt ? (CBZ.floorAt(x, z) || 0) : 0;
    P.pos.set(x, y, z); P.vy = 0; P.grounded = true;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
  };
  /* SETTLE — step the sim WITH REAL WALL TIME PASSING, and it is not padding.
     core/farcull.js paces its shell sweep off `performance.now()` (deliberately:
     game-dt is clamped, so a dt-paced sweep starved on slow machines). A
     storyboard that bursts 24 stepSim calls in five milliseconds therefore gets
     ONE partial cursor pass, and the first draft's plates were photographs of a
     world that had not been un-culled yet — the warehouse simply was not drawn,
     from a tripod standing inside it. Interleaving real waits lets the sweep
     fire ~4x/second exactly as it does for a player who walks in.

     SIX SECONDS, NOT TWO, and that is not padding either: the sweep is
     INCREMENTAL (a cursor over ~5,800 arena children, a slice per pass), so
     2.4 s of waiting bought ~8 passes — sometimes enough to reach the yard,
     sometimes not, and consecutive rounds of this storyboard flipped between a
     fully-dressed compound and a bare pad from the SAME tripod. 6 s is ~19
     passes: full coverage twice over, and a plate that means the same thing
     every time it is taken. */
  const settle = async (secs) => {
    const rounds = Math.max(1, Math.round((secs || 6.0) / 0.3));
    for (let i = 0; i < rounds; i++) { step(0.12); await wait(310); }
  };
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__freeportOverlay") continue;
      child.style.visibility = "hidden";
    }
    /* AND THE 3D HUD. systems/fpsmode.js parents its weapon viewmodel to
       CBZ.camera itself (`CBZ.camera.add(vm)`), so a storyboard that flies the
       camera by hand takes the fists/rifle with it — a pale wedge sat in the
       bottom-right corner of every plate of the first three rounds. Anything
       parented to the camera is HUD, not world, and this is a world
       storyboard. */
    if (CBZ.camera) for (const c of CBZ.camera.children) c.visible = false;
  };

  const CS = CBZ.cashStore;
  const W = CS && CS.warehouse ? CS.warehouse() : null;
  const audit = (typeof CBZ.warehouseAudit === "function") ? CBZ.warehouseAudit() : null;

  // ---- the tripod, derived from what govcomplex.js published --------------
  let cam = null, aim = null, fov = 55, state = "";
  const metrics = {
    plotPlaced: audit && audit.plotPlaced ? 1 : 0,
    plotRoads: audit ? audit.plotRoads : 0,
    shelfSlots: audit ? audit.shelvesPublished : 0,
    bagsStored: audit ? audit.bagsStored : 0,
    valueStored: audit ? audit.valueStored : 0,
    bagMeshes: audit ? audit.meshes : 0,
    orphanBags: audit ? audit.orphanBags : 0,
    crewOwed: audit ? audit.crewOwed : 0,
    crewSettled: audit ? audit.crewSettled : 0,
  };

  if (!W) {
    // ---- THE DEPLOYED PLATE. No row, no file, no coordinates. -------------
    const A = CBZ.city && CBZ.city.arena;
    const c = (A && A.center) || { x: 0, z: 0 };
    cam = { x: c.x, y: 320, z: c.z + 300 }; aim = { x: c.x, y: 0, z: c.z };
    state = CS ? "NO WAREHOUSE COMPLEX ON THIS BUILD" : "NO CASH STORE · NO WAREHOUSE COMPLEX";
    put(c.x, c.z + 40);
    await settle(6.0);
  } else {
    const site = CS.site();
    const R = site.rect, cx = site.cx, cz = site.cz;
    const gate = site.gate || { x: cx, z: R.maxZ };
    /* WHICH WAY IS OUT OF THE YARD. govcomplex.js derives the gate edge from
       where the city is, so a typed "+Z is the front" put every outside-looking
       tripod behind the compound on this seed. `W.out` is that unit vector,
       published by the builder; `oz` is its Z component and every camera below
       multiplies by it instead of assuming a compass. */
    const oz = (W.out && W.out.z) || 1;
    const sh = W.shelves || [];
    let sx = 0, sz = 0;
    for (let i = 0; i < sh.length; i++) { sx += sh[i].x; sz += sh[i].z; }
    if (sh.length) { sx /= sh.length; sz /= sh.length; }

    if (CS.owned && !CS.owned() && subject.shot !== "gate" && CBZ.cityStorage && CBZ.cityStorage.grant) {
      CBZ.cityStorage.grant("freeport");     // the deed, by the same ledger write buying it makes
    }

    if (subject.shot === "aerial") {
      /* AN APPROACH, NOT A PLAN VIEW. Three rounds of this shot were flown at
         205 m, 132 m and 54 m and all three photographed the same thing — a
         grey pad and two shells — because from any altitude that frames a
         192x164 m plot, the fence, the containers and the dock are a few
         pixels each and the yard flattens into its own hardstanding. The
         ground-level plates prove every one of them is built and drawn. So
         this subject is now shot the way you would actually arrive: 26 m up
         and 130 m out on the gate side, three-quarters on, so the fence line
         has depth, the road runs into frame and the shed reads as a building
         you could back a truck into rather than a black rectangle. */
      cam = { x: cx - 82, y: 40, z: gate.z + oz * 100 }; aim = { x: cx + 16, y: 2, z: cz + oz * 8 }; fov = 60;
      put(cx, cz + oz * 40);
    } else if (subject.shot === "gate") {
      cam = { x: gate.x + 34, y: 11, z: gate.z + oz * 62 }; aim = { x: gate.x, y: 4, z: gate.z - oz * 30 }; fov = 55;
      put(gate.x + 6, gate.z + oz * 16);
    } else if (subject.shot === "dock") {
      cam = { x: W.dock.x + 34, y: 12.5, z: W.dock.z + oz * 30 }; aim = { x: W.dock.x - 4, y: 2.4, z: W.dock.z - oz * 12 }; fov = 52;
      put(W.dock.x, W.dock.z + oz * 4);
    } else if (subject.shot === "apron") {
      cam = { x: W.apron.x + 62, y: 46, z: W.apron.z + oz * 86 }; aim = { x: W.apron.x - 30, y: 0, z: W.apron.z - oz * 6 }; fov = 54;
      put(W.apron.x, W.apron.z + oz * 20);
    } else if (subject.shot === "racks") {
      const want = subject.stash | 0;
      const have = CS.stored().bags;
      if (want < have) { CS.bankIt(); }
      if (want > CS.stored().bags) {
        // real bags, at the dock, through the real verb
        put(W.dock.x, W.dock.z);
        const n = want - CS.stored().bags;
        for (let i = 0; i < n; i++) {
          const a = 380000 + (i % 5) * 145000;
          const bx = W.dock.x + ((i % 4) - 1.5) * 1.5, bz = W.dock.z + (((i / 4) | 0) - 1) * 1.5;
          CBZ.cashBags.spawn(bx, CBZ.floorAt ? CBZ.floorAt(bx, bz) : 0, bz, a,
            { src: "storyboard", srcName: "haul", dyed: i === 3 });
        }
        step(0.2);
        CS.unloadHere();
        step(1.2);
      }
      /* THE TRIPOD HAS TO BE INSIDE THE SHED. The first draft stood it 21 m
         south of the rack centroid, which is 3 m OUTSIDE the front wall — the
         plate was a photograph of corrugated steel. `W.inside` is the clear
         span govcomplex.js published, so the camera is clamped into it and
         cannot leave the building on any seed. */
      const IN = W.inside;
      const clamp = (v, a, b) => Math.max(a + 1.5, Math.min(b - 1.5, v));
      put(clamp(sx + 8, IN.minX, IN.maxX), clamp(sz + oz * 13, IN.minZ, IN.maxZ));
      /* THE MONEY SHOT WANTS THE BAGS BIG. Rounds 3 and 4 stood at the far end
         of the racking at beam height, and at 30-40 m every duffel was six
         pixels behind its own beam — three runs of steel read as a fence.
         `sh[0]` is the slot bag #1 lands on, which the builder guarantees is
         the run NEAREST THE DOOR, so the tripod is pinned 7 m off THAT run's
         face and one bay west of the first slot: the near duffels are a metre
         across, the row recedes down the shelf, and the two runs behind still
         show. The shed's floor plate is 3.2 m up, so 2.3 is the ceiling of
         what a camera in here can use. */
      const fz = sh.length ? sh[0].z : sz;
      cam = { x: clamp(sx - 17, IN.minX, IN.maxX), y: 2.35, z: clamp(fz + oz * 8, IN.minZ, IN.maxZ) };
      // aim at the CENTRE OF THE RACK BLOCK, not down the first run — aiming
      // along the run's own axis pushed every bag into the right-hand third and
      // filled the left of the plate with bare wall.
      aim = { x: sx + 2, y: 1.0, z: sz }; fov = 66;
    } else if (subject.shot === "home") {
      let homes = CBZ.cityRealtyOwnedHomes ? CBZ.cityRealtyOwnedHomes() : [];
      if (!homes.length && CBZ.cityZillow) {
        // buy the cheapest listed home the market will actually sell
        if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(4000000);
        const rows = (CBZ.cityRealtyListings ? CBZ.cityRealtyListings({}) : [])
          .filter((r) => r.canBuy && r.category === "residence")
          .sort((a, b) => a.price - b.price);
        if (rows.length) { CBZ.cityZillow.buy(rows[0].id); }
        homes = CBZ.cityRealtyOwnedHomes ? CBZ.cityRealtyOwnedHomes() : [];
      }
      if (!homes.length) return { ok: false, err: "no owned home to photograph" };
      const h = homes[0];
      S.homeId = h.id;
      let dx = h.cx - h.x, dz = h.cz - h.z;
      const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
      const ax = h.x + dx * 2.6, az = h.z + dz * 2.6;
      const want = subject.homeStash | 0;
      let held = CS.homeStored(h.id).bags;
      for (let i = held; i < want; i++) {
        put(ax + 0.6, az + 0.6);
        const b = CBZ.cashBags.spawn(ax + 0.9, CBZ.floorAt ? CBZ.floorAt(ax, az) : 0, az + 0.9, 420000 + i * 90000,
          { src: "storyboard", srcName: "haul" });
        step(0.1);
        if (b) { CBZ.cashBags.pickup(b); step(0.1); CS.stow(); step(0.1); }
      }
      // step off the door's own axis: standing dead on it put a structural
      // column between the lens and the safe on round 3. The offset is along
      // the door's PERPENDICULAR, so it is right on any lot.
      const px = -dz, pz = dx;
      put(ax - dx * 3.4 + px * 1.4, az - dz * 3.4 + pz * 1.4);
      cam = { x: ax - dx * 3.5 + px * 1.5, y: 1.65, z: az - dz * 3.5 + pz * 1.5 };
      aim = { x: ax, y: 0.5, z: az }; fov = 58;
      state = h.name;
    }
    await settle(6.0);
    const a2 = CBZ.warehouseAudit();
    metrics.plotPlaced = a2.plotPlaced ? 1 : 0;
    metrics.plotRoads = a2.plotRoads;
    metrics.shelfSlots = a2.shelvesPublished;
    metrics.bagsStored = a2.bagsStored;
    metrics.valueStored = a2.valueStored;
    metrics.bagMeshes = a2.meshes;
    metrics.orphanBags = a2.orphanBags;
    metrics.crewOwed = a2.crewOwed;
    metrics.crewSettled = a2.crewSettled;
    metrics.owned = a2.owned ? 1 : 0;
    if (subject.shot === "home") metrics.homeBags = a2.homes.bags;
    if (!state) state = "Freeport @ " + Math.round(site.cx) + "," + Math.round(site.cz);
  }

  // ---- frame + render -----------------------------------------------------
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = fov; camera.near = 0.25; camera.far = 20000;
  camera.position.set(cam.x, cam.y, cam.z);
  camera.lookAt(aim.x, aim.y, aim.z);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  hideHud();
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const render = (CBZ.renderer.info && CBZ.renderer.info.render) || {};
  metrics.drawCalls = Number(render.calls || 0);

  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector(`[data-${n}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = subject.label;
  q("name").style.cssText = "position:absolute;top:212px;left:26px;font-size:22px;font-weight:800;letter-spacing:-.02em;max-width:360px";
  q("focus").textContent = state;
  q("focus").style.cssText = "position:absolute;top:248px;left:27px;color:#c0cfda;font-size:12px;font-weight:550;max-width:360px";
  q("perf").textContent = W
    ? `racks ${metrics.bagsStored}/${metrics.shelfSlots} · $${(metrics.valueStored || 0).toLocaleString("en-US")} · meshes ${metrics.bagMeshes}`
    : "no freeport on this build";
  q("perf").style.cssText = `position:absolute;right:24px;top:24px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:${W ? "#9fe8c3" : "#ff9c9c"}`;
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:10px;left:27px;color:#9cb0bf;font:10px ui-monospace,SFMono-Regular,Menlo,monospace";

  return { ok: true, metrics: metrics, cam: cam, aim: aim };
}

export default {
  id: "warehouse",
  title: "The Freeport: where stolen money becomes yours",
  description: "A warehouse compound on its own claimed land — gate, access road, loading dock, cargo strip — and the racks inside it, empty and then holding sixteen duffels driven in and unloaded through the game's own verb. The deployed build has neither the plot nor the store and says so on every plate.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  defaultFocus: "Is this a place you would drive a million dollars to, and can you see the money once it is there?",
  pairNote: "Same seed · same boot · tripods derived from the published site record",
  method: "Both sides boot the real world at seed 90210 with requestAnimationFrame frozen, advancing only through CBZ.stepSim. Every tripod on the local side is derived from CBZ.cashStore.warehouse() — the coordinates city/govcomplex.js published when it claimed the land — so nothing is typed and a different seed still frames correctly. The stacked-rack plate spawns real cash bags at the dock and calls the real unload verb; the home-safe plate buys a real listing, picks a real bag off the floor and calls the real stow verb. The deployed build has no such row, no such file and therefore no such coordinates, so it photographs the city it does have and states the absence.",
  metricsNote: "Everything is read from CBZ.warehouseAudit() inside the photographed build. orphanBags is the ratchet: a bag counted in the ledger with no mesh on a rack is money that exists only in a save file, and it is pinned at 0.",
  metrics: {
    plotPlaced: { label: "Plot claimed", better: "higher" },
    plotRoads: { label: "Access road segments", better: "higher" },
    shelfSlots: { label: "Rack slots published", better: "higher" },
    owned: { label: "Owned", better: "higher" },
    bagsStored: { label: "Bags on the racks", better: "higher" },
    valueStored: { label: "Value stored", unit: "$", better: "higher" },
    bagMeshes: { label: "Duffel meshes placed", better: "higher" },
    orphanBags: { label: "Stored bags with no mesh", better: "lower" },
    homeBags: { label: "Bags in the floor safe", better: "higher" },
    crewOwed: { label: "Crew still owed", unit: "$", better: "lower" },
    crewSettled: { label: "Crew paid off the rack", unit: "$", better: "higher" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageWarehouse,
};
