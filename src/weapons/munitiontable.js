/* ============================================================
   weapons/munitiontable.js — CBZ.munitionTable: EVERY MUNITION, ONCE.

   One row per real munition: calibre, mass, explosive fill, what it
   penetrates, how it is fuzed and guided, how fast and how far it goes. Every
   game reads it: NPC War's unit weapon rows name a row (`mun`), Gang City's
   ordnance bus (systems/impactbus.js), the charge law's reference charges
   (systems/breach.js), the bomber sticks (systems/ordnance.js) and the
   war room's payloads (city/arsenal_data.js) all resolve their numbers here.
   Nothing else may carry a copy of these numbers. A new munition is one row.

   It needs no THREE and no DOM (node tools load it as is), like
   weapons/ballistics.js, which keeps the small-arms cartridges and the
   rocket/grenade FLIGHT tables. This file is the warhead.

   ---------------------------------------------------------------------------
   A ROW
     name     what it is called
     cls      ke (a kinetic penetrator) | heat (shaped charge) | hedp (dual
              purpose) | he (HE-frag shell or warhead) | bomb (general purpose)
              | pen (a penetrating bomb / warhead, delay fuzed) | blast
              (thermobaric / massive blast) | frag | sam / aam (proximity) |
              torp (underwater)
     cal      calibre (mm)
     mass     the round / missile / bomb as it flies (kg)
     fill     high-explosive fill (kg), `filler` names it, `re` its relative
              effectiveness (TNT = 1). W = fill x re, kg TNT-equivalent: the
              ONE number the blast law (systems/breach.js) prices everything
              from (Hopkinson-Cranz: effects at R = Z . W^(1/3))
     ke / ce  penetration, mm of rolled homogeneous armour: ke for a kinetic
              penetrator at its typical engagement range, ce for a shaped
              charge's jet (main charge, behind reactive armour where known)
     jet      metres of reinforced concrete the shaped jet perforates
     conc     metres of reinforced concrete a penetrating case goes through
              before its delay fuze sets it off (the bunker busters)
     fuze     the fuzes it carries (pd point detonating, delay, prox, airburst,
              hit kill-on-contact); fuze0 is the default
     guide    none | laser | gps | ir | radar | wire | command | inertial
     attack   direct | top (overflies or dives on the roof) | dive | lob
     v        muzzle / impact speed (m/s) as the game flies it
     range    maximum effective range (m) of the munition itself
     killR    the published (or, where none is published, the cube-root
              scaled) radius inside which a man in the open is killed (m)
     look     which explosion picture to draw (city/crashfx.js blastKind)
     shape    which body weapons/munitions.js draws in flight
   Sources, rounded: FM 3-22.37/3-22.32 and TM 43-0001 (US ground ammunition),
   TM 43-0001-28 (artillery), USAF fact sheets, NAVSEA/USN fact sheets,
   Jane's figures where nothing official is published. Where a figure is an
   estimate it says so beside the row.

   DERIVED (`fx(id)` / `effects(W, row)`): the game-side numbers every
   consumer used to type by hand, from the row and the law:
     W         kg TNT-eq
     R         the battle blast radius: damage tapers to 0 there, the lethal
               core is 0.55 R = killR (src/battle/physics.js blastBodies)
     power     the battle's blast power (0.9 + 0.35 W^(1/3)): damage and knock
     pen       the armour a DIRECT hit defeats (ke, else ce, else the blast's
               contact figure 25 W^(1/3), plus a penetrating case's 400 x conc)
     beh       damage behind the plate: kinetic rounds by the penetrator's
               energy (900 x (E / 12 MJ)^0.4, the 120 mm dart = 900), shaped
               charges 600 x W^(1/3), blast 400 x W^(1/3)
     craterR   apparent crater radius on soil (0.8 W^(1/3), surface burst)
     visPower  the fireball's picture scale (crashfx clamps it at 2.2)

   `arm(w)` fills a unit weapon row from its row ids:
     { id, kind, mun: "m829a3", heMun: "m830a1", ... }   -> w.pen, w.beh,
     w.speed, w.he = { pen, beh, blast, power, W, mun }, w.heSpeed, w.top.
   A unit file states which munition its gun fires, never the numbers.

   `blastOn(W, d, plate)` is THE BLAST AGAINST A HULL at distance d: the
   loading in mm RHA-equivalent a blast-frag burst puts on a plate
   (220 Z^-1.5, Z = d / W^(1/3)), capped by the warhead's own contact figure,
   and what it does behind it. A Mk 84 inside ~10 m kills a tank, a 155 mm
   shell on the deck of a Humvee kills it, a 25 mm HEI does nothing to a
   Bradley. The same function answers for a parked jet, a boat and a drone.
============================================================ */
(function () {
  "use strict";
  const GW = typeof window !== "undefined" ? window : globalThis;
  const CBZ = GW.CBZ = GW.CBZ || {};
  if (CBZ.munitionTable) return;

  // relative effectiveness of the fills (TNT = 1)
  const RE = {
    tnt: 1.0, compB: 1.33, compA3: 1.35, compA5: 1.6, compB4: 1.33, tritonal: 1.07, h6: 1.35, octol: 1.7,
    lx14: 1.8, pbxn109: 1.17, pbxn107: 1.3, pbxn110: 1.2, pbxn5: 1.7, pbxn9: 1.2, afx757: 1.4, a_ix_1: 1.3, a_ix_2: 1.5,
    cyclotol: 1.4, pbxn103: 1.5, rdx: 1.6, c4: 1.34, hta3: 1.3, tbx: 2.0,
  };

  /* ======================================================================
     THE ROWS
     ====================================================================== */
  const R = Object.create(null);
  function row(id, r) { r.id = id; R[id] = r; return r; }

  /* ---- tank and IFV guns ------------------------------------------------ */
  row("m829a3", { name: "120 mm M829A3 APFSDS-T", cls: "ke", cal: 120, mass: 22.3, sub: 10.0, fill: 0,
    ke: 750, fuze: ["none"], guide: "none", attack: "direct", v: 1555, range: 4000, killR: 0, look: "tank", shape: "shell" });
  row("m830a1", { name: "120 mm M830A1 MPAT (HEAT-MP-T)", cls: "heat", cal: 120, mass: 22.5, sub: 11.4, fill: 1.0, filler: "compA3",
    ce: 480, jet: 1.2, fuze: ["pd", "prox"], fuze0: "pd", guide: "none", attack: "direct", v: 1410, range: 4000, killR: 4.5,
    look: "tank", shape: "shell" });
  row("3of26", { name: "125 mm 3OF26 HE-FRAG", cls: "he", cal: 125, mass: 33, sub: 23, fill: 3.4, filler: "a_ix_2",
    fuze: ["pd", "delay"], guide: "none", attack: "direct", v: 850, range: 5000, killR: 12, look: "tank", shape: "shell" });
  row("m791", { name: "25 mm M791 APDS-T", cls: "ke", cal: 25, mass: 0.458, sub: 0.134, fill: 0,
    ke: 65, guide: "none", attack: "direct", v: 1345, range: 2500, killR: 0, look: "spark" });
  row("m919", { name: "25 mm M919 APFSDS-T", cls: "ke", cal: 25, mass: 0.458, sub: 0.096, fill: 0,
    ke: 100, guide: "none", attack: "direct", v: 1390, range: 2500, killR: 0, look: "spark" });
  row("m792", { name: "25 mm M792 HEI-T", cls: "he", cal: 25, mass: 0.5, sub: 0.184, fill: 0.031, filler: "a_ix_1",
    he: 12, fuze: ["pd"], guide: "none", attack: "direct", v: 1100, range: 3000, killR: 1.6, look: "grenade" });
  row("pgu32", { name: "25 mm PGU-32/U SAPHEI-T", cls: "he", cal: 25, mass: 0.5, sub: 0.18, fill: 0.03, filler: "pbxn5",
    ke: 40, fuze: ["delay"], guide: "none", attack: "direct", v: 1040, range: 1800, killR: 1.6, look: "grenade" });
  row("m789", { name: "30 mm M789 HEDP", cls: "hedp", cal: 30, mass: 0.34, sub: 0.233, fill: 0.0215, filler: "pbxn5",
    ce: 30, fuze: ["pd"], guide: "none", attack: "direct", v: 805, range: 1700, killR: 2.2, look: "grenade" });

  /* ---- artillery and mortars -------------------------------------------- */
  row("m795", { name: "155 mm M795 HE", cls: "he", cal: 155, mass: 46.7, fill: 10.8, filler: "tnt",
    fuze: ["pd", "delay", "prox"], fuze0: "pd", guide: "none", attack: "lob", v: 827, range: 22400, killR: 20,
    look: "tank" });
  row("m982", { name: "155 mm M982 Excalibur", cls: "he", cal: 155, mass: 48, fill: 10.0, filler: "pbxn9",
    fuze: ["pd", "delay", "airburst"], fuze0: "pd", guide: "gps", attack: "lob", v: 827, range: 40000, killR: 20, look: "tank" });
  row("m933", { name: "120 mm M933A1 mortar HE", cls: "he", cal: 120, mass: 13.6, fill: 2.99, filler: "compB",
    fuze: ["pd", "prox", "delay"], guide: "none", attack: "lob", v: 318, range: 7200, killR: 12, look: "grenade" });
  row("m821", { name: "81 mm M821A2 mortar HE", cls: "he", cal: 81, mass: 4.1, fill: 0.68, filler: "compB",
    fuze: ["pd", "prox"], guide: "none", attack: "lob", v: 264, range: 5600, killR: 8, look: "grenade" });
  row("m720", { name: "60 mm M720A1 mortar HE", cls: "he", cal: 60, mass: 1.7, fill: 0.36, filler: "compB",
    fuze: ["pd", "prox"], guide: "none", attack: "lob", v: 237, range: 3500, killR: 6, look: "grenade" });

  /* ---- infantry ---------------------------------------------------------- */
  row("m67", { name: "M67 fragmentation grenade", cls: "frag", cal: 64, mass: 0.4, fill: 0.18, filler: "compB",
    fuze: ["delay"], guide: "none", attack: "lob", v: 19, range: 35, killR: 5, look: "grenade" });
  row("m433", { name: "40 mm M433 HEDP", cls: "hedp", cal: 40, mass: 0.23, fill: 0.032, filler: "compA5",
    ce: 63, fuze: ["pd"], guide: "none", attack: "lob", v: 76, range: 400, killR: 2.75, look: "grenade", shape: "g40" });
  row("m430a1", { name: "40 mm M430A1 HEDP (Mk 19)", cls: "hedp", cal: 40, mass: 0.34, fill: 0.04, filler: "compA5",
    ce: 76, fuze: ["pd"], guide: "none", attack: "lob", v: 241, range: 2212, killR: 5, look: "grenade", shape: "g40" });
  row("pg7v", { name: "PG-7V (RPG-7)", cls: "heat", cal: 85, mass: 2.2, fill: 0.73, filler: "a_ix_1",
    ce: 330, jet: 1.5, fuze: ["pd"], guide: "none", attack: "direct", v: 295, range: 920, killR: 4, look: "rpg", shape: "pg7" });
  row("pg7vl", { name: "PG-7VL (RPG-7)", cls: "heat", cal: 93, mass: 2.6, fill: 0.73, filler: "a_ix_1",
    ce: 500, jet: 1.8, fuze: ["pd"], guide: "none", attack: "direct", v: 300, range: 920, killR: 4, look: "rpg", shape: "pg7" });
  row("og7v", { name: "OG-7V fragmentation (RPG-7)", cls: "frag", cal: 40, mass: 2.0, fill: 0.21, filler: "a_ix_2",
    fuze: ["pd"], guide: "none", attack: "direct", v: 152, range: 700, killR: 7, look: "rpg", shape: "pg7" });
  row("at4", { name: "AT4 84 mm HEAT", cls: "heat", cal: 84, mass: 1.8, fill: 0.44, filler: "octol",
    ce: 420, jet: 1.2, fuze: ["pd"], guide: "none", attack: "direct", v: 285, range: 500, killR: 3.5, look: "rpg" });
  row("m72", { name: "M72 LAW 66 mm HEAT", cls: "heat", cal: 66, mass: 1.0, fill: 0.3, filler: "octol",
    ce: 300, jet: 0.9, fuze: ["pd"], guide: "none", attack: "direct", v: 145, range: 220, killR: 3, look: "rpg" });
  row("c4_m112", { name: "M112 demolition block (C4, 1.25 lb)", cls: "blast", cal: 0, mass: 0.57, fill: 0.57, filler: "c4",
    fuze: ["command", "delay"], guide: "none", attack: "placed", v: 0, range: 0, killR: 4, look: "c4" });
  row("c4_5lb", { name: "C4 breaching charge, 5 lb", cls: "blast", cal: 0, mass: 2.27, fill: 2.27, filler: "c4",
    fuze: ["command", "delay"], guide: "none", attack: "placed", v: 0, range: 0, killR: 6, look: "c4" });

  /* ---- anti-tank missiles ----------------------------------------------- */
  row("tow2a", { name: "BGM-71E TOW-2A", cls: "heat", cal: 152, mass: 22.6, fill: 3.1, filler: "lx14",
    ce: 900, jet: 2.0, fuze: ["pd"], guide: "wire", attack: "direct", v: 190, range: 3750, killR: 5, look: "hellfire", shape: "atgm" });
  // TOW-2B flies OVER the hull and fires two tantalum EFPs straight down
  // through the roof (the figure is an estimate for each EFP's plate)
  row("tow2b", { name: "BGM-71F TOW-2B (top attack)", cls: "heat", cal: 152, mass: 22.6, fill: 3.1, filler: "lx14",
    ce: 220, jet: 0.8, fuze: ["prox"], guide: "wire", attack: "top", v: 190, range: 3750, killR: 5, look: "hellfire", shape: "atgm" });
  row("javelin", { name: "FGM-148 Javelin", cls: "heat", cal: 127, mass: 15.5, fill: 2.7, filler: "lx14",
    ce: 760, jet: 2.0, fuze: ["pd"], guide: "ir", attack: "top", v: 170, range: 4000, minRange: 65, killR: 6,
    look: "hellfire", shape: "atgm" });
  // the 9 kg tandem warhead's fill (main charge + precursor), Jane's estimate
  row("agm114k", { name: "AGM-114K Hellfire II", cls: "heat", cal: 178, mass: 45, fill: 5.3, filler: "octol",
    ce: 800, jet: 2.0, fuze: ["pd"], guide: "laser", attack: "dive", v: 425, range: 8000, minRange: 500, killR: 6,
    look: "hellfire", shape: "atgm" });
  row("agm114r", { name: "AGM-114R Hellfire Romeo (multi-purpose)", cls: "hedp", cal: 178, mass: 49, fill: 5.3, filler: "octol",
    ce: 700, jet: 1.8, fuze: ["pd", "delay"], fuze0: "pd", guide: "laser", attack: "dive", v: 425, range: 8000, minRange: 500,
    killR: 10, look: "hellfire", shape: "atgm" });

  /* ---- rockets ------------------------------------------------------------ */
  row("m151", { name: "Hydra 70 M151 HE (10 lb)", cls: "he", cal: 70, mass: 10.4, fill: 1.04, filler: "compB4",
    he: 20, fuze: ["pd"], guide: "none", attack: "direct", v: 740, range: 8000, killR: 10, look: "hydra", shape: "hydra" });
  // GMLRS unitary: a 90 kg warhead (200 lb class) of which ~23 kg is the
  // PBXN-109 fill; the rest is the steel case that makes the fragments
  row("m31a1", { name: "M31A1 GMLRS unitary", cls: "he", cal: 227, mass: 309, fill: 23, filler: "pbxn109",
    he: 60, fuze: ["pd", "delay", "prox"], fuze0: "pd", guide: "gps", attack: "lob", v: 700, range: 70000, killR: 25,
    look: "mlrs", shape: "mlrs" });

  /* ---- air defence and air to air -------------------------------------- */
  row("pac3mse", { name: "PAC-3 MSE (hit-to-kill)", cls: "sam", cal: 290, mass: 312, fill: 0.073, filler: "pbxn110",
    ke: 300, fuze: ["hit"], guide: "radar", attack: "direct", v: 1600, range: 60000, killR: 3, look: "patriot", shape: "patriot" });
  row("pac2gem", { name: "MIM-104 PAC-2 GEM", cls: "sam", cal: 410, mass: 900, fill: 40, filler: "compB",
    he: 20, fuze: ["prox"], guide: "radar", attack: "direct", v: 1200, range: 160000, killR: 20, look: "patriot", shape: "patriot" });
  row("aim120c", { name: "AIM-120C AMRAAM", cls: "aam", cal: 178, mass: 161, fill: 6, filler: "pbxn110",
    he: 20, fuze: ["prox", "pd"], guide: "radar", attack: "direct", v: 1360, range: 105000, minRange: 800, killR: 12,
    look: "aam", shape: "aam" });
  row("aim9x", { name: "AIM-9X Sidewinder", cls: "aam", cal: 127, mass: 85, fill: 3.0, filler: "pbxn110",
    he: 15, fuze: ["prox", "pd"], guide: "ir", attack: "direct", v: 900, range: 35000, killR: 8, look: "aam", shape: "aam" });
  row("fim92", { name: "FIM-92 Stinger", cls: "aam", cal: 70, mass: 10.1, fill: 1.0, filler: "hta3",
    he: 10, fuze: ["pd"], guide: "ir", attack: "direct", v: 750, range: 4800, killR: 4, look: "aam", shape: "aam" });

  /* ---- bombs -------------------------------------------------------------- */
  row("mk82", { name: "Mk 82 500 lb general purpose", cls: "bomb", cal: 273, mass: 241, fill: 87, filler: "tritonal",
    he: 110, fuze: ["pd", "delay", "airburst"], fuze0: "pd", guide: "none", attack: "lob", v: 250, range: 0, killR: 20,
    look: "mk82", shape: "mk82" });
  row("mk83", { name: "Mk 83 1000 lb general purpose", cls: "bomb", cal: 356, mass: 447, fill: 202, filler: "tritonal",
    he: 150, fuze: ["pd", "delay"], fuze0: "pd", guide: "none", attack: "lob", v: 250, range: 0, killR: 27, look: "mk84", shape: "mk84" });
  row("mk84", { name: "Mk 84 2000 lb general purpose", cls: "bomb", cal: 458, mass: 925, fill: 429, filler: "tritonal",
    he: 190, fuze: ["pd", "delay", "airburst"], fuze0: "pd", guide: "none", attack: "lob", v: 270, range: 0, killR: 35,
    look: "mk84", shape: "mk84" });
  row("gbu12", { name: "GBU-12 Paveway II (Mk 82, laser)", base: "mk82", guide: "laser", range: 14800, shape: "mk82" });
  row("gbu38", { name: "GBU-38 JDAM (Mk 82, GPS)", base: "mk82", guide: "gps", range: 24000, shape: "mk82" });
  row("gbu31v1", { name: "GBU-31(V)1 JDAM (Mk 84, GPS)", base: "mk84", guide: "gps", range: 24000, shape: "jdam" });
  row("gbu31v3", { name: "GBU-31(V)3 JDAM (BLU-109 penetrator)", cls: "pen", cal: 370, mass: 874, fill: 240, filler: "tritonal",
    he: 190, conc: 1.8, fuze: ["delay", "pd"], fuze0: "delay", guide: "gps", attack: "lob", v: 300, range: 24000, killR: 25,
    look: "jdam", shape: "jdam" });
  row("gbu39", { name: "GBU-39/B Small Diameter Bomb", cls: "pen", cal: 190, mass: 129, fill: 16, filler: "afx757",
    he: 60, conc: 0.9, fuze: ["delay", "pd", "airburst"], fuze0: "pd", guide: "gps", attack: "dive", v: 250, range: 110000,
    killR: 10, look: "jdam", shape: "mk82" });
  row("gbu28", { name: "GBU-28 (BLU-113 bunker buster)", cls: "pen", cal: 368, mass: 2130, fill: 306, filler: "tritonal",
    he: 200, conc: 6, fuze: ["delay"], guide: "laser", attack: "lob", v: 320, range: 9000, killR: 30, look: "jdam", shape: "gbu28" });
  row("gbu57", { name: "GBU-57A/B Massive Ordnance Penetrator", cls: "pen", cal: 800, mass: 13600, fill: 2404, filler: "afx757",
    he: 300, conc: 18, fuze: ["delay"], guide: "gps", attack: "lob", v: 330, range: 15000, killR: 60, look: "buster", shape: "gbu28" });
  row("gbu43", { name: "GBU-43/B MOAB", cls: "blast", cal: 1029, mass: 9800, fill: 8480, filler: "h6",
    he: 300, fuze: ["airburst", "pd"], fuze0: "airburst", guide: "gps", attack: "lob", v: 200, range: 0, killR: 150,
    look: "moab", shape: "mk84" });
  // CBU-87: 202 BLU-97/B combined-effects bomblets over ~200 x 400 m; a row
  // for the dispenser, `sub` for one bomblet (the ordnance system drops it
  // as an area, not as one blast)
  row("cbu87", { name: "CBU-87 combined effects munition", cls: "frag", cal: 396, mass: 430, fill: 202 * 0.287, filler: "cyclotol",
    he: 30, sub: { n: 202, fill: 0.287, ce: 190 }, fuze: ["airburst"], guide: "none", attack: "lob", v: 250, range: 0, killR: 30,
    look: "mk82", shape: "mk82" });

  /* ---- cruise and naval -------------------------------------------------- */
  row("tomahawk", { name: "BGM-109 Tomahawk Block IV", cls: "bomb", cal: 518, mass: 1510, fill: 166, filler: "pbxn107",
    he: 150, fuze: ["pd", "delay", "airburst"], fuze0: "pd", guide: "gps", attack: "dive", v: 245, range: 1600000, killR: 40,
    look: "mk84", shape: "aam" });
  row("rgm84", { name: "RGM-84 Harpoon", cls: "pen", cal: 343, mass: 691, fill: 90, filler: "compB",
    he: 100, conc: 0.4, fuze: ["delay"], guide: "radar", attack: "direct", v: 240, range: 124000, killR: 25, look: "mk82", shape: "aam" });
  row("nsm", { name: "Naval Strike Missile", cls: "pen", cal: 400, mass: 410, fill: 50, filler: "pbxn107",
    he: 90, conc: 0.4, fuze: ["delay"], guide: "ir", attack: "direct", v: 300, range: 185000, killR: 20, look: "mk82", shape: "aam" });
  row("sm2", { name: "RIM-66 Standard SM-2", cls: "sam", cal: 343, mass: 708, fill: 25, filler: "compB",
    he: 15, fuze: ["prox"], guide: "radar", attack: "direct", v: 1200, range: 167000, killR: 15, look: "patriot", shape: "patriot" });
  row("essm", { name: "RIM-162 ESSM", cls: "sam", cal: 254, mass: 280, fill: 15, filler: "pbxn110",
    he: 15, fuze: ["prox"], guide: "radar", attack: "direct", v: 1300, range: 50000, killR: 12, look: "patriot", shape: "patriot" });
  row("rim116", { name: "RIM-116 Rolling Airframe Missile", cls: "sam", cal: 127, mass: 73.5, fill: 3.0, filler: "pbxn110",
    he: 10, fuze: ["prox", "pd"], guide: "ir", attack: "direct", v: 700, range: 10000, killR: 6, look: "aam", shape: "aam" });
  row("mk45_he", { name: "5 in/54 Mk 45 HE (Mk 64)", cls: "he", cal: 127, mass: 31.75, fill: 3.63, filler: "compA3",
    fuze: ["pd", "prox"], fuze0: "pd", guide: "none", attack: "direct", v: 808, range: 23000, killR: 15, look: "tank", shape: "shell" });
  row("oto76_he", { name: "76 mm/62 OTO Melara HE", cls: "he", cal: 76, mass: 6.3, fill: 0.75, filler: "tnt",
    fuze: ["pd", "prox"], guide: "none", attack: "direct", v: 925, range: 16000, killR: 8, look: "grenade", shape: "shell" });
  row("mk295", { name: "57 mm Mk 295 HE-PFx (Mk 110)", cls: "he", cal: 57, mass: 2.4, fill: 0.42, filler: "pbxn5",
    fuze: ["prox", "pd", "airburst"], fuze0: "prox", guide: "none", attack: "direct", v: 1035, range: 14000, killR: 6, look: "grenade" });
  row("mk149", { name: "20 mm Mk 149 APDS (Phalanx)", cls: "ke", cal: 20, mass: 0.27, sub: 0.07, fill: 0,
    ke: 30, guide: "radar", attack: "direct", v: 1113, range: 3600, killR: 0, look: "spark" });
  row("mk48", { name: "Mk 48 ADCAP torpedo", cls: "torp", cal: 533, mass: 1676, fill: 292, filler: "pbxn103",
    he: 400, fuze: ["prox", "pd"], guide: "wire", attack: "under", v: 28, range: 38000, killR: 0, look: "water" });
  row("mk54", { name: "Mk 54 lightweight torpedo", cls: "torp", cal: 324, mass: 276, fill: 44, filler: "pbxn103",
    he: 150, fuze: ["prox", "pd"], guide: "radar", attack: "under", v: 20, range: 9000, killR: 0, look: "water" });

  /* ---- loitering munitions and drone warheads ----------------------------
     For the drone builder: a drone's weapon row names one of these ids. The
     drone flies itself; on its terminal dive the warhead is resolved here
     like any other round (CBZ.strike). Figures are open-source estimates. */
  row("switchblade300", { name: "Switchblade 300 Block 20", cls: "frag", cal: 76, mass: 2.5, fill: 0.15, filler: "rdx",
    fuze: ["pd", "prox"], guide: "command", attack: "dive", v: 45, range: 10000, killR: 3, look: "grenade" });
  row("switchblade600", { name: "Switchblade 600 (Javelin-class warhead)", cls: "heat", cal: 127, mass: 15, fill: 2.7, filler: "lx14",
    ce: 760, jet: 2.0, fuze: ["pd"], guide: "command", attack: "dive", v: 51, range: 40000, killR: 6, look: "hellfire" });
  row("fpv_pg7vl", { name: "FPV drone, PG-7VL warhead", cls: "heat", cal: 93, mass: 2.6, fill: 0.73, filler: "a_ix_1",
    ce: 500, jet: 1.8, fuze: ["pd"], guide: "command", attack: "dive", v: 40, range: 10000, killR: 4, look: "rpg" });
  row("fpv_og7v", { name: "FPV drone, OG-7V fragmentation warhead", cls: "frag", cal: 40, mass: 2.0, fill: 0.21, filler: "a_ix_2",
    fuze: ["pd"], guide: "command", attack: "dive", v: 40, range: 10000, killR: 7, look: "rpg" });
  row("fpv_tm62", { name: "FPV drone, TM-62 anti-tank mine charge", cls: "blast", cal: 320, mass: 9.5, fill: 7.5, filler: "tnt",
    he: 60, fuze: ["pd"], guide: "command", attack: "dive", v: 30, range: 8000, killR: 12, look: "c4" });
  row("drop_vog17", { name: "VOG-17M 30 mm grenade, drone-dropped", cls: "frag", cal: 30, mass: 0.35, fill: 0.036, filler: "a_ix_1",
    fuze: ["pd"], guide: "none", attack: "lob", v: 25, range: 0, killR: 3, look: "grenade" });
  row("drop_rkg3", { name: "RKG-3 HEAT grenade, drone-dropped", cls: "heat", cal: 70, mass: 1.07, fill: 0.567, filler: "compB",
    ce: 125, jet: 0.5, fuze: ["pd"], guide: "none", attack: "top", v: 25, range: 0, killR: 3, look: "rpg" });
  row("lancet3", { name: "ZALA Lancet-3", cls: "hedp", cal: 120, mass: 12, fill: 1.5, filler: "octol",
    ce: 200, jet: 0.8, fuze: ["pd", "prox"], guide: "command", attack: "dive", v: 30, range: 40000, killR: 8, look: "hellfire" });
  row("shahed136", { name: "Shahed-136 / Geran-2", cls: "he", cal: 450, mass: 200, fill: 40, filler: "tnt",
    he: 60, fuze: ["pd", "prox"], guide: "gps", attack: "dive", v: 50, range: 2000000, killR: 25, look: "mk82" });

  /* ---- the nuclear row (systems/impactbus.js and city/nukefx.js own its
     field; here so the table names every warhead) ----------------------- */
  row("b61", { name: "B61 (16 kt setting)", cls: "nuke", cal: 338, mass: 320, fill: 16e6, filler: "tnt",
    fuze: ["airburst", "pd"], guide: "inertial", attack: "lob", v: 250, range: 0, killR: 1100, look: "nuke" });

  // ---- inherit a base row (a guidance kit on a bomb is the bomb) -----------
  Object.keys(R).forEach(function (id) {
    const r = R[id];
    if (!r.base) return;
    const b = R[r.base];
    Object.keys(b).forEach(function (k) { if (r[k] === undefined && k !== "id" && k !== "name") r[k] = b[k]; });
  });

  /* ---- what other files call these warheads ---------------------------------
     The ordnance bus's row ids, the old weapon ids and the shorthand callers
     use. One map, so "jdam", "gbu31_jdam" and "gbu31v1" are the same bomb. */
  const ALIAS = {
    grenade: "m67", rpg: "pg7v", bazooka: "pg7v", tank: "3of26", tankHeat: "m830a1", shell: "m830a1",
    hellfire: "agm114k", missile: "agm114k", atgm: "agm114k", hydra: "m151", aam: "aim120c", patriot: "pac2gem",
    rocket227: "m31a1", mlrs: "m31a1", airstrike: "mk82", bomb: "mk84", jdam: "gbu31v1", buster: "gbu57", mop: "gbu57",
    moab: "gbu43", c4: "c4_5lb", nuke: "b61", warhead: "b61",
    gbu31_jdam: "gbu31v1", gbu31_mk84: "gbu31v1", gbu31_blu109: "gbu31v3", gbu39_sdb: "gbu39", sdb: "gbu39", blu109: "gbu31v3",
    m256_120mm: "m829a3", m242_25mm: "m791", m230_30mm: "m789", gau22_25mm: "pgu32", hydra70: "m151",
    agm114_hellfire: "agm114k", tow_2b: "tow2b", m31a1_gmlrs: "m31a1", pac3_mse: "pac3mse", mk82_stick: "mk82",
    iron: "mk82", heavy: "mk84", cluster: "cbu87", m433_40mm: "m433",
  };

  function get(id) {
    if (!id) return null;
    if (typeof id === "object") return id.id && R[id.id] === id ? id : null;
    return R[id] || R[ALIAS[id]] || null;
  }

  /* ======================================================================
     DERIVED NUMBERS
     ====================================================================== */
  function cbrt(x) { return Math.cbrt(Math.max(0, +x || 0)); }
  function Wof(r) { return r ? (+r.fill || 0) * (RE[r.filler] || 1) : 0; }
  // the kinetic energy of the penetrator (J)
  function keE(r) { const m = r.sub || r.mass || 0, v = r.v || 0; return 0.5 * m * v * v; }

  // derived blast numbers for a charge W (no row: a bare charge)
  function effects(W, r) {
    W = Math.max(0, +W || 0);
    const c = cbrt(W);
    const killR = r && r.killR > 0 ? r.killR : (W > 0 ? 4.2 * c : 0);
    return {
      W: W,
      R: killR > 0 ? Math.max(1.5, killR / 0.55) : 0,
      power: W > 0 ? Math.min(9, 0.9 + 0.35 * c) : 0,
      craterR: 0.8 * c,
      visPower: W > 0 ? Math.min(2.2, Math.max(0.45, 0.5 + 0.45 * c)) : 0,
      // the burst's contact loading on a plate (mm RHA-equivalent)
      contact: 25 * c,
    };
  }

  const FX = Object.create(null);
  function fx(id) {
    const r = get(id);
    if (!r) return null;
    if (FX[r.id]) return FX[r.id];
    const W = Wof(r), e = effects(W, r), c = cbrt(W);
    let pen = 0, beh = 0;
    if (r.ke > 0) {                                      // a kinetic penetrator
      pen = r.ke;
      beh = 900 * Math.pow(keE(r) / 12e6, 0.4);
    }
    if (r.ce > 0 && r.ce >= pen) {                       // a shaped charge's jet
      pen = r.ce;
      beh = Math.max(beh, 600 * c);
    }
    if (!pen && W > 0) {                                 // blast and fragments
      pen = Math.max(r.he || 0, e.contact) + (r.conc > 0 ? 400 * r.conc : 0);
      beh = 400 * c * (r.conc > 0 ? 1.1 : 1);
    }
    const out = {
      id: r.id, name: r.name, cls: r.cls, W: W, R: e.R, power: e.power, killR: e.R * 0.55,
      pen: Math.round(pen), beh: Math.round(beh), craterR: e.craterR, visPower: e.visPower, contact: e.contact,
      shaped: !!(r.ce > 0 && W > 0), jet: r.jet || 0, conc: r.conc || 0, top: r.attack === "top" || r.attack === "dive",
      v: r.v || 0, range: r.range || 0, look: r.look || null, shape: r.shape || null, guide: r.guide || "none",
      fuze: r.fuze0 || (r.fuze && r.fuze[0]) || "pd",
    };
    FX[r.id] = out;
    return out;
  }

  /* blastOn(W, d, plate) — THE BLAST AGAINST A HULL at distance d (m).
     Returns { pen, beh } in the units vehicleDrive.resolve reads, or null
     when the burst is too far away to matter. Plate is not used to decide
     (resolve does that); it only lets a caller ask "would it". */
  function blastOn(W, d, contactCap) {
    if (!(W > 0)) return null;
    const c = cbrt(W);
    const Z = Math.max(0.15, d / Math.max(1e-3, c));
    if (Z > 12) return null;
    const cap = contactCap > 0 ? contactCap : 25 * c;
    const pen = Math.min(cap, 220 * Math.pow(Z, -1.5));
    if (pen < 0.5) return null;
    const beh = Math.min(400 * c * 1.5, 400 * c / Math.max(0.4, Z));
    return { pen: pen, beh: beh, Z: Z };
  }

  /* arm(w) — a unit weapon row takes its numbers from its munitions. */
  function arm(w) {
    if (!w || w._armed) return w;
    const main = get(w.mun), heR = get(w.heMun);
    if (!main && !heR) return w;
    w._armed = true;
    // what a direct hit is, for the armour (vehicleDrive.resolve: a shaped
    // charge meets armourCE and slat; a dart meets the plate)
    const r0 = main || heR;
    w.keCls = r0.cls === "ke" ? (/APFSDS/.test(r0.name) ? "apfsds" : "ap") : r0.cls === "heat" || r0.cls === "hedp" ? r0.cls : "he";
    if (main) {
      const f = fx(main);
      w.pen = f.pen; w.beh = f.beh;
      if (!(w.speed > 0) && f.v > 0) w.speed = f.v;
      if (!(w.range > 0) && f.range > 0) w.range = f.range;
      if (f.top) w.top = true;
      if (f.W > 0) w.he = { pen: f.pen, beh: f.beh, blast: f.R, power: f.power, W: f.W, mun: f.id };
    }
    if (heR) {
      const h = fx(heR);
      w.he = { pen: h.pen, beh: h.beh, blast: h.R, power: h.power, W: h.W, mun: h.id };
      if (!(w.heSpeed > 0) && h.v > 0) w.heSpeed = h.v;
      if (!main) { w.pen = h.pen; w.beh = h.beh; if (!(w.speed > 0)) w.speed = h.v; }
    }
    return w;
  }

  /* ejecta(W, surface) — WHAT A GROUND BURST THROWS, sized by the charge.
     The apparent crater (0.8 W^(1/3)), and the clods out of it: lumps no
     bigger than ~a tenth of the crater across (loose sand and snow do not
     hold together, concrete breaks into slab), their count rising with the
     volume dug. A 25 mm HEI flicks a few grains; a Mk 84 throws ~26 lumps
     of up to half a metre and a shower of small ones. */
  function ejecta(W, surface) {
    const c3 = cbrt(Math.max(0.01, +W || 0));
    const craterR = Math.min(42, 0.8 * c3);
    const cohere = surface === "sand" ? 0.55 : surface === "snow" ? 0.7 : surface === "concrete" ? 1.1 : 1;
    const lump = Math.min(0.5, Math.max(0.03, craterR * 0.12 * cohere));
    return {
      craterR: craterR, lump: lump, lumpN: Math.round(Math.min(26, 2 + c3 * 3.2)),
      fine: Math.max(0.02, lump * 0.35), fineN: Math.round(Math.min(40, 5 + c3 * 6)),
      power: Math.min(3, 0.7 + c3 * 0.45), digs: craterR >= 0.3,
    };
  }

  function list() { return Object.keys(R); }
  function rowOf(id) { return get(id); }
  function aliasOf(id) { return ALIAS[id] || (R[id] ? id : null); }

  CBZ.munitionTable = {
    ROWS: R, RE: RE, ALIAS: ALIAS,
    get: rowOf, fx: fx, W: function (id) { return Wof(get(id)); }, effects: effects, blastOn: blastOn, ejecta: ejecta,
    arm: arm, list: list, aliasOf: aliasOf, cbrt: cbrt,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.munitionTable;
})();
