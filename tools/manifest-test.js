// Instance « PokeFaction-Test » (2e case du rail, Eddy et xkeijiro seulement) : refait web/files-test/manifest.json
// = COPIE COMPLÈTE du jeu de PokéFaction Test (Bureau\PokeFaction-Test\client) : mods, TOUS les réglages (config, touches,
// options.txt en français), packs de ressources, shaders, datapacks (Eddy, 21/11 : « mets tous les settings, copie le fichier total »).
//  - fichier identique (même SHA-1) déjà dans le vrai launcher → même lien (CurseForge, Modrinth ou GitHub) ;
//  - fichier installé par CurseForge (minecraftinstance.json, même nom et même taille) → lien CurseForge ;
//  - mod trouvé sur Modrinth par son SHA-1 → lien Modrinth ;
//  - sinon → copié dans web/files-test/ (hébergé sur GitHub, 95 Mo au plus par fichier).
// Jamais : l'empreinte Sodium (PC + compte), les variables FancyMenu, la bande-son COBBLEVERSE (179 Mo, ni CurseForge ni GitHub).
//   node tools/manifest-test.js            (puis commit + push de web/files-test)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const RACINE = path.resolve(__dirname, '..');
const CLIENT = 'C:/Users/koga/Desktop/PokeFaction-Test/client';
const SORTIE = path.join(RACINE, 'web', 'files-test');
const BRUT = 'https://raw.githubusercontent.com/kogareyli/pokefaction-launcher/main/web/files-test/';
const DOSSIERS = ['mods', 'config', 'datapacks', 'resourcepacks', 'shaderpacks'];
const EXCLUS = new Set(['config/sodium-fingerprint.json', 'config/fancymenu/user_variables.db', 'resourcepacks/COBBLEVERSE Soundtrack.zip']);
// licence de Complementary et d'Euphoria Patches : pas de téléchargement direct (seulement CurseForge / Modrinth)
const DOSSIERS_EXCLUS = ['shaderpacks/COBBLEVERSE - Shaders/', 'shaderpacks/COBBLEVERSE - Shaders (High Quality)/'];
const MAX = 95e6;

async function modrinth(sha1) {
    try {
        const r = await fetch(`https://api.modrinth.com/v2/version_file/${sha1}?algorithm=sha1`, { headers: { 'User-Agent': 'pokefaction-launcher/manifest-test' } });
        if (!r.ok) return null;
        const v = await r.json();
        return (v.files || []).find(x => x.hashes?.sha1 === sha1)?.url || null;
    } catch { return null; }
}

function lister(dossier, base) {
    const res = [];
    if (!fs.existsSync(dossier)) return res;
    for (const nom of fs.readdirSync(dossier)) {
        const complet = path.join(dossier, nom), rel = `${base}/${nom}`;
        if (fs.statSync(complet).isDirectory()) res.push(...lister(complet, rel));
        else res.push(rel);
    }
    return res;
}

(async () => {
    const vrai = JSON.parse(fs.readFileSync(path.join(RACINE, 'web', 'files', 'manifest.json'), 'utf8'));
    const parHash = new Map(vrai.map(f => [f.hash, f.url]));
    // liens CurseForge du jeu de test (packs, shaders, mods installés par CurseForge)
    const curse = new Map();
    try {
        for (const a of JSON.parse(fs.readFileSync(path.join(CLIENT, 'minecraftinstance.json'), 'utf8')).installedAddons || []) {
            const f = a.installedFile || {};
            if (f.fileNameOnDisk && f.downloadUrl) curse.set(`${f.fileNameOnDisk}|${f.fileLength}`, f.downloadUrl);
        }
    } catch { }
    const rels = [];
    for (const d of DOSSIERS) rels.push(...lister(path.join(CLIENT, d), d));
    rels.push('options.txt');
    // petits réglages hors des dossiers habituels (Eddy : « mets tout le dossier de test »)
    for (const r of lister(path.join(CLIENT, 'cobblenav', 'settings'), 'cobblenav/settings')) rels.push(r);
    if (fs.existsSync(path.join(CLIENT, 'data', 'fabricDefaultResourcePacks.dat'))) rels.push('data/fabricDefaultResourcePacks.dat');
    const sortie = [], gardes = new Set();
    let memes = 0, cf = 0, mr = 0, heberges = 0, octets = 0, sautes = [];
    for (const rel of rels) {
        if (EXCLUS.has(rel) || DOSSIERS_EXCLUS.some(d => rel.startsWith(d))) continue;
        let data = fs.readFileSync(path.join(CLIENT, rel));
        // le jeu de test est en anglais sur le PC : la copie publiée est en français
        if (rel === 'options.txt') data = Buffer.from(data.toString('utf8').replace(/^lang:.*$/m, 'lang:fr_fr')
            .replace(/^guiScale:.*$/m, 'guiScale:3'), 'utf8'); // 21/11 : « Auto » = interface énorme sur grand écran (taille du vrai jeu d'Eddy)
        const hash = crypto.createHash('sha1').update(data).digest('hex');
        let url = parHash.get(hash);
        if (url) memes++;
        else if ((url = curse.get(`${path.basename(rel)}|${data.length}`))) cf++;
        else if (rel.startsWith('mods/') && (url = await modrinth(hash))) mr++;
        else if (data.length > MAX) { sautes.push(rel); continue; }
        else {
            const dest = path.join(SORTIE, rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, data);
            gardes.add(path.normalize(dest));
            url = BRUT + rel.split('/').map(encodeURIComponent).join('/');
            heberges++; octets += data.length;
        }
        sortie.push({ path: rel, size: data.length, hash, url });
    }
    // ce qui n'est plus dans le jeu de test est retiré de web/files-test
    const nettoyer = d => { if (!fs.existsSync(d)) return; for (const n of fs.readdirSync(d)) { const c = path.join(d, n);
        if (fs.statSync(c).isDirectory()) { nettoyer(c); if (!fs.readdirSync(c).length) fs.rmdirSync(c); }
        else if (n !== 'manifest.json' && !gardes.has(path.normalize(c))) fs.unlinkSync(c); } };
    nettoyer(SORTIE);
    fs.mkdirSync(SORTIE, { recursive: true });
    fs.writeFileSync(path.join(SORTIE, 'manifest.json'), JSON.stringify(sortie, null, 1));
    console.log(`manifest test : ${sortie.length} fichiers — ${memes} comme le vrai launcher, ${cf} CurseForge, ${mr} Modrinth, ${heberges} hébergés (${(octets / 1e6).toFixed(1)} Mo)`
        + (sautes.length ? ` ; trop gros, pas publiés : ${sautes.join(', ')}` : ''));
})();
