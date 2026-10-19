'use strict';
/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  POSITION — LE SEUL ENDROIT QUI DIT CE QUE VAUT UNE POSITION.         ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * Ce calcul était écrit à CINQ endroits : scripts/live_log.js,
 * scripts/gen_mesure.js, scripts/balayage.js, le site, et chaque script
 * jetable écrit pour répondre à une question. Cinq copies, cinq occasions de
 * diverger. Elles ont divergé :
 *
 *   · le banc d'essai mesurait un partiel à 0,5 R pendant que le robot en
 *     passait un à 0,4 R ;
 *   · le suivi testait l'objectif avant le stop d'un côté, l'inverse de
 *     l'autre, et quatre positions du journal ont été annoncées gagnantes
 *     alors qu'elles étaient perdantes ;
 *   · un calcul de gain latent a oublié que 90 % de la position était déjà
 *     vendue, et a annoncé +467 € là où il y avait +90 € acquis et un reste
 *     de 10 % qui valait 67 €.
 *
 * Aucun de ces bugs n'était difficile. Ils étaient tous inévitables : cinq
 * copies d'une même règle finissent toujours par se contredire. Il n'y a
 * donc plus qu'une copie, et scripts/test.js refuse toute divergence.
 *
 * LE MODÈLE DE POSITION, en une phrase : on entre, on place un stop, on vend
 * une fraction `part` au premier objectif — ce qui remonte le stop au prix
 * d'entrée — et le reste court jusqu'au second objectif.
 */
(function (root) {

  /**
   * Les niveaux d'une position, à partir de l'entrée et du bord structurel.
   * @param sens   'LONG' | 'SHORT'
   * @param entree prix d'entrée
   * @param bord   le bord de l'IFVG (avant élargissement)
   * @param cfg    { slx, tp1, tp2, part }
   */
  function niveaux(sens, entree, bord, cfg) {
    var L = sens === 'LONG';
    var d0 = Math.abs(entree - bord);
    var risq = d0 * (cfg.slx || 1);
    var sl = L ? entree - risq : entree + risq;
    return {
      sens: sens, entree: entree, sl: sl, risq: risq,
      tp1: L ? entree + risq * cfg.tp1 : entree - risq * cfg.tp1,
      tp:  L ? entree + risq * cfg.tp2 : entree - risq * cfg.tp2,
      // Ce qu'on gagne si TOUT est touché, et ce qu'on perd si le stop part.
      gainMax: cfg.part * cfg.tp1 + (1 - cfg.part) * cfg.tp2,
      perteMax: -1
    };
  }

  /**
   * Ce que vaut la position MAINTENANT, au prix donné.
   *
   * ⚠️ Le piège qui m'a eu : après le partiel, `part` de la position est
   * VENDUE. Sa valeur est figée à `part × tp1`. Seul `(1 − part)` suit encore
   * le prix. Calculer (entrée − prix) / risque sur la position entière
   * surestime le gain d'autant plus que `part` est grand — avec part = 0,9,
   * d'un facteur dix.
   */
  function valeur(pos, prix, part1, cfg) {
    var L = pos.sens === 'LONG';
    var brut = (L ? prix - pos.entree : pos.entree - prix) / pos.risq;
    if (!part1) return Math.max(-1, brut);            // rien n'est encaissé
    var acquis = cfg.part * cfg.tp1;                  // la part vendue, figée
    var reste = (1 - cfg.part) * Math.max(0, Math.min(cfg.tp2, brut));
    return acquis + reste;
  }

  /**
   * Rejoue la position sur des bougies et rend son issue.
   *
   * L'ORDRE DES TESTS EST LA RÈGLE, pas un détail : une bougie ne dit pas
   * dans quel ordre son haut et son bas ont été atteints. `prudent` teste le
   * stop d'abord. C'est obligatoire dès qu'on travaille en 5 minutes ; en
   * 1 minute l'ambiguïté est presque nulle mais la convention reste la même,
   * pour que les deux soient comparables.
   *
   * @param opts { prudent, maxBarres, sortieMin, heure, jourSignal, depuis, part1 }
   */
  function suivre(pos, bougies, cfg, opts) {
    opts = opts || {};
    var L = pos.sens === 'LONG';
    var plafond = cfg.part * cfg.tp1 + (1 - cfg.part) * cfg.tp2;
    var depuis = opts.depuis != null ? opts.depuis : -Infinity;
    var sl = pos.sl, part1 = opts.part1 === true, n = 0, ambigu = 0;
    if (part1) sl = pos.entree;
    var r = null, sortie = null, tFin = null;

    for (var i = 0; i < bougies.length; i++) {
      var c = bougies[i];
      if (c.t <= depuis) continue;
      n++;
      var hautTouche = L ? c.h >= (part1 ? pos.tp : pos.tp1) : c.l <= (part1 ? pos.tp : pos.tp1);
      var stoppe = L ? c.l <= sl : c.h >= sl;
      if (stoppe && hautTouche) ambigu++;

      if (opts.prudent !== false && stoppe) {
        r = part1 ? cfg.part * cfg.tp1 : -1;
        sortie = part1 ? 'seuil' : 'stop';
      } else if (!part1 && (L ? c.h >= pos.tp1 : c.l <= pos.tp1)) {
        part1 = true; sl = pos.entree;                // partiel encaissé
      } else if (part1 && (L ? c.h >= pos.tp : c.l <= pos.tp)) {
        // ⚠️ ON CRÉDITAIT LE PLAFOND, PAS LA DISTANCE PARCOURUE.
        //
        // Pour le modèle en place, `pos.tp` vaut exactement entrée ± risq×tp2
        // et les deux coïncident : le défaut ne se voyait pas. Mais AMD place
        // son objectif sur la LIQUIDITÉ INTERNE, bornée par le plafond —
        // souvent bien plus près. Atteindre un niveau situé à 0,5 R rapportait
        // donc 2,5 R. Le même trade payé cinq fois trop.
        //
        // La signature était visible et je l'ai d'abord prise pour une bonne
        // nouvelle : en montant le plafond de 2 R à 6 R, le total quadruplait
        // SANS que le taux de réussite bouge d'un dixième. C'était impossible :
        // si les gains venaient vraiment de plus loin, il faudrait aller les
        // chercher plus souvent en vain.
        //
        // On crédite maintenant ce que le prix a réellement parcouru jusqu'à
        // l'objectif. Le plafond reste une BORNE, il n'est plus un montant.
        var rTp = pos.risq > 0 ? Math.abs(pos.tp - pos.entree) / pos.risq : cfg.tp2;
        r = cfg.part * cfg.tp1 + (1 - cfg.part) * Math.min(cfg.tp2, rTp);
        sortie = 'objectif';
      } else if (opts.prudent === false && stoppe) {
        r = part1 ? cfg.part * cfg.tp1 : -1;
        sortie = part1 ? 'seuil' : 'stop';
      } else if (cfg.sortieMin != null && opts.heure &&
                 (opts.heure(c.t).jour !== opts.jourSignal || opts.heure(c.t).min >= cfg.sortieMin)) {
        r = valeur(pos, c.c, part1, cfg);             // soldée au marché
        sortie = 'horaire';
      } else if (opts.maxBarres && n > opts.maxBarres) {
        r = valeur(pos, c.c, part1, cfg);
        sortie = 'expiré';
      }
      if (r !== null) { tFin = c.t; break; }
    }
    if (r === null) return { ouverte: true, part1: part1, barres: n, ambigu: ambigu };
    // Garde-fou : aucune issue ne peut sortir des bornes du modèle.
    if (r > plafond + 1e-9 || r < -1 - 1e-9)
      throw new Error('résultat hors bornes : ' + r + ' (plafond ' + plafond + ')');
    return { ouverte: false, r: r, sortie: sortie, barres: n, ambigu: ambigu,
             part1: part1, t: tFin, gagnant: r > 0 };
  }

  /** Coût aller-retour, en fraction du risque. Un stop serré coûte plus cher. */
  function cout(risq, o) {
    o = o || {};
    var slip = o.slip != null ? o.slip : 0.25;
    var comm = o.comm != null ? o.comm : 4.00;
    var pointval = o.pointval != null ? o.pointval : 20;
    return (slip * 2 + comm / pointval) / risq;
  }

  /**
   * La phrase qui explique un signal, composée À LA LECTURE.
   *
   * Elle était écrite une fois pour toutes au moment du signal, et figée dans
   * le journal. Conséquence : deux positions du 28 septembre disaient encore
   * « partiel 0,4 R » longtemps après qu'on eut décidé de ne plus parler en R,
   * et rien n'aurait jamais pu les corriger. Le journal garde donc les FAITS
   * (entrée, stop, objectifs), et la phrase se recompose à chaque affichage.
   *
   * @param s      { sens, entree, sl, tp1, tp, niveauDeclencheur, uniteIFVG,
   *                 biais, biaisScore, dol }
   * @param cfg    les réglages
   * @param risque ce qu'un trade risque, dans la devise du compte
   * @param dev    le symbole de la devise
   */
  function raisonnement(s, cfg, risque, dev) {
    dev = dev || ' €';
    risque = risque || 250;
    var eur = function (v) { return (v >= 0 ? '+' : '') + Math.round(v) + dev; };
    var pts = function (a, b) { return Math.abs(a - b).toFixed(0) + ' points'; };
    var hm = function (m) {
      return String(Math.floor(m / 60)).padStart(2, '0') + ' h ' +
             String(m % 60).padStart(2, '0');
    };
    var t = [];
    if (s.biais) t.push('Biais ' + s.biais + ' (' + Math.abs(s.biaisScore) + ' sur 4).');
    if (s.dol != null) t.push('Liquidité visée à ' + s.dol + '.');
    if (s.niveauDeclencheur) t.push('Niveau clé ' + s.niveauDeclencheur + '.');
    t.push('Le prix l\'a touché, puis une inversion ' + (s.uniteIFVG || '') +
           ' a été confirmée par clôture de corps.');
    t.push('Entrée ' + s.entree + ', stop à ' + s.sl + ' — ' + pts(s.entree, s.sl) +
           ', soit ' + cfg.slx + ' fois le bord de l\'IFVG, pour ne pas être sorti par' +
           ' la respiration du prix.');
    t.push('Objectif partiel à ' + s.tp1 + ', soit ' + pts(s.tp1, s.entree) +
           ' (' + eur(cfg.tp1 * risque) + '), sur ' + Math.round(cfg.part * 100) +
           ' % de la position — le stop remonte alors au prix d\'entrée et la position' +
           ' ne peut plus perdre.');
    t.push('Les ' + Math.round((1 - cfg.part) * 100) + ' % restants courent jusqu\'à ' +
           s.tp + ', soit ' + pts(s.tp, s.entree) + ' (' + eur(cfg.tp2 * risque) + ').');
    t.push('Gain si tout est touché : ' + eur((cfg.part * cfg.tp1 + (1 - cfg.part) * cfg.tp2) * risque) +
           ' · perte si le stop part : ' + eur(-risque) + '.');
    if (cfg.sortieMin != null)
      t.push('Solde au marché à ' + hm(cfg.sortieMin) + ' New York si rien n\'est touché avant.');
    return t.join(' ');
  }

  root.Position = { niveaux: niveaux, valeur: valeur, suivre: suivre, cout: cout,
                    raisonnement: raisonnement };

})(typeof window !== 'undefined' ? window : this);
