/*
  prison-phone-bridge.mjs — WHAT CIGARETTES CANNOT BUY.

  A flag A/B on PRISON_PHONE_BRIDGE (systems/economy.js). Both sides serve
  from THIS checkout; the before side is the same build with
  ?cfg_PRISON_PHONE_BRIDGE=0, so the only difference in the pair is the rule
  under test rather than every commit since a deploy.

  THE CLAIM BEING PHOTOGRAPHED. A corrections officer does not end his career
  for tobacco. Staff corruption runs on OUTSIDE money — the inmate's people
  pay the officer's people — while the bottom rung (a moment of blindness, a
  soft count) really does run on in-kind goodwill. So cigarettes stay the
  game's one currency, and the BURNER PHONE becomes the bridge: reaching the
  street at all is an item capability, not a second wallet.

  Three beats, each one shot, each staged identically on both sides:

    1  payoff-no-phone   A bent officer walks up with a clean-sheet offer and
                         the player presses PAY holding nothing but smokes.
                         BEFORE: the sale goes through. AFTER: he explains,
                         once, why tobacco is not the instrument.
    2  phone-rental      A dealer's stock, asked for through the real door
                         (econ.pickOffer, up to 400 draws). BEFORE: the pool
                         cannot produce a service at all — serviceInPool 0.
                         AFTER: PHONE TIME, and the terms he sells it on.
    3  racket-cut-phone  The rented window open, the same man's racket cut
                         bought. BEFORE and AFTER both sell it; the AFTER
                         line is the once-a-run honest one about where the
                         money actually went.

  Staging facts (read 2026-08-25):
  - CBZ.guards[3] and [5] are the shipped bent officers (entities/guards.js:107)
  - CBZ.startGuardPayoffApproach(g, kind) arms an approach; the menu then
    offers "pay", which is the reachable player route into the deep services.
    (The bare PAYOFF verb is NOT reachable in escape mode — see the report:
    systems/interact.js:558 gates it on g.heat/g.detect/a.racketDebt, none of
    which exist in the prison.)
  - a._verbs is stamped by interact.js's render(); CBZ.doInteract(idx) is the
    same entry point a keypress and a touch button use.
  - the spoken answer lands in .pi-subtitle-line and is held by tickSay(dt),
    which runs off the frame loop — frozen rAF means the line stays up.
*/

export default {
  id: "prison-phone-bridge",
  title: "Prison — staff corruption priced honestly",
  description:
    "PRISON_PHONE_BRIDGE on/off, same checkout, same seed. Deep staff services " +
    "(clean sheet, racket cut, bought statement, a name off the log) now need a " +
    "line to the street; the moments of blindness stay priced in smokes.",
  page: "index.html",
  urlParams: { seed: 90210 },
  defaultBefore: "local",
  beforeParams: { cfg_PRISON_PHONE_BRIDGE: 0 },
  beforeLabel: "BEFORE · cigs buy everything",
  afterLabel: "AFTER · the phone is the bridge",
  // THE KEY IS `viewport`, NOT `width`/`height`. Top-level width/height on a
  // preset are read by nothing (visual-compare.mjs:204 reads
  // args.width || preset.viewport?.width || 960) and fail SILENTLY — the run
  // just prints "custom 960x600" and carries on.
  viewport: { width: 960, height: 600 },
  stageTimeoutMs: 420000,
  readyExpression:
    "document.getElementById('playBtn') && document.querySelector('.mode-btn[data-mode=\"escape\"]')",
  pairNote:
    "Same officer, same cigarettes, same heat on the sheet — PRISON_PHONE_BRIDGE is the only variable",
  defaultFocus:
    "Does the refusal TEACH (rather than just block), and does the money read as coming from outside?",
  subjects: [
    {
      id: "payoff-no-phone",
      label: "The clean sheet, holding only smokes",
      focus:
        "Before: a career-ending favour bought with tobacco. After: the once-per-officer explanation of why it is not.",
    },
    {
      id: "phone-rental",
      label: "Renting ten minutes on a handset",
      focus:
        "Is PHONE TIME actually reachable through the real stock pool, and does the seller state his terms?",
    },
    {
      id: "racket-cut-phone",
      label: "The racket cut, with the window open",
      focus:
        "The rented line lets the deep service through — and the officer says once where the money really landed.",
    },
  ],
  metrics: {
    phoneAccess: { label: "Player can reach the street", unit: "1=yes", better: "higher" },
    deepSale: { label: "Deep service actually transacted", unit: "1=yes", better: "higher" },
    cigsSpent: { label: "Cigarettes that left the pocket", unit: "cigs", better: "lower" },
    serviceInPool: { label: "Stock pool can produce PHONE TIME", unit: "1=yes", better: "higher" },
    lineChars: { label: "Length of what the officer said", unit: "chars", better: "higher" },
    /* THE SECOND DEFECT, MEASURED. entities/guards.js used to quote its own
       payoff price on the card and then let systems/economy.js charge a
       different one — and haggling a payoff moved only the chip. Quoted minus
       taken, on any beat where money actually moved, must be zero. */
    quoteGap: { label: "Price quoted minus price taken", unit: "cigs", better: "lower" },
  },
  metricsNote:
    "cigsSpent is measured across the press. serviceInPool draws econ.pickOffer up to 400 " +
    "times and asks whether a service ever comes out. quoteGap is 0 on a beat where nothing was sold.",

  stage: async function stagePhoneBridge(input) {
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

    let S = window.__phoneBridgeSeq;
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
      // The boot card is a full-screen flex panel dismissed on a rAF-driven
      // timer, and the very next line freezes rAF — put it away by hand or
      // every shot is a picture of the loading screen.
      try { if (CBZ.bootMeter && CBZ.bootMeter.hide) CBZ.bootMeter.hide(); } catch (_) {}
      try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
      // SEED THE DIE ON BOTH SIDES. economy.js reseeds itself from Math.random
      // at load so a run is not identical every time; for a matched pair it has
      // to be. Override Math.random, then ask econ to take its seed again.
      let s = 20260825;
      Math.random = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      try { if (CBZ.econ && CBZ.econ.reseed) CBZ.econ.reseed(); } catch (_) {}
      window.requestAnimationFrame = function () { return 0; };
      await wait(600);
      for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
      S = window.__phoneBridgeSeq = {};
      window.__cbzVisualCompare = {
        render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
      };
    }

    const g = CBZ.game;
    const step = (secs) => {
      const n = Math.max(1, Math.round(secs * 60));
      for (let i = 0; i < n; i++) {
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        CBZ.stepSim(1 / 60);
        if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
      }
    };
    const posOf = (a) => (a && a.pos) || (a && a.group && a.group.position) || null;
    const P = CBZ.player;
    if (!P || !P.pos) return { ok: false, err: "no player" };

    // stand at arm's length, facing him — the same placement the prison
    // interaction preset uses, so the walk-up card renders.
    const standAt = (a) => {
      const ap = posOf(a);
      if (!ap) return false;
      P.pos.set(ap.x + 1.4, ap.y, ap.z);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
      const vx = ap.x - P.pos.x, vz = ap.z - P.pos.z;
      if (CBZ.cam) CBZ.cam.yaw = Math.atan2(-vx, -vz);
      return true;
    };
    const pressVerb = (a, want) => {
      const verbs = a._verbs || [];
      const idx = verbs.indexOf(want);
      if (idx < 0) return { pressed: false, verbs: verbs.slice() };
      try { CBZ.doInteract(idx); } catch (e) { return { pressed: false, verbs: verbs.slice(), err: String(e) }; }
      return { pressed: true, verbs: verbs.slice() };
    };
    const spokenLine = () => {
      const el = document.querySelector(".pi-subtitle-line");
      return el ? (el.textContent || "").trim() : "";
    };

    const bent = (CBZ.guards || []).filter((x) => x && x.corrupt && !x.dead && !(x.ko > 0));
    const officer = bent[0] || (CBZ.guards || [])[3];
    if (!officer) return { ok: false, err: "no bent officer on the roster" };

    // A COUNT OUTRANKS MONEY, and the clock is not ours to set. Buying the man
    // (loyalty) is the shipped way past that gate and it changes nothing else
    // about the transactions below.
    officer.loyalty = 100;
    officer.ko = 0; officer.hunt = 0; officer.alert = 0;

    const sub = input.subject.id;
    const out = { serviceInPool: 0 };
    let want = "pay", target = officer, said = "", verbOk = false, verbList = [];
    let armApproach = null;

    if (sub === "phone-rental") {
      /* ASK THE REAL DOOR. Forcing data.offer = "Phone Time" would stage the
         answer instead of measuring it: pickOffer is the only place a service
         can enter a stall, and with the flag off it short-circuits before the
         draw. Four hundred draws is far past the 18% branch — if none comes
         out, the pool genuinely cannot produce one. */
      const dealer = (CBZ.npcs || []).find((n) => n && !n.dead && !n.escaped && n.role === "dealer" && n.data) ||
                     (CBZ.npcs || []).find((n) => n && !n.dead && !n.escaped && n.data && n.data.pool);
      if (!dealer) return { ok: false, err: "no dealer with a stall" };
      const pool = (dealer.data.pool) || "drugs";
      let service = null;
      for (let i = 0; i < 400 && !service; i++) {
        const o = CBZ.econ.pickOffer(pool);
        if (o && CBZ.econ.isService && CBZ.econ.isService(o.item)) service = o;
      }
      out.serviceInPool = service ? 1 : 0;
      dealer.data.offer = service || CBZ.econ.pickOffer(pool);
      g.cigs = 80;
      if (CBZ.el && CBZ.el.cigText) CBZ.el.cigText.textContent = g.cigs;
      target = dealer;
      want = "trade";
    } else {
      // heat on the sheet is what a clean-sheet payoff is FOR; racketDebt is
      // what a racket cut is for. Both are prison fields (g.detection).
      g.detection = 62;
      g.complaints = 0;
      g.cigs = 80;
      if (CBZ.el && CBZ.el.cigText) CBZ.el.cigText.textContent = g.cigs;
      if (sub === "racket-cut-phone") {
        // the rented window — bought in beat 2, granted here so the beat is
        // independent of whether beat 2 could buy one on this side.
        if (CBZ.econ.grantPhoneTime) CBZ.econ.grantPhoneTime();
        CBZ.game.racketDebt = 24;
        armApproach = ["racketOffer", { debt: 24 }];
      } else {
        // no phone, no window: exactly the man the bridge is about
        delete g.inventory["Burner Phone"];
        g.phoneTimeT = 0;
        armApproach = ["payoffOffer", {}];
      }
    }

    /* PLACE HIM FIRST, THEN ARM HIM. An approach is a man WALKING AT YOU with
       an offer; considerPayoffApproach and updateRacketPressure both gate on
       distance, and arming from across the yard is an offer that expires on
       the way over. Stand at arm's length, let a beat of sim settle the walk-up
       card, and only then put the deal in his mouth. */
    if (!standAt(target)) return { ok: false, err: "target has no position" };
    step(0.5);
    standAt(target);
    step(0.3);
    if (armApproach) {
      officer.approach = null; officer.standingOffer = null;
      CBZ.startGuardPayoffApproach(officer, armApproach[0], armApproach[1]);
      target._verbs = null;                 // force a fresh render() stamp
      standAt(target);
      step(0.25);
    }

    const cigsBefore = g.cigs || 0;
    // what the CARD says this costs, read before the press — the other half of
    // the quoted-vs-taken measurement below.
    const quoted = target.approach ? (target.approach.cost || 0)
      : (target.data && target.data.offer && CBZ.econ.offerPrice ? CBZ.econ.offerPrice(target).price : 0);
    const phoneAccess = CBZ.econ.hasPhoneAccess ? CBZ.econ.hasPhoneAccess() : false;
    const press = pressVerb(target, want);
    verbList = press.verbs;
    if (!press.pressed) {
      // fall back to the till directly so the beat still photographs SOMETHING
      // truthful, and say so in the payload rather than pretending it worked.
      out.pressFallback = 1;
      let res = null;
      try {
        res = want === "trade" ? CBZ.econ.trade(target) : CBZ.resolveGuardApproach(target, "pay");
      } catch (e) { return { ok: false, err: "verb unreachable and till threw: " + e }; }
      verbOk = !!(res && res.ok);
      said = (res && res.msg) || "";
      if (CBZ.prisonSay && said) { try { CBZ.prisonSay(target, said, { rank: 9 }); } catch (_) {} }
      step(0.05);
    } else {
      step(0.05);
      said = spokenLine();
      verbOk = true;
    }
    // let the card and the subtitle lay out, without burning the line's timer
    // (tickSay runs off the frame loop, which is frozen)
    step(0.02);
    if (!said) said = spokenLine();

    const cigsAfter = g.cigs || 0;
    const spent = Math.max(0, cigsBefore - cigsAfter);

    return {
      ok: true,
      side: input.side,
      subject: sub,
      bridge: !!(CBZ.CONFIG && CBZ.CONFIG.PRISON_PHONE_BRIDGE !== false),
      officer: (officer.data && officer.data.name) || "guard",
      seller: (target.data && target.data.name) || "",
      offer: (target.data && target.data.offer) || null,
      verbs: verbList,
      verbOk,
      pressFallback: out.pressFallback || 0,
      quoted,
      line: said,
      audit: CBZ.socialAudit ? CBZ.socialAudit() : null,
      metrics: {
        phoneAccess: phoneAccess ? 1 : 0,
        deepSale: spent > 0 ? 1 : 0,
        cigsSpent: spent,
        serviceInPool: out.serviceInPool,
        lineChars: said.length,
        quoteGap: spent > 0 ? Math.abs(quoted - spent) : 0,
      },
    };
  },
};
