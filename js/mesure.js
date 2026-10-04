'use strict';
/**
 * HISTORIQUE MESURÉ — les 37 signaux que le modèle produit sur les vraies
 * bougies NQ du 2026-07-28 au 2026-10-01.
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
 *   37 signaux · 67.6 % de réussite
 *   avant frais -522 €      net -604 €  (risque 250 € par trade)
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
  ["2026-07-28",540,"SHORT","RB M5","5m",27980,28087.38,27711.54,2.5,0.61,0.603,0.61,"gain",1785243600000,45],
  ["2026-07-28",570,"SHORT","ITH M15","5m",27877,27986.3,27603.75,2.5,0.61,0.604,0.61,"gain",1785245400000,45],
  ["2026-07-29",540,"SHORT","RB M15","5m",27881.5,27999.81,27585.74,2.5,0.61,0.604,0.61,"gain",1785330000000,85],
  ["2026-07-29",545,"SHORT","CISD M5","5m",27893.75,27963.07,27720.46,2.5,0.61,0.35,0.36000000000000004,"gain partiel",1785330300000,15],
  ["2026-07-31",580,"SHORT","CISD M5","5m",28419,28618.74,27919.66,2.5,0.61,0.421,0.4243351797780276,"sortie horaire +",1785505200000,140],
  ["2026-07-31",585,"SHORT","FVG H1","5m",28360.5,28460.19,28111.28,2.5,0.61,0.353,0.36000000000000004,"gain partiel",1785505500000,10],
  ["2026-08-04",540,"LONG","RB M5","5m",29218,29145.63,29398.94,2.5,0.61,0.35,0.36000000000000004,"gain partiel",1785848400000,30],
  ["2026-08-04",545,"LONG","FVG M5","5m",29227.75,29116.37,29506.21,2.5,0.61,0.354,0.36000000000000004,"gain partiel",1785848700000,20],
  ["2026-08-05",540,"LONG","CISD M15","5m",29937.5,29875.55,30092.37,2.5,0.61,0.349,0.36000000000000004,"gain partiel",1785934800000,30],
  ["2026-08-05",545,"LONG","CISD M15","5m",29937.75,29874.8,30095.13,2.5,0.61,0.349,0.36000000000000004,"gain partiel",1785935100000,25],
  ["2026-08-14",580,"LONG","RB H4","5m",30261,30080.79,30711.52,2.5,0.61,-1.004,-1,"perte",1786714800000,100],
  ["2026-08-14",585,"LONG","CISD M30","5m",30238,30149.81,30458.48,2.5,0.61,-1.008,-1,"perte",1786715100000,35],
  ["2026-08-17",570,"SHORT","CISD M5","5m",30196.5,30295.66,29948.61,2.5,0.61,0.353,0.36000000000000004,"gain partiel",1786973400000,55],
  ["2026-08-18",545,"SHORT","CISD M5","5m",29693.5,29767.25,29509.11,2.5,0.61,0.351,0.36000000000000004,"gain partiel",1787058300000,30],
  ["2026-08-18",550,"SHORT","CISD M15","5m",29696.25,29759.01,29539.36,2.5,0.61,0.349,0.36000000000000004,"gain partiel",1787058600000,25],
  ["2026-08-21",595,"SHORT","FVG H4","5m",29303.5,29369.94,29137.39,2.5,0.61,0.349,0.36000000000000004,"gain partiel",1787320500000,10],
  ["2026-08-24",580,"SHORT","CISD M15","5m",28978.75,29110.93,28648.29,2.5,0.61,-1.005,-1,"perte",1787578800000,105],
  ["2026-08-24",585,"SHORT","FVG M5","5m",28990.75,29074.94,28780.27,2.5,0.61,0.352,0.36000000000000004,"gain partiel",1787579100000,10],
  ["2026-08-26",580,"LONG","RB M15","5m",29291,29218.57,29472.08,2.5,0.61,0.35,0.36000000000000004,"gain partiel",1787751600000,25],
  ["2026-08-27",560,"SHORT","ITH M30","5m",29537.5,29572.13,29450.92,2.5,0.61,0.34,0.36000000000000004,"gain partiel",1787836800000,10],
  ["2026-08-27",565,"SHORT","ITH M5","5m",29524.75,29610.37,29310.7,2.5,0.61,0.352,0.36000000000000004,"gain partiel",1787837100000,15],
  ["2026-08-31",575,"SHORT","CISD H4","5m",29398.75,29487.27,29177.45,2.5,0.61,0.352,0.36000000000000004,"gain partiel",1788183300000,60],
  ["2026-08-31",580,"SHORT","CISD M5","5m",29407.25,29461.78,29270.94,2.5,0.61,-1.013,-1,"perte",1788183600000,5],
  ["2026-09-01",570,"SHORT","CISD M30","5m",29099,29131.28,29018.3,2.5,0.61,-1.022,-1,"perte",1788269400000,5],
  ["2026-09-03",550,"LONG","RB H4","5m",29239.25,29155.86,29447.73,2.5,0.61,0.352,0.36000000000000004,"gain partiel",1788441000000,25],
  ["2026-09-03",565,"LONG","CISD M5","5m",29249,29126.6,29555,2.5,0.61,0.354,0.36000000000000004,"gain partiel",1788441900000,40],
  ["2026-09-10",590,"SHORT","ITH H1","5m",29105.75,29238.03,28775.04,2.5,0.61,-1.005,-1,"perte",1789048200000,30],
  ["2026-09-10",595,"SHORT","ITH H1","5m",29099.75,29256.03,28709.05,2.5,0.61,-1.004,-1,"perte",1789048500000,25],
  ["2026-09-14",540,"SHORT","ITH M5","5m",28842.25,28911.32,28669.57,2.5,0.61,-1.01,-1,"perte",1789390800000,20],
  ["2026-09-14",545,"SHORT","ITH M5","5m",28837.25,28908.32,28659.58,2.5,0.61,-1.01,-1,"perte",1789391100000,15],
  ["2026-09-15",580,"LONG","CISD M15","5m",29435.75,29371.2,29597.12,2.5,0.61,-1.011,-1,"perte",1789479600000,25],
  ["2026-09-16",540,"SHORT","ITH M15","5m",29367,29494.49,29048.27,2.5,0.61,-1.005,-1,"perte",1789563600000,115],
  ["2026-09-16",555,"SHORT","CISD M15","5m",29388.25,29430.76,29281.97,2.5,0.61,-1.016,-1,"perte",1789564500000,30],
  ["2026-09-22",580,"LONG","ITL M5","5m",30902.25,30803.53,31149.05,2.5,0.61,0.353,0.36000000000000004,"gain partiel",1790084400000,15],
  ["2026-09-28",580,"SHORT","RB M5","1m",30611.5,30714.99,30352.78,2.5,0.61,0.45,0.45662844045562584,"sortie horaire +",1790602800000,140],
  ["2026-10-01",540,"SHORT","CISD M15","1m",30820,30877.66,30675.86,2.5,0.61,0.348,0.36000000000000004,"gain partiel",1790859600000,30],
  ["2026-10-01",555,"SHORT","CISD M5","1m",30823,30921.66,30576.35,2.5,0.61,0.353,0.36000000000000004,"gain partiel",1790860500000,18]
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
