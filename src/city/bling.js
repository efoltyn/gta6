/* ============================================================
   city/bling.js — VISIBLE wealth: the street-read made physical.
   WHY: the game is "make money + show off" — levels tell you WHO is
   dangerous, bling tells you WHO is worth robbing. A ped's rolled
   valuables (peds.js/economy.js: "Gold Chain", "Rolex", "Engagement
   Ring"…) already decide the payout; this makes them VISIBLE so you
   can spot the gold chain / iced watch with your EYES and pick your
   mark — no menus, no inspection, just looking at people.

   WHAT A PIECE IS lives in entities/jewelry_kit.js (CBZ.jewel): real link
   chains draped over THIS body's collar and chest with a swinging pendant,
   round brilliants with fire, PBR gold / white gold / platinum, pavé that
   glitters. This file decides WHO wears WHAT and WHERE, and keeps the body
   honest with their pockets:
     • neck   — Gold Chain = a 7 mm gold curb + a polished cross; Iced Chain
                = a 13 mm iced Miami Cuban + an iced medallion; Diamond
                Necklace = a rivière of graduated brilliants + a drop stone
     • wristL — THE WATCH IS entities/watch.js's (CBZ.wristwatch); a look is
                one `watch` part that replaces the wearer's role watch
     • wristR — Tennis Bracelet: a line of brilliants round the MEASURED
                right wrist (watch.js wristPlace)
     • ring   — on the right hand's ring finger base (Diamond Ring = a
                platinum solitaire, Engagement Ring = the $5M rock with pavé
                shoulders, Diamond Pinky = a gold cluster on the little finger)
     • ears   — Earrings: gold hoops / diamond studs through the LOBE the head
                actually drew (character.js charHeadLandmarks)
     • crown  — Diamond Tiara across the front of the head
     • mouth  — Diamond Grill: iced caps ON the teeth, seen when the mouth
                opens, exactly like the teeth themselves
     • eyes   — shades (not jewelry: entities/eyewear.js fits a real pair)
   (Crew colours on the head are NOT bling: every crew member's bandana
   is clothes.js's CBZ.cityAttachBandana -> entities/headwear.js, put on
   by the outfit (gang record) — and for YOUR crew by syncPlayerRag here.)

   PERF: dress only within ~45u of the camera, undress past ~60u, a live
   cap on dressed peds, scan time-sliced (~14 peds/frame). Jewelry geometry
   is cached per piece x body shape inside the kit and swaps to a swept
   tube past a few metres; shades share geometry per (style, head form).

   TRUTH: bling mirrors ped.valuables LIVE. Mug/loot strips the ice
   off the body the moment it's taken (call-through wrappers around
   CBZ.cityRobPed / CBZ.cityLootCorpse — the social.js wrap pattern),
   and a cheap per-frame signature check catches pickpocket dips. A
   corpse KEEPS its shine until looted — you can spot a body still
   wearing its chain from across the street.

   YOUR OWN DRIP: the same read applied to the PLAYER — the best chain /
   watch / ring you actually OWN (g.cityInv, classified through
   CBZ.cityEcon.ITEMS), a VIP-level fit (CBZ.cityPlayerDrip >= VIP_DRIP)
   ices the off-wrist too, and your crew's colors as a bandana. Mounted on
   CBZ.playerChar's rig for third person; in first person your RING is on
   the viewmodel's right hand (CBZ.jewel.setPlayerRing) and your watch on
   its left wrist (watch.js). Re-derived on a 1 s signature compare.

   Headless-safe: every anchor/geometry/API access is guarded, so
   the harness (stub THREE, stub rigs with empty parts) never throws.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  // dress within 45u, undress past 60u (hysteresis so border peds don't flicker)
  const DRESS_D2 = 45 * 45, UNDRESS_D2 = 60 * 60;
  // cap on dressed peds — rides the LIVE quality tier (lo 30 → hi 120); read at
  // every check so the slider applies instantly
  const CAP = () => Math.round(CBZ.qScale ? CBZ.qScale(30, 120) : 60);
  const SLICE = 14;        // peds scanned per frame (full roster every ~0.2s)

  /* ---- SHADES are entities/eyewear.js's (CBZ.eyewear): a real pair FITTED to
     the head it goes on (rim on the nose, temples 2-3 mm off the skin, bent
     behind the ear). They were five boxes at typed neck-local spots whose
     temples ran 1-5 cm INSIDE the skull. A look names the style. */

  /* ---- LOOKS: a look is a short parts list. A jewelry part is `build` (the
     kit makes it for the rig it is going on); a shades part names an
     `eyewear` style (CBZ.eyewear fits it to the rig); a watch is one `watch` part. */
  const WATCH_LOOKS = { watchSteel: 1, watchSilver: 1, watchGold: 1, watchIced: 1, watchDiver: 1, watchAP: 1, watchPatek: 1, watchRM: 1 };
  let _looks = null;
  function looks() {
    if (_looks) return _looks;
    _looks = {
      chainGold: [{ build: "necklace", style: "curb" }],
      chainIced: [{ build: "necklace", style: "cuban" }],
      chainDiamond: [{ build: "necklace", style: "riviera" }],
      bracelet: [{ build: "bracelet", style: "tennis" }],
      ring: [{ build: "ring", style: "solitaire" }],
      ringRock: [{ build: "ring", style: "rock" }],
      ringPinky: [{ build: "ring", style: "pinky" }],
      earrings: [{ build: "earrings", style: "hoop" }],
      earringsIce: [{ build: "earrings", style: "stud" }],
      tiara: [{ build: "tiara" }],
      grill: [{ build: "grill" }],
      // shades — a fitted pair on the eyes (rides the neck: turns with the head)
      shades: [{ eyewear: "wayfarer" }],
      shadesAviator: [{ eyewear: "aviator" }],
      shadesSport: [{ eyewear: "sport" }],
      shadesRetro: [{ eyewear: "round" }],
      shadesDesigner: [{ eyewear: "navigator" }],
    };
    for (const k in WATCH_LOOKS) _looks[k] = [{ kind: "watch", look: k }];
    return _looks;
  }
  // which rig anchor a slot's POOLED parts hang from (jewelry `build` parts
  // find their own place on the rig: the chest, the lobe, the finger, the teeth)
  const SLOTS = { neck: "body", wristL: "la", wristR: "ra", ring: "ra", ears: "neck", crown: "neck", mouth: "neck", eyes: "neck" };
  const SLOT_KEYS = ["neck", "wristL", "wristR", "ring", "ears", "crown", "mouth", "eyes"];
  const LOOK_SLOT = {
    chainGold: "neck", chainIced: "neck", chainDiamond: "neck",
    watchSteel: "wristL", watchSilver: "wristL", watchGold: "wristL", watchIced: "wristL",
    watchDiver: "wristL", watchAP: "wristL", watchPatek: "wristL", watchRM: "wristL",
    bracelet: "wristR",
    ring: "ring", ringRock: "ring", ringPinky: "ring",
    earrings: "ears", earringsIce: "ears",
    tiara: "crown", grill: "mouth",
    shades: "eyes", shadesDesigner: "eyes",
    shadesAviator: "eyes", shadesSport: "eyes", shadesRetro: "eyes",
  };
  function lookParts(key) {
    const L = looks();
    return (key && L[key]) || null;
  }

  /* ---- ONE CLASSIFIER, AND THE CATALOG OUTRANKS IT ------------------------
     economy.js's rows carry an explicit `blingLook`; it is read FIRST. Name
     keywords are the fallback that keeps the LOOT valuables working (Omega /
     Patek / Richard Mille / Tennis Bracelet / Diamond Tiara carry none).
     "Earrings" contains "ring": earrings are tested before rings, once, for
     everybody. Returns { slot, look } or null for "not visible". */
  const _cls = Object.create(null);
  function classify(name) {
    if (!name) return null;
    const key = "" + name;
    const hit = _cls[key];
    if (hit !== undefined) return hit;
    const items = CBZ.cityEcon && CBZ.cityEcon.ITEMS;
    const res = classifyRaw(key, items ? items[key] : null);
    if (items) _cls[key] = res;      // only memoize once the catalog can answer
    return res;
  }
  function classifyRaw(name, it) {
    if (it && it.blingLook && LOOK_SLOT[it.blingLook]) return { slot: LOOK_SLOT[it.blingLook], look: it.blingLook };
    const s = name.toLowerCase();
    const iced = s.indexOf("iced") >= 0 || s.indexOf("diamond") >= 0;
    if (s.indexOf("grill") >= 0) return { slot: "mouth", look: "grill" };          // FIRST: its econ slot is "glasses"
    if (s.indexOf("tiara") >= 0) return { slot: "crown", look: "tiara" };
    if (s.indexOf("earring") >= 0) return { slot: "ears", look: iced ? "earringsIce" : "earrings" };
    if (s.indexOf("shades") >= 0 || s.indexOf("sunglass") >= 0) {
      return { slot: "eyes", look: s.indexOf("designer") >= 0 ? "shadesDesigner" : "shades" };
    }
    if (s.indexOf("chain") >= 0 || s.indexOf("necklace") >= 0) return { slot: "neck", look: chainLookKey(s) };
    if (s.indexOf("watch") >= 0 || s.indexOf("rolex") >= 0 || s.indexOf("omega") >= 0 ||
        s.indexOf("piguet") >= 0 || s.indexOf("audemars") >= 0 || s.indexOf("patek") >= 0 ||
        s.indexOf("philippe") >= 0 || s.indexOf("mille") >= 0) {
      return { slot: "wristL", look: watchLookKey(s) };
    }
    if (s.indexOf("bracelet") >= 0) return { slot: "wristR", look: "bracelet" };
    if (s.indexOf("ring") >= 0 || s.indexOf("pinky") >= 0) return { slot: "ring", look: ringLookKey(s) };
    return null;
  }
  function chainLookKey(s) {
    if (s.indexOf("necklace") >= 0 || s.indexOf("diamond") >= 0) return "chainDiamond";
    if (s.indexOf("iced") >= 0) return "chainIced";
    return "chainGold";
  }
  function watchLookKey(s) {
    if (s.indexOf("mille") >= 0 || s.indexOf("richard") >= 0) return "watchRM";
    if (s.indexOf("piguet") >= 0 || s.indexOf("audemars") >= 0) return "watchAP";
    if (s.indexOf("patek") >= 0 || s.indexOf("philippe") >= 0) return "watchPatek";
    if (s.indexOf("iced") >= 0 || s.indexOf("diamond") >= 0) return "watchIced";
    if (s.indexOf("diver") >= 0) return "watchDiver";
    if (s.indexOf("steel") >= 0 || s.indexOf("omega") >= 0 || s.indexOf("silver") >= 0) return "watchSteel";
    return "watchGold";
  }
  function ringLookKey(s) {
    if (s.indexOf("engagement") >= 0) return "ringRock"; // the $5M stone you learn to hunt
    if (s.indexOf("pinky") >= 0) return "ringPinky";
    return "ring";
  }

  function releaseMesh(mesh) {
    if (!mesh) return;
    if (mesh.userData && mesh.userData.wristwatch) { if (CBZ.wristwatch) CBZ.wristwatch.detach(mesh); return; }
    if (mesh.userData && mesh.userData.jewelPiece) { if (CBZ.jewel) CBZ.jewel.release(mesh); else if (mesh.parent) mesh.parent.remove(mesh); return; }
    if (mesh.parent) mesh.parent.remove(mesh);            // eyewear: shared geometry + materials, the mesh is just dropped
  }

  // Landmarks in the forearm (ELBOW group) frame for the rig being dressed
  // (the ring rides the hand mesh they name).
  function armLandmarks(ch) {
    return (CBZ.charArmLandmarks && CBZ.charArmLandmarks(ch)) || null;
  }
  // a jewelry piece, made by the kit for THIS rig; pushes what it mounted
  function buildJewel(p, rig, lm, out, now) {
    const J = CBZ.jewel;
    if (!J || !rig) return;
    let got = null;
    if (p.build === "necklace") got = J.necklace(rig, p.style, now);
    else if (p.build === "ring") {
      const hand = lm && lm.ringHand, F = lm && lm.ringFingers;
      if (hand) got = J.ring(hand, F ? F[p.style === "pinky" ? 3 : 2] : null, p.style);
    } else if (p.build === "earrings") got = J.earrings(rig, p.style);
    else if (p.build === "tiara") got = J.tiara(rig);
    else if (p.build === "grill") got = J.grill(rig);
    else if (p.build === "bracelet") {
      const place = CBZ.wristwatch && CBZ.wristwatch.wristPlace ? CBZ.wristwatch.wristPlace(rig, true) : null;
      if (place) got = J.bracelet(place.anchor, place);
    }
    const list = Array.isArray(got) ? got : (got ? [got] : []);
    for (let i = 0; i < list.length; i++) { list[i].userData.jewelPiece = true; out.push(list[i]); }
  }
  // mount one slot's parts; pushes what it mounted into `out`. `fresh` =
  // new meshes (the portrait's offscreen rig) instead of the street pool.
  function mountParts(parts, parent, out, lm, rig, fresh) {
    if (!parts) return;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.build) { buildJewel(p, rig, lm, out, fresh || rig === CBZ.playerChar); continue; }
      if (!parent || !parent.add) continue;                  // harness rigs have empty parts — skip slot
      if (p.kind === "watch") { const w = CBZ.wristwatch && CBZ.wristwatch.attach(parent, p.look); if (w) out.push(w); continue; }
      if (p.eyewear) {
        // one pair per face: the protective detail's own shades (outfits.js) outrank a pair in the pocket
        if (!rig || (rig._detailShades && rig._detailShades.parent) || !CBZ.eyewear) continue;
        const m = CBZ.eyewear.make(rig, p.eyewear);
        if (m) { parent.add(m); out.push(m); }
      }
    }
  }


  // ---- what a ped SHOULD be wearing right now, straight from their valuables.
  // A looted corpse is picked clean (jewelry gone); its crew bandana is
  // clothing (outfits.js), not bling, so it stays. First match wins per slot (one chain, one
  // watch: legibility beats completeness). Each slot value is a parts LIST.
  function lootedOut(ped) {
    return !!(ped.dead && ped.deadLoot && ped.deadLoot.looted);
  }
  function computeWant(ped) {
    const want = {};
    let any = false;
    const vals = ped.valuables;
    if (!lootedOut(ped) && vals && vals.length) {
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i]; if (!v) continue;
        // ONE classifier for the street and for you — a Patek robbed off a
        // wrist is the same picture on yours (see classify()).
        const cl = classify("" + v);
        if (!cl || want[cl.slot]) continue;             // first match wins per slot
        const parts = lookParts(cl.look);
        if (!parts) continue;
        want[cl.slot] = parts; any = true;
      }
    }
    return any ? want : null;
  }

  // ---- dress / undress. ped._bling = { meshes, nVal, looted } ----
  const dressed = [];   // peds currently wearing meshes (≤ CAP)
  function anchorsOf(ped) {
    const ch = ped.char;
    if (!ch) return null;
    const laLow = ch.low && ch.low.la || (ch.parts && ch.parts.la && ch.parts.la.userData.low) || (ch.parts && ch.parts.la);
    const raLow = ch.low && ch.low.ra || (ch.parts && ch.parts.ra && ch.parts.ra.userData.low) || (ch.parts && ch.parts.ra);
    return { body: ch.body, neck: ch.neck, la: laLow, ra: raLow, rig: ch };
  }
  function dress(ped, want) {
    const an = anchorsOf(ped);
    if (!an) return;
    const meshes = [];
    const lm = armLandmarks(ped.char);
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const key = SLOT_KEYS[i];
      const parts = want[key]; if (!parts) continue;
      mountParts(parts, an[SLOTS[key]], meshes, lm, an.rig);
    }
    if (!meshes.length) return;
    ped._bling = {
      meshes,
      nVal: ped.valuables ? ped.valuables.length : 0,
      looted: lootedOut(ped),
    };
    dressed.push(ped);
  }
  function undress(ped) {
    const b = ped._bling;
    if (!b) return;
    for (let i = 0; i < b.meshes.length; i++) releaseMesh(b.meshes[i]);
    ped._bling = null;
    const j = dressed.indexOf(ped);
    if (j >= 0) dressed.splice(j, 1);
  }
  function clearAll() {
    for (let i = dressed.length - 1; i >= 0; i--) undress(dressed[i]);
  }

  // re-mirror ONE ped after their valuables changed (mug/loot/pickpocket):
  // strip, then re-dress with whatever they still have on.
  function resyncPed(ped) {
    undress(ped);
    if (!ped || ped.culled || !ped.group || !ped.group.parent) return;
    const cam = CBZ.camera;
    if (!cam || !cam.position || dressed.length >= CAP()) return;
    const dx = ped.pos.x - cam.position.x, dz = ped.pos.z - cam.position.z;
    if (dx * dx + dz * dz > UNDRESS_D2) return;
    const want = computeWant(ped);
    if (want) dress(ped, want);
  }

  // ---- strip-on-take: wrap (never replace) the deed APIs, social.js-style.
  // Call the ORIGINAL first (preserving every side effect/return), then mirror
  // the victim's remaining bling. Only on a REAL take (ret truthy) — a no-op rob
  // must not flicker the chain off and on.
  function wrapStrip(name) {
    const orig = CBZ[name];
    if (typeof orig !== "function") return false;
    if (orig._blingWrapped) return true;
    const w = function (ped) {
      const ret = orig.apply(this, arguments);
      try { if (ret && ped && ped._bling) resyncPed(ped); } catch (e) { /* never break the deed */ }
      return ret;
    };
    w._blingWrapped = true; w._blingOrig = orig;
    CBZ[name] = w;
    return true;
  }
  let _wRob = false, _wLoot = false;

  // ============================================================
  //  YOUR OWN DRIP — the player's body shows the player's money.
  // ============================================================
  // What you OWN that reads on a body, classified ONCE from the econ catalog
  // (so a new luxe item added to ITEMS auto-shows with zero changes here).
  // The SAME classify() the ped path runs → same slots, same finishes: the
  // Patek on your wrist is indistinguishable from the one you robbed, and
  // neither side can grow a private exception for earrings again.
  let _flex = null;   // [{ name, slot, look, value }] — player-visible candidates
  function flexTable() {
    if (_flex) return _flex;
    const items = CBZ.cityEcon && CBZ.cityEcon.ITEMS;
    if (!items) return null;            // econ not booted yet — retry next tick
    _flex = [];
    for (const name in items) {
      const it = items[name];
      if (!it || (it.tag !== "wearable" && it.tag !== "valuable" && it.tag !== "jewelry")) continue;
      const cl = classify(name);        // catalog first, keywords second
      if (cl) _flex.push({ name: name, slot: cl.slot, look: cl.look, value: it.value || 0 });
    }
    return _flex;
  }

  // crew colors: your FOUNDED gang's color outranks the set you're patched into
  // (a boss flies his own flag). Returns the colour hex or null.
  function playerCrewColor() {
    const pg = g.playerGang;
    if (pg && pg.founded) return pg.color != null ? pg.color : 0xb079ea;
    const m = g.cityMembership;
    if (!m || !m.gangId) return null;
    try {
      const gg = CBZ.cityGangById && CBZ.cityGangById(m.gangId);
      if (gg && gg.color != null) return gg.color;
      const defs = (CBZ.CITY && CBZ.CITY.gangs) || [];
      for (let i = 0; i < defs.length; i++) if (defs[i].id === m.gangId) return defs[i].color;
    } catch (e) { /* colour lookup must never break dressing */ }
    return 0xb079ea;
  }
  // YOUR crew bandana goes through the ONE gang headwear (clothes.js
  // cityAttachBandana -> headwear.js). Wearing a gang's COLOURS (outfits.js)
  // already ties that bandana, so this only covers the patched-in player in
  // any other fit, re-asserted each tick because every re-dress (applyPlayer)
  // clears a non-gang fit's bandana. Only a bandana THIS put on is removed.
  let _pRag = null;
  function syncPlayerRag(off) {
    const ch = CBZ.playerChar;
    if (!ch || !CBZ.cityAttachBandana) return;
    const outfitGang = CBZ.cityOutfitGangId && CBZ.cityOutfitGangId();
    const col = (off || outfitGang) ? null : playerCrewColor();
    if (col != null) {
      if (_pRag !== col || !ch._bandana) { CBZ.cityAttachBandana(ch, col); _pRag = col; }
    } else if (_pRag != null) {
      if (!outfitGang) CBZ.cityAttachBandana(ch, null);
      _pRag = null;
    }
  }

  /* THE HAT YOU WEAR. economy.js sells hats (Snapback / Beanie / Fedora, slot
     "hat") and equips them into g.cityOutfit.hat; nothing ever put one on the
     player. The worn, still-owned hat goes on the real head through
     headwear.js on the "shop" owner, which ranks under any uniform / role hat
     (outfits.js "outfit", player.js "player", armor) and over the gang rag, so
     in civvies your hat shows and in a uniform the uniform's does. Re-asserted
     on the 1 Hz tick: a re-dress or a rebuilt rig gets it back, and unequip /
     sell / swap takes it off or changes it. First person hides the whole body
     (fpsmode) or the neck (vehicles), and the hat rides the neck. */
  let _hatRig = null, _hatKey = "";
  function syncPlayerHat(off) {
    const ch = CBZ.playerChar, HW = CBZ.headwear;
    if (!HW) return;
    let kind = null, it = null;
    if (!off && ch) {
      const econ = CBZ.cityEcon, name = econ && econ.outfit ? econ.outfit().hat : null;
      it = name && econ.ITEMS ? econ.ITEMS[name] : null;
      if (it && it.hatLook && econ.count(name) > 0 && HW.canon(it.hatLook)) kind = it.hatLook;
    }
    const key = kind ? kind + "|" + (it.hatColor | 0) : "";
    const onRig = !!(ch && ch._hw && ch._hw.layers && ch._hw.layers.shop);
    if (ch === _hatRig && key === _hatKey && onRig === !!kind) return;     // unchanged
    if (_hatRig && _hatRig !== ch) HW.wear(_hatRig, null, { owner: "shop" });
    if (ch) HW.wear(ch, kind, { owner: "shop", color: kind ? it.hatColor : undefined });
    _hatRig = ch; _hatKey = key;
  }

  // The player's SHOULD-WEAR set + a cheap signature (best item names + gang +
  // VIP flag). Best per slot = highest catalog value among what you still OWN —
  // sell or lose the piece and the next tick strips it off your body.
  function computePlayerWant() {
    const tab = flexTable();
    if (!tab) return null;
    const econ = CBZ.cityEcon;
    const best = {};
    for (let i = 0; i < tab.length; i++) {
      const e = tab[i];
      if (econ.count(e.name) <= 0) continue;
      const b = best[e.slot];
      if (!b || e.value > b.value) best[e.slot] = e;
    }
    // a VIP-level fit (the bouncer's elite read) ices the off-wrist even
    // without a Tennis Bracelet — full luxury reads iced on BOTH wrists.
    const drip = CBZ.cityPlayerDrip ? CBZ.cityPlayerDrip() | 0 : 0;
    const vip = drip >= ((CBZ.CITY && CBZ.CITY.VIP_DRIP) || 70);
    const want = {};
    let any = false, sig = "";
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const k = SLOT_KEYS[i];
      const e = best[k];
      const parts = e ? lookParts(e.look) : null;
      if (parts) { want[k] = parts; any = true; }
      sig += (e ? e.name : "") + "|";
    }
    if (!want.wristR && vip) { want.wristR = lookParts("bracelet"); any = !!want.wristR || any; }
    sig += "|" + (vip ? 1 : 0);
    const rl = best.ring && best.ring.look;
    const ringStyle = rl === "ringRock" ? "rock" : (rl === "ringPinky" ? "pinky" : (rl ? "solitaire" : null));
    return { want: any ? want : null, sig, ringStyle };
  }

  // dress/undress the player rig — same SLOTS, same meshes as peds.
  // No distance/CAP gating: it's a handful of tiny meshes and it IS the protagonist.
  let _pMeshes = null, _pSig = "", _pT = 0, _pDirty = false;
  function undressPlayer() {
    if (_pMeshes) for (let i = 0; i < _pMeshes.length; i++) releaseMesh(_pMeshes[i]);
    _pMeshes = null; _pSig = "";
  }
  function syncPlayer() {
    const res = computePlayerWant();
    if (!res) return;                          // econ not up yet
    if (CBZ.jewel && CBZ.jewel.setPlayerRing) CBZ.jewel.setPlayerRing(res.ringStyle);   // the first-person hand's
    if (res.sig === _pSig && (_pMeshes || !res.want)) return;   // unchanged
    if (_pMeshes) { for (let i = 0; i < _pMeshes.length; i++) releaseMesh(_pMeshes[i]); _pMeshes = null; }
    _pSig = res.sig;
    if (!res.want) return;
    const ch = CBZ.playerChar;
    if (!ch) { _pSig = ""; return; }           // rig not up — retry next tick
    // wristL(watch)/wristR(bracelet)/ring hang from the "la"/"ra" slot, which on
    // the two-segment rig MUST resolve to the ELBOW group (forearm frame) — the
    // watch's `at:"wrist"` landmark is solved in that frame. Resolving to ch.parts.la
    // (the SHOULDER pivot) instead put the player's watch up at the ARMPIT while
    // every ped + the portrait card (charpanel.js) used the elbow. Mirror
    // anchorsOf() exactly so all three paths agree.
    const laA = (ch.low && ch.low.la) || (ch.parts && ch.parts.la && ch.parts.la.userData.low) || (ch.parts && ch.parts.la);
    const raA = (ch.low && ch.low.ra) || (ch.parts && ch.parts.ra && ch.parts.ra.userData.low) || (ch.parts && ch.parts.ra);
    const an = { body: ch.body, neck: ch.neck, la: laA, ra: raA, rig: ch };
    const meshes = [];
    const lm = armLandmarks(ch);
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const key = SLOT_KEYS[i];
      const parts = res.want[key]; if (!parts) continue;
      mountParts(parts, an[SLOTS[key]], meshes, lm, an.rig);
    }
    if (meshes.length) _pMeshes = meshes;
  }
  // instant-feedback hook (optional): shops/econ can poke this on buy/sell/equip
  // so the chain appears the FRAME you buy it; the 1s timer catches everything
  // anyway (sell, drop, rob-loss, gang join/leave) without any caller changes.
  CBZ.cityBlingPlayerDirty = function () { _pDirty = true; };
  CBZ.citySyncPlayerHat = syncPlayerHat;               // tools/headwear-check.mjs
  CBZ.cityPlayerBlingCount = function () { return _pMeshes ? _pMeshes.length : 0; };

  // ---- per-frame: maintain the dressed set (cheap, ≤60), time-slice the scan ----
  let cursor = 0;
  CBZ.onUpdate(34.7, function (dt) {
    if (g.mode !== "city") {
      if (dressed.length) clearAll();
      if (_pMeshes) undressPlayer();           // jail jumpsuit wears no city ice
      if (CBZ.jewel && CBZ.jewel.setPlayerRing) CBZ.jewel.setPlayerRing(null);
      if (_pRag != null) syncPlayerRag(true);  // ...and no city crew bandana
      if (_hatKey) syncPlayerHat(true);         // ...and no shop hat over the jail role
      return;
    }
    // the player's drip: re-derive at 1Hz (or next frame when poked dirty) —
    // a signature compare, so an unchanged inventory costs ~nothing.
    _pT -= dt || 0.016;
    if (_pDirty || _pT <= 0) { _pT = 1; _pDirty = false; syncPlayer(); syncPlayerRag(false); syncPlayerHat(false); }
    // lazy idempotent wrapping — load order with peds.js/social.js doesn't matter,
    // wrappers chain through whatever is current.
    if (!_wRob) _wRob = wrapStrip("cityRobPed");
    if (!_wLoot) _wLoot = wrapStrip("cityLootCorpse");
    const peds = CBZ.cityPeds, cam = CBZ.camera;
    if (!peds || !cam || !cam.position) return;
    const camx = cam.position.x, camz = cam.position.z;

    // 1) dressed peds: undress when far/gone; catch valuable changes that have
    //    no hook (pickpocket lucky dip, defection) via a cheap signature compare.
    for (let i = dressed.length - 1; i >= 0; i--) {
      const p = dressed[i], b = p._bling;
      if (!b) { dressed.splice(i, 1); continue; }
      if (p.culled || !p.group || !p.group.parent) { undress(p); continue; }
      const dx = p.pos.x - camx, dz = p.pos.z - camz;
      if (dx * dx + dz * dz > UNDRESS_D2) { undress(p); continue; }
      const nVal = p.valuables ? p.valuables.length : 0;
      if (nVal !== b.nVal || lootedOut(p) !== b.looted) resyncPed(p);
    }

    // 2) sliced scan: dress newly-near peds (a few per frame; full roster ~every
    //    0.2s — fast enough that bling appears before you can read the face).
    const n = peds.length, cap = CAP();   // live read: slider moves the cap this frame
    if (!n || dressed.length >= cap) return;
    for (let k = 0; k < SLICE && dressed.length < cap; k++) {
      cursor = (cursor + 1) % n;
      const p = peds[cursor];
      if (!p || p._bling || p.culled || p._parked || p.inCar) continue;
      if (!p.group || !p.group.parent || !p.pos) continue;
      const dx = p.pos.x - camx, dz = p.pos.z - camz;
      if (dx * dx + dz * dz > DRESS_D2) continue;
      const want = computeWant(p);
      if (want) dress(p, want);
    }
  });

  // exposed for the harness/debug: how many peds are dressed right now.
  CBZ.cityBlingCount = function () { return dressed.length; };

  // ---- THE ONE ANSWER TO "WHAT DOES THIS ITEM LOOK LIKE ON A BODY" ---------
  // charpanel.js's portrait had its own copy of the geometry table, the finish
  // table, the part lists AND the slot classifier — a fourth copy that had
  // already drifted (it still tests `earring` by hand). These three exports
  // are what let a caller delete all four and stay identical to the street.
  CBZ.cityBlingClassify = classify;                    // name -> { slot, look } | null
  CBZ.cityBlingParts = function (name) {               // name -> parts list | null
    const cl = classify(name);
    return cl ? lookParts(cl.look) : null;
  };
  CBZ.cityBlingLookParts = lookParts;                  // look key -> parts list | null (tools/overlap-audit.mjs)
  // Mount a parts list on a rig OUTSIDE the street roster (the portrait's
  // offscreen rig): the kit builds FRESH jewelry for it instead of sharing the
  // dressed roster's cache refs, so a caller can just remove what it got.
  // Same shared geometry + materials, so the read is identical.
  // Jewelry is made by the kit for `rig` (the portrait's own body), so the
  // chain drapes over THAT chest and the ring sits on THAT hand.
  CBZ.cityBlingBuild = function (parts, parent, out, lm, rig) {
    if (!parts) return out || null;
    out = out || [];
    mountParts(parts, parent, out, lm || (rig ? armLandmarks(rig) : null), rig || null, true);
    return out;
  };
  // RATCHET — every catalog row that can appear on a body, resolved through the
  // classifier the game actually runs. Never called here.
  //   holes      — a row the catalog itself calls jewellery (tag "jewelry", or
  //                an econ slot of chain/watch/ring/glasses) that renders
  //                NOTHING. THIS is the number that may only go DOWN: it read 1
  //                before this wave (Earrings) and 0 after. `unclassified` is
  //                informational — a Wallet is not a hole, it is a wallet.
  //   meshes/maxMeshes — the draw-call bill, printed beside the count so a look
  //                that gets fancier cannot hide what it costs.
  //   declared   — rows whose look came from economy.js instead of a keyword
  //                guess; it should climb as the catalog is filled in.
  const JEWEL_SLOTS = { chain: 1, watch: 1, ring: 1, glasses: 1 };
  CBZ.cityBlingAudit = function () {
    const items = CBZ.cityEcon && CBZ.cityEcon.ITEMS;
    const out = { rows: [], slots: {}, count: 0, declared: 0, holes: 0, holeNames: [], unclassified: 0, meshes: 0, maxMeshes: 0 };
    if (!items) return out;
    for (const name in items) {
      const it = items[name];
      if (!it || (it.tag !== "wearable" && it.tag !== "valuable" && it.tag !== "jewelry")) continue;
      const cl = classify(name);
      if (!cl) {
        out.unclassified++;
        if (it.tag === "jewelry" || JEWEL_SLOTS[it.slot]) { out.holes++; out.holeNames.push(name); }
        continue;
      }
      const parts = lookParts(cl.look);
      const n = parts ? parts.length : 0;
      if (!n) { out.holes++; out.holeNames.push(name); }
      out.rows.push({ name: name, slot: cl.slot, look: cl.look, meshes: n, declared: !!it.blingLook });
      out.slots[cl.slot] = (out.slots[cl.slot] || 0) + 1;
      if (it.blingLook) out.declared++;
      out.meshes += n;
      if (n > out.maxMeshes) out.maxMeshes = n;
    }
    out.count = out.rows.length;
    return out;
  };
  // re-mirror ONE ped's attachments after their valuables/colors changed
  // out-of-band — outfits.js calls this on the corpse-swap so the jewelry
  // read stays honest the moment the trade lands.
  CBZ.cityBlingResyncPed = resyncPed;
})();
