/**
 * 22/11/2026 (Eddy : « mets fin de bêta sur le launcher, mets qu'on ne peut plus lancer le jeu ») : un serveur peut être FERMÉ
 * depuis web/instances, sans toucher aux autres (le serveur test reste ouvert) :
 *   "ferme": { "titre": "Fin de la bêta", "message": "…" }
 * Le bouton Jouer affiche le titre et ne lance plus rien (popup avec le message). Retirer « ferme » rouvre le serveur.
 * La « maintenance » de web/config, elle, bloque tout le launcher (ouverture comprise) : pas faite pour ça.
 */
import { config as configLauncher } from '../utils.js'

/** La fermeture de l'instance (ou null si elle est ouverte). */
export function fermeture(instance) {
    const f = instance?.ferme;
    if (!f) return null;
    return {
        titre: (typeof f === 'object' && f.titre) || 'Serveur fermé',
        message: (typeof f === 'object' && f.message) || 'Ce serveur est fermé pour le moment.'
    };
}

/** Met l'accueil à jour pour l'instance choisie (bouton Jouer, petit texte dessous). */
export async function appliquerFermeture(nom) {
    let f = null;
    try { f = fermeture((await configLauncher.getInstanceList()).find(i => i.name === nom)); } catch (e) { console.error('[Fermeture]', e); }
    document.body.classList.toggle('instance-fermee', !!f);
    const texte = document.querySelector('.play-btn span');
    if (texte) texte.textContent = f ? f.titre : 'Jouer';
    // un cadenas à la place du triangle « Jouer » (Eddy : « mets juste un cadenas »)
    const icone = document.querySelector('.play-btn svg');
    if (icone) {
        if (!icone.dataset.jouer) icone.dataset.jouer = icone.innerHTML;
        icone.innerHTML = f ? '<path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3H9z"/>' : icone.dataset.jouer;
    }
    let ligne = document.querySelector('.accueil-fermee');
    if (!ligne) {
        const cadre = document.querySelector('.play-cadre');
        if (cadre) { ligne = document.createElement('div'); ligne.className = 'accueil-fermee'; cadre.insertAdjacentElement('afterend', ligne); }
    }
    if (ligne) { ligne.textContent = f ? f.message : ''; ligne.hidden = !f; }
    return f;
}
