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

  // is ANY live cop currently SEEING the player? (close + clear line of sight) —
  // this is what the dye-pack/bait clock watches: break their LOS to "go dark"
  // and the rigged cash survives; stay in the open and it blows. Cheap: a short
  // ranged scan that early-outs, run only during a bank getaway.
  function copSeesPlayer() {
    const cops = CBZ.cityCops; if (!cops || !cops.length) return false;
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z, py = (CBZ.player.pos.y || 0) + 1.4;
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i];
      if (!c || c.dead) continue;
      const dx = c.pos.x - px, dz = c.pos.z - pz;
      if (dx * dx + dz * dz > 26 * 26) continue;
      if (!CBZ.clearLineOfFire || CBZ.clearLineOfFire(c.pos.x, (c.pos.y || 0) + 1.5, c.pos.z, px, py, pz)) return true;
    }
    return false;
  }

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
      // VAULT is the real prize: a branch realistically holds tens of thousands to
      // a couple hundred grand in its cash vault (small branches ~$50k, larger up
      // to ~$200k+; teller drawers add a few thousand). `take` here is the bag you
      // can REALISTICALLY pull before the response overwhelms you — you almost
      // never empty the whole vault. The vault TOTAL (what's drillable given more
      // exposure) is bankVaultTotal; your haul = how deep you drill into it.
      take: 60000, setup: 4000, stars: 4, grabTime: 26, heatRate: 64, minCrew: 3, gun: true,
      kinds: ["bank"],
      // bank-specific score config (only the BANK tier reads these):
      bank: true,
      vaultTotal: [120000, 250000],  // the cash vault's full holdings (research band)
      drillTime: 9,                  // seconds to BREACH the vault before you can bag a cent
      getaway: 14,                   // dye-pack/bait window: clear LOS this fast or it burns
      dyeFrac: [0.14, 0.26],         // fraction of the bag rigged to burn if you're caught slow
      guards: 2,                     // armed security inside who resist
      desc: "The big score. Drill the steel vault, bag the cash, beat the dye-pack clock. Silent alarm = cops already rolling; heavy 4★ response (5★ if you start dropping cops). Bring a crew.",
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
        // --- BANK-score sub-state (only set/used while a bank job is live) ---
        drilled: 0,          // 0..1 vault BREACH progress (must hit 1 before grabbing)
        vaultTotal: 0,       // this job's full vault holdings (you bag a fraction)
        getaway: 0,          // seconds left on the dye-pack/bait clock once you're loaded
        getawayMax: 0,       // the window length, for the HUD bar
        dyeFrac: 0,          // fraction of THIS bag rigged to burn
        dyed: false,         // has the dye pack already blown (chunk burned)?
        guards: [],          // armed security we spawned (cleaned up on finish)
        silent: false,       // silent alarm tripped (cops pre-dispatched)
      };
    }
    return g.cityHeist;
  }

  // ---- BANK guards: armed security INSIDE the bank who resist the robbery.
  // We reuse the city's own cop rig (already armed, shootable, hostile + LOS-
  // gated) as private security — spawned at the vault when you go loud, torn
  // down when the score ends so they never leak into the ambient police count.
  function cleanupGuards() {
    const h = g.cityHeist; if (!h || !h.guards || !h.guards.length) return;
    const cops = CBZ.cityCops;
    for (let i = 0; i < h.guards.length; i++) {
      const gd = h.guards[i];
      if (!gd) continue;
      // mark dead + remove from the world if still standing (clean exit)
      if (!gd.dead) {
        gd.dead = true;
        if (gd.group && gd.group.parent) try { gd.group.parent.remove(gd.group); } catch (e) {}
        if (cops) { const ix = cops.indexOf(gd); if (ix >= 0) cops.splice(ix, 1); }
      }
    }
    h.guards.length = 0;
  }

  function reset() {
    cleanupTruck();
    cleanupGuards();
    const h = ensure();
    h.phase = "idle"; h.tierId = null; h.target = null;
    h.bag = 0; h.bagMax = 0; h.grabbed = 0; h.t = 0; h.heat = 0;
    h.crew = 0; h.cut = 0.7; h.downed = false; h.cooldown = 0;
    h.drilled = 0; h.vaultTotal = 0; h.getaway = 0; h.getawayMax = 0;
    h.dyeFrac = 0; h.dyed = false; h.silent = false;
    if (CBZ.cityBankVaultGlow) try { CBZ.cityBankVaultGlow(0); } catch (e) {}
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
      const heatPct = Math.round(h.heat * 100);
      if (tier && tier.bank) {
        // bank shows the live stage: DRILL bar until breached, then BAG bar.
        const drilling = h.drilled < 1;
        const pct = Math.round((drilling ? h.drilled : h.grabbed) * 100);
        html =
          "<div style='font-size:16px;color:#ff9e6b'>" + tier.icon + (drilling ? " DRILLING THE VAULT" : " EMPTYING THE VAULT") + "</div>" +
          bar(drilling ? "DRILL" : "BAG", pct, drilling ? "#ffd166" : "#7ed957") +
          (drilling
            ? "<div style='margin-top:4px;font-weight:500;color:#aeb8c6'>Vault holds ~" + fmt$(h.vaultTotal) + " — breach it to start bagging.</div>"
            : "<div style='margin-top:4px;font-weight:500'>" + fmt$(h.bag) + " of " + fmt$(h.bagMax) + " bagged</div>") +
          bar("HEAT", heatPct, heatPct > 70 ? "#ff5b5b" : "#ffb347") +
          "<div style='margin-top:6px;font-weight:500;color:#aeb8c6'>Stay on the vault. <span style='color:#ffd479'>[H]</span> grab &amp; GO with what you've got</div>";
      } else {
        const pct = Math.round(h.grabbed * 100);
        html =
          "<div style='font-size:16px;color:#ff9e6b'>" + (tier ? tier.icon + " GRABBING — " + tier.name : "GRABBING") + "</div>" +
          bar("BAG", pct, "#7ed957") +
          "<div style='margin-top:4px;font-weight:500'>" + fmt$(h.bag) + " in the bag</div>" +
          bar("HEAT", heatPct, heatPct > 70 ? "#ff5b5b" : "#ffb347") +
          "<div style='margin-top:6px;font-weight:500;color:#aeb8c6'>Stay on it. <span style='color:#ffd479'>[H]</span> grab &amp; GO with what you've got</div>";
      }
    } else if (h.phase === "escape") {
      const stars = g.wanted | 0;
      // bank: show the dye-pack/bait clock until it's beaten or it blows
      let dyeLine = "";
      if (tier && tier.bank && !h.dyed && h.getawayMax > 0) {
        const gpct = Math.round((h.getaway / h.getawayMax) * 100);
        dyeLine = bar("DYE-PACK CLOCK (break line of sight!)", gpct, gpct < 35 ? "#ff5b5b" : "#ff9a4d");
      } else if (tier && tier.bank && h.dyed) {
        dyeLine = "<div style='margin-top:6px;font-weight:500;color:#ff7a7a'>💥 Dye pack blew — stained cash lost.</div>";
      }
      html =
        "<div style='font-size:16px;color:#ff5b5b'>🏃 GET CLEAR WITH " + fmt$(h.bag) + "</div>" +
        dyeLine +
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
      // BANK: the take-zone is the real STEEL VAULT (bank.js exposes its spot),
      // not the lobby centre — you drill the vault where it actually stands.
      let tx = lot.cx, tz = lot.cz;
      if (tier.bank && CBZ.cityBankVault) {
        const v = CBZ.cityBankVault();
        if (v) { tx = v.x; tz = v.z; }
      }
      target = { x: tx, z: tz, name: name, lotKind: kind };
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
    // BANK: lock in this job's vault holdings + the dye-pack rig. The drillable
    // vault is far bigger than the bag you'll realistically pull — your take is
    // capped by how long you survive the response, not by the vault running dry.
    h.drilled = 0; h.getaway = 0; h.getawayMax = tier.getaway || 0;
    h.dyed = false; h.silent = false; h.guards = h.guards || [];
    if (tier.bank) {
      const band = tier.vaultTotal || [120000, 250000];
      h.vaultTotal = Math.round(rnd(band[0], band[1]) * repPremium());
      const df = tier.dyeFrac || [0.14, 0.26];
      h.dyeFrac = rnd(df[0], df[1]);
      // your realistic bag = the smaller of "what you can grab" and the vault —
      // but cap the bag at the vault holdings so you can never bag more than the
      // branch actually has (a small unlucky vault is a leaner score).
      h.bagMax = Math.min(h.bagMax, h.vaultTotal);
    }

    sfx("door");
    big(tier.icon + " CASING: " + tier.name);
    note("In position? Press [H] to GO LOUD. Crew on hand: " + crew + ".", 2.6);
    renderHud();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  CBZ.cityStartHeist = function (tierId) { if (tierId) startCase(tierId); else showBoard(); };

  // ---- spawn the BANK's armed security: real cops (armed, shootable, hostile)
  // posted at the vault as private guards. They resist the robbery — you have to
  // fight or run past them. Tracked on h.guards + torn down when the score ends.
  function spawnGuards(n, x, z) {
    const h = ensure();
    if (!CBZ.citySpawnCop || !CBZ.cityCops) return;
    n = Math.max(0, n | 0);
    for (let i = 0; i < n; i++) {
      const ang = (i / Math.max(1, n)) * Math.PI * 2 + Math.random() * 0.6;
      const r = 3 + Math.random() * 3;
      const gx = x + Math.cos(ang) * r, gz = z + Math.sin(ang) * r;
      const gd = CBZ.citySpawnCop(gx, gz, false);   // a beat guard, not SWAT
      if (gd) {
        gd._bankGuard = true;       // tag so we can identify/clean ours up
        gd.ambient = false;
        h.guards.push(gd);
      }
    }
    if (h.guards.length) note("🛡 Bank security is resisting — deal with the guards.", 2.2);
  }

  // ------------------------------------------------------------ phase: EXECUTE
  function goLoud() {
    const h = ensure(); if (h.phase !== "case") return;
    const tier = tierById(h.tierId); if (!tier) return;
    // must be near the target to kick it off
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
    if (h.target && dist2(px, pz, h.target.x, h.target.z) > 14) { note("Get closer to the target first.", 1.6); return; }
    h.phase = "execute"; h.t = 0;
    sfx(tier.id === "store" ? "report" : "alarm");
    const x = h.target.x, z = h.target.z;

    if (tier.bank) {
      // SILENT ALARM: a branch trips its silent alarm the instant the robbery
      // starts — cops are dispatched BEFORE you've drilled a thing. We pre-seed
      // the wanted level (force to the engine's 4★ ceiling over a beat) and roll
      // an immediate response so the clock is real from second one.
      h.silent = true;
      big("🏦 THIS IS A ROBBERY — DRILL THE VAULT!");
      if (CBZ.cityAlarm) CBZ.cityAlarm(x, z, 40, 1.8, CBZ.city.playerActor);
      if (CBZ.cityPanic) CBZ.cityPanic(x, z, 2.0, CBZ.city.playerActor);
      // a robbery report (caps at 2★ on its own) PLUS forceStars to push the
      // heavy response — 4★ is the engine's forced ceiling; the 5th star is only
      // earned by a real spree (e.g. you start dropping the cops), as designed.
      if (CBZ.cityCrime) CBZ.cityCrime(220, { instant: true, x: x, z: z, type: "armed-robbery" });
      if (CBZ.cityForceStars) CBZ.cityForceStars(2);   // immediate; ramps to 4 as you drill
      spawnGuards(tier.guards || 2, x, z);
      // a couple of cops already en route the moment the silent alarm trips
      if (CBZ.citySpawnCop) for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2, r = 34 + Math.random() * 12;
        CBZ.citySpawnCop(x + Math.cos(a) * r, z + Math.sin(a) * r, false);
      }
      if (CBZ.cityBankVaultGlow) try { CBZ.cityBankVaultGlow(0.15); } catch (e) {}
      if (CBZ.shake) CBZ.shake(0.5);
      renderHud();
      return;
    }

    big(tier.icon + " THIS IS A ROBBERY!");
    // panic + a first crime report so the block reacts and cops start rolling
    if (CBZ.cityAlarm) CBZ.cityAlarm(x, z, 26, 1.4, CBZ.city.playerActor);
    if (CBZ.cityPanic) CBZ.cityPanic(x, z, 1.6, CBZ.city.playerActor);
    const crimeType = tier.id === "armored" ? "armed-robbery" : "armed-robbery";
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
    if (CBZ.cityBankVaultGlow) try { CBZ.cityBankVaultGlow(0); } catch (e) {}
    big("🏃 GO GO GO — " + fmt$(h.bag) + " in the bag!");
    sfx("whoosh");
    if (tier && tier.bank) {
      // ARM the dye-pack/bait clock: a chunk of the bag is rigged. You have a
      // short window to break the cops' line of sight (get clear / go dark);
      // run it out in the open and the pack blows — that rigged cash burns.
      h.getaway = tier.getaway || 14; h.getawayMax = h.getaway; h._defused = false;
      note("Dye-pack rigged on " + Math.round(h.dyeFrac * 100) + "% of the take — break line of sight FAST or it burns!", 3);
    } else {
      note("Lose the cops to BANK the score. Drop the bag if you get busted.", 2.6);
    }
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
    cleanupGuards();
    h.phase = "idle"; h.tierId = null; h.target = null;
    h.bag = 0; h.bagMax = 0; h.grabbed = 0; h.t = 0; h.heat = 0; h.crew = 0; h.downed = false;
    h.drilled = 0; h.vaultTotal = 0; h.getaway = 0; h.getawayMax = 0;
    h.dyeFrac = 0; h.dyed = false; h.silent = false;
    if (CBZ.cityBankVaultGlow) try { CBZ.cityBankVaultGlow(0); } catch (e) {}
    h.cooldown = cooldown || 0;
    hideHud();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // public read for HUD / interaction / other systems
  CBZ.cityHeistState = function () {
    const h = ensure();
    return { phase: h.phase, tier: h.tierId, bag: Math.round(h.bag), bagMax: h.bagMax, grabbed: h.grabbed, heat: h.heat, crew: h.crew, cooldown: h.cooldown, completed: h.completed, biggest: h.biggest,
             drilled: h.drilled, vaultTotal: h.vaultTotal, getaway: h.getaway, dyeFrac: h.dyeFrac, dyed: h.dyed, guards: (h.guards || []).filter(function (gd) { return gd && !gd.dead; }).length };
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

    // ============================================================
    //  BANK EXECUTE — a real two-stage vault crack (DRILL → GRAB), heavier
    //  response, and a dye-pack/bait rig that punishes a slow getaway.
    // ============================================================
    if (h.phase === "execute" && tier.bank) {
      const onVault = inZone;
      if (onVault) {
        const crewSpeed = 1 + 0.16 * h.crew;
        if (h.drilled < 1) {
          // STAGE 1 — DRILL the vault. Real seconds of exposure before a cent.
          h.drilled = clamp(h.drilled + (dt / tier.drillTime) * crewSpeed, 0, 1);
          if (CBZ.cityBankVaultGlow) try { CBZ.cityBankVaultGlow(0.15 + 0.85 * h.drilled); } catch (e) {}
          if (CBZ.shake && Math.random() < dt * 2.0) CBZ.shake(0.1);
          if (Math.random() < dt * 0.8) sfx("report");   // drill bite
          if (h.drilled >= 1) { big("🔓 VAULT BREACHED — GRAB THE CASH!"); sfx("alarm"); }
        } else {
          // STAGE 2 — GRAB. Bag fills from the breached vault; crew speeds it.
          const dGrab = (dt / tier.grabTime) * crewSpeed;
          const prev = h.grabbed;
          h.grabbed = clamp(h.grabbed + dGrab, 0, 1);
          h.bag += (h.grabbed - prev) * h.bagMax;
          if (Math.random() < dt * 1.2) sfx("coin");
        }
        // heat climbs the WHOLE time you're exposed (drill + grab)
        h.heat = clamp(h.heat + (tier.heatRate / 100) * dt * 0.5, 0, 1);
        // escalate toward the engine's forced 4★ ceiling as the heat builds
        const wantTarget = Math.min(4, 2 + Math.round(h.heat * 2));
        if (CBZ.cityForceStars && (g.wanted | 0) < wantTarget) CBZ.cityForceStars(wantTarget);
        // heavier, faster waves than a corner store — SWAT once it's really hot
        if (Math.random() < dt * (0.45 + h.heat * 0.9) && CBZ.citySpawnCop) {
          const ang = Math.random() * Math.PI * 2, r = 26 + Math.random() * 16;
          CBZ.citySpawnCop(tgt.x + Math.cos(ang) * r, tgt.z + Math.sin(ang) * r, h.heat > 0.55);
          if (Math.random() < 0.5) sfx("siren");
        }
        if (Math.random() < dt * (0.5 + h.heat)) { if (CBZ.cityPanic) CBZ.cityPanic(tgt.x, tgt.z, 1.2, CBZ.city.playerActor); }
        if (CBZ.shake && Math.random() < dt * 1.0) CBZ.shake(0.1);
        // bag full → arm the dye pack + run
        if (h.grabbed >= 1) { note("Vault's empty — GO!", 1.2); grabAndGo(); }
      } else {
        if (Math.random() < dt * 2) note(h.drilled < 1 ? "Get back ON the vault to keep drilling!" : "Back on the vault — fill the bag!", 1.0);
      }
      // hard timeout: cops overwhelm the scene — bail with what you've grabbed
      if (h.t > (tier.drillTime + tier.grabTime) * 1.8) { note("They're swarming the lobby — GO with what you've got!", 1.4); grabAndGo(); }
      renderHud();
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

    // ============================================================
    //  BANK ESCAPE — the dye-pack/bait clock on top of the normal lose-the-cops.
    // ============================================================
    if (h.phase === "escape" && tier.bank) {
      // the dye-pack/bait window only RUNS while a cop can see you — break their
      // line of sight (turn a corner, get indoors, go dark) to "freeze" the clock.
      if (!h.dyed && h.getaway > 0) {
        const seen = copSeesPlayer();
        if (seen) {
          h.getaway = Math.max(0, h.getaway - dt);
          if (h.getaway <= 0) {
            // POP — the dye pack blows. The rigged share of the bag is ruined.
            const burn = Math.round(h.bag * clamp(h.dyeFrac, 0, 0.5));
            h.bag = Math.max(0, h.bag - burn);
            h.dyed = true;
            big("💥 DYE PACK! " + fmt$(burn) + " ruined red — " + fmt$(h.bag) + " left clean.");
            note("Stained money's worthless. Get the rest clear.", 2.6);
            sfx("glass"); if (CBZ.shake) CBZ.shake(0.3);
          }
        } else if (h.getaway < (h.getawayMax || tier.getaway)) {
          // you broke LOS in time — defuse it: out of sight = the pack's beaten.
          if (!h._defused) { h._defused = true; note("🕶 Out of sight — dye pack beaten. Now lose them entirely.", 2.2); }
        }
      }
      // banking still requires SHAKING the cops (stars → 0), same as every score.
      const stars = g.wanted | 0;
      if (stars <= 0) {
        if (h._clearT == null) h._clearT = 0;
        h._clearT += dt;
        if (h._clearT > 1.0) { h._clearT = null; h._defused = false; bankScore(); return; }
      } else {
        h._clearT = null;
      }
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
