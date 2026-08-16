/* The "nil outfit" wave, photographed: crowd-promotion sleeves + the VIP
   wardrobe routed through outfits.js, for tools/visual-compare.mjs.

   FLAG A/B (the tool's own "--before local" mode): both sides serve THIS
   checkout; the before side boots with cfg_CITY_CROWD_SLEEVES=0 and
   cfg_CITY_VIP_WARDROBE=0 — exactly the pre-wave code paths — so the change
   under test is the only variable. Run:

     node tools/visual-compare.mjs --preset vip-wardrobe --before local

   WHAT THE FOUR PLATES CLAIM (owner report, 2026-08-16 screenshot: an NPC
   reading as NAKED — "nil outfit ... too common"):
   1. promoted-crowd — bodies stepping out of the instanced crowd. Before:
      setLook copies the imposter's one-mesh skin arm onto the real rig, so
      every promoted body walks up with bare shoulder-to-wrist arms (with a
      tan crowd shirt the whole torso reads undressed — the screenshot). After:
      shirt upper arms + skin forearms, the spawn path's own short-sleeve
      grammar.
   2. vip-magnate — the magnate and his close-protection detail. Before:
      paintFit tints torso/collar/legs only and cannot touch a painted
      garment at all — suits with the old shirt's arms, a guard still in her
      sundress, and (no age gate) a CHILD draftable as the principal. After:
      the canonical wardrobe — tuxedo/varied suit on the principal, painted
      All Black Tactical on every guard, adults only.
   3. vip-court — don, senator and star principals side by side. Before: the
      don keeps whatever the drafted body wore (a cocktail dress, a kid's
      hoodie), the senator's arms stay her old shirt. After: set colors +
      bandana on the don, composed business suit on the senator, gown or
      colored suit on the star.
   4. released-founder — the same magnate party AFTER the shift ends. Before:
      restoreFit paints back colors it sampled off painted materials (white
      base) and skips painted meshes, so bodies release wrong or not at all —
      and the ex-principal keeps the founder's name/sid (the walking
      "Lv.11 Founder" nobody). After: restorePed re-derives each civilian's
      own look through the one redress path.

   Staging follows npc-gestures.mjs: boot once per side, freeze rAF, stepSim
   is the only clock, line the cast on marks at the player's own spawn,
   fixed world-axis tripod, per-tick hold. Crowd casting draws Math.random
   (skins/shirts are per-boot), so the two sides photograph different faces
   and shirt colors by construction — the ARMS GRAMMAR and the GARMENTS are
   the subject, and the metrics count exactly those. */

const subjects = [
  { id: "promoted-crowd", label: "Bodies promoted out of the instanced crowd", kind: "crowd", n: 6,
    focus: "Six real rigs that just stepped out of the ambient crowd. Before: every one wears its own skin from shoulder to wrist (the imposter's one-mesh arm, copied literally) — the owner's naked-NPC screenshot. After: the shirt owns the upper arm, the forearm stays skin — a short-sleeved person, not an undressed one." },
  { id: "vip-magnate", label: "The Magnate and his detail", kind: "magnate",
    focus: "The magnate principal with his close-protection suits. Before: flat tint on torso/legs only — black suits wearing the old shirt's arms, a guard still in the sundress she was drafted in, and nothing stops a child body holding the SMG. After: tuxedo or varied painted suit on the principal, All Black Tactical on every guard, adults only by gate." },
  { id: "vip-court", label: "Don · Senator · Star", kind: "court",
    focus: "The other three principals, side by side. Before: whatever each drafted body happened to be wearing, torso-tinted at best. After: the don walks his set's colors with the bandana, the senator wears the composed business suit her office reads as, the star a gown or colored suit — all through the same wardrobe every other role uses." },
  { id: "released-founder", label: "After the shift — the same bodies released", kind: "released",
    focus: "The magnate party after releaseParty restores everyone. Before: colors sampled off painted materials restore as white or not at all, and the ex-principal keeps the founder's name and sid — the walking “Founder” nobody. After: every body re-derives its own civilian look (a mechanic back in coveralls, a tourist back in her sundress) and the founder link is scrubbed." },
];

async function stageVipWardrobe(input) {
  const CBZ = window.CBZ;
  const T = window.THREE;
  if (!CBZ || !T) return { ok: false, missing: "CBZ/THREE" };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, budgetMs, stepMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      try { if (test()) return true; } catch (_) {}
      await wait(stepMs || 250);
    }
    return false;
  };
  const step = (secs) => {
    const n = Math.max(1, Math.round(secs * 20));
    for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 20);
      if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
    }
  };
  const hideHud = () => {
    const canvas = CBZ.renderer && CBZ.renderer.domElement;
    for (const child of Array.from(document.body.children)) {
      if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
      if (child.id === "__vipOverlay") continue;
      child.style.visibility = "hidden";
    }
  };

  let S = window.__vipWard;
  if (!S) {
    const booted = await until(
      () => CBZ.game && (CBZ.bootComplete || CBZ.game.state === "title") &&
        CBZ.stepSim && document.getElementById("playBtn"),
      300000
    );
    if (!booted) return { ok: false, err: "never booted" };
    if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false;
    const playing = await until(() => {
      if (CBZ.game.state === "playing") return true;
      const button = document.getElementById("playBtn");
      if (button) button.click();
      return CBZ.game.state === "playing";
    }, 120000, 300);
    if (!playing) return { ok: false, err: "never reached playing" };
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await wait(700);
    step(3);
    // noon, clear — the faults being photographed are colors, and dusk hides colors
    if (CBZ.dayPhase) CBZ.dayPhase(0.5);
    if (CBZ.setWeather) { try { CBZ.setWeather("clear"); } catch (_) {} }
    const overlay = document.createElement("div");
    overlay.id = "__vipOverlay";
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f8fb;text-shadow:0 2px 9px #000;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    overlay.innerHTML = "<div data-scrim></div><div data-side></div><div data-name></div>" +
      "<div data-focus></div><div data-read></div><div data-source></div>";
    document.body.appendChild(overlay);
    // STUDIO MARK: a CORE-district sidewalk point drawn with a SEEDED rng
    // (vips.js corePoint's own recipe) — deterministic per seed, so both
    // sides shoot the same downtown kerb. Two rejected marks taught this:
    // the player's own spawn can be INSIDE the campaign motel, and "the
    // first shopLot with a door" turned out to live at the airport — both
    // photographed a landscape instead of the row.
    let mx = CBZ.player.pos.x, mz = CBZ.player.pos.z;
    const A0 = CBZ.city && CBZ.city.arena;
    if (A0 && (A0.weightedSidewalkPoint || A0.randomSidewalkPoint)) {
      let seed0 = 424243;
      const mrng = () => { seed0 = (seed0 * 1103515245 + 12345) & 0x7fffffff; return seed0 / 0x7fffffff; };
      for (let t = 0; t < 24; t++) {
        const p0 = A0.weightedSidewalkPoint ? A0.weightedSidewalkPoint(mrng) : A0.randomSidewalkPoint();
        if (!p0) continue;
        const d0 = A0.districtAt ? A0.districtAt(p0.x, p0.z) : null;
        if (!d0 || d0.kind === "core" || d0.kind === "commercial") { mx = p0.x; mz = p0.z; break; }
      }
    }
    S = window.__vipWard = {
      gx: mx, gz: mz,
      gy: (CBZ.floorAt && CBZ.floorAt(mx, mz)) || CBZ.player.pos.y,
      overlay, pinned: [],
    };
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (_) {} },
    };
  }

  const sub = input.subject;
  const P = CBZ.player;
  if (!P || !P.pos) return { ok: false, err: "no player" };
  if (CBZ.game) CBZ.game.cityHolstered = true;

  // ---- shared helpers ------------------------------------------------------
  const flat = (list) => {
    if (!list || !list.length) return null;
    const m = list[0];
    if (!m || !m.material) return null;
    if (m.material.map) return "painted";
    return m.material.color ? m.material.color.getHex() : null;
  };
  const rgbd = (a, b) => {
    if (a == null || b == null || a === "painted" || b === "painted") return null;
    const dr = ((a >> 16) & 255) - ((b >> 16) & 255), dg = ((a >> 8) & 255) - ((b >> 8) & 255), db = (a & 255) - (b & 255);
    return Math.round(Math.sqrt(dr * dr + dg * dg + db * db));
  };
  const ensureSlots = () => {
    const V = CBZ.cityVips;
    if (!V) return false;
    for (let i = 0; i < 300 && (!V.slots || !V.slots.length); i++) step(1);
    if (!V.slots || !V.slots.length) return false;
    for (let round = 0; round < 10 && !V.slots.every((s) => s.state === "live"); round++) {
      for (const sl of V.slots) if (sl.state === "cool") sl.cd = 0;
      step(12);
    }
    return V.slots.some((s) => s.state === "live");
  };
  const slotOf = (kind) => {
    const V = CBZ.cityVips;
    if (!V || !V.slots) return null;
    for (const sl of V.slots) if (sl.state === "live" && sl.def && sl.def.kind === kind) return sl;
    return null;
  };

  // ---- collect this plate's cast ------------------------------------------
  let cast = [];
  let releasedInfo = null;
  if (sub.kind === "crowd") {
    // walk the player down real sidewalk points until enough instanced agents
    // have been promoted to real rigs near him. Promotion needs motion + time.
    const A = CBZ.city && CBZ.city.arena;
    const promoted = () => (CBZ.cityPeds || []).filter((p) =>
      p && p._crowd && !p._parked && !p.dead && p.char && p.char.skinSlots);
    for (let hop = 0; hop < 14 && promoted().length < (sub.n || 6); hop++) {
      const pt = A && A.randomSidewalkPoint ? A.randomSidewalkPoint() : { x: S.gx, z: S.gz };
      P.pos.set(pt.x, (CBZ.floorAt && CBZ.floorAt(pt.x, pt.z)) || 0, pt.z);
      step(4);
    }
    cast = promoted().slice(0, sub.n || 6);
    if (!cast.length) return { ok: false, err: "no promoted crowd bodies" };
  } else if (sub.kind === "magnate" || sub.kind === "released") {
    if (!ensureSlots()) return { ok: false, err: "vip slots never went live" };
    const sl = slotOf("magnate");
    if (!sl || !sl.principal) return { ok: false, err: "no live magnate" };
    cast = [sl.principal].concat(sl.guards.filter(Boolean));
    if (sub.kind === "released") {
      // remember who they were as VIPs, force the shift wrap, let releaseParty run
      const party = cast.slice();
      const preSid = party[0]._sid || null;
      sl.shiftT = -125;
      step(8);
      cast = party.filter((p) => p && !p.dead);
      releasedInfo = {
        exPrincipalSid: party[0] ? (party[0]._sid || null) : null,
        founderSidKept: !!(preSid && party[0] && party[0]._sid === preSid) ? 1 : 0,
      };
      if (!cast.length) return { ok: false, err: "party died before release" };
    }
  } else if (sub.kind === "court") {
    if (!ensureSlots()) return { ok: false, err: "vip slots never went live" };
    cast = ["don", "senator", "star"].map((k) => { const sl = slotOf(k); return sl && sl.principal; }).filter(Boolean);
    if (!cast.length) return { ok: false, err: "no court principals live" };
  }

  // ---- stand them on marks at the studio (the player's own spawn) ----------
  // release the previous plate's pins first
  S.pinned = [];
  const row = [];
  const GAP = 1.35;
  cast.forEach((p, i) => {
    const x = S.gx + (i - (cast.length - 1) / 2) * GAP;
    const z = S.gz + 7.5;
    const fy = CBZ.floorAt ? CBZ.floorAt(x, z) : null;
    const y = (Number.isFinite(fy) && Math.abs(fy - S.gy) < 1.2) ? fy : S.gy;
    row.push({ p, x, y, z });
  });
  P.pos.set(S.gx, S.gy + 0.08, S.gz); P.vy = 0; P.grounded = true;
  const hold = () => {
    for (const m of row) {
      const p = m.p;
      if (!p || p.dead) continue;
      p.pos.set(m.x, m.y, m.z);
      if (p.target && p.target.set) p.target.set(m.x, 0, m.z);
      p.path = null; p.finalGoal = null; p.speed = 0; p.state = "idle";
      p.pause = 9; p.rage = null; p.attackCD = 40; p.alarmed = 0; p.fear = 0;
      p.surrender = false; p.poseHandsUp = false; p.enterT = 0;
      p.culled = false;
      if (p.group) {
        p.group.visible = true;
        p.group.position.set(m.x, m.y, m.z);
        p.group.rotation.y = Math.atan2(S.gx - m.x, S.gz - m.z);   // face the lens
      }
    }
  };
  S.pinned = row;
  hold(); step(0.6); hold(); step(0.3); hold();
  // ONE settling tick AFTER the final pin, and no position writes after it:
  // entities/pedinstance.js draws most garment boxes from instance pools and
  // syncs pool matrices on its own tick — render straight off a manual
  // teleport and the pooled parts photograph at their PREVIOUS spot (the
  // first contact sheet's scattered heads/torsos).
  step(0.05);

  // ---- count what the plate is about --------------------------------------
  let skinArmedInRow = 0, armClash = 0, paintedBodies = 0, whiteTorsos = 0, kids = 0;
  for (const m of row) {
    const p = m.p, ch = p.char, ss = ch && ch.skinSlots;
    if (!ss) continue;
    const band = p.band || (ch && ch.band);
    if (p.child || (band && band !== "adult")) kids++;
    const torso = flat(ss.torso), arms = flat(ss.arms), head = flat(ss.head);
    if (torso === "painted") { paintedBodies++; continue; }
    if (torso === 0xffffff) whiteTorsos++;
    // naked arm = upper-arm flat hex EXACTLY the rig's built tone OR its live
    // head color (crowd promotion paints head+arms with the imposter's own
    // palette hex, not the built tone), under a real torso of another color.
    const armIsSkin = arms != null && arms !== "painted" &&
      ((ch.skinTone != null && arms === ch.skinTone) || (head != null && head !== "painted" && arms === head));
    if (armIsSkin && torso != null && torso !== arms) skinArmedInRow++;
    const d = rgbd(arms, torso);
    if (d != null && d > 64) armClash++;
  }
  const audit = CBZ.outfitIntegrityAudit ? CBZ.outfitIntegrityAudit() : null;

  // ---- fixed world-axis tripod, whole row, waist-up ------------------------
  const camera = CBZ.camera;
  camera.aspect = input.width / input.height;
  camera.near = 0.05; camera.far = 4000;
  camera.fov = 34;
  let lo = Infinity, hi = -Infinity, ry = S.gy, rz = S.gz + 7.5;
  for (const m of row) { if (m.x < lo) lo = m.x; if (m.x > hi) hi = m.x; ry = m.y; rz = m.z; }
  const cx = (lo + hi) / 2;
  const dist = Math.max(2.6, (hi - lo) * 0.72 + 2.9);
  camera.position.set(cx, ry + 1.62, rz - dist);
  camera.lookAt(cx, ry + 1.02, rz);
  camera.updateProjectionMatrix();
  if (typeof CBZ.skySync === "function") CBZ.skySync();
  else {
    const skyRig = CBZ.skyDome && CBZ.skyDome.parent;
    if (skyRig && skyRig.position) skyRig.position.set(camera.position.x, 0, camera.position.z);
  }
  // clear the corridor between lens and row (npc-gestures' rule, sized for a row)
  for (const car of (CBZ.cityCars || [])) {
    const grp = car && car.group, cp = car && car.pos;
    if (!grp || !cp) continue;
    const vx = cx - camera.position.x, vz = rz - camera.position.z;
    const vlen2 = vx * vx + vz * vz || 1;
    const px2 = cp.x - camera.position.x, pz2 = cp.z - camera.position.z;
    const t = (px2 * vx + pz2 * vz) / vlen2;
    if (t < -0.35 || t > 1.2) continue;
    const ox = px2 - vx * t, oz = pz2 - vz * t;
    if (ox * ox + oz * oz > 5.5 * 5.5) continue;
    grp.visible = false;
  }
  hideHud();
  CBZ.renderer.render(CBZ.scene, camera);

  const metrics = { skinArmedInRow, armClash, paintedBodies, minorsInRow: kids };
  if (audit) metrics.skinArmsCity = audit.skinArms | 0;
  if (sub.kind === "released") {
    metrics.whiteTorsos = whiteTorsos;
    if (releasedInfo) metrics.founderSidKept = releasedInfo.founderSidKept;
  }

  const before = input.side === "before";
  const query = (name) => S.overlay.querySelector(`[data-${name}]`);
  query("scrim").style.cssText = "position:absolute;left:0;right:0;bottom:0;height:150px;background:linear-gradient(to top,rgba(9,13,17,.94) 0%,rgba(9,13,17,.84) 46%,rgba(9,13,17,0) 100%)";
  query("side").textContent = before ? input.beforeLabel : input.afterLabel;
  query("side").style.cssText = `position:absolute;top:22px;left:26px;padding:7px 11px;border-radius:7px;background:${before ? "#c94c4c" : "#218b60"};font-size:12px;font-weight:900;letter-spacing:.12em`;
  query("name").textContent = sub.label;
  query("name").style.cssText = "position:absolute;bottom:60px;left:26px;font-size:24px;font-weight:800;letter-spacing:-.02em";
  query("focus").textContent = sub.focus;
  query("focus").style.cssText = "position:absolute;bottom:24px;left:28px;color:#c0cfda;font-size:12px;font-weight:550;line-height:1.42;max-width:960px";
  const who = row.map((m) => {
    const key = m.p.char && m.p.char._clothesKey;
    return (m.p.name || m.p.job || "?").split(" ")[0] + ":" + (key == null ? "flat" : String(key).split("|")[0]);
  }).join(" · ");
  query("read").textContent = "row " + row.length +
    " · skinArmed " + skinArmedInRow + " · clash " + armClash +
    (sub.kind === "released" ? " · founderSidKept " + (releasedInfo ? releasedInfo.founderSidKept : "?") : "") +
    " | " + who.slice(0, 110);
  query("read").style.cssText = `position:absolute;right:22px;top:22px;max-width:56%;padding:6px 10px;border-radius:7px;background:rgba(9,13,17,.72);font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:${(skinArmedInRow || armClash) ? "#ffb4b4" : "#9fe8c3"}`;
  query("source").textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname + (before ? " · flags OFF" : " · flags ON");
  query("source").style.cssText = "position:absolute;bottom:12px;right:24px;color:#8ea3b3;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return { ok: true, cast: row.length, metrics };
}

export default {
  id: "vip-wardrobe",
  title: "The Nil-Outfit Fix: Sleeves for the Crowd, a Real Wardrobe for VIPs",
  description: "Flag A/B on one checkout (before boots cfg_CITY_CROWD_SLEEVES=0 & cfg_CITY_VIP_WARDROBE=0). Four plates: bodies promoted out of the instanced crowd (naked shoulder-to-wrist arms → real short sleeves), the Magnate's armed detail (torso-only tint → tuxedo + painted tactical, adults only), the Don/Senator/Star court, and the same party released after the shift (white/no-op restores + the walking “Founder” nobody → every body back in its own civilian look, founder sid scrubbed).",
  beforeLabel: "BEFORE · FIXES OFF",
  afterLabel: "AFTER · FIXES ON",
  defaultBefore: "local",
  beforeParams: { cfg_CITY_CROWD_SLEEVES: 0, cfg_CITY_VIP_WARDROBE: 0 },
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.CONFIG",
  urlParams: { seed: 90210 },
  stageTimeoutMs: 480000,
  pairNote: "Same checkout · same seed · same tripod — the two cfg_ flags are the only variable",
  method: "Both sides serve this working tree; the before side boots with cfg_CITY_CROWD_SLEEVES=0 and cfg_CITY_VIP_WARDROBE=0 (the pre-wave code paths). Each plate boots the real city, freezes the rAF loop, drives CBZ.stepSim, forces the real systems (crowd promotion, the VIP slot lifecycle) and photographs live rigs on fixed marks. Crowd skins/shirts draw Math.random per boot, so faces and shirt colors differ across sides by construction — the metrics count the grammar under test, not the palette.",
  metricsNote: "skinArmedInRow: staged bodies rendering their own skin tone on a clothed upper arm (the naked-arm look). armClash: flat upper-arm vs torso RGB distance > 64 (a suit wearing someone else's sleeves). paintedBodies: bodies in a painted (canvas) garment. minorsInRow: non-adult bodies cast into the party (the age gate's number). skinArmsCity: the same naked-arm count over every live rig in the city (outfitIntegrityAudit().skinArms — the math-gate pin). founderSidKept: 1 when the released ex-principal still carries the founder's ledger sid (the “Lv.11 Founder” nobody). whiteTorsos: released bodies restored to the white sampled off a painted material.",
  metricsWhitelist: true,
  metrics: {
    skinArmedInRow: { label: "Naked-armed bodies in row", better: "lower" },
    armClash: { label: "Sleeve/torso clashes in row", better: "lower" },
    paintedBodies: { label: "Bodies in painted garments", better: "higher" },
    minorsInRow: { label: "Minors cast into the party", better: "lower" },
    skinArmsCity: { label: "Naked-armed rigs, whole city", better: "lower" },
    founderSidKept: { label: "Founder sid left on civilian", better: "lower" },
    whiteTorsos: { label: "White-restored torsos", better: "lower" },
  },
  subjects,
  stage: stageVipWardrobe,
};
