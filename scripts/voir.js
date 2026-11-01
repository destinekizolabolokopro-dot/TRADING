#!/usr/bin/env node
'use strict';
/**
 * DESSINER LE GRAPHIQUE POUR POUVOIR LE REGARDER — scripts/voir.js
 *
 * POURQUOI CE FICHIER EXISTE. Je ne reçois du marché que quatre nombres par
 * bougie. Je ne vois aucun graphique. Or les définitions de ce dépôt — CISD,
 * Rejection Block, « liquidité interne derrière le FVG » — sont marquées
 * UNCONFIRMED ASSUMPTION : la source les nomme sans les définir, et je les ai
 * traduites en code sans jamais pouvoir VÉRIFIER DE L'ŒIL que ma traduction
 * ressemble à ce que l'utilisateur voit sur son écran.
 *
 * Ce fichier ferme cette boucle. Il rend les bougies en image, puis l'image
 * est ouverte et regardée. Les chiffres redeviennent une forme.
 *
 * ⚠️  CE QUE ÇA NE DONNE PAS, ET IL FAUT LE DIRE D'ABORD. Dessiner une bougie
 * n'invente aucune information. Si une bougie contient le stop ET l'objectif,
 * l'image ne dira pas davantage que les nombres dans quel ORDRE les prix y
 * sont passés : cette information n'est pas dans la donnée, et aucun rendu ne
 * la fabriquera. L'ambiguïté intrabougie reste entière. Ce qui change, c'est
 * que je peux enfin juger la FORME : une structure que mon code appelle ITL
 * ressemble-t-elle à un ITL ? un FVG retenu est-il celui qu'un œil retiendrait ?
 *
 *   node scripts/voir.js --jour=2026-09-29 --unite=m5 --marche=NQ
 *   node scripts/voir.js --jour=2026-09-29 --marques=fvg,cisd,itl
 */
const fs = require('fs'), path = require('path');
const RACINE = path.resolve(__dirname, '..');
const SORTIE = process.env.SORTIE_VOIR ||
  '/tmp/claude-0/-home-user-TRADING/78f3686a-7362-513a-ac2d-b32b99e02a1c/scratchpad';

const ctx = {};
for (const f of ['js/structure.js', 'js/position.js', 'js/modele.js', 'js/dol.js', 'js/amd.js'])
  new Function('root', 'ST', fs.readFileSync(path.join(RACINE, f), 'utf-8')).call(ctx, ctx, ctx.ST);
const { ST, AMD } = ctx;

const arg = (n, d) => {
  const a = process.argv.find(x => x.startsWith('--' + n + '='));
  return a ? a.slice(n.length + 3) : d;
};
const MARCHE = arg('marche', 'NQ').toUpperCase();
const UNITE = arg('unite', 'm5');
const JOUR = arg('jour', null);
const MARQUES = arg('marques', 'fvg,itl,cisd').split(',').filter(Boolean);
const LARGEUR = +arg('largeur', 1600), HAUTEUR = +arg('hauteur', 900);

// ── les bougies : le jeu figé du dépôt, sinon le cache vivant ────────────
function bougies() {
  const fx = path.join(RACINE, 'data', 'fixture.json');
  if (fs.existsSync(fx)) {
    const J = JSON.parse(fs.readFileSync(fx, 'utf-8'));
    const M = J[MARCHE];
    if (M && M[UNITE]) return { src: 'data/fixture.json (jeu figé)',
      cs: M[UNITE].map(x => ({ t: x[0] * 1000, o: x[1], h: x[2], l: x[3], c: x[4] })) };
  }
  try {
    const Jeu = require('./lib/jeu.js');
    const S = Jeu.lireMarche(MARCHE + '=F', ctx.Modele.SERIES);
    if (S && S[UNITE] && S[UNITE].length) return { src: 'cache vivant', cs: S[UNITE] };
  } catch (e) { /* pas de cache */ }
  return null;
}

const B = bougies();
if (!B) { console.error('Aucune bougie : ni jeu figé ni cache pour ' + MARCHE + ' ' + UNITE + '.'); process.exit(1); }
let cs = B.cs;

// La journée demandée, en heure de New York — la même que celle des modèles,
// pas une conversion recopiée à la main.
if (JOUR) {
  cs = cs.filter(b => AMD.heure(b.t).jour === JOUR);
  if (!cs.length) {
    const dispo = [...new Set(B.cs.map(b => AMD.heure(b.t).jour))];
    console.error('Aucune bougie le ' + JOUR + '. Jours disponibles : ' + dispo.join(' '));
    process.exit(1);
  }
}
if (cs.length > 400) cs = cs.slice(-400);

// ── ce que mon code CROIT voir, pour pouvoir le confronter à l'image ─────
const annot = [];
if (MARQUES.includes('fvg'))
  ST.fvgs(cs).forEach(z => annot.push({ type: 'fvg', haussier: z.haussier, bas: z.bas, haut: z.haut,
                                        t: z.t, tFin: z.tTouche || null }));
if (MARQUES.includes('cisd'))
  ST.cisd(cs).forEach(z => annot.push({ type: 'cisd', haussier: z.haussier, bas: z.bas, haut: z.haut, t: z.t }));
if (MARQUES.includes('itl')) {
  const h = ST.hierarchie(cs);
  h.itl.forEach(s => annot.push({ type: 'itl', prix: s.prix, t: s.vu }));
  h.ith.forEach(s => annot.push({ type: 'ith', prix: s.prix, t: s.vu }));
}

const pas = ST.pasDe(cs);
const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Graphique</title><style>
  :root { --fond:#0b0f14; --grille:#1b2430; --texte:#c9d4e0; --doux:#6b7a8c;
          --haut:#1fb573; --bas:#e2495f; --fvgh:rgba(31,181,115,.18); --fvgb:rgba(226,73,95,.18);
          --cisd:#f0b429; --niv:#4a9eff; }
  html,body { margin:0; background:var(--fond); color:var(--texte);
              font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; }
  #t { padding:10px 14px 4px; font-size:14px; }
  #t b { color:#fff; } #t span { color:var(--doux); }
  canvas { display:block; }
  #lg { padding:6px 14px 12px; color:var(--doux); }
  #lg i { font-style:normal; padding:1px 6px; border-radius:3px; margin-right:10px; }
</style></head><body>
<div id="t"><b>${MARCHE} · ${UNITE}${JOUR ? ' · ' + JOUR : ''}</b>
  <span>&nbsp;${cs.length} bougies · ${B.src}</span></div>
<canvas id="c" width="${LARGEUR}" height="${HAUTEUR}"></canvas>
<div id="lg">
  <i style="background:var(--fvgh)">FVG haussier</i>
  <i style="background:var(--fvgb)">FVG baissier</i>
  <i style="color:var(--cisd)">— CISD</i>
  <i style="color:var(--niv)">— ITH / ITL (ce que mon code retient)</i>
</div>
<script>
const CS = ${JSON.stringify(cs)}, AN = ${JSON.stringify(annot)}, PAS = ${pas};
const c = document.getElementById('c'), x = c.getContext('2d');
const W = c.width, H = c.height, MG = { g:70, d:14, h:14, b:34 };
const lo = Math.min(...CS.map(b=>b.l)), hi = Math.max(...CS.map(b=>b.h));
const pad = (hi-lo)*0.06 || 1, LO = lo-pad, HI = hi+pad;
const px = i => MG.g + (i+0.5) * (W-MG.g-MG.d) / CS.length;
const py = p => MG.h + (HI-p) * (H-MG.h-MG.b) / (HI-LO);
const iDe = t => { for (let k=0;k<CS.length;k++) if (CS[k].t+PAS >= t) return k; return CS.length-1; };
const lg = Math.max(1.5, (W-MG.g-MG.d)/CS.length * 0.62);

// grille et échelle des prix
x.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grille').trim();
x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--doux').trim();
x.lineWidth = 1; x.font = '11px ui-monospace,monospace'; x.textAlign = 'right';
const pasP = Math.pow(10, Math.floor(Math.log10(HI-LO))) / 2;
for (let p = Math.ceil(LO/pasP)*pasP; p <= HI; p += pasP) {
  x.beginPath(); x.moveTo(MG.g, py(p)); x.lineTo(W-MG.d, py(p)); x.stroke();
  x.fillText(p.toFixed(pasP<1?2:0), MG.g-7, py(p)+4);
}
// l'heure, toutes les N bougies
x.textAlign = 'center';
const npas = Math.max(1, Math.round(CS.length/12));
for (let i=0;i<CS.length;i+=npas) {
  const d = new Date(CS[i].t);
  x.fillText(String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0'), px(i), H-12);
}

// les FVG en bandes, derrière les bougies
for (const a of AN.filter(a=>a.type==='fvg')) {
  const i0 = iDe(a.t), i1 = a.tFin ? iDe(a.tFin) : CS.length-1;
  x.fillStyle = a.haussier ? 'rgba(31,181,115,.18)' : 'rgba(226,73,95,.18)';
  x.fillRect(px(i0)-lg/2, py(a.haut), Math.max(3, px(i1)-px(i0)+lg), py(a.bas)-py(a.haut));
}
// les CISD
x.strokeStyle = '#f0b429'; x.setLineDash([5,4]);
for (const a of AN.filter(a=>a.type==='cisd')) {
  const i0 = iDe(a.t);
  x.beginPath(); x.moveTo(px(i0)-lg, py(a.haussier?a.haut:a.bas));
  x.lineTo(Math.min(W-MG.d, px(i0)+lg*14), py(a.haussier?a.haut:a.bas)); x.stroke();
}
// les ITH / ITL : à partir de l'instant où mon code les CONNAÎT, pas avant
x.strokeStyle = '#4a9eff'; x.setLineDash([2,3]);
for (const a of AN.filter(a=>a.type==='itl'||a.type==='ith')) {
  const i0 = iDe(a.t);
  x.beginPath(); x.moveTo(px(i0), py(a.prix)); x.lineTo(W-MG.d, py(a.prix)); x.stroke();
}
x.setLineDash([]);

// les bougies
for (let i=0;i<CS.length;i++) {
  const b = CS[i], mo = b.c >= b.o, col = mo ? '#1fb573' : '#e2495f';
  x.strokeStyle = col; x.fillStyle = col; x.lineWidth = Math.max(1, lg*0.16);
  x.beginPath(); x.moveTo(px(i), py(b.h)); x.lineTo(px(i), py(b.l)); x.stroke();
  const y0 = py(Math.max(b.o,b.c)), y1 = py(Math.min(b.o,b.c));
  x.fillRect(px(i)-lg/2, y0, lg, Math.max(1, y1-y0));
}
</script></body></html>`;

const fichierHtml = path.join(SORTIE, 'graphe.html');
const fichierPng = path.join(SORTIE, 'graphe_' + MARCHE + '_' + UNITE + (JOUR ? '_' + JOUR : '') + '.png');
fs.mkdirSync(SORTIE, { recursive: true });
fs.writeFileSync(fichierHtml, page);

(async () => {
  const { chromium } = require('playwright');
  const nav = await chromium.launch();
  const p = await nav.newPage({ viewport: { width: LARGEUR, height: HAUTEUR + 90 } });
  await p.goto('file://' + fichierHtml);
  await p.waitForTimeout(250);
  // Une erreur JS dans la page rendrait une image VIDE sans rien dire — le
  // défaut exact qui avait laissé le bandeau du site muet pendant un jour.
  const erreurs = [];
  p.on('pageerror', e => erreurs.push(e.message));
  await p.screenshot({ path: fichierPng });
  await nav.close();
  if (erreurs.length) { console.error('⚠️  ERREUR JS DANS LA PAGE : ' + erreurs.join(' | ')); process.exit(1); }
  console.log('✅ ' + fichierPng);
  console.log('   ' + cs.length + ' bougies · ' + annot.filter(a=>a.type==='fvg').length + ' FVG · ' +
    annot.filter(a=>a.type==='cisd').length + ' CISD · ' +
    annot.filter(a=>a.type==='itl'||a.type==='ith').length + ' niveaux ITH/ITL');
})();
