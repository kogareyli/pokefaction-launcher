/**
 * Comptes PokéFaction : dialogue avec l'API des comptes (Supabase, fonctions pf_*).
 * Le serveur Minecraft est en online-mode=false : sans ce système, n'importe qui pourrait prendre
 * n'importe quel pseudo. Le launcher se connecte au compte, puis à chaque JOUER il récupère un
 * « ticket » (12 h) que le jeu présente au serveur (mod pokefaction-core).
 */
const nodeFetch = require('node-fetch');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ERREUR_RESEAU = 'Impossible de joindre le serveur des comptes PokéFaction. Vérifie ta connexion internet.';

class PokeFactionAPI {
    constructor(conf) {
        if (!conf || !conf.url || !conf.cle) throw new Error('API des comptes PokéFaction non configurée (web/config).');
        this.url = conf.url.replace(/\/+$/, '');
        this.cle = conf.cle;
    }

    entetes() {
        const h = { apikey: this.cle, 'Content-Type': 'application/json' };
        if (this.cle.startsWith('eyJ')) h.Authorization = `Bearer ${this.cle}`; // ancienne clé « anon » (JWT)
        return h;
    }

    async appel(url, corps) {
        let r;
        try {
            r = await nodeFetch(url, { method: 'POST', headers: this.entetes(), body: JSON.stringify(corps) });
        } catch {
            throw new Error(ERREUR_RESEAU);
        }
        const texte = await r.text();
        let json = null;
        try { json = texte ? JSON.parse(texte) : null; } catch { /* réponse non JSON */ }
        if (!r.ok) throw new Error(json?.erreur || json?.message || `Erreur du serveur des comptes (${r.status}).`);
        if (json && json.erreur) throw new Error(json.erreur);
        return json;
    }

    rpc(fonction, args) {
        return this.appel(`${this.url}/rest/v1/rpc/${fonction}`, args);
    }

    inscription(pseudo, motDePasse) {
        return this.rpc('pf_inscription', { p_pseudo: pseudo, p_mot_de_passe: motDePasse });
    }

    connexion(pseudo, motDePasse) {
        return this.rpc('pf_connexion', { p_pseudo: pseudo, p_mot_de_passe: motDePasse });
    }

    moi(session) {
        return this.rpc('pf_moi', { p_session: session });
    }

    ticket(session) {
        return this.rpc('pf_ticket', { p_session: session });
    }

    deconnexion(session) {
        return this.rpc('pf_deconnexion', { p_session: session }).catch(() => null);
    }

    /**
     * Compte Microsoft → compte PokéFaction (créé automatiquement).
     * Comme un serveur Minecraft officiel : on « rejoint » Mojang avec un défi aléatoire,
     * puis l'API demande à Mojang si c'est vrai. Le jeton Microsoft ne quitte jamais ce PC.
     */
    async microsoft(compte) {
        const defi = crypto.randomBytes(20).toString('hex');
        let r;
        try {
            r = await nodeFetch('https://sessionserver.mojang.com/session/minecraft/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accessToken: compte.access_token, selectedProfile: compte.uuid.replace(/-/g, ''), serverId: defi }),
            });
        } catch {
            throw new Error('Impossible de joindre les serveurs de Mojang. Vérifie ta connexion internet.');
        }
        if (r.status !== 204) throw new Error('Mojang a refusé la connexion Microsoft. Reconnecte-toi avec Microsoft.');
        return this.appel(`${this.url}/functions/v1/connexion-microsoft`, { pseudo: compte.name, defi });
    }
}

/** Écrit le ticket là où le mod pokefaction-core le lit : <dossier du jeu>/pokefaction/ticket.json */
function ecrireTicket(dossierJeu, { pseudo, ticket }, serveurs) {
    const dossier = path.join(dossierJeu, 'pokefaction');
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, 'ticket.json'), JSON.stringify({ pseudo, ticket, serveurs }, null, 2));
}

export { PokeFactionAPI, ecrireTicket };
