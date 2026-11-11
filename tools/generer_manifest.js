/*
 * Génère web/files/manifest.json : la liste de TOUS les fichiers du modpack que le launcher télécharge.
 * (Même chose que generer_manifest.py, mais sans avoir besoin d'installer Python.)
 *
 * - tools/externes.json : fichiers téléchargés directement depuis CurseForge / Modrinth (mods, packs...)
 * - web/files/...       : fichiers hébergés dans ce dépôt GitHub (configs, datapacks, packs persos...)
 *
 * Pour ajouter un mod : mets le .jar dans web/files/mods/ (ou ajoute-le dans externes.json),
 * puis lance :  node tools/generer_manifest.js
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const FILES = path.join(ROOT, 'web', 'files');

const baseUrl = require(path.join(ROOT, 'package.json')).url.replace(/\/+$/, '') + '/files/';
const entries = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'externes.json'), 'utf8'));
const seen = new Set(entries.map(e => e.path));

function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) { walk(full); continue; }
        const rel = path.relative(FILES, full).split(path.sep).join('/');
        if (rel === 'manifest.json' || seen.has(rel)) continue;
        const data = fs.readFileSync(full);
        entries.push({
            path: rel,
            size: data.length,
            hash: crypto.createHash('sha1').update(data).digest('hex'),
            // même encodage que urllib.parse.quote (les / restent tels quels)
            url: baseUrl + rel.split('/').map(p => encodeURIComponent(p).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join('/'),
        });
    }
}
walk(FILES);

entries.sort((a, b) => {
    const x = a.path.toLowerCase(), y = b.path.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
});
fs.writeFileSync(path.join(FILES, 'manifest.json'), JSON.stringify(entries, null, 1));

const total = entries.reduce((s, e) => s + e.size, 0) / 1024 / 1024;
console.log(`${entries.length} fichiers, ${Math.round(total)} Mo au total`);
