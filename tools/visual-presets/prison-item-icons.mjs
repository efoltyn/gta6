/* prison-item-icons.mjs — EVERY JAIL ITEM IS A MINI VERSION OF THE THING.

   OWNER (2026-10-28): "Your whole trade thing shows how, in jail, a lot of the
   items in inventory are stupid fucking fake icons, like a fucking cube. What
   the fuck is the cube? I like the guns because the icon is a mini version of
   the actual gun. That's cool. All the other fucking icons are stupid.
   Flashlight's good too."

   Two subjects, one booted Escape run per side:
     trade          the trade table with both pockets full of real prison goods
     contact-sheet  every item the jail economy knows, plus the smokes and the
                    belt (guns, torch, keycard, keys), in one grid: the icon
                    each one gets, straight out of the one icon studio.

   Metrics: cubes = items whose icon is the generic parcel (the owner's cube),
   photographed = tiles carrying a real photograph.

     ba --preset prison-item-icons --before <origin/main server> --frames laptop,iphone-16:landscape
*/

const FRAMES = ["laptop", "iphone-16:landscape"];

export default {
  id: "prison-item-icons",
  title: "Jail: every item icon is the real thing",
  description: "The trade table and a contact sheet of every jail item icon, before and after the cubes became models.",
  subjects: [
    { id: "trade", label: "Trade: both pockets full",
      focus: "Every tile is a small render of the object (a pack, a lighter, a flip phone), like the guns. No cube, no CSS bar for the smokes." },
    { id: "contact-sheet", label: "Every jail item icon",
      focus: "The whole jail catalog plus the smokes and the belt, straight out of the icon studio. No parcel cubes." },
  ],
  frameList: FRAMES,
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  beforeLabel: "BEFORE · origin/main",
  afterLabel: "AFTER · real models",
  pairNote: "Same seed, same man, same pockets",
  metrics: {
    cubes: { label: "Jail items drawn as the generic parcel cube", better: "lower" },
    photographed: { label: "Tiles with a real photograph", better: "higher" },
    tiles: { label: "Tiles on screen" },
  },

  stage: async function stageIcons(input) {
    const CBZ = window.CBZ;
    if (!CBZ || !window.THREE) return { ok: false, err: "no CBZ/THREE" };
    // HARNESS TRAP: stage() is serialized into the page, so module-level
    // constants do not exist there; the pocket lists live inside it.
    const MINE = ["Lighter", "Soap", "Ramen", "Energy Bar", "Energy Drink", "Razor Blade", "Phone Charger",
      "Cigarette Carton", "Bedsheet Rope", "Contraband Map", "Handcuff Key", "Hacksaw Blade", "Lockpick", "Bandage"];
    const HIS = ["Burner Phone", "Burner SIM", "Pruno Hooch", "Powder", "Pills", "Painkillers", "Brass Knuckles",
      "Tattoo Gun", "Shiv", "Gold Chain", "Cash Roll", "Gold Tooth", "Luxury Watch", "Stolen Wallet"];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (test, budgetMs, stepMs) => {
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) {
        try { if (test()) return true; } catch (_) {}
        await wait(stepMs || 250);
      }
      return false;
    };
    let S = window.__iconSeq;
    if (!S) {
      const booted = await until(() => CBZ.game && CBZ.stepSim && document.getElementById("playBtn") &&
        document.querySelector('[data-mode="escape"]'), 300000);
      if (!booted) return { ok: false, err: "never booted" };
      document.querySelector('[data-mode="escape"]').click();
      const playing = await until(() => {
        if (CBZ.game.state === "playing") return true;
        const b = document.getElementById("playBtn");
        if (b) b.click();
        return CBZ.game.state === "playing";
      }, 180000, 300);
      if (!playing) return { ok: false, err: "never reached playing" };
      try { if (CBZ.bootMeter && CBZ.bootMeter.hide) CBZ.bootMeter.hide(); } catch (_) {}
      try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
      window.requestAnimationFrame = function () { return 0; };
      await wait(700);
      // HARNESS TRAP: the opening beats own the player's feet for a few seconds
      for (let i = 0; i < 720; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); }
      for (const id of ["bootload", "fade", "loading"]) { const el = document.getElementById(id); if (el) el.style.display = "none"; }
      S = window.__iconSeq = {};
      window.__cbzVisualCompare = { render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} } };
    }
    const P = CBZ.player;
    const step = (n) => { for (let i = 0; i < (n || 1); i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60); P.hp = 100; P.dead = false; } };
    const sub = input.subject.id;
    const sheet = document.getElementById("__iconSheet");
    if (sheet) sheet.remove();
    try { if (CBZ.prisonTrade && CBZ.prisonTrade.isOpen()) CBZ.prisonTrade.close(); } catch (_) {}

    const IT = (CBZ.econ && CBZ.econ.ITEMS) || {};
    const kindOf = (n) => { try { return CBZ.itemKind ? CBZ.itemKind(n, IT[n] || null) : "?"; } catch (_) { return "?"; } };
    const html = (n) => { try { return CBZ.itemIconHtml ? CBZ.itemIconHtml(n, null, "md") : ""; } catch (_) { return ""; } };
    // ask for every face once, then let the studio's queue drain
    const settle = async (names) => {
      names.forEach(html);
      try { if (CBZ.flashlightThumbnail) CBZ.flashlightThumbnail(); } catch (_) {}
      try { ["sidearm", "taser", "carbine"].forEach((g) => CBZ.itemIconGun && CBZ.itemIconGun(g)); } catch (_) {}
      await until(() => !CBZ.iconStudio || CBZ.iconStudio.pending() === 0, 90000, 200);
      await wait(300);
    };

    if (sub === "trade") {
      // the plainest inmate, on open yard ground, the player a step in front
      const all = (CBZ.npcs || []).concat(CBZ.guards || []);
      if (!S.inmate || S.inmate.dead) {
        let best = null, bd = 1e9;
        for (const n of CBZ.npcs || []) {
          if (n.dead || n.escaped || !n.group || n.kind !== "inmate" || n._crowd || !n.data) continue;
          if (n.role === "dealer" || n.role === "merchant") continue;
          const d = Math.hypot(n.group.position.x - P.pos.x, n.group.position.z - P.pos.z);
          if (d < bd) { bd = d; best = n; }
        }
        S.inmate = best;
      }
      const a = S.inmate;
      if (!a) return { ok: false, err: "no inmate" };
      const spot = { x: 4, z: 24 };
      a.group.position.set(spot.x, 0, spot.z); a.group.rotation.y = 0; P.pos.y = 0;
      for (const o of all) {
        if (o === a || !o.group || o.dead) continue;
        const op = o.group.position;
        if (Math.hypot(op.x - spot.x, op.z - spot.z) < 25) op.set(spot.x + 26 + Math.random() * 4, op.y, spot.z + 26);
      }
      // his pockets ARE his loadout (prisontrade reads a.loadout first)
      a.loadout = { items: HIS.slice(), cigs: 14 };
      if (CBZ.econ) {
        const inv = (CBZ.game && CBZ.game.inventory) || {};
        for (const k in inv) delete inv[k];
        MINE.forEach((n) => CBZ.econ.addItem(n, n === "Bandage" ? 2 : 1));
        CBZ.econ.addCigs(20);
      }
      for (let i = 0; i < 40; i++) {
        a.group.position.set(spot.x, 0, spot.z);
        P.pos.set(spot.x, 0, spot.z + 1.6); P.vy = 0;
        if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
        if (CBZ.cam) { CBZ.cam.yaw = 0; CBZ.cam.pitch = 0.05; }
        step(1);
      }
      document.querySelectorAll("#speech .say").forEach((el) => el.remove());
      await settle(MINE.concat(HIS, ["Cigarettes"]));
      const r = CBZ.prisonTrade ? CBZ.prisonTrade.open(a) : null;
      if (!r || !r.ok) return { ok: false, err: "trade would not open", r };
      try { CBZ.prisonTrade.put("mine", "Lighter", 1); CBZ.prisonTrade.put("theirs", "Burner Phone", 1); } catch (_) {}
      await settle(MINE.concat(HIS, ["Cigarettes"]));
      try { CBZ.prisonTrade.put("mine", "Lighter", 1); } catch (_) {}
      // HARNESS TRAP: no stepSim after the table opens — a sim tick ran the
      // table's own walk-off check and folded it before the shot.
      const open = CBZ.prisonTrade.isOpen();
      document.querySelectorAll("#speech .say").forEach((el) => el.remove());
      const tiles = Array.from(document.querySelectorAll("#prisonTrade .ptr-tile"));
      const names = tiles.map((t) => t.getAttribute("data-item"));
      // a cube = the generic parcel model, or the smokes' old CSS bar
      const cubes = tiles.filter((t) => t.querySelector(".ptr-cig") ||
        (t.getAttribute("data-item") !== "cigs" && kindOf(t.getAttribute("data-item")) === "parcel" && t.getAttribute("data-item") !== "Guard Torch")).length;
      return {
        ok: open, err: open ? undefined : "trade folded before the shot", names,
        kinds: names.map((n) => n + ":" + kindOf(n === "cigs" ? "Cigarettes" : n)),
        metrics: { tiles: tiles.length, photographed: tiles.filter((t) => t.querySelector("img")).length, cubes },
      };
    }

    // ---- the contact sheet ----------------------------------------------
    const names = ["Cigarettes"].concat(Object.keys(IT));
    await settle(names);
    const d = document.createElement("div");
    d.id = "__iconSheet";
    d.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:#14171c;color:#cfd5dc;font:11px/1.2 system-ui,sans-serif;" +
      "display:grid;grid-template-columns:repeat(auto-fill,minmax(" + (innerWidth < 900 ? 78 : 96) + "px,1fr));gap:6px;padding:10px;align-content:start;overflow:hidden;";
    const cell = (label, inner, kind) => "<div style='background:rgba(255,255,255,.05);border-radius:8px;padding:4px;text-align:center'>" +
      "<div style='aspect-ratio:1;display:flex;align-items:center;justify-content:center'>" + (inner || "<span style='opacity:.4'>none</span>") + "</div>" +
      "<div style='white-space:nowrap;overflow:hidden;text-overflow:ellipsis'>" + label + "</div>" +
      "<div style='opacity:.5;font-size:9px'>" + (kind || "") + "</div></div>";
    const img = (src) => src ? "<img src='" + src + "' style='width:100%;height:100%;object-fit:contain'>" : "";
    let h = "", photographed = 0, cubes = 0;
    for (const n of names) {
      const k = kindOf(n);
      const x = html(n);
      if (/<img/.test(x) && !/ px /.test(x)) photographed++;
      if (k === "parcel" && n !== "Guard Torch") cubes++;   // the torch is photographed by its own model path
      h += cell(n, x.replace("<img", "<img style='width:100%;height:100%'"), k);
    }
    // the belt the hotbar draws: the guns, the torch (the two the owner likes)
    try { h += cell("Pistol (belt)", img(CBZ.itemIconGun("sidearm")), "gun"); } catch (_) {}
    try { h += cell("Taser (belt)", img(CBZ.itemIconGun("taser")), "gun"); } catch (_) {}
    try { h += cell("Flashlight (belt)", img(CBZ.flashlightThumbnail()), "torch"); } catch (_) {}
    d.innerHTML = h;
    document.body.appendChild(d);
    return { ok: true, metrics: { tiles: names.length + 3, photographed, cubes } };
  },
};
