(function(){"use strict";const CBZ=window.CBZ=window.CBZ||{},THREE=window.THREE;function groundFar(){const f=+CBZ.cityFogFar;return f>0?f:1e3}function airFar(eyeY){const t=Math.max(0,Math.min(1,(eyeY-60)/700));return 4200+6800*t*t*(3-2*t)}CBZ.sightAirFar=airFar;const S={far:1e3,near:160,detail:1036,reach:1400,camFar:1400,airborne:!1,x:0,y:0,z:0,px:0,pz:0,eyeOff:0};CBZ.sight=function(){const cam=CBZ.camera,P=CBZ.player,pos=P&&P.pos,ex=cam?cam.position.x:pos?pos.x:0,ey=cam?cam.position.y:pos?pos.y:0,ez=cam?cam.position.z:pos?pos.z:0;S.x=ex,S.y=ey,S.z=ez,S.px=pos?pos.x:ex,S.pz=pos?pos.z:ez,S.eyeOff=Math.hypot(ex-S.px,ez-S.pz);const chuting=!!(CBZ.cityChuteState&&CBZ.cityChuteState()),highUp=!!(pos&&pos.y>24&&!P.grounded),lifted=!!(pos&&cam&&cam.position.y-pos.y>60);S.airborne=!!(pos&&(pos.y>24&&(P._aircraft||chuting||highUp)||lifted));const g=groundFar(),eyeY=Math.max(ey,pos?pos.y:0);S.far=S.airborne?Math.max(g,airFar(eyeY)):g,S.near=Math.max(90,Math.round(S.far*.16)),S.detail=g+36;let k=1.4;if(cam&&cam.isPerspectiveCamera){const tv=Math.tan((cam.fov||60)*Math.PI/360),th=tv*(cam.aspect||1.5);k=Math.sqrt(1+tv*tv+th*th)}S.reach=S.far*k+Math.max(0,ey)*2;const landmarkFar=Math.max(CBZ.cityDistantLandmarkFar||0,CBZ.metroViewFar||0);return S.camFar=S.airborne?Math.max(7e3,S.far+900,landmarkFar):Math.max(1400,S.far+180,landmarkFar),S};function eyeDist(x,z,r){return Math.hypot(x-S.x,z-S.z)-(r||0)}CBZ.sightSees=function(x,z,r){return CBZ.sight(),eyeDist(x,z,r)<S.reach},CBZ.sightNeedsDetail=function(x,z,r){return CBZ.sight(),eyeDist(x,z,r)<S.detail},CBZ.sightPixelRange=function(size){let k=1e3;const cam=CBZ.camera,cv=CBZ.renderer&&CBZ.renderer.domElement;return cam&&cam.isPerspectiveCamera&&cv&&cv.height>0&&(k=cv.height/(2*Math.tan((cam.fov||60)*Math.PI/360))),size*k};const _sv=THREE?new THREE.Vector3:null;CBZ.sightCanSee=function(x,y,z,r){if(CBZ.sight(),eyeDist(x,z,r||0)>S.reach)return!1;const cam=CBZ.camera;return!cam||!_sv||!cam.projectionMatrix||!cam.matrixWorldInverse?!0:(_sv.set(x,y??(CBZ.player&&CBZ.player.pos?CBZ.player.pos.y+1:1),z).project(cam),_sv.z>=-1.05&&_sv.z<=1.05&&Math.abs(_sv.x)<=1.3&&Math.abs(_sv.y)<=1.4)};const BAND=30;CBZ.SIGHT_FADE_BAND=BAND;const U=CBZ.sightU={cbzSightEye:{value:THREE?new THREE.Vector3:{x:0,y:0,z:0}},cbzSightSwap:{value:1036},cbzSightBand:{value:BAND}},ONE={value:1};CBZ.sightFadeT=function(d,swap){const s=swap??S.detail;return Math.max(0,Math.min(1,(d-(s-BAND/2))/BAND))};const MV={t:0,wall:0,x:0,z:0,at:0,has:!1};S.vx=0,S.vz=0,S.speed=0,S.hx=0,S.hz=0;function track(){const P=CBZ.player,pos=P&&P.pos;if(!pos)return;const now=typeof performance<"u"?performance.now():Date.now(),step=MV.wall?Math.min(.05,Math.max(0,(now-MV.wall)/1e3)):0;if(MV.wall=now,MV.t+=step,!MV.has){MV.has=!0,MV.x=pos.x,MV.z=pos.z,MV.at=MV.t;return}const dt=MV.t-MV.at;if(dt<.1)return;const dx=pos.x-MV.x,dz=pos.z-MV.z,d=Math.hypot(dx,dz);if(MV.x=pos.x,MV.z=pos.z,MV.at=MV.t,d>400){S.vx=S.vz=S.speed=0;return}const k=Math.min(1,dt/.5);S.vx+=(dx/dt-S.vx)*k,S.vz+=(dz/dt-S.vz)*k,S.speed=Math.hypot(S.vx,S.vz),S.speed>.5&&(S.hx=S.vx/S.speed,S.hz=S.vz/S.speed)}const AHEAD={x:0,z:0,lead:0,hx:0,hz:0,speed:0};CBZ.sightAhead=function(T){const lead=S.speed>3?Math.min(S.airborne?2e3:450,S.speed*(T??6)):0;return AHEAD.hx=S.hx,AHEAD.hz=S.hz,AHEAD.speed=S.speed,AHEAD.lead=lead,AHEAD.x=S.px+S.hx*lead,AHEAD.z=S.pz+S.hz*lead,AHEAD},CBZ.sightPublish=function(){CBZ.sight(),track();const e=U.cbzSightEye.value;return e.set?e.set(S.x,S.y,S.z):(e.x=S.x,e.y=S.y,e.z=S.z),U.cbzSightSwap.value=S.detail,S};const GLSL_DITHER=["float cbzBayer2( vec2 a ) { a = floor( a ); return fract( a.x * 0.5 + a.y * a.y * 0.75 ); }","float cbzDither( vec2 p ) { return cbzBayer2( 0.5 * p ) * 0.25 + cbzBayer2( p ) + 0.03125; }"].join(`
`);CBZ.SIGHT_DITHER_GLSL=GLSL_DITHER,CBZ.sightFade=function(mat,which,o){if(!mat||mat.userData&&mat.userData._cbzSightFade)return mat;o=o||{};const far=which==="far",anchor=o.anchor==="instance"||o.anchor==="object"?o.anchor:"world",swapU=o.swap||U.cbzSightSwap,readyU=o.ready||ONE,RM=o.readyMap&&o.readyMap.map?o.readyMap:null,idAttr=RM?RM.attr||"aFarId":null;mat.userData=mat.userData||{},mat.userData._cbzSightFade=which,far&&o.cover&&(mat.polygonOffset=!0,mat.polygonOffsetFactor=Math.min(mat.polygonOffsetFactor||0,-1),mat.polygonOffsetUnits=Math.min(mat.polygonOffsetUnits||0,-4));const tag="|fade-"+which+"-"+anchor+(RM?"-rm":""),prev=mat.onBeforeCompile,ownKey=Object.prototype.hasOwnProperty.call(mat,"customProgramCacheKey")?mat.customProgramCacheKey:null,prevSrc=prev?String(prev):"";return mat.customProgramCacheKey=function(){return(ownKey?ownKey.call(this):prevSrc)+tag},mat.onBeforeCompile=function(sh,r){if(prev&&prev.call(this,sh,r),sh.vertexShader.indexOf("#include <project_vertex>")<0||sh.fragmentShader.indexOf("#include <clipping_planes_fragment>")<0)return;sh.uniforms.cbzSightEye=U.cbzSightEye,sh.uniforms.cbzSightBand=U.cbzSightBand,sh.uniforms.cbzFadeSwap=swapU,sh.uniforms.cbzFadeReady=readyU,RM&&(sh.uniforms.cbzReadyMap=RM.map,sh.uniforms.cbzReadySize=RM.size);const head=`uniform vec3 cbzSightEye;
uniform float cbzSightBand;
uniform float cbzFadeSwap;
uniform float cbzFadeReady;
`,fadeOf=function(d){return"max( clamp( ( "+d+" - ( cbzFadeSwap - 0.5 * cbzSightBand ) ) / cbzSightBand, 0.0, 1.0 ), 1.0 - cbzFadeReady )"};let vHead=head,vBody="";anchor==="world"?(vHead+=`varying vec2 vCbzW;
`,vBody=`#ifdef USE_INSTANCING
  vCbzW = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xz;
#else
  vCbzW = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;
#endif
`):(vHead+=`varying float vCbzT;
`,vBody=(anchor==="instance"?`#ifdef USE_INSTANCING
  vec2 cbzRoot = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xz;
#else
`:"")+`  vec2 cbzRoot = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xz;
`+(anchor==="instance"?`#endif
`:"")+"  vCbzT = "+fadeOf("length( cbzRoot - cbzSightEye.xz )")+`;
`+(far?`  if ( vCbzT <= 0.0 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
`:`  if ( vCbzT >= 1.0 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
`)),RM&&(vHead+="attribute float "+idAttr+`;
varying float vCbzId;
`,vBody+="  vCbzId = "+idAttr+`;
`),sh.vertexShader=vHead+sh.vertexShader.replace("#include <project_vertex>",`#include <project_vertex>
`+vBody);let fHead=head+GLSL_DITHER+`
`+(anchor==="world"?`varying vec2 vCbzW;
`:`varying float vCbzT;
`),fBody=`{
  float cbzT = `+(anchor==="world"?fadeOf("length( vCbzW - cbzSightEye.xz )"):"vCbzT")+`;
`;RM&&(fHead+=`uniform sampler2D cbzReadyMap;
uniform vec2 cbzReadySize;
varying float vCbzId;
`,fBody+=`  float cbzI = floor( vCbzId + 0.5 );
  vec4 cbzR = texture2D( cbzReadyMap, vec2( ( mod( cbzI, cbzReadySize.x ) + 0.5 ) / cbzReadySize.x, ( floor( cbzI / cbzReadySize.x ) + 0.5 ) / cbzReadySize.y ) );
  if ( cbzR.g > 0.5 ) discard;
  cbzT = max( cbzT, 1.0 - cbzR.r );
`),fBody+=`  float cbzDn = cbzDither( gl_FragCoord.xy );
`+(far?`  if ( cbzDn >= cbzT ) discard;
`:`  if ( cbzDn < cbzT ) discard;
`)+`}
`,sh.fragmentShader=fHead+sh.fragmentShader.replace("#include <clipping_planes_fragment>",fBody+"#include <clipping_planes_fragment>")},mat.needsUpdate=!0,mat}})();
