/* THE BUILDING DESTRUCTION STORYBOARD for tools/visual-compare.mjs.

   OWNER (verbatim): "buildings with facades in nat disaster and buildings in
   gang city — all buildings when hit with plane in gang city or earthquake in
   nat disaster or rpg or airstrike — they need an animation of collapsing that
   is much more real. The RPG explosion is amazing because it looks real but
   the effect of the rpg on buildings isn't real yet … all stages of
   destruction … use before after tool."

   So this photographs the EFFECT, not the explosion. One building in the real
   city, hit with real ordnance through the real ledger, at every stage it
   passes through on the way down:

     skyline    the block standing. On the after side it is wearing the facade
                kit (FACADE_KIT_CITY, now on for gang city); on the deployed
                before side the same lots are bare boxes.
     scar       ONE rocket. The wound, and the first thing the old build never
                had: the wall around it is visibly missing.
     wounded    three more. Blown openings with the FLOOR SLAB EDGES showing
                through them, a panel hanging off its top fixing, masonry on
                the pavement.
     critical   the load path is going. Bare columns where the cladding was,
                rebar out of the broken slabs, a real apron of debris. This is
                the frame that has to make you say "that is coming down".
     swap       ~0.2 s after the proxy shell replaces the real building. THE
                test of the whole rewrite: the shell is built from this
                building's own wall colour, storey height, window rhythm,
                plinth and cornice, so this frame should be indistinguishable
                from the one before it. The old shell was eight flat grey
                boxes and this frame was where every collapse gave itself away.
     midfall    the collapse front, mid-descent — and the building coming APART
                into real slabs instead of scaling downward.
     impact     the ground beat and the dust pall rolling out along the street.
     rubble     the debris field four seconds later. It is still there.
     topple     a SECOND building, the most slender masonry stack on the block,
                condemned the same way — and it does something completely
                different, because it is made of something different. It
                hinges at its base and falls across the street.

   THE COMPARISON IS AGAINST THE DEPLOYED BUILD on purpose. A cfg flag flip
   would be the tighter A/B, but ?cfg_COLLAPSE_V2=0 does not restore the old
   ANIMATION (that code is deleted, not disabled — it snaps to rubble
   instead), so a flag run would compare a spectacle against nothing and
   flatter itself. The deployed build is the picture the owner actually has.

   PACING IS ON PHYSICAL STATE, NOT ON SECONDS (see the README's rule): every
   beat waits on the ledger's own reported stage or on the collapse engine's
   own reported phase, so both sides land on the same beat even though the
   two builds run the sequence at different speeds. */

const subjects = [
  { id: "skyline", label: "The block, standing",
    focus: "Gang city at street level. The AFTER side is wearing the facade kit — FACADE_KIT_CITY is on now, so an ordinary undressed lot gets a grammar by position hash and the skyline stops being a row of painted boxes. Nothing here is a new building: it is the same lot, the same footprint, the same colour, with its own architecture on it.",
    cam: { back: 3.1, up: 0.75, look: 0.45 } },

  { id: "scar", label: "One rocket",
    focus: "A single RPG-class warhead into the facade, through the real ordnance bus. The explosion was already good — this is about what it LEAVES. Before: a fireball, and then a pristine wall. After: the wall around the impact is genuinely gone, opened to the floor behind it.",
    act: { hits: 1 },
    cam: { back: 2.1, up: 0.50, look: 0.38 } },

  { id: "wounded", label: "WOUNDED — the facade is open",
    focus: "Three more. The damage skin is real geometry, not a decal: openings set INTO the wall, the floor slab edges showing through them, one panel left hanging off its top fixing, and the masonry that came off it lying on the pavement below. The owner purged painted marks on facades for a good reason and nothing here is painted.",
    act: { hits: 3, untilStage: 2 },
    cam: { back: 2.1, up: 0.55, look: 0.42 } },

  { id: "critical", label: "CRITICAL — the load path is failing",
    focus: "The last stage where it is still standing. Bare columns where a whole bay of cladding used to be, rebar hanging out of the broken slabs, and an apron of debris twice the size. Compare the silhouette against the first frame: this building has visibly lost mass.",
    act: { untilStage: 4 },
    cam: { back: 2.5, up: 0.62, look: 0.45 } },

  { id: "swap", label: "The swap — the proxy takes over",
    focus: "THE FRAME THE OLD BUILD GAVE ITSELF AWAY ON. The batched building has just been hidden and a proxy shell put in its place (merged static geometry cannot be animated; hiding the real thing behind dust and moving a stand-in is the only honest option in this engine, and is what Frostbite and Control both ship). The old shell was up to ten flat boxes in one grey. This one is built from this building's own wall colour, storey height, window rhythm, plinth and cornice — so this frame should look like the previous one.",
    act: { collapse: true, phase: 1, extra: 0.25 },
    cam: { back: 2.9, up: 0.80, look: 0.50 } },

  { id: "midfall", label: "Mid-fall — it comes APART",
    focus: "The collapse front descending at the observed ~2/3 g, and the thing the rewrite is actually for: each floor the front passes stops existing and becomes real slabs travelling outward with real ballistics. The old collapse SCALED bands downward — a building that shrinks is a building being deleted.",
    act: { phaseFrac: 0.45 },
    cam: { back: 3.1, up: 0.90, look: 0.50 } },

  { id: "impact", label: "Impact — the pall",
    focus: "The ground beat. The dust volume is many times the building's own footprint and rolls OUT along the streets, which is the signature that makes a collapse read from two hundred metres. Its volume is scaled by what the building was made of — a steel frame makes far less of it than a masonry block.",
    act: { phase: 2 },
    cam: { back: 3.3, up: 0.70, look: 0.28 } },

  { id: "rubble", label: "Four seconds later",
    focus: "The debris field. Real pieces that fell, bounced once, and came to rest roughly flat where they landed — scattered past the footprint rather than stacked in a tidy cone under it. demolition.js's permanent pile and its rebuild calendar are underneath this, untouched.",
    act: { settle: 4 },
    cam: { back: 2.7, up: 0.45, look: 0.14 } },

  { id: "topple", label: "The same question, asked of a different building",
    focus: "The most slender stack under sixteen storeys near the first subject, condemned in exactly the same way. It may or may not fall differently — that is the point, and it is not something this caption gets to decide. Which motion a building gets is derived from what its facade grammar says it is MADE OF and how slender it is: a ductile frame pancakes, a brittle stack rotates about a hinge at its base under the real rigid-rod equation (d2th/dt2 = 3g/2L · sin th, which is why it starts imperceptibly and finishes shockingly fast), a wounded mid-rise shears along the hit, timber folds, adobe crumbles. The grammar this one actually resolved to is named in the readout top-right — read off the live engine, not asserted here. At seed 90210 it comes out `shear` on stone rather than `topple`: the city\'s mid-rise stock is too squat to clear the topple grammar\'s slenderness threshold, so nothing in that height band hinges. That is a fact about this city, not a fault in the picture — and it is exactly the kind of thing a caption that named its own outcome would have hidden.",
    act: { second: true, phaseFrac: 0.6 },
    cam: { back: 3.1, up: 0.75, look: 0.45 } },
];

async function stageCollapse(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
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
      if (child.id === "__collapseOverlay") continue;
      child.style.visibility = "hidden";
    }
  };
  const step = (n, dt) => { for (let i = 0; i < n; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(dt || 1 / 60); if (CBZ.player) CBZ.player.hp = 100; } };
  /* ADVANCE BY SIMULATED SECONDS, AT A COARSE STEP.

     The whole staging of one subject runs inside a SINGLE Runtime.evaluate,
     so its total cost is bounded by stageTimeoutMs (15 min here) — and a
     stepSim on a fully-built city that is on fire with a collapse running
     costs well over a second under software WebGL. Pacing at 1/60 meant the
     "impact" beat asked for 360 of them and blew the whole budget on the
     deployed side, six beats into a run that takes a quarter of an hour to
     reach that point.

     Everything this preset waits for — the collapse front, the fire, the
     dust — is integrated from dt, so the same simulated seconds at 1/20
     produce the same picture for a third of the calls. Seconds are the unit
     that matters; the step size is just what it costs to get there. */
  const advance = (seconds, dt) => {
    // 1/15 is the coarsest step that still resolves a collapse front cleanly
    // (a 52-storey fall is ~8 s, so ~120 samples down its length) while
    // keeping the CALL COUNT — which is what the stage budget actually pays
    // for — inside what a software renderer can afford.
    const d = dt || 1 / 15;
    step(Math.max(1, Math.ceil(seconds / d)), d);
  };

  let S = window.__collapseSeq;
  if (!S) {
    const booted = await until(() => CBZ.game && CBZ.stepSim && document.getElementById("playBtn"), 300000);
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const b = document.getElementById("playBtn"); if (b) b.click();
      return CBZ.game.state === "playing";
    }, 180000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}

    /* WAIT FOR THE CITY TO EXIST BEFORE STOPPING THE CLOCK.

       `game.state === "playing"` is not, in general, "the world is built",
       and once rAF is stubbed nothing that builds on rAF frames can finish —
       CBZ.stepSim does not rescue it, because it runs the updater chain and
       the lot build is not on that chain. Measured on both sides of this
       comparison the lots are already there the moment the mode reports
       playing, so this guard costs one evaluation and returns immediately;
       it is here so that a slower host, a bigger seed or a future streamed
       build cannot silently freeze a half-built city and photograph it.

       It is NOT the fix for the empty-subject failure this preset hit on its
       first run — see the radius note below for that. Do not delete one
       believing it duplicates the other. */
    const built = await until(() => {
      const A = CBZ.city && (CBZ.city.arena || CBZ.city);
      return A && A.lots && A.lots.length > 0;
    }, 420000, 1000);
    if (!built) return { ok: false, err: "the city never built any lots" };
    // and let it settle a few more real frames, so the last lots' buildings
    // are attached rather than half-registered
    await wait(2500);

    // freeze the rAF loop — CBZ.stepSim is the only clock from here, so both
    // sides sample identical simulated seconds regardless of machine speed
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    step(90);

    /* PICK THE SUBJECTS FROM THE LIVE WORLD, never from a typed coordinate.
       A hardcoded lot photographs whatever happens to be there in this seed
       and lies the moment placement moves. `main` is the tallest genuinely
       collapsible building near the city centroid (the one a player would
       actually aim a rocket at); `slim` is the most SLENDER one on the same
       block, which is the geometry the topple grammar exists for. */
    const A = (CBZ.city && (CBZ.city.arena || CBZ.city)) || {};
    const lots = A.lots || [];
    let gx = 0, gz = 0, n = 0;
    for (const L of lots) {
      const x = Number(L.cx != null ? L.cx : L.x), z = Number(L.cz != null ? L.cz : L.z);
      if (Number.isFinite(x) && Number.isFinite(z)) { gx += x; gz += z; n++; }
    }
    gx = n ? gx / n : 0; gz = n ? gz / n : 0;
    /* THE RADIUS IS A PREFERENCE, NOT A FILTER — and this is the fix for the
       failure that killed the first two-sided run.

       This preset used to reject any candidate further than 190 m from the
       lot centroid. MEASURED at seed 90210: the centroid lands at about
       (2668, -367), roughly 2.7 km from the built-up core, because the lot
       list includes far-flung expansion lots that drag the mean away from
       downtown. All 42 buildings of three storeys or more were outside the
       cut, so every one of the nine beats failed with "no collapsible
       building" on a build that has 329 lots — and it failed on the DEPLOYED
       side first, which made it read as a baseline problem rather than as
       this preset's own arithmetic.

       Scoring with a distance PENALTY picks the same downtown tower a sane
       radius would, and cannot return empty however the centroid lands. */
    /* AIM FOR A MID-RISE, NOT FOR THE BIGGEST THING ON THE MAP.

       The score used to be `storeys - distance`, i.e. maximise height, which
       reliably picked the 52-storey flagship. Three reasons that is the wrong
       subject, the first of them observed rather than reasoned:

         1. THE BASELINE CANNOT FINISH IT. On the deployed build the "impact"
            beat — six simulated seconds after that tower is condemned —
            exhausted a 10-minute evaluate budget, and then a 15-minute one at
            a third of the step count. The screenshot of the failed beat then
            timed out too, which throws OUTSIDE --keep-going and took the whole
            run down with it. Whether that is a true hang or merely cost I have
            not established; either way a storyboard subject has to be
            something BOTH sides can finish.
         2. IT IS THE MOST EXPENSIVE SUBJECT IN THE GAME. An 8 s fall through
            52 floors is the longest collapse the engine can produce, asked of
            the side least able to afford it.
         3. IT IS NOT REPRESENTATIVE. A supertall is the exotic case. The shear
            grammar — the one the owner described, where a rocket takes out one
            face and the rest follows — needs a mid-rise by construction, and a
            mid-rise fits in frame whole.

       So: prefer about eight storeys and penalise distance from downtown, and
       let height fall out of the choice rather than drive it. */
    const TARGET_STOREYS = 8;
    let main = null, mainScore = -1e9, slim = null, slimScore = -1e9;
    let candidates = 0;
    for (const L of lots) {
      const b = L.building;
      if (!b || L.demolished || !(b.storeys >= 3)) continue;
      if (!Number.isFinite(b.ox) || !Number.isFinite(b.oz)) continue;
      candidates++;
      const d = Math.hypot(b.ox - gx, b.oz - gz);
      const sc = -Math.abs(b.storeys - TARGET_STOREYS) - d * 0.02;
      if (sc > mainScore) { mainScore = sc; main = L; }
    }
    if (!main) {
      // SAY WHAT WAS ACTUALLY THERE. "no collapsible building" with no numbers
      // behind it is indistinguishable from "the world never built".
      return { ok: false, err: "no building with >=3 storeys in " + lots.length +
        " lots (" + candidates + " candidates, centroid " + gx.toFixed(0) + "," + gz.toFixed(0) + ")" };
    }
    /* THE TOPPLE SUBJECT IS PICKED RELATIVE TO THE MAIN ONE, not to the
       centroid. Its caption promises "the most slender masonry stack ON THE
       SAME BLOCK", and scoring it off the centroid — which in this world sits
       ~2.7 km from the built-up core — makes every distance penalty swamp the
       slenderness it is supposed to be selecting for, so the beat labelled
       "a different building does something different" would photograph
       whatever squat shop happened to be closest and pancake exactly like the
       first one. Search the main subject's own neighbourhood instead. */
    {
      const mb = main.building;
      for (const L of lots) {
        const b = L.building;
        if (!b || L === main || L.demolished || !(b.storeys >= 4)) continue;
        if (!Number.isFinite(b.ox) || !Number.isFinite(b.oz)) continue;
        if (Math.hypot(b.ox - mb.ox, b.oz - mb.oz) > 320) continue;
        /* NOT THE FLAGSHIP. The unbounded version of this picked the
           52-storey supertall — it is genuinely the most slender thing on the
           block — and a supertall is steel, so it resolved to `pancake`,
           which is the SAME family of motion as the main subject and the one
           motion this beat exists not to show. It is also the subject that
           wedged the baseline twice. Cap the height and the tower drops out;
           what is left is the mid-rise masonry stack the topple grammar is
           actually written for. */
        if (b.storeys > 16) continue;
        const h = b.h || b.storeys * (b.FH || 3.2);
        const slender = h / Math.max(1, Math.min(b.w, b.d));
        if (slender > slimScore) { slimScore = slender; slim = L; }
      }
    }
    if (slim === main) slim = null;

    const overlay = document.createElement("div");
    overlay.id = "__collapseOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-read></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__collapseSeq = { main, slim, overlay, t: 0 };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
      advance(sec) { advance(sec); S.t += sec; },
    };
  }

  const act = input.subject.act || {};
  const lot = act.second && S.slim ? S.slim : S.main;
  const b = lot.building;
  const woundY = Math.min(b.h || 12, (b.FH || 3.2) * 1.5 + 1.2);

  // ---- act on the world -------------------------------------------------
  const stateOf = () => {
    try { return CBZ.structure && CBZ.structure.state ? CBZ.structure.state(lot) : null; } catch (_) { return null; }
  };
  /* A ROCKET IS A SHARE OF THE BUILDING, NOT A CONSTANT. capacityOf() in
     city/structural.js is 12 + storeys*7 + plan/26, so a fixed damage number
     is four rockets to a corner shop and a rounding error to a 52-storey
     tower — the two sides would photograph completely different amounts of
     destruction on two differently-sized subjects. Ask the ledger what this
     building can take. */
  const capOf = () => { const st = stateOf(); return (st && st.cap) || 60; };
  const hit = (share) => {
    try {
      CBZ.structure.hit(b.ox, woundY, b.oz, Math.max(4, capOf() * share), {
        kind: "rpg", lot: lot, dirx: 1, dirz: 0, sudden: true,
      });
    } catch (_) {}
  };
  if (act.hits) { for (let i = 0; i < act.hits; i++) { hit(0.09); advance(0.25); } }
  if (act.untilStage) {
    // WAIT ON THE LEDGER'S OWN STAGE, not on a number of rockets.
    for (let i = 0; i < 60; i++) {
      const st = stateOf();
      if (st && st.stage >= act.untilStage) break;
      hit(0.07); advance(0.2);
    }
  }
  if (act.collapse) {
    try { CBZ.structure.forceCollapse(lot, { byPlayer: true }); } catch (_) {}
  }
  if (act.second && !S.secondFired) {
    S.secondFired = true;
    try { CBZ.structure.forceCollapse(lot, { byPlayer: true }); } catch (_) {}
  }
  /* ADVANCE TO A PHASE OF THE ENGINE'S OWN CHOREOGRAPHY, not to a wall-clock
     second (README: "never wait a number of seconds"). CBZ.collapse.debug()
     publishes each live job's phase (0 pre-shudder, 1 falling, 2 settling)
     and how far through its fall it is, so both sides land on the identical
     beat however fast they simulate. A build that has no collapse engine at
     all — the deployed before side — falls back to a fixed burst, which is
     the honest thing to do when there is no state to wait on. */
  const liveJob = () => {
    if (!CBZ.collapse || !CBZ.collapse.debug) return null;
    const d = CBZ.collapse.debug();
    if (!d.jobs.length) return null;
    let best = d.jobs[0], bd = 1e9;
    for (const j of d.jobs) {
      const dd = Math.hypot(j.x - b.ox, j.z - b.oz);
      if (dd < bd) { bd = dd; best = j; }
    }
    return best;
  };
  if (act.phase != null || act.phaseFrac != null) {
    if (!CBZ.collapse || !CBZ.collapse.debug) {
      // no engine on this build (the deployed baseline): there is no state to
      // wait on, so advance the seconds its own collapse takes and photograph
      // whatever it is doing at that moment. Honest, and bounded.
      advance(act.phase === 2 ? 6 : act.phaseFrac ? 2.6 : 1.5);
    } else {
      const wantPhase = act.phase != null ? act.phase : 1;
      const wantFrac = act.phaseFrac || 0;
      // poll on the engine's own published state, but in real slices rather
      // than single frames, and give up after more simulated time than the
      // longest collapse in the game can possibly take (a 52-storey tower is
      // ~8 s of fall plus a 1.15 s tell plus 2.4 s of settle)
      // CAP is the longest collapse the game can produce, with margin: a
      // 52-storey tower is a 1.15 s tell + ~8 s of fall + 2.4 s of settle.
      // Worst case here is ~210 stepSim calls, which fits the budget; the
      // normal case breaks out of the loop long before that.
      const SLICE = 0.3, CAP = 14;
      for (let t = 0; t < CAP; t += SLICE) {
        const j = liveJob();
        if (j) {
          if (wantFrac) { if (j.phase > 1 || (j.phase === 1 && j.frac >= wantFrac)) break; }
          else if (j.phase >= wantPhase) break;
        } else if (t > 1.2 && wantPhase >= 2) break;
        advance(SLICE);
      }
      if (act.extra) advance(act.extra);
    }
  }
  if (act.settle) advance(act.settle);
  if (!act.hits && !act.untilStage && !act.collapse && !act.phase && !act.phaseFrac && !act.settle && !act.second) advance(0.35);

  /* ---- frame it --------------------------------------------------------
     FRAMING IS RELATIVE TO THE BUILDING, NOT IN METRES.

     `back` used to be a distance in metres from the building's CENTRE, and
     the camera was seated at (ox + back*0.72, oz + back*0.72) — a diagonal
     whose true length is back*1.02. So "back: 28" put the eye 28 m from the
     centre of a 30 m-wide block, i.e. about seven metres off its facade, and
     the CRITICAL beat photographed a wall instead of a building. The numbers
     were tuned when this preset expected a 52-storey tower; the moment the
     subject became a mid-rise every one of them was wrong, and the captions
     went on talking about a silhouette nobody could see.

     Now the subject's `cam` fields are MULTIPLIERS on the building's own
     size, so a corner shop and a supertall both fill the frame the same way:

       back  distance as a multiple of the bounding radius (the half-diagonal
             of the elevation, so it accounts for height and plan together)
       up    eye height as a fraction of the building's height
       look  aim height as a fraction of the building's height

     The floor keeps a small building from being shot from inside the kerb.
  --------------------------------------------------------------------- */
  const cam = input.subject.cam || { back: 2.8, up: 0.7, look: 0.45 };
  const bh = b.h || (b.storeys * (b.FH || 3.2)) || 12;
  const radius = Math.hypot(Math.max(b.w, b.d) / 2, bh / 2);
  const dist = Math.max(24, radius * cam.back);
  // a corner view: it shows the wounded face (the hit comes in along +x) and
  // one flank, so the depth of a wound reads instead of flattening out
  const camX = b.ox + dist * 0.707, camZ = b.oz + dist * 0.707;
  const gy = (CBZ.floorAt && CBZ.floorAt(camX, camZ)) || 0;
  if (CBZ.player && CBZ.player.pos && CBZ.player.pos.set) {
    CBZ.player.pos.set(camX, gy + 1.1, camZ); CBZ.player.hp = 100;
  }
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55; camera.near = 0.5; camera.far = 6000;
  camera.position.set(camX, gy + Math.max(2.2, bh * cam.up), camZ);
  camera.lookAt(b.ox, gy + bh * cam.look, b.oz);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  hideHud();
  if (CBZ.renderer.info && CBZ.renderer.info.reset) CBZ.renderer.info.reset();
  CBZ.renderer.render(CBZ.scene, camera);
  const info = CBZ.renderer.info || {};
  const render = info.render || {};

  const st = stateOf() || {};
  const eng = CBZ.collapse ? {
    frags: CBZ.collapse.fragCount(), live: CBZ.collapse.active(), skins: CBZ.collapse.skinCount(),
    predict: CBZ.collapse.predict({
      w: b.w, d: b.d, h: b.h, storeys: b.storeys, FH: b.FH, wall: b.wallColor, masonry: b.masonry,
      style: CBZ.facadePick ? CBZ.facadePick(b.ox, b.oz, b.storeys, b.dress || null) : null,
    }, { nx: 1, nz: 0, floor: 1 }),
  } : { frags: 0, live: 0, skins: 0, predict: null };

  const before = input.side === "before";
  const q = (k) => S.overlay.querySelector(`[data-${k}]`);
  q("side").textContent = before ? input.beforeLabel : input.afterLabel;
  q("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  q("name").textContent = input.subject.label;
  q("name").style.cssText = "position:absolute;top:64px;left:26px;font-size:27px;font-weight:800;letter-spacing:-.02em";
  q("focus").textContent = input.subject.focus;
  q("focus").style.cssText = "position:absolute;top:100px;left:28px;color:#c0cfda;font-size:13px;font-weight:550;max-width:760px;line-height:1.45";
  q("read").textContent = eng.predict
    ? `${b.storeys} storeys · ${eng.predict.material} · grammar "${eng.predict.mode}" · slenderness ${eng.predict.slender} · stage ${st.stage != null ? st.stage : "-"} · ${eng.frags} debris · ${eng.skins} wound skin`
    : `${b.storeys} storeys · stage ${st.stage != null ? st.stage : "-"} · (no collapse engine on this build)`;
  q("read").style.cssText = "position:absolute;right:24px;top:24px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9fe8c3;text-align:right";
  q("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  q("source").style.cssText = "position:absolute;bottom:18px;left:26px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    lot: [Number(b.ox.toFixed(1)), Number(b.oz.toFixed(1))],
    storeys: b.storeys,
    mode: eng.predict ? eng.predict.mode : null,
    material: eng.predict ? eng.predict.material : null,
    metrics: {
      debrisPieces: eng.frags,
      woundSkins: eng.skins,
      ledgerStage: st.stage != null ? st.stage : 0,
      drawCalls: render.calls || 0,
      triangles: render.triangles || 0,
    },
  };
}

export default {
  id: "collapse-stages",
  title: "Every Stage of Destruction: One Building, One Rocket at a Time",
  description: "One real gang-city building hit with real ordnance through the real structural ledger, photographed at every stage it passes through: the intact facade, the first scar, the open wound with its floor slabs showing, the critical load path, the proxy swap, the disintegration mid-fall, the ground pall and the debris field — plus a second building on the same block that collapses in a completely different way because it is made of something different. Beats are paced on the ledger's own reported stage and the engine's own reported phase, never on a wall-clock second.",
  viewport: { width: 1180, height: 700 },
  readyExpression: "document.getElementById('playBtn') && document.querySelector('.mode-btn[data-mode=\"city\"]')",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 900000,
  pairNote: "Same seed · same lot chosen by the same live-world rule · same ordnance · same cameras",
  method: "The real city boots at seed 90210, the rAF clock is frozen and CBZ.stepSim becomes the only time. The subject building is CHOSEN FROM THE LIVE WORLD (tallest collapsible lot near the city centroid) rather than typed as a coordinate, and the topple subject is the most slender masonry stack on the same block. Damage is delivered through CBZ.structure.hit with an rpg row — the same path a real rocket takes — and each beat waits on the ledger's own stage or the collapse engine's own live-job and debris counts, so both builds photograph the same beat at whatever speed they run.",
  metricsNote: "debrisPieces counts the real fragments the collapse engine has in the world at the photographed frame — the old build has no such system, so its column reads zero at every beat and that zero IS the finding. woundSkins is how many buildings are wearing progressive damage dressing. drawCalls is there to prove the spectacle is not being bought with frame time.",
  metrics: {
    debrisPieces: { label: "Real debris in the world", unit: "pieces", better: "higher" },
    woundSkins: { label: "Buildings wearing damage", unit: "buildings", better: "higher" },
    ledgerStage: { label: "Structural stage", unit: "0-6" },
    drawCalls: { label: "Draw calls", unit: "calls", better: "lower" },
    triangles: { label: "Triangles", unit: "tris", better: "lower" },
  },
  subjects,
  stage: stageCollapse,
};
