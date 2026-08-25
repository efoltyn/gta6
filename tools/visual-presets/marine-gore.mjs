/* Marine gore, before/after — THE BLOCK DIES.

   Owner, 2026-08-25, over a photograph of a bitten orca taken from a boat:
   "orca underwater blood looks like a BLOCK but surface blood is decent."
   It did. The body rendered as the translucent teal shape SEA_TRANSLUCENT
   makes of a submerged animal, and lying across its flank was a hard-edged
   opaque MAROON PLANK about as long as the orca. The red slick on the water
   beside it — gore.js's own — read fine, which is what made the wound look
   pasted on rather than merely dark.

   Two independent causes, both fixed on the AFTER side:

     1. SIZE / SHAPE. systems/wounds.js's creatureBiteChunk had exactly one
        answer for every part it found: shrink it, cap the cut with a slab
        scaled to that part's own cross-section. An orca's body is not a pile
        of boxes — city/wildlife_orca.js builds ONE hull mesh spanning local
        x -2.35..3.25 — so every bite found the hull and capped it with a
        five-metre rectangle. (The long-axis test only ever compared y against
        z, so the animal's LENGTH was treated as a cross-section.) Now the
        trunk is never dismembered: a bite tears a JAW-SIZED crater, seated by
        raycast on the hull's real surface, built from three jittered boxes so
        the silhouette is ragged instead of rectangular.

     2. COLOUR / OCCLUSION. world/water_spec.js does not paint submerged
        bodies from outside; it hands each rig VEILED TWINS of its materials
        at spawn (CBZ.waterVeilApply) that attenuate toward the water colour
        over the real eye-to-fragment water column. A wound is created
        mid-fight, long after spawn, so it never met that pass and rendered at
        full unattenuated sunlit maroon inside a body that fades into the sea.
        Every cut material now goes through CBZ.waterVeilMaterial on the way
        in, so the wound is inside the same water as the animal.

   And the blood was staged: an outward-normal burst at the wound, ONE chum
   trail per animal instead of one per hole (they were competing for gore.js's
   twelve handles), and a real kill cloud when something dies underwater.

   BOTH COLUMNS RUN THIS SAME DRIVER. The BEFORE side is pristine HEAD served
   on its own port; the AFTER side is the working tree. Every bite, position,
   camera and sim step below is identical on both — the only variable is the
   code under it. The wound measurements at the bottom are taken by THIS file
   out of the live scene graph, so both sides are measured by one ruler. */

const subjects = [
  {
    id: "orca-flank-surface", ch: 0,
    label: "The Owner's Shot — A Bitten Orca From Above The Water",
    focus: "The exact angle of the report: a mauled orca just under the surface, seen from above it. BEFORE: an opaque maroon plank lying down the flank, as long as the animal and untouched by the water between it and the lens. AFTER: three jaw-sized craters torn into the hull, ragged, and veiled by the same water column that fades the body — a hole IN the animal, not a plate ON it.",
  },
  {
    id: "orca-flank-under", ch: 1,
    label: "Same Body, From Underneath — The Plume",
    focus: "The same wounds from in the water with the player's own shark. BEFORE: the slab again, plus one symmetrical puff of blood around the body's centre. AFTER: the burst leaves the flank along the wound's outward normal and the trailing haze is still hanging where the animal was.",
  },
  {
    id: "bite-strip", ch: 2, strip: { frames: 4, stepSec: 0.5 },
    label: "One Bite, Two Seconds — Strike, Bloom, Trailing Haze",
    focus: "Four frames of the same two seconds of a landed bite. The staging is the difference: a dense cloud at the wound that billows and drifts with the current, then thins into a trail the wounded animal drags behind it, with the surface slick building overhead the whole time.",
  },
  {
    id: "kill-cloud", ch: 3,
    label: "The Kill Payoff — Something Died Down Here",
    focus: "The moment the orca dies. BEFORE: a death underwater produced exactly the same puff as a nick — the wound stops, and that is the whole event. AFTER: gore.js's kill cloud — full burst, a slow haze SHELL seeded around the corpse that is still there when you swim back, and a slick on the surface directly above it.",
  },
  {
    id: "land-wound", ch: 4,
    label: "Regression — A Dry-Land Bite, Unchanged",
    focus: "The same shared materials and the same seat code serve land wounds. A land animal bitten on the beach must come out of this looking no worse: a jaw-sized dark wound on its flank, no water veil, and no blood plume (the old code fired goreBloom on land bites too, where its puffs were clamped to sea level and spent capped pool slots on clouds nobody could ever see).",
  },
];

async function stageMarineGore(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv || !CBZ.creatureBiteChunk) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__marineGore;
  if (!D) {
    D = window.__marineGore = {
      chapter: -1, waterline: 0, pinned: [], orca: null, land: null, spot: null,

      /* Anything staged has to stay staged: the sim keeps running between the
         bite and the capture (that is how the plume evolves), and an orca
         that swims off takes its wounds with it and leaves the blood behind.
         Re-written on both sides of every tick so no system gets the last
         word on where these bodies are. */
      hold() {
        for (let i = 0; i < D.pinned.length; i++) {
          const p = D.pinned[i], a = p.a;
          if (!a) continue;
          if (a.pos) { a.pos.x = p.x; a.pos.y = p.y; a.pos.z = p.z; }
          if (a.group) { a.group.position.set(p.x, p.y, p.z); }
          if (p.h != null) {
            a.heading = p.h;
            if (a.group && CBZ.faceAnimalHeading) { try { CBZ.faceAnimalHeading(a.group, p.h); } catch (e) {} }
          }
          if (a._waterMove) { a._waterMove.x = p.x; a._waterMove.z = p.z; }
          if (a.group) a.group.updateMatrixWorld(true);
        }
      },
      pin(a, x, y, z, h) { D.pinned.push({ a: a, x: x, y: y, z: z, h: h }); D.hold(); },
      step(n) { for (let i = 0; i < n; i++) { D.hold(); CBZ.stepSim(1 / 30); D.hold(); } },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },

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
        /* From here the match advances ONLY when a chapter steps it. Killing
           the page's frame loop is what lets a detached tripod survive to the
           capture; the render hook below draws each frame explicitly.
           (Straight out of tools/visual-presets/shark-sim.mjs, including the
           drain of the one already-queued callback — left alive it re-stamps
           the camera at an arbitrary later compositor tick.) */
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

      depth(x, z) { return CBZ.survFloodDepthMeanAt ? Math.max(0, CBZ.survFloodDepthMeanAt(x, z)) : 0; },
      playerAngle() {
        const A = CBZ.surv.arena, P = CBZ.player;
        return Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
      },
      ringPoint(ang, r) {
        const A = CBZ.surv.arena;
        return { x: A.center.x + Math.cos(ang) * r, z: A.center.z + Math.sin(ang) * r };
      },
      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : 0; },
      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
        cam.updateMatrixWorld(true);
      },
      camYawAlong(h) { return Math.atan2(-Math.cos(h), -Math.sin(h)); },

      /* Everything that is not this experiment goes away: a pod converging on
         the player mid-capture would bite the same orca with its own timing
         and the two columns would stop being the same photograph. */
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (a.dead || !a.species) continue;
          if (CBZ.sharkSim && a === CBZ.sharkSim.shark) continue;
          if (a === D.orca) continue;
          if (a.species.id === "orca" || (a.species.aquatic && (a.species.bite || 0) >= 24)) {
            a.pos.x += 900; a.hunger = 0;
            if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
          }
        }
        if (CBZ.sharkSim) {
          const S = CBZ.sharkSim.shark;
          if (S) S.hp = S.maxHp;
          CBZ.sharkSim.podT = 900;
        }
        const f = document.getElementById("sharkflash");
        if (f) { f.style.transition = "none"; f.style.opacity = "0"; }
      },

      /* THE SUBJECT. One orca, held just under the surface a fixed distance
         off the player's shark, pinned for the rest of the run. Deliberately
         NOT the pod's own orca: a staged animal at a staged depth is the only
         way both columns photograph the same body. */
      /* WHERE THE WATER ACTUALLY IS. The first run of this preset staged the
         orca on a bearing off the shark's nose and got a spot that
         CBZ.cityWaterAt calls DRY — over the island's shelf — so the whole
         medium chain (predatorMedium -> goreMedium) answered "air", the AFTER
         side correctly declined to put a plume in the sea, and the frame came
         back with a bitten animal and no blood. The staging was wrong, not the
         gate. So the spot is now SEARCHED for: walk outward along the ring
         until the game's own water oracle says yes and there is real depth
         under it, and refuse to stage at all if there is nowhere. */
      openWater(ang) {
        for (let r = D.waterline + 18; r < D.waterline + 150; r += 6) {
          const p = D.ringPoint(ang, r);
          const wet = CBZ.cityWaterAt ? CBZ.cityWaterAt(p.x, p.z) : true;
          const dep = CBZ.cityWaterDepthAt ? CBZ.cityWaterDepthAt(p.x, p.z) : D.depth(p.x, p.z);
          if (wet && dep > 7) return { x: p.x, z: p.z, depth: dep, r: r };
        }
        return null;
      },
      stageOrca() {
        const P = CBZ.player, ang = D.playerAngle();
        const found = D.openWater(ang) || D.openWater(ang + 1.2) || D.openWater(ang - 1.2);
        if (!found) return null;
        D.water = found;
        const at = { x: found.x, z: found.z };
        P.pos.x = at.x; P.pos.z = at.z;
        D.step(4);
        const sy = D.seaY(at.x, at.z);
        // thirteen metres FURTHER OUT TO SEA than the shark, so the orca is
        // guaranteed to be in water at least as deep as the searched spot
        const seaward = D.ringPoint(ang, found.r + 13);
        const ox = seaward.x, oz = seaward.z;
        const h = Math.atan2(oz - at.z, ox - at.x);
        CBZ.sharkSim.shark.heading = h;
        let o = null;
        for (const a of CBZ.cityWildlife || []) {
          if (a && !a.dead && !a.external && !a.ridden && a.species && a.species.id === "orca") { o = a; break; }
        }
        if (!o && CBZ.cityWildlifeSpawnAt) o = CBZ.cityWildlifeSpawnAt("orca", ox, oz);
        if (!o) return null;
        o.hunger = 0; o.hp = o.maxHp || o.hp;
        D.orca = o;
        D.spot = { x: ox, y: D.seaY(ox, oz) - 1.15, z: oz, sy: sy };
        D.pin(o, D.spot.x, D.spot.y, D.spot.z, h + Math.PI * 0.5);   // broadside
        D.step(2);
        D.hold();
        return o;
      },

      /* THE BITES. Fired at real flank points measured off the animal's own
         world bounding box, with the jaw a player megalodon actually carries
         (wildlife_tame.js passes biteReach * 0.38 into the same call). The
         camera is put on the wound FIRST because creatureBiteChunk refuses
         outside a 45 m band on both sides. */
      maulOrca(n) {
        const o = D.orca; if (!o) return 0;
        o.group.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(o.group);
        const c = box.getCenter(new T.Vector3()), s = box.getSize(new T.Vector3());
        const h = o.heading || 0, fx = Math.cos(h), fz = Math.sin(h);
        const L = Math.max(s.x, s.z), beam = Math.min(s.x, s.z);
        // the near flank: the side the tripod and the shark both look from
        const nx = -fz, nz = fx;
        const camx = CBZ.camera ? CBZ.camera.position.x : c.x;
        const camz = CBZ.camera ? CBZ.camera.position.z : c.z + 10;
        const side = ((camx - c.x) * nx + (camz - c.z) * nz) >= 0 ? 1 : -1;
        /* AFT OF THE PECTORALS, ON THE FLANK. The first run aimed at the
           widest part of the beam and every bite found a FIN instead: partAt
           breaks ties toward the SMALLER part ("a jaw that closes across a
           tail and a flank at the same range took the tail"), so a bite level
           with the pectorals takes a pectoral. The owner's screenshot is a
           wound on the BODY, so aim at the clear run of hull between the
           dorsal and the tail stock, low on the flank. */
        let hits = 0;
        for (let i = 0; i < n; i++) {
          const along = -L * (0.16 + i * 0.10);
          const px = c.x + fx * along + nx * side * beam * 0.42;
          const pz = c.z + fz * along + nz * side * beam * 0.42;
          const py = c.y - (0.06 + (i % 2) * 0.10) * s.y;
          let ok = false;
          try {
            ok = CBZ.creatureBiteChunk(o, { x: px, y: py, z: pz },
              { jaw: 1.05, sev: 0.85, bleedS: 16 });
          } catch (e) { ok = false; }
          if (ok) hits++;
          o.group.updateMatrixWorld(true);
        }
        return hits;
      },

      /* THE RULER, and it is this file's own so both columns are measured by
         one instrument. Every wound mesh the seat code parents into a rig
         carries `_tornCap`; its matrixWorld columns already hold its own scale
         times every parent's, so their lengths ARE the box's world extents —
         rotation-invariant, which an axis-aligned Box3 would not be. */
      measure(root) {
        let n = 0, veiled = 0, span = 0;
        if (!root) return { n: 0, span: 0, veiled: 0 };
        root.updateMatrixWorld(true);
        root.traverse(function (o) {
          if (!o.isMesh || !o._tornCap) return;
          n++;
          const e = o.matrixWorld.elements;
          const a = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
          const b = Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]);
          const c = Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10]);
          const s = Math.max(a, Math.max(b, c));
          if (s > span) span = s;
          const m = o.material;
          if (m && m.userData && m.userData.cbzVeiled) veiled++;
        });
        return { n: n, span: span, veiled: veiled };
      },
      bodyLenOf(a) {
        if (CBZ.marineBodyLen) { const L = CBZ.marineBodyLen(a); if (L > 0) return L; }
        const b = new T.Box3().setFromObject(a.group), s = b.getSize(new T.Vector3());
        return Math.max(s.x, s.z);
      },
      // how much blood is actually in the water right now, near the wound
      bloodNear(x, z, r) {
        let n = 0;
        const r2 = r * r;
        CBZ.scene.traverse(function (o) {
          if (!o.isSprite || o.visible === false) return;
          const dx = o.position.x - x, dz = o.position.z - z;
          if (dx * dx + dz * dz <= r2) n++;
        });
        return n;
      },
      slicksNear(x, z, r) {
        let n = 0;
        const r2 = r * r, sy = D.seaY(x, z);
        CBZ.scene.traverse(function (o) {
          if (!o.isMesh || o.isSprite || !o.geometry) return;
          if (Math.abs(o.position.y - sy) > 0.5) return;
          if (Math.abs(o.rotation.x + Math.PI / 2) > 0.01) return;
          const dx = o.position.x - x, dz = o.position.z - z;
          if (dx * dx + dz * dz <= r2) n++;
        });
        return n;
      },
    };

    window.__cbzVisualCompare = {
      /* Awaited before every capture. Under SwiftShader the compositor takes
         over a second to PRESENT a rendered canvas, and a canvas rendered
         outside an animation frame is never presented at all — so render
         inside ONE borrowed real frame (the game's own chain is already dead,
         so lending RAF back for one callback cannot restart it) and then wait
         the compositor out. shark-sim.mjs paid for this lesson three runs
         over; it is copied here rather than rediscovered. */
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
      advance(sec) { D.sec(sec); },
    };
  }

  const out = {};
  const CH = [
    // 0 — the owner's shot: the flank from above the water
    async function surface() {
      if (!await D.boot()) throw new Error("sharksim never armed");
      D.peace();
      if (!D.stageOrca()) throw new Error("no orca to maul");
      const S = D.spot;
      /* THE LENS GOES ON THE WOUND BEFORE THE TEETH DO. creatureBiteChunk
         refuses outside a 45 m band ("a wound nobody can look at is a cap
         mesh and a chum source bought for nothing") on both sides, and the
         detached tripod is what dist2Cam reads. */
      D.tripod(S.x - 9.5, S.sy + 7.2, S.z + 6.5, S.x, S.y + 0.3, S.z);
      out.woundsLanded = D.maulOrca(3);
      if (!out.woundsLanded) throw new Error("no bite landed on the orca");
      D.sec(1.1);                                   // the blood gets into the water
      D.tripod(S.x - 9.5, S.sy + 7.2, S.z + 6.5, S.x, S.y + 0.3, S.z);
      const m = D.measure(D.orca.group), L = D.bodyLenOf(D.orca);
      out.woundSpanM = Number(m.span.toFixed(2));
      out.woundVsBodyPct = Number(((m.span / Math.max(0.5, L)) * 100).toFixed(1));
      out.woundsVeiled = m.veiled;
      out.woundMeshes = m.n;
      out.surfaceSlicks = D.slicksNear(S.x, S.z, 16);
      out.bloodPuffs = D.bloodNear(S.x, S.z, 22);
      // the medium chain, printed, because the first run of this preset staged
      // the animal somewhere the game calls dry and the frame told me nothing
      D.medium = {
        cityWaterAt: CBZ.cityWaterAt ? !!CBZ.cityWaterAt(S.x, S.z) : null,
        depthM: CBZ.cityWaterDepthAt ? Number(CBZ.cityWaterDepthAt(S.x, S.z).toFixed(1)) : null,
        goreMedium: CBZ.goreMedium ? CBZ.goreMedium(S.x, S.y, S.z) : null,
        seaY: Number(S.sy.toFixed(2)), woundY: Number(S.y.toFixed(2)),
        translucent: CBZ.seaTranslucentOn ? !!CBZ.seaTranslucentOn() : null,
        veilFn: typeof CBZ.waterVeilMaterial === "function",
      };
    },
    // 1 — the same body from in the water, through the game's own camera
    async function under() {
      const S = D.spot, P = CBZ.player, SH = CBZ.sharkSim.shark;
      const h = Math.atan2(S.z - P.pos.z, S.x - P.pos.x);
      P.pos.x = S.x - Math.cos(h) * 11; P.pos.z = S.z - Math.sin(h) * 11;
      P.pos.y = S.y - 0.6;
      if (SH) { SH.heading = h; if (SH.pos) SH.pos.y = S.y - 0.6; }
      if (CBZ.cam) { CBZ.cam.yaw = D.camYawAlong(h); CBZ.cam.pitch = 0.06; }
      D.step(3);
      /* The tripod goes down LAST. Stepping is what tells world/
         water_underwater.js the lens is submerged (it reads the camera on the
         tick), and the player's shark is already down here — so the frame
         keeps the real underwater grading while the lens moves off the chase
         camera's shoulder and onto the wound, which the chase camera framed
         at the edge of the plate. */
      D.tripod(S.x - Math.sin(h) * 9.5, S.y + 1.1, S.z + Math.cos(h) * 9.5, S.x, S.y, S.z);
      out.bloodPuffs = D.bloodNear(S.x, S.z, 22);
      const m = D.measure(D.orca.group);
      out.woundSpanM = Number(m.span.toFixed(2));
      out.woundsVeiled = m.veiled;
    },
    // 2 — the strip: one more bite, then two seconds of it in the water
    async function strip() {
      const S = D.spot;
      D.hold();
      out.woundsLanded = (out.woundsLanded || 0) + D.maulOrca(1);
      out.bloodPuffs = D.bloodNear(S.x, S.z, 22);
    },
    // 3 — the kill
    async function kill() {
      const S = D.spot, o = D.orca;
      const h = (CBZ.sharkSim.shark.heading || 0);
      D.sec(0.6);
      o.hp = 0; o.dead = true;
      D.sec(0.9);                                   // the payoff has to land
      // a wider, lower shot than the wound frames: a kill cloud is a volume,
      // and it wants the corpse small enough that the cloud has somewhere to be
      D.tripod(S.x - Math.sin(h) * 15, S.y + 3.4, S.z + Math.cos(h) * 15, S.x, S.y - 0.6, S.z);
      out.bloodPuffs = D.bloodNear(S.x, S.z, 26);
      out.surfaceSlicks = D.slicksNear(S.x, S.z, 20);
    },
    // 4 — the land regression
    async function land() {
      const ang = D.playerAngle() + 1.05;
      const at = D.ringPoint(ang, Math.max(4, D.waterline - 26));
      let id = null;
      const want = ["wolf", "boar", "deer", "bear", "coyote", "goat", "cow", "horse"];
      const SP = CBZ.WILDLIFE_SPECIES || {};
      for (let i = 0; i < want.length && !id; i++) if (SP[want[i]] && !SP[want[i]].aquatic) id = want[i];
      if (!id) for (const k in SP) { if (SP[k] && !SP[k].aquatic && SP[k].build) { id = k; break; } }
      if (!id || !CBZ.cityWildlifeSpawnAt) throw new Error("no land species to bite");
      const a = CBZ.cityWildlifeSpawnAt(id, at.x, at.z);
      if (!a) throw new Error("land spawn refused: " + id);
      const gy = CBZ.surv.floorAt ? CBZ.surv.floorAt(at.x, at.z) : 0;
      a.hunger = 0;
      D.land = a;
      D.pin(a, at.x, gy, at.z, ang + Math.PI * 0.5);
      D.step(3);
      D.hold();
      a.group.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(a.group);
      const c = box.getCenter(new T.Vector3()), s = box.getSize(new T.Vector3());
      const back = 2.4 + Math.max(s.x, s.z) * 1.3;
      D.tripod(c.x - back, c.y + 1.5, c.z + back * 0.8, c.x, c.y, c.z);
      const before = D.bloodNear(c.x, c.z, 30);
      try {
        CBZ.creatureBiteChunk(a, { x: c.x, y: c.y + s.y * 0.12, z: c.z + Math.min(s.x, s.z) * 0.5 },
          { jaw: 0.34, sev: 0.8, bleedS: 10 });
      } catch (e) {}
      a.group.updateMatrixWorld(true);
      D.tripod(c.x - back, c.y + 1.5, c.z + back * 0.8, c.x, c.y, c.z);
      const m = D.measure(a.group), L = Math.max(s.x, s.z);
      out.landWoundSpanM = Number(m.span.toFixed(2));
      out.landWoundVsBodyPct = Number(((m.span / Math.max(0.4, L)) * 100).toFixed(1));
      // a land bite has no business putting blood plumes in the sea
      out.landSeaPuffs = Math.max(0, D.bloodNear(c.x, c.z, 30) - before);
      out.species = id;
    },
  ];

  while (D.chapter < sub.ch) {
    D.chapter++;
    await CH[D.chapter]();
  }

  await window.__cbzVisualCompare.render();
  const audit = (typeof CBZ.creatureBiteChunkAudit === "function") ? CBZ.creatureBiteChunkAudit() : null;
  return {
    ok: true, side: input.side, chapter: sub.ch,
    debug: {
      state: CBZ.game.state, mode: CBZ.game.mode,
      water: D.water || null, medium: D.medium || null,
      chunkAudit: audit,
      chumSources: (CBZ.goreChumList && CBZ.goreChumList()) ? CBZ.goreChumList().length : null,
      killCloud: typeof CBZ.goreKillCloud === "function",
    },
    metrics: out,
  };
}

export default {
  id: "marine-gore",
  title: "Marine Gore — The Wound Is A Hole, Not A Plank",
  description: "Five beats of the same mauled orca on the disaster island, photographed in Shark Sim on both sides. BEFORE is pristine HEAD; AFTER is the working tree; the driver, the animal, the bite points, the jaw size, the sim steps and the cameras are byte-identical between them. The failure the owner photographed is in frame one: a bite on an orca found the animal's single hull mesh, shrank it, and capped the cut with a slab scaled to that hull's own cross-section — a five-metre opaque maroon rectangle lying down the flank of a body that the sea otherwise renders as a translucent silhouette, because a wound created mid-fight never met the spawn-time pass that hands a rig its water-veiled materials. After: the trunk is never dismembered, a bite tears a jaw-sized crater seated by raycast on the hull's real surface out of three jittered boxes, and every cut material is fetched through CBZ.waterVeilMaterial so the wound sits in the same water as the animal. The blood is staged behind it — an outward-normal burst at the wound, one chum trail per animal instead of one per hole, and a real kill cloud when something dies down there.",
  beforeLabel: "BEFORE · pristine HEAD",
  afterLabel: "AFTER · working tree",
  pairNote: "Same island · same seed · same orca · same bite points · same jaw · same cameras",
  method: "Both columns boot index.html into ?mode=sharksim with a pinned seed and click the Shark Sim tile + PLAY exactly like a player. A per-page driver freezes the frame loop, quiets the pod, stages ONE orca at a fixed point just under the surface, and mauls it through the production CBZ.creatureBiteChunk with the jaw a player megalodon actually carries. The camera is placed on the wound before the teeth land because that call refuses outside a 45 m band on both sides. The wound measurements are taken by the preset itself out of the live scene graph — every wound mesh carries a `_tornCap` flag, and the world extents come from its matrixWorld columns so a rotated box is measured honestly — which means both columns are read by one ruler rather than by each build's own audit.",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 300000,
  metrics: {
    woundSpanM: { label: "Widest single wound mesh on the orca", unit: "m", better: "lower" },
    woundVsBodyPct: { label: "That wound as a share of the animal's own length", unit: "%", better: "lower" },
    woundsVeiled: { label: "Wound meshes whose material joins the water veil", better: "higher" },
    bloodPuffs: { label: "Blood in the water within 22 m of the wound", better: "higher" },
    surfaceSlicks: { label: "Slicks on the surface above the kill", better: "higher" },
    landWoundVsBodyPct: { label: "Land regression: wound as a share of that animal's length", unit: "%", better: "lower" },
    landSeaPuffs: { label: "Land regression: sea-clamped blood puffs spawned by a DRY bite", better: "lower" },
  },
  metricsNote: "woundVsBodyPct is the whole report in one number: a wound that is most of the animal is the plank, a wound that is a fifth of it is a bite. landSeaPuffs is the regression guard the other direction — the old code fired goreBloom on land bites too, and gore.js clamps every puff to the sea surface as a lid, so a bite in a forest spent capped pool slots on clouds sitting at y=0 under the terrain.",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.creatureBiteChunk && CBZ.goreBloom && CBZ.cityWildlifeSpawnAt && CBZ.WILDLIFE_SPECIES && document.getElementById('playBtn')",
  subjects,
  stage: stageMarineGore,
};
