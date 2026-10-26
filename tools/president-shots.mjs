#!/usr/bin/env node
/* tools/president-shots.mjs — one headless look at games/president.html.

   Boots the page straight into office (?auto=1), lets the world run a while
   with a war on so the map has fronts, then photographs: the office from the
   chair, the Treasury brief in your hands, the map table, the phone, and the
   start screen. Prints every page error. One Chrome, then gone.

   node tools/president-shots.mjs [--out artifacts/president] [--seed 7] [--w 1280 --h 800] [--days 240]
*/
import { launch, sleep, ROOT } from "./lib/cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const OUT = path.resolve(ROOT, arg("--out", "artifacts/president"));
const SEED = +arg("--seed", 7), Wd = +arg("--w", 1280), Ht = +arg("--h", 800), DAYS = +arg("--days", 240);
mkdirSync(OUT, { recursive: true });

const rig = await launch({ rafBudget: 0 });
const shot = async (name) => {
  await sleep(400);
  const r = await rig.send("Page.captureScreenshot", { format: "png" });
  const f = path.join(OUT, name + ".png");
  writeFileSync(f, Buffer.from(r.result.data, "base64"));
  console.log("  wrote", path.relative(ROOT, f));
};
try {
  await rig.send("Emulation.setDeviceMetricsOverride", { width: Wd, height: Ht, deviceScaleFactor: 1, mobile: false });
  // the start screen first
  await rig.open("games/president.html", "seed=" + SEED);
  await rig.wait("window.CBZ && CBZ.presWorld && document.getElementById('clist').children.length > 0", 30000);
  await shot("0-start");
  await rig.open("games/president.html", "seed=" + SEED + "&auto=1");
  const ok = await rig.wait("window.CBZ && CBZ.presOffice && CBZ.presGame && CBZ.presGame.state() && document.body.classList.contains('playing')", 120000);
  console.log("office up:", ok);
  if (!ok) throw new Error("the office never came up");
  // a world with a war in it: run it on, the player's neighbour attacks someone
  await rig.evl(`(() => {
    const G = CBZ.presGame, PW = CBZ.presWorld, S = G.state(), me = G.me();
    G.speed(0);
    for (let d = 0; d < ${DAYS}; d++) {
      const acts = [];
      if (d === 20) {
        // the strongest AI attacks its weakest reachable neighbour
        const ai = S.c.filter(c => c.alive && c.id !== me).sort((a, b) => b.div - a.div);
        for (const a of ai) { const t = S.c.find(o => o.alive && o.id !== a.id && o.id !== me && PW.reach(S, a.id, o.id) === 2); if (t) { a.cab.general.loyalty = 100; PW.apply(S, { type: "war", c: a.id, t: t.id }); break; } }
      }
      PW.step(S, acts);
    }
    S.c[me].matters = S.c[me].matters.filter(m => m.kind === "bill");
    CBZ.presOffice.redraw();
    return S.day;
  })()`);
  await sleep(2500);
  await shot("1-office");
  await rig.evl("CBZ.presOffice.focus('treasury')"); await sleep(1600); await shot("2-treasury");
  await rig.evl("CBZ.presOffice.back()"); await sleep(300);
  await rig.evl("CBZ.presOffice.focus('commerce')"); await sleep(1600); await shot("3-commerce");
  await rig.evl("CBZ.presOffice.back()"); await sleep(300);
  await rig.evl("CBZ.presOffice.focus('cabinet')"); await sleep(1600); await shot("4-cabinet");
  await rig.evl("CBZ.presOffice.back()"); await sleep(300);
  // the map, with a country at war picked
  await rig.evl(`(() => { const S = CBZ.presGame.state(); const w = S.c.find(c => c.war.length); CBZ.presGame.ui.sel = w ? w.id : null; CBZ.presOffice.focus('map'); })()`);
  await sleep(2200); await shot("5-map");
  await rig.evl("CBZ.presOffice.back()"); await sleep(300);
  await rig.evl("CBZ.presOffice.focus('phone')"); await sleep(1600); await shot("6-phone");
  await rig.evl("CBZ.presOffice.back()"); await sleep(300);
  // a phone-sized look at the treasury too
  await rig.send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
  await sleep(800);
  await rig.evl("CBZ.presOffice.focus('map')"); await sleep(1800); await shot("7-phone-landscape-map");
  await rig.evl("CBZ.presOffice.back()"); await sleep(300);
  await shot("8-phone-landscape-office");
  await rig.send("Emulation.setDeviceMetricsOverride", { width: Wd, height: Ht, deviceScaleFactor: 1, mobile: false });
  await sleep(800);
  // the General walks in with an opening
  await rig.evl(`(() => { const S = CBZ.presGame.state(), me = CBZ.presGame.me(), PW = CBZ.presWorld;
    const t = S.c.find(o => o.alive && o.id !== me);
    PW._matter(S, S.c[me], "opening", "general", { t: t.id, ratio: 2.1 }, [{ label: "Invade", act: { type: "war", t: t.id } }, { label: "Not now", act: { type: "noop" } }], 25);
    CBZ.presGame.submit({ type: "noop" }); })()`);
  const ready = () => rig.wait("CBZ.campaignUI.cinematic() && CBZ.campaignUI.cinematic().ready", 60000, 300);
  console.log("general's question up:", await ready());
  await shot("9-general-asks");
  await rig.evl("CBZ.campaignUI.pick('right')");
  await sleep(1500);
  // a foreign leader on the phone
  await rig.evl(`(() => { const S = CBZ.presGame.state(), me = CBZ.presGame.me(), PW = CBZ.presWorld;
    const t = S.c.find(o => o.alive && o.id !== me && o.human == null);
    PW._matter(S, S.c[me], "bailoutOffer", "leader:" + t.id, { t: t.id, amt: 400, strings: "bases" }, [{ label: "Take the money", act: { type: "acceptBailout", t: t.id, amt: 400, strings: "bases" } }, { label: "Refuse", act: { type: "refuseOffer", t: t.id, kind: "bailout" } }], 20);
    CBZ.presGame.submit({ type: "noop" }); CBZ.presOffice.focus("phone"); })()`);
  await sleep(1500);
  await rig.evl(`(() => { const S = CBZ.presGame.state(), me = CBZ.presGame.me(); const m = S.c[me].matters.find(q => q.kind === "bailoutOffer"); CBZ.presGame.ui.call = m.id; CBZ.presGame.ui.phoneTab = "calls"; CBZ.presOffice.redraw("phone"); })()`);
  await sleep(900); await shot("10-phone-call");
  await rig.evl(`(() => { CBZ.presGame.ui.call = null; CBZ.presGame.ui.dial = null; CBZ.presOffice.redraw("phone"); })()`);
  await sleep(900); await shot("10b-phone-contacts");
  await rig.evl("CBZ.presOffice.back()"); await sleep(400);
  // the man with the resignation and the pistol
  await rig.evl(`(() => { const S = CBZ.presGame.state(), me = CBZ.presGame.me(), PW = CBZ.presWorld;
    PW._matter(S, S.c[me], "traitor", "security", { name: S.c[me].cab.security.name }, [{ label: "Sign it", act: { type: "resign" } }, { label: "Refuse", act: { type: "defy" }, fatal: 1 }], 2, true);
    CBZ.presGame.submit({ type: "noop" }); })()`);
  console.log("the traitor's question up:", await ready());
  await shot("11-traitor");
  await rig.evl("CBZ.campaignUI.pick('right')");
  await rig.wait("CBZ.presGame.state().log.slice(-6).some(e => e.k === 'plotFoiled' || e.k === 'fall')", 20000, 200);
  await sleep(1800); await shot("12-traitor-after");
  console.log("after:", await rig.evl("JSON.stringify(CBZ.presGame.state().log.slice(-4).map(e => e.k + (e.why ? ':' + e.why : '')))"));
  // turned round: the windows
  const info = await rig.evl(`(() => ({ day: CBZ.presGame.state().day, fps: CBZ.micro.fps, calls: CBZ.renderer.info.render.calls, tris: CBZ.renderer.info.render.triangles, people: Object.keys(CBZ.presOffice.people).length }))()`);
  console.log("frame:", JSON.stringify(info));
} catch (e) {
  console.error("FAILED:", e.message);
} finally {
  console.log("errors:", rig.errors.length ? "\n  " + rig.errors.slice(0, 20).join("\n  ") : "none");
  if (rig.netErrors.length) console.log("net:", rig.netErrors.slice(0, 10).join("\n  "));
  await rig.close();
}
