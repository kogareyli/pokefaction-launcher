// Instance « PokeFaction-Test » (2e case du rail, Eddy et xkeijiro seulement) : refait web/files-test/manifest.json
// à partir du jeu de PokéFaction Test (Bureau\PokeFaction-Test\client, sa liste = web\files\manifest.json du test,
// refaite par outils\mettre-mod.js).
//  - fichier identique (même SHA-1) déjà dans le vrai launcher → même lien (CurseForge, Modrinth ou GitHub) ;
//  - mod trouvé sur Modrinth par son SHA-1 → lien Modrinth ;
//  - sinon → copié dans web/files-test/ (hébergé sur GitHub, comme web/files).
//   node tools/manifest-test.js            (puis commit + push de web/files-test)
const fs = require('fs'), path = require('path');
const RACINE = path.resolve(__dirname, '..');
const TEST = 'C:/Users/koga/Desktop/PokeFaction-Test';
const SORTIE = path.join(RACINE, 'web', 'files-test');
// propres au PC ou à la partie de celui qui teste : jamais publiés (empreinte Sodium = PC + compte, favoris, variables)
const EXCLUS = new Set(['config/sodium-fingerprint.json', 'config/fancymenu/user_variables.db', 'config/roughlyenoughitems/favorites.json5',
    'config/roughlyenoughitems/hints.json', 'config/etf_warnings.json']);
const BRUT = 'https://raw.githubusercontent.com/kogareyli/pokefaction-launcher/main/web/files-test/';

async function modrinth(sha1) {
    try {
        const r = await fetch(`https://api.modrinth.com/v2/version_file/${sha1}?algorithm=sha1`, { headers: { 'User-Agent': 'pokefaction-launcher/manifest-test' } });
        if (!r.ok) return null;
        const v = await r.json();
        const f = (v.files || []).find(x => x.hashes?.sha1 === sha1);
        return f?.url || null;
    } catch { return null; }
}

(async () => {
    const test = JSON.parse(fs.readFileSync(path.join(TEST, 'web', 'files', 'manifest.json'), 'utf8'));
    const vrai = JSON.parse(fs.readFileSync(path.join(RACINE, 'web', 'files', 'manifest.json'), 'utf8'));
    const parHash = new Map(vrai.map(f => [f.hash, f.url]));
    const sortie = [];
    let memes = 0, mr = 0, heberges = 0, octets = 0;
    const gardes = new Set();
    for (const f of test) {
        if (EXCLUS.has(f.path)) continue;
        let url = parHash.get(f.hash);
        if (url) memes++;
        else if (f.path.startsWith('mods/') && (url = await modrinth(f.hash))) mr++;
        else {
            const src = path.join(TEST, 'client', f.path), dest = path.join(SORTIE, f.path);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(src, dest);
            gardes.add(path.normalize(dest));
            url = BRUT + f.path.split('/').map(encodeURIComponent).join('/');
            heberges++; octets += f.size;
        }
        sortie.push({ path: f.path, size: f.size, hash: f.hash, url });
    }
    // ce qui n'est plus dans le jeu de test est retiré de web/files-test
    const nettoyer = d => { if (!fs.existsSync(d)) return; for (const n of fs.readdirSync(d)) { const c = path.join(d, n);
        if (fs.statSync(c).isDirectory()) { nettoyer(c); if (!fs.readdirSync(c).length) fs.rmdirSync(c); }
        else if (n !== 'manifest.json' && !gardes.has(path.normalize(c))) fs.unlinkSync(c); } };
    nettoyer(SORTIE);
    fs.mkdirSync(SORTIE, { recursive: true });
    fs.writeFileSync(path.join(SORTIE, 'manifest.json'), JSON.stringify(sortie, null, 1));
    console.log(`manifest test : ${sortie.length} fichiers — ${memes} comme le vrai launcher, ${mr} Modrinth, ${heberges} hébergés (${(octets / 1e6).toFixed(1)} Mo)`);
})();
