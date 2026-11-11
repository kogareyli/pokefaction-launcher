/*
 * Calcule ce qu'il faut changer pour que le serveur et le launcher soient pareils que l'instance CurseForge.
 * Fonction pure : elle ne touche à aucun fichier, elle renvoie juste le plan.
 */

const DOSSIERS_SYNCHRO = ['mods/', 'resourcepacks/', 'shaderpacks/'];

function estExclu(chemin, exclusions) {
    return exclusions.some(x => (x.endsWith('/') ? chemin.startsWith(x) : chemin === x));
}

/**
 * @param o.instance        Map chemin → { sha1, size }  (mods/, resourcepacks/, shaderpacks/ de l'instance)
 * @param o.manifest        entrées actuelles du manifest du launcher [{ path, hash, size, url }]
 * @param o.serveurMods     Map nomDuJar → sha1  (dossier mods du serveur)
 * @param o.reglages        Map 'config/…' → sha1  (réglages actuels de l'instance)
 * @param o.reglagesAvant   Map 'config/…' → sha1, ou null au tout premier lancement
 * @param o.reglagesServeur Set des 'config/…' qui existent sur le serveur
 * @param o.exclusions      chemins jamais envoyés ('dossier/' = tout le dossier)
 */
function planifier(o) {
    const exclusions = o.exclusions || [];
    const plan = {
        launcher: { ajouter: [], modifier: [], retirer: [] },
        serveur: { ajouter: [], modifier: [], retirer: [] },
        reglages: { launcherAjouter: [], launcherModifier: [], serveur: [] },
        premiereFois: o.reglagesAvant == null,
    };

    // 1) Mods + packs : instance ↔ launcher
    const dansManifest = new Map();
    for (const e of o.manifest) {
        if (DOSSIERS_SYNCHRO.some(d => e.path.startsWith(d)) && !estExclu(e.path, exclusions)) dansManifest.set(e.path, e);
    }
    for (const [chemin, f] of o.instance) {
        if (estExclu(chemin, exclusions)) continue;
        const e = dansManifest.get(chemin);
        if (!e) plan.launcher.ajouter.push(chemin);
        else if (e.hash !== f.sha1) plan.launcher.modifier.push(chemin);
    }
    for (const chemin of dansManifest.keys()) {
        if (!o.instance.has(chemin)) plan.launcher.retirer.push(chemin);
    }

    // 2) Mods : instance ↔ serveur
    const modsInstance = new Map();
    for (const [chemin, f] of o.instance) {
        if (chemin.startsWith('mods/') && !estExclu(chemin, exclusions)) modsInstance.set(chemin.slice(5), f.sha1);
    }
    for (const [nom, sha1] of modsInstance) {
        if (!o.serveurMods.has(nom)) plan.serveur.ajouter.push(nom);
        else if (o.serveurMods.get(nom) !== sha1) plan.serveur.modifier.push(nom);
    }
    for (const nom of o.serveurMods.keys()) {
        if (!modsInstance.has(nom)) plan.serveur.retirer.push(nom);
    }

    // 3) Réglages : seulement ceux modifiés depuis le dernier envoi
    if (o.reglagesAvant) {
        const reglagesLauncher = new Set(o.manifest.filter(e => e.path.startsWith('config/')).map(e => e.path));
        for (const [chemin, sha1] of o.reglages) {
            if (estExclu(chemin, exclusions)) continue;
            if (o.reglagesAvant.get(chemin) === sha1) continue;
            if (reglagesLauncher.has(chemin)) plan.reglages.launcherModifier.push(chemin);
            else plan.reglages.launcherAjouter.push(chemin);
            if (o.reglagesServeur.has(chemin)) plan.reglages.serveur.push(chemin);
        }
    }

    for (const groupe of [plan.launcher, plan.serveur, plan.reglages]) {
        for (const k of Object.keys(groupe)) groupe[k].sort((a, b) => a.localeCompare(b));
    }
    return plan;
}

function planVide(plan) {
    return [plan.launcher, plan.serveur, plan.reglages].every(g => Object.values(g).every(l => l.length === 0));
}

module.exports = { planifier, planVide, estExclu, DOSSIERS_SYNCHRO };
