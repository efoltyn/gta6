/* ============================================================
   city/itemicons.js — WHAT A THING IN YOUR BAG *IS*.

   OWNER (2026-07-28, verbatim): "I killed a wild boar, and it put these
   things in my inventory that just have, like, the generic icon... There's
   all these things in the inventory with these super unclear icons that you
   can't even hold. It's, like, just some very undone things."

   He was righter than he knew. The city inventory, the HUD hotbar, the
   character panel and the escape-mode stash each carried their OWN icon
   table — four of them — and at some point every emoji in this repo was
   stripped, so all four tables are now literally maps of EMPTY STRINGS:

       Pistol: "", Burger: "", "Gold Bar": "", Wood: "", ...

   `ICON[name] || TAG_ICON[tag] || "▪"` therefore resolves to "▪" for EVERY
   item in the game, and hud.js's chip resolves to "▣" for every item in the
   game. Nothing was "missing an icon for wild meat" — nothing had an icon
   at all. That is the bug, and it cannot be fixed by adding rows to a table
   that four files disagree about.

   THIS FILE IS THE ONE ANSWER. An item's face is DRAWN, from its KIND:

     CBZ.itemIcon(name, row)            -> a data: URI (cached forever)
     CBZ.itemIconHtml(name, row, cls)   -> "<img class='itemIcn ...'>"
     CBZ.itemKind(name, row)            -> the pictogram kind string
     CBZ.itemVerb(name, row)            -> { id, label, hint } — what you DO
     CBZ.itemTip(name, row, count)      -> the slot tooltip (worth + verb)
     CBZ.cityUseItem(name)              -> run that verb (existing primitives)
     CBZ.itemIconAudit() / itemVerbAudit()

   THE ART. 12x12 pixel sprites baked into SVG data-URIs at first ask — the
   EXACT technique city/hud.js already uses for its hearts/shanks/armour
   plates, so an item in a slot reads as family with the vitals above it.
   No fetches, no canvas, no atlas; a sprite costs one string and is cached
   per (kind x palette), so 40 species share ~36 drawings.

   WHY KIND AND NOT NAME. Half the catalog is registered at RUNTIME — every
   pelt and every meat in wildlife.js, the fishing catch, roleverbs' produce,
   C4, the chest, ordnance. A name table can never cover those; it is the
   very hole the owner fell into. So the classifier reads the ROW's own facts
   first (`meat` / `pelt` / `gun` / `melee` / `medkit` / `armor` / `throwable`
   / `slot` / `rounds`), then the name, then the TAG — and every tag resolves,
   which is what makes `itemIconAudit().generic` structurally 0 rather than
   aspirationally 0. A species added to the bestiary tomorrow is drawn for
   free, IN ITS OWN COLOUR: the tint comes off the species' declared `color`,
   so a Polar Bear Pelt is white and a Boar Hide is dark brown with no table.

   GLYPH CRAFT (the map's rules, applied at slot size — see CLAUDE.md's
   "THE MAP SPEAKS IN ICONS"): silhouette over detail; ONE idea per glyph;
   never colour alone (a fillet is a slab with cut lines, not "pink meat");
   consistent optical weight; optically centred in the 12x12 box.

   Flag: CBZ.CONFIG.ITEM_ICONS_V2 (default true). Off = every consumer keeps
   its old glyph expression byte-identically (which is the "▪" world).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const C = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (C.ITEM_ICONS_V2 == null) C.ITEM_ICONS_V2 = true;
  function on() { return C.ITEM_ICONS_V2 !== false; }

  // ============================================================
  //  1. THE SPRITE SHEET — 12x12, one string per row.
  //  legend:  .  nothing      O  outline      A  fill      B  shade
  //           C  highlight    D  accent       E  accent-light   F  detail
  //  Rows are padded/clipped to 12 on bake, so a miscounted row degrades
  //  into a slightly-off drawing instead of a broken sprite.
  // ============================================================
  const W = 12;
  const ART = {
    // ---- the hunt pays ----------------------------------------------------
    // a bone-in cut: the knuckle is what says MEAT and not "a red blob".
    meat: [
      "....OOO.....",
      "...OEEEO....",
      "...OEEEO....",
      "....OEO.....",
      "..OOOEOOO...",
      ".OCCAAAAAO..",
      "OCCAAADAAABO",
      "OCAAAADAAABO",
      "OAAAAAAAABBO",
      ".OAAAAAABBO.",
      "..OOAAABOO..",
      "....OOOO....",
    ],
    // a boneless slab — the cut striations are the whole idea
    fillet: [
      "............",
      "...OOOOOO...",
      "..OACACACAO.",
      ".OACACACAABO",
      "OACACACAAABO",
      "OACACACAAABO",
      "OAACACAAAABO",
      "OAAACAAAABBO",
      ".OAAAAAABBO.",
      "..OOAAABBO..",
      "....OOOOO...",
      "............",
    ],
    // whole fish, nose right, forked tail left, pale belly band
    fish: [
      "............",
      "......OOO...",
      "O....OAAAOO.",
      "OO..OAAAAAAO",
      "OBOOAAAAAFAO",
      "OBBAAAAAAAAO",
      "OBBAACCCCCAO",
      "OBOOACCCCAO.",
      "OO..OBBBBOO.",
      "......OOO...",
      "............",
      "............",
    ],
    // the classic stretched hide — four lobes and a pale belly
    pelt: [
      "..O......O..",
      ".OAO....OAO.",
      ".OAAO..OAAO.",
      "..OAAOOAAO..",
      "..OAACCAAO..",
      ".OAACCCCAAO.",
      ".OAACCCCAAO.",
      "..OAACCAAO..",
      "..OAAOOAAO..",
      ".OAAO..OAAO.",
      ".OAO....OAO.",
      "..O......O..",
    ],
    feather: [
      ".........OO.",
      "........OCAO",
      ".......OCAAO",
      "......OCACAO",
      ".....OCACAO.",
      "....OCACAO..",
      "...OCACAO...",
      "..OCACAO....",
      ".OCAOAO.....",
      "OCAO.OO.....",
      "OOO.........",
      "............",
    ],
    fin: [
      "......OO....",
      ".....OCAO...",
      ".....OCAAO..",
      "....OCAAAO..",
      "....OCAAABO.",
      "...OCAAAABO.",
      "...OCAAAABO.",
      "..OCAAAAABO.",
      "..OCAAAAABBO",
      ".OCAAAAAABBO",
      "OOOOOOOOOOOO",
      "............",
    ],
    tooth: [
      "..OOOOOOOO..",
      ".OCCCCCCCCO.",
      "OCCCCCCCCCBO",
      "OCCCCCCCCBBO",
      ".OCCCCCCCBO.",
      ".OCCCCCCCBO.",
      "..OCCCCCBO..",
      "..OCCCCCBO..",
      "...OCCCBO...",
      "....OCBO....",
      ".....OO.....",
      "............",
    ],
    bone: [
      "............",
      "..OO....OO..",
      ".OCAO..OCAO.",
      ".OAAOOOOAAO.",
      "..OAAAAAAO..",
      "..OAAAAAAO..",
      ".OAAOOOOAAO.",
      ".OCAO..OCAO.",
      "..OO....OO..",
      "............",
      "............",
      "............",
    ],
    // ---- food you buy -----------------------------------------------------
    meal: [
      "............",
      "..OOOOOOOO..",
      ".OCCAAAAAAO.",
      "OCAAAAAAAABO",
      "OOOOOOOOOOOO",
      "ODDDDDDDDDDO",
      "OEEEEEEEEEEO",
      "OOOOOOOOOOOO",
      "OAAAAAAAAABO",
      ".OAAAAAAABO.",
      "..OOOOOOOO..",
      "............",
    ],
    pizza: [
      ".....OO.....",
      "....OAAO....",
      "....OAAO....",
      "...OAADAO...",
      "...OAAAAO...",
      "..OADAAADO..",
      "..OAAAAAAO..",
      ".OAAADAAAAO.",
      ".OAAAAAAAAO.",
      "OEEEEEEEEEEO",
      "OOOOOOOOOOOO",
      "............",
    ],
    fries: [
      "..O...O...O.",
      ".OEO.OEO.OEO",
      ".OEO.OEO.OEO",
      ".OEOOOEOOOEO",
      ".OEEEEEEEEEO",
      "OOOOOOOOOOOO",
      "OCAAAAAAAABO",
      ".OAAAAAAAABO",
      ".OAAAAAAAABO",
      "..OAAAAAABO.",
      "..OOOOOOOO..",
      "............",
    ],
    drink: [
      "........O...",
      ".......OEO..",
      "..OOOOOEOO..",
      ".OEEEEEEEEO.",
      ".OOOOOOOOOO.",
      ".OCAAAAAABO.",
      ".OCAAAAAABO.",
      "..OCAAAAABO.",
      "..OCAAAAABO.",
      "...OAAAABO..",
      "...OOOOOOO..",
      "............",
    ],
    bread: [
      "............",
      "...OOOOOO...",
      "..OCCCAAAO..",
      ".OCCAAAAAAO.",
      "OCAAAAAAAABO",
      "OCAADAADAABO",
      "OAAADAADAABO",
      "OAAAAAAAAABO",
      "OAAAAAAAABBO",
      ".OAAAAAABBO.",
      "..OOOOOOOO..",
      "............",
    ],
    can: [
      "............",
      "..OOOOOOOO..",
      ".OEEEEEEEEO.",
      ".OOOOOOOOOO.",
      "OCAAAAAAAABO",
      "OCADDDDDDABO",
      "OCADDDDDDABO",
      "OCADDDDDDABO",
      "OCAAAAAAAABO",
      ".OOOOOOOOOO.",
      "..OOOOOOOO..",
      "............",
    ],
    produce: [
      ".....OO.....",
      "...OODDO....",
      "..OODDDOO...",
      ".OAACAAAAO..",
      "OACCAAAAAABO",
      "OACCAAAAAABO",
      "OAACAAAAAABO",
      "OAAAAAAAABBO",
      ".OAAAAAABBO.",
      "..OAAAABBO..",
      "...OOOOOO...",
      "............",
    ],
    // ---- product ----------------------------------------------------------
    drug: [
      "...OOOOOO...",
      "..OEEEEEEO..",
      "..OOOOOOOO..",
      ".OAAAAAAAAO.",
      ".OACCAAAAAO.",
      ".OACCAAAAAO.",
      ".OAAADDDAAO.",
      ".OAADDDDDAO.",
      ".OADDDDDDAO.",
      ".ODDDDDDDDO.",
      "..OOOOOOOO..",
      "............",
    ],
    pill: [
      "............",
      ".......OOOO.",
      "......ODDDDO",
      ".....ODDDDDO",
      "....ODDDDDO.",
      "...OCCDDOO..",
      "..OCCAAOO...",
      ".OCAAAAO....",
      ".OAAAAO.....",
      ".OAAAO......",
      "..OOO.......",
      "............",
    ],
    // ---- arms -------------------------------------------------------------
    gun: [
      "............",
      "............",
      ".OOOOOOOO...",
      "OCAAAAAAAO..",
      "OAAAAAAAAAO.",
      "OOOOAAOOOOO.",
      "..OAAAO.....",
      "..OBAAO.....",
      "..OBAAO.....",
      "..OBAAO.....",
      "..OOOOO.....",
      "............",
    ],
    melee: [
      ".........OO.",
      "........OCAO",
      ".......OCAAO",
      "......OCAAO.",
      ".....OCAAO..",
      "....OCAAO...",
      "...OCAAO....",
      "..OOAAO.....",
      ".ODDDO......",
      "ODDDO.......",
      "OOOO........",
      "............",
    ],
    ammo: [
      "..O.O.O.....",
      ".ODODODO....",
      ".ODODODO....",
      ".OOOOOOO....",
      "OOOOOOOOOOO.",
      "OAAAAAAAAABO",
      "OACCAAAAAABO",
      "OAAAAAAAAABO",
      "OAAAAAAAAABO",
      "OABBBBBBBBBO",
      "OOOOOOOOOOOO",
      "............",
    ],
    grenade: [
      "....OOO.....",
      "...ODDDO....",
      "..OODDDOO...",
      ".OOOOOOOOO..",
      ".OACAAAAABO.",
      "OACAAAAAAABO",
      "OAAAAAAAAABO",
      "OAAAAAAAAABO",
      "OABAAAAAABBO",
      ".OABBBBBBBO.",
      "..OOOOOOOO..",
      "............",
    ],
    bomb: [
      "..........OO",
      ".........OCO",
      "....OOOO.OO.",
      "..OOCCCCOO..",
      ".OCCAAAAAO..",
      "OCCAAAAAAAO.",
      "OCAAAAAAAAO.",
      "OAAAAAAAAAO.",
      "OAAAAAAAABO.",
      ".OAAAAAABO..",
      "..OOOOOOO...",
      "............",
    ],
    // ---- kit --------------------------------------------------------------
    medkit: [
      "............",
      "....OOOO....",
      "...OO..OO...",
      ".OOOOOOOOOO.",
      "OCAAAAAAAABO",
      "OCAADDDAAABO",
      "OCADDDDDAABO",
      "OCAADDDAAABO",
      "OCAAAAAAAABO",
      "OABBBBBBBBBO",
      ".OOOOOOOOOO.",
      "............",
    ],
    armor: [
      "..OO....OO..",
      ".OCAOOOOAAO.",
      "OCAAAAAAAABO",
      "OCAAAAAAAABO",
      "OCAADDDDAABO",
      "OCAADDDDAABO",
      "OCAADDDDAABO",
      "OCAAAAAAAABO",
      ".OAAAAAAABO.",
      ".OAAAAAAABO.",
      "..OOOOOOOO..",
      "............",
    ],
    tool: [
      ".......OOO..",
      "......OCAAO.",
      "......OAOAO.",
      "......OAOAO.",
      ".....OCAAAO.",
      "....OCAAAO..",
      "...OCAAO....",
      "..OCAAO.....",
      ".OCAAO......",
      "OCAAO.......",
      "OOAO........",
      ".OO.........",
    ],
    crowbar: [
      "........OOO.",
      ".......OCAAO",
      ".......OAAO.",
      "......OCAO..",
      ".....OCAO...",
      "....OCAO....",
      "...OCAO.....",
      "..OCAO......",
      ".OCAO.......",
      "OCAOO.......",
      "OAAAO.......",
      ".OOO........",
    ],
    pick: [
      "..........OO",
      ".........OCO",
      "..OOOOOOOCO.",
      ".OCAAAAAACO.",
      "OCAAOOOOOOO.",
      "OCAAO.......",
      "OOAAO.......",
      ".OOOO.......",
      "............",
      "............",
      "............",
      "............",
    ],
    key: [
      "............",
      "..OOOO......",
      ".OCAAAO.....",
      "OCAOOAO.....",
      "OCAO.OAOOOOO",
      "OCAO.OAAAAAO",
      "OCAOOAOOAOAO",
      ".OCAAAO.O.O.",
      "..OOOO......",
      "............",
      "............",
      "............",
    ],
    chest: [
      "............",
      ".OOOOOOOOOO.",
      "OCAAAAAAAABO",
      "OCAAAAAAAABO",
      "OOOOODDOOOOO",
      "OCAAAODOAABO",
      "OCAAAOOOAABO",
      "OCAAAAAAAABO",
      "OCAAAAAAAABO",
      "OABBBBBBBBBO",
      ".OOOOOOOOOO.",
      "............",
    ],
    // ---- materials --------------------------------------------------------
    wood: [
      "............",
      "..OOOOOOOO..",
      ".OEEEOAAAAO.",
      "OEDDDEOAAAO.",
      "OEDFDEOAAAO.",
      "OEDDDEOAAAO.",
      "OEEEEEOAAAO.",
      ".OEEEOAAAAO.",
      "..OOOOOOOO..",
      "............",
      "............",
      "............",
    ],
    stone: [
      "............",
      "....OOOO....",
      "..OOCCCAOO..",
      ".OCCCAAAABO.",
      "OCCAAAAAAABO",
      "OCAAAAAAAABO",
      "OAAAAAAAABBO",
      "OAAAAAAABBBO",
      ".OAAAABBBBO.",
      "..OOBBBBOO..",
      "....OOOO....",
      "............",
    ],
    scrap: [
      "............",
      "..OOOO......",
      ".OCAAAOO....",
      "OCAAAAAAOO..",
      "OAAAABAAAAO.",
      ".OOAAAABAAO.",
      "...OOAAAAAO.",
      "..OOOOAAAOO.",
      ".OCAAAOOOO..",
      "OCAAAAAO....",
      ".OOOOOO.....",
      "............",
    ],
    // ---- money & shine ----------------------------------------------------
    cash: [
      "............",
      ".OOOOOOOOOO.",
      "OCAAADDDAAAO",
      "OAAADDDDDAAO",
      "OAAAADDDAAAO",
      "OOOOOOOOOOOO",
      "OEEEEEEEEEEO",
      "OOOOOOOOOOOO",
      "OAAAAAAAAABO",
      "OAAAAAAAAABO",
      ".OOOOOOOOOO.",
      "............",
    ],
    briefcase: [
      "............",
      "....OOOO....",
      "...OO..OO...",
      ".OOOOOOOOOO.",
      "OCAAAAAAAABO",
      "OCAAAAAAAABO",
      "OOOOOEEOOOOO",
      "OCAAAAAAAABO",
      "OCAAAAAAAABO",
      "OABBBBBBBBBO",
      ".OOOOOOOOOO.",
      "............",
    ],
    gold: [
      "............",
      "............",
      "...OOOOOO...",
      "..OCCCCCCO..",
      ".OOOOOOOOOO.",
      "OCCAAAAAAABO",
      "OCAAAAAAAABO",
      "OAAAAAAAABBO",
      "OAAAAAAABBBO",
      "OOOOOOOOOOOO",
      "............",
      "............",
    ],
    gem: [
      "............",
      "..OOOOOOOO..",
      ".OCCCEEECCO.",
      "OCCEEEEEECCO",
      "OOOOOOOOOOOO",
      ".OCAAEEAACO.",
      "..OCAAEACO..",
      "...OCAEACO..",
      "....OCEACO..",
      ".....OCAO...",
      "......OO....",
      "............",
    ],
    pouch: [
      "............",
      "...OOOOOO...",
      "..OEEEEEEO..",
      "..OOEEEEOO..",
      ".OCAAAAAAAO.",
      "OCAAAAAAAABO",
      "OCAAAAAAAABO",
      "OAAAAAAAAABO",
      "OAAAAAAAABBO",
      ".OAAAAAABBO.",
      "..OOOOOOOO..",
      "............",
    ],
    phone: [
      "..OOOOOOOO..",
      ".OCAAAAAAAO.",
      ".OAOOOOOOAO.",
      ".OAOEEEEOAO.",
      ".OAOEEEEOAO.",
      ".OAOEEEEOAO.",
      ".OAOEEEEOAO.",
      ".OAOEEEEOAO.",
      ".OAOOOOOOAO.",
      ".OABBBBBBAO.",
      "..OOOOOOOO..",
      "............",
    ],
    laptop: [
      "............",
      "..OOOOOOOO..",
      ".OEEEEEEEEO.",
      ".OEEEEEEEEO.",
      ".OEEEEEEEEO.",
      ".OEEEEEEEEO.",
      ".OOOOOOOOOO.",
      "OCAAAAAAAABO",
      "OAAAAAAAAABO",
      "OOOOOOOOOOOO",
      "............",
      "............",
    ],
    wallet: [
      "............",
      "..OOOOOOOO..",
      ".OCAAAAAAAO.",
      "OCAAAAAAAABO",
      "OAAOOOOOOABO",
      "OAAODDDDOABO",
      "OAAOOOOOOABO",
      "OAAAAAAAAABO",
      "OAAAAAAOOABO",
      ".OAAAAAOOAO.",
      "..OOOOOOOO..",
      "............",
    ],
    // ---- what you wear ----------------------------------------------------
    hat: [
      "............",
      "...OOOOOO...",
      "..OCCAAAAO..",
      ".OCAAAAAAAO.",
      "OCAAAAAAAABO",
      "OAAAAAAAAABO",
      "OOOOOOOOOOOO",
      "OEEEEEEEEEEO",
      ".OOOOOOOOOO.",
      "............",
      "............",
      "............",
    ],
    top: [
      "..OOO..OOO..",
      ".OCAOOOOAAO.",
      "OCAAAAAAAABO",
      "OCAAAAAAAABO",
      "OOOAAAAAAOOO",
      "..OAAAAAAO..",
      "..OAAAAAAO..",
      "..OAAAAAAO..",
      "..OAAAAAAO..",
      "..OABBBBAO..",
      "..OOOOOOOO..",
      "............",
    ],
    outer: [
      "..OOOOOOOO..",
      ".OCAOOOOAAO.",
      "OCAAAOOAAABO",
      "OCAAAODAAABO",
      "OCAAAODAAABO",
      "OCAAAODAAABO",
      "OCAAAODAAABO",
      "OCAAAODAAABO",
      "OAAAAODAAABO",
      "OABBBODBBBBO",
      ".OOOOOOOOOO.",
      "............",
    ],
    bottom: [
      "..OOOOOOOO..",
      ".OCAAAAAAAO.",
      ".OCAAAAAAAO.",
      ".OCAAAAAAAO.",
      ".OCAAOOAAAO.",
      ".OCAAOOAAAO.",
      ".OCAAOOAAAO.",
      ".OCAAOOAAAO.",
      ".OCAAOOAAAO.",
      ".OAAAOOAABO.",
      ".OOOOOOOOOO.",
      "............",
    ],
    shoes: [
      "............",
      "............",
      "......OOOO..",
      ".....OCAAAO.",
      "....OCAAAAO.",
      "...OCAAEAAO.",
      "..OCAAEAAAO.",
      ".OCAAAAAAAO.",
      "OCAAAAAAAABO",
      "OEEEEEEEEEEO",
      "OOOOOOOOOOOO",
      "............",
    ],
    glasses: [
      "............",
      "............",
      "............",
      "OOOOOOOOOOOO",
      "OEEEOOOOEEEO",
      "OEEEO..OEEEO",
      "OEEEO..OEEEO",
      ".OOO....OOO.",
      "............",
      "............",
      "............",
      "............",
    ],
    chain: [
      ".OO......OO.",
      "OCAO....OCAO",
      ".OO......OO.",
      "..OO....OO..",
      ".OCAO..OCAO.",
      "..OO....OO..",
      "...OO..OO...",
      "..OCAOOCAO..",
      "...OO..OO...",
      "....OOOO....",
      "....OCAO....",
      "....OOOO....",
    ],
    watch: [
      "....OOOO....",
      "....ODDO....",
      "..OOOOOOOO..",
      ".OCAAAAAAAO.",
      "OCAAAEEAAABO",
      "OCAAEEEEAABO",
      "OCAAAEEAAABO",
      ".OAAAAAAABO.",
      "..OOOOOOOO..",
      "....ODDO....",
      "....OOOO....",
      "............",
    ],
    ring: [
      "............",
      ".....OO.....",
      "....OEEO....",
      "...OOEEOO...",
      "..OCAAAACO..",
      ".OCAOOOOACO.",
      ".OAO....OAO.",
      ".OAO....OAO.",
      ".OCAO..OACO.",
      "..OCAAAACO..",
      "...OOOOOO...",
      "............",
    ],
    // ---- the last resort: a sealed parcel. Still a DRAWING, never a "▪".
    parcel: [
      "............",
      "..OOOOOOOO..",
      ".OCAAODAAAO.",
      ".OCAAODAAAO.",
      ".OOOOODOOOO.",
      ".ODDDDDDDDO.",
      ".OOOOODOOOO.",
      ".OCAAODAAAO.",
      ".OCAAODAAAO.",
      ".OABBODBBBO.",
      "..OOOOOOOO..",
      "............",
    ],
  };
  const GENERIC = "parcel";       // the ONE kind the audit counts against us

  // ============================================================
  //  2. COLOUR — a palette is derived, never authored per item.
  // ============================================================
  function clamp8(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
  function rgb(hex) { return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]; }
  function hex(r, g, b) { return "#" + ((1 << 24) | (clamp8(r) << 16) | (clamp8(g) << 8) | clamp8(b)).toString(16).slice(1); }
  function lum(h) { const c = rgb(h); return (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255; }
  function mix(a, b, t) {
    const x = rgb(a), y = rgb(b);
    return ((clamp8(x[0] + (y[0] - x[0]) * t) << 16) | (clamp8(x[1] + (y[1] - x[1]) * t) << 8) | clamp8(x[2] + (y[2] - x[2]) * t));
  }
  function shade(h, k) { const c = rgb(h); return hex(c[0] * k, c[1] * k, c[2] * k); }
  function light(h, t) { const c = rgb(h); return hex(c[0] + (255 - c[0]) * t, c[1] + (255 - c[1]) * t, c[2] + (255 - c[2]) * t); }

  // outline is the item's OWN colour crushed toward black, so a white pelt
  // still reads as a pelt against the dark slot instead of vanishing.
  function palette(base, acc, acc2) {
    return {
      O: shade(base, 0.22),
      A: hex.apply(null, rgb(base)),
      B: shade(base, 0.68),
      C: light(base, 0.34),
      D: hex.apply(null, rgb(acc)),
      E: light(acc, 0.32),
      F: shade(acc2 == null ? base : acc2, 0.45),
    };
  }

  // Per-kind default colours. A row with a `species` overrides the base.
  const TONE = {
    meat:      [0xa8443f, 0xe9dfc6, 0x6b2626],  // meat + fat marbling
    fillet:    [0xc06a63, 0xf0dcd2, 0x7a3a34],
    fish:      [0x7f9db2, 0x1a2630, 0x28323a],
    pelt:      [0x8a5a32, 0xd9c3a0, 0x3a2617],
    feather:   [0xd8d2c4, 0x8d8577, 0x4a463c],
    fin:       [0x6b7880, 0xd4dade, 0x2c3439],
    tooth:     [0xe8e2cf, 0xb9b09a, 0x6b6455],
    bone:      [0xe4dcc6, 0xb2a992, 0x5f5949],
    meal:      [0xc98a45, 0x7a3b22, 0x8fbe5c],  // bun / patty / lettuce
    pizza:     [0xe0b25a, 0xb63a2c, 0x8a5a22],
    fries:     [0xc9302c, 0xe8bd52, 0x7a1d1a],
    bread:     [0xc08a4a, 0x7a4c22, 0x6b4a1e],
    can:       [0xb9c2cb, 0xc4402f, 0x5f666e],
    drink:     [0xd8443c, 0xdfe6ee, 0x7a2320],
    produce:   [0xc4342f, 0x4f8f38, 0x7a1f1c],
    drug:      [0xcfd6de, 0xf0f2f5, 0x6d7480],
    pill:      [0xe4e8ee, 0xd8483f, 0x757c88],
    gun:       [0x6e7782, 0x2a2f36, 0x2a2f36],
    melee:     [0xbcc6d0, 0x35302a, 0x4a5058],
    ammo:      [0x8d6a3a, 0xc9a24a, 0x4c3820],
    grenade:   [0x4f5c3f, 0x2a2f22, 0x2a3024],
    bomb:      [0x3a4048, 0xc8b46a, 0x20242a],
    medkit:    [0xd8d3c8, 0xd23a34, 0x6f6b62],
    armor:     [0x3d4552, 0x8e99a6, 0x22272f],
    tool:      [0xa9b3bd, 0x59616b, 0x40464e],
    crowbar:   [0xb0362f, 0x6d2019, 0x4a1611],
    pick:      [0xc3ccd6, 0x5b636d, 0x3e444b],
    key:       [0xc9a44a, 0x8a6c22, 0x5c4715],
    chest:     [0x7a5230, 0xc9a44a, 0x3d2716],
    wood:      [0x6c4526, 0xd9b483, 0x3a2411],   // bark / end-grain
    stone:     [0x8b9099, 0x5b6068, 0x3c4046],
    scrap:     [0x9aa2ab, 0x5d646c, 0x3d4249],
    cash:      [0x7fae72, 0x2f5a34, 0xdad6c4],
    briefcase: [0x3a2719, 0xc9a44a, 0x1a110a],
    gold:      [0xe0b13c, 0xf6e08a, 0x8a6a16],
    gem:       [0x9fe4ff, 0xffffff, 0x2f6f8a],
    pouch:     [0x6b4a2a, 0xc9a44a, 0x3a2617],
    phone:     [0x2e343d, 0x6fc7e8, 0x181c22],
    laptop:    [0x4a525c, 0x8fd2e8, 0x272c33],
    wallet:    [0x4a2f1e, 0xd8d2c0, 0x24160d],
    hat:       [0x2f3b52, 0x1d2532, 0x131822],
    top:       [0xd8dde4, 0x8f98a4, 0x6d747e],
    outer:     [0x35404f, 0xc9a44a, 0x1c232c],
    bottom:    [0x3a4a63, 0x24303f, 0x1a222e],
    shoes:     [0xe4e7ea, 0xb6bcc4, 0x767d86],
    glasses:   [0x2a2f36, 0x1a1f26, 0x14181e],
    chain:     [0xe0b13c, 0xf6e08a, 0x8a6a16],
    watch:     [0xc9cfd6, 0x2a3038, 0x767d86],
    ring:      [0xe0b13c, 0x9fe4ff, 0x8a6a16],
    parcel:    [0xb59a72, 0x8a6a3a, 0x5c4a2c],
  };

  function speciesColor(id) {
    const S = CBZ.WILDLIFE_SPECIES;
    const sp = S && id && S[id];
    return sp && sp.color != null ? sp.color : null;
  }

  // The tint IS the animal. A hide keeps the beast's own colour; a cut of its
  // meat keeps only the beast's LIGHTNESS, ramped along a real flesh ladder
  // (dark game -> pale poultry), so venison reads dark and chicken reads pale
  // without one species name being typed.
  function toneFor(kind, name, row) {
    const t = TONE[kind] || TONE[GENERIC];
    let base = t[0], acc = t[1], acc2 = t[2];
    const sc = row && row.species ? speciesColor(row.species) : null;
    if (sc != null) {
      if (kind === "pelt" || kind === "feather" || kind === "fin" || kind === "tooth") base = sc;
      else if (kind === "fish") { base = sc; acc = mix(sc, 0x101820, 0.6); }
      else if (kind === "meat" || kind === "fillet") {
        const L = lum(sc);
        base = mix(0x77282a, 0xd99080, Math.max(0, Math.min(1, L)));
        acc2 = mix(base, 0x000000, 0.55);
      }
    }
    // a wearable/clothing row already declares its own colour — wear it.
    if (row && row.hex != null) base = row.hex;
    // a PRISTINE hide is visibly cleaner, not just worth more
    if (row && row.pristine) { base = mix(base, 0xffffff, 0.20); acc = mix(acc, 0xffffff, 0.25); }
    return [base, acc, acc2];
  }

  // ============================================================
  //  3. BAKE — rows -> one SVG data URI. Horizontal runs are merged so a
  //  sprite is ~30 rects, not 144, and the whole URI stays short.
  // ============================================================
  function bake(rows, pal) {
    // one PATH PER COLOUR, not one rect per pixel: a 12x12 sprite is ~55 runs,
    // and "M3,5h4v1h-4z" is a quarter of "<rect x='3' y='5' width='4' .../>".
    // The whole sprite lands around 1 KB, which matters because these strings
    // are pasted into innerHTML for 27 grid cells + 9 hotbar chips.
    const d = Object.create(null);
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      let x = 0;
      while (x < W) {
        const ch = x < row.length ? row[x] : ".";
        const col = ch === "." ? null : pal[ch];
        if (!col) { x++; continue; }
        let run = 1;
        while (x + run < W && (x + run < row.length ? row[x + run] : ".") === ch) run++;
        d[col] = (d[col] || "") + "M" + x + "," + y + "h" + run + "v1h-" + run + "z";
        x += run;
      }
    }
    let body = "";
    for (const col in d) body += "<path fill='" + col + "' d='" + d[col] + "'/>";
    // MINIMAL escaping, not encodeURIComponent: a sprite URI is pasted into
    // innerHTML for ~36 slots on every grid render, and blanket-encoding the
    // quotes/slashes/spaces more than DOUBLES it. Only the five characters a
    // data: URI in an attribute genuinely cannot carry are escaped.
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + W + " " + W + "' shape-rendering='crispEdges'>" + body + "</svg>";
    return "data:image/svg+xml," + svg
      .replace(/%/g, "%25").replace(/#/g, "%23")
      .replace(/</g, "%3C").replace(/>/g, "%3E")
      .replace(/"/g, "%22").replace(/ /g, "%20");
  }

  const cache = Object.create(null);
  const htmlCache = Object.create(null);
  function toneKey(kind, name, row) {
    const t = toneFor(kind, name, row);
    return { t: t, k: kind + "|" + t[0] + "|" + t[1] + "|" + t[2] };
  }
  function sprite(kind, name, row) {
    const art = ART[kind] || ART[GENERIC];
    const tk = toneKey(kind, name, row);
    let uri = cache[tk.k];
    if (!uri) { uri = cache[tk.k] = bake(art, palette(tk.t[0], tk.t[1], tk.t[2])); }
    return uri;
  }

  // ============================================================
  //  4. THE CLASSIFIER — row facts, then the name, then the tag. Every tag
  //  resolves, which is what makes itemIconAudit().generic structurally 0.
  // ============================================================
  const SLOT_KIND = {
    hat: "hat", top: "top", outer: "outer", bottom: "bottom", shoes: "shoes",
    glasses: "glasses", chain: "chain", watch: "watch", ring: "ring",
  };
  function kindOf(name, row) {
    const n = String(name == null ? "" : name).toLowerCase();
    row = row || null;

    // --- what the ROW says it is (covers every runtime registration) -------
    if (row) {
      if (row.pelt) {
        if (/\bfin\b|fin$/.test(n)) return "fin";
        if (/tooth|tusk|ivory|horn$/.test(n)) return "tooth";
        if (/feather|plume|down$/.test(n)) return "feather";
        return "pelt";
      }
      if (row.fish) return /fillet|steak|loin/.test(n) ? "fillet" : "fish";
      if (row.meat) return /fillet|steak|cut|loin|chop/.test(n) ? "fillet" : "meat";
      if (row.dogfeed && /bone/.test(n)) return "bone";
      if (row.ordnance || row.c4) return "bomb";
      if (row.missiles || row.airmunition) return "bomb";
      if (row.gun) return "gun";
      if (row.melee) return "melee";
      if (row.medkit) return "medkit";
      if (row.armor) return "armor";
      if (row.rounds) return "ammo";
      if (row.throwable) return "grenade";
      if (row.slot && SLOT_KIND[row.slot]) return SLOT_KIND[row.slot];
    }

    // --- the name, where it is genuinely more specific than the tag -------
    if (/shiv|knuckle|razor|\bblade\b|hacksaw|machete|cleaver/.test(n)) return "melee";
    if (/ramen|noodle|soup|snack|candy|energy bar|granola|jerky/.test(n)) return "meal";
    if (/\btooth\b|\bteeth\b|\bfang\b/.test(n)) return "tooth";
    if (/^gun$/.test(n)) return "gun";
    if (/lockpick|\bpicks?\b/.test(n)) return "pick";
    if (/tattoo|drill|wrench|spanner/.test(n)) return "tool";
    if (/crowbar|prybar|pry bar/.test(n)) return "crowbar";
    if (/^chest$|foot ?locker|stash box/.test(n)) return "chest";
    if (/\bkey\b/.test(n)) return "key";
    if (/laptop|computer|tablet/.test(n)) return "laptop";
    if (/phone|burner|sim\b/.test(n)) return "phone";
    if (/wallet|purse|billfold/.test(n)) return "wallet";
    if (/briefcase|case of|duffel|attach/.test(n)) return "briefcase";
    if (/gold bar|bullion|ingot/.test(n)) return "gold";
    if (/cash|bonds|bills|roll$|stack$|banknote/.test(n)) return "cash";
    if (/bone/.test(n)) return "bone";
    if (/rock|pebble|boulder|brick/.test(n)) return "stone";
    if (/wood|log|timber|plank|lumber/.test(n)) return "wood";
    if (/scrap|metal|steel|alloy/.test(n)) return "scrap";
    if (/pill|painkiller|antidote|meds?\b/.test(n)) return "pill";
    if (/pizza/.test(n)) return "pizza";
    if (/frie|chips|crisps/.test(n)) return "fries";
    if (/bread|loaf|bun|bagel/.test(n)) return "bread";
    if (/canned|\bcan\b|\btin\b|preserve/.test(n)) return "can";
    if (/soda|drink|water|juice|beer|coffee|hooch|liquor|bottle|can$/.test(n)) return "drink";
    if (/produce|apple|fruit|veg|corn|grain|crop|greens|herb/.test(n)) return "produce";
    if (/fillet|steak|loin|brisket|\bcut\b/.test(n)) return "fillet";
    if (/fish|trout|cod|bass|salmon|tuna|mackerel/.test(n)) return "fish";

    // --- the TAG. Nothing below here may fall through. The plural tags are
    //     systems/economy.js's vocabulary (the escape-mode bag), which uses
    //     "drugs"/"tools"/"valuables"/"goods"/"key" for the same ideas.
    const tag = row && row.tag;
    switch (tag) {
      case "food": return "meal";
      case "weapon": return "gun";
      case "throwable": return "grenade";
      case "ammo": return "ammo";
      case "ordnance": return "bomb";
      case "drug": case "drugs": return "drug";
      case "resource": return "stone";
      case "tool": case "tools": return "tool";
      case "key": return "key";
      case "wearable": case "clothing": case "jewelry":
        return (row && SLOT_KIND[row.slot]) || "top";
      case "valuable": case "valuables":
        if (/watch|omega|rolex|patek|piguet|mille/.test(n)) return "watch";
        if (/ring|necklace|tiara|bracelet|diamond|jewel|gem|stone/.test(n)) return "gem";
        if (/chain/.test(n)) return "chain";
        if (/art|paint|canvas/.test(n)) return "gem";
        return "pouch";
      default: break;
    }
    return GENERIC;
  }

  // ============================================================
  //  5. PUBLIC FACE
  // ============================================================
  function rowFor(name, row) {
    if (row) return row;
    const IT = (CBZ.cityEcon && CBZ.cityEcon.ITEMS) || (CBZ.econ && CBZ.econ.ITEMS) || null;
    return (IT && IT[name]) || null;
  }
  CBZ.itemKind = function (name, row) { return kindOf(name, rowFor(name, row)); };
  CBZ.itemIcon = function (name, row) {
    if (!on()) return "";
    row = rowFor(name, row);
    return sprite(kindOf(name, row), name, row);
  };
  // Legendary/pristine wear a ring of light — a rank you can see in the bag.
  function rarityClass(row) {
    if (!row) return "";
    if (row.luxe || row.legendary || /legendary/i.test(row.label || "")) return " rar-legend";
    if (row.pristine) return " rar-pristine";
    if (row.rarity && row.rarity !== "common") return " rar-pristine";
    return "";
  }
  CBZ.itemIconRarity = function (name, row) { return rarityClass(rowFor(name, row)); };

  // The one call a renderer makes. Returns "" when the flag is off so every
  // consumer keeps its own old expression (degrade-safe by construction).
  CBZ.itemIconHtml = function (name, row, cls) {
    if (!on()) return "";
    row = rowFor(name, row);
    // a GUN has a real rendered model already (weapon_thumbnails.js, cached) —
    // prefer the actual weapon over a pictogram of one.
    if (row && row.gun && CBZ.weaponThumbnail) {
      let src = "";
      try { src = CBZ.weaponThumbnail(row.gun); } catch (e) {}
      if (src) return "<img class='itemIcn gunFace " + (cls || "") + "' src='" + src + "' alt='' draggable='false'>";
    }
    // the whole <img> string is cached, not just the URI: the grid rebuilds 27
    // cells of innerHTML on every click and the fallback bar at 5 Hz.
    const kind = kindOf(name, row);
    const rc = rarityClass(row);
    const hk = toneKey(kind, name, row).k + "|" + (cls || "") + rc;
    let html = htmlCache[hk];
    if (!html) {
      html = htmlCache[hk] = "<img class='itemIcn " + (cls || "") + rc + "' src='" +
        sprite(kind, name, row) + "' alt='' draggable='false'>";
    }
    return html;
  };

  // ============================================================
  //  6. EVERY ITEM ANSWERS TO A VERB (or it is a stat fiction).
  //  This resolves the verb; it never invents one. Selling is a real verb —
  //  a pelt's whole point is the fence — so a sellable says WHAT it is worth
  //  and WHERE, which is what turns "an unclear icon you can't hold" into a
  //  thing with a purpose.
  // ============================================================
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function pawnPrice(name) {
    const E = CBZ.cityEcon;
    if (E && E.sellPrice) { try { const v = E.sellPrice(name, "pawn"); if (isFinite(v) && v > 0) return v; } catch (e) {} }
    const row = rowFor(name, null);
    return Math.round(((row && row.value) || 0) * 0.5);
  }
  function verbOf(name, row) {
    row = rowFor(name, row);
    if (!row) return null;
    // an animal's food is the ANIMAL'S — a dog treat is a thing you give, not
    // a snack you eat, so this outranks the heal it also carries.
    if (row.dogfeed) return { id: "feed", label: "Feed", hint: "to an animal" };
    if (row.heal) return { id: "eat", label: row.boost ? "Drink" : "Eat", hint: "+" + Math.round(row.heal) + " food" };
    if (row.gun) return { id: "equip", label: "Equip", hint: "sidearm" };
    if (row.melee) return { id: "equip", label: "Equip", hint: "melee" };
    if (row.throwable || row.c4 || row.tag === "throwable") return { id: "throw", label: "Throw", hint: "[T]" };
    if (row.place) return { id: "place", label: "Place", hint: "set it down here" };
    if (row.medkit) return { id: "heal", label: "Patch up", hint: "+" + row.medkit + " hp" };
    if (row.armor) return { id: "armor", label: "Strap on", hint: "+" + row.armor + " armor" };
    if (row.rounds) return { id: "ammo", label: "Load", hint: "+" + row.rounds + " rounds" };
    if (row.missiles) return { id: "ammo", label: "Rearm", hint: "+" + row.missiles + " missiles" };
    if (row.ordnance) return { id: "arm", label: "Arm", hint: "aircraft ordnance" };
    if (row.tag === "wearable" || row.tag === "clothing" || row.tag === "jewelry") {
      return { id: "wear", label: "Wear", hint: (row.slot || "fit") + (row.drip ? " · +" + row.drip + " drip" : "") };
    }
    if (row.dogfeed) return { id: "feed", label: "Feed", hint: "to an animal" };
    if (row.tag === "drug") return { id: "deal", label: "Deal", hint: "sell to a dealer" };
    if (row.value > 0) {
      const where = row.pelt ? "pawn / fence" : row.tag === "resource" ? "any counter" : "pawn shop";
      return { id: "sell", label: "Sell", hint: fmt$(pawnPrice(name)) + " at a " + where };
    }
    return null;
  }
  CBZ.itemVerb = verbOf;

  // the slot tooltip: name, count, what it IS, and what it is worth/does.
  CBZ.itemTip = function (name, row, count) {
    row = rowFor(name, row);
    const k = kindOf(name, row);
    const v = verbOf(name, row);
    let s = String(name) + (count > 1 ? "  x" + (count | 0) : "");
    const what = row && row.pristine ? "pristine hide"
      : k === "pelt" ? "pelt"
      : k === "meat" || k === "fillet" ? (row && row.wild ? "wild meat" : "meat")
      : k === "fish" ? "fresh catch"
      : (row && row.tag) || k;
    s += "\n" + what;
    if (v) s += "  ·  " + v.label + " — " + v.hint;
    return s;
  };

  // ============================================================
  //  7. USE — one dispatcher, and every branch is an EXISTING primitive.
  //  Nothing here writes hunger, hp, ammo or the wardrobe itself.
  // ============================================================
  CBZ.cityUseItem = function (name) {
    const E = CBZ.cityEcon; if (!E || !name) return false;
    const row = E.ITEMS && E.ITEMS[name];
    const v = verbOf(name, row);
    if (!v || !(E.count(name) > 0)) return false;
    const note = (m, s) => { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s || 1.6); };
    switch (v.id) {
      case "eat":
        return CBZ.cityEat ? !!CBZ.cityEat(name) : false;
      case "equip":
        if (CBZ.cityGiveWeapon) { CBZ.cityGiveWeapon(name); return true; }
        return false;
      case "throw":
        if (CBZ.cityThrowFromInventory) { CBZ.cityThrowFromInventory(); return true; }
        return false;
      case "heal": {
        const P = CBZ.player; if (!P) return false;
        if ((P.hp || 0) >= (P.maxHp || 100) && !P._bleeding) { note("Nothing to patch up."); return false; }
        if (!E.take(name, 1)) return false;
        P.hp = Math.min(P.maxHp || 100, (P.hp || 0) + (row.medkit || 40));
        if (CBZ.cityHealWounds) { try { CBZ.cityHealWounds(); } catch (e) {} }
        if (CBZ.sfx) CBZ.sfx("pickup");
        note("Patched up (+" + (row.medkit || 40) + " hp).");
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
        return true;
      }
      case "armor": {
        const P = CBZ.player; if (!P) return false;
        if ((P._armor || 0) >= 100) { note("Already plated up."); return false; }
        if (!E.take(name, 1)) return false;
        P._armor = Math.min(100, (P._armor || 0) + (row.armor || 60));
        if (CBZ.sfx) CBZ.sfx("equip");
        note("Vest on (+" + (row.armor || 60) + " armor).");
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
        return true;
      }
      case "ammo": {
        if (row.rounds && CBZ.cityAddAmmo) {
          if (!E.take(name, 1)) return false;
          CBZ.cityAddAmmo(row.rounds);
          if (CBZ.sfx) CBZ.sfx("reload");
          note("+" + row.rounds + " rounds.");
          return true;
        }
        note("Rearm at your aircraft.");
        return false;
      }
      case "wear":
        if (CBZ.cityWear) { try { CBZ.cityWear(name); return true; } catch (e) {} }
        if (E.equip && E.equip(name)) { note("Wearing " + name + "."); return true; }
        return false;
      case "place":
        if (CBZ.cityInventory && CBZ.cityInventory.placeChest) return !!CBZ.cityInventory.placeChest({});
        return false;
      case "feed":
        note("Offer it to an animal — walk up and use it there.");
        return false;
      case "deal":
        note("Sell " + name + " to a dealer — not for using.", 1.4);
        return false;
      case "sell":
        note(name + " fences for " + fmt$(pawnPrice(name)) + " — take it to a pawn shop.", 2);
        return false;
      default: return false;
    }
  };

  // ============================================================
  //  8. CSS — one style block, self-mounted, shared by every consumer.
  // ============================================================
  CBZ.itemIconCss = function () {
    if (typeof document === "undefined" || !document.head || document.getElementById("itemIcnCss")) return;
    const st = document.createElement("style");
    st.id = "itemIcnCss";
    st.textContent =
      ".itemIcn{display:block;image-rendering:pixelated;image-rendering:crisp-edges;pointer-events:none;" +
      "width:30px;height:30px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.7))}" +
      ".itemIcn.lg{width:34px;height:34px}" +
      ".itemIcn.md{width:28px;height:28px}" +
      ".itemIcn.sm{width:22px;height:22px}" +
      ".itemIcn.xs{width:18px;height:18px}" +
      ".itemIcn.gunFace{image-rendering:auto;width:42px;height:28px;object-fit:contain}" +
      ".itemIcn.gunFace.sm{width:34px;height:22px}" +
      ".itemIcn.rar-pristine{filter:drop-shadow(0 0 3px rgba(180,226,255,.85)) drop-shadow(0 1px 1px rgba(0,0,0,.6))}" +
      ".itemIcn.rar-legend{filter:drop-shadow(0 0 4px rgba(255,196,74,.95)) drop-shadow(0 1px 1px rgba(0,0,0,.6))}" +
      // the two drag-cursor ghosts are fixed-size boxes that used to hold an
      // inline glyph; a block <img> needs centring inside them.
      "#invCursor .itemIcn{margin:11px auto}#ci2Cursor .itemIcn{margin:0 auto}";
    document.head.appendChild(st);
  };
  if (typeof document !== "undefined" && document.head) CBZ.itemIconCss();

  // ============================================================
  //  9. RATCHETS — `generic` is the count of catalog rows that still fall to
  //  the parcel, i.e. items the game cannot say anything about. It is
  //  STRUCTURALLY 0 while every row carries a tag; `inert` is the stat-fiction
  //  count (an item you own that answers to no verb at all). Both may only
  //  ever go DOWN. `items`/`iconed`/`verbed` print beside them so a "fix"
  //  that just registers fewer items cannot pass.
  // ============================================================
  CBZ.itemIconAudit = function () {
    const IT = (CBZ.cityEcon && CBZ.cityEcon.ITEMS) || {};
    let items = 0, iconed = 0, generic = 0;
    const kinds = {}, genericNames = [];
    for (const n in IT) {
      items++;
      const k = kindOf(n, IT[n]);
      kinds[k] = (kinds[k] | 0) + 1;
      if (k === GENERIC) { generic++; if (genericNames.length < 20) genericNames.push(n); }
      else iconed++;
    }
    return { items, iconed, generic, genericNames, kinds, sprites: Object.keys(ART).length, baked: Object.keys(cache).length };
  };
  CBZ.itemVerbAudit = function () {
    const IT = (CBZ.cityEcon && CBZ.cityEcon.ITEMS) || {};
    let items = 0, verbed = 0, inert = 0, sellOnly = 0;
    const verbs = {}, inertNames = [];
    for (const n in IT) {
      items++;
      const v = verbOf(n, IT[n]);
      if (v) {
        verbed++;
        verbs[v.id] = (verbs[v.id] | 0) + 1;
        // "sell" is a REAL verb (a pelt's whole point is the fence) but it is
        // the WEAKEST one: an item whose only answer is "a shop gives you money
        // for it" is the closest this catalog gets to inert. Tracked separately
        // so growing the loot table can never hide a genuinely dead item.
        if (v.id === "sell") sellOnly++;
      } else { inert++; if (inertNames.length < 20) inertNames.push(n); }
    }
    return { items, verbed, inert, inertNames, sellOnly, verbs };
  };
})();
