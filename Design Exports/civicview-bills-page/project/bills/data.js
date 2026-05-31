/* ============================================================
   CivicView · /bills — seeded, SYNTHETIC vote data
   Two roll-calls: H.R. 1041 (House passage) + PN 1188 (Senate
   nomination). Numbers are illustrative, not a real record.
   Seat arrays are generated deterministically so the chart, the
   header tally, and the vote list are always mutually consistent.
   ============================================================ */
(function () {
  var PARTY = { R: '#e63946', D: '#457b9d', I: '#6c3ec1' };
  window.CV_PARTY = PARTY;

  // ---- tiny seeded RNG (mulberry32) so layouts are stable ----
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, seed) {
    var r = rng(seed), a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  // ---- real 2020 apportionment (sums to 435) ----
  var HOUSE_STATES = [
    ['CA','California',52],['TX','Texas',38],['FL','Florida',28],['NY','New York',26],
    ['PA','Pennsylvania',17],['IL','Illinois',17],['OH','Ohio',15],['GA','Georgia',14],
    ['NC','North Carolina',14],['MI','Michigan',13],['NJ','New Jersey',12],['VA','Virginia',11],
    ['WA','Washington',10],['AZ','Arizona',9],['TN','Tennessee',9],['IN','Indiana',9],
    ['MA','Massachusetts',9],['MO','Missouri',8],['MD','Maryland',8],['WI','Wisconsin',8],
    ['CO','Colorado',8],['MN','Minnesota',8],['SC','South Carolina',7],['AL','Alabama',7],
    ['LA','Louisiana',6],['KY','Kentucky',6],['OR','Oregon',6],['OK','Oklahoma',5],
    ['CT','Connecticut',5],['UT','Utah',4],['IA','Iowa',4],['NV','Nevada',4],
    ['AR','Arkansas',4],['MS','Mississippi',4],['KS','Kansas',4],['NM','New Mexico',3],
    ['NE','Nebraska',3],['ID','Idaho',2],['WV','West Virginia',2],['HI','Hawaii',2],
    ['NH','New Hampshire',2],['ME','Maine',2],['RI','Rhode Island',2],['MT','Montana',2],
    ['DE','Delaware',1],['SD','South Dakota',1],['ND','North Dakota',1],['AK','Alaska',1],
    ['VT','Vermont',1],['WY','Wyoming',1]
  ];
  // alphabetical by full name — this IS the arc-ordering rule (state ▸ party)
  var STATES_ALPHA = HOUSE_STATES.slice().sort(function (a, b) {
    return a[1] < b[1] ? -1 : 1;
  });

  // deterministic "redness" per state for party split
  function redness(abbr) {
    var h = 0; for (var i = 0; i < abbr.length; i++) h = (h * 31 + abbr.charCodeAt(i)) | 0;
    var r = rng(h >>> 0)(); // 0..1
    return 0.18 + r * 0.64;
  }

  // ---- exemplar members (the few fully-wired seats) ----
  // position: 'yea' | 'nay' | 'present' | 'nv'
  var HOUSE_EX = [
    { name: 'Donalds, Byron', party: 'R', st: 'FL', dist: 'FL-19', pos: 'yea' },
    { name: 'Gonzales, Tony', party: 'R', st: 'TX', dist: 'TX-23', pos: 'yea' },
    { name: 'Pelosi, Nancy', party: 'D', st: 'CA', dist: 'CA-11', pos: 'nay' },
    { name: 'Crockett, Jasmine', party: 'D', st: 'TX', dist: 'TX-30', pos: 'nay' },
    { name: 'Golden, Jared', party: 'D', st: 'ME', dist: 'ME-02', pos: 'yea' },
    { name: 'Scalise, Steve', party: 'R', st: 'LA', dist: 'LA-01', pos: 'nv' }
  ];
  var SENATE_EX = [
    { name: 'Cruz, Ted', party: 'R', st: 'TX', dist: 'TX', pos: 'yea' },
    { name: 'Collins, Susan', party: 'R', st: 'ME', dist: 'ME', pos: 'nay' },
    { name: 'Murkowski, Lisa', party: 'R', st: 'AK', dist: 'AK', pos: 'nay' },
    { name: 'Fetterman, John', party: 'D', st: 'PA', dist: 'PA', pos: 'yea' },
    { name: 'Sanders, Bernard', party: 'I', st: 'VT', dist: 'VT', caucus: 'D', pos: 'nay' },
    { name: 'King, Angus', party: 'I', st: 'ME', dist: 'ME', caucus: 'D', pos: 'nay' }
  ];

  // ---- House seat split per state (R block then D block) ----
  function houseParties() {
    // target totals
    var seats = [];
    STATES_ALPHA.forEach(function (s) {
      var abbr = s[0], n = s[2];
      var r = Math.round(n * redness(abbr));
      r = Math.max(0, Math.min(n, r));
      for (var i = 0; i < n; i++) seats.push({ st: abbr, party: i < r ? 'R' : 'D' });
    });
    // nudge to R 220 / D 215
    function count(p) { return seats.filter(function (x) { return x.party === p; }).length; }
    var guard = 0;
    while (count('R') > 220 && guard++ < 2000) { var k = seats.findIndex(function (x) { return x.party === 'R'; }); seats[k].party = 'D'; }
    guard = 0;
    while (count('R') < 220 && guard++ < 2000) { var k2 = seats.map(function (x, i) { return [x, i]; }).filter(function (z) { return z[0].party === 'D'; }).pop()[1]; seats[k2].party = 'R'; }
    return seats;
  }

  // ---- Senate: 2 per state, alpha ▸ party ----
  function senateParties() {
    var SEN_FORCE = { VT: ['I', 'D'], ME: ['I', 'R'], AZ: ['D', 'R'], WV: ['R', 'D'] };
    var seats = [];
    STATES_ALPHA.forEach(function (s) {
      var abbr = s[0];
      var pair = SEN_FORCE[abbr];
      if (!pair) { var r = redness(abbr); pair = r > 0.5 ? ['R', 'R'] : (r > 0.42 ? ['R', 'D'] : ['D', 'D']); }
      pair.forEach(function (p) { seats.push({ st: abbr, party: p }); });
    });
    // nudge R toward 53
    function count(p) { return seats.filter(function (x) { return x.party === p; }).length; }
    var guard = 0;
    while (count('R') > 53 && guard++ < 400) { var k = seats.findIndex(function (x) { return x.party === 'R'; }); seats[k].party = 'D'; }
    guard = 0;
    while (count('R') < 53 && guard++ < 400) { var k2 = seats.map(function (x, i) { return [x, i]; }).filter(function (z) { return z[0].party === 'D'; }).pop()[1]; seats[k2].party = 'R'; }
    return seats;
  }

  // ---- assign positions to a party-grouped seat list ----
  // posByParty: { R:{yea,nay,present,nv}, D:{...}, I:{...} }
  function assignPositions(seats, posByParty, exemplars, seed) {
    // build a shuffled pool per party
    var pools = {};
    Object.keys(posByParty).forEach(function (p) {
      var pool = [];
      ['yea', 'nay', 'present', 'nv'].forEach(function (v) {
        var c = posByParty[p][v] || 0;
        for (var i = 0; i < c; i++) pool.push(v);
      });
      pools[p] = shuffle(pool, seed + p.charCodeAt(0));
    });
    var ptr = { R: 0, D: 0, I: 0 };
    var INI = 'ABCDEFGHJKLMNPRSTVW';
    seats.forEach(function (s, gi) {
      var pool = pools[s.party] || [];
      s.pos = pool[ptr[s.party]++] || 'nv';
      s.name = null; s.dist = null; s.exemplar = false;
      var r = rng(seed * 131 + gi * 7 + s.st.charCodeAt(0));
      s.initials = INI[Math.floor(r() * INI.length)] + INI[Math.floor(r() * INI.length)];
    });
    // inject exemplars: find a seat in matching state+party, override
    exemplars.forEach(function (ex) {
      var cand = seats.filter(function (s) { return s.st === ex.st && s.party === ex.party && !s.exemplar; });
      var target = cand.find(function (s) { return s.pos === ex.pos; }) || cand[0];
      if (target) {
        target.name = ex.name; target.dist = ex.dist; target.pos = ex.pos;
        target.exemplar = true; if (ex.caucus) target.caucus = ex.caucus;
        // initials from "Last, First" → FL
        var parts = ex.name.replace(',', '').split(' ').filter(Boolean);
        target.initials = parts.length >= 2 ? (parts[1][0] + parts[0][0]).toUpperCase() : ex.name.slice(0, 2).toUpperCase();
      }
    });
    return seats;
  }

  function tally(seats) {
    var t = { yea: 0, nay: 0, present: 0, nv: 0,
              byParty: { R: { yea: 0, nay: 0 }, D: { yea: 0, nay: 0 }, I: { yea: 0, nay: 0 } } };
    seats.forEach(function (s) {
      t[s.pos]++;
      if (s.pos === 'yea' || s.pos === 'nay') t.byParty[s.party][s.pos]++;
    });
    return t;
  }

  // ---------- build House vote ----------
  var hSeats = assignPositions(
    houseParties(),
    { R: { yea: 209, nay: 1, present: 0, nv: 10 }, D: { yea: 7, nay: 200, present: 1, nv: 7 } },
    HOUSE_EX, 1041
  );
  var hT = tally(hSeats);

  // ---------- build Senate vote ----------
  var sSeats = assignPositions(
    senateParties(),
    { R: { yea: 51, nay: 2, present: 0, nv: 0 }, D: { yea: 1, nay: 44, present: 0, nv: 0 }, I: { yea: 0, nay: 2, present: 0, nv: 0 } },
    SENATE_EX, 1188
  );
  var sT = tally(sSeats);

  window.CV_DATA = {
    house: {
      chamber: 'House',
      cite: 'H.R. 1041',
      type: 'passage',
      title: 'Border Infrastructure & Port Modernization Act',
      question: 'This was a vote to pass H.R. 1041 in the House.',
      date: 'May 20, 2026',
      result: 'Passed',           // Passed | Failed | Confirmed | Rejected
      seats: hSeats, tally: hT,
      total: hSeats.length
    },
    senate: {
      chamber: 'Senate',
      cite: 'PN 1188',
      type: 'nomination',
      title: 'Dana R. Okafor, of Illinois, to be Secretary of Transportation',
      question: 'This was a vote on the confirmation of Dana R. Okafor to be Secretary of Transportation.',
      date: 'May 27, 2026',
      result: 'Confirmed',
      seats: sSeats, tally: sT,
      total: sSeats.length,
      indCaucusNote: 'Independents are grouped with the party they caucus with (D).'
    },
    // recent-votes selector pool (synthetic)
    recent: {
      House: [
        { id: 'hr1041', cite: 'H.R. 1041', q: 'Border Infrastructure & Port Modernization Act', date: 'May 20', result: 'Passed' },
        { id: 'hr0892', cite: 'H.R. 892', q: 'Rural Broadband Access Act', date: 'May 14', result: 'Passed' },
        { id: 'hr1330', cite: 'H.R. 1330', q: 'Federal Pay Transparency Act', date: 'May 8', result: 'Failed' },
        { id: 'hres210', cite: 'H.Res. 210', q: 'Disapproving the FCC spectrum rule', date: 'Apr 30', result: 'Passed' }
      ],
      Senate: [
        { id: 'pn1188', cite: 'PN 1188', q: 'Okafor — Secretary of Transportation', date: 'May 27', result: 'Confirmed' },
        { id: 'pn1142', cite: 'PN 1142', q: 'Reyes — U.S. Circuit Judge, 9th Cir.', date: 'May 21', result: 'Confirmed' },
        { id: 's0455', cite: 'S. 455', q: 'Veterans Telehealth Expansion Act', date: 'May 12', result: 'Passed' },
        { id: 'pn1099', cite: 'PN 1099', q: 'Whitfield — Under Sec. of Commerce', date: 'May 6', result: 'Rejected' }
      ]
    }
  };
})();
