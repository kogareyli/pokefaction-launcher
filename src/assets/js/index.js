/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

const { ipcRenderer, shell } = require('electron');
const pkg = require('../package.json');
const os = require('os');
import { config, database } from './utils.js';
const nodeFetch = require("node-fetch");


class Splash {
    constructor() {
        this.splash = document.querySelector(".splash");
        this.splashMessage = document.querySelector(".splash-message");
        this.splashAuthor = document.querySelector(".splash-author");
        this.message = document.querySelector(".message");
        this.progress = document.querySelector(".progress");
        document.addEventListener('DOMContentLoaded', async () => {
            let databaseLauncher = new database();
            let configClient = await databaseLauncher.readData('configClient');
            let theme = configClient?.launcher_config?.theme || "auto"
            let isDarkTheme = await ipcRenderer.invoke('is-dark-theme', theme).then(res => res)
            document.body.className = isDarkTheme ? 'dark global' : 'light global';
            if (process.platform == 'win32') ipcRenderer.send('update-window-progress-load')
            this.startAnimation()
        });
    }

    async startAnimation() {
        let splashes = [
            { "message": "Prêt à capturer ?", "author": "PokéFaction" },
            { "message": "Ta faction t'attend.", "author": "PokéFaction" },
            { "message": "Un Pokémon sauvage apparaît !", "author": "PokéFaction" },
            { "message": "Launcher basé sur Selvania, par Luuxis.", "author": "Luuxis" }
        ];
        let splash = splashes[Math.floor(Math.random() * splashes.length)];
        this.splashMessage.textContent = splash.message;
        this.splashAuthor.children[0].textContent = "@" + splash.author;
        document.querySelector(".splash-version").textContent = `v${pkg.version}`;
        await sleep(100);
        document.querySelector("#splash").style.display = "flex";
        await sleep(150);
        this.splash.classList.add("opacity");
        await sleep(650);
        this.splashMessage.classList.add("opacity");
        this.splashAuthor.classList.add("opacity");
        this.message.classList.add("opacity");
        await sleep(700);
        this.checkUpdate();
    }

    // Ne reste jamais bloqué : sans nouvelle de la mise à jour, le launcher démarre quand même
    // (le modpack est synchronisé par le launcher lui-même, la mise à jour du launcher peut attendre).
    async checkUpdate() {
        this.setStatus('Recherche de mise à jour...');
        this.veille(20000, 'Pas de réponse du serveur de mises à jour');

        ipcRenderer.invoke('update-app').then().catch(err => {
            console.error(err);
            return this.continuer();
        });

        ipcRenderer.on('updateAvailable', (event, version) => {
            this.setStatus(`Mise à jour ${version ? 'v' + version + ' ' : ''}trouvée !`);
            if (os.platform() == 'win32') {
                this.toggleProgress();
                this.veille(45000, 'Téléchargement de la mise à jour trop lent');
                ipcRenderer.send('start-update');
            }
            else { clearTimeout(this.minuteur); return this.dowloadUpdate(); }
        })

        ipcRenderer.on('maj-bloquee', async (event, version) => {
            this.setStatus("La mise à jour automatique est bloquée sur ce PC.<br><span class=\"detail\">Téléchargement de l'installeur…</span>");
            if (!this.progress.classList.contains('show')) this.toggleProgress();
            this.veille(90000, "Téléchargement de l'installeur trop lent");
            const r = await ipcRenderer.invoke('maj-manuelle', version).catch(e => ({ ok: false, raison: String(e) }));
            if (this.suite) return;
            if (r.ok) {
                clearTimeout(this.minuteur);
                this.setStatus('Installeur ouvert : laisse-le faire.<br><span class="detail">Le launcher se ferme et se rouvrira à jour.</span>');
                return;
            }
            clearTimeout(this.minuteur);
            this.setStatus('Mise à jour bloquée sur ce PC (antivirus ?).<br><span class="detail">Tu joues avec la version actuelle.</span>');
            setTimeout(() => this.continuer(), 2500);
        })

        ipcRenderer.on('error', (event, err) => {
            if (err) console.error(err);
            return this.continuer();
        })

        ipcRenderer.on('download-progress', (event, progress) => {
            ipcRenderer.send('update-window-progress', { progress: progress.transferred, size: progress.total })
            this.setProgress(progress.transferred, progress.total);
            const mo = n => (n / 1048576).toFixed(1).replace('.', ',');
            this.setStatus(`Téléchargement de la mise à jour : ${Math.floor(progress.percent || 0)} %<br><span class="detail">${mo(progress.transferred)} / ${mo(progress.total)} Mo</span>`);
            // Tant que ça avance, on laisse faire (45 s sans progrès = abandon)
            this.veille(45000, 'Téléchargement de la mise à jour bloqué');
        })

        ipcRenderer.on('update-downloaded', () => {
            this.setStatus('Installation de la mise à jour…<br><span class="detail">Le launcher va redémarrer tout seul.</span>');
            // Si l'installeur ne se lance pas (antivirus), on ne laisse pas le joueur bloqué
            this.veille(25000, "L'installation ne s'est pas lancée");
        })

        ipcRenderer.on('update-not-available', () => {
            this.continuer();
        })
    }

    // Minuteur de secours : relancé à chaque nouvelle étape, il fait démarrer le launcher s'il expire
    veille(ms, raison) {
        clearTimeout(this.minuteur);
        this.minuteur = setTimeout(() => {
            console.error(raison);
            ipcRenderer.send('maj-abandon');
            this.setStatus(`${raison}.<br><span class="detail">Tu joues avec la version actuelle, elle se mettra à jour plus tard.</span>`);
            setTimeout(() => this.continuer(), 2500);
        }, ms);
    }

    continuer() {
        clearTimeout(this.minuteur);
        if (this.suite) return;
        this.suite = true;
        this.maintenanceCheck();
    }

    getLatestReleaseForOS(os, preferredFormat, asset) {
        return asset.filter(asset => {
            const name = asset.name.toLowerCase();
            const isOSMatch = name.includes(os);
            const isFormatMatch = name.endsWith(preferredFormat);
            return isOSMatch && isFormatMatch;
        }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    }

    async dowloadUpdate() {
        const repoURL = pkg.repository.url.replace("git+", "").replace(".git", "").replace("https://github.com/", "").split("/");
        const githubAPI = await nodeFetch('https://api.github.com').then(res => res.json()).catch(err => err);

        const githubAPIRepoURL = githubAPI.repository_url.replace("{owner}", repoURL[0]).replace("{repo}", repoURL[1]);
        const githubAPIRepo = await nodeFetch(githubAPIRepoURL).then(res => res.json()).catch(err => err);

        const releases_url = await nodeFetch(githubAPIRepo.releases_url.replace("{/id}", '')).then(res => res.json()).catch(err => err);
        const latestRelease = releases_url[0].assets;
        let latest;

        if (os.platform() == 'darwin') latest = this.getLatestReleaseForOS('mac', '.dmg', latestRelease);
        else if (os == 'linux') latest = this.getLatestReleaseForOS('linux', '.appimage', latestRelease);


        this.setStatus(`Mise à jour disponible !<br><div class="download-update">Télécharger</div>`);
        document.querySelector(".download-update").addEventListener("click", () => {
            shell.openExternal(latest.browser_download_url);
            return this.shutdown("Téléchargement en cours...");
        });
    }


    async maintenanceCheck() {
        config.GetConfig().then(res => {
            if (res.maintenance) return this.shutdown(res.maintenance_message);
            this.startLauncher();
        }).catch(e => {
            console.error(e);
            return this.shutdown("Aucune connexion internet détectée,<br>veuillez réessayer ultérieurement.");
        })
    }

    startLauncher() {
        this.setStatus(`Démarrage du launcher`);
        ipcRenderer.send('main-window-open');
        ipcRenderer.send('update-window-close');
    }

    shutdown(text) {
        this.setStatus(`${text}<br>Arrêt dans 5s`);
        let i = 4;
        setInterval(() => {
            this.setStatus(`${text}<br>Arrêt dans ${i--}s`);
            if (i < 0) ipcRenderer.send('update-window-close');
        }, 1000);
    }

    setStatus(text) {
        this.message.innerHTML = text;
    }

    toggleProgress() {
        if (this.progress.classList.toggle("show")) this.setProgress(0, 1);
    }

    setProgress(value, max) {
        this.progress.value = value;
        this.progress.max = max;
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.keyCode == 73 || e.keyCode == 123) {
        ipcRenderer.send("update-window-dev-tools");
    }
})
new Splash();