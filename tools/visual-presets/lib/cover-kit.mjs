/* STORE-COVER KIT — the part of a product-photography preset that is the same
   for every game on this repo: the title as the only text, the page's own
   chrome off, a low warm sun painted over whatever light the page booted with.

   HARNESS TRAP: a preset's stage() is SERIALIZED into the page, so this kit
   cannot be imported from inside it. Embed it:

       const K = (${coverKit.toString()})();

   and nothing from module scope is reachable past that line. Every knob rides
   on the subject or on the call. Consumers: npcwar-product.mjs,
   warlord-product.mjs (shark-product.mjs predates this file and carries its
   own copy of the title code). */

export function coverKit() {
  const K = {};

  /* THE PAGE IS A CANVAS AND NOTHING ELSE. Hide every body child that is not
     the renderer's canvas and does not contain it (warlord.html wraps screens
     in fixed divs; battle.html's studio HUD is a tree of its own). A
     stylesheet rule outranks the per-frame `style.display` writes state.js
     makes on its pointer-lock pill. */
  K.hideChrome = function (C) {
    const cv = C && C.renderer ? C.renderer.domElement : null;
    for (const el of Array.from(document.body.children)) {
      if (el === cv) continue;
      if (cv && el.contains(cv)) continue;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') continue;
      if (el.id === 'coverTitle' || el.id === 'coverVignette') continue;
      el.style.setProperty('display', 'none', 'important');
    }
    if (!document.getElementById('coverNoHint')) {
      const st = document.createElement('style'); st.id = 'coverNoHint';
      st.textContent = '#lockHint,#hint,#banner,#nflash,#end,#top,#ctl,#who,#menu,.sHud{display:none!important}';
      document.head.appendChild(st);
    }
    if (C && C.bootMeter && C.bootMeter.hide) { try { C.bootMeter.hide(); } catch (e) {} }
  };

  /* A REAL TYPEFACE, OR THE FALLBACK — never a 6 s wait that fails the run.
     Google Fonts is reachable from headless Chrome on this box; if it is not,
     document.fonts.load rejects or times out and Impact carries the word. */
  K.font = async function (family, weight) {
    const id = 'coverFont-' + family.replace(/\W+/g, '');
    if (!document.getElementById(id)) {
      const l = document.createElement('link'); l.id = id; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') +
        (weight ? ':wght@' + weight : '') + '&display=swap';
      document.head.appendChild(l);
    }
    const spec = (weight || 400) + ' 100px "' + family + '"';
    try {
      await Promise.race([
        document.fonts.load(spec),
        new Promise((r) => setTimeout(r, 6000)),
      ]);
    } catch (e) {}
    try { return document.fonts.check(spec); } catch (e) { return false; }
  };

  /* THE TITLE. The one text a portal allows on a cover. Sized to the frame
     and then SHRUNK until it fits 92% of the width, because "DESERT WARLORD"
     at the 16:9 size is wider than an 800 px portrait. Two lines on a
     portrait or square frame when the title has a space in it. */
  K.title = function (text, o) {
    o = o || {};
    const aspect = innerWidth / innerHeight;
    let el = document.getElementById('coverTitle');
    if (!el) { el = document.createElement('div'); el.id = 'coverTitle'; document.body.appendChild(el); }
    const lines = (aspect <= 1 && o.wrap !== false && text.indexOf(' ') > 0) ? text.split(' ') : [text];
    el.innerHTML = lines.map((s) => '<span>' + s + '</span>').join('<br>');
    let px = Math.round(Math.min(innerWidth * (o.scaleW || 0.135), innerHeight * (o.scaleH || 0.17)));
    const top = o.top != null ? o.top : (aspect < 1 ? 6 : 5);
    el.style.cssText =
      'position:fixed;z-index:2147483647;top:' + top + '%;left:4%;right:4%;text-align:center;' +
      'color:' + (o.color || '#fff') + ';font-family:' + (o.family ? '"' + o.family + '",' : '') + 'Impact,"Arial Black",Arial,sans-serif;' +
      'font-weight:' + (o.weight || 900) + ';line-height:' + (o.lineHeight || 0.9) + ';letter-spacing:' + (o.tracking || '-.02em') + ';' +
      'text-shadow:' + (o.shadow || '0 4px 0 #1a1a1a,0 10px 30px rgba(0,0,0,.85)') + ';pointer-events:none;white-space:nowrap;' +
      (o.transform ? 'transform:' + o.transform + ';' : '') +
      (o.extra || '');
    el.style.fontSize = px + 'px';
    // measure against the widest line, not the block
    const fit = () => {
      let w = 0;
      for (const s of el.querySelectorAll('span')) w = Math.max(w, s.getBoundingClientRect().width);
      return w;
    };
    for (let i = 0; i < 40 && fit() > innerWidth * (o.fit || 0.92); i++) { px = Math.round(px * 0.94); el.style.fontSize = px + 'px'; }
    el.style.display = '';
    return { px: px, lines: lines.length, family: o.family || null };
  };

  /* A SOFT DARKENING BEHIND THE TITLE, so white type reads on a bright sky.
     No border, no icon — a gradient, from the top edge, and nothing else. */
  K.vignette = function (o) {
    o = o || {};
    let el = document.getElementById('coverVignette');
    if (!el) { el = document.createElement('div'); el.id = 'coverVignette'; document.body.appendChild(el); }
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;' +
      'background:linear-gradient(180deg,rgba(0,0,0,' + (o.top != null ? o.top : 0.42) + ') 0%,rgba(0,0,0,0) ' + (o.stop || 34) + '%' +
      (o.bottom ? ',rgba(0,0,0,0) ' + (100 - (o.bottomStop || 22)) + '%,rgba(0,0,0,' + o.bottom + ') 100%' : '') + ')';
  };

  /* THE LOW SUN. microboot parks its rig relative to the camera in a frame
     hook and re-asserts the intensities in an always hook; both only run
     inside stepSim, so a sun written AFTER the last advance() and BEFORE
     render() is the sun that lands on the photograph. `az` is the compass
     bearing the light comes FROM, in radians about +Y; `el` its elevation
     as a fraction of the rig distance. The sky dome is microboot's own
     two-colour shader (topColor/bottomColor) — repainted, not replaced. */
  K.lowSun = function (C, T, o) {
    o = o || {};
    const M = C.micro || {};
    const sun = M.sun || C.sun, hemi = M.hemiLight || C.hemi, cam = C.camera, scene = C.scene;
    if (!sun || !cam) return false;
    const d = o.dist || 900, el = o.el != null ? o.el : 0.18;
    const az = o.az != null ? o.az : 0;
    sun.position.set(cam.position.x + Math.sin(az) * d, d * el, cam.position.z + Math.cos(az) * d);
    if (sun.target) { sun.target.position.set(cam.position.x, 0, cam.position.z); sun.target.updateMatrixWorld(); }
    if (o.color != null) sun.color.setHex(o.color);
    if (o.sun != null) sun.intensity = o.sun;
    if (sun.shadow && sun.shadow.camera) { sun.shadow.camera.updateProjectionMatrix(); }
    if (hemi) {
      if (o.hemi != null) hemi.intensity = o.hemi;
      if (o.sky != null) hemi.color.setHex(o.sky);
      if (o.ground != null) hemi.groundColor.setHex(o.ground);
    }
    if (scene && scene.fog && o.fog != null) scene.fog.color.setHex(o.fog);
    if (scene && scene.background && scene.background.isColor && o.fog != null) scene.background.setHex(o.fog);
    const dome = M.skyDome;
    if (dome && dome.material && dome.material.uniforms) {
      if (o.top != null) dome.material.uniforms.topColor.value.setHex(o.top);
      if (o.bot != null) dome.material.uniforms.bottomColor.value.setHex(o.bot);
    }
    return true;
  };

  /* PLACE THE LENS BY HAND. Every director on these pages writes CBZ.camera
     inside its frame; nothing rewrites it between the last advance() and
     render(), so a camera set here is the camera that draws. */
  K.lens = function (C, T, pos, at, fov) {
    const cam = C.camera;
    cam.aspect = innerWidth / innerHeight;
    if (fov) cam.fov = fov;
    cam.updateProjectionMatrix();
    cam.position.set(pos.x, pos.y, pos.z);
    cam.up.set(0, 1, 0);
    cam.lookAt(at.x, at.y, at.z);
    cam.updateMatrixWorld(true);
    return { pos: [pos.x, pos.y, pos.z].map((v) => +v.toFixed(2)), at: [at.x, at.y, at.z].map((v) => +v.toFixed(2)), fov: cam.fov };
  };

  K.render = function (C) {
    const R = C.renderer || (C.micro && C.micro.renderer);
    if (R && C.camera) R.render(C.scene, C.camera);
  };

  return K;
}
