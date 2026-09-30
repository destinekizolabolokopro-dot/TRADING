'use strict';
/**
 * HISTORIQUE MESURÉ — les 25 signaux que le modèle produit sur les vraies
 * bougies NQ du 2026-07-24 au 2026-09-28.
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
 *   25 signaux · 76.0 % de réussite
 *   avant frais +723 €      net +676 €  (risque 250 € par trade)
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
  ["2026-07-24",595,"SHORT","RB M5","5m",28322.25,29212.91,26095.61,2.5,0.61,-0.302,-0.3011818905083408,"sortie horaire −",1784901300000,125],
  ["2026-07-28",570,"SHORT","RB M5","5m",27877,27986.3,27603.75,2.5,0.61,0.604,0.61,"gain",1785245400000,45],
  ["2026-07-29",540,"SHORT","RB M15","5m",27881.5,27999.81,27585.74,2.5,0.61,0.604,0.61,"gain",1785330000000,85],
  ["2026-07-29",590,"SHORT","CISD M5","5m",27753.5,28007.7,27117.99,2.5,0.61,0.473,0.47575403575413056,"sortie horaire +",1785333000000,130],
  ["2026-07-31",580,"SHORT","CISD M30","5m",28419,28618.74,27919.66,2.5,0.61,0.421,0.4243351797780276,"sortie horaire +",1785505200000,140],
  ["2026-07-31",585,"SHORT","FVG H1","5m",28360.5,28460.19,28111.28,2.5,0.61,0.353,0.36000000000000004,"gain partiel",1785505500000,10],
  ["2026-08-04",540,"LONG","RB M5","5m",29218,29145.63,29398.94,2.5,0.61,0.35,0.36000000000000004,"gain partiel",1785848400000,30],
  ["2026-08-04",570,"LONG","FVG M5","5m",29382.75,28979.24,30391.52,2.5,0.61,0.434,0.43552548139285036,"sortie horaire +",1785850200000,150],
  ["2026-08-18",545,"SHORT","CISD M5","5m",29693.5,29767.25,29509.11,2.5,0.61,0.351,0.36000000000000004,"gain partiel",1787058300000,30],
  ["2026-08-18",585,"SHORT","CISD M15","5m",29657.25,29752.98,29417.94,2.5,0.61,0.353,0.36000000000000004,"gain partiel",1787060700000,15],
  ["2026-08-21",595,"SHORT","FVG H4","5m",29303.5,29369.94,29137.39,2.5,0.61,0.349,0.36000000000000004,"gain partiel",1787320500000,10],
  ["2026-08-24",580,"SHORT","CISD M15","5m",28978.75,29110.93,28648.29,2.5,0.61,-1.005,-1,"perte",1787578800000,105],
  ["2026-08-27",560,"SHORT","ITH M30","5m",29537.5,29572.13,29450.92,2.5,0.61,0.34,0.36000000000000004,"gain partiel",1787836800000,10],
  ["2026-08-27",570,"SHORT","ITH M5","5m",29463.5,29518.07,29327.07,2.5,0.61,-1.013,-1,"perte",1787837400000,10],
  ["2026-08-31",575,"SHORT","CISD H4","5m",29398.75,29487.27,29177.45,2.5,0.61,0.352,0.36000000000000004,"gain partiel",1788183300000,60],
  ["2026-09-01",540,"SHORT","CISD M30","5m",29099.25,29213.53,28813.55,2.5,0.61,0.354,0.36000000000000004,"gain partiel",1788267600000,45],
  ["2026-09-01",550,"SHORT","FVG M5","5m",29093,29168.27,28904.81,2.5,0.61,0.351,0.36000000000000004,"gain partiel",1788268200000,25],
  ["2026-09-10",590,"SHORT","ITH H1","5m",29105.75,29238.03,28775.04,2.5,0.61,-1.005,-1,"perte",1789048200000,30],
  ["2026-09-14",545,"SHORT","ITH M5","5m",28837.25,28926.32,28614.58,2.5,0.61,-1.008,-1,"perte",1789391100000,25],
  ["2026-09-14",575,"SHORT","RB M5","5m",28889,28979.11,28663.72,2.5,0.61,-1.008,-1,"perte",1789392900000,10],
  ["2026-09-21",570,"LONG","CISD M5","5m",30252,30152.8,30500,2.5,0.61,0.603,0.61,"gain",1789997400000,50],
  ["2026-09-21",575,"LONG","ITL H4","5m",30296.5,30241.26,30434.59,2.5,0.61,0.597,0.61,"gain",1789997700000,25],
  ["2026-09-22",580,"LONG","ITL M5","1m",30902.25,30835.53,31069.05,2.5,0.61,0.35,0.36000000000000004,"gain partiel",1790084400000,16],
  ["2026-09-22",590,"LONG","ITL M5","1m",30941.25,30805.5,31280.63,2.5,0.61,0.355,0.36000000000000004,"gain partiel",1790085000000,48],
  ["2026-09-28",580,"SHORT","RB M5","1m",30611.5,30714.99,30352.78,2.5,0.61,0.45,0.45662844045562584,"sortie horaire +",1790602800000,140]
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
