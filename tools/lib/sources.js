/*
 * Trouve d'où les joueurs vont télécharger un fichier :
 * 1. le lien CurseForge (CurseForge l'enregistre dans minecraftinstance.json),
 * 2. sinon Modrinth (recherche par empreinte SHA-1),
 * 3. sinon le fichier est hébergé dans ce dépôt GitHub (web/files/) s'il n'est pas trop gros.
 * Chaque lien est vérifié (le fichier en ligne doit avoir la bonne taille).
 */
const TAILLE_MAX_GITHUB = 50 * 1024 * 1024; // GitHub refuse > 100 Mo et râle dès 50 Mo
const UA = { 'User-Agent': 'pokefaction-launcher-envoyer-modifs' };

/** Liens CurseForge connus : Map nomDeFichier → url */
function liensCurseForge(minecraftInstance) {
    const liens = new Map();
    for (const a of minecraftInstance.installedAddons || []) {
        const f = a.installedFile || {};
        if (f.fileName && f.downloadUrl) liens.set(f.fileName, f.downloadUrl);
    }
    return liens;
}

/** true si l'URL répond et que le fichier en ligne fait bien `taille` octets. */
async function verifierUrl(url, taille, fetchFn = fetch) {
    try {
        let r = await fetchFn(url, { method: 'HEAD', headers: UA, redirect: 'follow' });
        if (r.status === 403 || r.status === 405) {
            r = await fetchFn(url, { headers: { ...UA, Range: 'bytes=0-0' }, redirect: 'follow' });
            if (!r.ok) return false;
            const cr = r.headers.get('content-range');
            return cr ? Number(cr.split('/')[1]) === taille : false;
        }
        return r.ok && Number(r.headers.get('content-length')) === taille;
    } catch {
        return false;
    }
}

async function lienModrinth(sha1, taille, fetchFn = fetch) {
    try {
        const r = await fetchFn(`https://api.modrinth.com/v2/version_file/${sha1}?algorithm=sha1`, { headers: UA });
        if (!r.ok) return null;
        const v = await r.json();
        const f = (v.files || []).find(x => x.hashes && x.hashes.sha1 === sha1);
        return f && f.size === taille ? f.url : null;
    } catch {
        return null;
    }
}

/**
 * @returns {Promise<{type:'externe', url:string, origine:string} | {type:'heberge'} | {type:'trop-gros'}>}
 */
async function trouverSource({ nomFichier, sha1, taille, curseforge, fetchFn = fetch }) {
    const cf = curseforge.get(nomFichier);
    if (cf && await verifierUrl(cf, taille, fetchFn)) return { type: 'externe', url: cf, origine: 'CurseForge' };
    const mr = await lienModrinth(sha1, taille, fetchFn);
    if (mr && await verifierUrl(mr, taille, fetchFn)) return { type: 'externe', url: mr, origine: 'Modrinth' };
    if (taille <= TAILLE_MAX_GITHUB) return { type: 'heberge' };
    return { type: 'trop-gros' };
}

module.exports = { trouverSource, verifierUrl, liensCurseForge, TAILLE_MAX_GITHUB };
