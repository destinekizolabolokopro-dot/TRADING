'use strict';
/**
 * STRUCTURE — briques de détection, version navigateur.
 *
 * Portage littéral de scripts/lib/structure.js, le module utilisé par le
 * backtest. Le site et la mesure doivent partager EXACTEMENT le même code de
 * détection : sinon les signaux affichés ne sont pas ceux qui ont été mesurés,
 * ce qui était précisément le décalage à corriger.
 */
(function (root) {
  /**
   * Briques de structure de marché. AUCUNE décision de trading ici — uniquement
   * la détection, pour qu'elle soit partagée, testable et identique d'une version
   * à l'autre du modèle.
   *
   * Marquage : [ICT] canonique · [COMM] implémentation communautaire ·
   * [HYP] hypothèse non sourcée.
   */

  // ───────────────────────────────────────────────── agrégation d'unités ─────
  /** Regroupe n bougies en une. Sert à fabriquer le 4H, absent de Yahoo. */
  /**
   * ⚠️ REGROUPEMENT ANCRÉ SUR L'HORLOGE, PAS SUR L'INDICE DU TABLEAU.
   *
   * La première version faisait `for (i = 0; i + n <= cs.length; i += n)` :
   * elle groupait les bougies par paquets de quatre À PARTIR DU DÉBUT DU
   * TABLEAU. Conséquence, mesurée : Yahoo sert une fenêtre glissante, donc le
   * tableau ne commence pas au même endroit d'un jour à l'autre — et la
   * « bougie H4 » contenant 11 h 00 changeait de bornes selon le jour où on
   * posait la question. Le même instant tombait dans des bougies différentes.
   * Deux exécutions du même modèle, sur les mêmes données, ne voyaient pas le
   * même graphique.
   *
   * On découpe donc sur la grille du temps : une bougie de 4 h commence à
   * 00 h, 04 h, 08 h… quel que soit le contenu du tableau. C'est ce que fait
   * n'importe quelle plateforme, et c'est ce qui rend le résultat reproductible.
   */
  function agreger(cs, n) {
    if (!cs || cs.length < 2) return [];
    // Le pas de la série se déduit des données : l'écart le plus fréquent
    // entre deux bougies. Le déduire évite de le passer en paramètre et de
    // le voir diverger de la réalité.
    const ecarts = {};
    for (let i = 1; i < cs.length; i++) {
      const d = cs[i].t - cs[i - 1].t;
      if (d > 0) ecarts[d] = (ecarts[d] || 0) + 1;
    }
    const pas = +Object.keys(ecarts).sort((a, b) => ecarts[b] - ecarts[a])[0];
    const bloc = pas * n;
    const out = [];
    let cle = null, cur = null;
    for (const b of cs) {
      const k = Math.floor(b.t / bloc) * bloc;
      if (k !== cle) {
        if (cur) out.push(cur);
        cle = k; cur = { t: k, o: b.o, c: b.c, h: b.h, l: b.l };
      } else {
        cur.c = b.c;
        if (b.h > cur.h) cur.h = b.h;
        if (b.l < cur.l) cur.l = b.l;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  // ───────────────────────────────────────────────────────────── FVG [ICT] ────
  /**
   * Motif à 3 bougies dont les mèches 1 et 3 ne se chevauchent pas.
   * `casse` = index de la première bougie qui CLÔTURE au-delà de la zone, du
   * côté opposé — c'est ce qui invalide le gap et, à l'inverse, ce qui crée
   * l'inversion (IFVG).
   */
  function fvgs(cs) {
    const z = [];
    for (let i = 2; i < cs.length; i++) {
      if (cs[i].l > cs[i - 2].h)
        z.push({ bas: cs[i - 2].h, haut: cs[i].l, haussier: true, ne: i, t: cs[i].t });
      else if (cs[i].h < cs[i - 2].l)
        z.push({ bas: cs[i].h, haut: cs[i - 2].l, haussier: false, ne: i, t: cs[i].t });
    }
    z.forEach(x => {
      x.casse = null; x.tCasse = null; x.touche = null; x.tTouche = null;
      for (let k = x.ne + 1; k < cs.length; k++) {
        if (x.touche == null && cs[k].l <= x.haut && cs[k].h >= x.bas) { x.touche = k; x.tTouche = cs[k].t; }
        if (x.haussier ? cs[k].c < x.bas : cs[k].c > x.haut) { x.casse = k; x.tCasse = cs[k].t; break; }
      }
    });
    return z;
  }

  /**
   * État d'un FVG à un instant donné, pour le score de biais.  [HYP] — la source
   * parle de FVG « respectés ou non », sans définir les deux mots.
   *
   *   RESPECTÉ     le prix est entré dans la zone et en est ressorti du bon côté,
   *                sans qu'une bougie clôture au-delà
   *   NON RESPECTÉ une bougie a clôturé au-delà de la zone, du côté opposé
   *   EN ATTENTE   le prix n'a pas encore interagi avec la zone
   */
  function etatFVG(z, idx) {
    if (z.ne > idx) return 'futur';
    if (z.casse != null && z.casse <= idx) return 'non-respecte';
    if (z.touche != null && z.touche <= idx) return 'respecte';
    return 'attente';
  }

  // ──────────────────────────────── hiérarchie STL / ITL / LTL — [ICT] ────────
  /**
   * Définition canonique, FRACTALE et SANS PARAMÈTRE :
   *
   *   STL  un creux encadré d'un creux PLUS HAUT de chaque côté
   *   ITL  un STL encadré d'un STL PLUS HAUT de chaque côté
   *   LTL  un ITL encadré d'un ITL PLUS HAUT de chaque côté
   *
   * Il n'y a donc ni longueur de lookback ni distance minimale à régler : toute
   * valeur de ce genre serait une invention.
   *
   * `vu` = instant où le niveau devient CONNAISSABLE, c'est-à-dire quand
   * l'élément de droite est lui-même confirmé. C'est cet horodatage qui doit
   * être utilisé par un backtest, jamais celui de l'extrême : sinon on lit
   * l'avenir.
   */
  function niveau1(cs, bas) {                       // STL / STH
    const out = [];
    for (let i = 1; i < cs.length - 1; i++) {
      const a = cs[i - 1], m = cs[i], b = cs[i + 1];
      if (bas ? (a.l > m.l && b.l > m.l) : (a.h < m.h && b.h < m.h))
        out.push({ prix: bas ? m.l : m.h, i, t: m.t, vu: b.t });
    }
    return out;
  }
  function niveauSup(pts, bas) {                    // ITL depuis STL, LTL depuis ITL
    const out = [];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], m = pts[i], b = pts[i + 1];
      if (bas ? (a.prix > m.prix && b.prix > m.prix) : (a.prix < m.prix && b.prix < m.prix))
        out.push({ prix: m.prix, i: m.i, t: m.t, vu: b.vu });   // connu quand celui de droite est confirmé
    }
    return out;
  }
  function hierarchie(cs) {
    const stl = niveau1(cs, true),  sth = niveau1(cs, false);
    const itl = niveauSup(stl, true), ith = niveauSup(sth, false);
    return { stl, sth, itl, ith, ltl: niveauSup(itl, true), lth: niveauSup(ith, false) };
  }

  // ──────────────────────────────────────────────────────── CISD — [HYP] ─────
  /**
   * Change in State of Delivery. Plusieurs variantes circulent ; celle-ci est la
   * plus répandue et la plus mécanique :
   *
   *   dernière série consécutive de bougies BAISSIÈRES qui produit un plus-bas,
   *   puis une CLÔTURE au-dessus de l'OPEN de la première bougie de la série
   *   → changement d'état haussier. Zone = [plus-bas de la série, cet open].
   *
   * UNCONFIRMED ASSUMPTION : la source cite « CISD » sans le définir.
   */
  function cisd(cs) {
    const out = [];
    for (let i = 2; i < cs.length; i++) {
      for (const haussier of [true, false]) {
        // série de bougies de sens opposé qui précède i
        let j = i - 1, ext = haussier ? Infinity : -Infinity;
        while (j >= 0 && (haussier ? cs[j].c < cs[j].o : cs[j].c > cs[j].o)) {
          ext = haussier ? Math.min(ext, cs[j].l) : Math.max(ext, cs[j].h); j--;
        }
        const deb = j + 1;
        if (deb > i - 1) continue;                       // pas de série
        const ouv = cs[deb].o;
        if (haussier ? cs[i].c > ouv : cs[i].c < ouv) {
          out.push({ bas: haussier ? ext : ouv, haut: haussier ? ouv : ext,
            haussier, ne: i, t: cs[i].t, type: 'CISD' });
        }
      }
    }
    return out;
  }

  // ──────────────────────────────────────────── Rejection Block — [HYP] ──────
  /**
   * La MÈCHE — et non le corps — de la bougie qui marque un extrême rejeté.
   * Zone = [extrémité du corps, extrémité de la mèche].
   *
   * UNCONFIRMED ASSUMPTION : la source cite « Rejection Block » sans le définir.
   * Le seuil « la mèche fait au moins la moitié du range » est de nous.
   */
  function rejectionBlocks(cs, ratio) {
    const r = ratio == null ? 0.5 : ratio, out = [];
    for (let i = 1; i < cs.length - 1; i++) {
      const c = cs[i], rng = c.h - c.l; if (rng <= 0) continue;
      const corpsH = Math.max(c.o, c.c), corpsB = Math.min(c.o, c.c);
      // mèche basse longue + creux local → bloc haussier
      if ((corpsB - c.l) / rng >= r && cs[i - 1].l > c.l && cs[i + 1].l > c.l)
        out.push({ bas: c.l, haut: corpsB, haussier: true, ne: i, t: c.t, type: 'RB' });
      if ((c.h - corpsH) / rng >= r && cs[i - 1].h < c.h && cs[i + 1].h < c.h)
        out.push({ bas: corpsH, haut: c.h, haussier: false, ne: i, t: c.t, type: 'RB' });
    }
    return out;
  }

  // ───────────────────────────────────────────────────────────────── ATR ─────
  function atr(cs, n) {
    const p = n || 14, a = new Array(cs.length).fill(null);
    const tr = new Array(cs.length).fill(0);
    for (let i = 1; i < cs.length; i++)
      tr[i] = Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - cs[i - 1].c), Math.abs(cs[i].l - cs[i - 1].c));
    let s = 0;
    for (let i = 1; i < cs.length; i++) {
      s += tr[i];
      if (i > p) s -= tr[i - p];
      if (i >= p) a[i] = s / p;
    }
    return a;
  }

  /** Index de la dernière bougie dont l'horodatage est ≤ t (anti-anticipation). */
  /**
   * ⚠️ LA BOUGIE EN COURS N'EST PAS UNE BOUGIE.
   *
   * `idxA` rend la bougie QUI CONTIENT l'instant t. Sur une unité supérieure,
   * cette bougie n'est pas finie : son plus haut, son plus bas et sa clôture
   * ne seront connus que dans une à quatre heures. La lire, c'est lire
   * l'avenir. Mesuré sur une bougie H4 réelle :
   *
   *     ouverture 01 h 00 · plus haut 31058, atteint dans la 1re heure
   *     le code interrogeait ce plus haut dès 01 h 10 — il ne serait
   *     définitif qu'à 05 h 00.
   *
   * `idxClos` rend la dernière bougie TERMINÉE : celle dont la suivante a
   * déjà ouvert. C'est la seule qu'un humain devant son écran connaisse.
   */
  // Le pas d'une série, déduit de ses données et retenu : la fonction est
  // appelée des dizaines de milliers de fois dans une boucle.
  var _pas = typeof WeakMap === 'function' ? new WeakMap() : null;
  function pasDe(serie) {
    if (_pas && _pas.has(serie)) return _pas.get(serie);
    var e = {}, i;
    for (i = 1; i < serie.length; i++) {
      var d = serie[i].t - serie[i - 1].t;
      if (d > 0) e[d] = (e[d] || 0) + 1;
    }
    var k = Object.keys(e), best = 0, n = -1;
    for (i = 0; i < k.length; i++) if (e[k[i]] > n) { n = e[k[i]]; best = +k[i]; }
    if (_pas) _pas.set(serie, best);
    return best;
  }

  function idxClos(serie, t) {
    // ⚠️ UNE BOUGIE EST CLOSE QUAND SA DURÉE EST ÉCOULÉE, pas quand la
    // suivante est livrée. La première version attendait l'arrivée de la
    // bougie suivante : au bord de la série, elle reculait donc d'un cran
    // sans raison, et la stratégie rendait un résultat différent selon qu'on
    // lui donnait ou non des bougies POSTÉRIEURES à sa décision. C'est
    // exactement ce que la vérification « sans l'avenir » a attrapé.
    var pas = pasDe(serie);
    var i = idxA(serie, t);
    if (!pas) return i;
    while (i >= 0 && serie[i].t + pas > t) i--;
    return i;
  }

  function idxA(serie, t) {
    let lo = 0, hi = serie.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (serie[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; }
    return r;
  }
  root.ST = { agreger: agreger, fvgs: fvgs, etatFVG: etatFVG, hierarchie: hierarchie,
    niveau1: niveau1, niveauSup: niveauSup, cisd: cisd, rejectionBlocks: rejectionBlocks,
    atr: atr, idxA: idxA, idxClos: idxClos, pasDe: pasDe };
})(typeof window !== 'undefined' ? window : this);
