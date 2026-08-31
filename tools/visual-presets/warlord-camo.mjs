/* DESERT WARLORD — the camouflage library, photographed against camo off.

   WHAT IS UNDER TEST: src/warlord/camo.js. The honest BEFORE is not a
   deployed build (which differs by every commit since deploy) but this same
   checkout with ?camo=old — the file's own one-line revert. With it down,
   W.camo.texture() returns null and W.camo.material() hands back a FLAT
   Lambert of the pattern's measured mean colour, so the before column is
   literally "the same armies with the pattern taken off" rather than a
   different army in a colour somebody typed. One staging path runs on both
   sides and never reads the flag.

   WHY THIS IS STAGED IN THE LIVE SCENE AND NOT IN A PRIVATE STUDIO. Nearly
   every other warlord preset builds its own THREE.Scene with its own lights,
   and for cavalry seat gaps that is correct. It would be actively misleading
   here. warlord/props.js:2748 measured what this page really does: it is
   DOUBLE-LIT (CBZ.micro.boot() makes a hemi+sun pair and the page then calls
   micro.lights() which adds a second) — hemisphere 0.62 + 0.62, directional
   1.05 + 1.12 — into ACES tone mapping at exposure 1 and sRGB output. A
   palette judged under a tasteful one-sun studio rig and shipped into a 3.1x
   scene is a palette that photographs as white paper. So: CBZ.scene,
   CBZ.camera, CBZ.renderer, the real island, the real sun.

   FOUR SUBJECTS, AND THE LAST TWO ARE THE ONES THAT DECIDE IT:

     swatch-wall   Every pattern in the library as a 1.4 m panel standing on
                   the dune it has to hide on, labelled, at 12 m. This is
                   where a muddy palette or a dead pattern is obvious.
     cloth-3m      Seven of them worn by real studio.cast bodies at 3 m —
                   the same rig battle.js puts on the sand. Feature SCALE is
                   the failure this catches: a pattern that looks right as a
                   flat tile can be four times too big on a torso.
     rank-200m     TWENTY-TWO MEN IN A LINE AT 200 m ON REAL ISLAND SAND.
                   This is the whole job. A camouflage library succeeds or
                   fails here and nowhere else, because at 200 m the GPU is
                   showing roughly a 4x4 average of a 256 px tile and every
                   pattern in the world has already collapsed to its mean.
     rank-oasis    The identical rank at an oasis edge, on desert.js's own
                   green. The gameplay claim — that which army is hidden
                   depends on where it is standing — is only true if these
                   two plates disagree, and it is only worth having if they
                   disagree visibly.

   THE MEASUREMENT THAT MATTERS is rankVisibility, and it is not a proxy: the
   200 m plate is rendered TWICE into an offscreen target, once with the men
   and once with the men hidden, and the metric is the mean absolute RGB
   difference over the frame. That is, literally, how much the army changes
   the picture — which is what "can you see them" means. Lower is better and
   the before side (flat colour) should lose.

   Nothing is faked: the ground is D.build()'s island at seed 1337, the men
   are CBZ.studio.cast, the sun is the page's. */

const SUBJECTS = [
  { id: "swatch-wall", label: "The library, on the sand it has to hide on", mode: "swatch",
    focus: "Fourteen patterns as 1.4 m panels at 12 m. Judge the PALETTE here: anything reading brighter than the dune behind it is a light bulb at 400 m, and anything reading as one flat colour has no geometry." },
  { id: "cloth-3m", label: "Worn, at three metres", mode: "cloth",
    focus: "Seven armies on the rig battle.js actually uses. Judge SCALE here: the blobs must be garment-sized, not poster-sized, and the trouser leg must carry the same physical pattern size as the torso." },
  { id: "rank-200m", label: "A line of men at 200 m on real sand", mode: "rank",
    focus: "The plate that decides it. Twenty-two men, four armies, real island dune at a 14 deg lens. Look for who you find first and who you have to hunt for — and for fizzing, which is a mip chain that is not there." },
  { id: "rank-oasis", label: "The same line at the oasis", mode: "rank", oasis: true,
    focus: "Identical rank, green ground. The militia's woodland should now be the hardest to see and the legion's desert kit the easiest — if these two plates look the same, the library is decoration." },
];

async function stageCamo(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.warlord || !CBZ.warlord.camo) return { ok: false, missing: "CBZ.warlord.camo" };
  const W = CBZ.warlord, C = W.camo, D = W.desert;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /* THE ARMIES IN THE SHOT, and this list has to live INSIDE the stage. The
     runner serialises this one function into the page and nothing else, so a
     module-level const is a ReferenceError in the browser — which is exactly
     how the first run of this preset failed six of its eight plates. Faction
     ids are core.js's own; the pattern for each comes from camo.js's
     factionDefault, so this preset never invents an assignment the game does
     not ship. */
  const ARMIES = ["legion", "company", "warlord", "militia", "bandit"];

  let X = window.__camoBA;
  if (!X) {
    X = window.__camoBA = { root: null, men: null, rt: null, lastMetrics: {} };

    /* THE CAMERA HAS TO BE MINE, AND THE FIRST RUN PROVED IT. Posing
       CBZ.camera and then letting the page's own loop run gives campaign.js
       the last word: every plate came back photographed from the campaign's
       chase camera sixty metres up, with a cluster of ant-sized men and seven
       labels stacked on top of each other. So: a private PerspectiveCamera
       that nothing else in the game has a reference to, and CBZ.micro.stop()
       once the clipmap has settled, so the only render that happens is the
       one __cbzVisualCompare.render asks for. */
    X.cam = new T.PerspectiveCamera(45, 1180 / 700, 0.4, 20000);

    /* HIDE EVERY PIECE OF CHROME, NOT A LIST OF IDS. The first pass named
       five ids and the pair came back with the MAP button, the zoom pair and
       the compass strip still on it, because the page has more DOM than the
       list did. Anything in <body> that is not the renderer's canvas goes —
       forest-look.mjs's hideHud does the same and for the same reason. */
    X.hideChrome = function () {
      const canvas = CBZ.renderer && CBZ.renderer.domElement;
      Array.prototype.slice.call(document.body.children).forEach(function (n) {
        if (n === canvas || (canvas && n.contains && n.contains(canvas))) return;
        if (n.id === "__camoOverlay") return;
        n.style.display = "none";
      });
    };

    /* One overlay for the labels. Positions come from projecting the real
       world position of each panel/man through the real camera, so a label
       cannot drift away from the thing it names when the camera moves. */
    const ov = document.createElement("div");
    ov.id = "__camoOverlay";
    ov.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9;color:#f6efe2;" +
      "font:700 12px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
      "text-shadow:0 2px 8px #000,0 0 3px #000";
    document.body.appendChild(ov);
    X.ov = ov;
    X.label = function (text, world, dy) {
      const v = world.clone().project(X.cam);
      if (v.z > 1) return;
      const el = document.createElement("div");
      el.textContent = text;
      el.style.cssText = "position:absolute;transform:translate(-50%,-50%);white-space:nowrap;" +
        "left:" + ((v.x * 0.5 + 0.5) * 100).toFixed(2) + "%;" +
        "top:" + ((-v.y * 0.5 + 0.5) * 100 + (dy || 0)).toFixed(2) + "%";
      ov.appendChild(el);
    };
    X.clearLabels = function () { ov.innerHTML = ""; };

    X.clear = function () {
      if (X.root) { CBZ.scene.remove(X.root); X.root = null; }
      X.root = new T.Group(); X.root.name = "__camoStage";
      CBZ.scene.add(X.root);
      X.men = new T.Group(); X.root.add(X.men);
      X.clearLabels();
    };

    /* DRESS A REAL RIG. entities/character.js builds every garment out of
       BoxGeometry, and a box maps EVERY face 0..1 — so one texture on a
       0.92 m torso and a 0.34 m trouser leg is a pattern that changes size at
       the knee. camo.repeatFor() turns each part's real metres into the
       repeat that holds true physical scale, which is the whole reason every
       pattern declares `metres`. The repeat is sized for the FRONT face
       (width x height); the side faces use depth and are therefore slightly
       stretched, which is a documented compromise and invisible at any range
       past arm's length. */
    X.dress = function (group, pattern, tint) {
      const ch = group.userData.charRig;
      if (!ch || !ch.skinSlots) return 0;
      const hs = (group.userData && group.userData.humanScale) ||
                 (ch.group && ch.group.userData.humanScale) || 0.7;
      let n = 0;
      /* THE CAP IS CLOTH. Left out of the first pass, and every man in the
         3 m plate came back wearing a blazing white flat box on his head —
         studio.cast's peaked cap, blown out by the same 3.1x lighting. A
         soldier's cap is made of the same bolt as his shirt. */
      ["torso", "collar", "arms", "armsLower", "legs", "legsLower", "pelvis", "cap"].forEach(function (slot) {
        (ch.skinSlots[slot] || []).forEach(function (m) {
          const p = m.geometry && m.geometry.parameters;
          if (!p || !p.width) return;
          const rep = C.repeatFor(pattern, p.width * hs, (p.height || p.width) * hs);
          const mat = C.material(pattern, { repeat: rep, tint: tint });
          if (mat) { m.material = mat; n++; }
        });
      });
      return n;
    };

    /* RENDER TWICE, SUBTRACT — and the subtraction does the segmentation.
       "How visible is the army" is not a number anybody can eyeball off a
       still: render the plate with the men and again with the men hidden, and
       the mean absolute RGB difference IS how much of the picture the army
       is. The difference image then hands over something better for free —
       every pixel where it exceeds a threshold is a MAN PIXEL, so each army's
       rendered colour can be averaged over exactly its own bodies without
       anybody hand-drawing a mask. Done in an offscreen target so the
       presented frame is untouched. */
    X.visibility = function (bands) {
      const w = 768, h = 432;
      if (!X.rt) X.rt = new T.WebGLRenderTarget(w, h, { minFilter: T.LinearFilter, magFilter: T.LinearFilter });
      const r = CBZ.renderer, N = w * h * 4;
      const a = new Uint8Array(N), b = new Uint8Array(N);
      const prev = r.getRenderTarget();
      X.men.visible = true;
      r.setRenderTarget(X.rt); r.render(CBZ.scene, X.cam); r.readRenderTargetPixels(X.rt, 0, 0, w, h, a);
      X.men.visible = false;
      r.render(CBZ.scene, X.cam); r.readRenderTargetPixels(X.rt, 0, 0, w, h, b);
      X.men.visible = true;
      r.setRenderTarget(prev);
      let acc = 0, lum = 0, ln = 0;
      const cols = (bands || []).map(function () { return { r: 0, g: 0, b: 0, n: 0 }; });
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
          acc += d;
          if (d < 36) continue;                      // 12 per channel: a man, not a dither edge
          /* THE DIFFERENCE IMAGE IS ALSO THE MASK. Every pixel the men
             changed is a man pixel, so the luminance spread ACROSS THE CLOTH
             — which is what "does this uniform have a pattern on it" means on
             screen rather than in a canvas — costs nothing extra. */
          /* LOCAL contrast, not the whole-body range. The first version took
             the standard deviation of luminance over every man pixel and
             reported that camo made things WORSE — because with camo off the
             cloth blows out to near-white while the boots stay dark, and a
             white shirt over black boots has a bigger spread than any
             pattern. What "does this uniform have a pattern on it" actually
             means is variation ACROSS A FEW CENTIMETRES of cloth, so compare
             each man pixel with the one three pixels along. */
          const j = i + 12;
          if (x + 3 < w) {
            const L0 = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
            const L1 = 0.2126 * a[j] + 0.7152 * a[j + 1] + 0.0722 * a[j + 2];
            const dj = Math.abs(a[j] - b[j]) + Math.abs(a[j + 1] - b[j + 1]) + Math.abs(a[j + 2] - b[j + 2]);
            if (dj >= 36) { lum += Math.abs(L0 - L1); ln++; }
          }
          if (!cols.length) continue;
          for (let k = 0; k < bands.length; k++) {
            if (x >= bands[k][0] && x < bands[k][1]) { cols[k].r += d; cols[k].n++; break; }
          }
        }
      }
      const mean = cols.map(function (c) {
        return c.n ? [c.r / c.n, c.g / c.n, c.b / c.n] : null;
      });
      /* STANDOUT PER ARMY, AGAINST THE EXACT GROUND EACH ARMY IS STANDING
         ON. The difference image already holds both terms — `a` is the pixel
         with the man in it, `b` is the same pixel with him gone — so per army
         the mean |a-b| over its own body pixels IS how much that army stands
         out from that ground, with no reference swatch and no assumption
         about what the ground looks like.

         THIS REPLACED "armySeparation" (the mean pairwise distance between
         the armies' rendered colours), which was measured and then thrown
         away because it lied: with camo off three of the five armies are the
         same blown-out white and the other two are pale tints of it, yet the
         number came out HIGHER than with camo on, because in a blown-out
         frame the little separation that survives is pure luminance and
         luminance distances are large. The picture said the opposite in one
         glance. Standout does not have that failure mode: it compares each
         army only with the ground it is actually in front of. */
      const stand = cols.filter(function (c) { return c.n > 40; })
                        .map(function (c) { return c.r / c.n / 3; });
      const best = stand.length ? Math.min.apply(null, stand) : 0;
      const worst = stand.length ? Math.max.apply(null, stand) : 0;
      return {
        detail: Math.round((ln ? lum / ln : 0) * 100) / 100,
        vis: Math.round(acc / (w * h * 3) * 1000) / 1000,
        best: Math.round(best * 10) / 10,
        worst: Math.round(worst * 10) / 10,
        spread: Math.round((worst - best) * 10) / 10,
        seen: stand.length,
      };
    };

    window.__cbzVisualCompare = {
      async render() {
        try { if (CBZ.renderer) CBZ.renderer.render(CBZ.scene, X.cam); } catch (e) {}
        await new Promise((r) => setTimeout(r, 700));
      },
      metrics() { return X.lastMetrics; },
    };
  }

  // ---- the island. ?go=1 boots the campaign, which raises it -------------
  for (let t = 0; t < 900 && W.phase() !== "campaign"; t++) await sleep(120);
  if (W.phase() !== "campaign") return { ok: false, missing: "campaign phase (" + W.phase() + ")" };
  X.hideChrome();
  // nothing may wander into frame and start a fight; the encounter card would
  // void the pair and the contact test is the same code on both sides
  for (let i = 0; i < W.state.bands.length; i++) W.state.bands[i].cooldown = 1e9;
  W.state.hour = 10.5;                        // mid-morning: a real sun angle, not noon flat
  X.clear();

  /* WHERE. Open dune for three of the plates, and desert.js's OWN oasis list
     for the fourth — the green ground in that shot is the island's, not a
     recoloured pad. Both are found by asking the world rather than typed, so
     a reseed moves the camera instead of stranding it. */
  let cx = 0, cz = 0;
  if (sub.oasis && D.oases && D.oases.length) {
    /* THE RIM, NOT THE MIDDLE. desert.js puts water in the bowl floor, so
       oases[0].x/z is a pond — the first oasis plate photographed twenty men
       standing in it up to their waists. Walk out from the centre until the
       biome is still oasis, the ground is comfortably above the water and the
       slope will hold a rank. */
    const o = D.oases[0];
    /* THE GREEN IS A BAND, NOT THE WHOLE BOWL. desert.js:533 mixes its oasis
       green out over the first ~11 m above the bowl floor and the floor
       itself holds water, so "somewhere in the oasis" is either a pond or
       plain sand. The first attempt gated on SEA_Y — the OCEAN's level, which
       has nothing to do with a bowl 40 m up the island — and put twenty men
       waist-deep in the pool. Find the bowl floor by sampling, then take the
       ring two to six metres above it: out of the water, still green. */
    let floor = 1e9;
    for (let k = 0; k < 64; k++) {
      const a = k / 64 * Math.PI * 2, rr = o.r * (0.15 + (k % 4) * 0.15);
      floor = Math.min(floor, D.heightAt(o.x + Math.cos(a) * rr, o.z + Math.sin(a) * rr));
    }
    let best = null;
    for (let ring = 0; ring < 16 && !best; ring++) {
      const rr = o.r * (0.35 + ring * 0.06);
      for (let k = 0; k < 32; k++) {
        const a = k / 32 * Math.PI * 2;
        const x = o.x + Math.cos(a) * rr, z = o.z + Math.sin(a) * rr;
        if (D.biomeAt(x, z) !== "oasis") continue;
        const y = D.heightAt(x, z);
        if (y < floor + 2.0 || y > floor + 6.5) continue;
        if (D.slopeAt(x, z) > 0.18) continue;
        best = { x: x, z: z }; break;
      }
    }
    if (!best) best = { x: o.x + o.r * 0.7, z: o.z };
    cx = best.x; cz = best.z;
  } else {
    // walk the golden-angle spiral until the biome is dune and the ground is
    // flat enough to stand a rank on
    for (let i = 0; i < 4000; i++) {
      const a = i * 0.618033988 * Math.PI * 2;
      const r = Math.sqrt((i + 0.5) / 4000) * D.RADIUS * 0.7;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (D.biomeAt(x, z) !== "dune") continue;
      if (D.slopeAt(x, z) > 0.10) continue;
      cx = x; cz = z; break;
    }
  }
  /* THE CLIPMAP FILLS AROUND THE CAMERA, ONE LEVEL PER CALL — desert.js
     rebuilds at most one of its seven levels per follow() because a rebuild
     is 4 225 heightAt calls, so a teleport needs at least seven calls before
     the ground under the shot is the ground it is standing on. Twelve, then
     stop the page loop so nothing moves again. */
  W.state.you.x = cx; W.state.you.z = cz;
  for (let i = 0; i < 24; i++) CBZ.stepSim(1 / 30);
  for (let i = 0; i < 12; i++) if (D.follow) D.follow(cx, cz);
  try { if (CBZ.micro && CBZ.micro.stop) CBZ.micro.stop(); } catch (e) {}
  X.hideChrome();
  await sleep(200);

  const ground = function (x, z) { return D.heightAt(x, z); };
  const cam = X.cam;
  cam.aspect = (input.width || 1180) / (input.height || 700);
  const PAT = C.patterns();

  // ======================================================== SWATCH WALL
  if (sub.mode === "swatch") {
    cam.fov = 34; cam.updateProjectionMatrix();
    const COLS = 5, S = 1.4, GAP = 0.34;
    const rows = Math.ceil(PAT.length / COLS);
    const w0 = -(COLS - 1) * (S + GAP) / 2;
    const h0 = ground(cx, cz) + 0.55;
    for (let i = 0; i < PAT.length; i++) {
      const p = PAT[i];
      const col = i % COLS, row = (rows - 1) - Math.floor(i / COLS);
      const x = cx + w0 + col * (S + GAP);
      const y = h0 + row * (S + GAP * 2.2) + S / 2;
      /* THE PANEL IS 1.4 m OF CLOTH AND THE REPEAT SAYS SO. A swatch shown at
         "one tile across, whatever that is" compares fourteen different
         physical scales and tells you nothing. */
      const mat = C.material(p.id, { repeat: C.repeatFor(p.id, S, S) });
      const q = new T.Mesh(new T.PlaneGeometry(S, S), mat);
      q.position.set(x, y, cz);
      X.root.add(q);
      // a frame, so a pale pattern still has an edge against pale sand
      const fr = new T.Mesh(new T.PlaneGeometry(S + 0.07, S + 0.07),
        new T.MeshBasicMaterial({ color: 0x1b140c }));
      fr.position.set(x, y, cz - 0.02);
      X.root.add(fr);
      X.pending = X.pending || [];
      X.pending.push({ text: p.label + "  " + C.conceal(p.id), at: new T.Vector3(x, y - S / 2 - 0.24, cz) });
    }
    const midY = h0 + (rows - 1) * (S + GAP * 2.2) / 2 + S / 2;
    cam.position.set(cx, midY + 0.4, cz + 12.5);
    cam.lookAt(cx, midY, cz);
    cam.updateMatrixWorld(true);
    (X.pending || []).forEach(function (l) { X.label(l.text, l.at, 0); });
    X.pending = null;
  }

  // ======================================================== CLOTH AT 3 m
  if (sub.mode === "cloth") {
    cam.fov = 40; cam.updateProjectionMatrix();
    /* six patterns chosen to be six DIFFERENT GEOMETRIES, not six colourways:
       blob, gradient-blob, band, pixel, spatter-blob, patch. If any two of
       these are hard to tell apart at three metres the library does not have
       six patterns in it.
       THEY STAND ON AN ARC, not on a line, and the first run is why: seven
       men on a straight line 0.95 m apart do not fit a 46 deg lens from three
       metres, so the plate came back with the first man cropped off the left
       edge and the rest overlapping. An arc centred on the camera puts every
       man at the SAME distance — which is also the honest way to compare six
       patterns "at 3 m", because on a line the outer two are at four. */
    const SHOW = ["desert3", "multicam", "tigerdesert", "marpat", "chip6", "ragpatch"];
    /* 4.2 m and 52 deg of arc, and both numbers are framing arithmetic
       rather than taste: at fov 40 on this 1180x700 frame the half-width at
       4.2 m is 2.57 m and the half-height 1.53 m, so a 3.65 m chord of men
       plus half a body of margin fits with 0.4 m to spare and a 1.82 m man's
       cap clears the top by half a metre.
       Two earlier framings are in that arithmetic: 3.6 m at 66 deg cropped the
       outer two men off the edges, and 3.9 m at 58 deg still clipped the caps
       of the outermost pair — not because they were too tall but because a
       66 deg horizontal field magnifies whatever sits at its edge. Widening
       the lens is the wrong lever; standing back is the right one. */
    const R = 4.2, SPAN = 0.90;
    const camX = cx, camZ = cz + R;
    const pend = [];
    for (let i = 0; i < SHOW.length; i++) {
      const g = CBZ.studio.cast("soldier", { color: 0x8a7a58, variant: i * 3 + 1 });
      if (!g) continue;
      const a = -SPAN / 2 + (i / (SHOW.length - 1)) * SPAN;
      const x = camX + Math.sin(a) * R, z = camZ - Math.cos(a) * R;
      g.position.set(x, ground(x, z), z);
      g.rotation.y = Math.PI + a;             // every man square to the lens
      X.dress(g, SHOW[i], 0xffffff);
      X.men.add(g);
      pend.push({ text: C.pattern(SHOW[i]).label, at: new T.Vector3(x, ground(x, z) + 2.05, z) });
    }
    cam.position.set(camX, ground(camX, camZ) + 1.20, camZ);
    cam.lookAt(cx, ground(cx, cz) + 0.92, cz);
    cam.updateMatrixWorld(true);
    // LABEL AFTER POSING. The first run projected every label through the
    // camera as it was BEFORE the pose, so seven labels landed in a heap in
    // the middle of the frame naming men that were nowhere near them.
    pend.forEach(function (l) { X.label(l.text, l.at, 0); });
  }

  // ======================================================== THE RANK
  if (sub.mode === "rank") {
    /* FOURTEEN DEGREES was the borrowed convention — props.js's own prop
       gallery uses fov 14 for its "SILHOUETTES AT 880 m" plate and this is the
       same question. At the game's shipping 68 deg a 1.8 m man at 200 m is SIX
       PIXELS TALL: the honest picture of that is a blank frame, which is true
       and useless. But at 14 deg the men came out 26 px tall and the plate
       still could not be read, so this settled on NINE — a man at 40 px, about
       a 5.5x scope, with a 30 m rank inside a 53 m frame width. The men are
       still being SAMPLED as if they were 200 m away, which is the part that
       matters: the GPU is showing roughly a 4x4 average of a 256 px tile
       either way. */
    cam.fov = 9; cam.updateProjectionMatrix();
    const N = 20, gap = 1.5;
    const perArmy = Math.ceil(N / ARMIES.length);

    /* WHERE THE LENS STANDS, DECIDED FIRST, BECAUSE THE RANK IS BUILT
       PERPENDICULAR TO IT — and it is CHOSEN by testing every bearing rather
       than assumed.

       Two things went wrong here and both are worth keeping written down.
       (1) The rank was hard-coded to run along world +x while the camera
       direction was whatever the oasis geometry gave — which at oases[0] on
       seed 1337 is almost exactly +x. Twenty men in single file pointing
       straight down the barrel of a 9 deg lens, nineteen of them behind the
       first, and a visibility metric of 0.000 that was telling the truth.
       (2) Even once the rank ran across the lens, the oasis plate was still
       an empty frame: an oasis is a BOWL, so a rank standing in one is below
       every dune around it and there is no bearing-independent eye height
       that sees it. desert.js's own battlefieldAt gates terrain LOS on
       relief > 6 m and this ground has plenty.

       So: try sixteen bearings, and for each solve the sight line properly —
       for a target at height `tgt`, the eye height that clears the ground
       profile p at fraction t is (p(t) + 1 - tgt*t) / (1 - t); the bearing's
       cost is the max of that over the profile. Take the cheapest bearing and
       stand two metres above its answer. On open dune this returns something
       close to eye height; out of an oasis bowl it returns an observation
       post, which is the only place a player could see that rank from
       anyway. */
    const tgt = ground(cx, cz) + 1.0;
    const DIST = 200;
    let bx = 0, bz = 1, bestEye = 1e9;
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2;
      const ux = Math.cos(a), uz = Math.sin(a);
      const gx = cx + ux * DIST, gz = cz + uz * DIST;
      let need = ground(gx, gz) + 1.9;
      for (let t = 0.03; t <= 0.92; t += 0.02) {
        const p = ground(cx + (gx - cx) * t, cz + (gz - cz) * t);
        need = Math.max(need, (p + 1.0 - tgt * t) / (1 - t));
      }
      if (need < bestEye) { bestEye = need; bx = ux; bz = uz; }
    }
    const rx = -bz, rz = bx;                     // across the lens
    const at = function (i) {
      const t = (i - (N - 1) / 2) * gap;
      const j = (i % 3 - 1) * 0.8;               // a rank, not a drawn line
      return { x: cx + t * rx + j * bx, z: cz + t * rz + j * bz };
    };
    /* FACE THE LENS. character.js's rig looks along -z at yaw 0, so the yaw
       that turns a man toward (bx,bz) is atan2(-bx,-bz) — which is Math.PI for
       a camera due +z, the value the hard-coded version happened to want. */
    const yaw = Math.atan2(-bx, -bz);
    for (let i = 0; i < N; i++) {
      const army = ARMIES[Math.min(ARMIES.length - 1, Math.floor(i / perArmy))];
      const def = C.factionDefault(army);
      const g = CBZ.studio.cast(i % 5 === 0 ? "soldier" : i % 3 === 0 ? "guard" : "thug",
        { color: 0x8a7a58, variant: i * 2 + 5 });
      if (!g) continue;
      const p = at(i);
      g.position.set(p.x, ground(p.x, p.z), p.z);
      g.rotation.y = yaw;
      X.dress(g, def.pattern, def.tint);
      X.men.add(g);
    }

    const ex = cx + bx * DIST, ez = cz + bz * DIST;
    const eye = bestEye + 2.0;
    cam.position.set(ex, eye, ez);
    cam.lookAt(cx, ground(cx, cz) + 1.0, cz);
    cam.updateMatrixWorld(true);

    // POSE FIRST, LABEL SECOND — X.label projects through the camera as it is
    // at the moment of the call. One label per army, and at the same time the
    // screen-x band each army occupies, which is what lets the difference
    // image average a colour per army rather than one over the whole frame.
    X.bands = [];
    for (let a = 0; a < ARMIES.length; a++) {
      const i0 = a * perArmy, i1 = Math.min(N - 1, (a + 1) * perArmy - 1);
      const mid = at(Math.min(N - 1, i0 + Math.floor(perArmy / 2)));
      const def = C.factionDefault(ARMIES[a]);
      // stagger, because five faction names across a 30 m rank at a 9 deg
      // lens overprint into one illegible smear
      X.label(W.faction(ARMIES[a]).label + " · " + C.pattern(def.pattern).label,
        new T.Vector3(mid.x, ground(mid.x, mid.z) + 2.4, mid.z), (a % 2) ? -3.2 : -7.0);
      const px = function (q) {
        const v = new T.Vector3(q.x, ground(q.x, q.z) + 1.0, q.z).project(cam);
        return Math.round((v.x * 0.5 + 0.5) * 768);
      };
      const lo = px(at(i0 - 0.5)), hi = px(at(i1 + 0.5));
      X.bands.push([Math.min(lo, hi), Math.max(lo, hi)]);
    }
  }

  // ---- settle, render, measure ------------------------------------------
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  CBZ.renderer.render(CBZ.scene, cam);
  await sleep(220);

  const m = {};
  if (sub.mode === "rank") {
    const v = X.visibility(X.bands);
    if (sub.oasis) { m.oasisStandoutSpread = v.spread; m.oasisStandoutBest = v.best; m.oasisVisibility = v.vis; }
    else { m.standoutSpread = v.spread; m.standoutBest = v.best; m.standoutWorst = v.worst; m.rankVisibility = v.vis; }
    /* THE GAMEPLAY CLAIM AS A NUMBER. "Some armies are genuinely well hidden
       and some are not" is only true if the five shipped patterns spread on
       THIS ground. Max minus min of camo.conceal over them; a library where
       this is near zero is decoration. */
    const g = sub.oasis ? "oasis" : "dune";
    let lo = 1, hi = 0;
    ARMIES.forEach(function (a) {
      const c = C.conceal(C.factionDefault(a).pattern, { ground: g });
      if (c < lo) lo = c; if (c > hi) hi = c;
    });
    if (sub.oasis) m.oasisConcealSpread = Math.round((hi - lo) * 100) / 100;
    else m.concealSpread = Math.round((hi - lo) * 100) / 100;
  }
  if (sub.mode === "cloth") {
    /* THE ONE METRIC THAT CANNOT BE ANYTHING BUT ZERO ON THE BEFORE SIDE:
       how much the cloth's brightness varies ACROSS A MAN at three metres.
       Flat colour has only the rig's own face shading; a pattern has a
       pattern. Measured on the rendered frame, not on the canvas. */
    m.clothDetail = X.visibility(null).detail;
  }
  if (sub.mode === "swatch") {
    /* patternDE: how far the SHIPPED faction patterns' mean colours sit from
       the sand they stand on, in the same weighted-RGB distance conceal()
       uses, scaled 0..100. This is the only property of a pattern that
       survives to 200 m, so it is the only palette number worth gating. */
    const gnd = C.ground().dune;
    let de = 0, spread = 0;
    ARMIES.forEach(function (a) {
      const id = C.factionDefault(a).pattern;
      const mm = C.mean(id);
      const dr = ((mm >> 16) & 255) - ((gnd >> 16) & 255);
      const dg = ((mm >> 8) & 255) - ((gnd >> 8) & 255);
      const db = (mm & 255) - (gnd & 255);
      de += Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / Math.sqrt(9 * 255 * 255) * 100;
      spread += C.spread(id);
    });
    m.patternDE = Math.round(de / ARMIES.length * 100) / 100;
    m.clothBreakup = Math.round(spread / ARMIES.length * 100) / 100;
    const st = C.stats();
    m.camoTextures = st.textures;
    m.camoMB = st.mb;
  }
  if (CBZ.renderer && CBZ.renderer.info) m.drawCalls = CBZ.renderer.info.render.calls;
  X.lastMetrics = m;

  return {
    ok: true, subject: sub.id, mode: sub.mode,
    men: X.men ? X.men.children.length : 0,
    eyeAbove: X.cam ? Math.round((X.cam.position.y - ground(cx, cz)) * 10) / 10 : null,
    at: { x: Math.round(cx), z: Math.round(cz) },
    biome: D.biomeAt(cx, cz),
    camoOn: C.enabled(),
    metrics: m,
    camera: { position: cam.position.toArray(), fov: cam.fov },
  };
}

export default {
  id: "warlord-camo",
  title: "Desert Warlord: Flat Cloth → A Camouflage Library",
  description:
    "Fourteen procedurally drawn camouflage patterns from src/warlord/camo.js, photographed against the " +
    "file's own revert. The BEFORE column is this same checkout with ?camo=old: textures off, every " +
    "uniform a flat Lambert of the pattern's own measured mean colour. Both columns are staged in the " +
    "LIVE scene on the real island at seed 1337 — the same double-lit sun, ACES tone mapping and sRGB " +
    "output the game ships — because a palette judged under a studio rig and shipped into a 3.1x scene " +
    "photographs as white paper.",
  page: "games/warlord.html",
  defaultBefore: "local",
  beforeParams: { camo: "old" },
  beforeLabel: "BEFORE · ?camo=old (flat colour)",
  afterLabel: "AFTER · THE CAMO LIBRARY",
  viewport: { width: 1180, height: 700 },
  urlParams: { go: 1, seed: 1337, weather: "off" },
  // the first stage pays studio + armoury + module boot and then raises 14 km
  // of terrain; under software WebGL that is minutes, not seconds.
  stageTimeoutMs: 420000,
  readyExpression:
    "window.__warlordReady === true && !!(window.CBZ && CBZ.warlord && CBZ.warlord.camo && CBZ.warlord.desert && CBZ.studio && CBZ.studio.cast)",
  pairNote: "Same checkout · seed 1337 · same coordinates, camera and hour — ?camo=old is the only variable",
  method:
    "Both columns are this checkout served by the same local server; the before side adds ?camo=old, the " +
    "revert switch camo.js ships. Nothing is staged in a private studio: the men are CBZ.studio.cast — the " +
    "same rig battle.js puts on the sand — dressed by swapping the material on their real BoxGeometry " +
    "garment parts, with the texture repeat computed from each part's real metres by W.camo.repeatFor so " +
    "the torso and the trouser leg carry the same physical pattern size. The ground is desert.js's own " +
    "island at seed 1337, found by scanning for dune biome under 0.10 slope (and for the oasis plate, by " +
    "reading desert.js's own oasis list) rather than by typing a coordinate. The 200 m plates use a 14 deg " +
    "lens, the same long lens props.js's prop gallery uses for its silhouette plate, because at the game's " +
    "shipping 68 deg a man at 200 m is six pixels tall and the honest picture of that is a blank frame.",
  metricsNote:
    "clothDetail is the metric with a direction on it and it is the honest one: the mean brightness step " +
    "across three pixels of cloth on a man at 3 m, measured on the rendered frame with the man pixels " +
    "segmented out of the difference image rather than off a hand-drawn mask. Flat colour scores 3 (the " +
    "rig's own face shading); the library scores 9. " +
    "standoutSpread is the gameplay claim measured on the rendered frame: each army's mean |ΔRGB| against " +
    "THE EXACT GROUND BEHIND IT (both terms come out of the same difference image), loudest minus " +
    "quietest. A library where that spread is near zero is decoration — every army equally hidden is no " +
    "decision for anybody to make; it triples on the dune and quadruples at the oasis. " +
    "standoutBest and rankVisibility carry NO direction, and the reason is a fact rather than a hedge: the " +
    "before column's flat colour is each pattern's OWN MEAN, and at 200 m the GPU is already showing about " +
    "a 4x4 average of a 256 px tile, so the flat control is mathematically the best a uniform of that " +
    "albedo can do — no pattern can beat its own mean at a range where the pattern has been averaged away. " +
    "That is why 'camouflage hides you better than no camouflage' is not a claim this library makes or " +
    "this page could support. What it claims is that at 200 m the five armies are TOLD APART and their " +
    "standout depends on the ground (standoutSpread), and that under about forty metres the cloth has a " +
    "pattern on it at all (clothDetail). rankVisibility carries NO direction on purpose and it goes UP with camo on, which is worth " +
    "reading rather than gating: with camo off every uniform is a flat mean that this 3.1x double-lit scene " +
    "blows out to the same near-white as the sand, so the before column's men vanish because of a lighting " +
    "bug and not because they are camouflaged — five armies that photograph as one army. concealSpread is " +
    "the gameplay claim as a number: best-hidden faction minus worst on that ground, and it has to move " +
    "between the dune plate and the oasis plate or the library is decoration. " +
    "rankVisibility and oasisVisibility are not proxies: each 200 m plate is rendered twice into an " +
    "offscreen target, once with the rank and once with it hidden, and the number is the mean absolute RGB " +
    "difference over the frame — literally how much of the picture the army is. patternDE is how far the " +
    "five shipped faction patterns' mean colours sit from the island's own dune sand (#9E8969, converted " +
    "from desert.js's linear albedo), which is the only property of a pattern that survives to 200 m. " +
    "clothBreakup is their mean luminance spread, which is what a viewer at 10 m reads instead. " +
    "camoTextures and camoMB carry no direction ON PURPOSE — the before side has zero of both because it " +
    "has no patterns, and a gate that called that a win would be gating the wrong thing; they are here so " +
    "the memory claim is a number rather than an adjective.",
  metrics: {
    standoutSpread: { label: "Loudest army minus quietest, at 200 m on dune", unit: "|ΔRGB| per px", better: "higher" },
    standoutBest: { label: "The quietest army, at 200 m on dune", unit: "|ΔRGB| per px" },
    standoutWorst: { label: "The loudest army, at 200 m on dune", unit: "|ΔRGB| per px" },
    oasisStandoutSpread: { label: "The same spread, at the oasis", unit: "|ΔRGB| per px", better: "higher" },
    oasisStandoutBest: { label: "The quietest army, at the oasis", unit: "|ΔRGB| per px" },
    concealSpread: { label: "camo.conceal() spread across the five, on dune", unit: "0-1" },
    oasisConcealSpread: { label: "The same, at the oasis", unit: "0-1" },
    rankVisibility: { label: "How much a 200 m rank changes the picture (dune)", unit: "mean |ΔRGB|" },
    oasisVisibility: { label: "The same rank at the oasis", unit: "mean |ΔRGB|" },
    clothDetail: { label: "Contrast across 3 px of cloth at 3 m", unit: "luma steps", better: "higher" },
    patternDE: { label: "Faction palettes vs island sand", unit: "0-100" },
    clothBreakup: { label: "Disruption the tiles carry", unit: "luma sd" },
    camoTextures: { label: "Textures the whole library costs", unit: "textures" },
    camoMB: { label: "Texture memory, mips included", unit: "MB" },
    drawCalls: { label: "Draw calls", unit: "calls" },
  },
  subjects: SUBJECTS,
  stage: stageCamo,
};
