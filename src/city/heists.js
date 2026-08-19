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
      id: "store", name: "Corner-Store Stick-Up", icon: "", tier: 1,
      take: 900, setup: 0, stars: 1, grabTime: 5, heatRate: 22, minCrew: 0, gun: false,
      kinds: ["food", "gas", "barber", "gym", "hardware"],
      desc: "Register, bag, door.",
    },
    {
      id: "liquor", name: "Liquor / Pawn Smash-&-Grab", icon: "", tier: 2,
      take: 2600, setup: 120, stars: 2, grabTime: 7, heatRate: 30, minCrew: 1, gun: false,
      kinds: ["bar", "pawn", "drugs", "clothing", "electronics"],
      desc: "Break the cases, fill the bag.",
    },
    {
      id: "jewelry", name: "Jewelry-Store Heist", icon: "", tier: 3,
      take: 7500, setup: 400, stars: 3, grabTime: 10, heatRate: 40, minCrew: 2, gun: true,
      kinds: ["jewelry", "casino"],
      desc: "Guns up, glass down.",
    },
    {
      id: "armored", name: "Armored-Truck Crack", icon: "", tier: 4,
      take: 14000, setup: 600, stars: 3, grabTime: 9, heatRate: 55, minCrew: 1, gun: true,
      kinds: null,            // spawns its own truck near you
      desc: "Crack the truck, take the cases.",
    },
    {
      id: "bank", name: "BANK JOB", icon: "", tier: 5,
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
      // `drillTime` IS GONE, AND ITS ABSENCE IS THE POINT. OWNER (2026-08-02):
      // "gta is fake, you do the mini missions that are choreographed — this
      // is real." A nine-second hold-still bar next to a prop was the single
      // most choreographed thing in this file. What replaces it is not another
      // timer: city/bank.js builds a REAL strongroom with a REAL door that has
      // an armour pool, and the only things that open it are explosives and a
      // bank officer with his hands up. This tier now supplies what it is
      // actually good at — the silent alarm, the guards, the response, the
      // dye pack, the crew — and WATCHES the physical door.
      physical: true,
      getaway: 14,                   // dye-pack/bait window: clear LOS this fast or it burns
      dyeFrac: [0.14, 0.26],         // fraction of the bag rigged to burn if you're caught slow
      guards: 2,                     // armed security inside who resist
      desc: "The vault, the bags, and the dye-pack clock.",
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
    // a fresh city life wipes a mid-job score. RETIRE it: the run is over, not
    // botched — nobody should get a FAILED card for a life they didn't live.
    scoreEnd("retire", "new run");
    cleanupTruck();
    cleanupGuards();
    const h = ensure();
    h.phase = "idle"; h.tierId = null; h.target = null;
    h.bag = 0; h.bagMax = 0; h.grabbed = 0; h.t = 0; h.heat = 0;
    h.crew = 0; h.cut = 0.7; h.downed = false; h.cooldown = 0;
    h.drilled = 0; h.vaultTotal = 0; h.getaway = 0; h.getawayMax = 0;
    h.physical = false; h.vaultId = null; h.crewOwed = 0; h._sawOpen = false;
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
      if (!lot || !lot.building || lot.demolished) continue;
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
      if (!lot || !lot.building || lot.demolished) continue;
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
        "<div style='margin-top:8px'><span style='color:#7ed957'>[H]</span> GO LOUD, start the grab" +
        "&nbsp;&nbsp;<span style='color:#ff9a9a'>[K]</span> back out</div>";
    } else if (h.phase === "execute") {
      const heatPct = Math.round(h.heat * 100);
      if (tier && tier.bank && h.physical) {
        // THE PHYSICAL JOB HAS NO PROGRESS BAR TO SHOW, because there is no
        // progress — there is a shut door or an open one, and then there is
        // however much canvas you have picked up. The panel reports the WORLD.
        const shut = h.drilled < 1;
        html =
          "<div style='font-size:16px;color:#ff9e6b'>" + tier.icon + (shut ? " THE DOOR IS SHUT" : " THE DOOR IS OPEN") + "</div>" +
          (shut
            ? "<div style='margin-top:6px;font-weight:500;color:#aeb8c6'>Blow it with explosives, or put a gun on a bank officer.<br>Behind it: <b style='color:#ffd479'>" + fmt$(h.vaultTotal) + "</b></div>"
            : "<div style='margin-top:6px;font-weight:500'>" + fmt$(h.bag) + " carried out of " + fmt$(h.bagMax) + " on the floor</div>") +
          bar("HEAT", heatPct, heatPct > 70 ? "#ff5b5b" : "#ffb347") +
          "<div style='margin-top:6px;font-weight:500;color:#aeb8c6'>One bag at a time. <span style='color:#ffd479'>[H]</span> call it and RUN</div>";
      } else if (tier && tier.bank) {
        // bank shows the live stage: DRILL bar until breached, then BAG bar.
        const drilling = h.drilled < 1;
        const pct = Math.round((drilling ? h.drilled : h.grabbed) * 100);
        html =
          "<div style='font-size:16px;color:#ff9e6b'>" + tier.icon + (drilling ? " DRILLING THE VAULT" : " EMPTYING THE VAULT") + "</div>" +
          bar(drilling ? "DRILL" : "BAG", pct, drilling ? "#ffd166" : "#7ed957") +
          (drilling
            ? "<div style='margin-top:4px;font-weight:500;color:#aeb8c6'>Vault holds ~" + fmt$(h.vaultTotal) + " · breach it to start bagging.</div>"
            : "<div style='margin-top:4px;font-weight:500'>" + fmt$(h.bag) + " of " + fmt$(h.bagMax) + " bagged</div>") +
          bar("HEAT", heatPct, heatPct > 70 ? "#ff5b5b" : "#ffb347") +
          "<div style='margin-top:6px;font-weight:500;color:#aeb8c6'>Stay on the vault. <span style='color:#ffd479'>[H]</span> grab &amp; GO with what you've got</div>";
      } else {
        const pct = Math.round(h.grabbed * 100);
        html =
          "<div style='font-size:16px;color:#ff9e6b'>" + (tier ? tier.icon + " GRABBING · " + tier.name : "GRABBING") + "</div>" +
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
        dyeLine = "<div style='margin-top:6px;font-weight:500;color:#ff7a7a'>Dye pack blew, stained cash lost.</div>";
      }
      html =
        "<div style='font-size:16px;color:#ff5b5b'>GET CLEAR WITH " + fmt$(h.bag) + "</div>" +
        dyeLine +
        "<div style='margin-top:6px;font-weight:500;color:#aeb8c6'>" +
        (stars > 0 ? "Lose the cops (" + "★".repeat(stars) + ") to BANK the score." : "You're clean, banking the take…") +
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
      // WHAT IS ACTUALLY IN THERE. The board used to quote tier.take — the
      // same number for every corner store in the world, forever. It now
      // reads the standing target's real balance, so casing the block is a
      // real decision: this bar tonight, not that one; after close, not at
      // opening. tier.take is the fallback when no target is in reach.
      const tgt = a && a.target;
      let est = Math.round(t.take * crewMul(Math.min(crew, 4)) * repPremium());
      let live = false;
      if (tgt && CBZ.cityTill) {
        const hold = CBZ.cityTill.holds(tgt, { point: "best" });
        if (hold.point) { est = Math.min(est, hold.amount); live = true; }
      }
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
        "<span style='color:" + (live && est <= 0 ? "#ff7a7a" : "#7ed957") + ";font-size:13px'>" +
        (live ? (est > 0 ? fmt$(est) + " in there now" : "empty right now") : "~" + fmt$(est)) + "</span></div>" +
        "<div style='margin-top:4px;font-weight:500;color:#aeb8c6;font-size:12px'>" + t.desc + "</div>" +
        "<div style='margin-top:6px;font-size:11px;color:#8a93a3'>" +
        "★".repeat(t.stars) + " heat · " + fee + " · " + (t.gun ? "armed" : "unarmed-ok") +
        (canStart ? " · <span style='color:#7ed957'>READY</span>" : " · <span style='color:#ff9e6b'>" + why + "</span>") +
        "</div></button>";
    }).join("");
    board.innerHTML =
      "<div style='display:flex;justify-content:space-between;align-items:flex-start'>" +
      "<div style='font-size:18px;color:#ffd479'>SCORE BOARD</div>" +
      "<button class='hb-close' style='background:none;border:1px solid #2c3140;color:#aeb8c6;border-radius:8px;padding:6px 12px;cursor:pointer'>Close</button></div>" +
      "<div style='margin-top:6px;font-size:12px;color:#8a93a3'>Crew on hand: <b style='color:#7fd0ff'>" + crew + "</b>" +
      (crew ? " (+" + Math.round((crewMul(crew) - 1) * 100) + "% take, " + Math.round((1 - cutForCrew(crew)) * 100) + "% to the crew)" : "") +
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

  /* ============================================================
     THE MISSION BLOCK (core/mission.js) — MIGRATED 2026-07-26.

     A score is a tracked, paid objective like every other job in the game, and
     it was re-inventing the half of one that is NOT about robbery: the map
     waypoint, the world mark, the phone card, the completion report. Those move
     to the shared block. Everything that is genuinely a heist STAYS here — the
     phase machine, the bag/heat/drill math, the setup fee, the crew cut, the
     [H] board and this file's own floating progress HUD.

     ONE handle, one leg per phase (case → execute → escape), stepped BY HAND
     with m.advance() from the exact transitions that already move h.phase —
     mission.js supports a caller that drives its own machine precisely so a
     file like this one does not have to give it up.

     pay:false — bankScore() below is still the only thing in this file that
     moves a dollar, and it reports the REAL cut to m.complete() so the phone
     card and the faction hook see the true figure, never a quoted one.

     Every call site is null-guarded and start() is checked for an inert handle,
     so with core/mission.js absent (or CBZ.CONFIG.MISSION_BLOCK = false) this
     file behaves exactly as it did before.
  ============================================================ */
  let score = null;                     // the live mission handle, or null
  function missionBlock() { return (CBZ.mission && CBZ.CONFIG.MISSION_BLOCK !== false) ? CBZ.mission : null; }
  // Tag a CREWED score for the ROLE layer so factions.js credits an order on the
  // gang ladder — riding with a crew IS putting in work. Feature-detected in
  // BOTH directions: with no factions module the tag is inert, but with one
  // loaded we must NOT tag a job the player is not a member for, because
  // mission.start() gates member-only defs and would hand back an inert handle
  // (no mark, no card) for a solo score pulled with hired bodyguards — which is
  // exactly what crewOnHand() counts and gang membership does not.
  function scoreFaction(crew) {
    if (!crew) return null;
    const F = CBZ.factions;
    if (F && typeof F.isMember === "function") { try { return F.isMember("gang") ? "gang" : null; } catch (e) { return null; } }
    return "gang";
  }
  function startScoreMission(tier, h) {
    const MB = missionBlock(); if (!MB || !h.target) return null;
    const at = [h.target.x, h.target.z];
    const m = MB.start({
      id: "heist:" + tier.id,
      title: tier.name,
      giver: "The Score",
      brief: tier.desc,
      // the PLANNED cut (this job's bag × your share) — the same estimate the
      // score board quotes. The figure that actually lands is reported to
      // m.complete() when it banks, so the card never invents a payout.
      reward: Math.round(h.bagMax * h.cut),
      pay: false,                        // bankScore() owns the wallet
      announce: false,                   // this file's big()/note() lines carry it
      faction: scoreFaction(h.crew),
      // this file's phase machine is the ONE authority on whether a score is
      // blown: the loop below already fails on death/bust with its own message
      // and its own cooldown. The shared sweeper must not race it.
      failOnDeath: false, failOnBust: false, failOnModeExit: false,
      stages: [
        { id: "case", text: "Case " + tier.name, goal: "manual", at: at, label: "CASE", color: 0xffd479 },
        { id: "execute", text: tier.bank ? "Drill the vault, bag the cash" : "Grab the bag", goal: "manual", at: at, label: "TAKE THE BAG", color: 0xff9e6b },
        // the escape leg has no LOCATION — "get clear" is a state, not a place.
        { id: "escape", text: "Lose the cops and bank the take", goal: "manual", label: "GET CLEAR", color: 0xff5b5b },
      ],
    });
    // start() hands back an INERT handle when the block is flagged off or a
    // faction gate refuses. Treat that as "no mission" so nothing calls into it
    // and this file keeps running on its own HUD alone.
    return (m && !m.inert) ? m : null;
  }
  // step the shared handle in lock-step with h.phase (never past the LAST leg —
  // advancing off the end would complete the mission behind bankScore's back).
  function scoreAdvance() { if (score) { try { score.advance(); } catch (e) {} } }
  /* THE VERDICT SPLIT — the one thing that has to be right.
       done   → complete(): pays nothing (pay:false), posts the completion card,
                credits the faction with the REAL cut.
       fail   → a score that actually blew: a fail card + a standing hit.
       retire → silent teardown. Pays nothing, posts nothing, tells the faction
                layer nothing. This is what generic cleanup must use: routing a
                wrapped-up job through cancel() archives a "FAILED" card for a
                score the player just banked and reports a botched job to
                factions.js (standing loss — enough of them expel you). */
  function scoreEnd(how, arg) {
    if (!score) return;
    const m = score; score = null;
    try {
      if (how === "done") m.complete({ cash: arg || 0 });
      else if (how === "fail") m.fail(arg || "the score blew up");
      else (m.retire || m.cancel).call(m, arg || "score wrapped");
    } catch (e) {}
  }
  if (CBZ.mission && CBZ.mission.adopt) CBZ.mission.adopt("city/heists.js");

  // ------------------------------------------------------------ phase: CASE
  function startCase(tierId) {
    const h = ensure();
    if (h.phase !== "idle") { note("Finish the job you're on first.", 1.6); return; }
    if (h.cooldown > 0) { note("Too hot, lay low for " + Math.ceil(h.cooldown) + "s.", 1.6); return; }
    const tier = tierById(tierId); if (!tier) return;
    if (tier.gun && !hasGun()) { note("You need a gun for that score.", 1.8); return; }

    // pin the target spot
    let target = null;
    if (tier.id === "armored") {
      const t = spawnTruck();
      if (!t) { note("No room on the street for the truck, try elsewhere.", 1.8); return; }
      target = { x: t.x, z: t.z, name: "Armored Truck", lotKind: null, truck: true };
    } else {
      const lot = nearestLotFor(tier, 9) || (lotKindHere() && tier.kinds.indexOf(lotKindHere().kind) >= 0 ? lotKindHere().lot : null);
      if (!lot) { note("Walk up to a " + tier.kinds[0] + "-type spot to case it.", 2); return; }
      const kind = (lot.building.shop && lot.building.shop.kind) || lot.kind;
      const name = (lot.building.name) || (kind + " store");
      // BANK: the take-zone is the real STEEL VAULT (bank.js exposes its spot),
      // not the lobby centre — you drill the vault where it actually stands.
      let tx = lot.cx, tz = lot.cz;
      let vaultId = null, vaultTier = null;
      if (tier.bank && CBZ.cityBankVault) {
        // PASS THE LOT. This used to ask for "the" vault with no argument, and
        // bank.js could only ever answer for the ONE branch its lazy lobby had
        // attached to — so casing any other bank in the world drilled a spot in
        // the wrong building. Every bank has a real strongroom now, and the
        // question has to name which one.
        const v = CBZ.cityBankVault(lot);
        if (v) { tx = v.x; tz = v.z; vaultId = v.id || null; vaultTier = v.tier || null; }
      }
      target = { x: tx, z: tz, name: name, lotKind: kind, lot: lot, vaultId: vaultId, vaultTier: vaultTier };
    }

    // WHAT IS ACTUALLY IN THERE, before a cent of setup is spent. A TAKE IS A
    // TRANSFER (city/shops.js's CBZ.cityTill): casing a place that has already
    // been emptied has to TELL you so, and it must not bill you for masks
    // first — that would be a hardcoded score with a hidden cover charge.
    let tillSrc = null, tillPt = "", tillHave = -1;
    if (CBZ.cityTill && target && target.lot) {
      const hold = CBZ.cityTill.holds(target.lot, { point: "best" });
      if (hold.point) { tillSrc = target.lot; tillPt = hold.point; tillHave = hold.amount; }
    }
    if (tillSrc && tillHave <= 0) {
      note("Cased it · " + target.name + " is empty right now. They've already dropped the takings.", 3.2);
      return;
    }

    // SETUP FEE (masks/tools/intel) — never refunded, GTA-style.
    if (tier.setup > 0) {
      if (!CBZ.city.canAfford(tier.setup)) { note("Setup costs " + fmt$(tier.setup) + " (masks, tools, intel).", 2); cleanupTruck(); return; }
      CBZ.city.spend(tier.setup);
      note("Paid " + fmt$(tier.setup) + " to set it up.", 1.6);
    }

    const crew = crewOnHand();
    h.phase = "case";
    h.tierId = tier.id;
    h.target = target;
    h.crew = crew;
    h.cut = cutForCrew(crew);
    // A TAKE IS A TRANSFER (city/shops.js's CBZ.cityTill). The bag is bounded
    // by WHAT THIS BUILDING ACTUALLY HAS AT THIS HOUR, not by tier.take — so
    // the same corner store is a different score at 09:00 and at 22:45, a
    // branch you already drilled this week is thin, and the board tells you
    // which target is fat right now. tier.take survives ONLY as the degrade
    // path for a target the ledger can't answer for (the armored truck stages
    // its own balance in city/armored.js).
    h.bagMax = Math.round(tier.take * crewMul(crew) * repPremium() * rnd(0.85, 1.15));
    h.tillSrc = tillSrc; h.tillPt = tillPt;
    if (tillSrc) {
      // TWO DIFFERENT LIMITS, and keeping them separate is the whole point.
      // tier.take × crew × rep is BAG CAPACITY — what you can physically carry
      // out before the response overwhelms you, which is what this file has
      // always modelled and what keeps the shipped balance intact. The
      // ledger is the CEILING — what is actually in the building. You can
      // never carry more than the response allows, and you can never take
      // more than is there. Before this, only the first limit existed, so an
      // emptied shop still paid the full tier every time.
      h.bagMax = Math.min(h.bagMax, tillHave);
    }
    h.bag = 0; h.grabbed = 0; h.t = 0; h.heat = 0; h.downed = false;
    // BANK: lock in this job's vault holdings + the dye-pack rig. The drillable
    // vault is far bigger than the bag you'll realistically pull — your take is
    // capped by how long you survive the response, not by the vault running dry.
    h.drilled = 0; h.getaway = 0; h.getawayMax = tier.getaway || 0;
    h.dyed = false; h.silent = false; h.guards = h.guards || [];
    // A PHYSICAL BANK JOB DOES NOT OWN THE MONEY — city/bank.js's vault does.
    // The ledger transfer happens the frame the door comes off, and the take is
    // whatever you physically carried, so this file must NOT also `take()` from
    // the till in grabAndGo (that would be the same dollars leaving twice).
    h.physical = !!(tier.bank && tier.physical && CBZ.cityVaultState && target && target.vaultId);
    h.vaultId = (target && target.vaultId) || null;
    h.crewOwed = 0;
    if (tier.bank) {
      // the vault total is the branch's REAL holdings when the ledger can
      // answer; the researched $120k-$250k band is the fallback (and the
      // ledger's own derivation was calibrated to land inside it).
      const band = tier.vaultTotal || [120000, 250000];
      const real = h.tillSrc ? CBZ.cityTill.holds(h.tillSrc, { point: "vault" }).amount : 0;
      h.vaultTotal = real > 0 ? real : Math.round(rnd(band[0], band[1]) * repPremium());
      // …and the BAG stays capacity-limited (tier.take × crew × rep) with the
      // vault as its ceiling one line down, so a rich district's branch does
      // not silently become a ten-times-bigger score than the one that
      // shipped — it becomes a branch you can go back to twice.
      const df = tier.dyeFrac || [0.14, 0.26];
      h.dyeFrac = rnd(df[0], df[1]);
      // your realistic bag = the smaller of "what you can grab" and the vault —
      // but cap the bag at the vault holdings so you can never bag more than the
      // branch actually has (a small unlucky vault is a leaner score).
      h.bagMax = Math.min(h.bagMax, h.vaultTotal);
    }
    if (!(h.bagMax > 0)) {
      note("Cased it, there's nothing in there right now. Come back when they've traded.", 3);
      h.phase = "idle"; h.tierId = null; h.target = null; h.tillSrc = null;
      cleanupTruck();
      renderHud();
      return;
    }

    // take the shared handle now that the bag/cut/crew are locked in — the CASE
    // leg marks the target, the map waypoint and the phone card follow. Retire
    // first so two handles can never stack (a leaked one would keep painting a
    // mark for a score that no longer exists).
    scoreEnd("retire", "replanned");
    score = startScoreMission(tier, h);

    big(tier.icon + " CASING: " + tier.name);
    note("In position? Press [H] to GO LOUD. Crew on hand: " + crew + ".", 2.6);
    renderHud();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  if (CBZ.factionMigrated) CBZ.factionMigrated("memb:heists");
  CBZ.cityStartHeist = function (tierId) {
    if (CBZ.cityCampaignOwnsMission && CBZ.cityCampaignOwnsMission()) {
      if (CBZ.campaignUI && CBZ.campaignUI.open) CBZ.campaignUI.open("missions");
      return false;
    }
    if (tierId) startCase(tierId); else showBoard();
    return true;
  };

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
    if (h.guards.length) note("Bank security is resisting, deal with the guards.", 2.2);
  }

  // ------------------------------------------------------------ phase: EXECUTE
  function goLoud() {
    const h = ensure(); if (h.phase !== "case") return;
    const tier = tierById(h.tierId); if (!tier) return;
    // must be near the target to kick it off
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
    if (h.target && dist2(px, pz, h.target.x, h.target.z) > 14) { note("Get closer to the target first.", 1.6); return; }
    h.phase = "execute"; h.t = 0;
    scoreAdvance();                       // CASE leg done → the shared mark moves to the TAKE leg
    sfx(tier.id === "store" ? "report" : "alarm");
    const x = h.target.x, z = h.target.z;

    if (tier.bank) {
      // SILENT ALARM: a branch trips its silent alarm the instant the robbery
      // starts — cops are dispatched BEFORE you've drilled a thing. We pre-seed
      // the wanted level (force to the engine's 4★ ceiling over a beat) and roll
      // an immediate response so the clock is real from second one.
      h.silent = true;
      big(h.physical ? "THIS IS A ROBBERY · GET THAT DOOR OPEN!" : "THIS IS A ROBBERY · DRILL THE VAULT!");
      if (h.physical) note("Blow the vault door, or put a gun on a bank officer and make him open it.", 3.2);
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
    scoreAdvance();                       // TAKE leg done → the ESCAPE leg
    // The escape leg carries no target, and mission.js only repaints the shared
    // surface for a leg that HAS one — so drop the map waypoint by hand or it
    // keeps pointing back at the spot you are running away from. (The light
    // column holds its last position over the scene until the score resolves;
    // the score's own HUD panel owns the getaway from here.)
    if (score && CBZ.fullMap && CBZ.fullMap.clearWaypoint) { try { CBZ.fullMap.clearWaypoint("city"); } catch (e) {} }
    const tier = tierById(h.tierId);
    if (truckObj && truckObj.doorMat) truckObj.doorMat.emissive.setHex(0x000000);
    if (CBZ.cityBankVaultGlow) try { CBZ.cityBankVaultGlow(0); } catch (e) {}
    // THE MONEY LEAVES THE BUILDING HERE. Up to this frame the bag was a
    // promise; the grab is over, so the dollars actually move out of the
    // vault/safe/drawer's balance and the business's books take the loss. Get
    // busted on the way out and the place still does NOT get it back (the
    // recovery is the police's, not the shop's) — which is what stops a
    // target being farmed by aborting the escape over and over.
    // A PHYSICAL BANK JOB IS THE EXCEPTION, AND IT IS THE HONEST ONE: the
    // dollars already left the ledger the instant city/bank.js's door came off
    // (that is what put the duffels on the strongroom floor). Taking again here
    // would be the same money leaving the branch twice — a printer.
    if (h.physical) {
      h.tillSrc = null;
      if (CBZ.cashBags && h.vaultId) h.bag = CBZ.cashBags.heldFrom(h.vaultId);
    } else if (h.tillSrc && CBZ.cityTill) {
      const moved = CBZ.cityTill.take(h.tillSrc, { point: h.tillPt || "best", max: Math.round(h.bag), by: "player", rob: true });
      h.bag = Math.min(h.bag, moved.taken);
      h.tillSrc = null;
    }
    big("GO GO GO · " + fmt$(h.bag) + " in the bag!");
    sfx("whoosh");
    if (tier && tier.bank) {
      // ARM the dye-pack/bait clock: a chunk of the bag is rigged. You have a
      // short window to break the cops' line of sight (get clear / go dark);
      // run it out in the open and the pack blows — that rigged cash burns.
      h.getaway = tier.getaway || 14; h.getawayMax = h.getaway; h._defused = false;
      note("Dye-pack rigged on " + Math.round(h.dyeFrac * 100) + "% of the take, break line of sight FAST or it burns!", 3);
    } else {
      note("Lose the cops to BANK the score. Drop the bag if you get busted.", 2.6);
    }
    renderHud();
  }

  /* PAY THE CREW — the ONE implementation, and it is now shared by both ends
     of the loop. It was written inline in bankScore() for the abstract score;
     the PHYSICAL score settles the same debt hours later at the warehouse
     (city/cashstore.js takes the cut off the racks and calls this), and a
     second copy of this routing over there would have been the parallel-
     bookkeeping trap CLAUDE.md keeps catching.

     Returns WHAT CAME BACK TO YOU: on two of the three branches the crew's
     share ends up in your own pocket (you are the crew), and the mission card
     has to report money that actually moved.

     MIGRATED to the ONE membership query + the ONE contribution writer
     (city/factions.js). Kicking the crew's share upstairs is the same call
     every other "put in work" path makes, so it also counts toward the rank
     ladder instead of quietly topping up a treasury field. The inline
     g.playerGang read below is the degrade-safe fallback. */
  function payCrew(amount) {
    amount = Math.round(amount || 0);
    if (!(amount > 0)) return 0;
    const FX = CBZ.factions;
    const inCrew = !!(FX && FX.isMember && FX.isMember("gang"));
    if (inCrew) {
      // credit the ladder either way — kicking up IS the work
      FX.credit("gang", "contrib", amount);
      // ...but the MONEY must still land somewhere. A player who FOUNDED a
      // set has a treasury; a player patched into someone else's set does
      // not, and the old code's `else if` fallback paid them the cut in cash.
      // Keeping both branches is what stops this from being a money
      // regression for every non-boss member.
      if (g.playerGang) { g.playerGang.treasury = (g.playerGang.treasury || 0) + amount; return 0; }
      CBZ.city.addCash(amount); return amount;
    }
    if (CBZ.cityPlayerGangExists && CBZ.cityPlayerGangExists() && g.playerGang) {
      g.playerGang.treasury = (g.playerGang.treasury || 0) + amount; return 0;
    }
    // no gang yet — the crew share still comes to you (you ARE the crew)
    CBZ.city.addCash(amount); return amount;
  }
  CBZ.cityHeistPayCrew = payCrew;

  // ------------------------------------------------------------ resolve
  function bankScore() {
    const h = ensure();
    const tier = tierById(h.tierId);
    const take = Math.round(h.bag);
    if (take <= 0) { abort("Nothing in the bag, score's a bust."); return; }

    /* THE PHYSICAL BANK JOB PAYS NOTHING, AND THAT IS THE FEATURE.
       The money is not a number waiting to be credited — it is canvas on your
       shoulder and on the strongroom floor behind you. Crediting `take` here
       would be paying you a second time for dollars you are already holding,
       which is the exact double-count this whole wave exists to delete.

       WHAT ABOUT THE CREW'S CUT? It is NAMED, not faked. Nobody skims a duffel
       out of your hands, and inventing a cash deduction against a wallet the
       money never entered would be bookkeeping fiction (the banned kind). So
       the share is recorded as `crewOwed` on the score and settles when the
       bags are actually converted — the warehouse/cargo wave that consumes
       CBZ.cashBags is where that lands. Until then the crew got what a crew
       really gets on the night: they were bodies in the gunfight. */
    if (h.physical) {
      h.crewOwed = Math.round(take * (1 - h.cut));
      /* …AND THE DEBT NOW OUTLIVES THE SCORE. `h` is wiped by finish() four
         lines below (and by every fresh run), so a promise recorded only on
         the handle was a promise that evaporated before you had driven the
         bags anywhere — the crew could never actually be paid. The obligation
         is handed to the ledger that owns the other end of this loop:
         city/cashstore.js settles it out of the warehouse racks the moment
         the bags are really stored, by TAKING it off the shelf. Absent that
         file the line is a no-op and the note below still tells the truth. */
      if (h.crewOwed > 0 && CBZ.cashStore && CBZ.cashStore.oweCrew) {
        try { CBZ.cashStore.oweCrew(h.crewOwed, tier ? tier.id : "score"); } catch (e) {}
      }
      const respP = (tier ? tier.tier : 5) * 6 + Math.round(take / 1200);
      if (CBZ.city.addRespect) CBZ.city.addRespect(respP);
      h.completed = (h.completed || 0) + 1;
      if (take > (h.biggest || 0)) h.biggest = take;
      big("CLEAN AWAY WITH " + fmt$(take) + " IN BAGS");
      note("It's still in the bags, nothing was banked. +" + respP + " respect · biggest haul: " + fmt$(h.biggest), 3.2);
      if (h.crewOwed > 0) note("The crew are owed " + fmt$(h.crewOwed) + " · they'll take it off your racks the day you store this.", 3.0);
      if (CBZ.cityEvent) CBZ.cityEvent("heist-banked", { tier: tier ? tier.id : "?", take: take, crew: h.crew, physical: true }, { silent: true, noWanted: true });
      scoreEnd("done", 0);
      finish(tier ? 6 + tier.tier * 4 : 8);
      return;
    }

    const yourCut = Math.round(take * h.cut);
    const crewCut = take - yourCut;
    CBZ.city.addCash(yourCut);
    // what ACTUALLY lands in the player's wallet — the crew share below comes
    // back to you on two of its branches, and the mission card must report the
    // money that moved, not the money we planned to move.
    let cashToYou = yourCut + payCrew(crewCut);
    sfx("coin");
    // respect + lifetime stats scale with the tier
    const resp = (tier ? tier.tier : 1) * 6 + Math.round(take / 1200);
    if (CBZ.city.addRespect) CBZ.city.addRespect(resp);
    h.completed = (h.completed || 0) + 1;
    if (take > (h.biggest || 0)) h.biggest = take;
    big("SCORE BANKED: " + fmt$(yourCut) + (crewCut > 0 ? " (+" + fmt$(crewCut) + " crew cut)" : ""));
    note("+" + resp + " respect · biggest take: " + fmt$(h.biggest), 2.6);
    if (CBZ.cityEvent) CBZ.cityEvent("heist-banked", { tier: tier ? tier.id : "?", take: take, crew: h.crew }, { silent: true, noWanted: true });
    // CLOSE THE HANDLE AS DONE BEFORE finish() — finish() is generic teardown
    // and retires it, which pays nothing and posts nothing, so a banked score
    // would leave the player with no completion card at all. The figure is the
    // cash that actually landed, not the quote.
    scoreEnd("done", cashToYou);
    // a brief cooldown so you can't chain bank jobs back-to-back
    const cd = tier ? 6 + tier.tier * 4 : 8;
    finish(cd);
  }

  function abort(msg) {
    const h = ensure();
    // A plan you back out of BEFORE going loud is not a blown job — nobody ever
    // knew it was on, so it retires SILENTLY (no fail card, no standing hit).
    // Only a score that actually went loud and then fell apart counts against
    // you. Read h.phase first: finish() below resets it.
    if (h.phase === "case") scoreEnd("retire", "plan's off");
    else scoreEnd("fail", msg || "the score fell apart");
    cleanupTruck();
    if (msg) note(msg, 2);
    finish(4);
  }
  CBZ.cityAbortHeist = function () { const h = ensure(); if (h.phase !== "idle") abort("Backed out of the score."); };

  // failed: busted/downed mid-job → you LOSE the bag entirely
  function fail(reason) {
    const h = ensure();
    scoreEnd("fail", reason);             // a REAL bust: the card and the faction hook both hear it
    cleanupTruck();
    big("SCORE BLOWN · " + reason);
    note("Lost the bag (" + fmt$(h.bag) + "). Heal up and try again.", 2.8);
    finish(10);
  }

  function finish(cooldown) {
    const h = ensure();
    // GENERIC teardown — every terminal path funnels through here, including the
    // one that just banked. RETIRE, never cancel: bankScore()/abort()/fail()
    // have already stated the real verdict, so by the time we arrive the handle
    // is closed and this is a no-op.
    scoreEnd("retire", "score wrapped");
    cleanupTruck();
    cleanupGuards();
    h.phase = "idle"; h.tierId = null; h.target = null;
    h.bag = 0; h.bagMax = 0; h.grabbed = 0; h.t = 0; h.heat = 0; h.crew = 0; h.downed = false;
    h.drilled = 0; h.vaultTotal = 0; h.getaway = 0; h.getawayMax = 0;
    h.physical = false; h.vaultId = null; h.crewOwed = 0; h._sawOpen = false;
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
             drilled: h.drilled, vaultTotal: h.vaultTotal, getaway: h.getaway, dyeFrac: h.dyeFrac, dyed: h.dyed,
             physical: !!h.physical, vaultId: h.vaultId || null, crewOwed: h.crewOwed || 0,
             guards: (h.guards || []).filter(function (gd) { return gd && !gd.dead; }).length };
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
          if (ready && Math.random() < 0.5) note("You could case this " + (ready.tier.kinds[0]) + " · press [H].", 1.6);
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
      if (tgt && dist2(px, pz, tgt.x, tgt.z) > 40) { abort("Walked away from the target, plan's off."); return; }
      // refresh the truck visual cue
      return;
    }

    // ============================================================
    //  BANK EXECUTE — a real two-stage vault crack (DRILL → GRAB), heavier
    //  response, and a dye-pack/bait rig that punishes a slow getaway.
    // ============================================================
    /* ============================================================
       THE PHYSICAL BANK JOB. No meter, no hold, no "stay in the zone".
       city/bank.js's door is either shut or it is not, and the bag is
       whatever weight of duffel you have actually picked up. This branch
       therefore READS the world and never writes a progress number.
       ============================================================ */
    if (h.phase === "execute" && tier.bank && h.physical) {
      const st = (h.target && h.target.lot && CBZ.cityVaultState) ? CBZ.cityVaultState(h.target.lot) : null;
      h.drilled = (st && st.open) ? 1 : 0;
      h.vaultTotal = st ? (st.holds || h.vaultTotal) : h.vaultTotal;
      if (st && st.open && !h._sawOpen) {
        h._sawOpen = true;
        big("THE DOOR'S OFF · CARRY IT OUT.");
        // the bag ceiling is now a fact about the room, not a tier constant
        h.bagMax = Math.max(h.bagMax, st.bagged || 0);
      }
      // WHAT YOU HAVE GOT is what you have had your hands on. cashBags tracks
      // it because the bags are the money; this file keeps no parallel total.
      if (CBZ.cashBags && h.vaultId) {
        h.bag = CBZ.cashBags.heldFrom(h.vaultId);
        if (h.bag > h.bagMax) h.bagMax = h.bag;
        h.grabbed = h.bagMax > 0 ? clamp(h.bag / h.bagMax, 0, 1) : 0;
      }
      // the response does not care whether you are standing still: the alarm
      // went in when you went loud, and the heat runs on the CLOCK from there.
      h.heat = clamp(h.heat + (tier.heatRate / 100) * dt * 0.5, 0, 1);
      const wantTargetP = Math.min(4, 2 + Math.round(h.heat * 2));
      if (CBZ.cityForceStars && (g.wanted | 0) < wantTargetP) CBZ.cityForceStars(wantTargetP);
      if (Math.random() < dt * (0.45 + h.heat * 0.9) && CBZ.citySpawnCop) {
        const angP = Math.random() * Math.PI * 2, rP = 26 + Math.random() * 16;
        const sxP = tgt.x + Math.cos(angP) * rP, szP = tgt.z + Math.sin(angP) * rP;
        CBZ.citySpawnCop(sxP, szP, h.heat > 0.55);
        if (Math.random() < 0.5 && CBZ.sfxAt) CBZ.sfxAt("siren", sxP, szP);
      }
      if (Math.random() < dt * (0.5 + h.heat)) { if (CBZ.cityPanic) CBZ.cityPanic(tgt.x, tgt.z, 1.2, CBZ.city.playerActor); }
      // NO HARD TIMEOUT AND NO AUTO-ADVANCE. You leave when you decide to
      // leave, carrying what you decided to carry — [H] runs.
      renderHud();
      return;
    }

    if (h.phase === "execute" && tier.bank) {
      const onVault = inZone;
      if (onVault) {
        const crewSpeed = 1 + 0.16 * h.crew;
        if (h.drilled < 1) {
          // STAGE 1 — DRILL the vault. Real seconds of exposure before a cent.
          // (LEGACY PATH: reached only when BANK_VAULT_V1 is off or the branch
          // is too small to hold a real strongroom — see cityVaultRoom's
          // `refused`. Kept byte-identical so the flag is a true one-line revert.)
          h.drilled = clamp(h.drilled + (dt / (tier.drillTime || 9)) * crewSpeed, 0, 1);
          if (CBZ.cityBankVaultGlow) try { CBZ.cityBankVaultGlow(0.15 + 0.85 * h.drilled); } catch (e) {}
          if (CBZ.shake && Math.random() < dt * 2.0) CBZ.shake(0.1);
          if (Math.random() < dt * 0.8) sfx("report");   // drill bite
          if (h.drilled >= 1) big("VAULT BREACHED · GRAB THE CASH!");
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
          const sx = tgt.x + Math.cos(ang) * r, sz = tgt.z + Math.sin(ang) * r;
          CBZ.citySpawnCop(sx, sz, h.heat > 0.55);
          if (Math.random() < 0.5 && CBZ.sfxAt) CBZ.sfxAt("siren", sx, sz);
        }
        if (Math.random() < dt * (0.5 + h.heat)) { if (CBZ.cityPanic) CBZ.cityPanic(tgt.x, tgt.z, 1.2, CBZ.city.playerActor); }
        if (CBZ.shake && Math.random() < dt * 1.0) CBZ.shake(0.1);
        // bag full → arm the dye pack + run
        if (h.grabbed >= 1) { note("Vault's empty. GO!", 1.2); grabAndGo(); }
      } else {
        if (Math.random() < dt * 2) note(h.drilled < 1 ? "Get back ON the vault to keep drilling!" : "Back on the vault, fill the bag!", 1.0);
      }
      // hard timeout: cops overwhelm the scene — bail with what you've grabbed
      if (h.t > (tier.drillTime + tier.grabTime) * 1.8) { note("They're swarming the lobby. GO with what you've got!", 1.4); grabAndGo(); }
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
          const sx = tgt.x + Math.cos(ang) * r, sz = tgt.z + Math.sin(ang) * r;
          CBZ.citySpawnCop(sx, sz, h.heat > 0.7);
          if (Math.random() < 0.4 && CBZ.sfxAt) CBZ.sfxAt("siren", sx, sz);
        }
        if (CBZ.shake && Math.random() < dt * 1.2) CBZ.shake(0.12);
        // bag full → auto-advance to escape
        if (h.grabbed >= 1) { note("Bag's full!", 1.2); grabAndGo(); }
      } else {
        // out of the zone mid-grab: not banking; nudge them back in
        if (Math.random() < dt * 2) note("Get back on the target to keep grabbing!", 1.0);
      }
      if (h.t > tier.grabTime * 2.6) { note("Cops are swarming. GO with what you've got!", 1.4); grabAndGo(); }
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
            // POP — the dye pack blows. A dye pack RUINS NOTES; it does not
            // delete them from the universe, so on a physical job it stains the
            // duffel you are actually holding (the bag stays, it is worth less,
            // and it LOOKS ruined). On the legacy path it takes the abstract bag.
            let burn = 0;
            if (h.physical && CBZ.cashBags) {
              const held = CBZ.cashBags.carried();
              if (held) burn = CBZ.cashBags.dye(held, clamp(h.dyeFrac, 0, 0.5));
              const list = CBZ.cashBags.list();
              for (let q = 0; q < list.length && !held; q++) {
                if (list[q].src === h.vaultId && !list[q].dyed) { burn = CBZ.cashBags.dye(list[q], clamp(h.dyeFrac, 0, 0.5)); break; }
              }
              h.bag = h.vaultId ? CBZ.cashBags.heldFrom(h.vaultId) : Math.max(0, h.bag - burn);
            } else {
              burn = Math.round(h.bag * clamp(h.dyeFrac, 0, 0.5));
              h.bag = Math.max(0, h.bag - burn);
            }
            h.dyed = true;
            big("DYE PACK! " + fmt$(burn) + " ruined red · " + fmt$(h.bag) + " left clean.");
            note("Stained money's worthless. Get the rest clear.", 2.6);
            if (CBZ.shake) CBZ.shake(0.3);
          }
        } else if (h.getaway < (h.getawayMax || tier.getaway)) {
          // you broke LOS in time — defuse it: out of sight = the pack's beaten.
          if (!h._defused) { h._defused = true; note("Out of sight, dye pack beaten. Now lose them entirely.", 2.2); }
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
