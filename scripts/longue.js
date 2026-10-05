'use strict';
/**
 * LE JEU LONGUE PÉRIODE — scripts/longue.js
 *
 * POURQUOI CE FICHIER. Yahoo ne sert le 5 minutes que sur 60 jours. Vérifié
 * à nouveau le 4 octobre 2026, intervalle par intervalle :
 *
 *     5m  60d   →  69 jours        30m 60d  →  69 jours
 *     1h  2y    →  721 jours       1d  5y   →  1260 jours
 *
 * La seule porte vers une longue période intraday est donc le 1 HEURE, sur
 * deux ans. C'est douze fois plus grossier que l'unité d'exécution habituelle,
 * et il faut le dire sans détour :
 *
 *   — une bougie d'une heure contient beaucoup plus souvent À LA FOIS le stop
 *     et l'objectif. Le comptage prudent (le stop compte) s'applique, donc le
 *     résultat est pessimiste, mais l'incertitude est réelle et grande ;
 *   — l'IFVG d'entrée est lu sur des bougies d'une heure : l'entrée est donc
 *     en moyenne une demi-heure plus tard que dans la version 5 minutes ;
 *   — ce test ne valide pas la stratégie telle qu'elle se trade. Il répond à
 *     une autre question, plus modeste et plus utile : L'IDÉE tient-elle sur
 *     deux ans, ou seulement sur les soixante jours que je peux voir finement ?
 */
const fs = require('fs'), path = require('path');
const RACINE = path.resolve(__dirname, '..');
const CACHE = path.join(RACINE, '.cache-longue');
const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const dodo = ms => new Promise(r => setTimeout(r, ms));

// Les séries de la longue période. Le 1 heure est l'unité d'EXÉCUTION ; le
// 4 heures en est agrégé ; le journalier sert aux repères de séance.
const SERIES = [
  { interval: '1h', range: '2y', cle: 'h1' },
  { interval: '1d', range: '5y', cle: 'd1' }
];

async function charger(sym, interval, range) {
  const f = path.join(CACHE, `${sym.replace(/\W/g, '')}_${interval}_${range}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  for (let k = 0; k < 6; k++) {
    try {
      const r = await fetch(`${YF}${encodeURIComponent(sym)}?interval=${interval}&range=${range}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } });
      // Le relais renvoie 429 quand on insiste : on attend de plus en plus.
      if (r.status === 429) { await dodo(3000 * (k + 1)); continue; }
      const j = await r.json();
      if (j.chart.error) throw new Error(j.chart.error.description || j.chart.error.code);
      const res = j.chart.result[0], q = res.indicators.quote[0], out = [];
      for (let i = 0; i < res.timestamp.length; i++) {
        if (q.open[i] == null || q.high[i] == null || q.low[i] == null || q.close[i] == null) continue;
        out.push({ t: res.timestamp[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      }
      fs.mkdirSync(CACHE, { recursive: true });
      fs.writeFileSync(f, JSON.stringify(out));
      return out;
    } catch (e) { await dodo(2000 * (k + 1)); }
  }
  return null;
}

async function jeu(syms) {
  const PS = {};
  for (const sym of syms) {
    const S = {};
    for (const s of SERIES) {
      S[s.cle] = await charger(sym, s.interval, s.range);
      await dodo(1200);
    }
    if (S.h1 && S.h1.length > 500) PS[sym] = S;
  }
  return PS;
}

module.exports = { jeu, charger, SERIES, CACHE };

if (require.main === module) {
  const syms = (process.argv.find(a => a.startsWith('--marches=')) || '--marches=NQ,ES')
    .slice(10).split(',').map(x => x.trim().toUpperCase() + '=F');
  jeu(syms).then(PS => {
    const f = t => new Date(t).toISOString().slice(0, 10);
    for (const sym of Object.keys(PS)) {
      const S = PS[sym];
      for (const k of ['h1', 'd1'])
        console.log(`${sym.padEnd(6)} ${k} : ${String(S[k].length).padStart(6)} bougies · ${f(S[k][0].t)} → ${f(S[k][S[k].length-1].t)}`);
    }
    if (!Object.keys(PS).length) console.log('aucune série récupérée');
  });
}
