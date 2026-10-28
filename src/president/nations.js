/* ============================================================
   president/nations.js — THE REAL COUNTRIES IN PLAY, AND WHO RUNS THEM.

   OWNER (2026-10-28): "Real countries on a real world map, with the real
   current world leaders' names ... keep the names in one data file so
   they're easy to update."

   THIS IS THAT FILE. Everything a country IS at the start of a game lives
   in its row; president/world.js reads it and invents nothing about a
   country. The map under it is president/earth.js (Natural Earth borders);
   a row joins its land by `iso` (ISO 3166 numeric). Land that belongs to a
   country with no row here is drawn with its real border and name but is
   not in play.

   LEADERS: as of AS_OF, the best this repo knows (the model that wrote it
   has a mid-2026 knowledge cutoff). When a leader changes, change `leader`
   (and `title` if the office differs) on his row and nothing else.

   Numbers are round, public, recent: population (millions), GDP ($bn,
   nominal), government debt (% GDP), military spending (% GDP), Freedom
   House-style freedom (0-100), approval, unemployment, inflation and the
   policy rate (%). Resources are yearly output in rough real units, divided
   so the countries compare (oil Mb/d, gas 10 bcm, iron 10 Mt, copper
   100 kt, rare earths 5 kt, grain 10 Mt, uranium 500 t). `ind` weights
   manufacturing beyond GDP; `haven` is how much of the debt the market does
   not worry about (a reserve currency, a domestic saver base).

   Cities: the provinces. Each country's land is split among its cities
   (nearest city, grown over the country's own tiles), so a front moves city
   by city. `pop` is the metro in millions. `occ` names the country that
   holds the city on day one.

   PUBLIC  CBZ.presNations = { AS_OF, START, list, byId, names(pool) }
============================================================ */
(function (root) {
  "use strict";
  const G = (typeof window !== "undefined" && window) || root;
  const CBZ = G.CBZ = G.CBZ || {};

  const AS_OF = "2026-06";
  // the first day of the game: the calendar the papers print
  const START = { y: 2026, m: 11, d: 2 };

  // first names and surnames for the people around a leader (ministers, the
  // man who replaces him): real names of the country's own language, never
  // a real minister's name pinned on a made-up career
  const POOLS = {
    anglo: [["James", "Michael", "Sarah", "Robert", "Emily", "David", "Karen", "Thomas", "Laura", "Daniel", "Rachel", "Mark"], ["Miller", "Hayes", "Collins", "Turner", "Reed", "Walsh", "Carter", "Brooks", "Hughes", "Morgan", "Pierce", "Lawson"]],
    spanish: [["Carlos", "María", "Javier", "Lucía", "Alejandro", "Sofía", "Andrés", "Elena", "Diego", "Carmen", "Raúl", "Isabel"], ["García", "Martínez", "López", "Herrera", "Ruiz", "Navarro", "Castillo", "Romero", "Vargas", "Ortega", "Molina", "Flores"]],
    portuguese: [["João", "Ana", "Pedro", "Mariana", "Rafael", "Beatriz", "Lucas", "Camila", "Gustavo", "Fernanda", "Paulo", "Juliana"], ["Silva", "Santos", "Oliveira", "Souza", "Costa", "Pereira", "Almeida", "Ribeiro", "Carvalho", "Gomes", "Barbosa", "Rocha"]],
    french: [["Jean", "Claire", "Pierre", "Sophie", "Nicolas", "Camille", "Julien", "Isabelle", "Antoine", "Hélène", "Laurent", "Céline"], ["Martin", "Bernard", "Dubois", "Lefèvre", "Moreau", "Laurent", "Girard", "Roux", "Fontaine", "Chevalier", "Mercier", "Blanc"]],
    german: [["Thomas", "Anna", "Stefan", "Julia", "Markus", "Katrin", "Andreas", "Sabine", "Jens", "Claudia", "Matthias", "Petra"], ["Müller", "Schmidt", "Weber", "Becker", "Wagner", "Hoffmann", "Schulz", "Koch", "Richter", "Klein", "Wolf", "Neumann"]],
    italian: [["Marco", "Giulia", "Luca", "Francesca", "Andrea", "Chiara", "Matteo", "Valentina", "Paolo", "Silvia", "Stefano", "Elena"], ["Rossi", "Russo", "Ferrari", "Esposito", "Bianchi", "Romano", "Colombo", "Ricci", "Marino", "Greco", "Conti", "Gallo"]],
    polish: [["Piotr", "Anna", "Tomasz", "Katarzyna", "Marcin", "Magdalena", "Paweł", "Agnieszka", "Krzysztof", "Joanna", "Michał", "Ewa"], ["Nowak", "Kowalski", "Wiśniewski", "Wójcik", "Kamiński", "Lewandowski", "Zieliński", "Szymański", "Woźniak", "Dąbrowski", "Kozłowski", "Mazur"]],
    ukrainian: [["Oleksandr", "Olena", "Andriy", "Iryna", "Serhiy", "Natalia", "Dmytro", "Oksana", "Yuriy", "Tetiana", "Mykola", "Kateryna"], ["Shevchenko", "Kovalenko", "Bondarenko", "Tkachenko", "Kravchenko", "Oliynyk", "Melnyk", "Boyko", "Moroz", "Lysenko", "Marchenko", "Rudenko"]],
    russian: [["Sergei", "Olga", "Dmitry", "Irina", "Andrei", "Elena", "Alexei", "Natalia", "Mikhail", "Tatiana", "Nikolai", "Svetlana"], ["Ivanov", "Petrov", "Sokolov", "Kuznetsov", "Volkov", "Morozov", "Lebedev", "Kozlov", "Novikov", "Orlov", "Belov", "Zaitsev"]],
    turkish: [["Mehmet", "Ayşe", "Mustafa", "Fatma", "Ahmet", "Zeynep", "Emre", "Elif", "Murat", "Selin", "Hakan", "Deniz"], ["Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Aydın", "Öztürk", "Arslan", "Doğan", "Kılıç", "Aslan"]],
    hebrew: [["Yossi", "Noa", "Avi", "Michal", "Eitan", "Tamar", "Amir", "Yael", "Oren", "Shira", "Gideon", "Dana"], ["Cohen", "Levi", "Mizrahi", "Peretz", "Biton", "Dahan", "Avraham", "Friedman", "Azoulay", "Katz", "Ben-David", "Shapiro"]],
    arabic: [["Mohammed", "Fatima", "Ahmed", "Mariam", "Khaled", "Noura", "Omar", "Huda", "Youssef", "Layla", "Tariq", "Salma"], ["Al-Rashid", "Haddad", "Mansour", "Farouk", "Saleh", "Nasser", "Hamdan", "Aziz", "Khalil", "Said", "Hassan", "Ibrahim"]],
    persian: [["Ali", "Maryam", "Hossein", "Zahra", "Reza", "Fatemeh", "Mohammad", "Sara", "Mehdi", "Narges", "Hamid", "Leila"], ["Hosseini", "Rezaei", "Mohammadi", "Karimi", "Ahmadi", "Jafari", "Moradi", "Rahimi", "Sadeghi", "Hashemi", "Tehrani", "Ghorbani"]],
    urdu: [["Imran", "Ayesha", "Bilal", "Sana", "Usman", "Hira", "Faisal", "Nida", "Kamran", "Saima", "Asad", "Maryam"], ["Khan", "Malik", "Qureshi", "Chaudhry", "Butt", "Sheikh", "Rana", "Abbasi", "Mirza", "Siddiqui", "Hashmi", "Awan"]],
    hindi: [["Rahul", "Priya", "Amit", "Anjali", "Vikram", "Neha", "Suresh", "Kavita", "Arjun", "Pooja", "Rajesh", "Meera"], ["Sharma", "Verma", "Gupta", "Singh", "Patel", "Reddy", "Iyer", "Nair", "Joshi", "Mehta", "Rao", "Kapoor"]],
    chinese: [["Wei", "Li", "Jun", "Mei", "Hao", "Xiu", "Qiang", "Fang", "Lei", "Yan", "Jian", "Hua"], ["Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Zhao", "Huang", "Zhou", "Wu", "Xu", "Sun"]],
    korean: [["Min-jun", "Ji-woo", "Seo-jun", "Ha-eun", "Do-hyun", "Su-bin", "Ji-hoon", "Ye-jin", "Hyun-woo", "Eun-ji", "Sung-min", "Hye-jin"], ["Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon", "Jang", "Lim", "Han", "Shin"]],
    japanese: [["Hiroshi", "Yuko", "Takashi", "Akiko", "Kenji", "Naomi", "Satoshi", "Emi", "Daisuke", "Haruka", "Masato", "Keiko"], ["Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Kato", "Yoshida", "Yamada"]],
    indonesian: [["Budi", "Siti", "Agus", "Dewi", "Joko", "Sri", "Rudi", "Ratna", "Hendra", "Wulan", "Bambang", "Indah"], ["Santoso", "Wijaya", "Saputra", "Hidayat", "Kusuma", "Pratama", "Gunawan", "Setiawan", "Nugroho", "Halim", "Lestari", "Susanto"]],
    nigerian: [["Chinedu", "Ngozi", "Ibrahim", "Aisha", "Oluwaseun", "Funke", "Emeka", "Amina", "Tunde", "Chioma", "Musa", "Bisi"], ["Okafor", "Adeyemi", "Bello", "Okonkwo", "Abubakar", "Eze", "Balogun", "Usman", "Nwosu", "Adebayo", "Danjuma", "Ogunleye"]],
    southafrican: [["Thabo", "Naledi", "Sipho", "Lindiwe", "Johan", "Anele", "Pieter", "Zanele", "Mandla", "Nomsa", "Kagiso", "Busisiwe"], ["Nkosi", "Dlamini", "Botha", "Mokoena", "Ndlovu", "van der Merwe", "Khumalo", "Mahlangu", "Pillay", "Zulu", "Molefe", "Naidoo"]],
  };

  /* ONE ROW PER COUNTRY IN PLAY. Keys:
       id iso name short leader title pool color
       pop gdp debt mil freedom regime elections next (next national vote,
       "YYYY-MM") term (years) approval u infl rate nukes nukeProg ind haven
       res { oil gas iron copper rare grain uranium }
       cities [[name, lat, lon, pop, occ?], ...]   the first is the capital */
  const LIST = [
    { id: "usa", iso: "840", name: "United States", short: "USA", leader: "Donald Trump", title: "President", pool: "anglo", color: "#5b7fb8",
      pop: 340, gdp: 29200, debt: 121, mil: 3.4, freedom: 83, regime: "democracy", elections: true, next: "2028-11", term: 4,
      approval: 41, u: 4.3, infl: 3.0, rate: 3.9, nukes: 5044, ind: 0.85, haven: 0.5,
      res: { oil: 13, gas: 100, iron: 5, copper: 11, rare: 9, grain: 47, uranium: 0.3 },
      cities: [["Washington", 38.9, -77.0, 6.3], ["New York", 40.7, -74.0, 19.5], ["Boston", 42.4, -71.1, 4.9], ["Atlanta", 33.7, -84.4, 6.3], ["Miami", 25.8, -80.2, 6.1],
        ["Chicago", 41.9, -87.6, 9.3], ["Detroit", 42.3, -83.0, 4.3], ["Minneapolis", 44.98, -93.3, 3.7], ["Kansas City", 39.1, -94.6, 2.2], ["Houston", 29.8, -95.4, 7.3],
        ["Dallas", 32.8, -96.8, 8.1], ["Denver", 39.7, -105.0, 3.0], ["Phoenix", 33.4, -112.1, 5.1], ["Los Angeles", 34.05, -118.25, 12.8], ["San Francisco", 37.77, -122.4, 4.6],
        ["Seattle", 47.6, -122.3, 4.0], ["Salt Lake City", 40.8, -111.9, 1.3], ["Anchorage", 61.2, -149.9, 0.4], ["Honolulu", 21.3, -157.9, 1.0]] },
    { id: "can", iso: "124", name: "Canada", short: "Canada", leader: "Mark Carney", title: "Prime Minister", pool: "anglo", color: "#c45f5f",
      pop: 41, gdp: 2240, debt: 107, mil: 1.4, freedom: 97, regime: "democracy", elections: true, next: "2029-10", term: 4,
      approval: 50, u: 6.9, infl: 2.0, rate: 2.25, nukes: 0, ind: 0.7, haven: 0.2,
      res: { oil: 5, gas: 19, iron: 6, copper: 5, rare: 0.2, grain: 6, uranium: 14 },
      cities: [["Ottawa", 45.4, -75.7, 1.5], ["Toronto", 43.65, -79.4, 6.7], ["Montreal", 45.5, -73.6, 4.4], ["Quebec City", 46.8, -71.2, 0.8], ["Halifax", 44.65, -63.6, 0.5],
        ["Winnipeg", 49.9, -97.1, 0.9], ["Calgary", 51.05, -114.1, 1.6], ["Edmonton", 53.5, -113.5, 1.5], ["Vancouver", 49.3, -123.1, 2.8], ["Whitehorse", 60.7, -135.05, 0.03],
        ["Yellowknife", 62.45, -114.4, 0.02], ["Iqaluit", 63.75, -68.5, 0.01], ["Churchill", 58.77, -94.17, 0.01], ["Thunder Bay", 48.4, -89.25, 0.1]] },
    { id: "mex", iso: "484", name: "Mexico", short: "Mexico", leader: "Claudia Sheinbaum", title: "President", pool: "spanish", color: "#5f9e74",
      pop: 131, gdp: 1850, debt: 52, mil: 0.7, freedom: 60, regime: "democracy", elections: true, next: "2030-06", term: 6,
      approval: 70, u: 2.7, infl: 3.8, rate: 7.25, nukes: 0, ind: 1.2, haven: 0,
      res: { oil: 1.7, gas: 3, iron: 1, copper: 7.5, rare: 0, grain: 3.5, uranium: 0 },
      cities: [["Mexico City", 19.4, -99.1, 22.0], ["Guadalajara", 20.7, -103.35, 5.3], ["Monterrey", 25.7, -100.3, 5.3], ["Tijuana", 32.5, -117.0, 2.2], ["Chihuahua", 28.6, -106.1, 1.0],
        ["Mérida", 20.97, -89.6, 1.3], ["Hermosillo", 29.1, -110.95, 0.9], ["Oaxaca", 17.06, -96.7, 0.7]] },
    { id: "bra", iso: "076", name: "Brazil", short: "Brazil", leader: "Luiz Inácio Lula da Silva", title: "President", pool: "portuguese", color: "#6aa65a",
      pop: 212, gdp: 2170, debt: 87, mil: 1.1, freedom: 72, regime: "democracy", elections: true, next: "2030-10", term: 4,
      approval: 46, u: 6.0, infl: 5.0, rate: 15, nukes: 0, ind: 0.8, haven: 0,
      res: { oil: 3.4, gas: 2, iron: 44, copper: 3, rare: 0.1, grain: 12, uranium: 0.1 },
      cities: [["Brasília", -15.8, -47.9, 4.8], ["São Paulo", -23.55, -46.6, 22.6], ["Rio de Janeiro", -22.9, -43.2, 13.6], ["Belo Horizonte", -19.9, -43.95, 6.0], ["Salvador", -12.97, -38.5, 3.9],
        ["Recife", -8.05, -34.9, 4.1], ["Fortaleza", -3.73, -38.5, 4.1], ["Belém", -1.46, -48.5, 2.5], ["Manaus", -3.1, -60.0, 2.3], ["Porto Alegre", -30.0, -51.2, 4.4],
        ["Cuiabá", -15.6, -56.1, 0.9], ["Porto Velho", -8.76, -63.9, 0.5], ["Campo Grande", -20.45, -54.6, 0.9]] },
    { id: "arg", iso: "032", name: "Argentina", short: "Argentina", leader: "Javier Milei", title: "President", pool: "spanish", color: "#7fb3d9",
      pop: 46, gdp: 640, debt: 85, mil: 0.5, freedom: 85, regime: "democracy", elections: true, next: "2027-10", term: 4,
      approval: 45, u: 7.6, infl: 32, rate: 29, nukes: 0, ind: 0.6, haven: 0,
      res: { oil: 0.8, gas: 4.5, iron: 0, copper: 0, rare: 0, grain: 8, uranium: 0 },
      cities: [["Buenos Aires", -34.6, -58.4, 15.6], ["Córdoba", -31.4, -64.2, 1.6], ["Rosario", -32.95, -60.65, 1.4], ["Mendoza", -32.9, -68.85, 1.2], ["Salta", -24.8, -65.4, 0.7],
        ["Neuquén", -38.95, -68.06, 0.4], ["Comodoro Rivadavia", -45.86, -67.5, 0.2], ["Río Gallegos", -51.6, -69.2, 0.1], ["Bahía Blanca", -38.7, -62.27, 0.3]] },
    { id: "gbr", iso: "826", name: "United Kingdom", short: "UK", leader: "Keir Starmer", title: "Prime Minister", pool: "anglo", color: "#8c6ab0",
      pop: 69, gdp: 3600, debt: 101, mil: 2.3, freedom: 91, regime: "democracy", elections: true, next: "2029-08", term: 5,
      approval: 25, u: 4.8, infl: 3.6, rate: 4.0, nukes: 225, ind: 0.6, haven: 0.25,
      res: { oil: 0.7, gas: 3.5, iron: 0, copper: 0, rare: 0, grain: 2.2, uranium: 0 },
      cities: [["London", 51.5, -0.13, 9.6], ["Birmingham", 52.5, -1.9, 2.9], ["Manchester", 53.5, -2.25, 2.8], ["Newcastle", 54.97, -1.6, 1.1], ["Glasgow", 55.86, -4.25, 1.8], ["Belfast", 54.6, -5.93, 0.6], ["Inverness", 57.48, -4.22, 0.1]] },
    { id: "fra", iso: "250", name: "France", short: "France", leader: "Emmanuel Macron", title: "President", pool: "french", color: "#5d78c9",
      pop: 68, gdp: 3160, debt: 113, mil: 2.1, freedom: 89, regime: "democracy", elections: true, next: "2027-04", term: 5,
      approval: 20, u: 7.5, infl: 1.1, rate: 2.0, nukes: 290, ind: 0.8, haven: 0.2,
      res: { oil: 0, gas: 0, iron: 0, copper: 0, rare: 0, grain: 6, uranium: 0 },
      cities: [["Paris", 48.86, 2.35, 11.2], ["Lille", 50.63, 3.06, 1.5], ["Strasbourg", 48.58, 7.75, 0.8], ["Lyon", 45.76, 4.84, 2.3], ["Marseille", 43.3, 5.37, 1.9],
        ["Toulouse", 43.6, 1.44, 1.4], ["Bordeaux", 44.84, -0.58, 1.3], ["Nantes", 47.22, -1.55, 1.0], ["Cayenne", 4.92, -52.33, 0.15]] },
    { id: "deu", iso: "276", name: "Germany", short: "Germany", leader: "Friedrich Merz", title: "Chancellor", pool: "german", color: "#9a9a9a",
      pop: 84, gdp: 4660, debt: 63, mil: 2.1, freedom: 93, regime: "democracy", elections: true, next: "2029-03", term: 4,
      approval: 30, u: 3.6, infl: 2.1, rate: 2.0, nukes: 0, ind: 1.6, haven: 0.3,
      res: { oil: 0, gas: 0.5, iron: 0, copper: 0, rare: 0, grain: 4.2, uranium: 0 },
      cities: [["Berlin", 52.52, 13.4, 3.9], ["Hamburg", 53.55, 10.0, 1.9], ["Cologne", 50.94, 6.96, 3.6], ["Frankfurt", 50.11, 8.68, 2.7], ["Munich", 48.14, 11.58, 2.9], ["Leipzig", 51.34, 12.37, 1.0], ["Stuttgart", 48.78, 9.18, 2.8]] },
    { id: "ita", iso: "380", name: "Italy", short: "Italy", leader: "Giorgia Meloni", title: "Prime Minister", pool: "italian", color: "#7cae6e",
      pop: 59, gdp: 2370, debt: 137, mil: 1.5, freedom: 89, regime: "democracy", elections: true, next: "2027-09", term: 5,
      approval: 42, u: 6.3, infl: 1.6, rate: 2.0, nukes: 0, ind: 1.2, haven: 0.15,
      res: { oil: 0.1, gas: 0.3, iron: 0, copper: 0, rare: 0, grain: 1.6, uranium: 0 },
      cities: [["Rome", 41.9, 12.5, 4.3], ["Milan", 45.46, 9.19, 4.3], ["Turin", 45.07, 7.69, 1.7], ["Venice", 45.44, 12.33, 0.9], ["Naples", 40.85, 14.27, 3.1], ["Bari", 41.12, 16.87, 1.2], ["Palermo", 38.12, 13.36, 1.2], ["Cagliari", 39.22, 9.12, 0.4]] },
    { id: "esp", iso: "724", name: "Spain", short: "Spain", leader: "Pedro Sánchez", title: "Prime Minister", pool: "spanish", color: "#d4a94e",
      pop: 49, gdp: 1730, debt: 102, mil: 1.3, freedom: 90, regime: "democracy", elections: true, next: "2027-08", term: 4,
      approval: 35, u: 10.5, infl: 2.7, rate: 2.0, nukes: 0, ind: 0.8, haven: 0.1,
      res: { oil: 0, gas: 0, iron: 0, copper: 1, rare: 0, grain: 2, uranium: 0 },
      cities: [["Madrid", 40.42, -3.7, 6.8], ["Barcelona", 41.39, 2.17, 5.6], ["Valencia", 39.47, -0.38, 1.6], ["Seville", 37.39, -5.98, 1.5], ["Bilbao", 43.26, -2.93, 1.0], ["A Coruña", 43.36, -8.41, 0.4], ["Las Palmas", 28.12, -15.43, 0.4]] },
    { id: "pol", iso: "616", name: "Poland", short: "Poland", leader: "Donald Tusk", title: "Prime Minister", pool: "polish", color: "#c9707a",
      pop: 37, gdp: 910, debt: 55, mil: 4.1, freedom: 81, regime: "democracy", elections: true, next: "2027-10", term: 4,
      approval: 35, u: 3.0, infl: 3.0, rate: 4.5, nukes: 0, ind: 1.1, haven: 0,
      res: { oil: 0, gas: 0.4, iron: 0, copper: 4, rare: 0, grain: 3.5, uranium: 0 },
      cities: [["Warsaw", 52.23, 21.0, 3.1], ["Gdańsk", 54.35, 18.65, 1.1], ["Poznań", 52.4, 16.93, 1.0], ["Wrocław", 51.1, 17.03, 1.0], ["Kraków", 50.06, 19.94, 1.5], ["Białystok", 53.13, 23.16, 0.4]] },
    { id: "ukr", iso: "804", name: "Ukraine", short: "Ukraine", leader: "Volodymyr Zelenskyy", title: "President", pool: "ukrainian", color: "#e0c24f",
      pop: 33, gdp: 190, debt: 92, mil: 22, freedom: 49, regime: "democracy", elections: true, next: "2027-03", term: 5, martial: true,
      approval: 60, u: 12, infl: 12, rate: 15.5, nukes: 0, ind: 0.6, haven: 0,
      res: { oil: 0, gas: 1.8, iron: 5, copper: 0, rare: 0, grain: 6, uranium: 0.8 },
      cities: [["Kyiv", 50.45, 30.52, 3.5], ["Lviv", 49.84, 24.03, 0.7], ["Vinnytsia", 49.23, 28.47, 0.4], ["Kharkiv", 49.99, 36.23, 1.4], ["Dnipro", 48.46, 35.05, 1.0],
        ["Zaporizhzhia", 47.84, 35.14, 0.7], ["Odesa", 46.48, 30.72, 1.0], ["Chernihiv", 51.5, 31.3, 0.3], ["Donetsk", 48.0, 37.8, 0.9, "rus"], ["Luhansk", 48.57, 39.33, 0.4, "rus"], ["Mariupol", 47.1, 37.55, 0.2, "rus"], ["Simferopol", 44.95, 34.1, 0.9, "rus"]] },
    { id: "rus", iso: "643", name: "Russia", short: "Russia", leader: "Vladimir Putin", title: "President", pool: "russian", color: "#b35f5f",
      pop: 144, gdp: 2160, debt: 20, mil: 6.7, freedom: 13, regime: "autocracy", elections: false, next: "2030-03", term: 6,
      approval: 80, u: 2.5, infl: 8.5, rate: 16.5, nukes: 5580, ind: 0.8, haven: 0,
      res: { oil: 10, gas: 62, iron: 10, copper: 9, rare: 0.5, grain: 13, uranium: 5 },
      cities: [["Moscow", 55.76, 37.62, 13.0], ["Saint Petersburg", 59.94, 30.31, 5.6], ["Kaliningrad", 54.71, 20.51, 0.5], ["Murmansk", 68.97, 33.08, 0.3], ["Rostov-on-Don", 47.24, 39.7, 1.1],
        ["Volgograd", 48.71, 44.51, 1.0], ["Kazan", 55.8, 49.11, 1.3], ["Arkhangelsk", 64.54, 40.54, 0.3], ["Yekaterinburg", 56.84, 60.6, 1.5], ["Omsk", 54.99, 73.37, 1.1],
        ["Novosibirsk", 55.01, 82.93, 1.6], ["Norilsk", 69.35, 88.2, 0.2], ["Krasnoyarsk", 56.01, 92.85, 1.2], ["Irkutsk", 52.29, 104.3, 0.6], ["Yakutsk", 62.03, 129.73, 0.4],
        ["Khabarovsk", 48.48, 135.08, 0.6], ["Vladivostok", 43.12, 131.89, 0.6], ["Magadan", 59.56, 150.8, 0.1], ["Petropavlovsk", 53.02, 158.65, 0.2], ["Anadyr", 64.73, 177.5, 0.02], ["Surgut", 61.25, 73.4, 0.4]] },
    { id: "tur", iso: "792", name: "Turkey", short: "Turkey", leader: "Recep Tayyip Erdoğan", title: "President", pool: "turkish", color: "#c4664f",
      pop: 86, gdp: 1320, debt: 25, mil: 1.6, freedom: 33, regime: "hybrid", elections: true, next: "2028-05", term: 5,
      approval: 40, u: 8.5, infl: 33, rate: 39.5, nukes: 0, ind: 1.1, haven: 0,
      res: { oil: 0.1, gas: 0, iron: 1, copper: 1, rare: 0, grain: 3.8, uranium: 0 },
      cities: [["Ankara", 39.93, 32.86, 5.8], ["Istanbul", 41.01, 28.98, 15.7], ["Izmir", 38.42, 27.14, 4.4], ["Antalya", 36.9, 30.7, 2.7], ["Adana", 37.0, 35.32, 2.3], ["Trabzon", 41.0, 39.72, 0.8], ["Erzurum", 39.9, 41.27, 0.8], ["Diyarbakır", 37.91, 40.24, 1.8]] },
    { id: "isr", iso: "376", name: "Israel", short: "Israel", leader: "Benjamin Netanyahu", title: "Prime Minister", pool: "hebrew", color: "#6f9fd8",
      pop: 10, gdp: 540, debt: 69, mil: 8.8, freedom: 74, regime: "democracy", elections: true, next: "2026-10", term: 4,
      approval: 35, u: 3.0, infl: 3.0, rate: 4.5, nukes: 90, ind: 0.8, haven: 0,
      res: { oil: 0, gas: 2.5, iron: 0, copper: 0, rare: 0, grain: 0, uranium: 0 },
      cities: [["Jerusalem", 31.77, 35.21, 1.3], ["Tel Aviv", 32.08, 34.78, 4.2], ["Beersheba", 31.25, 34.79, 0.7], ["Haifa", 32.79, 34.99, 1.1]] },
    { id: "egy", iso: "818", name: "Egypt", short: "Egypt", leader: "Abdel Fattah el-Sisi", title: "President", pool: "arabic", color: "#c9ad6e",
      pop: 114, gdp: 390, debt: 90, mil: 1.2, freedom: 18, regime: "autocracy", elections: false, next: "2030-04", term: 6,
      approval: 50, u: 6.5, infl: 14, rate: 22, nukes: 0, ind: 0.6, haven: 0,
      res: { oil: 0.6, gas: 6, iron: 0, copper: 0, rare: 0, grain: 2.2, uranium: 0 },
      cities: [["Cairo", 30.04, 31.24, 22.6], ["Alexandria", 31.2, 29.92, 5.6], ["Marsa Matruh", 31.35, 27.24, 0.2], ["Asyut", 27.18, 31.18, 0.6], ["Luxor", 25.69, 32.64, 0.5], ["Aswan", 24.09, 32.9, 0.3], ["Kharga", 25.44, 30.55, 0.1], ["El Arish", 31.13, 33.8, 0.2]] },
    { id: "sau", iso: "682", name: "Saudi Arabia", short: "Saudi", leader: "Mohammed bin Salman", title: "Crown Prince", pool: "arabic", color: "#4f9a6a",
      pop: 34, gdp: 1100, debt: 26, mil: 7.1, freedom: 8, regime: "autocracy", elections: false, next: "", term: 0,
      approval: 70, u: 3.5, infl: 2.0, rate: 4.5, nukes: 0, ind: 0.6, haven: 0,
      res: { oil: 10, gas: 12, iron: 0, copper: 0, rare: 0, grain: 0.1, uranium: 0 },
      cities: [["Riyadh", 24.71, 46.68, 7.7], ["Jeddah", 21.49, 39.19, 4.7], ["Medina", 24.47, 39.61, 1.5], ["Dammam", 26.43, 50.1, 1.3], ["Tabuk", 28.38, 36.57, 0.7], ["Abha", 18.22, 42.5, 0.4], ["Hail", 27.52, 41.69, 0.4]] },
    { id: "irn", iso: "364", name: "Iran", short: "Iran", leader: "Ali Khamenei", title: "Supreme Leader", pool: "persian", color: "#5fa68c",
      pop: 90, gdp: 400, debt: 30, mil: 2.0, freedom: 11, regime: "autocracy", elections: false, next: "", term: 0,
      approval: 40, u: 8.0, infl: 40, rate: 23, nukes: 0, nukeProg: 250, ind: 0.8, haven: 0,
      res: { oil: 3.3, gas: 25, iron: 7, copper: 3, rare: 0, grain: 2, uranium: 0.2 },
      cities: [["Tehran", 35.69, 51.39, 9.5], ["Tabriz", 38.08, 46.29, 1.8], ["Mashhad", 36.3, 59.6, 3.3], ["Isfahan", 32.65, 51.67, 2.2], ["Shiraz", 29.59, 52.58, 1.9], ["Ahvaz", 31.32, 48.67, 1.3], ["Bandar Abbas", 27.18, 56.27, 0.6], ["Kerman", 30.28, 57.08, 0.8], ["Zahedan", 29.5, 60.86, 0.6]] },
    { id: "pak", iso: "586", name: "Pakistan", short: "Pakistan", leader: "Shehbaz Sharif", title: "Prime Minister", pool: "urdu", color: "#3f8a55",
      pop: 245, gdp: 375, debt: 70, mil: 2.8, freedom: 35, regime: "hybrid", elections: true, next: "2029-02", term: 5,
      approval: 40, u: 7.0, infl: 4.5, rate: 11, nukes: 170, ind: 0.6, haven: 0,
      res: { oil: 0.1, gas: 3, iron: 0, copper: 0.3, rare: 0, grain: 4.5, uranium: 0 },
      cities: [["Islamabad", 33.69, 73.05, 2.4], ["Lahore", 31.55, 74.34, 14.0], ["Karachi", 24.86, 67.0, 17.6], ["Peshawar", 34.01, 71.58, 2.3], ["Quetta", 30.18, 66.98, 1.2], ["Multan", 30.2, 71.47, 2.2], ["Gwadar", 25.13, 62.32, 0.1]] },
    { id: "ind", iso: "356", name: "India", short: "India", leader: "Narendra Modi", title: "Prime Minister", pool: "hindi", color: "#d38a4f",
      pop: 1440, gdp: 3900, debt: 83, mil: 2.4, freedom: 63, regime: "democracy", elections: true, next: "2029-05", term: 5,
      approval: 70, u: 7.5, infl: 2.0, rate: 5.5, nukes: 172, ind: 1.0, haven: 0,
      res: { oil: 0.6, gas: 3.5, iron: 28, copper: 0.5, rare: 0.6, grain: 33, uranium: 1.2 },
      cities: [["New Delhi", 28.61, 77.21, 33.0], ["Jaipur", 26.91, 75.79, 4.1], ["Ahmedabad", 23.02, 72.57, 8.6], ["Mumbai", 19.08, 72.88, 21.7], ["Pune", 18.52, 73.86, 7.2],
        ["Bengaluru", 12.97, 77.59, 14.0], ["Chennai", 13.08, 80.27, 12.0], ["Hyderabad", 17.39, 78.49, 11.0], ["Nagpur", 21.15, 79.09, 3.0], ["Kolkata", 22.57, 88.36, 15.5],
        ["Lucknow", 26.85, 80.95, 4.0], ["Patna", 25.59, 85.14, 2.6], ["Guwahati", 26.14, 91.74, 1.2], ["Srinagar", 34.08, 74.8, 1.5], ["Bhubaneswar", 20.3, 85.82, 1.2], ["Kochi", 9.93, 76.27, 2.3]] },
    { id: "chn", iso: "156", name: "China", short: "China", leader: "Xi Jinping", title: "President", pool: "chinese", color: "#c75353",
      pop: 1410, gdp: 18700, debt: 88, mil: 1.7, freedom: 9, regime: "autocracy", elections: false, next: "", term: 0,
      approval: 75, u: 5.2, infl: 0.2, rate: 3.0, nukes: 600, ind: 2.6, haven: 0.4,
      res: { oil: 4.2, gas: 23, iron: 28, copper: 18, rare: 54, grain: 63, uranium: 3.4 },
      cities: [["Beijing", 39.9, 116.4, 22.0], ["Tianjin", 39.13, 117.2, 14.0], ["Shanghai", 31.23, 121.47, 29.0], ["Nanjing", 32.06, 118.8, 9.5], ["Guangzhou", 23.13, 113.26, 19.0],
        ["Shenzhen", 22.54, 114.06, 13.0], ["Wuhan", 30.59, 114.3, 11.0], ["Chengdu", 30.67, 104.07, 16.0], ["Chongqing", 29.56, 106.55, 17.0], ["Xi'an", 34.34, 108.94, 9.0],
        ["Shenyang", 41.8, 123.43, 7.5], ["Harbin", 45.8, 126.53, 6.0], ["Kunming", 25.04, 102.71, 5.0], ["Nanning", 22.82, 108.32, 4.0], ["Lanzhou", 36.06, 103.83, 3.0],
        ["Hohhot", 40.84, 111.75, 2.5], ["Urumqi", 43.83, 87.62, 4.0], ["Kashgar", 39.47, 75.99, 0.7], ["Lhasa", 29.65, 91.13, 0.6], ["Xining", 36.62, 101.78, 1.3], ["Hailar", 49.21, 119.7, 0.3], ["Golmud", 36.4, 94.9, 0.2]] },
    { id: "prk", iso: "408", name: "North Korea", short: "N. Korea", leader: "Kim Jong Un", title: "Supreme Leader", pool: "korean", color: "#a85a6a",
      pop: 26, gdp: 28, debt: 10, mil: 20, freedom: 3, regime: "autocracy", elections: false, next: "", term: 0,
      approval: 90, u: 3, infl: 10, rate: 5, nukes: 50, ind: 0.5, haven: 0,
      res: { oil: 0, gas: 0, iron: 0.5, copper: 0.1, rare: 0.2, grain: 0.5, uranium: 0 },
      cities: [["Pyongyang", 39.04, 125.76, 3.0], ["Hamhung", 39.92, 127.54, 0.8], ["Chongjin", 41.8, 129.78, 0.7]] },
    { id: "kor", iso: "410", name: "South Korea", short: "S. Korea", leader: "Lee Jae-myung", title: "President", pool: "korean", color: "#5a8ccc",
      pop: 52, gdp: 1710, debt: 52, mil: 2.6, freedom: 83, regime: "democracy", elections: true, next: "2030-06", term: 5,
      approval: 55, u: 2.8, infl: 2.1, rate: 2.5, nukes: 0, ind: 1.8, haven: 0.1,
      res: { oil: 0, gas: 0, iron: 0, copper: 0, rare: 0, grain: 0.5, uranium: 0 },
      cities: [["Seoul", 37.57, 126.98, 26.0], ["Busan", 35.18, 129.08, 3.4], ["Gwangju", 35.16, 126.85, 1.5], ["Gangneung", 37.75, 128.9, 0.2]] },
    { id: "jpn", iso: "392", name: "Japan", short: "Japan", leader: "Sanae Takaichi", title: "Prime Minister", pool: "japanese", color: "#d97b7b",
      pop: 124, gdp: 4100, debt: 250, mil: 1.4, freedom: 96, regime: "democracy", elections: true, next: "2028-10", term: 4,
      approval: 65, u: 2.5, infl: 3.0, rate: 0.5, nukes: 0, ind: 1.5, haven: 0.65,
      res: { oil: 0, gas: 0, iron: 0, copper: 0, rare: 0, grain: 1, uranium: 0 },
      cities: [["Tokyo", 35.68, 139.69, 37.0], ["Osaka", 34.69, 135.5, 19.0], ["Nagoya", 35.18, 136.91, 9.5], ["Sendai", 38.27, 140.87, 2.3], ["Sapporo", 43.06, 141.35, 2.7], ["Hiroshima", 34.39, 132.46, 2.0], ["Fukuoka", 33.59, 130.4, 5.5], ["Naha", 26.21, 127.68, 0.8]] },
    { id: "idn", iso: "360", name: "Indonesia", short: "Indonesia", leader: "Prabowo Subianto", title: "President", pool: "indonesian", color: "#c96a5a",
      pop: 281, gdp: 1400, debt: 40, mil: 0.7, freedom: 57, regime: "hybrid", elections: true, next: "2029-02", term: 5,
      approval: 75, u: 4.9, infl: 2.0, rate: 4.75, nukes: 0, ind: 1.0, haven: 0,
      res: { oil: 0.6, gas: 6, iron: 0, copper: 9, rare: 0, grain: 8, uranium: 0 },
      cities: [["Jakarta", -6.21, 106.85, 34.0], ["Bandung", -6.92, 107.6, 8.5], ["Surabaya", -7.25, 112.75, 10.0], ["Denpasar", -8.65, 115.22, 1.0], ["Medan", 3.59, 98.67, 4.7], ["Palembang", -2.99, 104.76, 2.6],
        ["Pontianak", -0.03, 109.33, 0.7], ["Balikpapan", -1.27, 116.83, 0.8], ["Makassar", -5.15, 119.43, 1.7], ["Manado", 1.47, 124.84, 0.5], ["Ambon", -3.7, 128.18, 0.4], ["Kupang", -10.17, 123.6, 0.4], ["Jayapura", -2.53, 140.72, 0.4], ["Merauke", -8.5, 140.4, 0.1]] },
    { id: "aus", iso: "036", name: "Australia", short: "Australia", leader: "Anthony Albanese", title: "Prime Minister", pool: "anglo", color: "#4f8ab5",
      pop: 27, gdp: 1750, debt: 50, mil: 2.0, freedom: 95, regime: "democracy", elections: true, next: "2028-09", term: 3,
      approval: 50, u: 4.3, infl: 2.4, rate: 3.6, nukes: 0, ind: 0.4, haven: 0.2,
      res: { oil: 0.4, gas: 15, iron: 93, copper: 8, rare: 3.6, grain: 5, uranium: 10 },
      cities: [["Canberra", -35.28, 149.13, 0.5], ["Sydney", -33.87, 151.21, 5.5], ["Melbourne", -37.81, 144.96, 5.3], ["Brisbane", -27.47, 153.03, 2.7], ["Adelaide", -34.93, 138.6, 1.4],
        ["Perth", -31.95, 115.86, 2.3], ["Darwin", -12.46, 130.84, 0.15], ["Cairns", -16.92, 145.77, 0.16], ["Alice Springs", -23.7, 133.88, 0.03], ["Port Hedland", -20.31, 118.6, 0.02],
        ["Kalgoorlie", -30.75, 121.47, 0.03], ["Hobart", -42.88, 147.33, 0.25], ["Mount Isa", -20.73, 139.49, 0.02]] },
    { id: "nga", iso: "566", name: "Nigeria", short: "Nigeria", leader: "Bola Tinubu", title: "President", pool: "nigerian", color: "#5aa36a",
      pop: 230, gdp: 250, debt: 50, mil: 0.6, freedom: 44, regime: "hybrid", elections: true, next: "2027-02", term: 4,
      approval: 30, u: 5.0, infl: 20, rate: 27, nukes: 0, ind: 0.4, haven: 0,
      res: { oil: 1.5, gas: 4.5, iron: 0, copper: 0, rare: 0, grain: 3, uranium: 0 },
      cities: [["Abuja", 9.06, 7.49, 3.8], ["Lagos", 6.52, 3.38, 16.0], ["Ibadan", 7.38, 3.94, 3.9], ["Port Harcourt", 4.82, 7.03, 3.5], ["Kano", 12.0, 8.52, 4.4], ["Maiduguri", 11.83, 13.15, 1.1], ["Sokoto", 13.06, 5.24, 0.7]] },
    { id: "zaf", iso: "710", name: "South Africa", short: "S. Africa", leader: "Cyril Ramaphosa", title: "President", pool: "southafrican", color: "#e0a64f",
      pop: 63, gdp: 400, debt: 75, mil: 0.7, freedom: 79, regime: "democracy", elections: true, next: "2029-05", term: 5,
      approval: 40, u: 32, infl: 3.3, rate: 7.0, nukes: 0, ind: 0.6, haven: 0,
      res: { oil: 0, gas: 0, iron: 6, copper: 0.5, rare: 0.1, grain: 1.5, uranium: 0.4 },
      cities: [["Pretoria", -25.75, 28.19, 2.9], ["Johannesburg", -26.2, 28.05, 6.2], ["Durban", -29.86, 31.02, 3.9], ["Cape Town", -33.92, 18.42, 4.8], ["Gqeberha", -33.96, 25.6, 1.3], ["Bloemfontein", -29.12, 26.21, 0.6], ["Upington", -28.45, 21.25, 0.1], ["Polokwane", -23.9, 29.45, 0.8]] },
  ];

  /* THE WORLD AS IT STANDS ON DAY ONE: the blocs that like each other, the
     pairs that do not, the treaties, the war, the sanctions and tariffs. */
  const BLOCS = {
    west: ["usa", "can", "gbr", "fra", "deu", "ita", "esp", "pol", "jpn", "kor", "aus", "isr", "ukr"],
    east: ["rus", "chn", "irn", "prk"],
  };
  const REL = [   // pair overrides, -100..100
    ["rus", "ukr", -95], ["isr", "irn", -92], ["usa", "irn", -75], ["usa", "prk", -75], ["kor", "prk", -72], ["ind", "pak", -70],
    ["jpn", "prk", -65], ["usa", "rus", -55], ["pol", "rus", -75], ["gbr", "rus", -60], ["deu", "rus", -45], ["fra", "rus", -45],
    ["usa", "chn", -30], ["jpn", "chn", -35], ["ind", "chn", -25], ["aus", "chn", -15], ["kor", "chn", -5], ["tur", "isr", -45],
    ["sau", "irn", -20], ["egy", "isr", 5], ["sau", "isr", 0], ["rus", "chn", 62], ["rus", "prk", 68], ["rus", "irn", 52], ["chn", "prk", 40],
    ["chn", "irn", 35], ["chn", "pak", 60], ["usa", "isr", 80], ["usa", "gbr", 75], ["usa", "can", 40], ["usa", "mex", 15], ["ind", "rus", 35],
    ["usa", "ind", 25], ["usa", "sau", 45], ["tur", "rus", 15], ["bra", "chn", 30], ["zaf", "rus", 20], ["arg", "usa", 50],
  ];
  const ALLIANCES = [
    ["usa", "can", "gbr", "fra", "deu", "ita", "esp", "pol", "tur"],     // NATO, as far as it is in play
    ["usa", "jpn"], ["usa", "kor"], ["usa", "aus"], ["rus", "prk"],
  ];
  const WARS = [["rus", "ukr"]];
  const SANCTIONS = [   // [who, on whom]
    ["usa", "rus"], ["can", "rus"], ["gbr", "rus"], ["fra", "rus"], ["deu", "rus"], ["ita", "rus"], ["esp", "rus"], ["pol", "rus"], ["jpn", "rus"], ["aus", "rus"], ["ukr", "rus"],
    ["usa", "irn"], ["gbr", "irn"], ["fra", "irn"], ["deu", "irn"], ["isr", "irn"], ["usa", "prk"], ["kor", "prk"], ["jpn", "prk"],
  ];
  const TARIFFS = [["usa", "chn", 0.3], ["chn", "usa", 0.1], ["usa", "ind", 0.25], ["usa", "bra", 0.25], ["usa", "can", 0.1], ["usa", "mex", 0.1]];

  /* HOW A LEADER LEANS, where the record says (president/ai.js reads these):
     [aggr: reaches for the army, mad: how far he goes, auth: how little the
     vote and the press matter to him, prot: tariffs and caution]. A leader
     with no row here is rolled from the seed. */
  const DIALS = {
    usa: [0.5, 0.25, 0.45, 0.95], rus: [0.85, 0.45, 0.95, 0.6], chn: [0.5, 0.2, 0.95, 0.6], prk: [0.6, 0.6, 1.0, 0.9],
    irn: [0.6, 0.35, 0.95, 0.7], isr: [0.8, 0.25, 0.5, 0.4], tur: [0.5, 0.2, 0.7, 0.5], ind: [0.4, 0.15, 0.5, 0.6],
    pak: [0.45, 0.25, 0.6, 0.5], sau: [0.45, 0.15, 0.9, 0.4], ukr: [0.6, 0.1, 0.4, 0.3], egy: [0.3, 0.1, 0.85, 0.5],
  };

  /* ARMIES BIGGER THAN THEIR BUDGETS: conscript armies and armies kept in
     the field by other people's money fight above what their own military
     spending buys (divisions; the budget gives the rest of the world theirs). */
  const ARMY = { ukr: 27, rus: 31, prk: 14, irn: 12, pak: 14, egy: 9, isr: 14, kor: 18, tur: 15, ind: 30 };

  const byId = {};
  LIST.forEach(function (n) { byId[n.id] = n; if (ARMY[n.id]) n.army = ARMY[n.id]; });
  CBZ.presNations = {
    AS_OF: AS_OF, START: START, list: LIST, byId: byId, POOLS: POOLS, DIALS: DIALS,
    BLOCS: BLOCS, REL: REL, ALLIANCES: ALLIANCES, WARS: WARS, SANCTIONS: SANCTIONS, TARIFFS: TARIFFS,
    names: function (pool) { return POOLS[pool] || POOLS.anglo; },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.presNations;
})(this);
