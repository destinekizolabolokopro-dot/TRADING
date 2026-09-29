#!/usr/bin/env node
'use strict';
/**
 * LES BOUGIES FIGÉES — le jeu de données sur lequel la référence est calculée.
 *
 * La référence portait sur le cache vivant. Elle échouait donc CHAQUE JOUR,
 * parce que la fenêtre de Yahoo glisse : un test qui crie au loup tous les
 * matins ne sert plus à rien, on finit par l'ignorer. Or c'est exactement le
 * test qui doit attraper « le modèle ne produit plus la même chose ».
 *
 * Les bougies sont donc gelées dans data/fixture.json. Un écart de résultat ne
 * peut alors venir que du CODE, jamais des données. C'est la différence entre
 * une alarme utile et un bruit de fond.
 *
 *   node scripts/fixture.js          reconstruit le jeu figé (geste délibéré)
 *
 * Le jeu est volontairement court — huit jours de bourse, la profondeur du
 * 1 minute chez Yahoo — pour rester léger dans le dépôt tout en produisant
 * assez de signaux pour que l'empreinte ait du sens.
 */
const fs = require('fs'), path = require('path');
const RACINE = path.resolve(__dirname, '..');
const SORTIE = path.join(RACINE, 'data', 'fixture.json');
const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';

function chargerModele() {
  const ctx = {};
  for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js'])
    new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);
  return ctx.Modele;
}

async function serie(sym, interval, range) {
  const r = await fetch(`${YF}${encodeURIComponent(sym)}?interval=${interval}&range=${range}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`${sym} ${interval} : HTTP ${r.status}`);
  const j = await r.json(), R = j.chart.result[0], q = R.indicators.quote[0], out = [];
  for (let i = 0; i < R.timestamp.length; i++) {
    if (q.open[i] == null || q.close[i] == null) continue;
    out.push([R.timestamp[i], q.open[i], q.high[i], q.low[i], q.close[i]]);
  }
  return out;
}

(async () => {
  const M = chargerModele();
  // Huit jours de bourse : la profondeur du 1 minute chez Yahoo, donc la
  // limite naturelle du jeu. Le journalier est gardé en entier, il est minuscule
  // et le biais en a besoin loin en arrière.
  const LIMITE = Date.now() / 1000 - 12 * 86400;
  const fixture = { fige: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
                    note: 'Bougies gelées. Reconstruit à la main par scripts/fixture.js.',
                    NQ: {}, ES: {} };
  for (const x of M.SERIES) {
    const cs = await serie('NQ=F', x.interval, x.range);
    fixture.NQ[x.cle] = x.cle === 'd1' ? cs : cs.filter(c => c[0] >= LIMITE);
    process.stdout.write(`  NQ ${x.interval.padEnd(4)} ${String(fixture.NQ[x.cle].length).padStart(6)} bougies\n`);
  }
  for (const x of M.SERIES2) {
    const cs = await serie('ES=F', x.interval, x.range);
    fixture.ES[x.cle] = x.cle === 'd1' ? cs : cs.filter(c => c[0] >= LIMITE);
    process.stdout.write(`  ES ${x.interval.padEnd(4)} ${String(fixture.ES[x.cle].length).padStart(6)} bougies\n`);
  }
  fs.writeFileSync(SORTIE, JSON.stringify(fixture));
  const ko = Math.round(fs.statSync(SORTIE).size / 1024);
  console.log(`\ndata/fixture.json écrit — ${ko} Ko`);
  console.log('Penser à régénérer la référence : node scripts/reference.js --ecrire');
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
