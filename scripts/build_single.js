#!/usr/bin/env node
'use strict';
/**
 * Construit une version 100 % autonome de TRADEassist :
 * remplace chaque <script src="js/X.js"></script> par le contenu inline du fichier,
 * pour obtenir un seul fichier HTML qui marche par double-clic (file://), sans serveur.
 *   node scripts/build_single.js [chemin/sortie.html]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const out = process.argv[2] || path.join(ROOT, 'TRADEassist.html');
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// La liste était écrite en dur, et js/mesure.js n'y figurait pas : sa balise
// restait une référence relative. Le fichier autonome marchait donc tant qu'on
// l'ouvrait à côté du dossier js/, et perdait silencieusement le module dès
// qu'on le déplaçait — c'est-à-dire dans le seul cas où « autonome » compte.
// On lit désormais les balises DANS la page : plus rien ne peut être oublié.
const balises = [...html.matchAll(/<script src="(js\/[^"]+\.js)"><\/script>/g)].map(m => m[1]);
if (!balises.length) { console.error('Aucune balise <script src="js/…"> trouvée.'); process.exit(1); }
console.log('Modules à inliner :', balises.length, '·', balises.map(b => b.slice(3)).join(' '));
balises.forEach((rel) => {
  const tag = `<script src="${rel}"></script>`;
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { console.error('⚠️ fichier introuvable :', rel); process.exit(1); }
  const code = fs.readFileSync(abs, 'utf8');
  // Remplacement par FONCTION, et non par chaîne : dans une chaîne de
  // remplacement, $' et $` sont des motifs spéciaux. Le code d'un module qui
  // contient « $' » — par exemple le symbole d'une devise — réinjectait tout
  // le reste du document et dupliquait le script.
  html = html.replace(tag, () => '<script>\n' + code + '\n</script>');
});

// Garde-fou : aucune référence relative ne doit survivre dans un fichier
// censé être autonome.
const reste = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
if (reste.length) { console.error('⚠️ références non inlinées :', reste.join(', ')); process.exit(1); }

fs.writeFileSync(out, html);
console.log('✅ Écrit :', out, '(' + Math.round(html.length / 1024) + ' Ko)');

// Même fichier publié sous docs/ : c'est ce dossier que GitHub Pages sert, pour
// pouvoir ouvrir le site depuis une simple adresse (tablette, téléphone) au lieu
// de balader un fichier .html d'un appareil à l'autre.
const docs = path.join(ROOT, 'docs');
fs.mkdirSync(docs, { recursive: true });
fs.writeFileSync(path.join(docs, 'index.html'), html);
fs.writeFileSync(path.join(docs, '.nojekyll'), '');   // pas de traitement Jekyll
console.log('✅ Écrit : docs/index.html (GitHub Pages)');

// Les données relevées par la tâche automatique sont recopiées à côté de la
// page : servies par Pages sur la MÊME origine, elles se lisent sans CORS et
// sans dépendre de raw.githubusercontent.com.
try {
  const src = path.join(__dirname, '..', 'data');
  const dst = path.join(__dirname, '..', 'docs', 'data');
  if (fs.existsSync(src)) {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src).filter(f => f.endsWith('.json')))
      fs.copyFileSync(path.join(src, f), path.join(dst, f));
    console.log('✅ Copié  : docs/data/  (' + fs.readdirSync(dst).join(', ') + ')');
  }
} catch (e) { console.error('Copie des données impossible : ' + e.message); }
