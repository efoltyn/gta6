/* Matched role-outfit census for Gang City.

   Each subject asks the canonical cityOutfitFor caster what a real job wears,
   then dresses the live player rig with that exact record. The deployed side
   therefore shows today's fallbacks (often plain street clothes) while the
   local side shows additions through the same owner every NPC spawn uses.
   One representative job per UNIQUE role outfit keeps the report complete
   without photographing aliases such as nurse/scrubs twice. */

import { stageOutfit } from "./outfit-gallery.mjs";

const role = (id, label, job, focus, extra) => Object.assign({
  id,
  label,
  view: "front",
  cast: Object.assign({ job }, (extra && extra.cast) || null),
  focus,
}, extra && extra.subject ? extra.subject : null);

const subjects = [
  // Law, emergency, and military — the current high bar.
  role("police", "Police officer", "police officer", "Badge, duty jacket, belt, cap, and police-blue silhouette.", { cast: { kind: "cop", cop: true } }),
  role("swat", "SWAT officer", "swat officer", "Carrier bulk, placards, pouches, and dark fatigues must stay readable.", { cast: { kind: "cop", cop: true, swat: true } }),
  role("sheriff", "Sheriff's deputy", "sheriff's deputy", "County khaki, brown trousers, star badge, and duty-belt read."),
  role("soldier", "Soldier", "soldier", "Fatigues must read as authored camouflage rather than a green civilian shirt."),
  role("security", "Security guard", "security guard", "Guard blacks, epaulettes, and SECURITY chest tape."),
  role("close-protection", "Close protection / agent", "close protection", "Slim all-black tactical shell, harness, pockets, and dark trousers."),
  role("paramedic", "Paramedic", "paramedic", "Navy EMS workwear with reflective bands and medical patch."),
  role("nurse", "Nurse", "nurse", "Recognizable scrub V-neck, pocket, and matching trousers."),
  role("doctor", "Doctor", "doctor", "White coat shell, open scrub front, pockets, and stethoscope."),
  role("firefighter", "Firefighter", "firefighter", "Tan turnout gear and high-contrast reflective bands."),

  // Existing trades and service roles.
  role("construction", "Construction worker", "construction worker", "Site-orange hi-vis over workwear, distinct from airport ground crew."),
  role("dock", "Dock / warehouse worker", "dock worker", "Dock hi-vis, reflective bands, jeans, and work boots."),
  role("mechanic", "Mechanic", "mechanic", "One-piece coveralls, zip, name patch, pockets, and knee panels."),
  role("chef", "Chef", "line cook", "Chef whites, double-breasted buttons, and neckerchief."),
  role("waiter", "Waiter / croupier", "waiter", "Black-and-white service formalwear that also covers casino dealers."),
  role("vendor", "Vendor / shopkeeper", "street vendor", "Apron, rolled work sleeves, and front pouch."),
  role("mail", "Mail carrier", "mail carrier", "Postal blue uniform should remain distinct from police and transit."),
  role("pilot", "Airline pilot", "pilot", "White captain shirt, tie, wings, epaulettes, and dark trousers."),
  role("office", "Office professional", "accountant", "Composed blazer, collared shirt, tie, slacks, and shoes."),
  role("janitor", "Janitor", "janitor", "Custodian greys should read as workwear rather than generic street cloth."),
  role("valet", "Valet", "valet", "Red valet vest, white shirt, black trousers."),
  role("transit", "Bus driver", "bus driver", "Transit teal/navy uniform and dark trousers."),

  // The missing role reads this pass is intended to repair.
  role("hunter", "Hunter", "hunter", "Blaze-orange safety vest over woodland camouflage, cargo pockets, and field cap."),
  role("ranger", "Park ranger", "park ranger", "Khaki-and-forest ranger uniform, badge, pockets, and field cap."),
  role("hiker", "Hiker", "hiker", "Layered outdoor shell, practical color blocking, and trail trousers."),
  role("farmer", "Farmer / rancher", "farmer", "Work shirt under denim bib overalls with reinforced knees."),
  role("fisherman", "Fisherman / deckhand", "fisherman", "Weatherproof bib, deck layers, and rubber-boot break."),
  role("mariner", "Yacht captain / harbourmaster", "yacht captain", "Maritime whites/navy with restrained rank trim, not an airline uniform."),
  role("lifeguard", "Lifeguard", "lifeguard", "Red-and-white rescue uniform with a clear cross and beach-duty silhouette."),
  role("ski-instructor", "Ski instructor / skier", "ski instructor", "Insulated color-block ski jacket and snow trousers."),
  role("ski-patrol", "Ski patrol", "ski patrol", "Red patrol shell with a white medical cross and dark snow trousers."),
  role("ground-crew", "Airport ground crew", "ground crew", "Airport hi-vis, reflective chevrons, navy workwear, and hearing-protection color cues."),
  role("cabin-crew", "Flight attendant", "flight attendant", "Tailored cabin-service navy with a bright neck scarf, distinct from pilots."),
  role("bartender", "Bartender", "bartender", "Dark bar shirt, waist apron, towel, and rolled-sleeve read."),
  role("driver", "Cab driver / chauffeur", "cab driver", "Professional driver shirt, dark vest/tie, and cap."),
  role("housekeeping", "Housekeeper / nanny", "housekeeper", "Clean service tunic and practical apron without reading as kitchen staff."),
  role("athletic", "Trainer / boxer", "personal trainer", "Athletic warm-up kit that reads as gym work rather than ordinary streetwear."),
  role("pit-crew", "Pit crew", "pit crew", "Team coveralls, sponsor blocks, and a strong garage silhouette."),
  role("track-marshal", "Track marshal", "track marshal", "High-visibility race-control workwear distinct from construction."),
  role("racer", "Professional racer", "pro racer", "One-piece racing suit with team panels and a belt line."),
];

export default {
  id: "role-outfit-gallery",
  title: "Gang City Role Outfits — Complete Before / After Census",
  description: "Every unique role outfit is cast through cityOutfitFor and photographed on the live player rig from one locked tripod. Existing strong uniforms remain visible beside the missing hunter, ranger, outdoor, airside, snow, service, and motorsport roles so additive gains can be judged without redesigning the wardrobe.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  subjects,
  stage: stageOutfit,
};
