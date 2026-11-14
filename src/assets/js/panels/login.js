/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */
const { AZauth, Mojang } = require('minecraft-java-core');
const { ipcRenderer } = require('electron');

import { popup, database, changePanel, accountSelect, addAccount, config, setStatus, pkg } from '../utils.js';
import { PokeFactionAPI } from '../utils/pokefaction-api.js';

class Login {
    static id = "login";
    async init(config) {
        this.config = config;
        this.db = new database();

        if (this.config.auth === 'pokefaction') {
            this.getPokeFaction();
        } else if (typeof this.config.online == 'boolean') {
            this.config.online ? this.getMicrosoft() : this.getCrack()
        } else if (typeof this.config.online == 'string') {
            if (this.config.online.match(/^(http|https):\/\/[^ "]+$/)) {
                this.getAZauth();
            }
        }
        
        document.querySelector('.cancel-home').addEventListener('click', () => {
            document.querySelector('.cancel-home').style.display = 'none'
            changePanel('settings')
        })
    }

    async getMicrosoft() {
        console.log('Initializing Microsoft login...');
        let popupLogin = new popup();
        let loginHome = document.querySelector('.login-home');
        let microsoftBtn = document.querySelector('.connect-home');
        loginHome.style.display = 'block';

        microsoftBtn.addEventListener("click", () => {
            popupLogin.openPopup({
                title: 'Connexion',
                content: 'Veuillez patienter...',
                color: 'var(--color)'
            });

            ipcRenderer.invoke('Microsoft-window', this.config.client_id).then(async account_connect => {
                if (account_connect == 'cancel' || !account_connect) {
                    popupLogin.closePopup();
                    return;
                } else {
                    await this.saveData(account_connect)
                    popupLogin.closePopup();
                }

            }).catch(err => {
                popupLogin.openPopup({
                    title: 'Erreur',
                    content: err,
                    options: true
                });
            });
        })
    }

    /**
     * Comptes PokéFaction : connexion Microsoft (compte créé tout seul) ou pseudo + mot de passe.
     * La session PokéFaction est rangée dans account.pokefaction ; home.js s'en sert pour le ticket de jeu.
     */
    getPokeFaction() {
        const panneau = document.querySelector('.login-pokefaction');
        const formulaire = panneau.querySelector('.pf-formulaire');
        const pseudo = panneau.querySelector('.pf-pseudo');
        const mdp = panneau.querySelector('.pf-mdp');
        const mdp2 = panneau.querySelector('.pf-mdp2');
        const erreur = panneau.querySelector('.pf-erreur');
        const valider = panneau.querySelector('.pf-valider');
        const boutonMicrosoft = panneau.querySelector('.pf-microsoft');
        const ongletConnexion = panneau.querySelector('.pf-onglet-connexion');
        const ongletInscription = panneau.querySelector('.pf-onglet-inscription');
        let inscription = false;

        panneau.style.display = 'block';

        // 3.0 : carte « Compte PokéFaction » au-dessus de la barre, version, membres du Discord, « Rester connecté »
        panneau.querySelector('.pf-ouvrir-compte')?.addEventListener('click', () => panneau.classList.toggle('pf-carte-ouverte'));
        const version = panneau.querySelector('.connexion-version');
        if (version) version.textContent = 'v' + pkg.version;
        const rester = panneau.querySelector('.pf-rester');
        if (rester) {
            rester.checked = localStorage.getItem('pf-rester') !== 'false';
            rester.addEventListener('change', () => localStorage.setItem('pf-rester', rester.checked ? 'true' : 'false'));
        }
        fetch('https://discord.com/api/v9/invites/8gRP8NfN4?with_counts=true', { signal: AbortSignal.timeout(8000) })
            .then(r => r.json())
            .then(j => {
                const n = j && (j.approximate_member_count || j.profile?.member_count);
                const el = panneau.querySelector('.discord-membres');
                if (n && el) el.textContent = Number(n).toLocaleString('fr-FR');
                else panneau.querySelector('.connexion-discord')?.classList.add('cache');
            })
            .catch(() => panneau.querySelector('.connexion-discord')?.classList.add('cache'));

        const api = () => new PokeFactionAPI(this.config.pokefaction_api);
        const occupe = (oui) => {
            valider.disabled = oui;
            boutonMicrosoft.disabled = oui;
        };
        const afficherErreur = (texte) => { erreur.textContent = texte || ''; };
        const changerMode = (versInscription) => {
            inscription = versInscription;
            panneau.classList.toggle('pf-mode-inscription', inscription);
            ongletConnexion.classList.toggle('pf-onglet-actif', !inscription);
            ongletInscription.classList.toggle('pf-onglet-actif', inscription);
            valider.textContent = inscription ? 'Créer mon compte' : 'Se connecter';
            mdp.autocomplete = inscription ? 'new-password' : 'current-password';
            afficherErreur('');
        };

        ongletConnexion.addEventListener('click', () => changerMode(false));
        ongletInscription.addEventListener('click', () => changerMode(true));
        panneau.querySelector('.cancel-pokefaction').addEventListener('click', () => {
            panneau.querySelector('.cancel-pokefaction').style.display = 'none';
            changePanel('settings');
        });

        formulaire.addEventListener('submit', async (e) => {
            e.preventDefault();
            afficherErreur('');
            const p = pseudo.value.trim();
            if (!/^[A-Za-z0-9_]{3,16}$/.test(p)) {
                return afficherErreur('Pseudo invalide : 3 à 16 caractères, lettres, chiffres et _ seulement.');
            }
            if (mdp.value.length < 6) return afficherErreur('Mot de passe trop court : 6 caractères minimum.');
            if (inscription && mdp.value !== mdp2.value) return afficherErreur('Les deux mots de passe ne sont pas pareils.');

            occupe(true);
            try {
                const reponse = inscription ? await api().inscription(p, mdp.value) : await api().connexion(p, mdp.value);
                const compte = await Mojang.login(reponse.pseudo);
                if (compte.error) throw new Error(compte.message || 'Création du profil impossible.');
                compte.pokefaction = { session: reponse.session, pseudo: reponse.pseudo, type: reponse.type };
                mdp.value = '';
                mdp2.value = '';
                await this.saveData(compte);
            } catch (err) {
                afficherErreur(err.message);
            } finally {
                occupe(false);
            }
        });

        boutonMicrosoft.addEventListener('click', async () => {
            afficherErreur('');
            occupe(true);
            try {
                const compte = await ipcRenderer.invoke('Microsoft-window', this.config.client_id);
                if (!compte || compte == 'cancel') return;
                if (compte.error) throw new Error(compte.errorMessage || 'Connexion Microsoft impossible.');
                const reponse = await api().microsoft(compte);
                compte.pokefaction = { session: reponse.session, pseudo: reponse.pseudo, type: reponse.type };
                await this.saveData(compte);
            } catch (err) {
                afficherErreur(err.message || String(err));
            } finally {
                occupe(false);
            }
        });
    }

    async getCrack() {
        console.log('Initializing offline login...');
        let popupLogin = new popup();
        let loginOffline = document.querySelector('.login-offline');

        let emailOffline = document.querySelector('.email-offline');
        let connectOffline = document.querySelector('.connect-offline');
        loginOffline.style.display = 'block';

        connectOffline.addEventListener('click', async () => {
            if (emailOffline.value.length < 3) {
                popupLogin.openPopup({
                    title: 'Erreur',
                    content: 'Votre pseudo doit faire au moins 3 caractères.',
                    options: true
                });
                return;
            }

            if (emailOffline.value.match(/ /g)) {
                popupLogin.openPopup({
                    title: 'Erreur',
                    content: 'Votre pseudo ne doit pas contenir d\'espaces.',
                    options: true
                });
                return;
            }

            let MojangConnect = await Mojang.login(emailOffline.value);

            if (MojangConnect.error) {
                popupLogin.openPopup({
                    title: 'Erreur',
                    content: MojangConnect.message,
                    options: true
                });
                return;
            }
            await this.saveData(MojangConnect)
            popupLogin.closePopup();
        });
    }

    async getAZauth() {
        console.log('Initializing AZauth login...');
        let AZauthClient = new AZauth(this.config.online);
        let PopupLogin = new popup();
        let loginAZauth = document.querySelector('.login-AZauth');
        let loginAZauthA2F = document.querySelector('.login-AZauth-A2F');

        let AZauthEmail = document.querySelector('.email-AZauth');
        let AZauthPassword = document.querySelector('.password-AZauth');
        let AZauthA2F = document.querySelector('.A2F-AZauth');
        let connectAZauthA2F = document.querySelector('.connect-AZauth-A2F');
        let AZauthConnectBTN = document.querySelector('.connect-AZauth');
        let AZauthCancelA2F = document.querySelector('.cancel-AZauth-A2F');

        loginAZauth.style.display = 'block';

        AZauthConnectBTN.addEventListener('click', async () => {
            PopupLogin.openPopup({
                title: 'Connexion en cours...',
                content: 'Veuillez patienter...',
                color: 'var(--color)'
            });

            if (AZauthEmail.value == '' || AZauthPassword.value == '') {
                PopupLogin.openPopup({
                    title: 'Erreur',
                    content: 'Veuillez remplir tous les champs.',
                    options: true
                });
                return;
            }

            let AZauthConnect = await AZauthClient.login(AZauthEmail.value, AZauthPassword.value);

            if (AZauthConnect.error) {
                PopupLogin.openPopup({
                    title: 'Erreur',
                    content: AZauthConnect.message,
                    options: true
                });
                return;
            } else if (AZauthConnect.A2F) {
                loginAZauthA2F.style.display = 'block';
                loginAZauth.style.display = 'none';
                PopupLogin.closePopup();

                AZauthCancelA2F.addEventListener('click', () => {
                    loginAZauthA2F.style.display = 'none';
                    loginAZauth.style.display = 'block';
                });

                connectAZauthA2F.addEventListener('click', async () => {
                    PopupLogin.openPopup({
                        title: 'Connexion en cours...',
                        content: 'Veuillez patienter...',
                        color: 'var(--color)'
                    });

                    if (AZauthA2F.value == '') {
                        PopupLogin.openPopup({
                            title: 'Erreur',
                            content: 'Veuillez entrer le code A2F.',
                            options: true
                        });
                        return;
                    }

                    AZauthConnect = await AZauthClient.login(AZauthEmail.value, AZauthPassword.value, AZauthA2F.value);

                    if (AZauthConnect.error) {
                        PopupLogin.openPopup({
                            title: 'Erreur',
                            content: AZauthConnect.message,
                            options: true
                        });
                        return;
                    }

                    await this.saveData(AZauthConnect)
                    PopupLogin.closePopup();
                });
            } else if (!AZauthConnect.A2F) {
                await this.saveData(AZauthConnect)
                PopupLogin.closePopup();
            }
        });
    }

    async saveData(connectionData) {
        let configClient = await this.db.readData('configClient');
        let account = await this.db.createData('accounts', connectionData)
        let instanceSelect = configClient.instance_select
        let instancesList = await config.getInstanceList()
        configClient.account_selected = account.ID;

        for (let instance of instancesList) {
            if (instance.whitelistActive) {
                let whitelist = instance.whitelist.find(whitelist => whitelist == account.name)
                if (whitelist !== account.name) {
                    if (instance.name == instanceSelect) {
                        let newInstanceSelect = instancesList.find(i => i.whitelistActive == false)
                        configClient.instance_select = newInstanceSelect.name
                        await setStatus(newInstanceSelect.status)
                    }
                }
            }
        }

        await this.db.updateData('configClient', configClient);
        await addAccount(account);
        await accountSelect(account);
        changePanel('home');
    }
}
export default Login;