/* tools/probes/wrap-churn.mjs — A FUNCTION THAT IS RE-WRAPPED EVERY FRAME.

   The pattern all over this codebase: a module wraps a shared CBZ function
   lazily, from a per-frame tick, and marks ITS wrapper (fn._xWrapped) so it
   never wraps twice. Two modules doing that to the same function never
   settle: A sees B's wrapper (no _aWrapped on it) and wraps it, B sees A's
   (no _bWrapped) and wraps that, every frame, forever. The chain of closures
   grows without end (heap), and every call walks the whole chain (stack
   depth, CPU) until the call overflows. 2026-10-29: killstreakOnDown in the
   prison grew two closures a frame (entities/ai.js x systems/prisonfriends.js).

   This records the identity of every function on CBZ and one level down
   (CBZ.econ.steal, CBZ.verbs.strike...), steps the real loop, and names
   every one that keeps changing. Run it in each world:

     node tools/testbus/standalone.mjs tools/probes/wrap-churn.mjs --world escape
     node tools/testbus/standalone.mjs tools/probes/wrap-churn.mjs --world isles
     (--steps 120)

   Exit 0 = every function settled, 1 = something is re-wrapped per frame. */
export const meta = { fresh: true, dirties: true, timeoutMs: 15 * 60e3 };

export default async function (t) {
  const steps = +t.arg("--steps", 120);
  await t.evl("window.__tbFreeze && __tbFreeze()");
  const r = await t.fn(`
    for (var w = 0; w < 120; w++) CBZ.stepSim(1 / 60);       // past the intro, lazy wraps armed
    function snap() {
      var m = new Map(), seen = new Set();
      for (var k in CBZ) {
        var v; try { v = CBZ[k]; } catch (e) { continue; }
        if (typeof v === "function") m.set("CBZ." + k, v);
        else if (v && typeof v === "object" && !seen.has(v) && !v.isObject3D && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set) && !ArrayBuffer.isView(v)) {
          seen.add(v);
          var keys; try { keys = Object.keys(v); } catch (e) { continue; }
          if (keys.length > 400) continue;
          for (var i = 0; i < keys.length; i++) { var f; try { f = v[keys[i]]; } catch (e) { continue; } if (typeof f === "function") m.set("CBZ." + k + "." + keys[i], f); }
        }
      }
      return m;
    }
    var prev = snap(), changes = {};
    for (var s = 0; s < ${steps}; s++) {
      CBZ.stepSim(1 / 60);
      var cur = snap();
      cur.forEach(function (f, k) { if (prev.has(k) && prev.get(k) !== f) changes[k] = (changes[k] || 0) + 1; });
      prev = cur;
    }
    return { mode: CBZ.game && CBZ.game.mode, steps: ${steps}, churn: Object.keys(changes).map(function (k) { return [k, changes[k]]; }).sort(function (a, b) { return b[1] - a[1]; }) };
  `, 12 * 60e3);
  if (!r || r.__err) return { ok: false, summary: "ERROR " + (r && r.__err) };
  for (const [k, n] of r.churn) t.log(`${String(n).padStart(5)} / ${r.steps} frames  ${k}`);
  const bad = r.churn.filter((c) => c[1] >= r.steps * 0.5);
  return { ok: bad.length === 0, summary: `${r.mode}: ` + (bad.length ? bad.length + " function(s) re-wrapped every frame: " + bad.map((c) => c[0]).join(", ") : "every function settled") + (r.churn.length > bad.length ? ` (${r.churn.length - bad.length} changed now and then)` : ""), data: r };
}
