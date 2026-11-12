/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

const { ipcRenderer } = require('electron');

export default class popup {
    constructor() {
        this.popup = document.querySelector('.popup');
        this.popupTitle = document.querySelector('.popup-title');
        this.popupContent = document.querySelector('.popup-content');
        this.popupOptions = document.querySelector('.popup-options');
        this.popupButton = document.querySelector('.popup-button');
    }

    openPopup(info) {
        this.popup.style.display = 'flex';
        this.popup.classList.toggle('popup-voile', info.background != false);
        this.popupTitle.innerHTML = info.title;
        // Erreur : texte lisible, l'alerte est portée par le titre et le cadre (classe popup-erreur)
        const erreur = !info.color || info.color == 'red';
        this.popup.classList.toggle('popup-erreur', erreur);
        this.popupContent.style.color = erreur ? 'var(--texte-2)' : info.color;
        this.popupContent.innerHTML = info.content;

        if (info.options) this.popupOptions.style.display = 'flex';

        if (this.popupOptions.style.display !== 'none') {
            this.popupButton.addEventListener('click', () => {
                if (info.exit) return ipcRenderer.send('main-window-close');
                this.closePopup();
            })
        }
    }

    closePopup() {
        this.popup.style.display = 'none';
        this.popupTitle.innerHTML = '';
        this.popupContent.innerHTML = '';
        this.popupOptions.style.display = 'none';
    }
}