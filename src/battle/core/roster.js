/* ============================================================
   battle/core/roster.js — WHO IS ON A SIDE, as one string. Page-independent
   (no DOM, no THREE): NPC War's war room and URL use it, and a Gang City
   host (a president's war) can hand the same strings to the same core.

   THE GRAMMAR
     "men"                         one kind; the count comes from elsewhere (n)
     "men|dolphin"                 ALTERNATING kinds over n bodies (i % kinds),
                                   the shipped mixed roster: divers and dolphins
     "m1_abrams*3,men*20"          COUNTED entries, in spawn order; the side's
                                   size is the sum (23). "3*m1_abrams" works too.
   Ids are unit ids: "men", a species id, or a vehicle id (units/manifest.js).

   PUBLIC  CBZ.battleRoster = { parse(str, n), kindAt(r, i), size(r, n),
                                ids(r), has(r, id), kinds(r), str(r) }
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ || (W.CBZ = {});
  const cache = Object.create(null);

  function parse(str) {
    str = String(str == null ? "men" : str).trim() || "men";
    if (cache[str]) return cache[str];
    let r;
    if (/[,*]/.test(str)) {
      const entries = [];
      str.split(",").forEach(function (part) {
        part = part.trim(); if (!part) return;
        const m = part.split("*");
        let id = m[0].trim(), k = 1;
        if (m.length > 1) {
          if (/^\d+$/.test(m[0].trim())) { k = parseInt(m[0], 10); id = m[1].trim(); }
          else k = parseInt(m[1], 10);
        }
        if (!(k >= 1)) k = 1;
        if (id) entries.push({ id: id, n: k });
      });
      if (!entries.length) entries.push({ id: "men", n: 1 });
      let total = 0;
      entries.forEach(function (e) { e.from = total; total += e.n; });
      r = { str: str, counted: true, entries: entries, total: total, alt: null };
    } else {
      const alt = str.split("|").map(function (s) { return s.trim(); }).filter(Boolean);
      r = { str: str, counted: false, entries: null, total: 0, alt: alt.length ? alt : ["men"] };
    }
    return (cache[str] = r);
  }
  function P(r) { return typeof r === "string" || r == null ? parse(r) : r; }
  // the unit id of body i on this side
  function kindAt(r, i) {
    r = P(r);
    if (!r.counted) return r.alt.length < 2 ? r.alt[0] : r.alt[i % r.alt.length];
    const E = r.entries;
    for (let k = 0; k < E.length; k++) if (i < E[k].from + E[k].n) return E[k].id;
    return E[E.length - 1].id;
  }
  // how many bodies: a counted roster says so itself, the rest take n
  function size(r, n) { r = P(r); return r.counted ? r.total : Math.max(1, n | 0); }
  function ids(r) {
    r = P(r);
    const out = [];
    (r.counted ? r.entries.map(function (e) { return e.id; }) : r.alt).forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); });
    return out;
  }
  function has(r, id) { return ids(r).indexOf(id) >= 0; }
  // [{id, n}] for a label: counted entries as written, alternation split evenly
  function kinds(r, n) {
    r = P(r);
    if (r.counted) return r.entries.map(function (e) { return { id: e.id, n: e.n }; });
    n = Math.max(1, n | 0);
    const L = r.alt.length;
    return r.alt.map(function (id, k) { return { id: id, n: Math.floor(n / L) + (k < n % L ? 1 : 0) }; })
      .filter(function (e) { return e.n > 0; });
  }
  function str(r) { return P(r).str; }

  CBZ.battleRoster = { parse: parse, kindAt: kindAt, size: size, ids: ids, has: has, kinds: kinds, str: str };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.battleRoster;
})();
