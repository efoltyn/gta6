/* ============================================================
   city/aim_dossier.js — in-world observation at the crosshair.

   Point a drawn gun at any live person or animal and this card describes the
   ACTUAL actor hit by the weapon ray.  It deliberately reuses fpsmode's
   aimedActor() (range, body/head volumes and wall occlusion), so the UI can
   never identify somebody through a building or a different body than the
   shot would hit.  No duplicate target proxy, no nearest-NPC guess.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.onAlways) return;
  const THREE = window.THREE;

  // OWNER DIRECTION: the HUD is not an information dump. Aiming at someone should
  // read their LEVEL + TITLE hovering over their head — that's it (a low-level
  // homeless man, a high-level CEO, a mid boxer). The full street read still
  // EXISTS as data (CBZ.cityActorDossier) for a leaderboard / click-to-open
  // profile, but it no longer paints a wall of stats across the screen. Flip
  // CITY_AIM_OVERHEAD=false to restore the old right-side dossier card.
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.CITY_AIM_OVERHEAD == null) CBZ.CONFIG.CITY_AIM_OVERHEAD = true;
  const OVERHEAD = () => CBZ.CONFIG.CITY_AIM_OVERHEAD !== false;

  let card = null, lastActor = null, lastHTML = "", sweep = 0;
  let tag = null;                          // the floating overhead level pill
  const _pv = THREE ? new THREE.Vector3() : null;
  function esc(v) {
    return String(v == null ? "—" : v).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function money(v) {
    v = +v || 0;
    if (Math.abs(v) >= 1000000) return "$" + (v / 1000000).toFixed(v >= 10000000 ? 0 : 1) + "m";
    if (Math.abs(v) >= 1000) return "$" + (v / 1000).toFixed(v >= 100000 ? 0 : 1) + "k";
    return "$" + Math.round(v).toLocaleString();
  }
  function row(k, v, cls) {
    if (v == null || v === "" || v === false) return "";
    return '<div class="aimDRow' + (cls ? " " + cls : "") + '"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>';
  }
  function section(title, html) {
    return html ? '<div class="aimDSec"><h4>' + esc(title) + "</h4>" + html + "</div>" : "";
  }
  function ensureDom() {
    if (card) return card;
    const style = document.createElement("style");
    style.textContent =
      "#cityAimDossier{position:fixed;right:18px;top:50%;transform:translateY(-45%);width:min(310px,34vw);max-height:72vh;overflow:hidden;z-index:85;pointer-events:none;color:#f4f7fa;background:linear-gradient(145deg,rgba(12,17,23,.96),rgba(24,31,39,.91));border:1px solid rgba(183,207,225,.42);border-left:4px solid #e7bd55;border-radius:8px;box-shadow:0 12px 34px rgba(0,0,0,.48);font-family:Inter,Arial,sans-serif;display:none;backdrop-filter:blur(5px)}" +
      "#cityAimDossier .aimDHead{padding:10px 12px 8px;border-bottom:1px solid rgba(255,255,255,.13)}#cityAimDossier h3{font-size:16px;line-height:1.1;margin:0 0 3px;letter-spacing:.02em}#cityAimDossier .aimDSub{font-size:10px;color:#aebbc7;letter-spacing:.11em;text-transform:uppercase}" +
      "#cityAimDossier .aimDBody{padding:4px 11px 10px;max-height:calc(72vh - 53px);overflow:hidden}#cityAimDossier .aimDSec{padding-top:7px}#cityAimDossier h4{margin:0 0 3px;font-size:9px;letter-spacing:.15em;color:#e7bd55;text-transform:uppercase}" +
      "#cityAimDossier .aimDRow{display:flex;gap:9px;justify-content:space-between;align-items:baseline;padding:1.5px 0;font-size:10.5px;line-height:1.25;border-bottom:1px solid rgba(255,255,255,.035)}#cityAimDossier .aimDRow span{color:#93a0ac;white-space:nowrap}#cityAimDossier .aimDRow b{font-weight:600;text-align:right;overflow-wrap:anywhere}#cityAimDossier .hot b{color:#ff8a83}#cityAimDossier .good b{color:#92e5a2}" +
      "@media(max-width:720px){#cityAimDossier{right:8px;top:26%;width:min(260px,58vw);max-height:48vh}#cityAimDossier .aimDBody{max-height:calc(48vh - 53px)}}";
    document.head.appendChild(style);
    card = document.createElement("aside");
    card.id = "cityAimDossier";
    card.setAttribute("aria-live", "polite");
    document.body.appendChild(card);
    return card;
  }
  function stateOf(a) {
    if (a.dead) return "dead";
    if (a.cuffed) return "cuffed";
    if ((a.ko || 0) > 0) return "down / unconscious";
    if (a.surrender || a.handsUp) return "surrendering";
    if (a.rage || a.curTarget === (CBZ.city && CBZ.city.playerActor)) return "hostile / coming for you";
    const s = String(a.state || "calm").replace(/[_-]+/g, " ");
    return ({ idle: "calm", wander: "roaming", graze: "grazing", fight: "fighting", hunt: "hunting", patrol: "on patrol" })[s] || s;
  }
  function humanHTML(a, distance) {
    const level = CBZ.cityLevel ? CBZ.cityLevel(a) : 1;
    const title = CBZ.cityTitle ? CBZ.cityTitle(a) : (a.kind || "Person");
    const standing = CBZ.cityInteractionStanding ? CBZ.cityInteractionStanding(a) : null;
    const rel = a.relPlayer || null;
    const ident = a._identityId && CBZ.cityIdentities && CBZ.cityIdentities.get ? CBZ.cityIdentities.get(a._identityId) : null;
    const maxHp = a.maxHp || (a.kind === "cop" ? (a.swat ? 120 : 90) : null);
    const role = a.job || a.vipTitle || a.archetype || (a.vendor && a.vendor.kind) || title;
    const gang = a.gang && (a.gang.name || a.gang.id || a.gang);
    const affiliation = a.kind === "cop" ? (a.swat ? "Police · SWAT" : "Police") :
      (/soldier|military|marine/i.test(a.job || "") ? "Military" : (gang ? String(gang) + (a.rank ? " · " + a.rank : "") : "Independent"));
    let social = "";
    if (rel) social += row("Respect", Math.round(rel.respect || 0) + "/100") + row("Fear", Math.round(rel.fear || 0) + "/100") +
      row("Loyalty", Math.round(rel.loyalty || 0) + "/100") + row("Affection", Math.round(rel.affection || 0) + "/100") + row("Grudge", Math.round(rel.grudge || 0) + "/100", (rel.grudge || 0) > 50 ? "hot" : "");
    social += row("Connections", (a.partner ? "partner" : "") + (a.friends && a.friends.length ? (a.partner ? " · " : "") + a.friends.length + " friends" : ""));
    let identity = "";
    if (ident) {
      const knownKind = String(ident.kind || "known figure").replace(/[_-]+/g, " ");
      const pastN = (ident.history || []).length;
      identity += row("Known as", knownKind) + row("Word around town", ident.status === "dead" ? "reported dead" : "still around") + row("Past encounters", pastN ? pastN : "none yet");
      const last = ident.history && ident.history[ident.history.length - 1];
      if (last) identity += row("Last encounter", String(last.type || last.t || "crossed paths").replace(/[_-]+/g, " "));
      if (ident.successorId) identity += row("Legacy", "someone has taken their place");
    }
    const armor = a._armor && (a._armor.hp != null ? a._armor.hp : a._armor);
    return '<div class="aimDHead"><h3>' + esc(a.name || (a.swat ? "SWAT Officer" : "Unknown")) + '</h3><div class="aimDSub">' + esc(distance.toFixed(1)) + "m away</div></div>" +
      '<div class="aimDBody">' +
      section("Street read", row("Standing", "Lv." + level + " " + title) + (standing ? row("How they see you", standing.tier, standing.canInfluence ? "good" : "hot") + row("Your name carries", standing.playerLevel >= standing.targetLevel ? "enough weight" : "less weight here") : "")) +
      section("Condition", row("Health", Math.max(0, Math.round(a.hp == null ? 0 : a.hp)) + (maxHp ? "/" + maxHp : "")) + row("Status", stateOf(a), /hostile|dead/.test(stateOf(a)) ? "hot" : "") + row("Armor", armor != null ? Math.round(armor) : "")) +
      section("Who they are", row("Role", role) + row("Affiliation", affiliation) + row("Weapon", a.armed ? (a.weapon || "armed") : "unarmed") + identity) +
      section("Known means", row("Cash", a.cash != null ? money(a.cash) : "") + row("Lifestyle", a.wealth != null ? (a.wealth >= 0.9 ? "elite" : a.wealth >= 0.65 ? "wealthy" : a.wealth >= 0.35 ? "comfortable" : "modest") : "") + row("Bounty", a.bounty ? money(a.bounty) : "")) +
      section("Disposition", social) + "</div>";
  }
  function animalHTML(a, distance) {
    const sp = a.species || {};
    const herdN = a.herd && a.herd.members ? a.herd.members.filter(function (m) { return m && !m.dead; }).length : 0;
    const name = a.petName ? a.petName + " · " + (sp.name || sp.id || "Animal") : (sp.name || sp.id || "Animal");
    const danger = +sp.danger || 0;
    const aquatic = !!sp.aquatic;
    const alarm = +a.alarm || 0;
    const temper = a.dead ? "dead" : /charge|stalk|attack/.test(String(a.state || "")) ? "aggressive" : alarm > 2 ? "panicked" : alarm > 0.25 ? "alert" : "calm";
    const dangerRead = danger >= 0.75 ? "extremely dangerous" : danger >= 0.45 ? "dangerous" : danger >= 0.2 ? "can hurt you" : "normally harmless";
    return '<div class="aimDHead"><h3>' + esc((a.legendary ? "★ " : "") + name) + '</h3><div class="aimDSub">' + esc(distance.toFixed(1)) + "m away</div></div>" +
      '<div class="aimDBody">' +
      section("Animal", row("Species", sp.name || sp.id || "unknown") + row("Rarity", sp.rarity || (a.legendary ? "legendary" : "common"), a.legendary ? "good" : "") + row("Native range", sp.biome || "unknown") + row("Life stage", a.grow != null ? "young / growing" : "adult")) +
      section("Condition", row("Health", Math.max(0, Math.round(a.hp || 0)) + "/" + Math.round(a.maxHp || sp.hp || 0)) + row("Status", stateOf(a), /charge|stalk|attack|dead/.test(stateOf(a)) ? "hot" : "") + row("Temper", temper, /aggressive|panicked/.test(temper) ? "hot" : "")) +
      section("Behavior", row("Herd / pack", herdN ? herdN + " nearby" : "solitary") + row("Move speed", (a.spd || sp.spd || 0).toFixed ? (a.spd || sp.spd || 0).toFixed(1) + " m/s" : a.spd) + row("Threat", dangerRead, danger >= 0.5 ? "hot" : "") + row("Bite / impact", sp.bite || sp.ram || "") + row("Movement", aquatic ? "stays in water" : "land")) +
      section("Hunting value", row("Pelt", sp.fur || "none") + row("Pelt value", sp.furValue ? money(sp.furValue) : "") + row("Meat", sp.meat || sp.meatValue ? (sp.meat || money(sp.meatValue)) : "")) +
      section("Trust", row("Tamed", a.tamed ? "yes" : "no", a.tamed ? "good" : "") + row("Ride state", a.ridden ? "mounted" : (a.tamed ? "available if large enough" : "wild")) + row("Legendary", a.legendary ? "unique" : "")) + "</div>";
  }
  // The rich read stays available as DATA for a future profile panel / leaderboard
  // (owner: "great in leaderboards or stuff the user can click to") — it just isn't
  // sprayed onto the HUD any more. Returns the same card HTML the dossier used.
  CBZ.cityActorDossier = function (a, dist) {
    if (!a) return "";
    return a.animal ? animalHTML(a, +dist || 0) : humanHTML(a, +dist || 0);
  };

  // ---- the floating overhead LEVEL + TITLE pill --------------------------------
  function ensureTag() {
    if (tag) return tag;
    if (typeof document === "undefined" || !document.body) return null;
    const style = document.createElement("style");
    style.textContent =
      "#cityAimTag{position:fixed;left:0;top:0;z-index:86;pointer-events:none;transform:translate(-50%,-100%);" +
      "font:800 15px/1 Inter,system-ui,Arial,sans-serif;white-space:nowrap;padding:5px 11px;border-radius:999px;" +
      "background:rgba(10,14,19,.82);border:1px solid rgba(183,207,225,.34);box-shadow:0 4px 14px rgba(0,0,0,.45);" +
      "color:#f4f7fa;letter-spacing:.01em;display:none;-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}" +
      "#cityAimTag .lv{color:#e7bd55;font-weight:900;margin-right:5px}" +
      "#cityAimTag.hot{border-color:rgba(255,120,110,.6)}#cityAimTag.hot .lv{color:#ff9a83}" +
      "#cityAimTag.good{border-color:rgba(120,220,150,.55)}#cityAimTag.good .lv{color:#8fe0a2}";
    document.head.appendChild(style);
    tag = document.createElement("div");
    tag.id = "cityAimTag";
    tag.setAttribute("aria-live", "polite");
    document.body.appendChild(tag);
    return tag;
  }
  // human: Lv.N Title (CEO / Mobster / Boxer / Cashier / …). animal: species (+★).
  function tagLabel(a) {
    if (a.animal) {
      const sp = a.species || {};
      return (a.legendary ? "★ " : "") + (sp.name || sp.id || "Animal");
    }
    const lv = CBZ.cityLevel ? CBZ.cityLevel(a) : 1;
    const title = CBZ.cityTitle ? CBZ.cityTitle(a) : (a.swat ? "SWAT" : a.kind === "cop" ? "Police" : "Civilian");
    return '<span class="lv">Lv.' + lv + '</span>' + esc(title);
  }
  function tagTone(a) {
    if (a.rage || a.curTarget === (CBZ.city && CBZ.city.playerActor) || (a.relPlayer && a.relPlayer.grudge > 50)) return "hot";
    if (a.relPlayer && (a.relPlayer.loyalty > 55 || a.relPlayer.affection > 60)) return "good";
    if (a.animal && (+(a.species && a.species.danger) || 0) >= 0.5) return "hot";
    return "";
  }
  // project the actor's head to screen; null if behind camera or no data.
  function headScreen(a) {
    if (!_pv || !CBZ.camera) return null;
    const p = a.pos || (a.group && a.group.position);
    if (!p) return null;
    const hy = (CBZ.charHeadY && !a.animal) ? CBZ.charHeadY(a) : (p.y + (a.animal ? 1.3 : 1.95));
    _pv.set(p.x, hy + 0.34, p.z);
    _pv.project(CBZ.camera);
    if (_pv.z > 1) return null;                     // behind the camera
    return { x: (_pv.x * 0.5 + 0.5) * window.innerWidth, y: (-_pv.y * 0.5 + 0.5) * window.innerHeight };
  }

  function hide() {
    if (card) card.style.display = "none";
    if (tag) tag.style.display = "none";
    lastActor = null; lastHTML = ""; CBZ.cityAimDossierTarget = null;
  }
  CBZ.onAlways(61.2, function (dt) {
    if (!CBZ.game || CBZ.game.mode !== "city" || CBZ.game.state !== "playing" || !CBZ.isAimingWeapon || !CBZ.isAimingWeapon() || !CBZ.aimedActor) { hide(); return; }
    sweep -= dt || 0;
    if (sweep > 0 && lastActor && !lastActor.dead) {
      // keep the overhead pill glued to the (moving) head every frame, even
      // between the 0.08s target re-scans.
      if (OVERHEAD() && tag && lastActor && !lastActor.dead) {
        const s = headScreen(lastActor);
        if (s) { tag.style.left = s.x + "px"; tag.style.top = (s.y - 6) + "px"; }
        else tag.style.display = "none";
      }
      return;
    }
    sweep = 0.08;
    let hit = null;
    try { hit = CBZ.aimedActor(360); } catch (e) { hide(); return; }
    const a = hit && hit.actor;
    if (!a || a.isPlayer || (!a.animal && a.kind !== "cop" && !a.char && !a.relPlayer && !a.vendor)) { hide(); return; }
    CBZ.cityAimDossierTarget = a; lastActor = a;

    if (OVERHEAD()) {
      if (card) card.style.display = "none";        // old wall-of-stats stays down
      const el = ensureTag(); if (!el) return;
      const s = headScreen(a);
      if (!s) { el.style.display = "none"; return; }
      const label = tagLabel(a);
      if (label !== lastHTML) { el.innerHTML = label; lastHTML = label; }
      el.className = tagTone(a);
      el.style.left = s.x + "px"; el.style.top = (s.y - 6) + "px";
      el.style.display = "block";
      return;
    }

    // legacy full card (CITY_AIM_OVERHEAD=false)
    const html = a.animal ? animalHTML(a, hit.dist || 0) : humanHTML(a, hit.dist || 0);
    const el = ensureDom();
    if (a !== lastActor || html !== lastHTML) { el.innerHTML = html; lastHTML = html; }
    el.style.display = "block";
  });
})();
