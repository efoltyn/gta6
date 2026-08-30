/* THE MOUTH IS A MOUTH — Shark Sim's bite, photographed against itself.

   Owner, 2026-08-29, playing the shark game:

     "the cuts can literally be bigger than the fucking animal ... floating
      cuts ... biting, legit things don't go into the mouth, the bite happens
      when a thing is a foot ahead of the mouth."

   Two defects, one root: NOTHING IN THE BITE WAS MEASURED AGAINST A BODY.

     • CONTACT was a sphere. city/wildlife_tame.js asked one function,
       biteReach(), both "what am I hunting" and "did my teeth arrive", and it
       answered with `Math.max(3.0, scale * 2.5)` metres tested against the
       target's BOUNDING BOX. A great white therefore billed a kill with the
       fish's nose two metres clear of its teeth, and a grown megalodon killed
       things six metres out. Nothing was ever eaten on screen.

     • THE CUT was sized off that same acquisition range: the mounted bite
       passed `jaw: biteReach(a) * 0.32` to systems/wounds.js (and 0.38 of it
       again on every half-turn of the death roll), i.e. at least 0.96 m of
       wound RADIUS whatever it had bitten, while wounds.js's own clamp is an
       absolute 3.5 m with nothing in it about the victim. A gash longer than
       the dolphin wearing it is not a tuning error; a wound is a hole IN
       something, so the something has to bound it.

   The fix is in three owners and no new system:
     creature_combat.js  biteJawRadius(attacker, style, VICTIM) — one owner for
                         "how wide is this mouth", now bounded by the thinnest
                         dimension of the body it closed on, measured off the
                         built model. The sever gate still asks the unbounded
                         mouth, because what a mouth can close around is a fact
                         about the mouth.
     wildlife_tame.js    contact split from acquisition (the hunt is unchanged;
                         the teeth are honest), every wound sized by that one
                         owner, and THE ENGULF: a snack-sized meal is drawn
                         onto the tooth line and sunk past it while the jaws
                         close, so the bite happens ON a body.
     marine_predation / predator.js — the wild bites' own wound radii bounded
                         through the same call.

   BOTH COLUMNS ARE THE REAL GAME. index.html?mode=sharksim, the same seed, the
   same island, the same staging code, the same production trigger; BEFORE is
   pristine HEAD served on its own port, AFTER is this checkout. Every number
   below is taken by THIS file out of the live scene graph, so one ruler
   measures both sides. */

const subjects = [
  {
    id: "the-strike", ch: 0, strip: { frames: 4, stepSec: 0.10 },
    label: "The Strike — The Frame The Kill Is Billed On",
    focus: "The exact frame the game says a mouthful landed, then three more across the following third of a second, camera locked to the shark's own jaw. BEFORE: the mackerel is a body-length clear of the teeth and is billed as eaten anyway — nothing has touched it. AFTER: the opening gape has taken it IN, and the bite happens on a body. (The fish is given hit points it cannot lose, so both columns photograph the geometry rather than a death cloud.)",
    state: "THE BILL · JAW-LOCKED CAMERA", metric: "Gap from the teeth to the meal at the frame the bite bills",
  },
  {
    id: "jaws-shut", ch: 1,
    label: "Jaws Shut — Is There Anything In The Mouth?",
    focus: "The same strike carried on to the shut of the jaws, from in front of the head. This is the owner's sentence as a photograph: BEFORE the mouth closes on open water with the meal three metres away and already billed as eaten; AFTER the mouth closes on the fish.",
    state: "JAWS CLOSED", metric: "Metres between the tooth ring and the nearest surface of the meal",
  },
  {
    id: "the-cut", ch: 2,
    label: "The Cut — A Bite Is A Hole In A Body, Not A Plank On One",
    focus: "An orca held broadside while the player's shark takes material out of its flank, same camera and distance on both sides. The BEFORE side here is CURRENT main, which already fixed the wound's SHAPE (the rake wave) — so what is left to see on this body is the last of the size: the radius handed to systems/wounds.js was the attacker's ACQUISITION RANGE, and it is now the mouth. An orca is thicker than any shark's gape, so this is the mildest case the change has; the mackerel pages carry the number for a body the bound actually binds on.",
    state: "WOUND · BROADSIDE", metric: "Widest wound ÷ the victim's own length",
  },
  {
    id: "the-whole-animal", ch: 2, wide: true,
    label: "The Same Orca, Whole — Is The Cut Bigger Than The Animal?",
    focus: "The identical body five seconds later, framed end to end so the question can be answered by looking. This is the owner's sentence: BEFORE the bite has left a slab of dark red boxes standing off the flank on a scale you can read from across the sea. AFTER there is a bite out of an orca.",
    state: "WHOLE BODY · +5 s", metric: "The wound, against ten metres of animal",
  },
];

async function stageBiteRealism(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__biteReal;
  if (!D) {
    D = window.__biteReal = {
      chapter: -1, waterline: 0, _rafOrig: null, holdFn: null, camFn: null, live: null,
      step(n) {
        for (let i = 0; i < n; i++) {
          CBZ.stepSim(1 / 30);
          if (D.holdFn) { try { D.holdFn(); } catch (e) {} }
          if (D.watchFn) { try { D.watchFn(); } catch (e) {} }
        }
      },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },
      async killFrames() {
        const orig = D._rafOrig || window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
      },
      async boot() {
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let t = 0; t < 60 && !D.armed(); t++) { D.step(15); await sleep(20); }
        if (!D.armed()) return false;
        D.waterline = CBZ.sharkSim.waterline;
        D._rafOrig = window.requestAnimationFrame;
        await D.killFrames();
        // let the mode's opening banner run out on BOTH sides before any beat
        // is photographed: it is not what is under test and it covers the frame
        D.sec(6);
        await sleep(900);
        return true;
      },
      seed() {
        let s = 20260829;
        Math.random = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      },
      ringPoint(ang, r) {
        const A = CBZ.surv.arena;
        return { x: A.center.x + Math.cos(ang) * r, z: A.center.z + Math.sin(ang) * r };
      },
      playerAngle() {
        const A = CBZ.surv.arena, P = CBZ.player;
        return Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
      },
      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -0.8; },
      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
      },
      /* Deep water, well off the shelf, so nothing in these experiments is
         standing on a seabed or wading through surf — and always the SAME
         deep water. Taking the bearing off the live player (which is what the
         presets this one grew out of do) put the two columns in different
         parts of the ocean the moment their play diverged: different depth,
         different surface, different light, and a pair of photographs that
         cannot be compared. A fixed bearing on a seeded island is the same
         place on both sides, every run. */
      offshore(extra) {
        const S = CBZ.sharkSim.shark, P = CBZ.player;
        const p = D.ringPoint(0.9, D.waterline + (extra == null ? 60 : extra));
        S.pos.x = p.x; S.pos.z = p.z;
        if (S._waterMove) { S._waterMove.x = p.x; S._waterMove.z = p.z; }
        P.pos.x = p.x; P.pos.z = p.z;
        D.step(3);
      },
      /* EMPTY THE SEA. Every beat here is a two-body experiment and marine
         predation will happily send an orca across the frame mid-capture. */
      clearSea() {
        const S = CBZ.sharkSim.shark;
        for (const a of CBZ.cityWildlife || []) {
          if (!a || a.dead || !a.species || a === S) continue;
          if (!a.species.aquatic) continue;
          a.pos.x += 3000; a.hunger = 0;
          if (a._mp) { a._mp.target = null; a._mp.kind = 0; }
          if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
          if (a.group) a.group.position.x = a.pos.x;
        }
        if (CBZ.sharkSim) CBZ.sharkSim.podT = 400;
      },
      /* SEEDED AT THE SPAWN, not once at boot. Individuals in this game roll
         their own size, the two builds consume the random stream at different
         rates the moment they start behaving differently, and a comparison in
         which one column bit a 2.7 m fish and the other a 4.2 m one is not a
         comparison. Re-seeding immediately before every spawn makes the BODY
         under test identical even though the sim around it has diverged. */
      spawn(id, x, z) {
        if (!CBZ.cityWildlifeSpawnAt) return null;
        D.seed();
        const a = CBZ.cityWildlifeSpawnAt(id, x, z);
        if (a) {
          a.dead = false; a.grow = null; a.hunger = 0;
          if (a.group) a.group.visible = true;
          /* AND PIN THE DRAW ITSELF. Seeding the stream is not enough — the
             two builds reach the spawn having consumed different numbers of
             randoms — so the individual multiplier is set to 1 and the growth
             ledger emptied through the game's own staging entry point. Both
             columns then bite a body of exactly the species' own size. */
          a._sizeMul = 1;
          if (CBZ.wildlifeSetEatenMass) { try { CBZ.wildlifeSetEatenMass(a, 0); } catch (e) {} }
        }
        return a;
      },
      lenOf(a) { return (CBZ.marineBodyLen ? CBZ.marineBodyLen(a) : 6) || 6; },
      /* THE PLAYER'S OWN BODY IS A VARIABLE TOO. This shark grows by eating,
         and the two columns do not eat at the same moments — so its ledger is
         emptied at the top of every beat. Both columns then bite with the same
         mouth, which is the thing every number here is about. */
      pinBody(a) {
        if (!a) return;
        a._sizeMul = 1;
        if (CBZ.wildlifeSetEatenMass) { try { CBZ.wildlifeSetEatenMass(a, 0); } catch (e) {} }
      },
      jawWorld(a) {
        const jp = (CBZ.creatureJawPoint && CBZ.creatureJawPoint(a)) || { x: 2.1, y: 0.7, z: 0 };
        a.group.updateMatrixWorld(true);
        return new T.Vector3(jp.x, jp.y, jp.z).applyMatrix4(a.group.matrixWorld);
      },
      /* THE ONE RULER. How far the meal's own nearest surface is from the
         tooth ring, in metres — the exact quantity the owner described as "a
         foot ahead of the mouth", measured the way the game's own contact
         test measures it (a clamp onto the target's box). */
      gap(att, prey) {
        if (!att || !prey || !prey.group || !prey.group.parent) return null;
        const mouth = D.jawWorld(att);
        prey.group.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(prey.group);
        const p = box.clampPoint(mouth, new T.Vector3());
        return +p.distanceTo(mouth).toFixed(2);
      },
      chunks() { return (CBZ.creatureBiteChunkAudit && CBZ.creatureBiteChunkAudit()) || { chunks: 0, widestWound: 0 }; },
      /* HOW BIG IS THE CUT, MEASURED ON THE BODY WEARING IT — and measured
         without asking either build what a wound is. Every mesh under the
         victim is listed before the bite; afterwards, anything NEW under it is
         something the bite put there, and the widest of those in world metres
         is the cut. It is build-agnostic (so a rewrite of systems/wounds.js
         cannot make this metric lie), it is per-victim (the global audit
         counts the wounds the ORCA put in YOU, which is not what this claim is
         about), and it is the same rule on both sides. */
      snapMeshes(a) {
        const out = [];
        if (a && a.group) a.group.traverse(function (o) { if (o.isMesh) out.push(o); });
        return out;
      },
      newWound(a, snap) {
        if (!a || !a.group) return 0;
        const had = new Set(snap);
        a.group.updateMatrixWorld(true);
        let w = 0;
        const box = new T.Box3(), sz = new T.Vector3();
        a.group.traverse(function (o) {
          if (!o.isMesh || had.has(o)) return;
          try {
            box.setFromObject(o); box.getSize(sz);
            const m = Math.max(sz.x, Math.max(sz.y, sz.z));
            if (isFinite(m) && m > w) w = m;
          } catch (e) {}
        });
        return +w.toFixed(2);
      },
      /* THE WOUND THE BUILD WOULD STAMP ON THIS BODY, asked of the game's own
         owner (creature_combat's biteJawRadius, exported as creatureJawRadius)
         rather than re-derived here — so the metric cannot drift from what the
         code actually passes to systems/wounds.js. The pristine build ignores
         the third argument, which is precisely the defect. */
      /* THE APEX MOUTH, USED AS A RULER. The bound only bites hard when the
         mouth is much bigger than the body — which is the endgame of this mode
         and the state the owner was playing in. Climbing the ladder for a
         photograph costs three staged meals and can end the match; asking the
         production owner what a MEGALODON's bite would stamp on the fish in
         front of us costs one spawn and one call, and it is the same function
         the bite itself calls. The animal is measured, then banished. */
      megMark(prey) {
        const S = CBZ.sharkSim.shark;
        let m = null;
        try { m = D.spawn("megalodon", S.pos.x + 420, S.pos.z + 420); } catch (e) {}
        if (!m) return null;
        const w = D.markWidth(m, prey);
        m.pos.x += 4000; m.hunger = 0;
        if (m._waterMove) { m._waterMove.x = m.pos.x; m._waterMove.z = m.pos.z; }
        if (m.group) m.group.position.x = m.pos.x;
        if (m._mp) { m._mp.target = null; m._mp.kind = 0; }
        return w;
      },
      markWidth(att, victim) {
        if (typeof CBZ.creatureJawRadius !== "function") return null;
        try { return +(CBZ.creatureJawRadius(att, "lunge", victim) * 2).toFixed(2); } catch (e) { return null; }
      },
      audit() { return (CBZ.aquaticMountAudit && CBZ.aquaticMountAudit()) || {}; },
      /* Park the meal at a fixed standoff ahead of the teeth and hold it
         there — identically on both sides — until the strike is committed.
         From the first frame of the swing NOTHING here touches it again: what
         moves it after that is the build under test, which is the whole
         question. */
      pinAhead(prey, att, ahead) {
        const h = att.heading || 0;
        const mouth = D.jawWorld(att);
        const x = mouth.x + Math.cos(h) * ahead, z = mouth.z + Math.sin(h) * ahead;
        prey.pos.x = x; prey.pos.z = z; prey.pos.y = mouth.y;
        if (prey.group) prey.group.position.set(x, mouth.y, z);
        if (prey._waterMove) { prey._waterMove.x = x; prey._waterMove.z = z; }
        prey.heading = prey.faceH = h;
        if (CBZ.faceAnimalHeading) { try { CBZ.faceAnimalHeading(prey, h); } catch (e) {} }
      },
    };

    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        if (D.camFn) { try { D.camFn(); } catch (e) {} }
        if (!CBZ.renderer) return;
        const raf = D._rafOrig;
        if (raf) {
          await new Promise((res) => raf.call(window, () => {
            CBZ.renderer.render(CBZ.scene, CBZ.camera);
            res();
          }));
        } else CBZ.renderer.render(CBZ.scene, CBZ.camera);
        await new Promise((r) => setTimeout(r, 900));
      },
      metrics() {
        const L = D.live;
        if (!L) return null;
        const out = {};
        if (L.claimGap && L.gapAtBill != null) out.contactGapM = L.gapAtBill;
        if (L.claimGap && L.gapAtShut != null) out.gapAtShutM = L.gapAtShut;
        if (L.preyLen != null) out.preyLenM = +L.preyLen.toFixed(1);
        if (L.wound != null) {
          out.widestWoundM = L.wound;
          if (L.preyLen > 0) out.woundOverBody = +(L.wound / L.preyLen).toFixed(2);
        }
        if (L.mark != null) {
          out.markWidthM = L.mark;
          if (L.preyLen > 0) out.markOverBody = +(L.mark / L.preyLen).toFixed(2);
        }
        if (L.megMark != null) {
          out.apexMarkM = L.megMark;
          if (L.preyLen > 0) out.apexMarkOverBody = +(L.megMark / L.preyLen).toFixed(2);
        }
        return out;
      },
      advance(sec) { D.step(Math.max(1, Math.round(sec * 30))); },
    };
  }

  const out = {};

  /* Stand up one strike: the player's shark alone in deep water with one fish
     pinned ahead of its teeth, the production trigger pulled, and the swing
     followed frame by frame until the game bills the bite. */
  function standStrike(preyId, ahead) {
    D.offshore(60);
    D.clearSea();
    const S = CBZ.sharkSim.shark;
    S.hp = S.maxHp; S.dead = false;
    D.pinBody(S);
    const h = S.heading || 0;
    const mouth = D.jawWorld(S);
    const prey = D.spawn(preyId, mouth.x + Math.cos(h) * ahead, mouth.z + Math.sin(h) * ahead);
    if (!prey) throw new Error("no " + preyId + " to bite");
    /* THE MEAL SURVIVES THE MOUTHFUL, and that is what makes this a clean
       experiment rather than a photograph of weather. A killed fish fires
       gore.js's death cloud and the strike is then photographed through a
       four-metre ball of blood on both sides — which is the game's own effect,
       not the thing under test, and it hides the one detail the frame exists
       for. Given hit points it cannot lose, the fish is still bitten (the bite
       bills, the audit counts it) and is still there to be looked at. */
    prey.hp = (prey.maxHp || (prey.species && prey.species.hp) || 40) * 60;
    prey.maxHp = prey.hp;
    D.holdFn = function () { D.pinAhead(prey, S, ahead); };
    D.holdFn();
    D.step(2);
    D.live = {
      prey: prey, preyLen: D.lenOf(prey), gapAtBill: null, mealMoved: null, wound: null,
      claimGap: true, start: { x: prey.pos.x, y: prey.pos.y, z: prey.pos.z },
      /* AND WHAT WOULD THIS BUILD CUT INTO THAT? Asked of the game's own owner
         about the body actually in front of the mouth. It is the number the
         orca cannot show — an orca is thicker than any shark's gape, so the
         bound never binds on one — and a 1.3 m mackerel is exactly the body it
         exists for. */
      mark: D.markWidth(CBZ.sharkSim.shark, prey),
      megMark: D.megMark(prey),
    };
    return prey;
  }

  /* THE BILL IS THE BEAT. Not "0.4 s in" — the frame on which the game's own
     audit says a mouthful landed, so both columns photograph the same EVENT
     even though one of them reaches it differently. */
  function runToBill(prey, maxFrames) {
    const S = CBZ.sharkSim.shark;
    const hits0 = D.audit().hits | 0;
    let fired = false, frames = 0;
    for (let i = 0; i < (maxFrames || 150); i++) {
      if (!fired) {
        if (CBZ.cityMountedAnimalAttack) CBZ.cityMountedAnimalAttack(true);
        if ((D.audit().attacks | 0) > (D.live.attacks0 | 0)) fired = true;
      }
      D.step(1); frames++;
      const A = D.audit();
      /* LET GO AT THE SAME INSTANT ON BOTH SIDES, and let go LATE. Released on
         the first frame of the swing, a tuna simply outswims the strike (it
         did: 88 m in five seconds, and the pristine build never got to bill
         the bite this preset exists to photograph). The meal is therefore held
         until the swing is committed — a fraction of the bite's own progress,
         which both builds share — and from that frame nothing here touches it.
         0.24 is one frame before the mouth is allowed to take anything in. */
      if (fired && D.holdFn && A.attackProgress >= 0.24) D.holdFn = null;
      if ((A.hits | 0) > hits0) break;
      if (fired && !A.attacking && frames > 6) break;      // the swing ended
    }
    D.live.gapAtBill = D.gap(S, prey);
    const st = D.live.start;
    D.live.mealMoved = prey.group && prey.group.parent
      ? +Math.hypot(prey.pos.x - st.x, prey.pos.z - st.z).toFixed(2) : null;
    D.live.frames = frames;
    return frames;
  }

  /* AND THEN LET THE MOUTH CLOSE. The frame the bite BILLS on is the honest
     place to measure contact, but it is a poor photograph: the jaws are still
     wide at 38% of the swing. Both columns therefore run on to the same point
     in the same shared clock — the shut — before the shutter, so the picture
     asks the only question that matters: when this mouth closed, was anything
     in it? */
  function runToShut(prey) {
    for (let i = 0; i < 90; i++) {
      const A = D.audit();
      if (!A.attacking || A.attackProgress >= 0.80) break;
      D.step(1);
    }
    D.live.gapAtShut = D.gap(CBZ.sharkSim.shark, prey);
  }

  /* ONE ORCA EXPERIMENT, PHOTOGRAPHED TWICE. The orca is given enough health
     to SURVIVE wearing its wound — a corpse is a different question — pinned
     broadside so the mark cannot swim out of frame, bitten by the production
     mouth, and then left alone for five seconds while the blood thins. Two
     cameras come out of it: the flank, and the whole animal. */
  async function orcaBite() {
    const S = CBZ.sharkSim.shark;
    D.offshore(60);
    D.clearSea();
    S.hp = S.maxHp; S.dead = false;
    D.pinBody(S);
    const h = S.heading || 0, mouth = D.jawWorld(S);
    const orca = D.spawn("orca", mouth.x + Math.cos(h) * 8, mouth.z + Math.sin(h) * 8);
    if (!orca) throw new Error("no orca to bite");
    orca.hp = (orca.maxHp || 400) * 6; orca.maxHp = orca.hp;   // it has to SURVIVE to wear the wound
    const snap = D.snapMeshes(orca);
    D.live = {
      prey: orca, preyLen: D.lenOf(orca), gapAtBill: null, mealMoved: null, wound: null,
      start: { x: orca.pos.x, y: orca.pos.y, z: orca.pos.z }, attacks0: D.audit().attacks | 0,
      mark: D.markWidth(S, orca),
    };
    /* PIN THE ORCA BROADSIDE and hold the player on its flank: the wound has
       to land where a camera can see it, and an orca free to turn drags the
       experiment out of frame. The shark is floored at 1 hp rather than allowed
       to die, because a death here ends the match and every later subject. */
    const A = { x: orca.pos.x, y: orca.pos.y, z: orca.pos.z };
    const R = D.lenOf(orca) * 0.26 + D.lenOf(S) * 0.10;
    D.holdFn = function () {
      if (S.hp <= 1) { S.hp = 1; S.dead = false; }
      orca.pos.x = A.x; orca.pos.z = A.z; orca.pos.y = A.y;
      if (orca.group) orca.group.position.set(A.x, A.y, A.z);
      if (orca._waterMove) { orca._waterMove.x = A.x; orca._waterMove.z = A.z; }
      orca.heading = orca.faceH = 0;
      if (CBZ.faceAnimalHeading) { try { CBZ.faceAnimalHeading(orca, 0); } catch (e) {} }
      const px = A.x, pz = A.z + R;
      S.pos.x = px; S.pos.z = pz; S.pos.y = A.y;
      if (S.group) S.group.position.set(px, S.group.position.y, pz);
      if (S._waterMove) { S._waterMove.x = px; S._waterMove.z = pz; }
      CBZ.player.pos.x = px; CBZ.player.pos.z = pz;
      if (CBZ.cityMountedHeading) CBZ.cityMountedHeading(Math.atan2(A.z - pz, A.x - px));
    };
    D.holdFn();
    D.step(4);
    // bite it until material actually comes off the flank
    for (let k = 0; k < 10 && D.newWound(orca, snap) <= 0; k++) {
      if (CBZ.cityMountedAnimalAttack) CBZ.cityMountedAnimalAttack(true);
      D.step(40);
    }
    D.sec(0.4);
    D.live.wound = D.newWound(orca, snap);
    D.live.preyLen = D.lenOf(orca);
    const len = D.lenOf(orca);
    /* GET THE ATTACKER OUT OF THE PICTURE, AND LET THE WATER CLEAR. The claim
       is the mark on the body: a shark parked between the lens and the flank
       photographs as a shark, and a bite's blood cloud photographs as a cloud.
       The orca stays pinned (its wound must not swim out of frame), the shark
       is put a body-length astern, and five seconds are run off so gore.js's
       own plume thins — five seconds on BOTH sides, off the same clock. */
    D.holdFn = function () {
      orca.pos.x = A.x; orca.pos.z = A.z; orca.pos.y = A.y;
      if (orca.group) orca.group.position.set(A.x, A.y, A.z);
      if (orca._waterMove) { orca._waterMove.x = A.x; orca._waterMove.z = A.z; }
      orca.heading = orca.faceH = 0;
      if (CBZ.faceAnimalHeading) { try { CBZ.faceAnimalHeading(orca, 0); } catch (e) {} }
    };
    const away = A.z + R + len * 1.4;
    S.pos.z = away;
    if (S.group) S.group.position.z = away;
    if (S._waterMove) S._waterMove.z = away;
    CBZ.player.pos.z = away;
    D.sec(4);
    /* AND TAKE THE BODY OUT OF ITS OWN BLOOD. A bitten animal trails chum for
       twelve seconds and the wound is inside that cloud, so a close shot of it
       photographs as a red screen — caught in this preset's own first captures,
       on both sides. Dropping the (still pinned) orca into clear water below
       the plume leaves the cloud where the bite happened and puts the camera
       under the surface with it, which also gets the frame out from behind the
       water veil that fades a submerged body seen from above. Both columns,
       same numbers, same clock. */
    A.x += 70; A.z += 24;
    A.y = D.seaY(A.x, A.z) - 12;
    D.step(3);
    D.live.wound = Math.max(D.live.wound, D.newWound(orca, snap));
    /* TWO SHOTS OF ONE EXPERIMENT: the flank close enough to read the wound as
       a shape, and the whole animal, which is the frame the owner's sentence
       is actually about — is the cut bigger than the thing it is cut into? */
    D.camClose = function () {
      D.tripod(A.x - len * 0.05, A.y + len * 0.07, A.z + len * 0.32, A.x, A.y, A.z);
    };
    D.camWide = function () {
      D.tripod(A.x + len * 0.06, A.y + len * 0.12, A.z + len * 0.92, A.x, A.y - 0.2, A.z);
    };
    D.camFn = D.camClose;
    D.camFn();
    out.preyLenM = +len.toFixed(1);
    out.markWidthM = D.live.mark;
    out.yourSpecies = S.species && S.species.id;
  }

  const CH = [
    /* 0 — THE STRIKE. One mackerel, pinned a body-length off the teeth (which
       is exactly where the old three-metre contact sphere was happy to kill
       it), and a camera locked to the shark's own jaw so the meal's position
       relative to the MOUTH is the only thing the frame is about. */
    async function strike() {
      if (!await D.boot()) throw new Error("no match / sim never armed");
      D.live = null;
      const S = CBZ.sharkSim.shark;
      const prey = standStrike("fish", 1.9);
      D.live.attacks0 = D.audit().attacks | 0;
      D.camFn = function () {
        const a = CBZ.sharkSim.shark, m = D.jawWorld(a), h = a.heading || 0;
        // beside the head, level with the teeth, looking across the gape
        D.tripod(m.x - Math.sin(h) * 3.8 - Math.cos(h) * 0.4, m.y + 0.7, m.z + Math.cos(h) * 3.8 - Math.sin(h) * 0.4,
                 m.x + Math.cos(h) * 0.8, m.y - 0.1, m.z + Math.sin(h) * 0.8);
      };
      runToBill(prey, 150);
      D.camFn();
      out.framesToBill = D.live.frames;
      out.preyLenM = +D.live.preyLen.toFixed(1);
      out.yourLenM = +D.lenOf(S).toFixed(1);
      out.yourSpecies = S.species && S.species.id;
    },

    /* 1 — THE SAME EVENT, FROM IN FRONT OF THE HEAD, at the frame the bite
       bills. A second strike rather than a second camera on the first, because
       the first has already been advanced by its own film strip. */
    async function billed() {
      const S = CBZ.sharkSim.shark;
      const prey = standStrike("fish", 1.9);
      D.live.attacks0 = D.audit().attacks | 0;
      D.camFn = function () {
        const a = CBZ.sharkSim.shark, m = D.jawWorld(a), h = a.heading || 0;
        /* WIDE ENOUGH TO HOLD THE ESCAPE. The meal survives this bite, so on
           the pristine side it is still swimming when the jaws shut — eight
           metres out and going — and a frame tight on the head would say only
           "empty mouth" without showing where the thing it just ate went. */
        D.tripod(m.x + Math.cos(h) * 4.6 - Math.sin(h) * 4.4, m.y + 2.1, m.z + Math.sin(h) * 4.6 + Math.cos(h) * 4.4,
                 m.x + Math.cos(h) * 2.6, m.y - 0.35, m.z + Math.sin(h) * 2.6);
      };
      runToBill(prey, 150);
      runToShut(prey);
      D.camFn();
      out.framesToBill = D.live.frames;
    },

    /* 2 — THE CUT ON A BODY. The mounted bite only takes material off an
       animal its own size or bigger (wildlife_tame's aboveWeight), so this is
       an orca and the cutting is systems/wounds.js's creatureBiteChunk. BEFORE
       the radius handed to it was `biteReach(a) * 0.32` — the attacker's own
       ACQUISITION RANGE, three metres of it minimum, whatever it had bitten.
       AFTER it is the mouth, bounded by the flank it is cut into. */
    async function cut() { await orcaBite(); },

  ];

  const want = sub.ch | 0;
  for (let c = D.chapter + 1; c <= want; c++) { await CH[c](); D.chapter = c; }
  // two subjects may share one chapter: the experiment is staged once and
  // photographed twice, which is the only way two frames are of the same thing
  if (sub.wide && D.camWide) D.camFn = D.camWide;
  else if (D.camClose && sub.ch === 2) D.camFn = D.camClose;
  if (D.camFn) D.camFn();

  out.ok = true;
  out.metrics = window.__cbzVisualCompare.metrics() || {};
  return out;
}

export default {
  id: "shark-bite-realism",
  title: "The Mouth Is A Mouth — Contact At The Teeth, Wounds The Size Of A Bite",
  description: "Four beats of one Shark Sim match, photographed on current main and on this checkout with identical staging. Main billed a kill with the meal metres clear of the teeth — nothing was ever eaten on screen — and sized every wound off the attacker's ACQUISITION RANGE rather than off its mouth or the body it bit. Contact is now the tooth ring, the mouth takes the meal in, and no wound can be wider than the animal wearing it.",
  beforeLabel: "BEFORE · main (3 m contact sphere · wound = reach × 0.32)",
  afterLabel: "AFTER · contact at the teeth · the meal goes in · wound = the mouth",
  pairNote: "Same seed · same island · same species · same standoff · same production trigger · same staging code",
  method: "The BEFORE column is current main served on its own port; the AFTER column is this checkout. Both boot index.html?mode=sharksim on the same seed, click the tile and PLAY like a player, then freeze the page's frame loop and advance the real match with CBZ.stepSim. The sea is emptied to the bodies under test; one fish is pinned at a fixed standoff ahead of the shark's own jaw point and released the instant the swing commits, so what moves it after that is the build. Every beat stops on the frame the game's own audit says a mouthful landed — an event, not a number of seconds — and the measurements are read out of the live scene graph by this file on both sides.",
  urlParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 480000,
  viewport: { width: 1280, height: 760 },
  metricsWhitelist: true,
  metrics: {
    contactGapM: { label: "Gap from the tooth ring to the meal when the bite bills", unit: "m", better: "lower" },
    gapAtShutM: { label: "..and when the jaws have closed", unit: "m", better: "lower" },
    widestWoundM: { label: "Widest wound left on the body", unit: "m", better: "lower" },
    woundOverBody: { label: "That wound as a fraction of the victim's own length", better: "lower" },
    markWidthM: { label: "Width of the wound this build stamps on that body", unit: "m", better: "lower" },
    apexMarkM: { label: "..and the wound a MEGALODON's bite would stamp on it", unit: "m", better: "lower" },
    apexMarkOverBody: { label: "That apex wound as a fraction of the fish's own length", better: "lower" },
    markOverBody: { label: "That mark as a fraction of the victim's own length", better: "lower" },
    preyLenM: { label: "The victim's length", unit: "m", better: "lower" },
  },
  metricsNote: "apexMarkOverBody is the other half of the report as one number: above 1.0 the wound a megalodon's bite stamps is LONGER THAN THE FISH IT IS CUT INTO, and a mouth at the top of this mode's own ladder is exactly what the owner was playing. It is asked of the production owner (creature_combat's biteJawRadius) about the body actually in front of the mouth, never re-derived here. contactGapM is the owner's sentence as a number: it is how far the meal's nearest surface is from the teeth at the exact frame the game bills the kill. woundOverBody above 1.0 means the cut was literally longer than the animal it was cut into. preyLenM is reported so the two sides can be seen to be biting the same fish; it is not an improvement.",
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityWildlifeSpawnAt && CBZ.cityMountedAnimal && CBZ.creatureJawPoint && CBZ.creatureBiteChunkAudit && CBZ.aquaticMountAudit && document.getElementById('playBtn')",
  subjects,
  stage: stageBiteRealism,
};
