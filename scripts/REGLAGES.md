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

## Vérifications de solidité

Aucune autre période NQ n'est accessible : Yahoo plafonne l'intraday à 60
jours, Dukascopy est bloqué depuis cet environnement, Polygon et EODHD
demandent une clé. Trois vérifications de substitution ont donc été faites.

### Test 1 · le même réglage, sans rien toucher, sur d'autres contrats

Valeur du point et slippage propres à chaque contrat.

| | Trades | WR | Espérance | PF | Max DD |
|---|---|---|---|---|---|
| **NQ** Nasdaq | 64 | 84,4 % | **+0,237 R** | 2,49 | 2,25 R |
| YM Dow | 46 | 78,3 % | +0,102 R | 1,44 | 5,39 R |
| GC Or | 46 | 76,1 % | +0,086 R | 1,35 | 3,28 R |
| RTY Russell | 54 | 77,8 % | +0,069 R | 1,28 | 3,16 R |
| ES S&P 500 | 45 | 71,1 % | −0,079 R | 0,75 | 5,06 R |
| CL Pétrole | 32 | 65,6 % | −0,170 R | 0,55 | 6,53 R |

Quatre contrats sur six sont positifs, et le taux de réussite reste haut
partout — entre 65 et 84 %. Mais **aucun n'approche le NQ**, et le S&P, qui
est le contrat le plus proche du Nasdaq, est négatif.

La moyenne des trois autres indices est de **+0,031 R**, celle des quatre
positifs hors NQ de **+0,086 R**. C'est une estimation indépendante de ce que
vaut le jeu de règles une fois retiré le gain d'optimisation : autour de
**+0,10 R**, pas +0,237 R.

### Test 2 · la même stratégie sur une autre horloge d'exécution — ÉCHEC

| horloge | Trades | WR | Espérance | PF |
|---|---|---|---|---|
| 5 min | 64 | 84,4 % | +0,237 R | 2,49 |
| 2 min | 42 | 71,4 % | +0,038 R | 1,13 |
| 1 min | 12 | 58,3 % | −0,140 R | 0,67 |

L'avantage ne vit que sur le 5 minutes. C'est le résultat le plus inquiétant
des trois : un comportement de marché réel ne devrait pas disparaître parce
qu'on regarde les mêmes prix découpés autrement.

### Test 3 · sensibilité aux paramètres — RÉUSSI

C'est le test le plus parlant contre le sur-ajustement : un réglage ajusté au
bruit s'effondre dès qu'on le bouge d'un cran, un effet réel se dégrade
doucement.

| fenêtre horaire | Espérance | | prise partielle | Espérance |
|---|---|---|---|---|
| 09:30 → 10:00 | +0,237 R | | tp1 = 0,4 | +0,225 R |
| 09:35 → 10:05 | +0,189 R | | tp1 = 0,5 | +0,237 R |
| 09:30 → 10:15 | +0,204 R | | tp1 = 0,6 | +0,237 R |
| 09:30 → 09:45 | +0,220 R | | tp1 = 0,75 | +0,258 R |

La fraction encaissée de 0,7 à 1,0 donne +0,231 à +0,240 R : aucune
sensibilité. **C'est un plateau, pas un pic.** Le réglage n'est donc pas un
accident numérique de l'optimiseur.

À noter : `tp1 = 0,4` donne **89,1 % de réussite** avec un profit factor de
**3,02** et une espérance quasi identique. Sur le même plateau, c'est un
meilleur point si le taux de réussite est ce qui compte.

### Verdict

| test | résultat |
|---|---|
| sensibilité aux paramètres | ✅ réussi, franchement |
| transfert vers d'autres contrats | ⚠️ partiel — 4 sur 6 positifs, le NQ très au-dessus |
| transfert vers une autre horloge | ❌ échec |

Un sur trois franchement réussi, un partiel, un échec. **Le jeu de règles a
probablement un avantage réel mais faible, de l'ordre de +0,10 R**, et le
+0,237 R du NQ en 5 minutes contient une part de gain d'optimisation qu'on ne
peut pas chiffrer sans vraies données hors période.

À +0,10 R, le rendement tombe à **1,4 % par mois** à 0,5 % de risque — le bas
de la fourchette annoncée, et non son haut.

## Relance du 16 septembre — le seuil d'équilibre

Données retéléchargées, fenêtre glissée d'un jour, même réglage.

| | 15 sept. | **16 sept.** |
|---|---|---|
| Trades | 64 | **56** |
| Taux de réussite | 84,4 % | **83,9 %** |
| Espérance | +0,237 R | **+0,237 R** |
| Profit factor | 2,49 | **2,45** |
| Max drawdown | 2,25 R | **2,21 R** |

Ce n'est pas une validation : la fenêtre n'a bougé que d'un jour, c'est
presque le même échantillon. L'intérêt est ailleurs.

### Le chiffre qui manquait — le taux de réussite d'équilibre

```
gain moyen quand ça gagne   : +0,477 R   (47 trades)
perte moyenne quand ça perd : −1,019 R   ( 9 trades)

taux de réussite actuel      83,9 %
TAUX D'ÉQUILIBRE             68,1 %   ← en dessous, on perd
marge                        15,8 points
```

Les gains sont petits et les pertes sont pleines : il faut **68 % de trades
non perdants rien que pour ne rien gagner**. C'est la contrepartie du profil
de scalp, et c'est la fragilité principale du réglage. Un taux qui glisse de
84 % à 70 % ne divise pas le gain par deux — il l'annule presque.

### Courbe jour par jour

35 séances avec trade, du 9 juillet au 14 septembre.

```
26 jours gagnants · 9 perdants · 0 nul
pire journée  −1,00 R      meilleure journée  +1,40 R
plus longue série de jours perdants : 3
drawdown maximal recalculé jour par jour : 2,10 R
```

La courbe ne recule jamais de plus de deux unités de risque, ce qui est très
confortable pour une évaluation prop firm. Mais cette régularité est celle
d'un modèle à petits gains fréquents : elle tient tant que le taux tient.

### Transfert, mesuré le même jour

| | Trades | WR | Espérance | PF |
|---|---|---|---|---|
| **NQ** | 56 | 83,9 % | **+0,237 R** | 2,45 |
| RTY Russell | 45 | 75,6 % | +0,035 R | 1,13 |
| GC Or | 42 | 71,4 % | +0,021 R | 1,07 |
| YM Dow | 50 | 72,0 % | −0,001 R | 1,00 |
| ES S&P 500 | 43 | 72,1 % | −0,069 R | 0,78 |

Trois contrats sur quatre sont à l'équilibre, un est négatif, et tous ont un
taux de réussite autour de 72 à 76 % — **au-dessus du seuil d'équilibre de
68 %, mais de peu**. Le NQ reste très au-dessus des autres. Cet écart est
soit une vraie particularité du contrat, soit ce que l'optimisation a
capté ; deux mois de données ne permettent pas de trancher.

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
