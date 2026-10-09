/* tools/ground-look-probe.js — HOW VARIED IS THE GROUND THE PLAYER SEES?
   A probe.mjs expression file (numbers, no pictures):

     CBZ_PROBE_LOCK=/tmp/my-world.json CBZ_URL_EXTRA="device=tablet" \
       CBZ_PRELOAD=tools/preload/ipad.js CBZ_VIEWPORT=1180x820 node tools/probe.mjs --serve
     CBZ_PROBE_LOCK=/tmp/my-world.json node tools/probe.mjs --eval-timeout 900000 --file tools/ground-look-probe.js

   For each spot it renders one eye-level frame through the game's own
   renderer (fog, tone map, grade, the live quality tier), takes the screen
   rows that are ground in that view, and reports per distance band:
     lum    mean luminance (0-255)
     cv     luminance standard deviation / mean
     local  mean |L(x) - L(x+2px)|: fine texture the eye reads as "detail"
     blk    sd of 8x8-px block means: patchiness at the band's scale
     gr     mean g/r and its sd (hue variation)
   2026-10-08 (tablet tier 1), the backcountry field west of downtown,
   same view: before the turf cv 0.07-0.12, local 0.5-2.7, blk 2.3-5.6,
   g/r flat at 1.19-1.23; after cv 0.14-0.17, local 1.6-2.9, blk 3.7-7.2,
   g/r 1.27-1.59 by patch.
   Spots: window.__groundSpots = [{x,z,yaw,pitch,h,x0,x1,bands:[row...]}]
   overrides the default ones (screen columns x0..x1 of a 480x300 frame). */
(() => {
  const W = 480, H = 300;
  const spots = window.__groundSpots || [
    // the field west of the downtown (continent plate), eye level, looking SW
    { name: "backcountry field", x: -330, z: -520, yaw: -1.9, pitch: -0.12, h: 1.8, x0: 0, x1: 140, bands: [125, 135, 150, 175, 215, 300] },
    // Gang City West's lawns (metro ground), looking along a block
    { name: "metro lawns", x: -620, z: -1150, yaw: -2.9, pitch: -0.2, h: 1.8, x0: 0, x1: 480, bands: [160, 185, 220, 300] },
  ];
  const R = CBZ.renderer, cam = CBZ.camera, scene = CBZ.scene;
  const out = { q: CBZ.qualityLevel, dev: CBZ.deviceClass, spots: [] };
  for (const S of spots) {
    const gy = (CBZ.floorAt ? CBZ.floorAt(S.x, S.z) : 0) || 0;
    const sp = cam.position.clone(), sq = cam.quaternion.clone(), sa = cam.aspect;
    const eye = gy + (S.h || 1.8);
    cam.position.set(S.x, eye, S.z);
    cam.lookAt(S.x + Math.sin(S.yaw) * Math.cos(S.pitch) * 10, eye + Math.sin(S.pitch) * 10, S.z + Math.cos(S.yaw) * Math.cos(S.pitch) * 10);
    cam.aspect = W / H; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    const rt = new THREE.WebGLRenderTarget(W, H);
    const prev = R.getRenderTarget();
    R.setRenderTarget(rt); R.clear(); R.render(scene, cam);
    const px = new Uint8Array(W * H * 4);
    R.readRenderTargetPixels(rt, 0, 0, W, H, px);
    R.setRenderTarget(prev); rt.dispose();
    cam.position.copy(sp); cam.quaternion.copy(sq); cam.aspect = sa; cam.updateProjectionMatrix();
    const at = (x, y) => (((H - 1 - y) * W) + x) * 4;          // screen row y (top-down)
    const lum = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    const rec = { name: S.name, bands: [] };
    for (let b = 0; b + 1 < S.bands.length; b++) {
      const y0 = S.bands[b], y1 = S.bands[b + 1];
      let n = 0, s = 0, s2 = 0, loc = 0, nl = 0, g = 0, g2 = 0;
      for (let y = y0; y < y1; y++) for (let x = S.x0; x < S.x1; x++) {
        const i = at(x, y), L = lum(i);
        n++; s += L; s2 += L * L;
        const gr = px[i + 1] / Math.max(1, px[i]); g += gr; g2 += gr * gr;
        if (x + 2 < S.x1) { loc += Math.abs(L - lum(at(x + 2, y))); nl++; }
      }
      const bm = [];
      for (let y = y0; y + 8 <= y1; y += 8) for (let x = S.x0; x + 8 <= S.x1; x += 8) {
        let t = 0; for (let yy = y; yy < y + 8; yy++) for (let xx = x; xx < x + 8; xx++) t += lum(at(xx, yy));
        bm.push(t / 64);
      }
      const m = s / n, bmm = bm.reduce((a, v) => a + v, 0) / Math.max(1, bm.length);
      const gm = g / n;
      rec.bands.push({ rows: y0 + "-" + y1, lum: +m.toFixed(1), cv: +(Math.sqrt(Math.max(0, s2 / n - m * m)) / m).toFixed(3), local: +(loc / nl).toFixed(2),
        blk: +Math.sqrt(bm.reduce((a, v) => a + (v - bmm) * (v - bmm), 0) / Math.max(1, bm.length)).toFixed(2), gr: +gm.toFixed(2), grSD: +Math.sqrt(Math.max(0, g2 / n - gm * gm)).toFixed(3) });
    }
    out.spots.push(rec);
  }
  return JSON.stringify(out);
})()
