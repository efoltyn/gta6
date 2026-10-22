/* ============================================================
   world/island_offices.js — THE ISLANDS' OFFICE BUILDINGS, FITTED OUT.

   Owner: "I like the general office buildings. The ones in executive are
   beautiful. Already have beautiful interiors." So an island's office
   towers (b.use "office": Highgate's downtown, the odd tower elsewhere,
   the harbour office) are furnished with the executive floor's own pieces
   (city/exec_office.js, CBZ.cityMeshKit.pieces: the walnut desk, the
   channel-backed leather chair, the cantilever chairs, the credenzas, the
   monitors with their screens, the snake plants and the figs), one merge
   per material per building, and city/furniture.js's desks and chairs:
     THE LOBBY      a reception desk off the walk to the lifts, the firm's
                    name on the wall behind it, the receptionist at it.
     EVERY FLOOR    (a tower: round its lift core, the first three floors
                    the lift serves) the open-plan desks down one
                    side, each with its chair and its screen; the corner
                    office down the other behind a glass wall (the walnut
                    desk, his chair with its back to the window, two for
                    visitors, a fig); the meeting room across the back
                    behind glass (the long table, its chairs, the screen on
                    the wall); a waiting corner by the lift with plants.
   The people: by day the receptionist, two at their desks and the boss in
   his corner office on the first floor; by night a cleaner on his rounds.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  if (!window.THREE) return;
  const g = CBZ.game || (CBZ.game = {});

  const FIRMS = ["Meridian Capital", "Windward Shipping Co.", "Island Mutual", "Caribe Holdings", "Coral Bay Trust",
    "Halyard & Pike LLP", "Trade Wind Partners", "Leeward Assurance", "Ashby Consolidated", "Saltmarsh Group"];
  function hsh(s) { return CBZ.islandFit ? CBZ.islandFit.hash(s) : 0.5; }

  /* ---- A TOWER FLOOR, round its core -------------------------------------- */
  function towerFloor(b, k, K, MK, staffOut) {
    const IV = CBZ.islandVenue, FIT = CBZ.islandFit, P = CBZ.cityMeshKit.pieces;
    const I = b.interior, iw = I.x1, id = I.z1;
    const s = Math.min(iw, id) * 0.42, so = s + 0.15, lz = so + 0.95;
    if (iw - lz < 2.2 || id - lz < 2.2) return;
    const F = IV.floor(b, k), y = F.yLocal + 0.01;
    const salt = (b.planId | 0) * 13 + k;
    // ---- the open plan: desks along the -x band, each facing the window
    const bx0 = -iw, bx1 = -lz;
    const nD = Math.max(1, Math.floor((2 * lz) / 1.7));
    for (let i = 0; i < nD; i++) {
      const z = -lz + 0.85 + i * (2 * lz - 1.7) / Math.max(1, nD - 1);
      K.furnish("desk", (bx0 + bx1) / 2 - 0.1, z, y, -Math.PI / 2, { len: 1.4, deep: 0.7, tone: "cool" });
    }
    // ---- the corner office behind glass, down the +x band
    const gx = lz - 0.05;
    const dg0 = -0.5, dg1 = 0.5;
    K.lbox(gx, y + 1.4, (-lz + dg0) / 2, 0.03, 2.8, dg0 + lz, 0xcfe0e6, { glass: true, solid: true });
    K.lbox(gx, y + 1.4, (dg1 + lz) / 2, 0.03, 2.8, lz - dg1, 0xcfe0e6, { glass: true, solid: true });
    for (const z of [-lz, dg0, dg1, lz]) K.lbox(gx, y + 1.4, z, 0.06, 2.8, 0.06, 0x2a2c2f);
    K.lbox(gx, y + 2.78, 0, 0.08, 0.06, 2 * lz, 0x2a2c2f);
    const ox = (gx + iw) / 2;
    // (the desk across the band: his back to the lift side of the room, the
    // window to his right, the visitors between him and the glass door)
    const dz = 1.5;
    if (MK) {
      MK.at(ox, dz, 0, y); P.execDesk(MK, 2.2, 0.95);
      MK.at(ox, dz + 0.78, Math.PI, y); P.swivelChair(MK, 0.5, { channels: true, back: 0.9 });
      for (const x of [-0.6, 0.6]) { MK.at(ox + x, dz - 1.15, 0, y); P.guestChair(MK, 0.47); }
      MK.at(ox + 0.5, dz - 0.22, 0, y + 0.75); P.monitor(MK, (salt + 1) % 6, 0.52, 0.3);
      if (k === 1) { MK.at(iw - 0.45, -lz + 0.45, 0, y); P.figTree(MK, salt, 0.9); }
      else { MK.at(iw - 0.45, -lz + 0.45, 0, y); P.snakePlanter(MK, salt + 5, 0.34, 0.42); }
      FIT.solid(b, ox - 1.1, ox + 1.1, dz - 0.48, dz + 0.48, y, y + 0.76, { noStep: true });
      FIT.seat(b, ox, dz + 0.78, y, Math.PI, "office chair", 0.5);
      for (const x of [-0.6, 0.6]) FIT.seat(b, ox + x, dz - 1.15, y, 0, "chair", 0.47);
    }
    // ---- the meeting room behind glass, across the back band
    const gz = lz - 0.05;
    K.lbox((-lz + dg0) / 2, y + 1.4, gz, dg0 + lz, 2.8, 0.03, 0xcfe0e6, { glass: true, solid: true });
    K.lbox((dg1 + lz) / 2, y + 1.4, gz, lz - dg1, 2.8, 0.03, 0xcfe0e6, { glass: true, solid: true });
    for (const x of [-lz, dg0, dg1, lz]) K.lbox(x, y + 1.4, gz, 0.06, 2.8, 0.06, 0x2a2c2f);
    K.lbox(0, y + 2.78, gz, 2 * lz, 0.06, 0.08, 0x2a2c2f);
    const mz = (gz + id) / 2;
    K.furnish("table", 0, mz, y, 0, { len: Math.min(3.2, 2 * lz - 1.2), deep: 1.0, seats: 6, tone: "exec" });
    K.lbox(0, y + 1.5, id - 0.04, 1.6, 0.9, 0.05, 0x0e1013);
    K.lbox(0, y + 1.5, id - 0.07, 1.5, 0.82, 0.01, 0x22344a, { glow: true });
    // ---- the waiting corner by the lift, plants in the corners
    if (MK) {
      for (const x of [-lz + 0.6, lz - 0.6]) { MK.at(x, -id + 0.5, 0, y); P.snakePlanter(MK, salt + (x > 0 ? 7 : 3), 0.36, 0.45); }
      MK.at(-iw + 0.45, -id + 0.45, 0, y); P.snakePlanter(MK, salt + 11, 0.4, 0.5);
      MK.at(-iw + 0.45, id - 0.45, 0, y); P.snakePlanter(MK, salt + 17, 0.4, 0.5);
      MK.at(iw - 1.6, -id + 0.9, 0, y); P.loungeChair(MK, 0.42);
      MK.at(iw - 2.6, -id + 0.9, 0, y); P.loungeChair(MK, 0.42);
      FIT.seat(b, iw - 1.6, -id + 0.9, y, 0, "armchair", 0.42);
      FIT.seat(b, iw - 2.6, -id + 0.9, y, 0, "armchair", 0.42);
      FIT.solid(b, iw - 3.0, iw - 1.2, -id + 0.45, -id + 1.35, y, y + 0.5, { noStep: true });
    }
    if (k === 1 && staffOut) staffOut.push(
      { k: 1, lx: (bx0 + bx1) / 2 + 0.75, lz: -lz + 0.85, face: -Math.PI / 2, job: "office worker" },
      { k: 1, lx: (bx0 + bx1) / 2 + 0.75, lz: lz - 0.85, face: -Math.PI / 2, job: "office worker" },
      { k: 1, lx: ox + 0.35, lz: dz + 0.85, face: Math.PI, job: "managing director", dress: { archetype: "exec" } });
  }

  /* ---- A SMALL OFFICE (the harbour office: a house-plan building) ---------- */
  function smallFloor(b, k, K, MK) {
    const IV = CBZ.islandVenue, FIT = CBZ.islandFit, P = CBZ.cityMeshKit.pieces;
    const F = IV.floor(b, k), I = b.interior || {};
    let sx = F.local.x0;
    for (const r of I.keepOut || []) if (r.why === "stairs") sx = Math.max(sx, r.x1 + 0.1);
    const x0 = sx, x1 = F.local.x1, z0 = F.local.z0, z1 = F.local.z1, y = F.yLocal + 0.015;
    if (x1 - x0 < 3 || z1 - z0 < 5) return null;
    const cx = (x0 + x1) / 2;
    K.furnish("desk", x1 - 0.6, z0 + 2.0, y, Math.PI / 2, { len: 1.4, deep: 0.7, tone: "cool" });
    K.furnish("desk", x1 - 0.6, z0 + 4.0, y, Math.PI / 2, { len: 1.4, deep: 0.7, tone: "cool" });
    K.furnish("table", cx - 0.2, z1 - 1.6, y, 0, { len: 1.8, deep: 0.9, seats: 4, tone: "exec" });
    K.furnish("shelf", x0 + 0.3, (z0 + z1) / 2, y, Math.PI / 2, { len: 1.8, tone: "exec" });
    if (MK) { MK.at(x1 - 0.4, z1 - 0.4, 0, y); P.snakePlanter(MK, (b.planId | 0) + k, 0.36, 0.45); }
    return { k: k, lx: x1 - 0.6 - 0.75, lz: z0 + 2.0, face: Math.PI / 2 };
  }

  function fitOffice(b, lot, job) {
    const IV = CBZ.islandVenue, FIT = CBZ.islandFit;
    if (!IV || !FIT || !b.interior) return null;
    const K = FIT.kit(b, { name: "office" });
    const MK = FIT.meshKit();
    const firm = FIRMS[(hsh((b.planId | 0) + ":" + Math.round(b.ox)) * FIRMS.length) | 0];
    const iid = (function () { const I = IV.island(b); return (I && I.arena && I.arena.id) || "isle"; })();
    const posts = [];
    const n = Math.max(1, b.storeys | 0);
    const isTower = b.interior.kind === "tower";
    const work = [];
    if (isTower) {
      const I = b.interior, iw = I.x1, id = I.z1;
      // ---- THE LOBBY: the reception desk off the walk to the lifts
      const F0 = IV.floor(b, 0), y0 = F0.yLocal + 0.01;
      const rx = -iw + 1.5, rz = -id + 2.0;
      K.lbox(rx, y0 + 0.55, rz, 0.7, 1.1, 2.2, 0x5a3b26, { solid: true });
      K.lbox(rx + 0.02, y0 + 1.12, rz, 0.8, 0.04, 2.3, 0xe9e4d8);
      K.lbox(rx + 0.36, y0 + 0.55, rz, 0.02, 0.9, 2.1, 0x6b4a33);
      if (MK) {
        MK.at(rx - 0.15, rz + 0.4, Math.PI / 2, y0 + 0.75); CBZ.cityMeshKit.pieces.monitor(MK, (b.planId | 0) % 6, 0.48, 0.28);
        MK.at(rx - 0.8, rz, Math.PI / 2, y0); CBZ.cityMeshKit.pieces.swivelChair(MK, 0.5, {});
        FIT.seat(b, rx - 0.8, rz, y0, Math.PI / 2, "office chair", 0.5);
      }
      const tex = FIT.text([firm.toUpperCase()], { bg: "#20252b", fg: "#e2c98a", w: 512, h: 96, border: false });
      if (tex) FIT.panel(b, null, -iw + 0.03, y0 + 2.2, rz, 2.4, 0.45, Math.PI / 2, tex, false);
      posts.push(IV.staff(b, rx - 0.75, rz - 0.4, Math.PI / 2, { job: "receptionist", hours: [8, 18], near: 150,
        dress: { archetype: "office", job: "receptionist" } }));
      // ---- THE LET FLOORS the lift serves: the first three (the floors
      // above are fitted out and empty, to let: the tower's own pass)
      const top = Math.min(n - 1, 3);
      for (let k = 1; k <= top; k++) {
        IV.clear(b, k);
        towerFloor(b, k, K, MK, work);
      }
    } else {
      for (let k = 1; k < n; k++) {
        IV.clear(b, k);
        const w = smallFloor(b, k, K, MK);
        if (w && k === 1) work.push(Object.assign(w, { job: "harbour clerk" }));
      }
    }
    if (MK) FIT.flushMesh(b, MK, "island-office");
    K.flush();
    // the people upstairs, at their desks by day; the cleaner by night. They
    // go at the end of the day the way they came: the lift, or the stair.
    const exitUp = isTower ? { lx: 0, lz: -(Math.min(b.interior.x1, b.interior.z1) * 0.42 + 0.15) - 0.8 } : null;
    for (let i = 0; i < work.length; i++) {
      const w = work[i];
      posts.push(IV.staff(b, w.lx, w.lz, w.face, { k: w.k, job: w.job, hours: w.job === "managing director" ? [9, 17] : [8, 18], near: 120,
        dress: w.dress || { archetype: "office", job: w.job }, exit: exitUp ? { lx: exitUp.lx, lz: exitUp.lz, k: w.k } : null }));
    }
    if (work.length) {
      const w = work[0];
      posts.push(IV.staff(b, w.lx + (isTower ? 1.4 : -0.6), w.lz + 1.2, Math.PI, { k: w.k, job: "cleaner", hours: [20, 5], near: 120,
        dress: { archetype: "worker", job: "janitor" }, exit: exitUp ? { lx: exitUp.lx, lz: exitUp.lz, k: w.k } : null }));
    }
    return null;
  }

  if (CBZ.islandVenue && CBZ.islandVenue.on) CBZ.islandVenue.on("office", fitOffice);
  CBZ.islandOffices = { firms: FIRMS };
})();
