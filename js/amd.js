'use strict';
/**
 * LE MODÈLE AMD — manipulation puis distribution.  js/amd.js
 *
 * Décrit par l'utilisateur, et transcrit ici sans rien y ajouter :
 *
 *   1. La GRANDE LIQUIDITÉ, connue avant l'ouverture : haut et bas de la
 *      veille, haut et bas de la semaine passée, sommets et creux
 *      intermédiaires H4 et H1 encore intacts.
 *   2. Les LIQUIDITÉS INTERNES, « les petites » : au-dessus ou en dessous de
 *      CHAQUE swing high et swing low, en H4, H1 et M30.
 *   3. Les FVG en H1 et M30.
 *   4. On retient les FVG qui ont une liquidité interne derrière eux ET qui
 *      pointent à l'INVERSE de la grande liquidité prise au préalable —
 *      celle-ci est balayée vers 15 h-16 h Paris, soit 09 h-10 h New York.
 *      Ce balayage est la MANIPULATION ; ce qui suit est la DISTRIBUTION.
 *   5. Le scénario : après la manipulation, le prix repart en sens inverse
 *      chercher les liquidités internes.
 *   6. L'entrée se fait UNIQUEMENT sur un IFVG allant dans le sens prévu.
 *
 * MESURÉ DANS CE DÉPÔT, ce qui justifie la fenêtre de manipulation :
 * sur NQ et ES, 276 balayages de grande liquidité en séance régulière,
 * 64,1 % tombent entre 08 h et 10 h New York. Les niveaux que tout le monde
 * voit (veille, semaine) partent à 08 h ; les bassins H1 intermédiaires se
 * font prendre plus tard, pic à 09 h-10 h New York — 15 h-16 h Paris.
 * Voir scripts/heure_liq.js.
 *
 * CE QUI EST UNE HYPOTHÈSE DE MA PART, et doit être lu comme telle :
 *   — « liquidité interne derrière le FVG » : je l'interprète comme un swing
 *     intact situé au-delà du FVG dans le sens prévu, c'est-à-dire la cible
 *     que la distribution irait chercher ;
 *   — la distance maximale entre le FVG et le prix, et le délai maximal
 *     entre la manipulation et l'IFVG, sont des réglages. La description n'en
 *     donne pas.
 */
(function (root) {

  var CFG = {
    // ── MANIPULATION ────────────────────────────────────────────────────
    // La fenêtre où la grande liquidité doit être balayée, heure de New York.
    manipDeb: 9 * 60, manipFin: 10 * 60,
    // ── DISTRIBUTION ────────────────────────────────────────────────────
    // La fenêtre où l'IFVG d'entrée est accepté, après la manipulation.
    distDeb: 9 * 60, distFin: 12 * 60,
    // Délai maximal entre la manipulation et l'entrée, EN MINUTES. Exprimé
    // en minutes et non en bougies, pour que le modèle garde le même sens
    // quelle que soit l'unité d'exécution — 48 bougies valent quatre heures
    // en 5 minutes et deux jours en 1 heure.
    delaiMin: 240,
    // ── GRANDE LIQUIDITÉ : quels bassins comptent ───────────────────────
    veille: true, semaine: true, h4: true, h1: true,

    // ── SMT : LA DIVERGENCE AVEC LE MARCHÉ CORRÉLÉ ───────────────────────
    // Au moment du balayage, le marché corrélé fait-il le même extrême ?
    //
    //   NQ fait un nouveau plus-haut, l'ES NE LE FAIT PAS
    //     → le balayage n'est pas porté par l'ensemble du marché, c'est une
    //       manipulation : DIVERGENCE, et le scénario de retournement est
    //       renforcé.
    //   les deux font le nouveau plus-haut
    //     → le mouvement est général, le balayage peut être réel.
    //
    //   'ignore'   on ne regarde pas le marché corrélé (comportement d'origine)
    //   'exige'    on ne prend QUE s'il y a divergence
    //   'confirme' on ne prend QUE s'il n'y en a pas — l'inverse, pour
    //              vérifier que la divergence n'est pas qu'un filtre au hasard
    smt: 'ignore',
    // La fenêtre de comparaison, en minutes avant le balayage.
    smtMin: 120,
    // Tolérance : « ne fait pas le même extrême » doit vouloir dire quelque
    // chose. Exprimée en fraction de l'étendue de la fenêtre sur le marché
    // corrélé, pour être sans unité et comparable entre indices.
    smtTol: 0.02,
    // ── FVG RETENUS ─────────────────────────────────────────────────────
    unitesFVG: ['m30', 'h1'],
    // Le prix doit être à moins de `fvgPortee` ATR du FVG retenu.
    fvgPortee: 3,
    // ── LIQUIDITÉ INTERNE : où chercher les swings ───────────────────────
    unitesInt: ['m30', 'h1', 'h4'],
    // ── SORTIE ──────────────────────────────────────────────────────────
    // Stop au-delà de l'extrême de la manipulation, élargi d'un tampon.
    buf: 0.02,
    cible: 'proche',          // 'proche' | 'loin' : quelle liquidité interne
    // ── LE POINT MORT, ET POURQUOI C'EST UNE RÈGLE EXPLICITE ─────────────
    // `part: 0` signifie « rien vendu au premier palier ». Dans
    // js/position.js, atteindre tp1 déplace alors le stop à l'entrée sans
    // qu'aucune part ne soit encaissée : la position devient gratuite. Le
    // résultat du modèle AMD repose entièrement là-dessus — 41 trades sur
    // 113 sortent ainsi, à peu près à zéro, et ce sont eux qui font l'écart.
    //
    // Ce comportement était un EFFET DE BORD du code, pas une règle énoncée.
    // Il est écrit ici noir sur blanc pour qu'on sache ce qu'on mesure :
    //   tp1   le palier qui arme le point mort (rien n'est vendu)
    //   tp2   l'objectif, borné par la liquidité interne visée
    //   part  0 = rien vendu · >0 = une part encaissée à tp1
    //
    // ⚠️ RÉSERVE D'EXÉCUTION : sortir « à l'entrée » suppose un stop servi au
    // prix exact. Dans la réalité il dérape. L'épreuve des frais de
    // scripts/amd_test.js dit à partir de quel dérapage l'avantage disparaît.
    tp1: 0.4, tp2: 2.5, part: 0,
    sortieMin: 16 * 60,
    maxJour: 2,
    slMin: 0.3                // stop minimum, en fraction d'ATR
  };

  // ── outils de temps, identiques au modèle en place ─────────────────────
  function heure(t) {
    var d = new Date(t);
    var ny = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return { min: ny.getHours() * 60 + ny.getMinutes(), dow: ny.getDay(),
             jour: ny.getFullYear() + '-' + String(ny.getMonth() + 1).padStart(2, '0') +
                   '-' + String(ny.getDate()).padStart(2, '0') };
  }

  /**
   * Les swings d'une série, avec l'instant où ils sont CONNUS (`vu`) et
   * l'instant où ils sont PRIS (`pris`), c'est-à-dire traversés par le prix.
   * Un bassin n'existe comme cible qu'entre les deux.
   */
  function bassins(cs, m5) {
    var h = ST.hierarchie(cs), out = [];
    [['sth', true], ['ith', true], ['stl', false], ['itl', false]].forEach(function (p) {
      h[p[0]].forEach(function (sw) {
        if (sw.vu == null) return;
        out.push({ prix: sw.prix, haut: p[1], vu: sw.vu, pris: null,
                   rang: p[0][0] === 'i' ? 'intermediaire' : 'court' });
      });
    });
    // L'instant de prise se lit sur l'unité d'exécution : c'est la plus fine
    // dont on dispose, donc la plus honnête pour dater un franchissement.
    out.forEach(function (b) {
      for (var i = 0; i < m5.length; i++) {
        if (m5[i].t <= b.vu) continue;
        if (b.haut ? m5[i].h >= b.prix : m5[i].l <= b.prix) {
          // La bougie se termine un pas plus tard : c'est là qu'on le sait.
          b.pris = m5[i].t + ST.pasDe(m5);
          break;
        }
      }
    });
    return out;
  }

  /**
   * SMT — Y A-T-IL DIVERGENCE AVEC LE MARCHÉ CORRÉLÉ ?
   *
   * `haut` dit si le balayage a pris un sommet. On regarde la fenêtre des
   * `smtMin` dernières minutes sur le marché corrélé et on demande : sa
   * dernière bougie fait-elle, elle aussi, l'extrême de cette fenêtre ?
   *
   *   non  → DIVERGENCE : le corrélé n'a pas suivi.
   *   oui  → pas de divergence : les deux marchés ont fait le même extrême.
   *
   * Tout est lu sur des bougies déjà closes à l'instant de la décision : la
   * comparaison porte sur la même fenêtre temporelle des deux côtés, jamais
   * sur une bougie en cours.
   *
   * @returns true s'il y a divergence, false sinon, null si on ne peut pas
   *          juger (pas de marché corrélé, fenêtre trop pauvre).
   */
  function smt(E, t, haut) {
    if (!E || !E.length) return null;
    var pas = ST.pasDe(E);
    var fen = [];
    for (var i = 0; i < E.length; i++) {
      // Une bougie ne compte que si elle est CLOSE à l'instant t.
      if (E[i].t + pas > t) break;
      if (E[i].t + pas >= t - CFG.smtMin * 60000) fen.push(E[i]);
    }
    if (fen.length < 3) return null;
    var der = fen[fen.length - 1];
    var hi = -Infinity, lo = Infinity;
    for (var k = 0; k < fen.length; k++) { hi = Math.max(hi, fen[k].h); lo = Math.min(lo, fen[k].l); }
    var etendue = hi - lo;
    if (!(etendue > 0)) return null;
    var tol = CFG.smtTol * etendue;
    // Le corrélé fait-il l'extrême de la fenêtre sur sa dernière bougie ?
    var suit = haut ? der.h >= hi - tol : der.l <= lo + tol;
    return !suit;
  }

  /** Haut et bas de séance régulière, par journée. */
  function seances(m5) {
    var par = {};
    m5.forEach(function (b) {
      var e = heure(b.t);
      if (e.dow < 1 || e.dow > 5) return;
      if (e.min < 9 * 60 + 30 || e.min >= 16 * 60) return;
      var j = par[e.jour] = par[e.jour] || { h: -Infinity, l: Infinity, fin: 0 };
      j.h = Math.max(j.h, b.h); j.l = Math.min(j.l, b.l); j.fin = Math.max(j.fin, b.t);
    });
    return par;
  }

  function lundiDe(jour) {
    var d = new Date(jour + 'T12:00:00Z'), l = new Date(d);
    l.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return l.toISOString().slice(0, 10);
  }

  /**
   * Évalue le modèle. Rend tous les signaux de la période.
   * @param D { m1, m2, m5, m15, h1, d1 }
   */
  /**
   * @param D     les séries disponibles
   * @param opts  { execution: 'm5' | 'h1' } l'unité qui décide. Par défaut le
   *              5 minutes. Le 1 heure permet de remonter à deux ans, au prix
   *              d'une incertitude intrabougie bien plus grande.
   */
  function evaluer(D, opts) {
    opts = opts || {};
    var cleExe = opts.execution || 'm5';
    var m5 = D[cleExe];
    // Le marché corrélé, pour la divergence SMT. Absent = filtre inactif.
    var Ecs = opts.E && opts.E[cleExe] ? opts.E[cleExe] : null;
    if (!m5 || m5.length < 200 || !D.h1) return { tousSignaux: [], manips: [] };
    var pas = ST.pasDe(m5);
    // Les unités supérieures sont agrégées de ce qui existe. En longue
    // période, le 15 minutes n'existe pas : il n'y a donc pas de M30, et le
    // modèle se rabat sur H1 et H4. C'est une perte de finesse assumée.
    var m30 = D.m15 && D.m15.length > 30 ? ST.agreger(D.m15, 2) : null;
    var h4 = ST.agreger(D.h1, 4);
    var series = { m30: m30, h1: D.h1, h4: h4 };

    // ── les bassins, par unité ────────────────────────────────────────────
    var B = {};
    CFG.unitesInt.concat(['h1', 'h4']).forEach(function (u) {
      if (!B[u] && series[u] && series[u].length > 30) B[u] = bassins(series[u], m5);
    });
    // Le délai converti en nombre de bougies de l'unité d'exécution.
    var delaiBarres = Math.max(1, Math.round(CFG.delaiMin * 60000 / pas));

    // ── les FVG des unités retenues, horodatés ───────────────────────────
    var Z = {};
    CFG.unitesFVG.forEach(function (u) {
      if (!series[u]) return;
      var cs = series[u], p = ST.pasDe(cs);
      Z[u] = ST.fvgs(cs).map(function (z) {
        return { bas: z.bas, haut: z.haut, haussier: z.haussier,
                 t: z.t, tCasse: z.tCasse,
                 fin: cs[z.ne] ? cs[z.ne].t + p : z.t };
      });
    });

    // ── les IFVG de l'unité d'exécution : un FVG cassé ───────────────────
    // Un FVG haussier cassé par le bas devient un signal BAISSIER, et
    // réciproquement. C'est la définition déjà retenue par js/modele.js.
    var ifvg = ST.fvgs(m5).filter(function (z) { return z.tCasse != null; })
      .map(function (z) {
        return { bas: z.bas, haut: z.haut, sens: z.haussier ? -1 : 1, t: z.tCasse };
      }).sort(function (a, b) { return a.t - b.t; });

    var sea = seances(m5);
    var joursSea = Object.keys(sea).sort();
    var atr = ST.atr(m5, 14);

    // ── parcours, bougie de 5 minutes par bougie de 5 minutes ────────────
    var tous = [], parJour = {}, manip = null, jourManip = null;
    var manips = [];   // toutes les manipulations détectées, abouties ou non

    for (var i = 60; i < m5.length; i++) {
      var bar = m5[i], e = heure(bar.t);
      // L'instant de DÉCISION est la clôture de la bougie, pas son ouverture.
      var tD = m5[i + 1] ? m5[i + 1].t : bar.t + pas;
      if (e.dow < 1 || e.dow > 5) continue;

      if (jourManip !== e.jour) { manip = null; jourManip = e.jour; }

      // ── 1. LA GRANDE LIQUIDITÉ DU JOUR ───────────────────────────────
      // Reconstituée une fois par journée, à partir de ce qui est clos.
      var grands = [];
      var iv = joursSea.filter(function (j) { return sea[j].fin < bar.t; });
      if (CFG.veille && iv.length) {
        var v = sea[iv[iv.length - 1]];
        grands.push({ prix: v.h, haut: true, nom: 'veille' });
        grands.push({ prix: v.l, haut: false, nom: 'veille' });
      }
      if (CFG.semaine && iv.length) {
        var semCour = lundiDe(e.jour), hS = -Infinity, lS = Infinity, trouve = false;
        iv.forEach(function (j) {
          if (lundiDe(j) === semCour) return;
          if (lundiDe(j) < semCour) { }
        });
        // la semaine précédente : les journées closes dont le lundi est le
        // plus récent strictement antérieur au lundi courant
        var lundis = iv.map(lundiDe).filter(function (l) { return l < semCour; });
        if (lundis.length) {
          var lp = lundis.sort()[lundis.length - 1];
          iv.forEach(function (j) {
            if (lundiDe(j) !== lp) return;
            hS = Math.max(hS, sea[j].h); lS = Math.min(lS, sea[j].l); trouve = true;
          });
        }
        if (trouve) {
          grands.push({ prix: hS, haut: true, nom: 'semaine' });
          grands.push({ prix: lS, haut: false, nom: 'semaine' });
        }
      }
      ['h4', 'h1'].forEach(function (u) {
        if (!CFG[u] || !B[u]) return;
        B[u].forEach(function (b) {
          if (b.rang !== 'intermediaire') return;
          if (b.vu >= tD) return;
          if (b.pris != null && b.pris <= tD) return;
          grands.push({ prix: b.prix, haut: b.haut, nom: u });
        });
      });

      // ── 2. LA MANIPULATION : un grand bassin est-il balayé ? ──────────
      if (manip == null && e.min >= CFG.manipDeb && e.min < CFG.manipFin) {
        // ⚠️ L'ORDRE DE TEST NE DOIT RIEN DÉCIDER. La première version
        // parcourait `grands` dans l'ordre où les bassins y sont empilés —
        // veille, puis semaine, puis H4, puis H1. Une bougie qui franchit
        // plusieurs bassins d'un coup était donc TOUJOURS attribuée à la
        // veille, et les bassins H4 et H1 n'apparaissaient jamais dans le
        // relevé : 77 manipulations sur 90 étiquetées « veille », ce qui
        // était un artefact de mon code et non une observation.
        // Le bassin retenu est celui dont le prix est le plus proche de la
        // clôture précédente : c'est celui que le prix atteint d'abord.
        var ref = m5[i - 1] ? m5[i - 1].c : bar.o;
        grands.sort(function (x, y) {
          return Math.abs(x.prix - ref) - Math.abs(y.prix - ref);
        });
        for (var g = 0; g < grands.length; g++) {
          var gl = grands[g];
          if (gl.haut ? bar.h >= gl.prix : bar.l <= gl.prix) {
            // Un sommet balayé annonce une DESCENTE, et réciproquement.
            // SMT évalué À L'INSTANT DU BALAYAGE, pas plus tard : c'est là
            // que l'information existe, et la retarder serait lire l'avenir
            // à rebours.
            var div = smt(Ecs, tD, gl.haut);
            if (CFG.smt === 'exige' && div !== true) continue;
            if (CFG.smt === 'confirme' && div !== false) continue;
            manip = { sens: gl.haut ? -1 : 1, prix: gl.prix, nom: gl.nom, smt: div,
                      ext: gl.haut ? bar.h : bar.l, i: i, t: tD };
            manips.push({ nom: gl.nom, jour: e.jour, min: e.min, sens: manip.sens, smt: div });
            break;
          }
        }
        if (manip) continue;   // la bougie du balayage ne sert pas d'entrée
      }
      if (manip == null) continue;
      if (e.min < CFG.distDeb || e.min >= CFG.distFin) continue;
      if (i - manip.i > delaiBarres) continue;
      if ((parJour[e.jour] || 0) >= CFG.maxJour) continue;

      var dir = manip.sens, L = dir > 0;

      // ── 3. LES LIQUIDITÉS INTERNES DANS LE SENS PRÉVU ────────────────
      var internes = [];
      CFG.unitesInt.forEach(function (u) {
        if (!B[u]) return;
        B[u].forEach(function (b) {
          if (b.vu >= tD) return;
          if (b.pris != null && b.pris <= tD) return;
          if (b.haut !== L) return;                    // du bon côté du prix
          if (L ? b.prix <= bar.c : b.prix >= bar.c) return;
          internes.push(b.prix);
        });
      });
      if (!internes.length) continue;
      internes.sort(function (a, b2) { return L ? a - b2 : b2 - a; });
      var cible = CFG.cible === 'loin' ? internes[internes.length - 1] : internes[0];

      // ── 4. UN FVG RETENU : bon sens, et une interne derrière lui ──────
      var a = atr[i] || 0;
      if (!(a > 0)) continue;
      var zOk = null;
      for (var u2 = 0; u2 < CFG.unitesFVG.length && !zOk; u2++) {
        var lst = Z[CFG.unitesFVG[u2]] || [];
        for (var q = 0; q < lst.length; q++) {
          var z = lst[q];
          if (z.fin >= tD) continue;                       // pas encore connu
          if (z.tCasse != null && z.tCasse <= tD) continue; // déjà invalidé
          if ((z.haussier ? 1 : -1) !== dir) continue;      // doit pointer dans le sens prévu
          // le prix doit être à portée de la zone
          var d = bar.c < z.bas ? z.bas - bar.c : bar.c > z.haut ? bar.c - z.haut : 0;
          if (d > CFG.fvgPortee * a) continue;
          // une liquidité interne doit se trouver AU-DELÀ de la zone
          var auDela = internes.some(function (p) { return L ? p > z.haut : p < z.bas; });
          if (!auDela) continue;
          zOk = z; break;
        }
      }
      if (!zOk) continue;

      // ── 5. L'ENTRÉE : UNIQUEMENT SUR UN IFVG DU BON SENS ─────────────
      var decl = null;
      for (var k = ifvg.length - 1; k >= 0; k--) {
        var z2 = ifvg[k];
        if (z2.t > tD) continue;
        if (z2.t <= manip.t) break;              // l'IFVG doit suivre la manipulation
        if (z2.sens !== dir) continue;
        decl = z2; break;
      }
      if (!decl) continue;

      // ── 6. NIVEAUX ────────────────────────────────────────────────────
      // Le stop va au-delà de l'extrême de la manipulation : si le prix y
      // retourne, le scénario est faux par construction.
      var entree = bar.c;
      var sl = L ? manip.ext * (1 - CFG.buf / 100) : manip.ext * (1 + CFG.buf / 100);
      var risq = Math.abs(entree - sl);
      if (risq < CFG.slMin * a) risq = CFG.slMin * a;
      if (!(risq > 0)) continue;
      sl = L ? entree - risq : entree + risq;
      // L'objectif est la liquidité interne, bornée par le multiple de risque.
      var parR = L ? entree + risq * CFG.tp2 : entree - risq * CFG.tp2;
      var tp = L ? Math.min(cible, parR) : Math.max(cible, parR);
      if (L ? tp <= entree : tp >= entree) continue;

      tous.push({ sens: L ? 'LONG' : 'SHORT', t: tD, entree: entree, sl: sl, risq: risq,
                  tp1: L ? entree + risq * CFG.tp1 : entree - risq * CFG.tp1,
                  tp: tp, dol: cible, manip: manip.nom, manipPrix: manip.prix, smt: manip.smt,
                  jour: e.jour, min: e.min });
      parJour[e.jour] = (parJour[e.jour] || 0) + 1;
      manip = null;   // un scénario par manipulation
    }

    return { tousSignaux: tous, manips: manips };
  }

  root.AMD = { evaluer: evaluer, CFG: CFG, heure: heure, smt: smt };
})(typeof window !== 'undefined' ? window : this);
