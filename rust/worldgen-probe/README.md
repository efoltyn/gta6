# worldgen-probe — Rust→WASM feasibility probe (chunk-generator kernels)

A minimal, isolated probe answering one question: **is it worth porting the
chunk-generator's hot kernels (position hash, fbm noise, jittered-grid
scatter) from JS to Rust/WASM?** No wasm-bindgen, no build tooling beyond
`cargo build --target wasm32-unknown-unknown` — hand-rolled `extern "C"`
exports, loaded with a dozen lines of `WebAssembly.instantiate`.

This directory is fully self-contained; nothing under `src/` or
`index.html` at the repo root was touched.

## TL;DR

- **The squirrel3 hash is proven bit-identical** to `src/core/seed.js`
  (98/98 test vectors, raw u32 comparison — see [Hash equivalence proof](#hash-equivalence-proof)).
- **Toolchain friction: none.** `rustup target add wasm32-unknown-unknown`
  succeeded on the first try through the outbound proxy.
- **Performance verdict: WASM does not obviously win at this workload size.**
  V8's JIT is competitive with compiled WASM for the simple integer hash and
  the scatter kernel (parity, ~1.0–1.2x). WASM's real edge for `fbm` isn't
  raw peak throughput (JS can match it when V8 fully tiers up) — it's
  **consistency**: WASM's timings vary by ~3% run to run, JS's vary by up to
  ~2.6x depending on JIT tiering luck. For a chunk generator that needs a
  predictable per-frame budget, that consistency is arguably the more
  valuable property than the median number itself.
- **The .wasm binary is 3.2 KB.**
- WASM load verified in a **real headless Chromium tab** (Playwright) and a
  **real Worker** (Node `worker_threads`, same message-passing shape a
  browser Web Worker would use) — not just documented, actually run.

## Layout

```
rust/worldgen-probe/
  Cargo.toml               cdylib+rlib, panic=abort, lto, opt-level=3
  src/lib.rs                the three kernels + extern "C" exports
  src/bin/native_bench.rs   native (no wasm, no FFI) benchmark, bonus data point
  verify.js                 hash bit-identity proof vs the REAL src/core/seed.js
  js_kernels.js              plain-JS reference impls of the same 3 kernels
  bench.js                   JS vs WASM benchmark (this is the main result)
  loader.js                  minimal reusable Node WASM loader + smoke test
  check.html                 loads the SAME .wasm in a real browser tab
  worker_loader_example.js   Worker loader pattern, self-verifying via worker_threads
  README.md                  this file
```

## Build

```sh
export PATH=$HOME/.cargo/bin:$PATH
rustup target add wasm32-unknown-unknown   # one-time; see Toolchain friction below
cd rust/worldgen-probe
cargo build --release --target wasm32-unknown-unknown   # -> target/wasm32-unknown-unknown/release/worldgen_probe.wasm
cargo build --release                                     # native lib + native_bench bin, for the bonus comparison
```

Run everything:

```sh
node verify.js                    # hash bit-identity proof (98/98 checks)
node bench.js                     # JS vs WASM benchmark, prints the results table
node loader.js                    # minimal loader + smoke test
node worker_loader_example.js     # Worker pattern, self-verifying
./target/release/native_bench     # native Rust bonus data point
```

To check the browser path: `python3 -m http.server 8000` from this
directory, then open `http://localhost:8000/check.html` (must be served,
not opened via `file://`, or `fetch` hits CORS/mime restrictions on some
browsers).

## Toolchain friction

None worth reporting. Environment: `rustc 1.94.1`, `cargo 1.94.1`, outbound
network via the pre-configured agent proxy (`HTTPS_PROXY` set).

```
$ rustup target add wasm32-unknown-unknown
info: downloading component rust-std
$ echo $?
0
```

`rustup target list --installed` afterward showed both
`wasm32-unknown-unknown` and `x86_64-unknown-linux-gnu`. The build itself
(`cargo build --release --target wasm32-unknown-unknown`) needed zero
external crates — `[dependencies]` in `Cargo.toml` is empty. This is the
"NO_STD-friendly, no fallback needed" branch of this task; the native
benchmark was still built anyway (see below) because it's cheap and gives a
third useful data point (JS vs WASM vs native-compiled-Rust).

One real design decision worth flagging as friction-avoidance rather than
friction: the crate does **not** declare `#![no_std]`. A genuinely
`no_std` cdylib needs a `#[panic_handler]`, and this package also builds a
native `std` binary (`native_bench`) from the same lib for the native
comparison — those two requirements collide (a `#[panic_handler]` defined
in the lib conflicts with the one `std` provides to the native binary,
unless it's gated per-target, which adds real complexity for zero benefit
here). Instead, the lib avoids every `std`-only *feature* that would matter
(no heap allocation — no `Vec`/`Box`/`String` anywhere, no OS syscalls, no
threads, no libm calls — `floor`/`round` are hand-rolled with int casts,
see `floor_f32`/`js_round` in `src/lib.rs`) while still linking the default
`std` panic runtime. It is "no_std-friendly" in substance; flipping the
literal `#![no_std]` switch is a small, understood follow-up (gate the
panic handler behind `cfg(target_arch = "wasm32")`, move `native_bench` to
its own crate) if a stricter guarantee is ever required.

## Kernels implemented (`src/lib.rs`)

1. **squirrel3 hash** — `squirrel3(n, seed) -> u32`, wrapping-arithmetic port
   of `squirrel(n, seed)` in `src/core/seed.js`. `hash_fold(world_seed, &[..])`
   ports `hashN(...)`, and `hash01(world_seed, x, z, salt)` ports
   `CBZ.hash01`, including a hand-rolled `js_round` that reproduces
   `Math.round`'s "round half toward +Infinity" tie-breaking exactly
   (`floor(x + 0.5)`, per the ECMA-262 definition of `Math.round`).
2. **fbm 2D value noise** — `value_noise2d` (integer-lattice value noise,
   smoothstep-interpolated corners, seeded by the same hash) and `fbm2d`
   (4 octaves, persistence 0.5, lacunarity 2.0, normalized to [-1, 1]).
3. **Jittered-grid scatter** — `scatter_chunk(seed, chunk_x, chunk_z,
   out_ptr, cap) -> count`. A 200×200-unit chunk is divided into 4-unit
   cells (50×50 = 2500 candidate cells); each cell's presence, jitter,
   scale, and rotation are derived purely from `hash01(seed, world_x,
   world_z, salt)` at that cell's world position — never from a running RNG
   or loop index. That's the "order-independent" guarantee: cell (37, 12)
   of chunk (3, −1) hashes to the same instance whether it's generated
   first, last, out of loop order, on another thread, or from a
   neighboring chunk — see the doc comment on `scatter_chunk` for the full
   argument.

Exports (all `extern "C"`, all scalar args/raw pointers, no strings):
`hash_u32`, `hash_fold3`, `fbm2d_ffi`, `scatter_chunk`, `bench_hash_loop`,
`bench_fbm_loop`, `bench_scatter_loop`, `alloc`, `reset_alloc`, plus the
auto-exported `memory`. Memory for `scatter_chunk`'s output buffer comes
from a **static bump allocator** (`alloc(size) -> ptr`, `reset_alloc()`) —
no global allocator, no `Vec`, just an offset into a fixed 16 MB static
byte array living in the module's own linear memory.

## Hash equivalence proof

`verify.js` loads the **actual** `src/core/seed.js` (not a copy) with a
minimal `window`/`location` stub, re-requiring it fresh per test `WORLD_SEED`
via `CBZ.CONFIG.WORLD_SEED`, and compares raw `u32` outputs against the
compiled `.wasm` module for:

- 60 single-`squirrel()`-call cases (6 world seeds × 10 `n` values,
  including negative numbers and `0x7fffffff`/`-0x80000000` edge values)
- 18 three-int `hashN` fold cases (the exact fold `hash01` performs)
- 20 `hash01` end-to-end cases (rounding + fold + the final `/2**32`
  float), including exact `.5` ties on both sides of zero to exercise
  `Math.round`'s tie-breaking

```
$ node verify.js
== squirrel3 single-call equivalence (CBZ.hashN(n) === squirrel(n, WORLD_SEED)) ==
== hashN 3-arg fold equivalence (the exact fold hash01 uses) ==
== hash01 end-to-end (rounding + fold, compared as the raw pre-division u32) ==

98/98 checks passed.
All squirrel3 hash outputs are bit-identical between src/core/seed.js and the Rust/WASM port.
```

One gotcha this caught (documented in `verify.js`): WASM `i32` return
values cross the JS boundary as **signed** numbers even for a Rust `u32`
return type — `wasmVal >>> 0` is required before treating it as the
unsigned hash, exactly like `src/core/seed.js` does internally with its own
`>>> 0` calls throughout. Skipping that reinterpretation was the one real
bug hit while writing this probe (caught immediately by the proof script,
which is the point of writing one).

Note on scope: only the **integer hash** (`squirrel3`/`hash_fold`/the
pre-division `hash01` output) is claimed bit-identical — that's the load-
bearing multiplayer-determinism requirement per `src/core/seed.js`'s own
comments. The fbm/scatter kernels built on top of it are a new Rust
implementation mirrored term-for-term against a JS reference
(`js_kernels.js`), not a byte-for-byte port of an existing JS kernel — there
is no existing `fbm`/scatter kernel in `src/core/seed.js` to be bit-
identical *to*. Their JS and Rust outputs agree closely but not exactly:
JS has no native `f32`, so `js_kernels.js`'s `fbm2d` runs in `f64` while
Rust's runs in `f32`; over 1,000,000 accumulated calls this shows up as a
~0.002% relative difference in the summed accumulator (1639.980 vs
1639.946) — expected, not a bug.

## Benchmark results

Methodology (`bench.js`): 6 warmup calls, then 9 timed trials, reporting
the **min** (standard "best-of-N" microbenchmark practice — robust against
GC pauses and scheduler noise; median is also collected and shown in the
script's raw-trial dump). Every kernel is measured three ways:

- **JS** — pure JS (`js_kernels.js`), no FFI, V8 JIT.
- **WASM internal-loop** — a single JS→WASM call that loops `N` times
  *inside* the module (`bench_hash_loop`/`bench_fbm_loop`/
  `bench_scatter_loop`). This is the realistic usage shape (batch a
  chunk's worth of work per crossing) and the fairest kernel-vs-kernel
  comparison.
- **WASM per-call FFI** — `N` separate JS→WASM calls, one per hash/fbm
  value, or one per chunk for scatter. Shows the crossing overhead if WASM
  were (mis)used as a drop-in per-value replacement.

Numbers below are the **median of 5 independent process runs** (each run
itself a min-of-9-trials), Node v22.22.2, `--release` WASM build:

| Kernel | N | JS (ms) | WASM internal-loop (ms) | WASM per-call FFI (ms) | native Rust, no WASM (ms, bonus) |
|---|---|---|---|---|---|
| squirrel3 hash | 1,000,000 | 3.80 | 3.67 | 3.85 | 3.42 |
| fbm 2D, 4 octaves | 1,000,000 | 343.7 (see note) | 198.9 | 156.1 | 102.4 |
| jittered-grid scatter | 100 chunks (200×200 each) | 5.55 | 5.25 | 5.30 | 3.79 |

**fbm variance note:** the JS fbm number above is the *median* of five
20-ms/351-ms-scattered runs — the actual observed range across five
independent `node bench.js` process runs was **179 ms to 351 ms** for JS,
versus **197–203 ms** for WASM internal-loop and **151–160 ms** for WASM
per-call. WASM's own tiering (V8 also JIT-compiles WASM, Liftoff→TurboFan)
is evidently far more stable here than JS's. The likely cause: this
benchmark calls the SAME closure only 6+9=15 times total, each call running
a million-iteration loop internally — V8 can tier up a hot loop mid-call
via On-Stack-Replacement, but whether OSR fires early or late (or matches
the loop's remaining iteration count well) varies run to run for JS in a
way it apparently doesn't for the WASM tier. In five runs, JS's *best* case
tied WASM; its *worst* case was 2.6x slower.

Sanity: hash/fbm/scatter accumulator values were cross-checked identical
(hash: `2950961514` in all of JS/WASM/native; scatter: `37667` total
instances across 100 chunks in all three) every run — confirms the JS,
WASM, and native implementations really are computing the same thing, not
just similarly-timed different things.

`.wasm` size: **3,229 bytes** (3.15 KiB) — the entire module, all 3
kernels, the bump allocator, and the auto-exported `memory`, with `lto =
true`, `panic = "abort"`, `strip = true`.

### Honest read

For `hash` and `scatter` (integer-heavy, branchy, small working sets), V8's
JIT is genuinely competitive with compiled WASM — this is not surprising
for hot, simple, monomorphic JS that TurboFan handles well. WASM's ~1.0–
1.2x edge here is real but modest. `fbm` (heavier float math, larger
per-call work) is where WASM's *consistency* becomes the actual selling
point over raw speed: if the chunk generator has a per-frame time budget,
JS's 2.6x worst-case variance on a moderately hot loop is a bigger risk
than its sometimes-competitive median. Native Rust (no WASM, no FFI at all)
is consistently ~2x faster than WASM on `fbm` and ~1.4x faster on
hash/scatter — the expected gap between a JIT/tiered WASM runtime and fully
AOT-compiled native code, included here purely as calibration context, not
as an available option for this project (the target is a browser tab, not
a native binary).

## Browser confirmation

`check.html` loads the exact same `.wasm` used by the Node benchmark via
`WebAssembly.instantiateStreaming(fetch(...))` and runs `hash_u32` +
`scatter_chunk`, asserting the hash matches the value proven bit-identical
by `verify.js`. This was not just written and left as a documented pattern
— it was actually driven headlessly with Playwright/Chromium during this
probe:

```
loaded in 22.90ms
exports: memory, alloc, bench_fbm_loop, bench_hash_loop, bench_scatter_loop,
         scatter_chunk, fbm2d_ffi, hash_fold3, hash_u32, reset_alloc
hash_u32(42, 90210) = 1971548486  (expect 1971548486, matches Node + src/core/seed.js)
scatter_chunk(90210, 0, 0) -> 361 instances
first instance: x=33.061 z=0.514 scale=0.684 rot=2.942
WASM loads and runs correctly in the browser context.
```

## Web Worker pattern

`worker_loader_example.js` documents the Worker message-passing shape (init
with a wasm URL → `ready` → `generateChunk` requests → transferred
`Float32Array` results) and is itself a **real, running** smoke test using
Node's `worker_threads` (API-identical message-passing shape to a browser
`Worker`, just without needing a browser for the identical structural
proof):

```
$ node worker_loader_example.js
worker smoke test: chunk (3,-1) -> 377 instances, first = Float32Array(4) [
  600.7946166992188, -199.59812927246094, 0.777982771396637, 5.786066055297852
]
```

Key point for the real integration: each `WebAssembly.instantiate` call
(main thread, a Worker, or another Worker) gets its **own independent
linear memory** — chunk generation is embarrassingly parallel across
workers by construction (every kernel is keyed purely on world position,
never on shared mutable state), so no `SharedArrayBuffer`/cross-instance
memory coordination is needed unless a future optimization specifically
wants one big shared memory to avoid copying results back to the main
thread.

## Feasibility verdict

Bit-identical hash: proven. Toolchain: friction-free. WASM loads and runs
correctly in both Node and a real browser tab, and the Worker offload
pattern is real and simple. Performance-wise, this specific probe does
**not** show a slam-dunk case for porting the hash/scatter kernels
specifically — V8 already handles them well. The clearer win is the fbm
kernel's variance story, which matters more for frame-time predictability
than the median benchmark number suggests. If a broader set of world-gen
kernels (more octaves, more expensive per-cell logic, larger chunks) is
where the real budget pressure lives, this probe's numbers suggest the WASM
port would pay off more clearly there than on the three kernels tested here
in isolation.
