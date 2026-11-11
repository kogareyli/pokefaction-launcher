/*
 * Vérifie que chaque mod Fabric a bien ses dépendances (« depends » de fabric.mod.json).
 * Exemple réel : logprot a besoin de cupboard ; sans lui, le jeu plante au démarrage.
 */
const zip = require('./zip');

// Fournis par Fabric Loader lui-même.
const INTEGRES = ['minecraft', 'java', 'fabricloader', 'mixinextras'];

function lireJson(texte) {
    try { return JSON.parse(texte); } catch { /* certains mods ont un JSON « laxiste » */ }
    const nettoye = texte
        .replace(/^﻿/, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/[\u0000-\u001f]+/g, ' ')
        .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(nettoye);
}

/** Lit les mods contenus dans un .jar (et ses .jar imbriqués). Renvoie [{ id, nom, depends, provides }]. */
function modsDuJar(buf, chemin = '') {
    const brut = zip.lireFichier(buf, 'fabric.mod.json');
    if (!brut) return [];
    const info = lireJson(brut.toString('utf8'));
    const mods = [{
        id: info.id,
        nom: info.name || info.id,
        depends: Object.keys(info.depends || {}),
        provides: Array.isArray(info.provides) ? info.provides : [],
        chemin,
    }];
    for (const j of info.jars || []) {
        const interne = zip.lireFichier(buf, j.file);
        if (interne) mods.push(...modsDuJar(interne, `${chemin} > ${j.file}`));
    }
    return mods;
}

/**
 * jars : [{ fichier, buf }] → { manquants: [{ fichier, mod, manque }], illisibles: [fichier] }
 */
function verifier(jars) {
    const fournis = new Set(INTEGRES);
    const parFichier = [];
    const illisibles = [];
    for (const { fichier, buf } of jars) {
        let mods;
        try { mods = modsDuJar(buf, fichier); } catch { illisibles.push(fichier); continue; }
        for (const m of mods) {
            fournis.add(m.id);
            m.provides.forEach(p => fournis.add(p));
        }
        parFichier.push({ fichier, mods });
    }
    const manquants = [];
    for (const { fichier, mods } of parFichier) {
        for (const m of mods) {
            for (const d of m.depends) {
                if (!fournis.has(d)) manquants.push({ fichier, mod: m.nom, manque: d });
            }
        }
    }
    return { manquants, illisibles };
}

module.exports = { verifier, modsDuJar, lireJson };
