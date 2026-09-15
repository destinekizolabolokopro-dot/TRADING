'use strict';
/**
 * FLUX TEMPS RÉEL PAR CFD — OANDA (compte démo gratuit)
 *
 * POURQUOI. Yahoo sert le NQ avec environ 10 minutes de retard : mesuré, pas
 * supposé. Les indices QQQ et ^NDX sont bien en temps réel mais ne le
 * remplacent pas — corrélation des variations en 5 min de 0,92 et 0,91, et
 * l'avantage de la stratégie tombe de +0,262 R à +0,013 R puis −0,075 R.
 *
 * Un CFD « NAS100 » est différent : il n'est pas calculé sur l'indice cash, il
 * est dérivé du FUTURE lui-même et coté 23 h sur 24. Il devrait donc suivre le
 * NQ de bien plus près. « Devrait » : le module fournit `correlation()` pour le
 * VÉRIFIER au lieu de le croire, en comparant au NQ de Yahoo.
 *
 * SÉCURITÉ. L'API d'OANDA autorise l'appel direct depuis le navigateur — elle
 * renvoie `access-control-allow-origin` et accepte l'en-tête `Authorization`.
 * Aucun relais tiers n'est utilisé : le jeton ne transite par personne d'autre
 * qu'OANDA. Il reste dans le localStorage du navigateur et n'est jamais écrit
 * dans le dépôt.
 *
 * Utiliser un compte PRATIQUE (démo). Le jeton d'un compte réel n'a rien à
 * faire dans un navigateur.
 */
var CFD = (function () {

  var API = 'https://api-fxpractice.oanda.com/v3';
  var CLE = 'cfd.oanda.token';
  var INSTR = 'NAS100_USD';
  // Correspondance avec les symboles Yahoo utilisés par le reste du site.
  // Le S&P est gardé : c'est lui qui sert à la divergence SMT.
  var MAP = { 'NQ=F': 'NAS100_USD', 'ES=F': 'SPX500_USD' };

  function token()      { try { return localStorage.getItem(CLE) || ''; } catch (e) { return ''; } }
  function setToken(t)  { try { localStorage.setItem(CLE, (t || '').trim()); } catch (e) {} }
  function actif()      { return !!token(); }

  // OANDA : M1, M2, M5, M15, M30, H1, H4, D
  var GRAN = { '1m': 'M1', '2m': 'M2', '5m': 'M5', '15m': 'M15', '30m': 'M30',
               '60m': 'H1', '1h': 'H1', '4h': 'H4', '1d': 'D' };

  /**
   * Bougies OHLC, au même format que le reste du site : { t, o, h, l, c }.
   * @param interval clé de GRAN
   * @param count    nombre de bougies (max 5000 chez OANDA)
   */
  function candles(interval, count, sym) {
    var tk = token();
    if (!tk || typeof fetch === 'undefined') return Promise.resolve(null);
    var inst = sym ? MAP[sym] : INSTR;
    if (!inst) return Promise.resolve(null);          // symbole sans équivalent CFD
    var g = GRAN[interval] || 'M5';
    var u = API + '/instruments/' + inst + '/candles?granularity=' + g +
            '&count=' + (count || 500) + '&price=M';
    return fetch(u, { headers: { 'Authorization': 'Bearer ' + tk,
                                 'Accept-Datetime-Format': 'UNIX' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        if (!j || !j.candles) return null;
        var out = [];
        j.candles.forEach(function (c) {
          // `complete: false` = bougie en cours. On l'écarte : toutes les
          // décisions du modèle se prennent sur clôture.
          if (!c.complete || !c.mid) return;
          out.push({ t: Math.round(parseFloat(c.time) * 1000),
                     o: +c.mid.o, h: +c.mid.h, l: +c.mid.l, c: +c.mid.c });
        });
        return out.length ? out : null;
      })
      .catch(function () { return null; });
  }

  /** Âge de la dernière bougie close, en minutes. */
  function fraicheur(cs) {
    if (!cs || !cs.length) return null;
    return Math.round((Date.now() - cs[cs.length - 1].t) / 60000);
  }

  /**
   * Corrélation des VARIATIONS entre le CFD et le NQ de Yahoo, sur les bougies
   * de même horodatage. C'est la mesure qui décide si ce flux est utilisable :
   * QQQ donnait 0,924 et ce n'était pas assez.
   * @return { n, r, ratio } ou null
   */
  function correlation(cfdCs, nqCs) {
    if (!cfdCs || !nqCs) return null;
    var m = {}; nqCs.forEach(function (x) { m[x.t] = x.c; });
    var pa = [], pb = [];
    cfdCs.forEach(function (x) { if (m[x.t] != null) { pa.push(x.c); pb.push(m[x.t]); } });
    if (pa.length < 30) return null;
    var ra = [], rb = [];
    for (var i = 1; i < pa.length; i++) { ra.push(pa[i] / pa[i - 1] - 1); rb.push(pb[i] / pb[i - 1] - 1); }
    var moy = function (v) { return v.reduce(function (a, b) { return a + b; }, 0) / v.length; };
    var ma = moy(ra), mb = moy(rb), cov = 0, sa = 0, sb = 0;
    for (var k = 0; k < ra.length; k++) {
      cov += (ra[k] - ma) * (rb[k] - mb); sa += Math.pow(ra[k] - ma, 2); sb += Math.pow(rb[k] - mb, 2);
    }
    var r = (sa > 0 && sb > 0) ? cov / Math.sqrt(sa * sb) : null;
    return { n: pa.length, r: r,
             ratio: pb[pb.length - 1] / pa[pa.length - 1] };   // NQ / CFD : la base
  }

  /** Vérifie que le jeton fonctionne et renvoie un diagnostic lisible. */
  function tester() {
    if (!actif()) return Promise.resolve({ ok: false, msg: 'Aucun jeton enregistré.' });
    return candles('5m', 60).then(function (cs) {
      if (!cs) return { ok: false, msg: 'Jeton refusé ou instrument indisponible.' };
      var age = fraicheur(cs);
      return { ok: true, n: cs.length, age: age, prix: cs[cs.length - 1].c,
               msg: cs.length + ' bougies · dernière close il y a ' + age + ' min · ' + cs[cs.length - 1].c };
    });
  }

  return { actif: actif, token: token, setToken: setToken, candles: candles,
           fraicheur: fraicheur, correlation: correlation, tester: tester,
           INSTR: INSTR, MAP: MAP };
})();
if (typeof window !== 'undefined') window.CFD = CFD;
