const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const zip = require('../lib/zip');
const dep = require('../lib/dependances');

/** Fabrique une petite archive zip en mémoire (méthode 0 = stockée, 8 = deflate). */
function fabriquerZip(fichiers) {
    const locaux = [], centraux = [];
    let offset = 0;
    for (const { nom, contenu, methode = 8 } of fichiers) {
        const data = methode === 8 ? zlib.deflateRawSync(contenu) : contenu;
        const n = Buffer.from(nom);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(methode, 8);
        local.writeUInt32LE(data.length, 18); local.writeUInt32LE(contenu.length, 22); local.writeUInt16LE(n.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(methode, 10);
        central.writeUInt32LE(data.length, 20); central.writeUInt32LE(contenu.length, 24); central.writeUInt16LE(n.length, 28);
        central.writeUInt32LE(offset, 42);
        locaux.push(local, n, data); centraux.push(central, n);
        offset += 30 + n.length + data.length;
    }
    const cd = Buffer.concat(centraux);
    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(fichiers.length, 8); fin.writeUInt16LE(fichiers.length, 10);
    fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(offset, 16);
    return Buffer.concat([...locaux, cd, fin]);
}

const jar = (info, autres = []) => fabriquerZip([{ nom: 'fabric.mod.json', contenu: Buffer.from(JSON.stringify(info)) }, ...autres]);

test('zip : lit un fichier stocké et un fichier compressé', () => {
    const z = fabriquerZip([
        { nom: 'a.txt', contenu: Buffer.from('bonjour'), methode: 0 },
        { nom: 'b.txt', contenu: Buffer.from('salut '.repeat(50)), methode: 8 },
    ]);
    assert.strictEqual(zip.lireFichier(z, 'a.txt').toString(), 'bonjour');
    assert.strictEqual(zip.lireFichier(z, 'b.txt').toString(), 'salut '.repeat(50));
    assert.strictEqual(zip.lireFichier(z, 'absent.txt'), null);
});

test('dépendance manquante détectée (cas logprot sans cupboard)', () => {
    const r = dep.verifier([
        { fichier: 'logprot.jar', buf: jar({ id: 'logprot', name: 'Logprot', depends: { cupboard: '*', minecraft: '1.21.x' } }) },
    ]);
    assert.deepStrictEqual(r.manquants, [{ fichier: 'logprot.jar', mod: 'Logprot', manque: 'cupboard' }]);
});

test('dépendance satisfaite par un autre jar, un « provides » ou un jar imbriqué', () => {
    const imbrique = jar({ id: 'lib-interne' });
    const r = dep.verifier([
        { fichier: 'logprot.jar', buf: jar({ id: 'logprot', depends: { cupboard: '*', fabric: '*', 'lib-interne': '*' } }) },
        { fichier: 'cupboard.jar', buf: jar({ id: 'cupboard' }) },
        { fichier: 'fabric-api.jar', buf: jar({ id: 'fabric-api', provides: ['fabric'], jars: [{ file: 'META-INF/jars/x.jar' }] }, [{ nom: 'META-INF/jars/x.jar', contenu: imbrique, methode: 0 }]) },
    ]);
    assert.deepStrictEqual(r.manquants, []);
});

test('fabric.mod.json « laxiste » (virgule en trop, retour à la ligne dans une chaîne) accepté', () => {
    const brut = '{ "id": "laxiste", "description": "ligne 1\nligne 2", "depends": { "minecraft": "*", }, }';
    const r = dep.verifier([{ fichier: 'l.jar', buf: fabriquerZip([{ nom: 'fabric.mod.json', contenu: Buffer.from(brut) }]) }]);
    assert.deepStrictEqual(r, { manquants: [], illisibles: [] });
});
