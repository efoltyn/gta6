/* ============================================================
   world/exit.js — where the escape is WON, and what the way out says.

   Until 2026-09-05 this file drew the exit: two glowing green pillars, a
   lintel, a glowing pad and an 18 m light shaft in the south wall's gap.
   Owner, with three photographs of real sally ports: "the green light and
   stupid red thing in front aren't exits — exits have an exit sign and look
   like this." They do. world/sallyport.js now builds the exit as a
   building: a fenced concertina walkway into a vestibule, a steel inner
   door on a physical Gate Key across the wall line (a barred slider until
   2026-09-29), EXIT signs, an interlocked steel door out. Nothing glows.

   What stays here is the STATE the way out speaks, because it is read by
   systems the building does not own:
     CBZ.EXIT           the point systems/interactions.js wins at (3 m),
                        the compass, the minimap and the full map's icon.
                        It sits OUTSIDE, 3.2 m past the out door: through
                        the inner door, through the interlocked door, out.
                        (world/corridors.js overwrites it with the port's
                        own number; this is the same point.)
     CBZ.exitSignal     the lamp language every refusal in the prison uses
                        (red denied / gold on pace / green open), written on
                        whatever the building registers — the inner door's
                        reader lamp and the vestibule strips.
   PRISON_GATE_PACE: gold while the run clock is under your best escape
   (systems/runstats.js CBZ.runStatsPace). A cop inside 6 m sees red.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // This file's CONFIG defaults are published at parse: other files read
  // them before (or without) the prison ever being built.
  if (CBZ.CONFIG.PRISON_GATE_PACE == null) CBZ.CONFIG.PRISON_GATE_PACE = true;
  // Built when the prison is first needed, as if at this script's parse
  // point (core/prisonlazy.js). Body left at its old indent.
  CBZ.definePrison("world/exit.js", function () {
  const { WORLD } = CBZ;
  const EX = WORLD.exit.x, EZ = WORLD.exit.z;
  // the win point: through the inner door, at the outer door
  CBZ.EXIT = new THREE.Vector3(EX, 0, EZ + 10.2);

  const GLOW = (CBZ.COL && CBZ.COL.GLOW) || 0x39ff88;
  const PACE_HEX = 0xffd166;                       // css --gold, the record colour
  const DENY_HEX = 0xff3b3b;
  const DENY_R2 = 6.0 * 6.0;
  const signal = CBZ.exitSignal = {
    lamps: [],                                     // materials with color + emissive
    hex: GLOW, deny: false, ahead: false,
    register: function (mat) { if (mat && signal.lamps.indexOf(mat) < 0) signal.lamps.push(mat); return mat; },
  };
  let last = null;
  CBZ.onAlways(6, function () {
    const g = CBZ.game;
    let deny = false;
    if (g && g.mode === "escape" && g.role === "cop" && CBZ.player && CBZ.player.pos) {
      const dx = CBZ.player.pos.x - EX, dz = CBZ.player.pos.z - EZ;
      deny = dx * dx + dz * dz < DENY_R2;
    }
    let ahead = false;
    if (!deny && CBZ.CONFIG.PRISON_GATE_PACE && CBZ.runStatsPace) {
      const p = CBZ.runStatsPace();
      ahead = !!(p && p.ahead);
    }
    const hex = deny ? DENY_HEX : (ahead ? PACE_HEX : GLOW);
    signal.deny = deny; signal.ahead = ahead; signal.hex = hex;
    if (hex === last) return;                      // written only on the flip
    last = hex;
    for (let i = 0; i < signal.lamps.length; i++) {
      const m = signal.lamps[i];
      if (m.color) m.color.setHex(hex);
      if (m.emissive) m.emissive.setHex(hex);
    }
  });
  });
})();
