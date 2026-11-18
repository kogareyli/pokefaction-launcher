/**
 * 3.5.2 (Eddy, 18/11 : « je suis bloqué à "jeu mise à jour 23/23", c'est bizarre de bloquer là ») : à CHAQUE clic sur Jouer,
 * la bibliothèque de lancement redemandait au site de Fabric (meta.fabricmc.net) la liste de ses versions puis la fiche
 * de la nôtre, sans limite de temps. Quand ce site rame, le launcher restait figé après le téléchargement des mods
 * (plus d'une minute le 18/11), puis finissait en erreur.
 * Ici la fiche de Fabric est gardée sur le PC : une fois Fabric installé, plus aucun appel à ce site (la fiche d'une version
 * de Fabric ne change jamais). La toute première fois, ou si la version de Fabric change, on demande au site, 25 s au plus.
 * Un journal des étapes du lancement est écrit à côté (lancement-launcher.txt) pour voir où ça coince si ça recommence.
 */
const fs = require('fs')
const path = require('path')

/** Écrit une ligne horodatée dans le journal des étapes du lancement. */
export function journalLancement(dossier) {
    const fichier = path.join(dossier, 'lancement-launcher.txt')
    try { fs.mkdirSync(dossier, { recursive: true }); fs.writeFileSync(fichier, '') } catch { /* pas grave */ }
    const vus = new Set()
    /** @param {string} texte  @param {boolean} [uneFois] n'écrire cette étape qu'une fois (événements répétés) */
    return (texte, uneFois = false) => {
        if (uneFois) { if (vus.has(texte)) return; vus.add(texte) }
        const h = new Date().toTimeString().slice(0, 8)
        try { fs.appendFileSync(fichier, `[${h}] ${texte}\n`) } catch { /* pas grave */ }
    }
}

/**
 * Branche la fiche de Fabric gardée sur le PC.
 * @param {string} dossier   dossier de données du launcher (fabric-profil.json y est rangé)
 * @param {(texte: string) => void} journal
 */
export function fabricSansAttente(dossier, journal = () => { }) {
    let Fabric
    try {
        Fabric = require(path.join(path.dirname(require.resolve('minecraft-java-core')), 'Minecraft-Loader', 'loader', 'fabric', 'fabric.js')).default
    } catch (e) {
        journal('Fabric : fiche locale indisponible (' + e.message + ')')
        return
    }
    if (!Fabric || !Fabric.prototype || typeof Fabric.prototype.downloadJson !== 'function') return
    const origine = Fabric.prototype.__pfOrigine || Fabric.prototype.downloadJson
    Fabric.prototype.__pfOrigine = origine
    const fichier = path.join(dossier, 'fabric-profil.json')
    Fabric.prototype.downloadJson = async function (Loader) {
        const build = String(this.options?.loader?.build), version = String(this.options?.loader?.version)
        const fixe = build !== 'latest' && build !== 'recommended' // « la dernière » peut changer : on ne la garde pas
        if (fixe) {
            try {
                const c = JSON.parse(fs.readFileSync(fichier, 'utf8'))
                if (c && c.build === build && c.version === version && c.json && Array.isArray(c.json.libraries) && c.json.libraries.length) {
                    journal(`Fabric ${build} : fiche déjà sur le PC, pas d'appel au site de Fabric`)
                    return c.json
                }
            } catch { /* pas encore de fiche */ }
        }
        journal(`Fabric ${build} : demande au site de Fabric…`)
        const debut = Date.now()
        const res = await Promise.race([
            origine.call(this, Loader).catch(e => ({ error: e?.message || String(e) })),
            new Promise(r => setTimeout(() => r({ error: 'le site de Fabric ne répond pas (25 s). Réessaie dans un instant.' }), 25000)),
        ])
        if (res && !res.error && Array.isArray(res.libraries) && res.libraries.length) {
            journal(`Fabric ${build} : fiche reçue en ${((Date.now() - debut) / 1000).toFixed(1)} s`)
            if (fixe) try { fs.writeFileSync(fichier, JSON.stringify({ build, version, json: res })) } catch { /* pas grave */ }
        } else journal(`Fabric ${build} : ${res?.error || 'réponse illisible'}`)
        return res
    }
}
