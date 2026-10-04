#!/usr/bin/env node
'use strict';
/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  LE BACKTEST — ce que la stratégie aurait donné, et ce que ça vaut.   ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * Tout est en ARGENT, sur le risque réellement calibré. Le R est une unité de
 * travail ; personne ne lit un relevé en R.
 *
 * ⚠️ CE QU'UN BACKTEST NE PROUVE PAS. Soixante jours, c'est ce que Yahoo sert
 * en bougies de 5 minutes — quatre fenêtres plus anciennes demandées, quatre
 * refus. Un résultat sur soixante jours n'est pas une preuve de rentabilité,
 * c'est un ordre de grandeur. Ce fichier affiche donc SYSTÉMATIQUEMENT ce qui
 * relativise le chiffre : le seuil d'équilibre, le pire creux, la plus longue
 * série de pertes, et la coupure en deux moitiés — la seule façon honnête de
 * voir si le résultat tient hors de l'échantillon où il a été construit.
 *
 *   node scripts/backtest.js            le modèle
 *   node scripts/backtest.js --kintt    kintt aussi
 */
const fs = require('fs'), path = require('path');
const RACINE = path.resolve(__dirname, '..');
const CACHE = process.env.MECH_CACHE || path.join(RACINE, '.cache');
const ctx = {};
for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js', 'js/kintt.js'])
  new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);
const { Modele, Kintt, Position } = ctx;

const lire = (s, i, r) => {
  const f = path.join(CACHE, `${s}_${i}_${r}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : null;
};
const D = {}, E = {};
for (const x of Modele.SERIES) D[x.cle] = lire('NQF', x.interval, x.range);
for (const x of Modele.SERIES2) E[x.cle] = lire('ESF', x.interval, x.range);
if (!D.m5) { console.error('Cache absent. Lancer d\'abord : MECH_CACHE=.cache node scripts/live_log.js'); process.exit(1); }

// ── LE COMPTE ──────────────────────────────────────────────────────────────
const RISQUE = +(process.env.RISQUE_EUR || 250);   // 0,5 % d'un compte de 50 000 €
const LUCID_JOUR = -1200 * 0.92;                   // limite de perte journalière, en €
const LUCID_DD   = -2000 * 0.92;                   // creux glissant maximum, en €
const eu = v => (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)) + ' €';
const pc = v => (v == null ? '—' : v.toFixed(1).replace('.', ',') + ' %');

function rejouer(sigs, cfg, heure, parSignal) {
  const T = [];
  for (const s of sigs) {
    const fin1m = D.m1 && D.m1.length && D.m1[0].t <= s.t;
    const cs = fin1m ? D.m1 : D.m5;
    const c2 = parSignal && s.rr != null ? Object.assign({}, cfg, { tp2: s.rr }) : cfg;
    let fin;
    try {
      fin = Position.suivre(s, cs, c2, { prudent: true, maxBarres: fin1m ? 1000 : 200,
        depuis: s.t, heure: heure, jourSignal: heure(s.t).jour });
    } catch (e) { continue; }
    if (fin.ouverte) continue;
    const e2 = heure(s.t);
    T.push({
      t: s.t, jour: e2.jour, dow: e2.dow, min: e2.min, sens: s.sens,
      // net de frais : 0,25 point de dérapage par côté et 4 $ de commission
      r: fin.r - Position.cout(s.risq),
      sortie: fin.sortie, pts: Math.abs(s.entree - s.sl), niveau: s.niveau,
      ambigu: fin.ambigu
    });
  }
  return T.sort((a, b) => a.t - b.t);
}

function bilan(T) {
  if (!T.length) return null;
  const n = T.length, som = T.reduce((a, x) => a + x.r, 0);
  const g = T.filter(x => x.r > 0), p = T.filter(x => x.r < 0);
  const gM = g.length ? g.reduce((a, x) => a + x.r, 0) / g.length : 0;
  const pM = p.length ? Math.abs(p.reduce((a, x) => a + x.r, 0)) / p.length : 0;
  let pic = 0, cum = 0, dd = 0, serie = 0, serieMax = 0, mortAu = null;
  const parJour = {};
  T.forEach((x, i) => {
    parJour[x.jour] = (parJour[x.jour] || 0) + x.r;
    cum += x.r; if (cum > pic) pic = cum;
    if (cum - pic < dd) dd = cum - pic;
    if (x.r < 0) { serie++; if (serie > serieMax) serieMax = serie; } else serie = 0;
    if (mortAu === null && (cum - pic) * RISQUE <= LUCID_DD) mortAu = i + 1;
  });
  const jours = Object.keys(parJour);
  return {
    n, som, reussite: g.length / n * 100,
    gM, pM, seuil: (gM + pM) > 0 ? pM / (gM + pM) * 100 : null,
    parTrade: som / n, dd, serieMax, mortAu,
    jours: jours.length,
    joursCasses: jours.filter(j => parJour[j] * RISQUE <= LUCID_JOUR).length,
    meilleurJour: Math.max(...jours.map(j => parJour[j])),
    pireJour: Math.min(...jours.map(j => parJour[j])),
    ambigus: T.filter(x => x.ambigu > 0).length
  };
}

function ligne(nom, b) {
  if (!b) { console.log(`  ${nom.padEnd(26)} aucun trade`); return; }
  console.log(`  ${nom.padEnd(26)} ${String(b.n).padStart(3)} trades · ${pc(b.reussite).padStart(7)} gagnés · ` +
    `${eu(b.parTrade * RISQUE).padStart(8)} /trade · ${eu(b.som * RISQUE).padStart(9)} au total`);
}

function detail(b) {
  console.log(`     gain moyen ${eu(b.gM * RISQUE)} · perte moyenne ${eu(-b.pM * RISQUE)}`);
  console.log(`     seuil d'équilibre ${pc(b.seuil)} — en dessous, la stratégie perd de l'argent`);
  console.log(`     marge : ${pc(b.reussite - b.seuil)} de réussite au-dessus du seuil`);
  console.log(`     pire creux traversé ${eu(b.dd * RISQUE)} · plus longue série de pertes ${b.serieMax}`);
  console.log(`     meilleur jour ${eu(b.meilleurJour * RISQUE)} · pire jour ${eu(b.pireJour * RISQUE)}`);
}

function lucid(b) {
  console.log('\n  ── SUR UN COMPTE LUCID 50K ──────────────────────────────────');
  console.log(`     limite journalière −1 200 $ : ${b.joursCasses} jour(s) dépassé(s) sur ${b.jours}`);
  console.log(`     creux glissant −2 000 $      : ` +
    (b.mortAu ? `⚠️  COMPTE FERMÉ au trade n° ${b.mortAu}` : '✅ jamais atteint'));
  const cible = 3000 * 0.92;
  const trades = b.parTrade > 0 ? Math.ceil(cible / (b.parTrade * RISQUE)) : null;
  console.log(`     objectif +3 000 $ : ` + (trades
    ? `${trades} trades au rythme actuel, soit environ ${Math.round(trades / (b.n / b.jours) / 5)} semaines`
    : 'hors d\'atteinte, l\'espérance est négative'));
}

function decoupe(T, nom) {
  // LA SEULE VRAIE ÉPREUVE DISPONIBLE : la stratégie a été construite en
  // regardant tout l'échantillon. La couper en deux ne fabrique pas du hors
  // échantillon, mais si la seconde moitié contredit la première, le chiffre
  // global ne vaut rien.
  const m = Math.floor(T.length / 2);
  const a = bilan(T.slice(0, m)), b = bilan(T.slice(m));
  if (!a || !b) return;
  console.log(`\n  ── ${nom} COUPÉ EN DEUX ──────────────────────────────────`);
  ligne('première moitié', a);
  ligne('seconde moitié', b);
  const ecart = Math.abs(a.parTrade - b.parTrade) * RISQUE;
  console.log(`     écart par trade entre les deux moitiés : ${Math.round(ecart)} €`);
  if ((a.som > 0) !== (b.som > 0))
    console.log('     ⚠️  LES DEUX MOITIÉS NE DISENT PAS LA MÊME CHOSE. Le total global ne veut rien dire.');
  else if (ecart > Math.abs(a.parTrade * RISQUE))
    console.log('     ⚠️  Même signe, mais amplitude très différente : le résultat est instable.');
  else
    console.log('     Les deux moitiés vont dans le même sens et de façon comparable.');
}

function repartition(T) {
  console.log('\n  ── PAR ISSUE ────────────────────────────────────────────────');
  const par = {};
  T.forEach(x => { (par[x.sortie] = par[x.sortie] || []).push(x.r); });
  const NOM = { stop: 'stop touché', seuil: 'sorti au prix d\'entrée', objectif: 'objectif atteint',
                horaire: 'soldé à l\'heure', 'expiré': 'expiré' };
  for (const k of Object.keys(par).sort()) {
    const v = par[k], s = v.reduce((a, x) => a + x, 0);
    console.log(`     ${(NOM[k] || k).padEnd(24)} ${String(v.length).padStart(3)} fois · ${eu(s * RISQUE).padStart(9)}`);
  }
  console.log('\n  ── PAR JOUR DE LA SEMAINE ───────────────────────────────────');
  const J = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const pj = {};
  T.forEach(x => { (pj[x.dow] = pj[x.dow] || []).push(x.r); });
  for (const k of Object.keys(pj).sort()) {
    const v = pj[k], s = v.reduce((a, x) => a + x, 0);
    const g = v.filter(x => x > 0).length;
    console.log(`     ${J[k].padEnd(12)} ${String(v.length).padStart(3)} trades · ${pc(g / v.length * 100).padStart(7)} · ${eu(s * RISQUE).padStart(9)}`);
  }
  // ── SEMAINE PAR SEMAINE ───────────────────────────────────────────────
  // Un total sur deux mois cache sa forme. Une stratégie qui gagne tout le
  // premier mois et perd tout le second n'est pas « rentable en moyenne » :
  // elle est morte, et la moyenne la déguise.
  console.log('\n  ── SEMAINE PAR SEMAINE ──────────────────────────────────────');
  const sem = {};
  T.forEach(x => {
    const d0 = new Date(x.t);
    const lundi = new Date(d0); lundi.setUTCDate(d0.getUTCDate() - ((d0.getUTCDay() + 6) % 7));
    const k = lundi.toISOString().slice(0, 10);
    (sem[k] = sem[k] || []).push(x.r);
  });
  let cumul = 0;
  for (const k of Object.keys(sem).sort()) {
    const v = sem[k], s2 = v.reduce((a, x) => a + x, 0);
    cumul += s2;
    const g = v.filter(x => x > 0).length;
    const barre = s2 >= 0 ? '█'.repeat(Math.min(20, Math.round(s2 * RISQUE / 50)))
                          : '░'.repeat(Math.min(20, Math.round(-s2 * RISQUE / 50)));
    console.log(`     semaine du ${k}  ${String(v.length).padStart(2)} trades · ${pc(v.length ? g / v.length * 100 : null).padStart(7)} · ` +
      `${eu(s2 * RISQUE).padStart(8)} · cumul ${eu(cumul * RISQUE).padStart(8)}  ${barre}`);
  }

  const amb = T.filter(x => x.ambigu > 0).length;
  if (amb) console.log(`\n     ⚠️  ${amb} trade(s) sur ${T.length} décidés par une bougie qui touchait` +
    ' l\'objectif ET le stop.\n        Le comptage prudent a retenu le stop. Sur ces trades-là,' +
    ' le résultat\n        est une hypothèse, pas une mesure.');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n╔══════════════════════════════════════════════════════════════════╗');
console.log(`║  BACKTEST · risque ${String(RISQUE).padStart(4)} € par trade · frais déduits           ║`);
console.log('╚══════════════════════════════════════════════════════════════════╝');
const d = Modele.evaluer(D, E.m5 ? E : null);
const TM = rejouer(d.tousSignaux, Modele.CFG, Modele.heure, false);
const j0 = Modele.heure(D.m5[0].t).jour, j1 = Modele.heure(D.m5[D.m5.length - 1].t).jour;
console.log(`\nPériode : ${j0} → ${j1}  (${D.m5.length} bougies de 5 minutes)`);
console.log(`Fenêtre : ${Math.floor(Modele.CFG.ghDeb / 60)}h → ${Math.floor(Modele.CFG.ghFin / 60)}h New York` +
  ` · stop ×${Modele.CFG.slx} · partiel ${Math.round(Modele.CFG.part * 100)} % à ${Modele.CFG.tp1}` +
  ` · objectif ${Modele.CFG.tp2}× le risque`);

console.log('\n── LE MODÈLE ────────────────────────────────────────────────────');
const BM = bilan(TM);
if (!BM) { console.log('  aucun trade clos'); process.exit(0); }
ligne('sur toute la période', BM);
detail(BM);
lucid(BM);
decoupe(TM, 'LE MODÈLE');
repartition(TM);

if (process.argv.includes('--kintt')) {
  console.log('\n── KINTT ────────────────────────────────────────────────────────');
  const k = Kintt.evaluer(D, E.m5 ? E : null);
  const TK = rejouer((k && k.tousSignaux) || [], Kintt.CFG, Kintt.heure, true);
  const BK = bilan(TK);
  ligne('sur toute la période', BK);
  if (BK) { detail(BK); lucid(BK); decoupe(TK, 'KINTT'); repartition(TK); }
  if (k && k.entonnoir) {
    console.log('\n  ── OÙ PASSENT LES BOUGIES ───────────────────────────────────');
    const E0 = k.entonnoir;
    Object.keys(E0).filter(x => x !== 'barres' && E0[x] > 0)
      .sort((a, b) => E0[b] - E0[a])
      .forEach(x => console.log(`     ${x.padEnd(22)} ${String(E0[x]).padStart(5)}`));
    console.log(`     ${'(total examiné)'.padEnd(22)} ${String(E0.barres).padStart(5)}`);
  }
}

console.log('\n' + '─'.repeat(66));
console.log(`CE QUE CE BACKTEST NE PROUVE PAS :

  · ${BM.n} trades sur ${BM.jours} jours de bourse. C'est un ordre de grandeur,
    pas une preuve. Il faut des centaines de trades pour distinguer une
    stratégie rentable d'une série chanceuse.
  · Les données s'arrêtent à 60 jours : Yahoo refuse toute bougie de 5 minutes
    au-delà. Impossible de tester une autre période, quelle qu'elle soit.
  · La stratégie a été mise au point EN REGARDANT ces mêmes jours. Couper en
    deux ne fabrique pas du hors échantillon ; ça détecte seulement le pire.
  · Aucun ordre n'a été passé. Le dérapage retenu (0,25 point par côté) est
    une hypothèse, le refus d'un courtier n'est pas modélisé, et les prix sont
    des clôtures de bougies, pas des prix obtenus.
`);
