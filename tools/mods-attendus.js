// Anti-triche 4.2 : liste des mods attendus dans le jeu des joueurs (ids Fabric, jars imbriqués compris),
// tirée des mods de l'instance CurseForge (la référence, comme pour envoyer-modifs).
// Écrit <serveur>/config/pokefaction/mods-attendus.txt : un mod du rapport du jeu absent de cette liste = « suspect »
// dans le panel (pas d'expulsion). Relancé par envoyer-modifs ; à la main : node tools/mods-attendus.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { modsDuJar } = require('./lib/dependances');

const INSTANCE = process.env.POKEFACTION_INSTANCE || path.join(os.homedir(), 'curseforge', 'minecraft', 'Instances', 'Poke');
const SERVEUR = process.env.POKEFACTION_SERVEUR || path.join(__dirname, '..', '..', '..');
// Fournis par Fabric Loader lui-même (pas dans un jar du dossier mods)
const INTEGRES = ['minecraft', 'java', 'fabricloader', 'mixinextras'];

function attendus(dossierMods) {
    const ids = new Set(INTEGRES);
    const illisibles = [];
    for (const nom of fs.readdirSync(dossierMods)) {
        if (!nom.endsWith('.jar')) continue;
        try {
            for (const m of modsDuJar(fs.readFileSync(path.join(dossierMods, nom)), nom)) {
                if (m.id) ids.add(String(m.id).toLowerCase());
                for (const p of m.provides) ids.add(String(p).toLowerCase());
            }
        } catch (e) {
            illisibles.push(nom);
        }
    }
    return { ids: [...ids].sort(), illisibles };
}

if (require.main === module) {
    const { ids, illisibles } = attendus(path.join(INSTANCE, 'mods'));
    const sortie = path.join(SERVEUR, 'config', 'pokefaction', 'mods-attendus.txt');
    fs.mkdirSync(path.dirname(sortie), { recursive: true });
    fs.writeFileSync(sortie, `# Mods attendus dans le jeu des joueurs (fait par tools/mods-attendus.js le ${new Date().toLocaleString('fr-FR')})\n${ids.join('\n')}\n`);
    console.log(`${ids.length} mods attendus → ${sortie}`);
    if (illisibles.length) console.log('Illisibles :', illisibles.join(', '));
}

module.exports = { attendus };
