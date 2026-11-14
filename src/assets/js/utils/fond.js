/**
 * Fond animé du launcher : petits cubes en pixels (couleurs du logo) qui montent doucement,
 * étincelles, et léger effet de profondeur qui suit la souris (cubes + logo de l'accueil).
 * Tout s'arrête quand la fenêtre est cachée ou pendant une partie (body.en-jeu).
 */

// Thème Zygarde : des « cellules » vertes discrètes
const COULEURS = ['75,211,123', '60,192,109', '143,227,174', '47,157,99'];

function hasard(min, max) {
    return min + Math.random() * (max - min);
}

export default class Fond {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.cubes = [];
        this.souris = { x: 0, y: 0, cx: 0, cy: 0 };
        this.force = 1;
        this.dernier = 0;
        this.image = 0;
        this.calme = false; // volontairement animé, même si Windows a ses animations coupées
        this.boucle = this.boucle.bind(this);

        window.addEventListener('resize', () => this.taille());
        window.addEventListener('mousemove', e => {
            this.souris.x = e.clientX / window.innerWidth * 2 - 1;
            this.souris.y = e.clientY / window.innerHeight * 2 - 1;
        });
        document.addEventListener('mouseleave', () => { this.souris.x = 0; this.souris.y = 0; });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) this.relancer(); });

        this.taille();
        this.relancer();
    }

    taille() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.l = window.innerWidth;
        this.h = window.innerHeight;
        this.canvas.width = Math.round(this.l * dpr);
        this.canvas.height = Math.round(this.h * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const voulu = Math.round(Math.min(36, Math.max(14, this.l * this.h / 28000)));
        while (this.cubes.length < voulu) this.cubes.push(this.nouveau(true));
        this.cubes.length = voulu;
        if (this.calme) this.dessiner(0);
    }

    nouveau(partout) {
        const etincelle = Math.random() < .35;
        const z = hasard(.25, 1);
        return {
            x: hasard(0, this.l || 1280),
            y: partout ? hasard(0, this.h || 720) : (this.h || 720) + 20,
            z,
            taille: etincelle ? hasard(1.2, 2.4) : hasard(4, 11) * z + 1,
            vitesse: hasard(6, 22) * (.4 + z),          // pixels par seconde
            derive: hasard(.4, 1.2),
            phase: hasard(0, Math.PI * 2),
            angle: hasard(0, Math.PI * 2),
            rotation: hasard(-.6, .6),
            alpha: etincelle ? hasard(.25, .6) : hasard(.08, .28) * (.5 + z),
            couleur: COULEURS[Math.floor(Math.random() * COULEURS.length)],
            etincelle
        };
    }

    relancer() {
        if (this.calme || this.tourne) return;
        this.tourne = true;
        this.dernier = performance.now();
        requestAnimationFrame(this.boucle);
    }

    boucle(maintenant) {
        if (document.hidden || document.body.classList.contains('en-jeu')) {
            this.tourne = false;
            // reprend tout seul à la fin de la partie
            if (document.body.classList.contains('en-jeu')) setTimeout(() => this.relancer(), 1500);
            return;
        }
        const dt = Math.min((maintenant - this.dernier) / 1000, .05);
        this.dernier = maintenant;

        // Intensité selon le thème (variable CSS --particules), relue de temps en temps
        if (this.image++ % 90 === 0) {
            const v = parseFloat(getComputedStyle(document.body).getPropertyValue('--particules'));
            this.force = isNaN(v) ? 1 : v;
            this.logo = document.querySelector('.home.active .accueil-logo');
        }

        // La souris déplace doucement la « caméra »
        this.souris.cx += (this.souris.x - this.souris.cx) * Math.min(1, dt * 3);
        this.souris.cy += (this.souris.y - this.souris.cy) * Math.min(1, dt * 3);
        if (this.logo) {
            this.logo.style.setProperty('--incl-x', `${(this.souris.cx * 7).toFixed(2)}deg`);
            this.logo.style.setProperty('--incl-y', `${(-this.souris.cy * 7).toFixed(2)}deg`);
        }

        this.dessiner(dt, maintenant / 1000);
        requestAnimationFrame(this.boucle);
    }

    dessiner(dt, t = 0) {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.l, this.h);

        for (let i = 0; i < this.cubes.length; i++) {
            const c = this.cubes[i];
            c.y -= c.vitesse * dt;
            c.angle += c.rotation * dt;
            if (c.y < -30) { this.cubes[i] = this.nouveau(false); continue; }

            const x = c.x + Math.sin(t * c.derive + c.phase) * 14 * c.z - this.souris.cx * 26 * c.z;
            const y = c.y - this.souris.cy * 18 * c.z;
            // Apparition en bas, disparition en haut
            const bord = Math.min(1, (this.h - c.y) / 120, (c.y + 30) / 160);
            let a = c.alpha * this.force * Math.max(0, bord);
            if (c.etincelle) a *= .55 + .45 * Math.sin(t * 3 * c.derive + c.phase);
            if (a <= .01) continue;

            if (c.etincelle) {
                ctx.fillStyle = `rgba(${c.couleur},${a})`;
                ctx.fillRect(x, y, c.taille, c.taille);
                continue;
            }

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(c.angle);
            const s = c.taille;
            // cube : face pleine + liseré clair en haut (effet « pixel »)
            ctx.fillStyle = `rgba(${c.couleur},${a})`;
            ctx.fillRect(-s / 2, -s / 2, s, s);
            ctx.fillStyle = `rgba(255,255,255,${a * .5})`;
            ctx.fillRect(-s / 2, -s / 2, s, Math.max(1, s / 5));
            ctx.restore();
        }
    }
}
