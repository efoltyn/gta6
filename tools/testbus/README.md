# testbus: one warm boot, everybody's checks

Booting the game is the expensive part: a city world is ~25-35 s of CPU plus shader
compiles, and minutes when eight agents each start their own Chrome at once. A
check after the boot costs seconds. So builders don't boot anything. They hand their
checks to the bus and keep working. The bus merges every queued branch onto
origin/main, boots each world ONCE in one warm Chrome, runs everybody's probes in it,
and writes each answer to a file.

## Builders: submit, keep working, look later

```sh
git commit ...                                          # the bus tests COMMITTED work
node tools/testbus/submit.mjs --probe tools/probes/president-people.mjs \
     --check tools/president-staff-check.mjs            # returns in ~0.1 s with an id
# ...keep coding. Do not wait. At a natural point (before you report):
node tools/testbus/status.mjs <id>                      # instant: QUEUED / RUNNING / PASS / FAIL
```

- `--probe FILE [args]` runs against a booted world (repeatable; put args in the
  quotes: `--probe "tools/probes/president.mjs --quick"`).
- `--check tools/x.mjs [args]` is a plain node check run in the merged tree (repeatable).
- `--world city|president|escape|survival|battle` is the default world for probes
  that don't name one in their `meta`.
- `--seed N`, `--query "cfg_FLAG=1"`, `--branch B`, `--commit SHA`.
- `--now` asks for a batch at once (skips the batching window).

`status.mjs` exits 0 PASS, 1 FAIL / BLOCKED / CONFLICT / ERROR, 2 pending. It never waits.
`status.mjs --branch B`, `--all`, `--batch latest` (the batch report), `--daemon`.
`wait.mjs <id> [--timeout s]` blocks. Don't use it as a builder: the point is that
nobody sits idle.

What a result means:
- **PASS**: every check passed on origin/main plus your branch plus everyone else's in the batch.
- **FAIL**: the bisect named YOUR branch (or your branch breaks someone else's check: `BREAKS`).
- **BLOCKED**: your check failed, but the bisect named another branch. Yours is fine.
- **CONFLICT**: your branch doesn't merge with origin/main. Merge main in and resubmit.
  A conflict with another queued branch is not reported to you. Your request just
  runs in its own mini-batch.
- A check that already fails on bare origin/main shows as `preexisting` and does not fail you.

## Orchestrators

Tell each builder: "commit, then `node tools/testbus/submit.mjs --probe <...> --check <...>`
and go on; check `status.mjs <id>` before you report. Never boot Chrome yourself."
Merge as usual. To test a merge set, submit one request per branch (or per commit
on main) with the shared checks. The batch report names the branch to fix:
`node tools/testbus/status.mjs --batch latest`.

## Writing a probe

A probe is a self-contained module in `tools/probes/`. It imports nothing; everything
comes from `t`:

```js
export const meta = { world: "president", seed: 260811, fresh: true, dirties: false };
export default async function (t) {
  await t.step(240);                                  // 240 sim ticks via CBZ.stepSim, no rendering
  const n = await t.evl("CBZ.cityPeds.length");
  t.log("peds", n);
  return { ok: n > 0, summary: `${n} peds` };
}
```

`t.evl(expr)`, `t.fn(body)` (a function body; a throw comes back as `{__err}`),
`t.step(n)`, `t.wait(expr, ms)`, `t.log(...)`, `t.errors()`, `t.args`, `t.flag("-v")`,
`t.arg("--seed")`, `t.seed`, `t.send` (raw CDP). The world is booted, then frozen
(rAF off). Time only moves through `t.step`, so a probe runs as fast as the sim
steps, not in real time.

Sharing a world: before each probe the bus snapshots the player (position, velocity,
hp, camera) and restores them afterwards. That is a SOFT reset. Declare honestly:
- `dirties: true`: the probe changes the world (kills people, starts events, wraps
  CBZ functions). This is the default.
- `fresh: true`: the probe needs an untouched world (the default). Fresh probes
  run first. A fresh probe that comes after a dirtying one gets its own page,
  booted in parallel in the same Chrome.
- `fresh: false`: fine on a used world. It runs last, with no reboot.

A plain `.js` file also works as an in-page probe:
`// testbus {"world":"city","fresh":false}` on line 1, then
`async function (tb) { tb.step(60); return { ok: true, summary: "..." }; }`.

Every ported check keeps its old command. `node tools/president-people-check.mjs`
still runs the same probe the old way (its own Chrome, its own boot) through
`tools/testbus/standalone.mjs`.

## What the batcher does

`node tools/testbus/run.mjs` (submit.mjs starts it; a lockfile keeps it to one per machine):

1. **Two lanes.** Node-only requests batch after 3 s. Requests with probes batch
   after 60 s (20 s while a world is warm), or as soon as 6 are waiting.
2. **Integration in the object store.** `git merge-tree --write-tree` +
   `commit-tree` build origin/main plus each branch in submit order as unreferenced
   merge commits. That takes milliseconds and touches no branch, index or worktree
   of anyone's. Only the final tree is checked out, into a persistent slot under
   `$TESTBUS_DIR/trees/`.
3. **Node checks first**, deduplicated across requests, in a pool of
   `cores - 2` (fewer under load). Each result lands in the request file as it
   finishes.
4. **Worlds**, booted once each in one headless Chrome. The Chrome uses a random
   debug port and its own `/tmp/cbz-testbus-*` profile, and each page gets its
   own random-port static server, so nothing collides with other runs.
   Identical probes run once. Cold boots wait while load > 4 x cores.
5. **Warm between batches.** The Chrome and the frozen worlds stay up (idle cost
   ~0). For the next batch:
   - **warm**: nothing the page serves changed (tools/, docs/, *.md), so the world
     is reused as is;
   - **hot**: every changed page file is a `.js` carrying the marker
     `testbus:hot-safe` (an idempotent file that only (re)defines functions), so
     the files are re-injected with a fresh `?v=`;
   - **reload**: anything else, or a fresh probe on a dirtied world. The page
     reboots inside the same Chrome.
6. **Bisect.** A failing check is run on bare origin/main. If it passes there,
   the bus prefix-bisects the batch's branches (log2 M runs). All the failing
   checks run together at each bisect commit, so three failures cost the same
   boots as one.
7. **Results.** `$TESTBUS_DIR/results/<id>.json` holds pass/fail per check, a
   log tail, the log path, the batch id and the culprit.
   `$TESTBUS_DIR/batches/<bid>/` holds `batch.json` (timings, load, how each world
   was acquired), `report.txt` and `logs/`.
8. **Idle exit.** After 20 min idle, the batcher closes Chrome, drops its slot
   worktrees and exits.

`$TESTBUS_DIR` defaults to `~/harness/out/gta6/testbus`. Tune it with
`TESTBUS_WINDOW_S`, `TESTBUS_WINDOW_WARM_S`, `TESTBUS_K`, `TESTBUS_NODE_ONLY_S`,
`TESTBUS_IDLE_MIN`, `TESTBUS_HEADROOM`, `TESTBUS_MAX_PAGES` and
`TESTBUS_MAX_LOAD_PER_CORE`.

## Measured (2026-10-09, M-series, 8 cores, load 20-50 from other agents)

The demo batch had 5 requests from 5 branches. Together they asked for 3 president
probes (one asked for twice), a tiny in-page probe, and 3 node checks. One branch
conflicted, and one deliberately broke a node check.

| | old way (each check boots its own Chrome) | testbus |
|---|---|---|
| agent blocked per change | 246-287 s per browser check (people 245.8, verbs 287.3, president --quick 273.1); one run hung for 20 min and had to be killed | **0.05-0.06 s** (`submit.mjs`), then `status.mjs` (instant) |
| node checks answered | after the agent's own sequence | **1-2 s** after the batch formed |
| boots | one per check per agent (people would boot twice: 2 agents asked) | **1 cold boot** (38.1 s; Chrome 0.9 s) for 4 probes + 1 reload (29.3 s) for the conflict mini-batch |
| wall time, same 3 probes + 3 node checks | 808 s sequential (+1249 s for the hang) | 660 s for everything after the boot was allowed (826 s including 3.3 min held by the load gate) |
| culprit | none; you read logs | the rooms-check break was bisected to `tb-demo-c` (FAIL), the branch that asked for it too was BLOCKED (not FAIL), and the conflict ran in its own mini-batch |

The probes here mostly step the sim (200-260 s each), so one shared boot saves
about 15% of wall time. The big win is that no agent sits idle: ~270 s per
browser check per change. The machine pays for 1 Chrome instead of N, and the
load gate keeps boots from piling onto a machine that's already saturated.

## Limits

- The reset between probes is soft (player only). Sim state is too large to snapshot
  generically, so the bus relies on the declarations. Two guards cover a wrong one:
  - A probe that fails on a world an earlier probe dirtied is re-run once on a
    rebooted world before anyone is blamed. If it passes there, the summary says
    it should declare `fresh:true`.
  - The bisect gives every probe a clean world.

  Measured in the first demo: `president --quick` passed alone, but after
  `president-verbs` left 11 agents with guns drawn, its motorcade evacuated and the
  check failed. That probe is now `fresh:true`.
- Hot reload is opt-in per file (`testbus:hot-safe`). Re-running a normal IIFE
  module would register its updaters twice, so most JS changes mean a reload.
  The reload still skips Chrome start-up and runs while other worlds stay warm.
- Bisect assumes a failure is deterministic. A flaky probe will blame someone at random.
- Probes run in the batcher's node process. A probe that never returns is cut off
  at `meta.timeoutMs` (default 30 min) and its page is closed.
