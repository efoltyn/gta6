/* ============================================================
   city/keepers.js — THE PEOPLE BEHIND THE COUNTER.

   Owner (2026-11-22): "Look at the jail game and how all characters are
   real and all interaction options are legit, and then look at Gang City:
   many stores have different character models that are fake, not
   interactable characters. Just make it real." And of the bank: "threaten
   a worker at the bank with a gun and eventually they open the safe, but
   not all workers have access."

   WHAT WAS FAKE. Every shop's vendor (peds.js postVendor) and every posted
   bank body (citystaff.js cityStaffPost: tellers, the manager, the vault
   guard) was a real rig on the roster, but the brain skipped them: think()
   returned on ped.vendor, a staff post's think wiped rage and state every
   tick, move() rooted both, the gunpoint sweep, markGunpoint and cityScare
   all skipped a vendor, and the player's fists could not even pick one as a
   target. So the gun-shop owner "went for his gun" by having a rage field
   set that nothing ever read, a teller in a robbery stood still, a vault
   guard whose drawer was emptied in front of him never fought, and any
   member of bank staff with their hands up within 9 m of the strongroom
   made its door open on a button press.

   WHAT IS REAL NOW. This file is the brain a keeper runs while he holds his
   post (peds.js think() asks it first; move() roots him only while he is
   not _keepFree):
     - A GUN ON HIM: the gunpoint sweep raises his hands (an unarmed keeper)
       or he levels his own back (an armed one). Held long enough, an armed
       keeper fires: the stand-off has an end.
     - FEAR BUILDS while the gun stays on him, and is what a demand spends.
     - LOOK AWAY from a man you held up and he may hit the alarm under the
       counter (a real report: CBZ.cityCrime, instant), then gets down.
       Unless one of your men has his own gun on him (city/stickup.js: the
       crew covering the room): then he is still held.
     - GUNFIRE IN THE ROOM: he cowers at his post.
     - HURT: an armed keeper fights (the ordinary fight brain, his own gun);
       an unarmed one runs (the ordinary flee brain).
     - CALM AGAIN, and nobody watching: he walks back to his post.
     - THE VAULT (a bank's staff, gunpoint row "Open the vault"): only a man
       carrying the vault's key (city/keys.js: the manager and the vault
       guard) can open it. A teller says so and points at who can. The man
       with the key stalls until his fear is up, then walks to the door with
       his hands up, works the lock while you keep the gun on him (or one
       of your men does), and the door swings (city/bank.js
       CBZ.cityVaultOpenBy); then he backs out of the doorway along the
       wall. Lose him, and he stops, hits the alarm and runs.
     - THE DRAWER (a teller, gunpoint row "Empty the drawer"): his own
       window's drawer, through city/bank.js's one drawer-take.

   Everything a keeper does is an existing verb of the city's: the gunpoint
   sweep, cityScare/fleeFrom, the fight brain, cityCrime, cityAlarm,
   cityPanicRaise, moveOrder, the posePoint arm. Nothing here is a menu.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  function now() { return (CBZ.now || 0) / 1000; }
  function P() { return CBZ.player; }
  function PA() { return (CBZ.city && CBZ.city.playerActor) || CBZ.player; }
  function say(p, text, secs) {
    if (!p || p.dead || !text) return;
    if (CBZ.citySay) { try { CBZ.citySay(p, text, null, { secs: secs || 2.4, force: true }); return; } catch (e) {} }
    if (CBZ.speech && CBZ.speech.say) { try { CBZ.speech.say(p, text, { force: true }); } catch (e) {} }
  }
  function pick(list, p) { const h = (p && p.slice != null ? p.slice : 0) + ((now() * 7) | 0); return list[h % list.length]; }
  function d2(a, x, z) { const dx = a.pos.x - x, dz = a.pos.z - z; return dx * dx + dz * dz; }

  // his post, in the world
  function postOf(p) {
    if (p.staffPost) return p.staffPost;
    const b = p.vendor && p.vendor.building;
    return (b && b.vendorSpot) || null;
  }
  function K(p) {
    let k = p._keep;
    if (!k) {
      k = p._keep = {
        fear: 0, hp: p.hp || 100, lastCovered: -99, held: false, heldAt: -99,
        alarmRolled: false, alarmed: false, standoff: 0, calmT: 0,
        mode: "post", demand: false, stallT: 0, vault: null, way: null, openT: 0, awayT: 0,
        said: {},
      };
    }
    return k;
  }
  // A GUN ON HIM IS YOURS, OR ONE OF YOUR MEN'S. city/stickup.js stamps the
  // people the crew are covering while you hold the room; to a keeper that is
  // the same thing as your own muzzle: his fear builds, his hands stay up, he
  // keeps walking to the vault, and he cannot reach the alarm.
  function crewCovered(p) { return (p._stickCov || -99) > now() - 0.9 && !!(p.surrender || p.poseHandsUp || p._keepBusy); }
  function covered(p) { return crewCovered(p) || !!(p._covered && (p.surrender || p.poseHandsUp || p.poseAimBack || p._keepBusy)); }
  function playerArmed() { return !!(CBZ.cityHasGun && CBZ.cityHasGun()); }
  function once(k, key, secs) {
    const t = now();
    if ((k.said[key] || -99) + (secs || 6) > t) return false;
    k.said[key] = t;
    return true;
  }

  // let him go: the ordinary brain runs him from the next tick
  function free(p) {
    p._keepFree = true;
    p._keepBusy = false;
    p.moveOrder = null;
  }
  function fight(p, k) {
    free(p);
    k.mode = "loose";
    p.surrender = false; p.surrenderT = 0; p.poseHandsUp = false; p.poseAimBack = false;
    p.rage = PA(); p.mem = PA(); p.state = "fight";
    p.alarmed = Math.max(p.alarmed || 0, 6);
    if (once(k, "fight", 8)) say(p, p.vendor ? pick(["Not in my store!", "Wrong place, pal.", "Drop it!"], p) : pick(["Drop the weapon!", "Security! Drop it!"], p));
  }
  function bolt(p, k, why) {
    free(p);
    k.mode = "loose";
    const Pl = P();
    p.surrender = false; p.surrenderT = 0; p.poseHandsUp = false; p.poseAimBack = false;
    p.rage = null; p.fear = Math.max(p.fear || 0, 9); p.alarmed = Math.max(p.alarmed || 0, 6);
    if (CBZ.cityFleeFrom && Pl) CBZ.cityFleeFrom(p, Pl.pos.x, Pl.pos.z);
    else p.state = "flee";
    if (CBZ.cityPanicRaise) CBZ.cityPanicRaise(p.pos.x, p.pos.z, 0.8);
    if (why && once(k, "bolt", 8)) say(p, why);
  }
  // THE BUTTON UNDER THE COUNTER: a held-up keeper who gets a moment calls it
  // in. It is a real report (instant: he is the witness) and the room hears it.
  function alarm(p, k) {
    if (k.alarmed) return;
    k.alarmed = true;
    const Pl = P();
    if (CBZ.cityCrime) { try { CBZ.cityCrime(190, { instant: true, x: p.pos.x, z: p.pos.z, type: "armed-robbery" }); } catch (e) {} }
    if (CBZ.cityAlarm && Pl) CBZ.cityAlarm(p.pos.x, p.pos.z, 30, 1.4, PA());
    if (CBZ.cityPanicRaise) CBZ.cityPanicRaise(p.pos.x, p.pos.z, 0.9);
    if (CBZ.sfx) { try { CBZ.sfx("alarm"); } catch (e) {} }
    p._keepAlarmAt = now();
  }

  /* ---- THE VAULT ---------------------------------------------------------- */
  function vaultOf(p) {
    if (!p || !p._vaultStaff || !CBZ.cityVaults) return null;
    const L = CBZ.cityVaults();
    for (let i = 0; i < L.length; i++) if (L[i].id === p._vaultStaff) return L[i];
    return null;
  }
  function hasAccess(p, v) { return !!(v && CBZ.cityKeys && CBZ.cityKeys.pedHas && CBZ.cityKeys.pedHas(p, v.id)); }
  function titleOf(p) {
    const j = String((p && p.job) || "").toLowerCase();
    if (/manager/.test(j)) return "the manager";
    if (/guard/.test(j)) return "the guard";
    return p && p.name ? p.name.split(" ")[0] : "him";
  }
  // the walk from his post to the strongroom door: to the hall side of the
  // counter's staff gap (bank.js cuts it in line with the vault door), then
  // through it to the door's face
  function vaultWay(p, v) {
    const ix = v.inx, iz = v.inz, tx = -iz, tz = ix;
    const door = { x: v.x - ix * 0.8, z: v.z - iz * 0.8 };
    const way = [];
    // how far out from the partition he is, and how far along it
    const depth = (p.pos.x - v.x) * -ix + (p.pos.z - v.z) * -iz;
    const lat = (p.pos.x - v.x) * tx + (p.pos.z - v.z) * tz;
    if (depth > 2.3) {
      // the hall side of the counter: round to the staff gap in line with the door
      way.push({ x: v.x - ix * 2.9, z: v.z - iz * 2.9 });
    } else if (Math.abs(lat) > 1.2) {
      // behind the counter: along the partition, behind the teller line
      way.push({ x: p.pos.x + ix * (depth - 0.45), z: p.pos.z + iz * (depth - 0.45) });
      way.push({ x: v.x - ix * 0.45 + tx * Math.sign(lat) * 0.9, z: v.z - iz * 0.45 + tz * Math.sign(lat) * 0.9 });
    }
    way.push(door);
    return way;
  }
  function demandVault(p) {
    const v = vaultOf(p);
    if (!v || v.open) return false;
    const k = K(p);
    k.fear = Math.min(1.6, k.fear + 0.3);
    if (!hasAccess(p, v)) {
      // HE CANNOT, AND SAYS WHO CAN — and points at him, a real person you
      // can go and put the gun on
      const keeper = CBZ.cityKeys && CBZ.cityKeys.holderOf ? CBZ.cityKeys.holderOf(v.id) : null;
      if (keeper && keeper !== p && !keeper.dead) {
        say(p, "I can't open it! Only " + titleOf(keeper) + " has the key!", 2.8);
        p._pointAt = keeper; p.posePoint = 2.2;
      } else {
        say(p, pick(["I don't have a key! I just work the window!", "I can't, I swear, I don't have access!"], p), 2.6);
      }
      return true;
    }
    if (k.mode === "escort" || k.mode === "open") return true;
    k.demand = true; k.vault = v;
    if (k.fear < 1) {
      k.stallT = 0;
      say(p, pick(["Please, I can't, they'll know it was me...", "It's on a timer, I can't just...", "I've got kids. Please."], p), 2.6);
    }
    return true;
  }
  function beginEscort(p, k) {
    const v = k.vault;
    if (!v || v.open) { k.demand = false; return; }
    k.mode = "escort"; k.way = vaultWay(p, v); k.awayT = 0; k.best = 1e9; k.stuckT = 0;
    free(p);
    say(p, pick(["Okay! Okay. I'll open it. Don't shoot.", "Alright, alright, it's this way."], p), 2.6);
  }
  // walking to the door with his hands up, then working the lock
  function escortThink(p, k, dt) {
    const v = k.vault, Pl = P();
    if (!v || v.open || !Pl) { endEscort(p, k); return; }
    const watched = covered(p) || (now() - k.lastCovered < 0.5);
    if (watched) k.awayT = 0; else k.awayT += dt;
    // you let him go: he stops, hits the button and runs for it
    if (k.awayT > 4.0 || !playerArmed()) {
      k.demand = false;
      alarm(p, k);
      bolt(p, k, "Help! He's robbing the bank!");
      return;
    }
    if (k.mode === "escort") {
      const w = k.way && k.way[0];
      if (!w) { k.mode = "open"; k.openT = 0; return; }
      const dd = Math.sqrt(d2(p, w.x, w.z));
      if (dd < (k.way.length > 1 ? 0.22 : 0.5)) { k.way.shift(); k.best = 1e9; k.stuckT = 0; return; }
      // a body in the way (a teller at his window): give it a moment, then
      // take the next leg rather than walking into him forever
      if (dd < (k.best || 1e9) - 0.05) { k.best = dd; k.stuckT = 0; } else k.stuckT = (k.stuckT || 0) + dt;
      if (k.stuckT > 1.8 && k.way.length > 1) { k.way.shift(); k.best = 1e9; k.stuckT = 0; return; }
      // at arm's length from the door and held there (a body on the floor in
      // front of it): that is close enough to reach the wheel
      if (k.stuckT > 1.2 && k.way.length === 1 && d2(p, v.x, v.z) < 1.7 * 1.7) { k.way.shift(); return; }
      // a colleague standing frozen in the strip behind the windows (the room
      // is being held): he reaches the wheel past him, from as far as the
      // door can be worked at all (city/bank.js: 2.6 m)
      if (k.stuckT > 2.5 && k.way.length === 1 && d2(p, v.x, v.z) < 2.5 * 2.5) { k.way.shift(); return; }
      p.surrender = true; p.state = "surrender"; p.poseHandsUp = true;
      // (busy at your order: the gunpoint sweep keeps him covered but does not
      // freeze him where he stands, which held him at his post for as long as
      // you kept the gun on him: the walk only ever happened when you looked away)
      p._keepThrough = true; p._keepBusy = true; p.pause = 0;
      p.moveOrder = { x: w.x, z: w.z, speed: (p.baseSpeed || 1.3) * 0.85, stop: 0.3, t: CBZ.now || 0 };
      return;
    }
    // AT THE DOOR: hands down onto the wheel, his back to you
    p.moveOrder = null;
    p._keepBusy = true;
    p.surrender = false; p.surrenderT = 0; p.poseHandsUp = false; p.state = "idle";
    if (p.char) p.char.handsUp = false;
    if (CBZ.cityPedFaceTo) CBZ.cityPedFaceTo(p, v.x, v.z, 0.5);
    k.openT += dt;
    if (k.openT > 1.2 && once(k, "lock", 30)) say(p, "Code... and the wheel. It takes a second.", 2.2);
    if (k.openT >= 4.0) {
      const ok = CBZ.cityVaultOpenBy ? CBZ.cityVaultOpenBy(v, p) : false;
      endEscort(p, k);
      if (ok) {
        // he did it; now he wants to be anywhere else. First out of the
        // doorway (a man with his hands up in it is a door still shut): he
        // backs along the wall beside it, away from you, and stays there.
        p.surrender = true; p.surrenderT = 3; p.state = "surrender"; p.poseHandsUp = true;
        say(p, "It's open. Take it. Just take it.", 2.4);
        const tx = -v.inz, tz = v.inx;
        const ax = v.x - v.inx * 0.45, az = v.z - v.inz * 0.45;
        const sd = (Pl.pos.x - ax) * tx + (Pl.pos.z - az) * tz >= 0 ? -1 : 1;
        k.mode = "aside"; k.asideT = 0;
        k.aside = { x: ax + tx * sd * 1.45, z: az + tz * sd * 1.45 };
      }
    }
  }
  // stepping clear of the vault's doorway, hands still up
  function asideThink(p, k, dt) {
    const a = k.aside;
    k.asideT = (k.asideT || 0) + dt;
    if (a && k.asideWay && k.asideWay.length && d2(p, a.x, a.z) < 0.4 * 0.4) { k.aside = k.asideWay.shift(); return; }
    if (!a || k.asideT > (k.asideMax || 5) || d2(p, a.x, a.z) < 0.35 * 0.35) {
      // (walked somewhere at gunpoint: he stands there with his hands up a while)
      if (a && k.asideMax) {
        p.surrender = true; p.surrenderT = 10; p.state = "surrender"; p.poseHandsUp = true;
        const done = k.asideDone; k.asideDone = null;
        if (done && d2(p, a.x, a.z) < 1.2 * 1.2) { try { done(p); } catch (e) {} }
      }
      k.mode = "loose"; k.aside = null; k.asideMax = 0; p._keepThrough = false; p._keepBusy = false; p.moveOrder = null;
      return;
    }
    p.surrender = true; p.surrenderT = Math.max(p.surrenderT || 0, 1.5); p.state = "surrender"; p.poseHandsUp = true;
    p._keepThrough = true; p._keepBusy = true; p.pause = 0;
    p.moveOrder = { x: a.x, z: a.z, speed: (p.baseSpeed || 1.3) * 0.9, stop: 0.3, t: CBZ.now || 0 };
  }
  function endEscort(p, k) {
    k.mode = "loose"; k.demand = false; k.way = null; k.openT = 0;
    p._keepBusy = false; p._keepThrough = false; p.moveOrder = null;
  }

  /* ---- THE DRAWER: a teller empties his own window ------------------------ */
  function drawerOf(p) {
    if (!CBZ.cityBankDrawerAt || !p || p._venueStaff !== "bank") return null;
    return CBZ.cityBankDrawerAt(p.pos.x, p.pos.z, 1.6, null);
  }
  function emptyDrawer(p) {
    const dr = drawerOf(p);
    if (!dr || !CBZ.cityBankDrawerTake) return false;
    const k = K(p);
    k.fear = Math.min(1.6, k.fear + 0.3);
    say(p, pick(["Here! Here, it's all there!", "Okay, okay, take it!"], p), 2.2);
    return CBZ.cityBankDrawerTake(dr);
  }

  /* ---- THE BRAIN ---------------------------------------------------------- */
  // true = this file owns the tick; false = peds.js carries on (the staff-post
  // stand when he is at his post, the ordinary brain when he is free)
  function think(p, dt) {
    if (!p || p.dead || (p.ko || 0) > 0) return false;
    if (CBZ.CONFIG && CBZ.CONFIG.KEEPERS_V1 === false) return false;
    const k = K(p), t = now(), Pl = P();
    if (!Pl) return false;
    const cov = covered(p);
    if (cov) k.lastCovered = t;
    if (p.posePoint > 0) { p.posePoint -= dt; if (p.posePoint <= 0) p._pointAt = null; }

    // walking to the vault / working its lock
    if (k.mode === "escort" || k.mode === "open") { escortThink(p, k, dt); return true; }
    if (k.mode === "aside") { asideThink(p, k, dt); return true; }

    // HURT. Who did it is the man in the room with a gun (a stray from
    // outside is still a reason to get down or get out).
    const hurt = (p.hp || 0) < k.hp - 0.5;
    k.hp = p.hp || k.hp;
    if (p._keepFree) {
      // LOOSE: the ordinary brain has him (fleeing, fighting). Calm again,
      // with the trouble gone, he goes back to work.
      // THE TROUBLE IS OVER when no gun is on the room and nothing is going
      // off near him: then his fear runs down and he stops running (the flee
      // brain alone never let go of a man trapped in his own banking hall:
      // he ran laps of it at fear 10 for as long as you watched)
      // (a man who fought you lets it go once you are out of his shop)
      const pd2 = d2(p, Pl.pos.x, Pl.pos.z);
      const threat = (playerArmed() && pd2 < 16 * 16) || (!!p.rage && p.rage === PA() && pd2 < 20 * 20);
      const quietPanic = CBZ.cityPanicAt ? CBZ.cityPanicAt(p.pos.x, p.pos.z) : 0;
      if (!threat && quietPanic < 0.25 && !p.restraint && !hurt && !(p.rage && p.rage !== PA())) k.quiet = (k.quiet || 0) + dt;
      else k.quiet = 0;
      if (k.quiet > 6 && p.rage) { p.rage = null; p.mem = null; if (p.state === "fight") p.state = "idle"; }
      if (k.quiet > 6) {
        p.fear = Math.max(0, (p.fear || 0) - dt * 1.2);
        if ((p.fear || 0) <= 3) {
          if (p.state === "flee") { p.state = "idle"; p.path = null; }
          if (p.surrender) { p.surrender = false; p.surrenderT = 0; p.poseHandsUp = false; if (p.state === "surrender") p.state = "idle"; }
        }
      }
      const busy = p.rage || p.state === "flee" || p.state === "fight" || p.surrender || (p.fear || 0) > 3 || p.restraint;
      const post = postOf(p);
      if (busy || !post || k.alarmed && t - (p._keepAlarmAt || 0) < 40) { k.calmT = 0; return false; }
      k.calmT += dt;
      if (k.calmT < 12) return false;
      if (d2(p, post.x, post.z) < 0.6 * 0.6) {
        p._keepFree = false; p.moveOrder = null; p.state = "idle"; k.mode = "post"; k.held = false; k.fear = 0;
        if (k.gunDown) { k.gunDown = false; p.armed = true; }
        if (CBZ.cityPedFaceYaw && post.face != null) CBZ.cityPedFaceYaw(p, post.face, 1.5);
        return true;
      }
      p.moveOrder = { x: post.x, z: post.z, speed: p.baseSpeed || 1.3, stop: 0.3, t: CBZ.now || 0 };
      p.state = "walk";
      return true;
    }

    // ---- AT HIS POST ----
    // somebody already set him on you (city/shopfloor.js defend, a drawer
    // emptied in front of the vault guard)
    if (p.rage && p.armed) { fight(p, k); return false; }
    if (hurt) {
      if (p.armed) { fight(p, k); return false; }
      bolt(p, k, pick(["Don't shoot! Don't shoot!", "Help! Somebody help!"], p));
      return false;
    }
    // a customer turning over a gun off this man's own wall is not holding
    // him up: he watches it, he does not put his hands up for it
    p._keepCalm = !!(p.vendor && CBZ.shopFloor && CBZ.shopFloor.handedBy && CBZ.shopFloor.handedBy(p));
    if (cov && p._keepCalm) {
      p.surrender = false; p.surrenderT = 0; p.poseHandsUp = false; p.poseAimBack = false;
      if (p.state === "surrender") p.state = "idle";
      k.standoff = 0;
      return false;
    }
    if (cov) {
      k.held = true; k.heldAt = t; k.alarmRolled = false;
      if (p.armed && p.poseAimBack) {
        // THE STAND-OFF ENDS: he backs down, or he fires. He levelled his own
        // the moment yours came up; a second later he has measured you. Close
        // in over his own counter, or with your men's guns on him too, he
        // lays it down and his hands come up (and then he is a man held up
        // like any other: the back room's key, the safe, the till). Otherwise
        // hold yours on him and he fires. (He always fired: an armed keeper
        // could not be held up at all.)
        k.standoff += dt;
        if (k.standoff > 0.6 && once(k, "standoff", 10)) say(p, pick(["Put it down. Now.", "You don't want to do this here."], p));
        if (k.standoff > 1.3 && k.yields == null) {
          const nerve = p.nerve != null ? p.nerve : 0.5;
          const close = d2(p, Pl.pos.x, Pl.pos.z) < 4.5 * 4.5;
          const odds = 0.5 + (crewCovered(p) ? 0.35 : 0) + (close ? 0.15 : 0) - nerve * 0.35;
          const roll = ((p.slice || 0) * 0.291 + t * 0.37) % 1;
          k.yields = roll < odds;
        }
        if (k.yields) {
          p.armed = false; p._holster = false; k.gunDown = true;
          p.poseAimBack = false; p.surrender = true; p.surrenderT = 2; p.poseHandsUp = true; p.state = "surrender";
          k.fear = Math.max(k.fear, 0.6);
          say(p, pick(["Okay! Okay. It's down. It's down.", "Alright! I'm putting it down."], p), 2.4);
          return false;
        }
        if (k.standoff > 2.6) { fight(p, k); return false; }
        return false;
      }
      // fear builds under the muzzle; a demand already made is answered when it is high enough
      k.fear = Math.min(1.6, k.fear + dt * 0.22);
      if (k.demand) {
        k.stallT += dt;
        if (k.fear >= 1) { beginEscort(p, k); return true; }
        if (k.stallT > 3 && once(k, "stall", 5)) say(p, pick(["Okay, okay... just give me a second...", "Please... please don't..."], p));
      }
      return false;
    }
    k.standoff = Math.max(0, k.standoff - dt);
    if (k.standoff <= 0) k.yields = null;
    // the gun he laid down goes back under the counter once it is long over
    if (k.gunDown && t - k.lastCovered > 25 && !k.alarmed) { k.gunDown = false; p.armed = true; }
    // HELD UP, AND YOU LOOKED AWAY. A keeper with any nerve hits the button.
    if (k.held && !k.alarmed) {
      const away = t - k.lastCovered;
      if (away > 1.6 && away < 30 && !k.alarmRolled) {
        k.alarmRolled = true;
        const nerve = p.nerve != null ? p.nerve : 0.5;
        const roll = ((p.slice || 0) * 0.137 + t * 0.61) % 1;
        if (roll < 0.35 + nerve * 0.5) alarm(p, k);
      }
    }
    if (t - k.lastCovered > 45) { k.held = false; k.fear = Math.max(0, k.fear - dt * 0.05); }
    // shooting in the room, or he just called it in: he gets down behind his counter
    const panic = CBZ.cityPanicAt ? CBZ.cityPanicAt(p.pos.x, p.pos.z) : 0;
    if (panic > 0.35 || (k.alarmed && t - (p._keepAlarmAt || 0) < 20)) {
      p.poseCower = Math.max(p.poseCower || 0, 1.2);
      // a hard enough panic with the gunman close and nobody covering him: he runs
      if (!p.armed && panic > 1.1 && playerArmed() && d2(p, Pl.pos.x, Pl.pos.z) < 14 * 14 && (p.nerve || 0.5) < 0.6) {
        bolt(p, k, "I'm out, I'm out!");
        return false;
      }
    }
    return false;
  }

  CBZ.cityKeeper = {
    think: think,
    demandVault: demandVault, emptyDrawer: emptyDrawer,
    // walk a held-up keeper somewhere with his hands up (city/gunstore.js: the
    // clerk who opened the back room goes in ahead of you, to the safe)
    walkTo: function (p, pts, done) {
      if (!p || p.dead || !pts || !pts.length) return false;
      const k = K(p); free(p); k.asideDone = done || null;
      k.mode = "aside"; k.asideT = 0; k.asideMax = 20; k.asideWay = pts.slice(1); k.aside = pts[0];
      return true;
    },
    state: function (p) { const k = p && p._keep; return k ? { mode: k.mode, fear: +k.fear.toFixed(2), held: k.held, alarmed: k.alarmed, free: !!p._keepFree, demand: k.demand } : null; },
  };

  /* ---- THE GUNPOINT ROWS (city/interactions.js's gunpoint grammar: aim a
     drawn gun at a bank's staff and these replace his street verbs) -------- */
  function wire() {
    const I = CBZ.interactions;
    if (!I || !I.register || wire.done) return !!wire.done;
    wire.done = true;
    I.register("ped:civ", {
      id: "keep-vault", slot: "l", prio: 60, needsGunDrawn: true, bad: true,
      label: "Open the vault",
      canShow: function (p) { const v = vaultOf(p); const k = p && p._keep; return !!(v && !v.open && !p.dead && !(k && (k.mode === "escort" || k.mode === "open"))); },
      onSelect: function (p) { demandVault(p); },
    });
    I.register("ped:civ", {
      id: "keep-drawer", slot: "k", prio: 60, needsGunDrawn: true, bad: true,
      label: "Empty the drawer",
      canShow: function (p) {
        if (!p || p.dead || p._venueStaff !== "bank" || !/teller/i.test(p.job || "")) return false;
        const dr = drawerOf(p), TL = CBZ.cityTill;
        return !!(dr && TL && TL.holds && TL.holds(dr, {}).amount > 0);
      },
      onSelect: function (p) { emptyDrawer(p); },
    });
    return true;
  }
  if (!wire() && CBZ.onUpdate) CBZ.onUpdate(46.9, function () { if (g && g.mode === "city") wire(); });
})();
