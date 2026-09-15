# Réglages mesurés — recherche du meilleur taux de réussite

900 configurations tirées au hasard dans l'espace des paramètres du modèle,
263 retenues (au moins 20 trades). NQ=F seul, horloge 5 min, nets de frais
(commission 4 $ aller-retour, slippage 0,25 point par côté).

```
node scripts/optim_wr.js --n 900 --min 20      # relancer la recherche
```

## Le réglage retenu

```
--ghdeb 09:30 --ghfin 10:00     la première demi-heure de New York
--tp1 0.5 --part 0.9            90 % encaissés à 0,5 R, puis seuil
--tp2 2.5                       le runner de 10 % court jusqu'à 2,5 R
--sl ifvg                       stop au bord de l'IFVG
--disp off --sweep 0            sans filtre de déplacement ni balayage
--seuil 2 --fvgn 1              biais : score 2 sur 4 unités
--maxjour 2 --atrmin 0.3 --react 12
```

| | ensemble | 07/07 → 06/08 | 07/08 → 15/09 |
|---|---|---|---|
| Trades | 64 | 24 | 40 |
| **Taux de réussite** | **84,4 %** | **83,3 %** | **85,0 %** |
| Espérance | +0,237 R | +0,229 R | +0,242 R |
| Profit factor | 2,49 | 2,36 | 2,58 |
| Max drawdown | 2,25 R | 2,03 R | 2,19 R |
| IC 95 % | **[+0,102 ; +0,372]** | | |
| t | **3,44** | | |

54 gagnants, 10 perdants. **C'est la première fois de tout le projet que le
zéro sort de l'intervalle de confiance.**

Le drawdown maximal est de 2,25 R. À 250 $ de risque par trade sur un compte
de 50 000 $, cela fait **564 $ de creux maximal** — très à l'aise sous les
2 500 $ d'une évaluation prop firm.

## Les dix meilleurs taux de réussite

| | WR | Trades | Espérance | PF | Max DD |
|---|---|---|---|---|---|
| 1 | 97,4 % | 39 | +0,092 R | 4,57 | 1,0 R |
| 2 | 93,5 % | 31 | +0,115 R | 2,77 | 1,0 R |
| 3 | 92,9 % | 28 | +0,050 R | 1,70 | 1,8 R |
| 4 | 90,9 % | 33 | **−0,030 R** | 0,68 | 1,4 R |
| 5 | 90,5 % | 42 | +0,131 R | 2,35 | 1,0 R |
| 6 | 89,8 % | 98 | +0,124 R | 2,19 | 4,1 R |
| … | | | | | |
| — | **84,4 %** | **64** | **+0,237 R** | **2,49** | **2,25 R** |

Les taux les plus hauts ne sont pas les plus rentables : la ligne à 90,9 %
**perd de l'argent**, et celle à 97,4 % gagne trois fois moins que celle à
84,4 %. Le réglage retenu n'est donc pas le taux le plus élevé, c'est le plus
élevé **parmi ceux qui tiennent**.

**Corrélation entre taux de réussite et espérance sur les 263 configurations :
+0,525.** Il y a donc bien un lien positif — c'est une nuance à ma charge, je
l'avais présenté de façon trop tranchée. Chercher le taux de réussite n'est pas
absurde en soi ; ce qui est absurde, c'est de le chercher **en rapprochant la
cible**, mécanisme qui dégrade toujours la rentabilité.

## Ce qu'il faut savoir avant de s'en servir

**1. Sélection sur les mêmes données.** Ce réglage est le meilleur de 263
essais faits sur la même période. Sur 263 tirages, une douzaine passent le
seuil de significativité par pur hasard. **Le t de 3,44 n'est donc pas un vrai
t de 3,44.**

Ce qui plaide en sa faveur : 83,3 % puis 85,0 % sur deux blocs séparés, avec
des profit factors de 2,36 et 2,58. Une coïncidence se tient rarement aussi
bien des deux côtés. Mais les deux blocs faisaient partie des données
d'optimisation — ce n'est pas un vrai hors-échantillon, et Yahoo n'en permet
aucun au-delà de 60 jours.

**2. Le réglage s'écarte du modèle.** Il désactive le filtre de déplacement et
le balayage ITL/ITH. C'est ce que la mesure préfère, ce n'est pas la séquence
complète. Fidélité et performance ne pointent pas au même endroit ici, et il
faut le savoir.

**3. C'est un profil de scalp.** 90 % de la position est encaissée à 0,5 R. Le
RR moyen visé est de 0,70. Beaucoup de petits gains, rares pertes pleines —
44 trades sur 64 finissent au seuil après prise partielle. Hors seuils, le taux
tombe à 50 %.

**4. Deux écarts non filtrés**, faute de source pour les justifier : les shorts
font +0,289 R contre +0,151 R pour les longs, et les IFVG 1M/2M sont à 100 %
sur 17 trades.
