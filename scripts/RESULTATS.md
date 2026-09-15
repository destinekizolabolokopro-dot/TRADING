# Tableau de suivi des versions

**NQ=F uniquement**, aucun autre marché mélangé · Yahoo Finance · horloge 2 min ·
période 60 jours glissants (limite de Yahoo en intraday) · commission 4,00 $
aller-retour · slippage 0,25 point par côté · valeur du point 20 $ · risque
500 $ par trade. Toutes les valeurs sont **nettes de frais**.

Reproduire une ligne :
```
node scripts/rapport.js --moteur <moteur> --sym NQ=F --range 60d [--v N]
```

| Version | Modification | Trades | WR | WR hors BE | Avg R visé | Espérance | PF | Max DD |
|---|---|---|---|---|---|---|---|---|
| **V0** | BASELINE — gelée | 21 | 52,4 % | 28,6 % | 7,32 | −0,164 R | 0,66 | 5,85 R |
| **V1** | vrai biais HTF par respect des FVG 1D/4H/1H/15M | 22 | 54,5 % | 33,3 % | 8,66 | +0,009 R | 1,02 | 4,41 R |
| **V2** | DOL par swing 1H — ❌ **rejetée** | 32 | 37,5 % | **0,0 %** | 207,55 | **−0,444 R** | 0,31 | 14,95 R |

### Lecture

V1 fait passer l'espérance de négative à nulle et le profit factor de 0,66 à
1,02. Le drawdown maximal baisse de 5,85 à 4,41 R.

**Ce n'est pas une preuve.** L'intervalle de confiance de V1 va de −0,50 à
+0,52 R : il contient largement le zéro, et il contient aussi la valeur de V0.
Sur 22 trades, on ne peut pas distinguer les deux versions. Ce qu'on peut dire,
c'est que rien n'indique une dégradation, et que le nouveau biais est plus
fidèle au modèle de référence — ce qui est le critère retenu, la fidélité avant
la performance.

### Entonnoir V1 — où disparaissent les setups

```
917  bougies examinées dans la fenêtre
653  biais tranché              264 rejetées car NEUTRE  (29 %)
283  DOL non encore atteint     370 rejetées car draw déjà atteint
 31  niveau clé retenu          ← l'étranglement principal
 23  niveau touché
 29  IFVG confirmé
 22  entrées
```

**L'étranglement est au niveau clé** : 31 seulement, parce que le moteur ne
cherche encore que des FVG sur M5 et M15. Le modèle de référence cherche
quatre familles (FVG, ITL/ITH, CISD, Rejection Block) sur six unités de 3M à
4H. C'est l'objet de la phase 3, et c'est de loin le plus gros levier restant.

*Réserve de lecture :* les trois premières lignes comptent des **bougies**, les
suivantes des **événements**. Elles ne s'enchaînent donc pas arithmétiquement.
L'entonnoir sera repris en comptage d'événements homogène en phase 3.

### V2 — rejetée, et ce qu'elle apprend

V2 remplace le haut/bas de la veille par un swing 1H, comme le dit la source.
Le résultat est mauvais **et significatif** : IC 95 % = [−0,765 ; −0,124],
t = −2,72. Le zéro est exclu du mauvais côté. Ce n'est pas du bruit.

Le journal des décisions (`--logdol 1`) donne le mécanisme immédiatement :

```
prix 29 677 · BSL · DOL retenu 30 975  (swing 1H du 16 juin)
prix 29 807 · SSL · DOL retenu 22 961  (swing 1H du 31 mars)
```

Des niveaux à 1 300 et 6 800 points. Et la conséquence se lit dans une seule
ligne du rapport :

```
Win rate hors BE .... 0,0 %   (0 gain / 20 pertes / 11 seuils)
RR moyen visé ....... 207,55
```

**Zéro trade n'atteint jamais son objectif**, sur 32. Aucun. Parce que
l'objectif est à 207 fois le risque.

### La vraie leçon : le DOL n'est pas un objectif

Mon code confondait deux choses que les sources séparent :

- le **draw on liquidity** dit *dans quel sens* le marché veut aller — c'est un
  contexte directionnel ;
- l'**objectif** est court : 1 R partiel puis runner.

Tant que le DOL sert de cible de repli, plus il est « correct » au sens de la
source, plus il est loin, et plus le modèle casse. V2 n'a pas échoué parce que
le swing 1H serait un mauvais DOL — elle a échoué parce que mon moteur s'en
sert comme cible.

**Décision, conforme au protocole :** je ne corrige pas l'objectif maintenant,
ce serait changer deux variables à la fois. V2 est marquée rejetée, **V1 reste
la référence pour V3**, et la règle d'objectif devient une phase à part entière
à traiter après les niveaux clés. Le sélecteur de DOL reste dans le code,
inactif, prêt à être réévalué une fois l'objectif corrigé.

*Note :* les quatre règles de sélection (`proche`, `loin`, `ancien`, `cluster`)
et les quatre limites d'âge testées donnent toutes le même résultat à 0,07 R
près. Le choix de la règle est donc, à ce stade, sans effet mesurable — ce qui
confirme que le problème n'est pas là.

### Test hors période — deux blocs de 30 jours

Yahoo plafonne l'intraday à 60 jours, période explicite ou non : il n'existe
aucune « autre date » accessible sans fichier local. Le 2 minutes ne remonte
qu'au 7 août — donc **toutes les mesures précédentes partent de là**. Le 5
minutes remonte au 7 juillet, ce qui libère un bloc de 30 jours jamais
examiné.

Horloge 5 min, NQ seul, nets de frais :

| | période | Trades | WR | WR hors BE | Espérance | PF | Max DD |
|---|---|---|---|---|---|---|---|
| **V0** | 07/07 → 06/08 · *jamais vu* | 12 | **33,3 %** | 20,0 % | **+0,780 R** | 2,16 | 4,05 R |
| **V0** | 16/08 → 15/09 | 18 | **44,4 %** | 9,1 % | **−0,257 R** | 0,55 | 5,29 R |
| **V1** | 07/07 → 06/08 · *jamais vu* | 12 | **41,7 %** | 22,2 % | **+0,720 R** | 2,22 | 3,59 R |
| **V1** | 16/08 → 15/09 | 17 | **29,4 %** | 7,7 % | **−0,441 R** | 0,39 | 7,63 R |
| V1 | tout le 5 min disponible | 34 | 35,3 % | 15,4 % | −0,030 R | 0,95 | 13,38 R |

**Le signe s'inverse entre deux mois qui se suivent.** Gagnant sur juillet,
perdant sur septembre, pour les deux versions. Rien n'est établi.

Et la ligne la plus instructive du tableau : sur V0, la période au **plus fort
taux de réussite** (44,4 %) est celle qui **perd de l'argent**, tandis que la
période à 33,3 % gagne +0,78 R par trade. La démonstration est faite une
deuxième fois, sur données indépendantes : **le taux de réussite ne dit rien de
la rentabilité.**

Note d'instabilité supplémentaire : passer l'horloge de 2 à 5 minutes fait
chuter le taux de réussite de ~54 % à ~35 % sur des périodes qui se recouvrent.
Le modèle est très sensible à l'unité d'exécution, ce qui est un signe de
fragilité de plus.

### Réserve permanente sur la taille d'échantillon

Aucun seuil de trades n'est posé comme vérité. Ce qui est reporté à chaque
version est la **largeur de l'intervalle de confiance**, qui dit directement ce
que l'échantillon autorise à affirmer :

| Version | IC 95 % de l'espérance | largeur |
|---|---|---|
| V0 | [−0,572 ; +0,244] | 0,82 R |
| V1 | [−0,504 ; +0,522] | 1,03 R |
| V2 | [−0,765 ; −0,124] | 0,64 R |

Tant que cette largeur dépasse l'écart entre deux versions, aucune comparaison
n'est concluante. Un fichier NQ 1 minute déposé dans le dépôt est lu
automatiquement et réduit cette largeur.
