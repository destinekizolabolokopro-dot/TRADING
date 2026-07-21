/*
 * Couche données — API publique Binance
 * --------------------------------------
 * Récupère les bougies (klines) en temps réel, sans clé API ni serveur.
 * Endpoint public, compatible CORS navigateur.
 * Docs : https://binance-docs.github.io/apidocs/spot/en/#kline-candlestick-data
 */
(function (root) {
  'use strict';

  // Plusieurs hôtes en secours si l'un est bloqué géographiquement.
  var HOSTS = [
    'https://api.binance.com',
    'https://api1.binance.com',
    'https://api.binance.us',
    'https://data-api.binance.vision'
  ];

  var REQUEST_TIMEOUT = 8000; // ms — évite qu'un hôte injoignable bloque l'app

  // fetch avec délai maximal : rejette si l'hôte ne répond pas à temps.
  function fetchWithTimeout(url) {
    if (typeof AbortController === 'undefined') return fetch(url);
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT);
    return fetch(url, { signal: ctrl.signal }).finally(function () { clearTimeout(t); });
  }

  function parseKlines(raw) {
    return raw.map(function (k) {
      return {
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      };
    });
  }

  // Essaie chaque hôte jusqu'à obtenir une réponse valide.
  function fetchKlines(symbol, interval, limit) {
    limit = limit || 200;
    var path = '/api/v3/klines?symbol=' + symbol + '&interval=' + interval + '&limit=' + limit;

    function tryHost(i) {
      if (i >= HOSTS.length) {
        return Promise.reject(new Error('Tous les hôtes Binance sont injoignables'));
      }
      return fetchWithTimeout(HOSTS[i] + path)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (data) {
          if (!Array.isArray(data)) throw new Error('Réponse inattendue');
          return parseKlines(data);
        })
        .catch(function () {
          return tryHost(i + 1);
        });
    }
    return tryHost(0);
  }

  // Prix 24h / variation, pour l'affichage (facultatif).
  function fetchTicker(symbol) {
    var path = '/api/v3/ticker/24hr?symbol=' + symbol;
    function tryHost(i) {
      if (i >= HOSTS.length) return Promise.resolve(null);
      return fetchWithTimeout(HOSTS[i] + path)
        .then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .catch(function () { return tryHost(i + 1); });
    }
    return tryHost(0);
  }

  var api = { fetchKlines: fetchKlines, fetchTicker: fetchTicker, HOSTS: HOSTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.API = api;
})(typeof window !== 'undefined' ? window : this);
