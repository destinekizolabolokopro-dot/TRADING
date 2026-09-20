# Cahier des charges — ITL Sweep, déplacement, entrée, stop

Document de référence rédigé AVANT toute modification du code, à la demande
explicite de l'utilisateur. Rien ici n'est encore implémenté.

## Convention de marquage des sources

Chaque règle porte son origine. C'est la seule protection contre le fait de
transformer une interprétation visuelle en règle prétendument officielle.

| marque | signification |
|---|---|
| **[ICT]** | concept canonique d'Inner Circle Trader, défini publiquement et de façon mécanique. Blake en hérite, il ne les a pas inventés. |
| **[SCHÉMA]** | lisible littéralement sur les planches du Mech Model transmises par l'utilisateur (repostées par kintt.fx, créditées @pbblake). |
| **[SECOND]** | résumé de seconde main d'une vidéo ou d'un indicateur publié par un tiers se réclamant du modèle. Crédible, non verbatim. |
| **[HYPOTHÈSE]** | **invention de ma part.** Aucune source ne le dit. À tester, jamais à présenter comme une règle de Blake. |

---

## 1. Définition exacte de l'ITL Sweep

### 1.1 Identifier un ITL — **[ICT]**, entièrement mécanique

La hiérarchie ICT est fractale et ne contient **aucun paramètre libre** :

```
STL (Short Term Low)        un creux de bougie encadré d'un creux PLUS HAUT de chaque côté
ITL (Intermediate Term Low) un STL encadré d'un STL PLUS HAUT de chaque côté
LTL (Long Term Low)         un ITL encadré d'un ITL PLUS HAUT de chaque côté
```

Conséquence importante : **il n'y a ni « nombre de bougies de lookback », ni
« distance minimale entre les creux » à choisir.** Les deux questions posées
n'ont pas de réponse paramétrique — la structure se définit elle-même. Toute
valeur que j'aurais introduite ici (`pivotLen = 5`, « au moins 20 points entre
les creux ») aurait été une invention. Il n'y en a pas.

### 1.2 Combien de bougies pour confirmer — **[ICT]**, mais pas un nombre fixe

La confirmation est **événementielle, pas comptable** :

- un STL est confirmé **1 bougie après** son creux (il faut la bougie de droite) ;
- un ITL est confirmé **quand le STL suivant se forme et se révèle plus haut**.
  Ce délai est variable : typiquement 3 à 10 bougies, parfois davantage.

Pour le backtest, cela impose une règle anti-anticipation stricte : un ITL
n'existe qu'à l'instant où le STL de droite est lui-même confirmé. C'est cet
horodatage-là qui doit être utilisé, jamais celui du creux.

### 1.3 Ce qui constitue un vrai sweep — **[ICT]** pour le principe

```
mèche sous le niveau de l'ITL     →  la liquidité est prise
ET clôture qui revient au-dessus  →  c'est un SWEEP (balayage)

clôture SOUS le niveau            →  ce n'est PAS un sweep, c'est une cassure
                                      de structure : le contexte haussier tombe
```

La distinction mèche / clôture est bien documentée chez ICT : la mèche suffit à
déclencher les stops, la clôture au-delà signe au contraire l'acceptation du
prix plus bas.

**[HYPOTHÈSE]** — Le délai autorisé pour que la clôture revienne au-dessus
n'est documenté nulle part. Je propose de le tester comme paramètre
`--sweepret` (1, 2, 3 bougies), valeur par défaut 1, c'est-à-dire la bougie du
balayage elle-même.

### 1.4 Délai entre le sweep et le PD Array — **[SCHÉMA]**

Sur les planches, la ligne « ITL Sweep » et le rectangle « Bullish PD Array »
sont **au même endroit** : le niveau balayé est le bord supérieur de la zone.
Ce ne sont pas deux événements séparés dans le temps, c'est un seul endroit.

Règle qui en découle : **la zone PD doit contenir le niveau de l'ITL balayé, ou
en être immédiatement adjacente.** Pas de délai à paramétrer.

**[HYPOTHÈSE]** — la tolérance « immédiatement adjacente » : je propose zéro,
donc chevauchement strict exigé, et un paramètre `--tolsweep` pour mesurer si
l'assouplir aide.

### 1.5 Le sweep doit-il être du côté opposé à la position — **[SCHÉMA]**, oui

Les planches sont sans ambiguïté : `ITL Sweep` (vers le bas) → `Bullish PD
Array` → départ vers le haut. On balaye **en dessous** pour partir **en haut**.
Miroir exact pour le short.

### 1.6 Combien de temps le sweep reste valide — **[HYPOTHÈSE] intégrale**

Aucune source ne le dit. Trois conditions d'expiration proposées, toutes
testables :

1. le prix clôture sous l'extrémité du balayage → annulé (structure cassée) ;
2. la fenêtre horaire de la séance se referme → annulé ;
3. un plafond en bougies, `--sweepage`, à balayer de 10 à 60.

---

## 2. Séquence complète — LONG

```
1. biais haute unité haussier                                    [SECOND]
2. DOL identifié au-dessus (BSL)                                 [SCHÉMA]
3. un ITL est identifié sur l'unité de structure                 [ICT]
4. le prix mèche sous l'ITL et clôture au-dessus  → SWEEP        [ICT]
5. ce balayage a lieu DANS un PD Array haussier (FVG 5M ou 15M)  [SCHÉMA]
6. déplacement vers le haut hors de la zone, laissant un FVG     [ICT]
7. le prix REVIENT toucher la zone — le « x » des planches       [SCHÉMA]
8. dans cette jambe, un IFVG se forme ; on prend la plus haute
   unité disponible de 5m vers 1m ; validé par CLÔTURE DE CORPS  [SECOND]
9. entrée                                                        → §4
10. stop                                                         → §5
11. objectif : 1 R partiel puis runner                           [SECOND]
```

## 3. Séquence complète — SHORT

Miroir strict. `ITL → ITH`, `STL → STH`, `plus haut → plus bas`, `dessous →
dessus`, `BSL → SSL`, `PD Array haussier → baissier`. Aucune asymétrie n'est
documentée, et je n'en introduis pas.

```
1. biais haute unité baissier
2. DOL identifié en dessous (SSL)
3. un ITH est identifié
4. le prix mèche au-dessus de l'ITH et clôture en dessous  → SWEEP
5. le balayage a lieu DANS un PD Array baissier
6. déplacement vers le bas, laissant un FVG
7. retour toucher la zone — le « x »
8. IFVG dans la jambe, plus haute unité 5m → 1m, clôture de corps
9-11. identique
```

---

## 4. Définition du déplacement — versions à comparer

Aucun seuil chiffré n'est documenté par Blake. **Une seule définition est
canonique et sans paramètre** :

| | définition | source |
|---|---|---|
| **F** | le mouvement **laisse un FVG** derrière lui. Sans gap, pas de déplacement. | **[ICT]** — c'est LE critère différenciant |
| A | corps de la bougie > X × la moyenne des N bougies précédentes | [SECOND] « nettement plus grande que les 3 à 5 précédentes » |
| B | corps / range total > X (bougie pleine, peu de mèche) | [HYPOTHÈSE] |
| C | range > X × ATR | [HYPOTHÈSE] |
| D | clôture au-delà d'un niveau structurel (le STH précédent) | [HYPOTHÈSE] |
| E | combinaison | [HYPOTHÈSE] |

**F est à tester en premier** : c'est la seule qui ne demande aucun réglage,
donc la seule qui ne peut pas être sur-ajustée.

---

## 5. Entrée dans l'IFVG — variantes à comparer

| | niveau d'entrée | source |
|---|---|---|
| A | clôture de la bougie de confirmation (ordre au marché) | [SECOND] l'indicateur public signale à la clôture de corps |
| B | CE — 50 % de la zone (ordre limite) | [HYPOTHÈSE] pour le niveau exact, **mais** [SECOND] dit « utiliser des ordres limites plutôt qu'au marché quand la bougie clôture loin, pour un meilleur RR » — ce qui appuie une entrée limite sans préciser où |
| C | bord de la zone (ordre limite le plus éloigné) | [HYPOTHÈSE] |
| D | autre | non documenté → non testé |

Métriques exigées pour chaque variante : trades, win rate, avg R, espérance,
profit factor, max drawdown.

---

## 6. Stop loss — variantes à comparer

| | emplacement | source |
|---|---|---|
| A | bord de l'IFVG | [HYPOTHÈSE] — c'est ce que fait mon code actuel |
| B | **extrémité de la jambe de manipulation** | **[SECOND]** — l'indicateur public affiche explicitement « the manipulation swing as a visual stop reference ». C'est la mieux appuyée. |
| C | sous le creux balayé (l'extrémité du sweep) | [SECOND] « below the recent swing low that initiated the breakout » |
| D | range complet de la bougie d'order block | [SECOND] |

Même jeu de métriques.

---

## 7. Objectif — ce que disent les sources

Deux sources indépendantes concordent, ce qui est rare ici :

- **[SECOND]** : « prendre les profits au niveau 1R », « ratio 1:1 », puis
  laisser un runner ;
- **[SCHÉMA — capture de résultats]** : RR moyen **1,19**, RR max **2,44**, et
  surtout un « Ideal Average RR » de **8,07**. Autrement dit ils sortent
  volontairement très tôt d'un mouvement qui va huit fois plus loin.

Les deux disent la même chose : **objectif fixe court, pas d'objectif
structurel.** Mon code visait un swing à 5 ou 6 R. C'était faux.

---

## 8. HRL / LRL — définition trouvée

**Définition [ICT] :**
- **LRL** — liquidité peu défendue, que le prix atteint vite, avec peu de
  swings intermédiaires sur le chemin. Le mouvement qui la prend laisse
  presque toujours un FVG. C'est la **cible privilégiée**.
- **HRL** — un ancien haut ou bas défendu par de multiples swings courts, lent
  et difficile à atteindre, demandant souvent un catalyseur (NFP, FOMC, CPI).
  Cible d'exception, pas de routine.

**Mécanisation [HYPOTHÈSE] :** compter les STH/STL intermédiaires entre le prix
et le niveau visé. Peu = LRL, beaucoup = HRL. Le seuil n'est pas documenté.

**Statut retenu : NON IMPLÉMENTÉ POUR L'INSTANT.** La définition est désormais
suffisante en principe, mais sa traduction en nombre est une invention, et rien
n'indique que Blake s'en serve dans ce modèle. À traiter en dernier, après tout
le reste, et seulement si le A/B le justifie.

---

## 9. Ce qui est confirmé

- la hiérarchie STL / ITL / LTL et son caractère fractal sans paramètre ;
- mèche = prise de liquidité, clôture au-delà = cassure de structure ;
- déplacement ⇔ laisse un FVG ;
- le sweep est du côté opposé au trade ;
- le sweep et le PD Array sont au même endroit ;
- le retour sur la zone (le « x ») ;
- IFVG validé par clôture de corps, plus haute unité de 5m vers 1m ;
- objectif court, 1R partiel puis runner ;
- le stop se réfère à la jambe de manipulation ;
- HRL/LRL : définition qualitative claire.

## 10. Ce qui reste hypothèse

- le délai de retour de clôture après la mèche (`--sweepret`) ;
- la tolérance de chevauchement sweep / PD Array (`--tolsweep`) ;
- la durée de validité du sweep (`--sweepage`) ;
- **tous les seuils chiffrés du déplacement** (A à E ; seul F en est exempt) ;
- le niveau exact d'entrée dans l'IFVG (A, B ou C) ;
- l'emplacement exact du stop (A à D) ;
- la mécanisation chiffrée de HRL/LRL ;
- la fenêtre horaire (les planches montrent 10h00 et 10:15, l'indicateur public
  dit 09h30–11h00 ; aucun des deux n'est une règle énoncée).

---

## Protocole A/B

Une variable à la fois, dans cet ordre, la version précédente restant la
référence. La version actuelle est conservée intacte comme **BASELINE**.

```
BASELINE                          →  0. référence, ne bouge plus
BASELINE + ITL Sweep              →  1.
        + déplacement F, puis A–E →  2.
        comparaison des entrées   →  3.
        comparaison des stops     →  4.
        HRL/LRL                   →  5. seulement si justifié
```

Tableau de suivi à remplir à chaque étape :

| Version | Filtre | Entrée | SL | Trades | Win Rate | Avg R | Espérance | PF | Max DD |
|---|---|---|---|---|---|---|---|---|---|

**Découpage des données :** période de développement et période de validation
séparées. Les règles ne sont jamais ajustées d'après la période de validation.
Chaque version est conservée.

**Rappel contre le sur-ajustement :** le but est de reproduire fidèlement le
modèle, pas de fabriquer les paramètres qui donnent le plus beau backtest.
Une variante retenue seulement parce qu'elle gagne historiquement doit être
signalée comme telle.
