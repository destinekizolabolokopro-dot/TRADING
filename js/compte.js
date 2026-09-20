'use strict';
/**
 * COMPTE — calibrage des positions sur un capital réel.
 *
 * Le modèle raisonne en R : une unité de risque. Ce module traduit le R en
 * euros et en contrats, ce qui est la seule chose qui compte pour passer un
 * ordre.
 *
 *   risque en devise du compte = capital × risque%
 *   distance du stop en points = |entrée − stop|
 *   contrats                   = risque converti ÷ (points × valeur du point)
 *
 * Le contrat est libellé en dollars, le compte peut être en euros : le taux
 * EUR/USD est récupéré une fois par séance, et reste modifiable à la main si
 * le flux est injoignable.
 */
var Compte = (function () {

  var CLE = 'compte.reglages';
  var DEF = { capital: 50000, devise: 'EUR', risque: 0.5, contrat: 'MNQ', taux: 1.08 };

  // Valeur d'un point d'indice, en dollars.
  var CONTRATS = {
    MNQ: { nom: 'Micro E-mini Nasdaq', point: 2,  tick: 0.25 },
    NQ:  { nom: 'E-mini Nasdaq',        point: 20, tick: 0.25 }
  };

  function lire() {
    try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(CLE) || '{}')); }
    catch (e) { return Object.assign({}, DEF); }
  }
  function ecrire(o) {
    var r = Object.assign(lire(), o || {});
    try { localStorage.setItem(CLE, JSON.stringify(r)); } catch (e) {}
    return r;
  }

  /** Taux EUR/USD, rafraîchi au plus une fois par heure. */
  var tauxT = 0;
  // Le taux peut être relevé côté serveur par la tâche automatique et livré
  // avec l'instantané. Quand c'est le cas, le navigateur n'a plus rien à
  // chercher : il appelait pour cela les relais CORS, qui sont tous morts.
  function setTaux(v) {
    if (!(v > 0.5 && v < 2)) return false;
    tauxT = Date.now(); ecrire({ taux: +v.toFixed(4) }); return true;
  }
  function tauxFrais() { return Date.now() - tauxT < 3600e3; }

  function majTaux() {
    var r = lire();
    if (r.devise !== 'EUR') return Promise.resolve(1);
    if (Date.now() - tauxT < 3600e3) return Promise.resolve(r.taux);
    if (typeof NQ === 'undefined' || !NQ.brut) return Promise.resolve(r.taux);
    return NQ.brut('EURUSD=X', '1d', '5d').then(function (d) {
      var p = d && d.price;
      if (p && p > 0.5 && p < 2) { tauxT = Date.now(); ecrire({ taux: +p.toFixed(4) }); return p; }
      return r.taux;
    }).catch(function () { return r.taux; });
  }

  /**
   * Calibre une position.
   * @param entree, stop, tp  niveaux du modèle
   * @return { contrats, risqueDev, gainDev, points, pointsTP, valeurPoint,
   *           risqueUnit, tropPetit }  — montants dans la devise du compte
   */
  function calibrer(entree, stop, tp) {
    var r = lire(), c = CONTRATS[r.contrat] || CONTRATS.MNQ;
    var points = Math.abs(entree - stop);
    var pointsTP = tp != null ? Math.abs(tp - entree) : null;
    if (!(points > 0)) return null;

    // Le risque visé, exprimé dans la devise du compte puis converti en dollars.
    var risqueDevVise = r.capital * r.risque / 100;
    var enUSD = r.devise === 'EUR' ? risqueDevVise * r.taux : risqueDevVise;

    var parContrat = points * c.point;                 // dollars risqués par contrat
    var contrats = Math.floor(enUSD / parContrat);

    // Le risque RÉEL tient au nombre entier de contrats, pas au risque visé.
    var risqueUSD = contrats * parContrat;
    var gainUSD = pointsTP != null ? contrats * pointsTP * c.point : null;
    var conv = function (usd) { return r.devise === 'EUR' ? usd / r.taux : usd; };

    return {
      contrats: contrats,
      tropPetit: contrats < 1,
      points: +points.toFixed(2),
      pointsTP: pointsTP != null ? +pointsTP.toFixed(2) : null,
      valeurPoint: c.point,
      contratNom: c.nom,
      devise: r.devise,
      risqueVise: Math.round(risqueDevVise),
      risqueDev: Math.round(conv(risqueUSD)),
      gainDev: gainUSD != null ? Math.round(conv(gainUSD)) : null,
      // Combien vaut 1 R sur ce compte : sert à traduire tout l'historique.
      unite: Math.round(conv(risqueUSD)) || Math.round(risqueDevVise)
    };
  }

  /** Valeur d'un R en devise du compte, indépendamment d'un trade précis. */
  function uniteR() {
    var r = lire();
    return Math.round(r.capital * r.risque / 100);
  }

  function sym(d) { return d === 'EUR' ? ' €' : ' $'; }

  return { lire: lire, ecrire: ecrire, calibrer: calibrer, uniteR: uniteR,
           majTaux: majTaux, setTaux: setTaux, tauxFrais: tauxFrais,
           CONTRATS: CONTRATS, sym: sym, DEF: DEF };
})();
if (typeof window !== 'undefined') window.Compte = Compte;
