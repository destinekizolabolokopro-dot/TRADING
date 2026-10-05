'use strict';
/**
 * À QUELLE HEURE LA GRANDE LIQUIDITÉ EST-ELLE BALAYÉE ? — scripts/heure_liq.js
 *
 * Affirmation à vérifier : « la grande liquidité se récupère souvent dans les
 * alentours de 16 H ». Deux lectures possibles — 16 h à Paris, soit 10 h à
 * New York, ou 16 h à New York, soit la clôture des actions. Le script ne
 * choisit pas : il mesure l'heure réelle du balayage et l'affiche dans les
 * deux fuseaux. La donnée tranchera.
 *
 * DÉFINITION RETENUE DE « GRANDE LIQUIDITÉ ». Les bassins intacts au début de
 * la séance de New York : haut et bas de la veille, haut et bas de la semaine
 * passée, et les sommets/creux intermédiaires H1 encore non pris. Pour chaque
 * journée, on note l'heure du PREMIER balayage de chacun.
 *
 * Aucune décision de trading n'intervient ici : c'est une mesure du marché,
 * pas une mesure de la stratégie.
 *
 * ⚠️ UN PIÈGE DE DÉCOUPAGE, ET LA PREMIÈRE VERSION Y EST TOMBÉE.
 * En découpant les journées à minuit New York, le « haut de la veille » est
 * déclaré balayé dès la première bougie du jour : à 00h01 le prix est là où
 * il était à 23h59, donc s'il faisait un nouveau sommet à cet instant, le
 * balayage est enregistré à 00h NY. La première version annonçait ainsi 62 %
 * des balayages de niveaux hebdomadaires à 00h NY — un artefact de frontière,
 * pas un comportement de marché.
 *
 * Les extrêmes sont donc pris sur la SÉANCE RÉGULIÈRE (09h30-16h00 New York)
 * et les balayages cherchés sur la séance régulière du jour suivant. Les
 * contrats cotent la nuit, mais la liquidité dont parle la méthode est celle
 * que les participants regardent : celle de la séance.
 */
const RTH_DEB = 9 * 60 + 30, RTH_FIN = 16 * 60;
const J = require('./lib/jeu.js');
const ST = require('./lib/structure.js');
const { Modele } = J.contexte();

const DEMANDES = (process.argv.find(a => a.startsWith('--marches=')) || '').slice(10);
const SYMS = DEMANDES ? DEMANDES.split(',').map(x => x.trim().toUpperCase() + '=F')
                      : ['NQ=F', 'ES=F', 'YM=F', 'RTY=F'];
const PS = {};
for (const s of SYMS) { const S = J.lireMarche(s, Modele.SERIES); if (S.m5 && S.m5.length > 80) PS[s] = S; }
const AL = J.aligner(Object.keys(PS).map(sym => ({ sym, S: PS[sym] })));
for (const l of J.banniere(AL, Object.keys(PS).map(sym => ({ sym, S: PS[sym] })))) console.log(l);

// Les balayages, un par bassin et par journée.
const BAL = [];
for (const sym of Object.keys(PS)) {
  const S = PS[sym];
  // journées de bourse, et leurs extrêmes
  const jours = {};
  for (const b of S.m5) {
    const e = Modele.heure(b.t);
    if (e.dow < 1 || e.dow > 5) continue;
    const j = jours[e.jour] = jours[e.jour] || { bougies: [], h: -Infinity, l: Infinity };
    // Les bougies retenues pour CHERCHER un balayage : la séance de New York,
    // élargie en amont à 08h car c'est la fenêtre d'entrée du modèle.
    if (e.min >= 8 * 60 && e.min < RTH_FIN) j.bougies.push(b);
    // Les extrêmes qui SERVENT de bassin : la séance régulière seule.
    if (e.min >= RTH_DEB && e.min < RTH_FIN) {
      j.h = Math.max(j.h, b.h); j.l = Math.min(j.l, b.l);
    }
  }
  const liste = Object.keys(jours).sort();
  // semaines
  const sem = {};
  for (const j of liste) {
    const d = new Date(j + 'T12:00:00Z'), lundi = new Date(d);
    lundi.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const k = lundi.toISOString().slice(0, 10);
    const w = sem[k] = sem[k] || { h: -Infinity, l: Infinity, jours: [] };
    w.h = Math.max(w.h, jours[j].h); w.l = Math.min(w.l, jours[j].l); w.jours.push(j);
  }
  const semCles = Object.keys(sem).sort();

  for (let i = 1; i < liste.length; i++) {
    const j = liste[i], veille = jours[liste[i - 1]], jour = jours[j];
    if (!jour.bougies.length || !isFinite(veille.h)) continue;
    const debut = jour.bougies[0].t;
    // bassins candidats, tous connus AVANT l'ouverture de la journée
    const pools = [
      { nom: 'haut de la veille', prix: veille.h, haut: true },
      { nom: 'bas de la veille',  prix: veille.l, haut: false }
    ];
    const kSem = semCles.find(k => sem[k].jours.includes(j));
    const iSem = semCles.indexOf(kSem);
    if (iSem > 0) {
      const p = sem[semCles[iSem - 1]];
      pools.push({ nom: 'haut semaine passée', prix: p.h, haut: true });
      pools.push({ nom: 'bas semaine passée',  prix: p.l, haut: false });
    }
    // sommets/creux H1 intermédiaires intacts à l'ouverture
    const h1 = S.h1.filter(b => b.t < debut);
    if (h1.length > 30) {
      const hier = ST.hierarchie(h1);
      for (const [lst, haut, nom] of [[hier.ith, true, 'sommet H1'], [hier.itl, false, 'creux H1']]) {
        for (const sw of lst) {
          if (sw.vu == null || sw.vu >= debut) continue;
          let pris = false;
          for (const b of h1) if (b.t > sw.t && (haut ? b.h > sw.prix : b.l < sw.prix)) { pris = true; break; }
          if (!pris) pools.push({ nom, prix: sw.prix, haut });
        }
      }
    }
    for (const p of pools) {
      if (!isFinite(p.prix)) continue;
      for (const b of jour.bougies) {
        if (p.haut ? b.h >= p.prix : b.l <= p.prix) {
          const e = Modele.heure(b.t);
          BAL.push({ sym, jour: j, nom: p.nom, haut: p.haut, min: e.min });
          break;
        }
      }
    }
  }
}

const hNY = m => String(Math.floor(m / 60)).padStart(2, '0') + 'h';
const hPA = m => String(Math.floor(((m + 360) % 1440) / 60)).padStart(2, '0') + 'h';

function histo(titre, sel) {
  const g = BAL.filter(sel);
  if (!g.length) { console.log(`\n── ${titre} : aucun`); return; }
  const par = {};
  for (const x of g) { const h = Math.floor(x.min / 60); par[h] = (par[h] || 0) + 1; }
  const heures = Object.keys(par).map(Number).sort((a, b) => a - b);
  const max = Math.max(...heures.map(h => par[h]));
  console.log(`\n── ${titre} · ${g.length} balayages`);
  console.log('   NY    Paris          part');
  for (const h of heures) {
    const pc = par[h] / g.length * 100;
    console.log(`   ${hNY(h * 60)}   ${hPA(h * 60)}   ${pc.toFixed(1).padStart(5)} %  ` +
      '█'.repeat(Math.round(par[h] / max * 34)) + ` ${par[h]}`);
  }
  // les trois heures les plus chargées
  const top = heures.slice().sort((a, b) => par[b] - par[a]).slice(0, 3);
  console.log('   → heures les plus chargées : ' +
    top.map(h => `${hNY(h*60)} NY (${hPA(h*60)} Paris) ${(par[h]/g.length*100).toFixed(0)} %`).join(' · '));
}

histo('TOUS LES BASSINS', () => true);
histo('HAUT / BAS DE LA VEILLE', x => x.nom.includes('veille'));
histo('HAUT / BAS DE LA SEMAINE PASSÉE', x => x.nom.includes('semaine'));
histo('SOMMETS ET CREUX H1 INTACTS', x => x.nom.includes('H1'));

// La fenêtre 08h-10h NY capture quelle part ? Et 16h NY ? Et 16h Paris (10h NY) ?
const n = BAL.length;
const part = (a, b) => (BAL.filter(x => x.min >= a * 60 && x.min < b * 60).length / n * 100).toFixed(1) + ' %';
console.log(`\n── CE QUE CHAQUE CRÉNEAU CAPTURE (${n} balayages)`);
console.log(`   08h-10h NY  (14h-16h Paris) : ${part(8, 10)}`);
console.log(`   09h-10h NY  (15h-16h Paris) : ${part(9, 10)}`);
console.log(`   15h-16h NY  (21h-22h Paris) : ${part(15, 16)}`);
console.log(`   la seule heure 10h NY       : ${part(10, 11)}   ← 16h Paris`);
console.log(`   la seule heure 09h NY       : ${part(9, 10)}   ← 15h Paris`);
console.log('\n   (séance régulière seule : les balayages de nuit ne sont pas comptés,');
console.log('    et la frontière de minuit ne fabrique plus de faux balayages.)');
