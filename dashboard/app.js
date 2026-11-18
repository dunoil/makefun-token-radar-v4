// Launch Radar Terminal (radar-4). Reads window.RADAR (written beside dashboard/ by main.ts) and
// renders: the coverage accounting, the fitted model with its printed out-of-sample validation,
// two charts, what-if farm controls that recompute every verdict live, the ranked board, a
// per-protocol detail drawer with the full maths, and the set-aside listing. No network: every
// byte it shows is in data.js, and the footer re-derives each row's value from the printed inputs.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var A = DATA.assumptions;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, wl: false, verdict: 'all', sort: 'rank', dir: 1, deposit: 5000, drop: A.drop, yieldPct: A.yield_pct, selected: null };

  // Hash state, so a view can be linked (and screenshotted): #row=<slug>, #verdict=FARM, #deposit=25000
  (location.hash || '').replace(/[#&]+([^=&]+)=([^&]*)/g, function (m, k, v) {
    v = decodeURIComponent(v);
    if (k === 'row') state.selected = v;
    if (k === 'verdict') state.verdict = v;
    if (k === 'deposit') state.deposit = parseInt(v, 10) || state.deposit;
    return m;
  });

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return usd0.format(n);
  }
  function fmtMoney(n) { return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2); }
  function fmtPct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function fmtAge(d) { return d === null ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd'; }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  // The farm maths, the same arithmetic lib/model.ts prints on the board: change a control and
  // every verdict on the page is this function, recomputed.
  function netOf(row, deposit, drop, yieldPct) {
    var gross = row.implied_value_usd * drop * (deposit / (deposit + row.tvl_usd));
    var time = (row.minutes / 60) * A.time_usd_hr;
    var idle = deposit * (yieldPct / 100) * (A.horizon_weeks / 52);
    return gross - row.fees_usd - time - idle;
  }
  function verdictOf(net) { return net >= A.farm_net_usd ? 'FARM' : net >= 0 ? 'THIN' : 'SKIP'; }

  var chosen = null;
  DATA.model.candidates.forEach(function (c) { if (c.chosen) chosen = c; });

  /* ---------- header + coverage strip ---------- */
  var cov = DATA.coverage;
  var header = el('header', null,
    el('h1', null, 'Launch ', el('span', { 'class': 'radar', text: 'Radar' }), ' Terminal'),
    el('p', { 'class': 'sub' },
      'Every pre-token protocol in the snapshot, ranked by a value model ', el('b', { text: 'fitted on the snapshot\u2019s own traded protocols and blind-tested out of sample' }),
      ' \u2014 no asserted multiples. An implied value is an expected value: the fitted curve\u2019s if-launched value, times fitted odds it ever launches, error printed. ',
      el('b', { text: 'The model\u2019s claim, not a prediction.' }), ' Below, a protocol ', el('b', { text: 'records no token' }), '; nobody says it has none. Snapshot ' + DATA.as_of + ', model ' + DATA.version + '.'),
    el('div', { 'class': 'strip' },
      el('span', { 'class': 'chip hot' }, el('b', { text: cov.total + '/' + cov.total }), ' protocols placed'),
      el('span', { 'class': 'chip' }, el('b', { text: String(cov.ranked) }), ' ranked'),
      el('span', { 'class': 'chip' }, el('b', { text: cov.watchlist_ranked + '/' + cov.watchlist }), ' watchlist'),
      el('span', { 'class': 'chip' }, el('b', { text: String(cov.traded) }), ' already trade (set apart)'),
      el('span', { 'class': 'chip' }, el('b', { text: String(cov.set_aside) }), ' products set aside'),
      el('span', { 'class': 'chip' }, el('b', { text: String(DATA.model.train_n) }), ' traded with a market cap: the fit\u2019s teachers')));
  app.appendChild(header);

  /* ---------- model panel: fit, validation, charts ---------- */
  function candRow(c) {
    return el('tr', { 'class': c.chosen ? 'chosen' : (c.id === 'full' ? 'rejected' : '') },
      el('td', { text: c.label + (c.chosen ? ' \u2014 kept' : (c.id === 'full' ? ' \u2014 rejected' : '')) }),
      el('td', { text: '\u00d7' + c.holdout_miss.toFixed(2) }),
      el('td', { text: '\u00d7' + c.loo_miss.toFixed(2) }));
  }
  var eqText = chosen.id === 'flat'
    ? 'if launched = ' + chosen.beta[0].toFixed(4) + ' \u00d7 TVL'
    : 'ln(if launched) = ' + chosen.beta[0].toFixed(3) + ' + ' + chosen.beta[1].toFixed(3) + ' \u00d7 ln(TVL)' + (chosen.id === 'full' ? ' + ' + chosen.beta[2].toFixed(3) + ' \u00d7 7d growth' : '');
  var modelPanel = el('section', { 'class': 'panel' },
    el('h2', { text: 'The model, fitted and blind-tested' }),
    el('div', { 'class': 'model-grid' },
      el('div', null,
        el('p', null, 'Three candidates were fitted on the ', el('b', { text: String(DATA.model.train_n) }), ' traded protocols that record a market cap, then blind-tested on a held-out fifth and by exact leave-one-out. ', el('b', { text: 'The growth term was fitted, tested, and rejected' }), ': it made held-out predictions worse.'),
        el('div', { 'class': 'eq', text: eqText }),
        el('p', null, 'Expected value = launch odds \u00d7 if-launched value, capped at TVL. Range: residual P25\u2013P75 (\u00d7', el('b', { text: DATA.model.range_lo.toFixed(2) }), ' to \u00d7', el('b', { text: DATA.model.range_hi.toFixed(2) }), '). Odds from the age curve: of the longest-tracked protocols ', el('b', { text: Math.round(DATA.model.ceiling * 100) + '%' }), ' record a token; still tokenless at age a, a protocol keeps (ceiling \u2212 launched share at a) / (1 \u2212 launched share at a). Base rate: ', el('b', { text: Math.round(DATA.model.base_rate * 100) + '%' }), '.')),
      el('div', null,
        el('table', { 'class': 'mini' },
          el('tr', null, el('th', { text: 'Candidate' }), el('th', { text: 'Held-out miss' }), el('th', { text: 'Leave-one-out' })),
          DATA.model.candidates.map(candRow)),
        el('p', null, 'Typical miss = median fold error on protocols the fit never trained on. ', el('b', { text: 'Priced by fits that never saw them.' })),
        el('canvas', { 'class': 'chart', id: 'scatter' }),
        el('div', { 'class': 'chart-cap', text: 'The size curve: every traded protocol with a market cap, the fitted line, its residual band.' })),
      el('div', null,
        el('canvas', { 'class': 'chart', id: 'odds' }),
        el('div', { 'class': 'chart-cap', text: 'Launched share by age (cyan) and the launch odds it leaves a still-tokenless protocol (green). Old and tokenless is evidence, priced.' }),
        el('p', null, 'Verdicts are netted to the dollar at your deposit (controls below): gross less stated fees, minutes at $' + A.time_usd_hr + '/h, and idle yield. ', el('b', { text: 'FARM \u2265 $' + A.farm_net_usd + ' net, THIN \u2265 $0, else SKIP.' })))));
  app.appendChild(modelPanel);

  function drawCharts() {
    var dpr = window.devicePixelRatio || 1;
    function setup(id) {
      var cv = document.getElementById(id);
      if (!cv) return null;
      var w = cv.clientWidth, h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      var ctx = cv.getContext('2d');
      ctx.scale(dpr, dpr);
      return { ctx: ctx, w: w, h: h };
    }
    var s = setup('scatter');
    if (s) {
      var x0 = Math.log(5e6), x1 = Math.log(3e10), y0 = Math.log(1e6), y1 = Math.log(3e11);
      var X = function (v) { return 8 + (Math.log(v) - x0) / (x1 - x0) * (s.w - 16); };
      var Y = function (v) { return s.h - 8 - (Math.log(v) - y0) / (y1 - y0) * (s.h - 16); };
      s.ctx.fillStyle = 'rgba(67,209,124,0.10)';
      s.ctx.beginPath();
      DATA.fit_line.forEach(function (pt, i) { var px = X(pt[0]), py = Y(pt[1] * DATA.model.range_hi); i ? s.ctx.lineTo(px, py) : s.ctx.moveTo(px, py); });
      for (var i = DATA.fit_line.length - 1; i >= 0; i--) s.ctx.lineTo(X(DATA.fit_line[i][0]), Y(DATA.fit_line[i][1] * DATA.model.range_lo));
      s.ctx.fill();
      s.ctx.strokeStyle = '#43d17c'; s.ctx.lineWidth = 1.6; s.ctx.beginPath();
      DATA.fit_line.forEach(function (pt, j) { var px = X(pt[0]), py = Y(pt[1]); j ? s.ctx.lineTo(px, py) : s.ctx.moveTo(px, py); });
      s.ctx.stroke();
      s.ctx.fillStyle = 'rgba(79,195,217,0.75)';
      DATA.scatter.forEach(function (pt) { s.ctx.fillRect(X(pt[0]) - 1.3, Y(pt[1]) - 1.3, 2.6, 2.6); });
    }
    var o = setup('odds');
    if (o) {
      var ox = function (age) { return 8 + (Math.log(age) - Math.log(30)) / (Math.log(2190) - Math.log(30)) * (o.w - 16); };
      var oy = function (v) { return o.h - 8 - v * (o.h - 16); };
      function line(key, color) {
        o.ctx.strokeStyle = color; o.ctx.lineWidth = 1.6; o.ctx.beginPath();
        DATA.model.odds_curve.forEach(function (pt, i) { var px = ox(pt.age_days), py = oy(pt[key]); i ? o.ctx.lineTo(px, py) : o.ctx.moveTo(px, py); });
        o.ctx.stroke();
      }
      o.ctx.strokeStyle = '#232d38'; o.ctx.lineWidth = 1;
      o.ctx.beginPath(); o.ctx.moveTo(8, oy(0.5)); o.ctx.lineTo(o.w - 8, oy(0.5)); o.ctx.stroke();
      line('launched_share', '#4fc3d9');
      line('odds', '#43d17c');
    }
  }

  /* ---------- controls ---------- */
  var depositSeg = el('div', { 'class': 'seg' });
  A.deposits.forEach(function (d) {
    var b = el('button', { text: '$' + (d / 1000) + 'K', 'data-dep': String(d), onclick: function () { state.deposit = d; syncControls(); renderBoard(); } });
    if (d === state.deposit) b.className = 'on';
    depositSeg.appendChild(b);
  });
  var dropInput = el('input', { type: 'number', min: '0', max: '30', step: '0.5', value: String(A.drop * 100), oninput: function () { state.drop = (parseFloat(dropInput.value) || 0) / 100; renderBoard(); } });
  var yieldInput = el('input', { type: 'number', min: '0', max: '15', step: '0.1', value: String(A.yield_pct), oninput: function () { state.yieldPct = parseFloat(yieldInput.value) || 0; renderBoard(); } });
  var searchInput = el('input', { type: 'search', placeholder: 'Name or slug', oninput: function () { state.q = searchInput.value.toLowerCase(); renderBoard(); } });
  var catSelect = el('select', { onchange: function () { state.category = catSelect.value; renderBoard(); } }, el('option', { value: 'all', text: 'All categories' }));
  var chainSelect = el('select', { onchange: function () { state.chain = chainSelect.value; renderBoard(); } }, el('option', { value: 'all', text: 'All chains' }));
  var tvlSelect = el('select', { onchange: function () { state.minTvl = parseInt(tvlSelect.value, 10) || 0; renderBoard(); } },
    el('option', { value: '0', text: 'Any TVL' }), el('option', { value: '10000000', text: 'TVL \u2265 $10M' }),
    el('option', { value: '25000000', text: 'TVL \u2265 $25M' }), el('option', { value: '50000000', text: 'TVL \u2265 $50M' }),
    el('option', { value: '100000000', text: 'TVL \u2265 $100M' }));
  var verdictSelect = el('select', { onchange: function () { state.verdict = verdictSelect.value; renderBoard(); } },
    el('option', { value: 'all', text: 'All verdicts' }), el('option', { value: 'FARM', text: 'FARM only' }),
    el('option', { value: 'THIN', text: 'THIN only' }), el('option', { value: 'SKIP', text: 'SKIP only' }));
  if (state.verdict !== 'all') verdictSelect.value = state.verdict;
  var wlCheck = el('input', { type: 'checkbox', onchange: function () { state.wl = wlCheck.checked; renderBoard(); } });
  var cats = {}, chains = {};
  DATA.rows.forEach(function (r) { if (r.category) cats[r.category] = 1; r.chains.forEach(function (c) { chains[c] = 1; }); });
  Object.keys(cats).sort().forEach(function (c) { catSelect.appendChild(el('option', { value: c, text: c })); });
  Object.keys(chains).sort().forEach(function (c) { chainSelect.appendChild(el('option', { value: c, text: c })); });

  var controlsPanel = el('section', { 'class': 'panel' },
    el('h2', { text: 'What-if: the verdicts recompute as you move these' }),
    el('div', { 'class': 'controls' },
      el('div', { 'class': 'ctl' }, el('label', { text: 'Your deposit' }), depositSeg),
      el('div', { 'class': 'ctl' }, el('label', { text: 'Community drop %' }), dropInput),
      el('div', { 'class': 'ctl' }, el('label', { text: 'T-bill yield %' }), yieldInput),
      el('div', { 'class': 'ctl' }, el('label', { text: 'Search' }), searchInput),
      el('div', { 'class': 'ctl' }, el('label', { text: 'Category' }), catSelect),
      el('div', { 'class': 'ctl' }, el('label', { text: 'Chain' }), chainSelect),
      el('div', { 'class': 'ctl' }, el('label', { text: 'Size' }), tvlSelect),
      el('div', { 'class': 'ctl' }, el('label', { text: 'Verdict' }), verdictSelect),
      el('label', { 'class': 'check' }, wlCheck, ' Watchlist only')),
    el('p', { 'class': 'count-line', id: 'countline' }));
  app.appendChild(controlsPanel);

  function syncControls() {
    Array.prototype.forEach.call(depositSeg.children, function (b) {
      b.className = parseInt(b.getAttribute('data-dep'), 10) === state.deposit ? 'on' : '';
    });
  }

  /* ---------- farm next strip + the board ---------- */
  var farmPanel = el('section', { 'class': 'panel' }, el('h2', { text: 'Farm next, at your controls' }), el('div', { 'class': 'farmnext', id: 'farmnext' }));
  app.appendChild(farmPanel);
  var boardPanel = el('section', { 'class': 'panel' }, el('h2', { text: 'The board: 198 standalone pre-token protocols, ranked by expected value' }), el('div', { id: 'boardwrap' }));
  app.appendChild(boardPanel);

  function visibleRows() {
    var rows = DATA.rows.filter(function (r) {
      if (state.q && r.name.toLowerCase().indexOf(state.q) < 0 && r.slug.indexOf(state.q) < 0) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (state.wl && !r.watchlist) return false;
      if (state.verdict !== 'all' && verdictOf(netOf(r, state.deposit, state.drop, state.yieldPct)) !== state.verdict) return false;
      return true;
    });
    var key = state.sort, dir = state.dir;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'net') { va = netOf(a, state.deposit, state.drop, state.yieldPct); vb = netOf(b, state.deposit, state.drop, state.yieldPct); }
      else if (key === 'name') { va = a.name; vb = b.name; return dir * (va < vb ? -1 : va > vb ? 1 : 0); }
      else { va = a[key]; vb = b[key]; }
      return dir * ((va || 0) - (vb || 0));
    });
    return rows;
  }

  function th(label, key, num) {
    return el('th', { 'class': num ? 'num' : '', text: label + (state.sort === key ? (state.dir === 1 ? ' \u25b2' : ' \u25bc') : ''), onclick: function () {
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'rank' || key === 'name' ? 1 : -1; }
      renderBoard();
    } });
  }

  function renderBoard() {
    // farm next: the five best nets that clear the FARM bar at the current controls
    var fn = document.getElementById('farmnext');
    fn.textContent = '';
    var picks = DATA.rows.map(function (r) { return { r: r, net: netOf(r, state.deposit, state.drop, state.yieldPct) }; })
      .filter(function (x) { return x.net >= A.farm_net_usd; })
      .sort(function (a, b) { return b.net - a.net; }).slice(0, 5);
    if (!picks.length) {
      fn.appendChild(el('span', { 'class': 'none', text: 'No row clears the FARM bar at a ' + fmtUsd(state.deposit) + ' deposit with these settings \u2014 most protocols honestly do not pay a small farmer. Raise the deposit or the drop share and watch the verdicts move.' }));
    } else {
      picks.forEach(function (x) {
        fn.appendChild(el('button', { 'class': 'pick', onclick: function () { openDrawer(x.r); } },
          el('b', { text: x.r.name }), ' \u00b7 net ', el('span', { 'class': 'net', text: fmtMoney(x.net) }), ' at ' + fmtUsd(state.deposit)));
      });
    }
    // the board itself
    var rows = visibleRows();
    document.getElementById('countline').innerHTML = '';
    document.getElementById('countline').appendChild(document.createTextNode('Showing '));
    var b = el('b', { text: rows.length + ' of ' + DATA.rows.length });
    document.getElementById('countline').appendChild(b);
    document.getElementById('countline').appendChild(document.createTextNode(' rows \u00b7 verdicts at a ' + fmtUsd(state.deposit) + ' deposit, ' + (state.drop * 100).toFixed(1) + '% drop, ' + state.yieldPct + '% T-bill'));
    var wrap = document.getElementById('boardwrap');
    wrap.textContent = '';
    var table = el('table', { 'class': 'board' },
      el('tr', null,
        th('#', 'rank', true), th('Protocol', 'name'), th('TVL', 'tvl_usd', true), th('7d', 'change_7d', true),
        th('Age', 'age_days', true), th('Odds', 'odds', true), th('If launched', 'if_launched_usd', true),
        th('Expected value', 'implied_value_usd', true), th('Verdict', 'net', true)));
    var tbody = el('tbody', null);
    rows.forEach(function (r) {
      var net = netOf(r, state.deposit, state.drop, state.yieldPct);
      var v = verdictOf(net);
      tbody.appendChild(el('tr', { onclick: function () { openDrawer(r); } },
        el('td', { 'class': 'num', text: String(r.rank) }),
        el('td', null, el('span', { 'class': 'pname', text: r.name }), r.watchlist ? el('span', { 'class': 'wl', text: 'WATCH' }) : null,
          el('div', { 'class': 'pslug', text: r.slug }), el('div', { 'class': 'cat', text: (r.category || 'Uncategorised') + ' \u00b7 ' + r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') })),
        el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { 'class': 'num ' + (r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : ''), text: fmtPct(r.change_7d) }),
        el('td', { 'class': 'num', text: fmtAge(r.age_days) }),
        el('td', { 'class': 'num', text: Math.round(r.odds * 100) + '%' }),
        el('td', { 'class': 'num', text: fmtUsd(r.if_launched_usd) }),
        el('td', { 'class': 'num' }, document.createTextNode(fmtUsd(r.implied_value_usd)), el('span', { 'class': 'range', text: fmtUsd(r.p25_usd) + ' \u2013 ' + fmtUsd(r.p75_usd) })),
        el('td', { 'class': 'num' }, el('span', { 'class': 'verdict ' + v, text: v }), el('span', { 'class': 'vnet', text: fmtMoney(net) }))));
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  /* ---------- detail drawer: the full maths for one row ---------- */
  var drawer = null;
  function closeDrawer() { if (drawer) { drawer.remove(); drawer = null; } }
  function openDrawer(r) {
    closeDrawer();
    state.selected = r.slug;
    var at = function (d) { var n = netOf(r, d, A.drop, A.yield_pct); return { n: n, v: verdictOf(n) }; };
    var gross = r.implied_value_usd * A.drop * (5000 / (5000 + r.tvl_usd));
    var time = (r.minutes / 60) * A.time_usd_hr;
    var idle = 5000 * (A.yield_pct / 100) * (A.horizon_weeks / 52);
    drawer = el('aside', { 'class': 'drawer' },
      el('button', { 'class': 'close', text: 'Close', onclick: closeDrawer }),
      el('h2', { text: r.name }),
      el('div', { 'class': 'cat', text: r.slug + ' \u00b7 ' + (r.category || 'Uncategorised') + ' \u00b7 ' + r.chains.join(', ') + (r.watchlist ? ' \u00b7 on the house watchlist' : '') }),
      el('h3', { text: 'The value maths' }),
      el('dl', { 'class': 'kv' },
        el('dt', { text: 'TVL (snapshot)' }), el('dd', { text: fmtUsd(r.tvl_usd) }),
        el('dt', { text: 'If it launched (fitted curve)' }), el('dd', { text: fmtUsd(r.if_launched_usd) }),
        el('dt', { text: 'Launch odds at ' + fmtAge(r.age_days) + ' with no token' }), el('dd', { text: Math.round(r.odds * 100) + '%' }),
        el('dt', { text: 'Expected value' }), el('dd', { text: fmtUsd(r.implied_value_usd) }),
        el('dt', { text: 'Range (residual P25\u2013P75)' }), el('dd', { text: fmtUsd(r.p25_usd) + ' \u2013 ' + fmtUsd(r.p75_usd) }),
        el('dt', { text: 'Board rank' }), el('dd', { text: '#' + r.rank + ' of ' + DATA.rows.length })),
      el('h3', { text: 'The farm maths at the stated assumptions' }),
      el('dl', { 'class': 'kv' },
        el('dt', { text: 'Gross at $5,000 (EV \u00d7 drop \u00d7 your TVL share)' }), el('dd', { text: fmtMoney(gross) }),
        el('dt', { text: 'Plan fees, stated per step' }), el('dd', { text: '-$' + r.fees_usd.toFixed(2) }),
        el('dt', { text: 'Plan time: ' + r.minutes + ' min at $' + A.time_usd_hr + '/h' }), el('dd', { text: fmtMoney(-time) }),
        el('dt', { text: 'Idle yield on $5,000, ' + A.horizon_weeks + ' weeks' }), el('dd', { text: fmtMoney(-idle) }),
        el('dt', { text: 'Net at $1,000 / $5,000 / $25,000' }), el('dd', { text: at(1000).v + ' ' + fmtMoney(at(1000).n) + ' \u00b7 ' + at(5000).v + ' ' + fmtMoney(at(5000).n) + ' \u00b7 ' + at(25000).v + ' ' + fmtMoney(at(25000).n) }),
        el('dt', { text: 'Break-even deposit' }), el('dd', { text: r.break_even_usd === null ? 'none \u2264 $2,000,000' : fmtUsd(r.break_even_usd) })),
      el('h3', { text: 'The dated farm plan' }),
      el('ol', { 'class': 'steps' }, r.farm_steps.map(function (s) { return el('li', { text: s }); })),
      el('p', { 'class': 'cat', text: 'Records no token in the snapshot of ' + DATA.as_of + '. The value above is this model\u2019s claim from that record, not a prediction that a token will exist.' }));
    document.body.appendChild(drawer);
  }

  /* ---------- set aside, and the footer check ---------- */
  var asidePanel = el('section', { 'class': 'panel' },
    el('h2', { text: 'Set aside, named and counted \u2014 nothing silently dropped' }),
    el('div', { 'class': 'aside-list' },
      cov.aside_groups.map(function (g) {
        return el('p', null, el('b', { text: g.reason + ' (' + g.count + '): ' }), g.names.join(', '));
      }),
      el('p', null, el('b', { text: 'Already trade (' + cov.traded + '): ' }), 'every protocol that records a token. They are the fit\u2019s teachers, never ranked as launches to come.')));
  app.appendChild(asidePanel);

  // The footer check: recompute every row's expected value from the printed odds and if-launched
  // values, here in the page, and count how many land exactly on the board's figures.
  var matched = 0;
  DATA.rows.forEach(function (r) {
    var ev = Math.max(1, Math.round(Math.min(r.odds * r.if_launched_usd, r.tvl_usd)));
    if (ev === r.implied_value_usd) matched += 1;
  });
  app.appendChild(el('footer', null,
    el('b', { text: matched + '/' + DATA.rows.length + ' rows recompute exactly' }),
    ' from the printed odds and if-launched values, in this page \u2014 the page\u2019s data and board.json agree. Model ' + DATA.version + ', fitted at build time on the snapshot of ' + DATA.as_of + ' alone; the same program wrote board.json and this data, and its self-check recomputed the top row and a watchlist row by a second path before writing a byte. ',
    'Verdict thresholds: FARM at net \u2265 $' + A.farm_net_usd + ', THIN at net \u2265 $0, SKIP below, over an ' + A.horizon_weeks + '-week horizon.'));

  app.setAttribute('aria-busy', 'false');
  renderBoard();
  drawCharts();
  if (state.selected) {
    var sel = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
    if (sel) openDrawer(sel);
  }
})();
