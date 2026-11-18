/**
 * Actualités en diaporama (3.4.6, Eddy : « refais les actus ») : une grande image qui change toute seule
 * (fondu + lent recul), des flèches au survol, les vignettes en dessous pour choisir. Images seules, aucun texte.
 * Pendant une partie (body.en-jeu) ou quand la souris est sur l'image, le diaporama attend.
 *
 * @param {HTMLElement} liste   la section .actus
 * @param {string[]} images     liens des images (la première = la plus récente)
 * @param {(url: string) => void} ouvrir  appelé au clic sur la grande image
 * @param {number} [pause]      millisecondes entre deux images
 */
export function diaporama(liste, images, ouvrir, pause = 6000) {
    liste.classList.add('diapo');
    const scene = document.createElement('div');
    scene.className = 'diapo-scene';
    const bande = document.createElement('div');
    bande.className = 'diapo-vignettes';
    const vues = [], vignettes = [];
    let actuelle = -1, minuterie = null;

    const montrer = (i) => {
        i = (i + images.length) % images.length;
        if (i === actuelle) return;
        vues.forEach((v, k) => v.classList.toggle('active', k === i));
        vignettes.forEach((v, k) => v.classList.toggle('active', k === i));
        actuelle = i;
    };
    const relancer = () => {
        clearInterval(minuterie);
        if (images.length < 2) return;
        minuterie = setInterval(() => {
            if (document.body.classList.contains('en-jeu') || scene.matches(':hover') || document.hidden) return;
            montrer(actuelle + 1);
        }, pause);
    };

    images.forEach((url, i) => {
        const img = document.createElement('img');
        img.className = 'diapo-img'; img.alt = ''; img.src = url;
        scene.appendChild(img); vues.push(img);
        const v = document.createElement('button');
        v.className = 'diapo-vignette'; v.style.setProperty('--i', i);
        v.setAttribute('aria-label', 'Image ' + (i + 1));
        const mini = document.createElement('img');
        mini.alt = ''; mini.loading = 'lazy'; mini.src = url;
        v.appendChild(mini);
        v.addEventListener('click', () => { montrer(i); relancer(); });
        bande.appendChild(v); vignettes.push(v);
    });
    if (images.length > 1) for (const [cote, pas, signe, nom] of [['gauche', -1, '‹', 'Image précédente'], ['droite', 1, '›', 'Image suivante']]) {
        const f = document.createElement('button');
        f.className = 'diapo-fleche ' + cote; f.textContent = signe; f.setAttribute('aria-label', nom);
        f.addEventListener('click', e => { e.stopPropagation(); montrer(actuelle + pas); relancer(); });
        scene.appendChild(f);
    }
    scene.addEventListener('click', () => ouvrir(images[Math.max(0, actuelle)]));
    liste.appendChild(scene);
    if (images.length > 1) liste.appendChild(bande);
    montrer(0);
    relancer();
    return { montrer, arreter: () => clearInterval(minuterie) };
}
