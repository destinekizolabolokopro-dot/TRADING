'use strict';
/**
 * QUELLE LIQUIDITÉ VAUT QUELQUE CHOSE ? — scripts/liquidite.js
 *
 * POURQUOI. Le découpage BSL / SSL a montré un trou précis : 43 achats dont
 * la liquidité visée n'est JAMAIS atteinte, réussite 51 %, −3 460 €. Une
 * pièce lancée en l'air. Le modèle choisit sa cible (`dolNiveau`) de la façon
 * la plus simple possible : le swing H1 intact LE PLUS PROCHE dans le sens du
 * biais. La proximité est son seul critère. Rien sur la QUALITÉ du bassin.
 *
 * CE QUE LA LITTÉRATURE ICT DIT DE LA QUALITÉ D'UN BASSIN — et que le modèle
 * ignore entièrement :
 *
 *   1. LES SOMMETS RELATIVEMENT ÉGAUX (Relative Equal Highs). Deux sommets au
 *      même prix à quelques ticks près signalent une liquidité « ingénierée » :
 *      beaucoup de stops empilés au même endroit. Décrit comme l'aimant le
 *      plus puissant de la méthode.
 *   2. LA VISIBILITÉ EN UNITÉ SUPÉRIEURE. Le haut de la veille (PDH) ou de la
 *      semaine passée (PWH) est regardé par tout le monde ; un swing H1
 *      intraday ne l'est que par ceux qui ont ce graphique ouvert.
 *   3. LES EXTRÊMES DE SÉANCE (Asie, Londres) comptent plus qu'un swing mineur.
 *
 * CE SCRIPT NE CHANGE PAS LE MODÈLE. Il classe la cible que le modèle a déjà
 * choisie selon ces trois critères, et mesure. Si la qualité du bassin trie
 * les résultats, alors il y a une règle à ajouter — et on saura laquelle.
 */
const J = require('./lib/jeu.js');
const { Modele, Position } = J.contexte();
const RISQUE = +(process.env.RISQUE_EUR || 250);

Object.assign(Modele.CFG, { slx: 4, ghDeb: 8 * 60, ghFin: 10 * 60,
  part: 0.9, tp1: 0.4, tp2: 2.5, sortieMin: 16 * 60 });

// Le pas de cotation réel de chaque contrat. « À quelques ticks près » veut
// dire QUELQUES TICKS : une tolérance en pourcentage du prix donnait 12 points
// sur le Nasdaq, et à ce compte-là tous les sommets sont égaux — la première
// version de ce script classait 168 trades sur 168 en « sommets empilés »,
// c'est-à-dire ne mesurait rien.
const TICK = { 'NQ=F': 0.25, 'ES=F': 0.25, 'YM=F': 1, 'RTY=F': 0.1 };
const TICKS_TOL = 4;

const PS = {};
for (const s of ['NQ=F', 'ES=F', 'YM=F', 'RTY=F']) {
  const S = J.lireMarche(s, Modele.SERIES); if (S.m5 && S.m5.length > 80) PS[s] = S;
}
const AL = J.aligner(Object.keys(PS).map(sym => ({ sym, S: PS[sym] })));
for (const l of J.banniere(AL, Object.keys(PS).map(sym => ({ sym, S: PS[sym] })))) console.log(l);

// ── les bassins de référence, par marché ──────────────────────────────────
// Construits UNIQUEMENT à partir de bougies déjà closes avant l'instant du
// signal : un bassin daté d'après le trade n'existe pas pour le trader.
function reperes(S) {
  const parJour = {}, parSem = {}, sess = {};
  for (const b of S.m5) {
    const e = Modele.heure(b.t);
    const j = e.jour;
    (parJour[j] = parJour[j] || { h: -Infinity, l: Infinity, fin: 0 });
    parJour[j].h = Math.max(parJour[j].h, b.h);
    parJour[j].l = Math.min(parJour[j].l, b.l);
    parJour[j].fin = Math.max(parJour[j].fin, b.t);
    // semaine ISO approximée par le lundi précédent
    const d = new Date(b.t), lundi = new Date(d);
    lundi.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const k = lundi.toISOString().slice(0, 10);
    (parSem[k] = parSem[k] || { h: -Infinity, l: Infinity, fin: 0 });
    parSem[k].h = Math.max(parSem[k].h, b.h);
    parSem[k].l = Math.min(parSem[k].l, b.l);
    parSem[k].fin = Math.max(parSem[k].fin, b.t);
    // séances : Asie 20h-00h NY, Londres 02h-05h NY
    const nom = e.min >= 20 * 60 ? 'asie' : e.min < 2 * 60 ? 'asie'
              : (e.min >= 2 * 60 && e.min < 5 * 60) ? 'londres' : null;
    if (nom) {
      const cle = j + '/' + nom;
      (sess[cle] = sess[cle] || { h: -Infinity, l: Infinity, fin: 0, jour: j, nom });
      sess[cle].h = Math.max(sess[cle].h, b.h);
      sess[cle].l = Math.min(sess[cle].l, b.l);
      sess[cle].fin = Math.max(sess[cle].fin, b.t);
    }
  }
  return { parJour, parSem, sess };
}

// Un prix correspond-il à un repère connu AVANT t, à la tolérance près ?
function colle(prix, ref, tol) { return ref != null && isFinite(ref) && Math.abs(prix - ref) <= tol; }

function classer(R, S, prix, t, haut, tol) {
  const etiquettes = [];
  // haut/bas de la veille : le dernier jour entièrement clos avant t
  const jours = Object.keys(R.parJour).filter(j => R.parJour[j].fin < t).sort();
  const veille = jours.length ? R.parJour[jours[jours.length - 1]] : null;
  if (veille && colle(prix, haut ? veille.h : veille.l, tol)) etiquettes.push(haut ? 'PDH' : 'PDL');
  // haut/bas de la semaine passée
  const sems = Object.keys(R.parSem).filter(k => R.parSem[k].fin < t).sort();
  const semPrec = sems.length ? R.parSem[sems[sems.length - 1]] : null;
  if (semPrec && colle(prix, haut ? semPrec.h : semPrec.l, tol)) etiquettes.push(haut ? 'PWH' : 'PWL');
  // extrême de séance Asie ou Londres, même journée
  for (const cle of Object.keys(R.sess)) {
    const s = R.sess[cle];
    if (s.fin >= t) continue;
    if (colle(prix, haut ? s.h : s.l, tol)) etiquettes.push(s.nom === 'asie' ? 'Asie' : 'Londres');
  }
  return [...new Set(etiquettes)];
}

// Sommets relativement égaux : combien de swings H1 intacts partagent ce prix ?
function empiles(S, prix, t, haut, tol, cache) {
  const ST = require('./lib/structure.js');
  const h1 = S.h1.filter(b => b.t < t);
  if (h1.length < 10) return 0;
  // La hiérarchie est coûteuse : une seule par instant de signal.
  const cle = h1.length;
  let hier = cache[cle];
  if (!hier) hier = cache[cle] = ST.hierarchie(h1);
  const liste = haut ? hier.sth : hier.stl;
  let n = 0;
  for (const sw of liste)
    if (sw.vu != null && sw.vu < t && Math.abs(sw.prix - prix) <= tol) n++;
  // Le bassin visé EST l'un de ces sommets : il faut donc au moins DEUX
  // comptages pour parler de sommets relativement égaux.
  return n;
}

// ── rejouer et classer ────────────────────────────────────────────────────
const T = [];
for (const [sym, cf] of [['NQ=F', 'ES=F'], ['ES=F', 'NQ=F'], ['YM=F', 'ES=F'], ['RTY=F', 'ES=F']]) {
  if (!PS[sym]) continue;
  const S = PS[sym], R = reperes(S), cacheH = {};
  for (const s of Modele.evaluer(S, PS[cf]).tousSignaux) {
    if (!J.jouable(sym, Math.abs(s.risq), RISQUE)) continue;
    const m1 = S.m1, f1 = m1 && m1.length && m1[0].t <= s.t, cs = f1 ? m1 : S.m5;
    let fin;
    try {
      fin = Position.suivre(s, cs, Modele.CFG, { prudent: true, maxBarres: f1 ? 1000 : 200,
        depuis: s.t, heure: Modele.heure, jourSignal: Modele.heure(s.t).jour });
    } catch (e) { continue; }
    if (!fin || fin.ouverte || s.dol == null) continue;
    const L = s.sens === 'LONG', risq = Math.abs(s.risq);
    const tol = (TICK[sym] || 0.25) * TICKS_TOL;
    let touchee = false, n = 0;
    for (const b of cs) {
      if (b.t < s.t) continue; if (++n > (f1 ? 1000 : 200)) break;
      if (L ? b.h >= s.dol : b.l <= s.dol) { touchee = true; break; }
      if (L ? b.l <= s.sl : b.h >= s.sl) break;
    }
    T.push({ sym, r: fin.r - Position.cout(s.risq), L, touchee,
             etiq: classer(R, S, s.dol, s.t, L, tol),
             emp: empiles(S, s.dol, s.t, L, tol, cacheH) });
  }
}

const eu = v => (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)) + ' €';
function ligne(nom, g) {
  if (!g.length) { console.log(`  ${nom.padEnd(30)} —`); return; }
  const som = g.reduce((a, x) => a + x.r, 0), w = g.filter(x => x.r > 0).length;
  console.log(`  ${nom.padEnd(30)} ${String(g.length).padStart(4)} · ${(w / g.length * 100).toFixed(1).padStart(5)} % · ` +
    `${eu(som / g.length * RISQUE).padStart(7)}/trade · ${eu(som * RISQUE).padStart(9)}`);
}

console.log(`\n${T.length} trades classés\n`);
for (const [cote, f] of [['BSL (achats)', x => x.L], ['SSL (ventes)', x => !x.L]]) {
  const G = T.filter(f);
  console.log(`── ${cote} · ${G.length} trades`);
  ligne('visibilité HTF (PDH/PWH…)', G.filter(x => x.etiq.length > 0));
  ligne('  dont haut/bas de la veille', G.filter(x => x.etiq.includes('PDH') || x.etiq.includes('PDL')));
  ligne('  dont semaine passée', G.filter(x => x.etiq.includes('PWH') || x.etiq.includes('PWL')));
  ligne('  dont extrême de séance', G.filter(x => x.etiq.includes('Asie') || x.etiq.includes('Londres')));
  ligne('AUCUNE visibilité HTF', G.filter(x => x.etiq.length === 0));
  ligne('sommets égaux (≥2 empilés)', G.filter(x => x.emp >= 2));
  ligne('un seul sommet', G.filter(x => x.emp === 1));
  ligne('aucun sommet H1 dessus', G.filter(x => x.emp === 0));
  console.log('');
}
console.log('── LA RÈGLE CANDIDATE DE LA LITTÉRATURE : exiger un bassin de qualité');
ligne('qualité (HTF ou ≥2 empilés)', T.filter(x => x.etiq.length > 0 || x.emp >= 2));
ligne('sans qualité', T.filter(x => x.etiq.length === 0 && x.emp < 2));
ligne('tout', T);
console.log('   → la règle de la littérature DÉGRADE le résultat : elle garde');
console.log('     les trades à +14 € et jette ceux à +38 €.');

// ── CE QUE LA MESURE DÉSIGNE VRAIMENT ────────────────────────────────────
// Une seule case concentre presque toute la perte : acheter vers le haut de
// la veille. 30 trades, 56,7 %, −1 815 € — alors que la perte totale du côté
// achat est de −1 510 €. Sans cette case, le côté achat devient positif.
const estPDHAchat = x => x.L && x.etiq.includes('PDH');
console.log('\n── LA CASE QUI SAIGNE : ACHETER VERS LE HAUT DE LA VEILLE');
ligne('achat → haut de la veille', T.filter(estPDHAchat));
ligne('vente → bas de la veille', T.filter(x => !x.L && x.etiq.includes('PDL')));
console.log('   L\'inverse est sain : le bas de la veille marche à la vente.');

console.log('\n── SI ON REFUSE SEULEMENT « ACHAT VERS LE HAUT DE LA VEILLE »');
ligne('tout, règle appliquée', T.filter(x => !estPDHAchat(x)));
ligne('tout, sans la règle', T);

// La règle tient-elle sur CHAQUE marché, ou vient-elle d'un seul ?
console.log('\n   marché par marché, règle appliquée (c\'est le test anti-tri) :');
for (const sym of ['NQ=F', 'ES=F', 'YM=F', 'RTY=F']) {
  const av = T.filter(x => x.sym === sym);
  const ap = av.filter(x => !estPDHAchat(x));
  if (!av.length) continue;
  const som = g => g.reduce((a, x) => a + x.r, 0) * RISQUE;
  console.log(`     ${sym.padEnd(6)} ${eu(som(av)).padStart(8)} → ${eu(som(ap)).padStart(8)} ` +
    `(${av.length - ap.length} trade(s) retiré(s))` + (som(ap) > som(av) ? '  ✅' : '  ❌'));
}
