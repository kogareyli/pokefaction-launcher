/**
 * Onglet « Mon skin » des paramètres.
 *  - Automatique : le skin Minecraft officiel du pseudo (comptes Microsoft), sinon Steve/Alex.
 *  - Copier un joueur : le skin de n'importe quel pseudo Minecraft.
 *  - Mon image PNG : envoyée à MineSkin (le service qu'utilise le serveur), qui renvoie un lien officiel
 *    textures.minecraft.net. Le serveur l'applique à la prochaine connexion (SkinRestorer + mod PokéFaction).
 * Le choix est gardé par compte dans configClient.skins et écrit dans pokefaction/skin.json au lancement du jeu.
 */
const nodeFetch = require('node-fetch');
const fs = require('fs');
const pkg = require('../package.json');

const ECHELLE = 10;

async function telechargerImage(url) {
    const r = await nodeFetch(url, { headers: { 'User-Agent': `PokeFaction-Launcher/${pkg.version}` }, timeout: 15000 });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return 'data:image/png;base64,' + Buffer.from(await r.arrayBuffer()).toString('base64');
}

function chargerImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image illisible'));
        img.src = src;
    });
}

/** Comme Minecraft : sur un vieux skin 64x32, un « chapeau » entièrement opaque est ignoré (astuce de Notch). */
function chapeauVisible(img) {
    if (img.height === 64) return true;
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(32, 0, 32, 16).data;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 128) return true;
    return false;
}

/** Dessine le personnage de face (avec la 2e couche des skins 64x64). */
function dessinerPersonnage(canvas, img, modele) {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const nouveau = img.height === 64;
    const bras = modele === 'slim' ? 3 : 4;
    const morceau = (sx, sy, w, h, dx, dy, miroir = false) => {
        ctx.save();
        if (miroir) {
            ctx.translate((dx + w) * ECHELLE, dy * ECHELLE);
            ctx.scale(-1, 1);
            ctx.drawImage(img, sx, sy, w, h, 0, 0, w * ECHELLE, h * ECHELLE);
        } else {
            ctx.drawImage(img, sx, sy, w, h, dx * ECHELLE, dy * ECHELLE, w * ECHELLE, h * ECHELLE);
        }
        ctx.restore();
    };
    const gx = 4 - bras; // bras droit collé au corps
    morceau(8, 8, 8, 8, 4, 0);                                   // tête
    morceau(20, 20, 8, 12, 4, 8);                                // corps
    morceau(44, 20, bras, 12, gx, 8);                            // bras droit
    if (nouveau) morceau(36, 52, bras, 12, 12, 8); else morceau(44, 20, bras, 12, 12, 8, true); // bras gauche
    morceau(4, 20, 4, 12, 4, 20);                                // jambe droite
    if (nouveau) morceau(20, 52, 4, 12, 8, 20); else morceau(4, 20, 4, 12, 8, 20, true);        // jambe gauche
    if (chapeauVisible(img)) morceau(40, 8, 8, 8, 4, 0);         // chapeau / cheveux
    if (nouveau) {
        morceau(20, 36, 8, 12, 4, 8);                            // veste
        morceau(44, 36, bras, 12, gx, 8);                        // manche droite
        morceau(52, 52, bras, 12, 12, 8);                        // manche gauche
        morceau(4, 36, 4, 12, 4, 20);                            // pantalon droit
        morceau(4, 52, 4, 12, 8, 20);                            // pantalon gauche
    }
}

function teteEnImage(img) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64);
    if (chapeauVisible(img)) ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64);
    return c.toDataURL();
}

/** Envoi à MineSkin (sans clé : 10 envois par minute). Renvoie le lien textures.minecraft.net. */
async function envoyerMineSkin(octets, modele) {
    const frontiere = '----PokeFaction' + Date.now().toString(16);
    const champ = (nom, valeur) => `--${frontiere}\r\nContent-Disposition: form-data; name="${nom}"\r\n\r\n${valeur}\r\n`;
    const corps = Buffer.concat([
        Buffer.from(champ('variant', modele) + champ('visibility', 'unlisted') + champ('name', 'PokeFaction')),
        Buffer.from(`--${frontiere}\r\nContent-Disposition: form-data; name="file"; filename="skin.png"\r\nContent-Type: image/png\r\n\r\n`),
        octets,
        Buffer.from(`\r\n--${frontiere}--\r\n`)
    ]);
    const r = await nodeFetch('https://api.mineskin.org/v2/generate', {
        method: 'POST',
        body: corps,
        headers: { 'Content-Type': `multipart/form-data; boundary=${frontiere}`, 'User-Agent': `PokeFaction-Launcher/${pkg.version}` },
        timeout: 60000
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 429) throw new Error('Trop d\'envois d\'un coup : réessaie dans une minute.');
    const lien = j?.skin?.texture?.url?.skin;
    if (!r.ok || !j.success || !lien) {
        const detail = j?.errors?.[0]?.message || j?.message || ('HTTP ' + r.status);
        throw new Error('Le skin n\'a pas pu être envoyé (' + detail + ').');
    }
    return lien.replace('http://', 'https://');
}

export default class ChoixSkin {
    async init(db) {
        this.db = db;
        this.racine = document.querySelector('#skin-tab');
        if (!this.racine) return;
        this.canvas = this.racine.querySelector('.skin-canvas');
        this.message = this.racine.querySelector('.skin-message');
        this.mode = 'auto';
        this.modele = 'classic';
        this.fichier = null;      // octets du PNG choisi
        this.imageFichier = null; // data URL du PNG choisi

        this.racine.querySelectorAll('.skin-mode').forEach(b => b.addEventListener('click', () => this.changerMode(b.dataset.mode)));
        this.racine.querySelectorAll('.skin-modele').forEach(b => b.addEventListener('click', () => {
            this.modele = b.dataset.modele;
            this.majBoutons();
            this.apercu();
        }));
        this.racine.querySelector('.skin-voir').addEventListener('click', () => this.apercu());
        this.racine.querySelector('.skin-pseudo').addEventListener('keydown', e => { if (e.key === 'Enter') this.apercu(); });
        const entree = this.racine.querySelector('.skin-fichier');
        this.racine.querySelector('.skin-parcourir').addEventListener('click', () => entree.click());
        entree.addEventListener('change', () => this.lireFichier(entree.files[0]));
        this.racine.querySelector('.skin-enregistrer').addEventListener('click', () => this.enregistrer());

        // Revenir sur l'onglet = recharger le choix du compte sélectionné
        document.querySelector('.nav-box').addEventListener('click', e => { if (e.target.id === 'skin') this.charger(); });
        this.charger();
    }

    async compte() {
        const config = await this.db.readData('configClient');
        const compte = config?.account_selected ? await this.db.readData('accounts', config.account_selected) : null;
        return { config, compte };
    }

    async charger() {
        const { config, compte } = await this.compte();
        this.racine.querySelector('.skin-compte').textContent = compte ? compte.name : '—';
        const choix = (compte && config?.skins?.[compte.name.toLowerCase()]) || { type: 'auto' };
        this.mode = choix.type === 'web' ? 'fichier' : choix.type;
        this.modele = choix.modele || 'classic';
        this.racine.querySelector('.skin-pseudo').value = choix.type === 'mojang' ? choix.valeur : '';
        this.choixEnregistre = choix;
        this.fichier = null;
        this.imageFichier = null;
        this.majBoutons();
        this.ecrire('');
        this.apercu();
    }

    changerMode(mode) {
        this.mode = mode;
        this.majBoutons();
        this.ecrire('');
        this.apercu();
    }

    majBoutons() {
        this.racine.querySelectorAll('.skin-mode').forEach(b => b.classList.toggle('skin-actif', b.dataset.mode === this.mode));
        this.racine.querySelectorAll('.skin-modele').forEach(b => b.classList.toggle('skin-actif', b.dataset.modele === this.modele));
        this.racine.querySelectorAll('.skin-panneau').forEach(p => p.classList.toggle('skin-visible', p.dataset.mode === this.mode));
    }

    ecrire(texte, erreur = false) {
        this.message.textContent = texte;
        this.message.classList.toggle('skin-erreur', erreur);
    }

    async lireFichier(f) {
        if (!f) return;
        try {
            const octets = Buffer.from(await f.arrayBuffer());
            if (octets.length > 50000) throw new Error('Image trop lourde.');
            const url = 'data:image/png;base64,' + octets.toString('base64');
            const img = await chargerImage(url);
            if (img.width !== 64 || (img.height !== 64 && img.height !== 32)) {
                throw new Error(`Un skin Minecraft fait 64 × 64 pixels (ou 64 × 32). Ton image fait ${img.width} × ${img.height}.`);
            }
            this.fichier = octets;
            this.imageFichier = url;
            this.racine.querySelector('.skin-nom-fichier').textContent = f.name;
            this.ecrire('');
            this.apercu();
        } catch (err) {
            this.ecrire(err.message, true);
        }
    }

    /** Image à afficher pour le mode en cours. */
    async sourceApercu() {
        const { compte } = await this.compte();
        if (this.mode === 'fichier') {
            if (this.imageFichier) return this.imageFichier;
            if (this.choixEnregistre?.type === 'web') return await telechargerImage(this.choixEnregistre.valeur);
            return null;
        }
        const pseudo = this.mode === 'mojang' ? this.racine.querySelector('.skin-pseudo').value.trim() : compte?.name;
        if (!pseudo) return null;
        if (!/^[A-Za-z0-9_]{3,16}$/.test(pseudo)) throw new Error('Pseudo invalide (3 à 16 lettres, chiffres ou _).');
        return await telechargerImage(`https://mc-heads.net/skin/${encodeURIComponent(pseudo)}`);
    }

    async apercu() {
        const etat = this.racine.querySelector('.skin-etat');
        etat.textContent = 'Chargement…';
        try {
            const src = await this.sourceApercu();
            const ctx = this.canvas.getContext('2d');
            if (!src) {
                ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                etat.textContent = this.mode === 'fichier' ? 'Choisis une image PNG' : 'Tape un pseudo';
                return;
            }
            const img = await chargerImage(src);
            const modele = this.mode === 'fichier' ? this.modele : 'classic';
            dessinerPersonnage(this.canvas, img, modele);
            this.canvas.classList.remove('skin-anim');
            void this.canvas.offsetWidth;
            this.canvas.classList.add('skin-anim');
            etat.textContent = '';
        } catch (err) {
            etat.textContent = '';
            this.ecrire(err.message, true);
        }
    }

    async enregistrer() {
        const bouton = this.racine.querySelector('.skin-enregistrer');
        const { config, compte } = await this.compte();
        if (!compte) return this.ecrire('Connecte-toi d\'abord à un compte.', true);
        let choix;
        try {
            bouton.disabled = true;
            if (this.mode === 'auto') {
                choix = { type: 'auto' };
            } else if (this.mode === 'mojang') {
                const pseudo = this.racine.querySelector('.skin-pseudo').value.trim();
                if (!/^[A-Za-z0-9_]{3,16}$/.test(pseudo)) throw new Error('Pseudo invalide (3 à 16 lettres, chiffres ou _).');
                const r = await nodeFetch(`https://api.mojang.com/users/profiles/minecraft/${pseudo}`, { timeout: 15000 });
                if (r.status !== 200) throw new Error(`Aucun compte Minecraft ne s'appelle « ${pseudo} ».`);
                choix = { type: 'mojang', valeur: pseudo };
            } else {
                if (!this.fichier) {
                    if (this.choixEnregistre?.type === 'web') choix = { ...this.choixEnregistre, modele: this.modele };
                    else throw new Error('Choisis d\'abord une image PNG.');
                } else {
                    this.ecrire('Envoi du skin…');
                    const lien = await envoyerMineSkin(this.fichier, this.modele);
                    choix = { type: 'web', valeur: lien, modele: this.modele };
                }
            }
            config.skins = config.skins || {};
            config.skins[compte.name.toLowerCase()] = choix;
            await this.db.updateData('configClient', config);
            this.choixEnregistre = choix;
            this.fichier = null;
            this.imageFichier = null;
            this.ecrire('Enregistré ! Ton skin s\'appliquera à ta prochaine connexion au serveur.');
            // Tête du joueur dans la barre latérale
            try {
                const img = await chargerImage(await this.sourceApercu());
                document.querySelector('.player-head').style.backgroundImage = `url(${teteEnImage(img)})`;
            } catch { /* pas grave */ }
        } catch (err) {
            this.ecrire(err.message || String(err), true);
        } finally {
            bouton.disabled = false;
        }
    }
}
