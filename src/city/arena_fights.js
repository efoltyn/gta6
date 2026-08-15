// ============================================================================
// arena_fights.js — IRONJAW ARENA: a real, walk-in fight complex.
//
// WHY THIS EXISTS: fighting used to live only in a hidden betting menu — a
// feature you couldn't SEE. This puts it physically on the map, mirroring how
// the speedway island works: a landmass you can DRIVE or WALK to, with
// on-map interaction prompts. (This line used to say "drive/boat/walk" and
// two thirds of it were false: there was no road record and there is no water
// within 220 m of this place. Driving is real now — see THE SITE below. There
// is no boat and there must not be one; a pier on dry land is a lie.)
// It has a boxing ring with a LIVE, self-running
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
// ARENA_CROWD_EVENT — occupancy follows whether an event is actually running:
// FULL and loud on a live card, a handful of staff and stragglers otherwise.
// (arena_venue.js self-defaults the same flag; this is the driving half.)
if(CFG.ARENA_CROWD_EVENT==null)CFG.ARENA_CROWD_EVENT=true;
// ARENA_CROWD_PANIC — a seated spectator can get OUT of the seat and run.
// OFF → the old behaviour where a body in a chair is stuck in it forever.
if(CFG.ARENA_CROWD_PANIC==null)CFG.ARENA_CROWD_PANIC=true;
// ARENA_SITE — THE ARRIVAL. OWNER: "the fight arena is not very intentional
// feeling right now." The BUILDING was finished (a 20-tier bowl, a concourse,
// a roof) and the SITE was never built at all: the header three lines above
// promises a landmass "you can drive/boat/walk to" and only WALK was ever
// true, there was no perimeter, no gate, no parking, no keep-out over the
// beast pit, and the entire ~30 m ring of flat paved apron between the facade
// and the island edge held nothing whatsoever. This flag owns all of it —
// the drivable causeway and its road record, the perimeter fence, the gate,
// the monument, the car park, the site lamps, the service yard and the people
// who work the front door. Off → the pre-fix walk-in island, exactly as it
// shipped.
if(CFG.ARENA_SITE==null)CFG.ARENA_SITE=true;
// ARENA_OVERFLOW_LOT — the big car park out on the causeway approach, on the
// strip between the Mercy highway and the island. It is the only ground within
// reach that can hold one (see THE CAR PARK below for the arithmetic), and it
// is the one part of this site that claims land the file has never surveyed —
// so it self-tests against every region and lot already claimed and refuses to
// build rather than overwrite. Off → the island's own bays and nothing else.
if(CFG.ARENA_OVERFLOW_LOT==null)CFG.ARENA_OVERFLOW_LOT=true;
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
// THE FLOOR IS AN ARENA FLOOR, NOT A PITCH. These three used to sit 32/32/54
// from centre, which forced arena_venue.js's bowl to wrap a 102 x 130 m floor —
// and a bowl that far from the action is exactly why the owner read the stands
// as "super super short" no matter how many rows they had. The venue floor is
// now 52 x 70 and the surfaces are pulled in to match it. Every clamp, prompt
// and sim radius below is derived, so nothing else had to move.
// THE ENSEMBLE IS CENTRED ON THE BOWL, AND THE PIT IS THE CENTREPIECE.
// OWNER: "make sure the fighting pit is actually centered in the arena, it
// ain't rn." It was not, and neither was anything else: ring at x-13, cage at
// x+13 and pit at z+21 put the three surfaces in an L, with the pit 21 m north
// of the focal point the jumbotron, the four spotlights and the bowl's own
// `focus` all aim at, and 21 m of dead floor to the south. From a seat the
// house looked built for a room that wasn't there.
//
// The re-lay is arithmetic, not taste. The bowl floor is a rounded rectangle:
// half-extents 26 (x) by 35 (z) — the long axis is z, and it is the ONLY axis
// with room for three surfaces, because on x the pit's 9.6 outer wall plus two
// 4.8/6.9 half-spans plus walkways needs 44 m against 52 available and the
// two ends would touch the bowl front. So:
//   • the pit sits ON the centre — it is the biggest surface, it is what the
//     grand west tunnel now opens onto at 16 m, and it is under the screen;
//   • the ring and the cage sit at ±FIGHT_SPAN on z, symmetric about it.
// FIGHT_SPAN is solved from the parts, not chosen: the pit's outer wall is
// PIT_WALL_R + coping = 9.6, the ring's walk-up stair reaches RING_APRON + 2.3
// = 7.1 back toward it and the cage's base disc reaches CAGE_MAT_R + 0.3 = 6.9,
// so 21 leaves a 4.3 m walkway on the ring side and 4.5 m on the cage side, and
// still keeps 8.4 / 6.4 m of floor beyond each of them before the bowl front at
// 34.3. The ring's rope gap and stair already face +z and the cage's door faces
// -x, so both still open onto open floor with no geometry change.
var FIGHT_SPAN=21;
var RX=CX, RZ=CZ-FIGHT_SPAN, RY=PY+0.9;    // boxing ring centre + canvas height
var CGX=CX, CGZ=CZ+FIGHT_SPAN, CGY=PY+0.5; // MMA cage centre + mat height
var PX=CX, PZ=CZ, PITY=PY+0.02;            // beast pit centre + sand height

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
// Prompt zones: the venue footprint plus a standing-room margin — and now that
// the three surfaces are in a row, those margins are what PARTITION the floor
// between them. RING_ZONE + PIT_ZONE and CAGE_ZONE + PIT_ZONE both equal
// FIGHT_SPAN, so each boundary falls exactly on the midpoint of its walkway and
// no point on the floor can ever offer two different fights on the SAME KEY.
// (The old margins summed to 27 against a 24.7 separation, so a 2.3 m band
// already answered [J] with the boxing match or a beast bout depending on
// registration order — at 21 m apart those numbers would have made that band
// 6 m wide. This is the bug the re-lay would have caused if the radii had been
// left alone, which is exactly why they were derived from the span.)
var PIT_ZONE    = PIT_WALL_R + 2.4;          // 11.6 — 2.4 m of rail to stand at
var RING_ZONE   = FIGHT_SPAN - PIT_ZONE;     // 9.4  — RING_APRON + 4.6
var CAGE_ZONE   = FIGHT_SPAN - PIT_ZONE;     // 9.4  — CAGE_MAT_R + 2.8, past its ramp
// Simulation gating: a bout must keep running while ANY spectator seat can see
// it, so the radius is (offset of the surface from the venue centre) + the
// furthest walkable point of the bowl. Grow the bowl and these grow with it.
var VENUE_REACH = 118;
var RING_SIM    = Math.hypot(RX-CX,RZ-CZ)+VENUE_REACH+8;   // ~158
var PIT_SIM     = Math.hypot(PX-CX,PZ-CZ)+VENUE_REACH+8;   // ~180

// ============================================================== THE SITE
// VEHICLE ACCESS IS HONEST HERE, AND THAT WAS CHECKED, NOT ASSUMED. The file
// header calls this an island reachable by "drive/boat/walk"; none of those
// three words survives contact with the map. (a) There is NO WATER anywhere
// near it — the coastline at z = -950 runs at x ~ +/-260 (city/continent.js's
// bay ring) and everything east of that is dry backcountry, so the "island" is
// a 120 m concrete disc standing on land and a BOAT ARRIVAL WOULD BE A LIE.
// (b) The Mercy Causeway — a real 24 m, 3+3, divided concrete highway
// (city/biome_snow.js) — runs north-south at x = 470 and its EAST KERB IS
// x = 482, which is exactly where CW_X0, the arena causeway's west end, already
// sat. The two decks have been butt-jointed for the venue's whole life with no
// road record between them, which is why no car has ever driven here and why
// roadPick, roadSegmentAt, the junction pass and the utility/lamp walk have all
// been blind to the approach. So the causeway becomes a REAL ROAD: one record
// from the highway centreline to inside the venue's own region (the
// destination rule in roadrules.js covers the venue end; the Mercy Causeway and
// Ironjaw Causeway regions are CONNECTORS by name and are exempt by
// construction), plus a short ramp so the 0.40 deck meets the highway at grade.
// KNOWN, NOT FIXED, AND NOT OURS: biome_snow.js flanks the Mercy deck with two
// 2.2 m x 0.6 m snow berms running its whole length, and the east one (x
// 482.1..484.3) crosses the mouth of this junction 0.2 m proud of our 0.40 deck.
// It is a visual mesh with no collider. The one-line fix is a z-gap in that
// berm at the junction and it belongs in biome_snow.js.
var ROAD_X0=470;                     // Mercy Causeway centreline (the T-junction)
var ROAD_X1=CX-98;                   // stops 22 m inside the venue region (a dock)
var RAMP_X0=477.5;                   // where the deck lifts off the highway
var SITE_INSET=3.5;                  // how far inside the walkable apron the site sits
var APRON_FALLBACK=[[30,107],[60,94],[82,75],[98,53],[107,30]];
var FACE_FALLBACK={x:76.7,z:85.7};   // recomputed from venue.metrics when present
// ---- WHAT A REAL ARENA KEEPS CLEAR, AND WHY THESE ARE THE NUMBERS ----------
// The ground beside a building this tall is not a matter of taste; IFC Appendix
// D governs it, and it is the only hard dimension in the whole site program:
//   D105.1  a building over 9.14 m tall needs AERIAL apparatus access. This
//           bowl is ~26 m to the parapet, so it qualifies with 17 m to spare.
//   D105.2  that lane is 7.92 m of UNOBSTRUCTED width.
//   D105.3  and it sits NOT LESS THAN 4.57 m and NOT MORE THAN 9.14 m from the
//           building face, running parallel to at least one entire side.
//   503.2.1 every other approach road is 6.1 m minimum.
// FIRE_STANDOFF is therefore the line nothing may cross toward the wall, and it
// is what every clearance below is measured against — the fence, the car park,
// the masts, the planters and the service yard. The site had NO such rule: the
// perimeter came within 2.3 m of a 26 m wall and the car park's north-east
// stall within 1.9 m, both by accident rather than by any decision.
var FIRE_STANDOFF=4.6;               // IFC D105.3 minimum, rounded up
var FIRE_LANE=7.92;                  // IFC D105.2 aerial lane width
var FACE_CLEAR=FIRE_STANDOFF;        // nothing stands closer to the wall than this
// Real 90-degree surface-parking geometry (ULI, Dimensions of Parking): a
// standard stall is 2.74 x 5.49 m and a two-way aisle is 7.32 m, so a
// double-loaded module is 18.30 m and an efficient lot lands near 30 m2 a
// space. The shipped bays were 2.7 x 5.2 on a 6.3 aisle — a compact-car lot
// pretending to be a standard one.
var STALL_W=2.74, STALL_D=5.49, AISLE_W=7.32;

var arenaRoot=null, venue=null;
// The bowl owns its own structural graph in arena_venue.js. This file keeps a
// second ledger for the visible fight surfaces it authors, then arenaSupportAudit
// combines both owners. Without this ledger a green arena audit only proved the
// stands — the ring, cage and pit were never inspected at all.
var fightRealityData=null, fightSupportCache=null;
var siteInfo=null;                   // {fencePanels, gates, bays, keepouts, park:[…]}
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

// ======================================================= THE HOUSE (OCCUPANCY)
// OWNER: "THE STADIUM IS BARELY FILLED AND NOTHING IS EVER ACTUALLY HAPPENING —
// IT SHOULD BE FULL WHEN ACTIVE AND NEARLY EMPTY WHEN NOT. IT'S LIKE 10 PERCENT
// FULL." He is describing a bowl whose occupancy was decided ONCE at world
// build and never moved, which reads broken in both directions: it was never a
// crowd and it was never abandoned.
//
// Occupancy now has exactly one input, EVENT.active, and two outputs:
//   • the INSTANCED crowd (arena_venue.crowdFill) — thousands of bodies for
//     THREE draw calls at any fill, so "full" is free;
//   • the LIVE RIG count — the only number that actually costs GPU (a full rig
//     is ~16 draw calls), so it stays small and sits in the seats you can walk
//     up to. That split IS the performance answer: distant spectators are
//     instanced, near ones are real, and nothing in between exists.
var arenaRootRef=null, seatSlotsRef=[], audienceN=-1;
var EVENT={active:false, kind:"dark", name:"", t:0, init:false};
var LIVE_ON=28, LIVE_OFF=4;
var FILL_ON=0.94, FILL_OFF=0.035;      // a packed house vs. staff and stragglers
// a private stream: the audience is re-cast at RUNTIME (people arrive and go
// home), so it must never touch a shared build-time rng.
var _as=0x5EA7; function arng(){_as=(_as*1103515245+12345)&0x7fffffff;return _as/0x7fffffff;}

function attendingLine(){
  return EVENT.kind==="box"?"the boxing":EVENT.kind==="mma"?"the cage":
         EVENT.kind==="pit"?"the beast pit":"the fights";
}

// WHO IS IN THAT SEAT. OWNER: "'FIGHT FAN' AS ROLE OF NPCS — THAT'S NOT AN NPC
// ROLE." Right, and it is the same bug as npclife's "passenger": the person is
// a cashier, a mechanic, a dock worker WHO CAME TO A FIGHT TONIGHT. So the
// activity word is stripped off `job` (the field that renders the pill), the
// CASTER deals them a trade that already has a workplace, a shift and a wage in
// aigoals.js, and what they are doing here goes on CBZ.citySetAttending — a
// separate field the dossier may print and the overhead pill never sees.
var staffCut=0;
var STAFF_JOBS=["usher","ticket seller","venue worker","security guard","bartender"];
function configureSpectator(p,i){
  if(!p)return;
  p._venueRole="arena-spectator";
  p.job=null; p.archetype="resident"; p._role=null; p._work=null; p._castFit=null;
  if(i<staffCut){
    // THE PEOPLE WHO ARE HERE WHEN NOBODY ELSE IS. A dark arena is not empty —
    // it has staff, and "usher"/"venue worker" are real trades in level.js's
    // vocabulary, so their pill reads a job and not an activity.
    p.job=STAFF_JOBS[i%STAFF_JOBS.length]; p.archetype="worker";
    if(CBZ.citySetAttending)CBZ.citySetAttending(p,"working the house","Ironjaw Arena");
  }else{
    if(CBZ.cityDealRole){ try{ CBZ.cityDealRole(p); }catch(e){} }
    if(CBZ.citySetAttending)CBZ.citySetAttending(p,attendingLine(),"Ironjaw Arena");
  }
  // NEVER LET THE PLAYER SEE A SPAWN. npclife's attach() deliberately forces an
  // anchored rig visible (a cabin draft claims far bodies), which is right for
  // a plane and wrong for a seat six metres from your face. Re-arm peds.js's
  // OWN spawn-hide latch: the body simulates, and the ordinary LOD pass reveals
  // it on a later frame once the shared transition gate says it is unseen.
  if(CBZ.npcTransitionSafe&&p.pos&&
     !CBZ.npcTransitionSafe(p.pos.x,p.pos.z,{minDistance:14,maxDistance:150})){
    if(p.group){ p._spawnHidden=true; p.group.visible=false; arenaSpawnBlocked++; }
    else arenaSpawnSeen++;              // could not hide it — a real violation
  }
}
var arenaSpawnBlocked=0, arenaSpawnSeen=0;

function setAudience(n,force){
  if(!arenaRootRef||!CBZ.npcLife||!CBZ.npcLife.definePopulation)return;
  n=Math.max(0,Math.min(seatSlotsRef.length,n|0));
  if(n===audienceN&&!force)return;
  audienceN=n;
  staffCut=Math.min(n,EVENT.active?3:n);   // dark house = all staff
  var entries=[];
  for(var i=0;i<n;i++){
    var a=seatSlotsRef[i];
    entries.push({
      profile:"venueSpectator",
      // cushionH/floorBelow are what npclife's attach() forwards into
      // ch.seatRef, which is what makes entities/character.js run its V2
      // feet-on-the-floor chair solve instead of the balled-up legacy squat.
      placement:{anchor:{x:a.x,y:a.y,z:a.z,yaw:a.yaw,pose:"sit",state:"sit",
                         cushionH:a.cushionH,floorBelow:a.floorBelow},rng:arng},
      overrides:{job:null,archetype:"resident"},
      configure:configureSpectator
    });
  }
  CBZ.npcLife.definePopulation("arena-audience",{root:arenaRootRef,entries:entries});
}

// IS THERE A CARD ON TONIGHT? Deterministic per in-game day (so a seed's
// calendar is the same for every client), plus anything the PLAYER started.
function cardTonight(){
  var day=(typeof CBZ.dayCount==="function")?(CBZ.dayCount()|0):0;
  return CBZ.hash01?(CBZ.hash01(day*37.1,day*11.7,0xF1)<0.58):true;
}
function eventNow(){
  if(pfight)return pfight.box?"box":"mma";
  if(pitBout)return "pit";
  var night=(CBZ.nightAmount==null?0:CBZ.nightAmount);
  return (night>0.34&&cardTonight())?"card":null;
}

// ================================================================ THE VENUE
CBZ.addLandmass(function(city){
  fightRealityData=null; fightSupportCache=null;
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
  // AN OCTAGON IS NOT EIGHT BOXES, AND A PIT WALL IS NOT TWENTY.
  // This used to hand physics.js the BOUNDING BOX of each rotated panel. On
  // the beast pit that is a 0.6 m wall registered as a 2.1 m square on the
  // diagonal quadrants — you could touch the wall due north and were held
  // 1.9 m off it due north-east, which is what made a round pit feel like a
  // box. The panel is now registered with the same yaw the mesh is drawn at.
  // HALF-extents, matching CBZ.orientedCollider and CBZ.venueSite's o.solidYaw
  // — one convention for rotated boxes, so a panel cannot be registered at
  // twice or half the size it is drawn at by whoever calls it next.
  function solidYaw(cx2,cz2,hw,hd,yaw,y0,y1){
    if(!SOLID)return null;
    if(!CBZ.orientedCollider){          // degrade: the old bounding box
      var c=Math.abs(Math.cos(yaw)),s=Math.abs(Math.sin(yaw));
      var ax=hw*c+hd*s, az=hw*s+hd*c;
      return solid(cx2-ax,cz2-az,cx2+ax,cz2+az,y0,y1);
    }
    var rec=CBZ.orientedCollider(cx2,cz2,hw,hd,yaw,y0,y1);
    if(rec.yaw&&CBZ.orientedSlack){ yawSlack+=CBZ.orientedSlack(hw,hd,yaw); yawOriented++; }
    (CBZ.colliders=CBZ.colliders||[]).push(rec); return rec;
  }
  var yawOriented=0, yawSlack=0;
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
  var fightRealityExtras=[];
  var realityPools={
    concrete:concrete,gold:gold,white:white,red:redP,blue:blueP,
    dark:dark,rail:rail,steel:steel,sandbits:sandBits
  };
  function realityMark(){
    var out={};
    for(var k in realityPools)out[k]=realityPools[k].length;
    return out;
  }
  function realityTagSince(mark,scope){
    for(var k in realityPools){
      var items=realityPools[k],from=mark[k]||0;
      for(var i=from;i<items.length;i++)items[i]._arenaRealityKind=scope+"-"+k;
    }
  }
  function realityExtra(kind,it){
    fightRealityExtras.push({kind:kind,it:it});
    return it;
  }
  concrete.push({x:CW_CX,y:CW_Y-0.6,z:CZ,sx:CW_X1-CW_X0,sy:1.2,sz:16});             // causeway deck
  concrete.push({x:CW_CX,y:CW_Y+0.35,z:CZ-7.6,sx:CW_X1-CW_X0,sy:0.7,sz:0.5});       // rails
  concrete.push({x:CW_CX,y:CW_Y+0.35,z:CZ+7.6,sx:CW_X1-CW_X0,sy:0.7,sz:0.5});
  plat(CW_X0,CZ-7.4,CW_X1-6,CZ+7.4,CW_Y);                                           // walk the causeway
  solid(CW_X0,CZ-8.1,CW_X1,CZ-7.1,CW_Y,CW_Y+0.7);
  solid(CW_X0,CZ+7.1,CW_X1,CZ+8.1,CW_Y,CW_Y+0.7);
  // approach ramp: causeway deck (CW_Y) up onto the arena apron (PY)
  concrete.push({x:CW_X1+3,y:(CW_Y+PY)/2-0.5,z:CZ,sx:14,sy:1.1,sz:15,rz:0.05});
  plat(CW_X1-6,CZ-7.4,CW_X1+8,CZ+7.4,PY,{axis:"x",x0:CW_X1-6,x1:CW_X1+8,y0:CW_Y,y1:PY});
  // WEST TRANSITION — the deck used to simply STOP at x = 482 with a 0.40 lip
  // against the Mercy highway (the header comment above called it "a 0.40 step
  // off the water road"; the thing west of it is not water, it is a six-lane
  // road). A road meets a road at grade, so a 4.5 m wedge takes the deck down
  // to the highway surface and a ramp platform makes the physics agree with it.
  if(CFG.ARENA_SITE){
    concrete.push({x:(RAMP_X0+CW_X0)/2,y:CW_Y/2-0.28,z:CZ,sx:CW_X0-RAMP_X0,sy:0.62,sz:16,
                   rz:Math.atan2(CW_Y,CW_X0-RAMP_X0)});
    plat(RAMP_X0,CZ-7.4,CW_X0+0.6,CZ+7.4,CW_Y,{axis:"x",x0:RAMP_X0,x1:CW_X0+0.6,y0:0,y1:CW_Y});
    // kerbs either side of the throat, so the junction has an edge
    dark.push({x:(RAMP_X0+CW_X0)/2,y:CW_Y*0.5,z:CZ-8.1,sx:CW_X0-RAMP_X0,sy:0.34,sz:0.6});
    dark.push({x:(RAMP_X0+CW_X0)/2,y:CW_Y*0.5,z:CZ+8.1,sx:CW_X0-RAMP_X0,sy:0.34,sz:0.6});
  }

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
      // Ringside chairs, and BOTH radii are the surface's own furniture, not a
      // taste. The ring's walk-up stair reaches RING_APRON + 2.3 = 7.1, so the
      // first band starts past it at 7.6 and the second (9.1) still stops 2.3 m
      // short of the pit's 9.6 wall. The cage carries its step-up ramp out to
      // CAGE_MAT_R + 2.4 = 9.0 on its -x face, so its band starts at 9.4 — and
      // it gets ONE band, because a second at 10.9 would put a chair 0.5 m from
      // the pit rail on the -z side. (The old 7.0 put a chair ON the ring stair;
      // its comment claimed the opposite.)
      floorSeatRings:[
        {x:RX,z:RZ,r0:7.6,rings:2},
        {x:CGX,z:CGZ,r0:9.4,rings:1}
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
  var ringRealityMark=realityMark();
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
    realityExtra("ring-canvas",{
      x:RX,y:RY+0.03,z:RZ,
      sx:RING_APRON*2-0.3,sy:0.09,sz:RING_APRON*2-0.3
    });
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
  realityTagSince(ringRealityMark,"ring");

  // =========================================================== MMA CAGE ====
  // Octagon mat + branded floor disc + 8 posts + chain-link fence (ONE merged
  // alpha-tested quad batch, not solid boxes) + padded top rail + a real gate.
  var cageRealityMark=realityMark();
  (function(){
    var cageBase=new THREE.Mesh(new THREE.CylinderGeometry(CAGE_MAT_R,CAGE_MAT_R+0.3,CGY-PY,8),mat(0x30343c));
    cageBase.rotation.y=Math.PI/8;
    cageBase.position.set(CGX,(PY+CGY)/2,CGZ);
    cageBase.userData.arenaCageBase=true; root.add(cageBase);
    realityExtra("cage-base",{
      x:CGX,y:(PY+CGY)/2,z:CGZ,
      sx:(CAGE_MAT_R+0.3)*2,sy:CGY-PY,sz:(CAGE_MAT_R+0.3)*2
    });
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
        realityExtra("cage-mat",{
          x:CGX,y:CGY+0.02,z:CGZ,
          sx:(CAGE_MAT_R-0.25)*2,sy:0.04,sz:(CAGE_MAT_R-0.25)*2
        });
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
        realityExtra("cage-gate-fence",{
          x:mx-1.1,y:CGY+FENCE_H/2,z:mz,
          sx:pw*0.9,sy:FENCE_H,sz:0.04,ry:yaw+0.85
        });
        rail.push({x:mx-1.1,y:CGY+FENCE_H+0.06,z:mz,sx:pw*0.92,sy:0.16,sz:0.2,ry:yaw+0.85});
      }else{
        if(chainQ)chainQ.add(mx,CGY+FENCE_H/2,mz,pw,FENCE_H,yaw,0,0,pw/0.34,FENCE_H/0.34);
        realityExtra("cage-fence",{
          x:mx,y:CGY+FENCE_H/2,z:mz,
          sx:pw,sy:FENCE_H,sz:0.04,ry:yaw
        });
        rail.push({x:mx,y:CGY+FENCE_H+0.06,z:mz,sx:pw,sy:0.18,sz:0.22,ry:yaw});    // padded top rail
        steel.push({x:mx,y:CGY+0.06,z:mz,sx:pw,sy:0.12,sz:0.14,ry:yaw});           // kick plate
        solidYaw(mx,mz,pw/2,0.14,yaw,CGY,CGY+FENCE_H);                               // you cannot walk through it
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
  realityTagSince(cageRealityMark,"cage");

  // ============================================================ BEAST PIT ==
  // A walled sand circle the crowd looks down into over a padded rail.
  var pitRealityMark=realityMark();
  (function(){
    var sand=new THREE.Mesh(new THREE.CylinderGeometry(PIT_SAND_R,PIT_SAND_R,0.28,24),mat(0xd8c07a));
    sand.position.set(PX,PITY-0.12,PZ);
    sand.receiveShadow=true; sand.userData.arenaPitSand=true; root.add(sand);
    realityExtra("pit-sand",{
      x:PX,y:PITY-0.12,z:PZ,
      sx:PIT_SAND_R*2,sy:0.28,sz:PIT_SAND_R*2
    });
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
      solidYaw(wx,wz,seg/2,0.3,wyaw,PY,PY+WH+1.05);
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
  realityTagSince(pitRealityMark,"pit");

  // ============================================================== THE SITE ==
  // The arrival sequence, built OUTWARD from the building on ground that was
  // already there. arena_venue.js flattens and paves a disc of radius 112 and
  // registers a walkable platform staircase over it, while the bowl's facade
  // only reaches 76.7 (x) / 85.7 (z) — so there is a 26-35 m deep paved ring
  // all the way around the venue, terrain-gated, colliderless and completely
  // empty. Everything below stands on THAT ring; not one new square metre of
  // terrain work is done, and every extent is READ OFF venue.metrics (faceX /
  // faceZ / apron) rather than re-typed, so re-tiering the bowl moves the
  // fence, the gate and the car park with it.
  (function(){
    if(!CFG.ARENA_SITE)return;
    var VS=CBZ.venueSite;
    var M=(venue&&venue.metrics)||null;
    siteInfo={fencePanels:0,gates:0,bays:0,keepouts:0,park:[],
              faceClear:0,fenceVerts:0,onSiteBays:0,overflowBays:0};

    // ---- 0. KEEP-OUTS come first because they are the one part that does not
    //         depend on the building existing. A wandering civilian has no
    //         business standing in the beast pit, in the ring or on the cage
    //         mat, and until now nothing said so: registerNoSpawnZone had
    //         never been called from this file. They are `civ`, so posted
    //         staff, fighters and the referee are unaffected — and a `civ`
    //         zone is reported apart from a hard perimeter by
    //         roadClearanceAudit, which is right: this bars people, not roads.
    if(typeof CBZ.registerNoSpawnZone==="function"){
      var ko=[[RX,RZ,RING_APRON+1.4,"ironjaw-ring"],
              [CGX,CGZ,CAGE_MAT_R+1.4,"ironjaw-cage"],
              [PX,PZ,PIT_WALL_R+1.4,"ironjaw-pit"]];
      for(var ki=0;ki<ko.length;ki++){
        CBZ.registerNoSpawnZone(city,{cx:ko[ki][0],cz:ko[ki][1],r:ko[ki][2],
          civ:true,label:ko[ki][3]});
        siteInfo.keepouts++;
      }
    }
    // THE RING ONLY EXISTS IF THE BOWL DID. arena_venue.js is what paves the
    // 112 m apron and registers the platform staircase this whole site stands
    // on; with ARENA_VENUE_V2 off the fallback is a 70 m octagon plaza, and a
    // perimeter at 103.5 would hang in the air. Degrade to the keep-outs.
    if(!M)return;
    var APRON=M.apron||APRON_FALLBACK;
    var FACE_X=M.faceX||FACE_FALLBACK.x;
    var MARQ=M.marqueeX||(FACE_X+9);

    // ---- THE BUILDING'S OWN FOOTPRINT, WHICH THIS FILE HAD NEVER ASKED FOR --
    // The bowl is not a circle and it is not a box: arena_venue.js builds every
    // ring of it as a rounded rectangle — a core rect of half-extents coreA x
    // coreB, offset outward by a distance. So "how far is this point from the
    // building" is the distance to that CORE RECT, and "how wide is the building
    // at this z" is the same relation solved for x. Both are three lines, both
    // read published metrics, and NEITHER EXISTED: the site imported faceX for
    // one service-yard offset, declared a faceZ fallback it never used once, and
    // laid its entire perimeter without ever testing a vertex against the thing
    // it was supposed to be ringing.
    var CORE_A=M.coreA!=null?M.coreA:15, CORE_B=M.coreB!=null?M.coreB:24;
    // the OUTER envelope, not the wall plane — fins and canopy stand proud of it
    var FACE_D=M.faceEnvD!=null?M.faceEnvD:((M.faceD!=null?M.faceD:61.7)+0.5);
    function coreDist(x,z){
      var dx=Math.max(0,Math.abs(x-CX)-CORE_A), dz=Math.max(0,Math.abs(z-CZ)-CORE_B);
      return Math.sqrt(dx*dx+dz*dz);
    }
    function faceClear(x,z){ return coreDist(x,z)-FACE_D; }
    // half-width of the building envelope at this z (0 where it does not reach)
    function faceHalfX(z,pad){
      var r=FACE_D+(pad||0), dz=Math.abs(z-CZ)-CORE_B;
      if(dz<0)dz=0;
      if(dz>=r)return 0;
      return CORE_A+Math.sqrt(r*r-dz*dz);
    }

    // THE RING IS A STAIRCASE, NOT A CIRCLE, AND IT NOW ANSWERS TO TWO EDGES.
    // The apron's walkable platforms are a stack of rectangles, so a perimeter
    // drawn as a circle would leave a third of itself hanging over a 0.9 m drop
    // onto the island top: the path walks the same bands the platforms were
    // registered from, inset one body-width.
    //
    // THE FAULT THE OWNER SAW: that was the ONLY edge it walked. The apron
    // staircase is an approximation of a DISC and the bowl is a rounded
    // rectangle 9 m longer in z than in x with 62 m corner arcs, so the two
    // shapes cross: where the old five-band staircase stepped from |x|=71.5 to
    // |x|=49.5 at |z|=78.5, the building's own corner arc was still 55.2 out —
    // the perimeter dived INSIDE the facade's shadow and ran 2.3 m from a 26 m
    // wall, with the fence's collider AABBs 0.16 m either side of it. Nothing in
    // the build had ever measured it, so nothing failed.
    //
    // The cure is in two places and the order matters. arena_venue.js's apron is
    // now a 13-band inscription instead of a 5-band one, which is what gives the
    // ring somewhere to BE (the pinch was a real conflict: at a step corner the
    // deck edge and the wall are the same constraint from opposite sides, and no
    // amount of moving the fence could have satisfied both). This function then
    // enforces the standoff BY CONSTRUCTION rather than by luck: a run that
    // would stand inside FACE_CLEAR of the envelope is pushed back out, trading
    // the comfort inset down to a 0.6 m lip margin before it gives up — and what
    // it actually achieves is measured and published, never assumed.
    // The band table, solved ONCE and then shared: the fence walks it and
    // everything that must stay inside the fence asks it. Each run at
    // half-width hx[i] spans |z| from zz[i-1] to zz[i], and the facade is
    // WIDEST at the smallest |z| in that span — so that is the binding test.
    var FHX=[],FZZ=[];
    (function(){
      var i,n=APRON.length,zLo,need;
      for(i=0;i<n;i++){ FHX.push(APRON[i][1]-SITE_INSET); FZZ.push(APRON[i][0]-SITE_INSET); }
      for(i=0;i<n;i++){
        zLo=(i===0)?0:FZZ[i-1];
        need=faceHalfX(CZ+zLo,FACE_CLEAR);
        // give up comfort before safety: never past the platform's own lip
        if(need>FHX[i])FHX[i]=Math.min(need,APRON[i][1]-0.6);
      }
    })();
    // how far out anything may stand at this z and still be inside the
    // perimeter (0 = past the walkable apron entirely, i.e. refuse)
    function fenceHalf(z){
      var i,az=Math.abs(z-CZ);
      for(i=0;i<FZZ.length;i++)if(az<=FZZ[i])return FHX[i];
      return 0;
    }
    function ringPath(){
      var i,p=[],hx=FHX,zz=FZZ,n=FHX.length;
      p.push({x:CX+hx[0],z:CZ-zz[0]});
      for(i=0;i<n-1;i++){ p.push({x:CX+hx[i],z:CZ+zz[i]}); p.push({x:CX+hx[i+1],z:CZ+zz[i]}); }
      p.push({x:CX+hx[n-1],z:CZ+zz[n-1]});
      p.push({x:CX-hx[n-1],z:CZ+zz[n-1]});                       // north cap
      for(i=n-1;i>=1;i--){ p.push({x:CX-hx[i],z:CZ+zz[i-1]}); p.push({x:CX-hx[i-1],z:CZ+zz[i-1]}); }
      p.push({x:CX-hx[0],z:CZ-zz[0]});
      for(i=0;i<n-1;i++){ p.push({x:CX-hx[i],z:CZ-zz[i]}); p.push({x:CX-hx[i+1],z:CZ-zz[i]}); }
      p.push({x:CX-hx[n-1],z:CZ-zz[n-1]});
      p.push({x:CX+hx[n-1],z:CZ-zz[n-1]});                       // south cap
      for(i=n-1;i>=1;i--){ p.push({x:CX+hx[i],z:CZ-zz[i-1]}); p.push({x:CX+hx[i-1],z:CZ-zz[i-1]}); }
      return p;
    }
    var RING_X=APRON[0][1]-SITE_INSET;      // 103.5 — the west/east faces
    var GATE_X=CX-RING_X, SVC_X=CX+RING_X;

    // ---- 1. the perimeter, and the TWO places you cross it -----------------
    // MEASURED, NOT ASSUMED. Every segment is sampled against the building
    // envelope and the worst clearance in the whole loop is published on the
    // census, so a re-tiered bowl that pushes the facade back into the fence
    // shows up as a NUMBER instead of as a screenshot. Build-time only: 78
    // vertices at 8 samples is a few hundred hypots, once.
    var sitePath=ringPath();
    (function(){
      var worst=1e9,i,t,a,b,x,z,c;
      for(i=0;i<sitePath.length;i++){
        a=sitePath[i]; b=sitePath[(i+1)%sitePath.length];
        for(t=0;t<=8;t++){
          x=a.x+(b.x-a.x)*t/8; z=a.z+(b.z-a.z)*t/8;
          c=faceClear(x,z); if(c<worst)worst=c;
        }
      }
      siteInfo.faceClear=+worst.toFixed(2);
      siteInfo.fenceVerts=sitePath.length;
    })();
    if(VS&&VS.fence){
      var fr=VS.fence({
        root:root, name:"ironjaw-perimeter", path:sitePath, closed:true,
        y:PY, h:2.6, pitch:4.0, colliderPitch:12, solid:solid, solidYaw:solidYaw,
        post:0x39404a, fabric:0xa8b0ba,
        gaps:[{x:GATE_X,z:CZ,half:11},{x:SVC_X,z:CZ,half:7}]
      });
      if(fr)siteInfo.fencePanels=fr.panels;
    }
    // ---- 2. the gate. It stands 1.5 m past the top of the causeway ramp, so
    //         you come up the ramp and the venue BEGINS. -------------------
    var gate=null;
    if(VS&&VS.gatehouse){
      gate=VS.gatehouse({
        root:root, x:GATE_X, z:CZ, y:PY, yaw:-Math.PI/2, half:8, h:5.4,
        booth:true, arms:true, arch:true, title:"Ironjaw Arena",
        bg:0x0c0f14, fg:0xffd24a, conc:0x8b9199, solid:solid, name:"ironjaw-gate"
      });
      if(gate)siteInfo.gates=1;
      // the service gate at the BACK: piers only, no booth, no beam. A back of
      // house that looks like a front of house is what makes a venue read fake.
      VS.gatehouse({root:root,x:SVC_X,z:CZ,y:PY,yaw:Math.PI/2,half:5,h:4.2,
        arch:false,booth:false,arms:false,conc:0x7c8189,solid:solid,name:"ironjaw-service-gate"});
    }
    // ---- 3. the sign you read at the JUNCTION, not at the door -------------
    if(VS&&VS.monument){
      // 22 m south of the road centreline: the board is 20 m long and it runs
      // ALONG z at this yaw, so anything closer would stand in the causeway.
      VS.monument({root:root,x:490,z:CZ-22,y:0,yaw:-Math.PI/2,
        w:18,h:4.8,lift:1.6,title:"Ironjaw Arena",
        sub:"Boxing · MMA · The Beast Pit",bg:0x0c0f14,fg:0xffd24a,accent:0xd8a020,
        solid:solid,name:"ironjaw-monument"});
    }
    // ---- 3b. THE FIRE LANE, which is the reason the rest of this ring is
    //          empty. A building over 9.14 m tall owes IFC D105 an AERIAL
    //          apparatus road: 7.92 m of unobstructed width, standing off the
    //          wall by at least 4.57 m, running parallel to at least one whole
    //          side. This bowl is 26 m tall and had NOTHING — which is exactly
    //          why the perimeter, the car park and the planters were all free
    //          to creep up to the wall. Drawing the lane makes the rule
    //          VISIBLE: everything above and below now stands outside it
    //          because there is a road there, not because a comment said so.
    //
    //          It is drawn as the building is built — a rounded rectangle
    //          walked at a fixed offset from the same core rect — so it can
    //          never drift from the facade it rings. Two instanced pools it
    //          already flushes, no new draw call.
    function ringWalk(d,pitch,cb){
      var i,n,step,a,k,side;
      // four straights along the core rect's faces
      var st=[[1,0,CORE_A+d,-CORE_B,CORE_B],[0,1,CORE_B+d,CORE_A,-CORE_A],
              [-1,0,-CORE_A-d,CORE_B,-CORE_B],[0,-1,-CORE_B-d,-CORE_A,CORE_A]];
      for(side=0;side<4;side++){
        var nx=st[side][0],nz=st[side][1],fix=st[side][2],a0=st[side][3],a1=st[side][4];
        n=Math.max(1,Math.round(Math.abs(a1-a0)/pitch)); step=(a1-a0)/n;
        for(i=0;i<n;i++){
          k=a0+step*(i+0.5);
          cb(CX+(nx?fix:k),CZ+(nx?k:fix),Math.atan2(nx,nz),Math.abs(step));
        }
        // the corner arc that follows this straight
        var ox=CX+((side===0||side===3)?CORE_A:-CORE_A);
        var oz=CZ+((side===0||side===1)?CORE_B:-CORE_B);
        var a2=side*Math.PI/2; n=Math.max(2,Math.round(d*(Math.PI/2)/pitch));
        step=(Math.PI/2)/n;
        for(i=0;i<n;i++){
          a=a2+step*(i+0.5);
          cb(ox+Math.cos(a)*d,oz+Math.sin(a)*d,Math.atan2(Math.cos(a),Math.sin(a)),d*step);
        }
      }
    }
    // The ring is the GENERAL access road (IFC 503.2.1, 6.1 m) all the way
    // round, because that is what fits at the poles; the mandated AERIAL width
    // is added as a hardstanding widening on the EAST straight, which is where
    // a fire crew would actually set up — the loading docks, the yard and the
    // service gate are all on that side, and it is the only side arena_venue.js
    // has not already filled with a marquee and two ticket booths.
    var RING_IN=FACE_D+1.0, RING_W=6.1, RING_D=RING_IN+RING_W/2;
    ringWalk(RING_D,5.0,function(lx,lz,lyaw,llen){
      // the loading dock stands in the road here, which is what a dock IS —
      // the carriageway breaks for it and the aerial apron outboard carries on.
      if(lx>CX+CORE_A&&Math.abs(lz-CZ)<7.0)return;
      dark.push({x:lx,y:PY+0.03,z:lz,sx:llen+0.06,sy:0.06,sz:RING_W,ry:lyaw});
      white.push({x:lx,y:PY+0.065,z:lz,sx:llen*0.62,sy:0.03,sz:0.14,ry:lyaw});   // edge line
    });
    ringWalk(RING_IN+RING_W+0.35,7.0,function(lx,lz,lyaw,llen){
      dark.push({x:lx,y:PY+0.09,z:lz,sx:llen+0.06,sy:0.18,sz:0.3,ry:lyaw});      // outer kerb
    });
    // the aerial widening: from the ring's outer edge out to the far side of
    // the 7.92 m band, so the whole 4.6 -> 12.52 zone D105.3 asks for is one
    // unobstructed hardstanding. Everything the yard puts down now starts past
    // its outer edge.
    var AER_IN=CORE_A+RING_IN+RING_W, AER_OUT=CORE_A+FACE_D+FIRE_STANDOFF+FIRE_LANE;
    dark.push({x:CX+(AER_IN+AER_OUT)/2,y:PY+0.03,z:CZ,
               sx:AER_OUT-AER_IN,sy:0.06,sz:CORE_B*2+8});
    for(var fl=-1;fl<=1;fl+=2){
      white.push({x:CX+(AER_IN+AER_OUT)/2,y:PY+0.065,z:CZ+fl*(CORE_B+3.6),
                  sx:AER_OUT-AER_IN-1.2,sy:0.03,sz:0.14});
    }

    // ---- 4. THE CAR PARK, and its size is the GROUND's answer, not a wish —
    //         but the answer is now MEASURED, and it is brutal. Real planning
    //         ratios put a standalone arena at one space per 3.5-4 seats (Wells
    //         Fargo Center: ~21,000 seats, 6,000+ spaces); this bowl seats
    //         twenty-odd thousand, so code parking is ~5,500 spaces, and an
    //         efficient 90-degree lot needs ~30 m2 each — SIXTEEN HECTARES. The
    //         island is under four and the building eats 2.3 of them. There is
    //         no arrangement of this land that parks an arena crowd, and the
    //         old lot's 16 bays were not a design decision, they were what was
    //         left after nobody measured anything.
    //
    //         So the site does what a tight-site arena really does (Chase
    //         Center parks 950 cars for 18,000 seats and the city absorbs the
    //         rest): the ISLAND keeps the two blocks that genuinely fit — the
    //         north and south poles, the only ground where the building's arc
    //         has pulled away and the ring road is behind you — and the volume
    //         goes to an overflow lot out on the approach, below.
    //
    //         Both blocks are solved, not placed: the row sits one module
    //         (STALL_D + AISLE_W = 12.81) inside the perimeter, starting where
    //         the ring road's outer kerb ends, and its width is the narrowest
    //         the fence gets across that module. Real ULI dimensions throughout
    //         — the shipped 2.7 x 5.2 on a 6.3 aisle was a compact-car lot
    //         wearing a standard lot's name.
    //         The stall ROW is deliberately the inboard half and the aisle the
    //         outboard one: the deck tapers hard at the poles, so putting the
    //         stalls where the fence is still 52 m out buys 31 bays a side
    //         where the other way round buys 11.
    var lots=[];
    if(VS&&VS.bays){
      for(var pv=-1;pv<=1;pv+=2){
        var zIn=CZ+pv*(CORE_B+RING_IN+RING_W+0.3);   // just past the ring's kerb
        var zOut=zIn+pv*STALL_D;
        var half=Math.min(fenceHalf(zIn),fenceHalf(zOut))-1.0;
        var cols=Math.max(0,Math.floor(half*2/STALL_W));
        if(cols<4)continue;
        var bx0=CX-cols*STALL_W/2;
        var blk=VS.bays({x0:bx0,z0:Math.min(zIn,zOut),cols:cols,rows:1,
                         stallW:STALL_W,stallD:STALL_D,aisle:AISLE_W});
        if(!blk)continue;
        blk.x0=bx0; blk.zIn=zIn;
        // nose INBOARD, toward the venue — you walk out of the car at the arena
        for(var fz=0;fz<blk.slots.length;fz++)blk.slots[fz].heading=(pv<0)?0:Math.PI;
        lots.push(blk);
      }
    }
    for(var li=0;li<lots.length;li++){
      var lot=lots[li],st,si2;
      siteInfo.onSiteBays+=lot.slots.length;
      for(si2=0;si2<lot.slots.length;si2++)siteInfo.park.push(lot.slots[si2]);
      for(si2=0;si2<lot.stripes.length;si2++){
        st=lot.stripes[si2];
        white.push({x:st.x,y:PY+0.015,z:(st.z0+st.z1)/2,sx:0.12,sy:0.03,sz:st.z1-st.z0});
      }
      dark.push({x:lot.x0+lot.w/2,y:PY+0.02,z:lot.zIn,sx:lot.w+1.4,sy:0.16,sz:0.3});
      // ACCESSIBLE BAYS ARE A DIMENSION, NOT A BLUE RECTANGLE. The ADA pull-up
      // is 2.44 x 6.1 with a 1.52 m access aisle running its FULL length (US
      // Access Board ch.5) — the aisle is the bay's whole point, so it gets
      // painted, on the pair nearest the venue's own axis.
      var mid=(lot.slots.length/2)|0;
      for(var ab=mid-1;ab<=mid;ab++){
        if(ab<0||ab>=lot.slots.length)continue;
        blueP.push({x:lot.slots[ab].x,y:PY+0.018,z:lot.slots[ab].z,
                    sx:STALL_W-0.24,sy:0.03,sz:STALL_D-0.3});
      }
      if(mid<lot.slots.length){
        white.push({x:lot.slots[mid].x+STALL_W/2,y:PY+0.02,z:lot.slots[mid].z,
                    sx:0.1,sy:0.03,sz:STALL_D-0.2});
      }
    }
    // ---- 4b. THE OVERFLOW LOT — the parking that could not be on the island.
    //          OWNER: huge parking lots. The arithmetic above says the island
    //          cannot hold one, and the real world agrees: an arena's lot is
    //          never under the arena, it is out on the approach. This is that
    //          lot, and the approach is the only land it can use — the 32 m
    //          strip between the Mercy Causeway's east kerb (x 484.3, where
    //          biome_snow.js's berm ends) and the island's own edge at CX - R.
    //
    //          Real 90-degree geometry throughout: 2.74 x 5.49 stalls on a 7.32
    //          two-way aisle, so a double-loaded module is 18.30 m and the lot
    //          measures 31.2 m2 a space — inside ULI's 28-32 band for an
    //          efficient surface lot. Two blocks, one either side of the
    //          causeway, each four modules deep: 176 bays. With the island's own
    //          52 that is 228 against the 16 that shipped, and it is STILL only
    //          about one space per 90 seats. That is not a failure of this lot,
    //          it is what a 120 m island costs you — the same trade Chase Center
    //          made at 950 spaces for 18,000 seats.
    //
    //          IT REFUSES RATHER THAN OVERWRITES. The strip is backcountry this
    //          file has never surveyed, so each block is tested against every
    //          region and lot the world has already claimed and simply is not
    //          built if the ground is taken — the govcomplex.js rule. What it
    //          does build, it makes honest: terrainFlattenUnder declares it as
    //          built ground (that call can only ever LOWER relief, so no biome
    //          gate can move the wrong way) and a platform record makes the
    //          drawn slab the surface you actually stand on.
    if(CFG.ARENA_OVERFLOW_LOT&&VS&&VS.bays){
      var OV_X0=487.0, OV_COLS=11, OV_ROWS=8;
      var OV_W=OV_COLS*STALL_W;                        // 30.14
      var OV_GAP=13.0;                                 // clear of the causeway deck
      var OV_D=(OV_ROWS/2)*(STALL_D*2+AISLE_W);        // 4 modules = 73.2
      var landFree=function(a0,a1,b0,b1){
        var i,r,hx,hz,rr=(city&&city.regions)||[],lt=(city&&city.lots)||[];
        for(i=0;i<rr.length;i++){
          r=rr[i]; if(!r||r.minX==null)continue;
          if(r.maxX<a0||r.minX>a1||r.maxZ<b0||r.minZ>b1)continue;
          return false;
        }
        for(i=0;i<lt.length;i++){
          r=lt[i]; if(!r||r.x==null)continue;
          hx=(r.w!=null?r.w:(r.width||0))/2+2; hz=(r.d!=null?r.d:(r.depth||0))/2+2;
          if(r.x+hx<a0||r.x-hx>a1||r.z+hz<b0||r.z-hz>b1)continue;
          return false;
        }
        return true;
      };
      for(var ov=-1;ov<=1;ov+=2){
        var oz0=(ov<0)?(CZ-OV_GAP-OV_D):(CZ+OV_GAP);
        if(!landFree(OV_X0-3,OV_X0+OV_W+3,oz0-3,oz0+OV_D+3))continue;
        var ob=VS.bays({x0:OV_X0,z0:oz0,cols:OV_COLS,rows:OV_ROWS,
                        stallW:STALL_W,stallD:STALL_D,aisle:AISLE_W});
        if(!ob)continue;
        // The ground first, then the paint. The slab is flush with the
        // causeway deck AND runs right up to its kerb (CZ +/- 7.0, inside the
        // deck platform's own 7.4) — a lot you cannot drive into off the road
        // it sits beside is a texture, and a 3 m strip of unplatformed grass
        // between them is the same fall-through this whole change is about.
        var zNear=CZ+ov*7.0, zFar=oz0+((ov<0)?-2.5:(OV_D+2.5));
        var zLo=Math.min(zNear,zFar), zHi=Math.max(zNear,zFar);
        concrete.push({x:OV_X0+OV_W/2,y:CW_Y-0.5,z:(zLo+zHi)/2,
                       sx:OV_W+5.0,sy:1.0,sz:zHi-zLo});
        plat(OV_X0-2.5,zLo,OV_X0+OV_W+2.5,zHi,CW_Y);
        if(CBZ.terrainFlattenUnder){
          CBZ.terrainFlattenUnder({name:"Ironjaw overflow lot",
            minX:OV_X0-4,maxX:OV_X0+OV_W+4,minZ:zLo-2,maxZ:zHi+2});
        }
        var os;
        for(os=0;os<ob.stripes.length;os++){
          var ost=ob.stripes[os];
          white.push({x:ost.x,y:CW_Y+0.015,z:(ost.z0+ost.z1)/2,
                      sx:0.12,sy:0.03,sz:ost.z1-ost.z0});
        }
        for(os=0;os<ob.slots.length;os++){ ob.slots[os].y=CW_Y; siteInfo.park.push(ob.slots[os]); }
        siteInfo.overflowBays+=ob.slots.length;
        // kerbs on the two long edges, and a low fence line facing the road so
        // the lot has an EDGE instead of fading into the grass
        dark.push({x:OV_X0-2.2,y:CW_Y+0.02,z:(zLo+zHi)/2,sx:0.35,sy:0.18,sz:zHi-zLo});
        dark.push({x:OV_X0+OV_W+2.2,y:CW_Y+0.02,z:(zLo+zHi)/2,sx:0.35,sy:0.18,sz:zHi-zLo});
        dark.push({x:OV_X0+OV_W/2,y:CW_Y+0.02,z:(ov<0)?zLo:zHi,
                   sx:OV_W+5.0,sy:0.18,sz:0.35});
        if(VS.lampRow){
          var olp=[],ol;
          for(ol=0;ol<5;ol++){
            olp.push({x:OV_X0-1.4,z:oz0+OV_D*(ol+0.5)/5,fx:1,fz:0});
            olp.push({x:OV_X0+OV_W+1.4,z:oz0+OV_D*(ol+0.5)/5,fx:-1,fz:0});
          }
          VS.lampRow({root:root,pts:olp,y:CW_Y,poleH:8.2,reach:2.4,rise:0.34,
                      poleR:0.14,solid:solid});
        }
      }
    }
    siteInfo.bays=siteInfo.onSiteBays+siteInfo.overflowBays;
    // ---- 5. lamps: down the causeway, across the forecourt, over the lot ---
    if(VS&&VS.lampRow){
      var lp=[],i2;
      for(i2=0;i2<5;i2++){                                  // the causeway deck
        var lxc=CW_X0+8+i2*8;
        lp.push({x:lxc,z:CZ-7.0,fx:0,fz:1});
        lp.push({x:lxc,z:CZ+7.0,fx:0,fz:-1});
      }
      VS.lampRow({root:root,pts:lp,y:CW_Y,poleH:5.6,reach:1.9,rise:0.30,poleR:0.11,solid:solid});
      lp=[];
      for(i2=-1;i2<=1;i2+=2){                               // the forecourt
        lp.push({x:CX-96,z:CZ+i2*11,fx:0,fz:-i2});
        lp.push({x:CX-86.5,z:CZ+i2*11,fx:0,fz:-i2});
      }
      lp.push({x:CX-96,z:CZ+24,fx:0,fz:-1});
      // Over the pole lots: on the INBOARD kerb only. Never in the aisle —
      // that is where the cars turn — and never on the row's own outboard
      // edge, which is where the noses are.
      for(var lk=0;lk<lots.length;lk++){
        var lkl=lots[lk], face=(lkl.zIn>CZ)?1:-1;
        for(i2=0;i2<4;i2++){
          lp.push({x:lkl.x0+lkl.w*(i2+0.5)/4,z:lkl.zIn-face*1.6,fx:0,fz:face});
        }
      }
      VS.lampRow({root:root,pts:lp,y:PY,poleH:6.4,reach:2.1,rise:0.32,poleR:0.12,solid:solid});
    }
    // ---- 6. banner masts on the forecourt (the venue's colours, standing up)
    for(var bm=0;bm<6;bm++){
      var bz=CZ-27+bm*10.8, bx=CX-94;
      if(Math.abs(bz-CZ)<9){continue;}                     // keep the entry axis clear
      steel.push({x:bx,y:PY+4.6,z:bz,sx:0.16,sy:9.2,sz:0.16});
      gold.push({x:bx,y:PY+9.3,z:bz,sx:0.34,sy:0.34,sz:0.34});
      (CBZ.hash01(bx,bz,0x1A)<0.5?redP:blueP).push(
        {x:bx+0.55,y:PY+7.0,z:bz,sx:1.05,sy:3.4,sz:0.06});
      solid(bx-0.2,bz-0.2,bx+0.2,bz+0.2,PY,PY+2.2);
    }
    // ---- 7. stalls on the north forecourt, benches, planters --------------
    function stall(sx2,sz2,face,tone){
      dark.push({x:sx2,y:PY+1.35,z:sz2,sx:3.6,sy:2.7,sz:2.4});        // kiosk body
      (tone?redP:blueP).push({x:sx2,y:PY+2.85,z:sz2,sx:4.4,sy:0.22,sz:3.4}); // awning
      steel.push({x:sx2,y:PY+2.0,z:sz2+face*1.35,sx:3.0,sy:0.12,sz:0.5});    // counter
      white.push({x:sx2,y:PY+2.62,z:sz2+face*1.7,sx:3.4,sy:0.5,sz:0.08});    // menu board
      solid(sx2-1.9,sz2-1.3,sx2+1.9,sz2+1.3,PY,PY+2.8);
      // the vendor stands BEHIND the counter, facing the customer side
      return {x:sx2,z:sz2+face*0.85,face:face>0?0:Math.PI};
    }
    var merch=stall(CX-95,CZ+16,1,true);
    var food =stall(CX-95,CZ+25,1,false);
    if(CBZ.furnish){
      // benches face the entry axis; the boxes go into THIS file's root and
      // this file's collider ledger, never materials.js's global scene.
      var furnBox=function(fx,fy,fz,fw,fh,fd,fc,fo){
        fo=fo||{};
        var mo=(fo.emissive!=null)?{emissive:fo.emissive,ei:fo.ei!=null?fo.ei:0.5}:null;
        var mm=new THREE.Mesh(new THREE.BoxGeometry(fw,fh,fd),mat(fc,mo));
        mm.position.set(fx,fy,fz); mm.castShadow=!!fo.cast; mm.receiveShadow=true;
        // deliberately NO userData: these are plain static scenery, so
        // core/batch.js is allowed to fold all of them into the city merge
        // (a bench is ~5 boxes and 4 benches spared would be 20 draw calls).
        root.add(mm);
        if(fo.solid)solid(fx-fw/2,fz-fd/2,fx+fw/2,fz+fd/2,fo.y0,fo.y1);
        return mm;
      };
      // The north forecourt is the one part of the ring the car park does NOT
      // want, so it gets the seating: four benches facing back down the entry
      // axis, between the stalls and the facade.
      for(var bi=0;bi<4;bi++){
        var byz=CZ+13+bi*8;
        try{ CBZ.furnish.bench(CX-86,PY,byz,Math.PI,
          {box:furnBox,solid:true,len:2.2,tone:{wood:0x6b5a42,frame:0x3a3f47}}); }catch(e){}
      }
    }
    // planters, in a straight run down the forecourt's west edge — inside the
    // 107-unit apron band, so every one of them stands on real platform
    var PLANT=[-22,-14,14,22,29];
    for(var pl2=0;pl2<PLANT.length;pl2++){
      var px2=CX-97, pz2=CZ+PLANT[pl2];
      concrete.push({x:px2,y:PY+0.35,z:pz2,sx:2.2,sy:0.7,sz:2.2});
      dark.push({x:px2,y:PY+0.76,z:pz2,sx:1.9,sy:0.16,sz:1.9});
      solid(px2-1.1,pz2-1.1,px2+1.1,pz2+1.1,PY,PY+0.7);
    }
    // ---- 8. THE BACK OF HOUSE. A venue whose every side looks like the front
    //         has no front. The east ring gets what an arena's east ring has:
    //         skips, stillages, a loading dock and nobody's idea of a plaza. --
    (function serviceYard(){
      // OUTBOARD OF THE FIRE LANE, and that is what moved it. The yard used to
      // start at FACE_X + 9, i.e. 9 m off a 26 m wall, which put its skips and
      // its slab squarely inside the aerial-apparatus zone the building is owed
      // — the one strip on the whole site that has to stay unobstructed. It now
      // begins where that hardstanding ends and stops 1.5 m short of the
      // perimeter, so back-of-house occupies exactly the band left over.
      var yx=CX+AER_OUT+2.5, yOut=CX+fenceHalf(CZ)-1.5;
      concrete.push({x:(yx-2.5+yOut)/2,y:PY+0.06,z:CZ,
                     sx:yOut-yx+2.5,sy:0.12,sz:30});                   // yard slab
      for(var d2=0;d2<5;d2++){
        var dz2=CZ-13+d2*6.5;
        dark.push({x:yx,y:PY+0.9,z:dz2,sx:2.2,sy:1.8,sz:4.4});         // skip
        steel.push({x:yx,y:PY+1.85,z:dz2,sx:2.4,sy:0.14,sz:4.6});      // lid
        solid(yx-1.2,dz2-2.3,yx+1.2,dz2+2.3,PY,PY+1.9);
      }
      for(var cr=0;cr<7;cr++){
        var cx2=yx+4+(cr%3)*2.4, cz2=CZ-9+Math.floor(cr/3)*7.5;
        var ch2=0.9+CBZ.hash01(cx2,cz2,0x2B)*0.7;
        concrete.push({x:cx2,y:PY+ch2/2,z:cz2,sx:1.8,sy:ch2,sz:1.8,
                       ry:CBZ.hash01(cx2,cz2,0x2C)*0.5-0.25});
        solid(cx2-1.0,cz2-1.0,cx2+1.0,cz2+1.0,PY,PY+ch2);
      }
      // Loading dock: a raised platform OUTSIDE the facade with a roller door
      // on it. It has to stand clear of CX+FACE_X — that is the facade's OUTER
      // face and the concourse begins 2 units behind it, so a dock authored
      // inward would be a truck bay inside the building.
      concrete.push({x:CX+FACE_X+2.4,y:PY+0.6,z:CZ,sx:4.4,sy:1.2,sz:9});
      plat(CX+FACE_X+0.2,CZ-4.5,CX+FACE_X+4.6,CZ+4.5,PY+1.2);
      // A 1.2 m dock is well over physics.js's 0.45 STEP_UP, so it needs steps
      // or it is a platform nothing can reach. Three treads at 0.4 each — and
      // they climb INWARD, alongside the dock, instead of marching east out of
      // the standoff and into the fire lane where they used to end up.
      for(var tr=0;tr<3;tr++){
        var ty=PY+0.4*(tr+1), tx2=CX+FACE_X+2.6-tr*0.9;
        concrete.push({x:tx2,y:ty-0.2,z:CZ+5.6,sx:0.9,sy:0.4,sz:2.6});
        plat(tx2-0.45,CZ+4.3,tx2+0.45,CZ+6.9,ty);
      }
      steel.push({x:CX+FACE_X+0.15,y:PY+2.9,z:CZ,sx:0.3,sy:3.4,sz:6.4});
      dark.push({x:CX+FACE_X+0.6,y:PY+4.75,z:CZ,sx:1.4,sy:0.4,sz:7.2});
    })();
    // ---- 9. queue switchbacks feeding arena_venue.js's ticket booths -------
    // The booths are at CX - MARQ + 2.5 and their rails now run OUTWARD (see
    // arena_venue.js); this adds the cross-runs that turn two straight rails
    // into a queue, on the gate side where the people arriving actually are.
    for(var qs=0;qs<3;qs++){
      var qx2=CX-MARQ-4.4-qs*4.8;
      steel.push({x:qx2,y:PY+0.55,z:CZ-3.1,sx:0.09,sy:1.1,sz:0.09});
      steel.push({x:qx2,y:PY+0.55,z:CZ+3.1,sx:0.09,sy:1.1,sz:0.09});
      gold.push({x:qx2,y:PY+1.0,z:CZ-4.65,sx:0.07,sy:0.07,sz:3.1});
      gold.push({x:qx2,y:PY+1.0,z:CZ+4.65,sx:0.07,sy:0.07,sz:3.1});
    }
    // ---- 10. the people who work the front door ---------------------------
    if(CBZ.cityStaffVenue&&CBZ.cityStaffPost){
      var posts=[];
      if(gate&&gate.boothAt){
        posts.push({id:"ironjaw:gate",job:"security guard",archetype:"security",
          x:gate.boothAt.x,z:gate.boothAt.z,face:gate.boothAt.face,
          opts:{wealth:0.3,aggr:0.2,floorY:PY}});
      }
      // AT the booths arena_venue.js already drew, not near them: the booth
      // bodies are at mx + 2.5 (its own marquee solve), so the clerk stands on
      // the plaza side of the window.
      for(var tb2=-1;tb2<=1;tb2+=2){
        posts.push({id:"ironjaw:tickets:"+(tb2>0?"n":"s"),job:"ticket seller",
          archetype:"worker",x:CX-MARQ+2.5,z:CZ+tb2*13.5,
          face:-Math.PI/2,pose:"table",           // facing the queue, out at -x
          opts:{wealth:0.32,aggr:0.05,floorY:PY}});
      }
      posts.push({id:"ironjaw:merch",job:"street vendor",archetype:"merchant",
        x:merch.x,z:merch.z,face:merch.face,pose:"table",
        opts:{wealth:0.4,aggr:0.05,floorY:PY}});
      posts.push({id:"ironjaw:food",job:"street vendor",archetype:"merchant",
        x:food.x,z:food.z,face:food.face,pose:"table",
        opts:{wealth:0.36,aggr:0.05,floorY:PY}});
      for(var lq=0;lq<lots.length;lq++){
        // at the lot MOUTH — the inboard kerb, where the ring road feeds it —
        // rather than standing in the middle of somebody's stall.
        var lql=lots[lq], lqf=(lql.zIn>CZ)?1:-1;
        posts.push({id:"ironjaw:park:"+(lqf>0?"n":"s"),job:"security guard",
          archetype:"worker",x:lql.x0+lql.w+2.4,z:lql.zIn-lqf*2.2,
          face:lqf>0?Math.PI:0,opts:{wealth:0.24,aggr:0.06,floorY:PY}});
      }
      CBZ.cityStaffVenue("ironjaw",{stations:posts.length,
        note:"gate booth, 2 ticket windows, merch + food stalls, car park"});
      for(var pi2=0;pi2<posts.length;pi2++){
        posts[pi2].venue="ironjaw";
        try{ CBZ.cityStaffPost(posts[pi2]); }catch(e){}
      }
    }
  })();

  // Snapshot the authored transforms before the pools are flushed. Only items
  // tagged by the three surface blocks above participate; arrival/site props
  // have a separate ownership problem and cannot hide a disconnected ring part
  // by touching it accidentally. The bowl's declared floor is the physical
  // anchor all three surfaces stand on; read its dimensions from the building
  // owner so a future resize cannot leave this audit checking the old room.
  var realityFloorX=(venue&&venue.metrics&&venue.metrics.floorX)||52;
  var realityFloorZ=(venue&&venue.metrics&&venue.metrics.floorZ)||70;
  fightRealityData={
    pools:realityPools,
    extras:fightRealityExtras,
    surfaces:[{
      minX:CX-realityFloorX/2,maxX:CX+realityFloorX/2,
      minZ:CZ-realityFloorZ/2,maxZ:CZ+realityFloorZ/2,top:PY
    }]
  };

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
  // proxy crowd (arena_venue.js) fills every seat these don't. The population
  // is now RE-DEFINED whenever the house flips between "card on" and "dark" —
  // see setAudience() below — so an empty arena really is empty.
  arenaRootRef=root;
  seatSlotsRef=(venue&&venue.seatSlots)||[];
  setAudience(0, true);

  // ---- the live seats join the SHARED seat kit -----------------------------
  // Only the live slots (tens, not the twenty thousand): CBZ.propSeats is a
  // linear registry and stuffing a whole bowl into it would tax every
  // propSeatNpc/propSeatsIn query in the game for no gain. These few DECLARE
  // their geometry, so they can only push propUseAudit().noGeom's ratio down,
  // and `requireEntry` means an anchor nothing can walk to is refused outright
  // rather than added to propUseAudit().blocked.
  if(CBZ.propRegisterSeat){
    for(var qi=0;qi<seatSlotsRef.length;qi++){
      var qa=seatSlotsRef[qi];
      try{
        CBZ.propRegisterSeat(qa.x,qa.y-(qa.floorBelow||0),qa.z,qa.yaw,"seat",null,
          {cushion:qa.cushionH!=null?qa.cushionH:0.45,floorBelow:0,requireEntry:true});
      }catch(e){}
    }
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
  // games/boxing.js anchors SOUTHPAW PALACE by finding /Ironjaw Arena/i in
  // city.regions — the name is a compatibility contract, do not rename it.
  if(typeof CBZ.registerCityRegion==="function"){
    CBZ.registerCityRegion(city,{name:"Ironjaw Arena",subtitle:"Fight Complex",biome:"arena",
      kind:"circle",cx:CX,cz:CZ,r:R,pad:6});
    CBZ.registerCityRegion(city,{name:"Ironjaw Causeway",subtitle:"Arena Approach",biome:"arena",
      kind:"rect",minX:RAMP_X0,maxX:CW_X1,minZ:CZ-10,maxZ:CZ+10,cx:CW_CX,cz:CZ,pad:4});
  }

  // ---- the approach becomes a ROAD ----------------------------------------
  // ONE record, and it buys everything a record buys in this codebase: ambient
  // traffic through roadPick, a DERIVED T-junction with the Mercy Causeway
  // (roadrules.js pairs a vertical and a horizontal record that overlap — the
  // highway spans x 458..482 and this starts at its centreline, so the
  // junction, its kerb returns and its stop bars are drawn for free by
  // props.js), a posted limit, and the utility/lamp walk that only ever
  // followed roads. It is legal by construction under the roads-connect-places
  // law: its far end sits inside the venue's OWN region, which is the
  // destination rule, and both causeway regions are CONNECTORS by name.
  if(CFG.ARENA_SITE&&city.roads){
    // ONE lane each way with a WIDE median, and both numbers are load-bearing
    // rather than taste: CBZ.roadLanes puts lane 0 at medianHalf + laneW/2, so
    // a 3.6 m median holds the gate's control island (half-width 2.5) clear of
    // the innermost lane centre at 3.5 — an ordinary 1.2 m median would have
    // traffic driving through the booth. Two lanes each way would not fit the
    // 16 m deck at that median, and a venue approach does not need them.
    city.roads.push({x:(ROAD_X0+ROAD_X1)/2,z:CZ,vertical:false,len:ROAD_X1-ROAD_X0,
      district:"causeway",w:12,lanesPerDir:1,laneW:3.4,median:true,medianW:3.6,
      venueSite:"ironjaw"});
  }
  return null;
},40);

// ================================================== THE CARS IN THE CAR PARK
// DEFERRED, and not by preference: CBZ.cityMakeCar dereferences
// CBZ.city.arena.root, and city/mode.js only assigns CBZ.city.arena AFTER
// buildCity() RETURNS — so a car spawned from inside a landmass builder throws.
// (island_speedway.js had exactly that bug for its whole life and its park has
// been empty ever since; airside.js:1261 documents the same one-shot trick.)
// `parkRoot` rather than a done-flag, because cityAddParkedCar purges every
// fixture whose arena root is stale, so a world rebuild has to re-fill.
// A REAL LOT IS MOSTLY EMPTY, AND METAL IS THE EXPENSIVE PART. The bay count
// went from 16 to ~240 in this change, and 0.65 of that is 156 full vehicle
// rigs standing on one island — a frame cost paid for scenery. A dark arena's
// lot is nearly empty anyway (that is the whole reason ARENA_CROWD_EVENT
// exists), so the fill is a rate AND a hard ceiling, and the ceiling bites in
// list order: the island's own bays are pushed first, so the cars that DO
// exist are the ones parked closest to the door — which is exactly how a lot
// fills before a card.
var ARENA_PARK_FILL=0.34;
var ARENA_PARK_CARS=42;
var parkRoot=null;
CBZ.onUpdate(55.44,function(){
  if(!CFG.ARENA_FIGHTS||!CFG.ARENA_SITE)return;
  if(!CBZ.game||CBZ.game.mode!=="city")return;
  if(!CBZ.city||!CBZ.city.arena||!CBZ.cityAddParkedCar)return;
  if(!siteInfo||!siteInfo.park.length)return;
  if(parkRoot===CBZ.city.arena.root)return;
  parkRoot=CBZ.city.arena.root;
  // WHICH BAYS ARE TAKEN IS A POSITION HASH. This runs long after the build,
  // so a draw on any shared seeded stream here would be order-dependent and
  // could not be byte-identical per seed; hash01 is position-pure and is.
  var made=0;
  for(var i=0;i<siteInfo.park.length&&made<ARENA_PARK_CARS;i++){
    var s=siteInfo.park[i];
    if(CBZ.hash01&&CBZ.hash01(s.x,s.z,0x1A7)>ARENA_PARK_FILL)continue;
    var c=null;
    try{ c=CBZ.cityAddParkedCar(s.x,s.z,s.heading,{}); }catch(e){ c=null; }
    if(!c)continue;
    made++;
    c._venueSite="ironjaw";
    if(c.group)c.group.userData.arenaPark=true;
  }
});

// ------------------------------------------------- the shared site census
// One function pushed into CBZ.venueSite, which is what CBZ.venueSiteAudit()
// reads — so a third venue never costs an edit to the audit (same shape as
// CBZ.heliFleet). Everything here is a LIVE read off cityCars /
// cityStaffPosts / city.noSpawn / city.roads: a counter kept by a build loop
// would keep passing after the build stopped running.
if(CBZ.venueSite&&CBZ.venueSite.census){
  CBZ.venueSite.census("ironjaw",function(){
    var i,parked=0,staff=0,posts=0,keepouts=0,roads=0;
    var cars=CBZ.cityCars||[];
    for(i=0;i<cars.length;i++)if(cars[i]&&cars[i]._venueSite==="ironjaw")parked++;
    var sp=CBZ.cityStaffPosts?CBZ.cityStaffPosts():[];
    for(i=0;i<sp.length;i++){
      if(!sp[i]||sp[i].venue!=="ironjaw")continue;
      posts++; if(sp[i].ped&&!sp[i].ped.dead)staff++;
    }
    var A=CBZ.city&&CBZ.city.arena;
    var ns=(A&&A.noSpawn)||[];
    for(i=0;i<ns.length;i++)if(ns[i]&&/^ironjaw-/.test(ns[i].label||""))keepouts++;
    var rd=(A&&A.roads)||[];
    for(i=0;i<rd.length;i++)if(rd[i]&&rd[i].venueSite==="ironjaw")roads++;
    return {parked:parked,bays:siteInfo?siteInfo.bays:0,staff:staff,posts:posts,
      keepouts:keepouts,roadRecords:roads,gates:siteInfo?siteInfo.gates:0,
      fencePanels:siteInfo?siteInfo.fencePanels:0,
      // THE PERIMETER'S WORST STANDOFF FROM THE BUILDING, in metres, measured
      // over the real polyline at build time. It shipped at 2.30 against a 26 m
      // wall and nothing could see it; it is a NUMBER now and it may only ever
      // go UP. Below FIRE_STANDOFF (4.6) the site is standing in the fire lane.
      faceClear:siteInfo?siteInfo.faceClear:0,
      fenceVerts:siteInfo?siteInfo.fenceVerts:0,
      // The pit/cage/ring panels that carry a real yaw, and the metres of
      // solid air they used to add as bounding boxes. Slack is a RATCHET and
      // may only go down. (The perimeter fence is a STAIRCASE — every segment
      // axis-aligned — so it contributes nothing here and never did.)
      orientedPanels:yawOriented, aabbSlackSaved:+yawSlack.toFixed(1),
      onSiteBays:siteInfo?siteInfo.onSiteBays:0,
      overflowBays:siteInfo?siteInfo.overflowBays:0,
      // `parked` is capped on purpose (ARENA_PARK_CARS) — a 240-bay lot with
      // 240 vehicle rigs in it is a frame budget spent on scenery, and a real
      // lot is nearly empty when the house is dark. So `fill` is reported
      // against the CAP, and the cap is reported beside it: a lot that stops
      // filling still shows up, and one that was never built reads 0 bays.
      carCap:ARENA_PARK_CARS,
      fill:(siteInfo&&siteInfo.bays)
        ?+(parked/Math.min(siteInfo.bays,ARENA_PARK_CARS)).toFixed(2):0};
  });
}

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
  // Spawned loser dies the way every animal in the game now dies — through the
  // shared death physics (quad ragdoll or rigid tumble), never a pose snap. The
  // rotation.z snap is the model-local PITCH axis on these rigs: 1.35 rad was
  // literally "sit with the head pointed at the sky". Degrade path keeps it.
  if(!l.isPet&&l.group&&CBZ.wildlifeDeathPhysics)CBZ.wildlifeDeathPhysics(l,(w&&w.pos&&l.pos)?{x:l.pos.x-w.pos.x,y:0.1,z:l.pos.z-w.pos.z}:null,5.4,null);
  else if(!l.isPet&&l.group)l.group.rotation.z=1.35; // degrade only
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

// ============================================ A SEATED BODY CAN GET UP AND RUN
// OWNER: "right now NPCs can't stand up and run away. Yes, with a gun pointed
// some should [put] hands up, but some should stand up and run away."
//
// A seated body is HELD by npclife's syncAttached, which re-asserts the seat
// transform every frame — so nothing can nudge, shove or scare one out of a
// chair. Detaching is the only exit, and CBZ.cityUnseat is the shared call that
// does it. The BRANCH (freeze vs. bolt) is not a coin flip and is not decided
// here: peds.js's CBZ.cityScare owns it, reading sizeup.js's fight-or-fold
// maths, whether the person is armed, how close the threat is and how many
// people have ALREADY run — panic is contagious, which is what makes a bowl
// read as a crowd instead of N independent dice.
//
// Costs nothing when nothing is happening: one gate on the shared threat flag.
var panicT=0;
function tickPanic(dt,pp){
  if(!CFG.ARENA_CROWD_PANIC||!CBZ.cityScare)return;
  panicT-=dt; if(panicT>0)return;
  panicT=0.22;
  var P=CBZ.player;
  if(!P||P.dead)return;
  var armed=!!(CBZ.cityHasGun&&CBZ.cityHasGun());
  var threat=armed||(CBZ.game&&(CBZ.game.wanted|0)>=2);
  if(!threat)return;
  var peds=CBZ.cityPeds; if(!peds)return;
  var act=CBZ.city&&CBZ.city.playerActor;
  for(var i=0;i<peds.length;i++){
    var p=peds[i];
    if(!p||p.dead||p._venueRole!=="arena-spectator")continue;
    var dx=p.pos.x-pp.x, dz=p.pos.z-pp.z;
    if(dx*dx+dz*dz>34*34)continue;               // the ripple has a radius
    CBZ.cityScare(p,act||P,{seat:true});
  }
}

// ============================================================ CBZ.arenaAudit()
// THE RATCHET (BLOCK LAW #5). `misposed` and `shrugRoles` are pinned at 0 and
// may only ever stay there:
//   misposed   — a seated spectator whose body disagrees with the cushion its
//                seat DECLARED. Measured two ways, because one alone lies: the
//                seat must carry a seatRef at all (an undeclared anchor is the
//                legacy squat by definition), AND the rig's hip must sit within
//                a tolerance of where character.js's own closed form puts it.
//                That is what "knees at the chest" reads as, numerically.
//   shrugRoles — a spectator whose DISPLAYED title is an activity ("Fight Fan",
//                "Spectator") or a shrug, rather than a trade / org / condition.
//   spawnsInView — a spectator rig that became visible inside the camera's
//                padded screen area. Never let the player watch a body appear.
CBZ.arenaFightSupportAudit=function(force){
  if(!force&&fightSupportCache)return fightSupportCache;
  var reality=CBZ.reality;
  if(!fightRealityData||!reality||typeof reality.boxFromTransform!=="function"||
     typeof reality.supportAudit!=="function"){
    return {available:false,reason:"arena fight geometry/support audit unavailable"};
  }
  var boxes=[],pools=fightRealityData.pools||{};
  for(var poolName in pools){
    var items=pools[poolName]||[];
    for(var pi=0;pi<items.length;pi++){
      var it=items[pi],kind=it&&it._arenaRealityKind;
      if(!kind)continue;
      boxes.push(reality.boxFromTransform(it,{
        id:kind+":"+pi,
        kind:kind
      }));
    }
  }
  var extras=fightRealityData.extras||[];
  for(var ei=0;ei<extras.length;ei++){
    var ex=extras[ei];
    boxes.push(reality.boxFromTransform(ex.it,{
      id:ex.kind+":"+ei,
      kind:ex.kind
    }));
  }
  fightSupportCache=reality.supportAudit(boxes,{
    surfaces:fightRealityData.surfaces,
    surfaceEps:0.12,
    surfacePenetration:0.12,
    contactEps:0.08,
    cell:2,
    surfaceCell:4,
    sampleLimit:24,
    componentSampleLimit:32
  });
  fightSupportCache.available=true;
  fightSupportCache.scope="boxing ring, MMA cage and beast pit static geometry";
  return fightSupportCache;
};
function combineSupportAudits(building,fights){
  var list=[],i,k;
  if(building&&building.available)list.push({name:"venue",audit:building});
  if(fights&&fights.available)list.push({name:"fights",audit:fights});
  if(!list.length){
    return {available:false,reason:(building&&building.reason)||
      (fights&&fights.reason)||"arena support audits unavailable"};
  }
  var out={
    available:true,
    scope:"arena building plus fight surfaces",
    total:0,supportedCount:0,unsupportedCount:0,
    components:0,unsupportedComponents:0,directAnchors:0,
    contacts:0,candidatePairs:0,buckets:0,large:0,ms:0,
    unsupportedByKind:{},samples:[],sampleByKind:{},componentSamples:[],
    venue:building,fights:fights
  };
  for(i=0;i<list.length;i++){
    var name=list[i].name,a=list[i].audit;
    out.total+=a.total|0;
    out.supportedCount+=a.supportedCount|0;
    out.unsupportedCount+=a.unsupportedCount|0;
    out.components+=a.components|0;
    out.unsupportedComponents+=a.unsupportedComponents|0;
    out.directAnchors+=a.directAnchors|0;
    out.contacts+=a.contacts|0;
    out.candidatePairs+=a.candidatePairs|0;
    out.buckets+=a.buckets|0;
    out.large+=a.large|0;
    out.ms+=+a.ms||0;
    for(k in a.unsupportedByKind)
      out.unsupportedByKind[k]=(out.unsupportedByKind[k]||0)+a.unsupportedByKind[k];
    var ss=a.samples||[];
    for(var si=0;si<ss.length&&out.samples.length<32;si++){
      var sample={scope:name};
      for(k in ss[si])sample[k]=ss[si][k];
      out.samples.push(sample);
    }
    for(k in a.sampleByKind)if(!out.sampleByKind[k])
      out.sampleByKind[k]=a.sampleByKind[k];
    var cs=a.componentSamples||[];
    for(var ci=0;ci<cs.length&&out.componentSamples.length<40;ci++){
      var component={scope:name};
      for(k in cs[ci])component[k]=cs[ci][k];
      out.componentSamples.push(component);
    }
  }
  out.ms=+out.ms.toFixed(2);
  return out;
}
CBZ.arenaSupportAudit=function(force){
  var building=(venue&&typeof venue.supportAudit==="function")
    ?venue.supportAudit(!!force)
    :{available:false,reason:"arena venue/support audit unavailable"};
  return combineSupportAudits(building,CBZ.arenaFightSupportAudit(!!force));
};
CBZ.arenaAudit=function(){
  var M=(venue&&venue.metrics)||{};
  var cs=(venue&&venue.crowdState)?venue.crowdState():{fill:0,shown:0,total:0};
  var reality=CBZ.arenaSupportAudit(false);
  var fightReality=reality.fights||{available:false};
  var peds=CBZ.cityPeds||[];
  var rigs=0,seated=0,misposed=0,shrugs=0,inView=0,attending=0;
  var ACT={"Fight Fan":1,"Race Fan":1,"Spectator":1,"Fan":1,"Audience":1,
           "Attendee":1,"Crowd":1,"Punter":1,"Passenger":1,
           "Psycho":1,"Crook":1,"Old Money":1,"Drifter":1,"Civilian":1};
  for(var i=0;i<peds.length;i++){
    var p=peds[i];
    if(!p||p._venueRole!=="arena-spectator")continue;
    rigs++;
    if(p._attending)attending++;
    var t=CBZ.cityTitle?CBZ.cityTitle(p):"";
    if(!t||ACT[t])shrugs++;
    var ch=p.char;
    if(!ch||!ch.sitting)continue;
    seated++;
    var ref=ch.seatRef;
    // TWO independent reads, because either alone lies. (a) the seat must
    // DECLARE a cushion at all — an undeclared anchor IS the legacy squat, by
    // definition, and that is what put the knees at the chest. (b) the V2 solve
    // must actually be RUNNING: character.js sets ch._seatSunk = 1 on every
    // frame it sinks the model onto the cushion, and clears it when the body
    // stands, so a body posed by the legacy branch can never show it.
    if(!ref||ref.cushion==null||!ch._seatSunk)misposed++;
  }
  inView+=arenaSpawnSeen;
  var live=rigs*16;                       // ~16 draw calls per full rig
  return {
    tiers:M.tiers|0, rowsPerTier:M.rowsPerTier|0, rows:M.rows|0,
    bowlHeight:M.bowlHeight||0, rakeDeg:M.rakeDeg||0, rakeTopDeg:M.rakeTopDeg||0,
    minCValue:M.minCValue||0, targetC:M.targetC||0,
    floor:[M.floorX||0,M.floorZ||0],
    seats:M.seats|0,
    occupied:(cs.shown|0)+rigs,
    occupancyPct:M.seats?+(((cs.shown+rigs)/M.seats)*100).toFixed(1):0,
    eventActive:!!EVENT.active, event:EVENT.kind,
    instanced:cs.shown|0, instancedCap:M.crowdCap|0, rigs:rigs, seated:seated,
    misposed:misposed, shrugRoles:shrugs, attending:attending,
    spawnsInView:inView, spawnsDeferred:arenaSpawnBlocked,
    colliders:M.colliders|0, standColliders:M.standColliders|0,
    // THE BOWL'S INVISIBLE WALL, AS A NUMBER. Every ring in this venue is an
    // arc walked as short rotated chords; `orientedColliders` counts the ones
    // on a corner, and `aabbSlackSaved` is the metres of solid air they added
    // back when each was registered as its own bounding box. Slack is a
    // RATCHET (down only), and orientedColliders reading 0 on a bowl that has
    // corners means somebody re-typed a rotated chord as an AABB.
    orientedColliders:M.orientedColliders|0,
    aabbSlackSaved:+(M.aabbSlackSaved||0),
    platforms:M.platforms|0, aisleRamps:M.aisleRamps|0,
    seatCushion:M.seatCushion||0,
    realityBoxes:reality.available?(reality.total|0):0,
    floatingGeometry:reality.available?(reality.unsupportedCount|0):-1,
    floatingComponents:reality.available?(reality.unsupportedComponents|0):-1,
    floatingKinds:reality.available?reality.unsupportedByKind:{},
    realityMs:reality.available?(reality.ms||0):0,
    fightRealityBoxes:fightReality.available?(fightReality.total|0):0,
    fightFloatingGeometry:fightReality.available?(fightReality.unsupportedCount|0):-1,
    fightFloatingComponents:fightReality.available?(fightReality.unsupportedComponents|0):-1,
    fightFloatingKinds:fightReality.available?fightReality.unsupportedByKind:{},
    drawCallEst:(M.drawCallEst|0)+live
  };
};

// ================================================================ MAIN TICK
CBZ.onUpdate(40,function(dt){
  if(!dt||dt>0.5)dt=0.05;
  if(!arenaRoot||!CBZ.player||!CBZ.player.pos)return;
  var pp=CBZ.player.pos;
  // ---- THE HOUSE: full when a card is on, near-empty when it is dark -------
  if(CFG.ARENA_CROWD_EVENT!==false&&venue&&venue.crowdFill){
    var kind=eventNow();
    var on=!!kind;
    EVENT.kind=kind||"dark";
    // Re-cast ONLY on the dark<->live edge. Stepping into the cage during a
    // live card is not a reason to destroy and rebuild 28 bodies — the kind
    // changes, the house does not.
    if(!EVENT.init||on!==EVENT.active){
      // SNAP the very first time (you may have loaded in mid-card and a bowl
      // visibly filling from zero on arrival is its own fourth-wall break);
      // every later change RAMPS, so you watch the house come in.
      var snap=!EVENT.init;
      EVENT.init=true;
      EVENT.active=on; EVENT.kind=kind||"dark"; EVENT.t=0;
      venue.crowdFill(on?FILL_ON:FILL_OFF,snap);
      setAudience(on?LIVE_ON:LIVE_OFF,true);
      board(on?"TONIGHT — FIGHT NIGHT":"IRONJAW ARENA",
            on?"THE HOUSE IS IN":"DARK TONIGHT",
            on?"BOXING / MMA / BEAST PIT":"next card at dusk");
    }
    EVENT.t+=dt;
  }
  // The building's own per-frame work: switch the real light rig + instanced
  // crowd by distance, and repaint the jumbotron when the card changed.
  if(venue&&venue.tick)venue.tick(Math.hypot(pp.x-CX,pp.z-CZ),dt);
  tickPanic(dt,pp);
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
