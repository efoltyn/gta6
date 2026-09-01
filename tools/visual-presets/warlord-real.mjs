/* DESERT WARLORD — THE PEOPLE THE CARD IS ABOUT ARE ON THE SAND.

   THE REPORT (owner, 2026-09-01): "rn i will get a popup saying theres a guy
   or a group of guys, but often that person isnt actually on the map."

   THE CLAIM UNDER TEST. Twelve of events.js's twenty-one road cards open with
   a person or a party in front of you — deserters by a wrecked truck, a man
   with a crate, an old soldier at his fire, a toll crew with a truck across
   the narrows, a beaten warlord's column, a rider under a white rag, a
   champion walking out ahead of his line — and BEFORE this wave not one of
   them put anybody on the island first. The card was #stage, an opaque
   full-screen panel, and the people in its headline existed as a number.
   AFTER, a people-card CASTS: the party is built by core (real soldiers, real
   guns), pushed onto S.bands so campaign.js draws it and names it, put down on
   the road ahead and held there, and the card is a VERB RAIL docked at the
   bottom of the screen with the men standing behind it. Every choice then acts
   on that party — TAKE THEM ALL walks the men you are looking at into your
   column; GO THROUGH THEM is a battle with the men at the narrows; WALK OUT is
   a real one-on-one against the champion standing there.

   THE HONEST A/B IS TWO CHECKOUTS, NOT A FLAG (repo doctrine since 2026-08-25:
   no flag per feature, git is the undo). The before side is a detached
   worktree of the commit this wave started from, served on its own port; the
   after side is the working tree. Same page, same seed, same 34-man staged
   column, same card fired through the same debug door:

     node ~/harness/ba/before-after.mjs warlord-real \
       --before http://127.0.0.1:8731/ --after http://127.0.0.1:8732/ --no-open

   The one subject that is not a card — "encounter" — is the second half of
   the same complaint: army.js's encounter rail opened on a party that could be
   behind the camera (campaign.js keeps whatever yaw the player last dragged)
   and could be halved or DELETED by the off-screen war while the rail was up.
   The subject rides into a real band from the wrong side and photographs where
   the lens is looking when the rail comes up.

   METRICS are read off the world, never off intentions: castMen is the head
   count of the party the open card is about, counted on S.bands; castDist is
   its distance from you; inFrame projects its position through the live
   camera; stageOn / railOn say which surface the decision is on. Every one of
   those is structurally zero on the before side for the card subjects,
   because there was no party to measure.
*/

async function stageReal(input) {
  const CBZ = window.CBZ;
  if (!CBZ) return { ok: false, err: "no CBZ" };
  /* HARNESS TRAP: this function is serialised and evaluated in the page; it
     closes over nothing at module scope. Helpers live inside. */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 200);
    }
    return false;
  };
  const S0 = window.__wlReal || (window.__wlReal = { booted: false, toasts: 0 });
  if (!S0.booted) {
    if (!await until(() => window.__warlordReady === true, 300000)) return { ok: false, err: "warlord never booted" };
    if (!await until(() => CBZ.warlord && CBZ.warlord.phase() === "campaign", 120000)) return { ok: false, err: "never reached the campaign" };
    await wait(3000);
    S0.booted = true;
    CBZ.warlord.on("toast", function () { S0.toasts++; });
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }
  const W = CBZ.warlord, E = W.events, S = W.state;
  const sub = input.subject;

  const railUp = () => { const v = document.getElementById("verbs"); return !!(v && v.classList.contains("on")); };
  const stageUp = () => { const s = document.getElementById("stage"); return !!(s && s.classList.contains("on")); };
  const closeAll = async () => {
    try { E.close(); } catch (_) {}
    // clean sand between subjects (after only; the before build has nothing to strike)
    try { if (E.clearStage) E.clearStage(); } catch (_) {}
    try { if (CBZ.warlordCtx && CBZ.warlordCtx.closeVerbs) CBZ.warlordCtx.closeVerbs(); } catch (_) {}
    try { if (CBZ.warlordCtx && CBZ.warlordCtx.closeScreen) CBZ.warlordCtx.closeScreen(); } catch (_) {}
    await wait(400);
  };
  const inFrame = (x, z) => {
    try {
      const T = CBZ.THREE || window.THREE;
      const y = W.desert.heightAt(x, z) + 1.4;
      const v = new T.Vector3(x, y, z).project(CBZ.camera);
      return (v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1) ? 1 : 0;
    } catch (_) { return 0; }
  };

  let watched = null;               // the band a subject is about, for inFrame/held
  if (sub.card) {
    await closeAll();
    /* the same debug door on both sides. After: casts inside reach and opens
       the rail with the men behind it. Before: the full-screen card. */
    try { E.fire(sub.card); } catch (_) {}
    /* a rider (defector) walks in from 240 m — the card is his arrival, so
       the wait is his walk. Everything else is up on the frame. */
    await until(() => railUp() || stageUp(), sub.card === "defector" ? 120000 : 15000, 300);
    // the lens damps toward the party; the near rigs are built one per frame
    await wait(sub.settle || 3500);
    try { const c = E.cast ? E.cast() : null; if (c && c.castBands) { const bs = S.bands.filter((b) => b.cast === sub.card || b.held); watched = bs[0] || null; } } catch (_) {}
  } else if (sub.id === "encounter") {
    await closeAll();
    /* RIDE INTO A REAL PARTY FROM ITS BLIND SIDE. Nearest band with a real
       roster; the camera is first turned to look AWAY from it, then the
       warlord is stood 22 m from it so campaign.js's own contact test opens
       the rail on the next frame. What the frame shows is where the lens is
       looking when the rail arrives. */
    let best = null, bd = 1e18;
    for (let i = 0; i < S.bands.length; i++) {
      const b = S.bands[i];
      if (!b.men || b.men.length < 6 || b.cast || b.held || b.joining) continue;
      const d = Math.hypot(b.x - S.you.x, b.z - S.you.z);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) {
      watched = best;
      best.cooldown = 0;
      const a = Math.atan2(best.x - S.you.x, best.z - S.you.z);
      // stand 22 m short of them on the line you came in on, looking the other way
      S.you.x = best.x - Math.sin(a) * 22; S.you.z = best.z - Math.cos(a) * 22;
      S.you.yaw = a + Math.PI;
      try { W.campaign.camYaw(a + Math.PI); W.campaign.camDist(40); } catch (_) {}
      await until(() => railUp(), 20000, 200);
      await wait(2600);
    }
  }

  let c = {};
  try { c = E.cast ? E.cast() : {}; } catch (_) {}
  const m = {
    castMen: c.castMen || 0,
    castDist: c.castDist || 0,
    partiesOnMap: c.castBands || 0,
    railOn: railUp() ? 1 : 0,
    stageOn: stageUp() ? 1 : 0,
    inFrame: watched ? inFrame(watched.x, watched.z) : (c.inFrame || 0),
    held: watched && watched.held ? 1 : 0,
    toasts: S0.toasts,
  };
  const keys = sub.report || Object.keys(m);
  const out = {};
  for (let i = 0; i < keys.length; i++) out[keys[i]] = m[keys[i]];
  return { ok: true, metrics: out, note: (c.card || c.pending || "") + (watched ? " · " + watched.name + " " + watched.men.length : "") };
}

export default {
  id: "warlord-real",
  title: "Desert Warlord: The People the Card Is About",
  description:
    "Eight moments where the game tells you about a man or a party. Before: a full-screen card over " +
    "an island with nobody new on it. After: the party is on the road, the decision is a rail docked " +
    "under it, and every choice acts on the men you can see.",
  page: "games/warlord.html",
  viewport: { width: 1180, height: 700 },
  /* event=list is the debug door's no-op card: it stages the 34-man column
     (the state-reading cards want a roster) and fires nothing */
  urlParams: { go: 1, seed: 1337, sound: "off", weather: "off", event: "list", stage: 34 },
  readyExpression: "!!(window.CBZ && window.CBZ.warlord)",
  stageTimeoutMs: 600000,
  beforeLabel: "BEFORE · b0566c8 — a card about people, and no people",
  afterLabel: "AFTER · the party is cast on the road; the card is a rail under it",
  pairNote: "Two checkouts of the same page · seed 1337 · same 34-man column · same card through the same door",
  defaultFocus: "Is the man the card is talking about standing on the sand behind the decision?",
  method:
    "games/warlord.html boots ?go=1 onto the island with events.js's ?stage=34 column. Each card " +
    "subject calls E.fire(id), the file's own debug door. On the before checkout that opens the " +
    "full-screen #stage card; on the after checkout the door casts the card's party inside 38 m and " +
    "opens the verb rail. The encounter subject teleports the warlord 22 m from the nearest real band " +
    "with the camera turned away and lets campaign.js's own contact test open army.js's rail. Numbers " +
    "come from W.events.cast() (S.bands and the live camera) and the DOM.",
  metricsNote:
    "castMen is the roster of the party the open card is about, counted on S.bands — structurally zero " +
    "before, because no such party was ever built. castDist is how far it is standing from you. inFrame " +
    "projects it through the live camera. stageOn is the opaque full-screen panel; railOn is the docked " +
    "verb strip with the world visible behind it. held is army.js/events.js's flag that stops the " +
    "off-screen war moving or deleting the party while you are deciding.",
  metrics: {
    castMen: { label: "Men the card is about, standing on the sand", unit: "men", better: "higher" },
    partiesOnMap: { label: "Parties the card is about, on the island", unit: "parties", better: "higher" },
    castDist: { label: "How far they are standing from you", unit: "m" },
    inFrame: { label: "…and the camera is looking at them", unit: "0/1", better: "higher" },
    railOn: { label: "Decision is a rail under the world", unit: "0/1", better: "higher" },
    stageOn: { label: "Decision is an opaque full-screen card", unit: "0/1", better: "lower" },
    held: { label: "The party is held while you decide", unit: "0/1", better: "higher" },
    toasts: { label: "Sentences typed at you so far", unit: "toasts" },
  },
  subjects: [
    { id: "deserters", card: "deserters", label: "MEN WITH NO FLAG — deserters by a wrecked truck",
      report: ["castMen", "castDist", "inFrame", "railOn", "stageOn", "held"],
      focus: "The card the owner meets most. AFTER: a real DESERTERS party (core's own archetype) sits by a wrecked truck on the road, the rail under them says what they want, and TAKE THEM ALL walks THESE men into your column. BEFORE: an opaque panel and a number." },
    { id: "runner", card: "runner", label: "A MAN WITH A CRATE — the sentence CONTRACT.md quotes",
      report: ["castMen", "castDist", "inFrame", "railOn", "stageOn"],
      focus: "\"Man with a crate popup with no man there\" is the repo's own quote for this bug class. AFTER: two men and a stack of crates on the road." },
    { id: "oldman", card: "oldman", label: "AN OLD SOLDIER — at the fire the card always mentioned",
      report: ["castMen", "castDist", "inFrame", "railOn", "stageOn"],
      focus: "One veteran with his good rifle and a lit fire beside him (props.js's own fire, which this file already used elsewhere and never here)." },
    { id: "toll", card: "toll", label: "A TOLL AT THE NARROWS — the men are there before you choose",
      report: ["castMen", "castDist", "inFrame", "railOn", "stageOn", "held"],
      focus: "BEFORE, the tollmen were spawned AFTER you chose to go through them. AFTER they are sitting at the narrows with a truck across it when the question is asked, and GO THROUGH THEM is a battle against exactly those men." },
    { id: "column", card: "column", label: "A COLUMN ON A CHAIN — the guards and the chained men, two parties",
      report: ["castMen", "partiesOnMap", "castDist", "inFrame", "railOn", "stageOn"],
      focus: "Two parties: THE SLAVERS with rifles and THE CHAIN nine metres behind them, unarmed. CUT THEM LOOSE fights the first and the second falls in." },
    { id: "duel", card: "duel", label: "HE WANTS YOU, NOT YOUR ARMY — the champion out ahead of his line",
      report: ["castMen", "partiesOnMap", "castDist", "inFrame", "railOn", "stageOn"],
      focus: "The line ninety metres out and THEIR CHAMPION eighteen metres in front of it. WALK OUT is now battle.js's solo fight — you against him, nobody routs — instead of W.chance(p) and a sentence." },
    { id: "rival", card: "rival", label: "A WARLORD WITH A HOLE IN HIM — and his column around him",
      report: ["castMen", "castDist", "inFrame", "railOn", "stageOn"],
      focus: "The wounded warlord is men[0] of a real column at a third of his health. LET HIM GO walks his men across and he rides off alone; PUT HIM DOWN and his men come at you now, instead of a hint reading THEY FIGHT HARDER with nothing behind it." },
    { id: "encounter", label: "The encounter rail, met from the blind side",
      report: ["inFrame", "held", "railOn", "stageOn"],
      focus: "Not a card: army.js's own meeting rail, opened by riding into a real band with the camera pointed the other way. AFTER: the lens turns to the party as the rail comes up and the party is HELD — campaign.js's off-screen war can no longer halve or delete the band whose card you are reading. BEFORE: the rail over an empty dune, the men behind the camera." },
  ],
  stage: stageReal,
};
