(function(){"use strict";const CBZ=window.CBZ;if(!CBZ||!window.THREE)return;const THREE=window.THREE,WING={x0:-16,x1:16,z0:-44,z1:-8},MASK_RES=.25,MW=Math.round((WING.x1-WING.x0)/MASK_RES),MH=Math.round((WING.z1-WING.z0)/MASK_RES),FY=3.9,CH=3.6,MAX_LAMPS=18,U={prOn:{value:0},prLamp:{value:[]},prLampCol:{value:[]},prLampN:{value:0},prCellLamp:{value:1},prIndoorAmb:{value:.42},prIndoorSun:{value:.16},prMask:{value:null},prFall:{value:.1},prCone:{value:1.5}};for(let i=0;i<MAX_LAMPS;i++)U.prLamp.value.push(new THREE.Vector4(0,-100,0,0)),U.prLampCol.value.push(new THREE.Color(0,0,0));function buildMask(){const cb=CBZ.cellblock,cells=cb&&cb.cells||[],data=new Uint8Array(MW*MH*4);for(let i=0;i<MW*MH;i++)data[i*4]=255,data[i*4+1]=0,data[i*4+2]=128,data[i*4+3]=128;const stamp=(x0,z0,x1,z1,fn)=>{const i0=Math.max(0,Math.floor((x0-WING.x0)/MASK_RES)),i1=Math.min(MW-1,Math.ceil((x1-WING.x0)/MASK_RES)-1),j0=Math.max(0,Math.floor((z0-WING.z0)/MASK_RES)),j1=Math.min(MH-1,Math.ceil((z1-WING.z0)/MASK_RES)-1);for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)fn((j*MW+i)*4,WING.x0+(i+.5)*MASK_RES,WING.z0+(j+.5)*MASK_RES)};for(const c of cells){if(!c.tier)continue;const gx0=c.dx===1?c.x+c.hx:c.dx===-1?c.x-c.hx-1.35:c.x-c.hx,gx1=c.dx===1?c.x+c.hx+1.35:c.dx===-1?c.x-c.hx:c.x+c.hx,gz0=c.dz===1?c.z+c.hz:c.z-c.hz,gz1=c.dz===1?c.z+c.hz+1.35:c.z+c.hz;stamp(gx0,gz0,gx1,gz1,p=>{data[p]=Math.min(data[p],110)})}for(const c of cells)stamp(c.x-c.hx,c.z-c.hz,c.x+c.hx,c.z+c.hz,(p,x,z)=>{data[p]=0,data[p+1]=255,data[p+2]=Math.max(0,Math.min(255,Math.round(((c.x-x)/6+.5)*255))),data[p+3]=Math.max(0,Math.min(255,Math.round(((c.z-z)/6+.5)*255)))});const tex=new THREE.DataTexture(data,MW,MH,THREE.RGBAFormat);return tex.magFilter=THREE.NearestFilter,tex.minFilter=THREE.NearestFilter,tex.generateMipmaps=!1,tex.needsUpdate=!0,U.prMask.value=tex,cells.length}const VERT_PARS=`varying vec3 prWPos;
varying vec3 prWNrm;
`,VERT_MAIN=`{
  vec4 prW = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
  prW = instanceMatrix * prW;
  #endif
  prWPos = ( modelMatrix * prW ).xyz;
  prWNrm = normalize( ( vec4( transformedNormal, 0.0 ) * viewMatrix ).xyz );
}
`,FRAG_PARS=`varying vec3 prWPos;
varying vec3 prWNrm;
uniform float prOn;
uniform vec4 prLamp[`+MAX_LAMPS+`];
uniform vec3 prLampCol[`+MAX_LAMPS+`];
uniform int prLampN;
uniform float prCellLamp;
uniform float prIndoorAmb;
uniform float prIndoorSun;
uniform sampler2D prMask;
uniform float prFall;
uniform float prCone;
float prHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float prNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( prHash( i ), prHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( prHash( i + vec2( 0.0, 1.0 ) ), prHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }
float prInWing( vec3 p ) { return step( -15.6, p.x ) * step( p.x, 15.6 ) * step( -43.6, p.z ) * step( p.z, -8.4 ) * step( p.y, 9.6 ); }
`,FRAG_SURFACE=`#if PR_KIND != 3
if ( prOn > 0.5 ) {
  vec3 prN = normalize( prWNrm ); vec3 prA = abs( prN );
  float prUp = step( prA.x, prA.y ) * step( prA.z, prA.y );
  vec2 prUV = prUp > 0.5 ? prWPos.xz : ( prA.x > prA.z ? prWPos.zy : prWPos.xy );
  float prDist = length( prWPos - cameraPosition );
  float prM = prNoise( prUV * 0.55 ) * 0.6 + prNoise( prUV * 2.3 + 7.0 ) * 0.4;
  float prShade = 1.0 + ( prM - 0.5 ) * 0.16;
  float prYy = prInWing( prWPos ) > 0.5 && prWPos.y >= `+(FY-.05).toFixed(2)+" && prWPos.y < 8.0 ? prWPos.y - "+FY.toFixed(2)+` : prWPos.y;
  float prFoot = ( 1.0 - prUp ) * ( 1.0 - smoothstep( 0.0, 0.42, prYy ) );
  prShade *= 1.0 - prFoot * ( 0.16 + 0.10 * prNoise( prUV * vec2( 6.0, 1.5 ) ) );
  #if PR_KIND == 1
  if ( prUp < 0.5 ) {
    float prRow = floor( prUV.y / 0.2 );
    float prX = prUV.x / 0.4 + 0.5 * mod( prRow, 2.0 );
    vec2 prF = vec2( fract( prX ) * 0.4, fract( prUV.y / 0.2 ) * 0.2 );
    float prE = min( min( prF.x, 0.4 - prF.x ), min( prF.y, 0.2 - prF.y ) );
    float prJoint = ( 1.0 - smoothstep( 0.005, 0.013, prE ) ) * ( 1.0 - smoothstep( 7.0, 20.0, prDist ) );
    float prFace = smoothstep( 0.012, 0.05, prE );
    prShade *= ( 1.0 + ( prHash( vec2( floor( prX ), prRow ) ) - 0.5 ) * 0.07 ) * ( 1.0 - prJoint * 0.22 ) * ( 0.97 + 0.03 * prFace );
    if ( prInWing( prWPos ) > 0.5 ) {
      float prDado = 1.0 - step( 1.15, prYy );
      float prStripe = step( 1.15, prYy ) * ( 1.0 - step( 1.21, prYy ) );
      diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.62, 0.70, 0.74 ), prDado );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.20, 0.27, 0.34 ), prStripe * 0.85 );
      float prCove = 1.0 - smoothstep( 0.095, 0.105, prYy );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.16, 0.18, 0.20 ), prCove * 0.9 );
    }
  }
  #endif
  #if PR_KIND == 2
  prShade *= 0.94 + 0.12 * prNoise( prUV * 0.18 ) ;
  #endif
  float prCy = min( abs( prWPos.y - 3.60 ), abs( prWPos.y - 7.50 ) );
  if ( prN.y < -0.5 && prCy < 0.004 && prInWing( prWPos ) > 0.5 ) {
    float prAx = prWPos.z < -38.0 ? prWPos.x : prWPos.z;
    float prPj = abs( fract( prAx / 1.2 + 0.5 ) - 0.5 ) * 1.2;
    prShade *= 1.0 - ( 1.0 - smoothstep( 0.006, 0.016, prPj ) ) * 0.30 * ( 1.0 - smoothstep( 6.0, 14.0, prDist ) );
    prShade *= 0.9 + 0.1 * prNoise( prUV * vec2( 0.6, 4.0 ) );
  }
  diffuseColor.rgb *= prShade;
}
#endif
`,FRAG_LIGHT=`if ( prOn > 0.5 && prInWing( prWPos ) > 0.5 ) {
  vec3 prN2 = normalize( prWNrm );
  #ifdef DOUBLE_SIDED
  prN2 *= gl_FrontFacing ? 1.0 : -1.0;
  #endif
  vec2 prMuv = vec2( ( prWPos.x + 16.0 ) / 32.0, ( prWPos.z + 44.0 ) / 36.0 );
  vec4 prMk = texture2D( prMask, prMuv );
  bool prUpper = prWPos.y > `+(FY-.1).toFixed(2)+`;
  float prVis = prMk.g > 0.5 ? 0.0 : ( prUpper ? 1.0 : prMk.r );
  reflectedLight.indirectDiffuse *= prIndoorAmb * ( prMk.g > 0.5 ? 0.8 : 1.0 );
  reflectedLight.directDiffuse *= prIndoorSun;
  reflectedLight.directSpecular *= prIndoorSun;
  vec3 prSum = vec3( 0.0 );
  for ( int i = 0; i < `+MAX_LAMPS+`; i ++ ) {
    if ( i >= prLampN ) break;
    vec3 prD = prLamp[ i ].xyz - prWPos; float prD2 = dot( prD, prD );
    vec3 prDir = prD * inversesqrt( prD2 );
    float prNl = max( dot( prN2, prDir ), 0.0 ) * 0.8 + 0.2;
    float prThrow = 0.18 + 0.82 * pow( max( prDir.y, 0.0 ), prCone );
    prSum += prLampCol[ i ] * ( prLamp[ i ].w * prNl * prThrow / ( 1.0 + prD2 * prFall ) );
  }
  prSum *= prVis;
  if ( prMk.g > 0.5 ) {
    vec2 prTc = ( floor( vec2( prWPos.x + 16.0, prWPos.z + 44.0 ) / `+MASK_RES.toFixed(2)+" ) + 0.5 ) * "+MASK_RES.toFixed(2)+` - vec2( 16.0, 44.0 );
    vec3 prC = vec3( prTc.x + ( prMk.b - 0.5 ) * 6.0, ( prUpper ? `+FY.toFixed(2)+" : 0.0 ) + "+(CH-.2).toFixed(2)+`, prTc.y + ( prMk.a - 0.5 ) * 6.0 );
    vec3 prD = prC - prWPos; float prD2 = dot( prD, prD );
    float prNl = max( dot( prN2, prD * inversesqrt( prD2 + 1e-4 ) ), 0.0 ) * 0.75 + 0.25;
    prSum += vec3( 1.0, 0.86, 0.66 ) * ( prCellLamp * 1.25 * prNl / ( 1.0 + prD2 * 0.16 ) );
  }
  reflectedLight.directDiffuse += diffuseColor.rgb * prSum;
}
`,KEY="prisonlook-v1";function patch(mat,kind){if(!mat||mat._prKind===kind&&mat.onBeforeCompile===mat._prWrap||!(mat.isMeshLambertMaterial||mat.isMeshStandardMaterial||mat.isMeshPhongMaterial))return!1;const prev=mat.onBeforeCompile&&mat.onBeforeCompile!==mat._prWrap?mat.onBeforeCompile:mat._prPrev||null,prevKey=mat._prPrevKey!=null&&prev===mat._prPrev?mat._prPrevKey:prev?mat.customProgramCacheKey&&mat.customProgramCacheKey!==mat._prKeyFn?mat.customProgramCacheKey():prev.toString():"",wrap=function(sh,renderer){prev&&prev.call(this,sh,renderer);const v=sh.vertexShader,f=sh.fragmentShader;if(!(v.indexOf("#include <common>")<0||v.indexOf("#include <project_vertex>")<0||f.indexOf("#include <common>")<0||f.indexOf("#include <aomap_fragment>")<0||f.indexOf("#include <color_fragment>")<0||v.indexOf("#include <defaultnormal_vertex>")<0)){for(const k in U)sh.uniforms[k]=U[k];sh.vertexShader=v.replace("#include <common>",`#include <common>
`+VERT_PARS).replace("#include <project_vertex>",`#include <project_vertex>
`+VERT_MAIN),sh.fragmentShader=f.replace("#include <common>",`#include <common>
#define PR_KIND `+kind+`
`+FRAG_PARS).replace("#include <color_fragment>",`#include <color_fragment>
`+FRAG_SURFACE).replace("#include <aomap_fragment>",`#include <aomap_fragment>
`+FRAG_LIGHT)}},keyFn=function(){return prevKey+"|"+KEY+"|"+kind};return mat._prPrev=prev,mat._prPrevKey=prevKey,mat._prWrap=wrap,mat._prKeyFn=keyFn,mat._prKind=kind,mat.onBeforeCompile=wrap,mat.customProgramCacheKey=keyFn,mat.needsUpdate=!0,!0}const _hsl={h:0,s:0,l:0};function kindOf(o,m){if(o.userData&&o.userData.prKind!=null)return o.userData.prKind;const g=o.geometry,p=g&&g.parameters;if(p&&p.width!=null&&p.height!=null&&p.depth!=null&&m.color&&!m.vertexColors){const sx=Math.abs(o.scale.x),sy=Math.abs(o.scale.y),sz=Math.abs(o.scale.z),d=[p.width*sx,p.height*sy,p.depth*sz].sort((a,b)=>a-b);if(m.color.getHSL(_hsl),d[0]<=1.05&&d[1]>=1.6&&d[2]>=1.6&&_hsl.s<.22&&_hsl.l>.3)return p.height*sy===d[0]?2:m.map?0:1}return 0}function actorGroups(){const s=new Set;for(const list of[CBZ.npcs,CBZ.guards])for(const a of list||[])a&&a.group&&s.add(a.group);return CBZ.playerChar&&CBZ.playerChar.group&&s.add(CBZ.playerChar.group),s}let swept=0;function sweep(){const root=CBZ.prisonRoot;if(!root)return 0;const actors=actorGroups();let n=0;const visit=(o,actor)=>{if(actors.has(o)&&(actor=!0),o.isMesh&&o.material&&!o.isSkinnedMesh){const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){if(!m||m.transparent||m.isShaderMaterial||m.isMeshBasicMaterial||m._prSkip)continue;const k=actor?3:kindOf(o,m),want=m._prKind!=null&&m._prKind!==0&&k===0?m._prKind:k;patch(m,want)&&n++}}const ch=o.children;for(let i=0;i<ch.length;i++)visit(ch[i],actor)};return visit(root,!1),CBZ.playerChar&&CBZ.playerChar.group&&CBZ.playerChar.group.parent!==root&&visit(CBZ.playerChar.group,!0),swept+=n,n}let lampsBuilt=!1;const hall=[],night=[];function collectLamps(){const cages=CBZ.cellblockCages||[];for(const c of cages)hall.push({x:c.x,y:7.3,z:c.z});for(const s of[[0,-12],[0,-20],[0,-28],[0,-36],[-9.5,-30],[9.5,-30]])night.push({x:s[0],y:8.2,z:s[1]});lampsBuilt=hall.length>0}const HALL_COL=new THREE.Color(1,.9,.74),NIGHT_COL=new THREE.Color(.55,.68,.95),TUNE={hall:2.2,night:.55,amb:.3,ambDay:.16,sun:.14};let level=1,nightLevel=0,glassDay=-1;const GLASS_DAY=new THREE.Color(13952752),GLASS_NIGHT=new THREE.Color(1778738);function drive(dt){const g=CBZ.game,on=!!(g&&g.mode==="escape"&&CBZ.prisonRoot&&CBZ.prisonRoot.visible);if(U.prOn.value=on?1:0,!on)return;lampsBuilt||collectLamps();const lamp=CBZ.ceilingLamp,lit=!lamp||lamp.material.emissive.getHex()!==0,cut=!!(CBZ.breaker&&CBZ.breaker.sabotaged),k=Math.min(1,dt*4);level+=((lit?1:0)-level)*k,nightLevel+=((!lit&&!cut?1:0)-nightLevel)*k;let n=0;for(const h of hall){if(n>=MAX_LAMPS)break;U.prLamp.value[n].set(h.x,h.y,h.z,TUNE.hall*level),U.prLampCol.value[n].copy(HALL_COL),n++}for(const h of night){if(n>=MAX_LAMPS)break;U.prLamp.value[n].set(h.x,h.y,h.z,TUNE.night*nightLevel),U.prLampCol.value[n].copy(NIGHT_COL),n++}U.prLampN.value=n,U.prCellLamp.value=level;const day=CBZ.dayness==null?1:Math.max(0,Math.min(1,CBZ.dayness*2));U.prIndoorAmb.value=TUNE.amb+TUNE.ambDay*day,U.prIndoorSun.value=TUNE.sun;const gl=CBZ.cellWindowGlass;gl&&Math.abs(day-glassDay)>.01&&(glassDay=day,gl.color.copy(GLASS_NIGHT).lerp(GLASS_DAY,day))}let sweepT=0,maskDone=!1;CBZ.onAlways(95.5,function(dt){drive(dt||.016),U.prOn.value&&(!maskDone&&CBZ.cellblock&&CBZ.cellblock.cells&&CBZ.cellblock.cells.length&&(buildMask(),maskDone=!0),sweepT-=dt||.016,sweepT<=0&&(sweepT=1,sweep()))}),CBZ.prisonLook={uniforms:U,tune:TUNE,sweep,patch,audit:function(){return{on:U.prOn.value,lamps:U.prLampN.value,hall:hall.length,patched:swept,mask:!!U.prMask.value,level:+level.toFixed(2),night:+nightLevel.toFixed(2)}}}})();
