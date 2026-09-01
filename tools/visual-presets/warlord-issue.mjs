/* DESERT WARLORD — ONE ARMY, ONE UNIFORM, AND THE ARMOUR IS THE DIFFERENCE.

   OWNER, 2026-09-01, verbatim: "ALSO all my soldiers should wear the same
   painted uniform difference is in armour."

   WHAT HE IS LOOKING AT. src/warlord/outfits.js used to dress YOUR warband as
   "everyone you ever beat": each of your men was hashed into one of the five
   ENEMY factions' fit tables and dressed out of it, with your amber on his
   head and nothing else of yours. It is a good sentence and it photographs as
   a mob — your own army had the widest cloth spread of any force on the
   island, you could not find your own line at a glance, and the ONE thing the
   player spends money on across a whole campaign (core.js's W.ARMOUR ladder:
   none / vest / plate / heavy) was invisible on the body. He was buying a
   number.

   WHAT IS UNDER TEST. One issued record — `yo_issue`, an amber sash on desert
   canvas through city/clothes.js's colour-keyed `gang` painter — on every man
   of yours at every tier, with every per-man roll switched off (no boot hash,
   no wear hash, no headgear hash). The only difference between two of your
   soldiers is what he is wearing OVER it, drawn as real geometry:

     none   the uniform, a belt, cloth on his head
     vest   a soft carrier with a row of utility pouches, and the issued cap
     plate  a hard slab with a raised plate band, cummerbund side plates and
            shoulder pads that ride the ARMS so they swing, and the helmet
     heavy  all of that plus a throat guard and a groin flap

   The standoffs are real metres (15 / 35 / 55 mm of carrier thickness)
   divided by CBZ.HUMAN_SCALE, not eyeballed — see armourKit().

   BOTH SIDES ARE REAL CODE AND THERE IS NO FLAG. The wave is flagless on
   purpose, so the BEFORE is a pristine detached worktree of HEAD served on
   its own port (tools/visual-presets/lib/pristine-head.mjs). The stage builds
   its OWN roster through W.makeSoldier and W.outfits.cast — both unchanged on
   either side — so the same men, with the same ids and the same armour, are
   cast twice and the only variable is the diff. Asking the module's gallery
   for the men would not do: its layout grew an armour axis in this wave, so
   the two sides would be photographing two different rosters.

   THE ENEMY IS IN THE FRAME ON PURPOSE. "One army in one uniform" is only
   worth anything if it is still distinguishable from theirs, and the standing
   risk of a uniform rule is that everybody's uniform converges. So the last
   subject puts nine of yours beside nine bandits.                          */

import { pristineHead } from "./lib/pristine-head.mjs";

const subjects = [
  { id: "ladder", kind: "ladder", label: "The armour ladder · none / vest / plate / heavy",
    focus: "THE ASK, ANSWERED AS A ROW. Four men of yours, identical soldiers, identical ids, differing only in what core.js says they are wearing. BEFORE: four different uniforms out of four different enemy factions and no armour visible anywhere — the armour column is the same picture four times. AFTER: one uniform, and four silhouettes. Look for the pouches on the vest, the shoulder pads and side plates on the plate rig, the throat guard and groin flap on the heavy, and the head going cloth → cap → helmet as the kit steps." },
  { id: "ladder-200", kind: "ladder", range: 200, fov: 2.0,
    label: "The same four at 200 m",
    focus: "THE RANGE THE QUESTION IS ACTUALLY ASKED AT, through a spotting glass — at the battle camera's own field of view a 1.82 m man 200 m out is nine pixels, so this is a crop and it says so. What has to survive: the ladder as a SHAPE. Cloth colour is gone at this range; a wider block with a hard lid is not." },
  { id: "warband", kind: "warband", label: "Eighteen of your men",
    focus: "IS IT ONE ARMY? Eighteen of yours in two ragged ranks, tiers and armour distributed the way the campaign hands them out. Before: eighteen strangers with a shared hat colour. After: one uniform, with the armour ladder scattered through it — which is what a real warband looks like, because you kitted the men you could afford to kit." },
  { id: "yours-vs-theirs", kind: "versus", label: "Yours beside theirs",
    focus: "THE COST OF A UNIFORM RULE, checked rather than assumed. Nine of yours on the left, nine Sand Bandits on the right. A rule that makes your army legible is worthless if it also makes it look like everybody else's — the enemy factions keep every one of their per-man rolls and this shot is where that gets audited." },
];

export default {
  id: "warlord-issue",
  page: "games/warlord.html",
  title: "Desert Warlord — One Army, One Uniform, Armour Is The Difference",
  description:
    "Your warband used to wear the five enemy factions' clothes, hashed per man, which made your own army the least legible force on the island and made the armour you paid for invisible. It now wears one issued uniform, and the only difference between two of your soldiers is the armour on top of it — drawn as geometry, off core.js's own W.ARMOUR ladder.",
  viewport: { width: 1180, height: 720 },
  readyExpression: "window.__warlordOutfitsReady === true",
  urlParams: { gallery: "outfits", seed: 90210 },
  stageTimeoutMs: 300000,
  beforeLabel: "BEFORE · HEAD (your men wear whoever you beat)",
  afterLabel: "AFTER · one issued uniform, armour is the difference",
  pairNote: "Same men · same ids · same armour · same cameras — the uncommitted diff is the only variable",
  launchSides: pristineHead,
  method:
    "The before side is a detached `git worktree` of HEAD served by python3 -m http.server on its own port; the after side is the working tree. The stage builds its own roster with W.makeSoldier (ids walked, armour assigned per subject) and casts it with W.outfits.cast — both present and unchanged on either side — onto the module's own sand pad with the world hidden, rAF stopped and every rig posed once by CBZ.animChar(t=0). Cameras are derived from the subject and reused from the baseline stage.",
  metricsNote:
    "uniforms counts the distinct CLOTH signatures (torso / legs / boots, sampled off the live rigs through W.outfits.sample so a painted atlas and a camo map are read in their own languages) among YOUR men: the ask is that this is 1. torsoSpread is the mean weighted-RGB distance between your men's torsos, the same 2/4/3 weighting camo.js scores concealment with — 0 means one army. armourReadable is the ask's other half, and it is a MAPPING rather than a count: a rung of the armour ladder is readable when every man wearing it shares one silhouette signature (the torso block's own width and depth, measured in the stage by walking the chest mesh and its children, plus the headwear type) and no other rung shares that signature. A first draft of this metric simply counted distinct silhouettes with \"higher is better\" and the warband shot correctly failed it — 18 men in 18 borrowed uniforms have 7 different torso blocks and 18 in one uniform have 4, and seven shapes that mean nothing are not better than four that mean everything. armourPieces is how many armour meshes actually reached the bodies, which on the before side is structurally 0 because the geometry did not exist. nearestEnemy is the guard against a uniform rule making everybody look the same, and it is deliberately a MINIMUM and not a mean: the mean gap between two armies falls when one of them stops being random, which says nothing, whereas the closest single pair is what actually decides whether you can mistake one of yours for one of theirs — and before this wave that number could be zero, because your men were being dressed out of the bandits\' own table.",
  metrics: {
    uniforms: { label: "Distinct uniforms across YOUR men", unit: "fits", better: "lower" },
    torsoSpread: { label: "Man-to-man cloth spread in your army", unit: "ΔRGB", better: "lower" },
    armourReadable: { label: "Armour rungs you can read off the silhouette", unit: "rungs", better: "higher" },
    armourPieces: { label: "Armour meshes on the bodies", unit: "meshes", better: "higher" },
    nearestEnemy: { label: "Closest your man ever gets to theirs", unit: "ΔRGB", better: "higher" },
    men: { label: "Men photographed", unit: "men" },
  },
  subjects,

  stage: async function stageWarlordIssue(input) {
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

    let S = window.__wlIssueStage;
    if (!S) {
      const ok = await until(() => window.__warlordOutfitsReady === true &&
        CBZ.warlord && CBZ.warlord.outfits && CBZ.camera && CBZ.renderer, 240000, 120);
      if (!ok) return { ok: false, err: "warlord/outfits.js never signalled ready" };
      // the painted atlas is what a "painted uniform" means; wait for the NAME
      // rather than for a number of milliseconds.
      await until(() => !!CBZ.cityApplyClothes, 30000, 60);
      for (const id of ["boot", "stage", "hud", "verbs", "toasts"]) {
        const n = document.getElementById(id);
        if (n) { n.style.display = "none"; n.classList.remove("on"); }
      }
      window.requestAnimationFrame = function () { return 0; };
      const overlay = document.createElement("div");
      overlay.id = "__wlIssueOverlay";
      overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;" +
        "font:600 13px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
        "color:#fff6e4;text-shadow:0 2px 10px #000,0 0 3px #000";
      overlay.innerHTML =
        '<div data-side style="position:absolute;left:14px;top:12px;font-size:11px;letter-spacing:.22em;opacity:.85"></div>' +
        '<div data-name style="position:absolute;left:14px;top:30px;font-size:19px"></div>' +
        '<div data-num style="position:absolute;left:14px;bottom:12px;font-size:11.5px;letter-spacing:.05em;opacity:.92;max-width:94%"></div>';
      document.body.appendChild(overlay);
      S = window.__wlIssueStage = { overlay };
      window.__cbzVisualCompare = {
        render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
      };
    }

    const W = CBZ.warlord, O = W.outfits;
    const sub = input.subject;

    /* The pad, the fog and the world-hiding come from the module's own
       gallery; the CAST does not, for the reason in the header. */
    const g = O.gallery({ layout: "portrait", faction: "bandit", seed: 4100 });
    if (!g || !g.root) return { ok: false, err: "gallery built nothing" };
    for (const m of g.men) { if (m.group && m.group.parent) m.group.parent.remove(m.group); }
    g.men.length = 0;

    const MINE = { mine: 1, faction: "you", colour: 0xffb347 };
    const THEIRS = { faction: "bandit", colour: 0xc4593a };
    const TIERS = ["levy", "raider", "soldier", "veteran"];
    const RUNGS = (W.ARMOUR || [{ id: "none" }]).map((r) => r.id);

    /* THE ROSTER. Explicit and identical on both sides — ids walked so the
       hashes both versions compute land on the same men. */
    const plan = [];
    let uid = 8200;
    if (sub.kind === "ladder") {
      for (let i = 0; i < RUNGS.length; i++) {
        plan.push({ side: "mine", tier: "soldier", armour: RUNGS[i], x: (i - (RUNGS.length - 1) / 2) * 1.55, z: 0 });
      }
    } else if (sub.kind === "warband") {
      /* THE MIX THE CAMPAIGN ACTUALLY HANDS OUT: most of a warband is
         unarmoured, a third is in vests and the veterans carry the plates.
         Walked rather than rolled so both columns get the identical army. */
      const mix = ["none", "none", "vest", "none", "plate", "vest", "none", "none", "vest",
                   "plate", "none", "vest", "heavy", "none", "plate", "none", "vest", "none"];
      for (let i = 0; i < mix.length; i++) {
        const col = i % 9, row = (i / 9) | 0;
        plan.push({ side: "mine", tier: TIERS[i % TIERS.length], armour: mix[i],
                    x: (col - 4) * 1.18 + (row ? 0.55 : 0), z: row * -2.6 });
      }
    } else {
      const mine = ["none", "vest", "none", "plate", "none", "vest", "none", "heavy", "vest"];
      for (let i = 0; i < 9; i++) {
        plan.push({ side: "mine", tier: TIERS[i % TIERS.length], armour: mine[i],
                    x: -6.4 + i * 1.15, z: (i % 3 - 1) * 0.7 });
      }
      for (let i = 0; i < 9; i++) {
        plan.push({ side: "theirs", tier: TIERS[i % TIERS.length], armour: "none",
                    x: 1.4 + i * 1.15, z: (i % 3 - 1) * 0.7 });
      }
    }

    const built = [];
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      const band = p.side === "mine" ? MINE : THEIRS;
      const s = W.makeSoldier ? W.makeSoldier(p.tier, "carbine", { id: uid++, armour: p.armour })
                              : { id: uid++, tier: p.tier, armour: p.armour };
      s.armour = p.armour;                    // belt and braces: HEAD's makeSoldier takes it too
      const grp = O.cast(s, band, { role: "civilian", variant: (i * 3) % 6 });
      if (!grp) return { ok: false, err: "cast returned nothing" };
      grp.position.set(p.x, 0, p.z);
      g.root.add(grp);
      const ch = grp.userData.charRig;
      if (CBZ.animChar) { try { CBZ.animChar(ch, 0, 1 / 60); } catch (_) {} }
      built.push({ p, grp, ch });
    }

    /* ---- MEASURE. Cloth through the module's own sampler (it speaks atlas,
       camo and flat); SHAPE in the stage, because sample() only learned to
       report a silhouette in this wave and the before side would answer
       null. */
    const boxP = (m) => (m && m.geometry && m.geometry.parameters) || {};
    function torsoBlock(ch) {
      const chest = ch.skinSlots && ch.skinSlots.torso && ch.skinSlots.torso[0];
      if (!chest) return null;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      const walk = (o, ox, oz) => {
        const p = boxP(o);
        const x = ox + (o.position ? o.position.x : 0), z = oz + (o.position ? o.position.z : 0);
        if (p.width && o.visible !== false) {
          minX = Math.min(minX, x - p.width / 2); maxX = Math.max(maxX, x + p.width / 2);
          minZ = Math.min(minZ, z - p.depth / 2); maxZ = Math.max(maxZ, z + p.depth / 2);
        }
        for (const k of o.children) if (k.visible !== false) walk(k, x, z);
      };
      // the chest's own position is its parent's business; measure in its frame
      const p0 = boxP(chest);
      if (p0.width) {
        minX = -p0.width / 2; maxX = p0.width / 2; minZ = -p0.depth / 2; maxZ = p0.depth / 2;
      }
      for (const k of chest.children) if (k.visible !== false) walk(k, 0, 0);
      if (!isFinite(minX)) return null;
      return { w: maxX - minX, d: maxZ - minZ };
    }
    function armourMeshes(ch) {
      let n = (ch._wlArmour && ch._wlArmour.visible) ? ch._wlArmour.children.length : 0;
      const arms = (ch.skinSlots && ch.skinSlots.arms) || [];
      for (const a of arms) if (a && a.userData && a.userData._wlPad) n++;
      return n;
    }

    const rows = [];
    for (const b of built) {
      const sm = O.sample(b.grp) || {};
      const tb = torsoBlock(b.ch);
      rows.push({
        side: b.p.side, tier: b.p.tier, armour: b.p.armour, fit: sm.fit || null,
        torso: sm.torso, legs: sm.legs, shoes: sm.shoes, hat: !!sm.hat,
        hatType: (b.ch._wlDet && b.ch._wlDet.head) || null,
        w: tb ? +tb.w.toFixed(3) : null, d: tb ? +tb.d.toFixed(3) : null,
        pieces: armourMeshes(b.ch),
      });
    }

    const dist = (a, b) => {
      if (a == null || b == null) return 0;
      const dr = ((a >> 16) & 255) - ((b >> 16) & 255);
      const dg = ((a >> 8) & 255) - ((b >> 8) & 255);
      const db = (a & 255) - (b & 255);
      return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / 3;
    };
    const mine = rows.filter((r) => r.side === "mine");
    const theirs = rows.filter((r) => r.side === "theirs");
    const cloth = {};
    let sp = 0, spn = 0, pieces = 0;
    for (const r of mine) { cloth[[r.torso, r.legs, r.shoes].join("/")] = 1; pieces += r.pieces; }
    for (let i = 0; i < mine.length; i++) {
      for (let j = i + 1; j < mine.length; j++) { sp += dist(mine[i].torso, mine[j].torso); spn++; }
    }

    /* ---- CAN YOU READ HIS ARMOUR OFF HIS SHAPE? ------------------------
       The first version of this metric just counted distinct silhouettes and
       declared "higher is better", and the warband shot correctly called that
       a REGRESSION: 18 men in 18 borrowed uniforms had 7 different torso
       blocks (jacket shells, plate carriers painted into atlases, coats) and
       18 men in one uniform have 4. Seven shapes that mean nothing is not
       better than four that mean everything, so the metric was wrong, not the
       change.

       What the ask actually claims is a MAPPING: a man's silhouette tells you
       which rung of the armour ladder he is on. So a rung counts as READABLE
       when every man on it shares one signature AND no other rung shares it.
       Before, all four rungs draw the same nothing and their signatures come
       from the clothes, so the mapping does not exist and the count is 0. */
    const byRung = {}, sigOwner = {};
    for (const r of mine) {
      const sig = [r.w, r.d, r.hatType].join("/");
      (byRung[r.armour] = byRung[r.armour] || []).push(sig);
      (sigOwner[sig] = sigOwner[sig] || {})[r.armour] = 1;
    }
    let readable = 0;
    for (const rung of Object.keys(byRung)) {
      const sigs = byRung[rung];
      const uniform = sigs.every((v) => v === sigs[0]);
      const exclusive = Object.keys(sigOwner[sigs[0]] || {}).length === 1;
      if (uniform && exclusive) readable++;
    }

    /* ---- AND CAN YOU TELL YOURS FROM THEIRS? ---------------------------
       The MEAN distance between the two armies is the wrong question and it
       regressed for a reason that carries no information: nine random
       uniforms have a bigger mean spread from anything than one uniform does.
       What decides confusability on a battlefield is the WORST pair — the
       closest any man of yours gets to any man of theirs. Before, your men
       literally wore records out of the bandits' own table, so that minimum
       can be zero: two men in the same shirt, one of them yours. */
    let nearest = null;
    for (const a of mine) for (const b of theirs) {
      const dd = dist(a.torso, b.torso);
      if (nearest == null || dd < nearest) nearest = dd;
    }

    const metrics = {
      uniforms: Object.keys(cloth).length,
      torsoSpread: spn ? Math.round(sp / spn * 10) / 10 : 0,
      armourReadable: readable,
      armourPieces: pieces,
      nearestEnemy: nearest == null ? null : Math.round(nearest * 10) / 10,
      men: rows.length,
    };

    /* ---- cameras, derived from the subject ---------------------------- */
    let cam;
    if (sub.kind === "ladder" && sub.range) {
      cam = { px: 0, py: 1.35, pz: sub.range, tx: 0, ty: 1.05, tz: 0, fov: sub.fov || 2.0 };
    } else if (sub.kind === "ladder") {
      cam = { px: 0, py: 1.25, pz: 6.1, tx: 0, ty: 0.98, tz: 0, fov: 40 };
    } else if (sub.kind === "warband") {
      cam = { px: 0, py: 3.1, pz: 12.4, tx: 0, ty: 1.05, tz: -1.3, fov: 38 };
    } else {
      cam = { px: 0, py: 2.2, pz: 15.0, tx: 0, ty: 1.05, tz: 0, fov: 44 };
    }
    const C = (input.referenceStage && input.referenceStage.cam) || cam;
    CBZ.camera.fov = C.fov;
    CBZ.camera.near = 0.1;
    CBZ.camera.far = 6000;
    CBZ.camera.position.set(C.px, C.py, C.pz);
    CBZ.camera.lookAt(C.tx, C.ty, C.tz);
    CBZ.camera.updateProjectionMatrix();
    if (CBZ.skySync) { try { CBZ.skySync(); } catch (_) {} }

    const fits = [];
    for (const r of mine) if (r.fit && fits.indexOf(r.fit) < 0) fits.push(r.fit);
    S.overlay.querySelector("[data-side]").textContent =
      (metrics.armourPieces ? "AFTER · working tree" : "BEFORE · HEAD") +
      "   ·   " + mine.length + " of yours   ·   " + metrics.uniforms + " uniform" +
      (metrics.uniforms === 1 ? "" : "s") + "   ·   " + metrics.armourReadable + " readable rungs   ·   " +
      metrics.armourPieces + " armour meshes";
    S.overlay.querySelector("[data-name]").textContent = sub.label;
    S.overlay.querySelector("[data-num]").textContent =
      mine.slice(0, 8).map((r) => r.armour + " " + (r.w == null ? "?" : r.w) + "w/" + r.d + "d " +
        (r.hatType || "bare")).join("   ·   ") + (fits.length ? "   ||   " + fits.join(" · ") : "");

    await sleep(90);
    try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}
    return { ok: true, cam: C, metrics, rows: rows.slice(0, 20) };
  },
};
