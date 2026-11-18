/**
 * 3.5.1 (Eddy : « le lancement du jeu, que ce soit plus rapide, la préparation ») : à chaque clic sur Jouer, la bibliothèque
 * de lancement relisait en entier les ~340 fichiers du jeu (plus de 500 Mo) pour calculer leur empreinte SHA-1 et la
 * comparer au modpack. Sur un disque dur, c'est le plus long de la « vérification des fichiers ».
 * Ici on garde l'empreinte de chaque fichier avec sa taille et sa date de modification : tant que ni l'une ni l'autre ne
 * change, on ne relit pas le fichier. Un fichier modifié, remplacé ou retéléchargé est relu normalement.
 * (Le serveur vérifie de son côté l'empreinte des mods au moment où le jeu se connecte : ce raccourci ne laisse rien passer.)
 */
const fs = require('fs')
const path = require('path')

/**
 * Branche le cache sur la bibliothèque de lancement.
 * @param {string} dossier  dossier de données du launcher (le cache y est rangé : empreintes-launcher.json)
 * @returns {() => void}    à appeler quand la vérification est finie : enregistre le cache s'il a changé
 */
export function accelererVerification(dossier) {
    let outils
    try {
        outils = require(path.join(path.dirname(require.resolve('minecraft-java-core')), 'utils', 'Index.js'))
    } catch (e) {
        console.warn('Cache des empreintes indisponible :', e.message)
        return () => { }
    }
    if (typeof outils.getFileHash !== 'function') return () => { }
    const fichier = path.join(dossier, 'empreintes-launcher.json')
    let cache = {}
    try { cache = JSON.parse(fs.readFileSync(fichier, 'utf8')) || {} } catch { cache = {} }
    const origine = outils.__pfOrigine || outils.getFileHash
    outils.__pfOrigine = origine
    let change = false, evites = 0
    outils.getFileHash = async (chemin, algo = 'sha1') => {
        if (algo !== 'sha1') return origine(chemin, algo)
        let etat
        try { etat = fs.statSync(chemin) } catch { return origine(chemin, algo) }
        const connu = cache[chemin], date = Math.round(etat.mtimeMs)
        if (connu && connu.t === etat.size && connu.m === date && typeof connu.h === 'string') { evites++; return connu.h }
        const h = await origine(chemin, algo)
        cache[chemin] = { t: etat.size, m: date, h }
        change = true
        return h
    }
    return () => {
        if (evites) console.log(`Vérification : ${evites} fichier(s) inchangé(s), pas relus`)
        if (!change) return
        change = false
        // on oublie les fichiers qui n'existent plus (anciennes versions de mods)
        for (const c of Object.keys(cache)) if (!fs.existsSync(c)) delete cache[c]
        try { fs.writeFileSync(fichier, JSON.stringify(cache)) } catch (e) { console.warn('Cache des empreintes pas enregistré :', e.message) }
    }
}
