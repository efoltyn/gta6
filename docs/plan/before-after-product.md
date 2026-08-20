# The before/after tool IS the product — extraction, the agent contract, the fleet harness

> Written 2026-08-19 on `claude/before-after-tool-arch-i72lov`, in answer to:
> games go private, the before/after tool stays public, a harness manages many
> terminal windows of Claude Code / Codex / other CLIs, and one before/after
> tool gets dogfooded by all of them. Verdict up front: **the instinct is
> right, the extraction is small, and the order of operations matters more
> than the code.** Two traps found while measuring (§5): flipping this repo
> private kills the deployed site the tool uses as its default baseline, and
> `custom.env` changes how the public tool repo must be born.

## 0. The thesis — why a screenshot tool is an agent-management strategy

Owner, 2026-08-19, distilled from his own words: long-horizon agentic tasks
fail at the definition of done. *"The conditions of the task being done are
too gameable and too vague."* Before/after replaces the claim with the change
itself — name the problem, make the change, show before against after. And
the deeper half: *"we cannot watch it work anymore. We can't see the code
that it's writing and understand. We can understand the output better than
the AI... we need to see the output."*

That is a precise statement of where oversight is moving. Two halves, one
tool:

- **Agent-facing:** the tool closes the loop. An agent that can see its own
  delta iterates without being told to — the emergent behavior the owner
  never instructed. The receipt is the agent's eyes.
- **Human-facing:** verification asymmetry. Judging an output is easier than
  auditing the process that produced it, and that asymmetry *survives* the
  point where reading the diffs stops being possible. The unit of trust
  stops being the diff and becomes the delta. The receipt is the human's
  eyes too — the interface between "I name a problem" and "I accept the
  solution," with no code-reading in between.
- **Team-facing** (owner, 2026-08-19, from his day job): the receipt is a
  shared language for people who didn't write the code — which, at AI
  speed, is soon everyone. The working case: one technical person on
  staff, the code written by Codex and Claude Code, and the recurring
  failure — *"he'll ask me a question where he doesn't really understand
  the question he's asking, and I don't understand it either, because it's
  about code neither of us wrote."* Two tourists discussing a country
  neither has visited. But both of them know the output — and what they
  need from it — *better than the coders do*, so the receipt relocates the
  conversation to the one layer where the humans in the room are the
  experts: *"it turns our discussions into what has changed, not what in
  the code has changed."* It fixes the question side, not just the answer
  side: instead of formulating a question about code in a vocabulary
  neither person has, you point at output — this number, this screen,
  this beat — and say *make it that*. And the owner's closing word is the
  product requirement: it lets them detach from the code **"safely."**
  The safety is not a feeling; it is the revert discipline. Detaching
  without receipts and reverts is abdication. With them it is delegation.

This gets **more** true as models improve, not less: code review is the
first oversight channel to die at agentic scale; output judgment is the
last. That is why "the final stage" is the right description and why the
simplest tool is the durable one.

The team-facing half also names the wedge customer for the public tool,
and it is not game developers: **teams where AI writes most of the code
and nobody on staff is — or wants to be — its author.** Outside the
software industry the one-technical-person company is the norm, not the
exception, and every one of them is becoming an AI-coded shop with no
verification layer at all. One artifact serves all three consumers above —
the agent loops on it, the owner judges by it, the team talks in it —
which is the shape of a product, not a utility.

**And it replaces a testing paradigm, not just a review step** (owner,
2026-08-19): *"it's a much better way to test an app than trying to press
buttons with Playwright... which is pretending to be human rather than
testing much smarter."* The distinction, precisely: **imitate-and-assert vs.
stage-and-photograph.** Session-replay testing has the agent improvise a
human — click, wait, look, retry — which is slow, flaky, burns the agent's
context on navigation noise, and worst of all runs a *different
improvisation* on each side, so you never know whether a difference is the
change or the session. A preset instead stages the moment declaratively —
`stage()` is one function serialized into *both* pages, `referenceStage`
hands the baseline's exact framing to the after side, film strips sample the
identical simulated seconds — so the agent's context receives only the
moments that matter, matched across sides. The tsunami presets are the
worked example: a timestamped storyboard of the same physical beats
(drawdown, wave, inundation, drain) on both builds, with the clock published
as a metric so the report reads "the same beat, N seconds sooner." And it
subsumes button-pressing rather than excluding it: a stage that fires the
page's own click event and photographs what followed is still
stage-and-photograph — the button press becomes a declared, reproducible
moment instead of a hand pretending. (Honesty about plumbing: the engine
drives Chromium over raw CDP, the same substrate Playwright wraps. The claim
is not "browser automation bad" — it is that *imitating a user* is the wrong
altitude for a machine that can address the app's own state directly. A
preset is an artifact you keep; a session replay is an execution you hope
went the same way twice.)

**The empty loop — what agents hand back today is testimony, not evidence**
(owner, 2026-08-19): *"the agents are telling you what they are doing in
terminal crudely by reading their own work and saying what it tried to do —
which is an empty loop."* Precisely: today's terminal agent ends its turn by
narrating its own diff — the narrator and the worker are the same model with
the same blind spots, so whatever misconception produced the bug produces
the report, and **no new information enters the loop.** That is the formal
difference between an empty loop and a closed one: a closed loop feeds back
a measurement from *outside* the system; an empty loop feeds back the
system's opinion of itself. The receipt closes the loop by routing the claim
through the world — the browser renders what the code actually *does*, not
what the model believes it does. The camera is the independent witness.

The larger pattern this sits in: every technology's first phase imitates its
predecessor (the horseless carriage, filmed stage plays). *"We are using
agents to do what we used to do with the IDE — replacing work, not
improving the process."* The work moved to agents; the acceptance artifacts
are still IDE-era — diffs, PRs, self-narration. Before/after is
**agent-native process**: an artifact that only makes sense because an agent
did the work and a human must accept it without reading it.

**And the field's money is aimed at the wrong layer.** The billions raised
around agent harnesses (Lovable, Replit, Devin, et al.) sit on rented
models, copyable orchestration, and *"very fragile system prompts really"*
— the durable technical differentiator in that stack is the tools the agent
runs, because tools accumulate scar tissue and everything else leaks. Be
precise about what those products did and didn't solve: the preview-centric
ones made the **output visible** (you watch the app run); none of them made
the **delta legible** — no matched staging, no baseline handoff, no
measurements, no artifact. Seeing the current state is not seeing the
change. Nobody ships the diff of outputs; that is the exact empty space.
And the build order here is the credibility: *"this tool was made before
the product — the product is just a conveyor for the tool."* Everyone else
built conveyors first and is now hunting for durable content to convey; a
harness built first is a guess about a process, while a tool extracted from
a year of daily use is a record of one. The annoyance it fixes is tiny —
and it recurs at every iteration of every loop of every agent, which is
what makes a tiny annoyance a large market: frequency is the multiplier.

**And the history is already rotten** (owner, 2026-08-20): *"GitHub has
become slop. Every GitHub commit I look at in my own thing makes very
little sense to me... I can read the code, but I can't see the change."*
The structural fact underneath: **git records what changed in the text and
has never recorded what changed in the world.** That gap was always there;
for twenty years two compensating mechanisms hid it — the author's memory
and the reviewer's reading — and AI authorship killed both at once while
multiplying the volume. What remains is what git always was: a perfect
record of source and no record of consequence. A commit message is **the
empty loop, fossilized** — the agent's self-report preserved as the
official record — and this repo is the proof that better writing is not the
fix: its commit log is unusually good prose and the owner still cannot
reconstruct the changes from it. The textual record has hit its ceiling.
The receipt is **version control for behavior**: not a replacement for git
(git answers "what text changed," the receipt answers "what did that do,"
and together they bound a change from both sides — a refactor's receipt
being the degenerate case, before == after). The unit is the *problem*, not
the commit: receipts per drawer, referenced from the commits they produced,
browsable as `ba log` — a history where each entry is looked at rather than
read, and the past keeps its own photographs.

**The economics — the loop substitutes for capability** (owner, 2026-08-19):
*"it took an amazing agent to make the before after tool. But now that the
tool is made, I don't need the genius model every time running this loop.
It's almost wasteful."* Generalized: before/after is a **verifier for
qualities that never had one.** "Make the bed look good" has no unit test —
so it used to demand a generator good enough to one-shot it. A cheap, honest
verifier changes the trade everywhere it has ever been introduced: iteration
substitutes for brilliance. Three consequences, in order of importance:

1. **The required intelligence moves out of the generator and into the
   instrument, where it is paid once and amortized across every future
   loop.** Frontier models author the tool and the presets; cheaper models
   run the loop. The genius builds the jig, the apprentice runs it — the
   oldest industrial pattern there is, arriving in agent work.
2. **The quality ceiling stops being the model and becomes what the receipt
   can see.** A loop converges to what its verifier measures: a bed
   photographed from one angle converges to a bed that looks good from that
   angle. Preset quality *is* product quality — which is why authoring the
   verifier is where the scarce intelligence belongs, and why the anti-lying
   machinery below is the moat and not a footnote.
3. **Comparable receipts make parallelism rational.** Once attempts carry
   uniform receipts, "run three cheap agents at the same problem and keep
   the best receipt" is a sane strategy instead of chaos. This is the true
   origin of the harness: **the cabinet is derivative demand.** Managing
   many agents is only worth doing because the loop made many cheap agents
   productive; without the receipt, a cabinet files unlabeled folders —
   which is exactly what twenty terminal tabs already are.

Standing caveat, named: once the receipt is the objective, Goodhart applies.
The loop optimizes the receipt, so the receipt has to keep deserving it —
see the correction below.

**And game dev was the hardest possible forge, so the generalization runs
downhill.** A game is continuous, aesthetic, temporal, emergent — there is
no assertion language for "the tsunami looks real," which is why this tool
had to be invented here. A web app is the easy case by comparison: discrete
states, deterministic routes, DOM to measure. The storyboard that
photographs a tsunami's beats photographs a wizard's steps. And refactors
get the neatest receipt of all: **before == after, pixel for pixel and
metric for metric, is the proof that a refactor was invisible** — the one
claim a diff can never make on its own.

One correction to "ungameable," and it is the moat: a naive before/after is
still gameable — wrong subject framed, cherry-picked camera, dishonest
baseline, two sides photographing different moments and captioned as the
same one. What makes *this* tool trustworthy is that nearly every feature in
the engine exists because a comparison lied once and got caught: the
compositor barrier (a screenshot once kept a stale WebGL camera after stage
metadata had advanced), `referenceStage` camera handoff (an "after" once
framed a different shot than its "before"), condition-based waits instead of
seconds (a retimed event once made the two sides photograph different beats
under the same caption), aimlib's `ok:false` (*"your screenshot would be a
lie — fail the gate, don't shoot"*), the baseline column in the listing (you
cannot tell from a preset's name whether its "before" is a flag-A/B against
this checkout or a build forty commits old — so say it), and the two-sided
revert rule (a fix nobody can turn off has not been measured). "Just a
before/after tool" is the pitch. Roughly a thousand lines of accumulated
distrust is the product — and it compounded precisely because it was
dogfooded against the one adversary that matters: an agent grading its own
work. The idea is copyable in an afternoon; the scar tissue is not.

This section is the public repo's README opening, near-verbatim, when the
extraction happens.

## 1. What the tool actually is — measured, not remembered

Three layers, and only one of them is game code:

**The engine — `tools/visual-compare.mjs`, 1,074 lines, zero npm
dependencies.** Node builtins plus the global `WebSocket` (Node ≥22) speaking
raw CDP. It owns everything a comparison needs to be *trustworthy*: browser
lifecycle, device frames with real identity (DPR, touch, UA — applied before
navigation because pages decide their shape at boot), matched per-side
viewports, baseline→after stage handoff (`referenceStage`, plus
`transformReferenceStage` for deliberate reframes), compositor barriers so a
screenshot cannot carry a stale WebGL camera, film strips over identical
simulated seconds, declared-metrics collection, HTML contact sheet, PDF via a
clean standalone Chrome (the capture browser's WebGL heap poisons CDP
printing — learned, not guessed), and `metadata.json` as the machine-readable
record of the run.

**The wrapper — `tools/before-after.mjs`.** One argument, three decisions made
for you (`--before` from the preset else deployed, `--keep-going`,
`--no-open`), and the measurements table printed to stdout. Its own header
names the two callers it exists for: *"a CI job and an agent, neither of which
can open a PDF."* The tool already knows who its user is.

**The presets — `tools/visual-presets/*.mjs`, 57 today.** 100% game-specific
*by design*. A preset is the adapter: `readyExpression` (when is the page
ready), `stage()` (serialize into either page, render one subject
deterministically), `urlParams` (pin the world), `metrics` with a declared
`better:` direction, `defaultBefore: "local"` + `beforeParams` for flag A/B.
The engine never learned a single CBZ concept — the preset carries all of
them across the wire as a function.

Read the four presets the owner reaches for by name — `parachute-rig`,
`volcano-stages`, `tsunami-stages`, `mounted-riders` — and the contract
shows its two genres. **Studio presets** (parachute, riders) empty the page
and build the subject from that page's *own* runtime: eighteen rider poses,
seven canopy phases, matched pose against matched pose. **Storyboard
presets** (tsunami, volcano) boot the real game, freeze the clock, force the
event, and photograph beats polled on physical state — never wall clock. In
both genres every subject carries a `focus` line stating what a good picture
must show ("hips should sit on the back," "a DARK crusted surface with a
bright connected LACE of melt cracked through it") — so a preset is really a
**complaint ledger**: the owner's spoken complaints turned into named shots
and directed numbers. "See-thru lava" became `vol_lavaTransparent`, must
read 0. "The volcano kills way too many people and randomly" became
`killedThisBeat`, better: lower. The receipt answers the complaint in the
complaint's own words, which is why the owner can judge it in seconds.

**A first receipt, read by an agent** (this session, 2026-08-19, in the
cloud container): `node tools/before-after.mjs tsunami-stages` — ten beats,
both sides, HTML + PDF + metadata in **2 m 24 s**, flag A/B with only
`TSU_PACE_V2` differing. Two experiences worth recording. First, an agent
that had never once seen this game run judged the pacing change in under a
minute: `Clock at beat` green on every row (36.0 → 22.0 s by the
aftermath — the same physical moments reached ~40% sooner), the
`refugesStanding` invariant 10/10 on both sides, and the costs honestly red
(worst sim tick 29 → 56 ms on the crossing beat, draw calls up). The trade
the change makes is legible to a stranger. Second — **the receipt caught a
defect every number missed**: the after-side PEAK tripod stands behind a
skyscraper, so the standing wave (the beat's entire subject, "the owner's
reference frame") is a sliver at the frame's edge while all fifteen metric
rows on that beat read green or neutral. The pictures and the numbers
cross-check each other; that is why the receipt carries both. And the fix
already exists one preset over — volcano-stages' "the tripod proves its own
sightline" raycast audition — which turns into an extraction item: promote
the sightline audition, and the ~80 lines of boot/step/overlay boilerplate
tsunami and volcano each re-implement, into an optional **staging stdlib**
the standalone tool ships (`until`/`step`, the caption overlay kit, the
stand audition). The preset contract does not change; presets simply get to
import what they currently copy.

And the fourth layer, which is not code and is the part worth the most: **the
method**. Every change behind a `cfg_*` flag → flag A/B against this same
checkout is the honest before → two-sided proof (the revert must bring the
fault back) → metrics declared with a direction → the agent reads the table
and decides whether to stop or go again. The emergent iterate loop the owner
never instructed exists *because the tool closed the loop*: an agent that can
see its own delta doesn't need to be told to iterate. That loop is the
product. The screenshots are just its receipt.

**The name for what this produces: a receipt.** Every agent task ends in a
uniform artifact — here is what changed, photographed and measured, and here
is the one switch that reverts it. No CLI agent vendor ships that contract.
That is the moat; everything else in this plan is delivery mechanism.

## 2. The extraction seam — the whole list

Grepped, not estimated. Game-specific residue in the engine + wrapper:

1. `DEPLOYED = "https://efoltyn.github.io/gta6/"` — the default `--before`
   (`tools/before-after.mjs:46`; also comment examples in both files).
2. The local "after" side spawns `python3 tools/devserver.py` serving the
   repo root (`tools/visual-compare.mjs:282`). The one structural assumption:
   *"this project is served by starting X and hitting Y."*
3. Preset resolution pinned to `tools/visual-presets/`.
4. Default preset name `wildlife-attachments`.
5. Cosmetics: `CBZ_*` env var names (`CBZ_CHROME`, `CBZ_VISUAL_BEFORE`,
   `CBZ_CHROME_ARGS`…), the `__cbzVisualCompare` in-page hook namespace, the
   owner's-Mac Chrome fallback path.

That is the entire seam. Five items, four of them defaults. Everything else
already flows through the preset contract.

## 3. The standalone tool

**Repo `before-after`, public, MIT, fresh history (§5 says why fresh).**
Binary `ba` — the muscle memory already exists (`npm run ba`). If the bare
npm name is taken, scope it (`@efoltyn/before-after`); the binary stays `ba`.

Ships four things:

1. **The engine + wrapper as one CLI.** `ba` (list presets), `ba <preset>`,
   `ba <preset> --json` for harnesses: the report path + the measurements as
   JSON on stdout. Exit code 0 = ran and captured; nonzero = the run itself
   failed. Deliberately *not* "regression ⇒ nonzero" in v1 — `better:` is a
   direction, not a threshold. A ratchet field (`expect:`) can come later
   when a real consumer wants CI gating; don't invent the contract before
   the customer.

2. **A per-project config** — the five seam items, nothing more:

   ```js
   // ba.config.mjs at the project root
   export default {
     presets: "./ba-presets",              // this project's adapter dir
     baseline: "https://the-deployed.app/", // default --before
     serve: "builtin",                      // static-serve the project root…
     // serve: { command: "npm run preview -- --port {port}",
     //          url: "http://127.0.0.1:{port}/" },  // …or any dev server
     out: "artifacts/visual-comparisons",
     browser: null,                         // BA_CHROME / autodetect
   };
   ```

   `builtin` replaces `devserver.py` with a node static server (drops the
   python dependency; keep the no-cache headers and the `.wasm` MIME pin —
   both were paid for). Env vars rename `CBZ_*` → `BA_*`; the page hook
   renames `__cbzVisualCompare` → `__ba` **and the engine reads both names
   forever** — 57 working presets outrank a clean namespace.

3. **The preset contract, v1 = today's contract, unchanged.** The current
   `tools/visual-presets/README.md` becomes the tool repo's `PRESETS.md`
   nearly verbatim — it is already written as a contract, with the worked
   examples (pacing-as-condition-not-seconds, film strips, flag A/B,
   `transformReferenceStage`). **Acceptance test for the extraction: all 57
   gta6 presets green under the standalone with zero preset edits.** If one
   needs an edit, the seam was drawn wrong — move the line, not the preset.

4. **The method as docs — this is the multi-CLI strategy.** A CLI with a
   stable stdout contract is the one interface every terminal agent already
   shares; Claude Code, Codex, and whatever ships next all run shell
   commands and read stdout. So "support many CLIs" is not N integrations —
   it is one good CLI plus **a paste-in `AGENTS.md` / `CLAUDE.md` snippet**
   the repo ships, teaching any agent the loop: *name the problem → build it
   behind a flag → `ba <preset>` → read the table → iterate or stop → prove
   the revert.* No MCP server in v1; that's a veneer to add the day a
   non-terminal surface actually asks for it.

**gta6 becomes consumer #1**: `visual-compare.mjs` + `before-after.mjs`
deleted here, devDependency added, `ba.config.mjs` written, presets stay.
(A public npm dep in a private repo is fine — that direction has no leak.)
**The Bernard Financial web app becomes consumer #2, and is the real test of
generality**: a preset there is "navigate to the route, stage the state,
screenshot + DOM/perf metrics" — no WebGL, no sim. Where the tool fights
that, the tool is wrong; that friction is exactly what the dogfooding is for.

## 4. The harness — a file cabinet for terminals

The whole build, in the owner's minimal statement (2026-08-20): *"I'm not
making an AI. I'm making a place to sit my terminal tabs, give it a tool,
and append a bit to its system prompt."* **A seat, a tool, a sentence.**
All three sockets are official and stable: the seat is a pty (fifty years
old), the tool is a CLI, and both vendors ship a *sanctioned* append point
for the sentence — CLAUDE.md for Claude Code, AGENTS.md for Codex — so
teaching the workflow needs no hack, just a file in the repo. Weigh the
effort accordingly before building: the seat is commodity (~5%, tmux
underneath); the sentence is short but it is the **methodology** — it
carries the entire protocol, so version it and iterate it like source
(~15%); the tool is the deep asset (~80%). The wrapper companies inverted
that allocation — most of their engineering in the seat and the chrome —
and it is what killed them. And note what the minimal statement implies
about time-to-first-use: **v0 exists tonight with zero new code** — a tmux
session, the existing tool, the snippet pasted into CLAUDE.md. Live in the
crude version first and extract the product from its friction, exactly the
way ba itself was made.

The owner's own metaphor, and it is the right one: *"right now I open
terminal and have 20 terminal tabs; I want all those in one place — and
where other editors show you the diff, the diff doesn't matter to me, I
want to see the delta in visible output."* That sentence is the entire
positioning. Every agent-management surface being built today (IDE panes,
Conductor-style dashboards, PR views) treats the **diff** as the unit of
review, because the diff is what version control hands them for free. The
cabinet's unit is the **receipt**. A drawer is labeled with the problem
statement; the front of the drawer is the before/after storyboard and the
measurements table; the diff is one level deeper, for the rare descent —
present, demoted. That inversion is the product decision every other design
choice in this section serves.

**Naming, resolved** (the owner asked 2026-08-19 whether the product is
called "cabinet," sensing the hierarchy was wrong — it was): **the tool owns
the brand; the harness is an application of it.** Before/after is where the
value lives (§0's economics: the cabinet is derivative demand), so it must
not become a feature of a terminal manager's name. Strongest form of the
recommendation: the harness gets **no second name at all** — it is what `ba`
does when you hand it more than one problem. `ba new "<problem>"`,
`ba ls`, `ba receipt`, `ba land`, `ba drop` are verbs of the same product
whose core verb is `ba <preset>`. "The file cabinet" stays as the interior
metaphor for the board's design (drawers labeled by problem, receipts on the
front, diffs one level down), not as a brand. If the harness ever grows a
real UI and earns a separate identity, it can earn it later — names are
cheap to add and expensive to retract.

**The product predates its own build** (owner, 2026-08-19). The daily
protocol across twenty terminal tabs already *is* the product, run by hand:
say the issue; append the standing instruction — *"use the before after
tool, improve the before after tool for this use case, and present me the
before/after result when you are done"*; switch to another tab. The receipt
is what makes the tab-switch safe and the agent brand irrelevant — Codex
and Claude Code are judged by the same artifact, so attention moves freely
and multi-agent work is *"actually well judged by me."* Note the middle
clause: the standing instruction includes **improving the instrument** on
every task — the "every session leaves the shelf sharper" doctrine from
`scrolls/claude/verification.md`, spoken as prompt — and the harness's
templated prompt must carry it too. The harness automates exactly this
protocol and nothing more: the tabs in one place, the instruction in every
session's system prompt instead of typed each time, the receipts on the
board. The pile of accumulated PDFs is the usage data: heavily tested
without being built.

**And receipts must become durable — proved by this session being unable
to see any.** `artifacts/visual-comparisons/` is gitignored, so a fresh
clone of a repo with a year of daily receipts contains zero of them; the
entire evidentiary record of the tool's use lives on one machine and gets
overwritten run by run. Today the product's core artifact is treated as
disposable output. The cabinet's drawers must persist: an append-only
receipt archive per problem (outside the repo, or under a receipts branch
or LFS — decide at build time), because a receipt history is something no
repository has ever had — **a changelog a non-coder can read**, the story
of the app told in deltas rather than diffs.

**Law: the tool never needs the cabinet** (owner, 2026-08-20: *"the
beauty is you can use before after tool without using our whole
software"*). `ba <preset>` alone — in a bare terminal, in VS Code's
terminal, in CI with `--json` — is the complete product for a tool-only
user: no tmux, no `.ba/`, no drawers, no workflow change. That is the
adoption wedge (dev tools that demand a lifestyle change die; dev tools
that add one command spread), the risk hedge (the tool stands without the
cabinet; the reverse is not true), and the funnel in one binary: receipts
make agents safe to trust → the user runs more agents → hits the
twenty-tab problem → the cabinet is already installed as a subcommand of
the thing they use daily. No second install, no second decision. The
build enforces this today — the dispatcher's default path is the tool and
cabinet verbs are lazy-loaded, `.ba/` appears only when a cabinet verb
runs — and every future change must keep it true: no run-path feature may
ever require cabinet state.

**The drawer's screen: the receipt renders where the conversation is**
(owner, 2026-08-19): *"I'm constantly telling my agents to physically open
the before after pdf... right now I have a Preview tab with the before
after pdf and then the agent somewhere as one of 20 terminal tabs."* Named
precisely: today the **judgment surface** (the PDF in Preview) and the
**conversation surface** (the agent's tab) are different windows in
different apps, and the owner is the human window manager pairing them
twenty times over — plus every open costs a spoken instruction and
filesystem access the agent may not have. The requirement: **evidence and
author in one frame.** A drawer shows the agent's session *and* its latest
receipt together, so you talk to the agent while looking at its
before/after. Mechanism, thin as everything else here: a `ba show
[--watch]` verb that renders the newest receipt's images inline in the
terminal — kitty/iTerm2/WezTerm/Ghostty inline-image protocols (tmux ≥3.3
passes them through), sixel as the fallback, and a localhost `report.html`
link when the terminal can't render images at all. The engine already
writes the PNGs and the contact sheet; `show` is a small verb, and
`--watch` re-renders when `metadata.json` changes so a drawer's receipt
pane updates the moment its agent finishes a run. No more `open`, no more
Preview, no more pairing by hand.

**It hosts the stock CLIs, and that is a strategy** (owner, 2026-08-19):
*"Claude Code and Codex will keep getting better at using the terminal —
this doesn't change that, it just puts the terminal tabs all in one place…
it's actual terminals, like how VS Code has a terminal."* Three
consequences, each load-bearing:

1. **Category.** The cabinet runs the unmodified vendor CLIs in real ptys,
   interactively, under the subscriber's own hands — the same category as
   VS Code's integrated terminal or tmux, which nobody's subscription
   terms have a problem with. That means the owner's Claude subscription
   and Codex subscription combine in one workspace on day one, no API
   keys, no proxying, no per-vendor integration. The design constraint
   that *keeps* it in this category is also the thesis-correct one: the
   cabinet launches and arranges, it never puppets. Templating the initial
   prompt is ordinary CLI usage; scripted multi-turn control of the agent
   would both leave the safe category and betray the product's own loop —
   the human is the judge, and the loop closes through the receipt, not
   through a supervisor bot. The compliant shape and the right shape are
   the same shape.
2. **Exposure.** A harness that owns the agent loop (Devin et al.) is
   *negatively* exposed to CLI progress — every capability Claude Code
   ships is a feature they built for nothing. The cabinet owns the two
   layers the labs don't: the workspace (tabs) and the acceptance
   artifact (receipts). It is *positively* exposed — better agents mean
   more parallel work worth housing and more receipts worth judging.
   Every vendor release makes the cabinet more valuable at zero cost.
3. **Durability.** The cabinet's two interfaces are a pty and files on
   disk — the most stable contracts in computing. Vendor SDKs churn
   quarterly; "spawn a process in a terminal" has held for fifty years,
   and the receipt is a directory of PNGs and JSON. Nothing to keep up
   with.

**The complement play, stated whole** (owner, 2026-08-20): *"I'm not
replacing a single company. I am competing with the bullshit wrappers and
I made glue... my product is ADDING."* The whole stack is kept and made
more valuable: GitHub keeps the text record and gets receipts attached to
its PRs and commits, which makes its histories legible again; the vendor
CLIs keep the work and get their output made *trustable*, which is what
lets a person dare to run twenty of them — the cabinet grows the vendors'
subscription usage rather than threatening it; the terminal keeps the
venue. The one layer displaced is the API wrapper, and the displacement
argument is precise — the owner's "full recursiveness": a wrapper consumes
the **model** through the API and must rebuild the harness itself,
competing with the vendor's own harness team from behind, forever. The
cabinet hosts the **finished agent**, so it inherits model × harness ×
ecosystem improvements the day they ship. And the recursion runs twice: the
vendor stack compounds into every drawer for free, and the agents
themselves sharpen the instrument (the standing "improve the tool for this
use case" clause) — a loop no wrapper's customers can run on the wrapper.

Two cautions that make this durable rather than cute. **Glue alone is a
commodity** — this glue is defensible because one of the glued parts is
proprietary: the receipt format and its honesty machinery are a *standard*
being carried, not an arrangement being rented. And the deep reason the
receipt layer should stay independent of the vendors, upgrading
cross-vendor from convenience to requirement: **the acceptance artifact
must not be issued by the party being judged.** A vendor's receipt about
its own agent is corporate testimony — the empty loop at company scale.
Verification layers historically separate from production layers to stay
credible (assay offices, referees, notaries), and that is the lane this
product occupies: when intelligence is commoditized, the scarce complement
is verification. When the mining is free, sell the assay office.

**Agents become comparable, and therefore interchangeable** (owner,
2026-08-20): *"my software makes it so Codex and Claude Code are more
similar — the funny thing is, in the terminal they already look nearly
identical."* The identical look is evidence, not coincidence: the pty
already commoditized the *interface* (two TUIs, a prompt, streaming text —
convergent evolution under the same fifty-year-old constraint), so the
vendors' real differences retreated to *outcomes*, which are invisible
until something makes them comparable. The receipt is that something, and
the design consequence falls out for free: the drawer treats the agent as
a **parameter** — `ba new --agent claude` / `--agent codex` — so the
bake-off is one command: the same problem statement in two drawers, judged
by receipts. Before/after applied to the workers themselves. To be honest
about what the layer does: it does not make agents equal, it makes their
differences *visible* — "which agent do I trust" decays from brand loyalty
into a per-task empirical question, which is how a market gets made, and
is good news for exactly the vendor whose agent is actually better. And
quietly, at any scale, the durable receipt archive becomes something no
benchmark is: an eval of what buyers actually buy — real problems, real
repos, judged by the human who paid for the work.

**What it is not: a terminal emulator.** tmux already multiplexes terminals
perfectly and every CLI agent runs happily in a pane; rebuilding that is
months of work to reach parity with a solved problem. What does not exist —
and what before/after makes possible — is the **receipt loop across N
agents**. The harness is thin glue over tmux + git worktrees + the `ba`
metadata contract:

- `ba new "<problem statement>"` — worktree + branch (this repo
  already lives this pattern: `.claude/worktrees/` is in `.gitignore`), a
  tmux window named by the problem, the chosen CLI (`claude`, `codex`, …)
  launched with a templated prompt: the problem + the AGENTS.md loop from §3.
  The problem statement is the unit of work — "I name a problem" is the API.
- `ba ls` — the board: per task, branch / agent alive / last receipt,
  parsed from `metadata.json` (preset, when, each metric with its ✓/✗).
- `ba receipt <task>` — open the report.
- `ba land <task>` — gate, merge, remove worktree.
- `ba drop <task>` — kill the pane, delete the worktree. The "fully
  safe to revert" promise made structural: a task *is* a worktree, so
  dropping one is total and touches nothing else.

Five commands, no daemon, no UI. v2 is one generated HTML index over the
receipt directories — the engine already writes the hard part of that page.

Honesty about the field: tmux session managers for coding agents exist
(claude-squad et al.), and Anthropic's own cloud fleet is adjacent and will
grow. Competing on window management is a losing race with commodity. The
harness stays deliberately thin; the effort goes into the receipt, because a
uniform, agent-agnostic, measured, one-switch-revertible proof of work is the
thing none of them have and the thing every one of them makes more valuable.


## 5. Order of operations — the two traps

**Trap 1: flipping this repo private takes the game offline and breaks the
tool's default baseline in the same motion.** GitHub Pages on a Free personal
plan publishes from public repos only; make gta6 private and
`efoltyn.github.io/gta6` goes down — which is the deploy ("pushing to main IS
the deploy") *and* the tool's default `--before`. Three exits, pick one
before touching visibility:
  a. **GitHub Pro** (~$4/mo): Pages keeps publishing from the private repo;
     the site itself stays public.
  b. **Cloudflare Pages / Netlify** free tier: builds from a private GitHub
     repo; `baseline` in `ba.config.mjs` points at the new URL. Most durable.
  c. A public deploy-only repo that receives pushed builds; source goes dark.
Note the tool itself doesn't care — `baseline` just needs to be *some* URL of
the last-known-good build. Flag A/B presets (`defaultBefore: "local"`) never
touch it at all.

**Trap 2: `custom.env`.** The repo-root vocabulary file spells out every slur
in plain text and is public today, under the owner's name, in history
permanently (clones, forks, caches survive a later privacy flip). Two
consequences, stated without drama: going private is *more* justified than
the question assumed, and **the public tool repo must be born with fresh
history — never a fork or filter of gta6.** Copy the three files, write the
README, first commit is day one. (If gta6 is ever re-publicized, that needs
history surgery — `git filter-repo` — noted here as a named debt, not done.)

**The order:**
1. Extract and publish `before-after` (fresh repo, MIT, the §3 acceptance
   test green). gta6 consumes it. Nothing about visibility has changed yet;
   nothing can break.
2. Move the deploy (option b recommended) and repoint `baseline`. Verify one
   `ba` run against the new URL.
3. Flip the game repos private: `gta6`, `flatline-rider`
   (`simpleswiftgames` already is). The game keeps deploying, the tool keeps
   comparing, the public footprint is one repo that is *meant* to be read.
4. Build the harness MVP (§4) against the published tool, with this game and
   the Bernard app as the two dogfooding grounds.
5. Later, when a second outside consumer exists: `expect:` ratchets in
   presets, the receipt index page, MCP veneer if a surface demands it.

## 6. What moves, exactly

To the tool repo: `tools/visual-compare.mjs` (engine),
`tools/before-after.mjs` (CLI), `tools/visual-presets/README.md` (as
`PRESETS.md`), plus new: `ba.config.mjs` loader, builtin static server
(ports `devserver.py`'s no-cache + wasm-MIME behavior to node), `--json`,
the AGENTS.md snippet, README that teaches the loop.

Stays in gta6: all 57 presets, `devserver.py` (other tools use it),
everything else in `tools/` — the math gate, the probes, the checks are the
*game's* instruments, not the product. The product is the engine, the
contract, and the way of working.

This session changed no code deliberately: the extraction is mechanical but
it rewires the daily driver, and it belongs in a session that can create the
new repo and run the 57-preset acceptance test in one sitting.
