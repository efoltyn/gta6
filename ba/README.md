# ba — before/after

The commit log stopped being a record of what happened. You can read the code,
but you can't see the change.

That gap was always there. Git records what changed in the *text* and has never
recorded what changed in the *world*; for twenty years two things covered for
it — the author's memory and the reviewer's reading — and AI authorship removed
both at once while multiplying the volume. What's left is what git always was:
a perfect record of source and no record of consequence. Better commit messages
don't fix it: this tool was built in a repo whose commit log is unusually good
prose, and whose author still can't reconstruct his own changes from it.

The same gap sits at the end of every agent's turn. An agent finishes a long
task and hands you its account of its own diff — but the narrator and the worker
are the same model with the same blind spots, so whatever misconception produced
the bug produces the report. Nothing enters the loop from outside it. That's
testimony, not evidence.

## What it is

The simplest tool that closes it: **before and after, staged identically,
measured.**

Two builds of your app. The same moments, staged the same way on both sides,
photographed from the same place, with the numbers you declared printed
underneath. You get PNGs, an HTML contact sheet, a print-ready PDF, and a
`metadata.json` — and the measurements table prints to stdout, so a terminal
agent or a CI job can read the result without opening anything.

That artifact is the **receipt**. It is the deliverable, and it is the unit of
review: not "here is the diff," but "here is what the change did."

Node 22+, zero npm dependencies. It drives Chrome over CDP directly.

## Quick start

```sh
npx ba                    # list this project's presets
npx ba checkout-flow      # run one — report path + measurements print when it finishes
```

Add `ba.config.mjs` at your project root. Five fields, all with defaults — a
repo with a `./ba-presets/` directory needs no config file at all:

```js
export default {
  presets: "./ba-presets",                   // where this project's presets live
  baseline: "https://your-app.example.com/", // the default "before"
  serve: "builtin",                          // static-serve the project root…
  // serve: { command: "npm run preview -- --port {port}",
  //          url: "http://127.0.0.1:{port}/" },   // …or your own dev server
  out: "./artifacts/ba",                     // where receipts land
  browser: null,                             // BA_CHROME, or autodetect
};
```

Then write your first preset — a module naming the subjects worth photographing
and one `stage()` function that is serialized into **both** pages. Start from
[`PRESETS.md`](./PRESETS.md); the contract is short, and every rule in it was
paid for.

## The loop

1. **Name a problem.** Not a task list — a problem. That is the unit of work.
2. **Build the whole solution behind a revert switch** — a feature flag, a
   config key, whatever the project already uses.
3. **Run `ba <preset>`.** With the switch, you get the strongest baseline there
   is: your own checkout against itself with the flag off, so the two columns
   differ by exactly your change and nothing else.
4. **Read the table and look at the shots.** Both — a number can move while the
   picture is still wrong.
5. **Iterate.** If the delta isn't right yet, you're one loop in, not done.
6. **The revert stays one switch** the whole time. A fix nobody can turn off
   has not been measured.

[`PROTOCOL.md`](./PROTOCOL.md) is that loop written as instructions to an agent.
Paste it into your `CLAUDE.md` or `AGENTS.md` and any terminal agent — Claude
Code, Codex, whatever ships next — runs it, because a CLI with a stable stdout
contract is the one interface all of them already share. Supporting many agents
isn't N integrations; it's one good CLI and one page of text.

## Stage and photograph, don't pretend to be human

The usual way to test a UI is to have something improvise a user: click, wait,
look, retry. That's slow, flaky, and — the part that actually matters here — it
runs a *different improvisation on each side*, so you can never tell whether a
difference is your change or the session.

A preset declares the moment instead. One `stage()` function is serialized into
both pages; `referenceStage` hands the baseline's exact framing to the after
side; film strips sample the identical simulated seconds. The agent's context
receives only the moments that matter, matched across sides.

This subsumes button-pressing rather than excluding it: a stage that fires the
page's own click handler and photographs what followed is still
stage-and-photograph — the press becomes a declared, reproducible moment instead
of a hand pretending. And to be honest about the plumbing: this drives Chromium
over raw CDP, the same substrate the automation frameworks wrap. The claim isn't
that browser automation is bad. It's that *imitating a user* is the wrong
altitude for a machine that can address the app's own state directly. A preset
is an artifact you keep; a session replay is an execution you hope went the same
way twice.

## Every honesty feature exists because a comparison lied once

A naive before/after is still gameable: wrong subject framed, cherry-picked
camera, dishonest baseline, two sides photographing different moments and
captioned as the same one. Nearly every feature below was added the day one of
those got caught.

- **Matched staging (`referenceStage`).** An "after" once framed a different
  shot than its "before". Now the baseline's camera is handed forward, and a
  deliberate reframe has to be declared out loud.
- **Physical-condition waits.** Three beats once waited a fixed number of
  seconds into a phase whose *length* was the thing under test. When the timing
  changed, the same six seconds walked into the wrong beat and both sides were
  captioned identically. Waits are conditions now, and the clock is published as
  a metric — so the report reads "the same beat, N seconds sooner."
- **The compositor barrier.** A screenshot once kept a stale WebGL frame after
  the stage metadata had already advanced: correct numbers, wrong picture.
- **The sightline audition.** Every blind camera-placement rule was eventually
  defeated by some seed's geometry — one parked the camera inside a tower and
  shipped a portrait of an office block, reporting success. Now the tripod
  raycasts its own sightline and takes the first stand that can actually see the
  subject; if none can be proved, it says so on the shot.
- **Honest failure.** A stage that can't find its subject returns `ok: false`
  instead of photographing the empty space where it should have been. Your
  screenshot would be a lie — fail the beat, don't shoot.
- **The baseline column.** You can't tell from a preset's name whether its
  "before" is your own checkout with a flag off or a build forty commits old.
  The listing says which.
- **Two-sided reverts.** A change is only measured if it can be turned off, and
  the strongest comparison a preset can make is against its own revert switch.

"Just a before/after tool" is the pitch. About a thousand lines of accumulated
distrust is the product — and it compounded because it was dogfooded against the
one adversary that matters: an agent grading its own work. The idea is copyable
in an afternoon. The scar tissue isn't.

## More than one problem at a time

The core verb is `ba <preset>`. Hand the same binary more than one problem and
it has verbs for that too. `ba new "<problem statement>"` opens a drawer — a git
worktree, a branch, and a tmux window running the stock vendor CLI in it with an
opening prompt, then it stops; the tool launches, it never puppets. Because a
task *is* a worktree, `ba drop` makes "safe to revert" structural rather than a
promise: one directory and one branch, touching nothing else. `ba ls` is the
board — per drawer, whether its agent is still alive and whether it has produced
evidence yet — and `ba show` prints the receipt *in* the terminal, images and
measurements together, so you can talk to an agent while looking at its
before/after instead of pairing a PDF window to a terminal tab by hand. `ba log`
is the history, `ba land` merges one. Note what the board deliberately does not
show: the diff. Every other agent-management surface leads with it, because the
diff is what version control hands them for free. Here the diff is one level
down, for the rare descent, and the delta is on the front of the folder.

---

Forged over a year inside a 470,000-line AI-written game, where it grew 67
presets and got pointed at everything from a tsunami's pacing to an intro screen
at three device widths. A game was the hardest possible forge — nothing
continuous, aesthetic, or emergent has an assertion language, which is why the
tool had to be invented there. Everything else is the easy case.

MIT.
