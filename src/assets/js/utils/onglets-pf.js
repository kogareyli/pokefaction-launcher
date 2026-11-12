/**
 * Onglets PokéFaction des paramètres :
 *  - Mon profil : les stats envoyées par le serveur Minecraft (API des comptes, pf_mon_profil).
 *  - Graphismes : PC faible / équilibré / beau, appliqué au lancement du jeu (options.txt + shaders Iris).
 *  - Signaler un bug : texte + journal du jeu, envoyé au PokéFaction Panel d'Eddy (pf_signaler).
 */
import { PokeFactionAPI } from './pokefaction-api.js';
const fs = require('fs');
const pkg = require('../package.json');

const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';

function echapper(t) {
    return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function nombre(n) {
    return Number(n || 0).toLocaleString('fr-FR');
}

function ilYA(ms) {
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 2) return 'à l\'instant';
    if (min < 60) return `il y a ${min} min`;
    if (min < 48 * 60) return `il y a ${Math.round(min / 60)} h`;
    return `il y a ${Math.round(min / 1440)} jours`;
}

// ---------------------------------------------------------------- Graphismes
export const MODES_GRAPHIQUES = {
    faible: {
        options: { renderDistance: '8', simulationDistance: '6', graphicsMode: '0', particles: '2', entityDistanceScaling: '0.75',
            renderClouds: '"false"', ao: 'false', biomeBlendRadius: '0', entityShadows: 'false' },
        shaders: false
    },
    equilibre: {
        options: { renderDistance: '12', simulationDistance: '8', graphicsMode: '1', particles: '1', entityDistanceScaling: '1.0',
            renderClouds: '"fast"', ao: 'true', biomeBlendRadius: '2', entityShadows: 'true' },
        shaders: false
    },
    beau: {
        options: { renderDistance: '14', simulationDistance: '8', graphicsMode: '1', particles: '0', entityDistanceScaling: '1.25',
            renderClouds: '"true"', ao: 'true', biomeBlendRadius: '5', entityShadows: 'true' },
        shaders: true
    }
};

/** Applique le mode choisi dans le dossier de l'instance, juste avant de lancer le jeu. */
export function appliquerGraphismes(dossierInstance, mode) {
    const m = MODES_GRAPHIQUES[mode];
    if (!m) return; // « perso » : on ne touche à rien
    // options.txt : on remplace seulement nos clés, le reste (touches, son…) ne bouge pas
    const fichier = `${dossierInstance}/options.txt`;
    let lignes = [];
    try { lignes = fs.readFileSync(fichier, 'utf8').split(/\r?\n/).filter(l => l.length); } catch { /* premier lancement */ }
    const vus = new Set();
    lignes = lignes.map(l => {
        const k = l.slice(0, l.indexOf(':'));
        if (k in m.options) { vus.add(k); return `${k}:${m.options[k]}`; }
        return l;
    });
    for (const [k, v] of Object.entries(m.options)) if (!vus.has(k)) lignes.push(`${k}:${v}`);
    fs.mkdirSync(dossierInstance, { recursive: true });
    fs.writeFileSync(fichier, lignes.join('\n') + '\n');
    // Shaders (Iris) : on allume ou on éteint, le pack choisi reste le même
    const iris = `${dossierInstance}/config/iris.properties`;
    try {
        let t = fs.existsSync(iris) ? fs.readFileSync(iris, 'utf8') : '';
        if (/^enableShaders=/m.test(t)) t = t.replace(/^enableShaders=.*$/m, `enableShaders=${m.shaders}`);
        else t += `\nenableShaders=${m.shaders}\n`;
        if (m.shaders && !/^shaderPack=.+$/m.test(t)) {
            const packs = fs.existsSync(`${dossierInstance}/shaderpacks`) ? fs.readdirSync(`${dossierInstance}/shaderpacks`) : [];
            const pack = packs.find(p => /complementary/i.test(p)) || packs.find(p => !p.endsWith('.txt'));
            if (pack) t += `shaderPack=${pack}\n`;
        }
        fs.mkdirSync(`${dossierInstance}/config`, { recursive: true });
        fs.writeFileSync(iris, t);
    } catch (err) { console.error('iris.properties', err); }
}

// ---------------------------------------------------------------- Mon profil
/** Rendu de la carte « Mon profil » (r = réponse de pf_mon_profil, tete = background-image de la tête). */
export function rendreProfil(zone, r, tete) {
    const d = r.donnees || {};
    const total = Math.max(1, d.arenesTotal || 1);
    const cases = [
        ['Temps de jeu', `${String(d.heures ?? 0).replace('.', ',')} h`],
        ['Arènes', `${d.arenes ?? 0} / ${total}`],
        ['Argent', `${nombre(d.argent)} $`],
        ['Pokédex', `${nombre(d.especes)} espèces`],
        ['Captures', nombre(d.captures)],
        ['Shiny', nombre(d.shiny)],
        ['Limite de niveau', d.limite > 0 ? `niveau ${d.limite}` : '–'],
        ['Missions du jour', `${d.missions ?? 0} / 3`],
    ];
    const equipe = (d.equipe || []).map(p => `
        <div class="pf-pokemon${p.shiny ? ' pf-shiny' : ''}" title="${echapper(p.nom)}${p.shiny ? ' (shiny)' : ''}">
            <img src="${SPRITES}/${p.shiny ? 'shiny/' : ''}${Number(p.dex) || 0}.png" alt="" loading="lazy">
            <span class="pf-pokemon-nom">${echapper(p.nom)}</span>
            <span class="pf-pokemon-niv">niv. ${Number(p.niveau) || 0}</span>
        </div>`).join('');
    const couleurGrade = /^#[0-9A-F]{6}$/i.test(d.gradeCouleur || '') ? d.gradeCouleur : 'inherit';
    zone.innerHTML = `
        <div class="pf-carte-joueur">
            <div class="pf-tete"></div>
            <div>
                <div class="pf-pseudo">${echapper(r.pseudo)}</div>
                <div class="pf-sous">
                    ${d.grade ? `<span class="pf-grade" style="color:${couleurGrade}">${echapper(d.grade)}</span> · ` : ''}
                    ${d.faction ? `Faction <b>${echapper(d.faction)}</b>` : 'Sans faction'}
                </div>
                ${d.prochaineArene ? `<div class="pf-sous">Prochaine : ${echapper(d.prochaineArene)}</div>` : ''}
            </div>
        </div>
        <div class="pf-barre"><div style="width:${Math.min(100, Math.round(100 * (d.arenes || 0) / total))}%"></div></div>
        <div class="pf-grille">${cases.map(([t, v]) => `<div class="pf-case"><span>${t}</span><b>${echapper(v)}</b></div>`).join('')}</div>
        <div class="pf-titre-equipe">Mon équipe</div>
        <div class="pf-equipe">${equipe || '<div class="pf-vide">Aucun Pokémon dans l\'équipe.</div>'}</div>
        <div class="pf-maj">Mis à jour ${d.vuLe ? ilYA(d.vuLe) : ''} (toutes les 5 minutes pendant que tu joues)</div>`;
    if (tete) zone.querySelector('.pf-tete').style.backgroundImage = tete;
}

export default class OngletsPF {
    async init(db, config) {
        this.db = db;
        this.config = config;
        this.profil();
        this.graphismes();
        this.bug();
    }

    async compte() {
        const configClient = await this.db.readData('configClient');
        const compte = configClient?.account_selected != null ? await this.db.readData('accounts', configClient.account_selected) : null;
        return { configClient, compte };
    }

    api() {
        return new PokeFactionAPI(this.config.pokefaction_api);
    }

    profil() {
        const bouton = document.querySelector('.nav-settings-btn#profil');
        const zone = document.querySelector('.pf-profil');
        if (!bouton || !zone) return;
        bouton.addEventListener('click', () => this.chargerProfil(zone));
        document.querySelector('.pf-profil-rafraichir')?.addEventListener('click', () => this.chargerProfil(zone));
    }

    async chargerProfil(zone) {
        zone.innerHTML = '<div class="pf-vide">Chargement…</div>';
        try {
            const { compte } = await this.compte();
            if (!compte?.pokefaction?.session) throw new Error('Connecte-toi à un compte pour voir ton profil.');
            const r = await this.api().rpc('pf_mon_profil', { p_session: compte.pokefaction.session });
            if (r.aucun || !r.donnees) {
                zone.innerHTML = `<div class="pf-vide">Pas encore de profil pour <b>${echapper(r.pseudo || compte.name)}</b>.<br>Joue sur le serveur : ton profil apparaîtra ici quelques minutes après.</div>`;
                return;
            }
            rendreProfil(zone, r, document.querySelector('.player-head')?.style.backgroundImage || '');
        } catch (err) {
            zone.innerHTML = `<div class="pf-vide">${echapper(err.message || err)}</div>`;
        }
    }

    // ---------------------------------------------------------------- Graphismes
    async graphismes() {
        const boutons = document.querySelectorAll('.pf-mode');
        if (!boutons.length) return;
        const { configClient } = await this.compte();
        const actuel = configClient?.graphismes || 'perso';
        boutons.forEach(b => b.classList.toggle('active-close', b.dataset.mode === actuel));
        boutons.forEach(b => b.addEventListener('click', async () => {
            const cfg = await this.db.readData('configClient');
            cfg.graphismes = b.dataset.mode;
            await this.db.updateData('configClient', cfg);
            boutons.forEach(x => x.classList.toggle('active-close', x === b));
        }));
    }

    // ---------------------------------------------------------------- Signaler un bug
    bug() {
        const envoyer = document.querySelector('.pf-bug-envoyer');
        if (!envoyer) return;
        const texte = document.querySelector('.pf-bug-texte');
        const journal = document.querySelector('.pf-bug-journal');
        const etat = document.querySelector('.pf-bug-etat');
        envoyer.addEventListener('click', async () => {
            const t = texte.value.trim();
            etat.className = 'pf-bug-etat';
            if (t.length < 5) { etat.textContent = 'Explique le problème en quelques mots.'; etat.classList.add('pf-erreur'); return; }
            envoyer.disabled = true;
            etat.textContent = 'Envoi…';
            try {
                const { compte, configClient } = await this.compte();
                if (!compte?.pokefaction?.session) throw new Error('Connecte-toi à un compte pour envoyer un signalement.');
                let log = null;
                if (journal.checked) {
                    try {
                        const { dossierJeu } = await import('../utils.js');
                        const chemin = await dossierJeu(this.config.dataDirectory);
                        const instance = configClient?.instance_select || 'PokeFaction';
                        const f = `${chemin}/instances/${instance}/logs/latest.log`;
                        if (fs.existsSync(f)) log = fs.readFileSync(f, 'utf8').slice(-100000);
                    } catch (err) { console.error('journal du jeu', err); }
                }
                await this.api().rpc('pf_signaler', { p_session: compte.pokefaction.session, p_texte: t, p_journal: log, p_version: pkg.version });
                texte.value = '';
                etat.textContent = 'Merci ! Ton signalement est bien arrivé chez le staff.';
                etat.classList.add('pf-ok');
            } catch (err) {
                etat.textContent = err.message || String(err);
                etat.classList.add('pf-erreur');
            } finally {
                envoyer.disabled = false;
            }
        });
    }
}
