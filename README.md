# Docker-DevOps

# CamVisit

Application de réservation de visites des sites touristiques du Cameroun.
Une réservation contient : le site, la date, l’heure et le nombre de personnes.
Stack : Node.js 24 (Express), PostgreSQL 18, Docker Compose.

## Fonctionnalités

- 8 sites touristiques avec région, description, tarif (fictif, en FCFA) et capacité par jour
- Réservation avec vérification des places restantes (refus si le site est complet)
- Total estimé en FCFA et code de réservation unique (`CM-XXXXXX`)
- Filtres par site et par date, statistiques en haut de page
- 5 réservations d’exemple protégées (`CM-DEMO01` à `CM-DEMO05`), impossibles à supprimer
- Données conservées dans un volume Docker

## Prérequis

- Docker et Docker Compose (`docker --version`, `docker compose version`)
- Port 3000 libre

## Installation et lancement

1. Cloner le dépôt :
   ```bash
   https://github.com/jesselazare/Docker-DevOps/
   cd docker-DevOps
   ```
2. Créer le fichier `.env` :
   ```bash
   cp .env.example .env
   ```
   Puis choisir un mot de passe dans `POSTGRES_PASSWORD`.
3. Construire et démarrer :
   ```bash
   docker compose up --build
   ```
   (ajouter `-d` pour garder la main sur le terminal)
4. Ouvrir http://localhost:3001

Au premier démarrage, les tables sont créées et les 5 exemples ajoutés.
Pendant que la base démarre, la page peut afficher « Base non connectée » quelques secondes : elle se met à jour toute seule.

## Utilisation

1. Choisir un site : sa description, son tarif et les places restantes s’affichent.
2. Choisir la date (aujourd’hui ou plus tard), l’heure (entre 06:00 et 17:00) et le nombre de personnes (1 à 50).
3. Cliquer sur « Réserver » : un code de réservation est affiché.
4. Dans la liste, filtrer par site ou par date, et supprimer avec « Supprimer » les réservations ajoutées à la main.
5. Les réservations marquées « exemple » sont protégées.

## API

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/sante` | État de l’API, de la base, nom du conteneur |
| GET | `/api/sites` | Liste des sites touristiques |
| GET | `/api/sites/:id/disponibilite?jour=AAAA-MM-JJ` | Places restantes d’un site |
| GET | `/api/reservations?site=ID&jour=AAAA-MM-JJ` | Liste (filtres facultatifs) |
| POST | `/api/reservations` | Ajouter (`site_id`, `jour`, `heure`, `personnes`) |
| DELETE | `/api/reservations/:id` | Supprimer (403 pour un exemple) |
| GET | `/api/stats` | Statistiques globales et par site |

Exemple :
```bash
curl -X POST http://localhost:3000/api/reservations \
  -H "Content-Type: application/json" \
  -d '{"site_id":3,"jour":"2027-03-10","heure":"08:00","personnes":4}'
```

## Vérifications utiles

```bash
curl http://localhost:3000/api/sante
curl -X DELETE http://localhost:3000/api/reservations/1   # exemple protégé : réponse 403
docker compose down && docker compose up -d               # les données sont conservées
```

## Commandes Docker

```bash
docker compose ps                # état et santé des services
docker compose logs -f api       # logs de l’application
docker compose logs db           # logs de PostgreSQL
docker compose down              # arrêt, données conservées
docker compose down -v           # arrêt + suppression des données (retour aux 5 exemples)
```

## Dépannage

- « Base non connectée » : attendre quelques secondes ou consulter `docker compose logs db`.
- Port 3000 occupé : remplacer `"3000:3000"` par `"8080:3000"` dans `docker-compose.yml`.
- Mot de passe modifié sans effet : la base garde l’ancien tant que le volume existe, faire `docker compose down -v`.
- Réservation refusée avec « pas assez de places » : choisir une autre date ou moins de personnes.
