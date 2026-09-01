/* DESERT WARLORD — THE HEADBANDS WERE ON HIS EYES.

   OWNER, 2026-09-01, verbatim: "headbands are too low on heads rn they
   everlap eyes". And, in the same breath: "women should not be in the game no
   woman hair".

   Both are questions about a head at portrait range, so both are photographed
   here, close enough to see an eyebrow.

   WHAT WAS WRONG, AS ARITHMETIC RATHER THAN AS TASTE. Every number in
   src/warlord/outfits.js's headwear() was a hand-tuned fraction of the head
   CUBE — `H * 0.74` for the rag's band, `H * 0.44` for the helmet's rim — and
   the face is not centred in the cube. entities/character.js:908 parents the
   eyes, brow and mouth to a `face` group scaled headSize/0.60 and hangs it
   off the neck, and in that frame (measured off live rigs, all four tiers,
   identical to four decimals):

       mouth top 0.317 H · eye BOTTOM 0.433 H · eye TOP 0.700 H
       brow bottom 0.717 H · brow TOP 0.817 H · skull top 1.000 H

   Against which the shipped hats had floors at: rag 0.640 H, shemagh 0.470 H,
   beret 0.695 H, helmet 0.390 H. Four of the five were drawn straight across
   the man's eyes. The fifth — the cap, floor 0.883 H — was the only one whose
   numbers had been derived from anything (character.js's own built-in cap),
   which is the entire lesson.

   THE HAIR IS THE SAME KIND OF FAULT. CBZ.studio.cast never forwarded a
   `hairStyle`, so every bare-headed man in this game wore character.js's
   default for an adult male: `short`, whose merged shell hangs to y 0.300 H
   at the back — level with the MOUTH — and to 0.417 H down the temples, just
   under the eye. That is nape-length hair on every levy on the island.

   BOTH SIDES ARE REAL CODE, AND THERE IS NO FLAG. The wave is flagless on
   purpose (a flag on a design decision is a second army nobody photographs),
   so the BEFORE side is a pristine `git worktree` of HEAD served on its own
   port — launchSides() below builds it, serves it and tears it down. The
   AFTER is the working tree. Same seed, same roster, same cameras, same
   frozen pose; the only difference in any pixel is the uncommitted diff.

   THE ROSTER IS BUILT BY THE PRESET, not by the gallery, and that matters:
   the gallery's own layout changed in this wave (it grew an armour axis), so
   asking it for four men would compare two different rosters. W.outfits.cast
   and W.makeSoldier exist unchanged on both sides, so the stage casts its own
   men, forces one headwear type per column through the module's own exported
   headwear(), and both columns are then the identical five men.

   THE NUMBERS ARE MEASURED IN THE STAGE, not read out of W.outfits.sample() —
   sample() only learned to report a face clearance in this wave, so asking it
   would return null on the before side and the metric would be a picture of
   the new code beside a blank. The stage walks the rig's own face group and
   the headwear group's own children, which both sides have.               */

import { pristineHead } from "./lib/pristine-head.mjs";

const HATS = [
  { id: "rag", label: "Rag band",
    focus: "THE ONE HE NAMED. A band tied round the forehead. Its floor was 0.640 H against an eye top of 0.700 H — 0.06 H of band drawn ACROSS the eyes — and it hid the hair as well, so a bandana rendered as a bald man in a ribbon. It should now sit on the brow with the crown of the hair visible above it." },
  { id: "shemagh", label: "Shemagh wrap",
    focus: "THE WORST OF THE FIVE: a crown box with its floor at 0.470 H, which is below the BOTTOM of the eye — the man was wearing his headcloth over his whole face. The wrap now starts at the brow, the cheek panels hang BESIDE the jaw (outboard of the eye, which is why they are allowed below it), the drape hangs at the nape, and the face veil is anchored from the eye BOTTOM because a veil covers a mouth." },
  { id: "cap", label: "Ball cap",
    focus: "THE CONTROL. This one was already right, because its numbers are character.js's own built-in cap rather than a hand-tuned fraction — floor 0.883 H, clear of the 0.817 H brow. It should be IDENTICAL in both columns. If it moved, the new rule is wrong." },
  { id: "beret", label: "Beret",
    focus: "The lip — the band a beret is pulled down onto — sat at 0.695 H, clipping the tops of the eyes, with the crown 0.077 H below the brow. The lip now owns the floor and the crown stands on it." },
  { id: "helmet", label: "Helmet",
    focus: "A BLINDFOLD WITH A CHINSTRAP: the dome and the rim BOTH had their floors at 0.390 H, 0.31 H below the top of the eye. The rim now owns the brow line, the dome stands on the rim, and what the old dome used to buy by hanging over the face — coverage of the back of the skull — is a nape skirt BEHIND the head where there is no face to reach." },
];

const subjects = HATS.map((h) => ({
  id: "head-" + h.id, label: h.label + " · portrait", kind: "one", hat: h.id, focus: h.focus,
}));
subjects.push({
  id: "head-row", label: "All five, one row", kind: "row",
  focus: "THE WHOLE LADDER AT ONCE, left to right: rag, shemagh, cap, beret, helmet. The question is a single one and it is answerable from six feet away — can you see five pairs of eyes?",
});
subjects.push({
  id: "bare-hair", label: "Bare heads · the hair", kind: "hair",
  focus: "NO HAT AT ALL, which is the other ask. Before: character.js's `short` shell on every man — the crown, the temples down to 0.417 H (under the eye) and a back panel to 0.300 H, level with the mouth. After: W.outfits.cast passes character.js's own `build` and `hairStyle` casting options, so the pool is its two shortest male cuts, buzz and crop. Nothing was deleted from the engine; gang city and the prison still have every style.",
});

/* The BEFORE side is a pristine worktree of HEAD, served on its own port —
   see tools/visual-presets/lib/pristine-head.mjs for why this wave has no
   revert flag to A/B against instead. */

export default {
  id: "warlord-headline",
  page: "games/warlord.html",
  title: "Desert Warlord — The Headbands Were On His Eyes",
  description:
    "Five hats and a bare head, photographed close enough to see an eyebrow, against a pristine worktree of HEAD. Every headwear number in src/warlord/outfits.js was a hand-tuned fraction of the head CUBE; the face is not centred in the cube, and four of the five hats were drawn across the man's eyes. They are now anchored to the brow line the rig itself reports.",
  viewport: { width: 1180, height: 760 },
  readyExpression: "window.__warlordOutfitsReady === true",
  urlParams: { gallery: "outfits", seed: 90210 },
  stageTimeoutMs: 300000,
  beforeLabel: "BEFORE · HEAD (hats measured off the head cube)",
  afterLabel: "AFTER · every hat anchored to the measured brow line",
  pairNote: "Same roster · same cameras · same frozen pose — the uncommitted diff is the only variable",
  method:
    "The before side is a detached `git worktree` of HEAD served on its own port by python3 -m http.server; the after side is the working tree served by ba. This wave adds no flag — the issue uniform, the head line and the male-only casting are design decisions, and a flag on a design decision is a second army nobody photographs — so a pristine checkout is the honest baseline. The stage casts its own five men through W.outfits.cast (unchanged on both sides), forces one headwear type per column through the module's exported headwear(), freezes every rig with CBZ.animChar(t=0) and stops rAF, then aims one camera at the head's own world position.",
  metricsNote:
    "faceClear is the gap between the TOP of the eye box and the LOWEST face-facing piece of headwear, in units of headSize, ×1000 — so +133 means an eighth of a head of skin between the eyebrow and the hat, and a NEGATIVE number is the owner's complaint stated as arithmetic. Only pieces that can actually occlude a face are measured: anything whose front face never reaches the head's own front plane (a nape drape, a knot tail, a helmet's rear skirt) is behind the man, and anything entirely outboard of the eye box (a keffiyeh's cheek panel) is beside his face rather than over it. eyesCovered counts the men whose hat reaches their eyes at all. hairDrop is how far the hair shell hangs below the crown as a fraction of headSize, ×1000 — the nape-length read the owner is calling woman hair; it is 0 when the hat covers the hair.",
  metrics: {
    faceClear: { label: "Skin between eye top and hat floor", unit: "‰ of head", better: "higher" },
    eyesCovered: { label: "Men with headwear over their eyes", unit: "men", better: "lower" },
    hairDrop: { label: "Hair hanging below the crown", unit: "‰ of head", better: "lower" },
    men: { label: "Men photographed", unit: "men" },
  },

  launchSides: pristineHead,

  subjects,

  stage: async function stageWarlordHeadline(input) {
    const CBZ = window.CBZ;
    const T = window.THREE;
    if (!CBZ || !T) return { ok: false, err: "CBZ/THREE" };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test, budget, step) => {
      const end = Date.now() + budget;
      while (Date.now() < end) {
        try { if (test()) return true; } catch (_) {}
        await sleep(step || 60);
      }
      return false;
    };

    let S = window.__wlHeadStage;
    if (!S) {
      const ok = await until(() => window.__warlordOutfitsReady === true &&
        CBZ.warlord && CBZ.warlord.outfits && CBZ.camera && CBZ.renderer, 240000, 120);
      if (!ok) return { ok: false, err: "warlord/outfits.js never signalled ready" };
      for (const id of ["boot", "stage", "hud", "verbs", "toasts"]) {
        const n = document.getElementById(id);
        if (n) { n.style.display = "none"; n.classList.remove("on"); }
      }
      // FREEZE. Nothing may breathe, sway or blink between the two columns —
      // a shifted gait photographs as a costume change.
      window.requestAnimationFrame = function () { return 0; };
      const overlay = document.createElement("div");
      overlay.id = "__wlHeadOverlay";
      overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;" +
        "font:600 13px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
        "color:#fff6e4;text-shadow:0 2px 10px #000,0 0 3px #000";
      overlay.innerHTML =
        '<div data-side style="position:absolute;left:14px;top:12px;font-size:11px;letter-spacing:.22em;opacity:.85"></div>' +
        '<div data-name style="position:absolute;left:14px;top:30px;font-size:19px"></div>' +
        '<div data-num style="position:absolute;left:14px;bottom:12px;font-size:12px;letter-spacing:.05em;opacity:.92"></div>';
      document.body.appendChild(overlay);
      S = window.__wlHeadStage = { overlay };
      window.__cbzVisualCompare = {
        render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
      };
    }

    const W = CBZ.warlord, O = W.outfits;
    const sub = input.subject;

    /* ---- the pad and the world-hiding come from the module's own gallery,
       then its cast is removed and this preset builds its own. Both sides run
       the identical loop, so the roster cannot drift with the code. */
    const g = O.gallery({ layout: "portrait", faction: "bandit", seed: 4100 });
    if (!g || !g.root) return { ok: false, err: "gallery built nothing" };
    for (const m of g.men) { if (m.group && m.group.parent) m.group.parent.remove(m.group); }
    g.men.length = 0;

    const wants = sub.kind === "one" ? [sub.hat]
      : sub.kind === "row" ? ["rag", "shemagh", "cap", "beret", "helmet"]
      : ["none", "none", "none", "none"];
    const gap = sub.kind === "one" ? 0 : (sub.kind === "row" ? 0.92 : 0.86);
    const band = { faction: "bandit", colour: 0xc4593a };
    const rigs = [];
    let uid = 7100;
    for (let i = 0; i < wants.length; i++) {
      const s = W.makeSoldier ? W.makeSoldier("soldier", "carbine", { id: uid++ })
                              : { id: uid++, tier: "soldier" };
      const grp = O.cast(s, band, { role: "civilian", variant: i * 2 + 1 });
      if (!grp) return { ok: false, err: "cast returned nothing" };
      grp.position.set((i - (wants.length - 1) / 2) * gap, 0, 0);
      g.root.add(grp);
      const ch = grp.userData.charRig;
      /* FORCE THE HAT. headwear() is the module's own exported builder on
         both sides, so this is the same call either way — it is the geometry
         inside it that is under test. The colours are fixed rather than
         hashed so a moved band cannot be confused with a repainted one. */
      O.headwear(ch, wants[i], 0xb8622f, 0xffb347);
      if (CBZ.animChar) { try { CBZ.animChar(ch, 0, 1 / 60); } catch (_) {} }
      rigs.push({ ch, grp, hat: wants[i] });
    }

    /* ---- MEASURE, in the stage, off geometry both sides have ---------- */
    const boxP = (m) => (m && m.geometry && m.geometry.parameters) || {};
    const rows = [];
    for (const r of rigs) {
      const ch = r.ch;
      const H = (ch.profile && ch.profile.headSize) || 0.6;
      const f = ch.face, e = f && f.eyeL, par = e && e.parent;
      const k = par && par.scale ? par.scale.y : 1;
      const y0 = par && par.position ? par.position.y : 0;
      const eyeTop = e ? y0 + (e.position.y + boxP(e).height / 2) * k : H * 0.7;
      const eyeBot = e ? y0 + (e.position.y - boxP(e).height / 2) * k : H * 0.4333;
      const eyeOutX = e ? Math.abs(e.position.x) * k + boxP(e).width * k / 2 : H * 0.35;
      let floor = null;
      const hw = ch._wlHead;
      if (hw && hw.visible) {
        floor = Infinity;
        for (const m of hw.children) {
          const p = boxP(m);
          if (!p.width) continue;
          if (m.position.z + p.depth / 2 < H * 0.5 - 0.01) continue;       // behind the face
          if (Math.abs(m.position.x) - p.width / 2 >= eyeOutX) continue;   // beside it
          if (m.position.y + p.height / 2 <= eyeBot) continue;             // a mouth veil
          floor = Math.min(floor, m.position.y - p.height / 2);
        }
        if (!isFinite(floor)) floor = null;
      }
      // how far the hair shell hangs below the skull's crown
      let drop = 0;
      const hm = ch.skinSlots && ch.skinSlots.hair && ch.skinSlots.hair[0];
      if (hm && hm.visible && hm.geometry) {
        if (!hm.geometry.boundingBox && hm.geometry.computeBoundingBox) hm.geometry.computeBoundingBox();
        const bb = hm.geometry.boundingBox;
        if (bb && isFinite(bb.min.y)) drop = Math.max(0, H - bb.min.y) / H;
      }
      rows.push({
        hat: r.hat, headSize: H,
        eyeTop: +(eyeTop / H).toFixed(4),
        hatFloor: floor == null ? null : +(floor / H).toFixed(4),
        faceClear: floor == null ? null : +((floor - eyeTop) / H).toFixed(4),
        hairStyle: (hm && hm.userData && hm.userData.hairStyle) || null,
        hairVisible: !!(hm && hm.visible),
        hairDrop: +drop.toFixed(4),
      });
    }

    /* ---- the camera, aimed at the head's own world position ------------ */
    const first = rigs[0].ch;
    const head = first.skinSlots && first.skinSlots.head && first.skinSlots.head[0];
    const wp = new T.Vector3();
    if (head) { first.group ? first.group.updateMatrixWorld(true) : rigs[0].grp.updateMatrixWorld(true); head.getWorldPosition(wp); }
    else wp.set(0, 1.5, 0);
    const span = Math.max(0.5, (wants.length - 1) * gap + 0.62);
    /* FRAMED TO THE HEAD, not inside it. The first run put the portrait
       camera 1.15 m off a 0.42 m head at 26 degrees, which crops the skull
       and hides the very thing under test — the relationship between the hat
       and the brow is only legible with the whole head in frame. The distance
       is solved from the head's own size instead of typed: three head-heights
       of frame, which holds the crown, the chin and the shoulders. */
    const fov = sub.kind === "one" ? 26 : 34;
    const headM = (first.profile && first.profile.headSize ? first.profile.headSize : 0.6) *
                  ((rigs[0].grp.userData && rigs[0].grp.userData.humanScale) || 0.70);
    const want = sub.kind === "one" ? headM * 3.0 : span;
    const dist = (want / 2) / Math.tan((fov * Math.PI / 180) / 2) * 1.06;
    const cam = { px: 0, py: wp.y, pz: dist, tx: 0, ty: wp.y, tz: 0, fov };
    const C = (input.referenceStage && input.referenceStage.cam) || cam;
    CBZ.camera.fov = C.fov;
    CBZ.camera.near = 0.05;
    CBZ.camera.far = 4000;
    CBZ.camera.position.set(C.px, C.py, C.pz);
    CBZ.camera.lookAt(C.tx, C.ty, C.tz);
    CBZ.camera.updateProjectionMatrix();
    if (CBZ.skySync) { try { CBZ.skySync(); } catch (_) {} }

    const clears = rows.map((r) => r.faceClear).filter((v) => v != null);
    const metrics = {
      faceClear: clears.length ? Math.round(Math.min(...clears) * 1000) : null,
      eyesCovered: clears.filter((v) => v < 0).length,
      hairDrop: Math.round(Math.max(0, ...rows.map((r) => r.hairDrop)) * 1000),
      men: rows.length,
    };

    const reverted = !(O.audit && (O.audit().issueUniform !== undefined));
    S.overlay.querySelector("[data-side]").textContent =
      (reverted ? "BEFORE · HEAD" : "AFTER · working tree") +
      "   ·   eye top " + (rows[0] ? rows[0].eyeTop : "?") + " H" +
      "   ·   hat floor " + (rows[0] && rows[0].hatFloor != null ? rows[0].hatFloor + " H" : "no hat") +
      (metrics.faceClear == null ? "" : "   ·   clearance " + (metrics.faceClear > 0 ? "+" : "") + metrics.faceClear + "‰");
    S.overlay.querySelector("[data-name]").textContent = sub.label;
    S.overlay.querySelector("[data-num]").textContent =
      rows.map((r) => r.hat + " " + (r.faceClear == null ? "(bare, hair " + (r.hairStyle || "-") + " drop " + Math.round(r.hairDrop * 1000) + "‰)"
        : (r.faceClear >= 0 ? "+" : "") + Math.round(r.faceClear * 1000) + "‰")).join("   ·   ");

    await sleep(90);
    try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}
    return { ok: true, cam: C, metrics, rows };
  },
};
