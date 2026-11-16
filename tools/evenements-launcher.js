// Launcher 3.4.0 : planning des événements pour les notifications Windows du launcher.
// Lit les horaires dans la config du serveur (config/pokefaction/config.json) et écrit web/evenements.json.
// Lancé tout seul par envoyer-modifs.js ; à la main : node tools/evenements-launcher.js
'use strict';
const fs = require('fs');
const path = require('path');

const LAUNCHER = path.join(__dirname, '..');
const CONFIG = path.join(LAUNCHER, '../../config/pokefaction/config.json');
const SORTIE = path.join(LAUNCHER, 'web/evenements.json');
const JOURS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const NOMS = {
    chasse_shiny: ['Chasse au shiny', 'Les shiny apparaissent bien plus souvent pendant un moment.'],
    double_xp: ['Double XP', 'Toute l’XP compte double.'],
    course_captures: ['Course aux captures', 'Celui qui capture le plus gagne de l’argent.'],
    survivant: ['PvP : Survivant', 'Chacun pour soi dans l’arène PvP (/pvpevent).'],
    guerre: ['PvP : Guerre des factions', 'Les factions s’affrontent dans l’arène PvP (/pvpevent).'],
};
const hhmm = (h, m) => String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');

function generer() {
    const c = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    const l = [];
    const ajouter = (jours, heure, titre, texte) => { for (const j of jours) l.push({ jour: j, heure, titre, texte }); };
    for (const e of c.evenements || []) { const n = NOMS[e.type] || [e.type.replace(/_/g, ' '), '']; ajouter([e.jour], hhmm(e.heure, e.minute || 0), n[0], n[1]); }
    if (c.evenementsPvpActifs !== false) for (const e of c.evenementsPvp || []) { const n = NOMS[e.type] || ['PvP : ' + e.type, '']; ajouter([e.jour], hhmm(e.heure, e.minute || 0), n[0], n[1]); }
    if (c.rassemblementJour) ajouter([c.rassemblementJour], hhmm(c.rassemblementHeure ?? 21, c.rassemblementMinute ?? 0), 'Grand rassemblement', 'Tout le monde est téléporté : boss géant, chasse et tirage au sort.');
    if (c.raidHeure) ajouter(JOURS.filter(j => j !== 'SATURDAY'), c.raidHeure, 'Raid du soir', 'Un raid à plusieurs commence (/raid).');
    for (const h of c.eventsLobbyHoraires || []) {
        const [heure, type] = h.split('|').map(s => s.trim());
        ajouter(JOURS, heure, type === 'pluie' ? 'Pluie de Poké Balls' : 'Largage au lobby', type === 'pluie' ? 'Des Poké Balls tombent au lobby.' : 'Des tonneaux à ouvrir au lobby (3 par joueur).');
    }
    if (c.objectifHeure) ajouter(c.objectifJours || [], c.objectifHeure, 'Objectif commun', 'Tout le serveur ensemble pour un objectif (/objectif).');
    if (c.tournoiRankedActif && c.tournoiJour) ajouter([c.tournoiJour], c.tournoiHeure, 'Tournoi ranked', 'Inscriptions 15 min avant : /ranked tournoi.');
    if (c.collineHeure) ajouter(c.collineJours || [], c.collineHeure, 'Roi de la colline', 'La faction qui tient la zone gagne de l’argent.');
    if (c.safariJour && c.safariHeure) ajouter([c.safariJour], c.safariHeure, 'Zone Safari', 'Ouverte pour un moment : /safari.');
    l.sort((a, b) => JOURS.indexOf(a.jour) - JOURS.indexOf(b.jour) || a.heure.localeCompare(b.heure));
    const sortie = { _explication: 'Planning de la semaine (heure de Paris) pour les notifications du launcher. Fait par tools/evenements-launcher.js depuis la config du serveur.', evenements: l };
    const texte = JSON.stringify(sortie, null, 2) + '\n';
    const avant = fs.existsSync(SORTIE) ? fs.readFileSync(SORTIE, 'utf8') : '';
    if (texte !== avant) fs.writeFileSync(SORTIE, texte);
    return { n: l.length, change: texte !== avant };
}

module.exports = { generer };
if (require.main === module) {
    const r = generer();
    console.log(`${r.n} événements dans web/evenements.json${r.change ? ' (mis à jour)' : ' (inchangé)'}`);
}
