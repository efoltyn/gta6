/* Shark Sim — water entry is a load history, not a splash clip.

   A/B is deliberately SELF-CHECKOUT. BEFORE sets WATER_ENTRY_PHYSICS=0 and
   runs the exact pre-pass branches: whole body mass at nose contact, authored
   flank-roll curve, trajectory that follows airborne steering, fixed 34% / 78%
   landing bleeds, and a sine sea untouched by the impact. AFTER enables the
   coupled entry law in the same files.

   Twenty-eight matched plates follow two complete megalodon entries and one
   shallow dive. The first is a straight, steep spear entry. The second takes
   the same run-up and then holds a hard air turn, exposing the body to the
   surface. The last five plates prove that a quick dive tap leaves momentum and
   naturally recovers instead of stopping on key-up. The final plate fires both
   measured entry profiles side-by-side at identical mass and speed.

   The stage function is serialized into the page. Keep every dependency inside
   stageSharkEntryPhysics; module constants are report-only.
*/

const subjects = [
  { id: "clean-cruise", ch: 0, label: "01 · Clean Run-Up — mass below the surface", focus: "The megalodon is already massive, but mass alone is not a splash. It carries speed below the live swell before the rise input. AFTER, the water state is still one shared height field; nothing is pre-played just because a jump is coming." },
  { id: "clean-rise", ch: 1, label: "02 · Rise Input — acceleration, not a vertical clip", focus: "A few fixed steps after rise is pressed. AFTER, input accelerates the body and the pitch follows the measured velocity. BEFORE, the vertical controller chases a target velocity. This is the small motion that makes the later entry angle believable." },
  { id: "clean-exit", ch: 2, label: "03 · Nose Exit — the surface opens where geometry crosses", focus: "The nose has just broken through. The frame is selected by the actor's waterline tracker, not a timer. Exit remains a travelling flank curtain on both sides; it is the control that proves the entry repair did not erase the launch." },
  { id: "clean-clear", ch: 3, label: "04 · Fully Clear — water shedding from the actual body", focus: "The drawn rig's lowest point is above the live surface. Water trails from nose to tail and inherits the real velocity. No splash card is attached to the camera or body origin." },
  { id: "clean-apex", ch: 4, label: "05 · Straight Apex — no decorative barrel roll", focus: "AFTER, a straight run-up carries nearly zero angular momentum, so the animal does not perform the same authored 24-degree roll every jump. BEFORE, the roll curve peaks because elapsed arc time says it should." },
  { id: "clean-descent", ch: 5, label: "06 · Aligned Descent — velocity and nose agree", focus: "The high entry is steep and velocity-aligned. This is the Olympic-diver condition: a huge body and high energy, but a small projected section at first contact. The energy will travel into a narrow cavity rather than all erupting upward." },
  { id: "clean-nose", ch: 6, label: "07 · Clean Nose Contact — only a cut", focus: "The nose touches. AFTER, first contact is a tight cut and a small local dent in the canonical sea; the whole shark has not magically entered yet. BEFORE, this instant spends the entire body mass on a full crown." },
  { id: "clean-shoulders", ch: 7, label: "08 · Clean Shoulders — force grows with wetted section", focus: "Eighteen percent of the tapered hull is wet. AFTER, this widening shoulder is where the one load event occurs, sized by the live projected-area solve. It is narrow because the body is still aligned." },
  { id: "clean-midbody", ch: 8, label: "09 · Clean Mid-Body — the zipper travels", focus: "Half the body has passed through. Spray is emitted from the moving surface intersection and swells with local girth. The shark and water exchange momentum section by section instead of triggering a pop and ignoring each other." },
  { id: "clean-tail", ch: 9, label: "10 · Clean Tail — the entry has a physical end", focus: "The tail completes the crossing. The surface impulse is now travelling outward and the clean entry has retained most of its plunge speed. The tail flick is a coda, not a second whole-body splash." },
  { id: "clean-collapse", ch: 10, label: "11 · Clean Cavity Collapse — delayed for a reason", focus: "A quarter-second later. The local depression closes and the rebound follows the cavity. This delay is a consequence of the surface response, unlike the old splash simply arriving after the shark." },
  { id: "clean-seethe", ch: 11, label: "12 · Clean Recovery — bubbles reveal the hidden energy", focus: "The narrow surface has calmed, then aerated foam returns from below. A clean high dive makes less immediate splash, not less energy; it penetrates deeper and leaves a delayed seething signature." },

  { id: "bad-launch", ch: 12, label: "13 · Bad Entry Setup — same shark, same run-up", focus: "A second megalodon starts from the same depth and speed. The only new decision comes after takeoff: a hard lateral input in the air. This locks the experiment to angle rather than mass." },
  { id: "bad-rotate", ch: 13, label: "14 · Air Rotation — body turns, trajectory does not", focus: "AFTER, the body can reorient with bounded angular momentum but the ballistic path keeps its launch bearing; there is no water in the air to curve it. BEFORE, steering turns body and trajectory together, hiding the misalignment." },
  { id: "bad-apex", ch: 14, label: "15 · Turning Apex — projected area is being created", focus: "The same body reaches the top while still rotating. This is not a random canned roll: the visible attitude is the integral of the player's air input and the turn carried off the surface." },
  { id: "bad-descent", ch: 15, label: "16 · Misaligned Descent — the flank is coming", focus: "The velocity vector points into the sea while the long body no longer points along it. The live profile now reports far more projected area and added-mass coupling than the clean descent." },
  { id: "bad-nose", ch: 16, label: "17 · Bad First Contact — the warning cut", focus: "The first point touches. AFTER still refuses to spend the whole animal at the nose, but the wider, misaligned geometry already throws a rougher cut and opens a broader local cavity." },
  { id: "bad-shoulders", ch: 17, label: "18 · Broadside Shoulder Slam — the massive splash", focus: "The same shoulder threshold as plate 08. AFTER, low entry quality and high projected area dump far more momentum upward and outward: the wide sheet the massive animal deserves when it hits badly." },
  { id: "bad-midbody", ch: 18, label: "19 · Bad Mid-Body — water brakes the shark", focus: "Half the hull is wet. The broad entry loses far more speed to incremental added water than the spear entry did. The visible sheet and the body reaction are two consumers of one coupling number." },
  { id: "bad-tail", ch: 19, label: "20 · Bad Tail — a churned surface, not a clean hole", focus: "The crossing finishes amid wide whitewater. Compare plate 10: identical animal, comparable speed, very different angle and therefore a very different surface answer." },
  { id: "bad-collapse", ch: 20, label: "21 · Bad Collapse — broad cavity and returning sheet", focus: "The damaged surface closes over a much wider footprint. The displaced sea itself carries the depression and outgoing crest; foam geometry no longer has to pretend the base surface reacted." },
  { id: "bad-whitewater", ch: 21, label: "22 · Bad Recovery — the scar outlives the impact", focus: "Seconds later, the broad landing still owns a downrange whitewater scar. This persistence is driven by the event scale; it is not the same short splash animation stretched over every shark." },

  { id: "dive-tap", ch: 22, label: "23 · Shallow Dive Tap — momentum begins", focus: "A brief dive input under forward speed. AFTER, the key applies acceleration and the body pitches onto the resulting velocity vector. This is the small everyday motion that previously felt like an animation cue." },
  { id: "dive-release", ch: 23, label: "24 · Key Released — the shark is still descending", focus: "Four frames after release. AFTER, downward momentum remains and hydrodynamic drag is already bending it. BEFORE, the target-velocity servo races the value directly back toward zero." },
  { id: "dive-reversal", ch: 24, label: "25 · Natural Reversal — lift wins smoothly", focus: "No rise key is pressed. Forward-speed lift and buoyancy overcome the remaining downward momentum, so the vertical velocity crosses zero continuously instead of a state transition playing a rise." },
  { id: "dive-rise", ch: 25, label: "26 · Natural Rise — no second animation owner", focus: "The body rises on the same velocity integration and its pitch follows. Sharks get weak speed-dependent lift; cetaceans get the same path plus stronger lung buoyancy. The surface clamp is only a contact reaction." },
  { id: "dive-settle", ch: 26, label: "27 · Surface Settle — motion ends at the real swell", focus: "The animal returns to its live surface envelope without popping through or snapping level. The local water height, vertical state, pose, and camera all read the same surface owner." },
  { id: "same-mass-scorecard", ch: 27, label: "28 · SAME MASS + SPEED — angle is the difference", focus: "A controlled physics plate: left is the measured clean profile, right is the measured bad profile, fired simultaneously with identical megalodon kilograms and speed. BEFORE the two splashes are the same. AFTER the aligned side cuts narrow while the broadside impact erupts." },
];

const readyExpression =
  "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && " +
  "CBZ.citySeaHeightAt && CBZ.cityMountedAnimal && CBZ.aquaticMountAudit && " +
  "CBZ.marineEntryProfile && CBZ.waterSurfaceImpulse && document.getElementById('playBtn')";

async function stageSharkEntryPhysics(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const RUN = 1 / 30, DEG = 57.29577951308232;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__sharkEntryPhysics;
  if (!D) {
    D = window.__sharkEntryPhysics = {
      chapter: -1, _rafOrig: null, shot: null, runTag: "", frame: 0,
      box: new T.Box3(), fx: [], m: {}, out: {},
      tripod(px, py, pz, tx, ty, tz) {
        const c = CBZ.camera; if (!c) return;
        c.position.set(px, py, pz); c.up.set(0, 1, 0);
        c.lookAt(new T.Vector3(tx, ty, tz)); c.updateMatrixWorld(true);
      },
      shoot(px, py, pz, tx, ty, tz) {
        D.shot = [px, py, pz, tx, ty, tz]; D.tripod(px, py, pz, tx, ty, tz);
      },
      reshoot() { if (D.shot) D.tripod(...D.shot); },
      tick() { CBZ.stepSim(RUN); D.frame++; D.reshoot(); },
      step(n) { for (let i = 0; i < n; i++) D.tick(); },
      sec(s) { D.step(Math.max(1, Math.round(s / RUN))); },
      until(fn, n, why) {
        for (let i = 0; i < n; i++) { D.tick(); if (fn()) return i; }
        throw new Error("stage timeout: " + why);
      },
      mount() { return CBZ.cityMountedAnimal ? CBZ.cityMountedAnimal() : null; },
      audit() { try { return CBZ.aquaticMountAudit() || {}; } catch (e) { return {}; } },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          D.mount() === CBZ.sharkSim.shark);
      },
      async boot() {
        for (let i = 0; i < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); i++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]'); if (mb) mb.click();
          const pb = document.getElementById("playBtn"); if (pb) pb.click();
          await sleep(120);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let i = 0; i < 120 && !D.armed(); i++) { CBZ.stepSim(RUN); await sleep(20); }
        if (!D.armed()) return false;
        D._rafOrig = window.requestAnimationFrame;
        const real = D._rafOrig;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((resolve) => real.call(window, resolve));
        D.wrapFx();
        return true;
      },
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (!a || a.dead || a === D.mount()) continue;
          if (a.pos) a.pos.x += 1600;
          if (a.group) { a.group.position.x += 1600; a.group.visible = false; }
          a.hunger = 0;
        }
        if (CBZ.sharkSim) { CBZ.sharkSim.podT = 9000; if (CBZ.sharkSim.shark) CBZ.sharkSim.shark.hp = CBZ.sharkSim.shark.maxHp; }
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        const flash = document.getElementById("sharkflash");
        if (flash) { flash.style.transition = "none"; flash.style.opacity = "0"; }
      },
      climbTo(tier) {
        for (let guard = 0; guard < 45 && CBZ.sharkSim.tier < tier; guard++) {
          const meal = { dead: true, hp: 0, maxHp: 1200, pos: { x: 0, y: 0, z: 0 } };
          CBZ.sharkSimBite("animal", meal, CBZ.sharkSim.shark); D.step(9);
        }
        CBZ.hitstop = 0; CBZ.slowmo = 0; D.step(35); CBZ.hitstop = 0; CBZ.slowmo = 0;
        return CBZ.sharkSim.tier;
      },
      sea(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : 0; },
      depth(x, z) { return CBZ.cityWaterDepthAt ? Math.max(0, CBZ.cityWaterDepthAt(x, z)) : 0; },
      deepSpot(minD, ang) {
        const A = CBZ.surv.arena;
        for (let r = A.radius; r < A.radius + 520; r += 4) {
          const x = A.center.x + Math.cos(ang) * r, z = A.center.z + Math.sin(ang) * r;
          if (D.depth(x, z) > minD) return { x, z, ang, d: D.depth(x, z) };
        }
        return null;
      },
      park(spot, heading) {
        const P = CBZ.player, a = D.mount();
        P.pos.x = spot.x; P.pos.z = spot.z;
        if (a) {
          if (a.pos) { a.pos.x = spot.x; a.pos.z = spot.z; }
          if (a.group) { a.group.position.x = spot.x; a.group.position.z = spot.z; a.group.visible = true; }
          if (a._waterMove) { a._waterMove.x = spot.x; a._waterMove.z = spot.z; }
          if (CBZ.marineWaterlineReset) CBZ.marineWaterlineReset(a);
        }
        if (CBZ.cityMountedHeading) CBZ.cityMountedHeading(heading);
        if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(-Math.cos(heading), -Math.sin(heading)); CBZ.cam.pitch = 0.04; }
        D.keys({}); D.step(8);
      },
      keys(o) {
        o = o || {}; const K = CBZ.keys || (CBZ.keys = {});
        K.w = !!o.w; K.s = !!o.s; K.a = !!o.a; K.d = !!o.d;
        K.shift = !!o.shift; K[" "] = !!o.rise; K.control = !!o.dive;
      },
      bodyLen() { const a = D.mount(); try { return +CBZ.marineBodyLenLive(a) || 4; } catch (e) { return 4; } },
      bodyKg() { const a = D.mount(); try { return +CBZ.marineBodyKg(a) || 78; } catch (e) { return 78; } },
      bodyLow() {
        const a = D.mount(); if (!a || !a.group) return -99;
        D.box.setFromObject(a.group); return D.box.min.y - D.sea(a.group.position.x, a.group.position.z);
      },
      bodyHigh() {
        const a = D.mount(); if (!a || !a.group) return -99;
        D.box.setFromObject(a.group); return D.box.max.y - D.sea(a.group.position.x, a.group.position.z);
      },
      cut() {
        const a = D.mount(), g = a && a.group;
        if (!g) return { wet: 0, nose: 99, tail: 99, x: 0, z: 0, surf: 0 };
        const e = CBZ.marineBodyEnds ? CBZ.marineBodyEnds(a) : { fwd: D.bodyLen() * 0.5, aft: D.bodyLen() * 0.5 };
        /* Read the controller's canonical pitch, not the presentation group's
           Euler. The latter also contains attack pose and is written in the
           late render pass; sampling it between fixed simulation steps made
           the evidence tool occasionally call the tail the nose. */
        const rd = CBZ.cityAquaticRideDepths ? CBZ.cityAquaticRideDepths() : null;
        const p = rd && Number.isFinite(+rd.pitch) ? +rd.pitch : (g.rotation.z || 0);
        const h = CBZ.cityMountedHeading ? CBZ.cityMountedHeading() : (a.heading || 0);
        const cp = Math.cos(p), sp = Math.sin(p);
        const nx = g.position.x + Math.cos(h) * cp * e.fwd;
        const nz = g.position.z + Math.sin(h) * cp * e.fwd;
        const tx = g.position.x - Math.cos(h) * cp * e.aft;
        const tz = g.position.z - Math.sin(h) * cp * e.aft;
        const na = g.position.y + sp * e.fwd - D.sea(nx, nz);
        const ta = g.position.y - sp * e.aft - D.sea(tx, tz);
        let wet = 0, f = 0;
        if (na <= 0 && ta > 0) { f = ta / Math.max(1e-5, ta - na); wet = 1 - f; }
        else if (na <= 0 && ta <= 0) wet = 1;
        const x = tx + (nx - tx) * f, z = tz + (nz - tz) * f;
        return { wet, nose: na, tail: ta, x, z, surf: D.sea(x, z) };
      },
      frameBody(wide) {
        const a = D.mount(), g = a.group, L = D.bodyLen(), h = a.heading || 0;
        const side = h + Math.PI * 0.5, stand = (wide ? 1.35 : 0.95) * Math.max(15, L * 1.05);
        const sy = D.sea(g.position.x, g.position.z);
        D.shoot(g.position.x + Math.cos(side) * stand - Math.cos(h) * L * 0.12,
          sy + 4.2 + L * 0.13, g.position.z + Math.sin(side) * stand - Math.sin(h) * L * 0.12,
          g.position.x, g.position.y + L * 0.035, g.position.z);
      },
      frameEntry() {
        const a = D.mount(), L = D.bodyLen(), h = (D.m.entryHeading == null ? (a.heading || 0) : D.m.entryHeading);
        const q = D.m.entryPoint || { x: a.group.position.x, z: a.group.position.z, surf: D.sea(a.group.position.x, a.group.position.z) };
        const side = h + Math.PI * 0.5, stand = Math.max(17, L * 0.98);
        D.shoot(q.x + Math.cos(side) * stand - Math.cos(h) * L * 0.08,
          q.surf + 4.1 + L * 0.10, q.z + Math.sin(side) * stand - Math.sin(h) * L * 0.08,
          q.x, q.surf + 1.1 + L * 0.035, q.z);
      },
      wrapFx() {
        if (D._origFx) return;
        D._origFx = { hit: CBZ.waterHit, impulse: CBZ.waterSurfaceImpulse, crown: CBZ.waterCrown };
        if (typeof D._origFx.hit === "function") CBZ.waterHit = function (x, y, z, o) {
          const a = D.mount();
          if (!o || !o.src || o.src === a) {
            const featureOn = typeof CBZ.waterEntryPhysicsOn === "function"
              ? CBZ.waterEntryPhysicsOn()
              : !!(CBZ.CONFIG && CBZ.CONFIG.WATER_ENTRY_PHYSICS);
            /* V1 ignores entry/coupling options. Record what the impact bus
               actually consumes, so the controlled scorecard reads 1:1 in
               BEFORE rather than accidentally grading an unused V2 profile. */
            const coupling = featureOn && o && Number.isFinite(+o.coupling) ? +o.coupling : 1;
            const mass = +(o && o.mass) || 0, speed = +(o && o.speed) || 0;
            D.fx.push({ f: D.frame, tag: D.runTag, what: "hit", x, z, mass, speed, coupling,
              momentum: Math.sqrt(Math.max(0, mass)) * speed * coupling,
              quality: o && o.entry ? +o.entry.quality || 0 : null,
              area: o && o.entry ? +o.entry.area || 0 : null,
              phase: o && o.entry ? o.entry.phase || "entry" : "legacy" });
          }
          return D._origFx.hit.apply(this, arguments);
        };
        if (typeof D._origFx.impulse === "function") CBZ.waterSurfaceImpulse = function (x, z, o) {
          D.fx.push({ f: D.frame, tag: D.runTag, what: "surface", x, z,
            amplitude: +(o && o.amplitude) || 0, radius: +(o && o.radius) || 0 });
          return D._origFx.impulse.apply(this, arguments);
        };
        if (typeof D._origFx.crown === "function") CBZ.waterCrown = function (o) {
          D.fx.push({ f: D.frame, tag: D.runTag, what: "crown", h: +(o && o.h) || 0, r: +(o && o.r) || 0 });
          return D._origFx.crown.apply(this, arguments);
        };
      },
      startRun(tag) {
        D.runTag = tag; D.m[tag + "Fx0"] = D.fx.length;
        D.m[tag + "Y0"] = D.mount().group.position.y;
        D.m.entryPoint = null; D.m.entryHeading = null;
      },
      runHits(tag) { return D.fx.filter((e) => e.what === "hit" && e.tag === tag); },
      finishRun(tag) {
        const hits = D.runHits(tag), hit = hits.length ? hits[hits.length - 1] : null;
        const a = D.audit(), speed = Math.hypot(+a.speed || 0, +a.verticalSpeed || 0);
        D.out[tag + "Quality"] = hit && hit.quality != null ? +hit.quality.toFixed(3) : +(a.breachEntryQuality || 0).toFixed(3);
        D.out[tag + "Area"] = hit && hit.area != null ? +hit.area.toFixed(3) : +(a.breachEntryArea || 0).toFixed(3);
        D.out[tag + "Coupling"] = hit ? +hit.coupling.toFixed(3) : 0;
        D.out[tag + "Momentum"] = hit ? +hit.momentum.toFixed(1) : 0;
        D.out[tag + "PostSpeed"] = +speed.toFixed(2);
        D.out[tag + "Impulse"] = +(a.breachEntryImpulse || 0).toFixed(1);
        D.out[tag + "Retained"] = +(a.breachEntryRetained || 0).toFixed(3);
        D.out[tag + "SurfaceEvents"] = D.fx.filter((e) => e.what === "surface" && e.tag === tag).length;
        D.out[tag + "ShoulderHits"] = hits.length > 1 ? 1 : (hit && hit.phase === "shoulders" ? 1 : 0);
        return hit;
      },
    };

    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        if (!CBZ.renderer) return;
        const draw = () => { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {} };
        let drew = false;
        if (D._rafOrig) await new Promise((resolve) => {
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(); } };
          D._rafOrig.call(window, () => { draw(); drew = true; finish(); });
          setTimeout(finish, 1500);
        });
        if (!drew) draw();
        await sleep(900);
      },
    };
  }

  const CH = [
    async function cleanCruise() {
      if (!await D.boot()) throw new Error("Shark Sim did not arm");
      D.peace(); D.out.tier = D.climbTo(3); D.peace();
      const spot = D.deepSpot(32, 0.72); if (!spot) throw new Error("no deep clean-entry water");
      D.m.cleanSpot = spot; D.m.cleanHeading = spot.ang + Math.PI * 0.5;
      D.park(spot, D.m.cleanHeading);
      if (CBZ.waterSurfaceImpulseClear) CBZ.waterSurfaceImpulseClear();
      D.startRun("clean");
      D.keys({ w: true, shift: true, dive: true }); D.sec(0.48);
      D.keys({ w: true, shift: true }); D.sec(0.24); D.frameBody(false);
      D.out.bodyKg = Math.round(D.bodyKg()); D.out.bodyLenM = +D.bodyLen().toFixed(2);
    },
    async function cleanRise() { D.keys({ w: true, shift: true, rise: true }); D.step(4); D.frameBody(false); },
    async function cleanExit() {
      const a = D.mount(), t0 = a._wl ? a._wl.lastExitT : -99;
      D.until(() => a._wl && a._wl.lastExitT > t0, 180, "clean nose exit"); D.frameBody(false);
    },
    async function cleanClear() { D.until(() => D.bodyLow() > 0.12, 150, "clean body clear"); D.frameBody(true); },
    async function cleanApex() {
      D.keys({ w: true }); D.until(() => D.audit().verticalSpeed <= 0, 180, "clean apex"); D.frameBody(true);
      D.out.cleanApexM = +D.bodyHigh().toFixed(2); D.out.cleanRollDeg = +Math.abs(D.mount().group.rotation.x * DEG).toFixed(1);
    },
    async function cleanDescent() {
      D.until(() => D.audit().verticalSpeed < -1.45 && D.cut().nose > 0.45, 100, "clean descent");
      D.frameBody(true);
    },
    async function cleanNose() {
      const a = D.mount();
      D.until(() => D.cut().nose <= 0.12, 180, "clean nose contact");
      const c = D.cut(); D.m.entryPoint = { x: c.x, z: c.z, surf: c.surf }; D.m.entryHeading = a.heading || 0; D.frameEntry();
    },
    async function cleanShoulders() { D.until(() => D.cut().wet >= 0.18, 80, "clean shoulders"); D.frameEntry(); },
    async function cleanMid() { D.until(() => D.cut().wet >= 0.52, 100, "clean mid-body"); D.frameEntry(); },
    async function cleanTail() {
      D.until(() => { const a = D.mount(); return a._wl && a._wl.t === false && !a._wl.entry; }, 140, "clean tail");
      D.finishRun("clean"); D.frameEntry();
    },
    async function cleanCollapse() { D.keys({}); D.sec(0.25); D.frameEntry(); },
    async function cleanSeethe() { D.sec(0.72); D.frameEntry(); },

    async function badLaunch() {
      D.sec(3.5); if (CBZ.waterSurfaceImpulseClear) CBZ.waterSurfaceImpulseClear();
      const spot = D.deepSpot(32, 1.92); if (!spot) throw new Error("no deep bad-entry water");
      D.m.badSpot = spot; D.m.badHeading = spot.ang + Math.PI * 0.5;
      D.park(spot, D.m.badHeading); D.startRun("bad");
      D.keys({ w: true, shift: true, dive: true }); D.sec(0.48);
      D.keys({ w: true, shift: true }); D.sec(0.24);
      D.keys({ w: true, shift: true, rise: true });
      D.until(() => D.audit().airborne, 160, "bad launch"); D.frameBody(false);
    },
    async function badRotate() { D.keys({ d: true, shift: true }); D.step(12); D.frameBody(true); },
    async function badApex() {
      D.until(() => D.audit().verticalSpeed <= 0, 180, "bad apex"); D.frameBody(true);
      D.out.badApexM = +D.bodyHigh().toFixed(2); D.out.badRollDeg = +Math.abs(D.mount().group.rotation.x * DEG).toFixed(1);
    },
    async function badDescent() {
      D.until(() => D.audit().verticalSpeed < -1.35 && D.cut().nose > 0.35, 100, "bad descent");
      D.frameBody(true);
    },
    async function badNose() {
      const a = D.mount();
      D.until(() => D.cut().nose <= 0.12, 180, "bad nose contact");
      const c = D.cut(); D.m.entryPoint = { x: c.x, z: c.z, surf: c.surf }; D.m.entryHeading = a.heading || 0; D.frameEntry();
    },
    async function badShoulders() { D.until(() => D.cut().wet >= 0.18, 90, "bad shoulders"); D.frameEntry(); },
    async function badMid() { D.until(() => D.cut().wet >= 0.52, 100, "bad mid-body"); D.frameEntry(); },
    async function badTail() {
      D.until(() => { const a = D.mount(); return a._wl && a._wl.t === false && !a._wl.entry; }, 150, "bad tail");
      D.finishRun("bad");
      D.out.angleMomentumRatio = +(D.out.badMomentum / Math.max(0.01, D.out.cleanMomentum)).toFixed(2);
      D.out.angleAreaRatio = +(D.out.badArea / Math.max(0.01, D.out.cleanArea)).toFixed(2);
      D.frameEntry();
    },
    async function badCollapse() { D.keys({}); D.sec(0.25); D.frameEntry(); },
    async function badWhitewater() { D.sec(0.78); D.frameEntry(); },

    async function diveTap() {
      D.sec(3.5); if (CBZ.waterSurfaceImpulseClear) CBZ.waterSurfaceImpulseClear();
      const spot = D.deepSpot(24, 2.72); if (!spot) throw new Error("no dive water");
      D.m.diveSpot = spot; D.park(spot, spot.ang + Math.PI * 0.5); D.runTag = "dive";
      D.keys({ w: true, shift: true }); D.sec(1.2);
      D.m.diveY0 = D.mount().group.position.y;
      D.keys({ w: true, dive: true }); D.sec(0.30);
      D.out.diveTapVy = +D.audit().verticalSpeed.toFixed(2); D.frameBody(false);
    },
    async function diveRelease() {
      D.keys({ w: true }); D.out.diveReleaseVy = +D.audit().verticalSpeed.toFixed(2); D.step(4);
      D.out.diveFourFrameVy = +D.audit().verticalSpeed.toFixed(2); D.m.releaseFrame = D.frame; D.frameBody(false);
    },
    async function diveReversal() {
      let reversed = false;
      for (let i = 0; i < 180; i++) { D.tick(); if (D.audit().verticalSpeed >= 0) { reversed = true; break; } }
      D.out.diveReversalSec = reversed ? +((D.frame - D.m.releaseFrame) * RUN).toFixed(2) : 99;
      D.m.reverseY = D.mount().group.position.y; D.frameBody(false);
    },
    async function diveRise() {
      D.step(30); D.out.naturalRiseM = +(D.mount().group.position.y - D.m.reverseY).toFixed(2); D.frameBody(false);
    },
    async function diveSettle() {
      for (let i = 0; i < 180; i++) { D.tick(); if (Math.abs(D.audit().verticalSpeed) < 0.08 && D.cut().nose > -1.2) break; }
      D.keys({}); D.frameBody(false);
    },
    async function scorecard() {
      D.sec(2.5); if (CBZ.waterSurfaceImpulseClear) CBZ.waterSurfaceImpulseClear();
      const a = D.mount(), L = D.bodyLen(), kg = D.bodyKg(), g = a.group;
      const h = a.heading || 0, sx = -Math.sin(h), sz = Math.cos(h), sep = Math.max(13, L * 0.72);
      const cx = g.position.x, cz = g.position.z, sy = D.sea(cx, cz), speed = 16;
      const clean = CBZ.marineEntryProfile({ heading: h, pitch: Math.atan2(-15, 6), roll: 0,
        vx: Math.cos(h) * 6, vy: -15, vz: Math.sin(h) * 6, len: L });
      const bad = CBZ.marineEntryProfile({ heading: h + 1.18, pitch: -0.2, roll: 1.05,
        vx: Math.cos(h) * 6, vy: -15, vz: Math.sin(h) * 6, len: L });
      D.runTag = "score";
      CBZ.waterHit(cx + sx * sep * 0.5, sy, cz + sz * sep * 0.5, {
        kind: "vehicle", mass: kg, speed, coupling: clean.coupling,
        vx: Math.cos(h) * 6, vz: Math.sin(h) * 6, src: a,
        entry: { quality: clean.quality, area: clean.area, span: L, phase: "shoulders" } });
      CBZ.waterHit(cx - sx * sep * 0.5, sy, cz - sz * sep * 0.5, {
        kind: "vehicle", mass: kg, speed, coupling: bad.coupling,
        vx: Math.cos(h) * 6, vz: Math.sin(h) * 6, src: a,
        entry: { quality: bad.quality, area: bad.area, span: L, phase: "shoulders" } });
      const scoreHits = D.runHits("score").slice(-2);
      D.step(6);
      D.out.scoreCleanCoupling = +(scoreHits[0] ? scoreHits[0].coupling : 1).toFixed(3);
      D.out.scoreBadCoupling = +(scoreHits[1] ? scoreHits[1].coupling : 1).toFixed(3);
      D.out.scoreContrast = +(D.out.scoreBadCoupling / Math.max(0.001, D.out.scoreCleanCoupling)).toFixed(2);
      D.shoot(cx - Math.cos(h) * L * 0.25, sy + 26 + L * 0.45,
        cz - Math.sin(h) * L * 0.25, cx, sy, cz);
      D.m.scoreLabels = { cx, cz, sx, sz, sep };
    },
  ];

  while (D.chapter < sub.ch) { D.chapter++; await CH[D.chapter](); }

  let ov = document.getElementById("__entryPhysicsOverlay");
  if (!ov) {
    ov = document.createElement("div"); ov.id = "__entryPhysicsOverlay";
    ov.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f9fc;text-shadow:0 2px 10px #001018;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    ov.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-read></div><div data-left></div><div data-right></div>";
    document.body.appendChild(ov);
  }
  const put = (k, text, css) => { const el = ov.querySelector("[data-" + k + "]"); if (el) { el.textContent = text || ""; el.style.cssText = css; } };
  const before = input.side === "before", A = D.audit(), O = D.out;
  put("side", before ? input.beforeLabel : input.afterLabel,
    "position:absolute;top:18px;left:22px;padding:7px 11px;border-radius:7px;background:" + (before ? "#b84545" : "#177c57") + ";font-size:12px;font-weight:900;letter-spacing:.11em");
  put("name", sub.label, "position:absolute;top:56px;left:22px;font-size:24px;font-weight:850;letter-spacing:-.02em;max-width:760px");
  put("focus", sub.focus, "position:absolute;top:91px;left:20px;max-width:735px;padding:9px 12px;border-radius:8px;background:rgba(2,15,25,.66);font-size:12px;font-weight:620;line-height:1.38;color:#e0ecf3");
  const p = (D.mount() && D.mount()._wl && D.mount()._wl.entry) || null;
  const quality = p ? p.quality : A.breachEntryQuality, area = p ? p.area : A.breachEntryArea;
  put("read",
    "body " + Math.round(D.bodyKg()) + " kg · " + D.bodyLen().toFixed(1) + " m\n" +
    "entry quality " + (+quality || 0).toFixed(3) + " · area " + (+area || 0).toFixed(3) + "\n" +
    "coupling " + (p ? (+p.coupling || 0) : (+A.breachEntryCoupling || 0)).toFixed(3) +
      " · retained " + (+A.breachEntryRetained || 0).toFixed(3) + "\n" +
    "vy " + (+A.verticalSpeed || 0).toFixed(2) + " m/s · local surface events " +
      ((CBZ.waterSurfaceImpulseAudit && CBZ.waterSurfaceImpulseAudit().active) || 0),
    "position:absolute;right:20px;top:18px;padding:8px 10px;border-radius:8px;background:rgba(2,15,25,.7);color:#a8f0cb;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;text-align:right;line-height:1.48");
  if (sub.id === "same-mass-scorecard") {
    put("left", "CLEAN · aligned · coupling " + O.scoreCleanCoupling,
      "position:absolute;left:16%;bottom:40px;padding:8px 12px;border-radius:8px;background:rgba(12,74,104,.82);font-size:14px;font-weight:900");
    put("right", "BAD ANGLE · broadside · coupling " + O.scoreBadCoupling,
      "position:absolute;right:10%;bottom:40px;padding:8px 12px;border-radius:8px;background:rgba(128,55,28,.84);font-size:14px;font-weight:900");
  } else { put("left", "", ""); put("right", "", ""); }

  await window.__cbzVisualCompare.render();
  return {
    ok: true, side: input.side, chapter: sub.ch,
    debug: { configOn: !!(CBZ.CONFIG && CBZ.CONFIG.WATER_ENTRY_PHYSICS),
      cut: D.cut(), audit: A, impact: CBZ.waterImpactStats ? CBZ.waterImpactStats() : null,
      surface: CBZ.waterSurfaceImpulseAudit ? CBZ.waterSurfaceImpulseAudit() : null,
      recentFx: D.fx.slice(-18) },
    metrics: Object.assign({}, O),
  };
}

export default {
  id: "shark-entry-physics",
  title: "Shark Sim — 28 stages of real water entry: mass × speed × angle × wetted area",
  description:
    "Two complete megalodon entries, a shallow dive/recovery, and a same-mass physics plate. " +
    "BEFORE and AFTER are the same checkout, seed, island, progression, body, fixed time step, inputs and camera rules; " +
    "the before column only disables WATER_ENTRY_PHYSICS. The change replaces whole-mass-at-the-nose splashes, a decorative " +
    "air roll and fixed landing velocity bleeds with a live entry profile, incremental added-mass reaction, a shared local " +
    "surface cavity/pressure field, and hydrodynamic shallow-dive recovery. A clean high entry cuts narrowly and carries " +
    "energy below the surface; a misaligned entry by the identical shark throws a broad massive sheet and brakes hard.",
  beforeLabel: "BEFORE · whole-mass splash playback",
  afterLabel: "AFTER · coupled entry physics",
  pairNote: "Same checkout · same island · seed 90210 · same megalodon · same fixed steps · same input scripts · same camera rules",
  method:
    "The preset boots the real Shark Sim tile, climbs to megalodon through CBZ.sharkSimBite, freezes the ambient rAF loop, " +
    "and advances only fixed 1/30 s simulation steps. Every contact frame is selected from the actor's live nose/tail waterline " +
    "state and measured body box. The clean run holds the launch bearing; the bad run applies a hard lateral input only after " +
    "takeoff. The harness wraps waterHit, waterSurfaceImpulse and waterCrown from outside the implementation to record effective " +
    "surface momentum and event timing. The final plate sends both measured profiles through the shared impact bus with identical " +
    "mass and speed. Each pair is a separate PDF page so the entire load history can be inspected, not inferred from one money shot.",
  defaultBefore: "local",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0", cfg_WATER_ENTRY_PHYSICS: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0", cfg_WATER_ENTRY_PHYSICS: "1" },
  stageTimeoutMs: 900000,
  viewport: { width: 1280, height: 720 },
  subjects,
  readyExpression,
  stage: stageSharkEntryPhysics,
  metrics: {
    bodyKg: { label: "Megalodon source mass", unit: "kg" },
    bodyLenM: { label: "Megalodon measured length", unit: "m" },
    cleanMomentum: { label: "Clean entry effective surface momentum", better: "lower" },
    badMomentum: { label: "Bad-angle effective surface momentum", better: "higher" },
    angleMomentumRatio: { label: "Bad / clean surface-momentum contrast", better: "higher" },
    angleAreaRatio: { label: "Bad / clean projected-area contrast", better: "higher" },
    cleanRetained: { label: "Clean entry speed retained after incremental reaction", better: "higher" },
    badRetained: { label: "Bad entry speed retained after incremental reaction", better: "lower" },
    cleanSurfaceEvents: { label: "Clean entry local surface impulses", better: "higher" },
    badSurfaceEvents: { label: "Bad entry local surface impulses", better: "higher" },
    diveFourFrameVy: { label: "Vertical speed four frames after dive release", unit: "m/s", better: "lower" },
    diveReversalSec: { label: "No-input recovery arc before upward reversal", unit: "s", better: "higher" },
    naturalRiseM: { label: "No-input rise during the next second", unit: "m", better: "higher" },
    scoreContrast: { label: "Controlled same-mass bad / clean coupling contrast", better: "higher" },
  },
  metricsNote:
    "Momentum is sqrt(source kg) × speed × measured coupling, the scalar the shared impact bus uses for VFX and audio. " +
    "Coupling comes from velocity/body alignment, entry steepness, roll/pectoral exposure and projected area. BEFORE has no " +
    "angle term, so the controlled clean and bad entries collapse to the same result. Retained is accumulated from the stable " +
    "incremental solve v' = v/(1+dm_added/m_body). Dive reversal is measured with no rise input. Metrics establish the law; " +
    "the twenty-eight inspected image pairs establish whether that law reads as water rather than another animation.",
};
