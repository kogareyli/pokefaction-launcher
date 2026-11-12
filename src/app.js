/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

const { app, ipcMain, nativeTheme, shell } = require('electron');
const https = require('https');
const { Microsoft } = require('minecraft-java-core');
const { autoUpdater } = require('electron-updater')

const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

const UpdateWindow = require("./assets/js/windows/updateWindow.js");
const MainWindow = require("./assets/js/windows/mainWindow.js");

let dev = process.env.NODE_ENV === 'dev';

if (dev) {
    let appPath = path.resolve('./data/Launcher').replace(/\\/g, '/');
    let appdata = path.resolve('./data').replace(/\\/g, '/');
    if (!fs.existsSync(appPath)) fs.mkdirSync(appPath, { recursive: true });
    if (!fs.existsSync(appdata)) fs.mkdirSync(appdata, { recursive: true });
    app.setPath('userData', appPath);
    app.setPath('appData', appdata)
}

Store.initRenderer();

if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(() => {
    if (dev) return MainWindow.createWindow()
    UpdateWindow.createWindow()
});

ipcMain.on('main-window-open', () => MainWindow.createWindow())
ipcMain.on('main-window-dev-tools', () => MainWindow.getWindow().webContents.openDevTools({ mode: 'detach' }))
ipcMain.on('main-window-dev-tools-close', () => MainWindow.getWindow().webContents.closeDevTools())
ipcMain.on('main-window-close', () => MainWindow.destroyWindow())
ipcMain.on('main-window-reload', () => MainWindow.getWindow().reload())
ipcMain.on('main-window-progress', (event, options) => MainWindow.getWindow().setProgressBar(options.progress / options.size))
ipcMain.on('main-window-progress-reset', () => MainWindow.getWindow().setProgressBar(-1))
ipcMain.on('main-window-progress-load', () => MainWindow.getWindow().setProgressBar(2))
ipcMain.on('main-window-minimize', () => MainWindow.getWindow().minimize())

ipcMain.on('update-window-close', () => UpdateWindow.destroyWindow())
ipcMain.on('update-window-dev-tools', () => UpdateWindow.getWindow().webContents.openDevTools({ mode: 'detach' }))
ipcMain.on('update-window-progress', (event, options) => UpdateWindow.getWindow().setProgressBar(options.progress / options.size))
ipcMain.on('update-window-progress-reset', () => UpdateWindow.getWindow().setProgressBar(-1))
ipcMain.on('update-window-progress-load', () => UpdateWindow.getWindow().setProgressBar(2))

ipcMain.handle('path-user-data', () => app.getPath('userData'))
ipcMain.handle('appData', e => app.getPath('appData'))

ipcMain.on('main-window-maximize', () => {
    if (MainWindow.getWindow().isMaximized()) {
        MainWindow.getWindow().unmaximize();
    } else {
        MainWindow.getWindow().maximize();
    }
})

ipcMain.on('main-window-hide', () => MainWindow.getWindow().hide())
ipcMain.on('main-window-show', () => MainWindow.getWindow().show())

ipcMain.handle('Microsoft-window', async (_, client_id) => {
    return await new Microsoft(client_id).getAuth();
})

ipcMain.handle('is-dark-theme', (_, theme) => {
    if (theme === 'dark') return true
    if (theme === 'light') return false
    return nativeTheme.shouldUseDarkColors;
})

app.on('window-all-closed', () => app.quit());

// ------------------------------------------------------------------ mise à jour du launcher
// Journal lisible : %APPDATA%\pokefaction-launcher\maj-launcher.txt (à envoyer à un admin si ça bloque)
function journalMaj(niveau, ...msg) {
    try {
        const fichier = path.join(app.getPath('userData'), 'maj-launcher.txt');
        if (fs.existsSync(fichier) && fs.statSync(fichier).size > 300000) fs.renameSync(fichier, fichier + '.ancien');
        const texte = msg.map(m => m instanceof Error ? (m.stack || m.message) : typeof m === 'string' ? m : JSON.stringify(m)).join(' ');
        fs.appendFileSync(fichier, `[${new Date().toLocaleString('fr-FR')}] [${niveau}] v${app.getVersion()} ${texte}\n`);
    } catch { /* pas grave */ }
}

autoUpdater.logger = {
    info: (...m) => journalMaj('info', ...m),
    warn: (...m) => journalMaj('attention', ...m),
    error: (...m) => journalMaj('erreur', ...m),
    debug: () => {}
};
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

// Une installation qui échoue deux fois de suite (antivirus, Contrôle intelligent des applications…)
// n'est plus retentée à chaque démarrage : le joueur passe directement au launcher.
const fichierTentative = () => path.join(app.getPath('userData'), 'maj-tentative.json');
function lireTentative() {
    try { return JSON.parse(fs.readFileSync(fichierTentative(), 'utf8')); } catch { return null; }
}
function majBloquee(version) {
    const t = lireTentative();
    return !!t && t.version === version && t.essais >= 2;
}
app.whenReady().then(() => {
    // Raccourci sur le bureau : l'installeur le crée, mais certains PC (bureau OneDrive…) n'en ont pas
    if (process.platform === 'win32' && app.isPackaged) {
        try {
            const raccourci = path.join(app.getPath('desktop'), 'PokeFaction.lnk');
            if (!fs.existsSync(raccourci)) {
                const ok = shell.writeShortcutLink(raccourci, 'create', {
                    target: process.execPath, cwd: path.dirname(process.execPath),
                    icon: process.execPath, iconIndex: 0, description: 'Launcher PokéFaction'
                });
                journalMaj('info', ok ? 'raccourci créé sur le bureau' : 'raccourci du bureau impossible à créer');
            }
        } catch (err) { journalMaj('erreur', 'raccourci du bureau', err); }
    }
    const t = lireTentative();
    // Mise à jour réussie (ou plus ancienne que la version installée) : on oublie la tentative
    if (t && t.version === app.getVersion()) {
        journalMaj('info', `mise à jour vers ${t.version} réussie`);
        try { fs.unlinkSync(fichierTentative()); } catch { }
    }
});

let majAbandonnee = false;
let versionProposee = null;
const fenetreMaj = () => UpdateWindow.getWindow();
const versFenetreMaj = (canal, ...args) => { const w = fenetreMaj(); if (w && !w.isDestroyed()) w.webContents.send(canal, ...args); };

ipcMain.handle('update-app', async () => {
    return await new Promise(async (resolve, reject) => {
        autoUpdater.checkForUpdates().then(res => {
            resolve(res);
        }).catch(error => {
            journalMaj('erreur', 'recherche impossible', error);
            reject({
                error: true,
                message: error
            })
        })
    })
})

autoUpdater.on('update-available', (info) => {
    versionProposee = info?.version;
    if (majBloquee(info?.version)) {
        journalMaj('attention', `${info.version} : installation déjà ratée 2 fois, ignorée`);
        return versFenetreMaj('maj-bloquee', info.version);
    }
    versFenetreMaj('updateAvailable', info?.version);
});

ipcMain.on('start-update', () => {
    majAbandonnee = false;
    autoUpdater.downloadUpdate().catch(err => journalMaj('erreur', 'téléchargement', err));
})

// Le splash a abandonné (téléchargement trop lent / bloqué) : le launcher démarre normalement,
// et si le téléchargement finit plus tard, la mise à jour s'installera à la fermeture du launcher.
ipcMain.on('maj-abandon', () => {
    majAbandonnee = true;
    journalMaj('attention', "mise à jour abandonnée par l'écran de démarrage (trop lente ou bloquée)");
});

autoUpdater.on('update-not-available', () => versFenetreMaj('update-not-available'));

// Téléchargement simple (suit les redirections de GitHub), avec progression
function telecharger(url, dest, progression, redirections = 0) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'PokeFaction-Launcher' } }, res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirections < 6) {
                res.resume();
                return resolve(telecharger(new URL(res.headers.location, url).toString(), dest, progression, redirections + 1));
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
            const total = Number(res.headers['content-length']) || 0;
            let recu = 0;
            const fichier = fs.createWriteStream(dest);
            res.on('data', morceau => {
                recu += morceau.length;
                if (total) progression({ transferred: recu, total, percent: recu / total * 100 });
            });
            res.pipe(fichier);
            fichier.on('finish', () => fichier.close(() => resolve(dest)));
            fichier.on('error', reject);
            res.on('error', reject);
        }).on('error', reject);
    });
}

// Après 2 installations ratées : on télécharge l'installeur dans « Téléchargements » et on l'ouvre,
// comme si le joueur l'avait téléchargé lui-même (au plus une fois par jour).
ipcMain.handle('maj-manuelle', async (_, version) => {
    const t = lireTentative() || {};
    if (t.manuelLe && Date.now() - t.manuelLe < 24 * 3600 * 1000) return { ok: false, raison: "déjà proposé aujourd'hui" };
    majAbandonnee = false;
    const depot = require('../package.json').repository.url.replace('git+', '').replace('.git', '').replace('https://github.com/', '');
    const dest = path.join(app.getPath('downloads'), `PokeFaction-${version}-installation.exe`);
    try {
        journalMaj('info', `installation manuelle de ${version} : téléchargement vers ${dest}`);
        await telecharger(`https://github.com/${depot}/releases/download/v${version}/PokeFaction-win-x64.exe`, dest,
            p => versFenetreMaj('download-progress', p));
        if (majAbandonnee) return { ok: false, raison: 'abandon' };
        fs.writeFileSync(fichierTentative(), JSON.stringify({ ...t, version, manuelLe: Date.now() }));
        const erreur = await shell.openPath(dest);
        if (erreur) throw new Error(erreur);
        journalMaj('info', 'installeur ouvert, fermeture du launcher');
        setTimeout(() => app.quit(), 2500);
        return { ok: true };
    } catch (err) {
        journalMaj('erreur', 'installation manuelle', err);
        return { ok: false, raison: String(err?.message || err) };
    }
});

autoUpdater.on('update-downloaded', (info) => {
    if (majAbandonnee) return journalMaj('info', 'téléchargée après abandon : installée à la fermeture');
    const t = lireTentative();
    const essais = t && t.version === info.version ? t.essais + 1 : 1;
    try { fs.writeFileSync(fichierTentative(), JSON.stringify({ version: info.version, essais })); } catch { }
    journalMaj('info', `installation de ${info.version} (essai ${essais})`);
    versFenetreMaj('update-downloaded', info.version);
    versLauncher('maj-installation', info.version);
    // Petit délai pour que le joueur voie « Installation… », puis l'installeur remplace le launcher et le relance
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 900);
});

// Vers la fenêtre principale (mise à jour lancée depuis le bouton JOUER)
const versLauncher = (canal, ...args) => { const w = MainWindow.getWindow(); if (w && !w.isDestroyed()) w.webContents.send(canal, ...args); };

function plusRecente(a, b) {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
}

// Au clic sur JOUER (et quand le jeu se ferme) : y a-t-il une nouvelle version du launcher ?
ipcMain.handle('maj-avant-jeu', async () => {
    if (!app.isPackaged) return null;
    try {
        const res = await Promise.race([autoUpdater.checkForUpdates(), new Promise(r => setTimeout(() => r(null), 8000))]);
        const v = res?.updateInfo?.version;
        if (!v || !plusRecente(v, app.getVersion()) || majBloquee(v)) return null;
        journalMaj('info', `nouvelle version ${v} trouvée au lancement du jeu`);
        return { version: v };
    } catch (err) {
        journalMaj('erreur', 'vérification avant le jeu', err);
        return null;
    }
});

ipcMain.on('maj-installer', () => {
    majAbandonnee = false;
    autoUpdater.downloadUpdate().catch(err => {
        journalMaj('erreur', 'téléchargement (bouton JOUER)', err);
        versLauncher('maj-erreur', String(err?.message || err));
    });
});

autoUpdater.on('download-progress', (progress) => { versFenetreMaj('download-progress', progress); versLauncher('maj-progression', progress); })

autoUpdater.on('error', (err) => {
    journalMaj('erreur', err);
    versFenetreMaj('error', String(err?.message || err));
});
