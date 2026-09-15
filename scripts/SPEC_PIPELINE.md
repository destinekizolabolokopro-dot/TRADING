# Reconstruction autour du pipeline de référence — cahier des charges

Rédigé avant toute modification. Répond aux cinq points exigés.

Marquage des sources, identique au document `SPEC_ITL.md` :
**[ICT]** canonique · **[COMM]** implémentation communautaire du modèle
(indicateur public « EZ$ PB Blake v1.0 », résumés de vidéos) · **[SCHÉMA]**
lisible sur les planches · **[HYP]** notre hypothèse, non sourcée.

---

## 1. Définition exacte du nouveau pipeline

```
 ┌─ 1. HTF BIAS ────────── score de respect des FVG en 1D / 4H / 1H / 15M   [COMM]
 │       ↓ bullish | bearish | neutral (neutral ⇒ pas de trade)
 ├─ 2. DOL ─────────────── swing 1H du côté du biais                        [COMM]
 │       ↓ BSL si haussier, SSL si baissier ; non encore atteint
 ├─ 3. KEY LEVEL ───────── 4 familles × 6 unités (3M→4H)                    [COMM]
 │       FVG · ITL/ITH · CISD · Rejection Block
 │       ↓ niveau valide, non invalidé, du bon côté
 ├─ 4. TOUCH ──────────── le prix atteint le niveau ; jambe de manipulation
 │       ↓                 (+ sweep ITL/ITH, phase 4)                        [SCHÉMA]
 ├─ 5. DISPLACEMENT ────── mesure de l'expansion hors du niveau             [ICT/HYP]
 ├─ 6. IFVG ───────────── recherche 1M→5M DANS la jambe,
 │       ↓                 on retient la PLUS HAUTE unité valide             [COMM]
 ├─ 7. CONFIRMED BODY CLOSE ─ clôture du CORPS au travers de l'IFVG          [COMM]
 │       ↓                 le simple contact ne déclenche rien
 └─ 8. ENTRY ──────────── close | CE | zone (3 modes comparés)              [HYP]
         stop : IFVG | swing de manipulation | extrême du sweep             [HYP/COMM]
         cible : 1R partiel + runner                                        [COMM]
```

**Neutral n'est pas un biais.** Si le score ne tranche pas, la séance est sans
trade. C'est une différence de nature avec le code actuel, qui trouve toujours
une direction.

---

## 2. Différences entre BASELINE_V0 et le modèle de référence

| étape | BASELINE_V0 (le code actuel) | référence | écart |
|---|---|---|---|
| **Biais** | cassure de structure M15 | score de respect des FVG 1D/4H/1H/15M | **méthode entièrement différente**, pas une approximation |
| **Neutre** | n'existe pas — une direction est toujours choisie | possible, et bloquant | **manquant** |
| **DOL** | haut/bas de la veille | swing 1H du côté du biais | source différente |
| **Key Level — types** | FVG uniquement | FVG + ITL/ITH + CISD + Rejection Block | **3 familles sur 4 absentes** |
| **Key Level — unités** | M5, M15 | 3M, 5M, 15M, 30M, 1H, 4H | 4 unités sur 6 absentes |
| **Sélection du niveau** | le plus proche du prix | non spécifié par la source | hypothèse des deux côtés |
| **Sweep ITL/ITH** | absent | présent sur les planches | **absent** |
| **Displacement** | paramètre présent mais sans effet réel | requis | **non fonctionnel** |
| **IFVG — unités** | 5m, 2m, 1m | 1M à 5M | 3m et 4m absents |
| **IFVG — sélection** | plus haute unité disponible ✔ | plus haute unité valide ✔ | conforme |
| **Confirmation** | clôture de corps ✔ | clôture de corps ✔ | conforme |
| **Entrée** | clôture, en dur | non spécifiée | à comparer |
| **Stop** | bord de zone, en dur | « manipulation swing » | probablement faux |
| **Cible** | swing structurel, 5–6 R | 1R partiel + runner | **probablement faux** |
| **SMT** | absent ici | mentionné | absent |
| **Coûts** | non appliqués | — | **absents** |
| **PF / max DD** | non calculés | — | **absents** |

Sur 16 lignes, **2 seulement sont conformes**. Ce n'est pas un réglage à
ajuster, c'est bien une reconstruction.

---

## 3. Règles que je peux confirmer

**[ICT] — canoniques, mécaniques, sans paramètre libre**
- hiérarchie STL / ITL / LTL (et miroir STH / ITH / LTH), fractale ;
- un ITL est confirmé quand le STL suivant se révèle plus haut — confirmation
  événementielle, pas comptable ;
- FVG : motif à 3 bougies dont les mèches 1 et 3 ne se chevauchent pas ;
- déplacement ⇔ le mouvement laisse un FVG derrière lui ;
- mèche au-delà d'un niveau = liquidité prise ; clôture au-delà = cassure de
  structure, pas un balayage.

**[COMM] — l'implémentation publique, cohérente sur ces points**
- l'architecture en 5 étapes dans cet ordre ;
- les 4 familles de niveaux clés et les 6 unités 3M→4H ;
- recherche de l'IFVG de 1M à 5M **dans la jambe de manipulation** ;
- sélection de la **plus haute unité valide** ;
- déclenchement sur **clôture du corps** au travers de l'IFVG, jamais sur contact ;
- le « manipulation swing » sert de référence au stop ;
- objectif court : 1R puis runner — confirmé indépendamment par la capture de
  résultats (RR moyen 1,19 alors que le « ideal RR » est 8,07).

**[SCHÉMA] — lisible sur les planches**
- ITL Sweep précède le PD Array et se situe au même endroit ;
- le sweep est du côté opposé à la position ;
- second retour sur la zone, le « x » ;
- DOL tracé comme une horizontale au-dessus, cible finale.

---

## 4. Règles qui ne sont que des hypothèses

**Signalées UNCONFIRMED ASSUMPTION dans le code, et configurables.**

| # | hypothèse | pourquoi |
|---|---|---|
| H1 | le barème exact du score de biais (poids par unité, seuil) | la source donne le principe, pas les nombres |
| H2 | ce que « FVG respecté / non respecté » veut dire précisément | jamais défini ; notre définition ci-dessous |
| H3 | comment identifier un swing 1H pour le DOL | non spécifié |
| H4 | que faire quand plusieurs swings conviennent | non spécifié |
| H5 | quand un DOL devient invalide | non spécifié |
| H6 | définition opératoire de CISD | plusieurs variantes circulent |
| H7 | définition opératoire du Rejection Block | idem |
| H8 | comment choisir entre plusieurs niveaux clés valides | non spécifié |
| H9 | profondeur minimale d'un sweep | non spécifié |
| H10 | délai max entre sweep et niveau clé | non spécifié |
| H11 | tous les seuils de déplacement sauf « laisse un FVG » | non spécifié |
| H12 | le niveau d'entrée exact | non spécifié |
| H13 | l'emplacement exact du stop | « manipulation swing » est vague |
| H14 | la fenêtre horaire | planches 10h00/10:15 vs indicateur 09h30–11h00 |
| H15 | la mécanisation chiffrée de HRL/LRL | voir la note ci-dessous |

### Note sur HRL / LRL — nos deux sources se contredisent

Tu décris HRL comme « liquidité déjà prise » et LRL comme « non encore prise ».
Les sources ICT que j'ai consultées disent autre chose : **HRL = liquidité
défendue par de nombreux swings, difficile à atteindre ; LRL = liquidité peu
défendue, atteinte rapidement**. Ce n'est pas la même chose du tout.

Je ne tranche pas. Le désaccord entre deux lectures publiques est en soi une
raison de laisser le module **EXPERIMENTAL et désactivé**, comme tu l'as
demandé. Si tu as la source primaire, elle règle la question.

### Définitions de travail retenues pour H2, H6, H7

Marquées **[HYP]**, choisies pour être mécaniques et testables, pas parce
qu'elles seraient justes.

```
FVG RESPECTÉ    (haussier) le prix entre dans la zone et en ressort par le
                haut sans qu'une bougie CLÔTURE sous le bas de la zone
FVG NON RESPECTÉ  une bougie clôture au-delà de la zone, du côté opposé
BULLISH   score > +seuil        BEARISH  score < −seuil
NEUTRAL   |score| ≤ seuil  ⇒  aucune position ce jour-là

CISD      Change in State of Delivery : la clôture au-delà de l'open de la
          dernière série de bougies de sens opposé qui a produit le dernier
          extrême. Zone = [open de cette série, extrême].
REJECTION BLOCK  la MÈCHE (et non le corps) de la bougie qui marque un
          extrême balayé. Zone = [corps, extrémité de la mèche].
```

---

## 5. Fichiers modifiés ou créés

| fichier | statut |
|---|---|
| `scripts/baseline_v0.js` | **CRÉÉ — gelé.** Copie conforme du moteur actuel. Ne sera plus jamais modifié. |
| `scripts/backtest_pb.js` | inchangé par la suite ; sert de source à la copie gelée |
| `scripts/lib/metriques.js` | **CRÉÉ.** Métriques communes : WR, avg R, espérance, profit factor, max drawdown, P&L, long/short, par séance, IC 95 %. Modèle de coûts commission + slippage. |
| `scripts/rapport.js` | **CRÉÉ.** Consomme le journal d'une version et imprime le rapport complet. Externe au moteur, donc applicable à une version gelée. |
| `scripts/mech.js` | **CRÉÉ.** Le nouveau pipeline, construit phase par phase (V1, V2, …). Porte l'entonnoir de rejets. |
| `scripts/lib/structure.js` | **CRÉÉ.** STL/ITL/LTL, STH/ITH/LTH, FVG, CISD, Rejection Block, swings 1H — la brique commune, sans décision de trading. |
| `scripts/SPEC_PIPELINE.md` | ce document |
| `scripts/RESULTATS.md` | **CRÉÉ.** Le tableau de suivi des versions, complété à chaque étape. |

**Note sur le gel.** Le moteur actuel n'exporte pas assez d'informations pour
calculer P&L, long/short et max drawdown. J'ajoute donc les champs manquants au
journal **avant** de geler — aucune ligne de décision n'est touchée, et je
vérifie que les trades produits sont identiques, trade par trade, avant et
après. C'est cette version enrichie qui devient BASELINE_V0.

## Contrainte de données, à dire tout de suite

Tu demandes NQ seul, sans mélanger les marchés — c'est méthodologiquement
juste et je m'y tiens. Conséquence directe : Yahoo plafonne à 60 jours en 5
minutes, ce qui donne **un très petit nombre de trades sur NQ seul**. Les
métriques de la Phase 0 seront calculées et reproductibles, mais leur
intervalle de confiance sera large au point de ne rien départager.

Je ne fixe donc aucun seuil de trades comme « vérité ». Je reporterai à chaque
version la **largeur de l'intervalle de confiance**, qui dit directement ce que
l'échantillon permet ou non d'affirmer. Un fichier NQ 1 minute déposé dans le
dépôt est lu automatiquement dès qu'il est là.
