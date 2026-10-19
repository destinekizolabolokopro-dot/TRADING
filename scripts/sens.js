#!/usr/bin/env node
'use strict';
/**
 * LE SCÉNARIO A-T-IL RAISON SUR LE SENS ? — scripts/sens.js
 *
 * « Est-ce que les déductions sur où va aller le marché sont souvent bonnes ? »
 * La question est juste, et le TAUX DE RÉUSSITE DES TRADES N'Y RÉPOND PAS :
 * un trade peut être perdant avec un sens correct — le stop touché d'abord,
 * puis le marché part dans le bon sens — et gagnant avec un sens douteux. Le
 * taux de réussite mélange trois choses : le sens, la taille du stop et la
 * gestion de sortie. Ce fichier isole le SENS, et rien d'autre.
 *
 * TROIS MESURES, DE LA PLUS DURE À LA PLUS INDULGENTE :
 *
 *   1. PILE OU FACE HONNÊTE  le prix touche-t-il +1 R avant −1 R ?
 *      Même distance des deux côtés. Le hasard donnerait 50 %. C'est la SEULE
 *      des trois qui se compare à un repère connu, donc la seule qui peut
 *      dire « mieux que rien » ou « pas mieux que rien ».
 *
 *   2. LE SCÉNARIO SE RÉALISE-T-IL  la cible est-elle atteinte avant le stop,
 *      dans la séance du signal ? Asymétrique — la cible est bien plus loin
 *      que le stop — donc PAS comparable à 50 %.
 *
 *   3. LE SENS DE LA JOURNÉE  la clôture de la séance est-elle du côté
 *      annoncé ? La plus indulgente : elle ignore tout le chemin parcouru.
 *
 * ⚠️  LE PIÈGE DE LA BOUGIE D'ENTRÉE, ET IL A FAILLI PASSER. Si la bougie où
 * l'on entre contient DÉJÀ la cible, on ne sait pas dans quel ordre les prix
 * y sont passés : compter ces cas comme réussis, c'est s'attribuer un pari
 * dont on ignore le résultat. En 1 heure, la première version de ce fichier
 * en comptait 24 sur 46 — plus de la moitié — et annonçait 55 % de scénarios
 * réalisés là où le chiffre honnête est 26,5 %. Les cas décidés sur la bougie
 * d'entrée sont donc COMPTÉS À PART, et exclus du chiffre annoncé.
 *   C'est aussi la raison du mode --court : en 5 minutes, et plus encore en
 * 1 minute, la bougie d'entrée est douze à soixante fois plus fine, et le
 * flou avec elle.
 *
 *   node scripts/sens.js                 2 ans, exécution 1 heure
 *   node scripts/sens.js --court         60 jours, exécution 5 min (ou 1 min)
 *   … [--cible=loin] [--dol-complet] [--dol-role=manip] [--marches=NQ,ES]
 */
const fs = require('fs'), path = require('path');
const RACINE = path.resolve(__dirname, '..');
const ctx = {};
for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js', 'js/dol.js', 'js/amd.js'])
  new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);
const { AMD, Modele, ST } = ctx;
const RISQUE = +(process.env.RISQUE_EUR || 250);
const COURT = process.argv.includes('--court');

let m;
for (const a of process.argv.slice(2)) {
  if ((m = a.match(/^--cible=(proche|loin)$/))) AMD.CFG.cible = m[1];
  if (a === '--dol-complet') AMD.CFG.dolComplet = true;
  if ((m = a.match(/^--sources=(.+)$/))) { AMD.CFG.dolComplet = true; AMD.CFG.sourcesDOL = m[1].split(','); }
  if ((m = a.match(/^--dol-role=(manip|cible)$/))) AMD.CFG.dolRole = m[1];
}
const DEM = (process.argv.find(a => a.startsWith('--marches=')) || '').slice(10);
const SYMS = DEM ? DEM.split(',').map(x => x.trim().toUpperCase() + '=F')
                 : (COURT ? ['NQ=F', 'ES=F', 'YM=F', 'RTY=F'] : ['NQ=F', 'ES=F']);
const CORREL = { 'NQ=F': 'ES=F', 'ES=F': 'NQ=F', 'YM=F': 'ES=F', 'RTY=F': 'ES=F' };
const pc = v => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1).replace('.', ',') + ' %';

/** Écart au hasard, en écarts-types d'une pièce honnête. */
function sigmas(bons, juges) {
  if (!juges) return null;
  return (bons / juges - 0.5) / Math.sqrt(0.25 / juges);
}
function verdictHasard(z, juges) {
  if (z == null) return '—';
  const s = (z >= 0 ? '+' : '') + z.toFixed(1) + ' écart-type(s)';
  return s + (Math.abs(z) < 2 ? '  →  DANS LE BRUIT, indiscernable d\'une pièce'
                              : '  →  hors du bruit');
}

function mesurer(PS, exeCle, suiviCle) {
  const R = { n: 0, pf: 0, pfJuge: 0, cib: 0, cibBougie: 0, cibPerdu: 0, cibNul: 0,
              jour: 0, jourJuge: 0, delais: [], parManip: {}, parSuivi: {} };
  for (const sym of Object.keys(PS)) {
    const S = PS[sym];
    const opts = exeCle === 'h1' ? { execution: 'h1', E: PS[CORREL[sym]] } : { E: PS[CORREL[sym]] };
    // ⚠️ LE SUIVI SE CHOISIT SIGNAL PAR SIGNAL, et la première version ne le
    // faisait pas. Elle prenait le 1 minute pour TOUS les scénarios dès que
    // le cache en contenait. Or le 1 minute ne remonte qu'à huit jours chez
    // Yahoo quand le 5 minutes en couvre soixante : pour les cinquante-deux
    // autres jours, la recherche tombait sur une bougie d'un autre jour, la
    // boucle s'arrêtait aussitôt, et le scénario était compté « ni réussi ni
    // stoppé ». 192 scénarios sur 211 disparaissaient AINSI, en silence, et
    // le fichier annonçait tranquillement « 3,8 % de scénarios réalisés ».
    // Le plus fin DISPONIBLE À CET INSTANT, donc, pas le plus fin du cache.
    const fin2 = suiviCle && S[suiviCle] && S[suiviCle].length ? S[suiviCle] : null;
    for (const s of AMD.evaluer(S, opts).tousSignaux) {
      if (!jouable(sym, Math.abs(s.risq))) continue;
      const cs = (fin2 && fin2[0].t <= s.t) ? fin2 : S[exeCle];
      R.parSuivi[cs === fin2 ? suiviCle : exeCle] = (R.parSuivi[cs === fin2 ? suiviCle : exeCle] || 0) + 1;
      const L = s.sens === 'LONG';
      const i0 = cs.findIndex(b => b.t >= s.t);
      if (i0 < 0) continue;
      const hautPF = L ? s.entree + s.risq : s.entree - s.risq;
      const basPF  = L ? s.entree - s.risq : s.entree + s.risq;

      let vPF = null, vCib = null, surBougie = false, delaiH = null;
      for (let i = i0; i < cs.length; i++) {
        const c = cs[i];
        if (AMD.heure(c.t).jour !== s.jour) break;      // la séance du signal
        const gagnePF = L ? c.h >= hautPF : c.l <= hautPF;
        const perdPF  = L ? c.l <= basPF  : c.h >= basPF;
        // Convention prudente, la même que partout dans ce dépôt : une bougie
        // qui touche les deux bords compte PERDANTE. Sans elle on se félicite
        // d'une ambiguïté.
        if (vPF == null && (gagnePF || perdPF)) vPF = perdPF ? false : true;
        if (vCib == null) {
          const atteint = L ? c.h >= s.dol : c.l <= s.dol;
          const stoppe  = L ? c.l <= s.sl  : c.h >= s.sl;
          if (atteint || stoppe) {
            vCib = stoppe ? false : true;
            delaiH = (c.t - s.t) / 36e5;
            surBougie = i === i0;
          }
        }
        if (vPF != null && vCib != null) break;
      }
      let dernier = null;
      for (let i = i0; i < cs.length; i++) {
        if (AMD.heure(cs[i].t).jour !== s.jour) break;
        dernier = cs[i];
      }

      R.n++;
      if (vPF != null) { R.pfJuge++; if (vPF) R.pf++; }
      if (vCib === true) { if (surBougie) R.cibBougie++; else { R.cib++; R.delais.push(delaiH); } }
      else if (vCib === false) R.cibPerdu++;
      else R.cibNul++;
      if (dernier) { R.jourJuge++; if (L ? dernier.c > s.entree : dernier.c < s.entree) R.jour++; }

      const o = R.parManip[s.manip] = R.parManip[s.manip] || { juge: 0, pf: 0 };
      if (vPF != null) { o.juge++; if (vPF) o.pf++; }
    }
  }
  return R;
}

let jouable;   // rempli selon le mode

function afficher(titre, periode, R, exe, suivi) {
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  LE SCÉNARIO A-T-IL RAISON SUR LE SENS ?                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  console.log(`   ${titre}`);
  console.log(`   ${periode} · ${R.n} scénarios · signal en ${exe}, suivi en ${suivi}`);
  const rep = Object.keys(R.parSuivi).map(k => `${R.parSuivi[k]} en ${k}`).join(' · ');
  if (rep) console.log(`   suivi réellement employé : ${rep}`);

  const z1 = sigmas(R.pf, R.pfJuge);
  console.log(`\n   1 · PILE OU FACE HONNÊTE  (+1 R avant −1 R, même distance des deux côtés)`);
  console.log(`       ${R.pf} sur ${R.pfJuge} tranchés  →  ${pc(R.pf / R.pfJuge)}   (le hasard : 50,0 %)`);
  console.log(`       écart au hasard : ${verdictHasard(z1, R.pfJuge)}`);

  const total = R.cib + R.cibBougie;
  console.log(`\n   2 · LE SCÉNARIO SE RÉALISE-T-IL  (la cible avant le stop, dans la séance)`);
  console.log(`       réalisé   ${String(R.cib).padStart(3)} sur ${R.n}  →  ${pc(R.cib / R.n)}`);
  console.log(`       stoppé    ${String(R.cibPerdu).padStart(3)} sur ${R.n}  →  ${pc(R.cibPerdu / R.n)}`);
  console.log(`       ni l'un ni l'autre  ${String(R.cibNul).padStart(3)}  →  ${pc(R.cibNul / R.n)}`);
  console.log(`       ÉCARTÉS, décidés sur la bougie d'entrée : ${R.cibBougie}` +
    (total ? ` (${pc(R.cibBougie / total)} des cibles atteintes)` : ''));
  if (total && R.cibBougie / total > 0.25)
    console.log(`         ⚠️  beaucoup : à cette finesse de bougie, le chiffre du dessus reste`);
  if (R.delais.length) {
    const d = R.delais.slice().sort((a, b) => a - b);
    console.log(`       quand la cible tombe : ${(d[Math.floor(d.length / 2)] * 60).toFixed(0)} min de médiane ` +
      `(de ${(d[0] * 60).toFixed(0)} à ${(d[d.length - 1] * 60).toFixed(0)} min)`);
  }
  console.log(`       ⚠️  ce % n'est PAS comparable à 50 % : la cible est bien plus loin que le stop.`);
  if (R.cibNul / R.n > 0.5) {
    console.log(`       ⚠️  ${pc(R.cibNul / R.n)} des scénarios ne sont NI réalisés NI stoppés dans la`);
    console.log(`           séance. Un tel chiffre veut presque toujours dire que la série de`);
    console.log(`           suivi ne couvre pas ces jours-là, pas que le marché n'a pas bougé.`);
  }

  const z3 = sigmas(R.jour, R.jourJuge);
  console.log(`\n   3 · LE SENS DE LA JOURNÉE  (la clôture de la séance est-elle du bon côté ?)`);
  console.log(`       ${R.jour} sur ${R.jourJuge}  →  ${pc(R.jour / R.jourJuge)}   (le hasard : 50,0 %)`);
  console.log(`       écart au hasard : ${verdictHasard(z3, R.jourJuge)}`);

  console.log(`\n   ── PILE OU FACE, PAR LIQUIDITÉ BALAYÉE`);
  for (const k of Object.keys(R.parManip).sort((a, b) => R.parManip[b].juge - R.parManip[a].juge)) {
    const o = R.parManip[k];
    if (o.juge < 5) continue;
    const z = sigmas(o.pf, o.juge);
    console.log(`      ${k.padEnd(20)} ${String(o.juge).padStart(3)} jugés · ${pc(o.pf / o.juge).padStart(7)} · ` +
      `${(z >= 0 ? '+' : '') + z.toFixed(1)} σ`);
  }
  console.log('');
}

if (COURT) {
  const J = require('./lib/jeu.js');
  jouable = (sym, risq) => J.jouable(sym, risq, RISQUE);
  const PS = {};
  for (const s of SYMS) { const S = J.lireMarche(s, Modele.SERIES); if (S.m5 && S.m5.length > 200) PS[s] = S; }
  if (!Object.keys(PS).length) { console.error('Cache absent.'); process.exit(1); }
  const AL = J.aligner(Object.keys(PS).map(sym => ({ sym, S: PS[sym] })));
  // Le suivi se fait en 1 minute quand le cache en a : c'est soixante fois
  // plus fin que l'heure, et l'ambiguïté de la bougie d'entrée avec.
  const aM1 = Object.values(PS).every(S => S.m1 && S.m1.length);
  const R = mesurer(PS, 'm5', aM1 ? 'm1' : 'm5');
  afficher('60 jours · ' + Object.keys(PS).length + ' marchés',
    AL && AL.debut ? new Date(AL.debut).toISOString().slice(0, 10) + ' → ' +
      new Date(AL.fin).toISOString().slice(0, 10) : '60 jours',
    R, '5 min', aM1 ? '1 min' : '5 min');
} else {
  const L = require('./longue.js');
  const POINT = { 'NQ=F': 2, 'ES=F': 5, 'YM=F': 0.5, 'RTY=F': 5 }, TAUX = 1.08;
  jouable = (sym, risq) => risq * (POINT[sym] || 2) / TAUX <= RISQUE;
  AMD.CFG.unitesFVG = ['h1', 'h4'];
  AMD.CFG.unitesInt = ['h1', 'h4'];
  L.jeu(SYMS).then(PS => {
    if (!Object.keys(PS).length) { console.error('Aucune série longue période.'); process.exit(1); }
    const debut = Math.max(...Object.values(PS).map(S => S.h1[0].t));
    const fin = Math.min(...Object.values(PS).map(S => S.h1[S.h1.length - 1].t));
    for (const S of Object.values(PS)) {
      S.h1 = S.h1.filter(b => b.t >= debut && b.t <= fin);
      S.d1 = S.d1.filter(b => b.t <= fin);
    }
    const R = mesurer(PS, 'h1', 'h1');
    afficher('2 ans · ' + Object.keys(PS).length + ' marchés',
      new Date(debut).toISOString().slice(0, 10) + ' → ' + new Date(fin).toISOString().slice(0, 10),
      R, '1 heure', '1 heure');
  });
}
