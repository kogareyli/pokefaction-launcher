/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

const { ipcRenderer } = require('electron')
const { Status } = require('minecraft-java-core')
const fs = require('fs');
const pkg = require('../package.json');

import config, { enMaintenance, texteMaintenance } from './utils/config.js';
import database from './utils/database.js';
import logger from './utils/logger.js';
import popup from './utils/popup.js';
import { skin2D } from './utils/skin.js';
import slider from './utils/slider.js';
import { teteDuSkinChoisi } from './utils/skin-choix.js';

async function setBackground(theme) {
    if (typeof theme == 'undefined') {
        let databaseLauncher = new database();
        let configClient = await databaseLauncher.readData('configClient');
        theme = configClient?.launcher_config?.theme || "auto"
        theme = await ipcRenderer.invoke('is-dark-theme', theme).then(res => res)
    }
    // Le fond (lueurs, grille, cubes) est dessiné en CSS + canvas : seul le thème change ici
    document.body.classList.toggle('dark', !!theme);
    document.body.classList.toggle('light', !theme);
    document.body.classList.add('global');
}

async function changePanel(id) {
    let panel = document.querySelector(`.panels .${id}`);
    let active = document.querySelector(`.panels .active`)
    if (active === panel) return;
    if (active) active.classList.remove("active");
    panel.classList.add("active");
    document.body.dataset.panel = id;
    document.querySelectorAll('.rail-btn[data-panel]').forEach(b => b.classList.toggle('rail-actif', b.dataset.panel == id));
}

async function appdata() {
    return await ipcRenderer.invoke('appData').then(path => path)
}

/**
 * Dossier où le jeu est installé.
 * Java ne sait pas ouvrir un .jar dont le chemin contient « ! » (séparateur des URL jar:), ni bien gérer
 * « # » ou « % » : avec un nom d'utilisateur Windows comme « Cys! », Minecraft plantait au démarrage
 * (« Error reading mappings »). Dans ce cas, le jeu va dans C:\ProgramData à la place.
 */
async function dossierJeu(dataDirectory) {
    const base = await appdata()
    const nom = process.platform == 'darwin' ? dataDirectory : `.${dataDirectory}`
    if (process.platform == 'win32' && /[!#%]/.test(base)) {
        return `${process.env.ProgramData || 'C:\\ProgramData'}/${nom}`
    }
    return `${base}/${nom}`
}

async function addAccount(data) {
    let skin = false
    if (data?.profile?.skins[0]?.base64) skin = await new skin2D().creatHeadTexture(data.profile.skins[0].base64);
    let div = document.createElement("div");
    div.classList.add("account");
    div.id = data.ID;
    div.innerHTML = `
        <div class="profile-image" ${skin ? 'style="background-image: url(' + skin + ');"' : ''}></div>
        <div class="profile-infos">
            <div class="profile-pseudo">${data.name}</div>
            <div class="profile-uuid">${data.uuid}</div>
        </div>
        <div class="delete-profile" id="${data.ID}">
            <div class="icon-account-delete delete-profile-icon"></div>
        </div>
    `
    return document.querySelector('.accounts-list').appendChild(div);
}

async function accountSelect(data) {
    let account = document.getElementById(`${data.ID}`);
    let activeAccount = document.querySelector('.account-select')

    if (activeAccount) activeAccount.classList.toggle('account-select');
    account.classList.add('account-select');
    let joueur = document.querySelector('.rail-joueur');
    if (joueur) joueur.dataset.bulle = data.name;
    if (data?.profile?.skins[0]?.base64) await headplayer(data.profile.skins[0].base64);
    else document.querySelector(".player-head").style.backgroundImage = '';
    // Skin choisi dans « Mon skin » : la tête de la barre latérale le suit
    try {
        const cfg = await new database().readData('configClient');
        const tete = await teteDuSkinChoisi(cfg?.skins?.[String(data?.name || '').toLowerCase()]);
        if (tete) document.querySelector(".player-head").style.backgroundImage = `url(${tete})`;
    } catch (err) { console.error('tête du skin', err) }
}

async function headplayer(skinBase64) {
    let skin = await new skin2D().creatHeadTexture(skinBase64);
    document.querySelector(".player-head").style.backgroundImage = `url(${skin})`;
}

async function setStatus(opt) {
    let statut = document.querySelector('.statut')
    if (!statut) return
    let texte = statut.querySelector('.statut-texte')
    let joueurs = statut.querySelector('.player-count')
    let ping = statut.querySelector('.statut-ping')
    let fermer = () => {
        statut.dataset.etat = 'hors-ligne'
        texte.textContent = 'Serveur fermé'
        joueurs.textContent = '0'
        if (ping) ping.textContent = ''
    }
    if (!opt) return fermer()

    let { ip, port, nameServer } = opt
    if (nameServer) document.querySelector('.server-status-name').textContent = nameServer
    // Comme Minecraft : si l'adresse a un enregistrement SRV (_minecraft._tcp), on suit sa cible et son port
    try {
        const srv = await require('dns').promises.resolveSrv(`_minecraft._tcp.${ip}`)
        if (srv && srv.length) { ip = srv[0].name; port = srv[0].port }
    } catch { /* pas de SRV : adresse et port tels quels */ }
    if (statut.dataset.etat !== 'en-ligne') {
        statut.dataset.etat = 'chargement'
        texte.textContent = 'Connexion au serveur…'
    }
    let status = new Status(ip, port);
    let statusServer = await status.getStatus().then(res => res).catch(err => err);

    if (!statusServer.error) {
        statut.dataset.etat = 'en-ligne'
        texte.textContent = 'En ligne'
        joueurs.textContent = statusServer.playersConnect ? statusServer.playersConnect : '0'
        if (ping) ping.textContent = ''
    } else fermer()
}

export {
    appdata as appdata,
    dossierJeu as dossierJeu,
    changePanel as changePanel,
    config as config,
    enMaintenance as enMaintenance,
    texteMaintenance as texteMaintenance,
    database as database,
    logger as logger,
    popup as popup,
    setBackground as setBackground,
    skin2D as skin2D,
    addAccount as addAccount,
    accountSelect as accountSelect,
    slider as Slider,
    pkg as pkg,
    setStatus as setStatus
}