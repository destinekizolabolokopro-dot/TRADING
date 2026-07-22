/*
 * TRADEassist — Orchestration & interface
 * =======================================
 * Récupère les données (Binance / Twelve Data), lance le moteur ICT, et pilote
 * l'interface : statistiques, filtres, cartes, graphique en modale, calculateur
 * de risque, alertes (son + notification) et thème clair/sombre.
 */
(function () {
  'use strict';

  var STORAGE = 'tradeassist.settings';
  var HISTORY_KEY = 'tradeassist.history';
  var TICK_MS = 20000;
  var MIN_AGE_CRYPTO = 40000;
  var MIN_AGE_SLOW = 240000;
  var MIN_AGE_DAILY = 1800000; // 30 min — la veille change peu

  // Registre des stratégies (extensible : il suffit d'ajouter une entrée + son eval dans ict.js).
  var STRATS = [
    { id: 'ote', name: 'Retracement OTE', sub: 'Zone OTE du Fibonacci + PD Array en discount/premium + CRT.', tag: 'ICT' },
    { id: 'daily', name: 'Previous Daily', sub: 'Balayage du plus-haut/plus-bas de la veille (PDH/PDL) puis retour.', tag: 'Daily' },
    { id: 'scalp', name: 'Scalping (M1)', sub: 'Tendance sur M5, retour sur une zone clé, confirmation sur M1, objectif ≥ 2R. Ne se déclenche QUE pendant les sessions de Londres et de New York.', tag: 'Scalp' },
    { id: 'smc', name: 'Smart Money (SMC)', sub: 'Tendance sur unité supérieure → retour sur une zone d’offre/demande → confirmation BOS/CHoCH ou rejet → objectif sur la prochaine liquidité (ratio > 1:2).', tag: 'SMC' }
  ];

  var state = {
    symbols: API.DEFAULT_SYMBOLS.slice(),
    timeframe: '15m',
    cache: {},
    daily: {},
    m1cache: {},
    history: [],
    lastUpdate: null,
    prevSignals: null,
    filters: { dir: 'all', market: 'all', strat: 'all', sort: 'conf' },
    strategies: { ote: true, daily: true, scalp: true, smc: true },
    theme: 'light',
    alerts: false,
    risk: { balance: 1000, pct: 1 },
    view: 'signaux',
    timer: null
  };

  // --- Persistance ------------------------------------------------------------
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORAGE));
      if (s) {
        if (Array.isArray(s.symbols) && s.symbols.length) {
          var f = s.symbols.filter(function (x) { return API.SYMBOLS[x]; });
          if (f.length) state.symbols = f;
        }
        if (s.timeframe) state.timeframe = s.timeframe;
        if (s.filters) state.filters = Object.assign(state.filters, s.filters);
        if (s.strategies) state.strategies = Object.assign(state.strategies, s.strategies);
        if (s.theme) state.theme = s.theme;
        if (typeof s.alerts === 'boolean') state.alerts = s.alerts;
        if (s.risk) state.risk = Object.assign(state.risk, s.risk);
      }
    } catch (e) { /* ignore */ }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify({
        symbols: state.symbols, timeframe: state.timeframe, filters: state.filters,
        strategies: state.strategies, theme: state.theme, alerts: state.alerts, risk: state.risk
      }));
    } catch (e) { /* ignore */ }
  }
  function loadHistory() { try { state.history = JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch (e) { state.history = []; } }
  function saveHistory() { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(-500))); } catch (e) { /* ignore */ } }

  // --- Helpers ----------------------------------------------------------------
  var $ = function (s) { return document.querySelector(s); };
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function fmt(v, p) { if (v == null || isNaN(v)) return '—'; return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: p, maximumFractionDigits: p }); }
  function minAge(sym) { var m = API.meta(sym); return (m && m.kind === 'crypto') ? MIN_AGE_CRYPTO : MIN_AGE_SLOW; }
  function zoneLabel(z) { return z === 'discount' ? 'Discount' : (z === 'premium' ? 'Premium' : 'Equilibrium'); }

  function positionSize(trade) {
    if (!trade) return null;
    var perUnit = Math.abs(trade.entry - trade.sl);
    if (!(perUnit > 0)) return null;
    var riskAmount = state.risk.balance * (state.risk.pct / 100);
    var units = riskAmount / perUnit;
    return { units: units, riskAmount: riskAmount, notional: units * trade.entry };
  }

  // --- Données ----------------------------------------------------------------
  // Plus-haut/plus-bas de la veille (mis en cache longtemps).
  function ensureDaily(sym) {
    var d = state.daily[sym];
    if (d && (Date.now() - d.ts) < MIN_AGE_DAILY) return Promise.resolve(d.data);
    return API.fetchDaily(sym).then(function (data) {
      state.daily[sym] = { ts: Date.now(), data: data }; return data;
    }).catch(function () { return (d && d.data) || null; });
  }

  // Bougies M1 pour le scalping (récupérées seulement si la stratégie est active).
  function ensureM1(sym) {
    if (state.strategies.scalp === false) return Promise.resolve(null);
    var c = state.m1cache[sym];
    if (c && (Date.now() - c.ts) < minAge(sym)) return Promise.resolve(c.data);
    return API.fetchCandles(sym, '1m', 400).then(function (d) {
      state.m1cache[sym] = { ts: Date.now(), data: d }; return d;
    }).catch(function () { return (c && c.data) || null; });
  }

  function ensureSymbol(sym) {
    var now = Date.now();
    var c = state.cache[sym];
    if (c && (now - c.ts) < minAge(sym)) return Promise.resolve(c.result);
    return Promise.all([ensureDaily(sym), ensureM1(sym)]).then(function (arr) {
      var daily = arr[0], m1 = arr[1];
      return API.fetchCandles(sym, state.timeframe, 200).then(function (candles) {
        var opts = { strategies: state.strategies };
        if (daily) { opts.pdh = daily.pdh; opts.pdl = daily.pdl; }
        if (m1) opts.m1 = m1;
        var r = ICT.analyze(sym, state.timeframe, candles, opts);
        r.label = API.label(sym); r.kind = (API.meta(sym) || {}).kind;
        state.cache[sym] = { ts: Date.now(), result: r };
        return r;
      });
    })
      .catch(function (err) {
        var m = API.meta(sym);
        var r = { symbol: sym, label: API.label(sym), timeframe: state.timeframe, hasSignal: false, kind: m && m.kind };
        if (err && err.message === 'NO_API_KEY') { r.needKey = true; r.reason = 'Ajoute ta clé API gratuite (plus haut) pour activer le forex/or.'; }
        else r.error = (err && err.message) || 'Erreur réseau';
        state.cache[sym] = { ts: Date.now(), result: r };
        return r;
      });
  }

  function refresh(force) {
    if (force) state.cache = {};
    setStatus('Analyse en cours…', true);
    var jobs = state.symbols.map(function (sym) { return ensureSymbol(sym).then(function () { renderAll(); }); });
    return Promise.all(jobs).then(function () {
      state.lastUpdate = new Date();
      updateHistory();
      renderAll();
      checkAlerts();
      if (state.view === 'historique') renderHistory();
      setStatus('En direct', false);
    });
  }

  // --- Historique des trades & bilan -----------------------------------------
  function updateHistory() {
    var all = results();
    // 1) archiver les nouveaux signaux (un seul trade « ouvert » par paire+stratégie+sens)
    all.forEach(function (r) {
      if (!r.hasSignal) return;
      var exists = state.history.some(function (h) {
        return h.status === 'open' && h.symbol === r.symbol && h.strategy === r.strategy && h.direction === r.trade.direction;
      });
      if (exists) return;
      var t = r.trade;
      state.history.push({
        id: Date.now() + '-' + r.symbol, ts: Date.now(), symbol: r.symbol, label: r.label,
        strategy: r.strategy, strategyLabel: r.strategyLabel, direction: t.direction, timeframe: r.timeframe,
        precision: r.precision, entry: t.entry, sl: t.sl, tp1: t.tp1, status: 'open', result: null, r: null
      });
    });
    // 2) clôturer les trades ouverts selon le prix courant
    state.history.forEach(function (h) {
      if (h.status !== 'open') return;
      var res = state.cache[h.symbol] && state.cache[h.symbol].result;
      if (!res || res.price == null) return;
      var p = res.price, hit = null;
      if (h.direction === 'LONG') { if (p <= h.sl) hit = 'loss'; else if (p >= h.tp1) hit = 'win'; }
      else { if (p >= h.sl) hit = 'loss'; else if (p <= h.tp1) hit = 'win'; }
      if (hit) {
        h.status = 'closed'; h.result = hit; h.closedTs = Date.now();
        var risk = Math.abs(h.entry - h.sl), rew = Math.abs(h.tp1 - h.entry);
        h.r = hit === 'win' ? (risk > 0 ? rew / risk : 0) : -1;
      }
    });
    saveHistory();
  }

  function computeBilan() {
    var closed = state.history.filter(function (h) { return h.status === 'closed'; });
    var wins = closed.filter(function (h) { return h.result === 'win'; }).length;
    var loss = closed.length - wins;
    var open = state.history.filter(function (h) { return h.status === 'open'; }).length;
    var rate = closed.length ? Math.round(wins / closed.length * 100) : null;
    var rsum = closed.reduce(function (s, h) { return s + (h.r || 0); }, 0);
    return { total: state.history.length, wins: wins, loss: loss, open: open, rate: rate, rsum: rsum };
  }

  function renderHistory() {
    var b = computeBilan();
    $('#b-total').textContent = b.total;
    $('#b-win').textContent = b.wins;
    $('#b-loss').textContent = b.loss;
    $('#b-open').textContent = b.open;
    $('#b-rate').textContent = b.rate != null ? b.rate + '%' : '—';
    var rEl = $('#b-r'); rEl.textContent = (b.rsum >= 0 ? '+' : '') + fmt(b.rsum, 2) + ' R';
    rEl.className = 'bilan-val ' + (b.rsum > 0 ? 'pos' : (b.rsum < 0 ? 'neg' : ''));

    $('#count-history').textContent = state.history.length;
    var body = $('#history-body'); body.innerHTML = '';
    var rows = state.history.slice().reverse();
    $('#history-empty').style.display = rows.length ? 'none' : '';
    $('#history-table').style.display = rows.length ? '' : 'none';
    rows.forEach(function (h) {
      var tr = document.createElement('tr');
      function td(txt, cls) { var d = document.createElement('td'); if (cls) d.className = cls; d.textContent = txt; return d; }
      var d = new Date(h.ts);
      tr.appendChild(td(d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })));
      tr.appendChild(td(h.label || h.symbol));
      tr.appendChild(td(h.strategyLabel || h.strategy));
      var sens = document.createElement('td'); sens.appendChild(el('span', 'mini-badge ' + (h.direction === 'LONG' ? 'badge-long' : 'badge-short'), h.direction === 'LONG' ? 'Achat' : 'Vente')); tr.appendChild(sens);
      tr.appendChild(td(fmt(h.entry, h.precision), 'num'));
      tr.appendChild(td(fmt(h.sl, h.precision), 'num'));
      tr.appendChild(td(fmt(h.tp1, h.precision), 'num'));
      var rc = document.createElement('td');
      var lbl = h.status === 'open' ? 'En cours' : (h.result === 'win' ? 'Gagné' : 'Perdu');
      var cls = h.status === 'open' ? 'res-open' : (h.result === 'win' ? 'res-win' : 'res-loss');
      rc.appendChild(el('span', 'res ' + cls, lbl + (h.status === 'closed' ? ' · ' + (h.r >= 0 ? '+' : '') + fmt(h.r, 1) + 'R' : '')));
      tr.appendChild(rc);
      body.appendChild(tr);
    });
  }

  function results() { return state.symbols.map(function (s) { return state.cache[s] && state.cache[s].result; }).filter(Boolean); }

  // --- Alertes ----------------------------------------------------------------
  function beep() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = state._audio || (state._audio = new AC());
      if (ctx.state === 'suspended') ctx.resume();
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.36);
    } catch (e) { /* ignore */ }
  }
  function toast(msg, kind) {
    var t = el('div', 'toast ' + (kind || ''), msg);
    $('#toasts').appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 5200);
  }
  function checkAlerts() {
    var cur = {};
    results().forEach(function (r) { if (r.hasSignal) cur[r.symbol + ':' + r.trade.direction] = r; });
    if (state.prevSignals === null) { state.prevSignals = cur; return; } // pas d'alerte au 1er chargement
    if (state.alerts) {
      Object.keys(cur).forEach(function (k) {
        if (!state.prevSignals[k]) {
          var r = cur[k];
          var msg = '🔔 ' + r.label + ' — ' + (r.trade.direction === 'LONG' ? 'ACHAT' : 'VENTE') + ' (confiance ' + r.confidence + '%)';
          toast(msg, r.trade.direction === 'LONG' ? 'long' : 'short');
          beep();
          if (window.Notification && Notification.permission === 'granted') {
            try { new Notification('TRADEassist — nouveau setup', { body: msg }); } catch (e) {}
          }
        }
      });
    }
    state.prevSignals = cur;
  }

  // --- Sparkline --------------------------------------------------------------
  function sparkline(canvas, candles, up) {
    if (!canvas || !candles || candles.length < 2) return;
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 180, h = canvas.clientHeight || 34;
    canvas.width = w * dpr; canvas.height = h * dpr;
    var ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var data = candles.slice(-48).map(function (c) { return c.close; });
    var lo = Math.min.apply(null, data), hi = Math.max.apply(null, data);
    var span = (hi - lo) || 1;
    function x(i) { return (i / (data.length - 1)) * (w - 2) + 1; }
    function y(v) { return h - 3 - ((v - lo) / span) * (h - 6); }
    var color = up ? '#4ade80' : '#f87171';
    ctx.beginPath();
    data.forEach(function (v, i) { var xx = x(i), yy = y(v); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
    ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.lineTo(x(data.length - 1), h); ctx.lineTo(x(0), h); ctx.closePath();
    ctx.fillStyle = up ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)'; ctx.fill();
  }

  function pctChange(r) {
    if (!r.chart || !r.chart.candles) return null;
    var cs = r.chart.candles, from = r.chart.view.from;
    var base = cs[from] ? cs[from].close : cs[0].close;
    if (!base) return null;
    return (r.price - base) / base * 100;
  }

  // Ligne d'un niveau (Entrée / SL / TP) avec distance en % et montant en $.
  function levelRow(label, val, cls, kind, t, p, ps) {
    var row = el('div', 'level ' + cls);
    row.appendChild(el('span', 'level-lbl', label));
    var right = el('div', 'level-right');
    right.appendChild(el('span', 'level-val', fmt(val, p)));
    if (kind !== 'entry' && t.entry) {
      var pct = (val - t.entry) / t.entry * 100;
      var amt = ps ? ps.units * Math.abs(val - t.entry) : null;
      var sign = kind === 'sl' ? '−' : '+';
      var txt = sign + fmt(Math.abs(pct), 2) + '%' + (amt != null ? ' · ' + sign + fmt(amt, 2) + ' $' : '');
      right.appendChild(el('span', 'level-sub ' + (kind === 'sl' ? 'neg' : 'pos'), txt));
    }
    row.appendChild(right);
    return row;
  }
  function planCell(label, val, cls) {
    var b = el('div', 'plan-cell');
    b.appendChild(el('span', 'pc-l', label));
    b.appendChild(el('span', 'pc-v ' + (cls || ''), val));
    return b;
  }

  // --- Cartes -----------------------------------------------------------------
  function signalCard(r) {
    var t = r.trade, p = r.precision;
    var card = el('article', 'card signal ' + (t.direction === 'LONG' ? 'is-long' : 'is-short'));
    card.addEventListener('click', function () { openDetail(r.symbol); });

    var head = el('div', 'card-head');
    var left = el('div', 'card-head-left');
    left.appendChild(el('h3', 'sym', r.label || r.symbol));
    left.appendChild(el('span', 'tf', r.timeframe));
    head.appendChild(left);
    head.appendChild(el('span', 'badge ' + (t.direction === 'LONG' ? 'badge-long' : 'badge-short'), t.direction === 'LONG' ? 'ACHAT' : 'VENTE'));
    card.appendChild(head);

    if (r.strategyLabel) card.appendChild(el('div', 'strat-tag strat-' + r.strategy, r.strategyLabel));

    var meta = el('div', 'meta-row');
    meta.appendChild(el('span', 'pill pill-' + r.zone, zoneLabel(r.zone)));
    meta.appendChild(el('span', 'pill', 'Fib ' + fmt(r.fibPos, 2)));
    meta.appendChild(el('span', 'pill pill-conf', 'Confiance ' + r.confidence + '%'));
    card.appendChild(meta);

    // barre de confiance
    var bar = el('div', 'conf-bar'); var fill = el('div', 'conf-fill ' + (t.direction === 'LONG' ? 'long' : 'short')); fill.style.width = r.confidence + '%'; bar.appendChild(fill);
    card.appendChild(bar);

    var ps = positionSize(t);
    var levels = el('div', 'levels');
    levels.appendChild(levelRow('Entrée', t.entry, 'lvl-entry', 'entry', t, p, ps));
    levels.appendChild(levelRow('Stop Loss', t.sl, 'lvl-sl', 'sl', t, p, ps));
    levels.appendChild(levelRow('TP1 · equilibrium', t.tp1, 'lvl-tp', 'tp', t, p, ps));
    levels.appendChild(levelRow('TP2 · liquidité', t.tp2, 'lvl-tp', 'tp', t, p, ps));
    levels.appendChild(levelRow('TP3 · extension', t.tp3, 'lvl-tp', 'tp', t, p, ps));
    var rr = el('div', 'level lvl-rr'); rr.appendChild(el('span', 'level-lbl', 'Risk : Reward')); rr.appendChild(el('span', 'level-val', '1 : ' + fmt(t.rr, 2)));
    levels.appendChild(rr);
    card.appendChild(levels);

    if (ps) {
      var reward2 = ps.units * Math.abs(t.tp2 - t.entry);
      var plan = el('div', 'plan-summary');
      var r1 = el('div', 'plan-row');
      r1.appendChild(planCell('Risque', '−' + fmt(ps.riskAmount, 2) + ' $', 'neg'));
      r1.appendChild(planCell('Gain visé · TP2', '+' + fmt(reward2, 2) + ' $', 'pos'));
      plan.appendChild(r1);
      plan.appendChild(el('div', 'plan-size', 'Taille ≈ ' + fmt(ps.units, ps.units > 100 ? 2 : 4) + ' unités · valeur ≈ ' + fmt(ps.notional, 0) + ' $'));
      card.appendChild(plan);
    }

    var foot = el('div', 'card-foot');
    var ctx = el('div', 'ctx-tags');
    if (r.trend && r.trend !== 'neutre') ctx.appendChild(el('span', 'ctx', 'Tendance ' + r.trend));
    if (r.structure) ctx.appendChild(el('span', 'ctx', r.structure));
    foot.appendChild(ctx);
    foot.appendChild(el('button', 'link-btn', 'Voir le graphique →'));
    card.appendChild(foot);
    return card;
  }

  function watchCard(r) {
    var card = el('article', 'card watch' + (r.needKey ? ' need-key' : ''));
    if (r.chart) card.addEventListener('click', function () { openDetail(r.symbol); });

    var head = el('div', 'card-head');
    var left = el('div', 'card-head-left');
    left.appendChild(el('h3', 'sym', r.label || r.symbol));
    left.appendChild(el('span', 'tf', r.timeframe));
    head.appendChild(left);
    if (r.price != null) {
      var ch = pctChange(r);
      var pr = el('div', 'watch-price');
      pr.appendChild(el('span', 'wp-val', fmt(r.price, r.precision || 2)));
      if (ch != null) pr.appendChild(el('span', 'wp-chg ' + (ch >= 0 ? 'up' : 'down'), (ch >= 0 ? '+' : '') + fmt(ch, 2) + '%'));
      head.appendChild(pr);
    }
    card.appendChild(head);

    if (r.error) { card.appendChild(el('p', 'watch-reason err', 'Erreur : ' + r.error)); return card; }

    if (r.chart) {
      var spk = el('canvas', 'spark'); card.appendChild(spk);
      // dessin différé (après insertion DOM pour avoir les dimensions)
      setTimeout(function () { sparkline(spk, r.chart.candles, pctChange(r) >= 0); }, 0);
    }

    var meta = el('div', 'meta-row');
    if (r.zone) meta.appendChild(el('span', 'pill pill-' + r.zone, zoneLabel(r.zone)));
    if (r.fibPos != null) meta.appendChild(el('span', 'pill', 'Fib ' + fmt(r.fibPos, 2)));
    if (meta.childNodes.length) card.appendChild(meta);

    card.appendChild(el('p', 'watch-reason' + (r.needKey ? ' key' : ''), r.reason || 'Pas de setup pour l’instant'));
    return card;
  }

  // --- Filtres / tri ----------------------------------------------------------
  function marketMatch(r) {
    var f = state.filters.market;
    if (f === 'all') return true;
    if (f === 'crypto') return r.kind === 'crypto';
    if (f === 'forex') return r.kind === 'forex';
    if (f === 'metal') return r.kind === 'metal';
    return true;
  }
  function applyFilters(signals) {
    var out = signals.filter(marketMatch);
    if (state.filters.dir === 'long') out = out.filter(function (r) { return r.trade.direction === 'LONG'; });
    else if (state.filters.dir === 'short') out = out.filter(function (r) { return r.trade.direction === 'SHORT'; });
    if (state.filters.strat !== 'all') out = out.filter(function (r) { return r.strategy === state.filters.strat; });
    if (state.filters.sort === 'rr') out.sort(function (a, b) { return b.trade.rr - a.trade.rr; });
    else if (state.filters.sort === 'sym') out.sort(function (a, b) { return (a.label || '').localeCompare(b.label || ''); });
    else out.sort(function (a, b) { return b.confidence - a.confidence; });
    return out;
  }

  // --- KPI + rendu ------------------------------------------------------------
  function renderKPIs(signals) {
    var longs = signals.filter(function (r) { return r.trade.direction === 'LONG'; }).length;
    var shorts = signals.length - longs;
    var conf = signals.length ? signals.reduce(function (s, r) { return s + r.confidence; }, 0) / signals.length : null;
    var rr = signals.length ? signals.reduce(function (s, r) { return s + r.trade.rr; }, 0) / signals.length : null;
    $('#kpi-signals').textContent = signals.length;
    $('#kpi-long').textContent = longs;
    $('#kpi-short').textContent = shorts;
    $('#kpi-conf').textContent = conf != null ? Math.round(conf) + '%' : '—';
    $('#kpi-rr').textContent = rr != null ? '1:' + fmt(rr, 2) : '—';
    $('#kpi-markets').textContent = results().length;
  }

  function renderAll() {
    var all = results();
    var signalsAll = all.filter(function (r) { return r.hasSignal; });
    var signals = applyFilters(signalsAll);
    var watching = all.filter(function (r) { return !r.hasSignal; }).filter(marketMatch);

    renderKPIs(signalsAll);
    $('#count-signals').textContent = signals.length;
    $('#count-watch').textContent = watching.length;

    var sig = $('#signals'); sig.innerHTML = '';
    if (!signals.length) {
      var empty = el('div', 'empty');
      empty.appendChild(el('div', 'empty-icon', '⌕'));
      empty.appendChild(el('p', null, signalsAll.length ? 'Rien qui corresponde à tes filtres pour l’instant.' : 'Aucun trade à te proposer là, tout de suite.'));
      empty.appendChild(el('p', 'empty-sub', 'Pas d’inquiétude : je continue de surveiller tes paires et je te montre un trade dès qu’il coche vraiment toutes les cases.'));
      sig.appendChild(empty);
    } else signals.forEach(function (r) { sig.appendChild(signalCard(r)); });

    var w = $('#watchlist'); w.innerHTML = '';
    watching.forEach(function (r) { w.appendChild(watchCard(r)); });

    if (state.lastUpdate) $('#last-update').textContent = 'Mis à jour à ' + state.lastUpdate.toLocaleTimeString('fr-FR');
  }

  function setStatus(text, busy) {
    var l = $('#status-label'); if (l) l.textContent = text;
    var d = $('#status-dot'); if (d) d.classList.toggle('busy', !!busy);
  }

  // --- Modale détail ----------------------------------------------------------
  var openSym = null;
  function openDetail(sym) {
    var r = state.cache[sym] && state.cache[sym].result;
    if (!r || !r.chart) return;
    openSym = sym;
    var p = r.precision || 2;
    $('#modal-sym').textContent = r.label || sym;
    $('#modal-tf').textContent = r.timeframe;
    var badge = $('#modal-badge');
    if (r.hasSignal) { badge.style.display = ''; badge.className = 'badge ' + (r.trade.direction === 'LONG' ? 'badge-long' : 'badge-short'); badge.textContent = r.trade.direction === 'LONG' ? 'ACHAT' : 'VENTE'; }
    else { badge.style.display = 'none'; }
    var st = $('#modal-strat');
    if (r.hasSignal && r.strategyLabel) { st.style.display = ''; st.className = 'strat-tag strat-' + r.strategy; st.textContent = r.strategyLabel; }
    else { st.style.display = 'none'; }

    var body = $('#modal-body'); body.innerHTML = '';
    // contexte
    var ctx = el('div', 'ctx-grid');
    function box(l, v) { var b = el('div', 'ctx-box'); b.appendChild(el('span', 'ctx-l', l)); b.appendChild(el('span', 'ctx-v', v)); return b; }
    ctx.appendChild(box('Zone', r.zone ? zoneLabel(r.zone) : '—'));
    ctx.appendChild(box('Position Fib', fmt(r.fibPos, 2)));
    ctx.appendChild(box('Tendance', r.trend || '—'));
    ctx.appendChild(box('Structure', r.structure || '—'));
    ctx.appendChild(box('Prix', fmt(r.price, p)));
    body.appendChild(ctx);

    if (r.hasSignal) {
      var t = r.trade;
      var psd = positionSize(t);
      var tbl = el('div', 'detail-levels');
      function row(l, v, c, kind) {
        var d = el('div', 'dl-row ' + (c || ''));
        d.appendChild(el('span', null, l));
        var rt = el('div', 'dl-right');
        rt.appendChild(el('span', 'dl-v', fmt(v, p)));
        if (kind && t.entry) {
          var pct = (v - t.entry) / t.entry * 100, amt = psd ? psd.units * Math.abs(v - t.entry) : null, sign = kind === 'sl' ? '−' : '+';
          rt.appendChild(el('span', 'dl-sub ' + (kind === 'sl' ? 'neg' : 'pos'), sign + fmt(Math.abs(pct), 2) + '%' + (amt != null ? ' · ' + sign + fmt(amt, 2) + ' $' : '')));
        }
        d.appendChild(rt); return d;
      }
      tbl.appendChild(row('Entrée', t.entry, 'e'));
      tbl.appendChild(row('Stop Loss', t.sl, 'sl', 'sl'));
      tbl.appendChild(row('TP1 · equilibrium', t.tp1, 'tp', 'tp'));
      tbl.appendChild(row('TP2 · liquidité', t.tp2, 'tp', 'tp'));
      tbl.appendChild(row('TP3 · extension', t.tp3, 'tp', 'tp'));
      var rrRow = el('div', 'dl-row rr'); rrRow.appendChild(el('span', null, 'Risk : Reward')); var rrRt = el('div', 'dl-right'); rrRt.appendChild(el('span', 'dl-v', '1 : ' + fmt(t.rr, 2))); rrRow.appendChild(rrRt);
      tbl.appendChild(rrRow);
      body.appendChild(tbl);

      var ps = positionSize(t);
      if (ps) {
        var calc = el('div', 'calc');
        calc.appendChild(el('div', 'calc-title', 'Calculateur de risque (capital ' + fmt(state.risk.balance, 0) + ' $ · ' + fmt(state.risk.pct, 1) + ' %)'));
        var g = el('div', 'calc-grid');
        function ci(l, v) { var b = el('div', 'calc-box'); b.appendChild(el('span', 'ci-l', l)); b.appendChild(el('span', 'ci-v', v)); return b; }
        g.appendChild(ci('Risque', fmt(ps.riskAmount, 2) + ' $'));
        g.appendChild(ci('Taille', '≈ ' + fmt(ps.units, ps.units > 100 ? 2 : 4) + ' u.'));
        g.appendChild(ci('Valeur position', '≈ ' + fmt(ps.notional, 0) + ' $'));
        calc.appendChild(g);
        body.appendChild(calc);
      }

      var cl = el('div', 'confl-block');
      cl.appendChild(el('div', 'section-title', 'Confluences ICT / SMC'));
      var ul = el('ul', 'confluences');
      (r.confluences || []).forEach(function (c) { var li = el('li'); li.appendChild(el('span', 'check', '✓')); li.appendChild(document.createTextNode(' ' + c)); ul.appendChild(li); });
      cl.appendChild(ul);
      body.appendChild(cl);
    } else {
      body.appendChild(el('p', 'modal-note', r.reason || 'Pas de setup pour l’instant.'));
    }

    var m = $('#modal'); m.classList.add('open'); m.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () {
      TAChart.render($('#modal-chart'), r.chart, { precision: p });
    });
  }
  function closeDetail() { openSym = null; var m = $('#modal'); m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }

  // --- Contrôles --------------------------------------------------------------
  function seg(container, options, current, onPick) {
    container.innerHTML = '';
    options.forEach(function (o) {
      var b = el('button', 'seg-btn' + (o.v === current ? ' active' : ''), o.t);
      b.addEventListener('click', function () { onPick(o.v); });
      container.appendChild(b);
    });
  }
  function buildToolbar() {
    seg($('#tf-buttons'), [{ v: '5m', t: '5m' }, { v: '15m', t: '15m' }, { v: '1h', t: '1h' }, { v: '4h', t: '4h' }], state.timeframe, function (v) {
      if (v === state.timeframe) return; state.timeframe = v; save(); buildToolbar(); refresh(true);
    });
    seg($('#dir-filter'), [{ v: 'all', t: 'Tous' }, { v: 'long', t: 'Achat' }, { v: 'short', t: 'Vente' }], state.filters.dir, function (v) { state.filters.dir = v; save(); buildToolbar(); renderAll(); });
    seg($('#market-filter'), [{ v: 'all', t: 'Tous' }, { v: 'crypto', t: 'Crypto' }, { v: 'forex', t: 'Forex' }, { v: 'metal', t: 'Or' }], state.filters.market, function (v) { state.filters.market = v; save(); buildToolbar(); renderAll(); });
    seg($('#strat-filter'), [{ v: 'all', t: 'Toutes' }, { v: 'ote', t: 'OTE' }, { v: 'daily', t: 'Prev. Daily' }, { v: 'scalp', t: 'Scalp' }, { v: 'smc', t: 'SMC' }], state.filters.strat, function (v) { state.filters.strat = v; save(); buildToolbar(); renderAll(); });
    seg($('#sort-filter'), [{ v: 'conf', t: 'Confiance' }, { v: 'rr', t: 'R:R' }, { v: 'sym', t: 'Nom' }], state.filters.sort, function (v) { state.filters.sort = v; save(); buildToolbar(); renderAll(); });
  }

  function initSymbols() {
    var input = $('#symbols-input'); input.value = state.symbols.join(', ');
    $('#symbols-apply').addEventListener('click', function () {
      var list = input.value.split(',').map(function (s) { return s.trim().toUpperCase().replace('/', ''); }).filter(function (s) { return API.SYMBOLS[s]; });
      if (!list.length) { input.value = state.symbols.join(', '); return; }
      state.symbols = list; save(); refresh(true); input.value = state.symbols.join(', ');
    });
  }
  function initApiKey() {
    var input = $('#apikey-input'), btn = $('#apikey-save');
    input.value = API.getApiKey(); updateKeyBadge();
    btn.addEventListener('click', function () { API.setApiKey(input.value); updateKeyBadge(); refresh(true); });
  }
  function updateKeyBadge() {
    var b = $('#apikey-status');
    if (API.getApiKey()) { b.textContent = '● clé enregistrée'; b.className = 'apikey-status ok'; }
    else { b.textContent = '○ aucune clé (forex/or inactifs)'; b.className = 'apikey-status'; }
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    $('#theme-toggle').textContent = state.theme === 'dark' ? '🌙' : '☀️';
  }
  function updateAlertBtn() {
    var b = $('#alert-toggle'); b.textContent = state.alerts ? '🔔' : '🔕';
    b.classList.toggle('on', state.alerts);
  }

  function initModals() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (x) { x.addEventListener('click', closeDetail); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
    window.addEventListener('resize', function () { if (openSym) { var r = state.cache[openSym] && state.cache[openSym].result; if (r && r.chart) TAChart.render($('#modal-chart'), r.chart, { precision: r.precision || 2 }); } });
  }

  function initSettings() {
    $('#risk-balance').value = state.risk.balance; $('#risk-pct').value = state.risk.pct;
    $('#risk-save').addEventListener('click', function () {
      var b = parseFloat($('#risk-balance').value), p = parseFloat($('#risk-pct').value);
      if (b > 0) state.risk.balance = b; if (p > 0) state.risk.pct = p;
      save(); renderAll(); toast('C’est noté — la taille des positions est recalculée.', 'long');
    });
    $('#clear-history').addEventListener('click', function () {
      if (!state.history.length) return;
      state.history = []; saveHistory(); renderHistory();
      toast('Historique vidé.');
    });
  }

  // --- Navigation entre sous-parties -----------------------------------------
  function switchView(v) {
    state.view = v;
    Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (b) { b.classList.toggle('active', b.getAttribute('data-view') === v); });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (s) { s.classList.toggle('active', s.id === 'view-' + v); });
    if (v === 'historique') renderHistory();
    if (v === 'strategies') renderStrategies();
  }
  function initNav() {
    Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function (b) {
      b.addEventListener('click', function () { switchView(b.getAttribute('data-view')); });
    });
  }

  // --- Section Stratégies -----------------------------------------------------
  function renderStrategies() {
    var box = $('#strategies-list'); box.innerHTML = '';
    STRATS.forEach(function (s) {
      var on = state.strategies[s.id] !== false;
      var card = el('div', 'strat-card' + (on ? ' on' : ''));
      var info = el('div', 'strat-info');
      var top = el('div', 'strat-top');
      top.appendChild(el('h4', null, s.name));
      top.appendChild(el('span', 'strat-badge strat-' + s.id, s.tag));
      info.appendChild(top);
      info.appendChild(el('p', 'strat-sub', s.sub));
      card.appendChild(info);

      var sw = el('button', 'switch' + (on ? ' on' : ''));
      sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', on ? 'true' : 'false');
      sw.appendChild(el('span', 'knob'));
      sw.addEventListener('click', function () {
        state.strategies[s.id] = state.strategies[s.id] === false;
        // au moins une stratégie active
        if (!STRATS.some(function (x) { return state.strategies[x.id] !== false; })) { state.strategies[s.id] = true; toast('Garde au moins une stratégie active.'); }
        save(); renderStrategies(); refresh(true);
      });
      card.appendChild(sw);
      box.appendChild(card);
    });
  }

  function init() {
    load(); loadHistory();
    applyTheme(); updateAlertBtn();
    buildToolbar(); initSymbols(); initApiKey(); initModals(); initSettings(); initNav();
    renderStrategies();

    $('#theme-toggle').addEventListener('click', function () { state.theme = state.theme === 'dark' ? 'light' : 'dark'; save(); applyTheme(); });
    $('#alert-toggle').addEventListener('click', function () {
      state.alerts = !state.alerts; save(); updateAlertBtn();
      if (state.alerts) {
        beep();
        if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
        toast('C’est parti — je te préviens dès qu’un nouveau trade se présente.', 'long');
      } else toast('Très bien, je ne te préviens plus.');
    });
    $('#refresh-btn').addEventListener('click', function () { refresh(true); });

    refresh(true);
    state.timer = setInterval(function () { refresh(false); }, TICK_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
