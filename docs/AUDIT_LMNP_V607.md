# Audit de propagation LMNP — v607–v608, 11 novembre 2026

La v606 avait intégré le plan ELM et l'impôt annuel, mais leur propagation était incomplète.

## Écarts corrigés

1. Dans `projectNW`, le cash-flow de Villejuif écrasait celui de Rueil pour le même propriétaire. Les cumuls s'additionnent désormais par bien. Le graphe principal et les objectifs qui le consomment réagissent effectivement aux loyers et impôts LMNP.
2. Le simulateur Couple figeait Rueil à son cash-flow fiscal courant ; celui de Nezha omettait les flux locatifs. Ils lisent maintenant le flux annuel ELM après IR/PS et frais estimés, ramené au mois. Le portage de Villejuif reste inclus avant livraison ; son impôt futur reste non déterminé.
3. Les graphiques d'équité et de revente utilisaient encore un amortissement forfaitaire de 2 % de 80 % du prix depuis l'achat. Rueil utilise désormais une source commune avec le tableau : prix projeté, dette à la même date et immobilier fiscalement déduit. Le mobilier et les reports non utilisés ne sont pas réintégrés comme des déductions immobilières.
4. La fiche affichait +126 €/mois comme cash-flow fiscal alors que le scénario complet donne +44,39 €/mois en 2026. Le cash-flow courant reste à +126 €/mois ; le net projeté et son rendement intègrent les hypothèses comptabilité/CFE/TF et le calcul fiscal annuel.
5. Le dernier point des simulateurs ajoutait une période supplémentaire dans les totaux de contributions. Un horizon de douze mois compte désormais douze contributions et douze flux.
6. Le simulateur Couple démarre sur les équités nettes actuelles ; l'interpolation des frais de sortie ne crée plus un patrimoine initial différent de son résumé.
7. La vérification visuelle a révélé un ancien tableau « Projection détaillée » dans la vue Nezha, distinct du simulateur. Il multipliait encore la richesse mensuelle actuelle et omettait des actifs. La v608 affiche directement les séries du graphique, avec le point actuel, les prochains janvier et l'horizon choisi. Chaque changement de curseur actualise les deux. L'insight Nezha distingue aussi l'équité brute de l'équité nette après sortie et les deux périmètres de cash-flow.

## Périmètres à distinguer

| Indicateur | Base |
|---|---|
| Patrimoine actuel | Actifs, dettes et frais de sortie actuels ; aucun loyer futur ajouté au cash |
| CF courant de Rueil | +126 €/mois avec les charges recensées, avant impôt et frais comptables/CFE estimés |
| Budget LMNP complet 2026 | +44,39 €/mois, moyenne annuelle avec hypothèses et impôt simulé |
| CF immobilier courant total | −177,06 €/mois, avant impôt et frais LMNP estimés |
| Budget immobilier ajusté du seul scénario Rueil | −258,67 €/mois ; fiscalité des autres biens inchangée |
| Budget net fiscal estimé, exploitation + portage | −477,67 €/mois, incluant l'impôt estimé de Vitry et le scénario complet de Rueil |
| Graphe de CF sur dix ans | Avant impôt ; budget complet estimé de Rueil |
| Graphe NW et objectifs | Rueil après IR/PS et frais estimés ; autres biens avant impôt |
| Simulateurs à curseurs | Même source LMNP, mais rendements/appréciation/contributions propres aux curseurs ; rendement cash Couple 6 %, Nezha ajustable |

Les différences entre ces périmètres sont affichées ; elles ne constituent pas des paiements confirmés. Le budget et le surplus structurel montrent un rapprochement séparé avec le scénario LMNP, sans modifier l'épargne mensuelle déclarée.

## Données et hypothèses

Le plan, les bases et les durées ELM 2025 restent confirmés. Le loyer reste 1 300 € HC + 150 € de provisions. IR de scénario, indexation, inflation, honoraires, CFE, couverture PNO, DPE et situation future LMNP/LMP restent distingués des faits.

La valeur comptable de 290 000 € ne remplace ni le prix de l'acte ni la valeur de marché. La sortie actuelle conserve environ 1 882 € de déduction immobilière documentée en 2025. Les ventes futures répartissent linéairement les déductions simulées dans l'année : convention de projection, pas un décompte comptable futur confirmé. Le maintien LMNP de Rueil demeure un scénario isolé ; le statut du foyer doit être vérifié avec Villejuif.

## Vérification

`lmnp-propagation.test.js` exerce les vrais producteurs des graphiques et des simulateurs : choc d'impôt de +1 200 €/an, indépendance de l'ordre des biens, premier point égal au patrimoine actuel, absence de mois supplémentaire, rapprochement budget/fiscalité, et égalité des trois graphiques de revente avec leur source commune. `lmnp.test.js` conserve les contrôles du plan ELM, de l'épuisement des composants, des reports et des taux.

Le référentiel Neon est relu pour le contrôle connecté. Ses anciens taux meublés à 17,2 % ne peuvent pas remplacer les règles légales datées à 18,6 % de l'application. Aucun changement du dossier fiscal 2025 ni écriture dans la base n'est effectué par cet audit.
