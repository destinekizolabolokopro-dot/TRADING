# Le Mech Model — résultats

**Une seule stratégie.** `scripts/mech.js`. Pas de variantes : les paramètres
du fichier sont uniquement les endroits où aucune source ne dit quoi faire, et
ils ont tous une valeur par défaut.

NQ=F seul, aucun autre marché mélangé · Yahoo Finance · horloge 5 min ·
commission 4,00 $ aller-retour · slippage 0,25 point par côté · point à 20 $ ·
risque 500 $ par trade. **Toutes les valeurs sont nettes de frais.**

```
node scripts/rapport.js --moteur scripts/mech.js --sym NQ=F --range 60d
```

## Résultat d'ensemble

| | |
|---|---|
| Trades | **61** |
| Taux de réussite | **63,9 %** |
| Taux hors seuils | 25,9 %  (7 gains pleins / 20 pertes / 25 seuils) |
| RR moyen visé | 1,75 |
| Espérance | **+0,158 R** |
| Profit factor | **1,45** |
| Max drawdown | 5,75 R  (2 877 $) |
| Cumulé | +9,6 R  ·  **+4 823 $** |
| IC 95 % | [−0,081 ; +0,397] · largeur 0,48 R |

## Tenue sur deux périodes distinctes

| période | Trades | WR | Espérance | PF | Max DD |
|---|---|---|---|---|---|
| 07/07 → 06/08 | 27 | **74,1 %** | +0,377 R | 2,51 | 1,21 R |
| 07/08 → 15/09 | 34 | **55,9 %** | −0,016 R | 0,96 | 5,75 R |

Un mois franchement gagnant, un mois à l'équilibre. **Plus d'inversion de
signe** : les versions précédentes faisaient +0,78 R puis −0,44 R sur ces
mêmes blocs. C'est le premier comportement stable obtenu.

## Ce qui a changé et pourquoi

**L'objectif.** C'était le défaut central. Le moteur visait un swing
structurel à 5, 7, parfois 200 fois le risque, en se rabattant sur le draw on
liquidity — un swing 1H qui se trouve couramment à plus de mille points. Zéro
trade sur trente-deux n'atteignait jamais sa cible.

Deux sources concordent contre ça : objectif court, **1 R partiel puis
runner**, RR moyen annoncé 1,19 et maximum 2,44. Le RR moyen visé passe de
7,32 à 1,75, et l'espérance de −0,164 R à +0,158 R.

**Le DOL n'est plus un objectif.** Il sert uniquement à vérifier qu'il reste
une poche de liquidité intacte dans le sens du biais. C'est son rôle dans les
sources : un contexte directionnel, pas une cible.

**Les niveaux clés.** Quatre familles — FVG, ITL/ITH, CISD, Rejection Block —
sur cinq unités : M5, M15, M30, H1, H4. Contre une seule famille sur deux
unités auparavant. C'est ce qui fait passer l'échantillon de 21 à 61 trades et
resserre l'intervalle de confiance de 0,82 à 0,48 R.

*Réserve :* le M3 de la référence est absent. Yahoo ne sert le 3 minutes que
sur 8 jours, le M30 et le H4 sont agrégés depuis le M15 et le H1.

**Le balayage ITL/ITH.** Mèche au-delà du niveau, clôture qui revient : c'est
un balayage. Clôture au-delà : c'est une cassure de structure, pas un
balayage. Le stop s'appuie sur l'extrémité de ce balayage — c'est le
« manipulation swing » des sources.

**Le biais.** Score de respect des FVG en 1D, 4H, 1H et 15M. L'état neutre
existe et interdit de prendre position : 136 bougies sur 327 sont écartées à ce
titre. La version précédente trouvait toujours une direction.

## Où disparaissent les setups

```
327  bougies dans la fenêtre 09h30–11h00
136  écartées : biais NEUTRE  (42 %)
 69  niveau clé retenu, balayage validé
 69  niveau touché
 62  IFVG confirmé par clôture de corps
 61  entrées
```

## Ce qu'on ne peut pas encore dire

L'intervalle de confiance contient toujours le zéro, t = 1,30. Avec 61 trades
on ne peut pas affirmer que l'espérance est positive — seulement qu'elle est
probablement comprise entre −0,08 et +0,40 R.

Deux lectures méritent attention et pourraient être du sur-ajustement :
les shorts font +0,220 R contre +0,040 R pour les longs, et les IFVG en 5
minutes font +0,295 R contre −0,222 R en 2 minutes. Aucune source ne justifie
de filtrer là-dessus, donc **rien n'est filtré**.

Un fichier NQ 1 minute déposé dans le dépôt est lu automatiquement et réduit
cet intervalle.
