// ============================================================================
// arena_fights.js — IRONJAW ARENA: a real, walk-in fight complex.
//
// WHY THIS EXISTS: fighting used to live only in a hidden betting menu — a
// feature you couldn't SEE. This puts it physically on the map, mirroring how
// the speedway island works: a landmass you can drive/boat/walk to, with
// on-map interaction prompts. It has a boxing ring with a LIVE, self-running
// NPC bout (the showcase for the improved fight poses: kicks, blocks, dodges,
// staggers, KO crumples), an MMA cage the player can step into, a sunken
// beast pit that stages creature-vs-creature bouts via CBZ.creatureFight,
// and a bounded cast of live grandstand spectators watching it all.
//
// PERF NOTES:
//  - Static venue is draw-call disciplined: grandstand slabs and seats are
//    InstancedMeshes; spectators are ordinary interactive NPCs in a bounded
//    set of seats (the rest stay honestly empty, never proxy boxes);
//    ropes / cage panels / posts / masts / pit wall are batched into a
//    handful of per-material InstancedMeshes via instBoxes(). Materials come
//    from the shared CBZ.cmat cache.
//  - ALL simulation is distance gated: the ring bout only ticks when the
//    player is within ~90u; the pit bout within ~110u; the player cage bout
//    only exists while the player started it. When you're across the map the
//    whole file costs a couple of Math.hypot calls per frame.
//  - Deterministic placement uses a local LCG so the venue is identical every
//    load; per-frame liveliness (fight AI) uses Math.random.
// ============================================================================
(function(){
"use strict";
var CBZ=window.CBZ, THREE=window.THREE;
if(!CBZ||!THREE)return;
var g=CBZ.game;
var mat=CBZ.cmat||CBZ.mat;
if(!mat||typeof CBZ.addLandmass!=="function"||typeof CBZ.onUpdate!=="function")return;

// ---------------------------------------------------------------- footprint
// Dedicated island in the open channel between Mercy, Commerce and Coyle.
// The former (820,-560) footprint was 62% inside Coyle Valley, so two land
// surfaces and their buildings occupied the same physical space.
var CX=640, CZ=-950, R=120;
var CW_X0=482, CW_X1=CX-R+7, CW_CX=(CW_X0+CW_X1)/2;
var PY=1.1;                      // plaza (octagon deck) top height
var RX=CX-32, RZ=CZ, RY=PY+0.9;    // boxing ring centre + canvas height
var CGX=CX+32, CGZ=CZ, CGY=PY+0.5; // MMA cage centre + mat height
var PX=CX, PZ=CZ+54, PITY=PY-0.5; // beast pit centre + sand height (sunken)

var arenaRoot=null;
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

// ================================================================ THE VENUE
CBZ.addLandmass(function(city){
  var root=city.root; arenaRoot=root;
  var _s=771; function rng(){_s=(_s*1103515245+12345)&0x7fffffff;return _s/0x7fffffff;}
  var unitBox=(typeof CBZ.boxGeom==="function")?CBZ.boxGeom(1,1,1):new THREE.BoxGeometry(1,1,1);

  // Batch a list of {x,y,z,sx,sy,sz,ry} boxes into ONE InstancedMesh.
  function instBoxes(items,material){
    if(!items.length)return null;
    var m=new THREE.InstancedMesh(unitBox,material,items.length);
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

  // ---- island + causeway apron (reads reachable from the west, x~700)
  var island=new THREE.Mesh(new THREE.CylinderGeometry(R,R+7,6,28),mat(0x6a6e64));
  island.position.set(CX,-2.8,CZ); root.add(island);

  var concrete=[];
  concrete.push({x:CW_CX,y:-0.15,z:CZ,sx:CW_X1-CW_X0,sy:1.2,sz:16});          // causeway deck
  concrete.push({x:CW_CX,y:0.75,z:CZ-7.6,sx:CW_X1-CW_X0,sy:0.7,sz:0.5});      // rails
  concrete.push({x:CW_CX,y:0.75,z:CZ+7.6,sx:CW_X1-CW_X0,sy:0.7,sz:0.5});

  // ---- raised octagonal plaza (the arena floor)
  var plaza=new THREE.Mesh(new THREE.CylinderGeometry(70,74,0.9,8),mat(0x84888f));
  plaza.rotation.y=Math.PI/8; plaza.position.set(CX,PY-0.45,CZ); root.add(plaza);
  concrete.push({x:CX-R+12,y:PY-0.6,z:CZ,sx:18,sy:0.6,sz:12});         // entry ramp

  // ---- BOXING RING -------------------------------------------------------
  var plat=new THREE.Mesh(unitBox,mat(0x3a3f4a));
  plat.scale.set(8.6,0.9,8.6); plat.position.set(RX,RY-0.45,RZ); root.add(plat);
  var canvasTop=new THREE.Mesh(unitBox,mat(0xd8d4c4));
  canvasTop.scale.set(8.2,0.08,8.2); canvasTop.position.set(RX,RY+0.02,RZ); root.add(canvasTop);

  var gold=[],white=[],redP=[],blueP=[];
  var cs=[[-4.1,-4.1],[4.1,-4.1],[4.1,4.1],[-4.1,4.1]];
  for(var ci=0;ci<4;ci++){
    gold.push({x:RX+cs[ci][0],y:RY+0.8,z:RZ+cs[ci][1],sx:0.22,sy:1.6,sz:0.22});   // corner posts
    var pad=(ci<2)?redP:blueP;
    pad.push({x:RX+cs[ci][0],y:RY+1.0,z:RZ+cs[ci][1],sx:0.4,sy:0.9,sz:0.4});      // corner pads
  }
  for(var rr=0;rr<3;rr++){                                                        // 3 rope rows
    var ry2=RY+0.55+rr*0.4;
    white.push({x:RX,y:ry2,z:RZ-4.1,sx:8.4,sy:0.06,sz:0.06});
    white.push({x:RX,y:ry2,z:RZ+4.1,sx:8.4,sy:0.06,sz:0.06});
    white.push({x:RX-4.1,y:ry2,z:RZ,sx:0.06,sy:0.06,sz:8.4});
    white.push({x:RX+4.1,y:ry2,z:RZ,sx:0.06,sy:0.06,sz:8.4});
  }
  redP.push({x:RX-5.2,y:PY+0.3,z:RZ-5.2,sx:0.7,sy:0.5,sz:0.7});                   // corner stools
  blueP.push({x:RX+5.2,y:PY+0.3,z:RZ+5.2,sx:0.7,sy:0.5,sz:0.7});
  concrete.push({x:RX,y:PY+0.25,z:RZ+5.4,sx:2.4,sy:0.5,sz:1.6});                  // ring steps

  // ---- MMA CAGE (octagon) ------------------------------------------------
  var cageMat=new THREE.Mesh(new THREE.CylinderGeometry(6.6,6.9,0.5,8),mat(0x30343c));
  cageMat.position.set(CGX,CGY-0.25,CGZ); root.add(cageMat);
  var dark=[],rail=[];
  for(var pi=0;pi<8;pi++){
    var a=pi*Math.PI/4;
    dark.push({x:CGX+Math.cos(a)*6.3,y:CGY+1.3,z:CGZ+Math.sin(a)*6.3,sx:0.25,sy:2.6,sz:0.25}); // posts
    var ma=a+Math.PI/8, pr=6.3*Math.cos(Math.PI/8), pw=2*6.3*Math.sin(Math.PI/8);
    var px2=CGX+Math.cos(ma)*pr, pz2=CGZ+Math.sin(ma)*pr, pry=-ma+Math.PI/2;
    if(pi===4){ // the gate: swung open toward the plaza
      dark.push({x:px2-1.2,y:CGY+1.1,z:pz2,sx:pw*0.9,sy:2.1,sz:0.07,ry:pry+0.85});
    }else{
      dark.push({x:px2,y:CGY+1.1,z:pz2,sx:pw,sy:2.2,sz:0.07,ry:pry});             // chain panels
      rail.push({x:px2,y:CGY+2.25,z:pz2,sx:pw,sy:0.16,sz:0.2,ry:pry});            // padded rail
    }
  }

  // ---- BEAST PIT (sunken sand circle the crowd looks down into) ----------
  var sand=new THREE.Mesh(new THREE.CylinderGeometry(8.6,8.6,0.3,20),mat(0xd8c07a));
  sand.position.set(PX,PITY-0.15,PZ); root.add(sand);
  for(var wi=0;wi<18;wi++){
    var wa=wi*Math.PI*2/18;
    concrete.push({x:PX+Math.cos(wa)*9.2,y:PY+0.55,z:PZ+Math.sin(wa)*9.2,
                   sx:3.3,sy:1.3,sz:0.5,ry:-wa+Math.PI/2});                       // pit wall ring
  }

  // ---- GRANDSTAND: raked seating on 3 sides, fully instanced -------------
  var sides=[{nx:0,nz:1},{nx:0,nz:-1},{nx:1,nz:0}];
  var slabItems=[],seatItems=[],specItems=[];
  for(var si=0;si<sides.length;si++){
    var nx=sides[si].nx,nz=sides[si].nz, tx=nz,tz=-nx, sry=Math.atan2(nx,nz);
    for(var row=0;row<10;row++){
      var dist=80+row*2.3, ry3=PY+0.6+row*0.85;
      slabItems.push({x:CX+nx*dist,y:ry3-0.45,z:CZ+nz*dist,sx:84,sy:0.9,sz:2.3,ry:sry});
      for(var sc=0;sc<24;sc++){
        var off=(sc-11.5)*3.3, sx2=CX+nx*dist+tx*off, sz3=CZ+nz*dist+tz*off;
        seatItems.push({x:sx2,y:ry3+0.35,z:sz3,sx:0.95,sy:0.7,sz:0.85,ry:sry});
        if(rng()<0.55)specItems.push({x:sx2,y:ry3+1.08,z:sz3,sx:0.6,sy:1.0,sz:0.5,ry:sry,c:1});
      }
    }
  }
  instBoxes(slabItems,mat(0x7a7f88));
  instBoxes(seatItems,mat(0xb02030));
  // Spectators are standard city actors fixed to real seat anchors.  The old
  // coloured boxes looked populated but could not react, take damage or drop
  // loot. Keep a representative live cast spread across all three stands and
  // leave every unfilled seat visibly empty.
  (function(){
    if(!CBZ.npcLife||!specItems.length)return;
    var anchors=[],want=Math.min(42,specItems.length),stride=Math.max(1,Math.floor(specItems.length/want));
    for(var i=0;i<specItems.length&&anchors.length<want;i+=stride){
      var it=specItems[i];
      anchors.push({x:it.x,y:it.y-0.38,z:it.z,yaw:(it.ry||0)+Math.PI,pose:"sit",state:"sit"});
    }
    var entries=anchors.map(function(a){return {
      profile:"venueSpectator",placement:{anchor:a,rng:rng},overrides:{job:"fight fan"},
      configure:function(p){p._venueRole="arena-spectator";}
    };});
    if(CBZ.npcLife.definePopulation)CBZ.npcLife.definePopulation("arena-audience",{root:root,entries:entries});
  })();

  // ---- floodlight masts + heads (instanced) -------------------------------
  var heads=[];
  for(var fi=0;fi<4;fi++){
    var fa=Math.PI/4+fi*Math.PI/2;
    var fx=CX+Math.cos(fa)*62, fz=CZ+Math.sin(fa)*62;
    dark.push({x:fx,y:PY+13,z:fz,sx:0.9,sy:26,sz:0.9});
    heads.push({x:fx,y:PY+26.4,z:fz,sx:4.6,sy:1.8,sz:1.8,ry:-fa+Math.PI/2});
  }
  // sign posts
  dark.push({x:CX-R+4,y:PY+7,z:CZ-6,sx:0.7,sy:14,sz:0.7});
  dark.push({x:CX-R+4,y:PY+7,z:CZ+6,sx:0.7,sy:14,sz:0.7});

  instBoxes(concrete,mat(0x9094a0));
  instBoxes(gold,mat(0xd8a020));
  instBoxes(white,mat(0xeeeeee));
  instBoxes(redP,mat(0xaa2233));
  instBoxes(blueP,mat(0x2244aa));
  instBoxes(dark,mat(0x22262c));
  instBoxes(rail,mat(0x992222));
  (function(){ // bright heads: cheap emissive-look basic material
    var hm=new THREE.MeshBasicMaterial({color:0xfff6cc});
    var m=new THREE.InstancedMesh(unitBox,hm,heads.length);
    var M=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler(),
        p=new THREE.Vector3(),s=new THREE.Vector3();
    for(var i=0;i<heads.length;i++){
      var it=heads[i]; e.set(0,it.ry||0,0); q.setFromEuler(e);
      p.set(it.x,it.y,it.z); s.set(it.sx,it.sy,it.sz);
      M.compose(p,q,s); m.setMatrixAt(i,M);
    }
    m.instanceMatrix.needsUpdate=true; root.add(m);
  })();
  var lamp=new THREE.PointLight(0xffedc0,0.9,320,1);
  lamp.position.set(CX,PY+32,CZ); root.add(lamp);

  // ---- "IRONJAW ARENA" sign (single canvas-textured quad) -----------------
  if(typeof document!=="undefined"){
    try{
      var cv=document.createElement("canvas"); cv.width=1024; cv.height=192;
      var cx2=cv.getContext("2d");
      if(cx2){
        cx2.fillStyle="#0c0f14"; cx2.fillRect(0,0,1024,192);
        cx2.strokeStyle="#e0a020"; cx2.lineWidth=10; cx2.strokeRect(10,10,1004,172);
        cx2.fillStyle="#ffd24a"; cx2.font="bold 104px Arial";
        cx2.textAlign="center"; cx2.textBaseline="middle";
        cx2.fillText("IRONJAW ARENA",512,100);
        var tex=new THREE.CanvasTexture(cv);
        var sign=new THREE.Mesh(new THREE.PlaneGeometry(28,5.3),
          new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide}));
        sign.position.set(CX-R+4,PY+15.2,CZ); sign.rotation.y=-Math.PI/2;
        root.add(sign);
      }
    }catch(e){}
  }

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
  if(nearRing)note("Next bout — RED "+bout.red.name+" @"+bout.oddsRed.toFixed(2)+
    " vs BLUE "+bout.blue.name+" @"+bout.oddsBlue.toFixed(2)+"  [E] ringside to bet",6);
}
function clampRing(p){
  p.x=Math.min(RX+3.2,Math.max(RX-3.2,p.x));
  p.z=Math.min(RZ+3.2,Math.max(RZ-3.2,p.z));
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
    if(nearRing){
      var w=(b.winner==="red")?b.red:b.blue;
      note("DOWN! "+w.name+" drops "+D.name+" — the ref is counting...",3,{urgent:true});
    }
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
  var cx=box?RX:CGX, cz=box?RZ:CGZ, cy=box?RY:CGY, rad=box?3.1:5.2;
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
  if(CBZ.player&&CBZ.player.pos)CBZ.player.pos.set(cx-rad*0.7,CBZ.player.pos.y,cz);
  var purse=purseFor(c,card,box);
  pfight={opp:opp,card:card,box:!!box,purse:purse,cx:cx,cz:cz,cy:cy,rad:rad,t:0,
    oppHp:100*(0.75+card.skill*0.8),oppHpMax:100*(0.75+card.skill*0.8),
    myHp:60,pcd:0.6,ocd:1.4,over:0,won:false,name:card.name};
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
}
function clampCage(p){
  var f=pfight, cx=f?f.cx:CGX, cz=f?f.cz:CGZ, cy=f?f.cy:CGY, r=f?f.rad:5.2;
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
    note("You KO "+f.name+"! Purse +"+money(f.purse)+".",5,{urgent:true});
    recordWin(f.card,f.box,true,war,f.purse);
    f.won=true; f.over=4;
  }else if(f.myHp<=0||(CBZ.player&&CBZ.player.dead)){
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
function clampPitXZ(p){
  var dx=p.x-PX,dz=p.z-PZ,d=Math.hypot(dx,dz);
  if(d>7.4){p.x=PX+dx/d*7.4;p.z=PZ+dz/d*7.4;}
}
function startWildPit(){
  if(pitBout){ note("A pit bout is already running — watch the rail.",3); return; }
  if(!arenaRoot){ return; }
  var pool=speciesPool();
  if(pool.length<2){ note("No beasts in the holding pens tonight.",3); return; }
  var i1=(Math.random()*pool.length)|0, i2=(Math.random()*pool.length)|0;
  if(i2===i1)i2=(i2+1)%pool.length;
  var A=spawnBeast(pool[i1],PX-4.5,PZ), B=spawnBeast(pool[i2],PX+4.5,PZ);
  if(!A||!B){ if(A)arenaRoot.remove(A.group); if(B)arenaRoot.remove(B.group);
    note("The beasts refused the pit.",3); return; }
  pitBout={a:A,b:B,kind:"wild",done:false,over:0};
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
  var wild=spawnBeast(pool[(Math.random()*pool.length)|0],PX+4.5,PZ);
  if(!wild){ note("No wild challenger available.",3); return; }
  pet.group.position.set(PX-4.5,PITY,PZ);
  // shadow actor: the bout never permanently harms your pet
  var wrap={group:pet.group,pos:pet.group.position,hp:140,maxHp:140,dead:false,
    species:pet.species||"beast",isPet:true};
  pitBout={a:wrap,b:wild,kind:"pet",done:false,over:0};
  note("Your "+prettySpecies(wrap.species)+" steps into the pit! Purse "+money(600)+".",4,{urgent:true});
}
function finishPit(w,l){
  var P=pitBout; if(!P||P.done)return;
  P.done=true; P.over=5;
  l.dead=true; l.hp=0;
  if(!l.isPet&&l.group)l.group.rotation.z=1.35; // spawned loser keels over
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
if(CBZ.interactions&&typeof CBZ.interactions.registerZone==="function"){
  CBZ.interactions.registerZone({
    id:"arena_ring", kind:"arena_ring", prio:4,
    find:function(px,pz){ return Math.hypot(px-RX,pz-RZ)<13?{x:RX,z:RZ}:null; },
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
    find:function(px,pz){ return Math.hypot(px-CGX,pz-CGZ)<11?{x:CGX,z:CGZ}:null; },
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
    find:function(px,pz){ return Math.hypot(px-PX,pz-PZ)<14?{x:PX,z:PZ}:null; },
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
  // ring bout: only simulate while the player can actually see it (~90u) and
  // the ring isn't handed over to the player's own boxing match.
  nearRing=Math.hypot(pp.x-RX,pp.z-RZ)<90;
  if(nearRing&&!ringSuspended){
    if(!bout)newBout();
    tickRing(dt);
  }
  // player cage bout: only exists after [I] at the cage
  if(pfight)tickCage(dt,pp);
  // pit bout: only exists after [J]/[I] at the pit; frozen if you wander far
  if(pitBout&&Math.hypot(pp.x-PX,pp.z-PZ)<110)tickPit(dt);
});

})();
