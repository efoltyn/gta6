/* ============================================================
   city/interact.js — the contextual street interactions, shown in the
   shared #interact HUD panel (the same one the jail uses). Walk up to a
   person, body, gang stash, car or shop and a clear option list pops up.

   Rules the design follows:
     • There is ALWAYS a malicious option (Mug / Steal car / Loot / Rob).
     • Point a gun at someone (gun equipped + they're in your sights) and
       the panel becomes a HOSTAGE menu — different DEMANDS (rob, ransom,
       human shield, execute).
     • Keys: E = shop / eat / loot, I J K L = the contextual options,
       X = do drugs.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  const REACH = 3.8;
  let panel, nameEl, noteEl, optsEl;
  let current = null, currentKey = "", currentOpts = [], detAcc = 0;

  function dom() {
    if (panel) return;
    panel = document.getElementById("interact");
    nameEl = document.getElementById("interactName");
    noteEl = document.getElementById("interactNote");
    optsEl = document.getElementById("interactOpts");
    // tap/click the rows (mobile + mouse), same as the jail panel
    if (optsEl) optsEl.addEventListener("click", function (e) {
      if (g.mode !== "city" || CBZ.player.driving) return;
      const row = e.target.closest && e.target.closest(".iopt");
      if (!row || row.dataset.i == null) return;
      const o = currentOpts[+row.dataset.i];
      if (o && o.fn) o.fn();
    });
  }
  // NOTE: #interact's base style is opacity:0 (the jail's fade-in); only the
  // `.show` class lifts it to opacity:1. The city must toggle that class too,
  // or the panel is display:block but fully TRANSPARENT — i.e. "no popup".
  function hide() { dom(); if (panel) { panel.style.display = "none"; panel.classList.remove("show"); } current = null; currentKey = ""; currentOpts = []; }
  function show() { dom(); if (panel) { panel.style.display = "block"; panel.classList.add("show"); } }
  function release() { dom(); if (panel) { panel.style.display = ""; panel.classList.remove("show"); } current = null; currentKey = ""; currentOpts = []; }

  function dist(a, x, z) { return Math.hypot(a.pos.x - x, a.pos.z - z); }
  function nearest(list, x, z, test) { let best = null, bd = REACH; for (const p of list) { if (!test(p)) continue; const d = dist(p, x, z); if (d < bd) { bd = d; best = p; } } return best; }

  function armedGun() { const it = g.cityWeapon && CBZ.cityEcon.ITEMS[g.cityWeapon]; return it && it.gun ? it : null; }
  // the ped you're "pointing your gun at": in the forward cone, close-ish
  function aimedPed(px, pz) {
    if (!armedGun()) return null;
    const y = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(y), fz = -Math.cos(y);
    let best = null, bd = 7, bestDot = 0.55;
    for (const p of CBZ.cityPeds) {
      if (p.dead || p.vendor) continue;
      const dx = p.pos.x - px, dz = p.pos.z - pz, d = Math.hypot(dx, dz);
      if (d > bd || d < 0.4) continue;
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot > bestDot) { bestDot = dot; best = p; }
    }
    return best;
  }

  const TALK = ["You lost?", "Nice day, huh.", "Got a light?", "Move along.", "I know you?", "Crazy out here lately.", "Spare some change?"];
  function talk() { CBZ.city.note("“" + TALK[(Math.random() * TALK.length) | 0] + "”", 1.6); }
  // You can't see the exact $ on someone until you ROB them — only a vibe that
  // hints whether they're worth it (a rare whale "looks loaded").
  function pedVibe(p) {
    if (p.robbed) return "robbed";
    const w = p.wealth || 0;
    return w >= 0.985 ? "looks loaded 💰" : w >= 0.85 ? "flashing money" : w >= 0.55 ? "well-dressed" : w < 0.18 ? "looks broke" : "";
  }
  function ped$(p) {
    const flavor = p.archetype === "tweaker" ? "tweaking"
      : p.archetype === "volatile" ? "on edge"
      : p.archetype === "dealer" ? "street dealer"
      : p.archetype === "hustler" ? "hustler"
      : "";
    const bits = [pedVibe(p), p.job || "", flavor, p.gang || "", p.recruited ? p.kind : "", p === g.cityPartner ? "💕 partner" : ""].filter(Boolean);
    return bits.length ? bits.join(" · ") : "—";
  }

  // ---- option builders (each option: {label, key, fn, bad}) ----
  function hostageOpts(p) {
    return [
      { label: "Rob at gunpoint", key: "i", bad: true, fn: () => { CBZ.cityRobPed(p); } },
      { label: "Take hostage", key: "j", bad: true, fn: () => CBZ.cityTakeHostage && CBZ.cityTakeHostage(p) },
      { label: "Demand ransom", key: "k", bad: true, fn: () => demandRansom(p) },
      { label: "Execute", key: "l", bad: true, fn: () => execute(p) },
    ];
  }
  function pedOpts(p) {
    const nm = p.name || "them";
    const opts = [{ label: "Mug " + nm, key: "i", bad: true, fn: () => CBZ.cityRobPed(p) }];
    opts.push({ label: "Beat " + nm + " down", key: "j", bad: true, fn: () => attack(p) });
    const econ = CBZ.cityEcon, inv = g.cityInv || {};
    const hasDrugs = Object.keys(inv).some((k) => econ.ITEMS[k] && econ.ITEMS[k].tag === "drug");
    if (p === g.cityPartner) opts.push({ label: g.citySpouse ? "Sweet-talk " + nm : "Propose to " + nm + " 💍", key: "k", fn: () => (g.citySpouse ? talk() : CBZ.cityPropose(p)) });
    else if (p.gang && !g.career) opts.push({ label: "Run with the " + p.gang, key: "k", fn: () => CBZ.cityStartCareer && CBZ.cityStartCareer("gangster") });
    else if (g.career === "dealer" && hasDrugs) opts.push({ label: "Sell " + nm + " product", key: "k", bad: true, fn: () => CBZ.cityDealTo(p) });
    else if (!p.recruited && !p.gang && ((g.respect || 0) >= 5 || (CBZ.city.canAfford && CBZ.city.canAfford(100)))) opts.push({ label: "Recruit " + nm + " 🔫", key: "k", fn: () => CBZ.cityRecruit(p) });
    else if (CBZ.cityIsRomance && CBZ.cityIsRomance(p)) opts.push({ label: "Flirt with " + nm + " 💕", key: "k", fn: () => CBZ.cityFlirt(p) });
    else opts.push({ label: "Talk to " + nm, key: "k", fn: talk });
    opts.push({ label: "Pick " + nm + "'s pocket", key: "l", bad: true, fn: () => pickpocket(p) });
    return opts;
  }
  function vendorOpts(v) {
    return [
      { label: "Shop here", key: "e", fn: () => CBZ.cityOpenShop(v.vendor) },
      { label: "Rob the register", key: "i", bad: true, fn: () => robRegister(v) },
      { label: "Talk to the clerk", key: "j", fn: () => CBZ.city.note("“Welcome in. Take a look around.”", 1.6) },
    ];
  }

  // ---- police: the menu is built from the SITUATION, not a fixed list. ----
  // Surrender only exists when you're actually wanted (you can't give up to
  // nothing); an alibi only shows while the heat is still low enough that a
  // story is believable. With a clean record a cop is just a person to talk to.
  function copHunting(c) { return c.curTarget === CBZ.city.playerActor || (c.sees && (g.wanted | 0) >= 1); }
  function copNote(c) {
    const stars = g.wanted | 0;
    if (copHunting(c)) return "👁 Onto you — give up, talk fast, or run";
    if (stars >= 1) return "On alert · " + "★".repeat(stars);
    return "Keeping the peace";
  }
  function copOpts(c) {
    const stars = g.wanted | 0;
    const opts = [];
    if (stars >= 1) {
      // give up: cuffed, but cooperating costs you less than getting gunned down
      opts.push({ label: "Put your hands up — surrender", key: "i", fn: () => copSurrender(c) });
      // an alibi is only plausible at low heat (you can't talk down a rampage)
      if (stars <= 2) opts.push({ label: "Give the officer an alibi", key: "j", fn: () => copAlibi(c) });
    } else {
      opts.push({ label: "Ask " + c.name + " for directions", key: "k", fn: talk });
    }
    // the design rule: there's ALWAYS a malicious option — here, assault
    opts.push({ label: "Sucker-punch " + c.name, key: "l", bad: true, fn: () => copAssault(c) });
    return opts;
  }
  function copSurrender(c) {
    if (CBZ.sfx) CBZ.sfx("door");
    CBZ.city && CBZ.city.note("You raise your hands and give yourself up…", 1.4);
    if (c) { c.curTarget = CBZ.city.playerActor; c.sees = true; }
    CBZ.cityBust && CBZ.cityBust({ peaceful: true });   // cooperative → lighter than a violent bust
  }
  function copAlibi(c) {
    const stars = g.wanted | 0;
    if (stars < 1) { talk(); return; }
    // believability falls as the heat climbs; selling it buys you down a level
    const chance = stars === 1 ? 0.6 : 0.32;
    if (Math.random() < chance) {
      CBZ.cityReduceWanted && CBZ.cityReduceWanted(2);
      if (c) { c.curTarget = null; c.sees = false; c.retarget = 2.5; c.arrestT = 0; }
      CBZ.city && CBZ.city.big("ALIBI BOUGHT");
      CBZ.city && CBZ.city.note("“…fine. Move along.” " + c.name + " buys it.", 2);
      CBZ.city && CBZ.city.addRespect(1);
    } else {
      CBZ.city && CBZ.city.note("“Save it.” " + c.name + " isn't buying it.", 2);
      CBZ.cityCrime && CBZ.cityCrime(40, { instant: true, x: c.pos.x, z: c.pos.z, type: "lying-to-police" });
      if (c) c.retarget = 0;        // lock straight onto you
    }
  }
  function copAssault(c) {
    CBZ.cityCrime && CBZ.cityCrime(70, { instant: true, x: c.pos.x, z: c.pos.z, type: "assault-officer" });
    attack(c);
  }

  function attack(p) {
    const fx = CBZ.player.pos.x, fz = CBZ.player.pos.z;
    CBZ.player._fighting = 1.5;
    if (p.kind === "cop") { CBZ.cityHurtCop && CBZ.cityHurtCop(p, 35, { fromX: fx, fromZ: fz }); return; }
    p.hp -= 35;
    if (CBZ.sfx) CBZ.sfx("punch");
    if (p.hp <= 0) CBZ.cityKillPed(p, { fromX: fx, fromZ: fz }, "beaten");
    else CBZ.cityKOPed(p, fx, fz);
  }
  function execute(p) {
    const fx = CBZ.player.pos.x, fz = CBZ.player.pos.z;
    const from = CBZ.playerMuzzleWorld ? CBZ.playerMuzzleWorld() : { x: fx, y: 1.4, z: fz };
    if (CBZ.muzzleFlash) CBZ.muzzleFlash(from, {});
    if (CBZ.sfx) CBZ.sfx("report");
    if (p.kind === "cop") CBZ.cityHurtCop && CBZ.cityHurtCop(p, 200, { fromX: fx, fromZ: fz });
    else CBZ.cityKillPed(p, { fromX: fx, fromZ: fz, force: 6, fling: 3 }, "executed");
  }
  function demandRansom(p) {
    if (p === g.cityHostage) { CBZ.cityReleaseHostage && CBZ.cityReleaseHostage(true); return; }
    const pay = 150 + (((p.wealth || 0.3) * 900) | 0);
    p.cash = 0; p.alarmed = 8; p.fear = 10;
    CBZ.city.addCash(pay); CBZ.city.big("EXTORTED + $" + pay);
    CBZ.cityAlarm(p.pos.x, p.pos.z, 16, 1, CBZ.city.playerActor);
    CBZ.cityCrime && CBZ.cityCrime(50, { x: p.pos.x, z: p.pos.z, type: "extortion" });
    if (CBZ.sfx) CBZ.sfx("coin");
  }
  function pickpocket(p) {
    if (p.robbed) { CBZ.city.note(p.name + " has nothing left.", 1.4); return; }
    if (Math.random() < 0.7) {
      const take = Math.min(p.cash, 5 + ((Math.random() * 25) | 0));
      p.cash -= take; if (take > 0) CBZ.city.addCash(take);
      CBZ.city.note("Lifted $" + take + " unseen.", 1.6); if (CBZ.sfx) CBZ.sfx("coin");
      CBZ.city.addRespect(1);
    } else { p.alarmed = 6; CBZ.cityAlarm(p.pos.x, p.pos.z, 12, 0.6, CBZ.city.playerActor); CBZ.cityCrime && CBZ.cityCrime(30, { x: p.pos.x, z: p.pos.z, type: "theft" }); CBZ.city.note(p.name + " caught you!", 1.6); }
  }
  function robRegister(v) {
    const ped = v;
    const take = 150 + ((Math.random() * 400) | 0) + (ped.cash || 0);
    ped.cash = 0; ped.robbed = true; ped.alarmed = 10;
    CBZ.city.addCash(take); CBZ.city.addRespect(3);
    CBZ.cityAlarm(ped.pos.x, ped.pos.z, 26, 1.5, CBZ.city.playerActor);
    CBZ.cityCrime && CBZ.cityCrime(160, { x: ped.pos.x, z: ped.pos.z, type: "armed-robbery" });
    ped.vendor = null;
    CBZ.city.big("ROBBERY + $" + take);
    if (CBZ.sfx) CBZ.sfx("coin");
  }

  // ---- auto-loot: walk over (or drive over) a body and it's looted, no key.
  //      Runs on foot AND while driving, every frame, ignoring the menu state. ----
  const LOOT_R = 2.6;
  CBZ.onUpdate(38, function () {
    if (g.mode !== "city" || g.state !== "playing" || CBZ.player.dead) return;
    if (!CBZ.cityNearestCorpse || !CBZ.cityLootCorpse) return;
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
    let c;
    // loop in case several bodies are piled within reach (e.g. a car plough)
    while ((c = CBZ.cityNearestCorpse(px, pz, LOOT_R))) {
      if (!CBZ.cityLootCorpse(c)) break;   // looted() flips so the next call skips it
    }
  });

  // ---- detection: choose what you're interacting with this frame ----
  CBZ.onUpdate(39, function (dt) {
    if (g.mode !== "city") { if (current || (panel && panel.style.display)) release(); return; }
    if (g.state !== "playing" || CBZ.player.driving || CBZ.cityMenuOpen || CBZ.player.dead) { if (current) hide(); return; }
    detAcc += dt; if (detAcc < 1 / 12) return; detAcc = 0;     // ~12 Hz is plenty for a prompt
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;

    let target = null, opts = null, label = "", note = "", key = "";

    // 1) pointing a gun at someone → HOSTAGE demands
    const aimed = aimedPed(px, pz);
    if (aimed) { target = aimed; key = "aim:" + tag(aimed); opts = hostageOpts(aimed); label = "🔫 " + aimed.name; note = "Make your demand"; }

    // 2) a vendor counter
    if (!target) { const v = nearest(CBZ.cityPeds, px, pz, (p) => p.vendor && !p.dead); if (v) { target = v; key = "v:" + tag(v); opts = vendorOpts(v); label = v.vendor.building.name; note = "Vendor · cash register"; } }
    // (bodies are looted AUTOMATICALLY by walking over them — see auto-loot below)
    // 4) a gang stash
    if (!target && CBZ.cityNearestStash) { const lot = CBZ.cityNearestStash(px, pz, REACH); if (lot) { target = lot; key = "s:" + lot.i + "," + lot.j; opts = [{ label: "Rob stash", key: "i", bad: true, fn: () => CBZ.cityRobStash(lot) }]; label = "🎒 Gang Stash"; note = (lot.building.gang || "gang") + " cache"; } }
    // 5) a police officer → contextual menu (surrender / alibi only when wanted)
    if (!target && CBZ.cityCops) { const cop = nearest(CBZ.cityCops, px, pz, (c) => !c.dead); if (cop) { target = cop; key = "cop:" + (g.wanted | 0) + ":" + (copHunting(cop) ? 1 : 0); opts = copOpts(cop); label = "👮 " + cop.name; note = copNote(cop); } }
    // 6) a living person
    if (!target) { const p = nearest(CBZ.cityPeds, px, pz, (q) => !q.vendor && !q.dead); if (p) { target = p; key = "p:" + tag(p); opts = pedOpts(p); label = p.name + (p.gang ? " (" + p.gang + ")" : ""); note = ped$(p); } }
    // 6) a car you can jack
    if (!target && CBZ.cityNearestCar) { const car = CBZ.cityNearestCar(px, pz, REACH); if (car) { target = car; key = "car"; opts = [{ label: "Steal car [F]", key: "i", bad: true, fn: () => CBZ.cityEnterVehicle(car) }]; label = "🚗 " + (car.model ? car.model.name : "Car"); note = "Boost it · chop shop pays out"; } }

    if (!target) { if (current) hide(); return; }
    // whoever the panel is offering interactions on at least turns to LOOK at
    // you while you're engaging them (city/peds.js move() honours _faceT).
    if (target.group && !target.dead && (target.kind || target.vendor)) target._faceT = 0.45;
    if (key !== currentKey) {
      current = target; currentKey = key; currentOpts = opts;
      dom();
      if (nameEl) nameEl.textContent = label;
      if (noteEl) noteEl.textContent = note;
      // same overhauled row style as the jail panel: a key chip + a clean line
      // (.iopt/.ikey/.ilab from css/hud.css). Malicious options tint red.
      if (optsEl) optsEl.innerHTML = opts.map((o, i) =>
        `<div class="iopt" data-i="${i}"><span class="ikey">${o.key.toUpperCase()}</span>` +
        `<span class="ilab"${o.bad ? " style=\"color:#ff9a9a\"" : ""}>${o.label}</span></div>`
      ).join("");
      show();
    } else if (noteEl && opts === currentOpts) { /* same target; refresh note cheaply */ if (target.pos) noteEl.textContent = note; }
  });

  function tag(p) { return (p.name || "?") + (p.gang || ""); }

  addEventListener("keydown", function (e) {
    if (g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen) return;
    const k = e.key.toLowerCase();
    if (k === "e" && !current) {
      const econ = CBZ.cityEcon, inv = g.cityInv || {};
      const food = Object.keys(inv).find((n) => econ.ITEMS[n] && econ.ITEMS[n].heal);
      if (food && CBZ.cityEat) { e.preventDefault(); CBZ.cityEat(food); }
      return;
    }
    if (k === "x") {
      const econ = CBZ.cityEcon, inv = g.cityInv || {};
      const drug = Object.keys(inv).find((n) => econ.ITEMS[n] && econ.ITEMS[n].tag === "drug");
      if (drug) {
        e.preventDefault();
        econ.take(drug, 1);
        const P = CBZ.player;
        P.hp = Math.min(P.maxHp || 200, P.hp + 18);
        P._boost = 16; g.hunger = Math.min(100, (g.hunger || 0) + 8);
        if (CBZ.shake) CBZ.shake(0.2);
        CBZ.city.note("You did the " + drug + "… everything feels faster. 🌀", 2.2);
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      }
      return;
    }
    if (!current || CBZ.player.driving) return;
    const o = currentOpts.find((x) => x.key === k);
    if (o) { e.preventDefault(); o.fn(); }
  });
})();
