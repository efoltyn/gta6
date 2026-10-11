"use strict";const DUNE={on:!1,cx:0,cz:0,R0:420,R1:585,half:600,wa:.42+Math.PI,wx:Math.cos(.42+Math.PI),wz:Math.sin(.42+Math.PI),lam:118,phase:0,skin:null,pal:null,tab:null},ERG_PAL={sand:{form:"dune",surface:"sand",sand:13146722,crest:14464122,trough:10843978,slip:13739114,pan:10323046,amp:1,tint:null,tuft:10127962,tufts:700,rough:.96},snow:{form:"drift",surface:"snow",sand:15002094,crest:16054266,trough:13752801,slip:13095903,pan:14081249,amp:1,tint:[.88,.91,.94],tuft:8748652,tufts:160,rough:.72},grass:{form:"roll",surface:"grass",sand:7112516,crest:8033872,trough:6059578,slip:7112516,pan:9144152,amp:1,tint:[.36,.45,.25],tuft:5994546,tufts:0,rough:.93},forest:{form:"roll",surface:"forest",sand:4601642,crest:5127725,trough:3747105,slip:4601642,pan:4207398,amp:.85,tint:[.2,.27,.15],tuft:5204782,tufts:0,rough:.97}};function hash2(ix,iz,salt){let h=ix*374761393+iz*668265263+salt*2147483647|0;return h=Math.imul(h^h>>>13,1274126177),((h^h>>>16)>>>0)/4294967296}function vn2(x,z,salt){const ix=Math.floor(x),iz=Math.floor(z);let fx=x-ix,fz=z-iz;fx=fx*fx*(3-2*fx),fz=fz*fz*(3-2*fz);const a=hash2(ix,iz,salt),b=hash2(ix+1,iz,salt),c=hash2(ix,iz+1,salt),d=hash2(ix+1,iz+1,salt);return a+(b-a)*fx+(c-a)*fz+(a-b-c+d)*fx*fz}function duneWeight(x,z){const r=Math.max(Math.abs(x-DUNE.cx),Math.abs(z-DUNE.cz));if(r<=DUNE.R0)return 1;if(r>=DUNE.R1)return 0;const t=(r-DUNE.R0)/(DUNE.R1-DUNE.R0);return 1-t*t*(3-2*t)}let _cH=0,_cU=0;function duneCrest(k,v,amp,snow){const loc=vn2(v*.0052+k*3.7,k*.61,41),reg=vn2(k*.18,v*.0017,39);let S=loc*.6+reg*.85-.3;S=S<0?0:S>1?1:S;const Lb=70+60*hash2(k,7,43);let t=v/Lb+hash2(k,3,47);t-=Math.floor(t);const c=Math.pow(Math.sin(Math.PI*t),.7);let iso=1.35-1.7*S;iso=iso<0?0:iso>1?1:iso;const H=(snow?1.2+4*S:2+6*S)*(1-iso+iso*c)*amp,warp=(vn2(v*.008+k*5.1,k*.3,17)-.5)*44+(vn2(v*.03,k*.7+1,29)-.5)*9;_cH=H,_cU=k*DUNE.lam+warp+(1-c)*(6+14*iso)}function duneTable(){const P=DUNE.pal,snow=P.form==="drift",amp=P.amp==null?1:P.amp,key=DUNE.cx+","+DUNE.cz+","+P.form+","+amp+","+DUNE.phase;if(DUNE.tab&&DUNE.tab.key===key)return DUNE.tab;const u0=DUNE.cx*DUNE.wx+DUNE.cz*DUNE.wz-DUNE.phase,v0=-DUNE.cx*DUNE.wz+DUNE.cz*DUNE.wx,R=DUNE.half*1.5,k0=Math.floor((u0-R)/DUNE.lam)-2,nK=Math.ceil(2*R/DUNE.lam)+5,vMin=Math.floor(v0-R),nV=Math.ceil(2*R)+2,H=new Float32Array(nK*nV),U=new Float32Array(nK*nV);for(let a=0;a<nK;a++)for(let b=0;b<nV;b++)duneCrest(k0+a,vMin+b,amp,snow),H[a*nV+b]=_cH,U[a*nV+b]=_cU;return DUNE.tab={key,k0,nK,vMin,nV,H,U,snow,amp}}function crestAt(T,k,v){const a=k-T.k0,fb=v-T.vMin,b=Math.floor(fb);if(a<0||a>=T.nK||b<0||b>=T.nV-1){duneCrest(k,v,T.amp,T.snow);return}const t=fb-b,i=a*T.nV+b;_cH=T.H[i]+(T.H[i+1]-T.H[i])*t,_cU=T.U[i]+(T.U[i+1]-T.U[i])*t}const DS={h:0,lee:0,crest:0,trough:0,frac:0};function duneShape(x,z,amp,snow){const u=x*DUNE.wx+z*DUNE.wz-DUNE.phase,v=-x*DUNE.wz+z*DUNE.wx,k0=Math.floor(u/DUNE.lam),TL=snow?.53:.6249,T=duneTable();let best=0,bH=1,bdu=1e9,blee=0;for(let k=k0-1;k<=k0+1;k++){crestAt(T,k,v);const H=_cH;if(H<.25)continue;const du=u-_cU,Lw=H*4.9;let h=0,lee=0;if(du<=0){if(du<-Lw)continue;const t=1+du/Lw;h=H*t*t*(1.55-.55*t)}else{const rc=snow?3:.35,lin=du<rc?H-du*du*TL/(2*rc):H-TL*(du-rc*.5),a0=H*.1;if(h=lin>a0?lin:a0*Math.exp((lin-a0)/a0),h<.02)continue;lee=lin>a0?1:Math.max(0,lin/a0)}h>best&&(best=h,bH=H,bdu=du,blee=lee)}DS.lee=blee,DS.crest=Math.exp(-Math.abs(bdu)/(bdu>0?2.5:6)),DS.trough=best<.6?1-best/.6:0,DS.frac=best/Math.max(.5,bH);const lump=(vn2(x*.045,z*.045,53)-.5)*.5,swell=snow?(vn2(x*.0034,z*.0034,59)-.5)*2:0;return best-(snow?1.6:2.8)+lump+swell}function rollShape(x,z,amp){DS.lee=0,DS.crest=0,DS.trough=0;const a=(vn2(x/260,z/260,61)-.5)*8,b=(vn2(x/85,z/85,67)-.5)*2.6,c=(vn2(x/30,z/30,71)-.5)*1.1,h=(a+b+c)*amp;return DS.frac=Math.max(0,Math.min(1,.5+h/14)),DS.trough=Math.max(0,Math.min(1,-h/6)),h}function duneDetail(x,z){if(!DUNE.on)return 0;const w=duneWeight(x,z);if(w<=0)return DS.h=0,DS.lee=0,DS.crest=0,DS.trough=0,DS.frac=0,0;const P=DUNE.pal||ERG_PAL.sand,amp=P.amp==null?1:P.amp;let h;return P.form==="roll"?h=rollShape(x,z,amp):h=duneShape(x,z,amp,P.form==="drift"),DS.h=h*w,DS.h}function duneCrests(cx,cz,hx,hz,step){const out=[];if(!DUNE.pal||DUNE.pal.form==="roll")return out;const P=DUNE.pal,snow=P.form==="drift",u0=cx*DUNE.wx+cz*DUNE.wz-DUNE.phase,v0=-cx*DUNE.wz+cz*DUNE.wx,R=Math.max(hx,hz);for(let k=Math.floor((u0-R)/DUNE.lam)-1;k<=Math.floor((u0+R)/DUNE.lam)+1;k++)for(let v=v0-R;v<=v0+R;v+=step){if(duneCrest(k,v,P.amp==null?1:P.amp,snow),_cH<(snow?1.6:2.5))continue;const cu=_cU+DUNE.phase,x=cu*DUNE.wx-v*DUNE.wz,z=cu*DUNE.wz+v*DUNE.wx;Math.abs(x-cx)>hx||Math.abs(z-cz)>hz||out.push({x,z,y:MAP_GROUND(x,z),h:_cH})}return out}const PARCEL={ang:.21,w:104,d:78,n:16,types:null,tex:null},CROP={pasture:0,wheat:1,maize:2,plough:3,stubble:4};function parcelTypes(){if(PARCEL.types)return PARCEL.types;const t=new Uint8Array(PARCEL.n*PARCEL.n),W=[.3,.22,.16,.16,.16];for(let j=0;j<PARCEL.n;j++)for(let i=0;i<PARCEL.n;i++){let r=hash2(i,j,211),k=0;for(;k<W.length-1&&r>W[k];)r-=W[k],k++;t[j*PARCEL.n+i]=k}return PARCEL.types=t,t}function parcelAt(x,z){const rx=x-DUNE.cx,rz=z-DUNE.cz,c=Math.cos(PARCEL.ang),s=Math.sin(PARCEL.ang),a=rx*c+rz*s,b=-rx*s+rz*c,i=Math.floor(a/PARCEL.w),j=Math.floor(b/PARCEL.d),T=parcelTypes(),n=PARCEL.n,ii=Math.max(0,Math.min(n-1,i+n/2)),jj=Math.max(0,Math.min(n-1,j+n/2));return{i,j,u:a-i*PARCEL.w,v:b-j*PARCEL.d,type:T[jj*n+ii],rows:hash2(i,j,223)<.5?0:1}}const ERG_GLSL=["float egH(vec2 p) { p = mod(p, 289.0); vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }","float egN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);","  return mix(mix(egH(i), egH(i + vec2(1.0, 0.0)), f.x), mix(egH(i + vec2(0.0, 1.0)), egH(i + vec2(1.0, 1.0)), f.x), f.y); }"].join(`
`);function ergSurfaceGLSL(form,surface){const head=`{ float dist = length(vEW - cameraPosition);
  vec2 rel = vEW.xz - uC;
  vec2 q = vec2(dot(rel, uW), dot(rel, vec2(-uW.y, uW.x)));
  float lee = vED.x, crest = vED.y, trough = vED.z, frac = vED.w;
  vec3 wN = vec3(0.0);
  diffuseColor.rgb *= 0.95 + 0.1 * egN(rel * 0.013) + 0.04 * (egN(rel * 0.07 + 7.0) - 0.5);
`,tail=`  normal = normalize(normal + (viewMatrix * vec4(wN, 0.0)).xyz);
  diffuseColor.rgb *= 1.0 - smoothstep(160.0, 800.0, dist) * 0.04; }
`;return form==="dune"?head+`  float kR = (1.0 - smoothstep(16.0, 70.0, dist)) * (1.0 - smoothstep(0.12, 0.5, lee)) * (1.0 - crest * 0.6);
  float kC = (1.0 - smoothstep(30.0, 120.0, dist)) * (1.0 - smoothstep(0.12, 0.5, lee));
  if (kC > 0.0) {
    float warp = 0.55 * sin(q.y * 0.83 + egN(q * vec2(0.05, 0.3)) * 4.0) + 0.45 * egN(q * vec2(0.11, 0.9));
    float lam = 0.72 + 0.4 * trough;
    float ph = (q.x + warp) / lam * 6.2832;
    float rip = sin(ph) + 0.28 * sin(2.0 * ph);
    float dr = (cos(ph) + 0.56 * cos(2.0 * ph)) * 6.2832 / lam;
    wN -= vec3(uW.x, 0.0, uW.y) * dr * 0.016 * kR;
    diffuseColor.rgb *= 1.0 - 0.07 * kC * smoothstep(0.2, 1.1, -rip);
  }
  float bands = sin(frac * 26.0 + egN(q * vec2(0.02, 0.006)) * 7.0);
  diffuseColor.rgb *= 1.0 + 0.035 * bands * (1.0 - lee) * (1.0 - trough);
  float gf = egN(vec2(q.y * 1.7, q.x * 0.12));
  diffuseColor.rgb *= 1.0 + 0.07 * (gf - 0.5) * lee;
  wN += vec3(-uW.y, 0.0, uW.x) * (egN(vec2(q.y * 1.7 + 0.15, q.x * 0.12)) - gf) * 0.9 * lee * (1.0 - smoothstep(20.0, 80.0, dist));
  float gr = egH(floor(vEW.xz * 22.0));
  diffuseColor.rgb *= 1.0 + (gr - 0.5) * 0.06 * (1.0 - smoothstep(4.0, 14.0, dist));
`+tail:form==="drift"?head+`  float kS = 1.0 - smoothstep(30.0, 140.0, dist);
  if (kS > 0.0) {
    vec2 s = vec2(q.x * 0.32, q.y * 2.1);
    float field = smoothstep(0.35, 0.7, egN(q * 0.025));
    float r0 = 1.0 - abs(2.0 * egN(s) - 1.0);
    float rx = 1.0 - abs(2.0 * egN(s + vec2(0.06, 0.0)) - 1.0);
    float ry = 1.0 - abs(2.0 * egN(s + vec2(0.0, 0.18)) - 1.0);
    r0 = r0 * r0 * r0; rx = rx * rx * rx; ry = ry * ry * ry;
    float a = 0.11 * kS * field * (1.0 - lee);
    wN -= (vec3(uW.x, 0.0, uW.y) * (rx - r0) / 0.06 * 0.32 + vec3(-uW.y, 0.0, uW.x) * (ry - r0) / 0.18 * 2.1) * a * 0.18;
    diffuseColor.rgb *= 1.0 - 0.05 * r0 * field * kS;
  }
  float crust = smoothstep(0.58, 0.78, egN(rel * 0.031 + 3.0));
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.95, 0.965, 0.99), crust);
  specularStrength *= 1.0 + 2.5 * crust;
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.9, 0.95, 1.05), lee * 0.7 + trough * 0.3);
  float gl = egH(floor(vEW.xz * 20.0) + floor(normalize(vEW - cameraPosition).xz * 6.0) * 31.0);
  vSpark = step(0.9965, gl) * (1.0 - smoothstep(6.0, 40.0, dist));
`+tail:surface==="forest"?head+`  float kL = 1.0 - smoothstep(10.0, 45.0, dist);
  float moss = smoothstep(0.58, 0.78, egN(rel * 0.09 + 11.0) * 0.7 + trough * 0.5);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.26, 0.11), moss * 0.7);
  float damp = egN(rel * 0.21 + 4.0);
  diffuseColor.rgb *= 0.86 + 0.24 * damp;
  vec2 lc = floor(vEW.xz * 5.0); float lh = egH(lc);
  vec3 leaf = lh < 0.33 ? vec3(0.55, 0.32, 0.12) : (lh < 0.66 ? vec3(0.62, 0.48, 0.2) : vec3(0.38, 0.24, 0.13));
  float lf = step(0.55, egH(lc + 17.0)) * (1.0 - moss) * kL;
  vec2 lp = fract(vEW.xz * 5.0) - 0.5; lf *= 1.0 - smoothstep(0.16, 0.3, length(lp * vec2(1.0, 1.7)));
  diffuseColor.rgb = mix(diffuseColor.rgb, leaf, lf * 0.75);
  vec2 tc = floor(vEW.xz / 1.4); vec2 tp = fract(vEW.xz / 1.4) - 0.5; float ta = egH(tc + 5.0) * 3.14;
  vec2 td = vec2(cos(ta), sin(ta)); float along = dot(tp, td), off = abs(dot(tp, vec2(-td.y, td.x)));
  float twig = step(0.45, egH(tc)) * (1.0 - smoothstep(0.006, 0.014, off)) * step(abs(along), 0.32) * kL;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.12, 0.08), twig * 0.8);
  wN += vec3(egN(vEW.xz * 3.1) - 0.5, 0.0, egN(vEW.xz * 3.1 + 9.0) - 0.5) * 0.25 * kL;
  vec2 cuv = (rel - uCanopyR.xy) / uCanopyR.zw;
  float cov = (cuv.x > 0.0 && cuv.x < 1.0 && cuv.y > 0.0 && cuv.y < 1.0) ? texture2D(uCanopy, cuv).r : 0.0;
  float fleck = smoothstep(0.58, 0.82, egN(vEW.xz * 0.55 + 3.0) * 0.6 + egN(vEW.xz * 1.9) * 0.4);
  vShade = mix(1.0, min(1.0, 0.34 + 0.72 * fleck), cov);
`+tail:head+`  float pc = cos(uParcel.x), ps = sin(uParcel.x);
  vec2 pa = vec2(rel.x * pc + rel.y * ps, -rel.x * ps + rel.y * pc);
  vec2 cell = floor(pa / uParcel.yz);
  vec2 loc = pa - cell * uParcel.yz;
  vec4 pt = texture2D(uParcelT, (clamp(cell + 8.0, 0.0, 15.0) + 0.5) / 16.0);
  float ty = floor(pt.r * 255.0 + 0.5); float rowAx = pt.g > 0.5 ? 1.0 : 0.0;
  float edge = min(min(loc.x, uParcel.y - loc.x), min(loc.y, uParcel.z - loc.y));
  float rc = mix(loc.x, loc.y, rowAx);
  float kF = 1.0 - smoothstep(40.0, 200.0, dist);
  vec3 turf = vec3(1.0);
  TURF_CALL
  vec3 col = diffuseColor.rgb * turf;
  if (ty > 0.5 && edge > 2.5) {
    float row = 0.5 + 0.5 * cos(rc / 0.76 * 6.2832);
    if (ty < 1.5) { col = vec3(0.6, 0.5, 0.27) * (0.9 + 0.12 * egN(rel * 0.05)) * (1.0 - 0.08 * row * kF); }
    else if (ty < 2.5) { col = mix(vec3(0.3, 0.24, 0.17), vec3(0.32, 0.4, 0.17), row * 0.6) * (0.92 + 0.12 * egN(rel * 0.04)); }
    else if (ty < 3.5) { col = vec3(0.34, 0.26, 0.18) * (0.88 + 0.16 * egN(rel * 0.03)) * (0.86 + 0.2 * row);
      float d = -sin(rc / 0.76 * 6.2832) * 6.2832 / 0.76; vec2 ax = rowAx > 0.5 ? vec2(-ps, pc) : vec2(pc, ps);
      wN -= vec3(ax.x, 0.0, ax.y) * d * 0.035 * kF; }
    else { col = vec3(0.66, 0.6, 0.38) * (0.92 + 0.1 * egN(rel * 0.06)) * (1.0 - 0.1 * step(0.8, fract(rc / 4.5)) * kF); }
  }
  float trk = 1.0 - smoothstep(1.4, 2.2, abs(loc.y - 1.0));
  trk *= step(0.5, mod(cell.y, 3.0)) < 0.5 ? 1.0 : 0.0;
  col = mix(col, vec3(0.42, 0.36, 0.27) * (0.9 + 0.15 * egN(vEW.xz * 0.8)), trk * 0.85);
  diffuseColor.rgb = col;
`+tail}let ERG_CANOPY=null;function ergMaterial(P){const mat=new THREE.MeshPhongMaterial({vertexColors:!0,specular:P.surface==="snow"?1842978:526344,shininess:P.surface==="snow"?18:6}),form=P.form,surface=P.surface;if(!ERG_CANOPY){const d=new Uint8Array(4);d[0]=0,ERG_CANOPY={tex:new THREE.DataTexture(d,1,1,THREE.RGBAFormat),rect:new THREE.Vector4(0,0,1,1)},ERG_CANOPY.tex.needsUpdate=!0}let parcelTex=null;if(surface==="grass"){const T=parcelTypes(),n=PARCEL.n,d=new Uint8Array(n*n*4);for(let j=0;j<n;j++)for(let i=0;i<n;i++){const k=(j*n+i)*4;d[k]=T[j*n+i],d[k+1]=hash2(i-n/2,j-n/2,223)<.5?0:255,d[k+3]=255}parcelTex=new THREE.DataTexture(d,n,n,THREE.RGBAFormat),parcelTex.magFilter=THREE.NearestFilter,parcelTex.minFilter=THREE.NearestFilter,parcelTex.needsUpdate=!0,PARCEL.tex=parcelTex}const turfOn=surface==="grass"&&!!CBZ.GROUND_TURF_GLSL;return mat.onBeforeCompile=function(sh){sh.uniforms.uC={value:new THREE.Vector2(DUNE.cx,DUNE.cz)},sh.uniforms.uW={value:new THREE.Vector2(DUNE.wx,DUNE.wz)},sh.uniforms.uCanopy={value:ERG_CANOPY.tex},sh.uniforms.uCanopyR={value:ERG_CANOPY.rect},sh.uniforms.uParcel={value:new THREE.Vector3(PARCEL.ang,PARCEL.w,PARCEL.d)},sh.uniforms.uParcelT={value:parcelTex||ERG_CANOPY.tex},sh.vertexShader=`attribute vec4 aD;
varying vec4 vED;
varying vec3 vEW;
`+sh.vertexShader.replace("#include <project_vertex>",`#include <project_vertex>
vED = aD; vEW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);let surf=ergSurfaceGLSL(form,surface).replace("TURF_CALL",turfOn?"turf = groundTurf(vEW.xz, dist, 0.35);":"turf = vec3(0.92 + 0.16 * egN(rel * 0.043) + 0.08 * (egN(vEW.xz * 0.6) - 0.5) * kF);");sh.fragmentShader=`varying vec4 vED;
varying vec3 vEW;
uniform vec2 uC;
uniform vec2 uW;
uniform sampler2D uCanopy;
uniform vec4 uCanopyR;
uniform vec3 uParcel;
uniform sampler2D uParcelT;
`+ERG_GLSL+`
`+(turfOn?CBZ.GROUND_TURF_GLSL+`
`:"")+sh.fragmentShader.replace("void main() {",`void main() {
  float vSpark = 0.0; float vShade = 1.0;`).replace("#include <normal_fragment_maps>",`#include <normal_fragment_maps>
`+surf).replace("#include <aomap_fragment>",`#include <aomap_fragment>
reflectedLight.directDiffuse *= vShade; reflectedLight.indirectDiffuse *= mix(1.0, vShade, 0.7);`).replace("#include <tonemapping_fragment>",`gl_FragColor.rgb += vSpark * vec3(0.9, 0.95, 1.0);
#include <tonemapping_fragment>`)},mat.customProgramCacheKey=function(){return"npcwar-erg2-"+form+"-"+surface+(turfOn?"t":"")},CBZ.battleGround&&CBZ.battleGround.patchTerrain(mat),mat}function ergSkin(world){const P=DUNE.pal||ERG_PAL.sand,S=DUNE.half*2,roll=P.form==="roll",NU=roll?300:600,NV=300,du=S/NU,dv=S/NV,n=(NU+1)*(NV+1),pos=new Float32Array(n*3),col=new Float32Array(n*3),aD=new Float32Array(n*4),sand=new THREE.Color(P.sand),crest=new THREE.Color(P.crest),trough=new THREE.Color(P.trough),slip=new THREE.Color(P.slip),pan=new THREE.Color(P.pan),tmp=new THREE.Color,W=[DUNE.wx,DUNE.wz],Q=[-DUNE.wz,DUNE.wx];for(let j=0;j<=NV;j++){const v=-DUNE.half+j*dv;for(let i=0;i<=NU;i++){const u=-DUNE.half+i*du,lx=u*W[0]+v*Q[0],lz=u*W[1]+v*Q[1],x=lx+DUNE.cx,z=lz+DUNE.cz,y=MAP_GROUND(x,z),k=j*(NU+1)+i;pos[k*3]=lx,pos[k*3+1]=y,pos[k*3+2]=lz;const w=duneWeight(x,z),lee=DS.lee*w,cr=DS.crest*w,tr=DS.trough*w;if(tmp.copy(sand),roll)tmp.lerp(DS.h>0?crest:trough,Math.min(1,Math.abs(DS.h)/6)*.5);else{tmp.lerp(crest,cr*.55),tmp.lerp(slip,lee*.45),tmp.lerp(trough,tr*.6);const flat=vn2(x*.012,z*.012,61);flat>.6&&tmp.lerp(pan,Math.min(1,(flat-.6)*4)*tr*.7)}tmp.multiplyScalar(.96+vn2(x*.21,z*.21,71)*.06),w<1&&tmp.lerp(sand,1-w),col[k*3]=tmp.r,col[k*3+1]=tmp.g,col[k*3+2]=tmp.b,aD[k*4]=lee,aD[k*4+1]=cr,aD[k*4+2]=tr,aD[k*4+3]=DS.frac}}const idx=new Uint32Array(NU*NV*6);let o=0;for(let j=0;j<NV;j++)for(let i=0;i<NU;i++){const a=j*(NU+1)+i,b=a+1,c=a+NU+1,d=c+1;idx[o++]=a,idx[o++]=c,idx[o++]=b,idx[o++]=b,idx[o++]=c,idx[o++]=d}const g=new THREE.BufferGeometry;if(g.setAttribute("position",new THREE.BufferAttribute(pos,3)),g.setAttribute("color",new THREE.BufferAttribute(col,3)),g.setAttribute("aD",new THREE.BufferAttribute(aD,4)),g.setIndex(new THREE.BufferAttribute(idx,1)),g.computeVertexNormals(),g.attributes.normal.getY(0)<0){for(let t=0;t<idx.length;t+=3){const s=idx[t+1];idx[t+1]=idx[t+2],idx[t+2]=s}g.computeVertexNormals()}g.computeBoundingSphere();const m=new THREE.Mesh(g,ergMaterial(P));m.position.set(DUNE.cx,0,DUNE.cz),m.receiveShadow=!0,m.castShadow=!0,m.userData.terrain=!0,m.userData.dynamic=!0,m.name="duneSkin",CBZ.scene.add(m),DUNE.skin=m;const T=world&&world.terrain;if(T&&T.material&&(T.userData.dynamic=!0,T.material.onBeforeCompile=function(sh){sh.uniforms.uHole={value:new THREE.Vector3(DUNE.cx,DUNE.cz,DUNE.half-4)},sh.uniforms.uHoleW={value:new THREE.Vector2(DUNE.wx,DUNE.wz)},sh.vertexShader=`varying vec3 vHoleW;
`+sh.vertexShader.replace("#include <project_vertex>",`#include <project_vertex>
vHoleW = (modelMatrix * vec4(transformed, 1.0)).xyz;`),sh.fragmentShader=`varying vec3 vHoleW;
uniform vec3 uHole;
uniform vec2 uHoleW;
`+sh.fragmentShader.replace("void main() {",`void main() {
 { vec2 d = vHoleW.xz - uHole.xy; vec2 q = vec2(dot(d, uHoleW), dot(d, vec2(-uHoleW.y, uHoleW.x)));
   if (abs(q.x) < uHole.z && abs(q.y) < uHole.z) discard; }`).replace("#include <color_fragment>",`#include <color_fragment>
diffuseColor.rgb *= mix(vec3(0.9, 0.78, 0.65), vec3(1.0), smoothstep(2650.0, 2900.0, length(vHoleW.xz)));`+(P.tint?`
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(`+P.tint.map(function(v){return v.toFixed(3)}).join(",")+"), 0.82 * (1.0 - smoothstep(2650.0, 2900.0, length(vHoleW.xz))));":""))},T.material.needsUpdate=!0),world&&world.root){const drop=[];world.root.children.forEach(function(o2){if(!(o2.name==="terrain"||o2.name==="sea")){if(o2.isInstancedMesh&&o2.count>0){const mm=new THREE.Matrix4,pp=new THREE.Vector3;if(o2.getMatrixAt(0,mm),pp.setFromMatrixPosition(mm),Math.hypot(pp.x,pp.z)>1100)return}drop.push(o2)}}),drop.forEach(function(o2){world.root.remove(o2)})}reseatDesertDress(world)}function duneSkin(world){return ergSkin(world)}function weldGeo(g){const p=g.attributes.position,seen=new Map,idx=[],pos=[];for(let i=0;i<p.count;i++){const k=Math.round(p.getX(i)*1e4)+","+Math.round(p.getY(i)*1e4)+","+Math.round(p.getZ(i)*1e4);let j=seen.get(k);j===void 0&&(j=pos.length/3,pos.push(p.getX(i),p.getY(i),p.getZ(i)),seen.set(k,j)),idx.push(j)}const out=new THREE.BufferGeometry;return out.setAttribute("position",new THREE.Float32BufferAttribute(pos,3)),out.setIndex(idx),out}function lumpRock(detail,salt,flat,paint){const g=weldGeo(new THREE.IcosahedronGeometry(1,detail)),p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);let k=.74+vn2(x*1.9+salt,z*1.9+y*1.6,83)*.38+vn2(x*4.7+y,y*4.7+z+salt,89)*.13+vn2(x*11+salt,z*11+y*7,97)*.045;k*=1+.035*Math.sin(y*10+vn2(x*2+salt,z*2,7)*3),p.setXYZ(i,x*k,y*k*(y>0?flat:1),z*k)}g.computeVertexNormals();const n=g.attributes.normal,col=new Float32Array(p.count*3);for(let i=0;i<p.count;i++){const c=paint(p.getX(i),p.getY(i),p.getZ(i),n.getY(i));col[i*3]=c[0],col[i*3+1]=c[1],col[i*3+2]=c[2]}return g.setAttribute("color",new THREE.BufferAttribute(col,3)),g}function rockGeometry(){return lumpRock(2,0,.72,function(x,y,z,ny){const band=Math.sin(y*7.5+vn2(x*1.3,z*1.3,5)*2.4);let r=.6+band*.045,g=.47+band*.03,b=.36+band*.02;band>.55&&(r+=.05,g-=.01);const v=.9+vn2(x*6,z*6+y*3,13)*.2;if(r*=v,g*=v,b*=v,ny>.55){const k=(ny-.55)*.5;r-=r*k,g-=g*k,b-=b*k*.8}const dust=Math.max(0,Math.min(1,(-y-.05)*2.2));return r+=(.77-r)*dust,g+=(.58-g)*dust,b+=(.36-b)*dust,[r,g,b]})}function tuftGeometry(){const parts=[];for(let b=0;b<9;b++){const c=new THREE.ConeGeometry(.035,.55+hash2(b,1,7)*.5,3,1);c.translate(0,(.55+hash2(b,1,7)*.5)/2,0);const a=b*2.39996,lean=.25+hash2(b,2,7)*.5;c.rotateX(Math.cos(a)*lean),c.rotateZ(Math.sin(a)*lean),c.translate(Math.cos(a)*.08,0,Math.sin(a)*.08),parts.push(c)}const flat=parts.map(function(c){return c.index?c.toNonIndexed():c});let total=0;flat.forEach(function(c){total+=c.attributes.position.count});const pos=new Float32Array(total*3),nor=new Float32Array(total*3);let o=0;flat.forEach(function(ci){pos.set(ci.attributes.position.array,o*3),nor.set(ci.attributes.normal.array,o*3),o+=ci.attributes.position.count});const out=new THREE.BufferGeometry;return out.setAttribute("position",new THREE.BufferAttribute(pos.slice(0,o*3),3)),out.setAttribute("normal",new THREE.BufferAttribute(nor.slice(0,o*3),3)),out}function reseatDesertDress(world){if(!world||!world.root)return;const mtx=new THREE.Matrix4,p=new THREE.Vector3,q=new THREE.Quaternion,s=new THREE.Vector3,zero=new THREE.Matrix4().makeScale(0,0,0),PAL=DUNE.pal||ERG_PAL.sand;world.root.traverse(function(o){if(!o.isInstancedMesh)return;const geoT=o.geometry&&o.geometry.type,isRock=geoT==="DodecahedronGeometry"||geoT==="DodecahedronBufferGeometry",isScrub=geoT==="ConeGeometry"||geoT==="ConeBufferGeometry";if(!(!isRock&&!isScrub)){isRock&&(o.geometry=PAL.surface==="sand"?rockGeometry():CBZ.battleDress.geo.boulder(0,!0),o.material=new THREE.MeshLambertMaterial({vertexColors:!0}),o.receiveShadow=!0);for(let i=0;i<o.count;i++){o.getMatrixAt(i,mtx),mtx.decompose(p,q,s);const w=duneWeight(p.x,p.z);if(isScrub){w>0&&o.setMatrixAt(i,zero);continue}if(Math.abs(p.x-DUNE.cx)<DUNE.R0&&Math.abs(p.z-DUNE.cz)<DUNE.R0&&PAL.surface!=="sand"){o.setMatrixAt(i,zero);continue}p.y=MAP_GROUND(p.x,p.z)+s.y*.12,mtx.compose(p,q,s),o.setMatrixAt(i,mtx)}o.instanceMatrix.needsUpdate=!0}});const N=PAL.tufts||0;if(!N)return;const tuft=new THREE.InstancedMesh(tuftGeometry(),new THREE.MeshLambertMaterial({color:PAL.tuft}),N);let k=0;for(let i=0;i<N*3&&k<N;i++){const x=DUNE.cx+(hash2(i,3,101)-.5)*(DUNE.R0*1.8),z=DUNE.cz+(hash2(i,4,101)-.5)*(DUNE.R0*1.8);if(duneDetail(x,z),DS.lee>.2||DS.crest>.5||vn2(x*.02,z*.02,131)<.42)continue;const sc=.7+hash2(i,5,101)*1.1;q.setFromAxisAngle(new THREE.Vector3(0,1,0),hash2(i,6,101)*6.28),mtx.compose(p.set(x,MAP_GROUND(x,z)-.05,z),q,s.set(sc,sc*(.8+hash2(i,7,101)*.5),sc)),tuft.setMatrixAt(k++,mtx)}tuft.count=k,tuft.instanceMatrix.needsUpdate=!0,tuft.castShadow=!0,tuft.frustumCulled=!1,tuft.userData.dynamic=!0,CBZ.scene.add(tuft)}let MAP_GROUND=function(){return 0};
