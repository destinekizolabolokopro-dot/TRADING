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

## La séquence, dans l'ordre

```
1 BIAIS HTF → 2 DOL → 3 KEY LEVEL → 4 TOUCH → 5 SWEEP → 6 DISPLACEMENT
  → 7 IFVG → 8 CLÔTURE DE CORPS → 9 ENTRÉE → 10 SL → 11 TP
```

Une étape manque, pas de position. L'ordre a été corrigé : le balayage vient
**après** la touche, pas avant — la manipulation est la réaction au niveau, pas
ce qui y conduit.

## Résultat de la séquence complète

NQ seul, horloge 5 min, nets de frais.

| | Trades | WR | Espérance | PF | Max DD |
|---|---|---|---|---|---|
| toute la période | 34 | 41,2 % | −0,125 R | 0,77 | 6,21 R |
| 07/07 → 06/08 | 17 | 41,2 % | −0,115 R | 0,80 | — |
| 07/08 → 15/09 | 17 | 41,2 % | −0,134 R | 0,74 | — |

Régulière d'une période à l'autre, et régulièrement perdante.

## Chaque étape isolée, une variable à la fois

### 10. Le stop — les trois candidats

| | Trades | WR | Espérance | PF | Max DD |
|---|---|---|---|---|---|
| extrémité de la jambe | 34 | 41,2 % | **−0,125 R** | 0,77 | 6,22 R |
| extrémité du balayage | 34 | 38,2 % | −0,164 R | 0,72 | 7,54 R |
| bord de l'IFVG | 39 | 38,5 % | −0,382 R | 0,39 | 14,89 R |

Tu avais raison de dire de ne pas supposer le stop au creux du balayage : il
n'est pas meilleur que l'extrémité de la jambe, l'écart est dans le bruit. Ce
qui est net, en revanche, c'est que **le bord de l'IFVG est nettement le pire**
— trois fois le drawdown.

### 11. L'objectif — les sources se contredisent, et ça n'a pas d'importance

Ta séquence dit « TP vers le DOL ». Le résumé vidéo et la capture de résultats
disent 1 R puis runner, RR moyen 1,19. Synthèse retenue : **partiel à 1 R, le
reste court vers le DOL** — ce qui satisfait littéralement les deux.

| runner vers | Trades | Espérance | PF |
|---|---|---|---|
| le DOL | 34 | −0,125 R | 0,77 |
| 1,5 R fixe | 34 | −0,164 R | 0,70 |
| 2,5 R fixe | 34 | −0,113 R | 0,79 |

Les trois sont indiscernables. Le désaccord entre les sources n'a donc aucune
conséquence mesurable — **une fois le DOL défini comme la liquidité intacte la
plus proche** et non la plus ancienne. C'était ça, l'erreur d'avant : un swing
1H vieux de trois mois se trouve à plus de mille points.

### 6. Le déplacement — il coûte cher

| définition | Trades | WR | Espérance | PF |
|---|---|---|---|---|
| aucun filtre | 64 | 59,4 % | **+0,092 R** | 1,22 |
| ≥ 1 × ATR | 54 | 55,6 % | +0,032 R | 1,07 |
| bougie ≥ moyenne | 33 | 51,5 % | −0,041 R | 0,91 |
| laisse un FVG *(canonique ICT)* | 34 | 41,2 % | **−0,125 R** | 0,77 |

La définition canonique — la seule sans paramètre, donc la seule
insoupçonnable de sur-ajustement — est **la pire**. Elle divise l'échantillon
par deux et retourne le signe.

**Explication la plus probable :** le déplacement et l'IFVG sont *le même
mouvement*. Exiger un FVG de départ **puis** une inversion de FVG revient à
attendre deux impulsions successives et à entrer après la seconde — trop tard,
à un prix dégradé. Ce n'est pas que le déplacement n'existe pas dans le modèle,
c'est que mon code le compte deux fois.

### 5. Le balayage ITL/ITH — aucun effet mesurable

| unité où chercher l'ITL/ITH | Trades | WR | Espérance | PF |
|---|---|---|---|---|
| aucun balayage exigé | 64 | 59,4 % | +0,092 R | 1,22 |
| unité d'exécution | 65 | 58,5 % | +0,075 R | 1,18 |
| M15 | 61 | 54,1 % | +0,005 R | 1,01 |
| M30 | 51 | 58,8 % | +0,101 R | 1,24 |
| H1 | 63 | 57,1 % | +0,062 R | 1,14 |

C'est l'élément le plus étiqueté de toutes les planches, et **il ne filtre
rien**. Sur aucune unité. L'explication la plus probable : les ITL sont si
fréquents qu'à tout instant un ITL récent vient d'être balayé — la condition
est presque toujours vraie, donc elle ne sélectionne pas.

Soit mon implémentation rate ce que « ITL Sweep » désigne vraiment, soit ce
n'est pas un filtre mais une *description* de ce qui se passe au niveau clé.
Les deux lectures sont plausibles et je ne peux pas trancher.

## Pour référence, la même séquence sans le filtre de déplacement

| | Trades | WR | Espérance | PF |
|---|---|---|---|---|
| toute la période | 64 | 59,4 % | +0,092 R | 1,22 |
| 07/07 → 06/08 | 29 | 62,1 % | +0,206 R | 1,54 |
| 07/08 → 15/09 | 36 | 55,6 % | −0,030 R | 0,93 |

Positif sur un mois, à l'équilibre sur l'autre. **Ce n'est pas retenu comme la
stratégie** : ce serait retirer une étape que tu as explicitement demandée,
uniquement parce que le backtest préfère. La fidélité passe avant, tu l'as
posé. C'est reporté pour que tu puisses décider en connaissance de cause.

## Ancien résultat, conservé pour mémoire
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
