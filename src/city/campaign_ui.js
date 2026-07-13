/* ============================================================
   city/campaign_ui.js — the diegetic campaign phone + dialogue surface.

   This file deliberately owns no story logic. A campaign/director feeds it
   structured state through CBZ.campaignUI:

     setMission(def)
     notify(type, from, body, meta?)          — legacy; delegates to phoneNotify
     phoneNotify({from, app, text, ...})      — canonical (also CBZ.phoneNotify)
     say(speaker, text, choices?) -> Promise<choice|null>
     choice({ id, prompt, options, onChoose }) -> Promise<choice|null>
     choose(idOrIndex)
     clearDialogue()
     open(app?) / close()

   PHONE_NOTIS_V2 (CBZ.CONFIG flag): notifications are real-phone pushes from
   in-world senders (contacts / Bank / News / Bounty / missed calls). With the
   phone raised, a banner drops in from the top of the glass; stowed, the
   handset buzzes (glyph shake + LED) and a compact banner rises beside it.
   Flag off restores the old behavior: copy only on the raised phone, the
   stowed signal being just the glyph + LED.
============================================================ */
(function () {
  "use strict";

  const CBZ = window.CBZ;
  if (!CBZ || typeof document === "undefined") return;

  const g = CBZ.game || {};
  const APPS = ["missions", "messages", "news"];
  const MAX_ITEMS = 80;

  const state = {
    open: false,
    app: "missions",
    mission: null,
    missionHistory: [],
    messages: [],
    news: [],
    unread: { missions: false, messages: 0, news: 0 },
    dialogue: null,
  };

  let root = null;
  let peek = null;
  let led = null;
  let screen = null;
  let appTitle = null;
  let clockEl = null;
  let dialogueEl = null;
  let dialogueSpeaker = null;
  let dialogueText = null;
  let dialogueChoices = null;
  let choiceResolve = null;
  let ownsMenuLock = false;
  let pulseTimer = 0;
  let serial = 0;
  let titleCanonicalized = false;
  const compatRecent = new Map();
  const COMPAT_DEDUPE_MS = 4000;

  // ---- PHONE_NOTIS_V2: diegetic push notifications ---------------------------
  // Every notice is a real-phone push FROM someone/something in-world. Payload:
  //   CBZ.phoneNotify({ app, from, text, icon?, priority?, ttl?, onTap?, meta? })
  // apps: messages | bank | news | bounty | phone (missed call) | missions |
  // system | contracts (the BLKLST job board — economy systems push to it).
  // Non-tab apps log into the Messages tab but keep their own badge.
  const APPS_V2 = ["messages", "bank", "news", "bounty", "phone", "missions", "system", "contracts"];
  const APP_GLYPH = { messages: "◇", bank: "▤", news: "◫", bounty: "◈", phone: "◐", missions: "◎", system: "▢", contracts: "◆" };
  const APP_LABEL = { messages: "Messages", bank: "Bank", news: "News", bounty: "Bounty", phone: "Phone", missions: "Ghostline", system: "Phone", contracts: "Contracts" };
  const BANNER_OUT_MS = 200, BANNER_GAP_MS = 220;
  const BANNER_HOLD = [3600, 4200, 5200];   // hold ms by priority 0/1/2
  const MAX_QUEUE = 4, COALESCE_MS = 1500;
  let bannerQueue = [];
  let bannerCurrent = null;
  let bannerState = "idle";                 // idle | hold | out
  let bannerTimer = 0;
  let bannerEl = null;                      // in-phone banner (drops from screen top)
  let sliverEl = null;                      // stowed compact banner by the peek glyph

  function notisV2() { return !!(CBZ.CONFIG && CBZ.CONFIG.PHONE_NOTIS_V2); }
  function appTab(app) { return app === "news" ? "news" : (app === "missions" ? "missions" : "messages"); }
  function resolveSender(app, from) {
    if (from != null && from !== "") return String(from);
    if (app === "news") return "City Desk";
    if (app === "bank") return "Liberty Bank";
    if (app === "bounty") return "Bounty Board";
    if (app === "phone") return "Unknown Caller";
    if (app === "missions") return "GHOSTLINE";
    if (app === "system") return "Phone";
    if (app === "contracts") return "BLKLST";
    return "Unknown";
  }
  // Keybinding/control-legend prose ("[E] Pay …", "W/S throttle · LMB fire")
  // is interface mechanics — a real phone never pushes it. Non-mission pushes
  // carrying it are dropped at the door (mission briefs keep authored text).
  const KEYBIND_RE = /\[[A-Za-z0-9/\- ]{1,7}\]|\bLMB\b|\bRMB\b|Shift\+|\bWASD\b/;
  // Legacy single-string calls get auto-classified into an in-world app +
  // sender so an unmigrated caller still reads like a real push, never like
  // game-system prose. Mirrors mode.js's noteCategory() heuristics.
  function classifyLegacyString(s) {
    s = String(s == null ? "" : s);
    if (/missed call|voicemail|calling you|tried to call/i.test(s)) return { app: "phone", text: s };
    if (/[+\-]?\$\s?[\d,]|deposit|payout|wired|transfer|received|refund|paid (you|out)/i.test(s)) return { app: "bank", text: s };
    if (/bounty|dead or alive|reward on/i.test(s)) return { app: "bounty", text: s, priority: 1 };
    if (/waypoint|route|destination|fast travel/i.test(s)) return { app: "system", from: "Maps", text: s.replace(/^Waypoint set/i, "Route set") };
    if (/wanted|police|swat|cops|manhunt|curfew|lockdown|airstrike/i.test(s)) return { app: "news", from: "Scanner", text: s };
    if (/breaking|report|district|gang war|earthquake|storm|city (hall|desk)/i.test(s)) return { app: "news", text: s };
    return { app: "system", text: s };
  }

  function campaignEnabled() {
    // Canonical owner: campaign.js (CBZ.CONFIG.CITY_HITMAN_CAMPAIGN with a
    // one-time migration of the legacy flag locations). The OR-chain below is
    // only the fallback for the beat before campaign.js — which loads directly
    // after this file — has evaluated.
    if (typeof CBZ.cityCampaignEnabled === "function") return !!CBZ.cityCampaignEnabled();
    return !!(
      (CBZ.CONFIG && CBZ.CONFIG.CITY_HITMAN_CAMPAIGN) ||
      CBZ.CITY_HITMAN_CAMPAIGN ||
      window.CITY_HITMAN_CAMPAIGN ||
      g.CITY_HITMAN_CAMPAIGN ||
      g.cityHitmanCampaign
    );
  }

  function playableMode() {
    return g.mode === "city" || g.mode === "escape";
  }

  function livePlay() {
    return campaignEnabled() && playableMode() && g.state === "playing";
  }

  function canonicalizeTitle() {
    if (titleCanonicalized || !campaignEnabled() || !document.body) return;
    titleCanonicalized = true;
    document.body.classList.add("campaign-canonical-title");

    // The campaign is the game, not another tile in a mode picker. state.js is
    // already loaded at the recommended integration point, so use its canonical
    // mode setter when available and degrade to the same body/game flags if not.
    if (g.mode !== "city") {
      if (typeof CBZ.setMode === "function") {
        try { CBZ.setMode("city"); } catch (e) {}
      } else {
        g.mode = "city";
        document.body.classList.add("mode-city");
        document.body.classList.remove("mode-survival");
      }
    }

    const logo = document.querySelector("#title .mode-city-only .logo");
    const sub = document.querySelector("#title .mode-city-only .sub");
    const play = document.getElementById("playBtn");
    if (logo) {
      logo.classList.add("campaign-title");
      logo.innerHTML = "THE <span class='z'>CONTRACT</span>";
    }
    if (sub) {
      sub.classList.add("campaign-title");
      sub.textContent = "A HITMAN STORY";
    }
    if (play) play.textContent = "BEGIN";
  }

  function nowLabel() {
    // A real-world clock reads naturally on the handset and needs no coupling
    // to the simulation's optional day/night clock.
    try {
      return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "--:--";
    }
  }

  function make(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function textOf(v, fallback) {
    if (v == null || v === "") return fallback || "";
    return String(v);
  }

  function speakerName(speaker) {
    if (typeof speaker === "string") return speaker;
    if (!speaker) return "Unknown";
    return speaker.name || (speaker.data && speaker.data.name) || speaker.label || "Unknown";
  }

  function trimList(list) {
    if (list.length > MAX_ITEMS) list.splice(0, list.length - MAX_ITEMS);
  }

  function normalizeObjectives(raw) {
    const list = Array.isArray(raw) ? raw : (raw == null ? [] : [raw]);
    return list.map(function (item, i) {
      if (typeof item === "string") return { id: "objective-" + i, text: item, done: false };
      item = item || {};
      return {
        id: textOf(item.id, "objective-" + i),
        text: textOf(item.text || item.label || item.objective, "Objective"),
        done: !!(item.done || item.complete || item.completed),
        failed: !!item.failed,
      };
    });
  }

  function normalizeMission(def) {
    def = def || {};
    const reward = def.reward != null ? def.reward : def.pay;
    let rewardText = "";
    if (typeof reward === "number") rewardText = "$" + Math.round(reward).toLocaleString();
    else if (reward != null) rewardText = String(reward);
    return {
      id: textOf(def.id, "mission-" + (++serial)),
      title: textOf(def.title || def.name, "Current Mission"),
      briefing: textOf(def.briefing || def.body || def.description || def.desc || def.objective, ""),
      target: textOf(def.targetName || (def.target && def.target.name) || def.target, ""),
      location: textOf(def.locationName || def.location, ""),
      prestige: textOf(def.prestige, ""),
      reward: rewardText,
      status: textOf(def.status, "active"),
      progress: typeof def.progress === "number" ? Math.max(0, Math.min(1, def.progress)) : null,
      objectives: normalizeObjectives(def.objectives || def.steps),
      updatedAt: Date.now(),
      meta: def,
    };
  }

  function cloneMissionForHistory(mission) {
    if (!mission) return null;
    return {
      id: mission.id,
      title: mission.title,
      briefing: mission.briefing,
      target: mission.target,
      location: mission.location,
      reward: mission.reward,
      status: mission.status,
      objectives: mission.objectives.map(function (x) {
        return { id: x.id, text: x.text, done: x.done, failed: x.failed };
      }),
      updatedAt: mission.updatedAt,
    };
  }

  function hasUnread() {
    return !!(state.unread.missions || state.unread.messages || state.unread.news);
  }

  function pulsePeek() {
    ensureDom();
    if (!peek) return;
    peek.classList.remove("campaign-phone-pulse");
    void peek.offsetWidth;
    peek.classList.add("campaign-phone-pulse");
    if (pulseTimer) clearTimeout(pulseTimer);
    pulseTimer = setTimeout(function () {
      if (peek) peek.classList.remove("campaign-phone-pulse");
      pulseTimer = 0;
    }, 900);
  }

  function syncUnread() {
    ensureDom();
    const any = hasUnread();
    if (led) led.classList.toggle("on", any);
    if (peek) peek.classList.toggle("has-unread", any);
    if (!root) return;
    APPS.forEach(function (app) {
      const dot = root.querySelector("[data-unread='" + app + "']");
      if (!dot) return;
      const n = state.unread[app];
      dot.classList.toggle("on", !!n);
      // Dots stay dots. No count is rendered outside or inside the handset nav.
      dot.textContent = "";
    });
  }

  function markRead(app) {
    if (app === "missions") state.unread.missions = false;
    else if (app === "messages" || app === "news") state.unread[app] = 0;
    // reading a tab retires its queued banners — no stale sliver later
    if (bannerQueue.length) {
      bannerQueue = bannerQueue.filter(function (q) { return appTab(q.app) !== app; });
    }
    syncUnread();
  }

  function appName(app) {
    if (app === "messages") return "Messages";
    if (app === "news") return "News";
    return "Missions";
  }

  function emptyState(icon, title, copy) {
    const wrap = make("div", "campaign-empty");
    wrap.appendChild(make("div", "campaign-empty-icon", icon));
    wrap.appendChild(make("div", "campaign-title campaign-empty-title", title));
    wrap.appendChild(make("div", "campaign-empty-copy", copy));
    return wrap;
  }

  function infoChip(label, value) {
    const chip = make("div", "campaign-info-chip");
    chip.appendChild(make("span", "campaign-info-label", label));
    chip.appendChild(make("b", "campaign-info-value", value));
    return chip;
  }

  function renderMissions() {
    const frag = document.createDocumentFragment();
    const mission = state.mission;
    if (!mission) {
      frag.appendChild(emptyState("◎", "Line is quiet", "Your next assignment will arrive here."));
    } else {
      const card = make("article", "campaign-mission-card");
      const eyebrow = make("div", "campaign-eyebrow", mission.status === "active" ? "ACTIVE CONTRACT" : mission.status.toUpperCase());
      card.appendChild(eyebrow);
      card.appendChild(make("h2", "campaign-title campaign-mission-title", mission.title));
      if (mission.briefing) card.appendChild(make("p", "campaign-mission-brief", mission.briefing));

      const chips = make("div", "campaign-info-grid");
      if (mission.target) chips.appendChild(infoChip("TARGET", mission.target));
      if (mission.location) chips.appendChild(infoChip("LOCATION", mission.location));
      if (mission.reward) chips.appendChild(infoChip("PAY", mission.reward));
      if (mission.prestige) chips.appendChild(infoChip("STANDING", mission.prestige));
      if (chips.childNodes.length) card.appendChild(chips);

      if (mission.progress != null) {
        const progress = make("div", "campaign-mission-progress");
        const fill = make("i", "campaign-mission-progress-fill");
        fill.style.width = Math.round(mission.progress * 100) + "%";
        progress.appendChild(fill);
        card.appendChild(progress);
      }

      if (mission.objectives.length) {
        const list = make("div", "campaign-objectives");
        mission.objectives.forEach(function (objective) {
          const row = make("div", "campaign-objective" + (objective.done ? " done" : "") + (objective.failed ? " failed" : ""));
          row.appendChild(make("span", "campaign-objective-mark", objective.failed ? "×" : (objective.done ? "✓" : "○")));
          row.appendChild(make("span", "campaign-objective-copy", objective.text));
          list.appendChild(row);
        });
        card.appendChild(list);
      }
      if (mission.updates && mission.updates.length) {
        const updates = make("div", "campaign-mission-updates");
        mission.updates.slice(-4).reverse().forEach(function (item) {
          const row = make("div", "campaign-mission-update");
          row.appendChild(make("time", "", item.time));
          row.appendChild(make("span", "", item.body));
          updates.appendChild(row);
        });
        card.appendChild(updates);
      }
      frag.appendChild(card);
    }

    if (state.missionHistory.length) {
      const section = make("section", "campaign-history");
      section.appendChild(make("h3", "campaign-title campaign-section-title", "Previous"));
      state.missionHistory.slice(-5).reverse().forEach(function (mission) {
        const row = make("div", "campaign-history-row");
        row.appendChild(make("span", "campaign-history-state", mission.status === "failed" ? "×" : "✓"));
        const copy = make("span", "campaign-history-copy");
        copy.appendChild(make("b", "", mission.title));
        copy.appendChild(make("small", "", mission.status));
        row.appendChild(copy);
        section.appendChild(row);
      });
      frag.appendChild(section);
    }
    return frag;
  }

  function renderItems(items, kind) {
    const frag = document.createDocumentFragment();
    if (!items.length) {
      frag.appendChild(emptyState(kind === "news" ? "◫" : "◇", kind === "news" ? "No bulletins" : "No messages", kind === "news" ? "The city has not broken the silence yet." : "Contacts will reach you here."));
      return frag;
    }
    items.slice().reverse().forEach(function (item) {
      const article = make("article", "campaign-feed-card " + (kind === "news" ? "news" : "message"));
      const top = make("div", "campaign-feed-top");
      // per-app badge (V2): bank/bounty/missed-call pushes stay visually
      // distinct inside the Messages list — the list IS the notification center.
      const app = item.app || (kind === "news" ? "news" : "messages");
      const badge = make("i", "campaign-noti-badge app-" + app, item.icon || APP_GLYPH[app] || "◇");
      badge.setAttribute("aria-hidden", "true");
      top.appendChild(badge);
      top.appendChild(make("b", "campaign-feed-from", item.from));
      top.appendChild(make("time", "campaign-feed-time", item.time));
      article.appendChild(top);
      article.appendChild(make("p", "campaign-feed-body", item.body));
      frag.appendChild(article);
    });
    return frag;
  }

  function render() {
    ensureDom();
    if (!screen) return;
    screen.textContent = "";
    if (appTitle) appTitle.textContent = appName(state.app);
    if (clockEl) clockEl.textContent = nowLabel();

    if (state.app === "messages") screen.appendChild(renderItems(state.messages, "messages"));
    else if (state.app === "news") screen.appendChild(renderItems(state.news, "news"));
    else screen.appendChild(renderMissions());

    if (state.open) markRead(state.app);
    syncUnread();
  }

  function selectApp(app) {
    app = String(app || "").toLowerCase();
    if (APPS.indexOf(app) < 0) app = "missions";
    state.app = app;
    if (root) {
      root.querySelectorAll("[data-app]").forEach(function (button) {
        button.classList.toggle("active", button.getAttribute("data-app") === app);
      });
    }
    render();
  }

  function ensureDom() {
    if (root || !document.body) return root;

    peek = make("button", "campaign-phone-peek");
    peek.id = "campaignPhonePeek";
    peek.type = "button";
    peek.setAttribute("aria-label", "Open phone");
    peek.innerHTML = "<span class='campaign-phone-peek-icon' aria-hidden='true'>▯</span><i class='campaign-phone-led' aria-hidden='true'></i>";
    led = peek.querySelector(".campaign-phone-led");
    peek.addEventListener("click", function () { open(); });
    document.body.appendChild(peek);

    root = make("div", "campaign-phone-layer");
    root.id = "campaignPhone";
    root.setAttribute("aria-hidden", "true");
    root.innerHTML =
      "<button class='campaign-phone-scrim' type='button' aria-label='Put phone away'></button>" +
      "<section class='campaign-phone-device' role='dialog' aria-modal='true' aria-label='Campaign phone'>" +
      "  <i class='campaign-phone-side campaign-phone-side-a'></i><i class='campaign-phone-side campaign-phone-side-b'></i>" +
      "  <div class='campaign-phone-glass'>" +
      "    <div class='campaign-phone-island'><i></i><span></span></div>" +
      "    <header class='campaign-phone-status'><time class='campaign-phone-clock'>--:--</time><span class='campaign-phone-signal' aria-hidden='true'>▮▮▮</span><span class='campaign-phone-battery' aria-hidden='true'>▰</span></header>" +
      "    <div class='campaign-noti-banner' role='button' tabindex='0' aria-live='polite'><i class='campaign-noti-badge' aria-hidden='true'>▢</i><div class='campaign-noti-copy'><div class='campaign-noti-toprow'><b class='campaign-noti-from'></b><small class='campaign-noti-app'></small></div><span class='campaign-noti-text'></span></div></div>" +
      "    <div class='campaign-phone-head'><div><small>GHOSTLINE</small><h1 class='campaign-title campaign-phone-app-title'>Missions</h1></div><button class='campaign-phone-close' type='button' aria-label='Put phone away'>×</button></div>" +
      "    <main class='campaign-phone-screen'></main>" +
      "    <nav class='campaign-phone-nav' aria-label='Phone apps'>" +
      "      <button type='button' data-app='missions' class='active'><span aria-hidden='true'>◎</span><b>Missions</b><i data-unread='missions'></i></button>" +
      "      <button type='button' data-app='messages'><span aria-hidden='true'>◇</span><b>Messages</b><i data-unread='messages'></i></button>" +
      "      <button type='button' data-app='news'><span aria-hidden='true'>◫</span><b>News</b><i data-unread='news'></i></button>" +
      "    </nav>" +
      "    <button class='campaign-phone-home' type='button' aria-label='Put phone away'><i></i></button>" +
      "  </div>" +
      "</section>";

    document.body.appendChild(root);
    screen = root.querySelector(".campaign-phone-screen");
    appTitle = root.querySelector(".campaign-phone-app-title");
    clockEl = root.querySelector(".campaign-phone-clock");
    bannerEl = root.querySelector(".campaign-noti-banner");
    if (bannerEl) bannerEl.addEventListener("click", notiTap);

    // stowed-phone notification sliver: rises beside the peek glyph when the
    // handset buzzes; tapping it raises the phone on the notice's app.
    sliverEl = make("button", "campaign-noti-sliver");
    sliverEl.id = "campaignNotiSliver";
    sliverEl.type = "button";
    sliverEl.setAttribute("aria-live", "polite");
    sliverEl.innerHTML = "<i class='campaign-noti-badge' aria-hidden='true'>▢</i><div class='campaign-noti-copy'><div class='campaign-noti-toprow'><b class='campaign-noti-from'></b><small class='campaign-noti-app'></small></div><span class='campaign-noti-text'></span></div>";
    sliverEl.addEventListener("click", notiTap);
    document.body.appendChild(sliverEl);

    root.querySelector(".campaign-phone-scrim").addEventListener("click", close);
    root.querySelector(".campaign-phone-close").addEventListener("click", close);
    root.querySelector(".campaign-phone-home").addEventListener("click", close);
    root.querySelector(".campaign-phone-nav").addEventListener("click", function (event) {
      const button = event.target.closest && event.target.closest("[data-app]");
      if (button) selectApp(button.getAttribute("data-app"));
    });

    dialogueEl = make("section", "campaign-dialogue");
    dialogueEl.id = "campaignDialogue";
    dialogueEl.setAttribute("aria-live", "polite");
    dialogueEl.innerHTML =
      "<div class='campaign-dialogue-line'>" +
      "  <div class='campaign-dialogue-speaker campaign-title'></div>" +
      "  <div class='campaign-dialogue-text'></div>" +
      "</div>" +
      "<div class='campaign-dialogue-choices'></div>";
    document.body.appendChild(dialogueEl);
    dialogueSpeaker = dialogueEl.querySelector(".campaign-dialogue-speaker");
    dialogueText = dialogueEl.querySelector(".campaign-dialogue-text");
    dialogueChoices = dialogueEl.querySelector(".campaign-dialogue-choices");
    dialogueChoices.addEventListener("click", function (event) {
      const button = event.target.closest && event.target.closest("[data-choice]");
      if (button) choose(button.getAttribute("data-choice"));
    });

    render();
    syncMode();
    return root;
  }

  function clearMovementKeys() {
    if (!CBZ.keys) return;
    Object.keys(CBZ.keys).forEach(function (key) { CBZ.keys[key] = false; });
  }

  function open(app) {
    if (!livePlay()) return false;
    ensureDom();
    if (!root) return false;

    // The campaign phone supersedes the old city status modal when both scripts
    // are present. Its private open flag stays false because our capture listener
    // owns [P]; this extra hide protects programmatic legacy opens.
    const legacy = document.getElementById("cityPhone");
    if (legacy) legacy.style.display = "none";

    // MUTUAL EXCLUSION with the full map: raising the phone puts the map away
    // (and vice versa — fullmap.open() closes the phone). Never both at once.
    if (CBZ.fullMap && CBZ.fullMap.active && CBZ.fullMap.close) {
      try { CBZ.fullMap.close(false); } catch (e) {}
    }

    if (g.mode === "city" && CBZ.cityMenuOpen && !state.open) return false;
    state.open = true;
    ownsMenuLock = true;
    CBZ.cityMenuOpen = true;
    CBZ.campaignPhoneOpen = true;
    clearMovementKeys();
    if (document.exitPointerLock) {
      try { document.exitPointerLock(); } catch (e) {}
    }
    root.classList.add("open");
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("campaign-phone-open");
    retargetBanner();   // a stowed sliver mid-flight re-presents inside the glass
    selectApp(app || state.app);
    return true;
  }

  function close() {
    if (!state.open) return false;
    state.open = false;
    CBZ.campaignPhoneOpen = false;
    if (ownsMenuLock) CBZ.cityMenuOpen = false;
    ownsMenuLock = false;
    if (root) {
      root.classList.remove("open");
      root.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("campaign-phone-open");
    retargetBanner();   // an in-glass banner mid-flight re-presents as a sliver
    syncUnread();
    if (CBZ.requestLock && g.state === "playing" && !CBZ.touchMode &&
        !(CBZ.fullMap && CBZ.fullMap.active)) {
      try { CBZ.requestLock(); } catch (e) {}
    }
    return true;
  }

  function setMission(def) {
    if (!def) {
      if (state.mission) {
        const old = cloneMissionForHistory(state.mission);
        old.status = old.status === "active" ? "closed" : old.status;
        state.missionHistory.push(old);
        trimList(state.missionHistory);
      }
      state.mission = null;
      state.unread.missions = true;
      render();
      pulsePeek();
      return null;
    }

    const next = normalizeMission(def);
    if (state.mission && state.mission.id !== next.id) {
      const old = cloneMissionForHistory(state.mission);
      if (old.status === "active") old.status = "closed";
      state.missionHistory.push(old);
      trimList(state.missionHistory);
    }
    state.mission = next;
    state.unread.missions = !(state.open && state.app === "missions");
    render();
    if (state.unread.missions) pulsePeek();
    return next;
  }

  // ---- V2 banner machine ------------------------------------------------------
  // One banner on screen at a time (real-phone feel). Raised phone → it drops in
  // from the top of the glass, over the current app. Stowed phone → the handset
  // buzzes (glyph shake + LED via pulsePeek) and a compact banner rises by it.
  function bannerSuppressed() {
    if (!notisV2()) return true;
    if (CBZ.fullMap && CBZ.fullMap.active) return true;   // never banner over the map
    if (takeoverOpen()) return true;
    return !livePlay();
  }
  function fillNotiEl(el, item) {
    if (!el) return;
    const badge = el.querySelector(".campaign-noti-badge");
    if (badge) {
      badge.className = "campaign-noti-badge app-" + item.app;
      badge.textContent = item.icon || APP_GLYPH[item.app] || "▢";
    }
    const from = el.querySelector(".campaign-noti-from");
    if (from) from.textContent = item.from || "";
    const app = el.querySelector(".campaign-noti-app");
    if (app) app.textContent = (APP_LABEL[item.app] || "Phone") + " · " + (item.time || "");
    const text = el.querySelector(".campaign-noti-text");
    if (text) text.textContent = item.text || item.body || "";
  }
  function coalesceView(item) {
    if (!item || !item._n || item._n < 2) return item;
    return Object.assign({}, item, { from: item.from + " · " + item._n + " new" });
  }
  function enqueueBanner(item) {
    const tail = bannerQueue.length ? bannerQueue[bannerQueue.length - 1]
      : (bannerState === "hold" ? bannerCurrent : null);
    if (tail && tail.app === item.app && tail.from === item.from && item.born - tail.born < COALESCE_MS) {
      // repeated pushes from the same sender collapse: "Lena · 3 new"
      tail.text = item.text; tail.body = item.body;
      tail._n = (tail._n || 1) + 1;
      if (tail === bannerCurrent) fillNotiEl(state.open ? bannerEl : sliverEl, coalesceView(tail));
      return;
    }
    if ((item.priority | 0) >= 2 && bannerState === "hold") {
      bannerQueue.unshift(item);   // urgent preempts the held banner
      hideBanner(true);
      return;
    }
    bannerQueue.push(item);
    while (bannerQueue.length > MAX_QUEUE) {
      const i = bannerQueue.findIndex(function (q) { return (q.priority | 0) < 1; });
      bannerQueue.splice(i >= 0 ? i : 0, 1);   // overflow drops the oldest normal item
    }
    pumpBanner();
  }
  function pumpBanner() {
    if (bannerState !== "idle" || !bannerQueue.length || bannerSuppressed()) return;
    ensureDom();
    const el = state.open ? bannerEl : sliverEl;
    if (!el) return;
    bannerCurrent = bannerQueue.shift();
    fillNotiEl(el, coalesceView(bannerCurrent));
    void el.offsetWidth;   // restart the slide transition
    el.classList.add("in");
    if (el === sliverEl) pulsePeek();   // the buzz: glyph shake + LED
    bannerState = "hold";
    const hold = bannerCurrent.ttl > 0 ? bannerCurrent.ttl : BANNER_HOLD[Math.max(0, Math.min(2, bannerCurrent.priority | 0))];
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { hideBanner(false); }, hold);
  }
  function hideBanner(fast) {
    if (bannerTimer) { clearTimeout(bannerTimer); bannerTimer = 0; }
    if (bannerState === "idle") return;
    bannerState = "out";
    if (bannerEl) bannerEl.classList.remove("in");
    if (sliverEl) sliverEl.classList.remove("in");
    setTimeout(function () {
      bannerCurrent = null;
      bannerState = "idle";
      setTimeout(pumpBanner, fast ? 30 : BANNER_GAP_MS);
    }, fast ? 40 : BANNER_OUT_MS);
  }
  // phone raised/stowed (or the map opened) mid-banner: requeue the current
  // banner so it re-presents on the correct surface once allowed again.
  function retargetBanner() {
    if (bannerState === "idle" || !bannerCurrent) return;
    bannerQueue.unshift(bannerCurrent);
    hideBanner(true);
  }
  function notiTap() {
    const item = bannerCurrent;
    hideBanner(true);
    if (!item) return;
    if (typeof item.onTap === "function") {
      try { item.onTap(item); return; } catch (e) {}
    }
    open(appTab(item.app));
  }

  // store an item into the app lists (the phone's own history/notification center)
  function logItem(item) {
    const tab = appTab(item.app);
    if (tab === "missions") {
      if (state.mission) {
        if (!state.mission.updates) state.mission.updates = [];
        state.mission.updates.push(item);
      } else {
        // A mission notification without a formal setMission still stays on the
        // Missions app; it never leaks into a floating toast.
        state.mission = normalizeMission({ title: item.from, briefing: item.body, id: item.id });
      }
      state.unread.missions = !(state.open && state.app === "missions");
    } else {
      const list = tab === "news" ? state.news : state.messages;
      list.push(item);
      trimList(list);
      state.unread[tab] = (state.open && state.app === tab) ? 0 : (state.unread[tab] + 1);
    }
  }

  // ---- CBZ.phoneNotify — the canonical diegetic notification entry -----------
  // Accepts { app, from, text, icon?, priority?, ttl?, onTap?, meta? } or a bare
  // legacy string (auto-classified). Logs into the matching app, then banners.
  function phoneNotify(payload) {
    if (typeof payload === "string") payload = classifyLegacyString(payload);
    payload = payload || {};
    let app = String(payload.app || "messages").toLowerCase();
    if (APPS_V2.indexOf(app) < 0) app = "messages";
    const text = textOf(payload.text != null ? payload.text : (payload.body != null ? payload.body : payload.message), "");
    if (!text) return null;
    // control legends / key prompts are UI mechanics, never a push (V2 only;
    // mission briefs keep their authored text untouched)
    if (notisV2() && app !== "missions" && KEYBIND_RE.test(text)) return null;
    const item = {
      id: "notice-" + Date.now() + "-" + (++serial),
      type: payload.type || app,
      app: app,
      from: resolveSender(app, payload.from),
      text: text,
      body: text,          // renderItems()/mission updates read .body
      icon: payload.icon || APP_GLYPH[app],
      priority: Math.max(0, Math.min(2, payload.priority | 0)),
      ttl: (typeof payload.ttl === "number" && payload.ttl > 0) ? payload.ttl : 0,
      onTap: typeof payload.onTap === "function" ? payload.onTap : null,
      time: nowLabel(),
      born: Date.now(),
      meta: payload.meta || null,
    };
    // No handset outside the campaign: fall back to the street feed so the
    // notice is never silently lost (new systems can call phoneNotify blind).
    if (!campaignEnabled() || !playableMode()) {
      const feed = CBZ.cityFeed && CBZ.cityFeed._campaignOriginal ? CBZ.cityFeed._campaignOriginal : CBZ.cityFeed;
      if (typeof feed === "function") { try { feed(item.from + ": " + item.text); } catch (e) {} }
      return item;
    }
    logItem(item);
    render();
    const seen = state.open && state.app === appTab(app);
    if (!seen) {
      if (notisV2()) enqueueBanner(item);
      else pulsePeek();
    }
    return item;
  }

  function notify(type, from, body, meta) {
    // Object form is convenient for event buses while keeping the requested
    // positional API fully supported.
    if (type && typeof type === "object") {
      const event = type;
      if (event.app) return phoneNotify(event);   // V2 payloads pass through whole
      type = event.type || event.channel || "message";
      from = event.from || event.sender || event.title || from;
      body = event.body || event.text || event.message || body;
      meta = event.meta || meta;
    }
    type = String(type || "message").toLowerCase();
    // "auto": classify a legacy free-string into an in-world app + sender.
    if (type === "auto") {
      const c = classifyLegacyString(body);
      if (from) c.from = from;
      c.meta = meta || null;
      if (meta && meta.urgent) c.priority = 2;
      return phoneNotify(c);
    }
    const isNews = type === "news" || type === "bulletin" || type === "headline";
    const isMission = type === "mission" || type === "contract" || type === "objective";
    return phoneNotify({
      app: isMission ? "missions" : (isNews ? "news" : "messages"),
      type: type,
      from: from,
      text: body,
      meta: meta,
      priority: (meta && meta.urgent) ? 2 : 0,
    });
  }

  function compatActive() {
    return campaignEnabled() && playableMode() && !!(document.body && document.body.classList.contains("campaign-active"));
  }

  function compatNotify(channel, from, body, meta) {
    body = textOf(body, "");
    if (!body) return null;
    const key = channel + "\u0000" + from + "\u0000" + body;
    const now = Date.now();
    const last = compatRecent.get(key) || 0;
    if (now - last < COMPAT_DEDUPE_MS) return null;
    compatRecent.set(key, now);
    // Keep the exact-message throttle bounded even if a simulation emits an
    // endless stream of unique world-state prose.
    if (compatRecent.size > 160) {
      compatRecent.forEach(function (born, k) {
        if (now - born > COMPAT_DEDUPE_MS * 3) compatRecent.delete(k);
      });
      while (compatRecent.size > 160) compatRecent.delete(compatRecent.keys().next().value);
    }
    return notify(channel, from, body, Object.assign({ compatibility: true }, meta || {}));
  }

  function installCompatibilityWrappers() {
    // V2: free-string sinks (flashHint/flashToast) auto-classify into an
    // in-world app + sender instead of the old meta "Status"/"Alert" labels;
    // objectives come from the handler, not an "Objective" system voice.
    const specs = [
      { name: "flashHint", channel: "message", from: "Status", v2: "auto" },
      { name: "flashToast", channel: "news", from: "Alert", v2: "auto" },
      { name: "cityFeed", channel: "news", from: "City Desk" },
      { name: "setObjective", channel: "mission", from: "Objective", v2From: null },
    ];
    specs.forEach(function (spec) {
      const current = CBZ[spec.name];
      if (typeof current !== "function" || current._campaignCompatibility) return;
      const wrapped = function () {
        if (compatActive()) {
          const body = arguments[0];
          if (notisV2()) {
            if (spec.v2) return compatNotify(spec.v2, null, body, { source: spec.name });
            if ("v2From" in spec) return compatNotify(spec.channel, spec.v2From, body, { source: spec.name });
          }
          return compatNotify(spec.channel, spec.from, body, { source: spec.name });
        }
        return current.apply(this, arguments);
      };
      wrapped._campaignCompatibility = true;
      wrapped._campaignOriginal = current;
      CBZ[spec.name] = wrapped;
    });
  }

  function normalizeChoices(choices) {
    if (!Array.isArray(choices)) return [];
    return choices.map(function (choice, i) {
      if (typeof choice === "string") {
        return { id: String(i), label: choice, value: choice, onSelect: null };
      }
      choice = choice || {};
      return {
        id: textOf(choice.id, String(i)),
        label: textOf(choice.label || choice.text, "Choice " + (i + 1)),
        value: choice.value !== undefined ? choice.value : (choice.id !== undefined ? choice.id : i),
        onSelect: typeof choice.onSelect === "function" ? choice.onSelect : (typeof choice.callback === "function" ? choice.callback : null),
      };
    });
  }

  function finishDialogue(result, runCallback) {
    const pending = state.dialogue;
    const resolve = choiceResolve;
    state.dialogue = null;
    choiceResolve = null;
    if (dialogueEl) dialogueEl.classList.remove("show");
    document.body.classList.remove("campaign-dialogue-active");
    if (runCallback && pending && result && result.onSelect) {
      try { result.onSelect(result.value, result); } catch (e) { setTimeout(function () { throw e; }, 0); }
    }
    if (resolve) resolve(result ? result.value : null);
  }

  function say(speaker, text, choices) {
    ensureDom();
    if (choiceResolve) finishDialogue(null, false);
    // The director's canonical third argument is metadata ({ actor }). Arrays
    // retain the compact legacy form for inline dialogue choices.
    const metadata = (!Array.isArray(choices) && choices && typeof choices === "object") ? choices : null;
    const normalized = normalizeChoices(Array.isArray(choices) ? choices : []);
    state.dialogue = {
      speaker: speakerName(speaker),
      text: textOf(text, ""),
      choices: normalized,
      actor: metadata && metadata.actor ? metadata.actor : null,
    };
    if (dialogueSpeaker) dialogueSpeaker.textContent = state.dialogue.speaker;
    if (dialogueText) dialogueText.textContent = state.dialogue.text;
    if (dialogueChoices) {
      dialogueChoices.textContent = "";
      normalized.forEach(function (choice, i) {
        const button = make("button", "campaign-dialogue-choice");
        button.type = "button";
        button.setAttribute("data-choice", choice.id);
        button.appendChild(make("span", "campaign-dialogue-key", String(i + 1)));
        button.appendChild(make("span", "campaign-dialogue-choice-text", choice.label));
        dialogueChoices.appendChild(button);
      });
    }
    if (dialogueEl) dialogueEl.classList.add("show");
    document.body.classList.add("campaign-dialogue-active");
    return new Promise(function (resolve) { choiceResolve = resolve; });
  }

  function choice(def) {
    def = def || {};
    const prior = state.dialogue;
    const prompt = textOf(def.prompt, prior ? prior.text : "Choose.");
    const speaker = textOf(def.speaker || def.from, prior ? prior.speaker : "Decision");
    const onChoose = typeof def.onChoose === "function" ? def.onChoose : null;
    const choiceId = def.id;
    const options = (Array.isArray(def.options) ? def.options : []).map(function (option, i) {
      if (typeof option === "string") option = { id: option, label: option };
      option = option || {};
      const value = option.id !== undefined ? option.id : i;
      return {
        id: textOf(option.id, String(i)),
        label: textOf(option.label || option.text, "Choice " + (i + 1)),
        value: value,
        onSelect: function () {
          if (onChoose) onChoose(value, choiceId, option);
        },
      };
    });
    return say(speaker, prompt, options);
  }

  function choose(idOrIndex) {
    const dialogue = state.dialogue;
    if (!dialogue || !dialogue.choices.length) return false;
    const raw = String(idOrIndex);
    let choice = dialogue.choices.find(function (item) { return item.id === raw; });
    if (!choice && /^\d+$/.test(raw)) choice = dialogue.choices[parseInt(raw, 10)];
    if (!choice) return false;
    finishDialogue(choice, true);
    return choice.value;
  }

  function clearDialogue() {
    finishDialogue(null, false);
  }

  // ---- full-screen campaign moment (the CITY BOSS takeover card) ------------
  // The one deliberate exception to "prose lives on the phone": an earned,
  // story-scale ending gets a real full-screen beat. Any click/keypress or the
  // timer puts it away; it owns no game state beyond its own visibility.
  let takeoverEl = null, takeoverTimer = 0;
  function takeoverOpen() {
    return !!(takeoverEl && takeoverEl.classList.contains("show"));
  }
  function hideTakeover() {
    if (takeoverTimer) { clearTimeout(takeoverTimer); takeoverTimer = 0; }
    if (takeoverEl) takeoverEl.classList.remove("show");
    if (document.body) document.body.classList.remove("campaign-takeover-open");
  }
  function takeover(def) {
    def = def || {};
    ensureDom();
    if (!document.body) return false;
    if (!takeoverEl) {
      takeoverEl = make("div", "campaign-takeover");
      takeoverEl.id = "campaignTakeover";
      takeoverEl.setAttribute("aria-live", "assertive");
      takeoverEl.innerHTML =
        "<div class='campaign-takeover-inner'>" +
        "  <div class='campaign-eyebrow campaign-takeover-eyebrow'></div>" +
        "  <h1 class='campaign-title campaign-takeover-title'></h1>" +
        "  <div class='campaign-title campaign-takeover-sub'></div>" +
        "  <p class='campaign-takeover-body'></p>" +
        "  <div class='campaign-takeover-hint'>click to continue</div>" +
        "</div>";
      takeoverEl.addEventListener("click", hideTakeover);
      document.body.appendChild(takeoverEl);
    }
    takeoverEl.querySelector(".campaign-takeover-eyebrow").textContent = textOf(def.eyebrow, "THE CONTRACT");
    takeoverEl.querySelector(".campaign-takeover-title").textContent = textOf(def.title, "CITY BOSS");
    takeoverEl.querySelector(".campaign-takeover-sub").textContent = textOf(def.sub, "");
    takeoverEl.querySelector(".campaign-takeover-body").textContent = textOf(def.body, "");
    takeoverEl.classList.add("show");
    document.body.classList.add("campaign-takeover-open");
    if (takeoverTimer) clearTimeout(takeoverTimer);
    takeoverTimer = setTimeout(hideTakeover, 10000);
    return true;
  }

  function hideWorldNameTags() {
    if (!playableMode() || !document.body.classList.contains("campaign-active")) return;
    const pools = [CBZ.cityPeds, CBZ.cityCops, CBZ.npcs, CBZ.guards];
    pools.forEach(function (pool) {
      if (!pool) return;
      for (let i = 0; i < pool.length; i++) {
        const actor = pool[i];
        if (actor && actor.tag) actor.tag.visible = false;
        if (actor && actor._tag) actor._tag.visible = false;
      }
    });
  }

  function syncMode() {
    if (!document.body) return;
    canonicalizeTitle();
    const active = campaignEnabled() && playableMode();
    document.body.classList.toggle("campaign-active", active);
    // V2 body stamp: campaign.css gates the map/minimap restore + banner styles
    // on this class so CBZ.CONFIG.PHONE_NOTIS_V2 stays a one-line revert.
    document.body.classList.toggle("notis-v2", notisV2());
    // banner upkeep: flush queued notices once suppression (map open, takeover,
    // pause) clears; shelve a held banner if suppression starts mid-hold.
    if (bannerState === "hold" && bannerSuppressed()) retargetBanner();
    else if (bannerState === "idle" && bannerQueue.length) pumpBanner();
    // ENDLESS free time re-opens the ambient gang-game surfaces (turf meta,
    // kill feed, orders, interact card) that scripted beats keep dark —
    // campaign.css scopes its hides with :not(.campaign-endless).
    const endlessFree = active && typeof CBZ.cityCampaignInEndless === "function" && CBZ.cityCampaignInEndless();
    document.body.classList.toggle("campaign-endless", !!endlessFree);
    installCompatibilityWrappers();
    if (!livePlay() && state.open) close();
    if (peek) peek.classList.toggle("available", livePlay() && !state.open);
    if (!active && state.dialogue) clearDialogue();
    hideWorldNameTags();
    if (clockEl && state.open) clockEl.textContent = nowLabel();
  }

  function keydown(event) {
    const key = String(event.key || "").toLowerCase();

    // A raised full-screen moment: any key puts it away (one press is eaten).
    if (takeoverOpen()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      hideTakeover();
      return;
    }

    // A visible choice line owns 1-9. Character speech remains the only prose
    // outside the phone, and these buttons are part of that conversation.
    if (!state.open && state.dialogue && state.dialogue.choices.length && /^[1-9]$/.test(key)) {
      const index = parseInt(key, 10) - 1;
      if (index < state.dialogue.choices.length) {
        event.preventDefault();
        event.stopImmediatePropagation();
        choose(index);
      }
      return;
    }

    if (key === "p" && livePlay()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) state.open ? close() : open();
      return;
    }

    if (!state.open) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (key === "escape") close();
    else if (key === "m" || event.code === "KeyM") {
      // [M] works from inside the raised phone too: hand the screen to the
      // map. fullMap.open() stows the phone itself (mutual exclusion), with
      // close() as the fallback when the map module isn't loaded.
      if (!(CBZ.fullMap && CBZ.fullMap.open && CBZ.fullMap.open())) close();
    }
    else if (/^[1-3]$/.test(key)) selectApp(APPS[parseInt(key, 10) - 1]);
  }

  function keyup(event) {
    if (!state.open) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (CBZ.keys) CBZ.keys[String(event.key || "").toLowerCase()] = false;
  }

  // Capture phase is intentional: it supersedes the legacy city phone's [P]
  // bubble listener and prevents movement/combat keys leaking through the raised
  // handset in both city and prison modes.
  window.addEventListener("keydown", keydown, true);
  window.addEventListener("keyup", keyup, true);

  const api = {
    setMission: setMission,
    notify: notify,
    phoneNotify: phoneNotify,
    say: say,
    choice: choice,
    choose: choose,
    clearDialogue: clearDialogue,
    takeover: takeover,
    open: open,
    close: close,
    isOpen: function () { return state.open; },
    activeApp: function () { return state.app; },
    state: function () { return state; },
  };
  CBZ.campaignUI = api;
  // The clean cross-module notification API: any system (bounties, inventory,
  // banking, news) sends a diegetic push with
  //   CBZ.phoneNotify({ from, app, text, icon?, priority?, ttl?, onTap? })
  // Legacy CBZ.campaignUI.notify(type, from, body) delegates into it.
  CBZ.phoneNotify = phoneNotify;

  // Programmatic callers of the old status phone land on the campaign phone.
  // Keep the legacy reference for debugging without leaving two visible phones.
  if (CBZ.cityOpenPhone && CBZ.cityOpenPhone !== open) CBZ.legacyCityOpenPhone = CBZ.cityOpenPhone;
  CBZ.cityOpenPhone = open;

  installCompatibilityWrappers();

  if (document.body) ensureDom();
  else document.addEventListener("DOMContentLoaded", ensureDom, { once: true });

  if (typeof CBZ.onAlways === "function") CBZ.onAlways(999.75, syncMode);
  else setInterval(syncMode, 250);
})();
