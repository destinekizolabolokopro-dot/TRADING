#!/usr/bin/env node
'use strict';
/**
 * Régénère js/mesure.js — l'historique mesuré qu'affiche le site.
 *
 * Même règle de suivi que le robot corrigé (scripts/live_log.js) :
 *   · en bougies de 1 MINUTE quand Yahoo les sert (8 jours glissants) ;
 *   · sinon en 5 minutes, le STOP TESTÉ D'ABORD.
 * L'ancien fichier comptait l'objectif d'abord sur des bougies de 5 minutes,
 * et affichait 80 % de réussite pour un résultat qui, compté honnêtement,
 * est négatif. Voir scripts/BALAYAGE.md.
 *
 *   node scripts/gen_mesure.js [--ghdeb 540] [--ghfin 600]
 */
const fs = require('fs'), path = require('path');
const RACINE = path.resolve(__dirname, '..');
const CACHE = process.env.MECH_CACHE || path.join(RACINE, '.cache');
const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1]; });

async function serie(sym, interval, range) {
  const f = path.join(CACHE, `${sym.replace(/\W/g, '')}_${interval}_${range}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  const r = await fetch(`${YF}${encodeURIComponent(sym)}?interval=${interval}&range=${range}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`${sym} ${interval} : HTTP ${r.status}`);
  const j = await r.json(), res = j.chart.result[0], q = res.indicators.quote[0], out = [];
  for (let i = 0; i < res.timestamp.length; i++) {
    if (q.open[i] == null || q.close[i] == null) continue;
    out.push({ t: res.timestamp[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
  }
  fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(f, JSON.stringify(out));
  return out;
}

function chargerModele() {
  const ctx = {};
  for (const f of ['js/structure.js', 'js/modele.js'])
    new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);
  return ctx.Modele;
}

const COUT_PTS = 0.25 * 2 + 4.00 / 20;

(async () => {
  const M = chargerModele();
  const D = {
    m1: await serie('NQ=F', '1m', '8d'), m2: await serie('NQ=F', '2m', '60d'),
    m5: await serie('NQ=F', '5m', '60d'), m15: await serie('NQ=F', '15m', '60d'),
    h1: await serie('NQ=F', '1h', '6mo'), d1: await serie('NQ=F', '1d', '1y')
  };
  if (args.ghdeb) M.CFG.ghDeb = +args.ghdeb;
  if (args.ghfin) M.CFG.ghFin = +args.ghfin;
  const C = M.CFG;
  const d = M.evaluer(D);
  const m1Debut = D.m1.length ? D.m1[0].t : Infinity;

  const lignes = [];
  for (const s of d.tousSignaux) {
    const fin1m = m1Debut <= s.t;
    const cs = fin1m ? D.m1 : D.m5, maxB = fin1m ? 1000 : 200, pas = fin1m ? 1 : 5;
    const L = s.sens === 'LONG';
    let sl = s.sl, part1 = false, n = 0, r = null, o = null;
    for (const c of cs) {
      if (c.t <= s.t) continue;
      n++;
      const touche = niv => L ? c.h >= niv : c.l <= niv;
      const stoppe = () => L ? c.l <= sl : c.h >= sl;
      if (stoppe())                     { r = part1 ? C.part * C.tp1 : -1; o = part1 ? 'gain partiel' : 'perte'; }
      else if (!part1 && touche(s.tp1))  { part1 = true; sl = s.entree; }
      else if (part1 && touche(s.tp))    { r = C.part * C.tp1 + (1 - C.part) * C.tp2; o = 'gain'; }
      else if (n > maxB)                 { r = part1 ? C.part * C.tp1 : 0; o = part1 ? 'gain partiel' : 'ambigu'; }
      if (r !== null) break;
    }
    if (r === null) continue;
    const e = M.heure(s.t);
    lignes.push([e.jour, e.min, s.sens, s.niveau, fin1m ? '1m' : '5m',
      s.entree, s.sl, s.tp, +(C.part * C.tp1 + (1 - C.part) * C.tp2).toFixed(2),
      +(r - COUT_PTS / s.risq).toFixed(3), r, o, s.t, n * pas]);
  }

  const R = lignes.reduce((a, l) => a + l[9], 0);
  const brut = lignes.reduce((a, l) => a + l[10], 0);
  const g = lignes.filter(l => l[9] > 0).length;
  const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ' h ' + String(m % 60).padStart(2, '0');
  const jours = lignes.map(l => l[0]).sort();

  const tete = `'use strict';
/**
 * HISTORIQUE MESURÉ — les ${lignes.length} signaux que le modèle produit sur les vraies
 * bougies NQ du ${jours[0]} au ${jours[jours.length - 1]}.
 *
 * Fenêtre : ${hm(C.ghDeb)} → ${hm(C.ghFin)} New York.
 *
 * ⚠️ CE NE SONT PAS DES POSITIONS QUI ONT ÉTÉ ENVOYÉES. Ce sont des signaux
 * RECONSTITUÉS a posteriori, au prix de clôture exact de la bougie qui les a
 * déclenchés. Le R affiché est net de frais : 0,25 point de slippage par côté
 * et 4,00 $ de commission, soit 0,70 point par trade.
 *
 * ⚠️ COMPTAGE PRUDENT. Une bougie de 5 minutes ne dit pas dans quel ordre son
 * haut et son bas ont été atteints. Quand elle touche l'objectif ET le stop,
 * ce fichier compte LE STOP. L'ancienne version comptait l'objectif, ce qui
 * donnait 80 % de réussite et un résultat positif ; vérification faite en
 * bougies de 1 minute, cette hypothèse était fausse plus souvent que juste.
 * Les signaux des huit derniers jours sont suivis directement en 1 minute
 * (colonne « tf »), là il n'y a plus d'hypothèse du tout.
 *
 *   ${lignes.length} signaux · ${(g / lignes.length * 100).toFixed(1)} % de réussite
 *   brut ${brut >= 0 ? '+' : ''}${brut.toFixed(2)} R      net ${R >= 0 ? '+' : ''}${R.toFixed(2)} R  (${R >= 0 ? '+' : ''}${Math.round(R * 250)} €)
 *
 * ⚠️ CES CHIFFRES NE SONT PAS REPRODUCTIBLES À L'IDENTIQUE. La profondeur des
 * séries Yahoo est courte et glissante : la même commande relancée deux heures
 * plus tard ne rend pas exactement le même jeu. C'est un CLICHÉ.
 *
 * Régénéré par scripts/gen_mesure.js — ne pas éditer à la main.
 *
 * Colonnes : jour, minute NY, sens, niveau, unité de suivi, entrée, stop,
 *            objectif, RR visé, R net, R brut, sortie, horodatage, durée (min).
 */
var Mesure = (function () {
  var BRUT = [
`;
  const corps = lignes.map(l => '  ' + JSON.stringify(l)).join(',\n');
  const pied = `
  ];
  var CLES = ['jour','minNY','sens','niveau','tf','entry','sl','tp','rr','r','rBrut','sortie','ts','duree'];
  var LISTE = BRUT.map(function (l) {
    var o = {}; CLES.forEach(function (k, i) { o[k] = l[i]; });
    o.source = 'MESURE'; o.symbol = 'NQ'; o.direction = o.sens;
    o.status = 'closed'; o.result = o.r > 0 ? 'win' : 'loss';
    o.motif = o.sortie + ' · suivi en ' + o.tf + ' · ' + o.niveau +
              ' · brut ' + (o.rBrut > 0 ? '+' : '') + o.rBrut + ' R';
    return o;
  });
  function liste() { return LISTE.slice(); }
  return { liste: liste };
})();
if (typeof window !== 'undefined') window.Mesure = Mesure;
`;
  fs.writeFileSync(path.join(RACINE, 'js/mesure.js'), tete + corps + pied);
  console.log(`js/mesure.js régénéré : ${lignes.length} signaux · ${(g / lignes.length * 100).toFixed(1)} % · ` +
    `net ${R >= 0 ? '+' : ''}${R.toFixed(2)} R (${Math.round(R * 250)} €)`);
  console.log(`   dont ${lignes.filter(l => l[4] === '1m').length} suivis en 1 minute (plus aucune hypothèse)`);
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
