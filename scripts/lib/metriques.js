'use strict';
/**
 * Métriques communes à toutes les versions du modèle.
 *
 * Volontairement SÉPARÉ des moteurs de backtest : une version gelée ne doit
 * jamais être rouverte pour ajouter une mesure. Chaque moteur écrit un journal
 * de trades, ce module le lit.
 *
 * Modèle de coûts — appliqué APRÈS coup, sur le R de chaque trade :
 *
 *   coût en points = slippage × 2 (entrée + sortie) + commission / valeur du point
 *   coût en R      = coût en points / risque du trade en points
 *
 * Un trade dont le stop est serré coûte donc proportionnellement plus cher,
 * ce qui est la réalité et que les backtests oublient presque toujours.
 */

// NQ : 1 point = 20 $, 1 tick = 0,25 point.
const DEFAUTS = { pointval: 20, slip: 0.25, comm: 4.00, risque: 500 };

function coutR(trade, o) {
  const c = Object.assign({}, DEFAUTS, o || {});
  if (!trade.risq || trade.risq <= 0) return 0;
  const pts = c.slip * 2 + c.comm / c.pointval;
  return pts / trade.risq;
}

/** Applique les coûts et renvoie une copie des trades avec `rnet`. */
function appliquerCouts(trades, o) {
  return trades.map(t => Object.assign({}, t, { rnet: t.r - coutR(t, o) }));
}

function maxDrawdown(serie) {          // serie = suite de R cumulés
  let pic = 0, dd = 0, cum = 0;
  for (const r of serie) { cum += r; if (cum > pic) pic = cum; if (pic - cum > dd) dd = pic - cum; }
  return dd;
}

/**
 * @param trades  journal, chaque entrée porte au moins { r, sens, risq, o }
 * @param o       { pointval, slip, comm, risque, brut }
 */
function metriques(trades, o) {
  const c = Object.assign({}, DEFAUTS, o || {});
  const T = c.brut ? trades.map(t => Object.assign({}, t, { rnet: t.r })) : appliquerCouts(trades, c);
  const n = T.length;
  if (!n) return null;

  const R    = T.reduce((a, x) => a + x.rnet, 0);
  const moy  = R / n;
  const sd   = n > 1 ? Math.sqrt(T.reduce((a, x) => a + (x.rnet - moy) ** 2, 0) / (n - 1)) : 0;
  const se   = sd / Math.sqrt(n);
  const pos  = T.filter(x => x.rnet > 0), neg = T.filter(x => x.rnet < 0);
  const gains = pos.reduce((a, x) => a + x.rnet, 0);
  const pertes = Math.abs(neg.reduce((a, x) => a + x.rnet, 0));

  // Convention de la source : les trades ramenés au seuil sortent du calcul.
  const g  = T.filter(x => x.o === 'gain').length;
  const p  = T.filter(x => x.o === 'perte' || x.o === 'ambigu').length;
  const be = T.filter(x => x.o === 'gain partiel').length;

  return {
    n,
    gagnants: pos.length,
    perdants: neg.length,
    wr: pos.length / n * 100,
    wrHorsBE: (g + p) ? g / (g + p) * 100 : 0,
    detail: { g, p, be },
    avgR: T.reduce((a, x) => a + (x.rr || 0), 0) / n,   // RR visé moyen
    esperance: moy,
    sd, se,
    ic: [moy - 1.96 * se, moy + 1.96 * se],
    largeurIC: 2 * 1.96 * se,
    t: se ? moy / se : 0,
    pf: pertes > 0 ? gains / pertes : (gains > 0 ? Infinity : 0),
    maxDD: maxDrawdown(T.map(x => x.rnet)),
    cumulR: R,
    pnl: R * c.risque,
    maxDDdollars: maxDrawdown(T.map(x => x.rnet)) * c.risque,
    coutMoyen: c.brut ? 0 : T.reduce((a, x) => a + (x.r - x.rnet), 0) / n
  };
}

/** Découpe le journal selon une fonction de clé et renvoie les métriques de chaque groupe. */
function parGroupe(trades, cle, o) {
  const g = {};
  trades.forEach(t => { const k = cle(t); (g[k] = g[k] || []).push(t); });
  const out = {};
  Object.keys(g).sort().forEach(k => out[k] = metriques(g[k], o));
  return out;
}

module.exports = { metriques, parGroupe, appliquerCouts, coutR, maxDrawdown, DEFAUTS };
