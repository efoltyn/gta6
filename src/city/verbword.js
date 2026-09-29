/* ============================================================
   city/verbword.js — THE WORD ON A BUTTON IS A VERB.

   OWNER (2026-09-05): "the noun should be what the button is on and it
   shouldn't say what it's on. 'Sabotage power' should just be 'Sabotage'."
   OWNER (2026-09-29): "stupidly simple, make it clear".

   Every verb in Gang City is shown pinned over, or right next to, the thing
   it acts on, so the person or the counter IS the noun. This is the one
   function that turns any registered label into what the player reads:

     CBZ.cityVerbWord("Rob the register")        -> "Rob"
     CBZ.cityVerbWord("Tell to follow")          -> "Tell to follow"
     CBZ.cityVerbWord("Pick up the bag ($1,200)") -> "Pick up $1,200"
     CBZ.cityVerbWord("Order: take the helm")    -> "Take"

   Labels are authored as verbs already (tools/city-lines-check.mjs keeps
   them that way); this is the net under a label built at runtime from data.
   Rule: the first word, then any particles, then a price or a count. No
   determiner, no noun, no dash, no dot, no parenthesis, no emoji.

   Pure: no DOM, no THREE. Loads in the page (CBZ.cityVerbWord) and in plain
   node (module.exports) so the check tool runs the renderer's own rule.
============================================================ */
(function (root) {
  "use strict";
  // words that may follow the verb and still leave a verb
  const PARTICLES = /^(up|in|out|off|on|down|away|over|back|along|around|through|to|with|for|at|by|it|one|open|shut|follow|wait|go|run|home|here|guard|me|quiet|loose|free|still|cover|rob|scare|tail|hide|all)$/i;
  const PREPS = /^(on|at|to|with|for|by|through|along|around|over)$/i;
  const PRICE = /\$\s?\d[\d,.]*\s?[kKmM]?\b/;
  /* A FEW VERBS NEED THEIR OBJECT. The rule above strips the noun because the
     noun is the thing the button sits on. When the object is NOT that thing
     (the cigarette you ask him for, the way you ask him for) the bare verb
     is a riddle: "Ask" meant three different things and "Bum one" was the
     slang that stood in for "ask for a smoke" (owner 2026-09-29: verbs in
     plain words). These whole phrases print as authored. Keep it short. */
  const WHOLE = ["Ask for a smoke", "Ask the way"];
  function verbWord(text) {
    let s = String(text == null ? "" : text).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (!s) return "";
    for (let i = 0; i < WHOLE.length; i++) if (s.toLowerCase() === WHOLE[i].toLowerCase()) return WHOLE[i];
    const price = (s.match(PRICE) || [""])[0].replace(/\s+/g, "");
    // an order prefix ("Order: take the helm") is the verb's own frame
    s = s.replace(/^(order|tell|ask)\s*:\s*/i, "");
    // drop parentheses, then cut at the first dash/dot/arrow/colon clause
    s = s.replace(/\([^)]*\)/g, " ").split(/\s+[-–—]\s+|[—–·•→:|]/)[0];
    s = s.replace(PRICE, " ").replace(/[?!.…,;"“”]+/g, " ").replace(/\p{Extended_Pictographic}/gu, " ").replace(/\s+/g, " ").trim();
    const w = s.split(" ").filter(Boolean);
    if (!w.length) return price ? "Pay " + price : "";
    const out = [w[0]];
    let i = 1;
    for (; i < w.length && out.length < 3; i++) {
      if (PARTICLES.test(w[i])) out.push(w[i].toLowerCase());
      else break;
    }
    // a PREPOSITION that was leading into a noun ("Crash on the bedroll")
    // leaves with the noun; an adverb particle ("Get in", "Back off") stays
    while (out.length > 1 && i < w.length && PREPS.test(out[out.length - 1])) { out.pop(); }
    // a trailing count ("Unload 4", "Take 2") is a figure, not a noun
    const last = w[w.length - 1];
    let count = "";
    if (!price && /^\d+$/.test(last) && w.length > out.length) count = last;
    let v = out.join(" ");
    v = v.charAt(0).toUpperCase() + v.slice(1);
    if (price) v += " " + price;
    else if (count) v += " " + count;
    return v;
  }
  verbWord.WHOLE = WHOLE;
  if (typeof module === "object" && module && module.exports) module.exports = verbWord;
  if (root) {
    const CBZ = root.CBZ || (root.CBZ = {});
    CBZ.cityVerbWord = verbWord;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
