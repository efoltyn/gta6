/* From a boat deck — tools/visual-compare.mjs preset.

   OWNER (2026-08-20, with two photographs): "what they look like from above
   the water" and "how they look from a ship when next to ship". The reference
   is a lone dorsal cutting a calm sea, and a drone shot of a shark in blue
   water. docs/SHARK-REFERENCE.md sections 4 and 5 wrote those photographs down
   as acceptance criteria; this preset is how they are checked.

   IT STAGES THE REAL GAME. Each page boots its own world at seed 90210,
   freezes the rAF loop, seeds Math.random from one LCG, finds a deterministic
   point of open ocean, drops a REAL production hull there (world/water_hulls.js
   — the same 34 m yacht and 14 m cruiser the player can buy), teleports a
   REGISTERED great white alongside it and then drives THAT PAGE'S OWN
   city/wildlife_shark.js: CBZ.sharkBrain for the hunt, and the file's own
   locomotion seam (opts.move -> swim() -> depth()) to hold one declared beat
   so both builds photograph the same instant. The camera stands on the deck.

   THE A/B IS A FLAG FLIP, not a diff against a deployed build forty commits
   old: the same checkout serves both sides and the before side boots with
   SHARK_FIN_V2 / SHARK_WAKE_V2 / SHARK_SHADOW_V2 / SHARK_SHADOW_VIEW off,
   which is the surface read exactly as it was before this pass — a flat
   isoceles cone on a fade curve, an oversized white V, and one soft ellipse.

   THE NUMBERS COME FROM THE FILE ITSELF (CBZ.sharkSurfaceRead), not from
   arithmetic replicated here, so the table cannot drift away from the thing it
   describes. Five of them matter:

     surfaceDorsals   how many separate dorsal fins cut the surface. ONE is
                      correct. TWO is the owner's 2026-08-03 "another fin above
                      the fin" and the historical bug this area keeps growing.
     finExposedM      metres of blade out of the water — which must follow the
                      animal's real depth and the live swell, not a fade curve.
     finHandoverErrM  |proxy fin - authored fin| at the same pose: how big a
                      jump the player sees when the body's LOD hands the dorsal
                      over to the proxy at ~68 u. Zero is invisible.
     finConcavity     the trailing edge's deepest excursion from the apex->tip
                      chord, over that chord. A cone — the old proxy — is 0.
     tailTipM         metres of upper CAUDAL lobe out of the water. This is a
                      second fin and it is CORRECT — dorsal plus tail tip is
                      the real shallow-cruise read. It is deliberately not
                      counted in surfaceDorsals, which is about the bug.
     finBankRad       how far the blade rolls into a turn, on wildlife_rig.js's
                      own roll law so the proxy cannot lean differently from
                      the body it stands in for.
     shadowShapeFill  the fraction of its own bounding box the underwater mass
                      covers. A filled ellipse is pi/4 = 0.785 however it is
                      stretched; a shark with a waist, swept pectorals and a
                      notched tail is far less. This is "an ellipse is not a
                      shark" as a number. */

const subjects = [
  {
    id: "deck-alongside",
    label: "Alongside — Great White 8 m Off The Rail",
    hull: "yacht", camEye: 4.0, side: 8, ahead: 1.5, aimDown: 0.75,
    beat: "circle", depthK: 0.92, speed: 3.2,
    focus: "The owner's question, literally: you are on the deck, four metres over the water, and a great white is eight metres off the rail. One dorsal cutting the surface, and under it a shark-SHAPED mass — not a grey ellipse.",
    state: "DECK · 8 m",
    note: "The body is drawn here (inside showR) and the sea hides it: what you actually see IS the surface read.",
  },
  {
    id: "deck-fin-cruise",
    label: "From The Rail — The Fin At 40 m",
    hull: "yacht", camEye: 4.0, side: 40, ahead: 6, aimDown: 0.22,
    beat: "circle", depthK: 0.95, speed: 4.2,
    focus: "The Jaws shot from a deck: a lone dorsal on open water. Concave scythe trailing edge, apex leaning back, pale along the trailing margin, and a wake you have to look for.",
    state: "DECK · 40 m",
    note: "A cruising shark's wake is a ripple. The white V belongs to the rush.",
  },
  {
    id: "flybridge-topdown",
    label: "From The Flybridge — Straight Down",
    hull: "yacht", camEye: 7.4, side: 7, ahead: 0, aimDown: 2.4, topDown: true,
    beat: "circle", depthK: 1.5, speed: 2.6,
    focus: "The drone reference. From directly above the animal reads as a pale grey-brown torpedo widest at the pectoral line, PLUS a separate softer dark shadow offset below it. That double read is what sells depth.",
    state: "FLYBRIDGE · TOP-DOWN",
    note: "Looking down you see INTO water; at a swimmer's eye you see a mirror. The depth fade now knows the difference.",
  },
  {
    id: "under-hull",
    label: "Passing Under The Hull",
    hull: "cruiser", camEye: 3.1, side: 1.5, ahead: -2, aimDown: 1.6,
    beat: "circle", depthK: 2.6, speed: 3.6,
    focus: "A shark six metres down passing under the boat. It must still read — bigger, softer, fainter and offset from the sun — and it must not turn into a hard black disc against the hull.",
    state: "CRUISER · UNDER THE KEEL",
    note: "Depth is the fade axis; the offset from the sun is what makes it a shadow rather than a decal.",
  },
  {
    id: "rush-breaks",
    label: "The Rush — Fin And Back Out Of The Water",
    hull: "cruiser", camEye: 2.6, side: 11, ahead: 3, aimDown: 0.32,
    beat: "rush", depthK: 0.90, speed: 11.5,
    focus: "Committed and fast at the surface: the fin plus a back, and NOW the heavy wake is earned. This is the one frame where a big white V is right.",
    state: "CRUISER · RUSH",
    note: "Same wake quad as the cruise frame, opened up by state — not a second renderer.",
  },
  {
    id: "fin-handover-90m",
    label: "The Handover — Proxy Fin At 90 m",
    hull: "yacht", camEye: 4.0, side: 90, ahead: 12, aimDown: 0.12,
    beat: "circle", depthK: 0.95, speed: 4.0, wantProxy: true,
    focus: "Past ~68 u the hunt hides the body and the PROXY dorsal takes over. It has to be the same fin at the same height or the player watches it jump. And there must never be two.",
    state: "HUNT · LOD HANDOVER",
    note: "finHandoverErrM is the jump, in metres. The old proxy raised a fixed cone on a fade curve and never asked how deep the shark was.",
  },
  {
    id: "banking-turn",
    label: "The Turn — The Fin Leans, And The Tail Shows",
    hull: "yacht", camEye: 4.0, side: 78, ahead: 10, aimDown: 0.14,
    beat: "circle", depthK: 0.92, speed: 6.4, turn: 1.4, wantProxy: true,
    focus: "A shark rolls into its turns, so the dorsal LEANS — from a deck that is how you read the turn before the wake does. And on a genuinely shallow cruise the upper caudal lobe cuts the surface a body-length astern: fin plus tail tip, which is a real two-fin read and NOT the double-dorsal bug.",
    state: "HUNT · HARD TURN",
    note: "The bank uses wildlife_rig.js's own roll law, so the blade cannot lean differently from the body it stands in for.",
  },
];

async function stageDeck(input) {
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
      if (child.id === "__deckOverlay") continue;
      child.style.visibility = "hidden";
    }
  };

  let S = window.__deckStage;
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
    // one pinned hour for every frame in the run: the sun decides where the
    // shadow falls, and subject order must not.
    try { if (CBZ.dayPhase) { CBZ.dayPhase(0.30); for (let i = 0; i < 8; i++) CBZ.stepSim(1 / 60); } } catch (_) {}

    const overlay = document.createElement("div");
    overlay.id = "__deckOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f2f8fc;text-shadow:0 2px 9px #001019;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-read></div><div data-note></div><div data-source></div>";
    document.body.appendChild(overlay);
    S = window.__deckStage = { overlay, used: {}, hulls: {} };
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

  // ---- the subject: a REGISTERED great white -------------------------------
  const list = (CBZ.cityWildlifeList && CBZ.cityWildlifeList()) || [];
  const actor = list.find((a) => a && a.species && a.species.id === "great_white_shark" &&
    !a.dead && !a.tamed && !a.ridden);
  if (!actor) return { ok: false, missing: "great_white_shark" };
  const grp = actor.group;
  const draft = actor.swimDepth || 2.45;
  const surf0 = CBZ.citySeaHeightAt(anchor.x, anchor.z);
  const heading = 0;                                   // swims toward +x, always
  grp.position.set(anchor.x, surf0 - draft, anchor.z);
  actor.home.x = anchor.x; actor.home.z = anchor.z;
  actor.heading = heading;
  grp.visible = true;
  const liveMats = () => {
    grp.matrixAutoUpdate = true;
    grp.traverse((o) => { o.matrixAutoUpdate = true; });
    grp.updateMatrix(); grp.updateMatrixWorld(true);
  };
  liveMats();
  if (actor._waterMove) { actor._waterMove.x = anchor.x; actor._waterMove.z = anchor.z; }

  // The player stands where the deck will be — abeam the shark at the declared
  // range. wildlife.js's aquatic tick and this file's own LOD both measure from
  // the player, so this is what decides whether the BODY or the PROXY draws.
  const sideD = Number(subject.side) || 8;
  const px = anchor.x - Number(subject.ahead || 0), pz = anchor.z + sideD;
  const P = CBZ.player && CBZ.player.pos;
  if (P) {
    P.x = px; P.z = pz; P.y = surf0 + (Number(subject.camEye) || 3);
    CBZ.player.hp = 100;
  }

  // ---- drive the production code to ONE declared beat ----------------------
  const pin = () => { grp.position.x = anchor.x; grp.position.z = anchor.z; };
  let huntState = null;
  if (typeof CBZ.sharkBrain === "function") {
    for (let i = 0; i < 200; i++) {
      pin();
      if (CBZ.player) CBZ.player.hp = 100;
      try { CBZ.sharkBrain(actor, 1 / 60, P); } catch (_) {}
    }
    // Hold the beat. The two pages cannot share an rng stream, so the FSM may
    // sit in different phases after a free run; forcing the state and driving
    // the file's OWN locomotion seam pins the instant without bypassing a line
    // of the production path. Speed is real (the proxy measures displacement),
    // so x/z are restored after each step instead of before it.
    const s = actor._shark;
    if (s && s.opts && typeof s.opts.move === "function") {
      s.state = String(subject.beat || "circle");
      s.diveWant = draft * Number(subject.depthK || 0.92);
      const spd = Number(subject.speed) || 3;
      const turn = Number(subject.turn || 0);
      for (let i = 0; i < 260; i++) {
        if (!turn) actor.heading = heading;
        s.opts.move(actor, turn ? actor.heading + turn : heading, spd, 1 / 60);
        pin();
      }
      // THE LAST HALF SECOND, UNPINNED AND TICKED. The proxy measures speed
      // and turn rate off the transform between its OWN ticks, and smooths
      // both (a wake that snapped would be worse than no wake) — so a run that
      // pins the animal to one spot and then reads it once photographs a shark
      // moving at a twentieth of its real speed, with no bank and no spray.
      // These frames let it genuinely swim and tick the production proxy on
      // every one of them. predatorHunt is stubbed to the DECLARED beat for
      // the duration — the hunt is not what is being photographed here, and
      // stubbing it is what makes both builds photograph the same instant.
      const realHunt = CBZ.predatorHunt;
      CBZ.predatorHunt = function () { return String(subject.beat || "circle"); };
      try {
        for (let i = 0; i < 42; i++) {
          if (!turn) actor.heading = heading;
          s.diveWant = draft * Number(subject.depthK || 0.92);
          s.opts.move(actor, turn ? actor.heading + turn : heading, spd, 1 / 60);
          if (CBZ.player) CBZ.player.hp = 100;
          try { CBZ.sharkBrain(actor, 1 / 60, P); } catch (_) {}
        }
      } finally { CBZ.predatorHunt = realHunt; }
      s.state = String(subject.beat || "circle");
      s.diveWant = draft * Number(subject.depthK || 0.92);
    } else {
      // one brain tick so the proxy is solved against the final body transform
      try { CBZ.sharkBrain(actor, 1 / 60, P); } catch (_) {}
    }
    const st = CBZ.sharkState ? CBZ.sharkState(actor) : null;
    huntState = st && st.state;
  }
  liveMats();
  const bx = grp.position.x, bz = grp.position.z;
  const surf = CBZ.citySeaHeightAt(bx, bz);

  // ---- the boat: a real production hull on the real sea --------------------
  const hullKey = String(subject.hull || "yacht");
  let hull = S.hulls[hullKey] || null;
  if (!hull && CBZ.marineHulls && CBZ.marineHulls.build) {
    try { hull = CBZ.marineHulls.build(hullKey); } catch (_) { hull = null; }
    if (hull) {
      hull.userData.dynamic = true;
      CBZ.scene.add(hull);
      S.hulls[hullKey] = hull;
    }
  }
  for (const k of Object.keys(S.hulls)) S.hulls[k].visible = (k === hullKey);
  let deckTop = surf + (Number(subject.camEye) || 3);
  let railZ = bz + sideD - Math.min(3.2, sideD * 0.35);
  if (hull) {
    // Lie alongside, FORE-AND-AFT along the shark's own axis, positioned so the
    // NEAR RAIL — not the centreline — is the declared range off the animal.
    // "Eight metres off the rail" has to mean the rail or the label is a lie.
    hull.position.set(0, 0, 0);
    hull.rotation.set(0, 0, 0);
    hull.updateMatrixWorld(true);
    let hb = new T.Box3().setFromObject(hull);
    if ((hb.max.z - hb.min.z) > (hb.max.x - hb.min.x)) {
      hull.rotation.y = Math.PI / 2;                 // this hull is beam-on to +x
      hull.updateMatrixWorld(true);
      hb = new T.Box3().setFromObject(hull);
    }
    const halfBeam = (hb.max.z - hb.min.z) * 0.5;
    hull.position.set(bx - Number(subject.ahead || 0), surf, bz + sideD + halfBeam);
    hull.updateMatrixWorld(true);
    hb = new T.Box3().setFromObject(hull);
    deckTop = hb.max.y;
    // AT THE RAIL, NOT IN THE SALOON. The camera used to stand a flat 3.2 m
    // inboard of the hull's CENTRELINE, which on a 34 m yacht is inside the
    // superstructure: three of these frames photographed a doorway and a
    // banquette instead of a shark, and no metric in the table could say so.
    // It stands at the near rail now, measured off the hull that is there.
    railZ = hb.min.z + 0.45;
  }

  // ---- camera: standing at the rail ---------------------------------------
  const camera = CBZ.camera;
  let camPos, camAim;
  if (ref && ref.camera) { camPos = ref.camera.position.slice(); camAim = ref.camera.target.slice(); }
  else {
    const eye = surf + (Number(subject.camEye) || 3);
    camPos = [bx - Number(subject.ahead || 0), eye, railZ];
    camAim = subject.topDown
      ? [bx, surf - Number(subject.aimDown || 1), bz]
      : [bx, surf - Number(subject.aimDown || 0.4) * 0.35, bz];
  }
  camera.aspect = input.width / input.height;
  camera.fov = subject.topDown ? 60 : 48;
  camera.near = 0.12; camera.far = 24000;
  camera.position.set(camPos[0], camPos[1], camPos[2]);
  camera.lookAt(camAim[0], camAim[1], camAim[2]);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const rig = CBZ.skyDome && CBZ.skyDome.parent;
    if (rig && rig.position) rig.position.set(camPos[0], 0, camPos[2]);
  }
  hideHud();
  CBZ.renderer.render(CBZ.scene, camera);

  // ---- read the surface, from the file that draws it -----------------------
  const R = (CBZ.sharkSurfaceRead && CBZ.sharkSurfaceRead(actor)) || {};
  const box = new T.Box3().setFromObject(grp);
  const bodyPlan = (R.planLenM || 1) * (R.planBeamM || 1);
  const distM = Math.hypot(bx - camPos[0], bz - camPos[2]);
  const handover = R.proxyFinM > 0.02
    ? Math.abs((R.proxyFinM || 0) - (R.authoredM || 0)) : null;

  const before = input.side === "before";
  const q = (n) => S.overlay.querySelector(`[data-${n}]`);
  const put = (n, text, css) => { const el = q(n); if (el) { el.textContent = text; el.style.cssText = css; } };
  put("side", before ? input.beforeLabel : input.afterLabel,
    `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`);
  put("name", subject.label, "position:absolute;top:64px;left:26px;font-size:26px;font-weight:800;letter-spacing:-.02em");
  put("focus", subject.focus, "position:absolute;top:100px;left:28px;color:#c3d4de;font-size:13px;font-weight:550;max-width:720px;line-height:1.35");
  put("state", subject.state + (huntState ? "  ·  " + huntState : ""),
    `position:absolute;right:26px;top:25px;color:${before ? "#ffb0b0" : "#7ff0bb"};font-size:11px;font-weight:900;letter-spacing:.1em`);
  put("read",
    `dorsals ${R.dorsals} · fin ${(R.finM || 0).toFixed(2)}m (proxy ${(R.proxyFinM || 0).toFixed(2)} / body ${(R.authoredM || 0).toFixed(2)})` +
    `\ndepth ${(R.depthM || 0).toFixed(2)}m · shadow ${(R.shadowAreaM2 || 0).toFixed(1)}m2 off ${(R.shadowOffsetM || 0).toFixed(2)}m · wake ${(R.wakeLenM || 0).toFixed(1)}m` +
    `\nconcavity ${(R.concavity || 0).toFixed(3)} · fill ${(R.shapeFill || 0).toFixed(3)} · meshes ${R.meshes || 0}` +
    `\ntail ${(R.tailTipM || 0).toFixed(2)}m · bank ${(R.finBankRad || 0).toFixed(2)}rad · spray ${(R.sprayAlpha || 0).toFixed(2)}`,
    `position:absolute;right:26px;top:52px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;text-align:right;color:${R.dorsals === 1 ? "#9fe8c3" : "#ff9c9c"}`);
  put("note", subject.note, "position:absolute;right:26px;bottom:20px;padding:7px 10px;border-radius:6px;background:rgba(3,18,28,.72);color:#bfe9ff;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;max-width:520px");
  put("source", new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname,
    "position:absolute;bottom:20px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace");

  return {
    ok: true,
    anchor,
    hull: hullKey,
    deckTop: Number(deckTop.toFixed(2)),
    huntState,
    bodyTopAboveSurfaceM: Number((box.max.y - surf).toFixed(3)),
    camera: { position: camPos.slice(), target: camAim.slice() },
    metrics: {
      surfaceDorsals: R.dorsals,
      finExposedM: Number((R.finM || 0).toFixed(3)),
      finHandoverErrM: handover == null ? null : Number(handover.toFixed(3)),
      finConcavity: Number((R.concavity || 0).toFixed(3)),
      shadowShapeFill: Number((R.shapeFill || 0).toFixed(3)),
      shadowAreaRatio: bodyPlan > 0 ? Number(((R.shadowAreaM2 || 0) / bodyPlan).toFixed(3)) : 0,
      shadowOffsetM: Number((R.shadowOffsetM || 0).toFixed(3)),
      shadowAlpha: Number((R.shadowAlpha || 0).toFixed(3)),
      wakeLenM: Number((R.wakeLenM || 0).toFixed(2)),
      tailTipM: Number((R.tailTipM || 0).toFixed(3)),
      finBankRad: Number(Math.abs(R.finBankRad || 0).toFixed(3)),
      sprayAlpha: Number((R.sprayAlpha || 0).toFixed(3)),
      bodyDrawn: R.bodyOnScreen ? 1 : 0,
      subjectDistM: Number(distM.toFixed(1)),
      proxyMeshes: R.meshes || 0,
    },
  };
}

export default {
  id: "shark-from-deck",
  title: "From A Boat Deck — The Fin, The Wake And The Shadow",
  description: "Seven frames from the real game world (seed 90210) put a hunting great white alongside a real production hull — a 34 m yacht and a 14 m cruiser — and photograph it from the deck: a closed pass at 8 m, a lone fin at 40 m, straight down from the flybridge, a shark passing under the keel, a rush breaking the surface, the LOD handover at 90 m where the authored dorsal gives way to the proxy, and a hard turn where the blade banks and the upper caudal lobe shows. The before side is this same checkout with SHARK_FIN_V2 / SHARK_WAKE_V2 / SHARK_SHADOW_V2 / SHARK_SHADOW_VIEW off: a flat cone raised on a fade curve, an oversized white V and one soft ellipse. The after side reads the owner's photographs — a scythe blade whose exposure follows the animal's real depth in the live swell, a wake small enough to have to look for, and a shark-SHAPED mass with its own sun-offset shadow.",
  defaultBefore: "local",
  beforeParams: {
    cfg_SHARK_FIN_V2: 0,
    cfg_SHARK_WAKE_V2: 0,
    cfg_SHARK_SHADOW_V2: 0,
    cfg_SHARK_SHADOW_VIEW: 0,
    cfg_SHARK_TAIL_TIP: 0,
    cfg_SHARK_SURFACE_LIFE: 0,
  },
  beforeLabel: "BEFORE · FLAGS OFF",
  afterLabel: "AFTER · LOCAL",
  pairNote: "Same seed · same water · same hull · same camera · same production tick · four flags",
  method: "Each page boots its own city at seed 90210, freezes the rAF loop, seeds Math.random from one LCG, pins the day phase, drops a real world/water_hulls.js hull on a deterministic point of open ocean, teleports a registered great white alongside and drives that page's own CBZ.sharkBrain and city/wildlife_shark.js locomotion seam to one declared beat. Every number in the table is read back from CBZ.sharkSurfaceRead — the file measuring itself.",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  metrics: {
    surfaceDorsals: { label: "Separate dorsals cutting the surface (1 is correct)", unit: "", better: "lower" },
    finExposedM: { label: "Blade out of the water", unit: "m" },
    finHandoverErrM: { label: "Jump at the body->proxy handover", unit: "m", better: "lower" },
    finConcavity: { label: "Trailing-edge concavity (a cone is 0)", unit: "×chord", better: "higher" },
    shadowShapeFill: { label: "Underwater mass fill of its own box (an ellipse is 0.785)", unit: "", better: "lower" },
    shadowAreaRatio: { label: "Underwater mass area vs the body's plan area", unit: "×" },
    shadowOffsetM: { label: "Shadow offset from the body, away from the sun", unit: "m", better: "higher" },
    shadowAlpha: { label: "Underwater mass opacity at this depth and view angle", unit: "" },
    wakeLenM: { label: "Wake length", unit: "m", better: "lower" },
    tailTipM: { label: "Upper caudal lobe out of the water (NOT a second dorsal)", unit: "m", better: "higher" },
    finBankRad: { label: "Blade roll into the turn", unit: "rad", better: "higher" },
    sprayAlpha: { label: "Spray off the blade", unit: "", better: "higher" },
    bodyDrawn: { label: "Authored body on screen", unit: "0/1" },
    subjectDistM: { label: "Camera to shark", unit: "m" },
    proxyMeshes: { label: "Meshes in the surface proxy", unit: "" },
  },
  metricsNote: "One dorsal at the surface is correct; two is the owner's \"another fin above the fin\". finExposedM has no better direction — it must MATCH the animal's depth, which is what finHandoverErrM measures. wakeLenM should go DOWN everywhere except the rush frame, which is the one place the big V is earned.",
  subjects,
  stage: stageDeck,
};
