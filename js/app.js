/*
 * Application — orchestration & rendu
 * -----------------------------------
 * Pour chaque paire de la watchlist : récupère les bougies (Binance pour la crypto,
 * Twelve Data pour le forex/or), lance le moteur ICT, puis affiche les setups validés
 * et les paires en veille.
 *
 * Cadence différenciée : la crypto (source gratuite illimitée) se rafraîchit vite ;
 * le forex/or (source à quota gratuit) se rafraîchit plus lentement pour ménager le quota.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'ictsmc.settings';
  var TICK_MS = 20000;        // cadence de la boucle
  var MIN_AGE_CRYPTO = 40000; // crypto : re-fetch au plus toutes les 40 s
  var MIN_AGE_SLOW = 240000;  // forex/or : re-fetch au plus toutes les 4 min (quota gratuit)

  var state = {
    symbols: API.DEFAULT_SYMBOLS.slice(),
    timeframe: '15m',
    cache: {},        // sym -> { ts, result }
    lastUpdate: null,
    timer: null
  };

  // --- Persistance ------------------------------------------------------------
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && Array.isArray(s.symbols) && s.symbols.length) {
        state.symbols = s.symbols.filter(function (x) { return API.SYMBOLS[x]; });
        if (!state.symbols.length) state.symbols = API.DEFAULT_SYMBOLS.slice();
      }
      if (s && s.timeframe) state.timeframe = s.timeframe;
    } catch (e) { /* ignore */ }
  }
  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ symbols: state.symbols, timeframe: state.timeframe })); }
    catch (e) { /* ignore */ }
  }

  // --- Helpers DOM ------------------------------------------------------------
  var $ = function (s) { return document.querySelector(s); };
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function fmt(v, p) { if (v == null || isNaN(v)) return '—'; return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: p, maximumFractionDigits: p }); }
  function minAge(sym) { var m = API.meta(sym); return (m && m.kind === 'crypto') ? MIN_AGE_CRYPTO : MIN_AGE_SLOW; }

  // --- Récupération + analyse d'une paire (avec cache par ancienneté) ---------
  function ensureSymbol(sym) {
    var now = Date.now();
    var cached = state.cache[sym];
    if (cached && (now - cached.ts) < minAge(sym)) return Promise.resolve(cached.result);

    return API.fetchCandles(sym, state.timeframe, 200)
      .then(function (candles) {
        var r = ICT.analyze(sym, state.timeframe, candles);
        r.label = API.label(sym);
        state.cache[sym] = { ts: Date.now(), result: r };
        return r;
      })
      .catch(function (err) {
        var m = API.meta(sym);
        var r = { symbol: sym, label: API.label(sym), timeframe: state.timeframe, hasSignal: false, kind: m && m.kind };
        if (err && err.message === 'NO_API_KEY') {
          r.needKey = true;
          r.reason = 'Ajoute ta clé API gratuite (en haut) pour activer le forex/or.';
        } else {
          r.error = (err && err.message) || 'Erreur réseau';
        }
        // On garde brièvement en cache pour ne pas marteler en cas d'erreur.
        state.cache[sym] = { ts: Date.now(), result: r };
        return r;
      });
  }

  function refresh(force) {
    if (force) state.cache = {};
    setStatus('Analyse en cours…', true);
    // Rendu incrémental : chaque paire s'affiche dès qu'elle est prête,
    // sans attendre les plus lentes.
    var jobs = state.symbols.map(function (sym) {
      return ensureSymbol(sym).then(function () { render(); });
    });
    return Promise.all(jobs).then(function () {
      state.lastUpdate = new Date();
      render();
      setStatus('En direct', false);
    });
  }

  // --- Rendu ------------------------------------------------------------------
  function setStatus(text, busy) {
    var label = $('#status-label'); if (label) label.textContent = text;
    var dot = $('#status-dot'); if (dot) dot.classList.toggle('busy', !!busy);
  }
  function zoneLabel(z) { return z === 'discount' ? 'Discount' : (z === 'premium' ? 'Premium' : 'Equilibrium'); }

  function signalCard(r) {
    var t = r.trade, p = r.precision;
    var card = el('article', 'card signal ' + (t.direction === 'LONG' ? 'is-long' : 'is-short'));
    var head = el('div', 'card-head');
    var left = el('div', 'card-head-left');
    left.appendChild(el('h3', 'sym', r.label || r.symbol));
    left.appendChild(el('span', 'tf', r.timeframe));
    head.appendChild(left);
    var right = el('div', 'card-head-right');
    right.appendChild(el('span', 'badge ' + (t.direction === 'LONG' ? 'badge-long' : 'badge-short'), t.direction === 'LONG' ? 'ACHAT' : 'VENTE'));
    head.appendChild(right);
    card.appendChild(head);

    var meta = el('div', 'meta-row');
    meta.appendChild(el('span', 'pill pill-' + r.zone, zoneLabel(r.zone)));
    meta.appendChild(el('span', 'pill', 'Fib ' + fmt(r.fibPos, 2)));
    meta.appendChild(el('span', 'pill pill-conf', 'Confiance ' + r.confidence + '%'));
    card.appendChild(meta);

    var levels = el('div', 'levels');
    function lv(l, v, c) { var row = el('div', 'level ' + (c || '')); row.appendChild(el('span', 'level-lbl', l)); row.appendChild(el('span', 'level-val', fmt(v, p))); return row; }
    levels.appendChild(lv('Entrée', t.entry, 'lvl-entry'));
    levels.appendChild(lv('Stop Loss', t.sl, 'lvl-sl'));
    levels.appendChild(lv('TP1 · equilibrium', t.tp1, 'lvl-tp'));
    levels.appendChild(lv('TP2 · liquidité', t.tp2, 'lvl-tp'));
    levels.appendChild(lv('TP3 · extension', t.tp3, 'lvl-tp'));
    var rr = el('div', 'level lvl-rr'); rr.appendChild(el('span', 'level-lbl', 'Risk : Reward')); rr.appendChild(el('span', 'level-val', '1 : ' + fmt(t.rr, 2)));
    levels.appendChild(rr);
    card.appendChild(levels);

    card.appendChild(el('div', 'section-title', 'Confluences ICT / SMC'));
    var ul = el('ul', 'confluences');
    (r.confluences || []).forEach(function (c) { var li = el('li'); li.appendChild(el('span', 'check', '✓')); li.appendChild(document.createTextNode(' ' + c)); ul.appendChild(li); });
    card.appendChild(ul);
    return card;
  }

  function watchCard(r) {
    var card = el('article', 'card watch' + (r.needKey ? ' need-key' : ''));
    var head = el('div', 'card-head');
    var left = el('div', 'card-head-left');
    left.appendChild(el('h3', 'sym', r.label || r.symbol));
    left.appendChild(el('span', 'tf', r.timeframe));
    head.appendChild(left);
    card.appendChild(head);

    if (r.error) { card.appendChild(el('p', 'watch-reason err', 'Erreur : ' + r.error)); return card; }

    var meta = el('div', 'meta-row');
    if (r.zone) meta.appendChild(el('span', 'pill pill-' + r.zone, zoneLabel(r.zone)));
    if (r.price != null) meta.appendChild(el('span', 'pill', fmt(r.price, r.precision || 2)));
    if (r.fibPos != null) meta.appendChild(el('span', 'pill', 'Fib ' + fmt(r.fibPos, 2)));
    if (meta.childNodes.length) card.appendChild(meta);

    card.appendChild(el('p', 'watch-reason' + (r.needKey ? ' key' : ''), r.reason || 'Pas de setup pour l’instant'));
    return card;
  }

  function render() {
    var ordered = state.symbols.map(function (s) { return (state.cache[s] && state.cache[s].result) || null; }).filter(Boolean);
    var signals = ordered.filter(function (r) { return r.hasSignal; }).sort(function (a, b) { return b.confidence - a.confidence; });
    var watching = ordered.filter(function (r) { return !r.hasSignal; });

    $('#count-signals').textContent = signals.length;
    $('#count-watch').textContent = watching.length;

    var sig = $('#signals'); sig.innerHTML = '';
    if (!signals.length) {
      var empty = el('div', 'empty');
      empty.appendChild(el('div', 'empty-icon', '⌕'));
      empty.appendChild(el('p', null, 'Aucun setup validé pour l’instant.'));
      empty.appendChild(el('p', 'empty-sub', 'Le moteur attend une confluence complète : PD Array en zone discount/premium + CRT ou clôture au-dessus/en-dessous du PD Array.'));
      sig.appendChild(empty);
    } else {
      signals.forEach(function (r) { sig.appendChild(signalCard(r)); });
    }

    var w = $('#watchlist'); w.innerHTML = '';
    watching.forEach(function (r) { w.appendChild(watchCard(r)); });

    if (state.lastUpdate) $('#last-update').textContent = 'Mis à jour à ' + state.lastUpdate.toLocaleTimeString('fr-FR');
  }

  // --- Contrôles --------------------------------------------------------------
  function buildTimeframeButtons() {
    var tfs = ['5m', '15m', '1h', '4h'];
    var box = $('#tf-buttons'); box.innerHTML = '';
    tfs.forEach(function (tf) {
      var b = el('button', 'tf-btn' + (tf === state.timeframe ? ' active' : ''), tf);
      b.addEventListener('click', function () {
        if (state.timeframe === tf) return;
        state.timeframe = tf; saveSettings(); buildTimeframeButtons(); refresh(true);
      });
      box.appendChild(b);
    });
  }

  function initSymbolEditor() {
    var input = $('#symbols-input');
    input.value = state.symbols.join(', ');
    $('#symbols-apply').addEventListener('click', function () {
      var list = input.value.split(',').map(function (s) { return s.trim().toUpperCase().replace('/', ''); })
        .filter(function (s) { return API.SYMBOLS[s]; });
      if (!list.length) { input.value = state.symbols.join(', '); return; }
      state.symbols = list; saveSettings(); refresh(true);
      input.value = state.symbols.join(', ');
    });
  }

  function initApiKey() {
    var input = $('#apikey-input');
    var btn = $('#apikey-save');
    if (!input || !btn) return;
    input.value = API.getApiKey();
    updateKeyBadge();
    btn.addEventListener('click', function () {
      API.setApiKey(input.value);
      updateKeyBadge();
      refresh(true);
    });
  }
  function updateKeyBadge() {
    var badge = $('#apikey-status');
    if (!badge) return;
    if (API.getApiKey()) { badge.textContent = '● clé enregistrée'; badge.className = 'apikey-status ok'; }
    else { badge.textContent = '○ aucune clé (forex/or inactifs)'; badge.className = 'apikey-status'; }
  }

  function init() {
    loadSettings();
    buildTimeframeButtons();
    initSymbolEditor();
    initApiKey();
    $('#refresh-btn').addEventListener('click', function () { refresh(true); });
    refresh(true);
    state.timer = setInterval(function () { refresh(false); }, TICK_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
