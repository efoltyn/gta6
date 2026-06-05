/* ============================================================
   city/story.js — the come-up. A progression arc that takes the
   player from a broke nobody to a city kingpin, gated by milestones.

   Each milestone watches the live game state (g.* + the world ledger)
   and, the moment its condition is met, fires a beat (city.big / note),
   pays out a reward (cash / respect), and advances the chapter. The
   current chapter + which milestones are done persist on g.cityStory
   AND on the world ledger so the arc survives across runs/deaths.

   A tiny "objective" HUD line (own DOM, never touches hud.js) shows the
   next thing to chase.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;

  // ---- chapters: the rungs of the ladder ----
  const CHAPTERS = [
    "Nobody",        // 0 — fresh off the bus
    "Hustler",       // 1 — got your first money up
    "Soldier",       // 2 — strapped, blood on your hands
    "Shot Caller",   // 3 — you run a crew
    "Made",          // 4 — property + a gang of your own
    "Heavy",         // 5 — six figures, feared
    "Kingpin",       // 6 — you took a rival's throne
  ];

  // ---- milestones, in order. Each: id, chapter it belongs to, the
  //      objective text, a met(world) predicate, and a reward beat. ----
  const MILESTONES = [
    {
      id: "firstCash", chapter: 1, obj: "Stack your first $1,000.",
      met: () => bank() >= 1000,
      big: "💵 FIRST BAND", note: "A grand to your name. Word travels — you're a hustler now.",
      cash: 250, respect: 4,
    },
    {
      id: "firstGun", chapter: 2, obj: "Get a gun — buy one or take one.",
      met: () => hasGun(),
      big: "🔫 STRAPPED", note: "Heat in your hand. Nobody talks down to you now.",
      respect: 6,
    },
    {
      id: "firstKill", chapter: 2, obj: "Make your first kill.",
      met: () => (g.kills || 0) >= 1,
      big: "☠️ BODY DROPPED", note: "First body. The street learns your name the hard way.",
      cash: 300, respect: 10,
    },
    {
      id: "crew", chapter: 3, obj: "Recruit 3 to your crew — aim a gun at a ped.",
      met: () => crewSize() >= 3,
      big: "👥 YOU GOT GOONS", note: "Three deep and loyal. You give orders now.",
      cash: 500, respect: 12,
    },
    {
      id: "property", chapter: 4, obj: "Claim a property — buy or rent [Z].",
      met: (w) => propCount(w) >= 1,
      big: "🏠 A SPOT OF YOUR OWN", note: "Four walls you control. The empire starts here.",
      cash: 800, respect: 10,
    },
    {
      id: "gang", chapter: 4, obj: "Start your own gang with your crew.",
      met: () => CBZ.cityPlayerGangExists && CBZ.cityPlayerGangExists(),
      big: "🚩 SET CLAIMED", note: "Your colors fly over the block. You answer to nobody.",
      cash: 1500, respect: 25,
    },
    {
      id: "rich", chapter: 5, obj: "Reach $100k net worth.",
      met: () => netWorth() >= 100000,
      big: "💰 SIX FIGURES", note: "A hundred bands deep. The whole city feels you.",
      cash: 5000, respect: 40,
    },
    {
      id: "takeover", chapter: 6, obj: "Kill a rival boss and take their gang.",
      met: () => tookOverRival(),
      big: "👑 KINGPIN", note: "You took a rival's crown. This city is yours now.",
      cash: 15000, respect: 100,
    },
  ];

  // ---- helpers reading live state ----
  function world() { return CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null; }
  function bank() { return (g.cash || 0) + (g.cityBank || 0); }
  function hasGun() {
    if (g.cityWeapon) {
      const it = CBZ.cityEcon && CBZ.cityEcon.ITEMS && CBZ.cityEcon.ITEMS[g.cityWeapon];
      if (it && it.gun) return true;
    }
    const inv = g.cityInv || {};
    const ITEMS = CBZ.cityEcon && CBZ.cityEcon.ITEMS;
    if (ITEMS) for (const k in inv) { if (inv[k] > 0 && ITEMS[k] && ITEMS[k].gun) return true; }
    return false;
  }
  function crewSize() {
    if (CBZ.cityPlayerGangMembers) return CBZ.cityPlayerGangMembers().length;
    if (CBZ.cityPeds) return CBZ.cityPeds.filter((p) => p && p.companion && p.recruited && !p.dead).length;
    return g.cityCrew || 0;
  }
  function propCount(w) {
    w = w || world(); if (!w || !w.assets) return 0;
    return (w.assets.properties ? w.assets.properties.length : 0) +
           (w.assets.businesses ? w.assets.businesses.length : 0);
  }
  function netWorth() {
    // mirrors leaderboard scoring so "net worth" means the same thing everywhere.
    const w = world();
    const props = propCount(w);
    let crew = crewSize();
    let notoriety = (w && w.criminalRecord) ? (w.criminalRecord.wantedPeak || 0) : (g.wanted || 0);
    return bank() + (g.respect || 0) * 90 + (g.kills || 0) * 240 +
      props * 14000 + crew * 4200 + notoriety * 350;
  }
  function tookOverRival() {
    // your gang exists AND a rival gang has been absorbed into it.
    if (!(CBZ.cityPlayerGangExists && CBZ.cityPlayerGangExists())) return false;
    const gangs = CBZ.cityGangs || [];
    for (const gg of gangs) if (gg && gg.absorbed) return true;
    // fallback: holding multiple turf blocks signals a takeover happened
    const pg = g.playerGang;
    return !!(pg && pg.turf && pg.turf.length >= 3);
  }

  // ---- persistent story state ----
  function ensure() {
    if (!g.cityStory) {
      // prefer the durable copy on the world ledger if present
      const w = world();
      if (w && w.story && w.story.done) {
        g.cityStory = { chapter: w.story.chapter || 0, done: Object.assign({}, w.story.done), idx: w.story.idx || 0 };
      } else {
        g.cityStory = { chapter: 0, done: {}, idx: 0 };
      }
    }
    return g.cityStory;
  }
  CBZ.cityStoryEnsure = ensure;

  function persist() {
    const s = ensure();
    const w = world();
    if (w) {
      w.story = { chapter: s.chapter, done: s.done, idx: s.idx };
      if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    }
  }

  // ---- objective HUD (our own DOM; never touches hud.js) ----
  let bar = null;
  function barEl() {
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "cityObjective";
    // A quiet slim line tucked under the radar block (radar ~14..204, turf 212,
    // home 232) on the left. Never overlaps radar/money/wanted/ammo/speed — it's
    // a nudge you can ignore. Subtle pill, no heavy box.
    bar.style.cssText = "position:fixed;left:16px;top:256px;z-index:18;display:none;max-width:230px;padding:3px 9px 3px 7px;background:rgba(10,12,18,.42);border-left:2px solid rgba(255,209,102,.65);border-radius:4px;color:#cdd6e3;font-family:Fredoka,system-ui,sans-serif;font-size:11px;line-height:1.35;letter-spacing:.2px;text-align:left;text-shadow:0 1px 2px rgba(0,0,0,.7);pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.9";
    document.body.appendChild(bar);
    return bar;
  }

  function nextMilestone() {
    const s = ensure();
    for (const m of MILESTONES) if (!s.done[m.id]) return m;
    return null;
  }

  let lastObjText = "";
  function refreshBar() {
    const el = barEl();
    if (g.mode !== "city") { el.style.display = "none"; return; }
    const m = nextMilestone();
    const s = ensure();
    let txt;
    if (m) {
      txt = "<span style='color:#ffd166;font-weight:700;font-size:9px;letter-spacing:1px;opacity:.85'>" + CHAPTERS[s.chapter].toUpperCase() + "</span>&nbsp; " + m.obj;
    } else {
      txt = "<span style='color:#7ed957;font-weight:700;font-size:9px;letter-spacing:1px'>KINGPIN</span>&nbsp; Hold the throne.";
    }
    if (txt !== lastObjText) { el.innerHTML = txt; lastObjText = txt; }
    el.style.display = (CBZ.cityMenuOpen ? "none" : "block");
  }

  function award(m) {
    const s = ensure();
    s.done[m.id] = true;
    if (m.chapter > s.chapter) s.chapter = m.chapter;
    s.idx = Math.max(s.idx, MILESTONES.indexOf(m) + 1);
    // beat
    if (m.big && CBZ.city && CBZ.city.big) CBZ.city.big(m.big);
    if (m.note && CBZ.city && CBZ.city.note) CBZ.city.note(m.note, 3.4);
    // reward
    if (m.cash && CBZ.city && CBZ.city.addCash) CBZ.city.addCash(m.cash);
    if (m.respect && CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(m.respect);
    if (CBZ.sfx) CBZ.sfx("win");
    // a second beat: announce the new chapter rank
    if (m.chapter > 0) {
      const title = CHAPTERS[s.chapter];
      setTimeout(function () {
        if (g.mode === "city" && CBZ.city && CBZ.city.note) CBZ.city.note("📈 New status: " + title, 3.0);
      }, 1100);
    }
    persist();
    if (CBZ.cityEvent) CBZ.cityEvent("story", { label: "Milestone: " + m.id }, { silent: true });
    lastObjText = ""; // force objective bar to redraw
  }

  // ---- public hooks ----
  CBZ.cityStoryReset = function () {
    // a "new life" keeps the persisted arc (it's a career), but re-binds state.
    g.cityStory = null;
    ensure();
    lastObjText = "";
  };
  CBZ.cityStoryChapter = function () { const s = ensure(); return { idx: s.chapter, name: CHAPTERS[s.chapter] }; };

  // ---- the driver: check milestones in order each tick ----
  let scanT = 0;
  CBZ.onUpdate(39.5, function (dt) {
    if (g.mode !== "city") return;
    scanT -= dt;
    if (scanT > 0) { refreshBar(); return; }
    scanT = 0.5;
    const s = ensure();
    const w = world();
    // fire every milestone whose condition is now met. We walk in order and
    // credit any rung the player has actually earned (so buying a gun before
    // banking $1k still counts), but award() only ever raises the chapter —
    // it never drops it — so your status climbs monotonically.
    for (const m of MILESTONES) {
      if (s.done[m.id]) continue;
      let ok = false;
      try { ok = !!m.met(w); } catch (e) { ok = false; }
      if (ok) award(m);
    }
    refreshBar();
  });
})();
