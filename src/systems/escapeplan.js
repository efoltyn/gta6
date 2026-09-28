/* ============================================================
   systems/escapeplan.js - THE ESCAPE IS A PLAN.

   OWNER: "the idea of what the game should be is smart, but the logic is
   dumb and it's not fun." The measured version of that: the keycard lay on
   a desk as a free walk-over pickup, the yard door opened for it, and the
   culvert crawl in the yard ditch dropped you outside the wall. Either way
   out took under a minute and nothing else in the prison (cigs, favours,
   guards, the clock) had any bearing on it.

   Every route now has steps, every step is a thing in the world, and the
   plan (closed until you press P or tap Plan) says which steps are done and
   what the next one is.

     GATE      1 Keycard     lifted off a senior screw (economy.js steal),
                             taken off the block desk while its officer is
                             away (one grab, here; do it seen and it is a
                             witnessed theft), or bought
                             from the Old Timer (quests.js asks fixerTalk)
               2 Gate Key    the board in the gate booth (a Keycard door)
                             or the gate officer's belt
               3 The port    walk the sally port without a guard seeing
                             you. Gate 3 has an officer on the walkway; he
                             has to be down, bought, or looking away.
     CULVERT   1 A blade     Hacksaw Blade on the workshop bench, or bought
               2 The grate   the yard ditch grate is welded: cut it (a few
                             seconds, loud, nobody may see or hear)
               3 The crawl   only when nobody is watching the ditch
     FAVOURS   run jobs until somebody owes you (rep 100), then Talk.

   STAKES. A capture that does not ship you out (systems/capture.js) is a
   shakedown: the screws take every key and tool you carry, re-weld the
   grate, and put the desk card back. A transfer's reception search is
   worse and the next run says what it took.

   ONE TRUTH FOR THE CARD. g.hasKey used to be written by three files and
   the bag item by two; they drifted. The bag is the truth now and hasKey
   follows it every frame, so a lift, a purchase, a floor pickup and a
   confiscation all go through econ.addItem / the inventory alone.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.game) return;
  const g = CBZ.game;
  const player = CBZ.player;

  const PRICE = { "Keycard": 40, "Hacksaw Blade": 15 };
  const PRICE_WORD = { 40: "Forty", 15: "Fifteen" };
  const DESK_ATTEND_R = 6.0;          // a screw this close to the desk is AT it
  const DESK_REACH2 = 1.9 * 1.9;
  const GRATE_REACH2 = 1.6;           // the vents' own reach (interactions.js)
  const WORK_NEED = { grate: 3.6 };  // the cut is the only timed beat; the card is a grab
  const SAW_HEARD = 7.0;              // a hacksaw on steel carries this far
  const PORT_SEEN_HOLD = 4.0;         // seconds a sighting at a port blocks the win
  // what a shakedown takes: keys, tools, blades. Personal effects stay.
  const CONTRABAND = /key|card|lockpick|hacksaw|blade|shiv|shank|baton|knuckle|c4|charge|rope|saw|torch/i;

  const S = {
    grateCut: false,
    work: null,                 // {kind, t, need}
    portSeenT: 0, portSeenBy: "",
    lost: "", lostT: 0,
    had: {},                    // item -> bool, for the "you got it" beat
    deskTaken: false,
    deskTaking: false,          // the hand is on its way to the desk card
    refuseT: 0, pitchT: -1e9,
    lastEl: 0,
  };

  function escape() { return g.mode === "escape" && g.state === "playing" && g.role !== "cop"; }
  function econ() { return CBZ.econ; }
  function has(item) { const e = econ(); return !!(e && e.hasItem && e.hasItem(item)); }
  function short(name) { return String(name || "someone").replace(/^the |^a |^an /, ""); }
  function hint(t, secs) { if (CBZ.flashHint) { try { CBZ.flashHint(t, secs || 2.6); } catch (e) {} } }
  function sfx(n, o) { if (CBZ.sfx) { try { CBZ.sfx(n, o); } catch (e) {} } }
  function d2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

  // a screw who can act on what he sees: standing, awake, not bought, not held
  function upright(gd) {
    return !!(gd && gd.group && !gd.dead && !(gd.ko > 0) && !gd.asleep && !gd.tied &&
      !(gd.bribed > 0) && gd.intimidMode !== "scared");
  }
  // who is looking at the player right now (entities/guards.js's own cone,
  // crouch shrink, darkness and LOS)
  function seenBy() {
    if (!CBZ.guardSees) return null;
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) {
      const gd = list[i];
      if (!gd || !gd.group) continue;
      try { if (CBZ.guardSees(gd)) return gd; } catch (e) {}
    }
    return null;
  }
  function nearestUpright(x, z, r) {
    let best = null, bd = r * r;
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) {
      const gd = list[i];
      if (!upright(gd)) continue;
      const dd = d2(gd.group.position.x, gd.group.position.z, x, z);
      if (dd < bd) { bd = dd; best = gd; }
    }
    return best;
  }
  function gname(gd) { return short(gd && gd.data && gd.data.name) || "A guard"; }

  // a step done: a sound and a jolt, no caption (the plan shows it if asked)
  function beat(snd) {
    sfx(snd || "key");
    if (CBZ.shake) { try { CBZ.shake(0.12); } catch (e) {} }
    dirty = true;
  }

  /* ============================================================
     THE CARD. The bag is the truth; hasKey and the chip follow it.
     ============================================================ */
  function syncKey() {
    const have = has("Keycard");
    if (!!g.hasKey !== have) g.hasKey = have;
    const chip = CBZ.el && CBZ.el.keycard;
    if (chip && chip.classList.contains("have") !== have) chip.classList.toggle("have", have);
  }
  function grantKeycard() {
    const e = econ();
    if (!has("Keycard") && e && e.addItem) e.addItem("Keycard", 1);
    syncKey();
  }
  function deskCardShown(on) {
    const kc = CBZ.keycard;
    if (!kc) return;
    kc.collected = !on;
    if (kc.group) kc.group.visible = !!on;
    if (kc.ring) kc.ring.visible = !!on;
  }

  /* ============================================================
     WORK BEATS - the grate cut is a few seconds with your hands busy (the
     time IS the risk: loud, and anyone near hears it). A key press or a
     pill tap starts it; it runs while you stay at the grate (a touch
     screen cannot hold a pill, so staying put IS the hold) and stops the
     moment you walk off or somebody sees or hears you. Its progress is a
     hairline on the Cut pill over the grate, never a number.

     The desk card used to be one of these: 1.4 s of "Take 0%..99%" to lift
     a card off a desk. OWNER: "when I pick up a key card, if there's a
     loading 0 to 100% bar, that's really stupid." Picking a thing up is a
     grab. The risk that the timer stood for is kept where it belongs: take
     it while a screw has you in sight and he saw you steal it.
     ============================================================ */
  function startWork(kind) {
    if (S.work && S.work.kind === kind) return;
    S.work = { kind: kind, t: 0, need: WORK_NEED[kind] };
    sfx(kind === "grate" ? "rack" : "pickup", { volume: 0.5 });
    dirty = true;
  }
  function stopWork() { if (S.work) { S.work = null; dirty = true; } }

  function deskState() {
    const kc = CBZ.keycard;
    if (!kc || !kc.group || kc.collected || g.hasKey) return null;
    const p = kc.group.position;
    const officer = nearestUpright(p.x, p.z, DESK_ATTEND_R);
    return { at: { x: p.x, y: p.y + 0.3, z: p.z }, officer: officer, d2: d2(player.pos.x, player.pos.z, p.x, p.z) };
  }
  // The card is TAKEN WITH A HAND (systems/verbs_pickup.js): the hand goes to
  // the desk, closes on the card, and the card leaves the desk in it. The
  // take lands on the grab frame, which is also when a screw sees it or not.
  function deskTake() {
    const d = deskState();
    if (!d || d.d2 > DESK_REACH2 || S.deskTaking) return;
    if (d.officer) return;               // he is standing at it; you can see him
    S.deskTaking = true;
    const taken = function () {
      if (!S.deskTaking) return;         // a reset got here first
      S.deskTaking = false;
      if (S.deskTaken || !escape()) return;
      S.deskTaken = true;
      deskCardShown(false);
      grantKeycard();                    // the "Keycard" beat fires from the bag watcher
      sfx("pickup", { volume: 0.6 });
      if (seenBy()) {                    // lifted in plain sight: he comes for you
        if (CBZ.reportCrime) { try { CBZ.reportCrime(45, { type: "steal" }); } catch (e) {} }
        if (CBZ.addHeat) CBZ.addHeat(30);
      }
    };
    if (CBZ.verbs && CBZ.verbs.pickup) CBZ.verbs.pickup(player, CBZ.keycard.group, { pose: "card", onTaken: taken });
    else taken();
  }
  function grateCut() {
    const v = CBZ.culvertGrate;
    if (!v || S.grateCut) return;
    if (d2(player.pos.x, player.pos.z, v.x, v.z) > GRATE_REACH2) return;
    if (!has("Hacksaw Blade")) return;   // the prompt's own chip says "needs a blade"
    startWork("grate");
  }
  CBZ.escapePlanDesk = deskTake;
  CBZ.escapePlanCut = grateCut;
  (CBZ._prisonPromptSites || (CBZ._prisonPromptSites = [])).push(
    { id: "plan-desk", act: "@escapePlanDesk", was: "walk-over keycard pickup", now: "Take, over the desk card" },
    { id: "plan-grate", act: "@escapePlanCut", was: "free culvert crawl", now: "Cut, over the grate" }
  );

  function workTick(dt) {
    const w = S.work;
    if (!w) return;
    const at = CBZ.culvertGrate;
    if (!at || S.grateCut || !has("Hacksaw Blade")) { stopWork(); return; }
    if (d2(player.pos.x, player.pos.z, at.x, at.z) > GRATE_REACH2) { stopWork(); return; }
    // SEEN or HEARD = caught with your hands on it
    const who = seenBy() || nearestUpright(player.pos.x, player.pos.z, SAW_HEARD);
    if (who) {
      stopWork();
      if (CBZ.reportCrime) { try { CBZ.reportCrime(35, { type: "steal" }); } catch (e) {} }
      if (CBZ.addHeat) CBZ.addHeat(22);
      return;                            // he comes for you; that is the message
    }
    w.t += dt;
    if (CBZ.shake && (w.t % 0.5) < dt) { try { CBZ.shake(0.03); } catch (e) {} }
    if ((w.t % 0.9) < dt && CBZ.worldSfx) {
      try { CBZ.worldSfx("shell", at.x, at.z, { y: 0.3, ref: 5, volume: 0.5, gap: 0.3 }); } catch (e) {}
    }
    dirty = true;
    if (w.t < w.need) return;
    S.work = null;
    S.grateCut = true;
    if (at.grate) at.grate.set(true);
    beat("rack");
  }

  // the prompts on the desk and on the grate
  function promptTick() {
    if (!CBZ.prisonPrompt) return;
    const d = deskState();
    if (d && d.d2 < DESK_REACH2 && !d.officer && !S.deskTaking) {
      CBZ.prisonPrompt("plan-desk", "@escapePlanDesk", "Take", { at: d.at, d2: d.d2 });
      if (CBZ.keys && CBZ.keys.e) deskTake();
    }
    const v = CBZ.culvertGrate;
    if (v && !S.grateCut) {
      const dd = d2(player.pos.x, player.pos.z, v.x, v.z);
      if (dd < GRATE_REACH2) {
        CBZ.prisonPrompt("plan-grate", "@escapePlanCut", "Cut",
          { at: { x: v.x, y: 0.7, z: v.z }, d2: dd,
            sub: !has("Hacksaw Blade") ? "needs a blade" : "",
            prog: S.work && S.work.kind === "grate" ? S.work.t / S.work.need : 0 });
        if (CBZ.keys && CBZ.keys.e) grateCut();
      }
    }
  }

  /* ============================================================
     THE PORTS. Three sally ports (world/corridorkit.js), each on the Gate
     Key. Nobody may see you inside one: a sighting blocks the win for a
     few seconds and puts the whole prison on you.
     ============================================================ */
  function ports() {
    const ez = (CBZ.WORLD && CBZ.WORLD.exit && CBZ.WORLD.exit.z) || 128;
    return [
      { id: "prison-exit", label: "Gate 3", x: 0, z: ez, back: 15 },
      { id: "prison-exit-w", label: "Gate 1", x: -50, z: ez, back: 1 },
      { id: "prison-exit-e", label: "Gate 4", x: 50, z: ez, back: 1 },
    ];
  }
  function inPort() {
    const P = ports();
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (Math.abs(player.pos.x - p.x) < 5.2 && player.pos.z > p.z - 7 - p.back && player.pos.z < p.z + 7) return p;
    }
    return null;
  }
  let portCheckT = 0;
  function portTick(dt) {
    if (S.portSeenT > 0) S.portSeenT = Math.max(0, S.portSeenT - dt);
    if ((portCheckT -= dt) > 0) return;
    portCheckT = 0.1;
    const p = inPort();
    if (!p) return;
    const who = seenBy();
    if (!who) return;
    const first = S.portSeenT <= 0;
    S.portSeenT = PORT_SEEN_HOLD;
    S.portSeenBy = gname(who);
    if (first) {
      if (CBZ.reportCrime) { try { CBZ.reportCrime(50, { type: "escape" }); } catch (e) {} }
      if (CBZ.addHeat) CBZ.addHeat(35);
      dirty = true;
    }
  }
  function gateOfficer() {
    const list = CBZ.guards || [];
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].post === "gate") return list[i];
    return null;
  }

  /* ============================================================
     THE ASKS interactions.js makes before a crawl and before a win.
     ============================================================ */
  // may this vent be offered at all (false = the plan owns its prompt)
  function ventOpen(vent) {
    if (!vent || !vent.culvert) return true;
    return S.grateCut;
  }
  // the crawl itself: the culvert only goes unseen
  function mayCrawl(vent) {
    if (!vent || !vent.culvert) return true;
    if (!S.grateCut) return false;
    const who = seenBy();
    if (!who) return true;
    if (S.refuseT <= 0) {
      S.refuseT = 2.5;
      if (CBZ.reportCrime) { try { CBZ.reportCrime(30, { type: "escape" }); } catch (e) {} }
      hint("Not while he's watching.", 1.8);
    }
    return false;
  }
  function mayWin(kind, zone) {
    if (!escape()) return true;
    if (kind === "culvert") return S.grateCut;
    // a gate: nobody may have you in sight
    if (S.portSeenT > 0 || seenBy()) {
      if (S.refuseT <= 0) { S.refuseT = 2.5; hint("Not while they're watching.", 1.8); }
      return false;
    }
    return true;
  }

  /* ============================================================
     THE FIXER. systems/quests.js asks this first when you Talk to the Old
     Timer. He sells what the plan is missing, for cigs you earned.
     ============================================================ */
  function isFixer(actor) {
    return !!(actor && actor.kind !== "guard" && actor.kind !== "warden" && actor.role === "merchant" &&
      actor.data && actor.data.name === "the Old Timer");
  }
  function fixerWant() {
    if (!g.hasKey) return "Keycard";
    if (!S.grateCut && !has("Hacksaw Blade")) return "Hacksaw Blade";
    return null;
  }
  function fixerTalk(actor) {
    if (!escape() || !isFixer(actor)) return null;
    const item = fixerWant();
    if (!item) return null;
    const price = PRICE[item];
    const e = econ();
    if ((g.cigs || 0) >= price && e) {
      e.addCigs(-price);
      e.addItem(item, 1);
      if (CBZ.pickupNote) { try { CBZ.pickupNote(item); } catch (er) {} }
      sfx("coin");
      if (item === "Keycard") syncKey();
      return { ok: true, msg: item === "Keycard" ? "You didn't get it from me." : "Saw slow. Not near a screw." };
    }
    // the pitch, once in a while; otherwise he is his normal self
    const now = (g.elapsed || 0);
    if (now - S.pitchT < 40) return null;
    S.pitchT = now;
    return { ok: true, msg: item === "Keycard" ? "Staff card. " + PRICE_WORD[price] + " smokes." : "A blade. " + PRICE_WORD[price] + " smokes." };
  }

  /* ============================================================
     STAKES. capture.js calls confiscate() on a shakedown strike and
     noteTransferLoss() right before a transfer.
     ============================================================ */
  function contrabandHeld() {
    const inv = g.inventory || {};
    const out = [];
    for (const k in inv) if ((inv[k] | 0) > 0 && CONTRABAND.test(k) && k !== "Gun") out.push(k);
    return out;
  }
  function showLost(text) {
    S.lost = text; S.lostT = 30;
    hint(text, 2.6);
    dirty = true;
  }
  function confiscate() {
    if (g.mode !== "escape" || g.role === "cop") return [];
    const items = contrabandHeld();
    const inv = g.inventory || {};
    for (let i = 0; i < items.length; i++) inv[items[i]] = 0;
    if (items.length) {
      if (CBZ.prisonSyncShank) { try { CBZ.prisonSyncShank(); } catch (e) {} }
      if (CBZ.refreshInventory) { try { CBZ.refreshInventory(); } catch (e) {} }
    }
    stopWork();
    syncKey();
    const parts = [];
    if (items.length) parts.push("They took your " + items.join(", ") + ".");
    if (S.grateCut) {
      S.grateCut = false;
      if (CBZ.culvertGrate && CBZ.culvertGrate.grate) CBZ.culvertGrate.grate.set(false);
      parts.push("The grate is welded again.");
    }
    if (S.deskTaken) { S.deskTaken = false; deskCardShown(true); }
    for (const k in S.had) S.had[k] = has(k);
    if (parts.length) showLost(parts.join(" "));
    return items;
  }
  function noteTransferLoss() {
    const items = contrabandHeld();
    g._planLostIn = items.length ? "Reception took your " + items.join(", ") + "." : "";
  }

  /* ============================================================
     RESET (systems/state.js calls this on every new escape run)
     ============================================================ */
  function reset() {
    S.grateCut = false; S.work = null; S.portSeenT = 0; S.portSeenBy = "";
    if (S.deskTaking && CBZ.verbs && CBZ.verbs.pickupOf) { const pk = CBZ.verbs.pickupOf(player); if (pk && pk.abort) pk.abort(); }
    S.lost = ""; S.lostT = 0; S.deskTaken = false; S.deskTaking = false; S.refuseT = 0; S.pitchT = -1e9;
    S.had = {};
    if (CBZ.culvertGrate && CBZ.culvertGrate.grate) CBZ.culvertGrate.grate.set(false);
    if (g._planLostIn) { const t = g._planLostIn; g._planLostIn = ""; setTimeout(function () { showLost(t); }, 1500); }
    dirty = true;
  }

  // the items the plan watches for: the arrival is a sound, the item is in
  // your hand, and the plan (when opened) ticks the step
  const WATCH = ["Keycard", "Gate Key", "Hacksaw Blade"];
  function bagTick() {
    for (let i = 0; i < WATCH.length; i++) {
      const w = [WATCH[i]];
      const now = has(w[0]);
      if (now && !S.had[w[0]]) beat(w[0] === "Hacksaw Blade" ? "loot" : "key");
      if (now !== !!S.had[w[0]]) dirty = true;
      S.had[w[0]] = now;
    }
  }

  /* ============================================================
     THE PLAN, CLOSED UNTIL ASKED FOR.

     Owner, 2026-09-27: show don't tell; nothing on screen unless the
     player opens it. The panel used to sit top-left for the whole run
     (clock, three routes, a lost-items line). Now it is closed by default
     with NOTHING on screen, and opens on P (keyboard) or the small Plan
     button (touch, the one pill left on a touch prison screen). Open, it is
     also where the things the bare HUD dropped live: the clock and the
     block, the cigs, and buttons for the Map and the Ranks (the minimap
     tap and the Ranks pill were their only touch routes). On touch it
     carries Pause too, since a tablet has no Esc.
     ============================================================ */
  const BLOCK_WORDS = {
    wake: "Morning count",
    yard: "Yard",
    mess: "Chow",
    work: "Work detail",
    supper: "Evening chow",
    count: "Count",
    secure: "Lockup",
    night: "Lights out",
  };
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function clockParts() {
    const P = CBZ.prisonSchedule;
    if (!P || !P.enabled || !P.enabled()) return null;
    const c = P.clock();
    const id = P.id();
    const u = Math.max(0, Math.ceil(P.until ? P.until() : 0));
    return { now: pad(c.h) + ":" + pad(c.m) + "  " + (BLOCK_WORDS[id] || String(id)),
      until: Math.floor(u / 60) + ":" + pad(u % 60) + " left" };
  }

  function gateRoute() {
    const card = g.hasKey || has("Gate Key");
    const key = has("Gate Key");
    let next;
    if (!card) next = "Keycard: the block desk, a screw's belt, or the Old Timer";
    else if (!key) next = "Gate Key: the gate booth, or the gate officer";
    else {
      const o = gateOfficer();
      next = (!o || !upright(o)) ? "Gate 3 is open. Walk out" : "Slip a gate unseen";
    }
    return { id: "gate", name: "Gate", steps: [card, key, false], next: next };
  }
  function culvertRoute() {
    const blade = S.grateCut || has("Hacksaw Blade");
    let next;
    if (!blade) next = "A blade: the workshop bench, or the Old Timer";
    else if (!S.grateCut) next = "Cut the grate in the yard ditch";
    else next = "Crawl out when nobody watches the ditch";
    return { id: "culvert", name: "Culvert", steps: [blade, S.grateCut, false], next: next };
  }
  function favourRoute() {
    let best = null, br = 0;
    const lists = [CBZ.npcs || [], CBZ.guards || []];
    for (let l = 0; l < lists.length; l++) {
      for (let i = 0; i < lists[l].length; i++) {
        const a = lists[l][i];
        if (!a || a.dead || a._crowd || !a.data) continue;
        const r = a.rep || 0;
        if (r > br) { br = r; best = a; }
      }
    }
    const F = (CBZ.quests && CBZ.quests.FRIEND) || 100;
    const ready = br >= F;
    const next = ready ? short(best.data.name) + " can walk you out"
      : (best && br > 0 ? "Keep working for " + short(best.data.name) : "Somebody who owes you");
    return { id: "favour", name: "Favours", steps: null, frac: Math.min(1, br / F), next: next, ready: ready };
  }

  let panel = null, dirty = true, panelT = 0, btn = null, open = false;
  function onTouch() { return !!(CBZ.touchMode || (document.body && document.body.classList.contains("touch"))); }
  function ensureCss() {
    if (document.getElementById("escapePlanCss")) return;
    const st = document.createElement("style");
    st.id = "escapePlanCss";
    st.textContent = [
      "#escapePlan{position:fixed;left:calc(14px + env(safe-area-inset-left,0px));top:calc(14px + env(safe-area-inset-top,0px));width:min(300px,78vw);padding:10px 12px 10px;font-size:13px;line-height:1.28;display:none;pointer-events:auto;z-index:29;}",
      "body.escape-plan-live.escape-plan-open #escapePlan{display:block;}",
      "#escapePlan .ep-top{display:flex;justify-content:space-between;gap:8px;white-space:pre;font-weight:700;color:#ffd451;font-variant-numeric:tabular-nums;margin-bottom:4px;}",
      "#escapePlan .ep-sub{opacity:.7;font-weight:600;}",
      "#escapePlan .ep-route{margin-top:6px;padding:2px 4px;margin-left:-4px;margin-right:-4px;border-radius:6px;}",
      "#escapePlan .ep-marks{display:inline-flex;gap:4px;align-items:center;}",
      "#escapePlan .ep-head{display:flex;align-items:center;gap:6px;font-weight:700;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#ffb35c;}",
      "#escapePlan .ep-box{display:inline-block;width:9px;height:9px;border:2px solid rgba(255,255,255,.55);border-radius:2px;}",
      "#escapePlan .ep-box.on{background:#39ff88;border-color:#39ff88;}",
      "#escapePlan .ep-bar{display:inline-block;width:54px;height:6px;border-radius:3px;background:rgba(255,255,255,.18);overflow:hidden;}",
      "#escapePlan .ep-bar i{display:block;height:100%;background:#39ff88;}",
      "#escapePlan .ep-next{font-size:12.5px;opacity:.93;margin-top:1px;}",
      "#escapePlan .ep-route.ready .ep-head{color:#39ff88;}",
      "#escapePlan .ep-lost{margin-top:6px;color:#ff8e8e;font-weight:600;font-size:12.5px;}",
      "#escapePlan .ep-btns{display:flex;gap:8px;margin-top:9px;flex-wrap:wrap;}",
      "#escapePlan .ep-btns button{font:600 13px/1 Fredoka,system-ui,sans-serif;color:#e8ecf2;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.22);border-radius:9px;padding:8px 12px;min-height:34px;cursor:pointer;}",
      "#escapePlan .ep-btns button:active{transform:translateY(1px);}",
      "#planBtn{position:fixed;left:calc(14px + env(safe-area-inset-left,0px));top:calc(14px + env(safe-area-inset-top,0px));z-index:29;display:none;font:600 12px/1 Fredoka,system-ui,sans-serif;letter-spacing:.6px;color:rgba(232,236,242,.82);background:rgba(8,11,17,.42);border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:8px 13px;pointer-events:auto;}",
      "body.touch.escape-plan-live:not(.escape-plan-open) #planBtn{display:block;}",
      "body.full-map-open #escapePlan,body.full-map-open #planBtn,body.sim-view #planBtn{display:none!important;}",
    ].join("\n");
    document.head.appendChild(st);
  }
  function ensurePanel() {
    if (panel && panel.parentNode) return panel;
    ensureCss();
    panel = document.createElement("div");
    panel.id = "escapePlan";
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Escape plan");
    panel.innerHTML =
      '<div class="ep-top"><span class="ep-now"></span><span class="ep-sub ep-cigs"></span></div>' +
      '<div class="ep-routes"></div><div class="ep-lost"></div>' +
      '<div class="ep-btns"><button type="button" data-ep="map">Map</button>' +
      '<button type="button" data-ep="ranks">Ranks</button>' +
      '<button type="button" data-ep="pause" class="ep-pause">Pause</button>' +
      '<button type="button" data-ep="close">Close</button></div>';
    document.body.appendChild(panel);
    panel.addEventListener("click", function (e) {
      const b = e.target && e.target.closest ? e.target.closest("[data-ep]") : null;
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const act = b.getAttribute("data-ep");
      if (act === "close") setOpen(false);
      else if (act === "map") { setOpen(false); if (CBZ.fullMap && CBZ.fullMap.toggle) CBZ.fullMap.toggle(); }
      else if (act === "ranks") { setOpen(false); if (CBZ.dashboardCycle) CBZ.dashboardCycle(); }
      else if (act === "pause") { setOpen(false); if (CBZ.setState) CBZ.setState("paused"); }
    });
    return panel;
  }
  function ensureBtn() {
    if (btn && btn.parentNode) return btn;
    ensureCss();
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "planBtn";
    btn.textContent = "Plan";
    btn.setAttribute("aria-label", "Open the escape plan");
    btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); setOpen(true); });
    document.body.appendChild(btn);
    return btn;
  }
  function setOpen(on) {
    on = !!on;
    if (on === open) return;
    open = on;
    if (on) { ensurePanel(); dirty = true; panelT = 0; }
    document.body.classList.toggle("escape-plan-open", on);
  }
  addEventListener("keydown", function (e) {
    if (e.repeat || !live) return;
    const k = (e.key || "").toLowerCase();
    if (k === "p" && !e.ctrlKey && !e.metaKey && !e.altKey) { setOpen(!open); return; }
    if (k === "escape" && open) setOpen(false);
  });

  // Persistent rows, updated in place.
  const rows = {};
  let nowEl = null, cigEl = null, routesEl = null, lostEl = null, pauseEl = null;
  function setText(node, t) { if (node && node.textContent !== t) node.textContent = t; }
  function setCls(node, c, on) { if (node && node.classList.contains(c) !== !!on) node.classList.toggle(c, !!on); }
  function row(id) {
    if (rows[id]) return rows[id];
    const root = document.createElement("div");
    root.className = "ep-route";
    const head = document.createElement("div");
    head.className = "ep-head";
    const name = document.createElement("span");
    const marks = document.createElement("span");
    marks.className = "ep-marks";
    head.appendChild(name); head.appendChild(marks);
    const next = document.createElement("div");
    next.className = "ep-next";
    root.appendChild(head); root.appendChild(next);
    routesEl.appendChild(root);
    return (rows[id] = { root: root, name: name, marks: marks, next: next, sig: "" });
  }
  function render() {
    const p = ensurePanel();
    if (!p) return;
    if (!nowEl) {
      nowEl = p.querySelector(".ep-now"); cigEl = p.querySelector(".ep-cigs");
      routesEl = p.querySelector(".ep-routes"); lostEl = p.querySelector(".ep-lost");
      pauseEl = p.querySelector(".ep-pause");
    }
    const c = clockParts();
    const t = CBZ.fmtTime ? CBZ.fmtTime(g.elapsed || 0) : "";
    setText(nowEl, c ? c.now : t);
    setText(cigEl, (g.cigs || 0) + " cigs");
    pauseEl.style.display = onTouch() ? "" : "none";
    routesEl.style.display = g.role === "cop" ? "none" : "";
    const routes = [gateRoute(), culvertRoute(), favourRoute()];
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i], R = row(r.id);
      let sig, html;
      if (r.steps) {
        let done = 0; html = "";
        for (let k = 0; k < r.steps.length; k++) { if (r.steps[k]) done++; html += '<span class="ep-box' + (r.steps[k] ? " on" : "") + '"></span>'; }
        r.ready = done === r.steps.length - 1;
        sig = html;
      } else {
        const w = Math.round(r.frac * 100);
        html = '<span class="ep-bar"><i style="width:' + w + '%"></i></span>';
        sig = "b" + w;
      }
      if (R.sig !== sig) { R.marks.innerHTML = html; R.sig = sig; }
      setText(R.name, r.name);
      setText(R.next, r.next);
      setCls(R.root, "ready", r.ready);
    }
    const lostOn = S.lostT > 0 && !!S.lost;
    lostEl.style.display = lostOn ? "" : "none";
    if (lostOn) setText(lostEl, S.lost);
  }

  let live = false;
  function setLive(on) {
    if (on === live) return;
    live = on;
    document.body.classList.toggle("escape-plan-live", on);
    if (on) ensureBtn();
    else setOpen(false);
  }

  /* ============================================================
     THE TICK. Order 40.5: after interactions.js (40), before the door
     latch sweep (41.46).
     ============================================================ */
  CBZ.onUpdate(40.5, function (dt) {
    if (!escape()) { stopWork(); return; }
    // a new run without state.js having told us (a --reset probe, a mode
    // that re-enters): the clock falling back is the shared signal
    const el = g.elapsed || 0;
    if (el + 0.001 < S.lastEl) reset();
    S.lastEl = el;
    if (S.refuseT > 0) S.refuseT -= dt;
    syncKey();
    bagTick();
    workTick(dt);
    promptTick();
    portTick(dt);
    if (S.lostT > 0) { S.lostT -= dt; if (S.lostT <= 0) dirty = true; }
  });

  // the panel runs on the always loop (it must hide on pause / death / city)
  CBZ.onAlways(72, function (dt) {
    // live for EVERY prison role: a cop has no routes, but the plan is also
    // where the clock, the map and the rankings are now
    setLive(g.mode === "escape" && g.state === "playing");
    if (!live || !open) return;
    panelT -= dt;
    if (panelT > 0 && !dirty) return;
    panelT = 0.25;
    dirty = false;
    render();
  });

  CBZ.escapePlan = {
    reset: reset,
    ventOpen: ventOpen,
    mayCrawl: mayCrawl,
    mayWin: mayWin,
    fixerTalk: fixerTalk,
    confiscate: confiscate,
    noteTransferLoss: noteTransferLoss,
    grantKeycard: grantKeycard,
    state: S,
    isOpen: function () { return open; },
    open: function (on) { setOpen(on == null ? true : !!on); },
    // what the panel says right now, and the facts behind it (probes)
    audit: function () {
      const d = deskState();
      return {
        routes: [gateRoute(), culvertRoute(), favourRoute()].map(function (r) { return { id: r.id, steps: r.steps, next: r.next }; }),
        hasKey: !!g.hasKey, gateKey: has("Gate Key"), blade: has("Hacksaw Blade"), grateCut: S.grateCut,
        work: S.work ? { kind: S.work.kind, t: +S.work.t.toFixed(2) } : null,
        desk: d ? { officer: d.officer ? gname(d.officer) : null, d: +Math.sqrt(d.d2).toFixed(1) } : null,
        portSeenT: +S.portSeenT.toFixed(2), inPort: (inPort() || {}).label || null,
        seenBy: (function () { const w = seenBy(); return w ? gname(w) : null; })(),
        panel: !!(panel && panel.parentNode && open), open: open, lost: S.lost,
        clock: clockParts(),
      };
    },
  };
})();
