/* ============================================================
   city/facades/manor.js — "English Manor": the Tudor / Jacobean country house.

   WHAT IS BEING MODELLED. The English house that has a NAME on the gatepost.
   Not a church and not a painted American villa — a rain-soaked stone-and-oak
   manor of about 1560-1620, grown rather than designed: a steep tiled roof,
   cross gables of unequal size stepping across the front, and chimney stacks
   so tall and so ornamental that they are the whole silhouette from a
   kilometre away. Everything in this file exists to serve that shape.

   WHY EACH ELEMENT IS HERE.
     STEEP ROOF    the identity. A gable roof is stepped boxes that keep their
                   length ALONG the ridge and shrink ACROSS it as they rise, so
                   no rotation is needed and the whole roof merges for free.
                   The pitch is solved from the plan's short axis (rise about
                   1.15 x run — a Tudor roof is nearly a wedge) and the eaves
                   OVERHANG the wall on all four sides, because a roof flush
                   with its wall reads as a lid on a box.
     CROSS GABLES  two or three subordinate gables of DIFFERENT heights across
                   the entrance front, each with raking bargeboards and a
                   half-timbered tympanum. Unequal heights are the point: it is
                   what makes the house look accreted instead of composed.
     CHIMNEYS      the thing you recognise. A clustered stack — two to four
                   shafts standing in a row on one corbelled base, each with
                   its own corbelled cap and pot — rising WELL clear of the
                   ridge (about half the pitch again), plus a LATERAL CHIMNEY
                   BREAST climbing one gable-end wall in two weathered stages
                   and carrying its own cluster past the apex. The breast is a
                   vertical member, so it may cross the host's window band
                   freely, and it is the single most English thing here.
     HALF-TIMBER   the upper storeys are oak framing over cream lime plaster:
                   close-set vertical STUDS (which cross the host glass band on
                   purpose — that is what turns a continuous ribbon into
                   separate lights), heavy corner posts, and a BRESSUMER beam
                   on corbel brackets at every floor line where the storey
                   jetties out over the one below.
     STONE BASE    the ground storey is coursed grey-brown stone (or Jacobean
                   brick with stone dressings, by hash): a battered plinth,
                   quoined corners, heavy piers between the window groups, and
                   a drip-moulded label over each group.
     BAY / ORIEL   a two-storey canted bay window, offset from the door and
                   capped by its own gable, on a stone apron. It is the only
                   element that breaks the wall plane at eye level.
     LEADED LIGHTS mullions and transoms: stone below, oak above, with a thin
                   muntin cross inside every light. These FRAME the host
                   building's own glass — they never cover it.
     PORCH         a stone-arched entrance under a timber-framed gable hood on
                   two cheek piers, with a low walk-on threshold.

   THE HOST'S WINDOWS ARE LEFT ALONE. The shell glazes one continuous band per
   storey (k*FH+0.55 .. (k+1)*FH-0.45), so the only solid wall it owns is a
   1.0 m ring at each floor line plus a 0.55 m jamb at each end of each face.
   Every horizontal run in this file — plaster bands, bressumers, string
   courses, wall plates, label moulds — lives inside those zones or is held
   clear of the wall as an overhang, and everything that crosses the glass is
   vertical (studs, mullions, piers, the chimney breast) or a thin muntin.
   Where a band must pass the doorway it is emitted in segments around it.

   SIZES. 11x9 one storey is a stone cottage with timbered gables, one stack
   and a hooded door; 14x11 two storeys is the house — jettied timber front,
   bay, two cross gables, two stacks; 22x16 four storeys is the mansion, with
   three gables, three stacks and a full range of dormers on the back slope.

   SPEC OPTIONS (all optional; {style:"manor"} alone is complete):
     roof:  "slate" | "tile"    — override the hash-picked roof covering.
     walls: "stone" | "brick"   — override the hash-picked ground-storey wall.

   MESH BUDGET: everything is ctx.dbox except the chimney pots (real cylinders,
   hard-capped at 6) and two apex finial balls. Well under the ~40 ceiling.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // A horizontal run on one face, interrupted by holes — lifted from stone.js.
  // You do not cut a hole in merged axis-aligned boxes; you decline to draw
  // over it. `inset` lets a jettied storey's bands sit proud of the wall below.
  function runBand(ctx, F, f, cy, h, proj, col, holes, over, inset) {
    const L = -f.span / 2 - (over == null ? 0.12 : over), R = -L;
    let x = L;
    const hs = (holes || []).slice().sort(function (a, b) { return a[0] - b[0]; });
    for (let i = 0; i < hs.length; i++) {
      const a = Math.max(L, hs[i][0]), b = Math.min(R, hs[i][1]);
      if (b <= x) continue;
      if (a - x > 0.05) F.box(ctx, f, (x + a) / 2, cy, a - x, h, proj, col, inset);
      x = b;
    }
    if (R - x > 0.05) F.box(ctx, f, (x + R) / 2, cy, R - x, h, proj, col, inset);
  }

  CBZ.registerFacade("manor", {
    label: "English Manor",
    crownsRoof: true,
    maxStoreys: 4,
    build: function (ctx, F, spec) {
      const W = ctx.w, D = ctx.d, FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0);
      const H = ctx.rTop;                       // top of the walls = eaves line
      const unit = Math.min(W, D);              // the house's own ruler
      const e = F.entrance(ctx);
      const ef = e.f;
      const faces = F.faces(ctx);

      // ============================================================
      //  1. PALETTE — rain-soaked stone, cream lime, near-black oak
      // ============================================================
      // Kept restrained: this house is grey-brown and wet, and mixing hard to
      // white would flatten the one thing it lives on, which is the shadow
      // between a dark timber and a pale panel.
      const base = (ctx.pal && ctx.pal.wall) || ctx.color;
      const brickWall = spec && spec.walls ? (spec.walls === "brick")
        : (ctx.hash(0x2b71) < 0.34);
      const STONE = brickWall ? F.shade(F.mix(0x8a4a37, base, 0.16), 0.86)
                              : F.shade(F.mix(base, 0x8b8377, 0.70), 0.94);
      const STONEL = F.mix(STONE, 0xd6cdba, brickWall ? 0.52 : 0.32);  // dressings
      const STONED = F.shade(STONE, 0.72);                             // joints
      const PLASTER = F.mix(0xe6dcc2, base, 0.14);                     // lime render
      const OAK = F.shade(F.mix(0x2b2118, base, 0.10), 0.82);          // near-black oak
      const clay = spec && spec.roof ? (spec.roof === "tile") : (ctx.hash(0x4d21) < 0.44);
      const ROOF = clay ? F.shade(F.mix(0x6d3b2a, base, 0.10), 0.80)
                        : F.shade(F.mix(0x3b4145, base, 0.10), 0.62);
      const ROOFL = F.mix(ROOF, clay ? 0xa2634a : 0x8b949b, 0.30);
      const ROOFD = F.shade(ROOF, 0.74);
      const BRICK = F.shade(F.mix(0x7d4736, base, 0.10), 0.90);        // the stacks
      const GLASS = F.mix(0x161e28, STONE, 0.10);
      const LEAD = F.mix(STONEL, 0x6a7176, 0.34);

      // ============================================================
      //  2. THE RULING NUMBERS — roof first, because it owns everything
      // ============================================================
      const PJ = clamp(unit * 0.026, 0.16, 0.40);          // base relief depth
      const jut = ST >= 2 ? clamp(unit * 0.030, 0.16, 0.40) : 0;   // jetty overhang
      const plaP = jut + PJ * 0.40;                        // plaster skin
      const timP = jut + PJ * 1.05;                        // studs, proud of it
      const tim0 = ST >= 2 ? FH : H;                       // foot of the timber work

      // The ridge always runs along the LONGER plan axis, so the pitch is
      // solved over the SHORT span and stays steep at every subject size.
      const ridgeX = (W >= D);
      const L = ridgeX ? W : D;                            // along the ridge
      const A = ridgeX ? D : W;                            // across the slope
      const pitchH = clamp(A * 0.58, FH * 1.05, FH * 2.3);
      // the eaves must clear the jettied storey below them, or the overhang
      // reads as a wall rather than as a roof.
      const eave = Math.max(clamp(A * 0.055, 0.34, 0.85), timP + 0.28);
      const verge = clamp(L * 0.028, 0.26, 0.62);          // bargeboard overhang
      const ridgeY = H + pitchH;
      const halfA = A / 2 + eave;                          // half-width at the eaves
      const bb = clamp(unit * 0.045, 0.20, 0.42);          // bargeboard thickness

      // A gable END is the face whose normal runs ALONG the ridge.
      function isEnd(f) { return ridgeX ? !f.horiz : f.horiz; }
      // roof-local emitter: (along, y, across) instead of (x, y, z)
      function rbox(al, y, ac, aL, h, aC, col) {
        if (ridgeX) ctx.dbox(al, y, ac, aL, h, aC, col);
        else ctx.dbox(ac, y, al, aC, h, aL, col);
      }
      function rxz(al, ac) { return ridgeX ? { x: al, z: ac } : { x: ac, z: al }; }
      // height of the roof edge over a gable-end face at tangent t
      function edgeY(t) { return H + pitchH * Math.max(0, 1 - Math.abs(t) / halfA); }

      // ============================================================
      //  3. THE COMPOSITION — solved before a single box is drawn
      // ============================================================
      // The porch, the bay and the cross gables all want the same stretch of
      // the entrance front, so their tangents are agreed here and the wall
      // dressing steps around them afterwards.
      const cheek = clamp(unit * 0.050, 0.42, 0.85);
      const porchHalf = e.gap / 2 + cheek;
      const doorHole = [-(porchHalf + 0.30), porchHalf + 0.30];
      const holes = {};                                    // per face: member keep-outs
      function addHole(s, t0, t1) { (holes[s] = holes[s] || []).push([t0, t1]); }

      // THE BAY: offset from the centred door, dropped outright if the front is
      // too short to hold a porch and a bay without them touching.
      let bay = null;
      {
        const bw = clamp(ef.span * 0.27, 1.9, ef.span * 0.32);
        const lo = porchHalf + bw / 2 + 0.30, hi = ef.span / 2 - bw / 2 - 0.35;
        if (hi >= lo) {
          const sg = ctx.hash(0x1f0b) < 0.5 ? -1 : 1;
          bay = { t: sg * clamp(ef.span * 0.28, lo, hi), w: bw,
            proj: clamp(unit * 0.085, 0.55, 1.35), gabled: false };
          addHole(ef.s, bay.t - bay.w / 2 - 0.10, bay.t + bay.w / 2 + 0.10);
        }
      }

      // THE CROSS GABLES live on a SLOPE face (a gable end already has one big
      // gable of its own). When the door is on a slope face that face gets
      // them; when the door is on a gable end, a hash-picked flank does.
      const slopes = faces.filter(function (f) { return !isEnd(f); });
      const frontIsEnd = isEnd(ef);
      const primary = frontIsEnd ? slopes[ctx.hash(0x27ab) < 0.5 ? 0 : 1] : ef;
      // compared by side index, not by reference: F.entrance mints its own face
      // object, so `slopes[0] === ef` is false even when they are the same wall.
      const secondary = (slopes[0].s === primary.s) ? slopes[1] : slopes[0];
      const HFR = [0.95, 0.70, 0.86, 0.62];                // the unequal heights
      const hph = (ctx.hash(0x33c7) * 4) | 0;
      const gables = [];
      {
        const f = primary, span = f.span;
        const cap = function (v) { return Math.min(v, span * 0.36); };
        const list = [];
        if (f.s === ctx.doorSide && bay) {
          const gw = cap(bay.w + clamp(unit * 0.06, 0.45, 1.0));
          list.push({ t: bay.t, w: gw, over: true });
          const mw = cap(bay.w * 0.84);
          list.push({ t: -bay.t, w: mw, over: false });
          // a third over the porch, only when the front is long enough that
          // the three do not touch. Two unequal gables beat three crowded ones.
          const cw = cap(porchHalf * 2 + 0.8);
          if (Math.abs(bay.t) > (gw + cw) / 2 + 0.35 && Math.abs(bay.t) > (mw + cw) / 2 + 0.35)
            list.push({ t: 0, w: cw, over: false });
        } else {
          const n = clamp(Math.round(span / 7.5), 1, 3);
          const gw = cap(clamp(span / (n + 0.7), 2.0, 6.4));
          if (n === 1) list.push({ t: (ctx.hash(0x06d3) < 0.5 ? -1 : 1) * span * 0.20, w: gw, over: false });
          else for (let i = 0; i < n; i++) list.push({ t: -span / 2 + span * (i + 0.5) / n, w: gw, over: false });
        }
        for (let i = 0; i < list.length; i++) {
          const g = list[i];
          g.f = f;
          g.h = Math.max(pitchH * 0.58, pitchH * HFR[(i + hph) % HFR.length]);
          g.proj = g.over ? Math.max(bay.proj + 0.16, eave + 0.24)
                          : eave + clamp(unit * 0.035, 0.22, 0.60);
          if (g.over && bay) bay.gabled = true;
          gables.push(g);
          // deliberately NO member keep-out under a gable: the wall below it is
          // ordinary wall and still wants its studs and its mullions.
        }
      }

      // THE LATERAL CHIMNEY BREAST: one gable-end wall, hash-picked side and
      // hash-picked tangent, off the gable's centre line so it does not fight
      // the king post in the tympanum.
      // Never the entrance front: a stack there would grow through the bay.
      const ends = faces.filter(isEnd);
      const endOpts = ends.filter(function (f) { return f.s !== ctx.doorSide; });
      const bList = endOpts.length ? endOpts : ends;
      const breast = {
        f: bList[bList.length > 1 && ctx.hash(0x0c4e) >= 0.5 ? 1 : 0],
        w: 0, t: 0, proj: clamp(unit * 0.050, 0.35, 0.95),
      };
      breast.w = clamp(breast.f.span * 0.19, 1.15, 3.0);
      breast.t = (ctx.hash(0x71a2) < 0.5 ? -1 : 1) * breast.f.span * 0.20;
      addHole(breast.f.s, breast.t - breast.w / 2 - 0.15, breast.t + breast.w / 2 + 0.15);

      // Bands only ever avoid the DOORWAY (they pass behind the bay and behind
      // the breast, both of which project further). Members avoid everything.
      function bandHoles(f, yLow) {
        return (f.s === ctx.doorSide && yLow < e.head + 0.05) ? [doorHole] : [];
      }
      function memberHoles(f, yLow) {
        return (holes[f.s] || []).concat(bandHoles(f, yLow));
      }
      function blocked(hl, t, wid) {
        for (let i = 0; i < hl.length; i++)
          if (t + wid / 2 > hl[i][0] && t - wid / 2 < hl[i][1]) return true;
        return false;
      }

      // ============================================================
      //  4. LEADED LIGHTS — mullions and transoms round the host glass
      // ============================================================
      // The host's continuous band per storey IS the mullioned window range of
      // a Tudor wall, so it is divided rather than covered: uprights across it,
      // one thin transom, and a muntin cross inside each light.
      function lights(f, k, pitch, mw, col, proj) {
        const y0 = k * FH + 0.55, y1 = (k + 1) * FH - 0.45;
        if (y1 - y0 < 0.6 || y1 > H + 0.01) return;
        const usable = f.span - 1.10;                      // the host's end jambs
        if (usable < 1.0) return;
        const n = Math.max(1, Math.round(usable / pitch));
        const step = usable / n;
        const hl = memberHoles(f, y0);
        const trY = y0 + (y1 - y0) * 0.58;                 // the transom line
        for (let i = 0; i <= n; i++) {
          const t = -usable / 2 + step * i;
          if (blocked(hl, t, mw)) continue;
          F.rib(ctx, f, t, y0 - 0.10, y1 + 0.10, mw, proj, col);
        }
        for (let i = 0; i < n; i++) {
          const t = -usable / 2 + step * (i + 0.5);
          if (blocked(hl, t, step)) continue;
          F.box(ctx, f, t, trY, step - mw, 0.10, proj * 0.82, col);            // transom
          F.rib(ctx, f, t, y0, trY, 0.07, proj * 0.70, col);                   // muntin
        }
      }

      // ============================================================
      //  5. THE STONE GROUND STOREY
      // ============================================================
      // A battered plinth, then the only two solid zones the host leaves on
      // this storey: the sill zone at the bottom and the header zone under the
      // floor line. Between them, piers and mullions cross the glass.
      F.ring(ctx, 0.19, 0.38, PJ * 1.40, STONED, 0.34);
      F.ring(ctx, 0.42, 0.14, PJ * 1.60, STONEL, 0.40);
      const gTop = Math.min(FH, H);
      for (const f of faces) {
        const n = F.bayCount(f, 3.3, 2, 8);
        const marg = clamp(f.span * 0.075, 0.55, 1.3);
        const bays = F.bays(f, n, marg);
        const lines = F.bayLines(f, n, marg);
        const pw = clamp(unit * 0.052, 0.36, 0.85);
        const hl = memberHoles(f, 0.55);
        // the header course under the floor line, in the header zone
        runBand(ctx, F, f, gTop - 0.26, 0.36, PJ * 1.15, STONE, bandHoles(f, gTop - 0.44), 0.16);
        runBand(ctx, F, f, gTop - 0.06, 0.14, PJ * 1.45, STONEL, bandHoles(f, gTop - 0.13), 0.24);
        // heavy piers between the window GROUPS — vertical, so they may cross
        // the glass, and crossing it is what makes the groups read as groups.
        for (const t of lines) {
          if (blocked(hl, t, pw)) continue;
          F.rib(ctx, f, t, 0.05, gTop - 0.20, pw, PJ * 1.25, STONE);
          F.box(ctx, f, t, gTop - 0.34, pw + 0.22, 0.20, PJ * 1.45, STONEL);   // pier cap
        }
        // per group: a stone sill on the plinth and a label mould over the head
        for (const b of bays) {
          if (blocked(hl, b.t, b.w * 0.6)) continue;
          F.box(ctx, f, b.t, 0.47, b.w * 0.92, 0.16, PJ * 1.70, STONEL);
          // the LABEL MOULD lives in the header zone and its returns come down
          // as short VERTICAL stubs — a drip drawn at the window head itself
          // would be a stone bar laid across the host's glass.
          const lw = b.w * 0.96;
          F.box(ctx, f, b.t, gTop - 0.36, lw, 0.18, PJ * 1.55, STONEL);        // drip
          for (const sg of [-1, 1])                                            // returns
            F.box(ctx, f, b.t + sg * lw / 2, gTop - 0.55, 0.20, 0.36, PJ * 1.45, STONEL);
        }
        lights(f, 0, clamp(unit * 0.16, 1.00, 1.75), clamp(unit * 0.016, 0.13, 0.22), STONEL, PJ * 1.10);
      }
      // QUOINS: alternating long/short dressed blocks up the stone storey.
      {
        const qh = clamp(FH * 0.28, 0.42, 0.95);
        const qw = clamp(unit * 0.075, 0.55, 1.5);
        const qTop = ST >= 2 ? gTop : H - 0.35;
        let y = 0.40, k = 0;
        while (y + qh < qTop) {
          F.corners(ctx, y + qh / 2, qh * 0.88, (k % 2) ? qw : qw * 0.60,
            PJ * 1.30, (k % 2) ? STONEL : F.shade(STONEL, 0.90));
          y += qh; k++;
        }
      }

      // ============================================================
      //  6. THE HALF-TIMBERED UPPER STOREYS
      // ============================================================
      // Cream plaster fills the whole 1.0 m solid ring at each floor line (the
      // header zone below it plus the sill zone above it are continuous, so one
      // band covers both), the bressumer beam lies on it, and close-set studs
      // run the full storey height across the glass between them.
      if (ST >= 2) {
        const studW = clamp(unit * 0.030, 0.17, 0.34);
        const sPitch = clamp(unit * 0.125, 0.85, 1.55);
        const postW = clamp(unit * 0.062, 0.44, 0.95);
        for (const f of faces) {
          // the plaster ground, floor line by floor line
          for (let k = 1; k <= ST; k++) {
            const y = k * FH;
            const lo = Math.max(tim0, y - 0.44), hi = Math.min(H - 0.02, y + 0.52);
            if (hi - lo < 0.2) continue;
            runBand(ctx, F, f, (lo + hi) / 2, hi - lo, plaP, PLASTER, bandHoles(f, lo), 0.14);
          }
          // the plaster also owns the host's solid END JAMBS, full height, so
          // the corners are cream all the way up under the oak posts.
          for (const sg of [-1, 1])
            F.rib(ctx, f, sg * (f.span / 2 - 0.30), tim0, H - 0.04, 0.52, plaP, PLASTER);
          // BRESSUMER at every floor line, plus the sill plate over it
          for (let k = 1; k < ST; k++) {
            const y = k * FH;
            runBand(ctx, F, f, y - 0.04, 0.34, timP, OAK, bandHoles(f, y - 0.21), 0.16);
            runBand(ctx, F, f, y + 0.42, 0.16, timP * 0.88, OAK, bandHoles(f, y + 0.34), 0.12);
          }
          // WALL PLATE under the eaves — the beam the roof sits on
          runBand(ctx, F, f, H - 0.20, 0.30, timP, OAK, [], 0.18);
          // the STUDS. Vertical, so the glass band may be crossed freely.
          const usable = f.span - 0.9;
          const ns = Math.max(2, Math.round(usable / sPitch));
          const hl = memberHoles(f, tim0 + 0.6);
          for (let i = 0; i <= ns; i++) {
            const t = -usable / 2 + (usable / ns) * i;
            if (blocked(hl, t, studW)) continue;
            F.rib(ctx, f, t, tim0 + 0.02, H - 0.06, studW, timP, OAK);
            // corbel bracket under the jetty: three blocks growing outward
            if (jut > 0.01) for (let j = 0; j < 3; j++) {
              const u = (j + 1) / 3;
              F.box(ctx, f, t, tim0 - 0.62 + j * 0.22, studW * 1.1, 0.24, timP * u, OAK);
            }
          }
          // leaded lights between the studs, one storey at a time
          for (let k = 1; k < ST; k++)
            lights(f, k, sPitch, clamp(studW * 0.55, 0.10, 0.20), OAK, timP + 0.05);
        }
        // heavy OAK CORNER POSTS, the frame's real structure
        F.corners(ctx, (tim0 + H) / 2, H - tim0 - 0.04, postW, timP + 0.06, OAK);
      }

      // ============================================================
      //  7. THE BAY / ORIEL — canted, two storeys, on a stone apron
      // ============================================================
      if (bay) {
        const f = ef, OP = bay.proj;
        const y0 = 0.38;
        const y1 = Math.min(H - 0.14, FH * Math.min(ST, 2) - 0.25);
        const cw = bay.w * 0.54, rw = bay.w * 0.23;
        const facets = [
          { t: 0, w: cw, p: OP },
          { t: -(cw + rw) / 2, w: rw, p: OP * 0.62 },
          { t: (cw + rw) / 2, w: rw, p: OP * 0.62 },
        ];
        for (const c of facets) {
          const tt = bay.t + c.t;
          // apron, wall and coping of the facet
          F.box(ctx, f, tt, y0 - 0.16, c.w + 0.18, 0.34, c.p * 1.04, STONED);
          F.rib(ctx, f, tt, y0, y1, c.w, c.p, ST >= 2 ? PLASTER : STONE);
          for (const sg of [-1, 1])                       // the angle posts
            F.rib(ctx, f, tt + sg * (c.w / 2 - 0.09), y0, y1, 0.20, c.p + 0.05,
              ST >= 2 ? OAK : STONEL);
          // glazing, storey by storey, lined up with the host's own bands
          for (let k = 0; k * FH < y1 - 0.8; k++) {
            const gy0 = k * FH + 0.50, gy1 = Math.min(y1 - 0.30, (k + 1) * FH - 0.42);
            if (gy1 - gy0 < 0.5) break;
            const col = (k === 0 && ST >= 2) ? STONEL : (ST >= 2 ? OAK : STONEL);
            F.box(ctx, f, tt, (gy0 + gy1) / 2, c.w * 0.80, gy1 - gy0, c.p + 0.06, GLASS);
            const nm = Math.max(1, Math.round(c.w / clamp(unit * 0.10, 0.55, 0.95)));
            for (let i = 0; i <= nm; i++)
              F.rib(ctx, f, tt - c.w * 0.40 + (c.w * 0.80 / nm) * i, gy0, gy1, 0.11, c.p + 0.12, col);
            F.box(ctx, f, tt, gy0 + (gy1 - gy0) * 0.58, c.w * 0.80, 0.09, c.p + 0.11, col);
            F.box(ctx, f, tt, gy0 - 0.13, c.w + 0.22, 0.17, c.p + 0.16, STONEL);   // sill
            F.box(ctx, f, tt, gy1 + 0.14, c.w + 0.14, 0.16, c.p + 0.14, STONEL);   // head
          }
          // the moulded cap; when no cross gable stands over the bay it gets a
          // little lead-roofed gablet of its own so it still terminates.
          F.box(ctx, f, tt, y1 + 0.12, c.w + 0.26, 0.22, c.p + 0.18, STONEL);
          F.box(ctx, f, tt, y1 + 0.30, c.w + 0.12, 0.16, c.p + 0.08, STONED);
          if (!bay.gabled) {
            for (let j = 0; j < 4; j++) {
              const u = (j + 0.5) / 4;
              F.box(ctx, f, tt, y1 + 0.42 + u * clamp(bay.w * 0.30, 0.5, 1.3),
                (c.w + 0.10) * (1 - u * 0.86), clamp(bay.w * 0.30, 0.5, 1.3) / 4 + 0.03,
                c.p * (1 - u * 0.25), j === 1 ? ROOFL : ROOF);
            }
          }
        }
      }

      // ============================================================
      //  8. THE PORCH and the threshold
      // ============================================================
      {
        const f = ef;
        const pProj = clamp(unit * 0.090, 0.70, 1.50);
        // CHEEK PIERS. They stand OUTSIDE the door gap, so they may run the
        // full height; nothing here reaches into the opening.
        const pierTop = Math.min(H - 0.12, e.head + 0.60);
        for (const sg of [-1, 1]) {
          const t = sg * (e.gap / 2 + cheek / 2);
          F.rib(ctx, f, t, 0.10, pierTop, cheek, pProj, STONE);
          F.box(ctx, f, t, pierTop + 0.10, cheek + 0.26, 0.20, pProj + 0.10, STONEL);
        }
        // the door surround: jambs each side of the opening and, when the wall
        // is tall enough, a stone arch and a timber-framed gable hood ABOVE
        // e.head. On a one-storey cottage e.head (3.6) is already over the
        // eaves, so the doorway is left entirely clear and the gable in the
        // roof above does the work instead.
        for (const sg of [-1, 1])
          F.rib(ctx, f, sg * (e.gap / 2 + cheek * 0.16), 0.10, Math.min(pierTop, e.head + 0.10),
            0.26, pProj + 0.06, STONEL);
        const pTop = e.head + 0.35;
        if (H - 0.25 > pTop + 0.30) {
          const rise = clamp(e.gap * 0.34, 0.5, 1.2);
          F.arch(ctx, f, 0, pTop, e.gap + cheek * 0.9, rise, 0.20, pProj + 0.10, STONEL, "pointed");
          // the gable hood: stepped courses to an apex, oak barge boards on it
          const gh = clamp(pitchH * 0.34, 0.9, 2.3);
          const top = Math.min(pTop + rise + gh, H + pitchH * 0.30);
          const gy0 = pTop + rise * 0.9;
          const gw = e.gap + cheek * 2.2;
          const steps = 6;
          for (let i = 0; i < steps; i++) {
            const u0 = i / steps, u1 = (i + 1) / steps;
            const wid = gw * (1 - u1 * 0.90);
            const cy = gy0 + (top - gy0) * (u0 + u1) / 2;
            F.box(ctx, f, 0, cy, wid, (top - gy0) / steps + 0.03, pProj + 0.42, ROOF, -0.30);
            F.box(ctx, f, 0, cy, Math.max(0.2, wid - bb * 1.6), (top - gy0) / steps + 0.02,
              0.14, PLASTER, pProj + 0.12);
            for (const sg of [-1, 1])
              F.box(ctx, f, sg * (wid / 2 + bb * 0.35), cy, bb * 1.5,
                (top - gy0) / steps + 0.04, 0.28, OAK, pProj + 0.10);
          }
          F.rib(ctx, f, 0, gy0, top - 0.20, clamp(gw * 0.07, 0.16, 0.30), 0.14, OAK, pProj + 0.16);
        }
        // THE THRESHOLD: two rises of 0.30 and 0.15, both well under physics
        // STEP_UP (0.45), registered as walk platforms with no collider so the
        // house's own front door can never be sealed by its own porch.
        if (!e.driveIn) {
          const TOP = 0.30;
          const dep = clamp(pProj + 0.55, 1.0, 2.0);
          const wid = Math.min(f.span - 0.6, e.gap + cheek * 2 + 0.9);
          const hn = f.halfN;
          for (let s = 0; s < 2; s++) {
            const h = TOP - s * 0.15, o = hn + (s ? dep : 0), dd = s ? dep * 0.55 : dep;
            const ww = wid - s * 0.5;
            if (f.horiz) {
              ctx.dbox(0, h / 2, f.out * (o + dd / 2), ww, h, dd, s ? STONED : STONEL);
              ctx.plat(-ww / 2, ww / 2, f.out > 0 ? o : -(o + dd), f.out > 0 ? o + dd : -o, h, null);
            } else {
              ctx.dbox(f.out * (o + dd / 2), h / 2, 0, dd, h, ww, s ? STONED : STONEL);
              ctx.plat(f.out > 0 ? o : -(o + dd), f.out > 0 ? o + dd : -o, -ww / 2, ww / 2, h, null);
            }
          }
        }
      }

      // ============================================================
      //  9. THE ROOF — a steep gable of stepped courses
      // ============================================================
      // Constant length along the ridge, shrinking across it. Nothing rotates:
      // the step size IS the pitch, and 15 courses is enough that the stagger
      // reads as tile lap from the street.
      const NC = 15;
      const lenFull = L + verge * 2;
      for (let i = 0; i < NC; i++) {
        const u0 = i / NC, u1 = (i + 1) / NC;
        const ac = Math.max(0.30, (A + eave * 2) * (1 - u1));
        const col = (i % 3 === 1) ? ROOFL : ((i % 3 === 2) ? ROOFD : ROOF);
        rbox(0, H + pitchH * (u0 + u1) / 2, 0, lenFull, pitchH / NC + 0.02, ac, col);
        if (i % 2 === 0)                                   // the lap line
          rbox(0, H + pitchH * u0 + 0.05, 0, lenFull + 0.06, 0.07,
            Math.max(0.34, (A + eave * 2) * (1 - u0)) + 0.07, ROOFD);
      }
      // RIDGE: a capping course and a run of ridge tiles along it
      rbox(0, ridgeY + 0.11, 0, lenFull * 0.99, 0.22, 0.58, ROOFL);
      {
        const nt = clamp(Math.round(L / clamp(unit * 0.10, 0.55, 0.95)), 6, 46);
        for (let i = 0; i < nt; i++)
          rbox(-L / 2 + (L / nt) * (i + 0.5), ridgeY + 0.30, 0, (L / nt) * 0.62, 0.16, 0.34, ROOFD);
      }
      // EAVES: an oak fascia hung on the outer edge of the overhang, with the
      // rafter feet showing under it. Held clear of the wall, per the rule.
      for (const f of faces) {
        if (isEnd(f)) continue;
        F.box(ctx, f, 0, H + 0.10, f.span + eave * 2, 0.28, 0.18, OAK, eave - 0.18);
        const nr = clamp(Math.round(f.span / clamp(unit * 0.105, 0.60, 1.10)), 4, 40);
        for (let i = 0; i < nr; i++)
          F.box(ctx, f, -f.span / 2 + (f.span / nr) * (i + 0.5), H - 0.08,
            clamp((f.span / nr) * 0.30, 0.10, 0.24), 0.18, eave * 0.92, OAK);
      }

      // ============================================================
      //  10. THE GABLE ENDS — plaster tympanum, barge boards, finial
      // ============================================================
      for (const f of faces) {
        if (!isEnd(f)) continue;
        const GC = 10;
        for (let i = 0; i < GC; i++) {
          const u0 = i / GC, u1 = (i + 1) / GC;
          const wid = halfA * 2 * (1 - u1);
          const cy = H + pitchH * (u0 + u1) / 2;
          const hh = pitchH / GC + 0.03;
          // the panel sits just OUTSIDE the roof mass (which overhangs by
          // verge) or it would be invisible inside it.
          if (wid > bb * 2.4)
            F.box(ctx, f, 0, cy, wid - bb * 2.0, hh - 0.01, 0.14, PLASTER, verge + 0.01);
          for (const sg of [-1, 1])
            F.box(ctx, f, sg * (wid / 2 + bb * 0.35), cy, bb * 1.6, hh, 0.34, OAK, verge + 0.01);
        }
        // the framing on the tympanum: king post, two studs, a collar, and two
        // raking braces converging on the apex — the classic gable pattern.
        const tw = clamp(unit * 0.048, 0.20, 0.40);
        const pOff = verge + 0.13;
        for (const t of [0, -halfA * 0.34, halfA * 0.34]) {
          const top = edgeY(Math.abs(t) + tw * 0.8) - 0.14;
          if (top > H + 0.35) F.rib(ctx, f, t, H + 0.04, top, tw, 0.16, OAK, pOff);
        }
        const cyR = H + pitchH * 0.42;
        const wR = Math.max(0.4, halfA * 2 * 0.58 - tw * 1.4);
        F.box(ctx, f, 0, cyR, wR, tw * 0.9, 0.16, OAK, pOff);
        for (let j = 0; j < 6; j++) {
          const u = (j + 0.5) / 6;
          for (const sg of [-1, 1])
            F.box(ctx, f, sg * (wR / 2) * (1 - u), cyR + (pitchH * 0.92 - pitchH * 0.42) * u,
              tw * 1.5, (pitchH * 0.50) / 6 + 0.04, 0.15, OAK, pOff);
        }
        // apex finial: a stepped oak spike over the barge boards
        const apex = edgeY(0);
        F.box(ctx, f, 0, apex + 0.18, tw * 1.5, 0.36, 0.34, OAK, verge - 0.02);
        F.box(ctx, f, 0, apex + 0.52, tw * 0.8, 0.44, 0.24, OAK, verge + 0.02);
      }

      // ============================================================
      //  11. THE CROSS GABLES — unequal, stepping across the front
      // ============================================================
      for (const g of gables) {
        const f = g.f;
        const dep = clamp(A * 0.24, 0.65, 2.40);           // buried into the roof
        const steps = 8;
        for (let i = 0; i < steps; i++) {
          const u0 = i / steps, u1 = (i + 1) / steps;
          const wid = g.w * (1 - u1 * 0.92);
          const cy = H + g.h * (u0 + u1) / 2;
          const hh = g.h / steps + 0.03;
          // The wing's own roof: the mass loses DEPTH as it rises as well as
          // width, so from an oblique angle it reads as a pitched cross wing
          // and not as a box shoved through the slope. Near the apex what is
          // left is the wing's ridge running back into the main roof.
          const back = dep * (1 - u1 * 0.62);
          F.box(ctx, f, g.t, cy, wid, hh, g.proj + back, ROOF, -back);
          if (wid > bb * 2.4)
            F.box(ctx, f, g.t, cy, wid - bb * 2.0, hh - 0.01, 0.13, PLASTER, g.proj + 0.01);
          for (const sg of [-1, 1])
            F.box(ctx, f, g.t + sg * (wid / 2 + bb * 0.32), cy, bb * 1.5, hh, 0.30, OAK, g.proj + 0.01);
        }
        // king post + collar on the small tympanum, so the gables match the
        // big ends instead of reading as blank cards.
        const tw = clamp(g.w * 0.075, 0.16, 0.32);
        F.rib(ctx, f, g.t, H + 0.05, H + g.h * 0.82, tw, 0.14, OAK, g.proj + 0.14);
        F.box(ctx, f, g.t, H + g.h * 0.42, g.w * 0.52, tw * 0.9, 0.14, OAK, g.proj + 0.14);
        // the gable's own eaves return, and — where it stands over the bay —
        // the bressumer that gathers the projection back to the wall.
        F.box(ctx, f, g.t, H + 0.06, g.w + 0.20, 0.26, 0.20, OAK, g.proj - 0.02);
        if (g.over && bay) {
          F.box(ctx, f, g.t, H - 0.16, g.w, 0.30, bay.proj + 0.14, OAK);
        }
      }

      // ============================================================
      //  12. DORMERS — on the slope the cross gables did not take
      // ============================================================
      // Two numbers make a dormer sit in a roof instead of floating over it or
      // sinking into it, and on a pitch this steep both matter. The front plane
      // comes from the roof's across-width at the dormer's FOOT (from its head,
      // as a shallower roof can get away with, the whole lower half would be
      // swallowed); the depth is the dormer's own rise divided by the slope, so
      // the back of it always reaches the tiles at its head. It is emitted in
      // roof coordinates because that front plane is usually INBOARD of the
      // wall face, and F.box can only measure outward from the wall.
      {
        const f = secondary;
        const nd = clamp(Math.round(f.span / clamp(unit * 0.42, 4.0, 6.5)), 1, 4);
        const dh = clamp(pitchH * 0.34, 1.0, 2.4);
        const dy = H + pitchH * 0.06;
        const out = (A / 2 + eave) * (1 - 0.06) + clamp(unit * 0.030, 0.22, 0.45);
        const dep = dh * (A / 2 + eave) / pitchH + 0.55;
        const use = f.span * 0.84;
        const dw = clamp(use / (nd * 2.1), 0.85, 2.2);
        const ck = clamp(dw * 0.16, 0.14, 0.32);
        const sg = f.out;
        for (let i = 0; i < nd; i++) {
          const t = -use / 2 + (use / nd) * (i + 0.5);
          const put = function (cy, len, h, dd, off, col) {
            rbox(t, cy, sg * (out + (off || 0) - dd / 2), len, h, dd, col);
          };
          put(dy + dh / 2, dw + ck * 2, dh, dep, 0, PLASTER);                    // body
          for (const s2 of [-1, 1])
            rbox(t + s2 * (dw / 2 + ck / 2), dy + dh / 2, sg * (out - dep / 2), ck, dh, dep, OAK);
          put(dy + dh * 0.52, dw * 0.84, dh * 0.60, 0.12, 0.05, GLASS);          // sash
          rbox(t, dy + dh * 0.52, sg * (out + 0.05), 0.10, dh * 0.64, 0.14, OAK);
          put(dy + dh * 0.52, dw * 0.84, 0.09, 0.14, 0.06, OAK);                 // transom
          put(dy + dh * 0.14, dw + ck * 3.2, 0.16, 0.30, 0.10, STONEL);          // sill
          const hh = clamp(dh * 0.42, 0.4, 1.1);
          for (let j = 0; j < 4; j++) {                                          // gable head
            const u = (j + 0.5) / 4;
            // each course of the little gable is that much higher up the main
            // slope, so it has to reach that much further back to land on it
            put(dy + dh + 0.06 + u * hh, (dw + ck * 2) * (1 - u * 0.88), hh / 4 + 0.03,
              dep + u * hh * (A / 2 + eave) / pitchH, 0.02, j === 1 ? ROOFL : ROOF);
          }
        }
      }

      // ============================================================
      //  13. THE CHIMNEYS — the thing you see from a kilometre
      // ============================================================
      let pots = 6;                                        // real cylinders, capped
      function pot(x, y, z, r, col) {
        if (pots > 0) { pots--; ctx.column(x, y, z, r, r * 3.0, col, 8); }
        else ctx.dbox(x, y + r * 1.5, z, r * 1.7, r * 3.0, r * 1.7, col);
      }
      // A clustered stack: a corbelled base, two to four shafts of unequal
      // height standing in a row, each with its own corbelled cap and pot.
      function cluster(al, ac, bw, bd, footY, headY, stH) {
        rbox(al, (footY + headY) / 2, ac, bw, headY - footY, bd, BRICK);
        rbox(al, headY - 0.20, ac, bw + 0.20, 0.22, bd + 0.20, STONEL);     // weathering
        const nSh = clamp(Math.round(bw / clamp(unit * 0.085, 0.55, 1.10)), 2, 4);
        const sw = (bw / nSh) * 0.76, sd = bd * 0.78;
        for (let i = 0; i < nSh; i++) {
          const t = al - bw / 2 + (bw / nSh) * (i + 0.5);
          const sh = stH * ((i % 2) ? 0.82 : 1.0);
          rbox(t, headY + sh / 2, ac, sw, sh, sd, BRICK);
          rbox(t, headY + sh * 0.46, ac, sw + 0.10, 0.14, sd + 0.10, F.shade(BRICK, 1.12));
          for (let j = 0; j < 3; j++)                                        // corbelled cap
            rbox(t, headY + sh + 0.10 + j * 0.16, ac, sw + 0.14 + j * 0.16, 0.16,
              sd + 0.14 + j * 0.16, j === 1 ? STONEL : F.shade(STONEL, 0.90));
          const p = rxz(t, ac);
          pot(p.x, headY + sh + 0.56, p.z, Math.max(0.13, sw * 0.26), F.shade(BRICK, 1.06));
        }
      }
      // RIDGE STACKS, one per ~9.5 m of ridge, kept off the slab centre so the
      // roof's own gameplay furniture still has its middle.
      {
        const nSt = clamp(Math.round(L / 9.5), 1, 3);
        const at = [-0.30, 0.32, 0.07];
        const bw = clamp(A * 0.21, 1.15, 3.0), bd = clamp(A * 0.105, 0.72, 1.55);
        const stH = clamp(pitchH * 0.55, 1.7, FH * 1.7);
        for (let i = 0; i < nSt; i++)
          cluster(at[i] * L, 0, bw, bd, ridgeY - pitchH * 0.40, ridgeY + 0.30, stH);
      }
      // THE LATERAL BREAST: two weathered stages up a gable-end wall, then a
      // cluster clearing the roof edge at its own tangent.
      {
        const f = breast.f, bp = breast.proj, t = breast.t, bw = breast.w;
        // the stage change lands on a FLOOR LINE, where a real breast steps
        // back, and where the host's wall is solid anyway.
        const mid = ST >= 2 ? Math.max(1, Math.round(ST * 0.55)) * FH - 0.18 : H * 0.55;
        F.rib(ctx, f, t, 0.0, mid, bw, bp, STONE);
        F.rib(ctx, f, t, mid, H + 0.10, bw * 0.86, bp * 0.74, STONE);
        for (let j = 0; j < 3; j++)                          // the weathering offset
          F.box(ctx, f, t, mid + j * 0.14, bw - j * 0.12, 0.16, bp * (1 - j * 0.09), STONEL);
        F.box(ctx, f, t, 0.30, bw + 0.30, 0.50, bp + 0.14, STONED);        // its own plinth
        const eY = edgeY(Math.abs(t) + bw / 2);
        const topY = eY + clamp(pitchH * 0.34, 1.2, 3.2);
        const sw = bw * 0.42;
        for (const sg of [-1, 1]) {
          const st = t + sg * bw * 0.24;
          const ty = topY - (sg < 0 ? 0 : clamp(pitchH * 0.10, 0.3, 0.8));
          F.rib(ctx, f, st, H - 0.30, ty, sw, bp * 0.74 + 0.40, BRICK, -0.40);
          for (let j = 0; j < 3; j++)
            F.box(ctx, f, st, ty + 0.10 + j * 0.16, sw + 0.14 + j * 0.16, 0.16,
              bp * 0.74 + 0.55 + j * 0.16, j === 1 ? STONEL : F.shade(STONEL, 0.90), -0.45);
          const n = f.halfN + (bp * 0.74 - 0.40) / 2;      // the shaft's own centre
          const px = f.horiz ? st : f.out * n, pz = f.horiz ? f.out * n : st;
          pot(px, ty + 0.56, pz, Math.max(0.13, sw * 0.26), F.shade(BRICK, 1.06));
        }
      }
    },
  });
})();
