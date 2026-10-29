/* ============================================================
   president/states.js — THE FIFTY STATES AND DC, FOR THE STATE-VS-STATE
   GAME, AND WHO RUNS THEM.

   OWNER (2026-10-28): "just usa like state vs state" / "keep names in ONE
   data file per kind so they're easy to update."

   THIS IS THAT FILE for the states (president/nations.js is the one for
   countries). A row is one state as world.js plays a country: its governor
   is its leader, its National Guard is its army, its economy and its people
   are its own. The map under it is president/earth.js's US layer (Natural
   Earth admin-1); a row joins its land by `iso` (the postal code).

   GOVERNORS: as of AS_OF, the best this repo knows (the model that wrote it
   has a mid-2026 knowledge cutoff). Thirty-six states vote for governor on
   3 November 2026, the day after the game starts: the game plays that vote.
   When a governor changes, change `leader` on his row and nothing else.

   Numbers are round and public: pop (millions, 2024), gdp ($bn, 2024),
   guard (Army + Air National Guard, thousands), party (R / D, the
   governor's), next (next vote for governor, "YYYY-MM"), approval (the
   governor's, roughly), res (yearly output, the same units as nations.js:
   oil Mb/d, gas 10 bcm, iron 10 Mt, copper 100 kt, rare earths 5 kt, grain
   10 Mt, uranium 500 t). Cities are the provinces, capital first.

   PUBLIC  CBZ.presStates = { AS_OF, list, byId, BLOCS, REL, ALLIANCES, DIALS }
============================================================ */
(function (root) {
  "use strict";
  const G = (typeof window !== "undefined" && window) || root;
  const CBZ = G.CBZ = G.CBZ || {};

  const AS_OF = "2026-06";

  const LIST = [
    { id: "al", name: "Alabama", leader: "Kay Ivey", party: "R", pop: 5.2, gdp: 320, guard: 13, next: "2026-11", approval: 55, res: { grain: 0.4 },
      cities: [["Montgomery", 32.37, -86.3, 0.39], ["Birmingham", 33.52, -86.81, 1.1], ["Huntsville", 34.73, -86.59, 0.5], ["Mobile", 30.69, -88.04, 0.43]] },
    { id: "ak", name: "Alaska", leader: "Mike Dunleavy", party: "R", pop: 0.74, gdp: 70, guard: 4, next: "2026-11", approval: 45, res: { oil: 0.42, gas: 0.9 },
      cities: [["Juneau", 58.3, -134.42, 0.03], ["Anchorage", 61.22, -149.9, 0.4], ["Fairbanks", 64.84, -147.72, 0.1], ["Bethel", 60.79, -161.76, 0.006], ["Nome", 64.5, -165.41, 0.004], ["Utqiaġvik", 71.29, -156.79, 0.005]] },
    { id: "az", name: "Arizona", leader: "Katie Hobbs", party: "D", pop: 7.6, gdp: 560, guard: 8, next: "2026-11", approval: 48, res: { copper: 7.5 },
      cities: [["Phoenix", 33.45, -112.07, 5.1], ["Tucson", 32.22, -110.97, 1.0], ["Flagstaff", 35.2, -111.65, 0.15], ["Yuma", 32.69, -114.63, 0.2]] },
    { id: "ar", name: "Arkansas", leader: "Sarah Huckabee Sanders", party: "R", pop: 3.1, gdp: 180, guard: 9, next: "2026-11", approval: 55, res: { grain: 1.2, gas: 0.6 },
      cities: [["Little Rock", 34.75, -92.29, 0.75], ["Fayetteville", 36.06, -94.16, 0.6], ["Jonesboro", 35.84, -90.7, 0.13]] },
    { id: "ca", name: "California", leader: "Gavin Newsom", party: "D", pop: 39.4, gdp: 4100, guard: 22, next: "2026-11", approval: 47, debt: 20, u: 5.5, ind: 1.1, res: { oil: 0.3, rare: 9, grain: 0.6, gas: 0.2 },
      cities: [["Sacramento", 38.58, -121.49, 2.4], ["Redding", 40.59, -122.39, 0.18], ["San Francisco", 37.77, -122.42, 4.6], ["San Jose", 37.34, -121.89, 2.0], ["Fresno", 36.74, -119.79, 1.0],
        ["Bakersfield", 35.37, -119.02, 0.9], ["Los Angeles", 34.05, -118.24, 12.8], ["San Diego", 32.72, -117.16, 3.3]] },
    { id: "co", name: "Colorado", leader: "Jared Polis", party: "D", pop: 6.0, gdp: 550, guard: 5.5, next: "2026-11", approval: 52, res: { oil: 0.47, gas: 5, grain: 0.8 },
      cities: [["Denver", 39.74, -104.99, 3.0], ["Colorado Springs", 38.83, -104.82, 0.77], ["Grand Junction", 39.06, -108.55, 0.16]] },
    { id: "ct", name: "Connecticut", leader: "Ned Lamont", party: "D", pop: 3.7, gdp: 360, guard: 5, next: "2026-11", approval: 60, debt: 35,
      cities: [["Hartford", 41.76, -72.69, 1.2], ["New Haven", 41.31, -72.92, 0.86], ["Bridgeport", 41.19, -73.2, 0.95]] },
    { id: "de", name: "Delaware", leader: "Matt Meyer", party: "D", pop: 1.05, gdp: 95, guard: 3, next: "2028-11", approval: 50,
      cities: [["Dover", 39.16, -75.52, 0.19], ["Wilmington", 39.74, -75.55, 0.7]] },
    { id: "dc", name: "District of Columbia", short: "DC", leader: "Muriel Bowser", title: "Mayor", party: "D", pop: 0.7, gdp: 180, guard: 2.7, next: "2026-11", approval: 45, u: 6,
      cities: [["Washington", 38.9, -77.04, 0.7]] },
    { id: "fl", name: "Florida", leader: "Ron DeSantis", party: "R", pop: 23.4, gdp: 1700, guard: 12, next: "2026-11", approval: 52, debt: 8,
      cities: [["Tallahassee", 30.44, -84.28, 0.39], ["Pensacola", 30.42, -87.22, 0.5], ["Jacksonville", 30.33, -81.66, 1.7], ["Orlando", 28.54, -81.38, 2.8], ["Tampa", 27.95, -82.46, 3.3], ["Miami", 25.76, -80.19, 6.1]] },
    { id: "ga", name: "Georgia", leader: "Brian Kemp", party: "R", pop: 11.2, gdp: 880, guard: 14, next: "2026-11", approval: 58,
      cities: [["Atlanta", 33.75, -84.39, 6.3], ["Augusta", 33.47, -81.97, 0.62], ["Columbus", 32.46, -84.99, 0.33], ["Savannah", 32.08, -81.09, 0.42]] },
    { id: "hi", name: "Hawaii", leader: "Josh Green", party: "D", pop: 1.4, gdp: 110, guard: 5.5, next: "2026-11", approval: 52,
      cities: [["Honolulu", 21.31, -157.86, 1.0], ["Hilo", 19.71, -155.08, 0.2]] },
    { id: "id", name: "Idaho", leader: "Brad Little", party: "R", pop: 2.0, gdp: 120, guard: 5, next: "2026-11", approval: 55, res: { grain: 0.5 },
      cities: [["Boise", 43.62, -116.2, 0.8], ["Idaho Falls", 43.49, -112.04, 0.17], ["Coeur d'Alene", 47.68, -116.78, 0.18]] },
    { id: "il", name: "Illinois", leader: "JB Pritzker", party: "D", pop: 12.7, gdp: 1140, guard: 13, next: "2026-11", approval: 50, debt: 30, u: 4.8, ind: 1.0, res: { grain: 6.5 },
      cities: [["Springfield", 39.78, -89.65, 0.2], ["Chicago", 41.88, -87.63, 9.3], ["Peoria", 40.69, -89.59, 0.4], ["Carbondale", 37.73, -89.22, 0.06]] },
    { id: "in", name: "Indiana", leader: "Mike Braun", party: "R", pop: 6.9, gdp: 530, guard: 14, next: "2028-11", approval: 48, ind: 1.3, res: { grain: 3.2 },
      cities: [["Indianapolis", 39.77, -86.16, 2.1], ["Gary", 41.59, -87.35, 0.7], ["Fort Wayne", 41.08, -85.14, 0.42], ["Evansville", 37.97, -87.57, 0.3]] },
    { id: "ia", name: "Iowa", leader: "Kim Reynolds", party: "R", pop: 3.2, gdp: 250, guard: 9, next: "2026-11", approval: 45, res: { grain: 7.5 },
      cities: [["Des Moines", 41.59, -93.62, 0.72], ["Sioux City", 42.5, -96.4, 0.15], ["Cedar Rapids", 41.98, -91.67, 0.28], ["Davenport", 41.52, -90.58, 0.38]] },
    { id: "ks", name: "Kansas", leader: "Laura Kelly", party: "D", pop: 3.0, gdp: 220, guard: 7, next: "2026-11", approval: 55, res: { grain: 4, oil: 0.08, gas: 0.6 },
      cities: [["Topeka", 39.05, -95.68, 0.23], ["Wichita", 37.69, -97.34, 0.65], ["Kansas City, Kansas", 39.11, -94.75, 0.5], ["Dodge City", 37.75, -100.02, 0.03]] },
    { id: "ky", name: "Kentucky", leader: "Andy Beshear", party: "D", pop: 4.6, gdp: 280, guard: 8, next: "2027-11", approval: 60, debt: 25, res: { grain: 0.8 },
      cities: [["Frankfort", 38.2, -84.87, 0.07], ["Louisville", 38.25, -85.76, 1.4], ["Lexington", 38.04, -84.5, 0.52], ["Bowling Green", 36.99, -86.44, 0.18], ["Paducah", 37.08, -88.6, 0.1]] },
    { id: "la", name: "Louisiana", leader: "Jeff Landry", party: "R", pop: 4.6, gdp: 310, guard: 11, next: "2027-10", approval: 45, res: { oil: 1.3, gas: 12 },
      cities: [["Baton Rouge", 30.45, -91.15, 0.87], ["New Orleans", 29.95, -90.07, 1.3], ["Lafayette", 30.22, -92.02, 0.48], ["Shreveport", 32.53, -93.75, 0.39]] },
    { id: "me", name: "Maine", leader: "Janet Mills", party: "D", pop: 1.4, gdp: 95, guard: 3, next: "2026-11", approval: 48,
      cities: [["Augusta", 44.31, -69.78, 0.12], ["Portland", 43.66, -70.26, 0.55], ["Bangor", 44.8, -68.77, 0.15], ["Presque Isle", 46.68, -68.02, 0.01]] },
    { id: "md", name: "Maryland", leader: "Wes Moore", party: "D", pop: 6.3, gdp: 540, guard: 6.5, next: "2026-11", approval: 52,
      cities: [["Annapolis", 38.98, -76.49, 0.04], ["Baltimore", 39.29, -76.61, 2.8], ["Hagerstown", 39.64, -77.72, 0.3]] },
    { id: "ma", name: "Massachusetts", leader: "Maura Healey", party: "D", pop: 7.1, gdp: 770, guard: 7.5, next: "2026-11", approval: 55, debt: 25,
      cities: [["Boston", 42.36, -71.06, 4.9], ["Worcester", 42.26, -71.8, 0.98], ["Springfield, Massachusetts", 42.1, -72.59, 0.7]] },
    { id: "mi", name: "Michigan", leader: "Gretchen Whitmer", party: "D", pop: 10.1, gdp: 700, guard: 11, next: "2026-11", approval: 55, u: 5, ind: 1.4, res: { iron: 0.8, grain: 1.2 },
      cities: [["Lansing", 42.73, -84.56, 0.54], ["Detroit", 42.33, -83.05, 4.3], ["Grand Rapids", 42.96, -85.67, 1.1], ["Marquette", 46.54, -87.4, 0.07]] },
    { id: "mn", name: "Minnesota", leader: "Tim Walz", party: "D", pop: 5.8, gdp: 490, guard: 13, next: "2026-11", approval: 48, res: { iron: 4.2, grain: 4.3 },
      cities: [["Saint Paul", 44.95, -93.09, 3.7], ["Rochester", 44.02, -92.46, 0.23], ["Duluth", 46.79, -92.1, 0.29], ["Bemidji", 47.47, -94.88, 0.05]] },
    { id: "ms", name: "Mississippi", leader: "Tate Reeves", party: "R", pop: 2.9, gdp: 150, guard: 12, next: "2027-11", approval: 48, res: { grain: 0.6 },
      cities: [["Jackson", 32.3, -90.18, 0.58], ["Tupelo", 34.26, -88.7, 0.14], ["Gulfport", 30.37, -89.09, 0.42]] },
    { id: "mo", name: "Missouri", leader: "Mike Kehoe", party: "R", pop: 6.2, gdp: 440, guard: 11, next: "2028-11", approval: 50, res: { grain: 2 },
      cities: [["Jefferson City", 38.58, -92.17, 0.15], ["Kansas City", 39.1, -94.58, 2.2], ["St. Louis", 38.63, -90.2, 2.8], ["Springfield, Missouri", 37.21, -93.29, 0.49]] },
    { id: "mt", name: "Montana", leader: "Greg Gianforte", party: "R", pop: 1.1, gdp: 70, guard: 3.8, next: "2028-11", approval: 52, res: { copper: 0.4, oil: 0.06, grain: 0.8 },
      cities: [["Helena", 46.59, -112.04, 0.08], ["Missoula", 46.87, -113.99, 0.12], ["Great Falls", 47.5, -111.3, 0.08], ["Billings", 45.78, -108.5, 0.19]] },
    { id: "ne", name: "Nebraska", leader: "Jim Pillen", party: "R", pop: 2.0, gdp: 180, guard: 4.5, next: "2026-11", approval: 50, res: { grain: 5 },
      cities: [["Lincoln", 40.81, -96.7, 0.34], ["Omaha", 41.26, -95.94, 0.97], ["North Platte", 41.12, -100.77, 0.03], ["Scottsbluff", 41.87, -103.67, 0.04]] },
    { id: "nv", name: "Nevada", leader: "Joe Lombardo", party: "R", pop: 3.3, gdp: 260, guard: 4.5, next: "2026-11", approval: 50, u: 5.7, res: { copper: 0.4 },
      cities: [["Carson City", 39.16, -119.77, 0.06], ["Reno", 39.53, -119.81, 0.5], ["Elko", 40.83, -115.76, 0.05], ["Las Vegas", 36.17, -115.14, 2.3]] },
    { id: "nh", name: "New Hampshire", short: "New Hamp.", leader: "Kelly Ayotte", party: "R", pop: 1.4, gdp: 115, guard: 3, next: "2026-11", term: 2, approval: 52,
      cities: [["Concord", 43.21, -71.54, 0.15], ["Manchester", 42.99, -71.46, 0.42]] },
    { id: "nj", name: "New Jersey", leader: "Mikie Sherrill", party: "D", pop: 9.5, gdp: 840, guard: 8.5, next: "2029-11", approval: 52, debt: 30,
      cities: [["Trenton", 40.22, -74.76, 0.38], ["Newark", 40.74, -74.17, 2.0], ["Atlantic City", 39.36, -74.42, 0.27]] },
    { id: "nm", name: "New Mexico", leader: "Michelle Lujan Grisham", party: "D", pop: 2.1, gdp: 135, guard: 3.5, next: "2026-11", approval: 45, res: { oil: 2.0, gas: 9, copper: 0.7 },
      cities: [["Santa Fe", 35.69, -105.94, 0.15], ["Farmington", 36.73, -108.22, 0.12], ["Albuquerque", 35.08, -106.65, 0.92], ["Roswell", 33.39, -104.52, 0.05], ["Las Cruces", 32.31, -106.78, 0.22]] },
    { id: "ny", name: "New York", leader: "Kathy Hochul", party: "D", pop: 19.9, gdp: 2300, guard: 15.5, next: "2026-11", approval: 45, debt: 25, ind: 0.7,
      cities: [["Albany", 42.65, -73.76, 0.9], ["New York City", 40.71, -74.0, 12.0], ["Syracuse", 43.05, -76.15, 0.66], ["Rochester", 43.16, -77.61, 1.1], ["Buffalo", 42.89, -78.88, 1.2]] },
    { id: "nc", name: "North Carolina", short: "N. Carolina", leader: "Josh Stein", party: "D", pop: 11.0, gdp: 850, guard: 12, next: "2028-11", approval: 55, ind: 1.1,
      cities: [["Raleigh", 35.78, -78.64, 1.5], ["Charlotte", 35.23, -80.84, 2.8], ["Greensboro", 36.07, -79.79, 0.78], ["Asheville", 35.6, -82.55, 0.47], ["Wilmington, North Carolina", 34.23, -77.94, 0.3]] },
    { id: "nd", name: "North Dakota", short: "N. Dakota", leader: "Kelly Armstrong", party: "R", pop: 0.8, gdp: 75, guard: 4, next: "2028-11", approval: 58, u: 2.5, res: { oil: 1.2, gas: 2, grain: 3.5 },
      cities: [["Bismarck", 46.81, -100.78, 0.13], ["Fargo", 46.88, -96.79, 0.26], ["Minot", 48.23, -101.3, 0.08], ["Williston", 48.15, -103.62, 0.03]] },
    { id: "oh", name: "Ohio", leader: "Mike DeWine", party: "R", pop: 11.9, gdp: 930, guard: 16, next: "2026-11", approval: 50, ind: 1.3, res: { gas: 7, oil: 0.1, grain: 2 },
      cities: [["Columbus", 39.96, -83.0, 2.2], ["Cleveland", 41.5, -81.69, 2.1], ["Toledo", 41.66, -83.56, 0.6], ["Cincinnati", 39.1, -84.51, 2.3]] },
    { id: "ok", name: "Oklahoma", leader: "Kevin Stitt", party: "R", pop: 4.1, gdp: 260, guard: 9, next: "2026-11", approval: 50, res: { oil: 0.42, gas: 7, grain: 0.7 },
      cities: [["Oklahoma City", 35.47, -97.52, 1.5], ["Tulsa", 36.15, -95.99, 1.0], ["Lawton", 34.6, -98.39, 0.13], ["Guymon", 36.68, -101.48, 0.01]] },
    { id: "or", name: "Oregon", leader: "Tina Kotek", party: "D", pop: 4.3, gdp: 330, guard: 8, next: "2026-11", approval: 42,
      cities: [["Salem", 44.94, -123.04, 0.43], ["Portland", 45.52, -122.68, 2.5], ["Eugene", 44.05, -123.09, 0.38], ["Bend", 44.06, -121.32, 0.21], ["Medford", 42.33, -122.87, 0.22]] },
    { id: "pa", name: "Pennsylvania", leader: "Josh Shapiro", party: "D", pop: 13.1, gdp: 1020, guard: 18.5, next: "2026-11", approval: 58, ind: 1.1, res: { gas: 21, grain: 0.5 },
      cities: [["Harrisburg", 40.27, -76.88, 0.6], ["Philadelphia", 39.95, -75.17, 6.2], ["Scranton", 41.41, -75.66, 0.57], ["Erie", 42.13, -80.09, 0.27], ["Pittsburgh", 40.44, -80.0, 2.4]] },
    { id: "ri", name: "Rhode Island", leader: "Dan McKee", party: "D", pop: 1.1, gdp: 78, guard: 3, next: "2026-11", approval: 40,
      cities: [["Providence", 41.82, -71.41, 1.1]] },
    { id: "sc", name: "South Carolina", short: "S. Carolina", leader: "Henry McMaster", party: "R", pop: 5.5, gdp: 330, guard: 11, next: "2026-11", approval: 50, ind: 1.1,
      cities: [["Columbia", 34.0, -81.03, 0.85], ["Greenville", 34.85, -82.4, 0.95], ["Charleston", 32.78, -79.93, 0.8]] },
    { id: "sd", name: "South Dakota", short: "S. Dakota", leader: "Larry Rhoden", party: "R", pop: 0.92, gdp: 75, guard: 4, next: "2026-11", approval: 50, u: 1.9, res: { grain: 3 },
      cities: [["Pierre", 44.37, -100.35, 0.02], ["Sioux Falls", 43.55, -96.73, 0.3], ["Rapid City", 44.08, -103.23, 0.15]] },
    { id: "tn", name: "Tennessee", leader: "Bill Lee", party: "R", pop: 7.2, gdp: 540, guard: 14, next: "2026-11", approval: 52, ind: 1.1, res: { grain: 0.5 },
      cities: [["Nashville", 36.16, -86.78, 2.1], ["Memphis", 35.15, -90.05, 1.3], ["Chattanooga", 35.05, -85.31, 0.57], ["Knoxville", 35.96, -83.92, 0.9]] },
    { id: "tx", name: "Texas", leader: "Greg Abbott", party: "R", pop: 31.3, gdp: 2700, guard: 22, next: "2026-11", approval: 48, debt: 10, ind: 1.0, res: { oil: 6.0, gas: 33, grain: 1.5, uranium: 0.05 },
      cities: [["Austin", 30.27, -97.74, 2.5], ["Dallas", 32.78, -96.8, 8.1], ["Houston", 29.76, -95.37, 7.3], ["San Antonio", 29.42, -98.49, 2.7], ["Corpus Christi", 27.8, -97.4, 0.42], ["Brownsville", 25.9, -97.5, 0.43],
        ["El Paso", 31.76, -106.49, 0.87], ["Midland", 31.99, -102.08, 0.3], ["Lubbock", 33.58, -101.86, 0.33], ["Amarillo", 35.22, -101.83, 0.27]] },
    { id: "ut", name: "Utah", leader: "Spencer Cox", party: "R", pop: 3.5, gdp: 280, guard: 7.5, next: "2028-11", approval: 55, res: { copper: 1.3, oil: 0.15, uranium: 0.05 },
      cities: [["Salt Lake City", 40.76, -111.89, 1.3], ["Provo", 40.23, -111.66, 0.7], ["Moab", 38.57, -109.55, 0.01], ["St. George", 37.1, -113.58, 0.2]] },
    { id: "vt", name: "Vermont", leader: "Phil Scott", party: "R", pop: 0.65, gdp: 45, guard: 3.5, next: "2026-11", term: 2, approval: 70,
      cities: [["Montpelier", 44.26, -72.58, 0.06], ["Burlington", 44.48, -73.21, 0.23]] },
    { id: "va", name: "Virginia", leader: "Abigail Spanberger", party: "D", pop: 8.8, gdp: 760, guard: 9, next: "2029-11", approval: 52,
      cities: [["Richmond", 37.54, -77.44, 1.3], ["Arlington", 38.88, -77.1, 2.5], ["Virginia Beach", 36.85, -75.98, 1.8], ["Roanoke", 37.27, -79.94, 0.32]] },
    { id: "wa", name: "Washington", leader: "Bob Ferguson", party: "D", pop: 8.0, gdp: 860, guard: 8, next: "2028-11", approval: 45, ind: 1.1, res: { grain: 0.8 },
      cities: [["Olympia", 47.04, -122.9, 0.3], ["Seattle", 47.61, -122.33, 4.0], ["Bellingham", 48.75, -122.48, 0.23], ["Yakima", 46.6, -120.51, 0.26], ["Spokane", 47.66, -117.43, 0.6]] },
    { id: "wv", name: "West Virginia", short: "W. Virginia", leader: "Patrick Morrisey", party: "R", pop: 1.8, gdp: 100, guard: 6, next: "2028-11", approval: 45, res: { gas: 9 },
      cities: [["Charleston, West Virginia", 38.35, -81.63, 0.25], ["Huntington", 38.42, -82.45, 0.35], ["Morgantown", 39.63, -79.96, 0.14]] },
    { id: "wi", name: "Wisconsin", leader: "Tony Evers", party: "D", pop: 6.0, gdp: 430, guard: 9.5, next: "2026-11", approval: 48, ind: 1.2, res: { grain: 1.6 },
      cities: [["Madison", 43.07, -89.4, 0.68], ["Milwaukee", 43.04, -87.91, 1.6], ["Green Bay", 44.52, -88.02, 0.33], ["Eau Claire", 44.81, -91.5, 0.17]] },
    { id: "wy", name: "Wyoming", leader: "Mark Gordon", party: "R", pop: 0.59, gdp: 55, guard: 2.8, next: "2026-11", approval: 58, res: { oil: 0.3, gas: 3, uranium: 0.2 },
      cities: [["Cheyenne", 41.14, -104.82, 0.1], ["Casper", 42.87, -106.31, 0.08], ["Gillette", 44.29, -105.5, 0.03], ["Jackson", 43.48, -110.76, 0.01]] },
  ];

  /* THE UNION AS IT STANDS: the governors' parties are the two camps (a
     scenario of armed states is a country already coming apart along that
     line), plus the old regional quarrels and the real compacts. */
  const BLOCS = { red: [], blue: [] };
  LIST.forEach(function (s) { BLOCS[s.party === "R" ? "red" : "blue"].push(s.id); });
  const REL = [
    ["tx", "ca", -45], ["fl", "ca", -30], ["tx", "ny", -30], ["fl", "ny", -25], ["tx", "il", -25], ["ca", "or", 55], ["ca", "wa", 50], ["or", "wa", 60],
    ["tx", "ok", 40], ["tx", "la", 40], ["tx", "nm", -10], ["az", "ca", -10], ["nv", "ca", -10], ["ar", "tx", 25], ["ny", "nj", 40], ["nj", "pa", 30],
    ["ga", "fl", 40], ["ky", "tn", 20], ["dc", "md", 50], ["dc", "va", 40], ["mi", "oh", -10], ["mo", "ks", -15], ["il", "in", -10], ["ma", "nh", 10],
    ["vt", "nh", 20], ["co", "ut", 10], ["wy", "co", -5], ["id", "or", -15], ["wa", "id", -10], ["mn", "nd", -10], ["wi", "mn", 20],
  ];
  const ALLIANCES = [
    ["ca", "or", "wa", "hi"],                            // the West Coast Health Alliance (2025)
    ["ny", "nj", "ct", "ma", "ri", "pa", "de", "me"],    // the Northeast Public Health Collaborative (2025)
  ];
  const DIALS = {
    tx: [0.55, 0.15, 0.6, 0.6], ca: [0.35, 0.1, 0.4, 0.4], fl: [0.5, 0.15, 0.55, 0.6], ny: [0.3, 0.1, 0.4, 0.4],
    il: [0.35, 0.1, 0.4, 0.4], ok: [0.5, 0.15, 0.55, 0.6], la: [0.5, 0.2, 0.6, 0.6],
  };

  /* A state as world.js plays a country: the rest of a row (the money, the
     army, the vote) from what a state is. */
  function fill(s) {
    s.iso = s.id.toUpperCase();
    s.short = s.short || s.name;
    s.title = s.title || "Governor";
    s.reg = "us";
    s.pool = "anglo";
    s.regime = "democracy"; s.elections = true; s.freedom = 85;
    if (s.term == null) s.term = 4;
    if (s.approval == null) s.approval = 50;
    if (s.debt == null) s.debt = 15;
    if (s.u == null) s.u = 4.2;
    s.infl = 3.0; s.rate = 3.9;                  // one central bank and one currency, for now
    s.nukes = 0;
    if (s.ind == null) s.ind = 0.85;
    s.haven = 0.5;
    s.mil = 0.25;                                // what the Guard costs a state that pays for its own
    s.troops = s.guard;
    s.q = 0.9;
    s.res = s.res || {};
    s.parent = "usa";                            // its share of the world economy is a share of the USA's
    return s;
  }
  const byId = {};
  LIST.forEach(function (s) { fill(s); byId[s.id] = s; });
  CBZ.presStates = { AS_OF: AS_OF, list: LIST, byId: byId, BLOCS: BLOCS, REL: REL, ALLIANCES: ALLIANCES, DIALS: DIALS, WARS: [], SANCTIONS: [], TARIFFS: [] };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.presStates;
})(this);
