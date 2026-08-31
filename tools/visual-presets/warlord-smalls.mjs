/* DESERT WARLORD — AN ISLAND WITH SOMETHING ON IT YOU CAN FIGHT.

   OWNER, verbatim: "barnnerlid has more small armies too this right now jsut
   has massive armies add more small armies don't deduct any from current just
   add more small ones."

   HE IS DESCRIBING A MEASURABLE THING AND THE MEASUREMENT IS WORSE THAN THE
   COMPLAINT. campaign.js rolled every party's head count off `3 + u^3.1 * 297`
   under a comment claiming "median ~22, one in fifty over 120". The real
   curve: MEDIAN 38, and 26% of parties over 120 men. Forty parties on the
   island, a dozen of them a hundred-plus strong, and a game that starts you
   ALONE. Meanwhile core.js's BAND_CLASSES — which says 56% of parties should
   be crews of two to nine, and whose own comment says it is published "so
   campaign.js's spawner and this file's own default agree" — was called by
   nothing. The design was written down and then not wired up.

   THE CHANGE ADDS, IT DOES NOT REBALANCE, because that is what was asked for
   and because it is the safer edit: the power law still spawns the same forty
   parties at the same sizes, and a SECOND population of named archetypes —
   LOOTERS, SALT CARAVAN, DESERTERS, OASIS PATROL, RAIDING CREW, OUTRIDERS,
   LEGION SCOUTS — rides alongside it at W.SMALL_PER_BIG to one. Nothing on the
   island got smaller. There is simply now a bottom to it.

   BOTH SIDES ARE THIS CHECKOUT ON ONE SEED, so both islands are the SAME
   island — same coast, same oases, same outposts, same twenty-two holdings.
   The before side boots ?smalls=0, campaign.js's own revert. Every dot that
   differs is this wave.

   THE NUMBER THAT IS THE WHOLE ASK is `rideToAFight`: how far a lone warlord
   on day one has to ride to reach a party he is actually favoured against.
   Not how many parties exist, not the median size — the distance, in metres,
   between where the game puts you and the first thing you are allowed to do.
   A picture cannot show that and it is the reason the island read as all
   endgame. */

const subjects = [
  { id: "the-island", label: "The whole island, day one",
    view: "fit",
    focus: "THE POPULATION, at strategic zoom. Same island, same seed, same holdings — the dots are the variable. territory.js sizes a party marker by its POWER at the cube root, so a two-hundred-man legion is a big disc and a five-man looter gang is a small one, and the before side is a scattering of big discs with nothing between them. Count the small dots: every one of them is a fight a man alone could take." },
  { id: "close-in", label: "The country you can actually ride to",
    view: "focus",
    focus: "ONE HOLDING AT ZOOM, which is the scale a player actually operates at — you do not ride the whole island in a day. BEFORE: the parties in reach are a legion and a company, and the honest move is to ride past both. AFTER: the same ground has crews and a caravan on it, so 'ride out and find a fight' is a thing the opening of the game can mean." },
  { id: "day-one", label: "The first fight you are allowed",
    view: "card",
    focus: "THE ENCOUNTER CARD FOR THE NEAREST PARTY A LONE WARLORD IS FAVOURED AGAINST, which on the before side is usually a long ride away and on the after side is usually a looter gang over the next dune. Read the header: the small parties are NAMED — LOOTERS, SALT CARAVAN, OASIS PATROL — with the faction underneath, because a party of five called SAND BANDITS is the same nothing as a party of two hundred called SAND BANDITS. The odds, the surrender chance and the hire price on this card are all core's own; nothing here is a new rule." },
];

async function stage(input) {
  const CBZ = window.CBZ;
  const W = CBZ && CBZ.warlord;
  if (!W) return { ok: false, err: "no CBZ.warlord" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  if (W.phase() === "menu" || W.phase() === "boot") W.newGame({ seed: 1337 });
  if (W.phase() !== "campaign" && W.campaign && W.campaign.enter) W.campaign.enter();
  for (let i = 0; i < 300; i++) {
    if (document.getElementById("wlMapBtn")) break;
    await sleep(120);
  }
  await sleep(500);

  const S = W.state;
  const T = W.territory;
  const bands = S.bands || [];

  /* ---- THE NUMBERS, measured off the live campaign state ------------------
     `rideToAFight` is the one the wave exists for. Day-one strength is
     literally W.yourPower() on a fresh game — one man — and "a fight" is
     core's own odds curve saying he is favoured, the same function the
     encounter card prints a percentage from. */
  const mine = W.yourPower();
  let nearest = null, nearD = Infinity, winnable = 0, small = 0, under20 = 0, over100 = 0;
  let anyNear = null, anyD = Infinity;
  let biggest = 0, sizes = [];
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i], n = W.bandSize(b);
    sizes.push(n);
    if (b.kind) small++;
    if (n < 20) under20++;
    if (n >= 100) over100++;
    if (n > biggest) biggest = n;
    const d = Math.hypot(b.x - S.you.x, b.z - S.you.z);
    if (d < anyD) { anyD = d; anyNear = b; }
    if (W.odds(mine, W.bandPower(b)) > 0.6) {
      winnable++;
      if (d < nearD) { nearD = d; nearest = b; }
    }
  }
  /* THE BEFORE SIDE OFTEN HAS NO WINNABLE PARTY AT ALL — that is the finding,
     and a blank frame is a terrible way to state it. So the card falls back to
     the party you would actually walk into: the nearest one, whatever its
     size. On the before side that is a company or a legion and the ATTACK chip
     prints single digits; on the after side it is usually a crew. Same
     question either way — "what happens if I ride at the closest thing?" */
  const card = nearest || anyNear;
  sizes.sort(function (a, b) { return a - b; });
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;

  /* ---- the picture -------------------------------------------------------- */
  if (input.subject.view === "card") {
    /* THE CARD IS army.js's OWN. Reached through the same door the player
       uses — the campaign hands the band to W.army.encounter — rather than
       rendered by this preset, so what is photographed is the shipped screen. */
    // the strategic map is a full-screen overlay and the previous subject left
    // it open — a card underneath it is a card nobody photographed
    if (T && T.close) { try { T.close(); } catch (e) {} }
    await sleep(200);
    if (card && W.army && W.army.encounter) {
      W.setPhase("encounter", { band: card });
      try { W.army.encounter(card); } catch (e) {}
      await sleep(800);
    }
  } else if (T && T.open) {
    T.close();
    T.open({ x: S.you.x, z: S.you.z });
    await sleep(400);
    if (input.subject.view === "focus") {
      /* THE HOLDING THE PLAYER IS STANDING IN, not a random one — the whole
         claim is about what is within a day's ride of where the game put you.
         Same seed both sides, so it is the same holding on both. */
      let pick = null;
      if (T.at) { try { pick = T.at(S.you.x, S.you.z); } catch (e) {} }
      if (!pick && T.regions && T.regions.length) pick = T.regions[0];
      if (pick && T.focus) { T.focus(pick.id != null ? pick.id : pick); await sleep(500); }
    }
    await sleep(500);
  }

  return {
    ok: true,
    nearestName: card ? card.name : null,
    nearestSize: card ? W.bandSize(card) : 0,
    nearestIsWinnable: !!nearest,
    metrics: {
      parties: bands.length,
      smallParties: small,
      partiesUnder20: under20,
      partiesOver100: over100,
      medianParty: median,
      biggestParty: biggest,
      winnableDayOne: winnable,
      rideToAFight: isFinite(nearD) ? Math.round(nearD) : 99999,
      /* WHAT IS ACTUALLY OVER THE NEXT DUNE, and the odds core gives you
         against it. On the before side the nearest party is a company you are
         3% to beat; that number is the game's own, off W.odds. */
      nearestPartyMen: card ? W.bandSize(card) : 0,
      nearestPartyOdds: card ? Math.round(W.odds(mine, W.bandPower(card)) * 100) : 0,
    },
  };
}

export default {
  id: "warlord-smalls",
  title: "Desert Warlord: An Island With Something On It You Can Fight",
  description:
    "The campaign's party sizes came off a power law with a median of 38 and a quarter of its parties over 120 men, on a " +
    "game that starts you alone — so the island was all endgame. This adds a second population of named small parties " +
    "beside it and removes nothing: the same forty power-law parties spawn at the same sizes. Both sides are this " +
    "checkout on seed 1337, so it is the same island, the same coast and the same holdings; ?smalls=0 is the only variable.",
  page: "games/warlord.html",
  defaultBefore: "local",
  beforeParams: { smalls: "0" },
  beforeLabel: "BEFORE · ?smalls=0 (power law only)",
  afterLabel: "AFTER · SMALL PARTIES",
  urlParams: { go: 1, seed: 1337, weather: "off", sound: "off" },
  readyExpression: "!!window.__warlordReady",
  viewport: { width: 1180, height: 760 },
  frameList: ["laptop", "iphone-16:portrait"],
  stageTimeoutMs: 600000,
  pairNote: "Same checkout · same seed · same island · same holdings — ?smalls=0 is the only variable",
  method:
    "The page boots straight into the campaign on seed 1337, so both sides raise the identical 14 km island and place the " +
    "warlord on the identical beach. The map is territory.js's own strategic map, opened through the same call the MAP " +
    "button makes, and the encounter card is army.js's own, reached through the same W.army.encounter door a player walking " +
    "into a party goes through. Every number is read off the live campaign state (S.bands) with core's own W.odds and " +
    "W.bandPower — no distribution is re-implemented here.",
  metricsNote:
    "rideToAFight is the metric this wave exists for: metres from where the game puts you on day one to the nearest party " +
    "core's own odds curve says you are favoured against, at the strength of a man with no army. winnableDayOne is how many " +
    "such parties exist anywhere on the island. partiesOver100 and biggestParty are the guard rails on 'don't deduct any " +
    "from current' — they must not fall, because the power-law population is untouched and only added to.",
  metrics: {
    parties: { label: "Parties on the island", unit: "parties", better: "higher" },
    smallParties: { label: "…of them named small archetypes", unit: "parties", better: "higher" },
    partiesUnder20: { label: "Parties under 20 men", unit: "parties", better: "higher" },
    partiesOver100: { label: "Parties over 100 men (must not fall)", unit: "parties" },
    biggestParty: { label: "The largest army out there (must not fall)", unit: "men" },
    medianParty: { label: "Median party size", unit: "men" },
    winnableDayOne: { label: "Fights a man alone is favoured to win", unit: "parties", better: "higher" },
    rideToAFight: { label: "Ride to the nearest fight you can win", unit: "m", better: "lower" },
    nearestPartyMen: { label: "Men in the nearest party of all", unit: "men" },
    nearestPartyOdds: { label: "Your odds against the nearest party", unit: "%", better: "higher" },
  },
  subjects,
  stage: stage,
};
