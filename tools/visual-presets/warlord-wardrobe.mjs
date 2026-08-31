/*
  warlord-wardrobe.mjs — THE PLAYER'S OWN FIT, photographed.

  DESERT WARLORD lets you pick what you ride out in, and the whole wave is a
  looking problem: no number can tell you whether a black suit reads as a
  SUIT or as a bin bag, whether a general's coat has rank on it or is just a
  dark box, or whether a grid of looks survives a 320pt phone. So every plate
  here is a picture of cloth, and the two layout plates are the picker itself
  at a phone and a laptop.

  FLAG A/B, one flag. `?wardrobe=old` is src/warlord/wardrobe.js's revert: the
  module boots and returns, nothing dresses anybody, the picker refuses to
  open. That is exactly what the player was before this file — campaign.js's
  `CBZ.studio.cast("officer", { color: 0xc46a33 })`, one flat orange body — so
  the before side is that same body, in the same lens and the same light, and
  the only variable on the wire is the flag.

  WHAT THE FIVE PLATES CLAIM
   1. black-suit    the fit the owner asked for by name: near-black jacket,
                    white shirt, BLACK tie, sunglasses and an earpiece with a
                    wire down the collar. The city's own "Black Suit" wears a
                    light-grey tie, which is a banker — this is a detail.
   2. camo-line     THE PITCH. The suit standing in a line of desert fatigues
                    and carriers. If the contrast does not land here it does
                    not land anywhere.
   3. generals      the earned end of the ladder: peaked cap, shoulder boards,
                    cuff rings, a sash, a chest of ribbons, a greatcoat.
   4. the-ladder    one family from levy to general — desert fatigues, the
                    carrier, the officer's field dress, the dress coat — which
                    is also what your own veterans wear when battle.js calls
                    W.wardrobe.dressSoldier.
   5. picker        the screen itself, at every frame in frameList. A grid of
                    looks you tap, live 3D at the top, locked rungs showing
                    the number of men they cost.

  THE NUMBERS ARE ABOUT THE PICTURE, NOT ABOUT BALANCE. fitsAvailable and
  fitsUnlocked are the size of the wardrobe and how much of it this warlord
  has earned; distinctLooks counts how many genuinely different garments are
  standing in the photographed row (the before side can only ever be 1);
  rankMarks counts the ornament meshes on the men in frame, which is the
  difference between "a dark coat" and "a general". hudOverlap and tileWidth
  are the two layout facts a phone breaks first.
*/

export default {
  id: "warlord-wardrobe",
  title: "Desert Warlord — the player's wardrobe: army uniforms, generals, and the black suit",
  description:
    "Flag A/B on one checkout: the before side boots ?wardrobe=old, where nobody has a fit and the warlord " +
    "is campaign.js's flat orange officer. Five plates: the secret-service black suit, that suit standing " +
    "in a camo line, the general's dress uniforms, one family from levy to general, and the picker screen " +
    "itself at 320pt, 393pt and laptop.",
  page: "games/warlord.html",

  defaultBefore: "local",
  urlParams: { seed: 1337, go: 1 },
  beforeParams: { wardrobe: "old" },
  beforeLabel: "BEFORE · ?wardrobe=old (no wardrobe, one flat officer)",
  afterLabel: "AFTER · the wardrobe",
  pairNote: "Same checkout, same seed, same lens and the same light — the wardrobe flag is the variable",

  /* 320pt is in the list because that is where a tile grid and a live preview
     actually break, and neither breakage is visible at 393. */
  frameList: ["iphone-se:portrait", "iphone-16:portrait", "laptop"],

  readyExpression:
    "window.__warlordReady === true && window.CBZ && CBZ.warlord && CBZ.warlord.wardrobe && CBZ.warlord.loadout",
  stageTimeoutMs: 300000,

  method:
    "One page per side per device frame. The world is built once from seed 1337 with loadout.demo()'s fixed " +
    "26-man warband, so both sides get the identical warlord. The four portrait plates are rendered through " +
    "W.wardrobe.lineup(), which is the picker's own preview renderer — same camera solve, same three lights " +
    "(games/warlord.html's own micro.lights values), same ACES + sRGB pipeline as the game — and pasted over " +
    "the page as one image so a phone frame and a laptop frame photograph the identical cloth at different " +
    "sizes. Under ?wardrobe=old lineup() casts the same rigs and does NOT dress them, so the before side is " +
    "genuinely the old body rather than the new one relabelled. The picker plate opens the real screen.",
  defaultFocus:
    "Does the black suit read as a suit next to camo, does a general read as a general, and does the grid survive 320pt?",

  subjects: [
    { id: "black-suit", label: "The black suit", act: "black-suit",
      focus: "The fit the owner asked for by name. Near-black jacket, white shirt, black tie, shades and an earpiece with the wire down the collar — and the same idea in charcoal, midnight and the driver's grey. Before: one flat orange body, because there was no such thing as a fit." },
    { id: "camo-line", label: "The suit in a camo line", act: "camo-line",
      focus: "The whole pitch in one frame: black tailoring standing in desert fatigues, a coyote carrier and militia khakis. If the suit does not read against camo it does not read." },
    { id: "generals", label: "Generals", act: "generals",
      focus: "The earned end of the ladder — peaked cap, shoulder boards with pips, gold cuff rings, a sash, eight ribbons, a greatcoat and a cape. These open at 120 standing, which is core's own BAND_CLASSES row for an army." },
    { id: "the-ladder", label: "One family, levy to general", act: "the-ladder",
      focus: "Desert fatigues, the assault carrier, the officer's field dress, the general's coat, the marshal. This is also what YOUR men wear: fitForSoldier maps a veteran onto the officer rung of whatever family you are wearing." },
    { id: "picker", label: "The picker", act: "picker",
      focus: "A grid of looks you tap — one tap wears it, the live 3D at the top shows you in it, and a locked rung shows the number of men it costs. Before: the wardrobe refuses to open, so this is the armoury, the only screen that ever let you change anything." },
  ],

  metrics: {
    fitsAvailable: { label: "Fits in the wardrobe", unit: "fits", better: "higher" },
    fitsUnlocked: { label: "Fits this warlord has earned", unit: "fits", better: "higher" },
    distinctLooks: { label: "Distinct garments in the photographed row", unit: "looks", better: "higher" },
    rankMarks: { label: "Rank ornaments on the men in frame", unit: "meshes", better: "higher" },
    hudOverlap: { label: "Fixed strip overlapping the screen title", unit: "px", better: "lower" },
    tileWidth: { label: "Narrowest tile in the grid", unit: "px", better: "higher" },
  },
  metricsNote:
    "fitsAvailable is W.wardrobe.list().length; fitsUnlocked counts the ones open at this warlord's standing " +
    "(27 men plus fame/8). distinctLooks counts unique painted-atlas keys plus fit ids across the men actually " +
    "standing in the plate — the before side is structurally 1, because one flat tint is one look. rankMarks " +
    "counts the ornament meshes this module attached to those men (cap, boards, pips, cuff rings, gorget tabs, " +
    "sash, ribbons, coat panels, cape, shades, earpiece); it is 0 before by construction and it is the number " +
    "that separates a dark coat from a general. hudOverlap is the pixel overlap of the fixed MEN/$/DAY strip " +
    "with the screen's h1 — the layout fault warlord-outfitting.mjs found at 393pt, measured again here. " +
    "tileWidth is the narrowest .wl-wd-t in the grid, reported only by the picker plate; below about 76 px a " +
    "two-line fit name stops fitting and the grid has to drop to two columns.",

  // A named function expression: the runner ships this through stage.toString().
  stage: async function stageWarlordWardrobe(input) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const CBZ = window.CBZ;
    const W = CBZ && CBZ.warlord;
    if (!W || !W.wardrobe) return { ok: false, error: "CBZ.warlord.wardrobe missing" };
    const WD = W.wardrobe;

    /* THE WORLD, ONCE. Both sides walk the identical order — newGame reseeds
       core's stream, then loadout.demo() builds its fixed 26 men off
       positional hashes, never off the RNG — so throwing the flag cannot
       change the warlord being photographed. Fame is set, not earned, so
       "what is unlocked" is a fixed fact of the plate rather than a function
       of how the campaign happened to go. */
    if (!window.__wdWorld) {
      W.newGame({ seed: 1337 });
      if (W.loadout && W.loadout.demo) W.loadout.demo();
      W.state.fame = 120;                       // 27 men + 15 = 42 standing: a COMMANDER
      W.emit("army", W.state.army);
      window.__wdWorld = 1;
    }
    if (WD.ready) { try { await WD.ready(); } catch (e) {} }

    /* The plate cast, INSIDE the stage function on purpose: the runner ships
       this function through stage.toString() and evaluates it in the page, so
       a module-level constant here is not in scope over there. */
    const PORT = {
      "black-suit": { fits: ["detail_black", "detail_charcoal", "detail_midnight", "crew_driver"], yaw: -0.42, spread: 1.02 },
      "camo-line": { fits: ["field_desert", "field_carrier", "detail_black", "field_desert_wrap", "field_khaki"], yaw: -0.30, spread: 1.0 },
      "generals": { fits: ["gen_sand", "gen_night", "lord_greatcoat", "lord_oxblood", "dress_provost_general"], yaw: -0.34, spread: 1.0 },
      "the-ladder": { fits: ["field_desert", "field_carrier", "dress_sand_field", "gen_sand", "lord_oxblood"], yaw: -0.34, spread: 1.0 },
    };
    const act = input.subject.act;
    const off = !!(WD.off && WD.off());

    // ---- tear down whatever the previous subject left up ---------------------
    const prev = document.getElementById("__wdPlate");
    if (prev) prev.remove();
    if (WD.close) { try { WD.close(); } catch (e) {} }
    const stage = document.getElementById("stage");
    if (stage) { stage.classList.remove("on"); stage.innerHTML = ""; }

    let metrics = {
      fitsAvailable: off ? 0 : (WD.list ? WD.list().length : 0),
      fitsUnlocked: 0,
      distinctLooks: 0,
      rankMarks: 0,
      hudOverlap: 0,
    };
    if (!off && WD.list) {
      const all = WD.list();
      let n = 0;
      for (const f of all) if (WD.unlocked && WD.unlocked(f.id)) n++;
      metrics.fitsUnlocked = n;
    }

    if (PORT[act]) {
      /* THE PORTRAIT PLATES render through the picker's OWN preview renderer
         and are pasted over the page as a single <img>. That is deliberate:
         a device frame then changes the size of the picture and nothing else,
         so a 320pt phone and a laptop photograph the identical cloth and the
         plate is comparable across frames as well as across sides. */
      const P = PORT[act];
      let url = null;
      try {
        url = await WD.lineup(P.fits, { width: 1240, height: 620, yaw: P.yaw, spread: P.spread });
      } catch (e) { url = null; }
      if (!url) return { ok: false, error: "lineup returned nothing" };

      // count what is actually standing there
      const pv = WD.preview && WD.preview();
      const seen = {};
      let marks = 0;
      if (pv && pv.men) {
        for (let i = 2; i < pv.men.length; i++) {
          const m = pv.men[i];
          if (!m || !m.group || !m.group.visible) continue;
          const rig = m.rig;
          const key = (rig._clothesKey || "flat") + "/" + (rig._wlWardrobeFit || "none");
          seen[key] = 1;
          marks += (rig._wlKit && rig._wlKit.length) || 0;
        }
      }
      metrics.distinctLooks = Object.keys(seen).length;
      metrics.rankMarks = marks;

      const plate = document.createElement("div");
      plate.id = "__wdPlate";
      plate.style.cssText =
        "position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;" +
        "align-items:center;justify-content:center;gap:10px;padding:14px;" +
        "background:radial-gradient(130% 100% at 50% 12%,#2a1d0e,#100c07 76%);" +
        "font:600 13px/1.35 ui-sans-serif,system-ui,sans-serif;color:#f4ecd8";
      plate.innerHTML =
        '<div style="font-size:11px;letter-spacing:.24em;opacity:.5">' + input.subject.label.toUpperCase() + '</div>' +
        '<img src="' + url + '" style="max-width:100%;max-height:74vh;object-fit:contain">' +
        '<div style="font-size:11px;letter-spacing:.14em;opacity:.72;text-align:center;max-width:900px">' +
          (off ? "no wardrobe — one flat cast officer, five times"
               : P.fits.map((f) => (WD.fit(f) || {}).name || f).join("  ·  ")) +
        '</div>';
      document.body.appendChild(plate);
      await sleep(260);
      return { ok: true, act: act, frame: input.frame ? input.frame.id : null, metrics: metrics };
    }

    // ---- the picker screen itself -------------------------------------------
    if (!off) {
      WD.wear("gen_sand", true);                 // locked at 42 standing: refused, on purpose
      WD.wear("detail_black", true);
      WD.open();
      /* WAIT ON THE PORTRAITS, NOT ON A CLOCK. The grid fills itself from an
         IntersectionObserver at whatever rate the device manages, and this box
         renders roughly one portrait a second under software GL against a page
         that is also drawing a 14 km island behind the screen. A fixed sleep
         therefore photographs a different number of finished tiles on every
         run and on every frame size. warmTiles resolves when the first two
         rows exist. */
      try { await WD.warmTiles(16); } catch (e) {}
    } else if (W.loadout && W.loadout.open) {
      /* THE HONEST BEFORE FOR THIS PLATE. With the flag thrown the wardrobe
         refuses to open, so what is photographed is the only screen that ever
         let a player change anything about himself: the armoury. "You could
         choose a gun; you could not choose a look." */
      W.loadout.open();
    }
    // the portraits render one per frame; give the visible row time to fill in
    await sleep(off ? 500 : 500);
    const st = document.getElementById("stage");
    if (st) st.scrollTop = 0;
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    await sleep(300);

    const hud = document.getElementById("hud");
    const h1 = st ? st.querySelector("h1") : null;
    if (hud && h1 && hud.classList.contains("on")) {
      const a = hud.getBoundingClientRect(), b = h1.getBoundingClientRect();
      metrics.hudOverlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    }
    const tiles = st ? st.querySelectorAll(".wl-wd-t") : [];
    let narrow = 0;
    if (tiles.length) {
      narrow = Infinity;
      for (const t of tiles) narrow = Math.min(narrow, Math.round(t.getBoundingClientRect().width));
      metrics.tileWidth = narrow;
      let looks = 0;
      const shot = st.querySelectorAll(".wl-wd-t img:not([hidden])");
      looks = shot.length;
      metrics.distinctLooks = looks;
      metrics.rankMarks = 0;
    }
    return { ok: true, act: act, frame: input.frame ? input.frame.id : null, metrics: metrics };
  },
};
