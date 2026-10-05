'use strict';
/**
 * RAFRAÎCHIR LE CACHE — scripts/rafraichir.js
 *
 * POURQUOI CE FICHIER EXISTE. Le 4 octobre 2026, la même stratégie inchangée
 * annonçait 113 trades / −492 € le matin et 142 trades / −2 966 € l'après-midi.
 * Le cache avait été rafraîchi À MOITIÉ : NQ et ES allaient jusqu'au 2 octobre,
 * YM et RTY s'arrêtaient au 30 septembre. Toutes les comparaisons entre marchés
 * portaient donc sur des périodes différentes sans que rien ne le dise.
 *
 * CE SCRIPT EST TOUT OU RIEN. Il télécharge l'ensemble des séries dans un
 * dossier temporaire et ne les installe dans .cache QUE si TOUTES ont été
 * obtenues. Un échec partiel ne touche pas le cache en place : mieux vaut des
 * données vieilles et cohérentes que des données fraîches et décalées.
 *
 *   node scripts/rafraichir.js                 les quatre indices
 *   node scripts/rafraichir.js --marches=NQ,ES
 */
const fs = require('fs'), path = require('path');
const RACINE = path.resolve(__dirname, '..');
const CACHE = process.env.MECH_CACHE || path.join(RACINE, '.cache');
const TMP = path.join(RACINE, '.cache-neuf');
const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const ctx = {};
for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js'])
  new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);
const { Modele } = ctx;

const dodo = ms => new Promise(r => setTimeout(r, ms));
// Le pas de chaque série, en millisecondes : il sert à reconnaître la
// pseudo-bougie de cotation en cours.
const PAS = { '1m': 60000, '2m': 120000, '5m': 300000, '15m': 900000,
              '30m': 1800000, '1h': 3600000, '1d': 86400000 };
let coupees = 0;
const DEM = (process.argv.find(a => a.startsWith('--marches=')) || '').slice(10);
const SYMS = DEM ? DEM.split(',').map(x => x.trim().toUpperCase() + '=F')
                 : ['NQ=F', 'ES=F', 'YM=F', 'RTY=F'];
// Le taux de change voyage avec le reste : il est lu par le site.
const EXTRA = [{ sym: 'EURUSD=X', interval: '1d', range: '5d' }];

async function un(sym, interval, range) {
  // Yahoo renvoie 429 quand on insiste : on attend de plus en plus longtemps.
  for (let k = 0; k < 6; k++) {
    try {
      const r = await fetch(`${YF}${encodeURIComponent(sym)}?interval=${interval}&range=${range}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.status === 429) { await dodo(3000 * (k + 1)); continue; }
      const j = await r.json();
      if (j.chart.error) return { err: j.chart.error.description || j.chart.error.code };
      const res = j.chart.result[0], q = res.indicators.quote[0], out = [];
      for (let i = 0; i < res.timestamp.length; i++) {
        if (q.open[i] == null || q.high[i] == null || q.low[i] == null || q.close[i] == null) continue;
        out.push({ t: res.timestamp[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
      }
      if (!out.length) return { err: 'série vide' };

      // ⚠️ LA COTATION EN COURS N'EST PAS UNE BOUGIE. Yahoo ajoute en fin de
      // série une pseudo-bougie qui porte le prix de l'instant : son haut, son
      // bas et sa clôture sont ceux d'un instant, pas d'une période. Rafraîchir
      // pendant les heures de marché la faisait donc entrer dans le cache, où
      // les backtests la lisaient comme une bougie close — avec une mèche
      // tronquée et une clôture arbitraire.
      //
      // Sa signature est un espacement franchement plus court que le pas de la
      // série. C'est exactement le contrôle que scripts/test.js applique au
      // cache, et il a pris ce script en défaut dès son premier usage.
      const pas = PAS[interval];
      if (pas && out.length >= 3) {
        const d = out[out.length - 1].t - out[out.length - 2].t;
        if (d > 0 && d < pas * 0.9) { out.pop(); coupees++; }
      }
      return { out };
    } catch (e) { await dodo(2000 * (k + 1)); }
  }
  return { err: 'injoignable après six essais' };
}

(async () => {
  const taches = [];
  for (const sym of SYMS) for (const s of Modele.SERIES)
    taches.push({ sym, interval: s.interval, range: s.range });
  for (const e of EXTRA) taches.push(e);

  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  const j = t => new Date(t).toISOString().slice(0, 10);
  const echecs = [];
  console.log(`\nTéléchargement de ${taches.length} séries…\n`);
  for (const t of taches) {
    const r = await un(t.sym, t.interval, t.range);
    const nom = `${t.sym.replace(/\W/g, '')}_${t.interval}_${t.range}.json`;
    if (r.err) {
      echecs.push(`${t.sym} ${t.interval}/${t.range} : ${r.err}`);
      console.log(`  ❌ ${nom.padEnd(26)} ${r.err}`);
    } else {
      fs.writeFileSync(path.join(TMP, nom), JSON.stringify(r.out));
      console.log(`  ✅ ${nom.padEnd(26)} ${String(r.out.length).padStart(6)} bougies · ` +
        `${j(r.out[0].t)} → ${j(r.out[r.out.length - 1].t)}`);
    }
    await dodo(900);
  }

  if (echecs.length) {
    fs.rmSync(TMP, { recursive: true, force: true });
    console.error(`\n❌ ${echecs.length} série(s) manquante(s) — LE CACHE N'A PAS ÉTÉ TOUCHÉ.`);
    echecs.forEach(e => console.error('   ' + e));
    console.error('\n   Un cache rafraîchi à moitié fait comparer des périodes différentes');
    console.error('   sans que rien ne le dise. On préfère des données vieilles et');
    console.error('   cohérentes à des données fraîches et décalées.');
    process.exit(1);
  }

  // Installation en bloc : on ne remplace qu'une fois tout obtenu.
  fs.mkdirSync(CACHE, { recursive: true });
  for (const f of fs.readdirSync(TMP))
    fs.renameSync(path.join(TMP, f), path.join(CACHE, f));
  fs.rmSync(TMP, { recursive: true, force: true });

  // Le contrôle qui aurait évité le bug : toutes les séries m5 couvrent-elles
  // bien la même fin de période ?
  const fins = SYMS.map(sym => {
    const f = path.join(CACHE, `${sym.replace(/\W/g, '')}_5m_60d.json`);
    if (!fs.existsSync(f)) return null;
    const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return { sym, fin: d[d.length - 1].t };
  }).filter(Boolean);
  const ecart = Math.max(...fins.map(x => x.fin)) - Math.min(...fins.map(x => x.fin));
  console.log(`\n✅ ${taches.length} séries installées dans ${path.relative(RACINE, CACHE)}/`);
  if (coupees) console.log(`   ${coupees} cotation(s) en cours retirée(s) : le marché était ouvert.`);
  console.log(`   dernières bougies 5 min : ${fins.map(x => x.sym + ' ' + j(x.fin)).join(' · ')}`);
  console.log(ecart > 36e5
    ? `   ⚠️  ${Math.round(ecart / 36e5)} h d'écart entre marchés — la période commune sera rognée d'autant.`
    : `   toutes à moins d'une heure l'une de l'autre.`);
})();
