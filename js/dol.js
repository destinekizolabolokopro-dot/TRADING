'use strict';
/**
 * LES BASSINS DE LIQUIDITÉ — js/dol.js
 *
 * POURQUOI CE FICHIER EXISTE. Le cours source liste SEPT sources de
 * liquidité ; le modèle n'en cherchait qu'une — les sommets et creux
 * intermédiaires H1. Cinq manquaient entièrement, et une sixième (les
 * sommets relativement égaux) n'avait servi que de filtre de qualité, jamais
 * de cible. Mesurer une stratégie amputée de cinq de ses sept cibles ne dit
 * rien de la stratégie.
 *
 *     (Relative) EQH / EQL        sommets ou creux relativement égaux
 *     Trendline Liquidity LRLR    une ligne de hauts ou de bas alignés
 *     NWOG / NDOG                 l'écart d'ouverture de semaine ou de jour
 *     ITH / ITL (5m+)             déjà présent
 *     Session High/Low            extrêmes d'Asie, de Londres, de New York
 *     Unfilled FVGs (5m+)         les déséquilibres jamais comblés
 *     Data Highs/Low              les extrêmes de toute la période connue
 *
 * RÈGLE ABSOLUE, ET C'EST LA SEULE QUI COMPTE ICI : chaque bassin porte
 * `vu`, l'instant où il devient CONNAISSABLE, et `pris`, l'instant où le prix
 * le franchit. Un bassin n'existe comme cible qu'entre les deux. Dater un
 * bassin de son extrême plutôt que de sa confirmation, c'est lire l'avenir —
 * la faute qui avait gonflé les trois quarts d'un résultat plus tôt dans ce
 * dépôt.
 */
(function (root) {

  var CFG = {
    // « Relativement égaux » veut dire à quelques ticks près. En fraction de
    // l'ATR de l'unité considérée, pour rester comparable entre indices.
    eqTol: 0.12,
    // Une ligne de liquidité demande au moins trois points alignés.
    lrlrMin: 3,
    lrlrTol: 0.25,          // écart toléré à la droite, en fraction d'ATR
    // Les séances, en minutes depuis minuit New York.
    seances: [['asie', 20 * 60, 24 * 60 + 2 * 60], ['londres', 2 * 60, 5 * 60],
              ['ny', 9 * 60 + 30, 16 * 60]]
  };

  function pasDe(cs) { return ST.pasDe(cs); }

  /** L'instant où le prix franchit `prix`, lu sur l'unité d'exécution. */
  function prisQuand(exe, prix, haut, depuis) {
    var pas = pasDe(exe);
    for (var i = 0; i < exe.length; i++) {
      if (exe[i].t <= depuis) continue;
      if (haut ? exe[i].h >= prix : exe[i].l <= prix) return exe[i].t + pas;
    }
    return null;
  }

  function ajoute(out, exe, prix, haut, vu, type, tf) {
    if (!(prix > 0) || vu == null) return;
    out.push({ prix: prix, haut: haut, vu: vu, type: type, tf: tf,
               pris: prisQuand(exe, prix, haut, vu) });
  }

  // ── ITH / ITL ET SOMMETS RELATIVEMENT ÉGAUX ─────────────────────────────
  function swings(out, cs, exe, tf, atr) {
    var h = ST.hierarchie(cs);
    [['ith', true, 'ITH'], ['itl', false, 'ITL']].forEach(function (p) {
      h[p[0]].forEach(function (sw) { ajoute(out, exe, sw.prix, p[1], sw.vu, p[2], tf); });
    });
    // EQH / EQL : deux sommets à quelques ticks l'un de l'autre. Le bassin
    // n'est connaissable qu'au SECOND — c'est lui qui crée l'égalité.
    [['sth', true, 'EQH'], ['stl', false, 'EQL']].forEach(function (p) {
      var l = h[p[0]];
      for (var i = 1; i < l.length; i++) {
        for (var j = Math.max(0, i - 4); j < i; j++) {
          var tol = CFG.eqTol * (atr || Math.abs(l[i].prix) * 0.001);
          if (Math.abs(l[i].prix - l[j].prix) <= tol) {
            // Le bassin est au bord EXTÉRIEUR de la paire : le plus haut des
            // deux sommets, le plus bas des deux creux.
            var bord = p[1] ? Math.max(l[i].prix, l[j].prix)
                            : Math.min(l[i].prix, l[j].prix);
            ajoute(out, exe, bord, p[1], l[i].vu, p[2], tf);
            break;
          }
        }
      }
    });
  }

  // ── LIQUIDITÉ DE LIGNE DE TENDANCE (LRLR) ───────────────────────────────
  // Trois sommets descendants — ou trois creux montants — à peu près alignés.
  // La cible est le dernier point de la série : c'est là que les stops
  // s'empilent le long de la droite.
  function lrlr(out, cs, exe, tf, atr) {
    var h = ST.hierarchie(cs);
    [['sth', true, 'LRLR-H'], ['stl', false, 'LRLR-L']].forEach(function (p) {
      var l = h[p[0]];
      for (var i = CFG.lrlrMin - 1; i < l.length; i++) {
        var pts = l.slice(i - CFG.lrlrMin + 1, i + 1);
        // monotone ? (hauts descendants pour une ligne de résistance)
        var mono = true;
        for (var k = 1; k < pts.length; k++)
          if (p[1] ? pts[k].prix >= pts[k - 1].prix : pts[k].prix <= pts[k - 1].prix) mono = false;
        if (!mono) continue;
        // alignés ? écart du point du milieu à la droite des extrêmes
        var a = pts[0], b = pts[pts.length - 1], m = pts[Math.floor(pts.length / 2)];
        if (b.i === a.i) continue;
        var attendu = a.prix + (b.prix - a.prix) * (m.i - a.i) / (b.i - a.i);
        if (Math.abs(m.prix - attendu) > CFG.lrlrTol * (atr || 1)) continue;
        ajoute(out, exe, b.prix, p[1], b.vu, p[2], tf);
      }
    });
  }

  // ── ÉCARTS D'OUVERTURE : NWOG ET NDOG ───────────────────────────────────
  // NWOG : entre la clôture du vendredi et l'ouverture du dimanche.
  // NDOG : entre la clôture d'une séance et l'ouverture de la suivante.
  // Les deux bords sont des cibles — le prix revient combler l'écart.
  function ecarts(out, exe, heure) {
    var pas = pasDe(exe), prec = null;
    for (var i = 1; i < exe.length; i++) {
      var e = heure(exe[i].t), ep = heure(exe[i - 1].t);
      if (e.jour === ep.jour) continue;
      var trou = exe[i].t - exe[i - 1].t;
      if (trou <= pas * 1.5) continue;                  // pas d'interruption
      var cloture = exe[i - 1].c, ouverture = exe[i].o;
      if (cloture === ouverture) continue;
      // Un écart de plus de dix heures enjambe un week-end.
      var nom = trou > 10 * 36e5 ? 'NWOG' : 'NDOG';
      var vu = exe[i].t + pas;                          // connu à la réouverture
      ajoute(out, exe, cloture, ouverture < cloture, vu, nom, 'écart');
      ajoute(out, exe, ouverture, ouverture > cloture, vu, nom, 'écart');
    }
  }

  // ── EXTRÊMES DE SÉANCE ──────────────────────────────────────────────────
  function seances(out, exe, heure) {
    var pas = pasDe(exe), par = {};
    for (var i = 0; i < exe.length; i++) {
      var e = heure(exe[i].t);
      if (e.dow < 1 || e.dow > 5) continue;
      for (var s = 0; s < CFG.seances.length; s++) {
        var nom = CFG.seances[s][0], d = CFG.seances[s][1], f = CFG.seances[s][2];
        var dedans = f > 24 * 60 ? (e.min >= d || e.min < f - 24 * 60) : (e.min >= d && e.min < f);
        if (!dedans) continue;
        var cle = e.jour + '/' + nom;
        var o = par[cle] = par[cle] || { h: -Infinity, l: Infinity, fin: 0, nom: nom };
        o.h = Math.max(o.h, exe[i].h); o.l = Math.min(o.l, exe[i].l);
        o.fin = Math.max(o.fin, exe[i].t + pas);
      }
    }
    for (var k in par) {
      var x = par[k];
      // L'extrême d'une séance n'est connu qu'à sa FIN.
      ajoute(out, exe, x.h, true, x.fin, 'séance ' + x.nom, 'séance');
      ajoute(out, exe, x.l, false, x.fin, 'séance ' + x.nom, 'séance');
    }
  }

  // ── FVG JAMAIS COMBLÉS ──────────────────────────────────────────────────
  function fvgOuverts(out, cs, exe, tf) {
    ST.fvgs(cs).forEach(function (z) {
      // ⚠️ IL Y AVAIT ICI `if (z.touche != null) return;` — « ne garder que les
      // FVG jamais comblés ». C'était un REGARD EN AVANT, et des plus
      // sournois : `touche` est calculé sur TOUTE la série, donc un FVG encore
      // vierge au moment où on le lit disparaissait de la liste parce qu'il
      // serait comblé plus tard. La liste des cibles d'un jour dépendait des
      // semaines suivantes. Le contrôle « couper la série ne fait pas
      // disparaître le bassin » l'a attrapé.
      //   La règle du fichier suffit et dit la même chose honnêtement : le FVG
      // est une cible dès sa troisième bougie close (`vu`) et cesse de l'être
      // quand le prix atteint son bord loin (`pris`). « Non comblé » n'est pas
      // une propriété du FVG, c'est une propriété de l'INSTANT où on regarde.
      // Le bord LOIN du prix est la cible : c'est lui qu'il faut atteindre
      // pour que le déséquilibre soit comblé.
      ajoute(out, exe, z.haussier ? z.bas : z.haut, !z.haussier, z.t, 'FVG ouvert', tf);
    });
  }

  // ── EXTRÊMES DE TOUTE LA PÉRIODE ────────────────────────────────────────
  function extremes(out, exe) {
    var pas = pasDe(exe), h = -Infinity, l = Infinity, th = 0, tl = 0;
    for (var i = 0; i < exe.length; i++) {
      if (exe[i].h > h) { h = exe[i].h; th = exe[i].t + pas; }
      if (exe[i].l < l) { l = exe[i].l; tl = exe[i].t + pas; }
    }
    ajoute(out, exe, h, true, th, 'extrême données', 'tout');
    ajoute(out, exe, l, false, tl, 'extrême données', 'tout');
  }

  /**
   * Tous les bassins, toutes sources confondues.
   * @param D      les séries disponibles
   * @param exe    l'unité d'exécution, qui sert à dater les franchissements
   * @param heure  la fonction d'heure de New York du modèle appelant
   * @param quels  liste des types retenus, ou null pour tous
   */
  function tous(D, exe, heure, quels) {
    var out = [];
    var m30 = D.m15 && D.m15.length > 30 ? ST.agreger(D.m15, 2) : null;
    var h4 = D.h1 && D.h1.length > 30 ? ST.agreger(D.h1, 4) : null;
    var unites = [['m5', D.m5], ['m15', D.m15], ['m30', m30], ['h1', D.h1], ['h4', h4]];
    var veut = function (t) { return !quels || quels.indexOf(t) >= 0; };

    unites.forEach(function (u) {
      if (!u[1] || u[1].length < 40) return;
      var atrs = ST.atr(u[1], 14), atr = atrs[atrs.length - 1] || 0;
      if (veut('swings')) swings(out, u[1], exe, u[0], atr);
      if (veut('lrlr')) lrlr(out, u[1], exe, u[0], atr);
      if (veut('fvg')) fvgOuverts(out, u[1], exe, u[0]);
    });
    if (veut('ecarts')) ecarts(out, exe, heure);
    if (veut('seances')) seances(out, exe, heure);
    if (veut('extremes')) extremes(out, exe);
    return out.sort(function (a, b) { return a.vu - b.vu; });
  }

  root.DOL = { tous: tous, CFG: CFG };
})(typeof window !== 'undefined' ? window : this);
