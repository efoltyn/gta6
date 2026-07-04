// bench.js — JS vs WASM benchmark for the three worldgen kernels:
//   1. squirrel3 hash            N = 1e6 calls
//   2. fbm 2D value noise        N = 1e6 calls (4 octaves each)
//   3. jittered-grid chunk scatter, 100 chunks (200x200 units each)
//
// For the hash and fbm kernels we report THREE numbers, because a single
// "WASM number" would hide a real tradeoff:
//   - JS:              pure JS, V8 JIT, no FFI.
//   - WASM (internal): one FFI call that loops N times *inside* the module.
//                       This is the honest "kernel cost" comparison and is
//                       what a real chunk-gen call pattern would look like
//                       (batch a chunk's worth of work per FFI call).
//   - WASM (per-call):  N separate JS->WASM calls, one per hash. This shows
//                       the FFI crossing overhead if you (mis)use it as a
//                       drop-in per-value replacement.
"use strict";

const fs = require("fs");
const path = require("path");
const js = require("./js_kernels.js");

const WASM_PATH = path.join(
  __dirname,
  "target/wasm32-unknown-unknown/release/worldgen_probe.wasm"
);

const N_HASH = 1_000_000;
const N_FBM = 1_000_000;
const N_CHUNKS = 100;
const SEED = 90210;

function now() {
  const [s, ns] = process.hrtime();
  return s * 1e3 + ns / 1e6;
}

// Runs `fn` `warmup` times to let V8/the wasm compiler settle (JIT tiering,
// TurboFan optimization, GC steady-state), then times `trials` more runs and
// reports the MIN (most robust against GC pauses / scheduler noise — the
// standard "best-of-N" approach for microbenchmarks) alongside the median.
function timeit(fn, { warmup = 6, trials = 9 } = {}) {
  let result;
  for (let i = 0; i < warmup; i++) result = fn();
  const times = [];
  for (let i = 0; i < trials; i++) {
    const t0 = now();
    result = fn();
    const t1 = now();
    times.push(t1 - t0);
  }
  times.sort((a, b) => a - b);
  const min = times[0];
  const median = times[(trials / 2) | 0];
  return { ms: min, medianMs: median, allMs: times, result };
}

async function main() {
  const wasmBuf = fs.readFileSync(WASM_PATH);
  const { instance } = await WebAssembly.instantiate(wasmBuf);
  const wasm = instance.exports;
  const mem = new Float32Array(wasm.memory.buffer);

  const rows = [];

  // ---- 1. squirrel3 hash, N = 1e6 -----------------------------------------
  const jsHash = timeit(() => {
    let h = SEED >>> 0;
    let acc = 0;
    for (let i = 0; i < N_HASH; i++) {
      h = js.squirrel(i, h);
      acc ^= h;
    }
    return acc >>> 0;
  });

  const wasmHashInternal = timeit(() => wasm.bench_hash_loop(SEED, N_HASH) >>> 0);

  const wasmHashPerCall = timeit(() => {
    let h = SEED >>> 0;
    let acc = 0;
    for (let i = 0; i < N_HASH; i++) {
      h = wasm.hash_u32(i, h) >>> 0;
      acc ^= h;
    }
    return acc >>> 0;
  });

  console.log(`hash sanity: JS acc=${jsHash.result} WASM(internal) acc=${wasmHashInternal.result} WASM(per-call) acc=${wasmHashPerCall.result}`);
  rows.push([
    "squirrel3 hash",
    `N=${N_HASH.toLocaleString()}`,
    jsHash.ms,
    wasmHashInternal.ms,
    wasmHashPerCall.ms,
  ]);

  // ---- 2. fbm 2D value noise, N = 1e6 --------------------------------------
  const jsFbm = timeit(() => {
    let acc = 0;
    for (let i = 0; i < N_FBM; i++) {
      const x = (i % 1000) * 0.137;
      const z = ((i / 1000) | 0) * 0.091;
      acc += js.fbm2d(SEED, x, z, 0, 4);
    }
    return acc;
  });

  const wasmFbmInternal = timeit(() => wasm.bench_fbm_loop(SEED, N_FBM));

  const wasmFbmPerCall = timeit(() => {
    let acc = 0;
    for (let i = 0; i < N_FBM; i++) {
      const x = (i % 1000) * 0.137;
      const z = ((i / 1000) | 0) * 0.091;
      acc += wasm.fbm2d_ffi(SEED, x, z, 0, 4);
    }
    return acc;
  });

  console.log(`fbm sanity: JS acc=${jsFbm.result.toFixed(3)} WASM(internal) acc=${wasmFbmInternal.result.toFixed(3)} WASM(per-call) acc=${wasmFbmPerCall.result.toFixed(3)}`);
  rows.push([
    "fbm 2D (4 octaves)",
    `N=${N_FBM.toLocaleString()}`,
    jsFbm.ms,
    wasmFbmInternal.ms,
    wasmFbmPerCall.ms,
  ]);

  // ---- 3. jittered-grid scatter, 100 chunks --------------------------------
  const CAP_FLOATS = 4096 * 4;
  const jsBuf = new Float32Array(CAP_FLOATS);

  const jsScatter = timeit(() => {
    let total = 0;
    for (let c = 0; c < N_CHUNKS; c++) {
      total += js.scatterChunk(SEED, c, 0, jsBuf, CAP_FLOATS);
    }
    return total;
  });

  // WASM per-chunk FFI calls (the realistic usage pattern: one call per
  // chunk, writing into a buffer obtained from the module's bump allocator).
  const outPtr = wasm.alloc(CAP_FLOATS * 4);
  const wasmScatterPerChunk = timeit(() => {
    let total = 0;
    for (let c = 0; c < N_CHUNKS; c++) {
      total += wasm.scatter_chunk(SEED, c, 0, outPtr, CAP_FLOATS * 4) >>> 0;
    }
    return total;
  });

  // WASM internal loop (all 100 chunks generated inside one FFI call).
  const wasmScatterInternal = timeit(() =>
    wasm.bench_scatter_loop(SEED, N_CHUNKS, outPtr, CAP_FLOATS * 4) >>> 0
  );

  console.log(`scatter sanity: JS total=${jsScatter.result} WASM(per-chunk) total=${wasmScatterPerChunk.result} WASM(internal) total=${wasmScatterInternal.result}`);

  // Spot-check: read back the last chunk's instances from wasm memory and
  // confirm they look sane (non-NaN, inside chunk bounds).
  const lastCount = wasm.scatter_chunk(SEED, N_CHUNKS - 1, 0, outPtr, CAP_FLOATS * 4) >>> 0;
  const base = outPtr / 4;
  let sampleOk = true;
  for (let i = 0; i < Math.min(lastCount, 5); i++) {
    const x = mem[base + i * 4];
    const z = mem[base + i * 4 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(z)) sampleOk = false;
  }
  console.log(`scatter memory read-back sample ok=${sampleOk}, last chunk instances=${lastCount}`);

  rows.push([
    "scatter (100 chunks)",
    `N=${N_CHUNKS}`,
    jsScatter.ms,
    wasmScatterInternal.ms,
    wasmScatterPerChunk.ms,
  ]);

  // ---- report ---------------------------------------------------------------
  console.log("\nraw trial times (ms, min-of-5 reported below):");
  console.log(`  hash JS:            ${jsHash.allMs.map((t) => t.toFixed(2))}`);
  console.log(`  hash WASM internal: ${wasmHashInternal.allMs.map((t) => t.toFixed(2))}`);
  console.log(`  hash WASM per-call: ${wasmHashPerCall.allMs.map((t) => t.toFixed(2))}`);
  console.log(`  fbm JS:             ${jsFbm.allMs.map((t) => t.toFixed(2))}`);
  console.log(`  fbm WASM internal:  ${wasmFbmInternal.allMs.map((t) => t.toFixed(2))}`);
  console.log(`  fbm WASM per-call:  ${wasmFbmPerCall.allMs.map((t) => t.toFixed(2))}`);
  console.log(`  scatter JS:             ${jsScatter.allMs.map((t) => t.toFixed(2))}`);
  console.log(`  scatter WASM internal:  ${wasmScatterInternal.allMs.map((t) => t.toFixed(2))}`);
  console.log(`  scatter WASM per-chunk: ${wasmScatterPerChunk.allMs.map((t) => t.toFixed(2))}`);

  console.log("\n| Kernel | N | JS min (ms) | WASM internal-loop min (ms) | WASM per-call FFI min (ms) | Speedup (internal vs JS) |");
  console.log("|---|---|---|---|---|---|");
  for (const [name, n, jsMs, wasmIntMs, wasmPerCallMs] of rows) {
    const speedup = (jsMs / wasmIntMs).toFixed(2);
    console.log(
      `| ${name} | ${n} | ${jsMs.toFixed(2)} | ${wasmIntMs.toFixed(2)} | ${wasmPerCallMs.toFixed(2)} | ${speedup}x |`
    );
  }

  const wasmSize = fs.statSync(WASM_PATH).size;
  console.log(`\n.wasm size: ${wasmSize} bytes (${(wasmSize / 1024).toFixed(2)} KiB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
