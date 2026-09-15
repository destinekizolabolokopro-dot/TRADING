#!/usr/bin/env node
'use strict';
/**
 * Agrège plusieurs marchés sur une même configuration de backtest_pb.js.
 * Un seul marché ne donne pas assez de signaux pour conclure quoi que ce soit :
 * on met en commun six contrats à terme qui suivent la même séance de New York.
 *
 *   node scripts/pool_pb.js -- --biais amd --conf amd,ifvgHaut --ghdeb 09:45
 */
const { execFileSync } = require('child_process');
const MARCHES = (process.env.MARCHES || 'NQ=F,ES=F,YM=F,RTY=F,GC=F,CL=F').split(',');
const passe = process.argv.slice(2).filter(a => a !== '--');

let tous = [];
for (const m of MARCHES) {
  try {
    const out = execFileSync('node', ['scripts/backtest_pb.js', '--sym', m, '--dump', '1', ...passe],
      { encoding: 'utf-8', maxBuffer: 1 << 26 });
    JSON.parse(out).forEach(t => tous.push(Object.assign({ sym: m }, t)));
  } catch (e) { console.error(`  ${m} : ${String(e.message).split('\n')[0]}`); }
}

function stats(a) {
  const n = a.length; if (!n) return null;
  const R = a.reduce((x, y) => x + y.r, 0), moy = R / n;
  const sd = n > 1 ? Math.sqrt(a.reduce((x, y) => x + (y.r - moy) ** 2, 0) / (n - 1)) : 0;
  const se = sd / Math.sqrt(n);
  // DEUX FAÇONS DE COMPTER, et l'écart entre les deux explique tout.
  //  · wr      : gagnants / TOUS les trades — ma convention jusqu'ici.
  //  · wrHorsBE: gagnants / (gagnants + perdants), les trades ramenés au
  //    seuil après prise partielle étant mis de côté. C'est la convention de
  //    la capture de résultats de la source : 83 gains, 19 pertes, 29 « BE »
  //    → 83 / 102 = 81,37 %. Les 29 BE ne sont PAS au dénominateur.
  const g = a.filter(x => x.o === 'gain').length;
  const p = a.filter(x => x.o === 'perte' || x.o === 'ambigu').length;
  const be = a.filter(x => x.o === 'gain partiel').length;
  return { n, moy, R, se, bas: moy - 1.96 * se, haut: moy + 1.96 * se,
    t: se ? moy / se : 0, wr: a.filter(x => x.r > 0).length / n * 100,
    g, p, be, wrHorsBE: (g + p) ? g / (g + p) * 100 : 0 };
}
function ligne(nom, a) {
  const s = stats(a);
  if (!s) { console.log(`  ${nom.padEnd(24)}   aucun signal`); return; }
  console.log(`  ${nom.padEnd(24)} ${String(s.n).padStart(4)} tr  ${s.wr.toFixed(1).padStart(5)} %  ` +
    `hors BE ${s.wrHorsBE.toFixed(1).padStart(5)} % (${s.g}G/${s.p}P/${s.be}BE)  ` +
    `${(s.moy >= 0 ? '+' : '') + s.moy.toFixed(3)} R  t=${s.t.toFixed(2)}` +
    (s.bas > 0 ? '  ✅' : ''));
}

console.log('\n  ' + passe.join(' '));
console.log('  ' + '─'.repeat(70));
ligne('ENSEMBLE', tous);
const jambes = [...new Set(tous.map(x => x.j))].sort();
if (jambes.length > 1) jambes.forEach(j => ligne(`  jambe ${j}`, tous.filter(x => x.j === j)));
// validation : la règle tient-elle sur les deux moitiés de la période ?
const tri = tous.slice().sort((a, b) => (a.d || '').localeCompare(b.d || ''));
const mid = Math.floor(tri.length / 2);
if (tri.length >= 8) { ligne('  1re moitié', tri.slice(0, mid)); ligne('  2e moitié', tri.slice(mid)); }
console.log('');
