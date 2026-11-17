// ---------------------------------------------------------------------------
// CamVisit : réservation de visites de sites touristiques du Cameroun
//
// Une réservation = un site, une date, une heure, un nombre de personnes.
// L'application :
//   - sert une page web (public/index.html) ;
//   - se connecte à PostgreSQL via PGHOST, PGUSER, PGPASSWORD, PGDATABASE ;
//   - vérifie les places disponibles, calcule le prix et génère un code.
// ---------------------------------------------------------------------------

const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const pool = new Pool();

// ----- Données de référence -------------------------------------------------

const MAX_PERSONNES = 50; // par réservation
const HEURE_MIN = "06:00";
const HEURE_MAX = "17:00";

// Sites proposés (tarifs fictifs, en FCFA par personne).
const SITES = [
  ["Mont Cameroun (Buéa)", "Sud-Ouest", "Ascension du plus haut volcan d'Afrique de l'Ouest, avec guide.", 15000, 30],
  ["Chutes de la Lobé (Kribi)", "Sud", "Cascade qui se jette directement dans l'océan Atlantique.", 5000, 60],
  ["Parc national de Waza", "Extrême-Nord", "Safari en savane : éléphants, girafes et lions.", 20000, 40],
  ["Palais des rois Bamoun (Foumban)", "Ouest", "Palais royal et musée des arts et traditions bamoun.", 3000, 50],
  ["Jardin botanique de Limbé", "Sud-Ouest", "Jardin historique au pied du mont Cameroun.", 2000, 80],
  ["Réserve de faune du Dja", "Est", "Forêt équatoriale classée, randonnée et observation de primates.", 25000, 20],
  ["Chutes d'Ekom-Nkam (Melong)", "Littoral", "Chutes spectaculaires dans la forêt du Moungo.", 4000, 45],
  ["Chefferie de Bandjoun", "Ouest", "Chefferie traditionnelle aux cases ornées de sculptures.", 3000, 40],
];

// 5 réservations d'exemple, protégées : elles ne peuvent pas être supprimées.
// Format : [code, nom du site, jour, heure, personnes]
const RESERVATIONS_DE_DEPART = [
  ["CM-DEMO01", "Chutes de la Lobé (Kribi)", "2027-01-16", "09:00", 4],
  ["CM-DEMO02", "Palais des rois Bamoun (Foumban)", "2027-01-23", "10:30", 6],
  ["CM-DEMO03", "Parc national de Waza", "2027-02-06", "07:00", 8],
  ["CM-DEMO04", "Mont Cameroun (Buéa)", "2027-02-13", "06:00", 5],
  ["CM-DEMO05", "Jardin botanique de Limbé", "2027-02-20", "14:00", 3],
];

// ----- Connexion à la base --------------------------------------------------

let baseConnectee = false;
let dernierMessage = "";
let reessaiPlanifie = false;

function planifierReessai() {
  if (reessaiPlanifie) return;
  reessaiPlanifie = true;
  setTimeout(() => {
    reessaiPlanifie = false;
    connecterLaBase();
  }, 2000);
}

pool.on("error", (err) => {
  console.error("Base : connexion perdue (" + err.message + ")");
  baseConnectee = false;
  planifierReessai();
});

// Crée les tables, met à jour les sites, ajoute les exemples protégés manquants.
// Si la base n'est pas joignable, on réessaie toutes les 2 secondes.
async function connecterLaBase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sites_touristiques (
        id serial PRIMARY KEY,
        nom text NOT NULL UNIQUE,
        region text NOT NULL,
        description text NOT NULL,
        prix_fcfa integer NOT NULL CHECK (prix_fcfa >= 0),
        capacite_jour integer NOT NULL CHECK (capacite_jour > 0)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reservations_visites (
        id serial PRIMARY KEY,
        code text NOT NULL UNIQUE,
        site_id integer NOT NULL REFERENCES sites_touristiques(id),
        jour date NOT NULL,
        heure time NOT NULL,
        personnes integer NOT NULL CHECK (personnes BETWEEN 1 AND ${MAX_PERSONNES}),
        protegee boolean NOT NULL DEFAULT false,
        cree_le timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const s of SITES) {
      await pool.query(
        `INSERT INTO sites_touristiques (nom, region, description, prix_fcfa, capacite_jour)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (nom) DO UPDATE SET
           region = EXCLUDED.region,
           description = EXCLUDED.description,
           prix_fcfa = EXCLUDED.prix_fcfa,
           capacite_jour = EXCLUDED.capacite_jour`,
        s
      );
    }

    for (const r of RESERVATIONS_DE_DEPART) {
      await pool.query(
        `INSERT INTO reservations_visites (code, site_id, jour, heure, personnes, protegee)
         SELECT $1::text, id, $3::date, $4::time, $5::int, true
         FROM sites_touristiques WHERE nom = $2::text
         ON CONFLICT (code) DO NOTHING`,
        r
      );
    }

    baseConnectee = true;
    dernierMessage = "";
    console.log("Base : connectée");
  } catch (err) {
    baseConnectee = false;
    const message = "Base : non connectée (" + err.message + "), nouvel essai toutes les 2 s";
    if (message !== dernierMessage) console.log(message);
    dernierMessage = message;
    planifierReessai();
  }
}

// ----- Outils ---------------------------------------------------------------

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sans 0, 1, I, O

function genererCode() {
  let code = "";
  for (const octet of crypto.randomBytes(6)) code += ALPHABET[octet % ALPHABET.length];
  return "CM-" + code;
}

// Date du jour au Cameroun, au format AAAA-MM-JJ.
function aujourdhui() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Africa/Douala" });
}

function dateValide(texte) {
  if (typeof texte !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(texte)) return false;
  const d = new Date(texte + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texte;
}

function heureValide(texte) {
  return (
    typeof texte === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(texte) &&
    texte >= HEURE_MIN &&
    texte <= HEURE_MAX
  );
}

// Places restantes pour un site un jour donné (db = pool ou client de transaction).
async function placesRestantes(db, siteId, jour) {
  const { rows } = await db.query(
    `SELECT s.capacite_jour AS capacite, COALESCE(SUM(r.personnes), 0)::int AS prises
     FROM sites_touristiques s
     LEFT JOIN reservations_visites r ON r.site_id = s.id AND r.jour = $2
     WHERE s.id = $1
     GROUP BY s.id`,
    [siteId, jour]
  );
  if (rows.length === 0) return null;
  return {
    capacite: rows[0].capacite,
    prises: rows[0].prises,
    restantes: rows[0].capacite - rows[0].prises,
  };
}

const SELECT_RESERVATION = `
  SELECT r.id, r.code, s.id AS site_id, s.nom AS lieu, s.region,
         to_char(r.jour, 'YYYY-MM-DD') AS jour,
         to_char(r.heure, 'HH24:MI') AS heure,
         r.personnes,
         (r.personnes * s.prix_fcfa) AS total_fcfa,
         r.protegee
  FROM reservations_visites r
  JOIN sites_touristiques s ON s.id = r.site_id`;

function exigerBase(req, res, next) {
  if (!baseConnectee) return res.status(503).json({ erreur: "base non connectée" });
  next();
}

// ----- Application ----------------------------------------------------------

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// État de l'application ("conteneur" = identifiant du conteneur Docker).
app.get("/api/sante", (req, res) => {
  res.json({
    api: "ok",
    base: baseConnectee ? "connectée" : "non connectée",
    conteneur: os.hostname(),
  });
});

// Liste des sites touristiques.
app.get("/api/sites", exigerBase, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, nom, region, description, prix_fcfa, capacite_jour FROM sites_touristiques ORDER BY nom"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

// Places restantes d'un site pour un jour : /api/sites/3/disponibilite?jour=2027-02-06
app.get("/api/sites/:id/disponibilite", exigerBase, async (req, res) => {
  const id = Number(req.params.id);
  const jour = req.query.jour;
  if (!Number.isInteger(id)) return res.status(400).json({ erreur: "identifiant de site invalide" });
  if (!dateValide(jour)) return res.status(400).json({ erreur: "jour invalide (format AAAA-MM-JJ)" });
  try {
    const dispo = await placesRestantes(pool, id, jour);
    if (!dispo) return res.status(404).json({ erreur: "site introuvable" });
    res.json({ site_id: id, jour, ...dispo });
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

// Liste des réservations, filtres facultatifs : ?site=3&jour=2027-02-06
app.get("/api/reservations", exigerBase, async (req, res) => {
  const conditions = [];
  const valeurs = [];
  if (req.query.site) {
    const site = Number(req.query.site);
    if (!Number.isInteger(site)) return res.status(400).json({ erreur: "filtre site invalide" });
    valeurs.push(site);
    conditions.push("r.site_id = $" + valeurs.length);
  }
  if (req.query.jour) {
    if (!dateValide(req.query.jour)) return res.status(400).json({ erreur: "filtre jour invalide" });
    valeurs.push(req.query.jour);
    conditions.push("r.jour = $" + valeurs.length);
  }
  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
  try {
    const { rows } = await pool.query(
      SELECT_RESERVATION + where + " ORDER BY r.jour, r.heure, r.id",
      valeurs
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

// Ajouter une réservation : { site_id, jour, heure, personnes }
app.post("/api/reservations", exigerBase, async (req, res) => {
  const { site_id, jour, heure, personnes } = req.body || {};
  const siteId = Number(site_id);
  const nb = Number(personnes);

  if (!Number.isInteger(siteId) || siteId <= 0) {
    return res.status(400).json({ erreur: "site_id obligatoire (voir /api/sites)" });
  }
  if (!dateValide(jour)) {
    return res.status(400).json({ erreur: "jour invalide (format AAAA-MM-JJ)" });
  }
  if (jour < aujourdhui()) {
    return res.status(400).json({ erreur: "le jour ne peut pas être dans le passé" });
  }
  if (!heureValide(heure)) {
    return res.status(400).json({ erreur: `heure invalide (HH:MM, entre ${HEURE_MIN} et ${HEURE_MAX})` });
  }
  if (!Number.isInteger(nb) || nb < 1 || nb > MAX_PERSONNES) {
    return res.status(400).json({ erreur: `personnes doit être un entier entre 1 et ${MAX_PERSONNES}` });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Verrou sur le site : deux réservations simultanées ne peuvent pas dépasser la capacité.
    const site = await client.query("SELECT id FROM sites_touristiques WHERE id = $1 FOR UPDATE", [siteId]);
    if (site.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ erreur: "site introuvable" });
    }

    const dispo = await placesRestantes(client, siteId, jour);
    if (nb > dispo.restantes) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        erreur: "pas assez de places ce jour-là (" + dispo.restantes + " restantes)",
        restantes: dispo.restantes,
      });
    }

    let id = null;
    for (let essai = 0; essai < 5 && id === null; essai++) {
      try {
        await client.query("SAVEPOINT insertion");
        const r = await client.query(
          "INSERT INTO reservations_visites (code, site_id, jour, heure, personnes) VALUES ($1, $2, $3, $4, $5) RETURNING id",
          [genererCode(), siteId, jour, heure, nb]
        );
        id = r.rows[0].id;
      } catch (err) {
        if (err.code !== "23505") throw err; // code déjà pris : on retente avec un autre
        await client.query("ROLLBACK TO SAVEPOINT insertion");
      }
    }
    if (id === null) throw new Error("impossible de générer un code unique");

    await client.query("COMMIT");
    const { rows } = await pool.query(SELECT_RESERVATION + " WHERE r.id = $1", [id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ erreur: err.message });
  } finally {
    client.release();
  }
});

// Supprimer une réservation (sauf les 5 exemples protégés).
app.delete("/api/reservations/:id", exigerBase, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ erreur: "identifiant invalide" });
  try {
    const { rows } = await pool.query("SELECT protegee FROM reservations_visites WHERE id = $1", [id]);
    if (rows.length === 0) return res.status(404).json({ erreur: "réservation introuvable" });
    if (rows[0].protegee) {
      return res
        .status(403)
        .json({ erreur: "cette réservation d'exemple est protégée et ne peut pas être supprimée" });
    }
    await pool.query("DELETE FROM reservations_visites WHERE id = $1", [id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

// Statistiques globales et par site.
app.get("/api/stats", exigerBase, async (req, res) => {
  try {
    const total = await pool.query(
      `SELECT COUNT(r.id)::int AS reservations,
              COALESCE(SUM(r.personnes), 0)::int AS personnes,
              COALESCE(SUM(r.personnes * s.prix_fcfa), 0)::int AS recettes_fcfa
       FROM reservations_visites r
       JOIN sites_touristiques s ON s.id = r.site_id`
    );
    const parSite = await pool.query(
      `SELECT s.nom AS lieu,
              COUNT(r.id)::int AS reservations,
              COALESCE(SUM(r.personnes), 0)::int AS personnes
       FROM sites_touristiques s
       LEFT JOIN reservations_visites r ON r.site_id = s.id
       GROUP BY s.id
       ORDER BY personnes DESC, s.nom`
    );
    res.json({ ...total.rows[0], par_site: parSite.rows });
  } catch (err) {
    res.status(500).json({ erreur: err.message });
  }
});

// JSON invalide ou autre erreur imprévue : réponse JSON propre.
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ erreur: "requête invalide" });
});

// ----- Démarrage et arrêt ---------------------------------------------------

// Le serveur web démarre tout de suite, la base est tentée en tâche de fond.
const serveur = app.listen(PORT, () => {
  console.log("CamVisit : application démarrée sur le port " + PORT);
  connecterLaBase();
});

// Arrêt propre quand Docker demande au conteneur de s'arrêter (docker stop).
process.on("SIGTERM", () => {
  console.log("CamVisit : arrêt demandé, au revoir");
  serveur.close();
  pool.end().finally(() => process.exit(0));
});