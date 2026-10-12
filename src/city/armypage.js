"use strict";
/* city/armypage.js — GANG CITY'S PAGE LAYER FOR THE BATTLE SIM.

   Not a page script: city/army.js compiles it into the battle realm
   (src/battle/core/realm.js) FIRST, ahead of the sim files, the way
   games/battle.html's settings.js, menu.js, player.js and camera files sit
   ahead of them on NPC War's page. It declares every name the sim reads from
   its page (realm.js PAGE_NAMES; tools/npcwar-check.mjs holds this file to
   that list) with what that name means in the city:

     there is no war room   SET is the city's two sides, filled force by force
     no probe, no bench     the counters exist, nobody reads them
     no possession, no kill cam, no study desk: the player is himself here
     (YOU, STUDY, killCam ...), and the city's own camera is the lens
     the studio            STUDIO: cast / drop / trail / collapse from
                           core/stage.js, a boom that is the city's own
                           explosion (cityExplosion: its fireball, its
                           sound, its damage to peds, cops, cars and you),
                           and join() keeps the sim's hurt and blast hooks
                           for city/army.js's guns-and-blasts bridge

   REALM_PAGE (what city/army.js hands the realm): { seed, corpseMax } */

const el = function () { return null; };       // no war-room DOM in the city
const Q = new URLSearchParams("");
const SET = {
  map: "city", redN: 0, blueN: 0, redU: "men", blueU: "men",
  redW: "carbine", blueW: "ak47", redT: "elite", blueT: "pro", redS: "none", blueS: "none",
  nationA: "republic", nationB: "kesh", bench: false, auto: true, call: null, cam: null, freeze: false, bo: 1,
};
const PROBE = false;
const BATTLE_SEED = (REALM_PAGE && REALM_PAGE.seed) | 0;
// bodies on the street: a phone keeps fewer (the city has its own dead too)
const CORPSE_MAX = (REALM_PAGE && REALM_PAGE.corpseMax) || 120;
// the war room's revert switches: the city always runs the shipped behaviour
const DEATH_OLD = false;
const FIRE_OLD = false;
const SEP_OLD = false;
const SHARE_OLD = false;
const STEER_OLD = false;
const SWIM_OLD = false;
let HAS_BEASTS = false;
// the ground's own answers: the city is dry land with no war-room maps
const MAPS = {};
const SEA = { on: false, seabed: null };
function cruiseDepth() { return 0; }
function stepDepth() {}
// NPC War's lens, study desk, possession and director do not exist here
const STUDY = { m: null, want: null };
const YOU = { m: null, on: false, tgt: null, yaw: 0, pitch: 0, fireAt: -9 };
function killCam() {}
function stepYou() {}
function youDown() {}
function youInput() { return { ax: 0, az: 0, run: false, atk: false }; }
function youRetarget() {}
const QUAL = { firstShotT: -1, blindFire: 0, throughMate: 0, throughSand: 0, wallSeconds: 0 };
const SETTINGS = { cur: null, clampArmy: function () {} };
// the director's events become the army's (city/army.js's bus: news, the UI)
function warEvent(kind, data) {
  try { if (CBZ.army && CBZ.army._emit) CBZ.army._emit({ type: "war", kind: kind, data: data || null }); } catch (e) {}
}

/* THE STUDIO, AS THE CITY ANSWERS IT */
const ARMY_JOIN = { spec: null };
const STUDIO = {
  root: (CBZ.army && CBZ.army.ROOT) || "src/",
  touchDevice: !!(CBZ.touch || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)),
  cast: function (role, opts) { return CBZ.stage ? CBZ.stage.cast(role, opts) : null; },
  drop: function (obj) { return CBZ.stage ? CBZ.stage.drop(obj) : 0; },
  trail: function (opts) { return CBZ.stage ? CBZ.stage.trail(opts) : { push: function () {}, cut: function () {}, dispose: function () {} }; },
  collapseAt: function (pos, opts) { return CBZ.stage ? CBZ.stage.collapseAt(pos, opts) : null; },
  structureAt: function (x, z, r) { return CBZ.stage ? CBZ.stage.structureAt(x, z, r) : null; },
  /* A DETONATION IS THE CITY'S OWN: cityExplosion draws it, sounds it and
     hurts the city's people (and you); its damage sweep (crashfx
     applyBlastDamage) calls CBZ.army.blast, which is the sim's blastBodies
     on the soldiers and MASS.blast on the rows. One sweep, nobody twice. */
  boom: function (pos, o) {
    o = o || {};
    const R = o.radius > 0 ? o.radius : 18, power = o.power > 0 ? o.power : 1;
    if (CBZ.cityExplosion) {
      try {
        CBZ.cityExplosion(pos.x, pos.z, { power: power, radius: R / Math.max(0.2, power), y: pos.y || undefined,
          byPlayer: !!o.byPlayer, kind: o.kind || (power > 1.5 ? "heavy" : "rpg"), cause: o.cause || "war" });
      } catch (e) { console.warn("[army] boom", e); }
    } else if (CBZ.army && CBZ.army.blast) CBZ.army.blast(pos.x, pos.z, R, power, o);
    return { drew: !!CBZ.cityExplosion, hit: 0, struck: null };
  },
  // the war room's bombers, its nuke run and its airstrikes are NPC War's
  // page (air.js AIR stays off here): aircraft fight as vehicles
  fly: function () { return null; },
  join: function (spec) { ARMY_JOIN.spec = spec || null; return spec ? spec.id : null; },
  settle: function () {},
  hud: function () { return { note: function () {}, set: function () {} }; },
};
// the boom above is already the whole sweep: mass.js must not wrap it again
STUDIO.boom._mass = true;
