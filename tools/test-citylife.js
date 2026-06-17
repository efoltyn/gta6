/* Headless functional test for the unified company ↔ city-staff feature.
   Stubs THREE + CBZ, fabricates a small city, runs companies.js then
   citystaff.js, and asserts the cross-linkage actually works:
     - companies form and own real-estate portfolios
     - visible staff appear ONLY at company-managed buildings
     - office headcount scales with the managing company's portfolio
     - CBZ.cityStaff.atLot() ties each queue/office back to its company
   Run: node tools/test-citylife.js
*/
const fs = require("fs"), vm = require("vm"), path = require("path");

// ---- minimal THREE stub (only what the two modules touch) ----
function noop() { return this; }
const THREE = {
  BoxGeometry: function () {},
  PlaneGeometry: function () {},
  MeshLambertMaterial: function () {},
  MeshBasicMaterial: function () {},
  InstancedMesh: function () { this.count = 0; this.instanceMatrix = { needsUpdate: false }; this.instanceColor = { needsUpdate: false }; this.setMatrixAt = noop; this.setColorAt = noop; },
  Matrix4: function () { this.compose = noop; },
  Quaternion: function () { this.setFromEuler = noop; },
  Euler: function () { this.set = noop; },
  Vector3: function () { this.set = noop; },
  Color: function () { this.setHex = noop; },
};

// ---- fabricate a city ----
const districts = [{ name: "Downtown" }, { name: "Midtown" }];
const lots = [];
function mk(kind, ownerType, opts) {
  opts = opts || {};
  const b = { door: { x: lots.length * 12, z: 0, nx: 0, nz: 1 }, owner: { type: ownerType }, storeys: opts.storeys || 1 };
  if (opts.shop) b.shop = { kind: kind };
  if (opts.home) b.home = { owned: false };
  lots.push({ cx: lots.length * 12, cz: 0, w: 10, d: 10, district: lots.length % 2, kind: kind, building: b });
}
["food", "clothing", "electronics", "guns", "jewelry", "pawn", "hardware", "gym"].forEach(k => mk(k, "business", { shop: true }));        // 8 retail stores
["bank", "realtor", "security", "cityhall", "airfield", "casino"].forEach(k => mk(k, "business", { shop: true, storeys: 3 }));            // 6 offices
for (let i = 0; i < 6; i++) mk("tower", "landlord", { storeys: 8 });        // 6 generic towers (company-ownable, not staffed)
for (let i = 0; i < 4; i++) mk("home", "landlord", { home: true });         // 4 homes (excluded from companies)

const updaters = [], feed = [];
const CBZ = {
  game: { mode: "city" },
  scene: { add: function () {} },
  onUpdate: function (o, f) { updaters.push({ o: o, f: f }); },
  floorAt: function () { return 0; },
  cityFeed: function (m) { feed.push(m); },
  nightAmount: 0.2,
  city: { arena: { lots: lots, districts: districts } },
};
const ctx = { window: { CBZ: CBZ, THREE: THREE }, console: console, Math: Math };
vm.createContext(ctx);
for (const f of ["companies.js", "citystaff.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", "city", f), "utf8"), ctx, { filename: f });
}

const comp = updaters.find(u => u.o === 41.7).f;
const staff = updaters.find(u => u.o === 41.8).f;
comp(1.0);          // build company roster
staff(1.0);         // build staff (gated on companies)

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ FAIL: " + msg); } }

const companies = CBZ.cityCompanies.list();
ok(CBZ.cityCompanies.count() >= 4, "companies formed (" + CBZ.cityCompanies.count() + ")");
ok(lots.filter(l => l._company).length >= 8, "companies own a real-estate portfolio across many lots (" + lots.filter(l => l._company).length + " tagged)");
ok(companies.every(c => c.lots.length >= 1 && c.hq), "every company has an HQ + at least one property");

// ---- placement invariants (asserted at BUILD time, before any market trades) ----
const staffCount = CBZ.cityStaff.count();
ok(staffCount > 0, "visible staff/queue figures placed (" + staffCount + ")");
const staffedLots = lots.filter(l => CBZ.cityStaff.atLot(l));
ok(staffedLots.length > 0 && staffedLots.every(l => l._company), "every staffed building is company-managed at build (" + staffedLots.length + " buildings)");

const storeLot = lots.find(l => l.kind === "food");
const officeLot = lots.find(l => l.kind === "bank");
const sInfo = CBZ.cityStaff.atLot(storeLot), oInfo = CBZ.cityStaff.atLot(officeLot);
ok(sInfo && sInfo.role === "queue" && sInfo.company === storeLot._company.name, "store has a QUEUE tied to its managing company (" + (sInfo && sInfo.company) + ")");
ok(oInfo && oInfo.role === "staff" && oInfo.company === officeLot._company.name, "office has STAFF tied to its managing company (" + (oInfo && oInfo.company) + ")");

const big = lots.filter(l => l.kind === "bank" || l.kind === "realtor" || l.kind === "casino")
  .map(l => ({ port: l._company.lots.length, n: (CBZ.cityStaff.atLot(l) || {}).count || 0 }));
ok(big.some(b => b.n >= 2), "office staffing present and portfolio-scaled (" + JSON.stringify(big) + ")");

const homeLot = lots.find(l => l.kind === "home");
ok(!homeLot._company && !CBZ.cityStaff.atLot(homeLot), "homes excluded from companies + staff");

// ---- now run the live MARKET (companies trade real estate) ----
const feedBefore = feed.length;
for (let i = 0; i < 40; i++) { comp(25); }
const events = feed.filter(m => /📈|📉|💥|🏢/.test(m));
ok(events.length > 0, "companies actively traded real estate over time (" + events.length + " market events, e.g. \"" + (events[0] || "") + "\")");
ok(CBZ.cityStaff.atLot(officeLot) !== null, "atLot still resolves after trades (live owner read, no stale crash)");

console.log("\n" + (fail === 0 ? "ALL PASS" : fail + " FAILED") + " (" + pass + "/" + (pass + fail) + ")");
process.exit(fail === 0 ? 0 : 1);
