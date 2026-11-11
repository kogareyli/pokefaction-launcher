/*
 * Lecteur de fichiers .zip / .jar minimal (sans dépendance) : liste les fichiers et lit leur contenu.
 * Gère les méthodes « stockée » (0) et « deflate » (8), ce qu'utilisent tous les .jar de mods.
 */
const zlib = require('zlib');

const SIG_FIN = 0x06054b50;      // fin du répertoire central
const SIG_CENTRAL = 0x02014b50;  // entrée du répertoire central
const SIG_LOCAL = 0x04034b50;    // en-tête local d'un fichier

function trouverFin(buf) {
    // La fin du répertoire central fait 22 octets + un commentaire de 65535 octets maximum.
    const min = Math.max(0, buf.length - 22 - 0xffff);
    for (let i = buf.length - 22; i >= min; i--) {
        if (buf.readUInt32LE(i) === SIG_FIN) return i;
    }
    throw new Error('archive zip invalide (fin introuvable)');
}

/** Renvoie la liste des fichiers de l'archive : [{ nom, methode, tailleCompressee, offsetLocal }]. */
function lister(buf) {
    const fin = trouverFin(buf);
    const nb = buf.readUInt16LE(fin + 10);
    let pos = buf.readUInt32LE(fin + 16);
    const entrees = [];
    for (let i = 0; i < nb; i++) {
        if (buf.readUInt32LE(pos) !== SIG_CENTRAL) throw new Error('répertoire central zip invalide');
        const methode = buf.readUInt16LE(pos + 10);
        const tailleCompressee = buf.readUInt32LE(pos + 20);
        const lgNom = buf.readUInt16LE(pos + 28);
        const lgExtra = buf.readUInt16LE(pos + 30);
        const lgComm = buf.readUInt16LE(pos + 32);
        const offsetLocal = buf.readUInt32LE(pos + 42);
        const nom = buf.toString('utf8', pos + 46, pos + 46 + lgNom);
        entrees.push({ nom, methode, tailleCompressee, offsetLocal });
        pos += 46 + lgNom + lgExtra + lgComm;
    }
    return entrees;
}

/** Lit le contenu d'une entrée renvoyée par lister(). */
function lireEntree(buf, entree) {
    const p = entree.offsetLocal;
    if (buf.readUInt32LE(p) !== SIG_LOCAL) throw new Error(`en-tête local invalide pour ${entree.nom}`);
    const debut = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
    const donnees = buf.subarray(debut, debut + entree.tailleCompressee);
    if (entree.methode === 0) return Buffer.from(donnees);
    if (entree.methode === 8) return zlib.inflateRawSync(donnees);
    throw new Error(`méthode de compression ${entree.methode} non gérée (${entree.nom})`);
}

/** Lit un fichier par son nom, ou renvoie null s'il n'existe pas. */
function lireFichier(buf, nom) {
    const e = lister(buf).find(x => x.nom === nom);
    return e ? lireEntree(buf, e) : null;
}

module.exports = { lister, lireEntree, lireFichier };
