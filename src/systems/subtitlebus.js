/* ============================================================
   systems/subtitlebus.js — ONE LINE, ONE SURFACE.

   THE BUG, in the owner's words (iPad/iPhone, 2026-08-21):
     "dialogue will show 2 times at once slightly offset so you can tell
      there's 2 layers of text"

   WHAT IS ACTUALLY HAPPENING. This game has FOUR independent DOM layers that
   all render spoken text into the same bottom-centre band:

     rank 40  #campaignDialogue  .campaign-dialogue   city/campaign_ui.js
     rank 30  #pinteractSay      .pi-subtitle         systems/interact.js
     rank 20  #citySpeech        .citySpeech          city/social.js
     rank 10  #hint              .hint.hint-sub       systems/hud.js

   They were never meant to collide, so the existing defence (css/hud.css's
   "--subtitle-rank" ladder) OFFSETS them: if two are up at once, the second
   one is pushed a slot higher so they don't print character-on-character.
   That is exactly right when two DIFFERENT lines are live — a ped barks while
   an authored line is on screen — and exactly wrong when it is the SAME line
   twice, because then the ladder's whole job is to render the duplicate
   neatly instead of not at all. What the owner is seeing is the ladder doing
   its job on text that should never have reached a second surface.

   WHY ONLY ON TOUCH. On desktop #hint is a BOXED PANEL — a duplicate is
   obviously a different kind of object and reads as a HUD echo. On touch,
   hud.js stamps `.hint-sub` (TOUCH_HINT_SUBTITLE) and #hint adopts the very
   same white-Fredoka/black-stroke/no-box subtitle skin, and mobile.css +
   interact_touch.css collapse `--subtitle-floor` and `--pi-sub-floor` onto
   the SAME 120px+safe-area band. Identical skin, same band, one slot apart:
   "2 layers of text, slightly offset". The phone did not introduce the
   duplicate — it removed the last visual cue that it was one.

   THE FIX. Not another offset, and not an audit of the ~45 files that call
   CBZ.citySay: a claim desk. Before a surface shows a line it CLAIMS it here.
   If a live claim already holds the same line:
     • held by an equal-or-higher rank  → the newcomer is refused, and simply
                                          doesn't show. The authored surface
                                          keeps the line.
     • held by a lower rank             → the newcomer wins and the incumbent
                                          is told to clear itself, so the line
                                          ends up on the RIGHT surface rather
                                          than on the first one that asked.
   The ladder stays exactly as it is — it is still the right answer for two
   genuinely different lines. This only ever removes a repeat.

   Matching is on the WORDS, not the markup: case, quotes, terminal
   punctuation and a `Speaker:` prefix are all normalised away, because the
   same sentence reaches these four surfaces in four different shapes (the
   hint path embeds the name in the sentence; the subtitle surfaces put it in
   a separate speaker slot).

   CBZ.CONFIG.SUBTITLE_DEDUPE = false restores the shipped behaviour exactly:
   every claim is granted and nothing is ever evicted.
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.SUBTITLE_DEDUPE == null) CBZ.CONFIG.SUBTITLE_DEDUPE = true;

  // Rank = who owns a line when two surfaces want it. Authored story beats
  // outrank the player's own verb result, which outranks an ambient ped bark,
  // which outranks a generic HUD hint. Published so a surface names its rank
  // instead of memorising a number.
  const RANK = {
    campaign: 40,
    interact: 30,
    speech: 20,
    hint: 10,
  };

  // id -> { rank, key, until, clear }
  const claims = new Map();

  function now() {
    return (typeof performance !== "undefined" && performance.now)
      ? performance.now() / 1000
      : Date.now() / 1000;
  }

  /* Normalise to the WORDS. Case, quotes and terminal punctuation carry no
     meaning for "is this the same sentence", and a `Speaker:` prefix is
     stripped when it names the speaker we were told about. */
  function normalize(text, speaker) {
    let s = String(text == null ? "" : text).trim();
    if (!s) return "";
    const colon = s.indexOf(":");
    if (colon > 0 && colon <= 34 && !/[.!?]/.test(s.slice(0, colon))) {
      const head = s.slice(0, colon).trim().toLowerCase().replace(/^(the|a|an)\s+/, "");
      const me = String(speaker || "").trim().toLowerCase().replace(/^(the|a|an)\s+/, "");
      if (me && head === me) s = s.slice(colon + 1).trim();
    }
    return s
      .toLowerCase()
      .replace(/[“”‘’"']/g, "")                 // quotes, straight and curly
      .replace(/[.!?,;…]+$/g, "")               // terminal punctuation
      .replace(/\s+/g, " ")
      .trim();
  }

  /* THE KEYS A CLAIM IS MATCHED ON — plural, and that is the point.

     The same sentence reaches these four surfaces in two different shapes:
     the subtitle surfaces put the speaker in his own element and hand us bare
     words, while the #hint path writes him into the sentence —

         "Rough up Officer #3 for me"                (#citySpeech)
         "Marcus: “Rough up Officer #3 for me.”"     (#hint)

     — so unless those compare equal the dedupe never fires on the one pairing
     that actually caused the bug. The tempting fix is to strip any short
     `Word:` head as if it were a name. Do NOT: "Deal: you first, then me."
     opens exactly the same way and is not a speaker tag, and stripping it
     would let two genuinely different lines collide and silence one.

     So a claim carries BOTH readings — the whole sentence, and the sentence
     with a plausible name tag removed — and two claims collide if ANY of their
     keys match. A real `Name:` prefix matches through the tail; "Deal:" only
     ever matches something that really does say "you first, then me". */
  function keysFor(text, speaker) {
    const full = normalize(text, speaker);
    if (!full) return [];
    const keys = [full];
    const colon = full.indexOf(":");
    if (colon > 0 && colon <= 34 && !/[.!?]/.test(full.slice(0, colon))) {
      const tail = full.slice(colon + 1).trim().replace(/^[“”‘’"']+/, "").trim();
      if (tail && tail !== full) keys.push(tail);
    }
    return keys;
  }
  function collide(a, b) {
    for (let i = 0; i < a.length; i++) if (b.indexOf(a[i]) >= 0) return true;
    return false;
  }

  function prune() {
    const t = now();
    for (const [id, c] of claims) if (c.until <= t) claims.delete(id);
  }

  /* claim(id, rank, text, secs, speaker, clearFn) -> boolean
       true  = show it (and you now hold this line for `secs`)
       false = a surface that outranks you is already saying this; stay silent.
     `clearFn` is how this desk evicts you if something better turns up. */
  function claim(id, rank, text, secs, speaker, clearFn) {
    if (CBZ.CONFIG.SUBTITLE_DEDUPE === false) return true;
    const keys = keysFor(text, speaker);
    if (!keys.length) return true;            // nothing to compare; not our business
    prune();
    const r = RANK[rank] != null ? RANK[rank] : (+rank || 0);
    const evict = [];
    for (const [otherId, c] of claims) {
      if (otherId === id || !collide(keys, c.keys)) continue;
      if (c.rank >= r) return false;          // incumbent outranks us — stay quiet
      evict.push([otherId, c]);               // we outrank it: take the line off it
    }
    // Evict only after the whole sweep, so a refusal found late never leaves a
    // surface cleared for a line that then didn't show.
    for (const [otherId, c] of evict) {
      claims.delete(otherId);
      if (typeof c.clear === "function") {
        try { c.clear(); } catch (e) { setTimeout(function () { throw e; }, 0); }
      }
    }
    claims.set(id, { rank: r, keys: keys, until: now() + (+secs > 0 ? +secs : 3), clear: clearFn || null });
    return true;
  }

  function release(id) { claims.delete(id); }

  // Mode changes, deaths and reloads all wipe every surface at once; nothing
  // should inherit a stale claim from the last life.
  function reset() { claims.clear(); }

  CBZ.subtitles = { claim: claim, release: release, reset: reset, normalize: normalize, RANK: RANK };
})();
