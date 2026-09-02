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

['js/history.js', 'js/kb.js', 'js/econcal.js', 'js/ai.js', 'js/pro.js', 'js/ia.js', 'js/quant.js', 'js/live.js'].forEach((rel) => {
  const tag = `<script src="${rel}"></script>`;
  if (html.indexOf(tag) === -1) { console.warn('⚠️ balise absente :', tag); return; }
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  html = html.replace(tag, '<script>\n' + code + '\n</script>');
});

fs.writeFileSync(out, html);
console.log('✅ Écrit :', out, '(' + Math.round(html.length / 1024) + ' Ko)');
