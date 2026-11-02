/* ============================================================
   world/plume_node.js — THE PLUME VOLUME, as a TSL node material
   (CBZ.plumeNode), for the WebGPU renderer.

   world/volcanofx.js's plume volume (THE PLUME VOLUME there: the column,
   the umbrella, the fumarole wisps, the base surge, the density current and
   the cock's-tail jets as ONE raymarched body on a box proxy) is a GLSL
   ShaderMaterial, and the WebGPU renderer draws no ShaderMaterial. This is
   the same march, line for line, written in TSL so it compiles to WGSL (and
   GLSL for the WebGPU renderer's WebGL2 backend): the same envelopes, the
   same Perlin-Worley billows, the same Beer-Lambert light with its sun taps,
   sky occlusion, crater glow and lightning bloom, the same screen-authored
   palette. The owner's verdict on that smoke was "really good"; it is kept,
   not redrawn. volcanofx.js picks this material when the renderer is the
   WebGPU one and keeps its ShaderMaterial for the WebGL renderer, so the
   WebGL look is byte-identical.

   The uniforms object has the ShaderMaterial's shape ({name: {value}}), so
   every line of volcanofx.js that writes U.uCol.value.set(...) works on
   either. Three differences, all forced by WGSL:
     - every texture read inside the march is an explicit-LOD read
       (textureSampleLevel): WGSL forbids implicit-derivative sampling in
       the non-uniform control flow a march is;
     - the shared Perlin-Worley atlas arrives later (it builds in idle
       slices): the texture node starts on the value-noise texture and
       follows U.uAtlas.value when it is swapped (TextureNode.sample keeps a
       reference to its base node);
     - the depth the volume writes is WebGPU's [0, 1] clip depth.

   API
     const { mat, U } = CBZ.plumeNode.make(tier, noiseTex, FLOWN, JETN)
       tier = { steps, maxi, taps, detail } (volcanofx's plumeTier())
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !window.THREE.TSL) return;
  const THREE = window.THREE;
  const TSL = THREE.TSL;

  function make(tier, noiseTex, FLOWN, JETN) {
    const {
      Fn, If, Loop, Break, Continue, Discard, uniform, uniformArray, texture, float, vec2, vec3, vec4,
      floor, fract, mod, mix, clamp, smoothstep, max, min, abs, length, normalize, dot, exp, log, pow, sin, cos,
      sign, step, select, positionWorld, positionLocal, cameraPosition, cameraProjectionMatrix, cameraViewMatrix,
      modelWorldMatrix, screenCoordinate, screenUV, viewportDepthTexture, perspectiveDepthToViewZ, cameraNear, cameraFar,
    } = TSL;

    /* ---- the uniforms, in the ShaderMaterial's shape ---------------- */
    const V3 = () => uniform(new THREE.Vector3());
    const V4 = (x, y, z, w) => uniform(new THREE.Vector4(x || 0, y || 0, z || 0, w || 0));
    const C = () => uniform(new THREE.Color(0, 0, 0));
    const F = (v) => uniform(v);
    const vec4s = (n) => { const a = []; for (let i = 0; i < n; i++) a.push(new THREE.Vector4()); return a; };
    const noiseT = texture(noiseTex);
    const atlasT = texture(noiseTex);
    const flowP = vec4s(FLOWN), jet = vec4s(JETN), jetM = vec4s(JETN);
    const U = {
      uNoise: noiseT,
      uBoxMin: V3(), uBoxMax: V3(), uVent: V3(),
      uCol: V4(1, 5, 0, 0), uCol2: V4(1, 0, 0, 0),
      uUmb: V4(0, 0, 10, 0), uUmb2: V4(100, 20, 0, 0), uUmbDir: uniform(new THREE.Vector2(1, 0)),
      uGround: F(0), uTime: F(0), uSteps: F(tier.steps), uSigma: F(5.0), uRise: F(8),
      uSunDir: uniform(new THREE.Vector3(0.5, 0.7, 0.3).normalize()),
      uLit: C(), uShade: C(), uDeep: C(), uSteamLit: C(), uSteamShade: C(),
      uVentCol: C(), uVentK: F(0), uVentReach: F(20), uDay: F(1),
      uFlash: V4(), uFlashR: F(20), uFlashCol: C(),
      uFog: V4(), uFogCol: C(),
      uAtlas: atlasT, uHasAtlas: F(0),
      uSteam: V4(0, 1, 0, 0),
      uSurge: V4(1, 1, 0, 0), uCone: V4(0, 6, 36, 1.65),
      uFlowP: { value: flowP },
      uFlow: V4(0, 40, 20, 0), uFlow2: V4(12, 0, 100, 0), uFlow3: V4(), uFlow4: V4(),
      uJet: { value: jet }, uJetM: { value: jetM }, uJetG: V4(2, 0, 0, 0),
    };
    const uFlowP = uniformArray(flowP, "vec4"), uJet = uniformArray(jet, "vec4"), uJetM = uniformArray(jetM, "vec4");
    const { uBoxMin, uBoxMax, uVent, uCol, uCol2, uUmb, uUmb2, uUmbDir, uGround, uTime, uSteps, uSigma, uRise,
      uSunDir, uLit, uShade, uDeep, uSteamLit, uSteamShade, uVentCol, uVentK, uVentReach, uDay,
      uFlash, uFlashR, uFlashCol, uFog, uFogCol, uHasAtlas, uSteam, uSurge, uCone,
      uFlow, uFlow2, uFlow3, uFlow4, uJetG } = U;
    const MAXI = Math.max(8, tier.maxi | 0), TAPS = tier.taps | 0, DETAIL = tier.detail | 0;

    /* ---- the noise ---------------------------------------------------- */
    const vnoise = (x) => {
      const p = floor(x), f0 = x.sub(p);
      const f = f0.mul(f0).mul(float(3.0).sub(f0.mul(2.0)));
      const pm = mod(p, 256.0);
      const uvv = pm.xy.add(vec2(37.0, 17.0).mul(pm.z)).add(f.xy);
      const rg = noiseT.sample(uvv.add(0.5).div(256.0)).level(0).yx;
      return mix(rg.x, rg.y, f.z);
    };
    const noiseA = (p) => {
      const out = vec4(0.0).toVar();
      If(uHasAtlas.greaterThan(0.5), () => {
        const q = fract(p);
        const zf = q.z.mul(64.0), z0 = floor(zf), fz = zf.sub(z0), z1 = mod(z0.add(1.0), 64.0);
        const inner = q.xy.mul(64.0).add(1.5);
        const t0 = vec2(mod(z0, 8.0), floor(z0.div(8.0))).mul(66.0);
        const t1 = vec2(mod(z1, 8.0), floor(z1.div(8.0))).mul(66.0);
        out.assign(mix(atlasT.sample(t0.add(inner).div(528.0)).level(0), atlasT.sample(t1.add(inner).div(528.0)).level(0), fz));
      }).Else(() => {
        const x = p.mul(2.4);
        const a = vnoise(x).mul(0.64).add(vnoise(x.mul(2.13).add(vec3(3.1, 1.7, 5.3))).mul(0.36));
        const b = vnoise(x.mul(1.71).add(vec3(7.3, 2.9, 1.1)));
        out.assign(vec4(a, b, vnoise(x.mul(4.37).add(vec3(1.7, 0.4, 2.2))), 1.0));
      });
      return out;
    };
    const smax = (a, b, k) => {
      const h = clamp(a.sub(b).div(k).mul(0.5).add(0.5), 0.0, 1.0);
      return mix(b, a, h).add(h.mul(float(1.0).sub(h)).mul(k));
    };

    /* ---- the envelopes (built against the per-fragment gH / gHs) ------ */
    function shapes(gH, gHs) {
      const colR = (y) => {
        const u = clamp(y.div(gH), 0.0, 1.0), us = clamp(y.div(gHs), 0.0, 1.0);
        let r = uCol.y.mul(float(0.8).add(smoothstep(0.0, 0.08, u).mul(0.2))).add(max(y, 0.0).mul(0.2));
        r = r.mul(float(1.0).add(smoothstep(0.62, 1.0, u).mul(0.4).mul(float(1.0).sub(uSteam.x))));
        r = r.mul(float(1.0).add(uSteam.x.mul(0.9).mul(u)));
        r = r.mul(float(1.0).add(uCol.z.mul(1.4).mul(float(1.0).sub(us))));
        return max(r, 0.5);
      };
      const coneY = (rho) => {
        const k = clamp(float(1.0).sub(rho.sub(uCone.y).div(max(uCone.z.sub(uCone.y), 1.0))), 0.0, 1.0);
        return uCone.x.mul(pow(k, uCone.w)).sub(uCone.x);
      };
      const r0 = colR(float(0.0));
      const colEnv = (q) => {
        const H = gH;
        const u = clamp(q.y.div(H), 0.0, 1.2);
        const c = uCol2.xy.mul(uCol2.z).mul(u).mul(u);
        const r = colR(q.y);
        const d = length(q.xz.sub(c)).div(r);
        const k = max(q.y.sub(H.sub(r.mul(0.55))), 0.0).div(r.mul(0.75));
        let e = float(1.0).sub(length(vec2(d, k)));
        e = mix(e, float(1.0).sub(d).sub(smoothstep(0.3, 1.0, u).mul(1.25)), uSteam.x);
        e = min(e, q.y.sub(max(uCol2.w, coneY(length(q.xz)))).add(1.5).div(3.0));
        e = e.sub(max(q.y.negate(), 0.0).div(r0.mul(0.8)));
        e = e.sub(uCol.z.mul(0.45).mul(smoothstep(gHs.mul(0.8), gH, q.y)));
        e = e.sub(float(1.0).sub(uCol.w).mul(1.3));
        return select(uCol.w.greaterThan(0.001), e, float(-9.0));
      };
      const umbRR = (q) => {
        const d = q.xz.sub(uUmb.xy);
        const a = dot(d, uUmbDir), c = d.x.mul(uUmbDir.y).sub(d.y.mul(uUmbDir.x));
        const Rr = max(uUmb.z, 1.0);
        const ex = mix(Rr.mul(0.9), Rr.add(uUmb.w), smoothstep(Rr.mul(-0.25), Rr.mul(0.25), a));
        const ey = Rr.add(uUmb.w.mul(0.22));
        return length(vec2(a.div(ex), c.div(ey)));
      };
      const umbLump = (p, th) => {
        const s = p.sub(uUmbDir.mul(uTime.mul(2.2))).div(th.mul(1.5));
        const a = sin(s.x.add(sin(s.y.mul(0.61)).mul(1.6))).mul(sin(s.y.mul(1.13).add(sin(s.x.mul(0.73)).mul(1.3))));
        const s2 = s.mul(2.37).add(vec2(5.1, 2.3));
        const b = sin(s2.x.add(s2.y.mul(0.4))).mul(sin(s2.y.sub(s2.x.mul(0.3))));
        return vec2(a, b);
      };
      const umbEnv = (q) => {
        const rr = umbRR(q);
        const th = max(uUmb2.y, 1.0);
        const g = max(float(1.0).sub(rr), 0.0);
        const L = umbLump(q.xz.sub(uUmb.xy), th);
        const top = uUmb2.x.add(th.mul(float(0.42).add(g.mul(0.3)))).add(th.mul(0.8).mul(g).mul(g).mul(g))
          .add(th.mul(L.x.mul(0.34).add(L.y.mul(0.18))).mul(float(0.55).add(g.mul(0.45))));
        const bot = uUmb2.x.sub(th.mul(float(0.36).add(g.mul(0.34)))).sub(th.mul(max(L.y, 0.0).mul(0.2).add(L.x.mul(0.12)).add(0.1)));
        const hh = max(top.sub(bot).mul(0.5), 0.5);
        const ev = float(1.0).sub(abs(q.y.sub(top.add(bot).mul(0.5))).div(hh));
        const e = min(ev, float(1.04).sub(rr).sub(L.x.mul(0.07)).mul(3.0)).sub(float(1.0).sub(uUmb2.z).mul(0.35));
        return select(uUmb2.z.greaterThan(0.001), e, float(-9.0));
      };
      const surgeEnv = (q) => {
        const rho = length(q.xz);
        const Rs = uSurge.x, th = max(uSurge.y, 0.5);
        const hag = q.y.sub(coneY(rho)).sub(th.mul(float(1.0).sub(uSurge.w)).mul(0.9));
        const m = vec2(rho.sub(Rs.sub(th.mul(1.1))).div(th.mul(1.35)), hag.sub(th.mul(0.72)).div(th.mul(0.85)));
        const head = float(1.0).sub(length(m));
        const body = min(min(rho.sub(uSurge.z).div(th.mul(0.9)), Rs.sub(rho).div(th.mul(0.6))), float(1.0).sub(hag.div(th.mul(0.6)))).mul(0.8);
        let e = max(head, body);
        e = min(e, hag.add(0.8).div(1.6));
        return select(uSurge.w.greaterThan(0.001), e.sub(float(1.0).sub(uSurge.w).mul(0.8)), float(-9.0));
      };
      /* the density current's own frame at q: a soft minimum over the lane's
         segments (unrolled: the lane is FLOWN uniform points) */
      const flowFrame = (q) => {
        const m = float(1e9).toVar(), sw = float(0.0).toVar(), ss = float(0.0).toVar(), sp = float(0.0).toVar(), sh = float(0.0).toVar();
        const st = vec2(0.0).toVar();
        for (let i = 0; i < FLOWN - 1; i++) {
          const A = uFlowP.element(i), B = uFlowP.element(i + 1);
          const ab = B.xz.sub(A.xz).toVar();
          const L = max(length(ab), 0.01).toVar();
          const tn = ab.div(L).toVar();
          const u = dot(q.xz.sub(A.xz), tn);
          const uc = clamp(u, i === 0 ? float(-1e4) : float(0.0), i === FLOWN - 2 ? float(1e4) : L).toVar();
          const dq = q.xz.sub(A.xz).sub(tn.mul(uc)).toVar();
          const d = length(dq).toVar();
          If(d.lessThan(m), () => {
            const r = exp(d.sub(m).div(3.0));
            sw.mulAssign(r); ss.mulAssign(r); sp.mulAssign(r); sh.mulAssign(r); st.mulAssign(r);
            m.assign(d);
          });
          const w = exp(m.sub(d).div(3.0)).toVar();
          sw.addAssign(w); ss.addAssign(w.mul(A.w.add(uc)));
          sp.addAssign(w.mul(dq.x.mul(tn.y).sub(dq.y.mul(tn.x))));
          sh.addAssign(w.mul(q.y.sub(mix(A.y, B.y, clamp(uc.div(L), 0.0, 1.0)))));
          st.addAssign(tn.mul(w));
        }
        return { fs: ss.div(sw), fp: sp.div(sw), fh: sh.div(sw), ft: normalize(st.add(vec2(1e-5, 0.0))) };
      };
      const flowAt = (off, Fr) => {
        let s = Fr.fs.add(dot(off.xz, Fr.ft));
        let p = Fr.fp.add(off.x.mul(Fr.ft.y).sub(off.z.mul(Fr.ft.x)));
        const h = Fr.fh.add(off.y);
        const a = max(uFlow.x.sub(s), 0.0).div(max(uFlow.y, 1.0)).add(uFlow2.y);
        const dr = max(a.sub(2.0), 0.0).mul(0.55).mul(smoothstep(0.0, 1.0, h.div(uFlow.z.mul(1.6))));
        s = s.sub(dot(uFlow3.zw, Fr.ft).mul(dr));
        p = p.sub(uFlow3.z.mul(Fr.ft.y).sub(uFlow3.w.mul(Fr.ft.x)).mul(dr));
        return vec3(s, p, h);
      };
      const flowEnvS = (f) => {
        const s = f.x, p = f.y, h = f.z;
        const Hh = uFlow.z, behind = uFlow.x.sub(s);
        const a = max(behind, 0.0).div(max(uFlow.y, 1.0)).add(uFlow2.y);
        const hd = behind.sub(Hh.mul(0.45)).div(Hh.mul(0.9));
        const th1 = sin(s.div(Hh.mul(1.7)).add(1.3)).mul(0.6).add(sin(s.div(Hh.mul(0.83)).add(4.1)).mul(0.4));
        const src = smoothstep(0.06, 0.24, s.div(max(uFlow2.z, 1.0)));
        const loft = max(a.sub(1.5), 0.0).mul(float(0.55).add(th1.mul(0.45))).mul(src);
        let top = Hh.mul(float(0.7).add(exp(hd.mul(hd).negate()).mul(0.4)).add(a.max(0.0).sqrt().mul(0.4)).add(loft.mul(0.32)));
        top = min(top, Hh.mul(6.0));
        const bot = uFlow2.w.mul(max(a.sub(6.0), 0.0)).add(Hh.mul(0.16).mul(smoothstep(Hh.mul(0.35), Hh.mul(-0.2), behind)));
        const W = uFlow2.x.mul(float(0.6).add(smoothstep(0.0, Hh.mul(1.5), behind).mul(0.4)).add(min(a, 16.0).mul(0.045)))
          .mul(float(0.8).add(smoothstep(0.0, uFlow2.z, s).mul(0.4)));
        const hc = bot.add(top.sub(bot).mul(0.32));
        let ev = float(1.0).sub(length(vec2(p.div(W), max(h.sub(hc), 0.0).div(max(top.sub(hc), 1.0)))));
        ev = min(ev, h.sub(bot).div(max(top.sub(bot).mul(0.25), 1.0)).add(1.0).sub(smoothstep(0.5, 3.0, bot)));
        const hr = clamp(h.sub(bot).div(max(top.sub(bot), 1.0)), 0.0, 1.0);
        ev = ev.sub(max(behind.negate().add(Hh.mul(0.9).mul(hr).mul(hr)), 0.0).div(Hh.mul(0.5)));
        ev = min(ev, s.add(5.0).div(10.0));
        return ev.sub(float(1.0).sub(uFlow.w).mul(0.35)).sub(smoothstep(9.0, 26.0, a).mul(0.5))
          .sub(smoothstep(2.5, 7.0, a).mul(float(1.0).sub(src)).mul(0.9));
      };
      const flowEnv = (q, Fr, gQ) => select(uFlow.w.greaterThan(0.001), flowEnvS(flowAt(q.sub(gQ), Fr)), float(-9.0));
      const jetEnv = (q) => {
        const e = float(-9.0).toVar(), gJr = float(1.0).toVar();
        const r0j = uJetG.x;
        for (let j = 0; j < JETN; j++) {
          const JM = uJetM.element(j), JT = uJet.element(j);
          const M = JM.xyz, Tt = JT.xyz;
          const rM = mix(r0j, JT.w, 0.62);
          const u = clamp(dot(q, M).div(max(dot(M, M), 1e-3)), 0.0, 1.0);
          const r = mix(r0j, rM, u);
          const ej = float(1.0).sub(length(q.sub(M.mul(u))).div(r));
          const bc = Tt.sub(M);
          const v = clamp(dot(q.sub(M), bc).div(max(dot(bc, bc), 1e-3)), 0.0, 1.0);
          const r2 = mix(rM, JT.w, v);
          const ej2 = float(1.0).sub(length(q.sub(M).sub(bc.mul(v))).div(r2));
          const ejF = max(ej, ej2).sub(float(1.0).sub(JM.w).mul(1.2)).toVar();
          const rF = select(ej2.greaterThan(ej), r2, r);
          If(JM.w.greaterThan(0.001).and(ejF.greaterThan(e)), () => { e.assign(ejF); gJr.assign(rF); });
        }
        return vec2(select(uJetG.y.greaterThan(0.001), e.sub(float(1.0).sub(uJetG.y).mul(1.2)), float(-9.0)), gJr);
      };
      const envAll = (q, Fr, gQ) => max(max(smax(colEnv(q), umbEnv(q), 0.6), surgeEnv(q)), max(flowEnv(q, Fr, gQ), jetEnv(q).x));
      const fallDen = (q) => {
        const out = float(0.0).toVar();
        const top = uUmb2.x.sub(uUmb2.y.mul(0.3));
        If(uUmb2.w.greaterThan(0.001).and(q.y.lessThanEqual(top)), () => {
          const drop = top.sub(q.y);
          const src = q.xz.sub(uUmbDir.mul(drop).mul(0.45));
          const rr = umbRR(vec3(src.x, q.y, src.y));
          const d = src.sub(uUmb.xy);
          const dw = smoothstep(uUmb.z.mul(-0.1), uUmb.z.mul(0.5), dot(d, uUmbDir));
          const edge = float(1.0).sub(smoothstep(0.5, 0.95, rr));
          If(dw.mul(edge).greaterThan(0.0), () => {
            const N = noiseA(vec3(src.x.mul(0.0065), q.y.mul(0.0024).add(uTime.mul(0.004)), src.y.mul(0.0065)));
            const sh = smoothstep(0.42, 0.78, N.r.mul(0.7).add(N.b.mul(0.3)));
            const gl = uGround.sub(uVent.y);
            const hgt = clamp(q.y.sub(gl).div(max(top.sub(gl), 1.0)), 0.0, 1.0);
            out.assign(uUmb2.w.mul(edge).mul(dw).mul(sh).mul(hgt.mul(hgt).mul(0.9).add(0.1)).mul(smoothstep(0.0, 6.0, drop)));
          });
        });
        return out;
      };
      const plumeCoord = (q, sc, wU) => {
        const a = uCol.y.mul(0.85).add(2.0), b = 0.17;
        const y = q.y;
        const v = select(y.greaterThan(0.0), log(max(y.mul(b).div(a).add(1.0), 1e-4)).div(b), y.div(a));
        const sl = a.add(max(y, 0.0).mul(b));
        const ccx = q.x.div(sl), ccz = q.z.div(sl);
        const ccy = v.sub(uTime.mul(uRise).div(a.add(gH.mul(b * 0.3))));
        const sw = uTime.mul(0.05).add(q.y.div(gH.mul(0.9).add(10.0)));
        const cs = cos(sw), sn = sin(sw);
        // GLSL mat2(c, -s, s, c) * v: columns (c, -s), (s, c)
        const cc = vec3(ccx.mul(cs).add(ccz.mul(sn)), ccy, ccx.mul(sn.negate()).add(ccz.mul(cs)));
        const cu = vec3(q.x.sub(uUmbDir.x.mul(uTime).mul(2.2)), q.y.mul(1.15), q.z.sub(uUmbDir.y.mul(uTime).mul(2.2))).div(sc);
        return mix(cc, cu, wU).mul(0.42);
      };
      return { colR, coneY, colEnv, umbEnv, surgeEnv, flowFrame, flowAt, flowEnvS, flowEnv, jetEnv, envAll, fallDen, plumeCoord };
    }

    /* ---- the march ---------------------------------------------------- */
    const vWorld = positionWorld;
    const march = Fn(() => {
      const ro = cameraPosition;
      const rd = normalize(vWorld.sub(ro)).toVar();
      // the opaque scene's distance along this ray (read first: uniform control flow)
      const sceneZ = perspectiveDepthToViewZ(viewportDepthTexture(screenUV), cameraNear, cameraFar).toVar();
      const rdV = cameraViewMatrix.mul(vec4(rd, 0.0)).xyz;
      const tScene = sceneZ.div(min(rdV.z, -1e-4)).toVar();
      const inv = float(1.0).div(sign(rd).mul(max(abs(rd), vec3(1e-5))).add(step(abs(rd), vec3(0.0)).mul(1e-5))).toVar();
      const ta = uBoxMin.sub(ro).mul(inv), tb = uBoxMax.sub(ro).mul(inv);
      const tmn = min(ta, tb).toVar(), tmx = max(ta, tb).toVar();
      const t0 = max(max(max(tmn.x, tmn.y), tmn.z), 0.0).toVar();
      const t1 = min(min(tmx.x, tmx.y), tmx.z).toVar();
      If(rd.y.lessThan(-1e-4), () => { t1.assign(min(t1, uGround.sub(ro.y).div(rd.y))); });
      t1.assign(min(t1, tScene));
      If(t1.lessThanEqual(t0), () => { Discard(); });
      const n = max(uSteps, 8.0);
      const baseL = max(t1.sub(t0).div(n), 0.6).toVar();
      const jit = fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189)).toVar();
      const acc = vec3(0.0).toVar(), T = float(1.0).toVar(), tW = float(0.0).toVar(), wSum = float(0.0).toVar();
      const gHs = max(uCol.x, 1.0).toVar();
      const gH = mix(gHs, max(gHs, uUmb2.x), clamp(uUmb2.z.mul(2.0), 0.0, 1.0)).toVar();
      const H = gH;
      const th = max(uUmb2.y, 1.0).toVar();
      const t = t0.toVar();
      const first = float(1.0).toVar();
      const fineK = float(1.0).toVar();
      const S = shapes(gH, gHs);
      Loop(MAXI, () => {
        If(t.greaterThan(t1).or(T.lessThan(0.03)), () => { Break(); });
        const q = ro.add(rd.mul(t)).sub(uVent).toVar();
        const ec = S.colEnv(q).toVar(), eu = S.umbEnv(q).toVar(), es = S.surgeEnv(q).toVar();
        const fq = vec3(0.0).toVar(), ef = float(-9.0).toVar();
        const fs = float(0.0).toVar(), fp = float(0.0).toVar(), fh = float(0.0).toVar(), ft = vec2(1.0, 0.0).toVar();
        const gQ = q;
        const Fr = { fs, fp, fh, ft };
        If(uFlow.w.greaterThan(0.001), () => {
          const fr = S.flowFrame(q);
          fs.assign(fr.fs); fp.assign(fr.fp); fh.assign(fr.fh); ft.assign(fr.ft);
          fq.assign(S.flowAt(vec3(0.0), Fr));
          ef.assign(S.flowEnvS(fq));
        });
        const jr = S.jetEnv(q).toVar();
        const ej = jr.x, rJ = jr.y;
        const e0 = smax(ec, eu, 0.6).toVar();
        const e = max(max(e0, es), max(ef, ej)).toVar();
        const fd = S.fallDen(q).toVar();
        const wU = smoothstep(-0.25, 0.25, eu.sub(ec)).toVar();
        const wS = smoothstep(-0.2, 0.2, es.sub(e0)).toVar();
        const wF = smoothstep(-0.2, 0.2, ef.sub(max(e0, es))).toVar();
        const wJ = smoothstep(-0.2, 0.2, ej.sub(max(max(e0, es), ef))).toVar();
        const scA = mix(mix(S.colR(q.y).mul(0.85).add(2.0), th.mul(0.9).add(2.0), wU), uSurge.y.mul(0.9).add(1.5), wS);
        const sc = mix(mix(scA, uFlow.z.mul(0.85).add(3.0), wF), rJ.mul(0.8).add(1.2), wJ).toVar();
        const stepL = clamp(sc.mul(0.3), baseL.mul(0.25), baseL.mul(2.0)).mul(fineK).toVar();
        If(uVentK.greaterThan(0.12).and(q.y.greaterThan(-2.0)), () => {
          stepL.assign(min(stepL, mix(1.4, stepL, smoothstep(H.mul(0.08), H.mul(0.16), q.y))));
        });
        If(first.greaterThan(0.5), () => { t.addAssign(stepL.mul(jit)); first.assign(0.0); Continue(); });
        If(e.lessThan(-0.6).and(fd.lessThanEqual(0.0)), () => {
          const sk = min(min(ec.negate().sub(0.6).mul(S.colR(q.y)).mul(0.7), eu.negate().sub(0.6).mul(th).mul(0.45)),
            es.negate().sub(0.6).mul(max(uSurge.y, 0.5)).mul(0.55)).toVar();
          sk.assign(min(sk, min(ef.negate().sub(0.6).mul(uFlow.z).mul(0.5), ej.negate().sub(0.6).mul(uJetG.x))));
          fineK.assign(1.0);
          t.addAssign(stepL.add(max(sk, 0.0)));
          Continue();
        });
        const c = S.plumeCoord(q, sc, wU).toVar();
        If(wS.greaterThan(0.001), () => {
          const rho = length(q.xz);
          const dir = select(rho.greaterThan(1e-3), q.xz.div(rho), vec2(1.0, 0.0));
          const cs = vec3(q.x.sub(dir.x.mul(uTime).mul(3.0)), q.y.sub(S.coneY(rho)).mul(1.25).add(uTime.mul(0.8)), q.z.sub(dir.y.mul(uTime).mul(3.0))).div(sc).mul(0.42);
          c.assign(mix(c, cs, wS));
        });
        If(wF.greaterThan(0.001), () => {
          c.assign(mix(c, vec3(fq.x.sub(uFlow3.x), fq.z.mul(1.1).sub(uFlow3.y), fq.y).div(sc).mul(0.42), wF));
        });
        const A1 = noiseA(c).toVar();
        const base = e.add(A1.r.sub(0.5).mul(mix(mix(1.05, 1.12, wU), float(1.05).add(float(1.0).sub(uSurge.w).mul(0.6)), wS)))
          .add(A1.g.sub(0.5).mul(0.3)).toVar();
        base.subAssign(uSteam.x.mul(float(1.0).sub(A1.g).mul(float(0.25).add(smoothstep(0.05, 0.8, q.y.div(gH)).mul(0.55))).mul(uSteam.y).add(0.06)));
        const d = float(0.0).toVar();
        If(base.greaterThan(-0.08), () => {
          const A2 = noiseA(c.mul(3.07).add(vec3(0.37, float(0.11).sub(uTime.mul(0.012)), 0.73)));
          const det = A2.r.sub(0.5).mul(0.34).add(A2.g.sub(0.5).mul(0.2)).toVar();
          if (DETAIL > 0) {
            If(base.lessThan(0.3), () => {
              const A3 = noiseA(c.mul(8.7).add(vec3(0.71, 0.29, 0.13)));
              det.addAssign(A3.g.sub(0.5).mul(0.14).add(A3.b.sub(0.5).mul(0.06)));
            });
          }
          det.mulAssign(float(1.0).sub(wF.mul(0.45)));
          const b2 = base.add(det.mul(float(1.0).sub(smoothstep(0.15, 0.7, base))));
          d.assign(smoothstep(-0.02, 0.15, b2).mul(float(0.55).add(smoothstep(0.08, 0.6, b2).mul(0.45))));
          d.mulAssign(mix(1.0, smoothstep(0.0, 1.0, uUmb2.z), wU));
          d.mulAssign(mix(1.0, smoothstep(0.0, 1.0, uFlow.w), wF));
          d.mulAssign(mix(1.0, smoothstep(0.0, 1.0, uSurge.w), wS));
        });
        fineK.assign(select(base.greaterThan(-0.12).and(base.lessThan(0.3)), float(0.5), float(1.0)));
        const dd = d.add(fd.mul(0.12));
        If(dd.greaterThan(0.003), () => {
          const a = float(1.0).sub(exp(dd.negate().mul(uSigma).mul(mix(1.8, 1.25, wU)).mul(stepL).div(sc))).toVar();
          const L = sc.mul(1.1);
          const o1 = S.envAll(q.add(uSunDir.mul(L).mul(0.55)), Fr, gQ).toVar();
          const o2 = (TAPS > 1 ? S.envAll(q.add(uSunDir.mul(L).mul(1.6)), Fr, gQ) : o1.sub(0.2)).toVar();
          const od = max(o1.add(0.35), 0.0).add(max(o2.add(0.35), 0.0).mul(1.3)).add(d.mul(0.45)).toVar();
          const loc = float(0.0).toVar();
          if (DETAIL > 0) {
            const q2 = q.add(uSunDir.mul(sc).mul(0.32)).toVar();
            const c2 = mix(S.plumeCoord(q2, sc, wU), c.add(uSunDir.mul(0.32 * 0.42)), wS).toVar();
            If(wF.greaterThan(0.001), () => {
              const f2 = S.flowAt(q2.sub(gQ), Fr);
              c2.assign(mix(c2, vec3(f2.x.sub(uFlow3.x), f2.z.mul(1.1).sub(uFlow3.y), f2.y).div(sc).mul(0.42), wF));
            });
            const B1 = noiseA(c2);
            const bl = S.envAll(q2, Fr, gQ).add(B1.r.sub(0.5).mul(mix(1.05, 1.12, wU))).add(B1.g.sub(0.5).mul(0.3));
            loc.assign(max(bl.add(0.05), 0.0).mul(2.4));
          }
          const Ts = exp(od.mul(-2.2).sub(loc)).toVar();
          const ms = exp(od.mul(-0.5).sub(loc.mul(0.35))).mul(0.2);
          const powder = float(1.0).sub(exp(d.mul(-3.0)));
          const up = S.envAll(q.add(vec3(0.0, L.mul(0.9), 0.0)), Fr, gQ);
          const occ = clamp(float(1.0).sub(max(up.add(0.3), 0.0).mul(1.1)), 0.18, 1.0).toVar();
          const hy = clamp(q.y.div(H), 0.0, 1.0);
          const steam = float(1.0).sub(smoothstep(0.05, 0.3, hy)).mul(float(1.0).sub(smoothstep(0.0, 0.4, base)))
            .mul(float(1.0).sub(wU)).mul(float(1.0).sub(wF)).toVar();
          const deep = float(1.0).sub(smoothstep(0.0, 0.35, hy)).mul(smoothstep(0.2, 0.7, base)).mul(float(1.0).sub(wU)).mul(float(1.0).sub(wF)).toVar();
          deep.assign(max(deep, wF.mul(float(1.0).sub(smoothstep(0.0, 0.3, fq.z.div(uFlow.z)))).mul(smoothstep(0.1, 0.6, base)).mul(0.7)));
          steam.assign(mix(steam, clamp(uJetG.z.mul(0.9).add(float(1.0).sub(smoothstep(0.0, 0.45, base)).mul(0.45)), 0.0, 1.0), wJ));
          deep.assign(mix(deep, smoothstep(0.15, 0.6, base).mul(float(1.0).sub(uJetG.z)).mul(0.9), wJ));
          steam.assign(max(steam, wS.mul(0.65)));
          deep.mulAssign(float(1.0).sub(wS));
          const lit = mix(uLit, uSteamLit, steam.mul(0.75)).toVar();
          const sh = mix(mix(uShade, uSteamShade, steam.mul(0.7)), uDeep, deep.mul(0.7));
          lit.assign(mix(lit, uDeep.mul(2.2), deep.mul(0.45)));
          lit.mulAssign(float(1.0).sub(wU.mul(0.08)));
          const col = mix(sh.mul(occ.mul(0.5).add(0.5)), lit,
            clamp(Ts.mul(powder.mul(0.38).add(0.62)).add(ms).mul(uDay).mul(occ.mul(0.4).add(0.6)), 0.0, 1.0)).toVar();
          const vy = max(q.y, 0.0);
          const vk = uVentK.mul(exp(vy.negate().div(min(uVentReach, H.mul(0.045).add(2.0))))).mul(float(1.0).sub(smoothstep(H.mul(0.05), H.mul(0.13), vy)));
          col.addAssign(uVentCol.mul(vk.mul(float(0.35).add(float(1.0).sub(Ts).mul(0.65))).mul(float(1.0).sub(wU))));
          If(uFlow4.x.greaterThan(0.001), () => {
            const hb = exp(max(fq.z, 0.0).negate().div(uFlow.z.mul(0.14))).mul(exp(max(uFlow.x.sub(fq.x), 0.0).negate().div(uFlow.z.mul(2.5))));
            col.addAssign(uVentCol.mul(uFlow4.x.mul(hb).mul(wF).mul(float(0.3).add(float(1.0).sub(Ts).mul(0.7)))));
          });
          If(uFlash.w.greaterThan(0.01), () => {
            const fpp = q.add(uVent).sub(uFlash.xyz);
            col.addAssign(uFlashCol.mul(uFlash.w.mul(exp(dot(fpp, fpp).negate().div(max(uFlashR.mul(uFlashR), 1.0))))));
          });
          const wgt = T.mul(a);
          acc.addAssign(col.mul(wgt));
          tW.addAssign(wgt.mul(t)); wSum.addAssign(wgt);
          T.mulAssign(float(1.0).sub(a));
        });
        t.addAssign(stepL);
      });
      const alpha = float(1.0).sub(T).toVar();
      If(alpha.lessThanEqual(0.004), () => { Discard(); });
      const tHit = select(wSum.greaterThan(1e-4), tW.div(wSum), t0).toVar();
      const cOut = max(acc.div(alpha), vec3(0.0)).toVar();
      If(uFog.x.greaterThan(0.5), () => { cOut.assign(mix(cOut, uFogCol, smoothstep(uFog.y, uFog.z, tHit))); });
      return vec4(min(cOut, vec3(64.0)), alpha);
    });

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.name = "volcanoPlumeVolume(node)";
    mat.side = THREE.BackSide;
    /* OCCLUSION BY THE SCENE'S OWN DEPTH. The GLSL wrote gl_FragDepth at the
       march's mean hit so the box's back face did not decide what hides it.
       Here the march itself stops at the opaque scene (the viewport depth,
       per pixel, in metres along the ray) and the depth test is off: a cone
       standing in the column cuts it exactly where its surface is, with no
       hard plane at the box. */
    mat.transparent = true; mat.depthWrite = false; mat.depthTest = false;
    mat.fog = false;
    mat.blending = THREE.NormalBlending;
    // the box's back faces never clip at the far plane (the GLSL's z clamp)
    mat.vertexNode = Fn(() => {
      const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(modelWorldMatrix).mul(vec4(positionLocal, 1.0));
      return vec4(clip.xy, min(clip.z, clip.w.mul(0.99999)), clip.w);
    })();
    mat.colorNode = march();
    mat.uniforms = U;
    return { mat, U };
  }

  CBZ.plumeNode = { make };
})();
