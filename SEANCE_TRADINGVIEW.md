# Séance TradingView — valider les définitions à l'œil

## Pourquoi cette séance existe

Six définitions de ce dépôt sont marquées `[HYP]` ou `UNCONFIRMED ASSUMPTION` :
le cours source les **nomme sans les définir**, elles ont été traduites en code
par hypothèse, et rien n'a jamais vérifié que la traduction correspond à ce
qu'un trader voit.

Une au moins est fausse. Mesuré le 1er novembre : la fonction `cisd()` de
`js/structure.js` se déclenche **une fois toutes les 6 bougies**, à la même
cadence du 5 minutes au 1 heure. Une cadence qui ne dépend pas de l'échelle
trahit une règle purement locale — un détecteur de bruit, pas un événement de
marché. Et le banc d'essai le confirmait sans qu'on sache pourquoi : « dernier
CISD » y est la deuxième pire règle de direction.

Ce défaut a été trouvé en DESSINANT un seul graphique. Les mesures seules ne
l'avaient pas vu en trois semaines.

## Ce que cette séance ne fait pas

Elle ne remplace pas les backtests. `scripts/scenario.js` compare 7 000
situations ; à l'œil on en couvre vingt. Pour MESURER, les chiffres restent
imbattables. Cette séance sert à **corriger les définitions sur lesquelles les
mesures s'appuient** — ce qui est en amont, et actuellement cassé.

## Comment la mener

Il faut une session Claude qui tourne **sur l'ordinateur** (appli Claude
Desktop, ou extension Claude dans Chrome), avec TradingView déjà ouvert et
connecté. Une session cloud comme celles de claude.ai/code ne peut pas
atteindre le navigateur.

**Limite à tenir :** Claude regarde et lit. Il ne clique sur rien qui passe un
ordre, ne modifie aucun réglage de compte, ne touche à aucun courtier
connecté. Si un trade doit être passé, c'est l'utilisateur qui le passe.

## Les six questions, par ordre d'importance

Pour chacune : ouvrir le graphique, demander à Claude ce que SON code
retiendrait, et répondre « oui c'en est un » / « non ». Dix à quinze exemples
par question suffisent à trancher.

### 1. CISD — le plus urgent, il est cassé
`js/structure.js`, fonction `cisd()`. Définition actuelle : dernière série de
bougies baissières faisant un plus-bas, puis une clôture au-dessus de l'open
de la première bougie de la série.
→ **Montrer 10 CISD que l'utilisateur reconnaît comme tels.** Combien le code
en trouve-t-il au même endroit ? Qu'est-ce qui distingue les vrais des 65 que
le code produit chaque séance ?

### 2. « Liquidité interne derrière le FVG »
`js/amd.js`, en tête. Interprétée comme « un swing intact au-delà du FVG dans
le sens prévu ». C'est une hypothèse entière.
→ Sur un setup réel : quelle est la liquidité « derrière » le FVG ?

### 3. Rejection Block
`js/structure.js`, `rejectionBlocks()`. Nommé par la source, jamais défini.
→ En montrer trois. Mèche ou corps ? Quelle zone exactement ?

### 4. FVG « respecté » / « non respecté »
`js/structure.js`, `etatFVG()`. Sert au score de biais, qui est la meilleure
règle de direction sur deux ans (50,8 %). Sa définition est une hypothèse.
→ Un FVG touché puis quitté du bon côté : respecté ?

### 5. Quel FVG retenir quand il y en a plusieurs
Le code prend le plus proche dans une portée en ATR. Réglage arbitraire.
→ Face à trois FVG valides, lequel l'utilisateur prend-il, et pourquoi ?

### 6. Le moment de l'entrée
C'est le point le plus coûteux mesuré : une entrée au hasard dans la fenêtre
bat la règle actuelle, 198 tirages sur 200.
→ Rejouer 5 trades réels : à quelle seconde l'utilisateur entre-t-il, et sur
quoi exactement ?

## Après la séance

Chaque définition corrigée se réécrit dans `js/structure.js` avec le même soin
que les commentaires existants : ce qu'elle dit, pourquoi, et ce qui a été
vérifié. Puis on relance `node scripts/test.js --navigateur`, puis
`node scripts/scenario.js` — si une définition corrigée vaut mieux que
l'ancienne, le banc d'essai le dira, et le point neutre reste le juge.

Attention : corriger `cisd()` fera échouer les deux contrôles de cadence
ajoutés le 1er novembre. C'est voulu — ils sont là pour signaler que le défaut
documenté a changé. Les mettre à jour, ne pas les supprimer.
