#!/usr/bin/env node
'use strict';
/**
 * LE BANC D'ESSAI DES SCÉNARIOS — scripts/scenario.js
 *
 * POURQUOI CE FICHIER EXISTE. Mesuré le 19 octobre : le sens que le modèle
 * annonce est une pièce de monnaie — 49,7 % sur 211 scénarios au test
 * symétrique (+1 R avant −1 R). Tant que le sens vaut 50 %, tout le reste —
 * les cibles, l'entrée, la sortie — ne fait que redistribuer du hasard. C'est
 * donc LE SENS qu'il faut chercher, et le chercher PROPREMENT.
 *
 * CE QUE CE BANC FAIT, ET QUI N'EXISTAIT PAS. Il prend un jeu d'INSTANTS, et
 * à chacun demande son sens à PLUSIEURS règles candidates. Même instant, même
 * distance de stop, même distance d'objectif : SEUL LE SENS CHANGE. Deux
 * règles ne peuvent donc pas différer par autre chose que ce qu'on teste.
 * Comparer des stratégies entières, comme je le faisais, mêlait le sens à
 * l'entrée, au stop et à la sortie, et aucun écart n'était attribuable.
 *
 * LE TEST : le prix touche-t-il +1 R avant −1 R ? Même distance des deux
 * côtés, donc LE HASARD DONNE EXACTEMENT 50 %. Une bougie qui touche les deux
 * bords compte PERDANTE — la convention prudente du dépôt. C'est le seul
 * test de ce dépôt dont le repère est connu d'avance au lieu d'être mesuré.
 *
 * ⚠️ LE PIÈGE DES ESSAIS MULTIPLES, ET IL EST FATAL SI ON L'IGNORE. Tester
 * vingt règles sur deux cents tirages, c'est garantir qu'une d'entre elles
 * affichera 56 % PAR CHANCE. Trois garde-fous, tous obligatoires :
 *
 *   1. Le banc annonce, AVANT les résultats, le meilleur score qu'on doit
 *      attendre du pur hasard pour ce nombre de règles et de tirages.
 *   2. L'échantillon est COUPÉ EN DEUX dans le temps. La première moitié
 *      sert à chercher, la seconde à confirmer. Une règle qui brille sur la
 *      première et s'effondre sur la seconde était du bruit.
 *   3. Un sens tiré au sort est mis DANS LA LISTE, sans le dire aux autres
 *      colonnes. S'il finit devant une vraie règle, la liste est du bruit.
 *
 *   node scripts/scenario.js                   60 jours, instants d'AMD
 *   node scripts/scenario.js --fenetre         60 jours, TOUTES les bougies
 *   node scripts/scenario.js --long            2 ans, exécution 1 heure
 */
const fs = require('fs'), path = require('path');
const RACINE = path.resolve(__dirname, '..');
const ctx = {};
for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js', 'js/dol.js', 'js/amd.js'])
  new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);
const { AMD, Modele, ST } = ctx;
const RISQUE = +(process.env.RISQUE_EUR || 250);
const LONG = process.argv.includes('--long');
const FENETRE = process.argv.includes('--fenetre');
const GRAINE = +(process.env.GRAINE || 12345);

const DEM = (process.argv.find(a => a.startsWith('--marches=')) || '').slice(10);
const SYMS = DEM ? DEM.split(',').map(x => x.trim().toUpperCase() + '=F')
                 : (LONG ? ['NQ=F', 'ES=F'] : ['NQ=F', 'ES=F', 'YM=F', 'RTY=F']);
const CORREL = { 'NQ=F': 'ES=F', 'ES=F': 'NQ=F', 'YM=F': 'ES=F', 'RTY=F': 'ES=F' };
const pc = v => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1).replace('.', ',') + ' %';

// Un générateur à graine : le hasard du banc doit être REJOUABLE, sinon on
// ne peut pas vérifier un résultat surprenant.
let graine = GRAINE;
function alea() { graine = (graine * 1103515245 + 12345) & 0x7fffffff; return graine / 0x7fffffff; }

/* ═══════════════════════════════════════════════════════════════════════════
   LES RÈGLES CANDIDATES
   Chacune reçoit le CONTEXTE à un instant et rend +1 (haussier), −1
   (baissier) ou 0 (pas d'avis — le tirage est alors écarté pour elle).
   Aucune ne doit lire une bougie postérieure à `i` : c'est la seule règle
   qui compte, et le contexte ne contient rien d'autre.
   ═══════════════════════════════════════════════════════════════════════ */
const REGLES = [];
const R = (nom, source, fn) => REGLES.push({ nom, source, fn, essais: 0, bons: 0,
                                            h1: [0, 0], h2: [0, 0], parJour: {} });

// Celle du modèle actuel : l'inverse de la liquidité balayée.
R('AMD · inverse du balayage', 'modèle actuel', K => K.amdDir || 0);
// Son exact contraire. Si l'inverse vaut 49,7 %, la continuation vaut 50,3 % :
// les deux sont la MÊME information, et la mettre noir sur blanc évite de
// croire qu'on a trouvé quelque chose en retournant une pièce.
R('AMD · sens du balayage (continuation)', 'miroir du précédent', K => -(K.amdDir || 0));
// Le biais de js/modele.js : score de respect des FVG sur 1D, 4H, 1H, 15M.
R('biais FVG 4 unités (modele.js)', 'modèle actuel', K => K.biaisFVG || 0);
// Premium / discount : classique ICT. Au-dessus de la moitié du range du
// jour précédent on est en « premium », on vend ; en dessous on achète.
R('premium/discount · range veille', 'ICT classique', K => {
  if (K.pdh == null || K.pdl == null || K.pdh <= K.pdl) return 0;
  const mid = (K.pdh + K.pdl) / 2;
  return K.prix > mid ? -1 : K.prix < mid ? 1 : 0;
});
// Le même, mais sur le range de la SEMAINE passée.
R('premium/discount · range semaine', 'ICT classique', K => {
  if (K.ph == null || K.pl == null || K.ph <= K.pl) return 0;
  const mid = (K.ph + K.pl) / 2;
  return K.prix > mid ? -1 : K.prix < mid ? 1 : 0;
});
// Tendance de structure H1 : derniers ITH/ITL montants ou descendants.
R('tendance structure H1', 'structure', K => K.tendH1 || 0);
// Tendance de structure H4.
R('tendance structure H4', 'structure', K => K.tendH4 || 0);
// Le sens de la veille : clôture contre ouverture.
R('sens de la veille (continuation)', 'simple', K => K.sensVeille || 0);
R('sens de la veille (inverse)', 'simple', K => -(K.sensVeille || 0));
// Position contre l'ouverture de la séance de New York.
R('au-dessus / sous l\'ouverture NY', 'simple', K => {
  if (K.ouvNY == null) return 0;
  return K.prix > K.ouvNY ? 1 : K.prix < K.ouvNY ? -1 : 0;
});
// Son miroir, et il est là pour une raison précise. La règle au-dessus a
// marqué 43,8 % sur 6 969 tirages — très loin SOUS le point neutre. Une règle
// fiablement FAUSSE porte exactement autant d'information qu'une règle
// fiablement juste : il suffit de la retourner. Celle-ci dit donc « le prix
// revient vers l'ouverture de la séance de New York », ce qui est un effet
// de retour à la moyenne connu, pas une trouvaille. Elle est inscrite en
// clair pour être jugée comme les autres, au lieu d'être lue entre les lignes
// du score de sa jumelle.
R('retour vers l\'ouverture NY', 'miroir de la précédente', K => {
  if (K.ouvNY == null) return 0;
  return K.prix > K.ouvNY ? -1 : K.prix < K.ouvNY ? 1 : 0;
});
R('retour vers l\'ouverture NY · écart > 1 ATR', 'variante du précédent', K => {
  if (K.ouvNY == null || !(K.atr > 0)) return 0;
  const d = K.prix - K.ouvNY;
  if (Math.abs(d) < K.atr) return 0;      // trop près : pas d'avis
  return d > 0 ? -1 : 1;
});
// La divergence SMT : le marché corrélé n'a pas fait le même extrême.
R('divergence SMT', 'cours source', K => K.smtDir || 0);
// Le CISD le plus récent sur l'unité d'exécution.
R('dernier CISD', 'cours source [HYP]', K => K.cisdDir || 0);
// Deux règles combinées : le sens d'AMD, mais SEULEMENT quand il va dans le
// sens du premium/discount. Un filtre, pas une règle neuve.
R('AMD filtré par premium/discount', 'combinaison', K => {
  const a = K.amdDir || 0;
  if (!a || K.pdh == null || K.pdl == null || K.pdh <= K.pdl) return 0;
  const mid = (K.pdh + K.pdl) / 2;
  const pd = K.prix > mid ? -1 : 1;
  return a === pd ? a : 0;
});
// AMD seulement quand la structure H4 est d'accord.
R('AMD filtré par tendance H4', 'combinaison', K => {
  const a = K.amdDir || 0;
  return a && a === K.tendH4 ? a : 0;
});
// ⚠️ LE TÉMOIN. Un sens tiré au sort, mêlé aux autres sans distinction. S'il
// finit devant une vraie règle, c'est que la liste entière est du bruit.
R('⚠️ TÉMOIN · sens tiré au sort', 'aucune — repère', () => alea() < 0.5 ? 1 : -1);

/* ═══════════════════════════════════════════════════════════════════════════
   LE CONTEXTE À UN INSTANT, et rien de plus que ce qui est connu alors.
   ═══════════════════════════════════════════════════════════════════════ */
function contextes(S, SE, exeCle, hier, prepB, cisds, jours, atrs) {
  const exe = S[exeCle], pas = ST.pasDe(exe);
  const h4 = S.h4 || ST.agreger(S.h1, 4);
  const sortie = [];
  const tend = (liste, t) => {
    const v = liste.filter(x => x.vu < t).slice(-2);
    if (v.length < 2) return 0;
    return v[1].prix > v[0].prix ? 1 : v[1].prix < v[0].prix ? -1 : 0;
  };
  for (let i = 0; i < exe.length; i++) {
    const b = exe[i], t = b.t + pas, e = AMD.heure(b.t);
    const J = jours[e.jour];
    if (!J) continue;
    sortie.push({
      i, t, prix: b.c, jour: e.jour, min: e.min,
      pdh: J.pdh, pdl: J.pdl, ph: J.ph, pl: J.pl, ouvNY: J.ouvNY,
      sensVeille: J.sensVeille,
      tendH1: tend(hier.h1.ith, t) === tend(hier.h1.itl, t) ? tend(hier.h1.ith, t) : 0,
      tendH4: tend(hier.h4.ith, t) === tend(hier.h4.itl, t) ? tend(hier.h4.ith, t) : 0,
      biaisFVG: prepB ? prepB(t) : 0,
      atr: atrs ? atrs[i] : 0,
      cisdDir: (() => {
        for (let q = cisds.length - 1; q >= 0; q--)
          if (cisds[q].t < t) return cisds[q].haussier ? 1 : -1;
        return 0;
      })()
    });
  }
  return sortie;
}

/** Le verdict symétrique : +1 R avant −1 R, dans la séance, convention prudente. */
function verdict(cs, i0, entree, risq, dir, jour) {
  const L = dir > 0;
  const haut = L ? entree + risq : entree - risq;
  const bas  = L ? entree - risq : entree + risq;
  for (let i = i0 + 1; i < cs.length; i++) {      // ⚠️ i0+1 : JAMAIS la bougie
    const c = cs[i];                               // d'entrée — on ne sait pas
    if (AMD.heure(c.t).jour !== jour) break;       // dans quel ordre elle passe
    const g = L ? c.h >= haut : c.l <= haut;
    const p = L ? c.l <= bas  : c.h >= bas;
    if (g || p) return p ? false : true;
  }
  return null;
}

function jours(S, exeCle) {
  // Haut/bas de la veille et de la semaine passée, ouverture de la séance NY,
  // sens de la veille — tous datés du jour où ils deviennent connaissables.
  const exe = S[exeCle], par = {}, ordre = [];
  for (const b of exe) {
    const e = AMD.heure(b.t);
    if (!par[e.jour]) { par[e.jour] = { h: -Infinity, l: Infinity, o: null, c: null, dow: e.dow }; ordre.push(e.jour); }
    const o = par[e.jour];
    o.h = Math.max(o.h, b.h); o.l = Math.min(o.l, b.l);
    if (o.o == null) o.o = b.o;
    o.c = b.c;
    if (e.min >= 9 * 60 + 30 && o.ouvNY == null) o.ouvNY = b.o;
  }
  const out = {};
  for (let k = 1; k < ordre.length; k++) {
    const v = par[ordre[k - 1]], j = par[ordre[k]];
    // La semaine passée : tous les jours jusqu'au dernier dimanche.
    let ph = -Infinity, pl = Infinity, n = 0;
    for (let q = k - 1; q >= 0 && n < 5; q--, n++) {
      ph = Math.max(ph, par[ordre[q]].h); pl = Math.min(pl, par[ordre[q]].l);
    }
    out[ordre[k]] = { pdh: v.h, pdl: v.l, ph: isFinite(ph) ? ph : null, pl: isFinite(pl) ? pl : null,
                      ouvNY: j.ouvNY, sensVeille: v.c > v.o ? 1 : v.c < v.o ? -1 : 0 };
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
function lancer(PS, exeCle, suiviCle, titre, periode) {
  let tirages = 0, coupe = null;
  const tous = [];

  for (const sym of Object.keys(PS)) {
    const S = PS[sym], exe = S[exeCle], pas = ST.pasDe(exe);
    const h4 = ST.agreger(S.h1, 4);
    const hier = { h1: ST.hierarchie(S.h1), h4: ST.hierarchie(h4) };
    const cisds = ST.cisd(exe);
    const J = jours(S, exeCle);
    const atr = ST.atr(exe, 14);

    // Le biais de modele.js, préparé une fois.
    let prepB = null;
    try {
      const m30 = ST.agreger(S.m15 || S.h1, 2);
      const P = Modele.prepareBiais
        ? Modele.prepareBiais([S.d1, h4, S.h1, S.m15 || S.h1])
        : null;
      if (P) prepB = t => Modele.biaisA(P, t).dir;
    } catch (e) { prepB = null; }

    const ctxs = contextes(S, PS[CORREL[sym]], exeCle, hier, prepB, cisds, J, atr);
    const parI = {}; for (const c of ctxs) parI[c.i] = c;

    // Les instants retenus, et le SENS D'AMD à chacun.
    const instants = [];
    if (FENETRE) {
      // Toutes les bougies de la fenêtre de distribution : bien plus de
      // tirages, donc un bruit bien plus petit. Le risque est l'ATR, faute
      // de signal pour le donner.
      for (const c of ctxs) {
        if (c.min < AMD.CFG.distDeb || c.min >= AMD.CFG.distFin) continue;
        const a = atr[c.i];
        if (!(a > 0)) continue;
        instants.push({ c, entree: c.prix, risq: a, amdDir: 0 });
      }
    } else {
      const opts = exeCle === 'h1' ? { execution: 'h1', E: PS[CORREL[sym]] } : { E: PS[CORREL[sym]] };
      for (const s of AMD.evaluer(S, opts).tousSignaux) {
        const i0 = exe.findIndex(b => b.t >= s.t);
        if (i0 < 0 || !parI[i0]) continue;
        instants.push({ c: parI[i0], entree: s.entree, risq: Math.abs(s.risq),
                        amdDir: s.sens === 'LONG' ? 1 : -1,
                        smtDir: s.smt ? (s.sens === 'LONG' ? 1 : -1) : 0 });
      }
    }

    const suivi = (suiviCle && S[suiviCle] && S[suiviCle].length) ? S[suiviCle] : null;
    for (const inst of instants) {
      const cs = (suivi && suivi[0].t <= inst.c.t) ? suivi : exe;
      const i0 = cs.findIndex(b => b.t >= inst.c.t);
      if (i0 < 0) continue;
      tous.push({ t: inst.c.t, cs, i0, inst, sym,
                  K: Object.assign({}, inst.c, { amdDir: inst.amdDir, smtDir: inst.smtDir || 0 }) });
      tirages++;
    }
  }

  tous.sort((a, b) => a.t - b.t);
  coupe = tous.length ? tous[Math.floor(tous.length / 2)].t : 0;

  for (const x of tous) {
    for (const r of REGLES) {
      const dir = r.fn(x.K);
      if (!dir) continue;
      const v = verdict(x.cs, x.i0, x.inst.entree, x.inst.risq, dir, x.K.jour);
      if (v == null) continue;
      r.essais++; if (v) r.bons++;
      const moitie = x.t < coupe ? r.h1 : r.h2;
      moitie[0]++; if (v) moitie[1]++;
      // ⚠️ LES TIRAGES NE SONT PAS INDÉPENDANTS, et c'est l'erreur qui fait
      // croire aux avantages. Deux bougies de 5 minutes de la MÊME séance
      // partagent la même ouverture NY, le même haut de veille, et des
      // trajectoires futures qui se chevauchent : ce sont presque le même
      // pari compté deux cents fois. L'écart-type calculé sur 7 000 tirages
      // est donc faux d'un facteur énorme — il m'a affiché « 8 écarts-types »
      // sur une règle de retour à la moyenne. L'unité réellement
      // indépendante est LE JOUR-MARCHÉ. On garde donc aussi le score moyen
      // par jour, et c'est sur ces moyennes que l'écart-type est honnête.
      const cle = x.sym + '/' + x.K.jour;
      const pj = r.parJour[cle] = r.parJour[cle] || [0, 0];
      pj[0]++; if (v) pj[1]++;
    }
  }

  // ── LE POINT NEUTRE N'EST PAS 50 %, ET LE SUPPOSER FAUSSE TOUT ────────
  // La convention prudente compte PERDANTE une bougie qui touche les deux
  // bords. Une règle et son exact miroir perdent donc TOUTES LES DEUX ces
  // tirages : leurs scores ne somment pas à 100 % mais à 100 % moins le taux
  // d'ambiguïté. Première version de ce banc : elle annonçait « le hasard
  // donne 50 % » et affichait un tableau entièrement sous 50 %, ce qui
  // donnait l'air mauvais à des règles simplement neutres. Le point neutre
  // se MESURE, sur la paire miroir qui est là pour ça.
  // Deux paires miroir sont disponibles, parce qu'en mode --fenetre les
  // règles d'AMD n'ont pas d'avis (il n'y a pas de balayage à chaque bougie)
  // et la première paire se tait. On prend la première paire qui parle.
  const PAIRES = [['AMD · inverse du balayage', 'AMD · sens du balayage (continuation)'],
                  ['sens de la veille (continuation)', 'sens de la veille (inverse)']];
  let NEUTRE = null, ambig = 0, paireLue = null;
  for (const [a, b] of PAIRES) {
    const r1 = REGLES.find(r => r.nom === a), r2 = REGLES.find(r => r.nom === b);
    if (!r1 || !r2 || r1.essais < 20 || r2.essais < 20) continue;
    // Une paire miroir ne vaut que si les deux règles ont vu les MÊMES
    // tirages ; sinon leur somme ne mesure pas l'ambiguïté mais un écart
    // d'échantillon.
    if (r1.essais !== r2.essais) continue;
    const somme = r1.bons / r1.essais + r2.bons / r2.essais;
    ambig = 1 - somme; NEUTRE = somme / 2; paireLue = a + ' / ' + b;
    break;
  }
  if (NEUTRE == null) {
    // Aucune paire miroir exploitable : on le DIT et on retombe sur 50 %,
    // en sachant que c'est alors un repère optimiste pour les règles.
    NEUTRE = 0.5;
    console.log('\n   ⚠️  AUCUNE PAIRE MIROIR EXPLOITABLE : le point neutre ne peut pas être');
    console.log('       mesuré, on retombe sur 50 %. C\'est un repère TROP EXIGEANT pour les');
    console.log('       règles, puisqu\'il ignore les tirages ambigus. À interpréter avec ça.');
  }

  // ── l'annonce AVANT les résultats ─────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  BANC D\'ESSAI DES SCÉNARIOS · seul le SENS change                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`   ${titre} · ${periode}`);
  console.log(`   ${tirages} instants · ${REGLES.length} règles · test : +1 R avant −1 R`);
  const n0 = REGLES.reduce((a, r) => a + r.essais, 0) / REGLES.length;
  const sig = Math.sqrt(0.25 / Math.max(1, n0));
  console.log(`\n   POINT NEUTRE MESURÉ : ${pc(NEUTRE)}, et non 50 %.` +
    (paireLue ? `   (lu sur ${paireLue})` : ''));
  console.log(`       ${pc(ambig)} des tirages voient une bougie toucher les DEUX bords ; la`);
  console.log(`       convention prudente les compte perdants pour les deux sens, donc une`);
  console.log(`       règle sans aucune information marque ${pc(NEUTRE)}. C'est À CE CHIFFRE`);
  console.log(`       que tout le tableau se compare — pas à 50 %.`);
  // Le meilleur de k tirages d'une loi normale : environ la quantile
  // 1 − 1/(k+1). Deux décimales suffisent pour ce qu'on en fait.
  const zAttendu = quantileNormale(1 - 1 / (REGLES.length + 1));
  console.log(`\n   DEUX COLONNES D'ÉCART-TYPE, et seule la seconde compte :`);
  console.log(`       « σ brut »  calculé sur les bougies, comme si chacune était un pari`);
  console.log(`                   indépendant. ELLE MENT : deux bougies de la même séance`);
  console.log(`                   partagent tout. C'est elle qui m'affichait 8 écarts-types.`);
  console.log(`       « σ/jour »  calculé sur les scores des JOURS-MARCHÉS. Honnête.`);
  console.log(`\n   ⚠️  À LIRE AVANT LES CHIFFRES. Avec ${REGLES.length} règles et ~${Math.round(n0)} tirages`);
  console.log(`       chacune, LE PUR HASARD place déjà sa meilleure règle vers`);
  console.log(`       ${pc(NEUTRE + zAttendu * sig)} (${zAttendu.toFixed(1)} écart-type). Un score en dessous de ça`);
  console.log(`       ne dit RIEN. Il faut ${pc(NEUTRE + 2 * sig)} pour commencer à parler, et la`);
  console.log(`       seconde moitié doit tenir aussi.`);

  // ⚠️ UNE RÈGLE QUI N'A JAMAIS D'AVIS DOIT CRIER, PAS DISPARAÎTRE. Première
  // version : le biais FVG de modele.js rendait 0 partout, parce que
  // prepareBiais n'était pas exporté. La règle était simplement absente du
  // tableau, et j'allais conclure sur une liste à laquelle il manquait la
  // méthode la plus élaborée du dépôt. C'est le défaut « les épreuves
  // jugeaient le vide », en plus discret.
  const muettes = REGLES.filter(r => r.essais < 20);
  if (muettes.length) {
    console.log(`\n   ⚠️  ${muettes.length} RÈGLE(S) SANS AVIS, écartée(s) du classement :`);
    for (const r of muettes)
      console.log(`       « ${r.nom} » — ${r.essais} tirage(s) seulement. Elle ne dit rien :`);
    console.log(`       soit sa donnée manque, soit son code rend toujours 0. Ce n'est PAS un`);
    console.log(`       résultat, c'est une panne, et il faut la réparer avant de conclure.`);
  }
  const tri = REGLES.slice().filter(r => r.essais >= 20).sort((a, b) => b.bons / b.essais - a.bons / a.essais);
  console.log(`\n   ${'RÈGLE'.padEnd(38)} ${'TIR.'.padStart(6)} ${'SCORE'.padStart(7)} ${'σ brut'.padStart(7)} ${'σ/jour'.padStart(7)}  1re m.   2e m.`);
  console.log('   ' + '─'.repeat(96));
  for (const r of tri) {
    const p = r.bons / r.essais, z = (p - NEUTRE) / Math.sqrt(0.25 / r.essais);
    const p1 = r.h1[0] ? r.h1[1] / r.h1[0] : null, p2 = r.h2[0] ? r.h2[1] / r.h2[0] : null;
    const tientDeux = p1 != null && p2 != null && p1 > NEUTRE && p2 > NEUTRE;
    const zj = zParJour(r, NEUTRE);
    r.zj = zj;
    console.log('   ' + r.nom.padEnd(38) + String(r.essais).padStart(6) + pc(p).padStart(8) +
      ((z >= 0 ? '+' : '') + z.toFixed(1)).padStart(8) +
      (zj == null ? '      —' : ((zj >= 0 ? '+' : '') + zj.toFixed(1)).padStart(8)) + '  ' +
      pc(p1).padStart(7) + ' ' + pc(p2).padStart(7) +
      (zj != null && Math.abs(zj) >= 2 && tientDeux ? '  ⭐' : ''));
  }
  console.log('   ' + '─'.repeat(92));
  const temoin = REGLES.find(r => r.nom.includes('TÉMOIN'));
  const devant = tri.filter(r => r.bons / r.essais > temoin.bons / temoin.essais && !r.nom.includes('TÉMOIN'));
  console.log(`\n   LE TÉMOIN (sens tiré au sort) marque ${pc(temoin.bons / temoin.essais)}.`);
  console.log(`   ${devant.length} règle(s) sur ${tri.length - 1} le dépassent. ` +
    (devant.length >= (tri.length - 1) / 2
      ? 'Rien d\'anormal : la moitié devrait.'
      : 'MOINS DE LA MOITIÉ le dépassent — la liste entière est suspecte.'));
  const etoiles = tri.filter(r => {
    const p1 = r.h1[0] ? r.h1[1] / r.h1[0] : null, p2 = r.h2[0] ? r.h2[1] / r.h2[0] : null;
    return r.zj != null && Math.abs(r.zj) >= 2 && p1 > NEUTRE && p2 > NEUTRE;
  });
  console.log(`\n   ⭐ RÈGLES QUI TIENNENT LES DEUX CRITÈRES (2 écarts-types au-dessus du point` +
    `\n      neutre mesuré, ET les deux moitiés au-dessus) : ` +
    (etoiles.length ? etoiles.map(r => r.nom).join(', ') : 'AUCUNE.'));
  if (!etoiles.length)
    console.log(`      Aucune de ces ${tri.length - 1} façons de choisir le sens ne bat la pièce de monnaie.`);
  console.log('');
}

/**
 * L'écart-type calculé sur les JOURS-MARCHÉS, pas sur les bougies.
 * Chaque jour-marché donne un score ; on teste si la moyenne de ces scores
 * s'écarte du point neutre. C'est le seul calcul honnête quand les tirages
 * d'une même séance se chevauchent.
 */
function zParJour(r, neutre) {
  // Le seuil était à trois tirages par jour, et aux instants d'AMD aucun jour
  // n'en a trois : la colonne affichait un tiret partout, précisément là où
  // elle manquait le plus. Un jour à un seul tirage porte peu d'information
  // mais il en porte ; c'est la VARIANCE entre jours qui s'en charge, et elle
  // grossit d'elle-même quand les jours sont maigres. On exige donc plus de
  // JOURS au lieu de plus de tirages par jour.
  const scores = [];
  for (const k in r.parJour) {
    const [n, b] = r.parJour[k];
    if (n < 1) continue;
    scores.push(b / n);
  }
  if (scores.length < 20) return null;
  const moy = scores.reduce((a, x) => a + x, 0) / scores.length;
  const varia = scores.reduce((a, x) => a + (x - moy) * (x - moy), 0) / (scores.length - 1);
  if (!(varia > 0)) return null;
  return (moy - neutre) / Math.sqrt(varia / scores.length);
}

/** Quantile de la loi normale centrée réduite (Acklam, suffisant ici). */
function quantileNormale(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
         (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}

if (LONG) {
  const L = require('./longue.js');
  AMD.CFG.unitesFVG = ['h1', 'h4']; AMD.CFG.unitesInt = ['h1', 'h4'];
  L.jeu(SYMS).then(PS => {
    if (!Object.keys(PS).length) { console.error('Aucune série longue période.'); process.exit(1); }
    const debut = Math.max(...Object.values(PS).map(S => S.h1[0].t));
    const fin = Math.min(...Object.values(PS).map(S => S.h1[S.h1.length - 1].t));
    for (const S of Object.values(PS)) {
      S.h1 = S.h1.filter(b => b.t >= debut && b.t <= fin);
      S.d1 = S.d1.filter(b => b.t <= fin);
      S.m15 = S.h1;
    }
    lancer(PS, 'h1', null, '2 ans · exécution 1 heure' + (FENETRE ? ' · TOUTES les bougies' : ' · instants d\'AMD'),
      new Date(debut).toISOString().slice(0, 10) + ' → ' + new Date(fin).toISOString().slice(0, 10));
  });
} else {
  const J = require('./lib/jeu.js');
  const PS = {};
  for (const s of SYMS) { const S = J.lireMarche(s, Modele.SERIES); if (S.m5 && S.m5.length > 200) PS[s] = S; }
  if (!Object.keys(PS).length) { console.error('Cache absent.'); process.exit(1); }
  const AL = J.aligner(Object.keys(PS).map(sym => ({ sym, S: PS[sym] })));
  lancer(PS, 'm5', 'm1', '60 jours · ' + Object.keys(PS).length + ' marchés · exécution 5 min' +
    (FENETRE ? ' · TOUTES les bougies' : ' · instants d\'AMD'),
    AL && AL.debut ? new Date(AL.debut).toISOString().slice(0, 10) + ' → ' +
      new Date(AL.fin).toISOString().slice(0, 10) : '60 jours');
}
