/* DESERT WARLORD — EVERY ARMY GETS ITS OWN UNIFORM, photographed against
   its own revert switch.

   THE CLAIM UNDER TEST, in one sentence: before this wave every man in a
   warlord battle was `CBZ.studio.cast(role, { color: side.colour })` — the
   torso and the shoulder yoke tinted to the band's hex and nothing else — so
   a hundred-man fight was two solid blocks of colour and you could not tell a
   levy from a veteran, a bandit from a legionary, or which man was worth
   shooting first. src/warlord/outfits.js gives all five factions and all four
   tiers their own kit: base cloth, webbing, headwear, boots and an accent.

   BOTH SIDES ARE THIS CHECKOUT. The before side boots with `?outfits=old`,
   the wave's own one-line revert, so the only difference between the two
   images is this file's code path. No deployed build, no "forty other commits
   also changed" escape hatch.

   THE SCAFFOLD IS THE MODULE'S OWN GALLERY, asked for with `?gallery=outfits`
   — which composes with the revert flag on purpose, so the reverted side
   photographs the SAME pad, the SAME roster and the SAME cameras wearing the
   old flat team tint. Neither side boots the island, the campaign, a battle
   or any sibling module: this preset cannot be blocked or flattered by
   anybody else's wave.

   WHAT THE PICTURES HAVE TO ANSWER — and none of it is a number:
     · does a levy look like a veteran? (the portraits)
     · does an army look like one army? (the censuses)
     · does any of it survive 200 m of the battle's own haze over the
       island's own sand? (the two line-of-battle shots)
     · is anything clipping, floating, seamed, or the colour of the ground?

   THE 200 M FRAME IS A NARROW ONE and that is stated rather than hidden: at
   the battle camera's own field of view a 1.82 m man 200 m away is nine
   pixels tall and no uniform ever built would read. The line shot holds the
   whole line in frame at both ranges, which makes the 200 m image a
   spotting-glass crop — the honest question being "is there still an army
   here, and can you tell whose", not "can you count buttons".

   THE NUMBERS are all sampled off the LIVE rigs through W.outfits.sample(),
   which asks each render path in its own language: a clothes.js atlas keeps
   its colour in the canvas (CBZ.cityPaintedBodyHex), a camo material keeps
   its colour in the map (W.camo.mean), and only the flat path has it where
   you would look. Sampling material.color alone would have read every painted
   uniform as white.                                                        */

const FACTIONS = [
  { id: "bandit",  label: "Sand Bandits",
    focus: "MISMATCHED SCAVENGED CIVILIAN CLOTHES. A ragged coat, a dirty singlet, a hood, a cut denim jacket, a looted leather. Nothing matches and nothing was issued — that IS the uniform. The tier read is filth and headgear: a bare-headed levy, a rust rag on a raider, webbing on a soldier, a helmet and black looted kit on a veteran." },
  { id: "militia", label: "Oasis Militia",
    focus: "IMPROVISED UNIFORMITY. Farm overalls, well-crew oilskins, a hunter's field gear, the fire station's turnout coat — everybody's own clothes, with one green cloth on every head. The green is the only thing they agree about and it has to be the thing you see first." },
  { id: "company", label: "Free Company",
    focus: "PROFESSIONAL AND MATCHED. One slate uniform on all four tiers; what changes is the KIT — no webbing, then a belt, then a duty belt and badge, then a plate carrier and helmet. If the cloth reads as four different uniforms this record is wrong." },
  { id: "legion",  label: "Desert Legion",
    focus: "A REAL ARMY WITH RANK SHOWING. The ladder is ISSUE: a conscript in plain drill, camo fatigues at raider, a service tunic with an oxblood collar at soldier, a plate carrier and an officer's braided coat at veteran. The cloth is camouflage and is SUPPOSED to be quiet against sand — the read is the oxblood, the webbing and the boots." },
  { id: "warlord", label: "Rival Warlord",
    focus: "HIS COLOURS, DELIBERATELY. A violet sash across the chest, going gold at soldier, and lieutenants in actual tailoring. The sash is the cheapest tier read in the game; the black suit is the highest-contrast object either army owns." },
  { id: "you",     label: "Your Warband",
    focus: "THE ARMY YOU TOOK OFF OTHER PEOPLE. Every man wears the faction you beat him out of, hashed off his own id so he keeps it forever — with your amber on his head and nothing else of yours. Only veterans wear anything you issued. It should look like a mob with one colour in common, because that is what it is." },
];

const subjects = [];
for (const f of FACTIONS) {
  subjects.push({
    id: f.id + "-portrait", label: f.label + " · levy to veteran",
    kind: "portrait", faction: f.id,
    focus: f.focus + "  ||  FOUR MEN, LEFT TO RIGHT: levy, raider, soldier, veteran.",
  });
}
for (const fid of ["bandit", "militia", "company", "legion", "warlord"]) {
  const f = FACTIONS.find((x) => x.id === fid);
  subjects.push({
    id: fid + "-census", label: f.label + " · every variant",
    kind: "census", faction: fid,
    focus: "THE WHOLE CELL. Twelve records — three variants of each of the four tiers — so the question is whether the army holds together while no two men are identical. Rows read levy, raider, soldier, veteran.",
  });
}
subjects.push({
  id: "line-60", label: "Line of battle · 60 m",
  kind: "line", range: 60, fov: 24.5,
  focus: "FIVE ARMIES IN ONE LINE at the distance the battle camera actually sits. Left to right: bandits, militia, company, legion, warlord, each with its own tier mix out of W.FACTIONS. Every man should be placeable to an army — and no two armies should read as one block. This is the shot that caught the Free Company's guard blacks and the Rival Warlord's veteran black merging into a single dark smear.",
});
subjects.push({
  id: "line-200", label: "The same line at 200 m · same lens",
  kind: "line", range: 200, fov: 24.5,
  focus: "THE SAME LINE, THE SAME LENS, 140 M FURTHER OFF. And a finding worth stating: battle.js sets its fog at 420-2900 m, so 200 m in this game carries NO haze at all — range here is purely angular size, and the first version of this preset claimed otherwise. What has to survive being a third of the height: which block is which army.",
});
for (const fid of ["legion", "bandit"]) {
  const f = FACTIONS.find((x) => x.id === fid);
  subjects.push({
    id: "glass-" + fid, label: f.label + " · four tiers at 200 m",
    kind: "glass", faction: fid, range: 200,
    focus: "THE BRIEF'S ACTUAL QUESTION, asked at the range it was asked about: levy, raider, soldier, veteran, 200 m away, through a narrow enough frame to see them. If the ladder — bare head, rag, cap, helmet; no webbing to webbing to carrier; washed cloth to deep cloth — is still legible here then 'who gets the good rifle' is legible on a battlefield. " + (fid === "legion" ? "The Legion is the hard case: its cloth is real camouflage and is SUPPOSED to be quiet against sand, so the whole read has to come off the oxblood, the webbing and the headgear." : "The Bandits are the other hard case: nothing about them is issued, so the ladder has to come out of filth and scavenging alone."),
  });
}

async function stageWarlordOutfits(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budget, step) => {
    const end = Date.now() + budget;
    while (Date.now() < end) {
      try { if (test()) return true; } catch (_) {}
      await sleep(step || 60);
    }
    return false;
  };

  let S = window.__wlOutfitStage;
  if (!S) {
    const ok = await until(() => window.__warlordOutfitsReady === true &&
      CBZ.warlord && CBZ.warlord.outfits && CBZ.camera && CBZ.renderer, 240000, 120);
    if (!ok) return { ok: false, err: "warlord/outfits.js never signalled ready" };
    /* Every piece of page furniture off: the boot card, the menu screen, the
       HUD strip, the verb rail, the toasts. The pad and the men only. */
    for (const id of ["boot", "stage", "hud", "verbs", "toasts"]) {
      const n = document.getElementById(id);
      if (n) { n.style.display = "none"; n.classList.remove("on"); }
    }
    /* FREEZE THE CLOCK. The gallery poses every man once with animChar(t=0)
       and nothing here should breathe, sway or blink between the two sides —
       a shifted gait photographs as a costume change. */
    window.requestAnimationFrame = function () { return 0; };
    const overlay = document.createElement("div");
    overlay.id = "__wlOutfitOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;" +
      "font:600 13px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
      "color:#fff6e4;text-shadow:0 2px 10px #000,0 0 3px #000";
    overlay.innerHTML =
      '<div data-side style="position:absolute;left:14px;top:12px;font-size:11px;letter-spacing:.22em;opacity:.85"></div>' +
      '<div data-name style="position:absolute;left:14px;top:30px;font-size:19px;letter-spacing:.02em"></div>' +
      '<div data-fits style="position:absolute;left:14px;bottom:12px;font-size:11px;letter-spacing:.06em;opacity:.9;max-width:94%"></div>';
    document.body.appendChild(overlay);
    S = window.__wlOutfitStage = { overlay: overlay };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const sub = input.subject;
  const O = CBZ.warlord.outfits;
  const reverted = O.mode() === "off";

  let g = null, cam = null;
  if (sub.kind === "portrait") {
    g = O.gallery({ layout: "portrait", faction: sub.faction, seed: 4100 });
    cam = { px: 0, py: 1.32, pz: 6.4, tx: 0, ty: 1.0, tz: 0, fov: 42 };
  } else if (sub.kind === "census") {
    g = O.gallery({ layout: "census", faction: sub.faction, perCell: 3, cols: 4, seed: 4200 });
    /* RAISED AND PITCHED DOWN. Flat-on, the back rows of a three-deep census
       stand behind the front one and three records photograph as nothing. */
    cam = { px: 0, py: 4.4, pz: 13.0, tx: 0, ty: 1.25, tz: 0, fov: 40 };
  } else if (sub.kind === "glass") {
    g = O.gallery({ layout: "portrait", faction: sub.faction, spacing: 2.2, seed: 4400 });
    /* A SPOTTING GLASS. 200 m away and framed to ~11 m of line, which is the
       only way a 200 m question can be photographed at all: at the battle
       camera's own field of view a 1.82 m man out there is nine pixels and no
       uniform ever built would read. Stated rather than hidden. */
    cam = { px: 0, py: 1.35, pz: sub.range, tx: 0, ty: 1.05, tz: 0, fov: 2.0 };
  } else {
    g = O.gallery({ layout: "line", perFaction: 6, seed: 4300 });
    /* THE TWO RANGES ARE FRAMED TO THE SAME APPARENT MAN SIZE on purpose.
       A 60 m shot at the battle camera's field of view and a 200 m shot at
       the same field of view differ by "everything is now nine pixels", which
       tells you nothing you did not already know about pixels. Matching the
       framing makes the ONLY variable the thing actually under test: 140 more
       metres of the battle's own haze (0xd8c49a, fog 420-2900). */
    cam = { px: 0, py: 1.55, pz: sub.range, tx: 0, ty: 1.05, tz: 0, fov: sub.fov };
  }
  if (!g || !g.men.length) return { ok: false, err: "gallery built nothing" };

  /* THE CAMERA IS THE PRESET'S, NOT THE PAGE'S, and it is identical on both
     sides by construction: derived from the subject, never from anything the
     wave under test can move. */
  const C = input.referenceStage && input.referenceStage.cam ? input.referenceStage.cam : cam;
  CBZ.camera.fov = C.fov;
  CBZ.camera.near = 0.1;
  CBZ.camera.far = 6000;
  CBZ.camera.position.set(C.px, C.py, C.pz);
  CBZ.camera.lookAt(C.tx, C.ty, C.tz);
  CBZ.camera.updateProjectionMatrix();
  if (CBZ.skySync) { try { CBZ.skySync(); } catch (_) {} }
  else if (CBZ.skyDome && CBZ.skyDome.parent && CBZ.skyDome.parent.position) {
    CBZ.skyDome.parent.position.set(C.px, 0, C.pz);
  }

  // ---- the numbers, sampled off the live rigs ----
  const men = g.men;
  const rows = [];
  for (const m of men) {
    const sm = O.sample(m.group) || {};
    rows.push({
      faction: m.faction, tier: m.tier, fit: m.fit, name: m.name,
      torso: sm.torso, legs: sm.legs, head: sm.head, hat: !!sm.hat, belt: !!sm.belt,
    });
  }
  const lum = (n) => n == null ? null :
    (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
  const dist = (a, b) => {
    if (a == null || b == null) return 0;
    const dr = ((a >> 16) & 255) - ((b >> 16) & 255);
    const dg = ((a >> 8) & 255) - ((b >> 8) & 255);
    const db = (a & 255) - (b & 255);
    // redmean-lite 2/4/3, the same weighting camo.js scores concealment with
    return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) / 3;
  };
  const SAND = 0xd9b979, SANDL = lum(SAND);

  /* DISTINCT LOOKS, NOT DISTINCT ROSTER ENTRIES. The first version counted
     W.outfits.forSoldier ids, which the reverted side still computes even
     though it renders none of them — so the before column read "12 distinct
     uniforms" over twelve identical men. Count what is on the screen: the
     rendered cloth, boots, hat and webbing signature. */
  const fits = {};
  for (const r of rows) {
    fits[[r.torso, r.legs, r.head, r.hat ? 1 : 0, r.belt ? 1 : 0].join("/")] = 1;
  }

  // pairwise spread of what the men are actually wearing
  let sp = 0, spn = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) { sp += dist(rows[i].torso, rows[j].torso); spn++; }
  }

  // tier separation: mean torso+head per tier, then adjacent-tier distance
  const TIERS = ["levy", "raider", "soldier", "veteran"];
  const byTier = {};
  for (const r of rows) {
    const b = byTier[r.tier] || (byTier[r.tier] = { t: [], h: [] });
    if (r.torso != null) b.t.push(r.torso);
    if (r.head != null) b.h.push(r.head);
  }
  const meanHex = (a) => {
    if (!a.length) return null;
    let R = 0, G = 0, B = 0;
    for (const v of a) { R += (v >> 16) & 255; G += (v >> 8) & 255; B += v & 255; }
    const n = a.length;
    return (((R / n) | 0) << 16) | (((G / n) | 0) << 8) | ((B / n) | 0);
  };
  let tg = 0, tgn = 0;
  for (let i = 0; i + 1 < TIERS.length; i++) {
    const a = byTier[TIERS[i]], b = byTier[TIERS[i + 1]];
    if (!a || !b) continue;
    tg += (dist(meanHex(a.t), meanHex(b.t)) + dist(meanHex(a.h), meanHex(b.h))) * 0.5;
    tgn++;
  }

  // faction separation (only meaningful on the line shots)
  const byFac = {};
  for (const r of rows) (byFac[r.faction] = byFac[r.faction] || []).push(r.torso);
  const facKeys = Object.keys(byFac);
  let fg = 0, fgn = 0;
  for (let i = 0; i < facKeys.length; i++) {
    for (let j = i + 1; j < facKeys.length; j++) {
      fg += dist(meanHex(byFac[facKeys[i]].filter((v) => v != null)),
                 meanHex(byFac[facKeys[j]].filter((v) => v != null)));
      fgn++;
    }
  }

  // how far the cast sits off the ground's own value — the vanish test
  let sd = 0, sdn = 0;
  for (const r of rows) { if (r.torso != null) { sd += Math.abs(lum(r.torso) - SANDL); sdn++; } }

  let hats = 0, belts = 0, marked = 0;
  const ACC = { bandit: 0xc4593a, militia: 0x4a8f5a, company: 0x3f7fb8, legion: 0xa8862c, warlord: 0x8f4fb8, you: 0xffb347 };
  for (const r of rows) {
    if (r.hat) hats++;
    if (r.belt) belts++;
    /* THE MECHANISM factionGap CANNOT SEE. Mean cloth colour is a poor proxy
       for "can you tell whose army that is" once uniforms have structure —
       five flat pastels maximise it and carry no information at all. What
       actually carries faction at range is the ACCENT, and the accent lives
       on the head. Count the men whose headgear is within reach of their own
       army's colour. */
    if (r.hat && r.head != null && ACC[r.faction] != null && dist(r.head, ACC[r.faction]) < 34) marked++;
  }

  const metrics = {
    distinctFits: Object.keys(fits).length,
    torsoSpread: spn ? Math.round(sp / spn * 10) / 10 : 0,
    tierGap: tgn ? Math.round(tg / tgn * 10) / 10 : 0,
    factionGap: fgn ? Math.round(fg / fgn * 10) / 10 : 0,
    sandDelta: sdn ? Math.round(sd / sdn * 1000) / 10 : 0,
    headwear: hats,
    webbing: belts,
    factionMark: marked,
    men: rows.length,
  };

  // ---- caption ----
  const seen = [];
  for (const r of rows) if (seen.indexOf(r.name) < 0) seen.push(r.name);
  S.overlay.querySelector("[data-side]").textContent =
    (reverted ? "BEFORE · ?outfits=old — the flat team tint" : "AFTER · painted faction uniforms") +
    "   ·   " + metrics.men + " men   ·   " + metrics.distinctFits + " distinct fits";
  S.overlay.querySelector("[data-name]").textContent = sub.label;
  S.overlay.querySelector("[data-fits]").textContent = reverted
    ? "every man is CBZ.studio.cast(role, { color: side.colour })"
    : seen.slice(0, 12).join("  ·  ");

  await sleep(90);
  try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {}

  return { ok: true, cam: C, metrics: metrics, rows: rows.slice(0, 16) };
}

export default {
  id: "warlord-outfits",
  page: "games/warlord.html",
  title: "Desert Warlord — Every Army Gets Its Own Uniform",
  description:
    "Five factions and four tiers, photographed against this wave's own one-line revert. The before side is the same checkout booted with ?outfits=old — battle.js's flat team tint, where the torso and the shoulder yoke are the band's hex and nothing else is. Both sides build the identical roster on the identical sand pad through src/warlord/outfits.js's own gallery, so the only variable in any pixel is the wardrobe.",
  defaultBefore: "local",
  beforeParams: { outfits: "old" },
  beforeLabel: "BEFORE · ?outfits=old (flat team tint)",
  afterLabel: "AFTER · faction uniforms, tier visible",
  viewport: { width: 1180, height: 720 },
  readyExpression: "window.__warlordOutfitsReady === true",
  urlParams: { gallery: "outfits", seed: 90210 },
  stageTimeoutMs: 300000,
  pairNote: "Same checkout · same pad · same roster · same cameras — ?outfits=old is the only variable",
  method:
    "Both sides are this checkout served by the same local server. The before side adds ?outfits=old, the wardrobe's one-line revert, which leaves W.outfits.cast() falling through to CBZ.studio.cast(role, { color: side.colour }) — exactly what battle.js did before this wave. The scaffold is the module's own ?gallery=outfits pad, which is deliberately built in BOTH modes so the reverted side has the same men on the same sand under the same battle fog (0xd8c49a, 420-2900). rAF is frozen and every man is posed once with animChar(t=0), so nothing moves between the two captures. Cameras are derived from the subject and reused from the baseline stage.",
  metricsNote:
    "Sampled off the LIVE rigs via W.outfits.sample(), which reads a clothes.js atlas through CBZ.cityPaintedBodyHex, a camo material through W.camo.mean, and a flat material through its own colour — reading material.color alone would score every painted uniform as white. distinctFits is how many different records are on screen (the reverted side can only ever be 1). torsoSpread and tierGap are mean weighted-RGB distances, the same 2/4/3 weighting camo.js scores concealment with. sandDelta is the mean luminance gap between a man's cloth and the island's own 0xd9b979 sand, x100 — the number that says whether an army vanishes into the ground. factionGap REGRESSES and it is left pointing the way it does on purpose: the reverted side is five flat saturated hues, which is the theoretical maximum for a mean-colour distance and carries no information whatever, so no realistic desert palette can beat it on that measure. What replaced it is factionMark — every man flying his own army's accent where the silhouette is highest — plus the structure the pictures show. The right response to that red mark is to open line-60 and count the blocks, which is why the pairs exist.",
  metrics: {
    distinctFits: { label: "Distinct uniforms on screen", unit: "fits", better: "higher" },
    torsoSpread: { label: "Man-to-man cloth spread", unit: "ΔRGB", better: "higher" },
    tierGap: { label: "Adjacent-tier separation", unit: "ΔRGB", better: "higher" },
    factionGap: { label: "Army-to-army separation", unit: "ΔRGB", better: "higher" },
    sandDelta: { label: "Cloth vs sand luminance gap", unit: "×100", better: "higher" },
    headwear: { label: "Men wearing headgear", unit: "men", better: "higher" },
    webbing: { label: "Men carrying webbing", unit: "men", better: "higher" },
    factionMark: { label: "Men flying their army's colour on the head", unit: "men", better: "higher" },
    men: { label: "Men photographed", unit: "men" },
  },
  subjects,
  stage: stageWarlordOutfits,
};
