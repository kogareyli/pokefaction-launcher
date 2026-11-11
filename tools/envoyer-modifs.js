/*
 * « Envoyer mes modifs PokéFaction »
 * Rend le serveur et le launcher pareils que l'instance CurseForge, puis envoie tout sur GitHub.
 *
 *   node tools/envoyer-modifs.js               → montre les changements, demande confirmation, envoie
 *   node tools/envoyer-modifs.js --simulation  → montre seulement ce qui serait fait
 *
 * Variables d'environnement facultatives : POKEFACTION_INSTANCE (dossier de l'instance CurseForge).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline/promises');
const { execFileSync } = require('child_process');

const { planifier, planVide, estExclu } = require('./lib/synchro');
const dependances = require('./lib/dependances');
const sources = require('./lib/sources');
const manifest = require('./lib/manifest');

const RACINE = path.dirname(__dirname);
const SERVEUR = path.resolve(RACINE, '..', '..');
const INSTANCE = process.env.POKEFACTION_INSTANCE || path.join(os.homedir(), 'curseforge', 'minecraft', 'Instances', 'Poke');
const ETAT = path.join(__dirname, '.etat-reglages.json');
const EXCLUSIONS = JSON.parse(fs.readFileSync(path.join(__dirname, 'exclusions.json'), 'utf8')).chemins;
const SIMULATION = process.argv.includes('--simulation');

const coul = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
const vert = coul(32), rouge = coul(31), jaune = coul(33), cyan = coul(36), gras = coul(1), gris = coul(90);

class Arret extends Error {}
function stop(message) { throw new Arret(message); }

// ---------- petits outils ----------
function git(args, options = {}) {
    return execFileSync('git', args, { cwd: RACINE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

function lister(dossier, base = '') {
    if (!fs.existsSync(dossier)) return [];
    const res = [];
    for (const nom of fs.readdirSync(dossier)) {
        const complet = path.join(dossier, nom);
        const rel = base ? `${base}/${nom}` : nom;
        if (fs.statSync(complet).isDirectory()) res.push(...lister(complet, rel));
        else res.push(rel);
    }
    return res;
}

function empreinte(fichier) {
    const data = fs.readFileSync(fichier);
    return { sha1: manifest.sha1(data), size: data.length };
}

function horodatage() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function copier(source, cible) {
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.copyFileSync(source, cible);
}

/** true si CE serveur tourne (java lancé depuis son dossier, ou ligne de commande qui le mentionne). */
function serveurAllume() {
    try {
        const n = execFileSync('powershell', ['-NoProfile', '-Command',
            "$d = $env:PF_SERVEUR.ToLower(); (Get-CimInstance Win32_Process -Filter \"Name='java.exe' OR Name='javaw.exe'\" | " +
            "Where-Object { $_.CommandLine -like '*fabric-server-launch*' -and ((\"$($_.ExecutablePath)\".ToLower().StartsWith($d)) -or $_.CommandLine.ToLower().Contains($d)) } | Measure-Object).Count"],
            { encoding: 'utf8', env: { ...process.env, PF_SERVEUR: SERVEUR + path.sep } }).trim();
        return Number(n) > 0;
    } catch {
        return false;
    }
}

// ---------- inventaire ----------
function inventaireInstance() {
    const fichiers = new Map();
    for (const nom of fs.readdirSync(path.join(INSTANCE, 'mods'))) {
        if (nom.endsWith('.jar')) fichiers.set(`mods/${nom}`, null);
    }
    for (const dossier of ['resourcepacks', 'shaderpacks']) {
        for (const rel of lister(path.join(INSTANCE, dossier))) fichiers.set(`${dossier}/${rel}`, null);
    }
    for (const chemin of fichiers.keys()) {
        if (estExclu(chemin, EXCLUSIONS)) fichiers.delete(chemin);
        else fichiers.set(chemin, empreinte(path.join(INSTANCE, chemin)));
    }
    return fichiers;
}

function inventaireReglages() {
    const reglages = new Map();
    for (const rel of lister(path.join(INSTANCE, 'config'))) {
        const chemin = `config/${rel}`;
        if (!estExclu(chemin, EXCLUSIONS)) reglages.set(chemin, empreinte(path.join(INSTANCE, chemin)).sha1);
    }
    return reglages;
}

function lireEtat() {
    if (!fs.existsSync(ETAT)) return null;
    return new Map(Object.entries(JSON.parse(fs.readFileSync(ETAT, 'utf8'))));
}

function ecrireEtat(reglages) {
    fs.writeFileSync(ETAT, JSON.stringify(Object.fromEntries(reglages), null, 1));
}

// ---------- version du launcher ----------
function nouvelleVersionLauncher() {
    const pkg = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8'));
    const tag = `v${pkg.version}`;
    try { git(['fetch', '--tags', '--quiet']); } catch { /* hors ligne : on vérifiera au prochain envoi */ }
    try { git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]); } catch { return null; }
    const change = git(['diff', '--name-only', tag, '--', 'src', 'build.js']) !== '';
    if (!change) return null;
    const [a, b, c] = pkg.version.split('.').map(Number);
    return `${a}.${b}.${c + 1}`;
}

// ---------- affichage ----------
function afficherPlan(plan, sourcesTrouvees, version) {
    const ligne = (signe, couleur, texte, note = '') => console.log(`   ${couleur(signe)} ${texte}${note ? gris('  ' + note) : ''}`);
    const nomCourt = p => p.replace(/^(mods|resourcepacks|shaderpacks|config)\//, '');
    const s = plan.serveur, l = plan.launcher, r = plan.reglages;

    if (s.ajouter.length + s.modifier.length + s.retirer.length + r.serveur.length) {
        console.log(gras('\n SERVEUR'));
        s.ajouter.forEach(n => ligne('+', vert, n));
        s.modifier.forEach(n => ligne('~', jaune, n, 'mis à jour'));
        s.retirer.forEach(n => ligne('-', rouge, n, 'retiré (gardé dans sauvegardes-maj)'));
        r.serveur.forEach(n => ligne('~', jaune, `réglage ${nomCourt(n)}`));
    }
    if (l.ajouter.length + l.modifier.length + l.retirer.length + r.launcherAjouter.length + r.launcherModifier.length) {
        console.log(gras('\n LAUNCHER (tes potes)'));
        const origine = p => {
            const src = sourcesTrouvees.get(p);
            return src ? (src.type === 'externe' ? `lien ${src.origine}` : 'hébergé sur GitHub') : '';
        };
        l.ajouter.forEach(p => ligne('+', vert, p, origine(p)));
        l.modifier.forEach(p => ligne('~', jaune, p, `mis à jour, ${origine(p)}`));
        l.retirer.forEach(p => ligne('-', rouge, p));
        r.launcherModifier.forEach(p => ligne('~', jaune, `réglage ${nomCourt(p)}`, 'nouveaux joueurs'));
        r.launcherAjouter.forEach(p => ligne('+', vert, `réglage ${nomCourt(p)}`, 'nouveaux joueurs'));
    }
    if (version) {
        console.log(gras('\n APPLICATION LAUNCHER'));
        ligne('↑', cyan, `nouvelle version ${version}`, 'se met à jour toute seule chez tout le monde');
    }
}

// ---------- application ----------
function appliquerServeur(plan) {
    const s = plan.serveur, r = plan.reglages;
    if (!(s.ajouter.length + s.modifier.length + s.retirer.length + r.serveur.length)) return null;
    const sauvegarde = path.join(SERVEUR, 'sauvegardes-maj', `${horodatage()}-envoi`);
    for (const nom of s.retirer) {
        fs.mkdirSync(path.join(sauvegarde, 'mods-retires'), { recursive: true });
        fs.renameSync(path.join(SERVEUR, 'mods', nom), path.join(sauvegarde, 'mods-retires', nom));
    }
    for (const nom of s.modifier) {
        copier(path.join(SERVEUR, 'mods', nom), path.join(sauvegarde, 'mods-remplaces', nom));
        copier(path.join(INSTANCE, 'mods', nom), path.join(SERVEUR, 'mods', nom));
    }
    for (const nom of s.ajouter) copier(path.join(INSTANCE, 'mods', nom), path.join(SERVEUR, 'mods', nom));
    for (const chemin of r.serveur) {
        copier(path.join(SERVEUR, chemin), path.join(sauvegarde, chemin));
        copier(path.join(INSTANCE, chemin), path.join(SERVEUR, chemin));
    }
    return sauvegarde;
}

function appliquerLauncher(plan, sourcesTrouvees, instance, version) {
    const fichierExternes = path.join(__dirname, 'externes.json');
    let externes = JSON.parse(fs.readFileSync(fichierExternes, 'utf8'));
    const heberge = p => path.join(RACINE, 'web', 'files', p);
    const oublier = p => {
        externes = externes.filter(e => e.path !== p);
        if (fs.existsSync(heberge(p))) fs.rmSync(heberge(p));
    };

    plan.launcher.retirer.forEach(oublier);
    for (const p of [...plan.launcher.ajouter, ...plan.launcher.modifier]) {
        oublier(p);
        const src = sourcesTrouvees.get(p);
        const { sha1, size } = instance.get(p);
        if (src.type === 'externe') externes.push({ path: p, size, hash: sha1, url: src.url });
        else copier(path.join(INSTANCE, p), heberge(p));
    }
    for (const p of [...plan.reglages.launcherAjouter, ...plan.reglages.launcherModifier]) {
        copier(path.join(INSTANCE, p), heberge(p));
    }
    fs.writeFileSync(fichierExternes, JSON.stringify(externes, null, 1) + '\n');

    // Les nouveaux réglages ne s'installent qu'une fois (on n'écrase pas ceux des joueurs).
    if (plan.reglages.launcherAjouter.length) {
        const fichierInstances = path.join(RACINE, 'web', 'instances');
        const instances = JSON.parse(fs.readFileSync(fichierInstances, 'utf8'));
        const inst = Object.values(instances)[0];
        for (const p of plan.reglages.launcherAjouter) if (!inst.ignored.includes(p)) inst.ignored.push(p);
        fs.writeFileSync(fichierInstances, JSON.stringify(instances, null, 4));
    }

    // Retire les dossiers vides laissés dans web/files
    (function nettoyer(d) {
        for (const n of fs.readdirSync(d)) {
            const c = path.join(d, n);
            if (fs.statSync(c).isDirectory()) { nettoyer(c); if (!fs.readdirSync(c).length) fs.rmdirSync(c); }
        }
    })(path.join(RACINE, 'web', 'files'));

    if (version) {
        const fichierPkg = path.join(RACINE, 'package.json');
        const texte = fs.readFileSync(fichierPkg, 'utf8');
        fs.writeFileSync(fichierPkg, texte.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));
    }
    return manifest.generer(RACINE);
}

function messageCommit(plan, version) {
    const morceaux = [];
    const n = (liste, mot) => liste.length && morceaux.push(`${liste.length} ${mot}`);
    const mods = l => l.filter(p => p.startsWith('mods/'));
    const packs = l => l.filter(p => !p.startsWith('mods/'));
    n(mods(plan.launcher.ajouter), 'mod(s) ajouté(s)');
    n(mods(plan.launcher.retirer), 'mod(s) retiré(s)');
    n(mods(plan.launcher.modifier), 'mod(s) mis à jour');
    n(packs([...plan.launcher.ajouter, ...plan.launcher.modifier, ...plan.launcher.retirer]), 'fichier(s) de packs');
    n([...plan.reglages.launcherAjouter, ...plan.reglages.launcherModifier], 'réglage(s)');
    if (version) morceaux.push(`launcher ${version}`);
    const detail = [
        ...plan.launcher.ajouter.map(p => `+ ${p}`),
        ...plan.launcher.modifier.map(p => `~ ${p}`),
        ...plan.launcher.retirer.map(p => `- ${p}`),
        ...[...plan.reglages.launcherAjouter, ...plan.reglages.launcherModifier].map(p => `~ ${p}`),
    ];
    return `Modifs PokéFaction : ${morceaux.join(', ') || 'mise à jour'}\n\n${detail.join('\n')}`;
}

// ---------- programme principal ----------
async function main() {
    console.log(gras(cyan('\n ===  Envoyer mes modifs PokéFaction  ===')) + (SIMULATION ? jaune('  (simulation : rien ne sera modifié)') : ''));

    if (!fs.existsSync(path.join(INSTANCE, 'mods'))) stop(`Instance CurseForge introuvable : ${INSTANCE}`);
    if (!fs.existsSync(path.join(SERVEUR, 'fabric-server-launch.jar'))) stop(`Dossier du serveur introuvable : ${SERVEUR}`);

    if (!SIMULATION) {
        console.log(gris('\n Récupération de la dernière version depuis GitHub…'));
        try { git(['pull', '--rebase', '--autostash', '--quiet']); }
        catch (e) { stop(`Impossible de récupérer GitHub (pas d'internet ?)\n${e.stderr || e.message}`); }
    }

    console.log(gris(' Comparaison de ton instance CurseForge avec le serveur et le launcher…'));
    const instance = inventaireInstance();
    const reglages = inventaireReglages();
    const reglagesAvant = lireEtat();
    const serveurMods = new Map(fs.readdirSync(path.join(SERVEUR, 'mods')).filter(n => n.endsWith('.jar'))
        .map(n => [n, empreinte(path.join(SERVEUR, 'mods', n)).sha1]));
    const reglagesServeur = new Set([...reglages.keys()].filter(p => fs.existsSync(path.join(SERVEUR, p))));
    const manifestActuel = JSON.parse(fs.readFileSync(path.join(RACINE, 'web', 'files', 'manifest.json'), 'utf8'));

    // Dépendances : on refuse d'envoyer un modpack qui planterait au démarrage.
    const jars = [...instance.keys()].filter(p => p.startsWith('mods/'))
        .map(p => ({ fichier: p.slice(5), buf: fs.readFileSync(path.join(INSTANCE, p)) }));
    const { manquants, illisibles } = dependances.verifier(jars);
    illisibles.forEach(f => console.log(jaune(` ⚠ Impossible de lire ${f} (vérification des dépendances ignorée pour lui)`)));
    if (manquants.length) {
        stop('Il manque des mods dont d\'autres ont besoin. Le jeu planterait au démarrage :\n' +
            manquants.map(m => `   ${m.mod} (${m.fichier}) a besoin de « ${m.manque} »`).join('\n') +
            '\n\n Installe-les dans CurseForge (cherche leur nom), puis relance cet outil. Rien n\'a été envoyé.');
    }

    const plan = planifier({
        instance, manifest: manifestActuel, serveurMods, reglages, reglagesAvant, reglagesServeur, exclusions: EXCLUSIONS,
    });
    const version = nouvelleVersionLauncher();

    if (plan.premiereFois) {
        console.log(cyan('\n Première utilisation : je retiens tes réglages actuels comme point de départ.'));
        console.log(cyan(' Les prochaines fois, seuls les réglages que tu modifies seront envoyés.'));
    }

    if (planVide(plan) && !version) {
        if (plan.premiereFois && !SIMULATION) ecrireEtat(reglages);
        console.log(vert('\n ✔ Rien à envoyer : le serveur et le launcher sont déjà pareils que ton CurseForge.\n'));
        return;
    }

    // Où les joueurs vont-ils télécharger les nouveaux fichiers ?
    const aChercher = [...plan.launcher.ajouter, ...plan.launcher.modifier];
    const sourcesTrouvees = new Map();
    if (aChercher.length) {
        console.log(gris(` Recherche des liens de téléchargement (${aChercher.length} fichier(s))…`));
        const curseforge = sources.liensCurseForge(JSON.parse(fs.readFileSync(path.join(INSTANCE, 'minecraftinstance.json'), 'utf8')));
        for (const p of aChercher) {
            const { sha1, size } = instance.get(p);
            sourcesTrouvees.set(p, await sources.trouverSource({ nomFichier: path.basename(p), sha1, taille: size, curseforge }));
        }
        const tropGros = aChercher.filter(p => sourcesTrouvees.get(p).type === 'trop-gros');
        if (tropGros.length) {
            stop('Ces fichiers sont trop gros pour GitHub (plus de 50 Mo) et n\'ont pas de lien CurseForge/Modrinth :\n' +
                tropGros.map(p => `   ${p}`).join('\n') +
                '\n Demande à Claude de les ajouter aux exclusions (tools/exclusions.json). Rien n\'a été envoyé.');
        }
    }

    afficherPlan(plan, sourcesTrouvees, version);

    if (SIMULATION) { console.log(jaune('\n Simulation terminée : rien n\'a été modifié.\n')); return; }

    const toucheServeur = plan.serveur.ajouter.length + plan.serveur.modifier.length + plan.serveur.retirer.length + plan.reglages.serveur.length > 0;
    if (toucheServeur && serveurAllume()) {
        stop('Le serveur tourne : arrête-le d\'abord (tape « stop » dans sa fenêtre), puis relance cet outil. Rien n\'a été envoyé.');
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const reponse = (await rl.question(gras('\n Tout envoyer ? (o/n) '))).trim().toLowerCase();
    rl.close();
    if (!['o', 'oui', 'y', 'yes'].includes(reponse)) { console.log(jaune(' Annulé, rien n\'a été modifié.\n')); return; }

    const sauvegarde = appliquerServeur(plan);
    if (sauvegarde) console.log(vert(' ✔ Serveur mis à jour') + gris(`  (anciens fichiers : ${sauvegarde})`));

    const { nombre, mo } = appliquerLauncher(plan, sourcesTrouvees, instance, version);
    console.log(vert(` ✔ Launcher préparé`) + gris(`  (${nombre} fichiers, ${mo} Mo)`));

    console.log(gris(' Envoi sur GitHub…'));
    try {
        git(['add', '-A']);
        git(['commit', '-q', '-F', '-'], { input: messageCommit(plan, version), stdio: ['pipe', 'pipe', 'pipe'] });
        git(['push', '--quiet']);
    } catch (e) {
        stop(`L'envoi sur GitHub a échoué. Le serveur est déjà à jour ; relance l'outil pour réessayer l'envoi.\n${e.stderr || e.message}`);
    }
    ecrireEtat(reglages);

    console.log(vert(gras('\n ✔ C\'est envoyé ! ')) + 'Tes potes auront les changements au prochain lancement du launcher.');
    if (version) console.log(cyan(` La version ${version} du launcher sera prête dans 5 à 10 minutes (GitHub la fabrique), puis elle s'installera toute seule.`));
    if (sauvegarde) console.log(cyan(' Relance le serveur pour qu\'il prenne les changements.'));
    console.log('');
}

main().catch(e => {
    if (e instanceof Arret) console.log(rouge(`\n ✖ ${e.message}\n`));
    else console.log(rouge(`\n ✖ Erreur inattendue : ${e.stack || e}\n Rien n'a forcément été envoyé. Montre ce message à Claude.\n`));
    process.exitCode = 1;
});
