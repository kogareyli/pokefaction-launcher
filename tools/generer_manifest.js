/*
 * Régénère web/files/manifest.json (même chose que generer_manifest.py, sans Python).
 * Pour ajouter un mod : mets le .jar dans web/files/mods/ (ou ajoute-le dans externes.json), puis :
 *   node tools/generer_manifest.js
 * Le plus simple reste l'outil « Envoyer mes modifs PokéFaction » qui fait tout tout seul.
 */
const path = require('path');
const { generer } = require('./lib/manifest');

const { nombre, mo } = generer(path.dirname(__dirname));
console.log(`${nombre} fichiers, ${mo} Mo au total`);
