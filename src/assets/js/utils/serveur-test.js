/**
 * Serveur « PokéFaction Test » sur la 2e case du rail (Eddy, 21/11 : « mets le test à la place du 2e cadenas sur le vrai
 * launcher, que moi et keijiro on ait l'accès, les autres ne voient pas le serveur test »).
 *  - la case n'apparaît que pour les pseudos de la liste « case_visible » de l'instance (web/instances) ; les autres gardent
 *    le cadenas « Bientôt » ;
 *  - clic : l'instance PokeFaction-Test est choisie, JOUER l'installe (dossier à part) et la lance ;
 *  - la case PokéFaction remet l'instance PokéFaction.
 * Le serveur test revérifie lui-même à chaque connexion (liste blanche + ticket du launcher) : la case n'est pas la seule barrière.
 */
import popup from './popup.js'
import { config as configLauncher, setStatus } from '../utils.js'
import { appliquerFermeture } from './fermeture.js'

const INSTANCE = 'PokeFaction-Test', INSTANCE_PF = 'PokeFaction';
const PAR_DEFAUT = ['Starless_Kirito', 'xkeijiro', 'kxjiro']; // si la liste en ligne n'est pas encore à jour (cache de GitHub)

async function instanceTest() {
    return (await configLauncher.getInstanceList()).find(i => i.name === INSTANCE);
}

async function choisir(db, nom) {
    const configClient = await db.readData('configClient');
    configClient.instance_select = nom;
    await db.updateData('configClient', configClient);
    const test = nom === INSTANCE;
    document.body.classList.toggle('instance-test', test);
    document.querySelector('.rail-test')?.classList.toggle('rail-actif', test);
    document.querySelector('.rail-serveur')?.classList.toggle('rail-actif', !test);
    try {
        const inst = (await configLauncher.getInstanceList()).find(i => i.name === nom);
        if (inst) {
            setStatus(inst.status);
            const v = document.querySelector('.hero-version');
            if (v && inst.loader) v.textContent = `${inst.loader.minecraft_version} · ${inst.sous_titre || 'Cobbleverse'}`;
        }
    } catch (e) { console.error('[Test] statut', e); }
    const etiquette = document.querySelector('.accueil-instance');
    if (etiquette) etiquette.textContent = test ? 'PokéFaction Test' : '';
    await appliquerFermeture(nom); // 22/11 : fin de la bêta (seulement PokéFaction, le test reste ouvert)
}

async function caseVisible(db) {
    try {
        const configClient = await db.readData('configClient');
        const compte = await db.readData('accounts', configClient.account_selected);
        const noms = [compte?.name, compte?.pokefaction?.pseudo].filter(Boolean).map(n => String(n).toLowerCase());
        const inst = await instanceTest();
        if (!inst) return false;
        const liste = Array.isArray(inst.case_visible) ? inst.case_visible : PAR_DEFAUT;
        return noms.some(n => liste.some(p => String(p).toLowerCase() === n));
    } catch { return false; }
}

async function cliqueTest(db) {
    const inst = await instanceTest();
    if (!inst?.status?.ip) {
        new popup().openPopup({ title: 'PokéFaction Test', content: 'Le serveur test n\'est pas encore ouvert au launcher. Reviens un peu plus tard.', color: 'var(--or)', options: true });
        return;
    }
    const { changePanel } = await import('../utils.js');
    await changePanel('home');
    await choisir(db, INSTANCE); // après changePanel (qui rallume la case PokéFaction)
}

export async function initRailTest(db) {
    const bouton = document.querySelector('.rail-test');
    if (!bouton) return;
    const cadenas = document.querySelector('.rail-verrou-test');
    const montrer = async () => { const v = await caseVisible(db); bouton.hidden = !v; if (cadenas) cadenas.hidden = v; };
    await montrer();
    setInterval(() => montrer().catch(() => {}), 30000); // changement de compte, liste mise à jour en ligne
    bouton.addEventListener('click', async () => { if (await caseVisible(db)) cliqueTest(db).catch(e => console.error('[Test]', e)); });
    document.querySelector('.rail-serveur')?.addEventListener('click', () => choisir(db, INSTANCE_PF).catch(() => {}));
    // au démarrage, toujours PokéFaction (le test se choisit à chaque fois avec la case)
    choisir(db, INSTANCE_PF).catch(() => {});
}
