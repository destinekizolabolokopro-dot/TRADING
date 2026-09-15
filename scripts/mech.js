#!/usr/bin/env node
'use strict';
/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  LE MECH MODEL — une seule stratégie, une seule implémentation.       ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 *   BIAIS HAUTE UNITÉ + DOL
 *     → NIVEAU CLÉ
 *       → BALAYAGE ITL / ITH
 *         → TOUCHE, puis RETOUR (le « x »)
 *           → IFVG, plus haute unité valide dans la jambe
 *             → CLÔTURE DE CORPS
 *               → ENTRÉE
 *
 * Les paramètres ci-dessous ne sont PAS des variantes de stratégie : ce sont
 * les seuls endroits où aucune source ne dit quoi faire. Chacun a une valeur
 * par défaut, et le modèle tourne sans qu'on y touche.
 *
 *   node scripts/mech.js                      → la stratégie, réglages par défaut
 *   node scripts/rapport.js --moteur scripts/mech.js   → le rapport complet
 */

const ST = require('./lib/structure.js');
const YF = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1]; });

const SYM     = args.sym || 'NQ=F';
const RANGE   = args.range || '60d';
const HORLOGE = args.horloge || '5m';
const DU = args.du || '', AU = args.au || '';
const DUMP = args.dump === '1';

// ─── fenêtre de séance ─────────────────────────────────────── [COMM/SCHÉMA]
// L'indicateur public dit 09h30–11h00 ET. Les planches marquent 10h00 et 10:15.
// Aucun des deux n'est une règle énoncée : on garde la fenêtre large.
const GHDEB = args.ghdeb || '09:30', GHFIN = args.ghfin || '11:00';
const MAXJOUR = +(args.maxjour || 2);

// ─── biais : score de respect des FVG 1D / 4H / 1H / 15M ────────── [COMM]
const SEUIL = +(args.seuil || 2);              // [COMM] la source donne 2 par défaut
const FVGN  = +(args.fvgn || 1);               // [HYP] FVG résolus comptés par unité

// ─── niveaux clés ────────────────────────────────────────────────── [COMM]
const FAMILLES = (args.familles || 'fvg,itlith,cisd,rb').split(',');
const KEYAGE   = +(args.keyage || 400);        // [HYP] âge max, en bougies de l'unité

// ─── balayage ITL / ITH ──────────────────────────────────── [SCHÉMA + ICT]
const SWEEP    = args.sweep !== '0';
const SWEEPAGE = +(args.sweepage || 30);       // [HYP] bougies max entre balayage et entrée

// ─── le « x » : second passage dans la zone ─────────────────────── [SCHÉMA]
const TOUCHE2 = args.touche2 === '1';          // [HYP] le schéma le montre, sans dire s'il est requis
const SORTIEZ = +(args.sortiez || 0.25);

// ─── sortie ──────────────────────────────────────────────────────── [COMM]
// Deux sources concordent : objectif court, 1 R partiel puis runner. Le RR
// moyen annoncé est de 1,19 et le maximum de 2,44.
const TP1  = +(args.tp1 || 1.0);
const TP2  = +(args.tp2 || 2.5);
const PART = +(args.part || 0.5);              // [HYP] fraction encaissée à TP1

// ─── garde-fous ────────────────────────────────────────────────────── [HYP]
const BUF    = +(args.buffer || 0.02);         // tampon du stop, en % du prix
const ATRMIN = +(args.atrmin || 0.5);          // stop minimum, en fraction d'ATR
const REACT  = +(args.react || 12);            // bougies max entre touche et IFVG

// ═══════════════════════════════════════════════════════════════ données ══
async function fetchCandles(sym, interval, range) {
  const r = await fetch(`${YF}${encodeURIComponent(sym)}?interval=${interval}&range=${range}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`${sym} ${interval} : HTTP ${r.status}`);
  const j = await r.json();
  const res = j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error(`${sym} ${interval} : ${(j.chart.error || {}).description || 'vide'}`);
  const q = res.indicators.quote[0], out = [];
  for (let i = 0; i < res.timestamp.length; i++) {
    if (q.open[i] == null || q.close[i] == null) continue;
    out.push({ t: res.timestamp[i] * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] });
  }
  return out;
}

const fmtET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false,
  weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function heure(t) {
  const o = {}; fmtET.formatToParts(new Date(t)).forEach(p => o[p.type] = p.value);
  let h = +o.hour; if (h === 24) h = 0;
  return { jour: `${o.year}-${o.month}-${o.day}`, dow: DOW[o.weekday], min: h * 60 + (+o.minute) };
}
const hhmm = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const GH_DEB = hhmm(GHDEB), GH_FIN = hhmm(GHFIN);

// ═══════════════════════════════════════════════════════════ la stratégie ══
function mech(D) {
  const { m1, m2, m5, m15, h1, d1 } = D;
  const clock = HORLOGE === '1m' ? m1 : HORLOGE === '2m' ? m2 : m5;

  // ── unités dérivées ──────────────────────────────────────────────────────
  // Yahoo ne sert ni le 3 minutes au-delà de 8 jours, ni le 4 heures : le M30
  // et le H4 sont agrégés. Le M3 de la référence est donc absent, et c'est dit.
  const m30 = ST.agreger(m15, 2), h4 = ST.agreger(h1, 4);

  // ── biais : FVG résolus par unité, dans l'ordre 1D, 4H, 1H, 15M ─── [COMM]
  // « respecté »  : le prix est entré dans la zone et en est ressorti du bon
  //                 côté, sans qu'une bougie clôture au-delà        [HYP]
  // « non respecté » : une bougie a clôturé au-delà, côté opposé     [HYP]
  const prepBiais = [d1, h4, h1, m15].map(cs => {
    const out = [];
    ST.fvgs(cs).forEach(z => {
      const iRes = z.casse != null ? z.casse : z.touche;
      if (iRes == null) return;
      const respecte = z.casse == null;
      out.push({ t: cs[iRes].t, c: (z.haussier ? 1 : -1) * (respecte ? 1 : -1) });
    });
    return out.sort((a, b) => a.t - b.t);
  });
  function biais(t) {
    let score = 0;
    for (const serie of prepBiais) {
      const d = serie.filter(r => r.t <= t).slice(-FVGN);
      const s = d.reduce((a, r) => a + r.c, 0);
      score += s > 0 ? 1 : s < 0 ? -1 : 0;
    }
    return score >= SEUIL ? 1 : score <= -SEUIL ? -1 : 0;   // 0 = illisible, on ne trade pas
  }

  // ── DOL : swing 1H non encore balayé, DANS le sens du biais ─────── [COMM]
  // Il sert UNIQUEMENT à vérifier qu'il reste du chemin à parcourir.
  // Il n'est JAMAIS un objectif : c'est l'erreur qui cassait le modèle, un
  // swing 1H se trouvant couramment à plus de mille points.
  const hierH1 = ST.hierarchie(h1);
  function dolLibre(t, dir, px) {
    const idx = ST.idxA(h1, t); if (idx < 0) return false;
    const liste = dir > 0 ? hierH1.ith : hierH1.itl;
    for (const sw of liste) {
      if (sw.vu > t) continue;
      if (dir > 0 ? sw.prix <= px : sw.prix >= px) continue;
      let pris = false;
      for (let k = sw.i + 1; k <= idx; k++)
        if (dir > 0 ? h1[k].h > sw.prix : h1[k].l < sw.prix) { pris = true; break; }
      if (!pris) return true;                       // au moins une poche de liquidité intacte
    }
    return false;
  }

  // ── NIVEAUX CLÉS : 4 familles × 5 unités ────────────────────────── [COMM]
  const UNITES = [{ cs: m5, n: 'M5' }, { cs: m15, n: 'M15' }, { cs: m30, n: 'M30' },
                  { cs: h1, n: 'H1' }, { cs: h4, n: 'H4' }];
  const niveaux = [];
  UNITES.forEach(u => {
    const ajoute = (zs, type) => zs.forEach(z => niveaux.push({
      type, tf: u.n, cs: u.cs, bas: z.bas, haut: z.haut, haussier: z.haussier,
      ne: z.ne, t: z.t, casse: z.casse == null ? null : z.casse }));
    if (FAMILLES.includes('fvg')) ajoute(ST.fvgs(u.cs), 'FVG');
    if (FAMILLES.includes('cisd')) ajoute(ST.cisd(u.cs), 'CISD');
    if (FAMILLES.includes('rb')) ajoute(ST.rejectionBlocks(u.cs), 'RB');
    if (FAMILLES.includes('itlith')) {
      const h = ST.hierarchie(u.cs);
      // Un ITL est un NIVEAU, pas une zone : on lui donne l'épaisseur de la
      // bougie qui l'a produit.  [HYP]
      h.itl.forEach(x => niveaux.push({ type: 'ITL', tf: u.n, cs: u.cs, bas: x.prix,
        haut: u.cs[x.i].h, haussier: true, ne: u.cs.length && x.i, t: x.vu, casse: null, vu: x.vu }));
      h.ith.forEach(x => niveaux.push({ type: 'ITH', tf: u.n, cs: u.cs, bas: u.cs[x.i].l,
        haut: x.prix, haussier: false, ne: x.i, t: x.vu, casse: null, vu: x.vu }));
    }
  });

  // ── hiérarchie de l'unité d'exécution, pour le balayage ITL/ITH ──── [ICT]
  const hierClock = ST.hierarchie(clock);

  // ── IFVG : zones par unité fine, on retiendra la plus haute valide ─ [COMM]
  const zIF = { '5m': ST.fvgs(m5), '2m': ST.fvgs(m2), '1m': ST.fvgs(m1) };
  const atrC = ST.atr(clock);

  const E = { barres: 0, biaisNeutre: 0, dolPris: 0, niveau: 0, sweepManquant: 0,
              touche: 0, ifvg: 0, stopTropSerre: 0, entrees: 0 };
  const trades = [];
  let ouverte = null, parJour = {};
  let etat = 'CHERCHE', dir = 0, key = null, tTouche = 0, legDeb = 0, swept = null;

  for (let i = 30; i < clock.length; i++) {
    const bar = clock[i], e = heure(bar.t), px = bar.c;

    // ── suivi de la position ────────────────────────────────────────────
    if (ouverte) {
      const p = ouverte, L = p.sens === 'LONG';
      const touche = (niv) => L ? bar.h >= niv : bar.l <= niv;
      const stoppe = () => L ? bar.l <= p.sl : bar.h >= p.sl;
      if (!p.part1 && touche(p.tp1)) { p.part1 = true; p.sl = p.entree; }   // partiel + seuil
      if (p.part1 && touche(p.tp2)) { p.sortie = 'gain'; p.r = PART * TP1 + (1 - PART) * TP2; }
      else if (stoppe()) {
        if (p.part1) { p.sortie = 'gain partiel'; p.r = PART * TP1; }
        else { p.sortie = 'perte'; p.r = -1; }
      } else if (i - p.i > 200) {
        const rBrut = (L ? bar.c - p.entree : p.entree - bar.c) / p.risq;
        p.sortie = 'expiré';
        p.r = p.part1 ? PART * TP1 + (1 - PART) * Math.max(0, Math.min(TP2, rBrut))
                      : Math.max(-1, Math.min(TP2, rBrut));
      }
      if (p.sortie) { trades.push(p); ouverte = null; } else continue;
    }

    if (parJour[e.jour] === undefined) { parJour[e.jour] = 0; etat = 'CHERCHE'; key = null; swept = null; }
    if (DU && e.jour < DU) continue;
    if (AU && e.jour > AU) continue;
    if (e.dow < 1 || e.dow > 5 || e.min < GH_DEB || e.min >= GH_FIN) continue;
    if (parJour[e.jour] >= MAXJOUR) continue;
    E.barres++;

    // ── 1. BIAIS ────────────────────────────────────────────────────────
    const b = biais(bar.t);
    if (b === 0) { E.biaisNeutre++; continue; }
    if (b !== dir) { dir = b; etat = 'CHERCHE'; key = null; swept = null; }   // le contexte a tourné

    // ── 2. DOL : reste-t-il du chemin ? ─────────────────────────────────
    if (!dolLibre(bar.t, dir, px)) { E.dolPris++; continue; }

    // ── 3. NIVEAU CLÉ ───────────────────────────────────────────────────
    if (etat === 'CHERCHE') {
      let best = null;
      for (const z of niveaux) {
        const idx = ST.idxA(z.cs, bar.t);
        if (z.ne == null || z.ne > idx || idx - z.ne > KEYAGE) continue;
        if (z.vu && z.vu > bar.t) continue;               // pas encore connaissable
        if (z.casse != null && z.casse <= idx) continue;  // invalidé
        if (z.haussier !== (dir > 0)) continue;           // du bon côté
        const d = dir > 0 ? px - z.haut : z.bas - px;
        if (d < 0) continue;                              // déjà dépassé
        if (!best || d < best.d) best = { z, d };
      }
      if (best) { key = best.z; etat = 'ATTEND_TOUCHE'; E.niveau++; key.t1 = false; key.sorti = false; }
    }

    // ── 4. BALAYAGE ITL / ITH ───────────────────────────────── [SCHÉMA+ICT]
    // Pour un long : un ITL doit avoir été pris — mèche EN DESSOUS, clôture
    // qui REVIENT au-dessus. Une clôture sous le niveau n'est pas un balayage
    // mais une cassure de structure, et elle annule le contexte.
    if (SWEEP && etat !== 'CHERCHE') {
      const liste = dir > 0 ? hierClock.itl : hierClock.ith;
      swept = null;
      for (let k = liste.length - 1; k >= 0; k--) {
        const sw = liste[k];
        if (sw.vu > bar.t) continue;
        for (let j = Math.max(sw.i + 1, i - SWEEPAGE); j <= i; j++) {
          const mecheDehors = dir > 0 ? clock[j].l < sw.prix : clock[j].h > sw.prix;
          const clotureDedans = dir > 0 ? clock[j].c > sw.prix : clock[j].c < sw.prix;
          if (mecheDehors && clotureDedans) { swept = { niveau: sw.prix, j, ext: dir > 0 ? clock[j].l : clock[j].h }; break; }
        }
        if (swept) break;
      }
      if (!swept) { E.sweepManquant++; continue; }
    }

    // ── 5. TOUCHE, puis RETOUR ──────────────────────────────────────────
    if (etat === 'ATTEND_TOUCHE' && key) {
      const dedans = bar.l <= key.haut && bar.h >= key.bas;
      if (dedans) {
        if (TOUCHE2 && !key.sorti) key.t1 = true;
        else { etat = 'ATTEND_IFVG'; tTouche = bar.t; legDeb = i; E.touche++; }
      } else if (TOUCHE2 && key.t1) {
        const ep = (key.haut - key.bas) * SORTIEZ;
        if (dir > 0 ? px > key.haut + ep : px < key.bas - ep) key.sorti = true;
      }
      if (etat === 'ATTEND_TOUCHE' && (dir > 0 ? px < key.bas : px > key.haut) && !(TOUCHE2 && key.t1)) {
        key = null; etat = 'CHERCHE';
      }
    }

    // ── 6. IFVG, plus haute unité valide dans la jambe ──────────── [COMM]
    if (etat === 'ATTEND_IFVG' && key) {
      if (i - legDeb > REACT) { etat = 'CHERCHE'; key = null; continue; }
      let choisi = null;
      for (const tf of ['5m', '2m', '1m']) {
        for (const z of zIF[tf]) {
          if (z.tCasse == null || z.tCasse < tTouche || z.tCasse > bar.t) continue;
          if ((z.haussier ? -1 : 1) !== dir) continue;      // un FVG cassé donne l'inversion opposée
          choisi = { z, tf }; break;
        }
        if (choisi) break;
      }
      if (!choisi) continue;
      E.ifvg++;

      // ── 7. ENTRÉE ─────────────────────────────────────────────────────
      const L = dir > 0, entree = px, buf = entree * BUF / 100;
      // ── 8. STOP : l'extrémité de la jambe de manipulation ────── [COMM]
      //    « the manipulation swing as a visual stop reference ». Quand un
      //    balayage a eu lieu, son extrémité EST cette extrémité.
      const base = swept ? swept.ext : (L ? choisi.z.bas : choisi.z.haut);
      const sl = L ? Math.min(base, choisi.z.bas) - buf : Math.max(base, choisi.z.haut) + buf;
      const risq = Math.abs(entree - sl);
      if (!(risq > 0) || !atrC[i] || risq < atrC[i] * ATRMIN) { E.stopTropSerre++; continue; }

      // ── 9. SORTIE : 1 R partiel puis runner ──────────────────── [COMM]
      ouverte = { sens: L ? 'LONG' : 'SHORT', i, t: bar.t, entree, sl, sl0: sl, risq,
        tp1: L ? entree + risq * TP1 : entree - risq * TP1,
        tp2: L ? entree + risq * TP2 : entree - risq * TP2,
        rr: PART * TP1 + (1 - PART) * TP2, part1: false,
        jour: e.jour, minET: e.min, tf: choisi.tf, niveau: key.type + ' ' + key.tf,
        sweep: swept ? +swept.niveau.toFixed(2) : null };
      parJour[e.jour]++; E.entrees++;
      etat = 'CHERCHE'; key = null;
    }
  }
  trades.entonnoir = E;
  return trades;
}

// ═══════════════════════════════════════════════════════════════════════════
(async () => {
  const [m1, m2, m5, m15, h1, d1] = await Promise.all([
    fetchCandles(SYM, '1m', '8d'), fetchCandles(SYM, '2m', RANGE),
    fetchCandles(SYM, '5m', RANGE), fetchCandles(SYM, '15m', RANGE),
    fetchCandles(SYM, '1h', '6mo'), fetchCandles(SYM, '1d', '1y')
  ]);
  const trades = mech({ m1, m2, m5, m15, h1, d1 });
  if (DUMP) {
    console.log(JSON.stringify({ entonnoir: trades.entonnoir, trades: trades.map(x => ({
      r: +x.r.toFixed(4), o: x.sortie, sens: x.sens, d: x.jour, h: x.minET, tf: x.tf,
      niveau: x.niveau, sweep: x.sweep, e: +x.entree.toFixed(2), sl: +x.sl0.toFixed(2),
      risq: +x.risq.toFixed(2), rr: +x.rr.toFixed(3) })) }));
    return;
  }
  console.log(`${trades.length} trades`);
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
