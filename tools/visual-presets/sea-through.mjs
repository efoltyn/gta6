/* sea-through — the sea you can see INTO. tools/visual-compare.mjs preset.

   OWNER (2026-08-25): "the shadow left by the orca is dumb and fake, like a
   fake horizon — rather than water being slightly opaque and the shadow being
   real then."

   WHAT HE IS LOOKING AT ON THE BEFORE SIDE. The sea was an opaque, depth-
   writing lid, so no submerged animal could ever be seen through it. Rather
   than fix that, city/wildlife_shark.js and city/wildlife_orca.js each painted
   a stand-in ON the waterline: a top-down silhouette of the animal, plus a
   second, darker, sun-offset copy of the same painting for "the shadow". Two
   flat quads lying on the surface, at a fixed opacity, on a depth-fade curve
   that had nothing to do with where your eye actually was. That is the sticker.

   WHAT THE AFTER SIDE IS. world/water_spec.js's SEA_TRANSLUCENT, in two
   halves that are one model:

     • cbzSeaAlpha  — both sea materials write a real alpha, and it is water's
       actual Fresnel transmittance over the flat surface normal: ~0.54 opaque
       straight down, still only ~0.65 from a deck at twenty degrees, and 1.0
       inside the last few degrees of grazing and past 240 m. So you can see
       into the water you look down at and the horizon is untouched.
     • CBZ.waterVeilApply — the animal's OWN materials fade toward the water
       colour by the length of the water column between the fragment and the
       eye (not by its depth: the column is |CP| * depth / (eye + depth), which
       is why the same animal at the same depth disappears as you flatten your
       view). Beer-Lambert, one exp per fragment, on submerged animals only.

   Both painted quads are then deleted, because with the real animal showing
   through, a painted animal on the surface is a SECOND animal.

   THE A/B IS ONE FLAG on this same checkout: the before page boots with
   ?cfg_SEA_TRANSLUCENT=0, which restores the opaque sea AND both silhouettes,
   byte for byte. Same seed, same water, same hull, same camera, same tick.

   THE NUMBERS ARE READ OUT OF THE LIVE PAGE, never replicated here:

     paintedProxyQuads  how many painted silhouette/shadow quads are visible on
                        the water. TWO is the sticker. ZERO is the fix.
     seaAlphaAtBody     the sea material's own alpha on the ray that reaches
                        the animal, from the shipped uniform and the shipped
                        formula. 1.000 is a lid.
     waterColumnM       metres of water between the eye and the animal's
                        centre, on this exact camera ray.
     bodyTransmittance  exp(-column * uVeilK) — the fraction of the real
                        animal that survives that column. 0 on the before side
                        because there is nothing to survive: the sea is opaque.
     bodyThroughWater   the product of the two, i.e. how much of the REAL
                        animal reaches the frame. This is the whole feature as
                        one number.
     bodyDrawn          is the authored body even on screen (LOD).
*/

const subjects = [
  {
    id: "orca-from-deck",
    label: "The Orca From The Rail",
    species: "orca", hull: "yacht", camEye: 5.6, side: 14, ahead: 1.0,
    depthM: 2.6, fov: 46,
    focus: "The owner's frame. Fourteen metres off a yacht rail, an orca two and a half metres down. BEFORE: a painted black-and-white plan view lying on the water with a painted dark copy of itself offset beside it — a sticker and its fake shadow. AFTER: the actual animal, under actual water, dimmed and tinted by the column above it.",
    state: "DECK · ORCA · 2.6 m DOWN",
    note: "Nothing was added to the orca to make this work. The sea stopped being a lid.",
  },
  {
    id: "shark-from-deck",
    label: "The Great White From The Rail",
    species: "great_white_shark", hull: "yacht", camEye: 4.8, side: 10, ahead: 1.0,
    depthM: 2.4, fov: 46,
    focus: "The same question asked of the shark. BEFORE: one grey painted torpedo plus one darker painted torpedo, both flat on the surface at a fixed opacity. AFTER: a grey animal seen THROUGH water — pectorals, gill line and the roll of the flank, all of it losing contrast into the blue.",
    state: "DECK · GREAT WHITE · 2.4 m DOWN",
    note: "The fin, the tail tip, the wake and the spray are untouched: those are real things above the water, not stand-ins.",
  },
  {
    id: "shark-deep",
    label: "Deep — Depth Still Swallows It",
    species: "great_white_shark", hull: "yacht", camEye: 4.8, side: 10, ahead: 1.0,
    depthM: 22.0, fov: 46,
    focus: "The control. The SAME shark at the SAME range, twenty-two metres down. If translucent water meant a permanently visible animal it would be worse than the sticker — an X-ray sea. The water column is now long enough to eat it, and it is gone. The fin is gone too, because it is twenty-two metres under.",
    state: "DECK · GREAT WHITE · 22 m DOWN",
    note: "Same flag, same shader, same animal. The only variable is how much water is in the way.",
  },
  {
    id: "sea-wide",
    label: "The Sea At Range — Nothing Went Glassy",
    species: null, hull: null, camEye: 62, side: 0, ahead: 0,
    depthM: 0, aimDown: 0.06, fov: 58, wide: true,
    focus: "The risk this change carries: a sea that blends everywhere would go glassy at the horizon, break the horizon fuse and reveal whatever is under the far ocean. The clarity term is bounded to a 240 m window and multiplied by the view angle, so from sixty metres up the water in the distance is exactly as solid as it always was.",
    state: "60 m UP · OPEN OCEAN",
    note: "seaAlphaFar is the sea's own alpha out at the horizon. It must read 1.000 on both sides.",
  },
];

async function stageSeaThrough(input) {
  const CBZ = window.CBZ, T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const subject = input.subject;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__seaOverlay") continue;
      child.style.visibility = "hidden";
    }
  };

  let S = window.__seaStage;
  if (!S) {
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        CBZ.stepSim && document.getElementById("playBtn"), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 120000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    let seed = 0x9e3779b9 >>> 0;
    Math.random = function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 90; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
    // one pinned hour for every frame: the water's colour and the sun's angle
    // decide what "you can see into it" even looks like.
    try { if (CBZ.dayPhase) { CBZ.dayPhase(0.30); for (let i = 0; i < 8; i++) CBZ.stepSim(1 / 60); } } catch (_) {}

    const overlay = document.createElement("div");
    overlay.id = "__seaOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f2f8fc;text-shadow:0 2px 9px #001019;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-read></div><div data-note></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__seaStage = { overlay, hulls: {}, parked: [] };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const wf = CBZ.waterField;
  if (!wf) return { ok: false, missing: "waterField" };

  // ---- deterministic open-ocean anchor (fixed scan order, never random) ----
  function findWater(minShore, maxShore, from) {
    for (let r = Number(from) || 900; r <= 9000; r += 30) {
      for (let i = 0; i < 96; i++) {
        const ang = (i / 96) * Math.PI * 2;
        const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
        const s = wf.shoreAt(x, z);
        if (!(s <= maxShore && s >= minShore)) continue;
        if (!wf.isSurfaceWater(x, z, 0)) continue;
        if (CBZ.waterInlandFactorAt && CBZ.waterInlandFactorAt(x, z) > 0.02) continue;
        return { x: Number(x.toFixed(2)), z: Number(z.toFixed(2)), shore: Number(s.toFixed(2)) };
      }
    }
    return null;
  }
  const ref = input.referenceStage || null;
  const anchor = (ref && ref.anchor) || findWater(-6000, -900, 1400);
  if (!anchor) return { ok: false, err: "no open water found" };

  const surf0 = CBZ.citySeaHeightAt(anchor.x, anchor.z);
  const sideD = Number(subject.side) || 0;
  const P = CBZ.player && CBZ.player.pos;

  /* CLEAR THE SET FIRST. Every subject teleports an animal to the SAME anchor,
     so without this the orca from frame 1 is still floating in frame 4's wide
     shot — which is exactly what the first run of this preset photographed. */
  for (const old of S.parked) {
    if (!old.group) continue;
    old.group.position.set(anchor.x + 2600, surf0 - 40, anchor.z + 2600);
    if (old.home) { old.home.x = anchor.x + 2600; old.home.z = anchor.z + 2600; }
    if (old._waterMove) { old._waterMove.x = anchor.x + 2600; old._waterMove.z = anchor.z + 2600; }
    old.group.updateMatrixWorld(true);
  }

  // ---- the subject animal (skipped by the wide frame) ----------------------
  let actor = null, grp = null;
  const depth = Number(subject.depthM || 2);
  let yOff = 0;
  if (subject.species) {
    const list = (CBZ.cityWildlifeList && CBZ.cityWildlifeList()) || [];
    actor = list.find((a) => a && a.species && a.species.id === subject.species &&
      !a.dead && !a.tamed && !a.ridden);
    if (!actor) return { ok: false, missing: subject.species };
    grp = actor.group;
    grp.visible = true;
    grp.matrixAutoUpdate = true;
    grp.traverse((o) => { o.matrixAutoUpdate = true; });
    actor.home.x = anchor.x; actor.home.z = anchor.z;
    actor.heading = 0;
    if (actor._waterMove) { actor._waterMove.x = anchor.x; actor._waterMove.z = anchor.z; }
    /* "TWO METRES DOWN" MEANS THE ANIMAL, NOT ITS ORIGIN. An orca's group
       origin sits well below its own mass, so setting position.y = surf - 2.2
       put most of a ten-metre animal ABOVE the water and the first run
       photographed a whale in mid-air. Measure the built body once and carry
       the offset from origin to box centre through every pin below. */
    grp.position.set(anchor.x, surf0, anchor.z);
    grp.updateMatrixWorld(true);
    const b0 = new T.Box3().setFromObject(grp);
    yOff = grp.position.y - b0.getCenter(new T.Vector3()).y;
    S.parked.push(actor);
  }

  /* DRIVE THE REAL TICK, THEN PIN. stepSim runs wildlife.js's aquatic branch,
     which runs CBZ.sharkBrain, which runs BOTH surface proxies (wildlife.js
     routes every danger>=0.5 aquatic through it, orcas included). That is what
     builds and solves the painted quads on the before side — this preset must
     never draw them itself or it would be photographing its own arithmetic.

     THE PLAYER IS PINNED ON EVERY TICK, and that is not tidiness. Parked once
     and then ticked, city/swim.js drops the player into the sea within a few
     frames, world/water_underwater.js turns the whole frame into the submerged
     treatment, and BOTH sides then photograph a shark from UNDER the water —
     where an opaque sea hides nothing and the comparison says nothing. The
     first run of this preset did exactly that. */
  const pin = () => {
    if (P) {
      P.x = anchor.x - Number(subject.ahead || 0);
      P.z = anchor.z + sideD;
      P.y = surf0 + (Number(subject.camEye) || 3);
      CBZ.player.hp = 100;
      if (CBZ.player.vel) CBZ.player.vel.set ? CBZ.player.vel.set(0, 0, 0) : null;
    }
    if (!grp) return;
    grp.position.set(anchor.x, surf0 - depth + yOff, anchor.z);
    actor.heading = 0;
    if (actor._shark) { actor._shark.diveWant = depth; actor._shark.state = "cruise"; }
    if (actor._orca) actor._orca.diveWant = depth;
  };
  pin();
  for (let i = 0; i < 150; i++) { pin(); CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
  pin();
  // heading 0 is +x and the camera looks down -z, so the animal is already
  // broadside. Never re-yaw it here: wildlife_rig.js owns that, and a pose
  // written by this file would be a pose the game never produces.
  if (grp) { grp.updateMatrix(); grp.updateMatrixWorld(true); }

  const surf = CBZ.citySeaHeightAt(anchor.x, anchor.z);

  // ---- the boat ------------------------------------------------------------
  let hull = null;
  const hullKey = subject.hull ? String(subject.hull) : null;
  if (hullKey && CBZ.marineHulls && CBZ.marineHulls.build) {
    hull = S.hulls[hullKey] || null;
    if (!hull) {
      try { hull = CBZ.marineHulls.build(hullKey); } catch (_) { hull = null; }
      if (hull) { hull.userData.dynamic = true; CBZ.scene.add(hull); S.hulls[hullKey] = hull; }
    }
  }
  for (const k of Object.keys(S.hulls)) S.hulls[k].visible = (k === hullKey);

  let railZ = anchor.z + sideD - Math.min(3.2, sideD * 0.35);
  if (hull) {
    hull.position.set(0, 0, 0); hull.rotation.set(0, 0, 0);
    hull.updateMatrixWorld(true);
    let hb = new T.Box3().setFromObject(hull);
    if ((hb.max.z - hb.min.z) > (hb.max.x - hb.min.x)) {
      hull.rotation.y = Math.PI / 2; hull.updateMatrixWorld(true);
      hb = new T.Box3().setFromObject(hull);
    }
    const halfBeam = (hb.max.z - hb.min.z) * 0.5;
    hull.position.set(anchor.x - Number(subject.ahead || 0), surf, anchor.z + sideD + halfBeam);
    hull.updateMatrixWorld(true);
    hb = new T.Box3().setFromObject(hull);
    railZ = hb.min.z + 0.45;
  }

  // ---- camera --------------------------------------------------------------
  const camera = CBZ.camera;
  let camPos, camAim;
  if (ref && ref.camera) { camPos = ref.camera.position.slice(); camAim = ref.camera.target.slice(); }
  else if (subject.wide) {
    camPos = [anchor.x, surf + Number(subject.camEye || 60), anchor.z + 120];
    camAim = [anchor.x, surf - Number(subject.aimDown || 0.06) * 200, anchor.z - 1400];
  } else {
    camPos = [anchor.x - Number(subject.ahead || 0), surf + (Number(subject.camEye) || 3), railZ];
    // aim at the animal itself, so the frame always holds BOTH the water
    // surface and whatever is under it — the only composition in which the
    // question "can you see into this water" can even be asked.
    camAim = [anchor.x, surf - Number(subject.depthM || 2) * 0.55, anchor.z];
  }
  camera.aspect = input.width / input.height;
  camera.fov = Number(subject.fov) || 48;
  camera.near = 0.12; camera.far = 24000;
  camera.position.set(camPos[0], camPos[1], camPos[2]);
  camera.lookAt(camAim[0], camAim[1], camAim[2]);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  hideHud();
  CBZ.renderer.render(CBZ.scene, camera);

  /* ---- READ THE SHIPPED NUMBERS, from the shipped uniform ------------------
     cbzSeaAlpha's formula lives in world/water_spec.js as GLSL. This mirrors
     it ONCE, here, from the uniform the page is actually rendering with — so
     with the flag off uClarity.x is 0 and every number below collapses to the
     opaque answer without this file knowing anything about the flag. */
  const mat = CBZ.citySeaMaterial;
  const cl = mat && mat.uniforms && mat.uniforms.uClarity ? mat.uniforms.uClarity.value : null;
  function seaAlpha(pt) {
    if (!cl || cl.x <= 0) return 1;
    const dx = camPos[0] - pt[0], dy = camPos[1] - pt[1], dz = camPos[2] - pt[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const c = Math.max(0, Math.min(1, dy / len));
    let clarity = 1 - (0.02 + 0.98 * Math.pow(1 - c, cl.y));
    const dist = Math.hypot(camPos[0] - pt[0], camPos[2] - pt[2]);
    const t = Math.max(0, Math.min(1, (dist - cl.z) / Math.max(1e-4, cl.w - cl.z)));
    clarity *= 1 - t * t * (3 - 2 * t);
    return Math.max(0, Math.min(1, 1 - cl.x * clarity));
  }

  const vu = CBZ.waterVeilUniforms;
  const veilK = vu ? vu.uVeilK.value : 0;
  const seaYv = vu ? vu.uVeilSeaY.value : surf;
  let column = 0, transmit = 0, alphaAtBody = 1, bodyDrawn = 0, depthM = 0;
  if (grp) {
    const box = new T.Box3().setFromObject(grp);
    const c = box.getCenter(new T.Vector3());
    depthM = surf - c.y;
    alphaAtBody = seaAlpha([c.x, c.y, c.z]);
    const aC = camPos[1] - seaYv, bP = c.y - seaYv;
    if (aC > 0 && bP < 0) {
      column = Math.hypot(c.x - camPos[0], c.y - camPos[1], c.z - camPos[2]) * (-bP) / Math.max(0.05, aC - bP);
      transmit = veilK > 0 ? Math.exp(-column * veilK) : 0;
    }
    bodyDrawn = grp.visible !== false ? 1 : 0;
  }

  // How many painted silhouette quads are on the water right now. This is the
  // sticker, counted: the two proxy files' own meshes, asked directly.
  let painted = 0;
  const s1 = actor && actor._shark, s2 = actor && actor._orca;
  for (const s of [s1, s2]) {
    if (!s) continue;
    if (s.shadow && s.shadow.visible && s.root && s.root.visible) painted++;
    if (s.bodySil && s.bodySil.visible && s.root && s.root.visible) painted++;
    if (s.body && s.body.visible && s.root && s.root.visible) painted++;
  }

  const farPt = [camPos[0], surf, camPos[2] - 2000];
  const seaFar = seaAlpha(farPt);
  const seaDown = seaAlpha([camPos[0], surf, camPos[2] + 0.01]);

  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector(`[data-${n}]`);
  const put = (n, text, css) => { const el = q(n); if (el) { el.textContent = text; el.style.cssText = css; } };
  put("side", before ? input.beforeLabel : input.afterLabel,
    `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`);
  put("name", subject.label, "position:absolute;top:64px;left:26px;font-size:26px;font-weight:800;letter-spacing:-.02em");
  put("focus", subject.focus, "position:absolute;top:100px;left:28px;color:#c3d4de;font-size:13px;font-weight:550;max-width:700px;line-height:1.35");
  put("state", subject.state,
    `position:absolute;right:26px;top:25px;color:${before ? "#ffb0b0" : "#7ff0bb"};font-size:11px;font-weight:900;letter-spacing:.1em`);
  put("read",
    `painted proxy quads ${painted}` +
    `\nsea alpha  body ${alphaAtBody.toFixed(3)}  ·  down ${seaDown.toFixed(3)}  ·  far ${seaFar.toFixed(3)}` +
    `\nbody depth ${depthM.toFixed(2)}m · column ${column.toFixed(2)}m` +
    `\ntransmittance ${transmit.toFixed(3)} · through water ${(transmit * (1 - alphaAtBody)).toFixed(3)}` +
    `\nbody drawn ${bodyDrawn} · veil k ${veilK.toFixed(3)}`,
    `position:absolute;right:26px;top:52px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;text-align:right;color:${painted === 0 ? "#9fe8c3" : "#ff9c9c"}`);
  put("note", subject.note, "position:absolute;right:26px;bottom:20px;padding:7px 10px;border-radius:6px;background:rgba(3,18,28,.72);color:#bfe9ff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;max-width:520px");
  put("source", new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname,
    "position:absolute;bottom:20px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace");

  return {
    ok: true,
    anchor,
    camera: { position: camPos.slice(), target: camAim.slice() },
    metrics: {
      paintedProxyQuads: painted,
      seaAlphaAtBody: Number(alphaAtBody.toFixed(3)),
      seaAlphaDown: Number(seaDown.toFixed(3)),
      seaAlphaFar: Number(seaFar.toFixed(3)),
      seaTransparent: mat && mat.transparent ? 1 : 0,
      bodyDepthM: Number(depthM.toFixed(2)),
      waterColumnM: Number(column.toFixed(2)),
      bodyTransmittance: Number(transmit.toFixed(3)),
      bodyThroughWater: Number((transmit * (1 - alphaAtBody)).toFixed(3)),
      bodyDrawn: bodyDrawn,
    },
  };
}

export default {
  id: "sea-through",
  title: "The Sea You Can See Into — Retiring The Painted Shadow",
  description: "Four frames answer the owner's 2026-08-25 note that the shadow under an orca is \"dumb and fake, like a fake horizon.\" The before page is this same checkout booted with ?cfg_SEA_TRANSLUCENT=0: an opaque sea with a painted top-down silhouette of the animal, plus a second darker painted copy for its shadow, both lying flat on the waterline. The after page lets the sea blend by view angle and veils the real animal by the real water column between it and the eye — so what you see under the water is the animal, and the two paintings are gone. The third frame is the control (the same shark twenty-two metres down, correctly invisible) and the fourth checks that the far ocean did not go glassy.",
  defaultBefore: "local",
  beforeParams: { cfg_SEA_TRANSLUCENT: 0 },
  beforeLabel: "BEFORE · OPAQUE SEA + PAINTED SHADOW",
  afterLabel: "AFTER · SEA_TRANSLUCENT",
  pairNote: "Same seed · same water · same hull · same camera · same production tick · one flag",
  method: "Each page boots its own city at seed 90210, freezes the rAF loop, seeds Math.random from one LCG, pins the day phase, teleports a registered animal to a deterministic point of open ocean at a declared depth, parks the player on a real world/water_hulls.js yacht deck beside it and runs 150 real stepSim ticks so wildlife.js's own aquatic branch builds and solves whatever surface proxy that build has. Every number in the table is computed from the live uClarity / uVeilK uniforms the page is rendering with, so with the flag off they collapse to the opaque answer on their own.",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  /* BOTH SIDES RUN THE SHADER SEA, NOT THE PLANAR MIRROR (?cfg_WATER_REFLECT=0).
     Not a dodge — a separate bug found while shooting this preset. At quality
     tier >= 2 world/waterfx.js swaps CBZ.citySea for the THREE.WaterReflect
     mirror, and that mesh renders NOTHING: hiding it does not change a single
     pixel of the frame (measured, with readPixels). What every deck shot was
     photographing as "the sea" was world/terrain_overhaul.js's teal visual
     seabed showing through the hole — which is why it has no swell, no glitter
     and no foam. One cause is already fixed (water_spec.js's cbzInlandFactor
     called the built-in distance(), which ESSL will not allow while the vendor
     mirror's own main() declares `float distance` — the whole fragment shader
     failed to compile), and at least one more remains. Until the mirror is
     healthy this preset photographs the sea that actually draws. The flag is
     identical on both sides, so the A/B is untouched. */
  urlParams: { seed: 90210, cfg_WATER_REFLECT: 0 },
  stageTimeoutMs: 900000,
  metrics: {
    paintedProxyQuads: { label: "Painted silhouette/shadow quads on the water", unit: "", better: "lower" },
    seaAlphaAtBody: { label: "Sea opacity on the ray that reaches the animal", unit: "", better: "lower" },
    seaAlphaDown: { label: "Sea opacity looking straight down", unit: "", better: "lower" },
    seaAlphaFar: { label: "Sea opacity at the horizon (must stay 1.000)", unit: "" },
    seaTransparent: { label: "Sea material blends", unit: "0/1" },
    bodyDepthM: { label: "Animal depth below the live surface", unit: "m" },
    waterColumnM: { label: "Water between the eye and the animal", unit: "m" },
    bodyTransmittance: { label: "Fraction of the real animal surviving that column", unit: "", better: "higher" },
    bodyThroughWater: { label: "Real animal reaching the frame", unit: "", better: "higher" },
    bodyDrawn: { label: "Authored body on screen (LOD)", unit: "0/1" },
  },
  metricsNote: "paintedProxyQuads must fall to 0 and bodyThroughWater must rise from 0 — together those two are the whole change. On the deep frame bodyThroughWater is SUPPOSED to be ~0 on both sides: translucent water is not an X-ray. seaAlphaFar must read 1.000 on both sides or the horizon fuse has been broken.",
  subjects,
  stage: stageSeaThrough,
};
