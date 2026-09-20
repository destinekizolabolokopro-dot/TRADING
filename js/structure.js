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
  function agreger(cs, n) {
    const out = [];
    for (let i = 0; i + n <= cs.length; i += n) {
      const p = cs.slice(i, i + n);
      out.push({ t: p[0].t, o: p[0].o, c: p[n - 1].c,
        h: Math.max(...p.map(x => x.h)), l: Math.min(...p.map(x => x.l)) });
    }
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
  function idxA(serie, t) {
    let lo = 0, hi = serie.length - 1, r = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (serie[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; }
    return r;
  }
  root.ST = { agreger: agreger, fvgs: fvgs, etatFVG: etatFVG, hierarchie: hierarchie,
    niveau1: niveau1, niveauSup: niveauSup, cisd: cisd, rejectionBlocks: rejectionBlocks,
    atr: atr, idxA: idxA };
})(typeof window !== 'undefined' ? window : this);
