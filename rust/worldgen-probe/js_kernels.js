// js_kernels.js — plain-JS reference implementations of the same three
// kernels the Rust/WASM module implements, so the benchmark compares
// equivalent work, not apples to oranges. The hash here is copy-identical
// to src/core/seed.js's squirrel(); the noise/scatter logic mirrors
// src/lib.rs's value_noise2d/fbm2d/scatter_chunk term for term.
"use strict";

const N1 = 0xb5297a4d, N2 = 0x68e31da4, N3 = 0x1b56c4e9;

function squirrel(n, seed) {
  let m = n >>> 0;
  m = Math.imul(m, N1) >>> 0;
  m = (m + (seed >>> 0)) >>> 0;
  m ^= m >>> 8;
  m = (m + N2) >>> 0;
  m ^= (m << 8) >>> 0;
  m = Math.imul(m, N3) >>> 0;
  m ^= m >>> 8;
  return m >>> 0;
}

function hashFold3(worldSeed, a, b, c) {
  let h = worldSeed >>> 0;
  h = squirrel(a | 0, h);
  h = squirrel(b | 0, h);
  h = squirrel(c | 0, h);
  return h >>> 0;
}

function hash01(worldSeed, x, z, salt) {
  const ix = Math.round(x * 10) | 0;
  const iz = Math.round(z * 10) | 0;
  return hashFold3(worldSeed, ix, iz, salt | 0) / 4294967296;
}

function lattice01(worldSeed, ix, iz, salt) {
  return hashFold3(worldSeed, ix, iz, salt) / 4294967296;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise2d(worldSeed, x, z, salt) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;

  const h00 = lattice01(worldSeed, ix, iz, salt);
  const h10 = lattice01(worldSeed, ix + 1, iz, salt);
  const h01 = lattice01(worldSeed, ix, iz + 1, salt);
  const h11 = lattice01(worldSeed, ix + 1, iz + 1, salt);

  const u = smoothstep(fx);
  const v = smoothstep(fz);

  const a = h00 + (h10 - h00) * u;
  const b = h01 + (h11 - h01) * u;
  return (a + (b - a) * v) * 2 - 1;
}

function fbm2d(worldSeed, x, z, salt, octaves) {
  let sum = 0, amp = 0.5, freq = 1, maxAmp = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise2d(worldSeed, x * freq, z * freq, (salt + o) | 0) * amp;
    maxAmp += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return maxAmp > 0 ? sum / maxAmp : 0;
}

const CHUNK_SIZE = 200;
const CELL_SIZE = 4;
const CELLS_PER_SIDE = 50;
const DENSITY = 0.15;
const TAU = 6.2831853;

// Writes into `out` (a Float32Array or plain Array) starting at offset 0,
// same layout as the Rust version: 4 floats per instance (x, z, scale, rot).
function scatterChunk(seed, chunkX, chunkZ, out, cap) {
  let count = 0;
  const baseX = chunkX * CHUNK_SIZE;
  const baseZ = chunkZ * CHUNK_SIZE;
  const maxInstances = (cap / 4) | 0;

  for (let cz = 0; cz < CELLS_PER_SIDE; cz++) {
    for (let cx = 0; cx < CELLS_PER_SIDE; cx++) {
      if (count >= maxInstances) return count;
      const px = baseX + (cx + 0.5) * CELL_SIZE;
      const pz = baseZ + (cz + 0.5) * CELL_SIZE;

      const presence = hash01(seed, px, pz, 1);
      if (presence >= DENSITY) continue;

      const jx = (hash01(seed, px, pz, 2) - 0.5) * CELL_SIZE;
      const jz = (hash01(seed, px, pz, 3) - 0.5) * CELL_SIZE;
      const scale = 0.6 + hash01(seed, px, pz, 4) * 0.8;
      const rot = hash01(seed, px, pz, 5) * TAU;

      const idx = count * 4;
      out[idx] = px + jx;
      out[idx + 1] = pz + jz;
      out[idx + 2] = scale;
      out[idx + 3] = rot;
      count++;
    }
  }
  return count;
}

module.exports = { squirrel, hashFold3, hash01, valueNoise2d, fbm2d, scatterChunk, CELLS_PER_SIDE };
