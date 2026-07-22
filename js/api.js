/*
 * Couche données — multi-fournisseurs
 * -----------------------------------
 * - Crypto (BTC/ETH/SOL en USD) : API publique Binance, gratuite, sans clé.
 * - Forex & Or (GBP/USD, USD/JPY, EUR/JPY, XAU/USD, XAU/EUR) : Twelve Data,
 *   qui nécessite une clé API gratuite (https://twelvedata.com/pricing → plan gratuit).
 *   La clé est saisie dans l'interface et conservée localement (localStorage).
 *
 * Chaque bougie renvoyée : { time, open, high, low, close, volume }
 * (triées de la plus ancienne à la plus récente).
 */
(function (root) {
  'use strict';

  var REQUEST_TIMEOUT = 9000;
  var KEY_STORAGE = 'ictsmc.twelvedata.key';

  // --- Catalogue des paires autorisées (et rien d'autre) ---------------------
  // provider: 'binance' | 'twelvedata'
  var SYMBOLS = {
    BTCUSD: { label: 'BTC/USD', provider: 'binance',    src: 'BTCUSDT', kind: 'crypto' },
    ETHUSD: { label: 'ETH/USD', provider: 'binance',    src: 'ETHUSDT', kind: 'crypto' },
    SOLUSD: { label: 'SOL/USD', provider: 'binance',    src: 'SOLUSDT', kind: 'crypto' },
    GBPUSD: { label: 'GBP/USD', provider: 'twelvedata', src: 'GBP/USD', kind: 'forex' },
    USDJPY: { label: 'USD/JPY', provider: 'twelvedata', src: 'USD/JPY', kind: 'forex' },
    EURJPY: { label: 'EUR/JPY', provider: 'twelvedata', src: 'EUR/JPY', kind: 'forex' },
    XAUUSD: { label: 'XAU/USD', provider: 'twelvedata', src: 'XAU/USD', kind: 'metal' },
    XAUEUR: { label: 'XAU/EUR', provider: 'twelvedata', src: 'XAU/EUR', kind: 'metal' }
  };

  // Ordre d'affichage par défaut (exactement les 8 paires demandées).
  var DEFAULT_SYMBOLS = ['GBPUSD', 'USDJPY', 'SOLUSD', 'XAUEUR', 'XAUUSD', 'ETHUSD', 'EURJPY', 'BTCUSD'];

  function meta(sym) { return SYMBOLS[sym] || null; }
  function label(sym) { var m = meta(sym); return m ? m.label : sym; }

  // --- Clé API (Twelve Data) --------------------------------------------------
  function getApiKey() {
    try { return localStorage.getItem(KEY_STORAGE) || ''; } catch (e) { return ''; }
  }
  function setApiKey(k) {
    try { localStorage.setItem(KEY_STORAGE, (k || '').trim()); } catch (e) { /* ignore */ }
  }

  // --- fetch avec délai maximal ----------------------------------------------
  function fetchWithTimeout(url) {
    if (typeof AbortController === 'undefined') return fetch(url);
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT);
    return fetch(url, { signal: ctrl.signal }).finally(function () { clearTimeout(t); });
  }

  // --- Binance (crypto) -------------------------------------------------------
  var BINANCE_HOSTS = [
    'https://api.binance.com',
    'https://api1.binance.com',
    'https://data-api.binance.vision',
    'https://api.binance.us'
  ];

  function binanceInterval(tf) { return tf; } // 5m/15m/1h/4h identiques

  function fetchBinance(src, interval, limit) {
    var path = '/api/v3/klines?symbol=' + src + '&interval=' + binanceInterval(interval) + '&limit=' + (limit || 200);
    function tryHost(i) {
      if (i >= BINANCE_HOSTS.length) return Promise.reject(new Error('Binance injoignable'));
      return fetchWithTimeout(BINANCE_HOSTS[i] + path)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          if (!Array.isArray(data)) throw new Error('Réponse inattendue');
          return data.map(function (k) {
            return { time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] };
          });
        })
        .catch(function () { return tryHost(i + 1); });
    }
    return tryHost(0);
  }

  // --- Twelve Data (forex & or) ----------------------------------------------
  var TD_INTERVAL = { '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1h', '4h': '4h', '1d': '1day', '1day': '1day' };

  function fetchTwelveData(src, interval, limit) {
    var key = getApiKey();
    if (!key) return Promise.reject(new Error('NO_API_KEY'));
    var itv = TD_INTERVAL[interval] || '15min';
    var url = 'https://api.twelvedata.com/time_series?symbol=' + encodeURIComponent(src) +
      '&interval=' + itv + '&outputsize=' + (limit || 200) + '&format=JSON&apikey=' + encodeURIComponent(key);

    return fetchWithTimeout(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.status === 'error' || !Array.isArray(data.values)) {
          var msg = (data && data.message) ? data.message : 'Données indisponibles';
          if (/api key|apikey/i.test(msg)) throw new Error('Clé API invalide');
          if (/limit|run out|credit/i.test(msg)) throw new Error('Limite API atteinte (réessaie plus tard)');
          throw new Error(msg);
        }
        // Twelve Data renvoie du plus récent au plus ancien → on inverse.
        return data.values.slice().reverse().map(function (v) {
          return {
            time: new Date(v.datetime).getTime(),
            open: +v.open, high: +v.high, low: +v.low, close: +v.close,
            volume: v.volume != null ? +v.volume : 0
          };
        });
      });
  }

  // --- Routeur ----------------------------------------------------------------
  function fetchCandles(sym, interval, limit) {
    var m = meta(sym);
    if (!m) return Promise.reject(new Error('Paire non prise en charge'));
    return m.provider === 'binance'
      ? fetchBinance(m.src, interval, limit)
      : fetchTwelveData(m.src, interval, limit);
  }

  // --- Données journalières (plus-haut / plus-bas de la veille) ---------------
  // Renvoie { pdh, pdl } = high/low de la bougie journalière PRÉCÉDENTE (veille).
  function fetchDaily(sym) {
    var m = meta(sym);
    if (!m) return Promise.resolve(null);
    var p;
    if (m.provider === 'binance') p = fetchBinance(m.src, '1d', 4);
    else p = fetchTwelveData(m.src, '1day', 4);
    return p.then(function (candles) {
      if (!candles || candles.length < 2) return null;
      var prev = candles[candles.length - 2]; // avant-dernière = veille (la dernière = jour en cours)
      return { pdh: prev.high, pdl: prev.low };
    }).catch(function () { return null; });
  }

  var api = {
    SYMBOLS: SYMBOLS,
    DEFAULT_SYMBOLS: DEFAULT_SYMBOLS,
    meta: meta,
    label: label,
    getApiKey: getApiKey,
    setApiKey: setApiKey,
    fetchCandles: fetchCandles,
    fetchDaily: fetchDaily,
    // conservés pour compat/diagnostic
    fetchBinance: fetchBinance,
    fetchTwelveData: fetchTwelveData
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.API = api;
})(typeof window !== 'undefined' ? window : this);
