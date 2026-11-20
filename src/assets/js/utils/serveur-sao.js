/**
 * 2e serveur (« SAO », Minecraft 1.21.4) sur la 2e case du rail (Eddy, 20/11 : « mets-le sur le 2e cadenas du launcher » et
 * « je dois accepter les personnes qui veulent l'installer, dans mon panel »).
 *  - clic sur la case : on demande à l'API des comptes si le joueur est accepté (pf_acces_etat) ;
 *  - accepté : l'instance SAO est choisie, JOUER l'installe et la lance ;
 *  - sinon : bouton « Demander l'accès » (pf_acces_demander) ; le staff accepte ou refuse dans le PokéFaction Panel ;
 *  - la case PokéFaction remet l'instance PokéFaction.
 * Le serveur de jeu revérifie lui-même à chaque connexion (mod pokefaction-sao) : la case n'est pas la seule barrière.
 */
import { PokeFactionAPI } from './pokefaction-api.js'
import popup from './popup.js'
import { config as configLauncher, setStatus } from '../utils.js'

const SERVEUR = 'sao', INSTANCE = 'SAO', INSTANCE_PF = 'PokeFaction';
const echap = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function choisir(db, nom) {
    const configClient = await db.readData('configClient');
    configClient.instance_select = nom;
    await db.updateData('configClient', configClient);
    const sao = nom === INSTANCE;
    document.body.classList.toggle('instance-sao', sao);
    document.querySelector('.rail-sao')?.classList.toggle('rail-actif', sao);
    document.querySelector('.rail-serveur')?.classList.toggle('rail-actif', !sao);
    // statut (joueurs en ligne) et version du serveur choisi
    try {
        const inst = (await configLauncher.getInstanceList()).find(i => i.name === nom);
        if (inst) {
            setStatus(inst.status);
            const v = document.querySelector('.hero-version');
            if (v && inst.loader) v.textContent = `${inst.loader.minecraft_version} · ${inst.sous_titre || 'Cobbleverse'}`;
        }
    } catch (e) { console.error('[SAO] statut', e); }
    const etiquette = document.querySelector('.accueil-instance');
    if (etiquette) etiquette.textContent = sao ? 'Serveur SAO · Minecraft 1.21.4' : '';
}

function fenetre(titre, html, couleur = 'var(--or)') {
    new popup().openPopup({ title: titre, content: html, color: couleur, options: true });
}

async function cliqueSao(db, config) {
    const configClient = await db.readData('configClient');
    const compte = await db.readData('accounts', configClient.account_selected);
    const session = compte?.pokefaction?.session;
    if (!session || config.auth !== 'pokefaction') return fenetre('Serveur SAO', 'Connecte-toi d\'abord à ton compte PokéFaction.', 'red');
    let api;
    try { api = new PokeFactionAPI(config.pokefaction_api); } catch (e) { return fenetre('Serveur SAO', echap(e.message), 'red'); }
    let etat;
    try { etat = await api.rpc('pf_acces_etat', { p_session: session, p_serveur: SERVEUR }); }
    catch (e) { return fenetre('Serveur SAO', echap(e.message), 'red'); }
    if (etat?.statut === 'accepte') {
        const { changePanel } = await import('../utils.js');
        await changePanel('home');
        await choisir(db, INSTANCE); // après changePanel (qui rallume la case PokéFaction)
        return;
    }
    if (etat?.statut === 'demande') return fenetre('Serveur SAO', 'Ta demande est envoyée : <b>le staff doit l\'accepter</b>.<br>Reviens cliquer ici un peu plus tard.');
    const refuse = etat?.statut === 'refuse';
    fenetre('Serveur SAO',
        (refuse ? 'Ta dernière demande a été refusée.<br>' : '') +
        'Ce serveur est <b>sur invitation</b> : demande l\'accès, le staff l\'accepte ou le refuse.<br><br>' +
        '<button class="bouton-sao-demander popup-button" style="display:inline-block">Demander l\'accès</button>');
    document.querySelector('.bouton-sao-demander')?.addEventListener('click', async e => {
        e.stopPropagation();
        try {
            const r = await api.rpc('pf_acces_demander', { p_session: session, p_serveur: SERVEUR, p_message: '' });
            fenetre('Serveur SAO', r?.statut === 'accepte' ? 'Tu as déjà accès : clique encore sur la case.' : 'Demande envoyée ! <b>Le staff doit l\'accepter.</b><br>Reviens cliquer ici un peu plus tard.');
        } catch (err) { fenetre('Serveur SAO', echap(err.message), 'red'); }
    }, { once: true });
}

/** Case visible seulement pour les pseudos de la liste « case_visible » de l'instance SAO (web/instances) ; les autres gardent le cadenas. */
async function caseVisible(db) {
    try {
        const configClient = await db.readData('configClient');
        const compte = await db.readData('accounts', configClient.account_selected);
        const nom = String(compte?.name || compte?.pokefaction?.pseudo || '').toLowerCase();
        const sao = (await configLauncher.getInstanceList()).find(i => i.name === INSTANCE);
        return !!nom && (sao?.case_visible || []).some(p => String(p).toLowerCase() === nom);
    } catch { return false; }
}

export async function initRailSao(db, config) {
    const bouton = document.querySelector('.rail-sao');
    if (!bouton) return;
    // Eddy (20/11) : « pour l'instant, garde le cadenas pour les autres, sauf xkeijiro et moi »
    const visible = await caseVisible(db);
    bouton.hidden = !visible;
    const cadenas = document.querySelector('.rail-verrou-sao');
    if (cadenas) cadenas.hidden = visible;
    bouton.addEventListener('click', async () => { if (await caseVisible(db)) cliqueSao(db, config).catch(e => console.error('[SAO]', e)); });
    document.querySelector('.rail-serveur')?.addEventListener('click', () => choisir(db, INSTANCE_PF).catch(() => {}));
    // au démarrage, l'instance choisie est toujours PokéFaction (l'accès au 2e serveur se revérifie à chaque clic)
    choisir(db, INSTANCE_PF).catch(() => {});
}
