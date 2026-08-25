/*
  prison-contracts.mjs — somebody else's debt becomes your errand.

  THE CLAIM THIS PROVES. Before this wave the prison's only debts ran between
  the PLAYER and a gang: a faceless number that a collector quoted at you. The
  yard itself owed nothing to anybody. PRISON_CONTRACTS (entities/ai.js) adds
  the pairwise ledger — who owes who, how much, for what, since when — and the
  work that a sour claim turns into: a man hands you HIS collection, names the
  debtor, names the place, names your cut, and every way of finishing it is a
  verb the game already had (walk up to him, pick his pocket, put him down).

  THE HONEST A/B. Both sides serve THIS checkout and differ only by
  ?cfg_PRISON_CONTRACTS=0, so every pixel that moves is the flag:

    node tools/visual-compare.mjs --preset prison-contracts \
      --before local --before-params "cfg_PRISON_CONTRACTS=0" \
      --out artifacts/prison-econ-wave/contracts

  With the flag off, the same staging calls all no-op (ai.js's addTab/offer
  return null behind contractsOn()), so the BEFORE side is the pre-wave prison
  answering the same three moments: a generic card, a man with nothing to say,
  and no way at all to hand anything back.

  STAGING FACTS (static read 2026-08-24):
  - actors: CBZ.npcs, position on n.group.position, identity on n.data.name.
    "Mack" (Reds collector, greed .78) and "Dice" (Blues runner) are authored
    roster members in entities/npc.js, which is why the pitch can name them.
  - a tab needs ~95 s of yard time to ripen; CBZ.prisonContract.seed() books
    one already aged, so what is photographed is the real row, not a mock.
  - the card is #interact (.iopt rows, #interactName, #interactNote); speech is
    #pinteractSay (.pi-subtitle-line), interact.js's one mouth.
  - rigs face local -Z, so the camera yaw is atan2(-vx, -vz) toward the actor.
*/

const FRAMES = ["laptop", "ipad-mini:landscape"];

export default {
  id: "prison-contracts",
  title: "Prison — a man hands you his collection",
  description:
    "Three moments of the contract layer: the creditor's pitch, the cornered debtor's counter-offer, " +
    "and settling up. Both sides are this checkout; only ?cfg_PRISON_CONTRACTS differs.",
  frameList: FRAMES,
  urlParams: { seed: 41773 },
  defaultBefore: "local",
  /* AN OBJECT, NOT A STRING — and the tool will not tell you if you get it
     wrong. visual-compare.mjs does Object.entries(preset.beforeParams), while
     the CLI's --before-params takes the "k=v&k2=v2" STRING form. Handing the
     string shape to this field spreads it CHARACTER BY CHARACTER into the
     query (?0=c&1=f&2=g&...) instead of erroring; the run still works only
     because the CLI flag happened to be passed too. */
  beforeParams: { cfg_PRISON_CONTRACTS: 0 },
  beforeLabel: "BEFORE · PRISON_CONTRACTS=0",
  afterLabel: "AFTER · contracts on",
  stageTimeoutMs: 420000,
  readyExpression:
    "document.getElementById('playBtn') && document.querySelector('.mode-btn[data-mode=\"escape\"]')",
  pairNote:
    "Same checkout, same seed, same two named men, same three beats — the flag is the only variable",
  defaultFocus:
    "Does a person tell you who owes what, since when, and where to find him — or does the card just offer the usual four verbs?",
  subjects: [
    {
      id: "creditor-pitch",
      label: "Mack hands over the claim",
      focus:
        "AFTER: a COLLECT row on his card and his own voice naming Dice, the nine, store day, the place and your cut. BEFORE: insult / talk / steal, and silence.",
    },
    {
      id: "debtor-cornered",
      label: "Dice, cornered",
      focus:
        "AFTER: walking inside three metres of the man you were sent after IS the trigger — he counters with what is actually in his pocket. BEFORE: he has no idea who you are.",
    },
    {
      id: "settle-row",
      label: "Back to Mack, holding it",
      focus:
        "AFTER: the head slot becomes SETTLE, the chip counts what you actually pulled off Dice, the note says so. BEFORE: there is no such row anywhere in the game.",
    },
    {
      id: "settle-paid",
      label: "He counts it",
      focus:
        "The payout, one press later: he says what came back, the cut stays in your pocket, his respect moves. " +
        "The contract row is correctly GONE here — it was spent — so read the spoken line, not the row count.",
    },
    {
      id: "workoff",
      label: "The symmetry — you owe, so you work",
      focus:
        "You are broke and the Reds' book has you down for 22. AFTER: the collector's middle button is WORK, " +
        "and he names a man who owes the crew. BEFORE: pay what you don't have, haggle, or refuse.",
    },
  ],
  metrics: {
    contractRow: { label: "Contract row on the card", unit: "1=yes", better: "higher" },
    spokenChars: { label: "Words a present man actually says", unit: "chars", better: "higher" },
    namesTarget: { label: "The debtor is named on screen", unit: "1=yes", better: "higher" },
    verbCount: { label: "Options on screen (owner's law: 3 max)", unit: "rows", better: "lower" },
    noteChars: { label: "Card note line", unit: "chars", better: "higher" },
  },
  metricsNote:
    "contractRow counts COLLECT/SETTLE/WORK and the accept-row of a contract or debtorDodge approach. " +
    "spokenChars reads #pinteractSay's live line — the prison's one speech surface — so a beat that " +
    "nobody speaks scores zero by construction, which is the point.",

  stage: async function stagePrisonContracts(input) {
    const CBZ = window.CBZ;
    if (!CBZ) return { ok: false, err: "no CBZ" };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test, budgetMs, stepMs) => {
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) {
        try { if (test()) return true; } catch (_) {}
        await wait(stepMs || 250);
      }
      return false;
    };

    let S = window.__prisonContractSeq;
    if (!S) {
      const booted = await until(
        () => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
          document.querySelector('.mode-btn[data-mode="escape"]'),
        300000
      );
      if (!booted) return { ok: false, err: "never booted" };
      document.querySelector('.mode-btn[data-mode="escape"]').click();
      await wait(250);
      const playing = await until(() => {
        if (CBZ.game.state === "playing") return true;
        const b = document.getElementById("playBtn");
        if (b) b.click();
        return CBZ.game.state === "playing";
      }, 180000, 300);
      if (!playing) return { ok: false, err: "never reached playing" };
      // systems/bootprogress.js's card dismisses itself on an rAF-driven timer
      // and the next line freezes rAF — without this every shot is of the
      // loading screen sitting over a live HUD.
      try { if (CBZ.bootMeter && CBZ.bootMeter.hide) CBZ.bootMeter.hide(); } catch (_) {}
      try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
      window.requestAnimationFrame = function () { return 0; };
      await wait(600);
      for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
      S = window.__prisonContractSeq = {};
      window.__cbzVisualCompare = {
        render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
      };
    }

    // ---- determinism ---------------------------------------------------------
    // economy.js's rng is a seeded LCG re-seeded from Math.random(), so pinning
    // Math.random and reseeding pins every roll this preset can touch: which
    // job the claim becomes, what is in a man's pockets, whether a lift lands.
    let _s = 1337;
    Math.random = function () { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 4294967296; };
    try { if (CBZ.econ && CBZ.econ.reseed) CBZ.econ.reseed(); } catch (_) {}

    const step = (secs) => {
      const n = Math.max(1, Math.round(secs * 60));
      for (let i = 0; i < n; i++) {
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        CBZ.stepSim(1 / 60);
        if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
      }
    };
    const posOf = (a) => (a && a.group && a.group.position) || (a && a.pos) || null;
    const byName = (want) => (CBZ.npcs || []).find(
      (n) => n && n.data && n.data.name && n.data.name.replace(/^the |^a |^an /, "") === want
    );
    const P = CBZ.player;
    if (!P || !P.pos) return { ok: false, err: "no player" };

    /* EVERY SUBJECT STARTS FROM THE SAME YARD. Subjects share one page, so a
       claim seeded for beat (a) would still be sitting on Mack's ledger during
       beat (c) and the pictures would drift apart from each other. */
    const resetYard = () => {
      try { CBZ.game.contract = null; } catch (_) {}
      for (const n of CBZ.npcs || []) {
        if (!n) continue;
        n._tabs = null;
        n.standingOffer = null;
        n.approachCD = 0;
        n.playerGrudge = 0; n.playerFear = 0; n.huntPlayer = 0;
        if (n.approach && CBZ.clearNpcApproach) CBZ.clearNpcApproach(n);
        else n.approach = null;
        if (n.aiState === "approachPlayer" || n.aiState === "fight") { n.aiState = "wander"; n.foe = null; }
      }
      CBZ.game.cigs = 20;
      if (CBZ.el && CBZ.el.cigText) CBZ.el.cigText.textContent = 20;
    };

    /* NOBODY ELSE TALKS DURING THE SHOT. ai.js allows exactly one live
       approach in the prison at a time (playerApproachBusy), which is right —
       and it ate the first cornering run: while the player walked the six
       metres to Dice, a passing inmate opened a stash-cover pitch, so the
       corner never fired and the picture was of somebody else's sales patter.
       That interruption is real behaviour and stays in the game; it just isn't
       what this pair is a claim about. */
    const hushOthers = (except) => {
      for (const n of CBZ.npcs || []) {
        if (!n || n === except) continue;
        if (n.approach && CBZ.clearNpcApproach) CBZ.clearNpcApproach(n);
        else n.approach = null;
        n.standingOffer = null;
        n.approachCD = 60;
        if (n.aiState === "approachPlayer") { n.aiState = "wander"; n.aiTimer = 0.2; }
      }
      for (const g of CBZ.guards || []) if (g && g.approach) g.approach = null;
      if (except) except.approachCD = 0;
    };

    const creditor = byName("Mack") || byName("Red Hook");
    const debtor = byName("Dice") || byName("Stone");
    if (!creditor || !debtor) return { ok: false, err: "roster actors missing" };

    /* THE CARD MUST BE ON THE MAN THIS PAIR IS ABOUT. interact.js's nearest()
       is pure distance on everything walkable, and the tablet frames of one
       full run came back with the card open on PEEP and on a nameless inmate —
       two bodies who happened to wander inside the player's radius during the
       half-second settle. Nothing about the layer changed; the photograph was
       just of somebody else. So every other body within seven metres is walked
       back out to fourteen before the shot. */
    const clearRoom = (keep) => {
      const pp = P.pos;
      const shove = (n) => {
        if (!n || n === keep || !n.group) return;
        const dx = n.group.position.x - pp.x, dz = n.group.position.z - pp.z;
        if (Math.hypot(dx, dz) > 7) return;
        const ang = Math.atan2(dz || 0.01, dx || 0.01);
        const nx = pp.x + Math.cos(ang) * 14, nz = pp.z + Math.sin(ang) * 14;
        n.group.position.set(nx, n.group.position.y, nz);
        if (n.target && n.target.set) n.target.set(nx, 0, nz);
      };
      for (const n of CBZ.npcs || []) shove(n);
      for (const g of CBZ.guards || []) shove(g);
    };

    // stand at arm's length, facing him — rigs face local -Z
    const standAt = (a) => {
      const ap = posOf(a);
      if (!ap) return;
      P.pos.set(ap.x + 1.4, ap.y, ap.z);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
      const vx = ap.x - P.pos.x, vz = ap.z - P.pos.z;
      if (CBZ.cam) CBZ.cam.yaw = Math.atan2(-vx, -vz);
    };

    const CT = CBZ.prisonContract || null;
    const on = !!(CT && CT.on && CT.on());          // false on the BEFORE side
    const id = input.subject.id;

    resetYard();
    /* THE DEBTOR IS PARKED SIX METRES OFF, NOT THREE. First run of this preset
       put him at 3.4 and the BEFORE side photographed HIM instead of the
       creditor: with the flag on, interact.js's nearest() prefers the man with
       a live approach, and with the flag off there is no approach, so pure
       distance won and the pair disagreed about who was on screen. Six metres
       makes the creditor unambiguously nearest on BOTH sides, and still leaves
       the debtor a short walk away for the cornering beat. */
    const home = posOf(creditor);
    if (home && posOf(debtor)) {
      debtor.group.position.set(home.x + 6.0, posOf(debtor).y, home.z + 2.4);
      debtor.target.set(home.x + 6.0, 0, home.z + 2.4);
    }
    step(0.4);

    let live = null;
    // The claim itself. Booked on the CREDITOR for the four collection beats;
    // the symmetry beat deliberately books it on a CREWMATE instead — see there.
    if (on && id !== "workoff") CT.seed(creditor, debtor, { amt: 9, why: "store day" });

    if (id === "workoff") {
      /* THE DEEP CUT: your own tab turning into somebody else's collection.
         Staged the way it actually happens — you are broke, the Reds' book has
         you down for more than you are carrying, and the collector who walks
         over has a crew claim to send you after instead of a beating.

         The tab is seeded on RED HOOK, not on Mack: a man holding his own ripe
         claim pitches a CONTRACT (that is the first beat of this preset), so
         to reach the work-it-off leg the claim has to belong to the crew and
         not to the collector. That is the "Dice owes us too" line, literally.

         And the pitch is an ARRIVAL: the player waits eight metres out until
         Mack decides to come over, because interact.js only speaks an
         approach's long pitch when the focused actor CHANGES (autoListen). A
         demand raised while you are already stood at the card is silent — a
         real gap, pre-existing, and one the contract offers route around by
         speaking for themselves (ai.js's offerContract). */
      const crew = byName("Red Hook") ||
        (CBZ.npcs || []).find((n) => n !== creditor && n.gang === creditor.gang && n !== debtor);
      if (on && crew) CT.seed(crew, debtor, { amt: 7, why: "the domino game" });
      CBZ.game.cigs = 3;
      if (CBZ.el && CBZ.el.cigText) CBZ.el.cigText.textContent = 3;
      if (CBZ.game.gangProtection) CBZ.game.gangProtection[creditor.gang] = 0;
      if (CBZ.addGangDebt) CBZ.addGangDebt(creditor.gang, 22);
      const ap = posOf(creditor);
      /* WAITING FOR A DIE TO COME UP NEEDS THE WORLD HELD STILL. The first run
         of this beat stood eight metres out for thirty sim-seconds and came
         back with a photograph of a GUARD shouting "You're mine, inmate!" —
         detection had climbed the whole time, a thief had emptied the pockets
         the demand is priced against, and Mack had rolled a turf job and
         parked it as a standing offer, which then blocked every later roll.
         So each iteration re-pins the four things the debt-collect branch in
         ai.js actually reads (distance, cigs, debt, no other business). */
      for (let i = 0; i < 220; i++) {
        P.pos.set(ap.x + 8, ap.y, ap.z);
        if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
        CBZ.game.detection = 0; CBZ.game.wanted = 0; CBZ.game.gangJob = null;
        CBZ.game.cigs = 3;
        if (CBZ.el && CBZ.el.cigText) CBZ.el.cigText.textContent = 3;
        if (CBZ.game.gangProtection) CBZ.game.gangProtection[creditor.gang] = 0;
        if (CBZ.gangDebt && CBZ.gangDebt(creditor.gang) < 20 && CBZ.addGangDebt) {
          CBZ.addGangDebt(creditor.gang, 22 - CBZ.gangDebt(creditor.gang));
        }
        hushOthers(creditor);
        creditor.standingOffer = null;
        // A collector needs a REASON to come over, and ai.js's readiest one is
        // having heard the block talking about your tab. rememberBlockRead is
        // the same call gossip makes; without it this beat is a bare 2-7% die
        // per tick and one frame of the full run rolled 27 sim-seconds of
        // nothing and photographed his market stall instead.
        if (CBZ.rememberBlockRead) CBZ.rememberBlockRead(creditor, "debt", 90, "gossip");
        /* HOLD OUT FOR THE OFFER WE CAME TO PHOTOGRAPH. Breaking on any
           debtCollect was not enough: one frame of the full run caught a
           collection demand raised in a tick where the work-it-off gate had
           not yet resolved, and the pair printed as no-change. So a demand
           without the WORK leg on it is discarded and he is asked again. */
        const ap2 = creditor.approach;
        if (ap2 && (ap2.kind !== "debtCollect" || !ap2.workOff)) {
          if (CBZ.clearNpcApproach) CBZ.clearNpcApproach(creditor); else creditor.approach = null;
          creditor.standingOffer = null;
          creditor.approachCD = 0;
        }
        step(0.3);
        if (creditor.approach && creditor.approach.kind === "debtCollect" &&
            (creditor.approach.workOff || !on)) break;
      }
      /* HEAR THE LONG VERSION. A collector who has already reached you has
         `greeted` set (ai.js's approachPlayer greet block), and interact.js
         skips autoListen on a greeted approach — so the four-clause answer,
         the one that names the man who owes the crew, is only reachable by
         walking up to him mid-jog or returning to a standing offer. Both are
         real; clearing the flag here reproduces exactly that arrival rather
         than inventing anything. His SHORT opener now carries the offer too
         (approachText's debtCollect branch), which is the fix for the players
         who never hit that window. */
      if (creditor.approach) creditor.approach.greeted = false;
      standAt(creditor);
      clearRoom(creditor);
      step(0.25);                     // card opens → autoListen speaks his demand
    } else if (id === "creditor-pitch") {
      hushOthers(creditor);
      standAt(creditor);
      step(0.5);                       // card opens on him
      if (on) live = CT.offer(creditor, null, "collect");
      standAt(creditor);
      clearRoom(creditor);
      step(0.3);                       // panel re-renders into the offer menu
    } else if (id === "debtor-cornered") {
      hushOthers(creditor);
      standAt(creditor);
      step(0.4);
      if (on) {
        live = CT.offer(creditor, null, "collect");
        if (live && CBZ.resolveNpcApproach) CBZ.resolveNpcApproach(creditor, "accept");
      }
      step(0.3);
      /* NOW GO AND FIND HIM — and KEEP finding him.
         Dice is the fastest body in the yard (speed 2.75) and he does not
         stand still while you cross to him. A single standAt + one long step
         put the player beside where he USED to be: the full run came back with
         a plain trade card because he had drifted past the 3.2 m corner
         radius. Re-closing every 0.2 s is the honest version of walking a man
         down, and it breaks the instant he turns round with his excuse. */
      for (let i = 0; i < 25; i++) {
        hushOthers(debtor);
        standAt(debtor);
        step(0.2);
        if (debtor.approach && debtor.approach.kind === "debtorDodge") break;
      }
      standAt(debtor);
      clearRoom(debtor);
      step(0.25);
    } else {
      // both settle beats: take the job, do the work, come back holding it
      hushOthers(creditor);
      standAt(creditor);
      step(0.4);
      if (on) {
        live = CT.offer(creditor, null, "collect");
        if (live && CBZ.resolveNpcApproach) CBZ.resolveNpcApproach(creditor, "accept");
        const c = CT.live();
        if (c) {
          // what a pickpocket / gunpoint rob / his own partial would have
          // banked — creditCollected's field, filled the way play fills it
          c.got = c.amt;
          CBZ.game.cigs = 20 + c.amt;
          if (CBZ.el && CBZ.el.cigText) CBZ.el.cigText.textContent = CBZ.game.cigs;
        }
      }
      hushOthers(creditor);
      // and he stays quiet about his OWN business — without this he opens a
      // stash-cover pitch on both sides and the settle row never gets a card
      creditor.approachCD = 90;
      standAt(creditor);
      clearRoom(creditor);
      step(0.3);
      if (id === "settle-paid") {
        if (on && CT.settle) CT.settle(creditor);
        standAt(creditor);
        clearRoom(creditor);
        step(0.25);
      }
    }

    // ---- measure -------------------------------------------------------------
    const vis = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight;
    };
    const desktopRows = Array.from(document.querySelectorAll("#interact .iopt")).filter(vis);
    const touchRows = Array.from(
      document.querySelectorAll("#pinteract .pi-action, #pinteract .tpill, #pinteract [data-pi]")
    ).filter(vis);
    const rows = touchRows.length ? touchRows : desktopRows;
    const rowsText = rows.map((r) => (r.innerText || "").trim());

    const sayEl = document.getElementById("pinteractSay");
    const sayLine = sayEl && vis(sayEl) ? (sayEl.querySelector(".pi-subtitle-line") || {}).innerText || "" : "";
    const noteEl = document.getElementById("interactNote");
    const noteText = noteEl ? (noteEl.innerText || "") : "";
    const nameEl = document.getElementById("interactName");
    const cardName = nameEl ? (nameEl.innerText || "").trim() : "";

    /* ASK THE GAME WHO THE CARD IS ABOUT, don't guess from the label. The first
       run scored contractRow 0 on the AFTER side of a card that plainly read
       ACCEPT / HAGGLE / REFUSE over a contract pitch — because the desktop row
       is the bare verb ("Accept") and the sentence naming the job lives in the
       aria-label. So the test is the STATE: either a contract verb is on the
       card, or the man it is open on is mid-contract-pitch. */
    const shown = (CBZ.npcs || []).find(
      (n) => n && n.data && n.data.name &&
        n.data.name.replace(/^the |^a |^an /, "").toUpperCase() === cardName
    );
    const shownKind = shown && shown.approach ? shown.approach.kind : "";
    /* NO CLOSING WORD BOUNDARY. The tablet rail concatenates the one-word
       label and its chip with no separator — "SETTLE9 of 9", "WORKoff the
       tab" — so /\bsettle\b/ scored 0 on frames whose pixels plainly show the
       button. Match the label as a PREFIX, which is what it is. */
    const rowWords = rowsText.join(" ").toLowerCase();
    const contractRow =
      (/\b(collect|settle|work)/.test(rowWords) ||
        shownKind === "contract" || shownKind === "debtorDodge") ? 1 : 0;
    const screen = (rowWords + " " + sayLine + " " + noteText).toLowerCase();
    const debtorName = (debtor.data.name || "").replace(/^the |^a |^an /, "").toLowerCase();
    const namesTarget = debtorName && screen.indexOf(debtorName) >= 0 ? 1 : 0;

    return {
      ok: true,
      frame: input.frame ? input.frame.id : null,
      touch: document.body.classList.contains("touch"),
      flagOn: on,
      card: cardName,
      creditor: creditor.data.name,
      debtor: debtor.data.name,
      job: live ? `${live.kind} ${live.amt} (${live.why})` : "",
      pitch: creditor.approach ? creditor.approach.kind : "",
      workLeg: !!(creditor.approach && creditor.approach.workOff),
      gangDebt: CBZ.gangDebt ? CBZ.gangDebt(creditor.gang) : null,
      cigs: CBZ.game.cigs,
      audit: CT && CT.audit ? CT.audit() : null,
      rowsText,
      spoken: sayLine.trim(),
      note: noteText.trim(),
      metrics: {
        contractRow,
        spokenChars: sayLine.replace(/\s+/g, " ").trim().length,
        namesTarget,
        verbCount: rows.length,
        noteChars: noteText.replace(/\s+/g, " ").trim().length,
      },
    };
  },
};
