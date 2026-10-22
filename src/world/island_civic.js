/* ============================================================
   world/island_civic.js — THE TOWN HALL AND THE ARMY RECRUITING OFFICE.

   THE TOWN HALL (b.use "cityhall": the greek-revival civic building on the
   square, world/island_plan.js). Owner: "where the politicians are, and
   it's a pretty building. Doesn't need to have much purpose." So it is a
   pretty building with the people in it:
     GROUND FLOOR  the hall: a marble floor laid in squares with an inlaid
                   centre, four columns round it, the island's flags at the
                   foot of the stair, the public counter across the back with
                   its glass screens and the clerks behind it, benches for
                   the people waiting, the seal over it all, a directory
                   board by the stair. A guard at the door: walk in with a
                   gun out and he runs the demand ladder's "security" case on
                   you (CBZ.brain.demand): step back, hands where he can see
                   them, and when it gets that far he calls it in (city/ladder.js
                   carries the case on him, the way the city's guards do).
     FIRST FLOOR   the council chamber: a panelled back wall with the seal,
                   the dais and the long council bench on it with the
                   councillors' chairs, the lectern facing it, the public
                   rows behind.
     SECOND FLOOR  the mayor's office: an anteroom off the stair with his
                   secretary's desk; through the partition his office, a
                   walnut desk under the flags, his chair, two for visitors,
                   the credenza, a sitting corner, the books, the plants.
   The mayor, four councillors, two clerks and the secretary keep office
   hours (in through the day, gone at night); the door is guarded day and
   night. They are the island's own people (CBZ.islandVenue.staff), each
   with a name that is the island's (the same names on every visit).

   THE ARMY RECRUITING OFFICE (b.use "recruit"). A small office: the
   sergeant's desk facing the door, two chairs in front of it, the posters
   on the walls (real recruiting posters: the service, its badge, its
   colours; nothing that talks to the player), the flag, a bench, a
   filing cabinet. The recruiter sergeant at the desk through the day.
     [E] Enlist (the desk)  the decision. You are a Private in the islands'
         army: the uniform goes on (city/outfits.js "soldier"), a service
         rifle and two magazines are issued, and you have a commanding
         officer at the muster point on the quay. Your first order is to
         report to him there (CBZ.command.toPlayer, "go"); every morning
         after that he holds a muster (07:00-10:00) and orders you to it.
         Make it: you are paid. Miss it: it is held against you; three and
         you are out of the army. Rank comes with the musters you make.
     g.isleArmy = { rank, island, musters, strikes, lastDay, since }

   THE MOTOR POOL. An island with a recruiting office has its army's trucks
   at the muster point: a Humvee and a JLTV nose-in in two free bays of the
   quay's car park, beside the lieutenant. They are NPC War's own units
   (units/vehicles/hmmwv.js, jltv.js, through city/unitmodels.js: the same
   M1151 and JLTV Fort Brandt parks), solid, crew out. Their files load when
   the island comes up; two hulls, shared geometry and materials per type.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  if (!window.THREE) return;
  const g = CBZ.game || (CBZ.game = {});

  const FIRST = ["Margaret", "Desmond", "Clive", "Winifred", "Errol", "Beatrice", "Lionel", "Patricia", "Hector", "Grace",
    "Neville", "Ursula", "Rupert", "Delia", "Cedric", "Maxine", "Ambrose", "Juliet", "Horace", "Ivy"];
  const LAST = ["Abernathy", "Baptiste", "Caldwell", "Duncombe", "Ellery", "Fontaine", "Greaves", "Holloway", "Ingram", "Joseph",
    "Kingsley", "Lascelles", "Mortimer", "Nightingale", "Oduya", "Pemberton", "Quarrie", "Rattray", "Sinclair", "Thorne"];
  function h(s) { return CBZ.islandFit ? CBZ.islandFit.hash(s) : 0.5; }
  function nameOf(seed) { return FIRST[(h(seed + "f") * FIRST.length) | 0] + " " + LAST[(h(seed + "l") * LAST.length) | 0]; }
  function islandId(b) { const I = CBZ.islandVenue && CBZ.islandVenue.island(b); return (I && I.arena && I.arena.id) || "isle"; }
  function live() { return !!(g && g.mode === "archipelago"); }
  function you() { return (CBZ.surv && CBZ.surv.playerActor) || CBZ.player; }

  // the room on storey k: the floor inside the walls, right of the stair strip
  function roomOf(b, k) {
    const IV = CBZ.islandVenue, F = IV.floor(b, k), I = b.interior || {};
    let sx = F.local.x0;
    // (the ground floor's stair is behind its stairwell wall: the room starts at its face)
    const sw = (k | 0) === 0 ? b._stairwell : null;
    for (const r of I.keepOut || []) if (r.why === "stairs") sx = Math.max(sx, sw ? sw.face + 0.02 : r.x1 + 0.1);
    return { F: F, y: F.yLocal + 0.015, X0: sx, X1: F.local.x1, Z0: F.local.z0, Z1: F.local.z1,
      cx: (sx + F.local.x1) / 2, sEdge: sx - 0.45 };
  }
  // where the stair lands on storey k (world/island_building.js's plan)
  function landingOf(b, k) {
    const IB = CBZ.islandBuilding;
    if (!IB || !IB.plan) return null;
    let P = null;
    try { P = IB.plan({ w: b.lw, d: b.ld, storeys: b.storeys }); } catch (e) { P = null; }
    const lg = P && P.landingAt ? P.landingAt(k) : null;
    return lg ? { lx: (lg.x0 + lg.x1) / 2, lz: (lg.z0 + lg.z1) / 2, z0: lg.z0, z1: lg.z1 } : null;
  }
  // a flag on a pole: the islands' colours, hung straight
  function flag(K, lx, lz, y, col) {
    K.lbox(lx, y + 1.3, lz, 0.05, 2.6, 0.05, 0xb79a52, { solid: true });
    K.lbox(lx, y + 2.65, lz, 0.1, 0.1, 0.1, 0xd8b34a);
    K.lbox(lx, y + 2.6, lz, 0.25, 0.06, 0.25, 0x2a2a2a);
    K.lbox(lx, y + 0.03, lz, 0.4, 0.06, 0.4, 0x3a3a3a);
    const c = col || [0x1d4e89, 0xf2c14e, 0x2a7f4f];
    for (let i = 0; i < 3; i++) K.lbox(lx + 0.03, y + 2.3 - i * 0.22, lz + 0.45, 0.02, 0.22, 0.85, c[i]);
  }
  // the island's seal: a disc of rings (boxes stepped round), gilt
  function seal(K, lx, ly, lz, r, nz) {
    const t = 0.03 * (nz || 1);
    K.lbox(lx, ly, lz, 2 * r + 0.12, 2 * r + 0.12, 0.04, 0x6d5222);
    for (let i = 0; i < 8; i++) {
      const a = (i + 0.5) / 8 * Math.PI, y = Math.cos(a) * r, w = Math.sin(a) * r * 2;
      K.lbox(lx, ly + y, lz + t, w, r / 4, 0.03, 0xc9a24a);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i + 0.5) / 6 * Math.PI, y = Math.cos(a) * r * 0.72, w = Math.sin(a) * r * 1.44;
      K.lbox(lx, ly + y, lz + 2 * t, w, r * 0.72 / 3, 0.03, 0x1d4e89);
    }
    K.lbox(lx, ly, lz + 3 * t, r * 0.5, r * 0.5, 0.03, 0xf2c14e);
  }
  function frameLW(b) { return CBZ.islandFit.frame(b); }
  // the island build's slice clock (world/disaster_arena.js): the fit-outs
  // are generators that yield there, a few pieces a step
  function late() { return !!(CBZ.sliceLate && CBZ.sliceLate()); }

  /* ======================================================================
     THE TOWN HALL
     ====================================================================== */
  const halls = [];
  function* fitHall(b, lot, job) {
    const IV = CBZ.islandVenue, FIT = CBZ.islandFit;
    if (!IV || !FIT || !b.interior) return null;
    const iid = islandId(b);
    const K = FIT.kit(b, { name: "cityhall" });
    const MK = FIT.meshKit();
    const H = { b: b, posts: [], guard: null, night: null, case: false, said: new Set(), mayor: null, bounds: null };
    const n = Math.max(1, b.storeys | 0);

    // ---- GROUND FLOOR: THE HALL ------------------------------------------
    IV.clear(b, 0);
    const R0 = roomOf(b, 0), y0 = R0.y;
    {
      const X0 = R0.X0, X1 = R0.X1, Z0 = R0.Z0, Z1 = R0.Z1, cx = R0.cx;
      // the marble, in 1.2 m squares, an inlaid square in the middle
      const TS = 1.2;
      for (let x = X0; x < X1 - 0.05; x += TS) for (let z = Z0; z < Z1 - 0.05; z += TS) {
        const w = Math.min(TS, X1 - x), d = Math.min(TS, Z1 - z);
        const dark = (Math.round((x - X0) / TS) + Math.round((z - Z0) / TS)) % 2 === 1;
        K.lbox(x + w / 2, y0 + 0.004, z + d / 2, w, 0.008, d, dark ? 0x8e8a84 : 0xebe5d8);
        if (late()) yield 0;
      }
      const mz = (Z0 + Z1) / 2 + 0.4;
      K.lbox(cx, y0 + 0.01, mz, 2.6, 0.006, 2.6, 0xb08d4a);
      K.lbox(cx, y0 + 0.014, mz, 2.4, 0.006, 2.4, 0x23463a);
      K.lbox(cx, y0 + 0.018, mz, 1.0, 0.006, 1.0, 0xc9a24a);
      // four columns round it (base, shaft, capital), to the ceiling
      const top = (b.interior.fyOf ? b.interior.fyOf[1] : 3.4) - 0.25;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const px = cx + sx * 2.9, pz = mz + sz * 2.4;
        if (pz - 0.35 < Z0 + 2.5 || px - 0.35 < X0 || px + 0.35 > X1) continue;
        K.lbox(px, y0 + 0.12, pz, 0.62, 0.24, 0.62, 0xd9d3c4, { solid: true });
        K.lbox(px, y0 + top / 2, pz, 0.46, top - 0.5, 0.46, 0xf1ece0, { solid: true });
        K.lbox(px, y0 + top - 0.12, pz, 0.62, 0.24, 0.62, 0xd9d3c4);
      }
      // the counter across the back, its glass screens, the clerks behind
      const c0 = Math.max(X0 + 1.2, cx - 3.6), c1 = Math.min(X1 - 0.4, cx + 3.6), cz = Z1 - 1.45;
      if (c1 - c0 > 2.5) {
        K.lbox((c0 + c1) / 2, y0 + 0.5, cz, c1 - c0, 1.0, 0.62, 0x5a3b26, { solid: true });
        K.lbox((c0 + c1) / 2, y0 + 1.03, cz - 0.02, c1 - c0 + 0.06, 0.06, 0.72, 0xd9d3c4);
        K.lbox((c0 + c1) / 2, y0 + 0.5, cz - 0.315, c1 - c0, 0.86, 0.02, 0x6b4a33);
        const nW = Math.max(2, Math.round((c1 - c0) / 2.2));
        for (let i = 0; i <= nW; i++) {
          const x = c0 + (c1 - c0) * i / nW;
          K.lbox(x, y0 + 1.45, cz, 0.05, 0.8, 0.05, 0xb79a52);
        }
        K.lbox((c0 + c1) / 2, y0 + 1.47, cz, c1 - c0, 0.74, 0.012, 0xcfe0e6, { glass: true });
        K.lbox((c0 + c1) / 2, y0 + 1.86, cz, c1 - c0 + 0.05, 0.05, 0.06, 0xb79a52);
        // the seal over it
        seal(K, cx, y0 + 2.45, Z1 - 0.05, 0.42, -1);
        for (let i = 0; i < Math.min(2, nW); i++) {
          const x = c0 + (c1 - c0) * (i + 0.5) / nW + (nW > 2 ? (c1 - c0) / nW * 0.5 : 0);
          H.posts.push(IV.staff(b, x, Z1 - 0.75, Math.PI, { job: "town clerk", hours: [9, 17], near: 150,
            dress: { archetype: "office", job: "clerk" }, name: nameOf(iid + "clerk" + i),
 }));
        }
      }
      // benches facing the counter
      for (const sx of [-1, 1]) {
        const bx = cx + sx * 1.6;
        if (bx - 0.9 < X0 || bx + 0.9 > X1) continue;
        K.furnish("bench", bx, mz - 2.6 < Z0 + 2.6 ? Z0 + 2.9 : mz - 2.6, y0, 0, { len: 1.6, tone: "warm" });
      }
      // the flags at the foot of the stair
      flag(K, X0 + 0.45, Z0 + 3.0, y0);
      flag(K, X0 + 0.45, Z0 + 3.9, y0, [0xc8102e, 0xf2f2f2, 0x1d4e89]);
      // the directory board by the stair
      if (n >= 2 && FIT.panel) {
        const tex = FIT.text(["TOWN HALL", n >= 3 ? "COUNCIL CHAMBER   1" : "COUNCIL CHAMBER   1", n >= 3 ? "MAYOR'S OFFICE   2" : ""].filter(Boolean),
          { bg: "#1c2b24", fg: "#e8d9a8", w: 256, h: 192 });
        if (tex) FIT.panel(b, null, X0 + 0.04, y0 + 1.55, Z0 + 5.2, 0.9, 0.68, Math.PI / 2, tex, false);
        K.lbox(X0 + 0.02, y0 + 1.55, Z0 + 5.2, 0.03, 0.74, 0.96, 0x3a2b1e);
        // (it stands on two legs at the open side of the stair)
        for (const dz of [-0.4, 0.4]) K.lbox(X0 + 0.02, y0 + 0.6, Z0 + 5.2 + dz, 0.05, 1.2, 0.05, 0x3a2b1e, { solid: true });
      }
      // the guard at the door, by day and by night
      const gx = Math.min(X1 - 0.5, 2.3), gz = Z0 + 1.7;
      H.guard = IV.staff(b, gx, gz, Math.PI, { job: "security guard", hours: [7, 19], near: 170,
        dress: { archetype: "security", job: "security guard" }, name: nameOf(iid + "guard") });
      H.night = IV.staff(b, gx, gz, Math.PI, { job: "security guard", hours: [19, 7], near: 170,
        dress: { archetype: "security", job: "security guard" }, name: nameOf(iid + "guardN") });
      H.bounds = { X0: R0.F.local.x0, X1: X1, Z0: Z0, Z1: Z1, y: b.gy + R0.F.yLocal };
    }

    // ---- FIRST FLOOR: THE COUNCIL CHAMBER -----------------------------------
    if (late()) yield 0;
    if (n >= 2) {
      IV.clear(b, 1);
      const R = roomOf(b, 1), y = R.y, X0 = R.X0, X1 = R.X1, Z0 = R.Z0, Z1 = R.Z1, cx = R.cx;
      // the panelled back wall
      for (let x = X0; x < X1 - 0.05; x += 0.9) {
        const w = Math.min(0.9, X1 - x);
        K.lbox(x + w / 2, y + 1.3, Z1 - 0.02, w - 0.04, 2.6, 0.04, 0x5a3b26);
        K.lbox(x + w / 2, y + 1.3, Z1 - 0.045, w - 0.2, 2.3, 0.02, 0x6b4a33);
      }
      K.lbox((X0 + X1) / 2, y + 2.64, Z1 - 0.05, X1 - X0, 0.08, 0.08, 0x3a2b1e);
      seal(K, cx, y + 2.15, Z1 - 0.08, 0.36, -1);
      // the dais and the council bench
      const dw = Math.min(7.2, X1 - X0 - 0.6), dz0 = Z1 - 2.7;
      K.lbox(cx, y + 0.15, (dz0 + Z1) / 2, dw, 0.3, Z1 - dz0, 0x6b4a33, { plat: true });
      K.lbox(cx, y + 0.3, dz0 + 0.02, dw, 0.04, 0.06, 0xb79a52);
      const by = y + 0.3, bz = dz0 + 0.75;
      K.lbox(cx, by + 0.38, bz, dw - 0.6, 0.76, 0.75, 0x5a3b26, { solid: true });
      K.lbox(cx, by + 0.78, bz, dw - 0.5, 0.05, 0.85, 0x3a2b1e);
      K.lbox(cx, by + 0.42, bz - 0.4, dw - 0.6, 0.7, 0.03, 0x6b4a33);
      const seats = 5, sp = (dw - 1.2) / (seats - 1);
      for (let i = 0; i < seats; i++) {
        const sx = cx - (dw - 1.2) / 2 + i * sp;
        K.lbox(sx, by + 0.86, bz - 0.15, 0.04, 0.12, 0.04, 0x1a1a1a);
        if (MK) { MK.at(sx, bz + 0.75, Math.PI, by); CBZ.cityMeshKit.pieces.swivelChair(MK, 0.5, { channels: i === 2, back: i === 2 ? 0.95 : 0.78 }); }
        FIT.seat(b, sx, bz + 0.75, by, Math.PI, "office chair", 0.5);
        if (i !== 2 && H.posts.length < 12) H.posts.push(IV.staff(b, sx, bz + 0.8, Math.PI, { k: 1, job: "council member", hours: [9, 16], near: 150,
          dress: { job: "council member" }, name: "Cllr. " + nameOf(iid + "cllr" + i), exit: landingExit(b, 1) }));
        if (late()) yield 0;
      }
      flag(K, cx - dw / 2 + 0.3, Z1 - 0.35, by);
      flag(K, cx + dw / 2 - 0.3, Z1 - 0.35, by, [0xc8102e, 0xf2f2f2, 0x1d4e89]);
      // the lectern facing the bench
      const lz = dz0 - 1.4;
      K.lbox(cx, y + 0.55, lz, 0.6, 1.1, 0.45, 0x5a3b26, { solid: true });
      K.lbox(cx, y + 1.12, lz + 0.05, 0.7, 0.05, 0.55, 0x3a2b1e);
      K.lbox(cx, y + 1.25, lz + 0.15, 0.03, 0.25, 0.03, 0x1a1a1a);
      // the public rows
      for (let r = 0; r < 3; r++) {
        const rz = lz - 1.5 - r * 1.05;
        if (rz < Z0 + 0.6) break;
        for (let i = -2; i <= 2; i++) {
          const x = cx + i * 0.72;
          if (x - 0.3 < X0 || x + 0.3 > X1) continue;
          K.furnish("chair", x, rz, y, 0, { tone: { cloth: 0x7a2a2a, wood: 0x3a2b1e } });
          if (late()) yield 0;
        }
      }
    }

    // ---- SECOND FLOOR: THE MAYOR'S OFFICE -----------------------------------
    if (late()) yield 0;
    if (n >= 3) {
      IV.clear(b, 2);
      const R = roomOf(b, 2), y = R.y, X0 = R.X0, X1 = R.X1, Z0 = R.Z0, Z1 = R.Z1, cx = R.cx;
      const lg = landingOf(b, 2);
      const front = !lg || lg.lz < 0;               // the stair lands at the front: the anteroom is there
      const s = front ? 1 : -1;                     // +1: the office is toward +z
      const zA = front ? Z0 : Z1, zO = front ? Z1 : Z0;
      const pz = zA + s * 4.0;                      // the partition
      const CH = (b.interior.fyOf ? b.interior.fyOf[1] : 3.4) - 0.35;
      const dg0 = cx - 0.6, dg1 = cx + 0.6;
      K.lbox((X0 + dg0) / 2, y + CH / 2, pz, dg0 - X0, CH, 0.12, 0x6b4a33, { solid: true });
      K.lbox((dg1 + X1) / 2, y + CH / 2, pz, X1 - dg1, CH, 0.12, 0x6b4a33, { solid: true });
      K.lbox(cx, y + 2.2 + (CH - 2.2) / 2, pz, 1.2, CH - 2.2, 0.12, 0x6b4a33);
      for (const ex of [dg0, dg1]) K.lbox(ex, y + 1.1, pz, 0.1, 2.2, 0.16, 0x3a2b1e);
      // the anteroom: his secretary's desk, two chairs, a plant
      K.furnish("desk", X1 - 1.4, zA + s * 2.0, y, -Math.PI / 2, { len: 1.4, deep: 0.7, tone: "exec" });
      H.posts.push(IV.staff(b, X1 - 0.75, zA + s * 2.0, -Math.PI / 2, { k: 2, job: "mayor's secretary", hours: [8, 17], near: 150,
        dress: { archetype: "office", job: "secretary" }, name: nameOf(iid + "sec"), exit: landingExit(b, 2) }));
      K.furnish("chair", X0 + 0.7, zA + s * 1.6, y, Math.PI / 2, { tone: "exec" });
      K.furnish("chair", X0 + 0.7, zA + s * 2.4, y, Math.PI / 2, { tone: "exec" });
      // the office
      const dz = zO - s * 2.3;                        // the desk
      if (MK) {
        const P = CBZ.cityMeshKit.pieces;
        // the rug, the desk under the flags, his chair, two for visitors
        MK.at(cx, dz - s * 0.4, 0, y);
        MK.box(MK.M.rug, 0, 0.004, 0, 3.6, 0.008, 3.0, 0xffffff);
        MK.at(cx, dz, s > 0 ? 0 : Math.PI, y); P.execDesk(MK, 2.4, 1.0);
        if (late()) yield 0;
        MK.at(cx, dz + s * 0.75, s > 0 ? Math.PI : 0, y); P.swivelChair(MK, 0.5, { channels: true, back: 0.95 });
        if (late()) yield 0;
        for (const sx of [-0.7, 0.7]) { MK.at(cx + sx, dz - s * 1.15, s > 0 ? 0 : Math.PI, y); P.guestChair(MK, 0.47); if (late()) yield 0; }
        // the credenza against the wall behind him, a fig in each corner
        MK.at(cx, zO - s * 0.3, s > 0 ? Math.PI : 0, y); P.credenza(MK, 2.0, 0.72, 0.5, 4);
        if (late()) yield 0;
        MK.at(X1 - 0.5, zO - s * 0.5, 0, y); P.figTree(MK, 0x51a, 1.0);
        if (late()) yield 0;
        MK.at(X0 + 0.5, zO - s * 0.5, 0, y); P.snakePlanter(MK, 0x51b, 0.38, 0.5);
        if (late()) yield 0;
        // the sitting corner
        MK.at(X1 - 1.0, pz + s * 1.3, -Math.PI / 2, y); P.loungeChair(MK, 0.42);
        MK.at(X1 - 1.0, pz + s * 2.4, -Math.PI / 2, y); P.loungeChair(MK, 0.42);
        if (late()) yield 0;
        FIT.solid(b, cx - 1.2, cx + 1.2, dz - 0.5, dz + 0.5, y, y + 0.76, { noStep: true });
        FIT.solid(b, cx - 1.0, cx + 1.0, zO - s * 0.55, zO - s * 0.05, y, y + 0.72, { noStep: true });
        FIT.seat(b, cx, dz + s * 0.75, y, s > 0 ? Math.PI : 0, "office chair", 0.5);
        for (const sx of [-0.7, 0.7]) FIT.seat(b, cx + sx, dz - s * 1.15, y, s > 0 ? 0 : Math.PI, "chair", 0.47);
        FIT.seat(b, X1 - 1.0, pz + s * 1.3, y, -Math.PI / 2, "armchair", 0.42);
        FIT.seat(b, X1 - 1.0, pz + s * 2.4, y, -Math.PI / 2, "armchair", 0.42);
      } else {
        K.furnish("bossDesk", cx, dz, y, s > 0 ? Math.PI : 0, { tone: "exec" });
      }
      K.furnish("coffee", X1 - 2.0, pz + s * 1.85, y, 0, { tone: "exec" });
      K.furnish("shelf", X0 + 0.3, (pz + zO) / 2, y, Math.PI / 2, { len: 2.0, tone: "exec" });
      flag(K, cx - 1.5, zO - s * 0.35, y);
      flag(K, cx + 1.5, zO - s * 0.35, y, [0xc8102e, 0xf2f2f2, 0x1d4e89]);
      seal(K, cx, y + 2.2, zO - s * 0.04, 0.32, -s);
      H.mayor = IV.staff(b, cx, dz + s * 0.85, s > 0 ? Math.PI : 0, { k: 2, job: "mayor", hours: [9, 17], near: 150,
        dress: { job: "mayor" }, name: "Mayor " + nameOf(iid + "mayor"), exit: landingExit(b, 2) });
      H.posts.push(H.mayor);
      H.office = { k: 2, X0: X0, X1: X1, z0: Math.min(pz, zO), z1: Math.max(pz, zO), y: b.gy + y };
    }
    // the chamber's chairs and the mayor's office: one merge per material
    if (MK) yield* FIT.flushMeshSteps(b, MK, "island-cityhall");
    yield* K.flushSteps();
    // the hall's walls panelled to the dado, its ceiling lit by panels
    if (FIT.dress) {
      try {
        yield* FIT.dressSteps(b, { kind: "cityhall", room: { x0: R0.X0, x1: R0.X1, z0: R0.Z0, z1: R0.Z1 }, lights: "panel",
          walls: [{ edge: "x0", mods: ["panel"], w: 1.2, d: 0.06, front: 0, back: 0x6b4a33, upper: 0xe4ded2, mirror: false },
                  { edge: "x1", mods: ["panel"], w: 1.2, d: 0.06, front: 0, back: 0x6b4a33, upper: 0xe4ded2, mirror: false }] });
      } catch (e) { console.error("[town hall dress]", e); }
    }
    halls.push(H);
    return function () {
      const i = halls.indexOf(H);
      if (i >= 0) halls.splice(i, 1);
      for (const p of [H.guard, H.night]) {
        const gd = p && p.body ? p.body() : null;
        if (gd && CBZ.cityLadder && CBZ.cityLadder.of(gd)) { try { CBZ.cityLadder.cancel(gd); } catch (e) {} }
      }
    };
  }
  // where a worker upstairs goes at the end of his day: the stair's landing
  function landingExit(b, k) {
    const lg = landingOf(b, k);
    return lg ? { lx: lg.lx, lz: lg.lz, k: k } : null;
  }

  /* THE DOOR GUARD: a gun out inside the hall is the demand ladder's
     "security" case; at its end he calls it in. The mayor asks who you are
     the first time you walk into his office. */
  function hallTick(H, dt) {
    const P = CBZ.player;
    if (!P || !P.pos || !H.bounds) return;
    const F = frameLW(H.b), L = F.l(P.pos.x, P.pos.z);
    const inside = L.x > H.bounds.X0 && L.x < H.bounds.X1 && L.z > H.bounds.Z0 - 0.5 && L.z < H.bounds.Z1 && Math.abs(P.pos.y - H.bounds.y) < 2;
    const post = H.guard && H.guard.on() ? H.guard : H.night;
    const gd = post && post.body ? post.body() : null;
    const LD = CBZ.cityLadder;
    H.inside = inside;
    if (gd && LD && LD.begin && !H.case && inside && CBZ.playerArmed && CBZ.playerArmed() && !LD.of(gd)) {
      const out = { x: -Math.sin(F.yaw), z: -Math.cos(F.yaw) };
      let e = null;
      try {
        e = LD.begin(gd, "security", {
          inside: function () { return !!(H.inside && CBZ.playerArmed && CBZ.playerArmed()); },
          outDir: function () { return out; },
          // at the end of it he calls it in, and does what a guard does
          onAct: function () { if (CBZ.cityAddStars) { try { CBZ.cityAddStars(1, "armed in the town hall"); } catch (err) {} } return false; },
          onEnd: function () { H.case = false; },
        });
      } catch (err) { e = null; }
      if (e) H.case = true;
    }
    // the mayor, the first time you are in his office
    if (H.mayor && H.office) {
      const m = H.mayor.body();
      if (m && !H.metMayor && Math.abs(P.pos.y - H.office.y) < 1.6 && L.x > H.office.X0 && L.x < H.office.X1 && L.z > H.office.z0 && L.z < H.office.z1) {
        H.metMayor = true;
        if (CBZ.speech) CBZ.speech.say(m, "Do you have an appointment?", { secs: 2.6, force: true });
      }
    }
  }

  /* ======================================================================
     THE RECRUITING OFFICE
     ====================================================================== */
  const offices = [];
  function posterTex(kind) {
    const FIT = CBZ.islandFit;
    if (typeof document === "undefined") return null;
    const key = "isle-poster-" + kind;
    const cache = posterTex.c || (posterTex.c = {});
    if (cache[key]) return cache[key];
    const W = 256, Hh = 384;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = Hh;
    const x = cv.getContext("2d");
    if (!x) return null;
    const star = function (cx, cy, r, col) {
      x.fillStyle = col; x.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      x.closePath(); x.fill();
    };
    if (kind === 0) {
      x.fillStyle = "#3e4a2f"; x.fillRect(0, 0, W, Hh);
      x.fillStyle = "#c9a24a"; x.fillRect(0, 300, W, 14);
      star(W / 2, 150, 78, "#e8d9a8");
      x.fillStyle = "#e8d9a8"; x.font = "bold 64px Helvetica, Arial, sans-serif"; x.textAlign = "center"; x.fillText("ARMY", W / 2, 285);
      x.font = "bold 20px Helvetica, Arial, sans-serif"; x.fillText("THE WINDWARD ISLES", W / 2, 350);
    } else if (kind === 1) {
      x.fillStyle = "#1d2a44"; x.fillRect(0, 0, W, Hh);
      x.fillStyle = "#c8102e"; x.fillRect(0, 0, W, 40); x.fillRect(0, Hh - 40, W, 40);
      // the chevrons of the ranks
      x.fillStyle = "#e8d9a8";
      for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(58, 120 + i * 40); x.lineTo(128, 80 + i * 40); x.lineTo(198, 120 + i * 40); x.lineTo(198, 140 + i * 40); x.lineTo(128, 100 + i * 40); x.lineTo(58, 140 + i * 40); x.closePath(); x.fill(); }
      x.font = "bold 34px Helvetica, Arial, sans-serif"; x.textAlign = "center"; x.fillText("SERVE", W / 2, 290);
      x.font = "bold 20px Helvetica, Arial, sans-serif"; x.fillText("ENLIST TODAY", W / 2, 322);
    } else {
      x.fillStyle = "#e9e2cf"; x.fillRect(0, 0, W, Hh);
      x.fillStyle = "#3e4a2f"; x.fillRect(16, 16, W - 32, Hh - 32);
      x.fillStyle = "#e9e2cf"; x.fillRect(28, 28, W - 56, 200);
      // a horizon, a ridge, a flag on it
      x.fillStyle = "#7d8f6a"; x.beginPath(); x.moveTo(28, 228); x.lineTo(90, 150); x.lineTo(150, 190); x.lineTo(228, 120); x.lineTo(228, 228); x.closePath(); x.fill();
      x.fillStyle = "#2a2a2a"; x.fillRect(150, 92, 4, 100);
      x.fillStyle = "#1d4e89"; x.fillRect(154, 92, 46, 12); x.fillStyle = "#f2c14e"; x.fillRect(154, 104, 46, 12); x.fillStyle = "#2a7f4f"; x.fillRect(154, 116, 46, 12);
      x.fillStyle = "#e9e2cf"; x.font = "bold 30px Helvetica, Arial, sans-serif"; x.textAlign = "center"; x.fillText("DEFEND", W / 2, 285);
      x.fillText("THE ISLES", W / 2, 322);
    }
    const t = new window.THREE.CanvasTexture(cv);
    if (window.THREE.sRGBEncoding != null) t.encoding = window.THREE.sRGBEncoding;
    cache[key] = t;
    return t;
  }
  function* fitRecruit(b, lot, job) {
    const IV = CBZ.islandVenue, FIT = CBZ.islandFit;
    if (!IV || !FIT || !b.interior) return null;
    const iid = islandId(b);
    IV.clear(b, 0);
    const K = FIT.kit(b, { name: "recruit" });
    const R = roomOf(b, 0), y = R.y, X0 = R.X0, X1 = R.X1, Z0 = R.Z0, Z1 = R.Z1, cx = R.cx;
    // the floor: grey tile; the sergeant's desk facing the door, chairs in front
    K.lbox((X0 + X1) / 2, y + 0.004, (Z0 + Z1) / 2, X1 - X0, 0.008, Z1 - Z0, 0x9a9c98);
    const dz = Math.min(Z1 - 1.9, Z0 + 5.5);
    K.furnish("desk", cx, dz, y, Math.PI, { len: 1.6, deep: 0.8, tone: "cool" });
    K.furnish("chair", cx - 0.55, dz - 1.15, y, 0, { tone: "cool" });
    K.furnish("chair", cx + 0.55, dz - 1.15, y, 0, { tone: "cool" });
    K.furnish("locker", X1 - 0.35, Z1 - 0.6, y, -Math.PI / 2, {});
    K.furnish("bench", X0 + 0.45, (Z0 + dz) / 2, y, Math.PI / 2, { len: 1.8, tone: "cool" });
    flag(K, cx + 1.3, dz + 0.55, y, [0x3e4a2f, 0xc9a24a, 0x3e4a2f]);
    flag(K, cx - 1.3, dz + 0.55, y);
    // the brochure stand by the door
    K.lbox(X1 - 0.5, y + 0.6, Z0 + 1.2, 0.4, 1.2, 0.3, 0x2a2e33, { solid: true });
    for (let i = 0; i < 3; i++) K.lbox(X1 - 0.5, y + 0.7 + i * 0.25, Z0 + 1.05, 0.34, 0.2, 0.02, [0x3e4a2f, 0x1d2a44, 0xe9e2cf][i]);
    // the posters, framed, on the walls
    const pw = 0.62, ph = 0.93;
    const spots = [[cx - 1.7, y + 1.75, Z1 - 0.03, Math.PI], [X1 - 0.03, y + 1.6, (Z0 + Z1) / 2, -Math.PI / 2], [cx + 1.7, y + 1.75, Z1 - 0.03, Math.PI]];
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i], tex = posterTex(i);
      if (tex) FIT.panel(b, null, s[0] + Math.sin(s[3]) * 0.02, s[1], s[2] + Math.cos(s[3]) * 0.02, pw, ph, s[3], tex, false);
      const quarter = Math.abs(Math.round(Math.sin(s[3]))) === 1;
      K.lbox(s[0], s[1], s[2], quarter ? 0.02 : pw + 0.06, ph + 0.06, quarter ? pw + 0.06 : 0.02, 0x1a1a1a);
    }
    yield* K.flushSteps();
    // the rest of a recruiting office: filing cabinets and brochure racks
    // down the walls, the corporal's desk at the back, the television on the
    // wall playing the service's film, panel lights (the posters keep their wall)
    if (FIT.dress) {
      try {
        const keep = [
          { x0: cx - 2.1, x1: cx - 1.3, z0: Z1 - 0.7, z1: Z1 }, { x0: cx + 1.3, x1: cx + 2.1, z0: Z1 - 0.7, z1: Z1 },
          { x0: X1 - 0.7, x1: X1, z0: (Z0 + Z1) / 2 - 0.45, z1: (Z0 + Z1) / 2 + 0.45 },
          { x0: cx - 1.6, x1: cx + 1.6, z0: dz - 1.7, z1: dz + 1.1 },
        ];
        yield* FIT.dressSteps(b, {
          kind: "recruit", room: { x0: X0, x1: X1, z0: Z0, z1: Z1 }, keep: keep, lights: "panel",
          walls: [{ edge: "x0", mods: ["brochures", "cabinets", "cabinets"], w: 0.96, d: 0.5, front: 0.9, col: 0x4b5234, pal: [0x3e4a2f, 0x1d2a44, 0xe9e2cf, 0xc9a24a] },
                  { edge: "x1", mods: ["cabinets"], w: 0.96, d: 0.5, front: 0.9, col: 0x6a7078 }],
          extra: function (D) {
            const Kd = D.K, yy = D.y;
            // the television on the stair-side wall, high, facing the room
            const tz = (Z0 + Z1) / 2 + 0.6, tx = X0 + 0.04;
            Kd.lbox(tx + 0.03, yy + 2.0, tz, 0.06, 0.7, 1.2, 0x15171b);
            Kd.lbox(tx + 0.065, yy + 2.0, tz, 0.006, 0.62, 1.12, 0x2f4a3a, { glow: true });
            Kd.lbox(tx + 0.05, yy + 1.55, tz, 0.08, 0.2, 0.12, 0x2a2c30);
            // the corporal's desk at the back corner, his screen, a chair
            const r = { x0: X1 - 2.4, x1: X1 - 0.2, z0: Z1 - 2.4, z1: Z1 - 0.2 };
            if (D.place(r)) D.furnish("desk", X1 - 1.3, Z1 - 1.35, Math.PI, { len: 1.4, deep: 0.7, tone: "cool" });
          },
        });
      } catch (e) { console.error("[recruiting office dress]", e); }
    }
    const O = { b: b, iid: iid, sergeant: null, desk: null, co: null };
    O.sergeant = IV.staff(b, cx, dz + 0.75, Math.PI, { job: "recruiting sergeant", hours: [8, 18], near: 160,
      dress: { archetype: "military", job: "recruiter" }, name: "Sgt. " + nameOf(iid + "sgt") });
    const dw = FIT.frame(b).w(cx, dz - 0.45);
    O.desk = { x: dw.x, z: dw.z, y: b.gy + y, O: O };
    // a soldier of this island already: his officer is at the muster point
    const A = army();
    if (A && A.island === iid) standCO(O);
    offices.push(O);
    return function () {
      const i = offices.indexOf(O);
      if (i >= 0) offices.splice(i, 1);
      if (CBZ.command && CBZ.command.cancelPlayer) {
        for (const p of [O.sergeant, O.co]) { const bd = p && p.body ? p.body() : null; if (bd) { try { CBZ.command.cancelPlayer(bd); } catch (e) {} } }
      }
    };
  }

  /* ---- THE ARMY ----------------------------------------------------------- */
  const RANKS = [[0, "Private"], [3, "Private First Class"], [8, "Corporal"], [15, "Sergeant"]];
  function army() { return g.isleArmy || null; }
  function rankFor(n) { let r = RANKS[0][1]; for (const q of RANKS) if (n >= q[0]) r = q[1]; return r; }
  // the muster point: the quay's car park, else the town square
  function musterOf(b) {
    const I = CBZ.islandVenue.island(b);
    if (!I) return null;
    const P = (I.parking || []).find(function (p) { return /Quay/.test(p.name || ""); }) || null;
    if (P && P.rect) return { x: (P.rect.x0 + P.rect.x1) / 2, z: (P.rect.z0 + P.rect.z1) / 2 };
    const pl = I.plan && I.plan.plaza;
    if (pl) return { x: pl.x, z: pl.z };
    return null;
  }
  function standCO(O) {
    if (O.co) return O.co;
    const m = musterOf(O.b);
    if (!m) return null;
    O.muster = m;
    const loc = CBZ.islandFit.frame(O.b).l(m.x, m.z);
    O.co = CBZ.islandVenue.staff(O.b, loc.x, loc.z, 0, { job: "army lieutenant", hours: [6, 20],
      dress: { archetype: "military", job: "officer" }, name: "Lt. " + nameOf(O.iid + "lt"), exit: null });
    return O.co;
  }
  function enlist(f) {
    const O = f && f.O;
    if (!O || army()) return;
    const sg = O.sergeant && O.sergeant.body();
    if (!sg) return;
    g.isleArmy = { rank: "Private", island: O.iid, musters: 0, strikes: 0, lastDay: CBZ.dayCount ? CBZ.dayCount() : 0,
      since: CBZ.dayCount ? CBZ.dayCount() : 0, reported: false };
    // the uniform, the rifle, two magazines
    try {
      const own = g.cityOutfitsOwned || (g.cityOutfitsOwned = {});
      own.soldier = true;
      if (CBZ.cityWearOutfit) CBZ.cityWearOutfit("soldier", { silent: true });
    } catch (e) {}
    try {
      if (CBZ.cityEcon && CBZ.cityEcon.add) CBZ.cityEcon.add("Rifle", 1);
      if (CBZ.cityGiveWeapon) CBZ.cityGiveWeapon("Rifle");
      if (CBZ.cityAddAmmo) CBZ.cityAddAmmo(60);
    } catch (e) {}
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.speech) CBZ.speech.say(sg, "Welcome aboard, Private. Report to the quay.", { secs: 3.2, force: true });
    standCO(O);
    // THE FIRST ORDER: report to your officer at the muster point
    order(O, sg, "first");
  }
  function atMuster(O) {
    const P = CBZ.player;
    return !!(P && P.pos && O.muster && Math.hypot(P.pos.x - O.muster.x, P.pos.z - O.muster.z) < 5);
  }
  function order(O, from, why) {
    const C = CBZ.command;
    if (!C || !C.toPlayer || !from || !O.muster) return null;
    const A = army();
    if (!A) return null;
    O.orderWhy = why;
    O.order = C.toPlayer(from, "go", {
      at: { x: O.muster.x, z: O.muster.z },
      complied: function () { return atMuster(O); },
      patience: why === "first" ? [900, 600, 300] : [600, 300, 120],
      lines: why === "first" ? ["Report to the quay.", "The quay, Private.", "Last time. The quay."] : ["Muster. The quay.", "Private! Muster!", "Last call."],
      onDone: function (r, outcome) {
        O.order = null;
        if (outcome === "complied") mustered(O, why);
        else if (outcome !== "cancelled" && outcome !== "dead") missed(O);
      },
    });
    return O.order;
  }
  function mustered(O, why) {
    const A = army();
    if (!A) return;
    A.lastDay = CBZ.dayCount ? CBZ.dayCount() : 0;
    const co = O.co && O.co.body();
    if (why === "first") {
      A.reported = true;
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(250);
      if (co && CBZ.speech) CBZ.speech.say(co, "Fall in, Private.", { secs: 2.6, force: true });
      return;
    }
    A.musters++;
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(150);
    const r = rankFor(A.musters);
    if (r !== A.rank) {
      A.rank = r;
      if (co && CBZ.speech) CBZ.speech.say(co, r + ".", { secs: 2.6, force: true });
    } else if (co && CBZ.speech) CBZ.speech.say(co, "Dismissed.", { secs: 2.2, force: true });
  }
  function missed(O) {
    const A = army();
    if (!A) return;
    A.strikes++;
    A.lastDay = CBZ.dayCount ? CBZ.dayCount() : 0;
    if (A.strikes >= 3) g.isleArmy = null;          // out of the army
  }
  function armyTick() {
    const A = army();
    if (!A) return;
    const day = CBZ.dayCount ? CBZ.dayCount() : 0, hr = CBZ.islandFit.hour();
    for (const O of offices) {
      if (O.iid !== A.island) continue;
      standCO(O);
      if (O.order) {
        // the muster is over at ten: an order still open is a muster missed
        if (O.orderWhy === "muster" && (hr >= 10 || hr < 7) && CBZ.command && CBZ.command.cancelPlayer) {
          const bd = O.orderFrom;
          try { CBZ.command.cancelPlayer(bd); } catch (e) {}
          O.order = null;
          missed(O);
        }
        continue;
      }
      // the first order, still to answer (you left the island and came back)
      if (!A.reported) {
        const sg = O.sergeant && O.sergeant.body();
        if (sg) { O.orderFrom = sg; order(O, sg, "first"); }
        continue;
      }
      // the morning muster
      if (hr >= 7 && hr < 10 && A.lastDay !== day) {
        const co = O.co && O.co.body();
        if (co) { O.orderFrom = co; order(O, co, "muster"); }
      }
    }
  }

  /* ---- THE CARD: the recruiting desk -------------------------------------- */
  if (CBZ.islandFit) CBZ.islandFit.fixtures("recruit-desk", {
    prio: 9,
    list: function (ctx, px, pz) {
      if (!live() || !offices.length) return null;
      const P = CBZ.player, out = [];
      for (const O of offices) if (O.desk && Math.abs(O.desk.y - P.pos.y) < 1.8 && Math.abs(O.desk.x - px) < 4 && Math.abs(O.desk.z - pz) < 4) out.push(O.desk);
      return out;
    },
    reach: function () { return 2.6; },
    dot: function () { return 0.3; },
    name: function () { return "Army Recruiting"; },
    verbs: [
      { id: "recruit-enlist", slot: "e", prio: 6, label: "Enlist",
        canShow: function (f) { return !!(f && !army() && f.O.sergeant && f.O.sergeant.body() && f.O.sergeant.on()); },
        onSelect: enlist },
    ],
  });

  if (CBZ.islandVenue && CBZ.islandVenue.on) {
    CBZ.islandVenue.on("cityhall", fitHall);
    CBZ.islandVenue.on("recruit", fitRecruit);
  }
  /* ---- THE MOTOR POOL ------------------------------------------------------ */
  const POOL_UNITS = ["hmmwv", "jltv"];
  const POOL = { arena: null, list: [], asked: false, t: 0 };
  function poolClear() {
    for (const v of POOL.list) {
      if (v.group && v.group.parent) v.group.parent.remove(v.group);
      const i = CBZ.colliders ? CBZ.colliders.indexOf(v.col) : -1;
      if (i >= 0) CBZ.colliders.splice(i, 1);
    }
    if (POOL.list.length && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    POOL.list.length = 0;
    POOL.arena = null;
  }
  function poolTick() {
    const A = CBZ.surv && CBZ.surv.arena, I = CBZ.island;
    if (POOL.arena && POOL.arena !== A) poolClear();
    if (POOL.arena || !A || !A.root || !I || I.arena !== A) return;
    // an island with a recruiting office, and the quay's car park to muster in
    if (!(I.buildings || []).concat(I.sites || []).some(function (b) { return b && b.use === "recruit"; })) { POOL.arena = A; return; }
    const lot = (I.parking || []).find(function (p) { return /Quay/.test(p.name || ""); });
    if (!lot || !lot.bays || lot.bays.length < 2) { POOL.arena = A; return; }
    const M = CBZ.milModels;
    if (!M || !M.build) { POOL.arena = A; return; }
    if (!POOL_UNITS.every(function (id) { return M.has(id); })) {
      if (!POOL.asked) { POOL.asked = true; M.load(POOL_UNITS).then(function () { POOL.asked = false; }, function () { POOL.asked = false; }); }
      return;
    }
    POOL.arena = A;
    // the two free bays nearest the lot's centre (the officer stands in the
    // aisle there): a bay is free when no car of the island stands in it
    const spots = A.carSpots || [];
    const cx = (lot.rect.x0 + lot.rect.x1) / 2, cz = (lot.rect.z0 + lot.rect.z1) / 2;
    const free = lot.bays.filter(function (b) {
      for (let i = 0; i < spots.length; i++) { const s = spots[i]; if (Math.abs(s.x - b.x) < 1.4 && Math.abs(s.z - b.z) < 1.4) return false; }
      return true;
    }).sort(function (a, b) { return Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz); });
    const ground = I.groundAt || CBZ.floorAt || function () { return 0; };
    for (let k = 0; k < POOL_UNITS.length && k < free.length; k++) {
      const bay = free[k];
      let made = null;
      try { made = M.build(POOL_UNITS[k], { seed: k + 1, ground: "city" }); } catch (e) { made = null; }
      if (!made || !made.group) continue;
      const gp = made.group, yaw = bay.yaw + Math.PI;        // a body's +z front, nose to the aisle
      const y = (+ground(bay.x, bay.z) || 0) + 0.045;
      gp.position.set(bay.x, y, bay.z);
      gp.rotation.y = yaw;
      gp.userData.hwKind = "ground";
      A.root.add(gp);
      // the hull is solid (its footprint, square to the bay)
      const across = Math.abs(Math.sin(yaw)) > 0.5;
      const hw = (across ? made.footL : made.footW) / 2, hl = (across ? made.footW : made.footL) / 2;
      const col = { minX: bay.x - hw, maxX: bay.x + hw, minZ: bay.z - hl, maxZ: bay.z + hl, y0: y, y1: y + (made.height || 2), ref: gp, veh: gp };
      if (CBZ.colliders) CBZ.colliders.push(col);
      POOL.list.push({ group: gp, col: col, unitId: made.unitId });
    }
    if (POOL.list.length && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }

  let acc = 0, accA = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(36.45, function (dt) {
    if (!live()) { if (POOL.list.length || POOL.arena) poolClear(); return; }
    if ((POOL.t -= dt || 0) <= 0) { POOL.t = 1; try { poolTick(); } catch (e) { console.error("[isle motor pool]", e); POOL.arena = CBZ.surv && CBZ.surv.arena; } }
    acc += dt || 0;
    if (acc >= 0.1) { const s = acc; acc = 0; for (const H of halls) hallTick(H, s); }
    accA += dt || 0;
    if (accA >= 1) { accA = 0; armyTick(); }
  });

  CBZ.islandCivic = { halls: function () { return halls.slice(); }, offices: function () { return offices.slice(); }, army: army,
    motorPool: function () { return POOL.list.slice(); } };
})();
