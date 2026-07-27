// ============================================================================
// arena_fights.js — IRONJAW ARENA: a real, walk-in fight complex.
//
// WHY THIS EXISTS: fighting used to live only in a hidden betting menu — a
// feature you couldn't SEE. This puts it physically on the map, mirroring how
// the speedway island works: a landmass you can drive/boat/walk to, with
// on-map interaction prompts. It has a boxing ring with a LIVE, self-running
// NPC bout (the showcase for the improved fight poses: kicks, blocks, dodges,
// staggers, KO crumples), an MMA cage the player can step into, a beast pit
// that stages creature-vs-creature bouts via CBZ.creatureFight, and a bounded
// cast of live grandstand spectators watching it all.
//
// THE BUILDING lives in city/arena_venue.js (raked bowl, concourse, roof,
// light rig, jumbotron, instanced crowd). THIS file owns the FIGHT SURFACES
// (ring / cage / pit), the island + causeway they sit on, the fight simulation
// and the interaction zones.
//
// THE ONE RULE THAT USED TO BE BROKEN — GEOMETRY AND BOUNDS ARE NOW ONE THING.
// Fighters are not constrained by the mesh; they're constrained by clamp
// functions. Those clamps used to be hand-typed magic numbers (3.2 / 5.2 / 7.4)
// with no link to the ropes/cage/wall they were meant to sit inside, so any
// resize silently desynced them. EVERY bound below — combat clamp, spawn
// radius, interaction-prompt radius, simulation-gating radius — is now DERIVED
// from the named geometry constants in the GEOMETRY LAW block. Change the ring
// half-span and everything follows; there is nothing left to hand-sync.
//
// PERF NOTES:
//  - Static geometry is draw-call disciplined: everything is batched into a
//    handful of per-material InstancedMeshes via instBoxes(); the cage fence is
//    ONE merged alpha-tested quad batch; the bowl/crowd are arena_venue's.
//  - ALL simulation is distance gated (see RING_SIM / PIT_SIM, both derived
//    from the venue footprint so a spectator in the back row never watches a
//    frozen bout). When you're across the map the whole file costs a couple of
//    Math.hypot calls per frame.
//  - Deterministic placement uses CBZ.hash01 / a local LCG so the venue is
//    identical every load; per-frame liveliness (fight AI) uses Math.random.
// ============================================================================
(function(){
"use strict";
var CBZ=window.CBZ, THREE=window.THREE;
if(!CBZ||!THREE)return;
var g=CBZ.game;
var mat=CBZ.cmat||CBZ.mat;
if(!mat||typeof CBZ.addLandmass!=="function"||typeof CBZ.onUpdate!=="function")return;

var CFG=CBZ.CONFIG||(CBZ.CONFIG={});
// ARENA_FIGHTS — the whole Ironjaw complex (island, causeway, ring, cage, pit,
// bouts, betting). The file had NO flag at all, which broke the house rule that
// every risky feature is a one-line revert. ON → the venue exists.
// Flip false (or ?cfg_ARENA_FIGHTS=0) to remove it from the world entirely.
if(CFG.ARENA_FIGHTS==null)CFG.ARENA_FIGHTS=true;
// ARENA_SOLID_PROPS — real colliders/platforms on the ring apron, cage fence,
// pit wall and steps. The venue used to register ZERO colliders: you walked
// through the ropes and the cage. OFF → the pre-fix ghost geometry.
if(CFG.ARENA_SOLID_PROPS==null)CFG.ARENA_SOLID_PROPS=true;
// (arena_venue.js self-defaults ARENA_VENUE_V2 / ARENA_CROWD_PROXY /
//  ARENA_LIGHT_RIG / ARENA_JUMBOTRON — the building half of the same feature.)

// ---------------------------------------------------------------- footprint
// Dedicated island in the open channel between Mercy, Commerce and Coyle.
// The former (820,-560) footprint was 62% inside Coyle Valley, so two land
// surfaces and their buildings occupied the same physical space.
var CX=640, CZ=-950, R=120;
var CW_X0=482, CW_X1=CX-R+7, CW_CX=(CW_X0+CW_X1)/2;
var CW_Y=0.40;                   // causeway deck top (a 0.40 step off the water road)
var PY=1.1;                      // arena floor / plaza deck top height
var RX=CX-32, RZ=CZ, RY=PY+0.9;    // boxing ring centre + canvas height
var CGX=CX+32, CGZ=CZ, CGY=PY+0.5; // MMA cage centre + mat height
var PX=CX, PZ=CZ+54, PITY=PY+0.02; // beast pit centre + sand height

// ============================================================ GEOMETRY LAW
// ONE source of truth per fight surface. Every clamp / spawn / prompt / sim
// radius below is derived from these — see the header note. Do not re-type a
// literal anywhere else in this file.
var RING_HALF   = 4.1;                       // corner-post & rope half-span
var RING_APRON  = RING_HALF + 0.7;           // 4.8 — canvas + apron half-width
var RING_INSET  = 0.9;                       // fighters stay this far inside the ropes
var RING_FIGHT  = RING_HALF - RING_INSET;    // 3.2 — clampRing / startBout radius
var CAGE_POST_R = 6.3;                       // fence-post ring radius
var CAGE_MAT_R  = 6.6;                       // mat disc radius
var CAGE_INSET  = 1.1;                       // fighters stay this far off the fence
var CAGE_FIGHT  = CAGE_POST_R - CAGE_INSET;  // 5.2 — clampCage / startBout radius
var PIT_WALL_R  = 9.2;                       // pit wall ring radius
var PIT_SAND_R  = 8.6;                       // sand floor radius
var PIT_INSET   = 1.8;                       // beasts stay this far off the wall
var PIT_FIGHT   = PIT_WALL_R - PIT_INSET;    // 7.4 — clampPitXZ radius
// Prompt zones: the venue footprint plus a standing-room margin, so the prompt
// still fires from the walkway around each surface.
var RING_ZONE   = RING_APRON + 8.2;          // 13
var CAGE_ZONE   = CAGE_MAT_R + 4.4;          // 11
var PIT_ZONE    = PIT_WALL_R + 4.8;          // 14
// Simulation gating: a bout must keep running while ANY spectator seat can see
// it, so the radius is (offset of the surface from the venue centre) + the
// furthest walkable point of the bowl. Grow the bowl and these grow with it.
var VENUE_REACH = 118;
var RING_SIM    = Math.hypot(RX-CX,RZ-CZ)+VENUE_REACH+8;   // ~158
var PIT_SIM     = Math.hypot(PX-CX,PZ-CZ)+VENUE_REACH+8;   // ~180

var arenaRoot=null, venue=null;
var redCh=null, blueCh=null, refCh=null;

function note(msg,secs,opts){ if(CBZ.city&&typeof CBZ.city.note==="function")CBZ.city.note(msg,secs||3,opts); }
function money(n){ n=Math.round(n); try{ return "$"+n.toLocaleString("en-US"); }catch(e){ return "$"+n; } }
function anim(ch,mv,dt){ if(ch&&typeof CBZ.animChar==="function")CBZ.animChar(ch,mv,dt); }
function face(ch,tx,tz){ var p=ch.group.position; ch.group.rotation.y=Math.atan2(tx-p.x,tz-p.z); }
function moveTo(pos,tx,tz,step){
  var dx=tx-pos.x,dz=tz-pos.z,d=Math.hypot(dx,dz);
  if(d<0.02)return 0;
  var s=Math.min(step,d); pos.x+=dx/d*s; pos.z+=dz/d*s; return s;
}
function board(a,b,c){ if(venue&&venue.board)venue.board(a,b,c); }

// ================================================================ THE VENUE
CBZ.addLandmass(function(city){
  if(!CFG.ARENA_FIGHTS)return null;
  var root=city.root; arenaRoot=root;
  var _s=771; function rng(){_s=(_s*1103515245+12345)&0x7fffffff;return _s/0x7fffffff;}
  var unitBox=new THREE.BoxGeometry(1,1,1);
  var SOLID=!!CFG.ARENA_SOLID_PROPS;

  // Batch a list of {x,y,z,sx,sy,sz,rx,ry,rz} boxes into ONE InstancedMesh.
  function instBoxes(items,material){
    if(!items.length)return null;
    var m=new THREE.InstancedMesh(unitBox,material,items.length);
    m.frustumCulled=false;              // r128 InstancedMesh has no real bounds
    m.castShadow=true; m.receiveShadow=true;
    var M=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler(),
        p=new THREE.Vector3(),s=new THREE.Vector3();
    for(var i=0;i<items.length;i++){
      var it=items[i];
      e.set(it.rx||0,it.ry||0,it.rz||0); q.setFromEuler(e);
      p.set(it.x,it.y,it.z); s.set(it.sx,it.sy,it.sz);
      M.compose(p,q,s); m.setMatrixAt(i,M);
    }
    m.instanceMatrix.needsUpdate=true;
    root.add(m); return m;
  }
  // --- collision helpers (the venue used to register NOTHING) --------------
  function solid(minX,minZ,maxX,maxZ,y0,y1){
    if(!SOLID)return null;
    var c={minX:Math.min(minX,maxX),maxX:Math.max(minX,maxX),
           minZ:Math.min(minZ,maxZ),maxZ:Math.max(minZ,maxZ)};
    if(y0!=null){c.y0=y0;c.y1=y1;}
    (CBZ.colliders=CBZ.colliders||[]).push(c); return c;
  }
  // AABB of an oriented (yaw-rotated) box, for the octagon/circle wall rings
  function solidYaw(cx2,cz2,w,d,yaw,y0,y1){
    var c=Math.abs(Math.cos(yaw)),s=Math.abs(Math.sin(yaw));
    var ax=(w/2)*c+(d/2)*s, az=(w/2)*s+(d/2)*c;
    return solid(cx2-ax,cz2-az,cx2+ax,cz2+az,y0,y1);
  }
  function plat(minX,minZ,maxX,maxZ,top,ramp){
    if(!SOLID)return null;
    var p={minX:Math.min(minX,maxX),maxX:Math.max(minX,maxX),
           minZ:Math.min(minZ,maxZ),maxZ:Math.max(minZ,maxZ),top:top};
    if(ramp)p.ramp=ramp;
    (CBZ.platforms=CBZ.platforms||[]).push(p); return p;
  }
  var ctex=(CBZ.arenaVenue&&CBZ.arenaVenue.canvasTex)||null;

  // ---- island + causeway apron (reachable from the west, x~700)
  var island=new THREE.Mesh(new THREE.CylinderGeometry(R,R+7,6,28),mat(0x6a6e64));
  island.position.set(CX,-2.8,CZ);
  island.userData.arenaIsland=true;      // non-empty userData -> batch.js spares it
  root.add(island);

  var concrete=[],gold=[],white=[],redP=[],blueP=[],dark=[],rail=[],steel=[],sandBits=[];
  concrete.push({x:CW_CX,y:CW_Y-0.6,z:CZ,sx:CW_X1-CW_X0,sy:1.2,sz:16});             // causeway deck
  concrete.push({x:CW_CX,y:CW_Y+0.35,z:CZ-7.6,sx:CW_X1-CW_X0,sy:0.7,sz:0.5});       // rails
  concrete.push({x:CW_CX,y:CW_Y+0.35,z:CZ+7.6,sx:CW_X1-CW_X0,sy:0.7,sz:0.5});
  plat(CW_X0,CZ-7.4,CW_X1-6,CZ+7.4,CW_Y);                                           // walk the causeway
  solid(CW_X0,CZ-8.1,CW_X1,CZ-7.1,CW_Y,CW_Y+0.7);
  solid(CW_X0,CZ+7.1,CW_X1,CZ+8.1,CW_Y,CW_Y+0.7);
  // approach ramp: causeway deck (CW_Y) up onto the arena apron (PY)
  concrete.push({x:CW_X1+3,y:(CW_Y+PY)/2-0.5,z:CZ,sx:14,sy:1.1,sz:15,rz:0.05});
  plat(CW_X1-6,CZ-7.4,CW_X1+8,CZ+7.4,PY,{axis:"x",x0:CW_X1-6,x1:CW_X1+8,y0:CW_Y,y1:PY});

  // ---- THE BUILDING (raked bowl, concourse, roof, lights, crowd) ----------
  if(CBZ.arenaVenue&&typeof CBZ.arenaVenue.build==="function"){
    venue=CBZ.arenaVenue.build({
      root:root, cx:CX, cz:CZ, py:PY,
      focus:{x:CX,z:CZ}, liveSeats:42,
      spotTargets:[
        {x:RX,z:RZ,y:RY,angle:0.42,intensity:2.1},
        {x:CGX,z:CGZ,y:CGY,angle:0.46,intensity:2.0},
        {x:CX,z:CZ,y:PY,angle:0.62,intensity:1.1},
        {x:PX,z:PZ,y:PITY,angle:0.5,intensity:1.5}
      ],
      floorSeatRings:[            // ringside chairs, clear of the ring stair /
        {x:RX,z:RZ,r0:8.2,rings:2},      // cage ramp footprints
        {x:CGX,z:CGZ,r0:10.2,rings:2}
      ]
    });
  }
  if(!venue){
    // fallback when the building is flagged off: the original octagon plaza
    var plaza=new THREE.Mesh(new THREE.CylinderGeometry(70,74,0.9,8),mat(0x84888f));
    plaza.rotation.y=Math.PI/8; plaza.position.set(CX,PY-0.45,CZ);
    plaza.userData.arenaPlaza=true; root.add(plaza);
    plat(CX-70,CZ-70,CX+70,CZ+70,PY);
  }

  // ======================================================== BOXING RING ====
  // Apron deck + skirt + branded canvas + 4 posts with turnbuckles + 3 sagging
  // rope rows + corner pads + stools + a walk-up stair that is a REAL ramp.
  (function(){
    var deckTop=RY, deckBase=PY;
    concrete.push({x:RX,y:(deckBase+deckTop)/2,z:RZ,sx:RING_APRON*2,sy:deckTop-deckBase,sz:RING_APRON*2});
    dark.push({x:RX,y:deckBase+0.28,z:RZ,sx:RING_APRON*2+0.24,sy:0.56,sz:RING_APRON*2+0.24}); // skirt band
    // canvas: a branded mat, one textured mesh (batch.js skips textured mats)
    var canvasMat=null;
    if(ctex){
      var ct=ctex(512,512,function(c,w,h){
        c.fillStyle="#d8d4c4"; c.fillRect(0,0,w,h);
        c.strokeStyle="rgba(20,24,32,.35)"; c.lineWidth=8; c.strokeRect(16,16,w-32,h-32);
        c.strokeStyle="rgba(160,32,44,.5)"; c.lineWidth=4; c.strokeRect(40,40,w-80,h-80);
        c.save(); c.translate(w/2,h/2);
        c.fillStyle="rgba(28,34,48,.55)"; c.font="bold 84px Arial";
        c.textAlign="center"; c.textBaseline="middle";
        c.fillText("IRONJAW",0,-24);
        c.fillStyle="rgba(200,145,42,.6)"; c.font="bold 40px Arial";
        c.fillText("ARENA",0,44);
        c.restore();
      });
      if(ct)canvasMat=new THREE.MeshLambertMaterial({map:ct});
    }
    var canvasTop=new THREE.Mesh(new THREE.BoxGeometry(RING_APRON*2-0.3,0.09,RING_APRON*2-0.3),
      canvasMat||mat(0xd8d4c4));
    canvasTop.position.set(RX,RY+0.03,RZ);
    canvasTop.receiveShadow=true;
    canvasTop.userData.arenaCanvas=true;
    root.add(canvasTop);
    // solid apron (height-gated so you can climb the stair onto it) + deck
    solid(RX-RING_APRON,RZ-RING_APRON,RX+RING_APRON,RZ+RING_APRON,PY,RY-0.05);
    plat(RX-RING_APRON,RZ-RING_APRON,RX+RING_APRON,RZ+RING_APRON,RY);

    var cs=[[-RING_HALF,-RING_HALF],[RING_HALF,-RING_HALF],[RING_HALF,RING_HALF],[-RING_HALF,RING_HALF]];
    for(var ci=0;ci<4;ci++){
      var px=RX+cs[ci][0], pz=RZ+cs[ci][1];
      gold.push({x:px,y:RY+0.85,z:pz,sx:0.24,sy:1.7,sz:0.24});                  // corner post
      dark.push({x:px,y:RY+1.76,z:pz,sx:0.32,sy:0.12,sz:0.32});                 // post cap
      var pad=(ci===0)?redP:(ci===2?blueP:white);
      pad.push({x:px,y:RY+1.02,z:pz,sx:0.44,sy:1.5,sz:0.44});                   // corner pad
      // turnbuckles at each rope height
      for(var tb=0;tb<3;tb++)
        gold.push({x:px,y:RY+0.58+tb*0.42,z:pz,sx:0.3,sy:0.14,sz:0.3});
    }
    // ropes: 3 rows x 4 sides, each split into 6 segments with a catenary dip
    var SEG=6;
    for(var rr=0;rr<3;rr++){
      var ry2=RY+0.58+rr*0.42, sag=0.15-rr*0.03;
      for(var side=0;side<4;side++){
        for(var q=0;q<SEG;q++){
          var t0=q/SEG, t1=(q+1)/SEG, tm=(t0+t1)/2;
          var dip=Math.sin(tm*Math.PI)*sag;
          var a=-RING_HALF+2*RING_HALF*tm, len=(2*RING_HALF)/SEG+0.02;
          if(side===0)      white.push({x:RX+a,y:ry2-dip,z:RZ-RING_HALF,sx:len,sy:0.07,sz:0.07});
          else if(side===1) white.push({x:RX+a,y:ry2-dip,z:RZ+RING_HALF,sx:len,sy:0.07,sz:0.07});
          else if(side===2) white.push({x:RX-RING_HALF,y:ry2-dip,z:RZ+a,sx:0.07,sy:0.07,sz:len});
          else              white.push({x:RX+RING_HALF,y:ry2-dip,z:RZ+a,sx:0.07,sy:0.07,sz:len});
        }
      }
    }
    // The ropes are SOLID from the canvas up: you cannot stroll out through
    // them mid-bout. Height-gated at the canvas so nobody outside the apron is
    // affected, and split on the +z side to leave the walk-in gap at the stair.
    var ROPE_T=0.3, ROPE_TOP=RY+1.5;
    solid(RX-RING_HALF-ROPE_T,RZ-RING_HALF-ROPE_T,RX+RING_HALF+ROPE_T,RZ-RING_HALF,RY,ROPE_TOP);
    solid(RX-RING_HALF-ROPE_T,RZ-RING_HALF,RX-RING_HALF,RZ+RING_HALF,RY,ROPE_TOP);
    solid(RX+RING_HALF,RZ-RING_HALF,RX+RING_HALF+ROPE_T,RZ+RING_HALF,RY,ROPE_TOP);
    solid(RX-RING_HALF-ROPE_T,RZ+RING_HALF,RX-1.35,RZ+RING_HALF+ROPE_T,RY,ROPE_TOP);
    solid(RX+1.35,RZ+RING_HALF,RX+RING_HALF+ROPE_T,RZ+RING_HALF+ROPE_T,RY,ROPE_TOP);

    redP.push({x:RX-RING_HALF-1.1,y:PY+0.3,z:RZ-RING_HALF-1.1,sx:0.7,sy:0.55,sz:0.7});   // corner stools
    blueP.push({x:RX+RING_HALF+1.1,y:PY+0.3,z:RZ+RING_HALF+1.1,sx:0.7,sy:0.55,sz:0.7});
    solid(RX-RING_HALF-1.5,RZ-RING_HALF-1.5,RX-RING_HALF-0.7,RZ-RING_HALF-0.7,PY,PY+0.6);
    solid(RX+RING_HALF+0.7,RZ+RING_HALF+0.7,RX+RING_HALF+1.5,RZ+RING_HALF+1.5,PY,PY+0.6);
    // ---- the walk-up: two treads + a REAL ramp platform onto the canvas ----
    steel.push({x:RX,y:PY+0.16,z:RZ+RING_APRON+1.55,sx:2.6,sy:0.32,sz:1.5});
    steel.push({x:RX,y:PY+0.5,z:RZ+RING_APRON+0.65,sx:2.2,sy:0.36,sz:1.1});
    steel.push({x:RX-1.25,y:PY+0.75,z:RZ+RING_APRON+1.1,sx:0.09,sy:1.5,sz:0.09});
    steel.push({x:RX+1.25,y:PY+0.75,z:RZ+RING_APRON+1.1,sx:0.09,sy:1.5,sz:0.09});
    plat(RX-1.3,RZ+RING_APRON-0.1,RX+1.3,RZ+RING_APRON+2.3,RY,
         {z0:RZ+RING_APRON+2.3,z1:RZ+RING_APRON-0.1,y0:PY,y1:RY});
  })();

  // =========================================================== MMA CAGE ====
  // Octagon mat + branded floor disc + 8 posts + chain-link fence (ONE merged
  // alpha-tested quad batch, not solid boxes) + padded top rail + a real gate.
  (function(){
    var cageBase=new THREE.Mesh(new THREE.CylinderGeometry(CAGE_MAT_R,CAGE_MAT_R+0.3,CGY-PY,8),mat(0x30343c));
    cageBase.rotation.y=Math.PI/8;
    cageBase.position.set(CGX,(PY+CGY)/2,CGZ);
    cageBase.userData.arenaCageBase=true; root.add(cageBase);
    if(ctex&&THREE.CircleGeometry){
      var mt=ctex(512,512,function(c,w,h){
        c.fillStyle="#2c3038"; c.fillRect(0,0,w,h);
        c.strokeStyle="rgba(200,145,42,.55)"; c.lineWidth=10;
        c.beginPath(); c.arc(w/2,h/2,w*0.44,0,6.2832); c.stroke();
        c.fillStyle="rgba(220,226,236,.30)"; c.font="bold 74px Arial";
        c.textAlign="center"; c.textBaseline="middle";
        c.fillText("IRONJAW",w/2,h/2-16);
        c.fillStyle="rgba(200,145,42,.45)"; c.font="bold 42px Arial";
        c.fillText("CAGE",w/2,h/2+50);
      });
      if(mt){
        var md=new THREE.Mesh(new THREE.CircleGeometry(CAGE_MAT_R-0.25,32),
          new THREE.MeshLambertMaterial({map:mt}));
        md.rotation.x=-Math.PI/2; md.position.set(CGX,CGY+0.02,CGZ);
        md.receiveShadow=true; md.userData.arenaCageMat=true; root.add(md);
      }
    }
    // Mat edge is solid EXCEPT the doorway strip on the -x side, where the
    // step-up ramp lands — otherwise the edge collider (y1 just under the mat)
    // would fence the player out at the exact point the ramp reaches mat level.
    var DOOR_HW=1.6;
    solid(CGX-CAGE_MAT_R,CGZ-CAGE_MAT_R,CGX+CAGE_MAT_R,CGZ-DOOR_HW,PY,CGY-0.05);
    solid(CGX-CAGE_MAT_R,CGZ+DOOR_HW,CGX+CAGE_MAT_R,CGZ+CAGE_MAT_R,PY,CGY-0.05);
    solid(CGX+0.5,CGZ-DOOR_HW,CGX+CAGE_MAT_R,CGZ+DOOR_HW,PY,CGY-0.05);
    plat(CGX-CAGE_MAT_R+0.3,CGZ-CAGE_MAT_R+0.3,CGX+CAGE_MAT_R-0.3,CGZ+CAGE_MAT_R-0.3,CGY);
    // gate-side step-up ramp (the open panel faces -x, toward the ring)
    steel.push({x:CGX-CAGE_MAT_R-1.1,y:PY+0.16,z:CGZ,sx:2.2,sy:0.32,sz:2.6});
    plat(CGX-CAGE_MAT_R-2.4,CGZ-DOOR_HW+0.2,CGX-CAGE_MAT_R+0.4,CGZ+DOOR_HW-0.2,CGY,
         {axis:"x",x0:CGX-CAGE_MAT_R-2.4,x1:CGX-CAGE_MAT_R+0.4,y0:PY,y1:CGY});

    // Octagon is rolled half a segment (matching cageBase's PI/8 spin) so a
    // FACE — not a post — sits on the -x axis: that face is the door, and the
    // step-up ramp above lands exactly on it.
    var GATE=3;
    var FENCE_H=2.35;
    var chainQ=(CBZ.arenaVenue&&CBZ.arenaVenue.quads)?CBZ.arenaVenue.quads():null;
    for(var pi=0;pi<8;pi++){
      var a=Math.PI/8+pi*Math.PI/4;
      var px=CGX+Math.cos(a)*CAGE_POST_R, pz=CGZ+Math.sin(a)*CAGE_POST_R;
      steel.push({x:px,y:CGY+FENCE_H/2,z:pz,sx:0.26,sy:FENCE_H,sz:0.26});          // post
      dark.push({x:px,y:CGY+FENCE_H+0.1,z:pz,sx:0.34,sy:0.2,sz:0.34});             // post cap
      var ma=a+Math.PI/8;
      var pr=CAGE_POST_R*Math.cos(Math.PI/8), pw=2*CAGE_POST_R*Math.sin(Math.PI/8);
      var mx=CGX+Math.cos(ma)*pr, mz=CGZ+Math.sin(ma)*pr;
      var yaw=Math.atan2(Math.cos(ma),Math.sin(ma));   // local +Z on the outward normal
      if(pi===GATE){
        // the door: frame posts + a panel swung open toward the plaza
        steel.push({x:mx-1.1,y:CGY+FENCE_H/2,z:mz,sx:pw*0.92,sy:0.1,sz:0.1,ry:yaw+0.85});
        steel.push({x:mx-1.1,y:CGY+FENCE_H,z:mz,sx:pw*0.92,sy:0.12,sz:0.12,ry:yaw+0.85});
        if(chainQ)chainQ.add(mx-1.1,CGY+FENCE_H/2,mz,pw*0.9,FENCE_H,yaw+0.85,0,0,pw*0.9/0.34,FENCE_H/0.34);
        rail.push({x:mx-1.1,y:CGY+FENCE_H+0.06,z:mz,sx:pw*0.92,sy:0.16,sz:0.2,ry:yaw+0.85});
      }else{
        if(chainQ)chainQ.add(mx,CGY+FENCE_H/2,mz,pw,FENCE_H,yaw,0,0,pw/0.34,FENCE_H/0.34);
        rail.push({x:mx,y:CGY+FENCE_H+0.06,z:mz,sx:pw,sy:0.18,sz:0.22,ry:yaw});    // padded top rail
        steel.push({x:mx,y:CGY+0.06,z:mz,sx:pw,sy:0.12,sz:0.14,ry:yaw});           // kick plate
        solidYaw(mx,mz,pw,0.28,yaw,CGY,CGY+FENCE_H);                               // you cannot walk through it
      }
    }
    if(chainQ&&ctex){
      var chain=ctex(128,128,function(c,w,h){
        c.clearRect(0,0,w,h);
        c.strokeStyle="#b9c0cb"; c.lineWidth=7; c.lineCap="round";
        var i;
        for(i=-2;i<=2;i++){ c.beginPath(); c.moveTo(-w+i*w/2,0); c.lineTo(i*w/2,h); c.stroke(); }
        c.strokeStyle="#8d949f";
        for(i=-2;i<=2;i++){ c.beginPath(); c.moveTo(i*w/2,0); c.lineTo(i*w/2-w,h); c.stroke(); }
      });
      var cg=chainQ.geo();
      if(chain&&cg){
        chain.wrapS=chain.wrapT=THREE.RepeatWrapping;
        var fence=new THREE.Mesh(cg,new THREE.MeshLambertMaterial({
          map:chain,alphaTest:0.42,side:THREE.DoubleSide}));
        fence.userData.arenaCageFence=true;
        root.add(fence);
      }
    }
  })();

  // ============================================================ BEAST PIT ==
  // A walled sand circle the crowd looks down into over a padded rail.
  (function(){
    var sand=new THREE.Mesh(new THREE.CylinderGeometry(PIT_SAND_R,PIT_SAND_R,0.28,24),mat(0xd8c07a));
    sand.position.set(PX,PITY-0.12,PZ);
    sand.receiveShadow=true; sand.userData.arenaPitSand=true; root.add(sand);
    // scattered stones / bones, deterministic
    for(var si=0;si<26;si++){
      var sa=si*2.399963, sr=1.4+((si*37)%60)/60*(PIT_SAND_R-2.2);
      var sxp=PX+Math.cos(sa)*sr, szp=PZ+Math.sin(sa)*sr;
      var sc=0.18+CBZ.hash01(sxp,szp,0x9b)*0.3;
      sandBits.push({x:sxp,y:PITY+sc*0.3,z:szp,sx:sc,sy:sc*0.6,sz:sc*1.4,ry:CBZ.hash01(sxp,szp,0x9c)*3.1});
    }
    var WALLN=20, WH=1.55;
    for(var wi=0;wi<WALLN;wi++){
      var wa=wi*Math.PI*2/WALLN;
      var wx=PX+Math.cos(wa)*PIT_WALL_R, wz=PZ+Math.sin(wa)*PIT_WALL_R;
      var wyaw=Math.atan2(Math.cos(wa),Math.sin(wa));
      var seg=2*PIT_WALL_R*Math.sin(Math.PI/WALLN)+0.12;
      concrete.push({x:wx,y:PY+WH/2,z:wz,sx:seg,sy:WH,sz:0.55,ry:wyaw});
      dark.push({x:wx,y:PY+WH+0.09,z:wz,sx:seg,sy:0.18,sz:0.8,ry:wyaw});           // coping
      rail.push({x:wx,y:PY+WH+0.95,z:wz,sx:seg,sy:0.09,sz:0.09,ry:wyaw});          // spectator rail
      steel.push({x:wx,y:PY+WH+0.5,z:wz,sx:0.08,sy:0.9,sz:0.08,ry:wyaw});
      solidYaw(wx,wz,seg,0.6,wyaw,PY,PY+WH+1.05);
    }
    // four floodlight-style pylons around the pit so it reads at night
    for(var pl=0;pl<4;pl++){
      var pa=Math.PI/4+pl*Math.PI/2;
      var lx=PX+Math.cos(pa)*(PIT_WALL_R+2.6), lz=PZ+Math.sin(pa)*(PIT_WALL_R+2.6);
      steel.push({x:lx,y:PY+2.4,z:lz,sx:0.28,sy:4.8,sz:0.28});
      dark.push({x:lx,y:PY+4.9,z:lz,sx:0.9,sy:0.5,sz:0.9});
      solid(lx-0.25,lz-0.25,lx+0.25,lz+0.25,PY,PY+4.8);
    }
  })();

  // ---- flush the shared instanced pools -----------------------------------
  instBoxes(concrete,mat(0x9aa0aa));
  instBoxes(gold,mat(0xd8a020));
  instBoxes(white,mat(0xeeeeee));
  instBoxes(redP,mat(0xaa2233));
  instBoxes(blueP,mat(0x2244aa));
  instBoxes(dark,mat(0x22262c));
  instBoxes(rail,mat(0x992222));
  instBoxes(steel,mat(0x2a2f38));
  instBoxes(sandBits,mat(0xbba46a));
  if(typeof CBZ.markCollidersDirty==="function")CBZ.markCollidersDirty();

  // ---- live spectators in REAL seats --------------------------------------
  // Standard city actors fixed to seat anchors the bowl actually produced, so a
  // geometry change can never leave a fan sitting in mid air. The instanced
  // proxy crowd (arena_venue.js) fills every seat these 42 don't.
  (function(){
    if(!CBZ.npcLife||!CBZ.npcLife.definePopulation)return;
    var slots=(venue&&venue.seatSlots)||[];
    if(!slots.length)return;
    var entries=slots.map(function(a){return {
      profile:"venueSpectator",
      placement:{anchor:{x:a.x,y:a.y,z:a.z,yaw:a.yaw,pose:"sit",state:"sit"},rng:rng},
      overrides:{job:"fight fan"},
      configure:function(p){p._venueRole="arena-spectator";}
    };});
    CBZ.npcLife.definePopulation("arena-audience",{root:root,entries:entries});
  })();

  // ---- resident fighters + referee ----------------------------------------
  if(typeof CBZ.makeCharacter==="function"){
    redCh=CBZ.makeCharacter({legs:0xcc2233,torso:0xf0c8a0,collar:0xf0c8a0,arms:0xf0c8a0,skin:0xf0c8a0,hair:0x201810,shoes:0xbb2222,cap:0});
    blueCh=CBZ.makeCharacter({legs:0x2244cc,torso:0x8a5a3a,collar:0x8a5a3a,arms:0x8a5a3a,skin:0x8a5a3a,hair:0x111111,shoes:0x2233bb,cap:0});
    refCh=CBZ.makeCharacter({legs:0x16181d,torso:0xe8e8e8,collar:0x16181d,arms:0xe8e8e8,skin:0xe8c8a8,hair:0x555555,shoes:0x111111,cap:0});
    redCh.group.position.set(RX-1.8,RY,RZ);
    blueCh.group.position.set(RX+1.8,RY,RZ);
    refCh.group.position.set(RX-3.1,RY,RZ+3.1);
    root.add(redCh.group); root.add(blueCh.group); root.add(refCh.group);
  }

  // ---- map regions ---------------------------------------------------------
  // games/boxing.js anchors SOUTHPAW PALACE by finding /Ironjaw Arena/i in
  // city.regions — the name is a compatibility contract, do not rename it.
  if(typeof CBZ.registerCityRegion==="function"){
    CBZ.registerCityRegion(city,{name:"Ironjaw Arena",subtitle:"Fight Complex",biome:"arena",
      kind:"circle",cx:CX,cz:CZ,r:R,pad:6});
    CBZ.registerCityRegion(city,{name:"Ironjaw Causeway",subtitle:"Arena Approach",biome:"arena",
      kind:"rect",minX:CW_X0,maxX:CW_X1,minZ:CZ-10,maxZ:CZ+10,cx:CW_CX,cz:CZ,pad:4});
  }
  return null;
},40);

// ============================================================ BET OVERLAY UI
var overlayEl=null;
function closeOverlay(){
  if(overlayEl&&overlayEl.parentNode)overlayEl.parentNode.removeChild(overlayEl);
  overlayEl=null;
}
// cfg={title, aLabel,bLabel, aOdds,bOdds, onPlace(side,stake,odds)} side="a"|"b"
function openBetOverlay(cfg){
  closeOverlay();
  if(typeof document==="undefined"||!document.body)return;
  var stake=50, side="a";
  var el=document.createElement("div");
  el.style.cssText="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99999;"+
    "background:#12151b;color:#e8eef7;border:1px solid #2c3648;border-radius:12px;"+
    "padding:16px 20px;min-width:330px;font:14px/1.5 system-ui,Arial,sans-serif;"+
    "box-shadow:0 12px 40px rgba(0,0,0,.65);text-align:center;";
  function div(txt,css){var d=document.createElement("div");d.textContent=txt;if(css)d.style.cssText=css;el.appendChild(d);return d;}
  function btn(txt,fn){var b=document.createElement("button");b.textContent=txt;
    b.style.cssText="background:#1d2431;color:#e8eef7;border:1px solid #34405a;border-radius:8px;"+
      "padding:6px 14px;margin:4px;cursor:pointer;font:inherit;";
    b.onclick=fn;return b;}
  div(cfg.title,"font-weight:700;font-size:16px;margin-bottom:2px;color:#ffd24a;");
  div(cfg.aLabel+"  @ "+cfg.aOdds.toFixed(2)+"    vs    "+cfg.bLabel+"  @ "+cfg.bOdds.toFixed(2),
      "margin:6px 0 10px;color:#aeb8c8;white-space:pre;");
  var aB=btn("Back "+cfg.aLabel,function(){side="a";paint();});
  var bB=btn("Back "+cfg.bLabel,function(){side="b";paint();});
  function paint(){
    aB.style.background=(side==="a")?"#7a1f2b":"#1d2431";
    bB.style.background=(side==="b")?"#1f3a7a":"#1d2431";
  }
  var rowS=document.createElement("div"); rowS.appendChild(aB); rowS.appendChild(bB); el.appendChild(rowS);
  var stakeLbl=document.createElement("span");
  stakeLbl.style.cssText="display:inline-block;min-width:80px;font-weight:700;font-size:16px;";
  function paintStake(){stakeLbl.textContent=money(stake);}
  var rowK=document.createElement("div"); rowK.style.margin="8px 0";
  rowK.appendChild(btn("- $25",function(){stake=Math.max(25,stake-25);paintStake();}));
  rowK.appendChild(stakeLbl);
  rowK.appendChild(btn("+ $25",function(){stake=Math.min(2500,stake+25);paintStake();}));
  el.appendChild(rowK);
  div("Cash: "+((g&&g.cash!=null)?money(g.cash):"?"),"color:#7d8898;font-size:12px;margin-bottom:6px;");
  var rowA=document.createElement("div");
  var place=btn("Place bet",function(){
    if(!CBZ.city||typeof CBZ.city.spend!=="function"||!CBZ.city.spend(stake)){
      note("You can't cover that stake.",3,{urgent:true}); return;
    }
    var odds=(side==="a")?cfg.aOdds:cfg.bOdds;
    cfg.onPlace(side,stake,odds);
    closeOverlay();
  });
  place.style.background="#245a2c";
  rowA.appendChild(place);
  rowA.appendChild(btn("Close",closeOverlay));
  el.appendChild(rowA);
  paint(); paintStake();
  document.body.appendChild(el);
  overlayEl=el;
}

// ============================================================ RING NPC BOUT
var NAMES=["Rico \"Hammer\" Vega","Sonny Malone","Dee \"Cobra\" Kane","Marek Stone",
  "Otis Braddock","\"Iron\" Ada Cole","Felix Marrow","Juno Blackwood","Big Tam Docherty",
  "Ray \"Cyclone\" Ito","Vusi Dlamini","Karla \"Nitro\" Reyes"];
var PUNCHES=["jab","cross","hook","upper"];
var bout=null, boutSeq=0, ringBet=null, nearRing=false, ringSuspended=false;

// ================================================================ FIGHTER CAREER
// PURSES ARE LOGIC, NOT NUMBERS. There is no purse table and no cap. A purse
// is what the gate + broadcast would pay for THIS matchup: computed from YOUR
// drawing power (fame), your OPPONENT's fame and record, the stakes (title
// fights x3) and the discipline's economics (boxing pays far beyond MMA at
// the top — real life). Fame is earned the real way: beat a man and you
// absorb a cut of HIS fame — beat nobodies and stay a nobody, beat a star
// and become one; a loss slashes your drawing power. Club fights pay ~$500;
// a legend-vs-legend boxing title fight pays nine figures because the
// formula says so, and nothing stops it climbing past that.
function careerState(){
  var w=(g&&g.cityWorld)||g;
  if(!w.fighterCareer)w.fighterCareer={fame:0,wins:0,losses:0,kos:0,streak:0,beltMMA:false,beltBox:false,defenses:0};
  return w.fighterCareer;
}
function commitCareer(){ if(typeof CBZ.cityWorldCommit==="function"){try{CBZ.cityWorldCommit();}catch(e){}} }
function rankLabel(f){
  return f<200?"club fighter":f<2000?"prospect":f<20000?"contender":
         f<200000?"headliner":f<5000000?"superstar":"living legend";
}
function makeOpponent(box){
  var c=careerState();
  // the matchmaker books around YOUR level — sometimes a tune-up, sometimes a
  // step-up (bigger name, bigger purse, harder night).
  var f=c.fame*(0.35+Math.random()*1.35)+40+Math.random()*160;
  var wins=Math.max(1,Math.round(3+Math.log(1+f)*2.1+Math.random()*5));
  var losses=Math.round(Math.random()*5);
  return {name:NAMES[(Math.random()*NAMES.length)|0],fame:f,wins:wins,losses:losses,
          skill:0.35+Math.min(0.55,Math.log(1+f)/26),box:!!box};
}
function isTitle(c,box){ return box?(c.beltBox||c.streak>=5):(c.beltMMA||c.streak>=5); }
function purseFor(c,opp,box){
  var draw=c.fame+opp.fame*0.7;                 // combined drawing power
  var p=500+draw*(box?2.6:0.9);                 // boxing economics >> MMA at the top
  if(isTitle(c,box))p*=3;                       // title stakes
  return Math.round(p);
}
// the NEXT booked opponent per discipline (so the prompt shows the actual card)
var nextOpp={mma:null,box:null};
function bookedOpp(box){ var k=box?"box":"mma"; if(!nextOpp[k])nextOpp[k]=makeOpponent(box); return nextOpp[k]; }
// The one law that keeps nine figures MEANING something: the paying fight
// audience is finite (real earth: ~$300M was the ceiling of PPV economics —
// Mayweather couldn't have earned $5B because the buyers don't exist). Fame
// growth saturates asymptotically as you approach "everyone who pays for
// fights already knows you". NOT a cap — purses keep inching up forever, but
// the days of doubling every win end once you're a household name.
var AUDIENCE=30000000;
function recordWin(opp,box,ko,war,purse){
  var c=careerState(), title=isTitle(c,box), oldRank=rankLabel(c.fame);
  c.wins++; c.streak++; if(ko)c.kos++;
  var room=Math.max(0.02,1-c.fame/AUDIENCE);      // market saturation, never quite zero
  c.fame+=(30+opp.fame*0.28)*(ko?1.3:1)*(title?1.35:1)*room;
  if(title){
    if(box){ if(c.beltBox){c.defenses++;} else {c.beltBox=true;c.defenses=0;note("NEW "+(box?"BOXING":"MMA")+" CHAMPION OF IRONJAW!",6,{urgent:true});} }
    else { if(c.beltMMA){c.defenses++;} else {c.beltMMA=true;c.defenses=0;note("NEW MMA CHAMPION OF IRONJAW!",6,{urgent:true});} }
  }
  if(CBZ.city&&CBZ.city.addCash)CBZ.city.addCash(purse);
  if(CBZ.city&&CBZ.city.addRespect)CBZ.city.addRespect(title?12:6);
  // Fight of the Night: not a fixed bonus — it fires when the bout was a WAR
  // and scales with the size of the event (a cut of the purse).
  if(war&&Math.random()<0.55){
    var bonus=Math.max(1500,Math.round(purse*0.45));
    if(CBZ.city&&CBZ.city.addCash)CBZ.city.addCash(bonus);
    note("FIGHT OF THE NIGHT — bonus "+money(bonus),5,{urgent:true});
  }
  var newRank=rankLabel(c.fame);
  if(newRank!==oldRank)note("Your name is growing — the papers call you a "+newRank.toUpperCase()+".",5,{urgent:true});
  nextOpp[box?"box":"mma"]=null;
  commitCareer();
}
function recordLoss(box){
  var c=careerState();
  c.losses++; c.streak=0; c.fame*=0.68;         // the market stops believing
  if(box&&c.beltBox){c.beltBox=false;note("You LOST THE BOXING TITLE.",5,{urgent:true});}
  if(!box&&c.beltMMA){c.beltMMA=false;note("You LOST THE MMA TITLE.",5,{urgent:true});}
  nextOpp[box?"box":"mma"]=null;
  commitCareer();
}

function resetFighter(ch,x){
  if(!ch)return;
  ch.group.position.set(x,RY,RZ);
  ch.koT=0; ch.blockT=0; ch.dodgeT=0; ch.staggerT=0; ch.punchT=0; ch.kickT=0;
  ch.fightStance=true;
}
function newBout(){
  if(!redCh||!blueCh)return;
  boutSeq++;
  var i1=(Math.random()*NAMES.length)|0, i2=(Math.random()*NAMES.length)|0;
  if(i2===i1)i2=(i2+1)%NAMES.length;
  var p=0.35+Math.random()*0.30; // red's true win prob
  bout={id:boutSeq,state:"circle",t:2.5,ang:Math.random()*Math.PI*2,
    dir:(Math.random()<0.5)?-1:1,atkCd:1,exT:0,attacker:"red",winner:null,pRed:p,
    red:{ch:redCh,hp:100,name:NAMES[i1]},blue:{ch:blueCh,hp:100,name:NAMES[i2]},
    oddsRed:Math.round(94/p)/100,oddsBlue:Math.round(94/(1-p))/100}; // ~6% vig
  resetFighter(redCh,RX-1.8); resetFighter(blueCh,RX+1.8);
  board("BOUT #"+bout.id,bout.red.name+"  vs  "+bout.blue.name,
        "RED @"+bout.oddsRed.toFixed(2)+"   ·   BLUE @"+bout.oddsBlue.toFixed(2));
  if(nearRing)note("Next bout — RED "+bout.red.name+" @"+bout.oddsRed.toFixed(2)+
    " vs BLUE "+bout.blue.name+" @"+bout.oddsBlue.toFixed(2)+"  [E] ringside to bet",6);
}
// The ring bound: derived from RING_HALF, never hand-typed. Fighters stay
// RING_INSET inside the ropes so a punch thrown at the rail still lands inside.
function clampRing(p){
  p.x=Math.min(RX+RING_FIGHT,Math.max(RX-RING_FIGHT,p.x));
  p.z=Math.min(RZ+RING_FIGHT,Math.max(RZ-RING_FIGHT,p.z));
  p.y=RY;
}
function strike(b,A,D){
  var kick=Math.random()<0.22;
  if(kick){A.ch.kickDur=0.55;A.ch.kickT=0.55;}
  else{
    A.ch.punchKind=PUNCHES[(Math.random()*PUNCHES.length)|0];
    A.ch.punchArm=(Math.random()<0.5)?"l":"r";
    A.ch.punchDur=0.34; A.ch.punchT=0.34;
  }
  var roll=Math.random();
  if(roll<0.18){ D.ch.dodgeT=0.4; D.ch.dodgeDir=(Math.random()<0.5)?-1:1; return; } // slipped it
  var dmg=(kick?12:7)+Math.random()*6;
  if(roll<0.48){ D.ch.blockT=0.45; dmg*=0.3; }     // caught on the guard
  else{ D.ch.staggerT=0.35; }                       // clean
  D.hp-=dmg;
  if(D.hp<=0){
    D.hp=0; D.ch.koT=6; D.ch.fightStance=false;
    b.winner=(D===b.red)?"blue":"red";
    b.state="ko"; b.t=3.5;
    var w0=(b.winner==="red")?b.red:b.blue;
    board("DOWN!",w0.name+" drops "+D.name,"the referee is counting");
    if(nearRing)note("DOWN! "+w0.name+" drops "+D.name+" — the ref is counting...",3,{urgent:true});
  }
}
function settleRingBet(b){
  if(!ringBet)return;
  if(ringBet.boutId!==b.id){ ringBet=null; return; }
  if(ringBet.side===b.winner){
    var pay=Math.round(ringBet.stake*ringBet.odds);
    if(CBZ.city&&CBZ.city.addCash)CBZ.city.addCash(pay);
    note("Bet cashed: +"+money(pay),4,{urgent:true});
  }else{
    note("Bet lost — "+money(ringBet.stake)+" gone to the house.",4);
  }
  ringBet=null;
}
function tickRing(dt){
  var b=bout; if(!b)return;
  var r=b.red,u=b.blue, rp=r.ch.group.position, up=u.ch.group.position;
  if(b.state==="circle"){
    b.t-=dt; b.ang+=dt*0.55*b.dir;
    moveTo(rp,RX+Math.cos(b.ang)*1.7,RZ+Math.sin(b.ang)*1.7,1.6*dt);
    moveTo(up,RX-Math.cos(b.ang)*1.7,RZ-Math.sin(b.ang)*1.7,1.6*dt);
    clampRing(rp); clampRing(up);
    face(r.ch,up.x,up.z); face(u.ch,rp.x,rp.z);
    anim(r.ch,0.7,dt); anim(u.ch,0.7,dt);
    if(b.t<=0){
      b.state="exchange"; b.exT=2+Math.random()*2.5; b.atkCd=0.5;
      b.attacker=(Math.random()<b.pRed)?"red":"blue"; // favourite presses more
    }
  }else if(b.state==="exchange"){
    var dx=up.x-rp.x,dz=up.z-rp.z,d=Math.hypot(dx,dz)||0.001,mv=0.3;
    if(d>1.2){
      var s=Math.min(1.4*dt,(d-1.15)*0.5);
      rp.x+=dx/d*s; rp.z+=dz/d*s; up.x-=dx/d*s; up.z-=dz/d*s; mv=1.3;
    }
    clampRing(rp); clampRing(up);
    face(r.ch,up.x,up.z); face(u.ch,rp.x,rp.z);
    anim(r.ch,mv,dt); anim(u.ch,mv,dt);
    b.atkCd-=dt;
    if(d<1.6&&b.atkCd<=0){
      b.atkCd=0.75+Math.random()*0.7;
      if(Math.random()<0.45)b.attacker=(b.attacker==="red")?"blue":"red";
      var A=(b.attacker==="red")?r:u, D=(b.attacker==="red")?u:r;
      strike(b,A,D);
    }
    if(b.state==="exchange"){
      b.exT-=dt;
      if(b.exT<=0){ b.state="circle"; b.t=1.2+Math.random()*2; b.dir=(Math.random()<0.5)?-1:1; }
    }
  }else if(b.state==="ko"){
    b.t-=dt;
    var W=(b.winner==="red")?r:u, L=(b.winner==="red")?u:r;
    W.ch.fightStance=false;
    anim(W.ch,0.5,dt); anim(L.ch,0,dt);
    var refMoved=refCh?moveTo(refCh.group.position,L.ch.group.position.x+0.9,L.ch.group.position.z,1.9*dt):0;
    if(refCh){ refCh.group.position.y=RY; face(refCh,L.ch.group.position.x,L.ch.group.position.z); anim(refCh,refMoved>0?1.2:0.15,dt); }
    if(b.t<=0){
      board("WINNER BY KO",W.name,"IRONJAW ARENA");
      if(nearRing)note((b.winner==="red"?"RED ":"BLUE ")+W.name+" wins by KO!",4,{urgent:true});
      settleRingBet(b);
      b.state="reset"; b.t=4;
    }
  }else if(b.state==="reset"){
    b.t-=dt;
    anim(r.ch,0,dt); anim(u.ch,0,dt);
    if(refCh){ moveTo(refCh.group.position,RX-3.1,RZ+3.1,1.6*dt); refCh.group.position.y=RY; anim(refCh,0.4,dt); }
    if(b.t<=0)newBout();
  }
  if(refCh&&b.state!=="ko"&&b.state!=="reset"){
    face(refCh,RX,RZ); anim(refCh,0.1,dt);
  }
}

// ============================================================ PLAYER v CAGE
var pfight=null;
function startBout(box){
  if(pfight){ note("You're already in a bout.",2); return; }
  if(!arenaRoot||typeof CBZ.makeCharacter!=="function"){ note("The card is closed tonight.",3); return; }
  if(CBZ.player&&CBZ.player.dead){ return; }
  var c=careerState(), card=bookedOpp(box);
  // ONE radius per discipline, straight off the GEOMETRY LAW — the ring used to
  // spawn at 3.1 while clampRing held 3.2, an invisible 0.1 desync.
  var cx=box?RX:CGX, cz=box?RZ:CGZ, cy=box?RY:CGY, rad=box?RING_FIGHT:CAGE_FIGHT;
  if(box){
    // the player takes over the RING: refund any live ringside bet, park the
    // house fighters out of sight, resume the card after.
    if(ringBet&&bout&&ringBet.boutId===bout.id){ if(CBZ.city&&CBZ.city.addCash)CBZ.city.addCash(ringBet.stake); note("Card interrupted — your stake is refunded.",3); }
    ringBet=null; bout=null; ringSuspended=true;
    if(redCh)redCh.group.visible=false; if(blueCh)blueCh.group.visible=false; if(refCh)refCh.group.visible=false;
  }
  var opp=CBZ.makeCharacter({legs:0x111111,torso:box?0x8a1f1f:0x40342a,collar:box?0x8a1f1f:0x40342a,arms:box?0x8a1f1f:0x40342a,
    skin:0xc89878,hair:0x0a0a0a,shoes:0x222222,cap:0});
  opp.group.position.set(cx+rad*0.7,cy,cz);
  opp.fightStance=true;
  arenaRoot.add(opp.group);
  // Put the player ON the deck, not through it: the ring canvas and cage mat
  // are now real platforms, and physics only adopts a platform within STEP_UP
  // of the feet it is asked about.
  if(CBZ.player&&CBZ.player.pos)CBZ.player.pos.set(cx-rad*0.7,cy,cz);
  var purse=purseFor(c,card,box);
  pfight={opp:opp,card:card,box:!!box,purse:purse,cx:cx,cz:cz,cy:cy,rad:rad,t:0,
    oppHp:100*(0.75+card.skill*0.8),oppHpMax:100*(0.75+card.skill*0.8),
    myHp:60,pcd:0.6,ocd:1.4,over:0,won:false,name:card.name};
  board((box?"BOXING":"MMA")+(isTitle(c,box)?" TITLE BOUT":" BOUT"),
        "YOU  vs  "+card.name,"purse "+money(purse));
  note((box?"BOXING":"MMA")+(isTitle(c,box)?" TITLE":"")+" bout vs "+card.name+" ("+card.wins+"-"+card.losses+
    ") — purse "+money(purse)+".",6,{urgent:true});
}
function startCageFight(){ startBout(false); }
function startBoxMatch(){ startBout(true); }
function endCageFight(){
  if(!pfight)return;
  if(arenaRoot&&pfight.opp)arenaRoot.remove(pfight.opp.group);
  if(pfight.box){ // hand the ring back to the house card
    ringSuspended=false;
    if(redCh)redCh.group.visible=true; if(blueCh)blueCh.group.visible=true; if(refCh)refCh.group.visible=true;
  }
  pfight=null;
  board("IRONJAW ARENA","FIGHT NIGHT","BOXING / MMA / BEAST PIT");
}
function clampCage(p){
  var f=pfight, cx=f?f.cx:CGX, cz=f?f.cz:CGZ, cy=f?f.cy:CGY, r=f?f.rad:CAGE_FIGHT;
  var dx=p.x-cx,dz=p.z-cz,d=Math.hypot(dx,dz);
  if(d>r){p.x=cx+dx/d*r;p.z=cz+dz/d*r;}
  p.y=cy;
}
function tickCage(dt,pp){
  var f=pfight; if(!f)return;
  var opp=f.opp, og=opp.group;
  if(f.over>0){
    f.over-=dt; anim(opp,0,dt);
    if(f.over<=0)endCageFight();
    return;
  }
  var d=Math.hypot(pp.x-og.position.x,pp.z-og.position.z);
  if(d>22){ note("You fled the "+(f.box?"ring":"cage")+". No purse for runners.",4); recordLoss(f.box); endCageFight(); return; }
  f.t+=dt;
  var sk=(f.card&&f.card.skill)||0.45;
  var mv=0.3;
  if(d>1.5){
    var s=(1.8+sk*1.1)*dt;                                   // better fighters cut the ring off
    og.position.x+=(pp.x-og.position.x)/d*s;
    og.position.z+=(pp.z-og.position.z)/d*s;
    mv=1.6;
  }
  clampCage(og.position);
  face(opp,pp.x,pp.z);
  if(Math.random()<dt*(0.3+sk*0.6))opp.blockT=0.5;           // brings the guard up
  f.ocd-=dt;
  if(d<2.0&&f.ocd<=0){                                       // he swings at you
    f.ocd=Math.max(0.55,1.35-sk*0.9)+Math.random()*0.7;
    if(!f.box&&Math.random()<0.25){opp.kickDur=0.55;opp.kickT=0.55;}   // kicks are MMA-only
    else{opp.punchKind=PUNCHES[(Math.random()*PUNCHES.length)|0];
      opp.punchArm=(Math.random()<0.5)?"l":"r";opp.punchDur=0.34;opp.punchT=0.34;}
    if(Math.random()<0.35+sk*0.45){
      var oh=6+sk*10;
      if(typeof CBZ.cityHurtPlayer==="function"){try{CBZ.cityHurtPlayer(oh,f.name);}catch(e){}}
      f.myHp-=oh;
    }
  }
  f.pcd-=dt;
  if(d<2.4&&f.pcd<=0){                                       // your work lands (forgiving)
    f.pcd=0.85;
    var dmg=10+Math.random()*5;
    if(opp.blockT&&opp.blockT>0)dmg*=0.3;
    else if(Math.random()<0.08+sk*0.15){opp.dodgeT=0.35;opp.dodgeDir=(Math.random()<0.5)?-1:1;dmg=0;}
    if(dmg>0){f.oppHp-=dmg;opp.staggerT=0.3;}
  }
  anim(opp,mv,dt);
  if(f.oppHp<=0){
    opp.koT=5; opp.fightStance=false;
    var war=f.t>30&&f.myHp<=24;                              // a genuine WAR, not a walkover
    board("WINNER BY KO","YOU","purse "+money(f.purse));
    note("You KO "+f.name+"! Purse +"+money(f.purse)+".",5,{urgent:true});
    recordWin(f.card,f.box,true,war,f.purse);
    f.won=true; f.over=4;
  }else if(f.myHp<=0||(CBZ.player&&CBZ.player.dead)){
    board("WINNER BY KO",f.name,"no purse tonight");
    note(f.name+" leaves you folded. No purse tonight, and your stock just dropped.",5,{urgent:true});
    recordLoss(f.box);
    f.over=3;
  }
}

// ================================================================ BEAST PIT
var pitBout=null, pitBet=null;
function speciesPool(){
  var reg=CBZ.WILDLIFE_SPECIES||{}, out=[], k;
  var prefs=["lion","brown_bear","tiger","wolf","boar","hyena","black_bear","panther",
    "bull","gorilla","cougar","croc","crocodile","jaguar","leopard","bison","elk","moose","warthog"];
  for(var i=0;i<prefs.length;i++){k=prefs[i];if(reg[k]&&typeof reg[k].build==="function")out.push(k);}
  if(out.length<2){for(k in reg){if(reg[k]&&typeof reg[k].build==="function"&&out.indexOf(k)<0)out.push(k);}}
  return out;
}
function prettySpecies(id){ return String(id||"beast").replace(/_/g," "); }
function spawnBeast(id,x,z){
  var reg=CBZ.WILDLIFE_SPECIES||{}, sp=reg[id]; if(!sp)return null;
  var grp=null;
  try{grp=sp.build({THREE:THREE,mat:mat,rng:Math.random});}catch(e){}
  if(!grp)return null;
  grp.position.set(x,PITY,z);
  arenaRoot.add(grp);
  return {group:grp,pos:grp.position,hp:140,maxHp:140,dead:false,species:id};
}
function findPet(){
  var ws=CBZ.cityWildlife;
  if(!ws||!ws.length)return null;
  for(var i=0;i<ws.length;i++){var a=ws[i];if(a&&a.tamed&&!a.dead&&a.group)return a;}
  return null;
}
// Pit bound: derived from PIT_WALL_R, so a wider pit widens the fight floor.
function clampPitXZ(p){
  var dx=p.x-PX,dz=p.z-PZ,d=Math.hypot(dx,dz);
  if(d>PIT_FIGHT){p.x=PX+dx/d*PIT_FIGHT;p.z=PZ+dz/d*PIT_FIGHT;}
  p.y=PITY;
}
function startWildPit(){
  if(pitBout){ note("A pit bout is already running — watch the rail.",3); return; }
  if(!arenaRoot){ return; }
  var pool=speciesPool();
  if(pool.length<2){ note("No beasts in the holding pens tonight.",3); return; }
  var i1=(Math.random()*pool.length)|0, i2=(Math.random()*pool.length)|0;
  if(i2===i1)i2=(i2+1)%pool.length;
  var A=spawnBeast(pool[i1],PX-PIT_FIGHT*0.6,PZ), B=spawnBeast(pool[i2],PX+PIT_FIGHT*0.6,PZ);
  if(!A||!B){ if(A)arenaRoot.remove(A.group); if(B)arenaRoot.remove(B.group);
    note("The beasts refused the pit.",3); return; }
  pitBout={a:A,b:B,kind:"wild",done:false,over:0};
  board("THE BEAST PIT",prettySpecies(A.species).toUpperCase()+"  vs  "+prettySpecies(B.species).toUpperCase(),
        "both @1.88");
  note("PIT BOUT: "+prettySpecies(A.species)+" vs "+prettySpecies(B.species)+"!",4,{urgent:true});
  openBetOverlay({
    title:"Beast Pit — place your money",
    aLabel:prettySpecies(A.species), bLabel:prettySpecies(B.species),
    aOdds:1.88, bOdds:1.88,
    onPlace:function(side,stake,odds){
      pitBet={side:side,stake:stake,odds:odds};
      note("Pit bet down: "+money(stake)+" on the "+
        prettySpecies(side==="a"?A.species:B.species)+".",3);
    }
  });
}
function startPetPit(){
  if(pitBout){ note("A pit bout is already running.",3); return; }
  var pet=findPet();
  if(!pet){ note("You have no tamed beast following you.",3); return; }
  var pool=speciesPool();
  if(!pool.length){ note("No wild challenger available.",3); return; }
  var wild=spawnBeast(pool[(Math.random()*pool.length)|0],PX+PIT_FIGHT*0.6,PZ);
  if(!wild){ note("No wild challenger available.",3); return; }
  pet.group.position.set(PX-PIT_FIGHT*0.6,PITY,PZ);
  // shadow actor: the bout never permanently harms your pet
  var wrap={group:pet.group,pos:pet.group.position,hp:140,maxHp:140,dead:false,
    species:pet.species||"beast",isPet:true};
  pitBout={a:wrap,b:wild,kind:"pet",done:false,over:0};
  board("THE BEAST PIT","YOUR "+prettySpecies(wrap.species).toUpperCase()+"  vs  "+prettySpecies(wild.species).toUpperCase(),
        "purse "+money(600));
  note("Your "+prettySpecies(wrap.species)+" steps into the pit! Purse "+money(600)+".",4,{urgent:true});
}
function finishPit(w,l){
  var P=pitBout; if(!P||P.done)return;
  P.done=true; P.over=5;
  l.dead=true; l.hp=0;
  if(!l.isPet&&l.group)l.group.rotation.z=1.35; // spawned loser keels over
  board("PIT WINNER",(w.isPet?"YOUR ":"")+prettySpecies(w.species).toUpperCase(),"IRONJAW ARENA");
  note((w.isPet?"YOUR ":"")+prettySpecies(w.species).toUpperCase()+" WINS THE PIT!",4,{urgent:true});
  if(P.kind==="pet"){
    if(w.isPet){
      if(CBZ.city&&CBZ.city.addCash)CBZ.city.addCash(600);
      if(CBZ.city&&CBZ.city.addRespect)CBZ.city.addRespect(4);
      note("Pit purse +"+money(600)+".",4,{urgent:true});
    }else{
      note("Your beast is dragged out of the pit. It'll recover.",4);
    }
  }
  if(pitBet){
    var winSide=(w===P.a)?"a":"b";
    if(pitBet.side===winSide){
      var pay=Math.round(pitBet.stake*pitBet.odds);
      if(CBZ.city&&CBZ.city.addCash)CBZ.city.addCash(pay);
      note("Pit bet cashed: +"+money(pay),4,{urgent:true});
    }else{
      note("Pit bet lost — "+money(pitBet.stake)+" gone.",4);
    }
    pitBet=null;
  }
}
function endPit(){
  var P=pitBout; if(!P)return;
  if(arenaRoot){
    if(P.a&&!P.a.isPet&&P.a.group)arenaRoot.remove(P.a.group);
    if(P.b&&!P.b.isPet&&P.b.group)arenaRoot.remove(P.b.group);
  }
  if(P.a&&P.a.isPet)P.a.group.rotation.z=0;
  pitBout=null; pitBet=null;
  if(!bout&&!pfight)board("IRONJAW ARENA","FIGHT NIGHT","BOXING / MMA / BEAST PIT");
}
function tickPit(dt){
  var P=pitBout; if(!P)return;
  if(P.over>0){ P.over-=dt; if(P.over<=0)endPit(); return; }
  var A=P.a,B=P.b;
  if(typeof CBZ.creatureFight==="function"&&!A.dead&&!B.dead){
    try{
      CBZ.creatureFight(A,B,dt,{reach:2.4,speed:2.6,onHit:function(){},onDown:function(){}});
      CBZ.creatureFight(B,A,dt,{reach:2.4,speed:2.6,onHit:function(){},onDown:function(){}});
    }catch(e){}
  }
  clampPitXZ(A.pos); clampPitXZ(B.pos);
  if(!P.done){
    if(A.hp<=0||A.dead)finishPit(B,A);
    else if(B.hp<=0||B.dead)finishPit(A,B);
  }
}

// ============================================================ ON-MAP PROMPTS
// Every radius here is derived from the GEOMETRY LAW block, so moving or
// resizing a fight surface moves its prompt with it — automatically.
if(CFG.ARENA_FIGHTS&&CBZ.interactions&&typeof CBZ.interactions.registerZone==="function"){
  CBZ.interactions.registerZone({
    id:"arena_ring", kind:"arena_ring", prio:4,
    find:function(px,pz){ return Math.hypot(px-RX,pz-RZ)<RING_ZONE?{x:RX,z:RZ}:null; },
    options:[{
      id:"arena_ring_bet", slot:"e",
      label:function(){
        if(!bout)return "Ringside betting";
        if(bout.state==="ko"||bout.state==="reset")return "Bout ending — next matchup soon";
        if(ringBet&&ringBet.boutId===bout.id)return "Bet down: "+money(ringBet.stake)+" on "+ringBet.side.toUpperCase();
        return "Bet: RED "+bout.red.name+" @"+bout.oddsRed.toFixed(2)+
               " / BLUE "+bout.blue.name+" @"+bout.oddsBlue.toFixed(2);
      },
      onSelect:function(){
        if(!bout){ note("No bout scheduled right now.",2); return; }
        if(bout.state==="ko"||bout.state==="reset"){ note("Too late — wait for the next matchup.",2); return; }
        if(ringBet&&ringBet.boutId===bout.id){ note("Your money's already down on this one.",2); return; }
        var b=bout;
        openBetOverlay({
          title:"Ironjaw Ring — Bout #"+b.id,
          aLabel:"RED "+b.red.name, bLabel:"BLUE "+b.blue.name,
          aOdds:b.oddsRed, bOdds:b.oddsBlue,
          onPlace:function(side,stake,odds){
            ringBet={boutId:b.id,side:(side==="a")?"red":"blue",stake:stake,odds:odds};
            note("Bet down: "+money(stake)+" on "+ringBet.side.toUpperCase()+" @"+odds.toFixed(2),3);
          }
        });
      }
    },{
      id:"arena_ring_box", slot:"j",
      label:function(){
        if(pfight)return "Bout in progress";
        var c=careerState(),o=bookedOpp(true);
        return "BOXING"+(isTitle(c,true)?" TITLE":"")+" match vs "+o.name+" ("+o.wins+"-"+o.losses+") · purse "+money(purseFor(c,o,true));
      },
      onSelect:startBoxMatch
    }]
  });
  CBZ.interactions.registerZone({
    id:"arena_cage", kind:"arena_cage", prio:4,
    find:function(px,pz){ return Math.hypot(px-CGX,pz-CGZ)<CAGE_ZONE?{x:CGX,z:CGZ}:null; },
    options:[{
      id:"arena_cage_fight", slot:"i",
      label:function(){
        if(pfight)return "Bout in progress";
        var c=careerState(),o=bookedOpp(false);
        return "MMA"+(isTitle(c,false)?" TITLE":"")+" bout vs "+o.name+" ("+o.wins+"-"+o.losses+") · purse "+money(purseFor(c,o,false));
      },
      onSelect:startCageFight
    }]
  });
  CBZ.interactions.registerZone({
    id:"arena_pit", kind:"arena_pit", prio:4,
    find:function(px,pz){ return Math.hypot(px-PX,pz-PZ)<PIT_ZONE?{x:PX,z:PZ}:null; },
    options:[
      {
        id:"arena_pit_wild", slot:"j",
        label:function(){ return pitBout?"Pit bout in progress":"Stage a beast bout (bet ringside)"; },
        onSelect:startWildPit
      },
      {
        id:"arena_pit_pet", slot:"i",
        label:function(){
          var pet=findPet();
          return pet?("Enter your "+prettySpecies(pet.species||"beast")+" in the pit ($600 purse)")
                    :"Pit entry: no tamed beast with you";
        },
        onSelect:startPetPit
      }
    ]
  });
  if(typeof CBZ.interactions.describe==="function"){
    CBZ.interactions.describe("arena_ring",function(){
      var c=careerState();
      return {label:"Ironjaw Ring"+(c.beltBox?" · BOXING CHAMP":""),
        note:c.wins+c.losses>0?("You: "+c.wins+"-"+c.losses+" ("+c.kos+" KO) · "+rankLabel(c.fame)):"Live bout — bet ringside"};
    });
    CBZ.interactions.describe("arena_cage",function(){
      var c=careerState();
      return {label:"Ironjaw Cage"+(c.beltMMA?" · MMA CHAMP":""),
        note:c.wins+c.losses>0?("You: "+c.wins+"-"+c.losses+" ("+c.kos+" KO) · "+rankLabel(c.fame)):"Open card — step in"};
    });
    CBZ.interactions.describe("arena_pit",function(){return{label:"Beast Pit",note:"Where animals settle it"};});
  }
}

// ================================================================ MAIN TICK
CBZ.onUpdate(40,function(dt){
  if(!dt||dt>0.5)dt=0.05;
  if(!arenaRoot||!CBZ.player||!CBZ.player.pos)return;
  var pp=CBZ.player.pos;
  // The building's own per-frame work: switch the real light rig + instanced
  // crowd by distance, and repaint the jumbotron when the card changed.
  if(venue&&venue.tick)venue.tick(Math.hypot(pp.x-CX,pp.z-CZ),dt);
  // ring bout: only simulate while a spectator could actually see it, and
  // while the ring isn't handed over to the player's own boxing match.
  nearRing=Math.hypot(pp.x-RX,pp.z-RZ)<RING_SIM;
  if(nearRing&&!ringSuspended){
    if(!bout)newBout();
    tickRing(dt);
  }
  // player cage bout: only exists after [I] at the cage
  if(pfight)tickCage(dt,pp);
  // pit bout: only exists after [J]/[I] at the pit; frozen if you wander far
  if(pitBout&&Math.hypot(pp.x-PX,pp.z-PZ)<PIT_SIM)tickPit(dt);
});

})();
