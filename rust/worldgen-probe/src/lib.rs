//! worldgen-probe — Rust -> WASM feasibility probe for the chunk-generator
//! kernel case: squirrel3 hash, fbm value-noise, and a jittered-grid scatter
//! kernel, exported as hand-rolled `extern "C"` functions (no wasm-bindgen).
//!
//! Design notes (read before poking at `#![no_std]`):
//! - This crate is deliberately **not** `#![no_std]`, but it is "no_std-friendly":
//!   no heap allocation (no Vec/Box/String), no OS syscalls, no threads, no
//!   libm dependency (floor/round are hand-rolled via int casts, see below).
//!   The only thing pulled from `std` is the default panic runtime, which
//!   avoids the dual-target `#[panic_handler]` conflict you'd otherwise hit
//!   when the same crate is built once for `wasm32-unknown-unknown` (cdylib)
//!   and once for the host (native rlib, for the native-vs-JS fallback bench).
//!   Porting to true `#![no_std]` is a small, mechanical follow-up: add
//!   `#![no_std]`, gate a `#[panic_handler]` behind `cfg(target_arch = "wasm32")`,
//!   and build the native bench as a separate crate instead of a `[[bin]]`
//!   in this package.
//!
//! All exported functions use only u32/i32/f32 scalars and raw pointers into
//! linear memory — no strings, no wasm-bindgen glue, no JS shims required.

// ---- squirrel3-style integer avalanche hash --------------------------------
// Bit-for-bit port of the `squirrel(n, seed)` function in src/core/seed.js.
// JS operates on Number via `>>> 0` / `Math.imul`, which is exactly u32
// wrapping arithmetic — so plain `u32` wrapping ops in Rust reproduce it
// exactly, with no float-precision surprises anywhere in the pipeline.
pub const N1: u32 = 0xb529_7a4d;
pub const N2: u32 = 0x68e3_1da4;
pub const N3: u32 = 0x1b56_c4e9;

#[inline(always)]
pub fn squirrel3(n: u32, seed: u32) -> u32 {
    let mut m = n;
    m = m.wrapping_mul(N1);
    m = m.wrapping_add(seed);
    m ^= m >> 8;
    m = m.wrapping_add(N2);
    m ^= m << 8;
    m = m.wrapping_mul(N3);
    m ^= m >> 8;
    m
}

/// Port of `hashN(...args)`: fold arbitrarily many ints into one hash,
/// starting from `world_seed` (== CBZ.WORLD_SEED), in order.
#[inline]
pub fn hash_fold(world_seed: u32, ints: &[i32]) -> u32 {
    let mut h = world_seed;
    for &a in ints {
        h = squirrel3(a as u32, h);
    }
    h
}

// ---- JS-compatible floor/round, no libm needed -----------------------------
// core::f32 has no `.floor()`/`.round()` without `std` or a libm crate; these
// hand-rolled versions only need an int cast + compare, and `floor(x+0.5)`
// reproduces `Math.round`'s "round half toward +Infinity" tie-breaking
// exactly (this is the ECMA-262 definition of Math.round, not an approximation).
#[inline]
pub fn floor_f32(x: f32) -> f32 {
    let i = x as i32;
    let fi = i as f32;
    if x < fi {
        fi - 1.0
    } else {
        fi
    }
}

#[inline]
pub fn js_round(x: f32) -> f32 {
    floor_f32(x + 0.5)
}

/// Port of `CBZ.hash01(x, z, salt)`.
#[inline]
pub fn hash01(world_seed: u32, x: f32, z: f32, salt: i32) -> f32 {
    let ix = js_round(x * 10.0) as i32;
    let iz = js_round(z * 10.0) as i32;
    let h = hash_fold(world_seed, &[ix, iz, salt]);
    (h as f32) / 4_294_967_296.0
}

// ---- 2D value noise + fbm ---------------------------------------------------
#[inline]
fn lattice01(world_seed: u32, ix: i32, iz: i32, salt: i32) -> f32 {
    let h = hash_fold(world_seed, &[ix, iz, salt]);
    (h as f32) / 4_294_967_296.0
}

#[inline]
fn smoothstep(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

/// Integer-lattice value noise in [-1, 1].
pub fn value_noise2d(world_seed: u32, x: f32, z: f32, salt: i32) -> f32 {
    let ix = floor_f32(x);
    let iz = floor_f32(z);
    let fx = x - ix;
    let fz = z - iz;
    let ixi = ix as i32;
    let izi = iz as i32;

    let h00 = lattice01(world_seed, ixi, izi, salt);
    let h10 = lattice01(world_seed, ixi + 1, izi, salt);
    let h01 = lattice01(world_seed, ixi, izi + 1, salt);
    let h11 = lattice01(world_seed, ixi + 1, izi + 1, salt);

    let u = smoothstep(fx);
    let v = smoothstep(fz);

    let a = h00 + (h10 - h00) * u;
    let b = h01 + (h11 - h01) * u;
    (a + (b - a) * v) * 2.0 - 1.0
}

/// Fractal brownian motion: `octaves` layers of value noise, persistence 0.5,
/// lacunarity 2.0, normalized to [-1, 1].
pub fn fbm2d(world_seed: u32, x: f32, z: f32, salt: i32, octaves: u32) -> f32 {
    let mut sum = 0.0f32;
    let mut amp = 0.5f32;
    let mut freq = 1.0f32;
    let mut max_amp = 0.0f32;
    for o in 0..octaves {
        sum += value_noise2d(world_seed, x * freq, z * freq, salt.wrapping_add(o as i32)) * amp;
        max_amp += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    if max_amp > 0.0 {
        sum / max_amp
    } else {
        0.0
    }
}

// ---- jittered-grid scatter kernel ------------------------------------------
pub const CHUNK_SIZE: f32 = 200.0;
pub const CELL_SIZE: f32 = 4.0;
pub const CELLS_PER_SIDE: i32 = 50; // CHUNK_SIZE / CELL_SIZE
pub const DENSITY: f32 = 0.15; // fraction of cells that get an instance
pub const TAU: f32 = 6.283_185_3;

/// Fill `out_ptr` (a caller-owned buffer of at least `cap` f32 slots) with
/// (x, z, scale, rot) instances for the 200x200 chunk at (chunk_x, chunk_z).
/// Returns the instance count written (each instance = 4 f32s, so it writes
/// at most `cap / 4` instances).
///
/// Order-independence: every cell's outcome (present/absent, jitter, scale,
/// rotation) is derived purely from `hash01(seed, world_x, world_z, salt)` —
/// i.e. from the cell's *position*, not from any running RNG state or loop
/// index. Cell (37, 12) of chunk (3, -1) hashes to the same instance whether
/// you generate it first, last, out of order, on another thread, or from a
/// neighboring chunk's edge — the traversal order below is just one way to
/// enumerate the same fixed set of outcomes.
#[no_mangle]
pub extern "C" fn scatter_chunk(
    seed: u32,
    chunk_x: i32,
    chunk_z: i32,
    out_ptr: *mut f32,
    cap: u32,
) -> u32 {
    let mut count: u32 = 0;
    let base_x = chunk_x as f32 * CHUNK_SIZE;
    let base_z = chunk_z as f32 * CHUNK_SIZE;
    let max_instances = cap / 4;

    for cz in 0..CELLS_PER_SIDE {
        for cx in 0..CELLS_PER_SIDE {
            if count >= max_instances {
                return count;
            }
            let px = base_x + (cx as f32 + 0.5) * CELL_SIZE;
            let pz = base_z + (cz as f32 + 0.5) * CELL_SIZE;

            let presence = hash01(seed, px, pz, 1);
            if presence >= DENSITY {
                continue;
            }
            let jx = (hash01(seed, px, pz, 2) - 0.5) * CELL_SIZE;
            let jz = (hash01(seed, px, pz, 3) - 0.5) * CELL_SIZE;
            let scale = 0.6 + hash01(seed, px, pz, 4) * 0.8;
            let rot = hash01(seed, px, pz, 5) * TAU;

            let idx = (count * 4) as isize;
            unsafe {
                *out_ptr.offset(idx) = px + jx;
                *out_ptr.offset(idx + 1) = pz + jz;
                *out_ptr.offset(idx + 2) = scale;
                *out_ptr.offset(idx + 3) = rot;
            }
            count += 1;
        }
    }
    count
}

// ---- direct FFI wrappers for hash equivalence proof + per-call benchmarks --

#[no_mangle]
pub extern "C" fn hash_u32(n: u32, seed: u32) -> u32 {
    squirrel3(n, seed)
}

/// Matches `CBZ.hashN(a, b, c)` exactly (raw u32, pre-division).
#[no_mangle]
pub extern "C" fn hash_fold3(world_seed: u32, a: i32, b: i32, c: i32) -> u32 {
    hash_fold(world_seed, &[a, b, c])
}

#[no_mangle]
pub extern "C" fn fbm2d_ffi(seed: u32, x: f32, z: f32, salt: i32, octaves: u32) -> f32 {
    fbm2d(seed, x, z, salt, octaves)
}

// ---- tight internal-loop kernels, for FFI-overhead-free benchmarking ------

#[no_mangle]
pub extern "C" fn bench_hash_loop(seed: u32, count: u32) -> u32 {
    let mut h = seed;
    let mut acc: u32 = 0;
    for i in 0..count {
        h = squirrel3(i, h);
        acc ^= h;
    }
    acc
}

#[no_mangle]
pub extern "C" fn bench_fbm_loop(seed: u32, count: u32) -> f32 {
    bench_fbm_loop_native(seed, count)
}

/// Same loop as `bench_fbm_loop`, exposed as a plain Rust fn (not `extern
/// "C"`) so the native benchmark binary (src/bin/native_bench.rs) can call it
/// directly with no FFI/ABI involved at all.
pub fn bench_fbm_loop_native(seed: u32, count: u32) -> f32 {
    let mut acc = 0.0f32;
    for i in 0..count {
        let x = (i % 1000) as f32 * 0.137;
        let z = (i / 1000) as f32 * 0.091;
        acc += fbm2d(seed, x, z, 0, 4);
    }
    acc
}

#[no_mangle]
pub extern "C" fn bench_scatter_loop(seed: u32, chunk_count: u32, out_ptr: *mut f32, cap: u32) -> u32 {
    let mut total: u32 = 0;
    for c in 0..chunk_count {
        total += scatter_chunk(seed, c as i32, 0, out_ptr, cap);
    }
    total
}

// ---- static bump allocator (memory via a caller-directed arena) -----------
// No global allocator, no Vec/Box: JS asks for N bytes, gets back an offset
// into this module's own linear memory, and writes/reads f32s directly
// through the WebAssembly.Memory buffer at that offset. `reset_alloc` rewinds
// the bump pointer between benchmark iterations so the arena is reusable.
const ARENA_SIZE: usize = 16 * 1024 * 1024;
static mut ARENA: [u8; ARENA_SIZE] = [0; ARENA_SIZE];
static mut ARENA_OFF: usize = 0;

#[no_mangle]
pub extern "C" fn alloc(size: u32) -> u32 {
    unsafe {
        let size = size as usize;
        let aligned_off = (ARENA_OFF + 3) & !3; // 4-byte align for f32
        if aligned_off + size > ARENA_SIZE {
            return 0; // OOM sentinel (0 is never a valid instance pointer)
        }
        ARENA_OFF = aligned_off + size;
        (core::ptr::addr_of_mut!(ARENA) as usize + aligned_off) as u32
    }
}

#[no_mangle]
pub extern "C" fn reset_alloc() {
    unsafe {
        ARENA_OFF = 0;
    }
}
