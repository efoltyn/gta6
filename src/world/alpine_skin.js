(function(){"use strict";const CBZ=window.CBZ,THREE=window.THREE;if(!CBZ||!THREE||!THREE.MeshStandardMaterial)return;const CFG=CBZ.CONFIG=CBZ.CONFIG||{};CFG.ALPINE_SKIN_DETAIL==null&&(CFG.ALPINE_SKIN_DETAIL=1);const _detailU={value:1};function tick(){const v=+CFG.ALPINE_SKIN_DETAIL;_detailU.value=Number.isFinite(v)?Math.max(0,Math.min(2,v)):1}let hooked=!1;const GLSL_NOISE=["float alpHash( vec2 p ) {","  p = fract( p * vec2( 443.897, 441.423 ) );","  p += dot( p, p.yx + 19.19 );","  return fract( ( p.x + p.y ) * p.x );","}","float alpVn( vec2 p ) {","  vec2 i = floor( p ), f = fract( p );","  f = f * f * ( 3.0 - 2.0 * f );","  return mix( mix( alpHash( i ), alpHash( i + vec2( 1.0, 0.0 ) ), f.x ),","              mix( alpHash( i + vec2( 0.0, 1.0 ) ), alpHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );","}","float alpRidge( vec2 p ) { return 1.0 - abs( 2.0 * alpVn( p ) - 1.0 ); }","float alpFbm( vec2 p ) {","  float s = 0.0, a = 0.5;","  for ( int i = 0; i < 4; i ++ ) { s += a * alpVn( p ); p = p * 2.03 + vec2( 17.1, 9.7 ); a *= 0.5; }","  return s * 1.0667;","}","float alpRelief( vec2 xz, float snowW, float vegW, float fine, float mid ) {","  float rock = alpRidge( xz * 0.09 ) * 0.55 * mid","             + alpRidge( xz * 0.31 ) * 0.30 * fine","             + alpVn( xz * 1.10 ) * 0.15 * fine;","  float snow = alpVn( xz * 0.16 ) * 0.50 * mid","             + alpVn( xz * vec2( 0.22, 0.95 ) ) * 0.30 * fine","             + alpVn( xz * 2.6 ) * 0.20 * fine * fine;","  float veg = alpVn( xz * 0.17 ) * 0.55 * mid + alpVn( xz * 0.45 ) * 0.45 * fine;","  rock = mix( rock, veg * 0.9, vegW );","  return mix( rock, snow * 0.55, snowW );","}"].join(`
`);CBZ.alpineSkin=function(opts){opts=opts||{};const step=opts.step==null?16:+opts.step,scale=opts.scale==null?1:+opts.scale,snow=new THREE.Color(opts.snow==null?15002094:opts.snow),fineFar=opts.fineFar==null?700:+opts.fineFar,midFar=opts.midFar==null?3600:+opts.midFar,mat=new THREE.MeshStandardMaterial({color:16777215,vertexColors:!0,flatShading:!1,fog:!0,roughness:.92,metalness:0,envMapIntensity:.35,polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:2});return mat.userData=mat.userData||{},mat.userData.alpineSkin=!0,mat.onBeforeCompile=function(sh){sh.uniforms.uAlpDetail=_detailU,sh.uniforms.uAlpStep={value:step},sh.uniforms.uAlpScale={value:scale},sh.uniforms.uAlpSnow={value:snow},sh.uniforms.uAlpFar={value:new THREE.Vector2(fineFar,midFar)};const vSrc=sh.vertexShader,fSrc=sh.fragmentShader;if(vSrc.indexOf("#include <common>")<0||vSrc.indexOf("#include <project_vertex>")<0||fSrc.indexOf("#include <color_fragment>")<0||fSrc.indexOf("#include <normal_fragment_maps>")<0||fSrc.indexOf("#include <roughnessmap_fragment>")<0)return;sh.vertexShader=vSrc.replace("#include <common>",`#include <common>
attribute vec4 aMat;
varying vec4 vAlpMat;
varying vec3 vAlpWPos;
varying vec3 vAlpWNrm;`).replace("#include <project_vertex>",`#include <project_vertex>
  vAlpMat = aMat;
  vAlpWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vAlpWNrm = normalize( mat3( modelMatrix ) * normal );`);let fs=fSrc.replace("#include <common>",`#include <common>
varying vec4 vAlpMat;
varying vec3 vAlpWPos;
varying vec3 vAlpWNrm;
uniform float uAlpDetail;
uniform float uAlpStep;
uniform float uAlpScale;
uniform vec3 uAlpSnow;
uniform vec2 uAlpFar;
`+GLSL_NOISE+`
float alpSnowMask = 0.0; float alpFine = 1.0; float alpMid = 1.0; vec2 alpG = vec2( 0.0 );`);fs=fs.replace("#include <color_fragment>",`#include <color_fragment>
{
  float alpD = length( vViewPosition );
  alpFine = ( 1.0 - smoothstep( uAlpFar.x * 0.25, uAlpFar.x, alpD ) ) * min( uAlpDetail, 1.0 );
  alpMid = ( 1.0 - smoothstep( uAlpFar.y * 0.20, uAlpFar.y, alpD ) ) * min( uAlpDetail, 1.0 );
  vec2 xz = vAlpWPos.xz / uAlpScale;
  float cov = clamp( vAlpMat.x, 0.0, 1.0 );
  float rockW = clamp( vAlpMat.y, 0.0, 1.0 );
  float vegW = clamp( vAlpMat.z, 0.0, 1.0 ) * ( 1.0 - rockW );
  float snowGuess = smoothstep( 0.35, 0.65, cov );
  float e = max( 0.35, alpD * 0.0016 ) / uAlpScale;
  float h0 = alpRelief( xz, snowGuess, vegW, alpFine, alpMid );
  float hx = alpRelief( xz + vec2( e, 0.0 ), snowGuess, vegW, alpFine, alpMid );
  float hz = alpRelief( xz + vec2( 0.0, e ), snowGuess, vegW, alpFine, alpMid );
  alpG = vec2( hx - h0, hz - h0 ) / e;
  float drift = alpFbm( xz * 0.055 ) - 0.5;
  float frayed = alpVn( xz * 0.42 ) - 0.5;
  float cov2 = cov + ( drift * 0.62 + frayed * 0.22 ) * mix( 0.6, 1.0, alpMid );
  float snowM = smoothstep( 0.40, 0.60, cov2 );
  float rib = smoothstep( 0.35, 1.15, length( alpG ) * ( 0.55 + 0.45 * rockW ) );
  snowM *= 1.0 - 0.85 * rib * ( 1.0 - cov * cov ) * uAlpDetail;
  alpSnowMask = snowM;
  float bed = fract( ( vAlpWPos.y + ( alpVn( xz * 0.012 ) - 0.5 ) * uAlpStep * 3.0 + ( alpVn( xz * 0.06 ) - 0.5 ) * uAlpStep * 0.8 ) / uAlpStep );
  float bedMask = smoothstep( 0.30, 0.70, alpVn( xz * 0.025 + 7.0 ) );
  float contact = max( smoothstep( 0.86, 0.98, bed ), 1.0 - smoothstep( 0.02, 0.10, bed ) );
  float grain = mix( 0.5, alpVn( xz * 0.35 ), alpMid ) * 0.6 + mix( 0.5, alpVn( xz * 1.5 ), alpFine ) * 0.4;
  float crack = pow( alpRidge( xz * 0.20 ), 6.0 ) * 0.7 + pow( alpRidge( xz * 0.75 ), 8.0 ) * 0.3;
  float rockMod = ( 0.74 + 0.52 * grain ) * ( 1.0 - 0.20 * contact * bedMask * alpMid ) * ( 1.0 - 0.42 * crack * alpFine );
  rockMod = mix( 1.0, rockMod, uAlpDetail );
  float mottle = alpFbm( xz * 0.030 );
  float clump = mix( 0.5, alpVn( xz * 0.13 ) * 0.6 + alpVn( xz * 0.28 ) * 0.4, alpMid );
  float crowns = alpVn( xz * 0.55 ) * 0.5 + alpVn( xz * 1.3 ) * 0.5;
  float vegMod = ( 0.34 + 0.95 * mottle ) * ( 0.55 + 0.90 * clump ) * ( 0.78 + 0.44 * crowns * alpFine + 0.22 * ( 1.0 - alpFine ) );
  vegMod = mix( 1.0, vegMod, uAlpDetail );
  vec3 vegTint = mix( vec3( 1.0 ), vec3( 0.80, 0.98, 0.72 ), vegW * uAlpDetail );
  vec3 base = diffuseColor.rgb * mix( 1.0, rockMod, rockW ) * mix( 1.0, vegMod, vegW ) * vegTint;
  float ripple = alpVn( xz * 0.50 ) * 0.6 + alpVn( xz * 0.14 ) * 0.4;
  vec3 snowCol = uAlpSnow * ( 0.94 + 0.08 * ripple ) * mix( vec3( 1.0 ), vec3( 0.97, 0.985, 1.0 ), 1.0 - ripple );
  diffuseColor.rgb = mix( base, snowCol, snowM );
}`),fs=fs.replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
roughnessFactor = mix( 0.93, 0.66, alpSnowMask );`),fs=fs.replace("#include <normal_fragment_maps>",`#include <normal_fragment_maps>
{
  float amp = mix( 1.35, 0.75, alpSnowMask ) * uAlpDetail;
  vec3 nP = normalize( vAlpWNrm + vec3( - alpG.x, 0.0, - alpG.y ) * amp );
  normal = normalize( normal + mat3( viewMatrix ) * ( nP - vAlpWNrm ) );
}`),fs.indexOf("#include <aomap_fragment>")>=0&&(fs=fs.replace("#include <aomap_fragment>",`#include <aomap_fragment>
{
  float alpAo = 1.0 - 0.38 * clamp( vAlpMat.w, 0.0, 1.0 );
  reflectedLight.indirectDiffuse *= alpAo;
  reflectedLight.indirectSpecular *= alpAo;
}`)),sh.fragmentShader=fs},CBZ.gfxRegisterPbr&&CBZ.gfxRegisterPbr(mat),!hooked&&CBZ.onAlways&&(hooked=!0,CBZ.onAlways(91.7,tick)),mat}})();
