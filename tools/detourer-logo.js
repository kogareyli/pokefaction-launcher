// Détoure le logo PokéFaction (fond noir + halo) : garde les contours noirs, retire le fond et le halo.
// Puis écrit le logo du launcher et l'icône. Usage, depuis le dossier du launcher :
//   node tools/detourer-logo.js [tools/logo/logo-officiel.png]
//   npm run icon            (refait icon.ico / icon.icns / icon.png 256 px depuis l'icône 1024 px)
// Un aperçu sur fond violet est écrit dans tools/logo/apercu-violet.png pour vérifier le résultat.
const path = require('path');
const { Jimp } = require('jimp');
const racine = path.join(__dirname, '..');

(async () => {
  const src = await Jimp.read(process.argv[2] || path.join(__dirname, 'logo', 'logo-officiel.png'));
  const W = src.bitmap.width, H = src.bitmap.height, N = W * H;
  const d = src.bitmap.data;
  const B = new Uint8Array(N);
  for (let p = 0; p < N; p++) B[p] = Math.max(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]);

  // 1. Parties colorées du logo
  const CORE = 80;
  const core = new Uint8Array(N);
  for (let p = 0; p < N; p++) core[p] = B[p] > CORE ? 1 : 0;

  // 2. Distance (chanfrein 3-4) à la partie colorée la plus proche
  const INF = 1e9;
  const dist = new Float64Array(N);
  for (let p = 0; p < N; p++) dist[p] = core[p] ? 0 : INF;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x; let v = dist[p];
    if (x > 0) v = Math.min(v, dist[p - 1] + 3);
    if (y > 0) {
      v = Math.min(v, dist[p - W] + 3);
      if (x > 0) v = Math.min(v, dist[p - W - 1] + 4);
      if (x < W - 1) v = Math.min(v, dist[p - W + 1] + 4);
    }
    dist[p] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const p = y * W + x; let v = dist[p];
    if (x < W - 1) v = Math.min(v, dist[p + 1] + 3);
    if (y < H - 1) {
      v = Math.min(v, dist[p + W] + 3);
      if (x < W - 1) v = Math.min(v, dist[p + W + 1] + 4);
      if (x > 0) v = Math.min(v, dist[p + W - 1] + 4);
    }
    dist[p] = v;
  }

  // 3. Extérieur = rempli depuis le bord de l image, en passant par le halo (assez clair) ou le fond lointain.
  //    Le contour noir (très sombre, collé au logo) arrête le remplissage : tout ce qu il entoure reste opaque.
  const BAND = 26 * 3, T = 16;
  const pass = new Uint8Array(N);
  for (let p = 0; p < N; p++) pass[p] = !core[p] && (B[p] >= T || dist[p] > BAND) ? 1 : 0;
  const outside = new Uint8Array(N);
  const stack = new Int32Array(N);
  let top = 0;
  const push = p => { if (pass[p] && !outside[p]) { outside[p] = 1; stack[top++] = p; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (top) {
    const p = stack[--top]; const x = p % W, y = (p / W) | 0;
    if (x > 0) push(p - 1); if (x < W - 1) push(p + 1); if (y > 0) push(p - W); if (y < H - 1) push(p + W);
  }
  const alpha = new Float32Array(N);
  for (let p = 0; p < N; p++) alpha[p] = outside[p] ? 0 : 1;

  // 5. Petits îlots opaques isolés (bruit < 40 px) : retirés
  const seen2 = new Uint8Array(N);
  for (let s = 0; s < N; s++) {
    if (seen2[s] || alpha[s] < 0.5) continue;
    let t = 0; const comp = [];
    stack[t++] = s; seen2[s] = 1;
    while (t) {
      const p = stack[--t]; comp.push(p);
      const x = p % W, y = (p / W) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
      for (const q of nb) if (q >= 0 && !seen2[q] && alpha[q] >= 0.5) { seen2[q] = 1; stack[t++] = q; }
    }
    if (comp.length < 40) for (const p of comp) alpha[p] = 0;
  }

  // 5b. Ouverture (rayon ~3 px) hors parties colorées : enlève les filaments noirs fins du halo
  const chamfer = (src) => { // distance (x3) à la zone où src=0
    const D = new Float64Array(N);
    for (let p = 0; p < N; p++) D[p] = src[p] ? 1e9 : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x; let v = D[p];
      if (x > 0) v = Math.min(v, D[p - 1] + 3);
      if (y > 0) { v = Math.min(v, D[p - W] + 3); if (x > 0) v = Math.min(v, D[p - W - 1] + 4); if (x < W - 1) v = Math.min(v, D[p - W + 1] + 4); }
      D[p] = v; }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const p = y * W + x; let v = D[p];
      if (x < W - 1) v = Math.min(v, D[p + 1] + 3);
      if (y < H - 1) { v = Math.min(v, D[p + W] + 3); if (x < W - 1) v = Math.min(v, D[p + W + 1] + 4); if (x > 0) v = Math.min(v, D[p + W - 1] + 4); }
      D[p] = v; }
    return D;
  };
  const R = 9; // 3 px
  const inside = new Uint8Array(N); for (let p = 0; p < N; p++) inside[p] = alpha[p] >= 0.5 ? 1 : 0;
  const dIn = chamfer(inside);              // distance au fond
  const eroded = new Uint8Array(N); for (let p = 0; p < N; p++) eroded[p] = dIn[p] > R ? 1 : 0;
  const notEroded = new Uint8Array(N); for (let p = 0; p < N; p++) notEroded[p] = eroded[p] ? 0 : 1;
  const dEr = chamfer(notEroded);           // distance à la zone érodée
  for (let p = 0; p < N; p++) if (inside[p] && !core[p] && dEr[p] > R + 1) alpha[p] = 0;

  // 6. Bord doux (flou 3x3 de l'alpha, seulement en bordure)
  const a2 = Float32Array.from(alpha);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x;
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += alpha[p + dy * W + dx];
    a2[p] = Math.min(alpha[p] === 1 && s === 9 ? 1 : s / 9, 1);
    if (core[p]) a2[p] = Math.max(a2[p], alpha[p]);
  }

  // 7. Image finale + recadrage
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  const img = new Jimp({ width: W, height: H, color: 0x00000000 });
  const o = img.bitmap.data;
  for (let p = 0; p < N; p++) {
    const a = Math.round(a2[p] * 255);
    o[p * 4] = d[p * 4]; o[p * 4 + 1] = d[p * 4 + 1]; o[p * 4 + 2] = d[p * 4 + 2]; o[p * 4 + 3] = a;
    if (a > 8) { const x = p % W, y = (p / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const M = 6;
  x0 = Math.max(0, x0 - M); y0 = Math.max(0, y0 - M); x1 = Math.min(W - 1, x1 + M); y1 = Math.min(H - 1, y1 + M);
  img.crop({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  console.log('logo détouré', img.bitmap.width, 'x', img.bitmap.height);

  // Logo du launcher (820 px de large)
  const logo = img.clone();
  logo.resize({ w: 820 });
  await logo.write(path.join(racine, 'src/assets/images/logo/logo.png'));

  // Icône carrée 1024 px : logo centré sur 96 % du côté (npm run icon la réduit ensuite)
  const C = 1024, k = 0.96;
  const ic = img.clone();
  const f = Math.min(C * k / ic.bitmap.width, C * k / ic.bitmap.height);
  ic.resize({ w: Math.round(ic.bitmap.width * f), h: Math.round(ic.bitmap.height * f) });
  const carre = new Jimp({ width: C, height: C, color: 0x00000000 });
  carre.composite(ic, Math.round((C - ic.bitmap.width) / 2), Math.round((C - ic.bitmap.height) / 2));
  await carre.write(path.join(racine, 'src/assets/images/icon/icon.png'));

  const apercu = new Jimp({ width: img.bitmap.width, height: img.bitmap.height, color: 0x3a2a6eff });
  apercu.composite(img, 0, 0);
  await apercu.write(path.join(__dirname, 'logo', 'apercu-violet.png'));
  console.log('écrit : src/assets/images/logo/logo.png, src/assets/images/icon/icon.png (lance ensuite : npm run icon)');
})();
