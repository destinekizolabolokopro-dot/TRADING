/*
 * Application — orchestration & rendu
 * -----------------------------------
 * Boucle : pour chaque actif de la watchlist, récupère les bougies Binance,
 * lance le moteur ICT, puis affiche les setups valides et les actifs en veille.
 */
(function () {
  'use strict';

  // --- Watchlist par défaut (modifiable dans l'UI) ---------------------------
  var DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT'];
  var STORAGE_KEY = 'ictsmc.settings';
  var REFRESH_MS = 45000; // 45 s

  var state = {
    symbols: DEFAULT_SYMBOLS.slice(),
    timeframe: '15m',
    results: {},
    lastUpdate: null,
    loading: false,
    timer: null
  };

  // --- Persistance légère (localStorage) -------------------------------------
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && Array.isArray(s.symbols) && s.symbols.length) state.symbols = s.symbols;
      if (s && s.timeframe) state.timeframe = s.timeframe;
    } catch (e) { /* ignore */ }
  }
  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ symbols: state.symbols, timeframe: state.timeframe }));
    } catch (e) { /* ignore */ }
  }

  // --- Helpers DOM ------------------------------------------------------------
  var $ = function (sel) { return document.querySelector(sel); };
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function fmt(v, p) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: p, maximumFractionDigits: p });
  }

  // --- Récupération + analyse d'un actif -------------------------------------
  function analyzeSymbol(symbol) {
    return API.fetchKlines(symbol, state.timeframe, 200)
      .then(function (candles) {
        return ICT.analyze(symbol, state.timeframe, candles);
      })
      .catch(function (err) {
        return { symbol: symbol, timeframe: state.timeframe, hasSignal: false, error: err.message || 'Erreur réseau' };
      });
  }

  function refresh() {
    if (state.loading) return;
    state.loading = true;
    setStatus('Analyse en cours…', true);

    var jobs = state.symbols.map(analyzeSymbol);
    Promise.all(jobs).then(function (results) {
      results.forEach(function (r) { state.results[r.symbol] = r; });
      state.lastUpdate = new Date();
      state.loading = false;
      render();
      setStatus('En direct', false);
    });
  }

  // --- Rendu ------------------------------------------------------------------
  function setStatus(text, busy) {
    var dot = $('#status-dot');
    var label = $('#status-label');
    if (label) label.textContent = text;
    if (dot) dot.classList.toggle('busy', !!busy);
  }

  function directionBadge(dir) {
    var b = el('span', 'badge ' + (dir === 'LONG' ? 'badge-long' : 'badge-short'), dir === 'LONG' ? 'ACHAT' : 'VENTE');
    return b;
  }

  function confluenceList(items) {
    var ul = el('ul', 'confluences');
    (items || []).forEach(function (c) {
      var li = el('li', null);
      li.appendChild(el('span', 'check', '✓'));
      li.appendChild(document.createTextNode(' ' + c));
      ul.appendChild(li);
    });
    return ul;
  }

  function signalCard(r) {
    var t = r.trade;
    var p = r.precision;
    var card = el('article', 'card signal ' + (t.direction === 'LONG' ? 'is-long' : 'is-short'));

    // En-tête
    var head = el('div', 'card-head');
    var left = el('div', 'card-head-left');
    left.appendChild(el('h3', 'sym', r.symbol.replace('USDT', '/USDT')));
    left.appendChild(el('span', 'tf', r.timeframe));
    head.appendChild(left);
    var right = el('div', 'card-head-right');
    right.appendChild(directionBadge(t.direction));
    head.appendChild(right);
    card.appendChild(head);

    // Zone + confiance
    var meta = el('div', 'meta-row');
    meta.appendChild(el('span', 'pill pill-' + r.zone, r.zone === 'discount' ? 'Discount' : (r.zone === 'premium' ? 'Premium' : 'Equilibrium')));
    meta.appendChild(el('span', 'pill', 'Fib ' + fmt(r.fibPos, 2)));
    var conf = el('span', 'pill pill-conf', 'Confiance ' + r.confidence + '%');
    meta.appendChild(conf);
    card.appendChild(meta);

    // Niveaux
    var levels = el('div', 'levels');
    function level(lbl, val, cls) {
      var row = el('div', 'level ' + (cls || ''));
      row.appendChild(el('span', 'level-lbl', lbl));
      row.appendChild(el('span', 'level-val', fmt(val, p)));
      return row;
    }
    levels.appendChild(level('Entrée', t.entry, 'lvl-entry'));
    levels.appendChild(level('Stop Loss', t.sl, 'lvl-sl'));
    levels.appendChild(level('TP1 · equilibrium', t.tp1, 'lvl-tp'));
    levels.appendChild(level('TP2 · liquidité', t.tp2, 'lvl-tp'));
    levels.appendChild(level('TP3 · extension', t.tp3, 'lvl-tp'));
    var rr = el('div', 'level lvl-rr');
    rr.appendChild(el('span', 'level-lbl', 'Risk : Reward'));
    rr.appendChild(el('span', 'level-val', '1 : ' + fmt(t.rr, 2)));
    levels.appendChild(rr);
    card.appendChild(levels);

    // Confluences
    card.appendChild(el('div', 'section-title', 'Confluences ICT / SMC'));
    card.appendChild(confluenceList(r.confluences));

    return card;
  }

  function watchCard(r) {
    var card = el('article', 'card watch');
    var head = el('div', 'card-head');
    var left = el('div', 'card-head-left');
    left.appendChild(el('h3', 'sym', r.symbol.replace('USDT', '/USDT')));
    left.appendChild(el('span', 'tf', r.timeframe));
    head.appendChild(left);
    card.appendChild(head);

    if (r.error) {
      card.appendChild(el('p', 'watch-reason err', 'Erreur : ' + r.error));
      return card;
    }

    var meta = el('div', 'meta-row');
    if (r.zone) meta.appendChild(el('span', 'pill pill-' + r.zone, r.zone === 'discount' ? 'Discount' : (r.zone === 'premium' ? 'Premium' : 'Equilibrium')));
    if (r.price != null) meta.appendChild(el('span', 'pill', fmt(r.price, r.precision || 2)));
    if (r.fibPos != null) meta.appendChild(el('span', 'pill', 'Fib ' + fmt(r.fibPos, 2)));
    card.appendChild(meta);

    card.appendChild(el('p', 'watch-reason', r.reason || 'Pas de setup pour l’instant'));
    return card;
  }

  function render() {
    var results = state.symbols.map(function (s) { return state.results[s]; }).filter(Boolean);
    var signals = results.filter(function (r) { return r.hasSignal; })
      .sort(function (a, b) { return b.confidence - a.confidence; });
    var watching = results.filter(function (r) { return !r.hasSignal; });

    // Compteurs
    $('#count-signals').textContent = signals.length;
    $('#count-watch').textContent = watching.length;

    var sig = $('#signals');
    sig.innerHTML = '';
    if (!signals.length) {
      var empty = el('div', 'empty');
      empty.appendChild(el('div', 'empty-icon', '⌕'));
      empty.appendChild(el('p', null, 'Aucun setup validé pour l’instant.'));
      empty.appendChild(el('p', 'empty-sub', 'Le moteur attend une confluence complète : PD Array en zone discount/premium + CRT ou clôture au-dessus du PD Array.'));
      sig.appendChild(empty);
    } else {
      signals.forEach(function (r) { sig.appendChild(signalCard(r)); });
    }

    var w = $('#watchlist');
    w.innerHTML = '';
    watching.forEach(function (r) { w.appendChild(watchCard(r)); });

    if (state.lastUpdate) {
      $('#last-update').textContent = 'Mis à jour à ' + state.lastUpdate.toLocaleTimeString('fr-FR');
    }
  }

  // --- Contrôles UI -----------------------------------------------------------
  function buildTimeframeButtons() {
    var tfs = ['5m', '15m', '1h', '4h'];
    var box = $('#tf-buttons');
    box.innerHTML = '';
    tfs.forEach(function (tf) {
      var b = el('button', 'tf-btn' + (tf === state.timeframe ? ' active' : ''), tf);
      b.addEventListener('click', function () {
        if (state.timeframe === tf) return;
        state.timeframe = tf;
        saveSettings();
        buildTimeframeButtons();
        refresh();
      });
      box.appendChild(b);
    });
  }

  function initSymbolEditor() {
    var input = $('#symbols-input');
    input.value = state.symbols.join(', ');
    $('#symbols-apply').addEventListener('click', function () {
      var list = input.value.split(',')
        .map(function (s) { return s.trim().toUpperCase(); })
        .filter(function (s) { return /^[A-Z0-9]{4,15}$/.test(s); });
      if (!list.length) return;
      state.symbols = list;
      state.results = {};
      saveSettings();
      refresh();
    });
  }

  function init() {
    loadSettings();
    buildTimeframeButtons();
    initSymbolEditor();
    $('#refresh-btn').addEventListener('click', refresh);
    refresh();
    state.timer = setInterval(refresh, REFRESH_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
