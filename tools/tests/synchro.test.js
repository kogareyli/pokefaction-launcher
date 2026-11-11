const test = require('node:test');
const assert = require('node:assert');
const { planifier, planVide } = require('../lib/synchro');

const f = sha1 => ({ sha1, size: 1 });
const base = () => ({
    instance: new Map([['mods/a.jar', f('A')], ['mods/b.jar', f('B')], ['resourcepacks/p.zip', f('P')]]),
    manifest: [
        { path: 'mods/a.jar', hash: 'A' }, { path: 'mods/b.jar', hash: 'B' },
        { path: 'resourcepacks/p.zip', hash: 'P' }, { path: 'config/x.json', hash: 'X' },
    ],
    serveurMods: new Map([['a.jar', 'A'], ['b.jar', 'B']]),
    reglages: new Map([['config/x.json', 'X']]),
    reglagesAvant: new Map([['config/x.json', 'X']]),
    reglagesServeur: new Set(['config/x.json']),
    exclusions: [],
});

test('tout est pareil → plan vide', () => {
    assert.ok(planVide(planifier(base())));
});

test('mod ajouté dans CurseForge → ajouté au launcher et au serveur', () => {
    const o = base();
    o.instance.set('mods/c.jar', f('C'));
    const p = planifier(o);
    assert.deepStrictEqual(p.launcher.ajouter, ['mods/c.jar']);
    assert.deepStrictEqual(p.serveur.ajouter, ['c.jar']);
});

test('mod retiré de CurseForge → retiré du launcher et du serveur', () => {
    const o = base();
    o.instance.delete('mods/b.jar');
    const p = planifier(o);
    assert.deepStrictEqual(p.launcher.retirer, ['mods/b.jar']);
    assert.deepStrictEqual(p.serveur.retirer, ['b.jar']);
});

test('mod mis à jour (même nom, contenu différent) → modifié partout', () => {
    const o = base();
    o.instance.set('mods/a.jar', f('A2'));
    const p = planifier(o);
    assert.deepStrictEqual(p.launcher.modifier, ['mods/a.jar']);
    assert.deepStrictEqual(p.serveur.modifier, ['a.jar']);
});

test('pack de textures ajouté → launcher seulement', () => {
    const o = base();
    o.instance.set('resourcepacks/q.zip', f('Q'));
    const p = planifier(o);
    assert.deepStrictEqual(p.launcher.ajouter, ['resourcepacks/q.zip']);
    assert.deepStrictEqual(p.serveur.ajouter, []);
});

test('fichiers exclus (bande-son, dossier de shaders) jamais envoyés ni retirés', () => {
    const o = base();
    o.instance.set('resourcepacks/Soundtrack.zip', f('S'));
    o.instance.set('shaderpacks/Gros/shaders/a.glsl', f('G'));
    o.manifest.push({ path: 'shaderpacks/Gros/vieux.txt', hash: 'V' });
    o.exclusions = ['resourcepacks/Soundtrack.zip', 'shaderpacks/Gros/'];
    assert.ok(planVide(planifier(o)));
});

test('premier lancement : aucun réglage envoyé (on enregistre seulement la référence)', () => {
    const o = base();
    o.reglagesAvant = null;
    o.reglages.set('config/y.json', 'Y');
    const p = planifier(o);
    assert.ok(p.premiereFois);
    assert.deepStrictEqual(p.reglages.launcherAjouter, []);
});

test('réglage modifié depuis le dernier envoi → launcher + serveur s\'il y existe', () => {
    const o = base();
    o.reglages.set('config/x.json', 'X2');
    o.reglages.set('config/nouveau.json', 'N');
    const p = planifier(o);
    assert.deepStrictEqual(p.reglages.launcherModifier, ['config/x.json']);
    assert.deepStrictEqual(p.reglages.launcherAjouter, ['config/nouveau.json']);
    assert.deepStrictEqual(p.reglages.serveur, ['config/x.json']);
});

test('réglage différent du serveur mais pas touché depuis le dernier envoi → rien', () => {
    const o = base();
    o.reglagesAvant = new Map([['config/x.json', 'X']]);
    const p = planifier(o);
    assert.deepStrictEqual(p.reglages.serveur, []);
});
