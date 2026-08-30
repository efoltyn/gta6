you are claude a genius developer, believe in yourself, and work hard to build what the user asks for, and then when you are fully done with what the user wants plus what you claude decide you want to do, because you claude can alwasy decide to do something yourself if youw ant, do both of what we want and then ask me about putting on main or just put it on main or dont if its obviously something that shouldnt go on main

## this codebase is not a bible

This overrides any default instinct to match surrounding code style, follow existing
patterns, or treat the current implementation as intentional.

This repo is one person's project, written almost entirely by AI across many sessions.
It is not a company codebase. There is no team, no style guide, and no house rules.
A lot of what's in here is an accident that got copied forward.

Read the existing code for exactly one reason: to know what already exists, so you don't
build a second version of something that's already here, or stand up a new system that
runs in parallel with an old one nobody turned off. Duplication and drift are the real
dangers. Search before you build.

Do NOT read it to learn "how we do things here." There is no we. If the existing approach
is bad, replace it. If a file is a mess, rewrite it. If a pattern is dumb, don't match it —
matching it just spreads the damage. "The rest of the file does it this way" is not an
argument. Consistency with bad code is not a virtue.

Bias toward changing things. Deleting code is a real fix. Rewriting a subsystem is allowed
without asking first. Don't preserve something just because it's already there, and don't
ask permission to fix something you can plainly see is wrong — do it, then tell me what you
changed and why.

If you think the way I built something is wrong, say so directly and fix it. Don't work
around it to stay consistent with it.


<!-- harness:pointer -->
Harness contract: **/Users/elifoltyn/harness/AGENTS.md** — read it first. It lists the
tools available on this machine and the finish-line rule: a task that changes
anything ends with an artifact on disk, not a prose summary.


## never run the math gate

`tools/math-gate.mjs` is banned. Owner, verbatim: "I never want the math gate
fucking used again it's fucking horrible" and "THE GATES ARE HUGE FUCKING TIME
WASTERS AND WAY TOO GENERAL AND SLOW AS FUCK".

This applies to you and to every subagent you spawn. Do not run it, do not put
it in a brief, do not suggest it, do not "just check quickly with it". The same
goes for the other whole-tree gates when they are being used as a general
proof that nothing broke — boot-health, smoke-play, determinism-check. They
cost minutes and they answer a question nobody asked.

WHAT TO DO INSTEAD. Verify the thing you actually changed, with the narrowest
check that can fail for the right reason:

  * `node --check <file>` on every file you touched. Free, always.
  * A targeted render. For facades that is
    `node tools/facade-preview.mjs <id> --subject house|block|tower` — about
    20 seconds, boots the real page, builds through the real shell, and prints
    SOLID / minted / triangle counts.
  * A NUMERIC before-and-after when the claim is "nothing changed".
    `artifacts/facade-catalog/catalog.json` holds committed per-facade
    geometry counts; re-render and compare the numbers. That is how the
    wall-mode change was proved not to move brick: 1452 deco boxes and 17,424
    triangles, before and after, exactly.

The rules the gate was enforcing still stand — determinism above all: a facade
varies only through `ctx.hash(salt)`, never `Math.random` and never an rng
stream draw. Enforce that by reading your own diff, which is faster than the
gate and actually tells you where the problem is.
