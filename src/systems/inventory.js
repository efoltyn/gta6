/* ============================================================
   systems/inventory.js — a Minecraft-style inventory.

   • An always-visible HOTBAR at the bottom. In Prison Escape [1] is always
     fists and [2]..[0] select the rearrangeable firearm rail; tapping/clicking
     an item slot still quick-USES a consumable.
   • Press [I] to open the full STASH: a 27-slot grid above the hotbar.
     Not in every mode — see stashMode(): city has its own bag, and survival
     has no inventory at all, so I belongs to its interaction card there.
     Left-click picks up a stack onto the cursor, click again to place/
     swap/merge (classic Minecraft). Right-click USES a consumable.
   • Items mirror the economy inventory (CBZ.game.inventory is the count
     truth); slots are a re-orderable view that re-syncs whenever items
     are gained or used. New pickups land on the hotbar first.

   Consumables do something: Ramen / Energy Bar shake off stuns and cut
   heat, hooch/pills/powder cool you down. Gun / Shiv / keys just sit in
   the bag (the gun is "held" automatically by first-person mode).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const N_MAIN = 27, N_HOT = 9, N = N_MAIN + N_HOT; // 0..26 main, 27..35 hotbar
  const STACK = 64;

  /* ============================================================
     THE ICON LAYER — a slot shows the THING, not its name.

     OWNER: "the icon of gun for loadout and inventory — look how gang city
     shows the gun, just use that exact code" / "keep your game and gang city
     as overlapped as possible … ditching yours".

     So this bag resolves a face exactly the way city/inventory.js does, in
     the same order, with the same fallback ladder:

       weaponFace(id) -> CBZ.weaponThumbnail(id)   an offscreen orthographic
         render of CBZ.buildActorWeapon(id), cached as one data URL per
         weapon (city/weapon_thumbnails.js, loaded at index.html:440 — before
         this file at :514). The gun in the slot is the SAME MESH that is in
         the player's hands. Never re-drawn here.
       iconFor(name) -> ICON / TAG_ICON / GENERIC   for everything else.

     The one thing that is NOT copied is the glyph VALUE. city/inventory.js's
     ICON/TAG_ICON tables are husks — the emoji purge (ea61ace) emptied every
     entry, which is why every non-gun item in both bags renders the "▪"
     square. Refilling them with emoji would just undo that purge. So the
     values here are keys into ART below: small stroked SVG pictograms drawn
     in-file. That is the style weapon_thumbnails set — a DRAWN THING, not a
     letter — and it is what stays crisp on an iPad at any DPR.

     Flag CBZ.CONFIG.PRISON_ITEM_ICONS=false reverts the whole layer to the
     "▪" square, which is byte-identical to what shipped (every legacy glyph
     was "" and fell through to that square).
  ============================================================ */
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PRISON_ITEM_ICONS == null) CBZ.CONFIG.PRISON_ITEM_ICONS = true;
  function iconsOn() { return CBZ.CONFIG.PRISON_ITEM_ICONS !== false; }

  /* ---- ONE BAR (JAIL_HUD_UNIFIED) -----------------------------------------
     OWNER: "unite all these inventory into one, and clean the hud up." The
     jail screen reported "what am I carrying" three ways at once: this bag's
     hotbar (where a warden-loot "Gun" proxy shows exactly one gun), fpsmode's
     floating #weaponStrip chip row bottom-right (every gun), and the #keycard
     chip top-right (one specific key).

     The unify move is a DOCK, not a fourth renderer: fpsmode.js keeps drawing
     #weaponStrip through CBZ.weaponSlotsHTML — the ONE weapon renderer
     (city/hud.js; weaponStripAudit().renderers stays pinned at 1) — and this
     bag adopts the element as its leftmost cells, so guns and items read as a
     single bar. css/inventory.css sheds the strip's floating-panel skin and
     re-cuts its chips to this bag's islot cell off body.jail-hud-unified.
     Digits then span the bar left to right: 1..N equip the docked guns (they
     carry the printed numbers), the rest select item slots. The keycard
     becomes a real "Keycard" bag item (systems/interactions.js grants it; the
     ICON table below already draws a card) and the chip is css-hidden —
     game.hasKey stays the door/AI truth either way.

     Survival never docks (mode-survival hides this hotbar, so the strip must
     keep floating) and the city never shows the strip at all (its own #cSlots
     bar). Flag false = class off + no dock + no item grant: all three
     surfaces exactly as they shipped. ------------------------------------ */
  if (CBZ.CONFIG.JAIL_HUD_UNIFIED == null) CBZ.CONFIG.JAIL_HUD_UNIFIED = true;
  function unifiedOn() { return CBZ.CONFIG.JAIL_HUD_UNIFIED !== false; }

  function itemMeta(name) { const IT = CBZ.econ && CBZ.econ.ITEMS; return (IT && IT[name]) || null; }
  function itemTag(name) { const it = itemMeta(name); return (it && it.tag) || null; }

  // ---- ART: 24x24 inner SVG markup. Stroke geometry (fill:none, stroke:
  //      currentColor) unless a shape sets fill explicitly, so one CSS rule
  //      sizes/colours the whole set and the drawing costs no image decode.
  //      Craft rules, same as fullmap's mapIcon: silhouette over detail, one
  //      idea per glyph, never colour alone, one optical weight, centred on
  //      the 24-box. ADDING AN ITEM IS A ROW HERE + A ROW IN ICON.
  const ART = {
    lighter: "<rect x='7' y='9.5' width='10' height='11.5' rx='2'/><path d='M9 9.5V7.5h6v2'/><path d='M12 2.5c2.1 2.3 3.1 3.8 3.1 5.2a3.1 3.1 0 0 1-6.2 0c0-1.4 1-2.9 3.1-5.2z' fill='currentColor' stroke='none'/>",
    soap: "<rect x='2.5' y='11' width='14' height='8.5' rx='3.2'/><path d='M6 15h7'/><circle cx='19' cy='6.5' r='2.2'/><circle cx='14.6' cy='4' r='1.2'/>",
    razor: "<rect x='2.5' y='7' width='19' height='10' rx='2'/><rect x='8' y='10.5' width='8' height='3' rx='1.5'/><path d='M2.5 9.6h19M2.5 14.4h19' opacity='.5'/>",
    charger: "<path d='M9 2.5v4M15 2.5v4'/><rect x='6.5' y='6.5' width='11' height='5' rx='1.6'/><path d='M12 11.5v2.5c0 3.2-2.2 5.5-5.4 5.5H3.5'/>",
    shiv: "<path d='M20.5 2.5l-8.2 11.2-2.1-2.1z' fill='currentColor' stroke='none'/><path d='M10.2 11.6l-6.7 7.2 1.9 1.9 7.2-6.7z'/><path d='M6.1 15.9l1.9 1.9M4.4 17.7l1.9 1.9'/>",
    knuckles: "<circle cx='5' cy='10' r='2.3'/><circle cx='9.7' cy='9.2' r='2.3'/><circle cx='14.4' cy='9.2' r='2.3'/><circle cx='19' cy='10' r='2.3'/><path d='M3.4 12.6c1.8 5.2 15.4 5.2 17.2 0'/>",
    bar: "<rect x='4' y='8' width='16' height='8' rx='1.6'/><path d='M4 9.5l-2.2-1.2M4 14.5l-2.2 1.2M20 9.5l2.2-1.2M20 14.5l2.2 1.2'/><path d='M8 12h8' opacity='.55'/>",
    can: "<rect x='7' y='3.5' width='10' height='17' rx='2.2'/><path d='M7 7.5h10'/><path d='M13.6 9.5l-3.4 4.6h2.6l-.8 3.6 3.4-4.8h-2.6z' fill='currentColor' stroke='none'/>",
    phone: "<rect x='7' y='2' width='10' height='20' rx='2.2'/><path d='M10 5.2h4'/><rect x='8.6' y='7.6' width='6.8' height='5' rx='1'/><circle cx='12' cy='18.4' r='1.1' fill='currentColor' stroke='none'/>",
    sim: "<path d='M5 3.5h9l5 5v12H5z'/><rect x='8.4' y='10.5' width='7.2' height='6.5' rx='1.2'/><path d='M8.4 13.7h7.2M12 10.5v6.5'/>",
    card: "<rect x='2.6' y='5' width='18.8' height='14' rx='2'/><path d='M2.6 9.2h18.8'/><circle cx='8' cy='14' r='1.7'/><path d='M12.4 13h6.2M12.4 15.4h4'/>",
    tattoo: "<path d='M15.4 2.6l6 6-7.4 7.4-6-6z'/><path d='M7.6 10.4L3 21.4l11-4.6'/><path d='M3 21.4l2.4-2.4'/>",
    cigs: "<path d='M4.5 8.5h15v11h-15z'/><path d='M5.6 8.5l1-3.5h10.8l1 3.5'/><path d='M4.5 12.6h15'/><path d='M9 12.6v6.9M14 12.6v6.9' opacity='.7'/>",
    ramen: "<path d='M5.2 8.5h13.6l-1.4 12.2H6.6z'/><path d='M4 8.5h16'/><path d='M9 5.4c0-1.5 1.5-1.7 1.5-3.2M13.4 5.4c0-1.5 1.5-1.7 1.5-3.2'/>",
    pills: "<path d='M4.6 13.4a4.2 4.2 0 0 1 6-6l4.4 4.4a4.2 4.2 0 0 1-6 6z'/><path d='M7.6 10.4l4.4 4.4'/><circle cx='17.6' cy='6.6' r='3.6'/><path d='M15.3 6.6h4.6'/>",
    powder: "<path d='M6.6 6.2h10.8l-1 13.6H7.6z'/><path d='M6.6 6.2l1-2.6h8.8l1 2.6'/><path d='M8 14.4h8l-.6 5.4H8.6z' fill='currentColor' stroke='none' opacity='.8'/>",
    hooch: "<path d='M10 2.6h4v3.2l3 4.2v10a1.4 1.4 0 0 1-1.4 1.4H8.4A1.4 1.4 0 0 1 7 20V10l3-4.2z'/><path d='M7 14.4h10'/>",
    painkillers: "<rect x='6' y='7' width='12' height='14' rx='2'/><rect x='8.2' y='3' width='7.6' height='4' rx='1.2'/><path d='M12 11.4v6M9 14.4h6'/>",
    lockpick: "<path d='M20.8 3.2l-9.6 9.6'/><path d='M20.8 3.2l-3-.6.6 3'/><circle cx='7.4' cy='16.6' r='3.4'/><path d='M9.8 14.2l1.4-1.4'/>",
    cuffkey: "<circle cx='12' cy='5.4' r='3'/><path d='M12 8.4v11'/><path d='M12 19.4h3.4M12 16h2.4'/>",
    rope: "<path d='M8.4 2.6c4 3-4 6.2 0 9.2s-4 6.2 0 9.2'/><path d='M14.6 2.6c4 3-4 6.2 0 9.2s-4 6.2 0 9.2'/>",
    hacksaw: "<rect x='2' y='8' width='20' height='4.2' rx='1'/><path d='M2 12.2l2 2 2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2 2-2'/><circle cx='4.6' cy='10.1' r='.9'/><circle cx='19.4' cy='10.1' r='.9'/>",
    map: "<path d='M3 6.2l6-2.4 6 2.4 6-2.4v14l-6 2.4-6-2.4-6 2.4z'/><path d='M9 3.8v14M15 6.2v14'/><path d='M10.9 10.4l2.2 2.2M13.1 10.4l-2.2 2.2'/>",
    wallet: "<rect x='2.6' y='5.6' width='18.8' height='12.8' rx='2.2'/><path d='M2.6 9.8h18.8'/><circle cx='17.2' cy='14.2' r='1.4'/>",
    cash: "<ellipse cx='6.2' cy='12' rx='3.2' ry='5.2'/><path d='M6.2 6.8h11.6a5.2 5.2 0 0 1 0 10.4H6.2'/><path d='M17.8 9.4a2.6 2.6 0 0 1 0 5.2'/>",
    tooth: "<path d='M6.4 3.6c3.2-1.8 8-1.8 11.2 0c2.2 1.6 1.2 5.2 0 8.4c-1.1 3-.9 8.4-3 8.4s-1.1-5.2-3.2-5.2s-1.1 5.2-3.2 5.2s-1.9-5.4-3-8.4c-1.2-3.2-2.2-6.8 0-8.4z'/><path d='M17.4 5.4l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z' fill='currentColor' stroke='none'/>",
    chain: "<ellipse cx='5.6' cy='12' rx='3.4' ry='2.5'/><ellipse cx='12' cy='12' rx='3.4' ry='2.5'/><ellipse cx='18.4' cy='12' rx='3.4' ry='2.5'/>",
    watch: "<circle cx='12' cy='12' r='5.4'/><path d='M12 9.2V12l2 1.4'/><path d='M9.2 7.2L9.7 2.8h4.6l.5 4.4M9.2 16.8l.5 4.4h4.6l.5-4.4'/>",
    key: "<circle cx='7.4' cy='7.4' r='4'/><circle cx='7.4' cy='7.4' r='1.3' fill='currentColor' stroke='none'/><path d='M10.3 10.3L20.4 20.4'/><path d='M15.6 15.6l2.2-2.2M18.2 18.2l1.7-1.7'/>",
    // the LAST-RESORT gun face: only drawn when weapon_thumbnails could not
    // produce a render (no GL context, model factory missing). A real gun in
    // this bag is always the mesh, never this.
    gun: "<path d='M2 6.8h18.4v5.2h-5.1l-1.5 3h-2.4l-1.4 6.2H5.2L6.8 12H2z' fill='currentColor' stroke='none'/>",
    // Same last-resort rule for the duty flashlight: normal play renders the
    // canonical 3D model; this only covers a failed/offscreen WebGL context.
    torch: "<path d='M3 9h11v6H3z'/><path d='M14 7l7-2v14l-7-2z'/><path d='M5.5 9V6.5h5V9'/><path d='M5.5 15v2.5h5V15'/>",
    // Last-resort demolition charge (same rule): body, three taped demo
    // sticks, the LED. Normal play renders the real brick via CBZ.c4Thumbnail.
    c4: "<rect x='3.4' y='11' width='17.2' height='7.6' rx='1.2'/><rect x='5.6' y='6.2' width='3.6' height='4.8' rx='.8'/><rect x='10.2' y='6.2' width='3.6' height='4.8' rx='.8'/><rect x='14.8' y='6.2' width='3.6' height='4.8' rx='.8'/><path d='M3.4 14.8h17.2' opacity='.5'/><circle cx='17.8' cy='16.4' r='1.1' fill='currentColor' stroke='none'/>",
    wood: "<rect x='2.6' y='8.6' width='18.8' height='6.8' rx='3.4'/><ellipse cx='5.4' cy='12' rx='1.7' ry='3.4'/><ellipse cx='5.4' cy='12' rx='.6' ry='1.3'/><path d='M12 8.6v6.8' opacity='.45'/>",
    stone: "<path d='M3.6 15.6l3.2-8.2 6.2-3 7.4 5.2-2.2 8.4H6z'/><path d='M6.8 7.4l4.2 5.2 9-2.8M11 12.6l-1 5.4'/>",
    scrap: "<path d='M3.6 6.2l6 2.2 4-4.2 6.4 3-2 6.2 3 5.4-8.2-1-5.2 3.2-2.2-6.2z'/>",
    hatchet: "<path d='M3.2 21l9.6-9.6'/><path d='M11.2 9.4l3-4.6c3.6.4 6.4 3 6.4 6.2s-2.6 5.2-5.2 5.2l-4.2-3z'/>",
    pickaxe: "<path d='M14.6 6L4.2 20.4'/><path d='M5.6 9.4a11.4 11.4 0 0 1 15.2-1'/>",
    crate: "<rect x='2.8' y='5.8' width='18.4' height='13.4' rx='1.4'/><path d='M2.8 10h18.4'/><path d='M2.8 6.4l18.4 12.2M21.2 6.4L2.8 18.6' opacity='.4'/>",
    toolbox: "<rect x='2.8' y='8.8' width='18.4' height='10.6' rx='1.6'/><path d='M8 8.8V6.2h8v2.6'/><path d='M2.8 13h18.4'/><path d='M10.4 11.6h3.2v3h-3.2z' fill='currentColor' stroke='none'/>",
    gem: "<path d='M6.4 3.2h11.2l4 6-9.6 11.6L2.4 9.2z'/><path d='M2.4 9.2h19.2M8.6 9.2l3.4 11.6M15.4 9.2L12 20.8M6.4 3.2l2.2 6M17.6 3.2l-2.2 6'/>",
    cube: "<path d='M12 2.4l8.8 4.8v9.6L12 21.6l-8.8-4.8V7.2z'/><path d='M12 12l8.8-4.8M12 12v9.6M12 12L3.2 7.2'/>",
    dot: "<rect x='7' y='7' width='10' height='10' rx='2.2'/>",
  };

  // name -> ART key. Same table SHAPE as city/inventory.js's ICON so the two
  // bags stay one grammar; the whole systems/economy.js catalog is covered.
  const ICON = {
    // --- goods ---
    "Lighter": "lighter", "Soap": "soap", "Razor Blade": "razor",
    "Phone Charger": "charger", "Shiv": "shiv", "Brass Knuckles": "knuckles",
    "Energy Bar": "bar", "Energy Drink": "can", "Burner Phone": "phone",
    "Burner SIM": "sim", "Tattoo Gun": "tattoo", "Cigarette Carton": "cigs",
    "Ramen": "ramen",
    // --- drugs ---
    "Pills": "pills", "Powder": "powder", "Pruno Hooch": "hooch", "Painkillers": "painkillers",
    // --- tools ---
    "Lockpick": "lockpick", "Handcuff Key": "cuffkey", "Bedsheet Rope": "rope",
    "Hacksaw Blade": "hacksaw", "Contraband Map": "map",
    // --- valuables ---
    "Stolen Wallet": "wallet", "Cash Roll": "cash", "Gold Tooth": "tooth",
    "Gold Chain": "chain", "Luxury Watch": "watch",
    // --- keys / weapon (Gun renders as the MESH; this is its fallback) ---
    "Gun-Room Key": "key", "Gun": "gun", "Guard Torch": "torch", "C4 Charge": "c4",
    // B7: resource/tool catalog parity (systems/economy.js) — see city/hud.js
    // + city/charpanel.js for the city-mode equivalents.
    "Wood": "wood", "Stone": "stone", "Scrap": "scrap", "Hatchet": "hatchet", "Pickaxe": "pickaxe",
    // names other modes can hand this bag; free to keep, never in the catalog
    "Keycard": "card", "Medkit": "painkillers", "Chest": "crate",
  };
  // tag fallback, then the "nobody drew this one" square — city's ladder.
  const TAG_ICON = { goods: "crate", drugs: "pills", tools: "toolbox", valuables: "gem", key: "key", resource: "cube" };
  const GENERIC = "dot";
  function iconGlyph(name) { return ICON[name] || TAG_ICON[itemTag(name)] || ""; }
  function iconFor(name) { return iconGlyph(name) || GENERIC; }

  /* ---- THE GUN FACE ------------------------------------------------------
     GUN_ID is an ALLOWLIST and must stay one. actorweapons.js's
     normalizeWeaponId() answers "sidearm" for ANY string it does not know, so
     a blind CBZ.weaponThumbnail(itemName) would paint a 9mm on the Shiv, the
     Hacksaw Blade and the Tattoo Gun. Only a name in this table may reach the
     thumbnail; everything else takes the drawn glyph. "Tattoo Gun" is
     deliberately absent.
     "@held" = the prison's legacy "Gun" item, which weapon-data.js keeps in
     sync with CBZ.weaponInventory (syncLegacyGunItem). It is not a pistol —
     it is whatever came off the armory rack, so it renders the weapon the
     player actually has out.

     THE SHIV JOINS THE TABLE, and the reason it may is the reason it could
     not before. This comment used to name the Shiv as the exact thing the
     allowlist existed to keep a 9 mm off — because normalizeWeaponId() had no
     row for it and answered "sidearm". It now HAS a row
     (actorweapons.js NAME_TO_ID → "shank", weapons/appearances/shank.js), so
     the thumbnail of a shiv is a photograph of a shiv. The allowlist is doing
     its job either way: it is a list of names with a REAL MODEL BEHIND THEM,
     and the fix was to give this one a model, not to widen the gate. "Hacksaw
     Blade" and "Tattoo Gun" stay absent for precisely that reason — nothing
     has drawn them yet. ------------------------------------------------- */
  const GUN_ID = {
    "Gun": "@held",
    "Pistol": "sidearm", "Sidearm": "sidearm", "Revolver": "revolver", "Desert Eagle": "deagle",
    "SMG": "smg", "Uzi": "uzi", "Shotgun": "shotgun", "Rifle": "carbine", "Carbine": "carbine",
    "AK-47": "ak47", "Sniper": "sniper", "LMG": "lmg", "Taser": "taser",
    "Bazooka": "bazooka", "Rocket Launcher": "bazooka", "Grenade Launcher": "glauncher",
    "Shiv": "shank", "Shank": "shank",
  };
  function heldWeaponId() {
    const inv = CBZ.weaponInventory || [];
    const cur = CBZ.currentWeaponId;
    if (cur && inv.indexOf(cur) >= 0) return cur;
    return inv.length ? inv[0] : "sidearm";
  }
  function gunIdFor(name) {
    const gid = GUN_ID[name];
    if (!gid) return null;
    /* The shiv's row leaves with its flag. PRISON_SHANK=0 sends
       normalizeWeaponId back to answering "sidearm" for a blade name, so
       letting this entry through on the off-side would hand the thumbnail
       rig a pistol and paint a 9 mm on the Shiv — the precise failure the
       allowlist above was written to prevent, reintroduced by the revert
       rather than by the feature. Off-side, it falls to the drawn glyph,
       which is what this bag actually shipped. */
    if (gid === "shank" && CBZ.CONFIG && CBZ.CONFIG.PRISON_SHANK === false) return null;
    return gid === "@held" ? heldWeaponId() : gid;
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function svgFace(name) {
    const t = itemTag(name);
    const cls = t && /^[a-z]+$/.test(t) ? " t-" + t : "";
    return "<span class='islot-ic'><svg class='islot-svg" + cls + "' viewBox='0 0 24 24' aria-hidden='true'>" +
      (ART[iconFor(name)] || ART[GENERIC]) + "</svg></span>";
  }
  // city/inventory.js:125 weaponFace(), same try/catch and same ladder — the
  // only differences are the class names (this bag's own CSS) and the
  // allowlist above standing in front of the id.
  // Only the GLYPH markup is memoised. The weapon <img> is rebuilt from
  // weapon_thumbnails' own cached data URL every time — caching the tag here
  // would hold a second copy of every ~20 KB PNG string for a saving of one
  // concatenation, and at most three cells in this whole bag carry a gun.
  const faceMemo = Object.create(null);
  function faceHtml(name) {
    if (name === "Guard Torch") {
      let src = "";
      try { if (CBZ.flashlightThumbnail) src = CBZ.flashlightThumbnail(); } catch (e) { src = ""; }
      // This is the same model factory used by the guard hand and death drop.
      // If the thumbnail GL context is unavailable, fall through to ART.torch;
      // a torch must still never masquerade as the generic unknown-item dot.
      if (src) return "<img class='islot-img' src='" + src + "' alt=''>";
    }
    if (name === "C4 Charge") {
      // THE SAME PHOTOGRAPH THE CITY BAG SHOWS: city/itemicons.js classifies
      // the c4 row (registered by explosives.js) as kind "bomb" and shoots
      // the real demolition-charge asset under the icon rig's lamps. A
      // weapon_thumbnails side-shot of the planted mesh was tried first and
      // washed out at slot size (MEASURED — pale slab, no silhouette); the
      // icon rig exists for exactly this, and borrowing it keeps one C4 face
      // across both bags. GL miss falls through to ART.c4, never the dot.
      let src = "";
      try {
        if (CBZ.itemIcon) src = CBZ.itemIcon(name, (CBZ.cityEcon && CBZ.cityEcon.ITEMS && CBZ.cityEcon.ITEMS[name]) || { c4: true, tag: "throwable" });
      } catch (e) { src = ""; }
      if (src) return "<img class='islot-img' src='" + src + "' alt=''>";
    }
    const gid = gunIdFor(name);
    if (gid) {
      let src = "";
      try { if (CBZ.weaponThumbnail) src = CBZ.weaponThumbnail(gid); } catch (e) { src = ""; }
      // a miss falls through to the drawn glyph and is NOT remembered: the GL
      // context / model factory can arrive later in the boot, and the next
      // repaint should then get the real render.
      if (src) return "<img class='islot-img' src='" + src + "' alt=''>";
    }
    return faceMemo[name] || (faceMemo[name] = svgFace(name));
  }
  // the hover/press label. A gun says WHICH gun, because "Gun" is a legacy
  // catalog name and the rack has five.
  function labelFor(name) {
    const gid = gunIdFor(name);
    if (gid && CBZ.weaponById) {
      let w = null;
      try { w = CBZ.weaponById(gid); } catch (e) { w = null; }
      const lb = w && w.label;
      if (lb && String(lb).toUpperCase() !== String(name).toUpperCase()) return name + " · " + lb;
    }
    return name;
  }

  // Read-only lookup so the shared census (CBZ.itemIconAudit, city/inventory.js)
  // can see this bag's table too. "" means the item falls through to GENERIC —
  // which is what the whole catalog answered before this layer, and what it
  // answers again with PRISON_ITEM_ICONS off.
  CBZ.escapeBagIcon = function (name) { return iconsOn() ? iconGlyph(name) : ""; };

  /* ---- RATCHET ------------------------------------------------------------
     CBZ.escapeIconAudit() — the escape bag's half of the icon census, counted
     against the REAL resolution path this file renders with (allowlist ->
     weaponThumbnail, else ICON/TAG_ICON). `generic` may only ever go DOWN;
     `items`/`withIcon` print beside it so a "fix" that shrinks the catalog
     cannot pass. Pass {noRender:true} to answer from the presence of the
     thumbnail API instead of taking the GL round-trip.
     BY CONSTRUCTION generic is 0 for the shipped catalog: every one of the 34
     systems/economy.js entries has an ICON row, and the six tags each have a
     TAG_ICON row, so a runtime-registered item still lands on a drawn glyph.
     NOT MEASURED IN A BROWSER BY ITS AUTHOR — whoever runs it first writes the
     number into CLAUDE.md rather than pinning this note. -------------------- */
  CBZ.escapeIconAudit = function (opts) {
    const noRender = !!(opts && opts.noRender);
    const IT = (CBZ.econ && CBZ.econ.ITEMS) || {};
    const out = { on: iconsOn(), items: 0, withIcon: 0, generic: 0, genericNames: [], models: 0, guns: 0, glyphs: 0, byTag: {} };
    for (const n in IT) {
      if (!Object.prototype.hasOwnProperty.call(IT, n)) continue;
      out.items++;
      let kind = "";
      if (iconsOn()) {
        if (n === "Guard Torch") {
          if (noRender) { if (CBZ.flashlightThumbnail) kind = "model"; }
          else {
            let src = "";
            try { if (CBZ.flashlightThumbnail) src = CBZ.flashlightThumbnail(); } catch (e) { src = ""; }
            if (src) kind = "model";
          }
        }
        const gid = gunIdFor(n);
        if (!kind && gid) {
          if (noRender) { if (CBZ.weaponThumbnail) kind = "gun"; }
          else {
            let src = "";
            try { if (CBZ.weaponThumbnail) src = CBZ.weaponThumbnail(gid); } catch (e) { src = ""; }
            if (src) kind = "gun";
          }
        }
        if (!kind && iconGlyph(n)) kind = "glyph";
      }
      if (kind === "model") { out.withIcon++; out.models++; continue; }
      if (kind === "gun") { out.withIcon++; out.guns++; continue; }
      if (kind === "glyph") { out.withIcon++; out.glyphs++; continue; }
      out.generic++; out.genericNames.push(n);
      const t = itemTag(n) || "untagged";
      out.byTag[t] = (out.byTag[t] || 0) + 1;
    }
    out.genericNames.sort();
    return out;
  };

  // items you can FENCE for their cigarette value straight from the bag
  const FENCEABLE = new Set(["Cash Roll", "Cigarette Carton", "Stolen Wallet", "Gold Tooth", "Gold Chain", "Luxury Watch"]);
  const CONSUMABLE = new Set([
    "Energy Bar", "Ramen", "Pruno Hooch", "Pills", "Powder",
    "Painkillers", "Energy Drink", "Cash Roll", "Cigarette Carton",
    "Stolen Wallet", "Gold Tooth", "Gold Chain", "Luxury Watch",
  ]);

  const slots = [];
  for (let i = 0; i < N; i++) slots.push({ item: null, count: 0 });
  let cursor = null;          // {item,count} held by the pointer
  let selIdx = 0;             // selected hotbar slot 0..8
  let invOpen = false;
  let ptr = { x: innerWidth / 2, y: innerHeight - 120 };

  // ---------- DOM ----------
  const bar = document.createElement("div"); bar.id = "hotbar";
  const screen = document.createElement("div"); screen.id = "invScreen";
  const cursorEl = document.createElement("div"); cursorEl.id = "invCursor";
  const barCells = [], mainCells = [], hbCells = [];

  function mkCell(arr, idx) {
    const c = document.createElement("div"); c.className = "islot"; c.dataset.slot = idx;
    arr.push(c); return c;
  }
  // always-visible hotbar mirrors slots 27..35
  for (let i = 0; i < N_HOT; i++) bar.appendChild(mkCell(barCells, N_MAIN + i));

  // full stash overlay
  const panel = document.createElement("div"); panel.className = "card-box invPanel";
  panel.innerHTML = '<div class="invTitle">STASH</div>';
  const loadout = document.createElement("div"); loadout.className = "invLoadout";
  loadout.innerHTML = '<div class="invLoadoutTitle">WEAPON KEYS <span>1 is always fists · tap two slots or drag to swap</span></div>' +
    '<div class="invLoadoutSlots"></div><div class="invReserve"></div>';
  const grid = document.createElement("div"); grid.className = "invGrid";
  for (let i = 0; i < N_MAIN; i++) grid.appendChild(mkCell(mainCells, i));
  const hbRow = document.createElement("div"); hbRow.className = "invGrid invHot";
  for (let i = 0; i < N_HOT; i++) hbRow.appendChild(mkCell(hbCells, N_MAIN + i));
  const hint = document.createElement("div"); hint.className = "invHint";
  hint.textContent = "Left-click move · Right-click use/fence · I or Esc to close";
  panel.appendChild(loadout); panel.appendChild(grid); panel.appendChild(hbRow); panel.appendChild(hint);
  screen.appendChild(panel);

  document.body.appendChild(bar);
  document.body.appendChild(screen);
  document.body.appendChild(cursorEl);

  // ---- the docked weapon strip (see ONE BAR above) ----
  const hudRoot = document.getElementById("hud");
  const stripEl = document.getElementById("weaponStrip");
  function stripDocked() { return !!(stripEl && stripEl.parentNode === bar); }
  function dockWeaponStrip() {
    const on = unifiedOn();
    if (document.body) document.body.classList.toggle("jail-hud-unified", on);
    if (!stripEl || !hudRoot) return;
    // GUN GAME DOCKS TOO (owner: "gun game still shows 2 places of gun
    // inventory — one on the right bottom of screen needs to go"). It is the
    // same fault this flag was written for: the floating strip bottom-right
    // plus a second bar bottom-centre. Gun game carries no contraband, so
    // css/screens.css hides the nine item cells and the BAG under
    // body.mode-gungame and the docked chip is the whole bar.
    // Survival still never docks (mode-survival hides the hotbar outright, so
    // the strip has to keep floating there or the weapon readout vanishes).
    const m = CBZ.game && CBZ.game.mode;
    const wantDock = on && (m === "escape" || m === "gungame");
    if (wantDock) { if (stripEl.parentNode !== bar) bar.insertBefore(stripEl, bar.firstChild); }
    else if (stripEl.parentNode !== hudRoot) hudRoot.appendChild(stripEl);
  }
  // a docked gun chip is a hotbar cell: click/tap = equip its declared prison
  // slot. Slot 1 never looks up a gun — it always asks the shared holster gate
  // for fists. Non-prison modes keep the old acquisition-order fallback.
  if (stripEl) stripEl.addEventListener("mousedown", function (e) {
    if (!stripDocked()) return;
    const c = e.target.closest && e.target.closest(".cSlot"); if (!c) return;
    e.preventDefault(); e.stopPropagation();
    const ps = c.dataset.prisonSlot;
    if (ps != null) {
      if (+ps < 0) { if (CBZ.playerHolster) CBZ.playerHolster(true); return; }
      const id = c.dataset.weaponId;
      if (id && CBZ.fpsSelectWeaponId) CBZ.fpsSelectWeaponId(id);
      return;
    }
    const cells = stripEl.querySelectorAll(".cSlot");
    const winv = CBZ.weaponInventory || [];
    const i = Array.prototype.indexOf.call(cells, c) - (cells.length - winv.length);
    if (i >= 0 && winv[i] && CBZ.fpsSelectWeaponId) CBZ.fpsSelectWeaponId(winv[i]);
  });
  // how many digit keys the docked guns claim ahead of the item slots
  function dockedGunKeys() {
    if (!stripDocked() || stripEl.style.display === "none") return 0;
    return (CBZ.weaponInventory || []).length;
  }

  // ---------- prison firearm loadout (fixed 1 + rearrangeable 2..0) -------
  const loadoutSlotsEl = loadout.querySelector(".invLoadoutSlots");
  const reserveEl = loadout.querySelector(".invReserve");
  let loadoutPick = null; // {kind:"slot",slot,id} | {kind:"reserve",id}

  function weaponThumb(id) {
    let src = "";
    try { if (CBZ.weaponThumbnail) src = CBZ.weaponThumbnail(id); } catch (_) { src = ""; }
    return src
      ? "<img class='gunModel' src='" + src + "' alt=''>"
      : "<span class='s'>GUN</span>";
  }

  function renderLoadout() {
    if (!loadoutSlotsEl || !reserveEl) return;
    const prison = CBZ.game && CBZ.game.mode === "escape";
    loadout.style.display = prison ? "block" : "none";
    if (!prison) { loadoutPick = null; return; }
    loadoutSlotsEl.innerHTML = typeof CBZ.weaponSlotsHTML === "function"
      ? CBZ.weaponSlotsHTML({ icons: true, prisonLoadout: true }) : "";
    const unslotted = CBZ.prisonUnslottedWeapons ? CBZ.prisonUnslottedWeapons() : [];
    reserveEl.innerHTML = unslotted.length
      ? "<span class='invReserveLabel'>UNASSIGNED</span>" + unslotted.map((id) => {
        const w = CBZ.weaponById && CBZ.weaponById(id);
        return "<div class='invReserveGun' draggable='true' data-weapon-id='" + esc(id) +
          "' title='" + esc((w && w.label) || id) + "'>" + weaponThumb(id) + "</div>";
      }).join("")
      : "";
    if (loadoutPick) {
      const selector = loadoutPick.kind === "slot"
        ? ".cSlot[data-prison-slot='" + loadoutPick.slot + "']"
        : ".invReserveGun[data-weapon-id='" + loadoutPick.id + "']";
      const picked = loadout.querySelector(selector);
      if (picked) picked.classList.add("picked");
      else loadoutPick = null;
    }
  }

  function finishLoadoutDrop(slot, source) {
    if (!(slot >= 0) || slot >= 9 || !source) return;
    if (source.kind === "slot" && CBZ.swapPrisonWeaponSlots) CBZ.swapPrisonWeaponSlots(source.slot, slot);
    else if (source.id && CBZ.assignPrisonWeaponSlot) CBZ.assignPrisonWeaponSlot(slot, source.id);
    loadoutPick = null;
    renderLoadout();
  }

  loadout.addEventListener("click", function (e) {
    const fixed = e.target.closest && e.target.closest(".cSlot[data-prison-slot='-1']");
    if (fixed) { loadoutPick = null; renderLoadout(); return; }
    const cell = e.target.closest && e.target.closest(".cSlot[data-prison-slot]");
    const reserve = e.target.closest && e.target.closest(".invReserveGun");
    if (reserve) {
      const id = reserve.dataset.weaponId;
      loadoutPick = loadoutPick && loadoutPick.kind === "reserve" && loadoutPick.id === id
        ? null : { kind: "reserve", id };
      renderLoadout();
      return;
    }
    if (!cell) return;
    const slot = +cell.dataset.prisonSlot;
    if (slot < 0) return;
    if (loadoutPick) { finishLoadoutDrop(slot, loadoutPick); return; }
    if (cell.dataset.weaponId) {
      loadoutPick = { kind: "slot", slot, id: cell.dataset.weaponId };
      renderLoadout();
    }
  });
  loadout.addEventListener("dragstart", function (e) {
    const cell = e.target.closest && e.target.closest(".cSlot[data-prison-slot]");
    const reserve = e.target.closest && e.target.closest(".invReserveGun");
    const src = reserve ? { kind: "reserve", id: reserve.dataset.weaponId }
      : (cell && +cell.dataset.prisonSlot >= 0 && cell.dataset.weaponId
        ? { kind: "slot", slot: +cell.dataset.prisonSlot, id: cell.dataset.weaponId } : null);
    if (!src || !e.dataTransfer) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", JSON.stringify(src));
  });
  loadout.addEventListener("dragover", function (e) {
    const cell = e.target.closest && e.target.closest(".cSlot[data-prison-slot]");
    if (cell && +cell.dataset.prisonSlot >= 0) e.preventDefault();
  });
  loadout.addEventListener("drop", function (e) {
    const cell = e.target.closest && e.target.closest(".cSlot[data-prison-slot]");
    if (!cell || +cell.dataset.prisonSlot < 0 || !e.dataTransfer) return;
    e.preventDefault();
    let src = null;
    try { src = JSON.parse(e.dataTransfer.getData("text/plain")); } catch (_) {}
    finishLoadoutDrop(+cell.dataset.prisonSlot, src);
  });

  // ---------- touch access (merge seam, rides PRISON_TOUCH_PROMPTS) ----------
  // CBZ.toggleInventory existed with ZERO touch surfaces calling it — on an
  // iPad the 27-slot stash was unreachable. The BAG cell is a CHILD of the
  // hotbar so it inherits every show/hide the bar already has (mode gates,
  // mode-survival hide) with no JS sync; body.touch is the only extra gate
  // (css). The panel gets a real ✕ because Esc does not exist on glass.
  const touchUI = !(CBZ.CONFIG && CBZ.CONFIG.PRISON_TOUCH_PROMPTS === false);
  let bagBtn = null, invX = null;
  if (touchUI) {
    bagBtn = document.createElement("div"); bagBtn.id = "invBagBtn"; bagBtn.textContent = "BAG";
    bar.appendChild(bagBtn);
    bagBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); toggle(); });
    invX = document.createElement("div"); invX.className = "invClose"; invX.textContent = "✕";
    panel.appendChild(invX);
    invX.addEventListener("mousedown", (e) => { e.preventDefault(); close(); });
    // long-press on a stash cell = the right-click path (use/fence). Compat
    // mouse events fire at touchend on iOS, so a held press preventDefault()s
    // them away and fires slotClick(i, true) itself; a short tap changes
    // nothing and falls through to the existing mousedown pick/place.
    let lpEl = null, lpT = 0, lpX = 0, lpY = 0;
    screen.addEventListener("touchstart", (e) => {
      const c = e.target.closest && e.target.closest(".islot"); if (!c) return;
      lpEl = c; lpT = performance.now(); lpX = e.touches[0].clientX; lpY = e.touches[0].clientY;
    }, { passive: true });
    screen.addEventListener("touchmove", (e) => {
      if (!lpEl || !e.touches[0]) return;
      if (Math.hypot(e.touches[0].clientX - lpX, e.touches[0].clientY - lpY) > 12) lpEl = null;
    }, { passive: true });
    screen.addEventListener("touchend", (e) => {
      const c = lpEl; lpEl = null;
      if (!c || performance.now() - lpT < 450) return;
      e.preventDefault();
      slotClick(+c.dataset.slot, true);
    });
  }

  // ---------- sync slots <- game.inventory (count truth) ----------
  function firstFree() {
    for (let i = N_MAIN; i < N; i++) if (!slots[i].item) return slots[i]; // hotbar first
    for (let i = 0; i < N_MAIN; i++) if (!slots[i].item) return slots[i];
    return null;
  }
  function totalInSlots(name) {
    let c = 0;
    for (const s of slots) if (s.item === name) c += s.count;
    if (cursor && cursor.item === name) c += cursor.count;
    return c;
  }
  function resync() {
    const inv = (CBZ.game && CBZ.game.inventory) || {};
    for (const s of slots) if (s.item && !(inv[s.item] > 0)) { s.item = null; s.count = 0; }
    for (const name in inv) {
      const target = inv[name]; if (!(target > 0)) continue;
      let have = totalInSlots(name);
      if (have < target) {
        let s = null;
        for (const x of slots) if (x.item === name) { s = x; break; }
        if (!s) { s = firstFree(); if (s) { s.item = name; s.count = 0; } }
        if (s) s.count += (target - have);
      } else if (have > target) {
        let extra = have - target;
        for (const s of slots) { if (extra <= 0) break; if (s.item === name) { const d = Math.min(s.count, extra); s.count -= d; extra -= d; if (s.count <= 0) s.item = null; } }
      }
    }
    render();
  }

  // ---------- render ----------
  // legacy face: every glyph in the pre-icon table was "", so this square IS
  // what the whole catalog drew. Keeping it makes PRISON_ITEM_ICONS=false a
  // byte-identical revert rather than an approximation of one.
  const LEGACY_FACE = '<span class="islot-ic">▪</span>';
  function fill(cell, s) {
    cell.classList.remove("r-uncommon", "r-rare", "r-epic");
    if (s && s.item) {
      const n = s.item;
      const tally = s.count > 1 ? '<span class="islot-n">' + s.count + "</span>" : "";
      if (iconsOn()) {
        // the name is a hover/press strip, not the slot's content — a slot
        // shows the thing. (The native title tooltip would double it.)
        cell.innerHTML = faceHtml(n) + tally + "<span class='islot-lbl'>" + esc(labelFor(n)) + "</span>";
        cell.title = "";
      } else {
        cell.innerHTML = LEGACY_FACE + tally;
        cell.title = n;
      }
      const it = itemMeta(n);
      if (it && it.rarity && it.rarity !== "common") cell.classList.add("r-" + it.rarity);
    } else { cell.innerHTML = ""; cell.title = ""; }
  }
  function render() {
    // ONE cursor on the unified bar: while a docked gun chip carries the held
    // highlight, the item cells drop theirs — two orange boxes read as two
    // selections. The stash overlay's own hotbar row keeps its cursor (that
    // screen has no gun chips to disambiguate against).
    const gunHeld = stripDocked() && (CBZ.weaponInventory || []).length > 0 && !!CBZ.currentWeaponId;
    for (let i = 0; i < N_HOT; i++) {
      fill(barCells[i], slots[N_MAIN + i]);
      barCells[i].classList.toggle("sel", !gunHeld && i === selIdx);
      fill(hbCells[i], slots[N_MAIN + i]);
      hbCells[i].classList.toggle("sel", i === selIdx);
    }
    for (let i = 0; i < N_MAIN; i++) fill(mainCells[i], slots[i]);
    if (cursor) {
      // flex (was block) so the drawn icon / weapon render centres in the
      // 50px ghost the way it does in a real slot.
      cursorEl.style.display = "flex";
      cursorEl.innerHTML = (iconsOn() ? faceHtml(cursor.item) : LEGACY_FACE) +
        (cursor.count > 1 ? '<span class="islot-n">' + cursor.count + "</span>" : "");
      cursorEl.style.left = ptr.x + "px"; cursorEl.style.top = ptr.y + "px";
    } else cursorEl.style.display = "none";
    if (invOpen) renderLoadout();
  }

  // ---------- effects ----------
  function effect(name) {
    // X2: escape mode's hunger loop (survival/escape had none before) — the
    // snack items top up CBZ.player.hunger; a no-op for anything else/any
    // other mode (city owns its own food loop via cityEat).
    if (CBZ.hunger && CBZ.hunger.onConsume) CBZ.hunger.onConsume(name);
    if (FENCEABLE.has(name)) {
      const v = (CBZ.econ && CBZ.econ.ITEMS[name] && CBZ.econ.ITEMS[name].value) || 10;
      CBZ.econ && CBZ.econ.addCigs(v);
      CBZ.flashHint && CBZ.flashHint("Fenced " + name + " for " + v + "", 1.8);
      CBZ.sfx && CBZ.sfx("coin"); return;
    }
    if (name === "Painkillers") { CBZ.player.stun = 0; CBZ.player.hp = Math.min(100, (CBZ.player.hp || 100) + 35); CBZ.addHeat && CBZ.addHeat(-10); CBZ.flashHint && CBZ.flashHint("Patched up — no pain.", 1.6); CBZ.sfx && CBZ.sfx("coin"); return; }
    if (name === "Energy Drink") { CBZ.player.stun = 0; CBZ.player.stamina = 100; CBZ.addHeat && CBZ.addHeat(-8); CBZ.flashHint && CBZ.flashHint("Wired — wide awake.", 1.6); CBZ.sfx && CBZ.sfx("coin"); return; }
    if (name === "Ramen") { CBZ.player.stun = 0; CBZ.addHeat && CBZ.addHeat(-40); CBZ.flashHint && CBZ.flashHint("Slurp — calm and clear-headed.", 1.6); }
    else if (name === "Energy Bar") { CBZ.player.stun = 0; CBZ.addHeat && CBZ.addHeat(-25); CBZ.flashHint && CBZ.flashHint("Sugar rush — shake it off.", 1.6); }
    else if (name === "Pruno Hooch") { CBZ.addHeat && CBZ.addHeat(-20); CBZ.flashHint && CBZ.flashHint("Liquid courage.", 1.6); }
    else if (name === "Pills") { CBZ.addHeat && CBZ.addHeat(-15); CBZ.flashHint && CBZ.flashHint("Numb to it all.", 1.6); }
    else if (name === "Powder") { CBZ.addHeat && CBZ.addHeat(-15); CBZ.flashHint && CBZ.flashHint("Wired and jittery.", 1.6); }
    CBZ.sfx && CBZ.sfx("coin");
  }
  function useItem(name) {
    if (!name || !(CBZ.game.inventory[name] > 0)) return;
    if (!CONSUMABLE.has(name)) { CBZ.flashHint && CBZ.flashHint(name + " — equipped.", 1.0); return; }
    if (CBZ.econ && CBZ.econ.takeItem && CBZ.econ.takeItem(name)) { effect(name); resync(); }
  }

  // ---------- slot interaction ----------
  function slotClick(i, right) {
    const s = slots[i];
    if (right) { if (s.item) useItem(s.item); return; }
    if (!cursor) { if (s.item) { cursor = { item: s.item, count: s.count }; s.item = null; s.count = 0; } }
    else if (!s.item) { s.item = cursor.item; s.count = cursor.count; cursor = null; }
    else if (s.item === cursor.item) { s.count = Math.min(STACK, s.count + cursor.count); cursor = null; }
    else { const t = { item: s.item, count: s.count }; s.item = cursor.item; s.count = cursor.count; cursor = t; }
    render();
  }

  // click handlers (delegated)
  bar.addEventListener("mousedown", (e) => {
    const c = e.target.closest && e.target.closest(".islot"); if (!c) return;
    const i = +c.dataset.slot - N_MAIN; selIdx = i;
    if (!invOpen) useItem(slots[+c.dataset.slot].item);   // quick-use from hotbar
    render();
  });
  function gridDown(e) {
    const c = e.target.closest && e.target.closest(".islot"); if (!c) return;
    e.preventDefault();
    slotClick(+c.dataset.slot, e.button === 2);
  }
  screen.addEventListener("mousedown", gridDown);
  screen.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("mousemove", (e) => { if (invOpen) { ptr.x = e.clientX; ptr.y = e.clientY; if (cursor) render(); } });

  /* ---- WHO OWNS [I] --------------------------------------------------------
     OWNER, on the natural-disaster run: "i is inventory (which doesnt need to
     exist) and also an interaction option."  Both were true: this stash's only
     mode gate was `mode === "city"`, so in SURVIVAL one press of I toggled a
     27-slot bag *and* fired survival_interact.js's first slot (Grab / Throw) —
     two listeners, no stopImmediatePropagation, this one first because
     index.html loads it first. It also exitPointerLock()s, so the grab landed
     with the mouse already released.

     The bag is the one that doesn't belong. Survival has no inventory at all:
     nothing in modes/survival.js grants an item, css hides #hotbar and
     #inventory in this mode, and the doctrine line is "the WORLD is the
     inventory" — the disaster island's items are bodies and debris you carry
     with your hands. So the stash simply does not exist here, and I is left
     to the interaction card, matching how city spends it (interactions.js
     KEYS = e,i,j,k,l). Prison keeps the bag and keeps I; its own card still
     uses J/K/L/; (systems/interact.js), so that invariant is untouched. */
  function stashMode() {
    const m = CBZ.game && CBZ.game.mode;
    return m !== "city" && m !== "survival";
  }

  // ---------- open / close ----------
  function open() {
    if (invOpen || !stashMode()) return; invOpen = true; CBZ.invOpen = true;
    // touchMode latches after this module loads, so the hint is chosen per
    // open, not at build — the string must never name a key glass doesn't have.
    hint.textContent = CBZ.touchMode
      ? "Tap to move · hold to use or fence · ✕ closes"
      : "Left-click move · Right-click use/fence · I or Esc to close";
    screen.style.display = "flex";
    if (!CBZ.touchMode && document.exitPointerLock) document.exitPointerLock();
    resync();
  }
  function close() {
    if (!invOpen) return; invOpen = false; CBZ.invOpen = false;
    screen.style.display = "none";
    if (cursor) { cursor = null; resync(); }     // counts never changed; resync re-places it
    if (!CBZ.touchMode && CBZ.game.state === "playing" && CBZ.requestLock) CBZ.requestLock();
    render();
  }
  function toggle() { invOpen ? close() : open(); }
  CBZ.toggleInventory = toggle;
  CBZ.invOpen = false;

  // ---------- keys ----------
  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    // this stash is the ESCAPE-mode bag — city mode has its own inventory
    // (city/inventory.js on I) and uses B for the character front-view, so
    // reacting here in city would open an invisible panel that wedges
    // CBZ.invOpen and blocks every other city panel.
    if (CBZ.game && CBZ.game.mode === "city") return;
    const k = e.key.toLowerCase();
    // I is the invariant stash owner, including beside an NPC interaction;
    // that panel uses J/K/L/;. B remains a compatibility alias. In survival
    // (see stashMode above) the key is NOT ours — fall through without
    // preventDefault so survival_interact.js's Grab/Throw is the only thing
    // that answers it.
    if (k === "i" || k === "b") {
      if (!stashMode()) return;
      e.preventDefault();
      toggle();
      return;
    }
    if (k === "escape" && invOpen) { close(); return; }
    if (!invOpen) {
      // Prison's keymap is physical and invariant: 1 = fists, 2..0 = the nine
      // loadout cells rearranged in the I-screen. Consumables remain tappable;
      // they never steal one of the weapon digits.
      if (CBZ.game && CBZ.game.mode === "escape") {
        if (e.key === "1") { if (CBZ.playerHolster) CBZ.playerHolster(true); return; }
        const wi = "234567890".indexOf(e.key);
        if (wi >= 0) {
          const map = CBZ.prisonWeaponLoadout ? CBZ.prisonWeaponLoadout() : (CBZ.weaponInventory || []);
          if (map[wi] && CBZ.fpsSelectWeaponId) CBZ.fpsSelectWeaponId(map[wi]);
          return;
        }
      }
      // Other modes keep the legacy acquisition-order digit map.
      const n = "123456789".indexOf(e.key);
      if (n >= 0) {
        const guns = dockedGunKeys();
        if (n < guns) { CBZ.fpsSelectWeaponId && CBZ.fpsSelectWeaponId(CBZ.weaponInventory[n]); return; }
        if (n - guns < N_HOT) { selIdx = n - guns; render(); }
      }
    }
  });

  // mirror the grid to game.inventory after ANY change. Everything that
  // grants/consumes items (trade, steal, loot, use) routes through
  // CBZ.refreshInventory, so wrapping it keeps the hotbar + stash live.
  if (CBZ.econ) {
    const _add = CBZ.econ.addItem, _take = CBZ.econ.takeItem;
    if (_add) CBZ.econ.addItem = function (n, c) { _add(n, c); resync(); };
    if (_take) CBZ.econ.takeItem = function (n) { const r = _take(n); resync(); return r; };
  }
  const _refresh = CBZ.refreshInventory;
  CBZ.refreshInventory = function () { if (_refresh) _refresh(); resync(); };

  // hide hotbar / close stash on menus; reset selection on a new run
  let lastEl = 0, lastHeld = "", lastLoadout = "";
  CBZ.onAlways(97, function () {
    dockWeaponStrip();
    const playing = CBZ.game.state === "playing";
    bar.style.display = playing ? "flex" : "none";
    // a mode change can happen with the bag up (city/survival are entered from
    // a menu, not always through a state flip) — a stash left open in a mode
    // that has none wedges CBZ.invOpen and eats the pointer lock.
    if ((!playing || !stashMode()) && invOpen) close();
    const el = CBZ.game.elapsed || 0;
    if (el + 0.001 < lastEl) { selIdx = 0; cursor = null; resync(); } // new run
    lastEl = el;
    // The "Gun" slot draws the weapon that is actually out, so a rack pickup
    // or a Q/wheel swap has to repaint it. Nothing else notices a weapon
    // change (the item COUNT never moves), and wrapping
    // CBZ.onWeaponInventoryChanged would fight fpsmode.js for a single-owner
    // hook — one string compare a frame is cheaper and owns nothing.
    // The armed bit rides the same signature: render()'s one-cursor rule
    // (gunHeld) flips on the FIRST gun and on losing the last one, and
    // heldWeaponId alone can't see either edge (its empty-bag fallback answers
    // "sidearm" both before and after a sidearm pickup).
    const held = heldWeaponId() + ((CBZ.weaponInventory || []).length ? "|armed" : "");
    if (held !== lastHeld) { lastHeld = held; render(); }
    const mapped = CBZ.prisonWeaponLoadout ? CBZ.prisonWeaponLoadout().join(",") : "";
    const loadoutSig = mapped + "|" + (CBZ.prisonUnslottedWeapons ? CBZ.prisonUnslottedWeapons().join(",") : "");
    if (loadoutSig !== lastLoadout) { lastLoadout = loadoutSig; if (invOpen) renderLoadout(); }
  });

  /* ---- RATCHET: CBZ.jailHudAudit() — the ONE-BAR claim as numbers. In a
     unified escape run: docked=true, keycardChipHidden=true, and once the
     player holds the keycard, keycardItem === hasKey. stripCells counts what
     the docked row actually draws (0 while unarmed, when the strip hides). */
  CBZ.jailHudAudit = function () {
    return {
      on: unifiedOn(),
      docked: stripDocked(),
      stripCells: stripEl ? stripEl.querySelectorAll(".cSlot").length : 0,
      guns: (CBZ.weaponInventory || []).length,
      keycardChipHidden: !!(document.body && document.body.classList.contains("jail-hud-unified")),
      keycardItem: !!(CBZ.game && CBZ.game.inventory && CBZ.game.inventory["Keycard"] > 0),
      hasKey: !!(CBZ.game && CBZ.game.hasKey),
    };
  };

  /* ---- RATCHET: CBZ.stashAudit() — one line that answers "who owns I here?".
     In survival it must read owns=false / open=false forever: that is the whole
     fix, and a future mode gate that regresses it shows up as owns=true beside
     a card whose first slot is already I. */
  CBZ.stashAudit = function () {
    return {
      mode: CBZ.game && CBZ.game.mode,
      owns: stashMode(),                     // does [I] toggle this bag?
      open: invOpen,
      screen: screen.style.display !== "none",
      hotbar: bar.style.display !== "none",
    };
  };

  resync();
})();
