/* THE WHOLE LOOP, IN ONE LIVE WORLD — storyboard for tools/visual-compare.mjs.

   THE ASK (owner, verbatim): "i love the vault idea and the idea of someone at
   the bank who has a key that you can take hostage or kill and loot or
   pickpocket and then get in the vault, and then grab actual bags … bank has
   tellers you can deposit withdraw or get in the vault and grab physical bags
   each with amounts of money, its real af and then you can open the back of a
   truck and put the bags in and drive them to a property you pay for land and
   build a property and then buy your own vault for it and boom all the assets
   of a game matter and it feels real as fuck."

   Six plates, in the order the sentence is spoken, all shot inside the REAL
   game. Nothing here is a studio mock-up and nothing is re-drawn: the camera
   is the only thing this file poses. It is a SEQUENCE — plate 2 needs the man
   in plate 1 to have been robbed, plate 3 needs the key from plate 2, plate 4
   needs the duffels from plate 3, plate 6 needs the van from plate 5 — so a
   later plate failing means an earlier beat did not happen.

   HOW THE DEPLOYED SIDE DEGRADES, honestly and usefully. That build already
   has the vault ROOM, the duffels and the van's cargo hold: what it does not
   have is a key anywhere in the game, a way to put a bag you are carrying into
   a truck, or a vault you can buy. So every plate photographs the SAME real
   place from the SAME camera and the state line names exactly what is absent
   — a true statement rather than an error card. Every capability is
   feature-detected by MEASURING it (does this ped carry a key; did that latch
   take; is there a room standing on that land), never by a version string. */

const subjects = [
  {
    id: "manager-key",
    label: "The man with the key",
    focus: "The branch manager at the desk beside the vault door. LOCAL: he is carrying 'Vault Key · Meridian Trust' as a real inventory item — dip him, hold him up, take him hostage or shoot him and go through his pockets, and it comes to you. DEPLOYED: he is a body with a job title and nothing in his pockets.",
  },
  {
    id: "vault-door-key",
    label: "The door, after you took it off him",
    focus: "The same 0.42 m leaf, from the hall. The manager has been robbed at gunpoint and the card now reads 'Unlock the vault' / 'You have the key.' DEPLOYED: the same steel, the same money behind it, and a door that only C4 or a hostage will move.",
  },
  {
    id: "vault-open-bags",
    label: "Open, quietly, and the money is on the floor",
    focus: "THE MONEY SHOT. A key turn is not a breach: no blast, no alarm ladder, `breached` stays false — and the branch's real till balance leaves the ledger as CANVAS DUFFELS you pick up one at a time. DEPLOYED: shut, because there is no key in that build to turn.",
  },
  {
    id: "bag-into-van",
    label: "Into the back of the van",
    focus: "Standing at the open tailgate with a duffel on your shoulder. LOCAL: one verb on the shoulder card puts it on the deck and STRAPS it — the same latch that chains a tank into a cargo plane. DEPLOYED: the same van, the same open back, and no way to put the bag in it; the only verbs are put it down and throw it.",
  },
  {
    id: "van-at-property",
    label: "Driven to land you paid for",
    focus: "The loaded van standing on the property. LOCAL: a poured strongroom behind it — a building you bought, with a door somebody could blow. DEPLOYED: the property beacon, and a plot with nothing on it.",
  },
  {
    id: "your-vault",
    label: "Your own vault, with your money on the shelves",
    focus: "Inside the strongroom you bought, looking at the rack. Each duffel is a real stored bag, the total is a declared CBZ.cityTill balance anybody could come and take, and the key in your pocket is the same class of item the bank manager was carrying. DEPLOYED: this room does not exist.",
  },
];

async function stageLoop(input) {
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
  const tick = (dt) => {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    CBZ.stepSim(dt == null ? 1 / 60 : dt);
    if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
  };
  const steps = (n) => { for (let i = 0; i < n; i++) tick(); };
  const round = (v, n) => (Number.isFinite(v) ? Math.round(v * Math.pow(10, n == null ? 2 : n)) / Math.pow(10, n == null ? 2 : n) : null);
  const money = (n) => "$" + Math.round(n || 0).toLocaleString("en-US");
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__loopOverlay") continue;
      child.style.visibility = "hidden";
    }
  };
  // the first-person viewmodel is parented to the camera this file poses by
  // hand; left alone it lays a forearm across every interior plate.
  const hideViewmodel = () => {
    const cam = CBZ.camera;
    if (!cam || !cam.children) return;
    for (const c of cam.children) c.visible = false;
  };
  const syncSky = () => {
    if (typeof CBZ.skySync === "function") { CBZ.skySync(); return; }
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(CBZ.camera.position.x, 0, CBZ.camera.position.z);
  };
  const look = (fx, fy, fz, tx, ty, tz) => {
    const cam = CBZ.camera;
    cam.position.set(fx, fy, fz);
    cam.up.set(0, 1, 0);
    cam.lookAt(new T.Vector3(tx, ty, tz));
    cam.aspect = input.width / input.height;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    syncSky();
    hideViewmodel();
  };
  // put the player (and the camera the LOD sweeps read) somewhere
  const stand = (x, z, y) => {
    const P = CBZ.player; if (!P || !P.pos) return 0;
    const gy = y != null ? y : (CBZ.floorAt ? CBZ.floorAt(x, z) : 0);
    P.driving = false; P._vehicle = null; P._aircraft = null;
    P.pos.set(x, gy, z);
    if (P.vel) { P.vel.x = P.vel.y = P.vel.z = 0; }
    CBZ.camera.position.set(x, gy + 1.7, z);
    return gy;
  };

  let S = window.__bankLoop;
  if (!S) {
    // ---------------- one-time: boot the real world ----------------------
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") && CBZ.stepSim && document.getElementById("playBtn"),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 120000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    try { if (CBZ.dayPhase) { CBZ.dayPhase(0.40); steps(20); } } catch (_) {}

    const overlay = document.createElement("div");
    overlay.id = "__loopOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-detail></div><div data-source></div>";
    document.body.appendChild(overlay);

    /* THE BANK. Both builds dress a vault room into every bank lot at world
       build, so the anchor of this whole storyboard is a real branch that
       exists identically on both sides — which is what makes the camera
       comparable at all. */
    const vaults = (CBZ.cityVaults ? CBZ.cityVaults() : []).filter((v) => v.tier === "branch");
    const vault = vaults[0] || (CBZ.cityVaults ? CBZ.cityVaults()[0] : null);

    S = window.__bankLoop = {
      overlay, vault,
      manned: false, robbed: false, opened: false,
      van: null, loaded: 0, bought: false, ownVault: null, shelved: 0,
      keyLabel: null, wantsShut: "", robNote: "",
    };
    window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
  }

  const V = S.vault;
  const KEYS = CBZ.cityKeys && typeof CBZ.cityKeys.has === "function" ? CBZ.cityKeys : null;
  const PV = CBZ.cityPropVault || null;
  const CANLOAD = typeof CBZ.vehicleHoldPut === "function" && typeof CBZ.vehicleHoldNear === "function";
  const id = input.subject.id;
  const state = [];
  const metrics = {};
  let detail = "";

  if (!V) {
    // nothing to photograph anywhere — say so rather than render a black frame
    hideHud();
    state.push("NO BANK VAULT IN THIS WORLD");
    detail = "CBZ.cityVaults " + (typeof CBZ.cityVaults);
  } else {

  // ---- the frame this whole file is built in: the vault's own axes --------
  const nx = V.inx, nz = V.inz;             // into the strongroom
  const tx = -nz, tz = nx;                  // across the door
  const at = (deep, lat, y) => new T.Vector3(V.x + nx * deep + tx * lat, (V.y || 0) + (y || 0), V.z + nz * deep + tz * lat);

  /* MAN THE HALL. citystaff.js refuses to spawn a post the player can SEE
     appear (npcTransitionSafe), so standing at the door and waiting produces an
     empty bank forever. The fix is the one a player performs without thinking:
     arrive from down the street. 160 m, two sweeps, then walk in. */
  if (!S.manned) {
    S.manned = true;
    stand(V.x + 160, V.z);
    steps(200);
    const p = at(-6, 0); stand(p.x, p.z);
    steps(220);
  }

  const staff = (CBZ.cityPeds || []).filter((p) => p && !p.dead && p._vaultStaff === V.id);
  const manager = staff.filter((p) => p.job === "bank manager")[0] || null;
  const keyOnManager = !!(KEYS && manager && KEYS.pedKeys(manager).length);
  if (keyOnManager) S.keyLabel = KEYS.pedKeys(manager)[0].label;

  // ---------------- advance the storyboard --------------------------------
  if (id === "vault-door-key" || id === "vault-open-bags" || id === "bag-into-van" ||
      id === "van-at-property" || id === "your-vault") {
    if (!S.robbed) {
      S.robbed = true;
      S.wantsShut = (CBZ.cityVaultWants && CBZ.cityVaultWants(V)) || "";
      // THE GUNPOINT ROUTE, through the ONE function gp-rob and ped-mug both
      // call. Both builds run it; only one of them moves a key.
      if (manager && CBZ.cityRobPed) { try { CBZ.cityRobPed(manager); } catch (_) {} }
      steps(10);
    }
  }
  const hasKey = !!(KEYS && KEYS.has(V.id));

  if (id === "vault-open-bags" || id === "bag-into-van" || id === "van-at-property" || id === "your-vault") {
    if (!S.opened && hasKey && CBZ.cityVaultTry) {
      try { S.opened = !!CBZ.cityVaultTry(V); } catch (_) { S.opened = false; }
      steps(120);
    }
  }

  // ---- the van, parked at a deterministic spot in the street outside ------
  const vanSpot = at(-18, 0);
  if (id === "bag-into-van" || id === "van-at-property" || id === "your-vault") {
    if (!S.van && CBZ.cityAddParkedCar) {
      try {
        S.van = CBZ.cityAddParkedCar(vanSpot.x, vanSpot.z, Math.atan2(-nx, -nz), { modelName: "Bison Hauler" });
      } catch (_) { S.van = null; }
      if (S.van) {
        // the hold is minted LAZILY within 90 m of the camera on a 0.4 s sweep
        stand(vanSpot.x + 4, vanSpot.z);
        steps(80);
      }
    }
  }
  const hold = S.van && S.van.hold && !S.van.hold.inert ? S.van.hold : null;
  // where a loadmaster stands: a metre and a half aft of the tailgate sill
  const sillStand = (back) => {
    if (!hold || !hold._hold || !hold._hold.rig) return { x: vanSpot.x, z: vanSpot.z + 4 };
    const H = hold._hold;
    return H.rig.worldOf(H.ramp ? H.ramp.x : H.floor.x, H.floor.top, (H.ramp ? H.ramp.sillZ : H.floor.z) - (back || 1.5), {});
  };

  if (id === "bag-into-van" || id === "van-at-property" || id === "your-vault") {
    if (hold && !hold.open) { hold.openRamp(); steps(220); }
    const s = sillStand(1.5);
    const gy = stand(s.x, s.z);
    steps(6);
    // put a duffel on the shoulder — a player walks it over; a storyboard does
    // not, so the bag is moved to his feet and picked up with the real verb.
    if (CBZ.cashBags && CBZ.cashBags.list && !CBZ.cashBags.carried()) {
      const free = CBZ.cashBags.list().filter((b) => !b.carried && !b._heldBy)[0];
      if (free) {
        free.x = s.x; free.z = s.z; free.y = gy; free.air = false;
        try { CBZ.cashBags.pickup(free); } catch (_) {}
        steps(4);
      }
    }
    // AND THE VERB ITSELF. Only one build has it; the other keeps the bag on
    // its shoulder, which is exactly what the plate is about.
    if (CANLOAD && hold && hold.open) {
      let guard = 0;
      while (CBZ.cashBags.carried() && guard++ < 4) {
        const near = CBZ.vehicleHoldNear(CBZ.player.pos.x, CBZ.player.pos.y, CBZ.player.pos.z, 5.0);
        const bag = CBZ.cashBags.stow();
        if (near && bag && CBZ.vehicleHoldPut(near, bag)) S.loaded++;
        steps(3);
        const nxt = CBZ.cashBags.list().filter((b) => !b.carried && !b._heldBy)[0];
        if (nxt && S.loaded < 4) {
          nxt.x = CBZ.player.pos.x; nxt.z = CBZ.player.pos.z; nxt.y = CBZ.player.pos.y; nxt.air = false;
          try { CBZ.cashBags.pickup(nxt); } catch (_) {}
        }
      }
      steps(6);
    }
  }

  // ---- THE PROPERTY: land, then a vault for it ---------------------------
  /* THE FREEPORT, not the two-bay garage, and the reason is a photograph. The
     garage's beacon sits in the middle of the car lot: the strongroom lands
     among parked cars and the wide shot is a rooftop. The Freeport is the one
     property in the game that is a PLACE ON ITS OWN LAND (city/govcomplex.js's
     bonded yard), which is both the honest home for a vault full of duffels
     and the only plot with room to stand back and look at one. */
  const propId = "freeport";
  let spot = null;
  if (CBZ.cityStorage && CBZ.cityStorage.spots) {
    try { spot = (CBZ.cityStorage.spots() || []).filter((q) => q.prop && q.prop.id === propId)[0] || null; } catch (_) { spot = null; }
  }
  if (id === "van-at-property" || id === "your-vault") {
    if (!S.bought) {
      S.bought = true;
      // BUY THE LAND with the existing property ledger, then the vault with
      // real money through the desk's own purchase path.
      // grant() is city/storage.js's own "already paid for, another way" write
      // — the same one cashstore.js uses when duffels cover the price at the
      // gate. The storyboard does not have twenty minutes to haul $1.75M in.
      if (CBZ.cityStorage && CBZ.cityStorage.grant) { try { CBZ.cityStorage.grant(propId); } catch (_) {} }
      if (PV) {
        CBZ.game.cash = Math.max(CBZ.game.cash || 0, 900000);
        try { PV.buy(propId, "strongroom"); } catch (_) {}
        steps(10);
        S.ownVault = PV.room(propId);
      }
    }
    // DRIVE IT OVER. The storyboard does not simulate a road trip; it puts the
    // van (and everything strapped in it) on the property, which is the state
    // the plate is a photograph of.
    if (S.van && spot) {
      const px = spot.x + 6, pz = spot.z + 2;
      const gy = CBZ.floorAt ? CBZ.floorAt(px, pz) : 0;
      S.van.pos.set(px, gy, pz);
      if (S.van.group) S.van.group.position.copy(S.van.pos);
      S.van.heading = Math.PI * 0.25;
      if (S.van.group) S.van.group.rotation.y = S.van.heading;
      stand(px + 5, pz + 4);
      steps(30);
    }
  }
  if (id === "your-vault" && PV && S.ownVault) {
    const R = S.ownVault;
    if (!R.open && CBZ.cityVaultTry) { try { CBZ.cityVaultTry(R); } catch (_) {} steps(90); }
    if (!S.shelved) {
      const rx = R.x + R.inx * (R.rd * 0.5), rz = R.z + R.inz * (R.rd * 0.5);
      stand(rx, rz, R.y);
      steps(4);
      for (let i = 0; i < 6; i++) {
        const free = CBZ.cashBags.list().filter((b) => !b.carried && !b._heldBy)[0];
        if (!free) break;
        free.x = rx; free.z = rz; free.y = R.y; free.air = false;
        try { CBZ.cashBags.pickup(free); } catch (_) {}
        if (!CBZ.cashStore || !CBZ.cashStore.stow || !CBZ.cashStore.stow()) break;
        S.shelved++;
      }
      steps(6);
    }
  }

  // ---------------- the cameras -------------------------------------------
  hideHud();
  if (id === "manager-key") {
    const who = manager || staff[0] || null;
    if (who && who.pos) {
      const fx = who.pos.x - nx * 3.1 + tx * 1.9, fz = who.pos.z - nz * 3.1 + tz * 1.9;
      look(fx, (who.pos.y || 0) + 1.62, fz, who.pos.x, (who.pos.y || 0) + 1.18, who.pos.z);
    } else {
      const f = at(-5.5, 3.0, 1.7), t = at(0, 0, 1.2);
      look(f.x, f.y, f.z, t.x, t.y, t.z);
    }
  } else if (id === "vault-door-key") {
    const f = at(-4.6, 0.9, 1.62), t = at(0.2, 0, 1.25);
    look(f.x, f.y, f.z, t.x, t.y, t.z);
  } else if (id === "vault-open-bags") {
    const f = at(-3.2, 0.2, 1.72), t = at(V.rd * 0.55, 0, 0.55);
    look(f.x, f.y, f.z, t.x, t.y, t.z);
  } else if (id === "bag-into-van") {
    // dead astern at a loadmaster's height, looking INTO the bay
    const s = sillStand(2.8), c = sillStand(-1.6);
    const py = (CBZ.player.pos.y || 0);
    look(s.x, py + 1.55, s.z, c.x, py + 0.75, c.z);
  } else if (id === "van-at-property") {
    /* A WIDE SHOT OFF THE PROPERTY BEACON, not off the van — and high. Framed
       off the van at 6 m the first run put the camera inside the car lot's own
       canopy and photographed a rectangle of asphalt on BOTH sides. The beacon
       is the one point both builds agree on, so it is the anchor, and 15 m up
       clears every roof this lot has. */
    const ax = spot ? spot.x : (S.van ? S.van.pos.x : 0);
    const az = spot ? spot.z : (S.van ? S.van.pos.z : 0);
    const gy = CBZ.floorAt ? CBZ.floorAt(ax, az) : 0;
    look(ax + 24, gy + 8.5, az + 24, ax + 2, gy + 2.0, az + 2);
  } else if (id === "your-vault") {
    const R = S.ownVault;
    if (R) {
      // STAND IN THE DOORWAY, NOT IN THE ROOM. Inside the partition the note
      // trolley is 0.9 m from the lens and the shelves are behind it; from the
      // hall the doorway frames the whole rack.
      const f = new T.Vector3(R.x - R.inx * 2.5, R.y + 1.78, R.z - R.inz * 2.5);
      const t = new T.Vector3(R.rx, R.y + 1.10, R.rz);
      look(f.x, f.y, f.z, t.x, t.y, t.z);
    } else if (spot) {
      const gy = CBZ.floorAt ? CBZ.floorAt(spot.x, spot.z) : 0;
      look(spot.x + 15, gy + 6.0, spot.z + 15, spot.x + 1, gy + 1.4, spot.z + 1);
    }
  }
  /* NOTHING MAY TICK AFTER THE CAMERA IS POSED. city/camera.js owns the camera
     at update order 50, so a single `stepSim` here silently throws away every
     shot in this file and photographs the ordinary follow camera instead —
     which is exactly what the first run of this preset did, six identical
     plates of a banking hall from the player's own head. Every beat that needs
     sim time takes it BEFORE look(); after it, the only thing left is the
     renderer. */

  // ---------------- the numbers -------------------------------------------
  const kAudit = CBZ.cityKeysAudit ? CBZ.cityKeysAudit() : null;
  const vAudit = CBZ.vaultAudit ? CBZ.vaultAudit() : null;
  const hAudit = CBZ.holdAudit ? CBZ.holdAudit() : null;
  const pAudit = CBZ.propVaultAudit ? CBZ.propVaultAudit() : null;

  metrics.keysOnPeds = kAudit ? kAudit.keysOnPeds + (S.robbed ? 1 : 0) : 0;
  metrics.keysHeld = kAudit ? kAudit.heldByPlayer : 0;
  metrics.vaultOpensByKey = vAudit && vAudit.openedByKey != null ? vAudit.openedByKey : 0;
  metrics.bagsInHold = hAudit ? (hAudit.groundBags != null ? hAudit.groundBags : hAudit.bags || 0) : 0;
  metrics.bagsOnVaultFloor = V ? V.bags.length : 0;
  metrics.bagsInOwnedVault = pAudit ? pAudit.bags : 0;
  metrics.ownedVaultDollars = pAudit ? pAudit.value : 0;
  metrics.ownedVaultsBuilt = pAudit ? pAudit.built : 0;
  metrics.drawCalls = CBZ.renderer && CBZ.renderer.info ? CBZ.renderer.info.render.calls : null;

  // THE LEDGER, asked of the ledger — never of this file's own bookkeeping.
  if (PV && S.ownVault && CBZ.cityTill && CBZ.cityTill.holds) {
    try {
      const src = S.ownVault.till && S.ownVault.till.src;
      if (src) metrics.ledgerInYourVault = Math.round(CBZ.cityTill.holds(src, { point: "vault" }).amount || 0);
    } catch (_) {}
  }

  // ---------------- the state line ----------------------------------------
  const label = (CBZ.cityVaultLabel && CBZ.cityVaultLabel(V)) || "";
  const wants = (CBZ.cityVaultWants && CBZ.cityVaultWants(V)) || "";
  if (id === "manager-key") {
    if (keyOnManager) state.push("HE IS CARRYING " + S.keyLabel.toUpperCase());
    else state.push(manager ? "NO KEY EXISTS IN THIS BUILD" : "NO MANAGER STANDING");
    state.push(staff.length + " staff manned at this branch");
    detail = "CBZ.cityKeys " + (KEYS ? "✓" : typeof CBZ.cityKeys) +
      " · keysOnPeds " + (kAudit ? kAudit.keysOnPeds : "-") +
      " · routes: pickpocket / corpse / gunpoint / hostage" +
      " · manager " + (manager ? (manager.name || "yes") : "none");
  } else if (id === "vault-door-key") {
    state.push(hasKey ? "KEY IN YOUR POCKET" : "NO KEY ANYWHERE");
    state.push("card: “" + (label || "—") + "”");
    state.push("line: “" + (wants || S.wantsShut || "—") + "”");
    detail = "vaultLock route " + (hasKey ? "key" : "power/insider") +
      " · hp " + Math.round(V.hp) + "/" + V.hp0 +
      " · behind it " + money(CBZ.cityVaultState && V.lot ? CBZ.cityVaultState(V.lot).holds : 0);
  } else if (id === "vault-open-bags") {
    state.push(V.open ? (V.breached ? "OPEN — BREACHED" : "OPEN — QUIET, breached=false") : "STILL SHUT");
    state.push(V.bags.length + " duffels on the floor");
    if (!V.open) state.push("this build opens for C4 or a hostage only");
    detail = "openedByKey " + metrics.vaultOpensByKey + " · blasted " + (vAudit ? vAudit.blasted : "-") +
      " · bagsLive " + (CBZ.cashBagAudit ? CBZ.cashBagAudit().live : "-") +
      " · valueBagged " + money(vAudit ? vAudit.valueBagged : 0);
  } else if (id === "bag-into-van") {
    state.push(hold ? ("tailgate " + Math.round(hold.rampT * 100) + "% · " + hold.label) : "NO CARGO HOLD ON THIS VAN");
    state.push(CANLOAD ? "verb: “Load the bag into the cargo bay”" : "NO WAY TO PUT IT IN — put down / throw only");
    state.push(S.loaded ? (S.loaded + " duffels strapped to the deck") : "the bag is still on your shoulder");
    detail = "CBZ.vehicleHoldPut " + (typeof CBZ.vehicleHoldPut) +
      " · cashBags.stow " + (typeof (CBZ.cashBags && CBZ.cashBags.stow)) +
      " · interact option cashbag-load " +
      (CBZ.interactions && CBZ.interactions.hasOption ? (CBZ.interactions.hasOption("cashbag-load") ? "✓" : "absent") : "?");
  } else if (id === "van-at-property") {
    state.push(S.loaded ? (S.loaded + " duffels strapped in the back") : "nothing in the back");
    state.push(PV && S.ownVault ? "YOUR STRONGROOM STANDS HERE" : "BARE LAND — no vault to buy in this build");
    detail = "CBZ.cityPropVault " + (PV ? "✓" : typeof CBZ.cityPropVault) +
      " · property " + propId + (spot ? " @ " + Math.round(spot.x) + "," + Math.round(spot.z) : " (no spot)") +
      " · groundBags " + metrics.bagsInHold;
  } else if (id === "your-vault") {
    if (PV && S.ownVault) {
      state.push("bought · " + (pAudit ? pAudit.bags : 0) + "/" + (pAudit ? pAudit.capacity : 0) + " bags");
      state.push(money(metrics.ownedVaultDollars) + " on the shelves");
      state.push("ledger says " + money(metrics.ledgerInYourVault || 0));
    } else {
      state.push("NO VAULT YOU CAN BUY IN THIS BUILD");
      state.push("the Freeport racks are the only place a duffel banks");
    }
    detail = "propVaultAudit " + (pAudit ? JSON.stringify({ bought: pAudit.bought, built: pAudit.built, unbuilt: pAudit.unbuilt, keys: pAudit.keysHeld }) : "-") +
      " · room " + (S.ownVault ? S.ownVault.id + " tier " + S.ownVault.tier + " hp " + S.ownVault.hp0 : "none");
  }
  }

  // ---------------- overlay ------------------------------------------------
  const before = input.side === "before";
  const OV = (window.__bankLoop && window.__bankLoop.overlay) || null;
  if (OV) {
    const q = (n) => OV.querySelector("[data-" + n + "]");
    const green = state.length && !/^(NO |STILL SHUT|BARE LAND)/.test(state[0]);
    q("side").textContent = before ? input.beforeLabel : input.afterLabel;
    q("side").style.cssText = "position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:" +
      (before ? "#c94c4c" : "#218b60") + ";font-size:12px;font-weight:900;letter-spacing:.12em";
    q("name").textContent = input.subject.label;
    q("name").style.cssText = "position:absolute;top:64px;left:26px;font-size:27px;font-weight:800;letter-spacing:-.02em";
    q("focus").textContent = input.subject.focus;
    q("focus").style.cssText = "position:absolute;top:100px;left:28px;color:#c0cfda;font-size:13px;font-weight:550;max-width:700px";
    q("state").textContent = state.join(" · ");
    q("state").style.cssText = "position:absolute;right:24px;top:24px;color:" + (green ? "#80e4b4" : "#ff9c9c") +
      ";font-size:11px;font-weight:850;letter-spacing:.08em;text-align:right;max-width:430px";
    q("detail").textContent = detail;
    q("detail").style.cssText = "position:absolute;right:24px;bottom:18px;color:#a7b6c2;font:10px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right;max-width:600px";
    q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
    q("source").style.cssText = "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";
  }

  return {
    ok: true,
    subject: id,
    hasKeys: !!KEYS,
    hasPropVault: !!PV,
    canLoad: CANLOAD,
    metrics,
  };
}

export default {
  id: "bank-loop",
  title: "The Bank Loop: a key, a man, a van, and a vault you bought",
  description: "The owner's sentence, photographed end to end inside one live world per side. A branch manager who physically carries the vault key (dip him, hold him up, take him hostage, or shoot him and go through his pockets); a vault door that says 'You have the key' and swings QUIETLY, without a breach, dropping the branch's real till balance on the floor as duffels; a duffel loaded into the back of an ordinary city van and strapped to the deck by the same latch that chains a tank into a cargo plane; the van driven to land you paid for; and a strongroom you BOUGHT for that land — the identical CBZ.cityVaultRoom the bank has, with your money on its shelves as a declared ledger balance anybody could come and take. The deployed build has the room and the duffels, and no key anywhere, no way to put a bag into a truck, and nothing to buy.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1180, height: 700 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  // the whole world warm-up (boot, play, man the banking hall from 160 m out)
  // lives inside the FIRST subject's evaluate, so this is a first-plate budget.
  stageTimeoutMs: 900000,
  metricsNote: "Measured inside each build while its plate was staged: CBZ.cityKeysAudit(), CBZ.vaultAudit(), CBZ.holdAudit() and CBZ.propVaultAudit() — plus, for the money in your own vault, CBZ.cityTill.holds() asked of the vault's own declared till source rather than of this file's bookkeeping.",
  metrics: {
    keysOnPeds: { label: "Vault keys carried by people", better: "higher" },
    keysHeld: { label: "Keys in the player's inventory", better: "higher" },
    vaultOpensByKey: { label: "Vaults opened by turning a key", better: "higher" },
    bagsOnVaultFloor: { label: "Duffels on the bank vault floor", better: "higher" },
    bagsInHold: { label: "Duffels strapped in a road vehicle", better: "higher" },
    bagsInOwnedVault: { label: "Duffels on your own vault's shelves", better: "higher" },
    ownedVaultDollars: { label: "Dollars in a vault you own", unit: "$", better: "higher" },
    ownedVaultsBuilt: { label: "Vaults you bought and that stand", better: "higher" },
    ledgerInYourVault: { label: "…the same figure, read off CBZ.cityTill", unit: "$", better: "higher" },
    drawCalls: { label: "Draw calls", better: "lower" },
  },
  subjects,
  stage: stageLoop,
};
