/* ANGLES DECIDE KILLS — a flag A/B on ONE build.

   Owner, 2026-08-25: "like agario over and over again for each bite — angles
   of collision decide kills — so a shark at the right angle can kill a bigger
   shark."

   Both columns are THIS checkout, the same seed, the same island, the same
   staged fight, driven by the same staging code. The only difference is one
   query flag:

     ?cfg_BITE_ANGLES=0   systems/bite_angles.js stands down and every bite
                          goes back to being a scalar: the same damage from
                          every direction, no counter-bite, no jaw clash.

   THE PAIR THAT IS THE FEATURE is subjects 0 and 1, and they are the SAME two
   animals with the SAME stats for the SAME number of seconds. The only thing
   that changes between them is where the small one chose to be. On the orca's
   tail a bull shark takes it apart and is never touched. On its nose the same
   bull shark is the one that bleeds. With the flag off both of those frames
   are the same picture, because before today the geometry decided nothing.

   NOTHING HERE READS THE FLAG. The staging pins the orca's position (so both
   columns frame identically), holds the shark on one bearing off the orca's
   own live facing — an orbiting player, modelled — and then lets production
   code do all of it: Shark Sim's own automatic bite, wildlife_tame's mounted
   damage, marine_predation's pod drive and creature_combat's strike frame.
*/

const subjects = [
  {
    id: "ambush", ch: 0, strip: { frames: 4, stepSec: 2.4 },
    label: "The Ambush — A Bull Shark On An Orca's Tail",
    focus: "Fourteen seconds of the player's bull shark held behind an orca's pectorals, biting automatically. AFTER: every bite lands in the rear half, where the orca's own jaws cannot reach — full damage plus the ambush premium, no answer, and the orca is opened up without the shark being touched once. BEFORE: the identical fourteen seconds bill the identical flat damage from a bearing that ought to be free, and the orca answers a bite it should never have been able to reach.",
    state: "REAR HALF · NO ANSWER POSSIBLE", metric: "Health taken off it · health it took off you",
  },
  {
    id: "counter", ch: 1,
    label: "The Counter-Bite — Answered Mid-Windup",
    focus: "A nose-region exchange with an orca, staged so the shark is looking at it rather than square into its mouth. BEFORE: a defender being charged has NO answer — the attacker takes nothing, ever, and the frame contains exactly one event, which is the shark getting bitten. AFTER: four counter-bites land inside the attackers' wind-ups for 71 hp, both bodies leave the exchange marked, and the shark that turned into the charge is billing damage it could not previously bill. Measured on this beat: answers 0 to 4, counter damage 0 hp to 71 hp.",
    state: "WINDUP · ANSWERED", metric: "Counter-bites landed inside a wind-up · the damage they billed",
  },
  {
    id: "pod", ch: 2, strip: { frames: 3, stepSec: 2.2 },
    label: "The Pod Denies The Angle",
    focus: "Three orcas on three bearings around the player's shark. AFTER: you cannot face them all, so what a pod IS becomes mechanical rather than decorative — the two you are not looking at own your rear half and bite for full damage, and the one you ARE facing is the one that gets counter-bitten. BEFORE: the bearings are the same picture and mean nothing; every orca bites for the same number wherever it happens to be.",
    state: "THREE BEARINGS · ONE FACE", metric: "How much of the pod is on your blind half",
  },
  {
    id: "clash", ch: 3, strip: { frames: 4, stepSec: 0.4 },
    label: "The Clash — The Ambush's Two Animals, Nose To Nose",
    focus: "THE OTHER HALF OF PAIR 1. The same bull shark, the same orca, the same stats, the same staging code — driven straight at its face instead of held on its tail. (It is photographed last because it is the beat that kills the player, and a death mid-run takes every later subject with it.) AFTER: two mouths arrive at each other and the wider gape closes around the narrower one, so the shark's bite is worth a fraction and the orca's answer is worth everything; the shark is the body losing material here. BEFORE: this frame is indistinguishable from the ambush, because direction was not a variable.",
    state: "HEAD-ON · THE GAPE DECIDES", metric: "The exchange, reversed by nothing but bearing",
  },
];

async function stageBiteAngles(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__biteAngles;
  if (!D) {
    D = window.__biteAngles = {
      chapter: -1, waterline: 0, _rafOrig: null,
      holdFn: null, camFn: null, anchor: null,
      /* THE HOLD RUNS INSIDE THE STEP, not around it. A chapter that pinned
         the geometry once and then stepped thirty times would be measuring
         drift, and the film strip advances through this same function, so the
         photographed seconds are staged exactly like the ones before them. */
      step(n) {
        for (let i = 0; i < n; i++) {
          CBZ.stepSim(1 / 30);
          if (D.holdFn) { try { D.holdFn(); } catch (e) {} }
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
        return true;
      },
      seed() {
        let s = 1337;
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
      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
      },
      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -0.8; },
      offshore(extra) {
        const S = CBZ.sharkSim.shark, P = CBZ.player;
        const p = D.ringPoint(D.playerAngle(), D.waterline + (extra == null ? 46 : extra));
        S.pos.x = p.x; S.pos.z = p.z;
        if (S._waterMove) { S._waterMove.x = p.x; S._waterMove.z = p.z; }
        P.pos.x = p.x; P.pos.z = p.z;
        D.step(3);
      },
      /* EMPTY THE SEA. Every one of these beats is a two- or four-body
         experiment, and marine_predation scores an apex three times a snack:
         leave a great white in the water and the orca under test will go and
         mob it instead. Measured — the numeric probe lost a whole run to it. */
      clearSea(keepOrcas) {
        const S = CBZ.sharkSim.shark;
        let orcas = 0;
        for (const a of CBZ.cityWildlife || []) {
          if (!a || a.dead || !a.species || a === S) continue;
          if (!a.species.aquatic) continue;
          if (a.species.id === "orca" && orcas < keepOrcas) { orcas++; continue; }
          // beyond FIGHT_R (1400 m): a fight already started keeps running
          // out to that radius, so parking at a few hundred metres is a pod
          // that chases rather than a pod that is gone.
          a.pos.x += 3000; a.hunger = 0;
          if (a._mp) { a._mp.target = null; a._mp.kind = 0; }
          if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
          if (a.group) a.group.position.x = a.pos.x;
        }
        CBZ.sharkSim.podT = 400;         // and no reinforcements mid-experiment
        return orcas;
      },
      orcasNear() {
        const S = CBZ.sharkSim.shark, out = [];
        for (const a of CBZ.cityWildlife || []) {
          if (a && !a.dead && a.species && a.species.id === "orca" &&
              Math.hypot(a.pos.x - S.pos.x, a.pos.z - S.pos.z) < 1200) out.push(a);
        }
        return out;
      },
      ensureOrca() {
        let l = D.orcasNear();
        if (l.length) return l[0];
        const S = CBZ.sharkSim.shark;
        if (CBZ.cityWildlifeSpawnAt) CBZ.cityWildlifeSpawnAt("orca", S.pos.x + 30, S.pos.z + 30);
        l = D.orcasNear();
        return l[0] || null;
      },
      lenOf(a) { return (CBZ.marineBodyLen ? CBZ.marineBodyLen(a) : 6) || 6; },
      beamOf(a) { return (CBZ.marineBodyBeam ? CBZ.marineBodyBeam(a) : 1.5) || 1.5; },
      jawAhead(a) {
        const jp = (CBZ.creatureJawPoint && CBZ.creatureJawPoint(a)) || { x: 2.1 };
        return jp.x * ((a.species && a.species.scale) || 1);
      },
      /* HOW FAR OFF THE VICTIM'S CENTRE THE ATTACKER'S MOUTH HAS TO SIT so
         that the teeth are AT the surface on this bearing — an ellipse on the
         measured length and beam, because a body is not a circle and a single
         radius would put the mouth inside the animal astern and two metres
         short of it abeam. */
      standoff(vic, att, bear) {
        const L = D.lenOf(vic) * 0.5, B = D.beamOf(vic) * 0.5;
        const c = Math.abs(Math.cos(bear)), s = Math.abs(Math.sin(bear));
        return L * c + B * s + D.jawAhead(att) + 0.5;
      },
      /* PIN THE VICTIM, HOLD THE ATTACKER'S BEARING. The victim keeps its own
         live heading — turning to face whatever is biting it is the thing
         being tested — but its POSITION is pinned, so both columns frame the
         identical shot and a drifting fight cannot swim out of the picture.
         The attacker (the player's shark) is put back on its bearing every
         tick, which is precisely the orbiting player this feature is for. */
      holdPlayerAt(orca, bear, aimOff) {
        const S = CBZ.sharkSim.shark, P = CBZ.player, A = D.anchor;
        /* THE HARNESS REFUSES TO LET THE MATCH END, AND SAYS SO. A staged
           beat that kills the player tears down the world and every later
           subject with it, so the shark is floored at 1 hp — and the fact
           that it WOULD have died is recorded and reported as its own
           metric rather than quietly rounded away. The clash chapter is
           supposed to be lethal; the photograph just has to survive it. */
        if (S.hp <= 1) { S.hp = 1; S.dead = false; if (D._live) D._live.lethal = 1; }
        orca.pos.x = A.x; orca.pos.z = A.z; orca.pos.y = A.y;
        if (orca.group) orca.group.position.set(A.x, orca.group.position.y, A.z);
        if (orca._waterMove) { orca._waterMove.x = A.x; orca._waterMove.z = A.z; }
        const face = (orca.heading != null) ? orca.heading : 0;
        const R = D.standoff(orca, S, bear);
        const x = A.x + Math.cos(face + bear) * R, z = A.z + Math.sin(face + bear) * R;
        /* AIM OFFSET. Pointed straight at the orca the shark is nose-to-nose
           with it and every exchange resolves as a jaw CLASH, which the
           bigger mouth wins outright — the right beat for chapter 3 and the
           wrong one for a counter-bite. A few tens of degrees off puts the
           orca inside the shark's FACE zone instead: close enough to answer,
           not a mouth-to-mouth meeting. */
        const h = Math.atan2(A.z - z, A.x - x) + (aimOff || 0);
        S.pos.x = x; S.pos.z = z; S.pos.y = A.y;
        if (S.group) S.group.position.set(x, S.group.position.y, z);
        if (S._waterMove) { S._waterMove.x = x; S._waterMove.z = z; }
        P.pos.x = x; P.pos.z = z;
        if (CBZ.cityMountedHeading) CBZ.cityMountedHeading(h);
      },
      hp01(a) {
        const m = a.maxHp || (a.species && a.species.hp) || 100;
        return m > 0 ? Math.max(0, (a.hp == null ? m : a.hp)) / m : 0;
      },
      angles() { return (CBZ.biteAngleAudit && CBZ.biteAngleAudit()) || {}; },
      chunks() { return (CBZ.creatureBiteChunkAudit && CBZ.creatureBiteChunkAudit()) || { chunks: 0 }; },
      /* HOW MUCH OF THE POD IS WHERE YOU CANNOT ANSWER IT. One number for the
         whole of "you cannot face them all": the fraction of the pod sitting
         past the rear threshold of the law itself, read off CBZ.biteAngleZones
         so a retuned constant cannot make this metric lie. */
      podRearFrac() {
        const S = CBZ.sharkSim.shark, l = D.orcasNear();
        if (!S || !l.length) return 0;
        const Z = (CBZ.biteAngleZones && CBZ.biteAngleZones()) || { rear: 1.75 };
        const face = S.heading || 0;
        let n = 0;
        for (const o of l) {
          let d = Math.atan2(o.pos.z - S.pos.z, o.pos.x - S.pos.x) - face;
          while (d > Math.PI) d -= 6.283185307;
          while (d < -Math.PI) d += 6.283185307;
          if (Math.abs(d) >= Z.rear) n++;
        }
        return +(n / l.length).toFixed(2);
      },
      /* HOW MUCH OF THE POD YOU CANNOT ANSWER. podRearFrac counts only the
         orcas past the REAR threshold, which is a strict test that a pod
         still circling has not met yet. This is the looser and more honest
         one: everything outside your own bite cone — anything you would have
         to TURN to deal with. Read off CBZ.biteAngleZones so a retuned
         constant cannot make the metric disagree with the law. */
      podUnfacedFrac() {
        const S = CBZ.sharkSim.shark, l = D.orcasNear();
        if (!S || !l.length) return 0;
        const Z = (CBZ.biteAngleZones && CBZ.biteAngleZones()) || { face: 1.05 };
        const face = S.heading || 0;
        let n = 0;
        for (const o of l) {
          let d = Math.atan2(o.pos.z - S.pos.z, o.pos.x - S.pos.x) - face;
          while (d > Math.PI) d -= 6.283185307;
          while (d < -Math.PI) d += 6.283185307;
          if (Math.abs(d) >= Z.face) n++;
        }
        return +(n / l.length).toFixed(2);
      },
      podSpreadDeg() {
        const S = CBZ.sharkSim.shark, l = D.orcasNear();
        if (!S || l.length < 2) return 0;
        const b = l.map(function (o) { return Math.atan2(o.pos.z - S.pos.z, o.pos.x - S.pos.x); }).sort();
        let widest = 0;
        for (let i = 0; i < b.length; i++) {
          for (let j = i + 1; j < b.length; j++) {
            let d = Math.abs(b[i] - b[j]);
            if (d > Math.PI) d = 6.283185307 - d;
            if (d > widest) widest = d;
          }
        }
        return Math.round(widest * 57.2958);
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
        await new Promise((r) => setTimeout(r, 1200));
      },
      /* Merged AFTER the film strip, because every claim in this preset is
         about what a stretch of seconds COST — a single frame cannot carry
         "who bled". The exchange is read live off the two bodies. */
      metrics() {
        if (!D._live) return null;
        const L = D._live;
        const o = L.orca, s = CBZ.sharkSim && CBZ.sharkSim.shark;
        const out = {};
        if (o) out.preyHpLostPct = Math.round((L.orca0 - D.hp01(o)) * 100);
        if (s) out.yourHpLostPct = Math.round((L.shark0 - D.hp01(s)) * 100);
        if (out.preyHpLostPct != null && out.yourHpLostPct != null) {
          out.exchangeRatio = +(out.preyHpLostPct / Math.max(1, out.yourHpLostPct)).toFixed(2);
        }
        const A = D.angles();
        out.answersLanded = (A.answers | 0) - (L.answers0 | 0);
        out.counterDamage = Math.round((A.answerDmg || 0) - (L.answerDmg0 || 0));
        out.rearBites = (A.rear | 0) - (L.rear0 | 0);
        out.faceBites = ((A.face | 0) - (L.face0 | 0)) + ((A.clash | 0) - (L.clash0 | 0));
        out.piecesTaken = (D.chunks().chunks | 0) - (L.chunks0 | 0);
        out.contestsRun = (A.contests | 0) - (L.contests0 | 0);
        out.youWouldHaveDied = L.lethal ? 1 : 0;
        if (L.pod) {
          out.podRearFrac = D.podRearFrac();
          out.podUnfacedFrac = D.podUnfacedFrac();
          out.podSpreadDeg = D.podSpreadDeg();
        }
        return out;
      },
      advance(sec) { D.step(Math.max(1, Math.round(sec * 30))); },
    };
  }

  const out = {};

  /* Open a measurement window: everything metrics() reports is a DELTA from
     here, so a chapter cannot inherit the previous chapter's blood. */
  function openWindow(orca, isPod) {
    const A = D.angles();
    D._live = {
      orca: orca, pod: !!isPod,
      orca0: orca ? D.hp01(orca) : 0,
      shark0: D.hp01(CBZ.sharkSim.shark),
      answers0: A.answers | 0, answerDmg0: A.answerDmg || 0,
      rear0: A.rear | 0, face0: A.face | 0, clash0: A.clash | 0,
      contests0: A.contests | 0,
      chunks0: D.chunks().chunks | 0,
    };
  }

  /* Stand the duel up: one orca, pinned, and the player's shark healed and
     put on `bear`. Returns the orca. */
  function standDuel(bear, aimOff) {
    D.offshore(48);
    D.clearSea(1);
    const orca = D.ensureOrca();
    if (!orca) throw new Error("no orca to fight");
    const S = CBZ.sharkSim.shark;
    S.hp = S.maxHp; S.dead = false;
    orca.hp = orca.maxHp || orca.species.hp; orca.dead = false;
    orca.hunger = 1;
    D.anchor = { x: S.pos.x + 26, y: S.pos.y, z: S.pos.z + 8 };
    orca.pos.x = D.anchor.x; orca.pos.z = D.anchor.z; orca.pos.y = D.anchor.y;
    if (orca.group) orca.group.position.set(D.anchor.x, D.anchor.y, D.anchor.z);
    if (orca._waterMove) { orca._waterMove.x = D.anchor.x; orca._waterMove.z = D.anchor.z; }
    orca.heading = 0.7; orca.faceH = 0.7;
    D.holdFn = function () { D.holdPlayerAt(orca, bear, aimOff); };
    D.holdFn();
    D.step(2);
    return orca;
  }

  /* One fixed camera per duel, aimed at the ANCHOR rather than at either
     animal — a camera that tracked a body would move differently on the two
     sides and stop being a comparison. */
  function duelCam(bear) {
    const A = D.anchor, sy = D.seaY(A.x, A.z);
    // stand off along the axis perpendicular to the engagement so both the
    // pinned body and the bearing the attacker is holding are in frame
    // THREE-QUARTER OVERHEAD, because the CLAIM is a bearing. A near-water
    // side-on shot of two sharks is two sharks; it takes altitude before a
    // reader can see that one of them is behind the other's pectorals.
    const th = 0.7 + bear * 0.5 + Math.PI * 0.5;
    D.camFn = function () {
      D.tripod(A.x + Math.cos(th) * 20, sy + 15, A.z + Math.sin(th) * 20,
        A.x, sy - 1.6, A.z);
    };
    D.camFn();
  }

  const CH = [
    /* 0 — THE AMBUSH. Bearing PI: dead astern of the orca, past its pectorals,
       where nothing it does can reach back. */
    async function ambush() {
      if (!await D.boot()) throw new Error("no match / sim never armed");
      D.seed();
      const orca = standDuel(Math.PI);
      openWindow(orca, false);
      duelCam(Math.PI);
      D.sec(4.5);                       // the strip carries the rest
      out.bearingDeg = 180;
      out.preyLenM = +D.lenOf(orca).toFixed(1);
      out.yourLenM = +D.lenOf(CBZ.sharkSim.shark).toFixed(1);
      out.sizeRatio = +(D.lenOf(orca) / Math.max(0.1, D.lenOf(CBZ.sharkSim.shark))).toFixed(2);
    },

    /* 1 — THE COUNTER-BITE. The orca is the attacker here and the shark is
       the one being charged — turned INTO the charge, which is the whole
       defensive claim. Held until the law records an answer, then stopped
       inside the orca's swing so the photograph is the windup itself. */
    async function counter() {
      const orca = standDuel(0.30, 0.75);
      openWindow(orca, false);
      duelCam(0.30);
      let frames = 0;
      const A0 = D.angles().answers | 0;
      const oh0 = orca.hp;
      // CAPPED. This is the same nose-on geometry the clash chapter proves is
      // lethal, so it may not be allowed to run until it kills the player —
      // it runs until the answer lands, and gives up after six seconds.
      for (let i = 0; i < 180; i++) {
        D.step(1); frames++;
        const A = D.angles();
        // the answer has to have landed ON THE ORCA — `answers` counts both
        // directions of a nose-to-nose exchange, and the claim in this frame
        // is specifically that the animal doing the CHARGING is the one
        // bleeding. Caught while its swing is still running.
        if ((A.answers | 0) > A0 && orca.hp < oh0 && orca._atkAnim >= 0) break;
      }
      out.framesToAnswer = frames;
      out.attackerMidSwing = orca._atkAnim >= 0;
      out.attackerHpPct = Math.round(D.hp01(orca) * 100);
    },

    /* 2 — THE POD. Three orcas, three bearings, nothing pinned: the pod is
       allowed to place itself and the point is that you cannot face it. */
    async function pod() {
      D.holdFn = null;
      D.offshore(52);
      D.clearSea(3);
      const S = CBZ.sharkSim.shark;
      S.hp = S.maxHp; S.dead = false;
      let l = D.orcasNear();
      while (l.length < 3 && CBZ.cityWildlifeSpawnAt) {
        const th = l.length * 2.1;
        if (!CBZ.cityWildlifeSpawnAt("orca", S.pos.x + Math.cos(th) * 24, S.pos.z + Math.sin(th) * 24)) break;
        l = D.orcasNear();
      }
      if (l.length < 2) throw new Error("no pod to stage");
      const face = S.heading || 0;
      for (let i = 0; i < l.length; i++) {
        const o = l[i];
        // spread across the shark's own facing so neither column starts with
        // a pod that is already behind it — where they END UP is the claim
        const th = face + (i - (l.length - 1) / 2) * 1.15;
        o.pos.x = S.pos.x + Math.cos(th) * 22; o.pos.z = S.pos.z + Math.sin(th) * 22;
        o.pos.y = S.pos.y;
        if (o.group) o.group.position.set(o.pos.x, o.group.position.y, o.pos.z);
        if (o._waterMove) { o._waterMove.x = o.pos.x; o._waterMove.z = o.pos.z; }
        o.heading = th + Math.PI; o.faceH = o.heading; o.hunger = 1;
        if (o._mp) { o._mp.target = null; o._mp.kind = 0; o._mp.scanT = 0; }
      }
      // the player holds still and holds its heading — the pod's problem to solve
      /* THE PLAYER HOLDS STILL AND HOLDS ONE HEADING — pinned, not merely
         un-driven. A coasting mount drifts a different distance on the two
         builds and the two columns stop being the same photograph; pinning
         is also the honest statement of the claim, which is about a player
         who has picked a direction to face and cannot pick three. */
      const px = S.pos.x, pz = S.pos.z;
      D.holdFn = function () {
        const P = CBZ.player, SS = CBZ.sharkSim.shark;
        SS.pos.x = px; SS.pos.z = pz;
        if (SS.group) SS.group.position.set(px, SS.group.position.y, pz);
        if (SS._waterMove) { SS._waterMove.x = px; SS._waterMove.z = pz; }
        P.pos.x = px; P.pos.z = pz;
        if (CBZ.cityMountedHeading) CBZ.cityMountedHeading(face);
      };
      openWindow(l[0], true);
      D.sec(14);
      out.podN = D.orcasNear().length;
      const sy = D.seaY(S.pos.x, S.pos.z);
      /* HIGH ENOUGH TO HOLD THE WHOLE RING. The claim is a spread of
         bearings, so a shot that only fits one orca is not the claim: at
         30 m altitude the pod's 169-degree spread put two of the three
         outside the frame. Centred on the shark and lifted until the ring
         fits, with the shark's facing pointing UP the frame so "the one it
         is looking at" is readable without a caption. */
      /* HIGH ENOUGH TO HOLD THE RING, LOW ENOUGH TO SEE THROUGH THE WATER.
         Two failures, both photographed: at 30 m centred 8 m ahead the pod's
         169-degree spread put two of the three orcas outside the frame, and
         lifting to 58 m to fix that put the whole shot behind so much water
         column and surface haze that nothing in it was legible. This is the
         band between them — a high three-quarter chase, centred on the shark
         with its facing up the frame, and the ring pulled in to 22 m so it
         fits without the altitude. */
      D.camFn = function () {
        D.tripod(px - Math.cos(face) * 17, sy + 31, pz - Math.sin(face) * 17,
          px + Math.cos(face) * 1, sy - 2.5, pz + Math.sin(face) * 1);
      };
      D.camFn();
    },

    /* 3 — THE CLASH. Bearing 0: the same two animals as chapter 0, the same
       stats, the same staging code — the shark driven at the orca's FACE
       instead of its tail. This is the other half of the pair that is the
       feature, and it is deliberately the last chapter. */
    async function clash() {
      const orca = standDuel(0);
      openWindow(orca, false);
      duelCam(0);
      /* SHORT ON PURPOSE, AND THIS IS THE LETHAL CHAPTER. Measured: at this
         bearing the orca's answers take the player's shark from full to dead
         in about seven seconds, and the first run of this preset photographed
         exactly that — a spectate camera over empty blue water with "Orca
         killed Bull Shark" in the killfeed. So the clash is now the LAST
         chapter (a death here can no longer poison the ones after it) and the
         beat is cut to one or two exchanges, which is all it takes to show
         which body is losing. */
      D.sec(0.8);
      out.bearingDeg = 0;
      out.preyLenM = +D.lenOf(orca).toFixed(1);
      out.yourLenM = +D.lenOf(CBZ.sharkSim.shark).toFixed(1);
      out.sizeRatio = +(D.lenOf(orca) / Math.max(0.1, D.lenOf(CBZ.sharkSim.shark))).toFixed(2);
    },
  ];

  const want = sub.ch | 0;
  for (let c = D.chapter + 1; c <= want; c++) { await CH[c](); D.chapter = c; }

  const A = D.angles();
  out.ok = true;
  out.lawOn = !!(CBZ.biteAngleOn && CBZ.biteAngleOn());
  out.metrics = Object.assign({
    preyHpLostPct: 0, yourHpLostPct: 0,
  }, window.__cbzVisualCompare.metrics() || {});
  return out;
}

export default {
  id: "bite-angles",
  title: "Angles Decide Kills — The Same Two Animals, Two Bearings",
  description: "Four beats of one Shark Sim match photographed twice on the SAME checkout with a single config flag between the columns. BEFORE (?cfg_BITE_ANGLES=0) bills every bite the same number from every direction. AFTER, the bearing at contact is the fight: a bull shark held on an orca's tail takes it apart untouched, the same bull shark driven at the same orca's face is the one that bleeds, a shark that turns into a charge bites back during the wind-up, and a pod of three exists precisely because you cannot face all of it.",
  beforeLabel: "BEFORE · ?cfg_BITE_ANGLES=0 (a bite is a scalar)",
  afterLabel: "AFTER · the angle at contact decides",
  pairNote: "Same checkout · same seed · same two animals · same staging code · same seconds · only the flag differs",
  method: "Both columns serve THIS checkout (--before local) and boot index.html?mode=sharksim with a pinned seed, click the tile and PLAY like a player, then freeze the page's frame loop and advance the real match with CBZ.stepSim. One staging path runs on both sides and never reads a flag: the sea is emptied to the bodies under test, the victim's POSITION is pinned (its heading is its own — turning to face what is biting it is the thing being tested) and the player's shark is held on one bearing off that live heading, which is an orbiting player modelled exactly. Every bite is Shark Sim's own automatic mouth through wildlife_tame's mounted damage; every answer is creature_combat's strike frame. Film strips step the identical simulated seconds on both sides.",
  defaultBefore: "local",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0", cfg_BITE_ANGLES: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 420000,
  metricsWhitelist: true,
  metrics: {
    preyHpLostPct: { label: "Health taken off the animal you were biting", unit: "%", better: "higher" },
    yourHpLostPct: { label: "Health it took off you", unit: "%", better: "lower" },
    exchangeRatio: { label: "The exchange: its health lost per point of yours", better: "higher" },
    answersLanded: { label: "Counter-bites landed during a wind-up", better: "higher" },
    counterDamage: { label: "Damage those counter-bites dealt", unit: "hp", better: "higher" },
    rearBites: { label: "Bites that landed in a rear half (unanswerable)", better: "higher" },
    faceBites: { label: "Bites taken in something's face (contested)", better: "lower" },
    piecesTaken: { label: "Pieces bitten out of a body in this beat", better: "higher" },
    podRearFrac: { label: "Fraction of the pod sitting on your blind half", better: "higher" },
    podUnfacedFrac: { label: "Fraction of the pod outside your own bite cone", better: "higher" },
    podSpreadDeg: { label: "Widest bearing the pod holds around you", unit: "deg", better: "higher" },
    contestsRun: { label: "Bites resolved as a geometric contest", better: "higher" },
    youWouldHaveDied: { label: "The beat was lethal to you (harness floored you at 1 hp to keep the match up)", better: "lower" },
    sizeRatio: { label: "How much longer than you the animal you are eating is", better: "higher" },
  },
  metricsNote: "exchangeRatio is the whole feature as one number, and it is the SAME two animals in subjects 0 and 1 — only the bearing changes. A build in which direction decides nothing cannot separate those two rows; contestsRun is zero on the BEFORE side by construction, because the law is switched off there and every bite is billed flat.",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityWildlifeStock && CBZ.spawnSurvivorBotAt && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  subjects,
  stage: stageBiteAngles,
};
