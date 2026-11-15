/**
 * PokéFaction Anti-Cheat (4.3), côté processus principal : petite fenêtre d'analyse au clic sur Jouer (comme Vanguard),
 * puis une icône près de l'horloge tant que le jeu tourne (« PokéFaction Anti-Cheat : actif »).
 * L'analyse elle-même est faite par la page du launcher (utils/anti-triche.js), qui envoie ses étapes ici.
 */
"use strict";
const { app, BrowserWindow, Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const os = require("os");

let fenetre = null;
let icone = null;

function cheminIcone() {
    // chemins écrits « src/… » : build.js les change en « app/… » dans le launcher installé
    return path.join(`${app.getAppPath()}/src/assets/images/icon/`, os.platform() === "win32" ? "icon.ico" : "icon.png");
}

/** Ouvre la fenêtre d'analyse (au milieu de l'écran, toujours devant). Résolu quand elle est affichée. */
function ouvrir() {
    fermer();
    return new Promise(resolve => {
        fenetre = new BrowserWindow({
            title: "PokéFaction Anti-Cheat",
            width: 440,
            height: 300,
            resizable: false,
            maximizable: false,
            minimizable: false,
            alwaysOnTop: true,
            frame: false,
            show: false,
            skipTaskbar: false,
            backgroundColor: "#0a0a0b",
            icon: cheminIcone(),
            webPreferences: { contextIsolation: false, nodeIntegration: true },
        });
        fenetre.setMenuBarVisibility(false);
        fenetre.loadFile(path.join(`${app.getAppPath()}/src/anticheat.html`));
        fenetre.once("ready-to-show", () => { if (fenetre) fenetre.show(); resolve(true); });
        fenetre.on("closed", () => { fenetre = null; });
        setTimeout(() => resolve(false), 5000);
    });
}

function progres(p) {
    if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send("anticheat-progres", p);
}

function fermer() {
    if (fenetre && !fenetre.isDestroyed()) fenetre.close();
    fenetre = null;
}

/** Icône près de l'horloge pendant la partie. */
function activer() {
    if (icone) return;
    try {
        icone = new Tray(nativeImage.createFromPath(cheminIcone()));
        icone.setToolTip("PokéFaction Anti-Cheat : actif");
        icone.setContextMenu(Menu.buildFromTemplate([
            { label: "PokéFaction Anti-Cheat", enabled: false },
            { label: "Protection active pendant ta partie", enabled: false },
            { type: "separator" },
            { label: "Les tricheurs sont expulsés puis bannis par le staff", enabled: false },
        ]));
    } catch (e) { icone = null; }
}

function desactiver() {
    if (icone) { try { icone.destroy(); } catch (e) { } }
    icone = null;
}

module.exports = { ouvrir, progres, fermer, activer, desactiver };
