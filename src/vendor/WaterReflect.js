/* ============================================================================
   src/vendor/WaterReflect.js — the Slayvin flat-mirror reflective water addon,
   ported from three/examples objects/Water.js to the game's vendored r128 UMD
   build. Attaches THREE.WaterReflect (deliberately NOT THREE.Water, so it can
   never collide with an upstream Water class if one is ever vendored).

   HOW IT WORKS (unchanged from upstream): onBeforeRender builds an oblique-
   clipped mirror camera, renders the scene into a render target (the addon
   hides itself for that pass so it can't recurse or reflect itself), then the
   ShaderMaterial samples that mirror texture, perturbs the lookup with a pair
   of scrolling normal-map fields, and adds a Fresnel-weighted mix of water
   colour + sky reflection + sun specular. It is a plain WebGL ShaderMaterial —
   the r128-era examples/js shipped this exact class.

   r128 / offline ADAPTATIONS (the only substantive changes vs. upstream):
     1. `#include <colorspace_fragment>` does NOT exist before r152 — replaced
        with r128's `#include <encodings_fragment>` (same job: output encoding).
        Every other chunk name (tonemapping_fragment, logdepthbuf_*, fog_*,
        shadowmap_*, lights_pars_begin, shadowmask_pars_fragment, bsdfs,
        packing, beginnormal_vertex, defaultnormal_vertex) exists in r128.
     2. The CDN water-normals texture is blocked and none is vendored, so when
        `options.waterNormals` is omitted the constructor synthesises one
        procedurally (see WaterReflect.generateNormalTexture) — a small tiling
        CanvasTexture normal map. Deterministic; only the shader `time` uniform
        animates it.
     3. `this.renderTarget` is exposed so a wrapper can dispose it on teardown
        (upstream keeps it closure-private). Behaviour is otherwise identical.
============================================================================ */
(function () {
  "use strict";
  const THREE = window.THREE;
  if (!THREE || THREE.WaterReflect) return;

  const Color = THREE.Color,
    FrontSide = THREE.FrontSide,
    HalfFloatType = THREE.HalfFloatType,
    Matrix4 = THREE.Matrix4,
    Mesh = THREE.Mesh,
    PerspectiveCamera = THREE.PerspectiveCamera,
    Plane = THREE.Plane,
    ShaderMaterial = THREE.ShaderMaterial,
    UniformsLib = THREE.UniformsLib,
    UniformsUtils = THREE.UniformsUtils,
    Vector3 = THREE.Vector3,
    Vector4 = THREE.Vector4,
    WebGLRenderTarget = THREE.WebGLRenderTarget;

  class WaterReflect extends Mesh {

    constructor(geometry, options = {}) {

      super(geometry);
      this.isWater = true;
      const scope = this;

      const textureWidth = options.textureWidth !== undefined ? options.textureWidth : 512;
      const textureHeight = options.textureHeight !== undefined ? options.textureHeight : 512;
      const clipBias = options.clipBias !== undefined ? options.clipBias : 0.0;
      const alpha = options.alpha !== undefined ? options.alpha : 1.0;
      const time = options.time !== undefined ? options.time : 0.0;
      // r128/offline: default to a synthesised normal map, not null (upstream's
      // default), since the CDN texture cannot be fetched here.
      const normalSampler = options.waterNormals !== undefined ? options.waterNormals : WaterReflect.generateNormalTexture();
      const sunDirection = options.sunDirection !== undefined ? options.sunDirection : new Vector3(0.70707, 0.70707, 0.0);
      const sunColor = new Color(options.sunColor !== undefined ? options.sunColor : 0xffffff);
      const waterColor = new Color(options.waterColor !== undefined ? options.waterColor : 0x7F7F7F);
      const eye = options.eye !== undefined ? options.eye : new Vector3(0, 0, 0);
      const distortionScale = options.distortionScale !== undefined ? options.distortionScale : 20.0;
      const side = options.side !== undefined ? options.side : FrontSide;
      const fog = options.fog !== undefined ? options.fog : false;
      const size = options.size !== undefined ? options.size : 1.0;
      const textureType = options.textureType !== undefined ? options.textureType : HalfFloatType;

      const mirrorPlane = new Plane();
      const normal = new Vector3();
      const mirrorWorldPosition = new Vector3();
      const cameraWorldPosition = new Vector3();
      const rotationMatrix = new Matrix4();
      const lookAtPosition = new Vector3(0, 0, -1);
      const clipPlane = new Vector4();
      const view = new Vector3();
      const target = new Vector3();
      const q = new Vector4();
      const textureMatrix = new Matrix4();
      const mirrorCamera = new PerspectiveCamera();
      const renderTarget = new WebGLRenderTarget(textureWidth, textureHeight, { type: textureType });

      const mirrorShader = {
        name: 'MirrorShader',
        uniforms: UniformsUtils.merge([
          UniformsLib['fog'],
          UniformsLib['lights'],
          {
            'normalSampler': { value: null },
            'mirrorSampler': { value: null },
            'alpha': { value: 1.0 },
            'time': { value: 0.0 },
            'size': { value: 1.0 },
            'distortionScale': { value: 20.0 },
            'textureMatrix': { value: new Matrix4() },
            'sunColor': { value: new Color(0x7F7F7F) },
            'sunDirection': { value: new Vector3(0.70707, 0.70707, 0) },
            'eye': { value: new Vector3() },
            'waterColor': { value: new Color(0x555555) }
          }
        ]),

        vertexShader: /* glsl */`
          uniform mat4 textureMatrix;
          uniform float time;
          varying vec4 mirrorCoord;
          varying vec4 worldPosition;
          #include <common>
          #include <fog_pars_vertex>
          #include <shadowmap_pars_vertex>
          #include <logdepthbuf_pars_vertex>
          void main() {
            mirrorCoord = modelMatrix * vec4( position, 1.0 );
            worldPosition = mirrorCoord.xyzw;
            mirrorCoord = textureMatrix * mirrorCoord;
            vec4 mvPosition =  modelViewMatrix * vec4( position, 1.0 );
            gl_Position = projectionMatrix * mvPosition;
          #include <beginnormal_vertex>
          #include <defaultnormal_vertex>
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
          #include <shadowmap_vertex>
        }`,

        fragmentShader: /* glsl */`
          uniform sampler2D mirrorSampler;
          uniform float alpha;
          uniform float time;
          uniform float size;
          uniform float distortionScale;
          uniform sampler2D normalSampler;
          uniform vec3 sunColor;
          uniform vec3 sunDirection;
          uniform vec3 eye;
          uniform vec3 waterColor;
          varying vec4 mirrorCoord;
          varying vec4 worldPosition;
          vec4 getNoise( vec2 uv ) {
            vec2 uv0 = ( uv / 103.0 ) + vec2(time / 17.0, time / 29.0);
            vec2 uv1 = uv / 107.0-vec2( time / -19.0, time / 31.0 );
            vec2 uv2 = uv / vec2( 8907.0, 9803.0 ) + vec2( time / 101.0, time / 97.0 );
            vec2 uv3 = uv / vec2( 1091.0, 1027.0 ) - vec2( time / 109.0, time / -113.0 );
            vec4 noise = texture2D( normalSampler, uv0 ) +
              texture2D( normalSampler, uv1 ) +
              texture2D( normalSampler, uv2 ) +
              texture2D( normalSampler, uv3 );
            return noise * 0.5 - 1.0;
          }
          void sunLight( const vec3 surfaceNormal, const vec3 eyeDirection, float shiny, float spec, float diffuse, inout vec3 diffuseColor, inout vec3 specularColor ) {
            vec3 reflection = normalize( reflect( -sunDirection, surfaceNormal ) );
            float direction = max( 0.0, dot( eyeDirection, reflection ) );
            specularColor += pow( direction, shiny ) * sunColor * spec;
            diffuseColor += max( dot( sunDirection, surfaceNormal ), 0.0 ) * sunColor * diffuse;
          }
          #include <common>
          #include <packing>
          #include <bsdfs>
          #include <fog_pars_fragment>
          #include <logdepthbuf_pars_fragment>
          #include <lights_pars_begin>
          #include <shadowmap_pars_fragment>
          #include <shadowmask_pars_fragment>
          void main() {
            #include <logdepthbuf_fragment>
            vec4 noise = getNoise( worldPosition.xz * size );
            vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );
            vec3 diffuseLight = vec3(0.0);
            vec3 specularLight = vec3(0.0);
            vec3 worldToEye = eye-worldPosition.xyz;
            vec3 eyeDirection = normalize( worldToEye );
            sunLight( surfaceNormal, eyeDirection, 100.0, 2.0, 0.5, diffuseLight, specularLight );
            float distance = length(worldToEye);
            vec2 distortion = surfaceNormal.xz * ( 0.001 + 1.0 / distance ) * distortionScale;
            vec3 reflectionSample = vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) );
            float theta = max( dot( eyeDirection, surfaceNormal ), 0.0 );
            float rf0 = 0.02;
            float reflectance = rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 5.0 );
            vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;
            vec3 albedo = mix( ( sunColor * diffuseLight * 0.3 + scatter ) * getShadowMask(), reflectionSample + specularLight, reflectance );
            vec3 outgoingLight = albedo;
            gl_FragColor = vec4( outgoingLight, alpha );
            #include <tonemapping_fragment>
            #include <encodings_fragment>
            #include <fog_fragment>
          }`
      };

      const material = new ShaderMaterial({
        name: mirrorShader.name,
        uniforms: UniformsUtils.clone(mirrorShader.uniforms),
        vertexShader: mirrorShader.vertexShader,
        fragmentShader: mirrorShader.fragmentShader,
        lights: true,
        side: side,
        fog: fog
      });

      material.uniforms['mirrorSampler'].value = renderTarget.texture;
      material.uniforms['textureMatrix'].value = textureMatrix;
      material.uniforms['alpha'].value = alpha;
      material.uniforms['time'].value = time;
      material.uniforms['normalSampler'].value = normalSampler;
      material.uniforms['sunColor'].value = sunColor;
      material.uniforms['waterColor'].value = waterColor;
      material.uniforms['sunDirection'].value = sunDirection;
      material.uniforms['distortionScale'].value = distortionScale;
      material.uniforms['eye'].value = eye;
      material.uniforms['size'].value = size;

      scope.material = material;
      // r128/offline addition: expose the mirror target so a wrapper can free
      // it on teardown (upstream keeps this closure-private).
      scope.renderTarget = renderTarget;

      scope.onBeforeRender = function (renderer, scene, camera) {

        mirrorWorldPosition.setFromMatrixPosition(scope.matrixWorld);
        cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
        rotationMatrix.extractRotation(scope.matrixWorld);
        normal.set(0, 0, 1);
        normal.applyMatrix4(rotationMatrix);
        view.subVectors(mirrorWorldPosition, cameraWorldPosition);
        // Avoid rendering when mirror is facing away
        if (view.dot(normal) > 0) return;
        view.reflect(normal).negate();
        view.add(mirrorWorldPosition);
        rotationMatrix.extractRotation(camera.matrixWorld);
        lookAtPosition.set(0, 0, -1);
        lookAtPosition.applyMatrix4(rotationMatrix);
        lookAtPosition.add(cameraWorldPosition);
        target.subVectors(mirrorWorldPosition, lookAtPosition);
        target.reflect(normal).negate();
        target.add(mirrorWorldPosition);
        mirrorCamera.position.copy(view);
        mirrorCamera.up.set(0, 1, 0);
        mirrorCamera.up.applyMatrix4(rotationMatrix);
        mirrorCamera.up.reflect(normal);
        mirrorCamera.lookAt(target);
        mirrorCamera.far = camera.far; // Used in WebGLBackground
        mirrorCamera.updateMatrixWorld();
        mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);
        // Update the texture matrix
        textureMatrix.set(
          0.5, 0.0, 0.0, 0.5,
          0.0, 0.5, 0.0, 0.5,
          0.0, 0.0, 0.5, 0.5,
          0.0, 0.0, 0.0, 1.0
        );
        textureMatrix.multiply(mirrorCamera.projectionMatrix);
        textureMatrix.multiply(mirrorCamera.matrixWorldInverse);
        // Now update projection matrix with new clip plane, implementing code from:
        // http://www.terathon.com/code/oblique.html
        // Paper explaining this technique: http://www.terathon.com/lengyel/Lengyel-Oblique.pdf
        mirrorPlane.setFromNormalAndCoplanarPoint(normal, mirrorWorldPosition);
        mirrorPlane.applyMatrix4(mirrorCamera.matrixWorldInverse);
        clipPlane.set(mirrorPlane.normal.x, mirrorPlane.normal.y, mirrorPlane.normal.z, mirrorPlane.constant);
        const projectionMatrix = mirrorCamera.projectionMatrix;
        q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
        q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
        q.z = -1.0;
        q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];
        // Calculate the scaled plane vector
        clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));
        // Replacing the third row of the projection matrix
        projectionMatrix.elements[2] = clipPlane.x;
        projectionMatrix.elements[6] = clipPlane.y;
        projectionMatrix.elements[10] = clipPlane.z + 1.0 - clipBias;
        projectionMatrix.elements[14] = clipPlane.w;
        eye.setFromMatrixPosition(camera.matrixWorld);

        // Render
        const currentRenderTarget = renderer.getRenderTarget();
        const currentXrEnabled = renderer.xr.enabled;
        const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;
        scope.visible = false;
        renderer.xr.enabled = false; // Avoid camera modification and recursion
        renderer.shadowMap.autoUpdate = false; // Avoid re-computing shadows
        renderer.setRenderTarget(renderTarget);
        renderer.state.buffers.depth.setMask(true); // make sure the depth buffer is writable so it can be properly cleared, see #18897
        if (renderer.autoClear === false) renderer.clear();
        renderer.render(scene, mirrorCamera);
        scope.visible = true;
        renderer.xr.enabled = currentXrEnabled;
        renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;
        renderer.setRenderTarget(currentRenderTarget);
        // Restore viewport
        const viewport = camera.viewport;
        if (viewport !== undefined) {
          renderer.state.viewport(viewport);
        }

      };

    }

  }

  // r128/offline: synthesise a small, seamlessly tiling tangent-space normal
  // map so the addon needs no external texture (the CDN one is blocked and
  // none is vendored). A summed set of integer-frequency sine waves gives a
  // height field whose analytic gradient becomes the normal; integer vectors
  // keep every edge seamless under RepeatWrapping. Deterministic (fixed
  // constants) — only the shader's `time` uniform animates the water.
  WaterReflect.generateNormalTexture = function (size) {
    size = size || 256; // power-of-two: mipmaps + RepeatWrapping on WebGL1
    // [freqX, freqY, amplitude, phase] — six incommensurate directions so the
    // ripple field never reads as one repeating circular cell.
    const waves = [
      [1, 0, 0.60, 0.0], [0, 1, 0.60, 1.7], [2, 1, 0.34, 2.3],
      [1, 2, 0.34, 0.9], [3, 2, 0.18, 3.9], [2, 3, 0.18, 1.3]
    ];
    const strength = 0.85;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size);
    const data = img.data;
    const TWO_PI = Math.PI * 2;
    for (let y = 0; y < size; y++) {
      const v = (y / size) * TWO_PI;
      for (let x = 0; x < size; x++) {
        const u = (x / size) * TWO_PI;
        // analytic gradient of the summed height field
        let dhdu = 0, dhdv = 0;
        for (let k = 0; k < waves.length; k++) {
          const w = waves[k];
          const c = Math.cos(w[0] * u + w[1] * v + w[3]) * w[2];
          dhdu += w[0] * c;
          dhdv += w[1] * c;
        }
        // tangent-space normal: (-dh/du, -dh/dv, 1), then 0.5-centred to RGB
        const nx = -dhdu * strength, ny = -dhdv * strength, nz = 1.0;
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1.0);
        const q = (y * size + x) * 4;
        data[q] = Math.round((nx * inv * 0.5 + 0.5) * 255);
        data[q + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
        data[q + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
        data[q + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // A normal map is data, not colour — keep it linear (r128 default) so no
    // sRGB decode is applied on sample.
    tex.name = 'WaterReflect-normals';
    return tex;
  };

  THREE.WaterReflect = WaterReflect;
})();
