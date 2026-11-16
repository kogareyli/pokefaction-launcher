/**
 * Anti-triche PokéFaction, côté launcher (4.2) : au clic sur Jouer, analyse visible du dossier du jeu.
 *  - Packs de ressources x-ray (nom, ou pierre/deepslate… remplacées par un modèle vide) : déplacés dans
 *    « resourcepacks-retires » (le joueur les retrouve, mais ils ne sont plus dans le jeu).
 *  - Luminosité trafiquée dans options.txt (gamma au-dessus de 100 % = « fullbright ») : remise à 100 %.
 * Les mods en trop sont déjà effacés par la vérification des fichiers du launcher, et le jeu lui-même est surveillé
 * pendant toute la partie par le mod PokéFaction (rapport au serveur toutes les 2 minutes).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BLOCS = ['stone', 'deepslate', 'netherrack', 'tuff', 'andesite', 'diorite', 'granite', 'dirt'];
const NOMS = /x[\s_-]?ray|ore[\s_-]?finder|xray/i;

// --- lecture .zip minimale (comme tools/lib/zip.js, sans dépendance)
function entreesZip(buf) {
    const min = Math.max(0, buf.length - 22 - 0xffff);
    let fin = -1;
    for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
    if (fin < 0) return [];
    const nb = buf.readUInt16LE(fin + 10);
    let pos = buf.readUInt32LE(fin + 16);
    const entrees = [];
    for (let i = 0; i < nb && buf.readUInt32LE(pos) === 0x02014b50; i++) {
        const lgNom = buf.readUInt16LE(pos + 28);
        entrees.push({
            // certains outils (PowerShell 5) écrivent les chemins avec « \ »
            nom: buf.toString('utf8', pos + 46, pos + 46 + lgNom).replace(/\\/g, '/'), methode: buf.readUInt16LE(pos + 10),
            taille: buf.readUInt32LE(pos + 20), offset: buf.readUInt32LE(pos + 42),
        });
        pos += 46 + lgNom + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
    }
    return entrees;
}
function lireZip(buf, e) {
    const p = e.offset;
    const debut = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
    const d = buf.subarray(debut, debut + e.taille);
    return e.methode === 8 ? zlib.inflateRawSync(d) : Buffer.from(d);
}

/** Un modèle ou un état de bloc qui rend le bloc invisible ? */
function modeleVide(texte) {
    let m;
    try { m = JSON.parse(texte); } catch { return false; }
    const t = JSON.stringify(m).toLowerCase();
    if (m.elements && Array.isArray(m.elements) && m.elements.length === 0) return true;
    if (!m.parent && !m.elements && !m.variants && !m.multipart) return true;
    return /"(minecraft:)?block\/air"|xray|invisible/.test(t);
}

/** Raison pour laquelle ce pack est un x-ray, ou null. */
function packXray(chemin, nom) {
    if (NOMS.test(nom)) return 'nom du pack';
    const fichiers = [];
    for (const b of BLOCS) fichiers.push(`assets/minecraft/models/block/${b}.json`, `assets/minecraft/blockstates/${b}.json`);
    try {
        if (fs.statSync(chemin).isDirectory()) {
            for (const f of fichiers) {
                const p = path.join(chemin, f);
                if (fs.existsSync(p) && modeleVide(fs.readFileSync(p, 'utf8'))) return 'bloc invisible (' + path.basename(f) + ')';
            }
        } else if (/\.zip$/i.test(nom)) {
            const buf = fs.readFileSync(chemin);
            for (const e of entreesZip(buf)) {
                if (fichiers.includes(e.nom) && modeleVide(lireZip(buf, e).toString('utf8'))) return 'bloc invisible (' + path.basename(e.nom) + ')';
            }
        }
    } catch { /* pack illisible : ignoré */ }
    return null;
}

// Mods et clients de triche connus (nom du fichier .jar, ou dossier laissé par le client dans le jeu)
const TRICHE = /meteor|wurst|aristois|liquidbounce|baritone|xray|x-ray|freecam|bleachhack|thunderhack|boze|coffee|rusherhack|kamiblue|impact|inertia|killaura|autoclicker|seedcracker|sigma|lambda/i;
const DOSSIERS_TRICHE = ['meteor-client', 'wurst', 'baritone', 'LiquidBounce', 'liquidbounce', 'aristois', 'thunderhack', 'bleachhack', 'boze', 'rusherhack'];

const pause = ms => new Promise(r => setTimeout(r, ms));

/**
 * Analyse le dossier du jeu, étape par étape. etape({ texte, pct, fait, corrige }) affiche l'avancement (fenêtre
 * « PokéFaction Anti-Cheat » et barre du launcher). Renvoie ce qui a été corrigé, vide si tout va bien.
 */
export async function analyserJeu(dossierInstance, etape) {
    const debut = Date.now();
    const corrige = [];
    const signaler = (texte, pct, fait, estCorrige) => { try { etape({ texte, pct, fait, corrige: estCorrige }); } catch { } };
    const quarantaine = nom => { const d = path.join(dossierInstance, nom); fs.mkdirSync(d, { recursive: true }); return d; };

    // 1. Mods : un .jar de triche est retiré (le launcher efface ensuite tout ce qui n'est pas dans le modpack)
    signaler('Vérification des mods…', 8);
    const mods = path.join(dossierInstance, 'mods');
    const jars = fs.existsSync(mods) ? fs.readdirSync(mods).filter(f => /\.jar$/i.test(f)) : [];
    for (const nom of jars) {
        if (!TRICHE.test(nom) || /^pokefaction/i.test(nom)) continue;
        try {
            fs.renameSync(path.join(mods, nom), path.join(quarantaine('mods-retires'), nom));
            corrige.push(`Mod de triche retiré : « ${nom} »`);
        } catch { corrige.push(`Mod de triche trouvé : « ${nom} »`); }
    }
    await pause(350);
    signaler('Vérification des mods…', 25, 'Mods vérifiés');

    // 2. Clients de triche : dossiers qu'ils laissent dans le jeu (signalé seulement : le jeu est surveillé ensuite)
    signaler('Recherche de clients de triche…', 35);
    const traces = DOSSIERS_TRICHE.filter(d => fs.existsSync(path.join(dossierInstance, d)));
    await pause(300);
    signaler('Recherche de clients de triche…', 48, traces.length ? `Traces de ${traces.join(', ')} (surveillé pendant la partie)` : 'Aucun client de triche', traces.length > 0);

    // 3. Packs de ressources x-ray : déplacés dans « resourcepacks-retires »
    const packs = path.join(dossierInstance, 'resourcepacks');
    const liste = fs.existsSync(packs) ? fs.readdirSync(packs) : [];
    let n = 0;
    for (const nom of liste) {
        signaler(`Analyse des packs de ressources… (${++n}/${liste.length})`, 48 + Math.round(32 * n / Math.max(1, liste.length)));
        const raison = packXray(path.join(packs, nom), nom);
        if (raison) {
            try {
                fs.renameSync(path.join(packs, nom), path.join(quarantaine('resourcepacks-retires'), nom));
                corrige.push(`Pack x-ray retiré : « ${nom} » (${raison}), mis dans resourcepacks-retires`);
            } catch { corrige.push(`Pack x-ray trouvé : « ${nom} » (impossible de le déplacer)`); }
        }
        await pause(0);
    }
    await pause(250);
    signaler('Analyse des packs de ressources…', 80, liste.length ? `${liste.length} pack${liste.length > 1 ? 's' : ''} analysé${liste.length > 1 ? 's' : ''}` : 'Aucun pack de ressources');

    // 4. Luminosité : la barre du jeu s'arrête à 100 % (gamma 1.0). Au-dessus = modifié à la main pour voir dans le noir.
    signaler('Vérification des réglages…', 88);
    const options = path.join(dossierInstance, 'options.txt');
    try {
        if (fs.existsSync(options)) {
            const t = fs.readFileSync(options, 'utf8');
            const m = t.match(/^gamma:(.*)$/m);
            if (m && parseFloat(m[1]) > 1.0001) {
                fs.writeFileSync(options, t.replace(/^gamma:.*$/m, 'gamma:1.0'));
                corrige.push(`Luminosité remise à 100 % (elle était à ${Math.round(parseFloat(m[1]) * 100)} %)`);
            }
        }
    } catch { /* options.txt occupé : on laisse, le serveur vérifiera */ }
    await pause(250);
    for (const c of corrige) signaler(null, null, c, true);
    signaler(corrige.length ? 'Problèmes corrigés, lancement du jeu…' : 'Aucune triche détectée · protection active', 100, corrige.length ? null : 'Réglages vérifiés');
    try { etape({ fin: true }); } catch { }
    // L'analyse reste visible au moins ~2,5 s : elle est là pour qu'on la voie (et que ça décourage)
    const reste = 2500 - (Date.now() - debut);
    if (reste > 0) await pause(reste);
    return corrige;
}
