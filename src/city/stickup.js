/* ============================================================
   city/stickup.js — WHAT A ROBBERY IS MADE OF BESIDES THE GUN: the men
   you brought, the take while it is hot, and the way out.

   There is no "start a heist". A robbery is what you physically do: level
   a gun at the person behind a counter (city/keepers.js is his brain,
   city/racket.js the two demands), reach over a counter nobody is
   watching or crack its safe (city/shops.js), empty a teller's window or
   have the vault opened (city/bank.js), blow a truck (city/armored.js).
   Every one of those moves money out of a real balance through ONE call,
   city/shops.js's CBZ.cityTill.take, and that call tells this file. What
   follows from it lives here, once, for all of them:

   THE CREW (the men walking with you: your gang's, a partner). The
   moment you hold a keeper at gunpoint they take the room with you:
     cover   the first man steps in beside you and levels his gun at
             the room. Staff and customers he can see keep their hands
             up, and a keeper he is covering cannot reach the alarm (and
             keeps walking to the vault) while your back is turned
             (city/keepers.js reads the same stamp).
     door    the second man stands outside by the door, facing the
             street, and calls out the police as they come and from
             which side. A fight at the door is his; the man inside
             leaves the room only for one that comes into it.
     bags    when there is canvas on the floor (a vault, a safe, a
             truck), every man who is not the one holding the room
             shoulders a duffel (city/boarding.js's own bag duty) and
             carries it out behind you; shoulder one yourself and the
             man covering takes one too.
     wheel   a man you left at the wheel (his "Take the wheel") pulls the
             car up to the door when the money moves, and when you get
             in beside him he drives: to your map waypoint, your house,
             or away from the nearest police.
   More guns on a counterman also make him less likely to go for his own
   (city/racket.js asks covering()).

   THE TAKE IS HOT until you are clear: gone from the place with no stars
   on you. It is what was in the drawer, the safe, the vault: notes in
   your pocket under $25,000, duffels over it (CBZ.cashBags). Arrested
   with it, the notes and the bag on your shoulder are evidence. Killed
   with it, the notes lie where you fell, in a bag. Clear, the robbery is
   in the news if the law ever knew, and each man who was in on it is
   owed a tenth of what was taken while he was there (never more than
   half between them): he takes it from your hand when he is beside you
   ("Pay" on him does it sooner), and for money that is still in bags
   the debt goes to the warehouse racks (city/cashstore.js oweCrew).

   THE DYE PACK. Bank money has one in it. Its clock only runs while a
   police officer can see you; if it runs out, it goes off: the duffel on
   your shoulder (or your man's) turns red and loses part of its value
   (CBZ.cashBags.dye), or the stained bundle leaves your pocket and lies
   at your feet in a red cloud. Break their line of sight and it never
   fires.

   Public: CBZ.cityStickup { took, hits, covering, state, payCrew },
   CBZ.cityHeistPayCrew (the name city/cashstore.js settles through).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.onUpdate) return;
  const g = CBZ.game;
  const THREE = window.THREE;

  const SHARE = 0.10, SHARE_CAP = 0.5;      // a tenth a man; you never keep less than half
  const DYE_SECS = 14;                      // seconds IN THEIR SIGHT before the pack goes off
  const DYE_FRAC = [0.14, 0.26];            // the part of the bank money it stains
  const CLEAR_SECS = 3, CLEAR_DIST = 30;    // no stars this long, this far from the door
  const COVER_R = 15;                       // how far a levelled gun holds a room

  function nowS() { return (CBZ.now || 0) / 1000; }
  function Pl() { return CBZ.player; }
  function PA() { return (CBZ.city && CBZ.city.playerActor) || CBZ.player; }
  function arena() { return (CBZ.city && CBZ.city.arena) || null; }
  function fmt$(n) { return "$" + Math.round(n || 0).toLocaleString("en-US"); }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s || 2.4); }
  function say(p, text, secs, ear) {
    if (!p || p.dead || !text || !CBZ.citySay) return false;
    try { return !!CBZ.citySay(p, text, null, { secs: secs || 2.6, force: true, ear: ear || 16 }); } catch (e) { return false; }
  }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  function hyp(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function floorY(x, z, y) { try { return CBZ.floorAt ? CBZ.floorAt(x, z, y) : (y || 0); } catch (e) { return y || 0; } }

  /* ---- THE PLACE ---------------------------------------------------------- */
  function rectOf(lot) {
    const b = lot.building || {};
    return { cx: b.ox != null ? b.ox : lot.cx, cz: b.oz != null ? b.oz : lot.cz, hw: (b.w || lot.w || 16) / 2, hd: (b.d || lot.d || 16) / 2 };
  }
  function inLot(lot, x, z, pad) {
    const r = rectOf(lot);
    return Math.abs(x - r.cx) <= r.hw + (pad || 0) && Math.abs(z - r.cz) <= r.hd + (pad || 0);
  }
  // the shop whose building (x, z) is in
  function lotAt(x, z, pad) {
    const A = arena(), lots = A && A.shopLots;
    if (!lots) return null;
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      if (lot && lot.building && !lot.demolished && inLot(lot, x, z, pad || 0)) return lot;
    }
    return null;
  }
  function doorOf(lot) { const b = lot && lot.building; return (b && (b.door || b.vendorSpot)) || (lot ? { x: lot.cx, z: lot.cz } : null); }
  // a step outside the door, on the street side
  function kerbOf(lot, out) {
    const f = CBZ.cityLotFront ? CBZ.cityLotFront(lot) : null;
    if (f) return { x: f.x + f.ox * out, z: f.z + f.oz * out, ox: f.ox, oz: f.oz };
    const d = doorOf(lot), r = rectOf(lot);
    const dx = d.x - r.cx, dz = d.z - r.cz, l = Math.hypot(dx, dz) || 1;
    return { x: d.x + dx / l * out, z: d.z + dz / l * out, ox: dx / l, oz: dz / l };
  }
  function compass(fx, fz, tx, tz) {
    const dx = tx - fx, dz = tz - fz;
    const ns = dz < 0 ? "north" : "south", ew = dx < 0 ? "west" : "east";
    if (Math.abs(dx) > Math.abs(dz) * 1.6) return ew;
    if (Math.abs(dz) > Math.abs(dx) * 1.6) return ns;
    return ns + ew;
  }

  /* ---- WHO IS WITH YOU (city/boarding.js's one list of followers) ---------- */
  function squad(r) {
    let s = [];
    if (CBZ.followerSquad) { try { s = CBZ.followerSquad(r) || []; } catch (e) { s = []; } }
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const q = s[i], p = q.ped;
      if ((q.role !== "crew" && q.role !== "partner") || !p || p.dead || (p.ko > 0) || p.restraint || p.hostage) continue;
      out.push(p);
    }
    return out;
  }
  // a man of yours sitting at the wheel of a parked car close by
  function wheelMan(x, z, r) {
    const s = squad(r || 90);
    for (let i = 0; i < s.length; i++) {
      const p = s[i], st = p._cbzSeat;
      if (!st || st.id !== "driver" || !st.veh || st.veh.dead || p._cbzArc) continue;
      if (hyp(st.veh.pos.x, st.veh.pos.z, x, z) > (r || 90)) continue;
      return p;
    }
    return null;
  }
  function order(p, verb, opts) {
    if (!CBZ.followerOrder) return false;
    try { return !!CBZ.followerOrder(p, verb, opts || {}); } catch (e) { return false; }
  }

  /* ---- A DUFFEL OFF A MAN'S SHOULDER ---------------------------------------
     city/boarding.js puts a bag on one of yours and only ever takes it off
     again into a vehicle. With no car, or with him dead, it has to come off
     somewhere: at his feet, the same object, still worth what it was. */
  function dropBag(m) {
    const bag = m && m._cbzHeldBag;
    if (!bag) return null;
    const A = arena(), root = (A && A.root) || CBZ.scene;
    const yaw = m.group ? m.group.rotation.y : 0;
    bag.x = m.pos.x + Math.sin(yaw) * 0.7; bag.z = m.pos.z + Math.cos(yaw) * 0.7;
    bag.y = floorY(bag.x, bag.z, (m.pos.y || 0) + 0.6);
    if (bag.mesh) {
      if (bag.mesh.parent) bag.mesh.parent.remove(bag.mesh);
      if (root) root.add(bag.mesh);
      bag.mesh.visible = true;
      bag.mesh.position.set(bag.x, bag.y, bag.z);
      bag.mesh.rotation.set(0, bag.rot || 0, 0);
      bag.mesh.scale.setScalar((bag.mesh.userData && bag.mesh.userData._bagScale) || 1);
    }
    bag.carried = false; bag.air = false; bag._cbzBy = null; bag._cbzStowed = null;
    m._cbzHeldBag = null; m._cbzBag = null;
    if (!m.dead && m.char && CBZ.setCharPose) { try { CBZ.setCharPose(m.char, "stand"); } catch (e) {} }
    return bag;
  }
  function bags() { const B = CBZ.cashBags; if (!B || !B.list) return []; try { return B.list(); } catch (e) { return []; } }

  /* ============================================================
     THE JOB: from the first dollar you take until you are clear, caught
     or dead. One at a time; a second place hit before you are clear is
     the same run.
     ============================================================ */
  let J = null;
  const OWED = new Set();              // the men with a cut still to come out of your hand
  const HITS = new Map();              // lot -> how many times money has left it by your hand
  const seenBags = new Set();          // duffels this file has already placed (a job's, or not one)

  // what the paper calls it (city/newsroom.js has a headline for each of these;
  // anything else it prints as an armed robbery)
  function tierOf(lot, kind) {
    const k = (lot && lot.kind) || kind || "";
    if (k === "bank") return "bank";
    if (k === "armored") return "armored";
    if (k === "jewelry") return "jewelry";
    if (k === "bar" || k === "pawn") return "liquor";
    if (k === "food" || k === "gas") return "store";
    return "robbery";
  }
  function newJob(lot, kind) {
    const d = lot ? doorOf(lot) : null, P = Pl();
    return {
      lot: lot || null, tier: tierOf(lot, kind),
      x: d ? d.x : P.pos.x, z: d ? d.z : P.pos.z,
      taken: 0,            // every dollar that left a balance
      pocketed: 0,         // of it, what landed in your pocket as notes
      notes: 0,            // of that, what is still hot on you
      bagged: 0,           // what landed on the floor in canvas
      bags: [],            // those duffels
      men: new Map(),      // ped -> his share of what left the balance while he was there
      pend: [], stars: 0, clearT: 0, dye: null, warned: false,
    };
  }

  /* city/shops.js's CBZ.cityTill.take calls this for every hostile take by
     the player, BEFORE the caller hands the money on (to your pocket, to
     the floor in bags). Where it landed is read on the next tick. */
  function took(src, amount, point) {
    if (!(amount > 0) || !g || g.mode !== "city") return;
    const P = Pl(); if (!P || P.dead) return;
    const spec = (src && src._tillSpec) || null;
    // your own strongroom, your own racks: not a robbery
    if (spec && (spec.kind === "vault" || spec.kind === "stash")) return;
    // a declared source (a teller's drawer, a back-room safe) is in the building you are standing in
    const lot = spec ? lotAt(P.pos.x, P.pos.z, 1.5) : ((src && src.building) ? src : null);
    const kind = spec ? spec.kind : (lot ? lot.kind : "");
    if (lot) HITS.set(lot, (HITS.get(lot) || 0) + 1);
    if (!J) J = newJob(lot, kind);
    else if (lot && !J.lot) { J.lot = lot; const d = doorOf(lot); J.x = d.x; J.z = d.z; }
    if (tierOf(lot, kind) === "bank") J.tier = "bank";
    else if (kind === "armored" && J.tier !== "bank") J.tier = "armored";
    J.taken += amount; J.clearT = 0;
    const L = bags();
    for (let i = 0; i < L.length; i++) seenBags.add(L[i].id);
    J.pend.push({ amt: amount, bank: kind === "bank" || (lot && lot.kind === "bank"), cash0: g.cash || 0 });
    // the men who are in on it: everybody of yours close enough to be part of it
    const men = squad(90), here = [];
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (m._cbzSeat ? hyp(m.pos.x, m.pos.z, P.pos.x, P.pos.z) < 90 : hyp(m.pos.x, m.pos.z, P.pos.x, P.pos.z) < 40) here.push(m);
    }
    if (here.length) {
      const s = Math.min(SHARE, SHARE_CAP / here.length);
      for (let i = 0; i < here.length; i++) J.men.set(here[i], (J.men.get(here[i]) || 0) + amount * s);
    }
    // the place is being robbed whether or not anybody was held up first
    if (lot && !scene) beginScene(lot, null);
    if (scene) scene.tookT = T;
  }

  // where the last takes landed: canvas on the floor, or notes in your pocket
  function settle() {
    if (!J || !J.pend.length) return;
    let total = 0, bank = false, cash0 = Infinity;
    for (let i = 0; i < J.pend.length; i++) { total += J.pend[i].amt; bank = bank || J.pend[i].bank; cash0 = Math.min(cash0, J.pend[i].cash0); }
    J.pend.length = 0;
    let bagSum = 0;
    const L = bags();
    for (let i = 0; i < L.length; i++) {
      const b = L[i];
      if (seenBags.has(b.id)) continue;
      seenBags.add(b.id);
      b._hot = true; b._hotBank = bank; b._hotAmt = b.amount | 0;
      J.bags.push(b); bagSum += b.amount | 0;
    }
    bagSum = Math.min(bagSum, total);
    const inPocket = Math.max(0, Math.min(total - bagSum, (g.cash || 0) - cash0));
    J.bagged += bagSum; J.pocketed += inPocket; J.notes += inPocket;
    if (bank) {
      if (!J.dye) J.dye = { t: DYE_SECS, frac: DYE_FRAC[0] + Math.random() * (DYE_FRAC[1] - DYE_FRAC[0]), notes: 0, done: false };
      J.dye.notes += inPocket;
      if (!J.warned) {
        J.warned = true;
        const m = nearMan(14);
        if (!(m && say(m, pick(["There's a dye pack in that money. Don't let them see us with it.", "Bank money. There's a dye pack in it. Stay out of their sight."]), 3.4))) {
          note("Bank money has a dye pack in it. Stay out of their sight.", 3.2);
        }
      }
    }
  }
  function nearMan(r) {
    const P = Pl(), men = squad(r);
    let best = null, bd = r;
    for (let i = 0; i < men.length; i++) {
      const m = men[i]; if (m._cbzSeat) continue;
      const d = hyp(m.pos.x, m.pos.z, P.pos.x, P.pos.z);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  /* ---- THE DYE PACK ------------------------------------------------------- */
  function copSees() {
    const cops = CBZ.cityCops, P = Pl();
    if (!cops || !cops.length) return false;
    const px = P.pos.x, pz = P.pos.z, py = (P.pos.y || 0) + 1.4;
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i];
      if (!c || c.dead || !c.pos) continue;
      const dx = c.pos.x - px, dz = c.pos.z - pz;
      if (dx * dx + dz * dz > 26 * 26) continue;
      if (!CBZ.clearLineOfFire || CBZ.clearLineOfFire(c.pos.x, (c.pos.y || 0) + 1.5, c.pos.z, px, py, pz)) return true;
    }
    return false;
  }
  const WADS = [];
  let wadGeo = null, wadMat = null;
  // the ruined bundle: a few stained bricks of notes on the ground where it went off
  function dropWad(x, y, z) {
    if (!THREE) return;
    const A = arena(), root = (A && A.root) || CBZ.scene;
    if (!root) return;
    if (!wadGeo) {
      wadGeo = new THREE.BoxGeometry(0.17, 0.05, 0.08); wadGeo._shared = true;
      wadMat = new THREE.MeshLambertMaterial({ color: 0xb3261e }); wadMat._shared = true;
    }
    const grp = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(wadGeo, wadMat);
      m.position.set((Math.random() - 0.5) * 0.5, 0.03 + (i > 2 ? 0.05 : 0), (Math.random() - 0.5) * 0.5);
      m.rotation.y = Math.random() * 3.1;
      grp.add(m);
    }
    grp.position.set(x, y, z);
    grp.userData.transient = true;
    root.add(grp);
    WADS.push({ grp: grp, t: 120 });
  }
  function dyeBurst() {
    const d = J.dye, P = Pl(), B = CBZ.cashBags;
    d.done = true;
    let bag = null, at = null;
    const c = B && B.carried ? B.carried() : null;
    if (c && c._hot && c._hotBank && !c.dyed) { bag = c; at = { x: P.pos.x, y: (P.pos.y || 0) + 1.3, z: P.pos.z }; }
    if (!bag) {
      for (let i = 0; i < J.bags.length; i++) {
        const b = J.bags[i];
        if (!b || b.dead || b.dyed || !b._hotBank) continue;
        const by = b._cbzBy;
        const bx = by && by.pos ? by.pos.x : b.x, bz = by && by.pos ? by.pos.z : b.z;
        if (hyp(bx, bz, P.pos.x, P.pos.z) > 14) continue;
        bag = b; at = { x: bx, y: (by && by.pos ? (by.pos.y || 0) + 1.3 : (b.y || 0) + 0.4), z: bz };
        break;
      }
    }
    let burn = 0;
    if (bag && B && B.dye) {
      // the canvas is red and what is in it is worth less (city/inventory.js)
      try { burn = B.dye(bag, d.frac) || 0; } catch (e) { burn = 0; }
    } else {
      // notes in your jacket: the stained bundle is out of your pocket and on the ground
      burn = Math.round(Math.min(d.notes, J.notes, Math.max(0, g.cash || 0)) * d.frac);
      if (burn > 0) {
        g.cash -= burn; J.notes -= burn; J.pocketed = Math.max(0, J.pocketed - burn);
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
        dropWad(P.pos.x, floorY(P.pos.x, P.pos.z, (P.pos.y || 0) + 0.6), P.pos.z);
      }
      at = { x: P.pos.x, y: (P.pos.y || 0) + 1.1, z: P.pos.z };
    }
    if (!(burn > 0)) return;
    if (at && CBZ.cityDustKick) { try { CBZ.cityDustKick(at.x, at.y, at.z, 1.1, 0xc8281e); } catch (e) {} }
    if (CBZ.sfx) { try { CBZ.sfx("report"); } catch (e) {} }
    if (CBZ.shake) { try { CBZ.shake(0.3); } catch (e) {} }
    const m = nearMan(14);
    if (!(m && say(m, "Dye pack! " + fmt$(burn) + " of it is red!", 3))) note("The dye pack went off. " + fmt$(burn) + " of it is stained red, worthless.", 3.2);
  }

  /* ---- THE CREW'S CUT ----------------------------------------------------- */
  // the men of yours who are alive to be paid
  function liveMen() {
    const out = [];
    const mem = CBZ.cityPlayerGangMembers ? CBZ.cityPlayerGangMembers() : [];
    for (let i = 0; i < mem.length; i++) if (mem[i] && !mem[i].dead) out.push(mem[i]);
    const s = squad(200);
    for (let i = 0; i < s.length; i++) if (out.indexOf(s[i]) < 0) out.push(s[i]);
    return out;
  }
  /* Money for the crew that is not coming out of your hand: the warehouse
     racks settle a debt in duffels (city/cashstore.js settleCrew calls this by
     its old name). It goes into the pockets of the men who are alive; with
     nobody left to pay, it is yours. Returns what came back to you. */
  function payCrew(amount) {
    amount = Math.round(amount || 0);
    if (!(amount > 0)) return 0;
    const men = liveMen();
    if (!men.length) { if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(amount); return amount; }
    const each = Math.floor(amount / men.length);
    for (let i = 0; i < men.length; i++) men[i].cash = (men[i].cash | 0) + (i === 0 ? amount - each * (men.length - 1) : each);
    return 0;
  }
  // out of your hand into his: what you have on you, up to what he is owed
  function payMan(m, asked) {
    if (!m || m.dead || !(m._cut > 0)) return false;
    const amt = Math.min(Math.round(m._cut), Math.max(0, Math.floor(g.cash || 0)));
    if (amt <= 0) {
      if (asked) say(m, "You've got nothing on you. I can wait. Not long.", 2.6);
      return false;
    }
    if (!(CBZ.city && CBZ.city.spend && CBZ.city.spend(amt))) return false;
    m._cut = Math.max(0, m._cut - amt);
    m._cutT = T + 4;
    let landed = false;
    const land = function () {
      if (landed) return;
      landed = true;
      m.cash = (m.cash | 0) + amt;
      if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
      if (CBZ.cityRelShift) { try { CBZ.cityRelShift(m, "paid", 1); } catch (e) {} }
      if (CBZ.cityMemberStats) { try { const st = CBZ.cityMemberStats(m); if (st && st.loyalty != null) st.loyalty = Math.min(1, st.loyalty + 0.04); } catch (e) {} }
      say(m, m._cut > 0 ? fmt$(amt) + ". The rest when you have it." : pick([fmt$(amt) + ". We're square.", "My end, " + fmt$(amt) + ". Good work.", fmt$(amt) + ". Call me for the next one."]), 2.8);
    };
    let S = null;
    if (CBZ.verbs && CBZ.verbs.takeFrom) {
      try { S = CBZ.verbs.takeFrom(m, PA(), { at: "wristR", kind: "cash", pose: "card", dur: 0.55, onTaken: land }); } catch (e) { S = null; }
    }
    if (!S) land();
    else setTimeout(land, 1800);          // (a reach that was knocked aside still leaves the money in his pocket)
    return true;
  }

  /* ---- HOW IT ENDS -------------------------------------------------------- */
  function clear() {
    const j = J; J = null;
    // what you actually got away with: the notes, and the canvas somebody had on a shoulder
    let hauled = 0;
    for (let i = 0; i < j.bags.length; i++) {
      const b = j.bags[i]; if (!b) continue;
      b._hot = false;
      if (b.held) hauled += b.dead ? (b._hotAmt || 0) : (b.amount | 0);
    }
    const total = j.pocketed + hauled;
    if (!(total > 0)) return;
    // the paper has it only if the law ever did
    if (j.stars > 0) {
      if (CBZ.cityEvent) { try { CBZ.cityEvent("heist-banked", { tier: j.tier, take: Math.round(total), crew: j.men.size }, { silent: true, noWanted: true }); } catch (e) {} }
      if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(Math.min(60, 2 + Math.round(total / 1200)));
    }
    /* THE CUT. Each man's share was counted against what left the balance
       while he was there; he is owed that share of what really came out of
       the building with you. The notes come from your hand; the part that
       is still canvas is owed off the warehouse racks, the day it is stored. */
    const k = j.taken > 0 ? Math.min(1, total / j.taken) : 0;
    const fNotes = j.pocketed / total;
    let rack = 0;
    j.men.forEach(function (share, m) {
      if (!m || m.dead) return;
      const cut = share * k, inNotes = Math.round(cut * fNotes);
      if (inNotes > 0) { m._cut = (m._cut || 0) + inNotes; OWED.add(m); }
      rack += Math.round(cut - inNotes);
    });
    if (rack > 0 && CBZ.cashStore && CBZ.cashStore.oweCrew) {
      try { CBZ.cashStore.oweCrew(rack, j.tier); } catch (e) {}
      const m = nearMan(20);
      if (m) say(m, "Our end of the bags is " + fmt$(rack) + ". It comes off the racks when you store it.", 3.4);
    }
  }
  // arrested with it on you
  function seized() {
    const j = J; J = null;
    let lost = 0;
    const n = Math.min(Math.round(j.notes), Math.max(0, Math.floor(g.cash || 0)));
    if (n > 0) { g.cash -= n; lost += n; }
    const B = CBZ.cashBags, c = B && B.carried ? B.carried() : null;
    if (c && c._hot && B.take) { try { lost += B.take(c) || 0; } catch (e) {} }
    for (let i = 0; i < j.bags.length; i++) if (j.bags[i]) j.bags[i]._hot = false;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (lost > 0) {
      const P = Pl();
      let cop = null, bd = 14;
      const cops = CBZ.cityCops || [];
      for (let i = 0; i < cops.length; i++) { const q = cops[i]; if (!q || q.dead || !q.pos) continue; const d = hyp(q.pos.x, q.pos.z, P.pos.x, P.pos.z); if (d < bd) { bd = d; cop = q; } }
      if (!(cop && say(cop, fmt$(lost) + ". That goes in an evidence bag.", 3.2))) note(fmt$(lost) + " of the take is evidence now.", 3);
    }
  }
  // killed with it on you: the notes lie where you fell (the duffel on your
  // shoulder already hit the ground there, city/inventory.js)
  function fell() {
    const j = J; J = null;
    const P = Pl(), B = CBZ.cashBags;
    const n = Math.min(Math.round(j.notes), Math.max(0, Math.floor(g.cash || 0)));
    if (n > 0) {
      g.cash -= n;
      if (B && B.spawn) {
        let b = null;
        try { b = B.spawn(P.pos.x + 0.5, floorY(P.pos.x, P.pos.z, (P.pos.y || 0) + 0.6), P.pos.z + 0.3, n, { src: "take", srcName: "the take" }); } catch (e) { b = null; }
        if (b) seenBags.add(b.id);
      }
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    }
    for (let i = 0; i < j.bags.length; i++) if (j.bags[i]) j.bags[i]._hot = false;
  }

  /* ============================================================
     THE ROOM: while you hold a keeper at gunpoint (or the money is
     moving) the men with you each take a job.
     ============================================================ */
  let scene = null, T = 0;

  // everybody in the room who is not yours; `hostile` (when given) collects
  // whoever within gunshot of the place has turned on you or your men
  function roomPeople(lot, hostile) {
    const out = [], peds = CBZ.cityPeds || [];
    const r = rectOf(lot), R = Math.max(r.hw, r.hd) + 3, pa = PA(), P = Pl();
    if (hostile) hostile.length = 0;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || !p.pos || p.kind === "cop" || p.companion || p.recruited || p.controlled || p._parked) continue;
      const dx = Math.abs(p.pos.x - r.cx), dz = Math.abs(p.pos.z - r.cz);
      if (hostile && p.rage && dx < R + 30 && dz < R + 30) {
        const q = p.rage;
        if (q === pa || q === P || (q.recruited && q.faction === "player") || q === g.cityPartner) hostile.push(p);
      }
      if (dx > R || dz > R) continue;
      if (!inLot(lot, p.pos.x, p.pos.z, 0.4)) continue;
      out.push(p);
    }
    return out;
  }
  function isKeeper(p, lot) { return !!(p.vendor === lot || p.staffPost || p._venueStaff); }
  // the keeper you have a gun on in this room, if any: the nearest one to you
  // (the sweep's cone holds everybody in front of you, through a partition too)
  function heldKeeper(lot, room) {
    const P = Pl();
    let best = null, bd = 1e9;
    for (let i = 0; i < room.length; i++) {
      const p = room[i];
      // (a clerk watching you turn over a gun off his own wall is not being held up: _keepCalm)
      if (!(p._covered && !p._keepCalm && isKeeper(p, lot) && (p.surrender || p.poseHandsUp || p.poseAimBack || p._keepBusy))) continue;
      const d = hyp(p.pos.x, p.pos.z, P.pos.x, P.pos.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function beginScene(lot, keeper) {
    const P = Pl();
    scene = {
      lot: lot, keeper: keeper || null, px: P.pos.x, pz: P.pos.z,
      room: roomPeople(lot), hostile: [], men: [], off: new Set(), spots: new Map(), roles: new Map(), sides: new Map(),
      t: 0, scanT: 0, markT: 0, lookT: 0, awayT: 0, idleT: 0, tookT: -99,
      cops: 0, callT: 0, said: {}, pulled: false,
    };
  }
  function release(m, follow) {
    if (!m) return;
    const st = m._stick; m._stick = null;
    if (st && st.x != null) m._boardRun = false;
    // on his way to a bag: he lets it lie (a man with one already on his shoulder keeps it)
    if (st && st.role === "bag" && !m._cbzHeldBag && !m._cbzTaking) m._cbzBag = null;
    if (st && (st.role === "cover" || st.role === "door") && m._cbzWait && m._cbzWait === st.wait) {
      order(m, "follow", {});
    }
    if (follow && Pl().driving && Pl()._vehicle && !m._cbzSeat && !m._cbzArc) order(m, "board", { veh: Pl()._vehicle, run: true });
  }
  function endScene() {
    if (!scene) return;
    const men = scene.men;
    scene = null;
    for (let i = 0; i < men.length; i++) release(men[i], true);
  }
  // where a man covering the room stands: beside you, off the line between you
  // and the keeper, on the side he is coming from (the second one takes the other)
  function coverSpot(m) {
    const lot = scene.lot, b = lot.building || {};
    const a = (scene.keeper && scene.keeper.pos) || b.vendorSpot || { x: lot.cx, z: lot.cz };
    let dx = scene.px - a.x, dz = scene.pz - a.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.5) { const d = doorOf(lot); dx = d.x - a.x; dz = d.z - a.z; }
    const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
    let side = ((m.pos.x - a.x) * -dz + (m.pos.z - a.z) * dx) >= 0 ? 1 : -1;
    scene.sides.forEach(function (v, q) { if (q !== m && !q.dead && v === side && scene.roles.get(q) === "cover") side = -side; });
    scene.sides.set(m, side);
    const back = Math.max(2.6, Math.min(l, 4.2));
    const tries = [[side, 2.6], [-side, 2.6], [side, 1.4], [-side, 1.4]];
    for (let i = 0; i < tries.length; i++) {
      const sd = tries[i][0], lat = tries[i][1];
      const x = a.x + dx * back - dz * sd * lat, z = a.z + dz * back + dx * sd * lat;
      if (inLot(lot, x, z, -1.0)) return { x: x, z: z };
    }
    return { x: scene.px - dx * 1.2, z: scene.pz - dz * 1.2 };
  }
  function doorSpot(m) {
    const lot = scene.lot, d = doorOf(lot);
    let s = null;
    if (CBZ.cityCrewDoorSpot) { try { s = CBZ.cityCrewDoorSpot({ x: d.x, z: d.z }, m); } catch (e) { s = null; } }
    if (s && s.lot === lot) return { x: s.x, z: s.z, face: s.face };
    const k = kerbOf(lot, 1.4);
    return { x: k.x - k.oz * 1.5, z: k.z + k.ox * 1.5, face: Math.atan2(k.ox, k.oz) };
  }
  /* WHO PULLS A MAN OFF HIS POST. The police closing on him while you are
     wanted, and anybody who has turned on you or on him. The man on the door
     answers a fight anywhere near the place; the man holding the room only
     one that has come into it (or right up to him): a guard shooting at the
     door is the door man's, and the room stays held. Returns the ped who is
     after HIM (he is sent at that one), true for the rest (the ordinary crew
     brain fights whoever is on you, and the police), null for nobody. */
  function threatTo(m, role) {
    if ((g.wanted | 0) >= 1) {
      const cops = CBZ.cityCops || [];
      for (let i = 0; i < cops.length; i++) { const c = cops[i]; if (c && !c.dead && c.pos && hyp(c.pos.x, c.pos.z, m.pos.x, m.pos.z) < 26) return true; }
    }
    const H = scene ? scene.hostile : [];
    let any = null;
    for (let i = 0; i < H.length; i++) {
      const p = H[i];
      if (p.dead || !p.rage) continue;
      if (p.rage === m) return p;
      const d = hyp(p.pos.x, p.pos.z, m.pos.x, m.pos.z);
      if (role === "cover" ? (d < 9 || inLot(scene.lot, p.pos.x, p.pos.z, 0.5)) : d < 30) any = true;
    }
    return any;
  }
  function looseBags() {
    const out = [], P = Pl(), L = bags();
    for (let i = 0; i < L.length; i++) {
      const b = L[i];
      if (!b || b.dead || b.carried || b.air || b._cbzBy) continue;
      if (hyp(b.x, b.z, P.pos.x, P.pos.z) > 20) continue;
      out.push(b);
    }
    return out;
  }
  /* THROUGH THE DOOR. city/boarding.js walks a man straight at the spot he was
     told to hold, and a post on the other side of the shop front from him is
     a wall away. So he is stepped along the doorway's own line first (the
     mover's order seam, peds.js moveOrder: inside the entry, the door, the
     wall, the pavement), and only then left to boarding.js's hold. */
  function viaDoor(m, spot) {
    const lot = scene.lot;
    const inM = inLot(lot, m.pos.x, m.pos.z, 0), inS = inLot(lot, spot.x, spot.z, 0);
    if (inM === inS) return [];
    const d = doorOf(lot), w = kerbOf(lot, 0.2), o = kerbOf(lot, 1.7);
    // the door record sits back from the wall line on a shop with an entry: keep to its axis
    const line = [{ x: d.x - o.ox * 1.6, z: d.z - o.oz * 1.6 }, { x: d.x, z: d.z }, { x: w.x, z: w.z }, { x: o.x, z: o.z }];
    return inM ? line : line.reverse();
  }
  function post(m, role, spot) {
    const st = m._stick;
    if (st && st.role === role && m._cbzWait === st.wait) return true;
    if (m._cbzBag) m._cbzBag = null;
    if (!order(m, "wait", { x: spot.x, z: spot.z })) return false;
    m._stick = { role: role, x: spot.x, z: spot.z, face: spot.face, wait: m._cbzWait, via: viaDoor(m, spot), saidT: st ? st.saidT : 0 };
    return true;
  }
  // each man keeps the job he was given for as long as the room is held: the
  // first covers, the second takes the door, and so on turn about
  function roleFor(m) {
    let r = scene.roles.get(m);
    if (r) return r;
    let cover = 0, door = 0;
    scene.roles.forEach(function (v, q) { if (q.dead) return; if (v === "cover") cover++; else door++; });
    r = cover <= door ? "cover" : "door";
    scene.roles.set(m, r);
    return r;
  }
  function assign() {
    // the men walking with you, plus the ones already at a post here
    const cand = squad(45), men = [];
    for (let i = 0; i < cand.length; i++) {
      const m = cand[i];
      if (scene.off.has(m) || m._cbzSeat || m._cbzArc || m._cbzJob || m._cbzDriving) continue;
      const st = m._stick;
      // told to come, or to hold somewhere else, by you since he was posted: he is out of it
      if (st && (st.role === "cover" || st.role === "door") && m._cbzWait !== st.wait) { m._stick = null; scene.off.add(m); continue; }
      if (!st && (m._cbzWait || !m.companion)) continue;          // holding where YOU put him
      men.push(m);
    }
    for (let i = 0; i < scene.men.length; i++) if (men.indexOf(scene.men[i]) < 0) release(scene.men[i], false);
    scene.men = men;
    if (!men.length) return;
    const B = CBZ.cashBags, hauling = !!(B && B.carried && B.carried());
    let bagsLeft = looseBags().length;
    // the one who keeps the room while the rest go for the canvas: the first man here whose job is to cover
    let holder = null;
    for (let i = 0; i < men.length && !holder; i++) { const q = men[i]; if (!q._cbzHeldBag && !q._cbzTaking && roleFor(q) === "cover") holder = q; }
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (m._cbzTaking) continue;                                  // his hand is on a bag
      if (m._cbzHeldBag) { if (!m._stick || m._stick.role !== "bag") m._stick = { role: "bag" }; continue; }
      let role = roleFor(m);
      const th = threatTo(m, role);
      if (th) {
        if (m._stick) release(m, false);
        if (th !== true && !m._sicOn) order(m, "sic", { target: th });       // the one shooting at him (city/boarding.js)
        continue;
      }
      // canvas on the floor: everybody but the man holding the room takes one (him too, once you
      // have yours on your shoulder or there is nobody left in the room to hold)
      const holdsRoom = m === holder && scene.room.length > 0 && !hauling;
      if (bagsLeft > 0 && !holdsRoom) role = "bag";
      if (role === "bag") {
        bagsLeft--;
        if (!(m._stick && m._stick.role === "bag" && m._cbzBag)) {
          if (m._stick) release(m, false);
          if (order(m, "bags", {})) { m._stick = { role: "bag" }; if (!scene.said.bag) { scene.said.bag = 1; say(m, pick(["I've got this one.", "Got a bag."]), 2); } }
        }
        continue;
      }
      if (m._stick && m._stick.role === "bag") { m._cbzBag = null; m._stick = null; }
      let spot = scene.spots.get(m);
      if (!spot || spot.role !== role) {
        spot = role === "cover" ? coverSpot(m) : doorSpot(m);
        spot.role = role; scene.spots.set(m, spot);
      }
      post(m, role, spot);
    }
  }
  // per frame: the men at their posts hold them the way the job says
  function hold(dt) {
    const GD = CBZ.gunDiscipline, room = scene.room, t = nowS();
    scene.markT -= dt;
    const mark = scene.markT <= 0;
    if (mark) scene.markT = 0.3;
    let lookout = null;
    for (let i = 0; i < scene.men.length; i++) {
      const m = scene.men[i], st = m._stick;
      if (!st || m.dead) continue;
      // he gets to his post at a run (city/boarding.js walks him there; the run is the same flag its own errands set)
      if (st.x != null) m._boardRun = hyp(m.pos.x, m.pos.z, st.x, st.z) > 2.5;
      if (st.wait && st.wait === m._cbzWait && st.via && st.via.length) {
        if (hyp(m.pos.x, m.pos.z, st.via[0].x, st.via[0].z) < 0.6) st.via.shift();
        const to = st.via[0];
        if (to) {
          st.wait.x = to.x; st.wait.z = to.z;          // (boarding.js's walker agrees about where he is going)
          m.moveOrder = { x: to.x, z: to.z, speed: (m.baseSpeed || 1.3) * 1.8, stop: 0.3, t: CBZ.now || 0 };
          continue;
        }
        st.wait.x = st.x; st.wait.z = st.z; m.moveOrder = null;
      }
      if (st.role === "door") {
        if (hyp(m.pos.x, m.pos.z, st.x, st.z) < 2.2) {
          // (his gun stays where it is: a man standing at a door is nobody, a man with a gun out at one is a call)
          lookout = lookout || m;
          if (st.face != null && CBZ.cityPedFaceYaw) CBZ.cityPedFaceYaw(m, st.face, 0.6);
        }
        continue;
      }
      if (st.role !== "cover" || !m.armed) continue;
      if (hyp(m.pos.x, m.pos.z, st.x, st.z) > 3.2 && !inLot(scene.lot, m.pos.x, m.pos.z, -0.3)) continue;   // not in the room yet
      // his gun is on the nearest person in the room he can see
      const tgt = st.tgt && !st.tgt.dead ? st.tgt : null;
      if (tgt) {
        if (CBZ.cityPedFaceTo) CBZ.cityPedFaceTo(m, tgt.pos.x, tgt.pos.z, 0.5);
        if (GD) GD.trigger(m, "order", 3);
      }
      if (!mark) continue;
      let any = false, best = null, bd = 1e9;
      for (let k = 0; k < room.length; k++) {
        const p = room[k];
        if (p.dead || (p.ko > 0) || p._keepCalm) continue;
        const d = hyp(p.pos.x, p.pos.z, m.pos.x, m.pos.z);
        if (d > COVER_R) continue;
        if (CBZ.clearLineOfFire && !CBZ.clearLineOfFire(m.pos.x, (m.pos.y || 0) + 1.5, m.pos.z, p.pos.x, (p.pos.y || 0) + 1.4, p.pos.z)) continue;
        const score = d + (p === st.tgt ? -1.5 : 0);            // (he stays on the one he is on unless somebody is clearly nearer)
        if (score < bd) { bd = score; best = p; }
        // a keeper with his hands on the vault's lock at your order: watched, not re-posed
        if (p._keepBusy) { p._stickCov = t; continue; }
        // an armed man does not put his hands up for anybody (peds.js); the rest do, and stay put
        if (CBZ.cityMarkGunpoint && CBZ.cityMarkGunpoint(p, 1.1)) {
          p._stickCov = t; any = true;
          // (you were on him a moment ago: the sweep's own let-go waits while this gun is on him)
          if (p._covered) p._coverGrace = Math.max(p._coverGrace || 0, 0.6);
        }
      }
      st.tgt = best;
      if (any && !(st.saidT > 0)) {
        st.saidT = T;
        say(m, pick(["Nobody moves!", "Hands where I can see them!", "Stay right there. All of you."]), 2.6, 20);
      }
    }
    // THE LOOKOUT: the man on the door, or the one at the wheel outside
    scene.lookT -= dt;
    if (scene.lookT <= 0) {
      scene.lookT = 0.5;
      const d = doorOf(scene.lot);
      const who = lookout || wheelMan(d.x, d.z, 70);
      let n = 0, sx = 0, sz = 0;
      const cops = CBZ.cityCops || [];
      if (who) for (let i = 0; i < cops.length; i++) {
        const c = cops[i];
        if (!c || c.dead || !c.pos || c._returned || c.giveUp) continue;
        if (hyp(c.pos.x, c.pos.z, who.pos.x, who.pos.z) > 75) continue;
        if (!((g.wanted | 0) >= 1 || c.curTarget || c.npcTarget)) continue;      // a beat cop walking past is not a call
        n++; sx += c.pos.x; sz += c.pos.z;
      }
      if (who && n > scene.cops && T >= scene.callT) {
        scene.callT = T + 6; scene.cops = n;
        const dir = compass(d.x, d.z, sx / n, sz / n);
        say(who, n === 1 ? "Cop! Coming from the " + dir + "!" : "Cops! " + n + " of them, from the " + dir + "!", 3, 60);
        scene.calls = (scene.calls || 0) + 1;
      } else if (n < scene.cops) scene.cops = n;
    }
  }

  /* ---- THE WHEEL ---------------------------------------------------------- */
  let drive = null, wheelT = 0;      // { man, car, to, pts, i, kind, base }
  function routePts(fx, fz, tx, tz) {
    const RG = CBZ.roadGraph, A = arena(), roads = A && A.roads;
    if (!RG || !RG.of || !RG.route || !roads || !roads.length) return null;
    try {
      const R = RG.route(RG.of(roads), { x: fx, z: fz }, { x: tx, z: tz });
      if (R && R.ok !== false && R.pts && R.pts.length > 1) return R.pts;
    } catch (e) {}
    return null;
  }
  function driveTo(man, car, dest, kind) {
    const pts = (routePts(car.pos.x, car.pos.z, dest.x, dest.z) || []).slice();
    pts.push({ x: dest.x, z: dest.z });
    // (the road's first corner can be the spot he is parked on, and boarding.js stops a car that is at its mark)
    while (pts.length > 1 && hyp(car.pos.x, car.pos.z, pts[0].x, pts[0].z) < 14) pts.shift();
    if (hyp(car.pos.x, car.pos.z, pts[0].x, pts[0].z) < 7) return false;
    // the destination record is ours: city/boarding.js steers at it, and it is moved from corner to corner along the road
    const to = { x: pts[0].x, z: pts[0].z, name: dest.name };
    if (!order(man, "drive", { veh: car, to: to })) return false;
    const base = car.baseV;
    if (kind === "run") car.baseV = Math.max(car.baseV || 11, 19);      // he is not parking it: he is running
    drive = { man: man, car: car, to: to, pts: pts, i: 0, kind: kind, base: base };
    return true;
  }
  // somewhere the police are not: the road end farthest from every one of them
  function awayFrom(car) {
    const cops = CBZ.cityCops || [], A = arena();
    let best = null, bs = -1;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, p = { x: car.pos.x + Math.sin(a) * 380, z: car.pos.z + Math.cos(a) * 380 };
      if (A && A.clampToCity) { try { A.clampToCity(p, 6); } catch (e) {} }
      let s = hyp(p.x, p.z, car.pos.x, car.pos.z);
      for (let i = 0; i < cops.length; i++) { const c = cops[i]; if (c && !c.dead && c.pos) s = Math.min(s, hyp(c.pos.x, c.pos.z, p.x, p.z)); }
      if (s > bs) { bs = s; best = p; }
    }
    if (best) best.name = "somewhere quiet";
    return best;
  }
  function getawayDest(car) {
    let wp = null, dest = null;
    try { wp = CBZ.fullMap && CBZ.fullMap.waypoint ? CBZ.fullMap.waypoint("city") : null; } catch (e) { wp = null; }
    if (wp && wp.x != null) dest = { x: wp.x, z: wp.z, name: wp.label || "the waypoint" };
    if (!dest) {
      const h = g.cityHome && g.cityHome.lot && !g.cityHome.lot.demolished ? g.cityHome.lot : null;
      if (h) { const k = kerbOf(h, 7); dest = { x: k.x, z: k.z, name: "your place" }; }
    }
    // already there and still hot: anywhere the police are not
    if (!dest || hyp(car.pos.x, car.pos.z, dest.x, dest.z) < 25) dest = awayFrom(car);
    return dest;
  }
  function wheelTick() {
    const P = Pl();
    if (drive) {
      const D = drive;
      if (!D.man || D.man.dead || !D.man._cbzDriving || D.man._cbzDriving.car !== D.car) {
        if (D.car && D.base != null) D.car.baseV = D.base;
        drive = null;
      } else {
        // the next corner of the road is where he is steering; the last one is where he stops
        const last = D.pts.length - 1;
        while (D.i < last && hyp(D.car.pos.x, D.car.pos.z, D.pts[D.i].x, D.pts[D.i].z) < 13) D.i++;
        D.to.x = D.pts[D.i].x; D.to.z = D.pts[D.i].z;
        return;
      }
    }
    const hot = !!J || (g.wanted | 0) >= 1;
    if (!hot && !(scene && scene.tookT > 0)) return;
    if (T < wheelT) return;
    wheelT = T + 0.4;
    const lot = (scene && scene.lot) || (J && J.lot);
    const ref = lot ? doorOf(lot) : P.pos;
    const w = wheelMan(ref.x, ref.z, 120) || (P._vehicle ? wheelMan(P.pos.x, P.pos.z, 12) : null);
    if (!w || w._cbzDriving) return;
    const car = w._cbzSeat.veh;
    const aboard = P._vehicle === car && !!(CBZ.cityPaxAboard ? CBZ.cityPaxAboard(car) : P.driving);
    if (aboard) {
      // you are in beside him with the law on you: he goes
      if (!hot) return;
      const dest = getawayDest(car);
      wheelT = T + 6;                               // (one go at a time: he is not asked again for a few seconds)
      if (dest && driveTo(w, car, dest, "run")) say(w, pick(["Hold on.", "We're gone.", "Get down."]), 2);
      return;
    }
    // the money is moving and he is parked up the street: he brings it to the door
    if (lot && scene && scene.tookT > 0 && !scene.pulled) {
      scene.pulled = true;
      const k = kerbOf(lot, 8);
      if (hyp(car.pos.x, car.pos.z, k.x, k.z) > 14 && driveTo(w, car, { x: k.x, z: k.z, name: "the door" }, "pull")) say(w, "Bringing it round!", 2.4, 60);
    }
  }

  /* ============================================================
     THE TICK
     ============================================================ */
  let lastElapsed = 0, wasDead = false, wasBusted = false, sweepT = 0, sweepT2 = 0;
  CBZ.onUpdate(40, function (dt) {
    if (!g || g.mode !== "city") return;
    const P = Pl(); if (!P || !P.pos) return;
    T += dt;
    // a new run: nothing of the last one is owed or hot
    const el = g.elapsed || 0;
    if (el + 0.001 < lastElapsed) { J = null; scene = null; drive = null; HITS.clear(); seenBags.clear(); OWED.clear(); }
    lastElapsed = el;

    // ---- the ruined bundles fade from the street ----
    for (let i = WADS.length - 1; i >= 0; i--) {
      const w = WADS[i]; w.t -= dt;
      if (w.t <= 0 || !w.grp.parent) { if (w.grp.parent) w.grp.parent.remove(w.grp); WADS.splice(i, 1); }
    }

    // ---- the take ----
    const dead = !!P.dead, busted = !!g.busted;
    if (J) {
      settle();
      J.stars = Math.max(J.stars, g.wanted | 0);
      if (dead && !wasDead) fell();
      else if (busted && !wasBusted) seized();
    }
    wasDead = dead; wasBusted = busted;
    if (J && !dead && !busted) {
      const d = J.dye;
      if (d && !d.done && (g.wanted | 0) >= 1 && copSees()) { d.t -= dt; if (d.t <= 0) dyeBurst(); }
      const gone = hyp(P.pos.x, P.pos.z, J.x, J.z) > CLEAR_DIST && !(J.lot && inLot(J.lot, P.pos.x, P.pos.z, 4));
      if (J && (g.wanted | 0) <= 0 && gone) { J.clearT += dt; if (J.clearT >= CLEAR_SECS) clear(); }
      else if (J) J.clearT = 0;
    }

    // ---- the men ----
    if (dead || busted || P.driving || P._aircraft) { if (scene) endScene(); }
    else {
      const tick = (scene ? (scene.scanT -= dt) : (sweepT -= dt)) <= 0;
      if (tick) {
        if (scene) scene.scanT = 0.25; else sweepT = 0.25;
        const lot = lotAt(P.pos.x, P.pos.z, 0.6);
        const armed = !!(CBZ.cityHasGun && CBZ.cityHasGun());
        if (!scene) {
          if (lot && armed) {
            const room = roomPeople(lot), k = heldKeeper(lot, room);
            if (k) beginScene(lot, k);
          }
        } else {
          scene.room = roomPeople(scene.lot, scene.hostile);
          const k = armed ? heldKeeper(scene.lot, scene.room) : null;
          if (k) { scene.keeper = scene.keeper && !scene.keeper.dead ? scene.keeper : k; scene.idleT = 0; }
          else scene.idleT += 0.25;
          if (T - scene.tookT < 20) scene.idleT = 0;
          if (lot === scene.lot) { scene.awayT = 0; } else scene.awayT += 0.25;
          // you walked out, or you put it away and nothing is happening: they come with you
          if (scene.awayT > 0.6 || scene.idleT > 6) endScene();
          else assign();
        }
      }
      if (scene) hold(dt);
    }
    wheelTick();

    // ---- loose ends: a bag on a dead man's shoulder, a cut owed to a man beside you ----
    if ((sweepT2 -= dt) <= 0) {
      sweepT2 = 0.5;
      const L = bags();
      for (let i = 0; i < L.length; i++) { const by = L[i]._cbzBy; if (by && by.dead && by._cbzHeldBag === L[i]) dropBag(by); }
      if (OWED.size && !J && (g.wanted | 0) <= 0 && !P.driving && !dead) {
        for (const m of OWED) {
          if (!m || m.dead || !(m._cut > 0)) { OWED.delete(m); continue; }
          if (m._cbzSeat || m._cbzArc || m._stick || (m._cutT || 0) > T) continue;   // (not while he is holding a room for you)
          if (hyp(m.pos.x, m.pos.z, P.pos.x, P.pos.z) > 6) continue;
          m._cutT = T + 20;                       // asks once in a while, not every half second
          if (payMan(m, false)) break;            // one hand at a time
        }
      }
    }
  });

  /* ---- THE VERBS, on the men themselves ------------------------------------ */
  // the nearest car that is yours to give him (bought, or taken)
  function carFor(p) {
    const cars = CBZ.cityCars || [];
    let best = null, bd = 18;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c.dead || !c.pos || !c.group || !c.group.parent || c.airClass || c.aircraft) continue;
      if (!(c.owned || c.stolen || c.player)) continue;
      const d = hyp(c.pos.x, c.pos.z, p.pos.x, p.pos.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  function isMine(p) {
    if (!p || p.dead || p.restraint || p.hostage) return false;
    return !!(p === g.cityPartner || (p.recruited && (p.kind === "crew" || p.faction === "player")) || (p.companion && p.faction === "player"));
  }
  function wire() {
    const I = CBZ.interactions;
    if (!I || !I.register || wire.done) return !!wire.done;
    wire.done = true;
    const keep = function (s) { return CBZ.cityVerbWord && CBZ.cityVerbWord.keep ? CBZ.cityVerbWord.keep(s) : s; };
    const WHEEL = keep("Take the wheel"), DROP = keep("Drop the bag");
    I.register("ped:civ", {
      id: "stick-wheel", prio: 46,
      label: WHEEL,
      canShow: function (p, ctx) { return !(ctx && ctx.driving) && isMine(p) && !p._cbzSeat && !p._cbzArc && !p._cbzHeldBag && !!carFor(p); },
      onSelect: function (p) {
        const c = carFor(p); if (!c) return;
        if (order(p, "board", { veh: c, slot: "driver", run: true })) say(p, pick(["I'll keep it running.", "Engine's on. Go."]), 2.4);
        else say(p, "Somebody's in that seat.", 2);
      },
    });
    I.register("ped:civ", {
      id: "stick-pay", prio: 58,
      label: function (p) { return "Pay " + fmt$(Math.min(p._cut || 0, Math.max(0, g.cash || 0)) || p._cut || 0); },
      canShow: function (p) { return !!(p && !p.dead && p._cut > 0); },
      onSelect: function (p) { p._cutT = 0; payMan(p, true); },
    });
    I.register("ped:civ", {
      id: "stick-bagdrop", prio: 45,
      label: DROP,
      canShow: function (p) { return !!(p && !p.dead && p._cbzHeldBag && !p._cbzSeat && !p._cbzArc); },
      onSelect: function (p) { const b = dropBag(p); if (b) say(p, "There. " + fmt$(b.amount) + ".", 2); },
    });
    return true;
  }
  if (!wire()) CBZ.onUpdate(40.1, function () { if (g && g.mode === "city") wire(); });

  /* ---- PUBLIC ------------------------------------------------------------- */
  CBZ.cityStickup = {
    took: took,
    // how many times money has left this place by your hand (a job to rob it reads the count)
    hits: function (lot) { return HITS.get(lot) || 0; },
    // how many of yours have a gun on this room right now
    covering: function (lot) {
      if (!scene || (lot && scene.lot !== lot)) return 0;
      let n = 0;
      for (let i = 0; i < scene.men.length; i++) {
        const m = scene.men[i], st = m._stick;
        if (st && st.role === "cover" && m.armed && !m.dead && hyp(m.pos.x, m.pos.z, st.x, st.z) < 3.4) n++;
      }
      return n;
    },
    payCrew: payCrew,
    state: function () {
      return {
        hot: !!J, taken: J ? Math.round(J.taken) : 0, notes: J ? Math.round(J.notes) : 0, bagged: J ? Math.round(J.bagged) : 0,
        bags: J ? J.bags.length : 0, stars: J ? J.stars : 0, tier: J ? J.tier : null,
        dye: J && J.dye ? { t: +J.dye.t.toFixed(2), done: J.dye.done, notes: Math.round(J.dye.notes) } : null,
        owed: J ? Array.from(J.men).map(function (e) { return [e[0].name, Math.round(e[1])]; }) : [],
        scene: scene ? { place: scene.lot.building && scene.lot.building.name, room: scene.room.length, calls: scene.calls || 0,
          keeper: scene.keeper ? scene.keeper.name : null, hostile: scene.hostile.length,
          men: scene.men.map(function (m) { return [m.name, m._stick ? m._stick.role : "", m._stick && m._stick.x != null ? +hyp(m.pos.x, m.pos.z, m._stick.x, m._stick.z).toFixed(1) : 0]; }) } : null,
        drive: drive ? { kind: drive.kind, i: drive.i, of: drive.pts.length } : null,
      };
    },
  };
  // city/cashstore.js settles the crew's end of stored duffels through this name
  CBZ.cityHeistPayCrew = payCrew;
  // (city/factions.js's census still lists the old score file's membership read)
  if (CBZ.factionMigrated) CBZ.factionMigrated("memb:heists");
})();
