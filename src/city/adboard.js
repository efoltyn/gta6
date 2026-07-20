/* ============================================================
   city/adboard.js — the OUTDOOR-AD MARKET: every billboard face, bus-shelter
   panel and rooftop board props.js places is rentable real estate.

   WHY this exists (money → visibility → show-off):
     • The city already advertises its own life (gangs, shops, radio, your
       WANTED poster). Owning those surfaces is the next rung of the flex —
       cash turns into your NAME on the skyline, visible from a moving car.
     • Boards DO something: one advertising a business you own bumps that
       business's income while it runs (CBZ.cityAdBoost, read by zillow's
       income tick), so ad spend is a real investment, not just paint.
     • No business yet? The board runs your gang / your face instead and pays
       in RESPECT — clout is the currency before money is.
     • Rent is weekly and keeps charging (bank first, then cash — the upkeep
       pattern). Go broke and the landlord pulls your creative: status you
       stop paying for is status you lose.

   Surfaces come from CBZ.cityAdBoards (props.js pushes each placed board:
   { mesh, mesh2?, x, z, y, kind, mat0, mat0b? }). Pricing scales with the
   district's busyness tier — a core-avenue face costs multiples of a docks
   shelter. Creatives render through props.js's shared cached canvas
   generator (CBZ.cityAdMatFor), so a rented board costs ZERO new materials
   when the same creative repeats.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  const REACH = 4.2;          // walk-up radius to a board's base / panel
  const AD_WEEK = 60;         // one city "week" of rent (seconds) — rides the same compressed clock as the pay/upkeep ticks
  const BIZ_BOOST = 0.12;     // each board running a business lifts its income +12%…
  const BIZ_BOOST_CAP = 3;    // …up to 3 boards/business (the 4th is pure flex)

  // weekly base rates by surface class — what the eyeballs are worth. Tuned
  // against zillow's commercial yield (0.0045/45s): a cheap shelter pushing a
  // ~$100k+ business PAYS; a core-avenue or rooftop face is mostly status —
  // ad spend works like real ad spend, the smart buy is the modest one.
  const BASE = { roof: 1200, bill: 700, small: 400, shelter: 150 };
  // the outdoor-media landlords you rent FROM, one per district (in-world
  // flavour: the prompt names who owns the surface, like any market here)
  const OWNERS = {
    downtown: "POLK OUTDOOR", uptown: "GOLDLEAF MEDIA", island: "ISLANDVIEW SIGNS",
    waterfront: "DOCKSIDE DISPLAYS", projects: "BLOK BOARDS",
  };

  function boards() { return CBZ.cityAdBoards || []; }
  function econ() { return CBZ.cityEcon || null; }
  function round5(n) { return Math.max(5, Math.round(n / 5) * 5); }
  function money(n) { n = Math.round(n || 0); return n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : "$" + n.toLocaleString(); }
  function hex(n) { return "#" + ("000000" + ((n | 0) & 0xffffff).toString(16)).slice(-6); }
  function darken(n, f) {
    const r = ((n >> 16) & 255) * f, gg = ((n >> 8) & 255) * f, b = (n & 255) * f;
    return "#" + ("000000" + (((r << 16) | (gg << 8) | b) | 0).toString(16)).slice(-6);
  }
  function note(msg, sec) { if (CBZ.city && CBZ.city.note) CBZ.city.note(msg, sec || 2.2); }

  // ---- PRICING: district busyness sets the rate ---------------------------
  // tier^4 turns the district spread (0.78..1.30) into real rent multiples:
  // an Island roof board runs ~8× a Projects shelter — pay for the eyeballs.
  function priceOf(b) {
    if (b.price) return b.price;
    const E = econ();
    let dk = "downtown", tier = 1;
    if (E && E.districtAt) { dk = E.districtAt(b.x, b.z); tier = (E.DISTRICTS && E.DISTRICTS[dk] ? E.DISTRICTS[dk].tier : 1) || 1; }
    b.district = dk;
    b.price = round5((BASE[b.kind] || 500) * Math.pow(tier, 4));
    return b.price;
  }
  function districtLabel(b) {
    const E = econ();
    return (E && E.districtName) ? E.districtName(b.district) : "the city";
  }
  function ownerOf(b) { priceOf(b); return OWNERS[b.district] || "CITY OUTDOOR"; }

  // ---- WHAT GOES UP: your empire, in priority order ------------------------
  // 1) a business you OWN (boards round-robin across them so the income bump
  //    spreads); 2) your founded gang; 3) YOU — your wealth-tier name as the
  //    brand, face stamped on it (the "yours" creative style in props.js).
  function ownedBiz() {
    const Z = CBZ.cityZillow, list = Z && Z.listings && Z.listings();
    if (!list) return [];
    const owned = g.cityRealtyOwned || {};
    const out = [];
    for (const rec of list) if (owned[rec.id] && rec.business && rec.legal !== false) out.push(rec);
    return out;
  }
  function boardsFor(bizId) {
    let n = 0;
    for (const b of boards()) if (b.lease && b.lease.bizId === bizId) n++;
    return n;
  }
  const BIZ_SLOGANS = [
    "house money, house rules",
    "you already know whose it is",
    "the boss banks here",
    "quality the block can't refuse",
  ];
  function brandAd(b) {
    // 1) an owned business — the board WORKS (income bump while it's up)
    const list = ownedBiz();
    if (list.length) {
      let best = null, bestN = 1e9;
      for (const rec of list) {
        const n = boardsFor(rec.id);
        if (n < bestN || (n === bestN && (rec.value || 0) > ((best && best.value) || 0))) { bestN = n; best = rec; }
      }
      const name = (best.business.name || best.name || "THE EMPIRE").toUpperCase();
      const slog = BIZ_SLOGANS[(best.id ? String(best.id).length : 0) % BIZ_SLOGANS.length];
      return { ad: [name, slog, 0x1a1408, 0xffd166, { kind: "yours", tag: "YOURS" }], bizId: best.id, bizName: name };
    }
    // 2) your gang — turf-wide intimidation, paid in clout
    const pg = g.playerGang;
    if (pg && pg.founded && pg.name) {
      return { ad: [pg.name.toUpperCase(), "this skyline is spoken for", darken(pg.color || 0x7ed957, 0.16), hex(pg.color || 0x7ed957), { kind: "yours", tag: "YOURS" }] };
    }
    // 3) YOU as the brand — the wealth-tier name in lights
    const E = econ();
    const tier = E && E.wealthTier ? E.wealthTier() : null;
    const head = ((tier && tier.name) || "NEW MONEY").toUpperCase();
    return { ad: [head, "you've seen the cars. now the name.", 0x131019, 0xffd166, { kind: "yours", tag: "YOURS" }] };
  }

  // ---- material swap + night glow ------------------------------------------
  // A swapped material must ride props.js's night driver (boards glow after
  // dark) — push it into the city's _nightAds and seed today's intensity.
  function glowNow(m) {
    const lit = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    m.emissiveIntensity = 0.06 + lit * 0.6;
    const A = CBZ.city && CBZ.city.arena, ads = A && A._nightAds;
    if (ads && ads.indexOf(m) < 0) ads.push(m);
  }

  function rentBoard(b) {
    const per = priceOf(b);
    if (!(CBZ.city && CBZ.city.spend && CBZ.city.spend(per))) {
      note("First week is " + money(per) + " cash — " + ownerOf(b) + " doesn't bill strangers.", 2.4);
      return;
    }
    const brand = brandAd(b);
    const m = CBZ.cityAdMatFor ? CBZ.cityAdMatFor(brand.ad) : null;
    if (!m) { CBZ.city.addCash(per); return; }   // generator missing — refund, no half-deal
    // E7: Zenith Media books half of every ad-board rental as real revenue
    // (sim/corporations.js's creditRevenue) — a rental fee the player already
    // pays, now flowing through the company's earnings too.
    if (CBZ.corps && CBZ.corps.creditRevenue) CBZ.corps.creditRevenue("zenith", per * 0.5);
    b.lease = { per, t: 0, bizId: brand.bizId || null, bizName: brand.bizName || null };
    b.mesh.material = m; b.mesh.userData.adLease = true;
    if (b.mesh2) { b.mesh2.material = m; b.mesh2.userData.adLease = true; }
    glowNow(m);
    if (CBZ.city.addRespect) CBZ.city.addRespect(4);   // the block SEES the board go up
    if (CBZ.sfx) CBZ.sfx("coin");
    if (brand.bizId) note("" + brand.bizName + " is on the board — its take climbs while this runs. " + money(per) + "/wk to " + ownerOf(b) + ".", 3);
    else note("Your name is up over " + districtLabel(b) + ". " + money(per) + "/wk to " + ownerOf(b) + " — clout has a rate.", 3);
  }

  function endLease(b, lapsed) {
    if (!b.lease) return;
    b.lease = null;
    if (b.mat0) b.mesh.material = b.mat0;
    b.mesh.userData.adLease = false;
    if (b.mesh2) { if (b.mat0b) b.mesh2.material = b.mat0b; b.mesh2.userData.adLease = false; }
    if (lapsed) note("" + ownerOf(b) + " pulled your board — the rent went unpaid.", 2.6);
    else note("Board released back to " + ownerOf(b) + ".", 2);
  }

  // ---- THE PAYOFF: advertised businesses earn more --------------------------
  // zillow.js's income tick multiplies a business's payout by this (one-line
  // hook there). Reads live leases, so a lapsed board stops paying instantly.
  CBZ.cityAdBoost = function (rec) {
    if (!rec || !rec.id) return 1;
    const n = boardsFor(rec.id);
    return n > 0 ? 1 + BIZ_BOOST * Math.min(BIZ_BOOST_CAP, n) : 1;
  };

  // wipe every lease without refund (a fresh run's skyline starts neutral)
  CBZ.cityAdBoardsReset = function () {
    for (const b of boards()) if (b.lease) {
      b.lease = null;
      if (b.mat0) b.mesh.material = b.mat0;
      b.mesh.userData.adLease = false;
      if (b.mesh2) { if (b.mat0b) b.mesh2.material = b.mat0b; b.mesh2.userData.adLease = false; }
    }
  };

  // ---- WEEKLY RENT TICK (the upkeep pattern: bank first, then cash) --------
  // PERF: rent is a 60s clock — walking every board per FRAME just to bump a
  // float is waste. Accumulate dt and sweep at ~4 Hz; lease timing is identical
  // because the accumulated step is what's added.
  let _rentAcc = 0;
  CBZ.onUpdate(30.8, function (dt) {
    if (g.mode !== "city") return;
    _rentAcc += dt;
    if (_rentAcc < 0.25) return;
    const step = _rentAcc; _rentAcc = 0;
    const list = boards();
    for (const b of list) {
      const L = b.lease; if (!L) continue;
      L.t += step;
      if (L.t < AD_WEEK) continue;
      L.t -= AD_WEEK;
      const due = L.per, bank = g.cityBank || 0;
      if (bank >= due) g.cityBank = bank - due;
      else if ((g.cash || 0) >= due - bank) {
        g.cityBank = 0;
        if (CBZ.city && CBZ.city.spend) CBZ.city.spend(due - bank);
        else g.cash = Math.max(0, (g.cash || 0) - (due - bank));
      }
      else { endLease(b, true); continue; }     // broke → the landlord pulls it
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      // E7: Zenith Media books half of every renewal too (see rentBoard()'s
      // matching hook for the first week).
      if (CBZ.corps && CBZ.corps.creditRevenue) CBZ.corps.creditRevenue("zenith", due * 0.5);
      // every board also pays in CLOUT: a week of your name over the street
      if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(2);
    }
  });

  // ---- the tiny walk-up prompt chip (one DOM node, hidden when idle) -------
  // Sits just under the elevator chip's slot so the two never overlap.
  let chip = null;
  function dom() {
    if (chip || typeof document === "undefined" || !document.body) return;
    try {
      chip = document.createElement("div");
      chip.id = "adChip";
      chip.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:214px;z-index:24;display:none;" +
        "padding:6px 12px;border-radius:9px;background:rgba(20,14,4,.8);border:1px solid rgba(255,209,102,.35);" +
        "color:#ffe2a0;font:600 13px/1.2 'Fredoka',system-ui,sans-serif;pointer-events:none;text-shadow:0 1px 2px #000";
      document.body.appendChild(chip);
    } catch (e) { chip = null; }
  }
  // PERF: skip the DOM writes unless the text changed — re-setting the same
  // textContent/display at the 12 Hz tick still dirties the DOM for nothing.
  let _chipLast;
  function chipText(t) {
    if (t === _chipLast) return;
    dom(); if (!chip) return;
    _chipLast = t;
    if (!t) { chip.style.display = "none"; return; }
    chip.style.display = "block"; chip.textContent = t;
  }

  // is the player standing at an elevator pad? The lift's [E] outranks ours.
  function liftNearby() {
    const els = CBZ.cityElevators && CBZ.cityElevators(); if (!els) return false;
    const P = CBZ.player;
    for (const el of els) {
      if (P.pos.y < 2.0 && Math.hypot(P.pos.x - el.groundPad.x, P.pos.z - el.groundPad.z) <= 2.6) return true;
      if (Math.abs(P.pos.y - el.b.h) < 1.6 && Math.hypot(P.pos.x - el.roofPad.x, P.pos.z - el.roofPad.z) <= 2.6) return true;
    }
    return false;
  }

  function boardNear() {
    const P = CBZ.player; if (!P) return null;
    const px = P.pos.x, pz = P.pos.z, py = P.pos.y || 0;
    let best = null, bd = REACH;
    for (const b of boards()) {
      if (Math.abs((b.y || 0) - py) > 4) continue;   // rooftop boards rent from THAT roof
      const d = Math.hypot(b.x - px, b.z - pz);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // ~12 Hz proximity prompt: owner + price up front, like any market here
  let acc = 0;
  CBZ.onUpdate(36.8, function (dt) {
    if (g.mode !== "city") { chipText(null); return; }
    acc += dt; if (acc < 1 / 12) return; acc = 0;
    const P = CBZ.player;
    if (g.state !== "playing" || !P || P.dead || P.driving || CBZ.cityMenuOpen || liftNearby()) { chipText(null); return; }
    const b = boardNear();
    if (!b) { chipText(null); return; }
    if (b.lease) {
      chipText("[E] Pull your ad — " + (b.lease.bizName ? b.lease.bizName + " · " : "") + money(b.lease.per) + "/wk runs until you do");
    } else {
      chipText("[E] Rent this board — " + money(priceOf(b)) + "/wk · " + ownerOf(b) + " (" + districtLabel(b) + ")");
    }
  });

  // [E] signs / ends the lease. DOCUMENT-level so stopPropagation beats
  // interact.js's window-level "[E] = eat" fallback (the elevator pattern).
  function onKey(e) {
    if (g.mode !== "city" || g.state !== "playing" || CBZ.cityMenuOpen) return;
    const P = CBZ.player;
    if (!P || P.dead || P.driving) return;
    if ((e.key || "").toLowerCase() !== "e") return;
    if (liftNearby()) return;                       // the lift wins this spot
    const b = boardNear();
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (b.lease) endLease(b, false);
    else rentBoard(b);
  }
  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("keydown", onKey);
})();
