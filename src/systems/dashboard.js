/* ============================================================
   systems/dashboard.js — the YARD RANKINGS board.

   A live, toggleable scoreboard of every soul in the block — inmates,
   staff, the Warden and you — ranked by notoriety. It surfaces the two
   independent axes the sim now tracks for each character:
     • CAPABILITY (ratings: Fighting / Toughness / Speed / …)
     • TEMPERAMENT (behaviour: who actually starts trouble)
   …so you can see at a glance that the yard's strongest fighter might be
   a Pacifist who never swings, while some 30-rated nobody is a Hothead
   throwing hands at the world.

   Toggle / cycle views with Tab (or L). It's a non-blocking overlay: the
   world keeps living underneath so you can watch the standings shift.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const root = document.getElementById("dashboard");
  if (!root) return;

  const TABS = [
    { key: "power",     name: "Notoriety", sub: "overall standing" },
    { key: "deadliest", name: "Deadliest", sub: "kills & knockdowns" },
    { key: "fighters",  name: "Top Fighters", sub: "by fighting rating" },
  ];
  CBZ.ui.dashTab = 0;

  // stable, flavourful names for the otherwise-anonymous staff
  const GUARD_NAMES = ["Officer Reyes", "Officer Boyd", "Officer Kwan", "Officer Salas",
    "Officer Doyle", "Officer Pham", "Officer Cole", "Officer Ng", "Officer Ruiz",
    "Officer Webb", "Officer Tran", "Officer Hale", "Officer Mott", "Officer Dunn"];
  let guardSeq = 0;

  function dispName(a) {
    if (a === CBZ.player) return CBZ.game.role === "cop" ? "You · Officer" : "You · Inmate";
    if (a.kind === "warden") return "the Warden";
    if (a.kind === "guard") { if (!a.dashName) a.dashName = (a.corrupt ? "Bent · " : "") + (GUARD_NAMES[guardSeq++ % GUARD_NAMES.length]); return a.dashName; }
    if (a.data && a.data.name) return a.data.name.replace(/^the |^a |^an /, "");
    return "Inmate";
  }
  function faction(a) {
    if (a === CBZ.player) return { txt: "You", cls: "f-you" };
    if (a.kind === "warden") return { txt: "Warden", cls: "f-staff" };
    if (a.kind === "guard") return a.corrupt ? { txt: "Bent Cop", cls: "f-bent" } : { txt: "Staff", cls: "f-staff" };
    if (a.gang === 0) return { txt: "Reds", cls: "f-red" };
    if (a.gang === 1) return { txt: "Blues", cls: "f-blue" };
    return { txt: "Loner", cls: "f-loner" };
  }
  function behaviorCell(a) {
    if (a === CBZ.player) return { e: "🎮", l: "Player" };
    const b = CBZ.BEHAVIORS && CBZ.BEHAVIORS[a.behavior];
    return b ? { e: b.emoji, l: b.label } : { e: "🌀", l: "Wildcard" };
  }
  function statusCell(a) {
    if (a.escaped) return { txt: "ESCAPED", cls: "s-esc" };
    if (a.dead) return { txt: "DEAD", cls: "s-dead" };
    if ((a.ko || 0) > 0) return { txt: "KO'd", cls: "s-ko" };
    if ((a.huntPlayer || 0) > 0 || (a.hunt || 0) > 0) return { txt: "Hunting", cls: "s-fight" };
    if (a.aiState === "fight" || a.foe) return { txt: "Fighting", cls: "s-fight" };
    const mhp = a.maxHp || 100;
    if (a.hp != null && a.hp < mhp * 0.45) return { txt: "Hurt", cls: "s-hurt" };
    if (a.aiState === "flee") return { txt: "Fleeing", cls: "s-flee" };
    return { txt: "Active", cls: "s-ok" };
  }
  function rec(a) { return a.record || { kills: 0, knockdowns: 0 }; }

  function bar(v, cls) {
    v = Math.max(0, Math.min(100, Math.round(v || 0)));
    return `<span class="dbt"><i class="${cls}" style="width:${v}%"></i></span><span class="dbv">${v}</span>`;
  }

  // gather every ranked combatant, ensuring each has a capability profile
  function roster() {
    const list = [];
    for (const n of CBZ.npcs || []) { if (CBZ.ensureCombatProfile) CBZ.ensureCombatProfile(n); list.push(n); }
    for (const g of CBZ.guards || []) list.push(g);
    if (CBZ.player) list.push(CBZ.player);
    return list;
  }

  function sortFor(tab, list) {
    if (tab === "deadliest") {
      return list.sort((a, b) => {
        const ra = rec(a), rb = rec(b);
        return (rb.kills * 100 + rb.knockdowns * 10 + (rb.fights || 0)) - (ra.kills * 100 + ra.knockdowns * 10 + (ra.fights || 0));
      });
    }
    if (tab === "fighters") {
      return list.sort((a, b) => ((b.ratings && b.ratings.fighting) || 0) - ((a.ratings && a.ratings.fighting) || 0));
    }
    return list.sort((a, b) => (CBZ.npcPower(b) || 0) - (CBZ.npcPower(a) || 0));
  }

  function render() {
    if (!CBZ.ui.dashboard) { root.classList.remove("show"); return; }
    root.classList.add("show");
    const tab = TABS[CBZ.ui.dashTab].key;
    guardSeq = 0; // keep guard names stable across a render pass
    const list = sortFor(tab, roster());

    // ---- header summary ----
    const inmates = (CBZ.npcs || []);
    const alive = inmates.filter((n) => !n.dead && !n.escaped && !(n.ko > 0)).length;
    const fighting = inmates.filter((n) => n.aiState === "fight" || n.foe).length;
    const deaths = CBZ.game.deaths || 0;
    const escaped = inmates.filter((n) => n.escaped).length;
    const myRank = list.indexOf(CBZ.player) + 1;

    const tabsHtml = TABS.map((t, i) =>
      `<span class="dtab${i === CBZ.ui.dashTab ? " on" : ""}">${t.name}</span>`).join("");

    const headStats = [
      ["Inmates", inmates.length], ["Standing", alive], ["Brawls", fighting],
      ["Down", deaths], ["Escaped", escaped], ["Your rank", myRank > 0 ? "#" + myRank : "—"],
    ].map((s) => `<div class="dstat"><b>${s[1]}</b><span>${s[0]}</span></div>`).join("");

    // ---- rows ----
    let rows = "";
    list.forEach((a, i) => {
      const f = faction(a), b = behaviorCell(a), st = statusCell(a), r = rec(a);
      const R = a.ratings || {};
      const dead = a.dead || a.escaped;
      const me = a === CBZ.player;
      rows +=
        `<div class="drow${me ? " me" : ""}${dead ? " gone" : ""}">` +
          `<span class="drank">${i + 1}</span>` +
          `<span class="dname">${dispName(a)}</span>` +
          `<span class="dfac ${f.cls}">${f.txt}</span>` +
          `<span class="dbeh" title="${(CBZ.BEHAVIORS && CBZ.BEHAVIORS[a.behavior] && CBZ.BEHAVIORS[a.behavior].desc) || ""}">${b.e} ${b.l}</span>` +
          `<span class="dcap dcap-fight">${bar(R.fighting, "cf")}</span>` +
          `<span class="dcap dcap-t">${bar(R.toughness, "ct")}</span>` +
          `<span class="dcap dcap-s">${bar(R.speed, "cs")}</span>` +
          `<span class="dpow">${CBZ.npcPower(a) || 0}</span>` +
          `<span class="drec">${r.kills > 0 ? `<b class="k">${r.kills}K</b> ` : ""}${(r.knockdowns || 0)}<small>ko</small></span>` +
          `<span class="dstatus ${st.cls}">${st.txt}</span>` +
        `</div>`;
    });

    root.innerHTML =
      `<div class="dpanel">` +
        `<div class="dhead">` +
          `<div class="dtitle">CELL BLOCK <span class="z">Z</span> · YARD RANKINGS</div>` +
          `<div class="dtabs">${tabsHtml}<span class="dhint">Tab / L — cycle · Esc — close</span></div>` +
        `</div>` +
        `<div class="dsummary">${headStats}</div>` +
        `<div class="dsub">${TABS[CBZ.ui.dashTab].sub} — <b>capability</b> bars (fight/tough/speed) are independent of <b>temperament</b> (who starts trouble)</div>` +
        `<div class="dcols">` +
          `<span class="drank">#</span><span class="dname">Name</span><span class="dfac">Faction</span>` +
          `<span class="dbeh">Temperament</span><span class="dcap dcap-fight">Fight</span><span class="dcap dcap-t">Tuf</span>` +
          `<span class="dcap dcap-s">Spd</span><span class="dpow">Notor.</span><span class="drec">Record</span><span class="dstatus">Status</span>` +
        `</div>` +
        `<div class="dlist">${rows}</div>` +
      `</div>`;
  }

  // ---- toggle / cycle: Tab or L steps closed → views → closed ----
  function cycle() {
    if (!CBZ.ui.dashboard) { CBZ.ui.dashboard = true; CBZ.ui.dashTab = 0; }
    else if (CBZ.ui.dashTab < TABS.length - 1) { CBZ.ui.dashTab++; }
    else { CBZ.ui.dashboard = false; }
    render();
  }
  function close() { if (CBZ.ui.dashboard) { CBZ.ui.dashboard = false; render(); } }

  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const k = e.key;
    // Tab toggles the rankings dashboard. L is NEVER bound here — I/J/K/L are
    // interaction slots only. City owns Tab for its own leaderboard, so skip city.
    if (k === "Tab" && CBZ.game.mode !== "city") {
      if (CBZ.game.state !== "playing" && !CBZ.ui.dashboard) return; // only open while in-game
      e.preventDefault();
      cycle();
    } else if (CBZ.ui.dashboard && (k === "Escape")) {
      close();
    }
  });

  // a HUD button so touch / mouse users can open it too
  const btn = document.getElementById("dashBtn");
  if (btn) btn.addEventListener("click", (e) => { e.preventDefault(); cycle(); });

  // close it whenever we leave play (win / title)
  CBZ.onAlways(90, function () {
    if (CBZ.ui.dashboard && CBZ.game.state !== "playing") { CBZ.ui.dashboard = false; render(); return; }
    if (!CBZ.ui.dashboard) return;
    // throttle live refresh to ~5 Hz
    const t = CBZ.now || 0;
    if (t - (render._last || 0) > 190) { render._last = t; render(); }
  });

  CBZ.renderDashboard = render;
})();
