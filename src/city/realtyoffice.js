/* ============================================================
   city/realtyoffice.js — the WALK-IN REALTY OFFICE: the wall IS the listings.

   WHY: the property ladder shipped behind a text menu at the clerk and the
   [Z] phone market. But buying where you LIVE deserves a brokerage — a wall
   of framed listings you read in person, a couple of agent desks, and a
   scale model of the development on the centre table. Walking into Keystone
   Realty, SEEING the homes on the wall with their square footage and price,
   pulling a financing quote from the agent, and walking out with the keys
   (or a mortgage) IS the buy-a-home fantasy; a phone app is for browsing.

   This is the GUNSTORE / JEWELRY pattern applied to property: built ONCE per
   city on a single distance-gated group, shared fixture materials, self-
   managed in-world [E] prompts. It owns NO market data — every listing, price
   and financing quote comes from the live Zillow registry (CBZ.cityRealty-
   Listings / CBZ.cityZillow / CBZ.cityRealtyFinance), so the wall, the realtor
   text menu and the [Z] panel can never disagree. Apartments come from HERE;
   financing routes to the bank (CBZ.cityBankLoan via Zillow's finance path).

   The realtor lot's shell (door, clerk vendor, the furnished desks + listings
   board + scale-model table from buildings.js furnishInterior) already exists;
   this hangs the REAL interactive layer on it: framed property cards on the
   back wall + a focused buy/finance panel at [E], and a "talk to the agent"
   pre-approval at the desk. Mode-gated + headless-guarded.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const VIS_R = 55;          // the office fixtures draw only when you're near
  const WALL_REACH = 4.4;    // you read the listings wall from across the lobby
  const DESK_REACH = 3.0;    // you lean on the agent's desk up close
  const WALL_DOT = 0.55;     // look-cone for the wall (broad — it's a big board)
  const DESK_DOT = 0.6;      // look-cone for a desk
  const WT = 0.4;            // wall thickness (matches buildings.js)
  const MAX_CARDS = 8;       // framed cards hung on the wall (the rest live in the panel)

  const S = { lot: null, b: null, group: null, built: false, arena: null,
              noLotArena: null, cx: 0, cz: 0,
              wall: null, desks: [], cur: null,
              prompt: null, lastTxt: "",
              panel: null, panelOpen: false, rows: [], actions: [], page: 0 };

  function fmt$(n) { n = Math.round(+n); if (!isFinite(n)) n = 0; return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(); }
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s); }

  // ---- shared fixture materials (one each, flagged _shared) -----------------
  let M = null;
  function mats() {
    if (M) return M;
    M = {
      frame: new THREE.MeshLambertMaterial({ color: 0x2a2f37 }),                                          // dark listing-card frame
      board: new THREE.MeshLambertMaterial({ color: 0x1d2228 }),                                          // the gallery backing board
      accent: new THREE.MeshLambertMaterial({ color: 0x4fd0a0, emissive: 0x2f8a6a, emissiveIntensity: 0.5 }), // Keystone's teal trade accent
      wood: new THREE.MeshLambertMaterial({ color: 0x6b4a2a }),                                            // desk / model table
      model: new THREE.MeshLambertMaterial({ color: 0xc8cdd4 }),                                           // pale scale-model tower
      glass: new THREE.MeshLambertMaterial({ color: 0xbfe9f7, emissive: 0x3f8aa6, emissiveIntensity: 0.3, transparent: true, opacity: 0.34 }), // model-case glass
    };
    Object.keys(M).forEach((k) => { M[k]._shared = true; });
    return M;
  }
  function box(w, h, d, mat) {
    const m = new THREE.Mesh(CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d), mat);
    m.castShadow = false; m.receiveShadow = false;
    return m;
  }
  function tagSprite(text, color, sx, sy) {
    if (!CBZ.makeLabelSprite) return null;
    const s = CBZ.makeLabelSprite(text, { color: color || "#cfe0f5" });
    s.scale.set(sx || 1.6, sy || 0.4, 1);
    return s;
  }

  // ---- build the office fixtures once per city ------------------------------
  // Geometry mirrors buildings.js's realtor furnishInterior frame EXACTLY so the
  // interactive cards line up over the decorative listings board, and the desks
  // sit where the furnished desks already are:
  //   IN = (door.nx, door.nz) inward unit; tangent = (-inz, inx).
  //   local origin = lot centre; back wall at IN*halfIn.
  function buildDisplays() {
    const b = S.b, m = mats();
    const door = b.door || {};
    const inx = door.nx || 0, inz = door.nz || 1;
    const tx = -inz, tz = inx;
    const W = b.w, D = b.d;
    const along = Math.abs(inx) > 0.5;            // door faces ±X → room spans Z
    const halfIn = (along ? W : D) / 2;           // door-wall → centre along IN
    const halfTan = (along ? D : W) / 2;          // half-width along the tangent

    const group = new THREE.Group();
    S.group = group;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    root.add(group);
    S.cx = S.lot.cx; S.cz = S.lot.cz;

    // helper: world point at (depth from door wall along IN, lat along tangent)
    function P(depth, lat) {
      const lx = inx * (-halfIn + depth) + tx * lat;
      const lz = inz * (-halfIn + depth) + tz * lat;
      return { x: S.lot.cx + lx, z: S.lot.cz + lz };
    }

    // ---- THE LISTINGS WALL — a gallery board on the back wall, hung with
    //      framed property cards. Sits at the same back-wall depth the
    //      decorative glow board occupies (2*halfIn - 2.6 from the door wall).
    const wd = Math.max(2.2, Math.min(2 * halfTan - 1.2, 3.4));   // board half-spans the back wall
    const wallP = P(2 * halfIn - WT - 0.12, 0);
    // backing board flush to the wall (thin along IN, wide along the tangent)
    const bw = Math.abs(tx) * wd + Math.abs(inx) * 0.1;
    const bd = Math.abs(tz) * wd + Math.abs(inz) * 0.1;
    const boardMesh = box(bw, 1.9, bd, m.board);
    boardMesh.position.set(wallP.x, 1.85, wallP.z);
    group.add(boardMesh);
    // a teal "KEYSTONE REALTY" header strip over the board (the trade accent)
    const hs = box(Math.abs(tx) * (wd + 0.1) + Math.abs(inx) * 0.06, 0.12,
                   Math.abs(tz) * (wd + 0.1) + Math.abs(inz) * 0.06, m.accent);
    hs.position.set(wallP.x + inx * 0.04, 2.86, wallP.z + inz * 0.04);
    group.add(hs);
    const head = tagSprite("KEYSTONE REALTY", "#7df0c4", 2.6, 0.5);
    if (head) { head.position.set(wallP.x + inx * 0.06, 3.02, wallP.z + inz * 0.06); group.add(head); }

    // framed listing cards laid out in a grid on the board. We hang up to
    // MAX_CARDS of the LIVE inventory (the rest browse in the [E] panel); the
    // cards re-label on a slow refresh so the wall tracks market price + SOLD.
    const cols = 3, cardW = (2 * wd - 0.4) / cols;
    const cardSlots = [];
    for (let i = 0; i < MAX_CARDS; i++) {
      const col = i % cols, rowi = (i / cols) | 0;
      const lat = (col - (cols - 1) / 2) * cardW;
      const y = 2.42 - rowi * 0.72;
      const cp = P(2 * halfIn - WT - 0.06, lat);
      // frame (thin slab on the wall)
      const fw = Math.abs(tx) * (cardW - 0.12) + Math.abs(inx) * 0.05;
      const fd = Math.abs(tz) * (cardW - 0.12) + Math.abs(inz) * 0.05;
      const frame = box(fw, 0.62, fd, m.frame);
      frame.position.set(cp.x, y, cp.z);
      group.add(frame);
      const lab = tagSprite("", "#cfe0f5", cardW - 0.16, 0.5);
      if (lab) { lab.position.set(cp.x + inx * 0.05, y, cp.z + inz * 0.05); lab.visible = false; group.add(lab); }
      cardSlots.push({ frame, lab, x: cp.x, z: cp.z, y });
    }
    S.wall = { x: wallP.x, z: wallP.z, y: 1.6, cards: cardSlots, labelT: 0 };

    // ---- A SCALE MODEL development on the centre table — pale towers under a
    //      glass case, the brokerage centrepiece (purely decorative flavour).
    const mt = P(halfIn, 0);
    const tbl = box(Math.abs(tx) * 1.8 + Math.abs(inx) * 1.0, 0.12, Math.abs(tz) * 1.8 + Math.abs(inz) * 1.0, m.wood);
    tbl.position.set(mt.x, 0.74, mt.z);
    group.add(tbl);
    for (let i = -1; i <= 1; i++) {
      const tp = { x: mt.x + tx * i * 0.5, z: mt.z + tz * i * 0.5 };
      const h = 0.5 + (i === 0 ? 0.45 : i === 1 ? 0.2 : 0.0);
      const tower = box(0.32, h, 0.32, m.model);
      tower.position.set(tp.x, 0.8 + h / 2, tp.z);
      group.add(tower);
    }
    const caseMesh = box(Math.abs(tx) * 1.7 + Math.abs(inx) * 0.95, 1.1, Math.abs(tz) * 1.7 + Math.abs(inz) * 0.95, m.glass);
    caseMesh.position.set(mt.x, 1.35, mt.z);
    group.add(caseMesh);

    // ---- TWO AGENT DESKS flanking the room (the [E] "talk to the agent"
    //      pre-approval points), at the same depth/tangent buildings.js placed
    //      the decorative desks (pt(6.0, ±(halfTan-1.9))).
    S.desks = [];
    for (const side of [-1, 1]) {
      const dp = P(6.0, side * (halfTan - 1.9));
      const desk = box(Math.abs(tx) * 0.8 + Math.abs(inx) * 1.4, 0.78,
                       Math.abs(tz) * 0.8 + Math.abs(inz) * 1.4, m.wood);
      desk.position.set(dp.x, 0.39, dp.z);
      group.add(desk);
      // a small teal monitor on the desk so it reads as a workstation
      const mon = box(Math.abs(tx) * 0.5 + Math.abs(inx) * 0.06, 0.34,
                      Math.abs(tz) * 0.5 + Math.abs(inz) * 0.06, m.accent);
      mon.position.set(dp.x - inx * 0.18, 0.95, dp.z - inz * 0.18);
      group.add(mon);
      S.desks.push({ x: dp.x, z: dp.z, y: 1.0 });
    }
  }

  // refresh the framed-card labels from the live Zillow inventory (slow tick —
  // market price breathes, listings sell). Homes first, then for-sale business.
  function refreshCards() {
    if (!S.wall || !CBZ.cityRealtyListings) return;
    let inv = [];
    try { inv = CBZ.cityRealtyListings({ commercial: true }) || []; } catch (e) { inv = []; }
    const cards = S.wall.cards;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i], rec = inv[i];
      if (!rec) { if (c.lab) c.lab.visible = false; continue; }
      const sold = rec.owned;
      // makeLabelSprite is single-line; pack name + price compactly on one line
      const oneLine = (rec.flagship ? "★ " : "") + shortName(rec.name) + " · " + (sold ? "OWNED" : fmt$(rec.price));
      if (c.lab) {
        const col = sold ? "#9be8b4" : rec.flagship ? "#ffd166" : "#cfe0f5";
        const ns = tagSprite(oneLine, col, 0, 0);
        if (ns) {
          // swap the sprite material on the existing sprite (cached → cheap)
          c.lab.material = ns.material;
          c.lab.visible = true;
        }
      }
    }
  }
  function shortName(n) { n = String(n || ""); return n.length > 18 ? n.slice(0, 17) + "…" : n; }

  // ---- the look-pick: are you reading the wall, or at a desk? ----------------
  function pick() {
    const P = CBZ.player; if (!P || !P.pos) return null;
    const b = S.b;
    // browse gate: only while you're inside the lot (small apron at the door)
    const minX = S.lot.cx - b.w / 2 - 1.5, maxX = S.lot.cx + b.w / 2 + 1.5;
    const minZ = S.lot.cz - b.d / 2 - 1.5, maxZ = S.lot.cz + b.d / 2 + 1.5;
    const px = P.pos.x, pz = P.pos.z;
    if (px < minX || px > maxX || pz < minZ || pz > maxZ) return null;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bestScore = -1;
    // the wall
    if (S.wall) {
      const dx = S.wall.x - px, dz = S.wall.z - pz, d = Math.hypot(dx, dz);
      if (d <= WALL_REACH && d > 0.05) {
        const dot = (dx / d) * fx + (dz / d) * fz;
        if (dot >= WALL_DOT) { const sc = dot - d * 0.05; if (sc > bestScore) { bestScore = sc; best = { type: "wall" }; } }
      }
    }
    // the desks
    for (const dk of S.desks) {
      const dx = dk.x - px, dz = dk.z - pz, d = Math.hypot(dx, dz);
      if (d > DESK_REACH || d < 0.05) continue;
      const dot = (dx / d) * fx + (dz / d) * fz;
      if (dot < DESK_DOT) continue;
      const sc = dot - d * 0.05 + 0.05;   // a small bias so a desk you're up against wins over the far wall
      if (sc > bestScore) { bestScore = sc; best = { type: "desk", desk: dk }; }
    }
    return best;
  }

  function promptText(p) {
    if (p.type === "wall")
      return "<b style='color:#7df0c4'>[E]</b> View listings <span style='color:#7f8794'>· buy or finance a home</span>";
    return "<b style='color:#7df0c4'>[E]</b> Talk to an agent <span style='color:#7f8794'>· get pre-approved</span>";
  }

  // ---- the floating [E] prompt (self-managed, gunstore pattern) -------------
  function promptEl() {
    if (S.prompt) return S.prompt;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "realtyPrompt";
    d.style.cssText = "position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:46;display:none;" +
      "background:rgba(13,16,21,.9);border:1px solid #3a4150;border-radius:12px;padding:7px 14px;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;font-size:15px;pointer-events:auto;cursor:pointer;text-align:center;max-width:78vw";
    d.addEventListener("click", function () { if (S.cur) actOn(S.cur); });   // tap-to-act (mobile)
    document.body.appendChild(d);
    S.prompt = d;
    return d;
  }
  function showPrompt(txt) {
    const el = promptEl(); if (!el) return;
    if (txt !== S.lastTxt) { el.innerHTML = txt; S.lastTxt = txt; }
    if (el.style.display !== "block") el.style.display = "block";
  }
  function hidePrompt() {
    if (S.prompt && S.prompt.style.display !== "none") S.prompt.style.display = "none";
    S.cur = null;
  }

  function actOn(p) {
    if (!p) return;
    if (p.type === "wall") { openPanel(); return; }
    if (p.type === "desk") { talkToAgent(); return; }
  }

  // ---- AGENT: a quick pre-approval read (consumes the bank loan engine via
  //      Zillow's financing quote on the priciest home you could finance). ----
  function talkToAgent() {
    if (!CBZ.cityRealtyListings) { note("The agent's between clients — try the wall.", 1.8); return; }
    const cash = (g.cash || 0) + (g.cityBank || 0);
    let inv = [];
    try { inv = CBZ.cityRealtyListings({}) || []; } catch (e) { inv = []; }
    // the best home you can actually CLOSE on cash today
    let topCash = null;
    for (const r of inv) if (r.canBuy && r.price <= cash && (!topCash || r.price > topCash.price)) topCash = r;
    // a representative financing quote (the dearest financeable home's terms)
    let q = null, qName = null;
    for (const r of inv) {
      if (!r.canFinance || !r.finance) continue;
      if (r.finance.approved === false) continue;
      if (!q || r.price > (q._price || 0)) { q = r.finance; q._price = r.price; qName = r.name; }
    }
    let msg;
    if (q) {
      const bankTail = (q.viaBank && q.payment > 0) ? ", about " + fmt$(Math.round(q.payment)) + "/cycle" : "";
      const ratePct = (Math.round((q.rate || 0.06) * 1000) / 10) + "%";
      msg = "Agent: pre-approved. " + ratePct + " on a mortgage — "
        + "as little as " + fmt$(q.down) + " down" + bankTail + " on " + shortName(qName) + ". "
        + (topCash ? "You could pay cash for the " + shortName(topCash.name) + " today." : "Read the wall and pick a place.");
    } else if (topCash) {
      msg = "Agent: \"" + fmt$(cash) + " on hand — you could buy the " + shortName(topCash.name) + " outright. Have a look at the wall.\"";
    } else {
      msg = "Agent: \"Save a deposit and we'll talk financing — 20% down opens most doors. The listings are on the wall.\"";
    }
    note(msg, 3.4);
    if (CBZ.sfx) CBZ.sfx("door");
  }

  // ==========================================================================
  //  THE LISTINGS PANEL — a focused buy/finance board (its OWN small overlay,
  //  NOT a duplicate of [Z]). Rows come from CBZ.cityRealtyListings; Buy routes
  //  to CBZ.cityZillow.buyByLot, Finance to CBZ.cityRealtyFinance — the same
  //  transact path the [Z] market and the realtor text menu use.
  // ==========================================================================
  const PAGE = 4;
  function panelEl() {
    if (S.panel) return S.panel;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "cityRealtyOffice";
    d.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:48;display:none;" +
      "min-width:380px;max-width:560px;background:rgba(16,20,26,.97);border:2px solid #2f5a4a;border-radius:16px;" +
      "padding:14px 18px;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.5);pointer-events:auto";
    d.addEventListener("click", function (e) {
      const t = e.target && e.target.closest ? e.target.closest("[data-ract]") : null;
      if (!t) return;
      const act = t.getAttribute("data-ract"), idx = parseInt(t.getAttribute("data-ridx"), 10);
      if (act === "close") { closePanel(); return; }
      if (act === "page") { S.page = Math.max(0, S.page + idx); renderPanel(); return; }
      if (act === "buy" || act === "finance" || act === "tour") doRow(act, idx);
    });
    document.body.appendChild(d);
    S.panel = d;
    return d;
  }
  function openPanel() {
    if (CBZ.cityMenuOpen) return;
    if (!CBZ.cityRealtyListings) { note("Listings aren't ready yet.", 1.6); return; }
    S.panelOpen = true; S.page = 0; CBZ.cityMenuOpen = true;
    hidePrompt();
    renderPanel();
    if (panelEl()) panelEl().style.display = "block";
    if (document.exitPointerLock) try { document.exitPointerLock(); } catch (e) {}
  }
  function closePanel() {
    S.panelOpen = false;
    if (S.panel) S.panel.style.display = "none";
    CBZ.cityMenuOpen = false;
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }

  function loadRows() {
    let inv = [];
    try { inv = CBZ.cityRealtyListings({ commercial: true }) || []; } catch (e) { inv = []; }
    // homes (the ladder) first, then for-sale commercial — the realtor's core
    inv.sort((a, b) => (a.listedHome === b.listedHome ? 0 : a.listedHome ? -1 : 1)
      || (a.tier - b.tier) || (a.price - b.price));
    S.rows = inv;
  }
  function renderPanel() {
    loadRows();
    S.actions = [];
    const cash = g.cash || 0, bank = g.cityBank || 0;
    const pages = Math.max(1, Math.ceil(S.rows.length / PAGE));
    S.page = Math.max(0, Math.min(pages - 1, S.page));
    const slice = S.rows.slice(S.page * PAGE, S.page * PAGE + PAGE);

    let html = "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:4px'>"
      + "<div style='font-size:19px;font-weight:700'>Keystone Realty — Listings</div>"
      + "<button data-ract='close' style='background:none;border:0;color:#9fb0c6;font-size:18px;cursor:pointer'>✕</button></div>";
    html += "<div style='font-size:12px;color:#8a93a3;margin-bottom:9px'>Cash " + fmt$(cash) + " · Bank " + fmt$(bank)
      + (g.cityHome ? " · Home: " + shortName(g.cityHome.name) : "") + "</div>";

    if (!slice.length) {
      html += "<div style='font-size:13px;color:#8a93a3;padding:10px 0'>Nothing on the market right now.</div>";
    }
    for (const rec of slice) {
      const tags = (rec.sqft ? rec.sqft.toLocaleString() + " sqft" : (rec.storeys || 1) + " fl")
        + (rec.flagship ? " · flagship" : "") + (rec.zone ? " · " + esc(rec.zone) : "");
      html += "<div style='padding:6px 0;border-top:1px solid #232a30'>"
        + "<div style='display:flex;justify-content:space-between;gap:10px'>"
        + "<span style='font-size:14px;font-weight:600'>" + (rec.flagship ? "" : "") + esc(rec.name) + "</span>"
        + "<span style='font-size:14px;color:#7df0c4'>" + fmt$(rec.value) + "</span></div>"
        + "<div style='font-size:11px;color:#8a93a3;margin:1px 0 4px'>" + esc(tags) + (rec.blurb ? " — " + esc(trim(rec.blurb)) : "") + "</div>"
        + "<div style='display:flex;flex-wrap:wrap;gap:6px;align-items:center'>";
      if (rec.owned) {
        html += "<span style='font-size:12px;color:#9be8b4'>" + (rec.isHome ? "Your home" : "Owned") + "</span>";
        S.actions.push({ act: "tour", rec });
        html += actBtn("tour", S.actions.length - 1, rec.isHome ? "Go home" : "Visit", "#3a4150");
      } else {
        const canCash = (cash + bank) >= rec.price;
        if (rec.canBuy) {
          S.actions.push({ act: "buy", rec });
          html += actBtn("buy", S.actions.length - 1, "Buy cash " + fmt$(rec.price), canCash ? "#2f6f4a" : "#3a4150");
        }
        // FINANCE — feature-detected: shown only when a quote exists AND the bank
        // didn't decline. The label carries the real down + per-cycle payment.
        const fq = rec.finance;
        if (rec.canFinance && fq && fq.approved !== false) {
          const tail = (fq.viaBank && fq.payment > 0) ? " (" + fmt$(Math.round(fq.payment)) + "/cyc)" : "";
          S.actions.push({ act: "finance", rec });
          html += actBtn("finance", S.actions.length - 1, "Finance " + fmt$(fq.down) + " down" + tail, "#395a8a");
        } else if (rec.canFinance && fq && fq.approved === false) {
          html += "<span style='font-size:11px;color:#ff9e90'>financing declined (" + esc(fq.reason || "—") + ")</span>";
        }
        S.actions.push({ act: "tour", rec });
        html += actBtn("tour", S.actions.length - 1, "Tour", "#3a4150");
      }
      html += "</div></div>";
    }

    if (pages > 1) {
      html += "<div style='margin-top:9px;font-size:12px;color:#9fb0c6;display:flex;gap:10px;align-items:center'>"
        + "<button data-ract='page' data-ridx='-1' style='" + pillCss() + "'>‹ Prev</button>"
        + "<span>Page " + (S.page + 1) + "/" + pages + " · " + S.rows.length + " listings</span>"
        + "<button data-ract='page' data-ridx='1' style='" + pillCss() + "'>Next ›</button></div>";
    }
    html += "<div style='font-size:11px;color:#6b7480;margin-top:9px'>[Esc] close · also on your phone at [Z]</div>";
    panelEl().innerHTML = html;
  }
  // teleport the player to a listing's front door so EVERY card is somewhere you
  // can actually go, walk through, and (once bought) respawn at. Owned → "go
  // home", unbought → "tour". Mirrors zillow.js's visit() (which is internal).
  function tourTo(rec) {
    const P = CBZ.player; if (!P || !P.pos) return;
    const b = rec.lot && rec.lot.building;
    const door = (b && b.door) || { x: rec.lot ? rec.lot.cx : 0, z: rec.lot ? rec.lot.cz : 0 };
    if (P.driving && CBZ.cityExitVehicle) CBZ.cityExitVehicle();
    P.pos.set(door.x, 0, door.z); P.vy = 0; P.grounded = true;
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
    if (CBZ.fullMap && CBZ.fullMap.setWaypoint) CBZ.fullMap.setWaypoint(door.x, door.z, rec.name);
    note((rec.owned ? "Home — " : "Touring ") + shortName(rec.name)
      + (rec.owned ? " (press H at the door for the safehouse menu)." : " — step through the door to look around."), 3.0);
    if (rec.flagship && CBZ.city && CBZ.city.big) CBZ.city.big("" + rec.name);
    if (CBZ.sfx) CBZ.sfx("door");
  }
  function actBtn(act, idx, label, bg) {
    return "<button data-ract='" + act + "' data-ridx='" + idx + "' style='background:" + bg + ";border:0;border-radius:8px;"
      + "padding:5px 10px;color:#eef4ff;font-family:inherit;font-size:12px;cursor:pointer'>" + esc(label) + "</button>";
  }
  function pillCss() { return "background:#243; border:1px solid #2f5a4a;border-radius:8px;padding:3px 9px;color:#cfe0f5;font-family:inherit;font-size:12px;cursor:pointer"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function trim(s) { s = String(s || ""); return s.length > 64 ? s.slice(0, 63) + "…" : s; }

  function doRow(act, idx) {
    const a = S.actions[idx]; if (!a) return;
    const rec = a.rec;
    if (act === "tour") {
      // "show me the place": walk the player to the listing's door + drop a
      // waypoint (mirrors Zillow's visit, which isn't exported). Close our panel
      // first so the menu flag clears and pointer-lock returns for walking.
      closePanel();
      tourTo(rec);
      return;
    }
    if (act === "buy") {
      if (!(CBZ.cityZillow && CBZ.cityZillow.buyByLot)) { note("Sales desk is offline — try the phone [Z].", 2); return; }
      const before = !!rec.owned;
      const ok = CBZ.cityZillow.buyByLot(rec.lot);   // charges, persists, registers, sets home
      if (ok && CBZ.cityZillow.setHomeByLot && rec.listedHome) CBZ.cityZillow.setHomeByLot(rec.lot);
      if (ok && !before && CBZ.sfx) CBZ.sfx("coin");
      renderPanel();
      return;
    }
    if (act === "finance") {
      if (!CBZ.cityRealtyFinance) {
        // no financing engine/market wired → honestly fall back to a cash buy
        if (CBZ.cityZillow && CBZ.cityZillow.buyByLot) CBZ.cityZillow.buyByLot(rec.lot);
        renderPanel();
        return;
      }
      const owned = CBZ.cityRealtyFinance(rec.id);   // 20% down + bank mortgage (or self-contained)
      if (owned && CBZ.cityZillow && CBZ.cityZillow.setHomeByLot && rec.listedHome) CBZ.cityZillow.setHomeByLot(rec.lot);
      renderPanel();
      return;
    }
  }

  // ---- find the lot + build once (gunstore self-healing pattern) ------------
  function ensure() {
    const arena = CBZ.city && CBZ.city.arena;
    if (S.built) {
      if (S.arena === arena) return true;
      // arena rebuilt (new run) → the old group died with the old root; reset.
      S.built = false; S.group = null; S.lot = null; S.b = null; S.wall = null; S.desks = []; S.cur = null;
      if (S.panelOpen) closePanel();
    }
    if (!arena) return false;
    if (S.noLotArena === arena) return false;          // this city has no realtor — answered once
    let lot = arena.realtor || null;
    if (!(lot && lot.building && lot.building.realtor)) {
      lot = null;
      const lots = arena.lots || [];
      for (let i = 0; i < lots.length; i++) { const L = lots[i]; if (L && L.building && L.building.realtor) { lot = L; break; } }
      if (!lot && lots.length) { S.noLotArena = arena; return false; }
    }
    if (!lot || !lot.building) return false;
    // need the building footprint to lay out fixtures
    if (lot.building.w == null || lot.building.d == null || !lot.building.door) { S.noLotArena = arena; return false; }
    S.lot = lot; S.b = lot.building; S.arena = arena;
    buildDisplays();
    refreshCards();
    S.built = true;
    return true;
  }

  // ---- per-frame -------------------------------------------------------------
  CBZ.onUpdate(38.2, function (dt) {
    if (!g || g.mode !== "city") { if (S.group && S.group.visible) S.group.visible = false; hidePrompt(); if (S.panelOpen) closePanel(); return; }
    if (!ensure()) return;
    const P = CBZ.player; if (!P || !P.pos) return;

    // distance VIS-GATE: the fixtures draw only when you're near the office
    const dx = P.pos.x - S.cx, dz = P.pos.z - S.cz;
    const near = (dx * dx + dz * dz) < VIS_R * VIS_R;
    if (S.group && S.group.visible !== near) S.group.visible = near;

    // slow card re-label (market price breathes, listings sell)
    if (near && S.wall) { S.wall.labelT -= dt; if (S.wall.labelT <= 0) { S.wall.labelT = 3.0; refreshCards(); } }

    if (S.panelOpen) { hidePrompt(); return; }   // panel owns the screen
    if (!near || g.state !== "playing" || P.dead || P.driving || CBZ.cityMenuOpen) { hidePrompt(); return; }

    const p = pick();
    if (!p) { hidePrompt(); return; }
    S.cur = p;
    showPrompt(promptText(p));
  });

  // [E] acts on what you're looking at. CAPTURE phase so the office wins the key
  // over interact.js's bubble listener; stopImmediatePropagation keeps one press
  // from ALSO opening the clerk's counter menu (the gunstore/jewelry pattern).
  addEventListener("keydown", function (e) {
    const k = (e.key || "").toLowerCase();
    // panel navigation (Esc closes; the panel grabs nothing else so other UI works)
    if (S.panelOpen) {
      if (k === "escape") { e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); closePanel(); }
      return;
    }
    if (!S.cur || !g || g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen || (CBZ.player && (CBZ.player.driving || CBZ.player.dead))) return;
    if (k !== "e") return;
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    e.stopPropagation();
    actOn(S.cur);
  }, true);

  // ---- public hooks (mirror cityGunWallLive / cityJewelryLot) ---------------
  // is the realty office live (for this lot)? interact.js / shops.js suppress the
  // generic "Talk to the realtor" counter verb when it is, so the wall + desks
  // are the in-world way to browse here.
  CBZ.cityRealtyLive = function (lot) { return !!(S.built && S.lot && (!lot || lot === S.lot)); };
  CBZ.cityRealtyLot = function () { return (S.built && S.lot) || null; };
  // headless/harness handle: open the listings board
  CBZ.cityRealtyOpen = function () { if (ensure()) { openPanel(); return true; } return false; };
  // headless/harness handle: buy a listing by Zillow id ("p7") through the desk.
  // Routes the cash purchase through Zillow (the single transact path).
  CBZ.cityRealtyBuy = function (id) {
    if (!ensure() || !CBZ.cityZillow || !CBZ.cityZillow.buy) return false;
    CBZ.cityZillow.buy(id, true);
    return CBZ.cityZillow.ownsLot && CBZ.cityZillow.listings
      ? (function () { const L = CBZ.cityZillow.listings() || []; const r = L.find((x) => x.id === id); return !!(r && CBZ.cityZillow.ownsLot(r.lot)); })()
      : false;
  };
})();
