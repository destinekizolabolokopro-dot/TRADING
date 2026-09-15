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

### Réserve permanente sur la taille d'échantillon

Aucun seuil de trades n'est posé comme vérité. Ce qui est reporté à chaque
version est la **largeur de l'intervalle de confiance**, qui dit directement ce
que l'échantillon autorise à affirmer :

| Version | IC 95 % de l'espérance | largeur |
|---|---|---|
| V0 | [−0,572 ; +0,244] | 0,82 R |
| V1 | [−0,504 ; +0,522] | 1,03 R |

Tant que cette largeur dépasse l'écart entre deux versions, aucune comparaison
n'est concluante. Un fichier NQ 1 minute déposé dans le dépôt est lu
automatiquement et réduit cette largeur.
