/* SHARK SIM / THE SEA — THE BODY IS THE PROGRESS BAR. A same-checkout flag A/B.

   Both columns boot the SAME build of index.html?mode=sharksim on the disaster
   island with the same pinned seed. The ONLY difference is the query string:
   the BEFORE column sets cfg_MASS_ECONOMY=0 and cfg_WILD_GROWTH=0 and
   therefore runs the pre-wave code path, in which an animal's size is fixed at
   spawn for the whole of its life. Nothing is posed in a studio; every capture
   is the live game's own screen, advanced with CBZ.stepSim so the storyboard
   cannot depend on how fast this machine rasterises.

   THE BRIEF IT ANSWERS (owner, 2026-08-25):
     "each time the shark eats something it should get bigger ... getting
      bigger is a huge thing, like some megalodons should be bigger than
      others, ALL animals in the game, and it's based on how much they eat —
      eat a big shark you grow more vs eating a little fish"

   TWO OF THE FOUR BEATS DO NOT STAGE A NUMBER AT ALL. `pod-grown` kills real
   prey through CBZ.marineHurt and lets the engine's own kill path credit the
   pod, so what it photographs is the WIRING (hurt -> cityWildlifeHit ->
   killAnimal -> mealFrom -> the ledger), not the curve in isolation; and
   `ridden-grown` grows the body the player is sitting on and then measures
   whether the saddle and the camera boom followed it.

     node tools/visual-compare.mjs --preset shark-growth --before local
*/

const subjects = [
  {
    id: "meal-size",
    label: "Eat A Little Fish · Eat A Big Shark",
    focus: "Two great whites of IDENTICAL spawn size, side by side, same second. The near one has eaten a single mackerel; the far one has eaten one orca. BEFORE: the ledger does not exist, so both are exactly the species constant and the sea has one great white in it forty times over. AFTER: the same curve paid the mackerel 2.3% and the orca 22%, because the curve saturates — which is what makes hunting something big WORTH more than grazing the same tonnage in mouthfuls.",
  },
  {
    id: "megalodons-differ",
    label: "Some Megalodons Are Bigger Than Others",
    focus: "The owner's line, photographed literally. Two megalodons on the same tripod: one that has eaten nothing this life and one that has eaten sixty mass of it. BEFORE: one megalodon, twice — the species constant is the whole answer and the second animal is a copy. AFTER: the same species, two bodies, and the difference between them is a thing that HAPPENED rather than a thing that was rolled.",
  },
  {
    id: "pod-grown",
    label: "A Pod That Hunted Well, Over One Match",
    focus: "END TO END, NOT STAGED. A wild orca pod is given real prey and the prey is killed through CBZ.marineHurt — the sea's own damage sink — so the credit has to travel the engine's real path (hurt -> cityWildlifeHit -> killAnimal -> mealFrom -> the ledger) to reach the bodies. BEFORE: five identical orcas at the end of the match they just won. AFTER: the ones that fed are visibly the big ones, and the pod has a shape.",
  },
  {
    id: "ridden-grown",
    label: "It Grew While You Were Sitting On It",
    focus: "The half of growth that is engineering rather than art. The ridden shark is fed mid-match and the camera and saddle are then MEASURED. Every cached size in the ride — the socket animalSaddle measured off the old body's bounding boxes, the camera boom sized to the hull, the seat height, the turn rate — had to become a scale-reader or be invalidated, or a shark that doubles under its rider swallows its own camera and floats the rider off the back. The metrics under this pair are the proof; the picture is that nothing is wrong with it.",
  },
];

async function stageSharkGrowth(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  Math.random = (function (s) { return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })(20260825);

  let D = window.__sharkGrow;
  if (!D) {
    D = window.__sharkGrow = {
      track: null,
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },
      keys(o) {
        const k = CBZ.keys; if (!k) return;
        k.w = k.a = k.s = k.d = k.shift = k.control = k.c = false; k[" "] = false;
        for (const n in o) k[n] = o[n];
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
        for (let t = 0; t < 80 && !D.armed(); t++) { D.step(15); await sleep(20); }
        if (!D.armed()) return false;
        D.waterline = CBZ.sharkSim.waterline;
        /* From here the match advances ONLY when a subject steps it. Killing
           the page's own frame loop is what lets a staged camera survive to the
           capture; drain the one already-queued callback in a frame we control
           so its re-arm hits the stub and the chain is dead for good. */
        D._rafOrig = window.requestAnimationFrame;
        await D.killFrames();
        return true;
      },
      async killFrames() {
        const orig = D._rafOrig || window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
      },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },
      playerAngle() {
        const A = CBZ.surv.arena, P = CBZ.player;
        return Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
      },
      ringPoint(ang, r) {
        const A = CBZ.surv.arena;
        return { x: A.center.x + Math.cos(ang) * r, z: A.center.z + Math.sin(ang) * r };
      },
      // Put the ridden body in a known column of a CHOSEN depth on both sides.
      offshore(extra, wantDeep) {
        const P = CBZ.player, ang = D.playerAngle();
        const want = wantDeep || 34;
        let best = null, bestD = -1;
        for (let r = D.waterline + (extra || 20); r < D.waterline + 620; r += 6) {
          const p = D.ringPoint(ang, r);
          const d = CBZ.survFloodDepthMeanAt ? CBZ.survFloodDepthMeanAt(p.x, p.z) : 0;
          if (d > bestD) { bestD = d; best = p; }
          if (d >= want) { P.pos.x = p.x; P.pos.z = p.z; D.step(4); return d; }
        }
        if (best) { P.pos.x = best.x; P.pos.z = best.z; D.step(4); }
        return bestD;
      },
      camYawAlong(h) { return Math.atan2(-Math.cos(h), -Math.sin(h)); },
      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
      },
      /* NOTHING WITH TEETH IS HUNTING RIGHT NOW — and nothing is TELEPORTED to
         achieve it (a preset that throws every predator down the x axis poisons
         every later subject in the same continuing world). */
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (a.dead || !a.species) continue;
          if (CBZ.sharkSim && a === CBZ.sharkSim.shark) continue;
          if (a.species.id === "orca" || (a.species.aquatic && (a.species.bite || 0) >= 24)) {
            a.hunger = 0;
            const s = a._orca;
            if (s) { s.committed = false; s.interest = 0; s.quarry = null; s.rolling = 0; s.retreat = 0; s.act = ""; s.lift = 0; s.cool = 30; }
            if (a._shark) { a._shark.state = "cruise"; a._shark.bail = 6; }
            if (CBZ.predatorDisengage) { try { CBZ.predatorDisengage(a, 120); } catch (e) {} }
          }
        }
        if (CBZ.sharkSim) {
          const S = CBZ.sharkSim.shark;
          if (S) S.hp = S.maxHp;
          CBZ.sharkSim.podT = 120;
        }
      },
      /* A FRESH BODY AT A CHOSEN SPOT, PARKED. Spawned rather than borrowed so
         a subject cannot inherit a previous beat's ledger, and pinned still
         (hunger 0, brain disengaged) so a side-by-side size comparison is not
         secretly a comparison of who swam further in four seconds. */
      place(id, x, z, y) {
        if (!CBZ.cityWildlifeSpawnAt) return null;
        const a = CBZ.cityWildlifeSpawnAt(id, x, z);
        if (!a) return null;
        a.pos.x = x; a.pos.z = z;
        if (y != null) a.pos.y = y;
        if (a.group) { a.group.position.set(a.pos.x, a.pos.y, a.pos.z); }
        if (a.home) { a.home.x = x; a.home.z = z; }
        if (a._waterMove) { a._waterMove.x = x; a._waterMove.z = z; }
        a.hunger = 0;
        if (a._orca) { a._orca.cool = 999; a._orca.act = ""; a._orca.committed = false; }
        if (a._shark) { a._shark.state = "cruise"; a._shark.bail = 999; }
        if (CBZ.predatorDisengage) { try { CBZ.predatorDisengage(a, 999); } catch (e) {} }
        D.parked = D.parked || [];
        D.parked.push(a);
        return a;
      },
      /* Everything a previous subject spawned goes away before the next one
         stages, so the continuing world does not silently accumulate a crowd
         of parked megalodons in the background of beat four. */
      clearParked() {
        for (const a of D.parked || []) {
          if (!a || a.dead) continue;
          /* The same removal modes/shark_sim.js's own despawn() does — there is
             no published seam for this, and leaving a parked megalodon marked
             `dead` would leave a carcass drifting through the next beat. */
          try {
            a.dead = true; a.huntable = false; a.tamed = false; a.skinT = 0;
            if (a.group && a.group.parent) a.group.parent.remove(a.group);
            const L = CBZ.cityWildlife || [];
            const i = L.indexOf(a); if (i >= 0) L.splice(i, 1);
          } catch (e) {}
        }
        D.parked = [];
      },
      // The published size seams. Both degrade to the species constant when the
      // flags are off, which is exactly what the BEFORE column must photograph.
      scaleOf(a) {
        if (CBZ.wildlifeScale) { try { const s = +CBZ.wildlifeScale(a); if (s > 0) return s; } catch (e) {} }
        return (a && a.group && a.group.scale && a.group.scale.x) || 1;
      },
      ateOf(a) { return CBZ.wildlifeEatenMass ? +CBZ.wildlifeEatenMass(a) || 0 : 0; },
      feed(a, m) {
        if (CBZ.wildlifeSetEatenMass) { try { CBZ.wildlifeSetEatenMass(a, m); } catch (e) {} }
        return D.scaleOf(a);
      },
      // How long is the drawn body, in metres, right now — measured off the
      // scene graph rather than off any number this wave wrote, so the pair
      // table cannot agree with itself for the wrong reason.
      drawnLenM(a) {
        if (!a || !a.group || !T.Box3) return 0;
        const g = a.group, rx = g.rotation.x, ry = g.rotation.y, rz = g.rotation.z;
        let L = 0;
        try {
          g.rotation.set(0, 0, 0); g.updateMatrixWorld(true);
          const b = new T.Box3().setFromObject(g);
          if (isFinite(b.max.x) && isFinite(b.min.x)) L = b.max.x - b.min.x;
        } catch (e) { L = 0; }
        g.rotation.set(rx, ry, rz);
        try { g.updateMatrixWorld(true); } catch (e) {}
        return L;
      },
      /* THE LOD SWITCH IS DISTANCE FROM THE PLAYER, NOT FROM THE LENS.
         city/wildlife.js hides an animal whose group is outside the draw radius
         of the PLAYER — correct for the game and wrong for a staged tripod,
         which is a second eye the LOD system has never heard of. Measured: a
         pod staged 250 m out came back as an empty blue frame. The visibility
         flag is only recomputed on a sim step and this driver has frozen those,
         so setting it after the last step is safe and stays set. */
      show(a) {
        if (!a || !a.group) return;
        a.group.visible = true;
        /* ..and thaw the matrices with it: the same LOD pass freezes
           matrixAutoUpdate on a hidden animal, so a body made visible again
           without this renders at whatever transform it was frozen at. */
        a.group.traverse(function (o) { o.matrixAutoUpdate = true; o.visible = true; });
        a.group.updateMatrixWorld(true);
      },
      clearBanner() {
        const f = document.getElementById("sharkflash");
        if (f) { f.style.transition = "none"; f.style.opacity = "0"; }
      },
      depths() { return (CBZ.cityAquaticRideDepths && CBZ.cityAquaticRideDepths()) || {}; },
    };
    window.__cbzVisualCompare = {
      /* Awaited by the comparator before every capture. Under SwiftShader the
         compositor takes over a second to PRESENT a rendered canvas, so a
         shorter barrier photographs the PREVIOUS composite. */
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        if (!CBZ.renderer) return;
        const raf = D._rafOrig;
        if (raf) {
          await new Promise((res) => raf.call(window, () => {
            CBZ.renderer.render(CBZ.scene, CBZ.camera);
            res();
          }));
        } else CBZ.renderer.render(CBZ.scene, CBZ.camera);
        await new Promise((r) => setTimeout(r, 1200));
      },
      advance(sec) { D.sec(sec); if (D.track) { try { D.track(); } catch (e) {} } },
    };
  }

  if (!D.booted) {
    D.booted = await D.boot();
    if (!D.booted) return { ok: false, error: "sharksim never armed" };
  }
  D.track = null;
  D.clearBanner();
  D.keys({});
  D.clearParked();
  const out = {};

  if (sub.id === "meal-size" || sub.id === "megalodons-differ") {
    /* ---- TWO OF ONE SPECIES, ONE TRIPOD ---------------------------------
       Both animals are spawned at the SAME instant from the same species row.
       Individual spawn size is drawn from POSITION (wildlife_traits' hash01),
       so two bodies at two different points would differ before either had
       eaten anything and the pair would prove nothing. The fix is to force the
       second one's spawn draw onto the first's and re-apply, so the ONLY
       difference left in the frame is the ledger. */
    D.peace();
    const deep = D.offshore(70, 18);
    const P = CBZ.player, ang = D.playerAngle();
    const big = sub.id === "megalodons-differ";
    const id = big ? "megalodon" : "great_white_shark";
    /* ---- WHERE THE CAMERA STANDS, AND WHY IT IS NOT BEHIND THE PLAYER ----
       The first shape of this put the tripod on the line from the player to
       the subjects, and photographed the RIDDEN shark filling the frame with
       the pod invisible behind it. The subjects are staged out along `ang`
       (away from the island) and the lens is offset along `side` — PERPENDICULAR
       to that line — so the animal the player is sitting on is off frame by
       construction rather than by luck.

       The bodies are separated along `ang` and turned to face along it too, so
       the camera sees them BROADSIDE and side by side: length is the thing
       being compared, and a shark photographed nose-on has no length. */
    const side = ang + Math.PI / 2;
    const sea = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(P.pos.x, P.pos.z) : -0.8;
    const away = big ? 170 : 130;
    const cx = P.pos.x + Math.cos(ang) * away, cz = P.pos.z + Math.sin(ang) * away;
    const gap = big ? 34 : 13;
    const y = sea - (big ? 6.0 : 3.2);
    const A = D.place(id, cx - Math.cos(ang) * gap / 2, cz - Math.sin(ang) * gap / 2, y);
    const B = D.place(id, cx + Math.cos(ang) * gap / 2, cz + Math.sin(ang) * gap / 2, y);
    if (!A || !B) return { ok: false, error: "no " + id };
    // SAME BODY TO BEGIN WITH: individual size is drawn from POSITION, so two
    // bodies at two points differ before either has eaten and the pair proves
    // nothing. Force B's spawn draw onto A's and re-apply.
    B._sizeMul = A._sizeMul;
    if (CBZ.wildlifeApplyScale) { try { CBZ.wildlifeApplyScale(B); } catch (e) {} }
    out.spawnDrawMatched = Math.abs((A._sizeMul || 1) - (B._sizeMul || 1)) < 1e-9 ? 1 : 0;
    const baseline = D.scaleOf(A);
    // ..AND THEN THE ONLY DIFFERENCE: what each one has eaten.
    D.feed(A, big ? 0 : 1);                 // nothing / one mackerel
    D.feed(B, big ? 60 : 25);               // a match of eating / one orca
    D.sec(0.5);                             // let the swell land and settle
    /* PIN LAST, AND DO NOT STEP AFTERWARDS. A bigger body swims DEEPER (swim
       depth is derived from size, correctly), so two animals left to settle
       end up at two depths and the pair becomes a comparison of bathymetry.
       Everything the metrics measure has already happened; this only puts the
       two bodies on one line for the photograph. */
    for (const [a, sgn] of [[A, -1], [B, 1]]) {
      a.pos.x = cx + Math.cos(ang) * sgn * gap / 2;
      a.pos.z = cz + Math.sin(ang) * sgn * gap / 2;
      a.pos.y = y;
      a.heading = ang; a.faceH = ang;
      if (CBZ.faceAnimalHeading) { try { CBZ.faceAnimalHeading(a.group, ang); } catch (e) {} }
      if (a.group) a.group.position.set(a.pos.x, y, a.pos.z);
      D.show(a);
    }
    /* THE LENS GOES IN THE WATER. The first framing put it on a boom ABOVE the
       surface and photographed two dorsal fins and a pair of smudges — the sea
       is opaque from outside, which is the whole reason this game's dive
       camera exists. Underwater, a metre or two down, the bodies read as
       bodies and the size difference is the picture. */
    const dist = big ? 62 : 26;
    D.tripod(cx + Math.cos(side) * dist, y + (big ? 2.0 : 1.0), cz + Math.sin(side) * dist, cx, y, cz);
    out.leanEatenMass = +D.ateOf(A).toFixed(1);
    out.fedEatenMass = +D.ateOf(B).toFixed(1);
    out.leanScale = +D.scaleOf(A).toFixed(4);
    out.fedScale = +D.scaleOf(B).toFixed(4);
    out.scaleGainPct = +(((D.scaleOf(B) / Math.max(1e-6, D.scaleOf(A))) - 1) * 100).toFixed(1);
    out.leanBodyLenM = +D.drawnLenM(A).toFixed(2);
    out.fedBodyLenM = +D.drawnLenM(B).toFixed(2);
    out.bodyLenGainM = +(D.drawnLenM(B) - D.drawnLenM(A)).toFixed(2);
    out.speciesConstant = +(((A.species && A.species.scale) || 1)).toFixed(3);
    out.baselineScale = +baseline.toFixed(4);
    out.columnDepthM = +deep.toFixed(1);
    // SIZE IS POWER — the stat contest the bigger body is supposed to win.
    out.leanMaxHp = Math.round(A.maxHp || 0);
    out.fedMaxHp = Math.round(B.maxHp || 0);
    out.leanReachM = +((A._shark && A._shark.opts && A._shark.opts.reach) || 0).toFixed(2);
    out.fedReachM = +((B._shark && B._shark.opts && B._shark.opts.reach) || 0).toFixed(2);
    out.leanBiteDmg = +((A._shark && A._shark.opts && A._shark.opts.dmg) || 0).toFixed(1);
    out.fedBiteDmg = +((B._shark && B._shark.opts && B._shark.opts.dmg) || 0).toFixed(1);
    out.leanSenseR = +((A._shark && A._shark.opts && A._shark.opts.senseR) || 0).toFixed(1);
    out.fedSenseR = +((B._shark && B._shark.opts && B._shark.opts.senseR) || 0).toFixed(1);
  } else if (sub.id === "pod-grown") {
    /* ---- THE WIRING, NOT THE CURVE --------------------------------------
       No ledger is written by hand here. Prey is spawned in front of named pod
       members and killed with CBZ.marineHurt, the sea's own damage sink, so
       the mass has to travel the engine's real kill path to arrive on a body:
         marineHurt -> hurt() -> cityWildlifeHit -> killAnimal -> mealFrom
       If any link in that chain is missing, this beat photographs five
       identical orcas on BOTH sides and says so in the numbers. */
    D.peace();
    const deep = D.offshore(80, 20);
    const P = CBZ.player, ang = D.playerAngle();
    const sea = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(P.pos.x, P.pos.z) : -0.8;
    // Staged well out along `ang`, photographed from the side — see the note on
    // the first subject for why the lens is never on the player's own line.
    const cx = P.pos.x + Math.cos(ang) * 150, cz = P.pos.z + Math.sin(ang) * 150;
    const side = ang + Math.PI / 2;
    const SPACE = 17, yPod = sea - 5.0;
    const pod = [];
    for (let i = 0; i < 5; i++) {
      const o = D.place("orca", cx + Math.cos(ang) * (i - 2) * SPACE, cz + Math.sin(ang) * (i - 2) * SPACE, yPod);
      if (o) pod.push(o);
    }
    if (pod.length < 3) return { ok: false, error: "pod never formed" };
    // EVERY ORCA STARTS THE MATCH THE SAME SIZE, so the spread at the end is
    // the hunting and nothing else.
    for (const o of pod) { o._sizeMul = pod[0]._sizeMul; if (CBZ.wildlifeApplyScale) { try { CBZ.wildlifeApplyScale(o); } catch (e) {} } }
    const before = pod.map((o) => D.scaleOf(o));
    /* THE MATCH. A steeply uneven hunt on purpose: the first two orcas are the
       ones that keep making the kill, which is what a pod actually looks like
       and what gives the AFTER column a SHAPE rather than a uniform swell. */
    const share = [7, 4, 2, 1, 0];
    let kills = 0;
    for (let i = 0; i < pod.length; i++) {
      for (let k = 0; k < share[i]; k++) {
        const prey = D.place(k % 3 === 0 ? "tuna" : "dolphin",
          pod[i].pos.x + 6 + k * 0.7, pod[i].pos.z + 5, yPod);
        if (!prey) continue;
        if (CBZ.marineHurt) { try { CBZ.marineHurt(prey, (prey.maxHp || 40) * 4, pod[i], "eaten by an orca"); } catch (e) {} }
        if (prey.dead) kills++;
        D.step(2);
      }
    }
    D.sec(1.0);
    const after = pod.map((o) => D.scaleOf(o));
    out.podN = pod.length;
    out.realKills = kills;
    out.podEatenMass = pod.map((o) => Math.round(D.ateOf(o))).join(" / ");
    out.podScales = after.map((s2) => s2.toFixed(3)).join(" / ");
    out.podScaleSpreadPct = +(((Math.max.apply(null, after) / Math.max(1e-6, Math.min.apply(null, after))) - 1) * 100).toFixed(1);
    out.podBestGainPct = +(((Math.max.apply(null, after) / Math.max(1e-6, Math.max.apply(null, before))) - 1) * 100).toFixed(1);
    out.topHunterMaxHp = Math.round(pod[0].maxHp || 0);
    out.idlerMaxHp = Math.round(pod[pod.length - 1].maxHp || 0);
    out.columnDepthM = +deep.toFixed(1);
    /* THE LINE-UP, PINNED LAST. Biggest hunter nearest the lens is deliberate:
       the pod reads as a GRADIENT left to right, which is the shape the hunt
       put into it. Carcasses are cleared so the frame is the pod, not lunch. */
    for (const a of D.parked || []) {
      if (a && a.dead && a.group && a.group.parent) a.group.parent.remove(a.group);
    }
    /* ---- AN ARC, NOT A LINE, AND THAT IS THE WHOLE HONESTY OF THE SHOT ----
       Strung along a straight line, the two END orcas sit 71 m from the lens
       and the middle one 62 m — so perspective alone shrinks the outside of
       the pod by about 13%, which is LARGER than the ~10% of real growth the
       pair is claiming. The biggest hunter is on the end, so the picture was
       quietly cancelling its own point.

       Placing them on an arc of constant radius about the camera puts every
       body at exactly the same distance from the lens. Whatever size
       difference survives into the frame after that is the difference the
       hunting actually made, and nothing else. Each one is turned along its
       own tangent so all five are equally broadside. */
    const R = 66, SPAN = 0.24;
    const camX = cx + Math.cos(side) * R, camZ = cz + Math.sin(side) * R;
    const baseDir = side + Math.PI;             // camera -> pod centre
    for (let i = 0; i < pod.length; i++) {
      const o = pod[i];
      const phi = baseDir + (i - 2) * SPAN;
      o.pos.x = camX + Math.cos(phi) * R;
      o.pos.z = camZ + Math.sin(phi) * R;
      o.pos.y = yPod;
      const face = phi + Math.PI / 2;           // broadside to the lens
      o.heading = face; o.faceH = face;
      if (CBZ.faceAnimalHeading) { try { CBZ.faceAnimalHeading(o.group, face); } catch (e) {} }
      if (o.group) o.group.position.set(o.pos.x, yPod, o.pos.z);
      D.show(o);
    }
    /* THE LENS SITS AT THE POD'S OWN DEPTH. Two metres under the surface put
       the water plane itself between the camera and the animals — from below,
       that plane is opaque, and the frame came back an empty blue gradient with
       five orcas measurably alive, visible and 62 m away behind it. Level with
       the bodies there is nothing in the way. */
    D.tripod(camX, yPod + 1.2, camZ, cx, yPod, cz);
    /* ---- STAGING RECEIPT (kept deliberately) ---------------------------
       An empty frame must be able to say WHY, and over the course of building
       this beat it was empty twice for two different reasons that no amount of
       staring at the picture would have found: the pod LOD-culled because the
       draw radius is measured from the PLAYER and not from a staged tripod,
       and then the water surface plane sitting opaque between a shallow lens
       and the animals. Both were invisible in the image and obvious in one
       number. These stay in the report so the next person gets that for free. */
    const camv = new T.Vector3(); if (CBZ.camera) CBZ.camera.getWorldPosition(camv);
    if (CBZ.camera) CBZ.camera.updateMatrixWorld(true);
    out.podDrawnAndInFrame = pod.filter(function (o) {
      if (!o.group || !o.group.visible || !o.group.parent) return false;
      const v = o.group.position.clone().project(CBZ.camera);
      return Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1;
    }).length;
    out.podLensDistanceM = pod.map(function (o) { return Math.round(camv.distanceTo(o.group.position)); }).join(" / ");
  } else if (sub.id === "ridden-grown") {
    /* ---- THE MOUNT GREW UNDER ITS RIDER ---------------------------------
       Everything the ride cached off the body at mount time — the saddle
       socket animalSaddle measured from the bounding boxes, the camera boom
       sized to the hull, the seat height, the turn clamp — is a snapshot of
       the OLD body. The beat feeds the ridden animal and then measures whether
       those followed. `seatErrorM` is the one that matters: the vertical gap
       between where the rider actually is and where the freshly re-derived
       socket says the seat is. A stale socket shows up there as a body that
       has grown out from under its own rider. */
    D.peace();
    const deep = D.offshore(30, 12);
    const S = CBZ.sharkSim.shark, P = CBZ.player;
    if (!S) return { ok: false, error: "no ridden shark" };
    // point the ride out to sea and settle, identically on both sides
    const outward = D.playerAngle();
    if (CBZ.cam) { CBZ.cam.yaw = D.camYawAlong(outward); CBZ.cam.pitch = 0.12; }
    D.keys({ w: true }); D.sec(1.2); D.keys({});
    out.scaleBeforeMeal = +D.scaleOf(S).toFixed(4);
    out.bodyLenBeforeM = +D.drawnLenM(S).toFixed(2);
    const camBefore = CBZ.camera ? CBZ.camera.position.distanceTo(new T.Vector3(P.pos.x, P.pos.y, P.pos.z)) : 0;
    out.camToRiderBeforeM = +camBefore.toFixed(2);
    // ---- THE MEAL. A big one, mid-match, with the player sitting on it.
    D.feed(S, 30);
    D.sec(0.8);                                  // let the swell land and settle
    const camAfter = CBZ.camera ? CBZ.camera.position.distanceTo(new T.Vector3(P.pos.x, P.pos.y, P.pos.z)) : 0;
    out.scaleAfterMeal = +D.scaleOf(S).toFixed(4);
    out.bodyLenAfterM = +D.drawnLenM(S).toFixed(2);
    out.mountGrewPct = +(((D.scaleOf(S) / Math.max(1e-6, out.scaleBeforeMeal)) - 1) * 100).toFixed(1);
    out.camToRiderAfterM = +camAfter.toFixed(2);
    /* THE CAMERA MUST BACK OFF WHEN THE BODY GROWS, not stay put — a boom that
       does not follow is how a big animal swallows its own lens. */
    out.camBoomFollowedM = +(camAfter - camBefore).toFixed(2);
    // THE SADDLE. Re-derive the socket from the LIVE body and ask how far the
    // rider is from it. Small is correct; large means a stale snapshot.
    let seatErr = -1, socketY = -1;
    const d1 = D.depths() || {};
    if (CBZ.cityRideVisualSpec) {
      try {
        const V = CBZ.cityRideVisualSpec(S, S.group);
        if (V) {
          socketY = +V.y;
          /* THE RIDE'S OWN SEAT LAW, recomputed from a FRESHLY DERIVED socket.
             That is the whole test: the ride is holding a socket it measured at
             mount time, and this measures one off the body as it is now. If the
             ride's cache went stale when the animal grew, these two disagree by
             exactly the growth and seatErrorM blows up. Captured with the body
             level (no dive/rise input since the settle) so the pitch term of
             aquaticSeatY is ~0 on both sides. */
          const ch = CBZ.playerChar;
          const hs = (ch && ch.group && ch.group.userData && ch.group.userData.humanScale) || 1;
          const hip = ((ch && ch.hipY) || 0.95) * hs;
          const waterY = (d1.surf != null && d1.bodyDepth != null) ? (d1.surf - d1.bodyDepth) : null;
          if (waterY != null) seatErr = Math.abs((P.pos.y - waterY) - (V.y - hip));
        }
      } catch (e) {}
    }
    out.saddleSocketY = socketY >= 0 ? +socketY.toFixed(3) : null;
    out.seatErrorM = seatErr >= 0 ? +seatErr.toFixed(3) : null;
    // THE RIDER IS STILL ON THE BODY AT ALL — the blunt version of the same
    // question, and the one a stale socket fails first.
    const bodyY = S.group ? S.group.position.y : 0;
    out.riderAboveBodyM = +(P.pos.y - bodyY).toFixed(2);
    out.riderInsideBody = (P.pos.y - bodyY) < 0 ? 1 : 0;
    out.bodyDepthM = d1.bodyDepth != null ? d1.bodyDepth : null;
    out.mountStillHeld = D.armed() ? 1 : 0;
    out.columnDepthM = +deep.toFixed(1);
    /* FULL HEALTH FOR THE PHOTOGRAPH. The first run came back washed pink —
       the hurt vignette, not the water — and a red screen over a beat about
       SIZE is the picture arguing with its own caption. */
    S.hp = S.maxHp;
    if (CBZ.cityHealPlayer) { try { CBZ.cityHealPlayer(999); } catch (e) {} }
    if (P) P.hp = P.maxHp || P.hp;
    // A three-quarter chase so the body reads as a body.
    if (CBZ.cam) { CBZ.cam.yaw = D.camYawAlong((S.heading || 0) + 0.9); CBZ.cam.pitch = 0.10; }
    D.step(3);
  }

  out.massEconomyOn = (CBZ.CONFIG && CBZ.CONFIG.MASS_ECONOMY !== false) ? 1 : 0;
  out.wildGrowthOn = (CBZ.CONFIG && CBZ.CONFIG.WILD_GROWTH !== false) ? 1 : 0;
  return { ok: true, metrics: out };
}

export default {
  id: "shark-growth",
  title: "The Body Is The Progress Bar — Mass Into Size, For Every Animal",
  description: "One checkout, one island, one seed; the BEFORE column sets cfg_MASS_ECONOMY=0 and cfg_WILD_GROWTH=0 and runs the pre-wave code path, in which an animal's size is fixed at spawn for life. Four beats: a little fish against a big shark on two identical great whites, two megalodons that ate differently, a wild pod grown by REAL kills through the engine's own damage sink, and the ridden shark fed mid-match with the camera and saddle measured afterwards.",
  beforeLabel: "BEFORE · cfg_MASS_ECONOMY=0 cfg_WILD_GROWTH=0 (same build)",
  afterLabel: "AFTER · flags default-ON",
  pairNote: "Same checkout · same island · same seed · same spawn draw on both animals in frame",
  method: "Both sides boot index.html?mode=sharksim from THIS checkout and click the tile + PLAY exactly like a player, differing only by the cfg_* flags in the query string. A per-page driver freezes the frame loop after boot and advances the real match with CBZ.stepSim, so a beat is a number of GAME seconds rather than rasterised frames. Sizes are read from the engine's published seam (CBZ.wildlifeScale) AND independently re-measured off the scene graph's own bounding box (bodyLen), so the table cannot agree with itself for the wrong reason. The pod beat writes no ledger at all: it kills real prey through CBZ.marineHurt and lets the engine's kill path do the crediting.",
  defaultBefore: "local",
  urlParams: { mode: "sharksim", seed: "90210", bots: "30", cfg_BOOT_METER: "0" },
  beforeParams: { cfg_MASS_ECONOMY: "0", cfg_WILD_GROWTH: "0" },
  afterParams: {},
  stageTimeoutMs: 300000,
  metrics: {
    massEconomyOn: { label: "CONFIG.MASS_ECONOMY live on the page", better: "higher" },
    wildGrowthOn: { label: "CONFIG.WILD_GROWTH live on the page", better: "higher" },
    spawnDrawMatched: { label: "Both animals in frame share one spawn draw (control)", better: "higher" },
    speciesConstant: { label: "The species row's authored scale (what BOTH used to be)" },
    baselineScale: { label: "Scale of the un-fed animal" },
    leanEatenMass: { label: "Mass eaten · the lean one" },
    fedEatenMass: { label: "Mass eaten · the fed one" },
    leanScale: { label: "Live scale · the lean one" },
    fedScale: { label: "Live scale · the fed one", better: "higher" },
    scaleGainPct: { label: "How much bigger the fed one is", unit: "%", better: "higher" },
    leanBodyLenM: { label: "Drawn body length · lean (measured off the scene graph)", unit: "m" },
    fedBodyLenM: { label: "Drawn body length · fed (measured off the scene graph)", unit: "m", better: "higher" },
    bodyLenGainM: { label: "Body length the meal actually added", unit: "m", better: "higher" },
    leanMaxHp: { label: "maxHp · lean" },
    fedMaxHp: { label: "maxHp · fed (size is power)", better: "higher" },
    leanReachM: { label: "Bite reach · lean", unit: "m" },
    fedReachM: { label: "Bite reach · fed", unit: "m", better: "higher" },
    leanBiteDmg: { label: "Bite damage · lean" },
    fedBiteDmg: { label: "Bite damage · fed", better: "higher" },
    leanSenseR: { label: "Sense/LOD radius · lean", unit: "u" },
    fedSenseR: { label: "Sense/LOD radius · fed", unit: "u", better: "higher" },
    podN: { label: "Orcas in the pod" },
    realKills: { label: "Real kills made through CBZ.marineHurt", better: "higher" },
    podEatenMass: { label: "Mass on each orca's ledger, best hunter first" },
    podScales: { label: "Live scale of each orca, best hunter first" },
    podScaleSpreadPct: { label: "Biggest orca over smallest", unit: "%", better: "higher" },
    podBestGainPct: { label: "How much the best hunter grew over the match", unit: "%", better: "higher" },
    topHunterMaxHp: { label: "maxHp · the orca that fed most", better: "higher" },
    idlerMaxHp: { label: "maxHp · the orca that never fed" },
    scaleBeforeMeal: { label: "Ridden shark's scale before the meal" },
    scaleAfterMeal: { label: "Ridden shark's scale after the meal", better: "higher" },
    mountGrewPct: { label: "How much the mount grew under the rider", unit: "%", better: "higher" },
    bodyLenBeforeM: { label: "Mount body length before", unit: "m" },
    bodyLenAfterM: { label: "Mount body length after", unit: "m", better: "higher" },
    camToRiderBeforeM: { label: "Camera to rider before the meal", unit: "m" },
    camToRiderAfterM: { label: "Camera to rider after the meal", unit: "m" },
    camBoomFollowedM: { label: "Camera backed off as the body grew (0 = boom went stale)", unit: "m", better: "higher" },
    saddleSocketY: { label: "Saddle socket height, re-derived from the live body", unit: "m" },
    seatErrorM: { label: "Rider's gap from the live socket (small = the saddle followed)", unit: "m", better: "lower" },
    riderAboveBodyM: { label: "Rider above the body origin", unit: "m" },
    riderInsideBody: { label: "Rider swallowed by the body it rides", better: "lower" },
    mountStillHeld: { label: "Still mounted after the growth", better: "higher" },
    podDrawnAndInFrame: { label: "Orcas actually drawn AND inside the frame (staging receipt)", better: "higher" },
    podLensDistanceM: { label: "Each orca's distance from the lens — equal by construction, so apparent size IS real size", unit: "m" },
    columnDepthM: { label: "Water column staged in", unit: "m" },
    bodyDepthM: { label: "Mount body below the surface at capture", unit: "m" },
  },
  metricsNote: "Every number is read off the engine's own seams at the instant of the capture, on both sides, with identical staging. Body lengths are measured independently off the scene graph so the size claim does not rest on the same field the wave writes.",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  subjects,
  stage: stageSharkGrowth,
};
