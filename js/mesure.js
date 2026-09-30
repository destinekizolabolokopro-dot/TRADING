'use strict';
/**
 * HISTORIQUE MESURÉ — les 41 signaux que le modèle produit sur les vraies
 * bougies NQ du 2026-07-22 au 2026-09-28.
 *
 * Fenêtre : 09 h 00 → 10 h 00 New York.
 *
 * ⚠️ CE NE SONT PAS DES POSITIONS QUI ONT ÉTÉ ENVOYÉES. Ce sont des signaux
 * RECONSTITUÉS a posteriori, au prix de clôture exact de la bougie qui les a
 * déclenchés. Le résultat est net de frais : 0,25 point de slippage par côté
 * et 4,00 $ de commission, soit 0,70 point par trade.
 *
 * ⚠️ COMPTAGE PRUDENT. Une bougie de 5 minutes ne dit pas dans quel ordre son
 * haut et son bas ont été atteints. Quand elle touche l'objectif ET le stop,
 * ce fichier compte LE STOP. L'ancienne version comptait l'objectif, ce qui
 * donnait 80 % de réussite et un résultat positif ; vérification faite en
 * bougies de 1 minute, cette hypothèse était fausse plus souvent que juste.
 * Les signaux des huit derniers jours sont suivis directement en 1 minute
 * (colonne « tf »), là il n'y a plus d'hypothèse du tout.
 *
 *   41 signaux · 87.8 % de réussite
 *   avant frais +2650 €      net +2560 €  (risque 250 € par trade)
 *
 * ⚠️ CES CHIFFRES NE SONT PAS REPRODUCTIBLES À L'IDENTIQUE. La profondeur des
 * séries Yahoo est courte et glissante : la même commande relancée deux heures
 * plus tard ne rend pas exactement le même jeu. C'est un CLICHÉ.
 *
 * Régénéré par scripts/gen_mesure.js — ne pas éditer à la main.
 *
 * Colonnes : jour, minute NY, sens, niveau, unité de suivi, entrée, stop,
 *            objectif, objectif en multiples du risque, gain si tout est touché,
 *            résultat net, résultat avant frais, sortie, horodatage, durée (min).
 */
var Mesure = (function () {
  var BRUT = [
  ["2026-07-22",545,"LONG","ITL M5","5m",29059.75,28985.5,29245.37,2.5,0.61,0.601,0.61,"gain",1784725500000,50],
  ["2026-07-22",560,"LONG","CISD M15","5m",29089.25,29024.98,29249.93,2.5,0.61,0.599,0.61,"gain",1784726400000,35],
  ["2026-07-23",585,"SHORT","CISD M5","5m",28760,28931.01,28332.48,2.5,0.61,0.356,0.36000000000000004,"gain partiel",1784814300000,25],
  ["2026-07-24",585,"SHORT","FVG M5","5m",28501.25,28676.05,28064.25,2.5,0.61,0.356,0.36000000000000004,"gain partiel",1784900700000,85],
  ["2026-07-29",540,"SHORT","RB M15","5m",27881.5,27999.81,27585.74,2.5,0.61,0.604,0.61,"gain",1785330000000,85],
  ["2026-07-29",590,"SHORT","CISD M5","5m",27753.5,28007.7,27117.99,2.5,0.61,0.473,0.47575403575413056,"sortie horaire +",1785333000000,130],
  ["2026-08-04",540,"LONG","RB M5","5m",29218,29145.63,29398.94,2.5,0.61,0.35,0.36000000000000004,"gain partiel",1785848400000,30],
  ["2026-08-04",570,"LONG","CISD M15","5m",29382.75,28979.24,30391.52,2.5,0.61,0.434,0.43552548139285036,"sortie horaire +",1785850200000,150],
  ["2026-08-12",555,"LONG","ITL M5","5m",29961.5,29886.53,30148.92,2.5,0.61,0.351,0.36000000000000004,"gain partiel",1786540500000,15],
  ["2026-08-13",540,"LONG","RB H4","5m",29908.75,29816.82,30138.57,2.5,0.61,0.602,0.61,"gain",1786626000000,45],
  ["2026-08-17",555,"SHORT","CISD M5","5m",30211,30252.17,30108.08,2.5,0.61,-1.017,-1,"perte",1786972500000,15],
  ["2026-08-18",545,"SHORT","CISD M5","5m",29693.5,29767.25,29509.11,2.5,0.61,0.351,0.36000000000000004,"gain partiel",1787058300000,30],
  ["2026-08-18",585,"SHORT","CISD M15","5m",29657.25,29752.98,29417.94,2.5,0.61,0.353,0.36000000000000004,"gain partiel",1787060700000,15],
  ["2026-08-21",545,"SHORT","RB M15","5m",29487.75,29593.34,29223.77,2.5,0.61,0.603,0.61,"gain",1787317500000,75],
  ["2026-08-21",550,"SHORT","ITH M15","5m",29469,29633.58,29057.56,2.5,0.61,0.356,0.36000000000000004,"gain partiel",1787317800000,150],
  ["2026-08-24",570,"SHORT","CISD M15","5m",29112.75,29188.04,28924.52,2.5,0.61,0.351,0.36000000000000004,"gain partiel",1787578200000,115],
  ["2026-08-24",575,"SHORT","ITH H4","5m",29080,29237.26,28686.84,2.5,0.61,0.356,0.36000000000000004,"gain partiel",1787578500000,55],
  ["2026-08-25",540,"SHORT","RB M30","5m",29324.5,29380.96,29183.35,2.5,0.61,0.348,0.36000000000000004,"gain partiel",1787662800000,30],
  ["2026-08-25",560,"SHORT","RB M30","5m",29319.25,29390.71,29140.61,2.5,0.61,0.35,0.36000000000000004,"gain partiel",1787664000000,15],
  ["2026-08-27",560,"SHORT","CISD H4","5m",29537.5,29572.13,29450.92,2.5,0.61,0.34,0.36000000000000004,"gain partiel",1787836800000,10],
  ["2026-08-31",575,"SHORT","RB H4","5m",29398.75,29487.27,29177.45,2.5,0.61,0.352,0.36000000000000004,"gain partiel",1788183300000,60],
  ["2026-09-01",540,"SHORT","CISD M30","5m",29099.25,29213.53,28813.55,2.5,0.61,0.354,0.36000000000000004,"gain partiel",1788267600000,45],
  ["2026-09-01",550,"SHORT","FVG M5","5m",29093,29168.27,28904.81,2.5,0.61,0.351,0.36000000000000004,"gain partiel",1788268200000,25],
  ["2026-09-03",550,"LONG","ITL M5","5m",29239.25,29155.86,29447.73,2.5,0.61,0.352,0.36000000000000004,"gain partiel",1788441000000,25],
  ["2026-09-03",565,"LONG","CISD M5","5m",29249,29078.6,29675,2.5,0.61,0.356,0.36000000000000004,"gain partiel",1788441900000,40],
  ["2026-09-08",570,"SHORT","CISD M15","5m",29600.5,29708.18,29331.3,2.5,0.61,0.353,0.36000000000000004,"gain partiel",1788874200000,100],
  ["2026-09-08",575,"SHORT","RB M15","5m",29568,29683.65,29278.86,2.5,0.61,0.354,0.36000000000000004,"gain partiel",1788874500000,90],
  ["2026-09-10",560,"SHORT","FVG M30","5m",29056.5,29129.75,28873.39,2.5,0.61,-1.01,-1,"perte",1789046400000,15],
  ["2026-09-10",590,"SHORT","FVG M30","5m",29105.75,29238.03,28775.04,2.5,0.61,-1.005,-1,"perte",1789048200000,30],
  ["2026-09-11",595,"LONG","FVG M5","5m",29472.75,29388.17,29684.2,2.5,0.61,-1.008,-1,"perte",1789134900000,5],
  ["2026-09-16",585,"LONG","FVG M15","5m",29461.75,29370.18,29690.67,2.5,0.61,0.368,0.37528895023883646,"sortie horaire +",1789566300000,135],
  ["2026-09-21",545,"LONG","CISD M5","1m",30233.25,30196.06,30326.22,2.5,0.61,0.341,0.36000000000000004,"gain partiel",1789995900000,26],
  ["2026-09-21",570,"LONG","FVG M15","1m",30252,30152.8,30500,2.5,0.61,0.603,0.61,"gain",1789997400000,53],
  ["2026-09-22",540,"LONG","RB M5","1m",30767.5,30692.89,30954.04,2.5,0.61,0.601,0.61,"gain",1790082000000,71],
  ["2026-09-22",550,"LONG","ITL M15","1m",30769.75,30741.13,30841.29,2.5,0.61,0.586,0.61,"gain",1790082600000,21],
  ["2026-09-23",545,"SHORT","CISD M30","1m",30948.5,31001.26,30816.6,2.5,0.61,-1.013,-1,"perte",1790168700000,24],
  ["2026-09-23",570,"SHORT","FVG M30","1m",30926.5,30998.24,30747.15,2.5,0.61,0.6,0.61,"gain",1790170200000,40],
  ["2026-09-24",570,"LONG","RB M5","1m",30540,30480.57,30688.58,2.5,0.61,0.348,0.36000000000000004,"gain partiel",1790256600000,24],
  ["2026-09-24",575,"LONG","RB H4","1m",30595.5,30549.02,30711.69,2.5,0.61,0.345,0.36000000000000004,"gain partiel",1790256900000,13],
  ["2026-09-28",570,"SHORT","ITH M5","1m",30677,30834.54,30283.15,2.5,0.61,0.461,0.46505161811229756,"sortie horaire +",1790602200000,150],
  ["2026-09-28",575,"SHORT","RB M5","1m",30643,30809.51,30226.71,2.5,0.61,0.435,0.4389721489552856,"sortie horaire +",1790602500000,145]
  ];
  var CLES = ['jour','minNY','sens','niveau','tf','entry','sl','tp','rr','gainMax','r','rBrut','sortie','ts','duree'];
  var LISTE = BRUT.map(function (l) {
    var o = {}; CLES.forEach(function (k, i) { o[k] = l[i]; });
    o.source = 'MESURE'; o.symbol = 'NQ'; o.direction = o.sens;
    o.status = 'closed'; o.result = o.r > 0 ? 'win' : 'loss';
    // Plus un seul R dans ce qu'un humain lit : « brut +0,61 R » s'affichait
    // dans l'infobulle de chaque ligne du journal. Le motif parle argent, sur
    // le risque de référence, et dit la part du risque en clair.
    o.motif = o.sortie + ' · suivi en ' + o.tf + ' · ' + o.niveau +
              ' · avant frais ' + (o.rBrut > 0 ? '+' : '') + Math.round(o.rBrut * 250) +
              ' € (' + (o.rBrut > 0 ? '+' : '') + Math.round(o.rBrut * 100) + ' % du risque)';
    return o;
  });
  function liste() { return LISTE.slice(); }
  return { liste: liste };
})();
if (typeof window !== 'undefined') window.Mesure = Mesure;
