/* ============================================================
   city/hitman_fallout.js — WHAT A KILL LEAVES BEHIND. (CBZ.hmFallout)

   OWNER (2026-09-27): "kills have realistic consequences (police
   investigation, witnesses describing you, the news), and payment is a dead
   drop you collect." Nothing here shows a rating. What happened is in the
   world:

     WITNESSES   at the kill, every living body within 35 m of YOU that was
                 facing you with a clear line counts. Any at all and the city
                 has a description of you: what you were wearing. While that
                 description stands, a police officer who gets a good look at
                 you (25 m, in front of him, clear line, about a second and a
                 half) knows you, and wanted.js gets a real report. A change
                 of clothes (the motel closet, or any outfit change) or two
                 days clears it.
     THE SCENE   police arrive when you are not looking: yellow tape on thin
                 posts round the body, a sheet over him, a marked car at the
                 kerb, two officers standing at the tape. The body stays while
                 the scene is up (corpseMayReap says no). It packs up only when
                 nobody is watching.
     THE NEWS    the story is decided by what really happened: a heart attack,
                 a gas leak, a man in a dark suit, a gunman. It goes to the
                 phone's news app a little later; agency.js prints it in the
                 morning paper and runs it on the motel TV.
     THE MONEY   once you are clear (no stars, 150 m from the scene) the
                 caller's text names a real door 200 to 500 m away. A bag sits
                 by the bins there. "Take the bag" pays it.

   City/agency.js is the only caller; this file owns no story, only the
   consequences. Every cross-file read is feature-detected.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.game) return;
  const g = CBZ.game;

  /* ---------------- small reads ---------------- */
  function P() { return CBZ.player || null; }
  function A() { return CBZ.city && CBZ.city.arena; }
  function playing() { return g.mode === "city" && g.state === "playing"; }
  function d2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function distP(x, z) { const p = P(); return p && p.pos ? d2(p.pos.x, p.pos.z, x, z) : Infinity; }
  function floorY(x, z) { try { return CBZ.floorAt ? (CBZ.floorAt(x, z) || 0) : 0; } catch (e) { return 0; } }
  function day() { return CBZ.dayCount ? (CBZ.dayCount() | 0) : 0; }
  function clean(s) { return String(s == null ? "" : s).replace(/[—–]/g, ", ").replace(/[·•]/g, ","); }
  function unseen(x, z, minD) {
    if (!CBZ.npcTransitionSafe) return distP(x, z) > (minD || 60);
    try { return !!CBZ.npcTransitionSafe(x, z, { minDistance: minD || 40, maxDistance: 1e6 }); } catch (e) { return distP(x, z) > (minD || 60); }
  }
  function los(ax, ay, az, bx, by, bz) {
    if (!CBZ.clearLineOfFire) return true;
    try { return !!CBZ.clearLineOfFire(ax, ay, az, bx, by, bz); } catch (e) { return true; }
  }
  function store() {
    const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    if (!w) return RT.mem;
    w.records = w.records || {};
    const R = (w.records.hitman = w.records.hitman || { contracts: 0, completed: 0, failed: 0, highValue: 0, heat: 0, paid: 0 });
    const S = (R.fallout = R.fallout || {});
    S.incidents = S.incidents || [];
    return S;
  }
  function commit() { if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} } }
  function text(body, from) {
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "messages", from: from || "Unknown number", text: clean(body), priority: 2 }); return; } catch (e) {} }
  }
  function newsPush(body) {
    if (CBZ.phoneNotify) { try { CBZ.phoneNotify({ app: "news", from: "City Desk", text: clean(body), priority: 1 }); } catch (e) {} }
  }

  const RT = {
    mem: { incidents: [] },   // no world ledger (tests, a pre-boot call)
    scenes: [],               // live crime scenes (runtime only)
    spotT: 0, spotCop: null,
    drop: null,               // live bag prop {id, grp}
    serial: 1,
  };

  /* ================================================================
     WHAT YOU LOOK LIKE — the words a witness uses
     ================================================================ */
  function colorWord(hex) {
    if (hex == null || !isFinite(hex)) return "dark";
    const r = ((hex >> 16) & 255) / 255, gg = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2;
    const s = mx === mn ? 0 : (l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn));
    if (l < 0.16) return "black";
    if (s < 0.16) return l > 0.82 ? "white" : (l > 0.55 ? "light grey" : (l > 0.3 ? "grey" : "dark"));
    let h = 0;
    if (mx === r) h = ((gg - b) / (mx - mn)) % 6; else if (mx === gg) h = (b - r) / (mx - mn) + 2; else h = (r - gg) / (mx - mn) + 4;
    h = (h * 60 + 360) % 360;
    const name = h < 15 || h >= 340 ? "red" : h < 40 ? (l < 0.4 ? "brown" : "orange") : h < 65 ? "yellow" : h < 160 ? "green" : h < 200 ? "teal" : h < 255 ? "blue" : h < 290 ? "purple" : "pink";
    return (l < 0.3 && name !== "brown" ? "dark " : "") + name;
  }
  function garment(rec) {
    const s = ((rec && (rec.name || "")) + " " + (rec && rec.id || "")).toLowerCase();
    if (/suit|blazer|tux|business|formal|exec|lawyer/.test(s)) return "suit";
    if (/hood/.test(s)) return "hoodie";
    if (/track/.test(s)) return "tracksuit";
    if (/police|guard|security|uniform|medic|nurse|army|soldier|detail|staff/.test(s)) return "uniform";
    if (/jacket|leather|bomber|coat/.test(s)) return "jacket";
    if (/dress/.test(s)) return "dress";
    return "";
  }
  function describe() {
    const rec = g.cityWornOutfit || null;
    const torso = rec && rec.colors ? rec.colors.torso : null;
    const c = colorWord(torso), gw = garment(rec);
    const who = g.cityMasked ? "a masked man" : "a man";
    return gw ? (who + " in a " + c + " " + gw) : (who + " in " + c + " clothes");
  }
  function outfitKey() { const rec = g.cityWornOutfit; return String(g.cityOutfitId || (rec && rec.id) || "none") + ":" + String(rec && rec.colors ? rec.colors.torso : ""); }

  /* ================================================================
     WITNESSES — who actually saw you
     ================================================================ */
  function countWitnesses(victim) {
    const pl = P(); if (!pl || !pl.pos) return 0;
    const px = pl.pos.x, py = (pl.pos.y || 0) + 1.2, pz = pl.pos.z;
    const L = CBZ.cityPeds || [];
    let n = 0;
    for (let i = 0; i < L.length && n < 12; i++) {
      const q = L[i];
      if (!q || q === victim || q.dead || !q.pos || q.culled || (q.group && !q.group.visible)) continue;
      const dx = px - q.pos.x, dz = pz - q.pos.z, d = Math.hypot(dx, dz);
      if (d > 35 || d < 0.3) continue;
      const yaw = q.group ? q.group.rotation.y : 0;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      // "facing you": a scared crowd turns to the noise, so a close body with
      // his back half turned still counts; far ones must be looking at you
      const need = d < 8 ? -0.2 : 0.25;
      if ((fx * dx + fz * dz) / d < need) continue;
      if (!los(q.pos.x, (q.pos.y || 0) + 1.6, q.pos.z, px, py, pz)) continue;
      n++;
    }
    const cops = CBZ.cityCops || [];
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i]; if (!c || c.dead || !c.pos) continue;
      if (d2(c.pos.x, c.pos.z, px, pz) < 35 && los(c.pos.x, (c.pos.y || 0) + 1.6, c.pos.z, px, py, pz)) n++;
    }
    return n;
  }

  /* ================================================================
     THE KILL — agency.js reports one; this decides what it meant
     info: {ped, name, role, place, cause:'poison'|'charge'|'shot'|'blast',
            kills:{civ,guard}, alarm, photo, weight:'nobody'|'someone'|'state'}
     ================================================================ */
  function nearestPlace(x, z) {
    const AR = A(); if (!AR) return "the street";
    const L = (AR.lots || []).concat(AR.shopLots || []);
    let best = null, bd = 60;
    for (let i = 0; i < L.length; i++) {
      const l = L[i]; if (!l || !l.building || !isFinite(l.cx)) continue;
      const d = d2(l.cx, l.cz, x, z); if (d < bd) { bd = d; best = l; }
    }
    if (!best) return "the street";
    const n = best.building.name ? String(best.building.name).trim() : "";
    return n ? (n.indexOf(" ") > 0 ? n : "the " + n.toLowerCase()) : "a building on the block";
  }
  function kill(info) {
    info = info || {};
    const S = store();
    const pl = P();
    const v = info.ped;
    const x = v && v.pos ? v.pos.x : (info.x || 0), z = v && v.pos ? v.pos.z : (info.z || 0);
    const cause = info.cause || "shot";
    const accident = cause === "poison" || cause === "charge";
    const dist = pl && pl.pos ? d2(pl.pos.x, pl.pos.z, x, z) : 0;
    const witnesses = accident ? 0 : countWitnesses(v);
    const civ = (info.kills && info.kills.civ) | 0, guard = (info.kills && info.kills.guard) | 0;
    const seen = witnesses > 0 || (!accident && !!info.alarm);
    const extra = civ + guard;
    let verdict = "clean";
    if (civ >= 3 || extra >= 5) verdict = "bloodbath";
    else if (civ > 0) verdict = "messy";
    else if (seen || (g.wanted | 0) > 0) verdict = "seen";
    const inc = {
      id: "inc" + (Date.now() % 1e7) + "-" + (RT.serial++),
      x: x, z: z, day: day(), name: info.name || (v && v.name) || "a man", role: info.role || "",
      place: info.place || nearestPlace(x, z), cause: cause, dist: Math.round(dist), long: dist > 60,
      witnesses: witnesses, seen: seen, civ: civ, guard: guard, verdict: verdict,
      weight: info.weight || "someone", desc: seen ? describe() : null, cleared: false,
    };
    inc.story = story(inc);
    S.incidents.push(inc);
    if (S.incidents.length > 8) S.incidents.splice(0, S.incidents.length - 8);
    if (seen) {
      S.desc = { text: inc.desc, outfit: outfitKey(), day: day(), inc: inc.id };
    }
    commit();
    if (v) { v._hmScene = inc.id; }
    // the police come when nobody is looking; the news a little later
    RT.scenes.push({ inc: inc, ped: v || null, state: "pending", t: 0, props: [], cops: [], car: null, life: 0 });
    const st = inc.story;
    const delay = inc.weight === "state" ? 4000 : 22000 + Math.random() * 12000;
    setTimeout(function () { newsPush(st.headline + ". " + st.deck); }, delay);
    return inc;
  }

  /* ================================================================
     THE NEWS — the words are decided by what happened
     ================================================================ */
  function cap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  function story(inc) {
    const who = inc.name, place = inc.place, role = inc.role ? inc.role : "";
    const whoRole = role ? (who + ", " + role.charAt(0).toLowerCase() + role.slice(1) + ",") : who;
    let headline, deck, body = [], tv;
    const n = inc.civ + inc.guard + 1;
    if (inc.verdict === "bloodbath") {
      headline = "Gunman kills " + n + " near " + place;
      deck = "Police seek " + (inc.desc || "a lone gunman") + ". Witnesses describe a scene of panic.";
      body.push(cap(whoRole) + " was among " + n + " people shot dead near " + place + ".");
      body.push("Officers sealed the block for most of the day. Detectives are asking anyone with a phone recording to come forward.");
    } else if (inc.cause === "poison") {
      headline = cap(who) + " dies at a cafe table";
      deck = "Doctors say heart failure. Friends say he never missed his morning coffee.";
      body.push(cap(whoRole) + " collapsed outside " + place + " and could not be revived.");
      body.push("Police say there is nothing to suggest anyone else was involved.");
    } else if (inc.cause === "charge") {
      headline = "Car explodes outside " + place;
      deck = inc.seen ? "Police are treating the blast as deliberate." : "Police suspect a gas leak. One man dead.";
      body.push(cap(whoRole) + " died when his car caught fire and exploded at the kerb outside " + place + ".");
      body.push(inc.seen ? "A witness saw a man near the car minutes before." : "The fire service says a faulty fuel line is the most likely cause.");
    } else if (inc.seen) {
      headline = cap(who) + " shot dead near " + place;
      deck = "Police seek " + inc.desc + ".";
      body.push(cap(whoRole) + " was shot " + (inc.long ? "from a distance" : "at close range") + " near " + place + ".");
      body.push(inc.witnesses === 1 ? "One witness gave police a description." : inc.witnesses + " witnesses gave police a description.");
    } else {
      headline = cap(who) + " shot dead near " + place;
      deck = inc.long ? "No witnesses. Police say the shot came from a distance." : "No witnesses, no suspect, no motive.";
      body.push(cap(whoRole) + " was found dead near " + place + ".");
      body.push("Detectives spent the afternoon knocking on doors. Nobody saw anything.");
    }
    if (inc.verdict === "messy") body.push(inc.civ === 1 ? "A passer-by was also killed." : inc.civ + " passers-by were also killed.");
    if (inc.guard > 0 && inc.verdict !== "bloodbath") body.push(inc.guard === 1 ? "His bodyguard died with him." : inc.guard + " of his bodyguards died with him.");
    tv = { headline: headline, sub: deck, ticker: body.join("   ") };
    return { headline: clean(headline), deck: clean(deck), body: body.map(clean), tv: tv };
  }
  function latest() {
    const S = store(); const L = S.incidents || [];
    return L.length ? L[L.length - 1] : null;
  }

  /* ================================================================
     PROPS — tape, posts, a sheet, a light bar. Shared mats, no lights.
     ================================================================ */
  const MATS = {}, GEO = {};
  function mat(k, make) { if (!MATS[k]) { MATS[k] = make(); MATS[k]._shared = true; } return MATS[k]; }
  function geo(k, make) { if (!GEO[k]) { GEO[k] = make(); GEO[k]._shared = true; } return GEO[k]; }
  let tapeTex = null;
  function tapeTexture() {
    if (tapeTex || typeof document === "undefined") return tapeTex;
    const c = document.createElement("canvas"); c.width = 256; c.height = 16;
    const x = c.getContext("2d");
    if (!x) return null;
    x.fillStyle = "#f2c81c"; x.fillRect(0, 0, 256, 16);
    x.fillStyle = "#141414"; x.font = "bold 11px Arial, sans-serif"; x.textBaseline = "middle";
    x.fillText("POLICE LINE  DO NOT CROSS", 12, 8.5);
    tapeTex = new THREE.CanvasTexture(c);
    tapeTex.wrapS = THREE.RepeatWrapping;
    tapeTex._shared = true;
    return tapeTex;
  }
  function group(x, z) {
    const grp = new THREE.Group();
    grp.position.set(x, floorY(x, z), z);
    grp.userData.transient = true; grp.userData.dynamic = true;
    const AR = A(); if (AR && AR.root) AR.root.add(grp);
    return grp;
  }
  function killGroup(grp) {
    if (!grp) return;
    if (grp.parent) grp.parent.remove(grp);
    grp.traverse(function (n) {
      if (n.geometry && !n.geometry._shared && n.geometry.dispose) n.geometry.dispose();
      if (n.material && !n.material._shared && n.material.dispose) n.material.dispose();
    });
  }
  function buildTape(sc) {
    const inc = sc.inc;
    const body = sc.ped && sc.ped.pos ? sc.ped.pos : { x: inc.x, z: inc.z };
    const cx = body.x, cz = body.z;
    const grp = group(cx, cz);
    const n = 5, R = 4.2;
    const pts = [];
    const rot = ((inc.x * 7 + inc.z * 3) % 6.28);
    for (let i = 0; i < n; i++) {
      const a = rot + i / n * Math.PI * 2;
      const r = R + ((i * 37) % 10) / 10 * 0.9;
      const px = Math.cos(a) * r, pz = Math.sin(a) * r;
      const y = floorY(cx + px, cz + pz) - grp.position.y;
      pts.push({ x: px, z: pz, y: y });
      const post = new THREE.Mesh(geo("post", function () { return new THREE.CylinderGeometry(0.028, 0.034, 1.02, 6); }), mat("post", function () { return new THREE.MeshLambertMaterial({ color: 0x2b2d30 }); }));
      post.position.set(px, y + 0.51, pz);
      grp.add(post);
    }
    const tm = mat("tape", function () {
      const t = tapeTexture();
      return new THREE.MeshLambertMaterial({ color: 0xffffff, map: t || null, side: THREE.DoubleSide });
    });
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const gm = new THREE.PlaneGeometry(len, 0.075);
      const uv = gm.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * len / 1.6);
      const m = new THREE.Mesh(gm, tm);
      m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.92, (a.z + b.z) / 2);
      m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      grp.add(m);
    }
    // a sheet over him, the thing every photograph of a scene has
    if (sc.ped && sc.ped.pos) {
      const sh = new THREE.Mesh(geo("sheet", function () { return new THREE.BoxGeometry(0.95, 0.16, 1.95); }), mat("sheet", function () { return new THREE.MeshLambertMaterial({ color: 0xe9e8e2 }); }));
      sh.position.set(0, 0.09, 0);
      sh.rotation.y = sc.ped.group ? sc.ped.group.rotation.y : 0;
      grp.add(sh);
    }
    sc.props.push(grp);
  }

  // a marked car: a dark sedan with a roof bar and white doors (police.js's
  // own dress is private; this is the same read, from the same parts)
  function dressPolice(c) {
    if (!c || !c.group || c._hmBar) return;
    const box = geo("unit", function () { return new THREE.BoxGeometry(1, 1, 1); });
    const red = mat("barRed", function () { return new THREE.MeshBasicMaterial({ color: 0xff2d3e }); });
    const blue = mat("barBlue", function () { return new THREE.MeshBasicMaterial({ color: 0x2d6bff }); });
    const dark = mat("barDark", function () { return new THREE.MeshBasicMaterial({ color: 0x101216 }); });
    const white = mat("doorWhite", function () { return new THREE.MeshLambertMaterial({ color: 0xe9edf2 }); });
    const h = (c.dims && c.dims.height) || 1.55, w = (c.dims && c.dims.width) || 1.9;
    const bar = new THREE.Group();
    const base = new THREE.Mesh(box, dark); base.scale.set(1.3, 0.1, 0.38); bar.add(base);
    const r = new THREE.Mesh(box, red); r.scale.set(0.5, 0.16, 0.32); r.position.set(-0.4, 0.1, 0); bar.add(r);
    const b = new THREE.Mesh(box, blue); b.scale.set(0.5, 0.16, 0.32); b.position.set(0.4, 0.1, 0); bar.add(b);
    bar.position.set(0, h + 0.05, 0.1);
    c.group.add(bar);
    [1, -1].forEach(function (s) {
      const d = new THREE.Mesh(box, white); d.scale.set(0.05, 0.62, 1.34); d.position.set(s * (w / 2 + 0.015), 0.97, 0.25); c.group.add(d);
    });
    c._hmBar = { red: r, blue: b };
    // LEAD NOTE: main's instanced parked cars may pull a settled parked car
    // into a shared pool and hide its group; this dress rides c.group, so the
    // car needs to stay a real mesh. _hmKeepMesh is the hint for that merge.
    c._hmKeepMesh = true;
  }
  function policeCar(x, z, heading) {
    if (!CBZ.cityAddParkedCar) return null;
    let c = null;
    try { c = CBZ.cityAddParkedCar(x, z, heading || 0, { color: 0x16181d }); } catch (e) { c = null; }
    if (c) { c._hmPolice = true; try { dressPolice(c); } catch (e) {} }
    return c;
  }
  // the nearest kerb: the closest point on the nearest road, pulled to its edge
  function kerbNear(x, z, maxD) {
    const AR = A(); if (!AR || !AR.roads) return null;
    let best = null, bd = (maxD || 40) * (maxD || 40);
    for (let i = 0; i < AR.roads.length; i++) {
      const r = AR.roads[i]; if (!r) continue;
      const half = (r.len || 0) / 2;
      let qx, qz;
      if (r.vertical) { qx = r.x; qz = Math.max(r.z - half, Math.min(r.z + half, z)); }
      else { qz = r.z; qx = Math.max(r.x - half, Math.min(r.x + half, x)); }
      const dd = (qx - x) * (qx - x) + (qz - z) * (qz - z);
      if (dd < bd) { bd = dd; best = { r: r, x: qx, z: qz }; }
    }
    if (!best) return null;
    const r = best.r, off = Math.max(1.5, (r.w || AR.ROAD || 12) / 2 - 1.6);
    if (r.vertical) { const s = x >= r.x ? 1 : -1; return { x: r.x + s * off, z: best.z, h: 0 }; }
    const s = z >= r.z ? 1 : -1; return { x: best.x, z: r.z + s * off, h: Math.PI / 2 };
  }

  /* ================================================================
     THE SCENE — staged unseen, held while you are around, struck unseen
     ================================================================ */
  const SCENE_SECS = 170;
  function postCop(x, z, fx, fz) {
    if (!CBZ.citySpawnCop) return null;
    let c = null;
    try { c = CBZ.citySpawnCop(x, z, false); } catch (e) { c = null; }
    if (!c || !c.pos) return null;
    c.pos.set(x, floorY(x, z), z); if (c.group) c.group.position.copy(c.pos);
    try {
      c._post = CBZ.cityPostStand
        ? CBZ.cityPostStand(c, { x: x, z: z, fx: fx, fz: fz, relaxed: true, kind: "watch", tag: "hitman:scene", job: "police officer" })
        : { x: x, z: z, fx: fx, fz: fz, mount: null, mountT: 0, relaxed: true };
    } catch (e) {}
    if (c.group) c.group.rotation.y = Math.atan2(fx, fz);
    c._hmScene = true;
    return c;
  }
  function stageScene(sc) {
    const inc = sc.inc;
    const bx = sc.ped && sc.ped.pos ? sc.ped.pos.x : inc.x, bz = sc.ped && sc.ped.pos ? sc.ped.pos.z : inc.z;
    buildTape(sc);
    const k = kerbNear(bx, bz, 34);
    if (k) {
      const car = policeCar(k.x, k.z, k.h);
      if (car) sc.car = car;
    }
    // two officers at the tape, facing out
    for (let i = 0; i < 2; i++) {
      const a = (i ? 2.4 : -0.7) + ((inc.x | 0) % 3);
      const fx = Math.cos(a), fz = Math.sin(a);
      const c = postCop(bx + fx * 5.2, bz + fz * 5.2, fx, fz);
      if (c) sc.cops.push(c);
    }
    sc.state = "up"; sc.life = 0;
  }
  function strikeScene(sc) {
    for (let i = 0; i < sc.props.length; i++) killGroup(sc.props[i]);
    sc.props.length = 0;
    for (let i = 0; i < sc.cops.length; i++) {
      const c = sc.cops[i]; if (!c || c.dead) continue;
      if (c.curTarget || c.sees) continue;              // a working officer is not packed away
      try { if (CBZ.cityPostRelease) CBZ.cityPostRelease(c, "scene over"); } catch (e) {}
      c._post = null;
      if (c.group && c.group.parent) c.group.parent.remove(c.group);
      const L = CBZ.cityCops || []; const j = L.indexOf(c); if (j >= 0) L.splice(j, 1);
    }
    sc.cops.length = 0;
    if (sc.car && !sc.car.player && CBZ.cityScrapCar) { try { CBZ.cityScrapCar(sc.car); } catch (e) {} }
    sc.car = null;
    if (sc.ped) sc.ped._hmScene = null;
    sc.state = "gone";
  }
  function tickScenes(dt) {
    for (let i = RT.scenes.length - 1; i >= 0; i--) {
      const sc = RT.scenes[i];
      sc.t += dt;
      const bx = sc.ped && sc.ped.pos ? sc.ped.pos.x : sc.inc.x, bz = sc.ped && sc.ped.pos ? sc.ped.pos.z : sc.inc.z;
      if (sc.state === "pending") {
        // the response takes a while; it never appears in front of you
        if (sc.t > 18 && unseen(bx, bz, 45)) stageScene(sc);
        else if (sc.t > 240) { sc.state = "gone"; }
      } else if (sc.state === "up") {
        sc.life += dt;
        if (sc.life > SCENE_SECS && distP(bx, bz) > 90 && unseen(bx, bz, 60)) strikeScene(sc);
      }
      if (sc.state === "gone") RT.scenes.splice(i, 1);
    }
  }
  // THE BODY STAYS while its scene does (morgue.js's persistence law gets one
  // more "no"; the ambulance can still collect him, which reaps as always)
  function wrapReap() {
    if (typeof CBZ.corpseMayReap !== "function" || CBZ.corpseMayReap._hmWrap) return;
    const orig = CBZ.corpseMayReap;
    const w = function (a) {
      if (a && a._hmScene && !a.collected) {
        for (let i = 0; i < RT.scenes.length; i++) if (RT.scenes[i].inc.id === a._hmScene && RT.scenes[i].state !== "gone") return false;
      }
      return orig.apply(this, arguments);
    };
    for (const k in orig) if (Object.prototype.hasOwnProperty.call(orig, k)) w[k] = orig[k];
    w._hmWrap = true;
    CBZ.corpseMayReap = w;
  }

  /* ================================================================
     THE DESCRIPTION — police who see you, know you
     ================================================================ */
  let roomWired = false;
  function wireRoom() {
    if (roomWired || !CBZ.hmRoom || typeof CBZ.hmRoom.on !== "function") return;
    roomWired = true;
    try { CBZ.hmRoom.on("change", function () { clearDesc("clothes"); }); } catch (e) {}
  }
  function clearDesc(why) {
    const S = store();
    if (!S.desc) return;
    S.desc = null; RT.spotT = 0; RT.lastClear = why || "";
    commit();
  }
  function descActive() {
    const S = store(); const D = S.desc;
    if (!D) return null;
    if (day() - (D.day | 0) >= 2) { clearDesc("days"); return null; }
    if (outfitKey() !== D.outfit) { clearDesc("clothes"); return null; }
    return D;
  }
  function tickRecognition(dt) {
    const D = descActive();
    if (!D || (g.wanted | 0) > 0) { RT.spotT = Math.max(0, RT.spotT - dt); return; }
    const pl = P(); if (!pl || !pl.pos || pl.dead) return;
    const px = pl.pos.x, pz = pl.pos.z, py = (pl.pos.y || 0) + 1.2;
    const cops = CBZ.cityCops || [];
    let who = null;
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i]; if (!c || c.dead || !c.pos || (c.group && !c.group.visible)) continue;
      const dx = px - c.pos.x, dz = pz - c.pos.z, d = Math.hypot(dx, dz);
      if (d > 25 || d < 0.2) continue;
      const yaw = c.group ? c.group.rotation.y : 0;
      if ((Math.sin(yaw) * dx + Math.cos(yaw) * dz) / d < 0.55) continue;
      if (!los(c.pos.x, (c.pos.y || 0) + 1.6, c.pos.z, px, py, pz)) continue;
      who = c; break;
    }
    if (!who) { RT.spotT = Math.max(0, RT.spotT - dt * 0.5); return; }
    RT.spotT += dt;
    RT.spotCop = who;
    if (RT.spotT < 1.6) return;
    RT.spotT = 0;
    if (CBZ.citySay) { try { CBZ.citySay(who, "You. Stop right there.", "#e8e2d4", 2.2); } catch (e) {} }
    if (CBZ.cityCrime) { try { CBZ.cityCrime(140, { type: "murder", instant: true, x: px, z: pz }); } catch (e) {} }
    else { g.wanted = Math.max(g.wanted | 0, 3); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
    RT.recognized = (RT.recognized | 0) + 1;
  }

  /* ================================================================
     THE DEAD DROP — a bag by the bins at a real door
     ================================================================ */
  function dropLot(fromX, fromZ, salt) {
    const AR = A(); if (!AR) return null;
    const L = (AR.lots || []).concat(AR.shopLots || []);
    const pool = [];
    for (let i = 0; i < L.length; i++) {
      const l = L[i];
      if (!l || !l.building || !l.building.door || l.demolished || l.kind === "player" || l.kind === "park") continue;
      if (pool.indexOf(l) >= 0) continue;
      const d = d2(l.cx, l.cz, fromX, fromZ);
      if (d >= 200 && d <= 500) pool.push(l);
    }
    if (!pool.length) {
      for (let i = 0; i < L.length; i++) { const l = L[i]; if (l && l.building && l.building.door && !l.demolished && d2(l.cx, l.cz, fromX, fromZ) > 90) pool.push(l); }
    }
    if (!pool.length) return null;
    const r = CBZ.hash01 ? CBZ.hash01(salt | 0, (CBZ.WORLD_SEED | 0), 0xd40) : Math.random();
    return pool[Math.min(pool.length - 1, (r * pool.length) | 0)];
  }
  function lotName(l) {
    const b = l && l.building;
    if (b && b.name) { const n = String(b.name).trim(); return n.indexOf(" ") > 0 ? n : "the " + n.toLowerCase(); }
    const K = { bank: "the bank", office: "the office block", food: "the diner", club: "the club", casino: "the casino", guns: "the gun shop", carlot: "the car lot", shop: "the shop", gas: "the gas station", hardware: "the hardware store", clothing: "the clothes shop", bar: "the bar", gym: "the gym" };
    return (l && K[l.kind]) || "the building on the corner";
  }
  function buildBag(D) {
    const grp = group(D.x, D.z);
    grp.rotation.y = D.face || 0;
    // a steel bin, and the bag half behind it
    const bin = new THREE.Mesh(geo("bin", function () { return new THREE.CylinderGeometry(0.3, 0.27, 0.9, 12); }), mat("bin", function () { return new THREE.MeshLambertMaterial({ color: 0x3e4a3f }); }));
    bin.position.set(0, 0.45, 0); grp.add(bin);
    const lid = new THREE.Mesh(geo("binlid", function () { return new THREE.CylinderGeometry(0.32, 0.32, 0.05, 12); }), mat("binlid", function () { return new THREE.MeshLambertMaterial({ color: 0x2f3830 }); }));
    lid.position.set(0, 0.92, 0); grp.add(lid);
    const bag = new THREE.Mesh(geo("bag", function () { return new THREE.BoxGeometry(0.55, 0.3, 0.28); }), mat("bag", function () { return new THREE.MeshLambertMaterial({ color: 0x1b2230 }); }));
    bag.position.set(0.52, 0.15, 0.08); bag.rotation.y = 0.3; grp.add(bag);
    const strap = new THREE.Mesh(geo("strap", function () { return new THREE.TorusGeometry(0.13, 0.015, 4, 10, Math.PI); }), mat("strap", function () { return new THREE.MeshLambertMaterial({ color: 0x111111 }); }));
    strap.position.set(0.52, 0.3, 0.08); strap.rotation.y = 0.3; grp.add(strap);
    return grp;
  }
  // opts: {pay, from, line(where) -> text, salt, near:{x,z}}
  function drop(opts) {
    opts = opts || {};
    const S = store();
    const pl = P();
    const fx = opts.near ? opts.near.x : (pl && pl.pos ? pl.pos.x : 0), fz = opts.near ? opts.near.z : (pl && pl.pos ? pl.pos.z : 0);
    const l = dropLot(fx, fz, opts.salt || (Date.now() & 0xffff));
    let x, z, face = 0, where;
    if (l) {
      const d = l.building.door;
      let ox = d.x - l.cx, oz = d.z - l.cz; const m = Math.hypot(ox, oz) || 1; ox /= m; oz /= m;
      const sx = -oz, sz = ox;
      x = d.x + ox * 1.1 + sx * 2.4; z = d.z + oz * 1.1 + sz * 2.4; face = Math.atan2(ox, oz);
      where = lotName(l);
    } else {
      x = fx + 220; z = fz; where = "the corner";
    }
    const id = "drop" + (Date.now() % 1e7);
    S.drop = { id: id, x: x, z: z, face: face, pay: Math.max(0, Math.round(opts.pay || 0)), where: where, taken: false, from: opts.from || "Unknown number" };
    commit();
    const msg = typeof opts.line === "function" ? opts.line(where) : ("Your money is in a bag by the bins outside " + where + ".");
    if (msg) setTimeout(function () { text(msg, S.drop && S.drop.from); }, opts.delay != null ? opts.delay : 1500);
    return S.drop;
  }
  function dropState() { const S = store(); return S.drop || null; }
  function takeDrop() {
    const S = store(); const D = S.drop;
    if (!D || D.taken) return;
    D.taken = true;
    if (RT.drop) { killGroup(RT.drop.grp); RT.drop = null; }
    if (CBZ.city && CBZ.city.addCash && D.pay > 0) { try { CBZ.city.addCash(D.pay); } catch (e) {} }
    const R = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null;
    if (R && R.records && R.records.hitman) R.records.hitman.paid = (R.records.hitman.paid | 0) + D.pay;
    RT.lastTaken = D.id;
    commit();
    if (CBZ.sfx && CBZ.sfx.pickup) { try { CBZ.sfx.pickup(); } catch (e) {} }
  }
  function tickDrop() {
    const D = dropState();
    if (!D || D.taken) { if (RT.drop) { killGroup(RT.drop.grp); RT.drop = null; } return; }
    if (!RT.drop || RT.drop.id !== D.id || !RT.drop.grp.parent) {
      if (RT.drop) killGroup(RT.drop.grp);
      RT.drop = { id: D.id, grp: buildBag(D) };
    }
  }
  let verbWired = false;
  function wireVerb() {
    const V = CBZ.hmVerbs;
    if (verbWired || !V || !V.add) return;
    verbWired = true;
    const tok = { x: 0, z: 0 };
    V.add({
      id: "hm-dead-drop", prio: 20, range: 2,
      find: function (px, pz) {
        const D = dropState(); if (!D || D.taken || !playing()) return null;
        tok.x = D.x; tok.z = D.z;
        return d2(px, pz, D.x, D.z) < 2 ? tok : null;
      },
      verb: "Take the bag",
      onUse: function () { takeDrop(); },
    });
  }

  function clear(incId) {
    if ((g.wanted | 0) > 0) return false;
    const S = store();
    const inc = (S.incidents || []).find(function (i) { return i.id === incId; });
    if (!inc) return true;
    return distP(inc.x, inc.z) > 150;
  }

  /* ---------------- the loop ---------------- */
  let acc = 0;
  if (CBZ.onUpdate) {
    CBZ.onUpdate(39.4, function (dt) {
      if (!playing()) return;
      acc += dt || 0;
      if (acc < 0.2) return;
      const step = acc; acc = 0;
      try {
        wrapReap(); wireRoom(); wireVerb();
        tickScenes(step);
        tickRecognition(step);
        tickDrop();
      } catch (e) { if (window.console) console.error("[hmFallout]", e); }
    });
  }

  CBZ.hmFallout = {
    kill: kill,
    story: story,
    latest: latest,
    clear: clear,
    drop: drop,
    dropState: dropState,
    takeDrop: takeDrop,
    describe: describe,
    description: function () { const D = descActive(); return D ? D.text : null; },
    clearDescription: clearDesc,
    policeCar: policeCar,
    kerbNear: kerbNear,
    incidents: function () { return (store().incidents || []).slice(); },
    audit: function () {
      const D = store().desc, dr = dropState();
      return {
        witness: D ? { text: D.text, day: D.day, spot: Math.round(RT.spotT * 10) / 10, recognized: RT.recognized | 0 } : { none: true, lastClear: RT.lastClear || null },
        scenes: RT.scenes.map(function (s) { return { inc: s.inc.id, state: s.state, cops: s.cops.length, car: !!s.car, props: s.props.length, life: Math.round(s.life) }; }),
        deadDrop: dr ? { id: dr.id, where: dr.where, pay: dr.pay, taken: !!dr.taken, prop: !!RT.drop, dist: Math.round(distP(dr.x, dr.z)) } : null,
        last: latest() ? { verdict: latest().verdict, witnesses: latest().witnesses, headline: latest().story.headline } : null,
      };
    },
    _rt: RT,
    _tick: function (dt) { tickScenes(dt); tickRecognition(dt); tickDrop(); },
  };
})();
