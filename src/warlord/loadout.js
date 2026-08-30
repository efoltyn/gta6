/* ============================================================
   warlord/loadout.js — WHO CARRIES WHAT.

   "like bannerlord you arm yourself and team with armour and weapons...
    you decide which of your army get what weapon."

   The decision is real, so the screen has to make it CHEAP. Arming two
   hundred men one at a time is not a decision, it is data entry — nobody
   does it twice — so the primary interaction here is BULK and the per-man
   roster exists underneath it for the players who want to hand-place the
   sniper. AUTO-ARM is the button most people will press and it therefore
   gets the most care in this file: it is not a heuristic, it is the
   provable maximum (see the rearrangement note below), and it TELLS YOU
   what it did, because a button that silently rearranges 200 men and says
   nothing is a button you stop trusting.

   THIS FILE OWNS NO EQUIPPING RULES. Every change goes through core's
   W.equip / W.equipArmour, which already do the half everybody forgets:
   the gun a man was holding goes back into the baggage in the same call.
   A second equipping path is how you get guns that duplicate themselves.

   EVENTS: armoury:open armoury:close armoury:auto armoury:equip

   FLAGS: ?autoarm=old  hand the cart out in roster order (the first draft)
          ?outfit=old   the whole outfitting wave reverted
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  if (!W.state) { console.error("[warlord] loadout.js loaded without core.js"); return; }

  const Q = new URLSearchParams(G.location ? G.location.search : "");
  const OLD_AUTO = Q.get("outfit") === "old" || Q.get("autoarm") === "old";

  let ctx = null, BACK = null, LAST = null, OPEN_TIER = null, OPEN_MAN = null, PICK = null;

  /* ============================================================ THE NUMBERS
     BASE POWER is core's own soldierPower with the gun factor divided out.
     It is written here rather than guessed because the whole assignment
     argument below depends on the shape of that formula being exactly
     `base × gunFactor` and nothing else. If core.js changes the shape, this
     comment is where the assignment stops being optimal. */
  function baseOf(s) {
    const T = W.tier(s.tier);
    return T.acc * (T.hp / 100) * (1 + W.armour(s.armour).soak / 46) * (s.wounded ? 0.62 : 1) * 10;
  }
  // you are not in state.army, and core scores you at a flat 14 (W.yourPower)
  function baseOfYou() { return 14 * (1 + W.armour(W.state.you.armour).soak / 46); }
  function baseOfAny(s) { return s === W.state.you ? baseOfYou() : baseOf(s); }
  // the armour-free, gun-free part — what the armour pass has to sort on
  function bareOf(s) {
    if (s === W.state.you) return 14;
    const T = W.tier(s.tier);
    return T.acc * (T.hp / 100) * (s.wounded ? 0.62 : 1) * 10;
  }
  /* CORE'S OWN TERM, NOT A COPY OF IT. soldierPower multiplies base by
     W.gunCombat(wid) (bare hands score 0.3, not "a cheap gun"), and this file
     has to sort on the identical number or AUTO-ARM optimises something the
     game does not score. The fallback exists only for a build where core is
     older than gunCombat. */
  function combatOf(wid) {
    const w = W.gun(wid);
    if (!w) return 0.3;
    if (W.gunCombat) return W.gunCombat(wid);
    return Math.min(3.2, 0.5 + W.gunPrice(wid) / 210);
  }
  function totalPower() { return W.yourPower(); }

  function expand(bag) {
    const out = [];
    for (const k in bag) for (let i = 0; i < bag[k]; i++) out.push(k);
    return out;
  }
  function holders() { return [W.state.you].concat(W.state.army); }

  /* ============================================================ AUTO-ARM
     THIS IS NOT A HEURISTIC. Army power is Σ base_i × combatOf(σ(i)) — core's
     soldierPower is exactly that product and nothing else. The rearrangement
     inequality says a sum of paired products is maximised when both sequences
     are sorted the same way, so pairing the best gun with the best man is the
     PROVABLE maximum, not a good guess. Two consequences worth knowing:

       · The pool must include the guns the men are already holding, not just
         the cart. A pass that only hands out the cart cannot move a rifle off
         a levy onto a veteran, and that move is the entire point of the
         button. So everyone is stripped first and the whole army is dealt
         from one pile.
       · Armour goes first. It multiplies base, and base is what the gun pass
         then sorts on, so plate has to be on the veteran BEFORE the rifles
         are dealt. Two sequential optimal passes are not jointly optimal in
         theory; in practice armour ranks men in the same order their tiers
         already do, so the two orders agree and the joint result is the same.

     YOU ARE IN THE POOL. You are a man on the field with a gun and core
     scores you at 14 — above a veteran's ~11 — so you sort to the top and
     take the best rifle. A warlord who hands the AK to somebody else and
     keeps the pistol is roleplay, and it is one tap away in the roster. */
  function autoArm(opts) {
    opts = opts || {};
    const S = W.state;
    const before = totalPower();
    const rep = { before: before, after: 0, guns: {}, armour: {}, fists: 0, men: 0, stripped: 0, mode: "auto" };

    if (OLD_AUTO) return autoArmOld(rep);

    const men = holders();
    // ---- strip, so the whole army is one pile
    for (let i = 0; i < men.length; i++) {
      const s = men[i];
      if (s.wid && s.wid !== "fists") { W.equip(s, "fists"); rep.stripped++; }
      if (s.armour && s.armour !== "none") W.equipArmour(s, "none");
    }

    // ---- armour, best soak to the highest bare power
    const arm = expand(S.armourBag).sort(function (a, b) { return W.armour(b).soak - W.armour(a).soak; });
    const rankA = men.slice().sort(function (a, b) { return bareOf(b) - bareOf(a); });
    for (let i = 0; i < arm.length && i < rankA.length; i++) {
      if (W.equipArmour(rankA[i], arm[i])) note(rep.armour, arm[i], rankA[i]);
    }

    // ---- guns, best value to the highest base power (armour now counted)
    const guns = expand(S.baggage).sort(function (a, b) { return combatOf(b) - combatOf(a); });
    const rankG = men.slice().sort(function (a, b) { return baseOfAny(b) - baseOfAny(a); });
    for (let i = 0; i < rankG.length; i++) {
      if (i >= guns.length) { if (rankG[i].wid === "fists") rep.fists++; continue; }
      if (W.equip(rankG[i], guns[i])) { note(rep.guns, guns[i], rankG[i]); rep.men++; }
    }

    rep.after = totalPower();
    LAST = rep;
    W.emit("armoury:auto", rep);
    return rep;
  }

  /* ?autoarm=old — THE FIRST DRAFT, kept runnable because it is the honest
     before for this change. It walked the roster in array order and handed
     out whatever the cart iterated next: no strip, no ranking, so the AK
     went to whoever happened to be at index 0 and the veterans finished the
     day with pistols. Same buttons, same cart, materially less army. */
  function autoArmOld(rep) {
    const S = W.state;
    rep.mode = "old";
    const guns = expand(S.baggage);
    const arm = expand(S.armourBag);
    const men = holders();
    let gi = 0, ai = 0;
    for (let i = 0; i < men.length; i++) {
      if (ai < arm.length && men[i].armour === "none") { if (W.equipArmour(men[i], arm[ai])) { note(rep.armour, arm[ai], men[i]); ai++; } }
      if (gi < guns.length && men[i].wid === "fists") { if (W.equip(men[i], guns[gi])) { note(rep.guns, guns[gi], men[i]); rep.men++; gi++; } }
    }
    for (let i = 0; i < men.length; i++) if (men[i].wid === "fists") rep.fists++;
    rep.after = totalPower();
    LAST = rep;
    W.emit("armoury:auto", rep);
    return rep;
  }

  function note(map, id, s) {
    const row = map[id] || (map[id] = { n: 0, tiers: {} });
    row.n++;
    const t = s === W.state.you ? "YOU" : W.tier(s.tier).label;
    row.tiers[t] = (row.tiers[t] || 0) + 1;
  }

  /* ---- UPGRADE PASS: hand out the CART only, best-first, top N men.
     Different tool from AUTO-ARM and both earn their place: this one is what
     you press walking out of a depot with twenty new rifles, and it does not
     disturb anybody it does not improve. The swapped-out gun lands back in
     the cart (core's equip does that) but is not reconsidered in this pass —
     an upgrade sweep, not a re-solve. */
  function handOut(limit) {
    const S = W.state;
    const rep = { before: totalPower(), after: 0, guns: {}, armour: {}, fists: 0, men: 0, stripped: 0, mode: "top" };
    const guns = expand(S.baggage).sort(function (a, b) { return combatOf(b) - combatOf(a); });
    const men = holders().sort(function (a, b) { return baseOfAny(b) - baseOfAny(a); });
    let gi = 0;
    for (let i = 0; i < men.length && gi < guns.length; i++) {
      if (limit && rep.men >= limit) break;
      if (combatOf(guns[gi]) <= combatOf(men[i].wid)) break;      // nothing better left in the cart
      if (W.equip(men[i], guns[gi])) { note(rep.guns, guns[gi], men[i]); rep.men++; gi++; }
    }
    rep.after = totalPower();
    LAST = rep;
    W.emit("armoury:auto", rep);
    return rep;
  }

  /* ---- ARMOUR THE FRONT: the cart's armour onto the men most likely to be
     shot, which is the men with the most base power — they are the ones you
     put in front and the ones it costs most to lose. */
  function armourFront() {
    const S = W.state;
    const rep = { before: totalPower(), after: 0, guns: {}, armour: {}, fists: 0, men: 0, stripped: 0, mode: "armour" };
    const arm = expand(S.armourBag).sort(function (a, b) { return W.armour(b).soak - W.armour(a).soak; });
    const men = holders().sort(function (a, b) { return bareOf(b) - bareOf(a); });
    let ai = 0;
    for (let i = 0; i < men.length && ai < arm.length; i++) {
      if (W.armour(arm[ai]).soak <= W.armour(men[i].armour).soak) break;
      if (W.equipArmour(men[i], arm[ai])) { note(rep.armour, arm[ai], men[i]); rep.men++; ai++; }
    }
    rep.after = totalPower();
    LAST = rep;
    W.emit("armoury:auto", rep);
    return rep;
  }

  /* ---- STRIP A TIER: take the guns off the men who waste them. The levies
     break and run and the rifle runs with them; this is how you get it back
     before a fight rather than after one. */
  function stripTier(tierId) {
    const S = W.state;
    const rep = { before: totalPower(), after: 0, guns: {}, armour: {}, fists: 0, men: 0, stripped: 0, mode: "strip" };
    for (let i = 0; i < S.army.length; i++) {
      const s = S.army[i];
      if (s.tier !== tierId) continue;
      if (s.wid && s.wid !== "fists") { W.equip(s, "fists"); rep.stripped++; }
    }
    rep.after = totalPower();
    LAST = rep;
    W.emit("armoury:auto", rep);
    return rep;
  }

  /* ============================================================ THE SCREEN */
  const CSS = `
  .wl-la-pw{display:flex;gap:14px;align-items:baseline;flex-wrap:wrap;margin:2px 0 0}
  .wl-la-pw b{font-size:30px;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
  .wl-la-d{font-size:15px;letter-spacing:.06em}
  .wl-la-d.up{color:#8fe0a2} .wl-la-d.dn{color:var(--blood)}
  .wl-la-row{display:grid;grid-template-columns:1fr auto;gap:2px 10px;align-items:center;
    padding:9px 0;border-bottom:1px solid rgba(255,255,255,.07)}
  .wl-la-row:last-child{border-bottom:0}
  .wl-la-nm{font-size:14px;letter-spacing:.03em}
  .wl-la-st{font-size:10.5px;letter-spacing:.05em;opacity:.5;font-variant-numeric:tabular-nums}
  .wl-la-act{grid-column:2;grid-row:1/span 2;display:flex;gap:6px;align-items:center;flex-shrink:0}
  .wl-la-act .wl-btn{padding:8px 11px;font-size:12px}
  .wl-la-grp{width:100%;display:flex;justify-content:space-between;align-items:center;gap:10px;
    padding:12px 13px;margin:0 0 8px;border:1px solid rgba(255,255,255,.12);border-radius:12px;
    background:rgba(255,255,255,.03);cursor:pointer;text-align:left}
  .wl-la-grp.on{border-color:var(--hot);background:rgba(255,138,61,.1)}
  .wl-la-grp .n{font-size:11px;letter-spacing:.16em;opacity:.6;font-variant-numeric:tabular-nums}
  .wl-la-pick{border:1px solid rgba(255,138,61,.4);border-radius:12px;padding:10px 12px;
    margin:6px 0 10px;background:rgba(255,138,61,.07)}
  .wl-la-pick .wl-btns{margin-top:8px}
  .wl-la-pick .wl-btn{padding:8px 11px;font-size:12px}
  .wl-la-rep{font-size:12px;letter-spacing:.05em;line-height:1.65}
  .wl-la-rep i{font-style:normal;color:var(--hot)}
  .wl-la-rep .dim{opacity:.5}
  .wl-la-w{color:var(--blood);font-size:10px;letter-spacing:.14em}
  @media (max-width:420px){ .wl-la-pw b{font-size:26px} .wl-la-nm{font-size:13px} }`;
  function styleOnce() {
    if (G.document && !G.document.getElementById("wl-la-css")) {
      const s = G.document.createElement("style");
      s.id = "wl-la-css"; s.textContent = CSS;
      G.document.head.appendChild(s);
    }
  }

  function gunStat(wid) {
    if (W.outpost && W.outpost.statLine) return W.outpost.statLine(wid);
    const w = W.gun(wid);
    return w ? ("DMG " + w.damage + "  ·  " + (w.range || 0) + "M") : "bare hands";
  }
  function gunName(wid) { return (!wid || wid === "fists") ? "BARE HANDS" : W.gunLabel(wid); }

  function cartRows() {
    const S = W.state;
    return Object.keys(S.baggage).sort(function (a, b) { return W.gunPrice(b) - W.gunPrice(a); });
  }

  function powerStrip() {
    const now = totalPower();
    const d = LAST ? Math.round(LAST.after - LAST.before) : 0;
    return '<div class="wl-card"><div class="wl-lbl" style="margin:0 0 4px">ARMY STRENGTH</div>' +
      '<div class="wl-la-pw"><b>' + Math.round(now) + '</b>' +
      (LAST && d !== 0 ? '<span class="wl-la-d ' + (d > 0 ? "up" : "dn") + '">' + (d > 0 ? "+" : "") + d +
        ' <span class="wl-dim wl-small">FROM ' + Math.round(LAST.before) + '</span></span>' : '') +
      '<span class="wl-dim wl-small">' + (W.state.army.length + 1) + ' MEN  ·  ' + armedCount() + ' ARMED  ·  ' +
        cartRows().reduce(function (n, id) { return n + W.state.baggage[id]; }, 0) + ' GUNS IN THE CART</span>' +
      '</div></div>';
  }
  function armedCount() {
    let n = W.state.you.wid && W.state.you.wid !== "fists" ? 1 : 0;
    for (let i = 0; i < W.state.army.length; i++) if (W.state.army[i].wid && W.state.army[i].wid !== "fists") n++;
    return n;
  }

  function reportCard() {
    if (!LAST) return "";
    const r = LAST;
    let h = '<div class="wl-card"><div class="wl-lbl" style="margin:0 0 6px">' +
      (r.mode === "auto" ? "AUTO-ARM" : r.mode === "top" ? "HANDED OUT" : r.mode === "armour" ? "ARMOUR" : "STRIPPED") +
      ' — WHAT IT DID</div><div class="wl-la-rep">';
    if (r.stripped) h += '<span class="dim">took ' + r.stripped + ' guns back into the cart and dealt the whole army from one pile.</span><br>';
    const gids = Object.keys(r.guns).sort(function (a, b) { return W.gunPrice(b) - W.gunPrice(a); });
    for (let i = 0; i < gids.length; i++) {
      const row = r.guns[gids[i]];
      h += '<i>' + W.gunLabel(gids[i]) + ' ×' + row.n + '</i> → ' + tierBreak(row.tiers) + '<br>';
    }
    const aids = Object.keys(r.armour);
    for (let i = 0; i < aids.length; i++) {
      const row = r.armour[aids[i]];
      h += '<i>' + W.armour(aids[i]).label + ' ×' + row.n + '</i> → ' + tierBreak(row.tiers) + '<br>';
    }
    if (!gids.length && !aids.length) h += '<span class="dim">nothing in the cart was an upgrade on anybody.</span><br>';
    if (r.fists) h += '<span class="dim">' + r.fists + ' men have nothing but their hands — buy guns at a depot.</span><br>';
    h += '</div></div>';
    return h;
  }
  function tierBreak(tiers) {
    const out = [];
    for (const t in tiers) out.push(tiers[t] + " " + t);
    return out.join(", ");
  }

  function youCard() {
    const S = W.state, y = S.you;
    return '<div class="wl-lbl">YOURSELF</div><div class="wl-card">' +
      '<div class="wl-la-row">' +
        '<div class="wl-la-nm">' + y.name + ' <span class="wl-dim wl-small">· ' + gunName(y.wid) + '</span></div>' +
        '<div class="wl-la-st">' + gunStat(y.wid) + '</div>' +
        '<div class="wl-la-act"><button class="wl-btn" data-pick="you">CHANGE</button></div>' +
      '</div>' +
      '<div class="wl-la-row">' +
        '<div class="wl-la-nm">' + W.armour(y.armour).label + '</div>' +
        '<div class="wl-la-st">SOAK ' + W.armour(y.armour).soak + '  ·  ' + Math.round(y.hp) + '/' + y.maxHp + ' HP  ·  ' + (y.kills || 0) + ' KILLS</div>' +
        '<div class="wl-la-act"><button class="wl-btn" data-apick="you">ARMOUR</button></div>' +
      '</div>' +
      (PICK === "you" ? pickerFor(y, "you") : "") +
      '</div>';
  }

  /* ---- the picker: the cart, grouped, one tap per choice ---- */
  function pickerFor(s, key) {
    const S = W.state;
    let h = '<div class="wl-la-pick"><div class="wl-small wl-dim">FROM THE BAGGAGE TRAIN</div><div class="wl-btns">';
    const ids = cartRows();
    if (!ids.length) h += '<span class="wl-small wl-dim">the cart is empty.</span>';
    for (let i = 0; i < ids.length; i++) {
      h += '<button class="wl-btn" data-give="' + key + '" data-wid="' + ids[i] + '">' +
        W.gunLabel(ids[i]) + ' <span class="wl-dim">×' + S.baggage[ids[i]] + '</span></button>';
    }
    if (s.wid && s.wid !== "fists") h += '<button class="wl-btn bad" data-give="' + key + '" data-wid="fists">TO THE CART</button>';
    h += '</div><div class="wl-small wl-dim" style="margin-top:10px">ARMOUR</div><div class="wl-btns">';
    const aids = Object.keys(S.armourBag);
    for (let i = 0; i < aids.length; i++) {
      h += '<button class="wl-btn" data-agive="' + key + '" data-aid="' + aids[i] + '">' +
        W.armour(aids[i]).label + ' <span class="wl-dim">×' + S.armourBag[aids[i]] + '</span></button>';
    }
    if (s.armour && s.armour !== "none") h += '<button class="wl-btn bad" data-agive="' + key + '" data-aid="none">TAKE IT OFF</button>';
    if (!aids.length && s.armour === "none") h += '<span class="wl-small wl-dim">no armour in the cart.</span>';
    h += '</div></div>';
    return h;
  }

  /* ---- the roster. GROUPED AND COLLAPSED, because two hundred rows of DOM
     laid out at 393pt is the thing that makes this screen feel broken, and
     because the question is nearly always "what are my veterans holding",
     never "what is man 137 holding". The tier you care about is open; the
     rest are one tap away. */
  const ROSTER_CAP = 40;
  /* army.js ALREADY GROUPS AN ARMY and its grouping is better than the one
     this file started with: it stacks on tier + gun + armour, so the roster
     reads "6 VETERANS · AK-47 · PLATE RIG" — which is exactly the question
     the armoury is asking. Use it. The local fallback only exists for a page
     where army.js failed to load, and it groups by tier alone. */
  function groups() {
    if (W.army && W.army.groups) {
      try {
        const g = W.army.groups(W.state.army);
        if (g && g.length) return g;
      } catch (e) {}
    }
    const by = {};
    for (let i = 0; i < W.state.army.length; i++) {
      const s = W.state.army[i];
      (by[s.tier] = by[s.tier] || []).push(s);
    }
    const out = [];
    for (let i = W.TIERS.length - 1; i >= 0; i--) {
      const T = W.TIERS[i];
      if (by[T.id] && by[T.id].length) out.push({ key: T.id, tier: T.id, label: T.label, men: by[T.id] });
    }
    return out;
  }
  function keyOf(g) { return g.key || g.tier; }

  function rosterCard() {
    const gs = groups();
    let h = '<div class="wl-lbl">YOUR MEN</div>';
    if (!gs.length) return h + '<div class="wl-card"><div class="wl-small wl-dim">you ride alone. hire men at a recruit camp.</div></div>';
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i];
      const k = keyOf(g);
      const open = OPEN_TIER === k;
      const armed = g.men.filter(function (s) { return s.wid && s.wid !== "fists"; }).length;
      const hurt = g.men.filter(function (s) { return s.wounded; }).length;
      // army.js's stacks already carry the gun and armour; the fallback's do not
      const kit = g.wid != null
        ? gunName(g.wid) + ' · ' + W.armour(g.armour).label
        : armed + ' ARMED';
      h += '<button class="wl-la-grp' + (open ? " on" : "") + '" data-tier="' + k + '">' +
        '<span>' + g.men.length + ' × ' + (g.label || W.tier(g.tier).label) +
          '<br><span class="n" style="letter-spacing:.1em">' + kit + '</span></span>' +
        '<span class="n">' + (hurt ? hurt + ' HURT · ' : '') +
          'POWER ' + Math.round(W.power(g.men)) + (open ? '  ▾' : '  ▸') + '</span></button>';
      if (!open) continue;
      h += '<div class="wl-card">';
      const men = g.men.slice().sort(function (a, b) { return baseOf(b) * combatOf(b.wid) - baseOf(a) * combatOf(a.wid); });
      for (let k = 0; k < men.length && k < ROSTER_CAP; k++) {
        const s = men[k];
        h += '<div class="wl-la-row">' +
          '<div class="wl-la-nm">' + s.name + (s.wounded ? ' <span class="wl-la-w">WOUNDED</span>' : '') + '</div>' +
          '<div class="wl-la-st">' + gunName(s.wid) + '  ·  ' + W.armour(s.armour).label +
            '  ·  ' + (s.kills || 0) + ' KILLS  ·  ' + (s.battles || 0) + ' BATTLES  ·  PW ' + Math.round(W.soldierPower(s)) + '</div>' +
          '<div class="wl-la-act"><button class="wl-btn" data-pick="' + s.id + '">KIT</button></div>' +
          '</div>' +
          (PICK === String(s.id) ? pickerFor(s, String(s.id)) : "");
      }
      if (men.length > ROSTER_CAP) h += '<div class="wl-small wl-dim" style="padding-top:8px">…and ' + (men.length - ROSTER_CAP) + ' more. use the bulk buttons.</div>';
      h += '</div>';
    }
    return h;
  }

  function draw() {
    if (!ctx || !ctx.screen) return;
    styleOnce();
    const S = W.state;
    let h = '<h1 class="wl-h">THE <em>ARMOURY</em></h1>' +
      '<p class="wl-sub">DAY ' + S.day + '  ·  <span class="wl-gold">$' + S.gold + '</span>  ·  ' +
        '−$' + W.payroll() + '/DAY IN WAGES</p>';
    h += powerStrip();
    h += reportCard();
    h += '<div class="wl-lbl">DO IT IN BULK</div><div class="wl-card">' +
      '<div class="wl-btns" style="margin-top:0">' +
        '<button class="wl-btn hot" id="laAuto">AUTO-ARM EVERYONE</button>' +
        '<button class="wl-btn" id="laTop">ARM THE BEST 20</button>' +
        '<button class="wl-btn" id="laArmour">ARMOUR THE FRONT</button>' +
        '<button class="wl-btn bad" id="laStrip">STRIP THE LEVIES</button>' +
      '</div>' +
      '<div class="wl-small wl-dim" style="margin-top:10px">' +
        'AUTO-ARM takes every gun back — the cart AND the ones your men are holding — and deals ' +
        'the whole pile out best-to-best. It is the largest army strength these guns can produce.' +
      '</div></div>';
    h += youCard();
    h += rosterCard();
    h += '<div class="wl-btns" style="margin-top:20px">' +
      '<button class="wl-btn hot" id="laBack">DONE</button>' +
      (W.outpost && W.outpost.current && W.outpost.current() ? '<button class="wl-btn" id="laShop">BACK TO THE STALL</button>' : '') +
      '</div>';
    const node = ctx.screen(h);
    if (ctx.paintHud) ctx.paintHud();
    wire(node);
  }

  function manById(key) {
    if (key === "you") return W.state.you;
    const id = parseInt(key, 10);
    for (let i = 0; i < W.state.army.length; i++) if (W.state.army[i].id === id) return W.state.army[i];
    return null;
  }

  function wire(node) {
    node.onclick = function (e) {
      const t = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!t) return;
      if (t.id === "laAuto") { autoArm(); draw(); return; }
      if (t.id === "laTop") { handOut(20); draw(); return; }
      if (t.id === "laArmour") { armourFront(); draw(); return; }
      if (t.id === "laStrip") { stripTier("levy"); draw(); return; }
      if (t.id === "laBack") { close(); return; }
      if (t.id === "laShop") { if (W.outpost && W.outpost.open) W.outpost.open(W.outpost.current()); return; }
      if (t.hasAttribute("data-tier")) {
        const tr = t.getAttribute("data-tier");
        OPEN_TIER = OPEN_TIER === tr ? null : tr; PICK = null; draw(); return;
      }
      if (t.hasAttribute("data-pick") || t.hasAttribute("data-apick")) {
        const k = t.getAttribute("data-pick") || t.getAttribute("data-apick");
        PICK = PICK === k ? null : k; draw(); return;
      }
      if (t.hasAttribute("data-give")) {
        const s = manById(t.getAttribute("data-give"));
        if (s && !W.equip(s, t.getAttribute("data-wid"))) W.toast("not in the cart", "bad");
        else W.emit("armoury:equip", s);
        LAST = null; draw(); return;
      }
      if (t.hasAttribute("data-agive")) {
        const s = manById(t.getAttribute("data-agive"));
        if (s && !W.equipArmour(s, t.getAttribute("data-aid"))) W.toast("not in the cart", "bad");
        else W.emit("armoury:equip", s);
        LAST = null; draw(); return;
      }
    };
  }

  function open(opts) {
    opts = opts || {};
    BACK = opts.back || null;
    LAST = null; PICK = null;
    if (OPEN_TIER == null) {
      // open the tier you actually came here for: the best men you own
      const gs = groups();
      OPEN_TIER = gs.length ? gs[0].tier : null;
    }
    W.setPhase("armoury");
    draw();
    W.emit("armoury:open");
  }

  function close() {
    W.emit("armoury:close");
    const back = BACK; BACK = null;
    if (back) { back(); return; }
    if (W.campaign && W.campaign.enter) W.campaign.enter();
    else { W.setPhase("menu"); W.emit("mainmenu"); }
  }

  W.on("phase:leave:armoury", function () { PICK = null; });

  /* ============================================================ DEMO FIXTURE
     ?armoury=1 and the before/after tool both need a warband that exists
     without riding for it, and outpost.js's own debug entry calls this so
     there is ONE fixture rather than two that drift. Everything here is
     drawn from W.hash01 (pure, positional) and never from the RNG stream, so
     flipping a behaviour flag cannot change the men being photographed — the
     before and after sides get the identical army. The counts are a fixture,
     not balance: a pile of loot big enough that a bad distribution and a good
     one are visibly different numbers. */
  function demo(n) {
    const S = W.state;
    if (!S.army.length) {
      n = n || 26;
      const mix = ["levy", "levy", "levy", "raider", "raider", "soldier", "soldier", "veteran"];
      for (let i = 0; i < n; i++) {
        const t = mix[Math.floor(W.hash01(i, 3, 5) * mix.length) % mix.length];
        const s = W.makeSoldier(t, W.hash01(i, 7, 19) < 0.45 ? "sidearm" : "fists");
        s.kills = Math.floor(W.hash01(i, 9, 13) * 8);
        s.battles = Math.floor(W.hash01(i, 11, 17) * 5);
        s.wounded = W.hash01(i, 5, 23) < 0.16;
        W.addSoldier(s);
      }
    }
    const loot = { ak47: 6, carbine: 4, lmg: 1, smg: 5, shotgun: 3, sidearm: 7, sniper: 2 };
    for (const k in loot) if (!S.baggage[k]) W.stash(k, loot[k]);
    if (!S.armourBag.vest) W.stashArmour("vest", 7);
    if (!S.armourBag.plate) W.stashArmour("plate", 3);
    return S;
  }

  /* ============================================================ MODULE */
  W.module("loadout", {
    boot: function (c) {
      ctx = c;
      styleOnce();
      /* ?armoury=1 opens this screen directly with a warband to arm — never
         blocked on campaign.js or army.js existing. &auto=1 runs AUTO-ARM
         before the first paint, which is how the after side of the
         before/after run photographs the result rather than the button. */
      if (Q.get("armoury")) {
        setTimeout(function () {
          if (!W.state.army.length && W.state.day === 1) {
            W.newGame({ seed: parseInt(Q.get("seed") || "", 10) || 1337 });
          }
          demo();
          if (Q.get("auto") === "1") autoArm();
          open();
        }, 0);
      }
    },
    open: open,
    close: close,
    autoArm: autoArm,
    handOut: handOut,
    armourFront: armourFront,
    stripTier: stripTier,
    demo: demo,
    power: totalPower,
    armed: armedCount,
    report: function () { return LAST; },
  });
})();
