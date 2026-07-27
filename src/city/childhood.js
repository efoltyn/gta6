/* ============================================================
   city/childhood.js — GROWING UP. The half of the family sim that was
   missing: a birthday that ticks, a body that changes shape when it
   crosses a growth band, and a child who behaves like one.

   WHAT WAS BROKEN (the whole reason this file exists). Three separate
   places minted "a child" and all three faked it the same way:

       kid = CBZ.cityMakePed(...);
       kid.char.group.scale.setScalar(0.62);   // <- a SHRUNKEN ADULT
       kid.hp = kid.maxHp = 40;

   (births.js doBirth, family.js famPed, and social.js's boss-kid — which
   didn't even scale, so its "kid" was a full-size adult named "Young Bob".)
   births.js's own header admitted the rest: "GROWING UP: NOT in scope. The
   kid spawns at kid scale/hp and stays that way — no aging pass exists."
   So the city had two kinds of person: adults, and 62%-size adults, frozen
   at that size forever, wandering the street alone at 3am.

   THE THREE THINGS THIS FIXES, and where each one lives:

   1. THE BIRTHDAY lives in city/familytree.js, not here and not on the ped.
      A ped BODY is transient — crowd.js parks it, schedule.js stashes the
      identity to a ledger page whose fields are a fixed whitelist we cannot
      extend, and cityPedDeal later re-attaches that identity to a DIFFERENT
      body. The sid survives all of it, and familytree.js is already the
      sid-keyed, save-persisted book of who-is-whose. So a birthday is a
      `born[sid] = dayTime()` stamp there, and AGE IS DERIVED ON READ
      (today − bornDay). Nothing ticks an age. That is what makes an offline
      NPC age at exactly the same rate as the one in front of you — a parked
      body, a stashed ledger page and a save file all age for free, because
      none of them stores an age at all. (crown.js already proved this shape
      for royals: a `born` field + a day counter, no aging pass anywhere.)

      THE CLOCK: CBZ.dayTime() from core/daynight.js = dayCount() + dayPhase(),
      a continuous monotonic days-elapsed counter whose BOTH halves already
      ride the world save (net/netpersist.js:140-141 / 267-268). Not
      polity.js's CBZ.worldDay(): that one's own header says it "does NOT
      survive reset(): a fresh run is day 0, always", and it only exists once
      polity.js has loaded. See familytree.js's header for the full argument.

   2. THE BODY is city/entities/character.js's job — `makeCharacter({age})`
      builds real child proportions (near-adult head on a short torso, legs
      at ~37% of height instead of ~48%, pot belly, no neck, wide-base
      toddler gait). A child is NOT a scaled adult, and `group.scale` must
      never fake one again. This file only decides WHEN a body is wrong and
      swaps it — see rebody() below, and CBZ.childBodyAudit() which counts
      any body still faking it.

   3. THE BEHAVIOUR is here, and it is ONE slow tick (order 34.9, right
      after peds.js's own 34 and births.js's 34.8) that walks the child
      population and nudges it. It does NOT add an AI loop: locomotion goes
      through CBZ.protection.moveToward — the single shared follow primitive
      officials.js/social.js/protection.js all converged on — and "indoors"
      reuses peds.js's OWN `ped.enterT` building-interior state rather than
      inventing a hide flag. CLAUDE.md counts 18-25 independent AI update
      loops as a ratchet; this is not the 26th.

   THE HARD RULE THE OWNER WILL LOOK FOR: no unaccompanied child outdoors at
   night. It is enforced, not hoped for — an out-past-curfew child is walked
   home (or, when far enough from the camera that nobody could see the pop,
   put home directly) and then held INSIDE via enterT. Teens get a later,
   softer curfew, because that is the difference between a teen and a child.

   DEGRADE-SAFETY: every cross-module call is optional-chained. With
   familytree.js absent, ages fall back to a runtime-only stamp on the ped
   (works, just doesn't survive a despawn). With character.js's `age` support
   absent, rebody() detects that makeCharacter ignored the field and gives up
   permanently instead of rebuilding the same adult forever. With
   protection.js absent, locomotion degrades to a plain ped.target nudge —
   family.js's own proven "re-issue the target when they drift" idiom. Flip
   CBZ.CONFIG.CHILD_AGING = false and the whole file is inert.

   DETERMINISM: no Math.random on any generation path. Cast ages come from
   CBZ.hash01(x, z, salt) — position-hashed, so it is order-independent and
   cannot perturb family.js's shared rng() draw ORDER (the fragile thing
   CLAUDE.md bans touching). Runtime jitter uses this module's own
   CBZ.seedStream("childhood") stream, never a caller's.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // ---- FLAGS ---------------------------------------------------------------
  // Declared defensively here because this file may load before/without a
  // src/config.js entry; every one wants a real home in config.js's block
  // (reported to the owner). Repo idiom: `if (X == null) X = default`, so a
  // config.js value always wins and each one is a one-line revert.
  const C = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (C.CHILD_AGING == null) C.CHILD_AGING = true;          // master: age + re-body + behaviour
  if (C.CHILD_YEARS_PER_DAY == null) C.CHILD_YEARS_PER_DAY = 1;  // one world-day (150s) = one year of life
  if (C.CHILD_REBODY == null) C.CHILD_REBODY = true;        // rebuild the rig on a band change
  if (C.CHILD_CURFEW == null) C.CHILD_CURFEW = true;        // the no-kids-out-at-night law
  if (C.CHILD_ADULT_AGE == null) C.CHILD_ADULT_AGE = 18;    // matches character.js's CHILD_ADULT_AGE

  const on = () => !!C.CHILD_AGING;
  const noSim = () => !!(CBZ.net && CBZ.net.noSim && CBZ.net.noSim());
  const yearsPerDay = () => {
    const v = C.CHILD_YEARS_PER_DAY;
    return (v != null && isFinite(v) && v > 0) ? +v : 1;
  };
  const ADULT = () => {
    const v = C.CHILD_ADULT_AGE;
    return (v != null && isFinite(v) && v > 0) ? +v : 18;
  };

  // this module's OWN deterministic stream — never a caller's rng (adding a
  // draw to a shared stream shifts every downstream value; CLAUDE.md's
  // order-fragility law). Used only for cosmetic jitter, never for a build.
  const rng = (CBZ.seedStream ? CBZ.seedStream("childhood") : function () { return 0.5; });

  const FT = () => CBZ.cityFamilyTree || null;
  function dayNow() {
    if (typeof CBZ.dayTime === "function") return CBZ.dayTime();
    if (typeof CBZ.dayCount === "function") {
      return CBZ.dayCount() + (typeof CBZ.dayPhase === "function" ? CBZ.dayPhase() : 0);
    }
    return 0;
  }
  function hourNow() { return CBZ.cityHour ? CBZ.cityHour() : 12; }

  // ============================================================
  //  AGE — the reads. All three are cheap and safe to call anywhere.
  // ============================================================

  // Band names mirror character.js's bandOf() EXACTLY. We ask CBZ.charProfile
  // first so there is one authority; this table is the fallback for the window
  // where character.js hasn't exported it (or a harness stubbed it out).
  function bandLocal(age) {
    if (age == null || age >= ADULT()) return "adult";
    if (age < 1.1) return "baby";
    if (age < 4) return "toddler";
    if (age < 10) return "child";
    if (age < 13) return "preteen";
    return "teen";
  }
  function bandOf(age, build) {
    if (age == null) return "adult";
    if (CBZ.charProfile) {
      try {
        const p = CBZ.charProfile(build === "f" ? "f" : "m", age);
        if (p && p.band) return p.band;
      } catch (e) {}
    }
    return bandLocal(age);
  }
  // WHAT SHAPE IS THIS BODY IN RIGHT NOW — read off the rig itself.
  // entities/character.js stamps `band` / `ageYears` / `child` / `profile`
  // onto every record makeCharacter returns, so the rig knows what it was
  // built as and we never keep a second copy that can drift out of sync
  // (that parallel-bookkeeping trap is what CLAUDE.md's block law is about).
  // The _rig* fallbacks cover a character.js that predates those fields.
  function rigBandOf(ped) {
    const ch = ped.char;
    if (ch && ch.band) return ch.band;
    return ped._rigBand || "adult";
  }
  function rigAgeOf(ped) {
    const ch = ped.char;
    if (ch && ch.ageYears != null && isFinite(ch.ageYears)) return +ch.ageYears;
    if (ch && ch.band === "adult") return null;
    return ped._rigAge != null ? ped._rigAge : null;
  }

  function statureOf(age, build) {
    if (age == null) return 1;
    if (CBZ.charProfile) {
      try {
        const p = CBZ.charProfile(build === "f" ? "f" : "m", age);
        if (p && p.statureMul > 0) return p.statureMul;
      } catch (e) {}
    }
    // crude fallback along character.js's own GROWTH curve endpoints
    return Math.max(0.3, Math.min(1, 0.30 + 0.70 * Math.min(1, age / ADULT())));
  }

  // CBZ.cityAgeYears(ped) — THE age read. Resolution order matters:
  //   1. the family tree's persisted birthday, keyed by sid. Authoritative,
  //      because it is the only one that survives a stash/deal/save.
  //   2. a runtime birthday stamped on the ped (no sid yet, or no tree).
  //   3. a static ped.ageYears handed in by a spawner (peds.js's opts.age)
  //      that we haven't converted to a birthday yet — convert it here, so
  //      the FIRST read of any freshly-minted child starts its clock.
  // Returns null for "no recorded age" — which means ADULT, and is NOT the
  // same as 0. Almost every ped in the city is a null.
  function ageYears(ped) {
    if (!ped || ped.isPlayer) return null;
    const T = FT();
    if (T && T.ageOf && ped._sid) {
      const a = T.ageOf(ped._sid);
      if (a != null) { ped.ageYears = a; return a; }
    }
    if (ped._bornDay != null && isFinite(ped._bornDay)) {
      const a = Math.max(0, (dayNow() - ped._bornDay) * yearsPerDay());
      ped.ageYears = a;
      return a;
    }
    if (ped.ageYears != null && isFinite(ped.ageYears)) {
      // a spawner stamped a static age and nothing started its clock: start
      // it now, back-dated, so the very next read already advances.
      ped._bornDay = dayNow() - Math.max(0, +ped.ageYears) / yearsPerDay();
      if (T && T.setBorn && ped._sid) T.setBorn(ped._sid, ped._bornDay);
      return +ped.ageYears;
    }
    return null;
  }
  function isChild(ped) {
    const a = ageYears(ped);
    return a != null && a < ADULT();
  }
  function ageBand(ped) { return bandOf(ageYears(ped), ped && ped.gender); }

  // ============================================================
  //  cityChildAge(ped, years) — THE ONE-LINE ADOPTION for spawners.
  //  Replaces the `scale.setScalar(0.62); hp = maxHp = 40` couplet at every
  //  kid site with a single guarded call that (a) starts a persisted
  //  birthday, (b) sizes hp to the body, (c) tags the ped so the tick below
  //  picks it up on its next pass. Safe to call twice; safe to call on a ped
  //  whose rig is still adult (the tick re-bodies it).
  // ============================================================
  function childAge(ped, years) {
    if (!ped) return null;
    const y = (years != null && isFinite(years)) ? Math.max(0, +years) : 0;
    const bd = dayNow() - y / yearsPerDay();
    ped._bornDay = bd;
    ped.ageYears = y;
    ped.child = y < ADULT();
    ped.band = bandOf(y, ped.gender);
    // persist against the identity when one exists. We do NOT force-mint a sid
    // here (schedule.js's cityPedStash has its own worth() gate and its own
    // opinion about who is ledger-worthy) — familytree.js's bearChild already
    // mints one for every kid that enters the tree, which is all three sites.
    const T = FT();
    if (T && T.setBorn && ped._sid) T.setBorn(ped._sid, bd, true);
    applyAgeHp(ped, y);
    return y;
  }

  // HP scales with the body, not with a combat design. A child having 40hp
  // was really a TARGETABILITY statement; non-targetability is
  // CBZ.isProtectedActor()'s job (another system), so all this does is keep
  // a small body from carrying an adult's health bar. Never lowers a maxHp
  // that a caster deliberately set higher.
  function applyAgeHp(ped, age) {
    if (age == null || age >= ADULT()) return;
    const st = statureOf(age, ped.gender);
    const mx = Math.max(20, Math.round(40 + 60 * st));
    const wasFull = ped.maxHp > 0 && ped.hp >= ped.maxHp;
    ped.maxHp = mx;
    if (wasFull || ped.hp == null || ped.hp > mx) ped.hp = mx;
  }

  // ============================================================
  //  RE-BODY — swap a live ped's rig for one built at the right age.
  //
  //  There was NO existing rig-swap path to reuse: outfits.js's
  //  cityRedressPed only RECOLOURS an existing rig, and crowd.js's promotion
  //  pool reuses rigs whose geometry is baked at construction (its own
  //  pickFreeSlot comment says so: "a pooled rig's BUILD is baked into its
  //  actual geometry and can't be reshaped"). So this is the one place that
  //  does it, exported as CBZ.cityRebodyPed for anything that later needs
  //  the same move (a body-type change, a transformation, a growth spurt).
  //
  //  THE TRICK THAT MAKES IT SAFE: we do NOT replace ped.group. makeCharacter
  //  returns `{group: g}` where g's ONLY child is a `model` node holding the
  //  entire skeleton (character.js:507 `g.add(model)`; every mesh hangs off
  //  model). So we swap the MODEL and keep the root. That means ped.group,
  //  ped.pos (which IS group.position — re-pointing it would strand any
  //  cached reference), the group's parent, its userData and anything another
  //  system attached to the root all survive the operation untouched. Only
  //  the visible body changes.
  //
  //  NOTHING IS DISPOSED: character.js builds from CBZ.boxGeom/cmat, which
  //  are SHARED caches — disposing a "discarded" rig's geometry or material
  //  would blow a hole in every other body in the city. The detached model is
  //  left to GC.
  // ============================================================
  function readHex(list) {
    if (!list) return null;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m && m.material && m.material.color && m.material.color.getHex) return m.material.color.getHex();
    }
    return null;
  }
  // Rebuild the makeCharacter spec by READING the rig we're about to replace,
  // so a re-bodied person keeps the exact clothes they were wearing. (Cast
  // paint/garment structure is re-applied afterwards by outfits.js's own
  // redressPed — the established "keep a body's cloth true to who it is" path.)
  function specOf(ped) {
    const ch = ped.char, ss = (ch && ch.skinSlots) || {};
    const torso = readHex(ss.torso);
    const arms = readHex(ss.arms);
    const armsLo = readHex(ss.armsLower);
    return {
      legs: readHex(ss.legs) != null ? readHex(ss.legs) : 0x363b46,
      torso: torso != null ? torso : (ped.outfit != null ? ped.outfit : 0x8a939c),
      collar: readHex(ss.collar) != null ? readHex(ss.collar) : (torso != null ? torso : 0x8a939c),
      arms: arms != null ? arms : (torso != null ? torso : 0x8a939c),
      skin: (ch && ch.skinTone != null) ? ch.skinTone : (ped.skin != null ? ped.skin : 0xcf9a72),
      hair: readHex(ss.hair) != null ? readHex(ss.hair) : 0x241a12,
      shoes: readHex(ss.shoes) != null ? readHex(ss.shoes) : 0x2b2b2b,
      cap: readHex(ss.cap),
      // a short sleeve is exactly "the forearm is painted skin, the arm isn't"
      shortSleeve: !!(armsLo != null && arms != null && armsLo !== arms),
      build: ped.gender === "f" ? "f" : "m",
      longHair: !!ped._longHair,
    };
  }

  // set once we PROVE makeCharacter ignores `age` (an older character.js):
  // rebuilding an identical adult forever would be a per-child rig churn with
  // nothing to show for it, so we stop trying after the first failed proof.
  let _ageSupport = null;   // null = unknown, true/false = proven

  function rebody(ped, age) {
    if (!ped || ped.dead || !ped.char || !ped.group || !CBZ.makeCharacter) return false;
    if (_ageSupport === false) return false;
    // NEVER re-body a POOLED CROWD RIG. crowd.js's makePooled() calls
    // cloneLook() to give each pooled body its OWN cloned materials,
    // specifically so setLook()'s per-agent tinting can't bleed across the
    // pool ("isolate a pooled rig's tinted materials once so recolouring it
    // per agent can't bleed onto the shared material cache"). A fresh
    // makeCharacter comes back on the SHARED cmat cache, so re-bodying one
    // would re-point it at shared materials and the next setLook would repaint
    // half the city. A pooled body is ambient street furniture that gets
    // recycled constantly — it has no business being somebody's child anyway.
    if (ped._crowd || ped._parked) return false;
    // a body another placement owns (seated in an aircraft, driving) must not
    // have its skeleton swapped out from under that system mid-frame.
    if (ped.inCar || ped._npcAttached) return false;
    const oldCh = ped.char;
    const G = ped.group;
    const spec = specOf(ped);
    if (age != null && age < ADULT()) spec.age = age;   // omit entirely for an adult rebuild
    let nu = null;
    try { nu = CBZ.makeCharacter(spec); } catch (e) { return false; }
    if (!nu || !nu.group) return false;

    // PROOF that this character.js understands `age`: a child spec must come
    // back with a different stature than the adult it would otherwise be.
    if (_ageSupport == null && spec.age != null) {
      const m1 = nu.group.userData && nu.group.userData.characterMetric;
      _ageSupport = !!(CBZ.charProfile) || !!(m1 && oldCh.metric && Math.abs(m1.height - oldCh.metric.height) > 0.02);
      if (!_ageSupport) return false;   // old rig: leave the body alone rather than churn it
    }

    // the new skeleton hangs off ONE node; move that node under the ORIGINAL
    // root and throw the new root away (see the header comment).
    const nm = nu.model || nu.group.children[0];
    if (!nm) return false;
    const om = oldCh.model || null;
    if (om && om.parent === G) G.remove(om);
    else {
      // defensive: an older/odd rig with no `model` node — drop whatever
      // children the character built, but ONLY those (never other systems').
      for (let i = G.children.length - 1; i >= 0; i--) {
        const c = G.children[i];
        if (c && c.userData && c.userData.characterModel) G.remove(c);
      }
    }
    nu.group.remove(nm);
    G.add(nm);
    // carry the new body's metrics onto the surviving root
    if (nu.group.userData) {
      if (nu.group.userData.humanScale != null) G.userData.humanScale = nu.group.userData.humanScale;
      if (nu.group.userData.characterMetric) G.userData.characterMetric = nu.group.userData.characterMetric;
      // THE AGE STAMPS MUST TRAVEL TOO. character.js writes charBand/charAge/
      // charChild onto the root it built — and we are about to throw that root
      // away and keep the original. Miss these and the surviving root keeps the
      // band it was BORN with forever: systems/childsafe.js walks up the scene
      // graph to these exact fields when a raycast hands it a mesh instead of a
      // ped, so a stale band means a grown adult stays permanently
      // bullet-proof, and (worse) any body whose root was never stamped reads
      // as an adult no matter what it now looks like.
      G.userData.charBand = nu.group.userData.charBand;
      G.userData.charAge = nu.group.userData.charAge;
      G.userData.charChild = nu.group.userData.charChild;
    }
    nu.group = G;                 // the rig record now drives the original root
    // NOTE the new rig carries its own `band`/`ageYears`/`child`/`profile`
    // (character.js stamps them at build time) — that record, not a memo of
    // ours, is the authority on "what shape is this body actually in". The
    // _rig* fields below are only the fallback for a character.js that
    // predates those fields.
    // THE FAKE DIES HERE: whatever scale a legacy site (or an old save's
    // restored body) left on the root, a real child body is scale 1.
    if (G.scale && G.scale.set) G.scale.set(1, 1, 1);

    // carry animation/pose continuity so the swap isn't a visible reset
    nu.phase = oldCh.phase != null ? oldCh.phase : nu.phase;
    nu.breath = oldCh.breath != null ? oldCh.breath : nu.breath;
    nu.sitting = !!oldCh.sitting;
    nu.handsUp = !!oldCh.handsUp;
    nu.surrender = !!oldCh.surrender;

    ped.char = nu;
    ped._rigAge = (age != null && age < ADULT()) ? age : null;
    ped._rigBand = bandOf(age, ped.gender);
    ped._shadowOn = undefined;         // peds.js re-applies its shadow LOD next frame
    // weapon mounts lived on the OLD body node; charMounts is lazy and
    // idempotent, so clearing the memo lets anything that needs them rebuild.
    if (ped.phoneSprite && ped.phoneSprite.parent == null) ped.phoneSprite = null;
    // put the wardrobe back on the new geometry through the ONE dressing path
    if (CBZ.cityRedressPed) { try { CBZ.cityRedressPed(ped); } catch (e) {} }
    return true;
  }

  // ============================================================
  //  WHO IS A CHILD'S GROWN-UP — used for carrying, leashing and the
  //  "unaccompanied" test. Every source is one another module already keeps;
  //  we never store a parent link of our own.
  // ============================================================
  function liveGuardianOf(ped) {
    let best = null, bd = 1e9;
    const take = (p) => {
      if (!p || p === ped || p.dead || p._parked || !p.pos) return;
      if (isChild(p)) return;                    // another kid is not a chaperone
      const dx = p.pos.x - ped.pos.x, dz = p.pos.z - ped.pos.z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = p; }
    };
    // 1. family.js's own cast: the wife/mistress standing in this yard
    const fam = ped._fam;
    if (fam && fam.members) for (let i = 0; i < fam.members.length; i++) take(fam.members[i]);
    // 2. social.js's protected-kin stamp (the boss's kid walks with the boss)
    take(ped.protectedBy);
    // 3. social.js's kin array
    if (ped.family) for (let i = 0; i < ped.family.length; i++) take(ped.family[i]);
    // 4. the persistent family tree — the only source that still works after
    //    the body was stashed and re-dealt (every other one is a live ref).
    const T = FT();
    if (T && T.parentsOf && ped._sid && CBZ.cityLedgerLive) {
      const ps = T.parentsOf(ped._sid) || [];
      for (let i = 0; i < ps.length; i++) take(CBZ.cityLedgerLive(ps[i]));
    }
    return best;
  }

  // ---- home: where this child belongs after dark ---------------------------
  function unitById(id) {
    if (!id || !CBZ.cityHousing || !CBZ.cityHousing.units) return null;
    let units = null;
    try { units = CBZ.cityHousing.units(); } catch (e) { return null; }
    if (!units) return null;
    for (let i = 0; i < units.length; i++) if (units[i].id === id) return units[i];
    return null;
  }
  function homeSpotOf(ped) {
    const fam = ped._fam;
    if (fam && fam.houseX != null) return { x: fam.houseX, z: fam.houseZ };
    const u = ped._unit || unitById(ped._household);
    if (u) {
      if (u.door) return { x: u.door.x, z: u.door.z };
      if (u.lot) return { x: u.lot.cx, z: u.lot.cz };
    }
    const d = ped._digs && ped._digs.building && ped._digs.building.door;
    if (d) return { x: d.x, z: d.z };
    const guard = ped._kidGuard;
    if (guard && !guard.dead && guard.pos) return { x: guard.pos.x, z: guard.pos.z };
    return null;
  }

  // ---- park: where a child PLAYS. Parks are a real lot kind (lot.kind ===
  //      "park"), the same one peds.js's own routine goals already use — we
  //      just look one up per child and cache it against the arena so a world
  //      rebuild re-derives. ----
  function parkNear(x, z, maxD) {
    const A = CBZ.city && CBZ.city.arena;
    const lots = A && A.lots;
    if (!lots) return null;
    let best = null, bd = maxD * maxD;
    for (let i = 0; i < lots.length; i++) {
      const l = lots[i];
      if (!l || l.kind !== "park") continue;
      const dx = l.cx - x, dz = l.cz - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }

  // ============================================================
  //  LOCOMOTION — one shared primitive, never a new follow loop.
  //  CBZ.protection.moveToward IS this codebase's single follow step
  //  (protection.js's own header: "officials.js's original moveToward,
  //  verbatim — social.js's companion-follow tick generalized off the
  //  player; this is the one copy now"). We drive it and then pin
  //  ped.target to the body so peds.js's own move() integration doesn't
  //  fight us — exactly restrain.js's escorted-body convention.
  // ============================================================
  function walkTo(ped, x, z, speed, dt) {
    if (CBZ.protection && CBZ.protection.moveToward) {
      CBZ.protection.moveToward(ped, x, z, speed, dt);
      if (ped.target && ped.target.set) ped.target.set(ped.pos.x, 0, ped.pos.z);
      return true;
    }
    // degraded: family.js's own proven "re-issue the target and let peds.js
    // walk them" idiom. Slower to converge, never wrong.
    if (ped.target && ped.target.set) ped.target.set(x, 0, z);
    return false;
  }
  // "nudge" = the NON-controlled form: we only re-issue a walk goal when the
  // child has drifted off it, and peds.js's own brain/legs do the rest. This
  // is what school-age kids and teens get — they are people, not puppets.
  function nudgeTo(ped, x, z, slack) {
    const dx = ped.pos.x - x, dz = ped.pos.z - z;
    if (dx * dx + dz * dz > slack * slack && ped.target && ped.target.set) {
      ped.target.set(x, 0, z);
      ped.finalGoal = null;
    }
  }
  // INDOORS reuses peds.js's OWN building-interior state: move() short-circuits
  // on enterT>0, hides the rig and zeroes the speed, and the outer loop's
  // visibility line respects it. Refreshed every tick while the child should be
  // inside; stop refreshing and they walk back out on their own.
  function holdIndoors(ped) {
    ped.enterT = Math.max(ped.enterT || 0, 3);
    ped._kidInside = true;            // OUR hold — see letOutdoors
    ped.speed = 0;
    if (ped.target && ped.target.set) ped.target.set(ped.pos.x, 0, ped.pos.z);
  }
  // Only ever clear an enterT WE put there. peds.js sets enterT itself when a
  // ped legitimately walks into a shop ("entered a building: hide briefly then
  // re-emerge"), and yanking that one would teleport people out of doorways.
  function letOutdoors(ped) {
    if (ped._kidInside) { ped.enterT = 0; ped._kidInside = false; }
  }
  // Take the legs back off a body we were driving. `_kidHeld` is the marker
  // that WE set ped.controlled — social.js/restrain.js set it for their own
  // reasons and clearing theirs would free a hostage.
  function releaseHold(ped) {
    if (ped._kidHeld) { ped.controlled = false; ped._kidHeld = false; }
  }
  function takeHold(ped) { ped.controlled = true; ped._kidHeld = true; }
  function camFar2(ped) {
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam) return 1e9;
    const dx = ped.pos.x - cam.x, dz = ped.pos.z - cam.z;
    return dx * dx + dz * dz;
  }

  // ============================================================
  //  THE TICK
  // ============================================================
  const NIGHT_IN = 20;      // a child is indoors from 20:00 …
  const NIGHT_OUT = 7;      // … until 07:00
  const TEEN_IN = 23;       // teens keep their own, later hours
  const TEEN_OUT = 6;
  const GUARD_D = 14;       // a grown-up this close counts as "with" the child
  const TODDLER_LEASH = 3.5;
  const YARD_R = 7;         // how far a child roams around a home anchor
  const SNAP_D2 = 55 * 55;  // beyond this from the camera, a curfew fix may teleport

  let _acc = 0;
  let _stats = { children: 0, faked: 0, indoors: 0, carried: 0, unhoused: 0, nightOutdoors: 0, rebodies: 0 };

  function isChildBody(ped) {
    return !!(ped && !ped.dead && !ped.isPlayer && !ped._parked && ped.pos && ped.char && ped.group);
  }

  function tickChild(ped, age, band, dt) {
    // NEVER take the legs off a body that panic, combat or another system
    // already owns — a fleeing child must be allowed to flee, and a kidnap
    // victim belongs to family.js's hostage flow.
    if (ped.kidnapped || ped.inCar || ped.ko > 0 || ped.restraint ||
        ped.state === "flee" || ped.state === "fight" || (ped.alarmed || 0) > 0 ||
        ped.companion || ped.recruited) {
      // hand the body straight back — a frightened child must be free to run,
      // and a hostage belongs to family.js's kidnap flow, not to bedtime.
      releaseHold(ped);
      letOutdoors(ped);
      return;
    }

    const guard = ped._kidGuard;
    const home = ped._kidHome;
    const h = hourNow();
    const teen = band === "teen";
    const night = teen ? (h < TEEN_OUT || h >= TEEN_IN) : (h < NIGHT_OUT || h >= NIGHT_IN);
    const guarded = !!(guard && !guard.dead && guard.pos &&
      Math.hypot(guard.pos.x - ped.pos.x, guard.pos.z - ped.pos.z) < GUARD_D);

    // ---- BABIES DO NOT WALK. ------------------------------------------
    // Carried by a grown-up when there's one on their feet nearby, otherwise
    // in the home unit. `controlled` is peds.js's own sanctioned seam for
    // "another system drives this body" (peds.js:3261) — the flag restrain.js
    // and social.js already use — so its brain leaves the baby alone. This
    // tick runs at order 34.9, AFTER peds.js's 34, so the position we write
    // (including the carry HEIGHT, which move() clamps to y=0) is the one
    // that renders this frame.
    if (band === "baby") {
      takeHold(ped);
      ped.speed = 0;
      if (guarded && !guard.inCar && (guard.ko || 0) <= 0 && !night) {
        const yaw = guard.group ? guard.group.rotation.y : 0;
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        // on the hip, slightly to the carrier's left, facing where they face
        ped.pos.x = guard.pos.x + fx * 0.24 - fz * 0.30;
        ped.pos.z = guard.pos.z + fz * 0.24 + fx * 0.30;
        ped.pos.y = 0.72;
        if (ped.group) ped.group.rotation.y = yaw;
        if (ped.target && ped.target.set) ped.target.set(ped.pos.x, 0, ped.pos.z);
        // peds.js's move() derives its integration speed from ped.STATE, not
        // from ped.speed — "idle" is the state whose speed gate is a hard 0,
        // so next frame's move() can't drag a held baby toward a stale target.
        ped.state = "idle";
        letOutdoors(ped);
        if (ped.char) ped.char.sitting = false;
        _stats.carried++;
        return;
      }
      // no carrier (or after dark): the cot. Put them AT the address before
      // going invisible — a baby that vanishes mid-street is a phantom, and
      // holdIndoors() hides the rig.
      ped.pos.y = 0;
      if (!home) {
        // Degenerate: an infant with neither a grown-up nor an address. Do NOT
        // hide it (that would be the phantom) — hold it in place, visible, and
        // report it. `unhoused` in the audit is exactly this gap.
        ped.state = "idle";
        if (ped.target && ped.target.set) ped.target.set(ped.pos.x, 0, ped.pos.z);
        _stats.unhoused++;
        return;
      }
      const dh = Math.hypot(ped.pos.x - home.x, ped.pos.z - home.z);
      if (dh > 1.5) {
        if (camFar2(ped) > SNAP_D2) { ped.pos.x = home.x; ped.pos.z = home.z; }
        else { walkTo(ped, home.x, home.z, 0.6, dt); return; }
      }
      holdIndoors(ped);
      _stats.indoors++;
      return;
    }

    // ---- TODDLERS stay inside a few metres of a grown-up. --------------
    if (band === "toddler") {
      if (night || !guarded) {
        takeHold(ped);
        if (home) {
          const d = Math.hypot(ped.pos.x - home.x, ped.pos.z - home.z);
          if (d > 2.0) {
            if (night && camFar2(ped) > SNAP_D2) { ped.pos.x = home.x; ped.pos.z = home.z; }
            else { walkTo(ped, home.x, home.z, 0.85, dt); return; }
          }
          holdIndoors(ped);
          _stats.indoors++;
        } else {
          // no address at all — hold them where they stand rather than let a
          // 2-year-old wander the city. Counted, so the audit shows the gap.
          ped.speed = 0;
          ped.state = "idle";
          if (ped.target && ped.target.set) ped.target.set(ped.pos.x, 0, ped.pos.z);
          _stats.unhoused++;
          if (night) _stats.nightOutdoors++;
        }
        return;
      }
      takeHold(ped);
      letOutdoors(ped);
      const d = Math.hypot(guard.pos.x - ped.pos.x, guard.pos.z - ped.pos.z);
      if (d > TODDLER_LEASH) {
        // toddle after them — slow, and only ever toward the grown-up
        walkTo(ped, guard.pos.x, guard.pos.z, Math.min(1.15, 0.55 + d * 0.08), dt);
      } else {
        ped.speed = 0;
        ped.state = "idle";   // hard speed gate in move() — see the baby branch
        if (ped.target && ped.target.set) ped.target.set(ped.pos.x, 0, ped.pos.z);
        if (ped.group) {
          const yaw = Math.atan2(guard.pos.x - ped.pos.x, guard.pos.z - ped.pos.z);
          ped.group.rotation.y = CBZ.lerpAngle ? CBZ.lerpAngle(ped.group.rotation.y, yaw, 0.2) : yaw;
        }
      }
      return;
    }

    // ---- SCHOOL AGE + TEENS: real people with their own legs. -----------
    // We never take ped.controlled here — peds.js's brain walks them; we only
    // steer the goal, which is family.js's own long-proven idiom.
    if (night) {
      // THE HARD RULE. An unaccompanied child outdoors after dark goes home,
      // and is HELD there — this is enforcement, not a suggestion.
      if (!C.CHILD_CURFEW || (teen && guarded)) { releaseHold(ped); letOutdoors(ped); return; }
      if (!home) {
        releaseHold(ped);
        _stats.unhoused++; _stats.nightOutdoors++;
        return;                       // nowhere to send them; the audit reports it
      }
      const d = Math.hypot(ped.pos.x - home.x, ped.pos.z - home.z);
      if (d > 2.5) {
        _stats.nightOutdoors++;
        takeHold(ped);
        // far enough from the camera that nobody can see it: put them home.
        // Otherwise walk them — a child hurrying home at dusk is the READ.
        if (camFar2(ped) > SNAP_D2 && d > 12) { ped.pos.x = home.x; ped.pos.z = home.z; ped.pos.y = 0; }
        else { walkTo(ped, home.x, home.z, 1.9, dt); return; }
      }
      takeHold(ped);
      holdIndoors(ped);
      _stats.indoors++;
      return;
    }

    // DAYTIME — hand the legs back and let peds.js's own brain drive.
    releaseHold(ped);
    letOutdoors(ped);
    // Teens roam free: no steering at all beyond the curfew above.
    if (teen) return;

    // Heading home an hour before curfew reads as "called in for dinner".
    if (h >= NIGHT_IN - 1 && home) { nudgeTo(ped, home.x, home.z, 3); return; }

    // PLAY. A park if there's one within reach of the address, otherwise the
    // home yard (family.js's kids already read right doing exactly this).
    const spot = ped._kidPlay;
    if (spot) {
      // a stable per-child offset inside the park so five kids aren't stacked
      const jx = (CBZ.hash01 ? CBZ.hash01(spot.x, spot.z, (ped.slice | 0) + 7717) : 0.5) - 0.5;
      const jz = (CBZ.hash01 ? CBZ.hash01(spot.z, spot.x, (ped.slice | 0) + 3313) : 0.5) - 0.5;
      nudgeTo(ped, spot.x + jx * spot.r, spot.z + jz * spot.r, 4.5);
      return;
    }
    if (home) nudgeTo(ped, home.x + (rng() - 0.5) * YARD_R, home.z + (rng() - 0.5) * YARD_R, YARD_R * 0.8);
    else _stats.unhoused++;
  }

  // slow refresh of the per-child cached lookups (guardian / home / park).
  // Kept off the behaviour cadence because these walk other modules' lists.
  function refreshAnchors(ped) {
    ped._kidGuard = liveGuardianOf(ped);
    const home = homeSpotOf(ped);
    ped._kidHome = home;
    const A = CBZ.city && CBZ.city.arena;
    if (home && ped._kidPlayArena !== A) {
      ped._kidPlayArena = A;
      const lot = parkNear(home.x, home.z, 150);
      ped._kidPlay = lot ? { x: lot.cx, z: lot.cz, r: Math.max(3, Math.min(lot.w || 8, lot.d || 8) * 0.55) } : null;
    }
  }

  let _anchorAcc = 0;
  function sweep(dt) {
    const peds = CBZ.cityPeds;
    if (!peds || !peds.length) return;
    _anchorAcc += dt;
    const doAnchors = _anchorAcc >= 4;
    if (doAnchors) _anchorAcc = 0;
    const s = { children: 0, faked: 0, indoors: 0, carried: 0, unhoused: 0, nightOutdoors: 0, rebodies: _stats.rebodies };
    _stats = s;
    const camD2 = 30 * 30;
    for (let i = 0; i < peds.length; i++) {
      const ped = peds[i];
      if (!isChildBody(ped)) continue;
      const age = ageYears(ped);
      if (age == null) continue;                       // no birthday = adult
      if (age >= ADULT()) {
        // GREW UP. Put an adult body on them once, clean the child state off,
        // and hand them back to the ordinary city.
        if (ped.child || rigAgeOf(ped) != null) {
          if (C.CHILD_REBODY && rebody(ped, null)) _stats.rebodies++;
          ped.child = false; ped.band = "adult";
          ped.maxHp = Math.max(ped.maxHp || 0, 100); ped.hp = Math.max(ped.hp || 0, ped.maxHp);
          releaseHold(ped);
          letOutdoors(ped);
          ped._kidGuard = ped._kidHome = ped._kidPlay = null;
          if (ped.famRole === "the kid") ped.famRole = "grown";
          if (ped._role === "kid") ped._role = "grown";
          // job strings are free-form prose in this codebase (births.js casts
          // "the kid", family.js "your wife"), so retitle rather than null it —
          // schedule.js/outfits.js/the dossier all read `job` and a null there
          // is a needless new case for a purely cosmetic label.
          // Was "the kid" -> "looking for work": one shrug replaced by another, and
          // the second is worse (it is unemployment, printed as an occupation).
          // Clearing it hands the grown kid to the role caster, which gives them
          // a real job instead of a label for not having one.
          if (ped.job === "the kid" || ped.job === "looking for work") ped.job = null;
          if (CBZ.cityFeed && ped.name && ped._sid) {
            CBZ.cityFeed("" + ped.name + " isn't a kid anymore.", "#cfe6ff");
          }
        }
        continue;
      }

      s.children++;
      ped.ageYears = age;
      ped.child = true;
      const band = bandOf(age, ped.gender);
      ped.band = band;

      // ---- the audit's live measurement: a body still faking childhood with
      //      a scaled root. Dead/KO bodies are skipped because ragdoll and KO
      //      legitimately animate group.scale (character.js says so at the
      //      makeCharacter root-scale comment).
      const sc = ped.group.scale;
      if (sc && Math.abs(sc.x - 1) > 0.02) s.faked++;

      applyAgeHp(ped, age);
      // anchors refresh slowly (they walk other modules' lists) — but a child
      // we've never seen resolves its guardian/home/park on the FIRST pass, so
      // it never spends a cycle counted as "unhoused" just for being new.
      if (doAnchors || ped._kidHome === undefined) refreshAnchors(ped);

      // ---- RE-BODY on a band crossing (or once the built body has drifted a
      //      couple of years off the real age, so growth inside a band is
      //      smooth too). Deferred until the body is off-camera so the change
      //      is never a pop in front of the player; if it stays on-camera for
      //      a long time we do it anyway rather than leave a wrong body.
      if (C.CHILD_REBODY && _ageSupport !== false) {
        const builtAge = rigAgeOf(ped);
        const wrongBand = rigBandOf(ped) !== band;
        const drifted = builtAge != null && Math.abs(builtAge - age) >= 2;
        const scaled = !!(sc && Math.abs(sc.x - 1) > 0.02);
        if (wrongBand || drifted || scaled || builtAge == null) {
          ped._rebodyT = (ped._rebodyT || 0) + dt;
          const offCam = camD2 < camFar2(ped);
          if (offCam || ped._rebodyT > 90) {
            if (rebody(ped, age)) { _stats.rebodies++; ped._rebodyT = 0; }
            else ped._rebodyT = 0;   // failed (no age support / no rig): don't spin
          }
        } else ped._rebodyT = 0;
      }

      tickChild(ped, age, band, dt);
    }
  }

  CBZ.onUpdate(34.9, function (dt) {
    if (!g || g.mode !== "city") return;
    if (!on()) return;
    if (noSim()) return;             // host simulates; a guest puppets bodies
    _acc += dt;
    // rides the perf/quality slider like every other slow city sweep: tier0
    // every ~1.2s, Best every 0.4s. Childhood is measured in minutes — a
    // slower sweep costs nothing but a slightly later curfew.
    const period = CBZ.qScale ? CBZ.qScale(1.2, 0.4) : 0.5;
    if (_acc < period) return;
    const step = _acc; _acc = 0;
    try { sweep(step); } catch (e) {}
  });

  // ============================================================
  //  RATCHET — CBZ.childBodyAudit(), the CBZ.treeAudit() template.
  //  A pure counting function in a REAL game file (never a tool) returning
  //  the number of places still faking a child with group.scale. Pinned in
  //  tools/math-gate.mjs's PASS block; the number may only ever go DOWN.
  //
  //  `faked` is measured against the LIVE world rather than by grepping call
  //  sites, which makes it strictly stronger than a source count: it catches
  //  a legacy save restoring a scaled body, a future spawner that reaches for
  //  setScalar again, and any path that mints a child without a birthday.
  //  Dead/KO bodies are excluded — ragdoll and KO legitimately scale the root.
  // ============================================================
  CBZ.childBodyAudit = function () {
    const peds = CBZ.cityPeds || [];
    let children = 0, faked = 0, scaledPeople = 0, noBirthday = 0, unhoused = 0, nightOutdoors = 0;
    let wrongBody = 0;
    const T = FT();
    const h = hourNow();
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || p.isPlayer || (p.ko || 0) > 0 || !p.group || !p.group.scale) continue;
      const scaled = Math.abs(p.group.scale.x - 1) > 0.02;
      if (scaled) scaledPeople++;
      const a = ageYears(p);
      const kid = a != null && a < ADULT();
      // a body the WORLD calls a kid (job/role) but that carries no birthday
      // is the other half of the old bug — it would never grow up.
      const roleKid = p.famRole === "the kid" || p._role === "kid" || p.job === "the kid";
      if (roleKid && !kid) noBirthday++;
      if (!kid) continue;
      children++;
      if (scaled) faked++;
      if (!homeSpotOf(p)) unhoused++;
      const band = bandOf(a, p.gender);
      // A child wearing an ADULT skeleton. Distinct from `faked` (which is the
      // old scale trick) — this is the residual case: schedule.js's
      // cityPedDeal can re-attach a stashed CHILD identity to a pooled crowd
      // rig, and rebody() deliberately refuses those (their materials are
      // cloned; see its guard). Non-zero here means that path fired; the fix
      // is one line in schedule.js, reported to its owner.
      if (rigBandOf(p) !== band) wrongBody++;
      const night = band === "teen" ? (h < TEEN_OUT || h >= TEEN_IN) : (h < NIGHT_OUT || h >= NIGHT_IN);
      if (night && (p.enterT || 0) <= 0 && p.group.visible && !liveGuardianOf(p)) nightOutdoors++;
    }
    return {
      // THE PINNED NUMBER: children whose body is a scaled adult.
      faked: faked,
      // supporting reads (informational; useful when `faked` moves)
      children: children,
      wrongBody: wrongBody,
      scaledPeople: scaledPeople,
      noBirthday: noBirthday,
      unhoused: unhoused,
      nightOutdoors: nightOutdoors,
      // last sweep's placement tally (informational — where the kids ARE)
      carried: _stats.carried, indoors: _stats.indoors,
      birthdays: (T && T.bornCount) ? T.bornCount() : 0,
      ageSupport: _ageSupport,
      rebodies: _stats.rebodies,
    };
  };

  // ---- PUBLIC API ----------------------------------------------------------
  CBZ.cityChildAge = childAge;       // the one-line adoption for a kid spawner
  CBZ.cityAgeYears = ageYears;       // THE age read (null = adult / unknown)
  CBZ.cityIsChild = isChild;
  CBZ.cityAgeBand = ageBand;
  CBZ.cityRebodyPed = rebody;        // the shared rig swap (see its header)
  CBZ.cityChildGuardian = liveGuardianOf;

  // mode.js's fresh-run guard-call convention (cityFamilyTreeReset /
  // cityBirthsReset / cityFamilyReset sit right beside this).
  CBZ.cityChildhoodReset = function () {
    _acc = 0; _anchorAcc = 0; _ageSupport = null;
    _stats = { children: 0, faked: 0, indoors: 0, carried: 0, unhoused: 0, nightOutdoors: 0, rebodies: 0 };
  };
})();
