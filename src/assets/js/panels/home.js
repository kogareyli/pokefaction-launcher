/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */
import { config, database, logger, changePanel, appdata, dossierJeu, setStatus, pkg, popup } from '../utils.js'

const { Launch } = require('minecraft-java-core')
import { PokeFactionAPI, ecrireTicket } from '../utils/pokefaction-api.js'
const { shell, ipcRenderer } = require('electron')
const fs = require('fs')

// Texte lisible pour n'importe quelle erreur renvoyée pendant l'installation ou le lancement du jeu
function messageErreur(err) {
    if (!err) return 'Erreur inconnue.'
    if (typeof err === 'string') return err
    if (typeof err.error === 'string') return err.error
    if (err.error?.message) return err.error.message
    if (err.message) return err.message
    try { return JSON.stringify(err) } catch { return String(err) }
}

// Chemin affiché au joueur avec des \ comme dans l'explorateur Windows
function cheminWindows(chemin) {
    return String(chemin).split('/').join('\\')
}

function echapper(texte) {
    return String(texte).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

// Ce que le joueur peut faire, selon le type d'erreur
function conseilErreur(message, dossier) {
    if (/EPERM|EACCES|EBUSY|ENOENT|operation not permitted|permission denied|resource busy/i.test(message)) {
        return 'Ton antivirus (Norton, Avast…) bloque ou supprime des fichiers du jeu. Ajoute le dossier ' +
            `<b>${dossier}</b> aux exclusions de ton antivirus, puis relance Jouer.`
    }
    if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket|network|fetch failed|timeout|aborted/i.test(message)) {
        return 'Le téléchargement a été coupé. Vérifie ta connexion internet (un antivirus peut aussi la ralentir) ' +
            'et relance Jouer : le launcher reprend là où il s\'était arrêté.'
    }
    if (/java/i.test(message)) {
        return 'Java ne s\'est pas installé correctement. Ton antivirus l\'a peut-être supprimé : ajoute ' +
            `<b>${dossier}</b> à ses exclusions, puis relance Jouer.`
    }
    return `Relance Jouer. Si l'erreur revient, envoie le fichier <b>${dossier}\\erreurs-launcher.txt</b> à un admin.`
}

// Le journal ne doit jamais contenir le jeton Microsoft (il permettrait d'utiliser le compte du joueur)
function masquerSecrets(texte) {
    return texte
        .replace(/(--accessToken[\s,"']+)[^\s,"']+/gi, '$1[caché]')
        .replace(/(--clientId[\s,"']+)[^\s,"']+/gi, '$1[caché]')
        .replace(/(--xuid[\s,"']+)[^\s,"']+/gi, '$1[caché]')
}

function ecrireJournalJeu(dossier, texte) {
    try {
        fs.mkdirSync(dossier, { recursive: true })
        fs.writeFileSync(`${dossier}/dernier-lancement.txt`, texte)
    } catch { /* pas grave */ }
}

// Le jeu s'est-il fermé tout seul ? Si oui, explication simple. Sinon (le joueur a quitté) : null.
function diagnosticPlantage(sortie, dossier) {
    if (/Could not reserve enough space|Error occurred during initialization of VM|Invalid maximum heap size/i.test(sortie)) {
        return 'Ton PC n\'a pas assez de mémoire libre pour la RAM choisie. Ouvre les paramètres du launcher ' +
            '(roue en bas à droite), puis Java, et baisse la RAM maximum (essaie 4 Go). Ferme aussi les autres programmes.'
    }
    if (/OutOfMemoryError|GC overhead limit/i.test(sortie)) {
        return 'Le jeu a manqué de mémoire. Ouvre les paramètres du launcher (roue en bas à droite), puis Java, ' +
            'et monte la RAM maximum à 6 Go si ton PC a 12 Go ou plus.'
    }
    if (/EPERM|EACCES|AccessDenied|Access is denied|Accès refusé|ClassNotFoundException|NoClassDefFoundError|ZipException|zip END header|invalid LOC header/i.test(sortie)) {
        return 'Des fichiers du jeu sont abîmés ou bloqués, souvent par un antivirus (Norton, Avast…). Ajoute ' +
            `<b>${dossier}</b> aux exclusions de ton antivirus, puis relance Jouer : ` +
            'le launcher retélécharge ce qui manque.'
    }
    if (/Incompatible mods? found|requires .* which is missing|Mod resolution failed/i.test(sortie)) {
        return 'Un mod refuse de se lancer (mods incompatibles). Préviens un admin et envoie-lui le fichier ci-dessous.'
    }
    let rapport = sortie.match(/Crash report saved to:?[\s#@!]*(\S+\.txt)/i)
    if (rapport) {
        return 'Minecraft a planté. Envoie à un admin le fichier ci-dessous et le rapport de plantage : ' +
            `<b>${echapper(rapport[1])}</b>`
    }
    // Pas de « Stopping! » : Minecraft ne s'est pas arrêté normalement
    if (!/Stopping!/.test(sortie)) {
        return 'Minecraft s\'est fermé sans prévenir. Si tu ne l\'as pas fermé toi-même : baisse la RAM dans les ' +
            'paramètres du launcher (roue en bas à droite, Java), vérifie ton antivirus, puis relance Jouer.'
    }
    return null
}

// Garde une trace des erreurs pour pouvoir les envoyer à un admin
function journaliserErreur(dossier, message) {
    try {
        fs.mkdirSync(dossier, { recursive: true })
        fs.appendFileSync(`${dossier}/erreurs-launcher.txt`, `[${new Date().toLocaleString('fr-FR')}] ${message}\n`)
    } catch { /* pas grave */ }
}

class Home {
    static id = "home";
    async init(config) {
        this.config = config;
        this.db = new database();
        this.news()
        this.socialLick()
        this.instancesSelect()
        document.querySelector('.settings-btn').addEventListener('click', e => changePanel('settings'))
    }

    async news() {
        let newsElement = document.querySelector('.news-list');
        let news = await config.getNews(this.config).then(res => res).catch(err => false);
        if (news) {
            if (!news.length) {
                let blockNews = document.createElement('div');
                const date = this.getdate(new Date())
                blockNews.classList.add('news-block');
                blockNews.innerHTML = `
                    <div class="news-header">
                        <img class="server-status-icon" src="assets/images/icon/icon.png">
                        <div class="header-text">
                            <div class="title">Aucun news n'ai actuellement disponible.</div>
                        </div>
                        <div class="date">
                            <div class="day">${date.day}</div>
                            <div class="month">${date.month}</div>
                        </div>
                    </div>
                    <div class="news-content">
                        <div class="bbWrapper">
                            <p>Vous pourrez suivre ici toutes les news relative au serveur.</p>
                        </div>
                    </div>`
                newsElement.appendChild(blockNews);
            } else {
                for (let News of news) {
                    let date = this.getdate(News.publish_date)
                    let blockNews = document.createElement('div');
                    blockNews.classList.add('news-block');
                    blockNews.innerHTML = `
                        <div class="news-header">
                            <img class="server-status-icon" src="assets/images/icon/icon.png">
                            <div class="header-text">
                                <div class="title">${News.title}</div>
                            </div>
                            <div class="date">
                                <div class="day">${date.day}</div>
                                <div class="month">${date.month}</div>
                            </div>
                        </div>
                        <div class="news-content">
                            <div class="bbWrapper">
                                <p>${News.content.replace(/\n/g, '</br>')}</p>
                                <p class="news-author">Auteur - <span>${News.author}</span></p>
                            </div>
                        </div>`
                    newsElement.appendChild(blockNews);
                }
            }
        } else {
            let blockNews = document.createElement('div');
            const date = this.getdate(new Date())
            blockNews.classList.add('news-block');
            blockNews.innerHTML = `
                <div class="news-header">
                        <img class="server-status-icon" src="assets/images/icon/icon.png">
                        <div class="header-text">
                            <div class="title">Error.</div>
                        </div>
                        <div class="date">
                            <div class="day">${date.day}</div>
                            <div class="month">${date.month}</div>
                        </div>
                    </div>
                    <div class="news-content">
                        <div class="bbWrapper">
                            <p>Impossible de contacter le serveur des news.</br>Merci de vérifier votre configuration.</p>
                        </div>
                    </div>`
            newsElement.appendChild(blockNews);
        }
    }

    socialLick() {
        document.querySelectorAll('.social-block').forEach(e => {
            e.addEventListener('click', () => {
                const url = e.dataset.url;
                if ('https:' !== new URL(url).protocol) return;
                shell.openExternal(url)
            })
        })
    }

    async instancesSelect() {
        let configClient = await this.db.readData('configClient')
        let auth = await this.db.readData('accounts', configClient.account_selected)
        let instancesList = await config.getInstanceList()
        let instanceSelect = instancesList.find(i => i.name == configClient?.instance_select) ? configClient?.instance_select : null

        let instanceBTN = document.querySelector('.play-instance')
        let instancePopup = document.querySelector('.instance-popup')
        let instancesListPopup = document.querySelector('.instances-List')
        let instanceCloseBTN = document.querySelector('.close-popup')

        if (instancesList.length === 1) {
            document.querySelector('.instance-select').style.display = 'none'
            instanceBTN.style.paddingRight = '0'
        }

        if (!instanceSelect) {
            let newInstanceSelect = instancesList.find(i => i.whitelistActive == false)
            let configClient = await this.db.readData('configClient')
            configClient.instance_select = newInstanceSelect.name
            instanceSelect = newInstanceSelect.name
            await this.db.updateData('configClient', configClient)
        }

        for (let instance of instancesList) {
            if (instance.whitelistActive) {
                let whitelist = instance.whitelist.find(whitelist => whitelist == auth?.name)
                if (whitelist !== auth?.name) {
                    if (instance.name == instanceSelect) {
                        let newInstanceSelect = instancesList.find(i => i.whitelistActive == false)
                        let configClient = await this.db.readData('configClient')
                        configClient.instance_select = newInstanceSelect.name
                        instanceSelect = newInstanceSelect.name
                        setStatus(newInstanceSelect.status)
                        await this.db.updateData('configClient', configClient)
                    }
                }
            } else console.log(`Initializing instance ${instance.name}...`)
            if (instance.name == instanceSelect) setStatus(instance.status)
        }

        instancePopup.addEventListener('click', async e => {
            let configClient = await this.db.readData('configClient')

            if (e.target.classList.contains('instance-elements')) {
                let newInstanceSelect = e.target.id
                let activeInstanceSelect = document.querySelector('.active-instance')

                if (activeInstanceSelect) activeInstanceSelect.classList.toggle('active-instance');
                e.target.classList.add('active-instance');

                configClient.instance_select = newInstanceSelect
                await this.db.updateData('configClient', configClient)
                instanceSelect = instancesList.filter(i => i.name == newInstanceSelect)
                instancePopup.style.display = 'none'
                let instance = await config.getInstanceList()
                let options = instance.find(i => i.name == configClient.instance_select)
                await setStatus(options.status)
            }
        })

        instanceBTN.addEventListener('click', async e => {
            let configClient = await this.db.readData('configClient')
            let instanceSelect = configClient.instance_select
            let auth = await this.db.readData('accounts', configClient.account_selected)

            if (e.target.classList.contains('instance-select')) {
                instancesListPopup.innerHTML = ''
                for (let instance of instancesList) {
                    if (instance.whitelistActive) {
                        instance.whitelist.map(whitelist => {
                            if (whitelist == auth?.name) {
                                if (instance.name == instanceSelect) {
                                    instancesListPopup.innerHTML += `<div id="${instance.name}" class="instance-elements active-instance">${instance.name}</div>`
                                } else {
                                    instancesListPopup.innerHTML += `<div id="${instance.name}" class="instance-elements">${instance.name}</div>`
                                }
                            }
                        })
                    } else {
                        if (instance.name == instanceSelect) {
                            instancesListPopup.innerHTML += `<div id="${instance.name}" class="instance-elements active-instance">${instance.name}</div>`
                        } else {
                            instancesListPopup.innerHTML += `<div id="${instance.name}" class="instance-elements">${instance.name}</div>`
                        }
                    }
                }

                instancePopup.style.display = 'flex'
            }

            if (!e.target.classList.contains('instance-select')) this.startGame()
        })

        instanceCloseBTN.addEventListener('click', () => instancePopup.style.display = 'none')
    }

    async startGame() {
        let launch = new Launch()
        let configClient = await this.db.readData('configClient')
        let instance = await config.getInstanceList()
        let authenticator = await this.db.readData('accounts', configClient.account_selected)
        let options = instance.find(i => i.name == configClient.instance_select)

        let playInstanceBTN = document.querySelector('.play-instance')
        let infoStartingBOX = document.querySelector('.info-starting-game')
        let infoStarting = document.querySelector(".info-starting-game-text")
        let progressBar = document.querySelector('.progress-bar')

        let chemin = await dossierJeu(this.config.dataDirectory)

        // Comptes PokéFaction : ticket de jeu (12 h) que le serveur vérifie quand on se connecte
        if (this.config.auth === 'pokefaction') {
            playInstanceBTN.style.display = "none"
            infoStartingBOX.style.display = "block"
            infoStarting.innerHTML = `Connexion au compte PokéFaction...`
            try {
                if (!authenticator?.pokefaction?.session) throw new Error('Session expirée : reconnecte-toi.')
                let api = new PokeFactionAPI(this.config.pokefaction_api)
                if (authenticator.meta?.type === 'Xbox') {
                    // Compte Microsoft : on revérifie auprès de Mojang (suit aussi un changement de pseudo)
                    let reponse = await api.microsoft(authenticator)
                    authenticator.pokefaction = { session: reponse.session, pseudo: reponse.pseudo, type: reponse.type }
                    await this.db.updateData('accounts', authenticator, authenticator.ID)
                }
                let ticket = await api.ticket(authenticator.pokefaction.session)
                let serveurs = [options.status?.ip, ...(options.serveurs_pokefaction || [])].filter(Boolean)
                ecrireTicket(`${chemin}/instances/${options.name}`, ticket, serveurs)
            } catch (err) {
                playInstanceBTN.style.display = "flex"
                infoStartingBOX.style.display = "none"
                infoStarting.innerHTML = `Vérification`
                if (/^Session expirée/.test(err.message)) {
                    await this.db.deleteData('accounts', authenticator?.ID)
                    configClient.account_selected = null
                    await this.db.updateData('configClient', configClient)
                    document.getElementById(`${authenticator?.ID}`)?.remove()
                    changePanel('login')
                }
                new popup().openPopup({ title: 'Compte PokéFaction', content: err.message, color: 'red', options: true })
                return
            }
        }

        let opt = {
            url: options.url,
            authenticator: authenticator,
            timeout: 30000, // Norton & co ralentissent chaque connexion : 10 s ne suffisaient pas
            path: chemin,
            instance: options.name,
            version: options.loader.minecraft_version,
            detached: configClient.launcher_config.closeLauncher == "close-all" ? false : true,
            downloadFileMultiple: configClient.launcher_config.download_multi,
            intelEnabledMac: configClient.launcher_config.intelEnabledMac,

            loader: {
                type: options.loader.loader_type,
                build: options.loader.loader_version,
                enable: options.loader.loader_type == 'none' ? false : true
            },

            verify: options.verify,

            ignored: [...options.ignored],

            java: {
                path: configClient.java_config.java_path,
            },

            JVM_ARGS:  options.jvm_args ? options.jvm_args : [],
            GAME_ARGS: options.game_args ? options.game_args : [],

            screen: {
                width: configClient.game_config.screen_size.width,
                height: configClient.game_config.screen_size.height
            },

            memory: {
                min: `${configClient.java_config.java_memory.min * 1024}M`,
                max: `${configClient.java_config.java_memory.max * 1024}M`
            }
        }

        launch.Launch(opt);

        playInstanceBTN.style.display = "none"
        infoStartingBOX.style.display = "block"
        progressBar.style.display = "";
        ipcRenderer.send('main-window-progress-load')

        launch.on('extract', extract => {
            ipcRenderer.send('main-window-progress-load')
            console.log(extract);
        });

        launch.on('progress', (progress, size) => {
            infoStarting.innerHTML = `Téléchargement ${((progress / size) * 100).toFixed(0)}%`
            ipcRenderer.send('main-window-progress', { progress, size })
            progressBar.value = progress;
            progressBar.max = size;
        });

        launch.on('check', (progress, size) => {
            infoStarting.innerHTML = `Vérification ${((progress / size) * 100).toFixed(0)}%`
            ipcRenderer.send('main-window-progress', { progress, size })
            progressBar.value = progress;
            progressBar.max = size;
        });

        launch.on('estimated', (time) => {
            let hours = Math.floor(time / 3600);
            let minutes = Math.floor((time - hours * 3600) / 60);
            let seconds = Math.floor(time - hours * 3600 - minutes * 60);
            console.log(`${hours}h ${minutes}m ${seconds}s`);
        })

        launch.on('speed', (speed) => {
            console.log(`${(speed / 1067008).toFixed(2)} Mb/s`)
        })

        launch.on('patch', patch => {
            console.log(patch);
            ipcRenderer.send('main-window-progress-load')
            infoStarting.innerHTML = `Patch en cours...`
        });

        // Journal du jeu : gardé pour expliquer un plantage et pour l'envoyer à un admin
        let journalJeu = []
        let tailleJournal = 0

        launch.on('data', (e) => {
            progressBar.style.display = "none"
            if (configClient.launcher_config.closeLauncher == 'close-launcher') {
                ipcRenderer.send("main-window-hide")
            };
            new logger('Minecraft', '#36b030');
            ipcRenderer.send('main-window-progress-load')
            infoStarting.innerHTML = `Demarrage en cours...`
            console.log(e);
            let ligne = String(e)
            journalJeu.push(ligne)
            tailleJournal += ligne.length
            while (tailleJournal > 3_000_000 && journalJeu.length > 1) tailleJournal -= journalJeu.shift().length
        })

        launch.on('close', code => {
            if (configClient.launcher_config.closeLauncher == 'close-launcher') {
                ipcRenderer.send("main-window-show")
            };
            ipcRenderer.send('main-window-progress-reset')
            infoStartingBOX.style.display = "none"
            playInstanceBTN.style.display = "flex"
            infoStarting.innerHTML = `Vérification`
            new logger(pkg.name, '#7289da');
            console.log('Close');

            let sortie = masquerSecrets(journalJeu.join(''))
            ecrireJournalJeu(chemin, sortie)
            let dossierWindows = echapper(cheminWindows(chemin))
            let plantage = diagnosticPlantage(sortie, dossierWindows)
            if (plantage) {
                new popup().openPopup({
                    title: 'Le jeu s\'est fermé',
                    content: `${plantage}<br><br><span style="opacity:.8">Détails pour un admin : ` +
                        `<b>${dossierWindows}\\dernier-lancement.txt</b></span>`,
                    color: 'red',
                    options: true
                })
            }
        });

        launch.on('error', err => {
            let popupError = new popup()
            // minecraft-java-core renvoie soit { error: '…' }, soit une vraie erreur Windows (err.message) :
            // avant, seul err.error était affiché, d'où le message « undefined ».
            let message = messageErreur(err)
            journaliserErreur(chemin, message)

            popupError.openPopup({
                title: 'Erreur',
                content: `${echapper(message)}<br><br>${conseilErreur(message, echapper(cheminWindows(chemin)))}`,
                color: 'red',
                options: true
            })

            if (configClient.launcher_config.closeLauncher == 'close-launcher') {
                ipcRenderer.send("main-window-show")
            };
            ipcRenderer.send('main-window-progress-reset')
            infoStartingBOX.style.display = "none"
            playInstanceBTN.style.display = "flex"
            infoStarting.innerHTML = `Vérification`
            new logger(pkg.name, '#7289da');
            console.log(err);
        });
    }

    getdate(e) {
        let date = new Date(e)
        let year = date.getFullYear()
        let month = date.getMonth() + 1
        let day = date.getDate()
        let allMonth = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
        return { year: year, month: allMonth[month - 1], day: day }
    }
}
export default Home;