# Questionnaire collaborateurs : usages et compétences IA

Formulaire web autonome utilisé par Tandem au démarrage d'un audit IA. Une page, 41 questions, 12 à 15 minutes, français et anglais, sans dépendance externe. Les réponses brutes sont envoyées à un webhook n8n ; **aucun corrigé ni scoring n'existe dans ce dépôt** : le barème vit dans le template de restitution interne.

URL de production : `https://wearetandem-ai.github.io/questionnaire-audit-ia/?c=<slug-client>`

Tableau de bord temps réel (interne, protégé par clé) : `https://wearetandem-ai.github.io/questionnaire-audit-ia/dashboard.html?c=<slug-client>&key=<clé>`. La page ne contient aucun corrigé : elle affiche des résultats déjà interprétés par n8n et se rafraîchit toutes les 30 secondes.

Console admin (interne, Tandem) : `https://wearetandem-ai.github.io/questionnaire-audit-ia/admin.html`. Créer et configurer les clients, ouvrir/fermer les campagnes, lire les compteurs et récupérer les liens/clés — sans passer par git. Protégée par la clé admin (demandée à Gaspard/Josselin).

Paramètres d'URL :

| Paramètre | Rôle |
|---|---|
| `c` | slug du client (obligatoire). La config vient de l'endpoint n8n `/audit-ia/config` (repli sur `clients/<slug>.json` si n8n est indisponible). |
| `m` | id de la mission/campagne (optionnel). Absent = campagne « en ligne » active du client. |
| `lang` | `fr` ou `en`, sinon la langue par défaut du client |
| `reset` | efface le brouillon et l'état « déjà répondu » de l'appareil (usage interne pour les tests) |

## Déployer pour un nouveau client

**Via la console admin (recommandé, sans git)** : ouvrir `admin.html`, « + Nouveau client », renseigner les champs, enregistrer. Le client est immédiatement servi par `/audit-ia/config`. L'onglet « Liens » donne le lien questionnaire, le dashboard (avec clé), l'export, le QR code et un modèle de mail. Ouvrir/fermer la campagne depuis « Campagnes ».

Les fichiers `clients/*.json` ne servent plus que de repli hors-ligne : la source de vérité est la table Clients dans n8n.

## Structure

```
index.html            page unique du questionnaire
dashboard.html        tableau de bord temps réel (lecture de l'endpoint n8n /audit-ia/data)
admin.html            console admin Tandem (appelle l'API n8n /audit-ia/admin/api/*)
assets/app.js         rendu des questions, logique conditionnelle, brouillon local, envoi
assets/style.css      styles, responsive, accessibilité
data/questions.json   questions FR/EN (généré depuis la banque interne, sans corrigé : ne pas éditer à la main)
clients/*.json        repli hors-ligne de la config par client (source de vérité : table n8n)
```

## Logique conditionnelle

- U2 à U9 (outils, comptes, données, manager, raison, tâches, temps gagné) sont masquées si U1 = « jamais » ; U5 (règle interne) et U10 (formation) restent posées à tous.
- U3 (type de compte) affiche une ligne par outil coché en U2.
- U7 (raison d'un outil non fourni) n'apparaît que si au moins un compte personnel ou inconnu est déclaré en U3.
- N1 et N2 (nom, e-mail) n'apparaissent que si `nominatif` est vrai dans la configuration du client.
- Les options des questions de connaissance et de scénario sont mélangées à l'affichage (ordre fixé par session), « Je ne sais pas » reste en dernier. Ce sont les identifiants d'option, pas les libellés, qui sont envoyés.

## Données envoyées

`POST` JSON vers le webhook n8n : `response_id` (UUID généré par le navigateur), `client`, `lang`, `duration_s`, `user_agent`, `answers` (identifiants d'options ; listes pour les choix multiples ; objet outil → compte pour U3). Le serveur horodate, valide et aplatit en une ligne par répondant. Pas de cookie, pas de traceur ; un brouillon est conservé dans le `localStorage` du navigateur jusqu'à l'envoi.

## Développement

Aucun build. Servir le dossier avec n'importe quel serveur statique, par exemple :

```bash
python3 -m http.server 8080
```

puis ouvrir `http://localhost:8080/?c=demo`. La source des questions et le générateur (`build.py`) sont dans le dossier interne Tandem « Questionnaire IA / livrables ».
