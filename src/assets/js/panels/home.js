/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */
import { config, database, logger, changePanel, appdata, dossierJeu, setStatus, pkg, popup, enMaintenance, texteMaintenance } from '../utils.js'

const { Launch } = require('minecraft-java-core')
import { PokeFactionAPI, ecrireTicket } from '../utils/pokefaction-api.js'
import { appliquerGraphismes } from '../utils/onglets-pf.js'
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
    // (Plus de message quand le jeu se ferme sans trace d'erreur : c'est le joueur qui l'a fermé.)
    if (false) {
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
    }

    async news() {
        let newsElement = document.querySelector('.news-list');
        let news = await config.getNews(this.config).then(res => res).catch(err => false);
        // Images d'un article : seulement des liens https (hébergées avec le launcher sur GitHub), 3 au plus
        let images = (liste) => {
            let urls = (Array.isArray(liste) ? liste : liste ? [liste] : []).filter(u => typeof u === 'string' && u.startsWith('https://')).slice(0, 3);
            if (!urls.length) return '';
            return `<div class="news-images" data-n="${urls.length}">${urls.map(u =>
                `<button class="news-image" data-src="${encodeURI(u)}"><img src="${encodeURI(u)}" loading="lazy" alt="" /></button>`).join('')}</div>`;
        };
        let carte = (i, date, titre, contenu, auteur, img) => {
            let bloc = document.createElement('div');
            bloc.classList.add('news-block');
            bloc.style.setProperty('--i', i);
            bloc.innerHTML = `
                <div class="news-header">
                    <div class="news-date">
                        <div class="day">${date.day}</div>
                        <div class="month">${date.court}</div>
                    </div>
                    <div class="header-text">
                        <div class="title">${titre}</div>
                    </div>
                </div>
                ${images(img)}
                <div class="news-content">
                    <div class="bbWrapper">
                        <p>${contenu}</p>
                        ${auteur ? `<p class="news-author">Par <span>${auteur}</span></p>` : ''}
                    </div>
                </div>`;
            newsElement.appendChild(bloc);
        };
        if (news) {
            if (!news.length) {
                carte(0, this.getdate(new Date()), 'Aucune actualité pour le moment', 'Tu pourras suivre ici toutes les nouveautés du serveur.');
            } else {
                news.forEach((News, i) => carte(i, this.getdate(News.publish_date), News.title, News.content.replace(/\n/g, '</br>'), News.author, News.images || News.image));
                this.visionneuse(newsElement);
            }
        } else {
            carte(0, this.getdate(new Date()), 'Actualités indisponibles', 'Impossible de récupérer les actualités.</br>Vérifie ta connexion internet.');
        }
    }

    // Clic sur une image d'actualité : affichée en grand ; clic ou Échap pour fermer
    visionneuse(liste) {
        let fond = document.createElement('div');
        fond.className = 'visionneuse';
        fond.innerHTML = '<img alt="" />';
        document.body.appendChild(fond);
        let fermer = () => fond.classList.remove('ouverte');
        fond.addEventListener('click', fermer);
        document.addEventListener('keydown', e => { if (e.key === 'Escape') fermer(); });
        liste.addEventListener('click', e => {
            let bouton = e.target.closest('.news-image');
            if (!bouton) return;
            fond.querySelector('img').src = bouton.dataset.src;
            fond.classList.add('ouverte');
        });
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
            if (instance.name == instanceSelect) {
                setStatus(instance.status)
                this.afficherVersion(instance)
            }
        }

        // Statut du serveur rafraîchi toutes les minutes (seulement quand l'accueil est affiché)
        setInterval(async () => {
            if (!document.querySelector('.home.active') || document.hidden) return
            let configClient = await this.db.readData('configClient')
            let instance = instancesList.find(i => i.name == configClient?.instance_select)
            if (instance) setStatus(instance.status)
        }, 60000)

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
                this.afficherVersion(options)
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

    afficherVersion(instance) {
        let version = document.querySelector('.hero-version')
        if (version && instance?.loader) version.textContent = `${instance.loader.minecraft_version} · Cobbleverse`
    }

    // Mise à jour du launcher lancée depuis JOUER : progression dans la barre, puis redémarrage automatique
    mettreAJourLauncher(version) {
        document.querySelector('.play-instance').style.display = 'none'
        document.querySelector('.info-starting-game').style.display = 'block'
        this.progression(`Mise à jour du launcher ${version}…`)
        ipcRenderer.removeAllListeners('maj-progression')
        ipcRenderer.removeAllListeners('maj-installation')
        ipcRenderer.removeAllListeners('maj-erreur')
        ipcRenderer.on('maj-progression', (_, p) => this.progression(`Mise à jour du launcher ${version}`, Math.round(p.percent || 0), 100))
        ipcRenderer.on('maj-installation', () => this.progression('Installation… le launcher va redémarrer'))
        ipcRenderer.on('maj-erreur', () => {
            // Impossible de mettre à jour maintenant : on joue quand même avec la version actuelle
            this.majEnCours = false
            this.progression('Mise à jour impossible pour le moment, lancement du jeu…')
            setTimeout(() => this.startGame(true), 1500)
        })
        ipcRenderer.send('maj-installer')
    }

    // Barre de progression : texte, pourcentage, remplissage (ou animation d'attente si max = 0)
    progression(texte, valeur = 0, max = 0) {
        document.querySelector('.info-starting-game-text').textContent = texte
        let pourcent = document.querySelector('.info-pourcent')
        let barre = document.querySelector('.barre')
        if (max > 0) {
            let p = Math.max(0, Math.min(100, valeur / max * 100))
            pourcent.textContent = `${p.toFixed(0)} %`
            barre.classList.remove('attente')
            barre.querySelector('.barre-remplie').style.setProperty('--p', `${p}%`)
        } else {
            pourcent.textContent = ''
            barre.classList.add('attente')
        }
    }

    // Un seul lancement à la fois : avant, chaque clic sur JOUER pendant les vérifications (Microsoft lent ou en
    // panne) lançait un Minecraft de plus. Le bouton est caché tout de suite et réaffiché si on ne lance pas.
    async startGame(sansMaj = false) {
        if (this.lancementEnCours) return
        this.lancementEnCours = true
        const bouton = document.querySelector('.play-instance'), boite = document.querySelector('.info-starting-game')
        bouton.style.display = 'none'
        boite.style.display = 'block'
        this.progression('Préparation…')
        let lance = false
        try {
            lance = await this.demarrerJeu(sansMaj)
        } finally {
            if (!lance) {
                this.lancementEnCours = false
                if (!this.majEnCours) { bouton.style.display = 'flex'; boite.style.display = 'none' }
            }
        }
    }

    /** Prépare et lance le jeu. true = le jeu est lancé (la fin du lancement est gérée par close / error). */
    async demarrerJeu(sansMaj) {
        // Maintenance en cours ? (activée par le PokéFaction Panel pendant les mises à jour du serveur)
        try {
            let conf = await config.GetConfig()
            if (enMaintenance(conf)) {
                new popup().openPopup({ title: 'Maintenance en cours', content: texteMaintenance(conf) + '<br>Réessaie dans quelques minutes.', color: 'red', options: true })
                return
            }
        } catch (e) { }
        // Nouvelle version du launcher ? Installée avant de jouer (le launcher redémarre tout seul).
        // Les mods, eux, sont vérifiés à chaque lancement (liste relue en ligne juste en dessous).
        if (!sansMaj) {
            let maj = await ipcRenderer.invoke('maj-avant-jeu').catch(() => null)
            if (maj?.version) { this.majEnCours = true; this.mettreAJourLauncher(maj.version); return false }
        }
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
            this.progression('Connexion au compte PokéFaction…')
            try {
                if (!authenticator?.pokefaction?.session) throw new Error('Session expirée : reconnecte-toi.')
                let api = new PokeFactionAPI(this.config.pokefaction_api)
                if (authenticator.meta?.type === 'Xbox') {
                    // Compte Microsoft : on revérifie auprès de Mojang (suit aussi un changement de pseudo)
                    // Si Microsoft / Mojang ne répondent pas, on garde la session PokéFaction déjà enregistrée
                    try {
                        let reponse = await api.microsoft(authenticator)
                        authenticator.pokefaction = { session: reponse.session, pseudo: reponse.pseudo, type: reponse.type }
                        await this.db.updateData('accounts', authenticator, authenticator.ID)
                    } catch (err) {
                        if (/^Session expirée/.test(err.message)) throw err
                        console.error('[Compte] vérification Microsoft impossible, session gardée :', err.message)
                    }
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
                return false
            }
        }

        // Graphismes choisis dans les paramètres (PC faible / équilibré / beau)
        try { appliquerGraphismes(`${chemin}/instances/${options.name}`, configClient.graphismes) } catch (err) { console.error('graphismes', err) }

        // Skin choisi dans le launcher : le mod PokéFaction l'envoie au serveur en arrivant
        try {
            let dossierPF = `${chemin}/instances/${options.name}/pokefaction`
            fs.mkdirSync(dossierPF, { recursive: true })
            let choixSkin = configClient.skins?.[String(authenticator?.name || '').toLowerCase()] || { type: 'auto' }
            fs.writeFileSync(`${dossierPF}/skin.json`, JSON.stringify(choixSkin))
        } catch (err) { console.error('skin.json', err) }

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
        // Le jeu a-t-il démarré ? (après, une « erreur » de la bibliothèque n'est plus un problème de téléchargement)
        let jeuDemarre = false

        playInstanceBTN.style.display = "none"
        infoStartingBOX.style.display = "block"
        progressBar.style.display = "";
        this.progression('Préparation…')
        ipcRenderer.send('main-window-progress-load')

        launch.on('extract', extract => {
            ipcRenderer.send('main-window-progress-load')
            console.log(extract);
        });

        launch.on('progress', (progress, size) => {
            this.progression('Téléchargement des fichiers', progress, size)
            ipcRenderer.send('main-window-progress', { progress, size })
            progressBar.value = progress;
            progressBar.max = size;
        });

        launch.on('check', (progress, size) => {
            this.progression('Vérification des fichiers', progress, size)
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
            this.progression('Installation de Fabric…')
        });

        // Journal du jeu : gardé pour expliquer un plantage et pour l'envoyer à un admin
        let journalJeu = []
        let tailleJournal = 0

        launch.on('data', (e) => {
            jeuDemarre = true
            progressBar.style.display = "none"
            if (configClient.launcher_config.closeLauncher == 'close-launcher') {
                ipcRenderer.send("main-window-hide")
            };
            new logger('Minecraft', '#36b030');
            ipcRenderer.send('main-window-progress-load')
            this.progression('Lancement de Minecraft…')
            document.body.classList.add('en-jeu')
            console.log(e);
            let ligne = String(e)
            journalJeu.push(ligne)
            tailleJournal += ligne.length
            while (tailleJournal > 3_000_000 && journalJeu.length > 1) tailleJournal -= journalJeu.shift().length
        })

        launch.on('close', code => {
            this.lancementEnCours = false
            // Le jeu est fermé : on enregistre le journal, et s'il n'y a pas eu de vrai plantage, tout se ferme
            // (le launcher cherchera les mises à jour à sa prochaine ouverture).
            let sortieJeu = masquerSecrets(journalJeu.join(''))
            ecrireJournalJeu(chemin, sortieJeu)
            if (!diagnosticPlantage(sortieJeu, echapper(cheminWindows(chemin))) && configClient.launcher_config.closeLauncher != 'close-none') {
                ipcRenderer.send('main-window-close')
                return
            }
            if (configClient.launcher_config.closeLauncher == 'close-launcher') {
                ipcRenderer.send("main-window-show")
            };
            ipcRenderer.send('main-window-progress-reset')
            infoStartingBOX.style.display = "none"
            playInstanceBTN.style.display = "flex"
            infoStarting.innerHTML = `Vérification`
            document.body.classList.remove('en-jeu')
            new logger(pkg.name, '#7289da');
            console.log('Close');

            let sortie = sortieJeu
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
            this.lancementEnCours = false
            // Jeu déjà démarré (fermé par le joueur, etc.) : pas de message « vérifie ta connexion », juste le journal
            if (jeuDemarre) {
                journaliserErreur(chemin, 'après le démarrage du jeu : ' + messageErreur(err))
                return
            }
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
            document.body.classList.remove('en-jeu')
            new logger(pkg.name, '#7289da');
            console.log(err);
        });
        return true
    }

    getdate(e) {
        let date = new Date(e)
        let year = date.getFullYear()
        let month = date.getMonth() + 1
        let day = date.getDate()
        let allMonth = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
        let court = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
        return { year: year, month: allMonth[month - 1], court: court[month - 1], day: day }
    }
}
export default Home;