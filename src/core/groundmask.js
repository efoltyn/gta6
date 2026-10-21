(function(){"use strict";const CBZ=window.CBZ;if(!CBZ||!window.THREE)return;const THREE=window.THREE;CBZ.CONFIG=CBZ.CONFIG||{},CBZ.CONFIG.GROUND_MASK==null&&(CBZ.CONFIG.GROUND_MASK=!0),CBZ.CONFIG.GROUND_MASK_SLOTS==null&&(CBZ.CONFIG.GROUND_MASK_SLOTS=16);const SLOTS=Math.max(1,Math.min(32,CBZ.CONFIG.GROUND_MASK_SLOTS|0)),BAND_UP=.35,BAND_DOWN=6,PROFILE_N=64,PROF_LO=.5,PROF_HI=1.5;function quantize(m){return Math.round((Math.min(PROF_HI,Math.max(PROF_LO,m))-PROF_LO)*65535)/65535+PROF_LO}const profData=new Uint8Array(PROFILE_N*SLOTS*4),profTex=new THREE.DataTexture(profData,PROFILE_N,SLOTS,THREE.RGBAFormat,THREE.UnsignedByteType);profTex.magFilter=THREE.NearestFilter,profTex.minFilter=THREE.NearestFilter,profTex.generateMipmaps=!1,profTex.flipY=!1,profTex.wrapS=profTex.wrapT=THREE.ClampToEdgeWrapping;const rowSrc=new Array(SLOTS).fill(void 0);function writeRow(i,prof){if(rowSrc[i]===prof)return!1;rowSrc[i]=prof;for(let k=0;k<PROFILE_N;k++){const m=prof?prof[k]:1,v=Math.round((Math.min(PROF_HI,Math.max(PROF_LO,m))-PROF_LO)*65535),o=(i*PROFILE_N+k)*4;profData[o]=v>>8,profData[o+1]=v&255,profData[o+2]=0,profData[o+3]=255}return!0}for(let i=0;i<SLOTS;i++)writeRow(i,null);profTex.needsUpdate=!0;const uProf={value:[profTex]},slots=[];for(let i=0;i<SLOTS;i++)slots.push(new THREE.Vector4(0,0,0,0));const uHoles={value:slots},state={installed:!1,why:"",libs:0,filled:0},GLSL_PARS_V=`varying vec3 vCbzGW;
`,GLSL_VERT=`
#if defined( USE_INSTANCING ) || defined( USE_SKINNING )
  vCbzGW = vec3( 0.0, 1.0e9, 0.0 );
#else
  vCbzGW = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
#endif
`,NF=PROFILE_N.toFixed(1),SF=SLOTS.toFixed(1),DA=Math.PI*2/PROFILE_N,GLSL_PARS_F="uniform vec4 uCbzHoles["+SLOTS+`];
varying vec3 vCbzGW;
#ifdef CBZ_PROF
uniform sampler2D uCbzProf[ 1 ];
float cbzProfAt( float i, float row ) {
  vec4 t = texture2D( uCbzProf[ 0 ], vec2( ( i + 0.5 ) / `+NF+`, row ) );
  return dot( t.rg, vec2( 65280.0, 255.0 ) ) / 65535.0 + `+PROF_LO.toFixed(1)+`;
}
#endif
`,GLSL_FRAG=`
#ifndef CBZ_NOMASK
  for ( int cbzI = 0; cbzI < `+SLOTS+`; cbzI++ ) {
    vec4 cbzH = uCbzHoles[ cbzI ];
    if ( cbzH.z <= 0.0 ) break;
    if ( vCbzGW.y < cbzH.w + `+BAND_UP.toFixed(2)+" && vCbzGW.y > cbzH.w - "+BAND_DOWN.toFixed(2)+` ) {
      vec2 cbzD = vCbzGW.xz - cbzH.xy;
      float cbzL = length( cbzD );
      if ( cbzL < cbzH.z * `+PROF_LO.toFixed(2)+` ) discard;
#ifdef CBZ_PROF
      if ( cbzL < cbzH.z * `+PROF_HI.toFixed(2)+` ) {
        float cbzT = atan( cbzD.y, cbzD.x );
        if ( cbzT < 0.0 ) cbzT += 6.28318530718;
        float cbzI0 = min( floor( cbzT * `+(PROFILE_N/(Math.PI*2)).toFixed(8)+" ), "+(PROFILE_N-1).toFixed(1)+` );
        float cbzRow = ( float( cbzI ) + 0.5 ) / `+SF+`;
        float cbzR0 = cbzProfAt( cbzI0, cbzRow );
        float cbzR1 = cbzProfAt( mod( cbzI0 + 1.0, `+NF+` ), cbzRow );
        float cbzA0 = cbzI0 * `+DA.toFixed(8)+`;
        float cbzDen = cbzR0 * sin( cbzT - cbzA0 ) + cbzR1 * sin( cbzA0 + `+DA.toFixed(8)+` - cbzT );
        if ( cbzL * max( cbzDen, 1e-5 ) < cbzH.z * cbzR0 * cbzR1 * `+Math.sin(DA).toFixed(8)+` ) discard;
      }
#else
      if ( cbzL < cbzH.z ) discard;
#endif
    }
  }
#endif
`;function install(){if(state.installed)return!0;if(CBZ.CONFIG.GROUND_MASK===!1)return state.why="GROUND_MASK off",!1;if(!THREE.ShaderChunk||!THREE.ShaderLib)return state.why="no ShaderChunk/ShaderLib",!1;if(!CBZ.renderer)return state.why="loaded before core/renderer.js, its installFog would erase this patch silently",window.console&&console.error("[groundmask] "+state.why),!1;const parsV=THREE.ShaderChunk.fog_pars_vertex,vtx=THREE.ShaderChunk.fog_vertex,parsF=THREE.ShaderChunk.fog_pars_fragment,frg=THREE.ShaderChunk.fog_fragment;if(typeof parsV!="string"||typeof vtx!="string"||typeof parsF!="string"||typeof frg!="string")return state.why="fog chunks missing, unknown THREE build, left alone",!1;if(frg.indexOf("uCbzHoles")>=0)return state.installed=!0,!0;THREE.ShaderChunk.fog_pars_vertex=GLSL_PARS_V+parsV,THREE.ShaderChunk.fog_vertex=GLSL_VERT+vtx,THREE.ShaderChunk.fog_pars_fragment=GLSL_PARS_F+parsF,THREE.ShaderChunk.fog_fragment=GLSL_FRAG+frg;for(const k in THREE.ShaderLib){const sh=THREE.ShaderLib[k];!sh||!sh.uniforms||(sh.uniforms.uCbzHoles=uHoles,typeof sh.fragmentShader=="string"&&sh.fragmentShader.indexOf("CBZ_PROF")<0&&(sh.fragmentShader=`#define CBZ_PROF 1
`+sh.fragmentShader,sh.uniforms.uCbzProf=uProf),state.libs++)}return state.installed=!0,!0}install(),CBZ.groundMaskAttach=function(mat){return!mat||!mat.uniforms?!1:(mat.uniforms.uCbzHoles=uHoles,mat.uniforms.uCbzProf=uProf,mat.defines=mat.defines||{},mat.defines.CBZ_PROF||(mat.defines.CBZ_PROF=1,mat.needsUpdate=!0),!0)},CBZ.groundMaskExempt=function(mat){return mat?(mat.defines=mat.defines||{},mat.defines.CBZ_NOMASK||(mat.defines.CBZ_NOMASK=1,mat.needsUpdate=!0),!0):!1};function eyeX(){return CBZ.camera?CBZ.camera.position.x:CBZ.player&&CBZ.player.pos?CBZ.player.pos.x:0}function eyeZ(){return CBZ.camera?CBZ.camera.position.z:CBZ.player&&CBZ.player.pos?CBZ.player.pos.z:0}function score(h,ex,ez,px,pz){const de=(h.x-ex)*(h.x-ex)+(h.z-ez)*(h.z-ez);if(px==null)return de;const dp=(h.x-px)*(h.x-px)+(h.z-pz)*(h.z-pz);return dp<h.r*h.r?-1e9+dp:de<dp?de:dp}const rank=[];CBZ.groundMaskApply=function(entries){const out=[];if(!state.installed)return state.filled=0,out;const n=entries?entries.length:0;rank.length=0;for(let i=0;i<n;i++)entries[i]&&rank.push(entries[i]);if(rank.length>SLOTS){const ex=eyeX(),ez=eyeZ(),pp=CBZ.player&&CBZ.player.pos,px=pp?pp.x:null,pz=pp?pp.z:null;rank.sort(function(a,b){return score(a,ex,ez,px,pz)-score(b,ex,ez,px,pz)}),rank.length=SLOTS}let dirty=!1;for(let i=0;i<SLOTS;i++){const h=rank[i];h?(slots[i].set(h.x,h.z,h.r,h.y),out.push(h.src!==void 0?h.src:h),writeRow(i,h.prof||null)&&(dirty=!0)):slots[i].set(0,0,0,0)}return dirty&&(profTex.needsUpdate=!0),state.filled=out.length,out};const providers=[];let won=[];CBZ.groundMaskProvide=function(fn){typeof fn=="function"&&providers.indexOf(fn)<0&&providers.push(fn)},CBZ.groundMaskSlotted=function(){return won};const gather=[];CBZ.groundMaskSync=function(){gather.length=0;for(let i=0;i<providers.length;i++){let e=null;try{e=providers[i]()}catch{e=null}if(e)for(let k=0;k<e.length;k++)e[k]&&gather.push(e[k])}return won=CBZ.groundMaskApply(gather),won},CBZ.onUpdate&&CBZ.onUpdate(28.55,function(){providers.length&&CBZ.groundMaskSync()}),CBZ.groundMaskSlots=SLOTS,CBZ.groundMaskProfile={N:PROFILE_N,lo:PROF_LO,hi:PROF_HI,quantize},CBZ.groundMaskEye=function(){return{x:eyeX(),z:eyeZ()}},CBZ.groundMaskAudit=function(){return{installed:state.installed,why:state.why||null,slots:SLOTS,filled:state.filled,shaderLibsPatched:state.libs,bandUp:BAND_UP,bandDown:BAND_DOWN,profileN:PROFILE_N,sweptMeshes:0,raycasts:0}}})();
