/* lab kit "chair-tip": one loose chair, shoved by hand through the real
   pushables tip() path. The smallest test that furniture.js + pushables.js
   stand up in the lab: the chair must slide, then go over. */
CBZ.lab.kit("chair-tip", {
  about: "a loose chair; at 0.5 s it is driven over (pushables' own tip), at 2 s checked lying",
  uses: ["chair"],
  duration: 3,
  setup: function (W) { W.add("chair", { name: "chair", at: [0, 0], yaw: 0 }); },
  script: function (W) {
    return [[0.5, function () {
      const c = W.get("chair").piece;
      if (c && CBZ.pushables && CBZ.pushables.tip) CBZ.pushables.tip(c, 1, 0);
      else if (c) { c.vx = 3; }
    }, "knock the chair over"]];
  },
  probe: function (W) {
    const c = W.get("chair");
    const s = c.state();
    return { ok: !!c.piece && s.tipped, summary: "chair " + (s.tipped ? "lying" : "upright") + ", moved " + s.moved + " m", data: s };
  },
});
