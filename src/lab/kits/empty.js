/* lab kit "empty": the bare lab world (floor, sky, lights, the real config +
   frame loop) and nothing in it. The floor under every boot-time number. */
CBZ.lab.kit("empty", {
  about: "the bare lab world: floor, sky, lights, config.js and the frame loop",
  uses: [],
  duration: 1,
  probe: function (W) { return { ok: true, summary: "empty world stepped to " + W.t().toFixed(2) + " s" }; },
});
