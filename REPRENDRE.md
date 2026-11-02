# REPRENDRE — à lire en premier dans une nouvelle session

Une conversation Claude ne se souvient de rien. Ce fichier est là pour que la
suivante n'ait pas à redécouvrir ce qui a déjà été mesuré, ni à refaire les
erreurs déjà faites. Il ne remplace pas le code : il dit **où regarder**.

---

## En une phrase

Aucune des trois stratégies de ce dépôt n'a d'avantage démontrable. Ce n'est
pas une impression, c'est mesuré, et les mesures sont datées dans
`index.html` (bloc `MESURES`, en haut du script).

---

## Ce qui est établi, et où c'est écrit

| Constat | Où le relire |
|---|---|
| **Le sens annoncé vaut une pièce de monnaie** : 49,7 % au test symétrique sur 211 scénarios | `scripts/sens.js` · `MESURES` du 19 oct. |
| **Seize façons de choisir le sens testées, aucune ne tient sur deux échantillons** | `scripts/scenario.js` · `MESURES` du 19 oct. |
| **Les sept sources de liquidité du cours ne changent rien** (au centime près comme objectifs) | `js/dol.js` · `MESURES` du 18 oct. |
| **AMD échoue 4 des 6 épreuves**, dont celle-ci : une entrée au hasard bat sa règle d'entrée, 198 tirages sur 200 | `scripts/amd_epreuves.js` |
| **La définition du CISD est probablement fausse** : une par 6 bougies, à toutes les échelles | commentaire en tête de `cisd()` dans `js/structure.js` |

---

## Les instruments, et à quoi chacun sert

    node scripts/test.js --navigateur   la suite de contrôles (le filet)
    node scripts/scenario.js            met des règles de SENS en concurrence
    node scripts/sens.js                le sens est-il bon ? (test symétrique)
    node scripts/voir.js --jour=…       DESSINE le graphique, pour le regarder
    node scripts/amd_test.js            AMD sur 60 jours
    node scripts/amd_longue.js          AMD sur 2 ans (exécution 1 heure)
    node scripts/amd_epreuves.js        les six épreuves
    node scripts/rafraichir.js          rafraîchit le cache (tout ou rien)

`scripts/scenario.js` est le plus utile pour chercher : on lui ajoute une
règle, elle est jugée aux mêmes conditions que les autres.

---

## Les pièges de mesure, tous rencontrés pour de vrai

Chacun a produit un faux résultat qui est allé jusqu'à l'écran. Les relire
avant d'en inventer un nouveau.

1. **Le regard en avant.** Dater une structure de l'instant de son extrême au
   lieu de celui de sa confirmation. A gonflé les trois quarts d'un résultat.
   Filet : « couper la série à `vu` et exiger que la chose soit encore là ».
2. **Le crédit au plafond.** Atteindre l'objectif créditait le plafond `tp2`
   au lieu de la distance réellement parcourue. +13 036 € sont devenus −985 €.
3. **La bougie d'entrée.** Si elle contient le stop ET l'objectif, l'ordre des
   prix est inconnu. Les compter gagnants donnait 55 % au lieu de 26,5 %.
   Convention du dépôt : **une bougie ambiguë compte PERDANTE**.
4. **Les tirages non indépendants.** Deux bougies de la même séance partagent
   tout. L'écart-type brut affichait 8 σ là où le calcul par jour-marché en
   donne 4,2. Toujours regrouper par jour.
5. **Le point neutre n'est pas 50 %.** À cause de la règle 3, une règle sans
   information marque ~48,6 %. Se comparer à 50 % fait passer des règles
   neutres pour mauvaises.
6. **Les essais multiples.** Seize règles sur deux cents tirages : la
   meilleure atteint 56 % par pure chance. Toujours annoncer ce seuil AVANT,
   couper l'échantillon en deux, et garder un témoin tiré au sort dans la liste.
7. **Les millésimes mélangés.** Comparer des marchés dont les caches
   s'arrêtent à des dates différentes. `scripts/lib/jeu.js` impose une période
   commune ; `scripts/rafraichir.js` rafraîchit tout ou rien.
8. **Le zéro silencieux.** Une règle, une épreuve ou une source qui ne produit
   rien et disparaît sans le dire. Arrivé trois fois. Tout ce qui se tait doit
   CRIER.

---

## Ce que Claude ne voit pas

- **Aucun graphique en direct.** Quatre nombres par bougie, rien d'autre.
  `scripts/voir.js` dessine le graphique et permet de le REGARDER, mais
  n'invente aucune information : le piège 3 reste entier.
- **Les captures d'écran, oui** — celles-là sont réellement lues.
- **Profondeur Yahoo** : 5 min → 60 jours, 1 h → 2 ans, 1 j → 5 ans. Le cache
  expire ; après une pause, relancer `scripts/rafraichir.js` avant de mesurer.

---

## Ce qui manque pour avancer

0. **Valider les six définitions `[HYP]` à l'œil, sur TradingView.** Le
   protocole est dans `SEANCE_TRADINGVIEW.md`. C'est en amont de tout le
   reste : les mesures s'appuient sur ces définitions, et on sait qu'au moins
   une (`cisd()`) est fausse. Demande une session Claude sur l'ordinateur de
   l'utilisateur, pas dans le cloud.
1. **Les trades réels de l'utilisateur, avec l'heure.** C'est la seule chose
   qui dira si le problème est la stratégie ou sa traduction en code : rejouer
   le modèle à cet instant précis et voir à quelle étape il bloque.
2. Des bougies plus fines que la minute, pour lever le piège 3.
3. Plus de 60 jours en 5 minutes.

---

## Règles de conduite tenues jusqu'ici

- Aucune clé API, aucun mot de passe, aucun identifiant dans le dépôt ni dans
  la conversation. Une clé Anthropic a été collée en chat par le passé : elle
  est à considérer comme compromise et à révoquer.
- Pas de compte créé à la place de l'utilisateur.
- Un chiffre affiché sur le site vient de `MESURES`, est daté, et un contrôle
  vérifie qu'il correspond à la réalité.
