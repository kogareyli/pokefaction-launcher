// Logo PokéFaction (Rayquaza shiny : noir, anneau doré, bouche rose) : fabrique toutes les versions depuis tools/logo/logo-officiel.png
// (PNG déjà détouré). Usage, depuis le dossier du launcher :  node tools/logo/generer-logos.js
// Écrit : launcher (logo + icône 1024 → `npm run icon` pour .ico/.icns), site, panel, mod, icône du serveur,
// logo de l'écran de chargement du jeu. Les chemins hors du launcher sont relatifs à ServeurCobbleverse.
const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');
const png2icons = require('png2icons');

const launcher = path.join(__dirname, '..', '..');
const serveur = path.join(launcher, '..', '..');

// Réduction par moyenne de surface (alpha prémultiplié) : net, sans franges claires autour des contours.
function reduire(src, W, H) {
  const { width: w, height: h, data: d } = src.bitmap;
  const out = new Jimp({ width: W, height: H, color: 0x00000000 });
  const o = out.bitmap.data, sx = w / W, sy = h / H;
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const x0 = X * sx, x1 = x0 + sx, y0 = Y * sy, y1 = y0 + sy;
    let r = 0, g = 0, b = 0, a = 0, tot = 0;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      const wy = Math.min(y + 1, y1) - Math.max(y, y0);
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const wx = Math.min(x + 1, x1) - Math.max(x, x0), k = wx * wy, i = (y * w + x) * 4, al = d[i + 3] / 255;
        r += d[i] * al * k; g += d[i + 1] * al * k; b += d[i + 2] * al * k; a += al * k; tot += k;
      }
    }
    const i = (Y * W + X) * 4;
    if (a > 0) { o[i] = r / a; o[i + 1] = g / a; o[i + 2] = b / a; }
    o[i + 3] = Math.round(a / tot * 255);
  }
  return out;
}

// Rogne au contenu (alpha > 8) et ajoute une marge (en fraction du plus grand côté).
function rogner(img, marge) {
  const { width: w, height: h, data: d } = img.bitmap;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const m = Math.round(Math.max(x1 - x0, y1 - y0) * marge);
  const W = x1 - x0 + 1 + 2 * m, H = y1 - y0 + 1 + 2 * m;
  const out = new Jimp({ width: W, height: H, color: 0x00000000 });
  out.composite(img.clone().crop({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }), m, m);
  return out;
}

// Contour extérieur (rayon r px, couleur rgb) : le logo est noir, sans ça sa silhouette disparaît sur les fonds sombres.
function contour(img, r, rgb) {
  const { width: w, height: h, data: d } = img.bitmap;
  const W = w + 2 * r, H = h + 2 * r;
  const out = new Jimp({ width: W, height: H, color: 0x00000000 });
  const o = out.bitmap.data, A = new Float32Array(W * H), offs = [];
  for (let dy = -r - 1; dy <= r + 1; dy++) for (let dx = -r - 1; dx <= r + 1; dx++) {
    const k = Math.max(0, Math.min(1, r + 0.5 - Math.hypot(dx, dy))); if (k > 0) offs.push([dx, dy, k]);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = d[(y * w + x) * 4 + 3] / 255; if (a < 0.02) continue;
    for (const [dx, dy, k] of offs) { const p = (y + r + dy) * W + (x + r + dx), v = a * k; if (v > A[p]) A[p] = v; }
  }
  for (let p = 0; p < A.length; p++) { o[p * 4] = rgb[0]; o[p * 4 + 1] = rgb[1]; o[p * 4 + 2] = rgb[2]; o[p * 4 + 3] = Math.round(A[p] * 255); }
  out.composite(img, r, r);
  return out;
}

// Carré transparent, logo centré.
function carre(img, cote, marge) {
  const { width: w, height: h } = img.bitmap;
  const place = cote * (1 - 2 * marge), k = place / Math.max(w, h);
  const r = reduire(img, Math.round(w * k), Math.round(h * k));
  const out = new Jimp({ width: cote, height: cote, color: 0x00000000 });
  out.composite(r, Math.round((cote - r.bitmap.width) / 2), Math.round((cote - r.bitmap.height) / 2));
  return out;
}

async function ecrire(img, fichier) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  await img.write(fichier);
  console.log('écrit', path.relative(serveur, fichier), img.bitmap.width + '×' + img.bitmap.height);
}

(async () => {
  const brut = await Jimp.read(path.join(__dirname, 'logo-officiel.png'));
  // Le logo tel qu'Eddy l'a fait (bords noirs). Pas de contour gris : Eddy n'en veut pas (15/11).
  // contour() reste disponible si un jour il en faut un : contour(logo, rayon, [r, g, b]).
  const logo = rogner(brut, 0.01);
  const logo800 = reduire(logo, 800, Math.round(800 * logo.bitmap.height / logo.bitmap.width));

  // Launcher
  await ecrire(logo800, path.join(launcher, 'src/assets/images/logo/logo.png'));
  // Petites tailles réduites ici (moyenne de surface) : le navigateur, lui, rend un 800 px réduit à 36 px crénelé.
  // Utilisées avec srcset (1x, 2x, 3x selon le zoom de Windows).
  for (const l of [48, 96, 144, 200, 400]) {
    await ecrire(reduire(logo, l, Math.round(l * logo.bitmap.height / logo.bitmap.width)), path.join(launcher, `src/assets/images/logo/logo-${l}.png`));
  }
  await ecrire(carre(logo, 1024, 0.03), path.join(launcher, 'src/assets/images/icon/icon.png'));
  // Écran de chargement du jeu (Custom Splash Screen « Aspect1to1 ») : copié dans l'instance au clic sur Jouer
  await ecrire(carre(logo, 512, 0.04), path.join(launcher, 'src/assets/images/logo/ecran-chargement.png'));

  // Site
  const site = path.join(serveur, 'PokeFaction-Site');
  if (fs.existsSync(site)) {
    await ecrire(logo800, path.join(site, 'src/assets/logo-pf.png'));
    await ecrire(carre(logo, 256, 0.02), path.join(site, 'public/favicon.png'));
    await ecrire(carre(logo, 180, 0.08), path.join(site, 'public/apple-touch-icon.png'));
  }

  // Panel
  const panel = path.join(serveur, 'PokeFaction-Panel');
  if (fs.existsSync(panel)) {
    await ecrire(logo800, path.join(panel, 'logo.png'));
    await ecrire(reduire(logo, 144, Math.round(144 * logo.bitmap.height / logo.bitmap.width)), path.join(panel, 'logo-144.png'));
    const b = await carre(logo, 256, 0.02).getBuffer('image/png');
    fs.writeFileSync(path.join(panel, 'icone.ico'), png2icons.createICO(b, png2icons.HERMITE, 0, false));
    console.log('écrit PokeFaction-Panel/icone.ico');
  }

  // Mod (icône de Mod Menu) et icône du serveur (liste des serveurs du jeu)
  const mod = path.join(serveur, 'PokeFaction-Launcher/pokefaction-core/src/main/resources/assets/pokefaction/icon.png');
  if (fs.existsSync(path.dirname(mod))) await ecrire(carre(logo, 128, 0.02), mod);
  await ecrire(carre(logo, 64, 0.0), path.join(serveur, 'server-icon.png'));
  await ecrire(carre(logo, 512, 0.03), path.join(serveur, 'PokeFaction-Launcher/pokefaction_icon_512.png'));
})();
