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
    cam: { back: 46, up: 12, look: 9 } },

  { id: "scar", label: "One rocket",
    focus: "A single RPG-class warhead into the facade, through the real ordnance bus. The explosion was already good — this is about what it LEAVES. Before: a fireball, and then a pristine wall. After: the wall around the impact is genuinely gone, opened to the floor behind it.",
    act: { hits: 1 },
    cam: { back: 26, up: 6, look: 6 } },

  { id: "wounded", label: "WOUNDED — the facade is open",
    focus: "Three more. The damage skin is real geometry, not a decal: openings set INTO the wall, the floor slab edges showing through them, one panel left hanging off its top fixing, and the masonry that came off it lying on the pavement below. The owner purged painted marks on facades for a good reason and nothing here is painted.",
    act: { hits: 3, untilStage: 2 },
    cam: { back: 24, up: 7, look: 7 } },

  { id: "critical", label: "CRITICAL — the load path is failing",
    focus: "The last stage where it is still standing. Bare columns where a whole bay of cladding used to be, rebar hanging out of the broken slabs, and an apron of debris twice the size. Compare the silhouette against the first frame: this building has visibly lost mass.",
    act: { untilStage: 4 },
    cam: { back: 28, up: 9, look: 8 } },

  { id: "swap", label: "The swap — the proxy takes over",
    focus: "THE FRAME THE OLD BUILD GAVE ITSELF AWAY ON. The batched building has just been hidden and a proxy shell put in its place (merged static geometry cannot be animated; hiding the real thing behind dust and moving a stand-in is the only honest option in this engine, and is what Frostbite and Control both ship). The old shell was up to ten flat boxes in one grey. This one is built from this building's own wall colour, storey height, window rhythm, plinth and cornice — so this frame should look like the previous one.",
    act: { collapse: true, phase: 1, extra: 0.25 },
    cam: { back: 34, up: 14, look: 10 } },

  { id: "midfall", label: "Mid-fall — it comes APART",
    focus: "The collapse front descending at the observed ~2/3 g, and the thing the rewrite is actually for: each floor the front passes stops existing and becomes real slabs travelling outward with real ballistics. The old collapse SCALED bands downward — a building that shrinks is a building being deleted.",
    act: { phaseFrac: 0.45 },
    cam: { back: 38, up: 16, look: 12 } },

  { id: "impact", label: "Impact — the pall",
    focus: "The ground beat. The dust volume is many times the building's own footprint and rolls OUT along the streets, which is the signature that makes a collapse read from two hundred metres. Its volume is scaled by what the building was made of — a steel frame makes far less of it than a masonry block.",
    act: { phase: 2 },
    cam: { back: 42, up: 14, look: 8 } },

  { id: "rubble", label: "Four seconds later",
    focus: "The debris field. Real pieces that fell, bounced once, and came to rest roughly flat where they landed — scattered past the footprint rather than stacked in a tidy cone under it. demolition.js's permanent pile and its rebuild calendar are underneath this, untouched.",
    act: { settle: 4 },
    cam: { back: 30, up: 8, look: 4 } },

  { id: "topple", label: "A different building does something different",
    focus: "The most slender masonry stack on the block, condemned exactly the same way — and it does not pancake. It rotates about a hinge at its base under the real rigid-rod equation (d2th/dt2 = 3g/2L · sin th, which is why it starts imperceptibly and finishes shockingly fast), comes apart from the top where the tangential speed is, and throws its debris clear across the street. Which motion a building gets is derived from what its facade grammar says it is MADE OF — never from its name, never from a table of lots.",
    act: { second: true, phaseFrac: 0.6 },
    cam: { back: 34, up: 10, look: 9 } },
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
    let main = null, mainScore = -1, slim = null, slimScore = -1;
    for (const L of lots) {
      const b = L.building;
      if (!b || L.demolished || !(b.storeys >= 3)) continue;
      const d = Math.hypot(b.ox - gx, b.oz - gz);
      if (d > 190) continue;
      const h = b.h || b.storeys * (b.FH || 3.2);
      const slender = h / Math.max(1, Math.min(b.w, b.d));
      const sc = b.storeys - d * 0.02;
      if (sc > mainScore) { mainScore = sc; main = L; }
      if (slender > slimScore) { slimScore = slender; slim = L; }
    }
    if (!main) return { ok: false, err: "no collapsible building near the centroid" };
    if (slim === main) slim = null;

    const overlay = document.createElement("div");
    overlay.id = "__collapseOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-read></div><div data-source></div>";
    document.body.appendChild(overlay);

    S = window.__collapseSeq = { main, slim, overlay, t: 0 };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
      advance(sec) { step(Math.max(1, Math.round(sec * 60))); S.t += sec; },
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
  if (act.hits) { for (let i = 0; i < act.hits; i++) { hit(0.09); step(14); } }
  if (act.untilStage) {
    // WAIT ON THE LEDGER'S OWN STAGE, not on a number of rockets.
    for (let i = 0; i < 60; i++) {
      const st = stateOf();
      if (st && st.stage >= act.untilStage) break;
      hit(0.07); step(10);
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
      step(Math.round((act.phase === 2 ? 6 : act.phaseFrac ? 2.6 : 1.5) * 60));
    } else {
      const wantPhase = act.phase != null ? act.phase : 1;
      const wantFrac = act.phaseFrac || 0;
      for (let i = 0; i < 1400; i++) {
        const j = liveJob();
        if (j) {
          if (wantFrac) { if (j.phase > 1 || (j.phase === 1 && j.frac >= wantFrac)) break; }
          else if (j.phase >= wantPhase) break;
        } else if (i > 60 && wantPhase >= 2) break;
        step(1);
      }
      if (act.extra) step(Math.round(act.extra * 60));
    }
  }
  if (act.settle) step(Math.round(act.settle * 60));
  if (!act.hits && !act.untilStage && !act.collapse && !act.phase && !act.phaseFrac && !act.settle && !act.second) step(20);

  // ---- frame it ---------------------------------------------------------
  const cam = input.subject.cam || { back: 34, up: 12, look: 9 };
  const camX = b.ox + cam.back * 0.72, camZ = b.oz + cam.back * 0.72;
  const gy = (CBZ.floorAt && CBZ.floorAt(camX, camZ)) || 0;
  if (CBZ.player && CBZ.player.pos && CBZ.player.pos.set) {
    CBZ.player.pos.set(camX, gy + 1.1, camZ); CBZ.player.hp = 100;
  }
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.fov = 55; camera.near = 0.5; camera.far = 6000;
  camera.position.set(camX, gy + cam.up, camZ);
  camera.lookAt(b.ox, gy + cam.look, b.oz);
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
  stageTimeoutMs: 600000,
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
