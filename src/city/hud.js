/* ============================================================
   city/hud.js — the CITY heads-up display: cash, the 5-star wanted
   meter, health / hunger / stamina bars, equipped weapon + ammo, and
   the active-job objective line with distance. Self-contained overlay
   shown only in city mode (prison/survival HUD is hidden via .mode-city).

   GTA-clean pass: money flashes a +/- delta on change, the wanted meter
   only shows when you HAVE a level (and flashes while heat is rising),
   the radar is the RDR2-style bottom-left instrument cluster (circular
   heading-up map + slim vitals beside it, turf/home lines stacked above),
   with a compass tick + your-car + crew + cop-direction blips + a
   speedometer when driving + speed-based zoom in a car, and a tidy
   city event feed (CBZ.cityFeed) stacks recent street events down the
   left without fighting the engine's global toast.

   PROFESSIONAL PASS — WHY: mixed opacities, emoji-stat wallpaper and
   duplicate readouts are the #1 amateur tell, and screen space belongs to
   the world. Tokens (css/hud.css :root, mirrored on #cityHud): one inset
   (--hud-pad + safe-area), ONE panel rgba, one radius, EXACTLY three
   opacity levels (chrome .55 / content .85 / alert 1), single-purpose
   semantic colors (money-green = cash ONLY, gold = wanted/rank ONLY) and
   one cyan accent for anything interactive. Counters use tabular numerals;
   a value that CHANGES brightens then settles back to chrome
   (flashThenFade). De-fluffed: crew chip is a labeled count only (respect/
   bank live on the phone + leaderboard), no always-on DRIP line (the
   boutique/rope owns it), no population bar under the count, no melee
   caption under the lit chip, no default prospect checklist, no ✨/• chip
   decorations, no star suffix on dispatch calls.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  let root, cashEl, deltaEl, starsEl, starsWrap, hpBar, hungerBar, stamBar, wpnEl, jobEl, crewEl, worldEl, radar, turfEl, homeLineEl, feedEl, speedEl;
  let armBar, armRowEl, armLabEl;   // ARMOR bar (the steel/blue outer-layer gauge under HP)
  let slotsEl, ammoLineEl, lootEl;   // weapon hotbar (slots + ammo) + carried-loot row
  let objEl, objTxtEl, objRouteEl, objSlotEl, objFillEl;   // retired prospect objective shell
  let popEl, killEl;
  // wave-5 depth surfaces (all contextual — hidden unless currently relevant)
  let turfPayEl;            // tiny "+$x/min" tag under the money readout
  let membEl, membFillEl;   // gang-membership badge + its promotion sliver
  let relEl;                // single-ped relationship chip (aim/near target)
  let postWrap, postYouEl, postFoeEl, postFoeNameEl;  // melee posture bars
  let dirty = true;
  // ---- MINECRAFT-STYLE HUD (owner ask: "inventory on screen and health and
  //      hunger just like Minecraft"). Hearts / drumsticks / armor-plate icon
  //      rows above a square-slot hotbar. One-line revert: CBZ.CONFIG.CITY_HUD_MC
  //      = false restores the slim vitals bars + pill hotbar chips exactly.
  if (CBZ.CONFIG && CBZ.CONFIG.CITY_HUD_MC == null) CBZ.CONFIG.CITY_HUD_MC = true;
  let mcHeartsEl, mcFoodEl, mcArmRowEl, mcArmIconsEl, mcArmLabEl, mcStamFEl;   // MC vitals cluster
  let mcApplied = null, mcSig = "", mcStamLast = -1, mcArmLabLast = null;      // MC render guards

  function build() {
    if (root) return;
    // one-time keyframes for the money pulse + delta float (cheap, GPU-friendly)
    if (!document.getElementById("cHudCss")) {
      const st = document.createElement("style");
      st.id = "cHudCss";
      st.textContent =
        // ---- design TOKENS — mirror of css/hud.css :root, scoped onto the
        //      overlay root so the city HUD stays coherent whatever the sheet
        //      order. ONE inset, ONE panel rgba, ONE radius, ONE interactive
        //      accent (cyan), and EXACTLY three opacity levels: chrome .55
        //      (always-on furniture), content .85 (live readouts), alert 1
        //      (act-now). Semantic colors are single-purpose — money-green is
        //      cash ONLY, gold is wanted/rank ONLY, red health, blue armor.
        "#cityHud{--hud-pad:14px;--hud-pad-t:calc(var(--hud-pad) + env(safe-area-inset-top,0px));--hud-pad-r:calc(var(--hud-pad) + env(safe-area-inset-right,0px));--hud-pad-b:calc(var(--hud-pad) + env(safe-area-inset-bottom,0px));--hud-pad-l:calc(var(--hud-pad) + env(safe-area-inset-left,0px));--panel-bg:rgba(8,11,17,.55);--radius:9px;--hud-line:rgba(232,236,242,.12);--hud-ink:#e8ecf2;--hud-dim:#9fb0c6;--hud-accent:#7de7ff;--money:#7ed957;--gold:#ffd166;--health:#ff5b5b;--armor:#7fd0ff;--o-chrome:.55;--o-content:.85;--o-alert:1}" +
        // tabular numerals so money/ammo/level/speed counters never jitter
        "#cHud{font-variant-numeric:tabular-nums}" +
        // the ONLY three opacity levels in the HUD (flashThenFade lifts a changed
        // value to alert, then lets it settle back to its resting class)
        "#cHud .oC{opacity:var(--o-chrome,.55)}" +
        "#cHud .oM{opacity:var(--o-content,.85)}" +
        "#cHud .oA{opacity:var(--o-alert,1)}" +
        "@keyframes cMoneyPulse{0%{transform:scale(1)}35%{transform:scale(1.14)}100%{transform:scale(1)}}" +
        "@keyframes cDeltaUp{0%{opacity:0;transform:translateY(6px)}18%{opacity:1}100%{opacity:0;transform:translateY(-16px)}}" +
        "@keyframes cStarFlash{0%,100%{opacity:1}50%{opacity:.35}}" +
        "@keyframes cFeedIn{0%{opacity:0;transform:translateX(-14px)}100%{opacity:1;transform:translateX(0)}}" +
        "@keyframes cKillIn{0%{opacity:0;transform:translateX(12px)}100%{opacity:1;transform:translateX(0)}}" +
        "@keyframes cPopPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}" +
        "#cHud .cPanel{background:var(--panel-bg);border:1px solid var(--hud-line);border-radius:var(--radius);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}" +
        "#cHud .cFeedRow{animation:cFeedIn .22s ease-out;background:var(--panel-bg);border-left:3px solid var(--hud-dim);border-radius:4px;padding:4px 9px;margin-top:5px;color:var(--hud-ink);font-size:13px;line-height:1.25;max-width:300px;box-shadow:0 2px 6px rgba(0,0,0,.35)}" +
        // population headcount pill — the battle-royale-style live count (the
        // count alone is the signal; the old bar under it was wallpaper — F4)
        "#cHud .cPop{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:var(--radius);background:var(--panel-bg);border:1px solid var(--hud-line);box-shadow:0 2px 8px rgba(0,0,0,.4)}" +
        "#cHud .cPop .dot{width:8px;height:8px;border-radius:50%;background:var(--health);box-shadow:0 0 7px rgba(255,91,91,.8)}" +
        "#cHud .cPop b{font-size:18px;font-weight:700;color:var(--hud-ink);letter-spacing:.4px}" +
        "#cHud .cPop .tot{font-size:12px;color:var(--hud-dim)}" +
        // hud-local kill feed (fallback when turf.js's feed isn't mounted)
        "#cHud .cKillRow{animation:cKillIn .2s ease-out;background:var(--panel-bg);border-right:3px solid #c33;border-radius:4px;padding:2px 9px;margin-top:4px;color:var(--hud-dim);font-size:12px;line-height:1.3;text-align:right;box-shadow:0 2px 6px rgba(0,0,0,.4)}" +
        "#cHud .cKillRow b{color:var(--hud-ink)}" +
        "#cHud .cKillRow.you{border-right-color:var(--gold)}" +
        // --- wave-5 depth surfaces: gang badge, turf-pay tag, rel chip, posture ---
        // turf passive-income tag — the rate in cash green, right under the money.
        "#cHud .cTurfPay{display:inline-flex;align-items:center;gap:4px;margin-top:2px;padding:1px 7px;border-radius:var(--radius);background:var(--panel-bg);font-size:12px;font-weight:600;color:var(--money);text-shadow:0 1px 2px rgba(0,0,0,.6)}" +
        // gang-membership badge: a small chip with the gang colour, your rank, and
        // a hair-thin promotion sliver toward the next rung. Hidden when unaffiliated.
        "#cHud .cMemb{display:inline-flex;flex-direction:column;gap:3px;padding:5px 9px;border-radius:var(--radius);background:var(--panel-bg);border:1px solid var(--hud-line);box-shadow:0 2px 8px rgba(0,0,0,.4);max-width:200px}" +
        "#cHud .cMemb .row{display:flex;align-items:center;gap:6px;font-size:12px;line-height:1.1;white-space:nowrap}" +
        "#cHud .cMemb .gdot{width:9px;height:9px;border-radius:50%;flex:none;box-shadow:0 0 6px rgba(0,0,0,.5)}" +
        "#cHud .cMemb .gnm{font-weight:700;color:var(--hud-ink);letter-spacing:.3px;overflow:hidden;text-overflow:ellipsis;max-width:118px}" +
        "#cHud .cMemb .rnk{color:var(--gold);font-weight:700}" +
        // progress slivers are interactive-chrome accent (a gold→green gradient
        // here used to borrow BOTH reserved semantics at once)
        "#cHud .cMemb .pslot{height:3px;border-radius:2px;background:var(--hud-line);overflow:hidden}" +
        "#cHud .cMemb .pslot>i{display:block;height:100%;background:var(--hud-accent);transition:width .4s ease}" +
        // single-ped relationship chip (contextual to the ONE ped you target)
        "#cHud .cRel{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:var(--radius);background:var(--panel-bg);border:1px solid var(--hud-line);font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.45);white-space:nowrap}" +
        "#cHud .cRel .nm{color:var(--hud-ink);font-weight:600;max-width:120px;overflow:hidden;text-overflow:ellipsis}" +
        "#cHud .cRel .lab{font-weight:700}" +
        // melee posture bars (you vs current foe) — slim, only during a fight
        "#cHud .cPost{display:flex;flex-direction:column;gap:5px;padding:6px 10px;border-radius:var(--radius);background:var(--panel-bg);border:1px solid var(--hud-line);box-shadow:0 2px 8px rgba(0,0,0,.45);min-width:150px}" +
        "#cHud .cPost .lbl{font-size:10px;font-weight:700;letter-spacing:.6px;color:var(--hud-dim);display:flex;justify-content:space-between;align-items:baseline}" +
        "#cHud .cPost .pbar{height:6px;border-radius:4px;background:var(--hud-line);overflow:hidden}" +
        "#cHud .cPost .pbar>i{display:block;height:100%;transition:width .12s linear}" +
        "#cHud .cPost .you>i{background:linear-gradient(90deg,#39c0d0,#7fe0ff)}" +
        "#cHud .cPost .foe>i{background:linear-gradient(90deg,#ff8b3c,#ffd166)}" +
        "#cHud .cPost .brk>i{background:linear-gradient(90deg,#ff5b5b,#ff9e6b)!important;animation:cStarFlash .5s steps(1,end) infinite}" +
        // --- WEAPON HOTBAR (bottom-centre): jail-clear loadout. A row of slots, one
        // per OWNED gun (+ a Fists slot when unarmed), the held one lit, with the
        // engine's live mag/reserve ammo for the equipped weapon underneath. ------
        "#cHud .cBar{display:flex;flex-direction:column;align-items:center;gap:5px}" +
        "#cHud .cSlots{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;max-width:560px}" +
        // chips are CLICKABLE — opt back into pointer-events (the HUD root is
        // pointer-events:none) so a tap dispatches CBZ.cityHotbarSelect. The
        // leading position is the HOLSTER/fists chip; item chips reuse the gun
        // chip frame with a tiny ×count badge so the unified bar reads as one row.
        "#cHud .cSlot{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:46px;height:42px;padding:3px 7px;border-radius:var(--radius);background:var(--panel-bg);border:1px solid var(--hud-line);box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:auto;cursor:pointer}" +
        "#cHud .cSlot .s{font-size:14px;font-weight:700;color:var(--hud-dim);line-height:1.1;letter-spacing:.3px}" +
        "#cHud .cSlot .key{position:absolute;left:3px;top:1px;font-size:8px;font-weight:800;color:var(--hud-dim);line-height:1}" +
        "#cHud .cSlot>.ic{font-size:18px;line-height:1}" +
        "#cHud .cSlot .ic.gun{font-size:20px;line-height:1;color:var(--hud-ink);transform:scaleX(1.25)}" +
        "#cHud .cSlot .a{font-size:10px;color:var(--hud-dim);line-height:1.1;margin-top:1px}" +
        "#cHud .cSlot .a.dry{color:#ff7a6a;font-weight:700;letter-spacing:.5px}" +
        // item chip: a glyph (or short name) over a small ×count badge, sharing
        // the gun chip's frame so the bar stays one visual run.
        "#cHud .cSlot.item .ic{font-size:18px;line-height:1.05}" +
        "#cHud .cSlot.item .s{font-size:11px}" +
        "#cHud .cSlot .cnt{position:absolute;right:2px;top:1px;font-size:9px;font-weight:700;color:var(--hud-ink);background:rgba(8,11,17,.85);border-radius:6px;padding:0 3px;line-height:1.3}" +
        // the held slot is a SELECTION (interactive chrome) → the one cyan accent,
        // same for guns and melee. The old green/orange split spent the cash and
        // heat semantics on a highlight that just means "in hand".
        "#cHud .cSlot.held{border-color:var(--hud-accent);box-shadow:0 0 0 1px rgba(125,231,255,.35),0 2px 10px rgba(0,0,0,.5)}" +
        "#cHud .cSlot.held .s{color:var(--hud-ink);text-shadow:0 0 8px rgba(125,231,255,.4)}" +
        "#cHud .cSlot.held .a{color:var(--hud-ink)}" +
        // the equipped-weapon ammo line under the slots: big mag / reserve, jail-style.
        "#cHud .cAmmo{font-size:13px;color:var(--hud-ink);font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,.7)}" +
        "#cHud .cAmmo b{font-size:20px;color:var(--hud-ink);font-weight:700}" +
        "#cHud .cAmmo .res{color:var(--hud-dim);font-weight:600}" +
        "#cHud .cAmmo .rl{color:var(--gold)}" +
        "#cHud .cAmmo .arm{color:var(--armor)}" +
        // --- carried LOOT readout (above the hotbar): drugs / valuables /
        // consumables you're holding, with counts. Compact chips; hidden when empty.
        // one line, NEVER wraps — a second row used to climb into the centre
        // toast ("Wallet" floating over dispatch lines). Tail rolls into "+N".
        "#cHud .cLoot{display:flex;gap:5px;justify-content:center;flex-wrap:nowrap;max-width:520px;margin-bottom:1px;white-space:nowrap}" +
        "#cHud .cLoot .it{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:var(--radius);background:var(--panel-bg);border:1px solid var(--hud-line);font-size:12px;color:var(--hud-ink);box-shadow:0 1px 5px rgba(0,0,0,.35)}" +
        "#cHud .cLoot .it b{color:var(--hud-ink);font-weight:700}" +
        "#cHud .cLoot .it .x{color:var(--hud-dim);font-weight:600}" +
        // --- VITALS rows (bottom-left cluster, beside the minimap): micro label +
        // slim fill — RDR2-compact, no fat 12px slabs. Labels right-align against
        // the bars so the column reads as one edge.
        "#cHud .vRow{display:flex;align-items:center;gap:6px;margin-top:6px}" +
        "#cHud .vRow:first-child{margin-top:0}" +
        "#cHud .vLab{flex:none;width:32px;font-size:9px;font-weight:700;letter-spacing:.8px;text-align:right;text-shadow:0 1px 2px rgba(0,0,0,.8)}" +
        "#cHud .vSlot{flex:1;background:rgba(0,0,0,.5);border-radius:4px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.07)}" +
        // coordinate with turf.js's overlays (loaded BEFORE us): nudge its kill
        // feed down so it clears our top-right money/pop stack, and cap its width
        // so a long name never reaches the centre. One cohesive, non-overlapping HUD.
        "#cKillFeed{top:230px !important;width:212px !important}" +
        // --- MINECRAFT-STYLE HUD (CITY_HUD_MC): the .mc class on #cityHud flips
        //     the whole skin — hearts left / drumsticks right in two icon rows
        //     riding the hotbar's width, armor plates above the hearts, stamina
        //     a slim sliver under them, square MC slots. Flag off = classic bars
        //     (these selectors simply never match). Icon art itself (SVG data-
        //     URIs) is appended by mcIconCss() at the sheet's tail.
        "#cHud #cMcVit{display:none}" +
        "#cityHud.mc #cMcVit{display:flex;flex-direction:column;align-items:stretch;align-self:stretch;gap:3px;margin-bottom:2px}" +
        "#cityHud.mc #cVitals{display:none}" +
        "#cityHud.mc .mcRow{display:flex;gap:2px}" +
        "#cityHud.mc .mcI{width:18px;height:16px;flex:none;background-repeat:no-repeat;background-size:100% 100%;filter:drop-shadow(0 1px 1px rgba(0,0,0,.65))}" +
        "#cityHud.mc .mcMid{display:flex;justify-content:space-between;align-items:flex-end;gap:14px}" +
        "#cityHud.mc .mcColL{display:flex;flex-direction:column;gap:2px}" +
        "#cityHud.mc #cMcFood{justify-content:flex-end}" +
        "#cityHud.mc #cMcArmRow{align-items:center;gap:8px}" +
        "#cityHud.mc .mcLab{font-size:11px;font-weight:700;color:#c9d4e0;letter-spacing:.4px;text-shadow:0 1px 2px rgba(0,0,0,.8);white-space:nowrap}" +
        "#cityHud.mc .mcStamSlot{height:3px;border-radius:2px;background:rgba(0,0,0,.55);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}" +
        "#cityHud.mc .mcStamSlot>i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#39c0d0,#7fe0ff)}" +
        // low health (< 3 hearts): a soft per-heart jitter, pure CSS, staggered
        // by nth-child so the row wobbles like MC rather than bouncing as a slab
        "@keyframes mcHeartBeat{0%,100%{transform:translateY(0)}20%{transform:translateY(-2px)}60%{transform:translateY(1px)}}" +
        "#cityHud.mc #cMcHearts.low .mcI{animation:mcHeartBeat .55s ease-in-out infinite}" +
        "#cityHud.mc #cMcHearts.low .mcI:nth-child(2n){animation-delay:.14s}" +
        "#cityHud.mc #cMcHearts.low .mcI:nth-child(3n){animation-delay:.28s}" +
        // MC hotbar skin: fixed square slots with a sunken bevel; the SELECTED
        // slot gets the thick light frame + slight scale. Same ids / markup /
        // click delegation as the pill chips — this is CSS-only reskinning.
        "#cityHud.mc .cSlot{width:44px;height:44px;min-width:44px;box-sizing:border-box;padding:2px;border-radius:3px;background:rgba(10,12,16,.66);border:2px solid #0a0c10;box-shadow:inset 2px 2px 0 rgba(0,0,0,.5),inset -2px -2px 0 rgba(255,255,255,.10),0 2px 6px rgba(0,0,0,.45);transition:transform .07s ease}" +
        "#cityHud.mc .cSlot.held{border-color:#e8ecf2;box-shadow:0 0 0 2px rgba(232,236,242,.85),inset 2px 2px 0 rgba(0,0,0,.35),inset -2px -2px 0 rgba(255,255,255,.14);transform:scale(1.1);z-index:1}" +
        "#cityHud.mc .cSlot .s{font-size:12px;letter-spacing:0}" +
        "#cityHud.mc .cSlot.item .ic{font-size:20px}" +
        "#cityHud.mc .cSlot.item .s{font-size:10px}" +
        "#cityHud.mc .cSlot .a{margin-top:0;font-size:9px}" +
        "#cityHud.mc .cSlot .cnt{top:auto;bottom:1px;right:3px;font-size:10px;background:none;padding:0;text-shadow:1px 1px 0 #000,0 0 3px #000}" +
        "#cityHud.mc .cSlots{gap:3px}" +
        // keep the melee-posture/relationship contextual stack clear of the
        // taller bottom-centre cluster (inline bottom:122px needs the !important)
        "#cityHud.mc #cCtx{bottom:170px !important}" +
        // --- SMALL SCREENS: the bottom-centre stack (loot+slots+ammo) must never
        // collide or spill — shrink chips/slots/fonts under 900px wide / 560px tall.
        "@media (max-width:900px),(max-height:560px){" +
        "  #cHud .cLoot{max-width:340px;gap:4px}" +
        "  #cHud .cLoot .it{font-size:10px;padding:1px 6px;gap:3px}" +
        "  #cHud .cSlots{gap:4px;max-width:380px}" +
        "  #cHud .cSlot{min-width:38px;height:34px;padding:2px 5px}" +
        "  #cHud .cSlot .s{font-size:11px}" +
        "  #cHud .cSlot.item .ic{font-size:15px}" +
        "  #cHud .cSlot.item .s{font-size:9px}" +
        "  #cHud .cSlot .cnt{font-size:8px}" +
        "  #cHud .cAmmo{font-size:11px}" +
        "  #cHud .cAmmo b{font-size:15px}" +
        "  #cMoney{font-size:24px !important}" +
        // bottom-left cluster shrinks as a unit so it never reaches the hotbar:
        // CSS-scale the canvas (the 190px backing store just downsamples) and
        // pull the vitals/turf/home/badge offsets in to match.
        "  #cityHud #cRadar{width:146px;height:146px}" +
        "  #cHud #cVitals{left:calc(var(--hud-pad-l) + 154px) !important;width:92px !important;bottom:calc(var(--hud-pad-b) + 8px) !important}" +
        "  #cHud #cTurf{bottom:calc(var(--hud-pad-b) + 152px) !important;font-size:11px !important}" +
        "  #cHud #cHomeLine{bottom:calc(var(--hud-pad-b) + 168px) !important;font-size:11px !important}" +
        "  #cHud #cMemb{bottom:calc(var(--hud-pad-b) + 186px) !important}" +
        // MC skin shrinks with the same breakpoint: ~36px slots, 14px icons
        "  #cityHud.mc .cSlot{width:36px;height:36px;min-width:36px}" +
        "  #cityHud.mc .cSlot .s{font-size:10px}" +
        "  #cityHud.mc .cSlot.item .ic{font-size:16px}" +
        "  #cityHud.mc .mcI{width:14px;height:12px}" +
        "  #cityHud.mc .mcMid{gap:10px}" +
        "  #cityHud.mc #cCtx{bottom:150px !important}" +
        "}" + mcIconCss();
      document.head.appendChild(st);
    }
    root = document.createElement("div");
    root.id = "cityHud";
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:20;display:none;font-family:Fredoka,system-ui,sans-serif";
    root.innerHTML =
      "<div id='cHud' style='position:absolute;inset:0'>" +
      // top-right stack — dropped to top:54px so it never collides with the
      // takeover meta bar (turf.js #cTurfMeta sits at top:6px, ~48px tall).
      // The whole column idles at chrome opacity; money lifts on change.
      // #cTopRight: named so css/campaign.css can exempt the WANTED star meter
      // from the campaign declutter (the stars live in this column).
      "<div id='cTopRight' style='position:absolute;top:54px;right:var(--hud-pad-r);text-align:right;max-width:248px'>" +
      "  <div class='cPop oM' id='cPop' style='display:none'><span class='dot'></span><b id='cPopN'>0</b><span class='tot' id='cPopTot'></span></div>" +
      "  <div style='position:relative;display:inline-block;margin-top:6px'>" +
      "    <div id='cMoney' class='oC' style='font-size:32px;font-weight:700;color:var(--money);text-shadow:0 2px 0 #1f5a2a,0 0 14px rgba(126,217,87,.35)'>$0</div>" +
      "    <div id='cDelta' style='position:absolute;right:0;top:-6px;font-size:18px;font-weight:700;opacity:0;pointer-events:none'></div>" +
      "  </div>" +
      "  <div id='cTurfPay' class='cTurfPay oC' style='display:none'></div>" +
      "  <div id='cStarsWrap' class='oA' style='display:none;margin-top:4px;padding:2px 8px;border-radius:var(--radius);background:var(--panel-bg)'><span id='cStars' style='font-size:23px;letter-spacing:3px'></span></div>" +
      // crew headcount only, labeled (F1) — respect + bank read on the phone /
      // leaderboard, where they're actionable; an always-on ★ here clashed with
      // the wanted ★ a few px away.
      "  <div id='cCrew' class='oC' style='font-size:13px;color:var(--hud-dim);margin-top:3px'></div>" +
      // YOUR street read (level.js): the same LEVEL N the city floats over
      // everyone else's head, derived live from worth/heat/crew/bodies.
      "  <div id='cLvl' class='oC' style='display:none'></div>" +
      "  <div id='cWorld' class='oC' style='font-size:12px;color:var(--hud-dim);margin-top:2px;display:none'></div>" +
      "  <div id='cKill' class='oM' style='margin-top:7px;display:none'></div>" +
      "</div>" +
      // VITALS — RDR2-style compact cluster: three slim labeled bars stacked just
      // right of the minimap's lower edge, so the bottom-left corner reads as ONE
      // instrument (map + body state) instead of a pile. Bars are content-level;
      // they stay clear of the bottom-centre hotbar (capped width + media shrink).
      "<div id='cVitals' class='oM' style='position:absolute;left:calc(var(--hud-pad-l) + 200px);bottom:calc(var(--hud-pad-b) + 12px);width:124px'>" +
      "  <div class='vRow'><span class='vLab' style='color:#ffb3b3'>♥</span><div class='vSlot' style='height:7px'><div id='cHp' style='height:100%;width:100%;background:linear-gradient(90deg,#ff5b5b,#ff9e6b);transition:width .12s linear'></div></div></div>" +
      // ARMOR — the GTA-style outer layer: a distinct steel/blue plate gauge that
      // sits just under HP, shown ONLY when the player is wearing armor (driven by
      // CBZ.player._armor / ._armorMax). The 🛡 label carries the equipped tier name
      // (+ a ⛑ helmet glyph when _armorKit.head is set). Hidden whole when no armor.
      "  <div id='cArmRow' class='vRow' style='display:none'><span class='vLab' id='cArmLab' style='color:#a9c7ff'>🛡</span><div class='vSlot' style='height:7px'><div id='cArm' style='height:100%;width:100%;background:linear-gradient(90deg,#5b86c9,#a9c7ff);transition:width .12s linear'></div></div></div>" +
      "  <div class='vRow'><span class='vLab' style='color:#ffd9a8'>🍖</span><div class='vSlot' style='height:6px'><div id='cFood' style='height:100%;width:100%;background:linear-gradient(90deg,#e8a23c,#ffd166)'></div></div></div>" +
      "  <div class='vRow'><span class='vLab' style='color:#a8e0ff'>↯</span><div class='vSlot' style='height:5px'><div id='cStam' style='height:100%;width:100%;background:linear-gradient(90deg,#39c0d0,#7fe0ff)'></div></div></div>" +
      "</div>" +
      // WEAPON HOTBAR + carried-loot readout (bottom-centre). The hotbar is the
      // jail-clarity loadout: every gun you OWN as a slot, the held one lit, live
      // mag/reserve underneath. The loot row sits just above it. Slots + loot are
      // chrome; the live ammo line is content.
      "<div id='cWpn' class='cBar' style='position:absolute;left:50%;bottom:var(--hud-pad-b);transform:translateX(-50%)'>" +
      // MINECRAFT vitals cluster (CITY_HUD_MC): armor plates over hearts (+ a
      // stamina sliver) on the left, drumsticks right-aligned opposite — the
      // strip stretches to the hotbar's width and rides just above it. Icon
      // rows are BUILT ONCE (fillIcons) and only have classes toggled per
      // change. Hidden whole (and the classic #cVitals bars shown) when off.
      "  <div id='cMcVit' class='oM'>" +
      "    <div id='cMcArmRow' style='display:none'><div id='cMcArm' class='mcRow'></div><span id='cMcArmLab' class='mcLab'></span></div>" +
      "    <div class='mcMid'>" +
      "      <div class='mcColL'><div id='cMcHearts' class='mcRow'></div><div id='cMcStam' class='mcStamSlot'><i id='cMcStamF'></i></div></div>" +
      "      <div id='cMcFood' class='mcRow'></div>" +
      "    </div>" +
      "  </div>" +
      "  <div id='cLoot' class='cLoot oC' style='display:none'></div>" +
      "  <div id='cSlots' class='cSlots oC'></div>" +
      "  <div id='cAmmo' class='cAmmo oM'></div>" +
      "</div>" +
      "<div id='cSpeed' class='oM' style='position:absolute;right:var(--hud-pad-r);bottom:74px;text-align:right;color:var(--hud-ink);display:none'><span aria-hidden='true' style='font-size:16px;color:var(--hud-dim)'>↠</span> <span id='cSpeedN' style='font-size:30px;font-weight:700;text-shadow:0 2px 4px rgba(0,0,0,.6)'>0</span></div>" +
      "<div id='cJob' class='cPanel oM' style='position:absolute;top:var(--hud-pad-t);left:50%;transform:translateX(-50%);text-align:center;color:var(--hud-ink);font-size:14px;max-width:60%;padding:5px 14px;display:none'></div>" +
      // Retired prospect objective shell. Kept hidden so older references stay
      // harmless, but default story/prospect checklist text no longer reaches HUD.
      "<div id='cObj' class='cPanel oM' style='position:absolute;top:var(--hud-pad-t);left:50%;transform:translateX(-50%);text-align:center;color:var(--hud-ink);font-size:14px;max-width:62%;padding:5px 14px;display:none'>" +
      "  <span id='cObjTxt'></span> <span id='cObjRoute' style='pointer-events:auto;cursor:pointer;color:var(--hud-accent);font-weight:700;margin-left:6px'>↳ ROUTE</span>" +
      "  <div id='cObjSlot' style='height:3px;border-radius:2px;background:var(--hud-line);overflow:hidden;margin-top:5px'><i id='cObjFill' style='display:block;height:100%;width:0%;background:var(--hud-accent);transition:width .4s ease'></i></div>" +
      "</div>" +
      // MINIMAP — bottom-left, RDR2-style. The turf/home lines stack right above
      // it (the "region name over the map" read), the vitals hug its right edge.
      "<canvas id='cRadar' class='oM' width='190' height='190' style='position:absolute;left:var(--hud-pad-l);bottom:var(--hud-pad-b);border-radius:50%;box-shadow:0 6px 18px rgba(0,0,0,.5)'></canvas>" +
      // event feed takes the top-left corner the radar vacated
      // shifted RIGHT past the top-left character panel (#cpPanel is ~128px wide
      // at left:14) so street-event rows never overlap the player portrait/Lv/bounty.
      "<div id='cFeed' class='oM' style='position:absolute;left:calc(var(--hud-pad-l) + 150px);top:var(--hud-pad-t);width:300px'></div>" +
      "<div id='cTurf' class='oC' style='position:absolute;left:var(--hud-pad-l);bottom:calc(var(--hud-pad-b) + 196px);font-size:13px;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,.7)'></div>" +
      "<div id='cHomeLine' class='oC' style='position:absolute;left:var(--hud-pad-l);bottom:calc(var(--hud-pad-b) + 215px);font-size:12px;color:var(--hud-dim);text-shadow:0 1px 2px rgba(0,0,0,.7)'></div>" +
      // gang-membership badge (left column, capping the bottom-left cluster —
      // map → turf → home → crew badge). Hidden entirely unless patched into a crew.
      "<div id='cMemb' class='cMemb oC' style='position:absolute;left:var(--hud-pad-l);bottom:calc(var(--hud-pad-b) + 236px);display:none'>" +
      "  <div class='row'><span class='gdot' id='cMembDot'></span><span class='gnm' id='cMembNm'></span><span class='rnk' id='cMembRnk'></span></div>" +
      "  <div class='pslot' id='cMembSlot'><i id='cMembFill' style='width:0%'></i></div>" +
      "</div>" +
      // bottom-centre contextual zone: the relationship chip (when targeting one
      // ped) and the melee posture bars (only mid-fight, so alert level). Sits
      // between the bottom-left health stack and the hotbar — no overlap.
      "<div id='cCtx' style='position:absolute;left:50%;bottom:122px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none'>" +
      "  <div id='cPost' class='cPost oA' style='display:none'>" +
      "    <div class='lbl'><span>YOU</span><span id='cPostFoeNm' style='color:#ffb37a'></span></div>" +
      "    <div class='pbar you' id='cPostYou'><i style='width:0%'></i></div>" +
      "    <div class='pbar foe' id='cPostFoe'><i style='width:0%'></i></div>" +
      "  </div>" +
      "  <div id='cRel' class='cRel oM' style='display:none'><span class='nm' id='cRelNm'></span><span class='lab' id='cRelLab'></span></div>" +
      "</div>" +
      "<div id='cCross' class='oA' style='position:absolute;left:50%;top:50%;width:7px;height:7px;margin:-4px 0 0 -4px;border:2px solid rgba(232,236,242,.85);border-radius:50%;display:none'></div>" +
      "</div>";
    document.body.appendChild(root);
    cashEl = root.querySelector("#cMoney"); deltaEl = root.querySelector("#cDelta");
    starsEl = root.querySelector("#cStars"); starsWrap = root.querySelector("#cStarsWrap");
    crewEl = root.querySelector("#cCrew"); worldEl = root.querySelector("#cWorld");
    hpBar = root.querySelector("#cHp"); hungerBar = root.querySelector("#cFood"); stamBar = root.querySelector("#cStam");
    armBar = root.querySelector("#cArm"); armRowEl = root.querySelector("#cArmRow"); armLabEl = root.querySelector("#cArmLab");
    wpnEl = root.querySelector("#cWpn"); jobEl = root.querySelector("#cJob");
    slotsEl = root.querySelector("#cSlots"); ammoLineEl = root.querySelector("#cAmmo"); lootEl = root.querySelector("#cLoot");
    // MC vitals cluster — build the icon rows ONCE (12 hearts is the cap;
    // 10 shanks / 10 plates); per-frame code only toggles classes/display.
    mcHeartsEl = root.querySelector("#cMcHearts"); mcFoodEl = root.querySelector("#cMcFood");
    mcArmRowEl = root.querySelector("#cMcArmRow"); mcArmIconsEl = root.querySelector("#cMcArm"); mcArmLabEl = root.querySelector("#cMcArmLab");
    mcStamFEl = root.querySelector("#cMcStamF");
    fillIcons(mcHeartsEl, 12, "mcHrt"); fillIcons(mcFoodEl, 10, "mcFud"); fillIcons(mcArmIconsEl, 10, "mcArm");
    // CLICK-TO-SELECT on the unified hotbar (city-only). Chips carry data-bi (the
    // bar index); a tap routes straight to CBZ.cityHotbarSelect, which handles
    // holster / gun-select / item-use byte-identically. Delegated so re-rendered
    // chips stay live. Guarded like the key handlers (city + playing + no menu/map).
    if (slotsEl) slotsEl.addEventListener("click", function (ev) {
      const chip = ev.target && ev.target.closest ? ev.target.closest(".cSlot[data-bi]") : null;
      if (!chip) return;
      if (g.mode !== "city" || g.state !== "playing") return;
      if (CBZ.cityMenuOpen || (CBZ.fullMap && CBZ.fullMap.active)) return;
      const bi = parseInt(chip.getAttribute("data-bi"), 10);
      if (bi >= 0 && CBZ.cityHotbarSelect) { CBZ.cityHotbarSelect(bi); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
    });
    objEl = root.querySelector("#cObj"); objTxtEl = root.querySelector("#cObjTxt"); objRouteEl = root.querySelector("#cObjRoute");
    objSlotEl = root.querySelector("#cObjSlot"); objFillEl = root.querySelector("#cObjFill");
    if (objRouteEl) objRouteEl.addEventListener("click", routeToProspectHQ);
    radar = root.querySelector("#cRadar"); turfEl = root.querySelector("#cTurf"); homeLineEl = root.querySelector("#cHomeLine");
    feedEl = root.querySelector("#cFeed"); speedEl = root.querySelector("#cSpeed");
    popEl = root.querySelector("#cPop"); killEl = root.querySelector("#cKill");
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
    if (opts && opts.collapseOnly) return;
    if (typeof CBZ.cityPhoneWorthy === "function" && !CBZ.cityPhoneWorthy(msg, opts, false)) {
      renderFeed();
      return;
    }
    const payload = {
      app: (opts && opts.app) || "news",
      from: (opts && opts.from) || "City Desk",
      text: feedBase(msg),
    };
    if (typeof CBZ.cityPhoneNotify === "function") CBZ.cityPhoneNotify(payload);
    else if (CBZ.cityCampaignActive && CBZ.cityCampaignActive() && typeof CBZ.phoneNotify === "function") CBZ.phoneNotify(payload);
    renderFeed();
  };
  // world-FLAVOR lines (lore/ambience, nothing to act on) — a separate channel
  // so they can exist in code without ever reaching the HUD. Default OFF via
  // CBZ.CONFIG.CITY_FLAVOR_FEED (owner: "the HUD is not a tutorial space").
  CBZ.cityFlavor = function (msg, color) {
    if (CBZ.CONFIG && CBZ.CONFIG.CITY_FLAVOR_FEED) CBZ.cityFeed(msg, color);
  };
  function renderFeed() {
    if (!feedEl) return;
    feedEl.innerHTML = "";
    feedEl.style.display = "none";
  }
  let feedAcc = 0;
  function pruneFeed(dt) {
    feedAcc += dt;
    // prune cadence rides the perf/quality slider — tier0 drops to 2Hz (DOM
    // rewrites are pure main-thread cost), Best (tier 4) keeps today's 4Hz.
    if (feedAcc < 1 / (CBZ.qScale ? CBZ.qScale(2, 4) : 4)) return; feedAcc = 0;
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
    if (!CBZ.cityPopulation) { popEl.style.display = "none"; return; }
    const p = CBZ.cityPopulation();
    if (!p || !p.total) { popEl.style.display = "none"; return; }
    popEl.style.display = "inline-flex";
    const n = p.alive | 0;
    const nEl = popEl.querySelector("#cPopN"), totEl = popEl.querySelector("#cPopTot");
    if (nEl) nEl.textContent = n.toLocaleString();
    if (totEl) totEl.textContent = "";
    // a quick pulse whenever the count drops, so a massacre reads at a glance
    // (the count IS the signal — the old bar under it restated the same number)
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
    killSig = "";
    killEl.innerHTML = "";
    killEl.style.display = "none";
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
    // the RATE is the payoff; the zone count lives on the [M] territory board
    // where holding/taking turf is actually played (F5)
    turfPayEl.textContent = "+$" + perMin.toLocaleString() + " ◷";
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
  // sentiment tints deliberately avoid the reserved semantics (money-green,
  // armor-blue, wanted-gold) so a glance never lies about WHAT a color means
  const REL_COL = {
    "wants you dead": "#ff5b5b", "hates you": "#ff8b6b", "terrified of you": "#c9a0ff",
    "loves you": "#ff8bd0", "likes you": "#5ad17a", "respects you": "#8fb6ff",
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
  // smoothed view radius (world units). Tight on foot, wider at driving speed —
  // the RDR2/GTA trick that makes the next three turns readable from the map.
  let viewR = 100;
  function hex6n(c) { return "#" + ("000000" + ((c >>> 0) & 0xffffff).toString(16)).slice(-6); }
  // district ground tints — a faint per-quadrant personality wash (desaturated;
  // saturated colour stays reserved for territory + threats)
  const DIST_TINT = { core: "#39404d", commercial: "#383f48", residential: "#3a443d", projects: "#454039", industrial: "#413d43" };
  function drawRadar() {
    if (!radar) return;
    const ctx = radar.getContext("2d"); if (!ctx) return;
    const P = CBZ.player;
    const A = CBZ.city && CBZ.city.arena; if (!A) return;
    // ZOOM FEEL: on foot you care about the block (tight); in a car you care
    // about the next turns, more so the faster you go. Lerped at the radar's own
    // 14Hz so the scale change reads as a gentle breathe, never a snap.
    const car = P.driving && P._vehicle;
    const spd = (car && Math.abs(car.v || 0)) || 0;
    const targetR = car ? Math.min(190, 130 + spd) : 96;
    viewR += (targetR - viewR) * 0.16;
    const R = viewR;
    const W = radar.width, H = radar.height;
    const sc = (W / 2) / R, cx = W / 2, cy = H / 2;
    const px = P.pos.x, pz = P.pos.z;
    const g = CBZ.game, now = CBZ.now || 0;
    // wanted stars through the public accessor when present (guard-called — the
    // wanted system owns it); falls back to game.wanted. MAP_V2 default-on.
    let wanted = (g && g.wanted) || 0;
    try { if (CBZ.cityStars) wanted = CBZ.cityStars() | 0; } catch (e) {}
    const pulse = 0.5 + 0.5 * Math.sin(now * 6);
    // heading-up rotation: rotMap === camera yaw makes the player's forward
    // point to screen-up (derivation in commit msg). Blips rotate as POINTS in
    // JS (not the canvas) so every icon/label stays upright while the map turns;
    // the geometric base below uses a rotated CONTEXT instead (see note there).
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
    // SEA base — anything past the seawall reads as water, distinctly cool
    ctx.fillStyle = "#142b38"; ctx.fill();
    ctx.clip();

    // territory ownership (crew wash over the blocks) — the only "colour =
    // meaning" on the base layer, so you sense whose turf you're standing in
    const owner = new Map();
    if (CBZ.cityGangs) for (const gg of CBZ.cityGangs) {
      if (!gg || !gg.turf) continue; const oc = gg.isPlayer ? 0xffd451 : gg.color;
      for (const lot of gg.turf) owner.set(lot, oc);
    }
    const R2 = (R + 26) * (R + 26);
    const DQ = A.districts || [];

    // ---- GEOMETRIC BASE in a ROTATED CONTEXT: land/roads/blocks are axis-
    //      aligned world rects, so spinning the canvas keeps each one a single
    //      crisp fillRect/stroke. restore() before the blip layer so icons and
    //      the N label stay upright (the heading-up contract holds).
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(yaw);
    const u = (wx) => (wx - px) * sc, v = (wz) => (wz - pz) * sc;
    // land mass out to the seawall apron — terrain under the streets
    const SH = A.shore || { EW: A.minX - 26, EE: A.maxX + 26, ES: A.minZ - 26, EN: A.maxZ + 26 };
    ctx.fillStyle = "#272d35";
    ctx.fillRect(u(SH.EW), v(SH.ES), (SH.EE - SH.EW) * sc, (SH.EN - SH.ES) * sc);
    // the south beach gap: a thin sand strip straddling the seawall line
    if (SH.beach) { ctx.fillStyle = "rgba(199,178,124,.45)"; ctx.fillRect(u(SH.beach.x0), v(SH.ES - 10), (SH.beach.x1 - SH.beach.x0) * sc, 13 * sc); }
    // ---- NEIGHBOURING ISLANDS / BIOMES: the radar shouldn't end at the city's
    //      seawall — when you stand near the desert/forest/snow causeway you
    //      should SEE that land coming up. Each registered region paints as land
    //      + a sand coastline (distance-culled to ≤~12 nearby rects at 14Hz).
    const REGIONS = A.regions || [];
    if (REGIONS.length) {
      const palFn = (CBZ.fullMap && CBZ.fullMap.biomePal) || null;
      const FALLBACK = { desert: { fill: "#5a4f37" }, forest: { fill: "#2f4030" }, snow: { fill: "#5a6470" }, farmland: { fill: "#4a4a2e" }, speedway: { fill: "#403a44" }, airport: { fill: "#34373d" }, military: { fill: "#3a3f34" }, commerce: { fill: "#3a4636" }, _default: { fill: "#272d35" } };
      const palOf = (b) => (palFn ? palFn(b) : (FALLBACK[b] || FALLBACK._default));
      const isLinkR = (rg) => /causeway|bridge/i.test(rg.name || "") || (rg.pad != null && rg.pad <= 1);
      const cullR = R + 30;
      const inReg = CBZ.cityBiomeAt ? CBZ.cityBiomeAt(px, pz) : "city";
      const drawReg = (rg) => {
        if (isLinkR(rg)) { ctx.fillStyle = "rgba(170,150,110,.7)"; }
        else { ctx.fillStyle = palOf(rg.biome).fill; }
        if (rg.kind === "circle") {
          ctx.beginPath(); ctx.arc(u(rg.cx), v(rg.cz), rg.r * sc, 0, 6.28); ctx.fill();
          if (!isLinkR(rg)) { ctx.strokeStyle = "rgba(199,178,124,.5)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(u(rg.cx), v(rg.cz), rg.r * sc, 0, 6.28); ctx.stroke(); }
        } else {
          ctx.fillRect(u(rg.minX), v(rg.minZ), (rg.maxX - rg.minX) * sc, (rg.maxZ - rg.minZ) * sc);
          if (!isLinkR(rg)) { ctx.strokeStyle = "rgba(199,178,124,.5)"; ctx.lineWidth = 2; ctx.strokeRect(u(rg.minX), v(rg.minZ), (rg.maxX - rg.minX) * sc, (rg.maxZ - rg.minZ) * sc); }
        }
      };
      let here = null;
      for (let ri = 0; ri < REGIONS.length; ri++) {
        const rg = REGIONS[ri];
        const cxr = rg.kind === "circle" ? rg.cx : (rg.minX + rg.maxX) * 0.5;
        const czr = rg.kind === "circle" ? rg.cz : (rg.minZ + rg.maxZ) * 0.5;
        const half = rg.kind === "circle" ? rg.r : Math.max(rg.maxX - rg.minX, rg.maxZ - rg.minZ) * 0.5;
        const ddx = cxr - px, ddz = czr - pz;
        if (ddx * ddx + ddz * ddz > (cullR + half) * (cullR + half)) continue;
        // the region the player is INSIDE draws LAST so its tint wins at centre
        if (!isLinkR(rg) && rg.biome === inReg && inReg !== "city" && CBZ.cityRegionHit && CBZ.cityRegionHit(rg, px, pz, 0)) { here = rg; continue; }
        drawReg(rg);
      }
      if (here) drawReg(here);
    }
    function paintLots(list) {
      if (!list) return;
      for (const lot of list) {
        if (!lot) continue; const ddx = lot.cx - px, ddz = lot.cz - pz; if (ddx * ddx + ddz * ddz > R2) continue;
        const s = Math.max(3, (lot.w || 20) * sc), x = u(lot.cx), y = v(lot.cz);
        // faint district wash across the whole block pad…
        const dq = DQ[lot.district];
        const dk = dq && DIST_TINT[dq.kind];
        if (dk) { ctx.fillStyle = dk; ctx.globalAlpha = 0.55; ctx.fillRect(x - s / 2, y - s / 2, s, s); }
        // …a soft dark building mass inset on it…
        ctx.fillStyle = "#151a20"; ctx.globalAlpha = 0.8;
        const b = s * 0.74; ctx.fillRect(x - b / 2, y - b / 2, b, b);
        // …then the crew wash on top
        const oc = owner.get(lot);
        if (oc != null) { ctx.fillStyle = hex6n(oc); ctx.globalAlpha = oc === 0xffd451 ? 0.45 : 0.3; ctx.fillRect(x - s / 2, y - s / 2, s, s); }
      }
      ctx.globalAlpha = 1;
    }
    // ROADS read as STREETS: a dark casing pass then a light fill pass (the
    // classic GTA-map treatment); both passes batch every line in one stroke.
    function roadPass(col, w) {
      ctx.strokeStyle = col; ctx.lineWidth = w;
      ctx.beginPath();
      const e = (R + 30) * sc;
      for (const x of A.xLines) { ctx.moveTo(u(x), -e); ctx.lineTo(u(x), e); }
      for (const z of A.zLines) { ctx.moveTo(-e, v(z)); ctx.lineTo(e, v(z)); }
      ctx.stroke();
    }
    const roadW = Math.max(1.5, A.ROAD * sc * 0.85);
    roadPass("rgba(8,11,15,.65)", roadW + 2.5);
    roadPass("rgba(168,178,192,.42)", roadW);
    paintLots(A.lots);
    // island: sand-ringed land disc + its streets + the bridge (the chokepoint)
    if (A.annex) {
      const X = A.annex, xr = X.radius * sc;
      ctx.fillStyle = "#272d35"; ctx.beginPath(); ctx.arc(u(X.cx), v(X.cz), xr, 0, 6.28); ctx.fill();
      ctx.strokeStyle = "rgba(199,178,124,.55)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(u(X.cx), v(X.cz), xr, 0, 6.28); ctx.stroke();
      ctx.strokeStyle = "rgba(168,178,192,.38)"; ctx.lineWidth = Math.max(1, 5 * sc);
      ctx.beginPath();
      for (const r of X.roads) {
        if (r.vertical) { ctx.moveTo(u(r.x), v(r.z - r.len / 2)); ctx.lineTo(u(r.x), v(r.z + r.len / 2)); }
        else { ctx.moveTo(u(r.x - r.len / 2), v(r.z)); ctx.lineTo(u(r.x + r.len / 2), v(r.z)); }
      }
      ctx.stroke();
      paintLots(X.lots);
      if (A.bridge) {
        const bz = (A.bridge.minZ + A.bridge.maxZ) / 2;
        ctx.strokeStyle = wanted >= 3 ? "rgba(255,90,90,.85)" : "rgba(190,198,210,.6)"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(u(A.bridge.minX), v(bz)); ctx.lineTo(u(A.bridge.maxX), v(bz)); ctx.stroke();
      }
    }
    ctx.restore();   // drop rotation — blips/labels draw upright from here

    // soft vignette: the rim darkens so the centre (you) carries the eye — the
    // RDR2 aged-instrument read in our palette. Under the blip layers so threats
    // stay bright at the edge.
    const vg = ctx.createRadialGradient(cx, cy, W * 0.30, cx, cy, W / 2);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.45)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

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

    // ---- NOTABLE POIs near you (MAP_V2): mirrors the full map's icon language
    //      so the radar answers "what's around me" — casinos/banks/hospital/
    //      guns/gas/civic/venues as small trade-coloured diamonds (the same
    //      CBZ.fullMap.poi palette). Ordinary shops stay OFF the radar (they're
    //      the [M] map's job) so the instrument doesn't turn to measles. ----
    const MAPV2 = !CBZ.CONFIG || CBZ.CONFIG.MAP_V2 !== false;
    const NOTABLE = { casino: 1, bank: 1, hospital: 1, guns: 1, gas: 1, cityhall: 1, transit: 1, arena: 1, raceway: 1, racepark: 1, airfield: 1 };
    const poiFn = CBZ.fullMap && CBZ.fullMap.poi;
    if (MAPV2 && poiFn) {
      const shopLots = (A.shopLots && A.shopLots.length) ? A.shopLots : A.lots;
      for (const lot of shopLots || []) {
        if (!lot || !lot.building) continue;
        const k = (lot.building.shop && lot.building.shop.kind) || lot.kind;
        const info = poiFn(lot);
        if (!info || !(info.key || k === "casino" || NOTABLE[k])) continue;
        const dx = lot.cx - px, dz = lot.cz - pz; if (dx * dx + dz * dz > R2) continue;
        S(lot.cx, lot.cz);
        const big = info.key || k === "casino";
        diamond(_p[0], _p[1], info.color, big ? 3.6 : 2.6);
        if (k === "casino") { ctx.strokeStyle = "rgba(201,162,39,.9)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(_p[0], _p[1], 5.2, 0, 6.28); ctx.stroke(); }
      }
    }

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
    // waypoint reads as the loudest mark on the map: pulsing accent ring + dot
    if (wp) { blip(wp.x, wp.z, (x, y) => { ctx.strokeStyle = "#7de7ff"; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(x, y, 4.5 + pulse * 2, 0, 6.28); ctx.stroke(); ctx.fillStyle = "#7de7ff"; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, 6.28); ctx.fill(); }, true); }
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

    // round frame — dark instrument bezel + a hairline accent ring (RDR2's aged
    // brass ring, translated into the HUD's cyan-not-sepia design language)
    ctx.strokeStyle = wanted >= 4 ? "rgba(255,70,55,.75)" : "rgba(10,13,18,.85)"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 2, 0, 6.28); ctx.stroke();
    ctx.strokeStyle = wanted >= 4 ? "rgba(255,120,100,.5)" : "rgba(125,231,255,.22)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, W / 2 - 4.5, 0, 6.28); ctx.stroke();
    // NORTH pip — rotates with the heading-up map so it always points true north.
    // North is world -Z; through S that direction sits at (sinR, -cosR) from centre.
    const nx = cx + Math.sin(yaw) * (W / 2 - 11), ny = cy - Math.cos(yaw) * (W / 2 - 11);
    ctx.fillStyle = "#ff6b6b"; ctx.font = "bold 10px Fredoka,sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("N", nx, ny);

    // ---- WANTED STARS (MAP_V2): a compact gold row pinned to the TOP of the
    //      instrument — only ever drawn when wanted > 0, so 0★ leaves the radar
    //      clean. Fixed at screen-top (not rotated) so the heat read is instant.
    if (MAPV2 && wanted > 0) {
      const gap = 9, x0 = cx - ((wanted - 1) * gap) / 2, sy = 13;
      for (let i = 0; i < wanted; i++) radarStar(ctx, x0 + i * gap, sy, 3.6, "#ffd451");
    }

    // ---- PLAYER: a fixed up-pointing chevron at centre + a translucent VIEW CONE
    //      so "where I am AND what I'm looking at" is unmistakable. Up === forward. ----
    ctx.save();
    const coneR = W * 0.34, coneH = 0.5;     // half-angle ~0.5 rad
    const cg = ctx.createRadialGradient(cx, cy, 2, cx, cy, coneR);
    cg.addColorStop(0, "rgba(126,217,255,.32)"); cg.addColorStop(1, "rgba(126,217,255,0)");
    ctx.fillStyle = cg; ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, coneR, -Math.PI / 2 - coneH, -Math.PI / 2 + coneH); ctx.closePath(); ctx.fill();
    ctx.restore();
    // crisp chevron: a faint accent halo under an ink-white arrow so it never
    // melts into a bright block or a crew wash beneath it
    ctx.save();
    ctx.shadowColor = "rgba(125,231,255,.85)"; ctx.shadowBlur = 5;
    ctx.fillStyle = "#e8ecf2"; ctx.strokeStyle = "rgba(0,0,0,.65)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx + 5.5, cy + 6); ctx.lineTo(cx, cy + 2.5); ctx.lineTo(cx - 5.5, cy + 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
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
  // 5-point wanted star for the radar's heat row
  function radarStar(ctx, cx, cy, r, col) {
    ctx.save(); ctx.shadowColor = "rgba(255,190,60,.85)"; ctx.shadowBlur = 4;
    ctx.fillStyle = col; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.44 : r; const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }

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

  // Retired objective line. The old prospect checklist read like a half-built
  // storyline relic on the main screen; keep the shell hidden for compatibility.
  function renderObjective() {
    if (objEl) objEl.style.display = "none";
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
  // a unified-bar gun entry carries label/short (not the engine weapon index); map
  // it back to its FPS_WEAPONS row so the chip can show live mag/reserve (DRY) and
  // the big ammo line, exactly as before. Matched by label first, then short.
  function weaponMetaByLabel(label, short) {
    const T = CBZ.FPS_WEAPONS;
    if (!T) return null;
    for (let i = 0; i < T.length; i++) { const w = T[i]; if (w && (w.label === label || (short && w.short === short))) return { w: w, i: i }; }
    return null;
  }
  // glyphs for usable-item chips (food/drug/throwable) so the row reads at a
  // glance; falls back to a short name when there's no glyph. (Mirrors the loot
  // row's per-item/by-tag icon tables, defined below.)
  function hotbarItemGlyph(name, item) {
    if (LOOT_ITEM_ICON[name]) return LOOT_ITEM_ICON[name];
    const tag = item && item.tag;
    if (tag && LOOT_ICON[tag]) return LOOT_ICON[tag];
    return "";
  }
  // The model in the player's hands and the full inventory panel carry weapon
  // names.  The moving HUD uses only a compact silhouette family so it never
  // recreates the old FIST / 9MM / 556 / RPG word strip.
  function hotbarGunGlyph(meta) {
    const w = meta && meta.w;
    const id = String((w && (w.id || w.key || w.label || w.short)) || "").toLowerCase();
    if (/rocket|rpg|bazooka|launcher/.test(id)) return "◎";
    if (/shotgun|12/.test(id)) return "═";
    if (/smg|machine|uzi/.test(id)) return "≋";
    if (/rifle|carbine|556|5\.56/.test(id)) return "▰";
    if (/pistol|sidearm|9mm/.test(id)) return "◒";
    return "◆";
  }
  function ammoReadout(cur, mag, reserve, reloading) {
    // Instrumentation only: reload is a glyph and all remaining characters are
    // numbers. The old RELOADING/RES prose repeated what the animation conveys.
    return (reloading ? "<span class='rl'>↻</span> " : "") +
      "<b>" + cur + "</b><span class='res'> / " + mag + " · " + reserve + "</span>";
  }
  function renderHotbar() {
    if (!slotsEl) return;
    const fps = CBZ.fps;                            // engine ammo store (guarded)
    // city-only: drive the UNIFIED bar (holster + guns + usable items) when the
    // API is present. Outside city (jail/survival) fall back to the legacy
    // owned-guns/melee render so those modes are byte-identical.
    const useUnified = g.mode === "city" && typeof CBZ.cityHotbar === "function";
    let line = "";
    if (useUnified) {
      let bar = null;
      try { bar = CBZ.cityHotbar(); } catch (e) { bar = null; }
      if (bar) {
        const ITEMS = (CBZ.cityEcon && CBZ.cityEcon.ITEMS) || {};
        let html = "";
        for (let bi = 0; bi < bar.length; bi++) {
          const e = bar[bi];
          const held = !!e.active;
          if (e.kind === "holster") {
            // Leading empty-hand chip. Slot number + pose glyph, no label.
            html += "<div class='cSlot" + (held ? " held" : "") + "' data-bi='" + bi + "'>" +
              "<span class='key'>" + (bi + 1) + "</span><span class='ic'>✊</span></div>";
          } else if (e.kind === "gun") {
            // Weapon silhouette + slot number. Empty is ∅; live rounds stay in
            // the numeric ammo instrument below.
            const m = weaponMetaByLabel(e.label, e.short);
            let ammoTxt = "";
            if (!held && m && fps && fps.rounds && fps.reserves) {
              const cur = (fps.rounds[m.i] != null) ? fps.rounds[m.i] : (m.w.mag || 0);
              const res = (fps.reserves[m.i] != null) ? fps.reserves[m.i] : (m.w.reserve || 0);
              if (cur + res <= 0) ammoTxt = "<span class='a dry'>∅</span>";
            }
            html += "<div class='cSlot" + (held ? " held" : "") + "' data-bi='" + bi + "'>" +
              "<span class='key'>" + (bi + 1) + "</span><span class='ic gun'>" + hotbarGunGlyph(m) + "</span>" + ammoTxt + "</div>";
          } else if (e.kind === "item") {
            // Usable item: catalog glyph + count. Unknowns deliberately use a
            // neutral pack icon instead of falling back to an item name.
            const glyph = hotbarItemGlyph(e.item || e.label, ITEMS[e.item || e.label]);
            const cnt = (e.count != null && e.count > 1) ? "<span class='cnt'>×" + (e.count | 0) + "</span>" : "";
            const face = "<span class='ic'>" + (glyph || "▣") + "</span>";
            html += "<div class='cSlot item" + (held ? " held" : "") + "' data-bi='" + bi + "'>" +
              "<span class='key'>" + (bi + 1) + "</span>" + face + cnt + "</div>";
          }
        }
        slotsEl.innerHTML = html;
        // the prominent equipped-weapon ammo line (jail-style big mag / reserve) for
        // whichever gun is the active entry; holster/items show no ammo here.
        for (let bi = 0; bi < bar.length; bi++) {
          const e = bar[bi];
          if (e.kind !== "gun" || !e.active) continue;
          const m = weaponMetaByLabel(e.label, e.short);
          let cur = 0, mag = 0, res = 0, reloading = false;
          // effective mag capacity respects a fitted extended/drum mag (gunmods.js)
          const magCap = m ? (CBZ.gunModsMag ? CBZ.gunModsMag(m.w.id || m.w.key, m.w.mag || 0) : (m.w.mag || 0)) : 0;
          if (m && fps && fps.rounds && fps.reserves) {
            cur = (fps.rounds[m.i] != null) ? fps.rounds[m.i] : magCap;
            res = (fps.reserves[m.i] != null) ? fps.reserves[m.i] : (m.w.reserve || 0);
            mag = magCap;
            reloading = (m.i === fps.weapon) && (fps.reloading > 0);
          } else if (m) { cur = magCap; mag = magCap; res = m.w.reserve || 0; }
          line = ammoReadout(cur, mag, res, reloading);
          break;
        }
        const armorU = (CBZ.player && CBZ.player._armor) || 0;
        if (armorU > 0) line += (line ? " " : "") + "<span class='arm'>🛡 " + Math.round(armorU) + "</span>";
        if (ammoLineEl) ammoLineEl.innerHTML = line;
        return;
      }
    }
    // ---- LEGACY path (non-city, or the API not yet loaded) — unchanged. -----------
    const inv = (CBZ.weaponInventory && CBZ.weaponInventory.length) ? CBZ.weaponInventory : [];
    const melee = g.cityMeleeWeapon || null;        // Bat/Knife — a held melee, not a gun
    const heldGun = !melee && CBZ.currentWeaponId ? CBZ.currentWeaponId : null;
    const minimalCity = g.mode === "city";
    let html = "";
    // a Fists slot is the baseline — shown when you own no guns, or as the unarmed
    // fallback. It's the HELD slot only when you're carrying neither gun nor melee.
    const fistsHeld = !melee && !heldGun;
    if (!inv.length && !melee) {
      html += minimalCity
        ? "<div class='cSlot held'><span class='ic'>✊</span></div>"
        : "<div class='cSlot held'><span class='s'>Fists</span></div>";
    } else {
      // melee chip first (it's the one in hand when set) so the loadout reads L→R
      if (melee) {
        html += minimalCity
          ? "<div class='cSlot melee held'><span class='ic'>⚔</span></div>"
          : "<div class='cSlot melee held'><span class='s'>" + esc(melee) + "</span></div>";
      } else if (fistsHeld) {
        html += minimalCity
          ? "<div class='cSlot held'><span class='ic'>✊</span></div>"
          : "<div class='cSlot held'><span class='s'>Fists</span></div>";
      }
      for (let k = 0; k < inv.length; k++) {
        const id = inv[k];
        const m = weaponMetaById(id);
        if (!m) continue;
        const lbl = m.w.short || m.w.label || id;
        const held = (id === heldGun);
        // ONE source of truth for ammo: the big line under the bar carries the
        // HELD gun's live mag/reserve; slots stay clean (the old per-slot
        // "11/265"-style mini counts tripled the numbers on screen). The only
        // count that still matters at a glance is a stone-dry gun → DRY.
        let ammoTxt = "";
        if (!held && fps && fps.rounds && fps.reserves) {
          const cur = (fps.rounds[m.i] != null) ? fps.rounds[m.i] : (m.w.mag || 0);
          const res = (fps.reserves[m.i] != null) ? fps.reserves[m.i] : (m.w.reserve || 0);
          if (cur + res <= 0) ammoTxt = "<span class='a dry'>" + (minimalCity ? "∅" : "DRY") + "</span>";
        }
        html += "<div class='cSlot" + (held ? " held" : "") + "'>" +
          (minimalCity ? "<span class='ic gun'>" + hotbarGunGlyph(m) + "</span>" : "<span class='s'>" + esc(lbl) + "</span>") + ammoTxt + "</div>";
      }
    }
    slotsEl.innerHTML = html;
    // the prominent equipped-weapon ammo line (jail-style big mag / reserve). For a
    // gun we read fps live state for the CURRENT weapon; melee/fists show no ammo.
    if (heldGun) {
      const m = weaponMetaById(heldGun);
      let cur = 0, mag = 0, res = 0, reloading = false;
      if (m && fps && fps.rounds && fps.reserves) {
        cur = (fps.rounds[m.i] != null) ? fps.rounds[m.i] : (m.w.mag || 0);
        res = (fps.reserves[m.i] != null) ? fps.reserves[m.i] : (m.w.reserve || 0);
        mag = m.w.mag || 0;
        reloading = (m.i === fps.weapon) && (fps.reloading > 0);
      } else if (m) { cur = m.w.mag || 0; mag = m.w.mag || 0; res = m.w.reserve || 0; }
      line = ammoReadout(cur, mag, res, reloading);
    }
    // melee / fists show NOTHING here — the lit chip already names them; a
    // "Bat — melee" caption under a lit Bat chip was the HUD reading itself
    // aloud (F6).
    const armor = (CBZ.player && CBZ.player._armor) || 0;
    if (armor > 0) line += (line ? " " : "") + "<span class='arm'>🛡 " + Math.round(armor) + "</span>";
    if (ammoLineEl) ammoLineEl.innerHTML = line;
  }

  // ---- carried LOOT readout — the valuables / consumables you're holding from
  //      g.cityInv, with counts. Guns + ammo are deliberately EXCLUDED (the hotbar
  //      already owns those); we surface drugs, wearables, valuables, throwables,
  //      tools and food so your loot reads at a glance without cluttering. Compact
  //      chips, value-sorted so the jackpot (a lifted Rolex / Gold Bar) leads. ------
  const LOOT_ICON = {
    drug: "💊", wearable: "💎", valuable: "💰", throwable: "🧨", tool: "🧰", food: "🍔",
    resource: "📦",   // B7: harvest-node materials (Wood/Stone/Scrap) fallback
  };
  // a handful of nicer per-item glyphs so the row reads instantly
  const LOOT_ITEM_ICON = {
    Grenade: "🧨", Rolex: "⌚", Omega: "⌚", "Audemars Piguet": "⌚", "Patek Philippe": "⌚",
    "Richard Mille": "⌚", "Gold Bar": "🥇", "Gold Chain": "📿", "Diamond Ring": "💍",
    "Engagement Ring": "💍", Medkit: "🩹", "Body Armor": "🦺", Weed: "🌿", Coke: "❄️",
    "Cash Stack": "💵", "Briefcase of Cash": "💼", Phone: "📱", Laptop: "💻", Wallet: "👛",
    // B7: resources (systems/resources.js) + gathering tools (systems/craft.js)
    Wood: "🪵", Stone: "🪨", Scrap: "⚙️", Hatchet: "🪓", Pickaxe: "⛏️",
  };
  function renderLoot() {
    if (!lootEl) return;
    // Carried items and guns share the boxed hotbar/inventory model. A second
    // row of loose item names was the "floating outside the boxes" UI bug.
    lootEl.innerHTML = "";
    lootEl.style.display = "none";
  }

  // ============================================================
  //  MINECRAFT-STYLE VITALS (CITY_HUD_MC) — hearts / hunger shanks / armor
  //  plates as pixel-art icon rows riding the hotbar. All DOM writes are
  //  signature-guarded (refreshAmmoLive's pattern): rows are built once and
  //  only have classes toggled when a QUANTIZED value actually moved.
  // ============================================================
  // icon art: tiny 9×8 pixel sprites baked into SVG data-URIs at load — crisp
  // at the 2× display size (18×16), zero image fetches, one technique for all
  // three rows so they read as a family. A split paints a LEFT|RIGHT half-icon
  // (palIn left of the split column, palOut right) for half-hearts/shanks.
  function mcIconCss() {
    const HRT = [".OOO.OOO.", "OHHFOFFFO", "OHFFFFFFO", "OFFFFFFFO", ".OFFFFFO.", "..OFFFO..", "...OFO...", "....O...."];
    const FUD = ["...OOOO..", "..OFFFFO.", ".OFHFFFFO", ".OFFFFFFO", "..OFFFFO.", ".OBOOOO..", "OBBO.....", "OBO......"];
    const ARM = ["OOO...OOO", "OFFO.OFFO", "OFFOOOFFO", "OFHFFFHFO", "OFFFFFFFO", ".OFFFFFO.", ".OFFFFFO.", "..OOOOO.."];
    const SOCKET = { O: "#0c0e12", F: "#3a3f47", H: "#525862", B: "#454b54" };   // empty container
    const P_HRT = { O: "#1a090c", F: "#e8332b", H: "#ff9d94" };                  // red heart + highlight
    const P_FUD = { O: "#1c1006", F: "#b5622a", H: "#e09a52", B: "#efe4d3" };    // meat brown + bone
    const P_ARM = { O: "#0d1013", F: "#9aa8b8", H: "#d5dde6" };                  // steel chestplate
    function uri(rows, palIn, palOut, split) {
      let r = "";
      for (let y = 0; y < rows.length; y++) {
        const row = rows[y];
        for (let x = 0; x < row.length; x++) {
          const ch = row[x];
          if (ch === ".") continue;
          const pal = (split != null && x > split) ? palOut : palIn;
          const col = pal[ch];
          if (col) r += "<rect x='" + x + "' y='" + y + "' width='1' height='1' fill='" + col + "'/>";
        }
      }
      const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 9 8' shape-rendering='crispEdges'>" + r + "</svg>";
      return "url(\"data:image/svg+xml," + encodeURIComponent(svg) + "\")";
    }
    return (
      "#cityHud.mc .mcHrt.f{background-image:" + uri(HRT, P_HRT) + "}" +
      "#cityHud.mc .mcHrt.h{background-image:" + uri(HRT, P_HRT, SOCKET, 4) + "}" +
      "#cityHud.mc .mcHrt.e{background-image:" + uri(HRT, SOCKET) + "}" +
      "#cityHud.mc .mcFud.f{background-image:" + uri(FUD, P_FUD) + "}" +
      // hunger fills from the RIGHT (mirrored row) → a half-shank keeps its RIGHT half
      "#cityHud.mc .mcFud.h{background-image:" + uri(FUD, SOCKET, P_FUD, 4) + "}" +
      "#cityHud.mc .mcFud.e{background-image:" + uri(FUD, SOCKET) + "}" +
      "#cityHud.mc .mcArm.f{background-image:" + uri(ARM, P_ARM) + "}" +
      "#cityHud.mc .mcArm.h{background-image:" + uri(ARM, P_ARM, SOCKET, 4) + "}" +
      "#cityHud.mc .mcArm.e{background-image:" + uri(ARM, SOCKET) + "}"
    );
  }
  // one-time row construction: N icon spans, all starting as empty sockets
  function fillIcons(rowEl, n, cls) {
    if (!rowEl) return;
    let h = "";
    for (let i = 0; i < n; i++) h += "<span class='mcI " + cls + " e'></span>";
    rowEl.innerHTML = h;
  }
  // toggle each icon to full/half/empty for a half-unit total. mirror=true
  // anchors the fill at the ROW'S RIGHT edge (Minecraft's hunger bar), so the
  // last remaining shank sits at the screen edge. Class writes are compared
  // first — untouched icons cost nothing.
  function setMcIcons(rowEl, count, halfUnits, mirror, cls) {
    if (!rowEl) return;
    const kids = rowEl.children;
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i];
      if (i >= count) { if (el.style.display !== "none") el.style.display = "none"; continue; }
      if (el.style.display === "none") el.style.display = "";
      const li = mirror ? (count - 1 - i) : i;   // logical index from the fill origin
      const st = halfUnits >= (li + 1) * 2 ? "f" : (halfUnits === li * 2 + 1 ? "h" : "e");
      const cn = "mcI " + cls + " " + st;
      if (el.className !== cn) el.className = cn;
    }
  }
  // Armor is an instrument, not an outfit caption.  The inventory/character
  // panel names the kit; live play only needs the chest/helmet glyphs.
  function armorLabel(P) {
    const kit = P._armorKit || null;
    return "🛡" + (kit && kit.head ? "⛑" : "");
  }
  // flip the skin (root .mc class drives ALL the CSS swaps) + reset the render
  // guards so every MC surface repaints on the next frame.
  function applyMc(on) {
    mcApplied = on;
    if (root) root.classList.toggle("mc", !!on);
    mcSig = ""; mcStamLast = -1; mcArmLabLast = null;
  }
  function renderMcVitals(P, maxHp) {
    if (!mcHeartsEl) return;
    // HEARTS: 10 hearts span maxHp at half-heart granularity (20ths of max).
    // Gym gains past the city's 200 ADD hearts (one per +20) up to a 12 cap,
    // beyond which each heart is simply worth more — the row never sprawls.
    const hearts = maxHp > 200 ? Math.min(12, Math.ceil(maxHp / 20)) : 10;
    const hp = Math.max(0, +P.hp || 0);
    const hHalf = hp <= 0 ? 0 : Math.min(hearts * 2, Math.max(1, Math.ceil((hp / maxHp) * hearts * 2)));
    // HUNGER: CBZ.game.hunger 0-100 (hunger.js; null ≈ full) → 20 half-shanks
    const hu = g.hunger == null ? 100 : Math.max(0, Math.min(100, +g.hunger || 0));
    const fHalf = hu <= 0 ? 0 : Math.max(1, Math.ceil(hu / 5));
    // ARMOR plates — only when the armor system dressed the player (aMax > 0)
    const aMax = +(P._armorMax) || 0;
    const aCur = Math.max(0, +(P._armor) || 0);
    const aHalf = aMax > 0 ? (aCur <= 0 ? 0 : Math.min(20, Math.max(1, Math.ceil((aCur / aMax) * 20)))) : -1;
    const sig = hearts + ":" + hHalf + ":" + fHalf + ":" + aHalf;
    if (sig !== mcSig) {
      mcSig = sig;
      setMcIcons(mcHeartsEl, hearts, hHalf, false, "mcHrt");
      mcHeartsEl.classList.toggle("low", hHalf > 0 && hHalf < 6);   // < 3 hearts → pulse
      setMcIcons(mcFoodEl, 10, fHalf, true, "mcFud");               // fills from the right
      if (mcArmRowEl) {
        if (aHalf >= 0) { setMcIcons(mcArmIconsEl, 10, aHalf, false, "mcArm"); mcArmRowEl.style.display = "flex"; }
        else mcArmRowEl.style.display = "none";
      }
    }
    // armor tier label — same text the bar HUD shows, string-guarded
    if (aMax > 0 && mcArmLabEl) {
      const lab = armorLabel(P);
      if (lab !== mcArmLabLast) { mcArmLabLast = lab; mcArmLabEl.innerHTML = lab; }
    }
    // stamina keeps a slim sliver under the hearts (integer-quantized → the
    // width style is only touched when the percent actually moves)
    const st = Math.round(Math.max(0, Math.min(100, P.stamina == null ? 100 : P.stamina)));
    if (st !== mcStamLast && mcStamFEl) { mcStamLast = st; mcStamFEl.style.width = st + "%"; }
  }

  // Live ammo follows the engine as you FIRE / RELOAD — firing never flips the HUD
  // `dirty` flag, so the per-frame driver pokes this. It re-renders the hotbar only
  // when the held weapon's mag/reserve/reload actually changed (a cheap signature
  // compare → no needless DOM churn on phones). Returns nothing; safe when unarmed.
  let ammoSig = "";
  // a compact signature of the UNIFIED bar (holster state + each entry's
  // active/label + item counts) plus the held gun's live mag/reserve/reload. The
  // bar re-renders only when one of these actually changes — so number-key/click
  // selection, holstering, picking up a gun, or eating an item all refresh the
  // chips, while plain firing only touches the DOM on a real ammo change.
  function unifiedBarSig() {
    let bar = null;
    try { bar = CBZ.cityHotbar(); } catch (e) { bar = null; }
    if (!bar) return "x";
    let s = (g.cityHolstered ? "H" : "h");
    const fps = CBZ.fps;
    for (let i = 0; i < bar.length; i++) {
      const e = bar[i];
      s += "|" + (e.kind || "") + ":" + (e.short || e.label || "") + (e.active ? "*" : "");
      if (e.kind === "item") s += "#" + (e.count | 0);
      if (e.kind === "gun" && e.active && fps && fps.rounds && fps.reserves) {
        const m = weaponMetaByLabel(e.label, e.short);
        const k = m ? m.i : -1;
        s += "@" + (k >= 0 ? fps.rounds[k] : "") + "/" + (k >= 0 ? fps.reserves[k] : "") + (fps.reloading > 0 ? "r" : "");
      }
    }
    return s;
  }
  function refreshAmmoLive() {
    const fps = CBZ.fps;
    const melee = g.cityMeleeWeapon || null;
    const heldGun = !melee && CBZ.currentWeaponId ? CBZ.currentWeaponId : null;
    let sig;
    if (g.mode === "city" && typeof CBZ.cityHotbar === "function") {
      // city: signature spans the whole unified bar so holster/item/select changes
      // re-render too (legacy ammo-only sig missed those).
      sig = unifiedBarSig() + "|" + ((CBZ.player && CBZ.player._armor) | 0);
    } else if (heldGun && fps && fps.rounds && fps.reserves) {
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

  // ---- contextual reveal: a value that CHANGED brightens to alert level, then
  //      settles back to quiet chrome. The HUD speaks when something happened
  //      and idles as faint furniture the rest of the time — persistent
  //      elements stay minimal, attention goes to the world. ----
  function flashThenFade(el, holdMs) {
    if (!el) return;
    if (el._ftf) { clearTimeout(el._ftf); el._ftf = 0; }
    el.style.transition = "none";
    el.style.opacity = "var(--o-alert,1)";
    el._ftf = setTimeout(function () {
      el.style.transition = "opacity .8s ease";
      el.style.opacity = "";   // fall back to the element's resting opacity class
      el._ftf = 0;
    }, holdMs || 1400);
  }

  // money delta: flash a floating +$/-$ when cash changes, GTA-style; the big
  // counter lifts to full brightness with it, then settles back to chrome.
  let lastCash = null;
  function showMoney() {
    const c = g.cash || 0;
    cashEl.textContent = "$" + c.toLocaleString();
    if (lastCash != null && c !== lastCash && deltaEl) {
      const d = c - lastCash;
      deltaEl.textContent = (d > 0 ? "+$" : "-$") + Math.abs(d).toLocaleString();
      deltaEl.style.color = d > 0 ? "var(--money,#7ed957)" : "#ff6b6b";
      deltaEl.style.animation = "none"; void deltaEl.offsetWidth;   // restart
      deltaEl.style.animation = "cDeltaUp 1.1s ease-out forwards";
      cashEl.style.animation = "none"; void cashEl.offsetWidth;
      cashEl.style.animation = "cMoneyPulse .4s ease-out";
      flashThenFade(cashEl);
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
      for (let i = 1; i <= 5; i++) s += i <= w ? "<span style='color:var(--gold,#ffd166);text-shadow:0 0 8px rgba(255,209,102,.6)'>★</span>" : "<span style='color:#4a4f57'>★</span>";
      starsEl.innerHTML = s;
      const hot = (g.heat || 0) > 0 && w >= (g._wantedPeak || 0);
      starsWrap.style.animation = hot ? "cStarFlash .7s steps(1,end) infinite" : "none";
    } else { starsWrap.style.display = "none"; starsWrap.style.animation = "none"; }
    // crew headcount only, labeled (F1/F2): respect + bank read on the phone /
    // leaderboard and DRIP reads at the boutique mirror + the club rope — the
    // always-on duplicates here were stat wallpaper, and a second ★ two inches
    // from the wanted meter read as heat.
    crewEl.textContent = "";
    if (worldEl) { worldEl.textContent = ""; worldEl.style.display = "none"; }
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
      // Full contract prose/pay lives in the phone. The live HUD only carries
      // the one piece of navigation state that matters while moving.
      jobEl.innerHTML = "🎯" + (dist ? "<span style='color:var(--hud-dim,#9fb0c6)'>" + dist.replace(/^\s*·\s*/, " ") + "</span>" : "");
      jobEl.style.display = "block";
      if (objEl) objEl.style.display = "none";   // a real job pre-empts the gang-join objective
    } else {
      jobEl.style.display = "none";
      renderObjective();
    }
    dirty = false;
  }

  CBZ.onAlways(46, function () {
    build();
    const show = g.mode === "city";
    // respect the [H] hide-HUD toggle (charpanel.js) — don't clobber it every frame
    const hudHidden = show && CBZ.cityCharPanel && CBZ.cityCharPanel.hudHidden && CBZ.cityCharPanel.hudHidden();
    root.style.display = (show && !hudHidden) ? "block" : "none";
    document.body.classList.toggle("mode-city", show);
    if (!show) return;
    // track the wanted peak so the flashing only fires while it's RISING/held
    const w = g.wanted | 0;
    if (w > (g._wantedPeak || 0)) g._wantedPeak = w; else if (w === 0) g._wantedPeak = 0;
    if (dirty) renderText();
    // bars + live job distance update every frame (cheap)
    const P = CBZ.player, maxHp = P.maxHp || 100;
    // MINECRAFT-STYLE vitals (CITY_HUD_MC): hearts / shanks / plates above the
    // hotbar replace the slim bars. applyMc flips the skin only when the flag
    // actually changes; the icon renders inside are signature-guarded so the
    // per-frame cost is a few comparisons. Flag off = the classic writes below.
    const mcOn = !!(CBZ.CONFIG && CBZ.CONFIG.CITY_HUD_MC);
    if (mcOn !== mcApplied) applyMc(mcOn);
    if (mcOn) {
      renderMcVitals(P, maxHp);
    } else {
      hpBar.style.width = Math.max(0, Math.min(100, (P.hp / maxHp) * 100)) + "%";
      hungerBar.style.width = Math.max(0, Math.min(100, g.hunger || 0)) + "%";
      stamBar.style.width = Math.max(0, Math.min(100, (P.stamina == null ? 100 : P.stamina))) + "%";
      // ARMOR — the outer-layer plate gauge. Shown only when the armor system has
      // given the player a kit (_armorMax > 0); guarded against div-by-zero and a
      // missing armor module (fields simply absent → row stays hidden). The label
      // carries the equipped tier name + a ⛑ helmet glyph when a head piece is on.
      if (armRowEl) {
        const aMax = +(P._armorMax) || 0;
        if (aMax > 0) {
          const aCur = Math.max(0, +(P._armor) || 0);
          armBar.style.width = Math.max(0, Math.min(100, (aCur / aMax) * 100)) + "%";
          if (armLabEl) armLabEl.innerHTML = armorLabel(P);
          armRowEl.style.display = "";
        } else armRowEl.style.display = "none";
      }
    }
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
        if (sn) { sn.textContent = mph; sn.style.color = mph > 100 ? "#ff9e6b" : "#e8ecf2"; }
      } else speedEl.style.display = "none";
    }
    // population headcount + kill feed (throttled — they change steadily, not
    // every frame; ~4Hz keeps phones smooth)
    popAcc += 1 / 60;
    // cadence rides the perf/quality slider — tier0 drops to 2Hz, Best keeps
    // today's 4Hz exactly (all writes below are already signature-gated).
    if (popAcc >= 1 / (CBZ.qScale ? CBZ.qScale(2, 4) : 4)) {
      popAcc = 0;
      renderPop(); renderKill();
      // wave-5 depth surfaces, all throttled here at ~4Hz (cheap on phones)
      renderTurfPay(); renderMemb(); renderRel(); renderPosture();
    }
    // radar (throttled), turf + home/partner status
    radarAcc += 1 / 60;
    // radar repaint rides the perf/quality slider — tier0 drops to 7Hz (the
    // canvas redraw is the HUD's priciest CPU line), Best keeps today's 14Hz.
    if (radarAcc >= 1 / (CBZ.qScale ? CBZ.qScale(7, 14) : 14)) { radarAcc = 0; drawRadar(); }
    if (turfEl) {
      turfEl.textContent = "";
      turfEl.style.display = "none";
    }
    if (homeLineEl) {
      homeLineEl.textContent = "";
      homeLineEl.style.display = "none";
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

  // (CUT: the POLICE DISPATCH BANNER — "📻 DISPATCH / ⚠ CODE BLACK: Airstrike
  //  authorized. Level the block." etc. flashing centre-screen on every star
  //  step. You are the SUSPECT, not a unit on the radio net — nothing in the
  //  world delivers that text to you. The escalation already announces itself
  //  diegetically: sirens and extra cruisers at 1-2★, a visible light-bar wall
  //  across the road at 3★, the chopper's rotor + radar blip at 4★, and at 5★
  //  you HEAR the jet scream in before anything explodes. The star meter owns
  //  the abstract readout; no popup needed.)
})();
