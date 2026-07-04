/* ============================================================
   systems/wounds.js — THE BODY CARRIES THE HITS (universal gore).

   Shoot someone and the damage stays LEGIBLE on the rig:
     • WOUND DECALS: tiny dark entry-wound discs stamped on the exact body
       part at the exact hit point (world hit → part-local, snapped to the
       face the bullet came through, sitting slightly proud). ONE shared
       CircleGeometry + 3 shared unlit materials (fresh dark red → drying
       brown after ~12s; blunt hits leave a bruise-dark patch, no hole).
       Per-wound scale jitter so no two holes are identical.
     • LOCAL SOAK PATCH: an irregular dark stain SPREADS AROUND each entry
       wound over a few seconds — anchored to the wound, riding the same
       body part. Never a whole-garment recolor (the old clean→bloodied→
       soaked material ladder turned people maroon — DELETED). 3 shared
       blob geometries (per-vertex radial jitter baked at startup) + random
       spin + per-axis stretch keep any two stains from matching.
     • SEVERITY READS: headshot = wound at the head + a HEAVY insta-spread
       splatter on the head that runs down onto the collar (a second stain
       seated at the top of the shirt); a shotgun blast scatters 2-3 wounds
       (per-pellet calls collapse into one ≤3-wound burst); melee blunt =
       bigger bruise patch, no hole, no blood.

   Budget discipline (the game is draw-call bound):
     • hard caps: CITY 22 meshes per actor (a hit = wound + its soak stain,
       so ~11 readable hits — a riddled body reads genuinely shot up) / 320
       global; JAIL+SURVIVAL keep 10 per actor / 200 global byte-identical.
       Both recycle oldest-first (wounds keep ACCUMULATING — shooting a
       corpse adds holes — but stay bounded); a free-mesh pool so churn
       never reallocates (geometry/material reassigned on reuse — both
       shared, nothing cloned or disposed).
     • wounds are CHILDREN of the rig's part meshes → they animate, fall
       and despawn WITH the body for free; a throttled (0.8s) sweep frees
       records once a rig leaves the scene. Soak growth ticks per-frame
       ONLY while a stain is actively spreading (a few seconds per hit);
       the whole system sleeps when nobody is being shot (one early-out).
     • spawn distance-gated at 45u (matches gore.js's LOD band) so far
       NPC-vs-NPC scraps cost nothing.

   Public API:
     CBZ.bodyWound(actor, worldPoint, opts) — opts:
        { head:bool, cal|caliber:0.7..1.6, melee:"blunt"|"blade"|true,
          fromX, fromZ }  (fromX/Z bias a synthetic centre-point toward
          the attacker so the wound lands on the facing surface)
     CBZ.clearWounds() — also chained automatically onto CBZ.clearGore.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // CITY bodies should read as GENUINELY shot up — a riddled corpse carries
  // many holes (owner: "MORE bullet holes"). City raises the per-actor budget
  // (each readable hit = wound disc + its soak stain, so ~22 holes ≈ 11 hits)
  // and bumps the global cap modestly; jail/survival keep the original 10/200
  // byte-identical. Both stay LRU-recycled oldest-first so draw calls stay
  // bounded no matter how long the magdump runs.
  function cityWounds() { return !!(CBZ.game && CBZ.game.mode === "city"); }
  // global live-mesh cap (each is 1 tiny draw call) — now rides the quality tier,
  // read LIVE per check (the slider can move mid-run); fallback = old constants.
  function capBase() { return (CBZ.qScale ? CBZ.qScale(100, 400) : 200) | 0; }
  function capCity() { return (CBZ.qScale ? CBZ.qScale(160, 640) : 320) | 0; }
  // wound+stain pairs per body — also rides the quality tier
  function perActorBase() { return (CBZ.qScale ? CBZ.qScale(5, 20) : 10) | 0; }
  function perActorCity() { return (CBZ.qScale ? CBZ.qScale(11, 44) : 22) | 0; }
  function capGlobal() { return cityWounds() ? capCity() : capBase(); }
  function perActor() { return cityWounds() ? perActorCity() : perActorBase(); }
  const SPAWN_D2 = 45 * 45; // matches gore.js's "only where it can be seen" band
  const DRY_T = 12;         // seconds until a fresh wound dries brown
  const PROUD = 0.013;      // how far the disc sits off the surface (no z-fight)
  const PROUD_SOAK = 0.008; // the stain sits UNDER its wound disc

  // ---- shared geometry + materials ------------------------------------------
  const G_WOUND = new THREE.CircleGeometry(1, 8);
  G_WOUND._shared = true;
  // soak stains: IRREGULAR blob outlines — a circle with per-vertex radial
  // jitter (sum of randomly-phased sines) baked ONCE at startup. 3 shared
  // geometries, randomly picked + spun + stretched per stain.
  function blobGeo() {
    const g = new THREE.CircleGeometry(1, 14);
    g._shared = true;
    const pos = g.attributes.position;
    const p1 = Math.random() * 6.28, p2 = Math.random() * 6.28, p3 = Math.random() * 6.28;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      if (x * x + y * y < 0.25) continue;            // centre vertex stays put
      const a = Math.atan2(y, x);
      const k = 1 + 0.18 * Math.sin(a * 3 + p1) + 0.14 * Math.sin(a * 5 + p2) + 0.09 * Math.sin(a * 7 + p3);
      pos.setXY(i, x * k, y * k);
    }
    return g;
  }
  const G_SOAK = [blobGeo(), blobGeo(), blobGeo()];
  function unlit(color) {
    // unlit = the wound reads as a HOLE (no light catch), and it's the
    // cheapest material in the renderer. _shared → rig-disposal sweeps skip it.
    const m = new THREE.MeshBasicMaterial({ color });
    m._shared = true;
    return m;
  }
  const MAT_FRESH = unlit(0x4e070b);   // fresh entry wound: near-black red
  const MAT_DRY = unlit(0x351409);     // dried: dark brown scab
  const MAT_BRUISE = unlit(0x3a2334);  // blunt trauma: purple-dark, no hole
  const MAT_SOAK = unlit(0x310609);    // wet cloth around the hole: near-black

  const wounds = [];   // FIFO: { m, actor, age, kind, dried, gone, (soak: gx,gy,gt,t) }
  const growing = [];  // soak records still spreading (per-frame, short-lived)
  const free = [];     // recycled meshes awaiting reuse
  const tmpV = new THREE.Vector3();

  function dist2Cam(x, z) {
    const c = CBZ.camera && CBZ.camera.position;
    if (!c) return 0;
    const dx = x - c.x, dz = z - c.z;
    return dx * dx + dz * dz;
  }

  // ---- which body part did the hit land on? --------------------------------
  // Classified in the ACTOR ROOT's local frame (handles facing + ragdoll
  // topple): head sphere flag wins outright, else height + lateral offset
  // split torso / arm / leg, matching the rig layout in entities/character.js.
  function pickPart(actor, px, py, pz, headFlag) {
    const S = actor.char.skinSlots, g = actor.group;
    g.updateWorldMatrix(true, false);
    tmpV.set(px, py, pz);
    g.worldToLocal(tmpV);
    const x = tmpV.x, y = tmpV.y;
    if ((headFlag || y > 1.98) && S.head && S.head[0]) return { mesh: S.head[0], region: "head" };
    if (y > 1.02) {
      if (Math.abs(x) > 0.47 && S.arms && S.arms.length === 2) {
        return x < 0 ? { mesh: S.arms[0], region: "armL" } : { mesh: S.arms[1], region: "armR" };
      }
      return { mesh: S.torso && S.torso[0], region: "torso" };
    }
    if (S.legs && S.legs.length === 2) {
      return x < 0 ? { mesh: S.legs[0], region: "legL" } : { mesh: S.legs[1], region: "legR" };
    }
    return { mesh: S.torso && S.torso[0], region: "torso" };
  }

  // ---- seat a decal on a part: part-local point → snapped to the box face --
  // the round came through, slightly proud, spun in its own plane.
  function seat(m, part, lp, proud) {
    const prm = part.geometry.parameters || {};
    const hx = (prm.width || 0.6) * 0.5, hy = (prm.height || 0.9) * 0.5, hz = (prm.depth || 0.45) * 0.5;
    const rx = Math.abs(lp.x) / hx, ry = Math.abs(lp.y) / hy, rz = Math.abs(lp.z) / hz;
    let ax = "z";                                 // front/back wins ties
    if (rx > rz + 0.02 && rx > ry) ax = "x";
    else if (ry > rz + 0.02 && ry > rx) ax = "y";
    const cl = (v, h) => Math.max(-h * 0.78, Math.min(h * 0.78, v));
    const spin = Math.random() * 6.28;            // decal spin in its own plane
    if (ax === "x") {
      const s = lp.x >= 0 ? 1 : -1;
      m.position.set(s * (hx + proud), cl(lp.y, hy), cl(lp.z, hz));
      m.rotation.set(0, s * Math.PI / 2, spin);
    } else if (ax === "y") {
      const s = lp.y >= 0 ? 1 : -1;
      m.position.set(cl(lp.x, hx), s * (hy + proud), cl(lp.z, hz));
      m.rotation.set(s > 0 ? -Math.PI / 2 : Math.PI / 2, 0, spin);
    } else {
      const s = lp.z >= 0 ? 1 : -1;
      m.position.set(cl(lp.x, hx), cl(lp.y, hy), s * (hz + proud));
      m.rotation.set(0, s > 0 ? 0 : Math.PI, spin);
    }
  }

  // ---- mesh pool ------------------------------------------------------------
  function dropWound(i, reuse) {
    const r = wounds.splice(i, 1)[0];
    r.gone = true;                               // growing[] skips stale refs
    if (r.m.parent) r.m.parent.remove(r.m);
    if (r.actor) r.actor._woundN = Math.max(0, (r.actor._woundN || 1) - 1);
    if (!reuse && free.length < 36) free.push(r.m);  // reuse = caller takes the mesh
    return r.m;
  }
  function meshFor(actor) {
    // per-actor cap: recycle THIS body's oldest hit first (keeps wounds
    // ACCUMULATING — shooting a corpse keeps adding holes — but bounded).
    if ((actor._woundN || 0) >= perActor()) {
      for (let i = 0; i < wounds.length; i++) {
        if (wounds[i].actor === actor) return dropWound(i, true);
      }
    }
    if (free.length) return free.pop();
    if (wounds.length >= capGlobal()) return dropWound(0, true);   // global cap: oldest-first
    const m = new THREE.Mesh(G_WOUND, MAT_FRESH);
    m.castShadow = m.receiveShadow = false;
    return m;
  }

  // ---- LOCAL SOAK: an irregular stain spreads around the entry point --------
  // a child of the SAME part, seated on the SAME face, under the wound disc;
  // grows from a blot to full spread over `growT` seconds (per-frame while
  // active, then it costs nothing).
  function spawnSoak(actor, part, lp, size, growT) {
    const m = meshFor(actor);
    m.geometry = G_SOAK[(Math.random() * 3) | 0];
    m.material = MAT_SOAK;
    seat(m, part, lp, PROUD_SOAK);
    // a stain can never outgrow the panel it's soaked into — bigger than the
    // face it reads as a rigid sheet hovering off the body (user-filmed)
    const pp = part.geometry && part.geometry.parameters || {};
    const cap = Math.max(0.16, Math.min(pp.width || 0.5, pp.height || 0.7, pp.depth || 0.4) * 1.05);
    const gx = Math.min(cap, size * (0.8 + Math.random() * 0.5));
    const gy = Math.min(cap * 1.25, size * (0.8 + Math.random() * 0.5));
    m.scale.set(gx * 0.35, gy * 0.35, 1);
    part.add(m);
    const r = { m, actor, age: 0, kind: "soak", dried: true, gx, gy, gt: growT, t: 0 };
    wounds.push(r);
    growing.push(r);
    actor._woundN = (actor._woundN || 0) + 1;
  }

  // ---- CBZ.bodyWound(actor, worldPoint, opts) -------------------------------
  CBZ.bodyWound = function (actor, wp, opts) {
    if (!actor || !wp || actor.culled || !CBZ.scene) return;
    const ch = actor.char;
    if (!ch || !ch.skinSlots || !actor.group || actor.group.visible === false) return;
    opts = opts || {};
    let px = wp.x, py = wp.y, pz = wp.z;
    if (px == null || py == null || pz == null) return;
    if (dist2Cam(px, pz) > SPAWN_D2) return;   // only where it can be seen

    // burst window: a shotgun's pellets (or a same-frame double report) land
    // SCATTERED wounds, never a pool-flushing spray. CITY lets more pellets
    // through (a shotgun blast peppers the body — owner wants it to READ shot
    // up) while still capping the same-frame burst; jail/survival keep 3.
    const burstCap = cityWounds() ? 6 : 3;
    const now = performance.now();
    if (now - (actor._woundT || -1e9) < 90) {
      if ((actor._woundBurst || 0) >= burstCap) return;
      actor._woundBurst = (actor._woundBurst || 0) + 1;
    } else {
      actor._woundBurst = 1;
    }
    actor._woundT = now;

    // a synthetic centre-point (NPC hit rolls have no ray) leans toward the
    // shooter so the wound lands on the surface FACING them.
    if (opts.fromX != null && opts.fromZ != null) {
      let nx = opts.fromX - px, nz = opts.fromZ - pz;
      const nl = Math.hypot(nx, nz);
      if (nl > 0.01) {
        px += (nx / nl) * 0.45;
        pz += (nz / nl) * 0.45;
        // scatter a touch so a magdump doesn't stack one pixel
        px += (Math.random() - 0.5) * 0.18;
        py += (Math.random() - 0.5) * 0.22;
        pz += (Math.random() - 0.5) * 0.18;
      }
    }

    const melee = opts.melee === true ? "blunt" : opts.melee;
    const kind = melee === "blunt" ? "bruise" : (melee === "blade" ? "blade" : "shot");
    const cal = opts.cal != null ? opts.cal : (opts.caliber != null ? opts.caliber : 1);

    const pick = pickPart(actor, px, py, pz, !!opts.head);
    const part = pick.mesh;
    if (!part || !part.geometry) return;

    // ---- LEG HIT → LIMP (the "smart/realistic" read) -------------------------
    // a round/blade to a leg makes the actor favour it: entities/character.js
    // reads ch.legHurt and limps (shortened stiff stride on the hurt side, the
    // body dips toward it on each weight-bearing step, reduced speed). Severity
    // follows the caliber; a blade hobbles less than a slug. Light wounds ease
    // off over ~20s; heavy ones persist until death. We DON'T touch the player
    // here — death.js owns the player's own probabilistic leg-wound/limp model
    // (P._legWound); see report. A leg already GONE (severed) stays gone.
    if ((pick.region === "legL" || pick.region === "legR") && kind !== "bruise" &&
        !actor.isPlayer && !ch.legGone) {
      const side = pick.region === "legL" ? -1 : 1;
      const add = (kind === "blade" ? 0.28 : 0.34) + cal * 0.34;   // caliber widens the limp
      const prev = ch.legHurt;
      const sevNew = Math.min(1, (prev && prev.side === side ? prev.sev : 0) + add);
      // a new wound to the OTHER leg takes over only if it's worse than the old
      if (!prev || prev.side === side || sevNew > prev.sev) {
        ch.legHurt = { side, sev: sevNew, t: 9999 };   // t counts down only once light (animChar)
      }
    }

    const m = meshFor(actor);
    m.geometry = G_WOUND;
    m.material = kind === "bruise" ? MAT_BRUISE : MAT_FRESH;

    // world hit → part-local, snapped to the box face the round came through
    part.updateWorldMatrix(true, false);
    const lp = tmpV.set(px, py, pz);
    part.worldToLocal(lp);
    seat(m, part, lp, PROUD);

    // severity → size: caliber widens the hole; the head wound reads a touch
    // bigger (it's the kill tell); a bruise is a broad flat patch; a blade
    // leaves a thin slash. Every wound carries its own jitter — no two match.
    let s0 = 0.045 + 0.032 * cal;
    if (pick.region === "head") s0 *= 1.15;
    if (kind === "bruise") {
      const b = s0 * 2.2;
      m.scale.set(b * (0.85 + Math.random() * 0.3), b * (0.7 + Math.random() * 0.3), 1);
    } else if (kind === "blade") {
      m.scale.set(s0 * (0.45 + Math.random() * 0.2), s0 * (1.7 + Math.random() * 0.4), 1);
    } else {
      m.scale.set(s0 * (0.85 + Math.random() * 0.3), s0 * (0.85 + Math.random() * 0.3), 1);
    }

    part.add(m);   // rides the part: animates, ragdolls and despawns with the rig
    wounds.push({ m, actor, age: 0, kind, dried: false });
    actor._woundN = (actor._woundN || 0) + 1;

    // ---- LOCAL SOAK STAIN (a bruise doesn't bleed) ----
    // the cloth around the hole goes dark and keeps spreading for a few
    // seconds — local, irregular, anchored to THIS wound. Headshot = heavy
    // fast splatter on the head PLUS a run-down stain seated at the collar.
    if (kind !== "bruise") {
      if (pick.region === "head") {
        spawnSoak(actor, part, lp, s0 * 3.4, 0.6);
        const torso = ch.skinSlots.torso && ch.skinSlots.torso[0];
        if (torso && torso.geometry) {
          torso.updateWorldMatrix(true, false);
          tmpV.set(px, py, pz);
          torso.worldToLocal(tmpV);                       // same side the round came from
          const tp = torso.geometry.parameters || {};
          tmpV.y = (tp.height || 0.9) * 0.5 * 0.72;       // up at the collar line
          spawnSoak(actor, torso, tmpV, s0 * 3.8, 1.1);
        }
      } else {
        const heavy = kind === "shot" && cal >= 1.25;
        spawnSoak(actor, part, lp, s0 * (heavy ? 3.4 : 2.6), heavy ? 2.2 : 3.2);
      }
    }
  };

  // ---- reset: detach everything ---------------------------------------------
  CBZ.clearWounds = function () {
    for (let i = 0; i < wounds.length; i++) {
      const r = wounds[i];
      r.gone = true;
      if (r.m.parent) r.m.parent.remove(r.m);
      if (free.length < 36) free.push(r.m);
      if (r.actor) { r.actor._woundN = 0; if (r.actor.char) r.actor.char.legHurt = null; }
    }
    wounds.length = 0;
    growing.length = 0;
  };

  // chain onto CBZ.clearGore (match reset / scene swap) — checked lazily every
  // frame (cheap flag read) so script order vs gore.js never matters.
  function wrapClearGore() {
    const orig = CBZ.clearGore;
    CBZ.clearGore = function () { CBZ.clearWounds(); return orig.apply(this, arguments); };
    CBZ.clearGore._wounds = true;
  }

  // ---- one updater: ZERO cost while nobody is being shot ---------------------
  // soak spread runs per-frame (only while a stain is actively growing);
  // record lifecycle stays on the cheap 0.8s throttle.
  let tick = 0;
  CBZ.onAlways(9, function (dt) {
    if (CBZ.clearGore && !CBZ.clearGore._wounds) wrapClearGore();
    if (!wounds.length) return;   // the whole system sleeps
    for (let i = growing.length - 1; i >= 0; i--) {
      const r = growing[i];
      if (r.gone || !r.m.parent) { growing.splice(i, 1); continue; }
      r.t += dt;
      const k = Math.min(1, r.t / r.gt);
      const e = 0.35 + 0.65 * Math.sqrt(k);   // fast blot, slow creep (gore pools' curve)
      r.m.scale.set(r.gx * e, r.gy * e, 1);
      if (k >= 1) growing.splice(i, 1);
    }
    tick += dt;
    if (tick < 0.8) return;
    const step = tick;
    tick = 0;
    for (let i = wounds.length - 1; i >= 0; i--) {
      const r = wounds[i], a = r.actor;
      // rig left the scene (corpse cull / crowd replacement) → free the record
      if (!a || a.culled || !a.group || !a.group.parent) { dropWound(i); continue; }
      r.age += step;
      if (r.kind === "shot" && !r.dried && r.age > DRY_T) { r.dried = true; r.m.material = MAT_DRY; }
    }
  });
})();
