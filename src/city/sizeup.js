/* ============================================================
   city/sizeup.js — FIGHT OR FOLD: NPCs read levels before they commit.

   WHY
   ---
   Real people don't trade punches with someone who obviously outclasses
   them — they put their hands up, hand over the wallet, or run. And nobody
   squares up 1-v-1 against a man with six friends. This file is where the
   LEVEL number (level.js) stops being decoration and starts being PHYSICS:

     • citySizeUp(tgt, att)   — pure read: does tgt DARE fight att? Compares
       effective levels (own level + a third of the levels of nearby allies,
       so a crew at your back literally makes you bigger — but four friends
       don't make a Lv.5 nobody fearless on the 1-100 scale). Bolder
       temperaments dare bigger gaps; the violent and the unhinged fear
       nothing.
     • citySizeUpFold(tgt)    — the outclassed response: hands up under a
       gun (the read says "don't even try"), or break and run.
     • citySizeUpHit(tgt,att) — the on-hit hook (peds.js hurtActor, combat.js
       player melee): rallies a gang victim's crew (you NEVER fight one
       ganger — you fight the block), then folds or lets the brain rage.
     • cityKillRespect(victim)— respect is earned UP the ladder. Dropping
       someone above your level makes a name; stomping a single-digit busker
       once you read Lv.20+ makes you a bully nobody respects (0).

   Everything is derived from live state — no new fields to save, no knobs
   a designer has to remember to set per-ped.
   ============================================================ */
(function () {
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  const lvl = (a) => (CBZ.cityLevel ? CBZ.cityLevel(a) : 5);
  const nowMs = () => (CBZ.now != null ? CBZ.now : performance.now());

  // who's at my back? Sum the levels of up to 4 same-side bodies within 16u.
  // For the player that's companions/crew; for a ganger it's their set.
  function backupLevels(a, isPlayer) {
    const peds = CBZ.cityPeds || [];
    const ax = a.pos.x, az = a.pos.z, R2 = 16 * 16;
    const pgid = g.playerGang ? g.playerGang.id : (g.cityMembership ? g.cityMembership.gangId : null);
    let sum = 0, n = 0;
    for (let i = 0; i < peds.length && n < 4; i++) {
      const o = peds[i];
      if (o === a || o.dead || o.ko > 0) continue;
      const mine = isPlayer ? (o.companion || o.recruited || (pgid && o.gang === pgid))
                            : (a.gang ? o.gang === a.gang : false);
      if (!mine) continue;
      const dx = o.pos.x - ax, dz = o.pos.z - az;
      if (dx * dx + dz * dz >= R2) continue;
      sum += lvl(o); n++;
    }
    return sum;
  }

  // 0.35x: on the 1-100 scale raw ally levels run big (gang brass 40-70), so
  // a full-weight sum would make any 4-man corner crew read like an army —
  // backup should EMBOLDEN, not erase the read.
  function effLevel(a) { return lvl(a) + 0.35 * backupLevels(a, !!a.isPlayer); }

  // ---- the read: dare I fight this person? ---------------------------------
  CBZ.citySizeUp = function (tgt, att) {
    if (!tgt || !att || tgt.dead) return true;
    if (tgt.kind === "cop" || tgt.kind === "security") return true; // trained: holding the line is the job
    if (tgt.rampage) return true;                                   // unhinged: the read is broken
    if ((tgt.aggr || 0) >= 0.88) return true;                       // the violent fear nothing
    const ratio = effLevel(att) / Math.max(1, effLevel(tgt));
    let nerve = 1.25 + (tgt.aggr || 0.4) * 0.9;                     // bolder = dares a bigger gap
    if (tgt.gang) nerve += 0.3;                                     // crew pride — backup is coming
    return ratio < nerve;
  };

  // ---- the fold: what an outclassed person actually does -------------------
  CBZ.citySizeUpFold = function (tgt, att) {
    if (!tgt || tgt.dead || tgt.surrender || tgt.kind === "cop" || tgt.kind === "security") return;
    if ((tgt._foldUntil || 0) > nowMs()) return;        // already made their choice
    tgt._foldUntil = nowMs() + 4000;
    const attArmed = att && (att.isPlayer ? !!(CBZ.cityHasGun && CBZ.cityHasGun()) : !!att.armed);
    // markGunpoint can REFUSE (vendors, KO'd, the bold) — then they run instead
    if (attArmed && !tgt.armed && CBZ.cityMarkGunpoint && CBZ.cityMarkGunpoint(tgt, 2.2)) {
      // hands shot up — they know the read
    } else {
      tgt.rage = null; tgt.state = "flee";
      tgt.fear = 10; tgt.alarmed = Math.max(tgt.alarmed || 0, 6);
      if (CBZ.cityFleeFrom && att && att.pos) CBZ.cityFleeFrom(tgt, att.pos.x, att.pos.z);
    }
    // being made to fold is remembered: fear up, grudge simmers (social.js)
    if (att && att.isPlayer && CBZ.cityRelShift) CBZ.cityRelShift(tgt, "intimidated", 1);
  };

  // ---- the on-hit hook: rally the set, then fold or let the brain rage -----
  // Returns the DARE boolean so callers (peds.js hurtActor) gate their own
  // fight-back line on it; the fold side-effect happens in here.
  CBZ.citySizeUpHit = function (tgt, att) {
    if (!tgt || tgt.dead || !att || att.dead) return true;
    if (tgt.kind === "cop" || tgt.kind === "security") return true;
    // you never jump ONE ganger — their people pile in (team fight, every time)
    if (tgt.gang && CBZ.cityRallyGang && (tgt._rallyT || 0) <= 0 && att.gang !== tgt.gang) {
      CBZ.cityRallyGang(tgt, att);
      tgt._rallyT = 6;
    }
    const dare = CBZ.citySizeUp(tgt, att);
    if (!dare) CBZ.citySizeUpFold(tgt, att);
    return dare;
  };

  // ---- respect is earned UP the ladder --------------------------------------
  // Levels run 1-100 but respect still pays in the same 0..14 band the economy
  // is balanced around (mode.js addKill) — so the per-level terms are ~2.5x
  // smaller than the old 1-40 scale, and the gap term is damped the same way.
  CBZ.cityKillRespect = function (victim) {
    const pl = lvl(CBZ.city && CBZ.city.playerActor ? CBZ.city.playerActor : { isPlayer: true });
    const vl = victim ? lvl(victim) : 4;                // anonymous extras read ~4
    if (vl <= 5 && pl >= 20) return 0;                  // stomping a nobody impresses no one
    return Math.max(1, Math.min(14, Math.round(1 + vl * 0.16 + Math.max(0, vl - pl) * 0.4)));
  };
})();
