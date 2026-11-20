/**
 * Instance « SAO » du launcher (2e serveur, Minecraft 1.21.4) : écrit web/files-sao/manifest.json.
 * Eddy (20/11) : « mets tous les mods du dossier que je t'ai envoyé, plus ce que je t'ai demandé, et enlève les mods protégés ;
 * mets aussi les resourcepacks, shaderpacks, config et options.txt ».
 *  - mods, packs de ressources et shaders : liens DIRECTS vers Modrinth (pas de copie chez nous) ; seulement ceux qui y sont publiés ;
 *  - mods et packs de Triggers (tous droits réservés, faits pour leurs plugins) : retirés (liste PROTEGES) ;
 *  - en plus : Serene Seasons + GlitchCore (saisons), notre mod pokefaction-sao (le monde, le ticket de connexion) ;
 *  - config/ et options.txt : copiés depuis l'instance (installés une seule fois : ils sont dans « ignored » de web/instances).
 * node tools/manifest-sao.js "<dossier de l'instance Sword Art Online>" "<jar de pokefaction-sao>"
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const [SOURCE, JAR_SAO] = process.argv.slice(2);
if (!SOURCE || !JAR_SAO) { console.error('usage : node tools/manifest-sao.js <instance> <jar pokefaction-sao>'); process.exit(1); }
const RACINE = path.join(__dirname, '..');
const SORTIE = path.join(RACINE, 'web/files-sao');
const URL_BASE = 'https://raw.githubusercontent.com/kogareyli/pokefaction-launcher/main/web/files-sao/';
const UA = { 'User-Agent': 'pokefaction-launcher-manifest/1.0' };

// mods et packs de Triggers / SAOFR (tous droits réservés, liés à leurs plugins serveur) + ce qui ne sert qu'à eux
const PROTEGES = [/^SAOUI-/, /^sao-ui-lib/, /^saoblessing/, /^saojob/, /^saolabyrinth/, /^altarmod/, /^companionsmod/, /^fracturedwar/,
    /^relmod/, /^trueinvisibility/, /^z-plugin-companion/, /^zap-/, /^meg-client-mod/, /^journeymap-.*-sao\.jar$/, /^mcef-/,
    /^entity_model_features-.*FPSFIX/, /^DistantHorizons-/, /^sao\.zip$/, /^FA_Player-.*SAO/];
// remplacements publics (même mod, version publiée sur Modrinth) et ajouts demandés
const AJOUTS = [
    ['mods', 'journeymap', '1.21.4-6.0.0-beta.47+fabric'],
    ['mods', 'entity-model-features', '3.3.12-fabric-1.21.4'],
    ['mods', 'distanthorizons', '3.3.3-1.21.4'],
    ['mods', 'serene-seasons', '10.4.0.6'],
    ['mods', 'glitchcore', '2.3.0.4'],
    ['resourcepacks', 'enhanced-grass', null],
    ['resourcepacks', 'saturated-grass', null],
    ['resourcepacks', 'kristas-better-walls', null],
    ['shaderpacks', 'pastel-shaders', null],
];
// configs qui ne servent qu'aux mods retirés
const CONFIGS_RETIRES = [/^saoui/, /^questtrackerhud/, /^zsociete/, /^zsorts/, /^mcef/];

const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');
const protege = f => PROTEGES.some(r => r.test(f));
const entrees = [];

async function json(url, opts) { const r = await fetch(url, Object.assign({ headers: UA }, opts)); if (!r.ok) throw new Error(url + ' → ' + r.status); return r.json(); }

(async () => {
    fs.rmSync(SORTIE, { recursive: true, force: true });
    fs.mkdirSync(SORTIE, { recursive: true });

    // 1) fichiers de l'instance retrouvés sur Modrinth par leur empreinte
    const fichiers = [];
    for (const dossier of ['mods', 'resourcepacks', 'shaderpacks']) {
        const d = path.join(SOURCE, dossier);
        for (const f of fs.readdirSync(d)) {
            if (!/\.(jar|zip)$/.test(f)) continue;
            if (protege(f)) { console.log('  retiré (protégé ou remplacé) :', dossier + '/' + f); continue; }
            fichiers.push({ dossier, nom: f, sha: sha1(fs.readFileSync(path.join(d, f))) });
        }
    }
    const trouves = await json('https://api.modrinth.com/v2/version_files', {
        method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, UA),
        body: JSON.stringify({ hashes: fichiers.map(f => f.sha), algorithm: 'sha1' }),
    });
    for (const f of fichiers) {
        const v = trouves[f.sha];
        if (!v) { console.log('  pas sur Modrinth (non repris) :', f.dossier + '/' + f.nom); continue; }
        const fichier = v.files.find(x => x.hashes.sha1 === f.sha);
        entrees.push({ path: `${f.dossier}/${fichier.filename}`, size: fichier.size, hash: f.sha, url: fichier.url });
    }

    // 2) ajouts et remplacements publics
    for (const [dossier, slug, version] of AJOUTS) {
        const filtre = dossier === 'mods' ? '&loaders=["fabric"]' : '';
        const versions = await json(`https://api.modrinth.com/v2/project/${slug}/version?game_versions=["1.21.4"]${filtre}`);
        const v = version ? versions.find(x => x.version_number === version) : versions[0];
        if (!v) { console.log('  introuvable pour 1.21.4 :', slug, version || ''); continue; }
        const fichier = v.files.find(x => x.primary) || v.files[0];
        entrees.push({ path: `${dossier}/${fichier.filename}`, size: fichier.size, hash: fichier.hashes.sha1, url: fichier.url });
    }

    // 3) notre mod (hébergé sur GitHub)
    const jar = fs.readFileSync(JAR_SAO), nomJar = path.basename(JAR_SAO);
    fs.mkdirSync(path.join(SORTIE, 'mods'), { recursive: true });
    fs.writeFileSync(path.join(SORTIE, 'mods', nomJar), jar);
    entrees.push({ path: 'mods/' + nomJar, size: jar.length, hash: sha1(jar), url: URL_BASE + 'mods/' + encodeURIComponent(nomJar) });

    // 4) config/ et options.txt de l'instance (copiés chez nous)
    const copier = (rel) => {
        const src = path.join(SOURCE, rel), dst = path.join(SORTIE, rel), b = fs.readFileSync(src);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, b);
        entrees.push({ path: rel.replace(/\\/g, '/'), size: b.length, hash: sha1(b), url: URL_BASE + rel.split(/[\\/]/).map(encodeURIComponent).join('/') });
    };
    const parcourir = (rel) => {
        for (const f of fs.readdirSync(path.join(SOURCE, rel))) {
            const r = path.join(rel, f);
            if (rel === 'config' && CONFIGS_RETIRES.some(x => x.test(f))) { console.log('  config retirée :', r); continue; }
            if (fs.statSync(path.join(SOURCE, r)).isDirectory()) parcourir(r); else copier(r);
        }
    };
    parcourir('config');
    // options.txt : les packs de ressources = ceux qu'on installe vraiment (sans le pack de Triggers)
    let o = fs.readFileSync(path.join(SOURCE, 'options.txt'), 'utf8');
    const packs = entrees.filter(e => e.path.startsWith('resourcepacks/')).map(e => 'file/' + e.path.slice('resourcepacks/'.length));
    o = o.replace(/^resourcePacks:.*$/m, 'resourcePacks:' + JSON.stringify(['vanilla', 'fabric', ...packs]));
    o = o.replace(/^lastServer:.*$/m, 'lastServer:');
    fs.writeFileSync(path.join(SORTIE, 'options.txt'), o);
    const ob = Buffer.from(o);
    entrees.push({ path: 'options.txt', size: ob.length, hash: sha1(ob), url: URL_BASE + 'options.txt' });

    entrees.sort((a, b) => a.path.localeCompare(b.path));
    fs.writeFileSync(path.join(SORTIE, 'manifest.json'), JSON.stringify(entrees, null, 1));
    const n = d => entrees.filter(e => e.path.startsWith(d + '/')).length;
    console.log(`manifest SAO : ${entrees.length} fichiers (${n('mods')} mods, ${n('resourcepacks')} packs, ${n('shaderpacks')} shaders, ${n('config')} configs + options.txt)`);
})().catch(e => { console.error('ERREUR', e.message); process.exit(1); });
