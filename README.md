# Questionnaire collaborateurs : usages et compétences IA

Formulaire web autonome utilisé par Tandem au démarrage d'un audit IA. Une page, 41 questions, 12 à 15 minutes, français et anglais, sans dépendance externe. Les réponses brutes sont envoyées à un webhook n8n ; **aucun corrigé ni scoring n'existe dans ce dépôt** : le barème vit dans le template de restitution interne.

URL de production : `https://wearetandem-ai.github.io/questionnaire-audit-ia/?c=<slug-client>`

Paramètres d'URL :

| Paramètre | Rôle |
|---|---|
| `c` | slug du client, doit correspondre à un fichier `clients/<slug>.json` (obligatoire, sinon écran « lien invalide ») |
| `lang` | `fr` ou `en`, sinon la langue par défaut du client |
| `reset` | efface le brouillon et l'état « déjà répondu » de l'appareil (usage interne pour les tests) |

## Déployer pour un nouveau client

1. Copier `clients/_template.json` en `clients/<slug>.json` et renseigner : nom de l'entreprise, liste des directions (P1), `nominatif` (faux par défaut), langue par défaut, contact, phrase d'accueil.
2. Commit et push sur `main`. GitHub Pages publie en une à deux minutes.
3. Ouvrir `…/?c=<slug>` et dérouler le questionnaire une fois en entier (envoyer une réponse de test : elle porte le slug du client et se filtre ensuite).
4. Envoyer le lien aux collaborateurs (mail type dans le guide de déploiement interne).
5. Exporter les réponses en CSV depuis n8n (workflow « Audit IA — Export CSV », clé interne) et coller dans le template de restitution.

## Structure

```
index.html            page unique
assets/app.js         rendu des questions, logique conditionnelle, brouillon local, envoi
assets/style.css      styles, responsive, accessibilité
data/questions.json   questions FR/EN (généré depuis la banque interne, sans corrigé : ne pas éditer à la main)
clients/*.json        configuration par client
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
