'use strict';
/**
 * ╔═══════════════════════════════════════════════════════════════════════╗
 * ║  KINTT — le plan « 10AM OXXC », suivi à la lettre.                    ║
 * ╚═══════════════════════════════════════════════════════════════════════╝
 *
 * Stratégie SÉPARÉE de js/modele.js. Les deux tournent côte à côte et se
 * mesurent l'une contre l'autre ; aucune ne remplace l'autre.
 *
 *   js/modele.js  ce qu'on a construit en balayant, puis corrigé. Fenêtre
 *                 09h-10h, stop élargi, objectif à une distance fixe.
 *   js/kintt.js   ce que le plan source DIT, sans arrangement. Fenêtre
 *                 10h-12h, stop sous le balayage, objectif sur une zone.
 *
 * ── L'HISTOIRE QUE RACONTE LE PLAN ────────────────────────────────────────
 *
 *   1. On choisit un camp AVANT l'ouverture. Peu importe lequel, mais le NQ
 *      et l'ES doivent raconter la même chose.
 *   2. On repère une zone laissée INTACTE en M15 / M30 / H1 / H4.
 *   3. À 09h30 on regarde, on ne touche à rien. Même si la zone est déjà
 *      touchée, on attend 10h.
 *   4. Entre 10h et 11h, le prix va chercher les stops — le plus bas ou le
 *      plus haut de la séance, ou celui de la bougie de 9h — PUIS il se
 *      retourne. C'est le piège, et c'est le signal.
 *   5. On confirme en unité fine : une inversion ET un CISD, dans le sens
 *      du trade.
 *   6. Si rien à 11h, une heure de rab — mais avec une confirmation FRAÎCHE.
 *   7. À 12h00, terminé. « Aucun setup avant 12h00 NY = aucun trade. »
 *
 * ── CE QUE LE PLAN NE DIT PAS, ET QU'IL A FALLU CHOISIR ───────────────────
 * Chaque choix est marqué [CHOIX] dans le code. Ils sont peu nombreux et
 * chacun est réversible par un réglage.
 */
(function (root) {

  var ST = root.ST;

  var CFG = {
    // ── LA FENÊTRE ─────────────────────────────────────────── [PLAN §3]
    // « 10h → 11h NY — fenêtre primaire », puis « 11h → 12h00 NY » étendue.
    // Avant 10h on regarde sans toucher, même si la zone est déjà touchée.
    obs: 9 * 60 + 30,        // on commence à observer à l'ouverture
    deb: 10 * 60,            // première entrée possible
    primaire: 11 * 60,       // fin de la fenêtre primaire
    fin: 12 * 60,            // « deadline secondaire ferme — au-delà, aucun trade »

    // ── LA NARRATIVE ───────────────────────────────────────── [PLAN §1]
    // « confirmée sur NQ et ES ensemble ». Le score compte les FVG respectés
    // par unité, comme dans l'autre modèle — c'est la seule définition de
    // « narrative » qu'on ait, et la garder identique permet de comparer les
    // deux stratégies sans que cette brique fasse la différence.
    seuil: 2, fvgn: 1,
    confirmeES: true,        // le second marché doit aller dans le même sens

    // ── LA ZONE ────────────────────────────────────────────── [PLAN §1]
    // « PD Array unmitigated → FVG M15 / M30 / H1 / H4 ». Le M5 n'y figure
    // PAS, contrairement à l'autre modèle.
    unites: 'M15,M30,H1,H4',
    intact: true,            // « unmitigated » : jamais touché
    ageMax: 400,             // [CHOIX] au-delà, la zone est considérée périmée

    // ── LE BALAYAGE ────────────────────────────────────────── [PLAN §3]
    // « Sweep du low/high de session ou de la bougie 9h ».
    sweepMax: 24,            // [CHOIX] bougies entre le balayage et l'entrée

    // ── LA CONFIRMATION ────────────────────────────────── [PLAN §3 et §4]
    // « IFVG M1/M3 » — Yahoo ne sert pas le 3 minutes au-delà de 8 jours, on
    // prend donc 1m et 2m. « CISD dans le sens du trade ». Le plan les veut
    // TOUS LES DEUX, et propose en variante « clôture au-dessus/en-dessous
    // de la bougie M15 précédente ».
    exigeIFVG: true,
    exigeCISD: true,
    accepteM15: true,        // la variante « clôture au-delà de la M15 précédente »
    reactMax: 12,            // [CHOIX] bougies entre le balayage et la confirmation

    // ── LE STOP ────────────────────────────────────────────── [PLAN §8]
    // « SL : sous le dernier mouvement ». Lu comme : sous l'extrémité du
    // balayage — c'est le dernier mouvement avant le retournement, et c'est
    // le seul point que le plan rend identifiable. [CHOIX]
    buf: 0.02,               // tampon, en % du prix
    atrMin: 0.3,             // [CHOIX] stop minimum, en fraction d'ATR

    // ── L'OBJECTIF ─────────────────────────────────────────── [PLAN §8]
    // « haut/bas de session, PD High/Low, ou extrémité d'un CRT H1/H4 ».
    // C'est un ENDROIT, pas une distance. « PD » se lit ici Previous Day :
    // le haut et le bas de la veille. On vise le plus proche des trois qui
    // soit devant nous. [CHOIX] sur le choix du plus proche.
    objectif: 'zone',        // 'zone' | 'R'
    tpR: 2.5,                // utilisé seulement si objectif === 'R'
    rrMin: 1.0,              // [CHOIX] en dessous, le trade ne vaut pas le risque

    // ── LA SORTIE PARTIELLE ────────────────────────────────── [PLAN §8]
    // Le plan ne parle PAS de sortie partielle : il donne un objectif et un
    // passage au seuil sur structure. On garde donc part = 0 par défaut :
    // tout court jusqu'à l'objectif. C'est la lecture littérale.
    part: 0, tp1: 0.5,

    // ── LES PLAFONDS ───────────────────────────────────────── [PLAN §6-7]
    maxJour: 2               // « max 2 entrées / jour sur ce setup »
  };

  var fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false,
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit' });
  var DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  function heure(t) {
    var o = {}; fmt.formatToParts(new Date(t)).forEach(function (p) { o[p.type] = p.value; });
    var h = +o.hour; if (h === 24) h = 0;
    return { jour: o.year + '-' + o.month + '-' + o.day, dow: DOW[o.weekday], min: h * 60 + (+o.minute) };
  }

  // ── la narrative, identique à celle de l'autre modèle ────────────────────
  function prepBiais(series) {
    return series.map(function (cs) {
      var out = [];
      ST.fvgs(cs).forEach(function (z) {
        var iRes = z.casse != null ? z.casse : z.touche;
        if (iRes == null) return;
        out.push({ t: cs[iRes].t, c: (z.haussier ? 1 : -1) * (z.casse == null ? 1 : -1) });
      });
      return out.sort(function (a, b) { return a.t - b.t; });
    });
  }
  function biais(prep, t) {
    var score = 0;
    prep.forEach(function (serie) {
      var d = serie.filter(function (r) { return r.t <= t; }).slice(-CFG.fvgn);
      var s = d.reduce(function (a, r) { return a + r.c; }, 0);
      score += s > 0 ? 1 : s < 0 ? -1 : 0;
    });
    return { score: score, dir: score >= CFG.seuil ? 1 : score <= -CFG.seuil ? -1 : 0 };
  }

  /**
   * @param D  { m1, m2, m5, m15, h1, d1 }  le marché tradé
   * @param E  idem pour le marché de confirmation (ES), ou null
   */
  function evaluer(D, E) {
    if (!D || !D.m5 || D.m5.length < 80 || !D.m15 || !D.h1 || !D.d1) return null;
    var clock = D.m5;
    var m30 = ST.agreger(D.m15, 2), h4 = ST.agreger(D.h1, 4);
    var prep = prepBiais([D.d1, h4, D.h1, D.m15]);
    var prepE = (CFG.confirmeES && E && E.m5) ? prepBiais([E.d1, ST.agreger(E.h1, 4), E.h1, E.m15]) : null;

    // ── les zones intactes, sur les unités que le plan liste ──────────────
    var UNITES = [{ cs: D.m15, n: 'M15' }, { cs: m30, n: 'M30' },
                  { cs: D.h1, n: 'H1' }, { cs: h4, n: 'H4' }]
      .filter(function (u) { return CFG.unites.indexOf(u.n) >= 0; });
    var zones = [];
    UNITES.forEach(function (u) {
      ST.fvgs(u.cs).forEach(function (z) {
        zones.push({ tf: u.n, cs: u.cs, bas: z.bas, haut: z.haut, haussier: z.haussier,
                     ne: z.ne, touche: z.touche, casse: z.casse });
      });
    });

    // ── les inversions en unité fine, pour la confirmation ────────────────
    var ifvgFin = [];
    [['1m', D.m1], ['2m', D.m2]].forEach(function (p) {
      if (!p[1]) return;
      ST.fvgs(p[1]).forEach(function (z) {
        if (z.tCasse != null) ifvgFin.push({ tf: p[0], t: z.tCasse, haussier: z.haussier });
      });
    });
    ifvgFin.sort(function (a, b) { return a.t - b.t; });
    var cisdClock = ST.cisd(clock).map(function (z) {
      return { t: clock[z.ne] ? clock[z.ne].t : 0, haussier: z.haussier };
    }).filter(function (z) { return z.t > 0; });

    var atrC = ST.atr(clock, 14);
    var parJour = {}, tous = [], dernier = null, etapes = null;
    // Entonnoir : à chaque étape, combien de bougies sont écartées et pourquoi.
    // Sans ça, « trois trades en soixante jours » ne dit pas QUELLE règle filtre.
    var E0 = { barres: 0, biaisNeutre: 0, esDesaccord: 0, pasDeZone: 0, avant10h: 0,
               pasDeBalayage: 0, pasDeConfirmation: 0, stopMauvaisCote: 0,
               stopTropSerre: 0, rrInsuffisant: 0, entrees: 0 };

    for (var i = 60; i < clock.length; i++) {
      var bar = clock[i], e = heure(bar.t), px = bar.c;
      if (e.dow < 1 || e.dow > 5) continue;
      if (parJour[e.jour] === undefined) parJour[e.jour] = 0;
      // On observe dès 09h30, on n'entre qu'à partir de 10h, et plus rien
      // après 12h00 : « deadline secondaire ferme ».
      if (e.min < CFG.obs || e.min >= CFG.fin) continue;
      if (parJour[e.jour] >= CFG.maxJour) continue;

      var b = biais(prep, bar.t);
      var etape = { t: bar.t, score: b.score, dir: b.dir, zone: null, sweep: null, conf: null };
      E0.barres++;
      if (b.dir === 0) { E0.biaisNeutre++; etapes = etape; continue; }
      // « Narrative confirmée sur NQ et ES ENSEMBLE »
      if (prepE && biais(prepE, bar.t).dir !== b.dir) { E0.esDesaccord++; etape.conf = 'ES en désaccord'; etapes = etape; continue; }

      // ── LA ZONE : intacte, du bon sens, et le prix arrive dedans ────────
      var idxJ = null, zone = null;
      for (var z2 = 0; z2 < zones.length; z2++) {
        var Z = zones[z2];
        if (Z.haussier !== (b.dir > 0)) continue;
        var idx = ST.idxA(Z.cs, bar.t);
        if (Z.ne == null || Z.ne > idx || idx - Z.ne > CFG.ageMax) continue;
        if (Z.casse != null && Z.casse <= idx) continue;
        // « unmitigated » : jamais touchée AVANT la séance du jour
        if (CFG.intact && Z.touche != null && Z.cs[Z.touche] &&
            heure(Z.cs[Z.touche].t).jour !== e.jour) continue;
        // le prix est dedans ou vient de la traverser
        if (bar.l <= Z.haut && bar.h >= Z.bas) { zone = Z; break; }
      }
      etape.zone = zone;
      if (!zone) { E0.pasDeZone++; etapes = etape; continue; }
      if (e.min < CFG.deb) { E0.avant10h++; etapes = etape; continue; }   // on attend 10h

      // ── LE BALAYAGE : le plus bas/haut de séance, ou celui de la 9h ─────
      // On regarde en arrière depuis l'ouverture du jour.
      var deb = i; while (deb > 0 && heure(clock[deb - 1].t).jour === e.jour &&
                          heure(clock[deb - 1].t).min >= CFG.obs) deb--;
      var neuf = null, extSess = null;
      for (var k = deb; k < i; k++) {
        var ek = heure(clock[k].t);
        if (ek.min >= CFG.obs && ek.min < CFG.deb)
          neuf = b.dir > 0 ? Math.min(neuf == null ? Infinity : neuf, clock[k].l)
                           : Math.max(neuf == null ? -Infinity : neuf, clock[k].h);
        extSess = b.dir > 0 ? Math.min(extSess == null ? Infinity : extSess, clock[k].l)
                            : Math.max(extSess == null ? -Infinity : extSess, clock[k].h);
      }
      // balayage = une bougie récente est allée AU-DELÀ de ce repère
      var repere = neuf != null ? neuf : extSess;
      if (repere == null) { E0.pasDeBalayage++; etapes = etape; continue; }
      var sweep = null;
      for (var s2 = Math.max(deb, i - CFG.sweepMax); s2 <= i; s2++) {
        var ok = b.dir > 0 ? clock[s2].l < repere : clock[s2].h > repere;
        if (ok) { sweep = { i: s2, ext: b.dir > 0 ? clock[s2].l : clock[s2].h, t: clock[s2].t }; }
      }
      etape.sweep = sweep;
      if (!sweep) { E0.pasDeBalayage++; etapes = etape; continue; }

      // ── LA CONFIRMATION : inversion ET CISD, dans le sens du trade ──────
      var limite = bar.t - CFG.reactMax * 5 * 60000;
      var aIFVG = false, tfIFVG = null;
      for (var q = ifvgFin.length - 1; q >= 0; q--) {
        var f = ifvgFin[q];
        if (f.t > bar.t || f.t < Math.max(limite, sweep.t)) continue;
        // un FVG cassé donne l'inversion OPPOSÉE à son sens
        if ((f.haussier ? -1 : 1) === b.dir) { aIFVG = true; tfIFVG = f.tf; break; }
      }
      var aCISD = false;
      for (var q2 = cisdClock.length - 1; q2 >= 0; q2--) {
        var c2 = cisdClock[q2];
        if (c2.t > bar.t || c2.t < Math.max(limite, sweep.t)) continue;
        if (c2.haussier === (b.dir > 0)) { aCISD = true; break; }
      }
      // variante du plan : « clôture au-dessus/en-dessous de la M15 précédente »
      var aM15 = false;
      if (CFG.accepteM15) {
        var i15 = ST.idxA(D.m15, bar.t);
        var prec = D.m15[i15 - 1];
        if (prec) aM15 = b.dir > 0 ? px > prec.h : px < prec.l;
      }
      var confirme = (!CFG.exigeIFVG || aIFVG) && (!CFG.exigeCISD || aCISD);
      if (!confirme && CFG.accepteM15 && aM15) confirme = true;
      etape.conf = confirme ? 'ok' : ('ifvg ' + aIFVG + ' cisd ' + aCISD + ' m15 ' + aM15);
      if (!confirme) { E0.pasDeConfirmation++; etapes = etape; continue; }

      // ── LE STOP : sous le dernier mouvement, c'est-à-dire le balayage ───
      var L = b.dir > 0, entree = px, buf = entree * CFG.buf / 100;
      var sl = L ? sweep.ext - buf : sweep.ext + buf;
      if (L ? sl >= entree : sl <= entree) { E0.stopMauvaisCote++; etapes = etape; continue; }
      var risq = Math.abs(entree - sl);
      if (!atrC[i] || risq < atrC[i] * CFG.atrMin) { E0.stopTropSerre++; etapes = etape; continue; }

      // ── L'OBJECTIF : une ZONE, pas une distance ────────────────────────
      var tp = null;
      if (CFG.objectif === 'zone') {
        var cands = [];
        // haut / bas de la séance en cours
        var hS = -Infinity, bS = Infinity;
        for (var k2 = deb; k2 <= i; k2++) { hS = Math.max(hS, clock[k2].h); bS = Math.min(bS, clock[k2].l); }
        cands.push(L ? hS : bS);
        // haut / bas de la VEILLE — « PD » lu Previous Day
        var iD = ST.idxA(D.d1, bar.t), veille = D.d1[iD - 1];
        if (veille) cands.push(L ? veille.h : veille.l);
        // extrémité de la bougie H4 en cours — le « CRT H1/H4 » du plan
        var iH4 = ST.idxA(h4, bar.t);
        if (h4[iH4]) cands.push(L ? h4[iH4].h : h4[iH4].l);
        // le plus proche qui soit DEVANT nous
        var devant = cands.filter(function (v) { return v != null && isFinite(v) && (L ? v > entree : v < entree); });
        if (devant.length) tp = L ? Math.min.apply(null, devant) : Math.max.apply(null, devant);
      }
      if (tp == null) tp = L ? entree + risq * CFG.tpR : entree - risq * CFG.tpR;
      var rr = Math.abs(tp - entree) / risq;
      if (rr < CFG.rrMin) { E0.rrInsuffisant++; etapes = etape; continue; }

      dernier = {
        sens: L ? 'LONG' : 'SHORT', t: bar.t,
        entree: +entree.toFixed(2), sl: +sl.toFixed(2), risq: risq,
        tp1: +(L ? entree + risq * CFG.tp1 : entree - risq * CFG.tp1).toFixed(2),
        tp: +tp.toFixed(2), rr: +rr.toFixed(2),
        niveau: 'FVG ' + zone.tf, tf: tfIFVG || '5m',
        fenetre: e.min < CFG.primaire ? 'primaire' : 'étendue',
        sweepNiveau: +repere.toFixed(2), sweepExt: +sweep.ext.toFixed(2),
        biaisDir: b.dir, biaisScore: b.score,
        barre: i, derniere: i >= clock.length - 2
      };
      tous.push(dernier);
      parJour[e.jour]++; E0.entrees++;
      etapes = etape;
    }

    var e2 = heure(clock[clock.length - 1].t);
    return {
      strategie: 'kintt',
      prix: clock[clock.length - 1].c,
      derniereBougie: clock[clock.length - 1].t,
      hors: !(e2.dow >= 1 && e2.dow <= 5 && e2.min >= CFG.obs && e2.min < CFG.fin),
      etape: etapes,
      trade: dernier && dernier.derniere ? dernier : null,
      dernierSignal: dernier,
      tousSignaux: tous,
      entonnoir: E0,
      cfg: CFG
    };
  }

  var SERIES = [
    { interval: '1m',  range: '8d',  cle: 'm1'  },
    { interval: '2m',  range: '60d', cle: 'm2'  },
    { interval: '5m',  range: '60d', cle: 'm5'  },
    { interval: '15m', range: '60d', cle: 'm15' },
    { interval: '1h',  range: '6mo', cle: 'h1'  },
    { interval: '1d',  range: '1y',  cle: 'd1'  }
  ];

  root.Kintt = { evaluer: evaluer, CFG: CFG, heure: heure, SERIES: SERIES };

})(typeof window !== 'undefined' ? window : this);
