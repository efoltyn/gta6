/* lab ingredient "gun": a real gun in a real hand.

   The model is the game's weapon appearance (weapons/appearances/*.js, built
   at its researched real size by weapons/weapon-scale.js) socketed in the
   holder's hand by systems/actorweapons.js (CBZ.syncActorWeapon), aimed with
   CBZ.actorAimAt (a bounded turn onto the mark + the two-handed ready pose),
   and its barrel is the prop's own world axis: the thing a person in the lab
   world perceives as "the muzzle is on me" (ingredients/person.js threatOn).

   opts: holder (a person or player handle's name), weapon "Pistol" | "SMG" |
         "Rifle" | ... (CBZ.weaponIdFromName), drawn (default false: holstered)
   handle: draw(), holster(), aimAt(handle), lower(), muzzle() */
CBZ.lab.ingredient("gun", {
  uses: ["person"],
  files: ["src/weapons/weapon-data.js", "src/weapons/weapon-scale.js", "src/weapons/appearances/*.js", "src/systems/actorweapons.js"],
  make: function (W, o) {
    const THREE = window.THREE;
    const H = W.get(o.holder);
    if (!H) throw new Error("gun: no holder '" + o.holder + "'");
    const weapon = o.weapon || "Pistol";
    W.armed = W.armed || [];
    let a = H.actor;
    // THE PLAYER HOLDS IT THROUGH THE SAME DOOR: actorweapons sockets a prop
    // in any {char, group, pos} body's hand; the player's rig is playerChar.
    if (a === CBZ.player) {
      a = { char: CBZ.playerChar, group: CBZ.playerChar.group, pos: CBZ.player.pos, isPlayer: true, labName: H.name,
        armed: false, weapon: weapon, dead: false, hp: 100, maxHp: 100 };
      H.gunActor = a;
    }
    a._labWeapon = weapon; a.weapon = weapon; a._beltGun = weapon;
    let aimAt = null;
    function draw() {
      a.armed = true; a._holstered = false;
      if (CBZ.actorHolster) CBZ.actorHolster(a, false);
      if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(a);
      if (W.armed.indexOf(a) < 0) W.armed.push(a);
      W.event(H.name, "draws " + weapon);
    }
    function holster() {
      a.armed = false; aimAt = null; a._aimAt = null; a.poseAimBack = false;
      if (CBZ.actorHolster) CBZ.actorHolster(a, true);
      const i = W.armed.indexOf(a); if (i >= 0) W.armed.splice(i, 1);
      W.event(H.name, "holsters");
    }
    // the player's aim is held here (an NPC's by its own mover, person.js)
    if (a.isPlayer) {
      W.every(function (dt) {
        if (!a.armed || !aimAt) return;
        const t = aimAt;
        if (!t.pos && t.group) t.pos = t.group.position;
        if (CBZ.actorAimAt) CBZ.actorAimAt(a, t, dt);
      });
    }
    // a PERSON holds it through its own verbs (person.js draw / aimAt: the
    // same calls its brain makes when it decides to draw); the player here
    const P = !a.isPlayer && H.draw ? H : null;
    if (o.drawn) (P ? P.draw : draw)();
    return {
      actor: a, noFrame: true,
      draw: function () { (P ? P.draw : draw)(); },
      holster: function () { (P ? P.holster : holster)(); },
      aimAt: function (other) {
        if (P) return P.aimAt(other);
        if (!a.armed) draw();
        aimAt = other.gunActor || other.actor || other;
        W.event(H.name, "aims at " + (other.name || "?"));
      },
      lower: function () { if (P) return P.lower(); aimAt = null; a.poseAimBack = false; W.event(H.name, "lowers the gun"); },
      muzzle: function () { return CBZ.actorMuzzle ? CBZ.actorMuzzle(a, new THREE.Vector3()) : null; },
      state: function () {
        const p = a._weaponProp;
        return { holder: H.name, weapon: weapon, drawn: !!a.armed, visible: !!(p && p.visible), model: p ? (p.userData.weaponId || null) : null, aiming: aimAt ? (aimAt.labName || "?") : null };
      },
    };
  },
});
