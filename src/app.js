/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

const { app, ipcMain, nativeTheme } = require('electron');
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

autoUpdater.on('update-downloaded', (info) => {
    if (majAbandonnee) return journalMaj('info', 'téléchargée après abandon : installée à la fermeture');
    const t = lireTentative();
    const essais = t && t.version === info.version ? t.essais + 1 : 1;
    try { fs.writeFileSync(fichierTentative(), JSON.stringify({ version: info.version, essais })); } catch { }
    journalMaj('info', `installation de ${info.version} (essai ${essais})`);
    versFenetreMaj('update-downloaded', info.version);
    // Petit délai pour que le joueur voie « Installation… », puis l'installeur remplace le launcher et le relance
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 900);
});

autoUpdater.on('download-progress', (progress) => versFenetreMaj('download-progress', progress))

autoUpdater.on('error', (err) => {
    journalMaj('erreur', err);
    versFenetreMaj('error', String(err?.message || err));
});
