//! native_bench.rs — same three kernels, compiled natively (no WASM, no FFI
//! boundary at all) as a sanity data point: how much of the WASM-vs-JS gap is
//! "compiled code vs JIT" versus "FFI/marshalling overhead". Not required by
//! the probe (the wasm32 target install succeeded, so this is bonus context,
//! not the fallback path), but it's nearly free to add since the crate
//! builds fine for the host target too, and it fills in the third point of
//! the JS / WASM / native-Rust triangle.
use std::hint::black_box;
use std::time::Instant;
use worldgen_probe::{bench_fbm_loop_native, fbm2d, scatter_chunk, squirrel3};

const SEED: u32 = 90210;
const N_HASH: u32 = 1_000_000;
const N_FBM: u32 = 1_000_000;
const N_CHUNKS: u32 = 100;

fn timeit<T>(warmup: u32, trials: u32, mut f: impl FnMut() -> T) -> (f64, Vec<f64>, T) {
    let mut last = None;
    for _ in 0..warmup {
        last = Some(f());
    }
    let mut times = Vec::with_capacity(trials as usize);
    for _ in 0..trials {
        let t0 = Instant::now();
        last = Some(f());
        times.push(t0.elapsed().as_secs_f64() * 1000.0);
    }
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    (times[0], times, last.unwrap())
}

fn main() {
    println!("native (host-target, no WASM) benchmark of the same 3 kernels\n");

    // `black_box` on the seed input and the returned accumulator stops LLVM
    // from proving all 5 trials are identical pure computations and folding
    // them into a single evaluation reused 5x (which it will otherwise do,
    // legally, under the as-if rule -- and did, in an earlier version of
    // this file, producing bogus near-zero timings for 4 of 5 trials).
    let (hash_min, hash_all, hash_acc) = timeit(3, 5, || {
        let mut h = black_box(SEED);
        let mut acc: u32 = 0;
        for i in 0..N_HASH {
            h = squirrel3(black_box(i), h);
            acc ^= h;
        }
        black_box(acc)
    });
    println!("squirrel3 hash  N={N_HASH}  min={hash_min:.3}ms  acc={hash_acc}  all={hash_all:?}");

    let (fbm_min, fbm_all, fbm_acc) = timeit(3, 5, || black_box(bench_fbm_loop_native(black_box(SEED), black_box(N_FBM))));
    println!("fbm 2D          N={N_FBM}  min={fbm_min:.3}ms  acc={fbm_acc:.3}  all={fbm_all:?}");

    let cap = 4096 * 4;
    let mut buf = vec![0f32; cap];
    let (scatter_min, scatter_all, scatter_total) = timeit(3, 5, || {
        let mut total = 0u32;
        for c in 0..N_CHUNKS {
            total += scatter_chunk(black_box(SEED), c as i32, 0, buf.as_mut_ptr(), cap as u32);
        }
        black_box(total)
    });
    println!("scatter 100 chunks  min={scatter_min:.3}ms  total_instances={scatter_total}  all={scatter_all:?}");

    // silence unused-import-style warning if fbm2d unused directly
    let _ = fbm2d(SEED, 1.0, 2.0, 0, 4);
}
