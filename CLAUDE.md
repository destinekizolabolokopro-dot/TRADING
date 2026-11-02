# TRADEassist — à lire avant de toucher à quoi que ce soit

Projet de trading ICT/SMC pour un compte prop firm Lucid (50 000 €).
L'utilisateur parle français et n'est pas développeur : **répondre en français,
simplement, sans jargon technique inutile.**

## Avant la première mesure : lire `REPRENDRE.md`

Il contient ce qui a déjà été établi, les instruments disponibles, et les
**huit pièges de mesure** qui ont tous produit, pour de vrai, un faux chiffre
arrivé jusqu'à l'écran. Les relire coûte deux minutes et évite de refaire la
même erreur une neuvième fois.

`SEANCE_TRADINGVIEW.md` donne le travail à faire en priorité quand la session
tourne sur l'ordinateur de l'utilisateur avec un navigateur.

## L'état des lieux, en une phrase

Aucune des trois stratégies n'a d'avantage démontrable. Le sens annoncé vaut
une pièce de monnaie (49,7 % au test symétrique sur 211 scénarios). Les
chiffres exacts et datés vivent dans le bloc `MESURES` en haut du script de
`index.html` — c'est la source unique, et un contrôle vérifie que la page ne
raconte rien d'autre.

## Les règles qui ne se négocient pas

**1. Un résultat flatteur est un suspect, pas une bonne nouvelle.**
Trois faux résultats sont allés jusqu'à l'écran dans ce projet : +13 036 € qui
valaient −985 €, 55 % qui valaient 26,5 %, 8 écarts-types qui valaient 4,2.
À chaque fois le chiffre était beau et faux. Quand une mesure s'améliore
soudainement, **chercher le défaut avant de l'annoncer.**

**2. Une bougie ambiguë compte PERDANTE.**
Si une bougie contient le stop ET l'objectif, l'ordre des prix est inconnu.
Convention du dépôt, sans exception.

**3. Le point neutre se mesure, il ne vaut pas 50 %.**
À cause de la règle 2, une règle sans information marque ~48,6 %.

**4. Regrouper par jour-marché avant de calculer un écart-type.**
Deux bougies de la même séance ne sont pas deux paris indépendants.

**5. Tester plusieurs règles oblige à annoncer le seuil du hasard AVANT,
couper l'échantillon en deux, et garder un témoin tiré au sort dans la liste.**

**6. Ce qui ne produit rien doit CRIER.**
Une règle, une épreuve ou une source qui rend zéro en silence fait conclure
sur du vide. C'est arrivé trois fois.

**7. Ne jamais annoncer un avantage sur un seul échantillon.**
Il doit tenir sur les deux, et passer les six épreuves
(`scripts/amd_epreuves.js`).

**8. Dire ce qui ne marche pas, en premier et sans adoucir.**
L'utilisateur risque de l'argent réel. Un résultat négatif clairement dit vaut
mieux qu'un espoir entretenu.

## Sécurité — appliqué jusqu'ici, à tenir

- **Aucune clé API, aucun mot de passe, aucun identifiant** dans le dépôt ni
  dans la conversation. Une clé Anthropic a été collée en chat par le passé :
  la considérer comme compromise, ne jamais la réutiliser.
- Ne pas créer de compte à la place de l'utilisateur.
- Avec un navigateur : **regarder et lire. Ne cliquer sur rien qui passe un
  ordre**, ne toucher à aucun courtier connecté. Si un trade doit partir,
  c'est l'utilisateur qui le passe.

## Travailler dans ce dépôt

    node scripts/test.js --navigateur    la suite de contrôles — avant chaque commit
    node scripts/rafraichir.js           rafraîchir le cache (il expire en 60 jours)
    node scripts/build_single.js         reconstruire TRADEassist.html et docs/

`index.html` est la source ; `TRADEassist.html` et `docs/index.html` sont
ENGENDRÉS — ne jamais les éditer à la main, les reconstruire.

Un chiffre affiché sur la page vient de `MESURES`, est daté, et un contrôle
verrouille sa cohérence. Ajouter un chiffre en dur à côté casse ce verrou,
et c'est voulu.

Branche de travail : `claude/trading-ict-smc-site-h1n3i7`.
