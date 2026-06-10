/* ============================================================
   city/hud.js — the CITY heads-up display: cash, the 5-star wanted
   meter, health / hunger / stamina bars, equipped weapon + ammo, and
   the active-job objective line with distance. Self-contained overlay
   shown only in city mode (prison/survival HUD is hidden via .mode-city).

   GTA-clean pass: money flashes a +/- delta on change, the wanted meter
   only shows when you HAVE a level (and flashes while heat is rising),
   the radar got a circular framed look with a compass tick + your-car +
   crew + cop-direction blips + a speedometer when driving, and a tidy
   city event feed (CBZ.cityFeed) stacks recent street events down the
   left without fighting the engine's global toast.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  let root, cashEl, deltaEl, starsEl, starsWrap, hpBar, hungerBar, stamBar, wpnEl, jobEl, crewEl, worldEl, radar, turfEl, homeLineEl, feedEl, speedEl;
  let slotsEl, ammoLineEl, lootEl;   // weapon hotbar (slots + ammo) + carried-loot row
  let objEl, objTxtEl, objRouteEl, objSlotEl, objFillEl;   // gang-join objective line
  let popEl, popBarEl, killEl;
  // wave-5 depth surfaces (all contextual — hidden unless currently relevant)
  let turfPayEl;            // tiny "+$x/min" tag under the money readout
  let dripEl;               // ✨ DRIP status readout (CBZ.cityPlayerDrip) — the club gate feedback
  let membEl, membFillEl;   // gang-membership badge + its promotion sliver
  let relEl;                // single-ped relationship chip (aim/near target)
  let postWrap, postYouEl, postFoeEl, postFoeNameEl;  // melee posture bars
  let dirty = true;

  function build() {
    if (root) return;
    // one-time keyframes for the money pulse + delta float (cheap, GPU-friendly)
    if (!document.getElementById("cHudCss")) {
      const st = document.createElement("style");
      st.id = "cHudCss";
      st.textContent =
        "@keyframes cMoneyPulse{0%{transform:scale(1)}35%{transform:scale(1.14)}100%{transform:scale(1)}}" +
        "@keyframes cDeltaUp{0%{opacity:0;transform:translateY(6px)}18%{opacity:1}100%{opacity:0;transform:translateY(-16px)}}" +
        "@keyframes cStarFlash{0%,100%{opacity:1}50%{opacity:.35}}" +
        "@keyframes cFeedIn{0%{opacity:0;transform:translateX(-14px)}100%{opacity:1;transform:translateX(0)}}" +
        "@keyframes cKillIn{0%{opacity:0;transform:translateX(12px)}100%{opacity:1;transform:translateX(0)}}" +
        "@keyframes cPopPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}" +
        "#cHud .cPanel{background:rgba(10,13,20,.42);border:1px solid rgba(255,255,255,.10);border-radius:10px;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}" +
        "#cHud .cFeedRow{animation:cFeedIn .22s ease-out;background:rgba(8,11,17,.55);border-left:3px solid #7ed957;border-radius:4px;padding:4px 9px;margin-top:5px;color:#e8eef7;font-size:13px;line-height:1.25;max-width:300px;box-shadow:0 2px 6px rgba(0,0,0,.35)}" +
        // population headcount pill — the battle-royale-style live count
        "#cHud .cPop{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:9px;background:rgba(8,11,17,.55);border:1px solid rgba(255,255,255,.10);box-shadow:0 2px 8px rgba(0,0,0,.4)}" +
        "#cHud .cPop .dot{width:8px;height:8px;border-radius:50%;background:#ff5b5b;box-shadow:0 0 7px rgba(255,91,91,.8)}" +
        "#cHud .cPop b{font-size:18px;font-weight:700;color:#fff;letter-spacing:.4px}" +
        "#cHud .cPop .tot{font-size:12px;color:#8a93a3}" +
        "#cHud .cPopBar{height:4px;border-radius:3px;background:rgba(255,255,255,.10);overflow:hidden;margin-top:4px}" +
        "#cHud .cPopBar>i{display:block;height:100%;background:linear-gradient(90deg,#ff5b5b,#ffb36b);transition:width .4s ease}" +
        // hud-local kill feed (fallback when turf.js's feed isn't mounted)
        "#cHud .cKillRow{animation:cKillIn .2s ease-out;background:rgba(8,11,17,.6);border-right:3px solid #c33;border-radius:4px;padding:2px 9px;margin-top:4px;color:#dfe6f0;font-size:12px;line-height:1.3;text-align:right;box-shadow:0 2px 6px rgba(0,0,0,.4)}" +
        "#cHud .cKillRow b{color:#fff}" +
        "#cHud .cKillRow.you{border-right-color:#ffd166;background:rgba(40,30,8,.7)}" +
        // --- wave-5 depth surfaces: gang badge, turf-pay tag, rel chip, posture ---
        // turf passive-income tag — a thin green "+$x/min" right under the money.
        "#cHud .cTurfPay{display:inline-flex;align-items:center;gap:4px;margin-top:2px;padding:1px 7px;border-radius:7px;background:rgba(8,11,17,.5);font-size:12px;font-weight:600;color:#7ed957;text-shadow:0 1px 2px rgba(0,0,0,.6)}" +
        // gang-membership badge: a small chip with the gang colour, your rank, and
        // a hair-thin promotion sliver toward the next rung. Hidden when unaffiliated.
        "#cHud .cMemb{display:inline-flex;flex-direction:column;gap:3px;padding:5px 9px;border-radius:9px;background:rgba(8,11,17,.55);border:1px solid rgba(255,255,255,.10);box-shadow:0 2px 8px rgba(0,0,0,.4);max-width:200px}" +
        "#cHud .cMemb .row{display:flex;align-items:center;gap:6px;font-size:12px;line-height:1.1;white-space:nowrap}" +
        "#cHud .cMemb .gdot{width:9px;height:9px;border-radius:50%;flex:none;box-shadow:0 0 6px rgba(0,0,0,.5)}" +
        "#cHud .cMemb .gnm{font-weight:700;color:#fff;letter-spacing:.3px;overflow:hidden;text-overflow:ellipsis;max-width:118px}" +
        "#cHud .cMemb .rnk{color:#ffd451;font-weight:700}" +
        "#cHud .cMemb .pslot{height:3px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden}" +
        "#cHud .cMemb .pslot>i{display:block;height:100%;background:linear-gradient(90deg,#ffd451,#7ed957);transition:width .4s ease}" +
        // single-ped relationship chip (contextual to the ONE ped you target)
        "#cHud .cRel{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:10px;background:rgba(8,11,17,.6);border:1px solid rgba(255,255,255,.10);font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.45);white-space:nowrap}" +
        "#cHud .cRel .nm{color:#cdd6e2;font-weight:600;max-width:120px;overflow:hidden;text-overflow:ellipsis}" +
        "#cHud .cRel .lab{font-weight:700}" +
        // melee posture bars (you vs current foe) — slim, only during a fight
        "#cHud .cPost{display:flex;flex-direction:column;gap:5px;padding:6px 10px;border-radius:10px;background:rgba(8,11,17,.55);border:1px solid rgba(255,255,255,.10);box-shadow:0 2px 8px rgba(0,0,0,.45);min-width:150px}" +
        "#cHud .cPost .lbl{font-size:10px;font-weight:700;letter-spacing:.6px;color:#9fb0c6;display:flex;justify-content:space-between;align-items:baseline}" +
        "#cHud .cPost .pbar{height:6px;border-radius:4px;background:rgba(255,255,255,.10);overflow:hidden}" +
        "#cHud .cPost .pbar>i{display:block;height:100%;transition:width .12s linear}" +
        "#cHud .cPost .you>i{background:linear-gradient(90deg,#39c0d0,#7fe0ff)}" +
        "#cHud .cPost .foe>i{background:linear-gradient(90deg,#ff8b3c,#ffd166)}" +
        "#cHud .cPost .brk>i{background:linear-gradient(90deg,#ff5b5b,#ff9e6b)!important;animation:cStarFlash .5s steps(1,end) infinite}" +
        // --- WEAPON HOTBAR (bottom-right): jail-clear loadout. A row of slots, one
        // per OWNED gun (+ a Fists slot when unarmed), the held one lit, with the
        // engine's live mag/reserve ammo for the equipped weapon underneath. ------
        "#cHud .cBar{display:flex;flex-direction:column;align-items:center;gap:5px}" +
        "#cHud .cSlots{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;max-width:560px}" +
        "#cHud .cSlot{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:46px;height:42px;padding:3px 7px;border-radius:9px;background:rgba(8,11,17,.55);border:1px solid rgba(255,255,255,.12);box-shadow:0 2px 8px rgba(0,0,0,.4)}" +
        "#cHud .cSlot .s{font-size:14px;font-weight:700;color:#cdd6e2;line-height:1.1;letter-spacing:.3px}" +
        "#cHud .cSlot .a{font-size:10px;color:#8a93a3;line-height:1.1;margin-top:1px}" +
        "#cHud .cSlot.held{background:rgba(40,52,30,.78);border-color:#7ed957;box-shadow:0 0 0 1px rgba(126,217,87,.5),0 2px 10px rgba(0,0,0,.5)}" +
        "#cHud .cSlot.held .s{color:#fff;text-shadow:0 0 8px rgba(126,217,87,.55)}" +
        "#cHud .cSlot.held .a{color:#bfe9a3}" +
        "#cHud .cSlot.melee.held{background:rgba(52,40,30,.78);border-color:#ffb37a;box-shadow:0 0 0 1px rgba(255,179,122,.5),0 2px 10px rgba(0,0,0,.5)}" +
        "#cHud .cSlot.melee.held .s{text-shadow:0 0 8px rgba(255,179,122,.55)}" +
        // the equipped-weapon ammo line under the slots: big mag / reserve, jail-style.
        "#cHud .cAmmo{font-size:13px;color:#e8eef7;font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,.7)}" +
        "#cHud .cAmmo b{font-size:20px;color:#fff;font-weight:700}" +
        "#cHud .cAmmo .res{color:#9fb0c6;font-weight:600}" +
        "#cHud .cAmmo .rl{color:#ffd166}" +
        "#cHud .cAmmo .arm{color:#7fd0ff}" +
        // --- carried LOOT readout (bottom-right, above the hotbar): drugs / valuables
        // / consumables you're holding, with counts. Compact chips; hidden when empty.
        "#cHud .cLoot{display:flex;gap:5px;justify-content:center;flex-wrap:wrap;max-width:520px;margin-bottom:1px}" +
        "#cHud .cLoot .it{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:8px;background:rgba(8,11,17,.5);border:1px solid rgba(255,255,255,.10);font-size:12px;color:#dfe6f0;box-shadow:0 1px 5px rgba(0,0,0,.35)}" +
        "#cHud .cLoot .it b{color:#fff;font-weight:700}" +
        "#cHud .cLoot .it .x{color:#8a93a3;font-weight:600}" +
        // coordinate with turf.js's overlays (loaded BEFORE us): nudge its kill
        // feed down so it clears our top-right money/pop stack, and cap its width
        // so a long name never reaches the centre. One cohesive, non-overlapping HUD.
        "#cKillFeed{top:230px !important;width:212px !important}";
      document.head.appendChild(st);
    }
    root = document.createElement("div");
    root.id = "cityHud";
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:20;display:none;font-family:Fredoka,system-ui,sans-serif";
    root.innerHTML =
      "<div id='cHud' style='position:absolute;inset:0'>" +
      // top-right stack — dropped to top:54px so it never collides with the
      // takeover meta bar (turf.js #cTurfMeta sits at top:6px, ~48px tall).
      "<div style='position:absolute;top:54px;right:16px;text-align:right;max-width:248px'>" +
      "  <div class='cPop' id='cPop' style='display:none'><span class='dot'></span><b id='cPopN'>0</b><span class='tot' id='cPopTot'></span></div>" +
      "  <div class='cPopBar' id='cPopBar' style='display:none;width:148px;margin-left:auto'><i style='width:100%'></i></div>" +
      "  <div style='position:relative;display:inline-block;margin-top:6px'>" +
      "    <div id='cMoney' style='font-size:32px;font-weight:700;color:#7ed957;text-shadow:0 2px 0 #1f5a2a,0 0 14px rgba(126,217,87,.35)'>$0</div>" +
      "    <div id='cDelta' style='position:absolute;right:0;top:-6px;font-size:18px;font-weight:700;opacity:0;pointer-events:none'></div>" +
      "  </div>" +
      "  <div id='cTurfPay' class='cTurfPay' style='display:none'></div>" +
      "  <div id='cStarsWrap' style='display:none;margin-top:4px;padding:2px 8px;border-radius:8px;background:rgba(8,11,17,.5)'><span id='cStars' style='font-size:23px;letter-spacing:3px'></span></div>" +
      "  <div id='cCrew' style='font-size:13px;color:#9fb0c6;margin-top:3px'></div>" +
      // YOUR street read (level.js): the same LEVEL N the city floats over
      // everyone else's head, derived live from worth/heat/crew/bodies.
      "  <div id='cLvl' style='font-size:14px;font-weight:800;color:#fff;letter-spacing:1px;margin-top:2px;text-shadow:0 1px 3px rgba(0,0,0,.6)'></div>" +
      // DRIP readout — your visible STATUS (CBZ.cityPlayerDrip): the club's gate.
      // Tints green once you clear CLUB_DRIP, gold at VIP. Self-hides if drip is
      // unavailable. Teaches the player that dressing up (clothes) opens the rope.
      "  <div id='cDrip' style='font-size:13px;font-weight:700;color:#9fb0c6;margin-top:2px'></div>" +
      "  <div id='cWorld' style='font-size:12px;color:#ffd166;margin-top:2px'></div>" +
      "  <div id='cKill' style='margin-top:7px;display:none'></div>" +
      "</div>" +
      "<div style='position:absolute;left:16px;bottom:16px;width:230px'>" +
      "  <div style='font-size:11px;color:#ffb3b3;font-weight:600;letter-spacing:.5px'>HEALTH</div><div style='height:12px;background:rgba(0,0,0,.45);border-radius:6px;overflow:hidden;margin-bottom:5px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)'><div id='cHp' style='height:100%;width:100%;background:linear-gradient(90deg,#ff5b5b,#ff9e6b);transition:width .12s linear'></div></div>" +
      "  <div style='font-size:11px;color:#ffd9a8;font-weight:600;letter-spacing:.5px'>FOOD</div><div style='height:12px;background:rgba(0,0,0,.45);border-radius:6px;overflow:hidden;margin-bottom:5px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)'><div id='cFood' style='height:100%;width:100%;background:linear-gradient(90deg,#e8a23c,#ffd166)'></div></div>" +
      "  <div style='font-size:11px;color:#a8e0ff;font-weight:600;letter-spacing:.5px'>STAMINA</div><div style='height:8px;background:rgba(0,0,0,.45);border-radius:5px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)'><div id='cStam' style='height:100%;width:100%;background:linear-gradient(90deg,#39c0d0,#7fe0ff)'></div></div>" +
      "</div>" +
      // WEAPON HOTBAR + carried-loot readout (bottom-right). The hotbar is the
      // jail-clarity loadout: every gun you OWN as a slot, the held one lit, live
      // mag/reserve underneath. The loot row sits just above it.
      "<div id='cWpn' class='cBar' style='position:absolute;left:50%;bottom:14px;transform:translateX(-50%)'>" +
      "  <div id='cLoot' class='cLoot' style='display:none'></div>" +
      "  <div id='cSlots' class='cSlots'></div>" +
      "  <div id='cAmmo' class='cAmmo'></div>" +
      "</div>" +
      "<div id='cSpeed' style='position:absolute;right:16px;bottom:74px;text-align:right;color:#e8eef7;display:none'><span id='cSpeedN' style='font-size:30px;font-weight:700;text-shadow:0 2px 4px rgba(0,0,0,.6)'>0</span><span style='font-size:12px;color:#9fb0c6'> mph</span></div>" +
      "<div id='cJob' class='cPanel' style='position:absolute;top:14px;left:50%;transform:translateX(-50%);text-align:center;color:#ffd166;font-size:14px;max-width:60%;padding:5px 14px;display:none'></div>" +
      // OBJECTIVE line — the active gang-join task when no city job is running. A
      // one-tap [ROUTE] affordance (pointer-events:auto) drops an HQ waypoint, and a
      // thin prospect-standing fill mirrors renderMemb/renderRel styling.
      "<div id='cObj' class='cPanel' style='position:absolute;top:14px;left:50%;transform:translateX(-50%);text-align:center;color:#ffd166;font-size:14px;max-width:62%;padding:5px 14px;display:none'>" +
      "  <span id='cObjTxt'></span> <span id='cObjRoute' style='pointer-events:auto;cursor:pointer;color:#7de7ff;font-weight:700;margin-left:6px'>↳ ROUTE</span>" +
      "  <div id='cObjSlot' style='height:3px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:5px'><i id='cObjFill' style='display:block;height:100%;width:0%;background:linear-gradient(90deg,#ffd451,#7ed957);transition:width .4s ease'></i></div>" +
      "</div>" +
      "<canvas id='cRadar' width='190' height='190' style='position:absolute;left:14px;top:14px;border-radius:50%;box-shadow:0 4px 14px rgba(0,0,0,.45)'></canvas>" +
      "<div id='cFeed' style='position:absolute;left:212px;top:14px;width:300px'></div>" +
      "<div id='cTurf' style='position:absolute;left:16px;top:212px;font-size:13px;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,.7)'></div>" +
      "<div id='cHomeLine' style='position:absolute;left:16px;top:232px;font-size:12px;color:#9fb0c6;text-shadow:0 1px 2px rgba(0,0,0,.7)'></div>" +
      // gang-membership badge (left column, below the turf/home lines; clears the
      // 190px radar which ends ~204px). Hidden entirely unless patched into a crew.
      "<div id='cMemb' class='cMemb' style='position:absolute;left:16px;top:254px;display:none'>" +
      "  <div class='row'><span class='gdot' id='cMembDot'></span><span class='gnm' id='cMembNm'></span><span class='rnk' id='cMembRnk'></span></div>" +
      "  <div class='pslot' id='cMembSlot'><i id='cMembFill' style='width:0%'></i></div>" +
      "</div>" +
      // bottom-centre contextual zone: the relationship chip (when targeting one
      // ped) and the melee posture bars (only mid-fight). Sits between the
      // bottom-left health stack and the bottom-right weapon — no overlap.
      "<div style='position:absolute;left:50%;bottom:122px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none'>" +
      "  <div id='cPost' class='cPost' style='display:none'>" +
      "    <div class='lbl'><span>YOU</span><span id='cPostFoeNm' style='color:#ffb37a'></span></div>" +
      "    <div class='pbar you' id='cPostYou'><i style='width:0%'></i></div>" +
      "    <div class='pbar foe' id='cPostFoe'><i style='width:0%'></i></div>" +
      "  </div>" +
      "  <div id='cRel' class='cRel' style='display:none'><span class='nm' id='cRelNm'></span><span class='lab' id='cRelLab'></span></div>" +
      "</div>" +
      "<div id='cCross' style='position:absolute;left:50%;top:50%;width:7px;height:7px;margin:-4px 0 0 -4px;border:2px solid rgba(255,255,255,.85);border-radius:50%;display:none'></div>" +
      "</div>";
    document.body.appendChild(root);
    cashEl = root.querySelector("#cMoney"); deltaEl = root.querySelector("#cDelta");
    starsEl = root.querySelector("#cStars"); starsWrap = root.querySelector("#cStarsWrap");
    crewEl = root.querySelector("#cCrew"); worldEl = root.querySelector("#cWorld");
    dripEl = root.querySelector("#cDrip");
    hpBar = root.querySelector("#cHp"); hungerBar = root.querySelector("#cFood"); stamBar = root.querySelector("#cStam");
    wpnEl = root.querySelector("#cWpn"); jobEl = root.querySelector("#cJob");
    slotsEl = root.querySelector("#cSlots"); ammoLineEl = root.querySelector("#cAmmo"); lootEl = root.querySelector("#cLoot");
    objEl = root.querySelector("#cObj"); objTxtEl = root.querySelector("#cObjTxt"); objRouteEl = root.querySelector("#cObjRoute");
    objSlotEl = root.querySelector("#cObjSlot"); objFillEl = root.querySelector("#cObjFill");
    if (objRouteEl) objRouteEl.addEventListener("click", routeToProspectHQ);
    radar = root.querySelector("#cRadar"); turfEl = root.querySelector("#cTurf"); homeLineEl = root.querySelector("#cHomeLine");
    feedEl = root.querySelector("#cFeed"); speedEl = root.querySelector("#cSpeed");
    popEl = root.querySelector("#cPop"); popBarEl = root.querySelector("#cPopBar"); killEl = root.querySelector("#cKill");
    turfPayEl = root.querySelector("#cTurfPay");
    membEl = root.querySelector("#cMemb"); membFillEl = root.querySelector("#cMembFill");
    relEl = root.querySelector("#cRel");
    postWrap = root.querySelector("#cPost"); postYouEl = root.querySelector("#cPostYou"); postFoeEl = root.querySelector("#cPostFoe"); postFoeNameEl = root.querySelector("#cPostFoeNm");
  }

  // ---- the city event feed: a tidy stack of recent street events down the
  //      left, distinct from the engine's centre toast (flashToast). Other
  //      systems can push to it via CBZ.cityFeed(msg, color). Self-pruning. ----
  const feed = [];
  // strip a trailing " (xN)" so repeats of the SAME flavor line collapse onto
  // one row regardless of how many times it has already been bumped.
  function feedBase(msg) { return String(msg).replace(/ \(x\d+\)$/, ""); }
  CBZ.cityFeed = function (msg, color, opts) {
    if (!msg) return;
    const nowMs = performance.now();
    const base = feedBase(msg);
    // REPEAT-COLLAPSE: a near-identical line arriving within ~5s of the most
    // recent row bumps that row's count to "(xN)" instead of stacking a new one.
    // (mode.js's category throttle passes {collapseOnly} for flooded notes so a
    // dropped repeat still ticks the visible counter rather than vanishing.)
    const last = feed.length ? feed[feed.length - 1] : null;
    if (last && last.base === base && nowMs - last.born < 5000) {
      last.count = (last.count || 1) + 1;
      last.msg = base + " (x" + last.count + ")";
      last.born = nowMs; last.t = CBZ.now || 0;   // refresh so it survives the burst
      renderFeed();
      return;
    }
    if (opts && opts.collapseOnly) return;   // throttled note, nothing to collapse onto
    feed.push({ msg: msg, base: base, count: 1, color: color || "#7ed957", t: CBZ.now || 0, born: nowMs });
    if (feed.length > 5) feed.shift();
    renderFeed();
  };
  function renderFeed() {
    if (!feedEl) return;
    let html = "";
    for (let i = 0; i < feed.length; i++) {
      const f = feed[i];
      html += "<div class='cFeedRow' style='border-left-color:" + f.color + "'>" + f.msg + "</div>";
    }
    feedEl.innerHTML = html;
  }
  let feedAcc = 0;
  function pruneFeed(dt) {
    feedAcc += dt;
    if (feedAcc < 0.25) return; feedAcc = 0;
    const nowMs = performance.now();
    let changed = false;
    while (feed.length && nowMs - feed[0].born > 6500) { feed.shift(); changed = true; }
    if (changed) renderFeed();
  }

  // ---- live POPULATION headcount (battle-royale-style alive count) + a hud-local
  //      KILL FEED. Both feature-detect the engine: population reads
  //      CBZ.cityPopulation() -> {alive,total}; the feed reads CBZ.cityRecentDeaths.
  //      turf.js already mounts its OWN takeover meta-bar + kill feed; to avoid a
  //      double feed we only render the hud-local feed when turf's (#cKillFeed)
  //      isn't on screen, so the two systems read as ONE cohesive HUD. ----
  let lastPopN = -1, popPulseT = 0;
  function renderPop() {
    if (!popEl) return;
    if (!CBZ.cityPopulation) { popEl.style.display = "none"; if (popBarEl) popBarEl.style.display = "none"; return; }
    const p = CBZ.cityPopulation();
    if (!p || !p.total) { popEl.style.display = "none"; if (popBarEl) popBarEl.style.display = "none"; return; }
    popEl.style.display = "inline-flex";
    if (popBarEl) popBarEl.style.display = "block";
    const n = p.alive | 0;
    const nEl = popEl.querySelector("#cPopN"), totEl = popEl.querySelector("#cPopTot");
    if (nEl) nEl.textContent = n.toLocaleString();
    if (totEl) totEl.textContent = "/" + (p.total | 0) + " alive";
    if (popBarEl) { const bar = popBarEl.querySelector("i"); if (bar) bar.style.width = Math.max(0, Math.min(100, (n / p.total) * 100)) + "%"; }
    // a quick pulse whenever the count drops, so a massacre reads at a glance
    if (lastPopN >= 0 && n < lastPopN) { popEl.style.animation = "none"; void popEl.offsetWidth; popEl.style.animation = "cPopPulse .4s ease-out"; }
    lastPopN = n;
  }

  // hud-local kill feed (fallback). Mirrors turf.js's <Name> — <cause> rows.
  let killSig = "";
  function turfFeedLive() {
    const tf = document.getElementById("cKillFeed");
    return !!(tf && tf.style.display !== "none");
  }
  function renderKill() {
    if (!killEl) return;
    const deaths = CBZ.cityRecentDeaths;
    // defer to turf.js's feed when it's the one on screen (no duplicate)
    if (!deaths || !deaths.length || turfFeedLive()) {
      if (killEl.style.display !== "none") { killEl.style.display = "none"; killEl.innerHTML = ""; killSig = ""; }
      return;
    }
    const recent = deaths.slice(-5);
    let sig = "";
    for (let i = 0; i < recent.length; i++) { const d = recent[i]; sig += (d.name || "") + "~" + (d.cause || "") + "~" + (d.t || "") + "|"; }
    if (sig === killSig) return;
    killSig = sig;
    let html = "";
    for (let i = 0; i < recent.length; i++) {
      const d = recent[i];
      const cls = d.you ? "cKillRow you" : "cKillRow";
      html += "<div class='" + cls + "'><b>" + esc(d.name || "Someone") + "</b> — " + esc(d.cause || "killed") + "</div>";
    }
    killEl.innerHTML = html;
    killEl.style.display = "block";
  }
  function esc(s) { return String(s).replace(/[<>&]/g, function (c) { return c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"; }); }
  function hex6(c) { return "#" + ("000000" + ((c >>> 0).toString(16))).slice(-6); }

  // ---- wave-5 DEPTH SURFACES (all compact + contextual; nothing shows unless
  //      currently relevant, so the screen stays one clean page) ----------------

  // turf passive income — a tiny "+$x/min" under the money, ONLY when you earn it.
  function renderTurfPay() {
    if (!turfPayEl) return;
    const econ = CBZ.cityEcon;
    if (!econ || !econ.turfIncomeInfo) { turfPayEl.style.display = "none"; return; }
    let info; try { info = econ.turfIncomeInfo(); } catch (e) { info = null; }
    const perSec = info ? (info.perSec || 0) : 0;
    if (!info || perSec <= 0 || !(info.zones > 0)) { turfPayEl.style.display = "none"; return; }
    const perMin = Math.round(perSec * 60);
    turfPayEl.innerHTML = "🏴 +$" + perMin.toLocaleString() + "/min <span style='color:#8a93a3;font-weight:500'>· " + info.zones + " turf</span>";
    turfPayEl.style.display = "inline-flex";
  }

  // gang-membership badge: gang name (its colour) + your RANK + a thin sliver of
  // progress toward the next rung. Hidden whole when you ride with no crew.
  // Promotion needs mirror playergang.js's member ladder; we read the player's
  // tracked bodies/contrib off the membership record (the exact promotion
  // currency) and degrade gracefully if any of it is absent.
  const MEMB_LADDER = ["prospect", "lookout", "runner", "soldier", "enforcer", "lt"];
  const MEMB_NEED = { lookout: { body: 1, contrib: 80 }, runner: { body: 2, contrib: 220 }, soldier: { body: 4, contrib: 520 }, enforcer: { body: 8, contrib: 1100 }, lt: { body: 14, contrib: 2200 } };
  function renderMemb() {
    if (!membEl) return;
    const m = (CBZ.cityMembership && CBZ.cityMembership()) || null;
    if (!m || !m.gangId) { membEl.style.display = "none"; return; }
    // resolve the crew record for its name + colour (several lookup names exist)
    let rec = null;
    if (CBZ.cityGangById) rec = CBZ.cityGangById(m.gangId);
    if (!rec && CBZ.cityGangs) rec = CBZ.cityGangs.find && CBZ.cityGangs.find((x) => x && x.id === m.gangId);
    const col = rec && rec.color != null ? hex6(rec.color) : "#ffd451";
    const name = (rec && rec.name) ? rec.name : (m.gangId || "Crew");
    const rank = CBZ.cityRankName ? CBZ.cityRankName(m.rank) : (m.rank || "Crew");
    membEl.querySelector("#cMembDot").style.background = col;
    const nmEl = membEl.querySelector("#cMembNm"); nmEl.textContent = name; nmEl.style.color = col;
    membEl.querySelector("#cMembRnk").textContent = rank;
    // promotion sliver toward the next rung (min of the two earned currencies)
    const slot = membEl.querySelector("#cMembSlot");
    const idx = MEMB_LADDER.indexOf(m.rank);
    let pct = -1;
    if (idx >= 0 && idx < MEMB_LADDER.length - 1) {
      const need = MEMB_NEED[MEMB_LADDER[idx + 1]];
      if (need) {
        const bP = need.body > 0 ? Math.min(1, (m.bodies || 0) / need.body) : 1;
        const cP = need.contrib > 0 ? Math.min(1, (m.contrib || 0) / need.contrib) : 1;
        pct = Math.round(Math.min(bP, cP) * 100);
      }
    }
    if (pct < 0) { slot.style.display = "none"; }     // top of the ladder → no sliver
    else { slot.style.display = "block"; if (membFillEl) membFillEl.style.width = pct + "%"; }
    membEl.style.display = "inline-flex";
  }

  // RELATIONSHIP chip — contextual to the ONE ped you're aiming at / standing
  // beside. Reads THAT ped's standing toward you (cityRelLabel / cityRel) and
  // colours it by sentiment. Never a list; vanishes the moment you stop pointing.
  function focusPed() {
    const peds = CBZ.cityPeds, P = CBZ.player;
    if (!peds || !P || !P.pos || P.dead || P.driving) return null;
    if (CBZ.cityMenuOpen) return null;            // the interact menu owns the screen
    const px = P.pos.x, pz = P.pos.z;
    const cam = CBZ.cam, yaw = cam ? cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bestScore = Infinity;
    for (const p of peds) {
      if (!p || p.dead || p.vendor || !p.pos) continue;
      const dx = p.pos.x - px, dz = p.pos.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 > 64) continue;                       // within ~8m only
      const d = Math.sqrt(d2) || 0.001;
      const dot = (dx / d) * fx + (dz / d) * fz;   // forward alignment
      // accept anyone close in front, OR anyone within arm's reach in any dir
      if (dot < 0.4 && d > 2.6) continue;
      const score = d - dot * 2;                   // nearest + most-centred wins
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }
  const REL_COL = {
    "wants you dead": "#ff5b5b", "hates you": "#ff8b6b", "terrified of you": "#c9a0ff",
    "loves you": "#ff8bd0", "likes you": "#7ed957", "respects you": "#7fd0ff",
    "neutral": "#9fb0c6",
  };
  function renderRel() {
    if (!relEl || !CBZ.cityRelLabel) { if (relEl) relEl.style.display = "none"; return; }
    const p = focusPed();
    if (!p) { relEl.style.display = "none"; return; }
    let lab; try { lab = CBZ.cityRelLabel(p); } catch (e) { lab = null; }
    if (!lab) { relEl.style.display = "none"; return; }
    const col = REL_COL[lab] || "#9fb0c6";
    // a tiny ▲/▼ arrow reads sentiment at a glance (good = up, bad = down)
    const bad = (lab === "wants you dead" || lab === "hates you" || lab === "terrified of you");
    const arrow = (lab === "neutral") ? "" : (bad ? " ▼" : " ▲");
    relEl.querySelector("#cRelNm").textContent = p.name || "Stranger";
    const labEl = relEl.querySelector("#cRelLab");
    labEl.textContent = lab + arrow; labEl.style.color = col;
    relEl.style.display = "inline-flex";
  }

  // MELEE POSTURE — a slim bar for YOU and your current foe, shown ONLY while a
  // melee fight is live (you're unarmed/melee + recently fighting). Reads the
  // player bar from CBZ.cityPosture(); the foe bar from the engine's per-ped
  // posture fields (set by combat.js on any ped that's been struck), all
  // feature-detected so it simply hides when the melee system isn't present.
  function meleeFoe() {
    const peds = CBZ.cityPeds, P = CBZ.player;
    if (!peds || !P || !P.pos) return null;
    const px = P.pos.x, pz = P.pos.z;
    let best = null, bd = 3.4 * 3.4;
    const cam = CBZ.cam, yaw = cam ? cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const scan = (a) => {
      if (!a || a.dead || !a.pos) return;
      const dx = a.pos.x - px, dz = a.pos.z - pz, d2 = dx * dx + dz * dz;
      if (d2 > bd) return;
      const d = Math.sqrt(d2) || 0.001;
      if ((dx / d) * fx + (dz / d) * fz < 0.2) return;   // must be roughly in front
      bd = d2; best = a;
    };
    if (CBZ.cityCops) for (const c of CBZ.cityCops) scan(c);
    for (const p of peds) if (!p.vendor) scan(p);
    return best;
  }
  function renderPosture() {
    if (!postWrap) return;
    const P = CBZ.player;
    // gate: melee only. Hide if holding a real gun, driving, dead, or no posture sys.
    const gun = CBZ.cityHasGun ? CBZ.cityHasGun() : !!(CBZ.hasAnyWeapon && CBZ.hasAnyWeapon());
    const fighting = P && ((P._fighting || 0) > 0);
    if (!CBZ.cityPosture || gun || !P || P.dead || P.driving || !fighting) { postWrap.style.display = "none"; return; }
    let ps; try { ps = CBZ.cityPosture(); } catch (e) { ps = null; }
    if (!ps || !ps.max) { postWrap.style.display = "none"; return; }
    const foe = meleeFoe();
    // only surface the bars when there's actually a foe engaged OR your own guard
    // is loaded/broken — otherwise it's just idle swinging, keep it hidden.
    if (!foe && ps.p <= 0 && !ps.broken) { postWrap.style.display = "none"; return; }
    const youPct = Math.max(0, Math.min(100, (ps.p / ps.max) * 100));
    const youFill = postYouEl.querySelector("i"); if (youFill) youFill.style.width = youPct + "%";
    postYouEl.classList.toggle("brk", !!ps.broken);
    if (foe) {
      const fmax = foe._postMax || 100, fp = foe._posture || 0;
      const fbrk = (foe._broken || 0) > 0;
      const fPct = Math.max(0, Math.min(100, (fp / fmax) * 100));
      const fFill = postFoeEl.querySelector("i"); if (fFill) fFill.style.width = (fbrk ? 100 : fPct) + "%";
      postFoeEl.classList.toggle("brk", fbrk);
      postFoeEl.style.display = "block";
      if (postFoeNameEl) postFoeNameEl.textContent = (foe.name || "Foe") + (fbrk ? " · OPEN" : "");
    } else {
      postFoeEl.style.display = "none";
      if (postFoeNameEl) postFoeNameEl.textContent = "";
    }
    postWrap.style.display = "flex";
  }

  // ============================================================
  //  THE MINIMAP — a HEADING-UP tactical instrument.
  //  WHY heading-up: the #1 question a minimap answers is "which way am I
  //  facing + what's about to hurt me", so we rotate the world to put YOUR
  //  forward at the top (fixed chevron, no mental trig) and spend colour ONLY
  //  on things that demand a reaction. The base is desaturated; territory is a
  //  faint crew wash (whose block am I in); threats are bright and layered:
  //  cops scale with heat, the police chopper rides the rim with a bearing at
  //  3★+, bosses are gold, armed offenders/rampagers are orange-red, your crew
  //  is green. Off-map threats clamp to the rim so you always know where danger
  //  is. The strategic detail (names, full turf board) lives on the [M] map.
  // ============================================================
  let radarAcc = 0, popAcc = 0;
  function hex6n(c) { return "#" + ("000000" + ((c >>> 0) & 0xffffff).toString(16)).slice(-6); }
  function drawRadar() {
    if (!radar) return;
    const ctx = radar.getContext("2d"); if (!ctx) return;
    const W = radar.width, H = radar.height, R = 112;             // world units shown around you
    const sc = (W / 2) / R, cx = W / 2, cy = H / 2;
    const P = CBZ.player, px = P.pos.x, pz = P.pos.z;
    const A = CBZ.city && CBZ.city.arena; if (!A) return;
    const g = CBZ.game, now = CBZ.now || 0;
    const wanted = (g && g.wanted) || 0;
    const pulse = 0.5 + 0.5 * Math.sin(now * 6);
    // heading-up rotation: rotMap === camera yaw makes the player's forward
    // point to screen-up (derivation in commit msg). We rotate POINTS in JS (not
    // the canvas) so every icon/label stays upright while the map turns.
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
    const cosR = Math.cos(yaw), sinR = Math.sin(yaw);
    const _p = [0, 0];
    function S(wx, wz, out) {
      const dx = (wx - px) * sc, dy = (wz - pz) * sc;
      out = out || _p; out[0] = cx + dx * cosR - dy * sinR; out[1] = cy + dx * sinR + dy * cosR; return out;
    }
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 1, 0, 6.28); ctx.closePath();
    ctx.fillStyle = "rgba(8,10,15,.78)"; ctx.fill();
    ctx.clip();

    // ---- TERRITORY base: each lot faintly washed by its controlling crew so you
    //      sense whose turf you're standing in; neutral blocks read dark. This is
    //      the only "colour = meaning" on the base layer (no rainbow trade tiles).
    const owner = new Map();
    if (CBZ.cityGangs) for (const gg of CBZ.cityGangs) {
      if (!gg || !gg.turf) continue; const oc = gg.isPlayer ? 0xffd451 : gg.color;
      for (const lot of gg.turf) owner.set(lot, oc);
    }
    const R2 = (R + 26) * (R + 26);
    function paintLots(list) {
      if (!list) return;
      for (const lot of list) {
        if (!lot) continue; const ddx = lot.cx - px, ddz = lot.cz - pz; if (ddx * ddx + ddz * ddz > R2) continue;
        S(lot.cx, lot.cz); const s = Math.max(3, (lot.w || 20) * sc);
        const oc = owner.get(lot);
        if (oc != null) { ctx.fillStyle = hex6n(oc); ctx.globalAlpha = oc === 0xffd451 ? 0.5 : 0.32; }
        else { ctx.fillStyle = "#252b33"; ctx.globalAlpha = 0.62; }
        ctx.fillRect(_p[0] - s / 2, _p[1] - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    }
    // roads first (under blocks): faint grey, world-axis lines through the view
    ctx.strokeStyle = "rgba(110,122,138,.26)"; ctx.lineWidth = Math.max(1, A.ROAD * sc * 0.7);
    for (const x of A.xLines) { const a = S(x, pz - R - 30, [0, 0]), b = S(x, pz + R + 30, [0, 0]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    for (const z of A.zLines) { const a = S(px - R - 30, z, [0, 0]), b = S(px + R + 30, z, [0, 0]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    paintLots(A.lots);
    // island: a thin beach ring + its streets + the bridge (the chokepoint)
    if (A.annex) {
      const X = A.annex; S(X.cx, X.cz);
      ctx.strokeStyle = "rgba(120,170,120,.5)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(_p[0], _p[1], X.radius * sc, 0, 6.28); ctx.stroke();
      ctx.strokeStyle = "rgba(110,122,138,.22)"; ctx.lineWidth = Math.max(1, 5 * sc);
      for (const r of X.roads) {
        const a = r.vertical ? S(r.x, r.z - r.len / 2, [0, 0]) : S(r.x - r.len / 2, r.z, [0, 0]);
        const b = r.vertical ? S(r.x, r.z + r.len / 2, [0, 0]) : S(r.x + r.len / 2, r.z, [0, 0]);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      paintLots(X.lots);
      if (A.bridge) {
        const a = S(A.bridge.minX, (A.bridge.minZ + A.bridge.maxZ) / 2, [0, 0]);
        const b = S(A.bridge.maxX, (A.bridge.minZ + A.bridge.maxZ) / 2, [0, 0]);
        ctx.strokeStyle = wanted >= 3 ? "rgba(255,90,90,.8)" : "rgba(180,190,205,.5)"; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    }

    // a blip helper that clamps off-map targets to the rim (so danger off-screen
    // still shows a bearing). draw(x,y,onRim) does the icon.
    const RIM = W / 2 - 7;
    function blip(wx, wz, draw, edge) {
      S(wx, wz); let x = _p[0] - cx, y = _p[1] - cy; const d = Math.hypot(x, y);
      if (d > RIM) { if (!edge) return; const k = RIM / d; draw(cx + x * k, cy + y * k, true); }
      else draw(cx + x, cy + y, false);
    }
    function dot(x, y, col, r) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1; ctx.stroke(); }
    function tri(x, y, col, r) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.9, y + r * 0.7); ctx.lineTo(x - r * 0.9, y + r * 0.7); ctx.closePath(); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.lineWidth = 1; ctx.stroke(); }
    function diamond(x, y, col, r) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.lineWidth = 1; ctx.stroke(); }

    // ---- crew HQ stars (rivals) — quiet anchors, only when near ----
    if (CBZ.cityGangs) for (const gang of CBZ.cityGangs) {
      if (!gang || gang.isPlayer || gang.absorbed) continue;
      const hq = CBZ.cityGangHQ ? CBZ.cityGangHQ(gang.id) : (gang.center && (gang.center.x || gang.center.z) ? gang.center : null);
      if (hq && (hq.x || hq.z)) { const dx = hq.x - px, dz = hq.z - pz; if (dx * dx + dz * dz <= R * R) { S(hq.x, hq.z); diamond(_p[0], _p[1], hex6n(gang.color), 3.4); } }
    }

    // ---- cars: your ride is a bright green chevron (always findable); traffic faint ----
    for (const c of CBZ.cityCars) {
      if (c.dead) continue; const dx = c.pos.x - px, dz = c.pos.z - pz; if (dx * dx + dz * dz > R * R) continue;
      S(c.pos.x, c.pos.z);
      if (c.owned || c.player) dot(_p[0], _p[1], "#7ed957", 3.2);
      else { ctx.fillStyle = "rgba(210,216,226,.55)"; ctx.fillRect(_p[0] - 1.3, _p[1] - 1.3, 2.6, 2.6); }
    }

    // ---- THREAT + ALLY LAYER (bright, drawn on top) ----
    // crew / companions (green) — your posse
    if (CBZ.cityPeds) for (const pd of CBZ.cityPeds) {
      if (pd.dead || !(pd.companion || pd.gang === "player")) continue;
      const dx = pd.pos.x - px, dz = pd.pos.z - pz; if (dx * dx + dz * dz > R * R) continue;
      S(pd.pos.x, pd.pos.z); dot(_p[0], _p[1], "#5ad17a", 2.4);
    }
    // armed offenders & rampagers (orange) and mob bosses (gold) — danger you can hunt or flee
    if (CBZ.cityPeds) for (const pd of CBZ.cityPeds) {
      if (pd.dead || pd.gang === "player" || pd.companion) continue;
      const dx = pd.pos.x - px, dz = pd.pos.z - pz; const d2 = dx * dx + dz * dz; if (d2 > R2) continue;
      if (pd.isBoss || pd.rank === "boss") { blip(pd.pos.x, pd.pos.z, (x, y) => diamond(x, y, "#ffd451", 4 + pulse), true); continue; }
      const rampage = (pd.npcWanted | 0) >= 2 || (pd.rage && pd.armed);
      if (rampage) { blip(pd.pos.x, pd.pos.z, (x, y) => tri(x, y, "#ff7a2a", 4), true); continue; }
      if (pd.armed && d2 < 60 * 60) { S(pd.pos.x, pd.pos.z); dot(_p[0], _p[1], "#ff5b5b", 2.2); }
    }
    // cops (cyan) — when you're wanted they tint hot-red and off-map ones clamp to
    // the rim so you can read where the heat is coming from.
    for (const c of CBZ.cityCops) {
      if (c.dead) continue; const col = wanted > 0 ? "#ff6a5a" : "#5bd0ff";
      blip(c.pos.x, c.pos.z, (x, y, rim) => { dot(x, y, col, rim ? 2.6 : 2.4); }, wanted > 0);
    }

    // ---- objective + waypoint ----
    const wp = CBZ.fullMap && CBZ.fullMap.waypoint && CBZ.fullMap.waypoint();
    if (wp) { blip(wp.x, wp.z, (x, y) => { ctx.strokeStyle = "#7de7ff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 4 + pulse * 2, 0, 6.28); ctx.stroke(); }, true); }
    const j = g && g.cityJob;
    if (j && j.dest) blip(j.dest.x, j.dest.z, (x, y) => diamond(x, y, "#7ed957", 4 + pulse * 2), true);
    if (g && g.cityPartner && g.cityPartner.kidnapped && g.cityPartner.pos) blip(g.cityPartner.pos.x, g.cityPartner.pos.z, (x, y) => diamond(x, y, "#ff6bd0", 4 + pulse * 2), true);

    // ---- POLICE CHOPPER: at 3★+ it hunts you. Always rim-clamped with a bearing
    //      so you know to get under cover. WHY this is here: it answers "why a
    //      helipad" and visualises the air tier of the wanted ladder. ----
    if (wanted >= 3 && CBZ.cityChopperPos) {
      const hp = CBZ.cityChopperPos();
      if (hp) blip(hp.x, hp.z, (x, y) => { drawChopper(ctx, x, y, now); }, true);
    }

    ctx.restore();   // drop circular clip

    // ---- HEAT RING: the wanted level made visible as a closing red glow on the
    //      rim. Brighter + faster pulse as stars climb; molten at 5★. ----
    if (wanted > 0) {
      const heat = wanted / 5;
      const a = (0.16 + heat * 0.5) * (0.7 + 0.3 * pulse);
      const grad = ctx.createRadialGradient(cx, cy, W * 0.18, cx, cy, W / 2);
      grad.addColorStop(0, "rgba(255,40,30,0)");
      grad.addColorStop(1, "rgba(255," + Math.round(60 - heat * 50) + ",30," + a.toFixed(3) + ")");
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 1, 0, 6.28); ctx.clip();
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H); ctx.restore();
    }

    // round frame
    ctx.strokeStyle = wanted >= 4 ? "rgba(255,70,55,.7)" : "rgba(255,255,255,.2)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 2, 0, 6.28); ctx.stroke();
    // NORTH pip — rotates with the heading-up map so it always points true north.
    // North is world -Z; through S that direction sits at (sinR, -cosR) from centre.
    const nx = cx + Math.sin(yaw) * (W / 2 - 11), ny = cy - Math.cos(yaw) * (W / 2 - 11);
    ctx.fillStyle = "#ff6b6b"; ctx.font = "bold 10px Fredoka,sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("N", nx, ny);

    // ---- PLAYER: a fixed up-pointing chevron at centre + a translucent VIEW CONE
    //      so "where I am AND what I'm looking at" is unmistakable. Up === forward. ----
    ctx.save();
    const coneR = W * 0.34, coneH = 0.5;     // half-angle ~0.5 rad
    const cg = ctx.createRadialGradient(cx, cy, 2, cx, cy, coneR);
    cg.addColorStop(0, "rgba(126,217,255,.32)"); cg.addColorStop(1, "rgba(126,217,255,0)");
    ctx.fillStyle = cg; ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, coneR, -Math.PI / 2 - coneH, -Math.PI / 2 + coneH); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx + 5.5, cy + 6); ctx.lineTo(cx, cy + 2.5); ctx.lineTo(cx - 5.5, cy + 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  // little top-down helicopter glyph with spinning rotor — reads as "air threat"
  function drawChopper(ctx, x, y, now) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(now * 9);
    ctx.strokeStyle = "rgba(255,80,70,.95)"; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.moveTo(0, -8); ctx.lineTo(0, 8); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#ff5040"; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 6.28); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1; ctx.stroke();
  }
  function ringMark(ctx, x, y, col, r) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r || 5, 0, 6.28); ctx.stroke(); }
  function markStar(ctx, x, y, col, r) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r || 4, 0, 6.28); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1; ctx.stroke(); }

  CBZ.cityHudDirty = function () { dirty = true; };

  // ---- objective line: resolve the crew the player is prospecting so [ROUTE]
  //      can drop an HQ waypoint. cityProspectTask() exposes a label (and maybe a
  //      target ped) but NOT the gangId, so we match the label's gang short-name
  //      (last word) against the live roster — a self-contained lookup. ----
  function shortName(n) { const w = String(n || "").split(" "); return w.length ? w[w.length - 1] : ""; }
  function prospectGang() {
    if (!CBZ.cityProspectTask || !CBZ.cityGangs) return null;
    let task; try { task = CBZ.cityProspectTask(); } catch (e) { task = null; }
    if (!task) return null;
    const lbl = String(task.label || "");
    let found = null;
    for (const gang of CBZ.cityGangs) {
      if (!gang || gang.isPlayer || gang.absorbed) continue;
      // the label embeds the gang's SHORT name ("...with Bloods", "...for Kings")
      if (lbl.indexOf(shortName(gang.name)) >= 0 || lbl.indexOf(gang.name) >= 0) { found = gang; break; }
    }
    return found;
  }
  function routeToProspectHQ() {
    if (!CBZ.fullMap) return;
    let task; try { task = CBZ.cityProspectTask && CBZ.cityProspectTask(); } catch (e) { task = null; }
    // a live marked target (biz/rival hit) is the precise thing to chase — route
    // straight to it; otherwise route to the prospected crew's HQ.
    if (task && task.target && !task.target.dead && task.target.pos && CBZ.fullMap.setWaypoint) {
      CBZ.fullMap.setWaypoint(task.target.pos.x, task.target.pos.z, "TARGET: " + (task.target.name || "mark"));
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      return;
    }
    const gang = prospectGang();
    if (gang && CBZ.fullMap.setGangWaypoint) { CBZ.fullMap.setGangWaypoint(gang.id); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
  }

  // OBJECTIVE LINE — only when no city job is active. Shows the prospect's active
  // task with a % from cityProspectStanding(), a [ROUTE] affordance, and a thin
  // standing fill. Fully guarded so it cleanly hides when not prospecting.
  function renderObjective() {
    if (!objEl) return;
    let task = null;
    try { if (CBZ.cityProspectTask) task = CBZ.cityProspectTask(); } catch (e) { task = null; }
    if (!task) { objEl.style.display = "none"; return; }
    let standing = 0;
    try { if (CBZ.cityProspectStanding) standing = CBZ.cityProspectStanding(); } catch (e) { standing = 0; }
    const pct = Math.round(Math.max(0, Math.min(1, standing)) * 100);
    if (objTxtEl) objTxtEl.innerHTML = "🎯 " + esc(task.label) + " <span style='color:#9fb0c6'>(" + pct + "%)</span>";
    // [ROUTE] only makes sense when there's a place to go (a live target, or a
    // resolvable HQ); otherwise hide it so the line doesn't dangle a dead button.
    if (objRouteEl) {
      const canRoute = (task.target && !task.target.dead) || !!prospectGang();
      objRouteEl.style.display = canRoute ? "inline" : "none";
    }
    // standing fill — reuse the membership/relationship sliver styling. Only while
    // there's actual standing to show (>0), per the spec.
    if (objSlotEl && objFillEl) {
      if (standing > 0) { objSlotEl.style.display = "block"; objFillEl.style.width = pct + "%"; }
      else objSlotEl.style.display = "none";
    }
    objEl.style.display = "block";
  }

  // ---- WEAPON HOTBAR — bring the city loadout up to jail's clarity, reading the
  //      engine's AUTHORITATIVE weapon state: CBZ.weaponInventory (owned ids) →
  //      CBZ.FPS_WEAPONS (labels/short/slot), CBZ.currentWeaponId (held), and the
  //      live mag/reserve out of CBZ.fps.rounds/reserves (the SAME source fpsmode's
  //      setAmmoHud() reads). City melee (g.cityMeleeWeapon) is a held slot too; an
  //      empty inventory shows a single "Fists" slot. All guarded — degrades to a
  //      bare Fists slot if the engine weapon tables aren't loaded. -----------------
  function weaponMetaById(id) {
    const T = CBZ.FPS_WEAPONS;
    if (!T) return null;
    for (let i = 0; i < T.length; i++) { const w = T[i]; if (w && (w.id === id || w.key === id)) return { w: w, i: i }; }
    return null;
  }
  function renderHotbar() {
    if (!slotsEl) return;
    const inv = (CBZ.weaponInventory && CBZ.weaponInventory.length) ? CBZ.weaponInventory : [];
    const melee = g.cityMeleeWeapon || null;        // Bat/Knife — a held melee, not a gun
    const heldGun = !melee && CBZ.currentWeaponId ? CBZ.currentWeaponId : null;
    const fps = CBZ.fps;                            // engine ammo store (guarded)
    let html = "";
    // a Fists slot is the baseline — shown when you own no guns, or as the unarmed
    // fallback. It's the HELD slot only when you're carrying neither gun nor melee.
    const fistsHeld = !melee && !heldGun;
    if (!inv.length && !melee) {
      html += "<div class='cSlot held'><span class='s'>Fists</span></div>";
    } else {
      // melee chip first (it's the one in hand when set) so the loadout reads L→R
      if (melee) {
        html += "<div class='cSlot melee held'><span class='s'>" + esc(melee) + "</span></div>";
      } else if (fistsHeld) {
        html += "<div class='cSlot held'><span class='s'>Fists</span></div>";
      }
      for (let k = 0; k < inv.length; k++) {
        const id = inv[k];
        const m = weaponMetaById(id);
        if (!m) continue;
        const lbl = m.w.short || m.w.label || id;
        const held = (id === heldGun);
        // per-slot ammo: mag for the held weapon comes from fps.rounds (live), the
        // rest fall back to their full magSize so each slot reads a sensible number.
        let ammoTxt = "";
        if (fps && fps.rounds && fps.reserves) {
          const cur = (fps.rounds[m.i] != null) ? fps.rounds[m.i] : (m.w.mag || 0);
          const res = (fps.reserves[m.i] != null) ? fps.reserves[m.i] : (m.w.reserve || 0);
          ammoTxt = cur + "/" + res;
        } else { ammoTxt = (m.w.mag || 0) + "/" + (m.w.reserve || 0); }
        html += "<div class='cSlot" + (held ? " held" : "") + "'>" +
          "<span class='s'>" + esc(lbl) + "</span><span class='a'>" + ammoTxt + "</span></div>";
      }
    }
    slotsEl.innerHTML = html;
    // the prominent equipped-weapon ammo line (jail-style big mag / reserve). For a
    // gun we read fps live state for the CURRENT weapon; melee/fists show no ammo.
    let line = "";
    if (heldGun) {
      const m = weaponMetaById(heldGun);
      let cur = 0, mag = 0, res = 0, reloading = false;
      if (m && fps && fps.rounds && fps.reserves) {
        cur = (fps.rounds[m.i] != null) ? fps.rounds[m.i] : (m.w.mag || 0);
        res = (fps.reserves[m.i] != null) ? fps.reserves[m.i] : (m.w.reserve || 0);
        mag = m.w.mag || 0;
        reloading = (m.i === fps.weapon) && (fps.reloading > 0);
      } else if (m) { cur = m.w.mag || 0; mag = m.w.mag || 0; res = m.w.reserve || 0; }
      if (reloading) line = "<span class='rl'>RELOADING…</span> ";
      line += "<b>" + cur + "</b><span class='res'> / " + mag + " · " + res + " res</span>";
    } else if (melee) {
      line = "<span class='res'>" + esc(melee) + " — melee</span>";
    } else {
      line = "<span class='res'>unarmed</span>";
    }
    const armor = (CBZ.player && CBZ.player._armor) || 0;
    if (armor > 0) line += " <span class='arm'>🛡 " + Math.round(armor) + "</span>";
    if (ammoLineEl) ammoLineEl.innerHTML = line;
  }

  // ---- carried LOOT readout — the valuables / consumables you're holding from
  //      g.cityInv, with counts. Guns + ammo are deliberately EXCLUDED (the hotbar
  //      already owns those); we surface drugs, wearables, valuables, throwables,
  //      tools and food so your loot reads at a glance without cluttering. Compact
  //      chips, value-sorted so the jackpot (a lifted Rolex / Gold Bar) leads. ------
  const LOOT_ICON = {
    drug: "💊", wearable: "💎", valuable: "💰", throwable: "🧨", tool: "🧰", food: "🍔",
  };
  // a handful of nicer per-item glyphs so the row reads instantly
  const LOOT_ITEM_ICON = {
    Grenade: "🧨", Rolex: "⌚", Omega: "⌚", "Audemars Piguet": "⌚", "Patek Philippe": "⌚",
    "Richard Mille": "⌚", "Gold Bar": "🥇", "Gold Chain": "📿", "Diamond Ring": "💍",
    "Engagement Ring": "💍", Medkit: "🩹", "Body Armor": "🦺", Weed: "🌿", Coke: "❄️",
    "Cash Stack": "💵", "Briefcase of Cash": "💼", Phone: "📱", Laptop: "💻", Wallet: "👛",
  };
  function renderLoot() {
    if (!lootEl) return;
    const econ = CBZ.cityEcon, inv = g.cityInv;
    if (!econ || !econ.ITEMS || !inv) { lootEl.style.display = "none"; return; }
    const ITEMS = econ.ITEMS;
    const rows = [];
    for (const name in inv) {
      const n = inv[name] | 0;
      if (n <= 0) continue;
      const it = ITEMS[name];
      const tag = it && it.tag;
      // guns + their ammo are the hotbar's job; melee weapons live in the hotbar
      // (as the held melee chip) too — keep loot to carry-able valuables/consumables.
      if (tag === "weapon" || tag === "ammo") continue;
      const icon = LOOT_ITEM_ICON[name] || (tag && LOOT_ICON[tag]) || "•";
      rows.push({ name: name, n: n, icon: icon, val: (it && it.value) || 0, luxe: !!(it && it.luxe) });
    }
    if (!rows.length) { lootEl.style.display = "none"; lootEl.innerHTML = ""; return; }
    // lead with the most valuable loot; cap the row so it never sprawls across the
    // screen — a "+N more" chip rolls up the tail.
    rows.sort((a, b) => (b.val - a.val) || (b.n - a.n));
    const MAX = 7;
    let html = "";
    for (let i = 0; i < rows.length && i < MAX; i++) {
      const r = rows[i];
      const nm = esc(r.name) + (r.luxe ? " ✨" : "");
      const cnt = r.n > 1 ? " <span class='x'>×" + r.n + "</span>" : "";
      html += "<span class='it'>" + r.icon + " <b>" + nm + "</b>" + cnt + "</span>";
    }
    if (rows.length > MAX) html += "<span class='it'><span class='x'>+" + (rows.length - MAX) + " more</span></span>";
    lootEl.innerHTML = html;
    lootEl.style.display = "flex";
  }

  // Live ammo follows the engine as you FIRE / RELOAD — firing never flips the HUD
  // `dirty` flag, so the per-frame driver pokes this. It re-renders the hotbar only
  // when the held weapon's mag/reserve/reload actually changed (a cheap signature
  // compare → no needless DOM churn on phones). Returns nothing; safe when unarmed.
  let ammoSig = "";
  function refreshAmmoLive() {
    const fps = CBZ.fps;
    const melee = g.cityMeleeWeapon || null;
    const heldGun = !melee && CBZ.currentWeaponId ? CBZ.currentWeaponId : null;
    let sig;
    if (heldGun && fps && fps.rounds && fps.reserves) {
      const m = weaponMetaById(heldGun);
      const i = m ? m.i : -1;
      sig = heldGun + "|" + (i >= 0 ? fps.rounds[i] : "") + "|" + (i >= 0 ? fps.reserves[i] : "") + "|" + (fps.reloading > 0 ? 1 : 0) + "|" + ((CBZ.player && CBZ.player._armor) | 0);
    } else {
      sig = (melee || "fists") + "|" + ((CBZ.player && CBZ.player._armor) | 0);
    }
    if (sig === ammoSig) return;
    ammoSig = sig;
    renderHotbar();
  }

  // money delta: flash a floating +$/-$ when cash changes, GTA-style
  let lastCash = null;
  function showMoney() {
    const c = g.cash || 0;
    cashEl.textContent = "$" + c.toLocaleString();
    if (lastCash != null && c !== lastCash && deltaEl) {
      const d = c - lastCash;
      deltaEl.textContent = (d > 0 ? "+$" : "-$") + Math.abs(d).toLocaleString();
      deltaEl.style.color = d > 0 ? "#7ed957" : "#ff6b6b";
      deltaEl.style.animation = "none"; void deltaEl.offsetWidth;   // restart
      deltaEl.style.animation = "cDeltaUp 1.1s ease-out forwards";
      cashEl.style.animation = "none"; void cashEl.offsetWidth;
      cashEl.style.animation = "cMoneyPulse .4s ease-out";
    }
    lastCash = c;
  }

  function renderText() {
    build();
    showMoney();
    // wanted meter — GTA convention: it only appears once you HAVE a level, and
    // flashes while heat is actively climbing (a manhunt) so it grabs the eye.
    const w = g.wanted | 0;
    if (w > 0) {
      starsWrap.style.display = "inline-block";
      let s = "";
      for (let i = 1; i <= 5; i++) s += i <= w ? "<span style='color:#ffd166;text-shadow:0 0 8px rgba(255,209,102,.6)'>★</span>" : "<span style='color:#4a4f57'>★</span>";
      starsEl.innerHTML = s;
      const hot = (g.heat || 0) > 0 && w >= (g._wantedPeak || 0);
      starsWrap.style.animation = hot ? "cStarFlash .7s steps(1,end) infinite" : "none";
    } else { starsWrap.style.display = "none"; starsWrap.style.animation = "none"; }
    const crew = g.cityCrew || 0, bank = g.cityBank || 0, resp = g.respect || 0;
    // The street-rank ladder is retired (promotion.js cityStreetRank() now returns
    // null). The gang-membership BADGE (renderMemb) is the single rank/standing
    // surface, so the old 🏷 chip is gone — this chip only carries crew / respect /
    // bank now, and self-hides (empty string) when none of those exist.
    crewEl.innerHTML =
      (crew ? "<span style='color:#ffd451'>👥 " + crew + "</span>   " : "") +
      (resp ? "<span style='color:#c9a0ff'>★ " + Math.round(resp) + "</span>   " : "") +
      (bank ? "<span style='color:#7ed957'>🏦 $" + bank.toLocaleString() + "</span>" : "");
    // DRIP — your visible status, the club's velvet-rope gate. Reads the EQUIPPED
    // outfit via CBZ.cityPlayerDrip (economy.js, guarded); equipping clothes fires
    // cityHudDirty() so this re-runs the moment a fit changes. Tints by how it sits
    // against the bouncer's thresholds so the number TEACHES the player to dress up:
    //   grey  = under CLUB_DRIP (turned away)   green = clears the rope   gold = VIP.
    if (dripEl) {
      if (CBZ.cityPlayerDrip) {
        const drip = CBZ.cityPlayerDrip() | 0;
        const club = (CBZ.CITY && CBZ.CITY.CLUB_DRIP) || 30, vip = (CBZ.CITY && CBZ.CITY.VIP_DRIP) || 70;
        const col = drip >= vip ? "#ffd451" : drip >= club ? "#7ed957" : "#9fb0c6";
        const tag = drip >= vip ? "  <span style='color:#ffd451'>VIP</span>" : drip >= club ? "  <span style='color:#7ed957'>✓</span>" : "";
        dripEl.style.color = col;
        dripEl.innerHTML = "✨ DRIP " + drip + tag;
        dripEl.style.display = "block";
      } else {
        dripEl.style.display = "none";
      }
    }
    if (worldEl) worldEl.textContent = CBZ.cityWorldSummary ? CBZ.cityWorldSummary() : "";
    // WEAPON HOTBAR + carried loot — reads the engine's authoritative weapon state
    // (CBZ.weaponInventory / currentWeaponId / CBZ.fps ammo) so the city loadout is
    // as clear as jail's: every gun you own as a slot, the held one lit, live ammo.
    // The engine's #weaponStrip/#ammo are hidden in city (css/city.css), so this is
    // the single weapon readout — no double display to fight.
    renderHotbar();
    renderLoot();
    // job
    const j = g.cityJob;
    if (j) {
      let dist = "";
      if (j.dest) dist = "  ·  " + Math.round(Math.hypot(CBZ.player.pos.x - j.dest.x, CBZ.player.pos.z - j.dest.z)) + "m";
      else if ((j.type === "hit" || j.type === "hitman") && j.target && !j.target.dead) dist = "  ·  " + Math.round(Math.hypot(CBZ.player.pos.x - j.target.pos.x, CBZ.player.pos.z - j.target.pos.z)) + "m";
      jobEl.innerHTML = "🎯 " + j.desc + " <span style='color:#7ed957'>($" + j.reward + ")</span>" + (dist ? "<span style='color:#9fb0c6'>" + dist + "</span>" : "");
      jobEl.style.display = "block";
      if (objEl) objEl.style.display = "none";   // a real job pre-empts the gang-join objective
    } else {
      jobEl.style.display = "none";
      renderObjective();   // surface the active gang-join task instead
    }
    dirty = false;
  }

  CBZ.onAlways(46, function () {
    build();
    const show = g.mode === "city";
    root.style.display = show ? "block" : "none";
    document.body.classList.toggle("mode-city", show);
    if (!show) return;
    // track the wanted peak so the flashing only fires while it's RISING/held
    const w = g.wanted | 0;
    if (w > (g._wantedPeak || 0)) g._wantedPeak = w; else if (w === 0) g._wantedPeak = 0;
    if (dirty) renderText();
    // bars + live job distance update every frame (cheap)
    const P = CBZ.player, maxHp = P.maxHp || 100;
    hpBar.style.width = Math.max(0, Math.min(100, (P.hp / maxHp) * 100)) + "%";
    hungerBar.style.width = Math.max(0, Math.min(100, g.hunger || 0)) + "%";
    stamBar.style.width = Math.max(0, Math.min(100, (P.stamina == null ? 100 : P.stamina))) + "%";
    if (g.cityJob && (g.cityJob.dest || g.cityJob.type === "hit")) renderText();
    // keep the hotbar ammo live as you fire/reload (cheap: a signature guard means
    // it only touches the DOM when the held weapon's mag/reserve actually changed).
    refreshAmmoLive();
    pruneFeed(1 / 60);
    // speedometer when driving (the engine ammo readout sits elsewhere)
    if (speedEl) {
      const car = P.driving && P._vehicle;
      if (car && car.pos) {
        const mph = Math.round(Math.abs(car.v || 0) * 3);   // world units/s → rough mph (top coupe ~50u/s ≈ 150)
        speedEl.style.display = "block";
        const sn = speedEl.querySelector("#cSpeedN");
        if (sn) { sn.textContent = mph; sn.style.color = mph > 100 ? "#ff9e6b" : "#e8eef7"; }
      } else speedEl.style.display = "none";
    }
    // population headcount + kill feed (throttled — they change steadily, not
    // every frame; ~4Hz keeps phones smooth)
    popAcc += 1 / 60;
    if (popAcc >= 0.25) {
      popAcc = 0;
      renderPop(); renderKill();
      // wave-5 depth surfaces, all throttled here at ~4Hz (cheap on phones)
      renderTurfPay(); renderMemb(); renderRel(); renderPosture();
    }
    // radar (throttled), turf + home/partner status
    radarAcc += 1 / 60;
    if (radarAcc >= 1 / 14) { radarAcc = 0; drawRadar(); }
    if (turfEl) {
      const gang = CBZ.cityGangOf ? CBZ.cityGangOf(P.pos.x, P.pos.z) : null;
      if (gang) { const prov = gang.provoke > 0.4; turfEl.innerHTML = "<span style='color:#" + ("000000" + gang.color.toString(16)).slice(-6) + "'>" + gang.name.toUpperCase() + " TURF</span>" + (prov ? " <span style='color:#ff5b5b'>⚠ HOSTILE</span>" : ""); }
      else turfEl.textContent = "";
    }
    if (homeLineEl) {
      const parts = [];
      if (g.cityHome) parts.push("🏠 " + g.cityHome.name);
      else if (g.cityRentTier != null) parts.push("🏠 renting");
      if (g.cityPartner) parts.push((g.citySpouse ? "💍 " : "💕 ") + g.cityPartner.name + (g.cityPartner.kidnapped ? " (TAKEN!)" : ""));
      homeLineEl.textContent = parts.join("   ");
    }
    // aiming reticle when holding a firearm on foot — but the engine gun system
    // (fpsmode) draws its OWN reticle whenever it's presenting a weapon, so only
    // show the city dot when fpsmode is NOT (avoids two crosshairs).
    const cross = root.querySelector("#cCross");
    if (cross) {
      const it = CBZ.cityCurrentWeapon && CBZ.cityCurrentWeapon();
      const fpsAiming = (CBZ.weaponThirdPersonActive && CBZ.weaponThirdPersonActive()) || (CBZ.fpsActive && CBZ.fpsActive());
      cross.style.display = (it && it.gun && !fpsAiming && !P.driving && !P.dead && !CBZ.cityMenuOpen) ? "block" : "none";
    }
  });

  // ============================================================
  //  POLICE DISPATCH BANNER — the wanted ladder, EXPLAINED on screen.
  //  WHY: a star meter ticking up is abstract; a police-radio call that names
  //  the response makes the escalation legible and dread-building, and it answers
  //  the player's own question — "why is 5★ so hard?" Because each rung sends a
  //  heavier counter: foot units → cruisers → roadblocks (bridge sealed) → a
  //  helicopter → an AIRSTRIKE. It reads as a diegetic dispatch (the cops talking
  //  on the radio), never a fourth-wall tutorial popup.
  // ============================================================
  const DISPATCH = [
    null,
    { t: "DISPATCH", m: "All units — suspect on foot. Move in.", c: "#ffd451" },
    { t: "DISPATCH", m: "Cruisers responding. Box him in.", c: "#ffb14a" },
    { t: "ROADBLOCKS", m: "Set up blocks. Seal the bridge.", c: "#ff8b3c" },
    { t: "AIR SUPPORT", m: "Chopper dispatched — eyes in the sky.", c: "#ff6a4a" },
    { t: "⚠ CODE BLACK", m: "Airstrike authorized. Level the block.", c: "#ff3b30" },
  ];
  let dispEl = null, lastStar = 0, dispT = 0;
  function dispatchBanner() {
    if (dispEl) return dispEl;
    dispEl = document.createElement("div");
    dispEl.id = "cDispatch";
    dispEl.style.cssText = "position:fixed;left:50%;top:84px;transform:translate(-50%,-12px);z-index:22;" +
      "pointer-events:none;opacity:0;transition:opacity .3s ease, transform .3s ease;" +
      "text-align:center;font-family:Fredoka,system-ui,sans-serif;text-shadow:0 2px 8px rgba(0,0,0,.8)";
    document.body.appendChild(dispEl);
    return dispEl;
  }
  function showDispatch(star) {
    const d = DISPATCH[Math.max(1, Math.min(5, star))]; if (!d) return;
    const e = dispatchBanner();
    e.innerHTML = "<div style='font-size:13px;font-weight:700;letter-spacing:3px;color:" + d.c + "'>📻 " + d.t + " — " + star + "★</div>" +
      "<div style='font-size:16px;font-weight:600;color:#f2f6ff;margin-top:2px'>" + d.m + "</div>";
    e.style.opacity = "1"; e.style.transform = "translate(-50%,0)";
    dispT = 3.4;
    if (CBZ.sfx) CBZ.sfx(star >= 4 ? "alarm" : "radio");
  }
  CBZ.onUpdate(46.5, function (dt) {
    if (g.mode !== "city") { if (dispEl) dispEl.style.opacity = "0"; lastStar = 0; return; }
    const star = Math.floor((g.wanted || 0) + 1e-6);
    if (star > lastStar && star >= 1) showDispatch(star);   // only on ESCALATION
    lastStar = star;
    if (dispT > 0) { dispT -= dt; if (dispT <= 0 && dispEl) { dispEl.style.opacity = "0"; dispEl.style.transform = "translate(-50%,-12px)"; } }
  });
})();
