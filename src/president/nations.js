/* ============================================================
   president/nations.js — EVERY REAL COUNTRY, AND WHO RUNS IT.

   OWNER (2026-10-28): "Real countries on a real world map, with the real
   current world leaders' names ... keep the names in one data file so
   they're easy to update." And: "EVERY REAL COUNTRY in each region".

   THIS IS THAT FILE: every UN member Natural Earth draws, plus Taiwan,
   Kosovo and Palestine (196 rows). Everything a country IS at the start of
   a game lives in its row; president/world.js reads it and invents nothing
   about a country. The map under it is president/earth.js (Natural Earth
   borders); a row joins its land by `iso` (ISO 3166 numeric, "n:<name>"
   where there is none) and `also` (its territories: Greenland is
   Denmark's, Puerto Rico the USA's). Which rows play together is a
   scenario (president/scenarios.js) by `reg` (na, sa, eu, me, af, as, oc).
   The US states for the state-against-state game are president/states.js.

   LEADERS: as of AS_OF, the best this repo knows (the model that wrote it
   has a mid-2026 knowledge cutoff). When a leader changes, change `leader`
   (and `title` if the office differs) on his row and nothing else.

   Numbers are round, public, recent: population (millions), GDP ($bn,
   nominal), government debt (% GDP), military spending (% GDP), troops
   (active soldiers, thousands), q (how well they fight: training, kit, the
   air; 1 = a modern Western army), regime (democracy / hybrid / autocracy),
   Freedom
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

   A short row (most of the world) leaves out what fill() can say from its
   kind: elections from its regime, a normal debt and inflation, no oil.

   PUBLIC  CBZ.presNations = { AS_OF, START, list, byId, names(pool), fill,
     BLOCS, REL, ALLIANCES, WARS, SANCTIONS, TARIFFS, DIALS }
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
    dutch: [["Jan", "Sanne", "Pieter", "Anouk", "Bram", "Lotte", "Joost", "Femke", "Daan", "Eva", "Ruben", "Marieke"], ["de Jong", "Jansen", "de Vries", "van den Berg", "Bakker", "Visser", "Smit", "Mulder", "Peeters", "Janssens", "Maes", "Willems"]],
    nordic: [["Lars", "Ingrid", "Anders", "Sofie", "Mikael", "Freja", "Erik", "Astrid", "Jonas", "Maja", "Henrik", "Sigrid"], ["Hansen", "Johansson", "Nielsen", "Andersson", "Larsen", "Lindqvist", "Berg", "Virtanen", "Korhonen", "Jónsson", "Dahl", "Nyström"]],
    baltic: [["Andrius", "Rūta", "Jānis", "Ilze", "Tomas", "Kadri", "Mārtiņš", "Laura", "Mart", "Liis", "Mindaugas", "Inga"], ["Kazlauskas", "Bērziņš", "Tamm", "Jankauskas", "Kalniņš", "Saar", "Petrauskas", "Ozoliņš", "Mägi", "Vasiliauskas", "Liepiņš", "Kask"]],
    czech: [["Jan", "Petra", "Tomáš", "Lucie", "Martin", "Jana", "Lukáš", "Kateřina", "Peter", "Zuzana", "Ondřej", "Eva"], ["Novák", "Svoboda", "Novotný", "Dvořák", "Černý", "Procházka", "Horváth", "Kováč", "Varga", "Tóth", "Kučera", "Veselý"]],
    magyar: [["László", "Katalin", "István", "Zsófia", "Gábor", "Eszter", "Péter", "Anna", "Zoltán", "Réka", "Balázs", "Judit"], ["Nagy", "Kovács", "Tóth", "Szabó", "Horváth", "Varga", "Kiss", "Molnár", "Németh", "Farkas", "Balogh", "Papp"]],
    romanian: [["Andrei", "Elena", "Mihai", "Ioana", "Alexandru", "Maria", "Ion", "Ana", "Vlad", "Cristina", "Radu", "Diana"], ["Popescu", "Ionescu", "Popa", "Stan", "Dumitru", "Constantin", "Munteanu", "Rusu", "Ciobanu", "Lungu", "Moraru", "Toma"]],
    southslav: [["Marko", "Ana", "Nikola", "Milica", "Ivan", "Jelena", "Stefan", "Maja", "Luka", "Ivana", "Dimitar", "Elena"], ["Petrović", "Jovanović", "Horvat", "Kovačević", "Novak", "Hodžić", "Popović", "Georgiev", "Ivanov", "Kranjc", "Hoxha", "Krasniqi"]],
    greek: [["Giorgos", "Maria", "Nikos", "Eleni", "Dimitris", "Katerina", "Yannis", "Sofia", "Kostas", "Anna", "Christos", "Ioanna"], ["Papadopoulos", "Georgiou", "Nikolaou", "Ioannou", "Konstantinou", "Christodoulou", "Pappas", "Vlachos", "Andreou", "Michailidis", "Oikonomou", "Karagiannis"]],
    georgian: [["Giorgi", "Nino", "Davit", "Tamar", "Levan", "Mariam", "Irakli", "Ana", "Zurab", "Ketevan", "Nika", "Salome"], ["Beridze", "Kapanadze", "Gelashvili", "Maisuradze", "Lomidze", "Tsiklauri", "Kvaratskhelia", "Japaridze", "Abashidze", "Chkheidze", "Bolkvadze", "Mamaladze"]],
    armenian: [["Aram", "Ani", "Davit", "Lusine", "Narek", "Mariam", "Tigran", "Anahit", "Hayk", "Nare", "Gor", "Armine"], ["Grigoryan", "Sargsyan", "Harutyunyan", "Hakobyan", "Petrosyan", "Khachatryan", "Vardanyan", "Karapetyan", "Avetisyan", "Mkrtchyan", "Hovhannisyan", "Ghazaryan"]],
    turkic: [["Nursultan", "Aigerim", "Rustam", "Dilnoza", "Arman", "Gulnara", "Timur", "Madina", "Elnur", "Leyla", "Bakhyt", "Aida"], ["Nurlanov", "Abdullaev", "Karimov", "Aliyev", "Mammadov", "Bekov", "Seitkali", "Yusupov", "Rakhimov", "Ismailov", "Toktogulov", "Orazov"]],
    bengali: [["Rahim", "Fatema", "Karim", "Nusrat", "Arif", "Sumaiya", "Tanvir", "Sharmin", "Shafiq", "Ruma", "Imran", "Farzana"], ["Rahman", "Hossain", "Islam", "Ahmed", "Chowdhury", "Uddin", "Sarkar", "Khatun", "Begum", "Mia", "Talukder", "Alam"]],
    nepali: [["Ram", "Sita", "Bikash", "Sunita", "Prakash", "Anita", "Rajendra", "Gita", "Sanjay", "Kamala", "Dorji", "Pema"], ["Sharma", "Thapa", "Gurung", "Shrestha", "Adhikari", "Rai", "Tamang", "Karki", "Poudel", "Magar", "Wangchuk", "Dorji"]],
    sinhala: [["Nimal", "Kumari", "Sunil", "Chamari", "Ruwan", "Dilani", "Kasun", "Nadeesha", "Ahmed", "Aishath", "Pradeep", "Sanduni"], ["Perera", "Fernando", "de Silva", "Jayasuriya", "Bandara", "Wickramasinghe", "Rajapaksa", "Gunawardena", "Dissanayake", "Herath", "Shareef", "Didi"]],
    burmese: [["Aung", "Thandar", "Kyaw", "Hnin", "Zaw", "Su", "Min", "Ei", "Htun", "Khin", "Soe", "May"], ["Win", "Myint", "Thein", "Oo", "Naing", "Htet", "Lwin", "Maung", "Tun", "Zin", "Aye", "Kyi"]],
    thai: [["Somchai", "Siriporn", "Anan", "Malai", "Chai", "Ploy", "Kittisak", "Nok", "Somsak", "Pim", "Bounmy", "Vanh"], ["Saetang", "Srisuk", "Wongsawat", "Chaiyaporn", "Rattanakul", "Boonmee", "Thongchai", "Phommachanh", "Vongsa", "Sisavath", "Keomany", "Inthavong"]],
    khmer: [["Sokha", "Sreymom", "Vuthy", "Chenda", "Dara", "Bopha", "Rithy", "Sophea", "Chantha", "Kanha", "Pisey", "Visal"], ["Sok", "Chea", "Kim", "Heng", "Meas", "Chan", "Keo", "Sam", "Ouk", "Prak", "Tep", "Nhem"]],
    viet: [["Minh", "Lan", "Tuan", "Hoa", "Duc", "Mai", "Hung", "Thu", "Quang", "Linh", "Thanh", "Huong"], ["Nguyen", "Tran", "Le", "Pham", "Hoang", "Phan", "Vu", "Dang", "Bui", "Do", "Ngo", "Duong"]],
    malay: [["Ahmad", "Siti", "Azman", "Nurul", "Hafiz", "Aisyah", "Faizal", "Nor", "Rizal", "Zainab", "Hakim", "Farah"], ["bin Abdullah", "binti Ismail", "bin Hassan", "bin Ibrahim", "bin Yusof", "binti Omar", "bin Rahman", "bin Salleh", "binti Ahmad", "bin Ali", "bin Mohd Noor", "bin Razak"]],
    filipino: [["Jose", "Maria", "Juan", "Ana", "Mark", "Grace", "Ramon", "Liza", "Paolo", "Joy", "Miguel", "Kristine"], ["Santos", "Reyes", "Cruz", "Bautista", "Ocampo", "Garcia", "Mendoza", "Torres", "Villanueva", "Ramos", "Aquino", "Dela Cruz"]],
    mongol: [["Bat-Erdene", "Oyunchimeg", "Ganbold", "Sarnai", "Tömör", "Altantsetseg", "Bold", "Enkhjargal", "Sükhbaatar", "Delger", "Munkh", "Tsetseg"], ["Batbayar", "Ganbaatar", "Enkhbold", "Dorj", "Tsogt", "Purev", "Baatar", "Erdene", "Choijil", "Damdin", "Bayar", "Zorig"]],
    swahili: [["Juma", "Amina", "Baraka", "Neema", "Hassan", "Zawadi", "Joseph", "Grace", "Daudi", "Rehema", "Peter", "Mercy"], ["Mwangi", "Otieno", "Kamau", "Njoroge", "Ochieng", "Mutua", "Hamisi", "Mollel", "Okello", "Nakato", "Deng", "Garang"]],
    horn: [["Abebe", "Hiwot", "Dawit", "Meron", "Yohannes", "Selam", "Mohamed", "Hodan", "Tesfaye", "Rahel", "Abdi", "Sahra"], ["Tadesse", "Bekele", "Haile", "Girma", "Tesfaye", "Mengistu", "Abdullahi", "Warsame", "Gebremedhin", "Asfaw", "Farah", "Mohamud"]],
    bantu: [["Jean-Pierre", "Chantal", "Patrice", "Grace", "Moses", "Esther", "Tendai", "Chipo", "Mulenga", "Thandiwe", "Emmanuel", "Mbali"], ["Kabila", "Mukendi", "Ilunga", "Banda", "Phiri", "Moyo", "Ncube", "Mwale", "Nkurunziza", "Uwimana", "Shikongo", "Masire"]],
    westafrica: [["Mamadou", "Aminata", "Moussa", "Fatoumata", "Kwame", "Ama", "Ousmane", "Mariama", "Kofi", "Awa", "Ibrahima", "Akosua"], ["Diallo", "Traoré", "Koné", "Ouédraogo", "Camara", "Mensah", "Sow", "Coulibaly", "Diop", "Asante", "Keita", "Ndiaye"]],
    malagasy: [["Hery", "Voahangy", "Rivo", "Lalao", "Andry", "Tiana", "Haja", "Fara", "Mamy", "Nirina", "Tojo", "Hanta"], ["Rakoto", "Rasoanaivo", "Randria", "Rabe", "Razafy", "Andriana", "Rakotomalala", "Raharison", "Ratsimba", "Ravelo", "Rajaonarison", "Rasolofo"]],
    pacific: [["Sione", "Mele", "Tevita", "Ana", "Josefa", "Litia", "Peni", "Salote", "John", "Mary", "Iosefa", "Losana"], ["Tuilagi", "Vaka", "Fifita", "Taufa", "Naidu", "Kaitani", "Wari", "Kila", "Tiban", "Tonga", "Faleolo", "Rabukawaqa"]],
  };

  /* ONE ROW PER COUNTRY IN PLAY. Keys:
       id iso name short leader title pool color
       pop gdp debt mil freedom regime elections next (next national vote,
       "YYYY-MM") term (years) approval u infl rate nukes nukeProg ind haven
       res { oil gas iron copper rare grain uranium }
       cities [[name, lat, lon, pop, occ?], ...]   the first is the capital */
  const LIST = [
    { id: "usa", iso: "840", name: "United States", short: "USA", leader: "Donald Trump", title: "President", pool: "anglo", color: "#5b7fb8", reg: "na", troops: 1320, q: 1.25, also: ["630", "016", "316", "580", "850"],
      pop: 340, gdp: 29200, debt: 121, mil: 3.4, freedom: 83, regime: "democracy", elections: true, next: "2028-11", term: 4,
      approval: 41, u: 4.3, infl: 3.0, rate: 3.9, nukes: 5044, ind: 0.85, haven: 0.5,
      res: { oil: 13, gas: 100, iron: 5, copper: 11, rare: 9, grain: 47, uranium: 0.3 },
      cities: [["Washington", 38.9, -77.0, 6.3], ["New York", 40.7, -74.0, 19.5], ["Boston", 42.4, -71.1, 4.9], ["Atlanta", 33.7, -84.4, 6.3], ["Miami", 25.8, -80.2, 6.1],
        ["Chicago", 41.9, -87.6, 9.3], ["Detroit", 42.3, -83.0, 4.3], ["Minneapolis", 44.98, -93.3, 3.7], ["Kansas City", 39.1, -94.6, 2.2], ["Houston", 29.8, -95.4, 7.3],
        ["Dallas", 32.8, -96.8, 8.1], ["Denver", 39.7, -105.0, 3.0], ["Phoenix", 33.4, -112.1, 5.1], ["Los Angeles", 34.05, -118.25, 12.8], ["San Francisco", 37.77, -122.4, 4.6],
        ["Seattle", 47.6, -122.3, 4.0], ["Salt Lake City", 40.8, -111.9, 1.3], ["Anchorage", 61.2, -149.9, 0.4], ["Honolulu", 21.3, -157.9, 1.0]] },
    { id: "can", iso: "124", name: "Canada", short: "Canada", leader: "Mark Carney", title: "Prime Minister", pool: "anglo", color: "#c45f5f", reg: "na", troops: 68, q: 1.0,
      pop: 41, gdp: 2240, debt: 107, mil: 1.4, freedom: 97, regime: "democracy", elections: true, next: "2029-10", term: 4,
      approval: 50, u: 6.9, infl: 2.0, rate: 2.25, nukes: 0, ind: 0.7, haven: 0.2,
      res: { oil: 5, gas: 19, iron: 6, copper: 5, rare: 0.2, grain: 6, uranium: 14 },
      cities: [["Ottawa", 45.4, -75.7, 1.5], ["Toronto", 43.65, -79.4, 6.7], ["Montreal", 45.5, -73.6, 4.4], ["Quebec City", 46.8, -71.2, 0.8], ["Halifax", 44.65, -63.6, 0.5],
        ["Winnipeg", 49.9, -97.1, 0.9], ["Calgary", 51.05, -114.1, 1.6], ["Edmonton", 53.5, -113.5, 1.5], ["Vancouver", 49.3, -123.1, 2.8], ["Whitehorse", 60.7, -135.05, 0.03],
        ["Yellowknife", 62.45, -114.4, 0.02], ["Iqaluit", 63.75, -68.5, 0.01], ["Churchill", 58.77, -94.17, 0.01], ["Thunder Bay", 48.4, -89.25, 0.1]] },
    { id: "mex", iso: "484", name: "Mexico", short: "Mexico", leader: "Claudia Sheinbaum", title: "President", pool: "spanish", color: "#5f9e74", reg: "na", troops: 260, q: 0.5,
      pop: 131, gdp: 1850, debt: 52, mil: 0.7, freedom: 60, regime: "democracy", elections: true, next: "2030-06", term: 6,
      approval: 70, u: 2.7, infl: 3.8, rate: 7.25, nukes: 0, ind: 1.2, haven: 0,
      res: { oil: 1.7, gas: 3, iron: 1, copper: 7.5, rare: 0, grain: 3.5, uranium: 0 },
      cities: [["Mexico City", 19.4, -99.1, 22.0], ["Guadalajara", 20.7, -103.35, 5.3], ["Monterrey", 25.7, -100.3, 5.3], ["Tijuana", 32.5, -117.0, 2.2], ["Chihuahua", 28.6, -106.1, 1.0],
        ["Mérida", 20.97, -89.6, 1.3], ["Hermosillo", 29.1, -110.95, 0.9], ["Oaxaca", 17.06, -96.7, 0.7]] },
    { id: "bra", iso: "076", name: "Brazil", short: "Brazil", leader: "Luiz Inácio Lula da Silva", title: "President", pool: "portuguese", color: "#6aa65a", reg: "sa", troops: 370, q: 0.6,
      pop: 212, gdp: 2170, debt: 87, mil: 1.1, freedom: 72, regime: "democracy", elections: true, next: "2030-10", term: 4,
      approval: 46, u: 6.0, infl: 5.0, rate: 15, nukes: 0, ind: 0.8, haven: 0,
      res: { oil: 3.4, gas: 2, iron: 44, copper: 3, rare: 0.1, grain: 12, uranium: 0.1 },
      cities: [["Brasília", -15.8, -47.9, 4.8], ["São Paulo", -23.55, -46.6, 22.6], ["Rio de Janeiro", -22.9, -43.2, 13.6], ["Belo Horizonte", -19.9, -43.95, 6.0], ["Salvador", -12.97, -38.5, 3.9],
        ["Recife", -8.05, -34.9, 4.1], ["Fortaleza", -3.73, -38.5, 4.1], ["Belém", -1.46, -48.5, 2.5], ["Manaus", -3.1, -60.0, 2.3], ["Porto Alegre", -30.0, -51.2, 4.4],
        ["Cuiabá", -15.6, -56.1, 0.9], ["Porto Velho", -8.76, -63.9, 0.5], ["Campo Grande", -20.45, -54.6, 0.9]] },
    { id: "arg", iso: "032", name: "Argentina", short: "Argentina", leader: "Javier Milei", title: "President", pool: "spanish", color: "#7fb3d9", reg: "sa", troops: 72, q: 0.55,
      pop: 46, gdp: 640, debt: 85, mil: 0.5, freedom: 85, regime: "democracy", elections: true, next: "2027-10", term: 4,
      approval: 45, u: 7.6, infl: 32, rate: 29, nukes: 0, ind: 0.6, haven: 0,
      res: { oil: 0.8, gas: 4.5, iron: 0, copper: 0, rare: 0, grain: 8, uranium: 0 },
      cities: [["Buenos Aires", -34.6, -58.4, 15.6], ["Córdoba", -31.4, -64.2, 1.6], ["Rosario", -32.95, -60.65, 1.4], ["Mendoza", -32.9, -68.85, 1.2], ["Salta", -24.8, -65.4, 0.7],
        ["Neuquén", -38.95, -68.06, 0.4], ["Comodoro Rivadavia", -45.86, -67.5, 0.2], ["Río Gallegos", -51.6, -69.2, 0.1], ["Bahía Blanca", -38.7, -62.27, 0.3]] },
    { id: "gbr", iso: "826", name: "United Kingdom", short: "UK", leader: "Keir Starmer", title: "Prime Minister", pool: "anglo", color: "#8c6ab0", reg: "eu", troops: 140, q: 1.1, also: ["238", "136", "060", "092", "796", "500", "660", "832", "831", "833", "654", "612", "239", "086"],
      pop: 69, gdp: 3600, debt: 101, mil: 2.3, freedom: 91, regime: "democracy", elections: true, next: "2029-08", term: 5,
      approval: 25, u: 4.8, infl: 3.6, rate: 4.0, nukes: 225, ind: 0.6, haven: 0.25,
      res: { oil: 0.7, gas: 3.5, iron: 0, copper: 0, rare: 0, grain: 2.2, uranium: 0 },
      cities: [["London", 51.5, -0.13, 9.6], ["Birmingham", 52.5, -1.9, 2.9], ["Manchester", 53.5, -2.25, 2.8], ["Newcastle", 54.97, -1.6, 1.1], ["Glasgow", 55.86, -4.25, 1.8], ["Belfast", 54.6, -5.93, 0.6], ["Inverness", 57.48, -4.22, 0.1]] },
    { id: "fra", iso: "250", name: "France", short: "France", leader: "Emmanuel Macron", title: "President", pool: "french", color: "#5d78c9", reg: "eu", troops: 200, q: 1.1, also: ["666", "876", "663", "652", "258", "540", "260"],
      pop: 68, gdp: 3160, debt: 113, mil: 2.1, freedom: 89, regime: "democracy", elections: true, next: "2027-04", term: 5,
      approval: 20, u: 7.5, infl: 1.1, rate: 2.0, nukes: 290, ind: 0.8, haven: 0.2,
      res: { oil: 0, gas: 0, iron: 0, copper: 0, rare: 0, grain: 6, uranium: 0 },
      cities: [["Paris", 48.86, 2.35, 11.2], ["Lille", 50.63, 3.06, 1.5], ["Strasbourg", 48.58, 7.75, 0.8], ["Lyon", 45.76, 4.84, 2.3], ["Marseille", 43.3, 5.37, 1.9],
        ["Toulouse", 43.6, 1.44, 1.4], ["Bordeaux", 44.84, -0.58, 1.3], ["Nantes", 47.22, -1.55, 1.0], ["Cayenne", 4.92, -52.33, 0.15]] },
    { id: "deu", iso: "276", name: "Germany", short: "Germany", leader: "Friedrich Merz", title: "Chancellor", pool: "german", color: "#9a9a9a", reg: "eu", troops: 182, q: 0.95,
      pop: 84, gdp: 4660, debt: 63, mil: 2.1, freedom: 93, regime: "democracy", elections: true, next: "2029-03", term: 4,
      approval: 30, u: 3.6, infl: 2.1, rate: 2.0, nukes: 0, ind: 1.6, haven: 0.3,
      res: { oil: 0, gas: 0.5, iron: 0, copper: 0, rare: 0, grain: 4.2, uranium: 0 },
      cities: [["Berlin", 52.52, 13.4, 3.9], ["Hamburg", 53.55, 10.0, 1.9], ["Cologne", 50.94, 6.96, 3.6], ["Frankfurt", 50.11, 8.68, 2.7], ["Munich", 48.14, 11.58, 2.9], ["Leipzig", 51.34, 12.37, 1.0], ["Stuttgart", 48.78, 9.18, 2.8]] },
    { id: "ita", iso: "380", name: "Italy", short: "Italy", leader: "Giorgia Meloni", title: "Prime Minister", pool: "italian", color: "#7cae6e", reg: "eu", troops: 165, q: 0.9,
      pop: 59, gdp: 2370, debt: 137, mil: 1.5, freedom: 89, regime: "democracy", elections: true, next: "2027-09", term: 5,
      approval: 42, u: 6.3, infl: 1.6, rate: 2.0, nukes: 0, ind: 1.2, haven: 0.15,
      res: { oil: 0.1, gas: 0.3, iron: 0, copper: 0, rare: 0, grain: 1.6, uranium: 0 },
      cities: [["Rome", 41.9, 12.5, 4.3], ["Milan", 45.46, 9.19, 4.3], ["Turin", 45.07, 7.69, 1.7], ["Venice", 45.44, 12.33, 0.9], ["Naples", 40.85, 14.27, 3.1], ["Bari", 41.12, 16.87, 1.2], ["Palermo", 38.12, 13.36, 1.2], ["Cagliari", 39.22, 9.12, 0.4]] },
    { id: "esp", iso: "724", name: "Spain", short: "Spain", leader: "Pedro Sánchez", title: "Prime Minister", pool: "spanish", color: "#d4a94e", reg: "eu", troops: 122, q: 0.9,
      pop: 49, gdp: 1730, debt: 102, mil: 1.3, freedom: 90, regime: "democracy", elections: true, next: "2027-08", term: 4,
      approval: 35, u: 10.5, infl: 2.7, rate: 2.0, nukes: 0, ind: 0.8, haven: 0.1,
      res: { oil: 0, gas: 0, iron: 0, copper: 1, rare: 0, grain: 2, uranium: 0 },
      cities: [["Madrid", 40.42, -3.7, 6.8], ["Barcelona", 41.39, 2.17, 5.6], ["Valencia", 39.47, -0.38, 1.6], ["Seville", 37.39, -5.98, 1.5], ["Bilbao", 43.26, -2.93, 1.0], ["A Coruña", 43.36, -8.41, 0.4], ["Las Palmas", 28.12, -15.43, 0.4]] },
    { id: "pol", iso: "616", name: "Poland", short: "Poland", leader: "Donald Tusk", title: "Prime Minister", pool: "polish", color: "#c9707a", reg: "eu", troops: 200, q: 0.85,
      pop: 37, gdp: 910, debt: 55, mil: 4.1, freedom: 81, regime: "democracy", elections: true, next: "2027-10", term: 4,
      approval: 35, u: 3.0, infl: 3.0, rate: 4.5, nukes: 0, ind: 1.1, haven: 0,
      res: { oil: 0, gas: 0.4, iron: 0, copper: 4, rare: 0, grain: 3.5, uranium: 0 },
      cities: [["Warsaw", 52.23, 21.0, 3.1], ["Gdańsk", 54.35, 18.65, 1.1], ["Poznań", 52.4, 16.93, 1.0], ["Wrocław", 51.1, 17.03, 1.0], ["Kraków", 50.06, 19.94, 1.5], ["Białystok", 53.13, 23.16, 0.4]] },
    { id: "ukr", iso: "804", name: "Ukraine", short: "Ukraine", leader: "Volodymyr Zelenskyy", title: "President", pool: "ukrainian", color: "#e0c24f", reg: "eu", troops: 900, q: 0.8,
      pop: 33, gdp: 190, debt: 92, mil: 22, freedom: 49, regime: "democracy", elections: true, next: "2027-03", term: 5, martial: true,
      approval: 60, u: 12, infl: 12, rate: 15.5, nukes: 0, ind: 0.6, haven: 0,
      res: { oil: 0, gas: 1.8, iron: 5, copper: 0, rare: 0, grain: 6, uranium: 0.8 },
      cities: [["Kyiv", 50.45, 30.52, 3.5], ["Lviv", 49.84, 24.03, 0.7], ["Vinnytsia", 49.23, 28.47, 0.4], ["Kharkiv", 49.99, 36.23, 1.4], ["Dnipro", 48.46, 35.05, 1.0],
        ["Zaporizhzhia", 47.84, 35.14, 0.7], ["Odesa", 46.48, 30.72, 1.0], ["Chernihiv", 51.5, 31.3, 0.3], ["Donetsk", 48.0, 37.8, 0.9, "rus"], ["Luhansk", 48.57, 39.33, 0.4, "rus"], ["Mariupol", 47.1, 37.55, 0.2, "rus"], ["Simferopol", 44.95, 34.1, 0.9, "rus"]] },
    { id: "rus", iso: "643", name: "Russia", short: "Russia", leader: "Vladimir Putin", title: "President", pool: "russian", color: "#b35f5f", reg: "eu", troops: 1300, q: 0.8,
      pop: 144, gdp: 2160, debt: 20, mil: 6.7, freedom: 13, regime: "autocracy", elections: false, next: "2030-03", term: 6,
      approval: 80, u: 2.5, infl: 8.5, rate: 16.5, nukes: 5580, ind: 0.8, haven: 0,
      res: { oil: 10, gas: 62, iron: 10, copper: 9, rare: 0.5, grain: 13, uranium: 5 },
      cities: [["Moscow", 55.76, 37.62, 13.0], ["Saint Petersburg", 59.94, 30.31, 5.6], ["Kaliningrad", 54.71, 20.51, 0.5], ["Murmansk", 68.97, 33.08, 0.3], ["Rostov-on-Don", 47.24, 39.7, 1.1],
        ["Volgograd", 48.71, 44.51, 1.0], ["Kazan", 55.8, 49.11, 1.3], ["Arkhangelsk", 64.54, 40.54, 0.3], ["Yekaterinburg", 56.84, 60.6, 1.5], ["Omsk", 54.99, 73.37, 1.1],
        ["Novosibirsk", 55.01, 82.93, 1.6], ["Norilsk", 69.35, 88.2, 0.2], ["Krasnoyarsk", 56.01, 92.85, 1.2], ["Irkutsk", 52.29, 104.3, 0.6], ["Yakutsk", 62.03, 129.73, 0.4],
        ["Khabarovsk", 48.48, 135.08, 0.6], ["Vladivostok", 43.12, 131.89, 0.6], ["Magadan", 59.56, 150.8, 0.1], ["Petropavlovsk", 53.02, 158.65, 0.2], ["Anadyr", 64.73, 177.5, 0.02], ["Surgut", 61.25, 73.4, 0.4]] },
    { id: "tur", iso: "792", name: "Turkey", short: "Turkey", leader: "Recep Tayyip Erdoğan", title: "President", pool: "turkish", color: "#c4664f", reg: "me", troops: 355, q: 0.85,
      pop: 86, gdp: 1320, debt: 25, mil: 1.6, freedom: 33, regime: "hybrid", elections: true, next: "2028-05", term: 5,
      approval: 40, u: 8.5, infl: 33, rate: 39.5, nukes: 0, ind: 1.1, haven: 0,
      res: { oil: 0.1, gas: 0, iron: 1, copper: 1, rare: 0, grain: 3.8, uranium: 0 },
      cities: [["Ankara", 39.93, 32.86, 5.8], ["Istanbul", 41.01, 28.98, 15.7], ["Izmir", 38.42, 27.14, 4.4], ["Antalya", 36.9, 30.7, 2.7], ["Adana", 37.0, 35.32, 2.3], ["Trabzon", 41.0, 39.72, 0.8], ["Erzurum", 39.9, 41.27, 0.8], ["Diyarbakır", 37.91, 40.24, 1.8]] },
    { id: "isr", iso: "376", name: "Israel", short: "Israel", leader: "Benjamin Netanyahu", title: "Prime Minister", pool: "hebrew", color: "#6f9fd8", reg: "me", troops: 170, q: 1.2,
      pop: 10, gdp: 540, debt: 69, mil: 8.8, freedom: 74, regime: "democracy", elections: true, next: "2026-10", term: 4,
      approval: 35, u: 3.0, infl: 3.0, rate: 4.5, nukes: 90, ind: 0.8, haven: 0,
      res: { oil: 0, gas: 2.5, iron: 0, copper: 0, rare: 0, grain: 0, uranium: 0 },
      cities: [["Jerusalem", 31.77, 35.21, 1.3], ["Tel Aviv", 32.08, 34.78, 4.2], ["Beersheba", 31.25, 34.79, 0.7], ["Haifa", 32.79, 34.99, 1.1]] },
    { id: "egy", iso: "818", name: "Egypt", short: "Egypt", leader: "Abdel Fattah el-Sisi", title: "President", pool: "arabic", color: "#c9ad6e", reg: "me", troops: 440, q: 0.55,
      pop: 114, gdp: 390, debt: 90, mil: 1.2, freedom: 18, regime: "autocracy", elections: false, next: "2030-04", term: 6,
      approval: 50, u: 6.5, infl: 14, rate: 22, nukes: 0, ind: 0.6, haven: 0,
      res: { oil: 0.6, gas: 6, iron: 0, copper: 0, rare: 0, grain: 2.2, uranium: 0 },
      cities: [["Cairo", 30.04, 31.24, 22.6], ["Alexandria", 31.2, 29.92, 5.6], ["Marsa Matruh", 31.35, 27.24, 0.2], ["Asyut", 27.18, 31.18, 0.6], ["Luxor", 25.69, 32.64, 0.5], ["Aswan", 24.09, 32.9, 0.3], ["Kharga", 25.44, 30.55, 0.1], ["El Arish", 31.13, 33.8, 0.2]] },
    { id: "sau", iso: "682", name: "Saudi Arabia", short: "Saudi", leader: "Mohammed bin Salman", title: "Crown Prince", pool: "arabic", color: "#4f9a6a", reg: "me", troops: 257, q: 0.6,
      pop: 34, gdp: 1100, debt: 26, mil: 7.1, freedom: 8, regime: "autocracy", elections: false, next: "", term: 0,
      approval: 70, u: 3.5, infl: 2.0, rate: 4.5, nukes: 0, ind: 0.6, haven: 0,
      res: { oil: 10, gas: 12, iron: 0, copper: 0, rare: 0, grain: 0.1, uranium: 0 },
      cities: [["Riyadh", 24.71, 46.68, 7.7], ["Jeddah", 21.49, 39.19, 4.7], ["Medina", 24.47, 39.61, 1.5], ["Dammam", 26.43, 50.1, 1.3], ["Tabuk", 28.38, 36.57, 0.7], ["Abha", 18.22, 42.5, 0.4], ["Hail", 27.52, 41.69, 0.4]] },
    { id: "irn", iso: "364", name: "Iran", short: "Iran", leader: "Ali Khamenei", title: "Supreme Leader", pool: "persian", color: "#5fa68c", reg: "me", troops: 610, q: 0.55,
      pop: 90, gdp: 400, debt: 30, mil: 2.0, freedom: 11, regime: "autocracy", elections: false, next: "", term: 0,
      approval: 40, u: 8.0, infl: 40, rate: 23, nukes: 0, nukeProg: 250, ind: 0.8, haven: 0,
      res: { oil: 3.3, gas: 25, iron: 7, copper: 3, rare: 0, grain: 2, uranium: 0.2 },
      cities: [["Tehran", 35.69, 51.39, 9.5], ["Tabriz", 38.08, 46.29, 1.8], ["Mashhad", 36.3, 59.6, 3.3], ["Isfahan", 32.65, 51.67, 2.2], ["Shiraz", 29.59, 52.58, 1.9], ["Ahvaz", 31.32, 48.67, 1.3], ["Bandar Abbas", 27.18, 56.27, 0.6], ["Kerman", 30.28, 57.08, 0.8], ["Zahedan", 29.5, 60.86, 0.6]] },
    { id: "pak", iso: "586", name: "Pakistan", short: "Pakistan", leader: "Shehbaz Sharif", title: "Prime Minister", pool: "urdu", color: "#3f8a55", reg: "as", troops: 650, q: 0.6,
      pop: 245, gdp: 375, debt: 70, mil: 2.8, freedom: 35, regime: "hybrid", elections: true, next: "2029-02", term: 5,
      approval: 40, u: 7.0, infl: 4.5, rate: 11, nukes: 170, ind: 0.6, haven: 0,
      res: { oil: 0.1, gas: 3, iron: 0, copper: 0.3, rare: 0, grain: 4.5, uranium: 0 },
      cities: [["Islamabad", 33.69, 73.05, 2.4], ["Lahore", 31.55, 74.34, 14.0], ["Karachi", 24.86, 67.0, 17.6], ["Peshawar", 34.01, 71.58, 2.3], ["Quetta", 30.18, 66.98, 1.2], ["Multan", 30.2, 71.47, 2.2], ["Gwadar", 25.13, 62.32, 0.1]] },
    { id: "ind", iso: "356", name: "India", short: "India", leader: "Narendra Modi", title: "Prime Minister", pool: "hindi", color: "#d38a4f", reg: "as", troops: 1450, q: 0.7, also: ["n:Siachen Glacier"],
      pop: 1440, gdp: 3900, debt: 83, mil: 2.4, freedom: 63, regime: "democracy", elections: true, next: "2029-05", term: 5,
      approval: 70, u: 7.5, infl: 2.0, rate: 5.5, nukes: 172, ind: 1.0, haven: 0,
      res: { oil: 0.6, gas: 3.5, iron: 28, copper: 0.5, rare: 0.6, grain: 33, uranium: 1.2 },
      cities: [["New Delhi", 28.61, 77.21, 33.0], ["Jaipur", 26.91, 75.79, 4.1], ["Ahmedabad", 23.02, 72.57, 8.6], ["Mumbai", 19.08, 72.88, 21.7], ["Pune", 18.52, 73.86, 7.2],
        ["Bengaluru", 12.97, 77.59, 14.0], ["Chennai", 13.08, 80.27, 12.0], ["Hyderabad", 17.39, 78.49, 11.0], ["Nagpur", 21.15, 79.09, 3.0], ["Kolkata", 22.57, 88.36, 15.5],
        ["Lucknow", 26.85, 80.95, 4.0], ["Patna", 25.59, 85.14, 2.6], ["Guwahati", 26.14, 91.74, 1.2], ["Srinagar", 34.08, 74.8, 1.5], ["Bhubaneswar", 20.3, 85.82, 1.2], ["Kochi", 9.93, 76.27, 2.3]] },
    { id: "chn", iso: "156", name: "China", short: "China", leader: "Xi Jinping", title: "President", pool: "chinese", color: "#c75353", reg: "as", troops: 2035, q: 0.95, also: ["344", "446"],
      pop: 1410, gdp: 18700, debt: 88, mil: 1.7, freedom: 9, regime: "autocracy", elections: false, next: "", term: 0,
      approval: 75, u: 5.2, infl: 0.2, rate: 3.0, nukes: 600, ind: 2.6, haven: 0.4,
      res: { oil: 4.2, gas: 23, iron: 28, copper: 18, rare: 54, grain: 63, uranium: 3.4 },
      cities: [["Beijing", 39.9, 116.4, 22.0], ["Tianjin", 39.13, 117.2, 14.0], ["Shanghai", 31.23, 121.47, 29.0], ["Nanjing", 32.06, 118.8, 9.5], ["Guangzhou", 23.13, 113.26, 19.0],
        ["Shenzhen", 22.54, 114.06, 13.0], ["Wuhan", 30.59, 114.3, 11.0], ["Chengdu", 30.67, 104.07, 16.0], ["Chongqing", 29.56, 106.55, 17.0], ["Xi'an", 34.34, 108.94, 9.0],
        ["Shenyang", 41.8, 123.43, 7.5], ["Harbin", 45.8, 126.53, 6.0], ["Kunming", 25.04, 102.71, 5.0], ["Nanning", 22.82, 108.32, 4.0], ["Lanzhou", 36.06, 103.83, 3.0],
        ["Hohhot", 40.84, 111.75, 2.5], ["Urumqi", 43.83, 87.62, 4.0], ["Kashgar", 39.47, 75.99, 0.7], ["Lhasa", 29.65, 91.13, 0.6], ["Xining", 36.62, 101.78, 1.3], ["Hailar", 49.21, 119.7, 0.3], ["Golmud", 36.4, 94.9, 0.2]] },
    { id: "prk", iso: "408", name: "North Korea", short: "N. Korea", leader: "Kim Jong Un", title: "Supreme Leader", pool: "korean", color: "#a85a6a", reg: "as", troops: 1280, q: 0.45,
      pop: 26, gdp: 28, debt: 10, mil: 20, freedom: 3, regime: "autocracy", elections: false, next: "", term: 0,
      approval: 90, u: 3, infl: 10, rate: 5, nukes: 50, ind: 0.5, haven: 0,
      res: { oil: 0, gas: 0, iron: 0.5, copper: 0.1, rare: 0.2, grain: 0.5, uranium: 0 },
      cities: [["Pyongyang", 39.04, 125.76, 3.0], ["Hamhung", 39.92, 127.54, 0.8], ["Chongjin", 41.8, 129.78, 0.7]] },
    { id: "kor", iso: "410", name: "South Korea", short: "S. Korea", leader: "Lee Jae-myung", title: "President", pool: "korean", color: "#5a8ccc", reg: "as", troops: 500, q: 0.95,
      pop: 52, gdp: 1710, debt: 52, mil: 2.6, freedom: 83, regime: "democracy", elections: true, next: "2030-06", term: 5,
      approval: 55, u: 2.8, infl: 2.1, rate: 2.5, nukes: 0, ind: 1.8, haven: 0.1,
      res: { oil: 0, gas: 0, iron: 0, copper: 0, rare: 0, grain: 0.5, uranium: 0 },
      cities: [["Seoul", 37.57, 126.98, 26.0], ["Busan", 35.18, 129.08, 3.4], ["Gwangju", 35.16, 126.85, 1.5], ["Gangneung", 37.75, 128.9, 0.2]] },
    { id: "jpn", iso: "392", name: "Japan", short: "Japan", leader: "Sanae Takaichi", title: "Prime Minister", pool: "japanese", color: "#d97b7b", reg: "as", troops: 247, q: 1.0,
      pop: 124, gdp: 4100, debt: 250, mil: 1.4, freedom: 96, regime: "democracy", elections: true, next: "2028-10", term: 4,
      approval: 65, u: 2.5, infl: 3.0, rate: 0.5, nukes: 0, ind: 1.5, haven: 0.65,
      res: { oil: 0, gas: 0, iron: 0, copper: 0, rare: 0, grain: 1, uranium: 0 },
      cities: [["Tokyo", 35.68, 139.69, 37.0], ["Osaka", 34.69, 135.5, 19.0], ["Nagoya", 35.18, 136.91, 9.5], ["Sendai", 38.27, 140.87, 2.3], ["Sapporo", 43.06, 141.35, 2.7], ["Hiroshima", 34.39, 132.46, 2.0], ["Fukuoka", 33.59, 130.4, 5.5], ["Naha", 26.21, 127.68, 0.8]] },
    { id: "idn", iso: "360", name: "Indonesia", short: "Indonesia", leader: "Prabowo Subianto", title: "President", pool: "indonesian", color: "#c96a5a", reg: "as", troops: 400, q: 0.55,
      pop: 281, gdp: 1400, debt: 40, mil: 0.7, freedom: 57, regime: "hybrid", elections: true, next: "2029-02", term: 5,
      approval: 75, u: 4.9, infl: 2.0, rate: 4.75, nukes: 0, ind: 1.0, haven: 0,
      res: { oil: 0.6, gas: 6, iron: 0, copper: 9, rare: 0, grain: 8, uranium: 0 },
      cities: [["Jakarta", -6.21, 106.85, 34.0], ["Bandung", -6.92, 107.6, 8.5], ["Surabaya", -7.25, 112.75, 10.0], ["Denpasar", -8.65, 115.22, 1.0], ["Medan", 3.59, 98.67, 4.7], ["Palembang", -2.99, 104.76, 2.6],
        ["Pontianak", -0.03, 109.33, 0.7], ["Balikpapan", -1.27, 116.83, 0.8], ["Makassar", -5.15, 119.43, 1.7], ["Manado", 1.47, 124.84, 0.5], ["Ambon", -3.7, 128.18, 0.4], ["Kupang", -10.17, 123.6, 0.4], ["Jayapura", -2.53, 140.72, 0.4], ["Merauke", -8.5, 140.4, 0.1]] },
    { id: "aus", iso: "036", name: "Australia", short: "Australia", leader: "Anthony Albanese", title: "Prime Minister", pool: "anglo", color: "#4f8ab5", reg: "oc", troops: 59, q: 1.05, also: ["n:Indian Ocean Ter.", "334", "574"],
      pop: 27, gdp: 1750, debt: 50, mil: 2.0, freedom: 95, regime: "democracy", elections: true, next: "2028-09", term: 3,
      approval: 50, u: 4.3, infl: 2.4, rate: 3.6, nukes: 0, ind: 0.4, haven: 0.2,
      res: { oil: 0.4, gas: 15, iron: 93, copper: 8, rare: 3.6, grain: 5, uranium: 10 },
      cities: [["Canberra", -35.28, 149.13, 0.5], ["Sydney", -33.87, 151.21, 5.5], ["Melbourne", -37.81, 144.96, 5.3], ["Brisbane", -27.47, 153.03, 2.7], ["Adelaide", -34.93, 138.6, 1.4],
        ["Perth", -31.95, 115.86, 2.3], ["Darwin", -12.46, 130.84, 0.15], ["Cairns", -16.92, 145.77, 0.16], ["Alice Springs", -23.7, 133.88, 0.03], ["Port Hedland", -20.31, 118.6, 0.02],
        ["Kalgoorlie", -30.75, 121.47, 0.03], ["Hobart", -42.88, 147.33, 0.25], ["Mount Isa", -20.73, 139.49, 0.02]] },
    { id: "nga", iso: "566", name: "Nigeria", short: "Nigeria", leader: "Bola Tinubu", title: "President", pool: "nigerian", color: "#5aa36a", reg: "af", troops: 230, q: 0.45,
      pop: 230, gdp: 250, debt: 50, mil: 0.6, freedom: 44, regime: "hybrid", elections: true, next: "2027-02", term: 4,
      approval: 30, u: 5.0, infl: 20, rate: 27, nukes: 0, ind: 0.4, haven: 0,
      res: { oil: 1.5, gas: 4.5, iron: 0, copper: 0, rare: 0, grain: 3, uranium: 0 },
      cities: [["Abuja", 9.06, 7.49, 3.8], ["Lagos", 6.52, 3.38, 16.0], ["Ibadan", 7.38, 3.94, 3.9], ["Port Harcourt", 4.82, 7.03, 3.5], ["Kano", 12.0, 8.52, 4.4], ["Maiduguri", 11.83, 13.15, 1.1], ["Sokoto", 13.06, 5.24, 0.7]] },
    { id: "zaf", iso: "710", name: "South Africa", short: "S. Africa", leader: "Cyril Ramaphosa", title: "President", pool: "southafrican", color: "#e0a64f", reg: "af", troops: 74, q: 0.55,
      pop: 63, gdp: 400, debt: 75, mil: 0.7, freedom: 79, regime: "democracy", elections: true, next: "2029-05", term: 5,
      approval: 40, u: 32, infl: 3.3, rate: 7.0, nukes: 0, ind: 0.6, haven: 0,
      res: { oil: 0, gas: 0, iron: 6, copper: 0.5, rare: 0.1, grain: 1.5, uranium: 0.4 },
      cities: [["Pretoria", -25.75, 28.19, 2.9], ["Johannesburg", -26.2, 28.05, 6.2], ["Durban", -29.86, 31.02, 3.9], ["Cape Town", -33.92, 18.42, 4.8], ["Gqeberha", -33.96, 25.6, 1.3], ["Bloemfontein", -29.12, 26.21, 0.6], ["Upington", -28.45, 21.25, 0.1], ["Polokwane", -23.9, 29.45, 0.8]] },

    /* ---- EVERY OTHER COUNTRY. Shorter rows: what a row leaves out comes from
       its kind (see fill() below). troops = active soldiers (thousands); q =
       how well they fight (training, kit, air cover), 1 = a modern Western
       army. A leader marked "verify" changed hands, or was due to, close to
       the cutoff: check him first. */

    // ======== EUROPE
    { id: "prt", iso: "620", name: "Portugal", leader: "Luís Montenegro", title: "Prime Minister", pool: "portuguese", reg: "eu", pop: 10.6, gdp: 310, mil: 1.6, troops: 26, q: 0.9, freedom: 96, next: "2029-05",
      res: { grain: 0.1 }, cities: [["Lisbon", 38.72, -9.14, 3.0], ["Porto", 41.15, -8.61, 1.7], ["Faro", 37.02, -7.93, 0.2], ["Funchal", 32.65, -16.91, 0.25], ["Ponta Delgada", 37.74, -25.67, 0.07]] },
    { id: "irl", iso: "372", name: "Ireland", leader: "Micheál Martin", title: "Taoiseach", pool: "anglo", reg: "eu", pop: 5.4, gdp: 610, mil: 0.25, troops: 8, q: 0.85, freedom: 97, next: "2029-11", haven: 0.1,
      cities: [["Dublin", 53.35, -6.26, 1.5], ["Cork", 51.9, -8.47, 0.4], ["Galway", 53.27, -9.05, 0.1]] },
    { id: "nld", iso: "528", name: "Netherlands", leader: "Rob Jetten", title: "Prime Minister", pool: "dutch", reg: "eu", pop: 18, gdp: 1230, mil: 2.0, troops: 42, q: 1.0, freedom: 97, next: "2029-10", ind: 0.9, haven: 0.2, also: ["533", "531"],
      res: { gas: 1.5, grain: 0.15 }, cities: [["Amsterdam", 52.37, 4.9, 2.5], ["Rotterdam", 51.92, 4.48, 1.8], ["Eindhoven", 51.44, 5.47, 0.8], ["Groningen", 53.22, 6.57, 0.4]] },   // verify: coalition talks after the October 2025 vote
    { id: "bel", iso: "056", name: "Belgium", leader: "Bart De Wever", title: "Prime Minister", pool: "dutch", reg: "eu", pop: 11.8, gdp: 660, mil: 1.3, troops: 25, q: 0.95, freedom: 96, next: "2029-06", ind: 0.9,
      res: { grain: 0.3 }, cities: [["Brussels", 50.85, 4.35, 2.1], ["Antwerp", 51.22, 4.4, 1.1], ["Liège", 50.63, 5.57, 0.75]] },
    { id: "lux", iso: "442", name: "Luxembourg", leader: "Luc Frieden", title: "Prime Minister", pool: "french", reg: "eu", pop: 0.67, gdp: 90, mil: 0.6, troops: 1, q: 0.9, freedom: 97, next: "2028-10", debt: 27,
      cities: [["Luxembourg", 49.61, 6.13, 0.13]] },
    { id: "che", iso: "756", name: "Switzerland", leader: "Guy Parmelin", title: "President of the Confederation", pool: "german", reg: "eu", pop: 9, gdp: 940, mil: 0.7, troops: 20, q: 1.0, freedom: 96, next: "2027-10", debt: 37, haven: 0.6, ind: 1.1,
      cities: [["Bern", 46.95, 7.45, 0.4], ["Zurich", 47.38, 8.54, 1.4], ["Geneva", 46.2, 6.14, 0.6]] },
    { id: "aut", iso: "040", name: "Austria", leader: "Christian Stocker", title: "Chancellor", pool: "german", reg: "eu", pop: 9.2, gdp: 530, mil: 0.8, troops: 23, q: 0.9, freedom: 93, next: "2029-09", debt: 81,
      res: { grain: 0.5 }, cities: [["Vienna", 48.21, 16.37, 2.0], ["Graz", 47.07, 15.44, 0.3], ["Linz", 48.31, 14.29, 0.2], ["Innsbruck", 47.27, 11.39, 0.2]] },
    { id: "lie", iso: "438", name: "Liechtenstein", leader: "Brigitte Haas", title: "Prime Minister", pool: "german", reg: "eu", pop: 0.04, gdp: 8, mil: 0, troops: 0, q: 0.5, freedom: 90, next: "2029-02", debt: 0,
      cities: [["Vaduz", 47.14, 9.52, 0.04]] },
    { id: "mco", iso: "492", name: "Monaco", leader: "Albert II", title: "Prince", pool: "french", reg: "eu", pop: 0.04, gdp: 9, mil: 0, troops: 0.2, q: 0.5, regime: "autocracy", freedom: 82, debt: 0,
      cities: [["Monaco", 43.73, 7.42, 0.04]] },
    { id: "and", iso: "020", name: "Andorra", leader: "Xavier Espot Zamora", title: "Head of Government", pool: "spanish", reg: "eu", pop: 0.08, gdp: 4, mil: 0, troops: 0, q: 0.5, freedom: 93, next: "2027-04", debt: 35,
      cities: [["Andorra la Vella", 42.51, 1.52, 0.08]] },
    { id: "smr", iso: "674", name: "San Marino", leader: "Luca Beccari", title: "Secretary of State", pool: "italian", reg: "eu", pop: 0.034, gdp: 2.2, mil: 0, troops: 0, q: 0.5, freedom: 95, next: "2029-06", debt: 70,
      cities: [["San Marino", 43.94, 12.45, 0.03]] },
    { id: "vat", iso: "336", name: "Vatican City", short: "Vatican", leader: "Leo XIV", title: "Pope", pool: "italian", reg: "eu", pop: 0.0008, gdp: 0.1, mil: 0, troops: 0.1, q: 0.6, regime: "autocracy", freedom: 50, debt: 0,
      cities: [["Vatican City", 41.9, 12.45, 0.001]] },
    { id: "mlt", iso: "470", name: "Malta", leader: "Robert Abela", title: "Prime Minister", pool: "italian", reg: "eu", pop: 0.56, gdp: 25, mil: 0.5, troops: 2, q: 0.6, freedom: 89, next: "2027-06", debt: 48,
      cities: [["Valletta", 35.9, 14.51, 0.4]] },
    { id: "dnk", iso: "208", name: "Denmark", leader: "Mette Frederiksen", title: "Prime Minister", pool: "nordic", reg: "eu", pop: 6, gdp: 430, mil: 2.4, troops: 17, q: 1.0, freedom: 97, next: "2026-10", debt: 30, also: ["304", "234"],
      res: { grain: 0.9, oil: 0.06 }, cities: [["Copenhagen", 55.68, 12.57, 1.4], ["Aarhus", 56.16, 10.2, 0.35], ["Nuuk", 64.18, -51.72, 0.02], ["Ilulissat", 69.22, -51.1, 0.005], ["Tórshavn", 62.01, -6.77, 0.02]] },   // verify: election due by October 2026
    { id: "nor", iso: "578", name: "Norway", leader: "Jonas Gahr Støre", title: "Prime Minister", pool: "nordic", reg: "eu", pop: 5.6, gdp: 490, mil: 2.2, troops: 24, q: 1.05, freedom: 100, next: "2029-09", debt: 43, haven: 0.4,
      res: { oil: 2.0, gas: 12 }, cities: [["Oslo", 59.91, 10.75, 1.1], ["Bergen", 60.39, 5.32, 0.3], ["Trondheim", 63.43, 10.4, 0.2], ["Tromsø", 69.65, 18.96, 0.08]] },
    { id: "swe", iso: "752", name: "Sweden", leader: "Ulf Kristersson", title: "Prime Minister", pool: "nordic", reg: "eu", pop: 10.6, gdp: 610, mil: 2.4, troops: 24, q: 1.0, freedom: 99, next: "2030-09", debt: 34, ind: 1.0,
      res: { iron: 3.0, copper: 1.0, grain: 0.6 }, cities: [["Stockholm", 59.33, 18.07, 2.4], ["Gothenburg", 57.71, 11.97, 1.1], ["Malmö", 55.6, 13.0, 0.75], ["Umeå", 63.83, 20.26, 0.13], ["Kiruna", 67.86, 20.23, 0.02]] },   // verify: the September 2026 vote falls after the cutoff
    { id: "fin", iso: "246", name: "Finland", leader: "Petteri Orpo", title: "Prime Minister", pool: "nordic", reg: "eu", pop: 5.6, gdp: 300, mil: 2.4, troops: 60, q: 1.0, freedom: 100, next: "2027-04", debt: 82, also: ["248"],
      res: { grain: 0.3 }, cities: [["Helsinki", 60.17, 24.94, 1.3], ["Tampere", 61.5, 23.76, 0.4], ["Oulu", 65.01, 25.47, 0.2], ["Rovaniemi", 66.5, 25.73, 0.06]] },
    { id: "isl", iso: "352", name: "Iceland", leader: "Kristrún Frostadóttir", title: "Prime Minister", pool: "nordic", reg: "eu", pop: 0.39, gdp: 33, mil: 0, troops: 0, q: 0.5, freedom: 94, next: "2028-11", debt: 60,
      cities: [["Reykjavík", 64.15, -21.94, 0.24], ["Akureyri", 65.68, -18.09, 0.02]] },
    { id: "est", iso: "233", name: "Estonia", leader: "Kristen Michal", title: "Prime Minister", pool: "baltic", reg: "eu", pop: 1.37, gdp: 43, mil: 3.4, troops: 7, q: 0.9, freedom: 95, next: "2027-03", debt: 24,
      cities: [["Tallinn", 59.44, 24.75, 0.45], ["Tartu", 58.38, 26.72, 0.1]] },
    { id: "lva", iso: "428", name: "Latvia", leader: "Evika Siliņa", title: "Prime Minister", pool: "baltic", reg: "eu", pop: 1.86, gdp: 44, mil: 3.2, troops: 8, q: 0.85, freedom: 88, next: "2026-10", debt: 47,
      cities: [["Riga", 56.95, 24.11, 0.6], ["Daugavpils", 55.87, 26.54, 0.08]] },   // verify: election October 2026
    { id: "ltu", iso: "440", name: "Lithuania", leader: "Inga Ruginienė", title: "Prime Minister", pool: "baltic", reg: "eu", pop: 2.89, gdp: 85, mil: 3.0, troops: 23, q: 0.85, freedom: 89, next: "2028-10", debt: 38,
      cities: [["Vilnius", 54.69, 25.28, 0.6], ["Kaunas", 54.9, 23.9, 0.3], ["Klaipėda", 55.71, 21.13, 0.15]] },
    { id: "blr", iso: "112", name: "Belarus", leader: "Alexander Lukashenko", title: "President", pool: "russian", reg: "eu", pop: 9.1, gdp: 75, mil: 1.5, troops: 48, q: 0.55, regime: "autocracy", freedom: 7, debt: 38, approval: 60, infl: 6, rate: 9.75,
      res: { grain: 0.8 }, cities: [["Minsk", 53.9, 27.57, 2.0], ["Gomel", 52.44, 30.98, 0.5], ["Brest", 52.1, 23.69, 0.35], ["Vitebsk", 55.19, 30.2, 0.36]] },
    { id: "mda", iso: "498", name: "Moldova", leader: "Maia Sandu", title: "President", pool: "romanian", reg: "eu", pop: 2.4, gdp: 18, mil: 0.5, troops: 5, q: 0.45, freedom: 61, next: "2028-10", infl: 7, rate: 6,
      cities: [["Chișinău", 47.01, 28.86, 0.7], ["Bălți", 47.76, 27.93, 0.1], ["Tiraspol", 46.84, 29.63, 0.13, "rus"]] },
    { id: "cze", iso: "203", name: "Czechia", leader: "Andrej Babiš", title: "Prime Minister", pool: "czech", reg: "eu", pop: 10.9, gdp: 350, mil: 2.1, troops: 27, q: 0.9, freedom: 91, next: "2029-10", debt: 43, ind: 1.3,
      res: { grain: 0.8 }, cities: [["Prague", 50.08, 14.44, 1.4], ["Brno", 49.2, 16.61, 0.4], ["Ostrava", 49.82, 18.26, 0.3], ["Plzeň", 49.75, 13.38, 0.18]] },
    { id: "svk", iso: "703", name: "Slovakia", leader: "Robert Fico", title: "Prime Minister", pool: "czech", reg: "eu", pop: 5.4, gdp: 140, mil: 2.0, troops: 16, q: 0.8, freedom: 85, next: "2027-09", debt: 59, ind: 1.3,
      res: { grain: 0.4 }, cities: [["Bratislava", 48.15, 17.11, 0.48], ["Košice", 48.72, 21.26, 0.24], ["Banská Bystrica", 48.74, 19.15, 0.08]] },
    { id: "hun", iso: "348", name: "Hungary", leader: "Péter Magyar", title: "Prime Minister", pool: "magyar", reg: "eu", pop: 9.6, gdp: 230, mil: 2.1, troops: 33, q: 0.8, regime: "hybrid", freedom: 65, next: "2030-04", debt: 74, infl: 4.4, rate: 6.5,
      res: { grain: 1.3 }, cities: [["Budapest", 47.5, 19.04, 3.0], ["Debrecen", 47.53, 21.63, 0.2], ["Szeged", 46.25, 20.15, 0.16], ["Pécs", 46.07, 18.23, 0.14], ["Győr", 47.69, 17.63, 0.13]] },   // verify: April 2026 election
    { id: "rou", iso: "642", name: "Romania", leader: "Nicușor Dan", title: "President", pool: "romanian", reg: "eu", pop: 19, gdp: 380, mil: 2.3, troops: 70, q: 0.75, freedom: 83, next: "2028-12", debt: 55, infl: 8, rate: 6.5,
      res: { grain: 2.5, gas: 0.9 }, cities: [["Bucharest", 44.43, 26.1, 2.2], ["Cluj-Napoca", 46.77, 23.6, 0.4], ["Timișoara", 45.75, 21.23, 0.33], ["Iași", 47.16, 27.59, 0.38], ["Constanța", 44.17, 28.64, 0.3]] },
    { id: "bgr", iso: "100", name: "Bulgaria", leader: "Rumen Radev", title: "Prime Minister", pool: "southslav", reg: "eu", pop: 6.4, gdp: 110, mil: 2.2, troops: 37, q: 0.7, freedom: 78, next: "2030-04", debt: 24,
      res: { grain: 1.1 }, cities: [["Sofia", 42.7, 23.32, 1.3], ["Plovdiv", 42.14, 24.75, 0.35], ["Varna", 43.21, 27.91, 0.35], ["Burgas", 42.5, 27.47, 0.2]] },   // verify: April 2026 snap election
    { id: "grc", iso: "300", name: "Greece", leader: "Kyriakos Mitsotakis", title: "Prime Minister", pool: "greek", reg: "eu", pop: 10.4, gdp: 260, mil: 3.0, troops: 140, q: 0.9, freedom: 86, next: "2027-06", debt: 150,
      res: { grain: 0.3 }, cities: [["Athens", 37.98, 23.73, 3.6], ["Thessaloniki", 40.64, 22.94, 1.0], ["Patras", 38.25, 21.73, 0.2], ["Heraklion", 35.34, 25.13, 0.2], ["Rhodes", 36.43, 28.22, 0.05]] },
    { id: "cyp", iso: "196", name: "Cyprus", leader: "Nikos Christodoulides", title: "President", pool: "greek", reg: "eu", pop: 1.35, gdp: 37, mil: 1.8, troops: 12, q: 0.7, freedom: 92, next: "2028-02", debt: 65, also: ["n:N. Cyprus"],
      cities: [["Nicosia", 35.17, 33.36, 0.33], ["Limassol", 34.68, 33.04, 0.24], ["Kyrenia", 35.34, 33.32, 0.08, "tur"]] },
    { id: "svn", iso: "705", name: "Slovenia", leader: "Robert Golob", title: "Prime Minister", pool: "southslav", reg: "eu", pop: 2.1, gdp: 72, mil: 1.3, troops: 7, q: 0.8, freedom: 95, next: "2030-03", debt: 67,
      cities: [["Ljubljana", 46.06, 14.51, 0.3], ["Maribor", 46.55, 15.65, 0.1]] },   // verify: March 2026 election
    { id: "hrv", iso: "191", name: "Croatia", leader: "Andrej Plenković", title: "Prime Minister", pool: "southslav", reg: "eu", pop: 3.85, gdp: 90, mil: 1.8, troops: 15, q: 0.75, freedom: 85, next: "2028-04", debt: 58,
      cities: [["Zagreb", 45.81, 15.98, 0.8], ["Split", 43.51, 16.44, 0.3], ["Rijeka", 45.33, 14.44, 0.2], ["Osijek", 45.55, 18.69, 0.1], ["Dubrovnik", 42.65, 18.09, 0.04]] },
    { id: "bih", iso: "070", name: "Bosnia and Herzegovina", short: "Bosnia", leader: "Borjana Krišto", title: "Chair of the Council of Ministers", pool: "southslav", reg: "eu", pop: 3.2, gdp: 30, mil: 0.8, troops: 10, q: 0.5, regime: "hybrid", freedom: 52, next: "2026-10",
      cities: [["Sarajevo", 43.86, 18.41, 0.5], ["Banja Luka", 44.77, 17.19, 0.2], ["Mostar", 43.34, 17.81, 0.1], ["Tuzla", 44.54, 18.68, 0.1]] },
    { id: "srb", iso: "688", name: "Serbia", leader: "Aleksandar Vučić", title: "President", pool: "southslav", reg: "eu", pop: 6.6, gdp: 90, mil: 2.1, troops: 28, q: 0.65, regime: "hybrid", freedom: 56, next: "2027-04", debt: 47,
      res: { grain: 0.9, copper: 2.0 }, cities: [["Belgrade", 44.79, 20.45, 1.7], ["Novi Sad", 45.27, 19.83, 0.37], ["Niš", 43.32, 21.9, 0.26]] },
    { id: "mne", iso: "499", name: "Montenegro", leader: "Milojko Spajić", title: "Prime Minister", pool: "southslav", reg: "eu", pop: 0.62, gdp: 8, mil: 1.7, troops: 2, q: 0.5, freedom: 69, next: "2027-06",
      cities: [["Podgorica", 42.44, 19.26, 0.2], ["Bar", 42.09, 19.1, 0.04]] },
    { id: "mkd", iso: "807", name: "North Macedonia", short: "N. Macedonia", leader: "Hristijan Mickoski", title: "Prime Minister", pool: "southslav", reg: "eu", pop: 1.8, gdp: 16, mil: 2.0, troops: 8, q: 0.5, freedom: 68, next: "2028-05",
      cities: [["Skopje", 42.0, 21.43, 0.6], ["Bitola", 41.03, 21.33, 0.07]] },
    { id: "alb", iso: "008", name: "Albania", leader: "Edi Rama", title: "Prime Minister", pool: "southslav", reg: "eu", pop: 2.4, gdp: 27, mil: 2.0, troops: 7, q: 0.5, regime: "hybrid", freedom: 68, next: "2029-05",
      cities: [["Tirana", 41.33, 19.82, 0.9], ["Durrës", 41.32, 19.45, 0.2], ["Vlorë", 40.47, 19.49, 0.1]] },
    { id: "xkx", iso: "n:Kosovo", name: "Kosovo", leader: "Albin Kurti", title: "Prime Minister", pool: "southslav", reg: "eu", pop: 1.6, gdp: 11, mil: 1.5, troops: 5, q: 0.4, freedom: 60, next: "2029-12",
      cities: [["Pristina", 42.66, 21.17, 0.2], ["Prizren", 42.21, 20.74, 0.1]] },   // verify: snap election December 2025
    { id: "geo", iso: "268", name: "Georgia", leader: "Irakli Kobakhidze", title: "Prime Minister", pool: "georgian", reg: "eu", pop: 3.7, gdp: 34, mil: 1.7, troops: 21, q: 0.55, regime: "hybrid", freedom: 55, next: "2028-10",
      cities: [["Tbilisi", 41.72, 44.79, 1.2], ["Batumi", 41.64, 41.64, 0.17], ["Kutaisi", 42.27, 42.7, 0.13], ["Sukhumi", 43.0, 41.02, 0.06, "rus"], ["Tskhinvali", 42.23, 43.97, 0.03, "rus"]] },
    { id: "arm", iso: "051", name: "Armenia", leader: "Nikol Pashinyan", title: "Prime Minister", pool: "armenian", reg: "eu", pop: 3.0, gdp: 26, mil: 4.5, troops: 42, q: 0.5, regime: "hybrid", freedom: 54, next: "2031-06",
      cities: [["Yerevan", 40.18, 44.51, 1.1], ["Gyumri", 40.79, 43.85, 0.11]] },   // verify: June 2026 election
    { id: "aze", iso: "031", name: "Azerbaijan", leader: "Ilham Aliyev", title: "President", pool: "turkic", reg: "eu", pop: 10.2, gdp: 75, mil: 5.0, troops: 65, q: 0.65, regime: "autocracy", freedom: 7, approval: 65,
      res: { oil: 0.6, gas: 3.7 }, cities: [["Baku", 40.41, 49.87, 2.3], ["Ganja", 40.68, 46.36, 0.33], ["Nakhchivan", 39.21, 45.41, 0.09], ["Khankendi", 39.82, 46.75, 0.05]] },

    // ======== MIDDLE EAST
    { id: "irq", iso: "368", name: "Iraq", leader: "Mohammed Shia al-Sudani", title: "Prime Minister", pool: "arabic", reg: "me", pop: 46, gdp: 270, mil: 3.0, troops: 193, q: 0.45, regime: "hybrid", freedom: 29, next: "2029-11", debt: 45,
      res: { oil: 4.4, gas: 0.9, grain: 0.6 }, cities: [["Baghdad", 33.31, 44.36, 7.7], ["Basra", 30.51, 47.78, 1.5], ["Mosul", 36.34, 43.13, 1.7], ["Erbil", 36.19, 44.01, 1.0], ["Kirkuk", 35.47, 44.39, 0.9], ["Ramadi", 33.42, 43.3, 0.5]] },   // verify: government formed after the November 2025 vote
    { id: "syr", iso: "760", name: "Syria", leader: "Ahmed al-Sharaa", title: "President", pool: "arabic", reg: "me", pop: 24, gdp: 21, mil: 4, troops: 100, q: 0.3, regime: "autocracy", freedom: 5, approval: 55, infl: 30, rate: 10,
      res: { oil: 0.04, grain: 0.3 }, cities: [["Damascus", 33.51, 36.29, 2.5], ["Aleppo", 36.2, 37.16, 2.0], ["Homs", 34.73, 36.71, 0.8], ["Latakia", 35.52, 35.79, 0.4], ["Deir ez-Zor", 35.33, 40.14, 0.2], ["Qamishli", 37.05, 41.23, 0.2]] },
    { id: "lbn", iso: "422", name: "Lebanon", leader: "Joseph Aoun", title: "President", pool: "arabic", reg: "me", pop: 5.8, gdp: 20, mil: 3, troops: 60, q: 0.4, regime: "hybrid", freedom: 40, next: "2030-05", debt: 150, infl: 15,
      cities: [["Beirut", 33.89, 35.5, 2.4], ["Tripoli", 34.44, 35.83, 0.5], ["Tyre", 33.27, 35.2, 0.2]] },
    { id: "jor", iso: "400", name: "Jordan", leader: "Abdullah II", title: "King", pool: "arabic", reg: "me", pop: 11.5, gdp: 54, mil: 4.8, troops: 100, q: 0.65, regime: "autocracy", freedom: 33, debt: 90,
      cities: [["Amman", 31.95, 35.93, 4.3], ["Irbid", 32.56, 35.85, 0.6], ["Aqaba", 29.53, 35.0, 0.2]] },
    { id: "pse", iso: "275", name: "Palestine", leader: "Mahmoud Abbas", title: "President", pool: "arabic", reg: "me", pop: 5.5, gdp: 18, mil: 0, troops: 0, q: 0.2, regime: "autocracy", freedom: 22, u: 30, infl: 20, rate: 4,
      cities: [["Ramallah", 31.9, 35.2, 0.4], ["Gaza", 31.5, 34.47, 2.0], ["Hebron", 31.53, 35.1, 0.25], ["Nablus", 32.22, 35.26, 0.2]] },
    { id: "kwt", iso: "414", name: "Kuwait", leader: "Mishal Al-Ahmad Al-Jaber Al-Sabah", title: "Emir", pool: "arabic", reg: "me", pop: 4.9, gdp: 160, mil: 5, troops: 17, q: 0.6, regime: "autocracy", freedom: 31, debt: 3,
      res: { oil: 2.5, gas: 0.2 }, cities: [["Kuwait City", 29.37, 47.98, 3.0]] },
    { id: "bhr", iso: "048", name: "Bahrain", leader: "Hamad bin Isa Al Khalifa", title: "King", pool: "arabic", reg: "me", pop: 1.6, gdp: 47, mil: 3.5, troops: 8, q: 0.7, regime: "autocracy", freedom: 12, debt: 120,
      res: { oil: 0.2 }, cities: [["Manama", 26.23, 50.59, 0.6]] },
    { id: "qat", iso: "634", name: "Qatar", leader: "Tamim bin Hamad Al Thani", title: "Emir", pool: "arabic", reg: "me", pop: 3.0, gdp: 220, mil: 4, troops: 17, q: 0.7, regime: "autocracy", freedom: 25, debt: 40,
      res: { oil: 0.6, gas: 18 }, cities: [["Doha", 25.29, 51.53, 2.4]] },
    { id: "are", iso: "784", name: "United Arab Emirates", short: "UAE", leader: "Mohamed bin Zayed", title: "President", pool: "arabic", reg: "me", pop: 10.7, gdp: 540, mil: 5, troops: 63, q: 0.85, regime: "autocracy", freedom: 18, debt: 30, ind: 0.7,
      res: { oil: 3.3, gas: 5.5 }, cities: [["Abu Dhabi", 24.45, 54.38, 1.5], ["Dubai", 25.2, 55.27, 3.6], ["Sharjah", 25.35, 55.39, 1.4]] },
    { id: "omn", iso: "512", name: "Oman", leader: "Haitham bin Tariq", title: "Sultan", pool: "arabic", reg: "me", pop: 5.3, gdp: 110, mil: 6, troops: 43, q: 0.6, regime: "autocracy", freedom: 24, debt: 35,
      res: { oil: 1.0, gas: 4 }, cities: [["Muscat", 23.59, 58.41, 1.6], ["Salalah", 17.02, 54.09, 0.33], ["Sohar", 24.36, 56.75, 0.2], ["Duqm", 19.66, 57.7, 0.02]] },
    { id: "yem", iso: "887", name: "Yemen", leader: "Rashad al-Alimi", title: "Chairman of the Presidential Council", pool: "arabic", reg: "me", pop: 35, gdp: 19, mil: 4, troops: 60, q: 0.3, regime: "autocracy", freedom: 9, infl: 25, u: 18,
      cities: [["Aden", 12.79, 45.03, 1.0], ["Sanaa", 15.37, 44.19, 3.3], ["Hodeidah", 14.8, 42.95, 0.7], ["Taiz", 13.58, 44.02, 0.9], ["Mukalla", 14.54, 49.12, 0.3], ["Marib", 15.46, 45.32, 0.2]] },

    // ======== ASIA
    { id: "afg", iso: "004", name: "Afghanistan", leader: "Hibatullah Akhundzada", title: "Supreme Leader", pool: "persian", reg: "as", pop: 42, gdp: 17, mil: 3, troops: 150, q: 0.3, regime: "autocracy", freedom: 6, approval: 50, u: 15, infl: 2, rate: 4,
      res: { grain: 0.5 }, cities: [["Kabul", 34.53, 69.17, 4.6], ["Kandahar", 31.61, 65.71, 0.65], ["Herat", 34.35, 62.2, 0.6], ["Mazar-i-Sharif", 36.71, 67.11, 0.5], ["Jalalabad", 34.43, 70.45, 0.3]] },
    { id: "bgd", iso: "050", name: "Bangladesh", leader: "Tarique Rahman", title: "Prime Minister", pool: "bengali", reg: "as", pop: 174, gdp: 450, mil: 1.0, troops: 160, q: 0.45, regime: "hybrid", freedom: 40, next: "2031-02", debt: 40, infl: 8.5, rate: 10, ind: 1.0,
      res: { gas: 2.2, grain: 6 }, cities: [["Dhaka", 23.81, 90.41, 23], ["Chittagong", 22.36, 91.78, 5.5], ["Khulna", 22.85, 89.54, 1.0], ["Rajshahi", 24.37, 88.6, 0.9], ["Sylhet", 24.9, 91.87, 0.6]] },
    { id: "npl", iso: "524", name: "Nepal", leader: "Balendra Shah", title: "Prime Minister", pool: "nepali", reg: "as", pop: 30, gdp: 43, mil: 1.2, troops: 95, q: 0.4, regime: "hybrid", freedom: 57, next: "2031-03",
      res: { grain: 0.9 }, cities: [["Kathmandu", 27.72, 85.32, 3.0], ["Pokhara", 28.21, 83.99, 0.5], ["Biratnagar", 26.45, 87.27, 0.25], ["Nepalgunj", 28.05, 81.62, 0.1]] },   // verify: March 2026 election
    { id: "btn", iso: "064", name: "Bhutan", leader: "Tshering Tobgay", title: "Prime Minister", pool: "nepali", reg: "as", pop: 0.78, gdp: 3, mil: 1, troops: 8, q: 0.3, regime: "hybrid", freedom: 61, next: "2029-01",
      cities: [["Thimphu", 27.47, 89.64, 0.11]] },
    { id: "lka", iso: "144", name: "Sri Lanka", leader: "Anura Kumara Dissanayake", title: "President", pool: "sinhala", reg: "as", pop: 22, gdp: 99, mil: 1.9, troops: 200, q: 0.5, freedom: 57, next: "2029-09", debt: 100,
      res: { grain: 0.5 }, cities: [["Colombo", 6.93, 79.86, 5.6], ["Kandy", 7.29, 80.63, 0.2], ["Jaffna", 9.66, 80.02, 0.1], ["Trincomalee", 8.59, 81.21, 0.1]] },
    { id: "mdv", iso: "462", name: "Maldives", leader: "Mohamed Muizzu", title: "President", pool: "sinhala", reg: "as", pop: 0.52, gdp: 7, mil: 1, troops: 4, q: 0.3, regime: "hybrid", freedom: 40, next: "2028-09", debt: 120,
      cities: [["Malé", 4.18, 73.51, 0.25]] },
    { id: "mmr", iso: "104", name: "Myanmar", leader: "Min Aung Hlaing", title: "President", pool: "burmese", reg: "as", pop: 55, gdp: 70, mil: 3, troops: 150, q: 0.35, regime: "autocracy", freedom: 3, approval: 25, infl: 25,
      res: { rare: 6, gas: 1.6, grain: 3 }, cities: [["Naypyidaw", 19.76, 96.08, 1.2], ["Yangon", 16.84, 96.17, 5.6], ["Mandalay", 21.98, 96.08, 1.5], ["Myitkyina", 25.38, 97.4, 0.2], ["Sittwe", 20.15, 92.9, 0.15], ["Mawlamyine", 16.49, 97.63, 0.3]] },   // verify: president chosen after the 2025-26 vote
    { id: "tha", iso: "764", name: "Thailand", leader: "Anutin Charnvirakul", title: "Prime Minister", pool: "thai", reg: "as", pop: 70, gdp: 530, mil: 1.3, troops: 360, q: 0.6, regime: "hybrid", freedom: 36, next: "2030-03", debt: 64, ind: 1.2,
      res: { gas: 2.7, grain: 3.4 }, cities: [["Bangkok", 13.76, 100.5, 11], ["Chiang Mai", 18.79, 98.98, 1.2], ["Khon Kaen", 16.43, 102.83, 0.4], ["Nakhon Ratchasima", 14.97, 102.1, 0.5], ["Hat Yai", 7.01, 100.47, 0.4], ["Phuket", 7.88, 98.39, 0.4]] },   // verify: March 2026 election
    { id: "lao", iso: "418", name: "Laos", leader: "Thongloun Sisoulith", title: "President", pool: "thai", reg: "as", pop: 7.7, gdp: 15, mil: 0.2, troops: 29, q: 0.3, regime: "autocracy", freedom: 12, debt: 110, infl: 20,
      res: { grain: 0.4 }, cities: [["Vientiane", 17.97, 102.6, 1.0], ["Luang Prabang", 19.89, 102.13, 0.1], ["Savannakhet", 16.55, 104.75, 0.12], ["Pakse", 15.12, 105.8, 0.1]] },
    { id: "khm", iso: "116", name: "Cambodia", leader: "Hun Manet", title: "Prime Minister", pool: "khmer", reg: "as", pop: 17.6, gdp: 47, mil: 2, troops: 124, q: 0.4, regime: "autocracy", freedom: 23, next: "2028-07",
      res: { grain: 1.2 }, cities: [["Phnom Penh", 11.56, 104.92, 2.3], ["Siem Reap", 13.36, 103.86, 0.25], ["Battambang", 13.1, 103.2, 0.2], ["Sihanoukville", 10.63, 103.5, 0.1]] },
    { id: "vnm", iso: "704", name: "Vietnam", leader: "Tô Lâm", title: "General Secretary", pool: "viet", reg: "as", pop: 101, gdp: 490, mil: 2.0, troops: 450, q: 0.6, regime: "autocracy", freedom: 19, approval: 70, ind: 1.4,
      res: { oil: 0.2, grain: 4.3, rare: 0.1 }, cities: [["Hanoi", 21.03, 105.85, 8.5], ["Ho Chi Minh City", 10.82, 106.63, 9.5], ["Da Nang", 16.05, 108.2, 1.2], ["Haiphong", 20.84, 106.69, 2.1], ["Hue", 16.46, 107.59, 0.5], ["Can Tho", 10.03, 105.77, 1.3]] },
    { id: "mys", iso: "458", name: "Malaysia", leader: "Anwar Ibrahim", title: "Prime Minister", pool: "malay", reg: "as", pop: 34, gdp: 440, mil: 1.0, troops: 113, q: 0.65, regime: "hybrid", freedom: 53, next: "2027-12", debt: 64, ind: 1.2,
      res: { oil: 0.55, gas: 7.5, grain: 0.2 }, cities: [["Kuala Lumpur", 3.14, 101.69, 8.6], ["George Town", 5.41, 100.33, 2.6], ["Johor Bahru", 1.49, 103.74, 1.8], ["Kuantan", 3.81, 103.33, 0.5], ["Kuching", 1.55, 110.36, 0.7], ["Kota Kinabalu", 5.98, 116.07, 0.5]] },
    { id: "sgp", iso: "702", name: "Singapore", leader: "Lawrence Wong", title: "Prime Minister", pool: "chinese", reg: "as", pop: 6.0, gdp: 550, mil: 3, troops: 51, q: 1.0, regime: "hybrid", freedom: 47, next: "2030-05", debt: 170, haven: 0.8, ind: 1.4,
      cities: [["Singapore", 1.29, 103.85, 6.0]] },
    { id: "brn", iso: "096", name: "Brunei", leader: "Hassanal Bolkiah", title: "Sultan", pool: "malay", reg: "as", pop: 0.46, gdp: 15, mil: 2.5, troops: 7, q: 0.5, regime: "autocracy", freedom: 28, debt: 2,
      res: { oil: 0.1, gas: 1.1 }, cities: [["Bandar Seri Begawan", 4.9, 114.94, 0.24]] },
    { id: "phl", iso: "608", name: "Philippines", leader: "Ferdinand Marcos Jr.", title: "President", pool: "filipino", reg: "as", pop: 116, gdp: 470, mil: 1.3, troops: 145, q: 0.5, freedom: 58, next: "2028-05", debt: 60,
      res: { grain: 2.5, copper: 0.6 }, cities: [["Manila", 14.6, 120.98, 14], ["Cebu", 10.32, 123.89, 3.0], ["Davao", 7.07, 125.61, 1.8], ["Iloilo", 10.72, 122.56, 0.5], ["Zamboanga", 6.92, 122.08, 1.0], ["Baguio", 16.41, 120.6, 0.4], ["Puerto Princesa", 9.74, 118.73, 0.3]] },
    { id: "tls", iso: "626", name: "Timor-Leste", short: "East Timor", leader: "Xanana Gusmão", title: "Prime Minister", pool: "portuguese", reg: "as", pop: 1.4, gdp: 2, mil: 1, troops: 2, q: 0.3, freedom: 72, next: "2028-05",
      cities: [["Dili", -8.56, 125.57, 0.28]] },
    { id: "twn", iso: "158", name: "Taiwan", leader: "Lai Ching-te", title: "President", pool: "chinese", reg: "as", pop: 23.4, gdp: 800, mil: 2.5, troops: 170, q: 0.85, freedom: 94, next: "2028-01", debt: 28, ind: 2.2, haven: 0.3,
      cities: [["Taipei", 25.03, 121.56, 7.0], ["Taichung", 24.15, 120.67, 2.8], ["Kaohsiung", 22.63, 120.3, 2.7], ["Tainan", 22.99, 120.21, 1.9], ["Hualien", 23.98, 121.6, 0.3]] },
    { id: "mng", iso: "496", name: "Mongolia", leader: "Gombojav Zandanshatar", title: "Prime Minister", pool: "mongol", reg: "as", pop: 3.5, gdp: 23, mil: 0.8, troops: 10, q: 0.4, freedom: 84, next: "2028-06",
      res: { copper: 3.5, iron: 0.5 }, cities: [["Ulaanbaatar", 47.92, 106.92, 1.7], ["Erdenet", 49.03, 104.07, 0.1], ["Choibalsan", 48.07, 114.53, 0.05], ["Khovd", 48.0, 91.64, 0.03], ["Dalanzadgad", 43.57, 104.43, 0.02]] },   // verify
    { id: "kaz", iso: "398", name: "Kazakhstan", leader: "Kassym-Jomart Tokayev", title: "President", pool: "turkic", reg: "as", pop: 20.5, gdp: 290, mil: 1.0, troops: 39, q: 0.5, regime: "autocracy", freedom: 23, debt: 25, infl: 11, rate: 16,
      res: { oil: 1.9, gas: 3, uranium: 46, copper: 7.4, iron: 1.5, grain: 2.5 }, cities: [["Astana", 51.17, 71.45, 1.4], ["Almaty", 43.24, 76.89, 2.2], ["Shymkent", 42.32, 69.6, 1.2], ["Karaganda", 49.8, 73.1, 0.5],
        ["Aktobe", 50.28, 57.17, 0.55], ["Atyrau", 47.1, 51.92, 0.3], ["Oskemen", 49.95, 82.62, 0.3], ["Kostanay", 53.21, 63.62, 0.25], ["Pavlodar", 52.29, 76.97, 0.33], ["Aktau", 43.65, 51.17, 0.2]] },
    { id: "uzb", iso: "860", name: "Uzbekistan", leader: "Shavkat Mirziyoyev", title: "President", pool: "turkic", reg: "as", pop: 37, gdp: 115, mil: 2, troops: 48, q: 0.45, regime: "autocracy", freedom: 12, infl: 9, rate: 14,
      res: { gas: 4.5, copper: 1.5, uranium: 9, grain: 0.8 }, cities: [["Tashkent", 41.3, 69.24, 3.0], ["Samarkand", 39.65, 66.96, 0.6], ["Bukhara", 39.77, 64.42, 0.3], ["Namangan", 41.0, 71.67, 0.7], ["Nukus", 42.46, 59.6, 0.33]] },
    { id: "tkm", iso: "795", name: "Turkmenistan", leader: "Serdar Berdimuhamedow", title: "President", pool: "turkic", reg: "as", pop: 7, gdp: 80, mil: 2, troops: 36, q: 0.3, regime: "autocracy", freedom: 1, approval: 80,
      res: { gas: 8, oil: 0.2 }, cities: [["Ashgabat", 37.96, 58.33, 1.0], ["Türkmenabat", 39.07, 63.58, 0.25], ["Daşoguz", 41.84, 59.97, 0.2], ["Mary", 37.6, 61.83, 0.17], ["Türkmenbaşy", 40.02, 52.96, 0.08]] },
    { id: "kgz", iso: "417", name: "Kyrgyzstan", leader: "Sadyr Japarov", title: "President", pool: "turkic", reg: "as", pop: 7.2, gdp: 18, mil: 1.5, troops: 11, q: 0.35, regime: "autocracy", freedom: 25,
      cities: [["Bishkek", 42.87, 74.59, 1.2], ["Osh", 40.53, 72.8, 0.35], ["Karakol", 42.49, 78.39, 0.08]] },
    { id: "tjk", iso: "762", name: "Tajikistan", leader: "Emomali Rahmon", title: "President", pool: "persian", reg: "as", pop: 10.6, gdp: 14, mil: 1.2, troops: 9, q: 0.3, regime: "autocracy", freedom: 5,
      cities: [["Dushanbe", 38.56, 68.77, 1.0], ["Khujand", 40.28, 69.62, 0.2], ["Khorog", 37.49, 71.55, 0.03]] },

    // ======== AFRICA
    { id: "dza", iso: "012", name: "Algeria", leader: "Abdelmadjid Tebboune", title: "President", pool: "arabic", reg: "af", pop: 47, gdp: 270, mil: 8, troops: 130, q: 0.55, regime: "autocracy", freedom: 32, debt: 50,
      res: { oil: 1.0, gas: 10, grain: 0.5 }, cities: [["Algiers", 36.75, 3.06, 3.9], ["Oran", 35.7, -0.63, 1.5], ["Constantine", 36.36, 6.61, 0.9], ["Annaba", 36.9, 7.77, 0.5], ["Béchar", 31.62, -2.22, 0.2],
        ["Ouargla", 31.95, 5.33, 0.2], ["Adrar", 27.87, -0.29, 0.07], ["In Salah", 27.2, 2.48, 0.05], ["Tamanrasset", 22.79, 5.52, 0.1]] },
    { id: "mar", iso: "504", name: "Morocco", leader: "Mohammed VI", title: "King", pool: "arabic", reg: "af", pop: 38, gdp: 160, mil: 3.5, troops: 196, q: 0.6, regime: "hybrid", freedom: 37, debt: 69, also: ["732"],
      res: { grain: 0.7 }, cities: [["Rabat", 34.02, -6.84, 1.9], ["Casablanca", 33.57, -7.59, 4.3], ["Tangier", 35.76, -5.83, 1.3], ["Fez", 34.03, -5.0, 1.3], ["Oujda", 34.68, -1.91, 0.6], ["Marrakesh", 31.63, -8.0, 1.0],
        ["Agadir", 30.43, -9.6, 0.9], ["Laayoune", 27.15, -13.2, 0.25], ["Dakhla", 23.72, -15.94, 0.1]] },
    { id: "tun", iso: "788", name: "Tunisia", leader: "Kais Saied", title: "President", pool: "arabic", reg: "af", pop: 12.3, gdp: 52, mil: 2.4, troops: 36, q: 0.45, regime: "autocracy", freedom: 44, debt: 80, infl: 6, rate: 7.5,
      cities: [["Tunis", 36.81, 10.18, 2.7], ["Sfax", 34.74, 10.76, 1.0], ["Sousse", 35.83, 10.64, 0.7], ["Gabès", 33.88, 10.1, 0.4], ["Tozeur", 33.92, 8.13, 0.04]] },
    { id: "lby", iso: "434", name: "Libya", leader: "Abdul Hamid Dbeibah", title: "Prime Minister", pool: "arabic", reg: "af", pop: 7.4, gdp: 45, mil: 2, troops: 32, q: 0.3, regime: "autocracy", freedom: 9,
      res: { oil: 1.3, gas: 0.4 }, cities: [["Tripoli", 32.89, 13.19, 1.2], ["Benghazi", 32.12, 20.09, 0.85], ["Misrata", 32.38, 15.09, 0.45], ["Sirte", 31.2, 16.59, 0.13], ["Tobruk", 32.08, 23.96, 0.14],
        ["Sabha", 27.04, 14.43, 0.13], ["Ghat", 24.96, 10.17, 0.02], ["Kufra", 24.18, 23.28, 0.05]] },
    { id: "sdn", iso: "729", name: "Sudan", leader: "Abdel Fattah al-Burhan", title: "Chairman of the Sovereignty Council", pool: "arabic", reg: "af", pop: 50, gdp: 30, mil: 4, troops: 100, q: 0.35, regime: "autocracy", freedom: 2, approval: 30, infl: 100, rate: 20, u: 30,
      res: { grain: 0.7, oil: 0.05 }, cities: [["Khartoum", 15.5, 32.56, 6.3], ["Port Sudan", 19.62, 37.22, 0.6], ["Kassala", 15.45, 36.4, 0.5], ["El Obeid", 13.18, 30.22, 0.5], ["Nyala", 12.05, 24.88, 0.8],
        ["El Fasher", 13.63, 25.35, 0.3], ["Dongola", 19.17, 30.48, 0.1], ["Wadi Halfa", 21.8, 31.35, 0.02]] },
    { id: "ssd", iso: "728", name: "South Sudan", leader: "Salva Kiir", title: "President", pool: "swahili", reg: "af", pop: 11.9, gdp: 5, mil: 3, troops: 185, q: 0.2, regime: "autocracy", freedom: 1, infl: 50,
      res: { oil: 0.15 }, cities: [["Juba", 4.85, 31.58, 0.5], ["Malakal", 9.53, 31.66, 0.15], ["Wau", 7.7, 27.99, 0.15], ["Bor", 6.21, 31.56, 0.1]] },
    { id: "eth", iso: "231", name: "Ethiopia", leader: "Abiy Ahmed", title: "Prime Minister", pool: "horn", reg: "af", pop: 130, gdp: 120, mil: 0.9, troops: 160, q: 0.45, regime: "hybrid", freedom: 18, next: "2031-06", infl: 15, rate: 15,
      res: { grain: 3 }, cities: [["Addis Ababa", 9.03, 38.74, 5.7], ["Dire Dawa", 9.6, 41.86, 0.5], ["Mekelle", 13.5, 39.47, 0.5], ["Gondar", 12.6, 37.47, 0.4], ["Bahir Dar", 11.59, 37.39, 0.4],
        ["Jijiga", 9.35, 42.8, 0.2], ["Hawassa", 7.06, 38.48, 0.4], ["Gambela", 8.25, 34.59, 0.07]] },
    { id: "eri", iso: "232", name: "Eritrea", leader: "Isaias Afwerki", title: "President", pool: "horn", reg: "af", pop: 3.7, gdp: 2.5, mil: 10, troops: 200, q: 0.3, regime: "autocracy", freedom: 2,
      cities: [["Asmara", 15.32, 38.93, 1.0], ["Massawa", 15.61, 39.45, 0.05], ["Assab", 13.01, 42.74, 0.1]] },
    { id: "dji", iso: "262", name: "Djibouti", leader: "Ismaïl Omar Guelleh", title: "President", pool: "horn", reg: "af", pop: 1.15, gdp: 4.5, mil: 3, troops: 10, q: 0.4, regime: "autocracy", freedom: 24,
      cities: [["Djibouti", 11.59, 43.15, 0.6]] },
    { id: "som", iso: "706", name: "Somalia", leader: "Hassan Sheikh Mohamud", title: "President", pool: "horn", reg: "af", pop: 19, gdp: 12, mil: 3, troops: 30, q: 0.2, regime: "autocracy", freedom: 8, also: ["n:Somaliland"],
      cities: [["Mogadishu", 2.05, 45.32, 2.6], ["Hargeisa", 9.56, 44.06, 1.2], ["Berbera", 10.44, 45.01, 0.2], ["Bosaso", 11.28, 49.18, 0.4], ["Garowe", 8.4, 48.48, 0.1], ["Baidoa", 3.11, 43.65, 0.3], ["Kismayo", -0.36, 42.55, 0.2]] },   // verify: the 2026 vote
    { id: "ken", iso: "404", name: "Kenya", leader: "William Ruto", title: "President", pool: "swahili", reg: "af", pop: 56, gdp: 125, mil: 1.1, troops: 24, q: 0.55, regime: "hybrid", freedom: 52, next: "2027-08", debt: 70,
      res: { grain: 0.45 }, cities: [["Nairobi", -1.29, 36.82, 5.3], ["Mombasa", -4.04, 39.67, 1.3], ["Kisumu", -0.09, 34.77, 0.6], ["Nakuru", -0.3, 36.07, 0.6], ["Eldoret", 0.51, 35.27, 0.5], ["Garissa", -0.45, 39.65, 0.2], ["Lodwar", 3.12, 35.6, 0.05]] },
    { id: "uga", iso: "800", name: "Uganda", leader: "Yoweri Museveni", title: "President", pool: "swahili", reg: "af", pop: 50, gdp: 55, mil: 2, troops: 45, q: 0.45, regime: "autocracy", freedom: 34, next: "2031-01",
      res: { grain: 0.5 }, cities: [["Kampala", 0.35, 32.58, 3.7], ["Gulu", 2.78, 32.3, 0.2], ["Mbarara", -0.61, 30.66, 0.2], ["Jinja", 0.44, 33.2, 0.3]] },
    { id: "tza", iso: "834", name: "Tanzania", leader: "Samia Suluhu Hassan", title: "President", pool: "swahili", reg: "af", pop: 68, gdp: 85, mil: 1, troops: 27, q: 0.4, regime: "hybrid", freedom: 30, next: "2030-10",
      res: { grain: 1 }, cities: [["Dodoma", -6.17, 35.74, 0.8], ["Dar es Salaam", -6.79, 39.21, 7.8], ["Mwanza", -2.52, 32.9, 1.2], ["Arusha", -3.37, 36.68, 0.6], ["Mbeya", -8.9, 33.46, 0.6],
        ["Zanzibar", -6.17, 39.2, 0.7], ["Tabora", -5.02, 32.8, 0.3], ["Kigoma", -4.88, 29.63, 0.2]] },
    { id: "rwa", iso: "646", name: "Rwanda", leader: "Paul Kagame", title: "President", pool: "bantu", reg: "af", pop: 14.3, gdp: 14, mil: 1.3, troops: 33, q: 0.65, regime: "autocracy", freedom: 21, approval: 80,
      cities: [["Kigali", -1.94, 30.06, 1.8], ["Huye", -2.6, 29.74, 0.1]] },
    { id: "bdi", iso: "108", name: "Burundi", leader: "Évariste Ndayishimiye", title: "President", pool: "bantu", reg: "af", pop: 14, gdp: 3, mil: 2, troops: 30, q: 0.3, regime: "autocracy", freedom: 14, infl: 30,
      cities: [["Gitega", -3.43, 29.92, 0.15], ["Bujumbura", -3.38, 29.36, 1.1]] },
    { id: "cod", iso: "180", name: "Democratic Republic of the Congo", short: "DR Congo", leader: "Félix Tshisekedi", title: "President", pool: "bantu", reg: "af", pop: 110, gdp: 70, mil: 1.5, troops: 130, q: 0.25, regime: "hybrid", freedom: 19, next: "2028-12", infl: 15, rate: 17,
      res: { copper: 33 }, cities: [["Kinshasa", -4.32, 15.31, 17.0], ["Matadi", -5.82, 13.45, 0.4], ["Mbandaka", 0.05, 18.26, 0.5], ["Kisangani", 0.52, 25.19, 1.4], ["Bunia", 1.57, 30.25, 0.9], ["Goma", -1.68, 29.22, 0.8, "rwa"],
        ["Bukavu", -2.51, 28.86, 1.1, "rwa"], ["Kindu", -2.95, 25.92, 0.3], ["Kananga", -5.9, 22.42, 1.6], ["Mbuji-Mayi", -6.14, 23.6, 2.8], ["Kalemie", -5.95, 29.19, 0.3], ["Lubumbashi", -11.66, 27.48, 2.6]] },
    { id: "cog", iso: "178", name: "Republic of the Congo", short: "Congo", leader: "Denis Sassou Nguesso", title: "President", pool: "bantu", reg: "af", pop: 6.2, gdp: 15, mil: 2, troops: 10, q: 0.3, regime: "autocracy", freedom: 17, debt: 95,
      res: { oil: 0.26 }, cities: [["Brazzaville", -4.27, 15.28, 2.5], ["Pointe-Noire", -4.78, 11.86, 1.2], ["Ouesso", 1.61, 16.05, 0.03]] },
    { id: "gab", iso: "266", name: "Gabon", leader: "Brice Oligui Nguema", title: "President", pool: "bantu", reg: "af", pop: 2.5, gdp: 21, mil: 1.5, troops: 5, q: 0.4, regime: "autocracy", freedom: 25,
      res: { oil: 0.2 }, cities: [["Libreville", 0.39, 9.45, 0.9], ["Port-Gentil", -0.72, 8.78, 0.15], ["Franceville", -1.63, 13.58, 0.11]] },
    { id: "gnq", iso: "226", name: "Equatorial Guinea", short: "Eq. Guinea", leader: "Teodoro Obiang Nguema Mbasogo", title: "President", pool: "spanish", reg: "af", pop: 1.9, gdp: 12, mil: 1, troops: 2, q: 0.3, regime: "autocracy", freedom: 5,
      res: { oil: 0.09 }, cities: [["Malabo", 3.75, 8.78, 0.3], ["Bata", 1.86, 9.77, 0.25]] },
    { id: "cmr", iso: "120", name: "Cameroon", leader: "Paul Biya", title: "President", pool: "westafrica", reg: "af", pop: 29, gdp: 53, mil: 1, troops: 25, q: 0.35, regime: "autocracy", freedom: 15,
      res: { oil: 0.06, grain: 0.4 }, cities: [["Yaoundé", 3.85, 11.5, 4.3], ["Douala", 4.05, 9.7, 4.0], ["Bamenda", 5.96, 10.15, 0.5], ["Garoua", 9.3, 13.4, 0.4], ["Maroua", 10.59, 14.32, 0.4]] },
    { id: "caf", iso: "140", name: "Central African Republic", short: "CAR", leader: "Faustin-Archange Touadéra", title: "President", pool: "westafrica", reg: "af", pop: 5.5, gdp: 3, mil: 1.5, troops: 9, q: 0.15, regime: "autocracy", freedom: 5,
      cities: [["Bangui", 4.39, 18.56, 0.9], ["Berbérati", 4.26, 15.79, 0.1], ["Bria", 6.54, 21.99, 0.05], ["Birao", 10.28, 22.79, 0.02]] },
    { id: "tcd", iso: "148", name: "Chad", leader: "Mahamat Déby", title: "President", pool: "arabic", reg: "af", pop: 19, gdp: 13, mil: 3, troops: 33, q: 0.35, regime: "autocracy", freedom: 15,
      res: { oil: 0.12 }, cities: [["N'Djamena", 12.13, 15.05, 1.6], ["Moundou", 8.57, 16.08, 0.2], ["Sarh", 9.14, 18.39, 0.1], ["Abéché", 13.83, 20.83, 0.1], ["Faya-Largeau", 17.92, 19.11, 0.02]] },
    { id: "ner", iso: "562", name: "Niger", leader: "Abdourahamane Tchiani", title: "President", pool: "westafrica", reg: "af", pop: 27, gdp: 20, mil: 2.5, troops: 33, q: 0.3, regime: "autocracy", freedom: 18,
      res: { uranium: 4, grain: 0.5 }, cities: [["Niamey", 13.51, 2.11, 1.4], ["Maradi", 13.5, 7.1, 0.3], ["Zinder", 13.8, 8.99, 0.4], ["Diffa", 13.32, 12.61, 0.05], ["Agadez", 16.97, 7.99, 0.13], ["Arlit", 18.74, 7.39, 0.1]] },
    { id: "mli", iso: "466", name: "Mali", leader: "Assimi Goïta", title: "President", pool: "westafrica", reg: "af", pop: 24, gdp: 23, mil: 3.5, troops: 40, q: 0.3, regime: "autocracy", freedom: 13,
      res: { grain: 0.9 }, cities: [["Bamako", 12.64, -8.0, 3.0], ["Kayes", 14.45, -11.43, 0.13], ["Mopti", 14.49, -4.2, 0.1], ["Timbuktu", 16.77, -3.0, 0.03], ["Gao", 16.27, -0.04, 0.1], ["Kidal", 18.44, 1.41, 0.03]] },
    { id: "bfa", iso: "854", name: "Burkina Faso", leader: "Ibrahim Traoré", title: "President", pool: "westafrica", reg: "af", pop: 23.5, gdp: 22, mil: 4, troops: 30, q: 0.3, regime: "autocracy", freedom: 25, approval: 60,
      res: { grain: 0.5 }, cities: [["Ouagadougou", 12.37, -1.52, 3.0], ["Bobo-Dioulasso", 11.18, -4.3, 0.9], ["Dori", 14.03, -0.03, 0.05], ["Fada N'Gourma", 12.06, 0.36, 0.05]] },
    { id: "mrt", iso: "478", name: "Mauritania", leader: "Mohamed Ould Ghazouani", title: "President", pool: "arabic", reg: "af", pop: 5, gdp: 11, mil: 3, troops: 16, q: 0.35, regime: "hybrid", freedom: 38, next: "2029-06",
      res: { iron: 1.3 }, cities: [["Nouakchott", 18.08, -15.98, 1.4], ["Nouadhibou", 20.94, -17.04, 0.15], ["Atar", 20.52, -13.05, 0.03], ["Zouérat", 22.73, -12.47, 0.05], ["Néma", 16.62, -7.26, 0.02]] },
    { id: "sen", iso: "686", name: "Senegal", leader: "Bassirou Diomaye Faye", title: "President", pool: "westafrica", reg: "af", pop: 18.5, gdp: 32, mil: 1.5, troops: 14, q: 0.5, freedom: 66, next: "2029-03", debt: 110,
      res: { oil: 0.1 }, cities: [["Dakar", 14.72, -17.47, 3.9], ["Touba", 14.85, -15.88, 1.0], ["Saint-Louis", 16.02, -16.49, 0.25], ["Ziguinchor", 12.58, -16.27, 0.2], ["Tambacounda", 13.77, -13.67, 0.1]] },
    { id: "gmb", iso: "270", name: "The Gambia", short: "Gambia", leader: "Adama Barrow", title: "President", pool: "westafrica", reg: "af", pop: 2.8, gdp: 2.5, mil: 0.7, troops: 2, q: 0.3, freedom: 50, next: "2026-12",
      cities: [["Banjul", 13.45, -16.58, 0.45]] },
    { id: "gnb", iso: "624", name: "Guinea-Bissau", leader: "Horta N'Tam", title: "Transitional President", pool: "portuguese", reg: "af", pop: 2.2, gdp: 2.2, mil: 1.5, troops: 4, q: 0.25, regime: "autocracy", freedom: 25,
      cities: [["Bissau", 11.86, -15.6, 0.5]] },   // verify: the November 2025 coup
    { id: "gin", iso: "324", name: "Guinea", leader: "Mamadi Doumbouya", title: "President", pool: "westafrica", reg: "af", pop: 14.5, gdp: 25, mil: 2, troops: 10, q: 0.3, regime: "autocracy", freedom: 30,
      res: { iron: 0.3 }, cities: [["Conakry", 9.64, -13.58, 2.0], ["Labé", 11.32, -12.28, 0.1], ["Kankan", 10.39, -9.31, 0.2], ["Nzérékoré", 7.76, -8.82, 0.2]] },
    { id: "sle", iso: "694", name: "Sierra Leone", leader: "Julius Maada Bio", title: "President", pool: "westafrica", reg: "af", pop: 8.9, gdp: 4, mil: 0.7, troops: 9, q: 0.3, regime: "hybrid", freedom: 53, next: "2028-06",
      cities: [["Freetown", 8.48, -13.23, 1.3], ["Bo", 7.96, -11.74, 0.17], ["Kenema", 7.88, -11.19, 0.2]] },
    { id: "lbr", iso: "430", name: "Liberia", leader: "Joseph Boakai", title: "President", pool: "westafrica", reg: "af", pop: 5.6, gdp: 4.8, mil: 0.6, troops: 2, q: 0.3, freedom: 64, next: "2029-10",
      res: { iron: 0.5 }, cities: [["Monrovia", 6.3, -10.8, 1.6], ["Buchanan", 5.88, -10.05, 0.03], ["Harper", 4.38, -7.72, 0.03]] },
    { id: "civ", iso: "384", name: "Côte d'Ivoire", short: "Ivory Coast", leader: "Alassane Ouattara", title: "President", pool: "westafrica", reg: "af", pop: 32, gdp: 87, mil: 1, troops: 27, q: 0.45, regime: "hybrid", freedom: 47, next: "2030-10",
      res: { oil: 0.06 }, cities: [["Yamoussoukro", 6.82, -5.28, 0.4], ["Abidjan", 5.36, -4.01, 6.0], ["Bouaké", 7.69, -5.03, 0.8], ["San-Pédro", 4.75, -6.64, 0.3], ["Korhogo", 9.46, -5.63, 0.3], ["Man", 7.41, -7.55, 0.2]] },
    { id: "gha", iso: "288", name: "Ghana", leader: "John Mahama", title: "President", pool: "westafrica", reg: "af", pop: 34.5, gdp: 80, mil: 0.4, troops: 15, q: 0.5, freedom: 80, next: "2028-12", debt: 70, infl: 10, rate: 20,
      res: { oil: 0.15, grain: 0.4 }, cities: [["Accra", 5.6, -0.19, 5.5], ["Kumasi", 6.69, -1.62, 3.6], ["Tamale", 9.4, -0.84, 0.5], ["Takoradi", 4.9, -1.76, 0.45]] },
    { id: "tgo", iso: "768", name: "Togo", leader: "Faure Gnassingbé", title: "President of the Council of Ministers", pool: "westafrica", reg: "af", pop: 9.5, gdp: 10, mil: 2, troops: 13, q: 0.35, regime: "autocracy", freedom: 30,
      cities: [["Lomé", 6.13, 1.22, 2.0], ["Sokodé", 8.98, 1.13, 0.12], ["Kara", 9.55, 1.19, 0.1]] },
    { id: "ben", iso: "204", name: "Benin", leader: "Romuald Wadagni", title: "President", pool: "westafrica", reg: "af", pop: 14.5, gdp: 22, mil: 0.6, troops: 12, q: 0.35, regime: "hybrid", freedom: 52, next: "2031-04",
      cities: [["Porto-Novo", 6.5, 2.6, 0.3], ["Cotonou", 6.37, 2.43, 2.4], ["Parakou", 9.34, 2.63, 0.25], ["Natitingou", 10.3, 1.38, 0.1]] },   // verify: took office May 2026
    { id: "cpv", iso: "132", name: "Cabo Verde", leader: "Ulisses Correia e Silva", title: "Prime Minister", pool: "portuguese", reg: "af", pop: 0.6, gdp: 2.8, mil: 0.5, troops: 1, q: 0.4, freedom: 92, next: "2030-04",
      cities: [["Praia", 14.93, -23.51, 0.17], ["Mindelo", 16.89, -24.98, 0.08]] },   // verify: the 2026 legislative vote
    { id: "stp", iso: "678", name: "São Tomé and Príncipe", short: "São Tomé", leader: "Carlos Vila Nova", title: "President", pool: "portuguese", reg: "af", pop: 0.23, gdp: 0.7, mil: 0.5, troops: 0.6, q: 0.3, freedom: 84, next: "2026-09",
      cities: [["São Tomé", 0.34, 6.73, 0.08]] },
    { id: "ago", iso: "024", name: "Angola", leader: "João Lourenço", title: "President", pool: "portuguese", reg: "af", pop: 38, gdp: 110, mil: 1.3, troops: 107, q: 0.4, regime: "autocracy", freedom: 28, next: "2027-08", infl: 20, rate: 19,
      res: { oil: 1.1, gas: 0.9, grain: 0.3 }, cities: [["Luanda", -8.84, 13.23, 9.0], ["Cabinda", -5.55, 12.2, 0.6], ["Malanje", -9.54, 16.34, 0.5], ["Saurimo", -9.66, 20.39, 0.4], ["Benguela", -12.58, 13.4, 0.6],
        ["Huambo", -12.78, 15.74, 0.7], ["Lubango", -14.92, 13.49, 0.8], ["Menongue", -14.66, 17.69, 0.3]] },
    { id: "zmb", iso: "894", name: "Zambia", leader: "Hakainde Hichilema", title: "President", pool: "bantu", reg: "af", pop: 21, gdp: 26, mil: 1.2, troops: 15, q: 0.45, freedom: 54, next: "2031-08", debt: 100, infl: 12, rate: 14.5,
      res: { copper: 8, grain: 0.35 }, cities: [["Lusaka", -15.39, 28.32, 3.3], ["Ndola", -12.96, 28.64, 0.6], ["Kitwe", -12.8, 28.21, 0.7], ["Kasama", -10.21, 31.18, 0.1], ["Mongu", -15.25, 23.13, 0.08], ["Livingstone", -17.85, 25.86, 0.18]] },   // verify: August 2026 election
    { id: "zwe", iso: "716", name: "Zimbabwe", leader: "Emmerson Mnangagwa", title: "President", pool: "bantu", reg: "af", pop: 16.6, gdp: 36, mil: 1.5, troops: 30, q: 0.35, regime: "autocracy", freedom: 28, infl: 30, rate: 35,
      res: { grain: 0.2 }, cities: [["Harare", -17.83, 31.05, 2.2], ["Bulawayo", -20.15, 28.58, 0.7], ["Mutare", -18.97, 32.67, 0.2], ["Masvingo", -20.07, 30.83, 0.1], ["Hwange", -18.36, 26.5, 0.04]] },
    { id: "mwi", iso: "454", name: "Malawi", leader: "Peter Mutharika", title: "President", pool: "bantu", reg: "af", pop: 21, gdp: 11, mil: 0.8, troops: 11, q: 0.3, freedom: 65, next: "2030-09", infl: 28, rate: 26,
      res: { grain: 0.35 }, cities: [["Lilongwe", -13.96, 33.79, 1.2], ["Mzuzu", -11.46, 34.02, 0.25], ["Blantyre", -15.79, 35.01, 1.0]] },
    { id: "moz", iso: "508", name: "Mozambique", leader: "Daniel Chapo", title: "President", pool: "portuguese", reg: "af", pop: 34, gdp: 22, mil: 1.2, troops: 11, q: 0.3, regime: "autocracy", freedom: 34,
      res: { gas: 0.6, grain: 0.3 }, cities: [["Maputo", -25.97, 32.57, 2.0], ["Beira", -19.84, 34.84, 0.6], ["Quelimane", -17.88, 36.89, 0.3], ["Tete", -16.16, 33.59, 0.3], ["Nampula", -15.12, 39.27, 0.8], ["Lichinga", -13.31, 35.24, 0.2], ["Pemba", -12.97, 40.52, 0.25]] },
    { id: "mdg", iso: "450", name: "Madagascar", leader: "Michael Randrianirina", title: "President", pool: "malagasy", reg: "af", pop: 31, gdp: 17, mil: 0.7, troops: 13, q: 0.25, regime: "autocracy", freedom: 40,
      cities: [["Antananarivo", -18.88, 47.51, 3.7], ["Toamasina", -18.15, 49.4, 0.35], ["Mahajanga", -15.72, 46.32, 0.3], ["Antsiranana", -12.28, 49.29, 0.15], ["Fianarantsoa", -21.45, 47.08, 0.2], ["Toliara", -23.35, 43.67, 0.2]] },   // the October 2025 coup
    { id: "nam", iso: "516", name: "Namibia", leader: "Netumbo Nandi-Ndaitwah", title: "President", pool: "bantu", reg: "af", pop: 3.1, gdp: 13, mil: 3, troops: 10, q: 0.45, freedom: 77, next: "2029-11",
      res: { uranium: 22 }, cities: [["Windhoek", -22.56, 17.08, 0.5], ["Walvis Bay", -22.96, 14.51, 0.1], ["Oshakati", -17.79, 15.7, 0.05], ["Rundu", -17.92, 19.77, 0.07], ["Keetmanshoop", -26.58, 18.13, 0.03]] },
    { id: "bwa", iso: "072", name: "Botswana", leader: "Duma Boko", title: "President", pool: "bantu", reg: "af", pop: 2.5, gdp: 20, mil: 2.5, troops: 9, q: 0.5, freedom: 72, next: "2029-10",
      res: { copper: 1.3 }, cities: [["Gaborone", -24.65, 25.91, 0.5], ["Francistown", -21.17, 27.51, 0.1], ["Maun", -19.98, 23.42, 0.06], ["Ghanzi", -21.7, 21.65, 0.02]] },
    { id: "lso", iso: "426", name: "Lesotho", leader: "Sam Matekane", title: "Prime Minister", pool: "bantu", reg: "af", pop: 2.3, gdp: 2.3, mil: 1.5, troops: 2, q: 0.3, freedom: 63, next: "2027-10",
      cities: [["Maseru", -29.31, 27.48, 0.33]] },
    { id: "swz", iso: "748", name: "Eswatini", leader: "Mswati III", title: "King", pool: "bantu", reg: "af", pop: 1.2, gdp: 4.9, mil: 1.5, troops: 3, q: 0.3, regime: "autocracy", freedom: 17,
      cities: [["Mbabane", -26.31, 31.14, 0.1], ["Manzini", -26.49, 31.38, 0.11]] },
    { id: "com", iso: "174", name: "Comoros", leader: "Azali Assoumani", title: "President", pool: "swahili", reg: "af", pop: 0.87, gdp: 1.4, mil: 0.5, troops: 0.5, q: 0.3, regime: "autocracy", freedom: 40,
      cities: [["Moroni", -11.7, 43.26, 0.11]] },
    { id: "mus", iso: "480", name: "Mauritius", leader: "Navin Ramgoolam", title: "Prime Minister", pool: "hindi", reg: "af", pop: 1.26, gdp: 15, mil: 0.2, troops: 2, q: 0.4, freedom: 85, next: "2029-11",
      cities: [["Port Louis", -20.16, 57.5, 0.15]] },
    { id: "syc", iso: "690", name: "Seychelles", leader: "Patrick Herminie", title: "President", pool: "french", reg: "af", pop: 0.12, gdp: 2.1, mil: 1, troops: 0.4, q: 0.4, freedom: 80, next: "2030-10",
      cities: [["Victoria", -4.62, 55.45, 0.03]] },

    // ======== NORTH AND CENTRAL AMERICA, THE CARIBBEAN
    { id: "gtm", iso: "320", name: "Guatemala", leader: "Bernardo Arévalo", title: "President", pool: "spanish", reg: "na", pop: 18.4, gdp: 115, mil: 0.4, troops: 18, q: 0.35, regime: "hybrid", freedom: 50, next: "2027-06",
      res: { grain: 0.2 }, cities: [["Guatemala City", 14.63, -90.51, 3.2], ["Quetzaltenango", 14.84, -91.52, 0.2], ["Puerto Barrios", 15.73, -88.6, 0.1], ["Flores", 16.93, -89.89, 0.05]] },
    { id: "blz", iso: "084", name: "Belize", leader: "Johnny Briceño", title: "Prime Minister", pool: "anglo", reg: "na", pop: 0.42, gdp: 3.3, mil: 1.2, troops: 1.5, q: 0.35, freedom: 86, next: "2030-03",
      cities: [["Belmopan", 17.25, -88.77, 0.03], ["Belize City", 17.5, -88.2, 0.07]] },
    { id: "hnd", iso: "340", name: "Honduras", leader: "Nasry Asfura", title: "President", pool: "spanish", reg: "na", pop: 10.8, gdp: 37, mil: 1.5, troops: 15, q: 0.35, regime: "hybrid", freedom: 47, next: "2029-11",
      cities: [["Tegucigalpa", 14.07, -87.19, 1.5], ["San Pedro Sula", 15.5, -88.03, 1.0], ["La Ceiba", 15.76, -86.79, 0.2]] },
    { id: "slv", iso: "222", name: "El Salvador", leader: "Nayib Bukele", title: "President", pool: "spanish", reg: "na", pop: 6.3, gdp: 36, mil: 1.3, troops: 25, q: 0.4, regime: "hybrid", freedom: 47, next: "2027-02", approval: 85,
      cities: [["San Salvador", 13.69, -89.19, 1.1], ["Santa Ana", 13.99, -89.56, 0.25], ["San Miguel", 13.48, -88.18, 0.25]] },
    { id: "nic", iso: "558", name: "Nicaragua", leader: "Daniel Ortega", title: "Co-President", pool: "spanish", reg: "na", pop: 6.9, gdp: 19, mil: 0.6, troops: 12, q: 0.3, regime: "autocracy", freedom: 14,
      cities: [["Managua", 12.13, -86.25, 1.1], ["León", 12.43, -86.88, 0.2], ["Bluefields", 12.01, -83.76, 0.06], ["Puerto Cabezas", 14.03, -83.39, 0.07]] },
    { id: "cri", iso: "188", name: "Costa Rica", leader: "Laura Fernández", title: "President", pool: "spanish", reg: "na", pop: 5.2, gdp: 95, mil: 0, troops: 0, q: 0.3, freedom: 91, next: "2030-02", debt: 60,
      cities: [["San José", 9.93, -84.08, 1.4], ["Liberia", 10.63, -85.44, 0.1], ["Limón", 10.0, -83.03, 0.1]] },
    { id: "pan", iso: "591", name: "Panama", leader: "José Raúl Mulino", title: "President", pool: "spanish", reg: "na", pop: 4.5, gdp: 87, mil: 0.5, troops: 10, q: 0.35, freedom: 83, next: "2029-05", debt: 60,
      res: { copper: 1.0 }, cities: [["Panama City", 8.98, -79.52, 2.0], ["Colón", 9.36, -79.9, 0.2], ["David", 8.43, -82.43, 0.15]] },
    { id: "cub", iso: "192", name: "Cuba", leader: "Miguel Díaz-Canel", title: "President", pool: "spanish", reg: "na", pop: 9.8, gdp: 60, mil: 3, troops: 50, q: 0.4, regime: "autocracy", freedom: 12, infl: 30, u: 10,
      res: { grain: 0.08 }, cities: [["Havana", 23.11, -82.37, 2.1], ["Pinar del Río", 22.42, -83.7, 0.2], ["Santa Clara", 22.41, -79.96, 0.25], ["Camagüey", 21.38, -77.92, 0.3], ["Holguín", 20.89, -76.26, 0.35], ["Santiago de Cuba", 20.02, -75.82, 0.5]] },
    { id: "jam", iso: "388", name: "Jamaica", leader: "Andrew Holness", title: "Prime Minister", pool: "anglo", reg: "na", pop: 2.8, gdp: 20, mil: 1, troops: 6, q: 0.4, freedom: 80, next: "2030-09",
      cities: [["Kingston", 18.0, -76.79, 1.2], ["Montego Bay", 18.47, -77.92, 0.11]] },
    { id: "hti", iso: "332", name: "Haiti", leader: "Alix Didier Fils-Aimé", title: "Prime Minister", pool: "french", reg: "na", pop: 11.8, gdp: 25, mil: 0.1, troops: 1, q: 0.1, regime: "autocracy", freedom: 10, u: 15, infl: 25,
      cities: [["Port-au-Prince", 18.54, -72.34, 3.0], ["Cap-Haïtien", 19.76, -72.2, 0.3], ["Les Cayes", 18.19, -73.75, 0.13]] },   // verify: the council handed over in February 2026
    { id: "dom", iso: "214", name: "Dominican Republic", short: "Dominican Rep.", leader: "Luis Abinader", title: "President", pool: "spanish", reg: "na", pop: 11.4, gdp: 125, mil: 0.7, troops: 56, q: 0.4, freedom: 68, next: "2028-05",
      cities: [["Santo Domingo", 18.49, -69.93, 3.5], ["Santiago", 19.45, -70.7, 1.1], ["Punta Cana", 18.58, -68.4, 0.1]] },
    { id: "bhs", iso: "044", name: "Bahamas", leader: "Philip Davis", title: "Prime Minister", pool: "anglo", reg: "na", pop: 0.41, gdp: 15, mil: 0.7, troops: 1.5, q: 0.4, freedom: 91, next: "2026-10",
      cities: [["Nassau", 25.06, -77.34, 0.3], ["Freeport", 26.53, -78.7, 0.03]] },   // verify: election due 2026
    { id: "tto", iso: "780", name: "Trinidad and Tobago", short: "Trinidad", leader: "Kamla Persad-Bissessar", title: "Prime Minister", pool: "anglo", reg: "na", pop: 1.5, gdp: 28, mil: 1, troops: 5, q: 0.4, freedom: 82, next: "2030-04",
      res: { oil: 0.06, gas: 2.6 }, cities: [["Port of Spain", 10.66, -61.51, 0.55], ["San Fernando", 10.28, -61.46, 0.1]] },
    { id: "brb", iso: "052", name: "Barbados", leader: "Mia Mottley", title: "Prime Minister", pool: "anglo", reg: "na", pop: 0.28, gdp: 7, mil: 0.7, troops: 0.6, q: 0.4, freedom: 95, next: "2031-02",
      cities: [["Bridgetown", 13.1, -59.62, 0.11]] },
    { id: "atg", iso: "028", name: "Antigua and Barbuda", short: "Antigua", leader: "Gaston Browne", title: "Prime Minister", pool: "anglo", reg: "na", pop: 0.1, gdp: 2.2, mil: 0.5, troops: 0.2, q: 0.4, freedom: 85, next: "2028-01",
      cities: [["St. John's", 17.12, -61.85, 0.02]] },
    { id: "lca", iso: "662", name: "Saint Lucia", leader: "Philip J. Pierre", title: "Prime Minister", pool: "anglo", reg: "na", pop: 0.18, gdp: 2.6, mil: 0, troops: 0, q: 0.4, freedom: 92, next: "2030-12",
      cities: [["Castries", 14.01, -60.99, 0.07]] },
    { id: "grd", iso: "308", name: "Grenada", leader: "Dickon Mitchell", title: "Prime Minister", pool: "anglo", reg: "na", pop: 0.12, gdp: 1.4, mil: 0, troops: 0, q: 0.4, freedom: 89, next: "2027-06",
      cities: [["St. George's", 12.05, -61.75, 0.04]] },
    { id: "vct", iso: "670", name: "Saint Vincent and the Grenadines", short: "St. Vincent", leader: "Godwin Friday", title: "Prime Minister", pool: "anglo", reg: "na", pop: 0.1, gdp: 1.2, mil: 0, troops: 0, q: 0.4, freedom: 91, next: "2030-11",
      cities: [["Kingstown", 13.16, -61.23, 0.03]] },
    { id: "kna", iso: "659", name: "Saint Kitts and Nevis", short: "St. Kitts", leader: "Terrance Drew", title: "Prime Minister", pool: "anglo", reg: "na", pop: 0.05, gdp: 1.1, mil: 0.5, troops: 0.3, q: 0.4, freedom: 89, next: "2027-08",
      cities: [["Basseterre", 17.3, -62.72, 0.01]] },
    { id: "dma", iso: "212", name: "Dominica", leader: "Roosevelt Skerrit", title: "Prime Minister", pool: "anglo", reg: "na", pop: 0.07, gdp: 0.7, mil: 0, troops: 0, q: 0.4, freedom: 90, next: "2027-12",
      cities: [["Roseau", 15.3, -61.39, 0.02]] },

    // ======== SOUTH AMERICA
    { id: "chl", iso: "152", name: "Chile", leader: "José Antonio Kast", title: "President", pool: "spanish", reg: "sa", pop: 19.8, gdp: 340, mil: 1.6, troops: 68, q: 0.75, freedom: 94, next: "2029-11", debt: 42,
      res: { copper: 53, iron: 0.9, grain: 0.25 }, cities: [["Santiago", -33.45, -70.67, 7.0], ["Iquique", -20.21, -70.15, 0.3], ["Antofagasta", -23.65, -70.4, 0.4], ["La Serena", -29.9, -71.25, 0.5], ["Valparaíso", -33.05, -71.62, 1.0],
        ["Concepción", -36.83, -73.05, 1.0], ["Puerto Montt", -41.47, -72.94, 0.25], ["Coyhaique", -45.57, -72.07, 0.06], ["Punta Arenas", -53.16, -70.92, 0.13]] },
    { id: "col", iso: "170", name: "Colombia", leader: "Gustavo Petro", title: "President", pool: "spanish", reg: "sa", pop: 53, gdp: 420, mil: 3.1, troops: 260, q: 0.6, freedom: 70, next: "2030-05", debt: 60, infl: 5, rate: 9.25,
      res: { oil: 0.78, gas: 0.1, grain: 0.2 }, cities: [["Bogotá", 4.71, -74.07, 11.5], ["Medellín", 6.24, -75.58, 4.0], ["Cali", 3.45, -76.53, 2.8], ["Barranquilla", 10.96, -74.8, 2.3], ["Cartagena", 10.39, -75.48, 1.1],
        ["Cúcuta", 7.89, -72.5, 1.0], ["Bucaramanga", 7.12, -73.12, 1.3], ["Villavicencio", 4.14, -73.63, 0.6], ["Leticia", -4.21, -69.94, 0.05]] },   // verify: the May-June 2026 vote picks his successor (August 2026)
    { id: "ven", iso: "862", name: "Venezuela", leader: "Delcy Rodríguez", title: "Acting President", pool: "spanish", reg: "sa", pop: 28.5, gdp: 100, mil: 1, troops: 123, q: 0.35, regime: "autocracy", freedom: 13, infl: 150, rate: 50, approval: 30,
      res: { oil: 1.0, gas: 2.5, iron: 0.3 }, cities: [["Caracas", 10.49, -66.88, 3.0], ["Maracaibo", 10.65, -71.64, 2.3], ["Valencia", 10.16, -68.0, 1.6], ["Barquisimeto", 10.07, -69.32, 1.3], ["Ciudad Bolívar", 8.12, -63.55, 0.4],
        ["Ciudad Guayana", 8.35, -62.65, 1.0], ["San Fernando de Apure", 7.89, -67.47, 0.1], ["Puerto Ayacucho", 5.66, -67.62, 0.1]] },   // verify: since the January 2026 capture of Maduro
    { id: "per", iso: "604", name: "Peru", leader: "José María Balcázar", title: "President", pool: "spanish", reg: "sa", pop: 34.5, gdp: 300, mil: 1.1, troops: 81, q: 0.5, freedom: 66, next: "2031-04", debt: 33,
      res: { copper: 27, gas: 1.3, iron: 1.7, grain: 0.5 }, cities: [["Lima", -12.05, -77.04, 11.0], ["Piura", -5.19, -80.63, 0.5], ["Chiclayo", -6.77, -79.84, 0.6], ["Trujillo", -8.11, -79.03, 1.0], ["Iquitos", -3.75, -73.25, 0.5],
        ["Pucallpa", -8.38, -74.55, 0.3], ["Cusco", -13.53, -71.97, 0.45], ["Arequipa", -16.41, -71.54, 1.1], ["Puno", -15.84, -70.02, 0.15]] },   // verify: interim; the 2026 winner takes office July 2026
    { id: "ecu", iso: "218", name: "Ecuador", leader: "Daniel Noboa", title: "President", pool: "spanish", reg: "sa", pop: 18, gdp: 125, mil: 2.2, troops: 40, q: 0.45, freedom: 67, next: "2029-02", debt: 55,
      res: { oil: 0.47 }, cities: [["Quito", -0.18, -78.47, 2.0], ["Guayaquil", -2.19, -79.89, 3.0], ["Cuenca", -2.9, -79.0, 0.6], ["Manta", -0.95, -80.73, 0.3], ["Lago Agrio", 0.09, -76.88, 0.1], ["Puerto Ayora", -0.74, -90.31, 0.03]] },
    { id: "bol", iso: "068", name: "Bolivia", leader: "Rodrigo Paz", title: "President", pool: "spanish", reg: "sa", pop: 12.5, gdp: 50, mil: 1.4, troops: 34, q: 0.35, freedom: 64, next: "2030-08", debt: 90, infl: 18, rate: 9,
      res: { gas: 1.2, grain: 0.3 }, cities: [["La Paz", -16.5, -68.15, 2.0], ["Cobija", -11.03, -68.77, 0.07], ["Trinidad", -14.83, -64.9, 0.13], ["Cochabamba", -17.39, -66.16, 1.3], ["Santa Cruz", -17.78, -63.18, 2.0],
        ["Sucre", -19.05, -65.26, 0.3], ["Potosí", -19.58, -65.75, 0.2], ["Tarija", -21.53, -64.73, 0.25]] },
    { id: "pry", iso: "600", name: "Paraguay", leader: "Santiago Peña", title: "President", pool: "spanish", reg: "sa", pop: 6.9, gdp: 45, mil: 1, troops: 14, q: 0.35, freedom: 65, next: "2028-04",
      res: { grain: 2.0 }, cities: [["Asunción", -25.26, -57.58, 2.3], ["Concepción", -23.4, -57.43, 0.08], ["Filadelfia", -22.35, -60.03, 0.02], ["Ciudad del Este", -25.51, -54.61, 0.4], ["Encarnación", -27.33, -55.87, 0.13]] },
    { id: "ury", iso: "858", name: "Uruguay", leader: "Yamandú Orsi", title: "President", pool: "spanish", reg: "sa", pop: 3.4, gdp: 82, mil: 2, troops: 22, q: 0.55, freedom: 96, next: "2029-10",
      res: { grain: 0.4 }, cities: [["Montevideo", -34.9, -56.16, 1.8], ["Paysandú", -32.32, -58.08, 0.08], ["Salto", -31.38, -57.96, 0.1], ["Rivera", -30.9, -55.55, 0.08]] },
    { id: "guy", iso: "328", name: "Guyana", leader: "Irfaan Ali", title: "President", pool: "anglo", reg: "sa", pop: 0.83, gdp: 25, mil: 1, troops: 3.4, q: 0.35, freedom: 73, next: "2030-09",
      res: { oil: 0.65 }, cities: [["Georgetown", 6.8, -58.16, 0.2], ["Linden", 6.0, -58.3, 0.03], ["Lethem", 3.38, -59.8, 0.01]] },
    { id: "sur", iso: "740", name: "Suriname", leader: "Jennifer Geerlings-Simons", title: "President", pool: "dutch", reg: "sa", pop: 0.63, gdp: 4.5, mil: 1, troops: 2, q: 0.3, freedom: 79, next: "2030-05",
      cities: [["Paramaribo", 5.85, -55.2, 0.24], ["Nieuw Nickerie", 5.95, -56.98, 0.01], ["Albina", 5.5, -54.05, 0.005]] },

    // ======== OCEANIA
    { id: "nzl", iso: "554", name: "New Zealand", leader: "Christopher Luxon", title: "Prime Minister", pool: "anglo", reg: "oc", pop: 5.3, gdp: 260, mil: 1.1, troops: 9, q: 0.9, freedom: 99, next: "2026-11", debt: 45, also: ["570", "184"],
      res: { grain: 0.1 }, cities: [["Wellington", -41.29, 174.78, 0.45], ["Auckland", -36.85, 174.76, 1.7], ["Hamilton", -37.79, 175.28, 0.18], ["Christchurch", -43.53, 172.64, 0.4], ["Dunedin", -45.87, 170.5, 0.13]] },   // verify: November 2026 election
    { id: "png", iso: "598", name: "Papua New Guinea", short: "PNG", leader: "James Marape", title: "Prime Minister", pool: "pacific", reg: "oc", pop: 10.3, gdp: 32, mil: 0.4, troops: 4, q: 0.2, regime: "hybrid", freedom: 61, next: "2027-06",
      res: { gas: 1.2, copper: 0.9 }, cities: [["Port Moresby", -9.44, 147.18, 0.4], ["Lae", -6.72, 146.99, 0.1], ["Mount Hagen", -5.86, 144.23, 0.05], ["Madang", -5.22, 145.79, 0.03], ["Wewak", -3.55, 143.63, 0.03], ["Kokopo", -4.34, 152.27, 0.03]] },
    { id: "fji", iso: "242", name: "Fiji", leader: "Sitiveni Rabuka", title: "Prime Minister", pool: "pacific", reg: "oc", pop: 0.93, gdp: 5.9, mil: 1.4, troops: 4, q: 0.4, regime: "hybrid", freedom: 66, next: "2026-12",
      cities: [["Suva", -18.14, 178.44, 0.19], ["Lautoka", -17.61, 177.45, 0.07]] },
    { id: "slb", iso: "090", name: "Solomon Islands", short: "Solomons", leader: "Jeremiah Manele", title: "Prime Minister", pool: "pacific", reg: "oc", pop: 0.74, gdp: 1.7, mil: 0, troops: 0, q: 0.3, freedom: 73, next: "2028-04",
      cities: [["Honiara", -9.43, 159.95, 0.09]] },
    { id: "vut", iso: "548", name: "Vanuatu", leader: "Jotham Napat", title: "Prime Minister", pool: "pacific", reg: "oc", pop: 0.33, gdp: 1.2, mil: 0, troops: 0, q: 0.3, freedom: 82, next: "2029-01",
      cities: [["Port Vila", -17.73, 168.32, 0.05]] },
    { id: "wsm", iso: "882", name: "Samoa", leader: "La'auli Leuatea Schmidt", title: "Prime Minister", pool: "pacific", reg: "oc", pop: 0.22, gdp: 1.0, mil: 0, troops: 0, q: 0.3, freedom: 81, next: "2030-08",
      cities: [["Apia", -13.83, -171.76, 0.04]] },
    { id: "ton", iso: "776", name: "Tonga", leader: "Lord Fakafanua", title: "Prime Minister", pool: "pacific", reg: "oc", pop: 0.1, gdp: 0.5, mil: 0.5, troops: 0.6, q: 0.3, freedom: 79, next: "2029-11",
      cities: [["Nuku'alofa", -21.14, -175.2, 0.03]] },   // verify
    { id: "kir", iso: "296", name: "Kiribati", leader: "Taneti Maamau", title: "President", pool: "pacific", reg: "oc", pop: 0.13, gdp: 0.3, mil: 0, troops: 0, q: 0.3, freedom: 87, next: "2028-10",
      cities: [["Tarawa", 1.45, 173.0, 0.06]] },
    { id: "fsm", iso: "583", name: "Micronesia", leader: "Wesley Simina", title: "President", pool: "pacific", reg: "oc", pop: 0.11, gdp: 0.5, mil: 0, troops: 0, q: 0.3, freedom: 92, next: "2027-03",
      cities: [["Palikir", 6.92, 158.16, 0.01]] },
    { id: "mhl", iso: "584", name: "Marshall Islands", short: "Marshall Is.", leader: "Hilda Heine", title: "President", pool: "pacific", reg: "oc", pop: 0.04, gdp: 0.3, mil: 0, troops: 0, q: 0.3, freedom: 93, next: "2027-11",
      cities: [["Majuro", 7.09, 171.38, 0.03]] },
    { id: "plw", iso: "585", name: "Palau", leader: "Surangel Whipps Jr.", title: "President", pool: "pacific", reg: "oc", pop: 0.018, gdp: 0.3, mil: 0, troops: 0, q: 0.3, freedom: 92, next: "2028-11",
      cities: [["Koror", 7.34, 134.48, 0.011]] },
    { id: "nru", iso: "520", name: "Nauru", leader: "David Adeang", title: "President", pool: "pacific", reg: "oc", pop: 0.012, gdp: 0.15, mil: 0, troops: 0, q: 0.3, freedom: 77, next: "2028-10",
      cities: [["Yaren", -0.55, 166.92, 0.001]] },
  ];

  /* THE WORLD AS IT STANDS ON DAY ONE: the blocs that like each other, the
     pairs that do not, the treaties, the war, the sanctions and tariffs. A
     scenario keeps the rows whose countries are both in it. */
  const EU = ["aut", "bel", "bgr", "hrv", "cyp", "cze", "dnk", "est", "fin", "fra", "deu", "grc", "hun", "irl", "ita", "lva", "ltu", "lux", "mlt", "nld", "pol", "prt", "rou", "svk", "svn", "esp", "swe"];
  const NATO = ["usa", "can", "gbr", "fra", "deu", "ita", "esp", "pol", "tur", "nld", "bel", "lux", "nor", "dnk", "isl", "prt", "grc", "cze", "svk", "hun",
    "rou", "bgr", "hrv", "svn", "alb", "mne", "mkd", "est", "lva", "ltu", "fin", "swe"];
  const BLOCS = {
    west: ["usa", "can", "gbr", "fra", "deu", "ita", "esp", "pol", "jpn", "kor", "aus", "isr", "ukr", "nld", "bel", "lux", "nor", "dnk", "isl", "prt", "grc", "cze", "svk",
      "rou", "bgr", "hrv", "svn", "est", "lva", "ltu", "fin", "swe", "irl", "aut", "nzl", "twn", "mlt", "cyp", "mda"],
    east: ["rus", "chn", "irn", "prk", "blr", "cub", "nic"],
  };
  const REL = [   // pair overrides, -100..100
    ["rus", "ukr", -95], ["isr", "irn", -92], ["usa", "irn", -75], ["usa", "prk", -75], ["kor", "prk", -72], ["ind", "pak", -70],
    ["jpn", "prk", -65], ["usa", "rus", -55], ["pol", "rus", -75], ["gbr", "rus", -60], ["deu", "rus", -45], ["fra", "rus", -45],
    ["usa", "chn", -30], ["jpn", "chn", -35], ["ind", "chn", -25], ["aus", "chn", -15], ["kor", "chn", -5], ["tur", "isr", -45],
    ["sau", "irn", -20], ["egy", "isr", 5], ["sau", "isr", 0], ["rus", "chn", 62], ["rus", "prk", 68], ["rus", "irn", 52], ["chn", "prk", 40],
    ["chn", "irn", 35], ["chn", "pak", 60], ["usa", "isr", 80], ["usa", "gbr", 75], ["usa", "can", 40], ["usa", "mex", 15], ["ind", "rus", 35],
    ["usa", "ind", 25], ["usa", "sau", 45], ["tur", "rus", 15], ["bra", "chn", 30], ["zaf", "rus", 20], ["arg", "usa", 50],
    // the rest of the world's grudges and friendships
    ["chn", "twn", -90], ["usa", "twn", 60], ["jpn", "twn", 40], ["chn", "phl", -45], ["usa", "phl", 55], ["chn", "vnm", -20], ["ind", "bgd", -15],
    ["mar", "dza", -55], ["eth", "eri", -45], ["egy", "eth", -40], ["sdn", "ssd", -20], ["cod", "rwa", -70], ["som", "eth", -25], ["egy", "sdn", 40],
    ["arm", "aze", -55], ["rus", "geo", -60], ["srb", "xkx", -70], ["alb", "srb", -30], ["grc", "tur", -25], ["cyp", "tur", -55], ["arm", "tur", -30], ["tur", "aze", 80],
    ["ven", "guy", -55], ["ven", "col", -20], ["ven", "usa", -60], ["cub", "usa", -60], ["nic", "usa", -40], ["usa", "col", -30], ["ecu", "mex", -40], ["col", "ecu", -15],
    ["chl", "bol", -30], ["arg", "gbr", -25], ["bra", "arg", -10], ["ury", "arg", 20],
    ["isr", "lbn", -60], ["isr", "syr", -45], ["isr", "pse", -50], ["isr", "jor", 5], ["isr", "are", 25], ["isr", "bhr", 20], ["isr", "mar", 20],
    ["sau", "yem", 40], ["irn", "are", -15], ["sau", "qat", 20], ["irq", "kwt", 10], ["irq", "irn", 40], ["syr", "tur", 30], ["syr", "rus", -10], ["pak", "sau", 60],
    ["afg", "pak", -50], ["tha", "khm", -45], ["kgz", "tjk", -15], ["rus", "blr", 80], ["rus", "kaz", 30], ["rus", "mda", -50], ["ukr", "blr", -60], ["pol", "blr", -55],
    ["mli", "dza", -45], ["bfa", "civ", -30], ["ner", "ben", -35], ["tcd", "sdn", -30], ["dza", "fra", -30], ["mli", "fra", -60], ["bfa", "fra", -60], ["ner", "fra", -60],
    ["aus", "nzl", 80], ["kor", "jpn", 10], ["rus", "mli", 40], ["rus", "bfa", 40], ["rus", "ner", 40],
  ];
  const ALLIANCES = [
    NATO,                                               // NATO
    EU,                                                 // the EU's mutual-defence clause
    ["usa", "jpn"], ["usa", "kor"], ["usa", "aus"], ["usa", "phl"], ["aus", "nzl"],
    ["rus", "prk"], ["chn", "prk"],
    ["rus", "blr", "kaz", "kgz", "tjk"],                // the CSTO, as far as it still stands
    ["sau", "kwt", "bhr", "qat", "are", "omn"],         // the Gulf Cooperation Council
    ["sau", "pak"],                                     // the 2025 mutual-defence pact
    ["tur", "aze"],
    ["mli", "bfa", "ner"],                              // the Alliance of Sahel States
  ];
  const WARS = [["rus", "ukr"]];
  // [who, on whom]: the West on Russia, Iran, North Korea and Belarus; the US alone where it is alone
  const SANCTIONS = [];
  (function () {
    const onRus = ["usa", "can", "gbr", "jpn", "aus", "nzl", "kor", "nor", "che", "isl", "ukr"].concat(EU);
    onRus.forEach(function (w) { SANCTIONS.push([w, "rus"]); });
    ["usa", "gbr", "isr", "can"].concat(EU).forEach(function (w) { SANCTIONS.push([w, "irn"]); });
    ["usa", "kor", "jpn", "gbr"].concat(EU).forEach(function (w) { SANCTIONS.push([w, "prk"]); });
    ["usa", "gbr", "can", "ukr"].concat(EU).forEach(function (w) { SANCTIONS.push([w, "blr"]); });
    SANCTIONS.push(["usa", "cub"], ["usa", "ven"], ["usa", "nic"], ["usa", "mmr"], ["gbr", "mmr"]);
  })();
  const TARIFFS = [["usa", "chn", 0.3], ["chn", "usa", 0.1], ["usa", "ind", 0.25], ["usa", "bra", 0.25], ["usa", "can", 0.1], ["usa", "mex", 0.1]];

  /* HOW A LEADER LEANS, where the record says (president/ai.js reads these):
     [aggr: reaches for the army, mad: how far he goes, auth: how little the
     vote and the press matter to him, prot: tariffs and caution]. A leader
     with no row here is rolled from the seed. */
  const DIALS = {
    usa: [0.5, 0.25, 0.45, 0.95], rus: [0.85, 0.45, 0.95, 0.6], chn: [0.5, 0.2, 0.95, 0.6], prk: [0.6, 0.6, 1.0, 0.9],
    irn: [0.6, 0.35, 0.95, 0.7], isr: [0.8, 0.25, 0.5, 0.4], tur: [0.5, 0.2, 0.7, 0.5], ind: [0.4, 0.15, 0.5, 0.6],
    pak: [0.45, 0.25, 0.6, 0.5], sau: [0.45, 0.15, 0.9, 0.4], ukr: [0.6, 0.1, 0.4, 0.3], egy: [0.3, 0.1, 0.85, 0.5],
    aze: [0.6, 0.2, 0.95, 0.5], rwa: [0.6, 0.2, 0.9, 0.4], blr: [0.35, 0.3, 1.0, 0.7], srb: [0.4, 0.2, 0.7, 0.5],
    afg: [0.6, 0.4, 1.0, 0.8], mli: [0.6, 0.3, 0.95, 0.6], bfa: [0.6, 0.3, 0.95, 0.6], ner: [0.55, 0.3, 0.95, 0.6],
    eri: [0.6, 0.35, 1.0, 0.8], ven: [0.45, 0.3, 0.9, 0.7], twn: [0.15, 0.05, 0.2, 0.4], slv: [0.4, 0.2, 0.85, 0.5],
    are: [0.5, 0.15, 0.9, 0.3], dza: [0.4, 0.15, 0.85, 0.7], mar: [0.4, 0.1, 0.8, 0.4], eth: [0.55, 0.2, 0.8, 0.5],
  };

  /* ARMIES BIGGER THAN THEIR BUDGETS: conscript armies and armies kept in
     the field by other people's money fight above what their own military
     spending buys (divisions; the budget gives the rest of the world theirs).
     A row without one here fields troops / 40 divisions when that is more
     than its budget buys. */
  const ARMY = { ukr: 27, rus: 31, prk: 14, irn: 12, pak: 14, egy: 9, isr: 14, kor: 18, tur: 15, ind: 30 };

  /* WHAT A SHORT ROW LEAVES OUT, from what kind of country it is. Only
     bookkeeping lives here: every name, leader and number that is a fact is
     in the row. */
  const POOL_OF = { na: "anglo", sa: "spanish", eu: "anglo", me: "arabic", af: "westafrica", as: "chinese", oc: "pacific" };
  function fill(n) {
    n.short = n.short || n.name;
    n.title = n.title || "President";
    n.regime = n.regime || "democracy";
    if (n.freedom == null) n.freedom = n.regime === "democracy" ? 82 : n.regime === "hybrid" ? 45 : 15;
    if (n.elections == null) n.elections = n.regime !== "autocracy";
    if (n.term == null) n.term = n.elections ? (n.regime === "democracy" ? 4 : 5) : 0;
    if (n.next == null) n.next = "";
    if (n.approval == null) n.approval = n.regime === "autocracy" ? 60 : 45;
    if (n.debt == null) n.debt = 55;
    if (n.u == null) n.u = 7;
    if (n.infl == null) n.infl = 4;
    if (n.rate == null) n.rate = Math.max(1, n.infl + 2.5);
    if (n.nukes == null) n.nukes = 0;
    if (n.ind == null) n.ind = 0.6;
    if (n.haven == null) n.haven = 0;
    if (n.mil == null) n.mil = 1.5;
    if (n.q == null) n.q = 0.5;
    if (n.troops == null) n.troops = 0;
    n.res = n.res || {};
    n.pool = n.pool || POOL_OF[n.reg] || "anglo";
    if (n.army == null && ARMY[n.id]) n.army = ARMY[n.id];
    return n;
  }

  const byId = {};
  LIST.forEach(function (n) { fill(n); byId[n.id] = n; });
  CBZ.presNations = {
    AS_OF: AS_OF, START: START, list: LIST, byId: byId, POOLS: POOLS, DIALS: DIALS, fill: fill,
    BLOCS: BLOCS, REL: REL, ALLIANCES: ALLIANCES, WARS: WARS, SANCTIONS: SANCTIONS, TARIFFS: TARIFFS,
    names: function (pool) { return POOLS[pool] || POOLS.anglo; },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.presNations;
})(this);
