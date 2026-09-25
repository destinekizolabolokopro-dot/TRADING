'use strict';
/**
 * LE MODÈLE — version navigateur, calquée sur scripts/mech.js.
 *
 * Même chaîne, mêmes définitions, mêmes réglages que ceux qui ont été
 * MESURÉS :
 *
 *   NQ seul · bougies 5 min · 09 h 30 → 10 h 00 New York
 *   56 trades · 83,9 % de réussite · espérance +0,237 R · profit factor 2,45
 *   drawdown maximal 2,21 R    (voir scripts/REGLAGES.md)
 *
 * Réserve, à garder en tête : ce réglage est le meilleur de 263 essais menés
 * sur la même période de soixante jours. Il tient sur deux blocs de trente
 * jours et résiste au déplacement de ses paramètres, mais il ne transfère ni
 * à l'ES ni à une autre unité d'exécution. Le seuil d'équilibre est de 68 %
 * de trades non perdants : la marge n'est que de quinze points.
 *
 *   BIAIS HTF → DOL → NIVEAU CLÉ → TOUCHE → IFVG (clôture de corps) → ENTRÉE
 */
(function (root) {

  var CFG = {
    // ── FENÊTRE ──────────────────────────────────────────────────────────
    // 09 h 00 → 10 h 00 New York, soit 15 h 00 → 16 h 00 à Paris.
    ghDeb: 9 * 60, ghFin: 10 * 60,        // heure de New York

    // ── BIAIS ET NIVEAUX ─────────────────────────────────────────────────
    seuil: 2, fvgn: 1,                    // biais : score minimum, FVG comptés par unité
    keyAge: 400, react: 12,               // âge d'un niveau, bougies entre touche et IFVG
    buf: 0.02, atrMin: 0.3,               // tampon du stop en %, stop minimum en fraction d'ATR
    maxJour: 2,

    // ── STOP : LARGEUR ──────────────────────────────────────── [MESURÉ]
    // Le stop était au bord de l'IFVG de confirmation, et rien d'autre. Or ce
    // bord est souvent à dix ou vingt points de l'entrée : le prix y revient
    // pour respirer, sans que la lecture soit fausse. `slx` l'éloigne d'un
    // multiple de cette distance.
    //
    //   Mesuré sur 64 signaux, fenêtre 09h00-10h00, comptage prudent :
    //     slx 1  (l'ancien)  stop  30 pts   56,3 % de réussite   −2 659 €
    //     slx 2              stop  59 pts   79,7 %               −  403 €
    //     slx 3              stop  89 pts   76,6 %               +1 299 €
    //     slx 4              stop 118 pts   81,3 %               +3 058 €
    //     slx 6              stop 177 pts   84,4 %               +2 666 €
    //
    // slx 4 est retenu : 81,3 % de réussite pour un seuil d'équilibre à
    // 65,8 %, soit quinze points de marge — et un stop de 118 points tient
    // dans un contrat MNQ à 250 € de risque, ce que 177 points ne fait pas.
    slx: 4,

    // ── OBJECTIFS ────────────────────────────────────────────── [MESURÉ]
    // Le partiel est à 0,4 R du stop ÉLARGI, donc ~47 points : assez loin
    // pour qu'une bougie de 5 minutes ne puisse pas contenir l'aller et le
    // retour (2 % de bougies ambiguës contre 25 % avec l'ancien 0,5 R sur
    // stop serré), assez près pour être atteint quatre fois sur cinq.
    tp1: 0.4, tp2: 2.5, part: 0.9,

    // ── SORTIE FORCÉE ────────────────────────────────────────── [MESURÉ]
    // Sans limite, cinq positions sur soixante-quatre étaient tenues plus de
    // six heures, jusqu'à seize heures — donc la nuit, avec un risque de gap
    // que ni le backtest ni la règle de drawdown d'un compte financé ne
    // savent traiter. Couper à midi heure de New York ne coûte rien :
    //
    //   sortie 11h00   79,7 %   +3 102 €   durée moyenne  48 min
    //   sortie 12h00   81,3 %   +3 058 €   durée moyenne  60 min
    //   sortie 16h00   81,3 %   +2 985 €   durée moyenne  86 min
    //   aucune         81,3 %   +2 968 €   durée moyenne 119 min
    //
    // La position est soldée AU MARCHÉ à cette heure, gain ou perte.
    sortieMin: 12 * 60
  };

  var NY = 'America/New_York';
  var fmtET = new Intl.DateTimeFormat('en-US', { timeZone: NY, hour12: false,
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  var DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  function heure(t) {
    var o = {}; fmtET.formatToParts(new Date(t)).forEach(function (p) { o[p.type] = p.value; });
    var h = +o.hour; if (h === 24) h = 0;
    return { jour: o.year + '-' + o.month + '-' + o.day, dow: DOW[o.weekday], min: h * 60 + (+o.minute) };
  }

  // ── biais : score de respect des FVG sur 1D, 4H, 1H, 15M ────────── [COMM]
  // Respecté : le prix est entré dans la zone et en est ressorti du bon côté.
  // Non respecté : une bougie a clôturé au-delà, du côté opposé.
  function prepareBiais(series) {
    return series.map(function (cs) {
      var out = [];
      ST.fvgs(cs).forEach(function (z) {
        var iRes = z.casse != null ? z.casse : z.touche;
        if (iRes == null) return;
        var respecte = z.casse == null;
        out.push({ t: cs[iRes].t, c: (z.haussier ? 1 : -1) * (respecte ? 1 : -1) });
      });
      return out.sort(function (a, b) { return a.t - b.t; });
    });
  }
  function biaisA(prep, t) {
    var score = 0;
    prep.forEach(function (serie) {
      var d = serie.filter(function (r) { return r.t <= t; }).slice(-CFG.fvgn);
      var s = d.reduce(function (a, r) { return a + r.c; }, 0);
      score += s > 0 ? 1 : s < 0 ? -1 : 0;
    });
    return { score: score, dir: score >= CFG.seuil ? 1 : score <= -CFG.seuil ? -1 : 0 };
  }

  /**
   * Évalue le modèle sur les bougies fournies et rend l'état COURANT.
   * @param D { m1, m2, m5, m15, h1, d1 }
   */
  function evaluer(D) {
    if (!D || !D.m5 || D.m5.length < 80 || !D.h1 || !D.d1 || !D.m15) return null;
    var clock = D.m5;
    var m30 = ST.agreger(D.m15, 2), h4 = ST.agreger(D.h1, 4);
    var prep = prepareBiais([D.d1, h4, D.h1, D.m15]);
    var hierH1 = ST.hierarchie(D.h1);

    // ── niveaux clés : quatre familles, cinq unités ────────────────── [COMM]
    var UNITES = [{ cs: D.m5, n: 'M5' }, { cs: D.m15, n: 'M15' }, { cs: m30, n: 'M30' },
                  { cs: D.h1, n: 'H1' }, { cs: h4, n: 'H4' }];
    var niveaux = [];
    UNITES.forEach(function (u) {
      var push = function (zs, type) { zs.forEach(function (z) {
        niveaux.push({ type: type, tf: u.n, cs: u.cs, bas: z.bas, haut: z.haut,
          haussier: z.haussier, ne: z.ne, casse: z.casse == null ? null : z.casse }); }); };
      push(ST.fvgs(u.cs), 'FVG');
      push(ST.cisd(u.cs), 'CISD');
      push(ST.rejectionBlocks(u.cs), 'RB');
      var h = ST.hierarchie(u.cs);
      h.itl.forEach(function (x) { niveaux.push({ type: 'ITL', tf: u.n, cs: u.cs, bas: x.prix,
        haut: u.cs[x.i].h, haussier: true, ne: x.i, casse: null, vu: x.vu }); });
      h.ith.forEach(function (x) { niveaux.push({ type: 'ITH', tf: u.n, cs: u.cs, bas: u.cs[x.i].l,
        haut: x.prix, haussier: false, ne: x.i, casse: null, vu: x.vu }); });
    });

    var zIF = { '5m': ST.fvgs(D.m5), '2m': D.m2 ? ST.fvgs(D.m2) : [], '1m': D.m1 ? ST.fvgs(D.m1) : [] };
    var atrC = ST.atr(clock);

    // DOL : la liquidité intacte LA PLUS PROCHE dans le sens du biais.
    function dolNiveau(t, dir, px) {
      var idx = ST.idxA(D.h1, t); if (idx < 0) return null;
      var liste = dir > 0 ? hierH1.ith : hierH1.itl, best = null;
      for (var i = 0; i < liste.length; i++) {
        var sw = liste[i];
        if (sw.vu > t) continue;
        if (dir > 0 ? sw.prix <= px : sw.prix >= px) continue;
        var pris = false;
        for (var k = sw.i + 1; k <= idx; k++)
          if (dir > 0 ? D.h1[k].h > sw.prix : D.h1[k].l < sw.prix) { pris = true; break; }
        if (pris) continue;
        if (best == null || Math.abs(sw.prix - px) < Math.abs(best - px)) best = sw.prix;
      }
      return best;
    }

    // ── machine à états, identique au backtest ─────────────────────────────
    var etat = 'CHERCHE', dir = 0, key = null, legDeb = 0, tTouche = 0;
    // `tous` garde TOUS les signaux de la passe, pas seulement le dernier.
    // Le relevé automatique ne se déclenche pas de façon fiable : s'il ne
    // tourne qu'une fois dans la séance, il doit quand même retrouver les
    // deux signaux possibles de la journée, pas uniquement le plus récent.
    var parJour = {}, dernier = null, etapes = null, tous = [];

    for (var i = 60; i < clock.length; i++) {
      var bar = clock[i], e = heure(bar.t), px = bar.c;
      if (parJour[e.jour] === undefined) { parJour[e.jour] = 0; etat = 'CHERCHE'; key = null; }
      if (e.dow < 1 || e.dow > 5 || e.min < CFG.ghDeb || e.min >= CFG.ghFin) continue;
      if (parJour[e.jour] >= CFG.maxJour) continue;

      var b = biaisA(prep, bar.t);
      var etapeCourante = { score: b.score, dir: b.dir, dol: null, key: null, ifvg: null, t: bar.t };
      if (b.dir === 0) { etapes = etapeCourante; continue; }
      if (b.dir !== dir) { dir = b.dir; etat = 'CHERCHE'; key = null; }

      var dol = dolNiveau(bar.t, dir, px);
      etapeCourante.dol = dol;
      if (dol == null) { etapes = etapeCourante; continue; }

      if (etat === 'CHERCHE') {
        var best = null;
        for (var n = 0; n < niveaux.length; n++) {
          var z = niveaux[n], idx = ST.idxA(z.cs, bar.t);
          if (z.ne == null || z.ne > idx || idx - z.ne > CFG.keyAge) continue;
          if (z.vu && z.vu > bar.t) continue;
          if (z.casse != null && z.casse <= idx) continue;
          if (z.haussier !== (dir > 0)) continue;
          var d = dir > 0 ? px - z.haut : z.bas - px;
          if (d < 0) continue;
          if (!best || d < best.d) best = { z: z, d: d };
        }
        if (best) { key = best.z; etat = 'ATTEND_TOUCHE'; }
      }
      etapeCourante.key = key;

      if (etat === 'ATTEND_TOUCHE' && key) {
        if (bar.l <= key.haut && bar.h >= key.bas) { etat = 'ATTEND_IFVG'; tTouche = bar.t; legDeb = i; }
        else if (dir > 0 ? px < key.bas : px > key.haut) { key = null; etat = 'CHERCHE'; }
      }

      if (etat === 'ATTEND_IFVG' && key) {
        if (i - legDeb > CFG.react) { etat = 'CHERCHE'; key = null; etapes = etapeCourante; continue; }
        var choisi = null, ordre = ['5m', '2m', '1m'];
        for (var o = 0; o < ordre.length && !choisi; o++) {
          var zs = zIF[ordre[o]];
          for (var q = 0; q < zs.length; q++) {
            var zz = zs[q];
            if (zz.tCasse == null || zz.tCasse < tTouche || zz.tCasse > bar.t) continue;
            if ((zz.haussier ? -1 : 1) !== dir) continue;
            choisi = { z: zz, tf: ordre[o] }; break;
          }
        }
        etapeCourante.ifvg = choisi;
        if (choisi) {
          var L = dir > 0, entree = px, buf = entree * CFG.buf / 100;
          // Bord de l'IFVG, puis éloigné de `slx` fois cette distance.
          var bord = L ? choisi.z.bas - buf : choisi.z.haut + buf;
          var d0 = Math.abs(entree - bord);
          var sl = L ? entree - d0 * CFG.slx : entree + d0 * CFG.slx;
          // ⚠️ L'entrée est la CLÔTURE de la bougie de confirmation, le stop
          // est le bord de l'IFVG. Rien ne garantit que la clôture soit du bon
          // côté de ce bord : quand elle le dépasse, le « stop » se retrouve
          // DANS LE SENS DU GAIN, et l'ordre est impossible à passer. Mesuré
          // sur les vraies bougies NQ : 4 à 9 % des signaux selon la fenêtre,
          // et ils perdaient de l'argent. `Math.abs` ci-dessous effaçait le
          // signe et rendait l'anomalie invisible.
          var coherent = L ? bord < entree : bord > entree;
          var risq = Math.abs(entree - sl);
          // Le filtre d'ATR porte sur la distance STRUCTURELLE (le bord de
          // l'IFVG), pas sur la distance élargie : sinon `slx` ferait passer
          // n'importe quelle zone minuscule.
          if (coherent && d0 > 0 && atrC[i] && d0 >= atrC[i] * CFG.atrMin) {
            dernier = { sens: L ? 'LONG' : 'SHORT', t: bar.t, entree: +entree.toFixed(2),
              sl: +sl.toFixed(2), risq: risq,
              tp1: +(L ? entree + risq * CFG.tp1 : entree - risq * CFG.tp1).toFixed(2),
              tp: +(L ? entree + risq * CFG.tp2 : entree - risq * CFG.tp2).toFixed(2),
              rr: CFG.part * CFG.tp1 + (1 - CFG.part) * CFG.tp2,
              tf: choisi.tf, niveau: key.type + ' ' + key.tf, dol: dol,
              // Le contexte est figé ICI, au moment du signal. Sans ça, celui
              // qui lit le journal voit le biais et le DOL de la DERNIÈRE
              // bougie reçue — un autre instant, parfois des heures plus
              // tard. Un signal du 23/09 s'est ainsi retrouvé expliqué par
              // « biais neutre 0/4, DOL à null », alors que le modèle exige
              // un biais d'au moins 2 et un DOL pour entrer.
              biaisDir: etapeCourante.dir, biaisScore: etapeCourante.score,
              barre: i, derniere: i >= clock.length - 2 };
            tous.push(dernier);
            parJour[e.jour]++; etat = 'CHERCHE'; key = null;
          }
        }
      }
      etapes = etapeCourante;
    }

    // ── HORS FENÊTRE ────────────────────────────────────────────────────
    // La boucle ci-dessus ne regarde que 09 h 30 → 10 h 00, du lundi au
    // vendredi. Vingt-trois heures et demie par jour elle ne tourne pas, et
    // le site restait alors entièrement vide : aucun biais, aucun niveau,
    // aucune explication. On refait donc ici une lecture d'AFFICHAGE sur la
    // dernière bougie connue, sans machine à états et sans jamais produire de
    // trade. Rien de ce qui suit ne peut modifier un signal.
    var finB = clock[clock.length - 1], eFin = heure(finB.t);
    var horsFenetre = eFin.dow < 1 || eFin.dow > 5 ||
                      eFin.min < CFG.ghDeb || eFin.min >= CFG.ghFin;
    // ⚠️ La condition était `etapes == null`. Or `etapes` conserve la
    // DERNIÈRE bougie vue dans la fenêtre — celle de vendredi 09 h 55 si on
    // est dimanche. Elle n'est donc presque jamais nulle, et l'écran
    // affichait l'état de la séance précédente comme s'il était courant.
    // Hors fenêtre, on relit toujours la dernière bougie connue.
    if (horsFenetre || etapes == null) {
      var bAff = biaisA(prep, finB.t);
      dir = bAff.dir;
      etapes = { score: bAff.score, dir: bAff.dir, t: finB.t, ifvg: null,
                 dol: bAff.dir === 0 ? null : dolNiveau(finB.t, bAff.dir, finB.c),
                 key: null };
      if (bAff.dir !== 0) {
        var meilleur = null, iFin = clock.length - 1;
        for (var nn = 0; nn < niveaux.length; nn++) {
          var zA = niveaux[nn], idxA = ST.idxA(zA.cs, finB.t);
          if (zA.ne == null || zA.ne > idxA || idxA - zA.ne > CFG.keyAge) continue;
          if (zA.vu && zA.vu > finB.t) continue;
          if (zA.casse != null && zA.casse <= idxA) continue;
          if (zA.haussier !== (bAff.dir > 0)) continue;
          var dA = bAff.dir > 0 ? finB.c - zA.haut : zA.bas - finB.c;
          if (dA < 0) continue;
          if (meilleur == null || dA < meilleur.d) meilleur = { z: zA, d: dA };
        }
        if (meilleur) etapes.key = { type: meilleur.z.type, tf: meilleur.z.tf,
                                     bas: meilleur.z.bas, haut: meilleur.z.haut };
      }
    }

    // Pour l'affichage : ce que chaque unité offre comme niveaux clés valides
    // dans le sens du biais. C'est la matière du radar et de la liste.
    var fin = clock[clock.length - 1];
    var parTF = ['M5', 'M15', 'M30', 'H1', 'H4'].map(function (nom) {
      var n = 0, proche = null, type = null, liste = [];
      if (dir !== 0) niveaux.forEach(function (z) {
        if (z.tf !== nom) return;
        var idx = ST.idxA(z.cs, fin.t);
        if (z.ne == null || z.ne > idx || idx - z.ne > CFG.keyAge) return;
        if (z.vu && z.vu > fin.t) return;
        if (z.casse != null && z.casse <= idx) return;
        if (z.haussier !== (dir > 0)) return;
        var d = dir > 0 ? fin.c - z.haut : z.bas - fin.c;
        if (d < 0) return;
        n++;
        // Le radar a besoin des niveaux un par un, pas seulement de leur
        // nombre : un point par niveau, placé à sa distance du prix.
        liste.push({ type: z.type, d: d, bas: z.bas, haut: z.haut });
        if (proche == null || d < proche) { proche = d; type = z.type; }
      });
      liste.sort(function (a, b) { return a.d - b.d; });
      return { tf: nom, n: n, distance: proche, type: type, liste: liste.slice(0, 14) };
    });

    return {
      prix: fin.c, derniereBougie: fin.t,
      etat: etat,
      // Le sens et le score rendus sont ceux de la DERNIÈRE bougie évaluée, pas
      // ceux que la machine à états traîne depuis une bougie antérieure :
      // sinon on affiche « haussier » avec un score nul, ce qui se contredit.
      dir: etapes ? etapes.dir : 0,
      score: etapes ? etapes.score : 0,
      dol: etapes ? etapes.dol : null,
      key: etapes ? etapes.key : null,
      ifvg: etapes ? etapes.ifvg : null,
      // un signal n'est « vivant » que s'il vient d'être produit
      parTF: parTF,
      trade: dernier && dernier.derniere ? dernier : null,
      dernierSignal: dernier,
      tousSignaux: tous,
      hors: horsFenetre,
      cfg: CFG
    };
  }

  // ── quand le modèle peut-il parler ? ───────────────────────────────────
  // Le site n'émet de position que du lundi au vendredi entre 09 h 30 et
  // 10 h 00 à New York. Le reste du temps il doit le DIRE, pas se taire.
  function fenetre(now) {
    now = now || Date.now();
    var e = heure(now);
    var ouverte = e.dow >= 1 && e.dow <= 5 && e.min >= CFG.ghDeb && e.min < CFG.ghFin;
    if (ouverte) return { ouverte: true, ms: (CFG.ghFin - e.min) * 60000 };
    var t = now, d = e, ecoule = 0;
    for (var k = 0; k < 9; k++) {
      if (d.dow >= 1 && d.dow <= 5 && d.min < CFG.ghDeb)
        return { ouverte: false, ms: ecoule + (CFG.ghDeb - d.min) * 60000 };
      var saut = (24 * 60 - d.min) * 60000;         // jusqu'à minuit à New York
      ecoule += saut; t += saut; d = heure(t);
    }
    return { ouverte: false, ms: null };
  }

  root.Modele = { evaluer: evaluer, CFG: CFG, heure: heure, fenetre: fenetre };
})(typeof window !== 'undefined' ? window : this);
