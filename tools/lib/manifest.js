/*
 * Génère web/files/manifest.json : la liste de TOUS les fichiers du modpack que le launcher télécharge.
 * - tools/externes.json : fichiers téléchargés directement depuis CurseForge / Modrinth
 * - web/files/...       : fichiers hébergés dans ce dépôt GitHub
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const sha1 = data => crypto.createHash('sha1').update(data).digest('hex');

// Même encodage que urllib.parse.quote de Python (les / restent tels quels).
const encoder = rel => rel.split('/')
    .map(p => encodeURIComponent(p).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()))
    .join('/');

function generer(racine) {
    const FILES = path.join(racine, 'web', 'files');
    const baseUrl = JSON.parse(fs.readFileSync(path.join(racine, 'package.json'), 'utf8')).url.replace(/\/+$/, '') + '/files/';
    const entrees = JSON.parse(fs.readFileSync(path.join(racine, 'tools', 'externes.json'), 'utf8'));
    const vus = new Set(entrees.map(e => e.path));

    (function parcourir(dossier) {
        for (const nom of fs.readdirSync(dossier).sort()) {
            const complet = path.join(dossier, nom);
            if (fs.statSync(complet).isDirectory()) { parcourir(complet); continue; }
            const rel = path.relative(FILES, complet).split(path.sep).join('/');
            if (rel === 'manifest.json' || vus.has(rel)) continue;
            const data = fs.readFileSync(complet);
            entrees.push({ path: rel, size: data.length, hash: sha1(data), url: baseUrl + encoder(rel) });
        }
    })(FILES);

    entrees.sort((a, b) => {
        const x = a.path.toLowerCase(), y = b.path.toLowerCase();
        return x < y ? -1 : x > y ? 1 : 0;
    });
    fs.writeFileSync(path.join(FILES, 'manifest.json'), JSON.stringify(entrees, null, 1));
    return { nombre: entrees.length, mo: Math.round(entrees.reduce((s, e) => s + e.size, 0) / 1024 / 1024) };
}

module.exports = { generer, sha1 };
