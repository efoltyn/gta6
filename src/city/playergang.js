/* ============================================================
   city/playergang.js — YOUR GANG, IN THE WORLD.

   OWNER: "No dashboards are needed. Everything can be existing in the
   world. No need for a gang management dashboard: you can see gang members
   wearing the same colors and recruit people."

   There is no gang screen. Everything this file does happens on a person
   or on a piece of ground:

   RECRUITING. Walk up to somebody and ask (the card's Recruit). He answers
   by who he is: what he thinks of you (city/social.js relPlayer), how big
   you are next to him (city/level.js), whether he has a job and money or
   nothing to lose, how much nerve he has, how many of yours he has seen
   buried lately, how hot you are. He says yes, names a price (pay it, or
   lean on him with the card's Threaten), or says no and means it for a
   while. A man who already wears another set's colours can be bought, at a
   price that rises with his rank and his loyalty, and at a risk: turn the
   wrong one down and he tells his people. With their boss dead by your
   hand, the same question to any of them is for the whole crew.
   Your gang starts the day the first one says yes. Nothing is founded on
   a menu and nothing has a name screen.

   COLOURS. The gang wears what you wear: its colour is the shirt on your
   back when it starts (or the first colour no other set flies), every
   member is dressed in it with the crew's rag (city/outfits.js record
   "gang:player", city/clothes.js bandana), and "Wear my colours" on any of
   them re-dresses the lot after you change.

   ORDERS go to the man in front of you: Come, Hold here (he takes that
   corner), Guard the door, Sell here, Go home; on his wheel the same for
   everybody in earshot. Each is an order like any other (systems/
   command.js): he does it, says "Sir?", or will not. Kill / Beat / Back
   off about a third person are city/orders.js's, on that person.

   MONEY IS ON PEOPLE. A man selling takes cash hand to hand (city/
   gangops.js's buyer staging) and a man holding one of your blocks takes
   that block's street money; it sits in his pockets (ped.cash) until you
   Collect from him, he keeps his cut, and if he is shot or arrested first
   it goes with him. Nothing is wired to a bank.

   TURF is who is standing on it. A block where your people hold a post
   with no rival standing on it becomes yours; a block of yours with none
   of you on it and a rival crew on it becomes theirs. The colours on the
   people and the tag on the wall (city/turftags.js) are the readout.

   JOINING SOMEBODY ELSE'S CREW is the same file's older half: prospect a
   set, do the four tasks, take the beating or do the hit (both asked of a
   member, face to face), climb, and take the chair when the boss dies.

   Exposes: CBZ.cityPlayerGangEnsure / Exists / Id / Members / IsMember /
   Enlist / ClaimTurf / Sync / Restore / CrewSave / BossKilled / Claim /
   Promote / Order / Apply / DefendTurf / Reset, CBZ.cityCrewAsk,
   CBZ.cityCrewPost, CBZ.cityGangInitiate, and the prospect / membership
   API (cityProspectGang, cityJoinGang, cityLeaveGang, cityMemberPutInWork).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;

  // colours a new set can fly when the shirt on your back is no colour at all
  const COLORS = [0xffd166, 0xff4d4d, 0x36e0d0, 0xc77dff, 0x9be564, 0xff8c42];
  const NAME_A = ["Iron", "Black", "Red", "Night", "Concrete", "Wolf", "Ghost", "Royal", "Savage", "Empire"];
  const NAME_B = ["Syndicate", "Mob", "Crew", "Kings", "Cartel", "Lords", "Wolves", "Dynasty", "Saints", "Mafia"];

  function rnd() { return Math.random(); }
  function pick(a) { return a[(rnd() * a.length) | 0]; }
  function hex6(n) { return "#" + ("000000" + (n >>> 0).toString(16)).slice(-6); }
  function money(n) { n = Math.round(+n) || 0; return "$" + n.toLocaleString("en-US"); }
  function shortGang(n) { if (!n) return "them"; const w = n.split(" "); return w.length > 1 ? w[w.length - 1] : n; }
  function arena() { return CBZ.city && CBZ.city.arena; }
  function playerActor() { return (CBZ.city && CBZ.city.playerActor) || CBZ.player; }
  function say(ped, line, secs) {
    if (!ped || ped.dead || !line || !CBZ.citySay) return false;
    try { return !!CBZ.citySay(ped, line, "#ffffff", secs || 2.6); } catch (e) { return false; }
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  let T = 0;                               // this file's own clock, seconds

  // nearest LIVE rival gang record (an actual faction, not the player's)
  function nearestRival() {
    const P = CBZ.player; if (!P || !CBZ.cityGangs) return null;
    let best = null, bd = Infinity;
    for (const gn of CBZ.cityGangs) {
      if (!gn || gn.isPlayer || gn.absorbed || gn.id === "player" || !gn.turf || !gn.turf.length) continue;
      const c = gn.center || gn.turf[0];
      const d = Math.hypot((c.x != null ? c.x : c.cx) - P.pos.x, (c.z != null ? c.z : c.cz) - P.pos.z);
      if (d < bd) { bd = d; best = gn; }
    }
    return best;
  }

  // ---- lazy state ----
  function ensure() {
    if (!g.playerGang) {
      g.playerGang = { id: "player", name: null, color: 0x7ed957, members: [], turf: [], boss: null, founded: false, center: null, lost: 0 };
    }
    // a ledger-restored gang is a SAFE SHELL (worldstate.js cannot carry live
    // ped/lot refs): heal the live-ref fields so every caller can trust them
    const pg = g.playerGang;
    if (!pg.id) pg.id = "player";
    if (!pg.members) pg.members = [];
    if (!pg.turf) pg.turf = [];
    return pg;
  }
  CBZ.cityPlayerGangEnsure = ensure;

  function exists() { return !!(g.playerGang && g.playerGang.founded); }
  CBZ.cityPlayerGangExists = exists;

  // THE one "which crew does the player ride with" read: patched into an NPC
  // crew (g.cityMembership), else your own, else the legacy mirror.
  CBZ.cityPlayerGangId = function () {
    const m = g.cityMembership;
    if (m && m.gangId) return m.gangId;
    if (g.playerGang && g.playerGang.founded) return g.playerGang.id;
    return g.playerGangId || null;
  };

  // A MAN WHO DIES IS GONE. The roster is the people who are alive, still in
  // the world and still yours. (A death is counted, pg.lost, by the gang's
  // tick: the next man you ask has heard about it.)
  function liveMembers() {
    const pg = g.playerGang ? ensure() : null; if (!pg) return [];
    let w = 0;
    for (let i = 0; i < pg.members.length; i++) {
      const m = pg.members[i];
      const ok = m && !m.dead && !m.collected && m.recruited && (m.gang === pg.id || m.faction === "player");
      if (ok) pg.members[w++] = m;
    }
    pg.members.length = w;
    return pg.members;
  }
  CBZ.cityPlayerGangMembers = liveMembers;
  function isMember(ped) { return !!(ped && g.playerGang && g.playerGang.members && g.playerGang.members.indexOf(ped) >= 0); }
  CBZ.cityPlayerGangIsMember = isMember;

  function rankPip(key) { return (CBZ.cityRankName ? CBZ.cityRankName(key) : (key === "lt" ? "Lt." : "Crew")); }

  // the name over him, in the gang's colour, with his rank
  function styleMember(ped, color) {
    if (!ped) return;
    ped.tagColor = hex6(color);
    if (ped.tag && ped.char && ped.char.group && CBZ.makeLabelSprite) {
      const pip = rankPip(ped.rank);
      const txt = (ped.name || "Crew") + (pip ? " · " + pip : "");
      const lbl = CBZ.makeLabelSprite(txt, { color: hex6(color) });
      lbl.position.y = ped.tag.position.y || (CBZ.charHeadY ? CBZ.charHeadY(ped.char) : 1.97); lbl.scale.copy(ped.tag.scale);
      if (ped.tag.parent) ped.tag.parent.remove(ped.tag);
      ped.char.group.add(lbl); ped.tag = lbl; ped.tag.visible = false;
    }
  }

  /* ---- COLOURS -----------------------------------------------------------
     One outfit record, "gang:player", in the same catalog every other set's
     colours live in (city/outfits.js): a solid shirt and sleeves in the gang
     colour, dark trousers, and the rag recolorRig ties for any record with a
     `.gang`. A member wears it as p._wornOutfit, which is the field every
     re-dress in the game already honours, so nothing can paint him back. */
  const FIT = { id: "gang:player", name: "Your Colors", tier: "gang", who: "your crew", price: 0, drip: 2, gang: "player",
    colors: { legs: 0x23262c, torso: 0x7ed957, collar: 0x141820, arms: 0x7ed957, shoes: 0x191b20 } };
  function fit() {
    const pg = ensure();
    FIT.colors.torso = FIT.colors.arms = pg.color;
    FIT.name = (pg.name || "Your") + " Colors"; FIT.who = pg.name || "your crew";
    try {
      const CAT = CBZ.cityOutfitCatalog ? CBZ.cityOutfitCatalog() : null;
      if (CAT && CAT["gang:player"] !== FIT) CAT["gang:player"] = FIT;
    } catch (e) {}
    return FIT;
  }
  function dress(ped) {
    if (!ped || ped.dead || !ped.char) return;
    const rec = fit();
    if (ped._wornOutfit !== rec) { ped._pgOwnFit = ped._wornOutfit || null; ped._wornOutfit = rec; }
    ped.outfit = rec.colors.torso;
    try {
      if (CBZ.cityRedressPed) CBZ.cityRedressPed(ped);
      else if (CBZ.cityRecolorRig) CBZ.cityRecolorRig(ped.char, rec.colors, rec);
    } catch (e) {}
  }
  function undress(ped) {
    if (!ped || ped._wornOutfit !== FIT) return;
    ped._wornOutfit = ped._pgOwnFit || null; ped._pgOwnFit = null;
    try { if (!ped.dead && CBZ.cityRedressPed) CBZ.cityRedressPed(ped); } catch (e) {}
  }
  function rgb(h) { return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }
  function vivid(h) { const c = rgb(h), mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]); return mx >= 110 && mx - mn >= 70; }
  function flown(h) {
    const a = rgb(h);
    for (const gn of CBZ.cityGangs || []) {
      if (!gn || gn.isPlayer || gn.absorbed || gn.color == null) continue;
      const b = rgb(gn.color);
      if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 110) return true;
    }
    return false;
  }
  function playerShirt() {
    let w = null;
    try { w = CBZ.cityOutfitGetEffective ? CBZ.cityOutfitGetEffective() : null; } catch (e) { w = null; }
    const c = w && w.colors ? w.colors.torso : null;
    return typeof c === "number" ? c : null;
  }
  // what the gang flies: your shirt if it is a colour nobody else flies
  function pickColour() {
    const mine = playerShirt();
    if (mine != null && vivid(mine) && !flown(mine)) return mine;
    for (let i = 0; i < COLORS.length; i++) if (!flown(COLORS[i])) return COLORS[i];
    return COLORS[0];
  }
  function recolour(hex) {
    const pg = ensure();
    pg.color = hex;
    fit();
    for (const m of liveMembers()) { dress(m); styleMember(m, hex); }
    for (const lot of pg.turf) if (lot.building) lot.building.gangColor = hex;
    registerInGangList();
    if (CBZ.cityTurfTagsDirty) CBZ.cityTurfTagsDirty();
  }

  // the gang starts the day somebody joins it
  function found() {
    const pg = ensure(); if (pg.founded) return;
    pg.founded = true;
    if (!pg.name) pg.name = pick(NAME_A) + " " + pick(NAME_B);
    pg.color = pickColour();
    fit();
    g.career = g.career || "gangster";
    registerInGangList();
    if (CBZ.cityRankEvent) CBZ.cityRankEvent("gang-founded", { members: 1 });
  }

  // bring a ped into YOUR gang (a recruit, a defector, a restored body)
  function enlist(ped, rank, o) {
    const pg = ensure();
    if (!ped || ped.dead) return false;
    if (!pg.founded) found();
    if (pg.members.indexOf(ped) < 0) pg.members.push(ped);
    ped.gang = pg.id; ped.faction = "player";
    ped.recruited = true; ped.kind = "crew";
    ped.rank = rank || ped.rank || "soldier";
    // HE STANDS HIS GROUND, AND THAT IS ALL THE NERVE HE IS GIVEN (the street's
    // "bold" band, config aggro): he fights whoever comes at him, at you or at
    // his corner, and he does not go mugging the block on his own account. A
    // man who was a hothead before you hired him still is one. (Every recruit
    // used to be set to 0.92, the band that carjacks and attacks police, which
    // is why a crew left on a corner started fights with the people on it.)
    if (ped._hireAggr == null) ped._hireAggr = ped.aggr;   // restored by CBZ.cityDismiss
    ped.aggr = Math.max(ped.aggr || 0, 0.62);
    // he comes with what he carries; a man with nothing fights with his hands
    // until somebody puts a piece in them (city/loyalty.js Give gun)
    if (ped.armed && ped.weapon) ped.ammo = Math.max(ped.ammo | 0, 90);
    ped.maxHp = Math.max(ped.maxHp || 100, ped.rank === "lt" ? 200 : 140);
    ped.hp = Math.max(ped.hp || 1, Math.round(ped.maxHp * 0.85));
    ped.alarmed = 0; ped.surrender = false; ped.rage = null; ped.staffPost = null;
    if (CBZ.cityMemberStats) { const s = CBZ.cityMemberStats(ped); s.loyalty = Math.max(s.loyalty, (o && o.loyalty) || 0.6); s.joined = (o && o.how) || "recruit"; }
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    dress(ped);
    styleMember(ped, pg.color);
    ped._pgPaidT = T;
    if (!ped._post) post(ped, (o && o.post) || "follow", o && o.at);
    registerInGangList();
    g.cityCrew = liveMembers().length;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  CBZ.cityPlayerGangEnlist = enlist;

  // being let go (city/brain_city.js cityDismiss) takes the colours off him
  (function wrapDismiss() {
    const orig = CBZ.cityDismiss;
    if (typeof orig !== "function" || orig._pgWrap) return;
    const w = function (p, o) {
      const mine = isMember(p);
      const r = orig.apply(this, arguments);
      if (mine && p) { undress(p); p._post = null; p._take = 0; }
      return r;
    };
    for (const k in orig) { try { w[k] = orig[k]; } catch (e) {} }
    w._pgWrap = true;
    CBZ.cityDismiss = w;
    if (CBZ.cityBrain && CBZ.cityBrain.dismiss === orig) CBZ.cityBrain.dismiss = w;
  })();

  /* ---- LOTS ----------------------------------------------------------------
     Turf is a lot. Every position below comes off the lot's own record (its
     centre, its building's rect and door), never a coordinate. */
  function allLots() {
    const A = arena(); if (!A) return [];
    return (A.annex && A.annex.lots && A.annex.lots.length) ? (A.lots || []).concat(A.annex.lots) : (A.lots || []);
  }
  function lotReach(lot) { return Math.max(lot.w || 16, lot.d || 16) * 0.5 + 8; }
  function holdable(lot) { return !!(lot && lot.building && !lot.building.park && !lot.demolished); }
  function lotNear(x, z, r) {
    let best = null, bd = Infinity;
    for (const lot of allLots()) {
      if (!holdable(lot)) continue;
      const d = Math.hypot(lot.cx - x, lot.cz - z);
      if (d > (r != null ? r : lotReach(lot))) continue;
      if (d < bd) { bd = d; best = lot; }
    }
    return best;
  }
  // the building's own rect, built or not yet streamed in
  function rectOf(lot) {
    const b = lot.building || {};
    const cx = b.ox != null ? b.ox : (b.x != null ? b.x : lot.cx), cz = b.oz != null ? b.oz : (b.z != null ? b.z : lot.cz);
    return { cx: cx, cz: cz, hw: (b.w || lot.w || 16) / 2, hd: (b.d || lot.d || 16) / 2 };
  }
  /* THE FRONT OF A BUILDING, from its door and its rect. The door record's own
     normal points in on a city block and out on a town house, so it is not
     asked: `out` is the side of the rect the door is on. */
  function frontOf(lot) {
    const b = lot && lot.building, d = b && b.door;
    if (!d) return null;
    const r = rectOf(lot);
    const dx = d.x - r.cx, dz = d.z - r.cz;
    let ox = 0, oz = 0, fx, fz, half, mx, mz;
    if (Math.abs(dx) / r.hw > Math.abs(dz) / r.hd) { ox = dx < 0 ? -1 : 1; fx = r.cx + ox * r.hw; fz = d.z; half = r.hd; mx = fx; mz = r.cz; }
    else { oz = dz < 0 ? -1 : 1; fx = d.x; fz = r.cz + oz * r.hd; half = r.hw; mx = r.cx; mz = fz; }
    // (x, z) the wall at the door; (mx, mz) the middle of that wall and `half`
    // its half-length; out = (ox, oz); along the wall = (tx, tz)
    return { x: fx, z: fz, ox: ox, oz: oz, tx: -oz, tz: ox, half: half, mx: mx, mz: mz, cx: r.cx, cz: r.cz, hw: r.hw, hd: r.hd, lot: lot };
  }
  CBZ.cityLotFront = frontOf;

  function gangRecById(id) { return (CBZ.cityGangs || []).find((x) => x.id === id); }
  function gangShort(rec) { return rec ? shortGang(rec.name) : "them"; }

  // a lot becomes yours (from nobody, or from the set that held it)
  function takeLot(lot) {
    const pg = ensure();
    if (!pg.founded || !holdable(lot)) return false;
    const prev = lot.building.gang;
    if (prev && prev !== pg.id) {
      const og = gangRecById(prev);
      if (og && og.turf) { const i = og.turf.indexOf(lot); if (i >= 0) og.turf.splice(i, 1); }
    }
    const fresh = pg.turf.indexOf(lot) < 0;
    if (fresh) pg.turf.push(lot);
    lot.building.gang = pg.id; lot.building.gangColor = pg.color; lot.building.playerTurf = true;
    if (lot.building.stash) lot.building.stash.gang = pg.id;
    if (!pg.center) pg.center = { x: lot.cx, z: lot.cz };
    registerInGangList();
    if (CBZ.cityRefreshTurfHud) CBZ.cityRefreshTurfHud();
    if (CBZ.cityTurfTagsDirty) CBZ.cityTurfTagsDirty();
    if (fresh && CBZ.cityRankEvent) CBZ.cityRankEvent("turf", { lot: lot });
    if (fresh) CBZ.city.addRespect(3);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return fresh;
  }
  // a lot of yours goes to the set standing on it
  function loseLot(lot, to) {
    const pg = ensure();
    const i = pg.turf.indexOf(lot); if (i < 0) return false;
    pg.turf.splice(i, 1);
    if (to && to.turf && to.turf.indexOf(lot) < 0) to.turf.push(lot);
    if (lot.building) {
      lot.building.gang = to ? to.id : null; lot.building.gangColor = to ? to.color : null; lot.building.playerTurf = false;
      if (lot.building.stash) lot.building.stash.gang = to ? to.id : null;
    }
    if (pg.center && pg.turf.length) pg.center = { x: pg.turf[0].cx, z: pg.turf[0].cz };
    registerInGangList();
    if (CBZ.cityRefreshTurfHud) CBZ.cityRefreshTurfHud();
    if (CBZ.cityTurfTagsDirty) CBZ.cityTurfTagsDirty();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  // the block at a point (turf.js's neutral grab, careers.js's crew contract)
  CBZ.cityPlayerGangClaimTurf = function (x, z) {
    const lot = lotNear(x, z, 24);
    return lot ? takeLot(lot) : false;
  };

  // mirror g.playerGang into CBZ.cityGangs so shared systems treat it as a gang.
  // The plain rec shares the SAME turf/members arrays; only identity fields
  // need re-stamping.
  function registerInGangList() {
    const pg = g.playerGang && g.playerGang.founded ? ensure() : null;
    if (!pg || !CBZ.cityGangs) return;
    let rec = CBZ.cityGangs.find((x) => x.id === pg.id);
    if (!rec) {
      rec = { id: pg.id, name: pg.name, color: pg.color, turf: pg.turf, center: pg.center || { x: 0, z: 0 }, provoke: 0, members: pg.members, warWith: null, warRemain: 0, isPlayer: true };
      CBZ.cityGangs.push(rec);
    } else {
      rec.name = pg.name; rec.color = pg.color; rec.turf = pg.turf; rec.members = pg.members; rec.center = pg.center || rec.center;
    }
  }
  CBZ.cityPlayerGangSync = registerInGangList;

  /* ---- SAVE / RESTORE (rides gangs.js's GANG_PERSIST blob) -------------------
     The crew is saved as PEOPLE: each man's name, rank, what he was told to do
     and where, and the money on him. A man who died is simply not in the list.
     Bodies come back through the shared post (city/occupy.js) and the normal
     enlist path. Old saves carried only a head count per rank; those come back
     as that many new men. */
  CBZ.cityPlayerGangCrewSave = function () {
    const out = [];
    for (const m of liveMembers()) {
      const p = m._post || { kind: "follow" };
      out.push({
        n: m.name || null, r: m.rank || "soldier", k: p.kind,
        x: p.x != null ? Math.round(p.x * 10) / 10 : Math.round(m.pos.x * 10) / 10,
        z: p.z != null ? Math.round(p.z * 10) / 10 : Math.round(m.pos.z * 10) / 10,
        f: p.face != null ? Math.round(p.face * 100) / 100 : null,
        w: m.armed && m.weapon ? m.weapon : null,
        t: Math.round(m._take || 0), c: Math.min(50000, Math.round(m.cash || 0)),
        a: m.aggr != null ? Math.round(m.aggr * 100) / 100 : null,
        l: m.gstat ? Math.round(m.gstat.loyalty * 100) / 100 : null,
      });
    }
    return out;
  };
  function crewPost(x, z, o) {
    if (CBZ.cityPostNpc) return CBZ.cityPostNpc(x, z, o);
    if (!CBZ.cityMakePed || !CBZ.cityPeds || !o.parent) return null;
    const p = CBZ.cityMakePed(x, z, o.rng, o);
    if (!p) return null;
    o.parent.add(p.group); CBZ.cityPeds.push(p);
    return p;
  }
  CBZ.cityPlayerGangRestore = function (rec) {
    if (!rec || !rec.founded) return false;
    const A = arena(); if (!A || !A.lots || !A.lots.length) return false;
    const pg = ensure();
    pg.founded = true;
    if (rec.name) pg.name = rec.name;
    if (rec.color != null) pg.color = rec.color;
    fit();
    pg.turf.length = 0;
    for (const li of rec.turf || []) {
      const lot = A.lots[li]; if (!lot) continue;
      pg.turf.push(lot);
      lot.building = lot.building || {};
      lot.building.gang = pg.id; lot.building.gangColor = pg.color; lot.building.playerTurf = true;
      if (lot.building.stash) lot.building.stash.gang = pg.id;
    }
    if (pg.turf.length) pg.center = { x: pg.turf[0].cx, z: pg.turf[0].cz };
    g.career = g.career || "gangster";
    let crew = Array.isArray(rec.crew) ? rec.crew.slice() : null;
    if (!crew) {
      // an old save: a head count per rank, on the turf
      crew = [];
      const want = rec.roster || {};
      for (const rk in want) for (let k = 0, n = want[rk] | 0; k < n; k++) crew.push({ n: null, r: rk, k: "home" });
    }
    const P = CBZ.player;
    for (let i = 0; i < crew.length; i++) {
      const c = crew[i];
      const lot = pg.turf.length ? pg.turf[i % pg.turf.length] : null;
      // a man who was walking with you comes back beside you
      let x = c.x, z = c.z;
      if (c.k === "follow" || x == null || z == null) {
        if (c.k === "follow" && P && P.pos) { x = P.pos.x + (rnd() - 0.5) * 5; z = P.pos.z + (rnd() - 0.5) * 5; }
        else if (lot) { x = lot.cx + (rnd() - 0.5) * 6; z = lot.cz + (rnd() - 0.5) * 6; }
        else continue;
      }
      const o = {
        src: "playergang:crew", rng: rnd, parent: A.root,
        kind: "gang", gang: pg.id, faction: "player", outfit: pg.color,
        aggr: c.a != null ? c.a : 0.66, archetype: "gangster", job: "crew", wealth: 0.3,
        armed: !!c.w, weapon: c.w || null, hp: 140,
        cash: Math.max(0, (c.c | 0)),
      };
      if (c.n) o.name = c.n;
      const ped = crewPost(x, z, o);
      if (!ped) continue;
      ped._post = null;
      enlist(ped, c.r || "soldier", { post: c.k || "home", at: (c.x != null && c.k !== "follow") ? { x: c.x, z: c.z, face: c.f } : null, loyalty: c.l || 0.6, how: "restore" });
      if (c.t > 0) ped._take = Math.min(c.t, ped.cash | 0);
    }
    registerInGangList();
    g.cityCrew = liveMembers().length;
    if (CBZ.cityRefreshTurfHud) CBZ.cityRefreshTurfHud();
    if (CBZ.cityTurfTagsDirty) CBZ.cityTurfTagsDirty();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  };

  /* ---- TAKING OVER A CREW WHOSE BOSS YOU KILLED ------------------------------
     gangs.js tells us the boss is down (cityPlayerGangBossKilled). For a while
     after, the survivors are a crew without a chair, and the question "who do
     you work for now" (the card's Recruit, on any of them) is asked of all of
     them at once: THE ASK below decides it. */
  let pendingClaim = null;
  CBZ.cityPlayerGangBossKilled = function (gangRec) {
    if (!gangRec || gangRec.isPlayer || gangRec.id === "player") return;
    pendingClaim = { rec: gangRec, t: 90 };
    crewSays(gangRec, "He's down. So who's running this now?", 3.4);
  };

  function claimRivalGang(rec) {
    if (!rec) return false;
    const pg = ensure();
    if (!pg.founded) { pg.founded = true; pg.name = rec.name; pg.color = rec.color; fit(); g.career = g.career || "gangster"; }
    pg.center = pg.center || (rec.center ? { x: rec.center.x, z: rec.center.z } : null);
    // their turf becomes yours
    for (const lot of (rec.turf || [])) {
      if (pg.turf.indexOf(lot) < 0) pg.turf.push(lot);
      if (lot.building) { lot.building.gang = pg.id; lot.building.gangColor = pg.color; lot.building.playerTurf = true; if (lot.building.stash) lot.building.stash.gang = pg.id; }
    }
    // the survivors change colours where they stand, and keep their posts
    let defected = 0;
    for (const m of (rec.members || []).slice()) {
      if (!m || m.dead || m === rec.boss) continue;
      const at = m.guard ? { x: m.guard.x, z: m.guard.z } : { x: m.pos.x, z: m.pos.z };
      m._post = null;
      enlist(m, m.rank === "lt" ? "lt" : "soldier", { post: "corner", at: at, how: "takeover", loyalty: 0.5 });
      defected++;
    }
    rec.turf = []; rec.members = []; rec.absorbed = true; rec.provoke = 0;
    const i = CBZ.cityGangs ? CBZ.cityGangs.indexOf(rec) : -1;
    if (i >= 0) CBZ.cityGangs.splice(i, 1);
    registerInGangList();
    if (CBZ.cityRefreshTurfHud) CBZ.cityRefreshTurfHud();
    if (CBZ.cityTurfTagsDirty) CBZ.cityTurfTagsDirty();
    g.cityCrew = liveMembers().length;
    pendingClaim = null;
    CBZ.city.addRespect(25);
    if (CBZ.cityRankEvent) CBZ.cityRankEvent("takeover", { gang: rec, defected });
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }

  // ============================================================
  //  PROSPECTING + INITIATION — the player JOINS an existing crew (researched
  //  street path, distinct from founding/taking over). The lifecycle:
  //    1) PROSPECT a gang (pick a crew whose turf you're on / near a member).
  //    2) Build STANDING: hang on their turf, do favors, and PUT IN WORK
  //       (drop a rival for them). Standing unlocks the initiation offer.
  //    3) Get INITIATED two real ways:
  //         JUMPED IN  — survive a timed beating from 3+ members (take the
  //                      punishment without going down = heart).
  //         PUT IN WORK — accept a hit contract on a named rival; fulfil it.
  //    4) On success you're PATCHED IN at the bottom rank and climb on merit;
  //       the player's street XP + bodies feed your standing inside the crew,
  //       and you can later rise to lead it.
  // ============================================================
  // membership-in-an-NPC-gang state (the player as a MEMBER, not the boss)
  function memb() {
    if (!g.cityMembership) g.cityMembership = null;
    return g.cityMembership;   // { gangId, rank, standing, bodies, contrib, loyalty }
  }
  CBZ.cityMembership = memb;
  let prospecting = null;    // { gangId, tasks:[...], idx } while courting a crew (see TASK SEQUENCE)
  let jumpedIn = null;       // { gangId, t, hits, need } during a jump-in beating
  let workContract = null;   // { gangId, target, t } during a put-in-work hit

  /* THE CREW TELLS YOU, OR NOBODY DOES. Prospecting used to run on banners
     ("PROSPECTING: X", "HANDLE BUSINESS: drop Y. Follow the beacon."), a HUD
     objective line, a map waypoint to their HQ and a beacon over every mark:
     the game narrating its own quest. Now what you are told comes out of the
     mouth of whichever member of the set is standing near you, in his own
     words, and if nobody is near, nobody tells you. */
  function crewSays(rec, line, secs) {
    if (!rec || !line || !CBZ.citySay) return false;
    const P = CBZ.player; if (!P || !P.pos) return false;
    let best = null, bd = 26;
    for (const m of (rec.members || [])) {
      if (!m || m.dead || !m.pos) continue;
      const d = Math.hypot(m.pos.x - P.pos.x, m.pos.z - P.pos.z);
      if (d < bd) { bd = d; best = m; }
    }
    if (!best) return false;
    try { return !!CBZ.citySay(best, line, "#ffffff", secs || 3); } catch (e) { return false; }
  }
  // "over by the east side" from a speaker toward a point, in words
  function pointWords(from, to) {
    if (!from || !from.pos || !to || !to.pos) return "";
    const dx = to.pos.x - from.pos.x, dz = to.pos.z - from.pos.z;
    if (Math.hypot(dx, dz) < 12) return "right there";
    const ns = dz < 0 ? "north" : "south", ew = dx < 0 ? "west" : "east";
    const dir = Math.abs(dx) > Math.abs(dz) * 1.6 ? ew : Math.abs(dz) > Math.abs(dx) * 1.6 ? ns : ns + ew;
    return "down the " + dir + " end";
  }

  // nearest rival crew the player could prospect (on/near their turf, has a boss)
  function prospectableGang() {
    const P = CBZ.player; if (!P) return null;
    // prefer the turf you're standing in
    const here = CBZ.cityGangOf && CBZ.cityGangOf(P.pos.x, P.pos.z);
    if (here && !here.isPlayer && !here.absorbed && here.boss && !here.boss.dead) return here;
    return nearestRival();
  }

  // ============================================================
  //  PROSPECT TASK SEQUENCE — an ORDERED list of jobs you must complete, in
  //  order, to be patched in. Each task carries its own progress logic; the
  //  active one is prospecting.tasks[prospecting.idx]. Only completing T4
  //  (the final rival hit) makes initiationReady() true.
  //
  //    T1 EARN TRUST    — raise your STANDING with the crew to a threshold
  //                       (CBZ.cityGangStanding; grows via cityDoFavor on
  //                       members + hanging on their turf).
  //    T2 PUT IN WORK   — kill ANY civilian (prove willingness).
  //    T3 HANDLE BIZ    — drop a SPECIFIC marked target (exact ped id).
  //    T4 HIT A RIVAL   — drop a member of a RIVAL gang (beaconed mark, with a
  //                       waypoint to the nearest rival HQ).
  // ============================================================
  const TRUST_THRESHOLD = 35;   // standing (-100..100) needed to pass T1

  function makeTasks() {
    return {
      idx: 0,
      list: [
        { id: "trust", done: false },
        { id: "work", done: false },
        { id: "biz", done: false, mark: null },
        { id: "rival", done: false, mark: null, markGang: null },
      ],
    };
  }
  function curTask() { return prospecting && prospecting.tasks ? prospecting.tasks.list[prospecting.tasks.idx] : null; }

  // EARN-TRUST progress 0..1 from the live standing reading — the ONE player
  // standing per set (gangs.js cityGangStanding = CBZ.brain.rep "gang:<id>").
  // gangs.js loads before this file, so there is no second accumulator.
  function trustProgress(rec) {
    const s = CBZ.cityGangStanding(rec.id) || 0;
    return Math.max(0, Math.min(1, s / TRUST_THRESHOLD));
  }

  // pick + beacon a SPECIFIC civilian mark for T3 (HANDLE BUSINESS). Any
  // unaligned, non-crew, non-cop ped near you — store its id so completion
  // requires THAT exact ped to die.
  function pickBizMark(rec) {
    const P = CBZ.player; let best = null, bd = Infinity;
    for (const p of CBZ.cityPeds) {
      if (!p || p.dead || p.vendor || p.kind === "cop") continue;
      if (p.gang) continue;                         // a plain civilian, not a crew member
      if (CBZ.cityPlayerGangIsMember && CBZ.cityPlayerGangIsMember(p)) continue;
      const d = Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // pick + beacon a RIVAL-gang member for T4, and drop a waypoint to the
  // nearest rival HQ so the player can find the crew it belongs to.
  function pickRivalMark(rec) {
    let mark = (CBZ.cityFindRivalMember ? CBZ.cityFindRivalMember(rec.id, false) : null);
    if (!mark) {
      // fallback scan: nearest non-allied rival member
      const P = CBZ.player; let bd = Infinity;
      for (const p of CBZ.cityPeds) {
        if (!p || p.dead || !p.gang || p.gang === rec.id || p.gang === "player") continue;
        if (CBZ.cityAreAllied && CBZ.cityAreAllied(rec.id, p.gang)) continue;
        const d = Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z);
        if (d < bd) { bd = d; mark = p; }
      }
    }
    return mark;
  }

  // when a task BECOMES active, run its one-time setup (pick + beacon marks).
  function activateTask(rec) {
    const t = curTask(); if (!t) return;
    if (t.id === "biz" && !t.mark) {
      t.mark = pickBizMark(rec);
      const P = CBZ.player;
      crewSays(rec, t.mark ? "Him. " + (t.mark.name ? t.mark.name + ", " : "") + pointWords(P, t.mark) + ". He owes us. Handle it."
                           : "Somebody around here owes us. Keep your eyes open.", 3.6);
    } else if (t.id === "rival" && !t.mark) {
      t.mark = pickRivalMark(rec); t.markGang = t.mark ? t.mark.gang : null;
      const rv = t.mark ? gangRecById(t.markGang) : null;
      crewSays(rec, rv ? "Last thing. " + gangShort(rv) + " been walking our side. Put one of them down."
                       : "Last thing. Bring us blood from another set.", 3.6);
    }
  }

  // advance to the next task (or, past the last, mark initiation ready).
  function advanceTask(rec, msg) {
    const T = prospecting && prospecting.tasks; if (!T) return;
    const t = T.list[T.idx]; if (t) t.done = true;
    if (msg) crewSays(rec, msg, 2.6);
    if (T.idx < T.list.length - 1) {
      T.idx++;
      activateTask(rec);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    } else {
      // all four done → initiation unlocked. One quiet line FROM the crew —
      // (the old centre flash "They'll get you made — find the boss." said the
      // same thing twice, as an instruction popup.)
      crewSays(rec, "Alright. We seen enough. Come get your patch.", 3.4);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    }
  }

  // begin prospecting a crew — kicks off the TASK SEQUENCE + drops an HQ waypoint
  CBZ.cityProspectGang = function (rec) {
    rec = rec || prospectableGang();
    if (!rec) return false;
    if (exists()) { CBZ.city.note("You already run your own gang.", 2); return false; }
    if (memb()) { CBZ.city.note("You're already patched into a crew.", 2); return false; }
    if (prospecting && prospecting.gangId === rec.id) return false;
    if (CBZ.cityAtWar && CBZ.cityAtWar("player", rec.id)) { CBZ.city.note(gangShort(rec) + " are at war with you. Make peace first.", 2.4); return false; }
    prospecting = { gangId: rec.id, t: 0, tasks: makeTasks() };
    crewSays(rec, "You want in? Then be around. Do right by us and we'll see.", 3.6);
    activateTask(rec);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  };

  // WHICH crew you're courting (or null) — city/racket.js reads this so a
  // prospect can put in work the racket way: extort a store and BRING IT TO
  // THE CREW (the store signs to them, your standing jumps). One read, no
  // state exposed beyond the id.
  CBZ.cityProspectGangId = function () { return prospecting ? prospecting.gangId : null; };

  // current prospect standing 0..1 (legacy read used by interact.js for the
  // "they're warming to you" standing line) — the OVERALL task-sequence progress.
  CBZ.cityProspectStanding = function () {
    if (!prospecting || !prospecting.tasks) return 0;
    const T = prospecting.tasks, n = T.list.length;
    const cur = curTaskProgress();
    return Math.min(1, (T.idx + cur) / n);
  };

  // 0..1 progress on the ACTIVE task only.
  function curTaskProgress() {
    const t = curTask(); if (!t) return 1;
    if (t.done) return 1;
    if (t.id === "trust") { const rec = gangRecById(prospecting.gangId); return rec ? trustProgress(rec) : 0; }
    return 0;   // kill-tasks are binary (0 until the right body drops)
  }

  // PUBLIC: are you courting a crew right now -> { active, ready, progress }
  // | null. It carries NO label on purpose: hud.js prints a label as the
  // objective line, and a quest line on the screen is exactly the narration
  // this file stopped doing. interact.js reads it as a plain truthy "courting".
  CBZ.cityProspectTask = function () {
    if (!prospecting || !prospecting.tasks) return null;
    if (memb()) return null;
    return { active: true, ready: initiationReady(), progress: CBZ.cityProspectStanding() };
  };

  // the gang accepts you for initiation once ALL FOUR tasks are done.
  function initiationReady() {
    if (!prospecting || !prospecting.tasks) return false;
    return prospecting.tasks.list.every((t) => t.done);
  }

  // ---- JUMP IN: survive a beating from the crew ----
  function startJumpIn(rec) {
    const live = rec.members.filter((m) => m && !m.dead && m !== rec.boss);
    const need = Math.min(4, Math.max(3, live.length));   // researched: fight 3+ members
    // turn the nearest members hostile-to-player but NON-LETHAL (fists): we set a
    // jumpIn flag the brain doesn't know about, and steer them to swarm + we cap
    // damage in our own tick so it can't actually kill you.
    let n = 0;
    for (const m of live) {
      if (n >= need) break;
      m._jumpIn = true; m._oldW = m.weapon; m.rage = CBZ.city.playerActor; m.state = "fight";
      m.weapon = "Bat"; if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(m);   // fists/bats only — a beating, not a shooting
      m.target.set(CBZ.player.pos.x, 0, CBZ.player.pos.z); m.pause = 0; m.path = null;
      n++;
    }
    jumpedIn = { gangId: rec.id, t: 12, need: n, startHp: CBZ.player.hp || 100 };
    crewSays(rec, "Hands down. Take it and stay on your feet.", 3);
    if (CBZ.sfx) CBZ.sfx("punch");
  }

  function endJumpIn(success, rec) {
    if (jumpedIn) {
      for (const m of (rec ? rec.members : [])) { if (m && m._jumpIn) { m._jumpIn = false; m.rage = null; m.state = "walk"; m.weapon = m._oldW || "Pistol"; m._oldW = null; if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(m); } }
    }
    jumpedIn = null;
    if (success) patchIn(rec, "jumped");
    else { crewSays(rec, "That's it? Get out of here.", 2.6); prospecting = null; }
  }


  // ---- PUT IN WORK: accept a hit contract; fulfil it to be patched in ----
  function startWork(rec) {
    // pick a named rival member of a DIFFERENT gang as the mark
    let mark = null, bd = Infinity; const P = CBZ.player;
    for (const p of CBZ.cityPeds) {
      if (!p || p.dead || !p.gang || p.gang === rec.id || p.gang === "player") continue;
      if (CBZ.cityAreAllied && CBZ.cityAreAllied(rec.id, p.gang)) continue;
      const d = Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z);
      if (d < bd) { bd = d; mark = p; }
    }
    if (!mark) { crewSays(rec, "Nobody from the other sets around right now. Later.", 2.6); return false; }
    workContract = { gangId: rec.id, target: mark, t: 90 };
    crewSays(rec, (mark.name ? mark.name + ", " : "One of ") + gangShort(gangRecById(mark.gang)) + ". " + pointWords(CBZ.player, mark) + ". Do him and you're in.", 3.8);
    return true;
  }

  // patch the player into the crew as the lowest rank — now a real member
  function patchIn(rec, how) {
    if (!rec || rec.absorbed) return;
    // served/orders are the two ladder currencies factions.js credits through
    // gangs.js's `bind` — same record, no second store.
    g.cityMembership = { gangId: rec.id, rank: "prospect", standing: 0, bodies: 0, contrib: 0, served: 0, orders: 0, loyalty: 0.6, how: how };
    prospecting = null; workContract = null; jumpedIn = null;
    g.playerGangId = rec.id;       // peds.js / turf can read which crew you ride with
    g.cityWasMember = true;        // having been patched in unlocks FOUNDing your own gang
    // your standing with this crew flips friendly: make them stop seeing you as prey
    if (CBZ.cityGangSetPlayerFriendly) CBZ.cityGangSetPlayerFriendly(rec.id, true);
    g.career = g.career || "gangster";
    crewSays(rec, how === "jumped" ? "You took it. You're one of us now." : "That's work. You're one of us now.", 3.2);
    CBZ.city.addRespect(12);
    if (CBZ.cityRankEvent) CBZ.cityRankEvent("gang-joined", { gang: rec, how });
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  CBZ.cityJoinGang = function (rec, how) { patchIn(rec || prospectableGang(), how || "work"); };

  // leave a crew you joined (rage-quit / get out) — drops you to civilian
  CBZ.cityLeaveGang = function () {
    const m = memb(); if (!m) { CBZ.city.note("You're not in a crew.", 1.6); return; }
    const rec = gangRecById(m.gangId);
    if (CBZ.cityGangSetPlayerFriendly && rec) CBZ.cityGangSetPlayerFriendly(rec.id, false);
    if (rec && CBZ.cityGangProvoke) CBZ.cityGangProvoke(rec.id, 0.7);   // leaving sours them
    g.cityMembership = null; g.playerGangId = null;
    CBZ.city.big("LEFT THE " + (rec ? gangShort(rec).toUpperCase() : "GANG"));
    CBZ.city.note("You walked away from the crew. They won't forget it.", 3);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  };

  // ---- MIGRATED to city/factions.js ----------------------------------------
  // This file used to hand-type the tier order `prospect,lookout,runner,
  // soldier,enforcer,lt` as a literal string array THREE times (here, in
  // cityPlayerGangPromote, and in autoPromotePlayerCrew) next to a fourth
  // threshold table (MEMBER_NEED) — none of which read gangs.js's canonical
  // RANKS. All four are gone: the order and the thresholds now live in exactly
  // one place, gangs.js's RANKS, declared once as CBZ.factions "gang".
  // The literal below is the DEGRADE-SAFE fallback if factions.js is absent.
  const FALLBACK_LADDER = ["prospect", "lookout", "runner", "soldier", "enforcer", "lt"];
  if (CBZ.factionMigrated) {
    CBZ.factionMigrated("ladder:playergang-member");   // MEMBER_LADDER + MEMBER_NEED
    CBZ.factionMigrated("ladder:playergang-crew");     // the two `ladder` literals
  }
  function ladderKeys() {
    const L = (CBZ.factions && CBZ.factions.ladderKeys) ? CBZ.factions.ladderKeys("gang") : null;
    // drop "boss" — boss is succession-only, never a merit rung for a member
    if (L && L.length) return L.filter((k) => k !== "boss");
    return FALLBACK_LADDER;
  }
  // promote the PLAYER inside the crew they're a member of, on earned merit.
  function tryMemberPromote() {
    const m = memb(); if (!m) return;
    if (CBZ.factions && CBZ.factions.tryPromote) { CBZ.factions.tryPromote("gang"); return; }
    const L = ladderKeys();
    const idx = L.indexOf(m.rank);
    if (idx < 0 || idx >= L.length - 1) return;
    const next = L[idx + 1];
    // fallback thresholds only — the live rule is gangs.js's RANKS via factions
    const need = { body: idx + 1, contrib: 80 * (idx + 1) * (idx + 1) };
    if (m.bodies >= need.body && m.contrib >= need.contrib) {
      m.rank = next;
      const rec = gangRecById(m.gangId);
      CBZ.city.big("⬆ YOU MADE " + (CBZ.cityRankName ? CBZ.cityRankName(next).toUpperCase() : next.toUpperCase()));
      CBZ.city.note((rec ? rec.name : "The crew") + " bumped you to " + (CBZ.cityRankName ? CBZ.cityRankName(next) : next) + ".", 3);
      CBZ.city.addRespect(6);
      if (CBZ.cityRankEvent) CBZ.cityRankEvent("member-rankup", { rank: next });
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    }
  }
  // other systems credit the player's in-crew work here (kills/cash kicked up).
  // ONE writer now: CBZ.factions.credit routes into this same g.cityMembership
  // record (gangs.js's `bind`) and runs the promotion check itself.
  CBZ.cityMemberPutInWork = function (kind, amount) {
    const m = memb(); if (!m) return;
    const F = CBZ.factions;
    if (F && F.credit && F.isMember && F.isMember("gang")) {
      if (kind === "body") { F.credit("gang", "bodies", amount || 1); F.addStanding("gang", 0.04); }
      else if (kind === "cash") F.credit("gang", "contrib", amount || 0);
      else if (kind === "order") F.credit("gang", "orders", amount || 1);
      else if (kind === "standing") F.addStanding("gang", amount || 0.1);
      return;
    }
    if (kind === "body") { m.bodies += (amount || 1); m.loyalty = Math.min(1, m.loyalty + 0.04); }
    else if (kind === "cash") { m.contrib += (amount || 0); }
    else if (kind === "order") { m.orders = (m.orders || 0) + (amount || 1); }
    else if (kind === "standing") { m.standing = Math.min(2, m.standing + (amount || 0.1)); }
    tryMemberPromote();
  };

  // ---- credit PLAYER kills toward prospecting/membership (non-invasively) ----
  // We wrap the public cityRankEvent (preserving the original): on a player
  // "kill" it carries the victim's gang id, which is exactly the signal we need
  // to score work for the crew you're courting / riding with.
  function isHostileTo(gangId, victimGangId) {
    if (!victimGangId || victimGangId === gangId) return false;       // never your own crew
    if (victimGangId === "player") return false;
    if (CBZ.cityAreAllied && CBZ.cityAreAllied(gangId, victimGangId)) return false;
    return true;   // a rival / unaligned crew = a real body for the gang
  }
  function creditPlayerKill(detail) {
    if (!detail) return;
    const vg = detail.gang || null;
    // a player kill that satisfies an open WORK CONTRACT (the initiation hit) →
    // flag it so the tick only patches you in on YOUR hit (not a rival happening
    // to drop the mark).
    if (workContract && workContract.target && detail.ped === workContract.target) workContract._byPlayer = true;

    // PROSPECTING: a kill only counts when it MATCHES the ACTIVE task. A random,
    // unrelated body advances NOTHING toward gang progression (the "no dumb kill
    // → promoted" rule). Tasks are gated in order.
    if (prospecting && !memb()) {
      const rec = gangRecById(prospecting.gangId);
      const t = curTask();
      if (rec && t && !t.done) {
        if (t.id === "work") {
          // PUT IN WORK — ANY player kill proves willingness.
          advanceTask(rec, "We saw that. Cold.");
        } else if (t.id === "biz" && t.mark && detail.ped === t.mark) {
          // HANDLE BUSINESS — completes ONLY on the exact marked ped.
          advanceTask(rec, "Handled. He won't be owing nobody now.");
        } else if (t.id === "rival" && isHostileTo(rec.id, vg)) {
          // HIT A RIVAL — any non-allied rival-gang member counts (the beaconed
          // mark is a pointer, not a hard requirement).
          advanceTask(rec, "That's blood for the set.");
        }
        // T1 (trust) ignores kills entirely — it advances off standing in the tick.
      }
    }

    // MEMBERSHIP: every rival you drop is a body that climbs you up the crew ranks
    const M = memb();
    if (M && isHostileTo(M.gangId, vg)) {
      CBZ.cityMemberPutInWork("body", detail.boss ? 3 : 1);
      CBZ.cityMemberPutInWork("cash", detail.boss ? 400 : (detail.armed ? 120 : 70));   // proceeds kicked up
    }
  }
  // wrap once, after the rest of the boot has defined cityRankEvent (promotion.js)
  function wrapRankEvent() {
    if (!CBZ.cityRankEvent || CBZ.cityRankEvent._pgWrapped) return true;
    const orig = CBZ.cityRankEvent;
    CBZ.cityRankEvent = function (type, data) {
      const r = orig.apply(this, arguments);
      if (type === "kill") { try { creditPlayerKill(data || {}); } catch (e) {} }
      return r;
    };
    CBZ.cityRankEvent._pgWrapped = true;
    return true;
  }
  if (!wrapRankEvent()) { let t = 0; const iv = setInterval(function () { if (wrapRankEvent() || ++t > 40) clearInterval(iv); }, 250); }

  // ---- promote a crew member one rung UP the shared ladder ----
  // Climbs prospect->lookout->runner->soldier->enforcer->lt (Boss is you). Uses
  // the gangs.js engine so gear + tag + loyalty all stay consistent with NPCs.
  CBZ.cityPlayerGangPromote = function (ped) {
    if (!CBZ.cityPlayerGangIsMember(ped) || ped.rank === "lt") return false;
    const ladder = ladderKeys();          // ONE source (gangs.js RANKS via factions)
    const i = ladder.indexOf(ped.rank); const next = ladder[Math.max(0, i) + 1] || "lt";
    if (CBZ.cityGangRankUp) CBZ.cityGangRankUp(ped, next);
    else { ped.rank = next; ped.maxHp = Math.max(ped.maxHp || 160, 200); ped.hp = ped.maxHp; }
    styleMember(ped, g.playerGang.color);
    if (CBZ.cityMemberStats) { const s = CBZ.cityMemberStats(ped); s.loyalty = Math.min(1, s.loyalty + 0.12); }
    say(ped, next === "lt" ? "I won't let you down." : pick(["Appreciate it.", "About time.", "I earned that."]), 2.4);
    CBZ.city.addRespect(4);
    if (CBZ.cityRankEvent) CBZ.cityRankEvent("promote", { ped });
    return true;
  };

  // auto-promote YOUR crew on merit too (their tracked bodies + earned cut),
  // so a long-running gang grows real veterans without micromanagement.
  function autoPromotePlayerCrew() {
    const pg = g.playerGang; if (!pg || !pg.founded || !CBZ.cityMemberStats) return;
    // ONE ladder + ONE threshold table: gangs.js's RANKS, read through factions.
    // (Before: a third hand-typed copy of the tier order plus a fourth private
    // threshold table that disagreed with both gangs.js and MEMBER_NEED.)
    const ladder = ladderKeys();
    const F = CBZ.factions;
    const needOf = (key) => {
      const rd = (F && F.rankDef) ? F.rankDef("gang", key) : null;
      if (rd) return { b: rd.need.bodies, c: rd.need.contrib };
      const i = FALLBACK_LADDER.indexOf(key);
      return { b: Math.max(0, i), c: 60 * i * i };
    };
    for (const m of liveMembers()) {
      const i = ladder.indexOf(m.rank); if (i < 0 || i >= ladder.length - 1) continue;
      const nx = ladder[i + 1], rq = needOf(nx); if (!rq) continue;
      const s = CBZ.cityMemberStats(m);
      if (s.bodies >= rq.b && s.earned >= rq.c) {
        if (CBZ.cityGangRankUp && CBZ.cityGangRankUp(m, nx)) { styleMember(m, pg.color); }
      }
    }
  }

  /* ============================================================
     THE ASK. You walk up to a person and ask him to run with you. What he
     says is added up out of who he is and who you are; nothing here is a
     dice roll he could give a different answer to a minute later (the one
     random term is a hash of the man himself).

       A STRANGER   his life (a hustler, a man sleeping rough, a dealer: yes
                    is close; a tourist, a suit, a shopkeeper: it is not),
                    his money, whether he has a job, his nerve, what he
                    thinks of you, how big you are beside him, the crew and
                    the blocks you can show him, the heat on you, the men
                    you have lost.
       A RIVAL      all of that, against his loyalty to his own set, his
                    rank in it, how his set is doing (a dead boss, a thin
                    bench, an empty treasury) and what his set thinks of
                    you. A loyal one who is asked tells his people.

     Yes; or a price (cash in your hand, CBZ.city.spend); or no, which holds
     for a couple of minutes and gets worse if you ask again. The price can
     be leaned on instead of paid: the card's Threaten (city/orders.js)
     frightens a man who can be frightened into it, and he joins with no
     love for you.
     ============================================================ */
  const STREET = { hustler: 1, dealer: 1, tweaker: 1, vagrant: 1, volatile: 1, thug: 1, gangster: 1, made: 1, mobster: 1 };
  const SOFT = { tourist: 1, professional: 1, socialite: 1, exec: 1, merchant: 1, billionaire: 1, tycoon: 1, mobwife: 1 };
  function relOf(p) { try { return CBZ.cityRel ? CBZ.cityRel(p) : null; } catch (e) { return null; } }
  function relShift(p, kind, amt) { try { if (CBZ.cityRelShift) CBZ.cityRelShift(p, kind, amt); } catch (e) {} }
  function hash01(p, salt) {
    const s = (p.name || "") + "|" + (p._identityId || "") + "|" + (p.job || "") + "|" + salt;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return ((h >>> 0) % 1000) / 1000;
  }
  function standingOf(p) {
    try { const st = CBZ.cityInteractionStanding ? CBZ.cityInteractionStanding(p) : null; return st ? st.score : 50; } catch (e) { return 50; }
  }
  function tierOf(key) {
    const L = CBZ.cityRankLadder ? CBZ.cityRankLadder() : null;
    if (L) for (let i = 0; i < L.length; i++) if (L[i].key === key) return L[i].tier;
    return key === "lt" ? 5 : key === "boss" ? 6 : 3;
  }
  function strengthOf(rec) {
    if (CBZ.cityGangStrength) { try { return CBZ.cityGangStrength(rec); } catch (e) {} }
    let n = 0; for (const m of rec.members || []) if (m && !m.dead) n++; return n;
  }
  function bossGone(rec) { return !!(rec.bossDead || rec.leaderless || !rec.boss || rec.boss.dead); }
  function matesNear(p, r) {
    const rec = gangRecById(p.gang); if (!rec) return [];
    const out = [];
    for (const m of rec.members || []) if (m && m !== p && !m.dead && !(m.ko > 0) && dist(m.pos, p.pos) < r) out.push(m);
    return out;
  }

  function askable(p) {
    if (!p || p.dead || p.player || p.isPlayer || !p.pos) return false;
    // (a set's man standing a post on his own turf, city/gangs.js's garrison,
    // is still his own man: his post is his boss's, not a shop's counter)
    if (p.vendor || (p.staffPost && !p.gang) || p.child || p.animal) return false;
    if (p.kind === "cop" || p.kind === "security" || p.kind === "staff" || p.kind === "dog") return false;
    if (p.archetype === "soldier" || p.archetype === "official") return false;
    if (p.recruited || p.companion || p.controlled || p.hostage || p.restraint || (p.ko | 0) > 0) return false;
    if (p.inCar || p._cbzSeat || p.surrender || p.state === "flee" || p.rage) return false;   // not a man you can have a word with right now
    if (p._iOnly || p._presOfficer || p._presStaff || p._congress || p._compoundCrew) return false;
    if (isMember(p)) return false;
    // a man patched into somebody else's crew works for that boss; a sitting
    // President staffs his office another way (city/president_staff.js)
    if (g.cityMembership) return false;
    try { if (CBZ.presidency && CBZ.presidency.seat && CBZ.presidency.seat()) return false; } catch (e) {}
    if (p.gang) {
      const rec = gangRecById(p.gang);
      if (!rec || rec.isPlayer || rec.absorbed) return false;
      if ((p.isBoss || p.rank === "boss" || p === rec.boss) && !p.dead) return false;   // a boss is not hired
    }
    return true;
  }
  function askLive(p) { return !!(p && p._pgAsk && T < p._pgAsk.until && !p.dead); }

  // the sum. Returns { s, parts, rival, tier, price, free, snitch, why }
  function willing(p) {
    const pg = ensure();
    const r = relOf(p) || {};
    const n = liveMembers().length, lots = pg.turf.length;
    const parts = {};
    parts.respect = Math.min(0.3, (g.respect || 0) / 150);
    parts.standing = (standingOf(p) - 50) / 100 * 0.6;
    parts.rel = ((r.loyalty || 0) + (r.respect || 0)) / 200 * 0.5 + (r.affection || 0) / 100 * 0.1 + (r.fear || 0) / 100 * 0.2 - (r.grudge || 0) / 100 * 0.9;
    parts.crew = Math.min(0.18, n * 0.03) + Math.min(0.12, lots * 0.04);
    parts.heat = (g.wanted | 0) >= 3 ? -0.2 : (g.wanted | 0) >= 1 ? -0.05 : 0;
    parts.lost = -Math.min(0.25, (pg.lost || 0) * 0.06);
    parts.luck = (hash01(p, "ask") - 0.5) * 0.2;
    const out = { parts: parts, rival: null, tier: 0 };
    const rec = p.gang ? gangRecById(p.gang) : null;
    const lvl = CBZ.cityLevel ? (CBZ.cityLevel(p) || 1) : 1;
    if (rec) {
      const ms = CBZ.cityMemberStats ? CBZ.cityMemberStats(p) : { loyalty: 0.6 };
      const tier = tierOf(p.rank);
      out.rival = rec; out.tier = tier;
      /* TURNING A MAN OF ANOTHER SET. Hard and risky, never shut: there are
         four ways in, and each is a real one at starting respect.
           money     he names a price down to s = -0.35 (dearer the further
                     he is from yes), and you pay it
           a favour  run work for him (city/social.js cityDoFavor, the card's
                     Do a favour): what he owes you counts for more than the
                     street's opinion of you
           a grudge  about one man in three has one against his own boss
                     (passed over, shorted); he says so when he names it
           fear      lean on him while he is naming a price, with none of
                     his own people close enough to see him fold */
      parts.base = -0.28;
      // what he thinks of a nobody counts less than what he thinks of his boss
      parts.standing = Math.max(-0.12, parts.standing);
      parts.loyal = -((ms.loyalty != null ? ms.loyalty : 0.6) - 0.5) * 0.7;
      parts.rank = -tier * 0.05;
      parts.favour = Math.min(0.3, Math.max(0, (r.loyalty || 0)) / 100);
      parts.grievance = grievance(p, rec) ? 0.3 : 0;
      parts.chair = bossGone(rec) ? 0.4 : 0;
      const str = strengthOf(rec);
      parts.losing = str <= 4 ? 0.18 : str >= 12 ? -0.08 : 0;
      parts.pay = (rec.treasury || 0) < 300 ? 0.1 : (rec.treasury || 0) > 3000 ? -0.1 : 0;
      parts.set = ((CBZ.cityGangStanding ? CBZ.cityGangStanding(rec.id) : 0) || 0) / 100 * 0.3;
      parts.war = (CBZ.cityAtWar && CBZ.cityAtWar("player", rec.id)) ? -0.2 : 0;
    } else {
      const a = p.archetype || "";
      parts.base = -0.2;
      parts.life = STREET[a] ? 0.25 : SOFT[a] ? -0.4 : -0.08;
      parts.money = (0.45 - (p.wealth != null ? p.wealth : 0.4)) * 0.5;
      let jc = ""; try { jc = (CBZ.cityPedJobClass && CBZ.cityPedJobClass(p)) || ""; } catch (e) { jc = ""; }
      parts.job = p.vagrant || a === "vagrant" ? 0.15 : jc ? -0.12 : 0;
      parts.nerve = ((p.aggr != null ? p.aggr : 0.3) - 0.4) * 0.5;
      parts.piece = p.armed ? 0.08 : 0;
      parts.kin = p.partner && !p.partner.dead ? -0.06 : 0;
    }
    let s = 0; for (const k in parts) s += parts[k];
    if ((r.grudge || 0) > 45) s = -1;                    // bad blood is a no, whatever else is true
    out.s = s;
    if (rec) {
      out.free = bossGone(rec) && s >= 0.5;
      if (!out.free && s >= -0.35) out.price = Math.max(400, Math.round((500 + out.tier * 450) * (1.5 - Math.min(1, s)) / 50) * 50);
      // a man loyal to his set says so to his set
      out.snitch = !out.price && (s < -0.7 || parts.loyal < -0.1);
    } else {
      out.free = s >= 0.45;
      if (!out.free && s >= -0.3) out.price = Math.max(100, Math.round((150 + (p.wealth || 0.3) * 600 + lvl * 40) * (1.35 - s) / 50) * 50);
    }
    // the word a no is said in: the heaviest thing against you
    let worst = null, wv = -0.04;
    for (const k in parts) if (parts[k] < wv) { wv = parts[k]; worst = k; }
    if ((r.grudge || 0) > 45) worst = "rel";
    if (rec && (!worst || worst === "base")) worst = "loyal";
    out.why = worst;
    return out;
  }
  CBZ.cityCrewWhy = willing;            // what he would say, and why (a read)
  // a man with a grudge against his own boss: passed over, shorted, or the
  // boss's nephew got his corner. A fixed fact about him, about one in three.
  // (A set whose boss has stopped paying is parts.pay, for all of them.)
  function grievance(p, rec) {
    if (!p || !rec) return false;
    return hash01(p, "boss") < 0.33;
  }

  const NO = {
    life: ["That's not my world.", "No. I'm not built for that."],
    money: ["I don't need your money.", "I do fine on my own."],
    job: ["I got a job. I'm good.", "I work for a living."],
    nerve: ["No. I don't want any part of that.", "Not me. Ask somebody else."],
    kin: ["I got people at home. No.", "I can't. I got family."],
    standing: ["I don't know you.", "Who are you supposed to be?"],
    respect: ["I don't know you.", "Never heard of you."],
    rel: ["After what you did? Get away from me.", "You and me got nothing to talk about."],
    heat: ["You're hot right now. No.", "Half the city's looking for you. No."],
    lost: ["Your people keep ending up dead. No.", "I heard what happens to your crew."],
    loyal: ["I'm with my set. Walk away.", "You got the wrong one."],
    rank: ["I got a place here already.", "I didn't come up this far to start over."],
    set: ["My people don't like you. Neither do I.", "You? No."],
    war: ["We're at war with you. Get off the block.", "You got some nerve."],
    base: ["No.", "Not interested."],
  };
  function line(key, p) { const L = NO[key] || NO.base; return L[(hash01(p, key) * L.length) | 0]; }
  function facePlayer(p, hold) {
    const P = CBZ.player; if (!P || !P.pos || !p.group) return;
    p.group.rotation.y = Math.atan2(P.pos.x - p.pos.x, P.pos.z - p.pos.z);
    if (hold) { p.pause = Math.max(p.pause || 0, hold); p.speed = 0; p.path = null; if (p.target && p.target.set) p.target.set(p.pos.x, 0, p.pos.z); }
  }

  function ask(p) {
    if (!askable(p)) return null;
    facePlayer(p, 4);
    // he already said no
    if (p._pgNoT && T < p._pgNoT) {
      say(p, pick(["I said no.", "Don't ask me again.", "You deaf? No."]));
      relShift(p, "snubbed", 0.3);
      p._pgNoT += 30;
      return { answer: "no" };
    }
    const w = willing(p);
    const rec = w.rival;
    // HIS BOSS IS DEAD BY YOUR HAND: the question is for all of them
    if (rec && pendingClaim && pendingClaim.rec === rec && !rec.absorbed) {
      const t = 0.2 + (g.respect || 0) / 100 + liveMembers().length * 0.05 - strengthOf(rec) * 0.025 + (hash01(p, "crown") - 0.5) * 0.2 +
        ((CBZ.cityGangStanding ? CBZ.cityGangStanding(rec.id) : 0) || 0) / 250;
      if (t >= 0.45) {
        claimRivalGang(rec);
        say(p, "Alright. We ride with you.", 3);
        return { answer: "crew" };
      }
      pendingClaim = null;
      say(p, pick(["You ain't him.", "Killing him don't make you him."]), 3);
      if (CBZ.cityGangProvoke) CBZ.cityGangProvoke(rec.id, 0.5);
      p._pgNoT = T + 120;
      return { answer: "no" };
    }
    if (w.free) { join(p, 0, w); return { answer: "yes" }; }
    if (w.price) {
      p._pgAsk = { price: w.price, until: T + 35, rival: !!rec };
      facePlayer(p, 8);
      say(p, rec ? (w.parts.grievance > 0 ? pick([money(w.price) + ". He's been shorting me for a year.", money(w.price) + ". He passed me over. I owe him nothing."])
                    : w.parts.favour > 0.12 ? pick([money(w.price) + ". I owe you one, so that's a fair number.", "For you? " + money(w.price) + "."])
                    : pick([money(w.price) + " and I walk today.", "It costs. " + money(w.price) + ".", money(w.price) + ". And you never heard it from me."]))
                 : pick([money(w.price) + " up front and I'm yours.", "I don't move for free. " + money(w.price) + ".", "Make it " + money(w.price) + "."]), 3.2);
      return { answer: "price", price: w.price };
    }
    // no
    p._pgNoT = T + 120;
    if (rec && w.snitch) {
      // the risk: he tells his people what you just tried
      const mates = matesNear(p, 22);
      say(p, pick(["He's trying to buy me!", "This one's poaching on our block!"]), 2.8);
      if (CBZ.cityGangProvoke) CBZ.cityGangProvoke(rec.id, mates.length ? 0.7 : 0.4);
      if (CBZ.cityGangAddStanding) CBZ.cityGangAddStanding(rec.id, -10);
      relShift(p, "snubbed", 0.6);
      return { answer: "snitch" };
    }
    say(p, line(w.why || "base", p), 2.8);
    return { answer: "no", why: w.why };
  }
  CBZ.cityCrewAsk = ask;

  function pay(p) {
    const a = p && p._pgAsk;
    if (!a || !askLive(p)) return false;
    facePlayer(p, 3);
    if (!(CBZ.city && CBZ.city.spend && CBZ.city.spend(a.price))) {
      say(p, pick(["Come back when you have it.", "That's not " + money(a.price) + "."]));
      return false;
    }
    p.cash = (p.cash || 0) + a.price;
    if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
    join(p, a.price, willing(p));
    return true;
  }

  // he is in. `paid` is what changed hands; `w` is the sum he was asked with.
  function join(p, paid, w, how) {
    const from = p.gang && p.gang !== "player" ? gangRecById(p.gang) : null;
    const tier = from ? tierOf(p.rank) : 0;
    p._pgAsk = null; p._pgNoT = 0;
    if (from) {
      const i = from.members ? from.members.indexOf(p) : -1; if (i >= 0) from.members.splice(i, 1);
      p.raidT = 0; p.raidLot = null; p.raidGang = null; p._op = null; p._wRole = null; p.guard = null; p.homeGuard = null;
      // his old set finds out: at once if one of them is standing there
      const mates = matesNear(p, 25);
      if (CBZ.cityGangProvoke) CBZ.cityGangProvoke(from.id, mates.length ? 0.6 : 0.25);
      if (CBZ.cityGangAddStanding) CBZ.cityGangAddStanding(from.id, mates.length ? -14 : -6);
      if (mates.length) say(mates[0], pick(["Traitor!", "You're dead, " + (p.name ? p.name.split(" ")[0] : "you") + "!"]), 2.6);
      p.gang = null;
    }
    // the money in his hand is a gun on his hip by the time he falls in
    if (!p.armed && paid >= 250) { p.armed = true; p.weapon = "Pistol"; p.ammo = 60; }
    p._post = null;
    const loyalty = how === "fear" ? 0.28 : Math.max(0.45, Math.min(0.9, 0.55 + (w && w.s ? w.s * 0.4 : 0) + (paid ? 0.08 : 0)));
    const rank = from ? (tier >= 5 ? "enforcer" : tier >= 3 ? "soldier" : "prospect") : "prospect";
    if (!enlist(p, rank, { how: from ? "poach" : (how || "recruit"), loyalty: loyalty })) return false;
    if (CBZ.cityMemberStats) CBZ.cityMemberStats(p).loyalty = loyalty;
    if (how !== "fear") relShift(p, "recruited", 1);
    if (paid) relShift(p, "paid", 1);
    // asked through a car window: he walks round to a door (city/boarding.js)
    const P = CBZ.player;
    if (CBZ.followerOrder && P && P.driving && P._vehicle) { try { CBZ.followerOrder(p, "board", { veh: P._vehicle, role: "crew", run: true }); } catch (e) {} }
    say(p, how === "fear" ? pick(["Alright, alright. I'm in.", "Okay. Okay. I'm with you."])
      : from ? pick(["Then I'm yours.", "Done. I'm out of there."])
      : paid ? pick(["Alright. I'm with you.", "Good. Let's work."])
      : pick(["I'm with you.", "Say less. I'm in.", "About time somebody asked.", "Alright. Where we going?"]), 2.8);
    CBZ.city.addRespect(from ? 5 : 2);
    if (CBZ.interactions && CBZ.interactions.refresh) { try { CBZ.interactions.refresh(); } catch (e) {} }
    return true;
  }

  /* LEANED ON instead of paid. city/orders.js's Threaten has already put the
     fear on him (social.js "intimidated", his own reaction by who he is); if
     he was naming a price when you did it, this is what the fear decides. */
  (function wrapThreaten() {
    const O = CBZ.cityOrders2;
    if (!O || typeof O.threaten !== "function" || O.threaten._pgWrap) return;
    const orig = O.threaten;
    const w = function (t) {
      const had = askLive(t) ? t._pgAsk : null;
      const res = orig.apply(this, arguments);
      if (had && t && !t.dead && !isMember(t)) {
        const r = relOf(t) || {};
        // a gun in your hand is most of a threat; without one, only a man who
        // is already afraid of you (what you did to him before) folds.
        // A man of a set folds only where none of his own can see him do it,
        // and a hard man or one with a piece of his own folds only to a gun.
        const gunned = !!(CBZ.cityHasGun && CBZ.cityHasGun());
        const scared = t.surrender || (t.fear || 0) >= (gunned ? 3 : 5) || (r.fear || 0) >= 45;
        const seen = had.rival && matesNear(t, 18).length > 0;
        const brave = !gunned && ((t.aggr || 0) >= 0.75 || t.armed);
        t._pgAsk = null;
        if (scared && !brave && !seen) join(t, 0, willing(t), "fear");
        else { t._pgNoT = T + 240; if (!t.rage) say(t, pick(["Now it's a no.", "Get out of my face."]), 2.4); }
      }
      return res;
    };
    w._pgWrap = true;
    O.threaten = w;
  })();

  /* ============================================================
     POSTS. What a man of yours is doing, as one small record on him
     (m._post = { kind, x, z, face }), turned into the fields the ped brain
     already honours: `companion` walks with you and fights for you, `guard`
     is a leash to a point he holds and fights from.
       follow   with you
       corner   that spot is his: he holds it (and holds the block it is on)
       door     beside the nearest door, back to the wall, facing out
       sell     a corner he deals from (THE MONEY, below)
       home     back on the turf (or outside your house when you hold none)
     ============================================================ */
  const CMD_OF = { follow: "come", corner: "hold", door: "guard", sell: "go", home: "go" };
  function postKind(m) { return m && m._post ? m._post.kind : null; }
  function doorSpot(pos, m) {
    let best = null, bd = 16;
    for (const lot of allLots()) {
      const b = lot.building; if (!b || !b.door || lot.demolished) continue;
      const d = Math.hypot(b.door.x - pos.x, b.door.z - pos.z);
      if (d < bd) { bd = d; best = lot; }
    }
    if (!best) return null;
    const f = frontOf(best); if (!f) return null;
    // which side of the door: the side he is already on, and never the side
    // another of yours already has
    let side = ((pos.x - f.x) * f.tx + (pos.z - f.z) * f.tz) >= 0 ? 1 : -1;
    for (const o of liveMembers()) {
      if (o === m || !o._post || o._post.kind !== "door" || o._post.lot !== best) continue;
      if (o._post.side === side) side = -side;
    }
    return { x: f.x + f.ox * 1.3 + f.tx * side * 1.5, z: f.z + f.oz * 1.3 + f.tz * side * 1.5, face: Math.atan2(f.ox, f.oz), lot: best, side: side };
  }
  CBZ.cityCrewDoorSpot = doorSpot;
  // the four corners of a lot, a step outside its building
  function cornerOf(lot, k) {
    const r = rectOf(lot);
    const sx = (k & 1) ? 1 : -1, sz = (k & 2) ? 1 : -1;
    return { x: r.cx + sx * (r.hw + 1.4), z: r.cz + sz * (r.hd + 1.4), lot: lot };
  }
  function ownedHomeLot() {
    if (g.cityHome && g.cityHome.lot && !g.cityHome.lot.demolished) return g.cityHome.lot;
    try { const L = CBZ.cityRealtyOwnedHomes ? CBZ.cityRealtyOwnedHomes() : null; if (L && L.length) return L[0].lot; } catch (e) {}
    return null;
  }
  function hasHome() { return !!(ensure().turf.length || ownedHomeLot()); }
  // where "home" is for this man: a corner of a block you hold that the
  // fewest of yours already stand on; with no turf, the front of your house
  function homeSpot(m) {
    const pg = ensure();
    const mem = liveMembers();
    if (pg.turf.length) {
      let best = null, bn = 1e9;
      for (const lot of pg.turf) {
        if (lot.demolished) continue;
        let n = 0; for (const o of mem) if (o !== m && o._post && o._post.lot === lot) n++;
        if (n < bn) { bn = n; best = lot; }
      }
      if (best) return cornerOf(best, bn % 4);
    }
    const h = ownedHomeLot();
    if (h) {
      const f = frontOf(h);
      if (f) {
        let n = 0; for (const o of mem) if (o !== m && o._post && o._post.lot === h) n++;
        const side = (n % 2) ? -1 : 1, step = 2.2 + ((n / 2) | 0) * 1.6;
        return { x: f.x + f.ox * 2.6 + f.tx * side * step, z: f.z + f.oz * 2.6 + f.tz * side * step, face: Math.atan2(f.ox, f.oz), lot: h };
      }
    }
    return null;
  }

  function post(m, kind, at) {
    if (!m || m.dead) return false;
    // whatever body his last order had
    try { if (m._order && CBZ.cityOrders2 && CBZ.cityOrders2.clear) CBZ.cityOrders2.clear(m); } catch (e) {}
    if (kind !== "follow" && (m._cbzSeat || m.inCar) && CBZ.followerOrder) { try { CBZ.followerOrder(m, "alight"); } catch (e) {} }
    if (m._cbzWait && CBZ.followerOrder) { try { CBZ.followerOrder(m, "follow", {}); } catch (e) {} }
    m._op = null; m.raidT = 0; m.raidLot = null; m.raidGang = null;
    if (kind === "follow") {
      m._post = { kind: "follow" };
      m.companion = true; m.guard = null; m.rage = null; m.path = null; m.pause = 0;
      return true;
    }
    let s = null;
    if (kind === "corner" || kind === "sell") s = at || { x: m.pos.x, z: m.pos.z };
    else if (kind === "door") s = at || doorSpot(m.pos, m) || { x: m.pos.x, z: m.pos.z };
    else if (kind === "home") s = at || homeSpot(m);
    if (!s) return false;
    const lot = s.lot || lotNear(s.x, s.z) || null;
    m._post = { kind: kind, x: s.x, z: s.z, face: s.face != null ? s.face : null, lot: lot, side: s.side || 0, t: 0 };
    m.companion = false; m.rage = null;
    m.guard = { x: s.x, z: s.z }; m.homeGuard = { x: s.x, z: s.z };
    if (m.target && m.target.set) m.target.set(s.x, 0, s.z);
    m.pause = 0; m.path = null;
    if (kind === "sell") m._sellT = 6 + rnd() * 6;
    return true;
  }
  CBZ.cityCrewPost = post;

  // THE ORDER: each man decides (systems/command.js), the ones who will take
  // the post. Several told to hold at once spread round the spot.
  function order(men, kind, at) {
    men = (men || []).filter(function (m) { return m && !m.dead && isMember(m); });
    if (!men.length) return null;
    let k = 0; const n = men.length;
    const exec = function (m) {
      m._pgNo = null;
      let spot = at || null;
      if ((kind === "corner" || kind === "sell") && n > 1) {
        const P = CBZ.player, a = (k++ / n) * 6.283, rr = 2 + n * 0.25;
        spot = { x: (at ? at.x : P.pos.x) + Math.cos(a) * rr, z: (at ? at.z : P.pos.z) + Math.sin(a) * rr };
      }
      return post(m, kind, spot);
    };
    const Cm = CBZ.command;
    if (Cm && Cm.issue) return Cm.issue(playerActor(), n === 1 ? men[0] : men, CMD_OF[kind], null, { game: "city", exec: exec });
    men.forEach(exec);
    return { answer: "obey", obey: men, refuse: [] };
  }
  function earshot(r) {
    const P = CBZ.player, out = [];
    for (const m of liveMembers()) if (dist(m.pos, P.pos) < (r || 30) && !(m.ko > 0)) out.push(m);
    return out;
  }
  /* THE WHOLE GANG, by word of mouth or a phone call (city/phone_apps.js's
     crew contact): "follow" brings everybody to you, "hold" plants the ones in
     earshot where you stand, "home" sends everybody back to the turf. */
  CBZ.cityPlayerGangOrder = function (kind) {
    const pg = ensure();
    if (!pg.founded) return { ok: false, why: "" };
    if (kind === "disperse" || kind === "fortify") kind = "home";
    const men = kind === "hold" ? earshot(30) : liveMembers().slice();
    if (!men.length) return { ok: false, why: "" };
    if (kind === "home" && !hasHome()) return { ok: false, why: "" };
    const r = order(men, kind === "hold" ? "corner" : kind === "home" ? "home" : "follow");
    const obeyed = r && r.obey ? r.obey.length : 0;
    if (!obeyed) return { ok: false, answer: r ? r.answer : "refuse", why: "" };
    return { ok: true, answer: r.answer || "obey", n: obeyed, refused: men.length - obeyed };
  };
  // a recount after somebody left (city/brain_city.js cityDismiss)
  CBZ.cityPlayerGangApply = function () {
    g.cityCrew = liveMembers().length;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  };
  // a rival is raiding one of your blocks (gangs.js launchWar): the men at
  // home on your turf go to that block and hold it
  CBZ.cityPlayerGangDefendTurf = function (x, z) {
    const pg = g.playerGang; if (!pg || !pg.founded) return;
    const lot = lotNear(x, z, 30);
    let k = 0;
    for (const m of liveMembers()) {
      if (postKind(m) !== "home" || m.rage) continue;
      if (lot && m._post.lot !== lot) post(m, "home", cornerOf(lot, k++ % 4));
    }
  };

  /* ============================================================
     THE MONEY. It is made hand to hand and it stays on the man who made it.
       A SELLER works his corner: a passer-by walks up, the exchange happens
       (city/gangops.js cityDealStageBuyer, the same staging every corner in
       the city uses), and the cash is in his pocket. The crew's plug takes a
       slice, like it does off every other corner. A policeman who is
       standing there to see it makes him a wanted man (city/law.js radio),
       and the police's own arrest takes it from there.
       A MAN HOLDING A BLOCK OF YOURS takes that block's street money, a
       little every half minute he is actually standing on it.
     m._take is what he is carrying of yours. Collect (on him) hands it over
     less his cut, which is what he remembers you by.
     ============================================================ */
  const BLOCK_TAKE = 42, BLOCK_TICK = 30, CUT = 0.25;
  function supplier() {
    for (const gx of CBZ.cityGangs || []) if (gx && gx.supplier && !gx.isPlayer && !gx.absorbed) return gx;
    return null;
  }
  function copSees(m, r) {
    const L = CBZ.cityCops; if (!L) return null;
    for (let i = 0; i < L.length; i++) { const c = L[i]; if (c && !c.dead && c.pos && dist(c.pos, m.pos) < r) return c; }
    return null;
  }
  function settle(dealer, buyer) {
    if (!dealer || dealer.dead || !isMember(dealer)) return;
    let got = 30 + ((rnd() * 70) | 0);
    got = Math.max(15, Math.min(got, (buyer.cash | 0) + 40));
    buyer.cash = Math.max(0, (buyer.cash | 0) - got);
    const sup = supplier();
    let keep = got;
    if (sup) { const kick = Math.round(got * 0.22); sup.treasury = Math.min(12000, (sup.treasury || 0) + kick); keep = got - kick; }
    dealer.cash = (dealer.cash || 0) + keep;
    dealer._take = (dealer._take || 0) + keep;
    if (copSees(dealer, 22)) {
      dealer.npcWanted = Math.max(dealer.npcWanted | 0, 1);
      try { if (CBZ.cityLaw && CBZ.cityLaw.radio) CBZ.cityLaw.radio(dealer); } catch (e) {}
    }
  }
  function atPost(m, r) { return !!(m._post && m._post.x != null && Math.hypot(m.pos.x - m._post.x, m.pos.z - m._post.z) < (r || 3.5)); }
  function calm(m) { return !m.rage && !(m.ko > 0) && !m.restraint && m.state !== "fight" && m.state !== "flee" && !m.surrender; }
  function tickSellers(dt) {
    for (const m of liveMembers()) {
      if (postKind(m) !== "sell" || !calm(m) || !atPost(m, 3)) continue;
      m._sellT = (m._sellT == null ? 8 : m._sellT) - dt;
      if (m._sellT > 0) continue;
      m._sellT = 12 + rnd() * 14;
      if (CBZ.cityDealStageBuyer) { try { CBZ.cityDealStageBuyer(m, { onSettle: settle }); } catch (e) {} }
    }
  }
  function collect(m) {
    const n = Math.floor(m && m._take || 0);
    if (!m || m.dead || n < 1) return 0;
    const cut = Math.round(n * (m.rank === "lt" ? 0.3 : CUT));
    const mine = Math.min(n - cut, Math.floor(m.cash || 0));
    if (mine <= 0) { m._take = 0; return 0; }
    m.cash = (m.cash || 0) - mine; m._take = 0; m._pgPaidT = T;
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(mine); else g.cash = (g.cash || 0) + mine;
    if (CBZ.cityMemberStats) { const s = CBZ.cityMemberStats(m); s.earned += cut; s.contrib += mine; s.loyalty = Math.min(1, s.loyalty + 0.03); }
    facePlayer(m, 2);
    say(m, pick([money(mine) + ". All there.", "Here. " + money(mine) + ".", money(mine) + ". Slow day.", money(mine) + ". It's moving."]), 2.4);
    if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
    return mine;
  }

  /* ============================================================
     WHO HOLDS A BLOCK. Asked once a second of the lots your people are
     standing on and the lots you hold, by counting bodies:
       a block your people hold a post on, with nobody of another set on it
       for HOLD_T seconds, is yours (from nobody at once; from a set, only
       after their people are gone from it, and that set remembers);
       a block of yours with none of you on it and two or more of one set on
       it for HOLD_T seconds is theirs.
     You count as two of your own. A man down, cuffed or running holds
     nothing.
     ============================================================ */
  const HOLD_T = 20;
  const ctl = new Map();          // lot -> { t, kind }
  function bodiesOn(lot) {
    const R = lotReach(lot), out = { mine: 0, posted: 0, rival: null, rivalN: 0 };
    const by = {};
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || !p.gang || (p.ko | 0) > 0 || p.restraint || p.surrender || p.state === "flee") continue;
      const dx = p.pos.x - lot.cx, dz = p.pos.z - lot.cz;
      if (dx * dx + dz * dz > R * R) continue;
      if (p.gang === "player") { if (isMember(p)) { out.mine++; if (p._post && p._post.kind !== "follow" && p._post.lot === lot) out.posted++; } continue; }
      if (CBZ.cityAreAllied && CBZ.cityAreAllied("player", p.gang)) continue;
      by[p.gang] = (by[p.gang] || 0) + 1;
    }
    for (const id in by) if (by[id] > out.rivalN) { out.rivalN = by[id]; out.rival = id; }
    const P = CBZ.player;
    if (P && !P.dead && P.pos) { const dx = P.pos.x - lot.cx, dz = P.pos.z - lot.cz; if (dx * dx + dz * dz < R * R) out.mine += 2; }
    return out;
  }
  // who is standing on a block right now, and how long the count has held (a read)
  CBZ.cityCrewHolding = function (lot) { const b = bodiesOn(lot), c = ctl.get(lot); b.t = c ? c.t : 0; b.need = HOLD_T; return b; };
  function tickTurf(dt) {
    const pg = g.playerGang; if (!pg || !pg.founded) return;
    const seen = new Set();
    // blocks your people are posted on
    for (const m of liveMembers()) {
      const lot = m._post && m._post.kind !== "follow" ? m._post.lot : null;
      if (!lot || seen.has(lot) || !holdable(lot) || pg.turf.indexOf(lot) >= 0) continue;
      seen.add(lot);
      const b = bodiesOn(lot);
      let c = ctl.get(lot);
      const theirs = lot.building.gang && lot.building.gang !== pg.id ? gangRecById(lot.building.gang) : null;
      if (b.posted < 1 || b.rivalN > 0) { if (c) c.t = 0; continue; }
      if (!c) { c = { t: 0 }; ctl.set(lot, c); }
      c.t += dt;
      if (c.t < HOLD_T) continue;
      ctl.delete(lot);
      const fresh = takeLot(lot);
      if (fresh) {
        if (theirs) {
          if (CBZ.cityGangProvoke) CBZ.cityGangProvoke(theirs.id, 0.8);
          if (CBZ.cityGangAddStanding) CBZ.cityGangAddStanding(theirs.id, -12);
        }
        const who = liveMembers().find(function (m) { return m._post && m._post.lot === lot; });
        if (who && dist(who.pos, CBZ.player.pos) < 30) say(who, theirs ? "They're gone. It's ours." : pick(["This corner's ours now.", "We got this block."]), 2.6);
      }
    }
    // blocks you hold
    for (const lot of pg.turf.slice()) {
      if (lot.demolished) continue;
      const b = bodiesOn(lot);
      let c = ctl.get(lot);
      if (b.mine > 0 || b.rivalN < 2) { if (c) c.t = 0; continue; }
      if (!c) { c = { t: 0 }; ctl.set(lot, c); }
      c.t += dt;
      if (c.t < HOLD_T) continue;
      ctl.delete(lot);
      const to = gangRecById(b.rival);
      if (to && !to.absorbed) loseLot(lot, to);
    }
    // the street money of a block goes to the man standing on it
    pg._takeT = (pg._takeT || 0) + dt;
    if (pg._takeT >= BLOCK_TICK) {
      pg._takeT = 0;
      for (const lot of pg.turf) {
        if (lot.demolished) continue;
        const on = [];
        for (const m of liveMembers()) if (m._post && m._post.kind !== "follow" && m._post.lot === lot && calm(m) && atPost(m, 8)) on.push(m);
        if (!on.length) continue;
        const each = Math.round(BLOCK_TAKE / on.length);
        for (const m of on) { m.cash = (m.cash || 0) + each; m._take = (m._take || 0) + each; }
      }
    }
  }

  // a man you never pay, or whose friends keep dying, walks
  function tickLoyalty() {
    // the street forgets a death in about a quarter of an hour
    const pg = g.playerGang;
    if (pg && pg.lost > 0) pg.lost = Math.max(0, pg.lost - 20 / 900);
    if (!CBZ.cityMemberStats) return;
    for (const m of liveMembers().slice()) {
      const s = CBZ.cityMemberStats(m);
      if (T - (m._pgPaidT || 0) > 600) { s.loyalty = Math.max(0, s.loyalty - 0.01); }
      if (s.loyalty < 0.12 && calm(m) && CBZ.cityDismiss) {
        CBZ.cityDismiss(m, { line: pick(["I'm done with this.", "Find somebody else.", "This ain't worth it. I'm out."]) });
      }
    }
  }

  /* ============================================================
     A RIVAL BOSS, FACE TO FACE. Peace and land are his to sell, and he is
     the only one who can: Truce (he names what peace costs, by how strong
     he is and what his set thinks of you) and Buy the block (the district
     under your feet, when his hold on it is weak enough to have a price;
     city/turf.js cityPlayerBuyZone moves the lots).
     ============================================================ */
  function bossOf(p) {
    if (!p || p.dead || !p.gang || !exists()) return null;
    const rec = gangRecById(p.gang);
    if (!rec || rec.isPlayer || rec.absorbed) return null;
    return (p === rec.boss || p.isBoss || p.rank === "boss") ? rec : null;
  }
  function truceAsk(p) {
    const rec = bossOf(p); if (!rec) return;
    facePlayer(p, 6);
    const st = (CBZ.cityGangStanding ? CBZ.cityGangStanding(rec.id) : 0) || 0;
    if (st < -60) { say(p, "After what you did to my people? No.", 3); return; }
    const price = Math.round((600 + strengthOf(rec) * 90 - st * 6) / 50) * 50;
    p._pgAsk = { price: Math.max(300, price), until: T + 35, deal: "truce" };
    say(p, money(p._pgAsk.price) + " and my people leave yours alone.", 3.2);
  }
  function blockAsk(p) {
    const rec = bossOf(p); if (!rec) return;
    facePlayer(p, 6);
    const P = CBZ.player, z = CBZ.cityZoneAt ? CBZ.cityZoneAt(P.pos.x, P.pos.z) : null;
    if (!z || z.owner !== rec.id) { say(p, "That's not mine to sell.", 2.6); return; }
    if (z.strength > 0.7) { say(p, "This block? Not for sale.", 2.8); return; }
    p._pgAsk = { price: 1500 + (z.heldStr || 0) * 400, until: T + 35, deal: "block" };
    say(p, money(p._pgAsk.price) + ". Cash. Then it's yours.", 3.2);
  }
  function dealPay(p) {
    const a = p && p._pgAsk, rec = bossOf(p);
    if (!a || !rec || !askLive(p)) return;
    facePlayer(p, 3);
    if ((g.cash || 0) < a.price) { say(p, "Come back when you have it.", 2.4); return; }
    if (a.deal === "truce") {
      CBZ.city.spend(a.price);
      rec.treasury = (rec.treasury || 0) + a.price;
      if (CBZ.cityPlayerSetRelation) CBZ.cityPlayerSetRelation(rec.id, "ally");
      if (CBZ.cityGangAddStanding) CBZ.cityGangAddStanding(rec.id, 20);
      rec.provoke = 0;
      say(p, "Then we're good. For now.", 2.8);
    } else if (a.deal === "block") {
      // turf.js charges it and moves the lots (the same price it quoted us)
      const ok = CBZ.cityPlayerBuyZone ? CBZ.cityPlayerBuyZone() : false;
      say(p, ok ? "It's yours. Don't make me regret it." : "Not today.", 2.8);
      if (ok && CBZ.cityTurfTagsDirty) CBZ.cityTurfTagsDirty();
    }
    p._pgAsk = null;
  }

  /* ============================================================
     THE VERBS. All of the above, on the card of the person in front of you
     (city/interactions.js). Nothing here opens anything.
     ============================================================ */
  function ccHas(act) {
    const C = CBZ.compoundCrew;
    if (!C || !C.menuEntries) return false;
    let L = null; try { L = C.menuEntries(); } catch (e) { L = null; }
    if (L) for (let i = 0; i < L.length; i++) if (L[i].act === act) return true;
    return false;
  }
  (function wire() {
    const I = CBZ.interactions;
    if (!I || !I.register) return;
    const mine = function (p) { return !!(p && !p.dead && isMember(p)); };
    const following = function (p) { return postKind(p) === "follow" || !p._post; };
    const others = function (p, f) { const L = earshot(30); for (let i = 0; i < L.length; i++) if (L[i] !== p && f(L[i])) return true; return false; };

    // ---- somebody who is not yours ----
    // (forceYes: the level gap is one of the things he weighs, in his own
    // words, instead of the card going blank on a stranger)
    I.register("ped:civ", { id: "ped-recruit", prio: 40, forceYes: true,
      canShow: function (p) { return askable(p) && !askLive(p); },
      label: "Recruit", onSelect: function (p) { ask(p); } });
    // a man of another set you mean to turn: run his errand first (city/
    // social.js cityDoFavor). Once a minute per man: a favour is a day's work.
    I.register("ped:civ", { id: "pg-favour", prio: 38, forceYes: true,
      canShow: function (p) {
        return askable(p) && !!p.gang && !askLive(p) && !(p._pgFavT > T) &&
          !!(CBZ.cityCanBefriend && CBZ.cityCanBefriend(p) && CBZ.cityDoFavor);
      },
      label: "Do a favour", onSelect: function (p) { p._pgFavT = T + 60; CBZ.cityDoFavor(p); } });
    I.register("ped:civ", { id: "pg-pay", prio: 75, forceYes: true,
      canShow: function (p) { return askLive(p) && !p._pgAsk.deal && !isMember(p); },
      label: function (p) { return "Pay " + money(p._pgAsk.price); }, onSelect: function (p) { pay(p); } });
    // ---- a rival boss ----
    I.register("ped:civ", { id: "pg-truce", prio: 41, forceYes: true,
      canShow: function (p) { const rec = bossOf(p); return !!rec && !askLive(p) && !(CBZ.cityAreAllied && CBZ.cityAreAllied("player", rec.id)); },
      label: "Truce", onSelect: truceAsk });
    I.register("ped:civ", { id: "pg-block", prio: 39, forceYes: true,
      canShow: function (p) { return !!bossOf(p) && !askLive(p) && !!CBZ.cityPlayerBuyZone; },
      label: "Buy the block", onSelect: blockAsk });
    I.register("ped:civ", { id: "pg-deal-pay", prio: 75, forceYes: true,
      canShow: function (p) { return askLive(p) && !!p._pgAsk.deal; },
      label: function (p) { return "Pay " + money(p._pgAsk.price); }, onSelect: dealPay });

    // ---- one of yours ----
    const opt = function (id, prio, label, canShow, onSelect, wheel) {
      I.register("ped", { id: id, prio: prio, campaignSafe: true, anyone: true, wheel: !!wheel, label: label, canShow: canShow, onSelect: onSelect });
    };
    opt("pg-come", 72, "Come", function (p) { return mine(p) && !following(p); }, function (p) { order([p], "follow"); });
    opt("pg-collect", 71, function (p) { return "Collect " + money(Math.floor(p._take || 0) - Math.round(Math.floor(p._take || 0) * (p.rank === "lt" ? 0.3 : CUT))); },
      function (p) { return mine(p) && (p._take || 0) >= 4; }, collect);
    opt("pg-hold", 69, "Hold here", function (p) { return mine(p) && following(p) && !p._cbzSeat; }, function (p) { order([p], "corner"); });
    opt("pg-guard", 68, "Guard the door", function (p) { return mine(p) && postKind(p) !== "door" && !p._cbzSeat && !!doorSpot(p.pos, p); }, function (p) { order([p], "door"); });
    opt("pg-sell", 67, "Sell here", function (p) { return mine(p) && postKind(p) !== "sell" && !p._cbzSeat; }, function (p) { order([p], "sell"); });
    opt("pg-home", 66, "Go home", function (p) { return mine(p) && postKind(p) !== "home" && hasHome(); }, function (p) { order([p], "home"); });
    // the same, to everybody in earshot (his wheel)
    opt("pg-all-come", 34, "Everyone come", function (p) { return mine(p) && others(p, function (o) { return !following(o); }); },
      function () { order(earshot(30), "follow"); }, true);
    opt("pg-all-hold", 33, "Everyone hold", function (p) { return mine(p) && others(p, following); },
      function () { order(earshot(30).filter(following), "corner"); }, true);
    opt("pg-all-home", 32, "Everyone home", function (p) { return mine(p) && hasHome() && others(p, function (o) { return postKind(o) !== "home"; }); },
      function () { order(earshot(30), "home"); }, true);
    opt("pg-colours", 20, "Wear my colours", function (p) { const c = playerShirt(); return mine(p) && c != null && c !== ensure().color && vivid(c) && !flown(c); },
      function (p) { recolour(playerShirt()); say(p, pick(["Looks better anyway.", "Alright. New colours."]), 2.2); }, true);
    // the compound (city/compoundcrew.js): the people with you man it, the
    // people on it come back, the driver takes the wheel
    opt("pg-cc-post", 31, "Man the compound", function (p) { return mine(p) && following(p) && ccHas("cc-post"); },
      function () { CBZ.compoundCrew.menuDo("cc-post"); }, true);
    opt("pg-cc-back", 31, "Back with me", function (p) { return !!(p && !p.dead && p._compoundCrew) && ccHas("cc-back"); },
      function () { CBZ.compoundCrew.menuDo("cc-back"); }, true);
    opt("pg-cc-drive", 31, "Take the wheel", function (p) { return !!(p && !p.dead && (p._compoundCrew || mine(p))) && ccHas("cc-drive"); },
      function () { CBZ.compoundCrew.menuDo("cc-drive"); }, true);
  })();

  /* GETTING MADE, asked of a member of the set you have been courting, once
     they have seen enough: take the beating ("jump"), or do the hit ("work"). */
  CBZ.cityGangInitiate = function (how) {
    if (!prospecting || memb() || !initiationReady()) return false;
    const rec = gangRecById(prospecting.gangId);
    if (!rec || rec.absorbed) return false;
    if (how === "work") return startWork(rec);
    startJumpIn(rec);
    return true;
  };
  CBZ.cityGangInitiateReady = function () { return !!(prospecting && !memb() && initiationReady() && !jumpedIn && !workContract); };
  // walking away from a set you were courting
  CBZ.cityProspectStop = function () { prospecting = null; };

  // ============================================================
  //  PROSPECT / INITIATION / MEMBERSHIP per-frame lifecycle. Runs even when you
  //  have no gang of your own — this is the path to JOINING someone else's crew.
  // ============================================================
  CBZ.onUpdate(34.6, function (dt) {
    if (g.mode !== "city" || g.state !== "playing") return;
    const P = CBZ.player; if (!P || P.dead) {
      // dying mid-jump-in fails the initiation cleanly
      if (jumpedIn) { const rec = gangRecById(jumpedIn.gangId); endJumpIn(false, rec); }
      return;
    }

    // ---- PROSPECTING: work the ORDERED TASK SEQUENCE ----
    if (prospecting && !memb()) {
      const rec = gangRecById(prospecting.gangId);
      if (!rec || rec.absorbed || !rec.boss || rec.boss.dead) { prospecting = null; }
      else {
        prospecting.t += dt;
        const t = curTask();
        // T1 EARN TRUST — standing trickles up while you HANG on their turf near a
        // member (a free, slow grind even when cityDoFavor isn't reachable). It
        // completes off the LIVE standing reading (cityGangAddStanding writes it).
        if (t && t.id === "trust") {
          const onTurf = CBZ.cityGangOf && CBZ.cityGangOf(P.pos.x, P.pos.z) === rec;
          let nearMember = false;
          for (const m of rec.members) { if (!m.dead && Math.hypot(m.pos.x - P.pos.x, m.pos.z - P.pos.z) < 14) { nearMember = true; break; } }
          if (onTurf && nearMember) {
            CBZ.cityGangAddStanding(rec.id, dt * 1.1);   // ~32s of hanging to pass (brain.rep, via gangs.js)
          }
          if (trustProgress(rec) >= 1) advanceTask(rec, "You're alright. We been watching.");
        }
        // T3 / T4 — if the beaconed mark despawned or got dropped by someone
        // ELSE, re-pick a fresh one so the objective is always reachable.
        else if (t && t.id === "biz" && (!t.mark || t.mark.dead || t.mark.collected)) {
          t.mark = pickBizMark(rec);
        } else if (t && t.id === "rival" && (!t.mark || t.mark.dead || t.mark.collected)) {
          t.mark = pickRivalMark(rec); t.markGang = t.mark ? t.mark.gang : null;
        }
      }
    }

    // ---- JUMP IN: cap incoming damage so it can't kill you; count survival ----
    if (jumpedIn) {
      const rec = gangRecById(jumpedIn.gangId);
      jumpedIn.t -= dt;
      // floor the player's HP at 12 during the ritual — it's a test of heart, not death
      if (P.hp != null && P.hp < 12) P.hp = 12;
      // keep the beaters swarming + non-lethal
      if (rec) for (const m of rec.members) {
        if (!m._jumpIn || m.dead) continue;
        m.rage = CBZ.city.playerActor; if (m.state !== "fight") m.state = "fight";
        m.target.set(P.pos.x, 0, P.pos.z);
      }
      if (jumpedIn.t <= 0) endJumpIn(true, rec);
    }

    // ---- PUT IN WORK contract: mark dies (by you) -> patched in ----
    if (workContract) {
      workContract.t -= dt;
      const rec = gangRecById(workContract.gangId);
      const mk = workContract.target;
      if (!rec || rec.absorbed) { workContract = null; }
      else if (mk && mk.dead && workContract._byPlayer) {
        // confirmed: the player dropped the mark → patched in (patchIn clears wp)
        CBZ.city.note("Mark's down. You put in work for " + gangShort(rec) + ".", 2.4);
        patchIn(rec, "work");
      } else if (mk && mk.dead && !workContract._byPlayer) {
        // someone else clipped your mark — contract's blown, pick a new one
        crewSays(rec, "Somebody else got him first. Doesn't count.", 2.4);
        workContract = null;
      } else if (workContract.t <= 0) {
        crewSays(rec, "Took too long. Forget it.", 2.4);
        workContract = null;
      }
    }

    // ---- MEMBERSHIP upkeep: passive standing/loyalty + auto-promotion ----
    const M = memb();
    if (M) {
      const rec = gangRecById(M.gangId);
      if (!rec || rec.absorbed) {
        // your crew got wiped/absorbed while you rode with them
        g.cityMembership = null; g.playerGangId = null;
      } else {
        // your OWN crew never reads you as a turf intruder — scrub any rage the
        // guard brain pinned on the player (armed+wanted on home turf triggers it)
        const PA = CBZ.city.playerActor;
        for (const m of rec.members) { if (m && (m.rage === PA || (m.rage && m.rage.isPlayer))) { m.rage = null; if (m.state === "fight") m.state = "walk"; } }
        // your boss died → you can step into the SUCCESSION if you're senior
        if ((rec.bossDead || !rec.boss || rec.boss.dead) && (M.rank === "lt" || M.rank === "enforcer")) {
          if (!exists()) {
            // you take the throne: convert membership into OWNING the gang
            rec.bossDead = false;
            claimRivalGang(rec);
            g.cityMembership = null;
            CBZ.city.big("YOU TOOK THE CROWN");
            CBZ.city.note("The boss is dead. You stepped up, the " + (rec.name || "gang") + " is YOURS.", 4);
          } else {
            // you already run your own crew → you PASS on the throne: clear your
            // patch and let the NPC succession crown the next in line (succeedBoss
            // deferred to you while you were senior, so trigger it now).
            g.cityMembership = null;
            if (CBZ.cityGangSucceed) CBZ.cityGangSucceed(rec);
          }
        }
      }
      tryMemberPromote();
    }

    // ---- auto-promote YOUR OWN crew on merit (founded path) ----
    if (g.playerGang && g.playerGang.founded) {
      _autoPromoT = (_autoPromoT || 0) - dt;
      if (_autoPromoT <= 0) { _autoPromoT = 5; autoPromotePlayerCrew(); }
    }

  });
  let _autoPromoT = 0;

  // ---- the gang's own tick: posts honoured, the dead dropped, money, turf ----
  let slowT = 0, loyT = 0;
  const known = new Set();
  CBZ.onUpdate(34.7, function (dt) {
    if (g.mode !== "city") return;
    T += dt || 0;
    if (pendingClaim) { pendingClaim.t -= dt; if (pendingClaim.t <= 0 || !pendingClaim.rec || pendingClaim.rec.absorbed) pendingClaim = null; }
    const pg = g.playerGang;
    if (!pg || !pg.founded) return;
    if (g.state !== "playing") return;
    const mem = liveMembers();
    g.cityCrew = mem.length;
    registerInGangList();
    // a man who died is counted (gangs.js has usually taken the body off the
    // shared roster before this file sees it, so the count is kept by face)
    for (const m of known) { if (m.dead) { known.delete(m); pg.lost = (pg.lost || 0) + 1; } else if (!isMember(m)) known.delete(m); }
    for (let i = 0; i < mem.length; i++) known.add(mem[i]);
    // A MAN THE LAW HAS CUFFED is not on your corner any more: off the roster
    // the moment the cuffs are on (city/custody.js), what he was carrying of
    // yours goes into the evidence bag with him, and the street hears about it
    // the way it hears about a death. (He used to stay on the roster, with
    // his take, sitting in the back of the cruiser.)
    const CU = CBZ.custody;
    if (CU && CU.jobOf) {
      for (let i = mem.length - 1; i >= 0; i--) {
        const m = mem[i], J = CU.jobOf(m);
        if (!J || J.key === "gang" || !(J.cuffed || m.restraint)) continue;
        mem.splice(i, 1); known.delete(m);
        m._take = 0; m._post = null; m.companion = false; m.guard = null; m._pgTaken = true;
        pg.lost = (pg.lost || 0) + 1;
        const P = CBZ.player, mate = mem.find(function (o) { return o && !o.dead && P && dist(o.pos, P.pos) < 30; });
        if (mate) say(mate, pick(["They took " + (m.name ? m.name.split(" ")[0] : "him") + ".", "Cops got " + (m.name ? m.name.split(" ")[0] : "one of ours") + "."]), 2.6);
      }
      g.cityCrew = mem.length;
    }
    const PA = CBZ.city.playerActor;
    for (let i = 0; i < mem.length; i++) {
      const m = mem[i];
      // your gang never turns its guns on you or on each other from the
      // turf-guard brain reading an armed boss on his own block as an intruder
      // (a mutiny is city/orders.js's, and it dismisses the man first)
      if (m.rage === PA || (m.rage && m.rage.isPlayer)) m.rage = null;
      if (m.rage && isMember(m.rage)) m.rage = null;
      if (m._wornOutfit !== FIT) dress(m);
      const p = m._post;
      if (!p || p.kind === "follow") {
        if (!m.companion && !m._order && !m._cbzJob && !m._cbzWait && !(m.ko > 0) && !m.restraint) { m.companion = true; m.guard = null; }
        continue;
      }
      if (m.companion && !m._order) m.companion = false;
      if (!m.guard && !m._order) m.guard = { x: p.x, z: p.z };
      // on his post and calm: he stands the way the post faces
      if (p.face != null && m.group && calm(m) && atPost(m, 1.2) && !(m._faceT > 0)) {
        let d = p.face - m.group.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        m.group.rotation.y += d * Math.min(1, dt * 4);
      }
    }
    tickSellers(dt);
    slowT += dt;
    if (slowT >= 1) { tickTurf(slowT); slowT = 0; }
    loyT += dt;
    if (loyT >= 20) { loyT = 0; tickLoyalty(); }
  });

  // ---- reset (called from cityCareersReset, which we own) ----
  CBZ.cityPlayerGangReset = function () {
    g.playerGang = null;
    g.cityMembership = null; g.playerGangId = null;
    g.cityWasMember = false;
    pendingClaim = null; prospecting = null; jumpedIn = null; workContract = null;
    ctl.clear(); known.clear();
  };
})();
