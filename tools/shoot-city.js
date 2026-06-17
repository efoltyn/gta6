const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist','--no-sandbox','--disable-dev-shm-usage','--window-size=1600,1000']
  });
  const page = await browser.newPage();
  await page.setViewport({width:1600,height:1000});
  const log=[];
  await page.goto('http://127.0.0.1:8000/', {waitUntil:'networkidle2', timeout:60000}).catch(e=>log.push('GOTO '+e.message));
  await sleep(1200);
  await page.evaluate(()=>{ const b=document.getElementById('playBtn'); if(b) b.click(); });
  for(let i=0;i<50;i++){ await sleep(500); if(await page.evaluate(()=> !!(window.CBZ&&CBZ.city&&CBZ.city.arena&&CBZ.game&&CBZ.game.state==='playing'))) break; }
  await sleep(3500);
  const info = await page.evaluate(()=>{
    const C=window.CBZ;
    window.__cam={pos:[0,10,0],look:[0,8,0]};
    if(!C.renderer.__patched){ const o=C.renderer.render.bind(C.renderer);
      C.renderer.render=function(s,cam){ const t=window.__cam; if(t&&cam&&cam.position){ cam.position.set(t.pos[0],t.pos[1],t.pos[2]); cam.lookAt(t.look[0],t.look[1],t.look[2]); cam.updateMatrixWorld(); } return o(s,cam); }; C.renderer.__patched=true; }
    // hide the FP weapon/arms if present so they don't block the frame
    try{ if(C.player) C.player.pos.y = -50; }catch(e){}   // drop player far below so its rig + gun leave the frame
    const A=C.city.arena;
    const lot=A.lots.filter(l=>l.building&&l.building.door&&l.building.storeys>=4).sort((a,b)=>b.building.storeys-a.building.storeys)[2] || A.lots.find(l=>l.building&&l.building.storeys>=4);
    if(!lot) return {none:true};
    const cx=lot.cx, cz=lot.cz, d=lot.building.door, h=lot.building.h||lot.building.storeys*4.6;
    let ox=d.x-cx, oz=d.z-cz; const L=Math.hypot(ox,oz)||1; ox/=L; oz/=L;   // TRUE outward = centre→door
    const tx=-oz, tz=ox;
    // shatter a facade grid + two blasts, using true outward
    for(let y=3;y<h-2;y+=3.0){ for(let lat=-10;lat<=10;lat+=2.5){
      try{ C.cityShatterRay(d.x+ox*4+tx*lat, y, d.z+oz*4+tz*lat, -ox,0,-oz, 12, true); }catch(e){} } }
    try{ C.cityExplosion(d.x, d.z, {power:1.6,radius:9,byPlayer:true,y:5}); }catch(e){}
    try{ C.cityExplosion(d.x+tx*6, d.z+tz*6, {power:1.6,radius:9,byPlayer:true,y:12}); }catch(e){}
    return {cx,cz,dx:d.x,dz:d.z,h,ox,oz,tx,tz,storeys:lot.building.storeys,kind:lot.kind};
  });
  log.push('INFO '+JSON.stringify(info));
  if(!info.none){
    await sleep(1300);
    const camH = Math.max(8, info.h*0.42);
    // straight-on external facade
    await page.evaluate((i,camH)=>{ window.__cam={ pos:[i.dx+i.ox*30, camH, i.dz+i.oz*30], look:[i.dx, camH*0.8, i.dz] }; }, info, camH);
    await sleep(900); await page.screenshot({path:'/tmp/shot/clean1.png'});
    // 35° offset, a bit lower
    await page.evaluate((i)=>{ window.__cam={ pos:[i.dx+i.ox*22+i.tx*16, 9, i.dz+i.oz*22+i.tz*16], look:[i.dx, 8, i.dz] }; }, info);
    await sleep(700); await page.screenshot({path:'/tmp/shot/clean2.png'});
  }
  console.log(log.join('\n'));
  await browser.close();
})();
