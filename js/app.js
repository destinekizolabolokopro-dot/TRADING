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
  var TICK_MS = 20000;
  var MIN_AGE_CRYPTO = 40000;
  var MIN_AGE_SLOW = 240000;

  var state = {
    symbols: API.DEFAULT_SYMBOLS.slice(),
    timeframe: '15m',
    cache: {},
    lastUpdate: null,
    prevSignals: null,
    filters: { dir: 'all', market: 'all', sort: 'conf' },
    theme: 'dark',
    alerts: false,
    risk: { balance: 1000, pct: 1 },
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
        theme: state.theme, alerts: state.alerts, risk: state.risk
      }));
    } catch (e) { /* ignore */ }
  }

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
  function ensureSymbol(sym) {
    var now = Date.now();
    var c = state.cache[sym];
    if (c && (now - c.ts) < minAge(sym)) return Promise.resolve(c.result);
    return API.fetchCandles(sym, state.timeframe, 200)
      .then(function (candles) {
        var r = ICT.analyze(sym, state.timeframe, candles);
        r.label = API.label(sym); r.kind = (API.meta(sym) || {}).kind;
        state.cache[sym] = { ts: Date.now(), result: r };
        return r;
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
      renderAll();
      checkAlerts();
      setStatus('En direct', false);
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

    var meta = el('div', 'meta-row');
    meta.appendChild(el('span', 'pill pill-' + r.zone, zoneLabel(r.zone)));
    meta.appendChild(el('span', 'pill', 'Fib ' + fmt(r.fibPos, 2)));
    meta.appendChild(el('span', 'pill pill-conf', 'Confiance ' + r.confidence + '%'));
    card.appendChild(meta);

    // barre de confiance
    var bar = el('div', 'conf-bar'); var fill = el('div', 'conf-fill ' + (t.direction === 'LONG' ? 'long' : 'short')); fill.style.width = r.confidence + '%'; bar.appendChild(fill);
    card.appendChild(bar);

    var levels = el('div', 'levels');
    function lv(l, v, c) { var row = el('div', 'level ' + (c || '')); row.appendChild(el('span', 'level-lbl', l)); row.appendChild(el('span', 'level-val', fmt(v, p))); return row; }
    levels.appendChild(lv('Entrée', t.entry, 'lvl-entry'));
    levels.appendChild(lv('Stop Loss', t.sl, 'lvl-sl'));
    levels.appendChild(lv('TP1 · equilibrium', t.tp1, 'lvl-tp'));
    levels.appendChild(lv('TP2 · liquidité', t.tp2, 'lvl-tp'));
    var rr = el('div', 'level lvl-rr'); rr.appendChild(el('span', 'level-lbl', 'Risk : Reward')); rr.appendChild(el('span', 'level-val', '1 : ' + fmt(t.rr, 2)));
    levels.appendChild(rr);
    card.appendChild(levels);

    var ps = positionSize(t);
    if (ps) {
      var pr = el('div', 'possize');
      pr.appendChild(el('span', 'possize-lbl', 'Taille suggérée'));
      pr.appendChild(el('span', 'possize-val', '≈ ' + fmt(ps.units, ps.units > 100 ? 2 : 4) + ' u. · risque ' + fmt(ps.riskAmount, 2) + ' $'));
      card.appendChild(pr);
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
      empty.appendChild(el('p', null, signalsAll.length ? 'Aucun setup ne correspond aux filtres.' : 'Aucun setup validé pour l’instant.'));
      empty.appendChild(el('p', 'empty-sub', 'Le moteur attend une confluence complète : PD Array en zone discount/premium + CRT ou clôture, aligné à la tendance.'));
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
      var tbl = el('div', 'detail-levels');
      function row(l, v, c) { var d = el('div', 'dl-row ' + (c || '')); d.appendChild(el('span', null, l)); d.appendChild(el('span', 'dl-v', fmt(v, p))); return d; }
      tbl.appendChild(row('Entrée', t.entry, 'e'));
      tbl.appendChild(row('Stop Loss', t.sl, 'sl'));
      tbl.appendChild(row('TP1 · equilibrium', t.tp1, 'tp'));
      tbl.appendChild(row('TP2 · liquidité', t.tp2, 'tp'));
      tbl.appendChild(row('TP3 · extension', t.tp3, 'tp'));
      tbl.appendChild(row('Risk : Reward', null, 'rr'));
      tbl.lastChild.lastChild.textContent = '1 : ' + fmt(t.rr, 2);
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
    Array.prototype.forEach.call(document.querySelectorAll('[data-close-risk]'), function (x) { x.addEventListener('click', function () { $('#risk-modal').classList.remove('open'); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeDetail(); $('#risk-modal').classList.remove('open'); } });
    window.addEventListener('resize', function () { if (openSym) { var r = state.cache[openSym] && state.cache[openSym].result; if (r && r.chart) TAChart.render($('#modal-chart'), r.chart, { precision: r.precision || 2 }); } });

    $('#risk-btn').addEventListener('click', function () {
      $('#risk-balance').value = state.risk.balance; $('#risk-pct').value = state.risk.pct;
      $('#risk-modal').classList.add('open');
    });
    $('#risk-save').addEventListener('click', function () {
      var b = parseFloat($('#risk-balance').value), p = parseFloat($('#risk-pct').value);
      if (b > 0) state.risk.balance = b; if (p > 0) state.risk.pct = p;
      save(); $('#risk-modal').classList.remove('open'); renderAll();
    });
  }

  function init() {
    load();
    applyTheme(); updateAlertBtn();
    buildToolbar(); initSymbols(); initApiKey(); initModals();

    $('#theme-toggle').addEventListener('click', function () { state.theme = state.theme === 'dark' ? 'light' : 'dark'; save(); applyTheme(); });
    $('#alert-toggle').addEventListener('click', function () {
      state.alerts = !state.alerts; save(); updateAlertBtn();
      if (state.alerts) {
        beep();
        if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
        toast('Alertes activées — tu seras prévenu·e à chaque nouveau setup.', 'long');
      } else toast('Alertes désactivées.');
    });
    $('#refresh-btn').addEventListener('click', function () { refresh(true); });

    refresh(true);
    state.timer = setInterval(function () { refresh(false); }, TICK_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
