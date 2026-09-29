#!/usr/bin/env node
'use strict';
/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  BALAYAGE — mesurer js/modele.js, le code qui tourne vraiment en      ║
 * ║  ligne, sur toute une grille de réglages.                             ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * scripts/mech.js est le banc d'essai de la STRATÉGIE : il a ses propres
 * options (mode de stop, familles de niveaux, filtres de déplacement…).
 * js/modele.js est la VERSION EMBARQUÉE, celle que le site affiche et que
 * scripts/live_log.js exécute toutes les quelques heures. Les deux ne rendent
 * pas les mêmes trades. Optimiser mech.js ne change donc rien à ce que le
 * robot fait : ce script balaie le modèle embarqué, pour que le meilleur
 * réglage trouvé soit applicable tel quel.
 *
 * Comme le robot (scripts/live_log.js), evaluer() est appelé UNE seule fois,
 * avec le 5 minutes pour horloge.
 *
 * ── LES DEUX COMPTAGES ────────────────────────────────────────────────────
 * Une bougie de 5 minutes ne dit pas dans quel ordre son haut et son bas ont
 * été atteints. Quand elle touche l'objectif ET le stop, le backtest DEVINE.
 *   optimiste  : l'objectif d'abord (ce que l'ancien robot supposait)
 *   prudent    : le stop d'abord
 * L'écart entre les deux colonnes est la part du résultat qui ne vient pas du
 * marché mais de l'hypothèse. Avec un partiel à 0,5 R — souvent moins de dix
 * points — cette part est énorme : c'est la découverte principale de ce
 * balayage, et la raison pour laquelle le classement change du tout au tout.
 *
 *   node scripts/balayage.js fenetres
 *   node scripts/balayage.js sorties
 *   node scripts/balayage.js tout --n 4000
 *   node scripts/balayage.js arbitre          (tranche en bougies de 1 minute)
 *
 * Les séries Yahoo sont mises en cache sous .cache/ : un balayage lance des
 * milliers de passes, il est hors de question de retélécharger à chaque fois.
 */
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');

const RACINE = path.resolve(__dirname, '..');
const CACHE  = process.env.MECH_CACHE || path.join(RACINE, '.cache');
const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';
// Les séries sont déclarées dans js/modele.js : une copie ici avait déjà
// divergé de celle du robot sans que personne le voie.
let SERIES = null;   // rempli par chargerModele()

const args = {};
process.argv.slice(3).forEach((a, i, arr) => { if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1]; });
const MODE = process.argv[2] || 'fenetres';

// ═════════════════════════════════════════════════════════════════ données ══
async function serie(sym, interval, range) {
  const f = path.join(CACHE, `${sym.replace(/\W/g, '')}_${interval}_${range}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  const r = await fetch(`${YF}${encodeURIComponent(sym)}?interval=${interval}&range=${range}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`${sym} ${interval} : HTTP ${r.status}`);
  const j = await r.json(), res = j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error(`${sym} ${interval} : vide`);
  const q = res.indicators.quote[0], out = [];
  for (let i = 0; i < res.timestamp.length; i++) {
    if (q.open[i] == null || q.close[i] == null) continue;
    out.push({ t: res.timestamp[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
  }
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(out));
  return out;
}
async function charger(sym) {
  if (!SERIES) chargerModele();
  const D = {};
  for (const [i, r, k] of SERIES) D[k] = await serie(sym, i, r);
  return D;
}
// Le marché de confirmation exigé par le plan source. Chargé une seule fois.
let _conf = null;
async function confirmateur() {
  if (_conf) return _conf;
  const s = args.conf || 'ES=F';
  const M = chargerModele();
  _conf = {};
  for (const x of M.SERIES2) _conf[x.cle] = await serie(s, x.interval, x.range);
  return _conf;
}

// ═══════════════════════════════════════════════ le modèle, tel qu'embarqué ══
// js/structure.js et js/modele.js sont écrits pour le navigateur : ils
// s'accrochent à `window` et se parlent par les globales (`ST`). On les charge
// donc dans un faux objet global, et on lui donne les noms qu'ils attendent.
function chargerModele() {
  const ctx = {};
  for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js']) {
    const code = fs.readFileSync(path.join(RACINE, f), 'utf-8');
    new Function('root', 'ST', code).call(ctx, ctx, ctx.ST);
  }
  if (!ctx.Modele) throw new Error('js/modele.js n\'a pas exposé Modele');
  if (!ctx.Position) throw new Error('js/position.js n\'a pas exposé Position');
  POSITION = ctx.Position;
  SERIES = ctx.Modele.SERIES.map(x => [x.interval, x.range, x.cle]);
  return ctx.Modele;
}

// ══════════════════════════════════════════════════════════ suivi et coûts ══
// NQ : 1 point = 20 $. Coût réel : 0,25 pt de slippage par côté + 4,00 $ de
// commission, soit 0,70 point, qui pèsent d'autant plus que le stop est serré.
const COUT_PTS = 0.25 * 2 + 4.00 / 20;
const RISQUE_E = +(args.risque || 250);     // 0,5 % d'un compte de 50 000 €
let POSITION = null;                        // js/position.js, chargé avec le modèle

// Le suivi vit dans js/position.js et NULLE PART AILLEURS. Ce banc d'essai en
// gardait sa propre copie ; elle a divergé du robot — il mesurait un partiel à
// 0,5 R pendant que le robot en passait un à 0,4 R, et personne ne l'a vu
// avant de comparer les deux à la main. Ici on ne fait plus qu'adapter les
// arguments et traduire les noms d'issue.
function suivre(s, apres, cfg, prudent, maxBarres, heure, jourSignal) {
  const r = POSITION.suivre(s, apres, cfg, {
    prudent: prudent, maxBarres: maxBarres, heure: heure, jourSignal: jourSignal
  });
  if (r.ouverte) return null;
  const o = { stop: 'perte', seuil: 'partiel', objectif: 'gain',
              horaire: 'horaire', 'expiré': 'ambigu' }[r.sortie] || r.sortie;
  return { r: r.r, o: o, barres: r.barres, flou: r.ambigu };
}

function passe(M, D, cfg, D2) {
  Object.assign(M.CFG, cfg);
  const d = M.evaluer(D, D2);
  if (!d) return [];
  const T = [];
  for (const s of (d.tousSignaux || [])) {
    const apres = D.m5.filter(c => c.t > s.t);
    const jourSig = M.heure(s.t).jour;
    const opt = suivre(s, apres, M.CFG, false, 200, M.heure, jourSig);
    const pru = suivre(s, apres, M.CFG, true, 200, M.heure, jourSig);
    if (!opt || !pru) continue;                 // position non dénouée : écartée
    const cout = COUT_PTS / s.risq;
    T.push({ r: opt.r, rnet: opt.r - cout, o: opt.o,
             rp: pru.r, rpnet: pru.r - cout, op: pru.o, flou: opt.flou,
             risq: s.risq, t: s.t, sens: s.sens, niveau: s.niveau,
             entree: s.entree, sl: s.sl, tp1: s.tp1, tp: s.tp, tf: s.tf,
             jour: M.heure(s.t).jour, min: M.heure(s.t).min, barres: opt.barres,
             rr: cfg.part * cfg.tp1 + (1 - cfg.part) * cfg.tp2 });
  }
  return T;
}

function mesurer(T, champ) {
  const K = champ || 'rnet', n = T.length; if (!n) return null;
  const R = T.reduce((a, x) => a + x[K], 0), moy = R / n;
  const sd = n > 1 ? Math.sqrt(T.reduce((a, x) => a + (x[K] - moy) ** 2, 0) / (n - 1)) : 0;
  const se = sd / Math.sqrt(n);
  const pos = T.filter(x => x[K] > 0), neg = T.filter(x => x[K] < 0);
  const gains = pos.reduce((a, x) => a + x[K], 0);
  const pertes = Math.abs(neg.reduce((a, x) => a + x[K], 0));
  const gMoy = pos.length ? gains / pos.length : 0, pMoy = neg.length ? pertes / neg.length : 0;
  let pic = 0, cum = 0, dd = 0;
  for (const x of T.slice().sort((a, b) => a.t - b.t)) {
    cum += x[K]; if (cum > pic) pic = cum; if (pic - cum > dd) dd = pic - cum;
  }
  const seuil = (gMoy + pMoy) > 0 ? pMoy / (gMoy + pMoy) * 100 : 0;
  return { n, wr: pos.length / n * 100, esp: moy, R, euros: R * RISQUE_E,
           dd, ddE: dd * RISQUE_E, pf: pertes > 0 ? gains / pertes : Infinity,
           se, t: se ? moy / se : 0, gMoy, pMoy, seuil,
           marge: pos.length / n * 100 - seuil,
           flou: T.filter(x => x.flou > 0).length / n * 100,
           minutes: T.reduce((a, x) => a + x.barres, 0) / n * 5 };
}

// ══════════════════════════════════════════════════════════════ affichage ══
const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + 'h' + String(m % 60).padStart(2, '0');
const lisible = c => `${hm(c.ghDeb)}-${hm(c.ghFin)} tp1 ${c.tp1} pt ${c.part} tp2 ${c.tp2} ` +
                     `s${c.seuil} f${c.fvgn} atr ${c.atrMin} rx ${c.react} ka ${c.keyAge} mj ${c.maxJour}`;
function tableau(lignes, tri, top) {
  const clef = { prudent: x => x.pru.esp, optimiste: x => x.opt.esp, euros: x => x.pru.euros,
                 robuste: x => (x.pruB && x.pruB.esp > 0 && x.pru.esp > 0 ? Math.min(x.pru.esp, x.pruB.esp) : -9) };
  const f = clef[tri] || clef.prudent;
  lignes.sort((a, b) => f(b) - f(a));
  const s = n => (n >= 0 ? '+' : '') + n.toFixed(3);
  const e = n => ((n >= 0 ? '+' : '') + Math.round(n)).padStart(6) + ' €';
  console.log('  n  │ OPTIMISTE (objectif d\'abord) │ PRUDENT (stop d\'abord)                  │ bougies │ 2e moitié  │ réglages');
  console.log('     │ gagnés   par trade   total   │ gagnés   par trade   total     creux    │ ambiguës│  par trade │');
  for (const x of lignes.slice(0, top || 15)) {
    console.log(`${String(x.opt.n).padStart(4)} │ ${x.opt.wr.toFixed(1).padStart(5)}%  ${e(x.opt.esp * RISQUE_E)}  ${e(x.opt.euros)} │` +
      ` ${x.pru.wr.toFixed(1).padStart(5)}%  ${e(x.pru.esp * RISQUE_E)}  ${e(x.pru.euros)}  ${('-' + Math.round(x.pru.ddE)).padStart(6)} € │` +
      ` ${x.opt.flou.toFixed(0).padStart(6)}% │ ${x.pruB ? e(x.pruB.esp * RISQUE_E).padStart(10) : '       n/a'} │ ${lisible(x.cfg)}`);
  }
}

// ═════════════════════════════════════════════════════════════════ grilles ══
// Les réglages de départ sont ceux de js/modele.js, pas une copie qui se
// désynchronise. C'est déjà arrivé : le banc d'essai mesurait un partiel à
// 0,5 R pendant que le robot en passait un à 0,4 R.
const BASE = Object.assign({}, chargerModele().CFG);

function grille(mode) {
  const g = [];
  if (mode === 'fenetres') {
    for (let d = 0; d < 1440; d += 30) for (const dur of [30, 60, 90, 120])
      if (d + dur <= 1440) g.push(Object.assign({}, BASE, { ghDeb: d, ghFin: d + dur }));
  } else if (mode === 'sorties') {
    const F = (args.fenetres || '540:600,60:150,90:150,90:210').split(',').map(x => x.split(':').map(Number));
    for (const [a, b] of F)
      for (const tp1 of [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0])
        for (const part of [0, 0.3, 0.5, 0.7, 0.9, 1.0])
          for (const tp2 of [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 6.0]) {
            if (tp2 <= tp1) continue;
            if (part === 1.0 && tp2 !== 2.5) continue;    // tp2 n'a plus d'effet
            g.push(Object.assign({}, BASE, { ghDeb: a, ghFin: b, tp1, part, tp2 }));
          }
  } else if (mode === 'tout') {
    // Recherche aléatoire sur les ONZE réglages à la fois. Balayer un réglage
    // à la fois fait manquer les combinaisons ; c'est ainsi qu'on est passé à
    // côté du fait que la fenêtre gagnante dépend du réglage du partiel.
    // Générateur déterministe pour que le tirage soit rejouable à l'identique.
    let s = (+(args.graine || 20260925)) >>> 0;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const pick = a => a[Math.floor(rnd() * a.length)];
    const DEB = []; for (let d = 0; d < 1440; d += 15) DEB.push(d);
    const vus = new Set(), N = +(args.n || 4000);
    let essais = 0;
    while (g.length < N && essais < N * 100) {
      essais++;
      const a = pick(DEB), dur = pick([30, 45, 60, 90, 120, 180]); if (a + dur > 1440) continue;
      const tp1 = pick([0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0]);
      const tp2 = pick([1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0]); if (tp2 <= tp1) continue;
      const c = { ghDeb: a, ghFin: a + dur, tp1, tp2, part: pick([0, 0.3, 0.5, 0.7, 0.9, 1.0]),
        seuil: pick([1, 2, 3]), fvgn: pick([1, 2, 3]), atrMin: pick([0.2, 0.3, 0.5, 0.8, 1.2]),
        react: pick([6, 12, 20, 30]), keyAge: pick([100, 400, 1000]), maxJour: pick([1, 2, 3]), buf: 0.02 };
      const k = JSON.stringify(c); if (vus.has(k)) continue; vus.add(k); g.push(c);
    }
  }
  return g;
}

// ═══════════════════════════════════════════════════════════════ ouvriers ══
// Une passe coûte ~0,3 s ; quatre mille passes en série feraient vingt
// minutes sur un seul cœur. Le travail est donc découpé entre les cœurs.
async function ouvrier() {
  const M = chargerModele();
  const D = await charger(args.sym || 'NQ=F');
  const g = JSON.parse(fs.readFileSync(args.grille, 'utf-8'));
  const CONF = M.CFG.confirme2 ? await confirmateur() : null;
  const jours = [...new Set(D.m5.map(c => M.heure(c.t).jour))].sort();
  const COUPE = jours[Math.floor(jours.length / 2)];      // découpe hors-échantillon
  const out = [];
  for (let i = +args.de; i < +args.a && i < g.length; i++) {
    let T; try { T = passe(M, D, g[i], CONF); } catch (e) { continue; }
    const opt = mesurer(T); if (!opt) continue;
    out.push({ cfg: g[i], opt, pru: mesurer(T, 'rpnet'),
               optA: mesurer(T.filter(x => x.jour < COUPE)),
               pruB: mesurer(T.filter(x => x.jour >= COUPE), 'rpnet') });
  }
  process.stdout.write(JSON.stringify(out));
}

async function chef() {
  await charger(args.sym || 'NQ=F');                      // remplit le cache une fois
  const g = grille(MODE);
  const f = path.join(CACHE, 'grille.json');
  fs.writeFileSync(f, JSON.stringify(g));
  const P = Math.max(1, Math.min(4, os.cpus().length)), pas = Math.ceil(g.length / P);
  console.log(`${g.length} configurations · ${P} cœurs\n`);
  const parts = await Promise.all(Array.from({ length: P }, (_, k) => new Promise(res => {
    const p = spawn(process.execPath, [__filename, 'ouvrier', '--grille', f,
      '--de', String(k * pas), '--a', String((k + 1) * pas), '--sym', args.sym || 'NQ=F'],
      { env: process.env, stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = ''; p.stdout.on('data', d => buf += d);
    p.on('close', () => { try { res(JSON.parse(buf)); } catch (e) { res([]); } });
  })));
  const lignes = [].concat(...parts).filter(x => x.opt.n >= +(args.minn || 25));
  console.log(`${lignes.length} configurations avec au moins ${args.minn || 25} trades\n`);
  for (const tri of (args.tri || 'prudent,robuste,optimiste').split(',')) {
    console.log(`── classement par ${tri} ──────────────────────────────────────────`);
    tableau(lignes, tri, +(args.top || 12));
    console.log('');
  }
  if (args.sortie) fs.writeFileSync(args.sortie, JSON.stringify(lignes));
}

// ═══════════════════════════════════════════════════════════════ arbitrage ══
// Yahoo sert le 1 minute sur 8 jours. Sur ces 8 jours l'ordre des touches est
// CONNU : on peut donc dire laquelle des deux conventions dit la vérité, au
// lieu d'encadrer le résultat entre les deux.
async function arbitre() {
  const M = chargerModele(), D = await charger(args.sym || 'NQ=F');
  const m1 = D.m1, T0 = m1[0].t;
  const cas = (args.cas ? JSON.parse(args.cas) : [{ ghDeb: 540, ghFin: 600 }, { ghDeb: 60, ghFin: 150 }]);
  for (const c of cas) {
    const cfg = Object.assign({}, BASE, c);
    const T = passe(M, D, cfg, M.CFG.confirme2 ? await confirmateur() : null).filter(x => x.t > T0);
    let so = 0, sp = 0, sv = 0, n = 0, amb = 0, jOpt = 0, jPru = 0;
    for (const x of T) {
      const v = suivre(x, m1.filter(k => k.t > x.t), cfg, true, 1200, M.heure, M.heure(x.t).jour);
      if (!v) { amb++; continue; }
      const cout = COUT_PTS / x.risq;
      n++; so += x.rnet; sp += x.rpnet; sv += v.r - cout;
      if (Math.abs(x.r - v.r) < 1e-9) jOpt++;
      if (Math.abs(x.rp - v.r) < 1e-9) jPru++;
    }
    console.log(`${lisible(cfg)}`);
    console.log(`   ${n} positions rejouées en 1 minute` + (amb ? ` (${amb} non dénouées)` : ''));
    console.log(`   R total : optimiste ${(so >= 0 ? '+' : '') + so.toFixed(2)} · ` +
                `prudent ${(sp >= 0 ? '+' : '') + sp.toFixed(2)} · ` +
                `VÉRITÉ ${(sv >= 0 ? '+' : '') + sv.toFixed(2)}  (${Math.round(sv * RISQUE_E)} €)`);
    console.log(`   verdict juste : optimiste ${jOpt}/${n} · prudent ${jPru}/${n}\n`);
  }
}

// ═════════════════════════════════════════════════════════════════ rapport ══
// Le backtest complet du réglage EFFECTIVEMENT appliqué, découpé de toutes les
// façons qui peuvent le contredire : par mois, par sens, par unité, par niveau,
// et sur les autres contrats.
async function rapport() {
  const M = chargerModele();
  const syms = (args.syms || 'NQ=F').split(',');
  for (const sym of syms) {
    let D; try { D = await charger(sym); } catch (e) { console.log(`\n${sym} : ${e.message}`); continue; }
    const T = passe(M, D, {}, M.CFG.confirme2 ? await confirmateur() : null);
    if (!T.length) { console.log(`\n${sym} : aucun signal`); continue; }
    const C = M.CFG;
    const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ' h ' + String(m % 60).padStart(2, '0');
    // ── TOUT EN EUROS ET EN POURCENTS ────────────────────────────────────
    // Le R est une unité de travail : « 1 R » veut dire « ce qu'on risque sur
    // un trade ». Utile pour comparer des marchés, illisible pour savoir ce
    // qu'on gagne. Chaque ligne donne donc le gain MOYEN PAR TRADE en euros,
    // et le R reste entre parenthèses pour qui veut comparer.
    const eur = x => (x >= 0 ? '+' : '') + Math.round(x) + ' €';
    const g = (m, n) => m ? `${String(n).padEnd(14)} ${String(m.n).padStart(4)} trades · ` +
      `${m.wr.toFixed(1).padStart(5)} % gagnés · ${eur(m.esp * RISQUE_E).padStart(7)} par trade · ` +
      `${eur(m.euros).padStart(8)} au total` : '';
    if (syms.length > 1 || sym !== 'NQ=F') console.log(`\n╔══ ${sym} ══╗`);
    const o = mesurer(T), p = mesurer(T, 'rpnet');
    if (sym === syms[0]) {
      console.log(`\nRéglages lus dans js/modele.js :`);
      console.log(`   fenêtre ${hm(C.ghDeb)} → ${hm(C.ghFin)} New York · stop × ${C.slx} · partiel ${C.tp1} R sur ${Math.round(C.part * 100)} % · ` +
                  `runner ${C.tp2} R · solde au marché à ${hm(C.sortieMin)} · ${C.maxJour} trades/jour max`);
      console.log(`   biais seuil ${C.seuil}/4 · ${C.fvgn} FVG par unité · niveau ≤ ${C.keyAge} bougies · ${C.react} bougies entre touche et IFVG`);
      console.log(`   risque ${RISQUE_E} € par trade · frais 0,70 point (0,25 pt de slippage par côté + 4,00 $)\n`);
    }
    const gagnants = Math.round(p.wr / 100 * p.n), perdants = p.n - gagnants;
    console.log('── ENSEMBLE ────────────────────────────────────────────────────────');
    console.log(`   ${p.n} trades sur la période · stop moyen ${(T.reduce((a, x) => a + x.risq, 0) / T.length).toFixed(0)} pts · durée moyenne ${o.minutes.toFixed(0)} min`);
    console.log(`   ${gagnants} gagnants, ${perdants} perdants  →  ${p.wr.toFixed(1)} % de réussite`);
    console.log(`   il en faut ${p.seuil.toFixed(1)} % pour ne rien perdre  →  marge de ${(p.marge >= 0 ? '+' : '') + p.marge.toFixed(1)} points`);
    console.log('');
    console.log(`   un trade gagnant rapporte en moyenne   ${eur(p.gMoy * RISQUE_E).padStart(8)}`);
    console.log(`   un trade perdant coûte en moyenne      ${eur(-p.pMoy * RISQUE_E).padStart(8)}`);
    console.log(`   donc en moyenne, par trade             ${eur(p.esp * RISQUE_E).padStart(8)}`);
    console.log(`   sur les ${String(p.n).padStart(3)} trades de la période        ${eur(p.euros).padStart(8)}`);
    console.log('');
    console.log(`   pire creux traversé                    ${eur(-p.ddE).padStart(8)}`);
    console.log(`   pour 1 € perdu, ${p.pf === Infinity ? '∞' : p.pf.toFixed(2)} € gagnés (profit factor)`);
    console.log(`   bougies ambiguës ${o.flou.toFixed(0)} % · comptage optimiste : ${o.wr.toFixed(1)} % et ${eur(o.euros)}`);
    console.log(`   fourchette de confiance à 95 % : entre ${eur((p.esp - 1.96 * p.se) * RISQUE_E)} et ${eur((p.esp + 1.96 * p.se) * RISQUE_E)} par trade`);
    if (p.esp - 1.96 * p.se <= 0) console.log(`   ⚠️ la fourchette passe par zéro : l'avantage n'est PAS prouvé, il peut être nul`);
    else console.log(`   ✅ la fourchette ne passe pas par zéro : l'avantage tient sur cet échantillon`);
    for (const [titre, cle] of [['PAR MOIS', x => x.jour.slice(0, 7)], ['PAR SENS', x => x.sens],
                                ['PAR UNITÉ DE L\'IFVG', x => x.tf || '?'], ['PAR FAMILLE DE NIVEAU', x => String(x.niveau).split(' ')[0]]]) {
      console.log(`\n── ${titre} ──────────────────────────────────────────────`);
      const gr = {}; T.forEach(x => { const k = cle(x); (gr[k] = gr[k] || []).push(x); });
      Object.keys(gr).sort().forEach(k => console.log('   ' + g(mesurer(gr[k], 'rpnet'), k)));
    }
    console.log('');
  }
}

(async () => {
  if (MODE === 'ouvrier') return ouvrier();
  if (MODE === 'rapport') return rapport();
  if (MODE === 'arbitre') return arbitre();
  return chef();
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
