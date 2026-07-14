#!/usr/bin/env node
// Real-Chrome regression for the minimal city HUD, diegetic phone routing,
// unified boxed inventory, physical death loot, and bank-safe cash loop.
// Requires a local server, by default:
//   python3 -m http.server 8765 --bind 127.0.0.1

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";

const server = process.env.CBZ_PROFILE_URL || "http://127.0.0.1:8765/";
const port = 10100 + Math.floor(Math.random() * 500);
const profileDir = `/tmp/cbz-hud-economy-${port}`;
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await rm(profileDir, { recursive: true, force: true });
const chrome = spawn(chromePath, [
  "--headless=new", "--enable-unsafe-swiftshader", "--disable-background-networking",
  "--disable-component-update", "--disable-default-apps", "--disable-extensions",
  "--no-default-browser-check", "--no-first-run", `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`, "about:blank",
], { stdio: "ignore" });

let ws, nextId = 1;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    const timeout = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 60000);
    // A resolved CDP request must not keep this one-shot harness alive for the
    // whole timeout window after Browser.close.
    if (timeout.unref) timeout.unref();
  });
}
async function evaluate(expression) {
  const out = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (out && out.exceptionDetails) {
    const d = out.exceptionDetails;
    throw new Error((d.exception && d.exception.description) || d.text || "browser evaluation failed");
  }
  return out && out.result && out.result.value;
}
async function page() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await res.json();
      const found = pages.find((p) => p.type === "page");
      if (found) return found;
    } catch (_) {}
    await sleep(200);
  }
  throw new Error("Chrome page did not become available");
}

try {
  const target = await page();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280, height: 720, deviceScaleFactor: 1, mobile: false,
  });
  // Keep the real browser/modules/DOM/Three.js while avoiding a giant autonomous
  // city frame. The test invokes only the owning HUD/inventory updaters itself.
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.requestAnimationFrame=function(){return 0};window.cancelAnimationFrame=function(){};",
  });
  await send("Page.navigate", { url: server });

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && !(await evaluate("!!(window.CBZ&&CBZ.resetGame&&CBZ.cityInventory&&CBZ.cityBankDeposit&&CBZ.cityPhoneNotify&&CBZ.cityCharPanel&&CBZ.cityLogDeath)"))) await sleep(250);

  const report = JSON.parse(await evaluate(`JSON.stringify((function () {
    const failures = [];
    function check(ok, msg) { if (!ok) failures.push(msg); }
    function run(list, order, dt) {
      (list || []).filter(function (x) { return Math.abs(x.order - order) < 0.00001; })
        .forEach(function (x) { x.fn(dt == null ? 1 / 60 : dt); });
    }
    function texts(list) { return list.map(function (x) { return x && (x.text || x.body) || ""; }); }
    function visible(el) {
      if (!el || !el.isConnected) return false;
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity || "1") === 0) return false;
      }
      return true;
    }
    function ownText(el) {
      return Array.from(el.childNodes || []).filter(function (n) { return n.nodeType === 3; })
        .map(function (n) { return n.nodeValue || ""; }).join(" ").replace(/\\s+/g, " ").trim();
    }

    CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    CBZ.setMode("city"); CBZ.resetGame(); CBZ.setState("playing");
    run(CBZ.always, 46);          // city HUD
    run(CBZ.updaters, 37.2);      // portrait/inventory host
    run(CBZ.updaters, 37.4);      // physical-drop/inventory maintenance

    // The compact character card is the deliberate prose exception to the
    // world-HUD rule: it owns level, stars, bounty, worth and its two controls.
    // Its canvas and metadata must form one complete card inside the viewport.
    const portraitPanel = document.getElementById("cpPanel");
    const portraitCard = portraitPanel && portraitPanel.querySelector(".cpCard");
    const portraitMeta = portraitPanel && portraitPanel.querySelector(".cpMeta");
    const portraitRect = portraitCard && portraitCard.getBoundingClientRect();
    const portraitText = portraitMeta ? portraitMeta.textContent.replace(/\\s+/g, " ").trim() : "";
    check(portraitPanel && portraitCard && portraitMeta && visible(portraitPanel) && getComputedStyle(portraitMeta).display !== "none",
      "compact character metadata is not visible");
    check(/Lv\\.\\s*\\d+/.test(portraitText) && /Bounty/i.test(portraitText) && /Net worth/i.test(portraitText) &&
      /Inventory/i.test(portraitText) && /Hide/i.test(portraitText), "character card is missing compact status/control copy: " + portraitText);
    check(portraitMeta && portraitMeta.querySelectorAll(".cpStars span").length === 5, "character card does not render five star sockets");
    check(portraitRect && portraitRect.left >= 0 && portraitRect.top >= 0 &&
      portraitRect.right <= innerWidth && portraitRect.bottom <= innerHeight, "character card escapes the initial viewport");

    // Routine mechanics vanish instead of becoming either a toast or phone spam.
    CBZ.cityPhoneNews.length = 0;
    CBZ.city.note("Picked up Pistol", 1);
    CBZ.flashToast("Equipped Shotgun");
    check(CBZ.cityPhoneNews.length === 0, "routine pickup/equip text reached phone");
    check(!document.getElementById("toast").textContent, "routine toast remained on HUD");

    // No phone app, including missions, accepts key/control or game-meta prose.
    const badMission = CBZ.phoneNotify({ app: "missions", from: "Dispatch", text: "Press E to continue the tutorial" });
    const badNews = CBZ.cityPhoneNotify({ app: "news", from: "City Desk", text: "NPC respawning behind the HUD" });
    const badView = CBZ.cityPhoneNotify({ app: "news", from: "City Desk", text: "Third-person crosshair enabled" });
    check(badMission == null && badNews == null && badView == null, "fourth-wall phone copy was accepted");

    // Walk-in banking moves the actual ledgers and produces a sender-backed,
    // diegetic account record without mentioning a game/death mechanic.
    CBZ.game.cash = 1200; CBZ.game.cityBank = 300;
    CBZ.cityBankDeposit();
    check(CBZ.game.cash === 0 && CBZ.game.cityBank === 1500, "deposit did not move cash into bank");
    let last = CBZ.cityPhoneNews[CBZ.cityPhoneNews.length - 1];
    check(last && last.from === "Meridian Trust" && /insured account/i.test(last.text), "deposit lacked diegetic bank record");
    CBZ.cityBankWithdraw(500);
    check(CBZ.game.cash === 500 && CBZ.game.cityBank === 1000, "withdraw did not move bank money to cash");
    last = CBZ.cityPhoneNews[CBZ.cityPhoneNews.length - 1];
    check(last && last.from === "Meridian Trust" && /withdrew/i.test(last.text), "withdraw lacked diegetic bank record");

    // Deaths remain recorded (and pulse the population counter) without either
    // red/white feed implementation painting prose over the world.
    const deathBefore = CBZ.cityPhoneNews.length;
    CBZ.cityLogDeath("Test Citizen", "gunfire", {});
    check(CBZ.cityPhoneNews.length === deathBefore + 1, "death alert did not reach phone news");
    run(CBZ.updaters, 34.6);
    run(CBZ.always, 46);
    const turfFeed = document.getElementById("cKillFeed");
    const localFeed = document.getElementById("cKill");
    const flavorFeed = document.getElementById("cFeed");
    check(!turfFeed || getComputedStyle(turfFeed).display === "none", "turf kill prose is visible");
    check(!localFeed || getComputedStyle(localFeed).display === "none", "local kill prose is visible");
    check(!flavorFeed || getComputedStyle(flavorFeed).display === "none", "flavor prose is visible");

    // Full contract copy stays on the phone. The moving HUD keeps only a target
    // glyph and distance, with no description or reward sentence.
    CBZ.game.cityJob = { desc: "Steal the armored truck", reward: 9999, dest: { x: CBZ.player.pos.x + 125, z: CBZ.player.pos.z } };
    CBZ.cityHudDirty(); run(CBZ.always, 46);
    const jobText = (document.getElementById("cJob") || {}).textContent || "";
    check(/125m/.test(jobText) && !/Steal|9999/.test(jobText), "job prose/reward still clutters live HUD");

    // Guns and ordinary items occupy the same 27 boxed slots and no duplicate
    // loose-loot or second inventory hotbar is shown.
    CBZ.cityEcon.add("Laptop", 1); CBZ.cityEcon.add("Burger", 2);
    CBZ.cityGiveWeapon("Pistol"); CBZ.cityGiveWeapon("Shotgun");
    CBZ.cityInventory.resync();
    const slots = CBZ.cityInventory.slots();
    check(slots.some(function (s) { return s && s.kind === "weapon" && s.id === "sidearm"; }), "sidearm absent from boxed inventory");
    check(slots.some(function (s) { return s && s.kind === "weapon" && s.id === "shotgun"; }), "shotgun absent from boxed inventory");
    check(slots.some(function (s) { return s && s.kind === "item" && s.name === "Laptop"; }), "ordinary item absent from boxed inventory");
    CBZ.cityCharPanel.open();
    const gridCells = Array.from(document.querySelectorAll("#cpInv .cpGrid .ci2Slot"));
    const titles = gridCells.map(function (x) { return x.getAttribute("title") || ""; }).join("|");
    check(gridCells.length === 27 && /Pistol/.test(titles) && /Laptop/.test(titles), "rendered inventory is not one unified 27-slot grid");
    const hotSection = document.querySelector("#cpInv .cpHotSection");
    check(!hotSection || getComputedStyle(hotSection).display === "none", "duplicate inventory hotbar is visible");
    const looseLoot = document.getElementById("cLoot");
    check(!looseLoot || getComputedStyle(looseLoot).display === "none", "items still render in a separate loose HUD row");
    CBZ.cityCharPanel.close();

    // Both ammo renderers and the unified city bar are instrumentation-only.
    // The legacy engine strip used to resurrect FIST / 9MM / 556 / RPG words
    // even after the city stylesheet hid it, so check the owning DOM too.
    CBZ.cityHudDirty(); run(CBZ.always, 46); run(CBZ.updaters, 53);
    if (CBZ.fpsResyncAmmo) CBZ.fpsResyncAmmo();
    const citySlotsText = ((document.getElementById("cSlots") || {}).textContent || "").replace(/\\s+/g, " ").trim();
    const cityAmmoText = ((document.getElementById("cAmmo") || {}).textContent || "").replace(/\\s+/g, " ").trim();
    const engineAmmoText = ((document.getElementById("ammo") || {}).textContent || "").replace(/\\s+/g, " ").trim();
    const engineStrip = document.getElementById("weaponStrip");
    check(!/[A-Za-z]|\\b(?:FIST|9MM|556|RPG|DRY)\\b/i.test(citySlotsText), "city hotbar contains weapon/item words: " + citySlotsText);
    check(!/[A-Za-z]/.test(cityAmmoText), "city ammo contains prose: " + cityAmmoText);
    check(!/\\b(?:RELOADING|RES|FIST|9MM|556|RPG|PISTOL|SHOTGUN|RIFLE)\\b/i.test(engineAmmoText), "engine ammo contains prose: " + engineAmmoText);
    check(!engineStrip || (!engineStrip.textContent.trim() && getComputedStyle(engineStrip).display === "none"), "legacy weapon word strip remains mounted");
    const mcVitalsWas = CBZ.CONFIG.CITY_HUD_MC;
    CBZ.CONFIG.CITY_HUD_MC = false; run(CBZ.always, 46);
    const classicVitalText = Array.from(document.querySelectorAll("#cVitals .vLab")).filter(visible)
      .map(function (el) { return el.textContent || ""; }).join("");
    check(!/[A-Za-z]/.test(classicVitalText), "classic vital bars contain word labels: " + classicVitalText);
    CBZ.CONFIG.CITY_HUD_MC = mcVitalsWas; run(CBZ.always, 46);

    // Every independent walk-up module may still write display:block inline,
    // but city policy wins without removing any input handlers or actions.
    const passiveIds = [
      "hint", "toast", "interact", "cityStoragePrompt", "roofStashChip", "beachLootChip",
      "clothingPrompt", "gunstorePrompt", "elevChip", "adChip", "realtyPrompt", "pawnPrompt",
      "jewelryPrompt", "ci2Chip", "fxPrompt", "modshopHud", "cityOrders", "cityHeistHud",
      "invHotbar", "cFeed", "cKill", "cKillFeed", "cRel", "cMemb", "cTurfMeta",
      "streakHud", "streakMeter"
    ];
    const injected = [];
    for (const id of passiveIds) {
      let el = document.getElementById(id);
      if (!el) { el = document.createElement("div"); el.id = id; document.body.appendChild(el); injected.push(el); }
      el.textContent = "[E] OPEN THIS CONTROL";
      el.style.display = "block";
      check(getComputedStyle(el).display === "none", "passive prose overlay escaped policy: #" + id);
    }
    const buildHints = [
      document.querySelector('body > .panel[style*="bottom: 78px"]'),
      document.querySelector('body > div[style*="bottom: 132px"][style*="z-index: 15"]')
    ].filter(Boolean);
    buildHints.forEach(function (el) {
      el.textContent = "[R] ROTATE [F] PLACE"; el.style.display = "block";
      check(getComputedStyle(el).display === "none", "legacy build-mode control strip is visible");
    });
    injected.forEach(function (el) { el.remove(); });

    // A live waypoint retains only its arrow/range. Destination prose and the
    // map-key legend stay in the map surface.
    CBZ.fullMap.setWaypoint(CBZ.player.pos.x + 20, CBZ.player.pos.z + 4, "Test destination");
    const guide = document.getElementById("waypointGuide");
    const waypointLabel = document.getElementById("waypointLabel");
    const waypointKey = guide && guide.querySelector(".waypoint-mapkey");
    check(guide && visible(guide), "numeric waypoint guide did not remain visible");
    check(!waypointLabel || getComputedStyle(waypointLabel).display === "none", "waypoint destination prose is visible");
    check(!waypointKey || getComputedStyle(waypointKey).display === "none", "waypoint map-key legend is visible");
    CBZ.fullMap.clearWaypoint("city");

    // Enumerate what a player can actually read during ordinary city play. The
    // report is deliberately returned so failures identify the exact owner.
    const liveText = Array.from(document.querySelectorAll("body *")).filter(visible).map(function (el) {
      return {
        id: el.id || "", cls: typeof el.className === "string" ? el.className : "",
        text: ownText(el), portrait: !!(el.closest && el.closest("#cpPanel .cpMeta"))
      };
    }).filter(function (x) { return x.text; });
    const forbiddenLive = /\\[[-A-Za-z0-9/ ]{1,12}\\]|\\b(?:press|click|hold|tap|open|close|buy|sell|use|enter|exit|board|hijack|stash|loot|wardrobe|shop|elevator|deposit|withdraw|reloading|reserve|res|fist|pistol|shotgun|rifle|rpg|npc|hud|ui|reticle|crosshair|respawn|tutorial|districts?|leading|alive|bounty|inventory|hide)\\b/i;
    const forbiddenSeen = liveText.filter(function (x) { return !x.portrait && forbiddenLive.test(x.text); });
    check(forbiddenSeen.length === 0, "visible live HUD contains control/prose text: " + forbiddenSeen.map(function (x) { return (x.id ? "#" + x.id : "." + x.cls) + "=" + x.text; }).join(" | "));
    const titleLeaks = Array.from(document.querySelectorAll("body [title]")).filter(visible).filter(function (el) {
      return forbiddenLive.test(el.getAttribute("title") || "");
    });
    check(titleLeaks.length === 0, "visible HUD still exposes prose through native tooltips");

    // The neck slab stays hidden for collarless catalog/composite fits and is
    // retained only where clothing geometry actually calls for it.
    const collar = CBZ.cityCharPanel.portraitHasStructuredCollar;
    check(collar({ id: "wifebeater", name: "Ribbed Tank", colors: {} }) === false, "tank portrait kept the neck slab");
    check(collar({ id: "civvies", composite: { items: [] } }) === false, "plain tee portrait kept the neck slab");
    check(collar({ id: "business", composite: { items: ["shirt_white_collar", "blazer_navy"] } }) === true, "real structured collar was removed");
    const portraitRig = CBZ.cityCharPanel.portraitRig();
    const collarMeshes = portraitRig && portraitRig.skinSlots && portraitRig.skinSlots.collar || [];
    let slabWidth = 0;
    if (collarMeshes[0] && collarMeshes[0].geometry) {
      const geo = collarMeshes[0].geometry; if (!geo.boundingBox) geo.computeBoundingBox();
      if (geo.boundingBox) slabWidth = geo.boundingBox.max.x - geo.boundingBox.min.x;
    }
    check(collarMeshes.length > 0 && slabWidth > 0.8 && collarMeshes.every(function (m) { return m.visible === false; }),
      "actual full-width portrait collar geometry remains visible for plain clothing");

    // Physical drops are the canonical authored weapon model / multi-part case,
    // with no beam/light/green marker. NPC weapon drops use the same builder.
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z, py = CBZ.player.pos.y;
    CBZ.cityDropItem(px + 4, pz, { weaponId: "sidearm", y: py, ttl: 300 });
    CBZ.cityDropItem(px + 6, pz, { cash: 700, y: py, ttl: 300 });
    const gunDrop = CBZ.cityItemDrops[CBZ.cityItemDrops.length - 2];
    const cashDrop = CBZ.cityItemDrops[CBZ.cityItemDrops.length - 1];
    let gunLights = 0, gunMeshes = 0;
    gunDrop.mesh.traverse(function (o) { if (o.isLight) gunLights++; if (o.isMesh) gunMeshes++; });
    let caseMeshes = 0; cashDrop.mesh.traverse(function (o) { if (o.isMesh) caseMeshes++; });
    check(gunDrop.mesh.userData._invPhysicalDrop && gunDrop.mesh.userData.weaponId === "sidearm" && gunMeshes > 1, "ground gun is not the canonical authored model");
    check(gunLights === 0 && caseMeshes >= 6, "death loot still uses a marker instead of physical props");
    CBZ.cityDropWeapon(px + 8, pz, "Pistol", 24);
    const npcDrop = CBZ.cityDrops[CBZ.cityDrops.length - 1];
    check(npcDrop.mesh && npcDrop.mesh.userData._invPhysicalDrop && npcDrop.mesh.userData.weaponId === "sidearm", "NPC death gun is not the canonical authored model");

    // Carried cash and weapons hit the ground on death; the bank ledger is not
    // touched. This is checked immediately at the authoritative death entry.
    CBZ.game.cash = 1234; CBZ.game.cityBank = 4321;
    CBZ.player.dead = false; CBZ.player.hp = 100;
    const dropsBefore = CBZ.cityItemDrops.length;
    CBZ.cityKillPlayer("gunfire", { fromX: px - 1, fromZ: pz, dmg: 120 });
    const deathDrops = CBZ.cityItemDrops.slice(dropsBefore);
    check(CBZ.game.cash === 0, "carried cash survived death");
    check(CBZ.game.cityBank === 4321, "banked cash was lost on death");
    check(deathDrops.some(function (d) { return d.cash === 1234; }), "carried cash did not become a briefcase drop");
    check(deathDrops.some(function (d) { return d.weaponId === "sidearm"; }), "carried gun did not become a physical death drop");
    check(CBZ.weaponInventory.length === 0, "death duplicated weapons in inventory and world");

    // Pausing hides world HUD/portrait bleed; the obsolete pause blurb is gone.
    CBZ.setState("paused"); run(CBZ.always, 46);
    const cityHud = document.getElementById("cityHud"), cp = document.getElementById("cpPanel");
    check(!cityHud || getComputedStyle(cityHud).display === "none", "city HUD bleeds through pause");
    check(!cp || getComputedStyle(cp).display === "none", "portrait bleeds through pause");
    check(!document.querySelector("#pause .blurb"), "obsolete pause prose remains");

    const allPhoneText = texts(CBZ.cityPhoneNews).join("\\n");
    check(!/\[[A-Za-z0-9/\\- ]{1,8}\]|\\b(?:NPC|HUD|UI|reticle|crosshair|respawn|tutorial|press|click|tap|first-person|third-person)\\b/i.test(allPhoneText), "phone history contains fourth-wall/control language");

    // Leave the panel measurable for the outer CDP viewport matrix after the
    // pause-isolation assertion has completed.
    CBZ.setState("playing");
    CBZ.cityCharPanel.hideHud(false);
    run(CBZ.updaters, 37.2);

    return {
      failures: failures,
      phoneItems: CBZ.cityPhoneNews.length,
      phoneSenders: CBZ.cityPhoneNews.map(function (x) { return x.from; }),
      jobText: jobText,
      liveHudText: liveText,
      portrait: portraitRect ? {
        text: portraitText,
        bounds: { left: portraitRect.left, top: portraitRect.top, right: portraitRect.right, bottom: portraitRect.bottom,
          width: portraitRect.width, height: portraitRect.height }
      } : null,
      passivePromptCount: passiveIds.length + buildHints.length,
      ammoText: { city: cityAmmoText, engine: engineAmmoText, slots: citySlotsText },
      inventory: { slots: slots.filter(Boolean).map(function (s) { return s.name; }), renderedCells: gridCells.length, hiddenCollarWidth: slabWidth },
      drops: { gunMeshes: gunMeshes, briefcaseMeshes: caseMeshes, deathDrops: deathDrops.map(function (d) { return d.weaponId || (d.cash ? "$" + d.cash : d.name); }) },
      balancesAfterDeath: { cash: CBZ.game.cash, bank: CBZ.game.cityBank },
    };
  })())`));

  const portraitViewports = [];
  for (const vp of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 800, height: 600 },
  ]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false,
    });
    const state = JSON.parse(await evaluate(`JSON.stringify((function () {
      const panel = document.getElementById("cpPanel");
      const card = panel && panel.querySelector(".cpCard");
      const meta = panel && panel.querySelector(".cpMeta");
      const canvas = panel && panel.querySelector("canvas");
      if (!panel || !card || !meta || !canvas) return null;
      const r = card.getBoundingClientRect(), cr = canvas.getBoundingClientRect(), mr = meta.getBoundingClientRect();
      return {
        visible: getComputedStyle(panel).display !== "none" && getComputedStyle(meta).display !== "none",
        text: meta.textContent.replace(/\\s+/g, " ").trim(),
        stars: meta.querySelectorAll(".cpStars span").length,
        bounds: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
        canvasBottom: cr.bottom,
        metaTop: mr.top
      };
    })())`));
    const ok = !!(state && state.visible && state.stars === 5 &&
      state.bounds.left >= 0 && state.bounds.top >= 0 &&
      state.bounds.right <= vp.width && state.bounds.bottom <= vp.height &&
      state.bounds.height > 190 && state.metaTop >= state.canvasBottom - 0.5);
    portraitViewports.push({ ...vp, ok, ...state });
    if (!ok) report.failures.push("character card clipped or incomplete at " + vp.width + "x" + vp.height);
  }
  report.portraitViewports = portraitViewports;

  console.log(JSON.stringify(report, null, 2));
  if (report.failures.length) process.exitCode = 1;
} finally {
  try { if (ws && ws.readyState === WebSocket.OPEN) await send("Browser.close"); } catch (_) {}
  if (!chrome.killed) chrome.kill("SIGTERM");
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
