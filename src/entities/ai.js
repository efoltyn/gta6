/* ============================================================
   entities/ai.js — the "give NPCs life" brain.

   Every inmate runs a little state machine: WANDER → FIGHT / FLEE /
   ESCAPE. They form two gangs, brawl with rivals, sometimes betray
   and jump their OWN gang leader, occasionally take a swing at a
   guard, and now and then make a break for the exit. Anyone can be
   beaten down or killed — by you, by each other, by the guards.

   npc.js calls CBZ.aiThink(n, dt) each frame; we set n.target / state
   and return the speed to move at. Combat also reaches into guards
   (they have .hp/.ko too), so brawls spill over onto the staff.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const rng = () => CBZ.econ.rng();
  const GANG_COLORS = [0xff3b3b, 0x3b7bff]; // red vs blue armbands

  // two gang home turfs (centres) — gang 0 west, gang 1 east
  const TURF = [{ x: -22, z: 30 }, { x: 22, z: 16 }];
  const APPROACH_NEAR = 2.35;
  const APPROACH_FAR = 13.5;

  // cached emote-bubble textures
  const emoteTex = {};
  function emote(actor, ch) {
    if (!emoteTex[ch]) {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const x = c.getContext("2d"); x.font = "44px serif"; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(ch, 32, 36); emoteTex[ch] = new THREE.CanvasTexture(c);
    }
    if (!actor._emote) {
      actor._emote = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
      actor._emote.scale.set(0.9, 0.9, 1); actor._emote.position.y = CBZ.charHeadY ? CBZ.charHeadY(actor) : 1.97; actor.group.add(actor._emote);
    }
    actor._emote.material.map = emoteTex[ch];
    actor._emote.visible = true; actor._emoteT = 1.6;
  }

  let inited = false;
  function initWorld() {
    inited = true;
    let gi = 0;
    for (const n of CBZ.npcs) {
      // Named crew members keep their assigned gang; generic inmates split
      // evenly — unless flagged a loner, who stays unaffiliated.
      const presetGang = n.gang === 0 || n.gang === 1 ? n.gang : null;
      n.gang = n.forceNeutral ? -1
        : (presetGang != null ? presetGang : ((n.role === "inmate" || n.role === "thief") ? (gi++ % 2) : -1));
      if (n.gang >= 0) addBand(n, n.gang);
    }
    // shotcallers lead first; fallback to the first member of each gang
    for (const g of [0, 1]) {
      const m = CBZ.npcs.find((n) => n.gang === g && crewRole(n) === "shotcaller") || CBZ.npcs.find((n) => n.gang === g);
      if (m) { m.isLeader = true; leaders[g] = m; }
    }
    // paint the turf on the ground
    TURF.forEach((t, g) => {
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(9, 28),
        new THREE.MeshBasicMaterial({ color: GANG_COLORS[g], transparent: true, opacity: 0.1, depthWrite: false })
      );
      disc.rotation.x = -Math.PI / 2; disc.position.set(t.x, 0.04, t.z);
      (CBZ.prisonRoot || CBZ.scene).add(disc);
    });
  }
  const leaders = {};

  function addBand(actor, gang) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.34), CBZ.mat(GANG_COLORS[gang]));
    band.position.y = -0.2; actor.char.parts.la.add(band);
  }

  // ---- ratings (CAPABILITY) + behaviour (TEMPERAMENT), decoupled -------
  const B = CBZ.BEHAVIORS || {};
  const BK = CBZ.BEHAVIOR_KEYS || ["unpredictable"];
  function behaviorOf(n) {
    return (n && B[n.behavior]) || B.unpredictable || { init: 0.14, retaliate: 0.8, fleeHurt: 0.4, picksWeak: 0.3, guts: 0.5, label: "Wildcard", emoji: "🌀" };
  }
  // pick a temperament with light role bias — but capability is rolled
  // separately, so a brute can still be a pacifist and vice-versa.
  function pickBehaviorFor(n) {
    const role = n.role, crew = crewRole(n);
    let pool;
    if (role === "merchant" || role === "dealer") pool = ["pacifist", "pacifist", "defensive", "opportunist"];
    else if (crew === "enforcer") pool = ["defensive", "protector", "predator", "hothead"];
    else if (crew === "collector") pool = ["bully", "opportunist", "hothead", "defensive"];
    else if (crew === "shotcaller") pool = ["protector", "defensive", "predator", "hothead"];
    else if (role === "thief") pool = ["opportunist", "bully", "unpredictable", "pacifist"];
    else pool = BK; // generic inmates: full spread
    return pool[Math.floor(rng() * pool.length)];
  }
  function roll(lo, span) { return lo + Math.floor(rng() * span); }
  function ensureCombatProfile(n) {
    if (n._profileReady) return;
    n._profileReady = true;
    n.ratings = Object.assign({
      fighting:  roll(28, 56),
      toughness: roll(28, 56),
      speed:     roll(30, 52),
      stealth:   roll(20, 62),
      marksman:  roll(12, 46),
      cunning:   roll(24, 58),
    }, n.ratings || {});
    if (!(n.behavior && B[n.behavior])) n.behavior = pickBehaviorFor(n);
    n.record = n.record || { kills: 0, knockdowns: 0, downs: 0, fights: 0 };
    // durability + foot-speed flow from the capability ratings
    n.maxHp = Math.round(58 + n.ratings.toughness * 1.05);
  }

  // rough 0..1 odds that `a` would win a straight brawl with `b`
  function combatPower(a) {
    if (!a) return 100;
    const r = a.ratings;
    const f = r ? r.fighting : (a.kind ? 72 : 50);
    const t = r ? r.toughness : (a.kind ? 78 : 50);
    const hp = a.hp != null ? a.hp : 100;
    return f + t * 0.6 + hp * 0.22 + (a.kind === "warden" ? 30 : a.kind === "guard" ? 18 : 0);
  }
  function fightOdds(a, b) {
    const pa = combatPower(a), pb = combatPower(b);
    return pa / (pa + pb);
  }

  function initActor(n) {
    ensureCombatProfile(n);
    n.hp = n.maxHp || 100;
    n.baseSpeed = n.speed * (0.82 + (n.ratings.speed / 100) * 0.42);
    n.aiState = "wander";
    n.aiTimer = rng() * 2; n.hitCD = 0; n.foe = null; n.fleeT = 0; n.huntPlayer = 0;
    n.personality = Object.assign({
      greed: rng(),
      nerve: rng(),
      loyalty: rng(),
      snitch: rng(),
    }, n.personality || {});
    n.approach = null;
    n.approachCD = 2 + rng() * 4;
    n.tailT = 0;
    n.tailKind = null;
    n.tailCommitT = 0;
    n.tailSide = rng() < 0.5 ? -1 : 1;
    n.interceptTarget = null;
    n.interceptMode = null;
    n.interceptT = 0;
    n.pressureT = 0;
    n.pressureSource = null;
    n.pressureKind = null;
    n.pressureSlot = 0;
    clearRumorHuddle(n);
    n.questionedT = 0;
    n.blockRead = null;
    n.coverDebt = null;
    n.playerTrust = 0;
    n.playerFear = 0;
    n.playerGrudge = 0;
  }

  function dist(a, b) {
    return Math.hypot(a.group.position.x - b.group.position.x, a.group.position.z - b.group.position.z);
  }
  function alive(a) { return a && !a.dead && !(a.ko > 0) && !a.escaped; }

  function playerDist(n) {
    return Math.hypot(CBZ.player.pos.x - n.group.position.x, CBZ.player.pos.z - n.group.position.z);
  }

  // Hot local decisions should not scan the entire prison population. The
  // spatial index is installed later by systems/npcgrid.js; keep a fallback
  // so this module remains load-order tolerant and easy to test headlessly.
  const _palNear = [], _foeNear = [], _brawlNear = [], _defendNear = [], _shadowNear = [];
  function nearbyNpcs(n, radius, out) {
    const p = n.group.position;
    if (CBZ.queryNpcsNear) return CBZ.queryNpcsNear(p.x, p.z, radius, out);
    out.length = 0;
    for (let i = 0; i < CBZ.npcs.length; i++) out.push(CBZ.npcs[i]);
    return out;
  }

  function gangStanding(gang) {
    const gs = CBZ.game.gangStanding || (CBZ.game.gangStanding = [0, 0]);
    return gang >= 0 ? (gs[gang] || 0) : 0;
  }

  function addGangStanding(gang, amount) {
    if (gang < 0) return;
    const gs = CBZ.game.gangStanding || (CBZ.game.gangStanding = [0, 0]);
    gs[gang] = Math.max(-100, Math.min(100, (gs[gang] || 0) + amount));
  }

  function gangDebt(gang) {
    const debt = CBZ.game.gangDebt || (CBZ.game.gangDebt = [0, 0]);
    return gang >= 0 ? (debt[gang] || 0) : 0;
  }

  function addGangDebt(gang, amount) {
    if (gang < 0) return 0;
    const debt = CBZ.game.gangDebt || (CBZ.game.gangDebt = [0, 0]);
    debt[gang] = Math.max(0, Math.min(99, (debt[gang] || 0) + amount));
    return debt[gang];
  }

  function gangProtection(gang) {
    const gp = CBZ.game.gangProtection || (CBZ.game.gangProtection = [0, 0]);
    return gang >= 0 ? (gp[gang] || 0) : 0;
  }

  function addGangProtection(gang, seconds) {
    if (gang < 0) return;
    const gp = CBZ.game.gangProtection || (CBZ.game.gangProtection = [0, 0]);
    gp[gang] = Math.max(gp[gang] || 0, seconds || 30);
  }

  function noteGangIncident(actor, kind, severity, opts) {
    opts = opts || {};
    if (!actor || actor.gang == null || actor.gang < 0 || !actor.group) return null;
    const gang = actor.gang;
    severity = Math.max(1, severity || 1);
    const helpful = kind === "help" || kind === "gift" || kind === "trade" || kind === "cover" || kind === "romance";
    const sameCrew = CBZ.player && CBZ.player.gang === gang;
    const source = opts.source || actorName(actor);
    const standingDelta = helpful
      ? Math.ceil(severity * (sameCrew ? 0.9 : 0.55))
      : -Math.ceil(severity * (sameCrew ? 1.10 : 0.78));
    const debtDelta = helpful ? -Math.ceil(severity * 0.45) : Math.ceil(severity * 0.32);
    if (!opts.skipStanding) addGangStanding(gang, standingDelta);
    if (!opts.skipDebt && debtDelta) addGangDebt(gang, debtDelta);
    addBuzz(helpful ? "debt" : "fear", helpful ? -Math.min(8, severity * 0.9) : Math.min(16, severity * 1.2), source);

    let witnesses = 0, responders = 0;
    const rivalTouched = [false, false];
    for (const m of CBZ.npcs || []) {
      if (!alive(m) || m === actor || !m.group || m.role === "merchant") continue;
      const nearActor = Math.hypot(m.group.position.x - actor.group.position.x, m.group.position.z - actor.group.position.z);
      const nearPlayer = CBZ.player ? playerDist(m) : 99;
      if (nearActor > 18 && nearPlayer > 18) continue;

      if (m.gang === gang) {
        witnesses++;
        rememberBlockRead(m, helpful ? "debt" : "fear", Math.min(48, 12 + severity * 2.6), source);
        if (helpful) {
          bumpSocial(m, "playerTrust", 0.35 + severity * 0.04, -8, 14);
          bumpSocial(m, "playerGrudge", -0.30, 0, 14);
          if ((m.huntPlayer || 0) > 0 && gangStanding(gang) > -18) m.huntPlayer = Math.max(0, (m.huntPlayer || 0) - 4 - severity * 0.35);
          if (severity >= 4 && nearPlayer < 15) emote(m, "+");
        } else {
          const p = m.personality || {};
          bumpSocial(m, "playerGrudge", 0.55 + severity * 0.06, 0, 14);
          bumpSocial(m, "playerFear", Math.min(0.8, severity * 0.04), 0, 14);
          const responseChance = Math.min(0.82, 0.12 + severity * 0.035 + (p.loyalty || 0.5) * 0.22 + (p.nerve || 0.5) * 0.18 - (sameCrew ? 0.14 : 0));
          if (severity >= 5 && !m.approach && m.aiState !== "snitch" && m.aiState !== "fight" && rng() < responseChance) {
            m.huntPlayer = Math.max(m.huntPlayer || 0, 4 + severity * 0.45);
            responders++;
            emote(m, "!");
          }
        }
      } else if (!helpful && m.gang >= 0 && m.gang !== gang) {
        rememberBlockRead(m, "fear", Math.min(34, 8 + severity * 1.8), source);
        bumpSocial(m, "playerTrust", Math.min(0.42, severity * 0.035), -8, 14);
        if (!rivalTouched[m.gang] && severity >= 5) {
          rivalTouched[m.gang] = true;
          addGangStanding(m.gang, Math.min(3, Math.ceil(severity * 0.18)));
        }
      }
    }

    const g = CBZ.game || {};
    const near = CBZ.player && Math.hypot(CBZ.player.pos.x - actor.group.position.x, CBZ.player.pos.z - actor.group.position.z) < 22;
    if (!opts.silent && near && CBZ.flashHint && severity >= (helpful ? 4 : 5)) {
      g.gangNoticeT = (g.gangNoticeT || 0) - 1;
      if (g.gangNoticeT <= 0) {
        g.gangNoticeT = 2.8;
        const line = helpful
          ? `${GANG_NAMES[gang]} notice you did right by ${actorName(actor)}. Respect ${gangStanding(gang)}.`
          : responders > 0
          ? `${GANG_NAMES[gang]} react as a crew. Respect ${gangStanding(gang)}, debt ${gangDebt(gang)}.`
          : `${GANG_NAMES[gang]} remember what happened to ${actorName(actor)}.`;
        CBZ.flashHint(line, 1.8);
      }
    }
    return { gang, standing: gangStanding(gang), debt: gangDebt(gang), witnesses, responders };
  }

  function blockRumor() {
    const g = CBZ.game || {};
    if (!g.blockRumor) g.blockRumor = { fear: 0, wealth: 0, heat: 0, badge: 0, snitch: 0, debt: 0, last: "" };
    return g.blockRumor;
  }

  function topBuzz() {
    const r = blockRumor();
    let best = "quiet", score = 0;
    for (const k of ["fear", "wealth", "heat", "badge", "snitch", "debt"]) {
      if ((r[k] || 0) > score) { best = k; score = r[k] || 0; }
    }
    return { kind: best, score };
  }

  function addBuzz(kind, amount, source) {
    const r = blockRumor();
    r[kind] = Math.max(0, Math.min(100, (r[kind] || 0) + (amount || 0)));
    r.last = source || kind;
  }

  function socialProfile() {
    const g = CBZ.game || {};
    if (!g.socialProfile) g.socialProfile = { paid: 0, threatened: 0, refused: 0, helped: 0, listened: 0, bargained: 0, exploited: 0, last: "" };
    return g.socialProfile;
  }

  function approachReadKind(a, action) {
    const kind = a && a.kind;
    if (action === "threaten") return "fear";
    if (kind === "snitchThreat" || kind === "witnessFix" || kind === "recantOffer" || kind === "alibiDeal") return "snitch";
    if (kind === "stickUp" || kind === "crewDues" || kind === "tax" || kind === "debtCollect" || kind === "gangParley" || kind === "turfWarning") return "debt";
    if (kind === "copBribe" || kind === "copTip" || kind === "copPlea" || kind === "copTaunt" || kind === "racketCover" || kind === "reputation" && a.repKind === "badge") return "badge";
    if (kind === "buyItem" || kind === "deal" || kind === "stashCover") return "wealth";
    if (kind === "heatWarning" || kind === "infoSell" || kind === "coverStory" || kind === "coverDebt") return "heat";
    return action === "pay" ? "wealth" : "debt";
  }

  function rememberPlayerResponse(n, action, a) {
    if (!a || action === "completeDeal") return;
    const sp = socialProfile();
    const kind = a.kind || "approach";
    const pressure = kind === "tax" || kind === "crewDues" || kind === "stickUp" || kind === "debtCollect" || kind === "snitchThreat" || kind === "recantOffer" || kind === "coverDebt";
    const cannotPay = action === "pay" && (a.cost || 0) > 0 && ((CBZ.game && CBZ.game.cigs) || 0) < (a.cost || 0);
    if (action === "listen") sp.listened++;
    else if (action === "haggle") sp.bargained++;
    else if (action === "pay" && !cannotPay) { sp.paid++; if (pressure) sp.exploited++; }
    else if (action === "pay" && cannotPay) sp.refused++;
    else if (action === "threaten") sp.threatened++;
    else if (action === "refuse") sp.refused++;
    else if (action === "accept" || action === "respect") sp.helped++;
    sp.last = (cannotPay ? "failedPay" : action) + ":" + kind;

    if (action === "listen" || cannotPay) return;
    const readKind = approachReadKind(a, action);
    const src = actorName(n);
    const strength =
      action === "pay" ? (pressure ? 18 : 10) :
      action === "threaten" ? 22 :
      action === "refuse" ? 16 :
      action === "accept" || action === "respect" ? 12 : 8;
    if (action === "pay" && pressure) addBuzz("debt", 3 + Math.min(5, a.cost || 0), "paid-pressure");
    else if (action === "pay") addBuzz("wealth", 2 + Math.min(5, a.cost || 0), "paid-deal");
    else if (action === "threaten") addBuzz("fear", 5, "threatened-approach");
    else if (action === "refuse") addBuzz(readKind, 4, "refused-approach");
    else if (action === "accept" || action === "respect") addBuzz(readKind, -3, "handled-approach");

    for (const m of CBZ.npcs || []) {
      if (m === n || !alive(m) || m.role === "merchant" || !m.group) continue;
      const d = Math.hypot(m.group.position.x - n.group.position.x, m.group.position.z - n.group.position.z);
      if (d > 13.5) continue;
      rememberBlockRead(m, readKind, strength * (1 - d / 22), src);
      if (action === "pay" && pressure && (m.personality && m.personality.greed) > 0.42) bumpSocial(m, "playerGrudge", 0.18, 0, 14);
      if (action === "threaten" && (m.personality && m.personality.nerve) < 0.58) bumpSocial(m, "playerFear", 0.35, 0, 14);
      if ((action === "accept" || action === "respect") && m.gang >= 0 && n.gang === m.gang) bumpSocial(m, "playerTrust", 0.22, -8, 14);
    }
  }

  function bumpSocial(n, key, amount, lo, hi) {
    if (!n) return;
    n[key] = Math.max(lo, Math.min(hi, (n[key] || 0) + amount));
  }

  function hurryApproach(n, seconds) {
    if (!n) return;
    n.approachCD = Math.min(n.approachCD || seconds, seconds);
  }

  function rememberBlockRead(n, kind, strength, source) {
    if (!n || !alive(n) || n.role === "merchant" || !kind || kind === "quiet") return;
    const old = n.blockRead;
    const oldScore = old && old.kind === kind ? old.score || 0 : 0;
    const score = Math.max(6, Math.min(100, Math.max(strength || 0, oldScore * 0.65 + (strength || 0) * 0.55)));
    n.blockRead = {
      kind,
      score,
      source: source || kind,
      t: Math.max((old && old.kind === kind ? old.t || 0 : 0), 10 + Math.min(18, score * 0.22)),
    };
    if (score > 24 && !n.approach && n.aiState !== "fight" && n.aiState !== "snitch" && !(n.huntPlayer > 0)) {
      hurryApproach(n, 1.8 + rng() * 3.2);
    }
  }

  function rippleApproach(source, outcome, offer, opts) {
    if (!source || !source.group || !CBZ.npcs) return 0;
    offer = offer || {};
    opts = opts || {};
    const sx = source.group.position.x, sz = source.group.position.z;
    const range = opts.range || (outcome === "paid" ? 10.5 : 12.5);
    const playerGang = CBZ.player && CBZ.player.gang != null ? CBZ.player.gang : null;
    const sourceGang = source.gang != null ? source.gang : -1;
    const kind = offer.kind || "deal";
    let watchers = 0, opportunists = 0, hardLooks = 0;

    for (const m of CBZ.npcs) {
      if (m === source || !alive(m) || !m.group || !m.data) continue;
      if (m.role === "merchant" || m.role === "dealer") continue;
      const dx = m.group.position.x - sx, dz = m.group.position.z - sz;
      if (Math.hypot(dx, dz) > range) continue;
      const p = m.personality || {};
      const sameSourceGang = sourceGang >= 0 && m.gang === sourceGang;
      const rivalSourceGang = sourceGang >= 0 && m.gang >= 0 && m.gang !== sourceGang;
      const samePlayerGang = playerGang != null && m.gang === playerGang;
      const readKind = kind === "witnessFix" || kind === "recantOffer" || kind === "snitchThreat" || kind === "alibiDeal" ? "snitch"
        : kind === "stickUp" || kind === "crewDues" || kind === "tax" || kind === "debtCollect" || kind === "gangParley" ? "debt"
        : kind === "stashCover" || kind === "buyItem" ? "wealth"
        : kind === "coverDebt" ? "heat"
        : "heat";
      watchers++;
      rememberBlockRead(m, outcome === "threatWon" ? "fear" : readKind, 18 + (offer.cost || 0) * 1.4, actorName(source));

      if (outcome === "paid") {
        if (sameSourceGang || samePlayerGang) {
          bumpSocial(m, "playerTrust", 0.35, -8, 14);
          bumpSocial(m, "playerGrudge", -0.25, 0, 14);
        }
        if ((kind === "stickUp" || kind === "crewDues" || kind === "tax" || kind === "debtCollect") && (p.greed || 0) > 0.45 && !samePlayerGang) {
          hurryApproach(m, 1.8 + rng() * 2.2);
          bumpSocial(m, "playerGrudge", 0.25, 0, 14);
          opportunists++;
        }
        if ((kind === "witnessFix" || kind === "recantOffer" || kind === "snitchThreat" || kind === "alibiDeal") && (p.snitch || 0) > 0.48) {
          bumpSocial(m, "playerFear", 0.28, 0, 14);
          hurryApproach(m, 2.3 + rng() * 2);
        }
        if (rivalSourceGang && kind === "gangParley") bumpSocial(m, "playerGrudge", 0.35, 0, 14);
      } else if (outcome === "threatWon") {
        bumpSocial(m, "playerFear", 0.45 + (1 - (p.nerve || 0.5)) * 0.28, 0, 14);
        if (sameSourceGang) { bumpSocial(m, "playerGrudge", 0.65, 0, 14); hardLooks++; }
        if (rivalSourceGang) bumpSocial(m, "playerTrust", 0.18, -8, 14);
        if ((p.nerve || 0.5) > 0.65 || sameSourceGang) hurryApproach(m, 1.4 + rng() * 2.4);
      } else if (outcome === "threatFailed" || outcome === "refused") {
        if (sameSourceGang) {
          bumpSocial(m, "playerGrudge", outcome === "refused" ? 0.55 : 0.85, 0, 14);
          hurryApproach(m, 1.2 + rng() * 2);
          hardLooks++;
        }
        if (rivalSourceGang) bumpSocial(m, "playerTrust", 0.18, -8, 14);
        if ((p.greed || 0) > 0.55 && (kind === "stickUp" || kind === "crewDues" || kind === "tax" || kind === "debtCollect")) {
          hurryApproach(m, 1.6 + rng() * 2.4);
          opportunists++;
        }
        if ((p.snitch || 0) > 0.55 && (kind === "snitchThreat" || kind === "witnessFix" || kind === "recantOffer" || kind === "alibiDeal")) {
          bumpSocial(m, "playerGrudge", 0.35, 0, 14);
          hurryApproach(m, 2 + rng() * 2.2);
        }
      }
    }

    if (!watchers) return 0;
    if (sourceGang >= 0) {
      const helped = outcome === "paid";
      const incidentKind = helped ? "trade" : (outcome === "threatWon" ? "threat" : "disrespect");
      const incidentSeverity = Math.max(2, Math.min(12,
        (offer.cost || 0) * 0.55 +
        watchers * 0.35 +
        (outcome === "threatFailed" || outcome === "refused" ? 4 : outcome === "threatWon" ? 3 : 2)
      ));
      noteGangIncident(source, incidentKind, incidentSeverity, {
        skipStanding: true,
        skipDebt: true,
        silent: true,
        source: `${outcome}:${kind}`,
      });
    }
    if (outcome === "paid") {
      if (kind === "stickUp" || kind === "crewDues" || kind === "tax" || kind === "debtCollect") addBuzz("debt", -Math.min(8, 2 + (offer.cost || 0) * 0.4), "paid-public");
      if (kind === "witnessFix" || kind === "recantOffer" || kind === "snitchThreat" || kind === "alibiDeal") addBuzz("snitch", -Math.min(7, 2 + (offer.cost || 0) * 0.35), "paid-silence");
    } else if (outcome === "threatWon") {
      addBuzz("fear", Math.min(10, 2 + watchers * 0.35), "public-threat");
      if (hardLooks) addBuzz("debt", Math.min(7, hardLooks * 0.8), "gang-hard-looks");
    } else {
      addBuzz(kind === "snitchThreat" || kind === "witnessFix" || kind === "alibiDeal" ? "snitch" : "debt", Math.min(9, 2 + watchers * 0.28 + opportunists * 0.45), "public-refusal");
    }

    const g = CBZ.game || {};
    if (CBZ.flashHint && CBZ.player && playerDist(source) < 18 && rng() < 0.5) {
      g.gossipNoticeT = (g.gossipNoticeT || 0) - 1;
      if (g.gossipNoticeT <= 0) {
        g.gossipNoticeT = 3;
        CBZ.flashHint(outcome === "paid" ? "People nearby clock who got paid." : outcome === "threatWon" ? "The block clocks the threat." : "People nearby clock the refusal.", 1.4);
      }
    }
    return watchers;
  }

  function updateBlockRumors(dt) {
    if (!CBZ.game || CBZ.game.state !== "playing") return;
    const g = CBZ.game;
    const r = blockRumor();
    const ease = 1 - Math.exp(-0.45 * dt);
    const debtTotal = (g.gangDebt && ((g.gangDebt[0] || 0) + (g.gangDebt[1] || 0))) || 0;
    g.lowProfileT = Math.max(0, (g.lowProfileT || 0) - dt);
    g.gossipHuddleT = Math.max(0, (g.gossipHuddleT || 0) - dt);
    const cover = (g.lowProfileT || 0) > 0 ? 34 : 0;
    const target = {
      fear: Math.min(100, (g.kos || 0) * 10 + (g.deaths || 0) * 24),
      wealth: Math.max(0, Math.min(100, ((g.cigs || 0) - 8) * 4 - cover)),
      heat: Math.max(0, Math.min(100, (g.detection || 0) + ((g.witnessReportT || 0) > 0 ? 18 : 0) - cover * 0.18)),
      badge: Math.min(100, ((g.racketProtectionT || 0) > 0 ? 42 : 0) + Math.min(38, (g.racketDebt || 0) * 2)),
      snitch: Math.min(100, (g.snitchReports || 0) * 15 + ((g.lastKnown && g.lastKnown.t > 0) ? 12 : 0)),
      debt: Math.min(100, debtTotal * 4),
    };
    for (const k of Object.keys(target)) {
      r[k] = Math.max(0, (r[k] || 0) + (target[k] - (r[k] || 0)) * ease - dt * 0.18);
    }
  }

  function protectionGang() {
    if (CBZ.player && CBZ.player.gang != null) return CBZ.player.gang;
    const gp = CBZ.game.gangProtection || [0, 0];
    if ((gp[0] || 0) <= 0 && (gp[1] || 0) <= 0) return null;
    return (gp[0] || 0) >= (gp[1] || 0) ? 0 : 1;
  }

  const DELIVERY_TARGETS = [
    { name: "cafeteria kitchen", x: -27.0, z: 19.2, r: 4.2 },
    { name: "armory checkpoint", x: 19.2, z: 1.0, r: 4.0 },
    { name: "staff lounge door", x: 19.2, z: 37.0, r: 4.0 },
    { name: "drain service grate", x: -25.5, z: 25.3, r: 4.0 },
  ];

  function makeGangJob(n) {
    const gang = n.gang;
    const rival = gang === 0 ? 1 : 0;
    const debt = gangDebt(gang);
    const role = crewRole(n);
    let roll = rng();
    if (role === "enforcer" || role === "collector") roll = Math.min(roll, 0.30);
    else if (role === "runner") roll = 0.46 + rng() * 0.20;
    else if (role === "lookout") roll = 0.82 + rng() * 0.16;
    if (roll < 0.38) {
      return {
        type: "rivalTurf",
        gang, rival,
        label: "Hold rival turf",
        targetName: `${GANG_NAMES[rival]} turf`,
        t: 58,
        progress: 0,
        need: 8,
        reward: 7 + Math.floor(rng() * 5),
        standing: 14,
        debtDrop: 7 + Math.min(7, debt),
      };
    }
    if (roll < 0.74) {
      const target = DELIVERY_TARGETS[Math.floor(rng() * DELIVERY_TARGETS.length)];
      return {
        type: "delivery",
        gang, rival,
        label: "Run package",
        targetName: target.name,
        targetX: target.x,
        targetZ: target.z,
        targetR: target.r,
        t: 64,
        progress: 0,
        need: 1,
        reward: 6 + Math.floor(rng() * 6),
        standing: 11,
        debtDrop: 6 + Math.min(6, debt),
      };
    }
    return {
      type: "lookoutShift",
      gang, rival,
      label: "Work lookout",
      targetName: `${GANG_NAMES[gang]} turf`,
      t: 52,
      progress: 0,
      need: 18,
      reward: 5 + Math.floor(rng() * 5),
      standing: 9,
      debtDrop: 5 + Math.min(5, debt),
    };
  }

  function jobObjective(job) {
    if (!job) return "";
    if (job.type === "rivalTurf") return `${job.label}: stay on ${job.targetName} for ${Math.ceil(job.need - job.progress)}s.`;
    if (job.type === "delivery") return `${job.label}: reach the ${job.targetName}.`;
    if (job.type === "lookoutShift") return `${job.label}: stay around ${job.targetName} and keep heat controlled.`;
    return job.label || "Gang job";
  }

  function startGangJob(job, actor) {
    if (!job || job.gang < 0) return { ok: false, msg: "No job available." };
    job.t = job.t || 45;
    job.progress = 0;
    job.source = actor && actor.data ? actor.data.name.replace(/^the |^a |^an /, "") : GANG_NAMES[job.gang];
    CBZ.game.gangJob = job;
    if (actor) {
      actor.playerTrust = Math.min(14, (actor.playerTrust || 0) + 1);
      if (actor.gang >= 0) addGangStanding(actor.gang, 2);
    }
    CBZ.setObjective && CBZ.setObjective(jobObjective(job));
    return { ok: true, msg: `${GANG_NAMES[job.gang]} job accepted: ${job.label}.` };
  }

  function completeGangJob(job) {
    if (!job) return;
    CBZ.econ.addCigs(job.reward || 4);
    addGangStanding(job.gang, job.standing || 8);
    addGangDebt(job.gang, -Math.max(3, job.debtDrop || 4));
    addGangProtection(job.gang, 22 + Math.max(0, job.standing || 0));
    if (job.rival != null) addGangStanding(job.rival, -3);
    CBZ.sfx && CBZ.sfx("coin");
    CBZ.flashHint && CBZ.flashHint(`${GANG_NAMES[job.gang]} pay ${job.reward || 4} cigs. Respect ${gangStanding(job.gang)}.`, 2.4);
    CBZ.setObjective && CBZ.setObjective("Job done. Keycard checkpoints or tunnels can still get you out.");
    CBZ.game.gangJob = null;
  }

  function failGangJob(job, reason) {
    if (!job) return;
    addGangStanding(job.gang, -7);
    addGangDebt(job.gang, 3);
    if (reason === "heat" && job.gang >= 0) provokeGang({ gang: job.gang, huntPlayer: 0 }, 4);
    CBZ.flashHint && CBZ.flashHint(`${GANG_NAMES[job.gang]} job failed. Debt ${gangDebt(job.gang)}.`, 2.2);
    CBZ.setObjective && CBZ.setObjective("Find a keycard for checkpoints, or scout vents and tunnels for another way out.");
    CBZ.game.gangJob = null;
  }

  function updateGangJob(dt) {
    const job = CBZ.game && CBZ.game.gangJob;
    if (!job) return;
    if (CBZ.player.dead || (CBZ.player.ko || 0) > 0) { failGangJob(job, "downed"); return; }
    job.t -= dt;
    if (job.rivalPaidT > 0) job.rivalPaidT = Math.max(0, job.rivalPaidT - dt);
    if (job.t <= 0) { failGangJob(job, "time"); return; }
    const heat = CBZ.game.detection || 0;
    pulseGangJobSocial(job, dt);
    if (job.type === "rivalTurf") {
      if (isOnTurf(job.rival, CBZ.player.pos)) {
        job.progress += dt;
        if (!job.rivalWarned && job.progress > 2.0) {
          const rival = CBZ.npcs.find((m) => m.gang === job.rival && alive(m) && playerDist(m) < 18);
          if (rival) {
            job.rivalWarned = true;
            provokeGang(rival, 4.5);
            CBZ.flashHint && CBZ.flashHint(`${GANG_NAMES[job.rival]} notice you working their turf.`, 1.5);
          }
        }
        if (job.ping == null || job.ping <= 0) {
          job.ping = 3.5;
          CBZ.flashHint && CBZ.flashHint(`${job.label}: ${Math.ceil(Math.max(0, job.need - job.progress))}s left.`, 1.1);
        }
      }
      job.ping = Math.max(0, (job.ping || 0) - dt);
      if (job.progress >= job.need) completeGangJob(job);
      return;
    }
    if (job.type === "delivery") {
      const dx = CBZ.player.pos.x - job.targetX;
      const dz = CBZ.player.pos.z - job.targetZ;
      if (dx * dx + dz * dz < (job.targetR || 4) * (job.targetR || 4)) completeGangJob(job);
      return;
    }
    if (job.type === "lookoutShift") {
      if (heat > 72) { failGangJob(job, "heat"); return; }
      if (isOnTurf(job.gang, CBZ.player.pos) && heat < 58) {
        job.progress += dt;
        if (job.progress >= job.need) completeGangJob(job);
      }
    }
  }

  function pulseGangJobSocial(job, dt) {
    if (!job || CBZ.game.role === "cop") return;
    job.socialPulse = (job.socialPulse || 0) - dt;
    if (job.socialPulse > 0) return;
    job.socialPulse = 4.2 + rng() * 2.4;

    let ally = null, allyScore = Infinity;
    let rival = null, rivalScore = Infinity;
    for (const n of CBZ.npcs) {
      if (!alive(n) || n.role === "merchant" || n.approach || n.aiState === "fight" || n.aiState === "snitch") continue;
      const d = playerDist(n);
      if (n.gang === job.gang && d < 16) {
        const p = n.personality || {};
        const score = d - (p.loyalty || 0.5) * 5 - gangStanding(job.gang) * 0.03;
        if (score < allyScore) { allyScore = score; ally = n; }
      } else if (n.gang === job.rival && d < 13) {
        const p = n.personality || {};
        const score = d - (p.nerve || 0.5) * 4 - Math.max(0, gangStanding(job.rival)) * 0.025;
        if (score < rivalScore) { rivalScore = score; rival = n; }
      }
    }

    if (ally && rng() < 0.72) {
      ally.aiState = "shadowPlayer";
      ally.shadowT = Math.max(ally.shadowT || 0, 6 + rng() * 4);
      ally.foe = null;
      emote(ally, "+");
      if (!job.allyHinted && playerDist(ally) < 14 && CBZ.flashHint) {
        job.allyHinted = true;
        CBZ.flashHint(`${GANG_NAMES[job.gang]} send backup while you work.`, 1.7);
      }
    }

    if (rival && (job.rivalPaidT || 0) <= 0 && !playerApproachBusy(rival) && rng() < 0.58) {
      const cost = Math.max(2, Math.min(CBZ.game.cigs || 0, 2 + Math.floor((CBZ.game.cigs || 0) / 8) + Math.floor(((rival.personality && rival.personality.greed) || 0.5) * 5)));
      startApproach(rival, "jobThreat", cost, { job });
    } else if (rival && (job.rivalPaidT || 0) <= 0 && rng() < 0.18) {
      provokeGang(rival, 3.5);
    }
  }

  function clearGangPressure(source) {
    if (!source) return;
    for (const m of CBZ.npcs || []) {
      if (m.pressureSource !== source) continue;
      m.pressureSource = null;
      m.pressureKind = null;
      m.pressureTactic = null;
      m.pressureT = 0;
      if (m.aiState === "pressurePlayer") {
        m.aiState = "wander";
        m.aiTimer = 0.15 + rng() * 0.4;
      }
    }
  }

  function callGangPressure(source, kind, extra) {
    if (!source || source.gang < 0 || !alive(source) || CBZ.game.role === "cop") return 0;
    const press =
      kind === "tax" || kind === "turfWarning" || kind === "debtCollect" ||
      kind === "crewDues" || kind === "stickUp" || kind === "gangParley" ||
      kind === "jobThreat";
    if (!press) return 0;

    const playerGang = CBZ.player && CBZ.player.gang != null ? CBZ.player.gang : null;
    const hostile =
      kind === "tax" || kind === "debtCollect" || kind === "stickUp" || kind === "jobThreat" ||
      (kind === "gangParley" && extra && extra.parleyMode === "truce") ||
      (playerGang != null && playerGang !== source.gang);
    const cigs = (CBZ.game && CBZ.game.cigs) || 0;
    const debt = gangDebt(source.gang);
    const standing = gangStanding(source.gang);
    const max = Math.min(3, 1 + (cigs >= 12 ? 1 : 0) + (hostile || debt > 8 || standing < -12 ? 1 : 0));
    const list = [];
    for (const m of CBZ.npcs || []) {
      if (m === source || !alive(m) || m.gang !== source.gang || !m.group || !m.data) continue;
      if (m.role === "merchant" || m.role === "dealer") continue;
      if (m.approach || m.aiState === "fight" || m.aiState === "snitch" || m.huntPlayer > 0) continue;
      const ds = dist(source, m);
      const dp = playerDist(m);
      if (ds > 16 && dp > 17) continue;
      const p = m.personality || {};
      const score = (p.loyalty || 0.5) * 1.4 + (p.nerve || 0.5) * 0.9 - ds * 0.045 - dp * 0.025 + (m.isLeader ? 0.8 : 0) + crewRoleScore(m, kind) * 0.16;
      list.push({ m, score });
    }
    list.sort((a, b) => b.score - a.score);
    const count = Math.min(max, list.length);
    for (let i = 0; i < count; i++) {
      const m = list[i].m;
      m.aiState = "pressurePlayer";
      m.pressureSource = source;
      m.pressureKind = kind;
      m.pressureSlot = i;
      m.pressureTactic = pressureTactic(m, kind, i);
      m.pressureT = 8.5 + rng() * 4 + (hostile ? 2 : 0);
      m.foe = null;
      m.pause = 0;
      emote(m, pressureEmote(m.pressureTactic, hostile));
    }
    if (count) {
      source.approachBackup = count;
      addBuzz(hostile ? "debt" : "wealth", Math.min(5, 1 + count * 1.2), "gang-pressure");
      if (CBZ.flashHint && playerDist(source) < 17 && rng() < 0.45) {
        CBZ.flashHint(`${GANG_NAMES[source.gang]} drift in behind the talk.`, 1.5);
      }
    }
    return count;
  }

  function clearApproach(n) {
    clearGangPressure(n);
    n.approach = null;
    n.approachCD = 6 + rng() * 10;
    if (n.aiState === "approachPlayer") { n.aiState = "wander"; n.aiTimer = 0.2; }
  }

  function playerApproachBusy(except) {
    for (const n of CBZ.npcs) {
      if (n !== except && n.approach && n.approach.t > 0 && alive(n)) return true;
    }
    for (const g of CBZ.guards) {
      if (g !== except && g.approach && g.approach.t > 0 && alive(g)) return true;
    }
    return false;
  }

  function expireApproach(n, reason) {
    const a = n && n.approach;
    if (!a) return;
    const near = playerDist(n) < 22;
    const who = n.data.name.replace(/^the |^a |^an /, "");

    if (a.kind === "snitchThreat") {
      const heat = a.heat || Math.max(12, a.cost * 9);
      const copCrime = a.memoryType === "copCrime";
      const lastKnown = n.memory && n.memory.lastKnown;
      clearApproach(n);
      n.memory = null;
      if (near && CBZ.flashHint) CBZ.flashHint(`${who} got tired of waiting and runs to snitch.`, 1.8);
      sendNpcToSnitch(n, heat, { copCrime, lastKnown });
      return;
    }

    if (a.kind === "tax") {
      const gang = n.gang;
      clearApproach(n);
      addGangDebt(gang, Math.max(2, a.cost || 3));
      addGangStanding(gang, -8);
      if (near && CBZ.flashHint) CBZ.flashHint(`${GANG_NAMES[gang]} mark you as unpaid.`, 1.8);
      if (gang >= 0 && gangStanding(gang) < -12) provokeGang(n, 7);
      return;
    }

    if (a.kind === "debtCollect") {
      const gang = n.gang;
      clearApproach(n);
      const debt = addGangDebt(gang, Math.max(2, Math.ceil((a.cost || 3) * 0.5)));
      addGangStanding(gang, -6);
      if (near && CBZ.flashHint) CBZ.flashHint(`${GANG_NAMES[gang]} add interest. Debt ${debt}.`, 1.8);
      if (gang >= 0 && debt > 10) provokeGang(n, 6);
      return;
    }

    if (a.kind === "turfWarning") {
      const gang = n.gang;
      clearApproach(n);
      addGangDebt(gang, 2);
      addGangStanding(gang, reason === "walkedAway" ? -3 : -5);
      if (near && CBZ.flashHint) CBZ.flashHint(`${GANG_NAMES[gang]} take the disrespect personally.`, 1.8);
      if (gang >= 0 && gangStanding(gang) < -10) provokeGang(n, 5);
      return;
    }

    if (a.kind === "gangJob") {
      const gang = n.gang;
      clearApproach(n);
      n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
      addGangStanding(gang, -3);
      if (near && CBZ.flashHint) CBZ.flashHint(`${GANG_NAMES[gang]} see you ducking work.`, 1.7);
      return;
    }

    if (a.kind === "jobThreat") {
      const gang = n.gang;
      if (a.job) a.job.t = Math.max(4, (a.job.t || 10) - 5);
      clearApproach(n);
      addGangStanding(gang, -3);
      provokeGang(n, 4.5);
      if (near && CBZ.flashHint) CBZ.flashHint(`${GANG_NAMES[gang]} move to spoil the job.`, 1.7);
      return;
    }

    if (a.kind === "coverStory") {
      clearApproach(n);
      n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
      if (n.gang >= 0) addGangStanding(n.gang, -1);
      if (near && CBZ.flashHint) CBZ.flashHint(`${who} stops covering for you.`, 1.5);
      return;
    }

    if (a.kind === "coverDebt") {
      n.coverDebt = null;
      clearApproach(n);
      n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
      n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 1);
      if (n.gang >= 0) addGangStanding(n.gang, -1);
      if (CBZ.addCasePressure) CBZ.addCasePressure(5 + (a.cost || 2), { type: "ignored cover debt", heardOnly: true, source: who }, n);
      addBuzz("heat", 4, "ignored-cover-debt");
      if (near && CBZ.flashHint) CBZ.flashHint(`${who} decides that cover should cost you later.`, 1.5);
      return;
    }

    if (a.kind === "crewBackup") {
      clearApproach(n);
      n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
      if (n.gang >= 0) addGangStanding(n.gang, -1);
      if (near && CBZ.flashHint) CBZ.flashHint(`${who} stops waiting to back you up.`, 1.5);
      return;
    }

    if (a.kind === "crewDues") {
      const gang = n.gang;
      clearApproach(n);
      n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
      const debt = addGangDebt(gang, Math.max(2, Math.ceil((a.cost || 3) * 0.65)));
      addGangStanding(gang, -4);
      if (near && CBZ.flashHint) CBZ.flashHint(`${GANG_NAMES[gang]} mark dues unpaid. Debt ${debt}.`, 1.7);
      if (gang >= 0 && debt > 12 && gangStanding(gang) < -8) provokeGang(n, 5);
      return;
    }

      if (a.kind === "stickUp") {
        clearApproach(n);
        n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 1);
        if (a.racketGuard) {
          CBZ.game.racketDebt = Math.min(50, (CBZ.game.racketDebt || 0) + Math.max(2, Math.ceil((a.cost || 3) * 0.55)));
          if (CBZ.addCasePressure) CBZ.addCasePressure(7 + (a.cost || 3), { type: "racket runner" }, n, { corruptHold: true });
          addBuzz("badge", 6, "ignored-racket-runner");
        }
        if (n.gang >= 0) addGangStanding(n.gang, -3);
        if (n.role === "thief") n.huntPlayer = Math.max(n.huntPlayer || 0, 3.5);
        else if (n.gang >= 0 && (a.rivalGang || gangStanding(n.gang) < -10)) provokeGang(n, 4.5);
      if (near && CBZ.flashHint) CBZ.flashHint(a.racketGuard ? `${who} leaves the racket tab open.` : `${who} stops asking and starts watching your pockets.`, 1.6);
      return;
    }

    if (a.kind === "infoSell") {
      clearApproach(n);
      n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
      if (near && CBZ.flashHint) CBZ.flashHint(`${who} sells the guard rumor to somebody else.`, 1.6);
      return;
    }

    if (a.kind === "recantOffer") {
      clearApproach(n);
      const amount = n.reportedPlayerAmount || a.amount || 12;
      n.reportedPlayerT = Math.max(n.reportedPlayerT || 0, 18);
      n.reportedPlayerCred = Math.min(1, (n.reportedPlayerCred || a.credibility || 0.65) + 0.07);
      n.reportedPlayerDoubt = Math.max(0, 1 - n.reportedPlayerCred);
      if (CBZ.addCasePressure) CBZ.addCasePressure(amount * 0.18, { type: "ignored recant", lastKnown: n.reportedPlayerLastKnown, credibility: n.reportedPlayerCred }, n);
      addBuzz("snitch", 4, "ignored-recant");
      if (near && CBZ.flashHint) CBZ.flashHint(`${who} keeps the report alive.`, 1.5);
      return;
    }

    if (a.kind === "witnessFix") {
      const reporter = (a.reporter && alive(a.reporter)) ? a.reporter : findKnownReporter(n);
      clearApproach(n);
      n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
      n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 1);
      if (n.gang >= 0) addGangStanding(n.gang, -1);
      if (reporter && rng() < 0.35) reporter.reportedPlayerT = Math.max(reporter.reportedPlayerT || 0, 16);
      addBuzz("snitch", 3, "ignored-fixer");
      if (near && CBZ.flashHint) CBZ.flashHint(`${who} leaves ${reporterName(reporter)} talking.`, 1.5);
      return;
    }

    if (a.kind === "alibiDeal") {
      clearApproach(n);
      n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 1);
      addBuzz("snitch", 4, "ignored-alibi");
      if (a.memoryType && n.memory && (CBZ.game.cigs || 0) > 0 && rng() < 0.42) {
        sendNpcToSnitch(n, a.heat || 12, { copCrime: a.memoryType === "copCrime", lastKnown: n.memory.lastKnown, type: "ignored alibi" });
        if (near && CBZ.flashHint) CBZ.flashHint(`${who} sells the story to a guard instead.`, 1.6);
        return;
      }
      if (near && CBZ.flashHint) CBZ.flashHint(`${who} stops offering the alibi.`, 1.4);
      return;
    }

    if (a.kind === "heatWarning") {
      clearApproach(n);
      n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
      if (near && CBZ.flashHint) CBZ.flashHint(`${who} stops warning you.`, 1.4);
      return;
    }

    if (a.kind === "copPlea") {
      clearApproach(n);
      n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
      if (CBZ.addComplaint) CBZ.addComplaint(5);
      if (near && CBZ.flashHint) CBZ.flashHint(`${who} tells the block you ignored the problem.`, 1.8);
      return;
    }

    if (a.kind === "copBribe" || a.kind === "copTip" || a.kind === "copTaunt") {
      clearApproach(n);
      if (a.kind === "copTaunt") n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 1);
      return;
    }

    clearApproach(n);
  }

  function isOnTurf(gang, p) {
    if (gang < 0 || !TURF[gang]) return false;
    const t = TURF[gang];
    return Math.hypot(p.x - t.x, p.z - t.z) < 11.5;
  }

  function approachText(n, kind, cost, extra) {
    extra = extra || {};
    const name = n.data.name.replace(/^the |^a |^an /, "");
    if (kind === "gangInvite") return `${name} wants you with ${GANG_NAMES[n.gang]}.`;
    if (kind === "tax" && extra.turfCheckpoint) return `${name} wants ${cost} cigs at the ${GANG_NAMES[n.gang]} checkpoint.`;
    if (kind === "tax") return `${name} demands ${cost} cigs for ${GANG_NAMES[n.gang]} protection.`;
    if (kind === "rumor") return `${name} has prison gossip for you.`;
    if (kind === "favor") return `${name} says ${GANG_NAMES[n.gang]} owe you one.`;
    if (kind === "snitchThreat") return `${name} saw too much and wants ${cost} cigs.`;
    if (kind === "turfWarning") return `${name} says you're standing on ${GANG_NAMES[n.gang]} turf.`;
    if (kind === "deal") return `${name} wants to make a deal.`;
    if (kind === "lookout") return `${name} offers to watch your back for ${cost} cigs.`;
    if (kind === "crewBackup") return `${name} says ${GANG_NAMES[n.gang]} can watch your back.`;
    if (kind === "crewDues") return `${name} wants ${cost} cigs for ${GANG_NAMES[n.gang]} protection dues.`;
    if (kind === "stickUp" && extra.racketGuard) return `${name} says ${extra.racketGuard} sent word: ${cost} cigs keeps the clean guards out of it.`;
    if (kind === "stickUp") return `${name} wants ${cost} cigs to leave your pockets alone.`;
    if (kind === "diversion") return `${name} can pull guard eyes off you for ${cost} cigs.`;
    if (kind === "stashCover") return `${name} can hide your money trail for ${cost} cigs.`;
    if (kind === "racketCover") return `${name} can keep bent cops off your trail for ${cost} cigs.`;
    if (kind === "coverDebt") return `${name} lied to ${extra.guard || "a guard"} for you and wants ${cost} cigs.`;
    if (kind === "witnessFix") return `${name} can pressure ${extra.targetName || "the witness"}${extra.caseSourceCount > 1 ? " before the reports stack" : ""} for ${cost} cigs.`;
    if (kind === "recantOffer") return `${name} can walk back their report for ${cost} cigs.`;
    if (kind === "debtCollect") return `${name} says ${GANG_NAMES[n.gang]} want ${cost} cigs on your debt.`;
    if (kind === "buyItem") return `${name} wants to buy your ${extra.item || cost}.`;
    if (kind === "gangJob") return `${name} has ${extra.job ? extra.job.label.toLowerCase() : "work"} for ${GANG_NAMES[n.gang]}.`;
    if (kind === "gangParley") {
      if (extra.parleyMode === "recruit") return `${name} wants a sit-down about joining ${GANG_NAMES[n.gang]}.`;
      if (extra.parleyMode === "work") return `${name} wants to talk crew work for ${GANG_NAMES[n.gang]}.`;
      if (extra.parleyMode === "truce") return `${name} wants ${cost} cigs to settle things with ${GANG_NAMES[n.gang]}.`;
      return `${name} wants a leader-to-leader word for ${GANG_NAMES[n.gang]}.`;
    }
    if (kind === "jobThreat") return `${name} wants ${cost} cigs to stop pressing your job.`;
    if (kind === "heatWarning") return extra.caseSourceCount > 1
      ? `${name} says the case has ${extra.caseSourceCount} sources and guards are moving.`
      : `${name} says guards are sweeping your last spot.`;
    if (kind === "alibiDeal") return extra.caseSourceCount > 1
      ? `${name} can muddy ${extra.caseSourceCount} reports for ${cost} cigs.`
      : `${name} can sell you an alibi for ${cost} cigs.`;
    if (kind === "coverStory") return extra.caseSourceCount > 1
      ? `${name} can give guards a cover story against ${extra.caseSourceCount} reports.`
      : `${name} can give guards a cover story.`;
    if (kind === "infoSell") return extra.caseSourceCount > 1
      ? `${name} knows which ${extra.caseSourceCount} sources guards believe.`
      : `${name} knows where guards are looking.`;
    if (kind === "reputation") {
      if (extra.repKind === "fear") return `${name} has heard what you do to people.`;
      if (extra.repKind === "wealth") return `${name} heard you are carrying cigs.`;
      if (extra.repKind === "badge") return `${name} heard you are paying bent cops.`;
      if (extra.repKind === "snitch") return `${name} knows the block is talking to guards.`;
      if (extra.repKind === "debt") return `${name} heard gangs are keeping a tab on you.`;
      return `${name} has heard your name around the block.`;
    }
    if (kind === "copBribe") return `${name} offers ${extra.price || 3} cigs to look away.`;
    if (kind === "copTip") return `${name} has a tip about trouble in the block.`;
    if (kind === "copPlea") return `${name} asks for protection from gang pressure.`;
    if (kind === "copTaunt") return `${name} is testing your badge.`;
    return `${name} wants a word.`;
  }

  function approachMotive(kind, extra) {
    extra = extra || {};
    if (extra.motive) return extra.motive;
    if (extra.racketGuard) return `${extra.racketGuard} sent word`;
    if (kind === "racketCover") return extra.racketDebt ? "bent-cop tab" : "badge rumor";
    if (kind === "coverDebt") return `covered you from ${extra.guard || "a guard"}`;
    if (extra.watched) return "watched you first";
    if (extra.rumorSource) return `heard it from ${extra.rumorSource}`;
    if (extra.socialRead === "payer") return "you paid before";
    if (extra.socialRead === "helper") return "you helped before";
    if (extra.socialRead === "threats") return "word of threats";
    if (extra.turfCheckpoint) return extra.tollReason ? `checkpoint: ${extra.tollReason}` : "turf checkpoint";
    if (extra.socialRead === "debt-pressure") return "debt pressure";
    if (extra.socialRead === "cash-pressure") return "money pressure";
    if (extra.thresholdPressure) return "gang threshold";
    if (extra.caseSourceCount > 1) return `${extra.caseSourceCount} case sources`;
    if (extra.caseCredibility > 0.72) return "solid case";
    if (extra.targetName) return `witness: ${extra.targetName}`;
    if (extra.source) return `source: ${extra.source}`;
    if (extra.debt) return "gang debt";
    if (extra.stashItems) return "stash noticed";
    if (extra.rivalGang) return "rival pressure";
    if (kind === "copTip") return "block intel";
    if (kind === "copBribe") return "contraband risk";
    if (kind === "gangJob") return "crew work";
    if (kind === "gangParley") return "crew politics";
    return "";
  }

  function startApproach(n, kind, cost, extra) {
    if (cost > 0) {
      const sp = socialProfile();
      const payerRead = Math.max(0, (sp.paid || 0) + (sp.exploited || 0) - (sp.threatened || 0) - (sp.refused || 0));
      const scaryRead = Math.max(0, (sp.threatened || 0) - (sp.paid || 0));
      const unreliableRead = Math.max(0, (sp.refused || 0) + (sp.bargained || 0) - (sp.helped || 0));
      if (kind === "tax" || kind === "crewDues" || kind === "stickUp" || kind === "debtCollect" || kind === "snitchThreat" || kind === "recantOffer") {
        cost += Math.min(4, Math.floor(payerRead / 2));
        cost -= Math.min(2, Math.floor(scaryRead / 3));
      }
      if (kind === "alibiDeal" || kind === "infoSell" || kind === "witnessFix" || kind === "recantOffer" || kind === "stashCover" || kind === "racketCover" || kind === "coverDebt") {
        cost += Math.min(3, Math.floor(unreliableRead / 2));
      }
      const trustCut = Math.floor(Math.max(0, n.playerTrust || 0) / 3);
      const grudgeTax = Math.floor(Math.max(0, n.playerGrudge || 0) / 3);
      const fearCut = kind === "snitchThreat" || kind === "recantOffer" || kind === "tax" ? Math.floor(Math.max(0, n.playerFear || 0) / 5) : 0;
      cost = Math.max(1, cost - trustCut - fearCut + grudgeTax);
    }
    n.aiState = "approachPlayer";
    n.approach = {
      kind,
      cost: cost || 0,
      t: 9,
      greeted: false,
      msg: (extra && extra.msg) || approachText(n, kind, cost || 0, extra),
      motive: approachMotive(kind, extra),
    };
    if (extra) Object.assign(n.approach, extra);
    n.foe = null;
    n.pause = 0;
    emote(n,
      kind === "tax" || kind === "snitchThreat" || kind === "buyItem" || kind === "copBribe" || kind === "jobThreat" || kind === "infoSell" || kind === "stashCover" || kind === "witnessFix" || kind === "recantOffer" || kind === "crewDues" || kind === "stickUp" || kind === "alibiDeal" || kind === "racketCover" || kind === "coverDebt" ? "$" :
        kind === "turfWarning" || kind === "heatWarning" || kind === "copTaunt" || kind === "copTip" ? "!" :
          kind === "favor" || kind === "copPlea" || kind === "crewBackup" || kind === "gangJob" || kind === "gangParley" || kind === "coverStory" || kind === "reputation" ? "+" : "?"
    );
    callGangPressure(n, kind, extra || {});
  }

  function startRacketRunner(guard) {
    const g = CBZ.game || {};
    if (g.role === "cop" || (g.racketProtectionT || 0) > 0) return false;
    const debt = g.racketDebt || 0;
    const cigs = g.cigs || 0;
    if (cigs < 3 && debt < 3) return false;
    if (playerApproachBusy()) return false;

    let best = null, bs = -Infinity;
    for (const n of CBZ.npcs || []) {
      if (!alive(n) || n.role === "merchant" || n.role === "dealer" || n.approach) continue;
      if (n.aiState === "fight" || n.aiState === "snitch" || n.huntPlayer > 0) continue;
      const d = playerDist(n);
      if (d < 5 || d > 14.5) continue;
      const p = n.personality || {};
      const standing = n.gang >= 0 ? gangStanding(n.gang) : 0;
      const sameGang = CBZ.player.gang != null && n.gang === CBZ.player.gang;
      const score =
        (p.greed || 0.5) * 1.8 +
        (p.nerve || 0.5) * 0.9 +
        (n.role === "thief" ? 1.1 : 0) +
        Math.max(0, -standing) * 0.018 +
        debt * 0.035 -
        (sameGang ? 0.9 : 0) -
        d * 0.045;
      if (score > bs) { bs = score; best = n; }
    }
    if (!best || bs < 0.25) return false;

    const guardName = guard && guard.data ? actorName(guard) : ((g.racketGuard || "a bent cop"));
    const p = best.personality || {};
    const cost = Math.min(Math.max(1, cigs), Math.max(3,
      Math.ceil(Math.max(0, debt) * 0.45) +
      Math.ceil(cigs / 12) +
      Math.floor((p.greed || 0.5) * 5)
    ));
    startApproach(best, "stickUp", cost, {
      racketGuard: guardName,
      racketDebt: debt,
      rivalGang: CBZ.player.gang != null && best.gang >= 0 && best.gang !== CBZ.player.gang,
      msg: `${actorName(best)} says ${guardName} sent word: ${cost} cigs or clean guards hear your name.`,
    });
    best.approachCD = 0;
    addBuzz("badge", 7 + Math.min(8, debt * 0.25), "racket-runner");
    if (CBZ.flashHint && playerDist(best) < 18) CBZ.flashHint(`${guardName}'s racket sends a runner.`, 1.6);
    return true;
  }

  function itemValue(item) {
    return (CBZ.econ && CBZ.econ.ITEMS && CBZ.econ.ITEMS[item] && CBZ.econ.ITEMS[item].value) || 5;
  }

  function wantedItemFor(n) {
    const inv = (CBZ.game && CBZ.game.inventory) || {};
    const items = Object.keys(inv).filter((k) => (inv[k] || 0) > 0 && k !== "Gun");
    if (!items.length) return null;
    const wants = n.role === "dealer"
      ? ["Pills", "Powder", "Pruno Hooch", "Burner Phone"]
      : n.role === "thief"
        ? ["Burner Phone", "Lighter", "Soap", "Energy Bar", "Shiv"]
        : ["Ramen", "Shiv", "Energy Bar", "Burner Phone", "Lighter", "Soap"];
    for (const item of wants) if ((inv[item] || 0) > 0) return item;
    return items[0];
  }

  function stashPressure() {
    const g = CBZ.game || {};
    const inv = g.inventory || {};
    const stash = Object.keys(inv).filter((k) => (inv[k] || 0) > 0 && k !== "Gun" && k !== "Keycard").length;
    return {
      cigs: g.cigs || 0,
      stash,
      active: (g.lowProfileT || 0) > 0,
      score: Math.max(0, ((g.cigs || 0) - 10) * 1.4) + stash * 6 + (((g.blockRumor && g.blockRumor.wealth) || 0) * 0.22),
    };
  }

  function crewDuesCost(n) {
    const g = CBZ.game || {};
    const cigs = g.cigs || 0;
    const standing = n.gang >= 0 ? Math.max(0, gangStanding(n.gang)) : 0;
    const debt = n.gang >= 0 ? gangDebt(n.gang) : 0;
    const p = (n && n.personality) || {};
    return Math.max(2, Math.min(cigs,
      2 +
      Math.ceil(cigs / 10) +
      Math.ceil(debt * 0.35) +
      Math.floor(standing / 35) +
      Math.floor((p.greed || 0.5) * 3)
    ));
  }

  function stickUpCost(n, profile) {
    const g = CBZ.game || {};
    const cigs = g.cigs || 0;
    const p = (n && n.personality) || {};
    const rivalGang = CBZ.player.gang != null && n.gang >= 0 && n.gang !== CBZ.player.gang;
    const standing = n.gang >= 0 ? gangStanding(n.gang) : 0;
    const heatTax = ((g.detection || 0) > 28 || (g.witnessReportT || 0) > 0) ? 1 : 0;
    return Math.max(2, Math.min(cigs,
      2 +
      Math.ceil(cigs / 9) +
      Math.floor((p.greed || 0.5) * 5) +
      (rivalGang ? 2 : 0) +
      (standing < -10 ? 2 : 0) +
      Math.min(3, Math.floor(((profile && profile.score) || 0) / 18)) +
      heatTax
    ));
  }

  function gangParleyFor(n) {
    const gang = n && n.gang != null ? n.gang : -1;
    const standing = gang >= 0 ? gangStanding(gang) : 0;
    const debt = gang >= 0 ? gangDebt(gang) : 0;
    const cigs = (CBZ.game && CBZ.game.cigs) || 0;
    const playerGang = CBZ.player ? CBZ.player.gang : null;
    const sameGang = playerGang != null && playerGang === gang;
    const rivalGang = playerGang != null && playerGang !== gang;
    let mode = "warning";
    if (playerGang == null && standing >= -8) mode = "recruit";
    else if (sameGang || standing > 28) mode = "work";
    else if (debt > 0 || standing < -16 || rivalGang) mode = "truce";
    const pressure = Math.ceil(Math.max(0, -standing) / 13) + Math.ceil(debt * 0.55) + (rivalGang ? 3 : 0);
    const cost = mode === "truce" ? Math.min(cigs, Math.max(3, pressure)) : 0;
    return { mode, cost, standing, debt, rivalGang, sameGang };
  }

  function actorName(a) {
    return a && a.data ? a.data.name.replace(/^the |^a |^an /, "") : "Someone";
  }

  function crewRole(n) {
    return (n && (n.crewRole || (n.data && n.data.crewRole))) || "";
  }

  function crewRoleScore(n, kind) {
    const role = crewRole(n);
    if (!role || !kind) return 0;
    if (role === "shotcaller") {
      if (kind === "gangParley" || kind === "gangInvite" || kind === "gangJob") return 5.2;
      if (kind === "crewBackup" || kind === "coverStory" || kind === "reputation") return 2.4;
      if (kind === "tax" || kind === "debtCollect") return 1.4;
    }
    if (role === "collector") {
      if (kind === "debtCollect" || kind === "tax" || kind === "crewDues") return 5.6;
      if (kind === "stickUp" || kind === "pocket") return 3.8;
      if (kind === "stashCover" || kind === "buyItem") return 1.7;
    }
    if (role === "lookout") {
      if (kind === "heatWarning" || kind === "coverStory" || kind === "infoSell" || kind === "cover") return 5.4;
      if (kind === "snitch" || kind === "copTip" || kind === "witnessFix") return 2.4;
      if (kind === "crewBackup") return 1.8;
    }
    if (role === "enforcer") {
      if (kind === "crewBackup" || kind === "turfWarning" || kind === "jobThreat" || kind === "gangParley") return 4.7;
      if (kind === "debt" || kind === "debtCollect" || kind === "fear") return 2.8;
      if (kind === "stickUp" || kind === "tax") return 1.8;
    }
    if (role === "runner") {
      if (kind === "deal" || kind === "buyItem" || kind === "stashCover") return 4.8;
      if (kind === "alibiDeal" || kind === "infoSell" || kind === "pocket") return 2.7;
      if (kind === "copBribe") return 1.8;
    }
    return 0;
  }

  function pressureTactic(n, kind, slot) {
    const role = crewRole(n);
    if (role === "enforcer") return "block";
    if (role === "collector") return "lean";
    if (role === "lookout") return "watch";
    if (role === "runner") return "cutoff";
    if (role === "shotcaller") return "command";
    if (kind === "crewDues" || kind === "gangParley") return slot === 0 ? "command" : "watch";
    if (kind === "stickUp" || kind === "debtCollect" || kind === "tax") return slot === 0 ? "lean" : "block";
    return slot === 0 ? "block" : "watch";
  }

  function pressureEmote(tactic, hostile) {
    if (tactic === "lean" || tactic === "cutoff") return "$";
    if (tactic === "watch") return "?";
    if (tactic === "command") return "+";
    return hostile ? "!" : "+";
  }

  function knownSnitchCost(n) {
    const g = CBZ.game || {};
    const p = (n && n.personality) || {};
    const amount = (n && n.reportedPlayerAmount) || 12;
    const cred = (n && n.reportedPlayerCred != null) ? n.reportedPlayerCred : 0.65;
    return Math.max(2, Math.min(18,
      Math.ceil(amount / 7) +
      Math.floor((g.detection || 0) / 28) +
      Math.floor((p.greed || 0.5) * 5) +
      Math.floor(cred * 4)
    ));
  }

  function racketCoverCost(n) {
    const g = CBZ.game || {};
    const p = (n && n.personality) || {};
    const standing = n && n.gang >= 0 ? gangStanding(n.gang) : 0;
    const allyCut = (CBZ.player && n && CBZ.player.gang === n.gang) || (n && n.gang >= 0 && gangProtection(n.gang) > 0) || standing > 24 ? 2 : 0;
    return Math.max(3, Math.min(g.cigs || 0,
      3 +
      Math.ceil((g.racketDebt || 0) / 7) +
      Math.ceil(Math.max(0, -(g.racketStanding || 0)) / 14) +
      Math.floor((p.greed || 0.5) * 5) -
      allyCut
    ));
  }

  function coverDebtCost(n) {
    const g = CBZ.game || {};
    if ((g.cigs || 0) <= 0) return 0;
    const p = (n && n.personality) || {};
    const debt = (n && n.coverDebt) || {};
    const standing = n && n.gang >= 0 ? gangStanding(n.gang) : 0;
    const allyCut = (CBZ.player && n && CBZ.player.gang === n.gang) || (n && n.gang >= 0 && gangProtection(n.gang) > 0) || standing > 24 ? 2 : 0;
    const heat = Math.max(0, (debt.heat || 0) + ((g.detection || 0) * 0.12) + ((g.witnessReportT || 0) > 0 ? 4 : 0));
    return Math.max(2, Math.min(g.cigs || 0,
      2 +
      Math.ceil(heat / 13) +
      Math.floor((p.greed || 0.5) * 4) -
      allyCut
    ));
  }

  function markPlayerReported(n, amount, meta, guard, lead) {
    if (!n) return;
    meta = meta || {};
    const lastKnown = (lead || meta.lastKnown || {});
    const p = n.personality || {};
    const heard = !!(lastKnown.heardOnly || meta.heardOnly);
    let credibility = meta.credibility != null ? meta.credibility : (heard ? 0.42 : 0.68);
    credibility += (p.snitch || 0.5) * 0.18 + (p.nerve || 0.5) * 0.12;
    credibility += Math.min(0.16, Math.max(0, n.playerGrudge || 0) * 0.018);
    credibility -= Math.min(0.14, Math.max(0, n.playerTrust || 0) * 0.014);
    credibility -= Math.min(0.12, Math.max(0, n.playerFear || 0) * 0.012);
    if (meta.forceSnitch) credibility += 0.08;
    if (meta.copCrime) credibility += 0.05;
    credibility = Math.max(0.18, Math.min(0.98, credibility));
    n.reportedPlayerT = Math.max(n.reportedPlayerT || 0, meta.copCrime ? 36 : 46);
    n.reportedPlayerAmount = amount || 12;
    n.reportedPlayerCop = !!meta.copCrime;
    n.reportedPlayerKind = meta.copCrime ? "complaint" : (meta.heardOnly ? "noise report" : "witness report");
    n.reportedPlayerGuard = guard && guard.data ? actorName(guard) : (guard && guard.corrupt ? "a bent guard" : "a guard");
    n.reportedPlayerCred = Math.max(n.reportedPlayerCred || 0, credibility);
    n.reportedPlayerDoubt = Math.max(0, 1 - n.reportedPlayerCred);
    n.reportedPlayerLastKnown = {
      x: lastKnown.x != null ? lastKnown.x : CBZ.player.pos.x,
      z: lastKnown.z != null ? lastKnown.z : CBZ.player.pos.z,
      type: lastKnown.type || meta.type || "crime",
      heardOnly: heard,
    };
    n.reportedPlayerCount = (n.reportedPlayerCount || 0) + 1;
    n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 1);
    spreadReportGossip(n, amount || 12, meta);
  }

  function spreadReportGossip(reporter, amount, meta) {
    if (!reporter || !reporter.group || !CBZ.npcs) return 0;
    meta = meta || {};
    const source = actorName(reporter);
    const playerGang = CBZ.player && CBZ.player.gang != null ? CBZ.player.gang : null;
    const reportGang = reporter.gang != null ? reporter.gang : -1;
    const cred = reporter.reportedPlayerCred != null ? reporter.reportedPlayerCred : (meta.heardOnly ? 0.45 : 0.68);
    const kind = meta.copCrime ? "badge" : "snitch";
    const base = Math.max(10, Math.min(62, (amount || 12) * 0.72 + cred * 18 + (meta.heardOnly ? -4 : 5)));
    let listeners = 0;

    addBuzz(kind, Math.min(13, 3 + base * 0.13), source);
    if (!meta.copCrime) addBuzz("heat", Math.min(8, 2 + (amount || 12) * 0.08), source);
    if (playerGang != null && reportGang === playerGang) addGangStanding(reportGang, -3);
    else if (playerGang != null && reportGang >= 0 && reportGang !== playerGang) addGangStanding(reportGang, 1);

    for (const m of CBZ.npcs) {
      if (m === reporter || !alive(m) || !m.group || !m.data || m.role === "merchant") continue;
      const d = Math.hypot(m.group.position.x - reporter.group.position.x, m.group.position.z - reporter.group.position.z);
      if (d > 18) continue;
      const falloff = 1 - d / 24;
      const strength = base * falloff;
      if (strength < 8) continue;
      listeners++;
      rememberBlockRead(m, kind, strength, source);

      const samePlayerCrew = playerGang != null && m.gang === playerGang;
      const sameReporterCrew = reportGang >= 0 && m.gang === reportGang;
      const rivalReporter = reportGang >= 0 && m.gang >= 0 && m.gang !== reportGang;
      if (samePlayerCrew || (m.gang >= 0 && gangProtection(m.gang) > 0) || gangStanding(m.gang) > 24) {
        bumpSocial(m, "playerTrust", 0.18 + strength * 0.006, -8, 14);
        m.approachCD = Math.min(m.approachCD || 4, 0.8 + rng() * 2.2);
      } else if (sameReporterCrew && (playerGang == null || playerGang !== reportGang)) {
        bumpSocial(m, "playerGrudge", 0.22 + strength * 0.005, 0, 14);
        if ((m.personality && m.personality.greed) > 0.42) m.approachCD = Math.min(m.approachCD || 4, 1.4 + rng() * 2.6);
      } else if (rivalReporter && canFixReporter(m, reporter)) {
        bumpSocial(m, "playerTrust", 0.12 + strength * 0.004, -8, 14);
        m.approachCD = Math.min(m.approachCD || 5, 1.0 + rng() * 3.0);
      } else if ((m.personality && m.personality.snitch) > 0.68 && !meta.copCrime) {
        m.approachCD = Math.min(m.approachCD || 5, 2.2 + rng() * 3.0);
      }
    }

    reporter.reportedPlayerSpread = Math.max(reporter.reportedPlayerSpread || 0, listeners);
    if (listeners > 0 && CBZ.flashHint && playerDist(reporter) < 18) {
      CBZ.flashHint(`${source}'s report starts moving through the block.`, 1.5);
    }
    return listeners;
  }

  function clearKnownReport(n) {
    if (!n) return;
    if (CBZ.reduceCasePressure) CBZ.reduceCasePressure((n.reportedPlayerAmount || 8) + 4, actorName(n));
    n.reportedPlayerT = 0;
    n.reportedPlayerAmount = 0;
    n.reportedPlayerCop = false;
    n.reportedPlayerKind = null;
    n.reportedPlayerGuard = null;
    n.reportedPlayerCred = 0;
    n.reportedPlayerDoubt = 0;
    n.reportedPlayerLastKnown = null;
    n.reportedPlayerSpread = 0;
  }

  function findKnownReporter(except) {
    let best = null, bs = -Infinity;
    for (const m of CBZ.npcs || []) {
      if (m === except || !alive(m) || !(m.reportedPlayerT > 0) || !m.data) continue;
      const amount = m.reportedPlayerAmount || 12;
      const fresh = m.reportedPlayerT || 0;
      const cred = m.reportedPlayerCred == null ? 0.65 : m.reportedPlayerCred;
      const d = Math.hypot(CBZ.player.pos.x - m.group.position.x, CBZ.player.pos.z - m.group.position.z);
      const score = fresh * 0.45 + amount * 0.8 + cred * 6 - d * 0.08 + (m.reportedPlayerCop ? 4 : 0);
      if (score > bs) { bs = score; best = m; }
    }
    return best;
  }

  function witnessFixCost(n, reporter) {
    const g = CBZ.game || {};
    const p = (n && n.personality) || {};
    const amount = (reporter && reporter.reportedPlayerAmount) || 12;
    const cred = reporter && reporter.reportedPlayerCred != null ? reporter.reportedPlayerCred : 0.65;
    const sameGang = CBZ.player && CBZ.player.gang != null && n.gang === CBZ.player.gang;
    const protectedHere = n.gang >= 0 && gangProtection(n.gang) > 0;
    const standing = n.gang >= 0 ? gangStanding(n.gang) : 0;
    const allyCut = sameGang || protectedHere || standing > 24 ? 2 : 0;
    return Math.max(2, Math.min(g.cigs || 0,
      Math.ceil(amount / 7) +
      Math.ceil(((g.detection || 0) + ((g.witnessReportT || 0) > 0 ? 12 : 0)) / 24) +
      Math.floor((p.greed || 0.5) * 5) -
      allyCut +
      Math.floor(cred * 3)
    ));
  }

  function canFixReporter(n, reporter) {
    if (!n || !reporter || n === reporter || n.role === "merchant" || n.role === "dealer") return false;
    if (!alive(n) || !alive(reporter)) return false;
    const p = n.personality || {};
    const playerGang = CBZ.player && CBZ.player.gang != null ? CBZ.player.gang : null;
    const sameGang = playerGang != null && n.gang === playerGang;
    const protectedHere = n.gang >= 0 && gangProtection(n.gang) > 0;
    const standing = n.gang >= 0 ? gangStanding(n.gang) : 0;
    const rivalReporter = n.gang >= 0 && reporter.gang >= 0 && n.gang !== reporter.gang;
    return sameGang || protectedHere || standing > 18 || rivalReporter || n.role === "thief" || p.greed > 0.58;
  }

  function reporterName(reporter) {
    return reporter && reporter.data ? actorName(reporter) : "the witness";
  }

  function caseLead() {
    const s = CBZ.caseSummary && CBZ.caseSummary();
    return s && s.heat > 8 ? s : null;
  }

  function caseSources(limit) {
    if (CBZ.caseSources) return CBZ.caseSources(limit || 4) || [];
    const c = caseLead();
    return c && c.reports ? c.reports.slice(0, limit || 4) : [];
  }

  function casePressureProfile() {
    const summary = caseLead();
    const reports = caseSources(4);
    const top = reports[0] || summary || null;
    let solid = 0, weak = 0, named = 0, corrupt = 0;
    for (const r of reports) {
      if (!r) continue;
      if (r.weak || (r.credibility || 0) < 0.52 || r.heardOnly) weak++;
      else solid++;
      if (r.source && r.source !== "witness") named++;
      if (r.corrupt) corrupt++;
    }
    const heat = summary ? (summary.heat || 0) : 0;
    const credibility = top && top.credibility != null ? top.credibility : (summary && summary.credibility != null ? summary.credibility : 0);
    return {
      summary,
      reports,
      top,
      heat,
      count: reports.length,
      named,
      solid,
      weak,
      corrupt,
      credibility,
      active: !!summary && (heat > 8 || reports.length > 0),
      score: heat + solid * 9 + named * 4 + Math.max(0, credibility - 0.5) * 12 - weak * 2,
    };
  }

  function caseSourceName(profile, fallback) {
    const p = profile || casePressureProfile();
    return (p.top && p.top.source) || (p.summary && p.summary.source) || fallback || "guard chatter";
  }

  function searchSource(fallback) {
    const g = CBZ.game || {};
    if (g.lastKnown && g.lastKnown.source) return g.lastKnown.source;
    const c = caseLead();
    if (c && c.source) return c.source;
    return fallback || "guard chatter";
  }

  function rumorLine(n) {
    const who = actorName(n);
    const g = CBZ.game || {};
    const standing = n.gang >= 0 ? gangStanding(n.gang) : 0;
    const debt = n.gang >= 0 ? gangDebt(n.gang) : 0;
    const cover = n.gang >= 0 ? gangProtection(n.gang) : 0;
    const crew = CBZ.player && CBZ.player.gang != null ? CBZ.player.gang : null;
    const sameCrew = crew != null && n.gang === crew;
    const rivalCrew = crew != null && n.gang >= 0 && n.gang !== crew;

    const activeSnitch = (CBZ.npcs || []).find((m) => alive(m) && m.aiState === "snitch");
    if (activeSnitch) {
      const d = Math.round(playerDist(activeSnitch));
      return `${who}: ${actorName(activeSnitch)} is running to snitch, about ${d}m out. Stop them or buy cover fast.`;
    }

    const knownReporter = (CBZ.npcs || []).find((m) => alive(m) && (m.reportedPlayerT || 0) > 0);
    if (knownReporter) {
      const d = Math.round(playerDist(knownReporter));
      const guard = knownReporter.reportedPlayerGuard || "a guard";
      if (sameCrew || cover > 0 || standing > 28) {
        return `${who}: ${actorName(knownReporter)} already talked to ${guard}. Confront them or pay for a counter-rumor while it is fresh.`;
      }
      return `${who}: ${actorName(knownReporter)} sold your last-known ${d}m from you. People remember who talked.`;
    }

    if (g.lastKnown && g.lastKnown.t > 0) {
      const src = g.lastKnown.source || "somebody";
      const age = Math.ceil(g.lastKnown.t);
      if (sameCrew || cover > 0 || standing > 28) {
        return `${who}: Guards are searching off ${src}'s lead. Your crew can still muddy it for ${age}s.`;
      }
      if (rivalCrew) {
        return `${who}: ${GANG_NAMES[n.gang]} heard ${src} put guards on you. Rivals may sell that twice.`;
      }
      return `${who}: Guards are working a last-known from ${src}. Moving now beats waiting.`;
    }

    const activeCase = caseLead();
    if (activeCase && activeCase.heat > 14) {
      const src = activeCase.source || "a witness";
      if (sameCrew || cover > 0 || standing > 28) return `${who}: ${src}'s story is still in the case file. Buy silence or get a cover story before it hardens.`;
      if (rivalCrew) return `${who}: ${src} put a case on you. Rivals know that kind of pressure sells.`;
      return `${who}: Your wanted heat has a source now: ${src}. Random hiding won't erase a case file.`;
    }

    const bent = (CBZ.guards || []).filter((gd) => gd && gd.corrupt && !gd.dead && !(gd.ko > 0));
    if (bent.length && (g.detection > 18 || (g.cigs || 0) >= 8 || rng() < 0.34)) {
      const gd = bent[Math.floor(rng() * bent.length)];
      return `${who}: ${actorName(gd)} is bent. Payoffs bury heat, but they will tax you harder if witnesses talk.`;
    }

    if (g.gangJob) {
      const job = g.gangJob;
      const remain = Math.ceil(job.t || 0);
      if (n.gang === job.gang) return `${who}: Finish ${job.label.toLowerCase()} and ${GANG_NAMES[job.gang]} cover gets stronger. ${remain}s left.`;
      if (n.gang === job.rival) return `${who}: That job crosses ${GANG_NAMES[n.gang]}. Expect pressure unless you pay or scare someone off.`;
      return `${who}: Jobs are how gangs decide if you are useful or just noise.`;
    }

    if (n.gang >= 0 && debt > 0) {
      return `${who}: Your tab with ${GANG_NAMES[n.gang]} is ${debt} cigs. Debt makes their people tax and jump you.`;
    }

    if (n.gang >= 0 && cover > 0) {
      return `${who}: ${GANG_NAMES[n.gang]} cover has ${Math.ceil(cover)}s left. Snitches think twice while it lasts.`;
    }

    if (n.gang >= 0 && Math.abs(standing) > 18) {
      return `${who}: ${GANG_NAMES[n.gang]} ${standing > 0 ? "trust" : "hate"} you now. Respect changes who lies, fights, or sells you out.`;
    }

    const buzz = topBuzz();
    if (buzz.score > 22) {
      if (buzz.kind === "fear") return `${who}: People talk about who you dropped. Some back off, rivals bring numbers.`;
      if (buzz.kind === "wealth") return `${who}: Word says you are carrying cigs. That brings friends, thieves, and taxes.`;
      if (buzz.kind === "badge") return `${who}: Bent cops are in your story now. Protection helps until the tab comes due.`;
      if (buzz.kind === "snitch") return `${who}: The block is talking to guards. Watch who suddenly wants distance.`;
      if (buzz.kind === "debt") return `${who}: Gang debt travels faster than you do. Pay it down or expect collectors.`;
      if (buzz.kind === "heat") return `${who}: The heat on you is block gossip now, not just guard business.`;
    }

    if ((g.cigs || 0) >= 18) return `${who}: Walking around fat with cigs makes thieves, gangs, and bent cops notice you. Spend it or get taxed.`;
    if ((g.detection || 0) > 24) return `${who}: Wanted heat is not magic. Witnesses and last-known reports decide who actually chases.`;
    return n.data.tip || (n.data.talk && n.data.talk[(rng() * n.data.talk.length) | 0]) || "Keep your eyes open.";
  }

  function findCopTipSuspect(source) {
    let best = null, bs = -Infinity;
    for (const m of CBZ.npcs) {
      if (m === source || !alive(m) || m.role === "merchant") continue;
      const d = playerDist(m);
      let score = -d * 0.045;
      if (m.huntPlayer > 0 || m.aiState === "fight") score += 3.4;
      if (source.gang >= 0 && m.gang >= 0 && m.gang !== source.gang) score += 1.9;
      if (m.role === "dealer" || m.role === "thief") score += 1.2;
      if ((m.playerGrudge || 0) > 4) score += 0.8;
      if (m.copMarked > 0) score -= 3;
      if (score > bs) { bs = score; best = m; }
    }
    return best;
  }

  function markCopSuspect(source, suspect, seconds) {
    if (!suspect || !alive(suspect)) return false;
    suspect.copMarked = Math.max(suspect.copMarked || 0, seconds || 22);
    suspect.playerGrudge = Math.min(12, (suspect.playerGrudge || 0) + 1);
    emote(suspect, "!");
    if (suspect.aiState === "wander") {
      suspect.aiState = "flee";
      suspect.fleeT = 1.4 + rng() * 1.4;
    }
    if (source) {
      source.playerTrust = Math.min(14, (source.playerTrust || 0) + 2);
      if (source.gang >= 0) addGangStanding(source.gang, 2);
    }
    return true;
  }

  function considerCopApproach(n, d, p) {
    if (n.role === "merchant") return false;
    const complaints = (CBZ.game && CBZ.game.complaints) || 0;
    const heat = (CBZ.game && CBZ.game.detection) || 0;
    const standing = n.gang >= 0 ? gangStanding(n.gang) : 0;
    const debt = n.gang >= 0 ? gangDebt(n.gang) : 0;
    const suspect = findCopTipSuspect(n);

    if ((n.role === "dealer" || n.role === "thief") && p.greed > 0.42 && p.nerve > 0.18 && d < 10.5 && rng() < 0.052) {
      const price = Math.max(2, 3 + Math.floor(p.greed * 7) + Math.floor((complaints + heat) / 45));
      startApproach(n, "copBribe", 0, { price });
      return true;
    }

    if (suspect && p.snitch > 0.48 && d < 12 && rng() < (complaints > 25 ? 0.055 : 0.034)) {
      const gangName = suspect.gang >= 0 ? GANG_NAMES[suspect.gang] : "someone";
      startApproach(n, "copTip", 0, { suspect, msg: `${n.data.name.replace(/^the |^a |^an /, "")} points you toward ${gangName} trouble.` });
      return true;
    }

    if (n.gang >= 0 && (standing < -18 || debt > 6) && p.nerve < 0.62 && d < 11.5 && rng() < 0.040) {
      startApproach(n, "copPlea", 0, { gang: n.gang });
      return true;
    }

    if (p.nerve > 0.68 && d < 9.5 && rng() < (complaints > 45 ? 0.050 : 0.025)) {
      startApproach(n, "copTaunt", 0);
      return true;
    }

    return false;
  }

  function npcWitnessCrime(n, amount, meta) {
    if (!alive(n) || n.role === "merchant" || n.role === "dealer" || n.approach) return false;
    meta = meta || {};
    const p = n.personality || {};
    const cigs = CBZ.game.cigs || 0;
    const baseCost = Math.max(3, Math.ceil((amount || 12) / 7) + Math.floor((p.greed || 0.5) * 5));
    const cost = Math.min(cigs, baseCost);
    n.memory = {
      type: meta.copCrime ? "copCrime" : "crime",
      amount: amount || 12,
      t: meta.heardOnly ? 12 : 22,
      kind: (meta.heardOnly ? "heard:" : "") + (meta.type || "trouble"),
      lastKnown: meta.lastKnown || { x: CBZ.player.pos.x, z: CBZ.player.pos.z, type: meta.type || "crime", heardOnly: !!meta.heardOnly },
    };

    if (cigs >= cost && cost > 0 && p.greed > 0.44 && p.nerve > 0.25 && !meta.forceSnitch) {
      startApproach(n, "snitchThreat", cost, { heat: amount || 12, memoryType: n.memory.type });
      if (CBZ.flashHint && playerDist(n) < 16) {
        const who = n.data.name.replace(/^the |^a |^an /, "");
        CBZ.flashHint(`${who} ${meta.heardOnly ? "heard enough" : "clocked that"} and wants a word.`, 1.8);
      }
      return true;
    }

    return sendNpcToSnitch(n, amount, { copCrime: meta.copCrime, lastKnown: n.memory.lastKnown, type: meta.type, heardOnly: meta.heardOnly });
  }

  function considerPlayerApproach(n, dt) {
    if (n.approachCD > 0) n.approachCD -= dt;
    if (n.approachCD > 0 || n.approach || n.role === "merchant") return;
    if (playerApproachBusy(n)) return;
    if ((CBZ.player.stun || 0) > 0) return;
    const d = playerDist(n);
    if (d < 4.5 || d > APPROACH_FAR) return;

    const p = n.personality || {};
    const heat = CBZ.game.detection || 0;
    const cigs = CBZ.game.cigs || 0;

    if (CBZ.game.role === "cop") {
      considerCopApproach(n, d, p);
      return;
    }

    const sameGang = CBZ.player.gang != null && n.gang === CBZ.player.gang;
    const rivalGang = CBZ.player.gang != null && n.gang >= 0 && n.gang !== CBZ.player.gang;
    const standing = n.gang >= 0 ? gangStanding(n.gang) : 0;
    const protectedHere = n.gang >= 0 && gangProtection(n.gang) > 0;
    const debt = n.gang >= 0 ? gangDebt(n.gang) : 0;
    const buzz = topBuzz();
    const cprof = casePressureProfile();
    const caseHeat = cprof.heat;
    const social = socialProfile();
    const payerRead = Math.max(0, (social.paid || 0) + (social.exploited || 0) - (social.threatened || 0) - (social.refused || 0));
    const scaryRead = Math.max(0, (social.threatened || 0) - (social.paid || 0));
    const helperRead = Math.max(0, (social.helped || 0) + (social.listened || 0) - (social.refused || 0));
    const searchHeat = (CBZ.game.lastKnown && CBZ.game.lastKnown.t > 0) || (CBZ.game.witnessReportT || 0) > 0 || heat > 28 || caseHeat > 14;
    const profile = stashPressure();
    const read = n.blockRead && n.blockRead.t > 0 ? n.blockRead : null;

    if (n.coverDebt && n.coverDebt.t > 0 && cigs >= 2 && d < 12.8 && p.greed > 0.18) {
      const cost = coverDebtCost(n);
      if (cost > 0) {
        startApproach(n, "coverDebt", cost, {
          guard: n.coverDebt.guard || "a guard",
          heat: n.coverDebt.heat || 8,
          source: n.coverDebt.source || actorName(n),
          caseSourceCount: cprof.count,
        });
        return;
      }
    }

    if (read && d < 12.8) {
      const readChance = Math.min(0.072, 0.014 + (read.score || 0) * 0.00072 + (read.source === "gossip" ? 0.006 : 0));
      if (rng() < readChance) {
        n.blockRead.t *= 0.42;
        if (read.kind === "wealth" && cigs >= 8 && p.greed > 0.42) {
          if (!profile.active && (n.role === "thief" || rivalGang || standing < -12) && p.nerve > 0.22) {
            startApproach(n, "stickUp", stickUpCost(n, profile), { rivalGang, stashItems: profile.stash, rumorSource: read.source });
            return;
          }
          if (!profile.active && cigs >= 4 && (n.role === "dealer" || n.role === "thief" || n.gang >= 0)) {
            const cost = Math.min(cigs, Math.max(3, Math.ceil(profile.score / 8) + Math.floor(p.greed * 4)));
            startApproach(n, "stashCover", cost, { stashItems: profile.stash, rumorSource: read.source });
            return;
          }
          startApproach(n, "reputation", 0, { repKind: "wealth", rumorSource: read.source });
          return;
        }
        if (read.kind === "debt" && n.gang >= 0) {
          if (debt > 0 && !sameGang && !protectedHere && cigs > 0) {
            startApproach(n, "debtCollect", Math.min(cigs, Math.max(2, Math.ceil(debt * 0.55) + Math.floor(p.greed * 4))), { debt: true, rumorSource: read.source });
            return;
          }
          if ((sameGang || protectedHere || standing > 22) && cigs >= 6 && p.loyalty > 0.22) {
            startApproach(n, "crewDues", crewDuesCost(n), { debt, rumorSource: read.source });
            return;
          }
          if (!sameGang && !protectedHere && p.nerve > 0.26) {
            startApproach(n, standing < -10 ? "tax" : "turfWarning", standing < -10 ? Math.min(cigs, 3 + Math.floor(p.greed * 5)) : 0, { rumorSource: read.source });
            return;
          }
        }
        if ((read.kind === "snitch" || read.kind === "heat") && searchHeat) {
          const helpful = sameGang || protectedHere || standing > 22 || (n.playerTrust || 0) > 4 || (n.playerFear || 0) > 5;
          const hatesYou = rivalGang || standing < -18 || (n.playerGrudge || 0) > 8;
          if (helpful && !hatesYou) {
            startApproach(n, read.kind === "snitch" && n.gang >= 0 ? "coverStory" : "heatWarning", 0, { source: read.source || searchSource(caseSourceName(cprof, "gossip")), caseSourceCount: cprof.count });
            return;
          }
          if (cigs >= 2 && p.greed > 0.34 && p.nerve > 0.18) {
            const cost = Math.min(cigs, Math.max(2, Math.ceil(Math.max(heat, caseHeat, read.score || 0) / 25) + Math.floor(p.greed * 4)));
            startApproach(n, read.kind === "snitch" && !sameGang && !protectedHere ? "alibiDeal" : "infoSell", cost, {
              source: read.source || searchSource(caseSourceName(cprof, "gossip")),
              heat: Math.max(10, heat * 0.45, caseHeat * 0.65, (read.score || 0) * 0.35),
              memoryType: n.memory && n.memory.type,
              caseSourceCount: cprof.count,
            });
            return;
          }
          startApproach(n, "reputation", 0, { repKind: read.kind, rumorSource: read.source });
          return;
        }
        if (read.kind === "badge") {
          if ((CBZ.game.racketDebt || 0) > 0 && cigs >= 3 && p.greed > 0.36 && p.nerve > 0.22) {
            const helpfulBadge = sameGang || protectedHere || standing > 20 || (n.playerTrust || 0) > 4 || n.role === "dealer";
            if (helpfulBadge && racketCoverCost(n) > 0) {
              startApproach(n, "racketCover", racketCoverCost(n), {
                racketDebt: CBZ.game.racketDebt || 0,
                source: CBZ.game.racketGuard || read.source || "bent cops",
                rumorSource: read.source,
              });
              return;
            }
            startApproach(n, "stickUp", stickUpCost(n, profile), {
              racketGuard: CBZ.game.racketGuard || "a bent cop",
              racketDebt: CBZ.game.racketDebt || 0,
              rivalGang,
              rumorSource: read.source,
            });
            return;
          }
          startApproach(n, "reputation", 0, { repKind: "badge", rumorSource: read.source });
          return;
        }
        if (read.kind === "fear") {
          if ((p.nerve || 0.5) < 0.62) {
            startApproach(n, "reputation", 0, { repKind: "fear", rumorSource: read.source });
            return;
          }
          if (n.gang >= 0 && !sameGang && !protectedHere && p.nerve > 0.68 && standing < 12) {
            startApproach(n, "turfWarning", 0, { rumorSource: read.source });
            return;
          }
        }
      }
    }

    if (n.memory && n.memory.t > 0 && cigs > 0 && p.greed > 0.40 && rng() < 0.045) {
      startApproach(n, "snitchThreat", Math.min(cigs, Math.max(3, Math.ceil(n.memory.amount / 8) + Math.floor(p.greed * 6))), { heat: n.memory.amount || 12, memoryType: n.memory.type });
      return;
    }
    if (payerRead > 2 && cigs > 2 && n.gang >= 0 && !sameGang && !protectedHere && p.greed > 0.36 && p.nerve > 0.24 && rng() < Math.min(0.060, 0.014 + payerRead * 0.004)) {
      startApproach(n, standing < -8 || rivalGang ? "stickUp" : "tax", Math.min(cigs, 2 + Math.floor(p.greed * 5) + Math.floor(payerRead / 3)), { repKind: "wealth", socialRead: "payer" });
      return;
    }
    if (helperRead > 3 && searchHeat && n.gang >= 0 && (sameGang || protectedHere || standing > 12) && p.loyalty > 0.25 && rng() < Math.min(0.055, 0.016 + helperRead * 0.003)) {
      startApproach(n, "coverStory", 0, { source: searchSource(caseSourceName(cprof, "your good word")), socialRead: "helper", caseSourceCount: cprof.count });
      return;
    }
    if (scaryRead > 3 && n.gang >= 0 && !sameGang && !protectedHere && p.nerve > 0.66 && standing < 18 && rng() < Math.min(0.045, 0.010 + scaryRead * 0.003)) {
      startApproach(n, "gangParley", gangParleyFor(n).cost, { parleyMode: "warning", socialRead: "threats" });
      return;
    }
    const reporter = findKnownReporter(n);
    if (reporter && cigs >= 2 && d < 12.5 && canFixReporter(n, reporter)) {
      const cost = witnessFixCost(n, reporter);
      const sameGangReporter = n.gang >= 0 && reporter.gang === n.gang;
      const motive = (n.role === "thief" ? 0.012 : 0) + (sameGang || protectedHere ? 0.018 : 0) + (sameGangReporter ? -0.010 : 0);
      if (cost > 0 && rng() < 0.026 + Math.max(0, standing) * 0.0004 + motive + Math.min(0.022, cprof.score * 0.00045)) {
        startApproach(n, "witnessFix", cost, {
          reporter,
          targetName: reporterName(reporter),
          amount: reporter.reportedPlayerAmount || 12,
          caseSourceCount: cprof.count,
          caseCredibility: cprof.credibility,
        });
        return;
      }
    }
    if (n.isLeader && n.gang >= 0 && d < 12.5 && p.nerve > 0.18) {
      const parley = gangParleyFor(n);
      const meaningful = parley.mode !== "warning" || Math.abs(parley.standing) > 14 || parley.debt > 0 || cigs > 14 || searchHeat;
      if (meaningful && rng() < 0.046) {
        startApproach(n, "gangParley", parley.cost, {
          parleyMode: parley.mode,
          parleyStanding: parley.standing,
          parleyDebt: parley.debt,
        });
        return;
      }
    }
    if (buzz.score > 28 && d < 12) {
      if (buzz.kind === "fear" && p.nerve < 0.52 && rng() < 0.026) {
        startApproach(n, "reputation", 0, { repKind: "fear" });
        return;
      }
      if (buzz.kind === "wealth" && cigs > 8 && p.greed > 0.44 && rng() < 0.032) {
        startApproach(n, n.gang >= 0 && !sameGang && !protectedHere ? "tax" : "reputation",
          n.gang >= 0 && !sameGang && !protectedHere ? Math.min(cigs, 2 + Math.floor(p.greed * 5)) : 0,
          { repKind: "wealth" });
        return;
      }
      if ((buzz.kind === "badge" || buzz.kind === "snitch" || buzz.kind === "debt") && rng() < 0.030) {
        startApproach(n, "reputation", 0, { repKind: buzz.kind });
        return;
      }
    }
    if (searchHeat && d < 13 && n.role !== "dealer") {
      const helpful = sameGang || protectedHere || standing > 22 || (n.playerTrust || 0) > 4 || (n.playerFear || 0) > 5;
      const hatesYou = rivalGang || standing < -18 || (n.playerGrudge || 0) > 8;
      if (helpful && !hatesYou && rng() < 0.036 + Math.min(0.030, ((n.playerTrust || 0) + (n.playerFear || 0)) * 0.002)) {
        const source = searchSource(caseSourceName(cprof, "guard chatter"));
        startApproach(n, "heatWarning", 0, { source, caseSourceCount: cprof.count });
        return;
      }
    }
    if (n.gang >= 0 && (sameGang || protectedHere || standing > 30) && p.loyalty > 0.30 && d < 12.5 &&
      (searchHeat || heat > 22 || debt > 8) && rng() < 0.038 + Math.max(0, standing) * 0.0005 + (sameGang ? 0.012 : 0)) {
      const source = searchHeat
        ? searchSource(caseSourceName(cprof, "guard chatter"))
        : (debt > 8 ? "crew debt" : "heat");
      startApproach(n, "crewBackup", 0, { source });
      return;
    }
    if (n.gang >= 0 && (sameGang || protectedHere || standing > 22) && cigs >= 8 && p.greed > 0.24 && p.loyalty > 0.22 &&
      rng() < 0.022 + Math.min(0.020, (cigs - 8) * 0.0015) + (debt > 0 ? 0.012 : 0)) {
      startApproach(n, "crewDues", crewDuesCost(n), { debt });
      return;
    }
    if (!profile.active && profile.score > 18 && cigs >= 8 && d < 12.5 && (n.role === "thief" || rivalGang || (n.gang >= 0 && standing < -14)) &&
      p.greed > 0.38 && p.nerve > 0.24 && rng() < 0.026 + Math.min(0.028, profile.score * 0.0008) + (rivalGang ? 0.014 : 0)) {
      startApproach(n, "stickUp", stickUpCost(n, profile), { rivalGang, stashItems: profile.stash });
      return;
    }
    if (!profile.active && profile.score > 15 && d < 12 && cigs >= 4 && p.greed > 0.34 &&
      (n.role === "dealer" || n.role === "thief" || n.gang >= 0) && rng() < 0.030 + Math.min(0.025, profile.score * 0.0007)) {
      const allyCut = sameGang || protectedHere || standing > 24 ? -1 : 0;
      const cost = Math.min(cigs, Math.max(3, Math.ceil(profile.score / 8) + Math.floor(p.greed * 4) + allyCut));
      startApproach(n, "stashCover", cost, { stashItems: profile.stash });
      return;
    }
    if (searchHeat && cigs >= 3 && d < 12 && n.role !== "dealer" && !sameGang && !protectedHere &&
      p.greed > 0.36 && p.nerve > 0.18 && rng() < (n.memory ? 0.042 : 0.026) + Math.min(0.022, cprof.score * 0.00042)) {
      const cost = Math.min(cigs, Math.max(3,
        Math.ceil(Math.max(heat, caseHeat, (n.memory && n.memory.amount) || 0) / 22) +
        Math.floor(p.greed * 5) +
        (n.memory ? 2 : 0)
      ));
      const source = searchSource(caseSourceName(cprof, "the sweep"));
      startApproach(n, "alibiDeal", cost, {
        source,
        heat: (n.memory && n.memory.amount) || Math.max(10, heat * 0.45, caseHeat * 0.65),
        memoryType: n.memory && n.memory.type,
        caseSourceCount: cprof.count,
        caseCredibility: cprof.credibility,
      });
      return;
    }
    if (searchHeat && n.gang >= 0 && (sameGang || protectedHere || standing > 36) && p.loyalty > 0.34 && d < 12.5 && rng() < 0.038 + Math.max(0, standing) * 0.0006) {
      const source = searchSource(caseSourceName(cprof, "guard chatter"));
      startApproach(n, "coverStory", 0, { source, caseSourceCount: cprof.count, caseCredibility: cprof.credibility });
      return;
    }
    if (searchHeat && cigs >= 2 && p.greed > 0.34 && p.nerve > 0.18 && d < 12.5 && rng() < (heat > 55 ? 0.052 : 0.030) + Math.min(0.018, cprof.named * 0.005)) {
      const cost = Math.min(cigs, Math.max(2, Math.ceil(Math.max(heat, caseHeat) / 25) + Math.floor(p.greed * 4) + ((CBZ.game.lastKnown && CBZ.game.lastKnown.t > 0) ? 1 : 0)));
      const source = searchSource(caseSourceName(cprof, "guard chatter"));
      startApproach(n, "infoSell", cost, { source, caseSourceCount: cprof.count });
      return;
    }
    if (debt > 0 && !sameGang && !protectedHere && p.nerve > 0.25) {
      if (cigs > 0 && rng() < Math.min(0.075, 0.024 + debt * 0.003)) {
        startApproach(n, "debtCollect", Math.min(cigs, Math.max(2, Math.ceil(debt * 0.55) + Math.floor(p.greed * 4))), { debt: true });
        return;
      }
      if (debt >= 14 && rng() < 0.018) {
        provokeGang(n, 5 + Math.min(6, debt * 0.25));
        return;
      }
    }
    if (n.gang >= 0 && isOnTurf(n.gang, CBZ.player.pos) && !sameGang && !protectedHere && standing < 20 && p.nerve > 0.28 && rng() < 0.060) {
      startApproach(n, standing < -10 ? "tax" : "turfWarning", standing < -10 ? Math.min(cigs, 3 + Math.floor(p.greed * 5)) : 0);
      return;
    }
    if (!CBZ.game.gangJob && n.gang >= 0 && d < 12.5 && p.nerve > 0.22 &&
      (sameGang || protectedHere || standing > 14 || debt > 5 || cigs < 12) && rng() < 0.034) {
      const job = makeGangJob(n);
      startApproach(n, "gangJob", 0, { job });
      return;
    }
    if (n.gang >= 0 && (sameGang || protectedHere || standing > 34) && cigs < 6 && p.loyalty > 0.45 && rng() < 0.030) {
      startApproach(n, "favor", 0, { gift: 2 + Math.floor((p.loyalty || 0.5) * 5) });
      return;
    }
    if ((heat > 25 || caseHeat > 18) && p.snitch > 0.58 && cigs >= 4 && rng() < 0.018 + Math.min(0.020, cprof.solid * 0.006)) {
      startApproach(n, "snitchThreat", Math.min(cigs, 4 + Math.floor(Math.max(heat, caseHeat) / 18)), { caseSourceCount: cprof.count, caseCredibility: cprof.credibility });
      return;
    }
    if ((heat > 42 || (CBZ.game.witnessReportT || 0) > 0) && cigs >= 3) {
      const allyish = sameGang || protectedHere || standing > 28;
      if (n.gang >= 0 && allyish && p.loyalty > 0.32 && rng() < 0.052) {
        startApproach(n, "lookout", Math.min(cigs, 3 + Math.floor((100 - Math.max(0, standing)) / 28)));
        return;
      }
      if ((n.role === "thief" || p.greed > 0.58) && p.nerve > 0.35 && rng() < 0.036) {
        startApproach(n, "diversion", Math.min(cigs, 4 + Math.floor(heat / 22) + Math.floor(p.greed * 3)));
        return;
      }
    }
    const wanted = wantedItemFor(n);
    if (wanted && n.role !== "merchant" && p.greed > 0.24 && d < 11.5 && rng() < (n.role === "dealer" || n.role === "thief" ? 0.045 : 0.020)) {
      const base = itemValue(wanted);
      const sameOrProtected = sameGang || protectedHere || standing > 24;
      const price = Math.max(2, Math.ceil(base * (sameOrProtected ? 0.9 : 0.7) + p.greed * 4));
      startApproach(n, "buyItem", wanted, { item: wanted, price });
      return;
    }
    if (n.role === "dealer" && cigs >= 6 && rng() < 0.018) {
      startApproach(n, "deal", 0);
      return;
    }
    if (n.gang >= 0 && CBZ.player.gang == null && standing > -8 && (n.isLeader || (n.rep || 0) > 30) && rng() < 0.026) {
      startApproach(n, "gangInvite", 0);
      return;
    }
    if (!protectedHere && (rivalGang || (n.gang >= 0 && standing < -12) || (n.gang >= 0 && cigs >= 16 && p.greed > 0.5)) && cigs > 2 && p.nerve > 0.35 && rng() < 0.038) {
      startApproach(n, "tax", Math.min(cigs, 3 + Math.floor(p.greed * 6) + Math.floor(cigs / 18)));
      return;
    }
    if ((sameGang || protectedHere) && rng() < 0.022) {
      startApproach(n, "rumor", 0);
      return;
    }
    if (n.role === "inmate" && rng() < 0.010) startApproach(n, "rumor", 0);
  }

  function directorCandidate(n) {
    if (!alive(n) || n.role === "merchant" || n.approach || n.aiState === "fight" || n.aiState === "snitch" || n.aiState === "rumorHuddle") return null;
    const d = playerDist(n);
    if (d < 4.8 || d > APPROACH_FAR + 1.5) return null;
    const g = CBZ.game || {};
    const p = n.personality || {};
    const cigs = g.cigs || 0;
    const heat = g.detection || 0;
    const sameGang = CBZ.player.gang != null && n.gang === CBZ.player.gang;
    const rivalGang = CBZ.player.gang != null && n.gang >= 0 && n.gang !== CBZ.player.gang;
    const standing = n.gang >= 0 ? gangStanding(n.gang) : 0;
    const protectedHere = n.gang >= 0 && gangProtection(n.gang) > 0;
    const debt = n.gang >= 0 ? gangDebt(n.gang) : 0;
    const buzz = topBuzz();
    const profile = stashPressure();
    const social = socialProfile();
    const payerRead = Math.max(0, (social.paid || 0) + (social.exploited || 0) - (social.threatened || 0) - (social.refused || 0));
    const scaryRead = Math.max(0, (social.threatened || 0) - (social.paid || 0));
    const helperRead = Math.max(0, (social.helped || 0) + (social.listened || 0) - (social.refused || 0));
    const cprof = casePressureProfile();
    const caseHeat = cprof.heat;
    const nearScore = Math.max(0, 14 - d) * 0.35;
    const fresh = g.socialDirectorLast && n.data && g.socialDirectorLast === n.data.name ? -5 : 0;
    const options = [];
    function add(kind, score, cost, extra) {
      options.push({ n, kind, score: score + nearScore + fresh + crewRoleScore(n, kind), cost: cost || 0, extra: extra || null });
    }

    if (g.role === "cop") {
      const suspect = findCopTipSuspect(n);
      if ((n.role === "dealer" || n.role === "thief") && p.greed > 0.4) add("copBribe", 12 + p.greed * 8 + (g.complaints || 0) * 0.08, 0, { price: Math.max(2, 3 + Math.floor(p.greed * 7)) });
      if (suspect && p.snitch > 0.42) add("copTip", 16 + p.snitch * 8, 0, { suspect, msg: `${actorName(n)} points you toward trouble.` });
      if (n.gang >= 0 && (standing < -16 || debt > 6)) add("copPlea", 14 + debt + Math.max(0, -standing) * 0.12, 0, { gang: n.gang });
      if (p.nerve > 0.68) add("copTaunt", 10 + p.nerve * 7 + (g.complaints || 0) * 0.08, 0);
    } else {
      if (n.coverDebt && n.coverDebt.t > 0 && cigs >= 2 && p.greed > 0.18) {
        const cost = coverDebtCost(n);
        if (cost > 0) {
          add("coverDebt",
            20 + Math.min(10, n.coverDebt.heat || 0) + p.greed * 5 + (sameGang || protectedHere ? 2 : 0) + Math.max(0, standing) * 0.04,
            cost,
            {
              guard: n.coverDebt.guard || "a guard",
              heat: n.coverDebt.heat || 8,
              source: n.coverDebt.source || actorName(n),
              caseSourceCount: cprof.count,
            });
        }
      }
      if (n.memory && n.memory.t > 0 && cigs > 0 && p.greed > 0.38) {
        add("snitchThreat", 20 + (n.memory.amount || 12) * 0.35 + p.greed * 8, Math.min(cigs, Math.max(3, Math.ceil((n.memory.amount || 12) / 8) + Math.floor(p.greed * 6))), { heat: n.memory.amount || 12, memoryType: n.memory.type });
      }
      if ((n.reportedPlayerT || 0) > 0 && cigs >= 2 && p.greed > 0.28 && p.nerve > 0.16) {
        const cred = n.reportedPlayerCred != null ? n.reportedPlayerCred : (n.reportedPlayerKind === "noise report" ? 0.45 : 0.70);
        const sourceHot = g.lastKnown && g.lastKnown.source === actorName(n);
        const allyDiscount = sameGang || protectedHere || standing > 26 ? 1 : 0;
        const cost = Math.min(cigs, Math.max(2, knownSnitchCost(n) + (rivalGang ? 1 : 0) - allyDiscount));
        add("recantOffer",
          19 + (n.reportedPlayerAmount || 12) * 0.28 + cred * 7 + p.greed * 5 + (sourceHot ? 3 : 0) - allyDiscount * 2,
          cost,
          { amount: n.reportedPlayerAmount || 12, credibility: cred, source: actorName(n) });
      }
      const reporter = findKnownReporter(n);
      if (reporter && cigs >= 2 && canFixReporter(n, reporter)) {
        const cost = witnessFixCost(n, reporter);
        const sameGangReporter = n.gang >= 0 && reporter.gang === n.gang;
        add("witnessFix",
          17 + (reporter.reportedPlayerAmount || 12) * 0.35 + p.greed * 5 + Math.max(0, standing) * 0.05 +
          (sameGang || protectedHere ? 4 : 0) - (sameGangReporter ? 3 : 0) +
          Math.min(8, cprof.score * 0.08) + cprof.solid * 2,
          cost,
          { reporter, targetName: reporterName(reporter), amount: reporter.reportedPlayerAmount || 12, caseSourceCount: cprof.count, caseCredibility: cprof.credibility });
      }
      const searchHeat = (g.lastKnown && g.lastKnown.t > 0) || (g.witnessReportT || 0) > 0 || heat > 28 || caseHeat > 14;
      const helpful = sameGang || protectedHere || standing > 22 || (n.playerTrust || 0) > 4 || (n.playerFear || 0) > 5;
      const hatesYou = rivalGang || standing < -18 || (n.playerGrudge || 0) > 8;
      if (searchHeat && n.role !== "dealer" && helpful && !hatesYou) {
        const source = searchSource(caseSourceName(cprof, "guard chatter"));
        add("heatWarning", 15 + (n.playerTrust || 0) * 0.5 + (n.playerFear || 0) * 0.32 + Math.max(0, standing) * 0.06 + heat * 0.05 + Math.min(7, cprof.score * 0.07), 0, { source, caseSourceCount: cprof.count });
      }
      if (searchHeat && n.gang >= 0 && (sameGang || protectedHere || standing > 28) && p.loyalty > 0.32) {
        const source = searchSource(caseSourceName(cprof, "guard chatter"));
        add("coverStory", 18 + Math.max(0, standing) * 0.10 + p.loyalty * 7 + Math.min(9, cprof.score * 0.10) + cprof.solid * 1.5, 0, { source, caseSourceCount: cprof.count, caseCredibility: cprof.credibility });
      }
      if (n.gang >= 0 && (sameGang || protectedHere || standing > 30) && p.loyalty > 0.30 && (searchHeat || heat > 22 || debt > 8)) {
        const source = searchHeat ? searchSource("guard chatter") : (debt > 8 ? "crew debt" : "heat");
        add("crewBackup", 16 + p.loyalty * 8 + Math.max(0, standing) * 0.09 + heat * 0.04 + (sameGang ? 3 : 0), 0, { source });
      }
      if ((g.racketDebt > 0 || (g.racketStanding || 0) < -10 || buzz.kind === "badge") && cigs >= 3 && (sameGang || protectedHere || standing > 20 || n.role === "dealer") && p.greed > 0.24) {
        add("racketCover",
          14 + Math.min(12, (g.racketDebt || 0) * 0.45) + Math.max(0, standing) * 0.06 + p.greed * 5 + (sameGang ? 3 : 0),
          racketCoverCost(n),
          { racketDebt: g.racketDebt || 0, source: g.racketGuard || "bent cops" });
      }
      if (n.gang >= 0 && (sameGang || protectedHere || standing > 22) && cigs >= 8 && p.greed > 0.24 && p.loyalty > 0.22) {
        add("crewDues", 13 + Math.min(10, cigs * 0.22) + Math.max(0, standing) * 0.04 + debt * 0.35 + (protectedHere ? 2 : 0) + payerRead * 0.35, crewDuesCost(n), { debt });
      }
      if (!profile.active && profile.score > 18 && cigs >= 8 && (n.role === "thief" || rivalGang || (n.gang >= 0 && standing < -14)) && p.greed > 0.38 && p.nerve > 0.24) {
        add("stickUp",
          14 + profile.score * 0.22 + p.greed * 7 + p.nerve * 3 + (rivalGang ? 4 : 0) + Math.max(0, -standing) * 0.06 + payerRead * 0.55 - scaryRead * 0.22,
          stickUpCost(n, profile),
          { rivalGang, stashItems: profile.stash });
      }
      if (searchHeat && cigs >= 2 && p.greed > 0.38 && p.nerve > 0.18) {
        const source = searchSource(caseSourceName(cprof, "guard chatter"));
        add("infoSell", 13 + p.greed * 8 + Math.max(heat, caseHeat) * 0.08 + cprof.named * 2.5, Math.min(cigs, Math.max(2, Math.ceil(Math.max(heat, caseHeat) / 25) + Math.floor(p.greed * 4))), { source, caseSourceCount: cprof.count });
      }
      if (debt > 0 && !sameGang && !protectedHere && p.nerve > 0.22 && cigs > 0) {
        add("debtCollect", 12 + debt * 0.9 + p.nerve * 5, Math.min(cigs, Math.max(2, Math.ceil(debt * 0.55) + Math.floor(p.greed * 4))), { debt: true });
      }
      if (n.gang >= 0 && isOnTurf(n.gang, CBZ.player.pos) && !sameGang && !protectedHere && p.nerve > 0.28) {
        add(standing < -10 ? "tax" : "turfWarning", 13 + Math.max(0, 20 - standing) * 0.25 + p.nerve * 5, standing < -10 ? Math.min(cigs, 3 + Math.floor(p.greed * 5)) : 0);
      }
      if (!g.gangJob && n.gang >= 0 && (sameGang || protectedHere || standing > 14 || debt > 5 || cigs < 12) && p.nerve > 0.20) {
        add("gangJob", 10 + Math.max(0, standing) * 0.05 + debt * 0.22 + (sameGang ? 4 : 0), 0, { job: makeGangJob(n) });
      }
      if (n.isLeader && n.gang >= 0 && p.nerve > 0.18) {
        const parley = gangParleyFor(n);
        const meaningful = parley.mode !== "warning" || Math.abs(parley.standing) > 14 || parley.debt > 0 || cigs > 14 || searchHeat;
        if (meaningful) {
          const modeScore = parley.mode === "truce" ? 7 : (parley.mode === "recruit" ? 5 : (parley.mode === "work" ? 4 : 0));
          add("gangParley", 14 + modeScore + Math.abs(parley.standing) * 0.08 + parley.debt * 0.38 + (n.isLeader ? 3 : 0) + scaryRead * 0.30, parley.cost, {
            parleyMode: parley.mode,
            parleyStanding: parley.standing,
            parleyDebt: parley.debt,
          });
        }
      }
      if (n.gang >= 0 && (sameGang || protectedHere || standing > 30) && cigs < 6 && p.loyalty > 0.45) {
        add("favor", 11 + p.loyalty * 8 + Math.max(0, standing) * 0.06, 0, { gift: 2 + Math.floor((p.loyalty || 0.5) * 5) });
      }
      if (buzz.score > 24) {
        const repScore = 9 + buzz.score * 0.18;
        if (buzz.kind === "wealth" && cigs > 8 && p.greed > 0.44 && n.gang >= 0 && !sameGang && !protectedHere) add("tax", repScore + p.greed * 6, Math.min(cigs, 2 + Math.floor(p.greed * 5)), { repKind: "wealth" });
        else if (buzz.kind !== "quiet") add("reputation", repScore + (buzz.kind === "fear" ? (1 - (p.nerve || 0.5)) * 5 : 0), 0, { repKind: buzz.kind });
      }
      if (!profile.active && profile.score > 13 && cigs >= 4 && p.greed > 0.34 && (n.role === "dealer" || n.role === "thief" || n.gang >= 0)) {
        const allyCut = sameGang || protectedHere || standing > 24 ? -1 : 0;
        add("stashCover", 11 + profile.score * 0.22 + p.greed * 6 + (n.role === "dealer" ? 2 : 0),
          Math.min(cigs, Math.max(3, Math.ceil(profile.score / 8) + Math.floor(p.greed * 4) + allyCut)),
          { stashItems: profile.stash });
      }
      if (searchHeat && cigs >= 3 && n.role !== "dealer" && !sameGang && !protectedHere && p.greed > 0.36 && p.nerve > 0.18) {
        const source = searchSource(caseSourceName(cprof, "the sweep"));
        add("alibiDeal", 12 + p.greed * 7 + Math.max(heat, caseHeat) * 0.07 + (n.memory ? 6 : 0) + (rivalGang ? 2 : 0) + Math.min(8, cprof.score * 0.08),
          Math.min(cigs, Math.max(3, Math.ceil(Math.max(heat, caseHeat, (n.memory && n.memory.amount) || 0) / 22) + Math.floor(p.greed * 5) + (n.memory ? 2 : 0))),
          { source, heat: (n.memory && n.memory.amount) || Math.max(10, heat * 0.45, caseHeat * 0.65), memoryType: n.memory && n.memory.type, caseSourceCount: cprof.count, caseCredibility: cprof.credibility });
      }
      const wanted = wantedItemFor(n);
      if (wanted && p.greed > 0.36) {
        const base = itemValue(wanted);
        add("buyItem", 8 + p.greed * 7, wanted, { item: wanted, price: Math.max(2, Math.ceil(base * ((sameGang || protectedHere || standing > 24) ? 0.9 : 0.7) + p.greed * 4)) });
      }
      if (n.role === "dealer" && cigs >= 6) add("deal", 8 + p.greed * 4, 0);
      if (n.gang >= 0 && CBZ.player.gang == null && standing > -8 && (n.isLeader || (n.rep || 0) > 30)) add("gangInvite", 7 + standing * 0.10 + (n.isLeader ? 5 : 0), 0);
      if ((sameGang || protectedHere || buzz.score > 20 || helperRead > 3) && p.loyalty > 0.28) add("rumor", 7 + p.loyalty * 5 + buzz.score * 0.05 + helperRead * 0.22, 0);
    }

    options.sort((a, b) => b.score - a.score);
    return options[0] || null;
  }

  function updateSocialDirector(dt) {
    const g = CBZ.game || {};
    if (g.state !== "playing" || (CBZ.player.stun || 0) > 0) return;
    g.socialDirectorT = Math.max(0, (g.socialDirectorT || 0) - dt);
    if (g.socialDirectorT > 0 || playerApproachBusy()) return;
    g.socialDirectorT = 5.5 + rng() * 5.5;

    let best = null;
    for (const n of CBZ.npcs || []) {
      const c = directorCandidate(n);
      if (c && (!best || c.score > best.score)) best = c;
    }
    if (!best || best.score < 12) return;
    startApproach(best.n, best.kind, best.cost, best.extra);
    best.n.approach.directed = true;
    g.socialDirectorLast = best.n.data && best.n.data.name;
  }

  function canTailPlayer(n) {
    if (!alive(n) || n.role === "merchant" || !n.group || !n.data) return false;
    if (n.approach || n.huntPlayer > 0) return false;
    if (n.aiState === "fight" || n.aiState === "snitch" || n.aiState === "tailPlayer" || n.aiState === "pressurePlayer" ||
      n.aiState === "interceptThreat" || n.aiState === "rumorHuddle" || n.aiState === "diversion" || n.aiState === "escape") return false;
    const d = playerDist(n);
    return d >= 5.2 && d <= 19.5;
  }

  function startTailPlayer(n, kind, seconds, score) {
    if (!canTailPlayer(n)) return false;
    n.aiState = "tailPlayer";
    n.tailKind = kind || "watch";
    n.tailT = seconds || (8 + rng() * 6);
    n.tailCommitT = n.tailT * (0.38 + rng() * 0.20);
    n.tailSide = rng() < 0.5 ? -1 : 1;
    n.tailScore = score || 0;
    n.foe = null;
    n.social = null;
    n.pause = 0;
    emote(n, kind === "cover" ? "+" : (kind === "pocket" || kind === "debt" ? "$" : (kind === "fear" ? "!" : "?")));
    return true;
  }

  function tailCandidate(n) {
    if (!canTailPlayer(n)) return null;
    const g = CBZ.game || {};
    const d = playerDist(n);
    const p = n.personality || {};
    const cigs = g.cigs || 0;
    const heat = g.detection || 0;
    const cprof = casePressureProfile();
    const caseHeat = cprof.heat;
    const searchHeat = (g.lastKnown && g.lastKnown.t > 0) || (g.witnessReportT || 0) > 0 || heat > 24 || caseHeat > 12;
    const sameGang = CBZ.player.gang != null && n.gang === CBZ.player.gang;
    const rivalGang = CBZ.player.gang != null && n.gang >= 0 && n.gang !== CBZ.player.gang;
    const standing = n.gang >= 0 ? gangStanding(n.gang) : 0;
    const protectedHere = n.gang >= 0 && gangProtection(n.gang) > 0;
    const debt = n.gang >= 0 ? gangDebt(n.gang) : 0;
    const buzzState = blockRumor();
    const buzz = topBuzz();
    const profile = stashPressure();
    const nearScore = Math.max(0, 17 - d) * 0.22;
    const repeatCut = g.watcherLast && n.data && g.watcherLast === n.data.name ? -4 : 0;
    const options = [];
    function add(kind, score) {
      options.push({ n, kind, score: score + nearScore + repeatCut + crewRoleScore(n, kind) });
    }

    if (g.role === "cop") {
      const suspect = findCopTipSuspect(n);
      if (suspect && p.snitch > 0.42) add("copTip", 12 + p.snitch * 9 + (g.complaints || 0) * 0.06);
      if ((g.complaints || 0) > 16 && p.nerve > 0.52) add("copWatch", 9 + p.nerve * 7 + (g.complaints || 0) * 0.08);
      if ((n.role === "dealer" || n.role === "thief") && p.greed > 0.48 && cigs >= 0) add("copBribe", 10 + p.greed * 8);
    } else {
      const helpful = sameGang || protectedHere || standing > 24 || (n.playerTrust || 0) > 4 || (n.playerFear || 0) > 5;
      const hatesYou = rivalGang || standing < -18 || (n.playerGrudge || 0) > 8;
      if (searchHeat && helpful && !hatesYou && n.role !== "dealer") {
        add("cover", 13 + Math.max(0, standing) * 0.08 + (n.playerTrust || 0) * 0.45 + (n.playerFear || 0) * 0.28 + (p.loyalty || 0.5) * 7 + Math.min(7, cprof.score * 0.07));
      }
      if (searchHeat && !helpful && (p.snitch > 0.44 || rivalGang || (n.playerGrudge || 0) > 4)) {
        add("snitch", 12 + p.snitch * 10 + (rivalGang ? 4 : 0) + Math.max(0, n.playerGrudge || 0) * 0.45 + Math.max(heat, caseHeat) * 0.06 + cprof.solid * 2 + cprof.named * 1.5);
      }
      if (!profile.active && profile.score > 12 && cigs >= 6 && p.greed > 0.36 && (n.role === "thief" || rivalGang || n.gang >= 0)) {
        add("pocket", 10 + profile.score * 0.19 + p.greed * 8 + (n.role === "thief" ? 3 : 0) + (rivalGang ? 2 : 0));
      }
      if (n.gang >= 0 && !sameGang && !protectedHere && (debt > 5 || standing < -12) && p.nerve > 0.24) {
        add("debt", 11 + debt * 0.75 + Math.max(0, -standing) * 0.14 + p.nerve * 5);
      }
      if (CBZ.playerArmed && CBZ.playerArmed() && d < 12 && p.nerve < 0.62 && buzz.kind === "fear") {
        add("fear", 8 + (1 - (p.nerve || 0.5)) * 8 + Math.min(8, (buzzState.fear || 0) * 0.09));
      }
    }

    options.sort((a, b) => b.score - a.score);
    return options[0] || null;
  }

  function updateWatcherDirector(dt) {
    const g = CBZ.game || {};
    if (g.state !== "playing" || (CBZ.player.stun || 0) > 0) return;
    g.watcherDirectorT = Math.max(0, (g.watcherDirectorT || 0) - dt);
    if (g.watcherDirectorT > 0) return;
    g.watcherDirectorT = 2.4 + rng() * 2.8;

    let active = 0;
    for (const n of CBZ.npcs || []) if (n.aiState === "tailPlayer" && alive(n)) active++;
    if (active >= 3) return;

    let best = null;
    for (const n of CBZ.npcs || []) {
      const c = tailCandidate(n);
      if (c && (!best || c.score > best.score)) best = c;
    }
    if (!best || best.score < 11.5) return;
    if (startTailPlayer(best.n, best.kind, 8 + Math.min(8, best.score * 0.25), best.score)) {
      g.watcherLast = best.n.data && best.n.data.name;
      if (best.kind === "snitch") addBuzz("snitch", 2, actorName(best.n));
      else if (best.kind === "pocket") addBuzz("wealth", 2, actorName(best.n));
      else if (best.kind === "debt") addBuzz("debt", 2, actorName(best.n));
    }
  }

  function nearestGuard(n) {
    let best = null, bd = Infinity;
    for (const g of CBZ.guards) {
      if (!alive(g)) continue;
      const d2 = Math.pow(g.group.position.x - n.group.position.x, 2) + Math.pow(g.group.position.z - n.group.position.z, 2);
      if (d2 < bd) { bd = d2; best = g; }
    }
    return best;
  }

  // everyone who can be a combatant
  function actors() {
    const list = [];
    for (const n of CBZ.npcs) list.push(n);
    for (const g of CBZ.guards) {
      if (g.hp == null) {
        const warden = g.kind === "warden";
        g.hp = warden ? 200 : 150; g.maxHp = g.hp; g.baseSpeed = g.speed;
        g.ratings = g.ratings || {
          fighting: warden ? 88 : roll(58, 26), toughness: warden ? 90 : roll(60, 24),
          speed: roll(40, 28), stealth: roll(20, 26), marksman: warden ? 82 : roll(50, 34), cunning: warden ? 80 : roll(45, 30),
        };
        g.behavior = g.behavior || (warden ? "predator" : "defensive");
        g.record = g.record || { kills: 0, knockdowns: 0, downs: 0, fights: 0 };
      }
      list.push(g);
    }
    return list;
  }

  // nearest non-hostile inmate to chat with
  function findPal(n) {
    let best = null, bd = 9 * 9;
    for (const a of nearbyNpcs(n, 9, _palNear)) {
      if (a === n || !alive(a)) continue;
      if (a.gang >= 0 && n.gang >= 0 && a.gang !== n.gang) continue; // rivals don't mingle
      const dx = a.group.position.x - n.group.position.x, dz = a.group.position.z - n.group.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = a; }
    }
    return best;
  }

  function copyMemory(from, to) {
    if (!from.memory || from.memory.t <= 2 || to.memory || !alive(to)) return false;
    const amount = Math.max(6, (from.memory.amount || 12) * 0.65);
    to.memory = {
      type: from.memory.type,
      amount,
      t: Math.min(18, from.memory.t * 0.72),
      kind: "gossip:" + (from.memory.kind || "trouble"),
      lastKnown: from.memory.lastKnown,
    };
    return true;
  }

  function shareBlockBuzz(a, b) {
    const buzz = topBuzz();
    if (buzz.score < 18 || rng() > 0.48) return false;
    const listeners = [a, b].filter((m) => alive(m));
    for (const m of listeners) {
      rememberBlockRead(m, buzz.kind, buzz.score, "gossip");
      if (buzz.kind === "fear") m.playerFear = Math.min(14, (m.playerFear || 0) + 0.35);
      if (buzz.kind === "wealth" && ((m.personality && m.personality.greed) || 0) > 0.45) m.playerGrudge = Math.min(14, (m.playerGrudge || 0) + 0.25);
      if (buzz.kind === "badge" && m.gang >= 0) addGangStanding(m.gang, -0.35);
      if (buzz.kind === "debt" && m.gang >= 0) m.approachCD = Math.min(m.approachCD || 3, 1.8 + rng() * 2);
    }
    if (buzz.score > 32 && rng() < 0.42) startRumorHuddle(a, b, buzz);
    if (CBZ.player && (playerDist(a) < 16 || playerDist(b) < 16) && rng() < 0.28) {
      CBZ.flashHint("Block gossip shifts how people read you.", 1.4);
    }
    return true;
  }

  function canRumorHuddle(n) {
    return alive(n) && !n.approach && n.aiState !== "fight" && n.aiState !== "snitch" && n.aiState !== "tailPlayer" &&
      n.aiState !== "pressurePlayer" && n.aiState !== "interceptThreat" && n.aiState !== "diversion" && n.aiState !== "escape" && !(n.huntPlayer > 0);
  }

  function startRumorHuddle(a, b, buzz) {
    const g = CBZ.game || {};
    if (!a || !b || a === b || !buzz || !canRumorHuddle(a) || !canRumorHuddle(b)) return false;
    if (g.gossipHuddleT > 0) return false;
    g.gossipHuddleT = 4.2;
    const lead = (crewRoleScore(a, buzz.kind) + ((a.personality && a.personality.nerve) || 0.5)) >=
      (crewRoleScore(b, buzz.kind) + ((b.personality && b.personality.nerve) || 0.5)) ? a : b;
    const echo = lead === a ? b : a;
    for (const n of [lead, echo]) {
      n.aiState = "rumorHuddle";
      n.huddlePartner = n === lead ? echo : lead;
      n.huddleKind = buzz.kind;
      n.huddleScore = buzz.score || 0;
      n.huddleT = 2.4 + rng() * 1.2;
      n.huddleLead = n === lead;
      n.foe = null;
      n.social = null;
      emote(n, buzz.kind === "wealth" || buzz.kind === "debt" || buzz.kind === "badge" ? "$" : (buzz.kind === "snitch" || buzz.kind === "heat" ? "!" : "?"));
    }
    if (CBZ.flashHint && (playerDist(lead) < 16 || playerDist(echo) < 16)) CBZ.flashHint("Two inmates huddle over block gossip.", 1.35);
    return true;
  }

  function clearRumorHuddle(n) {
    if (!n) return;
    n.huddlePartner = null;
    n.huddleKind = null;
    n.huddleScore = 0;
    n.huddleT = 0;
    n.huddleLead = false;
  }

  function resolveRumorHuddle(n) {
    const kind = n.huddleKind || "quiet";
    const score = n.huddleScore || 0;
    clearRumorHuddle(n);
    n.aiState = "wander";
    if (playerApproachBusy(n) || !alive(n) || n.role === "merchant") return false;
    const g = CBZ.game || {};
    const p = n.personality || {};
    const cigs = g.cigs || 0;
    const standing = n.gang >= 0 ? gangStanding(n.gang) : 0;
    const sameGang = CBZ.player && CBZ.player.gang != null && n.gang === CBZ.player.gang;
    const rivalGang = CBZ.player && CBZ.player.gang != null && n.gang >= 0 && n.gang !== CBZ.player.gang;
    const protectedHere = n.gang >= 0 && gangProtection(n.gang) > 0;
    const helpful = sameGang || protectedHere || standing > 24 || (n.playerTrust || 0) > 5 || (n.playerFear || 0) > 7;
    const hostile = rivalGang || standing < -16 || (n.playerGrudge || 0) > 7;
    const cprof = casePressureProfile();
    const searchHeat = (g.lastKnown && g.lastKnown.t > 0) || (g.witnessReportT || 0) > 0 || (g.detection || 0) > 24 || cprof.heat > 12;
    const profile = stashPressure();

    if ((kind === "snitch" || kind === "heat") && searchHeat) {
      if (helpful && !hostile && n.gang >= 0) {
        startApproach(n, "coverStory", 0, {
          source: searchSource(caseSourceName(cprof, "huddle gossip")),
          caseSourceCount: cprof.count,
          caseCredibility: cprof.credibility,
          motive: "huddle cover plan",
        });
        return true;
      }
      if (!helpful && ((p.snitch || 0.5) > 0.48 || hostile)) {
        startTailPlayer(n, "snitch", 8 + Math.min(7, score * 0.16), score);
        return true;
      }
      startApproach(n, "heatWarning", 0, { source: "huddle gossip", caseSourceCount: cprof.count, motive: "huddle warning" });
      return true;
    }

    if (kind === "wealth" && cigs >= 6 && (g.lowProfileT || 0) <= 0) {
      if ((n.role === "thief" || hostile || ((p.greed || 0.5) > 0.54 && !helpful)) && (p.nerve || 0.5) > 0.22) {
        startApproach(n, "stickUp", stickUpCost(n, profile), { rivalGang, stashItems: profile.stash, motive: "huddle counted cash" });
        return true;
      }
      if ((p.greed || 0.5) > 0.32) {
        startApproach(n, "stashCover", Math.min(cigs, Math.max(3, Math.ceil(profile.score / 8) + Math.floor((p.greed || 0.5) * 4))), { stashItems: profile.stash, motive: "huddle money cover" });
        return true;
      }
    }

    if (kind === "debt" && n.gang >= 0) {
      const debt = gangDebt(n.gang);
      if (!helpful && cigs > 0 && (debt > 0 || standing < -8 || (p.greed || 0.5) > 0.45)) {
        startApproach(n, debt > 4 ? "debtCollect" : "tax", Math.min(cigs, Math.max(2, Math.ceil(Math.max(debt, 4) * 0.55) + Math.floor((p.greed || 0.5) * 4))), { debt: true, motive: "huddle debt talk" });
        return true;
      }
      if (helpful && cigs >= 4) {
        startApproach(n, "crewDues", crewDuesCost(n), { debt, motive: "huddle protection dues" });
        return true;
      }
    }

    if (kind === "badge") {
      if ((g.racketDebt || 0) > 0 && cigs >= 3 && (p.greed || 0.5) > 0.36 && !helpful) {
        startApproach(n, "stickUp", stickUpCost(n, profile), {
          racketGuard: g.racketGuard || "a bent cop",
          racketDebt: g.racketDebt || 0,
          rivalGang,
          motive: "huddle bent-cop tab",
        });
        return true;
      }
      if ((g.racketDebt || 0) > 0 && cigs >= 3 && (helpful || n.role === "dealer")) {
        startApproach(n, "racketCover", racketCoverCost(n), {
          racketDebt: g.racketDebt || 0,
          source: g.racketGuard || "bent cops",
          motive: "huddle badge cover",
        });
        return true;
      }
      startApproach(n, "reputation", 0, { repKind: "badge", motive: "huddle badge rumor" });
      return true;
    }

    if (kind === "fear") {
      if ((p.nerve || 0.5) < 0.42) {
        n.aiState = "flee";
        n.fleeT = 2.0 + rng() * 2;
        emote(n, "!");
        return true;
      }
      startApproach(n, "reputation", 0, { repKind: "fear", motive: "huddle fear read" });
      return true;
    }
    return false;
  }

  function gossip(n, p) {
    let source = null, target = null;
    if (n.memory && n.memory.t > 2 && !p.memory) { source = n; target = p; }
    else if (p.memory && p.memory.t > 2 && !n.memory) { source = p; target = n; }
    if (!source || !target || !copyMemory(source, target)) { shareBlockBuzz(n, p); return; }
    addBuzz(target.memory.type === "copCrime" ? "snitch" : "heat", 4, "gossip");
    rememberBlockRead(target, target.memory.type === "copCrime" ? "snitch" : "heat", target.memory.amount || 10, actorName(source));

    const sameGang = CBZ.player.gang != null && target.gang === CBZ.player.gang;
    const rivalGang = CBZ.player.gang != null && target.gang >= 0 && target.gang !== CBZ.player.gang;
    const standing = target.gang >= 0 ? gangStanding(target.gang) : 0;
    const tp = target.personality || {};
    emote(target, sameGang && standing > -10 ? "🤐" : "!");

    if (sameGang && standing > -10) {
      addGangStanding(target.gang, 1);
      target.memory.t *= 0.45; // your crew helps bury it
    } else {
      if (rivalGang) addGangStanding(target.gang, -2);
      const heat = Math.max(5, target.memory.amount * (rivalGang ? 0.75 : 0.45));
      if ((tp.snitch || 0) + (tp.nerve || 0) > 1.15 && rng() < (rivalGang ? 0.38 : 0.22)) {
        sendNpcToSnitch(target, heat, { copCrime: target.memory.type === "copCrime", lastKnown: target.memory.lastKnown, type: target.memory.kind });
        addBuzz("snitch", 6, actorName(target));
      }
    }

    if (CBZ.player && playerDist(target) < 18) {
      CBZ.game.gossipNoticeT = (CBZ.game.gossipNoticeT || 0) - 1;
      if ((CBZ.game.gossipNoticeT || 0) <= 0) {
        CBZ.game.gossipNoticeT = 3;
        CBZ.flashHint("Gossip spreads through the block.", 1.5);
      }
    }
  }

  function findFoe(n) {
    // rare betrayal: jump your own leader
    if (n.gang >= 0 && !n.isLeader && rng() < 0.012) {
      const ld = leaders[n.gang];
      if (alive(ld) && ld !== n) return ld;
    }
    // very rare: take a swing at a guard (anyone can do anything)
    if (rng() < 0.006) {
      const guards = CBZ.guards.filter((g) => alive(g) && dist(n, g) < 8);
      if (guards.length) return guards[Math.floor(rng() * guards.length)];
    }
    // otherwise: nearest living rival-gang inmate, only if fairly close
    let best = null, bd = 8 * 8;
    for (const a of nearbyNpcs(n, 8, _foeNear)) {
      if (a === n || !alive(a) || a.gang < 0 || a.gang === n.gang) continue;
      const dx = a.group.position.x - n.group.position.x, dz = a.group.position.z - n.group.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = a; }
    }
    return best;
  }

  function pickTurfTarget(n) {
    if (n.gang < 0 || !TURF[n.gang]) return false;
    const t = TURF[n.gang];
    const r = 4 + rng() * 8;
    const a = rng() * Math.PI * 2;
    n.target.set(t.x + Math.cos(a) * r, 0, t.z + Math.sin(a) * r);
    return true;
  }

  function startFight(n, foe) {
    n.aiState = "fight"; n.foe = foe; n.hitCD = 0;
    n.interceptTarget = null; n.interceptMode = null; n.interceptT = 0;
    // how the target answers depends on its TEMPERAMENT, not its skill:
    // a Defensive bruiser stands and wrecks you; a Pacifist bolts even
    // though they could win; a bad matchup makes anyone more likely to run.
    if (foe.gang != null && foe.aiState && alive(foe) && !foe.foe) {
      const fb = behaviorOf(foe);
      const odds = fightOdds(foe, n);                 // 0..1 the target would win
      const stand = fb.retaliate * (0.45 + odds * 0.85);
      if (rng() < Math.min(0.98, stand)) {
        foe.aiState = "fight"; foe.foe = n; foe.hitCD = 0.3;
      } else {
        foe.aiState = "flee"; foe.fleeT = 2.2 + rng() * 2.2; foe.foe = null;
        emote(foe, "💨");
      }
    } else if (foe.alert != null) {
      foe.alert = 2.5; // a guard turns to face the attacker
    }
  }

  // who this actor would actually pick a fight with, filtered by temperament.
  function findBrawlTarget(n) {
    const b = behaviorOf(n);
    // gang members keep their rival feud (handled by findFoe)
    if (n.gang >= 0) { const f = findFoe(n); if (f) return f; }
    if (b.init < 0.1) return null;                    // peaceful types never go looking
    const reach = b.picksWeak >= 0.9 ? 7 : 9;
    let best = null, bd = reach * reach;
    for (const a of nearbyNpcs(n, reach, _brawlNear)) {
      if (a === n || !alive(a) || a.role === "merchant") continue;
      if (n.gang >= 0 && a.gang === n.gang) continue; // don't jump your own crew
      const dx = a.group.position.x - n.group.position.x, dz = a.group.position.z - n.group.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= bd) continue;
      if (b.picksWeak >= 0.85 && fightOdds(n, a) < 0.55) continue; // bullies skip fair fights
      bd = d2; best = a;
    }
    return best;
  }

  function coolWanted(amount) {
    if (CBZ.addHeat) CBZ.addHeat(-amount);
    if (CBZ.reduceCasePressure) CBZ.reduceCasePressure(amount * 0.85);
    CBZ.game.witnessReportT = Math.max(0, (CBZ.game.witnessReportT || 0) - amount * 0.45);
    for (const gd of CBZ.guards || []) {
      if (!alive(gd)) continue;
      gd.alert = Math.max(0, (gd.alert || 0) - 0.55);
      if ((CBZ.game.detection || 0) < 42 || gd.corrupt) gd.hunt = Math.max(0, (gd.hunt || 0) - 1.5);
    }
  }

  function clampWorld(x, z) {
    const W = CBZ.WORLD || { minX: -34, maxX: 34, minZ: -43, maxZ: 51 };
    return {
      x: Math.max(W.minX, Math.min(W.maxX, x)),
      z: Math.max(W.minZ, Math.min(W.maxZ, z)),
    };
  }

  function misdirectSearch(n, strength) {
    strength = Math.max(1, strength || 2);
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
    const nx = n.group.position.x, nz = n.group.position.z;
    const away = Math.atan2(nz - pz, nx - px) + (rng() - 0.5) * 1.4;
    const range = 8 + Math.min(14, strength * 1.25) + rng() * 5;
    const lead = clampWorld(nx + Math.cos(away) * range, nz + Math.sin(away) * range);
    const who = n.data.name.replace(/^the |^a |^an /, "");
    CBZ.game.lastKnown = {
      x: lead.x,
      z: lead.z,
      t: 8 + Math.min(8, strength * 0.55),
      amount: Math.max(4, ((CBZ.game.lastKnown && CBZ.game.lastKnown.amount) || 12) - strength),
      type: "false lead",
      heardOnly: true,
      source: `${who}'s rumor`,
    };
    let sent = 0;
    for (const gd of CBZ.guards || []) {
      if (!alive(gd) || gd.corrupt || gd.bribed > 0) continue;
      if (sent >= 3) break;
      if ((gd.hunt || 0) <= 0 && !gd.investigate && (CBZ.game.detection || 0) < 18) continue;
      gd.investigate = { x: lead.x, z: lead.z, t: 5.5 + sent * 1.1, scan: 0, type: "false lead" };
      gd.alert = Math.max(gd.alert || 0, 0.55);
      gd.hunt = Math.max(0, (gd.hunt || 0) - 1.0);
      sent++;
    }
    return lead;
  }

  function findProtector(snitch) {
    const gang = protectionGang();
    if (gang == null) return null;
    const standing = gangStanding(gang);
    if (standing < 12 && gangProtection(gang) <= 0) return null;

    let best = null, bs = -Infinity;
    for (const ally of CBZ.npcs) {
      if (ally === snitch || !alive(ally) || ally.gang !== gang || ally.foe || ally.aiState === "snitch") continue;
      const dSnitch = dist(ally, snitch);
      const dPlayer = playerDist(ally);
      if (dSnitch > 14 && dPlayer > 15) continue;
      const p = ally.personality || {};
      const score = standing * 0.03 + (p.loyalty || 0.5) * 1.25 + (p.nerve || 0.5) * 0.85 - dSnitch * 0.055 - dPlayer * 0.025;
      if (score > bs) { bs = score; best = ally; }
    }
    return best;
  }

  function tryGangInterceptSnitch(snitch, amount, meta) {
    const gang = protectionGang();
    if (!snitch || gang == null || (meta && meta.copCrime)) return false;
    if (snitch.gang === gang) return false;
    const ally = findProtector(snitch);
    if (!ally) return false;

    const standing = gangStanding(gang);
    const p = ally.personality || {};
    const paid = gangProtection(gang) > 0 ? 0.16 : 0;
    const chance = Math.min(0.82, 0.18 + paid + standing / 120 + (p.loyalty || 0.5) * 0.24 + (p.nerve || 0.5) * 0.18);
    if (rng() > chance) return false;

    ally.memory = null;
    snitch.memory = null;
    snitch.snitchHeat = 0;
    snitch.snitchT = 0;
    snitch.snitchMeta = null;
    addGangStanding(gang, -3);

    if ((p.nerve || 0) > ((snitch.personality && snitch.personality.nerve) || 0.4) + 0.18) {
      snitch.aiState = "flee";
      snitch.fleeT = 2.8 + rng() * 2;
      snitch.foe = null;
      snitch.target.set((rng() - 0.5) * 48, 0, 8 + rng() * 38);
      emote(ally, "🤐");
      emote(snitch, "!");
    } else {
      startFight(ally, snitch);
      emote(ally, "✊");
    }

    if (CBZ.flashHint && (playerDist(ally) < 20 || playerDist(snitch) < 20)) {
      CBZ.flashHint(`${GANG_NAMES[gang]} intercept the snitch. Respect ${gangStanding(gang)}.`, 1.9);
    }
    return true;
  }

  function eligibleProtector(ally, gang) {
    if (!ally || !alive(ally) || ally.gang !== gang || ally.role === "merchant" || ally.role === "dealer") return false;
    if (ally.approach || ally.aiState === "fight" || ally.aiState === "snitch" || ally.huntPlayer > 0) return false;
    return true;
  }

  function findProtectorForThreat(gang, threat, maxDist) {
    if (gang == null || !alive(threat)) return null;
    const standing = gangStanding(gang);
    const cover = gangProtection(gang);
    const committed = (CBZ.player && CBZ.player.gang === gang) || cover > 0 || standing > 10;
    if (!committed) return null;
    let best = null, bs = -Infinity;
    for (const ally of CBZ.npcs || []) {
      if (ally === threat || !eligibleProtector(ally, gang)) continue;
      const dThreat = dist(ally, threat);
      const dPlayer = playerDist(ally);
      if (dThreat > (maxDist || 16) && dPlayer > 14) continue;
      const p = ally.personality || {};
      const score =
        standing * 0.035 +
        cover * 0.035 +
        (p.loyalty || 0.5) * 1.4 +
        (p.nerve || 0.5) * 0.9 -
        dThreat * 0.060 -
        dPlayer * 0.025 +
        (ally.isLeader ? 0.4 : 0) +
        crewRoleScore(ally, "crewBackup") * 0.16;
      if (score > bs) { bs = score; best = ally; }
    }
    return best;
  }

  function startGangIntercept(ally, threat, mode) {
    if (!ally || !threat) return false;
    ally.aiState = "interceptThreat";
    ally.interceptTarget = threat;
    ally.interceptMode = mode || "pressure";
    ally.interceptT = mode === "snitch" ? 7.5 : 5.5;
    ally.foe = null;
    ally.social = null;
    emote(ally, mode === "snitch" ? "🤐" : "✊");
    return true;
  }

  function maybeStartDebtCollector(gang) {
    const g = CBZ.game || {};
    if (g.role === "cop" || playerApproachBusy()) return false;
    const debt = gangDebt(gang);
    const standing = gangStanding(gang);
    const cigs = g.cigs || 0;
    if (cigs <= 0 || (debt < 10 && standing > -22)) return false;
    let best = null, bs = -Infinity;
    for (const n of CBZ.npcs || []) {
      if (!alive(n) || n.gang !== gang || n.role === "merchant" || n.role === "dealer" || n.approach) continue;
      if (n.aiState === "fight" || n.aiState === "snitch" || n.huntPlayer > 0) continue;
      const d = playerDist(n);
      if (d < 5 || d > 15) continue;
      const p = n.personality || {};
      const score = debt * 0.22 + Math.max(0, -standing) * 0.06 + (p.greed || 0.5) * 1.2 + (p.nerve || 0.5) * 0.8 - d * 0.055;
      if (score > bs) { bs = score; best = n; }
    }
    if (!best || bs < 2.2) return false;
    startApproach(best, debt >= 10 ? "debtCollect" : "tax", Math.min(cigs, Math.max(2, Math.ceil(debt * 0.45) + Math.floor(((best.personality && best.personality.greed) || 0.5) * 4))), { debt: true, socialRead: "debt-pressure" });
    return true;
  }

  function maybeStartCashPredator() {
    const g = CBZ.game || {};
    if (g.role === "cop" || playerApproachBusy() || (g.lowProfileT || 0) > 0) return false;
    const cigs = g.cigs || 0;
    const wealthBuzz = (blockRumor().wealth || 0);
    if (cigs < 18 && wealthBuzz < 34) return false;
    let best = null, bs = -Infinity;
    for (const n of CBZ.npcs || []) {
      if (!alive(n) || n.role === "merchant" || n.approach || n.aiState === "fight" || n.aiState === "snitch" || n.huntPlayer > 0) continue;
      const d = playerDist(n);
      if (d < 5 || d > 14) continue;
      const rivalGang = CBZ.player.gang != null && n.gang >= 0 && n.gang !== CBZ.player.gang;
      const p = n.personality || {};
      const standing = n.gang >= 0 ? gangStanding(n.gang) : 0;
      const score = (p.greed || 0.5) * 1.7 + (p.nerve || 0.5) * 0.8 + (n.role === "thief" ? 1.0 : 0) + (rivalGang ? 0.8 : 0) + Math.max(0, -standing) * 0.025 + cigs * 0.018 - d * 0.06;
      if (score > bs) { bs = score; best = n; }
    }
    if (!best || bs < 1.9) return false;
    const profile = stashPressure();
    const rivalGang = CBZ.player.gang != null && best.gang >= 0 && best.gang !== CBZ.player.gang;
    startApproach(best, (best.role === "thief" || rivalGang || (best.gang >= 0 && gangStanding(best.gang) < -10)) ? "stickUp" : "stashCover", Math.min(cigs, Math.max(3, Math.ceil(profile.score / 9) + Math.floor(((best.personality && best.personality.greed) || 0.5) * 4))), { rivalGang, stashItems: profile.stash, socialRead: "cash-pressure" });
    return true;
  }

  function bestGangActor(gang, maxDist, mode) {
    let best = null, bs = -Infinity;
    for (const n of CBZ.npcs || []) {
      if (!alive(n) || n.gang !== gang || n.role === "merchant" || n.role === "dealer" || n.approach) continue;
      if (n.aiState === "fight" || n.aiState === "snitch" || n.huntPlayer > 0 || n.aiState === "interceptThreat") continue;
      const d = playerDist(n);
      if (d > (maxDist || 16)) continue;
      const p = n.personality || {};
      const role = crewRole(n);
      let score = (p.loyalty || 0.5) * 1.2 + (p.nerve || 0.5) * 0.9 - d * 0.055 + (n.isLeader ? 0.75 : 0);
      if (mode === "cover") score += crewRoleScore(n, "crewBackup") * 0.18 + (role === "lookout" ? 1.0 : 0);
      if (mode === "collect") score += crewRoleScore(n, "debtCollect") * 0.20 + (role === "collector" || role === "enforcer" ? 1.2 : 0) + (p.greed || 0.5) * 0.65;
      if (score > bs) { bs = score; best = n; }
    }
    return best;
  }

  function gangThresholdHint(text) {
    const g = CBZ.game || {};
    if (!CBZ.flashHint) return;
    g.gangNoticeT = (g.gangNoticeT || 0) - 1;
    if (g.gangNoticeT > 0) return;
    g.gangNoticeT = 3.4;
    CBZ.flashHint(text, 1.7);
  }

  function updateGangThresholds(dt) {
    const g = CBZ.game || {};
    if (g.state !== "playing" || g.role === "cop" || (CBZ.player.stun || 0) > 0) return;
    const timers = g.gangTierT || (g.gangTierT = [0, 0]);
    const heat = g.detection || 0;
    const caseHeat = CBZ.caseSummary ? ((CBZ.caseSummary() || {}).heat || 0) : 0;
    const searchHeat = heat > 22 || caseHeat > 14 || (g.witnessReportT || 0) > 0 || (g.lastKnown && g.lastKnown.t > 0);
    for (let gang = 0; gang < 2; gang++) {
      timers[gang] = Math.max(0, (timers[gang] || 0) - dt);
      if (timers[gang] > 0) continue;
      timers[gang] = 4.4 + rng() * 3.6;

      const standing = gangStanding(gang);
      const debt = gangDebt(gang);
      const cover = gangProtection(gang);
      const sameCrew = CBZ.player && CBZ.player.gang === gang;
      const onTurf = CBZ.player && isOnTurf(gang, CBZ.player.pos);
      const respected = standing >= 48 || (sameCrew && standing >= 14);
      const hostile = standing <= -42 || debt >= 18;

      if (respected && (sameCrew || onTurf || searchHeat)) {
        if (cover < 7 || searchHeat) {
          addGangProtection(gang, 10 + Math.min(18, Math.max(0, standing) * 0.18) + (sameCrew ? 8 : 0));
          addBuzz("heat", -4, "standing-cover");
          if (searchHeat && CBZ.reduceCasePressure) CBZ.reduceCasePressure(2 + Math.max(0, standing) * 0.035);
          const ally = bestGangActor(gang, searchHeat ? 18 : 13, "cover");
          if (ally) {
            ally.aiState = "shadowPlayer";
            ally.shadowT = Math.max(ally.shadowT || 0, 9 + rng() * 6 + Math.max(0, standing) * 0.05);
            ally.foe = null;
            emote(ally, "+");
          }
          if (onTurf || searchHeat) gangThresholdHint(`${GANG_NAMES[gang]} cover activates from respect.`);
        }
        continue;
      }

      if (!hostile) continue;
      if (!onTurf && debt < 24 && standing > -60 && rng() < 0.45) continue;
      const collector = bestGangActor(gang, onTurf ? 17 : 14, "collect");
      if (!collector) continue;
      const cigs = g.cigs || 0;
      const canTalk = cigs > 0 && !playerApproachBusy(collector) && playerDist(collector) >= 4.2 && playerDist(collector) <= 15.5;
      if (canTalk) {
        const cost = Math.min(cigs, Math.max(2, Math.ceil(Math.max(debt, Math.abs(Math.min(standing, 0)) * 0.18)) + Math.floor(((collector.personality && collector.personality.greed) || 0.5) * 4)));
        const kind = debt >= 10 ? "debtCollect" : (onTurf ? "tax" : "turfWarning");
        startApproach(collector, kind, kind === "turfWarning" ? 0 : cost, {
          debt: debt > 0,
          thresholdPressure: true,
          msg: debt >= 10
            ? `${actorName(collector)} says ${GANG_NAMES[gang]} are collecting on your tab.`
            : `${actorName(collector)} says ${GANG_NAMES[gang]} have you marked.`,
        });
        gangThresholdHint(`${GANG_NAMES[gang]} send a collector. Debt ${debt}, respect ${standing}.`);
      } else if (onTurf || standing <= -62 || debt >= 26) {
        provokeGang(collector, 4.5 + Math.min(7, debt * 0.16 + Math.max(0, -standing) * 0.035));
        gangThresholdHint(`${GANG_NAMES[gang]} stop talking and press you.`);
      }
      timers[gang] = 6.8 + rng() * 4.2;
    }
  }

  function checkpointProfile(gang) {
    const g = CBZ.game || {};
    const inv = g.inventory || {};
    const stash = Object.keys(inv).filter((k) => (inv[k] || 0) > 0 && k !== "Gun" && k !== "Keycard").length;
    const cigs = g.cigs || 0;
    const heat = g.detection || 0;
    const debt = gangDebt(gang);
    const standing = gangStanding(gang);
    const rival = CBZ.player && CBZ.player.gang != null && CBZ.player.gang !== gang;
    const armed = !!(CBZ.playerArmed && CBZ.playerArmed());
    const keycard = !!g.hasKey;
    const reasons = [];
    if (keycard) reasons.push("keycard");
    if (cigs >= 12) reasons.push("cash");
    if (stash > 0) reasons.push("stash");
    if (heat > 22) reasons.push("heat");
    if (debt > 0) reasons.push("debt");
    if (rival) reasons.push("rival colors");
    if (armed) reasons.push("weapon");
    if (standing < -8) reasons.push("bad blood");
    return {
      cigs,
      stash,
      heat,
      debt,
      standing,
      rival,
      armed,
      keycard,
      reasons,
      score:
        cigs * 0.42 +
        stash * 5 +
        (keycard ? 9 : 0) +
        (armed ? 6 : 0) +
        Math.max(0, heat - 12) * 0.20 +
        debt * 0.85 +
        Math.max(0, -standing) * 0.20 +
        (rival ? 8 : 0),
    };
  }

  function checkpointActor(gang) {
    let best = null, bs = -Infinity;
    for (const n of CBZ.npcs || []) {
      if (!alive(n) || n.gang !== gang || n.role === "merchant" || n.role === "dealer" || n.approach) continue;
      if (n.aiState === "fight" || n.aiState === "snitch" || n.huntPlayer > 0 || n.aiState === "interceptThreat") continue;
      const d = playerDist(n);
      if (d < 3.8 || d > 16.5) continue;
      const p = n.personality || {};
      const role = crewRole(n);
      let score =
        (p.nerve || 0.5) * 1.3 +
        (p.greed || 0.5) * 1.1 +
        crewRoleScore(n, "tax") * 0.25 +
        (role === "collector" || role === "enforcer" ? 1.4 : 0) +
        (n.isLeader ? 0.7 : 0) -
        d * 0.06;
      if (isOnTurf(gang, n.group.position)) score += 0.8;
      if (score > bs) { bs = score; best = n; }
    }
    return best;
  }

  function updateTurfCheckpoints(dt) {
    const g = CBZ.game || {};
    if (g.state !== "playing" || g.role === "cop" || (CBZ.player.stun || 0) > 0) return;
    if (playerApproachBusy()) return;
    const timers = g.turfCheckpointT || (g.turfCheckpointT = [0, 0]);
    for (let gang = 0; gang < 2; gang++) {
      timers[gang] = Math.max(0, (timers[gang] || 0) - dt);
      if (timers[gang] > 0) continue;
      const onTurf = CBZ.player && isOnTurf(gang, CBZ.player.pos);
      if (!onTurf) {
        timers[gang] = 1.4 + rng() * 1.3;
        continue;
      }

      const sameCrew = CBZ.player && CBZ.player.gang === gang;
      const cover = gangProtection(gang);
      const profile = checkpointProfile(gang);
      if (sameCrew || cover > 0 || (profile.standing > 34 && profile.score < 20)) {
        timers[gang] = 3.2 + rng() * 2.6;
        continue;
      }
      if (profile.score < 9 && profile.standing > -10) {
        timers[gang] = 2.6 + rng() * 2.4;
        continue;
      }

      const actor = checkpointActor(gang);
      if (!actor) {
        timers[gang] = 1.8 + rng() * 1.6;
        continue;
      }

      const p = actor.personality || {};
      const reason = profile.reasons.slice(0, 2).join("/") || "turf";
      let kind = "turfWarning";
      let cost = 0;
      if (profile.cigs > 0) {
        cost = Math.min(profile.cigs, Math.max(2,
          Math.ceil(profile.score / 8) +
          Math.floor((p.greed || 0.5) * 4) +
          (profile.rival ? 1 : 0)
        ));
        kind = profile.rival || profile.standing < -18 || (profile.cigs >= 18 && (p.greed || 0.5) > 0.54) ? "stickUp" : "tax";
      } else if (profile.rival || profile.standing < -16) {
        kind = "gangParley";
      }

      const extra = {
        turfCheckpoint: true,
        tollReason: reason,
        debt: profile.debt > 0,
        rivalGang: profile.rival,
        keycardSeen: profile.keycard,
        stashItems: profile.stash,
      };
      if (kind === "gangParley") {
        const parley = gangParleyFor(actor);
        extra.parleyMode = profile.rival || profile.standing < -16 ? "truce" : parley.mode;
        extra.parleyStanding = profile.standing;
        extra.parleyDebt = profile.debt;
        cost = Math.min(profile.cigs, parley.cost || 0);
      }
      extra.msg = kind === "turfWarning"
        ? `${actorName(actor)} blocks the path and says ${GANG_NAMES[gang]} are watching the checkpoint.`
        : kind === "stickUp"
        ? `${actorName(actor)} clocks ${reason} and wants ${cost} cigs before you cross ${GANG_NAMES[gang]} turf.`
        : kind === "gangParley"
        ? `${actorName(actor)} wants a ${GANG_NAMES[gang]} checkpoint sit-down.`
        : `${actorName(actor)} clocks ${reason} and wants ${cost} cigs for safe passage.`;

      startApproach(actor, kind, cost, extra);
      addBuzz(kind === "stickUp" ? "wealth" : "debt", 5 + Math.min(7, profile.score * 0.12), "turf-checkpoint");
      for (const m of CBZ.npcs || []) {
        if (m !== actor && alive(m) && m.gang === gang && playerDist(m) < 17) {
          rememberBlockRead(m, kind === "stickUp" ? "wealth" : "debt", 18 + Math.min(22, profile.score), actorName(actor));
        }
      }
      if (CBZ.flashHint && playerDist(actor) < 18) CBZ.flashHint(`${GANG_NAMES[gang]} checkpoint reacts to ${reason}.`, 1.55);
      timers[gang] = 9.5 + rng() * 6.5;
    }
  }

  function updateGangPresence(dt) {
    const g = CBZ.game || {};
    if (g.state !== "playing" || (CBZ.player.stun || 0) > 0) return;
    g.gangPresenceT = Math.max(0, (g.gangPresenceT || 0) - dt);
    if (g.gangPresenceT > 0) return;
    g.gangPresenceT = 0.85 + rng() * 0.75;

    const gang = protectionGang();
    if (gang != null) {
      const snitch = (CBZ.npcs || []).find((n) => alive(n) && n.aiState === "snitch" && n.gang !== gang && playerDist(n) < 24);
      if (snitch) {
        const ally = findProtectorForThreat(gang, snitch, 18);
        if (ally && startGangIntercept(ally, snitch, "snitch")) {
          addBuzz("snitch", -5, "crew-intercept");
          if (CBZ.flashHint && (playerDist(ally) < 18 || playerDist(snitch) < 18)) CBZ.flashHint(`${GANG_NAMES[gang]} move to cut off the snitch.`, 1.5);
          return;
        }
      }

      const hunter = (CBZ.npcs || []).find((n) => alive(n) && n.huntPlayer > 0 && n.gang !== gang && playerDist(n) < 18);
      if (hunter) {
        const ally = findProtectorForThreat(gang, hunter, 14);
        if (ally && startGangIntercept(ally, hunter, "rival")) {
          if (CBZ.flashHint && playerDist(ally) < 16) CBZ.flashHint(`${GANG_NAMES[gang]} step between you and the pressure.`, 1.4);
          return;
        }
      }
    }

    const debts = CBZ.game.gangDebt || [0, 0];
    const first = (debts[0] || 0) >= (debts[1] || 0) ? 0 : 1;
    if ((debts[first] || 0) > 8 && rng() < 0.36 && maybeStartDebtCollector(first)) return;
    const other = first === 0 ? 1 : 0;
    if ((debts[other] || 0) > 12 && rng() < 0.26 && maybeStartDebtCollector(other)) return;
    if (rng() < 0.30) maybeStartCashPredator();
  }

  function kill(victim, killer, opts) {
    opts = opts || {};
    if (!victim || victim.dead) return;
    victim.dead = true;
    victim.ko = 0;
    victim.hp = 0;
    // CINEMATIC death — blood + flying gibs at the body. Player kills get a
    // beefier burst + a hit cue; NPC-vs-NPC brawls just spray (no sound spam).
    if (CBZ.gore && victim.group) {
      const vp = victim.group.position;
      const kg = killer && killer.group;
      const playerKill = !!(kg && CBZ.playerChar && kg === CBZ.playerChar.group);
      CBZ.gore(vp.x, vp.y + 1.1, vp.z, {
        dir: kg ? { x: vp.x - kg.position.x, z: vp.z - kg.position.z } : null,
        amount: playerKill ? 1.2 : 0.85, player: false, sfx: playerKill ? "hit" : false,
      });
    }
    victim.aiState = "dead";
    victim.foe = null;
    victim.social = null;
    victim.approach = null;
    victim.huntPlayer = 0;
    victim.hunt = 0;
    victim.alert = 0;
    victim.bribed = 0;
    credit(killer, "kills");
    CBZ.game.deaths = (CBZ.game.deaths || 0) + 1;
    if (victim.wedge) victim.wedge.visible = false;
    if (killer && killer.group && !opts.noKnock) knockback(victim, killer.group.position.x, killer.group.position.z, 1.1);
    if (killer === CBZ.player) addBuzz("fear", 25, actorName(victim));
    if (victim.gang >= 0 && killer && CBZ.playerChar && killer.group === CBZ.playerChar.group) {
      noteGangIncident(victim, "kill", victim.isLeader ? 18 : 13, { source: "killing" });
    }
    // loot: a PLAYER kill frisks the body for everything they were carrying;
    // an NPC-vs-NPC death just leaves a small stash pack on the ground.
    const playerKill = killer && CBZ.playerChar && killer.group === CBZ.playerChar.group;
    if (playerKill && CBZ.econ && CBZ.econ.lootActor) CBZ.econ.lootActor(victim, {});
    else if (!opts.noDrop && CBZ.addPack) CBZ.addPack(victim.group.position.x, victim.group.position.z, 6);
    // leadership passes to a surviving gang-mate — and the crew's morale
    // breaks: they scatter in panic for a few seconds
    if (victim.isLeader && victim.gang >= 0) {
      victim.isLeader = false;
      const heir = CBZ.npcs.find((m) => m.gang === victim.gang && alive(m) && m !== victim);
      if (heir) { heir.isLeader = true; leaders[victim.gang] = heir; }
      for (const m of CBZ.npcs) {
        if (m.gang === victim.gang && alive(m)) { m.aiState = "flee"; m.fleeT = 3.5; m.foe = null; }
      }
      if (CBZ.player && Math.hypot(CBZ.player.pos.x - victim.group.position.x, CBZ.player.pos.z - victim.group.position.z) < 24)
        CBZ.flashHint(`${GANG_NAMES[victim.gang]} scatter — their leader's down!`, 2);
    }
    // tell the player if it happened in view
    if (!opts.quiet && CBZ.player && Math.hypot(CBZ.player.pos.x - victim.group.position.x, CBZ.player.pos.z - victim.group.position.z) < 22) {
      const who = victim.data ? victim.data.name.replace(/^the |^a |^an /, "") : "someone";
      CBZ.flashHint(`💀 ${who} was taken out!`, 2.2);
    }
  }

  // credit a combat event onto whoever caused it (NPC, guard, or player)
  function credit(by, field) {
    if (!by) return;
    if (!by.record) by.record = { kills: 0, knockdowns: 0, downs: 0, fights: 0 };
    by.record[field] = (by.record[field] || 0) + 1;
  }

  // most beatdowns are survivable knockdowns; death is the exception —
  // and a tougher target is harder to put in the ground for good.
  function down(actor, by) {
    const tough = actor.ratings ? actor.ratings.toughness : 50;
    if (rng() < 0.15 * (1.2 - tough / 200)) { kill(actor, by); return; }
    credit(by, "knockdowns");
    credit(actor, "downs");
    actor.ko = 6 + rng() * 4; actor.hp = Math.round((actor.maxHp || 100) * 0.5); actor.aiState = "wander"; actor.foe = null;
    if (actor.gang >= 0 && by === CBZ.player) addGangStanding(actor.gang, -14);
    if (by === CBZ.player) addBuzz("fear", 12, actorName(actor));
    if (CBZ.knockback && by) CBZ.knockback(actor, by.group.position.x, by.group.position.z, 0.8);
  }
  function exchangeBlows(n, f) {
    const guardish = f.kind === "guard" || f.kind === "warden";
    const nf = (n.ratings && n.ratings.fighting) || 50;
    const ff = (f.ratings && f.ratings.fighting) || (guardish ? 72 : 50);
    const nt = (n.ratings && n.ratings.toughness) || 50;
    const ft = (f.ratings && f.ratings.toughness) || (guardish ? 78 : 50);
    credit(n, "fights");
    // damage = base swing × attacker's fighting edge × defender's guard
    f.hp -= (4 + rng() * 5) * (0.55 + nf / 80) * (1 - ft / 320);
    n.hp -= ((guardish ? 7 : 3) + rng() * 4) * (0.55 + ff / 80) * (1 - nt / 320);
    if (guardish) f.alert = 2.5;
    CBZ.sfx && CBZ.sfx("punch");
    if (f.hp <= 0 && alive(f)) down(f, n);
    if (n.hp <= 0 && alive(n)) down(n, f);
  }

  // ---- the per-NPC think, returns desired move speed ----
  function aiThink(n, dt) {
    if (!inited) initWorld();
    if (n.hp == null) initActor(n);
    // fade any emote bubble
    if (n._emoteT > 0) { n._emoteT -= dt; if (n._emoteT <= 0 && n._emote) n._emote.visible = false; }
    if (n.memory && n.memory.t > 0) {
      n.memory.t -= dt;
      if (n.memory.t <= 0) n.memory = null;
    }
    if (n.blockRead && n.blockRead.t > 0) {
      n.blockRead.t -= dt;
      if (n.blockRead.t <= 0) n.blockRead = null;
    }
    if (n.coverDebt && n.coverDebt.t > 0) {
      n.coverDebt.t -= dt;
      if (n.coverDebt.t <= 0) n.coverDebt = null;
    }
    if ((n.reportedPlayerT || 0) > 0) {
      n.reportedPlayerT = Math.max(0, n.reportedPlayerT - dt);
      if (n.reportedPlayerT <= 0) clearKnownReport(n);
      else if (n.aiState === "wander" && playerDist(n) < 7 && rng() < 0.012) {
        n.aiState = "flee";
        n.fleeT = 1.6 + rng() * 1.8;
        emote(n, "!");
      }
    }
    if (n.copMarked > 0) {
      n.copMarked = Math.max(0, n.copMarked - dt);
      if (n.copMarked > 0 && n.aiState === "wander" && CBZ.game.role === "cop" && playerDist(n) < 13 && rng() < 0.012) emote(n, "!");
    }
    if (n.dead) return 0;

    // HELD AT GUNPOINT: if the player is pointing a gun at this inmate, the
    // intimidation system owns its behavior (hands up / draw / stand-off).
    // think() returns a move speed (0 = frozen) while reacting, else null.
    if (CBZ.intimidate) {
      const is = CBZ.intimidate.think(n, dt);
      if (is != null) return is;
    }

    // GANG RETALIATION: hunting the player down (set by provokeGang)
    if (n.huntPlayer > 0) {
      n.huntPlayer -= dt;
      const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
      n.target.set(px, 0, pz);
      const d = Math.hypot(px - n.group.position.x, pz - n.group.position.z);
      n.hitCD -= dt;
      if (d < 1.9 && n.hitCD <= 0) {
        n.hitCD = 1.0;
        CBZ.player.stun = Math.max(CBZ.player.stun || 0, 0.5);
        CBZ.addHeat(4);
        CBZ.flashHint(`${n.data.name.replace(/^the |^a |^an /, "")} jumps you!`, 1.2);
        CBZ.sfx("jump");
      }
      return n.baseSpeed * 1.5;
    }

    // DEFEND: once you've joined a gang, your crew jumps whoever's hunting you
    if (CBZ.player.gang != null && n.gang === CBZ.player.gang && n.aiState !== "fight") {
      for (const a of nearbyNpcs(n, 12, _defendNear)) {
        if (a.huntPlayer > 0 && alive(a) && dist(n, a) < 12) { startFight(n, a); break; }
      }
      const d = playerDist(n);
      if (n.aiState === "wander" && d > 4 && d < 13 && ((CBZ.game.detection || 0) > 28 || CBZ.econ.rng() < 0.006)) {
        const side = (n.personality && n.personality.loyalty > 0.5) ? -1 : 1;
        n.target.set(CBZ.player.pos.x + side * (1.8 + rng() * 1.5), 0, CBZ.player.pos.z - 1.6 - rng());
        if (rng() < 0.02) emote(n, "✊");
        return n.baseSpeed * 1.25;
      }
    }

    if (n.aiState === "wander" && n.role !== "merchant" && n.role !== "dealer" && CBZ.playerArmed && CBZ.playerArmed()) {
      const d = Math.hypot(CBZ.player.pos.x - n.group.position.x, CBZ.player.pos.z - n.group.position.z);
      if (d < 8 && rng() < 0.028) { n.aiState = "flee"; n.fleeT = 2.4 + rng() * 2; emote(n, "!"); }
    }
    considerPlayerApproach(n, dt);

    n.aiTimer -= dt;

    switch (n.aiState) {
      case "approachPlayer": {
        const a = n.approach;
        if (!a) { n.aiState = "wander"; break; }
        a.t -= dt;
        const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
        const d = Math.hypot(px - n.group.position.x, pz - n.group.position.z);
        if (CBZ.game.state !== "playing") {
          clearApproach(n);
          break;
        }
        if (d > APPROACH_FAR + 5 || a.t <= 0) {
          expireApproach(n, d > APPROACH_FAR + 5 ? "walkedAway" : "timeout");
          break;
        }
        n.target.set(px, 0, pz);
        if (d <= APPROACH_NEAR) {
          n.target.set(n.group.position.x, 0, n.group.position.z);
          n.group.rotation.y = CBZ.lerpAngle(n.group.rotation.y, Math.atan2(px - n.group.position.x, pz - n.group.position.z), 1 - Math.pow(0.0001, dt));
          if (!a.greeted) {
            a.greeted = true;
            CBZ.flashHint(a.msg + " Walk up to answer.", 2.2);
          }
          return 0;
        }
        return n.baseSpeed * (a.kind === "tax" || a.kind === "snitchThreat" || a.kind === "turfWarning" ? 1.45 : 1.15);
      }
      case "pressurePlayer": {
        n.pressureT -= dt;
        const src = n.pressureSource;
        const active = src && alive(src) && src.approach && src.approach.t > 0 && src.aiState === "approachPlayer";
        if (!active || n.pressureT <= 0 || CBZ.game.state !== "playing") {
          n.pressureSource = null;
          n.pressureKind = null;
          n.pressureTactic = null;
          n.pressureT = 0;
          n.aiState = "wander";
          n.aiTimer = 0.2 + rng() * 0.6;
          break;
        }
        const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
        const sx = src.group.position.x, sz = src.group.position.z;
        const base = Math.atan2(sz - pz, sx - px);
        const slot = n.pressureSlot || 0;
        const tactic = n.pressureTactic || pressureTactic(n, n.pressureKind, slot);
        const side = slot % 2 === 0 ? 1 : -1;
        let angle = base + side * (0.82 + slot * 0.32);
        let radius = 3.0 + slot * 0.55;
        let speedMul = 1.12;
        if (tactic === "block") {
          angle = base + side * (0.46 + slot * 0.18);
          radius = 2.35 + slot * 0.22;
          speedMul = 1.28;
        } else if (tactic === "lean") {
          angle = base + side * (0.62 + slot * 0.20);
          radius = 2.70 + slot * 0.25;
          speedMul = 1.18;
        } else if (tactic === "watch") {
          angle = base + side * (1.24 + slot * 0.24);
          radius = 5.35 + slot * 0.34;
          speedMul = 0.92;
        } else if (tactic === "cutoff") {
          angle = base + Math.PI + side * (0.34 + slot * 0.18);
          radius = 4.25 + slot * 0.32;
          speedMul = 1.42;
        } else if (tactic === "command") {
          angle = base + side * 0.96;
          radius = 4.35;
          speedMul = 0.96;
        }
        const pos = clampWorld(px + Math.cos(angle) * radius, pz + Math.sin(angle) * radius);
        n.target.set(pos.x, 0, pos.z);
        const d = Math.hypot(px - n.group.position.x, pz - n.group.position.z);
        if (d < 4.0) {
          n.group.rotation.y = CBZ.lerpAngle(n.group.rotation.y, Math.atan2(px - n.group.position.x, pz - n.group.position.z), 1 - Math.pow(0.00008, dt));
          if (tactic === "watch" && n.blockRead && (n.blockRead.t || 0) > 0 && rng() < 0.010) {
            addBuzz(n.blockRead.kind, 1.2, actorName(n));
          }
          if ((tactic === "block" || tactic === "lean") && d < 2.35 && rng() < 0.010) {
            CBZ.player.stun = Math.max(CBZ.player.stun || 0, tactic === "block" ? 0.16 : 0.10);
          }
          if (tactic === "command" && rng() < 0.010) {
            src.approach.t = Math.max(src.approach.t || 0, 3.5);
          }
          if (rng() < 0.006) emote(n, pressureEmote(tactic, n.pressureKind !== "crewDues" && n.pressureKind !== "gangParley"));
        }
        return n.baseSpeed * speedMul;
      }
      case "tailPlayer": {
        n.tailT -= dt;
        const kind = n.tailKind || "watch";
        const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
        const dxp = px - n.group.position.x, dzp = pz - n.group.position.z;
        const d = Math.hypot(dxp, dzp);
        if (n.tailT <= 0 || CBZ.game.state !== "playing" || d > 24) {
          n.tailT = 0; n.tailKind = null; n.tailCommitT = 0;
          n.aiState = "wander"; n.aiTimer = 0.2 + rng() * 0.6;
          break;
        }

        if (kind !== "cover" && CBZ.playerArmed && CBZ.playerArmed() && d < 6.2 && ((n.personality && n.personality.nerve) || 0.5) < 0.58) {
          n.tailT = 0; n.tailKind = null; n.tailCommitT = 0;
          n.aiState = "flee"; n.fleeT = 1.8 + rng() * 1.8; emote(n, "!");
          break;
        }

        const g = CBZ.game || {};
        const p = n.personality || {};
        const cprof = casePressureProfile();
        const searchHeat = (g.lastKnown && g.lastKnown.t > 0) || (g.witnessReportT || 0) > 0 || (g.detection || 0) > 24 || cprof.heat > 12;
        const cigs = g.cigs || 0;
        const sameGang = CBZ.player.gang != null && n.gang === CBZ.player.gang;
        const protectedHere = n.gang >= 0 && gangProtection(n.gang) > 0;
        const rivalGang = CBZ.player.gang != null && n.gang >= 0 && n.gang !== CBZ.player.gang;

        if (n.tailCommitT > 0 && n.tailT <= n.tailCommitT && d < 12.5 && !playerApproachBusy(n)) {
          n.tailCommitT = 0;
          if (kind === "cover") {
            const source = searchSource(caseSourceName(cprof, "guard chatter"));
            if (n.gang >= 0 && searchHeat) startApproach(n, "coverStory", 0, { source, watched: true, caseSourceCount: cprof.count, caseCredibility: cprof.credibility });
            else if (searchHeat) startApproach(n, "heatWarning", 0, { source, watched: true, caseSourceCount: cprof.count });
            else {
              n.aiState = "shadowPlayer";
              n.shadowT = Math.max(n.shadowT || 0, 8 + rng() * 5);
              emote(n, "+");
            }
            return n.baseSpeed * 1.1;
          }
          if (kind === "snitch") {
            const amount = Math.max(10, (g.lastKnown && g.lastKnown.amount) || cprof.heat * 0.35 || (g.detection || 0) * 0.35 || 10);
            const lastKnown = { x: px, z: pz, type: "watched", heardOnly: false };
            n.memory = n.memory || { type: "crime", amount, t: 16, kind: "watched", lastKnown };
            if (cigs > 0 && (p.greed || 0.5) > 0.38) {
              startApproach(n, "snitchThreat", Math.min(cigs, Math.max(3, Math.ceil(amount / 8) + Math.floor((p.greed || 0.5) * 5))), { heat: amount, memoryType: n.memory.type });
            } else {
              sendNpcToSnitch(n, amount, { lastKnown, type: "watched", heardOnly: false });
            }
            return n.baseSpeed * 1.45;
          }
          if (kind === "pocket") {
            const profile = stashPressure();
            const cost = Math.min(cigs, Math.max(3, Math.ceil(profile.score / 9) + Math.floor((p.greed || 0.5) * 4)));
            startApproach(n, (n.role === "thief" || rivalGang || (n.gang >= 0 && !sameGang && !protectedHere)) ? "stickUp" : "stashCover", cost, { rivalGang, stashItems: profile.stash, watched: true });
            return n.baseSpeed * 1.2;
          }
          if (kind === "debt" && n.gang >= 0) {
            const debt = gangDebt(n.gang);
            startApproach(n, debt > 4 ? "debtCollect" : "tax", Math.min(cigs, Math.max(2, Math.ceil(debt * 0.55) + Math.floor((p.greed || 0.5) * 4))), { debt: true, watched: true });
            return n.baseSpeed * 1.2;
          }
          if (kind === "copTip") {
            const suspect = findCopTipSuspect(n);
            if (suspect) startApproach(n, "copTip", 0, { suspect, watched: true, msg: `${n.data.name.replace(/^the |^a |^an /, "")} has been watching the block and points you toward trouble.` });
            return n.baseSpeed * 1.0;
          }
          if (kind === "copBribe") {
            startApproach(n, "copBribe", 0, { price: Math.max(2, 3 + Math.floor((p.greed || 0.5) * 7)), watched: true });
            return n.baseSpeed * 1.0;
          }
          if (kind === "copWatch" && (p.nerve || 0.5) > 0.62) {
            startApproach(n, "copTaunt", 0, { watched: true });
            return n.baseSpeed * 1.0;
          }
        }

        if (kind === "cover") {
          const threat = (CBZ.npcs || []).find((m) => alive(m) && m !== n && playerDist(m) < 12 && (m.aiState === "snitch" || m.huntPlayer > 0) && m.gang !== n.gang);
          if (threat) {
            n.aiState = "shadowPlayer";
            n.shadowT = Math.max(n.shadowT || 0, 7 + rng() * 5);
            emote(n, "+");
            return n.baseSpeed * 1.35;
          }
        }

        const radius = kind === "cover" ? 3.5 : (kind === "fear" ? 8.4 : (kind === "snitch" ? 7.3 : (kind === "pocket" ? 5.8 : 6.5)));
        const base = d > 0.01 ? Math.atan2(n.group.position.z - pz, n.group.position.x - px) : rng() * Math.PI * 2;
        const angle = base + (n.tailSide || 1) * (kind === "cover" ? 0.48 : 0.78);
        const desired = d < radius - 0.8 ? radius + 1.2 : radius;
        const pos = clampWorld(px + Math.cos(angle) * desired, pz + Math.sin(angle) * desired);
        n.target.set(pos.x, 0, pos.z);
        n.group.rotation.y = CBZ.lerpAngle(n.group.rotation.y, Math.atan2(dxp, dzp), 1 - Math.pow(0.00008, dt));
        if (rng() < (kind === "fear" ? 0.012 : 0.006)) emote(n, kind === "cover" ? "+" : (kind === "pocket" || kind === "debt" ? "$" : "?"));
        return n.baseSpeed * (kind === "cover" ? 1.18 : 0.95);
      }
      case "interceptThreat": {
        n.interceptT -= dt;
        const target = n.interceptTarget;
        const mode = n.interceptMode || "pressure";
        const targetActive = alive(target) && (mode !== "snitch" || target.aiState === "snitch") && (mode !== "rival" || target.huntPlayer > 0 || target.aiState === "fight");
        if (!targetActive || n.interceptT <= 0 || CBZ.game.state !== "playing") {
          n.interceptTarget = null; n.interceptMode = null; n.interceptT = 0;
          n.aiState = "wander"; n.aiTimer = 0.2 + rng() * 0.5;
          break;
        }
        n.target.set(target.group.position.x, 0, target.group.position.z);
        if (dist(n, target) < 2.2) {
          const p = n.personality || {};
          if (mode === "snitch") {
            target.memory = null;
            target.snitchHeat = 0; target.snitchT = 0; target.snitchMeta = null;
            if ((p.nerve || 0.5) + (p.loyalty || 0.5) * 0.35 > ((target.personality && target.personality.nerve) || 0.45) + 0.12 || rng() < 0.45) {
              target.aiState = "flee"; target.fleeT = 2.4 + rng() * 2.2; target.foe = null;
              emote(n, "🤐"); emote(target, "!");
              addBuzz("snitch", -9, "crew-block");
              addGangStanding(n.gang, n.gang >= 0 ? 1 : 0);
              n.aiState = "shadowPlayer"; n.shadowT = Math.max(n.shadowT || 0, 5 + rng() * 4);
              n.interceptTarget = null; n.interceptMode = null; n.interceptT = 0;
              if (CBZ.flashHint && playerDist(n) < 17) CBZ.flashHint(`${n.data.name.replace(/^the |^a |^an /, "")} shuts down the snitch run.`, 1.5);
            } else {
              startFight(n, target);
            }
          } else {
            startFight(n, target);
            addGangStanding(n.gang, n.gang >= 0 ? 1 : 0);
          }
        }
        return n.baseSpeed * 1.65;
      }
      case "rumorHuddle": {
        const p = n.huddlePartner;
        n.huddleT -= dt;
        if (!alive(p) || n.huddleT <= 0 || CBZ.game.state !== "playing") {
          const shouldAct = !!n.huddleLead && alive(n) && CBZ.game.state === "playing";
          if (p && p.huddlePartner === n) clearRumorHuddle(p);
          if (shouldAct && resolveRumorHuddle(n)) return n.baseSpeed;
          clearRumorHuddle(n);
          n.aiState = "wander";
          n.aiTimer = 0.15 + rng() * 0.5;
          break;
        }
        const dx = p.group.position.x - n.group.position.x;
        const dz = p.group.position.z - n.group.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 2.15) {
          n.target.set(p.group.position.x, 0, p.group.position.z);
          return n.baseSpeed * 0.85;
        }
        n.target.set(n.group.position.x, 0, n.group.position.z);
        n.group.rotation.y = CBZ.lerpAngle(n.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.00008, dt));
        if (rng() < 0.018) emote(n, n.huddleKind === "wealth" || n.huddleKind === "debt" || n.huddleKind === "badge" ? "$" : "?");
        return 0;
      }
      case "snitch": {
        n.snitchT -= dt;
        const g = nearestGuard(n);
        if (g) n.target.set(g.group.position.x, 0, g.group.position.z);
        if (!g || dist(n, g) < 2.5 || n.snitchT <= 0) {
          const amount = n.snitchHeat || 12;
          const reportMeta = n.snitchMeta || { copCrime: n.snitchCop };
          let lead = null;
          if (CBZ.recordWitnessReport) {
            lead = CBZ.recordWitnessReport(amount, reportMeta, n, g);
            markPlayerReported(n, amount, reportMeta, g, lead);
            if (Math.hypot(CBZ.player.pos.x - n.group.position.x, CBZ.player.pos.z - n.group.position.z) < 22)
              CBZ.flashHint(n.snitchCop ? `${n.data.name.replace(/^the |^a |^an /, "")} filed a complaint.` : `${n.data.name.replace(/^the |^a |^an /, "")} gave a guard your last location.`, 1.7);
          } else if (n.snitchCop) {
            CBZ.addComplaint && CBZ.addComplaint(amount * 0.55);
            markPlayerReported(n, amount, reportMeta, g, null);
            if (Math.hypot(CBZ.player.pos.x - n.group.position.x, CBZ.player.pos.z - n.group.position.z) < 22)
              CBZ.flashHint(`${n.data.name.replace(/^the |^a |^an /, "")} filed a complaint.`, 1.7);
          } else {
            CBZ.addHeat && CBZ.addHeat(amount * 0.78);
            CBZ.game.witnessReportT = Math.max(CBZ.game.witnessReportT || 0, 12);
            CBZ.game.snitchReports = (CBZ.game.snitchReports || 0) + 1;
            markPlayerReported(n, amount, reportMeta, g, null);
            if (g) { g.alert = 1.4; g.hunt = 2.2; }
            if (Math.hypot(CBZ.player.pos.x - n.group.position.x, CBZ.player.pos.z - n.group.position.z) < 22)
              CBZ.flashHint(`${n.data.name.replace(/^the |^a |^an /, "")} gave a guard your description.`, 1.7);
          }
          n.aiState = "flee"; n.fleeT = 2.0 + rng() * 2; n.snitchHeat = 0; n.snitchCop = false; n.snitchMeta = null;
        }
        return n.baseSpeed * 1.85;
      }
      case "shadowPlayer": {
        n.shadowT -= dt;
        if (n.shadowT <= 0) { n.aiState = "wander"; n.aiTimer = 0.2; break; }

        for (const other of nearbyNpcs(n, 9, _shadowNear)) {
          if (other === n || !alive(other)) continue;
          if (other.aiState === "snitch" && dist(n, other) < 9 && other.gang !== n.gang) {
            other.aiState = "flee"; other.fleeT = 2.8; other.snitchT = 0; other.snitchHeat = 0;
            other.snitchMeta = null;
            emote(n, "🤐"); emote(other, "!");
            addGangStanding(n.gang, n.gang >= 0 ? 1 : 0);
            if (CBZ.flashHint && playerDist(n) < 16) CBZ.flashHint(`${n.data.name.replace(/^the |^a |^an /, "")} scares off a snitch.`, 1.5);
            break;
          }
          if (other.huntPlayer > 0 && dist(n, other) < 8 && other.gang !== n.gang) {
            startFight(n, other);
            break;
          }
        }
        const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
        const side = (n.personality && n.personality.loyalty > 0.5) ? -1 : 1;
        n.target.set(px + side * 2.2, 0, pz + 1.7);
        return n.baseSpeed * 1.25;
      }
      case "diversion": {
        n.diversionT -= dt;
        const gd = nearestGuard(n);
        if (!gd || n.diversionT <= 0) {
          n.aiState = "flee"; n.fleeT = 2.0 + rng() * 1.5; n.aiTimer = 0;
          break;
        }
        n.target.set(gd.group.position.x, 0, gd.group.position.z);
        const d = dist(n, gd);
        if (d < 3.1) {
          const dx = n.group.position.x - gd.group.position.x;
          const dz = n.group.position.z - gd.group.position.z;
          gd.group.rotation.y = CBZ.lerpAngle(gd.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.0001, dt));
          gd.alert = Math.max(gd.alert || 0, 0.7);
          gd.hunt = Math.max(0, (gd.hunt || 0) - dt * 2.2);
          if (rng() < 0.035) emote(n, "!");
        }
        return n.baseSpeed * 1.55;
      }
      case "socialize": {
        const p = n.social;
        if (!alive(p) || dist(n, p) > 12) { n.aiState = "wander"; n.aiTimer = 0; break; }
        if (dist(n, p) < 2.2) {
          n.target.set(n.group.position.x, 0, n.group.position.z); // stop and chat
          if (n.aiTimer <= 0) {
            n.aiTimer = 1.4 + rng() * 2;
            emote(n, rng() < 0.4 ? "💬" : rng() < 0.5 ? "😂" : "♥");
            gossip(n, p);
            if (n.aiState === "snitch") return n.baseSpeed * 1.85;
            // a neutral drifter sometimes gets recruited
            if (n.gang < 0 && p.gang >= 0 && rng() < 0.3) { n.gang = p.gang; addBand(n, n.gang); emote(n, "✊"); }
            if (rng() < 0.45) { n.aiState = "wander"; n.social = null; }
          }
        } else n.target.set(p.group.position.x, 0, p.group.position.z);
        return n.baseSpeed * 0.9;
      }
      case "fight": {
        const f = n.foe;
        if (!alive(f) || dist(n, f) > 14) { n.aiState = "wander"; n.foe = null; n.aiTimer = 0; break; }
        n.target.set(f.group.position.x, 0, f.group.position.z);
        n.hitCD -= dt;
        if (dist(n, f) < 1.8) { if (n.hitCD <= 0) { n.hitCD = 0.7; exchangeBlows(n, f); } }
        // break off when badly hurt — how readily depends on temperament
        if (n.hp < (n.maxHp || 100) * 0.3 && rng() < behaviorOf(n).fleeHurt * 0.06) {
          n.aiState = "flee"; n.fleeT = 2.5; n.foe = null; emote(n, "💨");
        }
        return n.baseSpeed * 1.45;
      }
      case "flee": {
        n.fleeT -= dt;
        // sprint to a random far corner of the (now much bigger) compound
        if (n.aiTimer <= 0) { n.aiTimer = 0.6; n.target.set((rng() - 0.5) * 84, 0, 6 + rng() * 110); }
        if (n.fleeT <= 0) n.aiState = "wander";
        return n.baseSpeed * 1.7;
      }
      case "escape": {
        const ez = (CBZ.WORLD && CBZ.WORLD.exit.z) || 52;
        n.target.set((rng() - 0.5) * 6, 0, ez + 2);
        if (n.group.position.z > ez - 2) {
          n.escaped = true; n.group.visible = false;
          if (CBZ.player && Math.hypot(CBZ.player.pos.x - n.group.position.x, CBZ.player.pos.z - n.group.position.z) < 26)
            CBZ.flashHint(`🏃 ${n.data.name.replace(/^the |^a |^an /, "")} broke out!`, 2.4);
        }
        return n.baseSpeed * 1.6;
      }
      default: { // wander
        if (n.aiTimer <= 0) {
          n.aiTimer = 1.5 + rng() * 3;
          // re-evaluate: pick a fight, make a run for it, or just roam.
          // WHETHER they start a fight is governed by temperament (init),
          // tempered by how the matchup looks (capability vs the target).
          const b = behaviorOf(n);
          const foe = findBrawlTarget(n);
          if (foe) {
            let p = b.init * (0.55 + ((n.ratings && n.ratings.fighting) || 50) / 100);
            const odds = fightOdds(n, foe);
            if (b.picksWeak > 0) p *= 0.25 + b.picksWeak * odds * 1.7;  // bullies want the edge
            else p *= 0.7 + odds * 0.5;                                 // others mildly prefer winnable fights
            if (rng() < Math.min(0.6, p)) { startFight(n, foe); break; }
          }
          const pal = findPal(n);
          if (pal && rng() < 0.45) { n.aiState = "socialize"; n.social = pal; break; }
          if (rng() < 0.015) { n.aiState = "escape"; break; }
          if (n.gang >= 0 && (rng() < 0.52 || !isOnTurf(n.gang, n.group.position))) pickTurfTarget(n);
          else CBZ.npcPickTarget(n);
        }
        return n.baseSpeed;
      }
    }
    return n.baseSpeed;
  }

  // called by systems/state.js on restart: revive everyone, re-elect leaders
  function aiReset() {
    for (const n of CBZ.npcs) {
      n.dead = false; n.escaped = false; n.group.visible = true; n.group.rotation.z = 0;
      n.group.position.y = 0; n._lvy = 0;
      n.snitchHeat = 0; n.snitchCop = false; n.snitchT = 0; n.snitchMeta = null;
      clearKnownReport(n);
      n.memory = null;
      n.copMarked = 0;
      n.isLeader = false; initActor(n);
    }
    for (const g of CBZ.guards) { g.hp = null; g.dead = false; }
    for (const gang of [0, 1]) {
      const m = CBZ.npcs.find((n) => n.gang === gang && crewRole(n) === "shotcaller") || CBZ.npcs.find((n) => n.gang === gang);
      if (m) { m.isLeader = true; leaders[gang] = m; }
    }
  }

  // make the victim's whole gang (and the victim) come after the player
  function provokeGang(victim, dur) {
    dur = dur || 12;
    if (victim.gang >= 0) dur += Math.min(7, gangDebt(victim.gang) * 0.25);
    if (victim.huntPlayer != null || victim.gang != null) victim.huntPlayer = dur;
    if (victim.gang >= 0) {
      addGangStanding(victim.gang, -10);
      noteGangIncident(victim, "attack", Math.max(4, dur * 0.42), { skipStanding: true, source: "fight" });
      for (const n of CBZ.npcs)
        if (n.gang === victim.gang && !n.dead && !(n.ko > 0)) n.huntPlayer = dur;
    }
  }

  function sendNpcToSnitch(n, amount, meta) {
    if (!alive(n) || n.role === "merchant" || n.role === "dealer") return false;
    if (tryGangInterceptSnitch(n, amount, meta || {})) return true;
    meta = meta || {};
    n.aiState = "snitch";
    n.approach = null;
    n.snitchHeat = amount || 12;
    n.snitchCop = !!meta.copCrime;
    n.snitchMeta = Object.assign({}, meta, {
      lastKnown: meta.lastKnown || (n.memory && n.memory.lastKnown) || { x: CBZ.player.pos.x, z: CBZ.player.pos.z, type: meta.type || "crime", heardOnly: !!meta.heardOnly },
    });
    n.snitchT = 5.5;
    n.foe = null;
    emote(n, "!");
    const g = nearestGuard(n);
    if (g) n.target.set(g.group.position.x, 0, g.group.position.z);
    return true;
  }

  function resolveNpcApproach(n, action) {
    const a = n && n.approach;
    if (!a) return { ok: false, msg: "They've got nothing else to say." };
    const who = n.data.name.replace(/^the |^a |^an /, "");
    if (action !== "listen" || !a.greeted) rememberPlayerResponse(n, action, a);
    if (action === "listen") a.greeted = true;

    if (action === "listen") {
      if (a.kind === "tax") return { ok: true, msg: `${who}: ${a.cost} cigs keeps ${GANG_NAMES[n.gang]} off your back.` };
      if (a.kind === "debtCollect") return { ok: true, msg: `${who}: your tab with ${GANG_NAMES[n.gang]} is ${gangDebt(n.gang)} cigs. Pay or they keep leaning on you.` };
      if (a.kind === "snitchThreat") return { ok: true, msg: `${who}: pay ${a.cost} cigs or I tell a guard.` };
      if (a.kind === "turfWarning") return { ok: true, msg: `${who}: this is ${GANG_NAMES[n.gang]} turf. Respect it or pay.` };
      if (a.kind === "gangInvite") return { ok: true, msg: `${who}: roll with ${GANG_NAMES[n.gang]} and rivals think twice.` };
      if (a.kind === "favor") return { ok: true, msg: `${who}: take ${a.gift || 3} cigs. Good standing means something.` };
      if (a.kind === "deal") {
        if (!n.data.offer) return { ok: true, msg: "No stock right now." };
        const priced = CBZ.econ && CBZ.econ.offerPrice ? CBZ.econ.offerPrice(n) : { price: n.data.offer.price || 0, reasons: [] };
        const why = priced.reasons && priced.reasons.length ? ` (${priced.reasons.slice(0, 2).join(", ")})` : "";
        return { ok: true, msg: `${who}: ${n.data.offer.item} for ${priced.price} cigs${why}.` };
      }
      if (a.kind === "lookout") return { ok: true, msg: `${who}: I shadow you, point out snitches, and step in if rivals close.` };
      if (a.kind === "crewBackup") return { ok: true, msg: `${who}: I stay close, scare off talkers, and jump rivals. Crew handles crew business.` };
      if (a.kind === "crewDues") return { ok: true, msg: `${who}: pay dues and ${GANG_NAMES[n.gang]} keep thieves, snitches, and rivals off you. Skip it and it turns into debt.` };
      if (a.kind === "stickUp") return { ok: true, msg: `${who}: ${a.cost} cigs and nobody checks those loud pockets. Refuse and I take my chances.` };
      if (a.kind === "diversion") return { ok: true, msg: `${who}: I make noise near a guard. You move while they look away.` };
      if (a.kind === "buyItem") return { ok: true, msg: `${who}: ${a.price} cigs for your ${a.item}. Clean trade, no questions.` };
      if (a.kind === "gangJob") return { ok: true, msg: `${who}: ${jobObjective(a.job)} Pay is ${a.job ? a.job.reward : 5} cigs, plus respect.` };
      if (a.kind === "gangParley") {
        if (a.parleyMode === "recruit") return { ok: true, msg: `${who}: join ${GANG_NAMES[n.gang]} and your problems become crew business.` };
        if (a.parleyMode === "work") return { ok: true, msg: `${who}: ${GANG_NAMES[n.gang]} can put you to work, cover heat, or call in favors if you respect the chain.` };
        if (a.parleyMode === "truce") return { ok: true, msg: `${who}: ${a.cost || 0} cigs settles the disrespect. Current tab ${gangDebt(n.gang)}.` };
        return { ok: true, msg: `${who}: ${GANG_NAMES[n.gang]} are watching your next move. Respect buys room; threats buy trouble.` };
      }
      if (a.kind === "stashCover") return { ok: true, msg: `${who}: rich pockets make noise. Pay ${a.cost} and I tell thieves, buyers, and talkers you're dry for a while.` };
      if (a.kind === "racketCover") return { ok: true, msg: `${who}: bent cops keep a ledger. Pay ${a.cost} and I muddy the tab before clean guards hear it.` };
      if (a.kind === "coverDebt") return { ok: true, msg: `${who}: I just lied to ${a.guard || "a guard"}. Pay ${a.cost} cigs and I keep the story clean.` };
      if (a.kind === "jobThreat") return { ok: true, msg: `${who}: pay ${a.cost} cigs or ${GANG_NAMES[n.gang]} keep interrupting that job.` };
      if (a.kind === "heatWarning") return { ok: true, msg: `${who}: guards are working off ${a.source || "bad chatter"}. Duck low, change direction, and don't let talkers see you.` };
      if (a.kind === "alibiDeal") return { ok: true, msg: `${who}: pay ${a.cost} and I say you were with me when ${a.source || "the report"} happened.` };
      if (a.kind === "coverStory") return { ok: true, msg: `${who}: I can tell guards you went the other way. ${GANG_NAMES[n.gang]} remember favors.` };
      if (a.kind === "infoSell") return { ok: true, msg: `${who}: guards are working off ${a.source || "bad chatter"}. Pay me and I feed them a worse lead.` };
      if (a.kind === "witnessFix") return { ok: true, msg: `${who}: ${a.cost} cigs and ${a.targetName || "the witness"} forgets what they told guards. Cleaner than chasing them yourself.` };
      if (a.kind === "recantOffer") return { ok: true, msg: `${who}: I already gave guards a story. Pay ${a.cost} and I say I got the details wrong.` };
      if (a.kind === "reputation") {
        const buzz = topBuzz();
        n.playerTrust = Math.min(14, (n.playerTrust || 0) + (a.repKind === "fear" ? 0 : 1));
        if (a.repKind === "fear") {
          n.playerFear = Math.min(14, (n.playerFear || 0) + 1);
          clearApproach(n);
          return { ok: true, msg: `${who}: people saw what you did. Quiet ones back off, proud ones come with friends.` };
        }
        if (a.repKind === "wealth") {
          clearApproach(n);
          return { ok: true, msg: `${who}: keep flashing cigs and everybody prices you higher. Spend, hide, or pay cover.` };
        }
        if (a.repKind === "badge") {
          clearApproach(n);
          return { ok: true, msg: `${who}: bent cops covering you makes rivals talk faster. The tab is not friendship.` };
        }
        if (a.repKind === "snitch") {
          clearApproach(n);
          return { ok: true, msg: `${who}: witnesses are naming names. Find the talker before the trail hardens.` };
        }
        if (a.repKind === "debt") {
          clearApproach(n);
          return { ok: true, msg: `${who}: debt is a dinner bell. Gang collectors hear it first.` };
        }
        clearApproach(n);
        return { ok: true, msg: `${who}: the block buzz is ${buzz.kind}. People act on it.` };
      }
      if (a.kind === "rumor") {
        const msg = rumorLine(n);
        n.playerTrust = Math.min(14, (n.playerTrust || 0) + 1);
        addGangStanding(n.gang, n.gang >= 0 ? 1 : 0);
        clearApproach(n);
        return { ok: true, msg };
      }
      if (a.kind === "copBribe") return { ok: true, msg: `${who}: take ${a.price || 3} cigs and you never searched me.` };
      if (a.kind === "copTip") return { ok: true, msg: `${who}: I can point you at real trouble. You check them, I stay out of it.` };
      if (a.kind === "copPlea") return { ok: true, msg: `${who}: ${GANG_NAMES[a.gang != null ? a.gang : n.gang]} keep leaning on me. Do something.` };
      if (a.kind === "copTaunt") return { ok: true, msg: `${who}: badge looks heavy. You actually going to use it?` };
      clearApproach(n);
      addGangStanding(n.gang, n.gang >= 0 ? 2 : 0);
      return { ok: true, msg: n.gang >= 0 ? `${n.data.tip || n.data.talk[(rng() * n.data.talk.length) | 0] || "Keep your eyes open."} ${GANG_NAMES[n.gang]} respect +2.` : (n.data.tip || n.data.talk[(rng() * n.data.talk.length) | 0] || "Keep your eyes open.") };
    }

    if (action === "accept") {
      if (a.kind === "gangInvite") {
        clearApproach(n);
        const res = joinGang(n);
        addGangStanding(n.gang, 18);
        return res;
      }
      if (a.kind === "gangParley") {
        const mode = a.parleyMode || (gangParleyFor(n).mode);
        if (mode === "recruit") {
          clearApproach(n);
          const res = joinGang(n);
          addGangStanding(n.gang, 15);
          addGangProtection(n.gang, 28);
          return { ok: res.ok, msg: `${res.msg} ${GANG_NAMES[n.gang]} put eyes on you for a while.` };
        }
        if (mode === "work") {
          if (!CBZ.game.gangJob) {
            const job = a.job || makeGangJob(n);
            clearApproach(n);
            return startGangJob(job, n);
          }
          addGangStanding(n.gang, 4);
          addGangProtection(n.gang, 18);
          n.playerTrust = Math.min(14, (n.playerTrust || 0) + 2);
          clearApproach(n);
          return { ok: true, msg: `${who} marks you as useful. ${GANG_NAMES[n.gang]} cover you while the current job stays active.` };
        }
        if (mode === "truce" && a.cost > 0) return { ok: false, msg: `${who} wants payment, not a handshake.` };
        addGangStanding(n.gang, mode === "truce" ? 7 : 3);
        addGangDebt(n.gang, mode === "truce" ? -4 : -1);
        if (CBZ.player.gang === n.gang || mode === "truce") addGangProtection(n.gang, 14);
        clearApproach(n);
        return { ok: true, msg: `${who} accepts the respect. ${GANG_NAMES[n.gang]} standing ${gangStanding(n.gang)}.` };
      }
      if (a.kind === "favor") {
        const gift = a.gift || 3;
        clearApproach(n);
        CBZ.econ.addCigs(gift);
        addGangStanding(n.gang, -1);
        return { ok: true, msg: `${who} slips you ${gift} cigs. Respect ${gangStanding(n.gang)}.` };
      }
      if (a.kind === "buyItem") {
        if (!CBZ.econ.hasItem(a.item)) {
          clearApproach(n);
          return { ok: false, msg: `You don't have ${a.item} anymore.` };
        }
        CBZ.econ.takeItem(a.item);
        CBZ.econ.addCigs(a.price || Math.max(2, Math.floor(itemValue(a.item) * 0.7)));
        n.playerTrust = Math.min(12, (n.playerTrust || 0) + 2);
        n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 1);
        n.rep = Math.min(80, (n.rep || 0) + 3);
        if (n.gang >= 0) addGangStanding(n.gang, 2);
        if (n.data && n.data.pool) n.data.offer = CBZ.econ.pickOffer(n.data.pool);
        clearApproach(n);
        CBZ.sfx && CBZ.sfx("coin");
        return { ok: true, msg: `Sold ${a.item} to ${who} for ${a.price} cigs.` };
      }
      if (a.kind === "gangJob") {
        if (CBZ.game.gangJob) return { ok: false, msg: "Finish the job you already took." };
        const job = a.job || makeGangJob(n);
        clearApproach(n);
        return startGangJob(job, n);
      }
      if (a.kind === "heatWarning") {
        const lead = misdirectSearch(n, 4 + Math.floor(Math.max(0, n.playerTrust || 0) / 3));
        coolWanted(5 + Math.min(8, (n.playerTrust || 0) + (n.playerFear || 0) * 0.5));
        CBZ.game.lowProfileT = Math.max(CBZ.game.lowProfileT || 0, 12 + Math.floor(Math.max(0, n.playerTrust || 0)));
        n.playerTrust = Math.min(14, (n.playerTrust || 0) + 2);
        if (n.gang >= 0) addGangStanding(n.gang, 1);
        addBuzz("heat", -6, "heads-up");
        clearApproach(n);
        return { ok: true, msg: `${who} points you away from the sweep. Search shifts ${Math.round(Math.hypot(lead.x - CBZ.player.pos.x, lead.z - CBZ.player.pos.z))}m off you.` };
      }
      if (a.kind === "crewBackup") {
        const standing = n.gang >= 0 ? Math.max(0, gangStanding(n.gang)) : 0;
        clearApproach(n);
        n.aiState = "shadowPlayer";
        n.shadowT = 34 + Math.min(18, standing * 0.25);
        n.foe = null;
        n.playerTrust = Math.min(14, (n.playerTrust || 0) + 3);
        n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 1);
        addGangStanding(n.gang, 3);
        addGangProtection(n.gang, 24 + Math.min(18, standing * 0.22));
        for (const m of CBZ.npcs) if (m.gang === n.gang) m.huntPlayer = 0;
        coolWanted(7 + Math.min(10, standing * 0.16));
        emote(n, "+");
        return { ok: true, msg: `${who} shadows you as crew backup. Snitches and rivals think twice.` };
      }
      if (a.kind === "coverStory") {
        const standing = n.gang >= 0 ? Math.max(0, gangStanding(n.gang)) : 0;
        const lead = misdirectSearch(n, 7 + Math.floor(standing / 12));
        coolWanted(9 + Math.min(12, standing * 0.18));
        n.playerTrust = Math.min(14, (n.playerTrust || 0) + 3);
        n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 1);
        addGangStanding(n.gang, 3);
        addGangProtection(n.gang, 10 + Math.min(18, standing * 0.25));
        clearApproach(n);
        return { ok: true, msg: `${who} gives guards a cover story ${Math.round(Math.hypot(lead.x - CBZ.player.pos.x, lead.z - CBZ.player.pos.z))}m away. ${GANG_NAMES[n.gang]} respect ${gangStanding(n.gang)}.` };
      }
      if (a.kind === "copBribe") {
        const price = a.price || 3;
        CBZ.econ.addCigs(price);
        n.bribed = Math.max(n.bribed || 0, 18);
        n.playerTrust = Math.min(14, (n.playerTrust || 0) + 3);
        n.playerFear = Math.max(0, (n.playerFear || 0) - 1);
        clearApproach(n);
        if (CBZ.reportCrime) CBZ.reportCrime(18 + price, { type: "bribe", actorRole: "cop", copCorruption: true });
        CBZ.sfx && CBZ.sfx("coin");
        return { ok: true, msg: `You pocket ${price} cigs. Complaints can spread if anyone noticed.` };
      }
      if (a.kind === "copTip") {
        const suspect = (a.suspect && alive(a.suspect)) ? a.suspect : findCopTipSuspect(n);
        clearApproach(n);
        if (suspect && markCopSuspect(n, suspect, 28)) {
          if (CBZ.addComplaint) CBZ.addComplaint(-5);
          const suspectName = suspect.data.name.replace(/^the |^a |^an /, "");
          return { ok: true, msg: `${who} points out ${suspectName}. Search them cleanly for less blowback.` };
        }
        return { ok: true, msg: `${who}'s tip is too stale to use.` };
      }
      if (a.kind === "copPlea") {
        const gang = a.gang != null ? a.gang : n.gang;
        n.playerTrust = Math.min(14, (n.playerTrust || 0) + 3);
        n.playerFear = Math.max(0, (n.playerFear || 0) - 1);
        const bully = findCopTipSuspect(n);
        clearApproach(n);
        if (bully && markCopSuspect(n, bully, 22)) {
          if (CBZ.addComplaint) CBZ.addComplaint(-7);
          return { ok: true, msg: `You take the complaint. ${GANG_NAMES[gang]} pressure is now on your radar.` };
        }
        if (CBZ.addComplaint) CBZ.addComplaint(-4);
        return { ok: true, msg: `${who} calms down. The block sees you handle it.` };
      }
      clearApproach(n);
      return { ok: true, msg: `${who} nods.` };
    }

    if (action === "completeDeal") {
      clearApproach(n);
      n.rep = Math.min(80, (n.rep || 0) + 4);
      return { ok: true, msg: `${who} files away the favor.` };
    }

    if (action === "respect") {
      if (a.kind === "turfWarning") {
        clearApproach(n);
        addGangStanding(n.gang, 4);
        return { ok: true, msg: `You give ${GANG_NAMES[n.gang]} space. Respect ${gangStanding(n.gang)}.` };
      }
      if (a.kind === "gangParley") {
        const mode = a.parleyMode || "warning";
        addGangStanding(n.gang, mode === "truce" ? 6 : 4);
        addGangDebt(n.gang, mode === "truce" ? -3 : -1);
        if (CBZ.player.gang === n.gang || mode === "truce") addGangProtection(n.gang, 12);
        n.playerTrust = Math.min(14, (n.playerTrust || 0) + 1);
        n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 1);
        clearApproach(n);
        return { ok: true, msg: `You show respect. ${GANG_NAMES[n.gang]} standing ${gangStanding(n.gang)}, debt ${gangDebt(n.gang)}.` };
      }
      clearApproach(n);
      return { ok: true, msg: `${who} lets it go.` };
    }

    if (action === "pay") {
      if (a.cost <= 0) return { ok: false, msg: "They don't want money for this." };
      if ((CBZ.game.cigs || 0) < a.cost) return { ok: false, msg: `Need ${a.cost} cigs.` };
      if (a.kind === "witnessFix" && !((a.reporter && alive(a.reporter) && a.reporter.reportedPlayerT > 0) || findKnownReporter(n))) {
        clearApproach(n);
        return { ok: false, msg: "That witness trail has already gone cold." };
      }
      CBZ.econ.addCigs(-a.cost);
      rippleApproach(n, "paid", a, { range: 11.5 });
      if (a.kind === "tax") {
        addGangStanding(n.gang, 10);
        addGangDebt(n.gang, -Math.max(a.cost * 2, 5));
        addGangProtection(n.gang, 35 + a.cost * 4);
        for (const m of CBZ.npcs) if (m.gang === n.gang) m.huntPlayer = 0;
        clearApproach(n);
        return { ok: true, msg: `${GANG_NAMES[n.gang]} cover you for a while. Standing ${gangStanding(n.gang)}.` };
      }
      if (a.kind === "debtCollect") {
        addGangDebt(n.gang, -Math.max(a.cost * 2, 4));
        addGangStanding(n.gang, 5);
        addGangProtection(n.gang, 16 + a.cost * 2);
        for (const m of CBZ.npcs) if (m.gang === n.gang) m.huntPlayer = 0;
        n.playerTrust = Math.min(12, (n.playerTrust || 0) + 1);
        clearApproach(n);
        return { ok: true, msg: `${GANG_NAMES[n.gang]} mark the debt down to ${gangDebt(n.gang)}.` };
      }
      if (a.kind === "gangParley") {
        const mode = a.parleyMode || "truce";
        addGangDebt(n.gang, -Math.max(a.cost * 2, 6));
        addGangStanding(n.gang, mode === "truce" ? 12 : 6);
        addGangProtection(n.gang, 26 + a.cost * 3);
        for (const m of CBZ.npcs) if (m.gang === n.gang) m.huntPlayer = 0;
        n.playerTrust = Math.min(14, (n.playerTrust || 0) + 2);
        n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 2);
        coolWanted(4 + a.cost);
        addBuzz("debt", -Math.max(4, a.cost), "parley-pay");
        clearApproach(n);
        CBZ.sfx && CBZ.sfx("coin");
        return { ok: true, msg: `${who} takes the truce money. ${GANG_NAMES[n.gang]} debt ${gangDebt(n.gang)}, standing ${gangStanding(n.gang)}.` };
      }
      if (a.kind === "snitchThreat") {
        n.snitchHeat = 0; n.snitchT = 0;
        n.memory = null;
        n.playerTrust = Math.min(12, (n.playerTrust || 0) + 2);
        n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 2);
        addGangStanding(n.gang, n.gang >= 0 ? 3 : 0);
        clearApproach(n);
        return { ok: true, msg: `${who} keeps quiet. Money bought silence.` };
      }
      if (a.kind === "recantOffer") {
        const amount = n.reportedPlayerAmount || a.amount || 12;
        const challenged = CBZ.challengeCaseSource ? CBZ.challengeCaseSource(who, 8 + a.cost, { force: true, reason: "paid recant" }) : null;
        coolWanted(7 + a.cost + Math.min(8, amount * 0.24));
        if (CBZ.game.lastKnown && CBZ.game.lastKnown.source === who) CBZ.game.lastKnown = null;
        clearKnownReport(n);
        n.memory = null;
        n.playerTrust = Math.min(14, (n.playerTrust || 0) + 1);
        n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 2);
        if (n.gang >= 0) addGangStanding(n.gang, CBZ.player.gang === n.gang ? 2 : 1);
        addBuzz("snitch", -12, "paid-recant");
        clearApproach(n);
        CBZ.sfx && CBZ.sfx("coin");
        return { ok: true, msg: challenged && challenged.ok ? `${who} recants. The case loses a named source.` : `${who} walks the story back. Wanted pressure drops.` };
      }
      if (a.kind === "lookout") {
        addGangStanding(n.gang, n.gang >= 0 ? 5 : 0);
        addGangProtection(n.gang, n.gang >= 0 ? 26 : 0);
        n.playerTrust = Math.min(12, (n.playerTrust || 0) + 2);
        n.aiState = "shadowPlayer";
        n.shadowT = 22 + a.cost * 2;
        n.foe = null;
        clearApproach(n);
        coolWanted(8 + a.cost * 2);
        return { ok: true, msg: `${who} becomes your lookout. Wanted pressure drops.` };
      }
      if (a.kind === "crewDues") {
        const standing = n.gang >= 0 ? Math.max(0, gangStanding(n.gang)) : 0;
        const heat = (CBZ.game && CBZ.game.detection) || 0;
        addGangStanding(n.gang, 5);
        addGangDebt(n.gang, -Math.max(4, a.cost * 2));
        addGangProtection(n.gang, 34 + a.cost * 3 + Math.min(18, standing * 0.18));
        for (const m of CBZ.npcs) if (m.gang === n.gang) m.huntPlayer = 0;
        n.playerTrust = Math.min(14, (n.playerTrust || 0) + 2);
        n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 1);
        if (heat > 18 || (CBZ.game.witnessReportT || 0) > 0) {
          clearApproach(n);
          n.aiState = "shadowPlayer";
          n.shadowT = 16 + a.cost * 1.4;
          n.foe = null;
        } else clearApproach(n);
        coolWanted(5 + a.cost * 1.2);
        addBuzz("debt", -Math.max(4, a.cost), "crew-dues");
        CBZ.sfx && CBZ.sfx("coin");
        return { ok: true, msg: `${who} marks dues paid. ${GANG_NAMES[n.gang]} cover you for ${Math.ceil(gangProtection(n.gang))}s.` };
      }
      if (a.kind === "stickUp") {
        const racketGuard = a.racketGuard;
        n.bribed = Math.max(n.bribed || 0, 18 + a.cost * 1.2);
        n.playerTrust = Math.min(10, (n.playerTrust || 0) + 1);
        n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 1);
        if (n.gang >= 0) {
          addGangStanding(n.gang, a.rivalGang ? 3 : 1);
          addGangDebt(n.gang, -2);
          for (const m of CBZ.npcs) if (m.gang === n.gang) m.huntPlayer = 0;
        }
        if (racketGuard) {
          CBZ.game.racketDebt = Math.max(0, (CBZ.game.racketDebt || 0) - Math.max(4, Math.ceil(a.cost * 1.8)));
          CBZ.game.racketProtectionT = Math.max(CBZ.game.racketProtectionT || 0, 10 + a.cost * 1.1);
          addBuzz("badge", -6, "racket-runner-paid");
        }
        CBZ.game.lowProfileT = Math.max(CBZ.game.lowProfileT || 0, 8 + a.cost * 0.8);
        addBuzz("wealth", -6, "stick-up-paid");
        clearApproach(n);
        CBZ.sfx && CBZ.sfx("coin");
        return { ok: true, msg: racketGuard ? `${who} takes the racket cut. Bent debt ${Math.ceil(CBZ.game.racketDebt || 0)}.` : `${who} takes the cut and leaves your pockets alone for now.` };
      }
      if (a.kind === "diversion") {
        n.playerTrust = Math.min(12, (n.playerTrust || 0) + 1);
        n.aiState = "diversion";
        n.diversionT = 5.5 + a.cost * 0.4;
        n.foe = null;
        clearApproach(n);
        coolWanted(12 + a.cost * 2.5);
        return { ok: true, msg: `${who} starts a diversion. Guards lose focus.` };
      }
      if (a.kind === "stashCover") {
        CBZ.game.lowProfileT = Math.max(CBZ.game.lowProfileT || 0, 34 + a.cost * 3 + (a.stashItems || 0) * 5);
        addBuzz("wealth", -28, "stash-cover");
        addBuzz("heat", -8, "stash-cover");
        coolWanted(5 + a.cost * 0.8);
        n.playerTrust = Math.min(14, (n.playerTrust || 0) + 2);
        n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 1);
        if (n.gang >= 0) addGangStanding(n.gang, 1);
        clearApproach(n);
        return { ok: true, msg: `${who} spreads word that your pockets are dry. Wealth buzz drops for ${Math.ceil(CBZ.game.lowProfileT)}s.` };
      }
      if (a.kind === "racketCover") {
        const cut = Math.max(5, a.cost * 2 + Math.ceil((a.racketDebt || 0) * 0.35));
        CBZ.game.racketDebt = Math.max(0, (CBZ.game.racketDebt || 0) - cut);
        CBZ.game.racketProtectionT = Math.max(CBZ.game.racketProtectionT || 0, 18 + a.cost * 2);
        CBZ.game.racketGuard = a.source || CBZ.game.racketGuard || who;
        if (CBZ.addRacketStanding) CBZ.addRacketStanding(1);
        if (CBZ.reduceCasePressure) CBZ.reduceCasePressure(5 + a.cost * 0.65, a.source);
        coolWanted(3 + a.cost * 0.5);
        addBuzz("badge", -14, "racket-cover");
        n.playerTrust = Math.min(14, (n.playerTrust || 0) + 2);
        n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 1);
        if (n.gang >= 0) {
          addGangStanding(n.gang, CBZ.player.gang === n.gang ? 3 : 1);
          addGangProtection(n.gang, 8 + a.cost);
        }
        for (const gd of CBZ.guards || []) if (gd.corrupt) gd.bribed = Math.max(gd.bribed || 0, 7 + a.cost);
        clearApproach(n);
        CBZ.sfx && CBZ.sfx("coin");
        return { ok: true, msg: `${who} muddies the bent-cop ledger. Bent debt ${Math.ceil(CBZ.game.racketDebt || 0)}, cover ${Math.ceil(CBZ.game.racketProtectionT || 0)}s.` };
      }
      if (a.kind === "coverDebt") {
        n.coverDebt = null;
        n.playerTrust = Math.min(14, (n.playerTrust || 0) + 2);
        n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 1);
        n.questionedT = Math.max(n.questionedT || 0, 8);
        coolWanted(4 + a.cost * 1.1 + Math.min(6, (a.heat || 8) * 0.18));
        if (CBZ.challengeCaseSource) CBZ.challengeCaseSource(who, 4 + a.cost, { reason: "paid cover witness" });
        if (n.gang >= 0) {
          addGangStanding(n.gang, CBZ.player.gang === n.gang ? 2 : 1);
          if (CBZ.player.gang === n.gang || gangProtection(n.gang) > 0) addGangProtection(n.gang, 7 + a.cost);
        }
        addBuzz("heat", -8, "paid-cover-debt");
        clearApproach(n);
        CBZ.sfx && CBZ.sfx("coin");
        return { ok: true, msg: `${who} keeps the guard story straight. Wanted pressure cools.` };
      }
      if (a.kind === "alibiDeal") {
        const lead = misdirectSearch(n, 4 + Math.ceil(a.cost * 0.7));
        coolWanted(7 + a.cost + Math.min(9, (a.heat || 12) * 0.24));
        if (n.memory) n.memory = null;
        n.playerTrust = Math.min(14, (n.playerTrust || 0) + 2);
        n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 2);
        addBuzz("snitch", -8, "bought-alibi");
        addBuzz("heat", -7, "bought-alibi");
        if (CBZ.game.lastKnown && (!a.source || CBZ.game.lastKnown.source === a.source || CBZ.game.lastKnown.type !== "visual")) CBZ.game.lastKnown = null;
        CBZ.game.lowProfileT = Math.max(CBZ.game.lowProfileT || 0, 10 + a.cost * 1.5);
        clearApproach(n);
        return { ok: true, msg: `${who} gives guards an alibi and points them ${Math.round(Math.hypot(lead.x - CBZ.player.pos.x, lead.z - CBZ.player.pos.z))}m away.` };
      }
      if (a.kind === "jobThreat") {
        const job = a.job || CBZ.game.gangJob;
        n.playerTrust = Math.min(12, (n.playerTrust || 0) + 1);
        n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 1);
        addGangStanding(n.gang, 4);
        if (job && job.gang >= 0) {
          addGangStanding(job.gang, -3);
          job.t = Math.max(8, (job.t || 12) - 4);
          job.rivalPaidT = Math.max(job.rivalPaidT || 0, 12);
        }
        clearApproach(n);
        return { ok: true, msg: `${who} takes the payoff. Rival pressure cools, but your employer notices.` };
      }
      if (a.kind === "infoSell") {
        const lead = misdirectSearch(n, a.cost);
        coolWanted(6 + a.cost * 1.6);
        n.playerTrust = Math.min(12, (n.playerTrust || 0) + 2);
        n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 1);
        addGangStanding(n.gang, n.gang >= 0 ? 1 : 0);
        clearApproach(n);
        return { ok: true, msg: `${who} plants a false lead ${Math.round(Math.hypot(lead.x - CBZ.player.pos.x, lead.z - CBZ.player.pos.z))}m away. Wanted pressure drops.` };
      }
      if (a.kind === "witnessFix") {
        const reporter = (a.reporter && alive(a.reporter) && a.reporter.reportedPlayerT > 0) ? a.reporter : findKnownReporter(n);
        const rName = reporterName(reporter);
        const sameGang = CBZ.player.gang != null && n.gang === CBZ.player.gang;
        const reporterGang = reporter && reporter.gang != null ? reporter.gang : -1;
        if (reporter) {
          if (CBZ.challengeCaseSource) CBZ.challengeCaseSource(rName, 8 + a.cost, { force: true, reason: "witness fix" });
          clearKnownReport(reporter);
          reporter.memory = null;
          reporter.aiState = "flee";
          reporter.fleeT = 2.4 + rng() * 1.5;
          reporter.playerFear = Math.min(14, (reporter.playerFear || 0) + 2);
          reporter.playerGrudge = Math.min(14, (reporter.playerGrudge || 0) + 1);
          emote(reporter, "!");
          if (CBZ.game.lastKnown && CBZ.game.lastKnown.source === rName) CBZ.game.lastKnown = null;
          if (reporterGang >= 0 && reporterGang !== n.gang) addGangStanding(reporterGang, -2);
        }
        coolWanted(9 + a.cost * 1.4 + Math.min(7, (a.amount || 12) * 0.22));
        addBuzz("snitch", -14, "witness-fix");
        addBuzz("heat", -5, "witness-fix");
        n.playerTrust = Math.min(14, (n.playerTrust || 0) + 2);
        n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 1);
        if (n.gang >= 0) {
          addGangStanding(n.gang, sameGang ? 3 : 1);
          if (sameGang || gangProtection(n.gang) > 0) addGangProtection(n.gang, 10 + a.cost);
        }
        clearApproach(n);
        CBZ.sfx && CBZ.sfx("coin");
        return { ok: true, msg: `${who} leans on ${rName}. The report trail gets messy and wanted pressure drops.` };
      }
      clearApproach(n);
      return { ok: true, msg: `${who} pockets the cigs.` };
    }

    if (action === "warn") {
      if (a.kind === "copBribe") {
        clearApproach(n);
        n.playerFear = Math.min(14, (n.playerFear || 0) + 2);
        n.aiState = "flee"; n.fleeT = 2.0 + rng() * 1.2;
        if (CBZ.addComplaint) CBZ.addComplaint(-2);
        return { ok: true, msg: `${who} hides the stash and backs off.` };
      }
      if (a.kind === "copTaunt") {
        clearApproach(n);
        n.playerFear = Math.min(14, (n.playerFear || 0) + 3);
        n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 1);
        n.aiState = "flee"; n.fleeT = 2.4 + rng() * 1.2;
        if (CBZ.addComplaint) CBZ.addComplaint(-3);
        return { ok: true, msg: `${who} decides not to test you today.` };
      }
      if (a.kind === "copPlea") {
        clearApproach(n);
        n.playerTrust = Math.min(14, (n.playerTrust || 0) + 1);
        return { ok: true, msg: `${who} nods, but still wants action.` };
      }
      clearApproach(n);
      n.aiState = "flee"; n.fleeT = 1.8;
      return { ok: true, msg: `${who} backs away.` };
    }

    if (action === "detain") {
      const justified = a.kind === "copTaunt" || a.kind === "copBribe" || n.copMarked > 0 || n.huntPlayer > 0;
      clearApproach(n);
      n.ko = Math.max(n.ko || 0, justified ? 6.5 : 4.2);
      n.hp = Math.max(n.hp || 0, justified ? 48 : 58);
      n.aiState = "flee"; n.foe = null; n.copMarked = 0;
      n.playerFear = Math.min(14, (n.playerFear || 0) + 3);
      n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + (justified ? 1 : 3));
      CBZ.game.kos = (CBZ.game.kos || 0) + 1;
      if (CBZ.killstreakOnDown) CBZ.killstreakOnDown(n, "detain");
      if (CBZ.addComplaint) CBZ.addComplaint(justified ? -2 : 8);
      if (CBZ.knockback) CBZ.knockback(n, CBZ.player.pos.x, CBZ.player.pos.z, 0.9);
      CBZ.sfx && CBZ.sfx("punch");
      return { ok: justified, msg: justified ? `${who} is detained on a clean read.` : `${who} drops, but witnesses call it rough.` };
    }

    if (action === "haggle") {
      if (a.cost <= 1 || a.haggled) return { ok: false, msg: `${who} won't move on the price.` };
      const standing = n.gang >= 0 ? gangStanding(n.gang) : 0;
      const p = n.personality || {};
      const leverage = (n.playerTrust || 0) * 0.045 + Math.max(0, standing) * 0.004 + (CBZ.player.gang === n.gang ? 0.12 : 0);
      const pressure = (n.playerFear || 0) * 0.025;
      const chance = Math.max(0.12, Math.min(0.78, 0.28 + leverage + pressure - (p.greed || 0.5) * 0.22 - (a.kind === "snitchThreat" ? 0.06 : 0)));
      a.haggled = true;
      if (rng() < chance) {
        if (a.kind === "buyItem") {
          const bump = Math.max(1, Math.ceil(itemValue(a.item) * 0.15));
          a.price = Math.min(Math.ceil(itemValue(a.item) * 1.25), (a.price || 1) + bump);
          a.t = Math.max(a.t || 0, 7);
          n.playerTrust = Math.min(12, (n.playerTrust || 0) + 1);
          return { ok: true, msg: `${who} raises the offer to ${a.price} cigs.` };
        }
        const cut = Math.max(1, Math.min(a.cost - 1, 1 + Math.floor((n.playerTrust || 0) / 4) + Math.floor(rng() * 2)));
        a.cost -= cut;
        a.t = Math.max(a.t || 0, 7);
        n.playerTrust = Math.min(12, (n.playerTrust || 0) + 1);
        return { ok: true, msg: `${who} drops it to ${a.cost} cigs.` };
      }
      if (a.kind === "buyItem") a.price = Math.max(1, (a.price || 1) - 1);
      else a.cost += a.kind === "snitchThreat" || a.kind === "tax" ? 1 : 0;
      n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 1);
      return { ok: false, msg: a.kind === "buyItem" ? `${who} lowers the offer to ${a.price} cigs.` : `${who} doesn't like bargaining. Price ${a.cost} cigs.` };
    }

    if (action === "threaten") {
      const standing = n.gang >= 0 ? gangStanding(n.gang) : 0;
      const sameGang = CBZ.player.gang != null && n.gang === CBZ.player.gang;
      const protectedHere = n.gang >= 0 && gangProtection(n.gang) > 0;
      const p = n.personality || {};
      const armed = (CBZ.playerArmed && CBZ.playerArmed()) || (CBZ.econ && CBZ.econ.hasItem && CBZ.econ.hasItem("Shiv"));
      let chance = 0.30 + (armed ? 0.18 : 0) + (n.playerFear || 0) * 0.045 - (p.nerve || 0.5) * 0.24;
      chance += sameGang ? 0.10 : 0;
      chance += protectedHere ? 0.08 : 0;
      chance -= standing < -10 ? 0.12 : 0;
      chance = Math.max(0.08, Math.min(0.82, chance));
      if (rng() < chance) {
        rippleApproach(n, "threatWon", a, { range: 13 });
        n.playerFear = Math.min(14, (n.playerFear || 0) + 3);
        n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 2);
        if (a.kind === "snitchThreat") {
          n.memory = null; n.snitchHeat = 0; n.snitchT = 0;
          addGangStanding(n.gang, n.gang >= 0 ? -2 : 0);
          clearApproach(n);
          n.aiState = "flee"; n.fleeT = 2.2 + rng() * 1.5;
          return { ok: true, msg: `${who} backs down, scared quiet.` };
        }
        if (a.kind === "recantOffer") {
          const amount = n.reportedPlayerAmount || a.amount || 12;
          const challenged = CBZ.challengeCaseSource ? CBZ.challengeCaseSource(who, 5 + Math.min(8, amount * 0.24), { reason: "forced recant" }) : null;
          coolWanted(4 + Math.min(8, amount * 0.22));
          if (CBZ.game.lastKnown && CBZ.game.lastKnown.source === who) CBZ.game.lastKnown = null;
          clearKnownReport(n);
          n.playerFear = Math.min(14, (n.playerFear || 0) + 3);
          n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 3);
          if (n.gang >= 0) addGangStanding(n.gang, CBZ.player.gang === n.gang ? -1 : -4);
          addBuzz("snitch", -5, "forced-recant");
          clearApproach(n);
          n.aiState = "flee"; n.fleeT = 2.0 + rng() * 1.4;
          return { ok: true, msg: challenged && challenged.ok ? `${who}'s report collapses under pressure.` : `${who} backs off the story, but remembers the threat.` };
        }
        if (a.kind === "coverStory") {
          misdirectSearch(n, 3);
          clearApproach(n);
          n.aiState = "flee"; n.fleeT = 1.4 + rng();
          addGangStanding(n.gang, n.gang >= 0 ? -2 : 0);
          return { ok: true, msg: `${who} gives you a sloppy cover story, but resents the threat.` };
        }
        if (a.kind === "infoSell") {
          misdirectSearch(n, Math.max(1, Math.floor((a.cost || 2) * 0.55)));
          coolWanted(4);
          clearApproach(n);
          n.aiState = "flee"; n.fleeT = 1.6 + rng();
          return { ok: true, msg: `${who} coughs up enough intel to muddy the search.` };
        }
        if (a.kind === "witnessFix") {
          const reporter = (a.reporter && alive(a.reporter) && a.reporter.reportedPlayerT > 0) ? a.reporter : findKnownReporter(n);
          if (reporter) {
            if (CBZ.challengeCaseSource) CBZ.challengeCaseSource(reporterName(reporter), 4 + Math.ceil((a.cost || 2) * 0.6), { reason: "forced fixer" });
            reporter.reportedPlayerT = Math.min(reporter.reportedPlayerT || 0, 6);
            reporter.reportedPlayerCred = Math.max(0.12, (reporter.reportedPlayerCred || 0.65) - 0.14);
            reporter.reportedPlayerDoubt = Math.max(0, 1 - reporter.reportedPlayerCred);
            reporter.playerFear = Math.min(14, (reporter.playerFear || 0) + 1);
            reporter.aiState = "flee"; reporter.fleeT = 1.5 + rng();
            if (CBZ.game.lastKnown && CBZ.game.lastKnown.source === reporterName(reporter)) CBZ.game.lastKnown.t = Math.min(CBZ.game.lastKnown.t || 0, 4);
            emote(reporter, "!");
          }
          coolWanted(4);
          addBuzz("snitch", -4, "forced-fixer");
          addGangStanding(n.gang, n.gang >= 0 ? -3 : 0);
          clearApproach(n);
          n.aiState = "flee"; n.fleeT = 1.5 + rng();
          return { ok: true, msg: `${who} forces a shaky warning onto ${reporterName(reporter)}.` };
        }
        if (a.kind === "heatWarning") {
          misdirectSearch(n, 2);
          n.playerFear = Math.min(14, (n.playerFear || 0) + 1);
          n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
          clearApproach(n);
          n.aiState = "flee"; n.fleeT = 1.2 + rng();
          return { ok: true, msg: `${who} blurts the warning and backs away.` };
        }
        if (a.kind === "crewBackup") {
          addGangStanding(n.gang, -5);
          addGangDebt(n.gang, 2);
          clearApproach(n);
          n.aiState = "flee"; n.fleeT = 1.5 + rng();
          return { ok: true, msg: `${who} backs off, but ${GANG_NAMES[n.gang]} hear you pushed away backup.` };
        }
        if (a.kind === "crewDues") {
          addGangStanding(n.gang, -5);
          addGangDebt(n.gang, Math.max(2, Math.ceil((a.cost || 3) * 0.5)));
          clearApproach(n);
          n.aiState = "flee"; n.fleeT = 1.6 + rng();
          return { ok: true, msg: `${who} drops the dues demand, but ${GANG_NAMES[n.gang]} remember the threat.` };
        }
        if (a.kind === "stickUp") {
          const racketGuard = a.racketGuard;
          n.playerFear = Math.min(14, (n.playerFear || 0) + 2);
          n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 2);
          addGangStanding(n.gang, n.gang >= 0 ? -3 : 0);
          if (racketGuard) {
            CBZ.game.racketDebt = Math.min(50, (CBZ.game.racketDebt || 0) + Math.max(2, Math.ceil((a.cost || 3) * 0.5)));
            addBuzz("badge", 5, "threatened-racket-runner");
          }
          clearApproach(n);
          n.aiState = "flee"; n.fleeT = 1.5 + rng();
          return { ok: true, msg: racketGuard ? `${who} backs off, but ${racketGuard}'s tab gets uglier.` : `${who} backs off, but the block hears you flashed steel over money.` };
        }
        if (a.kind === "alibiDeal") {
          misdirectSearch(n, 2);
          if (n.memory && rng() < 0.45) n.memory = null;
          n.playerFear = Math.min(14, (n.playerFear || 0) + 2);
          n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 2);
          addBuzz("heat", -3, "forced-alibi");
          clearApproach(n);
          n.aiState = "flee"; n.fleeT = 1.7 + rng();
          return { ok: true, msg: `${who} gives you a shaky alibi and runs.` };
        }
        if (a.kind === "stashCover") {
          CBZ.game.lowProfileT = Math.max(CBZ.game.lowProfileT || 0, 12 + (a.cost || 3));
          addBuzz("wealth", -12, "threat-cover");
          addGangStanding(n.gang, n.gang >= 0 ? -2 : 0);
          clearApproach(n);
          n.aiState = "flee"; n.fleeT = 1.4 + rng();
          return { ok: true, msg: `${who} tells people you are dry, but remembers the threat.` };
        }
        if (a.kind === "racketCover") {
          CBZ.game.racketProtectionT = Math.max(CBZ.game.racketProtectionT || 0, 6 + (a.cost || 3));
          CBZ.game.racketDebt = Math.max(0, (CBZ.game.racketDebt || 0) - Math.max(2, Math.ceil((a.cost || 3) * 0.7)));
          addBuzz("badge", -5, "threat-racket-cover");
          addGangStanding(n.gang, n.gang >= 0 ? -2 : 0);
          clearApproach(n);
          n.aiState = "flee"; n.fleeT = 1.4 + rng();
          return { ok: true, msg: `${who} gives you a shaky racket cover story and backs off.` };
        }
        if (a.kind === "coverDebt") {
          n.coverDebt = null;
          misdirectSearch(n, 2);
          coolWanted(3 + Math.min(5, (a.heat || 8) * 0.16));
          addBuzz("heat", -3, "forced-cover-debt");
          addGangStanding(n.gang, n.gang >= 0 ? -2 : 0);
          clearApproach(n);
          n.aiState = "flee"; n.fleeT = 1.4 + rng();
          return { ok: true, msg: `${who} keeps the lie alive, but remembers the threat.` };
        }
        if (a.kind === "gangParley") {
          addGangStanding(n.gang, -6);
          addGangDebt(n.gang, a.parleyMode === "truce" ? 4 : 2);
          n.playerFear = Math.min(14, (n.playerFear || 0) + 2);
          n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 2);
          clearApproach(n);
          n.aiState = "flee"; n.fleeT = 1.8 + rng() * 1.5;
          return { ok: true, msg: `${who} backs off, but ${GANG_NAMES[n.gang]} log the disrespect.` };
        }
        if (a.kind === "tax" || a.kind === "turfWarning" || a.kind === "debtCollect") {
          addGangStanding(n.gang, -5);
          addGangDebt(n.gang, a.kind === "debtCollect" ? 4 : 2);
          clearApproach(n);
          n.aiState = "flee"; n.fleeT = 1.8 + rng() * 1.5;
          return { ok: true, msg: `${who} backs off, but ${GANG_NAMES[n.gang]} remember it.` };
        }
        if (a.kind === "jobThreat") {
          if (a.job) a.job.t = Math.max(6, (a.job.t || 12) - 3);
          addGangStanding(n.gang, -4);
          clearApproach(n);
          n.aiState = "flee"; n.fleeT = 1.8 + rng() * 1.4;
          return { ok: true, msg: `${who} backs down. The rival crew clocks the disrespect.` };
        }
        clearApproach(n);
        n.aiState = "flee"; n.fleeT = 1.5 + rng();
        return { ok: true, msg: `${who} decides this isn't worth it.` };
      }
      n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 3);
      rippleApproach(n, "threatFailed", a, { range: 13.5 });
      if (a.kind === "snitchThreat") {
        const heat = a.heat || Math.max(14, a.cost * 9);
        const lastKnown = n.memory && n.memory.lastKnown;
        clearApproach(n);
        n.memory = null;
        sendNpcToSnitch(n, heat + 8, { forceSnitch: true, lastKnown });
        return { ok: false, msg: `${who} calls your bluff and runs to snitch.` };
      }
      if (a.kind === "recantOffer") {
        const amount = n.reportedPlayerAmount || a.amount || 12;
        n.reportedPlayerT = Math.max(n.reportedPlayerT || 0, 24);
        n.reportedPlayerCred = Math.min(1, (n.reportedPlayerCred || a.credibility || 0.65) + 0.13);
        n.reportedPlayerDoubt = Math.max(0, 1 - n.reportedPlayerCred);
        if (CBZ.addCasePressure) CBZ.addCasePressure(amount * 0.28, { type: "threatened reporter", forceSnitch: true, lastKnown: n.reportedPlayerLastKnown, credibility: n.reportedPlayerCred }, n);
        if (n.gang >= 0) {
          addGangStanding(n.gang, -7);
          addGangDebt(n.gang, CBZ.player.gang != null && CBZ.player.gang !== n.gang ? 3 : 1);
        }
        CBZ.game.witnessReportT = Math.max(CBZ.game.witnessReportT || 0, 7);
        addBuzz("snitch", 8, "recant-threat-failed");
        clearApproach(n);
        return { ok: false, msg: `${who} refuses to recant and makes the threat part of the story.` };
      }
      if (a.kind === "tax" || a.kind === "turfWarning" || a.kind === "debtCollect") {
        const gang = n.gang;
        clearApproach(n);
        addGangDebt(gang, a.kind === "debtCollect" ? 5 : 3);
        addGangStanding(gang, -12);
        provokeGang(n, 9);
        return { ok: false, msg: `${GANG_NAMES[gang]} rush you for the disrespect.` };
      }
      if (a.kind === "gangParley") {
        const gang = n.gang;
        clearApproach(n);
        addGangDebt(gang, a.parleyMode === "truce" ? Math.max(5, a.cost || 4) : 3);
        addGangStanding(gang, -14);
        provokeGang(n, a.parleyMode === "warning" ? 7 : 10);
        return { ok: false, msg: `${GANG_NAMES[gang]} answer the threat together.` };
      }
      if (a.kind === "witnessFix") {
        const reporter = (a.reporter && alive(a.reporter)) ? a.reporter : findKnownReporter(n);
        clearApproach(n);
        n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 3);
        addGangStanding(n.gang, n.gang >= 0 ? -6 : 0);
        if (reporter) {
          reporter.reportedPlayerT = Math.max(reporter.reportedPlayerT || 0, 22);
          reporter.reportedPlayerCred = Math.min(1, (reporter.reportedPlayerCred || 0.65) + 0.10);
          reporter.reportedPlayerDoubt = Math.max(0, 1 - reporter.reportedPlayerCred);
          reporter.playerGrudge = Math.min(14, (reporter.playerGrudge || 0) + 2);
          if (CBZ.addCasePressure) CBZ.addCasePressure((reporter.reportedPlayerAmount || 12) * 0.22, { type: "fixer threat", credibility: reporter.reportedPlayerCred }, reporter);
          if (reporter.gang >= 0 && reporter.gang !== n.gang) addGangStanding(reporter.gang, -2);
          emote(reporter, "!");
        }
        CBZ.game.witnessReportT = Math.max(CBZ.game.witnessReportT || 0, 7);
        addBuzz("snitch", 7, "fixer-threat-failed");
        if (n.gang >= 0 && gangStanding(n.gang) < -16) provokeGang(n, 5);
        return { ok: false, msg: `${who} warns ${reporterName(reporter)} you tried to muscle the story.` };
      }
      if (a.kind === "crewBackup") {
        const gang = n.gang;
        clearApproach(n);
        addGangStanding(gang, -10);
        addGangDebt(gang, 3);
        provokeGang(n, 5);
        return { ok: false, msg: `${GANG_NAMES[gang]} decide backup should become pressure.` };
      }
      if (a.kind === "crewDues") {
        const gang = n.gang;
        clearApproach(n);
        addGangDebt(gang, Math.max(3, a.cost || 3));
        addGangStanding(gang, -10);
        if (gangStanding(gang) < -10 || gangDebt(gang) > 10) provokeGang(n, 5);
        return { ok: false, msg: `${GANG_NAMES[gang]} put interest on the dues. Debt ${gangDebt(gang)}.` };
      }
      if (a.kind === "stickUp") {
        const gang = n.gang;
        const racketGuard = a.racketGuard;
        clearApproach(n);
        n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 4);
        if (racketGuard) {
          CBZ.game.racketDebt = Math.min(50, (CBZ.game.racketDebt || 0) + Math.max(3, Math.ceil((a.cost || 3) * 0.85)));
          if (CBZ.addCasePressure) CBZ.addCasePressure(10 + (a.cost || 3), { type: "racket threat" }, n, { corruptHold: true });
        }
        if (gang >= 0) {
          addGangStanding(gang, -8);
          addGangDebt(gang, a.rivalGang ? 3 : 1);
          provokeGang(n, a.rivalGang ? 6 : 4);
        } else {
          n.huntPlayer = Math.max(n.huntPlayer || 0, 5);
          n.aiState = "wander";
        }
        addBuzz(racketGuard ? "badge" : "wealth", 6, racketGuard ? "racket-threat" : "stick-up-threat");
        return { ok: false, msg: racketGuard ? `${who} calls your bluff. ${racketGuard}'s debt climbs to ${Math.ceil(CBZ.game.racketDebt || 0)}.` : `${who} calls your bluff and comes for the pockets.` };
      }
      if (a.kind === "jobThreat") {
        const gang = n.gang;
        if (a.job) a.job.t = Math.max(4, (a.job.t || 10) - 6);
        clearApproach(n);
        addGangStanding(gang, -8);
        provokeGang(n, 7);
        return { ok: false, msg: `${GANG_NAMES[gang]} move to wreck the job.` };
      }
      if (a.kind === "coverStory") {
        clearApproach(n);
        n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 1);
        addGangStanding(n.gang, n.gang >= 0 ? -3 : 0);
        return { ok: false, msg: `${who} refuses to risk lying for you after that.` };
      }
      if (a.kind === "infoSell") {
        clearApproach(n);
        n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 2);
        if (rng() < 0.35) CBZ.game.witnessReportT = Math.max(CBZ.game.witnessReportT || 0, 5);
        return { ok: false, msg: `${who} keeps the intel and tells people you are desperate.` };
      }
      if (a.kind === "heatWarning") {
        clearApproach(n);
        n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 2);
        return { ok: false, msg: `${who} decides warning you was a mistake.` };
      }
      if (a.kind === "alibiDeal") {
        clearApproach(n);
        n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 3);
        if (n.memory && rng() < 0.38) sendNpcToSnitch(n, a.heat || 12, { copCrime: a.memoryType === "copCrime", lastKnown: n.memory.lastKnown, type: "threatened alibi" });
        else CBZ.game.witnessReportT = Math.max(CBZ.game.witnessReportT || 0, 5);
        addBuzz("snitch", 6, "alibi-threat-failed");
        return { ok: false, msg: `${who} decides the story is worth more to someone else.` };
      }
      if (a.kind === "stashCover") {
        clearApproach(n);
        n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 3);
        if (n.role === "thief") n.huntPlayer = Math.max(n.huntPlayer || 0, 3.5);
        addBuzz("wealth", 7, "failed-threat");
        return { ok: false, msg: `${who} clocks the threat and spreads that you are carrying.` };
      }
      if (a.kind === "racketCover") {
        clearApproach(n);
        n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 3);
        CBZ.game.racketDebt = Math.min(60, (CBZ.game.racketDebt || 0) + Math.max(3, Math.ceil((a.cost || 3) * 0.75)));
        if (CBZ.addCasePressure) CBZ.addCasePressure(8 + (a.cost || 3), { type: "racket cover threat", heardOnly: true }, n, { corruptHold: true });
        addBuzz("badge", 8, "failed-racket-cover-threat");
        return { ok: false, msg: `${who} sells the threat back to the racket. Bent debt ${Math.ceil(CBZ.game.racketDebt || 0)}.` };
      }
      if (a.kind === "coverDebt") {
        n.coverDebt = null;
        clearApproach(n);
        n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 3);
        n.reportedPlayerT = Math.max(n.reportedPlayerT || 0, 20);
        n.reportedPlayerAmount = Math.max(n.reportedPlayerAmount || 0, 8 + (a.cost || 2));
        n.reportedPlayerKind = "cover threat";
        n.reportedPlayerGuard = a.guard || "a guard";
        n.reportedPlayerCred = Math.max(n.reportedPlayerCred || 0, 0.64);
        n.reportedPlayerLastKnown = { x: CBZ.player.pos.x, z: CBZ.player.pos.z, type: "cover threat", heardOnly: false };
        if (CBZ.addCasePressure) CBZ.addCasePressure(8 + (a.cost || 2), { type: "cover threat", lastKnown: n.reportedPlayerLastKnown, credibility: n.reportedPlayerCred }, n);
        CBZ.game.witnessReportT = Math.max(CBZ.game.witnessReportT || 0, 6);
        addBuzz("snitch", 6, "failed-cover-threat");
        return { ok: false, msg: `${who} turns the threat into a cleaner story for guards.` };
      }
      clearApproach(n);
      return { ok: false, msg: `${who} stares you down. That made an enemy.` };
    }

    if (action === "refuse") {
      rippleApproach(n, "refused", a, { range: 12 });
      if (a.kind === "tax") {
        const gang = n.gang;
        clearApproach(n);
        n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 2);
        addGangDebt(gang, Math.max(2, a.cost || 3));
        addGangStanding(gang, -12);
        provokeGang(n, 8);
        return { ok: false, msg: `${GANG_NAMES[gang]} take that personally.` };
      }
      if (a.kind === "debtCollect") {
        const gang = n.gang;
        clearApproach(n);
        n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 2);
        addGangDebt(gang, Math.max(3, a.cost || 4));
        addGangStanding(gang, -8);
        provokeGang(n, 7);
        return { ok: false, msg: `${GANG_NAMES[gang]} add interest. Debt ${gangDebt(gang)}.` };
      }
      if (a.kind === "snitchThreat") {
        const heat = a.heat || a.cost * 9;
        const lastKnown = n.memory && n.memory.lastKnown;
        clearApproach(n);
        n.memory = null;
        n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 2);
        sendNpcToSnitch(n, heat, { lastKnown });
        return { ok: false, msg: `${who} runs to snitch.` };
      }
      if (a.kind === "recantOffer") {
        const amount = n.reportedPlayerAmount || a.amount || 12;
        clearApproach(n);
        n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 2);
        n.reportedPlayerT = Math.max(n.reportedPlayerT || 0, 20);
        n.reportedPlayerCred = Math.min(1, (n.reportedPlayerCred || a.credibility || 0.65) + 0.08);
        n.reportedPlayerDoubt = Math.max(0, 1 - n.reportedPlayerCred);
        if (CBZ.addCasePressure) CBZ.addCasePressure(amount * 0.18, { type: "refused recant", lastKnown: n.reportedPlayerLastKnown, credibility: n.reportedPlayerCred }, n);
        addBuzz("snitch", 5, "refused-recant");
        return { ok: false, msg: `${who} keeps the report warm and waits for guards to ask again.` };
      }
      if (a.kind === "buyItem") {
        clearApproach(n);
        n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 1);
        return { ok: true, msg: `${who} remembers you holding out on ${a.item}.` };
      }
      if (a.kind === "copBribe") {
        clearApproach(n);
        n.playerFear = Math.min(14, (n.playerFear || 0) + 1);
        return { ok: true, msg: `${who} palms the cigs away and plays innocent.` };
      }
      if (a.kind === "copTip") {
        clearApproach(n);
        n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
        return { ok: false, msg: `${who} keeps the tip to themselves.` };
      }
      if (a.kind === "copPlea") {
        clearApproach(n);
        n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 2);
        if (CBZ.addComplaint) CBZ.addComplaint(6);
        return { ok: false, msg: `${who} tells people you ignored the complaint.` };
      }
      if (a.kind === "copTaunt") {
        clearApproach(n);
        n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 2);
        return { ok: false, msg: `${who} laughs and gets bolder.` };
      }
      if (a.kind === "turfWarning") {
        const gang = n.gang;
        clearApproach(n);
        n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 1);
        addGangDebt(gang, 2);
        addGangStanding(gang, -5);
        if (gang >= 0 && gangStanding(gang) < -8) provokeGang(n, 5);
        return { ok: false, msg: `${GANG_NAMES[gang]} remember the disrespect.` };
      }
      if (a.kind === "gangParley") {
        const gang = n.gang;
        const mode = a.parleyMode || "warning";
        clearApproach(n);
        n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 2);
        addGangDebt(gang, mode === "truce" ? Math.max(4, a.cost || 4) : 2);
        addGangStanding(gang, mode === "recruit" ? -6 : -9);
        if (mode === "truce" || gangStanding(gang) < -16) provokeGang(n, 6 + (mode === "truce" ? 3 : 0));
        return { ok: false, msg: mode === "recruit" ? `${GANG_NAMES[gang]} mark you as outside the crew.` : `${GANG_NAMES[gang]} leave with a worse opinion of you. Debt ${gangDebt(gang)}.` };
      }
      if (a.kind === "jobThreat") {
        const gang = n.gang;
        if (a.job) a.job.t = Math.max(4, (a.job.t || 10) - 5);
        clearApproach(n);
        n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 2);
        addGangStanding(gang, -6);
        provokeGang(n, 6);
        return { ok: false, msg: `${GANG_NAMES[gang]} start interfering with the job.` };
      }
      if (a.kind === "coverStory") {
        clearApproach(n);
        n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
        addGangStanding(n.gang, n.gang >= 0 ? -2 : 0);
        return { ok: false, msg: `${who} lets the guard rumor keep spreading.` };
      }
      if (a.kind === "coverDebt") {
        n.coverDebt = null;
        clearApproach(n);
        n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
        n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 2);
        if (CBZ.addCasePressure) CBZ.addCasePressure(5 + (a.cost || 2), { type: "refused cover witness", heardOnly: true, source: who }, n);
        CBZ.game.witnessReportT = Math.max(CBZ.game.witnessReportT || 0, 4);
        addBuzz("heat", 5, "refused-cover-debt");
        return { ok: false, msg: `${who} stops spending credibility on your story.` };
      }
      if (a.kind === "infoSell") {
        clearApproach(n);
        n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
        n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 1);
        return { ok: false, msg: `${who} sells the search rumor somewhere else.` };
      }
      if (a.kind === "heatWarning") {
        clearApproach(n);
        n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
        return { ok: false, msg: `${who} stops risking their neck for you.` };
      }
      if (a.kind === "witnessFix") {
        const reporter = (a.reporter && alive(a.reporter)) ? a.reporter : findKnownReporter(n);
        clearApproach(n);
        n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
        n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 1);
        if (reporter && rng() < 0.25) reporter.reportedPlayerT = Math.max(reporter.reportedPlayerT || 0, 12);
        addBuzz("snitch", 4, "refused-fixer");
        return { ok: false, msg: `${who} leaves ${reporterName(reporter)} as your problem.` };
      }
      if (a.kind === "crewBackup") {
        clearApproach(n);
        n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
        addGangStanding(n.gang, n.gang >= 0 ? -2 : 0);
        return { ok: false, msg: `${who} lets you handle the heat alone.` };
      }
      if (a.kind === "crewDues") {
        const gang = n.gang;
        clearApproach(n);
        n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
        addGangDebt(gang, Math.max(2, Math.ceil((a.cost || 3) * 0.8)));
        addGangStanding(gang, -6);
        if (gangStanding(gang) < -12 || gangDebt(gang) > 12) provokeGang(n, 5);
        return { ok: false, msg: `${GANG_NAMES[gang]} mark dues unpaid. Debt ${gangDebt(gang)}.` };
      }
      if (a.kind === "stickUp") {
        const gang = n.gang;
        const racketGuard = a.racketGuard;
        clearApproach(n);
        n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 3);
        if (racketGuard) {
          CBZ.game.racketDebt = Math.min(50, (CBZ.game.racketDebt || 0) + Math.max(3, Math.ceil((a.cost || 3) * 0.75)));
          if (CBZ.addCasePressure) CBZ.addCasePressure(9 + (a.cost || 3), { type: "racket refusal" }, n, { corruptHold: true });
        }
        if (gang >= 0) {
          addGangStanding(gang, -6);
          addGangDebt(gang, a.rivalGang ? 2 : 1);
          if (a.rivalGang || gangStanding(gang) < -12) provokeGang(n, 5);
          else n.huntPlayer = Math.max(n.huntPlayer || 0, 4);
        } else {
          n.huntPlayer = Math.max(n.huntPlayer || 0, 4.5);
        }
        addBuzz(racketGuard ? "badge" : "wealth", 5, racketGuard ? "refused-racket-runner" : "refused-stick-up");
        return { ok: false, msg: racketGuard ? `${who} reports you refused the racket. Bent debt ${Math.ceil(CBZ.game.racketDebt || 0)}.` : `${who} decides asking nicely is over.` };
      }
      if (a.kind === "alibiDeal") {
        const heat = a.heat || 12;
        const lastKnown = n.memory && n.memory.lastKnown;
        clearApproach(n);
        n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 1);
        addBuzz("snitch", 5, "refused-alibi");
        if (lastKnown && rng() < 0.32) sendNpcToSnitch(n, heat, { copCrime: a.memoryType === "copCrime", lastKnown, type: "refused alibi" });
        return { ok: false, msg: `${who} keeps the alibi to sell later.` };
      }
      if (a.kind === "stashCover") {
        clearApproach(n);
        n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 1);
        addBuzz("wealth", 5, "refused-cover");
        return { ok: false, msg: `${who} shrugs. Loud pockets stay loud.` };
      }
      if (a.kind === "racketCover") {
        clearApproach(n);
        n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
        n.playerGrudge = Math.min(12, (n.playerGrudge || 0) + 1);
        CBZ.game.racketDebt = Math.min(60, (CBZ.game.racketDebt || 0) + 2);
        addBuzz("badge", 5, "refused-racket-cover");
        return { ok: false, msg: `${who} leaves the bent-cop tab alone. Debt ${Math.ceil(CBZ.game.racketDebt || 0)}.` };
      }
      if (a.kind === "favor") {
        clearApproach(n);
        addGangStanding(n.gang, 2);
        return { ok: true, msg: `${who} respects you not taking a handout.` };
      }
      if (a.kind === "gangJob") {
        clearApproach(n);
        n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
        addGangStanding(n.gang, -3);
        return { ok: false, msg: `${GANG_NAMES[n.gang]} think you ducked useful work.` };
      }
      if (a.kind === "lookout" || a.kind === "diversion") {
        clearApproach(n);
        n.rep = Math.max(-20, (n.rep || 0) - 2);
        return { ok: false, msg: `${who} shrugs. Your problem.` };
      }
      clearApproach(n);
      n.rep = Math.max(-20, (n.rep || 0) - 4);
      return { ok: true, msg: `${who} backs off.` };
    }

    return { ok: false, msg: "" };
  }

  function resolveKnownSnitch(n, action) {
    if (!n || !((n.reportedPlayerT || 0) > 0)) return { ok: false, msg: "That report has gone cold." };
    const who = actorName(n);
    const g = CBZ.game || {};
    const p = n.personality || {};
    const amount = n.reportedPlayerAmount || 12;
    const gang = n.gang;
    const sameGang = CBZ.player && CBZ.player.gang != null && gang === CBZ.player.gang;
    const rivalGang = CBZ.player && CBZ.player.gang != null && gang >= 0 && gang !== CBZ.player.gang;
    const armed = (CBZ.playerArmed && CBZ.playerArmed()) || (CBZ.econ && CBZ.econ.hasItem && CBZ.econ.hasItem("Shiv"));
    const credibility = Math.max(0.18, Math.min(0.98,
      n.reportedPlayerCred != null ? n.reportedPlayerCred : (n.reportedPlayerKind === "noise report" ? 0.45 : 0.70)
    ));
    const shaky = credibility < 0.52;

    if (action === "confront") {
      const standing = gang >= 0 ? gangStanding(gang) : 0;
      let chance = 0.34 + (n.playerFear || 0) * 0.035 + (n.playerTrust || 0) * 0.028 + (armed ? 0.08 : 0);
      chance += sameGang ? 0.10 : 0;
      chance += standing > 0 ? standing * 0.002 : standing * 0.004;
      chance -= (p.nerve || 0.5) * 0.16 + (rivalGang ? 0.08 : 0);
      chance += (0.62 - credibility) * 0.34;
      chance -= Math.max(0, credibility - 0.70) * 0.18;
      chance = Math.max(0.12, Math.min(0.78, chance));
      n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 1);
      if (rng() < chance) {
        const drop = 5 + Math.min(11, amount * 0.36);
        const challenged = CBZ.challengeCaseSource ? CBZ.challengeCaseSource(who, drop * 1.15, { reason: "confront" }) : null;
        coolWanted(drop);
        if (g.lastKnown && g.lastKnown.source === who) g.lastKnown.t = Math.min(g.lastKnown.t || 0, 4);
        n.reportedPlayerT = Math.min(n.reportedPlayerT || 0, 8);
        n.reportedPlayerCred = Math.max(0.12, credibility - 0.18 - (challenged && challenged.ok ? 0.10 : 0));
        n.reportedPlayerDoubt = Math.max(0, 1 - n.reportedPlayerCred);
        n.playerFear = Math.min(14, (n.playerFear || 0) + 1);
        n.playerTrust = Math.max(-8, (n.playerTrust || 0) - 1);
        if (gang >= 0) addGangStanding(gang, sameGang ? 1 : -1);
        emote(n, "...");
        return { ok: true, msg: shaky || (challenged && challenged.ok) ? `${who}'s story starts falling apart. The case gets shakier.` : `${who} admits talking and gives enough detail to muddy the search.` };
      }
      n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 2);
      n.reportedPlayerT = Math.max(n.reportedPlayerT || 0, 18);
      n.reportedPlayerCred = Math.min(1, credibility + 0.08);
      n.reportedPlayerDoubt = Math.max(0, 1 - n.reportedPlayerCred);
      if (CBZ.addCasePressure) CBZ.addCasePressure(amount * 0.22, { type: "denial", credibility: n.reportedPlayerCred }, n);
      if (g.witnessReportT != null) g.witnessReportT = Math.max(g.witnessReportT || 0, 4);
      if (rivalGang) addGangStanding(gang, -2);
      emote(n, "!");
      return { ok: false, msg: `${who} denies it loudly. The report sounds more credible now.` };
    }

    if (action === "paySilence") {
      const cost = knownSnitchCost(n);
      if ((g.cigs || 0) < cost) return { ok: false, msg: `Need ${cost} cigs to buy ${who}'s silence.` };
      CBZ.econ.addCigs(-cost);
      coolWanted(7 + cost + Math.min(7, amount * 0.22));
      const challenged = CBZ.challengeCaseSource ? CBZ.challengeCaseSource(who, 8 + cost, { force: true, reason: "paid silence" }) : null;
      if (g.lastKnown && g.lastKnown.source === who) g.lastKnown = null;
      clearKnownReport(n);
      n.memory = null;
      n.playerTrust = Math.min(14, (n.playerTrust || 0) + 1);
      n.playerGrudge = Math.max(0, (n.playerGrudge || 0) - 2);
      if (gang >= 0) {
        addGangStanding(gang, sameGang ? 2 : 1);
        if (!sameGang && CBZ.player.gang != null) addGangStanding(CBZ.player.gang, -1);
      }
      CBZ.sfx && CBZ.sfx("coin");
      emote(n, "$");
      return { ok: true, msg: challenged && challenged.ok ? `${who} takes ${cost} cigs and the case file loses a source.` : `${who} takes ${cost} cigs and walks the story back. Wanted pressure drops.` };
    }

    if (action === "threatenSnitch") {
      const standing = gang >= 0 ? gangStanding(gang) : 0;
      let chance = 0.28 + (armed ? 0.18 : 0) + (n.playerFear || 0) * 0.05 - (p.nerve || 0.5) * 0.24;
      chance += sameGang ? 0.08 : 0;
      chance -= rivalGang ? 0.10 : 0;
      chance += standing > 10 ? 0.06 : 0;
      chance += (0.58 - credibility) * 0.22;
      chance -= Math.max(0, credibility - 0.70) * 0.15;
      chance = Math.max(0.08, Math.min(0.82, chance));
      n.playerFear = Math.min(14, (n.playerFear || 0) + 2);
      n.playerGrudge = Math.min(14, (n.playerGrudge || 0) + 3);
      if (rng() < chance) {
        const challenged = CBZ.challengeCaseSource ? CBZ.challengeCaseSource(who, 6 + Math.min(8, amount * 0.25), { reason: "threatened witness" }) : null;
        n.reportedPlayerCred = Math.max(0.12, credibility - 0.16 - (challenged && challenged.ok ? 0.08 : 0));
        n.reportedPlayerDoubt = Math.max(0, 1 - n.reportedPlayerCred);
        coolWanted(4 + Math.min(8, amount * 0.25));
        if (g.lastKnown && g.lastKnown.source === who) g.lastKnown = null;
        clearKnownReport(n);
        if (gang >= 0) addGangStanding(gang, sameGang ? -1 : -4);
        n.aiState = "flee";
        n.fleeT = 2.3 + rng() * 1.7;
        emote(n, "!");
        return { ok: true, msg: `${who} folds and stops feeding the report, but holds the grudge.` };
      }
      n.reportedPlayerCred = Math.min(1, credibility + 0.12);
      n.reportedPlayerDoubt = Math.max(0, 1 - n.reportedPlayerCred);
      if (CBZ.addCasePressure) CBZ.addCasePressure(amount * 0.26, { type: "witness threat", forceSnitch: true, credibility: n.reportedPlayerCred }, n);
      if (gang >= 0) {
        addGangStanding(gang, -8);
        addGangDebt(gang, rivalGang ? 3 : 1);
        provokeGang(n, 5.5);
        return { ok: false, msg: `${who} yells for ${GANG_NAMES[gang]}. Threatening a talker made it public.` };
      }
      const lastKnown = n.reportedPlayerLastKnown || { x: CBZ.player.pos.x, z: CBZ.player.pos.z, type: "threat" };
      clearKnownReport(n);
      sendNpcToSnitch(n, amount + 7, { forceSnitch: true, lastKnown, type: "threat", credibility: Math.min(1, credibility + 0.12) });
      return { ok: false, msg: `${who} panics and runs to report the threat too.` };
    }

    return { ok: false, msg: "" };
  }

  // shove an actor away from a point (impact reaction)
  function knockback(actor, fx, fz, force) {
    const dx = actor.group.position.x - fx, dz = actor.group.position.z - fz;
    const d = Math.hypot(dx, dz) || 1;
    actor.group.position.x += (dx / d) * (force || 0.8);
    actor.group.position.z += (dz / d) * (force || 0.8);
  }

  const GANG_NAMES = ["the Reds", "the Blues"];
  // the player throws in with a gang (called from the interact menu)
  function joinGang(actor) {
    if (actor.gang < 0) return { ok: false, msg: "They're not in a gang." };
    CBZ.player.gang = actor.gang;
    addGangStanding(actor.gang, 22);
    addGangDebt(actor.gang, -999);
    for (const n of CBZ.npcs) if (n.gang === actor.gang) n.huntPlayer = 0; // crew stands down
    if (CBZ.playerChar && !CBZ.player._bandMesh) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.34), CBZ.mat(GANG_COLORS[actor.gang]));
      b.position.y = -0.2; CBZ.playerChar.parts.la.add(b); CBZ.player._bandMesh = b;
    } else if (CBZ.player._bandMesh) {
      CBZ.player._bandMesh.material.color.setHex(GANG_COLORS[actor.gang]);
      CBZ.player._bandMesh.visible = true;
    }
    return { ok: true, msg: `You're in! ${GANG_NAMES[actor.gang]} have your back now.` };
  }

  CBZ.aiThink = aiThink;
  CBZ.aiKill = kill;
  CBZ.aiReset = aiReset;
  CBZ.provokeGang = provokeGang;
  CBZ.noteGangIncident = noteGangIncident;
  CBZ.knockback = knockback;
  CBZ.joinGang = joinGang;
  CBZ.sendNpcToSnitch = sendNpcToSnitch;
  CBZ.npcWitnessCrime = npcWitnessCrime;
  CBZ.npcEmote = emote;
  CBZ.clearNpcApproach = clearApproach;
  CBZ.resolveNpcApproach = resolveNpcApproach;
  CBZ.resolveKnownSnitch = resolveKnownSnitch;
  CBZ.knownSnitchCost = knownSnitchCost;
  CBZ.startRacketRunner = startRacketRunner;
  CBZ.addGangStanding = addGangStanding;
  CBZ.addGangDebt = addGangDebt;
  CBZ.gangStanding = gangStanding;
  CBZ.gangDebt = gangDebt;
  CBZ.gangProtection = gangProtection;
  CBZ.socialProfile = socialProfile;
  CBZ.playerApproachBusy = playerApproachBusy;
  CBZ.isGangTurf = isOnTurf;
  CBZ.GANG_NAMES = GANG_NAMES;
  // ---- exposed for the rankings dashboard ----
  CBZ.behaviorOf = behaviorOf;
  CBZ.fightOdds = fightOdds;
  CBZ.combatPower = combatPower;
  CBZ.actorName = actorName;
  CBZ.ensureCombatProfile = ensureCombatProfile;
  // a single "notoriety" score used to rank the whole yard
  CBZ.npcPower = function (a) {
    if (!a) return 0;
    const r = a.ratings;
    const cap = r ? (r.fighting + r.toughness + r.speed * 0.6 + r.cunning * 0.5 + r.marksman * 0.4) : 120;
    const rec = a.record ? (a.record.kills * 14 + a.record.knockdowns * 4 + a.record.fights * 0.4) : 0;
    const rank = (a.kind === "warden" ? 60 : a.kind === "guard" ? 24 : 0) + (a.isLeader ? 30 : 0);
    return Math.round(cap + rec + rank);
  };
  CBZ.blockRumor = blockRumor;
  CBZ.topBlockBuzz = topBuzz;
  CBZ.rememberBlockRead = rememberBlockRead;
  CBZ.spreadReportGossip = spreadReportGossip;

  // gate the prison social/gang directors to escape mode (survival has no NPCs)
  const esc = (fn) => (dt) => { if (CBZ.game.mode !== "escape") return; fn(dt); };
  CBZ.onUpdate(18, esc(function (dt) {
    const gp = CBZ.game.gangProtection || (CBZ.game.gangProtection = [0, 0]);
    for (let i = 0; i < gp.length; i++) gp[i] = Math.max(0, (gp[i] || 0) - dt);
    updateGangJob(dt);
  }));
  CBZ.onUpdate(42, esc(updateGangPresence));
  CBZ.onUpdate(42.2, esc(updateTurfCheckpoints));
  CBZ.onUpdate(42.4, esc(updateGangThresholds));
  CBZ.onUpdate(43, esc(updateSocialDirector));
  CBZ.onUpdate(43.5, esc(updateWatcherDirector));
  CBZ.onUpdate(44, esc(updateBlockRumors));
})();
