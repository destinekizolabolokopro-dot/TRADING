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
    slMode: 'multiple', slx: 4,
    unites: 'M5,M15,M30,H1,H4',   // unités où chercher les niveaux clés

    // ── LES RÈGLES DU PLAN SOURCE ────────────────────────── [PLAN SOURCE]
    // Trois exigences du plan « 10AM OXXC » que le modèle ne tenait pas.
    // Elles viennent d'un document, pas d'un balayage : les appliquer est
    // beaucoup moins risqué que d'aller chercher la meilleure case d'une
    // grille sur les mêmes soixante jours.
    confirme2: true,       // « narrative confirmée sur NQ et ES ensemble »
    confirme2Ifvg: false,  // « IFVG + CISD présents sur NQ ET ES »
    exigeCISD: false,      // IFVG ET CISD, au lieu de l'un OU l'autre
    tp2Mode: 'R',          // 'R' = multiple du risque · 'dol' = la liquidité visée

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
      // ⚠️ UNE ZONE A DEUX VIES, ET CHACUNE DOIT RESTER DATÉE DE SON MOMENT.
      //
      // La version précédente n'émettait qu'UN événement par zone : celui de
      // la cassure si elle existait, sinon celui de la touche. Conséquence,
      // mesurée le 4 octobre : une zone H1 touchée le 1er octobre à 10 h
      // émettait « respectée » à cette date-là ; cassée le 2 octobre, cet
      // événement DISPARAISSAIT et était remplacé par « non respectée » à la
      // date de cassure. Le biais du 1er octobre changeait donc après coup.
      //
      // Effet réel : le robot a consigné deux signaux le 1er octobre ; rejoué
      // trois jours plus tard, le modèle n'en voyait plus aucun. Le backtest
      // mesurait une stratégie que personne ne pouvait trader, et le journal
      // en direct devenait incomparable avec lui.
      //
      // On émet donc LES DEUX : « respectée » à la touche, « non respectée »
      // à la cassure. Ce qui était vrai à un instant le reste.
        var pas = ST.pasDe(cs);
        if (z.touche != null && (z.casse == null || z.touche < z.casse))
          out.push({ t: cs[z.touche].t + pas, c: (z.haussier ? 1 : -1) });
        if (z.casse != null)
          out.push({ t: cs[z.casse].t + pas, c: (z.haussier ? -1 : 1) });
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
  function evaluer(D, D2) {
    if (!D || !D.m5 || D.m5.length < 80 || !D.h1 || !D.d1 || !D.m15) return null;
    var clock = D.m5;
    var m30 = ST.agreger(D.m15, 2), h4 = ST.agreger(D.h1, 4);
    var prep = prepareBiais([D.d1, h4, D.h1, D.m15]);
    var hierH1 = ST.hierarchie(D.h1);

    // ── LE MARCHÉ DE CONFIRMATION ────────────────────────── [PLAN SOURCE]
    // « Narrative journalière confirmée sur NQ et ES ENSEMBLE », et « IFVG +
    // CISD présents sur NQ ET ES ». Le plan ne demande pas de regarder le
    // second marché en option : il en fait une condition. Quand D2 est
    // fourni et que CFG.confirme2 est vrai, un signal n'est retenu que si le
    // biais du second marché va dans le même sens au même instant.
    var prep2 = null, ifvg2 = null;
    // Demandée mais indisponible : il faut le DIRE, pas filtrer en silence.
    // Sans ce drapeau, le site afficherait des signaux que le robot écarte.
    var sansConfirmation = CFG.confirme2 && !(D2 && D2.m5 && D2.m5.length > 80);
    if (D2 && D2.m5 && D2.m5.length > 80 && CFG.confirme2) {
      var h4b = ST.agreger(D2.h1, 4);
      prep2 = prepareBiais([D2.d1, h4b, D2.h1, D2.m15]);
      // Les IFVG du second marché sur son unité d'exécution, pour la variante
      // stricte : le plan veut l'inversion présente des deux côtés.
      ifvg2 = ST.fvgs(D2.m5).filter(function (z) { return z.tCasse != null; });
    }
    // Le second marché confirme-t-il à l'instant t, dans le sens `dir` ?
    function confirme2(t, dir) {
      if (!prep2) return true;                       // pas de second marché : neutre
      if (biaisA(prep2, t).dir !== dir) return false;
      if (!CFG.confirme2Ifvg) return true;
      // variante stricte : une inversion récente du bon sens sur le second marché
      var limite = t - (CFG.react || 12) * 5 * 60000;
      for (var q = ifvg2.length - 1; q >= 0; q--) {
        var z = ifvg2[q];
        if (z.tCasse > t || z.tCasse < limite) continue;
        if ((z.haussier ? -1 : 1) === dir) return true;
      }
      return false;
    }

    // ── niveaux clés : quatre familles, cinq unités ────────────────── [COMM]
    // Le plan de la source définit le PD Array comme un FVG M15 / M30 / H1 / H4.
    // Le M5 n'y figure pas. `unites` permet de le retirer et de mesurer.
    var TOUTES = [{ cs: D.m5, n: 'M5' }, { cs: D.m15, n: 'M15' }, { cs: m30, n: 'M30' },
                  { cs: D.h1, n: 'H1' }, { cs: h4, n: 'H4' }];
    var voulues = CFG.unites || 'M5,M15,M30,H1,H4';
    var UNITES = TOUTES.filter(function (u) { return voulues.indexOf(u.n) >= 0; });
    // Les CISD de l'unité d'exécution, horodatés, pour l'exigence « IFVG + CISD ».
    var cisdClock = ST.cisd(clock).map(function (z) {
      return { t: clock[z.ne] ? clock[z.ne].t : 0, haussier: z.haussier };
    }).filter(function (z) { return z.t > 0; });

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
    function objectif(L, entree, risq, dol) {
      var parR = L ? entree + risq * CFG.tp2 : entree - risq * CFG.tp2;
      if (CFG.tp2Mode !== 'dol' || dol == null) return parR;
      var bon = L ? dol > entree : dol < entree;
      if (!bon) return parR;                       // DOL du mauvais côté : on garde le R
      // le DOL, mais jamais plus loin que le plafond en R
      return L ? Math.min(dol, parR) : Math.max(dol, parR);
    }

    function dolNiveau(t, dir, px) {
      var idx = ST.idxClos(D.h1, t); if (idx < 0) return null;
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
    var etapeParJour = {};
    var parJour = {}, dernier = null, etapes = null, tous = [];

    for (var i = 60; i < clock.length; i++) {
      var bar = clock[i], e = heure(bar.t), px = bar.c;
      // ── CE QUE LE MODÈLE A VU PENDANT LA SÉANCE ───────────────────────
      // `etapes` finit par décrire la DERNIÈRE bougie reçue, qui est presque
      // toujours hors fenêtre : quand GitHub abandonne les créneaux de la
      // séance — mesuré le 30 septembre, les trois créneaux perdus — le
      // rattrapage de l'après-midi racontait l'état de 13 h 40, pas ce qui
      // s'était passé entre 09 h et 10 h. On garde donc à part la dernière
      // étape vue DANS la fenêtre, jour par jour.
      if (!etapeParJour[e.jour]) etapeParJour[e.jour] = null;
      // L'INSTANT DE LA DÉCISION est la CLÔTURE de cette bougie de 5 minutes,
      // pas son ouverture : le modèle lit `bar.c`. Tout ce qui s'est terminé à
      // cet instant est connu, la bougie de 5 minutes comprise. Dater la
      // décision à l'ouverture reculerait tout d'un cran — une sur-correction
      // aussi fausse que le regard en avant qu'on vient de retirer.
      var tD = clock[i + 1] ? clock[i + 1].t : bar.t + 300000;
      if (parJour[e.jour] === undefined) { parJour[e.jour] = 0; etat = 'CHERCHE'; key = null; }
      if (e.dow < 1 || e.dow > 5 || e.min < CFG.ghDeb || e.min >= CFG.ghFin) continue;
      if (parJour[e.jour] >= CFG.maxJour) continue;

      var b = biaisA(prep, tD);
      var etapeCourante = { score: b.score, dir: b.dir, dol: null, key: null, ifvg: null, t: bar.t };
      if (b.dir === 0) { etapes = etapeCourante; etapeParJour[e.jour] = etapeCourante; continue; }
      if (b.dir !== dir) { dir = b.dir; etat = 'CHERCHE'; key = null; }

      var dol = dolNiveau(bar.t, dir, px);
      etapeCourante.dol = dol;
      if (dol == null) { etapes = etapeCourante; etapeParJour[e.jour] = etapeCourante; continue; }

      if (etat === 'CHERCHE') {
        var best = null;
        for (var n = 0; n < niveaux.length; n++) {
          var z = niveaux[n], idx = ST.idxClos(z.cs, tD);
          if (z.ne == null || z.ne > idx || idx - z.ne > CFG.keyAge) continue;
          if (z.vu && z.vu > tD) continue;
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
        if (i - legDeb > CFG.react) { etat = 'CHERCHE'; key = null; etapes = etapeCourante; etapeParJour[e.jour] = etapeCourante; continue; }
        var choisi = null, ordre = ['5m', '2m', '1m'];
        for (var o = 0; o < ordre.length && !choisi; o++) {
          var zs = zIF[ordre[o]];
          for (var q = 0; q < zs.length; q++) {
            var zz = zs[q];
        // Les éléments de structure portent désormais l'instant où ils sont
        // CONNUS. On les compare donc à l'instant de la DÉCISION — la
        // clôture de la bougie de 5 minutes — et non à son ouverture, qui
        // écartait tout ce qui se confirmait pendant la bougie en cours.
            if (zz.tCasse == null || zz.tCasse < tTouche || zz.tCasse > tD) continue;
            if ((zz.haussier ? -1 : 1) !== dir) continue;
            choisi = { z: zz, tf: ordre[o] }; break;
          }
        }
        etapeCourante.ifvg = choisi;

        // ── LE SECOND MARCHÉ DOIT DIRE LA MÊME CHOSE ───────── [PLAN SOURCE]
        if (choisi && !confirme2(tD, dir)) { etapes = etapeCourante; etapeParJour[e.jour] = etapeCourante; continue; }

        // ── IFVG *ET* CISD ─────────────────────────────────── [PLAN SOURCE]
        // Le plan liste les deux : « IFVG + CISD présents ». Le modèle se
        // contentait de l'un OU de l'autre — l'IFVG servait de confirmation,
        // le CISD n'était qu'une des quatre familles de niveaux possibles.
        if (choisi && CFG.exigeCISD) {
          var cisdOk = false, limCisd = bar.t - CFG.react * 5 * 60000;
          for (var q3 = cisdClock.length - 1; q3 >= 0; q3--) {
            var zc = cisdClock[q3];
            if (zc.t > tD || zc.t < limCisd) continue;
            if (zc.haussier === (dir > 0)) { cisdOk = true; break; }
          }
          if (!cisdOk) { etapes = etapeCourante; etapeParJour[e.jour] = etapeCourante; continue; }
        }

        if (choisi) {
          var L = dir > 0, entree = px, buf = entree * CFG.buf / 100;
          // ── OÙ SE POSE LE STOP ───────────────────────────────────────
          //   'jambe'    sous (ou sur) l'extrémité de la jambe de
          //              manipulation, depuis la touche du niveau clé
          //              jusqu'à la bougie de confirmation. C'est la règle
          //              de la source : « SL : sous le dernier mouvement ».
          //              Aucun paramètre libre, donc rien à sur-ajuster.
          //   'multiple' le bord de l'IFVG éloigné de `slx` fois sa distance.
          //              Approximation numérique de la précédente, trouvée
          //              en balayant avant d'avoir la règle.
          var bord = L ? choisi.z.bas - buf : choisi.z.haut + buf;
          var d0 = Math.abs(entree - bord);
          var sl;
          if (CFG.slMode === 'jambe') {
            var seg = clock.slice(legDeb, i + 1), ext = L ? seg[0].l : seg[0].h;
            for (var q2 = 1; q2 < seg.length; q2++)
              ext = L ? Math.min(ext, seg[q2].l) : Math.max(ext, seg[q2].h);
            sl = L ? ext - buf : ext + buf;
          } else {
            sl = L ? entree - d0 * CFG.slx : entree + d0 * CFG.slx;
          }
          // ⚠️ L'entrée est la CLÔTURE de la bougie de confirmation, le stop
          // est le bord de l'IFVG. Rien ne garantit que la clôture soit du bon
          // côté de ce bord : quand elle le dépasse, le « stop » se retrouve
          // DANS LE SENS DU GAIN, et l'ordre est impossible à passer. Mesuré
          // sur les vraies bougies NQ : 4 à 9 % des signaux selon la fenêtre,
          // et ils perdaient de l'argent. `Math.abs` ci-dessous effaçait le
          // signe et rendait l'anomalie invisible.
          var coherent = (L ? bord < entree : bord > entree) && (L ? sl < entree : sl > entree);
          var risq = Math.abs(entree - sl);
          // Le filtre d'ATR porte sur la distance STRUCTURELLE (le bord de
          // l'IFVG), pas sur la distance élargie : sinon `slx` ferait passer
          // n'importe quelle zone minuscule.
          if (coherent && d0 > 0 && atrC[i] && d0 >= atrC[i] * CFG.atrMin) {
            dernier = { sens: L ? 'LONG' : 'SHORT', t: bar.t, entree: +entree.toFixed(2),
              sl: +sl.toFixed(2), risq: risq,
              tp1: +(L ? entree + risq * CFG.tp1 : entree - risq * CFG.tp1).toFixed(2),
              // ── OÙ SE POSE L'OBJECTIF ──────────────────── [PLAN SOURCE]
              // « TP : haut/bas de session, PD High/Low, ou extrémité d'un
              // CRT H1/H4 ». C'est un ENDROIT du graphique, pas une distance.
              // Le DOL — la liquidité intacte la plus proche — est ce que le
              // modèle sait calculer de plus proche de ça. Borné à tp2 R pour
              // que le runner reste atteignable.
              tp: +objectif(L, entree, risq, dol).toFixed(2),
              // ⚠️ CE CHAMP S'APPELAIT `rr` ET N'EN ÉTAIT PAS UN. Il portait
              // `part × tp1 + (1 − part) × tp2` = 0,61, c'est-à-dire le GAIN
              // SI TOUT EST TOUCHÉ — pas le rapport entre l'objectif et le
              // risque, qui vaut 2,50. Le site affichait donc « RR 0,61 » pour
              // un objectif situé à deux fois et demie le risque, et
              // scripts/kintt_test.js s'en servait comme PLAFOND de suivi :
              // il mesurait le modèle avec un objectif final à 0,61 au lieu de
              // 2,50, soit 2 116 € annoncés là où il y en avait 2 622.
              // Les deux nombres existent, ils ne disent pas la même chose et
              // ils portent désormais deux noms différents.
              rr: +(Math.abs(objectif(L, entree, risq, dol) - entree) / risq).toFixed(2),
              gainSiTout: +(CFG.part * CFG.tp1 + (1 - CFG.part) * CFG.tp2).toFixed(2),
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
      etapes = etapeCourante; etapeParJour[e.jour] = etapeCourante;
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
      var tFinD = finB.t + 300000;          // clôture de la dernière bougie connue
      var bAff = biaisA(prep, tFinD);
      dir = bAff.dir;
      etapes = { score: bAff.score, dir: bAff.dir, t: finB.t, ifvg: null,
                 dol: bAff.dir === 0 ? null : dolNiveau(tFinD, bAff.dir, finB.c),
                 key: null };
      if (bAff.dir !== 0) {
        var meilleur = null, iFin = clock.length - 1;
        for (var nn = 0; nn < niveaux.length; nn++) {
          var zA = niveaux[nn], idxA = ST.idxClos(zA.cs, tFinD);
          if (zA.ne == null || zA.ne > idxA || idxA - zA.ne > CFG.keyAge) continue;
          if (zA.vu && zA.vu > tFinD) continue;
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
        var idx = ST.idxClos(z.cs, fin.t + 300000);
        if (z.ne == null || z.ne > idx || idx - z.ne > CFG.keyAge) return;
        if (z.vu && z.vu > fin.t + 300000) return;
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
      // L'état vu DANS la fenêtre du jour de la dernière bougie. C'est lui
      // qu'un relevé de rattrapage doit raconter : « voici où la chaîne s'est
      // arrêtée pendant la séance », et non « voici où en est le marché
      // maintenant », qui n'apprend rien sur une séance déjà finie.
      etapeFenetre: etapeParJour[heure(fin.t).jour] || null,
      sansConfirmation: sansConfirmation,
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

  // ── LES SÉRIES DONT LE MODÈLE A BESOIN ──────────────────────────────────
  // Déclarées ICI, parce que c'est le modèle qui les consomme. Elles étaient
  // recopiées dans chaque chargeur, et elles avaient divergé sans que personne
  // le voie : le robot chargeait 60 minutes sur 3 mois, le banc d'essai
  // 1 heure sur 6 mois. Mesuré sur les mêmes bougies d'exécution, cela donnait
  // 42 signaux d'un côté et 37 de l'autre, et pas les mêmes jours. Autrement
  // dit le backtest mesurait une AUTRE stratégie que celle qui tourne.
  //
  // Six mois d'horaire sont retenus : le biais et les niveaux H4 sont agrégés
  // depuis cette série, et trois mois ne suffisent pas à couvrir un niveau
  // vieux de keyAge bougies.
  var SERIES = [
    { interval: '1m',  range: '8d',  cle: 'm1'  },
    { interval: '2m',  range: '60d', cle: 'm2'  },
    { interval: '5m',  range: '60d', cle: 'm5'  },
    { interval: '15m', range: '60d', cle: 'm15' },
    { interval: '1h',  range: '6mo', cle: 'h1'  },
    { interval: '1d',  range: '1y',  cle: 'd1'  }
  ];
  // Le marché de confirmation n'a pas besoin des unités fines : seul son biais
  // est consulté, et le biais se lit sur 15m, 1h, 4h et le journalier.
  var SERIES2 = SERIES.filter(function (s) { return ['m5', 'm15', 'h1', 'd1'].indexOf(s.cle) >= 0; });

  root.Modele = { evaluer: evaluer, CFG: CFG, heure: heure, fenetre: fenetre,
                  SERIES: SERIES, SERIES2: SERIES2 };
})(typeof window !== 'undefined' ? window : this);
