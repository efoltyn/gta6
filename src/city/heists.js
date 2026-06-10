/* ============================================================
   city/heists.js — planned ROBBERIES / big scores (the marquee get-rich loop).

   A ladder of scores by risk/reward, each a real little arc:

     CASE  → walk up to a target (or call a plan from the [H]eist board),
             pay a small SETUP cost (masks/tools/intel), pick your crew cut.
     HIT   → an EXECUTE phase: grab the bag over a few seconds while a heat
             METER fills. Witnesses panic, alarms trip, cops roll in. Stay in
             the take-zone; leaving early banks only what you've grabbed.
     RUN   → an ESCAPE phase: get clear of the cops and drop your stars to
             BANK the score. Get busted or downed mid-job and you lose the bag.

   PAYOUT = target tier  ×  how much of the bag you grabbed
            + a CREW bonus (your recruited crew / companions raise the cut)
            + a RISK premium for the hotter, harder targets
            − whatever you dropped by bailing early.
   The score feeds cash, respect, and (if you run a crew) a cut up to the
   gang treasury. This is the high-end faucet that funds the kingpin climb.

   Research basis (GTA V / GTA Online robbery + heist design): convenience-
   store stick-ups (fast, ~1-2★), jewelry smash-and-grabs, armored-truck
   cracks (any hit = instant 3★, lose the cops to keep the bag), and the
   multi-phase bank finale (setup fee, crew cut split, big take + heavy heat).

   Self-contained: owns its own [H] board, a floating progress HUD, and one
   CBZ.onUpdate loop (gated to city). Touches only feature-detected CBZ.*.
   Public API: CBZ.cityStartHeist(tierId) / CBZ.cityHeistState() /
   CBZ.cityHeistTargets() / CBZ.cityAbortHeist().
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;
  const THREE = window.THREE;

  // ------------------------------------------------------------------ helpers
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s || 2); }
  function big(m) { if (CBZ.city && CBZ.city.big) CBZ.city.big(m); }
  function sfx(n) { if (CBZ.sfx) CBZ.sfx(n); }
  function fmt$(n) { return "$" + Math.round(n).toLocaleString(); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function dist2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

  // your live, helping crew on the street: recruited crew + companions in reach.
  // More bodies on the job = a bigger, safer grab and a fatter cut (GTA crew cut).
  function crewOnHand() {
    let n = 0;
    const peds = CBZ.cityPeds;
    if (peds && peds.length) {
      const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
      for (let i = 0; i < peds.length; i++) {
        const p = peds[i];
        if (p.dead) continue;
        const mine = (p.recruited && p.kind === "crew") || (p.companion && p.faction === "player") || p === g.cityPartner;
        if (!mine) continue;
        if (dist2(px, pz, p.pos.x, p.pos.z) < 24) n++;
      }
    }
    // fall back to the tracked count if the ped scan found nobody (saved state)
    if (!n && g.cityCrew) n = Math.min(4, g.cityCrew | 0);
    return Math.min(4, n);            // cap the bonus at a 4-strong crew
  }

  // a crew bonus multiplier on the take (each body ~ +14%, capped)
  function crewMul(crew) { return 1 + 0.14 * (crew || 0); }

  // your standing premium: respect + wealth tier make targets pay a touch more
  // (you've got the rep to fence a bigger bag). Small, logic-driven, not a cheat.
  function repPremium() {
    const resp = g.respect || 0;
    let m = 1 + Math.min(0.35, resp / 4000);
    if (CBZ.cityWealthTier) { try { const t = CBZ.cityWealthTier(); if (t && t.mult) m *= clamp(t.mult, 1, 1.4); } catch (e) {} }
    return m;
  }

  // do you have a gun? armed jobs go smoother / are required for the big scores.
  function hasGun() { return !!(CBZ.cityOwnsGun && CBZ.cityOwnsGun()); }

  // ------------------------------------------------------------ the score ladder
  // Each TIER is a real escalation in take, setup cost, heat, and crew need.
  //   take      : base bag size before crew/rep multipliers + grab fraction
  //   setup     : up-front cost (masks/tools/intel) — never refunded (GTA set-up fee)
  //   stars     : the wanted tier the EXECUTE phase drives you to
  //   grabTime  : seconds to fully empty the bag during EXECUTE
  //   heatRate  : how fast the heat meter fills while you grab (drives cops)
  //   minCrew   : crew strongly recommended (you can solo, but it's leaner+hotter)
  //   gun       : requires a firearm to attempt
  //   kinds     : which shop lot kinds this score can target (null = special)
  const TIERS = [
    {
      id: "store", name: "Corner-Store Stick-Up", icon: "🏪", tier: 1,
      take: 900, setup: 0, stars: 1, grabTime: 5, heatRate: 22, minCrew: 0, gun: false,
      kinds: ["food", "gas", "barber", "gym", "hardware"],
      desc: "Quick register grab. Low take, low heat (1-2★). No crew needed.",
    },
    {
      id: "liquor", name: "Liquor / Pawn Smash-&-Grab", icon: "🥃", tier: 2,
      take: 2600, setup: 120, stars: 2, grabTime: 7, heatRate: 30, minCrew: 1, gun: false,
      kinds: ["bar", "pawn", "drugs", "clothing", "electronics"],
      desc: "Smash the cases, fill the bag. 2-3★. A second body speeds the grab.",
    },
    {
      id: "jewelry", name: "Jewelry-Store Heist", icon: "💎", tier: 3,
      take: 7500, setup: 400, stars: 3, grabTime: 10, heatRate: 40, minCrew: 2, gun: true,
      kinds: ["jewelry", "casino"],
      desc: "Armed smash-and-grab on the cases. 3★, armed guards, crew strongly advised.",
    },
    {
      id: "armored", name: "Armored-Truck Crack", icon: "🚚", tier: 4,
      take: 14000, setup: 600, stars: 3, grabTime: 9, heatRate: 55, minCrew: 1, gun: true,
      kinds: null,            // spawns its own truck near you
      desc: "Pop the cash truck. Any hit = instant 3★. Crack it, grab the cases, vanish.",
    },
    {
      id: "bank", name: "BANK JOB", icon: "🏦", tier: 5,
      take: 45000, setup: 2500, stars: 5, grabTime: 16, heatRate: 70, minCrew: 3, gun: true,
      kinds: ["bank"],
      desc: "The big score. Drill the vault, fill the bags. 4-5★, full police response. Bring a crew.",
    },
  ];
  function tierById(id) { return TIERS.find((t) => t.id === id) || null; }

  // ------------------------------------------------------------ lazy state
  function ensure() {
    if (!g.cityHeist) {
      g.cityHeist = {
        phase: "idle",       // idle | case | execute | escape
        tierId: null,
        target: null,        // { x, z, name, lotKind } the spot being hit
        bag: 0,              // $ grabbed so far this execute
        bagMax: 0,           // total bag this score
        grabbed: 0,          // 0..1 fraction of the bag emptied
        t: 0,                // seconds in the current phase
        heat: 0,             // 0..1 local heist heat (drives cop spawns/stars)
        crew: 0,             // crew strength locked in at case time
        cut: 0.7,            // your cut (1 - what goes to the crew/treasury)
        downed: false,
        completed: 0,        // lifetime scores pulled (for scaling/flavor)
        biggest: 0,          // biggest single take ever
        cooldown: 0,         // seconds until the next score can START
      };
    }
    return g.cityHeist;
  }

  function reset() {
    cleanupTruck();
    const h = ensure();
    h.phase = "idle"; h.tierId = null; h.target = null;
    h.bag = 0; h.bagMax = 0; h.grabbed = 0; h.t = 0; h.heat = 0;
    h.crew = 0; h.cut = 0.7; h.downed = false; h.cooldown = 0;
    hideHud();
  }
  CBZ.cityHeistReset = reset;

  // mode.js calls CBZ.cityWantedReset() on every fresh city life but doesn't know
  // about us (it's off-limits). Wrap it so a new run always clears any stale,
  // mid-job heist state — without touching mode.js. Idempotent + feature-detected.
  function hookRunReset() {
    if (!CBZ.cityWantedReset || CBZ.cityWantedReset._heistWrapped) return;
    const orig = CBZ.cityWantedReset;
    const wrapped = function () { const r = orig.apply(this, arguments); try { reset(); } catch (e) {} return r; };
    wrapped._heistWrapped = true;
    CBZ.cityWantedReset = wrapped;
  }
  hookRunReset();
  // wanted.js may define cityWantedReset after us; retry briefly until it exists.
  if (!CBZ.cityWantedReset) { const iv = setInterval(function () { if (CBZ.cityWantedReset) { hookRunReset(); clearInterval(iv); } }, 0); }

  // ------------------------------------------------------------ target finding
  // the nearest robbable shop lot of a given tier's kinds, within reach.
  function nearestLotFor(tier, maxd) {
    const A = CBZ.city && CBZ.city.arena;
    const lots = A && (A.shopLots || A.lots);
    if (!lots || !tier.kinds) return null;
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
    let best = null, bd = maxd || 7;
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      if (!lot || !lot.building) continue;
      const kind = (lot.building.shop && lot.building.shop.kind) || lot.kind;
      if (tier.kinds.indexOf(kind) < 0) continue;
      const d = dist2(px, pz, lot.cx, lot.cz);
      if (d < bd) { bd = d; best = lot; }
    }
    return best;
  }

  // is the player standing on/over any robbable lot of a tier right now?
  function lotKindHere() {
    const A = CBZ.city && CBZ.city.arena;
    const lots = A && (A.shopLots || A.lots);
    if (!lots) return null;
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      if (!lot || !lot.building) continue;
      const kind = (lot.building.shop && lot.building.shop.kind) || lot.kind;
      const w = (lot.w || 10) * 0.6, d = (lot.d || 10) * 0.6;
      if (Math.abs(px - lot.cx) < w && Math.abs(pz - lot.cz) < d) return { kind, lot };
    }
    return null;
  }

  // which tiers can be CASED from where the player is standing right now?
  function availableHere() {
    const out = [];
    const here = lotKindHere();
    const nearKind = here ? here.kind : null;
    for (const t of TIERS) {
      if (t.id === "armored") { out.push({ tier: t, ready: true, target: null }); continue; }
      if (!t.kinds) continue;
      const lot = nearestLotFor(t, 8);
      const onIt = nearKind && t.kinds.indexOf(nearKind) >= 0;
      out.push({ tier: t, ready: !!(lot || onIt), target: lot || (here && t.kinds.indexOf(nearKind) >= 0 ? here.lot : null) });
    }
    return out;
  }
  CBZ.cityHeistTargets = availableHere;

  // ------------------------------------------------------------ armored truck prop
  let truckMesh = null, truckObj = null;
  function spawnTruck() {
    cleanupTruck();
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.root || !THREE) return null;
    // place it a short way out on the street in front of the player
    const y = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(y), fz = -Math.cos(y);
    const px = CBZ.player.pos.x + fx * 9, pz = CBZ.player.pos.z + fz * 9;
    const gy = (CBZ.floorAt ? CBZ.floorAt(px, pz) : 0) || 0;
    const grp = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 2.6, 5.2),
      new THREE.MeshLambertMaterial({ color: 0x3a4654 })
    );
    body.position.y = 1.5;
    grp.add(body);
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, 1.6, 1.8),
      new THREE.MeshLambertMaterial({ color: 0x222a33 })
    );
    cab.position.set(0, 1.4, 3.0);
    grp.add(cab);
    // cash-door (the bit you crack) — glows when being worked
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x6b5320, emissive: 0x000000 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.9, 0.2), doorMat);
    door.position.set(0, 1.4, -2.7);
    grp.add(door);
    grp.position.set(px, gy, pz);
    grp.rotation.y = y;
    A.root.add(grp);
    truckMesh = grp;
    truckObj = { x: px, z: pz, door: door, doorMat: doorMat, body: body };
    return truckObj;
  }
  function cleanupTruck() {
    if (truckMesh && truckMesh.parent) truckMesh.parent.remove(truckMesh);
    truckMesh = null; truckObj = null;
  }

  // ------------------------------------------------------------ HUD (own panel)
  let hud = null;
  function buildHud() {
    if (hud) return;
    hud = document.createElement("div");
    hud.id = "cityHeistHud";
    hud.style.cssText =
      "position:fixed;left:50%;top:14%;transform:translateX(-50%);z-index:60;" +
      "min-width:280px;max-width:420px;padding:12px 16px;border-radius:12px;" +
      "background:rgba(12,14,20,.86);border:1px solid #2c3140;color:#e8eef7;" +
      "font:600 14px/1.35 system-ui,Segoe UI,Roboto,sans-serif;" +
      "box-shadow:0 8px 30px rgba(0,0,0,.5);display:none;text-align:center;" +
      "pointer-events:none;backdrop-filter:blur(3px)";
    document.body.appendChild(hud);
  }
  function showHud() { buildHud(); hud.style.display = "block"; }
  function hideHud() { if (hud) hud.style.display = "none"; }
  function renderHud() {
    const h = g.cityHeist; if (!h || h.phase === "idle") { hideHud(); return; }
    buildHud();
    const tier = tierById(h.tierId);
    let html = "";
    if (h.phase === "case") {
      html =
        "<div style='font-size:16px;color:#ffd479'>" + (tier ? tier.icon + " " + tier.name : "Casing") + "</div>" +
        "<div style='margin-top:6px;font-weight:500;color:#aeb8c6'>Get in position, then start the grab.</div>" +
        "<div style='margin-top:8px'><span style='color:#7ed957'>[H]</span> GO LOUD — start the grab" +
        "&nbsp;&nbsp;<span style='color:#ff9a9a'>[K]</span> back out</div>";
    } else if (h.phase === "execute") {
      const pct = Math.round(h.grabbed * 100);
      const heatPct = Math.round(h.heat * 100);
      html =
        "<div style='font-size:16px;color:#ff9e6b'>" + (tier ? tier.icon + " GRABBING — " + tier.name : "GRABBING") + "</div>" +
        bar("BAG", pct, "#7ed957") +
        "<div style='margin-top:4px;font-weight:500'>" + fmt$(h.bag) + " in the bag</div>" +
        bar("HEAT", heatPct, heatPct > 70 ? "#ff5b5b" : "#ffb347") +
        "<div style='margin-top:6px;font-weight:500;color:#aeb8c6'>Stay on it. <span style='color:#ffd479'>[H]</span> grab &amp; GO with what you've got</div>";
    } else if (h.phase === "escape") {
      const stars = g.wanted | 0;
      html =
        "<div style='font-size:16px;color:#ff5b5b'>🏃 GET CLEAR WITH " + fmt$(h.bag) + "</div>" +
        "<div style='margin-top:6px;font-weight:500;color:#aeb8c6'>" +
        (stars > 0 ? "Lose the cops (" + "★".repeat(stars) + ") to BANK the score." : "You're clean — banking the take…") +
        "</div>" +
        "<div style='margin-top:6px;font-weight:500'>Mask up <span style='color:#ffd479'>[T]</span>, break line of sight, lay low.</div>";
    }
    hud.innerHTML = html;
    showHud();
  }
  function bar(label, pct, color) {
    return "<div style='margin-top:8px;text-align:left;font-size:11px;color:#8a93a3'>" + label +
      "<div style='margin-top:2px;height:8px;border-radius:4px;background:#1b2029;overflow:hidden'>" +
      "<div style='height:100%;width:" + clamp(pct, 0, 100) + "%;background:" + color + ";transition:width .15s'></div></div></div>";
  }

  // ------------------------------------------------------------ the planning board
  let board = null;
  function buildBoard() {
    if (board) return;
    board = document.createElement("div");
    board.id = "cityHeistBoard";
    board.style.cssText =
      "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:120;" +
      "width:min(560px,92vw);max-height:84vh;overflow:auto;padding:18px 20px;border-radius:16px;" +
      "background:rgba(14,16,22,.96);border:1px solid #2c3140;color:#e8eef7;" +
      "font:600 14px/1.4 system-ui,Segoe UI,Roboto,sans-serif;box-shadow:0 16px 60px rgba(0,0,0,.6);display:none";
    document.body.appendChild(board);
    board.addEventListener("click", function (e) {
      const close = e.target.closest && e.target.closest(".hb-close");
      if (close) { hideBoard(); return; }
      const card = e.target.closest && e.target.closest(".hb-card");
      if (card && card.dataset.id && !card.classList.contains("locked")) { startCase(card.dataset.id); hideBoard(); }
    });
  }
  function renderBoard() {
    buildBoard();
    const h = ensure();
    const here = availableHere();
    const crew = crewOnHand();
    const rows = TIERS.map((t) => {
      const a = here.find((x) => x.tier.id === t.id);
      const ready = a && a.ready;
      const needGun = t.gun && !hasGun();
      const needCrew = t.minCrew > crew;
      const canStart = ready && !needGun && h.phase === "idle" && h.cooldown <= 0;
      const est = Math.round(t.take * crewMul(Math.min(crew, 4)) * repPremium());
      let why = "";
      if (h.cooldown > 0) why = "lay low (" + Math.ceil(h.cooldown) + "s)";
      else if (!ready) why = t.id === "armored" ? "stand on a street" : "walk up to a " + (t.kinds[0]) + "-type spot";
      else if (needGun) why = "needs a gun";
      else if (needCrew) why = "better with " + t.minCrew + "+ crew (you: " + crew + ")";
      const lock = canStart ? "" : " locked";
      const fee = t.setup ? fmt$(t.setup) + " setup" : "no setup";
      return "<button class='hb-card" + lock + "' data-id='" + t.id + "' style='" +
        "display:block;width:100%;text-align:left;margin:8px 0;padding:12px 14px;border-radius:12px;" +
        "border:1px solid " + (canStart ? "#3a4a36" : "#2c3140") + ";background:" + (canStart ? "rgba(40,60,38,.5)" : "rgba(30,34,42,.6)") + ";" +
        "color:#e8eef7;cursor:" + (canStart ? "pointer" : "default") + ";opacity:" + (canStart ? "1" : ".6") + "'>" +
        "<div style='display:flex;justify-content:space-between;align-items:center'>" +
        "<span style='font-size:15px'>" + t.icon + " " + t.name + "</span>" +
        "<span style='color:#7ed957;font-size:13px'>~" + fmt$(est) + "</span></div>" +
        "<div style='margin-top:4px;font-weight:500;color:#aeb8c6;font-size:12px'>" + t.desc + "</div>" +
        "<div style='margin-top:6px;font-size:11px;color:#8a93a3'>" +
        "★".repeat(t.stars) + " heat · " + fee + " · " + (t.gun ? "armed" : "unarmed-ok") +
        (canStart ? " · <span style='color:#7ed957'>READY</span>" : " · <span style='color:#ff9e6b'>" + why + "</span>") +
        "</div></button>";
    }).join("");
    board.innerHTML =
      "<div style='display:flex;justify-content:space-between;align-items:flex-start'>" +
      "<div><div style='font-size:18px;color:#ffd479'>🎯 SCORE BOARD</div>" +
      "<div style='font-weight:500;color:#9fb0c6;font-size:12px;margin-top:2px'>Case a target, hit it, lose the heat, bank the bag.</div></div>" +
      "<button class='hb-close' style='background:none;border:1px solid #2c3140;color:#aeb8c6;border-radius:8px;padding:6px 12px;cursor:pointer'>Close</button></div>" +
      "<div style='margin-top:6px;font-size:12px;color:#8a93a3'>Crew on hand: <b style='color:#7fd0ff'>" + crew + "</b>" +
      (crew ? " (+" + Math.round((crewMul(crew) - 1) * 100) + "% take, " + Math.round((1 - cutForCrew(crew)) * 100) + "% goes to the crew)" : " — recruit a crew to pull the big scores") +
      "</div>" + rows +
      "<div style='margin-top:12px;font-size:11px;color:#8a93a3;border-top:1px solid #2c3140;padding-top:8px'>" +
      "Lifetime scores: " + (h.completed || 0) + " · biggest take: " + fmt$(h.biggest || 0) + "</div>";
  }
  function showBoard() {
    if (g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.player.driving) { note("Get out of the car to plan a score.", 1.6); return; }
    if (CBZ.cityCloseShop) CBZ.cityCloseShop();
    renderBoard();
    board.style.display = "block";
    CBZ.cityMenuOpen = true;
    if (document.exitPointerLock) try { document.exitPointerLock(); } catch (e) {}
  }
  function hideBoard() {
    if (!board) return;
    board.style.display = "none";
    CBZ.cityMenuOpen = false;
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }

  // your cut shrinks as the crew grows (they earn a share) but the bigger bag
  // more than makes up for it — classic GTA crew-cut math.
  function cutForCrew(crew) { return clamp(0.78 - 0.06 * (crew || 0), 0.5, 0.9); }

  // ------------------------------------------------------------ phase: CASE
  function startCase(tierId) {
    const h = ensure();
    if (h.phase !== "idle") { note("Finish the job you're on first.", 1.6); return; }
    if (h.cooldown > 0) { note("Too hot — lay low for " + Math.ceil(h.cooldown) + "s.", 1.6); return; }
    const tier = tierById(tierId); if (!tier) return;
    if (tier.gun && !hasGun()) { note("You need a gun for that score.", 1.8); sfx("glass"); return; }

    // pin the target spot
    let target = null;
    if (tier.id === "armored") {
      const t = spawnTruck();
      if (!t) { note("No room on the street for the truck — try elsewhere.", 1.8); return; }
      target = { x: t.x, z: t.z, name: "Armored Truck", lotKind: null, truck: true };
    } else {
      const lot = nearestLotFor(tier, 9) || (lotKindHere() && tier.kinds.indexOf(lotKindHere().kind) >= 0 ? lotKindHere().lot : null);
      if (!lot) { note("Walk up to a " + tier.kinds[0] + "-type spot to case it.", 2); return; }
      const kind = (lot.building.shop && lot.building.shop.kind) || lot.kind;
      const name = (lot.building.name) || (kind + " store");
      target = { x: lot.cx, z: lot.cz, name: name, lotKind: kind };
    }

    // SETUP FEE (masks/tools/intel) — never refunded, GTA-style.
    if (tier.setup > 0) {
      if (!CBZ.city.canAfford(tier.setup)) { note("Setup costs " + fmt$(tier.setup) + " (masks, tools, intel).", 2); sfx("glass"); cleanupTruck(); return; }
      CBZ.city.spend(tier.setup);
      note("Paid " + fmt$(tier.setup) + " to set it up.", 1.6);
    }

    const crew = crewOnHand();
    h.phase = "case";
    h.tierId = tier.id;
    h.target = target;
    h.crew = crew;
    h.cut = cutForCrew(crew);
    h.bagMax = Math.round(tier.take * crewMul(crew) * repPremium() * rnd(0.85, 1.15));
    h.bag = 0; h.grabbed = 0; h.t = 0; h.heat = 0; h.downed = false;

    sfx("door");
    big(tier.icon + " CASING: " + tier.name);
    note("In position? Press [H] to GO LOUD. Crew on hand: " + crew + ".", 2.6);
    renderHud();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  CBZ.cityStartHeist = function (tierId) { if (tierId) startCase(tierId); else showBoard(); };

  // ------------------------------------------------------------ phase: EXECUTE
  function goLoud() {
    const h = ensure(); if (h.phase !== "case") return;
    const tier = tierById(h.tierId); if (!tier) return;
    // must be near the target to kick it off
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
    if (h.target && dist2(px, pz, h.target.x, h.target.z) > 14) { note("Get closer to the target first.", 1.6); return; }
    h.phase = "execute"; h.t = 0;
    sfx(tier.id === "store" ? "report" : "alarm");
    big(tier.icon + " THIS IS A ROBBERY!");
    // panic + a first crime report so the block reacts and cops start rolling
    const x = h.target.x, z = h.target.z;
    if (CBZ.cityAlarm) CBZ.cityAlarm(x, z, 26, 1.4, CBZ.city.playerActor);
    if (CBZ.cityPanic) CBZ.cityPanic(x, z, 1.6, CBZ.city.playerActor);
    const crimeType = tier.id === "armored" ? "armed-robbery" : tier.id === "bank" ? "robbery" : "armed-robbery";
    if (CBZ.cityCrime) CBZ.cityCrime(180, { instant: true, x: x, z: z, type: crimeType });
    if (CBZ.shake) CBZ.shake(0.4);
    if (truckObj && truckObj.doorMat) truckObj.doorMat.emissive.setHex(0x3a2a00);
    renderHud();
  }

  // bank what's grabbed so far and move to ESCAPE (or finish clean)
  function grabAndGo() {
    const h = ensure(); if (h.phase !== "execute") return;
    h.phase = "escape"; h.t = 0;
    const tier = tierById(h.tierId);
    if (truckObj && truckObj.doorMat) truckObj.doorMat.emissive.setHex(0x000000);
    big("🏃 GO GO GO — " + fmt$(h.bag) + " in the bag!");
    sfx("whoosh");
    note("Lose the cops to BANK the score. Drop the bag if you get busted.", 2.6);
    renderHud();
  }

  // ------------------------------------------------------------ resolve
  function bankScore() {
    const h = ensure();
    const tier = tierById(h.tierId);
    const take = Math.round(h.bag);
    if (take <= 0) { abort("Nothing in the bag — score's a bust."); return; }
    const yourCut = Math.round(take * h.cut);
    const crewCut = take - yourCut;
    CBZ.city.addCash(yourCut);
    sfx("coin");
    // crew cut → up to the player's gang treasury (funds wars/expansion)
    if (crewCut > 0 && CBZ.cityPlayerGangExists && CBZ.cityPlayerGangExists() && g.playerGang) {
      g.playerGang.treasury = (g.playerGang.treasury || 0) + crewCut;
    } else if (crewCut > 0) {
      // no gang yet — the crew share still comes to you (you ARE the crew)
      CBZ.city.addCash(crewCut);
    }
    // respect + lifetime stats scale with the tier
    const resp = (tier ? tier.tier : 1) * 6 + Math.round(take / 1200);
    if (CBZ.city.addRespect) CBZ.city.addRespect(resp);
    h.completed = (h.completed || 0) + 1;
    if (take > (h.biggest || 0)) h.biggest = take;
    big("💰 SCORE BANKED: " + fmt$(yourCut) + (crewCut > 0 ? " (+" + fmt$(crewCut) + " crew cut)" : ""));
    note("+" + resp + " respect · biggest take: " + fmt$(h.biggest), 2.6);
    if (CBZ.cityEvent) CBZ.cityEvent("heist-banked", { tier: tier ? tier.id : "?", take: take, crew: h.crew }, { silent: true, noWanted: true });
    // a brief cooldown so you can't chain bank jobs back-to-back
    const cd = tier ? 6 + tier.tier * 4 : 8;
    finish(cd);
  }

  function abort(msg) {
    const h = ensure();
    cleanupTruck();
    if (msg) note(msg, 2);
    finish(4);
  }
  CBZ.cityAbortHeist = function () { const h = ensure(); if (h.phase !== "idle") abort("Backed out of the score."); };

  // failed: busted/downed mid-job → you LOSE the bag entirely
  function fail(reason) {
    const h = ensure();
    cleanupTruck();
    big("💥 SCORE BLOWN — " + reason);
    note("Lost the bag (" + fmt$(h.bag) + "). Heal up and try again.", 2.8);
    sfx("glass");
    finish(10);
  }

  function finish(cooldown) {
    const h = ensure();
    cleanupTruck();
    h.phase = "idle"; h.tierId = null; h.target = null;
    h.bag = 0; h.bagMax = 0; h.grabbed = 0; h.t = 0; h.heat = 0; h.crew = 0; h.downed = false;
    h.cooldown = cooldown || 0;
    hideHud();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // public read for HUD / interaction / other systems
  CBZ.cityHeistState = function () {
    const h = ensure();
    return { phase: h.phase, tier: h.tierId, bag: Math.round(h.bag), bagMax: h.bagMax, grabbed: h.grabbed, heat: h.heat, crew: h.crew, cooldown: h.cooldown, completed: h.completed, biggest: h.biggest };
  };

  // ------------------------------------------------------------ per-frame loop
  let promptT = 0;
  CBZ.onUpdate(40, function (dt) {
    if (g.mode !== "city") { if (hud && hud.style.display !== "none") hideHud(); return; }
    const h = ensure();

    // cooldown bleeds off whenever you're not mid-job
    if (h.phase === "idle") {
      if (h.cooldown > 0) h.cooldown = Math.max(0, h.cooldown - dt);
      // ambient prompt: when you stand near a casable target, nudge [H]
      promptT += dt;
      if (g.state === "playing" && !CBZ.player.dead && !CBZ.cityMenuOpen && !CBZ.player.driving && promptT > 1.2) {
        promptT = 0;
        if (h.cooldown <= 0) {
          const here = availableHere();
          const ready = here.find((a) => a.ready && a.tier.id !== "armored" && (!a.tier.gun || hasGun()));
          if (ready && Math.random() < 0.5) note("💡 You could case this " + (ready.tier.kinds[0]) + " — press [H].", 1.6);
        }
      }
      return;
    }

    // player went down or got busted mid-job → blow the score
    if (CBZ.player.dead || g.busted) { fail(CBZ.player.dead ? "you were downed" : "you got busted"); return; }

    h.t += dt;
    const tier = tierById(h.tierId);
    if (!tier) { finish(0); return; }
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
    const tgt = h.target;
    const inZone = tgt ? dist2(px, pz, tgt.x, tgt.z) < 11 : false;

    if (h.phase === "case") {
      // auto-cancel if you wander far off (you've abandoned the plan)
      if (tgt && dist2(px, pz, tgt.x, tgt.z) > 40) { abort("Walked away from the target — plan's off."); return; }
      // refresh the truck visual cue
      return;
    }

    if (h.phase === "execute") {
      // you must stay in the take-zone to keep grabbing. Crew speeds it up.
      if (inZone) {
        const crewSpeed = 1 + 0.18 * h.crew;
        const dGrab = (dt / tier.grabTime) * crewSpeed;
        const prev = h.grabbed;
        h.grabbed = clamp(h.grabbed + dGrab, 0, 1);
        h.bag += (h.grabbed - prev) * h.bagMax;
        // heat climbs while you grab → drives cops + escalates stars
        h.heat = clamp(h.heat + (tier.heatRate / 100) * dt * 0.5, 0, 1);
        // ramp the wanted level toward the tier's ceiling as heat builds
        const wantTarget = Math.min(tier.stars, 1 + Math.round(h.heat * tier.stars));
        if (CBZ.cityForceStars && (g.wanted | 0) < wantTarget) CBZ.cityForceStars(wantTarget);
        // periodic alarm/panic pulses + a cop spawn as it gets hot
        if (Math.random() < dt * (0.4 + h.heat)) {
          if (CBZ.cityPanic) CBZ.cityPanic(tgt.x, tgt.z, 1.0, CBZ.city.playerActor);
        }
        if (Math.random() < dt * (0.25 + h.heat * 0.6) && CBZ.citySpawnCop) {
          const ang = Math.random() * Math.PI * 2, r = 28 + Math.random() * 14;
          CBZ.citySpawnCop(tgt.x + Math.cos(ang) * r, tgt.z + Math.sin(ang) * r, h.heat > 0.7);
          if (Math.random() < 0.4) sfx("siren");
        }
        if (CBZ.shake && Math.random() < dt * 1.2) CBZ.shake(0.12);
        // bag full → auto-advance to escape
        if (h.grabbed >= 1) { note("Bag's full!", 1.2); grabAndGo(); }
      } else {
        // out of the zone mid-grab: not banking; nudge them back in
        if (Math.random() < dt * 2) note("Get back on the target to keep grabbing!", 1.0);
      }
      if (h.t > tier.grabTime * 2.6) { note("Cops are swarming — GO with what you've got!", 1.4); grabAndGo(); }
      renderHud();
      return;
    }

    if (h.phase === "escape") {
      // banking happens when you've SHAKEN the cops (stars back to 0) OR you
      // started clean. We watch g.wanted; when it hits 0 you keep the bag.
      const stars = g.wanted | 0;
      if (stars <= 0) {
        // small grace so the "you're clean" line shows before the payout pops
        if (h._clearT == null) h._clearT = 0;
        h._clearT += dt;
        if (h._clearT > 1.0) { h._clearT = null; bankScore(); return; }
      } else {
        h._clearT = null;
      }
      renderHud();
      return;
    }
  });

  // ------------------------------------------------------------ input: [H]
  // [H] is the heist key. Realestate.js uses [H] too (home menu), but only when
  // NO menu is open and you're not driving — we run FIRST priority while a heist
  // is live or a casable target is in reach, otherwise we yield to it.
  addEventListener("keydown", function (e) {
    if (g.mode !== "city" || g.state !== "playing") return;
    if (e.repeat) return;
    const k = (e.key || "").toLowerCase();

    // [K] backs out of a cased/queued score (the board uses its own clicks)
    if (k === "k" && !CBZ.cityMenuOpen) {
      const h = ensure();
      if (h.phase === "case") { e.preventDefault(); abort("Backed out of the score."); return; }
    }

    if (k !== "h") return;
    if (CBZ.cityMenuOpen) return;            // a menu (incl. our board) owns input
    if (CBZ.player.driving) return;          // realestate/other systems handle driving

    const h = ensure();
    // mid-job: [H] advances the arc (case→execute→grab&go)
    if (h.phase === "case") { e.preventDefault(); e.stopImmediatePropagation(); goLoud(); return; }
    if (h.phase === "execute") { e.preventDefault(); e.stopImmediatePropagation(); grabAndGo(); return; }
    if (h.phase === "escape") { return; }    // nothing to press; just run

    // idle: if a casable score is in reach, open the board (preempt home menu);
    // otherwise let realestate.js handle [H] for the home menu. But if you're at
    // your OWN front door, yield to the safehouse menu — that's clearly intended.
    if (h.cooldown <= 0) {
      const atHome = CBZ.cityHomeNear && CBZ.cityHomeNear(CBZ.player.pos.x, CBZ.player.pos.z);
      if (atHome) return;
      const here = availableHere();
      const anyReady = here.some((a) => a.ready);
      if (anyReady) { e.preventDefault(); e.stopImmediatePropagation(); showBoard(); return; }
    }
    // no score nearby → don't consume the key (home menu / others may use it)
  }, true);   // capture phase so we can preempt realestate's [H] when relevant
})();
